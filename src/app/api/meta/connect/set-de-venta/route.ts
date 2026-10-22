import { NextResponse } from "next/server";
import { getMetaRuntimeSetting, listMetaConnections, listMetaWhatsAppConnections } from "@/lib/db";
import { getCapiPixelId } from "@/lib/meta/runtime-config";
import { loadWorkflowConfig } from "@/lib/workflow/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * EL SET DE VENTA, POR TIENDA (21/10/2026). «Cuidado con el set de ventas, recuerda que es un set
 * de ventas por tienda». Antes se mostraba uno solo: la página, el número y el píxel GENERALES.
 * Ahora, una fila por tienda con los suyos, cada uno con su ID para compararlo con la campaña.
 *
 * Solo lee lo guardado (contenido y Meta Connect): ninguna pregunta a Meta. Una tienda sin página o
 * sin píxel propio usa el general: se dice, porque es con lo que el bot registrará sus compras.
 */
type Pieza = { id: string; nombre: string | null; general?: boolean } | null;

export async function GET() {
  const numeros = new Map(listMetaWhatsAppConnections().map((c) => [c.phone_number_id, c]));
  const paginas = listMetaConnections();
  const paginaActiva = paginas.find((p) => p.active === 1) ?? null;
  let pixeles: Array<{ pixelId: string; name: string | null }> = [];
  try {
    const crudo = getMetaRuntimeSetting("pixels_detectados");
    pixeles = crudo ? (JSON.parse(crudo) as typeof pixeles) : [];
  } catch {
    pixeles = [];
  }
  const pixelGeneral = getCapiPixelId();
  const nombreDelPixel = (id: string) => pixeles.find((p) => p.pixelId === id)?.name ?? null;

  const tiendas = (loadWorkflowConfig()?.tiendas ?? [])
    .filter((t) => t && t.enabled !== false)
    .map((t) => {
      const numeroId = String(t.numero ?? "").trim();
      const n = numeroId ? numeros.get(numeroId) : undefined;
      const numero: Pieza = numeroId
        ? { id: numeroId, nombre: n ? [n.display_phone_number, n.verified_name].filter(Boolean).join(" · ") || null : null }
        : null;

      const paginaId = String(t.pagina ?? "").trim();
      const p = paginaId ? paginas.find((x) => x.page_id === paginaId) : paginaActiva;
      const pagina: Pieza = p ? { id: p.page_id, nombre: p.page_name ?? null, general: !paginaId } : null;

      const pixelId = String(t.pixel ?? "").trim() || pixelGeneral || "";
      const pixel: Pieza = pixelId ? { id: pixelId, nombre: nombreDelPixel(pixelId), general: !String(t.pixel ?? "").trim() } : null;

      return { id: t.id, nombre: t.nombre?.trim() || "Tienda sin nombre", color: t.color || null, numero, pagina, pixel };
    });

  return NextResponse.json({ tiendas }, { headers: { "Cache-Control": "no-store" } });
}
