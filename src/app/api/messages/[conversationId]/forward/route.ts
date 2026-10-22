import { NextResponse, type NextRequest } from "next/server";
import fs from "node:fs";
import {
  getConversationById,
  getMessageById,
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
import { resolveMediaAbsPath } from "@/lib/meta/media";
import { marcaDeAdjunto, pieDeFotoReal } from "@/lib/marca-de-adjunto";
import { conElNumeroDeLaConversacion } from "@/lib/meta/numero-de-la-conversacion";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

/** Tope de burbujas por reenvío. Es el mismo que usa WhatsApp. */
const MAX_POR_REENVIO = 30;
/** Pausa entre burbujas para que lleguen EN ORDEN al otro lado. */
const PAUSA_MS = 350;

interface Ctx {
  params: Promise<{ conversationId: string }>;
}

/** El texto que acompaña a una media. Los marcadores que pone el sistema
 *  ("[imagen]", "[video]"…) no son un texto escrito por nadie, así que no se
 *  reenvían como pie de foto. */
function pieDeFoto(contenido: string | null): string | undefined {
  // Antes se descartaba CUALQUIER texto entre corchetes. Un pie de foto que
  // fuera "[OFERTA]" se perdía al reenviar: ahora se compara contra las marcas
  // conocidas y no contra una forma.
  return pieDeFotoReal(contenido) || undefined;
}

/** El envío a mano. Se exporta envuelto en el número de su conversación (ver abajo). */
async function enviar(req: NextRequest, { params }: Ctx) {
  const { conversationId } = await params;
  const destinoId = Number(conversationId);
  if (!Number.isFinite(destinoId) || destinoId <= 0) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const destino = getConversationById(destinoId);
  if (!destino) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  let body: { messageIds?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const ids = Array.isArray(body.messageIds)
    ? body.messageIds
        .map((v) => Number(v))
        .filter((n) => Number.isFinite(n) && n > 0)
    : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: "sin mensajes" }, { status: 400 });
  }
  if (ids.length > MAX_POR_REENVIO) {
    return NextResponse.json(
      { error: `máximo ${MAX_POR_REENVIO} mensajes por reenvío` },
      { status: 400 }
    );
  }

  // En el ORDEN original de la conversación, no en el que se fueron tocando.
  const origen = ids
    .map((id) => getMessageById(id))
    .filter((m): m is NonNullable<typeof m> => !!m)
    .sort((a, b) => a.id - b.id);

  if (origen.length === 0) {
    return NextResponse.json({ error: "sin mensajes" }, { status: 404 });
  }

  const enviados: number[] = [];
  const fallidos: { id: number; error: string }[] = [];

  for (const [indice, msg] of origen.entries()) {
    // El texto que se ve en el panel. De un audio se reenvía su transcripción,
    // porque el archivo original puede no ser reenviable y el texto sí sirve.
    const texto = (msg.content ?? "").trim();

    try {
      if (!msg.media_type || !msg.media_url) {
        if (!texto) continue;
        const nuevoId = insertMessage(destino.id, "human", texto, null);
        const { wa_message_id } = await sendTextMessage(destino.phone, texto);
        updateMessageWaId(nuevoId, wa_message_id);
        enviados.push(msg.id);
      } else {
        const absPath = resolveMediaAbsPath(msg.media_url);
        if (!fs.existsSync(absPath)) {
          fallidos.push({ id: msg.id, error: "el archivo ya no está guardado" });
          continue;
        }
        const mime = msg.media_mime ?? "application/octet-stream";
        // La fila nueva apunta al MISMO archivo: no duplicamos nada en disco.
        const nuevoId = insertMessageWithMedia(
          destino.id,
          "human",
          texto || marcaDeAdjunto(msg.media_type),
          null,
          {
            media_type: msg.media_type,
            media_url: msg.media_url,
            media_mime: mime,
            media_filename: msg.media_filename,
            transcription: msg.transcription,
            duration_sec: msg.duration_sec,
          }
        );
        const { media_id } = await uploadMediaToMeta(absPath, mime);
        const pie = pieDeFoto(msg.content);
        let wa: { wa_message_id: string };
        if (msg.media_type === "image") {
          wa = await sendImageMessage(destino.phone, media_id, pie);
        } else if (msg.media_type === "video") {
          wa = await sendVideoMessage(destino.phone, media_id, pie);
        } else if (msg.media_type === "audio") {
          wa = await sendAudioMessage(destino.phone, media_id);
        } else {
          wa = await sendDocumentMessage(
            destino.phone,
            media_id,
            msg.media_filename ?? undefined,
            pie
          );
        }
        updateMessageWaId(nuevoId, wa.wa_message_id);
        enviados.push(msg.id);
      }
    } catch (err: unknown) {
      const error =
        err instanceof MetaApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      console.error(`[reenvío] mensaje ${msg.id} falló:`, err);
      fallidos.push({ id: msg.id, error });
    }

    // Sin pausa, WhatsApp puede entregarlas desordenadas.
    if (indice < origen.length - 1) {
      await new Promise((res) => setTimeout(res, PAUSA_MS));
    }
  }

  console.log(
    `[reenvío] convo ${destino.id}: ${enviados.length} enviados, ${fallidos.length} fallidos`
  );

  return NextResponse.json(
    {
      ok: fallidos.length === 0,
      enviados: enviados.length,
      fallidos,
    },
    { status: enviados.length > 0 ? 200 : 502 }
  );
}

// SALE POR EL NÚMERO DE ESTA CONVERSACIÓN (21/10/2026), no por el principal. Ver
// `conElNumeroDeLaConversacion`.
export const POST = conElNumeroDeLaConversacion(enviar);
