import fs from "node:fs";
import path from "node:path";
import { convertToOggOpus, convertToMp4, convertToJpeg } from "@/lib/meta/media";

const DATA_DIR = path.join(process.cwd(), "data");
const CACHE_DIR = path.join(DATA_DIR, "cache", "drive");

export interface ReadyMedia {
  /** Ruta absoluta en disco. */
  abs_path: string;
  /** Ruta relativa a data/ — para guardar en BD y servir vía /api/media. */
  rel_path: string;
  /** Mime final tras conversión. */
  mime: string;
}

/**
 * Extrae el ID de un link de Google Drive en cualquiera de sus formatos:
 *  - https://drive.google.com/file/d/FILE_ID/view?...
 *  - https://drive.google.com/open?id=FILE_ID
 *  - https://drive.google.com/uc?export=download&id=FILE_ID
 */
export function extractDriveFileId(url: string): string | null {
  const m1 = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (m1) return m1[1];
  const m2 = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m2) return m2[1];
  return null;
}

/**
 * LA FICHA DEL ARCHIVO EN DRIVE, sin descargarlo.
 *
 * Drive contesta el peso exacto y la fecha de modificación en las cabeceras. Con
 * eso basta para saber si el archivo cambió: dos imágenes distintas no pesan lo
 * mismo al byte, y reemplazar una en Drive siempre mueve la fecha.
 *
 * Cuesta unos cientos de bytes. Al lado de subir la foto a Meta —que pasa en
 * cada envío— no se nota.
 *
 * Devuelve null si Drive no contesta: quien llama debe seguir con la copia que
 * tenga. Que esta comprobación falle nunca puede dejar a un cliente sin su foto.
 */
async function huellaDeDrive(fileId: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://drive.google.com/uc?export=download&id=${fileId}`,
      { method: "HEAD", redirect: "follow" }
    );
    if (!res.ok) return null;
    const peso = res.headers.get("content-length");
    const fecha = res.headers.get("last-modified");
    if (!peso && !fecha) return null;
    return `${peso ?? "-"}|${fecha ?? "-"}`;
  } catch {
    return null;
  }
}

/** La ficha se guarda al lado de la copia, en un archivo hermano. */
function rutaDeHuella(absReady: string): string {
  return `${absReady}.ficha`;
}

function leerHuella(absReady: string): string {
  try {
    return fs.readFileSync(rutaDeHuella(absReady), "utf8").trim();
  } catch {
    return "";
  }
}

function guardarHuella(absReady: string, huella: string): void {
  try {
    fs.writeFileSync(rutaDeHuella(absReady), huella);
  } catch {
    // Sin ficha, la próxima vez se vuelve a bajar. Molesto, nunca roto.
  }
}

/**
 * Olvida la copia guardada de un archivo, con su ficha.
 *
 * Es lo que hace el botón ↻ del editor: la próxima vez que el bot mande ese
 * archivo lo bajará de nuevo. Sirve para el caso raro que la ficha no ve —una
 * foto nueva que pese exactamente lo mismo— y para cuando hay prisa.
 */
export function olvidarCopiaDeDrive(driveUrl: string): number {
  const fileId = extractDriveFileId(driveUrl);
  if (!fileId) return 0;
  let borrados = 0;
  let entradas: string[] = [];
  try {
    entradas = fs.readdirSync(CACHE_DIR);
  } catch {
    return 0;
  }
  // Se borra CUALQUIER formato del mismo archivo: el mismo id puede estar
  // guardado como .jpg y como .mp4 si alguien cambió el selector de tipo.
  for (const nombre of entradas) {
    if (!nombre.startsWith(`${fileId}.`)) continue;
    try {
      fs.unlinkSync(path.join(CACHE_DIR, nombre));
      borrados++;
    } catch {
      // ignore
    }
  }
  return borrados;
}

