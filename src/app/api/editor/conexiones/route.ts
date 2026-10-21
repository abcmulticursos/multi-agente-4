import { NextResponse } from "next/server";
import { loConectado } from "@/lib/meta/lo-conectado";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * LO QUE YA ESTÁ CONECTADO, para los tres selectores del pop up Tiendas.
 *
 * La lista se arma en `src/lib/meta/lo-conectado.ts`, que es donde está contado el
 * porqué de cada campo. Vive allí porque las tarjetas por cuenta de Meta Connect leen
 * la misma, y dos pantallas que muestran la misma cosa no pueden armarla cada una a
 * su manera.
 */
export async function GET() {
  return NextResponse.json(loConectado());
}
