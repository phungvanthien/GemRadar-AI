// Flux RPC client — JSON-RPC over HTTPS for Solana on-chain data.
// See flux-integration-plan.md (Giai đoạn 0). WebSocket lands in a later phase.

const DEFAULT_TIMEOUT_MS = 15_000;

export class FluxRpcError extends Error {
  constructor(
    message: string,
    readonly method: string,
    readonly code?: number,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "FluxRpcError";
  }
}

interface JsonRpcSuccess<T> {
  jsonrpc: "2.0";
  id: number;
  result: T;
}

interface JsonRpcFailure {
  jsonrpc: "2.0";
  id: number;
  error: { code: number; message: string };
}

type JsonRpcResponse<T> = JsonRpcSuccess<T> | JsonRpcFailure;

function endpoint(): string {
  const base = process.env.FLUX_RPC_URL;
  const key = process.env.FLUX_RPC_API_KEY;
  if (!base) throw new FluxRpcError("FLUX_RPC_URL is not configured", "<config>");
  if (!key) throw new FluxRpcError("FLUX_RPC_API_KEY is not configured", "<config>");
  const url = new URL(base);
  url.searchParams.set("key", key);
  return url.toString();
}

let requestId = 0;

export async function fluxRpc<T>(
  method: string,
  params: unknown[] = [],
  options: { timeoutMs?: number } = {},
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  let res: Response;
  try {
    res = await fetch(endpoint(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method, params }),
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new FluxRpcError(`Request timed out after ${options.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`, method);
    }
    throw new FluxRpcError(err instanceof Error ? err.message : "Network error", method);
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new FluxRpcError(`HTTP ${res.status}: ${body}`, method, undefined, res.status);
  }

  const json = (await res.json()) as JsonRpcResponse<T>;
  if ("error" in json) {
    throw new FluxRpcError(json.error.message, method, json.error.code);
  }
  return json.result;
}

// getHealth returns "ok" when the node is healthy; otherwise it errors with lag detail.
export async function checkHealth(): Promise<{ healthy: boolean; detail: string }> {
  try {
    const result = await fluxRpc<string>("getHealth");
    return { healthy: result === "ok", detail: result };
  } catch (err) {
    return {
      healthy: false,
      detail: err instanceof FluxRpcError ? err.message : String(err),
    };
  }
}

export async function getVersion(): Promise<{ solanaCore: string; featureSet: number }> {
  const result = await fluxRpc<{ "solana-core": string; "feature-set": number }>("getVersion");
  return { solanaCore: result["solana-core"], featureSet: result["feature-set"] };
}

// --- Cluster & Node (flux-intergration-phase-6) ---

export interface ClusterNode {
  pubkey: string;
  gossip: string | null;
  tpu: string | null;
  rpc: string | null;
  version: string | null;
  featureSet: number | null;
  shredVersion: number | null;
}

// All nodes participating in the cluster. Useful for gauging network size/health.
export async function getClusterNodes(): Promise<ClusterNode[]> {
  const result = await fluxRpc<
    Array<{
      pubkey: string;
      gossip: string | null;
      tpu: string | null;
      rpc: string | null;
      version: string | null;
      featureSet: number | null;
      shredVersion: number | null;
    }>
  >("getClusterNodes");
  return result;
}

// The identity pubkey of the node currently serving requests.
export async function getIdentity(): Promise<string> {
  const result = await fluxRpc<{ identity: string }>("getIdentity");
  return result.identity;
}

// Highest slot for which the node has a full and incremental snapshot.
export async function getHighestSnapshotSlot(): Promise<{
  full: number;
  incremental: number | null;
}> {
  const result = await fluxRpc<{ full: number; incremental: number | null }>(
    "getHighestSnapshotSlot",
  );
  return result;
}

// The genesis hash — identifies which cluster (mainnet/devnet/testnet) the node serves.
export async function getGenesisHash(): Promise<string> {
  return fluxRpc<string>("getGenesisHash");
}

