"use client";

/**
 * EL LIENZO DEL TABLERO — la pizarra que manda (22-23/10/2026, solo ALBERTO 4).
 *
 * Él lo pidió así: «yo necesito replicar la pizarra, mismos cables, mismo todo». Así que se ve y se
 * maneja como la pizarra —sus colores, sus fichas de 250 px con franja, el Inicio de cada país con
 * su fondo, los cables punteados que se estiran como goma, la ✕ al pasar el ratón, las cajas, el
 * clic derecho, copiar y pegar, las fichas apagadas tenues en su sitio y «Fichas guardadas»—, pero
 * aquí LOS CABLES SON LAS ÓRDENES: el bot sigue exactamente lo que se dibuja.
 *
 * Este archivo no guarda nada: cada cambio se lo pide al editor por `onCambiar`, que escribe en el
 * mismo borrador que los menús (Ctrl+S guarda, Ctrl+Z deshace).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  getBezierPath,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  SelectionMode,
  useInternalNode,
  useNodes,
  useNodesState,
  useReactFlow,
  useStore,
  useStoreApi,
  ViewportPortal,
  type ConnectionLineComponentProps,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { createPortal } from "react-dom";
import { avisosDeLaFicha, BASICO_DE_LA_TIENDA, cobraEnLaFicha, eligeDeLaFicha, entregasDeLaFicha, FULL_DE_LA_TIENDA, minutosLegibles, opcionesDe, pasosDeLaFicha, pideElNombre, productosQueCobraLaFicha, salidasDeLaFicha, unaEntregaLoEspera } from "@/lib/tablero/datos";
import type { CableDelTablero, FichaDelTablero, Tablero, TipoDeFicha } from "@/lib/tablero/tipos";
import { pasarAVoseo, pasosConVoseo, textosDeLosPasos, type ModoDeVoseo } from "@/lib/voseo";
import { banderaDe } from "@/components/pizarra/banderas";
import { COUNTRIES, type CountryCode } from "@/lib/countries";
import { ASPECTO, TIPOS_PARA_CREAR } from "./aspecto";
import { copiarFichas, mantaPara, rutaDe } from "@/lib/tablero/copiar";
import { hayVentanaAbierta } from "@/lib/escape-en-pila";
import { encajarEnLaPantalla } from "@/lib/encajar-en-pantalla";
export { copiarFichas, mantaPara };

/** El tablero tal como lo tiene el editor: igual que el del bot, con las burbujas del editor. */
/** Una versión, como la tiene el editor (con sus etiquetas de anuncios). */
export type VersionEnElEditor = { id: string; nombre?: string; peso?: number; steps?: unknown[]; anuncios?: string[]; dirigir?: boolean };
export interface FichaEnElEditor extends Omit<FichaDelTablero, "steps" | "variantes" | "seguimientos"> {
  steps?: unknown[];
  variantes?: VersionEnElEditor[];
  seguimientos?: Array<{
    id: string;
    minutos: number;
    activa_oferta?: boolean;
    ignora_silencio?: boolean;
    ignora_tardio?: boolean;
    variantes: VersionEnElEditor[];
  }>;
}
export interface TableroEnElEditor extends Omit<Tablero, "fichas"> {
  fichas: FichaEnElEditor[];
}

type Punto = { x: number; y: number };

/**
 * DUPLICAR SIN ENCIMARSE (13/11/2026). Él: «cuando vuelvo a duplicar esa misma ficha, cae encima… que también haya un
 * movimiento abajo a la derecha». Si donde caería la copia ya hay una ficha, baja un paso más (40 px abajo a la derecha)
 * hasta un sitio libre. Devuelve el desplazamiento a usar.
 */
function sinEncimarse(fichas: Array<{ x: number; y: number }>, f: { x: number; y: number }, d: Punto): Punto {
  let { x, y } = d;
  for (let k = 0; k < 60 && fichas.some((o) => Math.abs(o.x - (f.x + x)) < 20 && Math.abs(o.y - (f.y + y)) < 20); k++) {
    x += 40;
    y += 40;
  }
  return { x, y };
}
type BurbujaDelEditor = { type?: string; texts?: string[]; enabled?: boolean; delay_after_sec?: number; buttons?: unknown[]; decisions?: unknown[] };

const TEMA = {
  claro: { fondo: "#f4f6fa", puntos: "#c3cad6", caja: "rgba(15,23,42,0.08)", tituloCaja: "#334155" },
  oscuro: { fondo: "#15161a", puntos: "#34373f", caja: "rgba(255,255,255,0.13)", tituloCaja: "#f1f5f9" },
};
/** El brillo del 🪞 espejo: dos halos, cian y fucsia, como un letrero de neón. */
// (13/11/2026: más encendido; él no distinguía los espejos de las demás fichas.)
const ESPEJO_NEON = "0 0 0 2px #67e8f9, 0 0 14px 4px rgba(34,211,238,1), 0 0 36px 10px rgba(217,70,239,0.6)";
const PUNTO_VERDE ="!h-[21px] !w-[21px] !border-2 !border-white !bg-emerald-500";
const PUNTO_NARANJA = "!h-[21px] !w-[21px] !border-2 !border-white !bg-orange-500";
/** Los conectores del 🔀 Ruteador (03/11/2026: «sus conectores rosa»). */
const PUNTO_ROSA = "!h-[21px] !w-[21px] !border-2 !border-white !bg-fuchsia-600";
/** El de una ruta apagada del Ruteador (11/11/2026): rojo, como su cable. */
const PUNTO_ROJO = "!h-[21px] !w-[21px] !border-2 !border-white !bg-red-600";
/** El punto de un «💰 Si paga» que ENTREGA SOLO (02/11/2026, su montaje): más grande, blanco con borde verde y el ícono. */
const PUNTO_DE_ENTREGA = "!flex !h-[50px] !w-[50px] !items-center !justify-center !rounded-full !border-[4px] !border-emerald-500 !bg-white !text-[27px] !leading-none shadow-md";
/** Clave con la que el editor pasa el producto full de la tienda dentro de `nombres` (solo pantalla). */
export const ID_DEL_FULL_DE_LA_TIENDA = "@tienda:full:id";
export const ID_DEL_BASICO_DE_LA_TIENDA = "@tienda:basico:id";

/**
 * EL ÍCONO DE LA ENTREGA AUTOMÁTICA (02/11/2026). Él: «el conector debe cambiar de apariencia cuando es entrega
 * automática»: en el «💰 Si paga» de una ficha que no es Cobro (entrega el producto ella misma). 📦 si es el full de la
 * tienda; 🛍️ si la ficha es un upsell; 📚 los demás. En las demás salidas, nada (el punto naranja de siempre).
 */
function iconoDeEntrega(f: FichaEnElEditor, clave: string, t: TableroEnElEditor, nombres: Record<string, string>, esUpsell: boolean): string | null {
  if (clave !== "pagado" && !clave.startsWith("prod:")) return null;
  // EL COBRO ENTREGA SOLO (06/11/2026): su «Pagó» lleva el ícono cuando entrega él, es decir, cuando ninguna Entregar de ese
  // producto lo espera (por su cable, o sin cable en su ruta: ahí se dibuja «↺ → N»). La contribución, no (entrega por tramos).
  if (f.tipo === "cobro") {
    if (f.cobro?.modo !== "producto") return null;
    const pidDelCobro = clave === "pagado" ? f.cobro?.producto_id : clave.slice(5);
    if (!pidDelCobro) return null;
    const cable = t.cables.find((c) => c.de === f.id && c.salida === clave);
    if (cable ? unaEntregaLoEspera(t as Tablero, cable.a, pidDelCobro) : aDondeVaSolo(f, clave, t)) return null;
    if (pidDelCobro === FULL_DE_LA_TIENDA || (!!nombres[ID_DEL_FULL_DE_LA_TIENDA] && pidDelCobro === nombres[ID_DEL_FULL_DE_LA_TIENDA])) return "📦";
    return esUpsell ? "🛍️" : "📚";
  }
  const pid = clave === "pagado" ? productosQueCobraLaFicha(f as FichaDelTablero, t as Tablero)[0] : clave.slice(5);
  if (!pid) return null;
  if (pid === FULL_DE_LA_TIENDA || (!!nombres[ID_DEL_FULL_DE_LA_TIENDA] && pid === nombres[ID_DEL_FULL_DE_LA_TIENDA])) return "📦";
  return esUpsell ? "🛍️" : "📚";
}
/**
 * A DÓNDE VA SOLO (05/11/2026). Él: «yo no soy adivino… en el workflow debe indicar claramente qué va a pasar luego de cada
 * paso». El «Pagó» / «💰 Si paga» SIN CABLE no deja al cliente parado: el motor lo lleva a la Entrega de ese producto en su
 * misma ruta (`entregaDelProductoEnSuRuta`). Aquí, la misma búsqueda, para dibujarla como colita «↺ → N» con el color de
 * esa ficha (no un cable largo: «me descuadran»). Solo dibujo.
 */
function aDondeVaSolo(f: FichaEnElEditor, clave: string, t: TableroEnElEditor): FichaEnElEditor | null {
  if (f.tipo === "entregar" || (clave !== "pagado" && !clave.startsWith("prod:"))) return null;
  const pid = clave.startsWith("prod:") ? clave.slice(5) : f.tipo === "cobro" ? f.cobro?.producto_id : productosQueCobraLaFicha(f as FichaDelTablero, t as Tablero)[0];
  if (!pid) return null;
  const alcanzables = (desde: string[]) => {
    const vistas = new Set(desde);
    const cola = [...desde];
    for (let i = 0; i < cola.length; i++) for (const c of t.cables) if (c.de === cola[i] && !vistas.has(c.a)) (vistas.add(c.a), cola.push(c.a));
    return cola;
  };
  const esLaSuya = (id: string) => {
    const x = t.fichas.find((y) => y.id === id);
    return x?.tipo === "entregar" && !x.apagada && entregasDeLaFicha(x as FichaDelTablero).includes(pid) ? x : null;
  };
  for (const id of alcanzables([f.id])) {
    const x = esLaSuya(id);
    if (x) return x;
  }
  const inicios = t.fichas.filter((x) => x.tipo === "inicio" && alcanzables([x.id]).includes(f.id)).map((x) => x.id);
  for (const id of alcanzables(inicios)) {
    const x = esLaSuya(id);
    if (x) return x;
  }
  return null;
}

/**
 * EL BOTÓN DE UN SEGUIMIENTO SIN CABLE, POR SU NOMBRE (13/11/2026). Él: «¿por qué no puede elegir sin conectar? si ya
 * está escrito el nombre en el botón». El motor ya lo hace: tocarlo vale como escribir su texto, y su master lo lleva
 * por el producto que nombra. Aquí, a dónde: la opción de su master (o el Cobro del que cuelga) cuyo texto o producto
 * comparte una palabra que NINGUNA otra tiene («super», «pack», «solo»). Una sola = ésa; ninguna o empate = null.
 */
function aDondeVaPorSuNombre(t: TableroEnElEditor, seg: FichaEnElEditor, etiqueta: string, nombres: Record<string, string>): FichaEnElEditor | null {
  if (seg.tipo !== "seguimientos") return null;
  const palabras = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{Mn}/gu, "")
        .replace(/[^a-z0-9ñ]+/g, " ")
        .split(" ")
        .filter((w) => w.length >= 3 && !["los", "las", "del", "con", "por", "para", "que", "una", "uno"].includes(w))
    );
  const textos = new Map<string, { destino: FichaEnElEditor; texto: string }>();
  const sumar = (destino: FichaEnElEditor, texto: string) => {
    const antes = textos.get(destino.id);
    textos.set(destino.id, { destino, texto: `${antes?.texto ?? ""} ${texto}` });
  };
  const padres = t.cables
    .filter((c) => c.a === seg.id && (c.salida === "siguiente" || c.salida === "sin_respuesta" || c.salida === "sin_pago"))
    .map((c) => t.fichas.find((x) => x.id === c.de))
    .filter((x): x is FichaEnElEditor => !!x && !x.guardada);
  for (const p of padres) {
    if (p.tipo === "cobro") {
      sumar(p, nombres[p.cobro?.producto_id ?? ""] ?? "");
      continue;
    }
    const { botones, cuadritos } = opcionesDe(pasosDeLaFicha(p as FichaDelTablero));
    for (const c of t.cables) {
      if (c.de !== p.id) continue;
      const d = t.fichas.find((x) => x.id === c.a);
      if (!d || (d.tipo !== "cobro" && d.tipo !== "intro_ob")) continue;
      const b = botones.find((x) => `btn:${x.id}` === c.salida);
      const q = cuadritos.find((x) => `dec:${x.id}` === c.salida);
      const e = c.salida.startsWith("elige:") ? nombres[c.salida.slice(6)] : undefined;
      if (!b && !q && !e) continue;
      sumar(d, [b?.label, q?.title, e, d.tipo === "cobro" ? nombres[d.cobro?.producto_id ?? ""] : ""].filter(Boolean).join(" "));
    }
  }
  const lista = [...textos.values()].map((x) => ({ ...x, w: palabras(x.texto) }));
  const dichas = palabras(etiqueta);
  const conUnica = lista.filter((x) => [...dichas].some((w) => x.w.has(w) && lista.every((o) => o === x || !o.w.has(w))));
  return conUnica.length === 1 ? conUnica[0].destino : null;
}

const ICONO: Record<string, string> = { text: "💬", image: "🖼️", video: "🎬", audio: "🎤", document: "📄" };
const ESQUINAS = ["top-left", "top-right", "bottom-left", "bottom-right"] as const;
const BURBUJAS_A_LA_VISTA = 5;

/** Lo que hay dentro de una ficha, en filas cortas como en la pizarra. */
function resumenDeBurbujas(pasos: unknown[] | undefined): Array<{ icono: string; texto: string; espera: number; indice: number }> {
  return ((pasos ?? []) as BurbujaDelEditor[])
    .map((s, indice) => ({ s, indice }))
    .filter(({ s }) => s?.enabled !== false)
    .map(({ s, indice }) => ({
      icono: ICONO[s.type ?? "text"] ?? "💬",
      texto: (s.texts ?? []).find((t) => t?.trim())?.trim() ?? "",
      espera: Number(s.delay_after_sec ?? 0) || 0,
      // Su lugar entre TODAS las burbujas (también las apagadas): para abrir la ficha en ella.
      indice,
    }));
}

// ── EL CONTEXTO: lo que los nodos y cables le piden al lienzo ─────────────────

type Menu =
  | { tipo: "ficha"; fichaId: string; espejo?: string }
  | { tipo: "cable"; cableId: string }
  | { tipo: "crear"; donde: Punto; desde?: { ficha: string; salida: string } }
  | { tipo: "conectar"; ficha: string; salida: string; espejo?: string }
  | { tipo: "caja"; cajaId: string };

/**
 * LO QUE NO SE PUEDE CONECTAR (26/10/2026), con su porqué en una línea. Son conexiones que nunca
 * hacen lo que parecen: el cable no se pone.
 */
/**
 * «↓ PAGÓ DE MENOS» SE RESUELVE SOLO (06/11/2026). Él: «esa colita no debería ir, ya que se resuelve solo». Sin cable, el bot le
 * dice cuánto lleva y cuánto falta y espera el resto; en un Cobro de producto no se dibuja, salvo que ya tenga cable (para
 * no perderlo), como «Otra cosa». La contribución conserva su «↓ Menos del mínimo». Solo pantalla.
 */
function menosSeResuelveSolo(f: FichaEnElEditor, clave: string, conCable: Set<string>): boolean {
  return clave === "menos" && f.tipo === "cobro" && f.cobro?.modo === "producto" && !conCable.has("menos");
}

function porQueNoSeConecta(t: TableroEnElEditor, de: string, salida: string, a: string): string | null {
  const origen = t.fichas.find((f) => f.id === de);
  const destino = t.fichas.find((f) => f.id === a);
  if (!origen || !destino) return null;
  if (destino.tipo === "inicio") return "Un cable no puede llegar a un Inicio: el Inicio es donde entra el cliente.";
  // EL COBRO ENTREGA SOLO (06/11/2026): en un Cobro de producto, «Pagó» va a donde siga la venta (el Regalo, el upsell…); la
  // entrega ya la hace él. Él: «ese librito debería poder conectar al regalo, pero no se puede». La contribución, como antes.
  if (
    origen.tipo === "cobro" &&
    origen.cobro?.modo !== "producto" &&
    (salida === "pagado" || salida.startsWith("prod:")) &&
    destino.tipo !== "entregar" &&
    destino.tipo !== "condicion"
  )
    return "«Pagó» va a una Entrega: es lo que recibe el cliente que pagó.";
  if ((origen.tipo === "mensaje" || origen.tipo === "intro_ob") && salida === "siguiente") {
    const { botones, cuadritos } = opcionesDe(pasosDeLaFicha(origen as FichaDelTablero));
    if (botones.length + cuadritos.length > 0 && destino.tipo !== "seguimientos")
      return "«⏳ Seguimientos» solo va a unos Seguimientos. Para llevarlo a otra ficha usa sus botones o cuadritos, o «⏳ Si no responde».";
  }
  if (origen.tipo === "seguimientos" && destino.tipo === "seguimientos")
    return "Unos Seguimientos no llevan a otros: los seguimientos ya enviados no se repiten.";
  // DOS RUTAS DE UN REPARTO A LA MISMA FICHA (27/10/2026): sería como no sortear.
  if (origen.tipo === "reparto" && t.cables.some((c) => c.de === de && c.salida !== salida && c.a === a))
    return "Esa ficha ya tiene su ruta en este Reparto: cada ruta va a una tubería distinta.";
  return null;
}

/**
 * CABLE O COLITA (27/10/2026, «modo inalámbrico»). Lo elige él en cada conexión (clic derecho); sin
 * elegir, lo de siempre: al Regalo y los regresos (a una ficha que está a la izquierda) como colita, lo
 * demás como cable. «Ver todo como cable» los muestra todos con línea sin cambiar lo elegido.
 */
function esColita(t: TableroEnElEditor, c: CableDelTablero, todoCable: boolean): boolean {
  if (todoCable) return false;
  if (c.vista) return c.vista === "colita";
  const origen = t.fichas.find((f) => f.id === c.de);
  const destino = t.fichas.find((f) => f.id === c.a);
  if (!origen || !destino) return false;
  return destino.tipo === "regalo" || (destino.tipo !== "seguimientos" && destino.x < origen.x - 60);
}

/** Lo que dice una colita: hacia dónde, el número y el nombre de su destino. */
function letreroDeColita(t: TableroEnElEditor, c: CableDelTablero, numeroDe: Record<string, number>): string {
  const origen = t.fichas.find((f) => f.id === c.de);
  const destino = t.fichas.find((f) => f.id === c.a);
  if (!destino) return "→";
  const atras = !!origen && destino.x < origen.x - 60;
  const n = numeroDe[destino.id];
  return `${atras ? "↩" : "→"} ${n !== undefined ? `${n} ` : ""}${ASPECTO[destino.tipo].icono} ${destino.titulo?.trim() || ASPECTO[destino.tipo].nombre}`;
}

/**
 * EL CAMINO DE COMPRA DESDE UNOS SEGUIMIENTOS (31/10/2026). Él vio la caja de Seguimientos sin ningún cable
 * saliendo y pensó que era un callejón: «no dejar que el usuario se rompa la cabeza pensando qué va a pasar».
 * El bot ya lo hace (mientras salen los seguimientos el cliente sigue en la ficha de la que cuelgan, y su
 * compra va por los cables de esa ficha); aquí solo se DIBUJA, sola, como copia de esos cables: no se jala,
 * no se corta, y si los cables de la ficha cambian, cambia con ellos. Colgados de un Cobro: «🛒 si paga»,
 * de vuelta a ese Cobro. Colgados de una Intro / Order bump: «🛒 si compra» hasta su Cobro (con dos o más
 * productos, uno por producto: «🛒 si elige X»).
 */
function caminosDeCompra(
  t: TableroEnElEditor,
  seg: FichaEnElEditor,
  nombres: Record<string, string>
): Array<{ clave: string; destino: FichaEnElEditor; etiqueta: string }> {
  if (seg.tipo !== "seguimientos") return [];
  const out = new Map<string, { clave: string; destino: FichaEnElEditor; etiqueta: string }>();
  const padres = t.cables
    .filter((c) => c.a === seg.id && (c.salida === "siguiente" || c.salida === "sin_respuesta" || c.salida === "sin_pago"))
    .map((c) => t.fichas.find((f) => f.id === c.de))
    .filter((f): f is FichaEnElEditor => !!f && !f.guardada);
  const destinos = new Map<string, FichaEnElEditor>();
  for (const p of padres) {
    if (p.tipo === "cobro") {
      out.set(p.id, { clave: `compra:${p.id}`, destino: p, etiqueta: "🛒 si paga" });
      continue;
    }
    // SOLO LO QUE EL BOT MANDA (01/11/2026): un botón de una burbuja APAGADA o un cuadrito apagado no se ve, así
    // que tampoco lleva a comprar (él vio «si compra» saliendo de un botón apagado). Su cable se queda guardado.
    const { botones, cuadritos } = opcionesDe(pasosDeLaFicha(p as FichaDelTablero));
    const activas = new Set([
      ...botones.map((b) => `btn:${b.id}`),
      ...cuadritos.map((d) => `dec:${d.id}`),
      ...eligeDeLaFicha(p as FichaDelTablero).map((id) => `elige:${id}`),
    ]);
    for (const c of t.cables) {
      if (c.de !== p.id || !activas.has(c.salida)) continue;
      const d = t.fichas.find((f) => f.id === c.a);
      if (d && (d.tipo === "cobro" || d.tipo === "intro_ob")) destinos.set(d.id, d);
    }
  }
  // Con un solo destino, «si compra»; con varios (de todas las fichas de las que cuelga), uno por producto.
  for (const d of destinos.values()) {
    if (out.has(d.id)) continue;
    const nombre = d.tipo === "cobro" ? nombres[d.cobro?.producto_id ?? ""] : undefined;
    out.set(d.id, {
      clave: `compra:${d.id}`,
      destino: d,
      etiqueta: destinos.size > 1 ? `🛒 si elige ${nombre ?? d.titulo?.trim() ?? ASPECTO[d.tipo].nombre}` : "🛒 si compra",
    });
  }
  return [...out.values()];
}

/** El puntito del gemelo: `<salida>@@<dónde>`. Al conectar se quita lo de después (`salidaDelPunto`). */
const GEMELO = "@@";
const salidaDelPunto = (id: string) => id.split(GEMELO)[0];

/** Las opciones de cada seguimiento de una caja de Seguimientos: su número, sus minutos y sus salidas. */
function filasDeSeguimientos(f: FichaEnElEditor): Array<{ n: number; minutos: number; claves: string[] }> {
  return (f.seguimientos ?? []).map((s, i) => {
    // SOLO LAS BURBUJAS ENCENDIDAS (13/11/2026, su ficha 73: un «SI QUIERO» de una burbuja APAGADA salía como un tercer
    // botón, y le robaba el puntito a otro). Lo apagado no sale al cliente: botones y cuadritos, igual.
    const pasos = (s.variantes ?? []).flatMap((v) => ((v.steps ?? []) as Array<{ enabled?: boolean }>).filter((p) => p.enabled !== false) as never[]);
    const { botones, cuadritos } = opcionesDe(pasos as never);
    return { n: i + 1, minutos: s.minutos, claves: [...botones.map((b) => `btn:${b.id}`), ...cuadritos.map((d) => `dec:${d.id}`)] };
  });
}

/**
 * «🔍 QUÉ FALTA CONECTAR» (27/10/2026): las salidas que, sin cable, dejan al cliente sin camino o te
 * dejan sin la venta. Solo en lo que está en venta (lo que se alcanza desde un Inicio encendido), sin
 * las fichas apagadas. Cada una con su porqué en una línea.
 */
function faltasDelTablero(t: TableroEnElEditor, paisVisto: string, nombres: Record<string, string>): Array<{ ficha: string; salida: string; motivo: string }> {
  const faltas: Array<{ ficha: string; salida: string; motivo: string }> = [];
  const conCable = (de: string, salida: string) => t.cables.some((c) => c.de === de && c.salida === salida);
  const enVenta = new Set<string>();
  for (const ini of t.fichas.filter((f) => f.tipo === "inicio" && !f.guardada)) {
    if (ini.sin_venta) continue;
    const sale = t.cables.some((c) => c.de === ini.id);
    if (!sale)
      faltas.push({
        ficha: ini.id,
        salida: "siguiente",
        motivo: `El Inicio de ${ini.pais ? `${banderaDe(ini.pais)} ${ini.pais}` : "🌍 Otros países"} no lleva a ninguna ficha: nadie de ahí entra.`,
      });
    for (const id of rutaDe(t, ini.id)) enVenta.add(id);
  }
  // Las fichas que vienen después de una Entrega (los upsells): sin respuesta, la venta de siempre
  // lleva al Regalo.
  const trasUnaEntrega = new Set<string>();
  for (const e of t.fichas.filter((f) => f.tipo === "entregar")) for (const id of rutaDe(t, e.id)) if (id !== e.id) trasUnaEntrega.add(id);
  for (const f of t.fichas) {
    if (!enVenta.has(f.id) || f.tipo === "inicio" || f.apagada || f.guardada) continue;
    const salidas = salidasDeLaFicha(f as FichaDelTablero, paisVisto, nombres, t as Tablero);
    for (const s of salidas) {
      if (conCable(f.id, s.clave)) continue;
      const nombre = s.etiqueta.replace(/^(🔘|💬) /, "");
      // (13/11/2026: el de un seguimiento que su master resuelve por su nombre no está suelto: ver `aDondeVaPorSuNombre`.)
      if (s.clave.startsWith("btn:") && f.tipo === "seguimientos" && aDondeVaPorSuNombre(t, f, nombre, nombres)) continue;
      if (s.clave.startsWith("btn:")) faltas.push({ ficha: f.id, salida: s.clave, motivo: `El botón «${nombre}» no lleva a ningún lado.` });
      else if (s.clave.startsWith("elige:")) faltas.push({ ficha: f.id, salida: s.clave, motivo: `«${s.etiqueta.replace(/^✍️ /, "")}» no lleva a ningún lado.` });
      else if (s.clave.startsWith("dec:")) {
        const d = opcionesDe(pasosDeLaFicha(f as FichaDelTablero)).cuadritos.find((x) => `dec:${x.id}` === s.clave);
        // Un cuadrito con sus propias burbujas contesta y se queda: no le falta nada.
        if (!d?.steps?.length) faltas.push({ ficha: f.id, salida: s.clave, motivo: `«${nombre}» no lleva a ningún lado.` });
      } else if (f.tipo === "condicion" || f.tipo === "reparto")
        faltas.push({ ficha: f.id, salida: s.clave, motivo: `«${s.etiqueta}» no lleva a ningún lado.` });
      else if (f.tipo === "cobro" && s.clave.startsWith("tramo:")) faltas.push({ ficha: f.id, salida: s.clave, motivo: `El tramo «${s.etiqueta}» no entrega nada.` });
      else if (f.tipo === "cobro" && f.cobro?.modo !== "abierto" && (s.clave === "pagado" || s.clave.startsWith("prod:"))) {
        // Sin cable, el bot busca la Entrega de ese producto en su ruta (`entregaDelProductoEnSuRuta`), y si no la hay,
        // EL COBRO ENTREGA SOLO (06/11/2026): con su producto elegido no le falta nada. Solo falta si no tiene producto.
        const producto = s.clave === "pagado" ? f.cobro?.producto_id : s.clave.slice(5);
        if (!producto) faltas.push({ ficha: f.id, salida: s.clave, motivo: `${s.etiqueta}: este Cobro no tiene producto elegido, así que no hay nada que entregar.` });
      } else if (
        s.clave === "sin_respuesta" &&
        (f.tipo === "mensaje" || f.tipo === "intro_ob") &&
        trasUnaEntrega.has(f.id) &&
        !conCable(f.id, "siguiente")
      )
        faltas.push({ ficha: f.id, salida: s.clave, motivo: "Si no responde a esta oferta, ¿a dónde va? (en la venta de siempre, al Regalo)." });
    }
    // EL CALLEJÓN (13/11/2026). Él: «necesito que algo me indique si la compra no se va a realizar… verlo en el tablero
    // rápidamente antes de testear». Un Mensaje u Order bump de la venta (antes de entregar) desde el que, por ningún
    // cable (también los de sus Seguimientos), se llega a un Cobro, una Entrega, un asesor o un workflow: ahí el cliente
    // no puede comprar. Las cajas de Seguimientos no se miran solas: cuelgan de su ficha (un Cobro sigue abierto, las
    // opciones de un Mensaje siguen valiendo), y esa ficha ya se revisa.
    if ((f.tipo === "mensaje" || f.tipo === "intro_ob") && !trasUnaEntrega.has(f.id)) {
      const llega = [...rutaDe(t, f.id)].some((id) => {
        const x = t.fichas.find((y) => y.id === id);
        return !!x && !x.apagada && ["cobro", "entregar", "humano", "workflow"].includes(x.tipo);
      });
      if (!llega) faltas.push({ ficha: f.id, salida: "callejon", motivo: "Callejón: desde aquí el cliente no llega a ningún Cobro (no puede comprar)." });
    }
  }
  return faltas;
}

/** EL CABLE QUE SE TIRA, del color de la ficha de donde sale (27/10/2026). */
function CableQueSeTira({ fromX, fromY, toX, toY, fromPosition, toPosition, fromNode }: ConnectionLineComponentProps) {
  const tipo = (fromNode?.data as { ficha?: FichaEnElEditor } | undefined)?.ficha?.tipo;
  const color = tipo ? ASPECTO[tipo].trazo : "#f97316";
  const [camino] = getBezierPath({ sourceX: fromX, sourceY: fromY, sourcePosition: fromPosition, targetX: toX, targetY: toY, targetPosition: toPosition });
  return <path d={camino} fill="none" stroke={color} strokeWidth={4} strokeDasharray="10 6" />;
}

/** EL ZOOM DEL TABLERO EN CSS (`--zoom-tablero`), para que el borde de la familia del espejo tenga el mismo grosor
 *  en pantalla con cualquier zoom (13/11/2026). Solo pantalla. */
function ZoomDelTablero() {
  const zoom = useStore((s) => s.transform[2]);
  useEffect(() => {
    document.documentElement.style.setProperty("--zoom-tablero", String(zoom || 1));
  }, [zoom]);
  return null;
}

/** ESCAPE SUELTA EL CABLE QUE SE ESTÁ TIRANDO (27/10/2026): el que ya estaba queda como estaba. */
function SoltarConEscape({ tirando, alSoltar }: { tirando: boolean; alSoltar: () => void }) {
  const tienda = useStoreApi();
  useEffect(() => {
    if (!tirando) return;
    const alPulsar = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      tienda.getState().cancelConnection();
      alSoltar();
    };
    window.addEventListener("keydown", alPulsar, true);
    return () => window.removeEventListener("keydown", alPulsar, true);
  }, [tirando, tienda, alSoltar]);
  return null;
}

const Contexto = createContext<{
  tablero: TableroEnElEditor;
  tema: "claro" | "oscuro";
  paisVisto: string;
  nombres: Record<string, string>;
  resumenDe: (f: FichaEnElEditor) => string;
  abrir: (id: string, burbuja?: number) => void;
  ajustes: (id: string) => void;
  menu: (x: number, y: number, m: Menu) => void;
  cambiar: (t: TableroEnElEditor) => void;
  curvar: (cableId: string, p: Punto | null) => void;
  /** Por ficha: cuántos clientes llegaron y cuántos pagaron (de verdad, sin las pruebas). */
  numeros?: Record<string, { clientes: number; ventas: number; ahora?: number }>;
  /** El número de cada ficha (tipo Kommo), para ubicarlas y para los regresos «↩ 7». */
  numeroDe: Record<string, number>;
  /**
   * LO INALÁMBRICO, CALCULADO UNA VEZ (27/10/2026: «mover las fichas se hizo lento como una tortuga»):
   * los cables que se ven como colita, cuántas colitas le llegan a cada ficha y qué fichas tienen alguna.
   */
  colitas: Set<string>;
  colitasQueLlegan: Map<string, number>;
  fichasConColitas: Set<string>;
  /** La ficha iluminada al tocar una colita (solo su borde; la vista no se mueve). */
  destacada: string | null;
  destacar: (id: string | null) => void;
  /** La ficha cuyas colitas de llegada se ven como línea (al pasar el ratón por su «← 3»). */
  verEntrantes: string | null;
  setVerEntrantes: (id: string | null) => void;
  /** «🔍 Qué falta conectar»: por ficha, las salidas que faltan con su porqué. */
  faltas: Map<string, Map<string, string>> | null;
  /** Por país: quién cobra ahí (su avatar y su nombre), para el Inicio. Solo pantalla. */
  quienCobra?: Record<string, { foto?: string; color?: string; nombre: string; porDefecto: boolean }>;
  /** Clic en la cara del Inicio: abre los datos de la tienda (quién cobra por país). */
  alTocarQuienCobra?: () => void;
  /** El modo estaciones (01/11/2026): las salidas de las fichas que esperan salen de su bolita. Solo dibujo. */
  estaciones: boolean;
  /** En modo estaciones: el robot «Agente IA» (sí) o la bolita 🚉 (no). Solo dibujo. */
  comoAgente: boolean;
  /** Las ofertas que vienen después de una Entrega (los upsells) y su número: 1, 2… Solo dibujo. */
  upsellDe: Record<string, number>;
  /** Las ofertas que solo completan al full de lo ya vendido (el upgrade): llevan el cohete y no cuentan como upsell. */
  upgradeDe: Set<string>;
  /** EL CANAL DE ESTE TABLERO (03/11/2026, su conversación 256: conectó en Messenger y probó por WhatsApp). Su logo
   *  va en cada estación y en el Inicio. Sin canal (un workflow, que vale para los tres), no se pone. Solo dibujo. */
  canal?: "whatsapp" | "messenger" | "instagram";
} | null>(null);

