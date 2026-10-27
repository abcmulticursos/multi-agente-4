/**
 * EL MOTOR DEL TABLERO — el segundo motor. Lee el tablero de la tienda (por canal) y sigue los cables.
 *
 * LAS CUATRO REGLAS QUE LO HACEN SEGURO (ver PLAN-TABLERO.md):
 *  1. Una conversación, un solo motor. Entra al tablero SOLO al nacer (estado «new») y en una
 *     tienda con el tablero de SU canal encendido y el Inicio de SU país conectado; desde ahí
 *     tiene su fila en `tablero_estado`. Las demás no pasan por aquí: `alRecibirMensaje` devuelve
 *     false y sigue el motor de siempre. (La otra puerta es «Activar workflow», que se elige a mano.)
 *  2. Sin cables, nada cambia: una tienda sin tablero encendido y conectado vende como siempre.
 *  3. Lo compartido se usa, no se modifica: burbujas (`sendConfiguredSteps`), entrega del
 *     producto, regalo, avisos, registro en Meta, horas de silencio y la ventana de 24 h.
 *  4. Lo programado lleva su dueño: los `tablero_*` van aquí desde el obrero, nunca al de siempre.
 */
import { trackFailedPaymentAttempt } from "@/lib/workflow/payment";
import {
  addToPaidTotal,
  resetPaymentAttemptsFailed,
  cancelPendingActionsForConvo,
  countPendingActionsInWindow,
  getConversationById,
  getLastUserMessageTime,
  isNumberBlocked,
  listMetaWhatsAppConnections,
  scheduleAction,
  setClientEmail,
  setConversationState,
  setIntroPausedIndex,
  setMode,
  setPaidAt,
  setSelectedPaymentMethod,
  type ConversationRow,
  type ScheduledActionRow,
} from "@/lib/db";
import { formatCurrencyAmount, getCountryInfo } from "@/lib/countries";
import { sendEmail } from "@/lib/email";
import { syncLeadStatus } from "@/lib/leads-sync";
import {
  buildMessagingUserData,
  sendContactEvent,
  sendInitiateCheckoutEvent,
  sendPurchaseEvent,
} from "@/lib/meta/conversions";
import { withOutboundMessengerPage, withOutboundWhatsAppNumber } from "@/lib/meta/runtime-config";
import { notifyAdmin } from "@/lib/notifications";
import { vinoDeAnuncio } from "@/lib/origen-de-lead";
import {
  conElTurnoDe,
  conLaTiendaDelTurno,
  decisionQueCoincide,
  elCobroDelPais,
  getEffectiveCountryCode,
  getSamplesAfterSequence,
  getSamplesOfferBubble,
  laTiendaDeLaConversacion,
  laTiendaDelTurno,
  loadWorkflowConfig,
  resolveCountryPaymentProfile,
  type BubbleButton,
  type BubbleDecision,
  type ProductoDeLaBiblioteca,
  type SequenceStep,
  type Tienda,
  type WorkflowConfig,
} from "@/lib/workflow/config";
import { esUnAcuseSeco, messageHasPaymentConcern, scheduleGiftConsentWithDelay, sendConfiguredSteps } from "@/lib/workflow/engine";
import {
  adjustForQuietHours,
  computeNextFollowupSlot,
  cumulativeBurstOffset,
  isAtOrAfterLocalTime,
  isQuietHour,
  nextLocalTime,
} from "@/lib/workflow/quiet-hours";
import { looksLikeMediaTurn, looksLikeProductContentTurn } from "@/lib/openrouter";
import { deQueHablaConIA, elegirOpcionConIA, responderConIA, type OpcionParaLaIA, type ProductoParaLaIA } from "./conversador";
import { conLosComodinesDeLaFicha, type ProductoConPrecio } from "./comodines";
import { conElNombreDelProducto, mandarDatosDelMetodo, metodoQueNombra, metodoVigente, preguntarElMetodo } from "./pago";
import { sendBotButtons, sendBotMediaFromDrive, sendBotText } from "@/lib/workflow/sender";
import {
  VENTANA_DE_META_MIN,
  cableDeLaSalida,
  canalDelTablero,
  claveDeWorkflow,
  elTableroAtiende,
  esClaveDeWorkflow,
  inicioDelPais,
  leeTablero,
  leeTableros,
  leeTablerosPorTienda,
  opcionesDe,
  pasosDeLaFicha,
  entregasDeLaFicha,
} from "./datos";
import { laEntrega } from "./entregas";
import {
  abrirCobro,
  activarOferta,
  anotarCompra,
  anotarEntrega,
  anotarMuestras,
  anotarPresentados,
  contarSeguimientosDesde,
  esperarCorreo,
  muestrasEnviadas,
  elegirEnElCobro,
  presentadosDe,
  apuntarBoton,
  apuntarHuella,
  apuntarVariante,
  botonYaUsado,
  cambiarDeTablero,
  cerrarCobro,
  comprasDelCliente,
  entregasDelCliente,
  entrarAlTablero,
  estadoEnElTablero,
  marcarComprobanteLeido,
  anotarVisita,
  apuntarImagenesOfrecidas,
  marcarSeguimientoHecho,
  reiniciarSeguimientosHechos,
  seguimientosEnviados,
  yaVisito,
  moverA,
  ponerEspera,
  ponerSeguimiento,
  ponerPreciosDelCobro,
  preciosDelCobro,
  proponerProducto,
  reiniciarRelojDelCobro,
  salirDelTablero,
  sumarAlCobro,
  tocarVuelta,
  varianteVista,
  type EstadoEnElTablero,
} from "./estado";
import { hayComprobantePendiente, huellaDelPago, idDelComprobantePendiente, leerComprobante, titularCoincide, ultimosMensajes } from "./lector";
import { reenviarLoDelTablero } from "./reenvio";
import type { CanalDelTablero, FichaDelTablero, Tablero, VarianteDeFicha } from "./tipos";

export const ACCION_RELOJ = "tablero_reloj";
export const ACCION_SIN_PAGO = "tablero_sin_pago";
export const ACCION_SEGUIMIENTO = "tablero_seguimiento";
export const ACCION_TRAS_REGALO = "tablero_tras_regalo";
export const ACCION_ENTRAR_WF = "tablero_entrar_wf";

/** Estados en los que manda el motor de siempre aunque la conversación sea de tablero: el regalo. */
const ESTADOS_DEL_REGALO = new Set(["payment_approved", "awaiting_email", "awaiting_gift_consent", "awaiting_facebook_comment"]);

const ahora = () => Math.floor(Date.now() / 1000);

// ── LO QUE SE LEE DEL CONTENIDO ───────────────────────────────────────────────

/** El tablero de una tienda en un canal, o el de un workflow (`wf:<id>`, uno para todos los canales). */
function tableroDe(config: WorkflowConfig | null, clave: string | null | undefined, canal: CanalDelTablero): Tablero | null {
  if (!clave) return null;
  const crudo = config as { tableros?: unknown; workflows?: unknown } | null;
  if (esClaveDeWorkflow(clave)) return leeTableros(crudo?.workflows)[clave.slice(3)] ?? null;
  return leeTablerosPorTienda(crudo?.tableros)[clave]?.[canal] ?? null;
}

function producto(config: WorkflowConfig | null, id: string | undefined | null): ProductoDeLaBiblioteca | null {
  if (!id) return null;
  return config?.biblioteca_de_productos?.find((p) => p.id === id) ?? null;
}

/** El precio de un producto en el país del cliente: el normal o el de oferta (si lo tiene). */
function precioDelProducto(p: ProductoDeLaBiblioteca | null, pais: string, deOferta: boolean): number | null {
  if (!p) return null;
  const suyo = p.precios_por_pais?.[pais];
  const normal = suyo?.price_soles ?? p.price_soles;
  const oferta = suyo?.discount_price_soles ?? p.discount_price_soles;
  const v = deOferta && typeof oferta === "number" && oferta > 0 ? oferta : normal;
  return typeof v === "number" && v > 0 ? v : null;
}

/**
 * LOS PRODUCTOS DE UNA FICHA, con su precio en el país del cliente, para sus comodines (ver
 * comodines.ts). `precios` = los congelados de un cobro abierto, que mandan sobre el de hoy.
 */
function productosDeLaFicha(
  config: WorkflowConfig | null,
  ids: (string | undefined)[],
  pais: string,
  deOferta: boolean,
  precios?: Record<string, number>
): ProductoConPrecio[] {
  const fuera: ProductoConPrecio[] = [];
  for (const id of new Set(ids.filter((x): x is string => !!x))) {
    const p = producto(config, id);
    if (!p) continue;
    const suyo = p.precios_por_pais?.[pais] as { market_price?: number } | undefined;
    const antes = suyo?.market_price ?? (p as { market_price?: number }).market_price;
    fuera.push({
      id,
      name: p.name ?? "",
      precio: precios && id in precios ? precios[id] : precioDelProducto(p, pais, deOferta),
      antes: typeof antes === "number" && antes > 0 ? antes : null,
    });
  }
  return fuera;
}

/** Lo que presenta la ficha; si no dice nada, lo que ya se le presentó al cliente. */
function idsParaComodines(convoId: number, f: FichaDelTablero, t?: Tablero): string[] {
  const e = estadoEnElTablero(convoId);
  const base = f.presenta?.length ? f.presenta : e ? presentadosDe(e) : [];
  // EN LOS SEGUIMIENTOS, EL QUE ESTÁ PAGANDO VA PRIMERO (25/10/2026, punto 23): una sola ficha de
  // seguimientos sirve para el básico y el pack — {{PRODUCTO}} y {{PRECIO}} dicen lo que ESTE cliente
  // eligió (el del cobro abierto). Base/full siguen saliendo del más barato y el más caro.
  if (f.tipo !== "seguimientos" || !e?.cobro_ficha_id || !t) return base;
  const cobro = t.fichas.find((x) => x.id === e.cobro_ficha_id);
  const elegido = e.cobro_elegido ?? cobro?.cobro?.producto_id ?? null;
  return elegido ? [elegido, ...base.filter((x) => x !== elegido)] : base;
}

/** Las claves del registro de anuncios que corresponden al anuncio por el que llegó el cliente. */
function clavesDelAnuncioDelCliente(convo: ConversationRow, config: WorkflowConfig | null): Set<string> {
  const id = String(convo.ad_source_id ?? "").trim();
  if (!id) return new Set();
  return new Set(
    (config?.ad_registry ?? [])
      .filter((ad) => ad.enabled !== false && (ad.ids ?? []).flatMap((x) => String(x).split(/[\s,;]+/)).map((x) => x.trim()).includes(id))
      .map((ad) => ad.key)
  );
}

/**
 * QUÉ VERSIÓN LE TOCA, CON SUS ANUNCIOS (24/10/2026), con la misma regla que la venta de siempre
 * (ver «Ojo con los anuncios» en CLAUDE.md): quien llega por un anuncio recibe la versión de ese
 * anuncio. Si no, en la intro de order bump se sortea entre TODAS; en un seguimiento, solo entre las
 * que no tienen anuncio (y si no hay ninguna, no se manda). Sin etiquetas, el sorteo de siempre.
 */
function versionQueLeToca(
  lista: VarianteDeFicha[],
  claves: Set<string>,
  regla: "intro" | "seguimiento"
): VarianteDeFicha | null {
  const dirige = (v: VarianteDeFicha) => v.dirigir !== false && (v.anuncios ?? []).length > 0;
  const vivas = lista.filter((v) => (v.peso ?? 1) > 0);
  const delSuAnuncio = vivas.filter((v) => dirige(v) && (v.anuncios ?? []).some((k) => claves.has(k)));
  if (delSuAnuncio.length) return sortear(delSuAnuncio);
  if (regla === "intro") return sortear(vivas);
  return sortear(vivas.filter((v) => !dirige(v)));
}

function pasosActivos(pasos: SequenceStep[] | undefined): SequenceStep[] {
  return (pasos ?? []).filter((s) => (s as { enabled?: boolean }).enabled !== false);
}

/** Sorteo por peso entre versiones (peso ausente = 1; 0 = apagada). */
function sortear<T extends { peso?: number }>(lista: T[]): T | null {
  const vivas = lista.filter((x) => (x.peso ?? 1) > 0);
  const total = vivas.reduce((s, x) => s + (x.peso ?? 1), 0);
  if (vivas.length === 0 || total <= 0) return null;
  let r = Math.random() * total;
  for (const x of vivas) {
    r -= x.peso ?? 1;
    if (r <= 0) return x;
  }
  return vivas[vivas.length - 1];
}

/** El texto de la última burbuja: lo que el cliente tiene pendiente de contestar. */
function textoDeLaUltimaBurbuja(pasos: SequenceStep[]): string | undefined {
  for (let i = pasos.length - 1; i >= 0; i--) {
    const p = pasos[i] as { type: string; body?: string; body_variants?: string[]; caption?: string };
    const t = p.type === "text" ? p.body_variants?.find((x) => x?.trim()) ?? p.body : p.caption;
    if (t?.trim()) return t.trim();
  }
  return undefined;
}

/** Las burbujas que el cliente VIO de una ficha (en las de versiones, la que le salió). */
function pasosVistos(f: FichaDelTablero, estado: EstadoEnElTablero | null): SequenceStep[] {
  if (f.tipo === "intro_ob") {
    const vista = estado ? varianteVista(estado, f.id) : null;
    const v = (f.variantes ?? []).find((x) => x.id === vista) ?? f.variantes?.[0];
    return pasosActivos(v?.steps);
  }
  if (f.tipo === "seguimientos") {
    if (!estado) return [];
    const idx = Math.max(0, estado.seg_idx - 1);
    const seg = f.seguimientos?.[idx];
    const vista = varianteVista(estado, `${f.id}#${idx}`);
    const v = seg?.variantes.find((x) => x.id === vista) ?? seg?.variantes[0];
    return pasosActivos(v?.steps);
  }
  return pasosActivos(f.steps);
}

// ── LOS FRENOS QUE YA RESPETA EL MOTOR DE SIEMPRE ─────────────────────────────

/** ¿Hay que callar? Lo mismo que respeta el motor de siempre al ejecutar lo programado. */
function noSeLeEscribe(convo: ConversationRow): boolean {
  if (convo.mode !== "AI") return true;
  if (convo.channel !== "test" && isNumberBlocked(convo.phone)) return true;
  if (
    convo.wa_phone_number_id &&
    listMetaWhatsAppConnections().some((c) => c.phone_number_id === convo.wa_phone_number_id && c.pausado === 1)
  )
    return true;
  return false;
}

/**
 * LA VENTANA DE 24 HORAS DE META: pasado ese tiempo desde el último mensaje del cliente, un
 * mensaje libre no llega (error 131047). El motor de siempre no lo intenta; el tablero tampoco.
 */
function fueraDeLaVentana(convo: ConversationRow): boolean {
  if (convo.channel === "test") return false;
  const ultimo = getLastUserMessageTime(convo.id);
  return ultimo !== null && ahora() - ultimo >= VENTANA_DE_META_MIN * 60;
}

/** Programa un reloj del tablero, respetando las horas de silencio (como los seguimientos). */
function programar(convo: ConversationRow, tipo: string, payload: Record<string, unknown>, cuando: number, sinSilencio = false): void {
  const a = Math.max(cuando, ahora() + 2);
  scheduleAction(convo.id, tipo, payload, convo.channel === "test" || sinSilencio ? a : adjustForQuietHours(a));
}

const RAFAGA_DE_FABRICA = [15, 21, 27, 32];
/** Las franjas de fábrica del motor de siempre (`DEFAULT_FOLLOWUP_SLOTS`), si Ajustes no tiene. */
const FRANJAS_DE_FABRICA = ["12:00", "18:00", "21:45"];

/**
 * CUÁNDO SALE UN SEGUIMIENTO DE LA CAJA — las reglas de `scheduleFollowupSequences` del motor de
 * siempre, con su configuración real (medido el 23/10: sus canales tienen contenido propio, así que
 * cada seguimiento sale a SUS minutos; las franjas 12:00/18:00/20:00 no se usan ahí):
 *   · a sus minutos desde `desde` (el último mensaje del cliente: si escribe, vuelve a contar);
 *   · LEAD TARDÍO (Ajustes): si `desde` cae a partir de la hora límite, el primero sale a la hora de
 *     reanudar y los demás a sus minutos desde ahí — salvo el que tenga «ignora el lead tardío»;
 *   · HORAS DE SILENCIO: se pasa a la reanudación, salvo «ignora las horas de silencio» (y el
 *     primero si Ajustes dice que el seguimiento 1 las ignora);
 *   · LA COLA ANTIRRÁFAGA: si ya hay otros en esa hora, se escalona con los segundos de Ajustes.
 * En el simulador nada de eso aplaza: las pruebas viven sus minutos.
 */
