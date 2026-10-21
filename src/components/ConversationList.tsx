"use client";

import { useMemo, useState } from "react";
import { countryFromPhone, type CountryCode } from "@/lib/countries";

export interface ConversationListItem {
  id: number;
  phone: string;
  channel?: "whatsapp" | "messenger" | "instagram" | "tiktok";
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
  intro_variant_sent?: number | null;
  /** Total pagado en céntimos (panel de ventas). */
  paid_total_cents?: number;
  /** 1 = compró con la oferta (precio reducido); 0 = precio normal. */
  discount_active?: number;
  /** unixepoch de la aprobación del pago (panel de ventas). */
  paid_at?: number | null;
  /** 1 = activó una emergencia/reclamo. */
  had_emergency?: number;
  /** unixepoch del último mensaje del cliente (ventana 24h de WhatsApp). */
  last_user_message_at?: number | null;
  /** 0 = el último evento que se le mandó a Meta NO llegó. Se marca en rojo
   *  para poder ver de un vistazo cuáles hay que revisar. */
  capi_last_ok?: number | null;
  /** LA RUTA POR LA QUE ENTRÓ (20/10/2026): el camino de la intro que recibió. Vacío = la
   *  principal («Ruta A»). La anota el bot al mandar la intro; aquí solo se enseña. */
  camino?: string | null;
}

/** «Ruta A» (la principal) o la letra de su camino. Solo si ya recibió su intro. */
function rutaDe(c: ConversationListItem): string | null {
  if (c.intro_variant_sent == null && !c.camino) return null;
  return String(c.camino ?? "").trim() || "A";
}

type LabelFilter =
  | "todos"
  | "no leídos"
  | "hot"
  | "warm"
  | "pago"
  | "pago-reclamo"
  | "reclamo";
type ChannelFilter = "todos" | "whatsapp" | "messenger" | "instagram" | "tiktok";
type CountryFilter = "todos" | "sin_pais" | CountryCode;

const COUNTRY_FILTER_OPTIONS: Array<{
  code: CountryCode;
  label: string;
  flag: string;
}> = [
  { code: "PE", label: "Peru", flag: "🇵🇪" },
  { code: "EC", label: "Ecuador", flag: "🇪🇨" },
  { code: "CO", label: "Colombia", flag: "🇨🇴" },
  { code: "MX", label: "Mexico", flag: "🇲🇽" },
  { code: "AR", label: "Argentina", flag: "🇦🇷" },
  { code: "BO", label: "Bolivia", flag: "🇧🇴" },
  { code: "GT", label: "Guatemala", flag: "🇬🇹" },
  { code: "CR", label: "Costa Rica", flag: "🇨🇷" },
  { code: "CL", label: "Chile", flag: "🇨🇱" },
  { code: "SV", label: "El Salvador", flag: "🇸🇻" },
  { code: "VE", label: "Venezuela", flag: "🇻🇪" },
];

const COUNTRY_FLAG_BY_CODE: Record<CountryCode, string> = Object.fromEntries(
  COUNTRY_FILTER_OPTIONS.map((country) => [country.code, country.flag])
) as Record<CountryCode, string>;

function countryForConversation(c: ConversationListItem): CountryCode | null {
  if ((c.channel ?? "whatsapp") !== "whatsapp") return null;
  return countryFromPhone(c.phone);
}

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
  introVariants?: number[];
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
  if (phone.startsWith("messenger:")) return `Messenger ${phone.slice("messenger:".length)}`;
  if (phone.startsWith("instagram:")) return `Instagram ${phone.slice("instagram:".length)}`;
  return phone.startsWith("+") ? phone : `+${phone}`;
}

function ChannelBadge({
  channel = "whatsapp",
}: {
  channel?: "whatsapp" | "messenger" | "instagram" | "tiktok";
}) {
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
      className={`inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full px-1 text-[8px] font-black leading-none ${meta.className}`}
    >
      {meta.short}
    </span>
  );
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

