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
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
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
  Panel,
  Position,
  ReactFlow,
  useNodesState,
  useStore,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { avisosDeLaFicha, salidasDeLaFicha } from "@/lib/tablero/datos";
import type { CableDelTablero, FichaDelTablero, Tablero, TipoDeFicha } from "@/lib/tablero/tipos";
import { banderaDe } from "@/components/pizarra/banderas";
import { ASPECTO, TIPOS_PARA_CREAR } from "./aspecto";

/** El tablero tal como lo tiene el editor: igual que el del bot, con las burbujas del editor. */
export interface FichaEnElEditor extends Omit<FichaDelTablero, "steps" | "variantes" | "seguimientos"> {
  steps?: unknown[];
  variantes?: Array<{ id: string; nombre?: string; peso?: number; steps?: unknown[] }>;
  seguimientos?: Array<{ id: string; minutos: number; activa_oferta?: boolean; variantes: Array<{ id: string; nombre?: string; peso?: number; steps?: unknown[] }> }>;
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
function resumenDeBurbujas(pasos: unknown[] | undefined): Array<{ icono: string; texto: string; espera: number }> {
  return ((pasos ?? []) as BurbujaDelEditor[])
    .filter((s) => s?.enabled !== false)
    .map((s) => ({
      icono: ICONO[s.type ?? "text"] ?? "💬",
      texto: (s.texts ?? []).find((t) => t?.trim())?.trim() ?? "",
      espera: Number(s.delay_after_sec ?? 0) || 0,
    }));
}

/** Copia de fichas con códigos NUEVOS (fichas, botones y cuadritos), y sus cables de dentro. */
export function copiarFichas(
  fichas: FichaEnElEditor[],
  cables: CableDelTablero[],
  desplazar: Punto
): { fichas: FichaEnElEditor[]; cables: CableDelTablero[] } {
  const nuevo = (p: string) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const idDe = new Map<string, string>();
  const salidaDe = new Map<string, string>();
  const renombrarPasos = (pasos: unknown[] | undefined) =>
    (pasos ?? []).map((s) => {
      const p = JSON.parse(JSON.stringify(s)) as { buttons?: Array<{ id: string }>; decisions?: Array<{ id: string }> };
      for (const b of p.buttons ?? []) {
        const n = nuevo("b");
        salidaDe.set(`btn:${b.id}`, `btn:${n}`);
        b.id = n;
      }
      for (const d of p.decisions ?? []) {
        const n = nuevo("d");
        salidaDe.set(`dec:${d.id}`, `dec:${n}`);
        d.id = n;
      }
      return p;
    });
  // Un Inicio no se copia: hay uno por país, y dos del mismo país no sabrían a quién recibir.
  const copias = fichas.filter((f) => f.tipo !== "inicio").map((f) => {
    const id = nuevo("f");
    idDe.set(f.id, id);
    const c: FichaEnElEditor = { ...JSON.parse(JSON.stringify(f)), id, x: f.x + desplazar.x, y: f.y + desplazar.y };
    if (c.steps) c.steps = renombrarPasos(c.steps);
    if (c.variantes) c.variantes = c.variantes.map((v) => ({ ...v, id: nuevo("v"), steps: renombrarPasos(v.steps) }));
    if (c.seguimientos)
      c.seguimientos = c.seguimientos.map((s) => ({
        ...s,
        id: nuevo("s"),
        variantes: s.variantes.map((v) => ({ ...v, id: nuevo("v"), steps: renombrarPasos(v.steps) })),
      }));
    return c;
  });
  const copiasDeCables = cables
    .filter((c) => idDe.has(c.de) && idDe.has(c.a))
    .map((c) => ({ id: nuevo("c"), de: idDe.get(c.de)!, a: idDe.get(c.a)!, salida: salidaDe.get(c.salida) ?? c.salida }));
  return { fichas: copias, cables: copiasDeCables };
}

// ── EL CONTEXTO: lo que los nodos y cables le piden al lienzo ─────────────────

type Menu =
  | { tipo: "ficha"; fichaId: string }
  | { tipo: "cable"; cableId: string }
  | { tipo: "crear"; donde: Punto; desde?: { ficha: string; salida: string } }
  | { tipo: "caja"; cajaId: string };

const Contexto = createContext<{
  tablero: TableroEnElEditor;
  tema: "claro" | "oscuro";
  paisVisto: string;
  nombres: Record<string, string>;
  resumenDe: (f: FichaEnElEditor) => string;
  abrir: (id: string) => void;
  ajustes: (id: string) => void;
  menu: (x: number, y: number, m: Menu) => void;
  cambiar: (t: TableroEnElEditor) => void;
  curvar: (cableId: string, p: Punto | null) => void;
} | null>(null);

// ── EL INICIO DE UN PAÍS ──────────────────────────────────────────────────────

function NodoDeInicio({ data }: NodeProps<Node<{ ficha: FichaEnElEditor }>>) {
  const ctx = useContext(Contexto);
  const f = data.ficha;
  const conectado = !!ctx?.tablero.cables.some((c) => c.de === f.id && c.salida === "siguiente");
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
      className={`w-[200px] rounded-xl border-2 bg-white text-slate-800 shadow-lg ${color.borde}`}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        ctx?.menu(e.clientX, e.clientY, { tipo: "ficha", fichaId: f.id });
      }}
      title={conectado ? undefined : "Desconectado: arrastra el punto naranja hasta la primera ficha de esta ruta."}
    >
      <div className={`rounded-t-[10px] px-3 py-2 text-white ${color.banda}`}>
        <div className="text-sm font-bold">▶ Inicio</div>
        <div className="text-[11px] opacity-90">
          {!conectado ? "Desconectado" : estado === "revision" ? "En revisión · no recibe" : estado === "apagado" ? "Apagado · venta automática" : "El cliente escribe"}
        </div>
      </div>
      <div className="flex flex-col gap-1.5 p-2">
        <div className="relative rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs font-semibold text-slate-800">
          {etiqueta}
          <Handle type="source" position={Position.Right} id="siguiente" className={PUNTO_NARANJA} />
        </div>
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
  const burbujas =
    f.tipo === "mensaje" || f.tipo === "cobro"
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
        selected ? "ring-4 ring-sky-400" : ""
      }`}
    >
      <Handle type="target" position={Position.Left} id="entra" className={PUNTO_VERDE} style={{ top: 18 }} />
      {!leLlega && (
        <span
          className="pointer-events-auto absolute -left-[32px] top-[9px] h-[18px] w-[18px] rounded-full bg-red-600 ring-2 ring-white"
          title="No le llega ningún cable: nadie entra por aquí."
        />
      )}
      <div className={`flex cursor-pointer items-center gap-2 rounded-t-[6px] ${a.color} px-2 py-1.5 text-white`} title="Doble clic para abrirla">
        {avisos.length > 0 && (
          <span
            title={avisos.join("\n")}
            className="shrink-0 cursor-help rounded bg-amber-400 px-1 text-xs font-bold text-amber-950"
            onDoubleClick={(e) => e.stopPropagation()}
          >
            ⚠
          </span>
        )}
        <span className="shrink-0 text-xs">{a.icono}</span>
        <span className="truncate text-xs font-bold">{f.titulo?.trim() || a.nombre}</span>
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
            <div className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-1 text-[11px]">
              <span className="shrink-0">{b.icono}</span>
              <span className="truncate">{b.texto || "(sin texto)"}</span>
            </div>
            {b.espera > 0 && i < burbujas.length - 1 && <div className="pl-2 pt-0.5 text-[10px] text-slate-500">⏱ {b.espera} s</div>}
          </div>
        ))}
        {burbujas.length > BURBUJAS_A_LA_VISTA && (
          <div className="text-[10px] font-semibold text-slate-500">+ {burbujas.length - BURBUJAS_A_LA_VISTA} burbuja(s) más</div>
        )}
        {(burbujas.length === 0 || (f.tipo !== "mensaje" && f.tipo !== "intro_ob")) && (
          <div className={`whitespace-pre-line text-[11px] ${burbujas.length === 0 ? "italic" : ""} text-slate-600`}>{ctx.resumenDe(f)}</div>
        )}
      </div>
      {salidas.length > 0 && (
        <div className="mt-1.5 flex flex-col gap-1 border-t border-slate-200 px-2 py-1.5">
          {salidas.map((s) => {
            const boton = s.clave.startsWith("btn:");
            const cuadrito = s.clave.startsWith("dec:");
            const pide = (boton || cuadrito) && !conCable.has(s.clave);
            return (
              <div
                key={s.clave}
                className={`relative flex items-center gap-1.5 rounded-full border px-2 py-0.5 pr-4 text-[11px] font-semibold ${
                  boton
                    ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                    : cuadrito
                      ? "border-indigo-300 bg-indigo-50 text-indigo-800"
                      : "border-slate-200 bg-slate-50 text-slate-700"
                }`}
              >
                {(boton || cuadrito) && <span className="text-[9px] opacity-70">{boton ? "BOTÓN" : "SI DICE"}</span>}
                <span className="truncate">{s.etiqueta.replace(/^(🔘|💬) /, "")}</span>
                <Handle
                  type="source"
                  position={Position.Right}
                  id={s.clave}
                  className={`${PUNTO_NARANJA} ${pide ? "punto-pide-cable" : ""}`}
                  title={pide ? "Sin cable: tíralo a donde lleva" : undefined}
                />
              </div>
            );
          })}
        </div>
      )}
      {salidas.length === 0 && (
        <div className="mt-1.5 border-t border-slate-200 px-2 py-1 text-[10px] text-slate-500">🏁 Aquí termina esta ruta</div>
      )}
    </div>
  );
}

// ── EL FONDO DE UN PAÍS Y LAS CAJAS ───────────────────────────────────────────

function NodoDeFondo({ data }: NodeProps<Node<{ titulo: string; tema: "claro" | "oscuro"; mirando: boolean; alVer: () => void }>>) {
  const t = TEMA[data.tema];
  return (
    <div className="h-full w-full rounded-2xl" style={{ background: t.caja, pointerEvents: "none" }}>
      <div className="ml-5 mt-3 flex items-center gap-2">
        <span className="rounded-md px-1 text-sm font-bold uppercase tracking-wide" style={{ color: t.tituloCaja }}>
          {data.titulo}
        </span>
        {/* «▶ VER RECORRIDO», como en la pizarra: su ruta se ilumina y lo demás queda tenue. */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            data.alVer();
          }}
          className={`nodrag nopan rounded-md border px-2 py-0.5 text-[11px] font-semibold shadow-sm ${
            data.mirando ? "border-amber-400 bg-amber-100 text-amber-900" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
          }`}
          style={{ pointerEvents: "all" }}
          title="Ilumina la ruta de este país (solo vista: no cambia nada)"
        >
          {data.mirando ? "✕ Ver todo" : "▶ Ver recorrido"}
        </button>
      </div>
    </div>
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
};
function NodoDeCaja({ data }: NodeProps<Node<DatosDeCaja>>) {
  const t = TEMA[data.tema];
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
            const nuevo = window.prompt("Nombre de la caja", data.caja.titulo);
            if (nuevo !== null) data.alCambiar({ ...data.caja, titulo: nuevo.slice(0, 80) });
          }}
          className={`ml-5 mt-3 inline-block cursor-pointer rounded-md px-1 text-sm font-bold uppercase tracking-wide ${data.elegida ? "underline" : ""}`}
          style={{ color: t.tituloCaja, pointerEvents: "all" }}
          title="Clic para elegirla (Delete la borra) · doble clic para renombrarla · arrástrala desde sus esquinas"
        >
          {data.caja.titulo || "Caja"}
        </div>
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

function CableDelTablero({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style }: EdgeProps) {
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

const TIPOS_DE_NODO = { inicio: NodoDeInicio, ficha: NodoDeFicha, fondo: NodoDeFondo, caja: NodoDeCaja };
const TIPOS_DE_CABLE = { cable: CableDelTablero };

/** Las fichas a las que llega un Inicio siguiendo sus cables: su ruta, para dibujarle su fondo. */
function rutaDe(t: TableroEnElEditor, inicioId: string): Set<string> {
  const vistas = new Set<string>([inicioId]);
  const cola = [inicioId];
  while (cola.length) {
    const id = cola.shift()!;
    for (const c of t.cables)
      if (c.de === id && !vistas.has(c.a)) {
        vistas.add(c.a);
        cola.push(c.a);
      }
  }
  return vistas;
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
}: {
  tablero: TableroEnElEditor;
  resumenDe: (f: FichaEnElEditor) => string;
  paisVisto: string;
  /** El fondo: claro, u oscuro (en «mixto» y «oscuro»). Las fichas siguen blancas, como en la pizarra. */
  tema: "claro" | "oscuro";
  /** Los nombres de los productos, para las salidas del cobro. */
  nombres: Record<string, string>;
  paisesDisponibles: string[];
  onCambiar: (t: TableroEnElEditor) => void;
  onAbrir: (id: string) => void;
  onAjustes: (id: string) => void;
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
  const [buscar, setBuscar] = useState("");
  const t = TEMA[tema];

  const cambiar = (n: TableroEnElEditor) => onCambiar(n);
  const curvar = (cableId: string, p: Punto | null) => {
    const actual = { ...(vivo.current.curvas ?? {}) };
    if (p) actual[cableId] = { x: Math.round(p.x), y: Math.round(p.y) };
    else delete actual[cableId];
    cambiar({ ...vivo.current, curvas: actual });
  };

  const visibles = tablero.fichas.filter((f) => !f.guardada);
  const nodosDesdeProps = useMemo<Node[]>(() => {
    const nodos: Node[] = [];
    // EL FONDO DE CADA PAÍS: la caja semitransparente detrás de su ruta, como los carriles de la
    // pizarra. Se calcula de las fichas a las que llega su Inicio.
    for (const inicio of visibles.filter((f) => f.tipo === "inicio")) {
      const ids = rutaDe(tablero, inicio.id);
      const suyas = visibles.filter((f) => ids.has(f.id));
      if (suyas.length === 0) continue;
      const minX = Math.min(...suyas.map((f) => f.x)) - 40;
      const minY = Math.min(...suyas.map((f) => f.y)) - 70;
      const maxX = Math.max(...suyas.map((f) => f.x + (f.tipo === "inicio" ? 200 : 250))) + 40;
      const maxY = Math.max(...suyas.map((f) => f.y + 260)) + 30;
      nodos.push({
        id: `fondo:${inicio.id}`,
        type: "fondo",
        position: { x: minX, y: minY },
        style: { width: maxX - minX, height: maxY - minY },
        data: {
          titulo: inicio.pais ? `${banderaDe(inicio.pais)} ${inicio.pais}` : "🌍 Otros países",
          tema,
          mirando: mirando === inicio.id,
          alVer: () => setMirando((m) => (m === inicio.id ? null : inicio.id)),
        },
        draggable: false,
        selectable: false,
        zIndex: -2,
      });
    }
    for (const c of tablero.cajas ?? [])
      nodos.push({
        id: `caja:${c.id}`,
        type: "caja",
        position: { x: c.x, y: c.y },
        style: { width: c.ancho, height: c.alto },
        data: {
          caja: c,
          tema,
          elegida: cajaElegida === c.id,
          alElegir: () => setCajaElegida(c.id),
          alCambiar: (n: typeof c) => cambiar({ ...vivo.current, cajas: (vivo.current.cajas ?? []).map((x) => (x.id === c.id ? n : x)) }),
        } satisfies DatosDeCaja,
        zIndex: -1,
        dragHandle: ".no-se-arrastra",
      });
    for (const f of visibles)
      nodos.push({ id: f.id, type: f.tipo === "inicio" ? "inicio" : "ficha", position: { x: f.x, y: f.y }, data: { ficha: f } });
    return nodos;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tablero, tema, cajaElegida, paisVisto, mirando]);
  const [nodos, setNodos, alCambiarNodos] = useNodesState<Node>(nodosDesdeProps);
  useEffect(() => setNodos(nodosDesdeProps), [nodosDesdeProps, setNodos]);

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
        if (n.type === "caja") return n;
        if (n.type === "fondo") return enLaRuta && n.id !== `fondo:${mirando}` ? { ...n, style: { ...n.style, opacity: 0.3 } } : n;
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

  const cables = useMemo<Edge[]>(
    () =>
      tablero.cables
        .filter((c) => visibles.some((f) => f.id === c.de) && visibles.some((f) => f.id === c.a))
        .map((c) => {
          const origen = tablero.fichas.find((f) => f.id === c.de);
          const color = origen ? ASPECTO[origen.tipo].trazo : "#6366f1";
          return {
            id: c.id,
            source: c.de,
            sourceHandle: c.salida,
            target: c.a,
            targetHandle: "entra",
            type: "cable",
            deletable: false,
            // PUNTEADOS, QUIETOS Y SIN FLECHA, como en la pizarra.
            style: { stroke: color, strokeWidth: 3, strokeDasharray: "9 6", opacity: origen?.apagada ? 0.4 : 1 },
          };
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tablero]
  );

  const crearFicha = (tipo: TipoDeFicha, donde: Punto, desde?: { ficha: string; salida: string }) => {
    const id = `f-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const nueva: FichaEnElEditor = {
      id,
      tipo,
      x: Math.round(donde.x),
      y: Math.round(donde.y),
      ...(tipo === "cobro" ? { cobro: { modo: "abierto" as const } } : {}),
      ...(tipo === "condicion" ? { condicion: { tipo: "compro" as const } } : {}),
      ...(tipo === "esperar" ? { minutos: 60 } : {}),
      ...(tipo === "reparto" ? { reparto: [{ id: "r1", peso: 1 }, { id: "r2", peso: 1 }] } : {}),
      ...(tipo === "intro_ob" ? { variantes: [{ id: `v-${Date.now().toString(36)}`, peso: 1, steps: [] }] } : {}),
      ...(tipo === "seguimientos"
        ? { seguimientos: [{ id: `s-${Date.now().toString(36)}`, minutos: 180, variantes: [{ id: `v-${Date.now().toString(36)}`, peso: 1, steps: [] }] }] }
        : {}),
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
      const tecla = e.key.toLowerCase();
      const actual = vivo.current;
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
        const c = centroDeLaVista();
        const copia = copiarFichas(portapapeles.fichas, portapapeles.cables, { x: c.x - minX, y: c.y - minY });
        cambiar({ ...actual, fichas: [...actual.fichas, ...copia.fichas], cables: [...actual.cables, ...copia.cables] });
        setAviso(`${copia.fichas.length} ficha(s) pegada(s), con sus cables de dentro. Quedan sin conectar.`);
        e.preventDefault();
      } else if (tecla === "delete" || tecla === "backspace") {
        if (cajaElegida) {
          cambiar({ ...actual, cajas: (actual.cajas ?? []).filter((x) => x.id !== cajaElegida) });
          setCajaElegida(null);
          e.preventDefault();
          return;
        }
        const ids = new Set(elegidas());
        if (ids.size === 0) return;
        if (!window.confirm(`¿Eliminar ${ids.size} ficha(s) y sus cables?`)) return;
        cambiar({
          ...actual,
          fichas: actual.fichas.filter((f) => !ids.has(f.id)),
          cables: actual.cables.filter((c) => !ids.has(c.de) && !ids.has(c.a)),
        });
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

  const paisesConInicio = new Set(tablero.fichas.filter((f) => f.tipo === "inicio").map((f) => f.pais ?? ""));
  const guardadas = tablero.fichas.filter((f) => f.guardada);
  const fichaDelMenu = menu?.m.tipo === "ficha" ? tablero.fichas.find((f) => f.id === (menu.m as { fichaId: string }).fichaId) : undefined;

  const opcionDeMenu = "block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-100";

  return (
    <Contexto.Provider
      value={{
        tablero,
        tema,
        paisVisto,
        nombres,
        resumenDe,
        abrir: onAbrir,
        ajustes: onAjustes,
        menu: (x, y, m) => setMenu({ x, y, m }),
        cambiar,
        curvar,
      }}
    >
      <div className="relative h-full w-full" style={{ background: t.fondo }} onClick={() => setMenu(null)}>
        <ReactFlow
          nodes={nodosVistos}
          edges={
            enLaRuta || coincidentes
              ? cables.map((c) =>
                  (!enLaRuta || (enLaRuta.has(c.source) && enLaRuta.has(c.target))) && (!coincidentes || coincidentes.has(c.source) || coincidentes.has(c.target))
                    ? c
                    : { ...c, style: { ...c.style, opacity: 0.12 } }
                )
              : cables
          }
          nodeTypes={TIPOS_DE_NODO}
          edgeTypes={TIPOS_DE_CABLE}
          onInit={(i) => {
            instancia.current = i;
          }}
          onNodesChange={alCambiarNodos}
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
            // UNA SALIDA, UN CABLE: tirar otro desde el mismo puntito reemplaza al anterior.
            const lista = actual.cables.filter((x) => !(x.de === c.source && x.salida === c.sourceHandle));
            lista.push({ id: `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`, de: c.source, salida: c.sourceHandle, a: c.target });
            cambiar({ ...actual, cables: lista });
          }}
          // SOLTAR EL CABLE EN EL VACÍO: se ofrece crear ahí una ficha ya conectada.
          onConnectEnd={(evento, estado) => {
            if (estado.isValid || !estado.fromNode || !estado.fromHandle?.id) return;
            const punto = "changedTouches" in evento ? evento.changedTouches[0] : (evento as MouseEvent);
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
          }}
          connectionLineStyle={{ stroke: "#f97316", strokeWidth: 2.5, strokeDasharray: "6 6" }}
          deleteKeyCode={null}
          // El doble clic abre la ficha; no acerca el lienzo (se comía el doble clic de las cajas).
          zoomOnDoubleClick={false}
          selectionKeyCode="Shift"
          multiSelectionKeyCode={["Control", "Meta"]}
          fitView
          fitViewOptions={{ padding: 0.12, maxZoom: 1 }}
          minZoom={0.1}
          proOptions={{ hideAttribution: true }}
          style={{ background: "transparent" }}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.6} color={t.puntos} />
          <Controls showInteractive={false} />
          <MiniMap pannable={false} zoomable={false} nodeStrokeWidth={3} style={{ pointerEvents: "none" }} />
          <Panel position="top-left">
            <div className="flex flex-wrap items-center gap-1 rounded-xl border border-slate-200 bg-white/95 p-1.5 text-slate-800 shadow-md">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  setMenu({ x: r.left, y: r.bottom + 4, m: { tipo: "crear", donde: centroDeLaVista() } });
                }}
                className="rounded-lg bg-emerald-600 px-2.5 py-1 text-[12px] font-bold text-white hover:bg-emerald-700"
              >
                ＋ Ficha
              </button>
              <select
                value=""
                onChange={(e) => {
                  const p = e.target.value;
                  if (!p) return;
                  const c = centroDeLaVista();
                  const id = `inicio-${p}-${Date.now().toString(36)}`;
                  cambiar({ ...vivo.current, fichas: [...vivo.current.fichas, { id, tipo: "inicio", pais: p, x: Math.round(c.x - 400), y: Math.round(c.y) }] });
                  setAviso(`Inicio de ${p} agregado: conéctalo a la primera ficha de su ruta.`);
                }}
                className="rounded-lg border border-slate-200 px-1.5 py-1 text-[12px] font-semibold"
                title="Un Inicio por país, como los carriles de la pizarra"
              >
                <option value="">＋ País</option>
                {paisesDisponibles
                  .filter((p) => !paisesConInicio.has(p))
                  .map((p) => (
                    <option key={p} value={p}>
                      {banderaDe(p)} {p}
                    </option>
                  ))}
              </select>
              <button
                type="button"
                onClick={() => {
                  const c = centroDeLaVista();
                  const caja = { id: `k-${Date.now().toString(36)}`, x: Math.round(c.x - 300), y: Math.round(c.y - 200), ancho: 600, alto: 400, titulo: "Nueva caja" };
                  cambiar({ ...vivo.current, cajas: [...(vivo.current.cajas ?? []), caja] });
                }}
                className="rounded-lg px-2 py-1 text-[12px] font-semibold hover:bg-slate-100"
                title="Una caja detrás de las fichas, para ordenar a la vista (el bot no la lee)"
              >
                ▭ Caja
              </button>
              <span className="mx-1 h-5 w-px bg-slate-200" />
              {/* EL BUSCADOR, como en la pizarra: las que coinciden se marcan y lo demás queda tenue. */}
              <input
                value={buscar}
                onChange={(e) => setBuscar(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setBuscar("");
                  if (e.key === "Enter" && coincidentes && coincidentes.size > 0)
                    instancia.current?.fitView({ nodes: [...coincidentes].map((id) => ({ id })), padding: 0.3, maxZoom: 1, duration: 500 });
                }}
                placeholder="🔍 Buscar"
                className="w-36 rounded-lg border border-slate-200 px-2 py-1 text-[12px]"
                title="Busca en los títulos y en lo que dicen las burbujas · Enter: ir a ellas · Esc: borrar"
              />
              {coincidentes && (
                <span className="px-1 text-[11px] font-semibold text-amber-700">
                  {coincidentes.size === 0 ? "ninguna" : `${coincidentes.size} ficha(s)`}
                </span>
              )}
              <span className="mx-1 h-5 w-px bg-slate-200" />
              <span className="px-1 text-[11px] text-slate-500">Shift + arrastrar: elegir varias · Ctrl+C / Ctrl+V · Delete</span>
            </div>
          </Panel>
        </ReactFlow>

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
            className="fixed z-50 w-60 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 text-slate-800 shadow-2xl"
            style={{ left: Math.min(menu.x, window.innerWidth - 250), top: Math.min(menu.y, window.innerHeight - 380) }}
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
                  </>
                )}
                <button
                  type="button"
                  className={`${opcionDeMenu} text-rose-600`}
                  onClick={() => {
                    if (!window.confirm("¿Eliminar esta ficha y sus cables?")) return;
                    cambiar({
                      ...vivo.current,
                      fichas: vivo.current.fichas.filter((x) => x.id !== fichaDelMenu.id),
                      cables: vivo.current.cables.filter((c) => c.de !== fichaDelMenu.id && c.a !== fichaDelMenu.id),
                    });
                    setMenu(null);
                  }}
                >
                  🗑 Eliminar
                </button>
              </>
            )}
            {menu.m.tipo === "cable" && (
              <>
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
