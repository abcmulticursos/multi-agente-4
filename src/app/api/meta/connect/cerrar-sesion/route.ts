import { NextResponse, type NextRequest } from "next/server";
import { checkPassword } from "@/lib/auth";
import { vaciarMetaConnect } from "@/lib/db";
import { olvidar } from "@/lib/meta/recuerdo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * CERRAR SESIÓN DE META (21/10/2026): deja Meta Connect vacío para conectar otra app.
 *
 * Es lo único de Meta Connect que apaga el bot entero (sin app ni números no contesta a nadie),
 * así que pide DOS cosas: la contraseña del CRM y la palabra CERRAR. Ver `vaciarMetaConnect`.
 */
export async function POST(req: NextRequest) {
  const cuerpo = (await req.json().catch(() => null)) as { clave?: unknown; palabra?: unknown } | null;
  const clave = typeof cuerpo?.clave === "string" ? cuerpo.clave : "";
  const palabra = typeof cuerpo?.palabra === "string" ? cuerpo.palabra.trim().toUpperCase() : "";
  if (palabra !== "CERRAR") return NextResponse.json({ ok: false, error: "Escribe CERRAR para confirmar." });
  if (!checkPassword(clave)) return NextResponse.json({ ok: false, error: "La contraseña del CRM no es correcta." });
  vaciarMetaConnect();
  olvidar();
  console.log("[meta-connect] sesión de Meta cerrada: Meta Connect quedó vacío");
  return NextResponse.json({ ok: true });
}
