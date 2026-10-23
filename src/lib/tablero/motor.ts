/**
 * EL MOTOR DEL TABLERO — el segundo motor. Lee el tablero de la tienda y sigue los cables.
 *
 * LAS CUATRO REGLAS QUE LO HACEN SEGURO (ver PLAN-TABLERO.md):
 *  1. Una conversación, un solo motor. Entra al tablero SOLO al nacer (estado «new») y en una
 *     tienda con tablero encendido; desde ahí tiene su fila en `tablero_estado` y nunca la pierde.
 *     Las demás no pasan por aquí: `alRecibirMensaje` devuelve false y sigue el motor de siempre.
 *  2. Sin cables, nada cambia: una tienda sin tablero encendido y conectado vende como siempre.
 *  3. Lo compartido se usa, no se modifica: burbujas (`sendConfiguredSteps`), entrega del
 *     producto, regalo, avisos y registro de compras en Meta se llaman tal como están.
 *  4. Lo programado lleva su dueño: `tablero_reloj` y `tablero_sin_pago`, que el obrero manda
 *     aquí y nunca al motor de siempre.
 */
import {
  getConversationById,
  isNumberBlocked,
  listMetaWhatsAppConnections,
  scheduleAction,
  setConversationState,
  setMode,
  setPaidAt,
  type ConversationRow,
  type ScheduledActionRow,
} from "@/lib/db";
import { getCountryInfo } from "@/lib/countries";
import { buildMessagingUserData, sendPurchaseEvent } from "@/lib/meta/conversions";
import { notifyAdmin } from "@/lib/notifications";
import { vinoDeAnuncio } from "@/lib/origen-de-lead";
import {
  conElTurnoDe,
  decisionQueCoincide,
  getEffectiveCountryCode,
  laTiendaDeLaConversacion,
  loadWorkflowConfig,
  type ProductoDeLaBiblioteca,
  type SequenceStep,
  type WorkflowConfig,
} from "@/lib/workflow/config";
import { scheduleGiftConsentWithDelay, sendConfiguredSteps } from "@/lib/workflow/engine";
import { responderConIA } from "./conversador";
import { cableDeLaSalida, elTableroAtiende, leeTableros } from "./datos";
import {
  abrirCobro,
  anotarCompra,
  apuntarBoton,
  apuntarHuella,
  botonYaUsado,
  cerrarCobro,
  comprasDelCliente,
  entrarAlTablero,
  estadoEnElTablero,
  moverA,
  salirDelTablero,
  sumarAlCobro,
  tocarVuelta,
  type EstadoEnElTablero,
} from "./estado";
import { hayComprobantePendiente, huellaDelPago, leerComprobante } from "./lector";
import type { FichaDelTablero, Tablero } from "./tipos";

export const ACCION_RELOJ = "tablero_reloj";
export const ACCION_SIN_PAGO = "tablero_sin_pago";

/** Estados en los que manda el motor de siempre aunque la conversación sea de tablero: el regalo. */
const ESTADOS_DEL_REGALO = new Set(["payment_approved", "awaiting_email", "awaiting_gift_consent", "awaiting_facebook_comment"]);

const ahora = () => Math.floor(Date.now() / 1000);

function tableroDe(config: WorkflowConfig | null, tiendaId: string | null | undefined): Tablero | null {
  if (!tiendaId) return null;
  const todos = leeTableros((config as { tableros?: unknown } | null)?.tableros);
  return todos[tiendaId] ?? null;
}

function producto(config: WorkflowConfig | null, id: string | undefined): ProductoDeLaBiblioteca | null {
  if (!id) return null;
  return config?.biblioteca_de_productos?.find((p) => p.id === id) ?? null;
}

/** El precio de un producto en el país del cliente. Sin precio de su país → el general. */
function precioDelProducto(p: ProductoDeLaBiblioteca | null, pais: string): number | null {
  if (!p) return null;
  const suyo = p.precios_por_pais?.[pais];
  const v = suyo?.price_soles ?? p.price_soles;
  return typeof v === "number" && v > 0 ? v : null;
}

function pasosActivos(f: FichaDelTablero): SequenceStep[] {
  return (f.steps ?? []).filter((s) => (s as { enabled?: boolean }).enabled !== false);
}

/** El texto de la última burbuja de una ficha: lo que el cliente tiene pendiente de contestar. */
function textoDeLaUltimaBurbuja(f: FichaDelTablero | undefined): string | undefined {
  if (!f) return undefined;
  const pasos = pasosActivos(f);
  for (let i = pasos.length - 1; i >= 0; i--) {
    const p = pasos[i] as { type: string; body?: string; body_variants?: string[]; caption?: string };
    const t = p.type === "text" ? p.body_variants?.find((x) => x?.trim()) ?? p.body : p.caption;
    if (t?.trim()) return t.trim();
  }
  return undefined;
}

