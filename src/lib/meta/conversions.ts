import crypto from "node:crypto";
import {
  getActiveInstagramMetaConnection,
  getActiveMetaConnection,
  getConversationById,
  getMetaConnectionByPageId,
  getMetaWhatsAppConnection,
  permisoDeMedicionDeLaCuenta,
  registrarEventoCapi,
} from "@/lib/db";
// `getWhatsAppRuntimeConfig` ya no se importa: lo único que se le pedía aquí era la WABA,
// y ese dato dejó de mandarse el 3 de octubre de 2026. Ver el porqué más abajo.
import { getCapiAccessToken, getCapiPixelId } from "@/lib/meta/runtime-config";
import { laTiendaDeLaConversacion } from "@/lib/workflow/config";

const META_API_VERSION = process.env.META_GRAPH_VERSION ?? "v21.0";

function isTestConversation(conversationId: number): boolean {
  return getConversationById(conversationId)?.channel === "test";
}

/**
 * Hash SHA-256 en hex, lower-case. Meta exige este formato para todos los
 * datos personales identificables (PII) excepto IP y user agent.
 */
function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hashText(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  return sha256Hex(normalized);
}

/**
 * Normaliza un teléfono al formato que Meta espera y lo hashea.
 * Quita +, espacios, guiones, paréntesis, etc. y deja solo dígitos.
 */
function hashPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (!digits) return null;
  return sha256Hex(digits);
}

export interface CapiUserData {
  /** Teléfono internacional. Se quitan no-dígitos antes de hashear. */
  phone?: string | null;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  /**
   * Click-To-WhatsApp Click ID. Lo manda Meta en el webhook (msg.referral)
   * cuando el cliente llega desde un anuncio. Se envía SIN hashear — es el
   * identificador clave para que Meta atribuya el evento al anuncio.
   */
  ctwa_clid?: string | null;
  externalId?: string | null;
  /** Instagram Scoped ID exigido por CAPI para business_messaging + instagram. */
  igSid?: string | null;
  /** Page-scoped ID exigido por CAPI para business_messaging + Messenger. */
  pageScopedUserId?: string | null;
  /** Instagram Business Account ID exigido por CAPI para canal instagram. */
  igAccountId?: string | null;
  messagingChannel?: "whatsapp" | "messenger" | "instagram";
}

export function buildMessagingUserData(input: {
  channel: "whatsapp" | "messenger" | "instagram" | "tiktok" | "test";
  phone: string;
  firstName?: string | null;
  email?: string | null;
  ctwa_clid?: string | null;
}): CapiUserData {
  const messagingChannel =
    input.channel === "messenger" || input.channel === "instagram"
      ? input.channel
      : "whatsapp";
  const scopedId =
    input.channel === "messenger" || input.channel === "instagram"
      ? input.phone.replace(/^[^:]+:/, "")
      : null;
  const activeInstagram = getActiveInstagramMetaConnection();

  return {
    phone: input.channel === "whatsapp" ? input.phone : null,
    firstName: input.firstName,
    email: input.email,
    ctwa_clid: input.ctwa_clid,
    messagingChannel,
    externalId: scopedId ? `${input.channel}:${scopedId}` : null,
    pageScopedUserId: input.channel === "messenger" ? scopedId : null,
    igSid: input.channel === "instagram" ? scopedId : null,
    igAccountId:
      input.channel === "instagram"
        ? process.env.META_IG_ACCOUNT_ID ??
          process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID ??
          activeInstagram?.instagram_business_account_id ??
          null
        : null,
  };
}

export interface CapiEventPayload {
  event_name: string;
  event_time: number;
  event_id: string;
  action_source: string;
  messaging_channel?: string;
  user_data: Record<string, unknown>;
  custom_data?: Record<string, unknown>;
}

interface CapiPostResult {
  ok: boolean;
  status: number;
  responseText: string;
}

