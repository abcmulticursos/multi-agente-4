import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  getActiveMetaConnection,
  getMetaConnectionByPageId,
  type MediaPayload,
  type MediaType,
} from "@/lib/db";
import { getOutboundMessengerPage } from "@/lib/meta/runtime-config";
import {
  audioExtFromMime,
  documentExtFromMime,
  imageExtFromMime,
  videoExtFromMime,
} from "@/lib/meta/media";

const DATA_DIR = path.join(process.cwd(), "data");

function monthDir(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${mm}`;
}

function extensionFor(kind: MediaType, mime: string): string {
  if (kind === "image") return imageExtFromMime(mime);
  if (kind === "audio") return audioExtFromMime(mime);
  if (kind === "video") return videoExtFromMime(mime);
  return documentExtFromMime(mime);
}

export async function downloadMessengerAttachment(
  url: string,
  kind: MediaType
): Promise<MediaPayload> {
  // El token de la pagina por la que entro el mensaje, no el de la activa: el
  // adjunto se descarga con permiso de ESA pagina. Ver `getMessengerToken` en
  // `messenger/client.ts`. Sin contexto, la activa, como antes.
  const deLaPagina = getOutboundMessengerPage();
  const token =
    (deLaPagina
      ? getMetaConnectionByPageId(deLaPagina)?.page_access_token
      : null) ??
    getActiveMetaConnection()?.page_access_token ??
    process.env.MESSENGER_PAGE_ACCESS_TOKEN;
  if (!token) throw new Error("MESSENGER_PAGE_ACCESS_TOKEN no configurado");

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "<binary>");
    throw new Error(`Messenger media download ${res.status}: ${text}`);
  }

  const mime = res.headers.get("content-type")?.split(";")[0] || "application/octet-stream";
  const buffer = Buffer.from(await res.arrayBuffer());
  const folder = monthDir();
  const relDir = path.join("media", kind, folder);
  const absDir = path.join(DATA_DIR, relDir);
  fs.mkdirSync(absDir, { recursive: true });

  const filename = `${randomUUID()}.${extensionFor(kind, mime)}`;
  const absPath = path.join(absDir, filename);
  const relPath = path.join(relDir, filename).replaceAll("\\", "/");
  fs.writeFileSync(absPath, buffer);

  return {
    media_type: kind,
    media_url: relPath,
    media_mime: mime,
    media_filename: kind === "document" ? filename : null,
    transcription: null,
    duration_sec: null,
  };
}
