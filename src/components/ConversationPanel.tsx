"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import MessageBubble, {
  type Channel,
  type MessageDTO,
} from "@/components/MessageBubble";
import ModeToggle from "@/components/ModeToggle";
import QuickReplies, { type QuickReplyDTO } from "@/components/QuickReplies";
import EmojiPicker from "@/components/EmojiPicker";
import ForwardPicker from "@/components/ForwardPicker";
import { renderWhatsAppFormat } from "@/lib/whatsapp-format";
import { marcadoDesdeSeleccion } from "@/lib/copiar-con-formato";
import {
  ETIQUETA_DE_ORIGEN,
  EXPLICACION_DE_ORIGEN,
  origenDeLead,
} from "@/lib/origen-de-lead";
import type { ExplicacionDeError } from "@/lib/meta/errores-capi";
import { pieDeFotoReal, marcaDeAdjunto } from "@/lib/marca-de-adjunto";

type Mode = "AI" | "HUMAN";
type RecState = "idle" | "recording" | "paused" | "uploading";
type AttachKind = "video" | "image" | "audio" | "document";

interface PendingAttachment {
  file: File;
  kind: AttachKind;
  url: string;
}

const ATTACH_SIZE_LIMITS: Record<AttachKind, number> = {
  video: 16 * 1024 * 1024,
  image: 5 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
  document: 100 * 1024 * 1024,
};

function detectAttachKind(file: File): AttachKind | null {
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();

  if (type.startsWith("video/")) return "video";
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("audio/")) return "audio";
  if (type === "application/pdf") return "document";

  // Fallback por extensión cuando el navegador no rellena `file.type`
  // (típico al pegar archivos copiados desde el Explorador de Windows).
  if (/\.(mp4|mov|webm|mkv|avi|3gp|m4v)$/i.test(name)) return "video";
  if (/\.(jpe?g|png|gif|webp|heic|heif|bmp)$/i.test(name)) return "image";
  if (/\.(mp3|wav|ogg|m4a|aac|flac|opus)$/i.test(name)) return "audio";
  if (/\.pdf$/i.test(name)) return "document";

  return null;
}

function attachLabel(kind: AttachKind): string {
  if (kind === "video") return "video";
  if (kind === "image") return "imagen";
  if (kind === "document") return "documento";
  return "audio";
}

// ──── Separador de fecha estilo WhatsApp ──────────────────────────────────
// Hoy / Ayer / dia-de-semana / fecha completa. Se renderiza entre mensajes
// cuando cambia el dia.

