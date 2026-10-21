import { NextResponse, type NextRequest } from "next/server";
import fs from "node:fs";
import {
  getConversationById,
  insertMessageWithMedia,
  updateMessageWaId,
} from "@/lib/db";
import {
  MetaApiError,
  sendImageMessage,
  uploadMediaToMeta,
} from "@/lib/meta/client";
import {
  buildOutputImagePath,
  convertToJpeg,
  imageExtFromMime,
  saveTempImage,
} from "@/lib/meta/media";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

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

  const file = formData.get("image");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "imagen vacía" }, { status: 400 });
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return NextResponse.json(
      { error: "imagen supera el límite de 5MB" },
      { status: 413 }
    );
  }
  const inputMime = file.type || "image/jpeg";
  if (!inputMime.startsWith("image/")) {
    return NextResponse.json(
      { error: "el archivo no es una imagen" },
      { status: 400 }
    );
  }

  const captionField = formData.get("caption");
  const caption =
    typeof captionField === "string" ? captionField.trim() : "";

  const buffer = Buffer.from(await file.arrayBuffer());
  const tmpPath = saveTempImage(buffer, imageExtFromMime(inputMime));
  const output = buildOutputImagePath("jpg");

  try {
    await convertToJpeg(tmpPath, output.abs_path);
  } catch (err) {
    safeUnlink(tmpPath);
    safeUnlink(output.abs_path);
    console.error("[image] ffmpeg falló:", err);
    return NextResponse.json(
      { ok: false, error: "fallo al convertir imagen" },
      { status: 500 }
    );
  }
  safeUnlink(tmpPath);

  const messageId = insertMessageWithMedia(
    convo.id,
    "human",
    caption || "[imagen]",
    null,
    {
      media_type: "image",
      media_url: output.rel_path,
      media_mime: "image/jpeg",
      media_filename: null,
      transcription: null,
      duration_sec: null,
    }
  );

  try {
    const { media_id } = await uploadMediaToMeta(output.abs_path, "image/jpeg");
    const { wa_message_id } = await sendImageMessage(
      convo.phone,
      media_id,
      caption || undefined
    );
    updateMessageWaId(messageId, wa_message_id);
    console.log(
      `[image] -> enviada a ${convo.phone} (wamid: ${wa_message_id})`
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
    console.error("[image] error enviando:", err);
    return NextResponse.json(
      { ok: false, messageId, error: message },
      { status: 502 }
    );
  }
}
