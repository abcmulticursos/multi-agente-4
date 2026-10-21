import { NextResponse, type NextRequest } from "next/server";
import {
  deleteQuickReply,
  getQuickReplyById,
  updateQuickReply,
  type QuickReplyMedia,
} from "@/lib/db";
import { borrarAdjunto, guardarAdjunto } from "@/lib/quick-reply-media";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const actual = getQuickReplyById(id);
  if (!actual) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const esFormulario = (req.headers.get("content-type") ?? "").includes(
    "multipart/form-data"
  );

  let shortcut: string | null = null;
  let content = "";
  let file: File | null = null;
  // "quitar" solo llega cuando el usuario pulsa la X del adjunto.
  let quitarAdjunto = false;

  if (esFormulario) {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json({ error: "bad form" }, { status: 400 });
    }
    const s = form.get("shortcut");
    const c = form.get("content");
    shortcut = typeof s === "string" && s.trim() ? s.trim() : null;
    content = typeof c === "string" ? c.trim() : "";
    const f = form.get("file");
    if (f instanceof File && f.size > 0) file = f;
    quitarAdjunto = form.get("quitar_adjunto") === "1";
  } else {
    let body: { shortcut?: string; content?: string };
    try {
      body = (await req.json()) as { shortcut?: string; content?: string };
    } catch {
      return NextResponse.json({ error: "bad json" }, { status: 400 });
    }
    shortcut = body.shortcut?.trim() || null;
    content = body.content?.trim() ?? "";
  }

  // Qué adjunto queda: el nuevo, ninguno, o el que ya tenía.
  let media: QuickReplyMedia | null;
  try {
    if (file) {
      media = await guardarAdjunto(file);
      borrarAdjunto(actual.media_url); // el anterior ya no se usa
    } else if (quitarAdjunto) {
      borrarAdjunto(actual.media_url);
      media = null;
    } else if (actual.media_type && actual.media_url && actual.media_mime) {
      media = {
        media_type: actual.media_type,
        media_url: actual.media_url,
        media_mime: actual.media_mime,
        media_filename: actual.media_filename,
      };
    } else {
      media = null;
    }
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : String(err);
    console.error("[quick-replies] no pude guardar el adjunto:", err);
    return NextResponse.json({ error: mensaje }, { status: 400 });
  }

  if (!content && !media) {
    return NextResponse.json(
      { error: "Escribe un texto o adjunta un archivo" },
      { status: 400 }
    );
  }

  const ok = updateQuickReply(id, shortcut, content, media);
  if (!ok) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  // El archivo se borra con la respuesta: si no, quedaria ocupando espacio sin
  // que nada lo apunte.
  const actual = getQuickReplyById(id);
  const ok = deleteQuickReply(id);
  if (!ok) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  borrarAdjunto(actual?.media_url ?? null);
  return NextResponse.json({ ok: true });
}