function cuandoSaleElSeguimiento(
  convo: ConversationRow,
  seg: { minutos: number; ignora_silencio?: boolean; ignora_tardio?: boolean },
  idx: number,
  desde: number
): { cuando: number; sinSilencio: boolean } {
  if (convo.channel === "test") return { cuando: desde + seg.minutos * 60, sinSilencio: true };
  const sched = loadWorkflowConfig()?.followup_schedule;
  // DEL 2 EN ADELANTE, A SUS HORARIOS FIJOS DE AJUSTES (25/10/2026, punto 4): «seguimiento 1 por
  // minutos, reiniciándose si el cliente escribe; seguimientos 2 a mis horarios fijos». La misma regla
  // del motor de siempre para los 2+ (`computeNextFollowupSlot`): la próxima franja, al menos «horas
  // mínimas entre seguimientos» después del anterior, nunca en horas de silencio. Si no hay franja,
  // sus minutos, como hasta hoy. (En el simulador salen a sus minutos, para poder probarlos.)
  if (idx >= 1) {
    const conSilencioEste = sched?.quiet_hours_enabled !== false && seg.ignora_silencio !== true;
    const franja = computeNextFollowupSlot({
      nowSec: ahora(),
      lastFollowupAtSec: ahora(),
      slotsHHMM: sched?.slots_peru?.length ? sched.slots_peru : FRANJAS_DE_FABRICA,
      minGapHours: sched?.min_gap_hours_between ?? 4,
      quietHoursEnabled: conSilencioEste,
    });
    if (franja !== null) {
      const enEsaHora =
        countPendingActionsInWindow(ACCION_SEGUIMIENTO, franja, franja + 3600) + countPendingActionsInWindow("start_followup", franja, franja + 3600);
      const rafaga = sched?.burst_delays_seconds?.length ? sched.burst_delays_seconds : RAFAGA_DE_FABRICA;
      return { cuando: franja + cumulativeBurstOffset(enEsaHora, rafaga), sinSilencio: true };
    }
  }
  const tardio =
    sched?.defer_late_leads_enabled === true &&
    typeof sched.defer_late_leads_after === "string" &&
    isAtOrAfterLocalTime(desde, sched.defer_late_leads_after)
      ? nextLocalTime(desde, sched.quiet_hours?.resume_at || "07:00")
      : null;
  const objetivo =
    tardio === null || seg.ignora_tardio === true ? desde + seg.minutos * 60 : idx === 0 ? tardio : tardio + seg.minutos * 60;
  const conSilencio =
    sched?.quiet_hours_enabled !== false && seg.ignora_silencio !== true && !(idx === 0 && sched?.followup_1_ignore_quiet_hours === true);
  const base = conSilencio && isQuietHour(objetivo) ? adjustForQuietHours(objetivo) : objetivo;
  const enEsaHora =
    countPendingActionsInWindow(ACCION_SEGUIMIENTO, base, base + 3600) + countPendingActionsInWindow("start_followup", base, base + 3600);
  const rafaga = sched?.burst_delays_seconds?.length ? sched.burst_delays_seconds : RAFAGA_DE_FABRICA;
  return { cuando: base + cumulativeBurstOffset(enEsaHora, rafaga), sinSilencio: true };
}

// ── LLEVAR AL CLIENTE A UNA FICHA ─────────────────────────────────────────────

async function seguirPor(convoId: number, t: Tablero, fichaId: string, salida: string, pasos: number): Promise<boolean> {
  const cable = cableDeLaSalida(t, fichaId, salida);
  if (!cable) return false;
  await irA(convoId, t, cable.a, pasos + 1);
  return true;
}

/**
 * LOS SEGUIMIENTOS COLGADOS (25/10/2026, punto 4). «Lo normal es que continúe por su cable normal…
 * y solo setear en la ficha el tiempo que debe avanzar el primer seguimiento». Una ficha que espera
 * respuesta (Mensaje u Order bump con opciones, o un Cobro) cuyo cable «→» / «no respondió» / «si no
 * paga» va a unos Seguimientos los CUELGA: salen a sus tiempos mientras el cliente sigue en ESA ficha,
 * y sus botones y cuadritos —y el cobro abierto— siguen valiendo. Si elige o paga, va por su cable y
 * los seguimientos se cortan (irA los suelta al moverse). Sin «no respondió en 30 min», sin «no pagó
 * en 1 h» y sin caja abierta: esos relojes extra retrasaban sus seguimientos.
 */
function fichaDeSeguimientos(t: Tablero, desde: string, salida: string): FichaDelTablero | null {
  const cable = cableDeLaSalida(t, desde, salida);
  const f = cable ? t.fichas.find((x) => x.id === cable.a) : undefined;
  return f?.tipo === "seguimientos" && !f.apagada && (f.seguimientos ?? []).length > 0 ? f : null;
}

/**
 * LA HUELLA DE UN SEGUIMIENTO: sus textos (de todas sus versiones). Un duplicado tiene la misma; otro
 * seguimiento, otra. Así «no repetir» vale para la copia y no se come unos Seguimientos distintos.
 */
