import fs from "node:fs";
import type { QuickReplyMedia } from "@/lib/db";
import {
  buildQuickReplyMediaPath,
  convertToJpeg,
  convertToMp4,
  convertToOggOpus,
  imageExtFromMime,
  resolveMediaAbsPath,
  saveTempAudio,
  saveTempImage,
  saveTempVideo,
} from "@/lib/meta/media";

/**
 * ADJUNTO DE UNA RESPUESTA RÁPIDA.
 *
 * El archivo se guarda UNA vez, ya convertido al formato que acepta Meta, para
 * que cada envío sea solo subir y mandar. Se usan los mismos conversores que el
 * chat: así lo que se manda desde una respuesta rápida es idéntico a lo que se
 * manda a mano.
 */

const MAX_BYTES = 16 * 1024 * 1024;

function borrarSilencioso(absPath: string): void {
  try {
    if (fs.existsSync(absPath)) fs.unlinkSync(absPath);
  } catch {
    // da igual: un temporal huérfano no rompe nada
  }
}

/** Ruta absoluta del adjunto guardado, para leerlo al enviar. */
export function rutaDelAdjunto(relPath: string): string {
  return resolveMediaAbsPath(relPath);
}

export function borrarAdjunto(relPath: string | null): void {
  if (!relPath) return;
  try {
    borrarSilencioso(rutaDelAdjunto(relPath));
  } catch {
    // ruta rara: no se toca nada
  }
}

/**
 * Guarda el archivo subido y lo deja listo para Meta. Devuelve null si no
 * venia archivo; lanza con un mensaje entendible si algo no cuadra.
 */
export async function guardarAdjunto(
  file: File
): Promise<QuickReplyMedia | null> {
  if (file.size === 0) return null;
  if (file.size > MAX_BYTES) {
    throw new Error("El archivo supera los 16MB que admite WhatsApp");
  }

  const mime = (file.type || "").toLowerCase();
  const buffer = Buffer.from(await file.arrayBuffer());
  const nombre = file.name?.trim() || null;

  if (mime.startsWith("image/")) {
    const tmp = saveTempImage(buffer, imageExtFromMime(mime));
    const salida = buildQuickReplyMediaPath("jpg");
    try {
      await convertToJpeg(tmp, salida.abs_path);
    } finally {
      borrarSilencioso(tmp);
    }
    return {
      media_type: "image",
      media_url: salida.rel_path,
      media_mime: "image/jpeg",
      media_filename: null,
    };
  }

  if (mime.startsWith("video/")) {
    const tmp = saveTempVideo(buffer, "bin");
    const salida = buildQuickReplyMediaPath("mp4");
    try {
      await convertToMp4(tmp, salida.abs_path);
    } finally {
      borrarSilencioso(tmp);
    }
    return {
      media_type: "video",
      media_url: salida.rel_path,
      media_mime: "video/mp4",
      media_filename: null,
    };
  }

  if (mime.startsWith("audio/")) {
    const tmp = saveTempAudio(buffer, "bin");
    const salida = buildQuickReplyMediaPath("ogg");
    try {
      await convertToOggOpus(tmp, salida.abs_path);
    } finally {
      borrarSilencioso(tmp);
    }
    return {
      media_type: "audio",
      media_url: salida.rel_path,
      media_mime: "audio/ogg",
      media_filename: null,
    };
  }

  if (mime.includes("pdf")) {
    const salida = buildQuickReplyMediaPath("pdf");
    fs.writeFileSync(salida.abs_path, buffer);
    return {
      media_type: "document",
      media_url: salida.rel_path,
      media_mime: "application/pdf",
      media_filename: nombre,
    };
  }

  throw new Error(
    "Solo se admiten imagenes, videos, audios y PDF. WhatsApp no acepta otros archivos aqui."
  );
}
