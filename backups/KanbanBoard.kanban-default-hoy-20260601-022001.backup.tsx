"use client";

import { useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";

/**
 * Vista Kanban + Panel de ventas.
 *
 * COLUMNAS DE EMBUDO (Nuevo → Pago pendiente): igual que siempre. Drag manual
 * cambia el state del bot (PATCH /api/conversations/{id}).
 *
 * COLUMNAS DE COMPRADORES (Total / Pagado S/10 / Pagado S/8): son SOLO DE
 * LECTURA. Un comprador (cualquiera que ya pagó, sin importar el sub-paso
 * posterior del bot) aparece fijo aquí y NO se mueve más. Por eso una misma
 * persona aparece en "Total" y en su columna de precio (una copia).
 *
 * BARRA SUPERIOR: "Caja de hoy" siempre visible + selector de fechas para ver
 * el dinero de cualquier rango. Todo es de lectura: NADA de esto le da órdenes
 * al bot.
 *
 * IMPORTANTE: el state del bot tiene logica de workflow atada. Mover
 * manualmente las tarjetas del embudo puede saltar pasos del bot. Usar con
 * criterio. Las tarjetas de compradores no se pueden arrastrar.
 */

interface KanbanConversation {
  id: number;
  phone: string;
  name?: string | null;
  state?: string | null;
  last_message_preview?: string | null;
  last_message_at?: number | null;
  created_at?: number | null;
  pinned?: boolean | number;
  paid_total_cents?: number;
  discount_active?: number;
  paid_at?: number | null;
}

interface Props {
  conversations: KanbanConversation[];
  onSelect: (id: number) => void;
  onStateChanged: () => void;
}

// Estados del embudo (pre-compra). Solo estos son columnas con drag & drop.
type FunnelColumnId =
  | "new"
  | "awaiting_response"
  | "intro_running"
  | "intro_done"
  | "payment_done";

const FUNNEL_COLUMNS: { id: FunnelColumnId; label: string; color: string }[] = [
  { id: "new", label: "Nuevo", color: "bg-neutral-100 text-neutral-700 border-neutral-300" },
  { id: "awaiting_response", label: "Contactado", color: "bg-sky-50 text-sky-700 border-sky-300" },
  { id: "intro_running", label: "Mostrando info", color: "bg-blue-50 text-blue-700 border-blue-300" },
  { id: "intro_done", label: "Interesado", color: "bg-violet-50 text-violet-700 border-violet-300" },
  { id: "payment_done", label: "Pago pendiente", color: "bg-amber-50 text-amber-700 border-amber-300" },
];

// Cualquiera de estos estados significa que YA compró (pagó y se aprobó).
// Los sub-pasos posteriores (email, regalo, facebook) siguen contando como
// comprador — por eso no los listamos como columnas: van todos a "Pagado".
const BUYER_STATES = new Set<string>([
  "payment_approved",
  "awaiting_email",
  "awaiting_gift_consent",
  "awaiting_facebook_comment",
]);

function isBuyer(c: KanbanConversation): boolean {
  return !!c.state && BUYER_STATES.has(c.state);
}

/** Fecha efectiva de la compra (unix sec). Si no hay sello de pago (compras
 *  viejas previas a esta función), aproximamos con la última actividad o la
 *  fecha de creación — así igual aparecen en los filtros por fecha. */
function effectivePaidAt(c: KanbanConversation): number {
  return c.paid_at ?? c.last_message_at ?? c.created_at ?? 0;
}

function fmtMoney(cents: number): string {
  return (
    "S/ " +
    (cents / 100).toLocaleString("es-PE", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    })
  );
}

// Todos los cálculos de fecha están anclados a HORA DE PERÚ (America/Lima,
// UTC-5, sin horario de verano). Así "hoy" y los rangos son correctos sin
// importar la zona horaria de la computadora desde donde se abra el panel —
// una venta de las 23:55 hora Perú siempre cuenta en el día Perú correcto.

