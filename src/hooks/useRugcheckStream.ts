"use client";

import { useEffect, useRef, useState } from "react";
import type { RugcheckStreamToken } from "@/lib/types";

export interface UseRugcheckStreamOptions {
  // Cap the retained buffer so a long-running stream doesn't grow unbounded.
  max?: number;
  // Start paused; call resume() to connect. Defaults to auto-connecting.
  enabled?: boolean;
  // Minimum gap between revealing successive tokens, in milliseconds. Incoming
  // tokens are buffered and released one at a time on this cadence so a fast
  // firehose stays readable. 0 (default) reveals every token immediately.
  revealIntervalMs?: number;
}

export interface UseRugcheckStreamResult {
  tokens: RugcheckStreamToken[]; // newest first
  connected: boolean;
  error: string | null;
  pending: number; // tokens buffered but not yet revealed
  clear: () => void;
}

// Subscribe to the live RugCheck token stream via the /api/rugcheck-stream SSE
// proxy. The proxy holds the authenticated WebSocket server-side, so no key is
// exposed here. EventSource reconnects on its own; we surface connection state
// and the most recent `max` tokens (deduplicated by mint, newest first).
//
// When `revealIntervalMs` > 0, incoming tokens are queued and drained one at a
// time on that interval so a fast stream doesn't scroll past unread.
export function useRugcheckStream(
  options: UseRugcheckStreamOptions = {},
): UseRugcheckStreamResult {
  const { max = 50, enabled = true, revealIntervalMs = 0 } = options;
  const [tokens, setTokens] = useState<RugcheckStreamToken[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const sourceRef = useRef<EventSource | null>(null);

  // Buffer of tokens waiting to be revealed, oldest first (FIFO). Kept in a ref
  // so the reveal timer and the SSE handler share one queue without re-running
  // effects on every arrival.
  const queueRef = useRef<RugcheckStreamToken[]>([]);
  // Latest reveal interval, read inside the timer without restarting the SSE.
  const intervalRef = useRef(revealIntervalMs);
  intervalRef.current = revealIntervalMs;

  // Push a token to the front of the displayed list, deduping by mint.
  function reveal(token: RugcheckStreamToken) {
    setTokens((prev) => {
      const withoutDupe = prev.filter((t) => t.mint !== token.mint);
      return [token, ...withoutDupe].slice(0, max);
    });
  }

  // SSE subscription. Restarts only when the connection identity changes
  // (enabled). Reveal cadence changes are picked up via intervalRef.
  useEffect(() => {
    if (!enabled) return;

    const source = new EventSource("/api/rugcheck-stream");
    sourceRef.current = source;

    source.addEventListener("token", (ev) => {
      try {
        const token = JSON.parse((ev as MessageEvent).data) as RugcheckStreamToken;
        if (intervalRef.current <= 0) {
          reveal(token);
          return;
        }
        // Throttled: buffer and let the drain timer release it.
        queueRef.current.push(token);
        setPending(queueRef.current.length);
      } catch {
        // Malformed event — skip.
      }
    });

    source.addEventListener("status", (ev) => {
      try {
        const status = JSON.parse((ev as MessageEvent).data) as {
          connected: boolean;
        };
        setConnected(status.connected);
      } catch {
        // ignore
      }
    });

    source.addEventListener("error", (ev) => {
      // Two error sources: our own `error` SSE event (carries a message) and
      // EventSource's native error (no data, fired on disconnect).
      const data = (ev as MessageEvent).data;
      if (typeof data === "string" && data) {
        try {
          setError((JSON.parse(data) as { message: string }).message);
        } catch {
          setError("stream error");
        }
      } else {
        setConnected(false);
      }
    });

    return () => {
      source.close();
      sourceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, max]);

  // Drain the buffer one token at a time on the reveal interval. When the
  // interval is 0 the queue is flushed immediately and no timer runs.
  useEffect(() => {
    if (revealIntervalMs <= 0) {
      if (queueRef.current.length > 0) {
        const drained = queueRef.current;
        queueRef.current = [];
        setPending(0);
        // Reveal oldest-first so ordering matches arrival.
        for (let i = drained.length - 1; i >= 0; i--) reveal(drained[i]);
      }
      return;
    }

    const timer = setInterval(() => {
      const next = queueRef.current.shift();
      if (next) {
        reveal(next);
        setPending(queueRef.current.length);
      }
    }, revealIntervalMs);

    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealIntervalMs, max]);

  return {
    tokens,
    connected,
    error,
    pending,
    clear: () => {
      queueRef.current = [];
      setPending(0);
      setTokens([]);
    },
  };
}