/** El logo del canal en la esquina de abajo a la derecha (sus montajes «whatsapp.jpg», «MESSENGER.jpg», «INSTAGRAM.jpg»). */
function LogoDelCanal({ tamano = 56 }: { tamano?: number }) {
  const ctx = useContext(Contexto);
  if (!ctx?.canal) return null;
  const nombre = ctx.canal === "whatsapp" ? "WhatsApp" : ctx.canal === "messenger" ? "Messenger" : "Instagram";
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/tablero/canal-${ctx.canal}.png`}
      alt={nombre}
      title={`Tablero de ${nombre}`}
      draggable={false}
      className="pointer-events-auto absolute z-10 select-none rounded-2xl border-[3px] border-white bg-white object-cover shadow-lg"
      style={{ width: tamano, height: tamano, right: -tamano / 3, bottom: -tamano / 3 }}
    />
  );
}

/** Un color fijo por persona para la etiqueta de su nombre (como en su dibujo: Melissa azul, Katty rosa…).
 *  Sin verdes ni turquesas (29/10/2026): se confundían con la franja verde del Inicio y con el Cobro. */
const COLORES_DE_NOMBRE = ["bg-blue-600", "bg-pink-600", "bg-slate-800", "bg-orange-600", "bg-violet-600", "bg-fuchsia-600", "bg-purple-700", "bg-rose-600"];
/** Letra blanca sobre un color oscuro y casi negra sobre uno claro, para que el nombre se lea siempre. */
function letraSobreElColor(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const luz = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return luz > 0.62 ? "#1f2937" : "#ffffff";
}
function colorDelNombre(nombre: string): string {
  let h = 0;
  for (const c of nombre) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORES_DE_NOMBRE[h % COLORES_DE_NOMBRE.length];
}

/**
 * QUIÉN COBRA EN ESTE PAÍS, EN SU INICIO (29/10/2026). Él: «yo solo miro la pizarra y digo, ah ok, sí, está bien
 * el que va a cobrar, no me preocupa». Su avatar arriba a la derecha y su nombre debajo, como su dibujo. Si cobra
 * «por defecto» (la tienda sin cobrador o el cobrador sin cuenta en este país), lo dice. Sin foto: la silueta.
 */
function QuienCobraEnElInicio({ pais, deLejos = 1 }: { pais?: string; deLejos?: number }) {
  const ctx = useContext(Contexto);
  const q = pais ? ctx?.quienCobra?.[pais] : undefined;
  const [roto, setRoto] = useState(false);
  // Dónde está, sin la escala (offsetLeft no la cuenta): para correrlo a la derecha de la bandera cuando ésta crece.
  const caja = useRef<HTMLDivElement>(null);
  const [izquierda, setIzquierda] = useState(160);
  useEffect(() => {
    if (caja.current) setIzquierda(caja.current.offsetLeft);
  }, [q?.nombre, q?.porDefecto]);
  if (!q) return null;
  // La bandera mide ~56 px y crece igual (`deLejos`): el cobrador empieza siempre a su derecha.
  const correr = Math.max(0, 56 * deLejos + 8 - izquierda);
  const foto = String(q.foto ?? "").trim();
  const nombreCorto = q.nombre.trim().split(/\s+/)[0] || q.nombre;
  const deLaGaleria = foto.startsWith("/avatares/");
  // El color que él eligió en menú usuarios (30/10/2026); sin elegir, el automático de su nombre.
  const colorElegido = /^#[0-9a-f]{6}$/i.test(String(q.color ?? "").trim()) ? String(q.color).trim() : "";
  return (
    <div
      ref={caja}
      role="button"
      tabIndex={0}
      className="nodrag pointer-events-auto absolute -right-6 -top-5 flex cursor-pointer flex-col items-center"
      // Crece al alejar, como la bandera (13/11/2026, él: «al alejarse se sigue viendo grande, igual con el cobrador»).
      // Hacia arriba y a la derecha de la bandera: no tapa la bandera ni el nombre del país (que crece hacia abajo).
      style={{ transform: `translateX(${correr}px) scale(${deLejos})`, transformOrigin: "bottom left" }}
      title={`Cobra aquí: ${q.nombre}${q.porDefecto ? " (por defecto: los Datos para pago del país)" : ""}.\nClic: cambiar quién cobra en cada país.`}
      onClick={(e) => {
        e.stopPropagation();
        ctx?.alTocarQuienCobra?.();
      }}
    >
      {foto && !roto ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={foto}
          alt=""
          onError={() => setRoto(true)}
          className={`h-16 w-16 rounded-full object-cover shadow-md ${deLaGaleria ? "" : "bg-white ring-[3px] ring-white"}`}
        />
      ) : (
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-200 text-slate-500 shadow-md ring-[3px] ring-white">
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-8 w-8">
            <path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2c-4.42 0-8 2.24-8 5v1h16v-1c0-2.76-3.58-5-8-5Z" />
          </svg>
        </span>
      )}
      <span
        className={`-mt-2 max-w-[110px] truncate rounded-full px-2 py-0.5 text-[11px] font-black shadow ${colorElegido ? "" : `text-white ${colorDelNombre(q.nombre)}`}`}
        style={colorElegido ? { backgroundColor: colorElegido, color: letraSobreElColor(colorElegido) } : undefined}
      >
        {nombreCorto}
      </span>
      {q.porDefecto && <span className="mt-0.5 rounded bg-white/90 px-1 text-[9px] font-semibold text-slate-600">por defecto</span>}
    </div>
  );
}

// (11/11/2026: los números «👥 12 · 💰 3 pagaron» ya no se dibujan en las fichas. Él: «eso que no vaya, si no me voy a
// confundir; en el tablero que no hayan esos datos». Se siguen leyendo para el aviso de borrar fichas con clientes dentro.)

// ── EL INICIO DE UN PAÍS ──────────────────────────────────────────────────────

function NodoDeInicio({ data }: NodeProps<Node<{ ficha: FichaEnElEditor }>>) {
  const ctx = useContext(Contexto);
  const f = data.ficha;
  const conectado = !!ctx?.tablero.cables.some((c) => c.de === f.id && (c.salida === "siguiente" || c.salida.startsWith("anuncio:")));
  // VARIAS TUBERÍAS EN UN PAÍS (26/10/2026): el Inicio separa por anuncio, cada uno con su salida.
  const [eligiendoAnuncios, setEligiendoAnuncios] = useState(false);
  const [eligiendoPais, setEligiendoPais] = useState<{ x: number; y: number } | null>(null);
  const anunciosDisponibles = Object.entries(ctx?.nombres ?? {})
    .filter(([k]) => k.startsWith("anuncio:"))
    .map(([k, nombre]) => ({ clave: k.slice(8), nombre }));
  const suyos = f.anuncios ?? [];
  const estado = f.en_revision ? "revision" : f.sin_venta ? "apagado" : "venta";
  const color = !conectado
    ? { borde: "border-orange-400", banda: "bg-orange-500" }
    : estado === "venta"
      ? { borde: "border-emerald-500", banda: "bg-emerald-600" }
      : estado === "revision"
        ? { borde: "border-sky-500", banda: "bg-sky-600" }
        : { borde: "border-slate-400", banda: "bg-slate-500" };
  const cambiar = (cambio: Partial<FichaEnElEditor>) => {
    if (!ctx) return;
    ctx.cambiar({ ...ctx.tablero, fichas: ctx.tablero.fichas.map((x) => (x.id === f.id ? { ...x, ...cambio } : x)) });
  };
  const etiqueta = f.pais ? `${banderaDe(f.pais)} ${f.pais}` : "🌍 Otros países";
  // LA BANDERA Y EL PAÍS SE VEN DE LEJOS (11/11/2026, él: «no distingo qué país estamos a menos que me acerque… al
  // alejarme seguir viendo la bandera, y debajo del inicio diga el país, solo nombre»). Crecen al alejar la vista, para
  // que en pantalla no bajen de un tamaño legible. Solo pantalla.
  const zoom = useStore((s) => s.transform[2]);
  const deLejos = Math.max(1, 0.55 / Math.max(zoom, 0.05));
  // En mayúsculas (11/11/2026, él: «ARGENTINA, PERÚ, COLOMBIA»).
  const nombreDelPais = (f.pais ? COUNTRIES[f.pais as CountryCode]?.label ?? f.pais : "Otros países").toUpperCase();
  const encendido = conectado && estado === "venta";
  return (
    <div
      className={`relative w-[200px] rounded-xl border-2 bg-white text-slate-800 shadow-lg ${color.borde}`}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        ctx?.menu(e.clientX, e.clientY, { tipo: "ficha", fichaId: f.id });
      }}
      title={conectado ? undefined : "Desconectado: arrastra el punto naranja hasta la primera ficha de esta ruta."}
    >
      <QuienCobraEnElInicio pais={f.pais} deLejos={deLejos} />
      <LogoDelCanal tamano={44} />
      {/* La bandera, grande, encima del Inicio (crece al alejar). DOBLE CLIC: cambiar el país de esta área (12/11/2026,
          él: «los velos tienen una bandera arriba a la izquierda… dar doble clic en su bandera y seleccionar el país»). */}
      <div
        className="nodrag nopan absolute bottom-full left-0 mb-1 cursor-pointer leading-none"
        style={{ fontSize: 46, transform: `scale(${deLejos})`, transformOrigin: "bottom left" }}
        title="Doble clic para cambiar el país de esta área"
        onDoubleClick={(e) => {
          e.stopPropagation();
          const r = e.currentTarget.getBoundingClientRect();
          setEligiendoPais({ x: r.left, y: r.bottom + 6 });
        }}
      >
        {f.pais ? banderaDe(f.pais) : "🌍"}
      </div>
      {eligiendoPais && ctx && (
        <ElegirPaisDeLaManta
          actual={f.pais ?? ""}
          ocupados={ctx.tablero.fichas.filter((x) => x.tipo === "inicio" && x.id !== f.id).map((x) => x.pais ?? "")}
          donde={eligiendoPais}
          onCerrar={() => setEligiendoPais(null)}
          onElegir={(p) => {
            const de = f.pais ? `${banderaDe(f.pais)} ${f.pais}` : "🌍 Otros países";
            const a = p ? `${banderaDe(p)} ${p}` : "🌍 Otros países";
            setEligiendoPais(null);
            if (!window.confirm(`¿Cambiar esta área de ${de} a ${a}?\n\nDesde ahora los clientes de ${a} entran por este Inicio (los de ${de} ya no). Ctrl+Z lo deshace.`)) return;
            cambiar({ pais: p || undefined });
          }}
        />
      )}
      {/* Su país, solo el nombre, debajo del Inicio (crece al alejar). */}
      <div
        // Blanco con la pizarra oscura (13/11/2026, él: «no se pueden ver sobre el fondo oscuro»).
        className={`pointer-events-none absolute left-0 top-full mt-1 whitespace-nowrap text-xl font-black leading-none ${ctx?.tema === "oscuro" ? "text-white" : "text-slate-700"}`}
        style={{ transform: `scale(${deLejos})`, transformOrigin: "top left" }}
      >
        {nombreDelPais}
      </div>
      <div className={`rounded-t-[10px] px-3 py-2 text-white ${color.banda}`}>
        <div className="text-sm font-bold">▶ Inicio</div>
        <div className="text-[11px] opacity-90">
          {!conectado ? "Desconectado" : estado === "revision" ? "En revisión · no recibe" : estado === "apagado" ? "Apagado · no contesta" : "El cliente escribe"}
        </div>
      </div>
      <div className="flex flex-col gap-1.5 p-2">
        {/* ENCENDER Y APAGAR EL PAÍS, COMO UN INTERRUPTOR (11/11/2026, él: «el inicio no tiene cómo apagarse, solo cortando
            el cable»). Es el mismo dato de siempre (`sin_venta`): apagado, el bot no les contesta a los clientes nuevos
            de este país; los que ya están en la ruta siguen. El cable no se toca. */}
        <button
          type="button"
          role="switch"
          aria-checked={!f.sin_venta}
          className={`nodrag flex items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs font-bold ${
            !f.sin_venta ? "border-emerald-400 bg-emerald-50 text-emerald-800" : "border-slate-300 bg-slate-100 text-slate-600"
          }`}
          title={"Encendido: el bot atiende a los clientes nuevos de este país con este tablero.\nApagado: no les contesta. Los que ya están en la ruta siguen."}
          onClick={() => cambiar({ sin_venta: !f.sin_venta, en_revision: false })}
        >
          <span className={`relative inline-block h-5 w-9 shrink-0 rounded-full transition ${!f.sin_venta ? "bg-emerald-500" : "bg-slate-400"}`}>
            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${!f.sin_venta ? "left-[18px]" : "left-0.5"}`} />
          </span>
          {!f.sin_venta ? (encendido ? "Encendido · vende" : "Encendido · sin cable") : estado === "revision" ? "Apagado · en revisión" : "Apagado · no contesta"}
        </button>
        <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs font-semibold text-slate-800">{etiqueta}</div>
        {suyos.map((k) => (
          <div
            key={k}
            className="relative rounded-md border border-violet-200 bg-violet-50 px-2 py-1 text-[11px] font-semibold text-violet-900"
            title="Quien vino de este anuncio va por este cable (su tubería)."
          >
            📣 {ctx?.nombres[`anuncio:${k}`] ?? k}
            <Handle
              type="source"
              position={Position.Right}
              id={`anuncio:${k}`}
              className={PUNTO_NARANJA}
              title="Clic: elegir a dónde va de una lista"
              onClick={(e) => {
                e.stopPropagation();
                ctx?.menu(e.clientX, e.clientY, { tipo: "conectar", ficha: f.id, salida: `anuncio:${k}` });
              }}
            />
          </div>
        ))}
        <div className="relative rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700">
          {suyos.length ? "→ Los demás" : "→ Empieza aquí"}
          <Handle
            type="source"
            position={Position.Right}
            id="siguiente"
            className={`${PUNTO_NARANJA} ${ctx?.faltas?.get(f.id)?.has("siguiente") ? "punto-pide-cable" : ""}`}
            title="Clic: elegir a dónde va de una lista"
            onClick={(e) => {
              e.stopPropagation();
              ctx?.menu(e.clientX, e.clientY, { tipo: "conectar", ficha: f.id, salida: "siguiente" });
            }}
          />
        </div>
        {anunciosDisponibles.length > 0 && (
          <button
            type="button"
            className="nodrag rounded-md border border-violet-300 bg-white px-2 py-1 text-left text-[11px] font-semibold text-violet-800 hover:bg-violet-50"
            title="Varias tuberías en este país: cada anuncio marcado tiene su salida."
            onClick={() => setEligiendoAnuncios((v) => !v)}
          >
            📣 Separar por anuncio{suyos.length ? ` (${suyos.length})` : ""}
          </button>
        )}
        {eligiendoAnuncios && (
          <div className="nodrag nowheel max-h-40 overflow-y-auto rounded-md border border-violet-200 bg-white p-1.5">
            {anunciosDisponibles.map((a) => (
              <label key={a.clave} className="flex cursor-pointer items-center gap-1.5 py-0.5 text-[11px] text-slate-800">
                <input
                  type="checkbox"
                  checked={suyos.includes(a.clave)}
                  onChange={(e) => {
                    const nuevos = e.target.checked ? [...suyos, a.clave] : suyos.filter((x) => x !== a.clave);
                    if (!ctx) return;
                    // Al quitar un anuncio, su cable se va con él (lo que se agrega, se quita).
                    ctx.cambiar({
                      ...ctx.tablero,
                      fichas: ctx.tablero.fichas.map((x) => (x.id === f.id ? { ...x, anuncios: nuevos.length ? nuevos : undefined } : x)),
                      cables: e.target.checked ? ctx.tablero.cables : ctx.tablero.cables.filter((c) => !(c.de === f.id && c.salida === `anuncio:${a.clave}`)),
                    });
                  }}
                />
                {a.nombre}
              </label>
            ))}
          </div>
        )}
        {estado !== "venta" && (
          <button
            type="button"
            className="nodrag rounded-md border border-slate-300 bg-white px-2 py-1 text-left text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
            title="Solo cambia cómo se ve. En los dos, este país no recibe clientes en el tablero."
            onClick={() => cambiar({ en_revision: !f.en_revision, sin_venta: true })}
          >
            {estado === "revision" ? "⚪ Pasar a apagado" : "🔵 Pasar a revisión"}
          </button>
        )}
      </div>
    </div>
  );
}

// ── UNA FICHA ─────────────────────────────────────────────────────────────────

function NodoDeFicha({ data, selected }: NodeProps<Node<{ ficha: FichaEnElEditor; espejo?: string }>>) {
  const ctx = useContext(Contexto);
  // 🪞 EL BOTÓN GEMELO (13/11/2026): la opción repetida en otro seguimiento que el ratón tiene encima (se marca su pareja).
  const [gemeloEncima, setGemeloEncima] = useState<string | null>(null);
  const f = data.ficha;
  // 🪞 EL ESPEJO (05/11/2026): la misma ficha en otro sitio. Se dibuja igual, con un borde de neón y su marca.
  const espejo = data.espejo;
  if (!ctx) return null;
  const a = ASPECTO[f.tipo];
  const salidas = salidasDeLaFicha(f as FichaDelTablero, ctx.paisVisto, ctx.nombres, ctx.tablero as Tablero);
  const avisos = avisosDeLaFicha(ctx.tablero as Tablero, f as FichaDelTablero, ctx.paisVisto);
  const conCable = new Set(ctx.tablero.cables.filter((c) => c.de === f.id).map((c) => c.salida));
  const leLlega = ctx.tablero.cables.some((c) => c.a === f.id);
  const tenue = !!f.apagada;
  const titulo = f.titulo?.trim() || a.nombre;
  // EL HINT Y EL PRODUCTO A LA VISTA (01/11/2026): tipo, título, y lo que cobra, entrega o presenta.
  const nombreDeProducto = (id?: string) => (id ? ctx.nombres?.[id.split("#")[0]] ?? "" : "");
  const listaDeProductos = (ids?: string[]) => [...new Set((ids ?? []).map(nombreDeProducto).filter(Boolean))].join(", ");
  const cobraSola = cobraEnLaFicha(f as FichaDelTablero, ctx.tablero as Tablero);
  // «En la ficha no aparece el nombre, solo dice cobro» (01/11/2026): el producto, bajo el título, sin pasar el ratón.
  const productoALaVista =
    f.tipo === "cobro"
      ? f.cobro?.modo === "abierto"
        ? ""
        : nombreDeProducto(f.cobro?.producto_id)
      : f.tipo === "entregar"
        ? listaDeProductos(f.entregas?.length ? f.entregas : f.producto_id ? [f.producto_id] : [])
        : cobraSola
          ? nombreDeProducto((f.presenta ?? [])[0])
          : "";
  const productoEnLaTarjeta = f.tipo === "cobro" || cobraSola ? productoALaVista : "";
  const hintDeLaFicha = (() => {
    const lineas = [ctx.numeroDe[f.id] !== undefined ? `${ctx.numeroDe[f.id]} · ${a.nombre}` : a.nombre];
    if (f.titulo?.trim()) lineas.push(f.titulo.trim());
    if ((f.tipo === "cobro" || cobraSola) && productoALaVista) lineas.push(`💰 Cobra: ${productoALaVista}`);
    if (f.tipo === "entregar" && productoALaVista) lineas.push(`📦 Entrega: ${productoALaVista}`);
    if (listaDeProductos(f.presenta)) lineas.push(`📣 Presenta: ${listaDeProductos(f.presenta)}`);
    return lineas.join("\n");
  })();
  // MODO INALÁMBRICO (27/10/2026): cuántas colitas le llegan (al pasar el ratón se ven sus líneas), y
  // una marca sutil en la ficha que tiene alguna conexión inalámbrica.
  const colitasQueLlegan = { length: ctx.colitasQueLlegan.get(f.id) ?? 0 };
  const conColitas = ctx.fichasConColitas.has(f.id);
  const destacada = ctx.destacada === f.id;
  const faltan = ctx.faltas?.get(f.id);
  const destinoDe = (clave: string) => {
    const c = ctx.tablero.cables.find((x) => x.de === f.id && x.salida === clave);
    return c ? ctx.tablero.fichas.find((x) => x.id === c.a) : undefined;
  };
  /**
   * A DÓNDE VA, CON SU TIPO (14/11/2026). Él: «va al 85… necesito algo que identifique a dónde va… que diga va a cobro».
   * El ícono de esa ficha (la bolsita 💰 del cobro; en una entrega, 📦 el full y 📚 los demás), la palabra, el número y,
   * en un cobro o una entrega, su producto. Con el ratón encima se ve la línea hasta ella. `solo` = sin cable (punteada).
   */
  const pastillaDelDestino = (d: FichaEnElEditor, solo: boolean, titulo: string) => {
    const pid = d.tipo === "cobro" ? (d.cobro?.modo === "abierto" ? undefined : d.cobro?.producto_id) : d.tipo === "entregar" ? (d.entregas?.[0] ?? d.producto_id) : undefined;
    const esFull = !!pid && (pid.split("#")[0] === FULL_DE_LA_TIENDA || (!!ctx.nombres[ID_DEL_FULL_DE_LA_TIENDA] && pid.split("#")[0] === ctx.nombres[ID_DEL_FULL_DE_LA_TIENDA]));
    const icono = d.tipo === "entregar" ? (esFull ? "📦" : "📚") : ASPECTO[d.tipo].icono;
    const producto = d.tipo === "entregar" ? listaDeProductos(d.entregas?.length ? d.entregas : d.producto_id ? [d.producto_id] : []) : nombreDeProducto(pid);
    // El producto va en el letrero del ratón: escrito en la pastilla, empujaba fuera el nombre del botón (probado en su ficha 86).
    const texto = `${solo ? "solo a " : ""}${icono} ${PALABRA_DEL_TIPO[d.tipo]} ${ctx.numeroDe[d.id] ?? ""}`;
    return (
      <span
        className={`ml-auto shrink-0 rounded-full border-2 ${solo ? "border-dashed" : ""} bg-white px-1.5 text-[10px] font-bold text-slate-800`}
        style={{ borderColor: ASPECTO[d.tipo].trazo }}
        title={`${titulo}${producto ? `\n${ASPECTO[d.tipo].nombre}: ${producto}` : ""}`}
        onMouseEnter={(e) => ponerLineaAlDestino({ el: e.currentTarget, a: d.id, color: ASPECTO[d.tipo].trazo })}
        onMouseLeave={() => ponerLineaAlDestino(null)}
      >
        {texto}
      </span>
    );
  };
  /** ¿El cable de esta salida se dibuja desde ESTE nodo? (Conectado desde un espejo, sale del espejo; si no, de la original.) */
  const seDibujaAqui = (clave: string) => {
    const c = ctx.tablero.cables.find((x) => x.de === f.id && x.salida === clave);
    if (!c) return true;
    const desdeEspejo = !!c.de_espejo && (ctx.tablero.espejos ?? []).some((e) => e.id === c.de_espejo && e.ficha === f.id);
    return desdeEspejo ? c.de_espejo === espejo : !espejo;
  };
  // «⏳ SI NO RESPONDE» NO SE VE CON SEGUIMIENTOS CONECTADOS (27/10/2026): ahí mandan ellos y el bot no
  // la usa. Si ya tenía cable, se ve (para poder cortarlo).
  const conSeguimientos = destinoDe("siguiente")?.tipo === "seguimientos";
  const visibles = salidas
    // «Otra cosa» solo en la ficha que ya la tiene conectada (26/10/2026): sin cable no hace nada.
    .filter((s) => s.clave !== "otra" || conCable.has("otra"))
    .filter((s) => !menosSeResuelveSolo(f, s.clave, conCable))
    .filter((s) => !(s.clave === "sin_respuesta" && conSeguimientos && !conCable.has("sin_respuesta")))
    .map((s) =>
      // «Si no paga» hacia unos Seguimientos: se llama como lo que hace.
      s.clave === "sin_pago" && destinoDe("sin_pago")?.tipo === "seguimientos" ? { ...s, etiqueta: "⏳ Seguimientos (si no paga)" } : s
    );
  /** Una salida con su puntito (o, repetida en otro seguimiento, con el letrero de a dónde va). */
  // `gemelos`: los otros seguimientos donde está la MISMA opción (mismo código). Él, 13/11/2026: «no hay nada que me
  // indique que un botón igual vale por 2… como voy a conectar si no tiene punto». Cada aparición lleva su 🪞, su
  // puntito (el cable es UNO: se dibuja desde la primera) y, con el ratón encima, su pareja se marca en magenta.
  const pastilla = (s: { clave: string; etiqueta: string }, conPunto: boolean, llave: string, gemelos?: number[]) => {
    const boton = s.clave.startsWith("btn:");
    const conGemelo = !!gemelos?.length;
    const marcado = conGemelo && gemeloEncima === s.clave;
    const cuadrito = s.clave.startsWith("dec:") || s.clave.startsWith("elige:");
    const falta = faltan?.get(s.clave);
    // Pide cable lo que sin cable deja al cliente sin camino: sus opciones y el «Si no paga».
    const destino = destinoDe(s.clave);
    // Botón de seguimiento sin cable que su master resuelve por el nombre (13/11/2026): a dónde, a la vista.
    const porSuNombre = boton && !destino && f.tipo === "seguimientos" ? aDondeVaPorSuNombre(ctx.tablero, f, s.etiqueta.replace(/^🔘 /, ""), ctx.nombres) : null;
    const pide =
      !!falta ||
      (!porSuNombre && (boton || cuadrito || s.clave === "sin_pago" || s.clave.startsWith("rep:") || f.tipo === "condicion") && !conCable.has(s.clave));
    const icono = iconoDeEntrega(f, s.clave, ctx.tablero, ctx.nombres, ctx.upsellDe[f.id] !== undefined);
    return (
      <div
        key={llave}
        title={falta ?? undefined}
        onMouseEnter={conGemelo ? () => setGemeloEncima(s.clave) : undefined}
        onMouseLeave={conGemelo ? () => setGemeloEncima((x) => (x === s.clave ? null : x)) : undefined}
        style={marcado ? { outline: "3px solid #ff00ff", outlineOffset: 2 } : undefined}
        className={`relative flex items-center gap-1.5 rounded-full border px-2 py-0.5 ${icono ? "pr-6" : "pr-4"} text-[11px] font-semibold ${
          falta
            ? "border-red-500 bg-red-50 text-red-800"
            : boton
              ? "border-emerald-300 bg-emerald-50 text-emerald-800"
              : cuadrito
                ? "border-indigo-300 bg-indigo-50 text-indigo-800"
                : "border-slate-200 bg-slate-50 text-slate-700"
        }`}
      >
        {(boton || cuadrito) && (
          <span className="shrink-0 text-[9px] opacity-70">{boton ? "BOTÓN" : s.clave.startsWith("elige:") ? "SI ELIGE" : "SI DICE"}</span>
        )}
        {/* EL INTERRUPTOR DE LA RUTA (03/11/2026, el 🔀 Ruteador). ON: recibe clientes según su %. OFF: no recibe clientes
            nuevos (peso 0, el sorteo del bot ya no la elige); los que ya estaban terminan como empezaron. */}
        {s.clave.startsWith("rep:") && <InterruptorDeRuta f={f} clave={s.clave} />}
        <span
          className="truncate"
          title={`${s.etiqueta.replace(/^(🔘|💬|✍️) /, "")}${boton ? "\nTambién si lo escribe con sus palabras (la IA reconoce cuál)." : ""}`}
        >
          {s.etiqueta.replace(/^(🔘|💬|✍️) /, "")}
          {/* Tocarlo o escribirlo lleva por el mismo cable (27/10/2026). */}
          {boton && <span className="ml-1 text-[9px] font-normal opacity-60">· o escrito</span>}
        </span>
        {conGemelo && (
          <span
            className="shrink-0 text-[11px]"
            title={`🪞 El mismo ${boton ? "botón" : "cuadrito"} está también en el Seguimiento ${gemelos!.join(" y ")}: es UN solo cable para todos. Conéctalo desde cualquiera de ellos.`}
          >
            🪞
          </span>
        )}
        {/* En palabras (13/11/2026, él: «no entiendo esos jeroglíficos»: era «↺ → 80»); con su tipo desde el 14/11. */}
        {porSuNombre &&
          pastillaDelDestino(
            porSuNombre,
            true,
            `Automático: sin cable, tocarlo vale como escribir «${s.etiqueta.replace(/^🔘 /, "")}», y su master lo lleva por el nombre a ${ctx.numeroDe[porSuNombre.id] ?? ""} ${porSuNombre.titulo?.trim() || ASPECTO[porSuNombre.tipo].nombre}. Si tiras tu propio cable, manda el tuyo.`
          )}
        {conPunto && !destino && (() => {
          // SIN CABLE PERO SABE A DÓNDE IR (05/11/2026): su colita automática, con el número y el color de esa ficha.
          const solo = aDondeVaSolo(f, s.clave, ctx.tablero);
          if (!solo) return null;
          return pastillaDelDestino(
            solo,
            true,
            `Automático: sin cable, el bot lo lleva a ${ctx.numeroDe[solo.id] ?? ""} ${solo.titulo?.trim() || ASPECTO[solo.tipo].nombre}. Si tiras tu propio cable, manda el tuyo.`
          );
        })()}
        {/* CONECTADA DESDE OTRO SITIO (14/11/2026, su ficha 86: conectada desde un 🪞 espejo, en la original no se veía nada
            y parecía suelta). El cable se dibuja donde él lo puso; aquí, a dónde va. */}
        {conPunto &&
          destino &&
          !seDibujaAqui(s.clave) &&
          pastillaDelDestino(
            destino,
            false,
            `Va a ${ctx.numeroDe[destino.id] ?? ""} ${destino.titulo?.trim() || ASPECTO[destino.tipo].nombre}. El cable se ve desde ${espejo ? "la ficha original" : "su espejo 🪞"}, donde se conectó.`
          )}
        {/* La misma opción en otro seguimiento: su cable sale de la primera; aquí, a dónde va. */}
        {!conPunto &&
          destino &&
          pastillaDelDestino(destino, false, `Va a ${ctx.numeroDe[destino.id] ?? ""} ${destino.titulo?.trim() || ASPECTO[destino.tipo].nombre} (el mismo cable de arriba)`)}
        {(conPunto || conGemelo) && (
          <Handle
            type="source"
            position={Position.Right}
            // El gemelo lleva su propio puntito (React Flow no admite dos con el mismo id); al conectar vale la salida de siempre.
            id={conPunto ? s.clave : `${s.clave}${GEMELO}${llave}`}
            className={`${icono ? PUNTO_DE_ENTREGA : PUNTO_NARANJA} ${pide ? "punto-pide-cable" : ""}`}
            title={
              icono
                ? "Aquí se entrega el producto. Del ícono sale el cable: tíralo a donde sigue (el Regalo, otro upsell…), o haz clic para elegir de una lista"
                : pide
                  ? (falta ?? "Sin cable: tíralo a donde lleva, o haz clic para elegir de una lista")
                  : "Clic: elegir a dónde va de una lista"
            }
            onClick={(e) => {
              e.stopPropagation();
              ctx.menu(e.clientX, e.clientY, { tipo: "conectar", ficha: f.id, salida: s.clave, ...(espejo ? { espejo } : {}) });
            }}
          >
            {icono && <span className="pointer-events-none select-none">{icono}</span>}
          </Handle>
        )}
      </div>
    );
  };
  // EL 🔀 RUTEADOR, SOLO SU LOGO (03/11/2026). Él: «el ruteador no debería tener ficha, está de más, solo sería el
  // logo», con el copiar y el tachito arriba a la derecha, como Sendy. No lleva burbujas: su ficha no decía nada más.
  if (f.tipo === "reparto") return <EstacionDeLaFicha f={f} soloLogo elegida={!!selected} espejo={espejo} />;
  const burbujas =
    f.tipo === "mensaje" || f.tipo === "cobro" || f.tipo === "correo"
      ? resumenDeBurbujas(f.steps)
      : f.tipo === "intro_ob"
        ? resumenDeBurbujas(f.variantes?.[0]?.steps)
        : [];
  const tarjeta = (
    <div
      onDoubleClick={() => ctx.abrir(f.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        ctx.menu(e.clientX, e.clientY, { tipo: "ficha", fichaId: f.id, ...(espejo ? { espejo } : {}) });
      }}
      className={`relative w-[250px] rounded-lg border-2 bg-white text-slate-800 shadow-md ${a.borde} ${tenue ? "ficha-tenue border-dashed" : ""} ${
        selected ? "ring-4 ring-cyan-400" : ""
      }`}
      style={{
        // LA FICHA A LA QUE LLEGA LA COLITA TOCADA: solo su borde se ilumina (27/10/2026).
        ...(destacada ? { boxShadow: "0 0 0 5px #f59e0b, 0 0 22px 6px rgba(245,158,11,0.55)" } : {}),
        // Marca sutil: esta ficha tiene alguna conexión inalámbrica.
        ...(conColitas && !destacada && !espejo ? { outline: "2px dotted rgba(100,116,139,0.55)", outlineOffset: 4 } : {}),
        // EL ESPEJO, «ANEONADO» (05/11/2026): líneas que brillan como neón, sin oscurecer la ficha.
        ...(espejo && !destacada ? { boxShadow: ESPEJO_NEON, outline: "2px solid #22d3ee", outlineOffset: 3 } : {}),
      }}
    >
      {espejo && (
        <span
          className="pointer-events-auto absolute -top-[24px] right-1 rounded-full border-2 border-cyan-400 bg-white px-2 text-[10px] font-bold leading-[16px] text-cyan-700"
          style={{ boxShadow: "0 0 8px rgba(34,211,238,0.8)" }}
          title={`Espejo de la ficha ${ctx.numeroDe[f.id] ?? ""}: es la MISMA ficha. Lo que cambies aquí cambia en la original, y los cables que llegan aquí llegan a ella.`}
        >
          🪞 espejo de {ctx.numeroDe[f.id] ?? "la original"}
        </span>
      )}
      {/* El punto de entrada: en modo estaciones, en el CENTRO del costado (como Sendy). */}
      <Handle type="target" position={Position.Left} id="entra" className={PUNTO_VERDE} style={ctx.estaciones ? undefined : { top: 18 }} />
      {/* «NADIE LLEGA», ARRIBA DE LA FICHA (27/10/2026): el punto rojo junto al conector estorbaba al
          soltar el cable ahí. */}
      {!leLlega && (
        <span
          className="pointer-events-auto absolute -top-[22px] left-1 rounded-full bg-red-600 px-1.5 text-[10px] font-bold leading-[16px] text-white shadow"
          title="No le llega ningún cable: nadie entra por aquí."
        >
          ⚠ nadie llega
        </span>
      )}
      {/* EL SELLO DE LA ENTREGA (02/11/2026, su montaje «entrega2.jpg»): en TODA ficha Entrega, arriba al centro, qué
          entrega: 📦 el full de la tienda, 📚 el básico, 🛍️ otro producto (el upsell). Solo pantalla. */}
      {(f.tipo === "entregar" || (f.tipo === "cobro" && f.cobro?.modo !== "abierto" && !!f.cobro?.producto_id)) &&
        (() => {
          const ids = (
            f.tipo === "cobro" ? [f.cobro?.producto_id ?? ""] : f.entregas?.length ? f.entregas : f.producto_id ? [f.producto_id] : []
          ).map((k) => k.split("#")[0]);
          const esFull = ids.some((id) => id === FULL_DE_LA_TIENDA || (!!ctx.nombres[ID_DEL_FULL_DE_LA_TIENDA] && id === ctx.nombres[ID_DEL_FULL_DE_LA_TIENDA]));
          const esOtro = ids.length > 0 && ids.every((id) => id !== BASICO_DE_LA_TIENDA && id !== ctx.nombres[ID_DEL_BASICO_DE_LA_TIENDA]);
          // SUS IMÁGENES (05/11/2026): la bolsa del básico, la caja VIP del full y el carrito del upsell, en la Entrega y en el Cobro.
          const sello = esFull ? "/tablero/cobro-full.png" : esOtro ? "/tablero/cobro-upsell.png" : "/tablero/cobro-basico.png";
          const queEs = esFull ? "el full de la tienda" : esOtro ? "otro producto (upsell)" : "el básico de la tienda";
          if (f.tipo === "cobro")
            return (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={sello}
                alt=""
                draggable={false}
                title={`Cobra ${queEs}`}
                className="pointer-events-none absolute -top-[62px] left-1/2 h-[60px] w-[60px] -translate-x-1/2 select-none rounded-full border-[5px] border-teal-500 bg-white object-cover shadow-md"
              />
            );
          return (
            <>
              {/* LA FLECHITA CELESTE QUE APUNTA AL SELLO (02/11/2026, su montaje «ENTREGA con flecha»). Solo pantalla. */}
              <svg
                aria-hidden="true"
                viewBox="0 0 80 40"
                className="pointer-events-none absolute -top-[52px] left-1/2 h-[40px] w-[80px] -translate-x-[122px] select-none drop-shadow"
              >
                <defs>
                  <linearGradient id="flecha-entrega" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#9fd4ff" />
                    <stop offset="1" stopColor="#4aa8f0" />
                  </linearGradient>
                </defs>
                <path d="M2 13h46V2l30 18-30 18V27H2z" fill="url(#flecha-entrega)" stroke="#2f86d6" strokeWidth="1.5" strokeLinejoin="round" />
              </svg>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={sello}
                alt=""
                draggable={false}
                title={`Entrega ${queEs}`}
                className="pointer-events-none absolute -top-[62px] left-1/2 h-[60px] w-[60px] -translate-x-1/2 select-none rounded-full border-[5px] border-emerald-500 bg-white object-cover shadow-md"
              />
            </>
          );
        })()}
      {colitasQueLlegan.length > 0 && (
        <span
          className="nodrag pointer-events-auto absolute -left-[46px] top-[34px] cursor-help rounded-full border border-slate-300 bg-white px-1.5 text-[10px] font-bold text-slate-700 shadow"
          title={`Le llegan ${colitasQueLlegan.length} conexión(es) inalámbrica(s). Pasa el ratón para ver de dónde.`}
          onMouseEnter={() => ctx.setVerEntrantes(f.id)}
          onMouseLeave={() => ctx.setVerEntrantes(null)}
        >
          ← {colitasQueLlegan.length}
        </span>
      )}
      <div className={`flex cursor-pointer items-center gap-2 rounded-t-[6px] ${a.color} px-2 py-1.5 text-white`} title={`${ctx.numeroDe[f.id] ?? ""} ${titulo}\nDoble clic para abrirla`.trim()}>
        {avisos.length > 0 && (
          <span
            title={avisos.join("\n")}
            className="shrink-0 cursor-help rounded bg-amber-400 px-1 text-xs font-bold text-amber-950"
            onDoubleClick={(e) => e.stopPropagation()}
          >
            ⚠
          </span>
        )}
        {ctx.numeroDe[f.id] !== undefined && (
          <span className="shrink-0 rounded-full bg-white/90 px-1.5 text-[11px] font-black leading-[18px] text-slate-900" title="Número de la ficha">
            {ctx.numeroDe[f.id]}
          </span>
        )}
        <span className="shrink-0 text-xs">{a.icono}</span>
        {/* EL HINT DEL TÍTULO (01/11/2026): «que aparezca completo al pasar el mouse… algo que me indique el nombre
            para no tener que clickear», en TODAS las fichas: su tipo, el título entero y lo que cobra, entrega o
            presenta. */}
        {/* AL INSTANTE (01/11/2026, «el hint se demora mucho en aparecer, debería ser de inmediato»): ya no es el
            «title» del navegador (tarda ~1 s) sino una cajita propia que sale apenas pasa el ratón. */}
        {/* (El recorte «…» va en el texto, no en la caja: si no, el hint quedaba cortado y no se veía.) */}
        <span className="group/hint relative min-w-0 text-xs font-bold">
          <span className="block truncate">{titulo}</span>
          <span className="pointer-events-none absolute left-0 top-full z-[60] mt-1 hidden w-max max-w-[320px] whitespace-pre-line rounded-md bg-slate-900 px-2 py-1.5 text-[11px] font-semibold leading-4 text-white shadow-xl group-hover/hint:block">
            {hintDeLaFicha}
          </span>
        </span>
        {tenue && <span className="ml-auto shrink-0 text-[10px]">APAGADA</span>}
        <span className={`${tenue ? "" : "ml-auto"} flex shrink-0 items-center gap-1`}>
          <button
            type="button"
            title="Ajustes de la ficha"
            className="nodrag rounded px-1 text-sm leading-none text-white/90 hover:bg-white/20 hover:text-white"
            onClick={(e) => {
              e.stopPropagation();
              ctx.ajustes(f.id);
            }}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            ⚙
          </button>
          <button
            type="button"
            title="Duplicar aquí al lado"
            className="nodrag rounded px-1 text-sm leading-none text-white/90 hover:bg-white/20 hover:text-white"
            onClick={(e) => {
              e.stopPropagation();
              const c = copiarFichas([f], [], sinEncimarse(ctx.tablero.fichas, f, { x: 40, y: 260 }));
              ctx.cambiar({ ...ctx.tablero, fichas: [...ctx.tablero.fichas, ...c.fichas] });
            }}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            ⧉
          </button>
          <button
            type="button"
            title="Eliminar"
            className="nodrag rounded px-1 text-sm leading-none text-white/90 hover:bg-white/20 hover:text-white"
            onClick={(e) => {
              e.stopPropagation();
              if (!window.confirm(`¿Eliminar «${f.titulo?.trim() || a.nombre}» y sus cables?`)) return;
              ctx.cambiar({
                ...ctx.tablero,
                fichas: ctx.tablero.fichas.filter((x) => x.id !== f.id),
                cables: ctx.tablero.cables.filter((c) => c.de !== f.id && c.a !== f.id),
              });
            }}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            🗑
          </button>
        </span>
      </div>
      {/* (La Entrega ya dice en su cuerpo «Entrega: …»: aquí solo el Cobro y la ficha que cobra sola.) */}
      {productoEnLaTarjeta && (
        <div className="truncate border-b border-slate-200 bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-900" title={productoALaVista}>
          💰 {productoEnLaTarjeta}
        </div>
      )}
      <div className="flex flex-col gap-1 px-2 pt-1.5">
        {burbujas.slice(0, BURBUJAS_A_LA_VISTA).map((b, i) => (
          <div key={i}>
            <div
              className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-1 text-[11px]"
              // DOBLE CLIC EN UNA BURBUJA: la ficha se abre en ella, como en la pizarra.
              onDoubleClick={
                f.tipo === "intro_ob"
                  ? undefined
                  : (e) => {
                      e.stopPropagation();
                      ctx.abrir(f.id, b.indice);
                    }
              }
              title={`${b.texto || "(sin texto)"}${f.tipo === "intro_ob" ? "" : "\n\nDoble clic: abrir la ficha en esta burbuja"}`}
            >
              <span className="shrink-0">{b.icono}</span>
              <span className="truncate">{b.texto || "(sin texto)"}</span>
            </div>
            {b.espera > 0 && i < burbujas.length - 1 && <div className="pl-2 pt-0.5 text-[10px] text-slate-500">⏱ {b.espera} s</div>}
          </div>
        ))}
        {burbujas.length > BURBUJAS_A_LA_VISTA && (
          <div className="text-[10px] font-semibold text-slate-500">+ {burbujas.length - BURBUJAS_A_LA_VISTA} burbuja(s) más</div>
        )}
        {/* El Cobro con burbujas se ve como las demás: solo sus burbujas (27/10/2026). */}
        {(burbujas.length === 0 || (f.tipo !== "mensaje" && f.tipo !== "intro_ob" && f.tipo !== "cobro")) && (
          <div className={`whitespace-pre-line text-[11px] ${burbujas.length === 0 ? "italic" : ""} text-slate-600`}>{ctx.resumenDe(f)}</div>
        )}
        {/* LA NOTA PARA LA IA, A LA VISTA (10/11/2026, su FIGURARTE: una nota de la ficha de ejemplo viajó en sus copias
            como una línea violeta cortada y nadie la vio; la IA le ofreció muestras a un cliente que pedía el número).
            Recuadro con su nombre y dos líneas: al duplicar la ficha se ve que la copia se la lleva. */}
        {f.instrucciones?.trim() && (
          <div className="rounded-md border border-violet-300 bg-violet-50 px-1.5 py-1 text-[11px] text-violet-900" title={`Nota para la IA en esta ficha (⚙ para editarla):\n\n${f.instrucciones}`}>
            <span className="font-bold">🧠 Nota para la IA: </span>
            <span className="line-clamp-2 inline">{f.instrucciones}</span>
          </div>
        )}
        {f.tipo === "entregar" && f.por_correo && <div className="text-[11px] text-cyan-700">📧 Ofrece también por correo</div>}
        {/* Con burbujas a la vista, el resumen no sale; lo que presenta sí (la IA solo sabe eso). */}
        {burbujas.length > 0 && (f.tipo === "mensaje" || f.tipo === "intro_ob") && (f.presenta ?? []).length > 0 && (
          <div className="truncate text-[11px] text-slate-600">🏷 Presenta: {(f.presenta ?? []).map((id) => ctx.nombres[id] ?? id).join(", ")}</div>
        )}
      </div>
      {ctx.estaciones && f.tipo === "seguimientos" && (
        // Naranja como los cables de Seguimientos, y por encima de las filas: la de «Terminaron» lo tapaba a medias (05/11/2026).
        <Handle type="target" position={Position.Bottom} id="abajo" className={`${PUNTO_NARANJA} !z-20`} />
      )}
      {visibles.length > 0 && f.tipo !== "seguimientos" && !(ctx.estaciones && esEstacion(f, ctx.tablero)) && (
        // LAS SALIDAS, APARTE DEL CONTENIDO (10/11/2026). Él: «hay que poner esa parte diferente al resto, ya que eso no es
        // parte del contenido de la ficha, es una función». Franja gris con su letrero; solo pantalla.
        <div className="mt-1.5 flex flex-col gap-1 rounded-b-lg border-t-2 border-slate-300 bg-slate-100 px-2 pb-1.5 pt-1">
          <div className="text-[9px] font-bold uppercase tracking-wide text-slate-500">Qué hace después</div>
          {visibles.map((s) => pastilla(s, true, s.clave))}
          {/* LO QUE HACE SOLA ESTA FICHA, A LA VISTA (27/10/2026: «si hace algo y no se ve, es el muro»). Sin
              punto: el cliente se queda aquí. */}
          {(() => {
            const cobrosDestino = new Set(
              visibles
                .filter((s) => s.clave.startsWith("btn:") || s.clave.startsWith("dec:"))
                .map((s) => destinoDe(s.clave))
                .filter((x) => x?.tipo === "cobro")
                .map((x) => x!.id)
            );
            const quedarse = [
              ...(cobrosDestino.size > 1 ? [["💳 Quiere pagar sin elegir", "le pregunto cuál quiere, con sus precios"]] : []),
              ...(f.tipo === "cobro" && f.cobro?.metodos ? [["💳 Nombra un método", "le mando sus datos con este precio"]] : []),
            ];
            return quedarse.map(([que, hace]) => (
              <div
                key={que}
                className="flex items-center gap-1.5 rounded-full border border-dashed border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600"
                title={`${que}: ${hace}. El cliente se queda en esta ficha (no lleva a otra).`}
              >
                <span className="truncate">
                  {que} <span className="font-normal">↺ {hace}</span>
                </span>
              </div>
            ));
          })()}
        </div>
      )}
      {/* LA CAJA DE SEGUIMIENTOS, FILA POR FILA (27/10/2026): cada seguimiento con su número, sus minutos
          y sus propias opciones. Una opción que se repite en otro seguimiento es el MISMO cable: su
          puntito está en la primera; en las demás se ve a dónde va. */}
      {f.tipo === "seguimientos" && (
        <div className="mt-1.5 flex flex-col gap-1 border-t border-slate-200 px-2 py-1.5">
          {(() => {
            const yaPuestas = new Set<string>();
            const porClave = new Map(visibles.map((s) => [s.clave, s]));
            const filas = filasDeSeguimientos(f);
            return filas.map((fila) => (
              <div key={fila.n} className="flex flex-col gap-1">
                <div className="flex items-center gap-1.5 rounded-md border border-orange-200 bg-orange-50 px-2 py-1 text-[11px] font-bold text-orange-900">
                  ⏳ Seguimiento {fila.n} <span className="font-semibold text-orange-700">· {minutosLegibles(fila.minutos)}</span>
                </div>
                {fila.claves.flatMap((clave) => {
                  const s = porClave.get(clave);
                  if (!s) return [];
                  const primera = !yaPuestas.has(clave);
                  yaPuestas.add(clave);
                  const gemelos = filas.filter((x) => x.n !== fila.n && x.claves.includes(clave)).map((x) => x.n);
                  return [<div key={`${fila.n}-${clave}`} className="pl-3">{pastilla(s, primera, `${fila.n}-${clave}`, gemelos)}</div>];
                })}
              </div>
            ));
          })()}
          {/* SIN LÍNEAS AUTOMÁTICAS (01/11/2026). Él: «esas conexiones automáticas me cagan, me marean». En su lugar,
              solo el nombre de su ficha master (él: «no le pongas que continúa de tal o tal, solo cuál es su ficha
              master»). El bot no cambia. */}
          {(() => {
            const padres = ctx.tablero.cables
              .filter((c) => c.a === f.id && (c.salida === "siguiente" || c.salida === "sin_respuesta" || c.salida === "sin_pago"))
              .map((c) => ctx.tablero.fichas.find((x) => x.id === c.de))
              .filter((x): x is FichaEnElEditor => !!x && !x.guardada);
            if (!padres.length) return null;
            // «👑 MASTER» (01/11/2026, su palabra): la ficha de la que son accesorios. «Si compra sigue por los cables de…»
            // hacía pensar que el cliente regresaba allí.
            const nombres = [...new Set(padres.map((p) => `${ctx.numeroDe[p.id] !== undefined ? `ficha ${ctx.numeroDe[p.id]} · ` : ""}${p.titulo?.trim() || ASPECTO[p.tipo].nombre}`))].join(", ");
            return (
              <div
                className="flex items-start gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-bold leading-4 text-amber-900"
                title="Estos seguimientos son recordatorios de su master. Si el cliente responde, decide el master con sus botones, cuadritos o el nombre del producto (y los botones propios de estos seguimientos, si los tienen)."
              >
                👑 Master: {nombres}
              </div>
            );
          })()}
          {visibles.filter((s) => !s.clave.startsWith("btn:") && !s.clave.startsWith("dec:")).map((s) => pastilla(s, true, s.clave))}
        </div>
      )}
      {salidas.length === 0 && (
        <div className="mt-1.5 border-t border-slate-200 px-2 py-1 text-[10px] text-slate-500">🏁 Aquí termina esta ruta</div>
      )}
    </div>
  );
  // MODO ESTACIONES: la ficha y su estación son UN SOLO BLOQUE (se arrastran juntas).
  if (!(ctx.estaciones && esEstacion(f, ctx.tablero))) return tarjeta;
  // SE ELIGE SOLO TOCANDO ALGO SUYO (01/11/2026). Él: «al seleccionar solo "su aire" se selecciona y es incómodo,
  // no puedo mover con la manito». El aire entre la ficha, el agente y sus caminos no atrapa el ratón (el nodo
  // tampoco: ver `pointerEvents` al armar los nodos); la ficha, el agente, sus puntos y sus caminos, sí.
  return (
    <div className="pointer-events-none flex items-center">
      <div className="pointer-events-auto">{tarjeta}</div>
      <EstacionDeLaFicha f={f} espejo={espejo} />
    </div>
  );
}