export interface PerformanceSample {
  slot: number;
  numTransactions: number;
  numSlots: number;
  samplePeriodSecs: number;
  numNonVoteTransactions?: number;
}

// Recent performance samples in reverse slot order. `limit` samples, each ~60s.
// Used to derive an approximate TPS for surfacing network congestion.
export async function getRecentPerformanceSamples(
  limit = 4,
): Promise<PerformanceSample[]> {
  return fluxRpc<PerformanceSample[]>("getRecentPerformanceSamples", [limit]);
}

// Aggregate node/cluster status in one call. Runs the independent probes in
// parallel; each field falls back to null so a single failing method doesn't
// sink the whole snapshot.
export interface NodeStatus {
  healthy: boolean;
  healthDetail: string;
  version: string | null;
  identity: string | null;
  clusterSize: number | null;
  genesisHash: string | null;
  highestSnapshotSlot: number | null;
  approxTps: number | null;
}

export async function getNodeStatus(): Promise<NodeStatus> {
  const [health, version, identity, nodes, genesis, snapshot, samples] =
    await Promise.allSettled([
      checkHealth(),
      getVersion(),
      getIdentity(),
      getClusterNodes(),
      getGenesisHash(),
      getHighestSnapshotSlot(),
      getRecentPerformanceSamples(1),
    ]);

  const val = <T>(r: PromiseSettledResult<T>): T | null =>
    r.status === "fulfilled" ? r.value : null;

  const healthVal = val(health);
  const sample = val(samples)?.[0];
  const approxTps =
    sample && sample.samplePeriodSecs > 0
      ? sample.numTransactions / sample.samplePeriodSecs
      : null;

  return {
    healthy: healthVal?.healthy ?? false,
    healthDetail: healthVal?.detail ?? "unreachable",
    version: val(version)?.solanaCore ?? null,
    identity: val(identity),
    clusterSize: val(nodes)?.length ?? null,
    genesisHash: val(genesis),
    highestSnapshotSlot: val(snapshot)?.full ?? null,
    approxTps,
  };
}

// --- Inflation / Stake & Vote / Miscellaneous (flux-intergartion-phase-7) ---

// RPC methods that return { context, value }. flux-solana.ts has its own copy;
// duplicated here to keep flux.ts free of a dependency on that module.
interface RpcValue<T> {
  context: { slot: number };
  value: T;
}

type Commitment = "finalized" | "confirmed" | "processed";

const commitmentParam = (commitment: Commitment) => ({ commitment });

export interface InflationGovernor {
  initial: number;
  terminal: number;
  taper: number;
  foundation: number;
  foundationTerm: number;
}

// The cluster's inflation schedule parameters.
export async function getInflationGovernor(
  commitment: Commitment = "finalized",
): Promise<InflationGovernor> {
  return fluxRpc<InflationGovernor>("getInflationGovernor", [
    commitmentParam(commitment),
  ]);
}

export interface InflationRate {
  total: number;
  validator: number;
  foundation: number;
  epoch: number;
}

// The specific inflation values for the current epoch.
export async function getInflationRate(): Promise<InflationRate> {
  return fluxRpc<InflationRate>("getInflationRate");
}

export interface InflationReward {
  epoch: number;
  effectiveSlot: number;
  amount: number;
  postBalance: number;
  commission: number | null;
}

// Staking rewards for a list of addresses in a given epoch. Entries are null
// for addresses with no reward in that epoch.
export async function getInflationReward(
  addresses: string[],
  options: { commitment?: Commitment; epoch?: number } = {},
): Promise<(InflationReward | null)[]> {
  const cfg: Record<string, unknown> = {
    commitment: options.commitment ?? "finalized",
  };
  if (options.epoch !== undefined) cfg.epoch = options.epoch;
  return fluxRpc<(InflationReward | null)[]>("getInflationReward", [
    addresses,
    cfg,
  ]);
}

