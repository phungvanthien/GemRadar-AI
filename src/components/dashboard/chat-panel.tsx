"use client";

import { useRef, useEffect, useState } from "react";
import { Send, Bot, User, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { GemCards, type ScoredGem } from "@/components/dashboard/gem-cards";
import type { ChatMessage } from "@/lib/types";

const SUGGESTIONS = [
  "Is BONK a safe token right now?",
  "What's the market sentiment today?",
  "Explain mint & freeze authority risk",
];

// Friendly status labels for the tools the agent can run (see src/lib/ai-tools.ts).
const TOOL_LABELS: Record<string, string> = {
  search_tokens: "Searching tokens…",
  scan_token: "Scanning on-chain + RugCheck data…",
  get_market_overview: "Reading market overview…",
};

// Build a context-rich prompt from a scored gem so the AI can explain it in
// plain language without the user having to retype any numbers. The on-chain
// signals and the deterministic breakdown are the same ones the scan computed,
// so the chat answer stays consistent with the card.
function buildGemContext(gem: ScoredGem): string {
  const oc = gem.onChain;
  const pct = (n: number) => `${(n * 100).toFixed(0)}%`;
  const lines: string[] = [];

  lines.push(`Token: ${gem.name} (${gem.symbol})`);
  lines.push(`Mint: ${gem.mint}`);
  lines.push(`AI gem score: ${gem.gemScore}/10 · AI risk score: ${gem.riskScore}/10`);
  lines.push(`Potential upside: ${gem.potentialUpside}`);

  if (gem.breakdown) {
    const b = gem.breakdown;
    const cat = (label: string, c: { score: number; covered: boolean }) =>
      c.covered ? `${label} ${Math.round(c.score)}/100` : `${label} n/a`;
    lines.push(
      `Deterministic score: ${b.total}/100 (data coverage ${pct(b.coverage)})`,
    );
    lines.push(
      "  " +
        [
          cat("security", b.security),
          cat("liquidity", b.liquidity),
          cat("money-flow", b.moneyFlow),
          cat("distribution", b.distribution),
          cat("social", b.social),
        ].join(" · "),
    );
  }

  // Market context (only what we actually have).
  const market: string[] = [];
  if (gem.price) market.push(`price $${gem.price}`);
  if (gem.marketCap) market.push(`market cap $${Math.round(gem.marketCap).toLocaleString()}`);
  if (gem.volume24h) market.push(`24h vol $${Math.round(gem.volume24h).toLocaleString()}`);
  if (gem.percentChange24h) market.push(`24h ${gem.percentChange24h >= 0 ? "+" : ""}${gem.percentChange24h.toFixed(1)}%`);
  if (market.length) lines.push(`Market: ${market.join(", ")}`);

  // On-chain safety signals.
  lines.push("On-chain signals:");
  lines.push(`  mint authority ${oc.mintAuthorityRevoked ? "revoked" : "LIVE"}`);
  lines.push(`  freeze authority ${oc.freezeAuthorityRevoked ? "revoked" : "LIVE"}`);
  lines.push(`  top-10 holders hold ${pct(oc.holderConcentrationTop10)} of supply`);
  lines.push(`  largest single holder ${pct(oc.largestHolderShare)}`);
  if (oc.holderCount != null) lines.push(`  holder count ${oc.holderCount.toLocaleString()}`);
  if (oc.ageSeconds != null) {
    const hrs = oc.ageSeconds / 3600;
    lines.push(`  age ${hrs < 24 ? `${hrs.toFixed(1)}h` : `${(hrs / 24).toFixed(1)}d`}`);
  }
  if (oc.liquidity) {
    lines.push(
      `  pool: ${oc.liquidity.baseAmount} base / ${oc.liquidity.quoteAmount} ${oc.liquidity.quoteSymbol}`,
    );
  }
  if (oc.rugcheck) {
    const rc = oc.rugcheck;
    lines.push(`  RugCheck risk ${rc.scoreNormalised}/100`);
    if (rc.topRisks.length) lines.push(`  RugCheck flags: ${rc.topRisks.join(", ")}`);
    if (rc.lpLockedPct != null) lines.push(`  LP locked ${rc.lpLockedPct.toFixed(0)}%`);
    if (rc.insiderNetworkCount != null) lines.push(`  insider networks ${rc.insiderNetworkCount}`);
  }

  return (
    `Analyze this Solana token for me in plain language. ` +
    `Explain what the signals mean, the biggest risks, and whether the scores look justified.\n\n` +
    lines.join("\n")
  );
}

export function ChatPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "Welcome to AlphaHunter AI. Hit **Find Hidden Gems** to scan the freshest Solana mints from the live RugCheck feed — each is scored on security, liquidity, and holder distribution, then explained by AI. Ask me anything about reading those signals.",
    },
  ]);
  const [input, setInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  // Friendly label for the tool the agent is currently running, or null.
  const [toolStatus, setToolStatus] = useState<string | null>(null);
  const [gemsLoading, setGemsLoading] = useState(false);
  const [gems, setGems] = useState<ScoredGem[]>([]);
  const [gemsMeta, setGemsMeta] = useState<string | null>(null);
  const [gemsFailures, setGemsFailures] = useState<{ mint: string; reason: string }[]>([]);
  const [chatError, setChatError] = useState<string | null>(null);
  const [gemsError, setGemsError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const gemsSectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (gemsLoading || gems.length > 0 || gemsError) {
      gemsSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [gemsLoading, gems, gemsError]);

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || chatLoading) return;

    setChatError(null);
    const userMessage: ChatMessage = { role: "user", content: trimmed };
    const nextMessages = [...messages, userMessage];
    // Append the user message plus an empty assistant message we stream into.
    setMessages([...nextMessages, { role: "assistant", content: "" }]);
    setInput("");
    setChatLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages }),
      });

      if (!res.ok || !res.body) {
        // Error responses are still SSE; read the first error frame if present.
        const errText = await res.text();
        const match = errText.match(/"error":"([^"]*)"/);
        throw new Error(match?.[1] ?? "Chat failed");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamError: string | null = null;

      // Read the SSE stream, splitting on blank-line frame boundaries, and
      // append each delta to the trailing assistant message as it arrives.
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? ""; // keep the trailing partial frame

        for (const frame of frames) {
          const line = frame.replace(/^data:\s*/, "").trim();
          if (!line) continue;
          if (line === "[DONE]") continue;

          try {
            const parsed = JSON.parse(line) as {
              delta?: string;
              tool?: string;
              error?: string;
            };
            if (parsed.error) {
              streamError = parsed.error;
            } else if (parsed.tool) {
              setToolStatus(TOOL_LABELS[parsed.tool] ?? "Working…");
            } else if (parsed.delta) {
              // First answer token clears any tool status.
              setToolStatus(null);
              setMessages((prev) => {
                const copy = [...prev];
                const lastIdx = copy.length - 1;
                copy[lastIdx] = {
                  ...copy[lastIdx],
                  content: copy[lastIdx].content + parsed.delta,
                };
                return copy;
              });
            }
          } catch {
            // Ignore malformed frames (e.g. a keep-alive comment).
          }
        }
      }

      if (streamError) throw new Error(streamError);

      // If the stream produced nothing, show a fallback in the assistant bubble.
      setMessages((prev) => {
        const copy = [...prev];
        const lastIdx = copy.length - 1;
        if (copy[lastIdx]?.role === "assistant" && !copy[lastIdx].content) {
          copy[lastIdx] = {
            ...copy[lastIdx],
            content: "I couldn't generate a response. Please try again.",
          };
        }
        return copy;
      });
    } catch (e) {
      setChatError(e instanceof Error ? e.message : "Something went wrong");
      // Drop the empty assistant placeholder on failure.
      setMessages((prev) => {
        const copy = [...prev];
        const lastIdx = copy.length - 1;
        if (copy[lastIdx]?.role === "assistant" && !copy[lastIdx].content) {
          copy.pop();
        }
        return copy;
      });
    } finally {
      setChatLoading(false);
      setToolStatus(null);
    }
  }

  // Inject a context-rich prompt about a scored gem into the chat and scroll the
  // conversation into view so the streamed answer is visible.
  function askAboutGem(gem: ScoredGem) {
    if (chatLoading) return;
    sendMessage(buildGemContext(gem));
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }

  async function findHiddenGems() {
    setGemsLoading(true);
    setGemsError(null);
    setChatError(null);
    setGemsMeta(null);
    setGems([]);
    setGemsFailures([]);

    try {
      // No body => the server auto-scans the most recent Solana mints buffered
      // from the live RugCheck feed.
      const res = await fetch("/api/solana-gems", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gem scan failed");
      const results: ScoredGem[] = data.gems ?? [];
      setGems([...results].sort((a, b) => b.gemScore - a.gemScore));
      const failures = Array.isArray(data.failures) ? data.failures : [];
      setGemsFailures(failures);
      if (data.message) setGemsMeta(data.message);
      else if (data.enrichedCount != null) {
        setGemsMeta(
          `Scanned ${data.enrichedCount} recent Solana mint${data.enrichedCount === 1 ? "" : "s"}` +
            (failures.length > 0 ? ` · ${failures.length} could not be enriched` : ""),
        );
      }
    } catch (e) {
      setGems([]);
      setGemsError(e instanceof Error ? e.message : "Gem scan failed");
    } finally {
      setGemsLoading(false);
    }
  }

  return (
    <main className="flex h-full min-h-0 flex-col p-4 lg:max-h-[calc(100vh-4rem)]">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">AI Market Analyst</h2>
          <p className="text-xs text-zinc-500">
            AI-scored · Live Solana on-chain + RugCheck + Jupiter data
          </p>
        </div>
        <Button
          size="lg"
          onClick={findHiddenGems}
          disabled={gemsLoading || chatLoading}
          className="shrink-0 w-full sm:w-auto"
          aria-busy={gemsLoading}
        >
          {gemsLoading ? (
            <>
              <Loader2 className="animate-spin" />
              Scanning…
            </>
          ) : gems.length > 0 ? (
            <>
              <Sparkles />
              Re-scan
            </>
          ) : (
            <>
              <Sparkles />
              Find Hidden Gems
            </>
          )}
        </Button>
      </div>

      {chatError && (
        <Card className="mb-3 border-red-900/50 bg-red-950/30 p-3 text-sm text-red-400">
          {chatError}
        </Card>
      )}

      {gemsMeta && !gemsLoading && !gemsError && gems.length > 0 && (
        <p className="mb-2 text-center text-xs text-zinc-500">{gemsMeta}</p>
      )}

      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden border-zinc-800/80 bg-zinc-950/40">
        <ScrollArea className="flex-1 px-4">
          <div className="space-y-4 py-4">
            {messages.map((msg, i) => {
              // Hide the empty assistant placeholder while the first token is
              // still pending — the "analyzing" indicator stands in for it.
              if (msg.role === "assistant" && !msg.content) return null;
              return (
              <div
                key={i}
                className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}
              >
                <div
                  className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${
                    msg.role === "user"
                      ? "bg-amber-500/20 text-amber-400"
                      : "bg-violet-500/20 text-violet-400"
                  }`}
                >
                  {msg.role === "user" ? <User className="size-4" /> : <Bot className="size-4" />}
                </div>
                <div
                  className={`max-w-[85%] rounded-xl px-4 py-3 text-sm leading-relaxed ${
                    msg.role === "user"
                      ? "bg-amber-500/10 text-zinc-100"
                      : "bg-zinc-900/80 text-zinc-300"
                  }`}
                >
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                </div>
              </div>
              );
            })}
            {chatLoading &&
              messages[messages.length - 1]?.role === "assistant" &&
              !messages[messages.length - 1]?.content && (
                <div className="flex items-center gap-2 text-sm text-zinc-500">
                  <Loader2 className="size-4 animate-spin" />
                  {toolStatus ?? "AlphaHunter is analyzing..."}
                </div>
              )}
            <div ref={bottomRef} />
          </div>
        </ScrollArea>

        <div className="border-t border-zinc-800/80 p-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => sendMessage(s)}
                disabled={chatLoading}
                className="rounded-full border border-zinc-700/80 bg-zinc-900/60 px-3 py-1 text-xs text-zinc-400 transition-colors hover:border-amber-500/40 hover:text-amber-300 disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              sendMessage(input);
            }}
          >
            <Input
              placeholder="Ask about tokens, chains, or comparisons..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={chatLoading || gemsLoading}
            />
            <Button type="submit" size="icon" disabled={chatLoading || !input.trim()}>
              <Send />
            </Button>
          </form>
        </div>
      </Card>

      <div ref={gemsSectionRef}>
        <GemCards
          gems={gems}
          loading={gemsLoading}
          error={gemsError}
          emptyMessage={!gemsLoading && !gemsError ? gemsMeta : null}
          failures={gemsFailures}
          onAskAI={askAboutGem}
          askDisabled={chatLoading || gemsLoading}
        />
      </div>
    </main>
  );
}