/**
 * LOS CUATRO DATOS QUE META EXIGE QUE ENCAJEN, SACADOS DE LA TIENDA QUE VENDIÓ.
 *
 * LO PIDIÓ EL DUEÑO el 01/10/2026: «para marcar la compra se necesita waba, numero,
 * pagina y pixel (asi le digo pixel al dataset)». De los cuatro, el número y la WABA
 * ya salían de la conexión por la que entró la conversación; la página y el pixel
 * salían del ACTIVO, que con varios números es el equivocado.
 *
 * Es la mejora 2 de `PLAN-MEDICION-META-CAPI.md`, medida y aparcada el 24/09 porque
 * entonces vendía con un número solo. Con varios ya no se puede aparcar.
 *
 * VACÍO MANDA LO DE SIEMPRE: sin tienda, o con su casilla en blanco, se cae a la
 * variable de entorno y al activo igual que antes. Una instalación de un número no
 * nota nada.
 *
 * Y LA OTRA MITAD YA ESTÁ HECHA: `whatsapp_business_account_id` DEJÓ DE MANDARSE el 3 de
 * octubre de 2026, que era la mejora 1 de ese mismo plan. Las dos fueron en su propio
 * commit, como estaba previsto. El porqué, con la documentación de Meta que lo respalda,
 * está escrito más abajo, donde vivían esas dos líneas.
 */
function laMedicionDeLaTienda(conversationId: number | null | undefined): {
  pagina: string | null;
  pixel: string | null;
} {
  // Medir no puede romper una venta: si la fila no se puede leer, se mide como antes
  // de este campo en vez de dejar la compra sin registrar.
  let suya = null;
  try {
    suya = conversationId
      ? laTiendaDeLaConversacion(getConversationById(conversationId))
      : null;
  } catch {
    suya = null;
  }
  return {
    pagina: String(suya?.pagina ?? "").trim() || null,
    pixel: String(suya?.pixel ?? "").trim() || null,
  };
}

/**
 * CON QUÉ PERMISO SE AVISA A META DE LAS COMPRAS DE ESTA TIENDA. null = con el de siempre.
 *
 * LO APROBÓ EL DUEÑO el 10/10/2026, parte 2 de PLAN-VARIAS-CUENTAS-DE-FACEBOOK.md.
 *
 * EL FALLO QUE CIERRA: había UN permiso para todas las tiendas. Con dos cuentas de
 * Facebook, las compras de la tienda de la otra cuenta se mandaban con un permiso que no
 * es suyo y Meta las rechazaba — sin que la venta diera ningún error.
 *
 * LA CUENTA SALE DEL NÚMERO DE LA TIENDA (o de su página, en Messenger), y su permiso de
 * `permisoDeMedicionDeLaCuenta`, que solo devuelve algo para una cuenta con permanente
 * propio o conectada como «nueva». CON UNA SOLA CUENTA, y mientras no se le genere un
 * permanente desde su tarjeta, DEVUELVE null, y la compra se mide exactamente como antes.
 *
 * MEDIR NO PUEDE ROMPER UNA VENTA: cualquier fallo al leer devuelve null.
 */
function elPermisoDeLaTienda(conversationId: number | null | undefined): string | null {
  try {
    if (!conversationId) return null;
    const tienda = laTiendaDeLaConversacion(getConversationById(conversationId));
    if (!tienda) return null;
    const numero = String(tienda.numero ?? "").trim();
    const pagina = String(tienda.pagina ?? "").trim();
    const cuenta =
      (numero ? getMetaWhatsAppConnection(numero)?.business_id : null) ??
      (pagina ? getMetaConnectionByPageId(pagina)?.business_id : null) ??
      null;
    return cuenta ? permisoDeMedicionDeLaCuenta(cuenta) : null;
  } catch {
    return null;
  }
}