// ── EL FONDO DE UN PAÍS Y LAS CAJAS ───────────────────────────────────────────

/**
 * LA ZONA SOMBREADA DE LO ELEGIDO (24/10/2026), la misma de la pizarra (`ZonaDeLaSeleccion` en
 * LienzoDePizarra): «sí se selecciona, solo que no se ve bien». Con dos o más fichas elegidas se
 * pinta el recuadro que las abarca, también al elegir con Shift + clic. Solo dibuja: no atrapa clics.
 */
function ZonaDeLaSeleccion() {
  const nodos = useNodes();
  const laSuya = useStore((s) => s.nodesSelectionActive || s.userSelectionActive);
  const elegidas = nodos.filter((n) => n.selected && n.type !== "caja");
  if (laSuya || elegidas.length < 2) return null;
  const x0 = Math.min(...elegidas.map((n) => n.position.x));
  const y0 = Math.min(...elegidas.map((n) => n.position.y));
  const x1 = Math.max(...elegidas.map((n) => n.position.x + (n.measured?.width ?? 250)));
  const y1 = Math.max(...elegidas.map((n) => n.position.y + (n.measured?.height ?? 200)));
  return (
    <ViewportPortal>
      <div
        className="react-flow__nodesselection-rect"
        style={{ position: "absolute", transform: `translate(${x0}px, ${y0}px)`, width: x1 - x0, height: y1 - y0, pointerEvents: "none" }}
      />
    </ViewportPortal>
  );
}

/**
 * LA LÍNEA QUE APARECE Y DESAPARECE DE UN «A DÓNDE VA» (14/11/2026). Él: «necesito… un cable tipo esos cables que aparecen
 * y desaparecen». Con el ratón sobre la pastilla «💰 cobro 85» de una opción sin cable dibujado ahí, se ve la línea hasta
 * su ficha, como la de una colita. Fuera del contexto del lienzo a propósito: pasar el ratón no vuelve a dibujar las fichas.
 */
type LineaAlDestino = { el: HTMLElement; a: string; color: string } | null;
let lineaAlDestino: LineaAlDestino = null;
const oyentesDeLaLinea = new Set<() => void>();
const ponerLineaAlDestino = (v: LineaAlDestino) => {
  lineaAlDestino = v;
  oyentesDeLaLinea.forEach((o) => o());
};
function LineaAlDestinoVisible() {
  const v = useSyncExternalStore(
    (o) => {
      oyentesDeLaLinea.add(o);
      return () => oyentesDeLaLinea.delete(o);
    },
    () => lineaAlDestino,
    () => null
  );
  const { screenToFlowPosition } = useReactFlow();
  const zoom = useStore((s) => s.transform[2]);
  const nodo = useInternalNode(v?.a ?? "");
  if (!v || !nodo || !v.el.isConnected) return null;
  const r = v.el.getBoundingClientRect();
  const s = screenToFlowPosition({ x: r.right, y: r.top + r.height / 2 });
  const tx = nodo.internals.positionAbsolute.x;
  const ty = nodo.internals.positionAbsolute.y + (nodo.measured?.height ?? 200) / 2;
  const [camino] = getBezierPath({ sourceX: s.x, sourceY: s.y, sourcePosition: Position.Right, targetX: tx, targetY: ty, targetPosition: Position.Left });
  const z = Math.max(zoom, 0.05);
  return (
    <ViewportPortal>
      <svg style={{ position: "absolute", left: 0, top: 0, width: 1, height: 1, overflow: "visible", pointerEvents: "none", zIndex: 1000 }}>
        <path d={camino} fill="none" stroke={v.color} strokeWidth={3.5 / z} strokeDasharray={`${9 / z} ${6 / z}`} opacity={0.85} />
        <circle cx={tx} cy={ty} r={6 / z} fill={v.color} />
      </svg>
    </ViewportPortal>
  );
}

/** La palabra corta de cada tipo de ficha, para «a dónde va» (14/11/2026: «que diga va a cobro»). */
const PALABRA_DEL_TIPO: Record<TipoDeFicha, string> = {
  inicio: "inicio",
  mensaje: "mensaje",
  seguimientos: "seguimientos",
  intro_ob: "order bump",
  entregar: "entrega",
  cobro: "cobro",
  condicion: "condición",
  reparto: "ruteador",
  esperar: "esperar",
  workflow: "workflow",
  regalo: "regalo",
  humano: "asesor",
  correo: "correo",
};

/** Para el buscador: sin tildes ni mayúsculas. */
const paraBuscar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Todos los textos de una ficha (título, resumen y lo escrito en sus burbujas), para el buscador. */
function textosDe(valor: unknown, salida: string[] = []): string[] {
  if (typeof valor === "string") salida.push(valor);
  else if (Array.isArray(valor)) for (const v of valor) textosDe(v, salida);
  else if (valor && typeof valor === "object") for (const v of Object.values(valor)) textosDe(v, salida);
  return salida;
}

type DatosDeCaja = {
  caja: NonNullable<Tablero["cajas"]>[number];
  tema: "claro" | "oscuro";
  elegida: boolean;
  /** Con Shift/Ctrl se suma a lo elegido; sin, queda solo el velo. */
  alElegir: (sumar?: boolean) => void;
  alCambiar: (c: NonNullable<Tablero["cajas"]>[number]) => void;
  /** Borrar la caja (las fichas de encima se quedan). */
  alBorrar: () => void;
  /** LA MANTA DE UN PAÍS (24/10/2026): su bandera de título y «▶ Ver recorrido», como en la pizarra. */
  manta?: { titulo: string; mirando: boolean; alVer: () => void; pais?: string; ocupados?: string[]; alCambiarPais?: (pais: string) => void };
  /** VELO COMÚN ↔ VELO DE PAÍS (12/11/2026). Los países que ya tienen su área con velo (no se ofrecen). */
  paisesConArea?: string[];
  /** Un velo común pasa a ser el de ese país: se une a su Inicio, o se le crea uno sin conectar. */
  alHacerDePais?: (pais: string) => void;
  /** Un velo de país vuelve a ser común (su Inicio se queda donde está). */
  alHacerComun?: () => void;
  selectorDeColor?: (valor: string, alElegir: (color: string) => void) => ReactNode;
};

/** «#rrggbb» + transparencia: el velo sigue siendo velo, solo teñido de su color. */
const conTransparencia = (hex: string, alfa: number) =>
  `${hex}${Math.round(alfa * 255)
    .toString(16)
    .padStart(2, "0")}`;

/** El selector de país de una manta (doble clic en su bandera), con buscador como el de las tiendas. */
function ElegirPaisDeLaManta({
  actual,
  ocupados,
  donde,
  onElegir,
  onCerrar,
  titulo = "Cambiar el país de esta área",
  extras = [],
}: {
  /** El país de ahora; `null` = un velo común (ningún país marcado). */
  actual: string | null;
  ocupados: string[];
  /** Dónde está el título en la pantalla: la lista va justo debajo, ENCIMA de todo (el velo está detrás de las fichas). */
  donde: { x: number; y: number };
  onElegir: (p: string) => void;
  onCerrar: () => void;
  titulo?: string;
  /** Opciones arriba de la lista («✏️ Renombrar», «⬜ Sin país»). */
  extras?: Array<{ texto: string; alElegir: () => void }>;
}) {
  const [busca, setBusca] = useState("");
  const normal = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{Mn}/gu, "");
  const q = normal(busca.trim());
  const lista = [
    { code: "", nombre: "🌍 Otros países" },
    ...Object.entries(COUNTRIES).map(([code, c]) => ({ code, nombre: `${banderaDe(code)} ${(c as { label?: string }).label ?? code}` })),
  ].filter((x) => !q || normal(`${x.nombre} ${x.code}`).includes(q));
  return createPortal(
    <div
      ref={(el) => encajarEnLaPantalla(el)}
      className="nodrag nopan nowheel fixed z-[400] w-72 rounded-lg border border-slate-300 bg-white p-2 text-slate-800 shadow-2xl"
      style={{ left: donde.x, top: donde.y }}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="mb-1 flex items-center justify-between text-xs font-bold text-slate-600">
        {titulo}
        <button type="button" onClick={onCerrar} className="rounded px-1.5 hover:bg-slate-100" title="Cerrar (Esc)">
          ✕
        </button>
      </div>
      {extras.map((x) => (
        <button
          key={x.texto}
          type="button"
          onClick={x.alElegir}
          className="mb-1 block w-full rounded border border-slate-200 bg-slate-50 px-2 py-1 text-left text-sm font-semibold hover:bg-slate-100"
        >
          {x.texto}
        </button>
      ))}
      <input
        autoFocus
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCerrar();
          e.stopPropagation();
        }}
        placeholder="🔍 Buscar país…"
        className="mb-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
      />
      <div className="max-h-64 overflow-y-auto">
        {lista.map((x) => {
          const ocupado = x.code !== actual && ocupados.includes(x.code);
          return (
            <button
              key={x.code || "otros"}
              type="button"
              disabled={ocupado || x.code === actual}
              onClick={() => onElegir(x.code)}
              title={ocupado ? "Ese país ya tiene su área (su Inicio) en este tablero" : undefined}
              className={`block w-full rounded px-2 py-1 text-left text-sm ${
                x.code === actual ? "bg-blue-600 font-bold text-white" : ocupado ? "cursor-not-allowed text-slate-400" : "hover:bg-slate-100"
              }`}
            >
              {x.nombre}
              {ocupado && <span className="ml-1 text-[11px]">· ya tiene su área</span>}
            </button>
          );
        })}
        {lista.length === 0 && <p className="px-2 py-1 text-xs italic text-slate-500">Ningún país se llama así.</p>}
      </div>
    </div>,
    document.body
  );
}

/**
 * UNA SOLA PALETA DE COLOR A LA VEZ (13/11/2026). Él: «cuando toco otro velo y toco "color" aparece otra paleta
 * flotante… debería aparecer la nueva paleta y la anterior desaparece». Cada velo (y cada texto de la «T») tenía la
 * suya; ahora, al abrir una, se avisa y las demás se cierran.
 */
const PALETA_ABIERTA = "tablero:paleta-abierta";
function useUnaSolaPaleta(): [{ x: number; y: number } | null, (p: { x: number; y: number } | null) => void] {
  const [pintando, setPintando] = useState<{ x: number; y: number } | null>(null);
  const yo = useRef({});
  useEffect(() => {
    const otraSeAbrio = (e: Event) => {
      if ((e as CustomEvent).detail !== yo.current) setPintando(null);
    };
    window.addEventListener(PALETA_ABIERTA, otraSeAbrio);
    return () => window.removeEventListener(PALETA_ABIERTA, otraSeAbrio);
  }, []);
  const poner = (p: { x: number; y: number } | null) => {
    if (p) window.dispatchEvent(new CustomEvent(PALETA_ABIERTA, { detail: yo.current }));
    setPintando(p);
  };
  return [pintando, poner];
}

function NodoDeCaja({ data, selected }: NodeProps<Node<DatosDeCaja>>) {
  const t = TEMA[data.tema];
  const manta = data.manta;
  const [eligiendoPais, setEligiendoPais] = useState<{ x: number; y: number } | null>(null);
  // ELEGIDO TAMBIÉN EN EL RECUADRO SE VE (10/11/2026, él: «al pegar solo pega las fichas, los velos no
  // aparecen»): el velo que entraba en la selección no se marcaba, y el que quedaba fuera tampoco se notaba.
  const marcada = data.elegida || !!selected;
  // EL COLOR DEL VELO (13/11/2026). Él: «me estoy confundiendo qué velo corresponde a cada país… darle color al velo,
  // pero… seguirá siendo velo». Teñido transparente y un filo de su color; sin color, el de siempre. Solo pantalla.
  const color = /^#[0-9a-f]{6}$/i.test(String(data.caja.color ?? "").trim()) ? String(data.caja.color).trim() : "";
  const [pintando, setPintando] = useUnaSolaPaleta();
  const abrirColor = (r: DOMRect) => setPintando({ x: r.left, y: r.bottom + 6 });
  return (
    <div className="h-full w-full" style={{ pointerEvents: "none" }}>
      {/* Sus cuatro esquinas viven en `NodoDeEsquinas`, ENCIMA de las fichas. */}
      <div
        className="h-full w-full rounded-2xl"
        style={{
          background: color ? conTransparencia(color, data.tema === "oscuro" ? 0.24 : 0.16) : t.caja,
          boxShadow: color ? `inset 0 0 0 4px ${conTransparencia(color, 0.75)}` : undefined,
          outline: marcada ? `3px solid ${t.tituloCaja}` : "none",
          pointerEvents: "none",
        }}
      >
        <div
          onClick={(e) => {
            e.stopPropagation();
            data.alElegir(e.shiftKey || e.ctrlKey || e.metaKey);
          }}
          onDoubleClick={(e) => {
            // La manta de un país se llama por su bandera: no se renombra; con doble clic se cambia su PAÍS (12/11/2026).
            // Un velo común: renombrarlo, o hacerlo velo de un país.
            e.stopPropagation();
            const r = e.currentTarget.getBoundingClientRect();
            setEligiendoPais({ x: r.left, y: r.bottom + 6 });
          }}
          className={`ml-5 mt-3 inline-block cursor-pointer rounded-md px-1 text-sm font-bold uppercase tracking-wide ${data.elegida ? "underline" : ""}`}
          style={{ color: t.tituloCaja, pointerEvents: "all" }}
          title={
            manta
              ? "La manta de este país · clic para elegirla (Delete la borra; las fichas se quedan) · doble clic para cambiar su país · estírala desde sus esquinas"
              : "Clic para elegirla (Delete la borra) · doble clic para renombrarla · arrástrala desde sus esquinas"
          }
        >
          {manta ? manta.titulo : data.caja.titulo || "Caja"}
        </div>
        {manta?.alCambiarPais && eligiendoPais && (
          <ElegirPaisDeLaManta
            actual={manta.pais ?? ""}
            ocupados={manta.ocupados ?? []}
            donde={eligiendoPais}
            onCerrar={() => setEligiendoPais(null)}
            extras={[
              ...(data.selectorDeColor
                ? [
                    {
                      texto: "🎨 Color del velo",
                      alElegir: () => {
                        setPintando(eligiendoPais);
                        setEligiendoPais(null);
                      },
                    },
                  ]
                : []),
              ...(data.alHacerComun
                ? [
                    {
                      texto: "⬜ Sin país (velo común)",
                      alElegir: () => {
                        setEligiendoPais(null);
                        if (!window.confirm("¿Volver este velo a uno común, sin país?\n\nSu Inicio se queda donde está (si quieres quitarlo, clic derecho → «🗑 Quitar país»). Ctrl+Z lo deshace.")) return;
                        data.alHacerComun?.();
                      },
                    },
                  ]
                : []),
            ]}
            onElegir={(p) => {
              const de = manta.pais ? `${banderaDe(manta.pais)} ${manta.pais}` : "🌍 Otros países";
              const a = p ? `${banderaDe(p)} ${p}` : "🌍 Otros países";
              setEligiendoPais(null);
              if (!window.confirm(`¿Cambiar esta área de ${de} a ${a}?\n\nDesde ahora los clientes de ${a} entran por este Inicio (los de ${de} ya no). Ctrl+Z lo deshace.`)) return;
              manta.alCambiarPais?.(p);
            }}
          />
        )}
        {!manta && eligiendoPais && (
          <ElegirPaisDeLaManta
            actual={null}
            ocupados={data.paisesConArea ?? []}
            donde={eligiendoPais}
            titulo="Este velo"
            onCerrar={() => setEligiendoPais(null)}
            extras={[
              {
                texto: "✏️ Renombrar",
                alElegir: () => {
                  setEligiendoPais(null);
                  const nuevo = window.prompt("Nombre de la caja", data.caja.titulo);
                  if (nuevo !== null) data.alCambiar({ ...data.caja, titulo: nuevo.slice(0, 80) });
                },
              },
              ...(data.selectorDeColor
                ? [
                    {
                      texto: "🎨 Color del velo",
                      alElegir: () => {
                        setPintando(eligiendoPais);
                        setEligiendoPais(null);
                      },
                    },
                  ]
                : []),
            ]}
            onElegir={(p) => {
              const a = p ? `${banderaDe(p)} ${p}` : "🌍 Otros países";
              setEligiendoPais(null);
              if (!window.confirm(`¿Hacer este velo el área de ${a}?\n\nSi ${a} no tiene Inicio, se le crea uno arriba a la izquierda SIN CONECTAR: tírale el cable a la primera ficha. Ctrl+Z lo deshace.`)) return;
              data.alHacerDePais?.(p);
            }}
          />
        )}
        {/* BORRAR LA CAJA O LA MANTA (27/10/2026): «no se pueden borrar». Al elegirla, su botón; las fichas
            de encima se quedan donde están. */}
        {data.elegida && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              data.alBorrar();
            }}
            className="nodrag nopan ml-2 mt-3 inline-block rounded-md border border-red-300 bg-white px-2 py-0.5 align-top text-[11px] font-bold text-red-700 shadow-sm hover:bg-red-50"
            style={{ pointerEvents: "all" }}
            title="Borrar esta caja (las fichas se quedan)"
          >
            🗑 Borrar
          </button>
        )}
        {data.elegida && data.selectorDeColor && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              abrirColor(e.currentTarget.getBoundingClientRect());
            }}
            className="nodrag nopan ml-2 mt-3 inline-block rounded-md border border-slate-300 bg-white px-2 py-0.5 align-top text-[11px] font-bold text-slate-700 shadow-sm hover:bg-slate-50"
            style={{ pointerEvents: "all" }}
            title="El color de este velo (solo para verlo: el bot no lo lee)"
          >
            🎨 Color
          </button>
        )}
        {pintando &&
          data.selectorDeColor &&
          createPortal(
            <div
              ref={(el) => encajarEnLaPantalla(el)}
              className="nodrag nopan nowheel fixed z-[400] rounded-lg border border-slate-300 bg-white p-3 text-slate-800 shadow-2xl"
              style={{ left: pintando.x, top: pintando.y }}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === "Escape") setPintando(null);
              }}
            >
              <div className="mb-2 flex items-center justify-between gap-4 text-xs font-bold text-slate-600">
                🎨 Color del velo
                <button type="button" onClick={() => setPintando(null)} className="rounded px-1.5 hover:bg-slate-100" title="Cerrar">
                  ✕
                </button>
              </div>
              {data.selectorDeColor(color, (c) => {
                const { color: _quitado, ...sinColor } = data.caja;
                void _quitado;
                data.alCambiar(c ? { ...data.caja, color: c } : sinColor);
              })}
            </div>,
            document.body
          )}
        {/* «▶ VER RECORRIDO», como en la pizarra: su ruta se ilumina y lo demás queda tenue. */}
        {manta && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              manta.alVer();
            }}
            className={`nodrag nopan ml-2 mt-3 inline-block rounded-md border px-2 py-0.5 align-top text-[11px] font-semibold shadow-sm ${
              manta.mirando ? "border-amber-400 bg-amber-100 text-amber-900" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
            }`}
            style={{ pointerEvents: "all" }}
            title="Ilumina la ruta de este país (solo vista: no cambia nada)"
          >
            {manta.mirando ? "✕ Ver todo" : "▶ Ver recorrido"}
          </button>
        )}
      </div>
    </div>
  );
}

