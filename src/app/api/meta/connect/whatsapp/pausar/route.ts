import { NextResponse, type NextRequest } from "next/server";
import { getMetaWhatsAppConnection, pausarNumero } from "@/lib/db";
import { olvidar } from "@/lib/meta/recuerdo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * PAUSAR O REANUDAR UN NÚMERO EN ESTE PROYECTO (21/10/2026). «No hay manera de en vez de quitarlo
 * deshabilitarlo?». Pausado, este bot ignora sus mensajes (ver `handler.ts`); sigue en la lista,
 * iniciar sesión no lo reactiva y se reanuda con un clic. En Meta no cambia nada.
 */
export async function POST(req: NextRequest) {
  const cuerpo = (await req.json().catch(() => null)) as { phoneNumberId?: unknown; pausado?: unknown } | null;
  const id = typeof cuerpo?.phoneNumberId === "string" ? cuerpo.phoneNumberId.trim() : "";
  if (!id || !getMetaWhatsAppConnection(id)) {
    return NextResponse.json({ ok: false, error: "Ese número no está en este proyecto." }, { status: 404 });
  }
  pausarNumero(id, cuerpo?.pausado === true);
  olvidar("token-estado");
  return NextResponse.json({ ok: true });
}
