"use client";

import { useEffect, useRef, useState } from "react";
import { renderWhatsAppFormat } from "@/lib/whatsapp-format";
import { pieDeFotoReal } from "@/lib/marca-de-adjunto";

export type Role = "user" | "assistant" | "human";
export type MediaType = "audio" | "image" | "video" | "document";
export type WaStatus = "sent" | "delivered" | "read" | "failed";
export type Channel = "whatsapp" | "messenger" | "instagram" | "tiktok";

export interface MessageDTO {
  id: number;
  role: Role;
  content: string;
  wa_message_id: string | null;
  created_at: number;
  media_type: MediaType | null;
  media_url: string | null;
  media_mime: string | null;
  media_filename: string | null;
  transcription: string | null;
  duration_sec: number | null;
  wa_status: WaStatus | null;
}

// Palomita simple gris (✓): mensaje aceptado por servidores de Meta.
function CheckSingle({ className }: { className: string }) {
  return (
    <svg
      viewBox="0 0 16 15"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M10.91 3.316l-.478-.372a.365.365 0 0 0-.51.063L4.566 9.879a.32.32 0 0 1-.484.033L1.891 7.769a.366.366 0 0 0-.515.006l-.423.433a.364.364 0 0 0 .006.514l3.258 3.185c.143.14.361.125.484-.033l6.272-8.048a.365.365 0 0 0-.063-.51z"
        fill="currentColor"
      />
    </svg>
  );
}

// Doble palomita (✓✓): gris = entregado al dispositivo, azul = leído.
function CheckDouble({ className }: { className: string }) {
  return (
    <svg
      viewBox="0 0 16 15"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M15.01 3.316l-.478-.372a.365.365 0 0 0-.51.063L8.666 9.879a.32.32 0 0 1-.484.033l-.358-.325a.319.319 0 0 0-.484.032l-.378.483a.418.418 0 0 0 .036.541l1.32 1.266c.143.14.361.125.484-.033l6.272-8.048a.365.365 0 0 0-.063-.51zm-4.1 0l-.478-.372a.365.365 0 0 0-.51.063L4.566 9.879a.32.32 0 0 1-.484.033L1.891 7.769a.366.366 0 0 0-.515.006l-.423.433a.364.364 0 0 0 .006.514l3.258 3.185c.143.14.361.125.484-.033l6.272-8.048a.365.365 0 0 0-.063-.51z"
        fill="currentColor"
      />
    </svg>
  );
}

function StatusIcon({ status }: { status: WaStatus }) {
  if (status === "read") {
    return (
      <CheckDouble className="h-4 w-4 text-sky-500" />
    );
  }
  if (status === "delivered") {
    return <CheckDouble className="h-4 w-4 text-neutral-400" />;
  }
  // sent (failed se renderiza aparte con texto rojo)
  return <CheckSingle className="h-4 w-4 text-neutral-400" />;
}

function ChannelBadge({ channel }: { channel: Channel }) {
  const meta =
    channel === "messenger"
      ? { label: "Messenger", short: "M", className: "bg-sky-500 text-white" }
      : channel === "instagram"
        ? {
            label: "Instagram",
            short: "IG",
            className: "bg-rose-500 text-white",
          }
        : channel === "tiktok"
          ? {
              label: "TikTok",
              short: "TT",
              className: "bg-carbon-fuerte text-white",
            }
          : {
              label: "WhatsApp",
              short: "WA",
              className: "bg-emerald-500 text-white",
            };
  return (
    <span
      title={meta.label}
      className={`inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[8px] font-black leading-none ${meta.className}`}
    >
      {meta.short}
    </span>
  );
}

function formatTime(unix: number): string {
  const d = new Date(unix * 1000);
  return d.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
}