function buildUserData(
  data: CapiUserData,
  /** La conversación, para poder preguntar por SU tienda. Sin ella se mide como
   *  siempre — es el caso del evento de prueba, que no es de nadie. */
  conversationId?: number
): Record<string, unknown> {
  const ud: Record<string, unknown> = {};
  const phHash = hashPhone(data.phone);
  if (phHash) ud.ph = [phHash];
  const emHash = hashText(data.email);
  if (emHash) ud.em = [emHash];
  const fnHash = hashText(data.firstName);
  if (fnHash) ud.fn = [fnHash];
  const lnHash = hashText(data.lastName);
  if (lnHash) ud.ln = [lnHash];
  if (data.ctwa_clid) ud.ctwa_clid = data.ctwa_clid;
  const externalIdHash = hashText(data.externalId);
  if (externalIdHash) ud.external_id = [externalIdHash];
  if (data.messagingChannel === "instagram" && data.igSid) {
    ud.ig_sid = data.igSid;
  }
  if (data.messagingChannel === "messenger" && data.pageScopedUserId) {
    ud.page_scoped_user_id = data.pageScopedUserId;
  }
  const activeMeta = getActiveMetaConnection();
  const activeInstagram = getActiveInstagramMetaConnection();
  const igAccountId =
    data.igAccountId ??
    process.env.META_IG_ACCOUNT_ID ??
    process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID ??
    activeInstagram?.instagram_business_account_id;
  if (data.messagingChannel === "instagram" && igAccountId) {
    ud.ig_account_id = igAccountId;
  }
  /**
   * EL IDENTIFICADOR DE LA WABA YA NO SE MANDA — 3 de octubre de 2026.
   *
   * AQUÍ IBA ESTO, y es lo que se quita:
   *
   *     const wabaId = getWhatsAppRuntimeConfig().wabaId;
   *     if (wabaId) ud.whatsapp_business_account_id = wabaId;
   *
   * DE DÓNDE SALIÓ. Se rastreó su historia: entró el 17 de julio de 2026 en otro proyecto
   * (`AGENTE-KPOP`, commit `d03d03a`), COLADO dentro de un cambio que iba de otra cosa —
   * añadir el evento de «inició el pago»—. El commit no dice por qué, y de ahí se copió de
   * proyecto en proyecto hasta aquí. Nadie lo decidió: viajó.
   *
   * LO QUE COSTÓ. Meta valida que el conjunto de datos esté asociado a esa WABA en cuanto
   * recibe el dato, y si no lo está devuelve 2804132 y RECHAZA la venta. El 14 de agosto, en
   * `MULTI AGENTE 1`, hay un commit persiguiendo ese mismo 2804132 sin dar con la causa.
   *
   * POR QUÉ SE PUEDE QUITAR, y esto se verificó en la documentación de Meta el mismo día:
   * la lista oficial de datos de `user_data` —em, ph, fn, ln, db, ge, ct, st, zp, country,
   * external_id, client_ip_address, client_user_agent, fbc, fbp, subscription_id,
   * fb_login_id, lead_id, anon_id, madid, page_id, page_scoped_user_id, ctwa_clid,
   * ig_account_id, ig_sid— NO INCLUYE la WABA. Meta no lo usa para emparejar ni para
   * optimizar. Mandarlo no aportaba nada y encima exigía un trámite.
   *
   *   developers.facebook.com/docs/marketing-api/conversions-api/parameters/
   *   customer-information-parameters
   *
   * Y el proyecto anterior del dueño —el que vivió en su escritorio antes de éste— nunca lo
   * mandó: funcionó meses con solo `ctwa_clid` y `page_id`, y las compras se registraban.
   *
   * QUÉ GANA ÉL. Vende con varios números repartidos en varios business, y cada uno tiene su
   * propia WABA. Con este dato, cada conjunto de datos habría que asociarlo a la WABA del
   * número que atendiera, o la venta se perdía. Sin él, le basta con la página y el conjunto
   * de datos — su forma de trabajar de siempre. Con sus palabras: «lo que yo necesito es no
   * asociar WABA con pixel, ese camino no lo necesito».
   *
   * LO QUE NO SE PUEDE VERIFICAR DESDE AQUÍ, y queda dicho: que la atribución sea igual de
   * buena. Si empeorara NO daría error — atribuiría menos ventas, en silencio. Solo se ve
   * comparando ventas registradas contra ventas reales durante unos días. A favor: no está
   * en la lista de Meta, y su bot viejo vivió sin él.
   *
   * SE QUEDA TODO LO DEMÁS: `page_id` (ése sí es obligatorio de verdad, 2804069 si falta),
   * `ctwa_clid`, `business_messaging`, `messaging_channel` y las compras orgánicas como
   * `system_generated`.
   */
  // page_id: ID de la pagina de Facebook vinculada al WABA. Meta lo exige
  // como parametro en user_data para eventos con action_source=business_messaging
  // y messaging_channel=whatsapp (subcode 2804069 si falta).
  //
  // Y LA PÁGINA DE LA TIENDA MANDA, cuando la tiene puesta. Antes salía siempre la
  // ACTIVA: con tres números, las ventas de dos de ellos se reportaban con la página
  // del tercero y Meta las rechazaba sin que la venta diera ningún error.
  const pageId =
    laMedicionDeLaTienda(conversationId).pagina ??
    process.env.META_PAGE_ID ??
    activeMeta?.page_id;
  if (pageId) ud.page_id = pageId;
  return ud;
}

