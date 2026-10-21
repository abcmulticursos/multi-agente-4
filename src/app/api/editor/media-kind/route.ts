import { NextRequest, NextResponse } from "next/server";

/**
 * "restricted" = Drive CONTESTÓ y dijo que no. No es lo mismo que "unknown",
 * que significa «no pude comprobarlo» — sin internet, Drive caído, o tardó más
 * de los 6 segundos. Juntarlos daría falsas alarmas justo en el peor momento.
 */
type MediaKind =
  | "image"
  | "audio"
  | "video"
  | "document"
  | "restricted"
  | "unknown";

function extractDriveFileId(url: string): string | null {
  const byPath = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (byPath) return byPath[1];
  const byQuery = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return byQuery?.[1] ?? null;
}

function kindFromMime(mime: string): MediaKind {
  const clean = mime.split(";")[0]?.trim().toLowerCase() ?? "";
  if (clean.startsWith("image/")) return "image";
  if (clean.startsWith("video/")) return "video";
  if (clean.startsWith("audio/")) return "audio";
  if (clean === "application/pdf") return "document";
  return "unknown";
}

export async function GET(req: NextRequest) {
  const rawUrl = req.nextUrl.searchParams.get("url")?.trim() ?? "";
  if (!rawUrl) {
    return NextResponse.json({ kind: "unknown" satisfies MediaKind });
  }

  const fileId = extractDriveFileId(rawUrl);
  const targetUrl = fileId
    ? `https://drive.google.com/uc?export=download&id=${fileId}`
    : rawUrl;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);

  try {
    const res = await fetch(targetUrl, {
      redirect: "follow",
      headers: { Range: "bytes=0-0" },
      signal: controller.signal,
    });
    res.body?.cancel().catch(() => {});
    const mime = res.headers.get("content-type") ?? "";

    /**
     * ¿EL ARCHIVO ESTÁ RESTRINGIDO EN DRIVE?
     *
     * Lo pidió el dueño el 21 de septiembre de 2026: «acabo de ver que agregué
     * una imagen y no cargaba, y era porque la imagen de Drive estaba
     * restringida. ¿Hay manera de avisar que está restringida, y que no sea
     * falsa alarma?».
     *
     * NO SE ADIVINA POR LA DIRECCIÓN: se le pide el archivo a Drive y se mira
     * qué contesta. Un archivo compartido devuelve la imagen; uno restringido
     * manda a iniciar sesión.
     *
     * Y AQUÍ ESTÁ LA TRAMPA QUE HAY QUE ESQUIVAR, que es lo que él pidió: un
     * archivo PÚBLICO pero grande también devuelve una página web —la del aviso
     * de antivirus de Drive—. Si se avisara por «me llegó HTML», ese caso daría
     * falsa alarma y el aviso dejaría de creerse.
     *
     * Por eso solo se avisa con las dos señales que NO admiten otra lectura:
     *
     *   · Drive contestó 401 o 403 — te está negando el archivo.
     *   · O acabó mandándote a `accounts.google.com` — te pide iniciar sesión.
     *
     * Cualquier otra respuesta rara se queda en "unknown", que es «no lo sé» y
     * no asusta a nadie.
     */
    const esHtml = mime.split(";")[0]?.trim().toLowerCase() === "text/html";
    const teMandaAIniciarSesion = (() => {
      try {
        return new URL(res.url).hostname.endsWith("accounts.google.com");
      } catch {
        return false;
      }
    })();
    if (res.status === 401 || res.status === 403 || (esHtml && teMandaAIniciarSesion)) {
      return NextResponse.json({
        kind: "restricted" satisfies MediaKind,
        mime,
        status: res.status,
      });
    }

    return NextResponse.json({ kind: kindFromMime(mime), mime });
  } catch {
    // No hubo respuesta. Eso NO es «restringido»: es «no pude comprobarlo».
    return NextResponse.json({ kind: "unknown" satisfies MediaKind });
  } finally {
    clearTimeout(timeout);
  }
}
