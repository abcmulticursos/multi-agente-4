import { NextResponse, type NextRequest } from "next/server";
import {
  getConversationById,
  getMessageById,
  getMessages,
  getTestMessageButtons,
  insertMessage,
  updateMessageWaId,
} from "@/lib/db";
import { MetaApiError, sendTextMessage } from "@/lib/meta/client";
import { conElNumeroDeLaConversacion } from "@/lib/meta/numero-de-la-conversacion";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface Ctx {
  params: Promise<{ conversationId: string }>;
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { conversationId } = await params;
  const id = Number(conversationId);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const convo = getConversationById(id);
  if (!convo) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const messages = getMessages(id, 200);
  // Los botones que acompañaron a cada mensaje del bot, para poder dibujarlos
  // en el chat. Mismo formato que ya usa el simulador.
  const buttons: Record<number, { id: string; title: string }[]> = {};
  for (const message of messages) {
    const value = getTestMessageButtons(message.id);
    if (value.length) buttons[message.id] = value;
  }
  return NextResponse.json(
    { conversation: convo, messages, buttons },
    { headers: { "Cache-Control": "no-store" } }
  );
}

/** El envío a mano. Se exporta envuelto en el número de su conversación (ver abajo). */
async function enviar(req: NextRequest, { params }: Ctx) {
  const { conversationId } = await params;
  const id = Number(conversationId);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const convo = getConversationById(id);
  if (!convo) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  let body: { content?: unknown; replyTo?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!content) {
    return NextResponse.json({ error: "content vacío" }, { status: 400 });
  }

  // RESPONDER a un mensaje concreto: necesitamos su wamid, que es el
  // identificador que le dio Meta. Un mensaje que nunca llegó a salir no tiene
  // wamid; en ese caso se manda suelto en vez de fallar.
  const replyToId = Number(body.replyTo);
  const citado =
    Number.isFinite(replyToId) && replyToId > 0
      ? getMessageById(replyToId)
      : undefined;
  const replyToWamid =
    citado && citado.conversation_id === convo.id
      ? citado.wa_message_id
      : null;

  // 1. Guardar local primero — visible inmediatamente en el dashboard.
  const messageId = insertMessage(convo.id, "human", content, null);

  // 2. Enviar a Graph. Si falla, el row queda con wa_message_id = NULL y la UI
  //    lo muestra como error.
  try {
    const { wa_message_id } = await sendTextMessage(
      convo.phone,
      content,
      replyToWamid
    );
    updateMessageWaId(messageId, wa_message_id);
    return NextResponse.json({ ok: true, messageId });
  } catch (err: unknown) {
    if (err instanceof MetaApiError) {
      return NextResponse.json(
        {
          ok: false,
          messageId,
          error: err.message,
          code: err.code,
          subcode: err.subcode,
          status: err.status,
        },
        { status: 502 }
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, messageId, error: message },
      { status: 502 }
    );
  }
}

// SALE POR EL NÚMERO DE ESTA CONVERSACIÓN (21/10/2026), no por el principal. Ver
// `conElNumeroDeLaConversacion`.
export const POST = conElNumeroDeLaConversacion(enviar);
