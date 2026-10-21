import { NextResponse, type NextRequest } from "next/server";
import fs from "node:fs";
import {
  getConversationById,
  insertMessageWithMedia,
  updateMessageWaId,
} from "@/lib/db";
import {
  MetaApiError,
  sendVideoMessage,
  uploadMediaToMeta,
} from "@/lib/meta/client";
import {
  buildOutputVideoPath,
  convertToMp4,
  saveTempVideo,
  videoExtFromMime,
} from "@/lib/meta/media";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_VIDEO_BYTES = 16 * 1024 * 1024;

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

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "bad form" }, { status: 400 });
  }

  const file = formData.get("video");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "video vacío" }, { status: 400 });
  }
  if (file.size > MAX_VIDEO_BYTES) {
    return NextResponse.json(
      { error: "video supera el límite de 16MB" },
      { status: 413 }
    );
  }
  const inputMime = file.type || "video/mp4";
  if (!inputMime.startsWith("video/")) {
    return NextResponse.json(
      { error: "el archivo no es un video" },
      { status: 400 }
    );
  }

  const captionField = formData.get("caption");
  const caption =
    typeof captionField === "string" ? captionField.trim() : "";

  // 1. Persistir buffer en archivo temporal y convertir a MP4 H.264+AAC.
  const buffer = Buffer.from(await file.arrayBuffer());
  const tmpPath = saveTempVideo(buffer, videoExtFromMime(inputMime));
  const output = buildOutputVideoPath("mp4");

  try {
    await convertToMp4(tmpPath, output.abs_path);
  } catch (err) {
    safeUnlink(tmpPath);
    safeUnlink(output.abs_path);
    console.error("[video] ffmpeg falló:", err);
    return NextResponse.json(
      { ok: false, error: "fallo al convertir video" },
      { status: 500 }
    );
  }
  safeUnlink(tmpPath);

  // 2. Insertar primero en BD para que aparezca en la UI inmediatamente.
  const messageId = insertMessageWithMedia(
    convo.id,
    "human",
    caption || "[video]",
    null,
    {
      media_type: "video",
      media_url: output.rel_path,
      media_mime: "video/mp4",
      media_filename: null,
      transcription: null,
      duration_sec: null,
    }
  );

  // 3. Subir a Meta y enviar.
  try {
    const { media_id } = await uploadMediaToMeta(output.abs_path, "video/mp4");
    const { wa_message_id } = await sendVideoMessage(
      convo.phone,
      media_id,
      caption || undefined
    );
    updateMessageWaId(messageId, wa_message_id);
    console.log(
      `[video] -> enviado a ${convo.phone} (wamid: ${wa_message_id})`
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
    console.error("[video] error enviando:", err);
    return NextResponse.json(
      { ok: false, messageId, error: message },
      { status: 502 }
    );
  }
}
