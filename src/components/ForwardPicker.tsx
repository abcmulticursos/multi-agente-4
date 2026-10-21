"use client";

import { useEffect, useMemo, useState } from "react";

interface ConversacionMinima {
  id: number;
  name: string | null;
  phone: string;
  last_message_at: number | null;
}

/**
 * Selector de "¿a quién se lo reenvío?". Lista las conversaciones existentes
 * con buscador, igual que WhatsApp al reenviar.
 *
 * Solo salen conversaciones que YA existen: WhatsApp no deja escribirle a
 * alguien que nunca te escribió, así que no tendría sentido ofrecerlo.
 */
export default function ForwardPicker({
  cantidad,
  excluirId,
  onCancelar,
  onElegir,
}: {
  /** Cuántas burbujas se van a reenviar (para el título). */
  cantidad: number;
  /** La conversación actual: no tiene sentido reenviarse a uno mismo. */
  excluirId: number;
  onCancelar: () => void;
  onElegir: (destinoId: number, nombre: string) => void;
}) {
  const [conversaciones, setConversaciones] = useState<ConversacionMinima[]>([]);
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState("");

  useEffect(() => {
    let vivo = true;
    fetch("/api/conversations", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (!vivo) return;
        const filas = Array.isArray(data?.conversations)
          ? (data.conversations as ConversacionMinima[])
          : [];
        setConversaciones(filas.filter((c) => c.id !== excluirId));
      })
      .catch(() => {
        if (vivo) setConversaciones([]);
      })
      .finally(() => {
        if (vivo) setCargando(false);
      });
    return () => {
      vivo = false;
    };
  }, [excluirId]);

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return conversaciones;
    return conversaciones.filter(
      (c) =>
        (c.name ?? "").toLowerCase().includes(q) ||
        c.phone.toLowerCase().includes(q)
    );
  }, [conversaciones, busqueda]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 md:items-center">
      <div className="flex h-[80dvh] w-full max-w-lg flex-col rounded-t-2xl bg-tarjeta shadow-xl md:h-[70vh] md:rounded-2xl">
        <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
          <div>
            <h2 className="text-base font-semibold text-neutral-900">
              Reenviar a…
            </h2>
            <p className="text-xs text-neutral-500">
              {cantidad} {cantidad === 1 ? "mensaje" : "mensajes"}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancelar}
            className="rounded-full px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100"
          >
            Cancelar
          </button>
        </div>

        <div className="border-b border-neutral-200 px-4 py-2">
          <input
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre o número"
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-base md:text-sm"
          />
        </div>

        <div className="flex-1 overflow-y-auto">
          {cargando ? (
            <p className="p-4 text-center text-sm text-neutral-500">
              Cargando conversaciones…
            </p>
          ) : visibles.length === 0 ? (
            <p className="p-4 text-center text-sm text-neutral-500">
              {busqueda
                ? "Ninguna conversación coincide."
                : "No hay otras conversaciones."}
            </p>
          ) : (
            <ul className="divide-y divide-neutral-100">
              {visibles.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => onElegir(c.id, c.name || c.phone)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-neutral-50 active:bg-neutral-100"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-sm font-medium text-neutral-600">
                      {(c.name || c.phone).slice(0, 2).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-base font-medium text-neutral-900 md:text-sm">
                        {c.name || c.phone}
                      </span>
                      {c.name && (
                        <span className="block truncate text-xs text-neutral-500">
                          {c.phone}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
