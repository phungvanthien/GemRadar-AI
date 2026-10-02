// RugCheck WebSocket client — server-side only.
//
// The RugCheck WS at wss://api.rugcheck.xyz/ws authenticates via the X-API-KEY
// *header* (query-param auth is rejected with 401 — verified against the live
// endpoint). Browsers can't set custom headers on a WebSocket, so this client
// must run on the server; the browser reaches it through the SSE proxy in
// /api/rugcheck-stream.
//
// Node 20 has no stable global WebSocket and we don't want a `ws` dependency,
// so this is a minimal RFC 6455 client over the core `https` module: it does
// the Upgrade handshake with the key header, then decodes the server's text
// frames. The server pushes a continuous stream of full token reports with no
// subscribe step (also verified live).

import https from "node:https";
import crypto from "node:crypto";
import type { TLSSocket } from "node:tls";

const WS_HOST = "api.rugcheck.xyz";
const WS_PATH = "/ws";
// The insider-networks channel returned 403 "plan not allowed" on our key, so
// we default to the base stream. Callers can still pass a custom path.

function apiKey(): string | null {
  return process.env.RUGCHECK_API_KEY ?? null;
}

// A decoded token-report frame. The stream sends the same shape as the REST
// report, but loosely — we surface the mint plus the raw parsed object and let
// the caller pick fields. Frames that don't parse as JSON are dropped.
export interface RugcheckStreamEvent {
  mint: string;
  raw: Record<string, unknown>;
}

export interface RugcheckSocketHandlers {
  onEvent: (event: RugcheckStreamEvent) => void;
  onOpen?: () => void;
  onClose?: (code: number, reason: string) => void;
  onError?: (message: string) => void;
}

export interface RugcheckSocketHandle {
  close: () => void;
}

// --- minimal RFC 6455 frame decoder ---
// Server-to-client frames are never masked. We handle text (0x1), close (0x8),
// and ping (0x9); other opcodes are ignored. Returns decoded text payloads and
// the number of bytes consumed so the caller can manage its buffer.
interface DecodedFrame {
  fin: boolean;
  opcode: number;
  payload: Buffer;
  totalLength: number;
}

function decodeFrame(buf: Buffer): DecodedFrame | null {
  if (buf.length < 2) return null;
  const fin = (buf[0] & 0x80) !== 0;
  const opcode = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) !== 0;
  let len = buf[1] & 0x7f;
  let offset = 2;

  if (len === 126) {
    if (buf.length < offset + 2) return null;
    len = buf.readUInt16BE(offset);
    offset += 2;
  } else if (len === 127) {
    if (buf.length < offset + 8) return null;
    // Payloads over 2^53 are not realistic here; read the low 32 bits.
    const high = buf.readUInt32BE(offset);
    const low = buf.readUInt32BE(offset + 4);
    len = high * 2 ** 32 + low;
    offset += 8;
  }

  // Server frames shouldn't be masked, but handle it defensively.
  let maskKey: Buffer | null = null;
  if (masked) {
    if (buf.length < offset + 4) return null;
    maskKey = buf.subarray(offset, offset + 4);
    offset += 4;
  }

  if (buf.length < offset + len) return null;
  let payload = buf.subarray(offset, offset + len);
  if (maskKey) {
    payload = Buffer.from(payload);
    for (let i = 0; i < payload.length; i++) payload[i] ^= maskKey[i & 3];
  }

  return { fin, opcode, payload, totalLength: offset + len };
}

