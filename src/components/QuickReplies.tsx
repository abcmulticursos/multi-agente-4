"use client";

import { useEffect, useRef, useState } from "react";

export interface QuickReplyDTO {
  id: number;
  shortcut: string | null;
  content: string;
  created_at: number;
  media_type: "image" | "video" | "document" | "audio" | null;
  media_url: string | null;
  media_mime: string | null;
  media_filename: string | null;
}

interface Props {
  replies: QuickReplyDTO[];
  /** Deja la respuesta elegida en el cajón de escribir, con su adjunto
   *  enganchado si lo tiene. NO la envía: el envío lo decide el operador. */
  onSend: (reply: QuickReplyDTO) => Promise<void>;
  /** Avisa al padre que la lista cambió (para refetch). */
  onChanged: () => void;
  disabled?: boolean;
}

/** Nombre legible del adjunto, para las etiquetas de la lista. */
function etiquetaDeAdjunto(r: QuickReplyDTO): string | null {
  switch (r.media_type) {
    case "image":
      return "📷 Imagen";
    case "video":
      return "🎬 Video";
    case "audio":
      return "🎤 Audio";
    case "document":
      return `📄 ${r.media_filename || "PDF"}`;
    default:
      return null;
  }
}

export default function QuickReplies({
  replies,
  onSend,
  onChanged,
  disabled,
}: Props) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [enviandoId, setEnviandoId] = useState<number | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Cerrar el popover al clickear fuera.
  useEffect(() => {
    if (!popoverOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node)
      ) {
        setPopoverOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [popoverOpen]);

  async function handlePick(reply: QuickReplyDTO) {
    if (enviandoId) return;
    setEnviandoId(reply.id);
    try {
      await onSend(reply);
      setPopoverOpen(false);
    } finally {
      setEnviandoId(null);
    }
  }

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setPopoverOpen((v) => !v)}
        title={
          disabled
            ? "Cambia a modo HUMANO para usar respuestas rápidas"
            : "Respuestas rápidas"
        }
        className="flex h-10 w-10 items-center justify-center rounded-full text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="currentColor"
          className="h-5 w-5"
        >
          <path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" />
        </svg>
      </button>

      {popoverOpen && (
        <div className="absolute bottom-12 left-0 z-30 w-72 rounded-lg border border-neutral-200 bg-tarjeta shadow-lg">
          <div className="border-b border-neutral-100 px-3 py-2 text-xs font-semibold text-neutral-500">
            Respuestas rápidas
          </div>
          <div className="max-h-72 overflow-y-auto">
            {replies.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-neutral-400">
                No hay respuestas rápidas todavía.
              </div>
            ) : (
              replies.map((r) => {
                const adjunto = etiquetaDeAdjunto(r);
                return (
                  <button
                    key={r.id}
                    type="button"
                    disabled={enviandoId !== null}
                    onClick={() => handlePick(r)}
                    title="Enviar esta respuesta"
                    className="block w-full border-b border-neutral-50 px-3 py-2 text-left last:border-b-0 hover:bg-emerald-50 disabled:opacity-50"
                  >
                    <div className="mb-0.5 flex flex-wrap items-center gap-1">
                      {r.shortcut && (
                        <span className="inline-block rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600">
                          /{r.shortcut}
                        </span>
                      )}
                      {adjunto && (
                        <span className="inline-block rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-700">
                          {adjunto}
                        </span>
                      )}
                      {enviandoId === r.id && (
                        <span className="text-[10px] text-neutral-500">
                          enviando…
                        </span>
                      )}
                    </div>
                    {r.content && (
                      <div className="line-clamp-2 text-xs text-neutral-700">
                        {r.content}
                      </div>
                    )}
                  </button>
                );
              })
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              setPopoverOpen(false);
              setManageOpen(true);
            }}
            className="flex w-full items-center gap-1.5 border-t border-neutral-100 px-3 py-2 text-xs text-neutral-600 hover:bg-neutral-50"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="h-3.5 w-3.5"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            Gestionar respuestas
          </button>
        </div>
      )}

      {manageOpen && (
        <ManageModal
          replies={replies}
          onClose={() => setManageOpen(false)}
          onChanged={onChanged}
        />
      )}
    </div>
  );
}