/** YYYY-MM-DD del día en hora Perú (para los <input type="date"> y "Hoy"). */
function localDateStr(d: Date): string {
  // en-CA produce el formato YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
  }).format(d);
}

/** Inicio del día (00:00 Perú) de una fecha YYYY-MM-DD, en unix sec.
 *  00:00 en Perú (UTC-5) equivale a las 05:00 UTC del mismo día. */
function dayStartUnix(dateStr: string): number {
  return Math.floor(new Date(`${dateStr}T05:00:00Z`).getTime() / 1000);
}
/** Final del día (23:59:59 Perú) de una fecha YYYY-MM-DD, en unix sec. */
function dayEndUnix(dateStr: string): number {
  return dayStartUnix(dateStr) + 86400 - 1;
}

function FunnelCard({
  convo,
  onClick,
}: {
  convo: KanbanConversation;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `card-${convo.id}`,
    data: { conversationId: convo.id },
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={onClick}
      className={`mb-2 cursor-pointer rounded-md border border-neutral-200 bg-white p-2 shadow-sm hover:border-emerald-300 ${
        isDragging ? "opacity-30" : ""
      }`}
    >
      <div className="mb-1 flex items-center gap-1 text-xs font-medium text-neutral-900">
        {convo.pinned ? <span className="text-amber-500">📌</span> : null}
        <span className="truncate">{convo.name || convo.phone}</span>
      </div>
      {convo.last_message_preview && (
        <div className="truncate text-[11px] text-neutral-500">
          {convo.last_message_preview}
        </div>
      )}
    </div>
  );
}

/** Tarjeta de comprador: solo lectura (no se arrastra). Muestra el monto
 *  pagado por esa persona. */
function BuyerCard({
  convo,
  onClick,
}: {
  convo: KanbanConversation;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className="mb-2 cursor-pointer rounded-md border border-neutral-200 bg-white p-2 shadow-sm hover:border-emerald-300"
    >
      <div className="mb-1 flex items-center justify-between gap-1 text-xs font-medium text-neutral-900">
        <span className="flex items-center gap-1 truncate">
          {convo.pinned ? <span className="text-amber-500">📌</span> : null}
          <span className="truncate">{convo.name || convo.phone}</span>
        </span>
        <span className="shrink-0 font-semibold text-emerald-700">
          {fmtMoney(convo.paid_total_cents ?? 0)}
        </span>
      </div>
      {convo.last_message_preview && (
        <div className="truncate text-[11px] text-neutral-500">
          {convo.last_message_preview}
        </div>
      )}
    </div>
  );
}

function FunnelColumn({
  id,
  label,
  color,
  conversations,
  onSelect,
}: {
  id: FunnelColumnId;
  label: string;
  color: string;
  conversations: KanbanConversation[];
  onSelect: (id: number) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `col-${id}`,
    data: { state: id },
  });
  return (
    <div
      ref={setNodeRef}
      className={`flex h-full w-64 flex-shrink-0 flex-col rounded-md border ${
        isOver
          ? "border-emerald-400 bg-emerald-50"
          : "border-neutral-200 bg-neutral-50"
      }`}
    >
      <div
        className={`flex items-center justify-between rounded-t-md border-b border-neutral-200 px-3 py-2 ${color}`}
      >
        <span className="text-xs font-semibold">{label}</span>
        <span className="text-[10px] opacity-75">{conversations.length}</span>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {conversations.map((c) => (
          <FunnelCard key={c.id} convo={c} onClick={() => onSelect(c.id)} />
        ))}
      </div>
    </div>
  );
}

