"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * Vista Kanban + Panel de ventas (solo lectura).
 *
 * Todo el tablero refleja el PERIODO elegido (Hoy por defecto): se toman los
 * leads que ENTRARON en ese rango (por fecha de creación) y se reparten por su
 * etapa actual (Nuevos / Interesados / Pago pendiente / Pagado S10 / Pagado S8
 * / Leads perdidos / Reclamos). Con "Todos" se ve el histórico completo.
 *
 * BARRA SUPERIOR (termómetro): ventas, conversaron, % de conversión, inversión
 * (manual) y ROAS — del periodo elegido (Hoy por defecto). Todo es de lectura
 * salvo el campo de inversión; NADA de esto le da órdenes al bot.
 *
 * Las tarjetas se hacen clic para abrir el chat. (Se quitó el arrastrar para
 * evitar cambios de estado accidentales.)
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
  nocodb_label?: string | null;
  had_emergency?: number;
}

interface Props {
  conversations: KanbanConversation[];
  onSelect: (id: number) => void;
  onStateChanged: () => void;
}

/** Días sin actividad (sin comprar) para contar un lead como "perdido". */
const LOST_DAYS = 3;

const BUYER_STATES = new Set<string>([
  "payment_approved",
  "awaiting_email",
  "awaiting_gift_consent",
  "awaiting_facebook_comment",
]);

