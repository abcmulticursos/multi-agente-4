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
import { AsyncLocalStorage } from "node:async_hooks";
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
  burbujasDeLaFicha,
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
  getPaymentMethods,
  getPaymentMethodsOfCountry,
} from "@/lib/workflow/config";
import {
  AVISO_DE_ACTUALIZACION_POR_DEFECTO,
  esUnAcuseSeco,
  messageHasPaymentConcern,
  scheduleGiftConsentWithDelay,
  sendConfiguredSteps,
} from "@/lib/workflow/engine";
import {
  adjustForQuietHours,
  computeNextFollowupSlot,
  cumulativeBurstOffset,
  isAtOrAfterLocalTime,
  isQuietHour,
  nextLocalTime,
} from "@/lib/workflow/quiet-hours";
import { looksLikeMediaTurn, preguntaCuantasOpcionesHay } from "@/lib/openrouter";
import { deQueHablaConIA, elegirOpcionConIA, responderConIA, type OpcionParaLaIA, type ProductoParaLaIA } from "./conversador";
import { conLosComodinesDeLaFicha, type ProductoConPrecio } from "./comodines";
import { conElNombreDelProducto, elUnicoMetodo, mandarDatosDelMetodo, metodoQueNombra, metodoVigente, nombreDelMetodo, preguntarElMetodo } from "./pago";
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
  eligeDeLaFicha,
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
  quienRegistroLaHuella,
  fichasVisitadas,
  reiniciarRelojDelCobro,
  salirDelTablero,
  precioDeSuEntrada,
  marcarAvisoDeNovedad,
  olvidarPresentados,
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

/**
 * EL CLIENTE DEL TURNO, para el precio de su entrada (28/10/2026). Cada puerta del motor (mensaje, regalo,
 * reloj) corre dentro de `conSuPrecio`; así `precioDelProducto` sabe de quién es sin pasarlo por las ~15
 * llamadas. Fuera de una puerta no hay cliente y el precio es el de hoy (lo de antes).
 */
const clienteDelTurno = new AsyncLocalStorage<number>();
function conSuPrecio<T>(conversationId: number, hacer: () => Promise<T>): Promise<T> {
  return clienteDelTurno.run(conversationId, hacer);
}

