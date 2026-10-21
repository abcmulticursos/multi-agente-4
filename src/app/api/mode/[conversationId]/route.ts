import { NextResponse, type NextRequest } from "next/server";
import {
  cancelPendingActionsForConvo,
  getConversationById,
  setMode,
  type Mode,
} from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface Ctx {
  params: Promise<{ conversationId: string }>;
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const { conversationId } = await params;
  const id = Number(conversationId);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const convo = getConversationById(id);
  if (!convo) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  let body: { mode?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const mode = body.mode;
  if (mode !== "AI" && mode !== "HUMAN") {
    return NextResponse.json(
      { error: "mode debe ser 'AI' o 'HUMAN'" },
      { status: 400 }
    );
  }

  setMode(id, mode as Mode);
  if (mode === "HUMAN") {
    cancelPendingActionsForConvo(id);
  }
  return NextResponse.json({ ok: true, mode });
}
