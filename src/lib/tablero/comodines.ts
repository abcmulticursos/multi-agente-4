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
  const cambiar = cambiadorDeLaFicha(productos, pais);
  return cambiar ? reemplazarEn(pasos, cambiar) : pasos;
}

/**
 * UN TEXTO, con los comodines de la ficha. Lo usa también el VISOR del editor (24/10/2026): enseñaba
 * el producto de la venta automática —«LECTOESCRITURA» en la ficha de la tienda de cocina— mientras
 * al cliente le llegaba el de la ficha. Con la misma función, no pueden enseñar cosas distintas.
 */
export function comodinesDeLaFichaEnTexto(texto: string, productos: ProductoConPrecio[], pais: string): string {
  const cambiar = cambiadorDeLaFicha(productos, pais);
  return cambiar ? cambiar(texto) : texto;
}

function cambiadorDeLaFicha(productos: ProductoConPrecio[], pais: string): ((s: string) => string) | null {
  const lista = productos.filter((p) => p && p.name);
  if (lista.length === 0) return null;
  const primero = lista[0];
  const conPrecio = lista.filter((p) => typeof p.precio === "number");
  const orden = [...(conPrecio.length ? conPrecio : lista)].sort((a, b) => (a.precio ?? 0) - (b.precio ?? 0));
  const base = orden[0];
  const full = orden[orden.length - 1];
  const dinero = (v: number | null | undefined, forma: "title" | "upper" | "lower" = "title") =>
    typeof v === "number" && v > 0 ? formatCurrencyAmount(v, pais as never, undefined, forma) : "";
  // El número pelado, como el motor de siempre ({{PRECIO_1}}, {{PRECIO_EXTRA}}…: sin moneda).
  const numero = (v: number | null | undefined) =>
    typeof v === "number" && v > 0 ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : "";
  const diferencia = typeof full.precio === "number" && typeof base.precio === "number" ? Math.round((full.precio - base.precio) * 100) / 100 : null;
  // OPCIÓN 1 = el pack (el caro) y OPCIÓN 2 = el básico, como en la venta de siempre; el EXTRA es lo
  // que va de uno al otro. Con sus mismas formas: número, «_COMPLETO», «_MAYUSCULAS», «_MINUSCULAS».
  const formas = (prefijos: string[], v: number | null) =>
    Object.fromEntries(
      prefijos.flatMap((p) => [
        [p, numero(v)],
        [`${p}_COMPLETO`, dinero(v)],
        [`${p}_MAYUSCULAS`, dinero(v, "upper")],
        [`${p}_MINUSCULAS`, dinero(v, "lower")],
      ])
    );
  const valores: Record<string, string> = {
    ...formas(["PRECIO_1", "PRECIO1"], full.precio),
    ...formas(["PRECIO_2", "PRECIO2"], base.precio),
    ...formas(["PRECIO_EXTRA", "PRECIO_ADICIONAL"], diferencia),
    OPCION_1: full.name,
    PRODUCTO_1: full.name,
    OPCION_2: base.name,
    PRODUCTO_2: base.name,
    PRECIO_COMPLETO_MAYUSCULAS: dinero(primero.precio, "upper"),
    PRECIO_COMPLETO_MINUSCULAS: dinero(primero.precio, "lower"),
    PRECIO_UPSELL_COMPLETO: dinero(primero.precio),
    PRECIO_UPSELL_MAYUSCULAS: dinero(primero.precio, "upper"),
    PRECIO_UPSELL_MINUSCULAS: dinero(primero.precio, "lower"),
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
  // Los más largos primero: «PRECIO_1_COMPLETO» no debe tomarse como «PRECIO_1».
  const llaves = Object.keys(valores).sort((a, b) => b.length - a.length);
  const patron = new RegExp(`\\{\\{\\s*(${llaves.join("|")})\\s*\\}\\}`, "gi");
  return (s) => s.replace(patron, (_, k: string) => valores[k.toUpperCase()] ?? "");
}