function dayKeyFromUnix(unix: number): string {
  const d = new Date(unix * 1000);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export default function ConversationList({
  conversations,
  introVariants = [],
  selectedId,
  onSelect,
  onTogglePin,
  onToggleRead,
}: Props) {
  const [search, setSearch] = useState("");
  const [labelFilter, setLabelFilter] = useState<LabelFilter>("todos");
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>("todos");
  const [countryFilter, setCountryFilter] = useState<CountryFilter>("todos");
  /** EL FILTRO POR RUTA (20/10/2026): «yo veo cuál ruta vende más y las demás las apago». */
  const [rutaFilter, setRutaFilter] = useState<string>("todas");
  const [introFilter, setIntroFilter] = useState<number | "actual">("actual");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [dateMenuOpen, setDateMenuOpen] = useState(false);
  // En el celular los filtros van escondidos: ocupaban media pantalla y casi
  // nunca se tocan. En el escritorio siguen siempre a la vista.
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(false);
  const hayFiltrosPuestos =
    channelFilter !== "todos" ||
    countryFilter !== "todos" ||
    rutaFilter !== "todas" ||
    introFilter !== "actual" ||
    !!dateFrom ||
    !!dateTo;
  function limpiarFiltros() {
    setChannelFilter("todos");
    setCountryFilter("todos");
    setRutaFilter("todas");
    setIntroFilter("actual");
    setDateFrom("");
    setDateTo("");
  }
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const baseFiltered = useMemo(
    () =>
      conversations.filter((c) => {
        if (!matchesSearch(c, search)) return false;
        if (channelFilter !== "todos" && (c.channel ?? "whatsapp") !== channelFilter)
          return false;
        const country = countryForConversation(c);
        if (countryFilter === "sin_pais" && country !== null) return false;
        if (
          countryFilter !== "todos" &&
          countryFilter !== "sin_pais" &&
          country !== countryFilter
        ) {
          return false;
        }
        if (rutaFilter !== "todas" && rutaDe(c) !== rutaFilter) return false;
        if (labelFilter === "todos") return true;
        if (labelFilter === "no leídos")
          return (c.unread_count ?? 0) > 0 || c.manually_unread === 1;
        return c.nocodb_label === labelFilter;
      }),
    [conversations, search, labelFilter, channelFilter, countryFilter, rutaFilter]
  );
  /**
   * LAS RUTAS EN USO, CON SUS CLIENTES Y VENTAS (20/10/2026). Solo los países donde entra gente por
   * más de una ruta llevan la marca: quien no usa rutas no ve nada nuevo.
   */
  const paisesConRutas = useMemo(() => {
    const porPais = new Map<string, Set<string>>();
    for (const c of conversations) {
      const r = rutaDe(c);
      if (!r) continue;
      const p = countryForConversation(c) ?? "?";
      porPais.set(p, new Set([...(porPais.get(p) ?? []), r]));
    }
    return new Set([...porPais.entries()].filter(([, rs]) => rs.size > 1).map(([p]) => p));
  }, [conversations]);
  const rutasEnUso = useMemo(() => {
    const cuentas = new Map<string, { clientes: number; ventas: number }>();
    for (const c of conversations) {
      const r = rutaDe(c);
      if (!r || !paisesConRutas.has(countryForConversation(c) ?? "?")) continue;
      const k = cuentas.get(r) ?? { clientes: 0, ventas: 0 };
      k.clientes += 1;
      if ((c.paid_total_cents ?? 0) > 0) k.ventas += 1;
      cuentas.set(r, k);
    }
    return [...cuentas.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [conversations, paisesConRutas]);

  const introOptions = useMemo(
    () =>
      Array.from(
        new Set(
          [
            ...introVariants,
            ...conversations.map((c) => c.intro_variant_sent),
          ].filter(
            (v): v is number => typeof v === "number" && Number.isFinite(v)
          )
        )
      ).sort((a, b) => a - b),
    [conversations, introVariants]
  );

  const filtered = useMemo(
    () =>
      baseFiltered.filter((c) => {
        if (introFilter !== "actual" && c.intro_variant_sent !== introFilter)
          return false;
        const dayKey = dayKeyFromUnix(c.created_at);
        if (dateFrom && dayKey < dateFrom) return false;
        if (dateTo && dayKey > dateTo) return false;
        return true;
      }),
    [baseFiltered, introFilter, dateFrom, dateTo]
  );

  const labelCounts = useMemo(() => {
    const counts: Record<LabelFilter, number> = {
      todos: 0,
      "no leídos": 0,
      hot: 0,
      warm: 0,
      pago: 0,
      "pago-reclamo": 0,
      reclamo: 0,
    };
    for (const c of conversations) {
      if (!matchesSearch(c, search)) continue;
      if (channelFilter !== "todos" && (c.channel ?? "whatsapp") !== channelFilter)
        continue;
      if (introFilter !== "actual" && c.intro_variant_sent !== introFilter)
        continue;
      const dayKey = dayKeyFromUnix(c.created_at);
      if (dateFrom && dayKey < dateFrom) continue;
      if (dateTo && dayKey > dateTo) continue;
      counts.todos += 1;
      if ((c.unread_count ?? 0) > 0 || c.manually_unread === 1)
        counts["no leídos"] += 1;
      if (
        c.nocodb_label &&
        Object.prototype.hasOwnProperty.call(counts, c.nocodb_label)
      ) {
        counts[c.nocodb_label as LabelFilter] += 1;
      }
    }
    return counts;
  }, [conversations, search, channelFilter, introFilter, dateFrom, dateTo]);

  const channelCounts = useMemo(() => {
    const counts: Record<ChannelFilter, number> = {
      todos: 0,
      whatsapp: 0,
      messenger: 0,
      instagram: 0,
      tiktok: 0,
    };
    for (const c of conversations) {
      if (!matchesSearch(c, search)) continue;
      const channel = c.channel ?? "whatsapp";
      counts.todos += 1;
      counts[channel] += 1;
    }
    return counts;
  }, [conversations, search]);

  const countryCounts = useMemo(() => {
    const counts: Record<CountryFilter, number> = {
      todos: 0,
      sin_pais: 0,
      PE: 0,
      EC: 0,
      CO: 0,
      MX: 0,
      AR: 0,
      BO: 0,
      GT: 0,
      CR: 0,
      CL: 0,
      SV: 0,
      VE: 0,
    };
    for (const c of conversations) {
      if (!matchesSearch(c, search)) continue;
      if (channelFilter !== "todos" && (c.channel ?? "whatsapp") !== channelFilter)
        continue;
      counts.todos += 1;
      const country = countryForConversation(c);
      if (country) counts[country] += 1;
      else counts.sin_pais += 1;
    }
    return counts;
  }, [conversations, search, channelFilter]);

  const dateLabel =
    dateFrom && dateTo && dateFrom === dateTo
      ? dateFrom
      : dateFrom && dateTo
        ? `${dateFrom} a ${dateTo}`
        : dateFrom
          ? `Desde ${dateFrom}`
          : dateTo
            ? `Hasta ${dateTo}`
            : "Fecha";

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
    <div className="sticky top-0 z-10 border-b border-neutral-200 bg-tarjeta p-2 space-y-2">
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
              // 16px en el celular: por debajo, iOS hace zoom al tocar.
              className="w-full rounded-md border border-neutral-300 px-3 py-2.5 text-base placeholder:text-neutral-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 md:py-2 md:text-sm"
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
      {/* Botón de filtros, SOLO en celular. El punto verde avisa de que hay
          alguno puesto aunque el desplegable esté cerrado. */}
      {!selectionMode && (
        <button
          type="button"
          onClick={() => setFiltrosAbiertos((v) => !v)}
          className="flex w-full items-center justify-between rounded-md border border-neutral-300 bg-tarjeta px-3 py-2.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 md:hidden"
        >
          <span className="flex items-center gap-2">
            Filtros
            {hayFiltrosPuestos && (
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
            )}
          </span>
          <span className="flex items-center gap-3">
            {hayFiltrosPuestos && (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  limpiarFiltros();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.stopPropagation();
                    limpiarFiltros();
                  }
                }}
                className="text-xs font-normal text-neutral-500 underline"
              >
                Limpiar
              </span>
            )}
            <span className="text-neutral-400">
              {filtrosAbiertos ? "▲" : "▼"}
            </span>
          </span>
        </button>
      )}
      {!selectionMode && (
        <div
          className={`grid-cols-[minmax(0,1fr)_auto] gap-2 md:grid ${
            filtrosAbiertos ? "grid" : "hidden"
          }`}
        >
          {/* Uno por línea en el celular, tres en fila en el escritorio. */}
          <div className="grid min-w-0 grid-cols-1 gap-2 md:grid-cols-3">
            <select
              value={channelFilter}
              onChange={(e) => setChannelFilter(e.target.value as ChannelFilter)}
              className="min-w-0 rounded-md border border-neutral-300 bg-tarjeta px-2 py-2.5 text-sm font-medium text-neutral-700 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 md:py-1.5 md:text-xs"
              title="Filtrar por canal"
            >
              <option value="todos">Todos ({channelCounts.todos})</option>
              <option value="whatsapp">WhatsApp ({channelCounts.whatsapp})</option>
              <option value="messenger">Messenger ({channelCounts.messenger})</option>
              <option value="instagram">Instagram ({channelCounts.instagram})</option>
              <option value="tiktok">TikTok ({channelCounts.tiktok})</option>
            </select>
            <select
              value={countryFilter}
              onChange={(e) => setCountryFilter(e.target.value as CountryFilter)}
              className="min-w-0 rounded-md border border-neutral-300 bg-tarjeta px-2 py-2.5 text-sm font-medium text-neutral-700 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 md:py-1.5 md:text-xs"
              title="Filtrar por pais detectado desde el numero"
            >
              <option value="todos">Pais: todos ({countryCounts.todos})</option>
              {COUNTRY_FILTER_OPTIONS.map((country) => (
                <option key={country.code} value={country.code}>
                  {country.flag} {country.label} ({countryCounts[country.code]})
                </option>
              ))}
              <option value="sin_pais">Sin pais ({countryCounts.sin_pais})</option>
            </select>
            {rutasEnUso.length > 0 && (
              <select
                value={rutaFilter}
                onChange={(e) => setRutaFilter(e.target.value)}
                className="min-w-0 rounded-md border border-neutral-300 bg-tarjeta px-2 py-2.5 text-sm font-medium text-neutral-700 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 md:py-1.5 md:text-xs"
                title="Filtrar por la ruta por la que entró (la intro que recibió). Entre paréntesis: clientes y cuántos pagaron."
              >
                <option value="todas">Ruta: todas</option>
                {rutasEnUso.map(([r, k]) => (
                  <option key={r} value={r}>
                    Ruta {r} ({k.clientes} · {k.ventas} venta{k.ventas === 1 ? "" : "s"})
                  </option>
                ))}
              </select>
            )}
            <select
              value={introFilter}
              onChange={(e) =>
                setIntroFilter(
                  e.target.value === "actual" ? "actual" : Number(e.target.value)
                )
              }
              className="min-w-0 rounded-md border border-neutral-300 bg-tarjeta px-2 py-2.5 text-sm font-medium text-neutral-700 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 md:py-1.5 md:text-xs"
              title="Filtrar por intro enviada"
            >
              <option value="actual">Actual</option>
              {introOptions.map((variant) => (
                <option key={variant} value={variant}>
                  Intro {variant}
                </option>
              ))}
            </select>
          </div>
          <div className="relative flex items-center gap-1">
            <button
              type="button"
              onClick={() => setDateMenuOpen((open) => !open)}
              className="max-w-40 truncate rounded-md border border-neutral-300 bg-tarjeta px-2 py-2.5 text-sm text-neutral-700 hover:bg-neutral-50 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 md:py-1.5 md:text-xs"
              title="Filtrar por fecha de entrada"
            >
              {dateLabel}
            </button>
            {(dateFrom || dateTo) && (
              <button
                type="button"
                onClick={() => {
                  setDateFrom("");
                  setDateTo("");
                }}
                className="rounded-md border border-neutral-300 px-2 py-1.5 text-xs text-neutral-500 hover:bg-neutral-50"
                title="Quitar filtro de fecha"
              >
                ×
              </button>
            )}
            {dateMenuOpen && (
              <div className="absolute right-0 top-full z-20 mt-1 w-72 rounded-md border border-neutral-200 bg-tarjeta p-3 shadow-lg">
                <div className="space-y-3">
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-medium text-neutral-500">
                      Una fecha
                    </span>
                    <input
                      type="date"
                      value={dateFrom && dateFrom === dateTo ? dateFrom : ""}
                      onChange={(e) => {
                        setDateFrom(e.target.value);
                        setDateTo(e.target.value);
                      }}
                      className="w-full rounded-md border border-neutral-300 bg-tarjeta px-2 py-1.5 text-xs text-neutral-700 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-medium text-neutral-500">
                        Desde
                      </span>
                      <input
                        type="date"
                        value={dateFrom}
                        onChange={(e) => setDateFrom(e.target.value)}
                        className="w-full rounded-md border border-neutral-300 bg-tarjeta px-2 py-1.5 text-xs text-neutral-700 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-medium text-neutral-500">
                        Hasta
                      </span>
                      <input
                        type="date"
                        value={dateTo}
                        onChange={(e) => setDateTo(e.target.value)}
                        className="w-full rounded-md border border-neutral-300 bg-tarjeta px-2 py-1.5 text-xs text-neutral-700 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                    </label>
                  </div>
                  <div className="flex justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setDateFrom("");
                        setDateTo("");
                      }}
                      className="rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50"
                    >
                      Limpiar
                    </button>
                    <button
                      type="button"
                      onClick={() => setDateMenuOpen(false)}
                      className="rounded-md bg-emerald-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
                    >
                      Aplicar
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      {!selectionMode && (
        // En el celular van en UNA fila que se desliza con el dedo, como las
        // etiquetas de WhatsApp. Antes se apilaban en varias filas y comían
        // media pantalla. En el escritorio siguen ajustándose en varias líneas.
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:mx-0 md:flex-wrap md:gap-1.5 md:overflow-visible md:px-0 md:pb-0">
          {LABEL_OPTIONS.map((opt) => {
            const isActive = labelFilter === opt;
            const base =
              "shrink-0 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm font-medium transition md:px-2.5 md:py-0.5 md:text-[11px]";
            const styles =
              opt === "todos"
                ? isActive
                  ? "bg-carbon-suave text-white border-carbon-suave"
                  : "bg-tarjeta text-neutral-700 border-neutral-300 hover:bg-neutral-50"
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
                {opt} <span className="opacity-70">{labelCounts[opt]}</span>
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
          const country = countryForConversation(c);
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
                title={
                  c.capi_last_ok === 0
                    ? "El último evento no llegó a Meta. Abre el chat para ver el motivo."
                    : undefined
                }
                className={[
                  "group flex items-center gap-2 px-2 transition",
                  // Rojo = a esta conversación le falló el aviso a Meta. Vuelve
                  // a la normalidad sola en cuanto el evento pase.
                  c.capi_last_ok === 0
                    ? "border-l-4 border-red-500 bg-red-50/60"
                    : "border-l-4 border-transparent",
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
                  // Filas más altas en el celular: las de WhatsApp respiran más
                  // y se aciertan mejor con el dedo. El fondo gris al tocar
                  // avisa de que el toque entró.
                  className="min-w-0 flex-1 py-4 text-left transition-colors active:bg-neutral-200 md:py-3"
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
                        <ChannelBadge channel={c.channel ?? "whatsapp"} />
                        {country && (
                          <span
                            title={`Pais detectado por numero: ${COUNTRY_FILTER_OPTIONS.find((item) => item.code === country)?.label ?? country}`}
                            className="shrink-0 text-sm leading-none"
                          >
                            {COUNTRY_FLAG_BY_CODE[country]}
                          </span>
                        )}
                        {/* SU RUTA, solo donde hay más de una en uso (20/10/2026). */}
                        {rutaDe(c) && paisesConRutas.has(country ?? "?") && (
                          <span
                            title={`Entró por la ruta ${rutaDe(c)} (la intro que recibió)`}
                            className="shrink-0 rounded bg-violet-100 px-1 text-[10px] font-bold text-violet-800"
                          >
                            Ruta {rutaDe(c)}
                          </span>
                        )}
                        <div
                          className={`truncate text-base text-neutral-900 md:text-sm ${
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
                        {typeof c.intro_variant_sent === "number" &&
                          Number.isFinite(c.intro_variant_sent) && (
                            <span className="shrink-0 rounded-full border border-neutral-200 bg-neutral-50 px-1.5 py-0 text-[9px] font-medium text-neutral-500">
                              Intro {c.intro_variant_sent}
                            </span>
                          )}
                      </div>
                      <div
                        className={`truncate text-sm md:text-xs ${
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
