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
import {
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
import { messageHasPaymentConcern, scheduleGiftConsentWithDelay, sendConfiguredSteps } from "@/lib/workflow/engine";
import { adjustForQuietHours, cumulativeBurstOffset, isAtOrAfterLocalTime, isQuietHour, nextLocalTime } from "@/lib/workflow/quiet-hours";
import { elegirOpcionConIA, responderConIA, type OpcionParaLaIA, type ProductoParaLaIA } from "./conversador";
import { mandarDatosDelMetodo, metodoQueNombra, metodoVigente, preguntarElMetodo } from "./pago";
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
} from "./datos";
import {
  abrirCobro,
  activarOferta,
  anotarCompra,
  anotarEntrega,
  anotarPresentados,
  contarSeguimientosDesde,
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
  moverA,
  ponerSeguimiento,
  preciosDelCobro,
  proponerProducto,
  reiniciarRelojDelCobro,
  salirDelTablero,
  sumarAlCobro,
  tocarVuelta,
  varianteVista,
  type EstadoEnElTablero,
} from "./estado";
import { hayComprobantePendiente, huellaDelPago, idDelComprobantePendiente, leerComprobante, titularCoincide } from "./lector";
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
 * LLEVA AL CLIENTE A UNA FICHA y hace lo que esa ficha hace. Las que no esperan nada siguen solas
 * por su cable; un tope de pasos impide que un círculo sin pausa mande burbujas para siempre.
 */
