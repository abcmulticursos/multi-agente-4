import { NextResponse } from "next/server";
import { estadoDelRespaldo, publicarPendientes } from "@/lib/contenido";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** EL RESPALDO EN GITHUB (30/10/2026): lo que el editor enseña arriba («☁ respaldando…», «☁ ✓»). */
export async function GET() {
  return NextResponse.json(estadoDelRespaldo(), { headers: { "Cache-Control": "no-store" } });
}

/** «Reintentar ahora», desde el aviso amarillo. */
export async function POST() {
  await publicarPendientes();
  return NextResponse.json(estadoDelRespaldo(), { headers: { "Cache-Control": "no-store" } });
}