async function postEvent(
  payload: CapiEventPayload,
  /** Para poder avisar en el panel si este evento no llegó. Sin id no se anota
   *  nada — es el caso del evento de prueba, que no es de nadie. */
  conversationId?: number
): Promise<CapiPostResult | null> {
  // EL PIXEL DE LA TIENDA MANDA; si no tiene, el elegido en la pantalla, y si no,
  // las variables de siempre. Así cada número reporta a su propio conjunto de datos
  // —lo pidió el dueño el 01/10/2026— y una instalación de un número no cambia.
  const pixelId = laMedicionDeLaTienda(conversationId).pixel ?? getCapiPixelId();
  // EL PERMISO DE LA CUENTA DE LA TIENDA MANDA, cuando su cuenta tiene uno propio. Si no:
  // el elegido en la pantalla, la variable de siempre, o el de la conexión — lo de antes.
  // Ver `elPermisoDeLaTienda`.
  const token = elPermisoDeLaTienda(conversationId) ?? getCapiAccessToken();
  /**
   * A DÓNDE VA ESTE EVENTO, para que el panel se lo pueda enseñar.
   *
   * Se calcula aquí porque aquí es donde se sabe de verdad: el pixel ya resuelto
   * —con el de la tienda por delante— y la página tal como viaja en el evento.
   * El nombre de la tienda se pregunta aparte y no puede tumbar un envío.
   *
   * SE ANOTA TAMBIÉN CUANDO SALE BIEN. Es el motivo de que exista: un pixel
   * equivocado no da error, Meta lo acepta y la compra cae en el conjunto de
   * datos de al lado. Sin esto el panel decía «enviado» y no había nada que
   * delatara el destino.
   */
  const aDondeVa = (): Parameters<typeof registrarEventoCapi>[4] => {
    let tienda: string | null = null;
    try {
      tienda = conversationId
        ? laTiendaDeLaConversacion(getConversationById(conversationId))?.nombre ?? null
        : null;
    } catch {
      tienda = null;
    }
    const ud = payload.user_data as Record<string, unknown>;
    return {
      pixel: pixelId ?? null,
      pagina: typeof ud?.page_id === "string" ? ud.page_id : null,
      tienda,
    };
  };
  if (!pixelId || !token) {
    console.warn(
      "[capi] META_CAPI_PIXEL_ID o META_CAPI_ACCESS_TOKEN no configurados, no se envía evento"
    );
    return null;
  }

  const url = `https://graph.facebook.com/${META_API_VERSION}/${pixelId}/events`;
  const body: Record<string, unknown> = {
    data: [payload],
    access_token: token,
  };

  const testCode = process.env.META_CAPI_TEST_EVENT_CODE;
  if (testCode) body.test_event_code = testCode;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      // DIAG: muestra EXACTAMENTE qué IDs mandó el bot en el evento fallido (no son
      // secretos). Sirve para ver si el dataset, la WABA y la página son los que
      // esperas — clave para el error 2804132 (dataset sin WABA asociada): si la
      // `waba` de aquí no es la correcta, el problema es el dato que envía el bot,
      // no la configuración en Meta.
      const ud = payload.user_data as Record<string, unknown>;
      console.error(
        `[capi][diag] evento ${payload.event_name} -> dataset=${pixelId} ` +
          // Desde el 3/10/2026 esto sale SIEMPRE «(NINGUNA)», y así debe ser: el bot dejó de
          // mandar la WABA. Se deja impreso a propósito — si algún día volviera a aparecer
          // aquí un valor, es que alguien la reintrodujo, y con ella el 2804132.
          `waba=${ud.whatsapp_business_account_id ?? "(NINGUNA)"} ` +
          `page=${ud.page_id ?? "(NINGUNA)"} channel=${payload.messaging_channel ?? "-"}`
      );
      console.error(
        `[capi] evento ${payload.event_name} falló (${res.status}): ${text}`
      );
      if (conversationId) {
        registrarEventoCapi(conversationId, payload.event_name, false, text, aDondeVa());
      }
      return { ok: false, status: res.status, responseText: text };
    }
    const text = await res.text();
    console.log(
      `[capi] evento ${payload.event_name} enviado (event_id=${payload.event_id})`
    );
    if (conversationId) {
      registrarEventoCapi(conversationId, payload.event_name, true, null, aDondeVa());
    }
    return { ok: true, status: res.status, responseText: text };
  } catch (err) {
    console.error(`[capi] error enviando evento ${payload.event_name}:`, err);
    const motivo = err instanceof Error ? err.message : String(err);
    if (conversationId) {
      registrarEventoCapi(conversationId, payload.event_name, false, motivo, aDondeVa());
    }
    return { ok: false, status: 0, responseText: motivo };
  }
}

