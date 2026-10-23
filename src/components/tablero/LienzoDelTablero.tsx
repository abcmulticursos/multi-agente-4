"use client";

/**
 * EL LIENZO DEL TABLERO — fichas y cables que el bot SÍ sigue (22/10/2026, solo ALBERTO 4).
 *
 * Se maneja como la pizarra: arrastrar fichas, tirar cables del punto naranja (una salida) al
 * verde (la entrada de otra ficha), doble clic para abrir la ficha, ✕ en el cable para cortarlo.
 * Cada salida es UN puntito; si él no le tira cable, esa salida no hace nada.
 *
 * Este archivo no guarda nada: cada cambio se lo pide al editor por `onCambiar`, que escribe en
 * el mismo borrador que los menús (Ctrl+S guarda, Ctrl+Z deshace).
 */
import { useEffect, useMemo, useRef } from "react";
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  getBezierPath,
  Handle,
  Panel,
  Position,
  ReactFlow,
  useNodesState,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { salidasDeLaFicha } from "@/lib/tablero/datos";
import type { CableDelTablero, FichaDelTablero, TipoDeFicha } from "@/lib/tablero/tipos";
import { ASPECTO } from "./aspecto";

/** El tablero tal como lo tiene el editor: igual que el del bot, con las burbujas del editor. */
export interface FichaEnElEditor extends Omit<FichaDelTablero, "steps"> {
  steps?: unknown[];
}
export interface TableroEnElEditor {
  encendido: boolean;
  fichas: FichaEnElEditor[];
  cables: CableDelTablero[];
}


const PUNTO_VERDE = "!h-[16px] !w-[16px] !border-2 !border-white !bg-emerald-500";
const PUNTO_NARANJA = "!h-[16px] !w-[16px] !border-2 !border-white !bg-orange-500";

interface DatosDelNodo extends Record<string, unknown> {
  ficha: FichaEnElEditor;
  resumen: string;
  paisVisto?: string;
  onAbrir: (id: string) => void;
  onAjustes: (id: string) => void;
  onBorrar: (id: string) => void;
}

function NodoDeFicha({ data, selected }: NodeProps<Node<DatosDelNodo>>) {
  const { ficha, resumen, paisVisto, onAbrir, onAjustes, onBorrar } = data;
  const a = ASPECTO[ficha.tipo];
  const salidas = salidasDeLaFicha(ficha as FichaDelTablero, paisVisto);
  return (
    <div
      onDoubleClick={() => onAbrir(ficha.id)}
      className={`w-[250px] rounded-xl border bg-white text-slate-800 shadow-md ${selected ? "border-orange-500 ring-2 ring-orange-300" : "border-slate-200"}`}
      style={{ fontFamily: "var(--fuente-prolija, inherit)" }}
    >
      {ficha.tipo !== "inicio" && (
        <Handle type="target" position={Position.Left} id="entra" className={PUNTO_VERDE} style={{ top: 22 }} />
      )}
      <div className={`flex items-center gap-2 rounded-t-xl px-3 py-1.5 text-white ${a.color}`}>
        <span>{a.icono}</span>
        <span className="min-w-0 flex-1 truncate text-[12px] font-bold">{ficha.titulo?.trim() || a.nombre}</span>
        <button
          type="button"
          title="Ajustes de la ficha"
          onClick={(e) => {
            e.stopPropagation();
            onAjustes(ficha.id);
          }}
          className="nodrag rounded px-1 text-[12px] hover:bg-white/20"
        >
          ⚙
        </button>
        {ficha.tipo !== "inicio" && (
          <button
            type="button"
            title="Eliminar la ficha"
            onClick={(e) => {
              e.stopPropagation();
              onBorrar(ficha.id);
            }}
            className="nodrag rounded px-1 text-[12px] hover:bg-white/20"
          >
            🗑
          </button>
        )}
      </div>
      {resumen && <div className="whitespace-pre-line px-3 py-2 text-[11px] leading-snug text-slate-600">{resumen}</div>}
      {salidas.length > 0 && (
        <div className="border-t border-slate-100 py-1">
          {salidas.map((s) => (
            <div key={s.clave} className="relative flex items-center justify-end py-1 pl-3 pr-4 text-[11px] font-semibold text-slate-700">
              <span className="truncate">{s.etiqueta}</span>
              <Handle type="source" position={Position.Right} id={s.clave} className={PUNTO_NARANJA} />
            </div>
          ))}
        </div>
      )}
      {salidas.length === 0 && ficha.tipo !== "inicio" && (
        <div className="border-t border-slate-100 px-3 py-1.5 text-[10px] text-slate-500">🏁 Aquí termina esta ruta</div>
      )}
    </div>
  );
}