function getDayKey(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function formatDateDivider(unixSec: number): string {
  const date = new Date(unixSec * 1000);
  const now = new Date();
  const dateStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const nowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round(
    (nowStart.getTime() - dateStart.getTime()) / (1000 * 60 * 60 * 24)
  );
  if (diffDays === 0) return "hoy";
  if (diffDays === 1) return "ayer";
  if (diffDays > 1 && diffDays < 7) {
    return date.toLocaleDateString("es-PE", { weekday: "long" });
  }
  return date.toLocaleDateString("es-PE", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function DateDivider({ timestamp }: { timestamp: number }) {
  return (
    <div className="my-2 flex justify-center">
      <span className="rounded-full bg-neutral-200/80 px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-neutral-600 shadow-sm">
        {formatDateDivider(timestamp)}
      </span>
    </div>
  );
}

function pickRecorderMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/ogg;codecs=opus",
    "audio/webm",
    "audio/mp4",
  ];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return "";
}

function formatRecTime(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function extFromBlobType(type: string): string {
  const t = type.toLowerCase();
  if (t.includes("ogg")) return "ogg";
  if (t.includes("mp4")) return "m4a";
  return "webm";
}

interface ConversationDTO {
  id: number;
  phone: string;
  channel: Channel;
  name: string | null;
  mode: Mode;
  last_message_at: number | null;
  created_at: number;
  pinned: number;
  ad_source_id: string | null;
  ad_headline: string | null;
  ad_source_url: string | null;
  // Hacen falta para saber si la conversación es orgánica: una puede traer el
  // click del anuncio sin que se haya resuelto todavía QUÉ anuncio fue. La API
  // ya los manda; solo faltaba declararlos aquí.
  ctwa_clid: string | null;
  lead_origin: string | null;
  /** 0 = el último evento mandado a Meta no llegó. */
  capi_last_ok: number | null;
  capi_last_event: string | null;
  // A DÓNDE fue ese evento. Se enseña cuando SÍ se envió, que es el caso que
  // antes no decía nada: un pixel equivocado no da error, así que el panel
  // ponía «enviado» y la compra caía en el conjunto de datos de al lado.
  capi_last_pixel: string | null;
  capi_last_pagina: string | null;
  capi_last_tienda: string | null;
}

interface Props {
  conversationId: number;
  onDeleted: () => void;
  /** Volver a la lista. Solo se usa en móvil, donde no caben las dos a la vez. */
  onBack?: () => void;
}

interface FetchState {
  conversation: ConversationDTO | null;
  messages: MessageDTO[];
  /** Botones que salieron con cada mensaje del bot, por id de mensaje. */
  buttons?: Record<string, { id: string; title: string }[]>;
}

/**
 * Lo último que se vio de cada conversación.
 *
 * Al volver a abrir un chat se pinta al instante desde aquí y se refresca por
 * detrás. En el celular entras y sales de las conversaciones todo el rato, y
 * esperar el "Cargando conversación…" cada vez se hacía eterno.
 *
 * Vive en memoria del navegador: al recargar la página se vacía, que es justo
 * lo que se quiere — nunca muestra algo viejo tras un refresco.
 */
const memoriaDeConversaciones = new Map<number, FetchState>();

/** Cuántos mensajes se dibujan de entrada, y cuántos se suman al pedir más. */
const PASO_MENSAJES = 40;

/**
 * A cuántos píxeles del final se considera que "estás abajo".
 *
 * No se exige llegar al píxel exacto: al escribir, el teclado y los rebotes
 * del móvil dejan la vista a unos pocos píxeles del fondo, y con un margen
 * cerrado el chat dejaría de seguir la conversación sin motivo.
 */
const UMBRAL_ABAJO = 120;

interface AdOriginInfo {
  adId: string;
  adName: string;
  campaignId: string;
  campaignName: string;
  adAccountId: string;
  adAccountName: string;
  businessId: string;
  businessName: string;
  readerName: string;
}

function formatPhone(phone: string): string {
  if (phone.startsWith("messenger:")) return `Messenger ${phone.slice("messenger:".length)}`;
  if (phone.startsWith("instagram:")) return `Instagram ${phone.slice("instagram:".length)}`;
  return phone.startsWith("+") ? phone : `+${phone}`;
}

function ChannelBadge({ channel }: { channel: Channel }) {
  const meta =
    channel === "messenger"
      ? { label: "Messenger", short: "M", className: "bg-sky-500 text-white" }
      : channel === "instagram"
        ? { label: "Instagram", short: "IG", className: "bg-rose-500 text-white" }
        : channel === "tiktok"
          ? { label: "TikTok", short: "TT", className: "bg-carbon-fuerte text-white" }
          : { label: "WhatsApp", short: "WA", className: "bg-emerald-500 text-white" };
  return (
    <span
      title={meta.label}
      className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[9px] font-black leading-none ${meta.className}`}
    >
      {meta.short}
    </span>
  );
}

export default function ConversationPanel({
  conversationId,
  onDeleted,
  onBack,
}: Props) {
  const [state, setState] = useState<FetchState>(
    () =>
      memoriaDeConversaciones.get(conversationId) ?? {
        conversation: null,
        messages: [],
        buttons: {},
      }
  );
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [adOrigin, setAdOrigin] = useState<AdOriginInfo | null>(null);
  const [adOriginLoading, setAdOriginLoading] = useState(false);
  // El aviso de que un evento no llegó a Meta. Se abre solo si lo pides.
  const [avisoCapi, setAvisoCapi] = useState<{
    evento: string | null;
    error: string | null;
    explicacion: ExplicacionDeError | null;
  } | null>(null);
  const [reintentandoCapi, setReintentandoCapi] = useState(false);

  async function abrirAvisoCapi() {
    try {
      const res = await fetch(`/api/meta/capi-estado/${conversationId}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = await res.json();
      setAvisoCapi({
        evento: data.evento ?? null,
        error: data.error ?? null,
        explicacion: data.explicacion ?? null,
      });
    } catch {
      // Si no se puede leer el detalle, no se abre nada y el aviso sigue ahí.
    }
  }

  async function reintentarCapi() {
    setReintentandoCapi(true);
    try {
      const res = await fetch(`/api/meta/capi-estado/${conversationId}`, {
        method: "POST",
      });
      const data = await res.json();
      if (data.ok) {
        setAvisoCapi(null);
        alert("Meta lo aceptó. La conversación deja de estar marcada.");
        return;
      }
      setAvisoCapi({
        evento: data.evento ?? null,
        error: data.error ?? "No se pudo reintentar.",
        explicacion: data.explicacion ?? null,
      });
    } finally {
      setReintentandoCapi(false);
    }
  }
  const [adOriginRefresh, setAdOriginRefresh] = useState(0);
  const [sendError, setSendError] = useState<string | null>(null);
  /** Menú de los tres puntos de la conversación. Solo existe en el celular. */
  const [menuChatAbierto, setMenuChatAbierto] = useState(false);
  /** Llegó algo mientras leías más arriba y el chat no se movió. */
  const [hayNuevosAbajo, setHayNuevosAbajo] = useState(false);
  /**
   * Cuántos mensajes se dibujan. Se empieza por los últimos y los anteriores se
   * traen a pedido: pintar los 200 de golpe hacía que la conversación tardara
   * en aparecer en el celular.
   */
  const [visibles, setVisibles] = useState(PASO_MENSAJES);
  /**
   * REENVIAR Y COPIAR. `null` = modo normal. Una lista (aunque esté vacía) =
   * modo selección: la cabecera cambia y un toque marca en vez de abrir la
   * media. Se entra manteniendo pulsada una burbuja, como en WhatsApp.
   */
  const [seleccion, setSeleccion] = useState<number[] | null>(null);
  const [mostrarReenvio, setMostrarReenvio] = useState(false);
  const [avisoReenvio, setAvisoReenvio] = useState<string | null>(null);
  const [reenviando, setReenviando] = useState(false);
  /** Mensaje que se está citando. Va como `context` a WhatsApp, así que el
   *  cliente ve la burbuja citada arriba, no es un adorno del panel. */
  const [respondiendoA, setRespondiendoA] = useState<MessageDTO | null>(null);
  /** Respuesta rápida CON adjunto esperando en el cajón. El texto se edita en
   *  el cuadro de siempre; el archivo va enganchado hasta que se envía. */
  const [respuestaPreparada, setRespuestaPreparada] =
    useState<QuickReplyDTO | null>(null);
  const [quickReplies, setQuickReplies] = useState<QuickReplyDTO[]>([]);
  const [slashOpen, setSlashOpen] = useState(false);
  const [isBlocked, setIsBlocked] = useState(false);
  const [blockBusy, setBlockBusy] = useState(false);
  const [is24hWindow, setIs24hWindow] = useState(false);
  /**
   * ¿ESTA CONVERSACIÓN YA PASÓ DE LAS 70 HORAS?
   *
   * Se cuenta desde que NACIÓ, igual que lo cuenta el motor —ver
   * `pasoLaVentanaDeRespuesta` en `handler.ts`—, para que la pantalla y el bot no digan
   * cosas distintas. Si uno cambia el número, el otro tiene que cambiarlo también.
   *
   * Se recalcula en cada pintado y no con un reloj aparte: el panel ya se refresca solo, y
   * un temporizador más es una pieza que se puede quedar colgada.
   */
  const pasoLasSetentaHoras = (() => {
    const nacio = state.conversation?.created_at;
    if (typeof nacio !== "number" || !(nacio > 0)) return false;
    return Date.now() / 1000 - nacio >= 70 * 3600;
  })();
  const [recState, setRecState] = useState<RecState>("idle");
  const [recDurationMs, setRecDurationMs] = useState(0);
  const [pending, setPending] = useState<PendingAttachment | null>(null);
  const [attachCaption, setAttachCaption] = useState("");
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const attachInputRef = useRef<HTMLInputElement | null>(null);
  const messageTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const attachCaptionRef = useRef<HTMLTextAreaElement | null>(null);
  const dragDepthRef = useRef<number>(0);
  const sendAttachmentRef = useRef<() => void>(() => {});
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lastSeenIdRef = useRef<number | null>(null);
  const markedReadCountRef = useRef<number>(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const segmentStartRef = useRef<number>(0);
  const accumulatedRef = useRef<number>(0);
  const cancelledRef = useRef<boolean>(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const vizFrameRef = useRef<number | null>(null);
  const vizBufferRef = useRef<number[]>([]);
  const vizLastSampleRef = useRef<number>(0);
  const vizCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const forceAdOriginRefreshRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      try {
        // Con la pestaña oculta —cambiaste de app, bloqueaste el celular— no
        // se pide nada: nadie lo está mirando y el servidor tiene mejores
        // cosas que hacer. Al volver se refresca solo en 2 segundos.
        if (typeof document !== "undefined" && document.hidden) return;
        const res = await fetch(`/api/messages/${conversationId}`, {
          cache: "no-store",
        });
        if (!res.ok) {
          if (res.status === 404) {
            onDeleted();
            return;
          }
          throw new Error(`status ${res.status}`);
        }
        const data = (await res.json()) as FetchState;
        if (cancelled) return;
        memoriaDeConversaciones.set(conversationId, data);
        setState(data);
      } catch (err) {
        console.error("[panel] error refrescando", err);
      } finally {
        if (!cancelled) timer = setTimeout(tick, 2000);
      }
    }

    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [conversationId, onDeleted]);

  const adSourceId = state.conversation?.ad_source_id ?? "";
  useEffect(() => {
    if (!adSourceId) {
      setAdOrigin(null);
      setAdOriginLoading(false);
      return;
    }

    let cancelled = false;
    const refresh = forceAdOriginRefreshRef.current === adSourceId;
    forceAdOriginRefreshRef.current = null;
    setAdOrigin(null);
    setAdOriginLoading(true);
    void fetch("/api/meta/ads-readers/origin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adId: adSourceId, refresh }),
    })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as AdOriginInfo;
      })
      .then((origin) => {
        if (!cancelled) setAdOrigin(origin);
      })
      .catch(() => {
        if (!cancelled) setAdOrigin(null);
      })
      .finally(() => {
        if (!cancelled) setAdOriginLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [adSourceId, adOriginRefresh]);

  function refreshAdOrigin() {
    if (!adSourceId) return;
    forceAdOriginRefreshRef.current = adSourceId;
    setAdOriginRefresh((current) => current + 1);
  }

  async function loadQuickReplies() {
    try {
      const res = await fetch("/api/quick-replies", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as { quickReplies: QuickReplyDTO[] };
        setQuickReplies(data.quickReplies);
      }
    } catch {
      // silencioso — las respuestas rápidas son opcionales
    }
  }

  /**
   * Envía una respuesta rápida: su texto y, si lo tiene, su adjunto. El archivo
   * ya está guardado en el servidor desde que se creó la respuesta, así que
   * aquí solo se le pide que la mande — no se vuelve a subir nada.
   */
  /**
   * Elegir una respuesta rápida ya NO la manda: deja su texto en el cajón para
   * poder leerlo o retocarlo antes de enviar. Si además lleva un adjunto, se
   * queda enganchado y sale junto al texto al pulsar enviar.
   */
  function prepararRespuestaRapida(reply: QuickReplyDTO) {
    setDraft(reply.content);
    // Solo hace falta recordarla si trae archivo: el texto suelto se manda por
    // el camino normal, sin pasar por el endpoint de respuestas rápidas.
    setRespuestaPreparada(reply.media_type ? reply : null);
    setSendError(null);
    requestAnimationFrame(() => {
      const ta = messageTextareaRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(reply.content.length, reply.content.length);
    });
  }

  // Inserta texto (ej. un emoji) en la posición del cursor del textarea.
  // Si no hay textarea montado, hace fallback a append.
  function insertAtCursor(text: string) {
    const ta = messageTextareaRef.current;
    if (!ta) {
      setDraft((d) => d + text);
      return;
    }
    const start = ta.selectionStart ?? draft.length;
    const end = ta.selectionEnd ?? draft.length;
    const next = draft.slice(0, start) + text + draft.slice(end);
    setDraft(next);
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + text.length;
      ta.setSelectionRange(pos, pos);
    });
  }

  // Misma logica que insertAtCursor pero para el caption del adjunto.
  function insertAtAttachCursor(text: string) {
    const ta = attachCaptionRef.current;
    if (!ta) {
      setAttachCaption((c) => c + text);
      return;
    }
    const start = ta.selectionStart ?? attachCaption.length;
    const end = ta.selectionEnd ?? attachCaption.length;
    const next = attachCaption.slice(0, start) + text + attachCaption.slice(end);
    setAttachCaption(next);
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + text.length;
      ta.setSelectionRange(pos, pos);
    });
  }

  useEffect(() => {
    loadQuickReplies();
  }, []);

  // Chequea si el número de esta conversación está en la blacklist.
  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const res = await fetch("/api/blocked-numbers", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as {
          blocked: { phone: string }[];
        };
        const phone = state.conversation?.phone;
        if (!cancelled && phone) {
          setIsBlocked(data.blocked.some((b) => b.phone === phone));
        }
      } catch {
        // silencioso
      }
    }
    check();
    return () => {
      cancelled = true;
    };
  }, [state.conversation?.phone]);

  async function togglePin() {
    const convo = state.conversation;
    if (!convo) return;
    const nextPinned = convo.pinned !== 1;
    // Optimista.
    setState((s) =>
      s.conversation
        ? {
            ...s,
            conversation: { ...s.conversation, pinned: nextPinned ? 1 : 0 },
          }
        : s
    );
    try {
      await fetch(`/api/conversations/${conversationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned: nextPinned }),
      });
    } catch {
      // el polling corrige
    }
  }

  async function toggleBlock() {
    const phone = state.conversation?.phone;
    if (!phone || blockBusy) return;
    if (isBlocked) {
      if (!window.confirm("¿Desbloquear este número? Volverá a recibir respuestas del bot.")) {
        return;
      }
    } else {
      if (
        !window.confirm(
          "¿Bloquear este número? El bot ignorará todos sus mensajes entrantes (no los guarda ni responde). Podés desbloquearlo cuando quieras."
        )
      ) {
        return;
      }
    }
    setBlockBusy(true);
    try {
      if (isBlocked) {
        const res = await fetch(`/api/blocked-numbers/${phone}`, {
          method: "DELETE",
        });
        if (res.ok) setIsBlocked(false);
      } else {
        const res = await fetch("/api/blocked-numbers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone }),
        });
        if (res.ok) setIsBlocked(true);
      }
    } finally {
      setBlockBusy(false);
    }
  }

  // Atajo "/": si el draft empieza con "/" mostramos las respuestas
  // rápidas que matcheen el atajo escrito después de la barra.
  const slashQuery = draft.startsWith("/") ? draft.slice(1).toLowerCase() : null;
  const slashMatches =
    slashQuery !== null
      ? quickReplies.filter((r) => {
          if (!r.shortcut) return false;
          return r.shortcut.toLowerCase().startsWith(slashQuery);
        })
      : [];

  useEffect(() => {
    setSlashOpen(slashQuery !== null && slashMatches.length > 0);
  }, [slashQuery, slashMatches.length]);

  // Marca la conversación como leída: al abrirla (0 → N mensajes) y cada
  // vez que llega un mensaje nuevo mientras la estás mirando.
  useEffect(() => {
    const count = state.messages.length;
    if (count > 0 && count !== markedReadCountRef.current) {
      markedReadCountRef.current = count;
      fetch(`/api/conversations/${conversationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ read: true }),
      }).catch(() => {
        // el polling de la lista corrige si falló
      });
    }
  }, [state.messages.length, conversationId]);

  useEffect(() => {
    const last = state.messages[state.messages.length - 1];
    if (!last) return;
    if (lastSeenIdRef.current !== last.id) {
      // Primera carga del chat (lastSeenIdRef arranca en null): salto
      // instantáneo al final, sin animación — así el chat aparece ya
      // abajo y no se ve el "viaje" desde el primer mensaje.
      const isFirstLoad = lastSeenIdRef.current === null;
      lastSeenIdRef.current = last.id;

      // SOLO SE BAJA SI YA ESTABAS ABAJO. Si subiste a leer algo anterior, un
      // mensaje nuevo —de la clienta o del bot— te arrancaba de donde estabas
      // y tocaba volver a subir a mano. Igual que WhatsApp Web: si estás
      // leyendo arriba, no se mueve; aparece el aviso de mensajes nuevos.
      const caja = scrollRef.current;
      const alFinal =
        !caja ||
        caja.scrollHeight - caja.scrollTop - caja.clientHeight < UMBRAL_ABAJO;
      if (!isFirstLoad && !alFinal) {
        setHayNuevosAbajo(true);
        return;
      }
      setHayNuevosAbajo(false);
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({
          top: scrollRef.current.scrollHeight,
          behavior: isFirstLoad ? "auto" : "smooth",
        });
      });
    }
  }, [state.messages]);

  // Escape cancela: primero la cita, y si no hay cita, la selección. Es el
  // orden que espera cualquiera — se deshace lo último que hiciste.
  useEffect(() => {
    function alPulsar(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (respondiendoA) {
        setRespondiendoA(null);
        return;
      }
      if (seleccion !== null) {
        setSeleccion(null);
        setMostrarReenvio(false);
      }
    }
    document.addEventListener("keydown", alPulsar);
    return () => document.removeEventListener("keydown", alPulsar);
  }, [respondiendoA, seleccion]);

  /** Marca o desmarca una burbuja. Al desmarcar la última se sale del modo
   *  selección, como en WhatsApp. */
  function alternarSeleccion(id: number) {
    setSeleccion((actual) => {
      if (actual === null) return [id];
      const ya = actual.includes(id);
      const siguiente = ya
        ? actual.filter((x) => x !== id)
        : [...actual, id];
      return siguiente.length === 0 ? null : siguiente;
    });
  }

  /** El texto de una burbuja tal como se ve. De un audio se copia su
   *  transcripción, que es lo único que se puede pegar en otro sitio. */
  function textoDeMensaje(m: MessageDTO): string {
    if (m.media_type === "audio") return m.transcription?.trim() || "";
    // Antes se descartaba CUALQUIER texto entre corchetes. Un pie de foto que
    // fuera "[OFERTA]" desaparecía sin motivo: se compara contra las marcas
    // conocidas y no contra una forma.
    return pieDeFotoReal(m.content);
  }

  /** Manda el texto al portapapeles y avisa. Lo usan la barra de selección y
   *  el «Copiar» del menú de una burbuja suelta, para que se comporten igual. */
  async function alPortapapeles(texto: string, siVacio: string) {
    if (!texto) {
      setAvisoReenvio(siVacio);
      window.setTimeout(() => setAvisoReenvio(null), 4000);
      return false;
    }
    try {
      await navigator.clipboard.writeText(texto);
      setAvisoReenvio("Copiado.");
      window.setTimeout(() => setAvisoReenvio(null), 4000);
      return true;
    } catch {
      // Safari y algunos navegadores bloquean el portapapeles sin HTTPS.
      setAvisoReenvio("El navegador no dejó copiar. Prueba con HTTPS.");
      window.setTimeout(() => setAvisoReenvio(null), 4000);
      return false;
    }
  }

  /** «Copiar» del menú de la flechita, sobre una sola burbuja. */
  async function copiarMensaje(m: MessageDTO) {
    await alPortapapeles(
      textoDeMensaje(m),
      m.media_type === "audio"
        ? "Ese audio no tiene transcripción que copiar."
        : "Esa burbuja no tiene texto que copiar."
    );
  }

  async function copiarSeleccion() {
    if (!seleccion || seleccion.length === 0) return;
    const orden = new Set(seleccion);
    const texto = state.messages
      .filter((m) => orden.has(m.id))
      .map(textoDeMensaje)
      .filter(Boolean)
      .join("\n\n");
    const copiado = await alPortapapeles(
      texto,
      "No hay texto que copiar en lo que seleccionaste."
    );
    if (copiado) setSeleccion(null);
  }

  async function reenviarA(destinoId: number, nombre: string) {
    if (!seleccion || seleccion.length === 0) return;
    setMostrarReenvio(false);
    setReenviando(true);
    setAvisoReenvio(`Reenviando a ${nombre}…`);
    try {
      const res = await fetch(`/api/messages/${destinoId}/forward`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageIds: seleccion }),
      });
      const data = await res.json().catch(() => ({}));
      const enviados = Number(data?.enviados ?? 0);
      const fallidos = Array.isArray(data?.fallidos) ? data.fallidos.length : 0;
      if (enviados > 0 && fallidos === 0) {
        setAvisoReenvio(`Reenviado a ${nombre}.`);
        setSeleccion(null);
      } else if (enviados > 0) {
        setAvisoReenvio(
          `Se reenviaron ${enviados}, pero ${fallidos} no salieron. Revisa si la conversación pasó de 24 horas.`
        );
      } else {
        setAvisoReenvio(
          data?.error
            ? `No se pudo reenviar: ${data.error}`
            : "No se pudo reenviar. Puede que la conversación esté fuera de la ventana de 24 horas."
        );
      }
    } catch {
      setAvisoReenvio("No se pudo reenviar: falló la conexión.");
    } finally {
      setReenviando(false);
      window.setTimeout(() => setAvisoReenvio(null), 8000);
    }
  }

  /** Baja del todo y quita el aviso. Lo usa el botón de mensajes nuevos. */
  function bajarAlFinal() {
    setHayNuevosAbajo(false);
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }

  async function handleDelete() {
    if (!state.conversation) return;
    const ok = window.confirm(
      `¿Borrar la conversación con ${
        state.conversation.name?.trim() || formatPhone(state.conversation.phone)
      }? Esta acción no se puede deshacer.`
    );
    if (!ok) return;
    const res = await fetch(`/api/conversations/${conversationId}`, {
      method: "DELETE",
    });
    if (res.ok) onDeleted();
    else alert("No se pudo borrar la conversación.");
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    // Con un adjunto enganchado el texto puede ir vacío: se manda solo el
    // archivo, igual que en WhatsApp.
    if ((!text && !respuestaPreparada) || sending) return;
    setSending(true);
    setSendError(null);
    setIs24hWindow(false);
    try {
      // Con adjunto va por el endpoint de respuestas rápidas, que sabe subir el
      // archivo; el texto que mandamos es el YA EDITADO, no el guardado.
      const res = respuestaPreparada
        ? await fetch(`/api/messages/${conversationId}/quick-reply`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              quickReplyId: respuestaPreparada.id,
              content: text,
            }),
          })
        : await fetch(`/api/messages/${conversationId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              content: text,
              ...(respondiendoA ? { replyTo: respondiendoA.id } : {}),
            }),
          });
      const data = (await res.json()) as {
        ok: boolean;
        error?: string;
        code?: number | null;
      };
      if (!res.ok || !data.ok) {
        if (data.code === 131047) {
          setIs24hWindow(true);
          setSendError(
            "Fuera de la ventana de 24h. WhatsApp solo permite texto libre dentro de las 24h del último mensaje del cliente. Necesitas usar plantillas preaprobadas."
          );
        } else {
          setSendError(data.error ?? "No se pudo enviar el mensaje.");
        }
      } else {
        setDraft("");
        setRespondiendoA(null);
        setRespuestaPreparada(null);
      }
    } catch (err) {
      setSendError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  function handleModeChanged(next: Mode) {
    setState((s) =>
      s.conversation ? { ...s, conversation: { ...s.conversation, mode: next } } : s
    );
    if (next === "AI") {
      setSendError(null);
      setIs24hWindow(false);
      if (recState !== "idle") cancelRecording();
    }
  }

  function startTimer() {
    segmentStartRef.current = Date.now();
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setRecDurationMs(
        accumulatedRef.current + (Date.now() - segmentStartRef.current)
      );
    }, 200);
  }

  function stopTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  function releaseStream() {
    const stream = streamRef.current;
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
    }
    streamRef.current = null;
  }

  const VIZ_BAR_COUNT = 40;
  const VIZ_SAMPLE_INTERVAL_MS = 50;

  function drawVisualizer() {
    const canvas = vizCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#10b981";

    const total = 8;
    const barW = 4;
    const buf = vizBufferRef.current;
    const startX = w - buf.length * total;
    for (let i = 0; i < buf.length; i++) {
      const v = buf[i];
      const barHeight = Math.max(4, v * (h - 8));
      const x = startX + i * total;
      const y = (h - barHeight) / 2;
      ctx.fillRect(x, y, barW, barHeight);
    }
  }

  function startVisualizerLoop() {
    if (vizFrameRef.current) cancelAnimationFrame(vizFrameRef.current);
    const loop = () => {
      vizFrameRef.current = requestAnimationFrame(loop);
      const analyser = analyserRef.current;
      if (!analyser) return;
      const now = Date.now();
      if (now - vizLastSampleRef.current >= VIZ_SAMPLE_INTERVAL_MS) {
        vizLastSampleRef.current = now;
        const data = new Uint8Array(analyser.fftSize);
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const norm = (data[i] - 128) / 128;
          sum += norm * norm;
        }
        const rms = Math.sqrt(sum / data.length);
        const buf = vizBufferRef.current;
        buf.push(Math.min(1, rms * 3));
        if (buf.length > VIZ_BAR_COUNT) buf.shift();
      }
      drawVisualizer();
    };
    vizFrameRef.current = requestAnimationFrame(loop);
  }

  function stopVisualizerLoop() {
    if (vizFrameRef.current) {
      cancelAnimationFrame(vizFrameRef.current);
      vizFrameRef.current = null;
    }
  }

  function setupAnalyser(stream: MediaStream) {
    type AudioCtxCtor = typeof AudioContext;
    const w = window as unknown as {
      AudioContext?: AudioCtxCtor;
      webkitAudioContext?: AudioCtxCtor;
    };
    const Ctor = w.AudioContext ?? w.webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    audioCtxRef.current = ctx;
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    analyserRef.current = analyser;
    vizBufferRef.current = new Array(VIZ_BAR_COUNT).fill(0);
    vizLastSampleRef.current = Date.now();
    startVisualizerLoop();
  }

  function teardownAnalyser() {
    stopVisualizerLoop();
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
    vizBufferRef.current = [];
    const canvas = vizCanvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  function resetRecorderState() {
    stopTimer();
    teardownAnalyser();
    releaseStream();
    recorderRef.current = null;
    chunksRef.current = [];
    accumulatedRef.current = 0;
    cancelledRef.current = false;
    setRecDurationMs(0);
  }

  async function startRecording() {
    if (!isHumanMode || sending || isOutside24hWindow) return;
    setSendError(null);
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices ||
      typeof MediaRecorder === "undefined"
    ) {
      setSendError("Tu navegador no soporta grabación de audio.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = pickRecorderMime();
      const recorder = new MediaRecorder(
        stream,
        mime ? { mimeType: mime } : undefined
      );
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorderRef.current = recorder;
      accumulatedRef.current = 0;
      cancelledRef.current = false;
      recorder.start();
      startTimer();
      setupAnalyser(stream);
      setRecState("recording");
    } catch {
      setSendError(
        "No se pudo acceder al micrófono. ¿Permitiste el acceso en el navegador?"
      );
      releaseStream();
    }
  }

  function pauseRecording() {
    const r = recorderRef.current;
    if (!r || r.state !== "recording") return;
    try {
      r.pause();
    } catch {
      return;
    }
    accumulatedRef.current += Date.now() - segmentStartRef.current;
    stopTimer();
    stopVisualizerLoop();
    setRecDurationMs(accumulatedRef.current);
    setRecState("paused");
  }

  function resumeRecording() {
    const r = recorderRef.current;
    if (!r || r.state !== "paused") return;
    try {
      r.resume();
    } catch {
      return;
    }
    startTimer();
    startVisualizerLoop();
    setRecState("recording");
  }

  function cancelRecording() {
    cancelledRef.current = true;
    const r = recorderRef.current;
    if (r && r.state !== "inactive") {
      try {
        r.stop();
      } catch {
        // ignore
      }
    }
    resetRecorderState();
    setRecState("idle");
  }

  async function sendRecording() {
    const r = recorderRef.current;
    if (!r) return;
    if (r.state === "recording") {
      accumulatedRef.current += Date.now() - segmentStartRef.current;
    }
    stopTimer();
    const finalDurationMs = accumulatedRef.current;
    const finalDurationSec = Math.max(1, Math.round(finalDurationMs / 1000));

    setRecState("uploading");

    let blob: Blob;
    try {
      blob = await new Promise<Blob>((resolve, reject) => {
        r.onstop = () => {
          const type = r.mimeType || "audio/webm";
          resolve(new Blob(chunksRef.current, { type }));
        };
        r.onerror = () => reject(new Error("recorder error"));
        try {
          if (r.state !== "inactive") r.stop();
          else
            resolve(
              new Blob(chunksRef.current, {
                type: r.mimeType || "audio/webm",
              })
            );
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      });
    } catch (err) {
      setSendError(err instanceof Error ? err.message : String(err));
      resetRecorderState();
      setRecState("idle");
      return;
    }

    releaseStream();

    if (!blob || blob.size === 0) {
      setSendError("La grabación está vacía.");
      resetRecorderState();
      setRecState("idle");
      return;
    }

    const fd = new FormData();
    fd.append("audio", blob, `audio.${extFromBlobType(blob.type)}`);
    fd.append("duration_sec", String(finalDurationSec));

    try {
      const res = await fetch(`/api/messages/${conversationId}/audio`, {
        method: "POST",
        body: fd,
      });
      const data = (await res.json()) as {
        ok: boolean;
        error?: string;
        code?: number | null;
      };
      if (!res.ok || !data.ok) {
        if (data.code === 131047) {
          setIs24hWindow(true);
          setSendError(
            "Fuera de la ventana de 24h. WhatsApp solo permite enviar audio dentro de las 24h del último mensaje del cliente."
          );
        } else {
          setSendError(data.error ?? "No se pudo enviar el audio.");
        }
      }
    } catch (err) {
      setSendError(err instanceof Error ? err.message : String(err));
    } finally {
      resetRecorderState();
      setRecState("idle");
    }
  }

  useEffect(() => {
    return () => {
      const r = recorderRef.current;
      if (r && r.state !== "inactive") {
        try {
          r.stop();
        } catch {
          // ignore
        }
      }
      teardownAnalyser();
      releaseStream();
      stopTimer();
    };
  }, []);

  useEffect(() => {
    const url = pending?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [pending]);

  useEffect(() => {
    if (!pending) return;
    function handler(e: KeyboardEvent) {
      if (e.key !== "Enter" || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) {
        return;
      }
      const target = e.target as HTMLElement | null;
      if (target?.tagName === "TEXTAREA") return;
      e.preventDefault();
      sendAttachmentRef.current();
    }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [pending]);

  function openAttachPicker() {
    if (!isHumanMode || sending || isOutside24hWindow) return;
    setSendError(null);
    attachInputRef.current?.click();
  }

  function handleAttachFile(file: File) {
    const kind = detectAttachKind(file);
    if (!kind) {
      setSendError(
        "Solo se aceptan archivos de imagen, audio, video o PDF."
      );
      return;
    }
    if (file.size > ATTACH_SIZE_LIMITS[kind]) {
      const mb = ATTACH_SIZE_LIMITS[kind] / (1024 * 1024);
      setSendError(`El archivo supera el límite de ${mb} MB.`);
      return;
    }
    if (pending) URL.revokeObjectURL(pending.url);
    setPending({ file, kind, url: URL.createObjectURL(file) });
    setAttachCaption("");
  }

  function handleAttachSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) handleAttachFile(file);
  }

  function cancelAttachment() {
    if (pending) URL.revokeObjectURL(pending.url);
    setPending(null);
    setAttachCaption("");
    setUploadingAttachment(false);
  }

  async function sendAttachment() {
    if (!pending || uploadingAttachment) return;
    setUploadingAttachment(true);
    setSendError(null);
    setIs24hWindow(false);

    const fd = new FormData();
    fd.append(pending.kind, pending.file);
    if (pending.kind !== "audio" && attachCaption.trim()) {
      fd.append("caption", attachCaption.trim());
    }

    try {
      const res = await fetch(
        `/api/messages/${conversationId}/${pending.kind}`,
        { method: "POST", body: fd }
      );
      const data = (await res.json()) as {
        ok: boolean;
        error?: string;
        code?: number | null;
      };
      if (!res.ok || !data.ok) {
        if (data.code === 131047) {
          setIs24hWindow(true);
          setSendError(
            "Fuera de la ventana de 24h. WhatsApp solo permite enviar archivos dentro de las 24h del último mensaje del cliente."
          );
        } else {
          setSendError(data.error ?? "No se pudo enviar el archivo.");
        }
        setUploadingAttachment(false);
      } else {
        cancelAttachment();
      }
    } catch (err) {
      setSendError(err instanceof Error ? err.message : String(err));
      setUploadingAttachment(false);
    }
  }

  sendAttachmentRef.current = () => {
    void sendAttachment();
  };

  function dragHasFiles(e: React.DragEvent<HTMLDivElement>): boolean {
    const types = e.dataTransfer?.types;
    if (!types) return false;
    for (let i = 0; i < types.length; i++) {
      if (types[i] === "Files") return true;
    }
    return false;
  }

  function onDragEnter(e: React.DragEvent<HTMLDivElement>) {
    if (!dragHasFiles(e)) return;
    if (!isHumanMode || sending || pending || recState !== "idle" || isOutside24hWindow) return;
    e.preventDefault();
    dragDepthRef.current++;
    setDragActive(true);
  }

  function onDragOver(e: React.DragEvent<HTMLDivElement>) {
    if (!dragHasFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  }

  function onDragLeave(e: React.DragEvent<HTMLDivElement>) {
    if (!dragHasFiles(e)) return;
    e.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragActive(false);
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    dragDepthRef.current = 0;
    setDragActive(false);
    if (!isHumanMode || sending || pending || recState !== "idle" || isOutside24hWindow) return;
    const file = e.dataTransfer?.files?.[0];
    if (file) handleAttachFile(file);
  }

  function onPaste(e: React.ClipboardEvent<HTMLDivElement>) {
    if (!isHumanMode || sending || pending || recState !== "idle" || isOutside24hWindow) return;
    const dt = e.clipboardData;
    if (!dt) return;
    if (dt.files && dt.files.length > 0) {
      const file = dt.files[0];
      if (file) {
        e.preventDefault();
        handleAttachFile(file);
        return;
      }
    }
    if (dt.items) {
      for (let i = 0; i < dt.items.length; i++) {
        const item = dt.items[i];
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            handleAttachFile(file);
            return;
          }
        }
      }
    }
  }

  // Ventana de 24h de WhatsApp: si pasaron más de 24h desde el último
  // mensaje del cliente, Meta rechaza cualquier mensaje libre del
  // operador (solo permite Message Templates pre-aprobados). Bloqueamos
  // proactivamente la UI para que el operador no intente y vea error.
  // Si el cliente nunca escribió, no bloqueamos (la ventana ni siquiera
  // empezó a contar).
  // IMPORTANTE: este useMemo va ANTES del early return de abajo —
  // Rules of Hooks de React: hooks deben llamarse en el mismo orden
  // siempre, sin saltearse por condicionales.
  const isOutside24hWindow = useMemo(() => {
    const userMessages = state.messages.filter((m) => m.role === "user");
    if (userMessages.length === 0) return false;
    const lastUserMsg = userMessages[userMessages.length - 1];
    const hoursSince = (Date.now() / 1000 - lastUserMsg.created_at) / 3600;
    return hoursSince >= 24;
  }, [state.messages]);

  if (!state.conversation) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-neutral-500">
        Cargando conversación…
      </div>
    );
  }

  const convo = state.conversation;
  const mensajesVisibles = state.messages.slice(-visibles);
  const hayMasAntiguos = state.messages.length > mensajesVisibles.length;
  const isHumanMode = convo.mode === "HUMAN";
  // La vista previa de formato solo aparece cuando el draft tiene algún
  // marcador (*, _, ~) — así no agrega ruido en mensajes sin formato.
  const showFormatPreview =
    isHumanMode && draft.trim().length > 0 && /[*_~]/.test(draft);

  // Cualquier input/botón del operador queda bloqueado en estas
  // condiciones (modo IA, ya enviando, o fuera de ventana 24h).
  const operatorDisabled = !isHumanMode || sending || isOutside24hWindow;

  return (
    <div
      className="relative flex h-full flex-col"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onPaste={onPaste}
    >
      {avisoCapi ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-lg bg-tarjeta p-5 shadow-xl">
            <h3 className="text-sm font-bold text-red-800">
              No se envió {avisoCapi.evento ?? "el evento"} a Meta
            </h3>

            {avisoCapi.explicacion ? (
              <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
                <p className="font-medium text-amber-900">
                  {avisoCapi.explicacion.quePasa}
                </p>
                <p className="mt-1 text-amber-800">
                  {avisoCapi.explicacion.queHacer}
                </p>
              </div>
            ) : (
              <p className="mt-3 text-sm text-neutral-600">
                No reconozco este error, así que no te invento una causa. Abajo
                está lo que respondió Meta, tal cual.
              </p>
            )}

            <p className="mt-3 text-xs font-medium text-neutral-500">
              Respuesta de Meta
            </p>
            <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded border border-neutral-200 bg-neutral-50 p-2 text-[11px] text-neutral-700">
              {avisoCapi.error ?? "(sin detalle)"}
            </pre>

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setAvisoCapi(null)}
                className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
              >
                Cerrar
              </button>
              <button
                type="button"
                onClick={() => void reintentarCapi()}
                disabled={reintentandoCapi}
                className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {reintentandoCapi ? "Reintentando..." : "Reintentar"}
              </button>
            </div>
            <p className="mt-2 text-[11px] text-neutral-500">
              Reintentar es seguro: este evento nunca llegó a Meta, así que no
              se puede contar dos veces. Si ahora pasa, la conversación deja de
              estar marcada.
            </p>
          </div>
        </div>
      ) : null}

      {dragActive && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-lg border-4 border-dashed border-emerald-500 bg-emerald-500/10 backdrop-blur-sm">
          <div className="rounded-lg bg-tarjeta px-6 py-4 text-base font-medium text-emerald-700 shadow-md">
            Suelta el archivo para enviarlo
          </div>
        </div>
      )}
      <header className="flex items-center justify-between gap-3 border-b border-neutral-200 bg-tarjeta px-4 py-3">
        {/* Volver a la lista. Solo en pantalla angosta: en el escritorio la
            lista está siempre a la izquierda y este botón no tiene sentido. */}
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="Volver a la lista"
            className="-ml-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900 active:bg-neutral-200 md:hidden"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-5 w-5"
            >
              <path d="M19 12H5" />
              <path d="M12 19l-7-7 7-7" />
            </svg>
          </button>
        )}
        <div className="min-w-0">
          <div className="truncate text-base font-semibold text-neutral-900 md:text-sm">
            <span className="mr-2 align-middle">
              <ChannelBadge channel={convo.channel ?? "whatsapp"} />
            </span>
            {convo.name?.trim() || formatPhone(convo.phone)}
          </div>
          <div className="truncate text-sm text-neutral-500 md:text-xs">
            {formatPhone(convo.phone)}
          </div>
          {/* Los datos del anuncio ocupan varias líneas. En el celular se
              guardan en el menú de los tres puntos: arriba solo el nombre y el
              número, como en WhatsApp. */}
          {/* Cuando un evento no llegó a Meta. Va junto al origen porque es la
              misma pregunta: de dónde vino este cliente y si Meta se enteró. */}
          {convo.capi_last_ok === 0 ? (
            <button
              type="button"
              onClick={() => void abrirAvisoCapi()}
              className="mt-0.5 hidden truncate rounded border border-red-300 bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700 hover:bg-red-100 md:block"
            >
              ⚠ No se envió {convo.capi_last_event ?? "el evento"} — toca para
              ver por qué
            </button>
          ) : null}
          {/* CUANDO SÍ SE ENVIÓ, Y A DÓNDE. Pedido por el dueño el 5/10/2026.

              EL CASO QUE ESTO DESTAPA: un pixel equivocado NO da error. Meta lo
              acepta, guarda la compra en el conjunto de datos de al lado, y su
              campaña —que mira el suyo— nunca se entera ni aprende de esa venta.
              Antes aquí no salía nada, así que ese fallo era invisible: el panel
              solo hablaba cuando algo fallaba.

              LA PÁGINA SÍ LLEVA VEREDICTO, Y ES GRATIS: Meta la valida contra el
              anuncio del clic y rechaza si no coinciden (2804072). Si el evento
              entró, la página era la buena — eso ya es la prueba.

              EL PIXEL NO LLEVA VEREDICTO, Y NO ES PEREZA: «el correcto» es el que
              él eligió en la campaña, y Meta no publica ese dato para campañas de
              clic a WhatsApp (medido el 4/10/2026 contra su documentación). Poner
              un check aquí sería inventárselo. Se enseña el número y lo juzga él,
              que sí sabe cuál eligió. */}
          {convo.capi_last_ok === 1 && convo.capi_last_pixel ? (
            <div className="mt-0.5 hidden rounded border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-900 md:block">
              <div className="font-semibold">
                ✅ Se envió {convo.capi_last_event ?? "el evento"} a Meta
              </div>
              {convo.capi_last_pagina ? (
                <div className="truncate">
                  Página: coincide con el anuncio
                </div>
              ) : null}
              {convo.capi_last_tienda ? (
                <div className="truncate">Tienda: {convo.capi_last_tienda}</div>
              ) : null}
              {/* El dato por el que existe todo esto. Sin recortar: es un número
                  largo y lo tiene que poder comparar entero de un vistazo. */}
              <div className="break-all">
                Pixel: <strong>{convo.capi_last_pixel}</strong>
              </div>
            </div>
          ) : null}
          {/* Origen NO publicitario. El bloque de abajo solo aparece cuando la
              conversación vino de un anuncio, así que sin esta línea una
              conversación orgánica no mostraba nada y no se distinguía de una a
              la que todavía no se le había resuelto el anuncio. */}
          {origenDeLead(convo) !== "anuncio" && (
            <div
              className={`hidden truncate text-[11px] md:block ${
                origenDeLead(convo) === "organico"
                  ? "text-emerald-700"
                  : "text-amber-700"
              }`}
              title={EXPLICACION_DE_ORIGEN[origenDeLead(convo)]}
            >
              {ETIQUETA_DE_ORIGEN[origenDeLead(convo)]}
            </div>
          )}
          {origenDeLead(convo) === "anuncio" && (
            <div className="hidden md:block">
              <div
                className="truncate text-[11px] text-sky-600"
                title={convo.ad_source_url ?? undefined}
            >
              📢 Vino del anuncio:{" "}
              {convo.ad_source_id ?? "(sin identificar aún)"}
                {convo.ad_headline ? ` — ${convo.ad_headline}` : ""}
              </div>
              <button
                type="button"
                onClick={refreshAdOrigin}
                title="Actualizar BM, cuenta, campaña y Ad desde Meta"
                className="text-[11px] text-neutral-400 hover:text-neutral-700"
              >
                ↻ Actualizar origen
              </button>
            {adOriginLoading && (
              <div className="truncate text-[11px] text-neutral-400">
                Consultando cuenta publicitaria...
              </div>
            )}
            </div>
          )}
        </div>

        {/* BM · Cuenta · Campaña · Ad, a la DERECHA del nombre en vez de
            debajo. Ahí sobraba ancho, y esas cuatro líneas apiladas empujaban
            el chat hacia abajo sin necesidad. El borde de la izquierda hace de
            separador para que se lea como otro grupo. */}
        {adOrigin && origenDeLead(convo) === "anuncio" && (
          <div className="hidden min-w-0 flex-1 border-l border-neutral-200 pl-3 text-[11px] text-violet-700 md:block">
            <div
              className="truncate"
              title={
                adOrigin.businessName ||
                "Meta no devolvió el Business Manager de esta cuenta. Suele ser que al token de lectura de anuncios le falta el permiso business_management."
              }
            >
              {adOrigin.businessName
                ? `BM: ${adOrigin.businessName}`
                : "BM no disponible"}
              {" · "}
              Cuenta: {adOrigin.adAccountName || adOrigin.adAccountId}
            </div>
            {adOrigin.campaignName && (
              <div className="truncate" title={adOrigin.campaignName}>
                Campaña: {adOrigin.campaignName}
              </div>
            )}
            {adOrigin.adName && (
              <div className="truncate" title={adOrigin.adName}>
                Ad: {adOrigin.adName}
              </div>
            )}
          </div>
        )}

        {/* MENÚ DEL CHAT — solo en celular. Dentro va todo lo que antes se
            amontonaba en la cabecera: IA/humano, fijar, bloquear, borrar y los
            datos del anuncio. Arriba queda solo el nombre y el número. */}
        <div className="relative shrink-0 md:hidden">
          <button
            type="button"
            onClick={() => setMenuChatAbierto((v) => !v)}
            aria-label="Opciones de la conversación"
            className="flex h-9 w-9 items-center justify-center rounded-full text-xl leading-none text-neutral-600 hover:bg-neutral-100"
          >
            ⋮
          </button>
          {menuChatAbierto && (
            <>
              <div
                className="fixed inset-0 z-20"
                onClick={() => setMenuChatAbierto(false)}
              />
              <div className="absolute right-0 top-full z-30 mt-1 w-64 overflow-hidden rounded-lg border border-neutral-200 bg-tarjeta shadow-lg">
                {origenDeLead(convo) !== "anuncio" && (
                  <div
                    className={`border-b border-neutral-100 px-4 py-3 text-[11px] ${
                      origenDeLead(convo) === "organico"
                        ? "text-emerald-700"
                        : "text-amber-700"
                    }`}
                  >
                    {ETIQUETA_DE_ORIGEN[origenDeLead(convo)]}
                  </div>
                )}
                {origenDeLead(convo) === "anuncio" && (
                  <div className="border-b border-neutral-100 px-4 py-3 text-[11px] text-neutral-600">
                    <div className="text-sky-600">
                      📢 Vino del anuncio:{" "}
                      {convo.ad_source_id ?? "(sin identificar aún)"}
                    </div>
                    {adOrigin?.campaignName && (
                      <div className="mt-1 truncate text-violet-700">
                        Campaña: {adOrigin.campaignName}
                      </div>
                    )}
                    {adOrigin?.adName && (
                      <div className="truncate text-violet-700">
                        Ad: {adOrigin.adName}
                      </div>
                    )}
                  </div>
                )}
                <div className="flex items-center justify-between gap-2 border-b border-neutral-100 px-4 py-3">
                  <span className="text-sm text-neutral-700">Responde</span>
                  <ModeToggle
                    conversationId={convo.id}
                    mode={convo.mode}
                    onChanged={handleModeChanged}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setMenuChatAbierto(false);
                    togglePin();
                  }}
                  className="block w-full border-b border-neutral-100 px-4 py-3 text-left text-sm text-neutral-700 hover:bg-neutral-50"
                >
                  {convo.pinned === 1 ? "Dejar de fijar" : "Fijar arriba"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenuChatAbierto(false);
                    void toggleBlock();
                  }}
                  disabled={blockBusy}
                  className="block w-full border-b border-neutral-100 px-4 py-3 text-left text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
                >
                  {isBlocked ? "Desbloquear número" : "Bloquear número"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenuChatAbierto(false);
                    void handleDelete();
                  }}
                  className="block w-full px-4 py-3 text-left text-sm text-red-600 hover:bg-red-50"
                >
                  Borrar conversación
                </button>
              </div>
            </>
          )}
        </div>

        <div className="hidden items-center gap-2 md:flex">
          <button
            type="button"
            onClick={togglePin}
            title={convo.pinned === 1 ? "Dejar de fijar" : "Fijar al top de la lista"}
            className={`flex h-8 w-8 items-center justify-center rounded-md border transition ${
              convo.pinned === 1
                ? "border-amber-300 bg-amber-50 text-amber-500 hover:bg-amber-100"
                : "border-neutral-200 bg-tarjeta text-neutral-400 hover:bg-neutral-50 hover:text-neutral-600"
            }`}
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
          <ModeToggle
            conversationId={convo.id}
            mode={convo.mode}
            onChanged={handleModeChanged}
          />
          <button
            type="button"
            onClick={toggleBlock}
            disabled={blockBusy}
            title={
              isBlocked
                ? "El bot ignora los mensajes de este número"
                : "Bloquear: el bot ignorará los mensajes de este número"
            }
            className={`rounded-md border px-3 py-1.5 text-xs disabled:opacity-50 ${
              isBlocked
                ? "border-red-300 bg-red-50 text-red-700 hover:bg-red-100"
                : "border-neutral-200 bg-tarjeta text-neutral-700 hover:bg-neutral-50"
            }`}
          >
            {blockBusy
              ? "…"
              : isBlocked
                ? "Desbloquear"
                : "Bloquear"}
          </button>
          <button
            type="button"
            onClick={handleDelete}
            className="rounded-md border border-neutral-200 bg-tarjeta px-3 py-1.5 text-xs text-neutral-700 hover:bg-red-50 hover:text-red-700 hover:border-red-200"
          >
            Borrar
          </button>
        </div>
      </header>
      {isBlocked && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">
          🚫 Número bloqueado — el bot ignora sus mensajes entrantes. Los
          mensajes que envíes vos desde acá igual le llegan.
        </div>
      )}
      {isOutside24hWindow && (
        <div
          style={{ backgroundColor: "#FDE7EA" }}
          className="border-b border-rose-200 px-4 py-2.5 text-center text-xs text-rose-800"
        >
          Solo podrás responder a esta conversación usando una plantilla
          (template) debido a la <strong>restricción de ventana de 24 horas</strong>{" "}
          de WhatsApp. Esperá a que el cliente vuelva a escribir para retomarla.
        </div>
      )}

      {/* Barra de selección: sustituye visualmente a la cabecera mientras hay
          burbujas marcadas, igual que en WhatsApp. */}
      {seleccion !== null && (
        <div className="flex items-center gap-2 border-b border-emerald-200 bg-emerald-50 px-3 py-2">
          <button
            type="button"
            onClick={() => setSeleccion(null)}
            aria-label="Cancelar selección"
            className="rounded-full px-3 py-1.5 text-lg leading-none text-neutral-700 hover:bg-emerald-100"
          >
            ✕
          </button>
          <span className="flex-1 text-sm font-medium text-neutral-800">
            {seleccion.length}{" "}
            {seleccion.length === 1 ? "seleccionado" : "seleccionados"}
          </span>
          <button
            type="button"
            disabled={seleccion.length === 0}
            onClick={copiarSeleccion}
            className="rounded-full px-3 py-1.5 text-sm font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-40"
          >
            Copiar
          </button>
          <button
            type="button"
            disabled={seleccion.length === 0}
            onClick={() => setMostrarReenvio(true)}
            className="rounded-full bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
          >
            Reenviar
          </button>
        </div>
      )}
      {avisoReenvio && (
        <div className="border-b border-neutral-200 bg-neutral-50 px-4 py-2 text-center text-xs text-neutral-700">
          {avisoReenvio}
        </div>
      )}

      <div className="relative flex min-h-0 flex-1 flex-col">
        {/* Aviso de mensajes nuevos: aparece solo si llegó algo mientras leías
            más arriba. Se toca y baja al final. */}
        {hayNuevosAbajo && (
          <button
            type="button"
            onClick={bajarAlFinal}
            className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-lg transition-colors active:bg-emerald-700"
          >
            ↓ Mensajes nuevos
          </button>
        )}
      <div
        ref={scrollRef}
        onCopy={(e) => {
          // Copiar seleccionando con el mouse: el navegador se llevaría el
          // texto ya dibujado, sin los asteriscos. Aquí se reconstruyen a
          // partir de las etiquetas, para que al pegar conserve el formato
          // igual que el "Copiar" del menú de la burbuja.
          const seleccion = window.getSelection();
          if (!seleccion || seleccion.rangeCount === 0 || seleccion.isCollapsed) {
            return;
          }
          const texto = marcadoDesdeSeleccion(
            seleccion.getRangeAt(0).cloneContents()
          );
          if (!texto) return;
          e.clipboardData.setData("text/plain", texto);
          e.preventDefault();
        }}
        onScroll={(e) => {
          // Al volver abajo por tu cuenta, el aviso sobra.
          const caja = e.currentTarget;
          if (
            caja.scrollHeight - caja.scrollTop - caja.clientHeight <
            UMBRAL_ABAJO
          ) {
            setHayNuevosAbajo(false);
          }
        }}
        className="flex-1 overflow-y-auto bg-neutral-100 px-4 py-4"
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          {/* Solo se dibujan los ULTIMOS mensajes. Antes se pintaban los 200 de
              golpe y en el celular la conversacion tardaba en aparecer y se
              movia sola al terminar. Los anteriores se traen a pedido. */}
          {hayMasAntiguos && (
            <button
              type="button"
              onClick={() => setVisibles((n) => n + PASO_MENSAJES)}
              className="mx-auto rounded-full border border-neutral-300 bg-tarjeta px-4 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50"
            >
              Ver mensajes anteriores
            </button>
          )}
          {state.messages.length === 0 ? (
            <div className="text-center text-sm text-neutral-500">
              Sin mensajes todavía.
            </div>
          ) : (
            mensajesVisibles.map((m, idx) => {
              const prev = idx > 0 ? mensajesVisibles[idx - 1] : null;
              const showDivider =
                idx === 0 ||
                !prev ||
                getDayKey(prev.created_at) !== getDayKey(m.created_at);
              return (
                <Fragment key={m.id}>
                  {showDivider && <DateDivider timestamp={m.created_at} />}
                  <MessageBubble
                    message={m}
                    channel={state.conversation?.channel ?? "whatsapp"}
                    modoSeleccion={seleccion !== null}
                    seleccionado={seleccion?.includes(m.id) ?? false}
                    onPulsacionLarga={() => setSeleccion([m.id])}
                    onAlternarSeleccion={() => alternarSeleccion(m.id)}
                    onResponder={() => setRespondiendoA(m)}
                    onCopiar={() => void copiarMensaje(m)}
                    onReenviar={() => setSeleccion([m.id])}
                  />
                  {/* Los botones que vio el cliente, apilados como en WhatsApp.
                      Van como <span>, NO como <button>: aquí solo se miran. El
                      único que puede pulsarlos es el cliente, en su teléfono. */}
                  {m.role !== "user" &&
                    (state.buttons?.[String(m.id)] ?? []).length > 0 && (
                      <div className="mb-2 flex max-w-[75%] flex-col gap-1">
                        {(state.buttons?.[String(m.id)] ?? []).map((boton) => (
                          <span
                            key={boton.id}
                            title="Así lo vio el cliente. Solo él puede pulsarlo."
                            className="cursor-default select-none rounded-lg border border-neutral-200 bg-tarjeta px-3 py-2 text-center text-sm font-medium text-sky-700 shadow-sm"
                          >
                            {boton.title}
                          </span>
                        ))}
                      </div>
                    )}
                </Fragment>
              );
            })
          )}
        </div>
      </div>
      </div>

      <footer className="border-t border-neutral-200 bg-tarjeta p-3">
        {/*
          LAS 70 HORAS — el bot ya no contesta a esta conversación.

          LO PIDIÓ EL DUEÑO el 3 de octubre de 2026, para no pagarle a Meta por responder
          fuera de la ventana gratis: «que cualquier persona que ingresó jamás reciba
          respuesta luego de las 72 horas… si es posible a las 70».

          EL AVISO ES SOLO PARA ÉL, y lo dijo expreso: «al cliente nunca le tiene que llegar
          eso, es para el usuario del editor». Por eso vive aquí, en el pie del chat, al lado
          del de 24 horas — que es donde él ya mira.

          Y VA PRIMERO que el de 24h a propósito: cuando han pasado 70 horas también han
          pasado las 24, y enseñar los dos juntos solo confunde. El que manda es éste,
          porque es el que explica por qué el bot se calló.
        */}
        {pasoLasSetentaHoras ? (
          <div className="mb-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <span className="font-semibold">Pasaron las 70 horas.</span> El bot ya
            no responde a esta conversación, para no pagar fuera de la ventana de
            Meta. Si quieres atenderla, escríbele tú desde aquí.
          </div>
        ) : (
          is24hWindow && (
            <div className="mb-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              Fuera de la ventana de 24h. Para reactivar la conversación tienes
              que usar una plantilla preaprobada (fuera de scope en v1).
            </div>
          )
        )}
        {sendError && !is24hWindow && (
          <div className="mb-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {sendError}
          </div>
        )}
        {respuestaPreparada && (
          <div className="mb-2 flex items-center gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2">
            <span className="text-sm text-sky-800">
              Lleva{" "}
              <strong>
                {respuestaPreparada.media_type === "image"
                  ? "📷 una imagen"
                  : respuestaPreparada.media_type === "video"
                    ? "🎬 un video"
                    : respuestaPreparada.media_type === "audio"
                      ? "🎤 un audio"
                      : `📄 ${respuestaPreparada.media_filename || "un PDF"}`}
              </strong>{" "}
              — se envía junto al texto.
            </span>
            <button
              type="button"
              onClick={() => setRespuestaPreparada(null)}
              className="ml-auto shrink-0 rounded-full px-2 py-1 text-xs text-sky-700 hover:bg-sky-100"
            >
              Quitar archivo
            </button>
          </div>
        )}
        {respondiendoA && (
          <div className="mb-2 flex items-start gap-2 rounded-md border-l-4 border-emerald-500 bg-neutral-100 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-emerald-700">
                {respondiendoA.role === "user" ? "Cliente" : "Tú"}
              </p>
              <p className="truncate text-sm text-neutral-700">
                {textoDeMensaje(respondiendoA) ||
                  marcaDeAdjunto(respondiendoA.media_type ?? "mensaje")}
              </p>
              {!respondiendoA.wa_message_id && (
                <p className="mt-0.5 text-xs text-amber-700">
                  Este mensaje nunca llegó a salir, así que se enviará sin la
                  cita.
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setRespondiendoA(null)}
              aria-label="Cancelar respuesta"
              className="rounded-full px-2 py-1 text-neutral-500 hover:bg-neutral-200"
            >
              ✕
            </button>
          </div>
        )}
        <input
          ref={attachInputRef}
          type="file"
          accept="video/*,image/*,audio/*,application/pdf,.pdf"
          className="hidden"
          onChange={handleAttachSelected}
        />
        {pending ? (
          <div className="flex flex-col gap-2">
            {pending.kind === "video" && (
              <video
                src={pending.url}
                controls
                preload="metadata"
                className="max-h-60 w-full rounded-lg bg-black"
              />
            )}
            {pending.kind === "image" && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={pending.url}
                alt={pending.file.name}
                className="max-h-60 w-auto max-w-full rounded-lg object-contain"
              />
            )}
            {pending.kind === "audio" && (
              <audio
                src={pending.url}
                controls
                preload="metadata"
                className="w-full"
              />
            )}
            {pending.kind === "document" && (
              <div className="flex items-center gap-3 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-3">
                <span className="flex h-12 w-12 items-center justify-center rounded bg-red-100 text-red-600">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    className="h-7 w-7"
                  >
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" />
                    <path d="M14 2v6h6" fill="white" />
                    <text x="7.5" y="17" fontSize="6" fontWeight="bold" fill="white">
                      PDF
                    </text>
                  </svg>
                </span>
                <div className="min-w-0 flex-1 text-sm text-neutral-900">
                  Documento PDF listo para enviar
                </div>
              </div>
            )}
            <div className="text-xs text-neutral-500">
              {pending.file.name} · {(pending.file.size / (1024 * 1024)).toFixed(1)} MB
            </div>
            {pending.kind !== "audio" && (
              <textarea
                ref={attachCaptionRef}
                value={attachCaption}
                onChange={(e) => setAttachCaption(e.target.value)}
                disabled={uploadingAttachment}
                rows={2}
                placeholder="Añadir un comentario (opcional)…"
                className="w-full resize-none rounded-md border border-neutral-300 bg-tarjeta px-3 py-2 text-sm shadow-sm placeholder:text-neutral-400 focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-400 disabled:bg-neutral-100"
              />
            )}
            <div className="flex items-center justify-between gap-2">
              {pending.kind !== "audio" ? (
                <EmojiPicker
                  onPick={(emoji) => insertAtAttachCursor(emoji)}
                  disabled={uploadingAttachment}
                />
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={cancelAttachment}
                  disabled={uploadingAttachment}
                  className="rounded-md border border-neutral-200 bg-tarjeta px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={sendAttachment}
                  disabled={uploadingAttachment}
                  className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:bg-neutral-300"
                >
                  {uploadingAttachment
                    ? "Enviando…"
                    : `Enviar ${attachLabel(pending.kind)}`}
                </button>
              </div>
            </div>
          </div>
        ) : recState !== "idle" ? (
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={cancelRecording}
              disabled={recState === "uploading"}
              title="Cancelar grabación"
              className="flex h-10 w-10 items-center justify-center rounded-full text-neutral-600 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-5 w-5"
              >
                <path d="M3 6h18" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6" />
                <path d="M14 11v6" />
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
              </svg>
            </button>
            <span
              className={`h-2 w-2 rounded-full ${
                recState === "recording"
                  ? "animate-pulse bg-red-500"
                  : recState === "paused"
                  ? "bg-neutral-400"
                  : "bg-amber-500"
              }`}
            />
            <span className="font-mono text-sm tabular-nums text-neutral-800">
              {formatRecTime(recDurationMs)}
            </span>
            {recState === "uploading" ? (
              <span className="text-xs text-neutral-500">Enviando…</span>
            ) : (
              <canvas
                ref={vizCanvasRef}
                width={320}
                height={56}
                className="h-7 w-40"
              />
            )}
            {recState === "recording" && (
              <button
                type="button"
                onClick={pauseRecording}
                title="Pausar"
                className="flex h-10 w-10 items-center justify-center rounded-full text-neutral-700 hover:bg-neutral-100"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="h-5 w-5"
                >
                  <rect x="6" y="5" width="4" height="14" rx="1" />
                  <rect x="14" y="5" width="4" height="14" rx="1" />
                </svg>
              </button>
            )}
            {recState === "paused" && (
              <button
                type="button"
                onClick={resumeRecording}
                title="Continuar grabación"
                className="flex h-10 w-10 items-center justify-center rounded-full text-neutral-700 hover:bg-neutral-100"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="h-5 w-5"
                >
                  <path d="M8 5v14l11-7z" />
                </svg>
              </button>
            )}
            <button
              type="button"
              onClick={sendRecording}
              disabled={recState === "uploading"}
              title="Enviar audio"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500 text-white shadow-sm transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:bg-neutral-300"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="h-5 w-5"
              >
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
              </svg>
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {showFormatPreview && (
              <div className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2">
                <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                  Vista previa
                </div>
                <div className="whitespace-pre-wrap break-words text-sm text-neutral-800">
                  {renderWhatsAppFormat(draft)}
                </div>
              </div>
            )}
            <form onSubmit={handleSend} className="flex items-end gap-2">
            <button
              type="button"
              onClick={openAttachPicker}
              disabled={operatorDisabled}
              title={
                isHumanMode
                  ? "Adjuntar imagen, audio, video o PDF"
                  : "Cambia a modo HUMANO para adjuntar"
              }
              className="flex h-10 w-10 items-center justify-center rounded-full text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-5 w-5"
              >
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            </button>
            <QuickReplies
              replies={quickReplies}
              onSend={async (r) => prepararRespuestaRapida(r)}
              onChanged={loadQuickReplies}
              disabled={operatorDisabled}
            />
            <EmojiPicker
              onPick={(emoji) => insertAtCursor(emoji)}
              disabled={operatorDisabled}
              placement="above"
            />
            <div className="relative flex-1">
              {slashOpen && (
                <div className="absolute bottom-full left-0 mb-1 w-full max-h-56 overflow-y-auto rounded-lg border border-neutral-200 bg-tarjeta shadow-lg">
                  <div className="border-b border-neutral-100 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                    Respuestas rápidas
                  </div>
                  {slashMatches.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => {
                        // Por el atajo tampoco se envía sola: cae en el cajón
                        // para poder leerla o retocarla, con su adjunto
                        // enganchado si lo tiene.
                        setSlashOpen(false);
                        prepararRespuestaRapida(r);
                      }}
                      className="block w-full border-b border-neutral-50 px-3 py-2 text-left last:border-b-0 hover:bg-emerald-50"
                    >
                      <div className="mb-0.5 flex flex-wrap items-center gap-1">
                        <span className="inline-block rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600">
                          /{r.shortcut}
                        </span>
                        {r.media_type && (
                          <span className="inline-block rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-700">
                            {r.media_type === "image"
                              ? "📷 Imagen"
                              : r.media_type === "video"
                                ? "🎬 Video"
                                : r.media_type === "audio"
                                  ? "🎤 Audio"
                                  : "📄 PDF"}
                          </span>
                        )}
                      </div>
                      {r.content && (
                        <div className="line-clamp-2 text-xs text-neutral-700">
                          {r.content}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}
              <textarea
                ref={messageTextareaRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                disabled={operatorDisabled}
                rows={2}
                placeholder={
                  !isHumanMode
                    ? "Cambia a modo HUMANO para escribir manualmente"
                    : isOutside24hWindow
                      ? "Esperando a que el cliente responda nuevamente…"
                      : "Escribe un mensaje…  (/atajo para respuestas rápidas)"
                }
                // 16px en el celular a proposito: por debajo de eso, iOS hace
                // zoom automatico al tocar el campo y descuadra la pantalla.
                className="w-full resize-none rounded-md border border-neutral-300 bg-tarjeta px-3 py-2 text-base shadow-sm placeholder:text-neutral-400 focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-400 disabled:bg-neutral-100 disabled:text-neutral-500 md:text-sm"
                onKeyDown={(e) => {
                  if (e.key === "Escape" && slashOpen) {
                    setSlashOpen(false);
                    return;
                  }
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    // Si el menú "/" está abierto, Enter elige el primer match
                    // en vez de enviar.
                    if (slashOpen && slashMatches.length > 0) {
                      setDraft(slashMatches[0].content);
                      setSlashOpen(false);
                      return;
                    }
                    handleSend(e);
                  }
                }}
              />
            </div>
            {draft.trim() ? (
              <button
                type="submit"
                disabled={operatorDisabled}
                className="rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:bg-neutral-300"
              >
                {sending ? "Enviando…" : "Enviar"}
              </button>
            ) : (
              <button
                type="button"
                onClick={startRecording}
                disabled={operatorDisabled}
                title={
                  isHumanMode
                    ? "Grabar audio"
                    : "Cambia a modo HUMANO para grabar audio"
                }
                className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500 text-white shadow-sm transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:bg-neutral-300"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="h-5 w-5"
                >
                  <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3z" />
                  <path d="M19 11a1 1 0 0 0-2 0 5 5 0 0 1-10 0 1 1 0 0 0-2 0 7 7 0 0 0 6 6.92V20H8a1 1 0 0 0 0 2h8a1 1 0 0 0 0-2h-3v-2.08A7 7 0 0 0 19 11z" />
                </svg>
              </button>
            )}
            </form>
          </div>
        )}
      </footer>

      {mostrarReenvio && seleccion && state.conversation && !reenviando && (
        <ForwardPicker
          cantidad={seleccion.length}
          excluirId={state.conversation.id}
          onCancelar={() => setMostrarReenvio(false)}
          onElegir={reenviarA}
        />
      )}
    </div>
  );
}
