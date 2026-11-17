import { NextResponse } from "next/server";
import { getMetaRuntimeSetting, listMetaConnections, listMetaWhatsAppConnections } from "@/lib/db";
import { getCapiPixelId } from "@/lib/meta/runtime-config";
import { loadWorkflowConfig } from "@/lib/workflow/config";
import { COUNTRIES, type CountryCode } from "@/lib/countries";

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

  // (16/11/2026) UNA FILA POR PAÍS DE CADA TIENDA: lo de toda la tienda ya no cuenta (`sinLoGeneralDeLasTiendas`), así que
  // el número, la página y el píxel son los de cada país (`por_pais`). Sin ningún país puesto, una fila vacía.
  const tiendas = (loadWorkflowConfig()?.tiendas ?? [])
    .filter((t) => t && t.enabled !== false)
    .flatMap((t) => {
      const grupos = Object.entries(t.por_pais ?? {});
      const filas: Array<[string | null, { numero?: string; pagina?: string; pixel?: string }]> = grupos.length ? grupos : [[null, {}]];
      return filas.map(([pais, g]) => {
        const numeroId = String(g?.numero ?? "").trim();
        const n = numeroId ? numeros.get(numeroId) : undefined;
        const numero: Pieza = numeroId
          ? { id: numeroId, nombre: n ? [n.display_phone_number, n.verified_name].filter(Boolean).join(" · ") || null : null }
          : null;

        const paginaId = String(g?.pagina ?? "").trim();
        const p = paginaId ? paginas.find((x) => x.page_id === paginaId) : paginaActiva;
        const pagina: Pieza = paginaId && !p ? { id: paginaId, nombre: null } : p ? { id: p.page_id, nombre: p.page_name ?? null, general: !paginaId } : null;

        const pixelId = String(g?.pixel ?? "").trim() || pixelGeneral || "";
        const pixel: Pieza = pixelId ? { id: pixelId, nombre: nombreDelPixel(pixelId), general: !String(g?.pixel ?? "").trim() } : null;

        const nombre = t.nombre?.trim() || "Tienda sin nombre";
        const nombreDelPais = pais ? COUNTRIES[pais as CountryCode]?.label ?? pais : null;
        return {
          id: pais ? `${t.id}|${pais}` : t.id,
          nombre: nombreDelPais ? `${nombre} · ${nombreDelPais}` : nombre,
          color: t.color || null,
          numero,
          pagina,
          pixel,
        };
      });
    });

  return NextResponse.json({ tiendas }, { headers: { "Cache-Control": "no-store" } });
}