/** El precio de un producto en el país del cliente: el normal o el de oferta (si lo tiene). */
function precioDelProducto(p: ProductoDeLaBiblioteca | null, pais: string, deOferta: boolean): number | null {
  if (!p) return null;
  const suyo = p.precios_por_pais?.[pais];
  const positivo = (x: unknown) => (typeof x === "number" && x > 0 ? x : null);
  let normal = positivo(suyo?.price_soles ?? p.price_soles);
  let oferta = positivo(suyo?.discount_price_soles ?? p.discount_price_soles);
  // CONGELADO AL PRESENTARLO, como el automático: si él lo SUBE después, el cliente sigue con el que vio;
  // si lo BAJA, se queda con el más bajo.
  const convoId = clienteDelTurno.getStore();
  if (convoId && p.id) {
    const visto = precioDeSuEntrada(convoId, p.id, pais, normal, oferta);
    const menor = (hoy: number | null, antes: number | null) => (hoy !== null && antes !== null ? Math.min(hoy, antes) : hoy ?? antes);
    normal = menor(normal, visto.normal);
    oferta = menor(oferta, visto.oferta);
  }
  const v = deOferta && oferta !== null ? oferta : normal;
  return v;
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
  // CON «IGNORA LAS HORAS DE SILENCIO» MARCADA (27/10/2026), como los seguimientos de Canales: sale a sus
  // minutos, a cualquier hora, sin esperar las horas fijas («aquí no se lanzan»).
  if (idx >= 1 && seg.ignora_silencio !== true) {
    const conSilencioEste = sched?.quiet_hours_enabled !== false;
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
  // POR NÚMERO, COMO EL AUTOMÁTICO (28/10/2026, su HHH3): «seguimiento 1 es seguimiento 1, diga lo que
  // diga el contenido». Dos cajas con textos algo distintos se tomaban por otros seguimientos y el 1 salía
  // otra vez después del 2. Ahora, si ya recibió N en esta etapa, cualquier caja sigue desde el N+1 (y el
  // texto también cuenta, como antes). Al comprar se vacía: el upsell empieza desde el 1.
  for (let i = Math.max(desde, ya.size); i < segs.length; i++) if (!ya.has(huellaDelSeguimiento(segs[i]))) return i;
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
    /** Solo un Cobro: se cobra la DIFERENCIA con lo que ya pagó (el upgrade de la venta de siempre). */
    upgrade?: boolean;
  } = {}
): Promise<void> {
  const { yaEspero = false, enSilencio = false, upgrade = false } = opciones;
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
        const eligeYa = eligeDeLaFicha(f).map((id) => producto(config, id)?.name ?? "");
        if (ya.botones.length + ya.cuadritos.length + eligeYa.length > 0) {
          console.log(`[tablero] convo ${convoId}: vuelve a «${f.titulo || f.id}», que ya vio → no se repite`);
          const colgadosOtraVez = fichaDeSeguimientos(t, f.id, "siguiente") ?? fichaDeSeguimientos(t, f.id, "sin_respuesta");
          if (colgadosOtraVez) colgarSeguimientos(convo, colgadosOtraVez, t);
          else if (cableDeLaSalida(t, f.id, "sin_respuesta"))
            programar(convo, ACCION_RELOJ, { ficha: f.id, salida: "sin_respuesta", vuelta }, ahora() + minutosSinRespuesta(f) * 60);
          const nombres = [...ya.botones.map((b) => b.label), ...ya.cuadritos.map((d) => d.title), ...eligeYa].filter(Boolean).join(", ");
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
      // AL PASAR DE LA TUBERÍA VIEJA A LA NUEVA (con el aviso), la burbuja que ya recibió en la vieja —el
      // saludo, casi siempre— no se le repite: el aviso ya lo saludó (28/10/2026).
      const yaRecibidas = burbujasDeLaTuberiaVieja.get(convoId);
      if (yaRecibidas) {
        burbujasDeLaTuberiaVieja.delete(convoId);
        pasosAEnviar = pasosAEnviar.filter((p) => !yaRecibidas.has(huellaDeLaBurbuja(p)));
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
      // Sin opciones sigue de largo… salvo que elija de palabra («✍️ Si elige X»): entonces espera.
      if (botones.length + cuadritos.length === 0 && eligeDeLaFicha(f).length === 0) {
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
      // Y si ya PASÓ por el regalo (salió de él para pagar algo más: un upgrade, el upsell que pidió
      // después), tampoco: la ruta lo llevaría otra vez a la oferta del upsell y al regalo (HEA1, 27/10/2026).
      const regaloVisto = fichasVisitadas(convoId).find((id) => t.fichas.find((x) => x.id === id)?.tipo === "regalo");
      if (regaloVisto) {
        // …pero si su regalo quedó sin responder, se le ofrece otra vez, UNA sola (H2, 27/10/2026).
        if (regaloPorVolverAOfrecer(convoId)) {
          anotarMuestras(convoId, [REGALO_HECHO]);
          console.log(`[tablero] convo ${convoId}: entregado después del regalo, que quedó sin responder → se le vuelve a ofrecer`);
          await irA(convoId, t, regaloVisto, pasos);
          return;
        }
        console.log(`[tablero] convo ${convoId}: entregado después del regalo → la ruta no sigue`);
        return;
      }
      // LA OFERTA QUE YA SE LE HIZO NO SE REPITE (28/10/2026, ronda 2 en la copia: completó al PACK durante el
      // upsell y, tras la entrega, la ruta le volvió a ofrecer 100 CITAS). Como el automático, el upsell sale
      // una vez: si la ficha siguiente ya la vio, sigue hacia el regalo de esa ruta (si aún no lo vio).
      const siguienteFicha = t.fichas.find((x) => x.id === cableDeLaSalida(t, f.id, "siguiente")?.a);
      if (siguienteFicha && siguienteFicha.tipo !== "entregar" && siguienteFicha.tipo !== "regalo" && yaVisito(convoId, siguienteFicha.id)) {
        const regalo = alcanzables(t, [siguienteFicha.id])
          .map((id) => t.fichas.find((x) => x.id === id))
          .find((x) => x?.tipo === "regalo" && !yaVisito(convoId, x.id));
        if (regalo) {
          console.log(`[tablero] convo ${convoId}: «${siguienteFicha.titulo || siguienteFicha.id}» ya se le ofreció → sigue al regalo`);
          await irA(convoId, t, regalo.id, pasos);
        } else console.log(`[tablero] convo ${convoId}: «${siguienteFicha.titulo || siguienteFicha.id}» ya se le ofreció → la ruta no sigue`);
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
      if (f.cobro?.modo === "producto" && (f.cobro.diferencia || upgrade)) {
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
      // EL UPGRADE, CON LAS PALABRAS DE LA VENTA DE SIEMPRE (`sendOrderBumpComboUpgradeMessage`): cuánto le
      // falta para llevarse el completo. Después, los datos de su método (si ya lo tiene) o la pregunta.
      if (upgrade && principal && precio !== undefined) {
        const falta = formatCurrencyAmount(precio, pais as never);
        // Su texto del automático («Mensaje de upgrade» del order bump) si lo escribió; si no, el de fábrica.
        const suyo = config?.order_bump?.combo_upgrade_message?.trim();
        await sendConfiguredSteps(convo, [
          {
            type: "text",
            body: suyo
              ? suyo.replace(/\{\{\s*(monto_faltante|saldo_faltante|diferencia_pendiente)\s*\}\}/gi, falta)
              : `Sí, claro 😊 Puedes completar *${falta}* para llevarte *${nombre ?? "el completo"}*. Cuando envíes el comprobante de lo que falta, te lo dejo listo.`,
          },
        ] as never);
        // Como la venta de siempre, SOLO ese mensaje: ya tiene los datos de su método (HEA1, 27/10/2026:
        // repetir «¡Excelente! puedes adquirirlo…» con los datos sonaba a otra compra). Si los pide, el
        // cobro abierto se los manda; sin método todavía, se le pregunta.
        const yaElegido = metodoVigente(getConversationById(convoId) ?? convo) ?? elUnicoMetodo(convo.phone);
        // Un Cobro SIN «preguntar el método» (28/10/2026) lleva los datos en sus burbujas: salen ésas, con lo
        // que falta; no se le pregunta un método que esa ruta no pide.
        if (!f.cobro?.metodos) await sendConfiguredSteps(convo, pasosDelCobro as never, precio);
        else if (!yaElegido) await preguntarElMetodo(convo, [] as never, precio, nombre);
        console.log(`[tablero] convo ${convoId}: upgrade a «${nombre}» — falta ${precio}`);
        return;
      }
      if (f.cobro?.metodos) {
        // CON EL MÉTODO YA ELEGIDO NO SE VUELVE A PREGUNTAR: le llegan los datos de ése. Y CON UN SOLO
        // MÉTODO EN SU PAÍS (27/10/2026) tampoco: sus datos de frente. La contribución manda antes sus
        // burbujas (la lista de montos): sin ella no sabe cuánto aportar.
        const yaElegido = metodoVigente(getConversationById(convoId) ?? convo) ?? elUnicoMetodo(convo.phone);
        if (yaElegido && f.cobro.modo === "abierto") await sendConfiguredSteps(convo, pasosDelCobro as never, precio);
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

/**
 * LO QUE YA PAGÓ Y LO QUE LE FALTA, con el cobro abierto y un pago a medias (27/10/2026): pagó 1.50 de
 * 4 y, a su «ya te mandé», la IA contestaba «si ya pagaste, envíame la foto» — no sabía que faltaban
 * 2.50. Como la venta de siempre (pago PARCIAL), se le dice exacto cuánto falta.
 */
function loQueFalta(
  estado: EstadoEnElTablero | null,
  t: Tablero,
  pais: string
): { pagado: string; esperado: string; falta: string; numeros: { pagado: number; esperado: number; falta: number } } | null {
  if (!estado?.cobro_ficha_id || !(estado.cobro_pagado > 0)) return null;
  const f = t.fichas.find((x) => x.id === estado.cobro_ficha_id);
  if (!f?.cobro) return null;
  const esperado =
    f.cobro.modo === "abierto"
      ? f.cobro.minimo_por_pais?.[pais] ?? 0
      : preciosDelCobro(estado)[estado.cobro_elegido ?? f.cobro.producto_id ?? ""] ?? 0;
  const falta = Math.round((esperado - estado.cobro_pagado) * 100) / 100;
  if (!(esperado > 0) || falta <= 0.009) return null;
  const dinero = (v: number) => formatCurrencyAmount(v, pais as never);
  return {
    pagado: dinero(estado.cobro_pagado),
    esperado: dinero(esperado),
    falta: dinero(falta),
    numeros: { pagado: estado.cobro_pagado, esperado, falta },
  };
}

/** «Quiero pagar», «voy a pagar», «¿cómo pago?», «me lo llevo»… (ya sin tildes ni mayúsculas). */
const QUIERE_PAGAR =
  /\b(quiero (pagar|comprar|comprarlo|adquirir|adquirirlo|llevarlo)|voy a (pagar|comprar|yapear|depositar|transferir)|procedo|paso a pagar|como (pago|te pago|se paga|puedo pagar|compro|lo compro|lo adquiero)|donde (pago|te pago|deposito)|a que (cuenta|numero)|(pasame|dame|mandame|enviame) (la cuenta|los datos|el numero)|datos (de|para) (pago|pagar)|me lo llevo|(lo|si) quiero(?! (?!pagar|comprar|llevar|adquirir)[a-z]+(ar|er|ir)\b)|lo compro)\b/;
// («lo quiero VER / saber / pensar» no es comprar: después de «quiero» un verbo que no es de comprar —28/10/2026,
// ronda 14: «lo quiero ver» en el Order bump eligió el básico—.)

/** Un «sí» pelado: «sí», «dale», «ok», «claro», «de una», «sí quiero», «perfecto»… (sin tildes ni signos). */
// Un mensaje hecho SOLO de afirmaciones también lo es: «bueno ya», «ok dale», «ya bueno» (28/10/2026, ronda 14:
// «bueno ya» a «¿te muestro cómo adquirirlo?» se fue a la IA y no salieron los datos). Y con el relleno que se
// pega sin pensar detrás del sí: «si tambien», «ya pues», «dale nomas» (28/10/2026, su conversación 98).
const SI_SUELTO =
  "si+|sip|claro|dale|ok|okey|okay|oki|de una|va|vale|bueno|listo|por supuesto|perfecto|ya|aja|simon|me interesa|si me interesa|si quiero|si deseo|si por favor|claro que si|obvio";
const RELLENO = "por favor|porfa|gracias|tambien|pues|ps|nomas|no mas|entonces|amiga|amigo|hermano|seño";
const AFIRMA = new RegExp(`^(${SI_SUELTO})( (${RELLENO}|${SI_SUELTO}))*$`);

/** La pregunta del bot que invita a comprar («¿te indico cómo adquirirlo?», «¿te lo preparo?»…). */
const INVITA_A_COMPRAR =
  // («cuál de LOS dos» también: la IA lo escribe así y el «sí» se iba a ella, que inventaba la elección.)
  /(adquir|obten|tenerlo|tener tu|pasos|metodos? de pago|como pagar|proceder|asegur|tu acceso|avanz|llevarlo|llevartelo|comprarlo|te lo preparo|lo quieres|lo deseas|te animas|te indico|cual (de (las|los) (dos|opciones)|prefieres|eliges|te llama|quieres|te quedas|te gusta))/;

const sinTildes = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{Mn}/gu, "");


/** Palabras que no distinguen una opción de otra. */
const PALABRAS_COMUNES = new Set([
  "solo", "quiero", "el", "la", "los", "las", "de", "del", "con", "para", "por", "mas", "un", "una", "opcion", "si", "y",
  "como", "que", "pago", "pagar", "comprar", "compro", "eso", "esto", "ese", "este", "lo", "mi", "tu", "no",
]);

/**
 * «¿CUÁL ELIGES?» (27/10/2026), como la venta de siempre (`sendTwoOptionsReminder`): quiere pagar —o
 * nombra un método— sin haber elegido entre dos o más productos. Texto fijo, sin IA: las opciones de
 * esos Cobros con su precio del país del cliente. Si nombró un método, ya quedó anotado: al elegir le
 * llegan sus datos de frente.
 */
async function recordarLasOpciones(convo: ConversationRow, t: Tablero, cobros: FichaDelTablero[], metodo: string | null): Promise<void> {
  // UNA VEZ, NO EN BUCLE (B2 en la copia: diez «sí» seguidos recibieron diez veces el mismo texto). Si su
  // último mensaje del bot ya era este recordatorio, ahora contesta la IA, con sus palabras.
  const ultimoDelBot = [...ultimosMensajes(convo.id, 4)].reverse().find((m) => m.role !== "user")?.content ?? "";
  if (/¿Cuál eliges\?/.test(ultimoDelBot) && /^¡Perfecto/.test(ultimoDelBot)) {
    await contestarConIA(convo, t, "Ya se le mostraron las opciones con su precio y respondió sin decir cuál. Pregúntale con tus palabras cuál de las dos quiere (puede escribir su nombre o tocar su botón). No le mandes datos de pago.");
    return;
  }
  const config = loadWorkflowConfig();
  const pais = getEffectiveCountryCode(convo.phone, config);
  const estado = estadoEnElTablero(convo.id);
  const ids = [...new Set(cobros.map((c) => c.cobro?.producto_id).filter((x): x is string => !!x))];
  const opciones = ids
    .map((id) => {
      const p = producto(config, id);
      const precio = p ? precioDelProducto(p, pais, estado?.oferta === 1) : null;
      return p ? { nombre: p.name, precio } : null;
    })
    .filter((x): x is { nombre: string; precio: number | null } => !!x)
    .sort((a, b) => (a.precio ?? 0) - (b.precio ?? 0));
  const numeros = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣"];
  const texto =
    `${metodo ? `¡Perfecto, con *${nombreDelMetodo(convo.phone, metodo)}*! 😊` : "¡Perfecto! 😊"} ¿Cuál eliges?\n\n` +
    opciones.map((o, i) => `${numeros[i] ?? `${i + 1}.`} *${o.nombre}*${o.precio ? ` · *${formatCurrencyAmount(o.precio, pais as never)}*` : ""}`).join("\n");
  await sendConfiguredSteps(convo, [{ type: "text", body: texto }] as never);
  respondio(convo, t);
  console.log(`[tablero] convo ${convo.id}: quiere pagar sin elegir${metodo ? ` (con «${metodo}»)` : ""} → le recuerdo las ${opciones.length} opciones`);
}

/** El cliente de esta ficha recibe la IA, con lo que tiene pendiente y los montos permitidos. */
async function contestarConIA(convo: ConversationRow, t: Tablero, nota?: string): Promise<void> {
  const estado = estadoEnElTablero(convo.id);
  const config = loadWorkflowConfig();
  const pais = getEffectiveCountryCode(convo.phone, config);
  if (!nota) {
    const pendiente = loQueFalta(estado, t, pais);
    if (pendiente)
      nota = `Ya recibimos un pago de ${pendiente.pagado} de los ${pendiente.esperado}: le faltan ${pendiente.falta}. Contesta lo que escribió y, si habla del pago, recuérdale con amabilidad que faltan ${pendiente.falta} y que nos envíe el comprobante de lo que falta. No inventes otros montos.`;
  }
  if (!nota) {
    // EL ASESOR, A LA SEGUNDA QUEJA (27/10/2026), como la venta de siempre: si ya dijo DOS veces que algo
    // no le funciona y aún no se le ofreció, en esta respuesta se le ofrece (la IA a veces seguía
    // intentando sola y el cliente se cansaba).
    const recientes = ultimosMensajes(convo.id, 10);
    const quejas = recientes.filter(
      (m) => m.role === "user" && /\b(no (funciona|puedo|me deja|me llega|llega|abre|carga|sale)|error|falla|problema)\b/.test(sinTildes(m.content ?? ""))
    ).length;
    const yaOfrecido = recientes.some((m) => m.role !== "user" && /asesor/i.test(m.content ?? ""));
    if (quejas >= 2 && !yaOfrecido)
      nota =
        "El cliente ya te dijo DOS veces que tiene un problema que no se resuelve. Muéstrale empatía en una frase, dale una última sugerencia breve si la tienes, y termina con esta pregunta exacta: «¿Deseas que un asesor especializado se comunique contigo?». Si después dice que sí, usa notify_admin_emergency.";
  }
  // Una ficha que todavía ESPERA su tiempo (el upsell) no se ha presentado: la IA no habla de ella.
  const ficha = estado?.espera_ficha && estado.espera_ficha === estado.ficha_id ? undefined : t.fichas.find((x) => x.id === estado?.ficha_id);
  // EL REENVÍO SOLO SI HAY ALGO QUE REENVIAR Y NO HAY UNA INSTRUCCIÓN: con una nota («pregúntale si
  // fue un error…») la IA tiene un encargo concreto, y ofrecerle el reenvío lo desviaba (lo midió el
  // recorrido del 23/10: el cliente se quedó sin la pregunta).
  const puedeReenviar = !nota && entregasDelCliente(convo.id).length > 0;
  const { productos, montos: montosDeVenta } = loQueSabeLaIA(convo, estado, pais);
  // Con un pago a medias, lo pagado y lo que falta también son montos suyos (si no, el filtro de montos
  // ajenos los borraba de la respuesta: «nombró montos que no son suyos (1.5)»).
  const aMedias = loQueFalta(estado, t, pais);
  const montos = aMedias ? [...new Set([...montosDeVenta, aMedias.numeros.pagado, aMedias.numeros.falta, aMedias.numeros.esperado])] : montosDeVenta;
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
  // SIN «PRESENTA ESTOS PRODUCTOS» MARCADO (28/10/2026, ronda 2: su oferta «¿completar al PACK por S/5?» no lo
  // tenía, y a «y esto» la IA le habló de sus carpetas de Drive): lo que cobran los Cobros a los que llevan
  // sus botones o cuadritos es lo que se le está ofreciendo.
  if (ofrece.filter(Boolean).length === 0 && ficha && (ficha.tipo === "mensaje" || ficha.tipo === "intro_ob"))
    ofrece.push(...opcionesDeCompraEn(t, [ficha], config, pais, estado?.oferta === 1).map((o) => o.nombre));
  const ofreciendoAhora = ofrece.filter(Boolean).join(" o ");
  // «QUIERO COMPLETAR PARA EL OTRO», en cualquier momento: si ya compró uno y en la ruta hay un cobro
  // con upgrade que lo incluye y cobra otro que aún no tiene. Sin un cobro abierto (no se cruzan).
  const comprados = new Set(comprasDelCliente(convo.id).map((c) => c.producto_id).filter(Boolean));
  // (28/10/2026, su conversación 98: «puedo completar para el otro» con el cobro de las 100 CITAS abierto
  // —le habían llegado sus datos— no ofrecía el upgrade y la IA dijo «el pack se paga aparte, $4». Con un
  // cobro abierto SIN NADA PAGADO también se puede completar; `completar.ir` pregunta «¿a cuál te
  // refieres?» si tiene otro delante, como el automático.)
  const upgrade = (!estado?.cobro_ficha_id || (estado.cobro_pagado ?? 0) <= 0) && !nota
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
      ) ??
      // EL UPGRADE AUTOMÁTICO (27/10/2026): también sin ficha de «diferencia», un cobro de su ruta que
      // acepta lo que ya compró (`loQuePuedeComprar`), como la venta de siempre.
      loQuePuedeComprar(convo, t, pais).find((o) => o.upgrade)?.ficha
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
  // UNA SOLA VEZ EN TODA LA CONVERSACIÓN, y solo si pregunta qué trae (H1/H2/H4, 27/10/2026): salía en
  // cada ficha y también al comparar («¿cuál es la diferencia?») o al preguntar el precio, y alargaba la
  // venta. Las imágenes no son prioridad: se ofrecen a la primera duda sobre el contenido y no más.
  const comparaOPrecio =
    /\b(diferencia|diferente|son 2|son dos|cual (me )?conviene|cual es mejor|compar|precio|cuesta|vale|costo|cuanto)\b/.test(ultimo);
  // LA GALERÍA, DIRECTO Y UNA SOLA VEZ (28/10/2026, él lo pidió): a la primera vez que quiere conocer el
  // contenido POR DENTRO («qué contiene», «qué trae», «qué incluye», «cómo es por dentro»), las fotos salen
  // de frente —sin texto antes ni «¿deseas ver unas imágenes?»: era información doble— y al final SOLO la
  // pregunta de cierre. «Y esto qué es» o «qué es» no: ahí se explica con texto. Nunca más de una vez
  // en la conversación (después, solo texto); solo de lo ya presentado (el oculto del order bump, no).
  const quiereVerPorDentro =
    /\b(que|q|ke)\s+(contiene|contienen|trae|traen|incluye|incluyen|viene|vienen|lleva|llevan)\b|\bcontenido\b|\bpor dentro\b|\bque hay (adentro|dentro)\b/.test(ultimo);
  const mostrarLaGaleria =
    !nota &&
    muestras.length > 0 &&
    quiereVerPorDentro &&
    !comparaOPrecio &&
    !hablaDeUnProblema &&
    // Ya compró: tiene el material, no se le mandan fotos (salía en «¿hasta cuándo tengo acceso?»).
    !yaCompro &&
    !muestrasEnviadas(estado).some((m) => m === GALERIA_HECHA || m.startsWith("oferta:"));
  if (mostrarLaGaleria && (await mandarLaGaleria(convo, t, pais))) return;
  // LAS OPCIONES DE COMPRA DONDE ESTÁ (27/10/2026), como la venta de siempre: con dos o más, la IA las
  // nombra todas y cierra con «¿Cuál de las dos prefieres?»; y si preguntó por los productos, al final
  // va la burbuja corta con las opciones (`getOrderBumpChoiceHelperBubbles`).
  const segDeAqui = estado?.seg_ficha && estado.seg_ficha !== estado.ficha_id ? t.fichas.find((x) => x.id === estado.seg_ficha) : undefined;
  const opcionesAqui = etapa === "venta" && !estado?.cobro_ficha_id ? opcionesDeCompraEn(t, [ficha, segDeAqui], config, pais, estado?.oferta === 1) : [];
  // PREGUNTA VAGA CON LAS OPCIONES DELANTE (28/10/2026, su HHH1: «y esto qué es» tras la oferta del order
  // bump → la IA habló solo del pack). No nombra ninguna opción y pregunta qué es / no entiende: se le
  // explica que hay N opciones, las dos con su nombre y qué trae cada una, como el automático.
  const palabrasDeLasOpciones = new Set(
    opcionesAqui.flatMap((o) => sinTildes(o.nombre).replace(/[^a-z0-9ñ\s]/g, " ").split(/\s+/).filter((w) => w.length >= 4 && !PALABRAS_COMUNES.has(w)))
  );
  const nombraUnaOpcion = ultimo.split(/[^a-z0-9ñ]+/).some((w) => palabrasDeLasOpciones.has(w));
  const preguntaVaga =
    !nota &&
    opcionesAqui.length > 1 &&
    !hablaDeUnProblema &&
    !nombraUnaOpcion &&
    !preguntaCuantasOpcionesHay(ultimo) &&
    ultimo.split(/\s+/).filter(Boolean).length <= 7 &&
    /\b(esto|eso|no entiendo|no entendi|no le entiendo|como asi|que es|q es|ke es|que significa|explicame|no comprendo)\b/.test(ultimo);
  // ESTÁ COMPARANDO LAS OPCIONES (27/10/2026): «son 2» (la misma detección de la venta de siempre,
  // `preguntaCuantasOpcionesHay`) o «la diferencia» / «cuál me conviene». En esa respuesta, una frase de
  // por qué conviene la más completa.
  const recomendarLaCompleta =
    !nota &&
    opcionesAqui.length > 1 &&
    !hablaDeUnProblema &&
    (preguntaCuantasOpcionesHay(ultimo) || /\b(diferencia|diferente|diferentes|cual me conviene|cual es mejor|me recomiendas|recomiendas)\b/.test(ultimo));
  const metodosDelPais = getPaymentMethods(convo.phone).map((m) => m.label).filter(Boolean);
  // LOS OTROS PAÍSES DONDE VENDE ESTA TIENDA (28/10/2026, su regla: «si alguien está en ese país sí puede pagarlo,
  // pero si no está activo decirle que no está disponible»). Los de un Inicio que vende, con sus métodos.
  const otrosPaises = [
    ...new Set(t.fichas.filter((f) => f.tipo === "inicio" && f.pais && f.pais !== pais).map((f) => f.pais as string)),
  ]
    .filter((p) => elTableroAtiende(t, p))
    .map((p) => {
      const ms = getPaymentMethodsOfCountry(p as never).map((m) => m.label).filter(Boolean);
      return ms.length ? `${getCountryInfo(p as never)?.label ?? p} (${ms.join(", ")})` : "";
    })
    .filter(Boolean);
  // EL CANDADO DE LA ELECCIÓN (27/10/2026): con un cobro abierto, la IA sabe qué eligió y a qué precio.
  const elegidoAhora = cobro?.cobro?.modo === "producto" && estado ? estado.cobro_elegido ?? cobro.cobro.producto_id ?? null : null;
  const precioElegido = elegidoAhora && estado ? preciosDelCobro(estado)[elegidoAhora] : undefined;
  const eligio = elegidoAhora
    ? `${nombreDe(elegidoAhora) ?? elegidoAhora}${precioElegido !== undefined ? ` (${formatCurrencyAmount(precioElegido, pais as never)})` : ""}`
    : undefined;
  await responderConIA(convo, {
    ...(eligio ? { eligio } : {}),
    ...(estado?.oferta === 1 ? { enOferta: true } : {}),
    // Con un cobro abierto (nada aprobado todavía) o un comprobante que no se contó, no se promete entrega.
    ...(estado?.cobro_ficha_id || /(no alcanza|le faltan|no pude validar|no se ve como un comprobante|a nombre de|ya se usó|ya lo había enviado|un asesor lo revisa)/i.test(nota ?? "")
      ? { sinPagoAprobado: true }
      : {}),
    ...(opcionesAqui.length > 1 ? { opcionesDeCompra: opcionesAqui.map((o) => `${o.nombre}${o.precio ? ` (${o.precio})` : ""}`) } : {}),
    ...(metodosDelPais.length ? { metodos: metodosDelPais, paisDelCliente: getCountryInfo(pais as never)?.label ?? pais, otrosPaises } : {}),
    cerebroGeneral: t.cerebro,
    instrucciones: ficha?.instrucciones,
    ...(ofreciendoAhora ? { ofreciendoAhora } : {}),
    ...(upgrade
      ? {
          completar: {
            para: nombreDe(upgrade.cobro?.producto_id) ?? "el otro",
            ir: async () => {
              // «¿PUEDO COMPLETAR?» CON OTRO PRODUCTO DELANTE (28/10/2026, su hay1): si lo PREGUNTA y tiene
              // delante el upsell (ofrecido o su cobro abierto), «¿a cuál te refieres?» con los dos —el que se
              // completa y el que va aparte—, como el automático. «Quiero completar» va directo, como antes.
              // Su BLOQUE entero (lo que escribió seguido desde la última respuesta del bot): en su hay1 mandó
              // «quiero completar el otro» y «ya pagué 3» juntos, y el último solo no dice «completar».
              const recientes = ultimosMensajes(convo.id, 8);
              const desdeElBot = recientes.map((m) => m.role !== "user").lastIndexOf(true);
              const delMensaje = recientes
                .slice(desdeElBot + 1)
                .filter((m) => m.role === "user")
                .map((m) => m.content ?? "")
                .join("\n");
              if (preguntaSiPuede(delMensaje)) {
                const opciones = loQuePuedeComprar(convo, t, pais);
                const ups = opciones.filter((o) => o.upgrade);
                const aparte = opciones.filter(
                  (o) => !o.upgrade && (o.ficha.id === estado?.cobro_ficha_id || (!!ofreciendoAhora && ofreciendoAhora.includes(o.nombre)))
                );
                if (ups.length > 0 && aparte.length > 0) {
                  await preguntarACual(convo, [...ups, ...aparte], pais);
                  return;
                }
              }
              // Si estaba en el regalo, sale de él (se cancela lo que el regalo tenía programado): su
              // cobro manda ahora. Al pagar, su ruta lo vuelve a llevar a la entrega y al regalo.
              const fresca = getConversationById(convo.id) ?? convo;
              // (Solo con el regalo aún sin respuesta: con el regalo aceptado, sigue en él — ver abrirLoQuePuedeComprar.)
              if (fresca.state === "awaiting_gift_consent") {
                anotarRegaloSinResponder(convo.id, fresca.state);
                cancelPendingActionsForConvo(convo.id);
                setConversationState(convo.id, "tablero");
              }
              await irA(convo.id, t, upgrade.id, 0, { upgrade: !upgrade.cobro?.diferencia });
            },
          },
        }
      : {}),
    ...(!nota && entregasDelCliente(convo.id).length > 0
      ? { pedirCorreo: () => quiereSuCorreo(convo, t, ultimosMensajes(convo.id, 4).filter((m) => m.role === "user").pop()?.content ?? "") }
      : {}),
    preguntaPendiente: ficha && ficha.tipo !== "cobro" && etapa === "venta" ? textoDeLaUltimaBurbuja(pasosVistos(ficha, estado)) : undefined,
    // LA DIFERENCIA ENTRE DOS PRECIOS TAMBIÉN ES SUYA (27/10/2026, su prueba H3): «el pack por $1 más»,
    // «completas con $1». El filtro la borraba y pedía otra respuesta (salía apretada y pagada dos veces).
    montosPermitidos: (() => {
      const base = [...new Set([...(estado ? montosDelCobro(t, estado, pais) : []), ...montos])];
      const difs = base.flatMap((a) => base.filter((b) => a > b).map((b) => Math.round((a - b) * 100) / 100));
      return [...new Set([...base, ...difs])];
    })(),
    moneda: getCountryInfo(pais).currency,
    nota,
    productos,
    dialecto: getCountryInfo(pais).dialect,
    ...(puedeReenviar
      ? {
          reenviar: async () => {
            reenviarLoDelTablero(convo, ultimo, true);
          },
        }
      : {}),
    // COBRO ABIERTO ESPERANDO EL MÉTODO (H3, 27/10/2026): si la IA promete «te llegan los datos» sin que
    // haya método, el bot muestra la lista de métodos, como el <<METODOS_PAGO>> de la venta de siempre.
    ...(cobro?.cobro?.metodos && !metodo && !nota
      ? {
          sinMetodo: async () => {
            await preguntarElMetodo(convo, [] as never, precioElegido, elegidoAhora ? nombreDe(elegidoAhora) ?? undefined : undefined);
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
              // CON SU PRECIO (28/10/2026): un Cobro de producto sin «preguntar el método» lleva los datos en sus
              // burbujas ({{METODO_DE_PAGO_1}} con su «Monto»), y sin el precio ese monto salía con otro.
              await sendConfiguredSteps(convo, pasos as never, precioElegido);
            },
          }
        : {}),
    // LA ETAPA, para que cierre como la venta de siempre (punto 6) y la postventa (punto 11).
    etapa,
    ...(etapa === "postventa" && postventa ? { postventa } : {}),
    // (La galería ya no se ofrece con una pregunta: sale directo, arriba, `mostrarLaGaleria`. Y sin la
    // lista fija «1️⃣… 2️⃣…» debajo: el automático no la manda —su ayuda está apagada en tu configuración—
    // y la regla de las opciones ya le pide a la IA nombrarlas.)
    ...(recomendarLaCompleta ? { recomendarLaCompleta: true, cuantasOpciones: opcionesAqui.length } : {}),
    ...(preguntaVaga ? { preguntaVaga: true } : {}),
    // El seguro de «son 2» y de la pregunta vaga: los nombres de todas, la más completa (la más cara) primero.
    ...(!nota && opcionesAqui.length > 1 && (preguntaVaga || preguntaCuantasOpcionesHay(ultimo))
      ? { confirmarOpciones: [...opcionesAqui].sort((a, b) => b.valor - a.valor).map((o) => o.nombre) }
      : {}),
    // EL REGALO QUE SIGUE PENDIENTE (salió de él para pagar otra cosa): la IA sabe qué es y no lo niega.
    ...(regaloPorVolverAOfrecer(convo.id) || fresca.state === "awaiting_gift_consent" ? { regaloPendiente: textoDelRegalo(config) } : {}),
    // EL REGALO EN CURSO (28/10/2026, ronda 3: a «cómo es eso» en el regalo la IA dijo «te ofrecí algo que no
    // está disponible, olvídate»). Ofrecido o ya aceptado, la IA sabe qué es y nunca lo niega.
    ...(fresca.state === "awaiting_facebook_comment" ? { regaloAceptado: textoDelRegalo(config) } : {}),
    // LO QUE YA COMPRÓ: su «lo que pagué» habla de eso (UULA2, 28/10/2026). Siempre que haya comprado, no solo con un
    // cobro nuevo abierto (ronda 10: tras su entrega dijo «sí, el de 2» y la IA le dijo «tu pago aún no se procesó»).
    ...(comprasDelCliente(convo.id).some((c) => c.producto_id)
      ? {
          comprasPrevias: comprasDelCliente(convo.id)
            .filter((c) => c.producto_id)
            .map((c) => `${nombreDe(c.producto_id) ?? c.producto_id} (${formatCurrencyAmount(c.monto, pais as never)})`)
            .join(", "),
        }
      : {}),
  });
}

/** Lo que dice la oferta del regalo (su primera versión, sin spintax), para que la IA sepa qué es. */
function textoDelRegalo(config: WorkflowConfig | null): string {
  const pasos = (config?.gift_mechanic?.consent_sequence ?? []).filter((p) => p.enabled !== false);
  const textos = pasos.map((p) => {
    const x = p as { body?: string; body_variants?: string[]; caption?: string; caption_variants?: string[] };
    return (x.caption_variants?.find((v) => v?.trim()) ?? x.caption ?? x.body_variants?.find((v) => v?.trim()) ?? x.body ?? "").trim();
  });
  const todo = textos
    .filter(Boolean)
    .join(" ")
    .replace(/\{([^{}|]*)\|[^{}]*\}/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return todo.slice(0, 400) || "un regalito adicional gratis";
}

/**
 * LAS OPCIONES DE COMPRA DE UNA ESTACIÓN: los Cobros a los que llevan sus botones, cuadritos y «✍️ Si
 * elige» (de la ficha donde está y de sus seguimientos), con el nombre y el precio de su producto.
 */
function opcionesDeCompraEn(
  t: Tablero,
  fichas: Array<FichaDelTablero | undefined>,
  config: WorkflowConfig | null,
  pais: string,
  deOferta: boolean
): Array<{ nombre: string; precio: string | null; valor: number }> {
  const vistos = new Set<string>();
  const fuera: Array<{ nombre: string; precio: string | null; valor: number }> = [];
  for (const f of fichas) {
    if (!f) continue;
    const { botones, cuadritos } = opcionesDe(pasosDeLaFicha(f));
    const salidas = [...botones.map((b) => `btn:${b.id}`), ...cuadritos.map((d) => `dec:${d.id}`), ...eligeDeLaFicha(f).map((id) => `elige:${id}`)];
    for (const s of salidas) {
      const d = t.fichas.find((x) => x.id === cableDeLaSalida(t, f.id, s)?.a);
      const id = d?.tipo === "cobro" ? d.cobro?.producto_id : undefined;
      if (!id || vistos.has(id)) continue;
      vistos.add(id);
      const p = producto(config, id);
      if (!p) continue;
      const v = precioDelProducto(p, pais, deOferta);
      fuera.push({ nombre: p.name ?? id, precio: v ? formatCurrencyAmount(v, pais as never) : null, valor: v ?? 0 });
    }
  }
  return fuera.sort((a, b) => a.valor - b.valor);
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
 * TU CIERRE DE LAS MUESTRAS («¿Deseas que te indique cómo adquirirlo?…»), el de la venta de siempre. Esa
 * lo lee de la modalidad activa; en el simulador la activa es la de la prueba y puede estar vacía (H1/H2,
 * 27/10/2026: la galería salía sin cierre). El tablero usa el primero que tengas escrito, como hace
 * con tus textos de postventa.
 */
function cierreDeLaGaleria(cuantas: number, deOrderBump: boolean): SequenceStep[] {
  // Que se pueda ENVIAR (la regla de `sendSamplesAfterContent`): tu cierre está guardado como «texts» y
  // el envío lee «body_variants»; `burbujasDeLaFicha` lo traduce, como en tus fichas de producto.
  const enviable = (s: unknown): SequenceStep[] => {
    const pasos = burbujasDeLaFicha(Array.isArray(s) ? (s as SequenceStep[]) : []);
    return pasos.some(
      (p) => p.enabled !== false && (p.type === "text" ? !!(p.body?.trim() || p.body_variants?.some((v) => v.trim())) : !!p.drive_url?.trim())
    )
      ? pasos
      : [];
  };
  const config = loadWorkflowConfig();
  const porModalidad = (config?.modality_templates ?? {}) as Record<string, { samples_after_sequence?: unknown[] } | undefined>;
  // SEGÚN CUÁNTOS PRODUCTOS HAY DELANTE (28/10/2026, él lo pidió): con dos o más, la pregunta es elegir
  // («¿cuál eliges?»): tu cierre de order bump en esa tubería, el de doble oferta en la otra. Con uno,
  // llevarlo («¿te animas?»): tu cierre de lineal. Un cierre de un producto NO sirve para dos (y al revés),
  // así que no se cruzan: si el tuyo está vacío, sale el de respaldo del caso.
  const modos =
    cuantas >= 2
      ? deOrderBump
        ? ["order_bump", "doble_oferta_upsell", "doble_oferta_dos", "bioferta"]
        : ["doble_oferta_upsell", "doble_oferta_dos", "order_bump", "bioferta"]
      : ["lineal"];
  for (const modo of modos) {
    const s = enviable(porModalidad[modo]?.samples_after_sequence);
    if (s.length) return s;
  }
  if (cuantas < 2) {
    const general = enviable((config as { samples_after_sequence?: unknown[] } | null)?.samples_after_sequence);
    if (general.length) return general;
  }
  return [
    {
      type: "text",
      body_variants:
        cuantas >= 2
          ? ["¿Cuál eliges? 😊", "¿Por cuál te animas? 😊", "¿Cuál de las dos te gusta más? 😊"]
          : ["¿Te animas a llevarlo? 😊", "¿Te gustaría llevártelo hoy? 😊", "¿Lo quieres para empezar hoy mismo? 😊"],
    } as SequenceStep,
  ];
}

/**
 * CUÁNTOS PRODUCTOS TIENE DELANTE Y SI ES LA TUBERÍA DE ORDER BUMP, para el cierre de la galería: con un
 * cobro abierto ya eligió (uno); si no, los que puede elegir donde está (la ficha y sus seguimientos).
 */
function delanteParaElCierre(convo: ConversationRow, t: Tablero, pais: string): { cuantas: number; deOrderBump: boolean } {
  const estado = estadoEnElTablero(convo.id);
  const ficha = estado ? t.fichas.find((x) => x.id === estado.ficha_id) : undefined;
  const seg = estado?.seg_ficha && estado.seg_ficha !== estado.ficha_id ? t.fichas.find((x) => x.id === estado.seg_ficha) : undefined;
  const cuantas = !estado || estado.cobro_ficha_id ? 1 : opcionesDeCompraEn(t, [ficha, seg], loadWorkflowConfig(), pais, estado.oferta === 1).length;
  const deOrderBump = ficha?.tipo === "intro_ob" || t.fichas.some((f) => f.tipo === "intro_ob" && yaVisito(convo.id, f.id));
  return { cuantas, deOrderBump };
}

/**
 * MANDA LA GALERÍA (25/10/2026, punto 7), como la venta de siempre: TODAS las muestras que le quedan
 * por ver de lo ya presentado, en orden, una sola vez, y al final tu burbuja de cierre de las muestras
 * (la misma de la venta de siempre, `getSamplesAfterSequence`). Un solo camino: ya no manda una suelta.
 * Sin muestras por ver (o con «📷 Ofrecer imágenes» apagado), false y no manda nada.
 */
async function mandarLaGaleria(convo: ConversationRow, t: Tablero, pais: string): Promise<boolean> {
  const muestras = muestrasDisponibles(estadoEnElTablero(convo.id));
  if (muestras.length === 0) return false;
  // Antes de mandar: cuántos productos tiene delante AHORA (para el cierre).
  const delante = delanteParaElCierre(convo, t, pais);
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
  // GALERIA_HECHA: la galería sale UNA vez en toda la conversación (28/10/2026, él lo pidió).
  anotarMuestras(convo.id, [...salieron, GALERIA_HECHA]);
  // Y después de las fotos, SOLO la pregunta de cierre: nada más en esa fila.
  await sendConfiguredSteps(convo, cierreDeLaGaleria(delante.cuantas, delante.deOrderBump) as never);
  console.log(`[tablero] convo ${convo.id}: galería enviada (${salieron.join(", ")}) · cierre de ${delante.cuantas >= 2 ? "elegir" : "un producto"}`);
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
      // CON TEXTO FIJO (28/10/2026, ronda 3 en la copia: con esta nota la IA contestó «¿me compartes la foto de
      // tu comprobante?», sin decirle por qué no valía). Como el pago de menos y el «¿fue una confusión?».
      if (lectura.titular)
        await sendConfiguredSteps(convo, [
          {
            type: "text",
            body: `Recibí tu comprobante 🙏, pero está a nombre de *${lectura.titular}*.\n\nPara validarlo debe estar a nombre de *${esperado}*. ¿Me envías el comprobante correcto, por favor? 😊`,
          },
        ] as never);
      else await contestarConIA(convo, t, SIN_PISTAS);
      return;
    }
  }
  // EN EL SIMULADOR, REPETIDO SOLO DENTRO DE LA MISMA VENTANA (27/10/2026, su pedido): él prueba en
  // paralelo con los mismos comprobantes; en ventanas distintas valen, en la misma no. En vivo, el mismo
  // pago no vale dos veces en ningún chat (más estricto que la venta de siempre, que mira solo su chat).
  const huellaDelPagoLeido = huellaDelPago(lectura);
  const huella = huellaDelPagoLeido && convo.channel === "test" ? `${huellaDelPagoLeido}#c${convo.id}` : huellaDelPagoLeido;
  if (huella && !apuntarHuella(huella, convo.id)) {
    const deOtroChat = quienRegistroLaHuella(huella) !== convo.id;
    console.log(`[tablero] convo ${convo.id}: comprobante repetido (${huella})${deOtroChat ? " — lo usó otra conversación" : ""}`);
    if (deOtroChat) {
      if (convo.channel !== "test")
        void notifyAdmin(
        `🧾 *Tablero:* ${convo.client_name ?? convo.name ?? convo.phone} mandó un comprobante que ya se usó en otra compra (${huellaDelPagoLeido}). Revísalo en el chat.`
      ).catch(() => {});
    }
    // CON TEXTO FIJO, como la venta de siempre («Este comprobante ya fue aprobado…»): con la IA salía
    // «Gracias por escribir, no entendí bien tu mensaje» (HEA4, 27/10/2026).
    await sendConfiguredSteps(convo, [
      {
        type: "text",
        body: deOtroChat
          ? "Este comprobante ya fue usado en otra compra 😊 Si hiciste un pago nuevo, envíame la foto de *ese* comprobante, por favor."
          : "Este comprobante ya fue usado y está registrado ✅ Si hiciste un pago nuevo, envíame la foto de *ese* comprobante, por favor 😊",
      },
    ] as never);
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
      // PAGÓ EL PRECIO DEL MÁS CARO (28/10/2026, su MM4: eligió COMIDA a $2, pagó $3 y le llegó el PACK sin
      // saber por qué): una línea antes de la entrega para que lo entienda. La regla no cambia.
      if (mejor !== elegidoId) {
        const nombreMejor = producto(config, mejor)?.name ?? "la opción completa";
        await sendConfiguredSteps(convo, [
          { type: "text", body: `Como tu pago fue de *${formatCurrencyAmount(total, pais as never)}*, te dejo *${nombreMejor}* 😊` },
        ] as never);
        console.log(`[tablero] convo ${convo.id}: pagó el precio de «${nombreMejor}» (eligió otro) → se lo digo antes de entregar`);
      }
    } else if (alcanza && alcanza[0] !== elegidoId) {
      proponerProducto(convo.id, alcanza[0]);
      const nombre = producto(config, alcanza[0])?.name ?? "el otro producto";
      console.log(`[tablero] convo ${convo.id}: pagó ${total}, no alcanza para el elegido pero sí para «${nombre}» → le pregunto`);
      // CON TEXTO FIJO, como la venta de siempre (su `customer_message`): con la IA, la regla de «sin pago
      // aprobado no hables del comprobante» le hacía pedir la foto que acababa de llegar (HEA1, 27/10/2026).
      // Ya pagó algo: sus seguimientos («¿pudiste revisar lo del PACK? sigue a $4») se callan; ahora se
      // espera su respuesta a esta pregunta, como el «¿confusión o te quedas?» de la venta de siempre.
      ponerSeguimiento(convo.id, null, 0);
      const plata = (v: number) => formatCurrencyAmount(v, pais as never);
      const elegidoNombre = producto(config, elegidoId)?.name ?? "la opción que elegiste";
      await sendConfiguredSteps(convo, [
        {
          type: "text",
          // Con aire, en renglones (H2, 27/10/2026: en un solo párrafo se veía apretado).
          body: `Recibí tu pago de *${plata(total)}* 😊\n\nElegiste *${elegidoNombre}* por *${plata(principal)}*.\n\n¿Fue una confusión y vas a completar *${plata(Math.round((principal - total) * 100) / 100)}*?\n¿O prefieres quedarte con *${nombre}* por *${plata(alcanza[1])}*?`,
        },
      ] as never);
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
    if (!(await seguirPor(convo.id, t, f.id, "menos", 0))) {
      // CON TEXTO FIJO (27/10/2026, K2 en la copia): con la nota «le faltan S/1» la IA pidió la foto que
      // acababa de llegar. Los montos los pone el bot, exactos; como el «¿fue una confusión?».
      const pendiente = loQueFalta(estadoEnElTablero(convo.id), t, pais);
      const recibido = formatCurrencyAmount(lectura.monto, pais as never);
      await sendConfiguredSteps(convo, [
        {
          type: "text",
          body: pendiente
            ? `Recibí tu pago de *${recibido}* 🙏\n\nEn total llevas *${pendiente.pagado}* de *${pendiente.esperado}*: te falta *${pendiente.falta}*.\n\nCuando lo envíes, mándame la foto del comprobante por aquí 😊`
            : `Recibí tu pago de *${recibido}* 🙏, pero no alcanza el monto. Cuando completes, mándame la foto del comprobante por aquí 😊`,
        },
      ] as never);
    }
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
function cobroQueEncajaConElPago(
  t: Tablero,
  desde: string[],
  monto: number,
  pais: string,
  /** Productos que no cuentan (ya comprados). */
  excluir: Set<string> = new Set()
): FichaDelTablero | null {
  const config = loadWorkflowConfig();
  const casi = (a: number, b: number) => Math.abs(a - b) < 0.01;
  for (const id of alcanzables(t, desde)) {
    const f = t.fichas.find((x) => x.id === id);
    if (f?.tipo !== "cobro" || f.apagada || f.cobro?.modo !== "producto") continue;
    for (const pid of [f.cobro.producto_id, ...(f.cobro.acepta ?? [])]) {
      if (!pid || excluir.has(pid)) continue;
      const p = producto(config, pid);
      const normal = precioDelProducto(p, pais, false);
      const oferta = precioDelProducto(p, pais, true);
      if ((normal !== null && casi(normal, monto)) || (oferta !== null && casi(oferta, monto))) return f;
    }
  }
  return null;
}

/**
 * LO QUE TODAVÍA PUEDE COMPRAR, después de haber comprado algo (27/10/2026, sus pruebas H2/H3): los
 * cobros de su ruta (desde las fichas por las que pasó, la más reciente primero) de productos que aún
 * no tiene. Un cobro que ACEPTA lo que ya compró (o que es de «diferencia») es un UPGRADE: se cobra lo
 * que falta, como la venta de siempre. Los demás (el upsell) se pagan enteros.
 */
type LoQuePuedeComprar = { ficha: FichaDelTablero; productoId: string; nombre: string; precio: number; upgrade: boolean };
function loQuePuedeComprar(convo: ConversationRow, t: Tablero, pais: string): LoQuePuedeComprar[] {
  const config = loadWorkflowConfig();
  const compras = comprasDelCliente(convo.id);
  const comprados = new Set<string>([
    ...compras.map((c) => c.producto_id ?? ""),
    ...entregasDelCliente(convo.id).map((k) => k.split("#")[0]),
  ].filter(Boolean));
  if (comprados.size === 0) return [];
  const visitadas = fichasVisitadas(convo.id).filter((id) => t.fichas.find((x) => x.id === id)?.tipo !== "regalo");
  const fuera: LoQuePuedeComprar[] = [];
  const vistos = new Set<string>();
  const estado = estadoEnElTablero(convo.id);
  // SOLO LO QUE YA SE LE MOSTRÓ (HEA1, 27/10/2026): más adelante en la ruta había un Upsell 2 que el
  // cliente nunca vio (TINTAS PEPITO) y salía en «¿a cuál te refieres?». Lo no mostrado sigue oculto.
  const mostrados = new Set(presentadosDe(estado));
  // LO QUE YA ESTÁ DENTRO DE LO QUE COMPRÓ (T1 en la copia, 27/10/2026): compró el PACK y la GUÍA básica
  // seguía «por comprar» — dos productos de $3 y el «sí» al upsell no sabía a cuál iba. Si el cobro de algo
  // comprado ACEPTA otro producto más barato o igual (su alternativa en la misma elección), ése no se ofrece.
  const yaIncluidos = new Set<string>();
  for (const f of t.fichas) {
    if (f.tipo !== "cobro" || f.cobro?.modo !== "producto" || !f.cobro.producto_id || !comprados.has(f.cobro.producto_id)) continue;
    const suyo = precioDelProducto(producto(config, f.cobro.producto_id), pais, estado?.oferta === 1) ?? 0;
    for (const otro of f.cobro.acepta ?? []) {
      const suPrecio = precioDelProducto(producto(config, otro), pais, estado?.oferta === 1);
      if (suPrecio !== null && suPrecio <= suyo) yaIncluidos.add(otro);
    }
  }
  for (const desde of visitadas)
    for (const id of alcanzables(t, [desde])) {
      const f = t.fichas.find((x) => x.id === id);
      if (f?.tipo !== "cobro" || f.apagada || f.guardada || f.cobro?.modo !== "producto") continue;
      const pid = f.cobro.producto_id;
      if (!pid || comprados.has(pid) || vistos.has(pid) || yaIncluidos.has(pid)) continue;
      if (!mostrados.has(pid) && !visitadas.includes(f.id)) continue;
      const p = producto(config, pid);
      const lleno = precioDelProducto(p, pais, estado?.oferta === 1);
      if (!p || lleno === null) continue;
      const deLoComprado = (f.cobro.acepta ?? []).filter((x) => comprados.has(x));
      const upgrade = deLoComprado.length > 0 || !!f.cobro.diferencia;
      const pagado = upgrade
        ? Math.max(0, ...compras.filter((c) => c.producto_id && (deLoComprado.includes(c.producto_id) || f.cobro!.diferencia)).map((c) => c.monto))
        : 0;
      const precio = Math.round((lleno - pagado) * 100) / 100;
      if (precio <= 0) continue;
      vistos.add(pid);
      fuera.push({ ficha: f, productoId: pid, nombre: p.name ?? pid, precio, upgrade: upgrade && pagado > 0 });
    }
  return fuera;
}

/**
 * EL REGALO QUE QUEDÓ SIN RESPONDER (H2, 27/10/2026). Si sale del regalo para comprar algo más (un
 * upgrade, el upsell) con la pregunta del regalo aún sin contestar, se anota; al entregarle lo nuevo se
 * le vuelve a ofrecer UNA vez, como la venta de siempre («si el cliente no responde es su problema»).
 */
const REGALO_PENDIENTE = "regalo:pendiente";
const REGALO_HECHO = "regalo:hecho";
/** La galería ya salió en esta conversación: no vuelve a salir sola (28/10/2026). */
const GALERIA_HECHA = "galeria:hecha";
function anotarRegaloSinResponder(conversationId: number, state: string | null | undefined): void {
  if (state === "awaiting_gift_consent") anotarMuestras(conversationId, [REGALO_PENDIENTE]);
}
function regaloPorVolverAOfrecer(conversationId: number): boolean {
  const m = muestrasEnviadas(estadoEnElTablero(conversationId));
  return m.includes(REGALO_PENDIENTE) && !m.includes(REGALO_HECHO);
}

/**
 * EL RECORDATORIO DEL REGALO, UNA SOLA VEZ (29/10/2026, su conversación 117): se le ofreció el regalo, se
 * quejó de que no le llegó lo que pagó, se le reenvió y el regalo quedó enterrado arriba. Con la pregunta del
 * regalo sin contestar, se le vuelve a hacer tras el silencio de siempre. Solo una vez («para no embotarlo»).
 */
const REGALO_RECORDADO = "regalo:recordado";
function recordarElRegaloUnaVez(convoId: number): void {
  const fresca = getConversationById(convoId);
  if (fresca?.state !== "awaiting_gift_consent") return;
  if (muestrasEnviadas(estadoEnElTablero(convoId)).includes(REGALO_RECORDADO)) return;
  anotarMuestras(convoId, [REGALO_RECORDADO]);
  setConversationState(convoId, "payment_approved");
  const segundos = Math.max(1, Math.floor(loadWorkflowConfig()?.awaiting_email_timeout_seconds ?? 300));
  const falta = Math.max(1, (getLastUserMessageTime(convoId) ?? ahora()) + segundos - ahora());
  console.log(`[tablero] convo ${convoId}: el regalo quedó sin responder tras el reenvío → se le recuerda en ${falta} s (una vez)`);
  scheduleGiftConsentWithDelay(convoId, falta);
}

/** Abre el cobro de lo que puede comprar (saliendo del regalo si estaba en él). */
async function abrirLoQuePuedeComprar(convo: ConversationRow, t: Tablero, x: LoQuePuedeComprar, enSilencio = false): Promise<void> {
  const fresca = getConversationById(convo.id) ?? convo;
  // Sale del regalo SOLO si el regalo seguía sin respuesta (T1 en la copia, 27/10/2026): con el regalo ya
  // aceptado (dejando su comentario) se salía igual, y después el regalo se le ofrecía otra vez desde cero.
  // Con el regalo en marcha, el cobro se abre y el regalo sigue: un comprobante ahí lo atiende el tablero.
  if (!enSilencio && fresca.state === "awaiting_gift_consent") {
    // Como «completar»: el cobro manda ahora; al pagar, su ruta lo lleva a la entrega (y al regalo).
    anotarRegaloSinResponder(convo.id, fresca.state);
    cancelPendingActionsForConvo(convo.id);
    setConversationState(convo.id, "tablero");
  }
  console.log(`[tablero] convo ${convo.id}: después de comprar, paga «${x.nombre}» (${x.upgrade ? "upgrade, falta" : "entero"} ${x.precio})`);
  await irA(convo.id, t, x.ficha.id, 0, { enSilencio, upgrade: x.upgrade });
}

/**
 * LO QUE EL BOT ACABA DE PROPONER (28/10/2026): de lo que puede comprar, el ÚNICO que su último turno nombra
 * con su precio en la misma burbuja, terminando en pregunta (la misma regla que «sí a lo ofrecido» de
 * `comprarDespuesDeComprar`: lo estable del texto del bot es el precio). Si no hay uno claro, null.
 */
function loQueAcabaDeProponer(convo: ConversationRow, t: Tablero, pais: string): LoQuePuedeComprar | null {
  const opciones = loQuePuedeComprar(convo, t, pais);
  if (opciones.length === 0) return null;
  const recientes = ultimosMensajes(convo.id, 10);
  const ultimoDelCliente = recientes.map((m) => m.role).lastIndexOf("user");
  const antes = recientes.slice(0, ultimoDelCliente < 0 ? recientes.length : ultimoDelCliente);
  const turno: string[] = [];
  for (let i = antes.length - 1; i >= 0 && antes[i].role !== "user"; i--) turno.unshift(antes[i].content ?? "");
  if (!turno.some((b) => b.includes("?"))) return null;
  const palabras = (s: string) => new Set(sinTildes(s).replace(/[^a-z0-9ñ\s]/g, " ").split(/\s+/).filter((w) => w.length >= 3 && !PALABRAS_COMUNES.has(w)));
  const conjuntos = opciones.map((o) => palabras(o.nombre));
  const unicas = conjuntos.map((s, i) => [...s].filter((w) => conjuntos.every((o, j) => j === i || !o.has(w))));
  const conSuPrecio = (o: LoQuePuedeComprar, texto: string) => {
    const n = String(Math.round(o.precio * 100) / 100);
    const variantes = [n, n.replace(".", ","), Number.isInteger(o.precio) ? `${n}.00` : ""].filter(Boolean);
    return variantes.some((v) => new RegExp(`(^|[^\\d.,])${v.replace(".", "\\.")}([^\\d]|$)`).test(texto));
  };
  let nombrados = opciones.filter((o, i) => turno.some((b) => unicas[i].some((w) => palabras(b).has(w)) && conSuPrecio(o, b)));
  // (Nombre y precio en burbujas distintas, si el turno no habla del regalo: la misma regla de `comprarDespuesDeComprar`.)
  if (nombrados.length === 0 && !/\b(regalo|regalito|gratis|obsequio)\b/.test(sinTildes(turno.join("\n")))) {
    const todo = turno.join("\n");
    nombrados = opciones.filter((o, i) => unicas[i].some((w) => palabras(todo).has(w)) && conSuPrecio(o, todo));
    // (Sin precio: si su pregunta invita a comprar y nombra UNO solo — la misma regla de `comprarDespuesDeComprar`.)
    const pregunta = sinTildes(turno.filter((b) => b.includes("?")).pop() ?? "");
    if (nombrados.length === 0 && INVITA_A_COMPRAR.test(pregunta)) {
      const soloNombrados = opciones.filter((o, i) => unicas[i].some((w) => palabras(todo).has(w)));
      if (soloNombrados.length === 1) nombrados = soloNombrados;
    }
  }
  return nombrados.length === 1 ? nombrados[0] : null;
}

/** ¿Lo PREGUNTA («¿puedo completar?», «se puede pagar…»), o lo pide? Sin signos también: «puedo completar». */
function preguntaSiPuede(contenido: string): boolean {
  return /[?¿]/.test(contenido) || /\b(puedo|puede|se puede|podria|podre|es posible)\b/.test(sinTildes(contenido));
}

/** «¿A cuál te refieres?», con los nombres delante (`preguntarPorCualDeLosDos` de la venta de siempre). */
const PREGUNTA_A_CUAL = "¿A cuál te refieres? 😊";
async function preguntarACual(convo: ConversationRow, opciones: LoQuePuedeComprar[], pais: string): Promise<void> {
  const lineas = opciones.map((o) =>
    o.upgrade
      ? `• *${o.nombre}* — puedes completar lo que ya pagaste: te faltan *${formatCurrencyAmount(o.precio, pais as never)}*.`
      : `• *${o.nombre}* — va aparte y se paga completo: *${formatCurrencyAmount(o.precio, pais as never)}*.`
  );
  await sendConfiguredSteps(convo, [{ type: "text", body: `${PREGUNTA_A_CUAL}\n\n${lineas.join("\n")}` }] as never);
  console.log(`[tablero] convo ${convo.id}: después de comprar, quiere pagar sin decir cuál → le pregunto a cuál`);
}

/**
 * «SÍ» CON EL REGALO Y UN PRODUCTO PENDIENTES A LA VEZ (27/10/2026, su texto exacto): dos burbujas.
 * Su respuesta la atiende `respondeRegaloOProducto`.
 */
const REGALO_O_PRODUCTO = "Veo que sí aceptaste, pero tengo una duda: ";
async function preguntarRegaloOProducto(convo: ConversationRow, x: LoQuePuedeComprar, pais: string): Promise<void> {
  console.log(`[tablero] convo ${convo.id}: «sí» con el regalo y «${x.nombre}» pendientes → le pregunto a cuál`);
  await sendConfiguredSteps(convo, [
    { type: "text", body: `${REGALO_O_PRODUCTO}¿me puedes confirmar si aceptaste el regalo? 🎁`, delay_after_sec: 2 },
    { type: "text", body: `¿O quieres llevar *${x.nombre}* por *${formatCurrencyAmount(x.precio, pais as never)}*? 😊` },
  ] as never);
}

/**
 * QUIERE COMPRAR ALGO MÁS DESPUÉS DE COMPRAR (27/10/2026): «quiero pagar eso de mascotas», «puedo
 * completar», «quiero el otro también». Lo resuelve el bot, no la IA (antes la IA elegía otro producto
 * y escribía una cuenta). Un producto claro → su cobro; varios → «¿a cuál te refieres?»; y la respuesta
 * a esa pregunta elige. Devuelve true si atendió el turno.
 */
async function comprarDespuesDeComprar(
  convo: ConversationRow,
  t: Tablero,
  contenido: string,
  pais: string,
  enElRegalo = false,
  hayOfertaDelante = false,
  /** El cobro que está abierto ahora (el del upsell, p. ej.): «completar» con él delante es ambiguo. */
  cobroAbierto?: string
): Promise<boolean> {
  const opciones = loQuePuedeComprar(convo, t, pais);
  if (opciones.length === 0) return false;
  // Si el cobro abierto ya ES el del upgrade, «completar» habla de ése: lo atiende su cobro.
  if (cobroAbierto && opciones.some((o) => o.ficha.id === cobroAbierto && o.upgrade)) return false;
  const normal = sinTildes(contenido);
  const ultimaDelBot = [...ultimosMensajes(convo.id, 6)].reverse().find((m) => m.role !== "user")?.content ?? "";
  const respondeAMiPregunta = ultimaDelBot.startsWith(PREGUNTA_A_CUAL);
  // ¿Cuál nombra? Por una palabra que solo tiene una de las opciones.
  const palabras = (s: string) => new Set(sinTildes(s).replace(/[^a-z0-9ñ\s]/g, " ").split(/\s+/).filter((w) => w.length >= 3 && !PALABRAS_COMUNES.has(w)));
  const conjuntos = opciones.map((o) => palabras(o.nombre));
  const dichas = palabras(contenido);
  const unicas = conjuntos.map((s, i) => [...s].filter((w) => conjuntos.every((o, j) => j === i || !o.has(w))));
  let acertadas = opciones.filter((_, i) => unicas[i].some((w) => dichas.has(w)));
  // «SÍ» A LO QUE EL BOT ACABA DE OFRECER (HEA1, 27/10/2026): la IA describió 100 CITAS y cerró con
  // «¿te gustaría agregarlo?»; el «sí» volvía a la IA, que preguntaba «¿te indico cómo pagar?». Si el
  // último turno del bot (todas sus burbujas) nombra UNO de lo que puede comprar y termina preguntando,
  // el «sí» es para ése: su cobro, con los datos de frente si ya tiene método.
  const recientes = ultimosMensajes(convo.id, 10);
  const ultimoDelCliente = recientes.map((m) => m.role).lastIndexOf("user");
  const antesDeSuMensaje = recientes.slice(0, ultimoDelCliente < 0 ? recientes.length : ultimoDelCliente);
  const turno: string[] = [];
  for (let i = antesDeSuMensaje.length - 1; i >= 0 && antesDeSuMensaje[i].role !== "user"; i--) turno.unshift(antesDeSuMensaje[i].content ?? "");
  const turnoDelBot = turno.join("\n").trim();
  // SU RESPUESTA A «¿ACEPTASTE EL REGALO O QUIERES LLEVAR X?»: regalo → se le da; X → su cobro; los dos
  // → las dos cosas. Con otra cosa sigue lo de siempre.
  if (turnoDelBot.includes(REGALO_O_PRODUCTO)) {
    const delQueSePregunto = opciones.find((o) => turnoDelBot.includes(`llevar *${o.nombre}*`));
    const quiereRegalo = /\b(regalo|regalito|gratis|obsequio)\b/.test(normal);
    const quiereProducto = /\b(producto|pagar|pago|llevar|llevo|comprar|compro|lo otro|el otro)\b/.test(normal) || acertadas.length > 0;
    const ambos = /\b(los dos|las dos|ambos|ambas|todo)\b/.test(normal);
    if (delQueSePregunto && (quiereRegalo || quiereProducto || ambos)) {
      const regaloEsperaba = (getConversationById(convo.id) ?? convo).state === "awaiting_gift_consent";
      // Primero el producto (su cobro manda sus datos y sale del paso del regalo)…
      if (quiereProducto || ambos) {
        console.log(`[tablero] convo ${convo.id}: a «¿regalo o producto?» → «${delQueSePregunto.nombre}»`);
        await abrirLoQuePuedeComprar(convo, t, acertadas.length === 1 ? acertadas[0] : delQueSePregunto);
      }
      // …y después el regalo, con la función de la venta de siempre (programa su envío).
      if ((quiereRegalo || ambos) && regaloEsperaba) {
        const { acceptGiftConsent } = await import("@/lib/workflow/engine");
        acceptGiftConsent(getConversationById(convo.id) ?? convo);
        anotarMuestras(convo.id, [REGALO_HECHO]);
        console.log(`[tablero] convo ${convo.id}: a «¿regalo o producto?» → el regalo`);
      }
      return true;
    }
  }
  const afirma = AFIRMA.test(normal.trim());
  let siALoOfrecido = false;
  // (La pregunta puede no estar al final: «¿Lo agregas? Escríbeme «si» o «no» 😊» — D2 en la copia.)
  // (En cualquier burbuja de su turno: tras la oferta puede venir otra sin pregunta, como «Elige una opción:».)
  if (afirma && acertadas.length === 0 && turno.some((b) => b.includes("?") || /escr[ií]beme\W+s[ií]\b/i.test(b))) {
    // NOMBRADO Y CON SU PRECIO, EN LA MISMA BURBUJA (H2/T1, 27/10/2026): el «sí» al REGALO abrió el cobro de
    // 100 CITAS porque la frase del regalo decía «tu mascota». Lo estable del texto del bot es el precio
    // (CLAUDE.md): una oferta de producto lo lleva junto a su nombre; la del regalo («gratis») no.
    const conSuPrecio = (o: LoQuePuedeComprar, texto: string) => {
      const n = String(Math.round(o.precio * 100) / 100);
      const variantes = [n, n.replace(".", ","), Number.isInteger(o.precio) ? `${n}.00` : ""].filter(Boolean);
      return variantes.some((v) => new RegExp(`(^|[^\\d.,])${v.replace(".", "\\.")}([^\\d]|$)`).test(texto));
    };
    let nombrados = opciones.filter((o, i) => turno.some((b) => unicas[i].some((w) => palabras(b).has(w)) && conSuPrecio(o, b)));
    // EL NOMBRE EN UNA BURBUJA Y EL PRECIO EN OTRA (28/10/2026, su UULA1: «100 CITAS… es un material…» /
    // «…tiene un costo de $2…» / «¿Te gustaría agregarlo?» → su «sí» se fue al regalo). Si el turno NO habla
    // del regalo, vale el turno entero; si lo nombra, sigue la regla de la misma burbuja (el H2/T1).
    if (nombrados.length === 0 && !/\b(regalo|regalito|gratis|obsequio)\b/.test(sinTildes(turnoDelBot))) {
      const todo = turno.join("\n");
      nombrados = opciones.filter((o, i) => unicas[i].some((w) => palabras(todo).has(w)) && conSuPrecio(o, todo));
      // SIN PRECIO (28/10/2026, ronda 11: «COMIDAS PERUANAS incluye 60 platos…» / «¿Deseás adquirirlo?» → su «sí» se fue a
      // la IA, que prometió «te envío los datos» y no salió nada). Si su pregunta invita a comprar y el turno nombra
      // UNO solo de lo que puede comprar, ése.
      const pregunta = sinTildes(turno.filter((b) => b.includes("?")).pop() ?? "");
      if (nombrados.length === 0 && INVITA_A_COMPRAR.test(pregunta)) {
        const soloNombrados = opciones.filter((o, i) => unicas[i].some((w) => palabras(todo).has(w)));
        if (soloNombrados.length === 1) nombrados = soloNombrados;
      }
    }
    if (nombrados.length === 1) {
      // ¿Y EL REGALO TAMBIÉN ESTÁ PENDIENTE y el bot habló de los dos? No se sabe a cuál dice «sí»:
      // se le pregunta, con sus palabras (dos burbujas).
      const fresca = getConversationById(convo.id) ?? convo;
      const regaloPendiente = fresca.state === "awaiting_gift_consent";
      if (regaloPendiente && /\b(regalo|regalito|gratis|obsequio)\b/.test(sinTildes(turnoDelBot))) {
        await preguntarRegaloOProducto(convo, nombrados[0], pais);
        return true;
      }
      acertadas = nombrados;
      siALoOfrecido = true;
    }
  }
  // Solo con una intención CLARA de comprar: «lo quiero» a secas puede ser el «sí» al regalo, y una
  // pregunta («¿qué trae el pack?») la contesta la IA.
  const esPregunta = /\?|¿/.test(contenido) || /^(que|cual|cuanto|como|donde|cuando|por que|tiene|trae|incluye)\b/.test(normal.trim());
  const completar = /\b(completar|completo|la diferencia|el resto|lo que falta|pasarme al|cambiarme al)\b/.test(normal);
  // En el regalo, «sí quiero» / «lo quiero» es aceptar el REGALO: ahí solo cuenta pagar o comprar dicho.
  const quiereComprar =
    siALoOfrecido ||
    (!esPregunta &&
    ((enElRegalo ? /\b(pagar|pago|comprar|adquirir|depositar|transferir|yapear)\b/.test(normal) : QUIERE_PAGAR.test(normal)) ||
      completar ||
      (acertadas.length > 0 && /\b(quiero|quisiera|pagar|pago|comprar|compro|llevar|llevo|adquirir|tambien)\b/.test(normal))));
  if (!quiereComprar && !respondeAMiPregunta) return false;
  // Con una oferta delante (el upsell con su «Sí»), «me lo llevo» sin nombrar nada es para ESA oferta: la
  // atiende su ficha, como el «sí» al extra de la venta de siempre.
  if (hayOfertaDelante && acertadas.length === 0 && !completar && !respondeAMiPregunta) return false;
  let elegida: LoQuePuedeComprar | undefined = acertadas.length === 1 ? acertadas[0] : undefined;
  // Completar sin nombrar, con un solo upgrade posible: ése. Los que van aparte no se completan, así que
  // no entran en la duda (HEA1: «ya pagué 3, ¿puedo completar para el otro?» preguntaba entre tres).
  if (!elegida && /\b(completar|la diferencia|el resto|lo que falta)\b/.test(normal)) {
    const upgrades = opciones.filter((o) => o.upgrade);
    // PERO CON OTRO PRODUCTO DELANTE (el upsell ofrecido, o su cobro abierto), «completar para el otro» es
    // ambiguo (28/10/2026, su HHH1: con 100 CITAS abierto, la IA le cobró 100 CITAS entero). Como el
    // automático («si no lo sabe, le pregunta a cuál se refiere»): «¿a cuál te refieres?» con los dos —
    // el que se completa (lo que falta) y el que va aparte (entero)—, sin adivinar.
    // (Y en el regalo: el upsell se le ofreció justo antes y no lo compró — su conversación 101, 28/10/2026.)
    const delante = opciones.filter((o) => !o.upgrade && (o.ficha.id === cobroAbierto || hayOfertaDelante || enElRegalo));
    // Solo si lo PREGUNTA («¿puedo completar?», «puedo completar para el otro»): «quiero completar el otro»
    // es una orden clara y va directo al que se completa (28/10/2026, su hay1: así le gustó).
    if (upgrades.length >= 1 && delante.length > 0 && !respondeAMiPregunta && preguntaSiPuede(contenido)) {
      await preguntarACual(convo, [...upgrades, ...delante], pais);
      return true;
    }
    if (upgrades.length === 1) elegida = upgrades[0];
  }
  // Contesta a «¿a cuál te refieres?» con otras palabras («el último que me enseñaste»): decide la IA.
  if (!elegida && respondeAMiPregunta) {
    const id = await elegirOpcionConIA(
      convo.id,
      contenido,
      opciones.map((o) => ({ id: o.productoId, etiqueta: `${o.nombre}${o.upgrade ? " (completar lo que ya pagó)" : " (va aparte, el último que se le ofreció si es el upsell)"}` }))
    );
    elegida = opciones.find((o) => o.productoId === id);
  }
  // Uno solo: ése. Salvo que pida COMPLETAR y ése no se complete (va aparte): entonces «¿a cuál te refieres?»
  // le dice que va aparte y se paga entero, como la venta de siempre (`responderQueElExtraSePagaEntero`).
  // (A3/C1 en la copia: ya tenía el pack, pidió «completar al pack» y se le abrió el cobro de 100 CITAS.)
  if (!elegida && opciones.length === 1 && !(completar && !opciones[0].upgrade)) elegida = opciones[0];
  if (!elegida && completar && opciones.every((o) => !o.upgrade)) {
    const lista = opciones.map((o) => `*${o.nombre}* por *${formatCurrencyAmount(o.precio, pais as never)}*`).join(" o ");
    await sendConfiguredSteps(convo, [
      { type: "text", body: `${lista} es otro material 😊 No se completa con lo que ya pagaste: va aparte y se paga entero. ¿Lo quieres?` },
    ] as never);
    console.log(`[tablero] convo ${convo.id}: pidió completar, pero no hay nada que completar → le digo que va aparte`);
    return true;
  }
  if (elegida) {
    await abrirLoQuePuedeComprar(convo, t, elegida);
    return true;
  }
  if (respondeAMiPregunta) return false; // ni así: que conteste la IA
  await preguntarACual(convo, opciones, pais);
  return true;
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
  return conSuPrecio(convo.id, () => alRecibirMensajeDentro(convo, contenido, tiendaDelCanal));
}

async function alRecibirMensajeDentro(convo: ConversationRow, contenido: string, tiendaDelCanal?: Tienda | null): Promise<boolean> {
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
 * EL REGALO, CUANDO EL MOTOR DE SIEMPRE NO LO RESOLVIÓ (27/10/2026, su prueba HOLA2). En el regalo, el
 * motor de siempre atiende sus botones, sus cuadritos, el «sí»/«no» y la captura; lo que no resuelve
 * («como es eso») caía en la IA de la venta de siempre, que vendía SU producto: mandó la foto de lo que
 * el cliente ya había comprado y «¿deseas adquirirlo?». En una conversación del tablero, ese texto lo
 * contesta la IA del tablero, que sabe lo que compró y no le vuelve a vender. Solo texto: una imagen
 * sigue su camino de siempre (la captura del comentario). Devuelve false si no es su caso.
 */
/**
 * «NO ME LLEGÓ» — EL MISMO DETECTOR DE LA VENTA DE SIEMPRE (`wantsPurchasedMaterial` de engine.ts, copiado
 * tal cual: allá vive dentro de una función y no se toca). La venta de siempre lo mira en TODOS los pasos
 * de la postventa (pagado, correo, regalo, comentario) y reenvía sin pasar por la IA. Más las formas que
 * él no reconocía y salieron en su prueba H4 (27/10/2026): «no me ha llegado nada», «no hay», «no está»,
 * «cuándo me van a enviar».
 */
function pideLoQueCompro(texto: string): boolean {
  const t = texto.toLowerCase().normalize("NFD").replace(/\p{Mn}/gu, "");
  // «NO ME HA LLEGADO EL REGALO» es del regalo, no de lo que compró (28/10/2026, ronda 3: se le reenviaron sus dos
  // compras). Lo atiende el regalo (que llega tras su comentario).
  if (/\bregal(o|ito)\b|\bobsequio\b/.test(t)) return false;
  return (
    /\b(no\s+me\s+(llega|llego|envian|enviaron|mandan|mandaron)|donde\s+esta|a\s+que\s+hora|cuando\s+me\s+(llega|llego|envian|mandan)|me\s+(envian|mandan|reenvian|pasan)|reenviame|reenvia|envia(me)?|manda(me)?|pasame)\b[\s\S]*\b(material|curso|link|enlace|acceso|video|pack|producto)\b/.test(t) ||
    /\b(material|curso|link|enlace|acceso|video|pack|producto)\b[\s\S]*\b(no\s+me\s+(llega|llego)|donde\s+esta|reenviame|reenvia|envia(me)?|manda(me)?|pasame)\b/.test(t) ||
    /\b(no\s+lo\s+(veo|encuentro|ubico|tengo|recibi|recibo)|no\s+me\s+aparece|no\s+aparece|se\s+(perdio|borro)|lo\s+perdi|pasamelo|pasame(lo)?|mandamelo|manda(me)?lo|envia(me)?lo|reenviar|reenviamelo|reenvialo)\b/.test(t) ||
    /\b(cuanto|cuando|a\s+que\s+hora)\b[\s\S]*\b(demora|tarda|llega|envian|mandan|recibo)\b/.test(t) ||
    // Las de su prueba H4/H2:
    /\bno\s+me\s+(ha|han)\s+(llegado|enviado|mandado)\b/.test(t) ||
    // «no me llegó lo de mi aporte»: después de una entrega (esta función solo se usa con entregas), «no me
    // llegó / llegaron» ya es un reclamo de lo entregado (E1 en la copia, 27/10/2026).
    /\bno\s+me\s+(llego|llegaron|llega)\b/.test(t) ||
    /\bcuando\s+me\s+(van\s+a|vas\s+a)\s+(enviar|mandar|llegar)\b/.test(t) ||
    /^\s*(no\s+(hay|esta|llego|llega|aparece|veo\s+nada)|no\s+me\s+llego\s+nada)\s*[.!]*\s*$/.test(t)
  );
}

/** «Ya pagué» escrito (sin tildes, en minúsculas). */
const YA_PAGO_SIN_FOTO =
  /\b(ya (te )?(pague|yapee|plinee|deposite|transferi|hice (el|la) (pago|transferencia|deposito))|ya esta pagado|ahi (te )?(mande|envie|va) (el|la)? ?(pago|comprobante|captura)|listo ya pague)\b/;

/** Lo que escribió el cliente en su turno ANTERIOR (antes de la última respuesta del bot). */
function loQueDijoAntes(conversationId: number): string {
  const alReves = [...ultimosMensajes(conversationId, 14)].reverse();
  const bot = alReves.findIndex((m) => m.role !== "user");
  if (bot < 0) return "";
  const resto = alReves.slice(bot);
  const desde = resto.findIndex((m) => m.role === "user");
  if (desde < 0) return "";
  const suyos: string[] = [];
  for (const m of resto.slice(desde)) {
    if (m.role !== "user") break;
    suyos.unshift(m.content ?? "");
  }
  return suyos.join("\n");
}

/** Las burbujas del bot desde el último mensaje del cliente hacia atrás (su último turno), juntas. */
function ultimoTurnoDelBot(conversationId: number): string {
  const alReves = [...ultimosMensajes(conversationId, 12)].reverse();
  const desde = alReves.findIndex((m) => m.role !== "user");
  const resto = desde < 0 ? [] : alReves.slice(desde);
  const hasta = resto.findIndex((m) => m.role === "user");
  return (hasta < 0 ? resto : resto.slice(0, hasta)).reverse().map((m) => m.content ?? "").join("\n");
}
/** La última pregunta de ese turno (sin tildes). */
function ultimaPreguntaDelBot(conversationId: number): string {
  return sinTildes(ultimoTurnoDelBot(conversationId).split(/(?<=[.!])\s+|\n/).filter((x) => x.includes("?")).pop() ?? "");
}
/**
 * ¿El último turno del bot fueron las burbujas de estas fichas (y no una respuesta de la IA)? Se busca en él
 * alguna línea de sus textos (sin comodines, solo letras): sale tal cual, y la IA no la copia.
 */
function laFichaHabloUltimo(conversationId: number, fichas: FichaDelTablero[]): boolean {
  const plano = (s: string) => sinTildes(s).replace(/[^a-zñ]+/g, "");
  const turno = plano(ultimoTurnoDelBot(conversationId));
  if (!turno) return false;
  for (const f of fichas) {
    for (const p of pasosDeLaFicha(f) as Array<{ body?: string; body_variants?: string[]; caption?: string; caption_variants?: string[] }>) {
      const textos = [p.body ?? "", ...(p.body_variants ?? []), p.caption ?? "", ...(p.caption_variants ?? [])];
      for (const linea of textos.flatMap((x) => x.split("\n"))) {
        if (linea.includes("{{")) continue;
        const l = plano(linea);
        if (l.length >= 12 && turno.includes(l)) return true;
      }
    }
  }
  return false;
}

/** Lo reenvía, como la venta de siempre («Claro, te lo reenvío ahora mismo» + lo comprado). */
function reenviarSiLoPide(convo: ConversationRow, texto: string): boolean {
  if (!texto.trim() || entregasDelCliente(convo.id).length === 0 || !pideLoQueCompro(texto)) return false;
  console.log(`[tablero] convo ${convo.id}: pide lo que compró → reenvío directo (como la venta de siempre)`);
  reenviarLoDelTablero(convo, texto, true);
  return true;
}

export async function contestarEnElRegalo(convo: ConversationRow): Promise<boolean> {
  return conSuPrecio(convo.id, () => contestarEnElRegaloDentro(convo));
}

async function contestarEnElRegaloDentro(convo: ConversationRow): Promise<boolean> {
  const estado = estadoEnElTablero(convo.id);
  if (!estado || !ESTADOS_DEL_REGALO.has(convo.state ?? "")) return false;
  return conSuTienda(estado.tienda_id, convo, async () => {
    const t = tableroDe(loadWorkflowConfig(), estado.tienda_id, (estado.canal as CanalDelTablero) || "whatsapp");
    if (!t) return false;
    // «NO ME LLEGÓ» DENTRO DEL REGALO (H4, 27/10/2026): antes iba a la IA, que no podía reenviar y
    // ofrecía un asesor. Ahora, como la venta de siempre en ese mismo paso: reenvío directo.
    const ultimoTexto = ultimosMensajes(convo.id, 2).filter((m) => m.role === "user").pop()?.content ?? "";
    if (reenviarSiLoPide(convo, ultimoTexto)) {
      recordarElRegaloUnaVez(convo.id);
      return true;
    }
    const nota =
      convo.state === "awaiting_gift_consent"
        ? "Está en el paso del REGALO: se le acaba de ofrecer (míralo en tus últimos mensajes). Contesta su duda sobre ese regalo con lo que dice ese ofrecimiento, sin inventar, y al final pregúntale con tus palabras si lo quiere. Ya compró: no le ofrezcas ni le cobres ningún producto."
        : convo.state === "awaiting_facebook_comment"
          ? "Está en el paso del REGALO de dejar su comentario (míralo en tus últimos mensajes). Contesta su duda con lo que dice ese mensaje, sin inventar, y recuérdale que cuando deje su comentario y mande la captura le envías su regalo. Ya compró: no le ofrezcas ni le cobres ningún producto."
          : "Ya compró y está recibiendo su regalo. Contesta su duda con amabilidad, sin inventar. No le ofrezcas ni le cobres ningún producto.";
    console.log(`[tablero] convo ${convo.id}: en el regalo (${convo.state}) contesta la IA del tablero, no la de la venta de siempre`);
    await contestarConIA(convo, t, nota);
    return true;
  });
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

/** Una burbuja de texto por lo que tiene escrito (antes de los comodines); las demás no se comparan. */
function huellaDeLaBurbuja(p: SequenceStep): string {
  const x = p as { type?: string; body?: string; body_variants?: string[] };
  if (x.type && x.type !== "text") return `otra:${Math.random()}`;
  return JSON.stringify(x.body_variants?.length ? x.body_variants : [x.body ?? ""]);
}

/** Las burbujas que recibió en la tubería vieja, para no repetirlas en la nueva (las lee y borra `irA`). */
const burbujasDeLaTuberiaVieja = new Map<number, Set<string>>();

/** La primera ficha que presenta productos desde el Inicio (siguiendo sus cables). */
function primeraPresentacion(t: Tablero, inicioId: string): FichaDelTablero | null {
  for (const id of alcanzables(t, [inicioId])) {
    const f = t.fichas.find((x) => x.id === id);
    if (f && !f.apagada && (f.tipo === "mensaje" || f.tipo === "intro_ob") && (f.presenta ?? []).length > 0) return f;
  }
  return null;
}

/**
 * ¿SE QUEDÓ EN LA TUBERÍA VIEJA? (28/10/2026, su pedido: «el aviso al reconectar no debe salir para
 * todos, debe ser cuando la gente interactúa… y cuidado con los nuevos»). Él reconectó el Inicio de su país
 * a otra tubería y la ficha donde está este cliente ya no se alcanza desde él. Las condiciones son las de
 * `hayQueAvisarDeLaActualizacion` del automático, con sus arreglos ya hechos:
 *   - solo cuando ESCRIBE (este turno), nunca en un seguimiento; una sola vez (`aviso_novedad`);
 *   - nunca después de comprar ni con algo entregado, ni a mitad del pago (cobro abierto o comprobante):
 *     ése termina en la tubería que estaba, con su precio;
 *   - el aviso solo si la nueva presenta productos que NO se le presentaron (antes uno, ahora dos);
 *   - nunca en COMO OB (el segundo es oculto: avisarlo lo revelaría) → pasa en silencio;
 *   - sin nada presentado todavía, no hay novedad que contar: entra a la nueva desde el Inicio.
 * Lo dice el bot, nunca la IA (en el automático, pedírselo a la IA falló tres veces de seis).
 */
function seQuedoEnLaTuberiaVieja(
  convo: ConversationRow,
  t: Tablero,
  estado: EstadoEnElTablero,
  pais: string,
  contenido: string
): { modo: "avisar" | "silencio" | "desde_inicio"; inicio: FichaDelTablero; presentacion: FichaDelTablero } | null {
  if (estado.aviso_novedad === 1 || estado.cobro_ficha_id) return null;
  if (comprasDelCliente(convo.id).length > 0 || entregasDelCliente(convo.id).length > 0) return null;
  if (hayComprobantePendiente(convo.id, estado.comprobante_leido) || contenido.startsWith("bubble:")) return null;
  if (!elTableroAtiende(t, pais)) return null;
  const inicio = inicioDelPais(t, pais);
  if (!inicio) return null;
  const alcanza = new Set(alcanzables(t, [inicio.id]));
  if (alcanza.has(estado.ficha_id)) return null;
  const presentacion = primeraPresentacion(t, inicio.id);
  if (!presentacion) return null;
  const vistos = presentadosDe(estado);
  if (vistos.length === 0) return { modo: "desde_inicio", inicio, presentacion };
  const hayOrderBump = [...alcanza].some((id) => {
    const f = t.fichas.find((x) => x.id === id);
    return f?.tipo === "intro_ob" && !f.apagada;
  });
  const nuevos = (presentacion.presenta ?? []).filter((id) => !vistos.includes(id));
  // Nada nuevo, o COMO OB: en silencio. El aviso dice «ahora tenemos 2 opciones»: solo si la nueva presenta
  // dos o más (la condición 5 del automático). Otro producto distinto → la presentación nueva, sin aviso.
  if (hayOrderBump || nuevos.length === 0) return { modo: "silencio", inicio, presentacion };
  return { modo: (presentacion.presenta ?? []).length >= 2 ? "avisar" : "desde_inicio", inicio, presentacion };
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
    // SU PRIMER MENSAJE ES UN COMPROBANTE (28/10/2026, su caso real: dos números con el mismo embudo; la
    // clienta recibió los datos en uno y pagó por el otro, donde nunca había escrito, y no se le entregó).
    // Se lee por el mismo camino que un pago durante la intro: si el monto es de un producto, se entrega.
    if (hayComprobantePendiente(convo.id, estadoEnElTablero(convo.id)?.comprobante_leido ?? null)) {
      console.log(`[tablero] convo ${convo.id}: su primer mensaje trae un comprobante → se revisa`);
      return turnoDelTablero(convo, contenido, tiendaDelCanal);
    }
    return true;
  }

  const t = tableroDe(config, estado.tienda_id, (estado.canal as CanalDelTablero) || "whatsapp");

  // «CON LO QUE PAGUÉ, ¿ME LLEVO X?» (28/10/2026, su conversación 101: la IA contestó «¡claro que sí! con lo
  // que ya pagaste puedes llevarte 100 CITAS sin pagar nada extra» — falso: el upsell va aparte y se paga
  // entero). Lo contesta el bot con los datos, como el automático: si X es el que se completa, lo que falta;
  // si va aparte, su precio entero y para qué sirve lo pagado. Solo con algo comprado y X nombrado.
  if (t && !contenido.startsWith("bubble:") && /\b(pague|pagado|pagaste|ya pague|con eso|ese pago|mi pago)\b/.test(sinTildes(contenido))) {
    const opciones = loQuePuedeComprar(convo, t, pais);
    const palabrasDe = (s: string) =>
      sinTildes(s)
        .replace(/[^a-z0-9ñ\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 3 && !PALABRAS_COMUNES.has(w))
        .map((w) => (w.length > 4 ? w.replace(/s$/, "") : w));
    const dichas = new Set(palabrasDe(contenido));
    // Una palabra que SOLO tiene ese producto (no las que comparte con los otros).
    const unicas = opciones.map((o, i) => palabrasDe(o.nombre).filter((w) => !opciones.some((x, j) => j !== i && palabrasDe(x.nombre).includes(w))));
    const nombrados = opciones.filter((_, i) => unicas[i].some((w) => dichas.has(w)));
    if (nombrados.length === 1 && !nombrados[0].upgrade) {
      const x = nombrados[0];
      const up = opciones.find((o) => o.upgrade);
      const texto = up
        ? `*${x.nombre}* es un material aparte: se paga completo, *${formatCurrencyAmount(x.precio, pais as never)}* 😊\n\nLo que ya pagaste sirve solo para completar *${up.nombre}* (te falta *${formatCurrencyAmount(up.precio, pais as never)}*).\n\n¿Cuál te gustaría?`
        : `*${x.nombre}* es un material aparte: se paga completo, *${formatCurrencyAmount(x.precio, pais as never)}* 😊 Lo que ya pagaste fue por lo que ya recibiste.\n\n¿Deseas adquirirlo?`;
      if (convo.state === "awaiting_gift_consent") {
        anotarRegaloSinResponder(convo.id, convo.state);
        cancelPendingActionsForConvo(convo.id);
        setConversationState(convo.id, "tablero");
      }
      console.log(`[tablero] convo ${convo.id}: «con lo que pagué, ¿${x.nombre}?» → va aparte (${x.precio})`);
      await sendConfiguredSteps(convo, [{ type: "text", body: texto }] as never);
      tocarVuelta(convo.id);
      return true;
    }
  }

  // RECONECTÓ EL INICIO A OTRA TUBERÍA y este cliente se quedó en la vieja: al volver a escribir pasa a la
  // nueva, como el automático al cambiar de modalidad (ver `seQuedoEnLaTuberiaVieja`).
  if (t && !ESTADOS_DEL_REGALO.has(convo.state ?? "")) {
    const vieja = seQuedoEnLaTuberiaVieja(convo, t, estado, pais, contenido);
    if (vieja) {
      // LO DE LA VIEJA SE SUELTA (28/10/2026, ronda 27: de 2 productos a 1, el bot seguía ofreciendo el
      // pack que la nueva ya no vende): sus seguimientos colgados y lo que presentó. Lo que ya recibió
      // (las burbujas) se recuerda aparte, para no repetirlas.
      ponerSeguimiento(convo.id, null, 0);
      olvidarPresentados(convo.id);
    }
    if (vieja?.modo === "desde_inicio") {
      marcarAvisoDeNovedad(convo.id);
      // Lo que ya recibió en la vieja (el saludo) no se repite.
      burbujasDeLaTuberiaVieja.set(
        convo.id,
        new Set(fichasVisitadas(convo.id).flatMap((id) => pasosActivos(t.fichas.find((x) => x.id === id)?.steps).map(huellaDeLaBurbuja)))
      );
      console.log(`[tablero] convo ${convo.id}: estaba en la tubería vieja → entra a la nueva desde el Inicio, sin aviso`);
      await irA(convo.id, t, vieja.inicio.id);
      return true;
    }
    if (vieja) {
      if (vieja.modo === "avisar") {
        const texto = (config?.order_bump?.aviso_actualizacion ?? "").trim() || AVISO_DE_ACTUALIZACION_POR_DEFECTO;
        const pasos = conLosComodinesDeLaFicha(
          [{ type: "text", body: texto }] as never,
          productosDeLaFicha(config, vieja.presentacion.presenta ?? [], pais, estado.oferta === 1),
          pais
        );
        await sendConfiguredSteps(convo, pasos as never);
        marcarAvisoDeNovedad(convo.id);
        burbujasDeLaTuberiaVieja.set(
          convo.id,
          new Set(
            fichasVisitadas(convo.id).flatMap((id) => pasosActivos(t.fichas.find((x) => x.id === id)?.steps).map(huellaDeLaBurbuja))
          )
        );
        console.log(`[tablero] convo ${convo.id}: estaba en la tubería vieja → le cuento que ahora hay más y pasa a la nueva`);
        await irA(convo.id, t, vieja.inicio.id);
        return true;
      }
      // COMO OB, en silencio (como el automático: «no al pasar a COMO OB», el segundo es oculto): pasa a la
      // presentación nueva sin mandarla —ya vio ese producto— y su mensaje lo atiende la ruta nueva.
      marcarAvisoDeNovedad(convo.id);
      moverA(convo.id, vieja.presentacion.id);
      anotarPresentados(convo.id, vieja.presentacion.presenta ?? []);
      console.log(`[tablero] convo ${convo.id}: estaba en la tubería vieja → pasa a la nueva en silencio (order bump, o nada nuevo que contar)`);
      estado = estadoEnElTablero(convo.id)!;
    }
  }

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
    // EL PAGO DE LO QUE SE LE OFRECIÓ Y NO COMPRÓ, sin cobro abierto (27/10/2026, su prueba HOLA1): el
    // upsell se ofreció, el silencio lo llevó al regalo y él pagó sin decir «sí». Como la venta de
    // siempre (`esperaPagoDelUpsell`), ese comprobante se cobra contra lo ofrecido: se busca, desde las
    // fichas por las que pasó (la más reciente primero), un cobro con ese precio de un producto que
    // AÚN NO COMPRÓ, se abre callado y se lee contra él. Antes lo atendía el motor de siempre con su
    // «Tu pago ya está confirmado», sin mirarlo. Solo se lee la imagen si queda algo por comprar
    // (la captura del comentario del regalo, sin nada pendiente, ni se lee).
    if (t && !estado.cobro_ficha_id && hayComprobantePendiente(convo.id, estado.comprobante_leido)) {
      const comprados = new Set<string>([
        ...comprasDelCliente(convo.id).map((c) => c.producto_id ?? ""),
        ...entregasDelCliente(convo.id).map((k) => k.split("#")[0]),
      ].filter(Boolean));
      const visitadas = fichasVisitadas(convo.id).filter((id) => t.fichas.find((x) => x.id === id)?.tipo !== "regalo");
      const quedaPorComprar = alcanzables(t, visitadas).some((id) => {
        const f = t.fichas.find((x) => x.id === id);
        return f?.tipo === "cobro" && !f.apagada && f.cobro?.modo === "producto" && [f.cobro.producto_id, ...(f.cobro.acepta ?? [])].some((p) => !!p && !comprados.has(p));
      });
      if (quedaPorComprar) {
        marcarComprobanteLeido(convo.id, idDelComprobantePendiente(convo.id));
        const lectura = await leerComprobante(convo.id);
        if (!lectura) return false; // no es un comprobante (la captura del comentario): del regalo
        const regaloId = estado.ficha_id;
        // Primero lo que puede comprar, con su precio de HOY para él (el upgrade cuesta la diferencia: su $1).
        const porMonto = loQuePuedeComprar(convo, t, pais).find((o) => Math.abs(o.precio - lectura.monto) < 0.01);
        let encaja: FichaDelTablero | null = porMonto?.ficha ?? null;
        if (!encaja)
          for (const id of visitadas) {
            encaja = cobroQueEncajaConElPago(t, [id], lectura.monto, pais, comprados);
            if (encaja) break;
          }
        if (encaja) {
          console.log(`[tablero] convo ${convo.id}: comprobante de ${lectura.monto} durante el regalo → «${encaja.titulo || encaja.id}» (lo ofrecido${porMonto?.upgrade ? ", upgrade" : ""})`);
          await irA(convo.id, t, encaja.id, 0, { enSilencio: true, upgrade: !!porMonto?.upgrade });
          // Sigue en el regalo: su ficha vuelve a ser la del regalo («Al terminar el regalo» sale de ahí).
          moverA(convo.id, regaloId);
          const abierto = estadoEnElTablero(convo.id);
          if (abierto?.cobro_ficha_id === encaja.id) {
            await atenderComprobante(convo, t, abierto, lectura);
            return true;
          }
        }
        // Ninguno encaja (o es el mismo comprobante de su compra): lo revisa la regla de los repetidos y,
        // si no, se te avisa. Nunca el «ya está confirmado» del motor de siempre sin mirarlo.
        const huellaLeida = huellaDelPago(lectura);
        const clave = huellaLeida && convo.channel === "test" ? `${huellaLeida}#c${convo.id}` : huellaLeida;
        if (clave && quienRegistroLaHuella(clave) === convo.id) {
          console.log(`[tablero] convo ${convo.id}: durante el regalo reenvió el comprobante de su compra`);
          await contestarConIA(convo, t, "Reenvió el comprobante de la compra que ya pagó y recibió. Dile con amabilidad que ese pago ya está registrado y su material ya le llegó más arriba (si no lo ve, que te avise y se lo reenvías). No pidas nada más.");
          return true;
        }
        console.log(`[tablero] convo ${convo.id}: comprobante de ${lectura.monto} durante el regalo, no encaja con nada ofrecido → aviso al dueño`);
        if (convo.channel !== "test")
          void notifyAdmin(
            `🧾 *Tablero:* ${convo.client_name ?? convo.name ?? convo.phone} mandó un comprobante de ${lectura.monto} durante el regalo que no encaja con nada ofrecido. Revísalo en el chat.`
          ).catch(() => {});
        // CON TEXTO FIJO (28/10/2026, ronda 11: con la nota, la IA le pidió «la foto» que acababa de mandar).
        await sendConfiguredSteps(convo, [{ type: "text", body: "Recibí tu comprobante 🙏 Un asesor lo revisa y te confirma por aquí enseguida 😊" }] as never);
        return true;
      }
    }
    // DIJO QUE NO AL REGALO Y DESPUÉS LO PIDE (28/10/2026, ronda 8 en la copia: «Por ahora no» → «bueno si lo
    // quiero el regalo» → la IA le habló de sus carpetas de Drive). Si ya se le ofreció y lo pide claramente, se le
    // da, con la función de la venta de siempre (`acceptGiftConsent`, que no lo manda dos veces).
    {
      const n = sinTildes(contenido).replace(/[^a-zñ\s]/g, " ").replace(/\s+/g, " ").trim();
      const fresca = getConversationById(convo.id) ?? convo;
      if (
        t &&
        fresca.state === "payment_approved" &&
        /\bregal(o|ito)\b/.test(n) &&
        /\b(si|quiero|dame|acepto|mandame|enviame|pasame)\b/.test(n) &&
        !/\b(no|que|como|cual|cuando|donde)\b/.test(n) &&
        fichasVisitadas(convo.id).some((id) => t.fichas.find((x) => x.id === id)?.tipo === "regalo") &&
        !muestrasEnviadas(estadoEnElTablero(convo.id)).includes(REGALO_HECHO)
      ) {
        const { acceptGiftConsent } = await import("@/lib/workflow/engine");
        // El envío del regalo sale solo desde «esperando su respuesta» (ronda 9: desde «pago aprobado» se programó
        // y no salió nada): se le devuelve a ese paso, como si contestara ahora a la oferta.
        setConversationState(convo.id, "awaiting_gift_consent");
        acceptGiftConsent(getConversationById(convo.id) ?? fresca);
        anotarMuestras(convo.id, [REGALO_HECHO]);
        console.log(`[tablero] convo ${convo.id}: había dicho que no al regalo y ahora lo pide → se le da`);
        return true;
      }
    }
    // «SÍ» A LO QUE LA IA ACABA DE OFRECER, CON SU COBRO YA ABIERTO (28/10/2026, ronda 4 en la copia: dijo «sí»
    // al upsell, luego «mejor no», llegó el regalo, preguntó «¿y lo de las citas?», la IA se lo ofreció y su
    // «sí» aceptó el regalo). Si el último turno del bot propuso un producto (nombre y precio) y no el regalo,
    // el «sí» es para ése: sus datos otra vez, y el regalo queda pendiente.
    if (
      t &&
      estado.cobro_ficha_id &&
      contenido.trim() &&
      !contenido.startsWith("bubble:") &&
      !hayComprobantePendiente(convo.id, estado.comprobante_leido) &&
      AFIRMA.test(sinTildes(contenido).replace(/[^a-zñ\s]/g, " ").replace(/\s+/g, " ").trim())
    ) {
      const propuesto = loQueAcabaDeProponer(convo, t, pais);
      if (propuesto) {
        console.log(`[tablero] convo ${convo.id}: «sí» en el regalo a lo que la IA ofreció («${propuesto.nombre}») → su cobro`);
        await abrirLoQuePuedeComprar(convo, t, propuesto);
        return true;
      }
    }
    // QUIERE PAGAR ALGO MÁS, ESTANDO EN EL REGALO («quiero pagar eso de mascotas», «puedo completar»).
    if (t && !estado.cobro_ficha_id && contenido.trim() && !contenido.startsWith("bubble:") && !hayComprobantePendiente(convo.id, estado.comprobante_leido)) {
      if (await comprarDespuesDeComprar(convo, t, contenido, pais, true)) return true;
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
    // «NO ME LLEGÓ» EN EL REGALO (H4, 27/10/2026): como la venta de siempre en ese paso (primero el regalo,
    // después su detector), reenvío directo; antes contestaba la IA, sin poder reenviar.
    if (reenviarSiLoPide(convo, contenido)) {
      recordarElRegaloUnaVez(convo.id);
      return true;
    }
    // «QUIERO COMPLETAR» EN EL REGALO (28/10/2026, su conversación 98: «puedo completar para el otro» / «ya
    // pagué 3 pero hay uno que cuesta 4, quiero completar» → la IA, con la instrucción del regalo, no podía
    // ofrecer el upgrade y dijo «se paga aparte, $4»). Lo atiende el bot, como el automático: con otro
    // producto delante (el upsell, ofrecido o con su cobro abierto) pregunta «¿a cuál te refieres?»; si no,
    // abre el cobro de la diferencia. Sale del regalo (queda anotado: se le vuelve a ofrecer después).
    if (t && /\b(complet\w*|diferencia|lo que falta|el resto|pagar el resto)\b/.test(sinTildes(contenido))) {
      const opciones = loQuePuedeComprar(convo, t, pais);
      const ups = opciones.filter((o) => o.upgrade);
      if (ups.length > 0) {
        const aparte = opciones.filter((o) => !o.upgrade);
        if (convo.state === "awaiting_gift_consent") {
          anotarRegaloSinResponder(convo.id, convo.state);
          cancelPendingActionsForConvo(convo.id);
          setConversationState(convo.id, "tablero");
        }
        console.log(`[tablero] convo ${convo.id}: en el regalo pide completar → ${aparte.length ? "¿a cuál te refieres?" : `upgrade a «${ups[0].nombre}»`}`);
        if (aparte.length > 0) await preguntarACual(convo, [...ups, ...aparte], pais);
        else await abrirLoQuePuedeComprar(convo, t, ups[0], false);
        return true;
      }
    }
    // COMO LA VENTA DE SIEMPRE: contesta lo que preguntó y lo devuelve con amabilidad al regalo, que
    // sigue pendiente (25/10/2026, punto 10).
    // PREGUNTA POR UN PRODUCTO QUE PUEDE COMPRAR (28/10/2026, su UULA3: «cómo es eso de las 100 citas» → se lo
    // explicó y lo mandó a dejar el comentario del regalo, sin preguntarle si lo quería). Ahí se contesta y se
    // le pregunta si lo quiere; el regalo sigue pendiente y se le recuerda en otro momento.
    // (Sin la «s» final: «mascota» y «mascotas» cuentan como la misma palabra.)
    const palabrasDe = (s: string) =>
      sinTildes(s)
        .replace(/[^a-z0-9ñ\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 3 && !PALABRAS_COMUNES.has(w))
        .map((w) => (w.length > 4 ? w.replace(/s$/, "") : w));
    const dichas = new Set(palabrasDe(contenido));
    // Solo palabras que el regalo NO tiene («mascotas» está en JUEGOS PARA MASCOTAS y en 100 CITAS…).
    const palabrasDelRegalo = new Set(palabrasDe(textoDelRegalo(loadWorkflowConfig())));
    const deUnProducto = t
      ? loQuePuedeComprar(convo, t, pais).find((o) => palabrasDe(o.nombre).some((w) => !palabrasDelRegalo.has(w) && dichas.has(w)))
      : undefined;
    const vuelta = deUnProducto
      ? `Pregunta por *${deUnProducto.nombre}*, que puede comprar aparte. Contesta lo que pregunta de ese producto y termina preguntándole, con tus palabras, si desea adquirirlo. En esta respuesta no hables del regalo.`
      : convo.state === "awaiting_gift_consent"
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
    // UN COMPROBANTE YA USADO, sin cobro abierto (E1 en la copia, 27/10/2026): volvió a mandar el de su
    // compra y la IA dijo «ya lo recibí, un asesor lo revisa». Con el texto fijo de siempre, como con el
    // cobro abierto (misma regla de la huella: en el simulador, por ventana).
    const huellaLeida = lectura ? huellaDelPago(lectura) : null;
    const claveHuella = huellaLeida && convo.channel === "test" ? `${huellaLeida}#c${convo.id}` : huellaLeida;
    if (claveHuella && quienRegistroLaHuella(claveHuella)) {
      console.log(`[tablero] convo ${convo.id}: sin cobro abierto mandó un comprobante ya usado (${claveHuella})`);
      await sendConfiguredSteps(convo, [
        { type: "text", body: "Este comprobante ya fue usado y está registrado ✅ Si hiciste un pago nuevo, envíame la foto de *ese* comprobante, por favor 😊" },
      ] as never);
      return true;
    }
    // EL COBRO QUE ENCAJA CON SU MONTO, desde donde está (lo que hacía la «Caja abierta»).
    // Lo que puede comprar después de comprar, con su precio de hoy (el upgrade cuesta la diferencia).
    const porMonto = lectura ? loQuePuedeComprar(convo, t, pais).find((o) => Math.abs(o.precio - lectura.monto) < 0.01) : undefined;
    const encaja = lectura
      ? porMonto?.ficha ?? cobroQueEncajaConElPago(t, [estado.ficha_id, ...(estado.seg_ficha ? [estado.seg_ficha] : [])], lectura.monto, pais)
      : null;
    if (lectura && encaja) {
      await irA(convo.id, t, encaja.id, 0, { enSilencio: true, upgrade: !!porMonto?.upgrade });
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
      // CON TEXTO FIJO (28/10/2026, ronda 11: con la nota, la IA le pidió «la foto del comprobante» que acababa de mandar).
      await sendConfiguredSteps(convo, [{ type: "text", body: "Recibí tu comprobante 🙏 Un asesor lo revisa y te confirma por aquí enseguida 😊" }] as never);
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

  // 1-ter. EL RECLAMO DE LO QUE YA COMPRÓ VA PRIMERO (29/10/2026, sus conversaciones 118, 119 y 120): con el
  // upsell en pantalla («¿lo agregas? sí o no») o su cobro abierto, «no me ha llegado lo que pagué» se leía
  // como el «no» del upsell, o la IA pedía el comprobante del upsell; y el «si» a «¿quieres que te lo
  // reenvíe?» aceptaba el upsell y le mandaba los datos de pago. Ahora, si ya compró algo y reclama lo que
  // pagó, se le reenvía; el upsell sigue en pie (un «sí» o un «no» a él funcionan igual que antes).
  // (Pedir los DATOS de pago no es reclamar el material: «pásame el yape otra vez» le reenviaba las muestras
  // gratis de FIGURARTE en vez de la cuenta — ronda 47 en la copia. Eso lo atiende el cobro, como antes.)
  const pideLosDatos = !!metodoDicho || /\b(cuenta|numero|datos|cbu|alias|donde (te )?(pago|deposito|yapeo))\b/.test(normal);
  if (texto && !pendiente && !pideLosDatos && entregasDelCliente(convo.id).length > 0) {
    if (reenviarSiLoPide(convo, texto)) {
      respondio(convo, t);
      return true;
    }
    // «YA PAGUÉ» SIN FOTO Y SIN NADA POR PAGAR (29/10/2026, ronda 45 en la copia: «cuándo me vas a enviar / ya
    // pagué» → la IA cerró con «¿te indico cómo adquirirlo?» y su «sí» le abrió el cobro del upsell): ya compró y
    // no le queda ningún cobro abierto, así que habla de lo que pagó. Se le reenvía.
    // Solo «ya pagué» suelto (en su propia línea, corto). «Yo ya pagué, ¿puedo completar para el otro?» (su 101) o
    // «con lo que pagué, ¿me llevo…?» son otra cosa y siguen su camino.
    const lineas = normal.split("\n").map((l) => l.replace(/[^a-zñ\s]/g, " ").replace(/\s+/g, " ").trim());
    const suelto = lineas.some((l) => YA_PAGO_SIN_FOTO.test(l) && l.split(" ").length <= 4);
    const otraCosa = /\b(complet\w*|diferencia|con (eso|ese|lo que)|tambien|llevar|llevo|el otro|lo otro)\b/.test(normal);
    if (!estado.cobro_ficha_id && suelto && !otraCosa) {
      console.log(`[tablero] convo ${convo.id}: «ya pagué» sin cobro abierto → reenvío de lo que compró`);
      reenviarLoDelTablero(convo, texto, true);
      respondio(convo, t);
      return true;
    }
    const corto = normal.replace(/[^a-zñ\s]/g, " ").replace(/\s+/g, " ").trim();
    if (AFIRMA.test(corto)) {
      // ¿Su «sí» contesta a «¿te lo reenvío?»? Se mira la última pregunta del bot (la de la IA).
      const alReves = [...ultimosMensajes(convo.id, 10)].reverse();
      const desde = alReves.findIndex((m) => m.role !== "user");
      const resto = desde < 0 ? [] : alReves.slice(desde);
      const hasta = resto.findIndex((m) => m.role === "user");
      const delBot = (hasta < 0 ? resto : resto.slice(0, hasta)).reverse().map((m) => m.content ?? "").join("\n");
      const pregunta = sinTildes(delBot.split(/(?<=[.!])\s+|\n/).filter((x) => x.includes("?")).pop() ?? "");
      if (/\breenv\w*|\b(envie|mande|pase)\s+(de nuevo|otra vez)\b/.test(pregunta)) {
        console.log(`[tablero] convo ${convo.id}: «${texto.slice(0, 20)}» a «¿te lo reenvío?» → reenvío`);
        reenviarLoDelTablero(convo, texto, true);
        respondio(convo, t);
        return true;
      }
    }
  }

  // 1-quater. EL UPSELL QUE TODAVÍA ESPERA SU TIEMPO (punto 9): no se ha presentado. Lo que escriba lo
  // contesta la IA sin hablar de él, y la espera vuelve a contar desde ahora.
  if (fichaAqui && estado.espera_ficha === fichaAqui.id && !contenido.startsWith("bubble:")) {
    // Pero si pide lo que compró o acepta algo que se le ofreció (A3 en la copia: la IA le describió 100
    // CITAS con su precio, dijo «sí» y la espera se lo tragaba), eso va primero, como en el resto.
    const textoAqui = contenido.trim();
    if (textoAqui && !estado.cobro_ficha_id && !hayComprobantePendiente(convo.id, estado.comprobante_leido)) {
      if (reenviarSiLoPide(convo, textoAqui)) return true;
      if (await comprarDespuesDeComprar(convo, t, textoAqui, pais, false, false)) return true;
    }
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
      // Un «sí» / «ok» corto lo decide el código, como el automático (28/10/2026, su prueba hou1: la IA leyó
      // «ok» como «ninguna», no salió la galería y la respuesta prometió «enseguida comparto las imágenes»).
      const corto = normal.replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();
      const aceptaClaro = AFIRMA.test(corto) || /^(a ver|muestra(me|las|melas)?|manda(me|las|melas)?|envia(me|las|melas)?|quiero verlas?|si quiero verlas?)$/.test(corto);
      const acepta = aceptaClaro
        ? "ver"
        : await elegirOpcionConIA(convo.id, texto, [
            { id: "ver", etiqueta: "Acepta ver las imágenes que se le acaban de ofrecer (sí, dale, a ver, ok, muéstramelas, un emoji de aprobación…)" },
          ]);
      if (acepta === "ver" && (await mandarLaGaleria(convo, t, pais))) {
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
    if (await mandarLaGaleria(convo, t, pais)) {
      respondio(convo, t);
      return true;
    }
  }

  // DESPUÉS DE COMPRAR, UN «SÍ» O UN «NO» CONTESTA LA ÚLTIMA PREGUNTA (29/10/2026, sus conversaciones 120 y la
  // ronda 42 en la copia): con el upsell en pantalla, la IA preguntó «¿ya pudiste verlo?» / «¿pudiste abrir el
  // enlace?», el cliente dijo «si» / «no» y los cuadritos Sí / No del upsell le cobraron 100 CITAS o lo
  // despidieron sin reenviarle nada. Si el último turno fue de la IA y no ofreció algo para comprar —o lo que
  // él dijo antes fue un reclamo de lo que pagó—, su sí/no es para la IA: no elige ninguna opción (ni por su
  // cuadrito, ni por la IA que elige). Y «quiero el regalo» no es aceptar el upsell (le mandaba sus datos de pago).
  // Solo con algo ya comprado: la venta de antes de comprar no cambia.
  const yaCompro = !!texto && entregasDelCliente(convo.id).length > 0;
  const suSiNoEsDeLaIA = (() => {
    if (!yaCompro) return false;
    const corto = normal.replace(/[^a-zñ\s]/g, " ").replace(/\s+/g, " ").trim();
    const afirma = AFIRMA.test(corto);
    if (!afirma && !/^(no|nop|nel|no gracias|ahora no|por ahora no|no por ahora|no quiero|no todavia)$/.test(corto)) return false;
    const antes = sinTildes(loQueDijoAntes(convo.id));
    if (afirma && antes && (pideLoQueCompro(antes) || YA_PAGO_SIN_FOTO.test(antes))) return true;
    if (laFichaHabloUltimo(convo.id, [fichaAqui, segAqui].filter((x): x is FichaDelTablero => !!x))) return false;
    const pregunta = ultimaPreguntaDelBot(convo.id);
    return !INVITA_A_COMPRAR.test(pregunta) && !/\bagreg|\blo agregas\b/.test(pregunta);
  })();
  const pideElRegalo = yaCompro && /\b(regal(o|ito)|obsequio)\b/.test(normal);
  if (suSiNoEsDeLaIA) console.log(`[tablero] convo ${convo.id}: «${texto.slice(0, 20)}» contesta a la IA, no a las opciones de la ficha`);
  // «QUIERO EL REGALO» ANTES DE QUE SE LE OFREZCA (ronda 45 en la copia): con el upsell en pantalla —que lleva un 🎁—
  // la IA creyó que el regalo era 100 CITAS y le dio su precio. Solo en ese turno se le dice qué es cada cosa.
  const regaloYaOfrecido = fichasVisitadas(convo.id).some((id) => t.fichas.find((x) => x.id === id)?.tipo === "regalo");
  if (pideElRegalo && !ESTADOS_DEL_REGALO.has(convo.state ?? "") && !regaloYaOfrecido) {
    respondio(convo, t);
    await contestarConIA(
      convo,
      t,
      "Pide el REGALO. El regalo es GRATIS y aparte: se le ofrece enseguida, después de esto, y no tiene que pagar nada por él. Lo que tiene en pantalla ahora (con su precio) NO es el regalo: es otro material opcional que se paga aparte. Díselo claro y corto, y pregúntale si le interesa ese material o prefiere pasar al regalo."
    );
    return true;
  }

  // 1-septies. MANDA LA FICHA DONDE ESTÁ (punto 15): si un cuadrito suyo —o de sus seguimientos
  // colgados— reconoce el mensaje, se sigue SU cable, antes que el cobro abierto de atrás. Y si el
  // mensaje nombra un método, queda anotado (punto 8): al elegir producto le llegan sus datos de frente.
  if (texto && !suSiNoEsDeLaIA) {
    for (const duena of [fichaAqui, segAqui]) {
      if (!duena || !(duena.tipo === "mensaje" || duena.tipo === "intro_ob" || duena.tipo === "seguimientos")) continue;
      const d = decisionQueCoincide(texto, opcionesDe(pasosDeLaFicha(duena)).cuadritos);
      if (!d || !cableDeLaSalida(t, duena.id, `dec:${d.id}`)) continue;
      // EL CANDADO DE LA ELECCIÓN (27/10/2026, su prueba H1): con un cobro abierto, un cuadrito que lleva
      // a pagar (otro Cobro o el Order bump) no se sigue: el cobro abierto atiende el método y el «quiero
      // pagar» con el producto que ELIGIÓ. Pasó: eligió el PACK, dijo «vecino», el cuadrito de método de
      // los seguimientos colgados lo llevó al Cobro del BÁSICO y le pidió el precio del básico. Como la
      // venta de siempre: con un producto elegido, el método manda los datos de ESE producto.
      const aDonde = t.fichas.find((x) => x.id === cableDeLaSalida(t, duena.id, `dec:${d.id}`)?.a);
      if (estado.cobro_ficha_id && (aDonde?.tipo === "cobro" || aDonde?.tipo === "intro_ob")) continue;
      // EL «SÍ» ES PARA LO ÚLTIMO QUE PROPUSO EL BOT (28/10/2026, su MM2): con el upsell en pantalla, la IA le
      // preguntó «¿te falta completar $1 para el PACK?», dijo «sí» y el cuadrito «Sí» del upsell lo llevó a
      // pagar 100 CITAS. Como el automático: si el último turno del bot propuso OTRO producto (nombre y
      // precio en la misma burbuja, con pregunta), un «sí» a secas no sigue este cuadrito.
      if (aDonde?.tipo === "cobro" && AFIRMA.test(normal.trim())) {
        const propuesto = loQueAcabaDeProponer(convo, t, pais);
        if (propuesto && propuesto.productoId !== aDonde.cobro?.producto_id) continue;
        // …NI CUANDO LO DE ANTES FUE UN RECLAMO (29/10/2026, su conversación 120): con el upsell en pantalla
        // dijo «cuándo me vas a enviar / ya pagué», la IA le preguntó «¿ya pudiste verlo?», dijo «si» y el
        // cuadrito «Sí» del upsell le mandó los datos para pagar 100 CITAS. Su «sí» contesta a su reclamo.
      }
      if (pideElRegalo && aDonde?.tipo === "cobro") continue;
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
  // Las opciones de la ficha donde está (y de sus seguimientos) que llevan a pagar: un Cobro o el Order bump.
  const opcionesDeCompra = () => {
    const duenas = [fichaAqui, segAqui].filter((x): x is FichaDelTablero => !!x);
    const haciaPagar = duenas.flatMap((duena) => {
      const { botones, cuadritos } = opcionesDe(pasosDeLaFicha(duena));
      return [
        ...botones.map((b) => ({ duena, salida: `btn:${b.id}`, boton: b.id as string | null, cuadrito: null as BubbleDecision | null })),
        ...cuadritos.map((d) => ({ duena, salida: `dec:${d.id}`, boton: null as string | null, cuadrito: d as BubbleDecision | null })),
        ...eligeDeLaFicha(duena).map((id) => ({ duena, salida: `elige:${id}`, boton: null as string | null, cuadrito: null as BubbleDecision | null })),
      ].filter((o) => {
        const destino = t.fichas.find((x) => x.id === cableDeLaSalida(t, duena.id, o.salida)?.a);
        return destino?.tipo === "cobro" || destino?.tipo === "intro_ob";
      });
    });
    const destinos = new Set(haciaPagar.map((o) => cableDeLaSalida(t, o.duena.id, o.salida)?.a));
    const cobros = [...destinos].map((id) => t.fichas.find((x) => x.id === id)).filter((x): x is FichaDelTablero => x?.tipo === "cobro");
    return { haciaPagar, destinos, soloCobros: cobros.length === destinos.size ? cobros : [] };
  };
  // Seguir una de esas opciones: un cuadrito (con sus burbujas), un botón o un «✍️ Si elige».
  const seguirLaOpcion = async (o: { duena: FichaDelTablero; salida: string; boton: string | null; cuadrito: BubbleDecision | null }) => {
    if (o.cuadrito) await actuarCuadrito(convo, t, o.duena, o.cuadrito);
    else {
      if (o.boton) apuntarBoton(convo.id, o.boton);
      await irA(convo.id, t, cableDeLaSalida(t, o.duena.id, o.salida)!.a);
    }
  };
  // «SÍ» A LO QUE PROPUSO EL BOT (27/10/2026), como la venta de siempre (`laPropuestaDelBotQueElClienteAfirmo`
  // y la afirmación a la pregunta de pago): si su última burbuja invitó a comprar y el cliente dice «sí»,
  // «dale», «ok»…, eso ES decidir. Si el bot propuso UN producto, ése; si hay una sola forma de comprar,
  // ésa (el Order bump o el Cobro); con dos o más, «¿Cuál eliges?». Lo resuelve el bot, no la IA (antes
  // la IA improvisaba los pasos y se quedaba en «Los métodos que tenemos son:»).
  // (Y CONTESTAR CON EL MÉTODO también es «sí» — 28/10/2026, ronda 1 en la copia: «el primero» → «queda en S/15,
  // ¿te lo preparo?» → «yape» → «¿Cuál eliges? 1… 2…», con la elección ya hecha. Solo si dijo el método y poco
  // más: «yape», «con yape», «por yape porfa». Queda anotado y sus datos salen de frente.)
  const soloElMetodo = !!metodoDicho && normal.replace(/[^a-z0-9ñ\s]/g, " ").split(/\s+/).filter(Boolean).length <= 3;
  if (
    texto &&
    !estado.cobro_ficha_id &&
    (soloElMetodo || (!metodoDicho && AFIRMA.test(normal.replace(/[^a-zñ\s]/g, " ").replace(/\s+/g, " ").trim())))
  ) {
    // Las últimas burbujas del bot (tras su pregunta puede venir otra sin pregunta, como las opciones).
    // (Se saltan los mensajes del cliente del final —su propio «sí»— y se toman las burbujas del bot de antes.)
    const alReves = [...ultimosMensajes(convo.id, 10)].reverse();
    const desde = alReves.findIndex((m) => m.role !== "user");
    const resto = desde < 0 ? [] : alReves.slice(desde);
    const hasta = resto.findIndex((m) => m.role === "user");
    const ultimaDelBot = (hasta < 0 ? resto : resto.slice(0, hasta)).reverse().map((m) => m.content ?? "").join("\n");
    const pregunta = sinTildes(ultimaDelBot.split(/(?<=[.!])\s+|\n/).filter((x) => x.includes("?")).pop() ?? "");
    if (pregunta && INVITA_A_COMPRAR.test(pregunta) && !/\b(foto|fotos|imagen|imagenes|muestra|muestras|video)\b/.test(pregunta)) {
      const { haciaPagar, destinos, soloCobros } = opcionesDeCompra();
      const nombreDelDestino = (o: (typeof haciaPagar)[number]) => {
        const d = t.fichas.find((x) => x.id === cableDeLaSalida(t, o.duena.id, o.salida)?.a);
        return d?.tipo === "cobro" ? producto(config, d.cobro?.producto_id)?.name ?? "" : "";
      };
      // El producto se busca en la pregunta; si no lo nombra («¿Te lo preparo?»), en el turno entero del bot.
      const nombrados = (donde: string) => haciaPagar.filter((o) => {
        const n = nombreDelDestino(o);
        return !!n && donde.includes(sinTildes(n));
      });
      const enLaPregunta = nombrados(pregunta);
      const propuestos = enLaPregunta.length ? enLaPregunta : nombrados(sinTildes(ultimaDelBot));
      const unoPropuesto = new Set(propuestos.map((o) => cableDeLaSalida(t, o.duena.id, o.salida)?.a)).size === 1;
      console.log(`[tablero] convo ${convo.id}: «${texto.slice(0, 20)}» a la invitación «${pregunta.slice(0, 60)}» → decide`);
      if (metodoDicho) setSelectedPaymentMethod(convo.id, metodoDicho);
      if (unoPropuesto) {
        await seguirLaOpcion(propuestos[0]);
        return true;
      }
      if (destinos.size === 1) {
        await seguirLaOpcion(haciaPagar[0]);
        return true;
      }
      if (soloCobros.length > 1) {
        await recordarLasOpciones(convo, t, soloCobros, metodoDicho);
        return true;
      }
    }
  }
  // Lo que dijo además de «quiero pagar / con yape / ¿cómo pago?»: si no queda nada, no dijo CUÁL.
  const loDemas = normal
    .replace(/[^a-z0-9ñ\s]/g, " ")
    .split(/\s+/)
    .filter(
      (w) =>
        w &&
        !/^(quiero|quisiera|deseo|puedo|voy|a|pagar|pago|pagare|pagaria|con|por|en|mi|el|la|lo|si|ok|dale|bueno|hola|metodo|mediante|via|ya|comprar|compro|comprarlo|adquirir|adquirirlo|llevar|llevarlo|me|como|donde|te|se|cuenta|numero|datos|de|para|pasame|mandame|enviame|procedo|paso|listo|ahora|hoy)$/.test(w)
    );
  if (metodoDicho && !estado.cobro_ficha_id) {
    setSelectedPaymentMethod(convo.id, metodoDicho);
    console.log(`[tablero] convo ${convo.id}: nombra el método «${metodoDicho}» → queda anotado`);
    const { haciaPagar, destinos, soloCobros } = opcionesDeCompra();
    // Solo si dijo NADA MÁS que el método («yape», «quiero pagar con yape»); «el pack con yape» sí elige.
    variasOpcionesDeCompra = destinos.size > 1 && loDemas.length <= 1;
    // «¿CUÁL ELIGES?», COMO LA VENTA DE SIEMPRE (27/10/2026): con dos o más productos por elegir, el
    // método no elige producto; se anota y se le recuerdan las opciones con su precio (texto fijo, sin IA).
    if (variasOpcionesDeCompra && soloCobros.length > 1) {
      await recordarLasOpciones(convo, t, soloCobros, metodoDicho);
      return true;
    }
    if (haciaPagar.length > 0 && destinos.size === 1) {
      await seguirLaOpcion(haciaPagar[0]);
      return true;
    }
  } else if (
    texto &&
    !estado.cobro_ficha_id &&
    QUIERE_PAGAR.test(normal) &&
    !/\bno (lo )?(quiero|voy a|puedo|deseo)\b/.test(normal) &&
    // Con UNA sola forma de comprar, lo que diga además no cambia nada: «no gracias, ya me dijiste lo
    // que incluye, quiero pagar por mercado pago» (27/10/2026, AR) se quedaba en la IA dos turnos.
    (loDemas.length === 0 || opcionesDeCompra().destinos.size === 1)
  ) {
    // «QUIERO PAGAR» SIN DECIR CUÁL (27/10/2026), en cualquier momento (tras un seguimiento, horas
    // después…): con dos o más productos por elegir, la IA ya no adivina (podía darle el barato); se le
    // recuerdan las opciones con su precio, como la venta de siempre. Y con UNA sola forma de comprar,
    // quererlo ES elegirla («quiero adquirirlo» suelta el Order bump).
    const { haciaPagar, destinos, soloCobros } = opcionesDeCompra();
    if (soloCobros.length > 1) {
      await recordarLasOpciones(convo, t, soloCobros, null);
      return true;
    }
    if (haciaPagar.length > 0 && destinos.size === 1) {
      await seguirLaOpcion(haciaPagar[0]);
      return true;
    }
  }

  // «YA PAGUÉ» SIN LA FOTO (27/10/2026), como la venta de siempre: con el cobro abierto y sin imagen, se le
  // pide el comprobante; no se le vuelve a vender ni se le mandan otra vez los datos.
  if (
    texto &&
    estado.cobro_ficha_id &&
    !pendiente &&
    YA_PAGO_SIN_FOTO.test(normal)
  ) {
    respondio(convo, t);
    // SI YA COMPRÓ ANTES (28/10/2026, su UULA2: «ya pagué 3, ¿con eso me das las 100 citas?» → «mándame la
    // foto», tres veces), su «ya pagué» puede ser ESE pago: se le aclara qué compró y que esto va aparte.
    const antes = comprasDelCliente(convo.id).filter((c) => c.producto_id);
    const loQueCompro = antes
      .map((c) => `${producto(config, c.producto_id)?.name ?? c.producto_id} (${formatCurrencyAmount(c.monto, pais as never)})`)
      .join(", ");
    await contestarConIA(
      convo,
      t,
      antes.length
        ? `Dice que ya pagó. OJO: ya compró antes ${loQueCompro}, pagado y entregado más arriba. Si se refiere a ESE pago (para llevarse lo que se le ofrece ahora con él), aclárale con amabilidad que ese pago fue por lo que ya tiene y que lo de ahora es otro material que se paga aparte. Solo si dice que hizo un pago NUEVO, pídele la foto del comprobante. No le mandes otra vez los datos.`
        : "Dice que ya pagó, pero todavía no llegó ninguna imagen de su comprobante. Agradécele y pídele con amabilidad que envíe la foto o captura del comprobante para validarlo y mandarle su material al instante. No le mandes otra vez los datos ni le vendas nada."
    );
    return true;
  }

  // «NO ME LLEGÓ / ¿CUÁNDO ME VAN A ENVIAR?» DESPUÉS DE COMPRAR (H2, 27/10/2026): reenvío directo con el
  // detector de la venta de siempre, sin esperar a que la IA lo decida.
  if (texto && !estado.cobro_ficha_id && !pendiente && reenviarSiLoPide(convo, texto)) return true;
  // «EL REGALO» CON SU REGALO AÚN SIN RESPONDER (H5, 27/10/2026): salió del regalo para pagar otra cosa y
  // después pidió el regalo; la IA le dijo «completa el pago y recibirás tu regalo» (el regalo no depende
  // de pagar nada). Si lo pide (no si pregunta qué es), se le da, con la función de la venta de siempre.
  if (
    texto &&
    !pendiente &&
    regaloPorVolverAOfrecer(convo.id) &&
    /\b(regalo|regalito|obsequio)\b/.test(normal) &&
    !/\b(que|como|cual|cuanto|porque|por que)\b/.test(normal) &&
    !/\bno\b/.test(normal)
  ) {
    const { acceptGiftConsent } = await import("@/lib/workflow/engine");
    acceptGiftConsent(getConversationById(convo.id) ?? convo);
    anotarMuestras(convo.id, [REGALO_HECHO]);
    console.log(`[tablero] convo ${convo.id}: pidió su regalo pendiente → se le da (el cobro sigue abierto)`);
    return true;
  }
  // QUIERE PAGAR ALGO MÁS DESPUÉS DE COMPRAR (el upsell, completar al full): lo resuelve el bot.
  if (texto && !estado.cobro_ficha_id && (comprasDelCliente(convo.id).length > 0 || entregasDelCliente(convo.id).length > 0)) {
    if (await comprarDespuesDeComprar(convo, t, contenido, pais, false, opcionesDeCompra().haciaPagar.length > 0)) return true;
  }
  // «COMPLETAR PARA EL OTRO» CON OTRO COBRO ABIERTO (28/10/2026, su HHH1): ya compró, tiene abierto el cobro
  // del upsell y pide completar → «¿a cuál te refieres?» (el que se completa / el que va aparte), y su
  // respuesta a esa pregunta. Antes lo contestaba la IA y le cobraba el upsell entero. No con un pago a
  // medias en este cobro: ahí «completo lo que falta» es de ESTE cobro.
  if (
    texto &&
    estado.cobro_ficha_id &&
    !pendiente &&
    estado.cobro_pagado <= 0 &&
    (comprasDelCliente(convo.id).length > 0 || entregasDelCliente(convo.id).length > 0)
  ) {
    const ultimaDelBot = [...ultimosMensajes(convo.id, 6)].reverse().find((m) => m.role !== "user")?.content ?? "";
    if (/\b(completar|la diferencia|el resto|lo que falta)\b/.test(normal) || ultimaDelBot.startsWith(PREGUNTA_A_CUAL)) {
      if (await comprarDespuesDeComprar(convo, t, contenido, pais, false, false, estado.cobro_ficha_id)) {
        respondio(convo, t);
        return true;
      }
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
        // «EL PRIMERO» / «EL 2» (28/10/2026, ronda 6 en la copia: eligió el PACK con su botón, dijo «mejor el
        // primero», la IA contestó «te quedas con el RECETARIO a S/15» y los datos salieron por S/20). Se busca la
        // última lista numerada que mostró el bot («1️⃣ … *NOMBRE*», «2️⃣ … *NOMBRE*») y ése es el elegido.
        const porNumero = (() => {
          const n = sinTildes(contenido);
          // Una PREGUNTA no elige («¿y el primero cuánto era?», ronda 9: le cambió el producto y le mandó los datos).
          if (/[?¿]/.test(contenido) || /\b(cuanto|cuesta|costo|vale|valia|precio|era|que trae|que tiene|como es|cual es)\b/.test(n)) return null;
          const quiere1 = /\b(primer[oa]?|opcion 1|el 1|la 1)\b|^\s*1\s*$/.test(n);
          const quiere2 = /\b(segund[oa]|opcion 2|el 2|la 2)\b|^\s*2\s*$/.test(n);
          if (quiere1 === quiere2) return null;
          const delBot = ultimosMensajes(convo.id, 20).filter((m) => m.role !== "user").map((m) => m.content ?? "").reverse();
          for (const tx of delBot) {
            const m1 = tx.match(/1️⃣[^\n*]*\*([^*\n]+)\*/);
            const m2 = tx.match(/2️⃣[^\n*]*\*([^*\n]+)\*/);
            if (!m1 || !m2) continue;
            const nombre = sinTildes((quiere1 ? m1[1] : m2[1]).trim());
            return opciones.find((id) => sinTildes(producto(config, id)?.name ?? "") === nombre) ?? null;
          }
          return null;
        })();
        if (porNumero) console.log(`[tablero] convo ${convo.id}: «${contenido.slice(0, 25)}» → ${porNumero} (por el número de la lista)`);
        // «EL OTRO» CON DOS EN EL COBRO (29/10/2026, su conversación 113: «no mejor el otro» + «no me alcanza»
        // con el PACK elegido; la IA leyó el «no» del principio como rechazo y contestó «ninguna»). Con dos
        // opciones y una elegida, «el otro» es la que no tiene: lo resuelve el bot. No cuenta si lo pregunta,
        // si lo rechaza («no quiero el otro») ni si quiere los dos («el otro también»).
        const porOtro = (() => {
          if (porNumero || opciones.length !== 2 || !elegidoId || !opciones.includes(elegidoId)) return null;
          const n = sinTildes(contenido);
          if (!/\b(el|la|lo|al|del|ese|esa) otr[oa]\b/.test(n)) return null;
          if (/[?¿]/.test(contenido) || /\b(cuanto|cuesta|costo|vale|valia|precio|que trae|que tiene|como es|cual es|tambien)\b/.test(n)) return null;
          if (/\bno (lo |la )?(quiero|deseo|necesito|me interesa|me gusta)\b/.test(n)) return null;
          return opciones.find((id) => id !== elegidoId) ?? null;
        })();
        if (porOtro) console.log(`[tablero] convo ${convo.id}: «${contenido.slice(0, 25)}» → ${porOtro} (el otro de los dos)`);
        const decide = porNumero ?? porOtro ?? await elegirOpcionConIA(
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
    let escrito = porNumero ?? porTexto;
    // (El mismo candado que el del cuadrito, 28/10/2026, su MM2: «sí» escrito a OTRA cosa que el bot acaba de
    // proponer no es tocar el «Sí» de antes.)
    if (escrito && !porNumero && ficha) {
      const destino = t.fichas.find((x) => x.id === cableDeLaSalida(t, ficha.id, `btn:${escrito!.id}`)?.a);
      const propuesto = destino?.tipo === "cobro" ? loQueAcabaDeProponer(convo, t, getEffectiveCountryCode(convo.phone, loadWorkflowConfig())) : null;
      if (propuesto && propuesto.productoId !== destino?.cobro?.producto_id) escrito = undefined;
    }
    if (escrito) contenido = `bubble:${escrito.id}`;
    // «BUENO SÍ QUIERO» DESPUÉS DE DECIR QUE NO (28/10/2026, ronda 6 en la copia: tocó «No, gracias», escribió
    // «bueno si quiero», la IA le prometió «te lo hago llegar» y nada salió). Si está en una ficha SIN salida (la
    // despedida) y acepta, vale como tocar el «Sí» de la ficha anterior con botones.
    else if (botones.length === 0 && ficha && !t.cables.some((c) => c.de === ficha.id)) {
      const n = sinTildes(contenido).replace(/[^a-zñ\s]/g, " ").replace(/\s+/g, " ").trim();
      const acepta = /^(bueno |ok |ya |entonces |ahora |mejor )?(si|acepto|quiero)( (quiero|acepto|dale|porfa|por favor|lo quiero|los quiero|el material))*$/.test(n);
      if (acepta) {
        // (Ya vienen de la más reciente a la más antigua.)
        for (const id of fichasVisitadas(convo.id).filter((x) => x !== ficha.id)) {
          const anterior = t.fichas.find((x) => x.id === id);
          const suyos = anterior ? opcionesDe(pasosDeLaFicha(anterior)).botones : [];
          if (suyos.length === 0) continue;
          const si = suyos.find((b) => /^(si|acepto|quiero)\b/.test(sinTildes(b.label ?? "")));
          if (si) {
            console.log(`[tablero] convo ${convo.id}: «${contenido.slice(0, 25)}» tras decir que no → el «${si.label}» de «${anterior?.titulo || id}»`);
            contenido = `bubble:${si.id}`;
          }
          break;
        }
      }
    }
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
    // EL CANDADO DE LA ELECCIÓN: con un cobro abierto, lo que lleva a pagar otra cosa solo se sigue si
    // el cliente lo NOMBRA (o toca su botón, arriba). Ni un cuadrito de palabras sueltas ni la IA
    // adivinando lo mueven de lo que eligió (el cambio de producto dentro del cobro va en 2-bis).
    const conCobroAbierto = !!estado.cobro_ficha_id;
    const llevaAPagar = (duena: FichaDelTablero, salida: string) => {
      const a = t.fichas.find((x) => x.id === cableDeLaSalida(t, duena.id, salida)?.a);
      return a?.tipo === "cobro" || a?.tipo === "intro_ob";
    };
    // 5. UN CUADRITO, por sus palabras: sus burbujas, y luego su cable.
    if (!contenido.startsWith("bubble:") && !suSiNoEsDeLaIA)
      for (const duena of duenas) {
        const decision = decisionQueCoincide(contenido, opcionesDe(pasosDeLaFicha(duena)).cuadritos);
        if (decision && conCobroAbierto && llevaAPagar(duena, `dec:${decision.id}`)) continue;
        if (decision && pideElRegalo && llevaAPagar(duena, `dec:${decision.id}`)) continue;
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
        // «✍️ Si elige X»: el producto por su nombre y sus alias.
        ...eligeDeLaFicha(duena).map((id) => ({
          duena,
          op: { id: `elige:${id}`, etiqueta: producto(config, id)?.name ?? id, palabras: producto(config, id)?.aliases } as OpcionParaLaIA,
          d: null as BubbleDecision | null,
        })),
      ];
    });
    if (!contenido.startsWith("bubble:") && lista.length > 0 && !variasOpcionesDeCompra && !suSiNoEsDeLaIA && !pideElRegalo) {
      // POR SU PALABRA, SIN IA (27/10/2026): si escribió una palabra que solo tiene UNA de las opciones
      // (en su texto o en el nombre de su producto: «pack», «básico»), es ésa. «el pack» a veces se le
      // escapaba a la IA. Si no, decide la IA («el combo», «el que trae la ropa»…).
      const palabrasDe = (x: (typeof lista)[number]) => {
        const destino = t.fichas.find((f) => f.id === cableDeLaSalida(t, x.duena.id, x.op.id)?.a);
        const p = destino?.tipo === "cobro" ? producto(config, destino.cobro?.producto_id) : x.op.id.startsWith("elige:") ? producto(config, x.op.id.slice(6)) : null;
        // Con el cobro abierto, una opción que lleva a pagar solo se reconoce por el NOMBRE de su producto
        // (no por las palabras de su cuadrito: «vecino» es un método, no un producto).
        // Y un CUADRITO no se reconoce por una palabra suelta de su lista («como» de «cómo pago»): sus frases
        // ya se miran enteras en el paso 5. Aquí cuenta solo el nombre de su producto (27/10/2026: «no sé si
        // es estafa, como que no confío» soltaba el order bump por la palabra «como»).
        const texto = (conCobroAbierto || x.d) ? (p ? p.name ?? "" : "") : [x.op.etiqueta, p?.name ?? ""].join(" ");
        return new Set(
          sinTildes(texto)
            .replace(/[^a-z0-9ñ\s]/g, " ")
            .split(/\s+/)
            .filter((w) => w.length >= 3 && !PALABRAS_COMUNES.has(w))
        );
      };
      // Por DESTINO (la misma opción en la ficha y en sus seguimientos lleva al mismo sitio: cuenta una vez).
      const destinoDe = (x: (typeof lista)[number]) => cableDeLaSalida(t, x.duena.id, x.op.id)?.a ?? x.op.id;
      const destinos = [...new Set(lista.map(destinoDe))];
      const conjuntos = destinos.map((d) => new Set(lista.filter((x) => destinoDe(x) === d).flatMap((x) => [...palabrasDe(x)])));
      // («elpack», «elbasico» escrito junto también cuenta, 28/10/2026, su MM2: solo si lo que queda tiene 4+ letras.)
      const dichas = new Set(
        sinTildes(contenido)
          .replace(/[^a-z0-9ñ\s]/g, " ")
          .split(/\s+/)
          .flatMap((w) => [w, w.replace(/^(el|la|los|las)(?=[a-zñ]{4,}$)/, "")])
      );
      const unicas = conjuntos.map((s, i) => [...s].filter((w) => conjuntos.every((o, j) => j === i || !o.has(w))));
      const acertados = destinos.filter((_, i) => unicas[i].some((w) => dichas.has(w)));
      // UNA PREGUNTA NO ELIGE («¿cuánto cuesta el pack?», «¿qué trae el básico?»): ésa la contesta la IA.
      const esPregunta = /\?|¿/.test(contenido) || /^(que|cual|cuanto|cuantos|como|donde|cuando|por que|tiene|trae|incluye)\b/.test(sinTildes(contenido.trim())) || /\b(precio|cuesta|vale|costo|valor)\b/.test(sinTildes(contenido));
      const porPalabra = acertados.length === 1 && !esPregunta ? lista.filter((x) => destinoDe(x) === acertados[0]).slice(0, 1) : [];
      // POR SU PRECIO, SIN IA (29/10/2026, ronda 41 en la copia): «el de 2» con «Solo el básico · $2» y «Quiero el
      // pack · $3» → la IA solo veía el texto de los botones y leyó «2» como la opción 2 (le cobró el pack). Si nombra
      // un monto («el de 2», «el que cuesta 2», «el de 2 dolares») y es el precio de UNA sola opción, es ésa. «El 2» a
      // secas no es un monto: sigue como siempre.
      const porPrecio = (() => {
        if (porPalabra.length === 1 || conCobroAbierto) return [];
        const n = sinTildes(contenido);
        if (/\?|¿/.test(contenido) || /\b(cuanto|que trae|que tiene|que incluye)\b/.test(n)) return [];
        const m =
          n.match(/\b(?:de|cuesta|vale|a|por)\s+\$?\s*(\d+(?:[.,]\d+)?)(?![\d.,])/) ??
          n.match(/\b(\d+(?:[.,]\d+)?)\s*(?:dolar|dolares|soles|sol|pesos|usd)\b/);
        if (!m) return [];
        const monto = Number(m[1].replace(",", "."));
        const conEse = destinos.filter((d) => {
          const x = lista.find((y) => destinoDe(y) === d);
          const destino = t.fichas.find((f) => f.id === d);
          const p = destino?.tipo === "cobro" ? producto(config, destino.cobro?.producto_id) : x?.op.id.startsWith("elige:") ? producto(config, x.op.id.slice(6)) : null;
          return !!p && precioDelProducto(p, pais, estado?.oferta === 1) === monto;
        });
        return conEse.length === 1 ? lista.filter((x) => destinoDe(x) === conEse[0]).slice(0, 1) : [];
      })();
      if (porPrecio.length === 1) console.log(`[tablero] convo ${convo.id}: «${contenido.slice(0, 30)}» → ${porPrecio[0].op.id} (por su precio)`);
      // Con el cobro abierto, la IA no elige por él: solo vale lo que nombró (el candado).
      const elegida =
        porPalabra.length === 1
          ? porPalabra[0].op.id
          : porPrecio.length === 1
            ? porPrecio[0].op.id
          : conCobroAbierto
            ? null
            : await elegirOpcionConIA(convo.id, contenido, lista.map((x) => x.op));
      if (porPalabra.length === 1) console.log(`[tablero] convo ${convo.id}: «${contenido.slice(0, 30)}» → ${elegida} (por su palabra)`);
      const cual = lista.find((x) => x.op.id === elegida);
      // ELIGIÓ JUSTO DESPUÉS DE PREGUNTAR EL PRECIO (27/10/2026), como la venta de siempre
      // (`askOrderBumpPurchaseConfirm`): primero se le confirma el precio y se le pregunta si lo quiere;
      // su «sí» lo lleva (lo atiende «sí a lo que propuso el bot»). Solo si lo escribió (no un botón).
      if (cual) {
        const destino = t.fichas.find((x) => x.id === cableDeLaSalida(t, cual.duena.id, cual.op.id)?.a);
        const delCliente = ultimosMensajes(convo.id, 6).filter((m) => m.role === "user");
        const anterior = sinTildes(delCliente[delCliente.length - 2]?.content ?? "");
        const preguntoPrecio = /\b(precio|cuesta|vale|costo|valor|cuanto (es|sale|seria)|a cuanto)\b/.test(anterior);
        if (destino?.tipo === "cobro" && preguntoPrecio && !cual.d) {
          const p = producto(config, destino.cobro?.producto_id);
          const pais = getEffectiveCountryCode(convo.phone, config);
          const precio = p ? precioDelProducto(p, pais, estado.oferta === 1) : null;
          if (p) {
            await sendConfiguredSteps(convo, [
              { type: "text", body: `¡Perfecto! 😊 *${p.name}* queda en *${precio ? formatCurrencyAmount(precio, pais as never) : "su precio"}*.\n\n¿Te lo preparo?` },
            ] as never);
            respondio(convo, t);
            console.log(`[tablero] convo ${convo.id}: eligió «${p.name}» tras preguntar el precio → le confirmo y pregunto`);
            return true;
          }
        }
      }
      if (cual?.d) {
        await actuarCuadrito(convo, t, cual.duena, cual.d);
        return true;
      }
      if (cual) {
        const cable = cableDeLaSalida(t, cual.duena.id, cual.op.id);
        // Nombró lo que YA tiene elegido, con su cobro abierto: no se reabre (perdería lo pagado); contesta la IA.
        if (cable && cable.a === estado.cobro_ficha_id) {
          // (sigue abajo: la IA le contesta desde donde va)
        } else if (cable) {
          if (cual.op.id.startsWith("btn:")) apuntarBoton(convo.id, cual.op.id.slice(4));
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
  // (28/10/2026: él lo confirmó así. Reiniciar el 2, que va a horas, lo empujaría fuera de su horario,
  // hasta el día siguiente. Lo que sí se evita es que caiga encima de un mensaje: ver ACCION_SEGUIMIENTO.)
  // EN EL SIMULADOR, TODOS (28/10/2026, él lo pidió): ahí no hay horas fijas, todos van a sus minutos, y para
  // testear necesita que el 2 también espere si el cliente escribe. En vivo sigue la regla de arriba.
  if (e.seg_idx >= 1 && convo.channel !== "test") return;
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
  return conSuPrecio(accion.conversation_id, () => ejecutarAccionDelTableroDentro(accion));
}

async function ejecutarAccionDelTableroDentro(accion: ScheduledActionRow): Promise<void> {
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
    // ACABA DE ESCRIBIR Y SU TURNO AÚN NO SE ATIENDE (28/10/2026, su prueba hou2: dijo «si» un segundo antes
    // y el seguimiento 2 salió encima de la respuesta). El bot espera unos segundos para juntar sus mensajes;
    // al atenderlo, el seguimiento vuelve a contar. Por si ese turno no lo mueve, se mira otra vez en 1 min.
    if (idx < segs.length && (getLastUserMessageTime(convo.id) ?? 0) >= ahora() - 45) {
      console.log(`[tablero] convo ${convo.id}: acaba de escribir → el seguimiento ${idx + 1} espera`);
      programar(fresca, ACCION_SEGUIMIENTO, { ficha, idx, token: payload.token }, ahora() + 60, true);
      return;
    }
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
      // BURBUJA POR BURBUJA, mirando antes de cada una que sigan puestos (27/10/2026, HEA1 en la copia):
      // con la tanda de corrido, si pagaba mientras salía, la entrega quedaba en medio y después llegaba
      // el resto del seguimiento («ELIGE UN MÉTODO DE PAGO» tras «¡PAGO RECIBIDO!»).
      // Y si ESCRIBIÓ mientras salía (B2 en la copia: el seguimiento 2 se mezcló con la respuesta de la
      // IA), lo que falta del seguimiento ya no sale: su mensaje manda.
      const empezo = ahora();
      for (const paso of pasosSeg as unknown[]) {
        const ahoraMismo = estadoEnElTablero(convo.id);
        const escribio = (getLastUserMessageTime(convo.id) ?? 0) >= empezo;
        if (!ahoraMismo || ahoraMismo.seg_ficha !== ficha || ahoraMismo.seg_token !== payload.token || escribio) {
          console.log(`[tablero] convo ${convo.id}: el seguimiento se corta a medias (${escribio ? "escribió" : "pagó o se movió"})`);
          break;
        }
        await sendConfiguredSteps(getConversationById(convo.id) ?? fresca, [paso] as never);
      }
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
