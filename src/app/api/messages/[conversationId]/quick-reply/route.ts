import { NextResponse, type NextRequest } from "next/server";
import {
  getConversationById,
  getQuickReplyById,
  insertMessage,
  insertMessageWithMedia,
  updateMessageWaId,
} from "@/lib/db";
import {
  MetaApiError,
  sendAudioMessage,
  sendDocumentMessage,
  sendImageMessage,
  sendTextMessage,
  sendVideoMessage,
  uploadMediaToMeta,
} from "@/lib/meta/client";
import { rutaDelAdjunto } from "@/lib/quick-reply-media";
import { conElNumeroDeLaConversacion } from "@/lib/meta/numero-de-la-conversacion";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

interface Ctx {
  params: Promise<{ conversationId: string }>;
}

/**
 * ENVIAR UNA RESPUESTA RÁPIDA.
 *
 * El adjunto ya está guardado y convertido desde que se creó la respuesta, así
 * que aquí solo se sube a Meta y se manda. Si la respuesta lleva texto Y
 * adjunto, el texto viaja como pie del archivo — una sola burbuja, igual que
 * cuando mandas una foto con su descripción por WhatsApp.
 */
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

  let body: { quickReplyId?: unknown; content?: unknown };
  try {
    body = (await req.json()) as { quickReplyId?: unknown; content?: unknown };
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const quickReplyId = Number(body.quickReplyId);
  if (!Number.isFinite(quickReplyId) || quickReplyId <= 0) {
    return NextResponse.json({ error: "quickReplyId invalido" }, { status: 400 });
  }
  const reply = getQuickReplyById(quickReplyId);
  if (!reply) {
    return NextResponse.json(
      { error: "La respuesta rapida ya no existe" },
      { status: 404 }
    );
  }

  // El panel deja la respuesta en el cajón para poder retocarla antes de
  // mandarla, así que el texto que llega aquí manda sobre el guardado. Si no
  // viene ninguno, se usa el de la respuesta tal cual estaba.
  const texto =
    typeof body.content === "string"
      ? body.content.trim()
      : reply.content.trim();
  const tieneAdjunto = !!(reply.media_type && reply.media_url && reply.media_mime);

  // ── Solo texto: el camino de siempre.
  if (!tieneAdjunto) {
    const messageId = insertMessage(convo.id, "human", texto, null);
    try {
      const { wa_message_id } = await sendTextMessage(convo.phone, texto);
      updateMessageWaId(messageId, wa_message_id);
      return NextResponse.json({ ok: true, messageId });
    } catch (err) {
      return errorDeEnvio(err, messageId);
    }
  }

  // ── Con adjunto.
  const relPath = reply.media_url as string;
  const mime = reply.media_mime as string;
  const tipo = reply.media_type as "image" | "video" | "document" | "audio";
  let absPath: string;
  try {
    absPath = rutaDelAdjunto(relPath);
  } catch {
    return NextResponse.json(
      { ok: false, error: "El adjunto de esa respuesta no se encuentra" },
      { status: 500 }
    );
  }

  const etiqueta =
    texto ||
    (tipo === "image"
      ? "[imagen]"
      : tipo === "video"
        ? "[video]"
        : tipo === "audio"
          ? "[audio]"
          : reply.media_filename || "[documento]");

  const messageId = insertMessageWithMedia(convo.id, "human", etiqueta, null, {
    media_type: tipo,
    media_url: relPath,
    media_mime: mime,
    media_filename: reply.media_filename,
    transcription: null,
    duration_sec: null,
  });

  try {
    const { media_id } = await uploadMediaToMeta(absPath, mime);
    let wa_message_id: string;
    if (tipo === "image") {
      ({ wa_message_id } = await sendImageMessage(
        convo.phone,
        media_id,
        texto || undefined
      ));
    } else if (tipo === "video") {
      ({ wa_message_id } = await sendVideoMessage(
        convo.phone,
        media_id,
        texto || undefined
      ));
    } else if (tipo === "audio") {
      // El audio no admite pie de foto: si la respuesta trae texto, se manda
      // aparte y antes, para que llegue en orden.
      if (texto) {
        const textoId = insertMessage(convo.id, "human", texto, null);
        const previo = await sendTextMessage(convo.phone, texto);
        updateMessageWaId(textoId, previo.wa_message_id);
      }
      ({ wa_message_id } = await sendAudioMessage(convo.phone, media_id));
    } else {
      ({ wa_message_id } = await sendDocumentMessage(
        convo.phone,
        media_id,
        reply.media_filename || undefined,
        texto || undefined
      ));
    }
    updateMessageWaId(messageId, wa_message_id);
    console.log(
      `[respuesta-rapida] ${tipo} enviado a ${convo.phone} (wamid: ${wa_message_id})`
    );
    return NextResponse.json({ ok: true, messageId });
  } catch (err) {
    console.error("[respuesta-rapida] error enviando:", err);
    return errorDeEnvio(err, messageId);
  }
}

function errorDeEnvio(err: unknown, messageId: number): NextResponse {
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
  return NextResponse.json({ ok: false, messageId, error: message }, { status: 502 });
}

// SALE POR EL NÚMERO DE ESTA CONVERSACIÓN (21/10/2026), no por el principal. Ver
// `conElNumeroDeLaConversacion`.
export const POST = conElNumeroDeLaConversacion(enviar);
