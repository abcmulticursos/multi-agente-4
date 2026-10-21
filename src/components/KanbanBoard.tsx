"use client";

import { useEffect, useMemo, useState } from "react";
import {
  COUNTRIES,
  DEFAULT_COUNTRY,
  countryFromPhone,
  countryOfConversation,
  resolveCountry,
  type CountryCode,
} from "@/lib/countries";
import {
  origenDeLead,
  vinoDeAnuncio,
  type OrigenDeLead,
} from "@/lib/origen-de-lead";

/**
 * Vista Kanban + Panel de ventas (solo lectura).
 *
 * Todo el tablero refleja el PERIODO elegido (Hoy por defecto): se toman los
 * leads que ENTRARON en ese rango (por fecha de creación) y se reparten por su
 * etapa actual (Nuevos / Interesados / Pago pendiente / Precio normal / Precio
 * con descuento / Leads perdidos / Reclamos). Con "Todos" se ve el histórico.
 *
 * MONEDAS: cada venta se cuenta en la moneda del país del cliente (Perú soles,
 * Ecuador dólares…). Los importes NUNCA se suman entre monedas: o se muestran
 * por separado, o se convierten con el tipo de cambio que escribe el usuario
 * ("1 dólar = X"). El selector "Ver en" cambia todo el tablero de moneda y las
 * banderas filtran por país. Todo esto es de visualización — no toca al bot.
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
  channel?: "whatsapp" | "messenger" | "instagram" | "tiktok" | null;
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
  last_user_message_at?: number | null;
  ctwa_clid?: string | null;
  ad_source_id?: string | null;
  /** ISO del pais del cliente (PE, EC, MX...). Define en que moneda pago. */
  country_code?: string | null;
  /**
   * LA TIENDA QUE ATENDIO ESTA CONVERSACION, y su color.
   *
   * LOS PONE EL SERVIDOR, en `/api/conversations`, con la misma funcion que usa el bot para
   * vender. Aqui no se deduce de nada: si llegan vacios es que esa conversacion entro por un
   * numero que no pertenece a ninguna tienda, y eso es un dato, no un fallo.
   */
  tienda_nombre?: string | null;
  tienda_color?: string | null;
  /** "comment" cuando el lead nacio de un comentario de Facebook. */
  lead_origin?: string | null;
}

// ── ORIGENES ────────────────────────────────────────────────────────────────
// De donde vino el lead. No basta el canal: importa si llego por un anuncio,
// de forma organica o por un comentario, porque cada via cuesta y rinde
// distinto.

const ORIGENES: Array<{ key: string; label: string }> = [
  { key: "wa_ad", label: "🟢 WhatsApp · anuncio" },
  { key: "wa_org", label: "🟢 WhatsApp · orgánico" },
  { key: "fb_comment", label: "💬 Comentarios de Facebook" },
  { key: "fb_ad", label: "🔵 Messenger · anuncio" },
  { key: "fb_org", label: "🔵 Messenger · orgánico" },
  { key: "ig", label: "🟣 Instagram" },
  { key: "otro", label: "⚪ Otros" },
];

/** Cómo se pinta el origen en la tarjeta. Tres vías, los mismos tres que
 *  distingue el chat y que ofrece el filtro de arriba. */
const NOMBRE_DE_ORIGEN: Record<OrigenDeLead, string> = {
  anuncio: "Anuncio",
  comentario: "Comentario",
  organico: "Orgánico",
};

const INSIGNIA_DE_ORIGEN: Record<OrigenDeLead, string> = {
  anuncio:
    "rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-violet-700",
  comentario:
    "rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-amber-700",
  organico:
    "rounded border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-sky-700",
};

function origenDe(c: KanbanConversation): string {
  // La misma regla que usa el chat, para que las dos pantallas no discrepen.
  const deAnuncio = vinoDeAnuncio(c);
  if (c.lead_origin === "comment") return "fb_comment";
  const canal = String(c.channel ?? "whatsapp");
  if (canal === "whatsapp") return deAnuncio ? "wa_ad" : "wa_org";
  if (canal === "messenger") return deAnuncio ? "fb_ad" : "fb_org";
  if (canal === "instagram") return "ig";
  return "otro";
}

/** Los paises y sus monedas salen del mismo modulo que usa el bot, para que
 *  el tablero y las ventas nunca discrepen. */
const CODIGOS = Object.keys(COUNTRIES) as CountryCode[];

/** Bandera a partir del ISO del pais (PE -> 🇵🇪). */
function bandera(code: string): string {
  return code
    .toUpperCase()
    .replace(/[A-Z]/g, (c) =>
      String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65)
    );
}