export interface PurchaseEventArgs {
  conversationId: number;
  userData: CapiUserData;
  /** Monto en la moneda especificada (ej. 10 para S/.10). */
  value: number;
  /** Código ISO de moneda (ej. "PEN" para soles peruanos). */
  currency: string;
}

/**
 * ¿La compra entró por un anuncio, o el cliente llegó orgánico?
 *
 * En WhatsApp, Meta solo puede colgar el evento de un anuncio si llega el
 * `ctwa_clid` (el identificador del click). En Messenger e Instagram no hace
 * falta: ahí el usuario ya viene identificado por su ID de página o de IG, así
 * que esos canales no se consideran orgánicos aquí y no cambian de camino.
 */
function esCompraOrganica(userData: CapiUserData): boolean {
  const channel = userData.messagingChannel ?? "whatsapp";
  return channel === "whatsapp" && !userData.ctwa_clid;
}

/**
 * Arma el evento de compra. Va aparte del envío para poder comprobarlo sin
 * llamar a Meta.
 *
 * Dos caminos según de dónde vino el cliente:
 *
 *  - Vino de un anuncio: `business_messaging`, que es el camino que Meta
 *    atribuye al anuncio, con el `ctwa_clid` dentro.
 *
 *  - Entró orgánico: `business_messaging` lo rechazaría (subcode 2804071)
 *    porque no hay click al cual atribuir, y antes por eso la compra no se
 *    reportaba en absoluto. Ahora se manda como `system_generated` — el mismo
 *    camino que ya usaba el evento de prueba — con el teléfono hasheado como
 *    dato de emparejamiento. La compra queda registrada en el dataset sin
 *    colgarse de ningún anuncio.
 */
export function buildPurchasePayload(args: PurchaseEventArgs): CapiEventPayload {
  const organica = esCompraOrganica(args.userData);
  const eventTime = Math.floor(Date.now() / 1000);
  return {
    event_name: "Purchase",
    event_time: eventTime,
    event_id: `purchase_${args.conversationId}_${eventTime}`,
    action_source: organica ? "system_generated" : "business_messaging",
    // messaging_channel solo tiene sentido acompañando a business_messaging.
    ...(organica
      ? {}
      : { messaging_channel: args.userData.messagingChannel ?? "whatsapp" }),
    user_data: buildUserData(args.userData, args.conversationId),
    custom_data: {
      value: args.value,
      currency: args.currency,
    },
  };
}

/**
 * Reporta una compra confirmada a Meta. Se hashean los datos personales
 * antes de enviarlos. Si falta config (Pixel ID + Token) loguea y sigue
 * — no bloquea ni rompe el flujo del bot.
 */
export async function sendPurchaseEvent(args: PurchaseEventArgs): Promise<void> {
  if (isTestConversation(args.conversationId)) {
    console.log(`[test] CAPI Purchase suprimido para convo ${args.conversationId}`);
    return;
  }
  const payload = buildPurchasePayload(args);
  if (esCompraOrganica(args.userData)) {
    console.log(
      `[capi] convo ${args.conversationId} sin ctwa_clid (cliente orgánico): ` +
        `Purchase enviado como ${payload.action_source}, sin atribuir a ningún anuncio`
    );
  }
  await postEvent(payload, args.conversationId);
}

export interface ContactEventArgs {
  conversationId: number;
  userData: CapiUserData;
}

export interface InitiateCheckoutEventArgs {
  conversationId: number;
  userData: CapiUserData;
  value?: number;
  currency?: string;
  paymentMethod?: string | null;
}

export interface TestPurchaseEventArgs {
  value: number;
  currency: string;
}

