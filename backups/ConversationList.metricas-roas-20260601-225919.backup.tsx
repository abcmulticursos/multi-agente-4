"use client";

import { useMemo, useState } from "react";

export interface ConversationListItem {
  id: number;
  phone: string;
  name: string | null;
  mode: "AI" | "HUMAN";
  last_message_at: number | null;
  created_at: number;
  last_message_preview: string | null;
  /** Label sincronizada con NocoDB. Es null para convos viejas que aún
   *  no sincronizaron. Valores: hot/warm/pago/pago-reclamo/reclamo. */
  nocodb_label?: string | null;
  /** 1 = conversación pineada al top. */
  pinned?: number;
  /** Mensajes del cliente sin leer. */
  unread_count?: number;
  /** 1 = el operador la marcó manualmente como no leída (puntito sin número). */
  manually_unread?: number;
  /** Estado del flujo del bot (para el tablero Kanban / panel de ventas). */
  state?: string | null;
  /** Total pagado en céntimos (panel de ventas). */
  paid_total_cents?: number;
  /** 1 = compró con la oferta (precio reducido); 0 = precio normal. */
  discount_active?: number;
  /** unixepoch de la aprobación del pago (panel de ventas). */
  paid_at?: number | null;
}

type LabelFilter =
  | "todos"
  | "no leídos"
  | "hot"
  | "warm"
  | "pago"
  | "pago-reclamo"
  | "reclamo";

const LABEL_PILL_STYLES: Record<Exclude<LabelFilter, "todos">, string> = {
  "no leídos": "bg-emerald-100 text-emerald-700 border-emerald-200",
  hot: "bg-rose-100 text-rose-700 border-rose-200",
  warm: "bg-yellow-100 text-yellow-700 border-yellow-200",
  pago: "bg-sky-100 text-sky-700 border-sky-200",
  "pago-reclamo": "bg-orange-100 text-orange-700 border-orange-200",
  reclamo: "bg-fuchsia-100 text-fuchsia-700 border-fuchsia-200",
};

const LABEL_OPTIONS: LabelFilter[] = [
  "todos",
  "no leídos",
  "hot",
  "warm",
  "pago",
  "pago-reclamo",
  "reclamo",
];

