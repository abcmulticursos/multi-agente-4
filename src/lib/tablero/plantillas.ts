/**
 * LAS PLANTILLAS DEL TABLERO (01/11/2026). Él: «en n8n se puede importar plantillas… al importar entra
 * toda la conexión o workflow tal como se armó, sin faltar conexiones; entonces la persona solo reemplaza».
 *
 * Una plantilla es una tubería entera (fichas y sus cables de dentro) SIN Inicio. Se trae al lado de lo
 * suyo y sin conectar a ningún país («nada se conecta solo»): él la revisa y le tira el cable desde su
 * Inicio. Las de fábrica viven en `public/plantillas-del-tablero/` (salen de TIENDA PLANTILLAS, ya
 * probada); sus productos van como TOKENS («@BASICO», «@FULL»…) que se cambian por los suyos al traerla,
 * y sus títulos llevan «⟨BASICO⟩» para poner el nombre de su producto. Las suyas se guardan como archivo
 * (clic derecho → «📋 Guardar como plantilla») con sus productos tal cual.
 *
 * Solo datos: el bot no lee esto. Lo que llega al tablero son fichas normales.
 */
import type { CableDelTablero, FichaDelTablero } from "./tipos";

export const FORMATO_DE_PLANTILLA = "plantilla-del-tablero";

export interface ProductoDePlantilla {
  /** Lo que se reemplaza en la plantilla: «@BASICO». */
  token: string;
  /** Cómo se le pide al elegir: «Producto básico». */
  etiqueta: string;
  /** Lo que se pone en los títulos si no se elige nombre: «BÁSICO». */
  nombre?: string;
}

export interface PlantillaDelTablero {
  formato: typeof FORMATO_DE_PLANTILLA;
  version: number;
  id: string;
  nombre: string;
  tipo?: string;
  forma?: string;
  descripcion?: string;
  productos: ProductoDePlantilla[];
  /** Las fichas del upsell: se quitan si no lleva upsell (lo que llegaba a ellas va al Regalo). */
  upsell?: string[];
  /** La ficha del Regalo, si tiene. */
  regalo?: string | null;
  /** La contribución: su cobro abierto, con los montos «@PAIS» de ejemplo. */
  aporte?: { ficha: string; montos_de_ejemplo?: number[] } | null;
  fichas: FichaDelTablero[];
  cables: CableDelTablero[];
}

/** Una fila del índice de las de fábrica. */
export interface PlantillaDelIndice {
  id: string;
  nombre: string;
  tipo: string;
  forma: string;
  descripcion: string;
  fichas: number;
}

export interface EleccionDePlantilla {
  /** token → id de SU producto. */
  productos: Record<string, string>;
  /** token → nombre de SU producto (para los títulos). */
  nombres: Record<string, string>;
  conUpsell: boolean;
  conRegalo: boolean;
  /** «📧 Ofrecer también por correo» en sus Entregas. */
  porCorreo: boolean;
  /** El país de los montos del aporte (contribución). */
  pais?: string;
}

/** ¿Es una plantilla? Devuelve el error para el aviso si no lo es. */
export function leePlantilla(datos: unknown): PlantillaDelTablero | { error: string } {
  const p = datos as Partial<PlantillaDelTablero> | null;
  if (!p || p.formato !== FORMATO_DE_PLANTILLA || !Array.isArray(p.fichas) || !Array.isArray(p.cables))
    return { error: "Este archivo no es una plantilla del tablero." };
  if (p.fichas.filter((f) => f?.tipo !== "inicio").length === 0) return { error: "La plantilla no trae fichas." };
  return { ...(p as PlantillaDelTablero), productos: Array.isArray(p.productos) ? p.productos : [] };
}

/** Lo que falta elegir antes de traerla (sus productos). Vacío = lista. */
export function loQueFaltaElegir(p: PlantillaDelTablero, e: EleccionDePlantilla): string[] {
  const usados = productosQueUsa(p, e);
  return usados.filter((x) => !e.productos[x.token]).map((x) => x.etiqueta);
}

/** Los productos que de verdad usa con esta elección (sin upsell, el del upsell no hace falta). */
export function productosQueUsa(p: PlantillaDelTablero, e: Pick<EleccionDePlantilla, "conUpsell">): ProductoDePlantilla[] {
  const fichas = e.conUpsell ? p.fichas : p.fichas.filter((f) => !(p.upsell ?? []).includes(f.id));
  const texto = JSON.stringify(fichas);
  return p.productos.filter((x) => texto.includes(x.token));
}

