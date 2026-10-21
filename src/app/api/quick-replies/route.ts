import { NextResponse, type NextRequest } from "next/server";
import { createQuickReply, listQuickReplies } from "@/lib/db";
import { guardarAdjunto } from "@/lib/quick-reply-media";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  return NextResponse.json(
    { quickReplies: listQuickReplies() },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(req: NextRequest) {
  // Llega como formulario porque puede traer un archivo adjunto. Las peticiones
  // en JSON de antes se siguen aceptando, para no romper nada que las use.
  const esFormulario = (req.headers.get("content-type") ?? "").includes(
    "multipart/form-data"
  );

  let shortcut: string | null = null;
  let content = "";
  let file: File | null = null;

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

  // Con adjunto, el texto es opcional: se puede mandar solo la imagen.
  if (!content && !file) {
    return NextResponse.json(
      { error: "Escribe un texto o adjunta un archivo" },
      { status: 400 }
    );
  }

  try {
    const media = file ? await guardarAdjunto(file) : null;
    const row = createQuickReply(shortcut, content, media);
    return NextResponse.json({ ok: true, quickReply: row });
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : String(err);
    console.error("[quick-replies] no pude crear:", err);
    return NextResponse.json({ error: mensaje }, { status: 400 });
  }
}