// ── EL CABLE: punteado, se estira como goma, ✕ al pasar el ratón ──────────────

function caminoDeGoma(sx: number, sy: number, tx: number, ty: number, corrimiento: Punto): [string, number, number] {
  const k = Math.max(60, Math.abs(tx - sx) / 2);
  const dx = corrimiento.x / 0.75;
  const dy = corrimiento.y / 0.75;
  const d = `M ${sx},${sy} C ${sx + k + dx},${sy + dy} ${tx - k + dx},${ty + dy} ${tx},${ty}`;
  return [d, (sx + tx) / 2 + corrimiento.x, (sy + ty) / 2 + corrimiento.y];
}

function CableDelTablero(props: EdgeProps) {
  // EL CABLE COMO ETIQUETA (26/10/2026, tipo Sendy/Kommo): un regreso («↩ 7») o el que va al Regalo
  // («🎁 Regalo») no cruza la pizarra. Se ve un trazo corto con su etiqueta; al pasar el ratón, la línea
  // completa. El cable es el mismo: solo cambia cómo se dibuja.
  const datos = props.data as { etiqueta?: string; colorDestino?: string; tenue?: boolean } | undefined;
  if (datos?.etiqueta) return <CableComoEtiqueta {...props} etiqueta={datos.etiqueta} colorDestino={datos.colorDestino} tenue={datos.tenue} />;
  return <CableCompleto {...props} />;
}

function CableComoEtiqueta({
  id,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  etiqueta,
  colorDestino,
  tenue,
}: EdgeProps & { etiqueta: string; colorDestino?: string; tenue?: boolean }) {
  const ctx = useContext(Contexto);
  const [encima, setEncima] = useState(false);
  const zoom = useStore((s) => s.transform[2]);
  const [completo] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  const corto = `M ${sourceX} ${sourceY} L ${sourceX + 26} ${sourceY}`;
  // LA LÍNEA DE LA COLITA (al pasar el ratón, o por el «← 3» de su destino): del MISMO GROSOR en la
  // pantalla, cerca o lejos (27/10/2026: «si se adelgaza con la distancia, no veo a dónde conecta»).
  const verLinea = encima || ctx?.verEntrantes === target;
  const grosor = 3.5 / Math.max(zoom, 0.05);
  return (
    <>
      <BaseEdge id={id} path={corto} interactionWidth={0} style={{ ...style, strokeWidth: 4, strokeDasharray: undefined, opacity: tenue ? 0.4 : 1 }} />
      {verLinea && (
        <BaseEdge
          id={`${id}-completo`}
          path={completo}
          interactionWidth={0}
          style={{ ...style, strokeWidth: grosor, strokeDasharray: `${9 / Math.max(zoom, 0.05)} ${6 / Math.max(zoom, 0.05)}`, opacity: 0.8 }}
        />
      )}
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan absolute flex max-w-[230px] cursor-pointer items-center gap-1 rounded-full border-2 bg-white px-2 py-0.5 text-[11px] font-bold text-slate-800 shadow"
          style={{
            transform: `translate(0, -50%) translate(${sourceX + 28}px, ${sourceY}px)`,
            pointerEvents: "all",
            // EL BORDE, DEL COLOR DE LA FICHA A LA QUE LLEGA (27/10/2026): magenta = va al Regalo.
            borderColor: colorDestino ?? String(style?.stroke ?? "#94a3b8"),
            opacity: tenue ? 0.5 : 1,
          }}
          onMouseEnter={() => setEncima(true)}
          onMouseLeave={() => setEncima(false)}
          // TOCARLA ILUMINA EL BORDE DE SU DESTINO; la vista no se mueve. Otro toque lo apaga.
          onClick={(e) => {
            e.stopPropagation();
            ctx?.destacar(ctx.destacada === target ? null : target);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            ctx?.menu(e.clientX, e.clientY, { tipo: "cable", cableId: id });
          }}
          title={`${etiqueta}${tenue ? " (apagada)" : ""}\nClic: ilumina su destino · pasa el ratón: ves la línea · clic derecho: volver cable o cortar`}
        >
          <span className="truncate">{etiqueta}</span>
          {encima && (
            <button
              type="button"
              title="Cortar esta conexión"
              onClick={(e) => {
                e.stopPropagation();
                if (!ctx) return;
                ctx.cambiar({ ...ctx.tablero, cables: ctx.tablero.cables.filter((c) => c.id !== id) });
              }}
              className="ml-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-600 text-[10px] text-white"
            >
              ✕
            </button>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

function CableCompleto({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style }: EdgeProps) {
  const ctx = useContext(Contexto);
  const [encima, setEncimaYa] = useState(false);
  const reloj = useRef<number | null>(null);
  const setEncima = (v: boolean) => {
    if (reloj.current) window.clearTimeout(reloj.current);
    reloj.current = null;
    if (v) setEncimaYa(true);
    else reloj.current = window.setTimeout(() => setEncimaYa(false), 180);
  };
  const zoom = useStore((s) => s.transform[2]);
  const guardado = ctx?.tablero.curvas?.[id];
  const [jalando, setJalando] = useState<Punto | null>(null);
  const corrimiento = jalando ?? guardado ?? null;
  const [recto, xRecto, yRecto] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  const [camino] = corrimiento ? caminoDeGoma(sourceX, sourceY, targetX, targetY, corrimiento) : [recto, xRecto, yRecto];
  const medidor = useRef<SVGPathElement>(null);
  const [punto, setPunto] = useState({ x: xRecto, y: yRecto });
  useEffect(() => {
    const p = medidor.current;
    if (!p) return;
    try {
      const q = p.getPointAtLength(p.getTotalLength() / 3);
      if (Number.isFinite(q.x) && Number.isFinite(q.y)) setPunto({ x: q.x, y: q.y });
    } catch {}
  }, [camino]);
  const alJalar = (e: React.PointerEvent) => {
    if (e.button !== 0 || !ctx) return;
    e.stopPropagation();
    const inicio = { x: e.clientX, y: e.clientY };
    const desde = guardado ?? { x: 0, y: 0 };
    let ultimo: Punto | null = null;
    const mover = (ev: PointerEvent) => {
      const dx = (ev.clientX - inicio.x) / zoom;
      const dy = (ev.clientY - inicio.y) / zoom;
      if (!ultimo && Math.hypot(dx, dy) < 3 / zoom) return;
      ultimo = { x: desde.x + dx, y: desde.y + dy };
      setJalando(ultimo);
    };
    const soltar = () => {
      window.removeEventListener("pointermove", mover);
      window.removeEventListener("pointerup", soltar);
      if (ultimo) ctx.curvar(id, ultimo);
      setJalando(null);
    };
    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", soltar);
  };
  return (
    <>
      <g onMouseEnter={() => setEncima(true)} onMouseLeave={() => setEncima(false)}>
        <path ref={medidor} d={camino} fill="none" stroke="none" />
        <BaseEdge id={id} path={camino} interactionWidth={0} style={{ ...style, strokeWidth: encima ? 6 : 4 }} />
        <path
          d={camino}
          fill="none"
          stroke="transparent"
          strokeWidth={24}
          className="nopan nodrag"
          style={{ cursor: jalando ? "grabbing" : "grab", pointerEvents: "stroke" }}
          onPointerDown={alJalar}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            ctx?.menu(e.clientX, e.clientY, { tipo: "cable", cableId: id });
          }}
        >
          <title>Jálalo para acomodar su recorrido · clic derecho: enderezar o cortar</title>
        </path>
      </g>
      <EdgeLabelRenderer>
        <button
          type="button"
          title="Cortar esta conexión"
          onMouseEnter={() => setEncima(true)}
          onMouseLeave={() => setEncima(false)}
          onClick={(e) => {
            e.stopPropagation();
            if (!ctx) return;
            ctx.cambiar({ ...ctx.tablero, cables: ctx.tablero.cables.filter((c) => c.id !== id) });
          }}
          className="nodrag nopan absolute flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-red-600 text-xs font-bold text-white shadow-lg transition-opacity"
          style={{ transform: `translate(-50%, -50%) translate(${punto.x}px, ${punto.y}px)`, pointerEvents: encima ? "all" : "none", opacity: encima ? 1 : 0 }}
        >
          ✕
        </button>
      </EdgeLabelRenderer>
    </>
  );
}

/**
 * EL CAMINO «🛒 SI COMPRA» DE UNOS SEGUIMIENTOS (31/10/2026). Se dibuja solo (ver `caminosDeCompra`): no se
 * jala ni se corta. Como los demás, cable o colita a elección suya: clic derecho lo cambia (se guarda en la
 * caja de Seguimientos, `vista_compra`). Solo pantalla: el bot no lo lee.
 */
function CaminoDeCompra({ id, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }: EdgeProps) {
  const ctx = useContext(Contexto);
  const [encima, setEncima] = useState(false);
  const zoom = useStore((s) => s.transform[2]);
  const d = data as { seg: string; llave: string; colita: boolean; etiqueta: string; colorDestino?: string };
  const [camino] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  const alternar = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!ctx) return;
    ctx.cambiar({
      ...ctx.tablero,
      fichas: ctx.tablero.fichas.map((f) => (f.id === d.seg ? { ...f, vista_compra: { ...(f.vista_compra ?? {}), [d.llave]: d.colita ? "cable" : "colita" } } : f)),
    });
  };
  const ayuda = `${d.etiqueta}\nLo hace el bot solo (no se jala ni se corta).\nClic: ilumina a dónde va · clic derecho: ${d.colita ? "verlo como cable" : "verlo como colita"}`;
  const estilo = { stroke: "#10b981", strokeDasharray: `${3 / Math.max(zoom, 0.05)} ${6 / Math.max(zoom, 0.05)}` };
  if (d.colita)
    return (
      <>
        <BaseEdge id={id} path={`M ${sourceX} ${sourceY} L ${sourceX + 26} ${sourceY}`} interactionWidth={0} style={{ stroke: "#10b981", strokeWidth: 2.5 }} />
        {encima && <BaseEdge id={`${id}-completo`} path={camino} interactionWidth={0} style={{ ...estilo, strokeWidth: 3 / Math.max(zoom, 0.05), opacity: 0.8 }} />}
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan absolute flex max-w-[230px] cursor-pointer items-center gap-1 rounded-full border-2 bg-white px-2 py-0.5 text-[11px] font-bold text-slate-800 shadow"
            style={{ transform: `translate(0, -50%) translate(${sourceX + 28}px, ${sourceY}px)`, pointerEvents: "all", borderColor: d.colorDestino ?? "#10b981" }}
            onMouseEnter={() => setEncima(true)}
            onMouseLeave={() => setEncima(false)}
            onClick={(e) => {
              e.stopPropagation();
              ctx?.destacar(ctx.destacada === target ? null : target);
            }}
            onContextMenu={alternar}
            title={ayuda}
          >
            <span className="truncate">{d.etiqueta}</span>
          </div>
        </EdgeLabelRenderer>
      </>
    );
  return (
    <>
      <g onMouseEnter={() => setEncima(true)} onMouseLeave={() => setEncima(false)}>
        <BaseEdge id={id} path={camino} interactionWidth={0} style={{ ...estilo, strokeWidth: encima ? 3.5 : 2 }} />
        <path d={camino} fill="none" stroke="transparent" strokeWidth={18} className="nopan nodrag" style={{ pointerEvents: "stroke" }} onContextMenu={alternar}>
          <title>{ayuda}</title>
        </path>
      </g>
      {/* Sin letrero sobre la línea: ya lo dice la caja de Seguimientos (pizarra limpia). */}
    </>
  );
}

/**
 * EL MODO ESTACIONES (01/11/2026). Él, con un montaje de Sendy: «aquí se ve como ordenado, tiene una conexión,
 * una decisión que hace que avance, el resto se queda atrás». SOLO DIBUJO: detrás de cada ficha que espera al
 * cliente aparece su bolita de estación; sus salidas salen de la bolita (afuera, como pastillas) y sus
 * Seguimientos se cuelgan ARRIBA con un cable naranja. Los cables siguen siendo los mismos de la ficha: el bot
 * no cambia y desactivar el modo deja la vista de siempre.
 */
function esEstacion(f: FichaEnElEditor, t?: TableroEnElEditor): boolean {
  if (f.guardada) return false;
  // El 🔀 Ruteador (03/11/2026): «que se parezca a la estación… y que del logo salgan los conectores».
  if (f.tipo === "cobro" || f.tipo === "reparto") return true;
  if (f.tipo !== "mensaje" && f.tipo !== "intro_ob") return false;
  // La que cobra sola (su upsell sin botones, 01/11/2026) también espera: tiene su estación.
  if (cobraEnLaFicha(f as FichaDelTablero, t as Tablero | undefined)) return true;
  const { botones, cuadritos } = opcionesDe(pasosDeLaFicha(f as FichaDelTablero));
  return botones.length + cuadritos.length > 0 || eligeDeLaFicha(f as FichaDelTablero).length > 0 || pideElNombre(f as FichaDelTablero);
}
/** Las salidas de una estación que van ARRIBA, a sus Seguimientos (las que ya llegan a unos, o la que los recibe). */
function salidasDeArriba(t: TableroEnElEditor, f: FichaEnElEditor): Set<string> {
  const arriba = new Set<string>();
  const destino = (salida: string) => {
    const c = t.cables.find((x) => x.de === f.id && x.salida === salida);
    return c ? t.fichas.find((x) => x.id === c.a) : undefined;
  };
  for (const c of t.cables) if (c.de === f.id && t.fichas.find((x) => x.id === c.a)?.tipo === "seguimientos") arriba.add(c.salida);
  // UN SOLO CONECTOR ARRIBA (01/11/2026, «¿por qué la estación 3 tiene 2 conectores arriba?»): si ya cuelga
  // unos Seguimientos por otra salida («Si no responde»), no se ofrece además la vacía.
  if (arriba.size > 0) return arriba;
  const suya = f.tipo === "cobro" ? "sin_pago" : pideElNombre(f as FichaDelTablero) ? "" : "siguiente";
  if (suya && (!destino(suya) || destino(suya)?.tipo === "seguimientos")) arriba.add(suya);
  return arriba;
}
/** Lo que espera la estación, en una frase. */
function queEspera(f: FichaEnElEditor, t?: TableroEnElEditor): string {
  if (f.tipo === "cobro" || cobraEnLaFicha(f as FichaDelTablero, t as Tablero | undefined)) return "¿pagó?";
  if (pideElNombre(f as FichaDelTablero)) return "¿su nombre?";
  if (eligeDeLaFicha(f as FichaDelTablero).length > 0 || f.tipo === "intro_ob" || (f.presenta ?? []).length > 1) return "¿cuál elige?";
  return "¿qué responde?";
}

/** El ON/OFF de una ruta del 🔀 Ruteador (03/11/2026). OFF = peso 0 (el sorteo ya no la elige) y recuerda el que tenía. */
function InterruptorDeRuta({ f, clave }: { f: FichaEnElEditor; clave: string }) {
  const ctx = useContext(Contexto)!;
  const rid = clave.slice(4);
  const ops = f.reparto ?? [];
  const op = ops.find((o) => o.id === rid);
  if (!op) return null;
  const on = op.peso > 0;
  return (
    <button
      type="button"
      className={`nodrag nopan shrink-0 rounded-full px-1.5 py-px text-[9px] font-black leading-none ${on ? "bg-emerald-500 text-white" : "bg-slate-300 text-slate-600"}`}
      title={on ? "Vende: recibe clientes nuevos. Clic: apagarla" : "Apagada: no recibe clientes nuevos. Clic: prenderla"}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        if (on && ops.filter((o) => o.peso > 0).length === 1 && !window.confirm("Es la última ruta prendida de este Ruteador: si la apagas, nadie entra por aquí. ¿Seguro?")) return;
        const nuevas = ops.map((o) =>
          o.id !== rid ? o : on ? { ...o, peso: 0, peso_antes: o.peso } : { ...o, peso: o.peso_antes && o.peso_antes > 0 ? o.peso_antes : 1, peso_antes: undefined }
        );
        ctx.cambiar({ ...ctx.tablero, fichas: ctx.tablero.fichas.map((x) => (x.id === f.id ? { ...x, reparto: nuevas } : x)) });
      }}
    >
      {on ? "ON" : "OFF"}
    </button>
  );
}

/** La estación de una ficha, DENTRO de su mismo bloque (se mueve con ella). Sus salidas son las de la ficha. */
function EstacionDeLaFicha({ f, soloLogo = false, elegida = false, espejo }: { f: FichaEnElEditor; soloLogo?: boolean; elegida?: boolean; espejo?: string }) {
  const ctx = useContext(Contexto)!;
  const leLlega = ctx.tablero.cables.some((c) => c.a === f.id);
  const avisos = soloLogo ? avisosDeLaFicha(ctx.tablero as Tablero, f as FichaDelTablero, ctx.paisVisto) : [];
  const conCable = new Set(ctx.tablero.cables.filter((c) => c.de === f.id).map((c) => c.salida));
  const arriba = salidasDeArriba(ctx.tablero, f);
  const salidas = salidasDeLaFicha(f as FichaDelTablero, ctx.paisVisto, ctx.nombres, ctx.tablero as Tablero).filter(
    (s) =>
      (s.clave !== "otra" || conCable.has("otra")) &&
      !menosSeResuelveSolo(f, s.clave, conCable) &&
      !(s.clave === "sin_respuesta" && arriba.has("siguiente") && conCable.has("siguiente") && !conCable.has("sin_respuesta")) &&
      // Sus Seguimientos ya cuelgan por otra salida: la de «⏳ Seguimientos» vacía no se ofrece.
      !(s.clave === "siguiente" && !conCable.has("siguiente") && !arriba.has("siguiente") && arriba.size > 0)
  );
  const deArriba = salidas.filter((s) => arriba.has(s.clave));
  const aLaDerecha = salidas.filter((s) => !arriba.has(s.clave));
  const faltan = ctx.faltas?.get(f.id);
  const n = ctx.numeroDe[f.id];
  // QUÉ AGENTE SE VE (01/11/2026): Cobro → el cobrador; una oferta después de una Entrega → upsell con su número.
  const nUpsell = f.tipo === "cobro" ? undefined : ctx.upsellDe[f.id];
  const rosa = f.tipo === "reparto";
  const imagenDelAgente = rosa
    ? { src: "/tablero/ruteador.png", nombre: "Ruteador" }
    : f.tipo === "cobro"
      ? { src: "/tablero/cobrador.png", nombre: "Cobrador" }
      : nUpsell !== undefined
        ? { src: "/tablero/upsell.png", nombre: `Upsell ${nUpsell}` }
        : ctx.upgradeDe.has(f.id)
          ? { src: "/tablero/upgrade.png", nombre: "Upgrade" }
          : { src: "/tablero/agente.png", nombre: "Agente IA" };
  return (
    // EL BLOQUE: una barra corta desde la ficha, la estación grande (como en Sendy) y sus caminos afuera.
    <div
      data-estacion
      className="pointer-events-none flex items-center self-center"
      onDoubleClick={(e) => (e.stopPropagation(), soloLogo ? ctx.ajustes(f.id) : ctx.abrir(f.id))}
      onContextMenu={
        soloLogo
          ? (e) => {
              e.preventDefault();
              e.stopPropagation();
              ctx.menu(e.clientX, e.clientY, { tipo: "ficha", fichaId: f.id, ...(espejo ? { espejo } : {}) });
            }
          : undefined
      }
    >
      {/* De la ficha a su estación: el mismo trazo punteado de los cables, del color de la ficha. (Sin ficha, nada.) */}
      {!soloLogo && (
        <svg width={56} height={8} className="shrink-0 overflow-visible">
          <line x1={0} y1={4} x2={56} y2={4} stroke={ASPECTO[f.tipo].trazo} strokeWidth={4} strokeDasharray="10 6" className="pointer-events-auto" />
        </svg>
      )}
      <div className="relative flex flex-col items-center" title={`Estación ${n ?? ""} · ${f.titulo?.trim() || ASPECTO[f.tipo].nombre}\nDoble clic: abrir la ficha`}>
        {/* GRANDE Y NOTORIA, como en Sendy (él: «tiene que haber algo ahí que sea importante y notorio»). */}
        <div
          // El agente, 20 % más grande que la estación (01/11/2026: «hazlo un 20 % más»).
          className={`pointer-events-auto relative flex flex-col items-center justify-center gap-0.5 text-white shadow-xl ${
            ctx.comoAgente
              ? `h-[173px] w-[173px] rounded-2xl border-2 ${rosa ? "border-fuchsia-400" : "border-emerald-400"} bg-white`
              : `h-36 w-36 rounded-full bg-gradient-to-br ${rosa ? "from-fuchsia-300 to-fuchsia-600" : "from-emerald-300 to-emerald-500"}`
          } ${f.apagada ? "opacity-50" : ""} ${elegida ? "ring-4 ring-cyan-400" : ""}`}
          style={ctx.destacada === f.id ? { boxShadow: "0 0 0 5px #f59e0b, 0 0 22px 6px rgba(245,158,11,0.55)" } : undefined}
        >
          <LogoDelCanal />
          {/* COPIAR Y TACHITO, ARRIBA A LA DERECHA (como Sendy, su captura del 03/11/2026). */}
          {soloLogo && (
            <span className="absolute -right-9 top-1 flex flex-col gap-1">
              <button
                type="button"
                title="Duplicar aquí al lado"
                className="nodrag rounded-md p-1 text-[17px] leading-none text-slate-500 hover:bg-slate-200 hover:text-slate-800"
                onClick={(e) => {
                  e.stopPropagation();
                  const c = copiarFichas([f], [], sinEncimarse(ctx.tablero.fichas, f, { x: 40, y: 260 }));
                  ctx.cambiar({ ...ctx.tablero, fichas: [...ctx.tablero.fichas, ...c.fichas] });
                }}
                onDoubleClick={(e) => e.stopPropagation()}
              >
                ⧉
              </button>
              <button
                type="button"
                title="Eliminar"
                className="nodrag rounded-md p-1 text-[16px] leading-none text-slate-500 hover:bg-slate-200 hover:text-red-600"
                onClick={(e) => {
                  e.stopPropagation();
                  if (!window.confirm(`¿Eliminar «${f.titulo?.trim() || ASPECTO[f.tipo].nombre}» y sus cables?`)) return;
                  ctx.cambiar({
                    ...ctx.tablero,
                    fichas: ctx.tablero.fichas.filter((x) => x.id !== f.id),
                    cables: ctx.tablero.cables.filter((c) => c.de !== f.id && c.a !== f.id),
                  });
                }}
                onDoubleClick={(e) => e.stopPropagation()}
              >
                🗑️
              </button>
            </span>
          )}
          {soloLogo && !leLlega && (
            <span className="absolute -top-[24px] left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-red-600 px-1.5 text-[10px] font-bold leading-[16px] text-white shadow" title="No le llega ningún cable: nadie entra por aquí.">
              ⚠ nadie llega
            </span>
          )}
          {avisos.length > 0 && (
            <span title={avisos.join("\n")} className="absolute -left-2 -top-2 cursor-help rounded bg-amber-400 px-1 text-xs font-bold text-amber-950">
              ⚠
            </span>
          )}
          {/* Arriba: a sus Seguimientos. */}
          {deArriba.map((s, i) => (
            <Handle
              key={s.clave}
              type="source"
              position={Position.Top}
              id={s.clave}
              title={`${s.etiqueta}${conCable.has(s.clave) ? "" : "\nSin cable: tíralo hacia sus Seguimientos"}`}
              className={`${PUNTO_NARANJA} ${conCable.has(s.clave) ? "" : "punto-pide-cable"}`}
              style={{ left: `calc(50% + ${(i - (deArriba.length - 1) / 2) * 22}px)` }}
              onClick={(e) => {
                e.stopPropagation();
                ctx.menu(e.clientX, e.clientY, { tipo: "conectar", ficha: f.id, salida: s.clave, ...(espejo ? { espejo } : {}) });
              }}
            />
          ))}
          {/* SU PUNTO DE LLEGADA, A LA IZQUIERDA (01/11/2026, «la estación no tiene punto receptor de cable a la
              izquierda»): donde llega el trazo de su ficha. Soltar un cable aquí es soltarlo en la ficha. */}
          <Handle type="target" position={Position.Left} id={soloLogo ? "entra" : "entra-estacion"} className={PUNTO_VERDE} title="Entrada de esta etapa (la misma que la de su ficha)" />
          {/* Sin número (01/11/2026: «mejor le quitamos el número»). */}
          {ctx.comoAgente || rosa ? (
            // SU AGENTE (01/11/2026, sus PNG cuadrados): el robot en las fichas de venta, el COBRADOR en los Cobros y
            // el logo de UPSELL —con su número en un círculo— en las ofertas que vienen después de una Entrega.
            // Las esquinas redondeadas las pone el tablero.
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imagenDelAgente.src}
                alt={imagenDelAgente.nombre}
                draggable={false}
                className={`${ctx.comoAgente ? "h-full w-full rounded-2xl" : "h-full w-full rounded-full"} ${imagenDelAgente.src === "/tablero/agente.png" ? "object-contain p-1" : "object-cover"}`}
              />
              {nUpsell !== undefined && (
                <span
                  className="absolute -right-3 -top-3 flex h-9 w-9 items-center justify-center rounded-full border-[3px] border-white bg-amber-400 text-[17px] font-black text-slate-900 shadow-lg"
                  title={`Upsell ${nUpsell}`}
                >
                  {nUpsell}
                </span>
              )}
            </>
          ) : (
            <>
              <span className="text-5xl leading-none">🚉</span>
              <span className="text-[11px] font-bold uppercase tracking-widest opacity-90">Estación</span>
            </>
          )}
        </div>
        {/* Debajo, sin empujar al círculo (así los brazos salen de su centro). */}
        {/* (03/11/2026: el verde más claro y «Agente IA» un poco más grande.) */}
        <div className={`pointer-events-auto absolute left-1/2 top-[calc(100%+8px)] flex -translate-x-1/2 flex-col items-center whitespace-nowrap rounded-full ${rosa ? "bg-fuchsia-600" : "bg-emerald-500"} px-5 py-1.5 text-[13px] font-bold leading-5 text-white shadow`}>
          {(ctx.comoAgente || rosa) && (
            <span className="text-[18px]" title={soloLogo ? `${n ?? ""} · ${f.titulo?.trim() || ASPECTO[f.tipo].nombre}\nDoble clic: sus rutas y pesos` : undefined}>
              {soloLogo && n !== undefined && <span className="mr-1.5 rounded-full bg-white/90 px-1.5 text-[12px] font-black text-slate-900">{n}</span>}
              {imagenDelAgente.nombre}
            </span>
          )}
          <span className={ctx.comoAgente || rosa ? "text-[10px] font-semibold opacity-90" : ""}>{rosa ? (f.apagada ? "apagado" : "reparte los clientes") : queEspera(f, ctx.tablero)}</span>
        </div>
      </div>
      {/* LOS BRAZOS (su imagen): rectas desde el centro de la estación hasta cada camino. Alto fijo por camino
          (28 px + 6 de separación), así cada brazo cae justo en el medio de su pastilla. */}
      {aLaDerecha.length > 0 &&
        (() => {
          const FILA = 28;
          const SEP = 6;
          const alto = aLaDerecha.length * FILA + (aLaDerecha.length - 1) * SEP;
          return (
            // Curvas suaves, punteadas como los cables (no rectas toscas).
            <svg width={52} height={alto} className="shrink-0 overflow-visible">
              {aLaDerecha.map((s, i) => {
                const y = i * (FILA + SEP) + FILA / 2;
                return (
                  <path key={s.clave} d={`M 0 ${alto / 2} C 30 ${alto / 2}, 22 ${y}, 52 ${y}`} fill="none" stroke={rosa ? ((f.reparto ?? []).find((o) => `rep:${o.id}` === s.clave)?.peso === 0 ? "#dc2626" : "#c026d3") : "#10b981"} strokeWidth={2.5} strokeDasharray="7 5" className="pointer-events-auto" />
                );
              })}
            </svg>
          );
        })()}
      {/* A la derecha: sus caminos. */}
      <div className="flex flex-col gap-1.5">
        {aLaDerecha.map((s) => {
          const falta = faltan?.get(s.clave);
          const pide = !!falta || ((s.clave.startsWith("btn:") || s.clave.startsWith("dec:") || s.clave.startsWith("elige:") || s.clave === "sin_pago") && !conCable.has(s.clave));
          // La entrega automática, con su ícono (ver `iconoDeEntrega`): el cable sale de él.
          const icono = iconoDeEntrega(f, s.clave, ctx.tablero, ctx.nombres, nUpsell !== undefined);
          // La ruta apagada del Ruteador: su punto en rojo, como su cable (11/11/2026).
          const rutaApagada = rosa && (f.reparto ?? []).find((o) => `rep:${o.id}` === s.clave)?.peso === 0;
          return (
            <div
              key={s.clave}
              title={falta ?? s.etiqueta}
              className={`pointer-events-auto relative flex ${icono ? "h-9" : "h-7"} min-w-[140px] max-w-[230px] items-center gap-1 whitespace-nowrap rounded-full border-2 bg-white px-3 ${icono ? "pr-7" : "pr-5"} text-[12px] font-bold shadow-sm ${falta ? "border-red-500 text-red-800" : rosa ? rutaApagada ? "border-red-400 text-red-700" : "border-fuchsia-400 text-fuchsia-900" : "border-emerald-400 text-emerald-900"}`}
            >
              {rosa && s.clave.startsWith("rep:") && <InterruptorDeRuta f={f} clave={s.clave} />}
              <span className="truncate">{s.etiqueta.replace(/^(🔘|💬|✍️) /, s.clave.startsWith("btn:") ? "botón " : s.clave.startsWith("dec:") ? "si dice " : s.clave.startsWith("elige:") ? "" : "")}</span>
              <Handle
                type="source"
                position={Position.Right}
                id={s.clave}
                className={`${icono ? PUNTO_DE_ENTREGA : rutaApagada ? PUNTO_ROJO : rosa ? PUNTO_ROSA : PUNTO_NARANJA} ${pide ? "punto-pide-cable" : ""}`}
                title={icono ? "Aquí se entrega el producto. Del ícono sale el cable: tíralo a donde sigue (el Regalo, otro upsell…)" : undefined}
                onClick={(e) => {
                  e.stopPropagation();
                  ctx.menu(e.clientX, e.clientY, { tipo: "conectar", ficha: f.id, salida: s.clave, ...(espejo ? { espejo } : {}) });
                }}
              >
                {icono && <span className="pointer-events-none select-none">{icono}</span>}
              </Handle>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * LAS ESQUINAS DE UN VELO, ENCIMA DE LAS FICHAS (10/11/2026), como en la pizarra. Él: «a veces las esquinas
 * quedan debajo de las fichas y no se pueden tocar… tanto en los de país como simples». El velo sigue detrás;
 * sus esquinas van en este nodo transparente del mismo tamaño y sitio, encima de todo, y estiran AL VELO
 * (`nodeId`). No se elige ni se mueve; se calcula en cada pintada desde el velo, así lo sigue.
 */
//
// ESQUINAS PROPIAS (12/11/2026), en vez de las de React Flow. Él: «el punto para que aparezca es demasiado pequeño» y
// «necesito que la esquina pueda pasar de largo la esquina opuesta, que no tenga límite». Dos cambios:
// - El área para agarrarla mide lo mismo EN PANTALLA a cualquier zoom (~28 px); antes eran 18 del lienzo, que al
//   alejarse quedaban en un puntito.
// - La esquina sigue al ratón a donde vaya: la esquina OPUESTA queda fija y el velo es el rectángulo entre las dos, así
//   que al cruzarla el velo se da vuelta y sigue creciendo hacia el otro lado (mínimo 40 × 40).
// Mientras arrastra solo cambia la pantalla; al soltar se guarda una vez (un solo Ctrl+Z), como antes.
function NodoDeEsquinas({ data }: NodeProps<Node<DatosDeCaja & { nodoDeLaCaja: string }>>) {
  const t = TEMA[data.tema];
  const zoom = useStore((s) => s.transform[2]);
  const { screenToFlowPosition, updateNode } = useReactFlow();
  const lado = 28 / (zoom || 1);
  const empezar = (esquina: (typeof ESQUINAS)[number], e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const c = data.caja;
    const fijo = { x: esquina.endsWith("left") ? c.x + c.ancho : c.x, y: esquina.startsWith("top") ? c.y + c.alto : c.y };
    let ultimo = { x: c.x, y: c.y, ancho: c.ancho, alto: c.alto };
    const mover = (ev: PointerEvent) => {
      const p = screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
      ultimo = {
        x: Math.round(Math.min(p.x, fijo.x)),
        y: Math.round(Math.min(p.y, fijo.y)),
        ancho: Math.round(Math.max(40, Math.abs(p.x - fijo.x))),
        alto: Math.round(Math.max(40, Math.abs(p.y - fijo.y))),
      };
      updateNode(data.nodoDeLaCaja, {
        position: { x: ultimo.x, y: ultimo.y },
        width: ultimo.ancho,
        height: ultimo.alto,
        style: { width: ultimo.ancho, height: ultimo.alto, pointerEvents: "none" },
      });
    };
    const soltar = () => {
      window.removeEventListener("pointermove", mover);
      window.removeEventListener("pointerup", soltar);
      if (ultimo.x !== c.x || ultimo.y !== c.y || ultimo.ancho !== c.ancho || ultimo.alto !== c.alto) data.alCambiar({ ...c, ...ultimo });
    };
    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", soltar);
  };
  return (
    <div className="relative h-full w-full" style={{ pointerEvents: "none" }}>
      {ESQUINAS.map((esquina) => (
        <div
          key={esquina}
          data-esquina-del-velo={esquina}
          className="nodrag nopan absolute"
          onPointerDown={(e) => empezar(esquina, e)}
          style={{
            width: lado,
            height: lado,
            [esquina.startsWith("top") ? "top" : "bottom"]: -lado / 2,
            [esquina.endsWith("left") ? "left" : "right"]: -lado / 2,
            borderRadius: 4 / (zoom || 1),
            pointerEvents: "all",
            cursor: esquina === "top-left" || esquina === "bottom-right" ? "nwse-resize" : "nesw-resize",
            background: data.elegida ? t.tituloCaja : "transparent",
            opacity: 0.8,
          }}
        />
      ))}
    </div>
  );
}

/**
 * UN TEXTO SUELTO (13/11/2026, la herramienta «T»). Él: «la opción de escribir un texto y moverlo… y color… y cambiar de
 * tamaño de fuente… para yo poner textos ahí». Se arrastra como una ficha; doble clic lo edita; elegido, arriba sale su
 * barrita: tamaño en puntos (− / +), color (la paleta de la casa), negrita y borrar. Vacío al terminar de escribir = se
 * quita. Solo pantalla: el bot no lo lee.
 */
type NotaDelTablero = NonNullable<Tablero["textos"]>[number];
type DatosDeTexto = {
  nota: NotaDelTablero;
  tema: "claro" | "oscuro";
  editarAlNacer: boolean;
  alCambiar: (n: NotaDelTablero) => void;
  alBorrar: () => void;
  selectorDeColor?: (valor: string, alElegir: (color: string) => void) => ReactNode;
};
function NodoDeTexto({ data, selected }: NodeProps<Node<DatosDeTexto>>) {
  const n = data.nota;
  const [editando, setEditando] = useState(data.editarAlNacer);
  const [borrador, setBorrador] = useState(n.texto);
  // El foco a la caja al empezar a escribir (el lienzo a veces se lo queda tras el clic que lo creó).
  const campo = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!editando) return;
    const t = window.setTimeout(() => {
      campo.current?.focus();
      campo.current?.select();
    }, 60);
    return () => window.clearTimeout(t);
  }, [editando]);
  const [pintando, setPintando] = useUnaSolaPaleta();
  // La barrita se ve del mismo tamaño aunque se aleje la vista.
  const zoom = useStore((s) => s.transform[2]);
  const tam = n.tam ?? 24;
  const color = n.color || (data.tema === "oscuro" ? "#f1f5f9" : "#1e293b");
  const estilo = { fontSize: tam, color, fontWeight: n.negrita ? 800 : 500, lineHeight: 1.15 } as const;
  const terminar = () => {
    setEditando(false);
    if (!borrador.trim()) data.alBorrar();
    else if (borrador !== n.texto) data.alCambiar({ ...n, texto: borrador });
  };
  const ponerTam = (t: number) => data.alCambiar({ ...n, tam: Math.max(6, Math.min(400, Math.round(t))) });
  const lineas = borrador.split("\n");
  const boton = "rounded-md border border-slate-300 bg-white px-2 py-0.5 text-xs font-bold text-slate-700 hover:bg-slate-100";
  return (
    <div
      className="relative"
      onDoubleClick={(e) => {
        e.stopPropagation();
        setBorrador(n.texto);
        setEditando(true);
      }}
      title={editando ? undefined : "Arrastra para moverlo · doble clic para escribir"}
    >
      {selected && !editando && (
        <div
          className="nodrag nopan absolute bottom-full left-0 mb-2 flex items-center gap-1 whitespace-nowrap rounded-lg border border-slate-300 bg-white p-1 shadow-lg"
          style={{ transform: `scale(${1 / Math.max(zoom, 0.02)})`, transformOrigin: "bottom left" }}
          onMouseDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <button type="button" className={boton} title="Más chico" onClick={() => ponerTam(tam - (tam > 40 ? 8 : 2))}>
            A−
          </button>
          <input
            type="number"
            min={6}
            max={400}
            value={tam}
            title="Tamaño de la letra, en puntos"
            onChange={(e) => Number(e.target.value) > 0 && ponerTam(Number(e.target.value))}
            onKeyDown={(e) => e.stopPropagation()}
            className="w-14 rounded-md border border-slate-300 px-1 py-0.5 text-center text-xs text-slate-800"
          />
          <span className="text-[10px] font-semibold text-slate-500">pt</span>
          <button type="button" className={boton} title="Más grande" onClick={() => ponerTam(tam + (tam >= 40 ? 8 : 2))}>
            A+
          </button>
          {data.selectorDeColor && (
            <button
              type="button"
              className={`${boton} flex items-center gap-1`}
              title="Color del texto"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                setPintando({ x: r.left, y: r.bottom + 6 });
              }}
            >
              <span className="h-3 w-3 rounded-sm border border-black/20" style={{ backgroundColor: color }} /> Color
            </button>
          )}
          <button type="button" className={`${boton} ${n.negrita ? "bg-slate-800 text-white hover:bg-slate-700" : ""}`} title="Negrita" onClick={() => data.alCambiar({ ...n, negrita: n.negrita ? undefined : true })}>
            B
          </button>
          <button type="button" className={`${boton} text-red-700`} title="Borrar este texto (Ctrl+Z lo devuelve)" onClick={data.alBorrar}>
            🗑
          </button>
        </div>
      )}
      {pintando &&
        data.selectorDeColor &&
        createPortal(
          <div
            ref={(el) => encajarEnLaPantalla(el)}
            className="nodrag nopan nowheel fixed z-[400] rounded-lg border border-slate-300 bg-white p-3 text-slate-800 shadow-2xl"
            style={{ left: pintando.x, top: pintando.y }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between gap-4 text-xs font-bold text-slate-600">
              🎨 Color del texto
              <button type="button" onClick={() => setPintando(null)} className="rounded px-1.5 hover:bg-slate-100" title="Cerrar">
                ✕
              </button>
            </div>
            {data.selectorDeColor(n.color ?? "", (c) => data.alCambiar({ ...n, color: c || undefined }))}
          </div>,
          document.body
        )}
      {editando ? (
        <textarea
          ref={campo}
          autoFocus
          value={borrador}
          onChange={(e) => setBorrador(e.target.value)}
          onBlur={terminar}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") e.currentTarget.blur();
          }}
          rows={Math.max(1, lineas.length)}
          cols={Math.max(6, ...lineas.map((l) => l.length + 1))}
          placeholder="Escribe aquí"
          className="nodrag nopan nowheel resize-none overflow-hidden rounded-md border-2 border-violet-500 bg-white/90 px-1 outline-none"
          style={{ ...estilo, color: n.color || "#1e293b" }}
        />
      ) : (
        <div className={`cursor-move whitespace-pre px-1 ${selected ? "rounded-md outline outline-2 outline-violet-500" : ""}`} style={estilo}>
          {n.texto || "Texto"}
        </div>
      )}
    </div>
  );
}

