import { NextResponse, type NextRequest } from "next/server";
import fs from "node:fs";
import {
  getConversationById,
  insertMessageWithMedia,
  updateMessageWaId,
} from "@/lib/db";
import {
  MetaApiError,
  sendAudioMessage,
  uploadMediaToMeta,
} from "@/lib/meta/client";
import {
  audioExtFromMime,
  buildOutputAudioPath,
  convertToOggOpus,
  radiografiaDeAudio,
  saveTempAudio,
} from "@/lib/meta/media";
import { conElNumeroDeLaConversacion } from "@/lib/meta/numero-de-la-conversacion";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

interface Ctx {
  params: Promise<{ conversationId: string }>;
}

function safeUnlink(p: string): void {
  try {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch {
    // ignore
  }
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

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "bad form" }, { status: 400 });
  }

  const file = formData.get("audio");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "audio vacío" }, { status: 400 });
  }

  const inputMime = file.type || "audio/webm";
  const durationField = formData.get("duration_sec");
  const durationNum =
    typeof durationField === "string" ? Number(durationField) : NaN;
  const durationSec =
    Number.isFinite(durationNum) && durationNum > 0
      ? Math.round(durationNum)
      : null;

  // 1. Persistir buffer en archivo temporal y convertir a ogg/opus.
  const buffer = Buffer.from(await file.arrayBuffer());
  const tmpPath = saveTempAudio(buffer, audioExtFromMime(inputMime));
  const output = buildOutputAudioPath("ogg");

  try {
    await convertToOggOpus(tmpPath, output.abs_path);
  } catch (err) {
    safeUnlink(tmpPath);
    safeUnlink(output.abs_path);
    console.error("[audio] ffmpeg falló:", err);
    return NextResponse.json(
      { ok: false, error: "fallo al convertir audio" },
      { status: 500 }
    );
  }
  safeUnlink(tmpPath);

  // 1b. MIRAR EL ARCHIVO ANTES DE SUBIRLO. Meta rechazo un audio diciendo que
  // "on processing it is of type application/octet-stream": recibio el archivo
  // y dentro no habia audio. Aqui se comprueba que lo que produjo ffmpeg sea de
  // verdad un OGG (empieza por "OggS") y que pese algo. Si no lo es, NO se sube:
  // no tiene sentido mandar a Meta un archivo roto y esperar a que lo rechace
  // media hora despues por un aviso aparte.
  const radiografia = radiografiaDeAudio(output.abs_path);
  console.log(
    `[audio] convertido: ${radiografia.bytes} bytes, firma "${radiografia.firma}", ` +
      `es OGG=${radiografia.esOgg} (entrada ${inputMime}, ${buffer.length} bytes)`
  );
  if (!radiografia.esOgg || radiografia.bytes < 1024) {
    safeUnlink(output.abs_path);
    console.error(
      `[audio] la conversion NO produjo un OGG valido (${radiografia.bytes} bytes, firma "${radiografia.firma}"). No lo subo.`
    );
    return NextResponse.json(
      {
        ok: false,
        error:
          `La conversion del audio no produjo un archivo valido (${radiografia.bytes} bytes). ` +
          `Revisa ffmpeg en el servidor.`,
      },
      { status: 500 }
    );
  }

  // 2. Insertar primero en BD para que aparezca en la UI inmediatamente.
  const messageId = insertMessageWithMedia(
    convo.id,
    "human",
    "[audio]",
    null,
    {
      media_type: "audio",
      media_url: output.rel_path,
      media_mime: "audio/ogg",
      media_filename: null,
      transcription: null,
      duration_sec: durationSec,
    }
  );

  // 3. Subir a Meta y enviar.
  try {
    const { media_id } = await uploadMediaToMeta(output.abs_path, "audio/ogg");
    const { wa_message_id } = await sendAudioMessage(convo.phone, media_id);
    updateMessageWaId(messageId, wa_message_id);
    console.log(
      `[audio] -> enviado a ${convo.phone} (wamid: ${wa_message_id})`
    );
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
    console.error("[audio] error enviando:", err);
    return NextResponse.json(
      { ok: false, messageId, error: message },
      { status: 502 }
    );
  }
}

// SALE POR EL NÚMERO DE ESTA CONVERSACIÓN (21/10/2026), no por el principal. Ver
// `conElNumeroDeLaConversacion`.
export const POST = conElNumeroDeLaConversacion(enviar);