async function irA(convoId: number, t: Tablero, fichaId: string, pasos = 0): Promise<void> {
  const convo = getConversationById(convoId);
  if (!convo || noSeLeEscribe(convo)) return;
  if (pasos > 25) {
    console.warn(`[tablero] convo ${convoId}: 25 fichas seguidas sin pausa — se para aquí (¿un círculo sin espera?)`);
    return;
  }
  const f = t.fichas.find((x) => x.id === fichaId);
  if (!f) return;
  const antes = estadoEnElTablero(convoId);
  // Al salir de la caja «Seguimientos», sus relojes dejan de valer.
  if (antes?.seg_ficha && antes.seg_ficha !== f.id) ponerSeguimiento(convoId, null, 0);
  const vuelta = moverA(convoId, f.id);
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
    case "inicio":
      await seguir("siguiente");
      return;

    case "mensaje":
    case "intro_ob": {
      let pasosAEnviar = pasosActivos(f.steps);
      if (f.tipo === "intro_ob") {
        const v = sortear<VarianteDeFicha>(f.variantes ?? []);
        if (v) apuntarVariante(convoId, f.id, v.id);
        pasosAEnviar = pasosActivos(v?.steps);
      }
      await sendConfiguredSteps(convo, pasosAEnviar as never);
      // Desde aquí la IA ya puede hablar de lo que esta ficha presenta.
      anotarPresentados(convoId, f.presenta ?? []);
      if (f.sin_respuesta_min)
        programar(convo, ACCION_RELOJ, { ficha: f.id, salida: "sin_respuesta", vuelta }, ahora() + f.sin_respuesta_min * 60);
      const { botones, cuadritos } = opcionesDe(pasosAEnviar);
      if (botones.length + cuadritos.length === 0) await seguir("siguiente");
      return;
    }

    case "seguimientos": {
      const segs = f.seguimientos ?? [];
      if (segs.length === 0) return;
      const token = ponerSeguimiento(convoId, f.id, 0);
      const desde = getLastUserMessageTime(convoId) ?? ahora();
      contarSeguimientosDesde(convoId, desde);
      const { cuando, sinSilencio } = cuandoSaleElSeguimiento(convo, segs[0], 0, desde);
      programar(convo, ACCION_SEGUIMIENTO, { ficha: f.id, idx: 0, token }, cuando, sinSilencio);
      return;
    }

    case "entregar": {
      const p = producto(config, f.producto_id);
      if (!p?.delivery?.length) {
        console.warn(`[tablero] convo ${convoId}: la ficha Entregar no tiene producto con entrega`);
      } else {
        await sendConfiguredSteps(convo, p.delivery as never);
        anotarEntrega(convoId, p.id);
        anotarPresentados(convoId, [p.id]);
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
      if (f.cobro?.metodos) {
        // CON EL MÉTODO YA ELEGIDO NO SE VUELVE A PREGUNTAR: le llegan los datos de ése.
        const yaElegido = metodoVigente(getConversationById(convoId) ?? convo);
        if (yaElegido && (await mandarDatosDelMetodo(convo, yaElegido, precio, nombre))) {
          // (los datos ya salieron)
        } else await preguntarElMetodo(convo, pasosActivos(f.steps) as never, precio, nombre);
      } else await sendConfiguredSteps(convo, pasosActivos(f.steps) as never, precio);
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
      if (f.sin_pago_min) {
        const e = estadoEnElTablero(convoId);
        programar(convo, ACCION_SIN_PAGO, { ficha: f.id, cobro_desde: e?.cobro_desde, reloj: e?.cobro_reloj }, ahora() + f.sin_pago_min * 60);
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
      const o = sortear(f.reparto ?? []);
      if (o) await seguir(`rep:${o.id}`);
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
      if (!convo.paid_at) setPaidAt(convoId, ahora());
      setConversationState(convoId, "payment_approved");
      scheduleGiftConsentWithDelay(convoId, 0);
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
  const ficha = t.fichas.find((x) => x.id === estado?.ficha_id);
  // EL REENVÍO SOLO SI HAY ALGO QUE REENVIAR Y NO HAY UNA INSTRUCCIÓN: con una nota («pregúntale si
  // fue un error…») la IA tiene un encargo concreto, y ofrecerle el reenvío lo desviaba (lo midió el
  // recorrido del 23/10: el cliente se quedó sin la pregunta).
  const puedeReenviar = !nota && entregasDelCliente(convo.id).length > 0;
  const { productos, montos } = loQueSabeLaIA(convo, estado, pais);
  // LOS DATOS OTRA VEZ («pásame la cuenta», «sí, ya pago»): con el cobro abierto que pide método y
  // el método ya elegido. Los manda el sistema con el precio congelado, nunca la IA.
  const cobro = estado?.cobro_ficha_id ? t.fichas.find((x) => x.id === estado.cobro_ficha_id) : undefined;
  const metodo = cobro?.cobro?.metodos ? metodoVigente(getConversationById(convo.id) ?? convo) : null;
  await responderConIA(convo, {
    preguntaPendiente: ficha && ficha.tipo !== "cobro" ? textoDeLaUltimaBurbuja(pasosVistos(ficha, estado)) : undefined,
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
      : {}),
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
  "No pude validar ese comprobante. Pídele con amabilidad una foto más clara, donde se vea el comprobante completo. No le digas qué faltó.";

/** Un comprobante con el cobro abierto: se lee, se revisa, se cuenta y se sigue la salida de su monto. */
async function atenderComprobante(convo: ConversationRow, t: Tablero, estado: EstadoEnElTablero): Promise<void> {
  const f = t.fichas.find((x) => x.id === estado.cobro_ficha_id);
  if (!f?.cobro) return;
  const lectura = await leerComprobante(convo.id);
  if (!lectura) {
    await contestarConIA(
      convo,
      t,
      "El cliente mandó una imagen que no se ve como un comprobante de pago legible. Pídele con amabilidad una captura clara del comprobante donde se vea el monto."
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
    await contestarConIA(convo, t, SIN_PISTAS);
    return;
  }
  if (lectura.metodo === "yape" || lectura.metodo === "plin") {
    const esperado = elCobroDelPais(pais as never, config).titular;
    if (esperado && (!lectura.titular || !titularCoincide(esperado, lectura.titular))) {
      console.warn(`[tablero] convo ${convo.id}: comprobante a nombre de «${lectura.titular ?? "?"}», se esperaba «${esperado}» → no se cuenta`);
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
  if (!(await seguirPor(convo.id, t, f.id, salida, 0)))
    await contestarConIA(convo, t, `Su pago de ${total} ${moneda} quedó registrado. Agradécele de corazón.`);
}

// ── EL CORREO ──────────────────────────────────────────────────────────────────

/**
 * EL MATERIAL EN TEXTO, para el correo: lo que dicen las burbujas de entrega de cada producto que
 * le entregó el tablero, con sus enlaces. Un correo no es WhatsApp: el comodín del producto se
 * cambia por su nombre, de cada {a|b} sale la primera, sin asteriscos, y un comodín que el correo
 * no sabe llenar se quita (mejor una línea más corta que «{{ALGO}}» delante del cliente).
 */
function materialParaElCorreo(productos: ProductoDeLaBiblioteca[]): string {
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
 * MANDA EL CORREO con lo que le entregó el tablero. Asunto y texto son los de la ficha ({{MATERIAL}}
 * = el material); sin texto, va el material solo. En el simulador no sale de verdad, como el correo
 * de siempre. Guarda su correo en la conversación (lo ve el panel, como siempre).
 */
async function enviarElCorreo(convo: ConversationRow, f: FichaDelTablero, correo: string): Promise<boolean> {
  const config = loadWorkflowConfig();
  const productos = entregasDelCliente(convo.id)
    .map((id) => producto(config, id))
    .filter((p): p is ProductoDeLaBiblioteca => !!p);
  setClientEmail(convo.id, correo);
  if (productos.length === 0) {
    console.warn(`[tablero:correo] convo ${convo.id}: pidió el correo pero aún no se le entregó nada`);
    if (convo.channel !== "test")
      void notifyAdmin(`📧 *Tablero:* ${convo.client_name ?? convo.name ?? convo.phone} dio su correo (${correo}) pero aún no tiene nada entregado.`).catch(() => {});
    return false;
  }
  const material = materialParaElCorreo(productos);
  const asunto = (f.correo_asunto ?? "").trim() || productos.map((p) => p.name).filter(Boolean).join(" + ");
  const cuerpo = (f.correo_texto ?? "").trim() ? f.correo_texto!.split("{{MATERIAL}}").join(material) : material;
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

  // EL REGALO lo atiende el motor de siempre, como en cualquier venta.
  if (ESTADOS_DEL_REGALO.has(convo.state ?? "")) return false;

  const t = tableroDe(config, estado.tienda_id, (estado.canal as CanalDelTablero) || "whatsapp");
  if (!t) {
    // Borró el tablero con clientes dentro: la IA contesta, sin ruta.
    await responderConIA(convo, { montosPermitidos: [] });
    return true;
  }

  // EL CLIENTE ESCRIBIÓ: el reloj del «no pagó» vuelve a empezar (como los seguimientos de hoy).
  if (estado.cobro_ficha_id && estado.cobro_pagado <= 0) {
    const cobro = t.fichas.find((x) => x.id === estado!.cobro_ficha_id);
    if (cobro?.sin_pago_min) {
      const reloj = reiniciarRelojDelCobro(convo.id);
      programar(convo, ACCION_SIN_PAGO, { ficha: cobro.id, cobro_desde: estado.cobro_desde, reloj }, ahora() + cobro.sin_pago_min * 60);
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
        tocarVuelta(convo.id);
        if (await mandarDatosDelMetodo(convo, metodo, elegidoId ? precios[elegidoId] : undefined, producto(config, elegidoId)?.name)) return true;
      }
      // Solo entre los que ya se le presentaron: el que sigue oculto no se elige por aquí.
      const vistos = new Set(presentadosDe(estado));
      const opciones = Object.keys(precios).filter((id) => vistos.has(id));
      if (!metodo && estado.ficha_id === cobro.id && estado.cobro_pagado <= 0 && opciones.length > 1) {
        const decide = await elegirOpcionConIA(
          convo.id,
          contenido,
          opciones.map((id) => ({ id, etiqueta: producto(config, id)?.name ?? id, palabras: producto(config, id)?.aliases }))
        );
        if (decide && decide !== elegidoId) {
          elegirEnElCobro(convo.id, decide);
          tocarVuelta(convo.id);
          const nombre = producto(config, decide)?.name;
          const yaElegido = metodoVigente(getConversationById(convo.id) ?? convo);
          console.log(`[tablero] convo ${convo.id}: cambia a «${nombre ?? decide}» en el cobro`);
          if (!yaElegido || !(await mandarDatosDelMetodo(convo, yaElegido, precios[decide], nombre)))
            await preguntarElMetodo(convo, [], precios[decide], nombre);
          return true;
        }
      }
    }
  }

  const ficha = t.fichas.find((x) => x.id === estado!.ficha_id);

  // 2-ter. LA FICHA «PEDIR CORREO»: cuando escribe su correo, se le manda el material.
  if (ficha?.tipo === "correo" && !contenido.startsWith("bubble:")) {
    const correo = contenido.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
    tocarVuelta(convo.id);
    if (!correo) {
      await contestarConIA(convo, t, "Estás esperando su correo electrónico para enviarle el material. Contesta con naturalidad lo que escribió y vuelve a pedirle su correo.");
      return true;
    }
    if (await enviarElCorreo(convo, ficha, correo)) {
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

  if (conRespuesta && ficha) {
    // 5. UN CUADRITO DE SU FICHA, por sus palabras: sus burbujas, y luego su cable.
    const decision = contenido.startsWith("bubble:") ? null : decisionQueCoincide(contenido, todas.cuadritos);
    if (decision) {
      await actuarCuadrito(convo, t, ficha, decision);
      return true;
    }
    // 6. NINGUNO ACERTÓ: la IA decide cuál eligió («el de 10», «el otro»…), sin escribir nada.
    // Desde ahí sale lo mismo que si hubiera tocado o escrito esa opción.
    if (!contenido.startsWith("bubble:") && todas.botones.length + todas.cuadritos.length > 0) {
      const opciones: OpcionParaLaIA[] = [
        ...todas.botones.map((b) => ({ id: `btn:${b.id}`, etiqueta: b.label })),
        ...todas.cuadritos.map((d) => ({ id: `dec:${d.id}`, etiqueta: d.title || (d.keywords ?? []).join(", "), palabras: d.keywords })),
      ];
      const elegida = await elegirOpcionConIA(convo.id, contenido, opciones);
      if (elegida?.startsWith("btn:")) {
        const cable = cableDeLaSalida(t, ficha.id, elegida);
        if (cable) {
          apuntarBoton(convo.id, elegida.slice(4));
          await irA(convo.id, t, cable.a);
          return true;
        }
      } else if (elegida?.startsWith("dec:")) {
        const d = todas.cuadritos.find((x) => `dec:${x.id}` === elegida);
        if (d) {
          await actuarCuadrito(convo, t, ficha, d);
          return true;
        }
      }
    }
    // 7. «OTRA COSA»: su cable, si lo tiene.
    if (await seguirPor(convo.id, t, ficha.id, "otra", 0)) return true;
  }

  // 8. LO DEMÁS LO CONTESTA LA IA, y el cliente sigue en su ficha. Como sí respondió, el reloj de
  // «no respondió» ya no sale, y los seguimientos vuelven a contar desde ahora.
  if (ficha?.tipo === "mensaje" || ficha?.tipo === "intro_ob") tocarVuelta(convo.id);
  if (ficha?.tipo === "seguimientos") reprogramarSeguimiento(convo, ficha);
  estado = estadoEnElTablero(convo.id) ?? estado;
  await contestarConIA(convo, t);
  return true;
}

async function actuarCuadrito(convo: ConversationRow, t: Tablero, ficha: FichaDelTablero, d: BubbleDecision): Promise<void> {
  if (d.steps?.length) await sendConfiguredSteps(convo, d.steps as never);
  if (await seguirPor(convo.id, t, ficha.id, `dec:${d.id}`, 0)) return;
  if (ficha.tipo === "seguimientos") reprogramarSeguimiento(convo, ficha);
  else tocarVuelta(convo.id);
  // Un cuadrito sin burbujas ni cable: que no se quede sin respuesta.
  if (!d.steps?.length) await contestarConIA(convo, t);
}

/** El cliente escribió estando en la caja «Seguimientos»: el que tocaba vuelve a contar desde ahora. */
function reprogramarSeguimiento(convo: ConversationRow, ficha: FichaDelTablero): void {
  const e = estadoEnElTablero(convo.id);
  const segs = ficha.seguimientos ?? [];
  if (!e || e.seg_ficha !== ficha.id || e.seg_idx >= segs.length) return;
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
    // Solo si sigue en la caja de seguimientos y nadie cambió su turno (escribió o se movió).
    if (estado.ficha_id !== ficha || estado.seg_ficha !== ficha || estado.seg_token !== payload.token) return;
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
    const v = sortear<VarianteDeFicha>(seg.variantes);
    if (v) {
      apuntarVariante(convo.id, `${ficha}#${idx}`, v.id);
      await sendConfiguredSteps(fresca, pasosActivos(v.steps) as never);
    }
    if (seg.activa_oferta) activarOferta(convo.id);
    // Lo que este seguimiento presenta, desde ahora la IA lo puede contar.
    anotarPresentados(convo.id, f.presenta ?? []);
    console.log(`[tablero] convo ${convo.id}: seguimiento ${idx + 1} de «${f.titulo || "Seguimientos"}»`);
    // EL SIGUIENTE, a sus minutos desde el mismo punto que los demás (el último mensaje del
    // cliente, o la hora a la que se aplazó un lead tardío), como el motor de siempre; tras el
    // último, «Terminaron sin respuesta» con la misma espera que el último.
    const token = ponerSeguimiento(convo.id, ficha, idx + 1);
    const desde = estadoEnElTablero(convo.id)?.seg_desde ?? getLastUserMessageTime(convo.id) ?? ahora();
    const siguiente = segs[idx + 1];
    if (siguiente) {
      const { cuando, sinSilencio } = cuandoSaleElSeguimiento(fresca, siguiente, idx + 1, desde);
      programar(fresca, ACCION_SEGUIMIENTO, { ficha, idx: idx + 1, token }, cuando, sinSilencio);
    } else {
      const espera = Math.max(seg.minutos - (segs[idx - 1]?.minutos ?? 0), 60);
      programar(fresca, ACCION_SEGUIMIENTO, { ficha, idx: idx + 1, token }, ahora() + espera * 60);
    }
  }
}

// Para las pruebas: la lectura de un tablero suelto.
export { leeTablero };
