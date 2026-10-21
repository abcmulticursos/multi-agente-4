import fs from "node:fs";
import path from "node:path";
import { getWhatsAppRuntimeConfig } from "@/lib/meta/runtime-config";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

const DATA_DIR = path.join(process.cwd(), "data");
const MEDIA_DIR = path.join(DATA_DIR, "media");

function graphBase(): string {
  const version = process.env.META_GRAPH_VERSION ?? "v21.0";
  return `https://graph.facebook.com/${version}`;
}

function extFromMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("ogg")) return "ogg";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("mp4")) return "m4a";
  if (m.includes("aac")) return "aac";
  if (m.includes("amr")) return "amr";
  if (m.includes("webm")) return "webm";
  if (m.includes("wav")) return "wav";
  return "bin";
}

function monthDir(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${mm}`;
}

export interface DownloadedMedia {
  /** Ruta absoluta en disco. */
  abs_path: string;
  /** Ruta relativa a data/ (lo que guardamos en BD). */
  rel_path: string;
  mime: string;
  size_bytes: number;
}

interface MetaMediaInfo {
  url: string;
  mime_type: string;
  file_size?: number;
}

async function getMediaInfo(
  mediaId: string,
  token: string
): Promise<MetaMediaInfo> {
  const res = await fetch(`${graphBase()}/${mediaId}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Meta media info ${res.status}: ${text}`);
  }
  const data = (await res.json()) as MetaMediaInfo;
  if (!data.url || !data.mime_type) {
    throw new Error(`Meta media info incompleta: ${JSON.stringify(data)}`);
  }
  return data;
}

/**
 * Descarga un media de Meta a disco.
 * 1. GET /{media-id} → URL temporal con auth
 * 2. GET URL con auth → binario
 * 3. Guarda en data/media/{kind}/{YYYY-MM}/{mediaId}.{ext}
 */
export async function downloadMediaFromMeta(
  mediaId: string,
  kind: "audio" | "image" | "video" | "document"
): Promise<DownloadedMedia> {
  const token = getWhatsAppRuntimeConfig().accessToken;
  if (!token) {
    throw new Error("META_ACCESS_TOKEN no configurado");
  }

  const info = await getMediaInfo(mediaId, token);

  const fileRes = await fetch(info.url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!fileRes.ok) {
    const text = await fileRes.text().catch(() => "<binary>");
    throw new Error(`Meta media download ${fileRes.status}: ${text}`);
  }
  const buffer = Buffer.from(await fileRes.arrayBuffer());

  const ext = extFromMime(info.mime_type);
  const folder = monthDir();
  const relDir = path.join("media", kind, folder);
  const absDir = path.join(DATA_DIR, relDir);
  fs.mkdirSync(absDir, { recursive: true });

  const filename = `${mediaId}.${ext}`;
  const absPath = path.join(absDir, filename);
  const relPath = path.join(relDir, filename).replaceAll("\\", "/");

  fs.writeFileSync(absPath, buffer);

  return {
    abs_path: absPath,
    rel_path: relPath,
    mime: info.mime_type,
    size_bytes: buffer.length,
  };
}

/**
 * ¿El mensaje trae un comprobante en PDF? Varios bancos (BCP, Interbank,
 * Banco Bolivariano) mandan la constancia como PDF y no como foto. El PDF se
 * le pasa al modelo como archivo adjunto y OpenRouter le extrae el texto, así
 * que se puede leer igual que una imagen.
 *
 * Solo cuenta el PDF: los demás documentos (Word, Excel) siguen sin leerse.
 */
export function esComprobantePdf(m: {
  media_type?: string | null;
  media_mime?: string | null;
}): boolean {
  return (
    m.media_type === "document" &&
    (m.media_mime ?? "").toLowerCase().includes("pdf")
  );
}

export function audioExtFromMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("webm")) return "webm";
  if (m.includes("mp4") || m.includes("m4a")) return "m4a";
  if (m.includes("ogg")) return "ogg";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("wav")) return "wav";
  return "bin";
}

export interface SavedMediaPath {
  abs_path: string;
  rel_path: string;
}

/** Genera una ruta de salida única bajo data/media/audio/{YYYY-MM}/{uuid}.{ext}. */
export function buildOutputAudioPath(ext: string): SavedMediaPath {
  const folder = monthDir();
  const relDir = path.join("media", "audio", folder);
  const absDir = path.join(DATA_DIR, relDir);
  fs.mkdirSync(absDir, { recursive: true });
  const filename = `${randomUUID()}.${ext}`;
  const absPath = path.join(absDir, filename);
  const relPath = path.join(relDir, filename).replaceAll("\\", "/");
  return { abs_path: absPath, rel_path: relPath };
}

/** Guarda un buffer en un archivo temporal en la carpeta de audio. */
export function saveTempAudio(buffer: Buffer, ext: string): string {
  const folder = monthDir();
  const absDir = path.join(DATA_DIR, "media", "audio", folder);
  fs.mkdirSync(absDir, { recursive: true });
  const tmpPath = path.join(absDir, `_tmp_${randomUUID()}.${ext}`);
  fs.writeFileSync(tmpPath, buffer);
  return tmpPath;
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-500)}`));
    });
  });
}