function isBuyer(c: KanbanConversation): boolean {
  return (
    (!!c.state && BUYER_STATES.has(c.state)) || (c.paid_total_cents ?? 0) > 0
  );
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

// Fechas ancladas a HORA DE PERÚ (America/Lima, UTC-5).
function localDateStr(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(d);
}
function dayStartUnix(dateStr: string): number {
  return Math.floor(new Date(`${dateStr}T05:00:00Z`).getTime() / 1000);
}
function dayEndUnix(dateStr: string): number {
  return dayStartUnix(dateStr) + 86400 - 1;
}

/** Tarjeta de lead (clic para abrir el chat). Opcionalmente muestra el monto. */
function Card({
  convo,
  onClick,
  showMoney,
}: {
  convo: KanbanConversation;
  onClick: () => void;
  showMoney?: boolean;
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
        {showMoney && (
          <span className="shrink-0 font-semibold text-emerald-700">
            {fmtMoney(convo.paid_total_cents ?? 0)}
          </span>
        )}
      </div>
      {convo.last_message_preview && (
        <div className="truncate text-[11px] text-neutral-500">
          {convo.last_message_preview}
        </div>
      )}
    </div>
  );
}

/** Columna genérica (solo lectura). Si moneyCents != null, muestra la suma. */
function Column({
  label,
  color,
  conversations,
  onSelect,
  moneyCents,
}: {
  label: string;
  color: string;
  conversations: KanbanConversation[];
  onSelect: (id: number) => void;
  moneyCents?: number | null;
}) {
  return (
    <div className="flex h-full w-60 flex-shrink-0 flex-col rounded-md border border-neutral-200 bg-neutral-50">
      <div
        className={`flex flex-col gap-0.5 rounded-t-md border-b border-neutral-200 px-3 py-2 ${color}`}
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold">{label}</span>
          <span className="text-[10px] opacity-75">{conversations.length}</span>
        </div>
        {moneyCents != null && (
          <span className="text-sm font-bold">{fmtMoney(moneyCents)}</span>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {conversations.map((c) => (
          <Card
            key={c.id}
            convo={c}
            onClick={() => onSelect(c.id)}
            showMoney={moneyCents != null}
          />
        ))}
      </div>
    </div>
  );
}

export default function KanbanBoard({ conversations, onSelect }: Props) {
  // Filtro por rango. Por defecto HOY (hora Perú). "Todos" lo limpia.
  const [fromStr, setFromStr] = useState<string>(() => localDateStr(new Date()));
  const [toStr, setToStr] = useState<string>(() => localDateStr(new Date()));
  const [spendCents, setSpendCents] = useState<number>(0);
  const [spendInput, setSpendInput] = useState<string>("");

  const rangeActive = fromStr !== "" || toStr !== "";
  const fromUnix = fromStr ? dayStartUnix(fromStr) : null;
  const toUnix = toStr ? dayEndUnix(toStr) : null;
  const isSingleDay = fromStr !== "" && fromStr === toStr;

  function inRange(t: number): boolean {
    if (fromUnix !== null && t < fromUnix) return false;
    if (toUnix !== null && t > toUnix) return false;
    return true;
  }

  // ── COHORTE DEL PERIODO: todos los leads que ENTRARON en el rango elegido
  //    (por fecha de creación). TODO el tablero refleja este grupo, así "Hoy"
  //    muestra solo lo de hoy (perdidos ≈ 0) y "Todos" muestra el histórico. ──
  const periodConvos = useMemo(() => {
    if (!rangeActive) return conversations;
    return conversations.filter((c) => inRange(c.created_at ?? 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations, rangeActive, fromUnix, toUnix]);

  // Embudo (los que NO compraron, dentro del periodo) por etapa actual.
  const pipeline = useMemo(() => {
    const cols = {
      nuevos: [] as KanbanConversation[],
      interesados: [] as KanbanConversation[],
      pendiente: [] as KanbanConversation[],
      perdidos: [] as KanbanConversation[],
      reclamos: [] as KanbanConversation[],
    };
    const now = Math.floor(Date.now() / 1000);
    for (const c of periodConvos) {
      if (isBuyer(c)) continue; // los compradores van a sus columnas
      if (c.had_emergency) {
        cols.reclamos.push(c);
        continue;
      }
      if (c.state === "payment_done") {
        cols.pendiente.push(c);
        continue;
      }
      const last = c.last_message_at ?? c.created_at ?? 0;
      if (last && now - last > LOST_DAYS * 86400) {
        cols.perdidos.push(c);
        continue;
      }
      if (c.nocodb_label === "hot") {
        cols.interesados.push(c);
        continue;
      }
      cols.nuevos.push(c);
    }
    return cols;
  }, [periodConvos]);

  // Compradores dentro del periodo (mismo grupo que entró en el rango).
  const buyers = useMemo(() => periodConvos.filter(isBuyer), [periodConvos]);
  const buyers10 = buyers.filter((c) => !c.discount_active);
  const buyers8 = buyers.filter((c) => !!c.discount_active);

  const revenueCents = buyers.reduce((a, c) => a + (c.paid_total_cents ?? 0), 0);
  const cents10 = buyers10.reduce((a, c) => a + (c.paid_total_cents ?? 0), 0);
  const cents8 = buyers8.reduce((a, c) => a + (c.paid_total_cents ?? 0), 0);

  // Termómetro: del mismo grupo (los que entraron en el periodo).
  const conversaron = periodConvos.length;
  const compraron = buyers.length;
  const conversionPct = conversaron > 0 ? (compraron / conversaron) * 100 : 0;

  // ── INVERSIÓN / ROAS ──
  useEffect(() => {
    const params = new URLSearchParams();
    if (fromStr) params.set("from", fromStr);
    if (toStr) params.set("to", toStr);
    let cancelled = false;
    fetch(`/api/ad-spend?${params.toString()}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { total_cents?: number }) => {
        if (cancelled) return;
        const cents = d.total_cents ?? 0;
        setSpendCents(cents);
        setSpendInput(cents > 0 ? String(cents / 100) : "");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [fromStr, toStr]);

  async function saveSpend() {
    if (!isSingleDay) return;
    const soles = parseFloat(spendInput);
    if (!Number.isFinite(soles) || soles < 0) return;
    try {
      await fetch("/api/ad-spend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: fromStr, amount_soles: soles }),
      });
      setSpendCents(Math.round(soles * 100));
    } catch {
      // silencioso
    }
  }

  const roas = spendCents > 0 ? revenueCents / spendCents : null;

  function setHoy() {
    const t = localDateStr(new Date());
    setFromStr(t);
    setToStr(t);
  }
  function clearRange() {
    setFromStr("");
    setToStr("");
  }

  const periodLabel = !rangeActive
    ? "Todos"
    : isSingleDay
    ? fromStr
    : `${fromStr || "…"} → ${toStr || "…"}`;

  return (
    <div className="flex h-full flex-col">
      {/* ── Barra: termómetro de ventas ─────────────────────────────────── */}
      <div className="border-b border-neutral-200 bg-white px-4 py-2">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          {/* Ventas */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              💰 Ventas
            </span>
            <span className="text-lg font-bold text-emerald-700">
              {fmtMoney(revenueCents)}
            </span>
            <span className="text-[11px] text-neutral-400">
              S/10: {fmtMoney(cents10)} ({buyers10.length}) · S/8:{" "}
              {fmtMoney(cents8)} ({buyers8.length})
            </span>
          </div>

          {/* Conversaron / Compraron / Conversión */}
          <div className="flex items-center gap-4">
            <span className="text-xs text-neutral-600">
              💬 Conversaron:{" "}
              <span className="font-bold text-neutral-800">{conversaron}</span>
            </span>
            <span className="text-xs text-neutral-600">
              🛒 Compraron:{" "}
              <span className="font-bold text-neutral-800">{compraron}</span>
            </span>
            <span className="text-xs text-neutral-600">
              📈 Conversión:{" "}
              <span className="font-bold text-sky-700">
                {conversionPct.toFixed(1)}%
              </span>
            </span>
          </div>

          {/* Inversión + ROAS */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-neutral-600">💸 Inversión:</span>
            {isSingleDay ? (
              <span className="flex items-center gap-1">
                <span className="text-xs text-neutral-500">S/</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={spendInput}
                  onChange={(e) => setSpendInput(e.target.value)}
                  onBlur={saveSpend}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  }}
                  placeholder="0"
                  className="w-20 rounded border border-neutral-300 px-2 py-1 text-xs"
                />
              </span>
            ) : (
              <span className="text-xs font-bold text-neutral-800">
                {fmtMoney(spendCents)}
              </span>
            )}
            <span className="ml-2 text-xs text-neutral-600">📊 ROAS:</span>
            <span
              className={`text-sm font-bold ${
                roas == null
                  ? "text-neutral-400"
                  : roas >= 1
                  ? "text-emerald-700"
                  : "text-red-600"
              }`}
            >
              {roas == null ? "—" : `${roas.toFixed(2)}x`}
            </span>
          </div>
        </div>

        {/* Controles de fecha */}
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-dashed border-neutral-200 pt-2">
          <span className="text-xs font-medium text-neutral-600">
            📅 Periodo: <span className="font-semibold">{periodLabel}</span>
          </span>
          <span className="ml-auto text-xs font-medium text-neutral-600">
            Desde
          </span>
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
          <button
            onClick={clearRange}
            className="rounded border border-neutral-300 bg-white px-2 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-100"
          >
            Todos
          </button>
        </div>
        {isSingleDay ? (
          <p className="mt-1 text-[10px] text-neutral-400">
            Todo el tablero refleja el periodo elegido (leads que entraron en
            esas fechas). La inversión se ingresa por día (elige un solo día).
          </p>
        ) : (
          <p className="mt-1 text-[10px] text-neutral-400">
            Inversión: suma del periodo (para editarla, elige un solo día).
          </p>
        )}
      </div>

      {/* ── Tablero ───────────────────────────────────────────────────── */}
      <div className="flex flex-1 gap-3 overflow-x-auto p-3">
        <Column
          label="🆕 Nuevos"
          color="bg-neutral-100 text-neutral-700 border-neutral-300"
          conversations={pipeline.nuevos}
          onSelect={onSelect}
        />
        <Column
          label="🔥 Interesados"
          color="bg-rose-50 text-rose-700 border-rose-300"
          conversations={pipeline.interesados}
          onSelect={onSelect}
        />
        <Column
          label="💳 Pago pendiente"
          color="bg-amber-50 text-amber-700 border-amber-300"
          conversations={pipeline.pendiente}
          onSelect={onSelect}
        />

        {/* Separador: embudo | compradores */}
        <div className="flex-shrink-0 self-stretch border-l-2 border-dashed border-neutral-300" />

        <Column
          label="✅ Pagado S/10"
          color="bg-emerald-50 text-emerald-700 border-emerald-300"
          conversations={buyers10}
          onSelect={onSelect}
          moneyCents={cents10}
        />
        <Column
          label="✅ Pagado S/8"
          color="bg-emerald-100 text-emerald-800 border-emerald-300"
          conversations={buyers8}
          onSelect={onSelect}
          moneyCents={cents8}
        />

        {/* Separador: compradores | otros */}
        <div className="flex-shrink-0 self-stretch border-l-2 border-dashed border-neutral-300" />

        <Column
          label="❄️ Leads perdidos"
          color="bg-sky-50 text-sky-700 border-sky-300"
          conversations={pipeline.perdidos}
          onSelect={onSelect}
        />
        <Column
          label="⚠️ Reclamos"
          color="bg-fuchsia-50 text-fuchsia-700 border-fuchsia-300"
          conversations={pipeline.reclamos}
          onSelect={onSelect}
        />
      </div>
    </div>
  );
}
