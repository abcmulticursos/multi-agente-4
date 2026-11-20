import { NextResponse, type NextRequest } from "next/server";
import { checkPassword } from "@/lib/auth";
import { listMetaWhatsAppConnections, vaciarMetaConnect } from "@/lib/db";
import { idsDeNuestrasApps } from "@/lib/meta/apps-de-meta";
import { desenchufarCuentasQueSeDejan, loQueNoSePudo } from "@/lib/meta/desenchufar";
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
  // (19/11/2026) Antes de vaciar, las apps del bot se desconectan EN META de todas sus cuentas de WhatsApp
  // (`desenchufar.ts`): vaciar solo el bot las dejaba conectadas allá. Si Meta no deja, no se vacía a medias.
  if (cuerpo && (cuerpo as { forzar?: unknown }).forzar !== true) {
    const hechos = await desenchufarCuentasQueSeDejan(
      listMetaWhatsAppConnections().map((c) => c.phone_number_id),
      idsDeNuestrasApps()
    );
    if (hechos.some((h) => !h.ok)) {
      return NextResponse.json({ ok: false, enMeta: true, error: `No pude desconectar en Meta:\n${loQueNoSePudo(hechos)}\n\nNo cerré la sesión.` });
    }
  }
  vaciarMetaConnect();
  olvidar();
  console.log("[meta-connect] sesión de Meta cerrada: Meta Connect quedó vacío");
  return NextResponse.json({ ok: true });
}
