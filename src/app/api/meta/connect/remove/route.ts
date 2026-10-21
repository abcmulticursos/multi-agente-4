import { NextResponse, type NextRequest } from "next/server";
import { removeMetaConnection, removeMetaWhatsAppConnection } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    type?: string;
    id?: string;
  } | null;
  const id = body?.id?.trim();
  if (!id || (body?.type !== "page" && body?.type !== "whatsapp")) {
    return NextResponse.json({ ok: false, error: "Conexion invalida." }, { status: 400 });
  }
  const removed =
    body.type === "page"
      ? removeMetaConnection(id)
      : removeMetaWhatsAppConnection(id);
  return NextResponse.json({ ok: removed, error: removed ? undefined : "Conexion no encontrada." });
}