/**
 * Reporta un contacto inicial a Meta — cuando un cliente nuevo escribe
 * por primera vez al bot. Sirve para optimizar ads que buscan
 * conversaciones reales.
 *
 * Nota 1: usamos `LeadSubmitted` y NO `Contact` porque Meta solo acepta
 * un subset de eventos para action_source=business_messaging. "Contact"
 * da error 400 (subcode 2804066) en este contexto; "LeadSubmitted" es el
 * estándar para "lead llegado por mensaje".
 *
 * Nota 2: solo enviamos si hay `ctwa_clid` — Meta lo exige obligatoriamente
 * (subcode 2804071). Sin click_id no hay anuncio al cual atribuir.
 */
export async function sendContactEvent(args: ContactEventArgs): Promise<void> {
  if (isTestConversation(args.conversationId)) {
    console.log(`[test] CAPI LeadSubmitted suprimido para convo ${args.conversationId}`);
    return;
  }
  const channel = args.userData.messagingChannel ?? "whatsapp";
  if (channel === "whatsapp" && !args.userData.ctwa_clid) {
    console.log(
      `[capi] convo ${args.conversationId} sin ctwa_clid (cliente orgánico, no vino de ad), saltando LeadSubmitted`
    );
    return;
  }
  const eventTime = Math.floor(Date.now() / 1000);
  await postEvent(
    {
      event_name: "LeadSubmitted",
      event_time: eventTime,
      event_id: `lead_${args.conversationId}_${eventTime}`,
      action_source: "business_messaging",
      messaging_channel: channel,
      user_data: buildUserData(args.userData, args.conversationId),
    },
    args.conversationId
  );
}

/**
 * Reporta cliente caliente: ya pidio o recibio datos de pago. No aprueba
 * venta; solo alimenta optimizacion antes del Purchase real.
 */
export async function sendInitiateCheckoutEvent(
  args: InitiateCheckoutEventArgs
): Promise<void> {
  if (isTestConversation(args.conversationId)) {
    console.log(`[test] CAPI InitiateCheckout suprimido para convo ${args.conversationId}`);
    return;
  }
  const channel = args.userData.messagingChannel ?? "whatsapp";
  if (channel === "whatsapp" && !args.userData.ctwa_clid) {
    console.log(
      `[capi] convo ${args.conversationId} sin ctwa_clid (cliente organico, no vino de ad), saltando InitiateCheckout`
    );
    return;
  }
  const eventTime = Math.floor(Date.now() / 1000);
  const customData: Record<string, unknown> = {};
  if (typeof args.value === "number" && Number.isFinite(args.value)) {
    customData.value = args.value;
  }
  if (args.currency) customData.currency = args.currency;
  if (args.paymentMethod) customData.payment_method = args.paymentMethod;
  await postEvent(
    {
      event_name: "InitiateCheckout",
      event_time: eventTime,
      event_id: `checkout_${args.conversationId}_${eventTime}`,
      action_source: "business_messaging",
      messaging_channel: channel,
      user_data: buildUserData(args.userData, args.conversationId),
      ...(Object.keys(customData).length ? { custom_data: customData } : {}),
    },
    args.conversationId
  );
}

/**
 * Prueba interna para Events Manager -> Test Events. No toca conversaciones,
 * no entrega producto y no marca ventas reales. Solo funciona si hay
 * META_CAPI_TEST_EVENT_CODE configurado.
 */
export async function sendTestPurchaseEvent(
  args: TestPurchaseEventArgs
): Promise<CapiPostResult> {
  if (!process.env.META_CAPI_TEST_EVENT_CODE) {
    throw new Error("META_CAPI_TEST_EVENT_CODE no configurado");
  }
  const eventTime = Math.floor(Date.now() / 1000);
  const result = await postEvent({
    event_name: "Purchase",
    event_time: eventTime,
    event_id: `test_purchase_${eventTime}`,
    action_source: "system_generated",
    user_data: buildUserData({
      phone: "51999999999",
      firstName: "Prueba",
    }),
    custom_data: {
      value: args.value,
      currency: args.currency,
      test: true,
    },
  });
  if (!result) {
    throw new Error("META_PIXEL_ID/META_CAPI_ACCESS_TOKEN no configurados");
  }
  if (!result.ok) {
    throw new Error(`Meta rechazo el evento (${result.status}): ${result.responseText}`);
  }
  return result;
}
