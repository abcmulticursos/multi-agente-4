"use client";

import { renderWhatsAppFormat } from "@/lib/whatsapp-format";

export type Role = "user" | "assistant" | "human";
export type MediaType = "audio" | "image" | "video" | "document";
export type WaStatus = "sent" | "delivered" | "read" | "failed";

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

export default function MessageBubble({ message }: { message: MessageDTO }) {
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

  const align = isUser ? "items-start" : "items-end";
  const bubble = [
    "max-w-[80%] rounded-2xl px-4 py-2 text-sm leading-relaxed shadow-sm whitespace-pre-wrap break-words",
    isUser && "bg-white text-neutral-900 border border-neutral-200 rounded-tl-sm",
    isAssistant && "bg-emerald-100 text-emerald-950 rounded-tr-sm",
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
  const hasImageCaption =
    isImage && message.content && message.content !== "[imagen]";
  const hasVideoCaption =
    isVideo && message.content && message.content !== "[video]";
  const docFilename = message.media_filename || "Documento";
  const docCaption =
    isDocument &&
    message.content &&
    message.content !== "[documento]" &&
    message.content !== docFilename
      ? message.content
      : null;

  return (
    <div className={`flex flex-col gap-1 ${align}`}>
      <div className={bubble}>
        {isAudio ? (
          <div className="flex flex-col gap-2">
            <audio
              controls
              preload="metadata"
              src={`/api/media/${message.id}`}
              className="w-full max-w-[260px]"
            />
            {message.transcription ? (
              <div className="border-t border-neutral-200/60 pt-2 text-sm italic leading-relaxed text-neutral-700">
                <span className="mr-1">📝</span>
                {message.transcription}
              </div>
            ) : (
              <div className="border-t border-neutral-200/60 pt-2 text-sm italic leading-relaxed text-neutral-400">
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
                alt={hasImageCaption ? message.content : "Imagen"}
                className="max-h-80 w-auto max-w-full rounded-lg object-contain"
              />
            </a>
            {hasImageCaption && (
              <div className="text-sm leading-relaxed">
                {renderWhatsAppFormat(message.content)}
              </div>
            )}
          </div>
        ) : isVideo ? (
          <div className="flex flex-col gap-2">
            <video
              controls
              preload="metadata"
              src={`/api/media/${message.id}`}
              className="max-h-80 w-full max-w-[320px] rounded-lg bg-black"
            />
            {hasVideoCaption && (
              <div className="text-sm leading-relaxed">
                {renderWhatsAppFormat(message.content)}
              </div>
            )}
          </div>
        ) : isDocument ? (
          <div className="flex flex-col gap-2">
            <a
              href={`/api/media/${message.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 rounded-md border border-neutral-300 bg-white/60 px-3 py-2 text-neutral-900 hover:bg-white"
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
                <div className="truncate text-sm font-medium">{docFilename}</div>
                <div className="text-xs text-neutral-500">Abrir documento</div>
              </div>
            </a>
            {docCaption && (
              <div className="text-sm leading-relaxed">
                {renderWhatsAppFormat(docCaption)}
              </div>
            )}
          </div>
        ) : (
          renderWhatsAppFormat(message.content)
        )}
      </div>
      <div className="flex items-center gap-2 px-1 text-[11px] text-neutral-500">
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
