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
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  getBezierPath,
  Handle,
  MiniMap,
  NodeResizeControl,
  Position,
  ReactFlow,
  SelectionMode,
  useNodes,
  useNodesState,
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
import { avisosDeLaFicha, minutosLegibles, opcionesDe, pasosDeLaFicha, salidasDeLaFicha } from "@/lib/tablero/datos";
import type { CableDelTablero, FichaDelTablero, Tablero, TipoDeFicha } from "@/lib/tablero/tipos";
import { banderaDe } from "@/components/pizarra/banderas";
import { ASPECTO, TIPOS_PARA_CREAR } from "./aspecto";
import { copiarFichas, mantaPara, rutaDe } from "@/lib/tablero/copiar";
import { hayVentanaAbierta } from "@/lib/escape-en-pila";
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
type BurbujaDelEditor = { type?: string; texts?: string[]; enabled?: boolean; delay_after_sec?: number; buttons?: unknown[]; decisions?: unknown[] };

const TEMA = {
  claro: { fondo: "#f4f6fa", puntos: "#c3cad6", caja: "rgba(15,23,42,0.08)", tituloCaja: "#334155" },
  oscuro: { fondo: "#15161a", puntos: "#34373f", caja: "rgba(255,255,255,0.13)", tituloCaja: "#f1f5f9" },
};
const PUNTO_VERDE = "!h-[21px] !w-[21px] !border-2 !border-white !bg-emerald-500";
const PUNTO_NARANJA = "!h-[21px] !w-[21px] !border-2 !border-white !bg-orange-500";
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
  | { tipo: "ficha"; fichaId: string }
  | { tipo: "cable"; cableId: string }
  | { tipo: "crear"; donde: Punto; desde?: { ficha: string; salida: string } }
  | { tipo: "conectar"; ficha: string; salida: string }
  | { tipo: "caja"; cajaId: string };

/**
 * LO QUE NO SE PUEDE CONECTAR (26/10/2026), con su porqué en una línea. Son conexiones que nunca
 * hacen lo que parecen: el cable no se pone.
 */
