import { NextRequest, NextResponse } from "next/server";
import { generateChatResponse } from "@/lib/openai";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      messages?: { role: "user" | "assistant"; content: string }[];
    };

    const messages = body.messages;
    if (!messages?.length) {
      return NextResponse.json({ error: "Messages are required" }, { status: 400 });
    }

    const last = messages[messages.length - 1];
    if (last.role !== "user" || !last.content.trim()) {
      return NextResponse.json({ error: "Last message must be from user" }, { status: 400 });
    }

    const reply = await generateChatResponse(messages);
    return NextResponse.json({ message: reply });
  } catch (error) {
    console.error("[/api/chat]", error);
    const message = error instanceof Error ? error.message : "Chat request failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