function CableConCorte(props: EdgeProps) {
  const [camino, x, y] = getBezierPath(props);
  const cortar = (props.data as { cortar?: (id: string) => void } | undefined)?.cortar;
  return (
    <>
      <BaseEdge path={camino} markerEnd={props.markerEnd} style={{ stroke: "#f97316", strokeWidth: 2.5 }} />
      <EdgeLabelRenderer>
        <button
          type="button"
          title="Cortar este cable"
          onClick={() => cortar?.(props.id)}
          className="nodrag nopan absolute flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 bg-white text-[10px] text-slate-600 shadow hover:bg-rose-50 hover:text-rose-600"
          style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y}px)`, pointerEvents: "all" }}
        >
          ✕
        </button>
      </EdgeLabelRenderer>
    </>
  );
}

const TIPOS_DE_NODO = { ficha: NodoDeFicha };
const TIPOS_DE_CABLE = { cable: CableConCorte };

const NUEVAS: TipoDeFicha[] = ["mensaje", "cobro", "entregar", "condicion", "esperar", "regalo", "humano"];

export default function LienzoDelTablero({
  tablero,
  resumenDe,
  paisVisto,
  oscuro,
  onCambiar,
  onAbrir,
  onAjustes,
}: {
  tablero: TableroEnElEditor;
  resumenDe: (f: FichaEnElEditor) => string;
  paisVisto?: string;
  oscuro?: boolean;
  onCambiar: (t: TableroEnElEditor) => void;
  onAbrir: (id: string) => void;
  onAjustes: (id: string) => void;
}) {
  const instancia = useRef<ReactFlowInstance<Node<DatosDelNodo>, Edge> | null>(null);
  const vivo = useRef(tablero);
  vivo.current = tablero;

  const borrar = (id: string) => {
    const t = vivo.current;
    const f = t.fichas.find((x) => x.id === id);
    if (!f || f.tipo === "inicio") return;
    if (!window.confirm(`¿Eliminar la ficha «${f.titulo?.trim() || ASPECTO[f.tipo].nombre}» y sus cables?`)) return;
    onCambiar({
      ...t,
      fichas: t.fichas.filter((x) => x.id !== id),
      cables: t.cables.filter((c) => c.de !== id && c.a !== id),
    });
  };
  const cortar = (cableId: string) => {
    const t = vivo.current;
    onCambiar({ ...t, cables: t.cables.filter((c) => c.id !== cableId) });
  };

  const nodosDesdeProps = useMemo<Node<DatosDelNodo>[]>(
    () =>
      tablero.fichas.map((f) => ({
        id: f.id,
        type: "ficha",
        position: { x: f.x, y: f.y },
        data: { ficha: f, resumen: resumenDe(f), paisVisto, onAbrir, onAjustes, onBorrar: borrar },
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tablero, paisVisto]
  );
  const [nodos, setNodos, alCambiarNodos] = useNodesState<Node<DatosDelNodo>>(nodosDesdeProps);
  useEffect(() => setNodos(nodosDesdeProps), [nodosDesdeProps, setNodos]);

  const cables = useMemo<Edge[]>(
    () =>
      tablero.cables.map((c) => ({
        id: c.id,
        source: c.de,
        sourceHandle: c.salida,
        target: c.a,
        targetHandle: "entra",
        type: "cable",
        data: { cortar },
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tablero]
  );

  const agregar = (tipo: TipoDeFicha) => {
    const t = vivo.current;
    const centro = instancia.current?.screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    }) ?? { x: 200, y: 200 };
    const id = `f-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const nueva: FichaEnElEditor = {
      id,
      tipo,
      x: Math.round(centro.x - 125 + (t.fichas.length % 5) * 18),
      y: Math.round(centro.y - 60 + (t.fichas.length % 5) * 18),
      ...(tipo === "cobro" ? { cobro: { modo: "abierto" as const } } : {}),
      ...(tipo === "condicion" ? { condicion: { tipo: "compro" as const } } : {}),
      ...(tipo === "esperar" ? { minutos: 60 } : {}),
    };
    onCambiar({ ...t, fichas: [...t.fichas, nueva] });
  };

  return (
    <div className={`h-full w-full ${oscuro ? "bg-[#131313]" : "bg-slate-50"}`}>
      <ReactFlow<Node<DatosDelNodo>, Edge>
        nodes={nodos}
        edges={cables}
        nodeTypes={TIPOS_DE_NODO}
        edgeTypes={TIPOS_DE_CABLE}
        onInit={(i) => {
          instancia.current = i;
        }}
        onNodesChange={alCambiarNodos}
        onNodeDragStop={(_, __, movidos) => {
          const t = vivo.current;
          const donde = new Map(movidos.map((n) => [n.id, n.position]));
          onCambiar({
            ...t,
            fichas: t.fichas.map((f) => {
              const p = donde.get(f.id);
              return p ? { ...f, x: Math.round(p.x), y: Math.round(p.y) } : f;
            }),
          });
        }}
        onConnect={(c) => {
          if (!c.source || !c.target || !c.sourceHandle || c.source === c.target) return;
          const t = vivo.current;
          // UNA SALIDA, UN CABLE: tirar otro desde el mismo puntito reemplaza al anterior.
          const cables = t.cables.filter((x) => !(x.de === c.source && x.salida === c.sourceHandle));
          cables.push({ id: `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`, de: c.source, salida: c.sourceHandle, a: c.target });
          onCambiar({ ...t, cables });
        }}
        deleteKeyCode={null}
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
        minZoom={0.2}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1.2} color={oscuro ? "#333" : "#cbd5e1"} />
        <Controls showInteractive={false} />
        <Panel position="top-left">
          <div className="flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white/95 p-1.5 text-slate-800 shadow-md">
            {NUEVAS.map((tipo) => (
              <button
                key={tipo}
                type="button"
                onClick={() => agregar(tipo)}
                className="rounded-lg px-2 py-1 text-[12px] font-semibold hover:bg-slate-100"
                title={`Agregar una ficha «${ASPECTO[tipo].nombre}»`}
              >
                + {ASPECTO[tipo].icono} {ASPECTO[tipo].nombre}
              </button>
            ))}
          </div>
        </Panel>
      </ReactFlow>
    </div>
  );
}
