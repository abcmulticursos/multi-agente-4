import { NextResponse } from "next/server";
import { leerRegistroDeMeta } from "@/lib/meta/registro";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Los últimos fallos de Meta Connect, para el recuadro «📋 Registro» (ver `lib/meta/registro.ts`). */
export async function GET() {
  return NextResponse.json({ fallos: leerRegistroDeMeta() }, { headers: { "Cache-Control": "no-store" } });
}