/** Columna de compradores (solo lectura): muestra la SUMA de dinero arriba. */
function BuyerColumn({
  label,
  color,
  conversations,
  onSelect,
}: {
  label: string;
  color: string;
  conversations: KanbanConversation[];
  onSelect: (id: number) => void;
}) {
  const totalCents = conversations.reduce(
    (acc, c) => acc + (c.paid_total_cents ?? 0),
    0
  );
  return (
    <div className="flex h-full w-64 flex-shrink-0 flex-col rounded-md border border-neutral-200 bg-neutral-50">
      <div
        className={`flex flex-col gap-0.5 rounded-t-md border-b border-neutral-200 px-3 py-2 ${color}`}
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold">{label}</span>
          <span className="text-[10px] opacity-75">
            {conversations.length}
          </span>
        </div>
        <span className="text-sm font-bold">{fmtMoney(totalCents)}</span>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {conversations.map((c) => (
          <BuyerCard key={c.id} convo={c} onClick={() => onSelect(c.id)} />
        ))}
      </div>
    </div>
  );
}

export default function KanbanBoard({
  conversations,
  onSelect,
  onStateChanged,
}: Props) {
  const [activeId, setActiveId] = useState<number | null>(null);
  // Filtro por rango de fechas (vacío = mostrar todo).
  const [fromStr, setFromStr] = useState<string>("");
  const [toStr, setToStr] = useState<string>("");
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const rangeActive = fromStr !== "" || toStr !== "";
  const fromUnix = fromStr ? dayStartUnix(fromStr) : null;
  const toUnix = toStr ? dayEndUnix(toStr) : null;

  // Reparto del embudo (pre-compra) por estado.
  const funnelByState = useMemo(() => {
    const map: Record<FunnelColumnId, KanbanConversation[]> = {
      new: [],
      awaiting_response: [],
      intro_running: [],
      intro_done: [],
      payment_done: [],
    };
    for (const c of conversations) {
      if (isBuyer(c)) continue; // los compradores van al panel de ventas
      const s = (c.state ?? "new") as FunnelColumnId;
      if (map[s]) map[s].push(c);
    }
    return map;
  }, [conversations]);

  // Todos los compradores (sin filtrar por fecha).
  const allBuyers = useMemo(
    () => conversations.filter(isBuyer),
    [conversations]
  );

  // Compradores dentro del rango de fechas elegido (o todos si no hay filtro).
  const buyersInRange = useMemo(() => {
    if (!rangeActive) return allBuyers;
    return allBuyers.filter((c) => {
      const t = effectivePaidAt(c);
      if (fromUnix !== null && t < fromUnix) return false;
      if (toUnix !== null && t > toUnix) return false;
      return true;
    });
  }, [allBuyers, rangeActive, fromUnix, toUnix]);

  const buyers10 = buyersInRange.filter((c) => !c.discount_active);
  const buyers8 = buyersInRange.filter((c) => !!c.discount_active);

  // Caja de HOY (siempre, independiente del filtro de rango).
  const today = useMemo(() => {
    const now = new Date();
    const start = dayStartUnix(localDateStr(now));
    const end = dayEndUnix(localDateStr(now));
    const todays = allBuyers.filter((c) => {
      const t = effectivePaidAt(c);
      return t >= start && t <= end;
    });
    const cents = (arr: KanbanConversation[]) =>
      arr.reduce((a, c) => a + (c.paid_total_cents ?? 0), 0);
    const t10 = todays.filter((c) => !c.discount_active);
    const t8 = todays.filter((c) => !!c.discount_active);
    return {
      total: cents(todays),
      count: todays.length,
      cents10: cents(t10),
      count10: t10.length,
      cents8: cents(t8),
      count8: t8.length,
    };
  }, [allBuyers]);

  const rangeTotalCents = buyersInRange.reduce(
    (a, c) => a + (c.paid_total_cents ?? 0),
    0
  );

  function onDragStart(e: DragStartEvent) {
    const id = e.active.data.current?.conversationId;
    if (typeof id === "number") setActiveId(id);
  }

  async function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const id = e.active.data.current?.conversationId as number | undefined;
    const state = e.over?.data.current?.state as FunnelColumnId | undefined;
    if (!id || !state) return;
    const current = conversations.find((c) => c.id === id);
    if (!current || current.state === state) return;
    await fetch(`/api/conversations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state }),
    });
    onStateChanged();
  }

  const dragged = activeId
    ? conversations.find((c) => c.id === activeId)
    : null;

  function setHoy() {
    const t = localDateStr(new Date());
    setFromStr(t);
    setToStr(t);
  }
  function clearRange() {
    setFromStr("");
    setToStr("");
  }

  return (
    <div className="flex h-full flex-col">
      {/* ── Barra de ventas ───────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-neutral-200 bg-white px-4 py-2">
        {/* Caja de hoy (siempre visible) */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            💰 Caja de hoy
          </span>
          <span className="text-lg font-bold text-emerald-700">
            {fmtMoney(today.total)}
          </span>
          <span className="text-xs text-neutral-500">
            ({today.count} {today.count === 1 ? "venta" : "ventas"})
          </span>
          <span className="text-[11px] text-neutral-400">
            S/10: {fmtMoney(today.cents10)} ({today.count10}) · S/8:{" "}
            {fmtMoney(today.cents8)} ({today.count8})
          </span>
        </div>

        {/* Selector de rango */}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs font-medium text-neutral-600">📅 Desde</span>
          <input
            type="date"
            value={fromStr}
            onChange={(e) => setFromStr(e.target.value)}
            className="rounded border border-neutral-300 px-2 py-1 text-xs"
          />
          <span className="text-xs font-medium text-neutral-600">Hasta</span>
          <input
            type="date"
            value={toStr}
            onChange={(e) => setToStr(e.target.value)}
            className="rounded border border-neutral-300 px-2 py-1 text-xs"
          />
          <button
            onClick={setHoy}
            className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
          >
            Hoy
          </button>
          {rangeActive && (
            <button
              onClick={clearRange}
              className="rounded border border-neutral-300 bg-white px-2 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-100"
            >
              ✕ Quitar
            </button>
          )}
        </div>

        {/* Total del rango (solo cuando hay filtro activo) */}
        {rangeActive && (
          <div className="flex w-full items-center gap-2 border-t border-dashed border-neutral-200 pt-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Total del rango
            </span>
            <span className="text-base font-bold text-sky-700">
              {fmtMoney(rangeTotalCents)}
            </span>
            <span className="text-xs text-neutral-500">
              ({buyersInRange.length}{" "}
              {buyersInRange.length === 1 ? "venta" : "ventas"})
            </span>
          </div>
        )}
      </div>

      {/* ── Tablero ───────────────────────────────────────────────────── */}
      <DndContext
        sensors={sensors}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      >
        <div className="flex flex-1 gap-3 overflow-x-auto p-3">
          {FUNNEL_COLUMNS.map((col) => (
            <FunnelColumn
              key={col.id}
              id={col.id}
              label={col.label}
              color={col.color}
              conversations={funnelByState[col.id] ?? []}
              onSelect={onSelect}
            />
          ))}

          {/* Separador visual entre embudo y compradores */}
          <div className="flex-shrink-0 self-stretch border-l-2 border-dashed border-neutral-300" />

          <BuyerColumn
            label="Compradores (total)"
            color="bg-emerald-100 text-emerald-800 border-emerald-300"
            conversations={buyersInRange}
            onSelect={onSelect}
          />
          <BuyerColumn
            label="Pagado S/10"
            color="bg-emerald-50 text-emerald-700 border-emerald-300"
            conversations={buyers10}
            onSelect={onSelect}
          />
          <BuyerColumn
            label="Pagado S/8"
            color="bg-amber-50 text-amber-700 border-amber-300"
            conversations={buyers8}
            onSelect={onSelect}
          />
        </div>

        <DragOverlay>
          {dragged ? (
            <div className="rounded-md border border-emerald-400 bg-white p-2 shadow-lg">
              <div className="text-xs font-medium">
                {dragged.name || dragged.phone}
              </div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