interface Props {
  conversations: ConversationListItem[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  /** Toggle pin de una conversación. */
  onTogglePin: (id: number, pinned: boolean) => void;
  /** Marca una conversación como leída (read=true) o no leída (read=false). */
  onToggleRead: (id: number, read: boolean) => void;
}

function relativeTime(unix: number | null): string {
  if (!unix) return "";
  const diffSec = Math.floor(Date.now() / 1000) - unix;
  if (diffSec < 60) return "ahora";
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `hace ${min} min`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `hace ${hr} h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `hace ${day} d`;
  return new Date(unix * 1000).toLocaleDateString("es");
}

function formatPhone(phone: string): string {
  return phone.startsWith("+") ? phone : `+${phone}`;
}

/**
 * Devuelve true si la conversación coincide con el término de búsqueda.
 * - El número se matchea con dígitos (ignora "+", espacios y guiones).
 *   Así "935" encuentra a "+51935286681".
 * - El nombre se matchea case-insensitive con substring.
 */
function matchesSearch(c: ConversationListItem, term: string): boolean {
  const t = term.trim().toLowerCase();
  if (!t) return true;
  // Match por número (solo dígitos del término).
  const digits = t.replace(/\D/g, "");
  if (digits && c.phone.includes(digits)) return true;
  // Match por nombre.
  if (c.name && c.name.toLowerCase().includes(t)) return true;
  return false;
}

export default function ConversationList({
  conversations,
  selectedId,
  onSelect,
  onTogglePin,
  onToggleRead,
}: Props) {
  const [search, setSearch] = useState("");
  const [labelFilter, setLabelFilter] = useState<LabelFilter>("todos");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const filtered = useMemo(
    () =>
      conversations.filter((c) => {
        if (!matchesSearch(c, search)) return false;
        if (labelFilter === "todos") return true;
        if (labelFilter === "no leídos")
          return (c.unread_count ?? 0) > 0 || c.manually_unread === 1;
        return c.nocodb_label === labelFilter;
      }),
    [conversations, search, labelFilter]
  );

  function toggleSelected(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function exitSelectionMode() {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }

  function selectAllVisible() {
    setSelectedIds(new Set(filtered.map((c) => c.id)));
  }

  async function handleBulkDelete() {
    if (selectedIds.size === 0 || bulkBusy) return;
    const n = selectedIds.size;
    if (
      !window.confirm(
        `¿Borrar ${n} conversación${n === 1 ? "" : "es"}? Esta acción no se puede deshacer.`
      )
    ) {
      return;
    }
    setBulkBusy(true);
    try {
      const res = await fetch("/api/conversations/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      });
      if (res.ok) {
        exitSelectionMode();
      } else {
        alert("No se pudieron borrar algunas conversaciones.");
      }
    } catch {
      alert("Error de red al borrar.");
    } finally {
      setBulkBusy(false);
    }
  }

  // Header con búsqueda + filtros de etiqueta. Sticky para que se quede
  // arriba mientras se scrollea la lista.
  const searchHeader = (
    <div className="sticky top-0 z-10 border-b border-neutral-200 bg-white p-2 space-y-2">
      {selectionMode ? (
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={exitSelectionMode}
            className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs text-neutral-700 hover:bg-neutral-50"
          >
            Cancelar
          </button>
          <span className="text-xs font-medium text-neutral-600">
            {selectedIds.size} seleccionada{selectedIds.size === 1 ? "" : "s"}
          </span>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={selectAllVisible}
              className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs text-neutral-700 hover:bg-neutral-50"
            >
              Todas
            </button>
            <button
              type="button"
              onClick={handleBulkDelete}
              disabled={selectedIds.size === 0 || bulkBusy}
              className="rounded-md border border-red-300 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
            >
              {bulkBusy ? "Borrando…" : "Borrar"}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="🔍  Buscar por número o nombre..."
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm placeholder:text-neutral-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                aria-label="Limpiar búsqueda"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600"
              >
                ✕
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => setSelectionMode(true)}
            title="Seleccionar varias conversaciones"
            className="shrink-0 rounded-md border border-neutral-300 px-2.5 py-2 text-xs text-neutral-700 hover:bg-neutral-50"
          >
            Seleccionar
          </button>
        </div>
      )}
      {!selectionMode && (
        <div className="flex flex-wrap gap-1.5">
          {LABEL_OPTIONS.map((opt) => {
            const isActive = labelFilter === opt;
            const base =
              "rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition";
            const styles =
              opt === "todos"
                ? isActive
                  ? "bg-neutral-800 text-white border-neutral-800"
                  : "bg-white text-neutral-700 border-neutral-300 hover:bg-neutral-50"
                : isActive
                  ? LABEL_PILL_STYLES[opt] + " ring-2 ring-neutral-300"
                  : LABEL_PILL_STYLES[opt] + " opacity-60 hover:opacity-100";
            return (
              <button
                key={opt}
                type="button"
                onClick={() => setLabelFilter(opt)}
                className={`${base} ${styles}`}
              >
                {opt}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  if (conversations.length === 0) {
    return (
      <>
        {searchHeader}
        <div className="p-6 text-sm text-neutral-500">
          Aún no hay conversaciones. Cuando alguien escriba al número de
          WhatsApp configurado, aparecerá aquí.
        </div>
      </>
    );
  }

  if (filtered.length === 0) {
    return (
      <>
        {searchHeader}
        <div className="p-6 text-sm text-neutral-500">
          No se encontraron conversaciones que coincidan con &ldquo;{search}&rdquo;.
        </div>
      </>
    );
  }

  return (
    <>
      {searchHeader}
      <ul className="divide-y divide-neutral-200">
        {filtered.map((c, idx) => {
          const active = c.id === selectedId;
          const checked = selectedIds.has(c.id);
          const isPinned = c.pinned === 1;
          const unreadCount = c.unread_count ?? 0;
          const isManuallyUnread = c.manually_unread === 1;
          // El chat se considera "no leído" si tiene mensajes nuevos del
          // cliente O si el operador lo marcó manualmente.
          const isUnread = unreadCount > 0 || isManuallyUnread;
          // Divisor visual entre el bloque de pineadas y el resto.
          const prevPinned = idx > 0 && filtered[idx - 1].pinned === 1;
          const showPinDivider = !isPinned && prevPinned;
          return (
            <li
              key={c.id}
              className={showPinDivider ? "border-t-4 border-neutral-100" : ""}
            >
              <div
                className={[
                  "group flex items-center gap-2 px-2 transition",
                  active && !selectionMode
                    ? "bg-emerald-50"
                    : "hover:bg-neutral-50",
                ].join(" ")}
              >
                {selectionMode && (
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleSelected(c.id)}
                    className="h-4 w-4 shrink-0 rounded border-neutral-300 text-emerald-500 focus:ring-emerald-500"
                  />
                )}
                <button
                  type="button"
                  onClick={() =>
                    selectionMode ? toggleSelected(c.id) : onSelect(c.id)
                  }
                  className="min-w-0 flex-1 py-3 text-left"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        {isPinned && (
                          <span title="Fijada" className="shrink-0 text-amber-500">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              viewBox="0 0 24 24"
                              fill="currentColor"
                              className="h-3 w-3"
                            >
                              <path d="M16 3l5 5-3 1-4 4 1 5-2 2-4-6-5 5-1-1 5-5-6-4 2-2 5 1 4-4 1-3z" />
                            </svg>
                          </span>
                        )}
                        <div
                          className={`truncate text-sm text-neutral-900 ${
                            isUnread ? "font-bold" : "font-medium"
                          }`}
                        >
                          {c.name?.trim() || formatPhone(c.phone)}
                        </div>
                        {c.nocodb_label &&
                          c.nocodb_label !== "todos" &&
                          LABEL_PILL_STYLES[
                            c.nocodb_label as keyof typeof LABEL_PILL_STYLES
                          ] && (
                            <span
                              className={`shrink-0 rounded-full border px-1.5 py-0 text-[9px] font-medium ${
                                LABEL_PILL_STYLES[
                                  c.nocodb_label as keyof typeof LABEL_PILL_STYLES
                                ]
                              }`}
                            >
                              {c.nocodb_label}
                            </span>
                          )}
                      </div>
                      <div
                        className={`truncate text-xs ${
                          isUnread
                            ? "font-medium text-neutral-700"
                            : "text-neutral-500"
                        }`}
                      >
                        {c.last_message_preview ?? "—"}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span
                        className={[
                          "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                          c.mode === "AI"
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-amber-100 text-amber-700",
                        ].join(" ")}
                      >
                        {c.mode === "AI" ? "IA" : "HUMANO"}
                      </span>
                      <span className="text-[10px] text-neutral-400">
                        {relativeTime(c.last_message_at ?? c.created_at)}
                      </span>
                      {unreadCount > 0 ? (
                        // Mensajes nuevos del cliente: badge verde con número.
                        <span className="flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-emerald-500 px-1 text-[10px] font-bold text-white">
                          {unreadCount}
                        </span>
                      ) : isManuallyUnread ? (
                        // Marcado manualmente como no leído: puntito verde
                        // sin número, estilo WhatsApp.
                        <span
                          className="h-2.5 w-2.5 rounded-full bg-emerald-500"
                          title="Marcado como no leído"
                        />
                      ) : null}
                    </div>
                  </div>
                </button>
                {!selectionMode && (
                  <div className="flex shrink-0 items-center">
                    <button
                      type="button"
                      onClick={() => onToggleRead(c.id, isUnread)}
                      title={
                        isUnread
                          ? "Marcar como leído"
                          : "Marcar como no leído"
                      }
                      className={[
                        "shrink-0 rounded p-1.5 transition",
                        isUnread
                          ? "text-emerald-500 hover:bg-emerald-50"
                          : "text-neutral-300 opacity-0 group-hover:opacity-100 hover:bg-neutral-100 hover:text-neutral-500",
                      ].join(" ")}
                    >
                      {isUnread ? (
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="h-4 w-4"
                        >
                          <path d="M20 6L9 17l-5-5" />
                        </svg>
                      ) : (
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          className="h-4 w-4"
                        >
                          <circle cx="12" cy="12" r="8" />
                        </svg>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => onTogglePin(c.id, !isPinned)}
                      title={isPinned ? "Dejar de fijar" : "Fijar al top"}
                      className={[
                        "shrink-0 rounded p-1.5 transition",
                        isPinned
                          ? "text-amber-500 hover:bg-amber-50"
                          : "text-neutral-300 opacity-0 group-hover:opacity-100 hover:bg-neutral-100 hover:text-neutral-500",
                      ].join(" ")}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        className="h-4 w-4"
                      >
                        <path d="M16 3l5 5-3 1-4 4 1 5-2 2-4-6-5 5-1-1 5-5-6-4 2-2 5 1 4-4 1-3z" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