function formatDuration(sec: number | null): string | null {
  if (sec == null) return null;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Cuánto hay que mantener pulsada una burbuja para entrar en modo selección.
 *  600 ms es lo que usa WhatsApp: suficiente para no dispararse al hacer scroll
 *  y poco para no tener que esperar. */
const PULSACION_LARGA_MS = 600;
/** Si el dedo se mueve más que esto, era un scroll y no una pulsación. */
const TOLERANCIA_MOVIMIENTO_PX = 10;

export default function MessageBubble({
  message,
  channel = "whatsapp",
  customerView = false,
  onMediaLoad,
  modoSeleccion = false,
  seleccionado = false,
  onPulsacionLarga,
  onAlternarSeleccion,
  onResponder,
  onCopiar,
  onReenviar,
}: {
  message: MessageDTO;
  channel?: Channel;
  /** Vista del simulador: cliente a la derecha, bot a la izquierda. */
  customerView?: boolean;
  /** Se llama cuando una imagen termina de cargar (para re-ajustar el scroll). */
  onMediaLoad?: () => void;
  /** Modo selección activo: un toque marca/desmarca en vez de abrir la media. */
  modoSeleccion?: boolean;
  seleccionado?: boolean;
  /** Mantener pulsada la burbuja (o clic derecho) entra en modo selección. */
  onPulsacionLarga?: () => void;
  onAlternarSeleccion?: () => void;
  /** Menú de la flechita (solo escritorio): citar este mensaje al responder. */
  onResponder?: () => void;
  /** Copiar el texto de esta burbuja al portapapeles. */
  onCopiar?: () => void;
  /** Menú de la flechita: entrar en modo selección con este ya marcado. */
  onReenviar?: () => void;
}) {
  const [menuAbierto, setMenuAbierto] = useState(false);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origen = useRef<{ x: number; y: number } | null>(null);
  const huboPulsacionLarga = useRef(false);

  const cancelarTemporizador = () => {
    if (temporizador.current) {
      clearTimeout(temporizador.current);
      temporizador.current = null;
    }
  };

  const alBajar = (e: React.PointerEvent) => {
    if (!onPulsacionLarga || modoSeleccion) return;
    huboPulsacionLarga.current = false;
    origen.current = { x: e.clientX, y: e.clientY };
    cancelarTemporizador();
    temporizador.current = setTimeout(() => {
      huboPulsacionLarga.current = true;
      // Vibración corta como en WhatsApp, donde el navegador la permita.
      try {
        navigator.vibrate?.(15);
      } catch {
        // el navegador no la soporta; no pasa nada
      }
      onPulsacionLarga();
    }, PULSACION_LARGA_MS);
  };

  const alMover = (e: React.PointerEvent) => {
    if (!origen.current) return;
    const dx = Math.abs(e.clientX - origen.current.x);
    const dy = Math.abs(e.clientY - origen.current.y);
    if (dx > TOLERANCIA_MOVIMIENTO_PX || dy > TOLERANCIA_MOVIMIENTO_PX) {
      cancelarTemporizador();
    }
  };

  useEffect(() => cancelarTemporizador, []);

  // Un clic en cualquier otro sitio cierra el menú de la flechita.
  useEffect(() => {
    if (!menuAbierto) return;
    const cerrar = () => setMenuAbierto(false);
    document.addEventListener("click", cerrar);
    return () => document.removeEventListener("click", cerrar);
  }, [menuAbierto]);
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";
  const isHuman = message.role === "human";

  // Mensajes salientes (assistant/human) sin wa_message_id => no llegaron a
  // Meta (excepción al enviar). Si llegó a Meta pero después falló la
  // entrega, Meta nos manda status='failed' y lo guardamos en wa_status.
  const failed =
    !isUser &&
    (message.wa_message_id === null || message.wa_status === "failed");
  // Solo mostramos checks en salientes que sí tienen wamid y no fallaron.
  const showStatus = !isUser && !failed && message.wa_status !== null;

  const align = customerView
    ? isUser
      ? "items-end"
      : "items-start"
    : isUser
      ? "items-start"
      : "items-end";
  const bubble = [
    "relative max-w-[80%] rounded-2xl px-4 py-2 text-base md:text-sm leading-relaxed shadow-sm whitespace-pre-wrap break-words",
    isUser && (customerView ? "bg-emerald-100 text-emerald-950 border border-emerald-200 rounded-tr-sm" : "bg-tarjeta text-neutral-900 border border-neutral-200 rounded-tl-sm"),
    isAssistant && (customerView ? "bg-tarjeta text-neutral-900 border border-neutral-200 rounded-tl-sm" : "bg-emerald-100 text-emerald-950 rounded-tr-sm"),
    isHuman && "bg-amber-100 text-amber-950 rounded-tr-sm",
    failed && "ring-1 ring-red-400",
  ]
    .filter(Boolean)
    .join(" ");

  const label = isUser ? "Cliente" : isAssistant ? "IA" : "Operador";

  const isAudio = message.media_type === "audio";
  const isImage = message.media_type === "image";
  const isVideo = message.media_type === "video";
  const isDocument = message.media_type === "document";
  const duration = formatDuration(message.duration_sec);
  // Marca interna vs. pie de foto de verdad. Se pregunta por el ayudante y no
  // se compara a mano: cada sitio que comparaba conocía una sola de las dos
  // formas de la marca, y por eso "[image]" se colaba debajo de las imágenes.
  const pieDeFoto = pieDeFotoReal(message.content);
  const hasImageCaption = isImage && pieDeFoto.length > 0;
  const hasVideoCaption = isVideo && pieDeFoto.length > 0;
  const docFilename = message.media_filename || "Documento";
  const docCaption =
    isDocument && pieDeFoto && pieDeFoto !== docFilename ? pieDeFoto : null;

  return (
    <div
      className={`group relative flex flex-col gap-1 ${align} ${
        modoSeleccion ? "cursor-pointer select-none" : ""
      } ${
        // El sombreado gris del seleccionado es SOLO de celular; en escritorio
        // lo que marca la selección es la casilla, como en WhatsApp Web.
        seleccionado ? "rounded-lg bg-neutral-300/60 md:bg-transparent" : ""
      }`}
      onPointerDown={alBajar}
      onPointerMove={alMover}
      onPointerUp={cancelarTemporizador}
      onPointerCancel={cancelarTemporizador}
      onPointerLeave={cancelarTemporizador}
      onContextMenu={(e) => {
        // Clic derecho en el escritorio: mismo efecto que mantener pulsado.
        if (!onPulsacionLarga || modoSeleccion) return;
        e.preventDefault();
        onPulsacionLarga();
      }}
      onClickCapture={(e) => {
        // En modo selección el toque marca la burbuja; no abre la imagen ni
        // reproduce el audio. Y el clic que cierra una pulsación larga tampoco
        // debe llegar al contenido.
        if (modoSeleccion) {
          e.preventDefault();
          e.stopPropagation();
          onAlternarSeleccion?.();
          return;
        }
        if (huboPulsacionLarga.current) {
          e.preventDefault();
          e.stopPropagation();
          huboPulsacionLarga.current = false;
        }
      }}
    >
      {/* Casilla de selección: SOLO escritorio. En el celular lo que marca la
          burbuja es el sombreado gris. */}
      {modoSeleccion && (
        <span
          aria-hidden
          className={`absolute top-1/2 hidden h-5 w-5 -translate-y-1/2 items-center justify-center rounded border-2 md:flex ${
            isUser ? "-right-7" : "-left-7"
          } ${
            seleccionado
              ? "border-emerald-600 bg-emerald-600 text-white"
              : "border-neutral-400 bg-tarjeta"
          }`}
        >
          {seleccionado && <span className="text-xs leading-none">✓</span>}
        </span>
      )}

      <div className={bubble}>
        {/* Flechita de WhatsApp Web: invisible hasta que el ratón entra en la
            burbuja. No existe en el celular, donde se mantiene pulsado. */}
        {!modoSeleccion && (onResponder || onCopiar || onReenviar) && (
          <div className="absolute right-1 top-1 hidden md:block">
            <button
              type="button"
              aria-label="Opciones del mensaje"
              onClick={(e) => {
                e.stopPropagation();
                setMenuAbierto((v) => !v);
              }}
              className={`rounded p-0.5 leading-none text-neutral-500 opacity-0 transition-opacity hover:bg-black/5 group-hover:opacity-100 ${
                menuAbierto ? "opacity-100" : ""
              }`}
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path d="M5 7l5 6 5-6z" />
              </svg>
            </button>
            {menuAbierto && (
              <div
                onClick={(e) => e.stopPropagation()}
                className="absolute right-0 top-6 z-20 min-w-[9rem] overflow-hidden rounded-lg border border-neutral-200 bg-tarjeta py-1 shadow-lg"
              >
                {onResponder && (
                  <button
                    type="button"
                    onClick={() => {
                      setMenuAbierto(false);
                      onResponder();
                    }}
                    className="block w-full px-4 py-2 text-left text-sm text-neutral-800 hover:bg-neutral-100"
                  >
                    Responder
                  </button>
                )}
                {onCopiar && (
                  <button
                    type="button"
                    onClick={() => {
                      setMenuAbierto(false);
                      onCopiar();
                    }}
                    className="block w-full px-4 py-2 text-left text-sm text-neutral-800 hover:bg-neutral-100"
                  >
                    Copiar
                  </button>
                )}
                {onReenviar && (
                  <button
                    type="button"
                    onClick={() => {
                      setMenuAbierto(false);
                      onReenviar();
                    }}
                    className="block w-full px-4 py-2 text-left text-sm text-neutral-800 hover:bg-neutral-100"
                  >
                    Reenviar
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        {isAudio ? (
          <div className="flex flex-col gap-2">
            <audio
              controls
              preload="metadata"
              src={`/api/media/${message.id}`}
              className="w-full max-w-[260px]"
            />
            {message.transcription ? (
              <div className="border-t border-neutral-200/60 pt-2 text-base md:text-sm italic leading-relaxed text-neutral-700">
                <span className="mr-1">📝</span>
                {message.transcription}
              </div>
            ) : (
              <div className="border-t border-neutral-200/60 pt-2 text-base md:text-sm italic leading-relaxed text-neutral-400">
                Sin transcripción
              </div>
            )}
          </div>
        ) : isImage ? (
          <div className="flex flex-col gap-2">
            <a
              href={`/api/media/${message.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/media/${message.id}`}
                alt={hasImageCaption ? pieDeFoto : "Imagen"}
                loading="lazy"
                decoding="async"
                onLoad={onMediaLoad}
                className="max-h-80 w-auto max-w-full rounded-lg object-contain"
              />
            </a>
            {hasImageCaption && (
              <div className="text-base md:text-sm leading-relaxed">
                {renderWhatsAppFormat(pieDeFoto)}
              </div>
            )}
          </div>
        ) : isVideo ? (
          <div className="flex flex-col gap-2">
            <video
              controls
              preload="none"
              src={`/api/media/${message.id}`}
              className="max-h-80 w-full max-w-[320px] rounded-lg bg-black"
            />
            {hasVideoCaption && (
              <div className="text-base md:text-sm leading-relaxed">
                {renderWhatsAppFormat(pieDeFoto)}
              </div>
            )}
          </div>
        ) : isDocument ? (
          <div className="flex flex-col gap-2">
            <a
              href={`/api/media/${message.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 rounded-md border border-neutral-300 bg-white/60 px-3 py-2 text-neutral-900 hover:bg-tarjeta"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded bg-red-100 text-red-600">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="h-6 w-6"
                >
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" />
                  <path d="M14 2v6h6" fill="white" />
                  <text x="7.5" y="17" fontSize="6" fontWeight="bold" fill="white">PDF</text>
                </svg>
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-base md:text-sm font-medium">{docFilename}</div>
                <div className="text-xs text-neutral-500">Abrir documento</div>
              </div>
            </a>
            {docCaption && (
              <div className="text-base md:text-sm leading-relaxed">
                {renderWhatsAppFormat(docCaption)}
              </div>
            )}
          </div>
        ) : (
          renderWhatsAppFormat(message.content)
        )}
      </div>
      <div className="flex items-center gap-2 px-1 text-[11px] text-neutral-500">
        {isUser && <ChannelBadge channel={channel} />}
        <span>{label}</span>
        <span>·</span>
        <span>{formatTime(message.created_at)}</span>
        {duration && (
          <>
            <span>·</span>
            <span>{duration}</span>
          </>
        )}
        {showStatus && (
          <span
            className="flex items-center"
            title={
              message.wa_status === "read"
                ? "Leído"
                : message.wa_status === "delivered"
                ? "Entregado"
                : "Enviado"
            }
          >
            <StatusIcon status={message.wa_status as WaStatus} />
          </span>
        )}
        {failed && (
          <span className="flex items-center gap-1 text-red-600" title="No se pudo enviar a WhatsApp">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 16 16"
              fill="currentColor"
              className="h-3 w-3"
              aria-hidden="true"
            >
              <path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm.75 9.75a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm-.75-2.5a.75.75 0 0 1-.75-.75v-3.5a.75.75 0 0 1 1.5 0v3.5a.75.75 0 0 1-.75.75Z" />
            </svg>
            no enviado
          </span>
        )}
      </div>
    </div>
  );
}