function huellaDelSeguimiento(s: { variantes?: Array<{ steps?: unknown[] }> }): string {
  const textos = (s.variantes ?? [])
    .flatMap((v) => (v.steps ?? []) as Array<{ body?: string; body_variants?: string[]; caption_variants?: string[]; drive_url?: string }>)
    .flatMap((p) => [p.body ?? "", ...(p.body_variants ?? []), ...(p.caption_variants ?? []), p.drive_url ?? ""])
    .map((x) => x.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("|");
  let h = 0;
  for (let i = 0; i < textos.length; i++) h = (Math.imul(31, h) + textos.charCodeAt(i)) | 0;
  return `${textos.length}:${(h >>> 0).toString(36)}`;
}

/** El primer seguimiento de esta ficha, desde `desde`, que todavía no le salió (o -1). */
function siguienteSinEnviar(convoId: number, segs: NonNullable<FichaDelTablero["seguimientos"]>, desde: number): number {
  const ya = new Set(seguimientosEnviados(estadoEnElTablero(convoId)));
  for (let i = desde; i < segs.length; i++) if (!ya.has(huellaDelSeguimiento(segs[i]))) return i;
  return -1;
}

/**
 * CUELGA LOS SEGUIMIENTOS DESDE EL QUE LE FALTA (26/10/2026): los que ya le salieron en esta etapa
 * quedan marcados por su texto y no se repiten, aunque vuelva a caer en éstos o en un duplicado. Si
 * ya recibió todos, no se cuelga nada. Al comprar se vacía la marca (el upsell es otra venta).
 */
function colgarSeguimientos(convo: ConversationRow, seg: FichaDelTablero, t?: Tablero): void {
  const segs = seg.seguimientos ?? [];
  if (segs.length === 0) return;
  const idx = siguienteSinEnviar(convo.id, segs, 0);
  if (idx < 0) {
    console.log(`[tablero] convo ${convo.id}: «${seg.titulo || seg.id}» — ya recibió sus ${segs.length} seguimientos, no se repiten`);
    // Si tienen «Terminaron sin respuesta» (al Regalo, p. ej.), el cliente sigue por ahí tras el
    // silencio: que no repitan no puede dejarlo sin su camino.
    if (t && cableDeLaSalida(t, seg.id, "fin")) {
      const token = ponerSeguimiento(convo.id, seg.id, segs.length);
      programar(convo, ACCION_SEGUIMIENTO, { ficha: seg.id, idx: segs.length, token }, ahora() + minutosDelSilencio() * 60);
    } else ponerSeguimiento(convo.id, null, 0);
    return;
  }
  const token = ponerSeguimiento(convo.id, seg.id, idx);
  const desde = getLastUserMessageTime(convo.id) ?? ahora();
  contarSeguimientosDesde(convo.id, desde);
  const { cuando, sinSilencio } = cuandoSaleElSeguimiento(convo, segs[idx], idx, desde);
  programar(convo, ACCION_SEGUIMIENTO, { ficha: seg.id, idx, token }, cuando, sinSilencio);
  console.log(`[tablero] convo ${convo.id}: cuelga los seguimientos «${seg.titulo || seg.id}» (sigue con el ${idx + 1}, a ${segs[idx].minutos} min de su último mensaje)`);
}

/**
 * «Si no paga» o «Si no responde» hacia otra ficha que no son Seguimientos: el silencio del regalo
 * de tus Ajustes, como la venta de siempre (26/10/2026: los minutos sueltos del Cobro confundían y
 * ya no se usan; «Si no responde» usa los suyos si los tiene).
 */
function minutosDelSilencio(): number {
  const seg = loadWorkflowConfig()?.awaiting_email_timeout_seconds ?? 300;
  return Math.max(1, Math.round(seg / 60));
}
const minutosSinPago = (_f: FichaDelTablero): number => minutosDelSilencio();
const minutosSinRespuesta = (f: FichaDelTablero): number => f.sin_respuesta_min || minutosDelSilencio();

/** Las claves del registro de anuncios de las que vino el cliente (para el Inicio por anuncio). */
function anunciosDelCliente(convo: ConversationRow, claves: string[], config: WorkflowConfig | null): string[] {
  if (!convo.ad_source_id) return [];
  return (config?.ad_registry ?? [])
    .filter((ad) => claves.includes(ad.key) && ad.enabled !== false)
    .filter((ad) =>
      (ad.ids ?? [])
        .flatMap((x) => String(x).split(/[\s,;]+/))
        .map((x) => x.trim())
        .includes(convo.ad_source_id!)
    )
    .map((ad) => ad.key);
}

/** La señal del reloj de una ficha con «⏳ espera»: se cumplió y manda sus burbujas. */
const ESPERA_CUMPLIDA = "__espera_cumplida";

/**
 * LLEVA AL CLIENTE A UNA FICHA y hace lo que esa ficha hace. Las que no esperan nada siguen solas
 * por su cable; un tope de pasos impide que un círculo sin pausa mande burbujas para siempre.
 */
async function irA(
  convoId: number,
  t: Tablero,
  fichaId: string,
  pasos = 0,
  opciones: {
    /** La espera de la ficha ya se cumplió: ahora sí manda sus burbujas. */
    yaEspero?: boolean;
    /** Solo un Cobro: se abre callado (sin burbujas ni seguimientos), para atender un comprobante. */
    enSilencio?: boolean;
  } = {}
): Promise<void> {
  const { yaEspero = false, enSilencio = false } = opciones;
  const convo = getConversationById(convoId);
  if (!convo || noSeLeEscribe(convo)) return;
  if (pasos > 25) {
    console.warn(`[tablero] convo ${convoId}: 25 fichas seguidas sin pausa — se para aquí (¿un círculo sin espera?)`);
    return;
  }
  const f = t.fichas.find((x) => x.id === fichaId);
  if (!f) return;
  const antes = estadoEnElTablero(convoId);
  // Al salir de la caja «Seguimientos» (o de la ficha que los tenía colgados), sus relojes dejan de valer.
  if (antes?.seg_ficha && antes.seg_ficha !== f.id) ponerSeguimiento(convoId, null, 0);
  // Y una espera que no se cumplió deja de valer si se va a otra ficha.
  if (antes?.espera_ficha && antes.espera_ficha !== f.id) ponerEspera(convoId, null);
  const vuelta = moverA(convoId, f.id);
  // ¿VUELVE A UNA FICHA QUE YA VIO? (26/10/2026) Se mira antes de anotar esta visita. La segunda
  // llamada de una ficha con «⏳ espera» no cuenta: es la misma visita que se cumple.
  const volvio = !yaEspero && yaVisito(convoId, f.id);
  anotarVisita(convoId, f.id);
  const config = loadWorkflowConfig();
  const pais = getEffectiveCountryCode(convo.phone, config);
  console.log(`[tablero] convo ${convoId} → ficha «${f.titulo || f.tipo}» (${f.id})${f.apagada ? " [apagada]" : ""}`);
  const seguir = (salida: string) => seguirPor(convoId, t, f.id, salida, pasos);

  // APAGADA: no manda nada y el cliente sigue por su «→», como en la pizarra (en su sitio, tenue).
  if (f.apagada) {
    await seguir("siguiente");
    return;
  }

  switch (f.tipo) {
    case "inicio": {
      // VARIAS TUBERÍAS EN UN PAÍS (26/10/2026): el Inicio puede separar por anuncio. Si el cliente vino
      // de uno de los anuncios marcados y esa salida tiene cable, va por ahí; si no, por «→ los demás».
      const deSuAnuncio = (f.anuncios ?? []).length ? anunciosDelCliente(convo, f.anuncios!, config) : [];
      for (const clave of deSuAnuncio) if (await seguir(`anuncio:${clave}`)) return;
      await seguir("siguiente");
      return;
    }

    case "mensaje":
    case "intro_ob": {
      // «⏳ ESPERA» DENTRO DE LA FICHA (25/10/2026, punto 9): el upsell no sale en el mismo segundo de
      // la entrega. Se queda esperando sus minutos (si el cliente escribe, vuelven a contar, ver
      // `rearmarEspera`) y recién entonces manda sus burbujas. Mientras, la ficha no está presentada.
      if (f.tipo === "mensaje" && f.espera_min && !yaEspero) {
        ponerEspera(convoId, f.id);
        programar(convo, ACCION_RELOJ, { ficha: f.id, salida: ESPERA_CUMPLIDA, vuelta }, ahora() + f.espera_min * 60, true);
        console.log(`[tablero] convo ${convoId}: «${f.titulo || f.id}» espera ${f.espera_min} min antes de salir`);
        return;
      }
      if (yaEspero) ponerEspera(convoId, null);
      // VOLVER A UNA FICHA CON OPCIONES NO LA REPITE (26/10/2026), como la venta de siempre: después del
      // destape, el order bump no se vuelve a mostrar. El cliente ya vio esas opciones: se queda en ella
      // (sus botones y cuadritos valen), sus seguimientos siguen desde el que le falta, y la IA le
      // pregunta con sus palabras cuál prefiere.
      if (volvio) {
        const ya = opcionesDe(pasosDeLaFicha(f));
        if (ya.botones.length + ya.cuadritos.length > 0) {
          console.log(`[tablero] convo ${convoId}: vuelve a «${f.titulo || f.id}», que ya vio → no se repite`);
          const colgadosOtraVez = fichaDeSeguimientos(t, f.id, "siguiente") ?? fichaDeSeguimientos(t, f.id, "sin_respuesta");
          if (colgadosOtraVez) colgarSeguimientos(convo, colgadosOtraVez, t);
          else if (cableDeLaSalida(t, f.id, "sin_respuesta"))
            programar(convo, ACCION_RELOJ, { ficha: f.id, salida: "sin_respuesta", vuelta }, ahora() + minutosSinRespuesta(f) * 60);
          const nombres = [...ya.botones.map((b) => b.label), ...ya.cuadritos.map((d) => d.title)].filter(Boolean).join(", ");
          await contestarConIA(
            convo,
            t,
            `Ya le mostraste antes estas opciones: ${nombres}. No se las vuelvas a presentar enteras: con tus palabras y en una frase corta, pregúntale cuál prefiere.`
          );
          return;
        }
      }
      let pasosAEnviar = pasosActivos(f.steps);
      if (f.tipo === "intro_ob") {
        const v = versionQueLeToca(f.variantes ?? [], clavesDelAnuncioDelCliente(convo, config), "intro");
        if (v) apuntarVariante(convoId, f.id, v.id);
        pasosAEnviar = pasosActivos(v?.steps);
      }
      pasosAEnviar = conLosComodinesDeLaFicha(
        pasosAEnviar,
        productosDeLaFicha(config, idsParaComodines(convoId, f), pais, estadoEnElTablero(convoId)?.oferta === 1),
        pais
      );
      await sendConfiguredSteps(convo, pasosAEnviar as never);
      // Desde aquí la IA ya puede hablar de lo que esta ficha presenta.
      anotarPresentados(convoId, f.presenta ?? []);
      const { botones, cuadritos } = opcionesDe(pasosAEnviar);
      if (botones.length + cuadritos.length === 0) {
        await seguir("siguiente");
        return;
      }
      // CON OPCIONES: espera la respuesta, con sus Seguimientos colgados si su «→» (o su «no respondió»)
      // va a ellos. Un «no respondió» hacia otra ficha sigue funcionando como siempre.
      const colgados = fichaDeSeguimientos(t, f.id, "siguiente") ?? fichaDeSeguimientos(t, f.id, "sin_respuesta");
      if (colgados) colgarSeguimientos(convo, colgados, t);
      // «SI NO RESPONDE» hacia otra ficha (el Regalo tras un upsell): a sus minutos, o al silencio del
      // regalo si no tiene (26/10/2026: la salida siempre se ve, también sin minutos). Con seguimientos
      // colgados, mandan ellos.
      else if (cableDeLaSalida(t, f.id, "sin_respuesta"))
        programar(convo, ACCION_RELOJ, { ficha: f.id, salida: "sin_respuesta", vuelta }, ahora() + minutosSinRespuesta(f) * 60);
      return;
    }

    case "seguimientos":
      // La caja de Seguimientos: desde el que le falta (los ya recibidos no se repiten).
      colgarSeguimientos(convo, f, t);
      return;

    case "entregar": {
      // SUS ENTREGAS, EN ORDEN (25/10/2026): la principal de un producto o una de sus entregas extra,
      // también de varios productos. Cada una se anota con su clave: el reenvío y el correo mandan
      // exactamente lo que salió.
      let salio = 0;
      for (const clave of entregasDeLaFicha(f)) {
        const e = laEntrega(config, clave);
        const pasos = pasosActivos(e?.pasos);
        if (!e || !pasos.length) {
          console.warn(`[tablero] convo ${convoId}: la entrega «${clave}» no existe o no tiene burbujas`);
          continue;
        }
        await sendConfiguredSteps(convo, conElNombreDelProducto(pasos as never, e.producto.name) as never);
        anotarEntrega(convoId, clave);
        anotarPresentados(convoId, [e.producto.id]);
        salio++;
      }
      if (salio === 0) {
        console.warn(`[tablero] convo ${convoId}: la ficha Entregar no tiene entregas con burbujas`);
      } else {
        // «📧 OFRECER TAMBIÉN POR CORREO»: la pregunta con sus dos botones. La ruta sigue sin esperar;
        // la respuesta se atiende cuando llegue (ver `turnoDelTablero`).
        if (f.por_correo)
          await sendBotButtons(convo, f.correo_pregunta || CORREO_PREGUNTA, [
            { id: `bubble:${BOTON_CORREO_SI}`, title: (f.correo_si || CORREO_SI).slice(0, 20) },
            { id: `bubble:${BOTON_CORREO_NO}`, title: (f.correo_no || CORREO_NO).slice(0, 20) },
          ]);
      }
      // PAGÓ DURANTE EL REGALO (el upsell que dijo que sí y pagó tarde): se le entrega y la ruta NO
      // sigue (no se le ofrece el upsell siguiente en medio del regalo). Como la venta de siempre:
      // cuando el silencio lleva al regalo, la fila ya no ofrece más. Sigue en el regalo (25/10/2026).
      if (ESTADOS_DEL_REGALO.has(convo.state ?? "")) {
        if (antes?.ficha_id && t.fichas.find((x) => x.id === antes.ficha_id)?.tipo === "regalo") moverA(convoId, antes.ficha_id);
        console.log(`[tablero] convo ${convoId}: entregado durante el regalo → la ruta no sigue`);
        return;
      }
      await seguir("siguiente");
      return;
    }

    case "correo": {
      // PEDIR EL CORREO: sus burbujas lo piden; cuando lo escribe, se le manda (ver `turnoDelTablero`).
      await sendConfiguredSteps(convo, pasosActivos(f.steps) as never);
      if (f.sin_respuesta_min)
        programar(convo, ACCION_RELOJ, { ficha: f.id, salida: "sin_respuesta", vuelta }, ahora() + f.sin_respuesta_min * 60);
      return;
    }

    case "cobro": {
      // LOS PRECIOS SE CONGELAN AL ABRIR EL COBRO: si él cambia un precio mientras tanto, a este
      // cliente se le cobra lo que se le dijo (como el precio congelado de la venta de siempre).
      const estado = estadoEnElTablero(convoId);
      const deOferta = f.cobro?.precio === "oferta" || (f.cobro?.precio !== "normal" && estado?.oferta === 1);
      const precios: Record<string, number> = {};
      if (f.cobro?.modo === "producto")
        for (const id of [f.cobro.producto_id, ...(f.cobro.acepta ?? [])]) {
          const v = id ? precioDelProducto(producto(config, id), pais, deOferta) : null;
          if (id && v !== null) precios[id] = v;
        }
      // EL PRECIO ESPECIAL DEL DOWNSELL (26/10/2026): el suyo, para su producto, en el país del cliente.
      const especial = f.cobro?.precio_por_pais?.[pais];
      if (f.cobro?.modo === "producto" && f.cobro.producto_id && especial) precios[f.cobro.producto_id] = especial;
      // EL UPGRADE: si ya compró uno de éstos más barato, los más caros cuestan la diferencia y lo
      // que ya tiene (o uno más barato) ya no se cobra.
      if (f.cobro?.modo === "producto" && f.cobro.diferencia) {
        const pagado = Math.max(
          0,
          ...comprasDelCliente(convoId)
            .filter((c) => c.producto_id && c.producto_id in precios)
            .map((c) => c.monto)
        );
        if (pagado > 0) {
          for (const [id, v] of Object.entries(precios)) {
            if (v - pagado > 0.009) precios[id] = Math.round((v - pagado) * 100) / 100;
            else delete precios[id];
          }
          console.log(`[tablero] convo ${convoId}: upgrade — ya pagó ${pagado}, se cobra la diferencia: ${JSON.stringify(precios)}`);
        }
      }
      abrirCobro(convoId, f.id, precios);
      const principal = f.cobro?.producto_id && f.cobro.producto_id in precios ? f.cobro.producto_id : Object.keys(precios)[0];
      // Solo el que se cobra queda presentado: los demás que acepta este cobro («pagó otro») no se
      // destapan por estar en la lista. El oculto sigue oculto hasta su intro.
      anotarPresentados(convoId, [principal]);
      if (principal && principal !== f.cobro?.producto_id) elegirEnElCobro(convoId, principal);
      const precio = principal ? precios[principal] : undefined;
      const nombre = producto(config, principal)?.name;
      // Sus comodines: el que se cobra primero, con los precios congelados (y la diferencia del upgrade).
      const pasosDelCobro = conLosComodinesDeLaFicha(
        pasosActivos(f.steps),
        productosDeLaFicha(config, [principal, ...Object.keys(precios)], pais, deOferta, precios),
        pais
      );
      // ABIERTO EN SILENCIO: llegó un comprobante sin cobro abierto y éste es el que encaja con su monto.
      // No se le manda nada: se lee su comprobante contra este cobro (ver `cobroQueEncajaConElPago`).
      if (enSilencio) {
        console.log(`[tablero] convo ${convoId}: cobro «${f.titulo || f.id}» abierto en silencio para su comprobante`);
        return;
      }
      if (f.cobro?.metodos) {
        // CON EL MÉTODO YA ELEGIDO NO SE VUELVE A PREGUNTAR: le llegan los datos de ése.
        const yaElegido = metodoVigente(getConversationById(convoId) ?? convo);
        if (yaElegido && (await mandarDatosDelMetodo(convo, yaElegido, precio, nombre))) {
          // (los datos ya salieron)
        } else if (f.cobro.sin_preguntar) {
          // El mensaje de antes ya preguntó el método: se espera su respuesta sin repetir la pregunta.
          console.log(`[tablero] convo ${convoId}: cobro abierto en silencio (el método ya se preguntó)`);
        } else await preguntarElMetodo(convo, pasosDelCobro as never, precio, nombre);
      } else await sendConfiguredSteps(convo, pasosDelCobro as never, precio);
      void sendInitiateCheckoutEvent({
        conversationId: convoId,
        userData: buildMessagingUserData({
          channel: convo.channel,
          phone: convo.phone,
          firstName: convo.client_name ?? convo.name,
          ctwa_clid: convo.ctwa_clid,
        }),
        ...(precio ? { value: precio, currency: getCountryInfo(pais).currency } : {}),
      }).catch(() => {});
      // «SI NO PAGA»: hacia unos Seguimientos, colgados desde ya (el cobro sigue abierto y sus tiempos
      // cuentan desde el último mensaje del cliente); hacia otra ficha, su reloj de siempre.
      const colgadosDelCobro = fichaDeSeguimientos(t, f.id, "sin_pago");
      if (colgadosDelCobro) colgarSeguimientos(convo, colgadosDelCobro, t);
      else if (cableDeLaSalida(t, f.id, "sin_pago")) {
        const e = estadoEnElTablero(convoId);
        programar(convo, ACCION_SIN_PAGO, { ficha: f.id, cobro_desde: e?.cobro_desde, reloj: e?.cobro_reloj }, ahora() + minutosSinPago(f) * 60);
      }
      return;
    }

    case "condicion": {
      const c = f.condicion;
      let si = false;
      if (c?.tipo === "pais") si = (c.paises ?? []).includes(pais);
      else if (c?.tipo === "anuncio") {
        if (!(c.anuncios ?? []).length) si = vinoDeAnuncio(convo);
        else {
          // DE ESE ANUNCIO: los ids de esas claves del registro de anuncios (como la intro por anuncio).
          const quiero = new Set(c.anuncios);
          const idsDeAnuncios = (config?.ad_registry ?? [])
            .filter((ad) => quiero.has(ad.key) && ad.enabled !== false)
            .flatMap((ad) => (ad.ids ?? []).flatMap((x) => String(x).split(/[\s,;]+/)))
            .map((x) => x.trim())
            .filter(Boolean);
          si = !!convo.ad_source_id && idsDeAnuncios.includes(convo.ad_source_id);
        }
      } else if (c?.producto_id) si = comprasDelCliente(convoId).some((x) => x.producto_id === c.producto_id);
      await seguir(si ? "si" : "no");
      return;
    }

    case "reparto": {
      // EL SORTEO SOLO ENTRE LAS RUTAS CONECTADAS (27/10/2026): una ruta sin cable dejaba al cliente sin
      // nada (le tocó a la mitad de sus clientes de prueba en MASCOTAS). Si ninguna tiene cable, se avisa.
      const conectadas = (f.reparto ?? []).filter((r) => cableDeLaSalida(t, f.id, `rep:${r.id}`));
      const o = sortear(conectadas);
      if (o) await seguir(`rep:${o.id}`);
      else console.warn(`[tablero] convo ${convoId}: el Reparto «${f.titulo || f.id}» no tiene ninguna ruta conectada`);
      return;
    }

    case "esperar":
      programar(convo, ACCION_RELOJ, { ficha: f.id, salida: "siguiente", vuelta }, ahora() + (f.minutos ?? 1) * 60);
      return;

    case "workflow": {
      const wf = f.workflow_id ? tableroDe(config, claveDeWorkflow(f.workflow_id), "whatsapp") : null;
      const inicio = wf ? inicioDelPais(wf, pais) : null;
      if (!wf || !inicio) {
        console.warn(`[tablero] convo ${convoId}: la ficha Workflow no lleva a un workflow con Inicio`);
        return;
      }
      cambiarDeTablero(convoId, claveDeWorkflow(f.workflow_id!), inicio.id, canalDelTablero(convo));
      console.log(`[tablero] convo ${convoId} pasa al workflow «${wf.nombre ?? f.workflow_id}»`);
      await irA(convoId, wf, inicio.id, pasos + 1);
      return;
    }

    case "regalo":
      // El regalo de siempre, tal cual: se pone la conversación donde él lo espera y se programa
      // su pregunta. Al terminar, el motor de siempre avisa (`avisarFinDelRegalo`) y la ruta
      // puede seguir por «Al terminar el regalo».
      // YA ESTÁ EN EL REGALO (o lo terminó): no se repite. Pasa cuando paga el upsell después de que
      // el silencio lo llevó al regalo: se le entrega y el regalo sigue donde iba (25/10/2026).
      if (ESTADOS_DEL_REGALO.has(convo.state ?? "")) {
        console.log(`[tablero] convo ${convoId}: ya está en el regalo (${convo.state}) → no se repite`);
        return;
      }
      if (!convo.paid_at) setPaidAt(convoId, ahora());
      setConversationState(convoId, "payment_approved");
      {
        // CON EL SILENCIO DE SIEMPRE (25/10/2026): salía en el acto. La venta de siempre lo ofrece tras
        // «Se ofrece tras X min» de silencio (`awaiting_email_timeout_seconds`), contado desde el
        // último mensaje del cliente; aquí, igual.
        const segundos = Math.max(1, Math.floor(config?.awaiting_email_timeout_seconds ?? 300));
        const ultimo = getLastUserMessageTime(convoId) ?? ahora();
        const falta = Math.max(1, ultimo + segundos - ahora());
        console.log(`[tablero] convo ${convoId}: el regalo se ofrece en ${falta} s (silencio de ${segundos} s)`);
        scheduleGiftConsentWithDelay(convoId, falta);
      }
      return;

    case "humano":
      setMode(convoId, "HUMAN");
      if (convo.channel !== "test")
        void notifyAdmin(
          `🙋 *Tablero:* ${convo.client_name ?? convo.name ?? convo.phone} pasó a atención humana (${f.titulo || "ficha Humano"}).`
        ).catch(() => {});
      return;
  }
}

// ── LO QUE SE LE CONTESTA ─────────────────────────────────────────────────────

/** Los montos que la IA puede nombrar: los del cobro abierto, en el país del cliente. */
function montosDelCobro(t: Tablero, estado: EstadoEnElTablero, pais: string): number[] {
  const f = t.fichas.find((x) => x.id === estado.cobro_ficha_id);
  if (!f?.cobro) return [];
  if (f.cobro.modo === "producto") return Object.values(preciosDelCobro(estado));
  const montos: number[] = [];
  const min = f.cobro.minimo_por_pais?.[pais];
  if (typeof min === "number" && min > 0) montos.push(min);
  for (const tr of f.cobro.tramos_por_pais?.[pais] ?? []) {
    montos.push(tr.desde);
    if (tr.hasta !== undefined) montos.push(tr.hasta);
  }
  return [...new Set(montos)];
}

/** El cliente de esta ficha recibe la IA, con lo que tiene pendiente y los montos permitidos. */
async function contestarConIA(convo: ConversationRow, t: Tablero, nota?: string): Promise<void> {
  const estado = estadoEnElTablero(convo.id);
  const config = loadWorkflowConfig();
  const pais = getEffectiveCountryCode(convo.phone, config);
  // Una ficha que todavía ESPERA su tiempo (el upsell) no se ha presentado: la IA no habla de ella.
  const ficha = estado?.espera_ficha && estado.espera_ficha === estado.ficha_id ? undefined : t.fichas.find((x) => x.id === estado?.ficha_id);
  // EL REENVÍO SOLO SI HAY ALGO QUE REENVIAR Y NO HAY UNA INSTRUCCIÓN: con una nota («pregúntale si
  // fue un error…») la IA tiene un encargo concreto, y ofrecerle el reenvío lo desviaba (lo midió el
  // recorrido del 23/10: el cliente se quedó sin la pregunta).
  const puedeReenviar = !nota && entregasDelCliente(convo.id).length > 0;
  const { productos, montos } = loQueSabeLaIA(convo, estado, pais);
  const muestras = muestrasDisponibles(estado);
  // LOS DATOS OTRA VEZ («pásame la cuenta», «sí, ya pago»): con el cobro abierto que pide método y
  // el método ya elegido. Los manda el sistema con el precio congelado, nunca la IA.
  const cobro = estado?.cobro_ficha_id ? t.fichas.find((x) => x.id === estado.cobro_ficha_id) : undefined;
  const metodo = cobro?.cobro?.metodos ? metodoVigente(getConversationById(convo.id) ?? convo) : null;
  // LO QUE SE LE OFRECE AHORA: lo que presenta la ficha donde está, o lo que se le cobra.
  const nombreDe = (id: string | null | undefined) => producto(config, id)?.name ?? null;
  const ofrece =
    ficha?.tipo === "cobro"
      ? [nombreDe(estado?.cobro_elegido ?? ficha.cobro?.producto_id)]
      : ficha?.tipo === "mensaje" || ficha?.tipo === "intro_ob" || ficha?.tipo === "seguimientos"
        ? (ficha.presenta ?? []).map(nombreDe)
        : [];
  const ofreciendoAhora = ofrece.filter(Boolean).join(" o ");
  // «QUIERO COMPLETAR PARA EL OTRO», en cualquier momento: si ya compró uno y en la ruta hay un cobro
  // con upgrade que lo incluye y cobra otro que aún no tiene. Sin un cobro abierto (no se cruzan).
  const comprados = new Set(comprasDelCliente(convo.id).map((c) => c.producto_id).filter(Boolean));
  const upgrade = !estado?.cobro_ficha_id && !nota
    ? t.fichas.find(
        (x) =>
          x.tipo === "cobro" &&
          !x.apagada &&
          !x.guardada &&
          x.cobro?.modo === "producto" &&
          x.cobro.diferencia &&
          x.cobro.producto_id &&
          !comprados.has(x.cobro.producto_id) &&
          [x.cobro.producto_id, ...(x.cobro.acepta ?? [])].some((id) => comprados.has(id))
      )
    : undefined;
  // LA ETAPA (25/10/2026): vendiendo (lo que se le ofrece aún no lo compró), con los datos de pago ya
  // enviados (espera su comprobante), o después de comprar sin nada nuevo delante.
  const fresca = getConversationById(convo.id) ?? convo;
  const datosEnviados = !!cobro && (estado?.cobro_pagado ?? 0) <= 0 && (!cobro.cobro?.metodos || !!fresca.selected_payment_method?.trim());
  const yaCompro = comprados.size > 0 || entregasDelCliente(convo.id).length > 0;
  const nombresComprados = new Set([...comprados].map((id) => nombreDe(id)));
  const ofreceAlgoNuevo = ofrece.some((n) => !!n && !nombresComprados.has(n));
  const etapa: "venta" | "datos" | "postventa" = datosEnviados ? "datos" : yaCompro && !ofreceAlgoNuevo ? "postventa" : "venta";
  const postventa = etapa === "postventa" ? textoDePostventa(config, estado?.canal || "whatsapp") : "";
  // ¿TOCA OFRECER LAS IMÁGENES? Pregunta por el contenido, quedan muestras por ver y en esta ficha aún
  // no se ofrecieron (como la venta de siempre: una vez por etapa).
  // (Un PROBLEMA no es una pregunta por el contenido: «ya probé todo y no funciona» ofrecía fotos.)
  const ultimo = ultimoDelCliente(convo.id);
  const hablaDeUnProblema = /\b(no funciona|no me funciona|error|no puedo|no me (llega|deja|sale|abre|carga)|problema|falla)\b/.test(ultimo);
  const ofrecerImagenes =
    !nota &&
    muestras.length > 0 &&
    looksLikeProductContentTurn(ultimo) &&
    !hablaDeUnProblema &&
    // Ya compró: tiene el material, no se le ofrecen fotos (salía en «¿hasta cuándo tengo acceso?»).
    !yaCompro &&
    !muestrasEnviadas(estado).includes(`oferta:${estado?.ficha_id ?? ""}`);
  const ofertaDeImagenes = ofrecerImagenes ? getSamplesOfferBubble() : "";
  const salio = await responderConIA(convo, {
    cerebroGeneral: t.cerebro,
    instrucciones: ficha?.instrucciones,
    ...(ofreciendoAhora ? { ofreciendoAhora } : {}),
    ...(upgrade
      ? {
          completar: {
            para: nombreDe(upgrade.cobro?.producto_id) ?? "el otro",
            ir: async () => {
              // Si estaba en el regalo, sale de él (se cancela lo que el regalo tenía programado): su
              // cobro manda ahora. Al pagar, su ruta lo vuelve a llevar a la entrega y al regalo.
              const fresca = getConversationById(convo.id) ?? convo;
              if (ESTADOS_DEL_REGALO.has(fresca.state ?? "")) {
                cancelPendingActionsForConvo(convo.id);
                setConversationState(convo.id, "tablero");
              }
              await irA(convo.id, t, upgrade.id);
            },
          },
        }
      : {}),
    ...(!nota && entregasDelCliente(convo.id).length > 0
      ? { pedirCorreo: () => quiereSuCorreo(convo, t, ultimosMensajes(convo.id, 4).filter((m) => m.role === "user").pop()?.content ?? "") }
      : {}),
    preguntaPendiente: ficha && ficha.tipo !== "cobro" && etapa === "venta" ? textoDeLaUltimaBurbuja(pasosVistos(ficha, estado)) : undefined,
    montosPermitidos: [...new Set([...(estado ? montosDelCobro(t, estado, pais) : []), ...montos])],
    moneda: getCountryInfo(pais).currency,
    nota,
    productos,
    dialecto: getCountryInfo(pais).dialect,
    ...(puedeReenviar
      ? {
          reenviar: async () => {
            reenviarLoDelTablero(convo);
          },
        }
      : {}),
    ...(metodo && estado && !nota
      ? {
          reenviarDatos: async () => {
            await reenviarDatosDelCobro(convo, t, metodo);
          },
        }
      : // UN COBRO QUE NO PREGUNTA MÉTODO (la contribución, 25/10/2026): sus datos son SUS burbujas (los
        // niveles y la cuenta). Si los pide otra vez («pásame el yape»), se reenvían tal cual; antes la
        // IA no tenía cómo y daba vueltas. Solo sin nada pagado aún.
        cobro?.cobro && !cobro.cobro.metodos && estado && estado.cobro_pagado <= 0 && !nota && pasosActivos(cobro.steps).length
        ? {
            reenviarDatos: async () => {
              const pasos = conLosComodinesDeLaFicha(
                pasosActivos(cobro.steps),
                productosDeLaFicha(config, idsParaComodines(convo.id, cobro, t), pais, estado.oferta === 1),
                pais
              );
              console.log(`[tablero] convo ${convo.id}: reenvío las burbujas de su cobro «${cobro.titulo || cobro.id}»`);
              await sendConfiguredSteps(convo, pasos as never);
            },
          }
        : {}),
    // LA ETAPA, para que cierre como la venta de siempre (punto 6) y la postventa (punto 11).
    etapa,
    ...(etapa === "postventa" && postventa ? { postventa } : {}),
    // LA OFERTA DE IMÁGENES LA PONE EL BOT, no la IA (punto 7, como la venta de siempre): pregunta por
    // el contenido y quedan muestras por ver → tras su respuesta, tu burbuja «¿Deseas ver unas
    // imágenes…?», al FINAL de la fila (después de la última burbuja de la IA). Su «sí» del turno
    // siguiente manda la galería (`mandarLaGaleria`). Una vez por ficha.
    ...(ofrecerImagenes && ofertaDeImagenes ? { noOfrezcasImagenes: true, alFinal: [ofertaDeImagenes] } : {}),
  });
  if (salio && ofrecerImagenes) {
    if (ofertaDeImagenes) {
      apuntarImagenesOfrecidas(convo.id, true);
      anotarMuestras(convo.id, [`oferta:${estado?.ficha_id ?? ""}`]);
      console.log(`[tablero] convo ${convo.id}: pregunta por el contenido → ofrece ver las imágenes`);
    }
  }
}

/** Lo último que escribió el cliente (texto), para saber de qué habla en este turno. */
function ultimoDelCliente(conversationId: number): string {
  return (ultimosMensajes(conversationId, 4).filter((m) => m.role === "user").pop()?.content ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "");
}

/**
 * TUS TEXTOS DE POSTVENTA (cómo usar la entrega, acceso de por vida, preferencias), los mismos de la
 * venta de siempre: los del canal del cliente, de la primera modalidad que los tenga escritos.
 */
function textoDePostventa(config: WorkflowConfig | null, canal: string): string {
  const porModalidad = config?.channels?.[canal as "whatsapp"]?.modality_templates ?? {};
  for (const modo of ["lineal", "doble_oferta_upsell", "order_bump", "doble_oferta_dos", "bioferta"]) {
    const ps = (porModalidad as Record<string, { post_sale?: Record<string, string | undefined> } | undefined>)[modo]?.post_sale;
    const partes = [ps?.deliveryUsage, ps?.lifetimeAccess, ps?.whatsappPreference].map((x) => (x ?? "").trim()).filter(Boolean);
    if (partes.length) return partes.join("\n");
  }
  return "";
}

/**
 * MANDA LA GALERÍA (25/10/2026, punto 7), como la venta de siempre: TODAS las muestras que le quedan
 * por ver de lo ya presentado, en orden, una sola vez, y al final tu burbuja de cierre de las muestras
 * (la misma de la venta de siempre, `getSamplesAfterSequence`). Un solo camino: ya no manda una suelta.
 * Sin muestras por ver (o con «📷 Ofrecer imágenes» apagado), false y no manda nada.
 */
async function mandarLaGaleria(convo: ConversationRow): Promise<boolean> {
  const muestras = muestrasDisponibles(estadoEnElTablero(convo.id));
  if (muestras.length === 0) return false;
  const salieron: string[] = [];
  for (const m of muestras) {
    // Una foto que no se puede bajar no deja al cliente sin respuesta: se salta y queda escrito.
    try {
      await sendBotMediaFromDrive(convo, m.tipo, m.url, m.pie);
      if (m.extra.length) await sendConfiguredSteps(convo, m.extra as never);
      salieron.push(m.id);
    } catch (err) {
      console.error(`[tablero] convo ${convo.id}: no se pudo enviar la muestra ${m.id} (${m.url})`, err);
    }
  }
  if (salieron.length === 0) return false;
  anotarMuestras(convo.id, salieron);
  const cierre = getSamplesAfterSequence();
  if (cierre.length) await sendConfiguredSteps(convo, cierre as never);
  console.log(`[tablero] convo ${convo.id}: galería enviada (${salieron.join(", ")})`);
  return true;
}

/**
 * LAS MUESTRAS QUE PUEDE ENVIAR: las de la galería de cada producto YA PRESENTADO (como el motor de
 * siempre solo enseña la galería del producto que se vende), encendidas, con archivo, y que no se le
 * enviaron antes (cada una, una sola vez). En el orden en que se le presentaron los productos.
 */
function muestrasDisponibles(estado: EstadoEnElTablero | null): Array<{
  id: string;
  producto: string;
  tema: string;
  cuando?: string;
  tipo: "image" | "video" | "document" | "audio";
  url: string;
  pie?: string;
  extra: SequenceStep[];
}> {
  const config = loadWorkflowConfig();
  const ya = new Set(muestrasEnviadas(estado));
  return presentadosDe(estado).flatMap((pid) => {
    const p = producto(config, pid);
    return (p?.image_gallery ?? []).flatMap((g, i) => {
      const id = `${pid}#${i}`;
      const url = (g.drive_url ?? "").trim();
      if (g.enabled === false || !url || ya.has(id)) return [];
      const pie = g.caption_variants?.find((x) => x?.trim()) ?? g.caption;
      return [
        {
          id,
          producto: p?.name ?? pid,
          tema: (g.topic || (g.keywords ?? []).join(", ") || `muestra ${i + 1}`).slice(0, 120),
          cuando: g.when,
          tipo: g.media_type ?? "image",
          url,
          ...(pie?.trim() ? { pie } : {}),
          extra: (g.pasos_extra ?? []).filter((s) => (s as { enabled?: boolean }).enabled !== false),
        },
      ];
    });
  });
}

/**
 * LO QUE LA IA SABE DE LOS PRODUCTOS: solo de los ya presentados (fichas con «Presenta», cobros y
 * entregas). Su contenido y regalos salen de su ficha en Productos; su precio, del país del cliente
 * (el de oferta si un seguimiento ya la activó). Esos precios son montos que puede nombrar.
 */
function loQueSabeLaIA(convo: ConversationRow, estado: EstadoEnElTablero | null, pais: string): { productos: ProductoParaLaIA[]; montos: number[] } {
  const config = loadWorkflowConfig();
  const comprados = new Set(comprasDelCliente(convo.id).map((c) => c.producto_id).filter(Boolean));
  const montos: number[] = [];
  const productos = presentadosDe(estado).flatMap((id) => {
    const p = producto(config, id);
    if (!p) return [];
    const precio = precioDelProducto(p, pais, estado?.oferta === 1);
    const antes = p.precios_por_pais?.[pais]?.market_price ?? p.market_price;
    if (precio !== null) montos.push(precio);
    if (typeof antes === "number" && antes > 0) montos.push(antes);
    return [
      {
        nombre: p.name ?? id,
        ...(precio !== null ? { precio: formatCurrencyAmount(precio, pais as never) } : {}),
        ...(typeof antes === "number" && antes > 0 ? { antes: formatCurrencyAmount(antes, pais as never) } : {}),
        contenido: p.course_content,
        regalos: p.regalos,
        comprado: comprados.has(id),
      },
    ];
  });
  return { productos, montos };
}

/** Los datos del método que ya eligió, para lo que eligió en el cobro abierto, al precio congelado. */
async function reenviarDatosDelCobro(convo: ConversationRow, t: Tablero, metodo: string): Promise<boolean> {
  const e = estadoEnElTablero(convo.id);
  const f = e?.cobro_ficha_id ? t.fichas.find((x) => x.id === e.cobro_ficha_id) : undefined;
  if (!e || !f?.cobro) return false;
  const id = e.cobro_elegido ?? f.cobro.producto_id ?? null;
  const precio = id ? preciosDelCobro(e)[id] : undefined;
  return mandarDatosDelMetodo(convo, metodo, precio, producto(loadWorkflowConfig(), id)?.name);
}

/** LA MISMA FRASE QUE EL VALIDADOR DE SIEMPRE: al cliente no se le dan pistas de qué falló. */
const SIN_PISTAS =
  "No pude validar ese comprobante. Pídele con amabilidad una foto más clara, donde se vea el comprobante completo. No le digas qué faltó. NO hay ningún pago recibido: nunca digas que lo recibiste, confirmaste o aprobaste.";

/** Un comprobante con el cobro abierto: se lee, se revisa, se cuenta y se sigue la salida de su monto. */
async function atenderComprobante(
  convo: ConversationRow,
  t: Tablero,
  estado: EstadoEnElTablero,
  yaLeido?: Awaited<ReturnType<typeof leerComprobante>>
): Promise<void> {
  const f = t.fichas.find((x) => x.id === estado.cobro_ficha_id);
  if (!f?.cobro) return;
  const lectura = yaLeido !== undefined ? yaLeido : await leerComprobante(convo.id);
  // UN COMPROBANTE RECHAZADO SE CUENTA, como en la venta de siempre (`trackFailedPaymentAttempt`):
  // al tercero seguido te avisa que el cliente no logra pagar. Se reinicia cuando paga.
  const fallo = (razon: string) => trackFailedPaymentAttempt(getConversationById(convo.id) ?? convo, razon);
  if (!lectura) {
    fallo("comprobante ilegible o que no es un comprobante");
    await contestarConIA(
      convo,
      t,
      "El cliente mandó una imagen que no se ve como un comprobante de pago legible. Pídele con amabilidad una captura clara del comprobante donde se vea el monto. NO hay ningún pago recibido: nunca digas que lo recibiste, confirmaste o aprobaste."
    );
    return;
  }
  const config = loadWorkflowConfig();
  const pais = getEffectiveCountryCode(convo.phone, config);
  const moneda = getCountryInfo(pais).currency;
  // LAS REVISIONES DE SIEMPRE (payment.ts): fecha visible si el país la exige, y en Yape/Plin el
  // titular (la primera palabra de quien cobra). Sin pistas para el cliente.
  const exigeFecha =
    resolveCountryPaymentProfile(pais as never, config)?.payment_validation?.require_receipt_date ??
    config?.payment_validation?.require_receipt_date ??
    false;
  if (exigeFecha && !lectura.fecha) {
    console.warn(`[tablero] convo ${convo.id}: comprobante SIN FECHA y el país la exige → no se cuenta`);
    fallo("comprobante sin fecha visible");
    await contestarConIA(convo, t, SIN_PISTAS);
    return;
  }
  if (lectura.metodo === "yape" || lectura.metodo === "plin") {
    const esperado = elCobroDelPais(pais as never, config).titular;
    if (esperado && (!lectura.titular || !titularCoincide(esperado, lectura.titular))) {
      console.warn(`[tablero] convo ${convo.id}: comprobante a nombre de «${lectura.titular ?? "?"}», se esperaba «${esperado}» → no se cuenta`);
      fallo(`comprobante a nombre de «${lectura.titular ?? "?"}», se esperaba «${esperado}»`);
      await contestarConIA(
        convo,
        t,
        lectura.titular
          ? `El comprobante está a nombre de «${lectura.titular}» y para validarlo debe estar a nombre de «${esperado}». Pídele el comprobante correcto, con amabilidad.`
          : SIN_PISTAS
      );
      return;
    }
  }
  const huella = huellaDelPago(lectura);
  if (huella && !apuntarHuella(huella, convo.id)) {
    console.log(`[tablero] convo ${convo.id}: comprobante repetido (${huella})`);
    await contestarConIA(convo, t, "Ese comprobante ya estaba registrado antes. Díselo con amabilidad: ya lo tenemos y no hace falta enviarlo otra vez.");
    return;
  }
  const total = sumarAlCobro(convo.id, lectura.monto);
  const casi = (a: number, b: number) => a + 0.009 >= b;
  let salida: string;
  // EL QUE ELIGIÓ: el de la ficha, o al que cambió («mejor el otro»), o el que queda tras el upgrade.
  const elegidoId = estado.cobro_elegido ?? f.cobro.producto_id ?? null;
  let productoPagado: string | null = elegidoId;
  const salidaDe = (id: string) => (id === f.cobro!.producto_id ? "pagado" : `prod:${id}`);
  if (f.cobro.modo === "producto") {
    // ELIGIÓ UNO Y PAGÓ OTRO, como en la venta de siempre: si alcanza para uno más caro de los que
    // acepta este cobro, se le entrega ese; si no alcanza para el elegido pero sí para otro más
    // barato, se le pregunta si fue un error o si prefiere ese.
    const precios = preciosDelCobro(estadoEnElTablero(convo.id) ?? estado);
    const principal = elegidoId ? precios[elegidoId] : undefined;
    const ordenados = Object.entries(precios).sort((a, b) => b[1] - a[1]);
    const alcanza = ordenados.find(([, p]) => casi(total, p));
    if (principal === undefined) salida = "pagado";
    else if (casi(total, principal)) {
      const mejor = alcanza && alcanza[1] > principal ? alcanza[0] : elegidoId!;
      productoPagado = mejor;
      salida = salidaDe(mejor);
    } else if (alcanza && alcanza[0] !== elegidoId) {
      proponerProducto(convo.id, alcanza[0]);
      const nombre = producto(config, alcanza[0])?.name ?? "el otro producto";
      console.log(`[tablero] convo ${convo.id}: pagó ${total}, no alcanza para el elegido pero sí para «${nombre}» → le pregunto`);
      await contestarConIA(
        convo,
        t,
        `Recibimos su pago de ${total} ${moneda}. Ese monto corresponde a «${nombre}», no al que había elegido. Pregúntale con amabilidad si fue un error (puede completar la diferencia) o si prefiere quedarse con «${nombre}». No inventes montos.`
      );
      return;
    } else salida = "menos";
  } else {
    const minimo = f.cobro.minimo_por_pais?.[pais] ?? 0;
    if (!casi(total, minimo)) salida = "menos";
    else {
      // EL TRAMO MÁS ALTO QUE ALCANZA: con tramos que se pisan, gana el de mayor «desde».
      const tramo = [...(f.cobro.tramos_por_pais?.[pais] ?? [])]
        .sort((a, b) => b.desde - a.desde)
        .find((tr) => casi(total, tr.desde) && (tr.hasta === undefined || total <= tr.hasta + 0.009));
      salida = tramo ? `tramo:${tramo.id}` : "pagado";
    }
  }
  console.log(`[tablero] convo ${convo.id}: pagó ${lectura.monto} (acumulado ${total} ${moneda}) → salida ${salida}`);
  if (salida === "menos") {
    // EL COBRO SIGUE ABIERTO: puede completar con otro comprobante, y se suma.
    if (!(await seguirPor(convo.id, t, f.id, "menos", 0)))
      await contestarConIA(convo, t, `Recibimos su pago de ${lectura.monto} ${moneda}, pero no alcanza el monto esperado. Díselo con amabilidad, sin inventar el monto que falta.`);
    return;
  }
  await cerrarLaVenta(convo, t, f, salida, productoPagado, total, moneda);
}

/** Las fichas a las que se llega por cables desde `desde` (incluida), en orden de cercanía. */
function alcanzables(t: Tablero, desde: string[]): string[] {
  const vistas = new Set<string>(desde);
  const cola = [...desde];
  for (let i = 0; i < cola.length; i++)
    for (const c of t.cables)
      if (c.de === cola[i] && !vistas.has(c.a)) {
        vistas.add(c.a);
        cola.push(c.a);
      }
  return cola;
}

/**
 * LA ENTREGA DE UN PRODUCTO EN LA MISMA RUTA que ese cobro: primero lo que sale del cobro, después lo
 * que sale de los Inicios que llegan a él (así no se entrega con la ficha de otro país o de otro
 * carril que no le corresponde). Su entrega principal (`entregasDeLaFicha` con la clave del producto).
 */
function entregaDelProductoEnSuRuta(t: Tablero, cobroId: string, productoId: string): FichaDelTablero | null {
  const esLaSuya = (id: string) => {
    const f = t.fichas.find((x) => x.id === id);
    return f?.tipo === "entregar" && !f.apagada && entregasDeLaFicha(f).includes(productoId) ? f : null;
  };
  for (const id of alcanzables(t, [cobroId])) {
    const f = esLaSuya(id);
    if (f) return f;
  }
  const inicios = t.fichas.filter((x) => x.tipo === "inicio" && alcanzables(t, [x.id]).includes(cobroId)).map((x) => x.id);
  for (const id of alcanzables(t, inicios)) {
    const f = esLaSuya(id);
    if (f) return f;
  }
  return null;
}

/**
 * UN COMPROBANTE SIN COBRO ABIERTO (25/10/2026): antes lo atendía la «Caja abierta». Ahora se busca,
 * entre los cobros a los que el cliente puede llegar desde donde está (sus opciones y las de sus
 * seguimientos), el que cobra (o acepta) un producto con ESE precio. Ese se abre en silencio y su
 * comprobante se lee contra él. Ninguno encaja: null (se te avisa, como antes).
 */
function cobroQueEncajaConElPago(t: Tablero, desde: string[], monto: number, pais: string): FichaDelTablero | null {
  const config = loadWorkflowConfig();
  const casi = (a: number, b: number) => Math.abs(a - b) < 0.01;
  for (const id of alcanzables(t, desde)) {
    const f = t.fichas.find((x) => x.id === id);
    if (f?.tipo !== "cobro" || f.apagada || f.cobro?.modo !== "producto") continue;
    for (const pid of [f.cobro.producto_id, ...(f.cobro.acepta ?? [])]) {
      if (!pid) continue;
      const p = producto(config, pid);
      const normal = precioDelProducto(p, pais, false);
      const oferta = precioDelProducto(p, pais, true);
      if ((normal !== null && casi(normal, monto)) || (oferta !== null && casi(oferta, monto))) return f;
    }
  }
  return null;
}

async function cerrarLaVenta(
  convo: ConversationRow,
  t: Tablero,
  f: FichaDelTablero,
  salida: string,
  productoId: string | null,
  total: number,
  moneda: string
): Promise<void> {
  cerrarCobro(convo.id);
  anotarCompra({ conversationId: convo.id, fichaId: f.id, productoId, salida, monto: total, moneda });
  // COMPRÓ: lo que venga (el upsell) es otra venta, con sus seguimientos desde el 1.
  reiniciarSeguimientosHechos(convo.id);
  // LO PAGADO, EN LA CONVERSACIÓN (25/10/2026), como la venta de siempre (`addToPaidTotal`): de ahí
  // lo leen el kanban (comprador y su dinero), los resultados y la autopurga (que NUNCA borra a quien
  // pagó). Sin esto, quien compraba por el tablero se veía como si no hubiera comprado.
  addToPaidTotal(convo.id, Math.round(total * 100));
  // Pagó: los comprobantes rechazados de antes ya no cuentan (como en la venta de siempre).
  resetPaymentAttemptsFailed(convo.id);
  if (!convo.paid_at) setPaidAt(convo.id, ahora());
  void sendPurchaseEvent({
    conversationId: convo.id,
    userData: buildMessagingUserData({
      channel: convo.channel,
      phone: convo.phone,
      firstName: convo.client_name ?? convo.name,
      email: convo.client_email,
      ctwa_clid: convo.ctwa_clid,
    }),
    value: total,
    currency: moneda,
  }).catch(() => {});
  void syncLeadStatus(convo.id).catch(() => {});
  if (convo.channel !== "test")
    void notifyAdmin(
      `💰 *Pago en el tablero:* ${convo.client_name ?? convo.name ?? convo.phone} — ${total} ${moneda} (${f.titulo || "Cobro"}).`
    ).catch(() => {});
  if (!(await seguirPor(convo.id, t, f.id, salida, 0))) {
    // «PAGÓ EL PRECIO DEL OTRO» SIN CABLE (25/10/2026, punto 21), como la venta de siempre: se le entrega
    // lo que pagó. El bot busca la ficha Entregar de ESE producto en su misma ruta y sigue por ahí.
    const entrega = productoId ? entregaDelProductoEnSuRuta(t, f.id, productoId) : null;
    if (entrega) {
      console.log(`[tablero] convo ${convo.id}: «${salida}» sin cable → su entrega «${entrega.titulo || entrega.id}» de la misma ruta`);
      await irA(convo.id, t, entrega.id, 1);
      return;
    }
    // PAGÓ Y SU RUTA NO SIGUE (24/10/2026): esa salida no tiene cable —se cortó o nunca se tiró—.
    // El pago queda registrado, pero nadie le entrega nada: se te avisa para que lo hagas a mano, y al
    // cliente se le dice que un asesor le escribe (no un «gracias» a secas, que parece que ya terminó).
    console.warn(`[tablero] convo ${convo.id}: pagó ${total} ${moneda} y la salida «${salida}» de «${f.titulo || "Cobro"}» no tiene cable`);
    if (convo.channel !== "test")
      void notifyAdmin(
        `⚠️ *Tablero:* ${convo.client_name ?? convo.name ?? convo.phone} pagó ${total} ${moneda} pero la salida «${salida}» de «${f.titulo || "Cobro"}» no tiene cable: entrégale a mano.`
      ).catch(() => {});
    await contestarConIA(
      convo,
      t,
      `Su pago de ${total} ${moneda} quedó registrado. Agradécele de corazón y dile que en un momento un asesor le envía lo suyo. No prometas plazos.`
    );
  }
}

// ── EL CORREO ──────────────────────────────────────────────────────────────────

/**
 * EL MATERIAL EN TEXTO, para el correo: lo que dicen las burbujas de entrega de cada producto que
 * le entregó el tablero, con sus enlaces. Un correo no es WhatsApp: el comodín del producto se
 * cambia por su nombre, de cada {a|b} sale la primera, sin asteriscos, y un comodín que el correo
 * no sabe llenar se quita (mejor una línea más corta que «{{ALGO}}» delante del cliente).
 */
/** Lo que va en el correo: cada entrega que salió (la principal de un producto o una extra suya). */
type LoEntregado = { name?: string; delivery?: SequenceStep[] };

function materialParaElCorreo(productos: LoEntregado[]): string {
  const limpiar = (t: string, nombre: string) =>
    t
      .replace(/\{\{\s*producto(_entregado)?\s*\}\}/gi, nombre)
      .replace(/\{\{[^}]*\}\}/g, "")
      .replace(/\{([^{}]*\|[^{}]*)\}/g, (_x, opciones: string) => opciones.split("|")[0])
      .replace(/\*([^*\n]+)\*/g, "$1")
      .replace(/[ \t]+\n/g, "\n")
      .trim();
  return productos
    .map((p) => {
      const nombre = p.name ?? "";
      const partes = (p.delivery ?? []).flatMap((s) => {
        const x = s as { enabled?: boolean; body?: string; body_variants?: string[]; texts?: string[]; caption?: string; caption_variants?: string[]; drive_url?: string };
        if (x.enabled === false) return [];
        const texto = x.body_variants?.find((v) => v?.trim()) ?? x.texts?.find((v) => v?.trim()) ?? x.body ?? x.caption_variants?.find((v) => v?.trim()) ?? x.caption ?? "";
        return [limpiar(texto, nombre), (x.drive_url ?? "").trim()].filter(Boolean);
      });
      return [`— ${nombre} —`, ...partes].join("\n\n");
    })
    .join("\n\n\n");
}