/** Simbolo por MONEDA (varios paises comparten el dolar). */
const SIMBOLO: Record<string, string> = (() => {
  const mapa: Record<string, string> = { USD: "$", PEN: "S/" };
  for (const code of CODIGOS) {
    const info = COUNTRIES[code];
    if (!mapa[info.currency]) mapa[info.currency] = info.symbol;
  }
  return mapa;
})();

/**
 * Pais de una conversacion, con la MISMA regla que usa el bot: en WhatsApp
 * manda la lada del telefono (el country_code no se guarda en ese canal);
 * en Messenger y el simulador manda la seleccion explicita.
 */
// El criterio vive en lib/countries para que el Kanban y la pantalla de
// resultados cuenten el mismo dinero en el mismo país.
function paisDe(convo: KanbanConversation): CountryCode {
  return countryOfConversation(convo);
}

function monedaDe(convo: KanbanConversation): string {
  return COUNTRIES[paisDe(convo)].currency;
}

/** Cajón de inversión que no pertenece a ningún país. Se lleva en dólares. */
const CAJON_GENERAL = "GLOBAL";

/** Moneda de un código de país, o dólares para el cajón general. */
function monedaDePais(code: string): string {
  return code === CAJON_GENERAL ? "USD" : COUNTRIES[resolveCountry(code)].currency;
}

interface Props {
  conversations: KanbanConversation[];
  onSelect: (id: number) => void;
  onStateChanged: () => void;
}

/** Horas sin que el CLIENTE escriba para contar un lead como "perdido".
 *  24h = cuando se cierra la ventana de WhatsApp (ya no se le puede escribir
 *  libremente), así que ya está prácticamente perdido. */
const LOST_HOURS = 24;

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

function fmtMoney(cents: number, currency = "PEN"): string {
  return (
    (SIMBOLO[currency] ?? currency) +
    " " +
    (cents / 100).toLocaleString("es-PE", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    })
  );
}

/** Importes agrupados por moneda: {PEN: 42000, USD: 3600}. */
type PorMoneda = Record<string, number>;

function sumarPorMoneda(lista: KanbanConversation[]): PorMoneda {
  const total: PorMoneda = {};
  for (const c of lista) {
    const m = monedaDe(c);
    total[m] = (total[m] ?? 0) + (c.paid_total_cents ?? 0);
  }
  return total;
}

/**
 * Convierte importes a una sola moneda usando el tipo de cambio que escribe
 * el usuario: cuantas unidades de esa moneda vale 1 dolar. El dolar es 1.
 * Devuelve null si falta la tasa de alguna moneda con importe — asi el panel
 * avisa en vez de mostrar un numero inventado.
 */
function convertir(
  porMoneda: PorMoneda,
  destino: string,
  tasas: Record<string, string>
): number | null {
  const tasaDe = (m: string): number | null => {
    if (m === "USD") return 1;
    const v = parseFloat((tasas[m] ?? "").replace(",", "."));
    return Number.isFinite(v) && v > 0 ? v : null;
  };
  const tasaDestino = tasaDe(destino);
  if (tasaDestino === null) return null;
  let acumulado = 0;
  for (const [moneda, cents] of Object.entries(porMoneda)) {
    if (cents === 0) continue;
    const tasa = tasaDe(moneda);
    if (tasa === null) return null;
    acumulado += (cents / tasa) * tasaDestino;
  }
  return Math.round(acumulado);
}

function buyerAttribution(convo: KanbanConversation): "ad" | "organic" {
  // Misma regla que el chat y que el filtro de orígenes. El reparto del DINERO
  // sigue siendo de dos vías a propósito: un lead de comentario cuenta como
  // orgánico, igual que antes, para no mover el ROAS.
  return vinoDeAnuncio(convo) ? "ad" : "organic";
}

