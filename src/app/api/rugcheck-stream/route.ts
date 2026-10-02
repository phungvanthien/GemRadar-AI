import { connectRugcheckSocket, type RugcheckStreamEvent } from "@/lib/rugcheck-socket";
import { recordMint } from "@/lib/recent-mints";
import type { RugcheckStreamToken } from "@/lib/types";

// Node runtime: the WS client uses node:https / node:crypto to set the
// X-API-KEY header the browser can't. force-dynamic + no revalidate so the
// stream is never cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET /api/rugcheck-stream -> Server-Sent Events. Each `token` event is a live
// RugCheck report, normalized to RugcheckStreamToken. The browser connects with
// EventSource; the API key stays on the server. The WS is opened per client and
// torn down when the client disconnects.

// Pull the gem-relevant fields out of a raw stream frame. Shapes vary across
// frames (some carry markets, some don't), so every field reads defensively.
function normalize(event: RugcheckStreamEvent): RugcheckStreamToken {
  const raw = event.raw;
  const token = (raw.token ?? {}) as Record<string, unknown>;
  const meta = (raw.tokenMeta ?? {}) as Record<string, unknown>;

  const risks = Array.isArray(raw.risks)
    ? (raw.risks as Array<Record<string, unknown>>)
        .slice()
        .sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0))
        .slice(0, 3)
        .map((r) => (typeof r.name === "string" ? r.name : "unknown"))
    : [];

  const num = (v: unknown): number | null => (typeof v === "number" ? v : null);

  return {
    mint: event.mint,
    symbol: typeof meta.symbol === "string" ? meta.symbol : "",
    name: typeof meta.name === "string" ? meta.name : "",
    creator: typeof raw.creator === "string" ? raw.creator : "",
    score: num(raw.score) ?? 0,
    scoreNormalised: num(raw.score_normalised) ?? 0,
    // RugCheck reports an authority as null/"" when revoked.
    mintAuthorityRevoked: !token.mintAuthority,
    freezeAuthorityRevoked: !token.freezeAuthority,
    totalMarketLiquidity: num(raw.totalMarketLiquidity),
    totalHolders: num(raw.totalHolders),
    topRisks: risks,
    receivedAt: new Date().toISOString(),
  };
}

export async function GET(request: Request) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (eventName: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          // Controller already closed (client gone) — ignore.
        }
      };

      const socket = connectRugcheckSocket({
        onOpen: () => send("status", { connected: true }),
        onEvent: (event) => {
          const token = normalize(event);
          // Record into the process-local recent-mints buffer so the gem scan
          // route can pull recent tokens without a client-supplied list.
          recordMint({
            mint: token.mint,
            symbol: token.symbol,
            name: token.name,
            scoreNormalised: token.scoreNormalised,
            mintAuthorityRevoked: token.mintAuthorityRevoked,
            freezeAuthorityRevoked: token.freezeAuthorityRevoked,
            totalMarketLiquidity: token.totalMarketLiquidity,
          });
          send("token", token);
        },
        onError: (message) => send("error", { message }),
        onClose: (code, reason) => {
          send("status", { connected: false, code, reason });
          if (!closed) {
            closed = true;
            try {
              controller.close();
            } catch {
              // already closed
            }
          }
        },
      });

      // Heartbeat as an SSE comment so proxies don't idle-close the connection.
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          // ignore
        }
      }, 15_000);

      // Client disconnected -> tear down the upstream WS and stop.
      const abort = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        socket.close();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      request.signal.addEventListener("abort", abort);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
