"use client";

import { useRef, useEffect, useState } from "react";
import { Send, Bot, User, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { GemCards } from "@/components/dashboard/gem-cards";
import type { ChatMessage, GemAnalysis } from "@/lib/types";

const SUGGESTIONS = [
  "Find promising BNB Chain tokens",
  "Analyze token growth potential",
  "Compare BTC vs ETH for the next cycle",
];

export function ChatPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "Welcome to AlphaHunter AI. I can help you discover opportunities, analyze growth potential, and compare tokens. Try a prompt below or hit **Find Hidden Gems** to scan low-cap movers.",
    },
  ]);
  const [input, setInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [gemsLoading, setGemsLoading] = useState(false);
  const [gems, setGems] = useState<GemAnalysis[]>([]);
  const [gemsMeta, setGemsMeta] = useState<string | null>(null);
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
    setMessages(nextMessages);
    setInput("");
    setChatLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Chat failed");
      setMessages([...nextMessages, { role: "assistant", content: data.message }]);
    } catch (e) {
      setChatError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setChatLoading(false);
    }
  }

  async function findHiddenGems() {
    setGemsLoading(true);
    setGemsError(null);
    setChatError(null);
    setGemsMeta(null);
    setGems([]);

    try {
      const res = await fetch("/api/gems", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gem scan failed");
      const results: GemAnalysis[] = data.gems ?? [];
      setGems([...results].sort((a, b) => b.gemScore - a.gemScore));
      if (data.message) setGemsMeta(data.message);
      else if (data.filteredCount != null) {
        setGemsMeta(
          `Scanned ${data.filteredCount} candidates · AI analyzed top ${data.analyzedCount ?? results.length}`
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
          <p className="text-xs text-zinc-500">Powered by OpenAI · Live CMC data for gem scans</p>
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
            {messages.map((msg, i) => (
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
            ))}
            {chatLoading && (
              <div className="flex items-center gap-2 text-sm text-zinc-500">
                <Loader2 className="size-4 animate-spin" />
                AlphaHunter is analyzing...
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
        />
      </div>
    </main>
  );
}