const TIPOS_DE_NODO = { inicio: NodoDeInicio, ficha: NodoDeFicha, caja: NodoDeCaja, esquinas: NodoDeEsquinas, texto: NodoDeTexto };
const TIPOS_DE_CABLE = { cable: CableDelTablero, compra: CaminoDeCompra };

/**
 * DÓNDE PONER EL ÁREA DE UN PAÍS NUEVO (11/11/2026): la esquina de arriba a la izquierda de su manta. La pedida (el
 * centro de la vista) si ahí no hay nada; si choca con una ficha o un velo, debajo de todo, alineada a la izquierda.
 * El tamaño es el de la manta de un Inicio solo (`mantaPara`: 1280 × 620).
 */
function sitioLibreParaUnArea(t: TableroEnElEditor, pedido: { x: number; y: number }): { x: number; y: number } {
  const ANCHO = 1280, ALTO = 620, AIRE = 60;
  const ocupado = [
    ...t.fichas.filter((f) => !f.guardada).map((f) => ({ x: f.x, y: f.y, w: f.tipo === "inicio" ? 200 : 250, h: 260 })),
    ...(t.cajas ?? []).map((c) => ({ x: c.x, y: c.y, w: c.ancho, h: c.alto })),
  ];
  if (!ocupado.length) return pedido;
  const choca = (x: number, y: number) =>
    ocupado.some((r) => x < r.x + r.w + AIRE && x + ANCHO + AIRE > r.x && y < r.y + r.h + AIRE && y + ALTO + AIRE > r.y);
  if (!choca(pedido.x, pedido.y)) return pedido;
  return {
    x: Math.round(Math.min(...ocupado.map((r) => r.x))),
    y: Math.round(Math.max(...ocupado.map((r) => r.y + r.h)) + 150),
  };
}

/** Quitar fichas con sus cables. Si se va un Inicio, se va también su manta (las fichas se quedan). */
function sinFichas(t: TableroEnElEditor, ids: Set<string>): TableroEnElEditor {
  return {
    ...t,
    fichas: t.fichas.filter((f) => !ids.has(f.id)),
    cables: t.cables.filter((c) => !ids.has(c.de) && !ids.has(c.a)),
    cajas: (t.cajas ?? []).filter((c) => !c.inicio || !ids.has(c.inicio)),
    // Con la ficha se van sus 🪞 espejos (05/11/2026).
    espejos: (t.espejos ?? []).filter((e) => !ids.has(e.ficha)),
  };
}

/** Quitar solo unos 🪞 espejos: la ficha y sus cables se quedan (los cables vuelven a dibujarse desde la original). */
function sinEspejos(t: TableroEnElEditor, ids: Set<string>): TableroEnElEditor {
  return {
    ...t,
    espejos: (t.espejos ?? []).filter((e) => !ids.has(e.id)),
    cables: t.cables.map((c) => {
      if (!(c.de_espejo && ids.has(c.de_espejo)) && !(c.a_espejo && ids.has(c.a_espejo))) return c;
      const n = { ...c };
      if (n.de_espejo && ids.has(n.de_espejo)) delete n.de_espejo;
      if (n.a_espejo && ids.has(n.a_espejo)) delete n.a_espejo;
      return n;
    }),
  };
}

/**
 * LOS UPSELLS Y SU NÚMERO (01/11/2026, su logo de upsell «con un número en un círculo, el 1»): una ficha de
 * oferta (Mensaje o Intro de order bump) a la que se llega pasando por N Entregas desde un Inicio es el upsell N
 * (el menor N si hay varios caminos). Solo dibujo.
 */
function ofertasDespuesDeUnaEntrega(t: TableroEnElEditor): Record<string, number> {
  const fuera: Record<string, number> = {};
  const mejor = new Map<string, number>();
  const cola: Array<[string, number]> = t.fichas.filter((f) => f.tipo === "inicio").map((f) => [f.id, 0]);
  for (let i = 0; i < cola.length && i < 5000; i++) {
    const [id, n] = cola[i];
    if ((mejor.get(id) ?? Infinity) <= n) continue;
    mejor.set(id, n);
    const f = t.fichas.find((x) => x.id === id);
    if (!f) continue;
    if (n > 0 && (f.tipo === "mensaje" || f.tipo === "intro_ob") && !f.guardada) fuera[id] = Math.min(fuera[id] ?? Infinity, n);
    const siguiente = f.tipo === "entregar" ? n + 1 : n;
    // LA COLITA DEL LIBRITO TAMBIÉN ENTREGA (05/11/2026, COCINA PE): el «💰 Si paga» de una ficha que no es Cobro, si no va
    // a una Entregar, entrega ahí mismo (el motor, `entregadoConSuCable`). Lo que sigue por esa colita ya es upsell.
    const entregaEnLaColita = (salida: string, a: string) =>
      f.tipo !== "cobro" && f.tipo !== "entregar" && (salida === "pagado" || salida.startsWith("prod:")) && t.fichas.find((x) => x.id === a)?.tipo !== "entregar";
    for (const c of t.cables) if (c.de === id) cola.push([c.a, entregaEnLaColita(c.salida, c.a) ? n + 1 : siguiente]);
  }
  return fuera;
}

/**
 * UPSELL = PRODUCTO NUEVO, UPGRADE = COMPLETAR (05/11/2026, él: «le digo upsell a un producto nuevo, no a un upgrade;
 * upgrade le digo a completar el pago y pasa de básico a full»). De las ofertas que vienen después de una Entrega:
 * - lo que ofrece = los productos de los Cobros a los que va por cable, y los suyos si cobra ella misma;
 * - no ofrece nada (un «Si dice que no», un aviso) → sin logo;
 * - ofrece solo productos que ya se vendían antes de la primera Entrega → upgrade, el cohete;
 * - si no → upsell, numerado en orden por el camino (1, 2, 3…): el número cuenta los upsells que hay antes, no las Entregas.
 * Solo dibujo.
 */
function numerarUpsells(t: TableroEnElEditor): { upsell: Record<string, number>; upgrade: Set<string> } {
  const despues = ofertasDespuesDeUnaEntrega(t);
  const ficha = (id: string) => t.fichas.find((x) => x.id === id);
  const deLaFicha = (f: FichaEnElEditor) =>
    [f.cobro?.producto_id, ...(f.cobro?.acepta ?? []), ...(f.tipo === "entregar" ? (f.entregas ?? []).map((k) => k.split("#")[0]) : []), f.producto_id, ...(f.presenta ?? [])].filter(
      (x): x is string => !!x
    );
  // Lo que ya se vendía antes de la primera Entrega (las fichas de cada Inicio hasta una Entrega).
  const antes = new Set<string>();
  {
    const cola = t.fichas.filter((f) => f.tipo === "inicio").map((f) => f.id);
    const vistas = new Set(cola);
    for (let i = 0; i < cola.length; i++) {
      const f = ficha(cola[i]);
      if (!f || f.tipo === "entregar") continue;
      if (f.tipo === "cobro" || f.tipo === "mensaje" || f.tipo === "intro_ob") for (const p of deLaFicha(f)) antes.add(p);
      // (Por un «💰 Si paga» ya se vendió: lo que sigue es después de la entrega, también la colita del librito.)
      for (const c of t.cables)
        if (c.de === f.id && c.salida !== "pagado" && !c.salida.startsWith("prod:") && !vistas.has(c.a)) (vistas.add(c.a), cola.push(c.a));
    }
  }
  const upgrade = new Set<string>();
  const esUpsell = new Set<string>();
  for (const id of Object.keys(despues)) {
    const f = ficha(id);
    if (!f) continue;
    const cobros = t.cables.filter((c) => c.de === id).map((c) => ficha(c.a)).filter((x): x is FichaEnElEditor => x?.tipo === "cobro");
    const cobraElla = t.cables.some((c) => c.de === id && (c.salida === "pagado" || c.salida.startsWith("prod:")));
    const ofrece = [...cobros.flatMap((c) => (c.cobro?.producto_id ? [c.cobro.producto_id] : [])), ...(cobraElla ? f.presenta ?? [] : [])];
    if (!ofrece.length) continue;
    // (La casilla «⬆️ Upgrade» del Cobro no sirve de señal: sus Cobros de upsell también la traen encendida.)
    if (ofrece.every((p) => antes.has(p))) upgrade.add(id);
    else esUpsell.add(id);
  }
  // El número: cuántos upsells hay antes en el camino, + 1 (el menor si hay varios caminos).
  const upsell: Record<string, number> = {};
  const mejor = new Map<string, number>();
  const cola: Array<[string, number]> = t.fichas.filter((f) => f.tipo === "inicio").map((f) => [f.id, 0]);
  for (let i = 0; i < cola.length && i < 5000; i++) {
    const [id, k] = cola[i];
    if ((mejor.get(id) ?? Infinity) <= k) continue;
    mejor.set(id, k);
    const sigue = esUpsell.has(id) ? k + 1 : k;
    if (esUpsell.has(id)) upsell[id] = Math.min(upsell[id] ?? Infinity, sigue);
    for (const c of t.cables) if (c.de === id) cola.push([c.a, sigue]);
  }
  return { upsell, upgrade };
}

/** Los números de las fichas: el camino desde cada Inicio (en orden de cables), luego las sueltas. */
function numerarFichas(t: TableroEnElEditor): Record<string, number> {
  const numero: Record<string, number> = {};
  let n = 0;
  const vivas = t.fichas.filter((f) => !f.guardada && f.tipo !== "inicio");
  const orden = [...t.fichas.filter((f) => f.tipo === "inicio")].sort((a, b) => a.y - b.y || a.x - b.x);
  for (const ini of orden) {
    const cola = [ini.id];
    const vistas = new Set(cola);
    for (let i = 0; i < cola.length; i++) {
      const salen = t.cables
        .filter((c) => c.de === cola[i])
        .map((c) => t.fichas.find((f) => f.id === c.a))
        .filter((f): f is FichaEnElEditor => !!f)
        .sort((a, b) => a.y - b.y || a.x - b.x);
      for (const f of salen) {
        if (vistas.has(f.id)) continue;
        vistas.add(f.id);
        cola.push(f.id);
        if (f.tipo !== "inicio" && !f.guardada && numero[f.id] === undefined) numero[f.id] = ++n;
      }
    }
  }
  for (const f of [...vivas].sort((a, b) => a.x - b.x || a.y - b.y)) if (numero[f.id] === undefined) numero[f.id] = ++n;
  return numero;
}

/** El Inicio de un país ("" = otros países). */
function inicioDe(t: TableroEnElEditor, pais: string): string | undefined {
  return t.fichas.find((f) => f.tipo === "inicio" && (f.pais ?? "") === pais)?.id;
}

/** La manta de un país (la caja de su Inicio), para dejar ahí una copia. */
function mantaDelPais(t: TableroEnElEditor, pais: string): NonNullable<Tablero["cajas"]>[number] | undefined {
  const ini = inicioDe(t, pais);
  return ini ? (t.cajas ?? []).find((c) => c.inicio === ini) : undefined;
}

/** El portapapeles del tablero: sirve entre tiendas, canales y workflows de esta pestaña. */
let portapapeles: {
  fichas: FichaEnElEditor[];
  cables: CableDelTablero[];
  cajas?: NonNullable<Tablero["cajas"]>;
  /** 🪞 Los espejos elegidos (12/11/2026): se pegan con lo demás (ver `copiarFichas`). */
  espejos?: NonNullable<Tablero["espejos"]>;
  /** Cuántas veces se pegó: cada Ctrl+V cae un paso más abajo a la derecha, como en Illustrator. */
  pegadas?: number;
  /** CORTADO CON CTRL+X (13/11/2026): el primer pegado devuelve LAS MISMAS fichas (mismos ids y cables de dentro), así
   *  los clientes que estaban en ellas siguen su camino. Los pegados siguientes son copias, como siempre. */
  cortado?: boolean;
} | null = null;

