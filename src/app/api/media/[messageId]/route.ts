import { NextResponse, type NextRequest } from "next/server";
import fs from "node:fs";
import { Readable } from "node:stream";
import { getMessageById } from "@/lib/db";
import { resolveMediaAbsPath } from "@/lib/meta/media";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface Ctx {
  params: Promise<{ messageId: string }>;
}

function toWebStream(path: string, start?: number, end?: number): ReadableStream {
  return Readable.toWeb(fs.createReadStream(path, { start, end })) as ReadableStream;
}

export async function GET(req: NextRequest, { params }: Ctx) {
  const { messageId } = await params;
  const id = Number(messageId);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const msg = getMessageById(id);
  if (!msg || !msg.media_url || !msg.media_mime) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  let absPath: string;
  try {
    absPath = resolveMediaAbsPath(msg.media_url);
  } catch {
    return NextResponse.json({ error: "invalid path" }, { status: 400 });
  }

  if (!fs.existsSync(absPath)) {
    return NextResponse.json({ error: "file missing" }, { status: 404 });
  }

  const fileSize = fs.statSync(absPath).size;
  const headers: Record<string, string> = {
    "Content-Type": msg.media_mime,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
  };
  if (msg.media_filename) {
    // Los nombres de archivo pueden traer acentos, ñ o emojis — esos
    // caracteres NO son válidos en un header HTTP crudo y rompían con
    // HTTP 500. Solución estándar (RFC 6266):
    //  - filename="..."   → versión ASCII de respaldo (clientes viejos)
    //  - filename*=UTF-8' → versión real percent-encoded (navegadores actuales)
    const asciiFallback = msg.media_filename
      .replace(/[^\x20-\x7E]/g, "_")
      .replace(/["\\]/g, "");
    const utf8Name = encodeURIComponent(msg.media_filename);
    headers["Content-Disposition"] =
      `inline; filename="${asciiFallback}"; filename*=UTF-8''${utf8Name}`;
  }

  const range = req.headers.get("range");
  if (!range) {
    headers["Content-Length"] = String(fileSize);
    return new NextResponse(toWebStream(absPath), { status: 200, headers });
  }

  // El reproductor HTML solicita fragmentos concretos al avanzar o retroceder.
  // Responder 206 + Content-Range permite seek sin descargar el video entero.
  const match = /^bytes=(\d*)-(\d*)$/i.exec(range.trim());
  if (!match || fileSize <= 0) {
    return new NextResponse(null, {
      status: 416,
      headers: { ...headers, "Content-Range": `bytes */${fileSize}` },
    });
  }

  const [, rawStart, rawEnd] = match;
  let start: number;
  let end: number;
  if (!rawStart) {
    const suffixLength = Number(rawEnd);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return new NextResponse(null, {
        status: 416,
        headers: { ...headers, "Content-Range": `bytes */${fileSize}` },
      });
    }
    start = Math.max(fileSize - suffixLength, 0);
    end = fileSize - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd ? Math.min(Number(rawEnd), fileSize - 1) : fileSize - 1;
  }

  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= fileSize ||
    end < start
  ) {
    return new NextResponse(null, {
      status: 416,
      headers: { ...headers, "Content-Range": `bytes */${fileSize}` },
    });
  }

  headers["Content-Length"] = String(end - start + 1);
  headers["Content-Range"] = `bytes ${start}-${end}/${fileSize}`;
  return new NextResponse(toWebStream(absPath, start, end), {
    status: 206,
    headers,
  });
}