function ManageModal({
  replies,
  onClose,
  onChanged,
}: {
  replies: QuickReplyDTO[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [shortcut, setShortcut] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Adjunto: el archivo nuevo que se acaba de elegir, el que ya tenía guardado,
  // y si el usuario pidió quitarlo.
  const [archivo, setArchivo] = useState<File | null>(null);
  const [adjuntoGuardado, setAdjuntoGuardado] = useState<string | null>(null);
  const [quitarAdjunto, setQuitarAdjunto] = useState(false);
  const archivoRef = useRef<HTMLInputElement | null>(null);

  function resetForm() {
    setEditingId(null);
    setShortcut("");
    setContent("");
    setError(null);
    setArchivo(null);
    setAdjuntoGuardado(null);
    setQuitarAdjunto(false);
    if (archivoRef.current) archivoRef.current.value = "";
  }

  function startEdit(r: QuickReplyDTO) {
    setEditingId(r.id);
    setShortcut(r.shortcut ?? "");
    setContent(r.content);
    setError(null);
    setArchivo(null);
    setAdjuntoGuardado(etiquetaDeAdjunto(r));
    setQuitarAdjunto(false);
    if (archivoRef.current) archivoRef.current.value = "";
  }

  async function handleSave() {
    const trimmed = content.trim();
    // Con adjunto el texto es opcional: se puede mandar solo la imagen.
    const habraAdjunto = !!archivo || (!!adjuntoGuardado && !quitarAdjunto);
    if (!trimmed && !habraAdjunto) {
      setError("Escribe un texto o adjunta un archivo");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const url = editingId
        ? `/api/quick-replies/${editingId}`
        : "/api/quick-replies";
      const method = editingId ? "PATCH" : "POST";
      const form = new FormData();
      form.append("shortcut", shortcut.trim());
      form.append("content", trimmed);
      if (archivo) form.append("file", archivo);
      if (quitarAdjunto) form.append("quitar_adjunto", "1");
      const res = await fetch(url, { method, body: form });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(data.error || "No se pudo guardar");
        return;
      }
      resetForm();
      onChanged();
    } catch {
      setError("Error de red");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("¿Borrar esta respuesta rápida?")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/quick-replies/${id}`, { method: "DELETE" });
      if (res.ok) {
        if (editingId === id) resetForm();
        onChanged();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-2xl bg-tarjeta shadow-xl">
        <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-3">
          <h2 className="text-sm font-semibold text-neutral-900">
            Respuestas rápidas
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-600"
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {replies.length === 0 ? (
            <p className="text-center text-xs text-neutral-400">
              No hay respuestas rápidas. Crea la primera abajo.
            </p>
          ) : (
            <ul className="space-y-2">
              {replies.map((r) => (
                <li
                  key={r.id}
                  className="flex items-start gap-2 rounded-lg border border-neutral-200 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="mb-0.5 flex flex-wrap items-center gap-1">
                      {r.shortcut && (
                        <span className="inline-block rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600">
                          /{r.shortcut}
                        </span>
                      )}
                      {etiquetaDeAdjunto(r) && (
                        <span className="inline-block rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-700">
                          {etiquetaDeAdjunto(r)}
                        </span>
                      )}
                    </div>
                    <div className="whitespace-pre-wrap break-words text-xs text-neutral-700">
                      {r.content}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      onClick={() => startEdit(r)}
                      className="rounded px-2 py-1 text-[11px] text-neutral-600 hover:bg-neutral-100"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(r.id)}
                      disabled={busy}
                      className="rounded px-2 py-1 text-[11px] text-red-600 hover:bg-red-50 disabled:opacity-50"
                    >
                      Borrar
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-neutral-200 px-5 py-4">
          <div className="mb-2 text-xs font-semibold text-neutral-500">
            {editingId ? "Editar respuesta" : "Nueva respuesta"}
          </div>
          <input
            type="text"
            value={shortcut}
            onChange={(e) => setShortcut(e.target.value)}
            placeholder="Atajo opcional (ej: saludo) — se usa con /saludo"
            className="mb-2 w-full rounded-md border border-neutral-300 px-3 py-1.5 text-xs focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={3}
            placeholder="Contenido del mensaje… (opcional si adjuntas un archivo)"
            className="w-full resize-none rounded-md border border-neutral-300 px-3 py-2 text-xs focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />

          {/* ADJUNTO. Se guarda una sola vez y se manda con la respuesta. */}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              ref={archivoRef}
              type="file"
              accept="image/*,video/*,audio/*,application/pdf"
              onChange={(e) => {
                setArchivo(e.target.files?.[0] ?? null);
                setQuitarAdjunto(false);
                setError(null);
              }}
              className="hidden"
              id="qr-archivo"
            />
            <label
              htmlFor="qr-archivo"
              className="cursor-pointer rounded-md border border-neutral-300 px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50"
            >
              📎 Adjuntar archivo
            </label>

            {archivo ? (
              <span className="flex items-center gap-1 rounded bg-sky-100 px-2 py-1 text-[11px] text-sky-800">
                {archivo.name}
                <button
                  type="button"
                  onClick={() => {
                    setArchivo(null);
                    if (archivoRef.current) archivoRef.current.value = "";
                  }}
                  className="font-bold text-sky-900 hover:text-red-600"
                  aria-label="Quitar archivo"
                >
                  ✕
                </button>
              </span>
            ) : adjuntoGuardado && !quitarAdjunto ? (
              <span className="flex items-center gap-1 rounded bg-sky-100 px-2 py-1 text-[11px] text-sky-800">
                {adjuntoGuardado}
                <button
                  type="button"
                  onClick={() => setQuitarAdjunto(true)}
                  className="font-bold text-sky-900 hover:text-red-600"
                  aria-label="Quitar adjunto"
                >
                  ✕
                </button>
              </span>
            ) : quitarAdjunto ? (
              <span className="text-[11px] text-neutral-500">
                Se quitará el adjunto al guardar
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-neutral-500">
            Imagen, video, audio o PDF. Máximo 16MB. Si la respuesta lleva texto
            y archivo, el texto va como pie del archivo.
          </p>

          {error && <div className="mt-1 text-xs text-red-600">{error}</div>}
          <div className="mt-2 flex justify-end gap-2">
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                disabled={busy}
                className="rounded-md border border-neutral-200 px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
              >
                Cancelar edición
              </button>
            )}
            <button
              type="button"
              onClick={handleSave}
              disabled={
                busy ||
                (!content.trim() &&
                  !archivo &&
                  !(adjuntoGuardado && !quitarAdjunto))
              }
              className="rounded-md bg-emerald-500 px-4 py-1.5 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
            >
              {busy ? "Guardando…" : editingId ? "Guardar cambios" : "Crear"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