async function downloadDriveFileRaw(
  fileId: string,
  destPath: string
): Promise<void> {
  const url = `https://drive.google.com/uc?export=download&id=${fileId}`;
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`Drive ${res.status} para ${fileId}`);
  }
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.startsWith("text/html")) {
    throw new Error(
      `Drive devolvió HTML (${fileId}) — verifica que el archivo sea público y < 25 MB`
    );
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, buffer);
}

/**
 * Descarga (o reutiliza) un archivo de Drive y lo deja listo en formato Meta:
 *   audio → ogg/opus
 *   image → jpeg
 *   video → mp4 (h264+aac)
 *   document → pdf
 *
 * Cachea el resultado por fileId, así una segunda llamada con la misma URL
 * es instantánea.
 */
export async function getReadyMediaFromDrive(
  driveUrl: string,
  kind: "audio" | "image" | "video" | "document"
): Promise<ReadyMedia> {
  const fileId = extractDriveFileId(driveUrl);
  if (!fileId) {
    throw new Error(`URL de Drive inválida: ${driveUrl}`);
  }

  const targetExt =
    kind === "audio"
      ? "ogg"
      : kind === "image"
        ? "jpg"
        : kind === "video"
          ? "mp4"
          : "pdf";
  const targetMime =
    kind === "audio"
      ? "audio/ogg"
      : kind === "image"
        ? "image/jpeg"
        : kind === "video"
          ? "video/mp4"
          : "application/pdf";

  const relReady = path.join("cache", "drive", `${fileId}.${targetExt}`);
  const absReady = path.join(DATA_DIR, relReady);

  if (fs.existsSync(absReady) && fs.statSync(absReady).size > 0) {
    // ¿SIGUE SIENDO LA MISMA FOTO?
    //
    // Antes se devolvía la copia sin preguntar nada, y no caducaba nunca:
    // reemplazar el archivo en Drive conservando el enlace no servía de nada,
    // el bot seguía mandando la copia vieja para siempre. La única salida era
    // cambiar el enlace en cada burbuja, a mano.
    //
    // Ahora se le pide a Drive la FICHA del archivo —peso y fecha—, que son
    // unos cientos de bytes de cabeceras. Si coincide con la de la copia, se usa
    // la copia. Si cambió, se baja de nuevo.
    const huellaAhora = await huellaDeDrive(fileId);
    const huellaGuardada = leerHuella(absReady);
    if (!huellaAhora || huellaAhora === huellaGuardada) {
      // Sin respuesta de Drive se usa la copia igual. Que la comprobación falle
      // no puede dejar al cliente sin la foto: es una mejora, no un requisito.
      if (!huellaAhora && !huellaGuardada) guardarHuella(absReady, "");
      return {
        abs_path: absReady,
        rel_path: relReady.replaceAll("\\", "/"),
        mime: targetMime,
      };
    }
    console.log(
      `[drive] ${fileId} cambió en Drive (${huellaGuardada || "sin ficha"} → ${huellaAhora}), lo bajo de nuevo`
    );
  }

  // Descargar raw a archivo temporal
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const rawPath = path.join(CACHE_DIR, `${fileId}.raw`);
  await downloadDriveFileRaw(fileId, rawPath);

  // Convertir al formato Meta. Los documentos PDF se conservan tal cual.
  try {
    if (kind === "audio") {
      await convertToOggOpus(rawPath, absReady);
    } else if (kind === "image") {
      await convertToJpeg(rawPath, absReady);
    } else if (kind === "video") {
      await convertToMp4(rawPath, absReady);
    } else {
      fs.copyFileSync(rawPath, absReady);
    }
  } finally {
    try {
      fs.unlinkSync(rawPath);
    } catch {
      // ignore
    }
  }

  // La ficha se guarda DESPUÉS de convertir: si algo falla a mitad, no queda una
  // ficha diciendo que la copia está al día cuando ni siquiera existe.
  guardarHuella(absReady, (await huellaDeDrive(fileId)) ?? "");

  return {
    abs_path: absReady,
    rel_path: relReady.replaceAll("\\", "/"),
    mime: targetMime,
  };
}