// Build a client->server frame (masked, per spec). Only used for pong/close.
function encodeFrame(opcode: number, payload: Buffer): Buffer {
  const mask = crypto.randomBytes(4);
  const len = payload.length;
  let header: Buffer;
  if (len < 126) {
    header = Buffer.from([0x80 | opcode, 0x80 | len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 127;
    header.writeUInt32BE(Math.floor(len / 2 ** 32), 2);
    header.writeUInt32BE(len >>> 0, 6);
  }
  const masked = Buffer.from(payload);
  for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i & 3];
  return Buffer.concat([header, mask, masked]);
}

// Open a streaming connection. Returns a handle to close it. On disconnect the
// client does NOT auto-reconnect here — the SSE route owns reconnection policy
// so it can tie the socket lifecycle to the client connection. Every failure
// path calls onError/onClose rather than throwing, so a RugCheck outage never
// crashes the route.
export function connectRugcheckSocket(
  handlers: RugcheckSocketHandlers,
  options: { path?: string } = {},
): RugcheckSocketHandle {
  const key = apiKey();
  if (!key) {
    handlers.onError?.("RUGCHECK_API_KEY is not set");
    handlers.onClose?.(1008, "missing api key");
    return { close: () => {} };
  }

  const wsKey = crypto.randomBytes(16).toString("base64");
  const req = https.request({
    hostname: WS_HOST,
    port: 443,
    path: options.path ?? WS_PATH,
    method: "GET",
    headers: {
      Connection: "Upgrade",
      Upgrade: "websocket",
      "Sec-WebSocket-Version": "13",
      "Sec-WebSocket-Key": wsKey,
      "X-API-KEY": key,
      Origin: "https://rugcheck.xyz",
    },
  });

  let socket: TLSSocket | null = null;
  let closed = false;

  const shutdown = (code: number, reason: string) => {
    if (closed) return;
    closed = true;
    try {
      socket?.write(encodeFrame(0x8, Buffer.alloc(0)));
      socket?.end();
    } catch {
      // socket already gone
    }
    handlers.onClose?.(code, reason);
  };

  // Non-101 response = auth/plan/path error. Read the body for the reason.
  req.on("response", (res) => {
    let body = "";
    res.on("data", (c) => (body += c));
    res.on("end", () => {
      handlers.onError?.(
        `handshake failed: HTTP ${res.statusCode} ${body.slice(0, 200)}`,
      );
      shutdown(res.statusCode ?? 1011, body.slice(0, 120));
    });
  });

  req.on("upgrade", (_res, sock) => {
    // Handshake done — drop the handshake timeout so a long-lived stream isn't
    // killed by it, and disable per-socket idle timeout (server pings keep it alive).
    req.setTimeout(0);
    socket = sock as TLSSocket;
    socket.setTimeout(0);
    handlers.onOpen?.();

    let buffer = Buffer.alloc(0);
    // A large token report arrives split across a leading text frame (opcode
    // 0x1, FIN=0) followed by continuation frames (opcode 0x0), terminated by a
    // frame with FIN=1. We must reassemble the fragments into one message
    // before parsing — parsing each fragment on its own drops every big report.
    const fragments: Buffer[] = [];

    const dispatch = (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown>;
        const mint = typeof parsed.mint === "string" ? parsed.mint : null;
        if (mint) handlers.onEvent({ mint, raw: parsed });
      } catch {
        // Non-JSON message — skip. Dropping one is preferable to crashing.
      }
    };

    socket.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      // Drain every complete frame currently in the buffer.
      for (;;) {
        const frame = decodeFrame(buffer);
        if (!frame) break;
        buffer = buffer.subarray(frame.totalLength);

        if (frame.opcode === 0x8) {
          shutdown(1000, "server close");
          return;
        }
        if (frame.opcode === 0x9) {
          // Reply to ping with pong to keep the connection alive.
          try {
            socket?.write(encodeFrame(0xa, frame.payload));
          } catch {
            // ignore
          }
          continue;
        }
        // Text (0x1) starts a message; continuation (0x0) extends it. Collect
        // fragments until the frame with FIN set, then dispatch the whole thing.
        if (frame.opcode === 0x1 || frame.opcode === 0x0) {
          fragments.push(frame.payload);
          if (frame.fin) {
            const message = Buffer.concat(fragments).toString("utf8");
            fragments.length = 0;
            dispatch(message);
          }
        }
      }
    });

    socket.on("error", (err) => {
      handlers.onError?.(err instanceof Error ? err.message : String(err));
      shutdown(1011, "socket error");
    });
    socket.on("close", () => shutdown(1006, "socket closed"));
  });

  req.on("error", (err) => {
    handlers.onError?.(err instanceof Error ? err.message : String(err));
    shutdown(1011, "request error");
  });

  req.setTimeout(20_000, () => {
    handlers.onError?.("handshake timed out");
    try {
      req.destroy();
    } catch {
      // ignore
    }
    shutdown(1011, "timeout");
  });

  req.end();

  return { close: () => shutdown(1000, "client close") };
}