/**
 * Radiografía de un archivo de audio ya convertido: cuánto pesa y qué es de
 * verdad, leyendo sus primeros bytes.
 *
 * Existe porque Meta rechazó un audio con "on processing it is of type
 * application/octet-stream": recibió el archivo y dentro no encontró audio.
 * Sin mirar el archivo no hay forma de saber si la conversión salió mal o si
 * el problema está en la subida.
 *
 * Un OGG válido empieza SIEMPRE por los cuatro bytes "OggS".
 */
export function radiografiaDeAudio(absPath: string): {
  bytes: number;
  firma: string;
  esOgg: boolean;
} {
  let bytes = 0;
  try {
    bytes = fs.statSync(absPath).size;
  } catch {
    return { bytes: 0, firma: "(no existe)", esOgg: false };
  }
  const fd = fs.openSync(absPath, "r");
  try {
    const cabecera = Buffer.alloc(4);
    const leidos = fs.readSync(fd, cabecera, 0, 4, 0);
    const firma = cabecera.subarray(0, Math.max(0, leidos)).toString("latin1");
    return { bytes, firma, esOgg: firma === "OggS" };
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Convierte un audio a OGG/Opus mono 32kbps — formato que Meta acepta para
 * mensajes type=audio.
 */
export async function convertToOggOpus(
  inputPath: string,
  outputPath: string
): Promise<void> {
  // Meta rechazaba estos audios con 131053 ("on processing it is of type
  // application/octet-stream") aunque el OGG fuera valido y llegaran los mismos
  // bytes. Probando envios reales quedo claro que hacen falta DOS cosas a la
  // vez, y ninguno de los intentos fallidos las tenia juntas:
  //
  //   origen  | bitrate   | inicio    | resultado
  //   WebM    | 32 kb/s   | -0.0005   | falla
  //   WebM    | 129 kb/s  |  0.000    | falla   (copiado tal cual)
  //   OGG     | 32 kb/s   |  0.000    | LLEGA
  //
  // El inicio negativo lo arrastra el WebM de MediaRecorder, que no empieza en
  // cero. `aresample=async=1:first_pts=0` reescribe los tiempos desde cero, y
  // el bitrate fijo evita el caso del audio pesado.
  await runFfmpeg([
    "-y",
    "-i",
    inputPath,
    "-vn",
    // Tiempos desde cero: sin esto el archivo sale con inicio negativo.
    "-af",
    "aresample=async=1:first_pts=0",
    // Sin metadatos. Comparando con una nota de voz que mando WhatsApp, la
    // nuestra llevaba encima la etiqueta de idioma "(eng)" y el nombre del
    // codificador ("Lavc... libopus"); la de WhatsApp venia limpia. Meta
    // rechazaba las nuestras diciendo que al procesarlas no eran audio.
    "-map_metadata",
    "-1",
    "-map_chapters",
    "-1",
    "-c:a",
    "libopus",
    // Perfil de voz, como el que usa WhatsApp en sus propias notas.
    "-application",
    "voip",
    "-b:a",
    "32k",
    "-ac",
    "1",
    "-ar",
    "48000",
    // Que el muxer tampoco escriba su propia firma: la nota de voz de WhatsApp
    // no trae ninguna etiqueta.
    "-bitexact",
    "-avoid_negative_ts",
    "make_zero",
    outputPath,
  ]);
}

/**
 * Ruta para el adjunto de una respuesta rápida. Va en su propia carpeta, sin
 * separar por mes: no es un mensaje, es contenido tuyo que se reutiliza y no
 * debe barrerse con la limpieza de medios antiguos.
 */
export function buildQuickReplyMediaPath(ext: string): SavedMediaPath {
  const relDir = path.join("media", "quick-replies");
  const absDir = path.join(DATA_DIR, relDir);
  fs.mkdirSync(absDir, { recursive: true });
  const filename = `${randomUUID()}.${ext}`;
  return {
    abs_path: path.join(absDir, filename),
    rel_path: path.join(relDir, filename).replaceAll("\\", "/"),
  };
}

export function imageExtFromMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  if (m.includes("png")) return "png";
  if (m.includes("webp")) return "webp";
  if (m.includes("gif")) return "gif";
  if (m.includes("heic") || m.includes("heif")) return "heic";
  return "bin";
}

export function buildOutputImagePath(ext: string): SavedMediaPath {
  const folder = monthDir();
  const relDir = path.join("media", "image", folder);
  const absDir = path.join(DATA_DIR, relDir);
  fs.mkdirSync(absDir, { recursive: true });
  const filename = `${randomUUID()}.${ext}`;
  const absPath = path.join(absDir, filename);
  const relPath = path.join(relDir, filename).replaceAll("\\", "/");
  return { abs_path: absPath, rel_path: relPath };
}

export function saveTempImage(buffer: Buffer, ext: string): string {
  const folder = monthDir();
  const absDir = path.join(DATA_DIR, "media", "image", folder);
  fs.mkdirSync(absDir, { recursive: true });
  const tmpPath = path.join(absDir, `_tmp_${randomUUID()}.${ext}`);
  fs.writeFileSync(tmpPath, buffer);
  return tmpPath;
}

/**
 * Convierte cualquier imagen a JPEG (formato más universal soportado por Meta).
 * Para HEIC/HEIF requiere ffmpeg compilado con libheif.
 */
export async function convertToJpeg(
  inputPath: string,
  outputPath: string
): Promise<void> {
  await runFfmpeg(["-y", "-i", inputPath, "-q:v", "2", outputPath]);
}

export function documentExtFromMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("pdf")) return "pdf";
  return "bin";
}