/**
 * ARMA LA PLANTILLA con lo elegido: quita el upsell o el regalo si no van, pone el correo, y cambia los
 * tokens por SUS productos. Devuelve fichas y cables con los ids de la plantilla (al ponerlas en el
 * tablero `copiarFichas` les da ids nuevos, también a botones y cuadritos).
 */
export function armarPlantilla(p: PlantillaDelTablero, e: EleccionDePlantilla): { fichas: FichaDelTablero[]; cables: CableDelTablero[] } {
  let fichas: FichaDelTablero[] = JSON.parse(JSON.stringify(p.fichas.filter((f) => f.tipo !== "inicio")));
  let cables: CableDelTablero[] = JSON.parse(JSON.stringify(p.cables));
  const regalo = p.regalo && fichas.some((f) => f.id === p.regalo) ? p.regalo : null;
  // SIN UPSELL: sus fichas se van; lo que llegaba a ellas va al Regalo (o, sin regalo, al mensaje de cierre
  // que queda en su lugar, más abajo).
  const upsell = new Set(e.conUpsell ? [] : p.upsell ?? []);
  if (upsell.size > 0) {
    fichas = fichas.filter((f) => !upsell.has(f.id));
    cables = cables.filter((c) => !upsell.has(c.de)).flatMap((c) => (!upsell.has(c.a) ? [c] : regalo ? [{ ...c, a: regalo }] : []));
  }
  // SIN REGALO: en su lugar queda un mensaje de cierre, con los mismos cables de llegada. Si solo se
  // quitara, el «No, gracias» de un upgrade o el «Si no responde» del upsell quedarían sin cable: un botón
  // que no hace nada (lo cazó la prueba de las 12, 01/11/2026).
  if (regalo && !e.conRegalo) {
    fichas = fichas.map((f) =>
      f.id === regalo
        ? {
            id: f.id,
            tipo: "mensaje",
            titulo: "Fin · gracias",
            x: f.x,
            y: f.y,
            steps: [{ type: "text", body_variants: ["¡Gracias por tu compra! 💛 ✏️ Disfruta mucho tu material."], delay_after_sec: 2 } as never],
          }
        : f
    );
    cables = cables.filter((c) => c.de !== regalo);
  }
  if (e.porCorreo) fichas = fichas.map((f) => (f.tipo === "entregar" ? { ...f, por_correo: true } : f));
  // Los tokens: «@BASICO» → su id; «⟨BASICO⟩» → su nombre; «@PAIS» → el país del aporte.
  let json = JSON.stringify({ fichas, cables });
  for (const x of p.productos) {
    const id = e.productos[x.token];
    if (id) json = json.split(JSON.stringify(x.token).slice(1, -1)).join(JSON.stringify(id).slice(1, -1));
    const sinArroba = x.token.replace(/^@/, "");
    const nombre = (e.nombres[x.token] ?? "").trim() || x.nombre || sinArroba;
    json = json.split(`⟨${sinArroba}⟩`).join(JSON.stringify(nombre).slice(1, -1));
  }
  if (e.pais) json = json.split('"@PAIS"').join(JSON.stringify(e.pais));
  return JSON.parse(json);
}

/**
 * SUS FICHAS COMO PLANTILLA (clic derecho → «📋 Guardar como plantilla»): las elegidas (sin Inicio) y sus
 * cables de dentro, con la esquina en 0,0. Sus productos van tal cual: al traerla en su tablero, cobran y
 * entregan lo mismo.
 */
export function plantillaDeFichas(
  t: { fichas: Array<{ id: string; tipo: string; x: number; y: number }>; cables: CableDelTablero[] },
  ids: string[],
  nombre: string
): PlantillaDelTablero {
  const elegidas = new Set(ids);
  const fichas = t.fichas.filter((f) => elegidas.has(f.id) && f.tipo !== "inicio");
  const quedan = new Set(fichas.map((f) => f.id));
  const minX = Math.min(...fichas.map((f) => f.x));
  const minY = Math.min(...fichas.map((f) => f.y));
  return {
    formato: FORMATO_DE_PLANTILLA,
    version: 1,
    id: `propia-${Date.now().toString(36)}`,
    nombre,
    productos: [],
    fichas: JSON.parse(JSON.stringify(fichas.map((f) => ({ ...f, x: Math.round(f.x - minX), y: Math.round(f.y - minY) })))),
    cables: JSON.parse(JSON.stringify(t.cables.filter((c) => quedan.has(c.de) && quedan.has(c.a)))),
  };
}
