import { NextRequest } from "next/server";
import { streamChatResponseWithTools } from "@/lib/ai";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Server-Sent Events stream: each chunk is a JSON line prefixed with "data: ".
// The client reads these with a fetch reader and appends delta tokens in real
// time, giving a ChatGPT-style typewriter effect without any extra dependencies.
//
// Protocol (one line per chunk):
//   data: {"delta":"..."}   — a text fragment to append
//   data: {"tool":"..."}    — a tool is running (surface a status line)
//   data: [DONE]            — stream is complete
//   data: {"error":"..."}   — a fatal error; client should surface it
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as {
    messages?: { role: "user" | "assistant"; content: string }[];
  } | null;

  const messages = body?.messages;
  if (!messages?.length) {
    return new Response(
      `data: ${JSON.stringify({ error: "Messages are required" })}\n\ndata: [DONE]\n\n`,
      { status: 400, headers: { "Content-Type": "text/event-stream" } },
    );
  }

  const last = messages[messages.length - 1];
  if (last.role !== "user" || !last.content.trim()) {
    return new Response(
      `data: ${JSON.stringify({ error: "Last message must be from user" })}\n\ndata: [DONE]\n\n`,
      { status: 400, headers: { "Content-Type": "text/event-stream" } },
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of streamChatResponseWithTools(messages)) {
          if (event.kind === "tool") {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ tool: event.name })}\n\n`),
            );
          } else if (event.text) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ delta: event.text })}\n\n`),
            );
          }
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (err) {
        console.error("[/api/chat stream]", err);
        const message = err instanceof Error ? err.message : "Chat request failed";
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ error: message })}\n\ndata: [DONE]\n\n`),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // disable nginx buffering
    },
  });
}