/** Los montos que la IA puede nombrar: los del cobro abierto, en el país del cliente. */
function montosDelCobro(config: WorkflowConfig | null, t: Tablero, estado: EstadoEnElTablero, pais: string): number[] {
  const f = t.fichas.find((x) => x.id === estado.cobro_ficha_id);
  if (!f?.cobro) return [];
  if (f.cobro.modo === "producto") {
    const p = precioDelProducto(producto(config, f.cobro.producto_id), pais);
    return p ? [p] : [];
  }
  const montos: number[] = [];
  const min = f.cobro.minimo_por_pais?.[pais];
  if (typeof min === "number" && min > 0) montos.push(min);
  for (const tr of f.cobro.tramos_por_pais?.[pais] ?? []) {
    montos.push(tr.desde);
    if (tr.hasta !== undefined) montos.push(tr.hasta);
  }
  return [...new Set(montos)];
}

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
 * LLEVA AL CLIENTE A UNA FICHA y hace lo que esa ficha hace. Las que no esperan nada (inicio,
 * entregar, mensaje sin pregunta, condición) siguen solas por su cable; un tope de pasos impide
 * que un círculo sin pausa (A → B → A) mande burbujas para siempre.
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
  const vuelta = moverA(convoId, f.id);
  const config = loadWorkflowConfig();
  const pais = getEffectiveCountryCode(convo.phone, config);
  console.log(`[tablero] convo ${convoId} → ficha «${f.titulo || f.tipo}» (${f.id})`);
  const seguir = async (salida: string) => {
    const cable = cableDeLaSalida(t, f.id, salida);
    if (cable) await irA(convoId, t, cable.a, pasos + 1);
  };

  switch (f.tipo) {
    case "inicio":
      await seguir("siguiente");
      return;

    case "mensaje": {
      await sendConfiguredSteps(convo, pasosActivos(f) as never);
      if (f.sin_respuesta_min)
        scheduleAction(convoId, ACCION_RELOJ, { ficha: f.id, salida: "sin_respuesta", vuelta }, ahora() + f.sin_respuesta_min * 60);
      const pregunta = pasosActivos(f).some(
        (p) => (p.buttons ?? []).length > 0 || (p.decisions ?? []).some((d) => d.enabled !== false)
      );
      if (!pregunta) await seguir("siguiente");
      return;
    }

    case "entregar": {
      const p = producto(config, f.producto_id);
      if (!p?.delivery?.length) {
        console.warn(`[tablero] convo ${convoId}: la ficha Entregar no tiene producto con entrega`);
      } else {
        await sendConfiguredSteps(convo, p.delivery as never);
      }
      await seguir("siguiente");
      return;
    }

    case "cobro": {
      abrirCobro(convoId, f.id);
      const desde = estadoEnElTablero(convoId)?.cobro_desde ?? ahora();
      const precio =
        f.cobro?.modo === "producto" ? precioDelProducto(producto(config, f.cobro.producto_id), pais) : null;
      await sendConfiguredSteps(convo, pasosActivos(f) as never, precio ?? undefined);
      if (f.sin_pago_min)
        scheduleAction(convoId, ACCION_SIN_PAGO, { ficha: f.id, cobro_desde: desde }, ahora() + f.sin_pago_min * 60);
      return;
    }

    case "condicion": {
      const c = f.condicion;
      let si = false;
      if (c?.tipo === "pais") si = (c.paises ?? []).includes(pais);
      else if (c?.tipo === "anuncio") si = vinoDeAnuncio(convo);
      else if (c?.producto_id) si = comprasDelCliente(convoId).some((x) => x.producto_id === c.producto_id);
      await seguir(si ? "si" : "no");
      return;
    }

    case "esperar":
      scheduleAction(convoId, ACCION_RELOJ, { ficha: f.id, salida: "siguiente", vuelta }, ahora() + (f.minutos ?? 1) * 60);
      return;

    case "regalo":
      // El regalo de siempre, tal cual: se pone la conversación donde él lo espera y se programa
      // su pregunta. Desde ahí lo atiende el motor de siempre (ver ESTADOS_DEL_REGALO).
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

/** El cliente de esta ficha recibe la IA, con lo que tiene pendiente y los montos permitidos. */
async function contestarConIA(convo: ConversationRow, t: Tablero, nota?: string): Promise<void> {
  const estado = estadoEnElTablero(convo.id);
  const config = loadWorkflowConfig();
  const pais = getEffectiveCountryCode(convo.phone, config);
  const ficha = t.fichas.find((x) => x.id === estado?.ficha_id);
  await responderConIA(convo, {
    preguntaPendiente: ficha && ficha.tipo !== "cobro" ? textoDeLaUltimaBurbuja(ficha) : undefined,
    montosPermitidos: estado ? montosDelCobro(config, t, estado, pais) : [],
    moneda: getCountryInfo(pais).currency,
    nota,
  });
}

/** Un comprobante con el cobro abierto: se lee, se cuenta y se sigue la salida de su monto. */
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
  const huella = huellaDelPago(lectura);
  if (huella && !apuntarHuella(huella, convo.id)) {
    console.log(`[tablero] convo ${convo.id}: comprobante repetido (${huella})`);
    await contestarConIA(convo, t, "Ese comprobante ya estaba registrado antes. Díselo con amabilidad: ya lo tenemos y no hace falta enviarlo otra vez.");
    return;
  }
  const config = loadWorkflowConfig();
  const pais = getEffectiveCountryCode(convo.phone, config);
  const moneda = getCountryInfo(pais).currency;
  const total = sumarAlCobro(convo.id, lectura.monto);
  let salida: string;
  if (f.cobro.modo === "producto") {
    const precio = precioDelProducto(producto(config, f.cobro.producto_id), pais);
    salida = precio === null || total + 0.009 >= precio ? "pagado" : "menos";
  } else {
    const minimo = f.cobro.minimo_por_pais?.[pais] ?? 0;
    if (total + 0.009 < minimo) salida = "menos";
    else {
      // EL TRAMO MÁS ALTO QUE ALCANZA: con tramos que se pisan, gana el de mayor «desde».
      const tramo = [...(f.cobro.tramos_por_pais?.[pais] ?? [])]
        .sort((a, b) => b.desde - a.desde)
        .find((tr) => total + 0.009 >= tr.desde && (tr.hasta === undefined || total <= tr.hasta + 0.009));
      salida = tramo ? `tramo:${tramo.id}` : "pagado";
    }
  }
  console.log(`[tablero] convo ${convo.id}: pagó ${lectura.monto} (acumulado ${total} ${moneda}) → salida ${salida}`);
  if (salida === "menos") {
    // EL COBRO SIGUE ABIERTO: puede completar con otro comprobante, y se suma.
    const cable = cableDeLaSalida(t, f.id, "menos");
    if (cable) await irA(convo.id, t, cable.a);
    else await contestarConIA(convo, t, `Recibimos su pago de ${lectura.monto} ${moneda}, pero no alcanza el monto esperado. Díselo con amabilidad, sin inventar el monto que falta.`);
    return;
  }
  cerrarCobro(convo.id);
  anotarCompra({ conversationId: convo.id, fichaId: f.id, productoId: f.cobro.producto_id ?? null, salida, monto: total, moneda });
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
  if (convo.channel !== "test")
    void notifyAdmin(
      `💰 *Pago en el tablero:* ${convo.client_name ?? convo.name ?? convo.phone} — ${total} ${moneda} (${f.titulo || "Cobro"}).`
    ).catch(() => {});
  const cable = cableDeLaSalida(t, f.id, salida);
  if (cable) await irA(convo.id, t, cable.a);
  else await contestarConIA(convo, t, `Su pago de ${total} ${moneda} quedó registrado. Agradécele de corazón.`);
}