function porQueNoSeConecta(t: TableroEnElEditor, de: string, salida: string, a: string): string | null {
  const origen = t.fichas.find((f) => f.id === de);
  const destino = t.fichas.find((f) => f.id === a);
  if (!origen || !destino) return null;
  if (destino.tipo === "inicio") return "Un cable no puede llegar a un Inicio: el Inicio es donde entra el cliente.";
  if (origen.tipo === "cobro" && (salida === "pagado" || salida.startsWith("prod:")) && destino.tipo !== "entregar" && destino.tipo !== "condicion")
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
    for (const c of t.cables) {
      if (c.de !== p.id || !/^(btn|dec|elige):/.test(c.salida)) continue;
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

/** Las opciones de cada seguimiento de una caja de Seguimientos: su número, sus minutos y sus salidas. */
function filasDeSeguimientos(f: FichaEnElEditor): Array<{ n: number; minutos: number; claves: string[] }> {
  return (f.seguimientos ?? []).map((s, i) => {
    const pasos = (s.variantes ?? []).flatMap((v) => (v.steps ?? []) as never[]);
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
    const salidas = salidasDeLaFicha(f as FichaDelTablero, paisVisto, nombres);
    for (const s of salidas) {
      if (conCable(f.id, s.clave)) continue;
      const nombre = s.etiqueta.replace(/^(🔘|💬) /, "");
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
        // Sin cable, el bot busca la Entrega de ese producto en su ruta (`entregaDelProductoEnSuRuta`):
        // solo falta si no la hay.
        const producto = s.clave === "pagado" ? f.cobro?.producto_id : s.clave.slice(5);
        const entrega = [...enVenta].some((id) => {
          const x = t.fichas.find((y) => y.id === id);
          return x?.tipo === "entregar" && !x.apagada && (x.producto_id === producto || (x.entregas ?? []).includes(producto ?? ""));
        });
        if (!entrega) faltas.push({ ficha: f.id, salida: s.clave, motivo: `${s.etiqueta}: no hay ninguna Entrega de ese producto en su camino.` });
      } else if (
        s.clave === "sin_respuesta" &&
        (f.tipo === "mensaje" || f.tipo === "intro_ob") &&
        trasUnaEntrega.has(f.id) &&
        !conCable(f.id, "siguiente")
      )
        faltas.push({ ficha: f.id, salida: s.clave, motivo: "Si no responde a esta oferta, ¿a dónde va? (en la venta de siempre, al Regalo)." });
    }
  }
  return faltas;
}

/** EL CABLE QUE SE TIRA, del color de la ficha de donde sale (27/10/2026). */
function CableQueSeTira({ fromX, fromY, toX, toY, fromPosition, toPosition, fromNode }: ConnectionLineComponentProps) {
  const tipo = (fromNode?.data as { ficha?: FichaEnElEditor } | undefined)?.ficha?.tipo;
  const color = tipo ? ASPECTO[tipo].trazo : "#f97316";
  const [camino] = getBezierPath({ sourceX: fromX, sourceY: fromY, sourcePosition: fromPosition, targetX: toX, targetY: toY, targetPosition: toPosition });
  return <path d={camino} fill="none" stroke={color} strokeWidth={3} strokeDasharray="6 6" />;
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
} | null>(null);

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
function QuienCobraEnElInicio({ pais }: { pais?: string }) {
  const ctx = useContext(Contexto);
  const q = pais ? ctx?.quienCobra?.[pais] : undefined;
  const [roto, setRoto] = useState(false);
  if (!q) return null;
  const foto = String(q.foto ?? "").trim();
  const nombreCorto = q.nombre.trim().split(/\s+/)[0] || q.nombre;
  const deLaGaleria = foto.startsWith("/avatares/");
  // El color que él eligió en menú usuarios (30/10/2026); sin elegir, el automático de su nombre.
  const colorElegido = /^#[0-9a-f]{6}$/i.test(String(q.color ?? "").trim()) ? String(q.color).trim() : "";
  return (
    <div
      role="button"
      tabIndex={0}
      className="nodrag pointer-events-auto absolute -right-6 -top-5 flex cursor-pointer flex-col items-center"
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

/** «👥 12 · 💰 3»: los números de una ficha, como los de las rutas de la pizarra. Nada si no hay. */
function NumerosDeLaFicha({ id }: { id: string }) {
  const ctx = useContext(Contexto);
  const n = ctx?.numeros?.[id];
  if (!n || n.clientes === 0) return null;
  return (
    <div
      className="mt-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700"
      title={`${n.clientes} cliente(s) llegaron a esta ficha y ${n.ventas} de ellos pagaron algo en el tablero. No cuenta las pruebas del simulador.`}
    >
      👥 {n.clientes} · 💰 {n.ventas} pagaron ({Math.round((n.ventas / n.clientes) * 100)}%)
    </div>
  );
}

// ── EL INICIO DE UN PAÍS ──────────────────────────────────────────────────────

function NodoDeInicio({ data }: NodeProps<Node<{ ficha: FichaEnElEditor }>>) {
  const ctx = useContext(Contexto);
  const f = data.ficha;
  const conectado = !!ctx?.tablero.cables.some((c) => c.de === f.id && (c.salida === "siguiente" || c.salida.startsWith("anuncio:")));
  // VARIAS TUBERÍAS EN UN PAÍS (26/10/2026): el Inicio separa por anuncio, cada uno con su salida.
  const [eligiendoAnuncios, setEligiendoAnuncios] = useState(false);
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
      <QuienCobraEnElInicio pais={f.pais} />
      <div className={`rounded-t-[10px] px-3 py-2 text-white ${color.banda}`}>
        <div className="text-sm font-bold">▶ Inicio</div>
        <div className="text-[11px] opacity-90">
          {!conectado ? "Desconectado" : estado === "revision" ? "En revisión · no recibe" : estado === "apagado" ? "Apagado · venta automática" : "El cliente escribe"}
        </div>
      </div>
      <div className="flex flex-col gap-1.5 p-2">
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
        <button
          type="button"
          className={`nodrag rounded-md border px-2 py-1 text-left text-[11px] font-bold ${
            estado === "venta" ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-slate-300 bg-slate-100 text-slate-700"
          }`}
          title={"Vender en este país con el tablero.\nApagado: los clientes de este país van a la venta automática de la tienda."}
          onClick={() => cambiar({ sin_venta: !f.sin_venta, en_revision: false })}
        >
          {estado === "venta" ? "🟢 Vende con el tablero" : estado === "revision" ? "🔵 En revisión · no recibe" : "⚪ Apagado · venta automática"}
        </button>
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
        <NumerosDeLaFicha id={f.id} />
      </div>
    </div>
  );
}

// ── UNA FICHA ─────────────────────────────────────────────────────────────────

function NodoDeFicha({ data, selected }: NodeProps<Node<{ ficha: FichaEnElEditor }>>) {
  const ctx = useContext(Contexto);
  const f = data.ficha;
  if (!ctx) return null;
  const a = ASPECTO[f.tipo];
  const salidas = salidasDeLaFicha(f as FichaDelTablero, ctx.paisVisto, ctx.nombres);
  const avisos = avisosDeLaFicha(ctx.tablero as Tablero, f as FichaDelTablero, ctx.paisVisto);
  const conCable = new Set(ctx.tablero.cables.filter((c) => c.de === f.id).map((c) => c.salida));
  const leLlega = ctx.tablero.cables.some((c) => c.a === f.id);
  const tenue = !!f.apagada;
  const titulo = f.titulo?.trim() || a.nombre;
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
  // «⏳ SI NO RESPONDE» NO SE VE CON SEGUIMIENTOS CONECTADOS (27/10/2026): ahí mandan ellos y el bot no
  // la usa. Si ya tenía cable, se ve (para poder cortarlo).
  const conSeguimientos = destinoDe("siguiente")?.tipo === "seguimientos";
  const visibles = salidas
    // «Otra cosa» solo en la ficha que ya la tiene conectada (26/10/2026): sin cable no hace nada.
    .filter((s) => s.clave !== "otra" || conCable.has("otra"))
    .filter((s) => !(s.clave === "sin_respuesta" && conSeguimientos && !conCable.has("sin_respuesta")))
    .map((s) =>
      // «Si no paga» hacia unos Seguimientos: se llama como lo que hace.
      s.clave === "sin_pago" && destinoDe("sin_pago")?.tipo === "seguimientos" ? { ...s, etiqueta: "⏳ Seguimientos (si no paga)" } : s
    );
  /** Una salida con su puntito (o, repetida en otro seguimiento, con el letrero de a dónde va). */
  const pastilla = (s: { clave: string; etiqueta: string }, conPunto: boolean, llave: string) => {
    const boton = s.clave.startsWith("btn:");
    const cuadrito = s.clave.startsWith("dec:") || s.clave.startsWith("elige:");
    const falta = faltan?.get(s.clave);
    // Pide cable lo que sin cable deja al cliente sin camino: sus opciones y el «Si no paga».
    const pide =
      !!falta ||
      ((boton || cuadrito || s.clave === "sin_pago" || s.clave.startsWith("rep:") || f.tipo === "condicion") && !conCable.has(s.clave));
    const destino = destinoDe(s.clave);
    return (
      <div
        key={llave}
        title={falta ?? undefined}
        className={`relative flex items-center gap-1.5 rounded-full border px-2 py-0.5 pr-4 text-[11px] font-semibold ${
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
        <span
          className="truncate"
          title={`${s.etiqueta.replace(/^(🔘|💬|✍️) /, "")}${boton ? "\nTambién si lo escribe con sus palabras (la IA reconoce cuál)." : ""}`}
        >
          {s.etiqueta.replace(/^(🔘|💬|✍️) /, "")}
          {/* Tocarlo o escribirlo lleva por el mismo cable (27/10/2026). */}
          {boton && <span className="ml-1 text-[9px] font-normal opacity-60">· o escrito</span>}
        </span>
        {!conPunto && destino && (
          // La misma opción en otro seguimiento: su cable sale de la primera; aquí, a dónde va.
          <span
            className="ml-auto shrink-0 rounded-full border-2 bg-white px-1.5 text-[10px] font-bold text-slate-800"
            style={{ borderColor: ASPECTO[destino.tipo].trazo }}
            title={`Va a ${ctx.numeroDe[destino.id] ?? ""} ${destino.titulo?.trim() || ASPECTO[destino.tipo].nombre} (el mismo cable de arriba)`}
          >
            → {ctx.numeroDe[destino.id] ?? ""}
          </span>
        )}
        {conPunto && (
          <Handle
            type="source"
            position={Position.Right}
            id={s.clave}
            className={`${PUNTO_NARANJA} ${pide ? "punto-pide-cable" : ""}`}
            title={pide ? (falta ?? "Sin cable: tíralo a donde lleva, o haz clic para elegir de una lista") : "Clic: elegir a dónde va de una lista"}
            onClick={(e) => {
              e.stopPropagation();
              ctx.menu(e.clientX, e.clientY, { tipo: "conectar", ficha: f.id, salida: s.clave });
            }}
          />
        )}
      </div>
    );
  };
  const burbujas =
    f.tipo === "mensaje" || f.tipo === "cobro" || f.tipo === "correo"
      ? resumenDeBurbujas(f.steps)
      : f.tipo === "intro_ob"
        ? resumenDeBurbujas(f.variantes?.[0]?.steps)
        : [];
  return (
    <div
      onDoubleClick={() => ctx.abrir(f.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        ctx.menu(e.clientX, e.clientY, { tipo: "ficha", fichaId: f.id });
      }}
      className={`relative w-[250px] rounded-lg border-2 bg-white text-slate-800 shadow-md ${a.borde} ${tenue ? "ficha-tenue border-dashed" : ""} ${
        selected ? "ring-4 ring-cyan-400" : ""
      }`}
      style={{
        // LA FICHA A LA QUE LLEGA LA COLITA TOCADA: solo su borde se ilumina (27/10/2026).
        ...(destacada ? { boxShadow: "0 0 0 5px #f59e0b, 0 0 22px 6px rgba(245,158,11,0.55)" } : {}),
        // Marca sutil: esta ficha tiene alguna conexión inalámbrica.
        ...(conColitas && !destacada ? { outline: "2px dotted rgba(100,116,139,0.55)", outlineOffset: 4 } : {}),
      }}
    >
      <Handle type="target" position={Position.Left} id="entra" className={PUNTO_VERDE} style={{ top: 18 }} />
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
        <span className="truncate text-xs font-bold" title={titulo}>
          {titulo}
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
              const c = copiarFichas([f], [], { x: 40, y: 260 });
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
        {f.instrucciones?.trim() && (
          <div className="truncate text-[11px] text-violet-700" title={f.instrucciones}>
            🧠 {f.instrucciones}
          </div>
        )}
        {f.tipo === "entregar" && f.por_correo && <div className="text-[11px] text-cyan-700">📧 Ofrece también por correo</div>}
        <NumerosDeLaFicha id={f.id} />
        {/* Con burbujas a la vista, el resumen no sale; lo que presenta sí (la IA solo sabe eso). */}
        {burbujas.length > 0 && (f.tipo === "mensaje" || f.tipo === "intro_ob") && (f.presenta ?? []).length > 0 && (
          <div className="truncate text-[11px] text-slate-600">🏷 Presenta: {(f.presenta ?? []).map((id) => ctx.nombres[id] ?? id).join(", ")}</div>
        )}
      </div>
      {visibles.length > 0 && f.tipo !== "seguimientos" && (
        <div className="mt-1.5 flex flex-col gap-1 border-t border-slate-200 px-2 py-1.5">
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
            const caminos = caminosDeCompra(ctx.tablero, f, ctx.nombres);
            return filasDeSeguimientos(f).map((fila) => (
              <div key={fila.n} className="flex flex-col gap-1">
                <div className="flex items-center gap-1.5 rounded-md border border-orange-200 bg-orange-50 px-2 py-1 text-[11px] font-bold text-orange-900">
                  ⏳ Seguimiento {fila.n} <span className="font-semibold text-orange-700">· {minutosLegibles(fila.minutos)}</span>
                </div>
                {fila.claves.flatMap((clave) => {
                  const s = porClave.get(clave);
                  if (!s) return [];
                  const primera = !yaPuestas.has(clave);
                  yaPuestas.add(clave);
                  return [<div key={`${fila.n}-${clave}`} className="pl-3">{pastilla(s, primera, `${fila.n}-${clave}`)}</div>];
                })}
                {/* EL CAMINO DE COMPRA DE ESTE SEGUIMIENTO (31/10/2026): «lo normal es que del seguimiento 1 y 2
                    aparezca un conector por cada seguimiento… eso parte de la aceptación en el seguimiento». Un
                    dibujo de lo que el bot ya hace: si responde a ESTE seguimiento y paga, va por ahí. No se jala. */}
                {caminos.map((cam) => (
                  <div key={`${fila.n}-${cam.clave}`} className="pl-3">
                    <div
                      className="relative flex items-center gap-1.5 rounded-full border border-emerald-400 bg-emerald-50 px-2 py-0.5 pr-4 text-[11px] font-semibold text-emerald-800"
                      title={`${cam.etiqueta}, después del seguimiento ${fila.n}: va a ${ctx.numeroDe[cam.destino.id] ?? ""} ${cam.destino.titulo?.trim() || ASPECTO[cam.destino.tipo].nombre}.\nSi el cliente responde a este seguimiento y paga, sigue por ahí: mientras salen los seguimientos, el cobro sigue abierto.\nLo hace el bot solo (no se jala ni se corta). Clic derecho en la línea: cable o colita.`}
                    >
                      <span className="truncate">{cam.etiqueta}</span>
                      <span className="ml-auto shrink-0 text-[9px] font-normal opacity-70">al responder</span>
                      <Handle type="source" position={Position.Right} id={`${cam.clave}:${fila.n}`} isConnectable={false} className={`${PUNTO_NARANJA} !bg-emerald-500`} />
                    </div>
                  </div>
                ))}
              </div>
            ));
          })()}
          {visibles.filter((s) => !s.clave.startsWith("btn:") && !s.clave.startsWith("dec:")).map((s) => pastilla(s, true, s.clave))}
        </div>
      )}
      {salidas.length === 0 && (
        <div className="mt-1.5 border-t border-slate-200 px-2 py-1 text-[10px] text-slate-500">🏁 Aquí termina esta ruta</div>
      )}
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
  alElegir: () => void;
  alCambiar: (c: NonNullable<Tablero["cajas"]>[number]) => void;
  /** Borrar la caja (las fichas de encima se quedan). */
  alBorrar: () => void;
  /** LA MANTA DE UN PAÍS (24/10/2026): su bandera de título y «▶ Ver recorrido», como en la pizarra. */
  manta?: { titulo: string; mirando: boolean; alVer: () => void };
};
function NodoDeCaja({ data }: NodeProps<Node<DatosDeCaja>>) {
  const t = TEMA[data.tema];
  const manta = data.manta;
  return (
    <div className="h-full w-full" style={{ pointerEvents: "none" }}>
      {ESQUINAS.map((esquina) => (
        <NodeResizeControl
          key={esquina}
          position={esquina}
          minWidth={160}
          minHeight={100}
          style={{ width: 18, height: 18, border: "none", borderRadius: 4, pointerEvents: "all", background: data.elegida ? t.tituloCaja : "transparent", opacity: 0.8 }}
          onResizeEnd={(_e, r) => data.alCambiar({ ...data.caja, x: Math.round(r.x), y: Math.round(r.y), ancho: Math.round(r.width), alto: Math.round(r.height) })}
        />
      ))}
      <div className="h-full w-full rounded-2xl" style={{ background: t.caja, outline: data.elegida ? `2px solid ${t.tituloCaja}` : "none", pointerEvents: "none" }}>
        <div
          onClick={(e) => {
            e.stopPropagation();
            data.alElegir();
          }}
          onDoubleClick={() => {
            // La manta de un país se llama por su bandera: no se renombra.
            if (manta) return;
            const nuevo = window.prompt("Nombre de la caja", data.caja.titulo);
            if (nuevo !== null) data.alCambiar({ ...data.caja, titulo: nuevo.slice(0, 80) });
          }}
          className={`ml-5 mt-3 inline-block cursor-pointer rounded-md px-1 text-sm font-bold uppercase tracking-wide ${data.elegida ? "underline" : ""}`}
          style={{ color: t.tituloCaja, pointerEvents: "all" }}
          title={
            manta
              ? "La manta de este país · clic para elegirla (Delete la borra; las fichas se quedan) · estírala desde sus esquinas"
              : "Clic para elegirla (Delete la borra) · doble clic para renombrarla · arrástrala desde sus esquinas"
          }
        >
          {manta ? manta.titulo : data.caja.titulo || "Caja"}
        </div>
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
      <BaseEdge id={id} path={corto} interactionWidth={0} style={{ ...style, strokeWidth: 3, strokeDasharray: undefined, opacity: tenue ? 0.4 : 1 }} />
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
        <BaseEdge id={id} path={camino} interactionWidth={0} style={{ ...style, strokeWidth: encima ? 5 : 3 }} />
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

const TIPOS_DE_NODO = { inicio: NodoDeInicio, ficha: NodoDeFicha, caja: NodoDeCaja };
const TIPOS_DE_CABLE = { cable: CableDelTablero, compra: CaminoDeCompra };

/** Quitar fichas con sus cables. Si se va un Inicio, se va también su manta (las fichas se quedan). */
function sinFichas(t: TableroEnElEditor, ids: Set<string>): TableroEnElEditor {
  return {
    ...t,
    fichas: t.fichas.filter((f) => !ids.has(f.id)),
    cables: t.cables.filter((c) => !ids.has(c.de) && !ids.has(c.a)),
    cajas: (t.cajas ?? []).filter((c) => !c.inicio || !ids.has(c.inicio)),
  };
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
let portapapeles: { fichas: FichaEnElEditor[]; cables: CableDelTablero[] } | null = null;

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
  buscar = "",
  antesDelMas,
  despuesDelMas,
  numeros,
  onFichaTocada,
  quienCobra,
  alTocarQuienCobra,
  onPlantillas,
  onGuardarPlantilla,
  enfocar,
}: {
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
  /** `burbuja`: la que se quiere ver al abrir (doble clic sobre ella en la ficha). */
  onAbrir: (id: string, burbuja?: number) => void;
  onAjustes: (id: string) => void;
  /** EL BUSCADOR VIVE ARRIBA, EN LA BARRA, como en la pizarra (24/10/2026). */
  buscar?: string;
  /** LOS BOTONES REDONDOS DE ARRIBA A LA IZQUIERDA, como en la pizarra: ← antes del «+», ☰ después. */
  antesDelMas?: ReactNode;
  despuesDelMas?: ReactNode;
  /** LOS NÚMEROS DE CADA FICHA (25/10/2026), como los de las rutas de la pizarra. */
  numeros?: Record<string, { clientes: number; ventas: number; ahora?: number }>;
}) {
  const instancia = useRef<ReactFlowInstance<Node, Edge> | null>(null);
  const vivo = useRef(tablero);
  vivo.current = tablero;
  const [menu, setMenu] = useState<{ x: number; y: number; m: Menu } | null>(null);
  const [cajaElegida, setCajaElegida] = useState<string | null>(null);
  const [panel, setPanel] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  // «▶ Ver recorrido» (el Inicio cuya ruta se ilumina) y el buscador: solo vista, no cambian nada.
  const [mirando, setMirando] = useState<string | null>(null);
  const [menuMas, setMenuMas] = useState(false);
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
          alElegir: () => setCajaElegida(c.id),
          alCambiar: (n: typeof c) => cambiar({ ...vivo.current, cajas: (vivo.current.cajas ?? []).map((x) => (x.id === c.id ? n : x)) }),
          alBorrar: () => {
            cambiar({ ...vivo.current, cajas: (vivo.current.cajas ?? []).filter((x) => x.id !== c.id) });
            setCajaElegida(null);
          },
          ...(ini
            ? {
                manta: {
                  titulo: ini.pais ? `${banderaDe(ini.pais)} ${ini.pais}` : "🌍 Otros países",
                  mirando: mirando === ini.id,
                  alVer: () => setMirando((m) => (m === ini.id ? null : ini.id)),
                },
              }
            : {}),
        } satisfies DatosDeCaja,
        zIndex: -10,
      });
    }
    for (const f of visibles)
      nodos.push({ id: f.id, type: f.tipo === "inicio" ? "inicio" : "ficha", position: { x: f.x, y: f.y }, data: { ficha: f } });
    return nodos;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tablero, tema, cajaElegida, paisVisto, mirando]);
  const [nodos, setNodos, alCambiarNodos] = useNodesState<Node>(nodosDesdeProps);
  // LO ELEGIDO SIGUE ELEGIDO AL REDIBUJAR (24/10/2026): «al mover se deseleccionan». Cada cambio
  // (soltar lo que se movió, por ejemplo) rehace las fichas desde el tablero, y se rehacían sin
  // elegir. Como en la pizarra, se conserva la elección.
  useEffect(
    () =>
      setNodos((antes) => {
        const elegidos = new Set(antes.filter((n) => n.selected).map((n) => n.id));
        return elegidos.size ? nodosDesdeProps.map((n) => (elegidos.has(n.id) ? { ...n, selected: true } : n)) : nodosDesdeProps;
      }),
    [nodosDesdeProps, setNodos]
  );
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
  const consulta = paraBuscar(buscar.trim());
  const coincidentes = useMemo(() => {
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
        const dentro = (!enLaRuta || enLaRuta.has(n.id)) && (!coincidentes || coincidentes.has(n.id));
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

  // EL MODO INALÁMBRICO (27/10/2026): cada conexión, cable o colita, como él la eligió.
  const [todoCable, setTodoCable] = useState(false);
  const [destacada, setDestacada] = useState<string | null>(null);
  const [verEntrantes, setVerEntrantes] = useState<string | null>(null);
  // AL TIRAR DE NUEVO DESDE UNA SALIDA CON CABLE, el viejo no se ve mientras se tira; si el nuevo no
  // llega a ninguna ficha, vuelve a verse tal cual (no se desconecta nada).
  const [tirando, setTirando] = useState<{ de: string; salida: string } | null>(null);
  // «🔍 QUÉ FALTA CONECTAR»
  const [revisando, setRevisando] = useState(false);
  const faltas = useMemo(() => (revisando ? faltasDelTablero(tablero, paisVisto, nombres) : null), [revisando, tablero, paisVisto, nombres]);
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
  const abrirMenu = useCallback((x: number, y: number, m: Menu) => setMenu({ x, y, m }), []);
  const soltarElCable = useCallback(() => setTirando(null), []);
  const inicioDelTiro = useRef<Punto | null>(null);
  // (27/10/2026: al tirar un cable ya NO se ponen tenues las fichas: «no debería ser así». El cable
  // sigue sin ponerse donde no encaja, con su aviso.)
  const nodosAlTirar = nodosVistos;

  // EL CAMINO «🛒 SI COMPRA» DE CADA CAJA DE SEGUIMIENTOS (31/10/2026): se dibuja solo; no está en
  // `tablero.cables` (no es un cable suyo ni lo lee el bot). Ver `caminosDeCompra`.
  const caminosDeLaCompra = useMemo<Edge[]>(
    () =>
      visibles
        .filter((f) => f.tipo === "seguimientos")
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
        .map((c) => {
          const origen = tablero.fichas.find((f) => f.id === c.de);
          const destino = tablero.fichas.find((f) => f.id === c.a);
          // EL CABLE, SIEMPRE DEL COLOR DE LA SOLAPA DE LA FICHA DE DONDE SALE (27/10/2026).
          const color = origen ? ASPECTO[origen.tipo].trazo : "#6366f1";
          const aSeguimientos = destino?.tipo === "seguimientos";
          const comoColita = esColita(tablero, c, todoCable);
          return {
            id: c.id,
            source: c.de,
            sourceHandle: c.salida,
            target: c.a,
            targetHandle: "entra",
            type: "cable",
            deletable: false,
            ...(comoColita && destino
              ? { data: { etiqueta: letreroDeColita(tablero, c, numeroDe), colorDestino: ASPECTO[destino.tipo].trazo, tenue: !!destino.apagada } }
              : {}),
            // PUNTEADOS, QUIETOS Y SIN FLECHA, como en la pizarra; los de Seguimientos, finos.
            style: {
              stroke: color,
              strokeWidth: aSeguimientos ? 1.5 : 3,
              strokeDasharray: aSeguimientos ? "3 5" : "9 6",
              opacity: origen?.apagada ? 0.4 : 1,
            },
          };
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tablero, todoCable, tirando, numeroDe]
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

  const elegidas = () => nodos.filter((n) => n.selected && (n.type === "ficha" || n.type === "inicio")).map((n) => n.id);

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
        const ids = new Set(elegidas());
        if (ids.size === 0) return;
        portapapeles = {
          fichas: JSON.parse(JSON.stringify(actual.fichas.filter((f) => ids.has(f.id)))),
          cables: actual.cables.filter((c) => ids.has(c.de) && ids.has(c.a)),
        };
        setAviso(`${ids.size} ficha(s) copiada(s). Ctrl+V para pegar.`);
        e.preventDefault();
      } else if ((e.ctrlKey || e.metaKey) && tecla === "v") {
        if (!portapapeles) return;
        const minX = Math.min(...portapapeles.fichas.map((f) => f.x));
        const minY = Math.min(...portapapeles.fichas.map((f) => f.y));
        // A LA DERECHA DE TODO, SIN CAER ENCIMA (25/10/2026): «se están superponiendo sobre elementos
        // existentes, debería estar fuera del área, a la derecha… que mantenga su estructura y
        // cableado». La copia conserva su forma (cada ficha en su sitio relativo) y sus cables de dentro.
        const enElLienzo = actual.fichas.filter((f) => !f.guardada);
        const derecha = enElLienzo.length ? Math.max(...enElLienzo.map((f) => f.x + (f.tipo === "inicio" ? 200 : 250))) + 200 : centroDeLaVista().x;
        const arriba = enElLienzo.length ? Math.min(...enElLienzo.map((f) => f.y)) : centroDeLaVista().y;
        const copia = copiarFichas(portapapeles.fichas, portapapeles.cables, { x: derecha - minX, y: arriba - minY });
        cambiar({ ...actual, fichas: [...actual.fichas, ...copia.fichas], cables: [...actual.cables, ...copia.cables] });
        setAviso(`${copia.fichas.length} ficha(s) pegada(s) a la derecha, con su forma y sus cables de dentro. Quedan sin conectar.`);
        // La vista va hasta ellas.
        const ids = copia.fichas.map((f) => ({ id: f.id }));
        window.setTimeout(() => instancia.current?.fitView({ nodes: ids, padding: 0.25, maxZoom: 1, duration: 500 }), 80);
        // LO PEGADO QUEDA ELEGIDO (28/10/2026: «al pegar se deseleccionan… al arrastrar jaló solo una»):
        // sale el grupo pegado entero, listo para moverlo junto.
        const pegadas = new Set(copia.fichas.map((f) => f.id));
        window.setTimeout(() => setNodos((ns) => ns.map((n) => ({ ...n, selected: pegadas.has(n.id) }))), 120);
        e.preventDefault();
      } else if (tecla === "delete" || tecla === "backspace") {
        if (cajaElegida) {
          cambiar({ ...actual, cajas: (actual.cajas ?? []).filter((x) => x.id !== cajaElegida) });
          setCajaElegida(null);
          e.preventDefault();
          return;
        }
        const ids = new Set(elegidas());
        // Las cajas y mantas elegidas con el recuadro también se borran (las fichas de encima, no).
        const cajasElegidas = new Set(nodos.filter((n) => n.selected && n.type === "caja").map((n) => n.id.slice(5)));
        if (ids.size === 0 && cajasElegidas.size === 0) return;
        // CON CLIENTES DENTRO (27/10/2026): borrar una tubería con gente en sus fichas los deja sin ruta. Para
        // cambiar de tubería (el reenganche), lo correcto es desconectar el cable del Inicio: los que ya
        // estaban terminan su compra y los nuevos entran por la otra.
        const dentro = [...ids].reduce((s, id) => s + (numeros?.[id]?.ahora ?? 0), 0);
        const aviso = dentro
          ? `\n\n⚠ Hay ${dentro} cliente(s) ahora mismo en esas fichas: si las borras se quedan sin ruta (solo les contestará la IA). Para pasar a otra tubería, mejor desconecta el cable del Inicio y deja estas fichas hasta que terminen.`
          : "";
        if (!window.confirm(`¿Eliminar ${ids.size} ficha(s) con sus cables${cajasElegidas.size ? ` y ${cajasElegidas.size} caja(s)` : ""}?${aviso}`)) return;
        const sinEllas = sinFichas(actual, ids);
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

  // EL CONTEXTO, ESTABLE (27/10/2026): antes era un objeto nuevo en cada redibujo y, al arrastrar una
  // ficha, se redibujaban TODAS las fichas en cada movimiento. Ahora solo cambia cuando cambia algo suyo.
  const contexto = useMemo(
    () => ({
      tablero,
      tema,
      paisVisto,
      nombres,
      resumenDe,
      abrir: onAbrir,
      ajustes: onAjustes,
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
    }),
    // (`quienCobra` llega nuevo en cada dibujo del editor: cuenta por su contenido, no por su identidad.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tablero, tema, paisVisto, nombres, resumenDe, onAbrir, onAjustes, numeros, numeroDe, colitas, colitasQueLlegan, fichasConColitas, destacada, verEntrantes, faltasPorFicha, JSON.stringify(quienCobra ?? {})]
  );

  const paisesConInicio = new Set(tablero.fichas.filter((f) => f.tipo === "inicio").map((f) => f.pais ?? ""));
  const guardadas = tablero.fichas.filter((f) => f.guardada);
  const fichaDelMenu = menu?.m.tipo === "ficha" ? tablero.fichas.find((f) => f.id === (menu.m as { fichaId: string }).fichaId) : undefined;

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
                  (!enLaRuta || (enLaRuta.has(c.source) && enLaRuta.has(c.target))) && (!coincidentes || coincidentes.has(c.source) || coincidentes.has(c.target))
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
            const donde = new Map(movidos.filter((n) => !n.id.startsWith("caja:")).map((n) => [n.id, n.position]));
            const cajas = new Map(movidos.filter((n) => n.id.startsWith("caja:")).map((n) => [n.id.slice(5), n.position]));
            cambiar({
              ...actual,
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
            if (!c.source || !c.target || !c.sourceHandle || c.source === c.target) return;
            const actual = vivo.current;
            // NO SE CONECTA DONDE NO DEBE (26/10/2026): el cable no se pone y se dice por qué.
            const motivo = porQueNoSeConecta(actual, c.source, c.sourceHandle, c.target);
            if (motivo) {
              setAviso(motivo);
              return;
            }
            // UNA SALIDA, UN CABLE: tirar otro desde el mismo puntito reemplaza al anterior.
            const lista = actual.cables.filter((x) => !(x.de === c.source && x.salida === c.sourceHandle));
            lista.push({ id: `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`, de: c.source, salida: c.sourceHandle, a: c.target });
            cambiar({ ...actual, cables: lista });
          }}
          onConnectStart={(e, p) => {
            const q = "touches" in e ? e.touches[0] : (e as MouseEvent);
            inicioDelTiro.current = q ? { x: q.clientX, y: q.clientY } : null;
            if (p.nodeId && p.handleId && p.handleType === "source") setTirando({ de: p.nodeId, salida: p.handleId });
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
            setMenu({ x: punto.clientX, y: punto.clientY, m: { tipo: "crear", donde: { x: p.x, y: p.y - 20 }, desde: { ficha: estado.fromNode.id, salida: estado.fromHandle.id } } });
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
          }}
          // TOCAR UNA FICHA DE UN PAÍS CAMBIA LA BANDERA a ese país (27/10/2026).
          onNodeClick={(_, n) => {
            if (n.type === "ficha" || n.type === "inicio") onFichaTocada?.(n.id);
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
          fitView
          fitViewOptions={{ padding: 0.12, maxZoom: 1 }}
          minZoom={0.1}
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
            onClick={(_, p) => instancia.current?.setCenter(p.x, p.y, { zoom: instancia.current.getZoom(), duration: 300 })}
            style={{ cursor: "pointer" }}
          />
          <ZonaDeLaSeleccion />
          <SoltarConEscape tirando={!!tirando} alSoltar={soltarElCable} />
        </ReactFlow>

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
                        setMenuMas(false);
                        const c = centroDeLaVista();
                        const inicio: FichaEnElEditor = { id: `inicio-${p || "otros"}-${Date.now().toString(36)}`, tipo: "inicio", ...(p ? { pais: p } : {}), x: Math.round(c.x - 500), y: Math.round(c.y - 150) };
                        const conInicio = { ...vivo.current, fichas: [...vivo.current.fichas, inicio] };
                        cambiar({ ...conInicio, cajas: [...(conInicio.cajas ?? []), mantaPara(conInicio, inicio)] });
                        setAviso(`${p ? `${banderaDe(p)} ${p}` : "🌍 Otros países"}: su Inicio y su manta. Conecta el Inicio a la primera ficha de su ruta.`);
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
                    setMenuMas(false);
                    const c = centroDeLaVista();
                    const caja = { id: `k-${Date.now().toString(36)}`, x: Math.round(c.x - 300), y: Math.round(c.y - 200), ancho: 600, alto: 400, titulo: "Nueva caja" };
                    cambiar({ ...vivo.current, cajas: [...(vivo.current.cajas ?? []), caja] });
                  }}
                >
                  <span className="h-2.5 w-3.5 rounded-sm border-2 border-dashed border-slate-400" /> Caja libre (solo fondo, sin país)
                </button>
              </div>
              </div>
            )}
          </div>
          {despuesDelMas}
          {/* «🔍 QUÉ FALTA CONECTAR» y «VER TODO COMO CABLE» (27/10/2026) */}
          <button
            type="button"
            onClick={() => setRevisando((v) => !v)}
            title="Marca en rojo las salidas que, sin cable, dejan al cliente sin camino o te dejan sin la venta"
            className={`flex h-9 items-center gap-1 rounded-full border px-3 text-xs font-bold shadow-md ${
              revisando ? "border-red-400 bg-red-50 text-red-800" : "border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
            }`}
          >
            🔍 {revisando ? "Dejar de revisar" : "Qué falta conectar"}
          </button>
          {faltas && (
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold shadow ${faltas.length ? "bg-red-100 text-red-900" : "bg-emerald-100 text-emerald-900"}`}>
              {faltas.length === 0 ? (
                "✅ No falta ninguna conexión"
              ) : (
                <>
                  Faltan {faltas.length} ·{" "}
                  <button
                    type="button"
                    className="underline"
                    title={faltas.map((x) => `${numeroDe[x.ficha] ?? "▶"} · ${x.motivo}`).join("\n")}
                    onClick={() => instancia.current?.fitView({ nodes: [...new Set(faltas.map((x) => x.ficha))].map((id) => ({ id })), padding: 0.3, maxZoom: 1, duration: 500 })}
                  >
                    verlas
                  </button>
                </>
              )}
            </span>
          )}
          <button
            type="button"
            onClick={() => setTodoCable((v) => !v)}
            title="Solo para mirar: muestra todas las conexiones como línea, sin cambiar lo que elegiste en cada una"
            className={`flex h-9 items-center gap-1 rounded-full border px-3 text-xs font-bold shadow-md ${
              todoCable ? "border-sky-400 bg-sky-50 text-sky-800" : "border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
            }`}
          >
            {todoCable ? "📡 Modo inalámbrico" : "〰 Ver todo como cable"}
          </button>
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

        {/* EL MENÚ DEL CLIC DERECHO */}
        {menu && (
          <div
            className="fixed z-50 max-h-[85vh] w-64 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 text-slate-800 shadow-2xl"
            style={{ left: Math.min(menu.x, window.innerWidth - 270), top: Math.max(8, Math.min(menu.y, window.innerHeight - 480)) }}
            onClick={(e) => e.stopPropagation()}
          >
            {menu.m.tipo === "crear" && (
              <>
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
              </>
            )}
            {menu.m.tipo === "ficha" && fichaDelMenu && (
              <>
                {/* El nombre arriba, como en la pizarra: se sabe sobre qué ficha se está. */}
                <div className="truncate border-b border-slate-200 px-3 py-1.5 text-[11px] font-semibold text-slate-500">
                  {fichaDelMenu.tipo === "inicio"
                    ? `▶ Inicio · ${fichaDelMenu.pais ? `${banderaDe(fichaDelMenu.pais)} ${fichaDelMenu.pais}` : "🌍 Otros países"}`
                    : `${ASPECTO[fichaDelMenu.tipo].icono} ${fichaDelMenu.titulo?.trim() || ASPECTO[fichaDelMenu.tipo].nombre}`}
                </div>
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
                  <button type="button" className={opcionDeMenu} onClick={() => (onAbrir(fichaDelMenu.id), setMenu(null))}>
                    ✏️ Abrir
                  </button>
                )}
                <button type="button" className={opcionDeMenu} onClick={() => (onAjustes(fichaDelMenu.id), setMenu(null))}>
                  ⚙ Ajustes de la ficha
                </button>
                {fichaDelMenu.tipo !== "inicio" && (
                  <>
                    <button
                      type="button"
                      className={opcionDeMenu}
                      onClick={() => {
                        const c = copiarFichas([fichaDelMenu], [], { x: 40, y: 260 });
                        cambiar({ ...vivo.current, fichas: [...vivo.current.fichas, ...c.fichas] });
                        setMenu(null);
                      }}
                    >
                      ⧉ Duplicar aquí al lado
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
                                const c = copiarFichas([original], [], { x: m.x + 60 - original.x, y: m.y + Math.max(70, m.alto - 300) - original.y });
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
                        const varias = elegidas().filter((id) => vivo.current.fichas.find((x) => x.id === id)?.tipo !== "inicio");
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
                    if (!window.confirm(esInicio ? "¿Quitar este país? Se van su Inicio y su manta; las fichas se quedan donde están." : "¿Eliminar esta ficha y sus cables?")) return;
                    cambiar(sinFichas(vivo.current, new Set([fichaDelMenu.id])));
                    setMenu(null);
                  }}
                >
                  {fichaDelMenu.tipo === "inicio" ? "🗑 Quitar país (las fichas se quedan)" : "🗑 Eliminar"}
                </button>
              </>
            )}
            {menu.m.tipo === "conectar" &&
              (() => {
                const m = menu.m as Extract<Menu, { tipo: "conectar" }>;
                const origen = tablero.fichas.find((f) => f.id === m.ficha);
                const salida = origen ? salidasDeLaFicha(origen as FichaDelTablero, paisVisto, nombres).find((s) => s.clave === m.salida) : undefined;
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
                          lista.push({ id: `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`, de: m.ficha, salida: m.salida, a: f.id });
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
