"use client";

import { useState } from "react";
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
 * Vista Kanban — tablero con columnas por etapa del flujo del bot.
 * Auto-move: cuando el bot cambia el state, la lista se actualiza vía
 * polling y la card se mueve a la columna correspondiente. Drag manual:
 * el operador arrastra una card a otra columna para forzar el cambio
 * de estado (PATCH /api/conversations/{id} con { state: "..." }).
 *
 * IMPORTANTE: el state del bot tiene logica de workflow atada (seguimientos,
 * pagos, regalos). Mover manualmente puede saltar pasos del bot. Usar
 * con criterio.
 */

interface KanbanConversation {
  id: number;
  phone: string;
  name?: string | null;
  state?: string | null;
  last_message_preview?: string | null;
  last_message_at?: number | null;
  pinned?: boolean | number;
}

interface Props {
  conversations: KanbanConversation[];
  onSelect: (id: number) => void;
  onStateChanged: () => void;
}

type ColumnId =
  | "new"
  | "awaiting_response"
  | "intro_running"
  | "intro_done"
  | "payment_done"
  | "payment_approved"
  | "awaiting_email"
  | "awaiting_gift_consent"
  | "awaiting_facebook_comment";

const COLUMNS: { id: ColumnId; label: string; color: string }[] = [
  { id: "new", label: "Nuevo", color: "bg-neutral-100 text-neutral-700 border-neutral-300" },
  { id: "awaiting_response", label: "Contactado", color: "bg-sky-50 text-sky-700 border-sky-300" },
  { id: "intro_running", label: "Mostrando info", color: "bg-blue-50 text-blue-700 border-blue-300" },
  { id: "intro_done", label: "Interesado", color: "bg-violet-50 text-violet-700 border-violet-300" },
  { id: "payment_done", label: "Pago pendiente", color: "bg-amber-50 text-amber-700 border-amber-300" },
  { id: "payment_approved", label: "Pagado", color: "bg-emerald-50 text-emerald-700 border-emerald-300" },
  { id: "awaiting_email", label: "Esperando email", color: "bg-teal-50 text-teal-700 border-teal-300" },
  { id: "awaiting_gift_consent", label: "Regalo ofrecido", color: "bg-pink-50 text-pink-700 border-pink-300" },
  { id: "awaiting_facebook_comment", label: "Esperando review FB", color: "bg-fuchsia-50 text-fuchsia-700 border-fuchsia-300" },
];

function Card({
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

function Column({
  id,
  label,
  color,
  conversations,
  onSelect,
}: {
  id: ColumnId;
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
          <Card key={c.id} convo={c} onClick={() => onSelect(c.id)} />
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
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const byState: Record<ColumnId, KanbanConversation[]> = {} as Record<
    ColumnId,
    KanbanConversation[]
  >;
  for (const col of COLUMNS) byState[col.id] = [];
  for (const c of conversations) {
    const state = (c.state ?? "new") as ColumnId;
    if (byState[state]) byState[state].push(c);
  }

  function onDragStart(e: DragStartEvent) {
    const id = e.active.data.current?.conversationId;
    if (typeof id === "number") setActiveId(id);
  }

  async function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const id = e.active.data.current?.conversationId as number | undefined;
    const state = e.over?.data.current?.state as ColumnId | undefined;
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

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="flex h-full gap-3 overflow-x-auto p-3">
        {COLUMNS.map((col) => (
          <Column
            key={col.id}
            id={col.id}
            label={col.label}
            color={col.color}
            conversations={byState[col.id] ?? []}
            onSelect={onSelect}
          />
        ))}
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
  );
}
