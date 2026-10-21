import { NextResponse, type NextRequest } from "next/server";
import {
  getConversationById,
  insertMessageWithMedia,
  updateMessageWaId,
} from "@/lib/db";
import {
  MetaApiError,
  sendDocumentMessage,
  uploadMediaToMeta,
} from "@/lib/meta/client";
import {
  documentExtFromMime,
  saveDocumentBuffer,
} from "@/lib/meta/media";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_DOC_BYTES = 100 * 1024 * 1024;

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

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "bad form" }, { status: 400 });
  }

  const file = formData.get("document");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "documento vacío" }, { status: 400 });
  }
  if (file.size > MAX_DOC_BYTES) {
    return NextResponse.json(
      { error: "documento supera el límite de 100MB" },
      { status: 413 }
    );
  }
  const inputMime = file.type || "application/pdf";
  if (inputMime !== "application/pdf") {
    return NextResponse.json(
      { error: "solo se aceptan archivos PDF por ahora" },
      { status: 400 }
    );
  }

  const captionField = formData.get("caption");
  const caption =
    typeof captionField === "string" ? captionField.trim() : "";
  const originalName = file.name || "documento.pdf";

  // Guardar tal cual — Meta acepta PDF directo, sin conversión.
  const buffer = Buffer.from(await file.arrayBuffer());
  const output = saveDocumentBuffer(buffer, documentExtFromMime(inputMime));

  const messageId = insertMessageWithMedia(
    convo.id,
    "human",
    caption || originalName || "[documento]",
    null,
    {
      media_type: "document",
      media_url: output.rel_path,
      media_mime: "application/pdf",
      media_filename: originalName,
      transcription: null,
      duration_sec: null,
    }
  );

  try {
    const { media_id } = await uploadMediaToMeta(
      output.abs_path,
      "application/pdf"
    );
    const { wa_message_id } = await sendDocumentMessage(
      convo.phone,
      media_id,
      originalName,
      caption || undefined
    );
    updateMessageWaId(messageId, wa_message_id);
    console.log(
      `[doc] -> enviado a ${convo.phone} (${originalName}, wamid: ${wa_message_id})`
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
    console.error("[doc] error enviando:", err);
    return NextResponse.json(
      { ok: false, messageId, error: message },
      { status: 502 }
    );
  }
}
