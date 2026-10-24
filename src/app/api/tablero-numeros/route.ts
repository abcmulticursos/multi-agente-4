import { NextResponse, type NextRequest } from "next/server";
import { numerosDelTablero } from "@/lib/tablero/estado";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * LOS NÚMEROS DEL TABLERO DE UNA TIENDA (25/10/2026): por ficha, cuántos clientes llegaron y cuántos
 * pagaron. Como los de las rutas de la pizarra. Solo lectura; sin las pruebas del simulador.
 */
export async function GET(req: NextRequest) {
  const tienda = req.nextUrl.searchParams.get("tienda") ?? "";
  if (!tienda) return NextResponse.json({ error: "Falta la tienda" }, { status: 400 });
  return NextResponse.json({ numeros: numerosDelTablero(tienda) });
}
