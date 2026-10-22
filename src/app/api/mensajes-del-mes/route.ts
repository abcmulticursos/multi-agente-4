import { NextResponse } from "next/server";
import { listMetaWhatsAppConnections, mensajesDelMesDelNumero } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * CUÁNTOS MENSAJES LLEVA CADA NÚMERO ESTE MES (22/10/2026), para Ajustes: el tope de los
 * orgánicos se mide contra esto. Cuenta nuestra, no la de Meta. Solo lee la base.
 */
export async function GET() {
  const numeros = listMetaWhatsAppConnections().map((n) => ({
    telefono: n.display_phone_number ?? n.phone_number_id,
    pausado: n.pausado === 1,
    usados: mensajesDelMesDelNumero(n.phone_number_id),
  }));
  return NextResponse.json({ numeros }, { headers: { "Cache-Control": "no-store" } });
}