function channelLabel(channel: KanbanConversation["channel"]): string {
  if (channel === "messenger") return "Messenger";
  if (channel === "instagram") return "Instagram";
  if (channel === "tiktok") return "TikTok";
  return "WhatsApp";
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
      className="mb-2 cursor-pointer rounded-md border border-neutral-200 bg-tarjeta p-2 shadow-sm hover:border-emerald-300"
    >
      <div className="mb-1 flex items-center justify-between gap-1 text-xs font-medium text-neutral-900">
        <span className="flex items-center gap-1 truncate">
          {convo.pinned ? <span className="text-amber-500">📌</span> : null}
          <span className="truncate">{convo.name || convo.phone}</span>
        </span>
        {showMoney && (
          <span className="shrink-0 font-semibold text-emerald-700">
            {bandera(paisDe(convo))}{" "}
            {fmtMoney(convo.paid_total_cents ?? 0, monedaDe(convo))}
          </span>
        )}
      </div>
      {/* El origen va en TODAS las tarjetas, no solo en las de venta. Saber si
          un lead entró orgánico importa mientras lo trabajas, no únicamente
          cuando ya compró. */}
      <div className="mb-1 flex flex-wrap items-center gap-1 text-[10px] font-semibold">
        {/* LA TIENDA, CON SU COLOR — delante del origen porque al mirar varias tiendas a la
            vez es lo primero que hace falta saber: de quien es esta venta.

            EL COLOR ES EL QUE EL ELIGIO en Ajustes, el mismo que ve en las fachadas del
            editor. Dos sitios con el mismo color para la misma tienda es lo que permite
            reconocerla sin leer.

            Se pinta con `style` y no con una clase porque es un color que escribe el usuario:
            Tailwind no puede generar clases para colores que no conoce al compilar. */}
        {convo.tienda_nombre && (
          <span
            className="rounded px-1.5 py-0.5 text-white"
            style={{ backgroundColor: convo.tienda_color || "#14b8a6" }}
          >
            {convo.tienda_nombre}
          </span>
        )}
        <span className={INSIGNIA_DE_ORIGEN[origenDeLead(convo)]}>
          {NOMBRE_DE_ORIGEN[origenDeLead(convo)]}
        </span>
        {showMoney && (
          <span className="text-neutral-400">{channelLabel(convo.channel)}</span>
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
  moneyLabel,
}: {
  label: string;
  color: string;
  conversations: KanbanConversation[];
  onSelect: (id: number) => void;
  /** Texto ya formateado con la suma de la columna. null = columna sin dinero. */
  moneyLabel?: string | null;
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
        {moneyLabel != null && (
          <span className="text-sm font-bold">{moneyLabel}</span>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {conversations.map((c) => (
          <Card
            key={c.id}
            convo={c}
            onClick={() => onSelect(c.id)}
            showMoney={moneyLabel != null}
          />
        ))}
      </div>
    </div>
  );
}

export default function KanbanBoard({ conversations, onSelect }: Props) {
  const [origenFiltro, setOrigenFiltro] = useState<string | null>(null);
  /** La tienda elegida, por su nombre. `null` = todas juntas, como siempre. */
  const [tiendaFiltro, setTiendaFiltro] = useState<string | null>(null);
  // Filtro por rango. Por defecto HOY (hora Perú). "Todos" lo limpia.
  const [fromStr, setFromStr] = useState<string>(() => localDateStr(new Date()));
  const [toStr, setToStr] = useState<string>(() => localDateStr(new Date()));
  const [spendCents, setSpendCents] = useState<number>(0);
  const [spendInput, setSpendInput] = useState<string>("");
  /** Inversión día a día del rango elegido, para poder editarla completa. */
  const [spendPorDia, setSpendPorDia] = useState<Record<string, string>>({});
  const [verDias, setVerDias] = useState(false);
  /** Inversión del periodo agrupada por país: { PE: 42000, EC: 1500 }. */
  const [spendPorPais, setSpendPorPais] = useState<Record<string, number>>({});

  // ── MONEDAS ──
  // "original" = cada venta en la moneda en que se cobro. Cualquier otro valor
  // es un codigo de moneda: todo el tablero se recalcula a esa moneda.
  const [verEn, setVerEn] = useState<string>("original");
  // Tipo de cambio que escribe el usuario: cuantas unidades vale 1 dolar.
  // Se guarda en el navegador; es un ajuste de visualizacion, no toca al bot.
  const [tasas, setTasas] = useState<Record<string, string>>({});
  const [paisFiltro, setPaisFiltro] = useState<string | null>(null);

  useEffect(() => {
    try {
      const guardado = localStorage.getItem("kanban_tasas");
      if (guardado) setTasas(JSON.parse(guardado) as Record<string, string>);
      const vista = localStorage.getItem("kanban_ver_en");
      if (vista) setVerEn(vista);
    } catch {
      // Sin almacenamiento disponible: se trabaja con los valores por defecto.
    }
  }, []);

  function cambiarTasa(moneda: string, valor: string) {
    const siguiente = { ...tasas, [moneda]: valor };
    setTasas(siguiente);
    try {
      localStorage.setItem("kanban_tasas", JSON.stringify(siguiente));
    } catch {
      // Sin almacenamiento: la tasa vale solo para esta sesion.
    }
  }

  function cambiarVista(valor: string) {
    setVerEn(valor);
    try {
      localStorage.setItem("kanban_ver_en", valor);
    } catch {
      // Sin almacenamiento: la vista vale solo para esta sesion.
    }
  }

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
    const base = rangeActive
      ? conversations.filter((c) => inRange(c.created_at ?? 0))
      : conversations;
    // Filtro por bandera: al elegir un pais, el tablero entero muestra solo
    // sus leads y sus importes quedan en la moneda de ese pais.
    const porPais = paisFiltro
      ? base.filter((c) => paisDe(c) === paisFiltro)
      : base;
    // Filtro por origen: mismo tablero, pero solo los leads de esa via.
    const porOrigen = origenFiltro
      ? porPais.filter((c) => origenDe(c) === origenFiltro)
      : porPais;
    /**
     * FILTRO POR TIENDA — y no solo ordena las tarjetas: ARREGLA LAS CUENTAS.
     *
     * LO PIDIO EL 08/10/2026: «necesito que el kanban tambien sea por tienda».
     *
     * Con dos tiendas vendiendo a la vez, «Precio normal» sumaba en un mismo numero ventas de
     * productos distintos a precios distintos. Veia S/. 48 y no sabia cuanto era de cada una.
     * Al elegir una tienda, ese numero por fin significa algo.
     *
     * VA EL ULTIMO, detras del pais y del origen, por la misma razon que ellos van en ese
     * orden: cada filtro recorta lo que dejo el anterior, y el tablero entero —tarjetas,
     * contadores y dinero— sale de esta misma lista. Ver `periodConvos`.
     */
    return tiendaFiltro
      ? porOrigen.filter((c) => (c.tienda_nombre ?? "") === tiendaFiltro)
      : porOrigen;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    conversations,
    rangeActive,
    fromUnix,
    toUnix,
    paisFiltro,
    origenFiltro,
    tiendaFiltro,
  ]);

  /** Cuantos leads hay por origen en el periodo — para el desplegable. */
  const conteoPorOrigen = useMemo(() => {
    const base = rangeActive
      ? conversations.filter((c) => inRange(c.created_at ?? 0))
      : conversations;
    const conteo: Record<string, number> = {};
    for (const c of base) {
      if (paisFiltro && paisDe(c) !== paisFiltro) continue;
      const key = origenDe(c);
      conteo[key] = (conteo[key] ?? 0) + 1;
    }
    return conteo;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations, rangeActive, fromUnix, toUnix, paisFiltro]);

  /**
   * LAS TIENDAS QUE DE VERDAD TIENEN LEADS, con cuantos y de que color.
   *
   * SE SACAN DE LAS CONVERSACIONES, no de la configuracion. Una tienda recien creada y sin
   * una sola venta no pinta nada en este desplegable: aqui se elige entre lo que hay, no
   * entre lo que podria haber. Es el mismo criterio que ya usan el de pais y el de origen.
   *
   * RESPETA EL PAIS Y EL ORIGEN YA ELEGIDOS, para que los numeros del desplegable cuadren con
   * lo que se va a ver al elegir. Un «(12)» que luego enseña 3 tarjetas confunde mas que
   * ayudar.
   */
  const tiendasConLeads = useMemo(() => {
    const base = rangeActive
      ? conversations.filter((c) => inRange(c.created_at ?? 0))
      : conversations;
    const porNombre = new Map<string, { cuantos: number; color: string | null }>();
    for (const c of base) {
      if (paisFiltro && paisDe(c) !== paisFiltro) continue;
      if (origenFiltro && origenDe(c) !== origenFiltro) continue;
      const nombre = (c.tienda_nombre ?? "").trim();
      if (!nombre) continue;
      const yaEsta = porNombre.get(nombre);
      porNombre.set(nombre, {
        cuantos: (yaEsta?.cuantos ?? 0) + 1,
        color: yaEsta?.color ?? (c.tienda_color ?? null),
      });
    }
    return [...porNombre.entries()]
      .map(([nombre, datos]) => ({ nombre, ...datos }))
      .sort((a, b) => b.cuantos - a.cuantos);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations, rangeActive, fromUnix, toUnix, paisFiltro, origenFiltro]);

  /** Cuantos leads hay por pais en el periodo — para el desplegable. */
  const conteoPorPais = useMemo(() => {
    const base = rangeActive
      ? conversations.filter((c) => inRange(c.created_at ?? 0))
      : conversations;
    const conteo: Record<string, number> = {};
    for (const c of base) {
      const code = paisDe(c);
      conteo[code] = (conteo[code] ?? 0) + 1;
    }
    return conteo;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations, rangeActive, fromUnix, toUnix]);

  /** Días del rango elegido, para editar la inversión de cada uno. Se limita
   *  a 92 días para no dibujar una lista interminable con "Todos". */
  const diasDelRango = useMemo(() => {
    if (!fromStr || !toStr) return [];
    const dias: string[] = [];
    const desde = new Date(`${fromStr}T12:00:00Z`);
    const hasta = new Date(`${toStr}T12:00:00Z`);
    for (let d = desde; d <= hasta && dias.length < 92; d.setUTCDate(d.getUTCDate() + 1)) {
      dias.push(d.toISOString().slice(0, 10));
    }
    return dias;
  }, [fromStr, toStr]);

  /** Paises con al menos un lead, primero en la lista. */
  const paisesPresentes = useMemo(
    () => (Object.keys(conteoPorPais) as CountryCode[]).sort(),
    [conteoPorPais]
  );

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
      // Ventana de 24h: contamos desde el ÚLTIMO mensaje DEL CLIENTE (los
      // seguimientos del bot NO reabren la ventana, por eso no usamos
      // last_message_at). Fallback a la creación si nunca escribió.
      const lastUser = c.last_user_message_at ?? c.created_at ?? 0;
      if (lastUser && now - lastUser > LOST_HOURS * 3600) {
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
  const adBuyers = buyers.filter((c) => buyerAttribution(c) === "ad");
  const organicBuyers = buyers.filter(
    (c) => buyerAttribution(c) === "organic"
  );

  // Todos los importes se agrupan POR MONEDA. Nunca se suman soles con
  // dolares: o se muestran por separado, o se convierten con el tipo de
  // cambio que escribe el usuario.
  const revenuePorMoneda = sumarPorMoneda(buyers);
  const adRevenuePorMoneda = sumarPorMoneda(adBuyers);
  const organicRevenuePorMoneda = sumarPorMoneda(organicBuyers);
  const porMoneda10 = sumarPorMoneda(buyers10);
  const porMoneda8 = sumarPorMoneda(buyers8);

  /** Monedas que aparecen en las ventas del periodo, para pedir su tasa. */
  const monedasEnJuego = useMemo(() => {
    const vistas = new Set<string>(Object.keys(revenuePorMoneda));
    if (verEn !== "original") vistas.add(verEn);
    vistas.delete("USD"); // el dolar es la referencia, siempre vale 1
    return Array.from(vistas).sort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(revenuePorMoneda), verEn]);

  /** Texto de un importe segun la vista elegida. */
  function mostrar(porMoneda: PorMoneda): string {
    const conImporte = Object.entries(porMoneda).filter(([, c]) => c !== 0);
    if (verEn === "original") {
      if (conImporte.length === 0) return fmtMoney(0, "PEN");
      return conImporte
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([moneda, cents]) => fmtMoney(cents, moneda))
        .join(" · ");
    }
    const convertido = convertir(porMoneda, verEn, tasas);
    return convertido === null ? "falta tipo de cambio" : fmtMoney(convertido, verEn);
  }

  /** Importe en la moneda de vista, para calculos (ROAS, ganancia). */
  function enMonedaVista(porMoneda: PorMoneda): number | null {
    if (verEn === "original") {
      const monedas = Object.keys(porMoneda).filter((m) => porMoneda[m] !== 0);
      if (monedas.length === 0) return 0;
      if (monedas.length === 1) return porMoneda[monedas[0]];
      return null; // mezcla de monedas: no se puede dar una sola cifra
    }
    return convertir(porMoneda, verEn, tasas);
  }

  // Termómetro: del mismo grupo (los que entraron en el periodo).
  const conversaron = periodConvos.length;
  const compraron = buyers.length;
  const noCompraron = Math.max(0, conversaron - compraron);
  const conversionPct = conversaron > 0 ? (compraron / conversaron) * 100 : 0;

  // ── INVERSIÓN / ROAS ──
  useEffect(() => {
    const params = new URLSearchParams();
    if (fromStr) params.set("from", fromStr);
    if (toStr) params.set("to", toStr);
    // Desglose por día del cajón que se está editando: el país elegido, o el
    // cajón general (en dólares) cuando se ven todos los países.
    if (fromStr && toStr) {
      params.set("detail", "1");
      params.set("country", paisFiltro ?? CAJON_GENERAL);
    }
    let cancelled = false;
    fetch(`/api/ad-spend?${params.toString()}`, { cache: "no-store" })
      .then((r) => r.json())
      .then(
        (d: {
          total_cents?: number;
          by_country?: Record<string, number>;
          days?: Array<{ date: string; amount_cents: number }>;
        }) => {
          if (cancelled) return;
          const porPais = d.by_country ?? {};
          setSpendPorPais(porPais);
          const propio = porPais[paisFiltro ?? CAJON_GENERAL] ?? 0;
          setSpendCents(propio);
          setSpendInput(propio > 0 ? String(propio / 100) : "");
          const porDia: Record<string, string> = {};
          for (const fila of d.days ?? []) {
            if (fila.amount_cents > 0) porDia[fila.date] = String(fila.amount_cents / 100);
          }
          setSpendPorDia(porDia);
        }
      )
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [fromStr, toStr, paisFiltro]);

  /** Guarda la inversión de UN día del rango y recalcula el total mostrado. */
  async function guardarDia(fecha: string, valor: string) {
    const monto = valor.trim() === "" ? 0 : parseFloat(valor.replace(",", "."));
    if (!Number.isFinite(monto) || monto < 0) return;
    try {
      await fetch("/api/ad-spend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: fecha,
          country: destinoInversion,
          amount: monto,
        }),
      });
    } catch {
      return; // sin conexión: no tocamos el total para no mentir
    }
    const siguiente = { ...spendPorDia, [fecha]: valor };
    setSpendPorDia(siguiente);
    const total = Object.values(siguiente).reduce((a, v) => {
      const n = parseFloat((v ?? "").replace(",", "."));
      return a + (Number.isFinite(n) ? n : 0);
    }, 0);
    const cents = Math.round(total * 100);
    setSpendCents(cents);
    setSpendPorPais({ ...spendPorPais, [destinoInversion]: cents });
  }

  async function saveSpend() {
    if (!isSingleDay) return;
    const monto = parseFloat((spendInput || "0").replace(",", "."));
    if (!Number.isFinite(monto) || monto < 0) return;
    try {
      await fetch("/api/ad-spend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: fromStr,
          country: destinoInversion,
          amount: monto,
        }),
      });
      const cents = Math.round(monto * 100);
      setSpendCents(cents);
      setSpendPorPais({ ...spendPorPais, [destinoInversion]: cents });
    } catch {
      // silencioso
    }
  }

  // La inversión se registra por país, cada una en la moneda de ese país, y
  // se agrupa igual que las ventas. Con un país filtrado, solo cuenta el suyo.
  const spendPorMoneda: PorMoneda = (() => {
    const total: PorMoneda = {};
    for (const [code, cents] of Object.entries(spendPorPais)) {
      // Con un país filtrado solo cuenta el suyo; la inversión general queda
      // fuera porque no pertenece a ningún mercado concreto.
      if (paisFiltro && code !== paisFiltro) continue;
      if (!cents) continue;
      const moneda = monedaDePais(code);
      total[moneda] = (total[moneda] ?? 0) + cents;
    }
    return total;
  })();
  /** Moneda en la que se escribe la inversión: la del país, o dólares si es
   *  la inversión general (sin país). */
  const monedaInversion = paisFiltro ? monedaDePais(paisFiltro) : "USD";
  /** Código con el que se guarda lo que se escriba ahora. */
  const destinoInversion = paisFiltro ?? CAJON_GENERAL;
  const spendVista = enMonedaVista(spendPorMoneda);
  const adRevenueVista = enMonedaVista(adRevenuePorMoneda);

  // El ROAS mide solo ventas con origen de anuncio; las orgánicas se muestran
  // aparte para no inflar artificialmente el rendimiento de las campañas.
  const roas =
    spendVista != null && adRevenueVista != null && spendVista > 0
      ? adRevenueVista / spendVista
      : null;

  // Ganancia = ventas − inversión, moneda por moneda. Nunca se oculta: si hay
  // varias monedas se listan todas, y al elegir una vista se ve en una cifra.
  const gananciaPorMoneda: PorMoneda = (() => {
    const neto: PorMoneda = { ...revenuePorMoneda };
    for (const [moneda, cents] of Object.entries(spendPorMoneda)) {
      if (cents === 0) continue;
      neto[moneda] = (neto[moneda] ?? 0) - cents;
    }
    return neto;
  })();
  const gananciaVista = enMonedaVista(gananciaPorMoneda);

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
      <div className="border-b border-neutral-200 bg-tarjeta px-4 py-2">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          {/* Ventas */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              💰 Ventas
            </span>
            <span className="text-lg font-bold text-emerald-700">
              {mostrar(revenuePorMoneda)}
            </span>
            <span className="text-[11px] text-neutral-400">
              Precio normal: {mostrar(porMoneda10)} ({buyers10.length}) · Precio
              con descuento: {mostrar(porMoneda8)} ({buyers8.length}){" · "}
              <span className="text-violet-700">
                Anuncios: {mostrar(adRevenuePorMoneda)} ({adBuyers.length})
              </span>{" · "}
              <span className="text-sky-700">
                Orgánicas: {mostrar(organicRevenuePorMoneda)} (
                {organicBuyers.length})
              </span>
            </span>
          </div>

          {/* Entraron / Compraron / No compraron / Conversión */}
          <div className="flex items-center gap-4">
            <span className="text-xs text-neutral-600">
              💬 Entraron:{" "}
              <span className="font-bold text-neutral-800">{conversaron}</span>
            </span>
            <span className="text-xs text-neutral-600">
              🛒 Compraron:{" "}
              <span className="font-bold text-emerald-700">{compraron}</span>
            </span>
            <span className="text-xs text-neutral-600">
              ❌ No compraron:{" "}
              <span className="font-bold text-neutral-800">{noCompraron}</span>
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
                <span
                  className="text-xs text-neutral-500"
                  title={
                    paisFiltro
                      ? `Inversión de ${COUNTRIES[resolveCountry(paisFiltro)].label}`
                      : "Inversión general, sin país, en dólares"
                  }
                >
                  {SIMBOLO[monedaInversion] ?? monedaInversion}
                </span>
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
              <span className="flex items-center gap-2">
                <span className="text-xs font-bold text-neutral-800">
                  {mostrar(spendPorMoneda)}
                </span>
                {diasDelRango.length > 0 && (
                  <button
                    onClick={() => setVerDias((v) => !v)}
                    className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100"
                  >
                    {verDias ? "Ocultar días" : `✏️ Editar por día (${diasDelRango.length})`}
                  </button>
                )}
              </span>
            )}
            <span className="ml-2 text-xs text-neutral-600">ROAS anuncios:</span>
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
            <span className="ml-2 text-xs text-neutral-600">💵 Ganancia:</span>
            <span
              className={`text-sm font-bold ${
                gananciaVista == null
                  ? "text-neutral-800"
                  : gananciaVista >= 0
                  ? "text-emerald-700"
                  : "text-red-600"
              }`}
              title="Ventas menos inversión. Si hay varias monedas se muestran todas; elige una en 'Ver en' para consolidarlas."
            >
              {mostrar(gananciaPorMoneda)}
            </span>
          </div>
        </div>

        {/* Inversión día a día del rango elegido */}
        {verDias && diasDelRango.length > 0 && (
          <div className="mt-2 rounded border border-amber-200 bg-amber-50/60 p-2">
            <p className="mb-2 text-[11px] text-amber-900">
              Inversión en{" "}
              <strong>
                {paisFiltro
                  ? `${bandera(paisFiltro)} ${COUNTRIES[resolveCountry(paisFiltro)].label}`
                  : "🌎 general (sin país)"}
              </strong>{" "}
              en {SIMBOLO[monedaInversion] ?? monedaInversion}. Escribe lo que
              gastaste cada día; los días sin gasto se dejan vacíos. El total de
              arriba se actualiza solo.
            </p>
            <div className="flex flex-wrap gap-2">
              {diasDelRango.map((dia) => (
                <label key={dia} className="flex items-center gap-1">
                  <span className="text-[10px] font-medium text-neutral-600">
                    {dia.slice(5)}
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={spendPorDia[dia] ?? ""}
                    onChange={(e) =>
                      setSpendPorDia({ ...spendPorDia, [dia]: e.target.value })
                    }
                    onBlur={(e) => void guardarDia(dia, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    }}
                    placeholder="0"
                    className="w-16 rounded border border-neutral-300 px-1.5 py-1 text-xs"
                  />
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Controles de moneda y país */}
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-dashed border-neutral-200 pt-2">
          <span className="text-sm font-medium text-neutral-700">📊 Origen:</span>
          <select
            value={origenFiltro ?? ""}
            onChange={(e) => setOrigenFiltro(e.target.value || null)}
            className="rounded border border-neutral-300 bg-tarjeta px-2 py-1 text-sm"
          >
            <option value="">Todos los orígenes</option>
            {ORIGENES.filter((o) => (conteoPorOrigen[o.key] ?? 0) > 0).map((o) => (
              <option key={o.key} value={o.key}>
                {o.label} ({conteoPorOrigen[o.key]})
              </option>
            ))}
          </select>

          {/* EL SELECTOR DE TIENDA — aparece cuando hay mas de una, Y SIEMPRE QUE HAYA UNA
              ELEGIDA, aunque se quede sola.

              LO SEGUNDO NO ES UN ADORNO, ES LA SALIDA. Si eligiera una tienda y despues cambiara
              a un pais donde esa tienda no vendio, la lista se quedaria con una sola tienda, el
              selector desapareceria con el filtro todavia puesto, y el tablero se veria vacio
              SIN NINGUNA FORMA DE DESHACERLO. Un filtro que no se puede quitar es una trampa.

              Y si la elegida ya no tiene leads, sale igual con «(0)»: asi se entiende por que
              el tablero esta vacio, en vez de parecer que se rompio algo. */}
          {(tiendasConLeads.length > 1 || tiendaFiltro) && (
            <>
              <span className="text-sm font-medium text-neutral-700">🏪 Tienda:</span>
              <select
                value={tiendaFiltro ?? ""}
                onChange={(e) => setTiendaFiltro(e.target.value || null)}
                className="rounded border border-neutral-300 bg-tarjeta px-2 py-1 text-sm"
              >
                <option value="">Todas las tiendas</option>
                {tiendasConLeads.map((t) => (
                  <option key={t.nombre} value={t.nombre}>
                    {t.nombre} ({t.cuantos})
                  </option>
                ))}
                {tiendaFiltro &&
                  !tiendasConLeads.some((t) => t.nombre === tiendaFiltro) && (
                    <option value={tiendaFiltro}>{tiendaFiltro} (0)</option>
                  )}
              </select>
            </>
          )}

          <span className="text-sm font-medium text-neutral-700">🌎 País:</span>
          <select
            value={paisFiltro ?? ""}
            onChange={(e) => setPaisFiltro(e.target.value || null)}
            className="rounded border border-neutral-300 bg-tarjeta px-2 py-1 text-xs"
          >
            <option value="">🌎 Todos los países</option>
            {/* Primero los que tienen leads en el periodo, con su conteo. */}
            {paisesPresentes.map((code) => (
              <option key={code} value={code}>
                {bandera(code)} {COUNTRIES[code].label} ({conteoPorPais[code] ?? 0})
              </option>
            ))}
            {CODIGOS.filter((code) => !paisesPresentes.includes(code)).map(
              (code) => (
                <option key={code} value={code}>
                  {bandera(code)} {COUNTRIES[code].label} (0)
                </option>
              )
            )}
          </select>

          <span className="ml-4 text-xs font-medium text-neutral-600">
            💱 Ver en:
          </span>
          <select
            value={verEn}
            onChange={(e) => cambiarVista(e.target.value)}
            className="rounded border border-neutral-300 bg-tarjeta px-2 py-1 text-xs"
          >
            <option value="original">Moneda original</option>
            <option value="USD">Dólares ($)</option>
            <option value="PEN">Soles (S/)</option>
            {Object.keys(SIMBOLO)
              .filter((m) => m !== "USD" && m !== "PEN")
              .map((m) => (
                <option key={m} value={m}>
                  {m} ({SIMBOLO[m]})
                </option>
              ))}
          </select>

          {monedasEnJuego.map((moneda) => (
            <span key={moneda} className="flex items-center gap-1">
              <span className="text-xs text-neutral-500">
                1 $ = {SIMBOLO[moneda] ?? moneda}
              </span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={tasas[moneda] ?? ""}
                onChange={(e) => cambiarTasa(moneda, e.target.value)}
                placeholder="0.00"
                title={`Cuántos ${moneda} vale 1 dólar`}
                className="w-20 rounded border border-neutral-300 px-2 py-1 text-xs"
              />
            </span>
          ))}
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
            className="rounded border border-neutral-300 bg-tarjeta px-2 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-100"
          >
            Todos
          </button>
        </div>
        <p className="mt-1 text-[10px] text-neutral-400">
          Todo el tablero refleja el periodo elegido (leads que entraron en esas
          fechas). La inversión se registra por día: con un país elegido va a
          ese país y en su moneda; con &quot;Todos&quot; va al cajón general en
          dólares, que suma al total pero no se carga a ningún país. Con un
          rango, usa &quot;Editar por día&quot;.
        </p>
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
          label="✅ Precio normal"
          color="bg-emerald-50 text-emerald-700 border-emerald-300"
          conversations={buyers10}
          onSelect={onSelect}
          moneyLabel={mostrar(porMoneda10)}
        />
        <Column
          label="✅ Precio con descuento"
          color="bg-emerald-100 text-emerald-800 border-emerald-300"
          conversations={buyers8}
          onSelect={onSelect}
          moneyLabel={mostrar(porMoneda8)}
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