export default function LienzoDelTablero({
  tablero,
  resumenDe,
  paisVisto,
  tema,
  nombres,
  paisesDisponibles,
  onCambiar,
  onAbrir,
  onAjustes,
  hayFichaAbierta,
  buscar = "",
  antesDelMas,
  despuesDelMas,
  numeros,
  selectorDeColor,
  onFichaTocada,
  quienCobra,
  alTocarQuienCobra,
  onPlantillas,
  onGuardarPlantilla,
  enfocar,
  canal,
  claveDeLaVista,
}: {
  /** De quién es esta vista (tienda o workflow + canal): con ella, la vista del momento de guardar vuelve al regresar. */
  claveDeLaVista?: string;
  /** El canal de este tablero, para su logo en las estaciones y el Inicio. Sin él (workflow), no se pone. */
  canal?: "whatsapp" | "messenger" | "instagram";
  /** Llevar la vista a estas fichas (las recién traídas de una plantilla). Cambia `vez` para repetirlo. */
  enfocar?: { ids: string[]; vez: number };
  /** «📋 Plantillas» del «+»: abre la ventana de plantillas; las fichas llegan alrededor de `centro`. */
  onPlantillas?: (centro: { x: number; y: number }) => void;
  /** Clic derecho con varias fichas elegidas: guardarlas como plantilla (archivo). */
  onGuardarPlantilla?: (ids: string[]) => void;
  /** Por país: quién cobra ahí, para mostrar su avatar en el Inicio (29/10/2026). Solo pantalla. */
  quienCobra?: Record<string, { foto?: string; color?: string; nombre: string; porDefecto: boolean }>;
  /** Clic en esa cara: abrir los datos de la tienda (quién cobra por país), sin salir del tablero. */
  alTocarQuienCobra?: () => void;
  /** Al tocar una ficha: para poner la bandera en el país de su manta (27/10/2026). */
  onFichaTocada?: (id: string) => void;
  tablero: TableroEnElEditor;
  resumenDe: (f: FichaEnElEditor) => string;
  paisVisto: string;
  /** El fondo: claro, u oscuro (en «mixto» y «oscuro»). Las fichas siguen blancas, como en la pizarra. */
  tema: "claro" | "oscuro";
  /** Los nombres de los productos, para las salidas del cobro. */
  nombres: Record<string, string>;
  paisesDisponibles: string[];
  onCambiar: (t: TableroEnElEditor) => void;
  /** `burbuja`: la que se quiere ver al abrir (doble clic sobre ella en la ficha). `grupo`: las OTRAS fichas de
   *  Seguimientos elegidas junto con ella (doble clic en una de varias elegidas), para editarlas a la vez. */
  onAbrir: (id: string, burbuja?: number, grupo?: string[]) => void;
  /** `grupo`: las OTRAS del mismo tipo elegidas junto con ella (13/11/2026). */
  onAjustes: (id: string, grupo?: string[]) => void;
  /** ¿Hay abierta la ventana de una ficha? Al cerrarse, la ficha abierta vuelve a quedar elegida (14/11/2026). */
  hayFichaAbierta?: boolean;
  /** EL BUSCADOR VIVE ARRIBA, EN LA BARRA, como en la pizarra (24/10/2026). */
  buscar?: string;
  /** LOS BOTONES REDONDOS DE ARRIBA A LA IZQUIERDA, como en la pizarra: ← antes del «+», ☰ después. */
  antesDelMas?: ReactNode;
  /** El ☰. Como función, recibe las opciones de vista del lienzo para ponerlas en su lista (01/11/2026). */
  despuesDelMas?: ReactNode | ((herramientas: ReactNode) => ReactNode);
  /** LOS NÚMEROS DE CADA FICHA (25/10/2026), como los de las rutas de la pizarra. */
  numeros?: Record<string, { clientes: number; ventas: number; ahora?: number }>;
  /** EL COLOR DEL VELO (13/11/2026): el selector de colores de la casa (fijos + mezclador + «mi paleta»). */
  selectorDeColor?: (valor: string, alElegir: (color: string) => void) => ReactNode;
}) {
  const instancia = useRef<ReactFlowInstance<Node, Edge> | null>(null);
  const vivo = useRef(tablero);
  vivo.current = tablero;
  const [menu, setMenu] = useState<{ x: number; y: number; m: Menu } | null>(null);
  const [cajaElegida, setCajaElegida] = useState<string | null>(null);
  const [panel, setPanel] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  // «🇦🇷 Pasar a voseo» de las fichas elegidas: mientras pide, y el resumen al terminar.
  const [voseo, setVoseo] = useState<
    | { fase: "pidiendo"; modo: ModoDeVoseo; fichas: number }
    | { fase: "listo"; modo: ModoDeVoseo; fichas: number; cambiadas: number; descartadas: Array<{ ficha: string; texto: string; motivo: string }>; costo: number }
    | null
  >(null);
  // «▶ Ver recorrido» (el Inicio cuya ruta se ilumina) y el buscador: solo vista, no cambian nada.
  const [mirando, setMirando] = useState<string | null>(null);
  const [menuMas, setMenuMas] = useState(false);
  // DIBUJAR EL VELO AL CREARLO (13/11/2026). Él: «al elegir área de país o caja libre, que yo arrastre y cree el velo…
  // para no tener que buscar la caja por algún lado». Tras elegirlo en el «+», el puntero es una cruz: arrastrar dibuja el
  // velo ahí, con ese tamaño (un clic suelto lo pone con el tamaño de siempre). Esc cancela. Solo al crearlo; después se
  // estira por sus esquinas como siempre.
  const [dibujando, setDibujando] = useState<{ pais?: string } | null>(null);
  // LA HERRAMIENTA «T» (13/11/2026): con ella puesta, un clic en el tablero pone un texto ahí y se escribe en el acto.
  const [poniendoTexto, setPoniendoTexto] = useState(false);
  const [textoRecienCreado, setTextoRecienCreado] = useState<string | null>(null);
  useEffect(() => {
    if (!poniendoTexto) return;
    const alPulsar = (e: KeyboardEvent) => e.key === "Escape" && setPoniendoTexto(false);
    window.addEventListener("keydown", alPulsar);
    return () => window.removeEventListener("keydown", alPulsar);
  }, [poniendoTexto]);
  const [trazo, setTrazo] = useState<{ x0: number; y0: number; x1: number; y1: number; ox: number; oy: number } | null>(null);
  useEffect(() => {
    if (!dibujando) return;
    const alPulsar = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setDibujando(null);
      setTrazo(null);
    };
    window.addEventListener("keydown", alPulsar);
    return () => window.removeEventListener("keydown", alPulsar);
  }, [dibujando]);
  // LA VISTA DE CUANDO GUARDÓ (06/11/2026). Él: «el "guardar" también guarda la zona visible donde me quedé…
  // si no guardé no debería quedar». Al guardar (el editor avisa con «contenido-guardado») se apunta el zoom y
  // la posición de ESTE tablero; al volver a entrar se abre ahí. Moverse sin guardar no cambia lo apuntado.
  // Solo pantalla y solo en este navegador (no va al contenido ni al bot). Sin nada apuntado, encuadra como antes.
  const vistaGuardada = useMemo(() => {
    if (!claveDeLaVista) return undefined;
    try {
      const v = JSON.parse(window.localStorage.getItem(`tablero-mirada:${claveDeLaVista}`) ?? "null") as { x: number; y: number; zoom: number } | null;
      return v && [v.x, v.y, v.zoom].every((n) => Number.isFinite(n)) && v.zoom > 0 ? v : undefined;
    } catch {
      return undefined;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!claveDeLaVista) return;
    const alGuardar = () => {
      const v = instancia.current?.getViewport();
      if (!v || ![v.x, v.y, v.zoom].every((n) => Number.isFinite(n))) return;
      try {
        window.localStorage.setItem(`tablero-mirada:${claveDeLaVista}`, JSON.stringify({ x: v.x, y: v.y, zoom: v.zoom }));
      } catch {}
    };
    window.addEventListener("contenido-guardado", alGuardar);
    return () => window.removeEventListener("contenido-guardado", alGuardar);
  }, [claveDeLaVista]);
  // LA VISTA VA A LO RECIÉN TRAÍDO (una plantilla llega a la derecha de lo suyo, 01/11/2026).
  useEffect(() => {
    if (!enfocar?.ids.length) return;
    const id = window.setTimeout(
      () => instancia.current?.fitView({ nodes: enfocar.ids.map((x) => ({ id: x })), padding: 0.15, maxZoom: 1, duration: 500 }),
      120
    );
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enfocar?.vez]);
  // EL «+» SE CIERRA AL HACER CLIC FUERA (25/10/2026): «solo se colapsa presionando nuevamente el +».
  // (Con Escape también: ver el teclado, más abajo.)
  const cajaDelMas = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuMas) return;
    const fuera = (e: PointerEvent) => {
      if (cajaDelMas.current && !cajaDelMas.current.contains(e.target as globalThis.Node | null)) setMenuMas(false);
    };
    document.addEventListener("pointerdown", fuera, true);
    return () => document.removeEventListener("pointerdown", fuera, true);
  }, [menuMas]);
  const t = TEMA[tema];

  // Estables (no cambian en cada redibujo): así el contexto de las fichas tampoco.
  const alTocarQuienCobraVivo = useRef(alTocarQuienCobra);
  alTocarQuienCobraVivo.current = alTocarQuienCobra;
  const alCambiar = useRef(onCambiar);
  alCambiar.current = onCambiar;
  const cambiar = useCallback((n: TableroEnElEditor) => alCambiar.current(n), []);
  const curvar = useCallback(
    (cableId: string, p: Punto | null) => {
      const actual = { ...(vivo.current.curvas ?? {}) };
      if (p) actual[cableId] = { x: Math.round(p.x), y: Math.round(p.y) };
      else delete actual[cableId];
      cambiar({ ...vivo.current, curvas: actual });
    },
    [cambiar]
  );

  const visibles = tablero.fichas.filter((f) => !f.guardada);
  // EL MODO ESTACIONES (01/11/2026), recordado en este navegador. Solo dibujo.
  const [estaciones, setEstaciones] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem("tablero-estaciones") === "1";
    } catch {
      return false;
    }
  });
  const cambiarEstaciones = (v: boolean) => {
    setEstaciones(v);
    try {
      window.localStorage.setItem("tablero-estaciones", v ? "1" : "0");
    } catch {}
  };
  // CÓMO SE VE LA ESTACIÓN (01/11/2026): su robot «Agente IA» o la bolita 🚉, a su gusto («si no me gusta, lo
  // dejamos en estación»). Recordado en este navegador; por defecto el agente.
  const [comoAgente, setComoAgente] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem("tablero-estacion-aspecto") !== "estacion";
    } catch {
      return true;
    }
  });
  const cambiarComoAgente = (v: boolean) => {
    setComoAgente(v);
    try {
      window.localStorage.setItem("tablero-estacion-aspecto", v ? "agente" : "estacion");
    } catch {}
  };
  /** La ficha de verdad detrás de un nodo (la bolita «est:<id>» es su ficha; el 🪞 espejo «esp:<id>», la suya). */
  const fichaDelNodo = (id: string) =>
    id.startsWith("est:")
      ? id.slice(4)
      : id.startsWith("esp:")
        ? (vivo.current.espejos ?? []).find((e) => e.id === id.slice(4))?.ficha ?? id
        : id;

  /**
   * «📐 ACOMODAR COMO CAMINO» (01/11/2026): solo cuando él lo toca (nada se mueve solo) y con Ctrl+Z. Desde cada
   * Inicio, por sus cables: una columna por etapa, cada columna tan ancha como su bloque más ancho (ficha +
   * estación + caminos, medido en pantalla); los Seguimientos de una sola estación, encima de ella; los
   * países uno debajo del otro, cada uno con su manta alrededor.
   */
  const acomodarComoCamino = () => {
    const t = vivo.current;
    const porId = new Map(t.fichas.filter((f) => !f.guardada).map((f) => [f.id, f]));
    const medida = (f: FichaEnElEditor) => {
      const m = instancia.current?.getNode(f.id)?.measured;
      const ancho = m?.width ?? (estaciones && esEstacion(f, tablero) ? 760 : f.tipo === "inicio" ? 200 : 250);
      return { w: ancho, h: m?.height ?? 280 };
    };
    // Los Seguimientos que cuelgan de UNA sola ficha (van encima de ella).
    const colgados = new Map<string, string>();
    const vecesColgado = new Map<string, number>();
    for (const c of t.cables) {
      const d = porId.get(c.a);
      if (d?.tipo === "seguimientos" && porId.has(c.de)) {
        vecesColgado.set(d.id, (vecesColgado.get(d.id) ?? 0) + 1);
        colgados.set(d.id, c.de);
      }
    }
    const encimaDe = new Map<string, FichaEnElEditor>();
    for (const [seg, duena] of colgados) if (vecesColgado.get(seg) === 1) encimaDe.set(duena, porId.get(seg)!);
    const puestos = new Map<string, Punto>();
    const inicios = [...porId.values()].filter((f) => f.tipo === "inicio").sort((a, b) => a.y - b.y || a.x - b.x);
    if (!inicios.length) return;
    const x0 = Math.min(...inicios.map((f) => f.x));
    let y0 = Math.min(...inicios.map((f) => f.y));
    const mantas: Array<{ inicio: string; x: number; y: number; ancho: number; alto: number }> = [];
    for (const ini of inicios) {
      // Las columnas: el Inicio y, etapa por etapa, lo que sale de la anterior (cada ficha una vez).
      const columnas: string[][] = [[ini.id]];
      const vista = new Set([ini.id]);
      for (let col = 0; col < columnas.length; col++)
        for (const id of columnas[col])
          for (const c of t.cables.filter((x) => x.de === id)) {
            const d = porId.get(c.a);
            if (!d || vista.has(d.id) || d.tipo === "seguimientos" || d.tipo === "inicio") continue;
            vista.add(d.id);
            (columnas[col + 1] ??= []).push(d.id);
          }
      let x = x0;
      let fondo = y0;
      for (const ids of columnas) {
        let y = y0;
        let anchoCol = 0;
        for (const id of ids) {
          const f = porId.get(id)!;
          const { w, h } = medida(f);
          const seg = encimaDe.get(id);
          const altoSeg = seg ? medida(seg).h + 70 : 0;
          const yFicha = y + altoSeg;
          puestos.set(id, { x, y: yFicha });
          if (seg) {
            // Encima de la estación (el centro del círculo queda ~250+56+72 px a la derecha de la ficha).
            const centro = estaciones && esEstacion(f, tablero) ? x + 250 + 56 + 72 : x + 125;
            puestos.set(seg.id, { x: Math.round(centro - medida(seg).w / 2), y: y });
          }
          anchoCol = Math.max(anchoCol, w);
          y = yFicha + h + 110;
        }
        fondo = Math.max(fondo, y);
        x += anchoCol + 140;
      }
      mantas.push({ inicio: ini.id, x: x0 - 40, y: y0 - 70, ancho: x - x0 + 40, alto: fondo - y0 + 40 });
      y0 = fondo + 160;
    }
    cambiar({
      ...t,
      fichas: t.fichas.map((f) => {
        const p = puestos.get(f.id);
        return p ? { ...f, x: Math.round(p.x), y: Math.round(p.y) } : f;
      }),
      cajas: (t.cajas ?? []).map((c) => {
        const m = c.inicio ? mantas.find((x) => x.inicio === c.inicio) : undefined;
        return m ? { ...c, x: m.x, y: m.y, ancho: m.ancho, alto: m.alto } : c;
      }),
    });
    setAviso("Acomodado como camino. Si no te gusta, Ctrl+Z lo deja como estaba.");
    window.setTimeout(() => instancia.current?.fitView({ padding: 0.1, duration: 400 }), 80);
  };
  const nodosDesdeProps = useMemo<Node[]>(() => {
    const nodos: Node[] = [];
    // LAS MANTAS YA NO SE DIBUJAN SOLAS (24/10/2026): «la manta no debe ser automatizada, la controlo
    // yo desde las esquinas», como en la pizarra. Cada país tiene su caja (`inicio`), que nace con su
    // Inicio y se estira a mano; las fichas entran y salen de ella libremente.
    for (const c of tablero.cajas ?? []) {
      const ini = c.inicio ? tablero.fichas.find((f) => f.id === c.inicio && f.tipo === "inicio") : undefined;
      nodos.push({
        id: `caja:${c.id}`,
        type: "caja",
        position: { x: c.x, y: c.y },
        // COMO LA CAJA DE LA PIZARRA: no se queda el ratón (arrastrar dentro mueve la vista, y con
        // Shift dibuja el recuadro: «tampoco selecciona con shift»). Solo esquinas y título responden.
        // Entra en la selección si queda entera dentro, y se mueve con el grupo.
        style: { width: c.ancho, height: c.alto, pointerEvents: "none" as const },
        draggable: true,
        selectable: true,
        data: {
          caja: c,
          tema,
          elegida: cajaElegida === c.id,
          // EL TÍTULO TAMBIÉN LO ELIGE PARA COPIAR Y MOVER (10/11/2026), como en la pizarra: con Shift o Ctrl se
          // suma a lo ya elegido (fichas incluidas); sin, queda solo él.
          alElegir: (sumar?: boolean) => {
            setCajaElegida(c.id);
            setNodos((ns) => ns.map((n) => (n.id === `caja:${c.id}` ? { ...n, selected: true } : sumar || !n.selected ? n : { ...n, selected: false })));
          },
          alCambiar: (n: typeof c) => cambiar({ ...vivo.current, cajas: (vivo.current.cajas ?? []).map((x) => (x.id === c.id ? n : x)) }),
          selectorDeColor,
          alBorrar: () => {
            cambiar({ ...vivo.current, cajas: (vivo.current.cajas ?? []).filter((x) => x.id !== c.id) });
            setCajaElegida(null);
          },
          // VELO COMÚN ↔ VELO DE PAÍS (12/11/2026). Él: «¿a un velo común se le puede convertir a velo de país… doble clic
          // al nombre y elegir bandera?». Un país ya con su velo no se ofrece (uno por país).
          paisesConArea: tablero.fichas
            .filter((x) => x.tipo === "inicio" && x.id !== c.inicio && (tablero.cajas ?? []).some((k) => k.inicio === x.id))
            .map((x) => x.pais ?? ""),
          alHacerDePais: (p: string) => {
            const actual = vivo.current;
            const suyo = actual.fichas.find((x) => x.tipo === "inicio" && (x.pais ?? "") === p);
            // Con Inicio sin velo, se une a él; sin Inicio, se le crea uno arriba a la izquierda, SIN CONECTAR
            // («nada se conecta solo»), como «🌎 Área de un país».
            const nuevo: FichaEnElEditor | null = suyo
              ? null
              : { id: `inicio-${p || "otros"}-${Date.now().toString(36)}`, tipo: "inicio", ...(p ? { pais: p } : {}), x: c.x + 40, y: c.y + 70 };
            cambiar({
              ...actual,
              fichas: nuevo ? [...actual.fichas, nuevo] : actual.fichas,
              cajas: (actual.cajas ?? []).map((x) => (x.id === c.id ? { ...x, inicio: (suyo ?? nuevo)!.id } : x)),
            });
            setAviso(
              nuevo
                ? `${p ? `${banderaDe(p)} ${p}` : "🌍 Otros países"}: el velo es su área y tiene su Inicio arriba a la izquierda. Conéctalo a la primera ficha de su ruta.`
                : `${p ? `${banderaDe(p)} ${p}` : "🌍 Otros países"}: el velo es ahora el área de su Inicio.`
            );
          },
          ...(ini
            ? {
                alHacerComun: () =>
                  cambiar({
                    ...vivo.current,
                    cajas: (vivo.current.cajas ?? []).map((x) => {
                      if (x.id !== c.id) return x;
                      const { inicio: _inicio, ...resto } = x;
                      return { ...resto, titulo: x.titulo || (ini.pais ? COUNTRIES[ini.pais as CountryCode]?.label ?? ini.pais : "Otros países") };
                    }),
                  }),
              }
            : {}),
          ...(ini
            ? {
                manta: {
                  titulo: ini.pais ? `${banderaDe(ini.pais)} ${ini.pais}` : "🌍 Otros países",
                  mirando: mirando === ini.id,
                  alVer: () => setMirando((m) => (m === ini.id ? null : ini.id)),
                  // CAMBIAR EL PAÍS DEL ÁREA (12/11/2026). Él: «doble clic al nombre en su bandera, seleccionar el país, y
                  // que cambie el velo al otro país». Cambia el país de SU Inicio (la manta y lo de dentro lo siguen).
                  // Un país que ya tiene su Inicio no se ofrece: hay uno por país.
                  pais: ini.pais ?? "",
                  ocupados: tablero.fichas.filter((x) => x.tipo === "inicio" && x.id !== ini.id).map((x) => x.pais ?? ""),
                  alCambiarPais: (p: string) =>
                    cambiar({
                      ...vivo.current,
                      fichas: vivo.current.fichas.map((x) => (x.id === ini.id ? { ...x, pais: p || undefined } : x)),
                    }),
                },
              }
            : {}),
        } satisfies DatosDeCaja,
        // SIEMPRE DEBAJO DE LAS FICHAS, TAMBIÉN ELEGIDO (12/11/2026, él: «mira cómo se han atenuado las fichas»). React Flow
        // le suma 1000 a lo elegido: con -10 un velo elegido subía a 990 y su color tapaba sus fichas (en 0). Con -2000
        // elegido queda en -1000.
        zIndex: -2000,
      });
    }
    // (Modo estaciones: la estación va DENTRO del mismo bloque de su ficha —ver `NodoDeFicha`—: se mueve con
    // ella y todo queda libre como siempre. Nada se acomoda solo.)
    for (const f of visibles)
      nodos.push({
        id: f.id,
        type: f.tipo === "inicio" ? "inicio" : "ficha",
        position: { x: f.x, y: f.y },
        data: { ficha: f },
        // En modo estaciones el bloque es ancho y casi todo aire: el aire deja pasar el ratón al fondo (la manito).
        ...((estaciones && esEstacion(f, tablero)) || f.tipo === "reparto" ? { style: { pointerEvents: "none" as const } } : {}),
      });
    // LOS TEXTOS SUELTOS (13/11/2026, la «T»).
    for (const n of tablero.textos ?? [])
      nodos.push({
        id: `texto:${n.id}`,
        type: "texto",
        position: { x: n.x, y: n.y },
        data: {
          nota: n,
          tema,
          editarAlNacer: textoRecienCreado === n.id,
          alCambiar: (nuevo: NotaDelTablero) => cambiar({ ...vivo.current, textos: (vivo.current.textos ?? []).map((x) => (x.id === n.id ? nuevo : x)) }),
          alBorrar: () => cambiar({ ...vivo.current, textos: (vivo.current.textos ?? []).filter((x) => x.id !== n.id) }),
          selectorDeColor,
        } satisfies DatosDeTexto,
      });
    // 🪞 LOS ESPEJOS (05/11/2026): la misma ficha, otra vez, donde él la puso. Un Inicio no lleva espejo.
    for (const e of tablero.espejos ?? []) {
      const f = visibles.find((x) => x.id === e.ficha);
      if (!f || f.tipo === "inicio") continue;
      const sinRaton = (estaciones && esEstacion(f, tablero)) || f.tipo === "reparto";
      nodos.push({
        id: `esp:${e.id}`,
        type: "ficha",
        position: { x: e.x, y: e.y },
        data: { ficha: f, espejo: e.id },
        // El Ruteador es solo su logo: el neón va alrededor del bloque.
        ...(sinRaton || f.tipo === "reparto"
          ? { style: { ...(sinRaton ? { pointerEvents: "none" as const } : {}), ...(f.tipo === "reparto" ? { borderRadius: 999, boxShadow: ESPEJO_NEON } : {}) } }
          : {}),
      });
    }
    return nodos;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tablero, tema, cajaElegida, paisVisto, mirando, estaciones, textoRecienCreado]);
  const [nodos, setNodos, alCambiarNodos] = useNodesState<Node>(nodosDesdeProps);
  // LO ELEGIDO SIGUE ELEGIDO AL REDIBUJAR (24/10/2026): «al mover se deseleccionan». Cada cambio
  // (soltar lo que se movió, por ejemplo) rehace las fichas desde el tablero, y se rehacían sin
  // elegir. Como en la pizarra, se conserva la elección.
  // 🪞 LA FAMILIA DEL ESPEJO MARCADA (13/11/2026). Él: «no me gusta el resplandor tipo pulse… me distrae, tengo que
  // esperar a que se quite para editar… un borde magenta notorio, y que sus otros espejos tengan ese mismo borde al
  // mismo tiempo que selecciono 1… que cuando me aleje ese borde siga grueso». Fijo hasta tocar otra cosa; el grosor
  // se compensa con el zoom (`--zoom-tablero`, globals.css). Solo pantalla.
  const [familiaEspejo, setFamiliaEspejo] = useState<Set<string> | null>(null);
  const familiaViva = useRef<Set<string> | null>(null);
  familiaViva.current = familiaEspejo;
  const conLaFamilia = (n: Node): Node =>
    familiaViva.current?.has(n.id) ? { ...n, className: "tablero-familia" } : n.className === "tablero-familia" ? { ...n, className: undefined } : n;
  // LO QUE APARECE QUEDA ELEGIDO (13/11/2026). Él: «la ficha o fichas duplicadas deben estar automáticamente
  // seleccionadas… lo que se borra y se recupera (Ctrl+Z) aparece seleccionado, así yo busco y veo dónde está». Las fichas
  // y los 🪞 espejos que no estaban en el dibujo anterior (una copia, lo pegado, lo que vuelve con Ctrl+Z o Ctrl+Y) quedan
  // elegidos, y solo ellos. Al abrir el tablero (antes no había nada dibujado) no se elige nada.
  const idsAntes = useRef<Set<string> | null>(null);
  useEffect(() => {
    const elegibles = (id: string) => !id.startsWith("est:") && !id.startsWith("caja:") && !id.startsWith("esquinas");
    const ahora = new Set(nodosDesdeProps.map((n) => n.id).filter(elegibles));
    const antes = idsAntes.current;
    idsAntes.current = ahora;
    const aparecieron = antes && antes.size > 0 ? new Set([...ahora].filter((id) => !antes.has(id))) : new Set<string>();
    setNodos((previos) => {
      if (aparecieron.size) return nodosDesdeProps.map((n) => (aparecieron.has(n.id) ? { ...n, selected: true } : n)).map(conLaFamilia);
      const elegidos = new Set(previos.filter((n) => n.selected).map((n) => n.id));
      return (elegidos.size ? nodosDesdeProps.map((n) => (elegidos.has(n.id) ? { ...n, selected: true } : n)) : nodosDesdeProps).map(conLaFamilia);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodosDesdeProps, setNodos]);
  useEffect(() => {
    setNodos((ns) => ns.map(conLaFamilia));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familiaEspejo, setNodos]);
  // SHIFT + ARRASTRAR SUMA A LO YA ELEGIDO (como en la pizarra): React Flow suelta todo al empezar el
  // recuadro; aquí se vuelve a elegir lo que ya estaba.
  const sumando = useRef<Set<string> | null>(null);
  const nodosVivos = useRef<Node[]>([]);
  nodosVivos.current = nodos;

  // Si el Inicio que se miraba ya no está (se borró o se guardó), se deja de mirar.
  useEffect(() => {
    if (mirando && !visibles.some((f) => f.id === mirando)) setMirando(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tablero, mirando]);
  const enLaRuta = useMemo(() => (mirando ? rutaDe(tablero, mirando) : null), [tablero, mirando]);
  // Al pulsar «▶ Ver recorrido», la vista se encuadra en esa ruta.
  useEffect(() => {
    if (!enLaRuta) return;
    const r = window.setTimeout(() => instancia.current?.fitView({ nodes: [...enLaRuta].map((id) => ({ id })), padding: 0.15, maxZoom: 1, duration: 500 }), 50);
    return () => window.clearTimeout(r);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mirando]);
  // EL 🔍 DENTRO DEL TABLERO (14/11/2026). Él: «no veo el buscador de fichas, te dije que quería ubicar el número»: la
  // cajita de la barra de arriba no se notaba. Este botón redondo, al lado de ← + T ☰, abre su propia caja; lo escrito
  // ahí manda sobre la de arriba y hace lo mismo (número → va a esa ficha; texto → marca las que lo dicen).
  const [lupaAbierta, setLupaAbierta] = useState(false);
  const [enLaLupa, setEnLaLupa] = useState("");
  const consulta = paraBuscar((lupaAbierta && enLaLupa.trim() ? enLaLupa : buscar).trim());
  // BUSCAR POR NÚMERO (14/11/2026). Él: «dame un buscador de fichas, porque cuando tú me dices "la 86" tengo que estar
  // buscando». Escribir solo el número («86» o «#86») marca esa ficha y la vista va a ella (ver más abajo).
  const numeroBuscado = /^#?\d{1,4}$/.test(consulta) ? Number(consulta.replace("#", "")) : null;
  const coincidentes = useMemo(() => {
    if (numeroBuscado !== null) {
      const numeros = numerarFichas(tablero);
      return new Set(visibles.filter((f) => numeros[f.id] === numeroBuscado).map((f) => f.id));
    }
    if (consulta.length < 2) return null;
    return new Set(
      visibles
        .filter((f) => paraBuscar([ASPECTO[f.tipo].nombre, resumenDe(f), ...textosDe({ t: f.titulo, s: f.steps, v: f.variantes, g: f.seguimientos })].join(" ")).includes(consulta))
        .map((f) => f.id)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tablero, consulta]);
  /** Lo que se dibuja: con «Ver recorrido» o el buscador, lo de fuera queda tenue (como en la pizarra). */
  const nodosVistos = !enLaRuta && !coincidentes
    ? nodos
    : nodos.map((n) => {
        if (n.type === "caja") {
          // La manta de otro país, tenue mientras se mira un recorrido.
          const c = (n.data as DatosDeCaja).caja;
          return enLaRuta && c.inicio && c.inicio !== mirando ? { ...n, style: { ...n.style, opacity: 0.3 } } : n;
        }
        const idDeFicha = fichaDelNodo(n.id);
        const dentro = (!enLaRuta || enLaRuta.has(idDeFicha)) && (!coincidentes || coincidentes.has(idDeFicha));
        return {
          ...n,
          style: {
            ...n.style,
            opacity: dentro ? 1 : 0.12,
            ...(coincidentes?.has(n.id) ? { outline: "3px solid #f59e0b", outlineOffset: 3, borderRadius: 10 } : {}),
          },
        };
      });

  // LOS NÚMEROS DE LAS FICHAS (26/10/2026, tipo Kommo): en el orden del camino, desde cada Inicio
  // siguiendo sus cables; las sueltas, al final, de izquierda a derecha. Para ubicarlas y nombrarlas.
  const numeroDe = useMemo(() => numerarFichas(tablero), [tablero]);
  const { upsell: upsellDe, upgrade: upgradeDe } = useMemo(() => numerarUpsells(tablero), [tablero]);

  // EL MODO INALÁMBRICO (27/10/2026): cada conexión, cable o colita, como él la eligió.
  const [todoCable, setTodoCable] = useState(false);
  const [destacada, setDestacada] = useState<string | null>(null);
  // La vista va sola a la ficha del número buscado (con una pausa corta: «8» y luego «86» no salta dos veces).
  useEffect(() => {
    if (numeroBuscado === null || !coincidentes || coincidentes.size !== 1) return;
    const [id] = [...coincidentes];
    const espera = window.setTimeout(() => {
      instancia.current?.fitView({ nodes: [{ id }], padding: 1.2, maxZoom: 1, duration: 500 });
      setDestacada(id);
    }, 450);
    return () => window.clearTimeout(espera);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numeroBuscado, coincidentes]);
  const [verEntrantes, setVerEntrantes] = useState<string | null>(null);
  // AL TIRAR DE NUEVO DESDE UNA SALIDA CON CABLE, el viejo no se ve mientras se tira; si el nuevo no
  // llega a ninguna ficha, vuelve a verse tal cual (no se desconecta nada).
  const [tirando, setTirando] = useState<{ de: string; salida: string } | null>(null);
  // «🔍 QUÉ FALTA CONECTAR»
  const [revisando, setRevisando] = useState(false);
  const faltasDeTodo = useMemo(() => (revisando ? faltasDelTablero(tablero, paisVisto, nombres) : null), [revisando, tablero, paisVisto, nombres]);
  // REVISAR UNA SOLA RUTA (13/11/2026). Él: «esa lupa me muestra todo… yo normalmente hago una ruta y luego la copio».
  // Se elige un país o una ruta de su Ruteador y solo cuenta lo que se alcanza desde ahí. "" = todo el tablero.
  const [alcance, setAlcance] = useState("");
  const alcances = useMemo(() => {
    if (!revisando) return [];
    const ops: Array<{ id: string; nombre: string }> = [];
    for (const ini of tablero.fichas.filter((f) => f.tipo === "inicio" && !f.guardada)) {
      const pais = ini.pais ? `${banderaDe(ini.pais)} ${ini.pais}` : "🌍 Otros países";
      ops.push({ id: ini.id, nombre: `${pais} · todo el país` });
      const ruta = rutaDe(tablero, ini.id);
      for (const r of tablero.fichas.filter((f) => f.tipo === "reparto" && ruta.has(f.id)))
        (r.reparto ?? []).forEach((o, i) => {
          const a = tablero.cables.find((c) => c.de === r.id && c.salida === `rep:${o.id}`)?.a;
          if (a) ops.push({ id: a, nombre: `${pais} · ${o.nombre || `Ruta ${i + 1}`}${o.peso > 0 ? "" : " (apagada)"}` });
        });
    }
    return ops;
  }, [revisando, tablero]);
  const faltas = useMemo(() => {
    if (!faltasDeTodo) return null;
    if (!alcance || !tablero.fichas.some((f) => f.id === alcance)) return faltasDeTodo;
    const ruta = rutaDe(tablero, alcance);
    return faltasDeTodo.filter((x) => ruta.has(x.ficha));
  }, [faltasDeTodo, alcance, tablero]);
  const faltasPorFicha = useMemo(() => {
    if (!faltas) return null;
    const m = new Map<string, Map<string, string>>();
    for (const x of faltas) {
      if (!m.has(x.ficha)) m.set(x.ficha, new Map());
      m.get(x.ficha)!.set(x.salida, x.motivo);
    }
    return m;
  }, [faltas]);
  const { colitas, colitasQueLlegan, fichasConColitas } = useMemo(() => {
    const colitas = new Set<string>();
    const llegan = new Map<string, number>();
    const conColitas = new Set<string>();
    for (const c of tablero.cables)
      if (esColita(tablero, c, todoCable)) {
        colitas.add(c.id);
        llegan.set(c.a, (llegan.get(c.a) ?? 0) + 1);
        conColitas.add(c.a);
        conColitas.add(c.de);
      }
    return { colitas, colitasQueLlegan: llegan, fichasConColitas: conColitas };
  }, [tablero, todoCable]);
  const abrirMenu = useCallback(
    (x: number, y: number, m: Menu) => {
      setMenu({ x, y, m });
      // EL CLIC DERECHO TAMBIÉN LA ELIGE (13/11/2026). Él: «al dar clic derecho… no se selecciona la ficha, entonces no sé qué
      // ficha se está editando». Si ya estaba entre las elegidas, la elección se queda (el menú es de todas); si no, queda
      // elegida solo ella.
      if (m.tipo !== "ficha") return;
      const id = m.espejo ? `esp:${m.espejo}` : m.fichaId;
      setNodos((ns) => (ns.some((n) => n.id === id && n.selected) ? ns : ns.map((n) => (n.id === id ? (n.selected ? n : { ...n, selected: true }) : n.selected ? { ...n, selected: false } : n))));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  const soltarElCable = useCallback(() => setTirando(null), []);
  const inicioDelTiro = useRef<Punto | null>(null);
  // (27/10/2026: al tirar un cable ya NO se ponen tenues las fichas: «no debería ser así». El cable
  // sigue sin ponerse donde no encaja, con su aviso.)
  // Las esquinas de cada velo, encima de las fichas (ver `NodoDeEsquinas`): mismo sitio y tamaño que el velo AHORA.
  const nodosAlTirar: Node[] = [
    ...nodosVistos,
    ...nodosVistos
      .filter((n) => n.type === "caja")
      .map((n) => {
        const s = n.style as { width?: number; height?: number } | undefined;
        return {
          id: `esquinas:${n.id}`,
          type: "esquinas",
          position: n.position,
          // EL TAMAÑO TAMBIÉN EN EL NODO, NO SOLO EN SU ESTILO (10/11/2026, él: «los velos ya no los puedo editar desde
          // las esquinas»). Este nodo se arma de nuevo en cada dibujo; sin `width`/`height` propios, React Flow lo da por
          // «sin medir» y lo deja oculto (visibility: hidden): sus esquinas no se podían agarrar.
          width: n.width ?? s?.width,
          height: n.height ?? s?.height,
          style: { width: n.width ?? s?.width, height: n.height ?? s?.height, pointerEvents: "none" as const },
          zIndex: 5000,
          selectable: false,
          draggable: false,
          focusable: false,
          deletable: false,
          connectable: false,
          data: { ...(n.data as DatosDeCaja), nodoDeLaCaja: n.id },
        };
      }),
  ];

  // EL CAMINO «🛒 SI COMPRA» DE CADA CAJA DE SEGUIMIENTOS (31/10/2026): se dibuja solo; no está en
  // `tablero.cables` (no es un cable suyo ni lo lee el bot). Ver `caminosDeCompra`.
  // 01/11/2026: YA NO SE DIBUJAN («esas conexiones automáticas me marean»): la tarjeta lo dice en una línea.
  const dibujarCaminos = false;
  const caminosDeLaCompra = useMemo<Edge[]>(
    () =>
      visibles
        .filter((f) => dibujarCaminos && f.tipo === "seguimientos")
        .flatMap((seg) =>
          caminosDeCompra(tablero, seg, nombres)
            .filter((cam) => visibles.some((f) => f.id === cam.destino.id))
            // UNA LÍNEA POR SEGUIMIENTO (31/10/2026): la compra sale de cada seguimiento, no de la caja.
            .flatMap((cam) =>
              (seg.seguimientos ?? []).map((_, i) => {
                const llave = `${cam.destino.id}:${i + 1}`;
                const elegida = seg.vista_compra?.[llave];
                const colita = todoCable ? false : elegida ? elegida === "colita" : cam.destino.x < seg.x - 60;
                const n = numeroDe[cam.destino.id];
                return {
                  id: `compra-${seg.id}-${llave}`,
                  source: seg.id,
                  sourceHandle: `${cam.clave}:${i + 1}`,
                  target: cam.destino.id,
                  targetHandle: "entra",
                  type: "compra",
                  deletable: false,
                  selectable: false,
                  data: {
                    seg: seg.id,
                    llave,
                    colita,
                    etiqueta: colita ? `${cam.etiqueta} → ${n !== undefined ? `${n} ` : ""}${ASPECTO[cam.destino.tipo].icono} ${cam.destino.titulo?.trim() || ASPECTO[cam.destino.tipo].nombre}` : cam.etiqueta,
                    colorDestino: ASPECTO[cam.destino.tipo].trazo,
                  },
                } as Edge;
              })
            )
        ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tablero, todoCable, numeroDe, nombres]
  );

  const cables = useMemo<Edge[]>(
    () =>
      tablero.cables
        .filter((c) => visibles.some((f) => f.id === c.de) && visibles.some((f) => f.id === c.a))
        .filter((c) => !(tirando && c.de === tirando.de && c.salida === tirando.salida))
        .map((c): Edge => {
          const origen = tablero.fichas.find((f) => f.id === c.de);
          const destino = tablero.fichas.find((f) => f.id === c.a);
          // EL CABLE, SIEMPRE DEL COLOR DE LA SOLAPA DE LA FICHA DE DONDE SALE (27/10/2026).
          const color = origen ? ASPECTO[origen.tipo].trazo : "#6366f1";
          const aSeguimientos = destino?.tipo === "seguimientos";
          const rutaApagada = origen?.tipo === "reparto" && c.salida.startsWith("rep:") && (origen.reparto ?? []).find((o) => `rep:${o.id}` === c.salida)?.peso === 0;
          // MODO ESTACIONES: el MISMO cable de siempre (mismo estilo); solo cambia dónde se engancha: sale de la
          // estación de su ficha (mismo bloque) y, hacia sus Seguimientos, entra por abajo de ellos.
          const deEstacion = estaciones && !!origen && esEstacion(origen, tablero);
          const comoColita = esColita(tablero, c, todoCable) && !(deEstacion && aSeguimientos);
          // 🪞 Desde / hacia el espejo donde él lo conectó (si ese espejo sigue ahí); si no, la original.
          const hayEspejo = (id: string | undefined, ficha: string) => !!id && (tablero.espejos ?? []).some((e) => e.id === id && e.ficha === ficha);
          return {
            id: c.id,
            source: hayEspejo(c.de_espejo, c.de) ? `esp:${c.de_espejo}` : c.de,
            sourceHandle: c.salida,
            target: hayEspejo(c.a_espejo, c.a) ? `esp:${c.a_espejo}` : c.a,
            targetHandle: estaciones && aSeguimientos && deEstacion ? "abajo" : "entra",
            type: "cable",
            deletable: false,
            ...(comoColita && destino
              ? { data: { etiqueta: letreroDeColita(tablero, c, numeroDe), colorDestino: ASPECTO[destino.tipo].trazo, tenue: !!destino.apagada } }
              : {}),
            // PUNTEADOS, QUIETOS Y SIN FLECHA, como en la pizarra. (03/11/2026, él: «engrosar un poquito los cables… y el
            // cable que parte hacia los seguimientos sea de color anaranjado y del mismo grosor que los demás, y el dash
            // también»: todos de 4 con el mismo punteado; el que va a unos Seguimientos, naranja.)
            // LA RUTA APAGADA DEL RUTEADOR, EN ROJO (11/11/2026). Él: «el cable apagado sale atenuado, no me gusta, me
            // gustaría que siga pero en color rojo». Entero, rojo, sin atenuar. Solo pantalla.
            style: {
              stroke: rutaApagada ? "#dc2626" : aSeguimientos ? ASPECTO.seguimientos.trazo : color,
              strokeWidth: 4,
              strokeDasharray: "10 6",
              opacity: origen?.apagada ? 0.4 : 1,
            },
          };
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tablero, todoCable, tirando, numeroDe, estaciones]
  );
  const todosLosCables = useMemo(() => [...cables, ...caminosDeLaCompra], [cables, caminosDeLaCompra]);

  const crearFicha =(tipo: TipoDeFicha, donde: Punto, desde?: { ficha: string; salida: string }) => {
    const id = `f-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const nueva: FichaEnElEditor = {
      id,
      tipo,
      x: Math.round(donde.x),
      y: Math.round(donde.y),
      // UN COBRO NUEVO COBRA UN PRODUCTO (01/11/2026): nacía como «Pago abierto (contribución)» y él no
      // encontraba dónde elegir el producto. La contribución se elige a propósito en sus ajustes.
      ...(tipo === "cobro" ? { cobro: { modo: "producto" as const, metodos: true } } : {}),
      ...(tipo === "condicion" ? { condicion: { tipo: "compro" as const } } : {}),
      ...(tipo === "esperar" ? { minutos: 60 } : {}),
      ...(tipo === "reparto" ? { reparto: [{ id: "r1", peso: 1 }, { id: "r2", peso: 1 }] } : {}),
      ...(tipo === "intro_ob" ? { variantes: [{ id: `v-${Date.now().toString(36)}`, peso: 1, steps: [] }] } : {}),
      ...(tipo === "seguimientos"
        ? { seguimientos: [{ id: `s-${Date.now().toString(36)}`, minutos: 180, variantes: [{ id: `v-${Date.now().toString(36)}`, peso: 1, steps: [] }] }] }
        : {}),
      // El correo nace con un texto que él cambia: es contenido suyo, no del código.
      ...(tipo === "correo" ? { correo_texto: "Hola 👋\n\nAquí tienes los enlaces de tu compra:\n\n{{ENLACES}}\n\n¡Gracias por tu compra!" } : {}),
    };
    const actual = vivo.current;
    const cablesNuevos = desde
      ? [
          ...actual.cables.filter((c) => !(c.de === desde.ficha && c.salida === desde.salida)),
          { id: `c-${Date.now().toString(36)}`, de: desde.ficha, salida: desde.salida, a: id },
        ]
      : actual.cables;
    cambiar({ ...actual, fichas: [...actual.fichas, nueva], cables: cablesNuevos });
  };

  const centroDeLaVista = (): Punto =>
    instancia.current?.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }) ?? { x: 200, y: 200 };

  /** El velo dibujado (en la pantalla, de una esquina a la otra): una caja libre, o el área de un país con su Inicio. */
  const crearVeloDibujado = (d: { pais?: string }, a: Punto, b: Punto) => {
    const aFlujo = (p: Punto) => instancia.current?.screenToFlowPosition(p) ?? p;
    const pa = aFlujo(a);
    const pb = aFlujo(b);
    const esPais = d.pais !== undefined;
    // Un clic suelto (o un trazo muy chico): el tamaño de siempre, con su esquina donde hizo clic.
    const chico = Math.abs(b.x - a.x) < 30 || Math.abs(b.y - a.y) < 30;
    const x = Math.round(chico ? pa.x : Math.min(pa.x, pb.x));
    const y = Math.round(chico ? pa.y : Math.min(pa.y, pb.y));
    const ancho = Math.round(chico ? (esPais ? 1280 : 600) : Math.abs(pb.x - pa.x));
    const alto = Math.round(chico ? (esPais ? 620 : 400) : Math.abs(pb.y - pa.y));
    const actual = vivo.current;
    if (!esPais) {
      cambiar({ ...actual, cajas: [...(actual.cajas ?? []), { id: `k-${Date.now().toString(36)}`, x, y, ancho, alto, titulo: "Nueva caja" }] });
      return;
    }
    const p = d.pais ?? "";
    const inicio: FichaEnElEditor = { id: `inicio-${p || "otros"}-${Date.now().toString(36)}`, tipo: "inicio", ...(p ? { pais: p } : {}), x: x + 40, y: y + 70 };
    cambiar({
      ...actual,
      fichas: [...actual.fichas, inicio],
      cajas: [...(actual.cajas ?? []), { id: `manta-${inicio.id}`, x, y, ancho, alto, titulo: "", inicio: inicio.id }],
    });
    setAviso(`${p ? `${banderaDe(p)} ${p}` : "🌍 Otros países"}: su Inicio y su manta. Conecta el Inicio a la primera ficha de su ruta.`);
  };

  const elegidas = () => nodos.filter((n) => n.selected && (n.type === "ficha" || n.type === "inicio")).map((n) => n.id);

  // COPIAR Y PEGAR, los mismos para Ctrl+C / Ctrl+V y para el clic derecho (06/11/2026: «que las fichas, a la hora
  // de darle click derecho, también tengan la opción de copiar»).
  // LOS VELOS ELEGIDOS TAMBIÉN SE COPIAN (10/11/2026, él: «selecciono todo, con shift toda la zona, fichas y
  // velos… y no pega»). Los simples y las mantas de país; la manta se pega como velo libre (sin su Inicio:
  // un Inicio no se copia, hay uno por país).
  const cajasElegidas = () => new Set(nodos.filter((n) => n.selected && n.type === "caja").map((n) => n.id.slice(5)));
  /** Lo elegido, separado: las fichas (la bolita de estación cuenta como su ficha) y los 🪞 espejos. */
  const loElegido = () => {
    const ns = elegidas();
    return {
      fichas: new Set(ns.filter((id) => !id.startsWith("esp:")).map(fichaDelNodo)),
      espejos: new Set(ns.filter((id) => id.startsWith("esp:")).map((id) => id.slice(4))),
    };
  };
  /**
   * «🇦🇷 PASAR A VOSEO» VARIAS FICHAS (12/11/2026). Él: «me gustaría que le cambie a todo lo que yo seleccione, por
   * ejemplo 20 fichas… yo quiero que aplique de frente, yo leeré al final las fichas». Todas las burbujas de las fichas
   * (también versiones y seguimientos) van a `/api/voseo` (los comodines no llegan a la IA); lo que vuelve se pone de
   * una vez (un solo Ctrl+Z) y queda el resumen con las que se quedaron igual y por qué.
   */
  const textosDeLaFicha = (f: FichaEnElEditor) => [
    ...textosDeLosPasos(f.steps),
    ...(f.variantes ?? []).flatMap((v) => textosDeLosPasos(v.steps)),
    ...(f.seguimientos ?? []).flatMap((s) => (s.variantes ?? []).flatMap((v) => textosDeLosPasos(v.steps))),
  ];
  const vosear = async (ids: string[], modo: ModoDeVoseo) => {
    const fichas = vivo.current.fichas.filter((f) => ids.includes(f.id));
    setVoseo({ fase: "pidiendo", modo, fichas: fichas.length });
    const { porTexto, costo } = await pasarAVoseo(fichas.flatMap(textosDeLaFicha), modo);
    // Sobre el tablero de AHORA (pudo cambiar mientras pedía): cada texto que sigue igual se cambia por su voseo.
    const actual = vivo.current;
    const conVoseo = (f: FichaEnElEditor): FichaEnElEditor => ({
      ...f,
      ...(f.steps ? { steps: pasosConVoseo(f.steps, porTexto) } : {}),
      ...(f.variantes ? { variantes: f.variantes.map((v) => (v.steps ? { ...v, steps: pasosConVoseo(v.steps, porTexto) } : v)) } : {}),
      ...(f.seguimientos
        ? { seguimientos: f.seguimientos.map((s) => ({ ...s, variantes: (s.variantes ?? []).map((v) => (v.steps ? { ...v, steps: pasosConVoseo(v.steps, porTexto) } : v)) })) }
        : {}),
    });
    let cambiadas = 0;
    const descartadas: Array<{ ficha: string; texto: string; motivo: string }> = [];
    for (const f of fichas) {
      const nombre = f.titulo?.trim() || ASPECTO[f.tipo].nombre;
      for (const t of new Set(textosDeLaFicha(f).filter((x) => x.trim()))) {
        const r = porTexto.get(t);
        if (r?.texto === null) descartadas.push({ ficha: nombre, texto: t.replace(/\s+/g, " ").slice(0, 70), motivo: r.motivo ?? "" });
        else if (r?.texto && r.texto !== t) cambiadas++;
      }
    }
    if (cambiadas > 0) cambiar({ ...actual, fichas: actual.fichas.map((f) => (ids.includes(f.id) ? conVoseo(f) : f)) });
    setVoseo({ fase: "listo", modo, fichas: fichas.length, cambiadas, descartadas, costo });
  };
  const copiarLas = (ids: Set<string>, cajaIds: Set<string> = new Set(), espejoIds: Set<string> = new Set()) => {
    const actual = vivo.current;
    const cajas = (actual.cajas ?? []).filter((c) => cajaIds.has(c.id)).map(({ inicio: _inicio, ...c }) => ({ ...c }));
    const espejos = (actual.espejos ?? []).filter((e) => espejoIds.has(e.id)).map((e) => ({ ...e }));
    if (ids.size === 0 && cajas.length === 0 && espejos.length === 0) return false;
    portapapeles = {
      fichas: JSON.parse(JSON.stringify(actual.fichas.filter((f) => ids.has(f.id)))),
      cables: actual.cables.filter((c) => ids.has(c.de) && ids.has(c.a)),
      cajas,
      espejos,
      pegadas: 0,
    };
    const partes = [ids.size ? `${ids.size} ficha(s)` : "", espejos.length ? `${espejos.length} espejo(s)` : "", cajas.length ? `${cajas.length} velo(s)` : ""]
      .filter(Boolean)
      .join(" y ");
    setAviso(`${partes} copiado(s). Ctrl+V, o clic derecho en un espacio vacío → «📋 Pegar aquí».`);
    return true;
  };
  /** Sin `donde`, encima del original, un paso abajo a la derecha (Ctrl+V); con `donde`, donde se hizo el clic derecho. */
  const pegarLoCopiado = (donde?: Punto) => {
    if (!portapapeles) return false;
    const actual = vivo.current;
    const cajasCopiadas = portapapeles.cajas ?? [];
    const espejosCopiados = portapapeles.espejos ?? [];
    // La forma la dan las fichas, los espejos Y los velos: cada cosa conserva su sitio relativo.
    const minX = Math.min(...portapapeles.fichas.map((f) => f.x), ...espejosCopiados.map((e) => e.x), ...cajasCopiadas.map((c) => c.x));
    const minY = Math.min(...portapapeles.fichas.map((f) => f.y), ...espejosCopiados.map((e) => e.y), ...cajasCopiadas.map((c) => c.y));
    // ENCIMA DEL ORIGINAL, UN PASO ABAJO A LA DERECHA (12/11/2026), como en Illustrator. Él: «me incomoda lo lejos que
    // se pega… lo pega bien arriba a la izquierda». (Antes, desde el 25/10, iba a la derecha de TODO el tablero, lejos.)
    // Cada Ctrl+V seguido baja un paso más, para que no queden una exactamente encima de otra.
    // LO CORTADO VUELVE TAL CUAL la primera vez (y en su mismo sitio con Ctrl+V), si sus fichas ya no están en el tablero.
    const mismas =
      !!portapapeles.cortado &&
      !portapapeles.fichas.some((f) => actual.fichas.some((x) => x.id === f.id)) &&
      !espejosCopiados.some((e) => (actual.espejos ?? []).some((x) => x.id === e.id));
    portapapeles.cortado = false;
    const paso = 40 * ((portapapeles.pegadas ?? 0) + 1);
    const desplazar = donde ? { x: donde.x - minX, y: donde.y - minY } : mismas ? { x: 0, y: 0 } : { x: paso, y: paso };
    if (!donde && !mismas) portapapeles.pegadas = (portapapeles.pegadas ?? 0) + 1;
    const mover = <T extends { x: number; y: number }>(o: T): T => ({ ...o, x: Math.round(o.x + desplazar.x), y: Math.round(o.y + desplazar.y) });
    const copia = mismas
      ? { fichas: JSON.parse(JSON.stringify(portapapeles.fichas.map(mover))) as FichaEnElEditor[], cables: portapapeles.cables.map((c) => ({ ...c })), espejos: espejosCopiados.map(mover) }
      : copiarFichas(portapapeles.fichas, portapapeles.cables, desplazar, espejosCopiados);
    const sello = Date.now().toString(36);
    const cajasNuevas = cajasCopiadas.map((c, k) => ({ ...c, id: `velo-${sello}-${k}`, x: Math.round(c.x + desplazar.x), y: Math.round(c.y + desplazar.y) }));
    // Fichas, cables, espejos y velos en UN solo cambio (dos seguidos se pisan).
    cambiar({
      ...actual,
      fichas: [...actual.fichas, ...copia.fichas],
      cables: [...actual.cables, ...copia.cables],
      ...(copia.espejos.length ? { espejos: [...(actual.espejos ?? []), ...copia.espejos] } : {}),
      ...(cajasNuevas.length ? { cajas: [...(actual.cajas ?? []), ...cajasNuevas] } : {}),
    });
    const partes = [
      copia.fichas.length ? `${copia.fichas.length} ficha(s)` : "",
      copia.espejos.length ? `${copia.espejos.length} espejo(s)` : "",
      cajasNuevas.length ? `${cajasNuevas.length} velo(s)` : "",
    ]
      .filter(Boolean)
      .join(" y ");
    setAviso(`${partes} pegado(s)${donde ? "" : " junto al original"}, con su forma${copia.fichas.length ? " y sus cables de dentro. Quedan sin conectar" : ""}.`);
    // (La vista ya no viaja: lo pegado cae junto al original, que es donde él está mirando.)
    // LO PEGADO QUEDA ELEGIDO (28/10/2026: «al pegar se deseleccionan… al arrastrar jaló solo una»):
    // sale el grupo pegado entero, velos y espejos incluidos, listo para moverlo junto.
    const pegadas = new Set([...copia.fichas.map((f) => f.id), ...copia.espejos.map((e) => `esp:${e.id}`), ...cajasNuevas.map((c) => `caja:${c.id}`)]);
    window.setTimeout(() => setNodos((ns) => ns.map((n) => ({ ...n, selected: pegadas.has(n.id) }))), 120);
    return true;
  };

  // COPIAR, PEGAR Y BORRAR CON EL TECLADO, como en la pizarra.
  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (document.querySelector("[data-ventana-del-tablero]")) return;
      // Con una ventana abierta encima (una burbuja, sus cuadritos…), las teclas son de ella, no del lienzo
      // (31/10/2026): Ctrl+V o Supr dentro de una burbuja tocaban las fichas de detrás.
      if (hayVentanaAbierta()) return;
      const tecla = e.key.toLowerCase();
      const actual = vivo.current;
      // ESCAPE, como en la pizarra: cierra el menú abierto y suelta lo elegido.
      if (tecla === "escape") {
        setMenu(null);
        setMenuMas(false);
        setPanel(false);
        setCajaElegida(null);
        setDestacada(null);
        setNodos((ns) => (ns.some((n) => n.selected) ? ns.map((n) => (n.selected ? { ...n, selected: false } : n)) : ns));
        return;
      }
      if ((e.ctrlKey || e.metaKey) && tecla === "c") {
        // Un 🪞 espejo elegido copia su ficha (la copia es una ficha nueva, sin espejos).
        // (12/11/2026: los 🪞 espejos elegidos van como espejos; antes cada uno se volvía una copia de su ficha.)
        const g = loElegido();
        if (!copiarLas(g.fichas, cajasElegidas(), g.espejos)) return;
        e.preventDefault();
      } else if ((e.ctrlKey || e.metaKey) && tecla === "x") {
        // CORTAR (13/11/2026). Él: «necesito que las fichas se puedan cortar y pegar, Cmd o Ctrl X». Se copian y se
        // quitan (con sus cables); Ctrl+V las devuelve tal cual. Ctrl+Z deshace el corte.
        const g = loElegido();
        const cajas = cajasElegidas();
        const dentro = [...g.fichas].reduce((s, id) => s + (numeros?.[id]?.ahora ?? 0), 0);
        if (
          dentro &&
          !window.confirm(
            `⚠ Hay ${dentro} cliente(s) ahora mismo en esas fichas. Si las cortas y no las pegas, se quedan sin ruta. Al pegarlas con Ctrl+V vuelven a ser las mismas y siguen su camino.\n\n¿Cortar?`
          )
        )
          return;
        if (!copiarLas(g.fichas, cajas, g.espejos)) return;
        e.preventDefault();
        if (portapapeles) portapapeles.cortado = true;
        const sinEllas = sinFichas(sinEspejos(actual, g.espejos), g.fichas);
        cambiar({ ...sinEllas, cajas: (sinEllas.cajas ?? []).filter((c) => !cajas.has(c.id)) });
        setAviso(`${g.fichas.size ? `${g.fichas.size} ficha(s)` : "Lo elegido"} cortado. Ctrl+V para pegarlo (Ctrl+Z lo devuelve a su sitio).`);
      } else if ((e.ctrlKey || e.metaKey) && tecla === "v") {
        if (!pegarLoCopiado()) return;
        e.preventDefault();
      } else if (tecla === "delete" || tecla === "backspace") {
        // Los textos sueltos elegidos se borran sin preguntar (Ctrl+Z los devuelve) (13/11/2026).
        const textosElegidos = new Set(nodos.filter((n) => n.selected && n.type === "texto").map((n) => n.id.slice(6)));
        if (textosElegidos.size && elegidas().length === 0 && !cajaElegida) {
          cambiar({ ...actual, textos: (actual.textos ?? []).filter((x) => !textosElegidos.has(x.id)) });
          e.preventDefault();
          return;
        }
        if (cajaElegida) {
          cambiar({ ...actual, cajas: (actual.cajas ?? []).filter((x) => x.id !== cajaElegida) });
          setCajaElegida(null);
          e.preventDefault();
          return;
        }
        // 🪞 Un espejo elegido se quita solo él (la ficha se queda); una ficha elegida se lleva sus espejos.
        const espejosElegidos = new Set(elegidas().filter((id) => id.startsWith("esp:")).map((id) => id.slice(4)));
        const ids = new Set(elegidas().filter((id) => !id.startsWith("esp:")));
        // Las cajas y mantas elegidas con el recuadro también se borran (las fichas de encima, no).
        const cajasElegidas = new Set(nodos.filter((n) => n.selected && n.type === "caja").map((n) => n.id.slice(5)));
        if (ids.size === 0 && cajasElegidas.size === 0 && espejosElegidos.size === 0) return;
        if (ids.size === 0 && cajasElegidas.size === 0) {
          // Solo espejos: sin pregunta (la ficha y sus cables siguen; Ctrl+Z lo devuelve).
          cambiar(sinEspejos(actual, espejosElegidos));
          setAviso(`${espejosElegidos.size} espejo(s) quitado(s). La ficha y sus cables siguen en su sitio.`);
          e.preventDefault();
          return;
        }
        const suyos = (actual.espejos ?? []).filter((x) => ids.has(x.ficha)).length;
        // CON CLIENTES DENTRO (27/10/2026): borrar una tubería con gente en sus fichas los deja sin ruta. Para
        // cambiar de tubería (el reenganche), lo correcto es desconectar el cable del Inicio: los que ya
        // estaban terminan su compra y los nuevos entran por la otra.
        const dentro = [...ids].reduce((s, id) => s + (numeros?.[id]?.ahora ?? 0), 0);
        const aviso = dentro
          ? `\n\n⚠ Hay ${dentro} cliente(s) ahora mismo en esas fichas: si las borras se quedan sin ruta (solo les contestará la IA). Para pasar a otra tubería, mejor desconecta el cable del Inicio y deja estas fichas hasta que terminen.`
          : "";
        if (!window.confirm(`¿Eliminar ${ids.size} ficha(s) con sus cables${suyos ? ` y sus ${suyos} espejo(s) 🪞` : ""}${cajasElegidas.size ? ` y ${cajasElegidas.size} caja(s)` : ""}?${aviso}`)) return;
        const sinEllas = sinFichas(sinEspejos(actual, espejosElegidos), ids);
        cambiar({ ...sinEllas, cajas: (sinEllas.cajas ?? []).filter((c) => !cajasElegidas.has(c.id)) });
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodos, cajaElegida]);

  useEffect(() => {
    if (!aviso) return;
    const r = window.setTimeout(() => setAviso(null), 3500);
    return () => window.clearTimeout(r);
  }, [aviso]);

  // VARIAS FICHAS DE SEGUIMIENTOS A LA VEZ (11/11/2026). Él: «agarrar varios seguimientos con Shift… al dar doble clic
  // a uno de los seleccionados se abra uno de ellos, pero haciendo una edición global a los seleccionados». Al abrir una
  // ficha de Seguimientos que está elegida junto con otras de Seguimientos, se le pasan esas otras (el pop up decide
  // qué cambios viajan a ellas). Las de otro tipo elegidas no cuentan.
  // (13/11/2026: de cualquier tipo menos el Inicio —cada uno es su país—: Mensajes, Cobros, Entregas… elegidos juntos, para
  // cambiar lo común en todos.)
  const grupoDe = (id: string): string[] | undefined => {
    const f = vivo.current.fichas.find((x) => x.id === id);
    const elegidas = new Set(nodosVivos.current.filter((n) => n.selected).map((n) => n.id));
    if (!f || f.tipo === "inicio" || !elegidas.has(id)) return undefined;
    const otras = vivo.current.fichas.filter((x) => x.tipo === f.tipo && x.id !== id && !x.guardada && elegidas.has(x.id)).map((x) => x.id);
    return otras.length ? otras : undefined;
  };
  // AL CERRAR SU VENTANA, LA FICHA SIGUE ELEGIDA (14/11/2026). Él: «al tocar una ficha con doble clic, editar y salir de la
  // ficha, esta queda deseleccionada y no sé cuál ficha era la que estaba editando… que al salir del pop up de cualquier
  // ficha esta quede seleccionada». Al abrir se apunta lo elegido (o, si no había nada, la ficha abierta y sus 🪞 espejos);
  // cuando el editor avisa que se cerró (`hayFichaAbierta` pasa a false), se vuelve a elegir eso mismo.
  const paraReelegir = useRef<Set<string> | null>(null);
  const apuntarParaReelegir = (id: string) => {
    const elegidos = nodosVivos.current.filter((n) => n.selected).map((n) => n.id);
    const suyos = new Set([id, ...(vivo.current.espejos ?? []).filter((e) => e.ficha === id).map((e) => `esp:${e.id}`)]);
    paraReelegir.current = elegidos.some((x) => suyos.has(x)) ? new Set(elegidos) : new Set([id]);
  };
  const habiaFichaAbierta = useRef(false);
  useEffect(() => {
    const antes = habiaFichaAbierta.current;
    habiaFichaAbierta.current = !!hayFichaAbierta;
    if (!antes || hayFichaAbierta || !paraReelegir.current) return;
    const ids = paraReelegir.current;
    paraReelegir.current = null;
    // Después de lo que haya soltado la selección al cerrar (un clic en el fondo, Escape).
    const r = window.setTimeout(() => setNodos((ns) => ns.map((n) => (ids.has(n.id) === !!n.selected ? n : { ...n, selected: ids.has(n.id) }))), 150);
    return () => window.clearTimeout(r);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hayFichaAbierta]);
  const abrirConSuGrupo = useCallback(
    (id: string, burbuja?: number) => {
      apuntarParaReelegir(id);
      onAbrir(id, burbuja, grupoDe(id));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onAbrir]
  );
  // LO MISMO CON EL ⚙ (13/11/2026): con varias del mismo tipo elegidas, sus ajustes son los de todas (lo distinto, con «?»).
  const ajustesConSuGrupo = useCallback(
    (id: string) => {
      apuntarParaReelegir(id);
      onAjustes(id, grupoDe(id));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onAjustes]
  );

  // EL CONTEXTO, ESTABLE (27/10/2026): antes era un objeto nuevo en cada redibujo y, al arrastrar una
  // ficha, se redibujaban TODAS las fichas en cada movimiento. Ahora solo cambia cuando cambia algo suyo.
  const contexto = useMemo(
    () => ({
      tablero,
      tema,
      paisVisto,
      nombres,
      resumenDe,
      abrir: abrirConSuGrupo,
      ajustes: ajustesConSuGrupo,
      menu: abrirMenu,
      cambiar,
      curvar,
      numeros,
      numeroDe,
      colitas,
      colitasQueLlegan,
      fichasConColitas,
      destacada,
      destacar: setDestacada,
      verEntrantes,
      setVerEntrantes,
      faltas: faltasPorFicha,
      quienCobra,
      alTocarQuienCobra: () => alTocarQuienCobraVivo.current?.(),
      estaciones,
      comoAgente,
      upsellDe,
      upgradeDe,
      canal,
    }),
    // (`quienCobra` llega nuevo en cada dibujo del editor: cuenta por su contenido, no por su identidad.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tablero, tema, paisVisto, nombres, resumenDe, abrirConSuGrupo, onAjustes, numeros, numeroDe, colitas, colitasQueLlegan, fichasConColitas, destacada, verEntrantes, faltasPorFicha, JSON.stringify(quienCobra ?? {}), estaciones, comoAgente, upsellDe, upgradeDe]
  );

  const paisesConInicio = new Set(tablero.fichas.filter((f) => f.tipo === "inicio").map((f) => f.pais ?? ""));
  const guardadas = tablero.fichas.filter((f) => f.guardada);
  const fichaDelMenu = menu?.m.tipo === "ficha" ? tablero.fichas.find((f) => f.id === (menu.m as { fichaId: string }).fichaId) : undefined;
  const espejoDelMenu = menu?.m.tipo === "ficha" ? (menu.m as { espejo?: string }).espejo : undefined;

  const opcionDeMenu = "block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-100";

  return (
    <Contexto.Provider
      value={contexto}
    >
      {/* SIN SELECCIONAR TEXTO (27/10/2026): Shift + arrastrar elegía también el texto de las fichas y
          Edge sacaba su lupa de búsqueda, que no dejaba mover nada. Los campos siguen escribiéndose. */}
      <div
        className="lienzo-del-tablero relative h-full w-full select-none overflow-hidden"
        style={{ background: t.fondo }}
        onClick={() => setMenu(null)}
        // EL NAVEGADOR NO LO DESPLAZA (27/10/2026): «la pantalla se centró sola y desapareció la
        // miniatura; tuve que refrescar». Si algo lo corre, vuelve a su sitio.
        onScroll={(e) => {
          const el = e.currentTarget;
          if (el.scrollTop || el.scrollLeft) {
            el.scrollTop = 0;
            el.scrollLeft = 0;
          }
        }}
      >
        <ReactFlow
          nodes={nodosAlTirar}
          edges={
            enLaRuta || coincidentes
              ? todosLosCables.map((c) =>
                  (!enLaRuta || (enLaRuta.has(fichaDelNodo(c.source)) && enLaRuta.has(fichaDelNodo(c.target)))) &&
                  (!coincidentes || coincidentes.has(fichaDelNodo(c.source)) || coincidentes.has(fichaDelNodo(c.target)))
                    ? c
                    : { ...c, style: { ...c.style, opacity: 0.12 } }
                )
              : todosLosCables
          }
          nodeTypes={TIPOS_DE_NODO}
          edgeTypes={TIPOS_DE_CABLE}
          onInit={(i) => {
            instancia.current = i;
          }}
          onNodesChange={(cambios) => {
            const previas = sumando.current;
            if (!previas) {
              alCambiarNodos(cambios);
              return;
            }
            const sueltas = new Set(cambios.flatMap((c) => (c.type === "select" && !c.selected && previas.has(c.id) ? [c.id] : [])));
            alCambiarNodos(cambios.filter((c) => !(c.type === "select" && sueltas.has(c.id))));
            if (sueltas.size > 0) setNodos((ns) => ns.map((n) => (sueltas.has(n.id) ? { ...n, selected: true } : n)));
          }}
          onSelectionStart={() => {
            const previas = new Set(nodosVivos.current.filter((n) => n.selected).map((n) => n.id));
            sumando.current = previas;
            if (previas.size > 0) setNodos((ns) => ns.map((n) => (previas.has(n.id) ? { ...n, selected: true } : n)));
          }}
          onSelectionEnd={() => {
            const previas = sumando.current;
            sumando.current = null;
            if (previas && previas.size > 0) setNodos((ns) => ns.map((n) => (previas.has(n.id) ? { ...n, selected: true } : n)));
          }}
          onNodeDragStop={(_, __, movidos) => {
            const actual = vivo.current;
            const donde = new Map(movidos.filter((n) => !n.id.startsWith("caja:") && !n.id.startsWith("est:") && !n.id.startsWith("esp:") && n.draggable !== false).map((n) => [n.id, n.position]));
            const cajas = new Map(movidos.filter((n) => n.id.startsWith("caja:")).map((n) => [n.id.slice(5), n.position]));
            const espejosMovidos = new Map(movidos.filter((n) => n.id.startsWith("esp:")).map((n) => [n.id.slice(4), n.position]));
            const textosMovidos = new Map(movidos.filter((n) => n.id.startsWith("texto:")).map((n) => [n.id.slice(6), n.position]));
            cambiar({
              ...actual,
              ...(textosMovidos.size
                ? {
                    textos: (actual.textos ?? []).map((x) => {
                      const p = textosMovidos.get(x.id);
                      return p ? { ...x, x: Math.round(p.x), y: Math.round(p.y) } : x;
                    }),
                  }
                : {}),
              ...(espejosMovidos.size
                ? {
                    espejos: (actual.espejos ?? []).map((e) => {
                      const p = espejosMovidos.get(e.id);
                      return p ? { ...e, x: Math.round(p.x), y: Math.round(p.y) } : e;
                    }),
                  }
                : {}),
              fichas: actual.fichas.map((f) => {
                const p = donde.get(f.id);
                return p ? { ...f, x: Math.round(p.x), y: Math.round(p.y) } : f;
              }),
              cajas: (actual.cajas ?? []).map((c) => {
                const p = cajas.get(c.id);
                return p ? { ...c, x: Math.round(p.x), y: Math.round(p.y) } : c;
              }),
            });
          }}
          onConnect={(c) => {
            if (!c.source || !c.target || !c.sourceHandle) return;
            // Desde una bolita de estación, el cable es de SU ficha (modo estaciones: solo dibujo).
            const de = fichaDelNodo(c.source);
            const a = fichaDelNodo(c.target);
            if (de === a) return;
            const actual = vivo.current;
            // 🪞 Desde el puntito de un gemelo (13/11/2026): la salida es la misma de su primera aparición.
            const salida = salidaDelPunto(c.sourceHandle);
            // NO SE CONECTA DONDE NO DEBE (26/10/2026): el cable no se pone y se dice por qué.
            const motivo = porQueNoSeConecta(actual, de, salida, a);
            if (motivo) {
              setAviso(motivo);
              return;
            }
            // UNA SALIDA, UN CABLE: tirar otro desde el mismo puntito reemplaza al anterior.
            const lista = actual.cables.filter((x) => !(x.de === de && x.salida === salida));
            // 🪞 Conectado desde o hacia un espejo: el cable es de la ficha; solo se dibuja desde ahí.
            lista.push({
              id: `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
              de,
              salida,
              a,
              ...(c.source.startsWith("esp:") ? { de_espejo: c.source.slice(4) } : {}),
              ...(c.target.startsWith("esp:") ? { a_espejo: c.target.slice(4) } : {}),
            });
            cambiar({ ...actual, cables: lista });
          }}
          onConnectStart={(e, p) => {
            const q = "touches" in e ? e.touches[0] : (e as MouseEvent);
            inicioDelTiro.current = q ? { x: q.clientX, y: q.clientY } : null;
            if (p.nodeId && p.handleId && p.handleType === "source") setTirando({ de: fichaDelNodo(p.nodeId), salida: salidaDelPunto(p.handleId) });
          }}
          // SOLTAR EL CABLE EN EL VACÍO: se ofrece crear ahí una ficha ya conectada. (El cable viejo
          // vuelve a verse: solo se reemplaza si el nuevo llega a una ficha o se crea una.)
          onConnectEnd={(evento, estado) => {
            setTirando(null);
            if (estado.isValid || !estado.fromNode || !estado.fromHandle?.id) return;
            const punto = "changedTouches" in evento ? evento.changedTouches[0] : (evento as MouseEvent);
            // Un clic en el puntito (sin arrastrar) no es «soltar en el vacío»: abre la lista «Conectar a…».
            const desde = inicioDelTiro.current;
            if (desde && Math.hypot(punto.clientX - desde.x, punto.clientY - desde.y) < 6) return;
            const p = instancia.current?.screenToFlowPosition({ x: punto.clientX, y: punto.clientY });
            if (!p) return;
            setMenu({ x: punto.clientX, y: punto.clientY, m: { tipo: "crear", donde: { x: p.x, y: p.y - 20 }, desde: { ficha: fichaDelNodo(estado.fromNode.id), salida: salidaDelPunto(estado.fromHandle.id) } } });
          }}
          onPaneContextMenu={(e) => {
            e.preventDefault();
            const p = instancia.current?.screenToFlowPosition({ x: e.clientX, y: e.clientY });
            if (p) setMenu({ x: e.clientX, y: e.clientY, m: { tipo: "crear", donde: p } });
          }}
          onPaneClick={() => {
            setCajaElegida(null);
            setMenu(null);
            setDestacada(null);
            setFamiliaEspejo(null);
          }}
          // TOCAR UNA FICHA DE UN PAÍS CAMBIA LA BANDERA a ese país (27/10/2026).
          onNodeClick={(_, n) => {
            if (n.type === "ficha" || n.type === "inicio") onFichaTocada?.(n.id);
            // 🪞 LA FAMILIA DE ESPEJOS SE ILUMINA (12/11/2026). Él: «cuando clickee la ficha original los espejos se
            // resalten unos segundos… y al tocar el espejo, todos los vinculados». La original y todos sus espejos
            // quedan con el borde magenta fijo (13/11/2026; antes latían unos segundos) hasta tocar otra cosa.
            const ficha = fichaDelNodo(n.id);
            const suyos = (vivo.current.espejos ?? []).filter((e) => e.ficha === ficha);
            setFamiliaEspejo(suyos.length ? new Set([ficha, `est:${ficha}`, ...suyos.map((e) => `esp:${e.id}`)]) : null);
          }}
          connectionLineComponent={CableQueSeTira}
          // El clic en un puntito abre la lista «Conectar a…» (no el modo de conectar con dos clics).
          connectOnClick={false}
          deleteKeyCode={null}
          // Como la pizarra: con fondo oscuro, los recuadros de selección y los controles en oscuro.
          colorMode={tema === "oscuro" ? "dark" : "light"}
          // El doble clic abre la ficha; no acerca el lienzo (se comía el doble clic de las cajas).
          zoomOnDoubleClick={false}
          // COMO EN LA PIZARRA: Shift + arrastrar en el vacío dibuja el recuadro (arrastrar sin Shift
          // mueve la vista), Shift + clic suma o quita una ficha, y solo cuenta lo que queda ENTERO
          // dentro del recuadro.
          selectionKeyCode="Shift"
          multiSelectionKeyCode={["Shift", "Control", "Meta"]}
          selectionMode={SelectionMode.Full}
          {...(vistaGuardada ? { defaultViewport: vistaGuardada } : {})}
          fitView={!vistaGuardada}
          fitViewOptions={{ padding: 0.12, maxZoom: 1 }}
          // MÁS LEJOS (13/11/2026, él: «necesito más zoom out… no puedo ver mis demás workflows cuando son muchos»): del 10 % al 2 %.
          minZoom={0.02}
          // MÁS ACERCAMIENTO CON LA RUEDITA (28/10/2026: «mira el tamaño que ofrece Sendy»): hasta 4×.
          maxZoom={4}
          // EL IMÁN AL ARRASTRAR (28/10/2026: «clap, clap, clap, se alinea a los puntos… pasos cortitos»):
          // las fichas avanzan de a medio punto de la rejilla de fondo (22 px) y quedan alineadas.
          snapToGrid
          snapGrid={[11, 11]}
          // SOLO SE DIBUJA LO QUE ESTÁ A LA VISTA (27/10/2026: «¿estás mostrando todas las fichas, incluso
          // las que no se ven?» — sí: todas, de todos los países). Al arrastrar ya no se recalcula todo.
          onlyRenderVisibleElements
          proOptions={{ hideAttribution: true }}
          style={{ background: "transparent" }}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.6} color={t.puntos} />
          <Controls showInteractive={false} />
          {/* LA MINIATURA NAVEGA (27/10/2026: «parece cosmética»): clic para ir ahí, arrastrar para mover la
              vista, rueda para acercar o alejar. */}
          <MiniMap
            pannable
            zoomable
            nodeStrokeWidth={3}
            // Las esquinas de los velos no se dibujan en el mapa (el velo ya está).
            nodeColor={(n) => (n.type === "esquinas" ? "transparent" : (undefined as unknown as string))}
            onClick={(_, p) => instancia.current?.setCenter(p.x, p.y, { zoom: instancia.current.getZoom(), duration: 300 })}
            style={{ cursor: "pointer" }}
          />
          <ZonaDeLaSeleccion />
          <LineaAlDestinoVisible />
          <SoltarConEscape tirando={!!tirando} alSoltar={soltarElCable} />
          <ZoomDelTablero />
        </ReactFlow>

        {/* LA «T» PUESTA (13/11/2026): un clic pone el texto ahí y se escribe en el acto; Esc cancela. */}
        {poniendoTexto && (
          <div
            data-poniendo-texto
            className="absolute inset-0 z-30"
            style={{ cursor: "text" }}
            onClick={(e) => {
              const p = instancia.current?.screenToFlowPosition({ x: e.clientX, y: e.clientY }) ?? { x: 0, y: 0 };
              const id = `t-${Date.now().toString(36)}`;
              setTextoRecienCreado(id);
              setPoniendoTexto(false);
              cambiar({ ...vivo.current, textos: [...(vivo.current.textos ?? []), { id, x: Math.round(p.x), y: Math.round(p.y - 14), texto: "Texto" }] });
              window.setTimeout(() => setTextoRecienCreado(null), 600);
            }}
          >
            <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-violet-600 px-4 py-2 text-sm font-bold text-white shadow-lg">
              T · Haz clic donde quieres el texto · Esc cancela
            </div>
          </div>
        )}
        {/* DIBUJAR EL VELO (13/11/2026): encima del lienzo mientras se dibuja; Esc cancela. */}
        {dibujando && (
          <div
            data-dibujando-velo
            className="absolute inset-0 z-30 cursor-crosshair"
            style={{ touchAction: "none" }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              const r = e.currentTarget.getBoundingClientRect();
              setTrazo({ x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY, ox: r.left, oy: r.top });
            }}
            onPointerMove={(e) => {
              if (trazo) setTrazo({ ...trazo, x1: e.clientX, y1: e.clientY });
            }}
            onPointerUp={(e) => {
              if (!trazo) return;
              crearVeloDibujado(dibujando, { x: trazo.x0, y: trazo.y0 }, { x: e.clientX, y: e.clientY });
              setTrazo(null);
              setDibujando(null);
            }}
          >
            <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-violet-600 px-4 py-2 text-sm font-bold text-white shadow-lg">
              ✏️ Arrastra para dibujar {dibujando.pais === undefined ? "la caja" : `el área de ${dibujando.pais ? `${banderaDe(dibujando.pais)} ${dibujando.pais}` : "🌍 Otros países"}`}, o haz un clic · Esc cancela
            </div>
            {trazo && (
              <div
                className="pointer-events-none absolute rounded-2xl border-2 border-dashed border-violet-500 bg-violet-500/10"
                style={{
                  left: Math.min(trazo.x0, trazo.x1) - trazo.ox,
                  top: Math.min(trazo.y0, trazo.y1) - trazo.oy,
                  width: Math.abs(trazo.x1 - trazo.x0),
                  height: Math.abs(trazo.y1 - trazo.y0),
                }}
              />
            )}
          </div>
        )}

        {/* ← + ☰, DENTRO DEL LIENZO, arriba a la izquierda, como en la pizarra (24/10/2026): «el selector
            de ficha, país, caja, buscar, están en una posición que me tapa, guíate de cómo se hizo en el
            modo automático». Lo demás se abre al pulsarlos. */}
        <div className="absolute left-3 top-3 z-20 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {antesDelMas}
          {/* SE ABRE AL PASAR EL PUNTERO (31/10/2026). Él: «con solo pasar el puntero del mouse ahí, que se
              despliegue». Al salir se cierra AL INSTANTE (él: «la desaparición tiene que ser al instante»); el
              menú va pegado al botón (sin hueco), así se baja a él sin salir. */}
          <div
            className="relative"
            ref={cajaDelMas}
            onMouseEnter={() => setMenuMas(true)}
            onMouseLeave={() => setMenuMas(false)}
          >
            <button
              type="button"
              onClick={() => setMenuMas((v) => !v)}
              title="Agregar"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-violet-600 text-xl font-bold text-white shadow-md hover:bg-violet-700"
            >
              {menuMas ? "×" : "+"}
            </button>
            {menuMas && (
              // El relleno de arriba (pt-2) es parte del menú: el puntero baja del «+» al menú sin salir de él.
              <div className="absolute left-0 top-full z-50 pt-2">
              <div className="max-h-[75vh] w-72 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 text-sm text-slate-800 shadow-2xl">
                <div className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">Agregar al tablero</div>
                {/* LAS PLANTILLAS (01/11/2026), como importar en n8n: una tubería entera, conectada por dentro, al
                    lado de lo suyo y sin conectar a ningún país. */}
                {onPlantillas && (
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-semibold text-violet-800 hover:bg-violet-50"
                    onClick={() => {
                      setMenuMas(false);
                      onPlantillas(centroDeLaVista());
                    }}
                  >
                    <span className="w-5 text-center">📋</span> Plantillas de modalidad…
                  </button>
                )}
                {TIPOS_PARA_CREAR.map((tipo) => (
                  <button
                    key={tipo}
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-slate-100"
                    onClick={() => {
                      setMenuMas(false);
                      crearFicha(tipo, centroDeLaVista());
                    }}
                  >
                    <span className="w-5 text-center">{ASPECTO[tipo].icono}</span> {ASPECTO[tipo].nombre}
                  </button>
                ))}
                <div className="my-1 border-t border-slate-200" />
                {/* EL ÁREA DE UN PAÍS, como en la pizarra: su Inicio con su manta. */}
                <div className="px-3 pb-1 pt-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">🌎 Área de un país</div>
                <div className="max-h-40 overflow-y-auto">
                  {[...paisesDisponibles.filter((p) => !paisesConInicio.has(p)), ...(paisesConInicio.has("") ? [] : [""])].map((p) => (
                    <button
                      key={p || "otros"}
                      type="button"
                      className="flex w-full items-center gap-2 px-5 py-1 text-left text-xs hover:bg-slate-100"
                      onClick={() => {
                        // (13/11/2026: ya no cae sola en un sitio libre: él la dibuja arrastrando. Ver `dibujando`.)
                        setMenuMas(false);
                        setDibujando({ pais: p });
                      }}
                    >
                      {p ? `${banderaDe(p)} ${p}` : "🌍 Otros países"}
                    </button>
                  ))}
                </div>
                <div className="my-1 border-t border-slate-200" />
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-slate-100"
                  title="Solo un fondo para ordenar, sin país: se estira por las esquinas y se borra con Delete"
                  onClick={() => {
                    // (13/11/2026: se dibuja arrastrando. Ver `dibujando`.)
                    setMenuMas(false);
                    setDibujando({});
                  }}
                >
                  <span className="h-2.5 w-3.5 rounded-sm border-2 border-dashed border-slate-400" /> Caja libre (solo fondo, sin país)
                </button>
              </div>
              </div>
            )}
          </div>
          {/* LA HERRAMIENTA «T» (13/11/2026): escribir un texto suelto en el tablero. */}
          <button
            type="button"
            onClick={() => setPoniendoTexto((v) => !v)}
            title="Texto: clic aquí y luego clic en el tablero donde lo quieres"
            className={`flex h-9 w-9 items-center justify-center rounded-full font-serif text-lg font-black shadow-md ${
              poniendoTexto ? "bg-violet-600 text-white" : "border border-slate-300 bg-white text-slate-800 hover:bg-slate-100"
            }`}
          >
            T
          </button>
          {/* LA BARRA LIMPIA (01/11/2026). Él: «me confunde lo de los menús que están arriba… quitan espacio,
              meterlos en el menú hamburguesa». Estaciones, acomodar, qué falta conectar y ver todo como cable van
              DENTRO del ☰ (`despuesDelMas` los recibe y los pone en su lista). */}
          {typeof despuesDelMas === "function"
            ? despuesDelMas(
                <>
                  <div className="px-3 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wide text-tinta-suave">Cómo se ve el tablero</div>
                  {(
                    [
                      ["🚉", estaciones ? "Estaciones: sí (quitar)" : "Ver estaciones", "El camino por estaciones, como Sendy. Solo cambia cómo se ve.", () => cambiarEstaciones(!estaciones), estaciones],
                      ...(estaciones
                        ? ([
                            [
                              comoAgente ? "🚉" : "🤖",
                              comoAgente ? "Verlas como estación" : "Verlas como Agente IA",
                              "Solo cambia el dibujo: el robot o la bolita de estación.",
                              () => cambiarComoAgente(!comoAgente),
                              false,
                            ],
                            ["📐", "Acomodar como camino", "Separa las fichas para que quepan sus estaciones. Ctrl+Z lo deshace.", acomodarComoCamino, false],
                          ] as const)
                        : []),
                      ["🔍", revisando ? "Dejar de revisar" : "Qué falta conectar", "Marca en rojo las salidas que, sin cable, dejan al cliente sin camino.", () => setRevisando((v) => !v), revisando],
                      ["〰", todoCable ? "Volver al modo inalámbrico" : "Ver todo como cable", "Solo para mirar: todas las conexiones como línea.", () => setTodoCable((v) => !v), todoCable],
                    ] as Array<readonly [string, string, string, () => void, boolean]>
                  ).map(([icono, texto, ayuda, hacer, activo]) => (
                    <button
                      key={texto}
                      type="button"
                      title={ayuda}
                      onClick={hacer}
                      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-relleno ${activo ? "font-bold text-emerald-700" : ""}`}
                    >
                      <span className="w-5 text-center">{icono}</span> {texto}
                    </button>
                  ))}
                </>
              )
            : despuesDelMas}
          <button
            type="button"
            onClick={() => {
              setLupaAbierta((v) => !v);
              setEnLaLupa("");
            }}
            title="Buscar una ficha por su número (86) o por lo que dice"
            className={`flex h-9 w-9 items-center justify-center rounded-full text-lg shadow-md ${
              lupaAbierta ? "bg-violet-600 text-white" : "border border-slate-300 bg-white text-slate-800 hover:bg-slate-100"
            }`}
          >
            🔍
          </button>
          {lupaAbierta && (
            <input
              autoFocus
              type="search"
              value={enLaLupa}
              onChange={(e) => setEnLaLupa(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setEnLaLupa("");
                  setLupaAbierta(false);
                }
              }}
              placeholder="N.º de ficha (ej. 86) o texto"
              className="h-9 w-52 rounded-full border-2 border-violet-500 bg-white px-3 text-sm text-slate-800 shadow-md outline-none"
            />
          )}
          {faltas && (
            <div className="relative flex flex-col items-start gap-1">
              <div className="flex items-center gap-1.5">
                <select
                  value={alcance}
                  onChange={(e) => setAlcance(e.target.value)}
                  title="Qué revisar: todo el tablero, un país o una ruta de su Ruteador"
                  className="rounded-full border border-borde bg-tarjeta px-2 py-1 text-[11px] font-semibold text-tinta shadow"
                >
                  <option value="">🔍 Todo el tablero</option>
                  {alcances.map((o) => (
                    <option key={o.id + o.nombre} value={o.id}>
                      {o.nombre}
                    </option>
                  ))}
                </select>
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold shadow ${faltas.length ? "bg-red-100 text-red-900" : "bg-emerald-100 text-emerald-900"}`}>
                  {faltas.length === 0 ? (
                    "✅ Sin faltas"
                  ) : (
                    <>
                      Faltan {faltas.length} ·{" "}
                      <button
                        type="button"
                        className="underline"
                        onClick={() => instancia.current?.fitView({ nodes: [...new Set(faltas.map((x) => x.ficha))].map((id) => ({ id })), padding: 0.3, maxZoom: 1, duration: 500 })}
                      >
                        verlas todas
                      </button>
                    </>
                  )}
                </span>
              </div>
              {/* La lista, a la vista y no en un globo: cada línea lleva a su ficha. */}
              {faltas.length > 0 && (
                <ul className="max-h-56 w-[340px] max-w-[80vw] overflow-y-auto rounded-lg border border-red-200 bg-tarjeta p-1 text-[11px] text-tinta shadow-lg">
                  {faltas.map((x, i) => (
                    <li key={x.ficha + x.salida + i}>
                      <button
                        type="button"
                        onClick={() => instancia.current?.fitView({ nodes: [{ id: x.ficha }], padding: 0.4, maxZoom: 1, duration: 500 })}
                        className="flex w-full gap-1.5 rounded px-2 py-1 text-left hover:bg-red-50"
                      >
                        <span className="shrink-0 font-bold text-red-700">{numeroDe[x.ficha] ?? "▶"}</span>
                        <span>
                          {(() => {
                            const f = tablero.fichas.find((y) => y.id === x.ficha);
                            return f ? <b>{f.titulo?.trim() || ASPECTO[f.tipo].nombre} · </b> : null;
                          })()}
                          {x.motivo}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {coincidentes && (
            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-900 shadow">
              {coincidentes.size === 0 ? (
                "🔍 ninguna ficha"
              ) : (
                <>
                  🔍 {coincidentes.size} ficha(s) ·{" "}
                  <button
                    type="button"
                    className="underline"
                    onClick={() => instancia.current?.fitView({ nodes: [...coincidentes].map((id) => ({ id })), padding: 0.3, maxZoom: 1, duration: 500 })}
                  >
                    ir a ellas
                  </button>
                </>
              )}
            </span>
          )}
        </div>

        {/* «FICHAS GUARDADAS», como en la pizarra: fuera del lienzo, a un clic de volver. */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setPanel((v) => !v);
          }}
          className="absolute bottom-4 left-16 z-10 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow hover:bg-slate-50"
        >
          📦 Fichas guardadas ({guardadas.length})
        </button>
        {panel && (
          <div className="absolute bottom-14 left-16 z-20 max-h-[50vh] w-72 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 text-slate-800 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            {guardadas.length === 0 && <div className="p-2 text-xs text-slate-500">No hay fichas guardadas. Clic derecho en una ficha → «Guardar en Fichas guardadas».</div>}
            {guardadas.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => {
                  const c = centroDeLaVista();
                  cambiar({ ...vivo.current, fichas: vivo.current.fichas.map((x) => (x.id === f.id ? { ...x, guardada: false, x: Math.round(c.x), y: Math.round(c.y) } : x)) });
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-slate-100"
                title="Sacarla al lienzo"
              >
                <span>{ASPECTO[f.tipo].icono}</span>
                <span className="truncate font-semibold">{f.titulo?.trim() || ASPECTO[f.tipo].nombre}</span>
              </button>
            ))}
          </div>
        )}

        {aviso && (
          <div className="pointer-events-none absolute bottom-16 left-1/2 z-30 -translate-x-1/2 rounded-lg bg-slate-900/90 px-3 py-1.5 text-xs font-semibold text-white shadow-lg">
            {aviso}
          </div>
        )}

        {/* 🇦🇷 PASAR A VOSEO: mientras pide, y el resumen. */}
        {voseo && (
          <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={() => voseo.fase === "listo" && setVoseo(null)}>
            <div className="my-16 w-full max-w-xl rounded-xl border border-slate-200 bg-white p-5 text-slate-800 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <h3 className="mb-2 text-base font-bold">
                {voseo.modo === "voseo" ? "🇦🇷 Pasar a voseo" : voseo.modo === "tuteo" ? "🔄 Quitar voseo" : "✏️ Corregir ortografía"}
              </h3>
              {voseo.fase === "pidiendo" ? (
                <p className="py-4 text-sm text-slate-600">
                  {voseo.modo === "voseo" ? "Pasando a voseo" : voseo.modo === "tuteo" ? "Quitando el voseo de" : "Corrigiendo"} {voseo.fichas === 1 ? "1 ficha" : `${voseo.fichas} fichas`}… (unos segundos; los
                  comodines no llegan a la IA)
                </p>
              ) : (
                <>
                  <p className="text-sm font-bold text-emerald-700">
                    ✅ {voseo.fichas === 1 ? "1 ficha" : `${voseo.fichas} fichas`} · {voseo.cambiadas} {voseo.cambiadas === 1 ? "texto cambiado" : "textos cambiados"}
                    {voseo.descartadas.length > 0 ? ` · ${voseo.descartadas.length} quedaron igual` : ""}
                  </p>
                  <p className="mt-1 text-[12px] text-slate-500">
                    {voseo.cambiadas > 0
                      ? "Ya está puesto en las fichas. Revísalas y guarda con Ctrl+S; Ctrl+Z lo deshace todo de una vez."
                      : "No había nada que cambiar: las fichas quedaron como estaban."}
                    {voseo.costo > 0 ? ` Costó $${voseo.costo.toFixed(4)}.` : ""}
                  </p>
                  {voseo.descartadas.length > 0 && (
                    <div className="mt-3 flex max-h-72 flex-col gap-1.5 overflow-y-auto">
                      {voseo.descartadas.map((d, k) => (
                        <div key={k} className="rounded-lg border border-amber-300 bg-amber-50 px-2 py-1.5 text-[12px] text-amber-900">
                          <b>{d.ficha}</b>: «{d.texto}…» se queda como está ({d.motivo}). Cámbiala a mano si hace falta.
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="mt-3 flex justify-end">
                    <button type="button" onClick={() => setVoseo(null)} className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700">
                      Cerrar
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* EL MENÚ DEL CLIC DERECHO */}
        {menu && (
          <div
            className="fixed z-50 max-h-[85vh] w-64 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 text-slate-800 shadow-2xl"
            ref={(el) => encajarEnLaPantalla(el)}
            style={{ left: Math.min(menu.x, window.innerWidth - 270), top: Math.max(8, Math.min(menu.y, window.innerHeight - 480)) }}
            onClick={(e) => e.stopPropagation()}
          >
            {menu.m.tipo === "crear" && (
              <>
                {/* 📋 PEGAR AQUÍ (06/11/2026): lo copiado (de esta tienda o de otra), donde se hizo el clic derecho. */}
                {!menu.m.desde && portapapeles && (
                  <button
                    type="button"
                    className={`${opcionDeMenu} border-b border-slate-200 font-semibold`}
                    onClick={() => {
                      const m = menu.m as Extract<Menu, { tipo: "crear" }>;
                      pegarLoCopiado(m.donde);
                      setMenu(null);
                    }}
                  >
                    📋 Pegar aquí ({portapapeles.fichas.length} ficha{portapapeles.fichas.length === 1 ? "" : "s"}
                    {portapapeles.cajas?.length ? ` y ${portapapeles.cajas.length} velo${portapapeles.cajas.length === 1 ? "" : "s"}` : ""})
                  </button>
                )}
                <div className="px-3 pb-1 pt-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  {menu.m.desde ? "Crear conectada" : "Crear aquí"}
                </div>
                {TIPOS_PARA_CREAR.map((tipo) => (
                  <button
                    key={tipo}
                    type="button"
                    className={opcionDeMenu}
                    onClick={() => {
                      const m = menu.m as Extract<Menu, { tipo: "crear" }>;
                      crearFicha(tipo, m.donde, m.desde);
                      setMenu(null);
                    }}
                  >
                    {ASPECTO[tipo].icono} {ASPECTO[tipo].nombre}
                  </button>
                ))}
                {/* LA CAJA LIBRE, IGUAL QUE EN EL «+» (14/11/2026). Él: que la del clic derecho sea la misma «Caja libre (solo
                    fondo, sin país)», al final y con su mismo dibujito; se dibuja arrastrando, o un clic la pone de su tamaño. */}
                {!menu.m.desde && (
                  <button
                    type="button"
                    className={`${opcionDeMenu} flex items-center gap-2 border-t border-slate-200`}
                    title="Solo un fondo para ordenar, sin país: arrastra para dibujarla, o haz un clic y sale de su tamaño"
                    onClick={() => {
                      setMenu(null);
                      setDibujando({});
                    }}
                  >
                    <span className="h-2.5 w-3.5 shrink-0 rounded-sm border-2 border-dashed border-slate-400" /> Caja libre (solo fondo, sin país)
                  </button>
                )}
              </>
            )}
            {menu.m.tipo === "ficha" && fichaDelMenu && (
              <>
                {/* El nombre arriba, como en la pizarra: se sabe sobre qué ficha se está. */}
                <div className="truncate border-b border-slate-200 px-3 py-1.5 text-[11px] font-semibold text-slate-500">
                  {fichaDelMenu.tipo === "inicio"
                    ? `▶ Inicio · ${fichaDelMenu.pais ? `${banderaDe(fichaDelMenu.pais)} ${fichaDelMenu.pais}` : "🌍 Otros países"}`
                    : `${espejoDelMenu ? "🪞 Espejo de · " : ""}${ASPECTO[fichaDelMenu.tipo].icono} ${fichaDelMenu.titulo?.trim() || ASPECTO[fichaDelMenu.tipo].nombre}`}
                </div>
                {/* 🪞 EL ESPEJO (05/11/2026): desde un espejo, ir a la original o quitar solo este espejo. */}
                {espejoDelMenu && (
                  <>
                    <button
                      type="button"
                      className={opcionDeMenu}
                      onClick={() => {
                        setMenu(null);
                        instancia.current?.fitView({ nodes: [{ id: fichaDelMenu.id }], padding: 1.2, maxZoom: 1, duration: 500 });
                        setDestacada(fichaDelMenu.id);
                      }}
                    >
                      🎯 Ir a la original
                    </button>
                    <button
                      type="button"
                      className={opcionDeMenu}
                      onClick={() => {
                        cambiar(sinEspejos(vivo.current, new Set([espejoDelMenu])));
                        setMenu(null);
                        setAviso("Espejo quitado. La ficha y sus cables siguen en su sitio.");
                      }}
                    >
                      🪞 Quitar este espejo (la ficha se queda)
                    </button>
                  </>
                )}
                {/* Un Inicio sin manta (de antes del 24/10, o porque se borró): se le pone una. */}
                {fichaDelMenu.tipo === "inicio" && !(tablero.cajas ?? []).some((c) => c.inicio === fichaDelMenu.id) && (
                  <button
                    type="button"
                    className={opcionDeMenu}
                    onClick={() => {
                      cambiar({ ...vivo.current, cajas: [...(vivo.current.cajas ?? []), mantaPara(vivo.current, fichaDelMenu)] });
                      setMenu(null);
                    }}
                  >
                    🌎 Ponerle su manta
                  </button>
                )}
                {fichaDelMenu.tipo !== "inicio" && (
                  <button type="button" className={opcionDeMenu} onClick={() => (apuntarParaReelegir(fichaDelMenu.id), onAbrir(fichaDelMenu.id), setMenu(null))}>
                    ✏️ Abrir
                  </button>
                )}
                <button type="button" className={opcionDeMenu} onClick={() => (onAjustes(fichaDelMenu.id), setMenu(null))}>
                  ⚙ Ajustes de la ficha
                </button>
                {/* 📋 COPIAR (06/11/2026), lo mismo que Ctrl+C: si esta ficha está entre las elegidas, copia todas las
                    elegidas; si no, solo ésta. Se pega con Ctrl+V o con «📋 Pegar aquí» en un espacio vacío. */}
                {(() => {
                  const g = loElegido();
                  const delGrupo = new Set(elegidas().map(fichaDelNodo));
                  const enGrupo = delGrupo.has(fichaDelMenu.id) && delGrupo.size + g.espejos.size > 1;
                  const ids = enGrupo ? g.fichas : new Set([fichaDelMenu.id]);
                  return (
                    <button
                      type="button"
                      className={opcionDeMenu}
                      onClick={() => (copiarLas(ids, enGrupo ? cajasElegidas() : new Set(), enGrupo ? g.espejos : new Set()), setMenu(null))}
                    >
                      📋 {ids.size > 1 ? `Copiar las ${ids.size} fichas elegidas` : "Copiar"}
                    </button>
                  );
                })()}
                {/* 🇦🇷 PASAR A VOSEO (12/11/2026, ver `vosear`): las elegidas si esta ficha está entre ellas; si no, solo ésta. */}
                {(() => {
                  const g = loElegido();
                  const delGrupo = new Set([...g.fichas, ...(vivo.current.espejos ?? []).filter((e) => g.espejos.has(e.id)).map((e) => e.ficha)]);
                  const base = delGrupo.has(fichaDelMenu.id) && delGrupo.size > 1 ? [...delGrupo] : [fichaDelMenu.id];
                  const ids = base.filter((id) => {
                    const f = vivo.current.fichas.find((x) => x.id === id);
                    return !!f && textosDeLaFicha(f).some((t) => t.trim());
                  });
                  if (ids.length === 0) return null;
                  const cuantas = ids.length > 1 ? ` (las ${ids.length} fichas elegidas)` : "";
                  return (
                    <>
                      <button
                        type="button"
                        className={opcionDeMenu}
                        disabled={voseo?.fase === "pidiendo"}
                        onClick={() => {
                          setMenu(null);
                          void vosear(ids, "voseo");
                        }}
                      >
                        🇦🇷 Pasar a voseo{cuantas}
                      </button>
                      <button
                        type="button"
                        className={opcionDeMenu}
                        disabled={voseo?.fase === "pidiendo"}
                        onClick={() => {
                          setMenu(null);
                          void vosear(ids, "ortografia");
                        }}
                      >
                        ✏️ Corregir ortografía{cuantas}
                      </button>
                      <button
                        type="button"
                        className={opcionDeMenu}
                        disabled={voseo?.fase === "pidiendo"}
                        onClick={() => {
                          setMenu(null);
                          void vosear(ids, "tuteo");
                        }}
                      >
                        🔄 Quitar voseo{cuantas}
                      </button>
                    </>
                  );
                })()}
                {fichaDelMenu.tipo !== "inicio" && (
                  <>
                    <button
                      type="button"
                      className={opcionDeMenu}
                      onClick={() => {
                        const c = copiarFichas([fichaDelMenu], [], sinEncimarse(vivo.current.fichas, fichaDelMenu, { x: 40, y: 260 }));
                        cambiar({ ...vivo.current, fichas: [...vivo.current.fichas, ...c.fichas] });
                        setMenu(null);
                      }}
                    >
                      ⧉ Duplicar aquí al lado
                    </button>
                    {/* 🪞 CREAR ESPEJO (05/11/2026): la MISMA ficha dibujada en otro sitio, para no tirar cables largos. */}
                    <button
                      type="button"
                      className={opcionDeMenu}
                      onClick={() => {
                        const actual = vivo.current;
                        const desde = espejoDelMenu ? (actual.espejos ?? []).find((x) => x.id === espejoDelMenu) : undefined;
                        const base = desde ?? actual.fichas.find((x) => x.id === fichaDelMenu.id)!;
                        const nuevo = { id: `e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, ficha: fichaDelMenu.id, x: Math.round(base.x + 320), y: Math.round(base.y + 40) };
                        cambiar({ ...actual, espejos: [...(actual.espejos ?? []), nuevo] });
                        setMenu(null);
                        setAviso("🪞 Espejo creado a la derecha: es la MISMA ficha. Muévelo donde te sirva y conecta ahí los cables.");
                        window.setTimeout(() => setNodos((ns) => ns.map((n) => ({ ...n, selected: n.id === `esp:${nuevo.id}` }))), 120);
                      }}
                    >
                      🪞 Crear espejo (la misma ficha en otro sitio)
                    </button>
                    {/* «DUPLICAR PARA…», como en la pizarra: la copia queda en la manta de ese país,
                        sin conectar («nada se conecta solo»); él le tira el cable. */}
                    {(() => {
                      const otros = [...paisesConInicio].filter((p) => mantaDelPais(tablero, p) && !rutaDe(tablero, inicioDe(tablero, p) ?? "").has(fichaDelMenu.id));
                      if (otros.length === 0) return null;
                      return (
                        <div className="border-t border-slate-200 pt-1">
                          <div className="px-3 py-1 text-[11px] font-semibold text-slate-500">⧉ Duplicar para… (sin conectar)</div>
                          {otros.map((p) => (
                            <button
                              key={p || "otros"}
                              type="button"
                              className={`${opcionDeMenu} pl-6`}
                              onClick={() => {
                                const m = mantaDelPais(vivo.current, p)!;
                                const original = vivo.current.fichas.find((x) => x.id === fichaDelMenu.id)!;
                                const c = copiarFichas([original], [], sinEncimarse(vivo.current.fichas, original, { x: m.x + 60 - original.x, y: m.y + Math.max(70, m.alto - 300) - original.y }));
                                cambiar({ ...vivo.current, fichas: [...vivo.current.fichas, ...c.fichas] });
                                setMenu(null);
                                setAviso(`Copia puesta en la manta de ${p ? `${banderaDe(p)} ${p}` : "🌍 Otros países"}, abajo a la izquierda. Conéctala con su cable.`);
                                const nueva = c.fichas[0]?.id;
                                if (nueva) window.setTimeout(() => instancia.current?.fitView({ nodes: [{ id: nueva }], padding: 1.2, maxZoom: 1, duration: 500 }), 80);
                              }}
                            >
                              {p ? `${banderaDe(p)} ${p}` : "🌍 Otros países"}
                            </button>
                          ))}
                        </div>
                      );
                    })()}
                    <button
                      type="button"
                      className={opcionDeMenu}
                      onClick={() => {
                        cambiar({ ...vivo.current, fichas: vivo.current.fichas.map((x) => (x.id === fichaDelMenu.id ? { ...x, apagada: !x.apagada } : x)) });
                        setMenu(null);
                      }}
                    >
                      {fichaDelMenu.apagada ? "💡 Encender" : "🌙 Apagar (no manda nada y sigue por su →)"}
                    </button>
                    <button
                      type="button"
                      className={opcionDeMenu}
                      onClick={() => {
                        cambiar({ ...vivo.current, fichas: vivo.current.fichas.map((x) => (x.id === fichaDelMenu.id ? { ...x, guardada: true } : x)) });
                        setMenu(null);
                        setAviso("Guardada en «Fichas guardadas». Sus cables siguen funcionando.");
                      }}
                    >
                      📦 Guardar en «Fichas guardadas»
                    </button>
                    {/* GUARDAR COMO PLANTILLA (01/11/2026), como exportar en n8n: las elegidas, o esta ficha y
                        todo lo que sigue por sus cables. Se baja un archivo; se trae con «📋 Plantillas». */}
                    {onGuardarPlantilla &&
                      (() => {
                        const varias = [...new Set(elegidas().map(fichaDelNodo))].filter((id) => vivo.current.fichas.find((x) => x.id === id)?.tipo !== "inicio");
                        const usaElegidas = varias.length > 1 && varias.includes(fichaDelMenu.id);
                        const ids = usaElegidas
                          ? varias
                          : [...rutaDe(vivo.current, fichaDelMenu.id)].filter((id) => vivo.current.fichas.find((x) => x.id === id)?.tipo !== "inicio");
                        return (
                          <button
                            type="button"
                            className={opcionDeMenu}
                            onClick={() => {
                              onGuardarPlantilla(ids);
                              setMenu(null);
                            }}
                          >
                            📋 Guardar como plantilla ({usaElegidas ? `las ${ids.length} elegidas` : `esta y lo que sigue: ${ids.length}`})
                          </button>
                        );
                      })()}
                  </>
                )}
                <button
                  type="button"
                  className={`${opcionDeMenu} text-rose-600`}
                  onClick={() => {
                    const esInicio = fichaDelMenu.tipo === "inicio";
                    const suyos = (vivo.current.espejos ?? []).filter((x) => x.ficha === fichaDelMenu.id).length;
                    if (
                      !window.confirm(
                        esInicio
                          ? "¿Quitar este país? Se van su Inicio y su manta; las fichas se quedan donde están."
                          : `¿Eliminar esta ficha y sus cables?${suyos ? ` También se van sus ${suyos} espejo(s) 🪞.` : ""}`
                      )
                    )
                      return;
                    cambiar(sinFichas(vivo.current, new Set([fichaDelMenu.id])));
                    setMenu(null);
                  }}
                >
                  {fichaDelMenu.tipo === "inicio" ? "🗑 Quitar país (las fichas se quedan)" : espejoDelMenu ? "🗑 Eliminar la ficha (y sus espejos)" : "🗑 Eliminar"}
                </button>
              </>
            )}
            {menu.m.tipo === "conectar" &&
              (() => {
                const m = menu.m as Extract<Menu, { tipo: "conectar" }>;
                const origen = tablero.fichas.find((f) => f.id === m.ficha);
                const salida = origen ? salidasDeLaFicha(origen as FichaDelTablero, paisVisto, nombres, tablero as Tablero).find((s) => s.clave === m.salida) : undefined;
                const actual = tablero.cables.find((c) => c.de === m.ficha && c.salida === m.salida);
                // LA LISTA «CONECTAR A…» (27/10/2026): solo las fichas donde esa salida puede llegar.
                const posibles = tablero.fichas
                  .filter((f) => !f.guardada && f.tipo !== "inicio" && f.id !== m.ficha && !porQueNoSeConecta(tablero, m.ficha, m.salida, f.id))
                  .sort((a, b) => (numeroDe[a.id] ?? 9999) - (numeroDe[b.id] ?? 9999));
                return (
                  <>
                    <div className="border-b border-slate-200 px-3 py-1.5 text-[11px] font-semibold text-slate-500">
                      Conectar «{salida?.etiqueta.replace(/^(🔘|💬) /, "") ?? m.salida}» a…
                    </div>
                    {posibles.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        className={`${opcionDeMenu} flex items-center gap-2 ${actual?.a === f.id ? "bg-amber-50 font-bold" : ""}`}
                        onClick={() => {
                          const lista = vivo.current.cables.filter((x) => !(x.de === m.ficha && x.salida === m.salida));
                          lista.push({ id: `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`, de: m.ficha, salida: m.salida, a: f.id, ...(m.espejo ? { de_espejo: m.espejo } : {}) });
                          cambiar({ ...vivo.current, cables: lista });
                          setMenu(null);
                        }}
                      >
                        <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: ASPECTO[f.tipo].trazo }} />
                        <span className="w-6 shrink-0 text-right text-xs font-black text-slate-500">{numeroDe[f.id] ?? ""}</span>
                        <span className="truncate" title={f.titulo?.trim() || ASPECTO[f.tipo].nombre}>
                          {ASPECTO[f.tipo].icono} {f.titulo?.trim() || ASPECTO[f.tipo].nombre}
                        </span>
                        {actual?.a === f.id && <span className="ml-auto shrink-0 text-[10px]">✓ ahora</span>}
                      </button>
                    ))}
                    {posibles.length === 0 && <div className="px-3 py-2 text-xs text-slate-500">No hay fichas donde esta salida pueda llegar.</div>}
                  </>
                );
              })()}
            {menu.m.tipo === "cable" && (
              <>
                {/* DE DÓNDE SALE Y A DÓNDE VA (01/11/2026). Él: «puedo quitar los cables con clic derecho pero no dice
                    por ningún lado a qué ficha va al recortarlos». Arriba, antes de tocar nada. */}
                {(() => {
                  const c = tablero.cables.find((x) => x.id === (menu.m as { cableId: string }).cableId);
                  if (!c) return null;
                  const de = tablero.fichas.find((f) => f.id === c.de);
                  const a = tablero.fichas.find((f) => f.id === c.a);
                  const nombreDe = (f?: FichaEnElEditor) =>
                    !f ? "(ficha borrada)" : f.tipo === "inicio" ? `Inicio${f.pais ? ` ${banderaDe(f.pais)} ${f.pais}` : ""}` : `${ASPECTO[f.tipo].icono} ${f.titulo?.trim() || ASPECTO[f.tipo].nombre}`;
                  const salida = de ? salidasDeLaFicha(de as FichaDelTablero, paisVisto, nombres, tablero as Tablero).find((s) => s.clave === c.salida)?.etiqueta : undefined;
                  return (
                    <div className="max-w-xs border-b border-slate-200 px-3 py-1.5 text-[11px] leading-4 text-slate-600">
                      <div>
                        <span className="font-semibold text-slate-500">De:</span> {nombreDe(de)}
                        {salida ? <span className="text-slate-500"> ({salida})</span> : null}
                      </div>
                      <div>
                        <span className="font-semibold text-slate-500">A:</span> {nombreDe(a)}
                      </div>
                    </div>
                  );
                })()}
                {/* CABLE O COLITA, A ELECCIÓN SUYA (27/10/2026): lo que se agrega, se quita. */}
                {(() => {
                  const id = (menu.m as { cableId: string }).cableId;
                  const c = tablero.cables.find((x) => x.id === id);
                  if (!c) return null;
                  const ahora = esColita(tablero, c, false);
                  return (
                    <button
                      type="button"
                      className={opcionDeMenu}
                      onClick={() => {
                        cambiar({ ...vivo.current, cables: vivo.current.cables.map((x) => (x.id === id ? { ...x, vista: ahora ? "cable" : "colita" } : x)) });
                        setMenu(null);
                      }}
                    >
                      {ahora ? "🔌 Volver a cable (línea)" : "📡 Inalámbrico (colita con su destino)"}
                    </button>
                  );
                })()}
                <button type="button" className={opcionDeMenu} onClick={() => (curvar((menu.m as { cableId: string }).cableId, null), setMenu(null))}>
                  ↔ Enderezar
                </button>
                <button
                  type="button"
                  className={`${opcionDeMenu} text-rose-600`}
                  onClick={() => {
                    const id = (menu.m as { cableId: string }).cableId;
                    cambiar({ ...vivo.current, cables: vivo.current.cables.filter((c) => c.id !== id) });
                    setMenu(null);
                  }}
                >
                  ✕ Cortar
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </Contexto.Provider>
  );
}
