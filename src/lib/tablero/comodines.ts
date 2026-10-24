/**
 * LOS COMODINES DE PRODUCTO Y PRECIO EN EL TABLERO (24/10/2026, solo ALBERTO 4).
 *
 * Lo pidió el dueño al armar sus tiendas de ejemplo: «hazlo con comodines». En la venta de siempre
 * {{PRODUCTO_BASE}}, {{PRECIO_FULL}}… salen de los puestos de la tienda (básico, full, upsell). En el
 * tablero no hay puestos: cada ficha dice qué productos presenta («🏷 Presenta»). Así que aquí esos
 * mismos comodines —escritos igual, para no aprender otros— se llenan con los productos DE ESA FICHA,
 * con el precio del país del cliente:
 *
 *   {{PRODUCTO}} · {{PRECIO_COMPLETO}} · {{PRECIO_MERCADO}}   el primero que presenta la ficha
 *   {{PRODUCTO_UPSELL}} · {{PRECIO_UPSELL}} · {{PRECIO_ANTES_UPSELL}}   también el primero
 *   {{PRODUCTO_BASE}} · {{PRECIO_BASE}} · {{PRECIO_ANTES_BASE}}   el más barato de los que presenta
 *   {{PRODUCTO_FULL}} · {{PRECIO_FULL}} · {{PRECIO_ANTES_FULL}}   el más caro
 *   {{PRECIO_COMPLEMENTARIO}} / {{PRECIO_DIFERENCIA}}   lo que va del barato al caro
 *
 * Con un solo producto, todos son él. Un comodín que no es de producto ({{NOMBRE}}, {{CUENTA_…}},
 * {{LISTA_METODOS_POR_PAIS}}…) no se toca: lo llena el motor de siempre al mandar, como siempre.
 * Sin productos (una ficha que no presenta nada y un cliente al que aún no se le presentó nada) no se
 * toca ninguno.
 */
import { formatCurrencyAmount } from "@/lib/countries";

export interface ProductoConPrecio {
  id: string;
  name: string;
  precio: number | null;
  antes: number | null;
}

/** Las llaves que no son texto para el cliente: no se tocan aunque traigan llaves. */
const NO_SON_TEXTO = new Set(["drive_url", "url", "id", "action", "type", "media_type", "method"]);

function reemplazarEn<T>(valor: T, cambiar: (s: string) => string, llave = ""): T {
  if (typeof valor === "string") return (NO_SON_TEXTO.has(llave) ? valor : cambiar(valor)) as T;
  if (Array.isArray(valor)) return valor.map((v) => reemplazarEn(v, cambiar, llave)) as T;
  if (valor && typeof valor === "object") {
    const fuera: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(valor as Record<string, unknown>)) fuera[k] = reemplazarEn(v, cambiar, k);
    return fuera as T;
  }
  return valor;
}

/** Los comodines de producto de estas burbujas, con los productos de la ficha. */
export function conLosComodinesDeLaFicha<T>(pasos: T, productos: ProductoConPrecio[], pais: string): T {
  const lista = productos.filter((p) => p && p.name);
  if (lista.length === 0) return pasos;
  const primero = lista[0];
  const conPrecio = lista.filter((p) => typeof p.precio === "number");
  const orden = [...(conPrecio.length ? conPrecio : lista)].sort((a, b) => (a.precio ?? 0) - (b.precio ?? 0));
  const base = orden[0];
  const full = orden[orden.length - 1];
  const dinero = (v: number | null | undefined) => (typeof v === "number" && v > 0 ? formatCurrencyAmount(v, pais as never) : "");
  const diferencia = typeof full.precio === "number" && typeof base.precio === "number" ? Math.round((full.precio - base.precio) * 100) / 100 : null;
  const valores: Record<string, string> = {
    PRODUCTO: primero.name,
    PRECIO_COMPLETO: dinero(primero.precio),
    PRECIO_MERCADO: dinero(primero.antes),
    PRODUCTO_UPSELL: primero.name,
    PRECIO_UPSELL: dinero(primero.precio),
    PRECIO_ANTES_UPSELL: dinero(primero.antes),
    PRECIO_MERCADO_UPSELL: dinero(primero.antes),
    PRODUCTO_BASE: base.name,
    PRECIO_BASE: dinero(base.precio),
    PRECIO_ANTES_BASE: dinero(base.antes),
    PRECIO_MERCADO_BASICO: dinero(base.antes),
    PRODUCTO_FULL: full.name,
    PRECIO_FULL: dinero(full.precio),
    PRECIO_ANTES_FULL: dinero(full.antes),
    PRECIO_MERCADO_FULL: dinero(full.antes),
    PRECIO_COMPLEMENTARIO: dinero(diferencia),
    PRECIO_DIFERENCIA: dinero(diferencia),
  };
  const patron = new RegExp(`\\{\\{\\s*(${Object.keys(valores).join("|")})\\s*\\}\\}`, "gi");
  return reemplazarEn(pasos, (s) => s.replace(patron, (_, k: string) => valores[k.toUpperCase()] ?? ""));
}