// Minimum stake delegation, in lamports.
export async function getStakeMinimumDelegation(
  commitment: Commitment = "finalized",
): Promise<number> {
  const result = await fluxRpc<RpcValue<number>>("getStakeMinimumDelegation", [
    commitmentParam(commitment),
  ]);
  return result.value;
}

export interface VoteAccount {
  votePubkey: string;
  nodePubkey: string;
  activatedStake: number;
  epochVoteAccount: boolean;
  commission: number;
  lastVote: number;
  rootSlot: number;
}

export interface VoteAccounts {
  current: VoteAccount[];
  delinquent: VoteAccount[];
}

// Account info and stake for all voting accounts in the current bank.
export async function getVoteAccounts(
  commitment: Commitment = "finalized",
): Promise<VoteAccounts> {
  return fluxRpc<VoteAccounts>("getVoteAccounts", [commitmentParam(commitment)]);
}

export interface Supply {
  total: number;
  circulating: number;
  nonCirculating: number;
  nonCirculatingAccounts: string[];
}

// Current supply information (lamports).
export async function getSupply(
  commitment: Commitment = "finalized",
): Promise<Supply> {
  const result = await fluxRpc<RpcValue<Supply>>("getSupply", [
    commitmentParam(commitment),
  ]);
  return result.value;
}

export interface LatestBlockhash {
  blockhash: string;
  lastValidBlockHeight: number;
}

// The most recent blockhash and the last block height it's valid for.
export async function getLatestBlockhash(
  commitment: Commitment = "finalized",
): Promise<LatestBlockhash> {
  const result = await fluxRpc<RpcValue<LatestBlockhash>>("getLatestBlockhash", [
    commitmentParam(commitment),
  ]);
  return result.value;
}

// Whether a blockhash is still valid for submitting transactions.
export async function isBlockhashValid(
  blockhash: string,
  commitment: Commitment = "finalized",
): Promise<boolean> {
  const result = await fluxRpc<RpcValue<boolean>>("isBlockhashValid", [
    blockhash,
    commitmentParam(commitment),
  ]);
  return result.value;
}

// Leader schedule for an epoch, keyed by validator identity pubkey. Returns
// null if the requested epoch's schedule isn't available.
export async function getLeaderSchedule(
  commitment: Commitment = "finalized",
): Promise<Record<string, number[]> | null> {
  return fluxRpc<Record<string, number[]> | null>("getLeaderSchedule", [
    commitmentParam(commitment),
  ]);
}

// Aggregate network economics in one call: inflation, supply, and staking
// participation. Independent probes run in parallel; each field falls back to
// null so one failing method doesn't sink the whole snapshot.
export interface NetworkEconomics {
  inflationRate: number | null;
  epoch: number | null;
  totalSupply: number | null;
  circulatingSupply: number | null;
  activeValidators: number | null;
  delinquentValidators: number | null;
  totalActiveStake: number | null;
  stakeMinimumDelegation: number | null;
}

export async function getNetworkEconomics(): Promise<NetworkEconomics> {
  const [rate, supply, votes, minDelegation] = await Promise.allSettled([
    getInflationRate(),
    getSupply(),
    getVoteAccounts(),
    getStakeMinimumDelegation(),
  ]);

  const val = <T>(r: PromiseSettledResult<T>): T | null =>
    r.status === "fulfilled" ? r.value : null;

  const rateVal = val(rate);
  const supplyVal = val(supply);
  const votesVal = val(votes);
  const totalActiveStake = votesVal
    ? votesVal.current.reduce((sum, v) => sum + v.activatedStake, 0)
    : null;

  return {
    inflationRate: rateVal?.total ?? null,
    epoch: rateVal?.epoch ?? null,
    totalSupply: supplyVal?.total ?? null,
    circulatingSupply: supplyVal?.circulating ?? null,
    activeValidators: votesVal?.current.length ?? null,
    delinquentValidators: votesVal?.delinquent.length ?? null,
    totalActiveStake,
    stakeMinimumDelegation: val(minDelegation),
  };
}