export function buildOutputDocumentPath(ext: string): SavedMediaPath {
  const folder = monthDir();
  const relDir = path.join("media", "document", folder);
  const absDir = path.join(DATA_DIR, relDir);
  fs.mkdirSync(absDir, { recursive: true });
  const filename = `${randomUUID()}.${ext}`;
  const absPath = path.join(absDir, filename);
  const relPath = path.join(relDir, filename).replaceAll("\\", "/");
  return { abs_path: absPath, rel_path: relPath };
}

export function saveDocumentBuffer(buffer: Buffer, ext: string): SavedMediaPath {
  const out = buildOutputDocumentPath(ext);
  fs.writeFileSync(out.abs_path, buffer);
  return out;
}

export function videoExtFromMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("mp4")) return "mp4";
  if (m.includes("quicktime") || m.includes("mov")) return "mov";
  if (m.includes("webm")) return "webm";
  if (m.includes("3gpp") || m.includes("3gp")) return "3gp";
  if (m.includes("x-matroska") || m.includes("mkv")) return "mkv";
  return "bin";
}

/** Genera una ruta de salida única bajo data/media/video/{YYYY-MM}/{uuid}.{ext}. */
export function buildOutputVideoPath(ext: string): SavedMediaPath {
  const folder = monthDir();
  const relDir = path.join("media", "video", folder);
  const absDir = path.join(DATA_DIR, relDir);
  fs.mkdirSync(absDir, { recursive: true });
  const filename = `${randomUUID()}.${ext}`;
  const absPath = path.join(absDir, filename);
  const relPath = path.join(relDir, filename).replaceAll("\\", "/");
  return { abs_path: absPath, rel_path: relPath };
}

/** Guarda un buffer en un archivo temporal en la carpeta de video. */
export function saveTempVideo(buffer: Buffer, ext: string): string {
  const folder = monthDir();
  const absDir = path.join(DATA_DIR, "media", "video", folder);
  fs.mkdirSync(absDir, { recursive: true });
  const tmpPath = path.join(absDir, `_tmp_${randomUUID()}.${ext}`);
  fs.writeFileSync(tmpPath, buffer);
  return tmpPath;
}

/**
 * Convierte un video a MP4 H.264 + AAC, formato que Meta acepta para mensajes
 * type=video. Usa preset veryfast + CRF 28 para velocidad razonable.
 */
export async function convertToMp4(
  inputPath: string,
  outputPath: string
): Promise<void> {
  await runFfmpeg([
    "-y",
    "-i",
    inputPath,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "28",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    outputPath,
  ]);
}

/** Resuelve un rel_path de BD a la ruta absoluta del archivo. */
export function resolveMediaAbsPath(relPath: string): string {
  // Saneamos para evitar path traversal.
  const normalized = path.normalize(relPath).replace(/^([/\\])+/, "");
  if (normalized.startsWith("..")) {
    throw new Error("rel_path inválido");
  }
  return path.join(DATA_DIR, normalized);
}

export { MEDIA_DIR };