/**
 * EL TURNO DE UN CLIENTE. Devuelve true si lo atendió el tablero; false = sigue el motor de
 * siempre, exactamente como si esto no existiera.
 */
export async function alRecibirMensaje(convo: ConversationRow, contenido: string): Promise<boolean> {
  // /reiniciar (para probar): sale del tablero y el motor de siempre borra la charla como
  // siempre. El siguiente «hola» vuelve a entrar al tablero desde el Inicio.
  if (/^\/(restart|reset|reiniciar)$/i.test(contenido.trim())) {
    if (estadoEnElTablero(convo.id)) salirDelTablero(convo.id);
    return false;
  }
  let estado = estadoEnElTablero(convo.id);
  const config = loadWorkflowConfig();

  if (!estado) {
    // SOLO AL NACER. Una conversación que ya empezó con el motor de siempre se queda en él.
    if (convo.state !== "new") return false;
    const tienda = laTiendaDeLaConversacion(convo);
    const t = tableroDe(config, tienda?.id);
    if (!tienda?.id || !t || !elTableroAtiende(t)) return false;
    const inicio = t.fichas.find((f) => f.tipo === "inicio")!;
    if (!entrarAlTablero(convo.id, tienda.id, inicio.id)) return false;
    setConversationState(convo.id, "tablero");
    console.log(`[tablero] convo ${convo.id} entra al tablero de la tienda «${tienda.nombre ?? tienda.id}»`);
    await irA(convo.id, t, inicio.id);
    return true;
  }

  // EL REGALO lo atiende el motor de siempre, como en cualquier venta.
  if (ESTADOS_DEL_REGALO.has(convo.state ?? "")) return false;

  const t = tableroDe(config, estado.tienda_id);
  if (!t) {
    // Borró el tablero con clientes dentro: la IA contesta, sin ruta.
    await responderConIA(convo, { montosPermitidos: [] });
    return true;
  }

  // 1. UN COMPROBANTE CON EL COBRO ABIERTO, esté donde esté el cliente (también en un recordatorio).
  if (estado.cobro_ficha_id && hayComprobantePendiente(convo.id)) {
    await atenderComprobante(convo, t, estado);
    return true;
  }

  const ficha = t.fichas.find((x) => x.id === estado!.ficha_id);
  // 2. UN BOTÓN, AUNQUE SEA DE UN MENSAJE ANTERIOR. El botón sigue en su chat: si tras la
  // insistencia toca «Sí, quiero» de la oferta, vale. Se busca la ficha que lo tiene; su id es
  // único en el tablero (cada botón nace con el suyo).
  if (contenido.startsWith("bubble:")) {
    const id = contenido.slice("bubble:".length);
    const suFicha = t.fichas.find(
      (f) => f.tipo === "mensaje" && pasosActivos(f).some((p) => (p.buttons ?? []).some((b) => b.id === id))
    );
    const cable = suFicha ? cableDeLaSalida(t, suFicha.id, `btn:${id}`) : null;
    // Ya usado y de otra ficha = un toque repetido de un mensaje viejo: no se repite nada.
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
  if (ficha?.tipo === "mensaje") {
    // 3. UN CUADRITO DE SU FICHA: sus burbujas, y luego su cable.
    const decisiones = pasosActivos(ficha).flatMap((p) => p.decisions ?? []);
    const decision = contenido.startsWith("bubble:") ? null : decisionQueCoincide(contenido, decisiones);
    if (decision) {
      if (decision.steps?.length) await sendConfiguredSteps(convo, decision.steps as never);
      const cable = cableDeLaSalida(t, ficha.id, `dec:${decision.id}`);
      if (cable) await irA(convo.id, t, cable.a);
      else {
        tocarVuelta(convo.id);
        // Un cuadrito sin burbujas ni cable: que no se quede sin respuesta.
        if (!decision.steps?.length) await contestarConIA(convo, t);
      }
      return true;
    }
    // 4. «OTRA COSA»: su cable, si lo tiene.
    const otra = cableDeLaSalida(t, ficha.id, "otra");
    if (otra) {
      await irA(convo.id, t, otra.a);
      return true;
    }
  }

  // 5. LO DEMÁS LO CONTESTA LA IA, y el cliente sigue en su ficha. Como sí respondió, el reloj
  // de «no respondió» de su ficha de mensaje ya no sale.
  if (ficha?.tipo === "mensaje") tocarVuelta(convo.id);
  estado = estadoEnElTablero(convo.id) ?? estado;
  await contestarConIA(convo, t);
  return true;
}

/** ¿Esta conversación es del tablero? Para que el motor de siempre no le programe nada. */
export function esDelTablero(conversationId: number): boolean {
  return !!estadoEnElTablero(conversationId);
}

/** LO PROGRAMADO DEL TABLERO: los relojes de sus fichas. Lo manda aquí el obrero. */
export async function ejecutarAccionDelTablero(accion: ScheduledActionRow): Promise<void> {
  const convo = getConversationById(accion.conversation_id);
  if (!convo) return;
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(accion.payload || "{}");
  } catch {
    return;
  }
  await conElTurnoDe(convo, async () => {
    const estado = estadoEnElTablero(convo.id);
    if (!estado || ESTADOS_DEL_REGALO.has(getConversationById(convo.id)?.state ?? "")) return;
    const t = tableroDe(loadWorkflowConfig(), estado.tienda_id);
    if (!t) return;
    const ficha = String(payload.ficha ?? "");
    if (accion.action_type === ACCION_RELOJ) {
      // Solo si el cliente sigue en esa ficha desde entonces: si respondió o se movió, nada.
      if (estado.ficha_id !== ficha || estado.vuelta !== payload.vuelta) return;
      const cable = cableDeLaSalida(t, ficha, String(payload.salida ?? ""));
      if (cable) await irA(convo.id, t, cable.a);
      return;
    }
    if (accion.action_type === ACCION_SIN_PAGO) {
      // Solo si ESE cobro sigue abierto (no pagó): da igual en qué recordatorio esté.
      if (estado.cobro_ficha_id !== ficha || estado.cobro_desde !== payload.cobro_desde) return;
      // Si ya pagó ALGO (aunque no alcance), no es «no pagó»: su salida fue «menos».
      if (estado.cobro_pagado > 0) return;
      const cable = cableDeLaSalida(t, ficha, "sin_pago");
      if (cable) await irA(convo.id, t, cable.a);
    }
  });
}
