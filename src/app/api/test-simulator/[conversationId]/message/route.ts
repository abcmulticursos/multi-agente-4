import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { NextResponse, type NextRequest } from "next/server";
import { getConversationById, type MediaPayload, type MediaType } from "@/lib/db";
import { processTestIncomingMessage } from "@/lib/meta/handler";
import { transcribeAudio } from "@/lib/transcription";
import { withModalidadDePrueba } from "@/lib/workflow/config";
import { marcaDeAdjunto } from "@/lib/marca-de-adjunto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 90;

interface Ctx { params: Promise<{ conversationId: string }> }

const MAX_BYTES = 32 * 1024 * 1024;

function detectMediaType(file: File): MediaType | null {
  const mime = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  if (mime.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp|heic)$/i.test(name)) return "image";
  if (mime.startsWith("audio/") || /\.(mp3|wav|ogg|m4a|aac|flac|opus|webm)$/i.test(name)) return "audio";
  if (mime.startsWith("video/") || /\.(mp4|mov|webm|mkv|avi|m4v|3gp)$/i.test(name)) return "video";
  if (mime === "application/pdf" || /\.pdf$/i.test(name)) return "document";
  return null;
}

function safeExtension(file: File): string {
  const ext = path.extname(file.name).replace(/[^a-z0-9.]/gi, "").slice(0, 12);
  return ext || ".bin";
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const id = Number((await params).conversationId);
  const convo = getConversationById(id);
  if (!convo || convo.channel !== "test") {
    return NextResponse.json({ error: "Prueba no encontrada" }, { status: 404 });
  }
  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: "Formulario inválido" }, { status: 400 }); }
  const raw = form.get("content");
  const content = typeof raw === "string" ? raw.trim() : "";
  const rawButtonId = form.get("button_id");
  const rawButtonTitle = form.get("button_title");
  const button =
    typeof rawButtonId === "string" && typeof rawButtonTitle === "string"
      ? { id: rawButtonId, title: rawButtonTitle }
      : null;
  const file = form.get("file");
  let media: MediaPayload | null = null;
  let transcription: string | null = null;
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_BYTES) return NextResponse.json({ error: "El archivo supera 32 MB" }, { status: 413 });
    const mediaType = detectMediaType(file);
    if (!mediaType) return NextResponse.json({ error: "Solo se permiten imagen, audio, video o PDF" }, { status: 400 });
    const relDir = path.join("media", "test");
    const relPath = path.join(relDir, `${crypto.randomUUID()}${safeExtension(file)}`).replace(/\\/g, "/");
    const absPath = path.join(process.cwd(), "data", relPath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, Buffer.from(await file.arrayBuffer()));
    let durationSec: number | null = null;
    if (mediaType === "audio") {
      try {
        const result = await transcribeAudio(absPath, file.type || "audio/webm");
        transcription = result.text || null;
        durationSec = result.duration_sec;
      } catch (err) {
        console.warn("[test] no se pudo transcribir audio:", err);
      }
    }
    media = {
      media_type: mediaType,
      media_url: relPath,
      media_mime: file.type || "application/octet-stream",
      media_filename: mediaType === "document" ? file.name.slice(0, 180) : null,
      transcription,
      duration_sec: durationSec,
    };
  }
  if (!content && !media && !button) return NextResponse.json({ error: "Escribe un mensaje o adjunta un archivo" }, { status: 400 });
  // MODO TESTEADOR. La modalidad elegida para ESTA prueba viaja pegada al
  // procesamiento de este mensaje y muere con él. Solo se llega aquí con una
  // conversación del simulador (arriba se exige channel === "test"), así que
  // ninguna clienta real puede entrar por este camino.
  //
  // Sin modalidad elegida no se envuelve nada y el bot usa la de siempre.
  await withModalidadDePrueba(convo.test_modality, () =>
    processTestIncomingMessage({
      phone: convo.phone,
      name: convo.name || "Cliente de prueba",
      content:
        content ||
        transcription ||
        button?.title ||
        marcaDeAdjunto(media?.media_type ?? "archivo"),
      media,
      button,
    })
  );
  return NextResponse.json({ ok: true });
}
