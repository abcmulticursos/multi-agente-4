import { NextResponse, type NextRequest } from "next/server";
import {
  deleteConversation,
  getConversationById,
  markConversationRead,
  markConversationUnread,
  setConversationPinned,
  setConversationState,
} from "@/lib/db";
import { deleteLeadForConversation } from "@/lib/leads-sync";

const VALID_STATES = new Set([
  "new",
  "awaiting_response",
  "intro_running",
  "intro_done",
  "payment_done",
  "payment_approved",
  "awaiting_email",
  "awaiting_gift_consent",
  "awaiting_facebook_comment",
]);

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface Ctx {
  params: Promise<{ conversationId: string }>;
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { conversationId } = await params;
  const id = Number(conversationId);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const convo = getConversationById(id);
  if (!convo) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  let body: { pinned?: unknown; read?: unknown; state?: unknown };
  try {
    body = (await req.json()) as {
      pinned?: unknown;
      read?: unknown;
      state?: unknown;
    };
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  let updated = false;

  if (typeof body.pinned === "boolean") {
    setConversationPinned(id, body.pinned);
    updated = true;
  }

  if (typeof body.read === "boolean") {
    if (body.read) markConversationRead(id);
    else markConversationUnread(id);
    updated = true;
  }

  if (typeof body.state === "string" && VALID_STATES.has(body.state)) {
    // Kanban manual override: el operador arrastra una card a otra
    // columna. Esto actualiza el estado del flujo del bot. Si el operador
    // mueve a un estado terminal (payment_approved, etc.) el bot deja
    // de programar seguimientos automaticamente.
    setConversationState(id, body.state as Parameters<typeof setConversationState>[1]);
    updated = true;
  }

  if (updated) {
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json(
    { error: "nada para actualizar" },
    { status: 400 }
  );
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { conversationId } = await params;
  const id = Number(conversationId);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const convo = getConversationById(id);
  if (!convo) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  // Cascade primero a NocoDB (mientras la convo todavía existe localmente
  // y conocemos el nocodb_row_id). Si NocoDB falla, igual seguimos con
  // la limpieza local — no bloqueamos al usuario por un error remoto.
  await deleteLeadForConversation(id);
  deleteConversation(id);
  return NextResponse.json({ ok: true });
}
