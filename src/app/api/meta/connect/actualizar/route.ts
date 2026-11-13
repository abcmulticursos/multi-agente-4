import { NextResponse } from "next/server";
import { actualizarCuentas } from "@/lib/meta/actualizar-cuentas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * «↻ ACTUALIZAR» (13/11/2026): vuelve a leer de Meta las páginas, números, negocios y píxeles de cada cuenta
 * conectada, con el permiso ya guardado, sin abrir Facebook. Ver `actualizarCuentas`.
 */
export async function POST() {
  const cuentas = await actualizarCuentas();
  return NextResponse.json({
    ok: cuentas.length > 0 && cuentas.every((c) => c.ok),
    cuentas: cuentas.map(({ numerosVistos: _n, paginasVistas: _p, ...c }) => c),
  });
}