/**
 * SOLO LOS ENLACES de lo que compró, con el nombre de cada producto (24/10/2026). El dueño: «para
 * enviar por correo yo no mando nada más que los enlaces de compra». Salen de las burbujas de entrega
 * de cada producto (los enlaces de su texto y sus archivos de Drive), sin repetir.
 */
function enlacesParaElCorreo(productos: LoEntregado[]): string {
  return productos
    .map((p) => {
      const enlaces = new Set<string>();
      for (const s of p.delivery ?? []) {
        const x = s as { enabled?: boolean; body?: string; body_variants?: string[]; texts?: string[]; caption?: string; drive_url?: string };
        if (x.enabled === false) continue;
        const textos = [x.body, ...(x.body_variants ?? []), ...(x.texts ?? []), x.caption].filter(Boolean).join("\n");
        for (const m of textos.matchAll(/https?:\/\/[^\s*)<>"']+/g)) enlaces.add(m[0].replace(/[.,;:!?]+$/, ""));
        if (x.drive_url?.trim()) enlaces.add(x.drive_url.trim());
      }
      return [`${p.name ?? ""}:`, ...[...enlaces].map((e) => `• ${e}`)].join("\n");
    })
    .join("\n\n");
}

/** El correo de fábrica (la entrega con «📧 por correo» y el que pide de palabra): solo sus enlaces. */
const CORREO_DE_FABRICA = "Hola 👋\n\nAquí tienes los enlaces de tu compra:\n\n{{ENLACES}}\n\n¡Gracias por tu compra!";
// Los textos de fábrica de «📧 Ofrecer también por correo» en la ficha Entregar (él los cambia ahí).
const CORREO_PREGUNTA = "¿Te lo envío también a tu correo? 📧";
const CORREO_SI = "📧 Sí, por correo";
const CORREO_NO = "Solo WhatsApp";
const CORREO_PIDE = "¡Claro! ¿A qué correo te lo envío? ✍️";
const BOTON_CORREO_SI = "tablero_correo_si";
const BOTON_CORREO_NO = "tablero_correo_no";
const PATRON_DE_CORREO = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

/**
 * QUIERE SUS ENLACES POR CORREO (por el botón de la entrega o pidiéndolo de palabra). Si en el mismo
 * mensaje viene su correo, o ya lo dio antes, se envía ahí; si no, se le pide y se espera. Devuelve
 * lo que la IA debe decirle (o null si ya se le escribió).
 */
async function quiereSuCorreo(convo: ConversationRow, t: Tablero, mensaje: string): Promise<string | null> {
  const fresca = getConversationById(convo.id) ?? convo;
  const correo = mensaje.match(PATRON_DE_CORREO)?.[0] ?? (fresca.client_email ?? "").trim();
  if (correo) {
    esperarCorreo(convo.id, 0);
    const ok = await enviarElCorreo(fresca, correo);
    return ok
      ? `Ya le enviamos los enlaces de lo que compró a ${correo}. Díselo, que revise también spam, y que si prefiere otro correo solo lo escriba.`
      : // Sin promesas: el recorrido cazó a la IA diciendo «ahora mismo te envío» con el envío fallado.
        "El correo NO se pudo enviar. NO digas que se envió ni que se enviará ahora. Dile con amabilidad que el material ya lo tiene aquí en el chat y que un asesor le escribirá por el correo.";
  }
  esperarCorreo(convo.id, 1);
  const entrega = t.fichas.find((f) => f.tipo === "entregar" && f.por_correo);
  await sendBotText(convo, entrega?.correo_pide || CORREO_PIDE);
  return null;
}

/**
 * MANDA EL CORREO con lo que le entregó el tablero. Asunto y texto: los de la ficha «Pedir correo» si
 * los tiene; si no, el de fábrica. {{ENLACES}} = solo los enlaces; {{MATERIAL}} = el texto de la
 * entrega con sus enlaces. En el simulador no sale de verdad, como el correo de siempre. Guarda su
 * correo en la conversación (lo ve el panel, como siempre).
 */
async function enviarElCorreo(convo: ConversationRow, correo: string, f?: FichaDelTablero): Promise<boolean> {
  const config = loadWorkflowConfig();
  const productos: LoEntregado[] = entregasDelCliente(convo.id).flatMap((clave) => {
    const e = laEntrega(config, clave);
    return e ? [{ name: e.nombre, delivery: e.pasos }] : [];
  });
  setClientEmail(convo.id, correo);
  if (productos.length === 0) {
    console.warn(`[tablero:correo] convo ${convo.id}: pidió el correo pero aún no se le entregó nada`);
    if (convo.channel !== "test")
      void notifyAdmin(`📧 *Tablero:* ${convo.client_name ?? convo.name ?? convo.phone} dio su correo (${correo}) pero aún no tiene nada entregado.`).catch(() => {});
    return false;
  }
  const asunto = (f?.correo_asunto ?? "").trim() || productos.map((p) => p.name).filter(Boolean).join(" + ");
  const plantilla = (f?.correo_texto ?? "").trim() ? f!.correo_texto! : CORREO_DE_FABRICA;
  const cuerpo = plantilla
    .split("{{ENLACES}}")
    .join(plantilla.includes("{{ENLACES}}") ? enlacesParaElCorreo(productos) : "")
    .split("{{MATERIAL}}")
    .join(plantilla.includes("{{MATERIAL}}") ? materialParaElCorreo(productos) : "");
  if (convo.channel === "test") {
    console.log(`[tablero:correo] convo ${convo.id}: (simulador, no se envía) a ${correo} — «${asunto}», ${cuerpo.length} letras`);
    return true;
  }
  try {
    await sendEmail({ to: correo, fromName: laTiendaDelTurno()?.nombre?.trim() || asunto, subject: asunto, body: cuerpo });
    console.log(`[tablero:correo] convo ${convo.id}: enviado a ${correo}`);
    return true;
  } catch (err) {
    console.error(`[tablero:correo] convo ${convo.id}: no se pudo enviar a ${correo}`, err);
    void notifyAdmin(`📧 *Tablero:* no se pudo enviar el correo a ${correo} (${convo.client_name ?? convo.phone}). Revisa GMAIL_USER / GMAIL_APP_PASSWORD.`).catch(() => {});
    return false;
  }
}

// ── EL TURNO DE UN CLIENTE ─────────────────────────────────────────────────────

/**
 * Devuelve true si lo atendió el tablero; false = sigue el motor de siempre, exactamente como si
 * esto no existiera.
 */
export async function alRecibirMensaje(
  convo: ConversationRow,
  contenido: string,
  /**
   * La tienda que pone el CANAL cuando la conversación no la trae. Es Instagram: sus
   * conversaciones no llevan número ni página, así que el motor de siempre las atiende con el
   * contenido general (y así sigue). El tablero usa la de la página unida a esa cuenta.
   */
  tiendaDelCanal?: Tienda | null
): Promise<boolean> {
  // /reiniciar (para probar): sale del tablero y el motor de siempre borra la charla como
  // siempre. El siguiente «hola» vuelve a entrar al tablero desde el Inicio.
  if (/^\/(restart|reset|reiniciar)$/i.test(contenido.trim())) {
    if (estadoEnElTablero(convo.id)) salirDelTablero(convo.id);
    return false;
  }
  const yaDentro = estadoEnElTablero(convo.id);
  const tiendaId = yaDentro?.tienda_id ?? (laTiendaDeLaConversacion(convo) ?? tiendaDelCanal)?.id;
  if (!tiendaId) return false;
  return conSuTienda(tiendaId, convo, () => turnoDelTablero(convo, contenido, tiendaDelCanal));
}

/**
 * EL TURNO CON SU TIENDA PUESTA: burbujas, comodines y precios leen la de esta conversación.
 * Si el turno ya la trae (WhatsApp, Messenger), no se envuelve nada. En un workflow se usa la
 * tienda de la conversación (el workflow no tiene tienda).
 */
function conSuTienda<T>(clave: string, convo: ConversationRow, fn: () => T): T {
  const tiendaId = esClaveDeWorkflow(clave) ? laTiendaDeLaConversacion(convo)?.id : clave;
  if (!tiendaId || laTiendaDelTurno()?.id === tiendaId) return fn();
  const t = (loadWorkflowConfig()?.tiendas ?? []).find((x) => x?.id === tiendaId) ?? null;
  return conLaTiendaDelTurno(t, fn);
}

async function turnoDelTablero(convo: ConversationRow, contenido: string, tiendaDelCanal?: Tienda | null): Promise<boolean> {
  let estado = estadoEnElTablero(convo.id);
  const config = loadWorkflowConfig();
  const pais = getEffectiveCountryCode(convo.phone, config);

  if (!estado) {
    // SOLO AL NACER. Una conversación que ya empezó con el motor de siempre se queda en él.
    if (convo.state !== "new") return false;
    const tienda = laTiendaDeLaConversacion(convo) ?? tiendaDelCanal ?? null;
    const canal = canalDelTablero(convo);
    const t = tableroDe(config, tienda?.id, canal);
    if (!tienda?.id || !t || !elTableroAtiende(t, pais)) return false;
    const inicio = inicioDelPais(t, pais)!;
    if (!entrarAlTablero(convo.id, tienda.id, inicio.id, canal)) return false;
    setConversationState(convo.id, "tablero");
    console.log(`[tablero] convo ${convo.id} entra al tablero de «${tienda.nombre ?? tienda.id}» (${canal}, ${pais})`);
    // LO MISMO QUE HACE EL MOTOR DE SIEMPRE AL NACER: el registro en Meta del cliente de anuncio
    // (LeadSubmitted) y su fila en el CRM.
    void sendContactEvent({
      conversationId: convo.id,
      userData: buildMessagingUserData({ channel: convo.channel, phone: convo.phone, firstName: convo.name, ctwa_clid: convo.ctwa_clid }),
    }).catch(() => {});
    void syncLeadStatus(convo.id).catch(() => {});
    await irA(convo.id, t, inicio.id);
    return true;
  }

  const t = tableroDe(config, estado.tienda_id, (estado.canal as CanalDelTablero) || "whatsapp");

  // EL REGALO lo atiende el motor de siempre, como en cualquier venta: su pregunta, sus botones, el
  // enlace, la captura. PERO si durante el regalo el cliente habla de OTRA cosa —el upsell que se le
  // ofreció, lo que compró, completar, el correo—, contesta la IA del tablero, que sabe todo eso (el
  // motor de siempre no conoce las fichas del tablero y podía confundir el regalo con el upsell).
  if (ESTADOS_DEL_REGALO.has(convo.state ?? "")) {
    // UN CORREO ELECTRÓNICO EN EL MENSAJE LO ATIENDE SIEMPRE EL TABLERO (24/10/2026, lo cazó el
    // recorrido por países): el motor de siempre lo tomaba como su «pedido de correo» y mandaba SU
    // plantilla, que es de su venta, no de lo que compró este cliente en el tablero.
    if (t && PATRON_DE_CORREO.test(contenido) && entregasDelCliente(convo.id).length > 0) {
      const nota = await quiereSuCorreo(convo, t, contenido);
      if (nota) await contestarConIA(convo, t, nota);
      return true;
    }
    // Y LOS BOTONES DE «📧 Ofrecer también por correo»: la entrega los manda justo antes del regalo, así
    // que casi siempre se tocan ya en él. Son del tablero: el motor de siempre no los conoce (contestaba
    // «no entendí», lo cazó el recorrido por países).
    if (t && (contenido === `bubble:${BOTON_CORREO_SI}` || contenido === `bubble:${BOTON_CORREO_NO}`)) {
      if (contenido === `bubble:${BOTON_CORREO_NO}`) {
        esperarCorreo(convo.id, 0);
        await contestarConIA(convo, t, "Prefiere recibirlo solo por WhatsApp. Díselo en una frase amable: ya lo tiene aquí en el chat.");
      } else {
        const nota = await quiereSuCorreo(convo, t, "");
        if (nota) await contestarConIA(convo, t, nota);
      }
      return true;
    }
    // EL COMPROBANTE DEL UPSELL QUE LLEGA DURANTE EL REGALO (25/10/2026): dijo que sí, se calló, el
    // silencio lo llevó al regalo y después paga. El cobro sigue abierto (como en la venta de
    // siempre, la oferta sigue viva): si la imagen ES un comprobante de pago, la atiende el tablero.
    // Cualquier otra imagen (la captura del comentario) sigue siendo del regalo.
    if (t && estado.cobro_ficha_id && estado.cobro_pagado <= 0 && hayComprobantePendiente(convo.id, estado.comprobante_leido)) {
      marcarComprobanteLeido(convo.id, idDelComprobantePendiente(convo.id));
      const lectura = await leerComprobante(convo.id);
      if (lectura) {
        console.log(`[tablero] convo ${convo.id}: comprobante durante el regalo, con el cobro abierto → lo atiende el tablero`);
        await atenderComprobante(convo, t, estadoEnElTablero(convo.id) ?? estado, lectura);
        return true;
      }
      return false;
    }
    const delRegalo =
      !t ||
      !contenido.trim() ||
      contenido.startsWith("bubble:") ||
      hayComprobantePendiente(convo.id, estado.comprobante_leido) ||
      (await deQueHablaConIA(convo.id, contenido, [
        {
          id: "regalo",
          etiqueta:
            "Contesta o habla del REGALO: lo acepta o no, su comentario, su captura, cómo reclamarlo, responde a la pregunta del regalo, o pregunta algo SIN NOMBRAR otra cosa («¿qué es esto?», «¿cómo es?», «¿y eso?»): lo último que se le ofreció es el regalo",
        },
        {
          id: "otra",
          etiqueta:
            "Habla CLARAMENTE de OTRA cosa: nombra un producto que se le ofreció o que compró, completar o pagar la diferencia, recibirlo por correo, que no le llegó algo",
        },
      ])) !== "otra";
    if (delRegalo) return false;
    // COMO LA VENTA DE SIEMPRE: contesta lo que preguntó y lo devuelve con amabilidad al regalo, que
    // sigue pendiente (25/10/2026, punto 10).
    const vuelta =
      convo.state === "awaiting_gift_consent"
        ? "Contesta lo que preguntó y, al final, invítalo con amabilidad y con tus palabras a aceptar el regalo que se le acaba de ofrecer."
        : convo.state === "awaiting_facebook_comment"
          ? "Contesta lo que preguntó y, al final, recuérdale con amabilidad que cuando deje su comentario le envías su regalo."
          : undefined;
    await contestarConIA(convo, t!, vuelta);
    return true;
  }
  if (!t) {
    // Borró el tablero con clientes dentro: la IA contesta, sin ruta.
    await responderConIA(convo, { montosPermitidos: [] });
    return true;
  }

  // EL CLIENTE ESCRIBIÓ: el reloj del «no pagó» vuelve a empezar (como los seguimientos de hoy).
  if (estado.cobro_ficha_id && estado.cobro_pagado <= 0) {
    const cobro = t.fichas.find((x) => x.id === estado!.cobro_ficha_id);
    // Con sus Seguimientos colgados no hay reloj de «no pagó»: los tiempos son los de los seguimientos.
    if (cobro && cableDeLaSalida(t, cobro.id, "sin_pago") && !fichaDeSeguimientos(t, cobro.id, "sin_pago")) {
      const reloj = reiniciarRelojDelCobro(convo.id);
      programar(convo, ACCION_SIN_PAGO, { ficha: cobro.id, cobro_desde: estado.cobro_desde, reloj }, ahora() + minutosSinPago(cobro) * 60);
    }
  }

  // 1. UN COMPROBANTE CON EL COBRO ABIERTO, esté donde esté el cliente (también en un recordatorio).
  // Cada foto se lee UNA vez: queda anotada como leída aunque el bot no conteste nada después.
  const pendiente = hayComprobantePendiente(convo.id, estado.comprobante_leido);
  if (pendiente) marcarComprobanteLeido(convo.id, idDelComprobantePendiente(convo.id));
  if (estado.cobro_ficha_id && pendiente) {
    await atenderComprobante(convo, t, estado);
    return true;
  }
  // 1-bis. UN COMPROBANTE SIN NINGÚN COBRO ABIERTO: no se cuenta solo; se te avisa.
  if (!estado.cobro_ficha_id && pendiente) {
    const lectura = await leerComprobante(convo.id);
    // EL COBRO QUE ENCAJA CON SU MONTO, desde donde está (lo que hacía la «Caja abierta»).
    const encaja = lectura
      ? cobroQueEncajaConElPago(t, [estado.ficha_id, ...(estado.seg_ficha ? [estado.seg_ficha] : [])], lectura.monto, pais)
      : null;
    if (lectura && encaja) {
      await irA(convo.id, t, encaja.id, 0, { enSilencio: true });
      const abierto = estadoEnElTablero(convo.id);
      if (abierto?.cobro_ficha_id === encaja.id) {
        await atenderComprobante(convo, t, abierto, lectura);
        return true;
      }
    }
    if (lectura) {
      console.log(`[tablero] convo ${convo.id}: mandó un comprobante de ${lectura.monto} sin cobro abierto → aviso al dueño`);
      if (convo.channel !== "test")
        void notifyAdmin(
          `🧾 *Tablero:* ${convo.client_name ?? convo.name ?? convo.phone} mandó un comprobante de ${lectura.monto} sin que su ruta le pidiera pago. Revísalo en el chat.`
        ).catch(() => {});
      await contestarConIA(convo, t, "Mandó un comprobante de pago. Agradécele y dile que un asesor lo revisa enseguida. No confirmes el pago ni entregues nada.");
      return true;
    }
  }

  // 2. «¿FUE UN ERROR O PREFIERES X?»: lo que contesta a esa pregunta.
  if (estado.cobro_propuesta && estado.cobro_ficha_id) {
    const cobro = t.fichas.find((x) => x.id === estado!.cobro_ficha_id);
    const nombre = producto(config, estado.cobro_propuesta)?.name ?? "ese producto";
    const decide = await elegirOpcionConIA(convo.id, contenido, [
      { id: "quedarse", etiqueta: `Se queda con «${nombre}» (lo que pagó)` },
      { id: "completar", etiqueta: "Fue un error: va a completar el pago del que eligió" },
    ]);
    if (decide === "quedarse" && cobro) {
      const total = estado.cobro_pagado;
      const moneda = getCountryInfo(pais).currency;
      const salida = estado.cobro_propuesta === cobro.cobro?.producto_id ? "pagado" : `prod:${estado.cobro_propuesta}`;
      elegirEnElCobro(convo.id, estado.cobro_propuesta);
      await cerrarLaVenta(convo, t, cobro, salida, estado.cobro_propuesta, total, moneda);
      return true;
    }
    if (decide === "completar") {
      proponerProducto(convo.id, null);
      await contestarConIA(convo, t, "Va a completar el pago. Dile con amabilidad que esperamos el comprobante de lo que falta, sin inventar montos.");
      return true;
    }
  }

  // 1-ter. EL CORREO: los botones de «📧 Ofrecer también por correo» y, si se le pidió, su dirección.
  if (contenido === `bubble:${BOTON_CORREO_NO}`) {
    esperarCorreo(convo.id, 0);
    await contestarConIA(convo, t, "Prefiere recibirlo solo por WhatsApp. Díselo en una frase amable: ya lo tiene aquí en el chat.");
    return true;
  }
  if (contenido === `bubble:${BOTON_CORREO_SI}`) {
    const nota = await quiereSuCorreo(convo, t, "");
    if (nota) await contestarConIA(convo, t, nota);
    return true;
  }
  if (estado.correo_espera === 1 && PATRON_DE_CORREO.test(contenido)) {
    const nota = await quiereSuCorreo(convo, t, contenido);
    if (nota) await contestarConIA(convo, t, nota);
    return true;
  }

  // ── LO DE LA RONDA DEL 25/10/2026: como la venta de siempre ──
  const fichaAqui = t.fichas.find((x) => x.id === estado!.ficha_id);
  const segAqui = estado.seg_ficha && estado.seg_ficha !== estado.ficha_id ? t.fichas.find((x) => x.id === estado!.seg_ficha) : undefined;
  const texto = contenido.startsWith("bubble:") ? "" : contenido;
  const normal = texto.toLowerCase().normalize("NFD").replace(/\p{Mn}/gu, "");
  const metodoDicho = texto && !messageHasPaymentConcern(texto) ? metodoQueNombra(texto, convo.phone) : null;

  // 1-quater. EL UPSELL QUE TODAVÍA ESPERA SU TIEMPO (punto 9): no se ha presentado. Lo que escriba lo
  // contesta la IA sin hablar de él, y la espera vuelve a contar desde ahora.
  if (fichaAqui && estado.espera_ficha === fichaAqui.id && !contenido.startsWith("bubble:")) {
    rearmarEspera(convo, fichaAqui);
    await contestarConIA(convo, t);
    return true;
  }

  // 1-quinquies. «OK», «GRACIAS» CON LOS DATOS YA ENVIADOS: el bot se calla, como la venta de siempre
  // (`esUnAcuseSeco`). Solo con un cobro abierto cuyos datos ya salieron, sin una pregunta suya abierta,
  // sin imágenes ofrecidas y si no es un «ya pagué». Meta cobra por mensaje; el bot ya dijo lo único
  // que había que decir y espera su comprobante. El seguimiento 1 vuelve a contar igual.
  if (texto && estado.cobro_ficha_id && estado.cobro_pagado <= 0 && estado.imagenes_ofrecidas !== 1 && esUnAcuseSeco(texto)) {
    const cobro = t.fichas.find((x) => x.id === estado!.cobro_ficha_id);
    const datosEnviados = !!cobro && (!cobro.cobro?.metodos || !!(getConversationById(convo.id) ?? convo).selected_payment_method?.trim());
    const ecoDePago = /\b(listo|ya\s+esta|ahi\s+esta|ya\s+pague|ya\s+abone|ya\s+te\s+pase|te\s+pase|comprobante|voucher|capture|captura|pago\s+hecho)\b/.test(normal);
    const ultimaDelBot = [...ultimosMensajes(convo.id, 6)].reverse().find((m) => m.role !== "user")?.content ?? "";
    if (datosEnviados && !ecoDePago && !/[?¿]/.test(ultimaDelBot)) {
      console.log(`[tablero] convo ${convo.id}: «${texto.slice(0, 30)}» con los datos ya enviados → no se contesta (como la venta de siempre)`);
      respondio(convo, t);
      return true;
    }
  }

  // 1-sexies. LAS IMÁGENES (punto 7), como la venta de siempre: se ofrecieron en su turno anterior y
  // acepta (en cualquier forma) → el bot manda la galería completa, en orden, una vez, con tu burbuja
  // de cierre. Dura UN turno: un «sí» de otra cosa más adelante no suelta fotos.
  if (estado.imagenes_ofrecidas === 1) {
    apuntarImagenesOfrecidas(convo.id, false);
    if (texto) {
      const acepta = await elegirOpcionConIA(convo.id, texto, [
        { id: "ver", etiqueta: "Acepta ver las imágenes que se le acaban de ofrecer (sí, dale, a ver, ok, muéstramelas, un emoji de aprobación…)" },
      ]);
      if (acepta === "ver" && (await mandarLaGaleria(convo))) {
        respondio(convo, t);
        return true;
      }
    }
  }
  // Y si él mismo pide verlas («¿tienes fotos?», «mándame imágenes»), por el mismo camino. Pedir verlas,
  // no mandar él una foto: «te mando la foto del comprobante» no suelta la galería.
  const pideVerImagenes =
    /\b(ver|veo|vea|verlas?|manda\w*|envia\w*|mostrar|muestrame|ensena\w*|tienes|tiene|hay|pasa\w*)\b[^.?!]{0,25}\b(fotos?|imagen(es)?|muestras?)\b/.test(normal) &&
    !/\b(no|comprobante|pago|pague|yape\w*|plin|deposit\w*|transfer\w*|captura|voucher)\b/.test(normal);
  if (texto && pideVerImagenes) {
    if (await mandarLaGaleria(convo)) {
      respondio(convo, t);
      return true;
    }
  }

  // 1-septies. MANDA LA FICHA DONDE ESTÁ (punto 15): si un cuadrito suyo —o de sus seguimientos
  // colgados— reconoce el mensaje, se sigue SU cable, antes que el cobro abierto de atrás. Y si el
  // mensaje nombra un método, queda anotado (punto 8): al elegir producto le llegan sus datos de frente.
  if (texto) {
    for (const duena of [fichaAqui, segAqui]) {
      if (!duena || !(duena.tipo === "mensaje" || duena.tipo === "intro_ob" || duena.tipo === "seguimientos")) continue;
      const d = decisionQueCoincide(texto, opcionesDe(pasosDeLaFicha(duena)).cuadritos);
      if (!d || !cableDeLaSalida(t, duena.id, `dec:${d.id}`)) continue;
      if (metodoDicho) setSelectedPaymentMethod(convo.id, metodoDicho);
      await actuarCuadrito(convo, t, duena, d);
      return true;
    }
  }
  // 1-octies. EL MÉTODO, DONDE LO DIGA (punto 8): sin un cobro abierto, se anota igual. Y si la ficha
  // donde está tiene UNA sola opción que lleva a pagar (un Cobro o el Order bump), decir el método es
  // elegirla: «quiero pagar con yape» suelta el order bump, como en la venta de siempre.
  // (Con DOS o más opciones de compra —doble oferta— decir el método NO elige producto: se anota y la
  // IA le pregunta cuál quiere. Lo cazó la ronda del 25/10: «yape» elegía el básico solo.)
  let variasOpcionesDeCompra = false;
  if (metodoDicho && !estado.cobro_ficha_id) {
    setSelectedPaymentMethod(convo.id, metodoDicho);
    console.log(`[tablero] convo ${convo.id}: nombra el método «${metodoDicho}» → queda anotado`);
    const duenas = [fichaAqui, segAqui].filter((x): x is FichaDelTablero => !!x);
    const haciaPagar = duenas.flatMap((duena) => {
      const { botones, cuadritos } = opcionesDe(pasosDeLaFicha(duena));
      return [
        ...botones.map((b) => ({ duena, salida: `btn:${b.id}`, boton: b.id as string | null, cuadrito: null as BubbleDecision | null })),
        ...cuadritos.map((d) => ({ duena, salida: `dec:${d.id}`, boton: null as string | null, cuadrito: d as BubbleDecision | null })),
      ].filter((o) => {
        const destino = t.fichas.find((x) => x.id === cableDeLaSalida(t, duena.id, o.salida)?.a);
        return destino?.tipo === "cobro" || destino?.tipo === "intro_ob";
      });
    });
    const destinos = new Set(haciaPagar.map((o) => cableDeLaSalida(t, o.duena.id, o.salida)?.a));
    // Solo si dijo NADA MÁS que el método («yape», «quiero pagar con yape»); «el pack con yape» sí elige.
    const loDemas = normal
      .replace(/[^a-z0-9ñ\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w && !/^(quiero|quisiera|deseo|puedo|voy|a|pagar|pago|pagare|pagaria|con|por|en|mi|el|la|lo|si|ok|dale|bueno|hola|metodo|mediante|via)$/.test(w));
    variasOpcionesDeCompra = destinos.size > 1 && loDemas.length <= 1;
    if (haciaPagar.length > 0 && destinos.size === 1) {
      const o = haciaPagar[0];
      if (o.cuadrito) await actuarCuadrito(convo, t, o.duena, o.cuadrito);
      else {
        apuntarBoton(convo.id, o.boton!);
        await irA(convo.id, t, cableDeLaSalida(t, o.duena.id, o.salida)!.a);
      }
      return true;
    }
  }

  // 2-bis. EL MÉTODO Y EL PRODUCTO, con un cobro abierto que pide método — como la venta de siempre:
  // nombrar un método (o tocar su botón) manda SUS datos con el precio de lo elegido, en cualquier
  // momento (también para cambiar de método); «mejor el otro» cambia de producto y le llegan los
  // datos del nuevo con el método que ya eligió, sin repreguntar.
  if (estado.cobro_ficha_id && !contenido.startsWith("bubble:")) {
    const cobro = t.fichas.find((x) => x.id === estado!.cobro_ficha_id);
    if (cobro?.cobro?.metodos) {
      const precios = preciosDelCobro(estado);
      const elegidoId = estado.cobro_elegido ?? cobro.cobro.producto_id ?? null;
      // Nombrar el método para quejarse («me estafaron con el yape») no es elegirlo: la misma guarda
      // de la venta de siempre (`messageHasPaymentConcern`), y contesta la IA con empatía.
      const metodo = messageHasPaymentConcern(contenido) ? null : metodoQueNombra(contenido, convo.phone);
      if (metodo) {
        respondio(convo, t);
        if (await mandarDatosDelMetodo(convo, metodo, elegidoId ? precios[elegidoId] : undefined, producto(config, elegidoId)?.name)) return true;
      }
      // Solo entre los que ya se le presentaron: el que sigue oculto no se elige por aquí.
      const vistos = new Set(presentadosDe(estado));
      const opciones = Object.keys(precios).filter((id) => vistos.has(id));
      if (!metodo && estado.ficha_id === cobro.id && estado.cobro_pagado <= 0 && opciones.length > 1) {
        // Con su precio y cuál es el más barato / el más caro: «me quedo con el básico» no nombra el
        // producto (24/10/2026, la IA contestaba «ninguna» y le volvía a mandar los datos del caro).
        const orden = [...opciones].sort((a, b) => (precios[a] ?? 0) - (precios[b] ?? 0));
        const decide = await elegirOpcionConIA(
          convo.id,
          contenido,
          opciones.map((id) => ({
            id,
            etiqueta: `${producto(config, id)?.name ?? id} — precio ${precios[id] ?? "?"}${
              id === orden[0] ? " (el más barato: el básico)" : id === orden[orden.length - 1] ? " (el más caro: el completo)" : ""
            }${id === elegidoId ? " (el que tiene elegido ahora)" : ""}`,
            palabras: producto(config, id)?.aliases,
          }))
        );
        if (decide && decide !== elegidoId) {
          elegirEnElCobro(convo.id, decide);
          respondio(convo, t);
          const nombre = producto(config, decide)?.name;
          const yaElegido = metodoVigente(getConversationById(convo.id) ?? convo);
          console.log(`[tablero] convo ${convo.id}: cambia a «${nombre ?? decide}» en el cobro`);
          // Sin método aún: SUS burbujas del cobro con el nuevo producto y su precio (24/10/2026: solo
          // le llegaba el menú de métodos y no se enteraba de que ya era el otro ni de cuánto costaba).
          const pais = getEffectiveCountryCode(convo.phone, config);
          const pasos = conLosComodinesDeLaFicha(
            pasosActivos(cobro.steps),
            productosDeLaFicha(config, [decide, ...Object.keys(precios)], pais, false, precios),
            pais
          );
          if (!yaElegido || !(await mandarDatosDelMetodo(convo, yaElegido, precios[decide], nombre)))
            await preguntarElMetodo(convo, pasos as never, precios[decide], nombre);
          return true;
        }
      }
    }
  }

  const ficha = t.fichas.find((x) => x.id === estado!.ficha_id);

  // 2-ter. LA FICHA «PEDIR CORREO»: cuando escribe su correo, se le manda el material.
  if (ficha?.tipo === "correo" && !contenido.startsWith("bubble:")) {
    const correo = contenido.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
    respondio(convo, t);
    if (!correo) {
      await contestarConIA(convo, t, "Estás esperando su correo electrónico para enviarle el material. Contesta con naturalidad lo que escribió y vuelve a pedirle su correo.");
      return true;
    }
    if (await enviarElCorreo(convo, correo, ficha)) {
      if (!(await seguirPor(convo.id, t, ficha.id, "enviado", 0)))
        await contestarConIA(convo, t, `Ya le enviamos el material a ${correo}. Díselo y que revise también la carpeta de spam.`);
    } else
      await contestarConIA(convo, t, "No se pudo enviar el correo ahora. Dile con amabilidad que el material lo tiene aquí en el chat y que un asesor le escribirá.");
    return true;
  }

  const conRespuesta = ficha && (ficha.tipo === "mensaje" || ficha.tipo === "intro_ob" || ficha.tipo === "seguimientos");
  const vistos = ficha ? pasosVistos(ficha, estado) : [];
  const todas = ficha ? opcionesDe(pasosDeLaFicha(ficha)) : { botones: [] as BubbleButton[], cuadritos: [] as BubbleDecision[] };

  // 3. UN BOTÓN ESCRITO. En Instagram los botones salen como lista numerada («1. Sí, quiero»)
  // y el cliente contesta «1» o el texto; en cualquier canal alguien puede escribir el texto del
  // botón en vez de tocarlo. Solo los botones que VIO, de la ÚLTIMA burbuja que los tenga.
  if (conRespuesta && !contenido.startsWith("bubble:")) {
    const conBotones = vistos.filter((p) => (p.buttons ?? []).length > 0);
    const botones = (conBotones[conBotones.length - 1]?.buttons ?? []).filter((b) => b.id && b.label?.trim()).slice(0, 3);
    const limpio = (s: string) =>
      s.toLowerCase().normalize("NFD").replace(/\p{Mn}/gu, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    const dicho = limpio(contenido);
    const porNumero = convo.channel === "instagram" && /^[1-3]$/.test(dicho) ? botones[Number(dicho) - 1] : undefined;
    const porTexto = botones.find((b) => limpio(b.label) === dicho);
    const escrito = porNumero ?? porTexto;
    if (escrito) contenido = `bubble:${escrito.id}`;
  }

  // 4. UN BOTÓN, AUNQUE SEA DE UN MENSAJE ANTERIOR. Se busca la ficha que lo tiene (su id es
  // único en el tablero). Tocado otra vez desde un mensaje viejo, no repite nada.
  if (contenido.startsWith("bubble:")) {
    const id = contenido.slice("bubble:".length);
    const suFicha = t.fichas.find((f) => opcionesDe(pasosDeLaFicha(f)).botones.some((b) => b.id === id));
    const cable = suFicha ? cableDeLaSalida(t, suFicha.id, `btn:${id}`) : null;
    const repetido = !!suFicha && suFicha.id !== ficha?.id && botonYaUsado(convo.id, id);
    if (cable && !repetido) {
      apuntarBoton(convo.id, id);
      await irA(convo.id, t, cable.a);
      return true;
    }
    if (repetido) {
      await contestarConIA(convo, t, "El cliente volvió a tocar un botón que ya había usado. No repitas lo que ya se le envió; contéstale con naturalidad desde donde va.");
      return true;
    }
  }

  // LAS OPCIONES QUE VALEN AHORA: las de su ficha y las de sus seguimientos colgados (25/10/2026).
  const duenas = [conRespuesta ? ficha : undefined, segAqui].filter((x): x is FichaDelTablero => !!x);
  if (duenas.length > 0) {
    // 5. UN CUADRITO, por sus palabras: sus burbujas, y luego su cable.
    if (!contenido.startsWith("bubble:"))
      for (const duena of duenas) {
        const decision = decisionQueCoincide(contenido, opcionesDe(pasosDeLaFicha(duena)).cuadritos);
        if (decision) {
          await actuarCuadrito(convo, t, duena, decision);
          return true;
        }
      }
    // 6. NINGUNO ACERTÓ: la IA decide cuál eligió («el de 10», «el otro», «quiero pagar con yape»…), sin
    // escribir nada. Desde ahí sale lo mismo que si hubiera tocado o escrito esa opción.
    const lista = duenas.flatMap((duena) => {
      const { botones, cuadritos } = opcionesDe(pasosDeLaFicha(duena));
      return [
        ...botones.map((b) => ({ duena, op: { id: `btn:${b.id}`, etiqueta: b.label } as OpcionParaLaIA, d: null as BubbleDecision | null })),
        ...cuadritos.map((d) => ({
          duena,
          op: { id: `dec:${d.id}`, etiqueta: d.title || (d.keywords ?? []).join(", "), palabras: d.keywords } as OpcionParaLaIA,
          d: d as BubbleDecision | null,
        })),
      ];
    });
    if (!contenido.startsWith("bubble:") && lista.length > 0 && !variasOpcionesDeCompra) {
      const elegida = await elegirOpcionConIA(convo.id, contenido, lista.map((x) => x.op));
      const cual = lista.find((x) => x.op.id === elegida);
      if (cual?.d) {
        await actuarCuadrito(convo, t, cual.duena, cual.d);
        return true;
      }
      if (cual) {
        const cable = cableDeLaSalida(t, cual.duena.id, cual.op.id);
        if (cable) {
          apuntarBoton(convo.id, cual.op.id.slice(4));
          await irA(convo.id, t, cable.a);
          return true;
        }
      }
    }
    // 7. «OTRA COSA»: su cable, si lo tiene (solo la de su ficha).
    if (conRespuesta && ficha && (await seguirPor(convo.id, t, ficha.id, "otra", 0))) return true;
  }

  // 8. LO DEMÁS LO CONTESTA LA IA, y el cliente sigue en su ficha. Como respondió, el reloj de
  // «no respondió» vuelve a contar desde ahora, y el seguimiento 1 también (colgado o en su caja).
  if (ficha) respondio(convo, t);
  estado = estadoEnElTablero(convo.id) ?? estado;
  await contestarConIA(convo, t);
  return true;
}

async function actuarCuadrito(convo: ConversationRow, t: Tablero, ficha: FichaDelTablero, d: BubbleDecision): Promise<void> {
  if (d.steps?.length) await sendConfiguredSteps(convo, d.steps as never);
  if (await seguirPor(convo.id, t, ficha.id, `dec:${d.id}`, 0)) return;
  respondio(convo, t);
  // Un cuadrito sin burbujas ni cable: que no se quede sin respuesta.
  if (!d.steps?.length) await contestarConIA(convo, t);
}

/**
 * EL CLIENTE ESCRIBIÓ Y SIGUE EN SU FICHA: el reloj de «no respondió» vuelve a contar desde ahora
 * (25/10/2026). Antes solo contaba si NUNCA escribía: quien preguntaba algo y se callaba no recibía
 * jamás sus seguimientos ni su regalo. La venta de siempre cuenta el silencio desde el último mensaje
 * del cliente; aquí, igual. El reloj viejo ya no sale (lleva la vuelta anterior).
 */
function respondio(convo: ConversationRow, t: Tablero): void {
  const e0 = estadoEnElTablero(convo.id);
  const f0 = e0 ? t.fichas.find((x) => x.id === e0.ficha_id) : undefined;
  // Una ficha «Esperar» cuenta su tiempo aunque el cliente escriba: su reloj no se toca.
  if (f0?.tipo !== "esperar") tocarVuelta(convo.id);
  const e = estadoEnElTablero(convo.id);
  const f = e ? t.fichas.find((x) => x.id === e.ficha_id) : undefined;
  // «SI NO RESPONDE» vuelve a contar desde ahora (en Mensaje y Order bump, también sin minutos: el
  // silencio del regalo). Con seguimientos colgados de esta ficha no hay ese reloj: mandan ellos.
  const conColgados = !!f && !!(fichaDeSeguimientos(t, f.id, "siguiente") ?? fichaDeSeguimientos(t, f.id, "sin_respuesta"));
  if (e && f && (f.tipo === "mensaje" || f.tipo === "intro_ob") && !conColgados && cableDeLaSalida(t, f.id, "sin_respuesta"))
    programar(convo, ACCION_RELOJ, { ficha: f.id, salida: "sin_respuesta", vuelta: e.vuelta }, ahora() + minutosSinRespuesta(f) * 60);
  else if (e && f?.sin_respuesta_min && f.tipo === "correo")
    programar(convo, ACCION_RELOJ, { ficha: f.id, salida: "sin_respuesta", vuelta: e.vuelta }, ahora() + f.sin_respuesta_min * 60);
  // SUS SEGUIMIENTOS (en la caja o colgados de esta ficha): el 1 vuelve a contar desde ahora.
  const seg = e?.seg_ficha ? t.fichas.find((x) => x.id === e.seg_ficha) : undefined;
  if (seg) reprogramarSeguimiento(convo, seg);
}

/** EL UPSELL QUE ESPERA SU TIEMPO Y EL CLIENTE ESCRIBE: la espera vuelve a contar desde ahora. */
function rearmarEspera(convo: ConversationRow, f: FichaDelTablero): void {
  if (!f.espera_min) return;
  tocarVuelta(convo.id);
  const e = estadoEnElTablero(convo.id);
  if (!e) return;
  programar(convo, ACCION_RELOJ, { ficha: f.id, salida: ESPERA_CUMPLIDA, vuelta: e.vuelta }, ahora() + f.espera_min * 60, true);
}

/** El cliente escribió estando en la caja «Seguimientos»: el que tocaba vuelve a contar desde ahora. */
function reprogramarSeguimiento(convo: ConversationRow, ficha: FichaDelTablero): void {
  const e = estadoEnElTablero(convo.id);
  const segs = ficha.seguimientos ?? [];
  if (!e || e.seg_ficha !== ficha.id || e.seg_idx >= segs.length) return;
  // SOLO EL 1 VUELVE A CONTAR (25/10/2026, punto 4): es el que cae en medio de la conversación. Los
  // 2+ ya están en su horario fijo y se quedan ahí (en el simulador, a sus minutos: tampoco se mueven).
  if (e.seg_idx >= 1) return;
  const token = ponerSeguimiento(convo.id, ficha.id, e.seg_idx);
  // EL RELOJ VUELVE A CERO, como `renovarEsperaDeLosSeguimientos` del motor de siempre: los que
  // faltan cuentan sus minutos desde ahora.
  contarSeguimientosDesde(convo.id, ahora());
  const { cuando, sinSilencio } = cuandoSaleElSeguimiento(convo, segs[e.seg_idx], e.seg_idx, ahora());
  programar(convo, ACCION_SEGUIMIENTO, { ficha: ficha.id, idx: e.seg_idx, token }, cuando, sinSilencio);
}

/** ¿Esta conversación es del tablero? Para que el motor de siempre no le programe nada. */
export function esDelTablero(conversationId: number): boolean {
  return !!estadoEnElTablero(conversationId);
}

// ── ARRANCAR UN WORKFLOW DESDE LA VENTA DE SIEMPRE ────────────────────────────

/**
 * «▶ ACTIVAR WORKFLOW» en un botón o cuadrito de la venta de siempre. Se prepara aquí (sale de la
 * venta de siempre: se cancela lo que tenía programado y la intro en pausa) y el workflow arranca
 * en el siguiente tick, cuando el turno del motor de siempre ya terminó y no puede pisarlo.
 */
export async function prepararEntradaAlWorkflow(convo: ConversationRow, workflowId: string, deQuien: string): Promise<boolean> {
  const config = loadWorkflowConfig();
  const wf = tableroDe(config, claveDeWorkflow(workflowId), "whatsapp");
  const pais = getEffectiveCountryCode(convo.phone, config);
  const inicio = wf ? inicioDelPais(wf, pais) : null;
  if (!wf || !inicio) {
    console.warn(`[wf] convo ${convo.id}: "${deQuien}" quiere el workflow ${workflowId}, que no existe o no tiene Inicio`);
    return false;
  }
  cancelPendingActionsForConvo(convo.id);
  setIntroPausedIndex(convo.id, null);
  cambiarDeTablero(convo.id, claveDeWorkflow(workflowId), inicio.id, canalDelTablero(convo));
  scheduleAction(convo.id, ACCION_ENTRAR_WF, {}, ahora() + 1);
  console.log(`[wf] convo ${convo.id}: "${deQuien}" → entra al workflow «${wf.nombre ?? workflowId}»`);
  return true;
}

// ── LO PROGRAMADO DEL TABLERO ─────────────────────────────────────────────────

/** Los relojes de sus fichas. Lo manda aquí el obrero. */
export async function ejecutarAccionDelTablero(accion: ScheduledActionRow): Promise<void> {
  const convo = getConversationById(accion.conversation_id);
  if (!convo) return;
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(accion.payload || "{}");
  } catch {
    return;
  }
  const clave = estadoEnElTablero(convo.id)?.tienda_id;
  if (!clave) return;
  // CON SU TIENDA, SU NÚMERO Y SU PÁGINA, como lo programado del motor de siempre: aquí ya no
  // está el webhook delante, y con dos números o dos páginas saldría por el que no es.
  await conElTurnoDe(convo, () =>
    conSuTienda(clave, convo, () =>
      withOutboundWhatsAppNumber(convo.wa_phone_number_id ?? null, () =>
        withOutboundMessengerPage(convo.messenger_page_id ?? null, () => relojDelTablero(accion, convo, payload))
      )
    )
  );
}

async function relojDelTablero(accion: ScheduledActionRow, convo: ConversationRow, payload: Record<string, unknown>): Promise<void> {
  const estado = estadoEnElTablero(convo.id);
  if (!estado) return;
  const fresca = getConversationById(convo.id) ?? convo;
  const config = loadWorkflowConfig();
  const t = tableroDe(config, estado.tienda_id, (estado.canal as CanalDelTablero) || "whatsapp");
  if (!t) return;
  const ficha = String(payload.ficha ?? "");

  if (accion.action_type === ACCION_ENTRAR_WF) {
    // Viene de «Activar workflow» en la venta de siempre: ahora sí, desde su Inicio.
    setConversationState(convo.id, "tablero");
    await irA(convo.id, t, estado.ficha_id);
    return;
  }
  if (accion.action_type === ACCION_TRAS_REGALO) {
    // EL REGALO TERMINÓ: si su ficha tiene «Al terminar el regalo», la ruta sigue. Se cancela lo
    // que el regalo dejó programado (pasar a humano, encuesta) para que no se cruce con la ruta.
    const regalo = t.fichas.find((x) => x.id === estado.ficha_id && x.tipo === "regalo");
    const cable = regalo ? cableDeLaSalida(t, regalo.id, "fin") : null;
    if (!regalo || !cable) return;
    cancelPendingActionsForConvo(convo.id);
    setConversationState(convo.id, "tablero");
    await irA(convo.id, t, cable.a);
    return;
  }

  if (ESTADOS_DEL_REGALO.has(fresca.state ?? "")) return;
  // La ventana de 24 h: un mensaje libre ya no llegaría. No se intenta, como el motor de siempre.
  if (fueraDeLaVentana(fresca)) {
    console.log(`[tablero:24h] convo ${convo.id}: pasaron 24 h desde su último mensaje → no envío (${accion.action_type})`);
    return;
  }

  if (accion.action_type === ACCION_RELOJ) {
    // Solo si el cliente sigue en esa ficha desde entonces: si respondió o se movió, nada.
    if (estado.ficha_id !== ficha || estado.vuelta !== payload.vuelta) return;
    // LA ESPERA DE LA FICHA SE CUMPLIÓ: ahora sí manda sus burbujas.
    if (payload.salida === ESPERA_CUMPLIDA) {
      if (estado.espera_ficha !== ficha) return;
      await irA(convo.id, t, ficha, 0, { yaEspero: true });
      return;
    }
    await seguirPor(convo.id, t, ficha, String(payload.salida ?? ""), 0);
    return;
  }
  if (accion.action_type === ACCION_SIN_PAGO) {
    // Solo si ESE cobro sigue abierto, sin nada pagado, y nadie reinició su reloj (escribió).
    if (estado.cobro_ficha_id !== ficha || estado.cobro_desde !== payload.cobro_desde) return;
    if (estado.cobro_pagado > 0 || estado.cobro_reloj !== payload.reloj) return;
    await seguirPor(convo.id, t, ficha, "sin_pago", 0);
    return;
  }
  if (accion.action_type === ACCION_SEGUIMIENTO) {
    // Solo si sus seguimientos siguen puestos (en la caja, o colgados de la ficha donde espera) y nadie
    // cambió su turno: si se movió a otra ficha, `irA` los soltó; si escribió, el turno es otro.
    if (estado.seg_ficha !== ficha || estado.seg_token !== payload.token) return;
    const f = t.fichas.find((x) => x.id === ficha);
    const segs = f?.seguimientos ?? [];
    const idx = Number(payload.idx ?? 0);
    if (!f) return;
    if (idx >= segs.length) {
      // «TERMINARON SIN RESPUESTA»
      ponerSeguimiento(convo.id, null, 0);
      await seguirPor(convo.id, t, ficha, "fin", 0);
      return;
    }
    const seg = segs[idx];
    const v = versionQueLeToca(seg.variantes, clavesDelAnuncioDelCliente(fresca, loadWorkflowConfig()), "seguimiento");
    if (v) {
      apuntarVariante(convo.id, `${ficha}#${idx}`, v.id);
      const paisSeg = getEffectiveCountryCode(fresca.phone, loadWorkflowConfig());
      const pasosSeg = conLosComodinesDeLaFicha(
        pasosActivos(v.steps),
        // El que activa la oferta ya habla con el precio de oferta.
        productosDeLaFicha(loadWorkflowConfig(), idsParaComodines(convo.id, f, t), paisSeg, estado.oferta === 1 || !!seg.activa_oferta),
        paisSeg
      );
      await sendConfiguredSteps(fresca, pasosSeg as never);
    }
    if (seg.activa_oferta) {
      activarOferta(convo.id);
      // EL COBRO QUE YA ESTABA ABIERTO BAJA A LA OFERTA (24/10/2026, lo cazó el recorrido de
      // funciones): el seguimiento le decía «ahora a 15», pero el cobro seguía congelado en 20 y al
      // pagar 15 le contestaba «no alcanza». Solo BAJA (nunca se cobra más de lo dicho), solo si ese
      // cobro cobra «según la etapa», y no en el upgrade, donde el precio ya es una diferencia.
      const e = estadoEnElTablero(convo.id);
      const fc = e?.cobro_ficha_id ? t.fichas.find((x) => x.id === e.cobro_ficha_id) : undefined;
      if (e && fc?.cobro?.modo === "producto" && fc.cobro.precio !== "normal" && !fc.cobro.diferencia) {
        const config = loadWorkflowConfig();
        const pais = getEffectiveCountryCode(fresca.phone, config);
        const precios = preciosDelCobro(e);
        let bajo = false;
        for (const id of Object.keys(precios)) {
          const oferta = precioDelProducto(producto(config, id), pais, true);
          if (oferta !== null && oferta < precios[id]) {
            precios[id] = oferta;
            bajo = true;
          }
        }
        if (bajo) {
          ponerPreciosDelCobro(convo.id, precios);
          console.log(`[tablero] convo ${convo.id}: la oferta baja el cobro abierto a ${JSON.stringify(precios)}`);
        }
      }
    }
    // Lo que este seguimiento presenta, desde ahora la IA lo puede contar.
    anotarPresentados(convo.id, f.presenta ?? []);
    // QUEDA MARCADO (por su texto): no se le vuelve a mandar en esta etapa, ni desde un duplicado.
    marcarSeguimientoHecho(convo.id, huellaDelSeguimiento(seg));
    console.log(`[tablero] convo ${convo.id}: seguimiento ${idx + 1} de «${f.titulo || "Seguimientos"}»`);
    // EL SIGUIENTE, a sus minutos desde el mismo punto que los demás (el último mensaje del
    // cliente, o la hora a la que se aplazó un lead tardío), como el motor de siempre; tras el
    // último, «Terminaron sin respuesta» con la misma espera que el último.
    // (Se salta los que ya le salieron desde otros Seguimientos con los mismos textos.)
    const proximo = siguienteSinEnviar(convo.id, segs, idx + 1);
    const token = ponerSeguimiento(convo.id, ficha, proximo >= 0 ? proximo : idx + 1);
    const desde = estadoEnElTablero(convo.id)?.seg_desde ?? getLastUserMessageTime(convo.id) ?? ahora();
    const siguiente = proximo >= 0 ? segs[proximo] : undefined;
    if (siguiente) {
      const { cuando, sinSilencio } = cuandoSaleElSeguimiento(fresca, siguiente, proximo, desde);
      programar(fresca, ACCION_SEGUIMIENTO, { ficha, idx: proximo, token }, cuando, sinSilencio);
    } else {
      const espera = Math.max(seg.minutos - (segs[idx - 1]?.minutos ?? 0), 60);
      programar(fresca, ACCION_SEGUIMIENTO, { ficha, idx: segs.length, token }, ahora() + espera * 60);
    }
  }
}

// Para las pruebas: la lectura de un tablero suelto.
export { leeTablero };
