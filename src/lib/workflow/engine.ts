import {
  activateDiscount,
  addToPaidTotal,
  cancelPendingActionsByTypeForConvo,
  cancelPendingActionsForConvo,
  claimDeliveryPreference,
  countPendingActionsInWindow,
  deleteConversation,
  getConversationById,
  getLockedPriceSoles,
  getLastUserMessageTime,
  getLatestUserMessage,
  getRecentHistory,
  getRecentUserMessages,
  getConversationsForFollowupBackfill,
  getSentMedia,
  hasFuturePendingActionType,
  hasPendingActionType,
  hasUserMessageSinceFollowupStart,
  markMediaSent,
  scheduleAction,
  setBiofertaChoice,
  setCommercialSalesRoute,
  setOrderBumpChoice,
  markOrderBumpRevealed,
  marcarAvisoDeActualizacionEnviado,
  fijarVarianteDeSeguimientoEnviada,
  setUpsellState,
  moverLaFila,
  pararLaFila,
  getPuestoEnLaFila,
  marcarRecordatorioUpsellEnviado,
  setUpsellBaseCents,
  getUpsellFrozenPrices,
  setUpsellFrozenPrices,
  setUpsellHabladoAt,
  setUltimaDecision,
  contarMensajesDelBotDespuesDe,
  setOrderBumpPriceConfirmPending,
  setOrderBumpChoiceStale,
  setIntroPausedIndex,
  setIntroVariantSent,
  setCaminoDeLaConversacion,
  setPendingDeliverySource,
  setSelectedPaymentMethod,
  setClientEmail,
  setClientName,
  setConversationState,
  setEmailReminderSent,
  setGiftReminderSent,
  setGiftRewarded,
  setLockedPrice,
  setCustomerSurveySent,
  setLastFollowupIndex,
  setLastFollowupStartedAt,
  setMode,
  type ConversationRow,
  type ScheduledActionRow,
  type WorkflowState,
} from "@/lib/db";
import {
  withOutboundWhatsAppNumber,
  withOutboundMessengerPage,
} from "@/lib/meta/runtime-config";
import {
  conLaPresentacionDeLaConversacion,
  conElTurnoDe,
  withModalidadDePrueba,
} from "@/lib/workflow/config";
import { esComprobantePdf } from "@/lib/meta/media";
import {
  adjustForQuietHours,
  computeNextFollowupSlot,
  cumulativeBurstOffset,
  isAtOrAfterLocalTime,
  isQuietHour,
  nextLocalTime,
} from "@/lib/workflow/quiet-hours";
import { literal } from "@/lib/texto-literal";

// Defaults para el sistema de slots si el YAML no define followup_schedule.
const DEFAULT_FOLLOWUP_SLOTS = ["12:00", "18:00", "21:45"];
const DEFAULT_MIN_GAP_HOURS = 4;
const DEFAULT_BURST_DELAYS = [15, 21, 27, 32];

// Check proactivo de ventana 24h Meta: si paso este tiempo desde el ultimo
// mensaje del cliente, cancelamos el seguimiento sin llamar a Meta API
// (la API rechazaria con error 131047 - "more than 24 hours" y eso queda
// como senal debil de calidad). Usamos 23h53m = 7 min de margen para
// cubrir clock drift y latencia red.
const META_24H_WINDOW_CUTOFF_SEC = (24 * 60 - 7) * 60; // 85,620 seg = 23h53m

function clampPercent(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return Math.min(100, Math.max(0, n));
}

function stablePercentFromPhone(phone: string | null | undefined): number {
  const raw = String(phone ?? "");
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = (hash * 31 + raw.charCodeAt(i)) >>> 0;
  }
  return hash % 100;
}

function configuredCommercialRoute(
  convo: ConversationRow | undefined,
  config: WorkflowConfig
): "A" | "B" {
  const saved = convo?.commercial_sales_route;
  if (saved === "A" || saved === "B") return saved;
  const routes = config.commercial_routes;
  const canUseRouteB =
    routes?.enabled === true &&
    isOrderBumpActive() &&
    Array.isArray(routes.route_b_closing_steps) &&
    routes.route_b_closing_steps.some((step) => step.enabled !== false);
  if (!canUseRouteB) return "A";
  const percent = clampPercent(routes.route_b_percentage);
  return stablePercentFromPhone(convo?.phone) < percent ? "B" : "A";
}

function isCommercialRouteB(convo: ConversationRow | null | undefined): boolean {
  return convo?.commercial_sales_route === "B";
}

function routeBReplaceLastIntroSteps(config: WorkflowConfig): number {
  const raw = config.commercial_routes?.replace_last_intro_steps;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 1;
  return Math.max(0, Math.floor(raw));
}
import {
  applyCustomPlaceholders,
  applyProductName,
  aplicarProductoEntregado,
  sorteaCajonDeIntro,
  usaRespaldoEntrePaises,
  usaRespaldoEntreTiendas,
  aLaTiendaLeFaltaLoSuyo,
  detectBiofertaChoice,
  detectTwoTierPick,
  detectDynamicPaymentMethod,
  getDefaultPaymentMethodId,
  getEffectiveCountryCode,
  inferTwoTierChoiceFromContext,
  isAmbiguousTwoTierChoice,
  getBiofertaPriceSoles,
  getEffectivePriceSoles,
  getImageGallery,
  getSamplesAfterSequence,
  getPaymentButtons,
  getPaymentMethods,
  getPaymentMethodsList,
  getPaymentText,
  getProductInfoTopics,
  getProgressiveSamplesConfig,
  isCountrySalesEnabled,
  getOrderBumpPriceSoles,
  mercadoConRespaldo,
  preciosDeLaFichaEnElPais,
  getOrderBumpOptionForCountry,
  nombreDeLaOpcion,
  type OrderBumpOption,
  isPriceQuestion,
  soloEstaDeAcuerdo,
  isSpecificOrderBumpPriceQuestion,
  getActiveWorkflowChannel,
  isDiscountActiveForConversation,
  isBiofertaActive,
  isUpsellUsable,
  queLeFaltaAlUpsell,
  seccionUpsell,
  conLaFilaDe,
  laConversacionDeLaFila,
  prepararElSiguienteDeLaFila,
  elDownsellQueToca,
  segundosDelPlazoDeLaOferta,
  preciosDeLaOfertaDeLaFila,
  entregaDeLaFila,
  getUpsellPriceSoles,
  detectaAceptacionDeUpsell,
  botonDelUpsell,
  botonDelRegalo,
  decisionQueCoincide,
  decisionesEncendidas,
  detectaSiSimpleAlUpsell,
  laOpcionQueElBotPropuso,
  type BubbleDecision,
  type DecisionAction,
  detectaRechazoDeUpsell,
  cuerpoDeBotones,
  titulosDeBotones,
  getActiveModalityKey,
  getBiofertaIntroChoiceOptions,
  shouldOfferBiofertaChoiceOnIntro,
  isOrderBumpActive,
  isDobleOfertaActive,
  getActiveTwoTierOffer,
  semimodalidadActiva,
  semimodalidadDe,
  porSemimodalidad,
  soloDeSuTienda,
  tiendasDe,
  laTiendaQueAtiende,
  type Semimodalidad,
  seccionDobleOferta,
  detectaIntencionDeSubirAlCombo,
  queProductoNombra,
  loadWorkflowConfig,
  resolveCountryPaymentProfile,
  withWorkflowChannel,
  DEFAULT_BETWEEN_MESSAGES_DELAY,
  DEFAULT_CUSTOMER_SURVEY_MESSAGE,
  pickVariant,
  renderOrderBumpTemplate,
  hayQueAvisarDeLaActualizacion,
  resolveSpintax,
  sectionHasPlaceholder,
  type SalesbotRule,
  type FollowupSequence,
  type BubbleButton,
  type ResponseStep,
  type SequenceStep,
  type WorkflowConfig,
  type ModalidadKey,
} from "@/lib/workflow/config";
// LOS CAMINOS (18/10/2026). Ver `etiqueta-de-camino.ts`.
import { caminosDe, porCamino } from "@/lib/workflow/etiqueta-de-camino";
import { DEFAULT_SAMPLES_AFTER_TEXT } from "@/lib/workflow/defaults";
import {
  getMessengerCountryReminderMessage,
  MESSENGER_COUNTRY_REMINDER_ACTION,
} from "@/lib/workflow/messenger-country";
import {
  deliverBiofertaTier,
  resolveAccumulatedOrderBumpChoice,
  resendApprovedMaterial,
  scheduleDeliveryBySource,
  type DeliverySource,
} from "@/lib/workflow/payment";
import {
  expandirCajonesDePagoDelPais,
  sendBotButtons,
  sendBotButtonsWithMedia,
  sendBotMediaFromDrive,
  enviarMuestraDeGaleria,
  sendBotText,
} from "@/lib/workflow/sender";
import { sendEmail } from "@/lib/email";
import { notifyAdmin } from "@/lib/notifications";
import { formatCurrencyAmount, getCountryInfo } from "@/lib/countries";
import {
  buildMessagingUserData,
  sendContactEvent,
  sendInitiateCheckoutEvent,
} from "@/lib/meta/conversions";
import {
  deleteLeadForConversation,
  markFollowupSent,
  syncLeadStatus,
} from "@/lib/leads-sync";

/**
 * Acciones programables en la tabla scheduled_actions.
 *  - send_intro_step: dispara el paso N de la secuencia intro
 *
 * «fallback_intro» ESTABA AQUÍ Y SE RETIRA. Era el rescate que soltaba la intro
 * si el cliente no contestaba al saludo. El saludo ya no espera, así que nadie
 * la programa.
 *
 * Se queda en la lista SOLO por las filas viejas: una conversación puede tener
 * una apuntada de antes del cambio. Al procesarla no coincide con ninguna rama,
 * el motor no hace nada y el worker la da por terminada. Quitarla del tipo no
 * cambiaría eso, pero dejaría el tipo mintiendo sobre lo que hay en la tabla.
 */
type ActionType =
  | "send_intro_step"
  | "fallback_intro"
  | "send_payment_step"
  | "send_text_chunk"
  | "send_post_sale_delivery_step"
  | "send_delivery_preference"
  | "send_payment_approved_step"
  | "send_gift_consent"
  | "send_gift_consent_step"
  | "send_gift_step"
  | "send_gift_audio"
  | "send_gift_text"
  | "send_email_reminder"
  | "send_customer_survey"
  | "exit_awaiting_email"
  | "intro_reanudar"
  | "auto_switch_human_after_gift_comment"
  | "auto_switch_human_after_venezuela_notice"
  | "messenger_country_reminder"
  | "start_followup"
  | "upsell_timeout"
  | "upsell_presentar"
  | "upsell_recordatorio"
  | "send_followup_step";

interface SendIntroStepPayload {
  step_index: number;
  is_last: boolean;
  variant?: number;
  commercial_sales_route?: "A" | "B";
  skip_intro_step?: boolean;
}

interface SendPaymentStepPayload {
  route: string;
  step_index: number;
  /** Opción del Order Bump cuya respuesta de pago debe usarse. Ausente =
   *  respuesta global del modo unitario. */
  order_bump_choice?: "combo" | "basico";
  /** Precio efectivo fijado al confirmar el método. */
  price_soles?: number;
  direct_payment?: boolean;
  direct_payment_mode?: "with_choice" | "without_choice";
  /** El operador ya presentó el pago con SU texto, así que del de fábrica se
   *  saltan las frases de delante del cajón con los datos.
   *
   *  VIAJA EN EL SOBRE A PROPÓSITO. El worker no reenvía la burbuja que se
   *  guardó: vuelve a pedir la lista y la busca POR SU NÚMERO. Si el recorte se
   *  hiciera solo al programar, los números dejarían de coincidir y mandaría
   *  otra burbuja — los datos dos veces y el cierre nunca. Recortando en los dos
   *  sitios con la misma regla, la lista es la misma aquí y allí. */
  sin_presentacion?: boolean;
  /** Nombre anterior del de arriba. Se sigue leyendo para que las acciones que
   *  ya estaban en la cola al desplegar se envíen bien y no se descuadren. */
  direct_payment_sin_presentacion?: boolean;
  /** ESTAS SON LAS DEL SEGUNDO PRODUCTO, NO LAS DEL PRIMERO.
   *
   *  El worker no guarda la burbuja: vuelve a pedir la lista y la busca por su
   *  número. Y pedía siempre la del producto principal. Mientras el extra no
   *  tuvo respuestas propias no se notaba —las dos listas eran la misma—, pero
   *  en cuanto se le escribe una suya, la PRIMERA burbuja salía de la del extra
   *  y las siguientes de la del curso: dos textos distintos cosidos, con la
   *  cuenta del primero. */
  upsell?: boolean;
  render_two_tier_prices?: boolean;
}

interface SendTextChunkPayload {
  body: string;
}

interface SendPostSaleDeliveryStepPayload {
  step: ResponseStep;
}

interface SendDeliveryPreferencePayload {
  source?: DeliverySource;
}

interface SendPaymentApprovedStepPayload {
  step_index: number;
  is_last: boolean;
  /** De qué secuencia entregar. "approved" (por defecto) = la
   *  payment_approved_sequence existente (producto principal).
   *  Bioferta: "bioferta_a" / "bioferta_b" = entrega de cada producto;
   *  "bioferta_pack" = el pack.
   *  Order bump: "ob_combo" / "ob_basico" = entrega de esa opción.
   *  "upsell" = el segundo producto, vendido después de entregar el primero. */
  source?:
    | "approved"
    | "upsell"
    | "bioferta_a"
    | "bioferta_b"
    | "bioferta_pack"
    | "ob_combo"
    | "ob_basico";
  /** UPSELLS EN FILA, solo en el reenvío de «no me llegó»: de QUÉ compra de la fila es
   *  esta burbuja. Un id = ese producto; "" = el upsell de siempre. Sin el campo, la de
   *  siempre: la del upsell en curso. Ver `entregasDeLoCompradoEnLaFila`. */
  fila_producto?: string;
}

interface SendGiftStepPayload {
  step_index: number;
  is_last: boolean;
}

interface StartFollowupPayload {
  /** Indice de la secuencia en la fuente con que se programo (0-based). */
  sequence_index: number;
  channel?: string;
  modality?: ModalidadKey;
}

interface SendFollowupStepPayload {
  sequence_index: number;
  channel?: string;
  modality?: ModalidadKey;
  variant_index?: number;
  step_index: number;
  is_last: boolean;
}

// AQUÍ ESTABA «fallback_intro», Y SE BORRA. Era el rescate de la intro cuando
// el saludo se quedaba esperando respuesta. El saludo ya no espera.
const ACTION_SEND_INTRO_STEP: ActionType = "send_intro_step";
const ACTION_SEND_PAYMENT_STEP: ActionType = "send_payment_step";
const ACTION_SEND_TEXT_CHUNK: ActionType = "send_text_chunk";
const ACTION_SEND_POST_SALE_DELIVERY_STEP: ActionType =
  "send_post_sale_delivery_step";
const ACTION_SEND_DELIVERY_PREFERENCE: ActionType = "send_delivery_preference";
const ACTION_SEND_PAYMENT_APPROVED_STEP: ActionType =
  "send_payment_approved_step";
const ACTION_SEND_GIFT_CONSENT: ActionType = "send_gift_consent";
const ACTION_SEND_GIFT_CONSENT_STEP: ActionType = "send_gift_consent_step";
const ACTION_SEND_GIFT_STEP: ActionType = "send_gift_step";
const ACTION_SEND_GIFT_AUDIO: ActionType = "send_gift_audio";
const ACTION_SEND_GIFT_TEXT: ActionType = "send_gift_text";
const ACTION_SEND_EMAIL_REMINDER: ActionType = "send_email_reminder";
const ACTION_SEND_CUSTOMER_SURVEY: ActionType = "send_customer_survey";
const ACTION_EXIT_AWAITING_EMAIL: ActionType = "exit_awaiting_email";
const ACTION_INTRO_REANUDAR: ActionType = "intro_reanudar";
/**
 * Cuánto se espera una elección a mitad de la intro antes de seguir sin ella.
 *
 * La intro no puede quedarse detenida para siempre por una pregunta opcional:
 * quien no contesta merece ver el resto igual. Tres minutos es tiempo de sobra
 * para tocar un botón y poco para que se note el corte.
 */
const ESPERA_DE_ELECCION_EN_INTRO_SEGUNDOS = 180;
const ACTION_AUTO_SWITCH_HUMAN_AFTER_GIFT_COMMENT: ActionType =
  "auto_switch_human_after_gift_comment";
const ACTION_AUTO_SWITCH_HUMAN_AFTER_VENEZUELA_NOTICE: ActionType =
  "auto_switch_human_after_venezuela_notice";
const ACTION_MESSENGER_COUNTRY_REMINDER: ActionType =
  MESSENGER_COUNTRY_REMINDER_ACTION;
/** Vence el plazo del upsell: sale el regalo, pero la oferta sigue en pie. */
const ACTION_UPSELL_TIMEOUT: ActionType = "upsell_timeout";
/** Toca ofrecer el producto extra, pasados los minutos de espera. */
const ACTION_UPSELL_PRESENTAR: ActionType = "upsell_presentar";
/**
 * Toca RECORDAR el producto extra. No es lo mismo que presentarlo.
 *
 * Presentar es la intro entera —sus burbujas, su galería, sus botones—. Esto es
 * una línea suya, escrita en el editor, que sale UNA vez y no se repite.
 */
const ACTION_UPSELL_RECORDATORIO: ActionType = "upsell_recordatorio";
const ACTION_START_FOLLOWUP: ActionType = "start_followup";
const ACTION_SEND_FOLLOWUP_STEP: ActionType = "send_followup_step";
const choicePresentationWindows = new Map<
  number,
  { state: WorkflowState; startAt: number; endAt: number | null; keepUntil: number }
>();

function adIdsForKeys(
  config: NonNullable<ReturnType<typeof loadWorkflowConfig>>,
  keys: string[] | undefined
): string[] {
  if (!Array.isArray(keys) || keys.length === 0) return [];
  const wanted = new Set(keys);
  return (config.ad_registry ?? [])
    .filter((ad) => wanted.has(ad.key) && ad.enabled !== false)
    .flatMap((ad) => ad.ids ?? [])
    .map((id) => String(id).trim())
    .filter(Boolean);
}

function adIdMatches(adSourceId: string | null | undefined, ids: string[]): boolean {
  if (!adSourceId || ids.length === 0) return false;
  return ids.some((raw) =>
    String(raw)
      .split(/[\s,;]+/)
      .map((id) => id.trim())
      .filter(Boolean)
      .includes(adSourceId)
  );
}

/**
 * LA BANDERA ES UNA ETIQUETA MÁS, Y SE APLICA IGUAL QUE LA DEL ANUNCIO.
 *
 * Lo pidió el dueño el 24/09/2026: «la bandera no es solo una etiqueta como la
 * de los ads? mira cómo agregarlo igual». Y es el mismo molde de siempre:
 *
 *     los que llevan la etiqueta que toca  ->  si hay alguno, juegan SOLO ésos
 *     los que no llevan ninguna            ->  si no hay ninguno, juegan éstos
 *
 * SE FILTRA PRIMERO POR PAÍS Y DESPUÉS POR ANUNCIO, así que las dos etiquetas se
 * cumplen a la vez: un seguimiento con bandera de Perú y etiqueta «NAVIDAD» sale
 * solo a peruanos que vinieron de ese anuncio.
 *
 * Y SIN NINGUNA BANDERA PUESTA NO CAMBIA NADA: todos quedan generales, el filtro
 * de país los deja pasar enteros, y el sorteo de anuncios decide como hasta hoy.
 */
function porEtiqueta<T>(
  candidatos: T[],
  loSuyo: (candidato: T) => boolean,
  sinEtiqueta: (candidato: T) => boolean
): T[] {
  const conLaSuya = candidatos.filter(loSuyo);
  return conLaSuya.length > 0 ? conLaSuya : candidatos.filter(sinEtiqueta);
}

/** Las banderas de esta pieza, respetando su interruptor. Vacío = general. */
function banderasDe(pieza: {
  paises?: string[];
  pais_routing_enabled?: boolean;
}): string[] {
  if (pieza.pais_routing_enabled === false) return [];
  return (pieza.paises ?? [])
    .map((p) => String(p ?? "").trim().toUpperCase())
    .filter(Boolean);
}

function chooseFollowupVariant(
  seq: FollowupSequence,
  config: NonNullable<ReturnType<typeof loadWorkflowConfig>>,
  adSourceId: string | null | undefined,
  pais?: string | null,
  /** EL CAMINO DE LA CONVERSACIÓN (18/10/2026). Ver `etiqueta-de-camino.ts`. */
  camino?: string | null
): {
  variantIndex: number;
  name: string;
  steps: FollowupSequence["steps"];
} | null {
  const delCliente = String(pais ?? "").trim().toUpperCase();
  const candidates: {
    variantIndex: number;
    name: string;
    steps: FollowupSequence["steps"];
    adKeys: string[];
    banderas: string[];
    semi: Semimodalidad | null;
    tiendas: string[];
    /** Su peso en el sorteo (17/10/2026). 1 si no lo trae. */
    peso: number;
    /** Sus caminos (18/10/2026): el suyo y los «también». "" = el principal. */
    caminos: string[];
  }[] = [];
  const pesoDe = (n: unknown): number =>
    typeof n === "number" && Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
  const base = {
    name: seq.name,
    steps: Array.isArray(seq.steps) ? seq.steps : [],
    adKeys: seq.ad_routing_enabled === false ? [] : (seq.ad_keys ?? []),
    banderas: banderasDe(seq),
    semi: semimodalidadDe(seq),
    tiendas: tiendasDe(seq),
  };
  // El original se apaga igual que sus variantes. Antes no tenía interruptor:
  // el único que había apaga el seguimiento entero, así que para probar una
  // variante sola había que vaciar el original a mano.
  // `sectionHasPlaceholder` no mira dentro de los «_variants», y ahí es donde el
  // editor guarda el texto. Un seguimiento cuyas burbujas sean TODAS plantilla
  // pasaba el filtro, se elegía, y luego no enviaba nada: el cliente no recibía
  // el recordatorio y en el log parecía enviado. Se comprueba lo que de verdad
  // va a salir, igual que en la respuesta al elegir producto.
  const algunaBurbujaSale = (steps: SequenceStep[]): boolean =>
    steps.some(
      (step) =>
        (step as { enabled?: boolean }).enabled !== false &&
        laBurbujaSaleDeVerdad(step as ResponseStep)
    );
  if (
    seq.steps_enabled !== false &&
    base.steps.length > 0 &&
    !sectionHasPlaceholder(base) &&
    algunaBurbujaSale(base.steps)
  ) {
    candidates.push({
      variantIndex: 0,
      name: seq.name,
      steps: base.steps,
      adKeys: base.adKeys,
      banderas: base.banderas,
      semi: base.semi,
      tiendas: base.tiendas,
      peso: pesoDe(seq.steps_weight),
      // Los «mensajes principales» son del camino principal.
      caminos: [""],
    });
  }
  for (const [index, variant] of (seq.variants ?? []).entries()) {
    const steps = Array.isArray(variant.steps) ? variant.steps : [];
    if (
      variant.enabled !== false &&
      steps.length > 0 &&
      !sectionHasPlaceholder({ steps }) &&
      algunaBurbujaSale(steps)
    ) {
      candidates.push({
        variantIndex: index + 1,
        name: variant.name || `${seq.name} variante ${index + 2}`,
        steps,
        adKeys: variant.ad_routing_enabled === false ? [] : (variant.ad_keys ?? []),
        // LA BANDERA DEL SEGUIMIENTO SE HEREDA SI EL CAJÓN NO TIENE LA SUYA.
        //
        // LO QUE PASÓ — 24/09/2026, en la prueba del dueño: «en seguimiento 1 no
        // reconoció al elegir la bandera, en seguimiento 2 sí lo reconoció».
        //
        // La diferencia es dónde la puso. Al abrir el editor, los «mensajes
        // principales» de un seguimiento BAJAN a la lista como un cajón más —ver
        // `bajarPrincipalALaLista`—, así que la bandera puesta en el seguimiento
        // entero se quedaba arriba, sin nadie que la mirara: el motor solo
        // sortea entre cajones.
        //
        // Ahora la del seguimiento vale para todos sus cajones, y la del cajón
        // manda sobre ella. Es lo que uno espera de una etiqueta puesta en el
        // contenedor. Y si el cajón apaga su dirigir a propósito, queda general:
        // apagarlo tiene que poder apagarlo de verdad.
        banderas:
          banderasDe(variant).length > 0
            ? banderasDe(variant)
            : variant.pais_routing_enabled === false
              ? []
              : base.banderas,
        // LA SEMIMODALIDAD SE HEREDA IGUAL QUE LA BANDERA: la del cajón manda, y
        // si no tiene la suya vale la del seguimiento entero. Es lo que uno
        // espera de una etiqueta puesta en el contenedor — y es la misma trampa
        // que ya se arregló el 24/09 con la bandera, cuando los «mensajes
        // principales» bajan a la lista como un cajón más.
        semi: semimodalidadDe(variant) ?? base.semi,
        // LAS TIENDAS SE HEREDAN IGUAL: las del cajón mandan, y si no trae
        // ninguna valen las del seguimiento entero. Es la misma trampa que ya se
        // arregló dos veces aquí —con la bandera el 24/09 y con la semimodalidad
        // el 30/09—: al abrir el editor los «mensajes principales» BAJAN a la
        // lista como un cajón más, y la etiqueta puesta en el seguimiento se
        // quedaba arriba sin nadie que la mirara.
        tiendas:
          tiendasDe(variant).length > 0 ? tiendasDe(variant) : base.tiendas,
        peso: pesoDe(variant.weight),
        caminos: caminosDe(variant),
      });
    }
  }
  if (candidates.length === 0) return null;
  // PRIMERO LA TIENDA, que manda sobre las otras tres: decide por qué NÚMERO se
  // está vendiendo, y dentro de eso deciden la forma, el país y el anuncio.
  //
  // AQUÍ LA EXCLUSIÓN SE NOTA MÁS QUE EN LAS INTROS, y es justo lo que él pidió.
  // Si todos los seguimientos son de la tienda B, al cliente de la A NO se le
  // manda ninguno: esto devuelve lista vacía, más abajo se devuelve null y el
  // seguimiento no se agenda. Así es como un seguimiento queda «encendido en un
  // número y apagado en los otros» sin duplicarlo.
  //
  // Y no es silencio a ciegas: la pantalla avisa al etiquetar si una tienda se
  // quedaría sin ningún seguimiento. Ver `soloDeSuTienda`.
  const deSuTienda = soloDeSuTienda(
    candidates,
    (c) => c.tiendas,
    laTiendaQueAtiende()
  );
  if (deSuTienda.length === 0) return null;
  // SIN RESPALDO ENTRE TIENDAS Y SIN SEGUIMIENTO DE ESTA TIENDA: no se agenda (17/10/2026).
  // Encendido no se dispara: lo de arriba decide como siempre.
  if (
    !usaRespaldoEntreTiendas(config) &&
    aLaTiendaLeFaltaLoSuyo(candidates, (c) => c.tiendas, laTiendaQueAtiende())
  ) {
    return null;
  }
  // DESPUÉS LA SEMIMODALIDAD, la más general de las tres que quedan:
  // primero se decide CON QUÉ FORMA se está vendiendo, y dentro de eso deciden el
  // país y el anuncio. Sin etiquetas puestas devuelve la lista entera y todo lo
  // de abajo sigue como siempre. Ver `porSemimodalidad` para la red de seguridad.
  const deEstaSemimodalidad = porSemimodalidad(
    deSuTienda,
    (c) => c.semi,
    semimodalidadActiva(config)
  );
  // DESPUÉS LA BANDERA, Y AQUÍ SIN BANDERA NO SE DISPARA.
  //
  // LO PIDIÓ EL DUEÑO el 02/10/2026: «en la sección intro y seguimientos… ahí necesito
  // que se pueda seleccionar banderas en los selectores, sino no se disparan».
  //
  // ES EL TERCERO DE LOS TRES SITIOS que encaminan por país —los otros dos son
  // `elegirGrupoDeIntro` y el sorteo de variantes de intro— y los tres tienen que decidir
  // IGUAL. Que uno sirva lo que otro descarta es el fallo que este proyecto ha pagado
  // tres veces.
  //
  // EL RESPALDO DE `porEtiqueta` ERA «los que no llevan ninguna»; ahora es «los que
  // llevan alguna, aunque no sea la suya». Así una pieza sin bandera no sale nunca, y un
  // cliente de un país que él todavía no cubrió recibe algo en vez de nada — que es la
  // regla que puso una prueba suya y sigue valiendo.
  //
  // NO PASA POR `porEtiqueta` COMO LAS OTRAS DOS, y es a propósito: ese ayudante tiene
  // DOS escalones —«los míos» y «los que no llevan ninguna»— y aquí hacen falta TRES,
  // porque el respaldo de «sin ninguna bandera en todo el proyecto» no existe en las
  // otras etiquetas. Cambiar el ayudante tocaría también la tienda y la semimodalidad,
  // que no se tocan.
  const conBandera = deEstaSemimodalidad.filter((c) => c.banderas.length > 0);
  const losSuyos = deEstaSemimodalidad.filter(
    (c) => !!delCliente && c.banderas.includes(delCliente)
  );
  const deSuPais =
    conBandera.length === 0
      ? deEstaSemimodalidad
      : losSuyos.length > 0
        ? losSuyos
        : conBandera;
  // EL RESPALDO ENTRE PAÍSES SE PUEDE APAGAR (16/10/2026). Lo de arriba no se toca: con el
  // respaldo encendido decide como siempre. Apagado, un país sin seguimiento propio no recibe
  // el de otro: este seguimiento no se agenda, igual que cuando la tienda no tiene ninguno.
  // Ver `etiqueta-de-bandera.ts`.
  if (
    conBandera.length > 0 &&
    losSuyos.length === 0 &&
    !usaRespaldoEntrePaises(config)
  ) {
    console.log(
      `[wf:pais] ${seq.name}: ${delCliente || "sin país"} no tiene el suyo y el respaldo está apagado: no se envía`
    );
    return null;
  }
  // Y DESPUÉS EL ANUNCIO, dentro de lo que quedó.
  const deTodosLosCaminos = porEtiqueta(
    deSuPais,
    (c) => adIdMatches(adSourceId, adIdsForKeys(config, c.adKeys)),
    (c) => c.adKeys.length === 0
  );
  // Y AL FINAL SU CAMINO (18/10/2026): dentro de lo que quedó, SOLO los de su camino —sin
  // reemplazos: si su camino no sigue por aquí, este seguimiento no le llega—. Sin fichas con
  // camino es LA MISMA lista, y el sorteo de abajo decide igual que siempre. Ver
  // `etiqueta-de-camino.ts`.
  const pool = porCamino(deTodosLosCaminos, (c) => c.caminos, camino);
  if (pool.length === 0) {
    if (deTodosLosCaminos.length > 0) {
      console.log(`[wf:camino] ${seq.name}: el camino «${camino || "principal"}» no sigue por aquí: no se envía`);
    }
    return null;
  }
  // EL PESO DE CADA FICHA (17/10/2026): «en Perú voy a testear con varias intros… y varios
  // seguimientos… cada uno con su peso». SIN PESOS PUESTOS (todos 1) SE USA LA LÍNEA DE SIEMPRE,
  // tal cual: el mismo sorteo parejo, sin cambiar nada de lo ya probado. Solo cuando alguno
  // pesa distinto se reparte según el peso.
  if (pool.every((c) => c.peso === pool[0].peso)) {
    return pool[Math.floor(Math.random() * pool.length)];
  }
  const total = pool.reduce((s, c) => s + c.peso, 0);
  let tirada = Math.random() * total;
  for (const c of pool) {
    tirada -= c.peso;
    if (tirada < 0) return c;
  }
  return pool[pool.length - 1];
}

function followupSequencesFor(
  config: NonNullable<ReturnType<typeof loadWorkflowConfig>>,
  channel: string | null | undefined,
  modality: ModalidadKey | undefined
): FollowupSequence[] {
  // Las acciones creadas antes de esta correccion no llevan modalidad. Para
  // ellas conservamos el comportamiento vigente, pero ya leyendo el canal
  // correcto en vez de una lista global distinta.
  const resolvedModality = modality ?? getActiveModalityKey(config);
  const channelConfig = channel
    ? config.channels?.[channel as keyof NonNullable<typeof config.channels>]
    : undefined;
  const channelSequences =
    channelConfig?.use_content === true
      ? channelConfig.modality_templates?.[resolvedModality]?.followups
      : undefined;
  return Array.isArray(channelSequences)
    ? channelSequences
    : config.followup_sequences ?? [];
}

function resolveFollowupVariant(
  seq: FollowupSequence,
  variantIndex?: number
): {
  name: string;
  steps: FollowupSequence["steps"];
} | null {
  if (!variantIndex) return { name: seq.name, steps: seq.steps };
  const variant = seq.variants?.[variantIndex - 1];
  if (!variant || variant.enabled === false) return null;
  return {
    name: variant.name || `${seq.name} variante ${variantIndex + 1}`,
    steps: variant.steps,
  };
}

const DEFAULT_AWAITING_EMAIL_TIMEOUT = 300;
const DEFAULT_POST_GIFT_COMMENT_AUTO_HUMAN_DELAY_MINUTES = 30;
const DEFAULT_CUSTOMER_SURVEY_DELAY_MINUTES = 60;
const DEFAULT_VENEZUELA_NOTICE =
  "Gracias por escribirnos. Por ahora atendemos solo en Peru.";

function mentionsVenezuela(text: string): boolean {
  return /\b(venezuela|venezolano|venezolana|venezolanos|venezolanas)\b/i.test(
    text
  );
}

function confirmsPeruAvailability(text: string): boolean {
  return /\b(peru|per[uú]|yape|plin|bcp)\b/i.test(text);
}

function scheduleAutoHumanAfterVenezuelaNotice(conversationId: number): void {
  const cfg = loadWorkflowConfig();
  cancelPendingActionsByTypeForConvo(
    conversationId,
    ACTION_AUTO_SWITCH_HUMAN_AFTER_VENEZUELA_NOTICE
  );
  const rawDelay = cfg?.venezuela_redirect_human_delay_minutes;
  const delayMinutes =
    typeof rawDelay === "number" && Number.isFinite(rawDelay)
      ? Math.max(0, rawDelay)
      : 5;
  scheduleAction(
    conversationId,
    ACTION_AUTO_SWITCH_HUMAN_AFTER_VENEZUELA_NOTICE,
    {},
    Math.floor(Date.now() / 1000) + Math.round(delayMinutes * 60)
  );
  console.log(
    `[wf:pais] convo ${conversationId} programada para HUMANO en ${delayMinutes} min tras aviso Venezuela`
  );
}

function scheduleAutoHumanAfterGiftComment(conversationId: number): void {
  const cfg = loadWorkflowConfig();
  cancelPendingActionsByTypeForConvo(
    conversationId,
    ACTION_AUTO_SWITCH_HUMAN_AFTER_GIFT_COMMENT
  );
  if (cfg?.post_gift_comment_auto_human_enabled !== true) return;

  const rawDelay = cfg?.post_gift_comment_auto_human_delay_minutes;
  const delayMinutes =
    typeof rawDelay === "number" && Number.isFinite(rawDelay)
      ? Math.max(0, rawDelay)
      : DEFAULT_POST_GIFT_COMMENT_AUTO_HUMAN_DELAY_MINUTES;
  const runAt = Math.floor(Date.now() / 1000) + Math.round(delayMinutes * 60);
  scheduleAction(
    conversationId,
    ACTION_AUTO_SWITCH_HUMAN_AFTER_GIFT_COMMENT,
    {},
    runAt
  );
  console.log(
    `[wf] convo ${conversationId} programada para pasar a HUMANO en ${delayMinutes} min tras completar regalo`
  );
}

function getCustomerSurveyMessage(config: WorkflowConfig | null): string {
  if (config?.customer_survey_enabled !== true) return "";
  return (
    config.customer_survey_message?.trim() || DEFAULT_CUSTOMER_SURVEY_MESSAGE
  );
}

function getCustomerSurveyDelaySeconds(config: WorkflowConfig | null): number {
  const raw = config?.customer_survey_delay_minutes;
  const minutes =
    typeof raw === "number" && Number.isFinite(raw)
      ? Math.max(0, raw)
      : DEFAULT_CUSTOMER_SURVEY_DELAY_MINUTES;
  return Math.round(minutes * 60);
}

function scheduleCustomerSurveyFallback(conversationId: number): void {
  const config = loadWorkflowConfig();
  if (!getCustomerSurveyMessage(config)) {
    cancelPendingActionsByTypeForConvo(
      conversationId,
      ACTION_SEND_CUSTOMER_SURVEY
    );
    return;
  }
  cancelPendingActionsByTypeForConvo(
    conversationId,
    ACTION_SEND_CUSTOMER_SURVEY
  );
  const delaySec = getCustomerSurveyDelaySeconds(config);
  scheduleAction(
    conversationId,
    ACTION_SEND_CUSTOMER_SURVEY,
    {},
    Math.floor(Date.now() / 1000) + delaySec
  );
  console.log(
    `[wf] encuesta post-compra programada para convo ${conversationId} en ${delaySec}s`
  );
}

async function maybeSendCustomerSurveyNow(conversationId: number): Promise<void> {
  const fresh = getConversationById(conversationId);
  if (!fresh || fresh.customer_survey_sent) return;
  if (!fresh.gift_rewarded) return;
  const config = loadWorkflowConfig();
  const message = getCustomerSurveyMessage(config);
  if (!message) return;
  cancelPendingActionsByTypeForConvo(
    conversationId,
    ACTION_SEND_CUSTOMER_SURVEY
  );
  await sendBotText(fresh, applyWhatsAppNameTemplate(message, fresh));
  setCustomerSurveySent(conversationId, true);
  if (config?.customer_survey_auto_human_enabled === true) {
    setMode(conversationId, "HUMAN");
    cancelPendingActionsForConvo(conversationId);
    console.log(
      `[wf] convo ${conversationId} -> HUMANO tras encuesta post-compra`
    );
  }
  console.log(
    `[wf] encuesta post-compra enviada temprano a convo ${conversationId} (regalo completado)`
  );
}

/** Comando de reseteo manual desde WhatsApp. */
const RESTART_COMMANDS = ["/restart", "/reset", "/reiniciar"];

const SALESBOT_STATES: WorkflowState[] = [
  "new",
  "intro_running",
  "intro_done",
  "payment_done",
  "payment_approved",
  "awaiting_delivery_preference",
  "awaiting_email",
  "awaiting_gift_consent",
  "awaiting_facebook_comment",
  "awaiting_bioferta_choice",
  "awaiting_bioferta_intro_choice",
  "awaiting_order_bump_choice",
  "awaiting_order_bump_payment_choice",
  "awaiting_post_payment_order_bump_choice",
  "awaiting_doble_oferta_dos_choice",
];

type SalesbotResult = "inactive" | "handled" | "fallback_ai";

function normalizeSalesbotText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Coincidencia tolerante para reglas editables del Salesbot. Primero se exige
 * la coincidencia literal de siempre; este respaldo solo cubre errores de
 * escritura pequeños en palabras suficientemente largas ("metdoo", "reenvair").
 * No contiene nombres de producto ni reglas comerciales: esos datos siguen en
 * la configuración de cada proyecto.
 */
/**
 * DE CUÁNTAS LETRAS EN ADELANTE UNA LETRA DE MÁS ES UN DEDAZO.
 *
 * Era 4, y a 4 letras una letra de diferencia no es un error de escritura: es
 * otra palabra. Con la regla de saludo encendida, «a qué HORA me manda» contaba
 * como «HOLA» —una letra— y el bot contestaba el saludo, cortando el turno y con
 * él el comprobante que venía en ese mismo mensaje.
 *
 * De 5 en adelante sigue igual que siempre, que es para lo que se puso:
 * «metdoo», «reenvair», «trasnferencia».
 */
const LARGO_MINIMO_PARA_TOLERAR_DEDAZOS = 5;

function areSalesbotWordsClose(a: string, b: string): boolean {
  if (a === b) return true;
  if (
    a.length < LARGO_MINIMO_PARA_TOLERAR_DEDAZOS ||
    b.length < LARGO_MINIMO_PARA_TOLERAR_DEDAZOS ||
    Math.abs(a.length - b.length) > 1
  ) {
    return false;
  }
  const maxDistance = Math.max(a.length, b.length) >= 7 ? 2 : 1;
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      diagonal = above;
    }
  }
  return previous[b.length] <= maxDistance;
}

function fuzzySalesbotPhraseMatches(
  messageWords: string[],
  keyword: string
): boolean {
  const keywordWords = normalizeSalesbotText(keyword).split(" ").filter(Boolean);
  if (
    keywordWords.length === 0 ||
    keywordWords.some(
      (word) => word.length < LARGO_MINIMO_PARA_TOLERAR_DEDAZOS
    )
  ) {
    return false;
  }
  for (let start = 0; start <= messageWords.length - keywordWords.length; start += 1) {
    if (
      keywordWords.every((word, index) =>
        areSalesbotWordsClose(messageWords[start + index], word)
      )
    ) {
      return true;
    }
  }
  return false;
}

/** Modalidad con la que el salesbot elige modo y reglas. Va por la modalidad
 *  ACTIVA (la misma que ven el motor y la entrega): antes tenía su propia
 *  escalera con otra precedencia, así que con dos modalidades encendidas el
 *  salesbot podía usar las reglas de una y el motor vender la otra. */
function getSalesbotModality(config: WorkflowConfig): ModalidadKey {
  return getActiveModalityKey(config);
}

function salesbotRuleMatches(
  rule: SalesbotRule,
  msgContent: string
): boolean {
  const normalized = normalizeSalesbotText(msgContent);
  const keywords = Array.isArray(rule?.keywords)
    ? rule.keywords.map(normalizeSalesbotText).filter(Boolean)
    : [];
  if (rule?.match === "regex") {
    if (!rule.pattern?.trim()) return false;
    try {
      return new RegExp(rule.pattern, "i").test(msgContent);
    } catch {
      return false;
    }
  }
  if (keywords.length === 0) return false;
  // El match exacto conserva al 100% el comportamiento actual. La tolerancia
  // se usa únicamente como segunda opción para no perder una venta por un typo.
  const messageWords = normalized.split(" ").filter(Boolean);
  const matches = (keyword: string) =>
    normalized.includes(keyword) || fuzzySalesbotPhraseMatches(messageWords, keyword);
  if (rule?.match === "contains_all") {
    return keywords.every(matches);
  }
  return keywords.some(matches);
}

function isGuidedSalesbotMode(config: WorkflowConfig): boolean {
  const salesbot = config.salesbot;
  const modality = getSalesbotModality(config);
  return salesbot?.modes?.[modality] === "salesbot_stage_guided";
}

function shouldIgnoreChoicePresentationInterruption(
  convo: ConversationRow,
  state: WorkflowState
): boolean {
  const now = Math.floor(Date.now() / 1000);
  const window = choicePresentationWindows.get(convo.id);
  if (!window) return false;
  if (window.keepUntil < now) {
    choicePresentationWindows.delete(convo.id);
    return false;
  }
  if (window.state !== state) return false;
  if (window.endAt === null) return true;
  const latestUser = getLatestUserMessage(convo.id);
  if (!latestUser) return false;
  return (
    latestUser.created_at >= window.startAt &&
    latestUser.created_at <= window.endAt
  );
}

function isGuidedSalesContentState(state?: string | null): boolean {
  return (
    state === "intro_done" ||
    state === "awaiting_order_bump_choice" ||
    state === "awaiting_doble_oferta_dos_choice" ||
    state === "awaiting_bioferta_choice" ||
    state === "awaiting_bioferta_intro_choice"
  );
}

function shouldHideGuidedSecondProduct(
  convo: ConversationRow,
  config: WorkflowConfig
): boolean {
  const postSaleStates = new Set([
    "payment_approved",
    "awaiting_email",
    "awaiting_gift_consent",
    "awaiting_facebook_comment",
  ]);
  const orderBumpPostSale = postSaleStates.has(convo.state ?? "");
  const deferredUntilPayment =
    convo.state === "intro_done" &&
    !convo.order_bump_choice &&
    (convo.last_followup_index >= 0 ||
      config.order_bump?.offer_on_intro_first_message === false);
  // SE PREGUNTA POR EL DATO, NO POR EL NOMBRE DE LA MODALIDAD.
  //
  // Decía `config.order_bump?.enabled`. Con el selector «PRESENTA: COMO -OB-» la
  // modalidad sigue llamándose lineal, así que ese interruptor está APAGADO y
  // esto contestaba «no hay nada que tapar» — con el producto oculto delante.
  //
  // Y ES EL CAMINO DE LA TANDA DE MUESTRAS: por aquí sale la galería COMPLETA.
  // Con las galerías vacías no se notaba, pero al llenarlas la foto del producto
  // oculto podía salir antes de su revelación, que es la regla más dura de -OB-.
  //
  // ESTA FUNCIÓN ES LA GEMELA LITERAL de `elOrderBumpSigueOculto`
  // (`openrouter.ts`), que se arregló el 24/09 por este mismo motivo y con esta
  // misma línea. La de aquí se quedó atrás: dos lecturas del mismo estado, y una
  // sabía de la presentación prestada y la otra no. Si algún día se toca una, hay
  // que tocar las dos — es literalmente el fallo que su comentario advierte.
  //
  // `isOrderBumpActive()` contesta bien en los dos casos —la modalidad de verdad
  // y la prestada— y además es MÁS estricta: exige que -OB- sea la que vende, así
  // que en Doble Oferta ya no da verdad como daba el interruptor suelto.
  return isOrderBumpActive() && !orderBumpPostSale && deferredUntilPayment;
}

function looksLikeGuidedContentQuestion(text: string): boolean {
  const normalized = normalizeSalesbotText(text);
  if (!normalized) return false;
  if (
    /\b(yape|plin|bcp|transferencia|deposito|depositar|pago|pagar|comprobante|voucher|recibo|cuenta|numero|metodo|metodos)\b/.test(
      normalized
    )
  ) {
    return false;
  }
  return /\b(que trae|q trae|que contiene|q contiene|incluye|contenido|como es|muestrame|muestra|ver imagen|ver imagenes|fotos|imagenes|catalogo|catalogo|pack|complemento|diferencia|diferencias|el otro|la otra)\b/.test(
    normalized
  );
}

function looksLikeGuidedMoreRequest(text: string): boolean {
  const normalized = normalizeSalesbotText(text);
  return /\b(ver mas|muestra mas|muestrame mas|manda mas|enviame mas|otra imagen|otras imagenes|sigue|continuar|continua|si|dale|ok|listo)\b/.test(
    normalized
  );
}

/** El último mensaje que escribió el bot. Hace falta para resolver lo que el
 *  cliente contesta CONTRA lo que acaba de leer — por ejemplo «el 2», que solo
 *  significa algo si el bot numeró las opciones en ese mensaje. */
function ultimoMensajeDelBot(convoId: number): string {
  return (
    [...getRecentHistory(convoId, 6)]
      .reverse()
      .find((mensaje) => mensaje.role === "assistant")?.content ?? ""
  );
}

function assistantOfferedVisualSample(convoId: number): boolean {
  const lastAssistant = [...getRecentHistory(convoId, 6)]
    .reverse()
    .find((message) => message.role === "assistant");
  const normalized = normalizeSalesbotText(lastAssistant?.content ?? "");
  if (!normalized) return false;
  if (/\b(ver mas|quieres ver mas|te muestro algunas|mostrar mas)\b/.test(normalized)) {
    return true;
  }
  return (
    /\b(foto|imagen|imagenes|muestra|muestras|visual|mostrarte|enviarte|mandarte)\b/.test(
      normalized
    ) &&
    /\b(quieres|te muestro|puedo mostrarte|te envio|puedo enviarte|te mando|te paso|te comparto)\b/.test(
      normalized
    )
  );
}

async function tryGuidedSalesbotContent(
  convo: ConversationRow,
  msgContent: string,
  config: WorkflowConfig
): Promise<boolean> {
  if (!isGuidedSalesbotMode(config)) return false;
  if (!isGuidedSalesContentState(convo.state)) return false;

  const contentQuestion = looksLikeGuidedContentQuestion(msgContent);
  const acceptedVisualOffer =
    looksLikeGuidedMoreRequest(msgContent) && assistantOfferedVisualSample(convo.id);
  if (!contentQuestion && !acceptedVisualOffer) return false;

  const topics = getProductInfoTopics();
  if (topics.length === 0) return false;

  const gallery = getImageGallery(shouldHideGuidedSecondProduct(convo, config), convo);
  if (gallery.length === 0) return false;

  const byTopic = new Map(
    gallery.map((item) => [item.topic.toLowerCase(), item])
  );
  const sequence = topics
    .map((topic) => byTopic.get(topic.toLowerCase()))
    .filter((item): item is NonNullable<typeof item> => !!item);
  if (sequence.length === 0) return false;

  const already = new Set(getSentMedia(convo.id).map((item) => item.toLowerCase()));
  const progressive = getProgressiveSamplesConfig();
  // Sin dosificacion se entrega toda la secuencia marcada. Con dosificacion,
  // se conserva la tanda configurada para que el cliente pida mas si quiere.
  const maxPerBatch = progressive.enabled
    ? progressive.maxPerBatch
    : sequence.length;
  const itemsToSend = sequence
    .filter((item) => !already.has(item.topic.toLowerCase()))
    .slice(0, maxPerBatch);

  if (itemsToSend.length === 0) {
    await sendBotText(
      convo,
      "Ya te mostre las muestras disponibles arriba. Te puedo ayudar a elegir la opcion que prefieras."
    );
    return true;
  }

  for (const item of itemsToSend) {
    await enviarMuestraDeGaleria(convo, item);
    markMediaSent(convo.id, item.topic.toLowerCase());
    already.add(item.topic.toLowerCase());
  }

  const stillPending = sequence.some(
    (item) => !already.has(item.topic.toLowerCase())
  );
  if (stillPending && progressive.enabled) {
    await sendBotText(convo, progressive.moreText);
  } else {
    await sendSamplesAfterContent(convo);
  }
  return true;
}

/**
 * ¿ESTA BURBUJA LLEVA UN PRECIO QUE NO DICE DE QUÉ PRODUCTO ES?
 *
 * Hay dos familias de comodines de precio y se comportan muy distinto:
 *
 *   CON DUEÑO   {{PRECIO_FULL}}, {{PRECIO_BASE}}, {{PRECIO_UPSELL}},
 *               {{PRECIO_1}}, {{PRECIO_2}} — cada uno dice de cuál habla, así
 *               que nunca se puede equivocar de producto.
 *   SIN DUEÑO   {{PRECIO_COMPLETO}}, {precio}, {price} y sus variantes de
 *               mayúsculas — significan «el precio de esta conversación», que
 *               con UN producto es evidente y con DOS no existe.
 *
 * Se pregunta por el comodín ESCRITO, no por cómo quede el texto: es un dato de
 * la configuración, no una redacción. Ver `elNombreSigueAlPrecio` y
 * `lasDosSinElegir`, que son los dos usos.
 */
const PRECIO_SIN_DUENO =
  /\{\{\s*(?:precio_completo|precio_label|price_label|full_price|precio_completo_mayusculas|precio_full_mayusculas|full_price_upper|precio_completo_minusculas|precio_full_minusculas|full_price_lower)\s*\}\}|\{\{?\s*(?:precio|price)\s*\}\}?/i;

/**
 * EL NOMBRE DE ESTA BURBUJA ES EL DUEÑO DE SU PRECIO.
 *
 * LO QUE PASÓ — 28 de septiembre de 2026, su prueba HOLAP2. Su respuesta rápida
 * de precio —«Respuesta rápida: precio», del Salesbot económico de lineal— dice:
 *
 *     «El valor actual de *{{PRODUCTO}}* es *{{PRECIO_COMPLETO}}*»
 *
 * y al cliente le salió «SUPER PACK 2 EN 1 es S/. 8 SOLES», cuando el SUPER PACK
 * vale 10 y el 8 es el precio de la OTRA opción. El cliente paga lo que leyó, el
 * validador reconoce la opción POR EL MONTO, y se entrega el producto que no era.
 *
 * POR QUÉ, y no era el modelo: esa burbuja la manda el motor con SU texto, así
 * que ningún guardarraíl de los que revisan al modelo la mira. Los dos comodines
 * se resolvían por caminos distintos y con dos opciones apuntan a productos
 * distintos:
 *
 *   {{PRODUCTO}}         → el producto del PRIMER puesto, que en la forma de
 *                          «doble oferta» es el CARO.
 *   {{PRECIO_COMPLETO}}  → el precio base mientras no haya elección, que es el
 *                          del BARATO.
 *
 * Con un solo producto los dos apuntan al mismo y sale bien — por eso llevaba
 * meses funcionando. En cuanto hay dos, se cruzan SIEMPRE. No es mala suerte.
 *
 * EL ARREGLO ES QUE NO PUEDAN DISCREPAR: el nombre se resuelve con el producto
 * cuyo precio lleva esta burbuja. Con elección hecha, el elegido; sin ella, el
 * base, que es de donde sale el precio.
 *
 * TRES CANDADOS:
 *
 *   · SOLO SI LA BURBUJA LLEVA UN PRECIO SIN DUEÑO. Sin precio no hay pareja que
 *     cuadrar, y el resto de las burbujas suyas siguen diciendo exactamente lo
 *     que decían.
 *   · SOLO CON DOS OPCIONES. Con un producto `{{PRODUCTO}}` ya es el único que
 *     hay: se devuelve el texto sin tocar y lineal queda idéntico.
 *   · Y SOLO EL COMODÍN GENÉRICO. `{{PRODUCTO_FULL}}`, `{{PRODUCTO_BASE}}`,
 *     `{{PRODUCTO_SECUNDARIO}}` y compañía dicen de cuál hablan, así que no se
 *     tocan: el patrón exige que las llaves cierren justo detrás de «producto».
 */
function elNombreSigueAlPrecio(
  text: string,
  selectedOption: "combo" | "basico" | undefined,
  config: WorkflowConfig | null
): string {
  if (!text || !PRECIO_SIN_DUENO.test(text)) return text;
  if (!getActiveTwoTierOffer(config)) return text;
  const dueno = nombreDeLaOpcion(selectedOption ?? "basico", config).trim();
  if (!dueno) return text;
  return text.replace(/\{{1,2}\s*producto\s*\}{1,2}/gi, literal(dueno));
}

/**
 * ¿HAY DOS OPCIONES A LA VISTA Y EL CLIENTE NO HA ELEGIDO NINGUNA?
 *
 * Es la otra mitad de lo que pidió el dueño el 28/09/2026: «que cuando haya dos
 * productos esa respuesta no salga con un solo producto; que el bot le diga que
 * hay dos y le pregunte cuál quiere».
 *
 * «A LA VISTA» ES LA PALABRA IMPORTANTE, y es su regla dura de Order Bump: ahí
 * el segundo producto NO existe para el cliente hasta que muestra intención de
 * pagar. Preguntarle «¿cuál de las dos?» antes del destape se la salta. Mientras
 * siga tapado, su respuesta de precio sale tal cual —y ahí acierta: en Order
 * Bump el primer puesto ES el producto base, el mismo del precio—.
 */
function lasDosSinElegir(
  convo: ConversationRow,
  config: WorkflowConfig | null
): boolean {
  if (
    convo.order_bump_choice === "combo" ||
    convo.order_bump_choice === "basico"
  ) {
    return false;
  }
  if (!getActiveTwoTierOffer(config)) return false;
  if (isOrderBumpActive() && convo.order_bump_revealed !== 1) return false;
  return isOrderBumpActive() || isDobleOfertaActive();
}

function renderSalesbotResponse(
  text: string,
  convo: ConversationRow
): string {
  const config = loadWorkflowConfig();
  const discountActive = isDiscountActiveForConversation(convo, config);
  const selectedOption =
    convo.order_bump_choice === "combo" || convo.order_bump_choice === "basico"
      ? convo.order_bump_choice
      : undefined;
  const price = selectedOption
    ? getOrderBumpPriceSoles(selectedOption, discountActive, convo.phone) ??
      getLockedOrCurrentBasePrice(convo, config)
    : getLockedOrCurrentBasePrice(convo, config);
  // Las respuestas rapidas viven en configuracion. Resolvemos exactamente los
  // mismos comodines que una burbuja del workflow para que el editor, el bot y
  // futuras plantillas no tengan precios ni nombres hardcodeados en el motor.
  //
  // Y ANTES, QUE EL NOMBRE Y EL PRECIO HABLEN DEL MISMO PRODUCTO. Ver
  // `elNombreSigueAlPrecio`: el precio de esta burbuja ya lo decide la línea de
  // arriba, así que el nombre tiene que salir de esa misma decisión.
  return applyPriceTemplate(
    renderOrderBumpTemplate(
      elNombreSigueAlPrecio(text, selectedOption, config),
      discountActive,
      convo.phone
    ),
    price,
    convo
  ).trim();
}

export async function sendConfiguredSteps(
  convo: ConversationRow,
  steps: ResponseStep[] | undefined,
  // EL PRECIO DE ESTAS BURBUJAS, CUANDO NO ES EL DEL CURSO.
  //
  // Sin esto se usa el precio del producto que el cliente ya compró. Para casi
  // todo eso es lo correcto; para las burbujas de una oferta POSTERIOR —el
  // segundo producto— es un número equivocado que además parece bueno: se le
  // anuncia el extra al precio del primero y nadie lo nota hasta que llega el
  // comprobante corto. Es el mismo fallo que ya se arregló en el cajón de pago.
  precioDeEstasBurbujas?: number
): Promise<boolean> {
  const activeSteps = Array.isArray(steps)
    ? steps.filter((step) => step.enabled !== false)
    : [];
  if (activeSteps.length === 0) return false;
  for (const step of activeSteps) {
    await sendResponseStep(convo, step, precioDeEstasBurbujas, true);
    const delay = (step as { delay_after_sec?: number }).delay_after_sec ?? 0;
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay * 1000));
    }
  }
  return true;
}

function findBubbleButton(value: unknown, id: string): BubbleButton | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findBubbleButton(item, id);
      if (found) return found;
    }
    return null;
  }
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.buttons)) {
    const button = record.buttons.find(
      (item): item is BubbleButton =>
        !!item && typeof item === "object" && (item as BubbleButton).id === id
    );
    if (button) return button;
  }
  for (const child of Object.values(record)) {
    const found = findBubbleButton(child, id);
    if (found) return found;
  }
  return null;
}

/**
 * EL BOTÓN DE **SU** BURBUJA, NO EL DE OTRA VARIANTE.
 *
 * LO QUE PASÓ — 27 de septiembre de 2026, sus ocho pruebas en paralelo. Su
 * seguimiento 2 lleva un botón enlazado a la opción CARA. El cliente lo tocaba y
 * el bot le cobraba la BARATA, le confirmaba que ése era el precio de la cara, y
 * al pagar le entregaba el producto barato.
 *
 * MEDIDO CON SU ARCHIVO: ese id de botón existe CINCO veces, una por cada
 * variante del mismo seguimiento, porque al duplicar una variante el id se copia
 * tal cual. Dos de esas copias —las viejas, de cuando vendía un solo producto—
 * apuntan a la opción barata y tres a la cara. Y `findBubbleButton` recorre la
 * configuración entera y se queda con LA PRIMERA, sin mirar cuál se envió.
 *
 * O sea: al cliente le llegaba la burbuja de una variante y el motor ejecutaba
 * la acción de otra. Es el fallo más caro de esta casa —cobrar y entregar lo que
 * no era— y no se veía en el registro, porque el log decía la acción ejecutada,
 * no la variante de la que salió.
 *
 * SE BUSCA PRIMERO DONDE DE VERDAD ESTUVO: la variante del seguimiento que ESA
 * conversación recibió, que queda anotada al enviarla.
 *
 * Y SI NO APARECE AHÍ, se sigue buscando como hasta hoy. Es lo que hace que esto
 * no pueda romper nada: los botones de la intro, los del saludo y los de
 * cualquier otro sitio se resuelven exactamente igual que antes.
 */
function elBotonDeSuSeguimiento(
  convo: ConversationRow,
  id: string
): BubbleButton | null {
  const variante = convo.followup_variant_sent;
  const indice = convo.last_followup_index;
  if (typeof variante !== "number" || typeof indice !== "number" || indice < 0) {
    return null;
  }
  const config = loadWorkflowConfig();
  if (!config) return null;
  // La MISMA lista con la que se envió: el canal manda, igual que al mandarlo.
  const seq = followupSequencesFor(config, convo.channel, undefined)[indice];
  if (!seq) return null;
  const suya = resolveFollowupVariant(seq, variante);
  if (!suya) return null;
  // DENTRO DE SU FICHA, GANA EL DE UNA BURBUJA ENCENDIDA (18/10/2026, el botón del DNI). Al
  // duplicar una burbuja su botón se copiaba con el MISMO código, y aquí se ejecutaba el de la
  // primera —una apagada, con otra acción—. Con un código que no se repite, el encendido y «el
  // primero» son el mismo botón: nada cambia. Si ninguna encendida lo tiene, lo de siempre.
  const pasos: unknown[] = Array.isArray(suya.steps) ? suya.steps : [];
  for (const paso of pasos) {
    if ((paso as { enabled?: unknown } | null)?.enabled === false) continue;
    const encendido = findBubbleButton(paso, id);
    if (encendido) return encendido;
  }
  return findBubbleButton(suya.steps, id);
}

async function runBubbleButtonAction(convo: ConversationRow, id: string): Promise<boolean> {
  const button =
    elBotonDeSuSeguimiento(convo, id) ?? findBubbleButton(loadWorkflowConfig(), id);
  if (!button) return false;
  switch (button.action) {
    case "send_steps": {
      const mandadas = await sendConfiguredSteps(convo, button.steps);
      // SALIDA 1 DE 3: el cliente tocó el botón. Se manda lo suyo y la intro
      // retoma por donde iba, para que su respuesta quede ANTES del resto y no
      // metida en medio.
      await reanudarIntroSiEstabaEnPausa(convo.id);
      // AQUÍ HABÍA UN REMIENDO PARA LA RAMA DEL SALUDO, Y SE BORRA.
      //
      // Cuando el saludo esperaba respuesta, tocar uno de sus botones dejaba la
      // intro programada para cinco minutos después: el temporizador solo se
      // cancelaba si el cliente ESCRIBÍA, y tocar un botón no pasaba por ahí.
      // Esto lo arreglaba lanzando la intro a mano.
      //
      // El saludo ya no espera nada y la intro sale con él, así que no hay
      // hueco que tapar.
      return mandadas;
    }
    default: {
      // EL BOTÓN TAMBIÉN PUEDE LLEVAR SU TEXTO DELANTE.
      //
      // LO QUE PASABA — 15 de septiembre de 2026. El dueño puso un botón «Quiero
      // el descuento» con sus burbujas y el producto no se elegía; al cambiarle
      // la acción a «Elegir Combo» sí se elegía, pero su texto desaparecía. Una
      // cosa o la otra.
      //
      // Y no era una limitación de verdad: el CUADRITO hace las dos —manda lo
      // suyo y luego ejecuta— llamando a esta misma función. Aquí simplemente no
      // se le pasaba lo que había escrito.
      //
      // EL ORDEN IMPORTA, y es el del cuadrito: primero sale lo suyo, después la
      // acción. Al revés, los datos de fábrica caerían encima de su texto.
      //
      // Y se le dice a la acción QUÉ ACABA DE SALIR (`loQueYaDijo`), que es como
      // ella decide no repetirse: si sus burbujas ya llevaban la cuenta, las de
      // fábrica no se mandan. Sin eso, el cliente leería dos veces lo mismo.
      //
      // SIN BURBUJAS NO CAMBIA NADA: `suyas` queda vacío y esto es exactamente
      // la llamada de antes.
      // LOS BOTONES DEL UPSELL, COMO LOS NATIVOS (17/10/2026): «quiero que quede igual en cuanto
      // a funcionamiento como los botones nativos». Los nativos solo responden con la oferta en
      // pie; pulsados tarde —ya dijo que no, ya aceptó o ya pagó— no hacen nada y el turno sigue
      // su camino. Antes de la oferta («esperando» o sin estado) no se toca: un «Sí» puesto en
      // otro mensaje sigue funcionando como siempre.
      if (
        (button.action === "choose_upsell" || button.action === "decline_upsell") &&
        ["rechazado", "aceptado", "pagado"].includes(String(convo.upsell_state ?? ""))
      ) {
        console.log(
          `[wf] convo ${convo.id}: "${button.label}" del upsell pulsado con la oferta ya cerrada (${convo.upsell_state}) → no hago nada, como el botón nativo`
        );
        return false;
      }
      const suyas = button.steps ?? [];
      if (suyas.length > 0) await sendConfiguredSteps(convo, suyas);
      return ejecutarAccion(
        convo,
        button.action,
        button.payment_method,
        button.label,
        suyas.length > 0 ? suyas : undefined
      );
    }
  }
}

/**
 * LO QUE HACE UNA ACCIÓN, EN UN SOLO SITIO.
 *
 * La usan los botones de una burbuja y los cuadritos de decisión. Teniendo cada
 * uno su copia, "Elegir Básico" acabaría haciendo una cosa desde el botón y
 * otra desde el cuadrito — y eso, en la elección de producto, es cobrar o
 * entregar lo que no era.
 *
 * "send_steps" no entra aquí: es propio del botón, que guarda sus burbujas. El
 * cuadrito ya manda las suyas antes de llegar a este punto.
 */
async function ejecutarAccion(
  convo: ConversationRow,
  accion: DecisionAction,
  metodoDePago: string | undefined,
  deQuien: string,
  /**
   * LO QUE EL OPERADOR YA LE DIJO EN ESTE MISMO TURNO.
   *
   * Son las burbujas del cuadrito que acaba de salir. Sin esto, la acción
   * mandaba el texto de fábrica encima del suyo: el cliente leía dos veces la
   * misma presentación, y con la cuenta escrita a mano, dos veces la cuenta.
   *
   * La regla es una sola, la misma de todo el bot: SU TEXTO MANDA. Si sus
   * burbujas ya llevan los datos, las de fábrica no salen. Si no los llevan,
   * sale solo la parte que los lleva — nunca la presentación repetida.
   */
  loQueYaDijo?: ResponseStep[]
): Promise<boolean> {
  // APAGADA NO ES DICHA. Ver `burbujasQueVanASalir`: contando las apagadas, un
  // cuadrito con sus burbujas en OFF hacía que el texto de fábrica saliera sin
  // su presentación —recortada para no repetir algo que nadie dijo— y al
  // cliente le faltaba la primera burbuja del método.
  const yaPresento = tieneBurbujasEncendidas(loQueYaDijo);
  const yaDioLosDatos = susBurbujasLlevanLosDatos(loQueYaDijo);
  switch (accion) {
    case "send_payment_method": {
      // LOS DATOS SALEN DE PRECIOS Y PAGOS, NO DE UNA COPIA GUARDADA AQUÍ.
      //
      // Se guarda QUÉ método manda, no su texto. Si se guardara el texto, el
      // número de cuenta viviría en dos sitios y el día que cambie uno de los
      // dos se queda viejo: el cliente paga a la cuenta que no era, sin error y
      // sin aviso. Así, además, cada país recibe SUS datos y su precio.
      const metodo = (metodoDePago ?? "").trim();
      if (!metodo) {
        console.warn(
          `[wf] convo ${convo.id}: "${deQuien}" no tiene método de pago elegido → no mando nada`
        );
        return false;
      }
      const cfgPago = loadWorkflowConfig();
      if (!cfgPago) return false;
      const eleccion =
        convo.order_bump_choice === "combo" ||
        convo.order_bump_choice === "basico"
          ? convo.order_bump_choice
          : undefined;
      const deFabrica = getPaymentResponses(cfgPago, metodo, eleccion, convo.phone);
      if (deFabrica.length === 0) {
        console.warn(
          `[wf] convo ${convo.id}: "${metodo}" no tiene datos configurados para este país → no mando nada`
        );
        return false;
      }
      // SU TEXTO YA LLEVABA LA CUENTA: no se manda nada encima.
      //
      // Lo invisible sí se hace —queda anotado el método— porque de ese apunte
      // dependen el reenvío de datos y el precio contra el que se valida el
      // comprobante. Lo único que se salta son las burbujas.
      if (yaDioLosDatos) {
        dejarLaVentaEsperandoElComprobante(convo, metodo, cfgPago);
        await reanudarIntroSiEstabaEnPausa(convo.id);
        console.log(
          `[wf] convo ${convo.id}: "${deQuien}" ya llevaba los datos de ${metodo} → no mando las de fábrica`
        );
        return true;
      }
      // Solo presentó: sale la parte de fábrica que sí tiene los datos.
      const pasos = yaPresento
        ? sinLaPresentacionDeSiempre(deFabrica)
        : deFabrica;
      dejarLaVentaEsperandoElComprobante(convo, metodo, cfgPago);
      await schedulePaymentResponses(convo, metodo, pasos, {
        orderBumpChoice: eleccion,
        sinPresentacion: pasos.length < deFabrica.length,
      });
      await reanudarIntroSiEstabaEnPausa(convo.id);
      console.log(
        `[wf] convo ${convo.id}: "${deQuien}" → datos de ${metodo}${
          pasos.length < deFabrica.length ? " (sin repetir su presentación)" : ""
        }`
      );
      return true;
    }
    case "show_payment":
      if (isOrderBumpActive() && !convo.order_bump_choice)
        await presentOrderBumpAndWaitForChoice(convo);
      else await sendPaymentOffer(convo);
      return true;
    case "choose_combo":
    case "choose_basico": {
      // Esto es lo que un comodín NO puede hacer: además de mandar los datos de
      // la opción, deja ANOTADO qué eligió el cliente. De ese apunte dependen el
      // precio contra el que se valida el comprobante y el producto que se
      // entrega.
      // UNA ACCIÓN QUE NO APLICA AQUÍ TIENE QUE DECIRLO.
      //
      // Se iba en silencio, y así es como se pierden horas: en Lineal no hay
      // oferta de dos opciones, así que «elegir básico» enlazado a un cuadrito
      // no hace absolutamente nada — pero el cuadrito parece configurado y el
      // log no dice ni una palabra.
      if (!getActiveTwoTierOffer()) {
        console.warn(
          `[wf] convo ${convo.id}: "${deQuien}" tiene enlazada la acción "${accion}", pero esta modalidad no vende dos opciones → esa acción no hace nada`
        );
        return false;
      }
      const cual = accion === "choose_combo" ? "combo" : "basico";
      // EN «COMO OB», PRIMERO SE DESTAPA EL PRODUCTO OCULTO.
      //
      // LO PIDIÓ EL DUEÑO el 27/09/2026, al preguntarle yo qué quería en esta
      // situación exacta. En Order Bump el segundo producto NO existe para el
      // cliente hasta que muestra intención de pagar: es su regla dura —«del
      // producto full no se dice NI EL PRECIO NI EL CONTENIDO hasta ese
      // momento»—. Y un botón de seguimiento enlazado a «elegir combo» se la
      // saltaba: le mandaba los datos de pago del producto caro sin haberlo
      // presentado nunca. El cliente recibía un precio de algo que no había
      // visto.
      //
      // Tocar ese botón SÍ es intención de pagar, así que el momento de
      // revelarlo es justo éste. Lo que no encajaba era saltarse la
      // presentación.
      //
      // SE DESTAPA CON SU SEGUNDA INTRO, la misma que usa el resto de Order
      // Bump —`presentOrderBumpAndWaitForChoice`—, y a continuación elige. No
      // se anota elección: elegir un producto que no ha visto es justo lo que
      // esto evita.
      //
      // TRES CANDADOS, y son los que impiden que esto roce nada más:
      //
      //   · SOLO EN ORDER BUMP. En «como dou» y en Lineal `isOrderBumpActive()`
      //     es falso y este bloque no existe. Medido con su configuración.
      //   · SOLO ANTES DEL DESTAPE. Después, `order_bump_revealed` vale 1 y la
      //     acción hace exactamente lo de siempre: el flujo normal de -OB-
      //     —método, destape, elección— pasa por aquí YA revelado, así que no
      //     se toca ni un turno suyo.
      //   · Y SU TEXTO YA SALIÓ. Las burbujas del botón se mandan antes de
      //     llegar aquí, así que lo suyo se lee primero y el destape después.
      if (isOrderBumpActive() && convo.order_bump_revealed !== 1) {
        await presentOrderBumpAndWaitForChoice(convo);
        await reanudarIntroSiEstabaEnPausa(convo.id);
        console.log(
          `[wf] convo ${convo.id}: "${deQuien}" quería "${cual}", pero el segundo producto seguía tapado → lo destapo y que elija`
        );
        return true;
      }
      // Lo que su cuadrito ya dijo viaja hasta aquí: si ya presentó el pago, la
      // respuesta de la opción no lo vuelve a presentar; si ya dio la cuenta,
      // no se manda ninguna encima.
      await deliverOrderBumpResponse(convo, cual, {
        yaPresento,
        yaDioLosDatos,
      });
      await reanudarIntroSiEstabaEnPausa(convo.id);
      console.log(`[wf] convo ${convo.id}: "${deQuien}" → eligió ${cual}`);
      return true;
    }
    case "choose_upsell": {
      // El SEGUNDO producto. No pasa por deliverOrderBumpResponse: ese apunta
      // order_bump_choice, que es de la primera oferta, y dejaría al bot
      // cobrando y entregando lo que ya vendió.
      //
      // La comprobación es la misma que usa la oferta automática: sin nombre,
      // sin precio o sin entrega no se ofrece. Aquí importa el doble, porque
      // esto le manda datos de pago a alguien: mejor no mandar nada que cobrar
      // por algo que después no se puede entregar.
      const cfgExtra = loadWorkflowConfig();
      if (!isUpsellUsable(cfgExtra)) {
        console.warn(
          `[wf] convo ${convo.id}: "${deQuien}" pide el segundo producto, pero esta modalidad no lo tiene o le falta nombre, precio o entrega → no mando nada`
        );
        return false;
      }
      // Su cuadrito ya dio la cuenta: solo se anota la aceptación, sin mandar
      // las burbujas de fábrica encima.
      await entregarDatosDePagoDelUpsell(convo, {
        enviarDatos: !yaDioLosDatos,
        sinPresentacion: yaPresento,
      });
      await reanudarIntroSiEstabaEnPausa(convo.id);
      console.log(`[wf] convo ${convo.id}: "${deQuien}" → eligió el segundo producto`);
      return true;
    }
    case "decline_upsell": {
      // EL «NO» AL SEGUNDO PRODUCTO, DESDE UN BOTÓN DE BURBUJA (17/10/2026). Él quiere los
      // botones de cada país en su sub pestaña, y el «Sí» ya tenía acción; el «No», no.
      // Es otra puerta a `rechazarUpsell`, la MISMA del botón nativo y del «no» escrito:
      // cancela la espera, suelta el regalo una sola vez y respeta el downsell y la fila.
      // Solo con la oferta en pie: un «No» tardío no deshace una compra ni un rechazo.
      if (convo.upsell_state !== "ofrecido") {
        console.warn(
          `[wf] convo ${convo.id}: "${deQuien}" rechaza el segundo producto, pero no hay oferta en pie (${convo.upsell_state ?? "ninguna"}) → no hago nada`
        );
        return false;
      }
      await rechazarUpsell(convo, loadWorkflowConfig(), { enviarTexto: !yaPresento });
      console.log(`[wf] convo ${convo.id}: "${deQuien}" → rechazó el segundo producto`);
      return true;
    }
    case "show_order_bump": {
      // LA OFERTA DE 2 OPCIONES, PRESENTADA A MANO.
      //
      // Lo mismo que hace el motor solo cuando el cliente elige método de pago,
      // pero desde un cuadrito: así el recorrido se puede armar en el editor.
      //
      // Si esta modalidad no tiene dos opciones, no se inventa ninguna: se
      // manda el menú de pago de siempre, que es lo que tocaría. Presentar una
      // oferta vacía sería peor que no presentarla.
      if (!getActiveTwoTierOffer()) {
        console.warn(
          `[wf] convo ${convo.id}: "${deQuien}" pide la oferta de 2 opciones, pero esta modalidad no la tiene → mando el menú de pago`
        );
        await sendPaymentOffer(convo);
        return true;
      }
      await presentOrderBumpAndWaitForChoice(convo);
      console.log(
        `[wf] convo ${convo.id}: "${deQuien}" → presenté la oferta de 2 opciones`
      );
      return true;
    }
    // EL REGALO. Las mismas tres funciones que ya usan el detector de "sí/no",
    // el botón y el marcador del modelo: un cuadrito es una puerta más a lo
    // mismo, no un camino paralelo. Así no pueden divergir.
    case "accept_gift":
      acceptGiftConsent(convo);
      console.log(`[wf] convo ${convo.id}: "${deQuien}" → aceptó el regalo`);
      return true;
    case "decline_gift":
      await declineGiftConsent(convo);
      console.log(`[wf] convo ${convo.id}: "${deQuien}" → rechazó el regalo`);
      return true;
    case "claim_gift":
      await claimGiftReward(convo);
      console.log(`[wf] convo ${convo.id}: "${deQuien}" → reclamó el regalo`);
      return true;
    case "human":
      setMode(convo.id, "HUMAN");
      cancelPendingActionsForConvo(convo.id);
      await sendBotText(convo, "Te conecto con una asesora para ayudarte 😊");
      return true;
    default:
      // Una acción que no se reconoce no hace nada, y queda escrito. Callar
      // aquí dejaría un cuadrito que parece linkeado y no ejecuta nada.
      console.warn(
        `[wf] convo ${convo.id}: "${deQuien}" tiene una acción desconocida (${String(accion)}) → no hago nada`
      );
      return false;
  }
}

/** Sends the active modality's post-sample closing, with a safe default. */
export async function sendSamplesAfterContent(
  convo: ConversationRow
): Promise<void> {
  const steps = getSamplesAfterSequence();
  const hasSendableClosing = steps.some((step) => {
    if (step.enabled === false) return false;
    if (step.type === "text") {
      return Boolean(
        step.body?.trim() ||
          step.body_variants?.some((variant) => variant.trim())
      );
    }
    return Boolean(step.drive_url?.trim());
  });
  const sentConfigured = hasSendableClosing
    ? await sendConfiguredSteps(convo, steps)
    : false;
  if (!sentConfigured) {
    await sendBotText(convo, DEFAULT_SAMPLES_AFTER_TEXT);
  }
}

async function runSalesbotRules(
  convo: ConversationRow,
  msgContent: string,
  config: WorkflowConfig
): Promise<SalesbotResult> {
  const salesbot = config.salesbot;
  const modality = getSalesbotModality(config);
  const mode = salesbot?.modes?.[modality] ?? "ai";
  if (mode === "ai") return "inactive";

  const state = convo.state ?? "new";
  const rules = (salesbot?.rules?.[modality] ?? [])
    .filter((rule) => {
      if (rule.enabled === false) return false;
      if (rule.channel && rule.channel !== "all" && rule.channel !== convo.channel) {
        return false;
      }
      if (
        Array.isArray(rule.states) &&
        rule.states.length > 0 &&
        !rule.states.includes(state)
      ) {
        return false;
      }
      return salesbotRuleMatches(rule, msgContent);
    })
    .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));

  if (rules.length === 0) {
    if (mode === "salesbot_stage_guided") {
      const handledGuidedContent = await tryGuidedSalesbotContent(
        convo,
        msgContent,
        config
      );
      if (handledGuidedContent) return "handled";
    }
    if (mode === "salesbot_only") {
      const fallback = renderSalesbotResponse(salesbot?.fallback_text ?? "", convo);
      if (fallback) await sendBotText(convo, fallback);
      return "handled";
    }
    return "fallback_ai";
  }

  const rule = rules[0];
  const response = renderSalesbotResponse(rule.response ?? "", convo);
  const action = rule.action ?? "send_text";
  const actionUsesEngineMessage =
    action === "send_steps" ||
    action === "show_order_bump" ||
    action === "choose_combo" ||
    action === "choose_basico" ||
    action === "resend_payment" ||
    action === "send_payment_menu" ||
    action === "decline_gift" ||
    action === "claim_gift" ||
    action === "accept_gift" ||
    action === "fallback_ai";
  // NADIE OYE UN PRECIO ANTES DE ELEGIR, CUANDO HAY DOS OPCIONES.
  //
  // Lo pidió el dueño el 28/09/2026, después de que su respuesta rápida de precio
  // le dijera a un cliente el nombre de una opción con el importe de la otra:
  // «que cuando haya dos productos esa respuesta no salga con un solo producto;
  // que el bot le diga que hay dos y le pregunte cuál quiere».
  //
  // Es su contrato de siempre —«nadie recibe datos de pago sin haber elegido»—
  // aplicado también al precio, que es el dato con el que el cliente decide.
  //
  // EN LUGAR DE SU TEXTO SALE EL RECORDATORIO DE LAS DOS, que es el mismo que ya
  // usa el resto del motor: su redacción, sus dos nombres y sus dos precios, y
  // con la novedad de «hemos actualizado» delante si a esa conversación le toca.
  // No es una respuesta nueva escrita en el código.
  //
  // SOLO CAMBIA EL TEXTO QUE SALE: la acción de la regla, su `next_state` y su
  // `stop_after_action` siguen ejecutándose igual más abajo.
  const hayQuePreguntarCual =
    !actionUsesEngineMessage &&
    PRECIO_SIN_DUENO.test(rule.response ?? "") &&
    lasDosSinElegir(convo, config);
  if (hayQuePreguntarCual) {
    console.log(
      `[wf] convo ${convo.id}: «${rule.name || rule.id}» lleva un precio sin dueño y hay dos opciones sin elegir → le pregunto cuál en vez de darle un importe`
    );
    await sendTwoOptionsReminder(convo, config);
  } else if (response && !actionUsesEngineMessage) {
    await sendBotText(convo, response);
  }

  switch (action) {
    case "send_steps": {
      const sent = await sendConfiguredSteps(convo, rule.steps);
      if (!sent && response) await sendBotText(convo, response);
      break;
    }
    case "show_order_bump":
      await presentOrderBumpAndWaitForChoice(convo);
      break;
    case "choose_combo":
      if (isDobleOfertaActive()) {
        await deliverDobleOfertaPaymentDetails(convo, "combo");
      } else {
        await deliverOrderBumpResponse(convo, "combo");
      }
      break;
    case "choose_basico":
      if (isDobleOfertaActive()) {
        await deliverDobleOfertaPaymentDetails(convo, "basico");
      } else {
        await deliverOrderBumpResponse(convo, "basico");
      }
      break;
    case "resend_payment":
      // Con la frase del operador: aquí no habla el modelo, así que sin ella los
      // datos vuelven a caer a secas y parecen un error del bot.
      await resendPaymentDetails(convo, { conFrase: true });
      break;
    case "send_payment_menu":
      await sendPaymentOffer(convo);
      break;
    case "resend_material":
      resendApprovedMaterial(convo);
      break;
    case "accept_gift":
      acceptGiftConsent(convo);
      break;
    case "decline_gift":
      await declineGiftConsent(convo);
      break;
    case "claim_gift":
      await claimGiftReward(convo);
      break;
    case "human":
      setMode(convo.id, "HUMAN");
      cancelPendingActionsForConvo(convo.id);
      break;
    case "fallback_ai":
      return "fallback_ai";
    case "send_text":
    default:
      break;
  }

  const nextState = (rule.next_state ?? "").trim();
  if (SALESBOT_STATES.includes(nextState as WorkflowState)) {
    setConversationState(convo.id, nextState as WorkflowState);
  }
  return rule.stop_after_action === false ? "fallback_ai" : "handled";
}

async function trySalesbotOrLlm(
  convo: ConversationRow,
  msgContent: string,
  config: WorkflowConfig
): Promise<boolean> {
  const result = await runSalesbotRules(convo, msgContent, config);
  return result === "handled";
}

/**
 * Devuelve true si el workflow ya gestionó este turno (no hay que llamar al
 * LLM). Devuelve false si no aplica y la lógica IA estándar debe seguir.
 */
export async function tryWorkflowOnIncoming(
  convo: ConversationRow,
  msgContent: string
): Promise<boolean> {
  // UPSELLS EN FILA: el turno sabe de qué conversación es, también cuando entra por
  // Messenger o Instagram, que no pasan por `conElTurnoDe`. Solo anota el número de la
  // conversación; sin fila puesta no cambia nada. Ver `conLaFilaDe`. El mismo patrón que
  // el canal, dos líneas más abajo.
  if (laConversacionDeLaFila() !== convo.id) {
    return conLaFilaDe(convo.id, () => tryWorkflowOnIncoming(convo, msgContent));
  }
  if (msgContent.startsWith("bubble:")) {
    return runBubbleButtonAction(convo, msgContent.slice("bubble:".length));
  }
  // El simulador reutiliza el contenido de WhatsApp, sin crear una cuarta
  // variante de textos ni permitir que un canal de prueba salga a Meta.
  const runtimeChannel =
    convo.channel === "test" ? convo.test_channel ?? "whatsapp" : convo.channel;
  if (getActiveWorkflowChannel() !== runtimeChannel) {
    return withWorkflowChannel(runtimeChannel, () =>
      tryWorkflowOnIncoming(convo, msgContent)
    );
  }

  // CASO ESPECIAL: comando /restart resetea la conversación entera.
  const trimmed = msgContent.trim().toLowerCase();
  if (RESTART_COMMANDS.includes(trimmed)) {
    await resetConversation(convo);
    return true;
  }

  const config = loadWorkflowConfig();
  if (!config) {
    // Sin config válida → no hay workflow, IA normal.
    return false;
  }

  // EL REGALO ESPERA A QUE HAYA SILENCIO.
  //
  // Antes el plazo se contaba desde que se programó y no se movía: si el
  // cliente seguía conversando, el regalo caía en mitad de la charla y dejaba
  // DOS preguntas abiertas. Pasó de verdad, con el segundo producto ofrecido:
  // el cliente dijo "sí quiero comprarlo" pensando en el producto y el bot le
  // contestó por el regalo.
  //
  // Ahora cada mensaje del cliente vuelve a poner el reloj a cero. El regalo
  // sale cuando de verdad se quedó callado, no a una hora fija.
  renovarEsperaDelRegalo(convo, config);
  // Y LOS SEGUIMIENTOS, POR LO MISMO.
  //
  // Contaban desde el primer mensaje y no se movían, así que a quien seguía
  // conversando le caía un «¿sigues ahí?» dos minutos después de escribir.
  // Ver `renovarEsperaDeLosSeguimientos`.
  renovarEsperaDeLosSeguimientos(convo);

  // SALIDA 2 DE 3: contestó escribiendo en vez de tocar el botón.
  //
  // La intro se retoma igual. Su mensaje sigue su camino normal —lo atiende
  // quien corresponda, casi siempre el modelo— pero la conversación no puede
  // quedarse detenida por no haber usado el botón.
  //
  // Va aquí arriba y no dentro de un estado: la pausa no es un estado, es una
  // marca. Así ninguna rama de más abajo puede devolverse antes y dejar la
  // intro colgada.
  if (typeof convo.intro_paused_index === "number") {
    // ¿Su respuesta coincide con alguna decisión de la burbuja que preguntó?
    //
    // La burbuja que preguntó es la ANTERIOR a la marca: la marca guarda por
    // dónde retomar, así que la pregunta quedó un paso atrás.
    const elegida = decisionDeLaBurbujaEnPausa(convo, config, msgContent);
    if (elegida) {
      console.log(
        `[wf:decision] convo ${convo.id}: eligió "${elegida.title || "(sin título)"}" en la pausa`
      );
      // Se anota AQUÍ también, o el bucle vuelve por la otra puerta: elegir en
      // la pausa y repetir la palabra después caía en el bloque de «fuera de la
      // pausa», que no sabía que eso ya estaba contestado.
      setUltimaDecision(convo.id, claveDeCuadrito(elegida));
      await sendConfiguredSteps(convo, elegida.steps);
      // La acción va DESPUÉS de sus burbujas: primero tu texto personalizado,
      // luego lo que el cuadrito tenga linkeado (los datos de la opción, un
      // método de pago…). Al revés, los datos llegarían antes que el "¡genial,
      // excelente elección!" que los presenta.
      if (elegida.action) {
        await ejecutarAccion(
          convo,
          elegida.action,
          elegida.payment_method,
          elegida.title || "esta decisión",
          // Lo que acaba de salir. Sin pasarlo, la acción mandaba el texto de
          // fábrica encima del suyo: la misma presentación dos veces, y con la
          // cuenta escrita a mano, la cuenta dos veces.
          elegida.steps
        );
      }
      // Y si sus burbujas llevaban la cuenta, la conversación queda esperando
      // ese pago — igual que si los datos los hubiera mandado el motor. Sin
      // esto, el comprobante pierde su atajo al lector y el reenvío no sabe qué
      // método reenviar. Ver el mismo cierre fuera de la pausa.
      //
      // Lleve acción o no: quien da la cuenta cierra la venta. Atarlo a «sin
      // acción» lo hacía depender de algo que no pinta nada aquí.
      if (susBurbujasLlevanLosDatos(elegida.steps)) {
        const metodo = detectPaymentRoute(msgContent, convo.phone);
        // Por la MISMA puerta que el resto: no adelanta una elección pendiente
        // ni retrocede desde la postventa. Ver `dejarLaVentaEsperandoElComprobante`.
        if (metodo) dejarLaVentaEsperandoElComprobante(convo, metodo, config);
      }
      await reanudarIntroSiEstabaEnPausa(convo.id);
      // El turno queda atendido: ya se le contestó lo que pidió su elección.
      return true;
    }
    // Ninguna coincide: la intro sigue igual y su mensaje lo atiende quien
    // corresponda. La pregunta era opcional; nadie se queda detenido por no
    // haber contestado con las palabras previstas.
    //
    // Y ES AQUÍ, Y SOLO AQUÍ, DONDE PUEDE HABER UN NOMBRE.
    //
    // Escribió algo que no es ninguna de las respuestas previstas. Si la
    // burbuja pedía el nombre, eso es lo que acaba de decir. Las otras salidas
    // de la pausa —el botón, el cuadrito acertado, el plazo vencido— no pasan
    // el mensaje a propósito: guardarían «combo» o «yape» como su nombre.
    await reanudarIntroSiEstabaEnPausa(convo.id, msgContent);
  }

  if (convo.state === "country_notice_pending") {
    if (confirmsPeruAvailability(msgContent)) {
      cancelPendingActionsByTypeForConvo(
        convo.id,
        ACTION_AUTO_SWITCH_HUMAN_AFTER_VENEZUELA_NOTICE
      );
      setConversationState(convo.id, "intro_done");
      console.log(`[wf:pais] convo ${convo.id} retoma venta tras aclarar Peru`);
      return false;
    }
    return true;
  }

  if (
    config.venezuela_redirect_enabled === true &&
    mentionsVenezuela(msgContent) &&
    !confirmsPeruAvailability(msgContent)
  ) {
    cancelPendingActionsForConvo(convo.id);
    await sendBotText(
      convo,
      config.venezuela_redirect_message?.trim() || DEFAULT_VENEZUELA_NOTICE
    );
    setConversationState(convo.id, "country_notice_pending");
    scheduleAutoHumanAfterVenezuelaNotice(convo.id);
    console.log(`[wf:pais] convo ${convo.id} Venezuela -> aviso y espera humano`);
    return true;
  }

  const effectiveCountry = getEffectiveCountryCode(convo.phone, config);
  if (!isCountrySalesEnabled(effectiveCountry, config)) {
    await sendBotText(
      convo,
      config.country_disabled_message?.trim() ||
        "Gracias por escribirnos. Por ahora no tenemos venta disponible para tu país."
    );
    setMode(convo.id, "HUMAN");
    cancelPendingActionsForConvo(convo.id);
    console.log(
      `[wf:pais] convo ${convo.id} pais ${effectiveCountry} apagado -> HUMANO`
    );
    return true;
  }

  // Hook ortogonal: cualquier mensaje del cliente puede gatillar el agendado
  // del siguiente seguimiento (slot horario + cola anti-rafaga). El helper
  // filtra internamente: solo programa si ya disparo seg N (N≥1) y la convo
  // sigue activa (no pago). No afecta el flujo de respuesta del bot.
  maybeScheduleNextFollowupOnUserMessage(convo);

  const state = convo.state;

  // Conversaciones pre-existentes a esta feature: state === null.
  // Las marcamos silenciosamente como intro_done para que la IA siga normal.
  if (state === null || state === undefined) {
    setConversationState(convo.id, "intro_done");
    return false;
  }

  // ¿HAY UN COMPROBANTE EN JUEGO? SE CALCULA ANTES QUE NADA.
  //
  // Estaba 30 líneas más abajo, y por eso el bloque de aquí debajo —que promete
  // en su comentario no actuar cuando llega un comprobante— no podía cumplirlo:
  // decidía y se iba antes de que este dato existiera.
  //
  // Comprobante = foto O PDF del banco. Los dos los puede leer la IA.
  //
  // Misma regla que el cerebro (getRecentVisionImage en openrouter.ts): el
  // comprobante puede no ser el último mensaje porque el cliente siguió
  // escribiendo después de mandarlo. Vale mientras el bot todavía no haya
  // contestado nada posterior a esa foto; en cuanto contestó, ya la atendió.
  // Aquí decide el upgrade al combo y el pago del segundo producto: si el turno
  // no se reconoce como comprobante, esos dos pagos se tratan como el eco del
  // primero y se cobran sin entregar.
  const ultimoDelCliente = getLatestUserMessage(convo.id);
  const historialReciente = getRecentHistory(convo.id, 12);
  const ultimaRespuestaDelBot = historialReciente.findLastIndex(
    (m) => m.role === "assistant"
  );
  const pairedUserMedia = historialReciente.some(
    (m, i) =>
      i > ultimaRespuestaDelBot &&
      m.role === "user" &&
      m.id !== ultimoDelCliente?.id &&
      (m.media_type === "image" || esComprobantePdf(m))
  );
  const latestIsImage =
    ultimoDelCliente?.media_type === "image" ||
    (!!ultimoDelCliente && esComprobantePdf(ultimoDelCliente)) ||
    pairedUserMedia;

  // ── EL COMPROBANTE VA DERECHO AL LECTOR ──────────────────────────────────
  //
  // EL PROBLEMA QUE RESUELVE, Y POR QUÉ ESTÁ AQUÍ ARRIBA.
  //
  // A partir de este punto el motor tiene DECENAS de sitios donde puede decir
  // "esto lo contesto yo" y quedarse el turno. Cada uno tenía que acordarse por
  // su cuenta de una regla: «si el mensaje trae una foto, yo no me lo quedo».
  //
  // Unos se acuerdan —hay varios con el comentario "se deja pasar para que el
  // comprobante se lea de verdad"— y otros no. El del re-envío de datos no se
  // acordaba, aunque su propio comentario juraba que sí. Resultado: la clienta
  // mandaba el voucher escribiendo «listo ya pagué, ¿a qué hora me envía?», el
  // motor leía «envía», le reenviaba el número de cuenta y la foto no llegaba
  // al lector. Y no era un retraso: como el bot ya contestó DESPUÉS de la foto,
  // el cerebro la da por atendida y no vuelve a mirarla. Pago no registrado.
  //
  // Arreglar puerta por puerta es perder: son demasiadas y siempre queda una.
  // La regla se dice UNA vez, aquí, antes que ninguna.
  //
  // DÓNDE **NO** APLICA, que es lo que impide que esto salpique al resto:
  //
  //  · Elección de opción (`awaiting_order_bump_choice`): esa puerta YA lee
  //    comprobantes a propósito —si la clienta nombra su opción justo después
  //    de mandar el voucher, re-analiza esa misma foto en vez de pedir otra—.
  //    Quitársela rompería el upgrade.
  //  · Regalo (`awaiting_gift_consent`, `awaiting_facebook_comment`): ahí una
  //    imagen es la captura del comentario de Facebook, no un pago.
  //  · Correo (`awaiting_email`): la imagen tampoco es un comprobante.
  //
  // O sea: solo cuando la conversación está ESPERANDO un pago. En cualquier
  // otro momento el motor sigue funcionando exactamente igual que antes.
  // Y TAMBIÉN CUANDO YA TIENE LA CUENTA DELANTE, aunque la etapa se haya
  // quedado atrás.
  //
  // Esta regla se apoyaba SOLO en la etapa. Con un camino que mandaba los datos
  // sin dejar la etapa apuntada, la conversación se quedaba en `intro_done` con
  // la cuenta ya enviada: la clienta mandó el voucher escribiendo «listo ya
  // pagué, ¿a qué hora me manda?», esto no se activó, y una respuesta rápida de
  // la etapa anterior se quedó el turno. Pago no registrado, justo el caso que
  // esta regla existe para evitar.
  //
  // El hecho manda sobre la etapa: si tiene un método anotado, es que se le
  // dieron los datos y lo que llega es un comprobante. Se limita a las etapas
  // de ANTES del pago para no tocar nada de la postventa.
  const yaLeDimosLaCuenta =
    !!convo.selected_payment_method?.trim() &&
    laVentaTodaviaNoLlegoAlPago(state);
  const esperandoUnPago =
    state === "payment_done" ||
    yaLeDimosLaCuenta ||
    convo.upsell_state === "ofrecido" ||
    convo.upsell_state === "aceptado";
  const laImagenAquiNoEsUnPago =
    state === "awaiting_order_bump_choice" ||
    state === "awaiting_gift_consent" ||
    state === "awaiting_facebook_comment" ||
    state === "awaiting_email";
  if (latestIsImage && esperandoUnPago && !laImagenAquiNoEsUnPago) {
    console.log(
      `[wf] convo ${convo.id}: llegó un comprobante en estado ${state} → derecho al lector, sin desvíos`
    );
    return false;
  }

  // Y EL CUADRITO DE LA INTRO SIGUE VALIENDO DESPUÉS.
  //
  // Más arriba se lee la burbuja EN PAUSA. Aquí, cuando el cliente eligió más
  // tarde: desvió con una duda, habló con el modelo, y al volver escribió lo
  // que el cuadrito esperaba. Antes su texto no salía nunca, aunque estuviera
  // escrito — atendido o tirado según el momento en que contestara.
  //
  // Solo con palabras que SEÑALAN algo. Ver `cuadritoDeLaIntroQueSeñala`.
  //
  // VA DETRÁS DE LA REGLA DEL COMPROBANTE, a propósito. Una foto con un pie que
  // nombre el método —"aquí está el yape"— tiene que llegar al lector, no
  // gastarse aquí. Delante de esa regla, esto sería una puerta más de las que
  // se tragaban el comprobante.
  //
  // Queda encendido si el operador ya presentó el pago con SU texto y hay que
  // mandarle además los datos: entonces el texto de fábrica sale SIN su
  // presentación. Ver `sinLaPresentacionDeSiempre`.
  let suTextoYaPresentoElPago = false;
  if (
    // Antes de la compra. Después, quien contesta es la postventa, y un texto
    // de venta ahí es lo contrario de lo que toca.
    convo.paid_at == null &&
    // Y solo con la conversación libre. En los estados que tienen UNA pregunta
    // abierta —elegir opción, el correo, el regalo— contesta su rama, que sabe
    // a qué se le está diciendo que sí.
    ETAPAS_SIN_PREGUNTA_ABIERTA.has(convo.state ?? "") &&
    // Y NUNCA POR DELANTE DE UN CAMBIO DE OPCIÓN. Ver
    // `elClienteEstaCambiandoDeOpcion`: ese turno ya tiene dueño más abajo.
    !elClienteEstaCambiandoDeOpcion(convo, config, msgContent, latestIsImage)
  ) {
    // Y SI NINGUNO SEÑALA, PERO LA PREGUNTA DE PAGO SIGUE ABIERTA. En Lineal un
    // «ok» no señala ningún método —no es ni yape ni bcp— y por eso se caía al
    // modelo, que volvía a preguntarlo. Ver `elCuadritoDePagoDeUnaAfirmacion`:
    // va DESPUÉS, así que quien escriba su palabra sigue yendo a SU cuadrito.
    const suyo =
      cuadritoDeLaIntroQueSeñala(convo, config, msgContent) ??
      elCuadritoDePagoDeUnaAfirmacion(convo, config, msgContent);
    // UNA ELECCIÓN YA CONTESTADA NO SE VUELVE A CONTESTAR.
    //
    // EL BUCLE. El cuadrito no tenía memoria: cada mensaje que llevara la
    // palabra volvía a soltar el bloque entero. Preguntar «¿esa es la cuenta
    // BCP?» contiene «bcp» → otra vez los datos. Y «me refería a si esa es la
    // cuenta bcp» → otra vez. El cliente no tiene forma de salir mientras siga
    // nombrando lo que acaba de elegir, y se va.
    //
    // Cambiar de opinión SÍ vale: si elige otro cuadrito, ese sale y pasa a ser
    // el último. Lo que no se repite es lo MISMO.
    //
    // Y PEDIR los datos tampoco es repetirse: «mándamelos otra vez», «¿a qué
    // número?». Eso lo reconoce `messageAsksWhereToPay` y sigue su camino de
    // siempre, que reenvía. Callarse ahí sería el fallo contrario.
    const claveDeLaDecision = suyo ? claveDeCuadrito(suyo) : "";
    if (
      suyo &&
      claveDeLaDecision &&
      convo.ultima_decision === claveDeLaDecision &&
      !pideQueLeRepitanLosDatos(msgContent)
    ) {
      // Si ese cuadrito llevaba a un método y ya tiene sus datos, se los
      // reenvía el motor —enmarcados y sin volver a presentar— igual que por la
      // puerta de al lado. Si no llevaba a ningún pago, no hay nada que
      // reenviar y contesta el modelo, como hasta ahora.
      //
      // Y EL TEXTO QUE SE REENVÍA ES EL SUYO: de eso se encarga
      // `resendPaymentDetails`, que lo mira para las nueve puertas. Aquí se
      // llamaba igual antes de eso y se sigue llamando igual — el arreglo vive
      // en un solo sitio, no repetido aquí.
      const reenviado = convo.selected_payment_method
        ? await resendPaymentDetails(convo, { conFrase: true })
        : false;
      console.log(
        `[wf:decision] convo ${convo.id}: "${suyo.title || "(sin título)"}" ya estaba contestado → ${
          reenviado ? "le reenvío sus datos sin volver a presentar" : "no lo repito, contesta el modelo"
        }`
      );
      return reenviado;
    }
    if (suyo) {
      // LAS MISMAS GUARDAS QUE EL PAGO, y por lo mismo.
      //
      // «Me robaron con el yape» y «no tengo yape» NOMBRAN el método sin
      // elegirlo. Sin esto, el cuadrito con la palabra «yape» le contestaría
      // con los datos justo a quien está diciendo que no puede o no confía.
      //
      // Y si hay un comprobante reciente que nadie ha contado, nombrar el
      // método es avisar de que ya pagó: ese turno es de la IA con visión.
      const comprobanteSinLeer = getRecentUserMessages(convo.id, 5).find(
        (mensaje) =>
          (mensaje.media_type === "image" || esComprobantePdf(mensaje)) &&
          Math.floor(Date.now() / 1000) - mensaje.created_at <= 180 &&
          !(convo.counted_receipts ?? "").includes(`img:${mensaje.id}`)
      );
      if (
        !messageHasPaymentConcern(msgContent) &&
        !methodMentionIsNegated(msgContent, convo.phone) &&
        !comprobanteSinLeer
      ) {
        const salio = await sendConfiguredSteps(convo, suyo.steps);
        if (salio || suyo.action) setUltimaDecision(convo.id, claveDeLaDecision);
        // EL CIERRE DEPENDE DE SUS BURBUJAS, NO DE SI HAY ACCIÓN ENLAZADA.
        //
        // Estaba metido en la rama de «sin acción», y eso lo hacía depender de
        // algo que no tiene nada que ver: un cuadrito que da la cuenta cierra la
        // venta lleve acción o no. Con una acción enlazada —aunque esa acción no
        // aplique a esta modalidad y no haga nada— la conversación se quedaba
        // sin método anotado y en la etapa anterior, y el comprobante perdía su
        // atajo al lector.
        const eligiendoMetodo = detectPaymentRoute(msgContent, convo.phone);
        const susBurbujasCierranLaVenta = susBurbujasLlevanLosDatos(suyo.steps);
        if (eligiendoMetodo && susBurbujasCierranLaVenta) {
          // La misma puerta que usan los quince caminos de pago: ni adelanta una
          // elección pendiente ni retrocede desde la postventa.
          dejarLaVentaEsperandoElComprobante(convo, eligiendoMetodo, config);
        }
        if (suyo.action) {
          await ejecutarAccion(
            convo,
            suyo.action,
            suyo.payment_method,
            suyo.title || "esta decisión",
            suyo.steps
          );
          console.log(
            `[wf:decision] convo ${convo.id}: eligió "${suyo.title || "(sin título)"}" fuera de la pausa`
          );
          return true;
        }
        if (salio) {
          // SU TEXTO ES LA RESPUESTA, IGUAL QUE EN LA PAUSA.
          //
          // Aquí estuvo el fallo. Se dejaba seguir el mensaje SIEMPRE, dando
          // por hecho que su texto era un añadido. No lo es: los cuadritos de
          // pago llevan las tres burbujas enteras —presentación, la cuenta y el
          // cierre—, así que detrás salía la de fábrica diciendo lo mismo. El
          // mismo duplicado que ya se corrigió en el segundo producto y en el
          // Order Bump, por tercera vez y en otro sitio.
          //
          // Solo hay UN caso en que el mensaje tiene que seguir: que el cliente
          // esté eligiendo método de pago Y su texto no diga a dónde pagar. Ahí
          // falta la parte de los datos, y esa sí sale — sin repetir la
          // presentación, que ya la hizo él.
          if (!eligiendoMetodo || susBurbujasCierranLaVenta) {
            console.log(
              `[wf:decision] convo ${convo.id}: contestó "${suyo.title || "(sin título)"}" con su texto${
                eligiendoMetodo ? ` → anotado ${eligiendoMetodo}, esperando su pago` : ""
              }`
            );
            return true;
          }
          suTextoYaPresentoElPago = true;
          console.log(
            `[wf] convo ${convo.id}: el texto de "${suyo.title || "(sin título)"}" no lleva los datos → sigue, y el de fábrica sale sin repetir la presentación`
          );
        }
      }
    }
  }

  // RE-ENVÍO DETERMINÍSTICO DE DATOS DE PAGO: si el cliente YA eligió un método
  // y, tras un desvío, vuelve a PEDIR los datos / cómo pagar / dice que va a
  // pagar, el SISTEMA re-envía la plantilla de ESE método (datos correctos +
  // CTA) en vez de mandarlo a "buscar arriba". Es determinístico (no depende de
  // que el modelo obedezca). NO aplica si: ya pagó (estados post-venta), manda
  // un comprobante, o nombra un método DISTINTO (cambio → flujo normal de abajo).
  const isPostSaleState =
    state === "payment_approved" ||
    state === "awaiting_email" ||
    state === "awaiting_gift_consent" ||
    state === "awaiting_facebook_comment";
  // MIENTRAS SE ESPERA QUE ELIJA PRODUCTO, ESTE REENVÍO NO SE METE.
  //
  // LO QUE PASÓ. El cliente ya tenía Plin elegido, se le mostraron las dos
  // opciones, y escribió «el combo esta bien como pago». Dentro de esa frase hay
  // un «como pago», y el detector de «¿cómo pago?» la cazó: este bloque se quedó
  // el turno y le reenvió los datos.
  //
  // Consecuencias, y la segunda es la grave:
  //  · Como es un REENVÍO, quita la burbuja que presenta el pago —a propósito,
  //    para no volver a vender algo ya vendido—. El cliente vio los datos sin la
  //    frase que los presenta.
  //  · Y su elección del combo NO SE REGISTRÓ. Sin opción elegida, el reenvío
  //    sale con el precio BASE: eligió uno y le llegó el precio del otro.
  //
  // POR QUÉ SE ACOTA POR ETAPA Y NO POR PALABRAS. Perseguir «como pago» dentro
  // de una frase no termina nunca: mañana será «así pago», «para el pago» o
  // «eso pago». Lo que SÍ es cerrado es el momento: cuando el bot acaba de
  // preguntar cuál de las dos opciones quiere, el mensaje del cliente es la
  // respuesta a ESO, y esa etapa ya tiene quien la atienda.
  //
  // Y ARREGLA ALGO MÁS, de paso: quien pide los datos SIN haber elegido ya no
  // recibe un precio que nadie eligió. Su rama le recuerda las dos opciones, que
  // es lo correcto.
  //
  // FUERA DE LA ELECCIÓN NO CAMBIA NADA: en `intro_done` y en `payment_done`
  // este reenvío sigue funcionando igual que hoy.
  const esperandoQueElijaProducto =
    state === "awaiting_order_bump_choice" ||
    state === "awaiting_order_bump_payment_choice" ||
    state === "awaiting_post_payment_order_bump_choice" ||
    state === "awaiting_doble_oferta_dos_choice" ||
    state === "awaiting_bioferta_intro_choice" ||
    state === "awaiting_bioferta_choice";
  if (
    !isPostSaleState &&
    !esperandoQueElijaProducto &&
    // UN TURNO CON COMPROBANTE NO SE INTERCEPTA JAMÁS.
    //
    // El cliente manda la foto y escribe en la misma burbuja. Si esa frase caía
    // en los detectores de abajo, este bloque se quedaba el turno, le reenviaba
    // los datos de pago y el modelo NUNCA veía la imagen: nadie leía el monto y
    // la venta no se registraba.
    //
    // Y no era un retraso, era una pérdida: como el bot ya contestó DESPUÉS de
    // la foto, la regla del cerebro la da por atendida y no vuelve a mirarla.
    // Escribir "ya pagué" otra vez tampoco la rescataba.
    !latestIsImage &&
    convo.selected_payment_method &&
    detectPaymentRoute(msgContent, convo.phone) === null &&
    // Aqui el cliente YA eligio metodo, asi que las dos formas valen igual:
    // tanto pedir los datos como anunciar el pago deben re-enviarle SUS datos.
    // La distincion entre ambas solo importa cuando NO ha elegido (mas abajo).
    (messageAsksForPaymentDetails(msgContent) ||
      messageAnnouncesPayment(msgContent))
  ) {
    // CON SU FRASE: AQUÍ NO HABLA NADIE MÁS.
    //
    // LO QUE PASÓ — 24 de septiembre de 2026, seis conversaciones en paralelo.
    // El cliente escribió «quiero pagar» (Perú) y «voy a pagar» (Argentina), y
    // recibió el número de cuenta A SECAS, sin la burbuja que lo presenta. Con
    // sus palabras: «esa burbuja es importante para que no parezca que le están
    // tirando el método de pago en la cara».
    //
    // LA CAUSA: la frase de reenvío es opcional a propósito —cuando el reenvío
    // lo pide el MODELO con su marcador, él ya escribió algo y ponerle otra
    // encima serían dos saludos seguidos—. Pero ESTA puerta es del motor: se
    // queda el turno y el modelo no habla. Así que al no pedir la frase no la
    // decía nadie, y es el mismo fallo de siempre: sustituir con nada.
    //
    // Las demás puertas no se tocan: las que ya la pedían siguen igual, y las
    // del marcador siguen sin pedirla porque ahí sí habla el modelo.
    const ok = await resendPaymentDetails(convo, { conFrase: true });
    if (ok) {
      console.log(
        `[wf] convo ${convo.id} → re-envío determinístico de datos de pago (${convo.selected_payment_method})`
      );
      return true;
    }
  }

  // CASO 1: estado 'new' (brand-new o post-/restart) → saludar y programar fallback.
  const normalizedPostSaleText = msgContent
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "");
  // El comprobante y sus variables se calculan ARRIBA, antes del re-envío
  // determinístico: ese bloque necesita saber si hay una foto en juego para no
  // quedarse el turno y dejar el comprobante sin leer.
  const wantsPurchasedMaterial =
    /\b(no\s+me\s+(llega|llego|envian|enviaron|mandan|mandaron)|donde\s+esta|a\s+que\s+hora|cuando\s+me\s+(llega|llego|envian|mandan)|me\s+(envian|mandan|reenvian|pasan)|reenviame|reenvia|envia(me)?|manda(me)?|pasame)\b[\s\S]*\b(material|curso|link|enlace|acceso|video|pack|producto)\b/.test(
      normalizedPostSaleText
    ) ||
    /\b(material|curso|link|enlace|acceso|video|pack|producto)\b[\s\S]*\b(no\s+me\s+(llega|llego)|donde\s+esta|reenviame|reenvia|envia(me)?|manda(me)?|pasame)\b/.test(
      normalizedPostSaleText
    ) ||
    /\b(no\s+lo\s+(veo|encuentro|ubico|tengo|recibi|recibo)|no\s+me\s+aparece|no\s+aparece|se\s+(perdio|borro)|lo\s+perdi|pasamelo|pasame(lo)?|mandamelo|manda(me)?lo|envia(me)?lo|reenviar|reenviamelo|reenvialo)\b/.test(
      normalizedPostSaleText
    ) ||
    /\b(cuanto|cuando|a\s+que\s+hora)\b[\s\S]*\b(demora|tarda|llega|envian|mandan|recibo)\b/.test(
      normalizedPostSaleText
    );
  const looksLikePaymentEcho =
    latestIsImage ||
    /\b(listo|ya\s+esta|ahi\s+esta|ya\s+pague|ya\s+abone|ya\s+te\s+pase|te\s+pase|comprobante|voucher|capture|captura|pago\s+hecho)\b/.test(
      normalizedPostSaleText
    );
  // Intención de subir del básico al combo. AMPLIA: además de los verbos de
  // completar, incluye frases naturales ("el otro", "el mas caro", "el completo",
  // "el combo", "la diferencia", "el saldo"). Solo se usa en contexto post-venta
  // con básico comprado, así que estas frases = querer el combo.
  // La lista vive en config.ts y la comparten el motor y la validación del
  // comprobante. Teniendo cada uno la suya, el bot podía reconocer la intención
  // al hablar y NO reconocerla al llegar el pago — que es exactamente el fallo
  // que dejaba un upgrade cobrado y sin entregar.
  const wantsUpgradeToCombo =
    convo.order_bump_choice === "basico" &&
    detectaIntencionDeSubirAlCombo(normalizedPostSaleText, config);
  const hasRecentUpgradeIntent =
    wantsUpgradeToCombo ||
    getRecentUserMessages(convo.id, 6).some((message) =>
      detectaIntencionDeSubirAlCombo(message.content, config)
    );
  const mayBeDobleOfertaUpgradeReceipt =
    latestIsImage &&
    (isOrderBumpActive() || isDobleOfertaActive()) &&
    convo.order_bump_choice === "basico" &&
    hasRecentUpgradeIntent;

  // EL COMPROBANTE DEL SEGUNDO PRODUCTO NO ES EL ECO DEL PRIMERO.
  //
  // Después de una venta, la conversación queda en un estado post-compra
  // (payment_approved y compañía) y ahí TODO lo que suena a pago se trata como
  // un cliente repitiendo que ya pagó: se le contesta "tu pago ya está
  // confirmado" y el turno se cierra ahí.
  //
  // Eso está bien para el primer producto y mal para el segundo. El cliente
  // acepta el upsell, recibe los datos de pago, manda su comprobante — y el bot
  // le responde que ya pagó y le ofrece reenviarle el enlace del PRIMERO. El
  // comprobante nunca llega a leerse, así que la segunda venta no se registra
  // ni se entrega. Se cobra y no se entrega: no hay error peor.
  //
  // Ya existía esta misma salida para el que sube de básico a combo. Faltaba la
  // del upsell, que es el mismo caso: un pago NUEVO dentro de un estado que da
  // la venta por cerrada.
  //
  // Solo mientras el segundo producto está en juego y sin pagar. Una vez
  // pagado ("pagado"), o si se rechazó, vuelve a ser un eco como cualquier otro.
  const esperaPagoDelUpsell =
    convo.upsell_state === "ofrecido" || convo.upsell_state === "aceptado";

  if (
    isPostSaleState &&
    wantsUpgradeToCombo &&
    (isOrderBumpActive() || isDobleOfertaActive())
  ) {
    // CON DOS PRODUCTOS EN LA MESA, NO SE ADIVINA CUÁL: SE PREGUNTA.
    //
    // Mientras el extra está ofrecido hay dos cosas que se pueden «completar»:
    // subir a la opción cara, y el extra. Y «puedo completar», «el resto» o «la
    // diferencia» sirven para las dos. El detector de arriba solo mira esas
    // palabras, así que daba por hecho que era la opción cara y cotizaba SU
    // saldo — aunque el cliente hubiera dicho el nombre del extra.
    //
    // Pasó de verdad: el cliente escribió «puedo completar lo que ya pagué para
    // <el nombre del extra>» y el bot le pidió el saldo que faltaba de la opción
    // cara. Nombró un producto y le cotizaron el otro.
    //
    // Meter el nombre del extra en la lista no arregla nada: el siguiente
    // cliente lo llamará «el nuevo» o «el que me acabas de ofrecer», y encima
    // sería un nombre de producto escrito en el código, en una plantilla que se
    // instala para otros negocios. Lo que se arregla es QUIÉN decide: el
    // detector sigue diciendo CUÁNDO hay intención de completar, pero ya no dice
    // DE QUÉ. Eso sale de si nombró un producto, y si no nombró ninguno se le
    // pregunta con los dos nombres delante.
    //
    // ANTES DE QUE SE OFREZCA EL EXTRA NO CAMBIA NADA: sin extra en juego no hay
    // ambigüedad posible, así que se resuelve como «combo» y sigue el camino de
    // siempre — el upgrade de Order Bump y el de Doble Oferta, intactos.
    const aQueProducto = esperaPagoDelUpsell
      ? queProductoNombra(msgContent, config)
      : "combo";
    if (aQueProducto === "upsell") {
      await responderQueElExtraSePagaEntero(convo, config);
      console.log(
        `[wf] convo ${convo.id}: preguntó por completar y nombró el extra → le digo que va aparte`
      );
      return true;
    }
    if (aQueProducto === null) {
      await preguntarPorCualDeLosDos(convo, config);
      console.log(
        `[wf] convo ${convo.id}: quiere completar pero no dijo cuál → le pregunto por los dos`
      );
      return true;
    }
    const resolution = resolveAccumulatedOrderBumpChoice(convo.id, "combo");
    if (resolution?.approved) return true;
    if (resolution) {
      const missingLabel = formatConversationAmount(convo, resolution.missingSoles, config);
      await sendOrderBumpComboUpgradeMessage(convo, missingLabel, config);
      console.log(
        `[wf] convo ${convo.id} pidio upgrade a combo en postventa; saldo pendiente S/.${resolution.missingSoles}`
      );
      return true;
    }
  }

  if (state === "new") {
    // T0 (siempre, respondan o no): seguimientos desde el primer mensaje,
    // contacto CAPI para atribución de ads, y fila del lead en NocoDB.
    scheduleFollowupSequences(convo.id);
    void sendContactEvent({
      conversationId: convo.id,
      userData: buildMessagingUserData({
        channel: convo.channel,
        phone: convo.phone,
        firstName: convo.name,
        ctwa_clid: convo.ctwa_clid,
      }),
    });
    void syncLeadStatus(convo.id);
    // LA INTRO SALE SOLA. NO HAY PAUSA QUE ESPERAR.
    //
    // AQUÍ HABÍA UN INTERRUPTOR Y DOS CAMINOS, Y TRES SITIOS QUE PODÍAN FRENAR
    // LA CONVERSACIÓN NADA MÁS EMPEZARLA.
    //
    // 1. Un «inicio inmediato» POR CADA INTRO. Unas esperaban y otras no, sin
    //    nada visible que lo explicara.
    // 2. Un interruptor global. Apagado, el bot mandaba el saludo, se quedaba en
    //    «esperando respuesta» y soltaba la intro solo cuando el cliente volvía
    //    a escribir — o cuando vencía un temporizador de cinco minutos.
    // 3. Una «pregunta inicial» de sí o no, con esa misma espera detrás.
    //
    // Los tres existían por una razón que ya no está: el saludo era un paso
    // aparte, hecho para capturar el nombre. Hoy el nombre lo pide cualquier
    // burbuja con su casilla, y con plazo propio.
    //
    // Sin esa razón, la espera solo aportaba un hueco muerto al principio de
    // cada conversación: el cliente escribía, recibía una línea, y el resto
    // llegaba cuando volvía a escribir o cinco minutos después.
    //
    // Ahora es lo que sería en cualquier sitio: el cliente escribe y el bot
    // contesta. El saludo sale como el PRIMER MENSAJE —no como un paso que
    // espera— y la intro va detrás con su separación de siempre.
    //
    // NO SE BORRA NADA DEL ARCHIVO. Los campos siguen escritos y los caminos de
    // la pregunta inicial siguen enteros; simplemente ya nadie los arranca.
    //
    // Lo que SÍ sigue esperando es una burbuja con cuadritos de decisión, que es
    // donde hay una pregunta de verdad. Eso no se toca.
    const chosenIntro = chooseIntroSequence(config, convo);
    // SIN RESPALDO ENTRE PAÍSES Y SIN INTRO DE SU PAÍS: a humano, con aviso (16/10/2026).
    // Solo puede pasar con el interruptor apagado; encendido, `faltaLaDeSuPais` no se marca.
    if (chosenIntro.faltaLaDeSuPais) {
      await aHumanoPorqueFaltaLaPiezaDeSuPais(convo, config, "intro", chosenIntro.faltaPorTienda === true);
      return true;
    }
    setIntroVariantSent(convo.id, chosenIntro.variant);
    // Y EL CAMINO DE ESA INTRO (18/10/2026): desde aquí, sus pasos son los de su camino. Ver
    // `etiqueta-de-camino.ts`. Sin intros con camino queda vacío, que es el principal.
    setCaminoDeLaConversacion(convo.id, config.intro_caminos?.[chosenIntro.variant - 1] ?? null);
    // AQUÍ SE ENVIABA UN MENSAJE SUELTO POR DELANTE DE LA INTRO, Y SE VA.
    //
    // Era un paso aparte, con su propia casilla de un solo texto, hecho en su día
    // para preguntar el nombre y esperar la respuesta. Esa espera ya se quitó, y
    // el nombre lo pide hoy cualquier burbuja con su casilla y su plazo.
    //
    // Lo que quedaba era una casilla que solo admite UNA burbuja, alimentada con
    // el primer cajón del canal. Por eso una intro de diez burbujas salía con
    // una: las otras nueve no cabían en esa casilla y se descartaban.
    //
    // No hay nada que reemplazar. El cliente escribe y el bot contesta con la
    // intro, entera, desde su primera burbuja. Como en cualquier conversación.
    //
    // Los campos siguen en el archivo para no romper configuraciones viejas,
    // pero NADIE los envía. Si algún día alguien vuelve a mandarlos por delante,
    // la prueba `prueba-sin-mensaje-suelto-antes-de-la-intro` lo caza.
    console.log(
      `[wf] convo ${convo.id}: intro ${chosenIntro.variant} de corrido`
    );
    await scheduleIntroSequence(convo.id);
    return true;
  }

  // AQUÍ HABÍA DOS ESTADOS DE ESPERA, Y SE BORRAN.
  //
  // «awaiting_initial_question» atendía la pregunta de sí o no del arranque.
  // «awaiting_response» atendía la respuesta al saludo, y era donde se capturaba
  // el nombre del cliente.
  //
  // Los dos existían para lo mismo: el bot decía UNA línea y se callaba
  // esperando permiso para seguir. Ya nadie los pone, porque el bot manda el
  // saludo y la intro de corrido, así que este código no se podía alcanzar.
  //
  // No se deja desenchufado: se quita. Código que nadie ejecuta y que sigue
  // escrito es peor que no tenerlo — el que lo lea creerá que el bot hace eso.
  //
  // LO QUE HACÍAN, Y DÓNDE VIVE AHORA.
  //
  //   Pedir el nombre y guardarlo → la casilla «Aquí le pregunto su nombre» de
  //   cualquier burbuja, con su plazo propio.
  //   Preguntar y esperar la respuesta → los cuadritos de decisión, en la
  //   burbuja que se quiera y con el texto que se quiera.
  //
  // Lo hacen mejor: donde el operador decida, no siempre al principio.

  // CASO 3: intro corriendo. APLAZAR (no descartar): el cliente escribió mientras
  // se entrega la intro. NO respondemos ahora (para no cortar la intro con una
  // respuesta fuera de orden), pero tampoco lo tiramos: ESPERAMOS a que la intro
  // termine de entregarse (la reparte el worker, sin el candado del teléfono) y
  // recién ahí procesamos el mensaje EN ORDEN, por el flujo normal (que ya
  // responde y hace su re-pregunta final). Así no queda mudo.
  if (state === "intro_running") {
    const deadline = Date.now() + 45_000; // tope de seguridad
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1500));
      const fresh = getConversationById(convo.id);
      if (!fresh) return true;
      if (fresh.state !== "intro_running") {
        console.log(
          `[wf] convo ${convo.id}: intro terminó, respondo el mensaje aplazado "${msgContent.slice(0, 40)}"`
        );
        // Reprocesa con el estado ya actualizado (intro_done, order bump, etc.):
        // enruta al handler correcto y, si no aplica, cae al LLM del handler.
        return await tryWorkflowOnIncoming(fresh, msgContent);
      }
    }
    console.log(
      `[wf] convo ${convo.id}: intro no terminó a tiempo, suprimo entrada (fallback)`
    );
    return true;
  }

  const hasEmailLikeText = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(
    msgContent
  );
  if (state === "awaiting_delivery_preference") {
    const source = normalizeDeliverySource(convo.pending_delivery_source);
    if (!source) {
      setConversationState(convo.id, "payment_approved");
      return true;
    }
    if (hasEmailLikeText) {
      deliverAfterPreference(convo, source);
      await tryCaptureEmail(convo, msgContent);
      return true;
    }
    const preference = detectDeliveryPreference(msgContent);
    if (preference === "email") {
      if (!deliverAfterPreference(convo, source)) return true;
      scheduleDeliveryPreferenceEmailRequest(convo, config);
      setConversationState(convo.id, "awaiting_email");
      return true;
    }
    if (preference === "whatsapp") {
      deliverAfterPreference(convo, source);
      return true;
    }
    if (hasPendingActionType(convo.id, ACTION_SEND_DELIVERY_PREFERENCE)) {
      console.log(
        `[wf] convo ${convo.id}: mensaje recibido antes de botones postventa; espero preferencia`
      );
      return true;
    }
    const sentFallback = await sendPostSaleDeliverySteps(
      convo,
      config?.post_sale_delivery_preference?.fallback_whatsapp_steps
    );
    if (!sentFallback) {
      await sendBotText(convo, getDeliveryPreferenceFallbackText(config));
    }
    deliverAfterPreference(convo, source);
    return true;
  }
  // ── LA ETIQUETA DE UN BOTÓN MANDA SOBRE CUALQUIER PALABRA CLAVE ──────────
  //
  // El regalo y la oferta del segundo producto pueden estar abiertos A LA VEZ:
  // la oferta no se cierra cuando sale el regalo, a propósito, para no perder la
  // venta. Y con dos preguntas en pantalla, un «sí» suelto lo puede reclamar
  // cualquiera de las dos.
  //
  // El desempate NO puede ser el orden en que está escrito el código, que es lo
  // que pasaba: el bloque del upsell está más arriba, así que se quedaba el
  // «sí» del regalo. Peor todavía, el botón del regalo llegaba disfrazado de
  // «Si quiero» —el webhook le cambiaba el texto—, que es palabra por palabra
  // una de las claves típicas del cuadrito del upsell. Tocar el botón del
  // regalo compraba el segundo producto. Siempre, no por casualidad.
  //
  // Una etiqueta tocada es un HECHO; una palabra clave es una suposición. Así
  // que se mira primero, y solo mientras esa pregunta esté de verdad abierta.
  if (convo.state === "awaiting_gift_consent") {
    const botonRegalo = botonDelRegalo(msgContent, config);
    if (botonRegalo === "si") {
      console.log(`[wf] convo ${convo.id}: tocó el botón de SÍ del regalo`);
      acceptGiftConsent(convo);
      return true;
    }
    if (botonRegalo === "no") {
      console.log(`[wf] convo ${convo.id}: tocó el botón de NO del regalo`);
      await declineGiftConsent(convo);
      return true;
    }
    // Y SUS CUADRITOS, con las palabras que use cada negocio.
    //
    // También antes que el upsell, y por lo mismo: son los de la pregunta que
    // el cliente tiene delante. Van después del botón porque una etiqueta
    // tocada es más segura que una palabra clave, aunque las dos sean de aquí.
    if (config) {
      const cuadritoRegalo = decisionDelRegalo(config, msgContent);
      if (cuadritoRegalo) {
        const salio = await sendConfiguredSteps(convo, cuadritoRegalo.steps);
        if (cuadritoRegalo.action) {
          await ejecutarAccion(
            convo,
            cuadritoRegalo.action,
            cuadritoRegalo.payment_method,
            cuadritoRegalo.title || "este cuadrito del regalo",
            cuadritoRegalo.steps
          );
        }
        // La misma regla que en la oferta del extra: uno que ni dice ni hace
        // nada no se queda el turno. Si no, el cliente contesta y no le
        // responde nadie.
        if (
          salio ||
          tieneBurbujasEncendidas(cuadritoRegalo.steps) ||
          cuadritoRegalo.action
        ) {
          console.log(
            `[wf] convo ${convo.id}: contestó al regalo con "${cuadritoRegalo.title || "(sin título)"}"`
          );
          return true;
        }
        console.log(
          `[wf] convo ${convo.id}: el cuadrito del regalo "${cuadritoRegalo.title || "(sin título)"}" está vacío y sin acción → dejo pasar el mensaje`
        );
      }
    }
  }
  // UPSELL. Va ANTES que los estados porque la oferta no vive en un estado:
  // sigue en pie aunque ya haya salido el regalo, y se acepta escribiendo el
  // NOMBRE del segundo producto en cualquier momento.
  //
  // ESTABA ESCRITO MÁS ABAJO, Y ESO LO DEJABA MUERTO.
  //
  // Al ofrecer el upsell la conversación pasa a "awaiting_email" —el estado que
  // hace de sala de espera de la postventa—, y la rama de ese estado termina
  // SIEMPRE en un return: o captura el correo, o se lo pasa al modelo. Así que
  // esto de aquí no se ejecutaba nunca mientras la oferta estaba en pie, que es
  // justo cuando hace falta.
  //
  // El cliente tocaba "Sí, lo quiero", llegaba el nombre del producto, y el
  // modelo —que no sabe que existe un segundo producto— contestaba que no se
  // venden otros. No fallaba nada: se perdía la venta en silencio, con una
  // respuesta educada.
  if (convo.upsell_state === "ofrecido") {
    // ¿Pregunta qué trae el segundo producto? Se le responde con SUS burbujas
    // y SU galería, sin llamar al modelo. Va antes que la aceptación porque
    // "¿qué incluye el pack?" es una pregunta, no un "me lo llevo".
    if (await responderContenidoDelUpsell(convo, msgContent, config)) {
      return true;
    }
    // EL BOTÓN, POR SU ETIQUETA.
    //
    // Va primero y sin más condiciones: tocar un botón es la respuesta menos
    // ambigua que existe. Se compara contra las etiquetas configuradas —exacto,
    // sin adivinar— así que da igual que digan «Sí, lo quiero», «Dale» o lleven
    // emojis. Antes el botón llegaba disfrazado del nombre del producto para
    // que lo reconocieran, y eso dejaba en el chat un texto que el cliente
    // nunca escribió.
    // EL CUADRITO DE LA OFERTA, SI ALGUNO RECONOCE LO QUE ESCRIBIÓ.
    //
    // Se busca aquí, pero NO decide nada por su cuenta: quién acepta y quién
    // rechaza lo siguen diciendo los mismos detectores de siempre, con la misma
    // sensibilidad. El cuadrito solo aporta LAS BURBUJAS.
    //
    // Es a propósito. Las palabras de un cuadrito se comparan sueltas, y «no»
    // aparece dentro de «no entiendo» o «no sé cuánto es» — preguntas, no
    // rechazos. Dejando la decisión en los detectores, esto no puede cerrar una
    // venta que hoy no se cierra.
    // ¿SIGUE SIENDO LA ÚLTIMA PREGUNTA? Se calcula UNA vez y manda sobre las
    // dos puertas que aceptan un «sí» a secas: el detector de abajo y este
    // cuadrito. Gatear solo una dejaba la otra abierta — el cuadrito «SI» de
    // este bot tiene entre sus palabras «si», «ok» y «k», así que habría
    // recogido igual el sí que era del modelo.
    const esLaUltimaPregunta = laOfertaSigueSiendoLaUltimaPregunta(convo);
    if (!esLaUltimaPregunta) {
      console.log(
        `[wf:upsell] convo ${convo.id}: la oferta ya no es la última pregunta — un «sí» a secas no la acepta`
      );
    }
    const cuadrito = decisionDeLaOfertaDelExtra(
      config,
      msgContent,
      esLaUltimaPregunta
    );
    const aceptarConSuCuadrito = async (): Promise<void> => {
      if (!cuadrito) {
        await entregarDatosDePagoDelUpsell(convo);
        return;
      }
      const yaMandoLosDatos = await responderConElCuadritoDelExtra(
        convo,
        cuadrito,
        config
      );
      // Con acción linkeada, ella mandó los datos y dejó todo anotado. Sin
      // acción, las burbujas del cuadrito SON la respuesta: se anota que aceptó
      // y no se manda la respuesta de siempre encima.
      if (!yaMandoLosDatos) {
        await entregarDatosDePagoDelUpsell(convo, { enviarDatos: false });
      }
    };
    const rechazarConSuCuadrito = async (): Promise<void> => {
      if (cuadrito) {
        await responderConElCuadritoDelExtra(convo, cuadrito, config);
      }
      await rechazarUpsell(convo, config, { enviarTexto: !cuadrito });
    };
    const tocoUnBoton = botonDelUpsell(msgContent, config);
    if (tocoUnBoton === "si") {
      console.log(`[wf:upsell] convo ${convo.id}: tocó el botón de sí`);
      await aceptarConSuCuadrito();
      return true;
    }
    if (tocoUnBoton === "no") {
      console.log(`[wf:upsell] convo ${convo.id}: tocó el botón de no`);
      await rechazarConSuCuadrito();
      return true;
    }
    if (detectaAceptacionDeUpsell(msgContent, config)) {
      console.log(`[wf:upsell] convo ${convo.id}: lo pidió por su nombre`);
      await aceptarConSuCuadrito();
      return true;
    }
    // El "no" —y el "sí" a secas— solo se leen como respuesta a ESTA oferta
    // MIENTRAS el regalo no haya salido todavía. Después hay dos preguntas
    // abiertas y la respuesta es del regalo, que es la más reciente.
    //
    // `esLaUltimaPregunta` es esa misma frase para todos los demás: el modelo
    // contestando una duda, un seguimiento, o una persona desde el panel.
    // Cualquiera de ellos puede cerrar con SU pregunta, y entonces el "sí" es
    // suyo. Va junto al del regalo porque es la misma regla, no otra.
    // EL REGALO ESTORBA MIENTRAS ESPERA RESPUESTA, NO PARA SIEMPRE.
    //
    // Antes esta condición era `hasPendingActionType(ACTION_UPSELL_TIMEOUT)`,
    // que significa «el plazo del segundo producto sigue vivo». Y ese plazo, una
    // vez vencido, NO VUELVE NUNCA. Así que a partir del momento en que salía el
    // regalo, un «sí» pelado dejaba de aceptar el segundo producto para el resto
    // de la conversación — aunque una hora después el regalo ya estuviera
    // resuelto y volviera a haber una sola pregunta en pantalla.
    //
    // La regla que se quería escribir es la de arriba: «después hay DOS
    // preguntas abiertas y la respuesta es de la más reciente». Eso dura lo que
    // dura la pregunta del regalo, no para siempre. En cuanto el cliente la
    // contesta —la acepte o la rechace— vuelve a haber una sola.
    //
    // Y el resto lo sigue decidiendo `esLaUltimaPregunta`, que es quien de
    // verdad sabe si alguien habló después de la oferta. Esta condición es solo
    // el cinturón para el caso concreto del regalo en pantalla.
    //
    // DÓNDE SE NOTA. El cliente vuelve más tarde, pregunta qué trae el segundo
    // producto, el motor le contesta con sus burbujas —y al hacerlo vuelve a
    // sellar la oferta— y entonces dice «sí». Hoy eso no se acepta y hay que
    // escribir el nombre del producto entero. Con esto, se acepta.
    const elRegaloEstaEsperandoRespuesta =
      state === "awaiting_gift_consent";
    const nadieMasPregunto =
      !elRegaloEstaEsperandoRespuesta && esLaUltimaPregunta;
    // El "sí" pelado. Hace falta porque la pregunta del final ofrece elegir
    // entre sí y no: exigir el nombre del producto dejaba sin respuesta a quien
    // contesta lo que se le pidió que contestara.
    if (nadieMasPregunto && detectaSiSimpleAlUpsell(msgContent)) {
      console.log(`[wf:upsell] convo ${convo.id}: dijo que sí`);
      await aceptarConSuCuadrito();
      return true;
    }
    if (nadieMasPregunto && detectaRechazoDeUpsell(msgContent)) {
      console.log(`[wf:upsell] convo ${convo.id}: dijo que no`);
      await rechazarConSuCuadrito();
      return true;
    }
    // NINGÚN DETECTOR LO RECONOCIÓ, PERO UN CUADRITO SÍ.
    //
    // Es la red para los cuadritos con palabras propias —«el pack premium»,
    // «quiero los dos»— que los detectores no tienen por qué conocer. Aquí solo
    // puede AÑADIR: sin esto, este mensaje se iba al modelo sin más. Por eso no
    // toca el estado de la oferta: contestar no es aceptar. Si el cuadrito lleva
    // una acción linkeada, ella sí decide.
    if (cuadrito) {
      // UN CUADRITO QUE NI DICE NI HACE NADA NO SE QUEDA EL TURNO.
      //
      // Quedárselo era dejar al cliente sin respuesta: el bot daba el mensaje
      // por atendido y no contestaba NADIE. Silencio.
      //
      // Y no es raro: el cuadrito «NO» suele estar sin burbujas —porque el
      // rechazo lo contesta el flujo del regalo— y sin acción —porque no hay
      // ninguna de rechazo—. Con la oferta abierta y el regalo en pantalla, un
      // «no» del REGALO caía aquí, no salía nada, y el regalo nunca llegaba a
      // procesarlo.
      //
      // Ahora, si no salió ninguna burbuja y no había acción, se deja pasar: lo
      // atiende quien corresponda, que es lo que habría hecho sin el cuadrito.
      const salioAlgo = await responderConElCuadritoDelExtra(
        convo,
        cuadrito,
        config
      );
      const tieneBurbujas = tieneBurbujasEncendidas(cuadrito.steps);
      if (salioAlgo || tieneBurbujas || cuadrito.action) {
        console.log(
          `[wf:upsell] convo ${convo.id}: contestó "${cuadrito.title || "(sin título)"}"`
        );
        return true;
      }
      console.log(
        `[wf:upsell] convo ${convo.id}: el cuadrito "${cuadrito.title || "(sin título)"}" está vacío y sin acción → dejo pasar el mensaje`
      );
    }
  }

  if (state === "awaiting_email" && !hasEmailLikeText) {
    const declinedEmail = detectEmailDeclineOrProblem(msgContent);
    if (declinedEmail) {
      await sendDeliveryPreferenceFallbackNow(convo, config);
      return true;
    }
    if (wantsPurchasedMaterial) {
      await sendBotText(convo, "Claro, te lo reenvio ahora mismo.");
      const ok = resendApprovedMaterial(convo);
      console.log(
        `[wf] convo ${convo.id} -> reenvio deterministico de material en awaiting_email (ok=${ok})`
      );
      return true;
    }
    if (looksLikePaymentEcho) {
      // Se deja pasar para que el comprobante se lea de verdad: el pago del
      // segundo producto se valida aparte (ver payment.ts), contra SU precio.
      if (mayBeDobleOfertaUpgradeReceipt || esperaPagoDelUpsell) return false;
      // La aprobación ya programó la secuencia de entrega (incluido el upsell).
      // No respondas con el fallback de "ya fue enviado" en este mismo turno:
      // el worker debe enviar primero el enlace pendiente.
      if (
        latestIsImage &&
        (hasPendingActionType(convo.id, ACTION_SEND_PAYMENT_APPROVED_STEP) ||
          hasPendingActionType(convo.id, ACTION_SEND_DELIVERY_PREFERENCE))
      ) {
        return true;
      }
      await sendBotText(
        convo,
        "Tu pago ya esta confirmado. Ya te envie el material mas arriba; si no lo ves, te lo puedo reenviar."
      );
      return true;
    }
  }

  // CASO especial: estamos esperando el email del cliente tras pago aprobado.
  // Si en su mensaje hay un email válido → guardamos, confirmamos, adelantamos gift.
  // Si NO hay email → caemos al LLM para que responda preguntas / dudas del cliente.
  // El gift sigue programado al timeout original (5 min por defecto).
  if (state === "awaiting_email") {
    if (await tryCaptureEmail(convo, msgContent)) {
      cancelPendingActionsByTypeForConvo(convo.id, "send_gift_audio");
      cancelPendingActionsByTypeForConvo(convo.id, "send_gift_text");
      const between =
        config?.between_messages_delay_seconds ?? DEFAULT_BETWEEN_MESSAGES_DELAY;
      scheduleGiftConsentWithDelay(convo.id, between);
      console.log(
        `[wf] email capturado temprano en convo ${convo.id}, gift adelantado a ${between}s`
      );
      return true;
    }
    // El cliente PIDE recibirlo por correo pero aún no dio una dirección válida
    // (p. ej. "me lo puede enviar a mi correo?"). Respondemos determinísticamente
    // pidiéndole el correo, en vez de dejar que el LLM improvise y reenvíe el pago
    // o el enlace ya entregado.
    if (detectEmailDeclineOrProblem(msgContent)) {
      await sendDeliveryPreferenceFallbackNow(convo, config);
      return true;
    }
    if (looksLikeInvalidEmailAttempt(msgContent)) {
      await sendBotText(
        convo,
        "Creo que el correo esta incompleto o tiene un error. Enviamelo completo, por ejemplo: nombre@gmail.com"
      );
      return true;
    }
    if (mentionsEmailChannel(msgContent)) {
      await sendDeliveryPreferenceEmailRequestNow(convo, config);
      return true;
    }
    // Sin email -> Salesbot si esta activo; si no, LLM responde.
    return trySalesbotOrLlm(convo, msgContent, config);
  }

  // Si está en postventa y el cliente escribe un correo, lo capturamos y
  // enviamos el material ahí. Si ya tenía correo, permite cambiarlo/reenviarlo
  // a otro ("mi correo está lleno, envíame a este otro").
  if (state === "payment_approved") {
    if (await tryCaptureEmail(convo, msgContent)) {
      await maybeSendCustomerSurveyNow(convo.id);
      return true;
    }
  }
  if (state === "payment_approved") {
    if (wantsUpgradeToCombo && (isOrderBumpActive() || isDobleOfertaActive())) {
      const resolution = resolveAccumulatedOrderBumpChoice(convo.id, "combo");
      if (resolution && !resolution.approved) {
        const missingLabel = formatConversationAmount(convo, resolution.missingSoles, config);
        await sendOrderBumpComboUpgradeMessage(convo, missingLabel, config);
        console.log(
          `[wf] convo ${convo.id} pidió upgrade a combo tras recibir el básico; saldo pendiente S/.${resolution.missingSoles}`
        );
        return true;
      }
    }
    if (wantsPurchasedMaterial) {
      await sendBotText(convo, "Claro, te lo reenvio ahora mismo.");
      const ok = resendApprovedMaterial(convo);
      console.log(
        `[wf] convo ${convo.id} -> reenvio deterministico de material en payment_approved (ok=${ok})`
      );
      return true;
    }
    if (looksLikePaymentEcho) {
      // Se deja pasar para que el comprobante se lea de verdad: el pago del
      // segundo producto se valida aparte (ver payment.ts), contra SU precio.
      if (mayBeDobleOfertaUpgradeReceipt || esperaPagoDelUpsell) return false;
      if (
        latestIsImage &&
        (hasPendingActionType(convo.id, ACTION_SEND_PAYMENT_APPROVED_STEP) ||
          hasPendingActionType(convo.id, ACTION_SEND_DELIVERY_PREFERENCE))
      ) {
        return true;
      }
      await sendBotText(
        convo,
        "Tu pago ya esta confirmado. Ya te envie el material mas arriba; si no lo ves, te lo puedo reenviar."
      );
      return true;
    }
  }

  // CASO: cliente recibió la pregunta de consentimiento del regalo extra
  // y le toca responder sí / no / ambiguo.
  if (state === "awaiting_gift_consent") {
    if (shouldIgnoreChoicePresentationInterruption(convo, state)) {
      console.log(
        `[wf] convo ${convo.id}: ignoro entrada durante presentacion con eleccion`
      );
      return true;
    }
    // Igual que arriba: un comprobante del segundo producto no es el eco del
    // primero, aunque llegue con el regalo ya en marcha — la oferta del upsell
    // sigue abierta hasta que se paga o se rechaza.
    /* PERO UN COMPROBANTE ES UNA FOTO. CON TEXTO PELADO NO HAY NADA QUE PROTEGER.
     *
     * LO QUE PASÓ — 29 de septiembre de 2026, su prueba ARYI1 (convo 287). Había
     * pagado, su entrega ya había salido, y el extra estaba ofrecido sin pagar.
     * Reclamó OCHO veces que no le llegaba el enlace —«no me enviaron mi enlace»,
     * «por eso no me entregaste el enlace», «no lo veo», «Señorita yo ya le di el
     * comprobante»— y nunca lo recibió.
     *
     * ESTA LÍNEA ERA LA CAUSA, y no por estar mal: está para que un comprobante del
     * extra llegue al lector en vez de quedarse aquí. Pero se apartaba TAMBIÉN con
     * texto pelado, y al apartarse el turno se lo quedaba el modelo, sin red. En
     * ARYI1 el modelo leyó «ya pagué y te mandé la imagen» como un comprobante,
     * intentó registrar un pago, el guardarraíl lo rechazó por no haber foto, y el
     * cliente acabó recibiendo otra petición de comprobante.
     *
     * LO QUE LO DEMUESTRA: de sus seis conversaciones en paralelo, ARYI1 fue la
     * ÚNICA que estaba a la vez en el regalo Y con el extra sin pagar. Las otras
     * cinco recibieron su enlace — tres por este mismo camino determinístico, dos
     * porque el modelo acertó a pedirlo. Cinco de seis dependían de la suerte.
     *
     * LA REGLA: la puerta sigue apartándose para las FOTOS, que es para lo que
     * está. Con texto pelado de alguien que YA PAGÓ y pide lo que compró, el motor
     * atiende el turno y reenvía, sin preguntarle nada al modelo.
     *
     * NO SE AÑADE NINGUNA FRASE AL CÓDIGO, y es a propósito: el dueño lo pidió con
     * estas palabras —«no pongas regla que esa conversación idéntica tendrán todos
     * los clientes»—. Quien decide «está pidiendo lo que compró» sigue siendo
     * `wantsPurchasedMaterial`, el mismo detector que ya usan las otras cuatro
     * etapas de postventa. Aquí solo se deja de saltárselo.
     *
     * Y NO SE TOCA NADA MÁS DE ESTE BLOQUE: el correo se sigue capturando antes, el
     * sí/no del regalo sigue mandando antes, y el reenvío ocurre en su sitio de
     * siempre, unas líneas más abajo. `mayBeDobleOfertaUpgradeReceipt` exige foto,
     * así que con texto ni entra en juego: lo único que se acota es la espera del
     * pago del extra.
     */
    const pideLoQueYaComproSinFoto = !latestIsImage && wantsPurchasedMaterial;
    if (
      (mayBeDobleOfertaUpgradeReceipt || esperaPagoDelUpsell) &&
      !pideLoQueYaComproSinFoto
    )
      return false;
    // Capturamos email si todavía no lo tenía y vino uno en este mensaje.
    let emailJustCaptured = false;
    if (!convo.client_email) {
      emailJustCaptured = await tryCaptureEmail(convo, msgContent);
    }

    const consent = detectGiftConsent(msgContent);
    if (consent === "yes") {
      acceptGiftConsent(convo);
      return true;
    }
    if (consent === "no") {
      await declineGiftConsent(convo);
      return true;
    }
    // Ambiguo: si captó email lo confirmamos, sino dejamos al LLM responder.
    if (emailJustCaptured) {
      return true;
    }
    if (wantsPurchasedMaterial) {
      await sendBotText(convo, "Claro, te lo reenvio ahora mismo.");
      const ok = resendApprovedMaterial(convo);
      console.log(
        `[wf] convo ${convo.id} -> reenvio deterministico de material en awaiting_gift_consent (ok=${ok})`
      );
      return true;
    }
    if (looksLikePaymentEcho) {
      // Se deja pasar para que el comprobante se lea de verdad: el pago del
      // segundo producto se valida aparte (ver payment.ts), contra SU precio.
      if (mayBeDobleOfertaUpgradeReceipt || esperaPagoDelUpsell) return false;
      await sendBotText(
        convo,
        "Tu pago ya esta confirmado, tu material ya fue enviado."
      );
      return true;
    }
    return trySalesbotOrLlm(convo, msgContent, config);
  }

  // Mecánica de regalo por comentar en Facebook. En este estado puede
  // pasar 3 cosas a la vez:
  //  - Cliente escribe "COMENTADO" → enviamos reward, transicionamos
  //  - Cliente da su correo (aún sin capturar) → capturamos sin cambiar estado
  //  - Ambas → capturamos email + enviamos reward
  if (state === "awaiting_facebook_comment") {
    if (shouldIgnoreChoicePresentationInterruption(convo, state)) {
      console.log(
        `[wf] convo ${convo.id}: ignoro entrada durante presentacion con eleccion`
      );
      return true;
    }
    // Igual que arriba: un comprobante del segundo producto no es el eco del
    // primero, aunque llegue con el regalo ya en marcha — la oferta del upsell
    // sigue abierta hasta que se paga o se rechaza.
    /* Y AQUÍ EL MISMO ACOTE QUE EN EL REGALO. Ver la nota larga allí.
     *
     * Es su hermana gemela: la misma línea, en el estado que viene justo DESPUÉS.
     * Arreglar solo uno de los dos deja al mismo cliente chocando con la misma
     * pared un paso más adelante, que es la trampa que este proyecto ya ha pagado
     * tres veces: la misma regla escrita en dos sitios y corregida en uno.
     *
     * La puerta sigue apartándose para las FOTOS. Con texto pelado de alguien que
     * ya pagó y pide lo que compró, el motor atiende y reenvía.
     */
    if (
      (mayBeDobleOfertaUpgradeReceipt || esperaPagoDelUpsell) &&
      !(!latestIsImage && wantsPurchasedMaterial)
    )
      return false;
    // Una FOTO (el cliente suele mandar la captura de su comentario) también
    // cuenta como confirmación — un falso positivo solo regala un PDF gratis.
    const sentImage = getLatestUserMessage(convo.id)?.media_type === "image";
    const wantsReward = containsCommentedKeyword(msgContent) || sentImage;

    let emailJustCaptured = false;
    if (!convo.client_email) {
      emailJustCaptured = await tryCaptureEmail(convo, msgContent);
    }

    if (wantsReward) {
      await claimGiftReward(convo);
      return true;
    }

    if (emailJustCaptured) return true;
    if (wantsPurchasedMaterial) {
      await sendBotText(convo, "Claro, te lo reenvio ahora mismo.");
      const ok = resendApprovedMaterial(convo);
      console.log(
        `[wf] convo ${convo.id} -> reenvio deterministico de material en awaiting_facebook_comment (ok=${ok})`
      );
      return true;
    }
    if (looksLikePaymentEcho) {
      // Se deja pasar para que el comprobante se lea de verdad: el pago del
      // segundo producto se valida aparte (ver payment.ts), contra SU precio.
      if (mayBeDobleOfertaUpgradeReceipt || esperaPagoDelUpsell) return false;
      await sendBotText(
        convo,
        "Tu pago ya esta confirmado, tu material ya fue enviado."
      );
      return true;
    }
    // Ni COMENTADO ni email → LLM responde guiando al cliente. El system
    // prompt tiene reglas específicas para no inventar links de regalo.
  }

  // SI NOMBRA UN MÉTODO MIENTRAS ELIGE PRODUCTO, SE ANOTA. No se contesta con
  // él ni se le manda nada: las ramas de abajo siguen mandando exactamente
  // igual que hoy. Lo único que cambia es que su método nuevo ya no se pierde.
  //
  // SOLO EN LAS TRES PANTALLAS DE ELECCIÓN QUE VAN ANTES DE PAGAR, y las tres
  // juntas para que no quede una bien y la otra coja: -OB- y -DOU- son las
  // activas, bioferta entra por simetría. Las de DESPUÉS de pagar quedan fuera
  // a propósito: ahí hay dinero abonado y quien resta saldos es otra puerta.
  if (
    state === "awaiting_order_bump_choice" ||
    state === "awaiting_doble_oferta_dos_choice" ||
    state === "awaiting_bioferta_intro_choice"
  ) {
    anotarMetodoElegidoDuranteLaEleccion(convo, msgContent);
  }

  // CASO ORDER BUMP: ya se mostró la oferta intermedia (combo/básico) y
  // esperamos que el cliente elija (escribiendo el nombre o tocando un botón).
  if (
    state === "awaiting_order_bump_payment_choice" ||
    state === "awaiting_post_payment_order_bump_choice"
  ) {
    // Otro comprobante se registra antes de volver a pedir confirmacion.
    if (latestIsImage) return false;
    const choice = inferTwoTierChoiceFromContext(
      msgContent,
      convo.order_bump_choice,
      config
    );
    // Cualquier respuesta natural se interpreta con criterio mediante la tool
    // seleccionar_opcion; el motor solo acelera botones/nombres exactos.
    if (!choice) {
      if (isAmbiguousTwoTierChoice(msgContent, config)) {
        await sendTwoTierChoiceClarification(convo, config, false);
        return true;
      }
      return trySalesbotOrLlm(convo, msgContent, config);
    }

    const resolution = resolveAccumulatedOrderBumpChoice(convo.id, choice);
    if (!resolution) return trySalesbotOrLlm(convo, msgContent, config);
    if (resolution.approved) return true;

    const optionName =
      getActiveTwoTierOffer(config)?.[choice]?.name?.trim() ||
      "la opcion elegida";
    const paidLabel = formatConversationAmount(convo, resolution.paidTotalSoles, config);
    const missingLabel = formatConversationAmount(convo, resolution.missingSoles, config);
    await sendOrderBumpPartialPaymentChoiceMessage(
      convo,
      config,
      optionName,
      paidLabel,
      missingLabel
    );
    return true;
  }

  if (state === "awaiting_order_bump_choice") {
    if (shouldIgnoreChoicePresentationInterruption(convo, state)) {
      console.log(
        `[wf] convo ${convo.id}: ignoro entrada durante presentacion con eleccion`
      );
      return true;
    }
    // CONFIRMACIÓN DE PRECIO PENDIENTE: el cliente nombró una opción JUSTO tras
    // preguntar el precio, así que le respondimos "cuesta S/N, ¿lo quieres?" y
    // esperamos el sí. Recién con la confirmación enviamos los datos de pago.
    if (convo.ob_price_confirm_pending) {
      const pendingChoice =
        convo.order_bump_choice === "combo" || convo.order_bump_choice === "basico"
          ? (convo.order_bump_choice as "combo" | "basico")
          : null;
      // UN «SÍ» A SECAS CUENTA AQUÍ, y por eso van las dos con un O: el bot acaba de
      // preguntar «¿lo quieres?», así que «si» u «ok» son la respuesta a ESA pregunta.
      // Ver el porqué del reparto en `isPurchaseAffirmative`.
      if (
        pendingChoice &&
        (isPurchaseAffirmative(msgContent) || soloEstaDeAcuerdo(msgContent))
      ) {
        setOrderBumpPriceConfirmPending(convo.id, false);
        console.log(
          `[wf] convo ${convo.id}: confirmó compra tras el precio -> "${pendingChoice}"`
        );
        await deliverOrderBumpResponse(convo, pendingChoice);
        return true;
      }
      // No fue un sí claro (otra pregunta, cambió de opción, "no"...): limpiamos
      // la espera y procesamos el mensaje con la lógica normal de abajo.
      setOrderBumpPriceConfirmPending(convo.id, false);
    }
    // El último mensaje del bot viaja con la detección: es donde él numeró las
    // opciones, y sin eso «el 2» no se puede resolver contra nada.
    const obChoice = detectTwoTierPick(msgContent, config, {
      ultimaDelBot: ultimoMensajeDelBot(convo.id),
      // SU PRECIO Y SU ETAPA, para que un importe señale a la opción correcta.
      // Sin esto se decide por las cajas globales de la oferta, donde el precio
      // de la opción cara vale cero cuando vive en la ficha por país. Ver
      // `laOpcionPorElPrecioQueCobra`.
      phone: convo.phone,
      conOferta: isDiscountActiveForConversation(convo, config),
    });
    if (obChoice) {
      console.log(`[wf] convo ${convo.id} eligió order bump "${obChoice}"`);
      const recentReceiptImage = getRecentUserMessages(convo.id, 5).find(
        (message) =>
          (message.media_type === "image" || esComprobantePdf(message)) &&
          Math.floor(Date.now() / 1000) - message.created_at <= 180
      );
      if (recentReceiptImage) {
        setOrderBumpChoice(convo.id, obChoice);
        setConversationState(convo.id, "payment_done");
        console.log(
          `[wf] convo ${convo.id}: opcion "${obChoice}" recibida tras comprobante reciente; reanalizo imagen sin pedir nuevo ticket`
        );
        return false;
      }
      // ¿La elección viene JUSTO tras una pregunta de precio? Entonces el cliente
      // solo quería SABER el precio, aún no decidió comprar. Confirmamos precio +
      // intención ("cuesta S/N, ¿lo quieres?") antes de mandar el pago; así no es
      // incoherente. Si ya venía decidiendo (sin pregunta previa), va directo.
      //
      // SALVO QUE EL MENSAJE DE AHORA YA SEA LA DECISIÓN.
      //
      // Esta puerta miraba SOLO el mensaje anterior, y por eso repreguntaba lo
      // que el cliente acababa de decidir: preguntaba el precio, leía la
      // respuesta y escribía «me llevo el básico» — y el bot le contestaba
      // «cuesta S/N, ¿lo quieres?». Ya lo había dicho. Vuelve a preguntar quien
      // no estaba escuchando, y encima con el método de pago ya elegido de
      // antes: dos preguntas de más seguidas.
      //
      // La diferencia está en el mensaje de AHORA, no en el de antes. «el
      // básico» a secas sigue siendo desambiguar un precio y sigue confirmando;
      // «me llevo el básico» es una compra y va directo a los datos de pago, con
      // el método que ya eligió.
      //
      // SE PREGUNTA CON LA MISMA FUNCIÓN QUE LEE EL «SÍ» de la confirmación de
      // aquí arriba, a propósito: si un día «me lo llevo» dejara de contar como
      // un sí, tiene que dejar de contar en los dos sitios a la vez. Dos
      // respuestas distintas a la misma pregunta es como se separan con el
      // tiempo. Y `isPurchaseAffirmative` descarta las negaciones, así que un
      // «no, mejor no» no se cuela como decisión.
      //
      // NO HACE FALTA VOLVER A DESCARTAR PREGUNTAS AQUÍ: para llegar a esta
      // línea, `detectTwoTierPick` ya devolvió una opción, y esa función
      // devuelve `null` ante cualquier pregunta de precio o de contenido
      // (config.ts). Lo que entra aquí ya no es una pregunta.
      // Y AQUÍ TAMBIÉN LAS DOS, por el mismo motivo y en el mismo orden: si el cliente ya
      // dijo que sí —con una frase de compra o con un «sí» a secas— no hay que volver a
      // preguntárselo. Ver `isPurchaseAffirmative`.
      if (
        previousCustomerMessageWasPriceQuestion(convo.id, msgContent) &&
        !isPurchaseAffirmative(msgContent) &&
        !soloEstaDeAcuerdo(msgContent)
      ) {
        await askOrderBumpPurchaseConfirm(convo, obChoice, config);
        return true;
      }
      await deliverOrderBumpResponse(convo, obChoice);
      return true;
    }
    // SIN ELECCIÓN todavía, y el cliente YA sabe que hay 2 productos (estamos en
    // este estado porque el order bump fue presentado). Si menciona un método de
    // pago o pregunta el precio, NO soltamos un producto suelto (eso dejaba fuera
    // al combo): le recordamos que hay 2 y le pedimos elegir. TEXTO PLANO — sirve
    // igual en WhatsApp y Messenger, sin botones que no rendericen. No toca el
    // prompt del LLM. Al escribir su opción, la detección de arriba la caza y
    // muestra su precio. (Antes de presentar el order bump, otro estado maneja el
    // pago directo sin preguntar: ahí el cliente aún no sabe que existe el 2º.)
    const asksSpecificOptionPrice = isSpecificOrderBumpPriceQuestion(
      msgContent,
      config
    );
    if (
      (isPriceQuestion(msgContent) && !asksSpecificOptionPrice) ||
      detectPaymentRoute(msgContent, convo.phone)
    ) {
      await sendTwoOptionsReminder(convo, config);
      console.log(
        `[wf] convo ${convo.id}: método/precio sin elegir (ya conoce las 2) -> recuerdo las 2 opciones`
      );
      return true;
    }
    // Preguntas, comparaciones, palabras sueltas y elecciones naturales pasan
    // al modelo. La tool registra la opcion solo cuando el modelo ve decisión.
    return trySalesbotOrLlm(convo, msgContent, config);
  }

  // CAMBIAR DE OPCIÓN DESPUÉS DE HABER ELEGIDO, Y ANTES DE PAGAR.
  //
  // Caso real: eligió el combo, recibió los datos, y a continuación escribió
  // «mejor <el barato> no tengo mucho dinero». El modelo le contestó del básico
  // y el bot siguió con «combo» guardado; al volver a nombrar su método de pago,
  // le cobró el combo. La clienta leyó un precio en el texto y otro al pagar, y
  // no había forma de que nadie lo notara — los dos «tenían razón».
  //
  // DE DÓNDE VENÍA DE VERDAD. No era que el bot dejara de escuchar tras la
  // elección: la puerta que atiende esto existe desde el primer commit, más
  // abajo, dentro de `intro_done || payment_done`. Lo que falló fue el DETECTOR,
  // porque el nombre del barato estaba ENTERO dentro del nombre del caro y no le
  // quedaba ni una palabra suya. El arreglo está donde estaba la causa, en
  // `opcionNombradaPorLoCompartido` (config.ts), que usan las dos puertas.
  //
  // ESTA GUARDA ES LA MISMA DECISIÓN, TOMADA ANTES. Usa EL MISMO detector y las
  // MISMAS condiciones que la de abajo, a propósito: dos respuestas distintas a
  // la misma pregunta es como se separan con el tiempo. Si algún día sobra, se
  // quita ésta —no la de abajo, que además resuelve el pago parcial.
  //
  // POR INTENCIÓN, NO POR PALABRA. El detector descarta preguntas mirando las
  // palabras interrogativas y no los signos: casi nadie escribe «¿». «Cuánto
  // cuestan las tintas» sigue siendo una pregunta y la contesta el modelo;
  // «mejor las tintas» es una decisión. Y SOLO SI CAMBIA: repetir la que ya
  // tenía no vuelve a mandar nada.
  // Y LAS «MISMAS CONDICIONES» DE AHÍ ARRIBA SE HABÍAN SEPARADO.
  //
  // Esta puerta exigía `isOrderBumpActive()` a secas; la de abajo pregunta por
  // `isOrderBumpActive() || isDobleOfertaActive()`. O sea que en Doble Oferta
  // —y en Doble Oferta + Upsell— cambiar de opción tras haber elegido no
  // existía: «mejor el otro, no me alcanza» no cambiaba nada. Es exactamente la
  // venta que se perdía en Order Bump antes de arreglarlo.
  //
  // Lo cantó `recorrido-completo --todas` el 2026-09-14:
  //
  //     FALLA  y al decir «mejor el otro» cambia de verdad   combo → combo
  //
  // `isDobleOfertaActive` ya cubre las dos variantes y su propio comentario lo
  // dice: «vende EXACTAMENTE igual en esta parte… todo lo que gatea por aquí
  // vale para las dos sin cambiar una línea». Así que se igualan, que es lo que
  // el comentario de arriba pedía desde el principio.
  if (
    state === "payment_done" &&
    (isOrderBumpActive() || isDobleOfertaActive()) &&
    !isCommercialRouteB(convo) &&
    (convo.order_bump_choice === "combo" ||
      convo.order_bump_choice === "basico")
  ) {
    // TRES COSAS LA DEJAN PASAR DE LARGO, y las tres son de la puerta de abajo:
    //  · Con un comprobante encima no se cambia de producto por un mensaje
    //    suelto: el pago se lee primero, y contra el precio que corresponda.
    //  · Un método de pago NO es un producto. Los botones yape/plin/bcp no
    //    eligen opción, y tratarlos como tal se come el turno del pago.
    //  · Con algo ya abonado, el cambio lo resuelve la puerta de abajo, que sabe
    //    restar lo pagado y pedir la diferencia. Aquí se soltaría el importe
    //    entero como si no hubiera pagado nada.
    if (
      !latestIsImage &&
      convo.paid_total_cents === 0 &&
      detectPaymentRoute(msgContent, convo.phone) === null
    ) {
      const otra =
        inferTwoTierChoiceFromContext(
          msgContent,
          convo.order_bump_choice,
          config,
          // Con el producto extra en juego, «el otro» puede ser ÉL y no la otra
          // opción. Eso lo resuelve `queProductoNombra` preguntando cuál, y
          // funciona: aquí no se adivina.
          //
          // Con su teléfono, por lo mismo que la puerta de abajo: «el de 5000»
          // es su precio, no el de la caja global.
          //
          // Y con su ETAPA: el cliente repite el número que tiene DELANTE, y con
          // la oferta corriendo ése es el de oferta. Sin esto, «esta a 10» —el
          // precio de la cara con descuento— se leía como la barata a precio
          // normal y le cambiaba la elección. Pasó el 28/09/2026 en HOL3.
          {
            elExtraNoEstaEnJuego: !esperaPagoDelUpsell,
            phone: convo.phone,
            conOferta: isDiscountActiveForConversation(convo, config),
          }
        ) ??
        // Y SI EL QUE PROPUSO EL CAMBIO FUE EL BOT, el «sí» del cliente también
        // lo cambia. Ver `laPropuestaDelBotQueElClienteAfirmo`. Va DESPUÉS, como
        // respaldo: cuando el cliente nombra la opción él mismo, manda lo que
        // dijo el cliente. Si propone la que ya tiene elegida, el `!==` de
        // abajo lo deja pasar de largo y no se reenvía nada.
        laPropuestaDelBotQueElClienteAfirmo(convo, msgContent, config);
      if (otra && otra !== convo.order_bump_choice) {
        console.log(
          `[wf] convo ${convo.id} cambió de "${convo.order_bump_choice}" a "${otra}" antes de pagar`
        );
        // Va por el MISMO camino que la primera elección: su mensaje, su precio y
        // los datos de pago del método que YA eligió. No se le vuelve a preguntar
        // nada, porque no hay nada que preguntar.
        await deliverOrderBumpResponse(convo, otra);
        return true;
      }
    }
  }

  // PREGUNTA EL PRECIO TRAS UN SEGUIMIENTO, CON LA ELECCIÓN YA VENCIDA.
  //
  // LO QUE PASÓ — 25 de septiembre de 2026, su prueba en «como -OB-», y lo vio en
  // dos conversaciones a la vez con resultados distintos:
  //
  //   HOLAPER3 — todavía SIN elegir. Preguntó «precio» y el bot le recordó las
  //              dos opciones. Correcto, y es la puerta de `awaiting_order_bump_
  //              choice`.
  //   HOLAPER2 — YA había elegido, y venía de un seguimiento. Preguntó «precio»,
  //              no había puerta, contestó el modelo — y le dio los precios que
  //              tenía en la conversación, los de antes de la oferta.
  //
  // Su regla, con sus palabras: «cuando uno pregunta por el precio luego de la
  // intro 1 o la intro 2, debe hacerle un recordatorio al cliente que existen 2
  // opciones».
  //
  // ESTO NO ES UNA PUERTA NUEVA: ES LA MISMA CONDICIÓN, CONSULTADA DONDE FALTABA.
  // `ob_choice_stale` —la marca de «un seguimiento corrió DESPUÉS de que eligió»—
  // ya existía y ya disparaba este mismo recordatorio, pero solo cuando el cliente
  // NOMBRABA UN MÉTODO DE PAGO (ver la rama de más abajo). Preguntar el precio es
  // el mismo caso y el mismo riesgo: el seguimiento le enseñó el precio de la
  // oferta, y soltarle el de su elección vieja es enseñarle dos números distintos.
  //
  // Y ES EL MISMO TEXTO, EL SUYO: `sendTwoOptionsReminder` usa su plantilla del
  // editor —«Respuesta a "precio"»— con sus comodines. Aquí no se escribe ni una
  // palabra de cara al cliente.
  //
  // LOS CINCO FRENOS, cada uno por un caso que se rompería sin él:
  //
  //  · SI PREGUNTA POR UNA OPCIÓN CONCRETA —«cuánto cuesta el <nombre>»— no se
  //    entra: ahí está nombrando la que quiere, y recordarle las dos sería no
  //    contestarle. Se pregunta con la MISMA función que ya usa la puerta de la
  //    elección, para que las dos no puedan separarse.
  //  · SOLO CON LA ELECCIÓN VENCIDA. Sin seguimiento por medio su precio sigue
  //    siendo bueno y esto no pinta nada.
  //  · SIN NADA ABONADO. Con un pago encima, un precio es una cuenta de saldo y
  //    lo resuelve quien sabe restar.
  //  · UN MÉTODO DE PAGO NO ES UNA PREGUNTA DE PRECIO, y su rama ya lo atiende.
  //  · Y CON UNA IMAGEN NO SE ENTRA: el comprobante manda siempre.
  if (
    state === "payment_done" &&
    (isOrderBumpActive() || isDobleOfertaActive()) &&
    !isCommercialRouteB(convo) &&
    (convo.order_bump_choice === "combo" ||
      convo.order_bump_choice === "basico") &&
    convo.ob_choice_stale &&
    convo.paid_total_cents === 0 &&
    !latestIsImage &&
    isPriceQuestion(msgContent) &&
    !isSpecificOrderBumpPriceQuestion(msgContent, config) &&
    !messageHasPaymentConcern(msgContent) &&
    detectPaymentRoute(msgContent, convo.phone) === null
  ) {
    cancelPendingActionsByTypeForConvo(convo.id, ACTION_SEND_PAYMENT_STEP);
    await sendTwoOptionsReminder(convo, config);
    console.log(
      `[wf] convo ${convo.id} → preguntó el precio tras el seguimiento con elección vencida: recuerdo las 2 opciones (no entrego precio viejo)`
    );
    return true;
  }

  // UN «OK» SECO, CON LOS DATOS DE PAGO YA ENVIADOS, NO NECESITA AL MODELO.
  //
  // LO QUE PASABA. El bot manda la cuenta y el cierre («cuando lo hagas mándame
  // el comprobante»). El cliente contesta «ok». Eso se iba al modelo, que no
  // sabe en qué punto está la conversación, y volvía a soltar el bloque de
  // siempre con otras palabras: 590 tokens de salida donde lo normal eran 130, y
  // medio minuto de espera. El cliente lee dos veces lo mismo y suena a máquina.
  //
  // NO SE ARREGLA PIDIÉNDOLE AL MODELO QUE NO REPITA: se arregla no dándole el
  // turno. Si no hay llamada, no hay nada que repetir. Nunca.
  //
  // Y CALLAR ES LO CORRECTO AQUÍ, no un atajo: el bot ya dijo lo único que había
  // que decir —«mándame tu comprobante»— y está esperándolo. Un mensaje más no
  // aporta nada, y desde octubre de 2026 Meta cobra POR MENSAJE enviado.
  //
  // LOS CINCO FRENOS, cada uno por un caso que se rompería sin él:
  //
  //  · SOLO SI LOS DATOS YA SALIERON (`selected_payment_method`). Sin método
  //    anotado no se le ha dado ninguna cuenta y callarle sería dejarlo tirado.
  //  · SI EL BOT DEJÓ UNA PREGUNTA ABIERTA, el «ok» es SU respuesta. El caso que
  //    esto rompería: el bot ofrece «¿quieres ver una foto?», el cliente dice
  //    «ok» y la galería vive en el handler, DESPUÉS del motor — quedármelo aquí
  //    deja al cliente sin la foto que pidió.
  //  · UN ECO DE PAGO NO ES UN ACUSE. «ok ya pagué», «listo» — eso avisa de un
  //    pago y tiene que llegar a quien lo lee.
  //  · CON UNA IMAGEN NO SE ENTRA. El comprobante manda siempre (la regla de más
  //    arriba ya lo aparta antes de llegar hasta aquí; esto es el cinturón).
  //  · Y TIENE QUE SER EL MENSAJE ENTERO. «ok pero tengo una duda» no es un
  //    acuse: lleva una pregunta detrás y va al modelo como siempre.
  if (
    state === "payment_done" &&
    !!convo.selected_payment_method?.trim() &&
    !latestIsImage &&
    !looksLikePaymentEcho &&
    esUnAcuseSeco(msgContent)
  ) {
    const ultimaDelBot = [...getRecentHistory(convo.id, 6)]
      .reverse()
      .find((mensaje) => mensaje.role === "assistant");
    const elBotDejoUnaPreguntaAbierta =
      /[?¿]/.test(ultimaDelBot?.content ?? "") ||
      assistantOfferedVisualSample(convo.id);
    if (!elBotDejoUnaPreguntaAbierta) {
      // PERO SI LE DEBEMOS UNA NOTICIA, ÉSTA SÍ SALE.
      //
      // LO QUE PASÓ — 27/09/2026, su prueba HOLARG. Cambió a dos productos y el
      // cliente escribió «ok», «OK», «SI»: los tres se los comió esta guarda y
      // el bot parecía muerto. Al cuarto mensaje por fin despertó con la
      // novedad. El silencio es correcto —se espera su comprobante— pero
      // callarse una novedad que le cambia lo que puede comprar, no.
      //
      // Se cuenta y se sigue callando: no se contesta al «ok», solo se le pone
      // al día. Y una sola vez, como en todas partes.
      await contarLaNovedadSiTocaba(convo, config);
      console.log(
        `[wf] convo ${convo.id}: «${msgContent.trim()}» con los datos de pago ya enviados y sin pregunta abierta → no contesto, espero su comprobante`
      );
      return true;
    }
  }

  // UN «SÍ» CON LOS DATOS YA ENVIADOS: SE REENVÍAN. NO SE VUELVE A PREGUNTAR.
  //
  // LO QUE PASABA. El cliente elige Yape, elige el combo, recibe la cuenta. Hace
  // una pregunta, el bot se la contesta y remata con «¿te animas?». Dice «sí» —
  // y el modelo le pide EL MÉTODO DE PAGO que eligió veinte mensajes antes.
  // Otro «sí», otra pregunta. Al tercero por fin reenviaba los datos.
  //
  // SE INTENTÓ AVISARLE AL MODELO Y NO GANÓ. Se le puso en el prompt que los
  // datos ya habían salido y que no volviera a preguntar; siguió pidiendo el
  // método. Un aviso compite con las reglas de venta del cerebro y pierde: el
  // prompt sirve para CÓMO suena, no para QUÉ pasa. Lo que tiene que ocurrir
  // siempre va aquí, donde no depende de que nadie obedezca.
  //
  // LO QUE HACE: reenviar los datos del método que YA eligió, con el precio de
  // la opción que tiene elegida AHORA. Es la misma función que usa el marcador
  // del modelo (`resendPaymentDetails`), así que no hay un camino nuevo — solo
  // se llega antes y sin gastar una llamada.
  //
  // LOS SEIS FRENOS, cada uno por un caso que se rompería sin él:
  //
  //  · SOLO SI LOS DATOS SALIERON. Sin método anotado no hay nada que reenviar.
  //  · SIN PAGOS ENCIMA (`paid_total_cents === 0`). Con algo abonado, un «sí» es
  //    una respuesta sobre el saldo y lo resuelve la puerta que sabe restar.
  //  · NUNCA CON EL EXTRA EN JUEGO. Ahí un «sí» es de la oferta del extra y su
  //    rama ya lo atiende — y el reenvío cobraría otra cosa.
  //  · UN ECO DE PAGO NO ES UN SÍ. «sí, ya pagué» avisa de un pago y tiene que
  //    llegar a quien lo lee.
  //  · CON UNA IMAGEN NO SE ENTRA. El comprobante manda siempre.
  //  · SI EL BOT OFRECIÓ ENSEÑAR O CONTAR ALGO, el «sí» es de ESO. Mandarle la
  //    cuenta en vez de la foto que pidió sería el mismo fallo que ya evitamos
  //    en el acuse de aquí arriba.
  //  · Y UN «SÍ» CON COLA NO ES UN SÍ. Ver abajo.
  //
  // ── UN «SÍ» CON PREGUNTA DETRÁS NO ES UN SÍ ────────────────────────────
  //
  // LO QUE PASÓ — 2 de octubre de 2026, su conversación 446. El bot preguntó «¿necesitas
  // algo más o te animas con el material?» y el cliente contestó «si pero que contiene».
  // Se le reenviaron los datos de pago en vez de contestarle qué contiene.
  //
  // Y ÉL PARÓ EL PARCHE A TIEMPO: «entonces va a corregir esto y si responde otra pregunta
  // que diga "si pero dame el precio", ¿de nuevo va a joder la misma respuesta? no puedes
  // estar parchando así, hay que buscar la raíz».
  //
  // LA RAÍZ: aquí se preguntaba con `isPurchaseAffirmative`, que busca un «sí» EN
  // CUALQUIER PARTE del mensaje y no mira qué más dice. Con esa regla, «si pero que
  // contiene», «si pero dame el precio» y «listo y cuanto cuesta» son todos un sí.
  //
  // NO SE AÑADE NADA NUEVO. La función que distingue YA EXISTE y ya se usa unas líneas
  // más abajo: `soloEstaDeAcuerdo`, que exige que el mensaje sea acuerdo Y RELLENO, nada
  // más. Su propio comentario nombra este caso: «aquí es donde se cae "esta bien pero que
  // trae", "listo y cuanto cuesta"». Estaba escrita, probada, y no se usaba aquí.
  //
  // MEDIDO con trece frases suyas y de las que ya estaban escritas: acierta en las trece,
  // incluidas las tres que él nombró. Y sigue diciendo que SÍ a «si», «ok», «dale», «si
  // quiero» y «ya pues si», que es la mitad que no se puede perder.
  //
  // LAS OTRAS TRES PUERTAS QUE USAN `isPurchaseAffirmative` NO SE TOCAN: ahí un «sí»
  // dentro de un mensaje largo sí es lo correcto —son elecciones de opción, no reenvíos de
  // cuenta— y cambiarlas sería arreglar algo que no está roto.
  if (
    state === "payment_done" &&
    !!convo.selected_payment_method?.trim() &&
    convo.paid_total_cents === 0 &&
    !esperaPagoDelUpsell &&
    !latestIsImage &&
    !looksLikePaymentEcho &&
    soloEstaDeAcuerdo(msgContent) &&
    detectPaymentRoute(msgContent, convo.phone) === null
  ) {
    const ultimaDelBot =
      [...getRecentHistory(convo.id, 6)]
        .reverse()
        .find((mensaje) => mensaje.role === "assistant")?.content ?? "";
    // DOS FRENOS, Y CADA UNO TAPA UN FALLO QUE PASÓ DE VERDAD.
    //
    // 1) EL BOT TIENE QUE HABER PREGUNTADO ALGO.
    //
    // Confirmar una pregunta y acusar recibo de una respuesta NO son lo mismo.
    // Sin este freno pasó esto: el bot explicó que era un pago único, el cliente
    // contestó «ah ok esta bien» — y se le volvió a soltar la cuenta que ya
    // tenía delante. Estaba diciendo «entendido», no «lo quiero».
    //
    // Cuando el bot NO preguntó, ese mensaje lo atiende la guarda del acuse de
    // aquí arriba, que se calla. El bot ya dijo lo único que había que decir y
    // está esperando el comprobante.
    //
    // 2) Y SU ÚLTIMO MENSAJE NO PUEDE LLEVAR YA LA CUENTA.
    //
    // Es el freno del bucle: si acaba de darla, no hay nada que reenviar. Y de
    // paso tapa otro caso real — cuando el modelo escribe la cuenta a mano (que
    // tiene prohibido), ese mensaje SÍ lleva los datos, así que no se reenvía
    // encima. Se pregunta con la MISMA función que decide si el texto del
    // operador ya presentó el pago.
    if (
      /[?¿]/.test(ultimaDelBot) &&
      !unTextoLlevaLosDatosParaPagar(ultimaDelBot) &&
      !elBotOfrecioEnsenarAlgo(ultimaDelBot, convo.id)
    ) {
      const reenviado = await resendPaymentDetails(convo, { conFrase: true });
      if (reenviado) {
        console.log(
          `[wf] convo ${convo.id}: confirmó con los datos ya enviados → se los reenvío (${convo.selected_payment_method}), sin gastar una llamada`
        );
        return true;
      }
    }
  }

  // DOBLE OFERTA 2 PRODUCTOS: terminó la intro y se mostró la elección al final.
  // Si el cliente elige una opción (nombre o botón), enviamos directo los datos
  // de pago personalizados de ESA opción. Elección ambigua/pregunta → LLM.
  if (state === "awaiting_doble_oferta_dos_choice") {
    if (shouldIgnoreChoicePresentationInterruption(convo, state)) {
      console.log(
        `[wf] convo ${convo.id}: ignoro entrada durante presentacion con eleccion`
      );
      return true;
    }
    // ── UN TURNO CON COMPROBANTE NO SE INTERCEPTA JAMÁS, TAMPOCO ELIGIENDO ────
    //
    // ES LA MISMA REGLA QUE YA VIVE ARRIBA, palabra por palabra, en la puerta del reenvío
    // de datos (busca «UN TURNO CON COMPROBANTE NO SE INTERCEPTA JAMÁS»). Allí está escrita
    // desde hace semanas y dice exactamente lo que pasó aquí:
    //
    //     «El cliente manda la foto y escribe en la misma burbuja. Si esa frase caía en los
    //      detectores de abajo, este bloque se quedaba el turno, le reenviaba los datos de
    //      pago y el modelo NUNCA veía la imagen: nadie leía el monto y la venta no se
    //      registraba. Y no era un retraso, era una pérdida.»
    //
    // FALTABA EN ESTA PUERTA. Es el fallo de siempre de este proyecto: la misma regla en dos
    // sitios y arreglada en uno.
    //
    // LO QUE PASÓ — 2 de octubre de 2026, su prueba en «como -DOU-», convo 468. Mandó el
    // comprobante con un pie de foto que nombraba una opción. El pie se leyó como elección,
    // se le enviaron los datos de pago, y el turno terminó ahí: su comprobante no lo abrió
    // nadie. En su registro no hay ni una línea de pago para esa conversación — ni aprobado,
    // ni parcial, ni rechazado. Silencio. Con sus palabras: «el bot recibió la imagen, pero
    // no me aprobó la compra».
    //
    // POR QUÉ ES SEGURO, y es lo que más importa: esto SOLO entra cuando el turno trae una
    // foto. Un mensaje escrito —que es como se elige el 99% de las veces, y como él probó
    // todas sus semimodalidades— pasa de largo por aquí y se comporta exactamente igual que
    // antes. Para notar la diferencia hace falta una imagen adjunta.
    //
    // Y NO SE PIERDE LA ELECCIÓN DEL PIE DE FOTO: el lector de pagos relee los últimos
    // mensajes del cliente para saber qué eligió (ver `laEleccionFueExplicita` en
    // `payment.ts`), así que el nombre escrito debajo de la imagen sigue contando — pero
    // DESPUÉS de leer el monto, que es el orden correcto. Quien pagó de menos recibe su
    // «falta tanto» en vez de los datos de pago otra vez.
    // SE PREGUNTA POR LA FOTO DE ESTE MENSAJE, NO POR `latestIsImage`, Y A PROPÓSITO.
    //
    // `latestIsImage` también vale cuando la foto llegó en OTRO mensaje del mismo bloque sin
    // contestar (`pairedUserMedia`). Eso está bien donde se usa —el reenvío de datos— pero
    // aquí abriría la puerta en turnos de SOLO TEXTO, y en esta puerta el texto es el que
    // registra la elección: un cliente que acaba de mandar una foto y después escribe el
    // nombre de su opción se quedaría sin que nadie la anote.
    //
    // En una pasada del recorrido completo en lineal saltaron dos comprobaciones de datos de
    // pago con la señal ancha puesta, y no se volvieron a reproducir en cuatro pasadas más.
    // No se dejó la duda abierta: con la señal estrecha ese camino es IMPOSIBLE, porque un
    // mensaje escrito no entra aquí ni habiendo fotos alrededor.
    const estaFotoLlegaEnEsteMensaje =
      ultimoDelCliente?.media_type === "image" ||
      (!!ultimoDelCliente && esComprobantePdf(ultimoDelCliente));
    if (estaFotoLlegaEnEsteMensaje) {
      console.log(
        `[wf] convo ${convo.id}: llegó un comprobante mientras elegía → no me quedo el turno, que se lea el monto`
      );
      return trySalesbotOrLlm(convo, msgContent, config);
    }
    const choice = detectTwoTierPick(msgContent, config, {
      // Lo mismo que en la puerta de Order Bump: su precio y su etapa. Ver
      // `laOpcionPorElPrecioQueCobra`.
      phone: convo.phone,
      conOferta: isDiscountActiveForConversation(convo, config),
    });
    if (choice) {
      console.log(`[wf] convo ${convo.id} eligió doble oferta "${choice}"`);
      await deliverDobleOfertaPaymentDetails(convo, choice);
      return true;
    }
    if (isAmbiguousTwoTierChoice(msgContent, config)) {
      await sendTwoTierChoiceClarification(convo, config, true);
      return true;
    }
    // EL «SÍ» A LA OPCIÓN QUE EL BOT ACABA DE PROPONER.
    //
    // LO QUE PASÓ — 16 de septiembre de 2026, convo 127 del dueño:
    //
    //     él:   «cual me recomienda»
    //     bot:  «¡Te recomiendo el <opción mayor>! … ¿Te animas?»
    //     él:   «si»
    //     bot:  «¡Excelente decisión! … Realiza el pago de <precio correcto>»
    //
    // El bot lo entendió y hasta puso el precio bueno — pero la elección NO se
    // registró. Dos mensajes después escribió su método de pago, y sin opción
    // anotada el turno cayó por «pago sin elegir»: un importe que no era de
    // ninguna de las dos, y debajo el recordatorio con las dos.
    //
    // La decisión estaba entera, pero repartida: la propuso el BOT y la afirmó
    // el CLIENTE. Ninguna de las dos puertas mira las dos mitades a la vez — ni
    // el modelo (su instrucción le prohíbe registrar sin un producto nombrado)
    // ni el motor (solo lee las palabras del cliente).
    //
    // ES LA MISMA REGLA QUE YA USA EL PRODUCTO EXTRA, pieza por pieza: mira si
    // la pregunta sigue abierta y acepta un «sí» pelado con el MISMO detector
    // (`detectaSiSimpleAlUpsell`). Aquí lo que se añade es de quién era la
    // pregunta: `laOpcionQueElBotPropuso` devuelve vacío si el bot nombró las
    // DOS, así que «¿cuál prefieres?» + «sí» sigue sin elegir nada.
    //
    // Y EL SIGNO SÍ VALE AQUÍ, al revés que con el cliente: lo escribe el BOT,
    // que sí puntúa. Es el mismo freno que usa la guarda del acuse de recibo más
    // abajo — sin pregunta abierta, un «ok» es «entendido», no «lo quiero».
    // AQUÍ, Y SOLO AQUÍ, VALE TAMBIÉN UN ACUERDO SUELTO. Es la puerta de COMO -DOU-, la
    // única de las tres que no lo aceptaba. Ver el porqué en `laPropuestaDelBotQueElClienteAfirmo`.
    const laQuePropusoElBot = laPropuestaDelBotQueElClienteAfirmo(
      convo,
      msgContent,
      config,
      { tambienElAcuerdoSuelto: true }
    );
    if (laQuePropusoElBot) {
      console.log(
        `[wf] convo ${convo.id}: dijo que sí a "${laQuePropusoElBot}", que es lo que el bot acababa de proponer`
      );
      await deliverDobleOfertaPaymentDetails(convo, laQuePropusoElBot);
      return true;
    }
    if (
      await maybeSendDirectPaymentWithoutChoice(
        convo,
        msgContent,
        config,
        "doble oferta"
      )
    ) {
      return true;
    }
    // No es una elección CLARA (una pregunta tipo "¿cómo es eso de que son 2?",
    // una duda, o un typo raro): lo maneja el LLM, que RESPONDE como humano y
    // reconduce. Si el cliente eligió de una forma que la detección no cazó, el
    // LLM lo confirma con el marcador <<ELIGE_PRODUCTO_1/2>> y el sistema entrega
    // el pago (ver openrouter.ts + handler.ts). La detección determinística de
    // arriba ya cubrió las elecciones claras (botón, "el de 3", "el completo").
    return trySalesbotOrLlm(convo, msgContent, config);
  }

  // DOBLE OFERTA: terminó la intro y se mostraron las 3 opciones al final. Si
  // elige una (nombre o botón), le mandamos los datos de pago con el precio de
  // ESA opción. Nada se entrega aquí: todavía no ha pagado.
  if (state === "awaiting_bioferta_intro_choice") {
    if (shouldIgnoreChoicePresentationInterruption(convo, state)) {
      console.log(
        `[wf] convo ${convo.id}: ignoro entrada durante presentacion con eleccion`
      );
      return true;
    }
    const choice = detectBiofertaChoice(msgContent, config);
    if (choice) {
      console.log(
        `[wf] convo ${convo.id} eligió doble oferta "${choice}" tras la intro`
      );
      await deliverBiofertaPaymentDetails(convo, choice);
      return true;
    }
    // Dudas, preguntas o elecciones que la detección no cazó → las lleva el
    // LLM, que responde y reconduce a elegir una de las 3.
    return trySalesbotOrLlm(convo, msgContent, config);
  }

  // CASO BIOFERTA: el cliente pagó el precio UNITARIO pero aún no había
  // elegido cuál de los 2 productos quiere. Esperamos que escriba el NOMBRE.
  if (state === "awaiting_bioferta_choice") {
    if (shouldIgnoreChoicePresentationInterruption(convo, state)) {
      console.log(
        `[wf] convo ${convo.id}: ignoro entrada durante presentacion con eleccion`
      );
      return true;
    }
    const choice = detectBiofertaChoice(msgContent, config);
    if (choice === "a" || choice === "b") {
      console.log(
        `[wf] convo ${convo.id} eligió bioferta "${choice}" → entrego producto`
      );
      deliverBiofertaTier(convo.id, choice);
      return true;
    }
    // Sin nombre claro (o pidió el pack habiendo pagado solo el unitario) →
    // el LLM lo guía a escribir el nombre del producto.
    return trySalesbotOrLlm(convo, msgContent, config);
  }

  // CASO 4: intro terminado o ya en payment_done → detectar palabra clave
  // de pago. Permitimos que cambien de opinión (yape → bcp y viceversa).
  if (state === "intro_done" || state === "payment_done") {
    const reengagedAfterFollowup =
      state === "intro_done" &&
      convo.last_followup_index >= 0 &&
      !convo.order_bump_choice;
    // SWITCH offer_on_intro_first_message (default ENCENDIDO = comportamiento
    // actual). Si está APAGADO, tras la intro NO soltamos el order bump por
    // CUALQUIER mensaje; solo cuando el cliente pregunta el precio o muestra
    // intención de pagar (igual que tras el seguimiento 2). Ver bloque más abajo.
    const deferOrderBumpAfterIntro =
      config?.order_bump?.offer_on_intro_first_message === false;
    // ORDER BUMP — tras el INTRO, el PRIMER mensaje del cliente (sea cual sea:
    // "hola", "precio", "cuánto", o un método de pago) lanza la OFERTA del order
    // bump, para que SIEMPRE reciba la presentación de la bioferta y no se pierda
    // si no eligió un método. Excepción: un miedo a estafa lo dejamos al LLM para
    // que reasegure primero. SOLO en intro_done; payment_done sigue igual.
    if (
      state === "intro_done" &&
      isOrderBumpActive() &&
      !reengagedAfterFollowup &&
      !deferOrderBumpAfterIntro &&
      !messageHasPaymentConcern(msgContent)
    ) {
      const initialPaymentRoute = detectPaymentRoute(msgContent, convo.phone);
      if (initialPaymentRoute) {
        const selectedPaymentMethod = normalizeSelectedPaymentMethod(
          initialPaymentRoute,
          msgContent
        );
        setSelectedPaymentMethod(convo.id, selectedPaymentMethod);
        reportInitiateCheckout(convo, selectedPaymentMethod);
      }
      if (convo.order_bump_choice) setOrderBumpChoice(convo.id, null);
      cancelPendingActionsByTypeForConvo(convo.id, ACTION_SEND_PAYMENT_STEP);
      await presentOrderBumpAndWaitForChoice(convo);
      return true;
    }

    // RE-ENGANCHE TRAS SEGUIMIENTO: al cliente que volvió después de un
    // seguimiento NO se le suelta la oferta automáticamente (lo lleva el LLM con
    // naturalidad — comportamiento que ya funciona bien). PERO si ese cliente
    // PREGUNTA EL PRECIO y todavía NO vio la intro de order bump, se la soltamos
    // ahí. Es seguro contra duplicados: al estar en `intro_done` el cliente
    // por definición AÚN no la vio (verla mueve el estado a
    // awaiting_order_bump_choice), y al soltarla el estado cambia → no puede
    // repetirse. isPriceQuestion solo matchea PRECIO (no "qué contiene/incluye"),
    // así que NO interfiere con la sugerencia de imágenes de info. Cero tokens:
    // intercepta antes del LLM.
    if (
      reengagedAfterFollowup &&
      isOrderBumpActive() &&
      config?.order_bump?.offer_on_reengaged_price === true &&
      !messageHasPaymentConcern(msgContent) &&
      asksPriceStrict(msgContent)
    ) {
      cancelPendingActionsByTypeForConvo(convo.id, ACTION_SEND_PAYMENT_STEP);
      await presentOrderBumpAndWaitForChoice(convo);
      console.log(
        `[wf] convo ${convo.id} → order bump soltado a cliente re-enganchado que preguntó precio`
      );
      return true;
    }

    // Bioferta: si el cliente escribe el NOMBRE de un producto, recordamos su
    // elección para el ruteo de entrega tras el pago. No corta el flujo.
    const bfChoice = detectBiofertaChoice(msgContent, config);
    if (bfChoice) setBiofertaChoice(convo.id, bfChoice);

    // ORDER BUMP: si el cliente NOMBRA una opción (combo/básico) — la elige o
    // CAMBIA de idea (individual ↔ bioferta) — registramos/actualizamos su
    // elección y reenviamos los datos de ESA opción. NO se re-muestra la oferta.
    if (isOrderBumpActive() || isDobleOfertaActive()) {
      // Solo lo tratamos como elección/cambio de OPCIÓN si NO es también un
      // método de pago: los botones yape/plin/bcp del menú del intro NO son
      // productos — deben disparar la OFERTA del order bump, no contarse como
      // elección de opción (eso felicitaba y pedía método sin ofrecer la oferta).
      const obPick = inferTwoTierChoiceFromContext(
        msgContent,
        convo.order_bump_choice,
        config,
        // Misma razón que en la puerta de arriba: con el extra ofrecido, «el
        // otro» es ambiguo y lo resuelve quien sabe preguntarlo.
        //
        // Y CON SU TELÉFONO, para que «el de 5000» se compare contra el precio
        // que ÉL tiene delante —su país y su etapa de oferta— y no contra el de
        // otro sitio. Ver `inferTwoTierChoiceFromContext`: es la puerta donde se
        // perdió la venta de HOLAARG3.
        //
        // Y CON SU ETAPA, desde el 28/09/2026: el número que repite el cliente es
        // el que tiene DELANTE, y con la oferta corriendo ése es el de oferta.
        {
          elExtraNoEstaEnJuego: !esperaPagoDelUpsell,
          phone: convo.phone,
          conOferta: isDiscountActiveForConversation(convo, config),
        }
      );
      if (obPick && detectPaymentRoute(msgContent, convo.phone) === null) {
        console.log(
          `[wf] convo ${convo.id} order bump eligió/cambió a "${obPick}"`
        );
        cancelPendingActionsByTypeForConvo(convo.id, ACTION_SEND_PAYMENT_STEP);
        if (convo.paid_total_cents > 0) {
          const resolution = resolveAccumulatedOrderBumpChoice(
            convo.id,
            obPick
          );
          if (resolution?.approved) return true;
          if (resolution) {
            const optionName =
              getActiveTwoTierOffer(config)?.[obPick]?.name?.trim() ||
              "la opcion elegida";
            const paidLabel = formatConversationAmount(convo, resolution.paidTotalSoles, config);
            const missingLabel = formatConversationAmount(convo, resolution.missingSoles, config);
            await sendOrderBumpPartialPaymentChoiceMessage(
              convo,
              config,
              optionName,
              paidLabel,
              missingLabel
            );
            return true;
          }
        }
        // Doble Oferta 2 Prod: reenvía los datos de pago de la opción ELEGIDA
        // ahora (actualiza la elección guardada y el MONTO). Order bump: su
        // respuesta normal. Antes esto solo corría para order bump → al cambiar
        // de opción en doble oferta caía al LLM y reenviaba el monto viejo.
        if (isDobleOfertaActive()) {
          await deliverDobleOfertaPaymentDetails(convo, obPick);
        } else {
          await deliverOrderBumpResponse(convo, obPick);
        }
        return true;
      }
    }

    let route = detectPaymentRoute(msgContent, convo.phone);
    // PIDE LOS DATOS SIN HABER ELEGIDO METODO ("a que numero te pago").
    // No nombra ningun metodo, asi que detectPaymentRoute devuelve null y el
    // turno caia al modelo, que respondia preguntando otra vez ("te refieres a
    // Yape?") y dejaba a la clienta esperando los datos que nunca llegaban.
    //
    // Pedir los datos es querer pagar ya, asi que lo tomamos como una eleccion:
    // usamos el metodo PRINCIPAL del pais (el marcado en el panel; si no hay
    // ninguno marcado, el primero de la lista) y seguimos por el flujo normal
    // de eleccion. Eso hace que se comporte solo segun la modalidad:
    //   - lineal      -> recibe los datos de pago
    //   - order bump  -> se le abre la oferta intermedia, igual que si hubiera
    //                    elegido el metodo a mano. No se salta el upsell.
    //
    // Anunciar el pago ("voy a pagar") NO entra aqui a proposito: ahi no esta
    // pidiendo datos, y elegirle el metodo seria decidir por ella. Ese caso
    // sigue cayendo al modelo, que le pregunta cual prefiere.
    //
    // Y EN LINEAL, TAMPOCO HACE FALTA QUE LOS PIDA: BASTA CON QUE DIGA QUE SÍ.
    //
    // Lo de arriba cubre a quien PREGUNTA dónde pagar. Faltaba quien simplemente
    // acepta —«ok», «lo llevo», «ya pe»— después de que el bot cerrara
    // ofreciéndole indicarle cómo adquirirlo. Ese turno se iba al modelo, que le
    // preguntaba el método otra vez. Sus palabras, el 21/09: «en lineal es
    // pérdida de tiempo; es un solo producto, la elección de método no debería
    // ser una condición para soltar los datos».
    //
    // Solo en Lineal, y lo decide la pregunta que quedó abierta, no la palabra.
    // Ver `esUnaAfirmacionALaPreguntaDePagoDeLineal`.
    const afirmaLaCompraEnLineal =
      !route &&
      config != null &&
      esUnaAfirmacionALaPreguntaDePagoDeLineal(convo, config, msgContent);
    if (
      !route &&
      !convo.selected_payment_method &&
      (messageAsksWhereToPay(msgContent) || afirmaLaCompraEnLineal) &&
      !messageHasPaymentConcern(msgContent)
    ) {
      route = getDefaultPaymentMethodId(convo.phone);
      console.log(
        `[wf] convo ${convo.id} → ${
          afirmaLaCompraEnLineal
            ? "afirma la compra en lineal, no le pregunto el metodo"
            : "pide datos sin elegir metodo"
        }, uso el principal (${route})`
      );
    }
    // GUARDA "ya pagué": si el cliente mandó un comprobante reciente que aún NO
    // se contó, nombrar el método no es elegirlo — es avisar que ya pagó ("ya
    // está el yape", "aquí está el yape que me pidieron"). Re-enviarle los
    // datos consume el turno y descarta el comprobante, porque solo la IA con
    // vision puede leerlo. Devolvemos false para que el turno llegue a la IA.
    // Mismo criterio (5 mensajes / 180 s) y misma salida que ya usa la rama de
    // order bump mas arriba. Pasados los 180 s la IA ya no puede releer la
    // imagen, asi que ahi se mantiene el re-envio de datos de siempre.
    const pendingReceiptImage =
      route &&
      getRecentUserMessages(convo.id, 5).find(
        (message) =>
          (message.media_type === "image" || esComprobantePdf(message)) &&
          Math.floor(Date.now() / 1000) - message.created_at <= 180 &&
          !(convo.counted_receipts ?? "").includes(`img:${message.id}`)
      );
    if (pendingReceiptImage) {
      console.log(
        `[wf] convo ${convo.id}: menciona método con comprobante pendiente -> dejo que la IA lea la imagen`
      );
      return false;
    }
    // GUARDA "no soy un soldado sordo": si el cliente menciona un método de
    // pago PERO en contexto de desconfianza/queja/objeción (ej. "me robaron
    // con el yape, no confío en pagar primero"), NO disparamos la respuesta
    // automática. Dejamos que la IA escuche y responda con empatía.
    // Lo mismo si lo nombra para DESCARTARLO ("no tengo yape"): tampoco es una
    // elección, y mandarle esos datos es lo contrario de lo que está pidiendo.
    if (
      route &&
      !messageHasPaymentConcern(msgContent) &&
      !methodMentionIsNegated(msgContent, convo.phone)
    ) {
      const selectedPaymentMethod = normalizeSelectedPaymentMethod(
        route,
        msgContent
      );
      // Y EL MISMO FRENO PARA LOS DATOS DE PAGO, SEA EL MÉTODO QUE SEA.
      //
      // El bucle no es de un método concreto: es de CUALQUIER elección que se
      // vuelve a nombrar. Un cuadrito con la palabra la tiene; los métodos de
      // pago la tienen igual, y son los que el operador configure, en el país
      // que sea. Frenar solo el cuadrito habría dejado el bucle vivo para quien
      // no use cuadritos, que es la mayoría.
      //
      // Va DESPUÉS de la oferta de 2 opciones a propósito: ahí nombrar el
      // método no manda datos, abre la oferta, y esa sí tiene que abrirse.
      //
      // Y solo cuando ya se le mandaron los de ESE método. Cambiar de método
      // manda los del nuevo, como siempre. Pedirlos otra vez, también.
      if (
        convo.ultima_decision === claveDeMetodo(route) &&
        !pideQueLeRepitanLosDatos(msgContent)
      ) {
        // SE LOS REENVÍA EL MOTOR, ENMARCADOS. Y SIEMPRE IGUAL.
        //
        // Antes esto soltaba el turno al modelo, y el modelo decidía: en unas
        // modalidades resumía «ya te compartí los datos» y en otras los
        // reenviaba enteros, presentación incluida. Misma frase del cliente,
        // dos comportamientos, según la moneda que saliera. Aquí no se puede
        // depender del azar: si vuelve a nombrar su método, se los reenvía —
        // sin la presentación de primera vez, que es lo que sonaba a bucle.
        const reenviado = await resendPaymentDetails(convo, { conFrase: true });
        console.log(
          `[wf:decision] convo ${convo.id}: vuelve a nombrar "${route}" → ${
            reenviado ? "se los reenvío sin volver a presentar" : "no hay datos que reenviar, contesta el modelo"
          }`
        );
        return reenviado;
      }
      // ORDER BUMP: una selección de método hecha desde el menú INICIAL
      // (`intro_done`) abre la oferta intermedia. Una vez elegida una opción,
      // `deliverOrderBumpResponse` deja la conversación en `payment_done`; el
      // siguiente método de pago debe continuar hacia `payment_responses`, no
      // volver a ejecutar la respuesta de la opción (esa respuesta precisamente
      // vuelve a pedir el método y produciría un bucle).
      let orderBumpChoiceForPayment: "combo" | "basico" | undefined;
      let selectedPriceForPayment: number | undefined;
      let selectedPriceSource = "base";
      if (isOrderBumpActive() && !isCommercialRouteB(convo)) {
        const chosen = convo.order_bump_choice;
        if (state === "intro_done" && chosen) {
          console.log(
            `[wf] convo ${convo.id} → descarto order bump anterior "${chosen}" antes de la oferta inicial`
          );
          setOrderBumpChoice(convo.id, null);
        }
        const hasCurrentChoice = chosen === "combo" || chosen === "basico";
        if (state === "intro_done" || !hasCurrentChoice) {
          console.log(`[wf] convo ${convo.id} → order bump (interceptando pago)`);
          cancelPendingActionsByTypeForConvo(convo.id, ACTION_SEND_PAYMENT_STEP);
          setSelectedPaymentMethod(convo.id, selectedPaymentMethod);
          reportInitiateCheckout(convo, selectedPaymentMethod);
          await presentOrderBumpAndWaitForChoice(convo);
          return true;
        }
        // ELECCIÓN VENCIDA POR SEGUIMIENTO: disparó un seguimiento DESPUÉS de que
        // el cliente eligió (el seguimiento muestra el precio del básico/oferta).
        // Si ahora elige método de pago, NO soltamos el precio de su elección
        // previa (podría no coincidir con el de la oferta y generar duda): le
        // recordamos las 2 opciones en TEXTO PLANO (con comodines). Al re-elegir un
        // producto, deliverOrderBumpResponse limpia el flag y muestra su precio ACTUAL.
        if (state === "payment_done" && hasCurrentChoice && convo.ob_choice_stale) {
          cancelPendingActionsByTypeForConvo(convo.id, ACTION_SEND_PAYMENT_STEP);
          await sendTwoOptionsReminder(convo, config);
          console.log(
            `[wf] convo ${convo.id} → método tras seguimiento con elección vencida: recuerdo las 2 opciones (no entrego precio viejo)`
          );
          return true;
        }
        console.log(
          `[wf] convo ${convo.id} → order bump "${chosen}" confirmado, continúo con pago "${route}"`
        );
        orderBumpChoiceForPayment = chosen;
        selectedPriceForPayment =
          getOrderBumpPriceSoles(
            chosen,
            isDiscountActiveForConversation(convo, config),
            convo.phone
          ) ?? undefined;
        selectedPriceSource = `two_tier:${chosen}`;
      }
      if (!isOrderBumpActive() && isBiofertaActive()) {
        const chosenBioferta =
          bfChoice ??
          (convo.bioferta_choice === "a" ||
          convo.bioferta_choice === "b" ||
          convo.bioferta_choice === "pack"
            ? convo.bioferta_choice
            : null);
        if (chosenBioferta) {
          selectedPriceForPayment =
            getBiofertaPriceSoles(
              chosenBioferta,
              isDiscountActiveForConversation(convo, config),
              convo.phone
            ) ?? undefined;
          selectedPriceSource = `bioferta:${chosenBioferta}`;
          console.log(
            `[wf] convo ${convo.id} → doble oferta "${chosenBioferta}", continúo con pago "${route}"`
          );
        }
      }
      // NADIE PAGA UN PRECIO QUE NADIE ELIGIÓ.
      //
      // Si la modalidad vende DOS opciones y el cliente nombra un método sin
      // haber elegido producto, más abajo se le mandaban los datos con el
      // precio del BÁSICO —el que se usa cuando no hay elección—. El cliente
      // transfería ese monto creyendo que llevaba el otro, y su comprobante
      // entraba corto. No daba error: solo un número plausible y equivocado.
      //
      // ORDER BUMP NO PASA POR AQUÍ: su caso se atiende bastantes líneas más
      // arriba (suelta la oferta y sale). Esta guarda cubre las modalidades de
      // Doble Oferta, que no tenían nada equivalente. La ruta B queda fuera a
      // propósito: ahí el cierre es directo y no hay elección que pedir.
      const ofertaDeDosOpciones = !!getActiveTwoTierOffer(config);
      // Y «SIN ELEGIR» TIENE QUE MIRAR LA ELECCIÓN DE VERDAD.
      //
      // Miraba `orderBumpChoiceForPayment`, que se rellena SOLO dentro del
      // bloque de Order Bump de más arriba. En Doble Oferta —justo las
      // modalidades para las que se escribió esta guarda— se queda siempre
      // vacía, así que la guarda no guardaba nada:
      //
      //   el cliente elige el básico, recibe sus datos con su precio, y al
      //   volver a nombrar su método el bot entra por «pidió pagar sin elegir»
      //   y le manda el bloque SIN IMPORTE, con los dos productos otra vez y
      //   «¿cuál eliges?». La decisión que acababa de tomar, borrada — y sin
      //   memoria, así que se repite cada vez que nombre su método.
      //
      // La elección vive en la conversación, y ahí es donde hay que mirarla.
      const yaEligioSuProducto =
        convo.order_bump_choice === "combo" ||
        convo.order_bump_choice === "basico";
      if (
        ofertaDeDosOpciones &&
        !orderBumpChoiceForPayment &&
        !yaEligioSuProducto &&
        !isCommercialRouteB(convo)
      ) {
        cancelPendingActionsByTypeForConvo(convo.id, ACTION_SEND_PAYMENT_STEP);
        // Se recuerda el método que acaba de nombrar: cuando elija el producto,
        // los datos salen por AHÍ y no por el de por defecto. Sin esto habría
        // que volver a preguntárselo.
        setSelectedPaymentMethod(convo.id, selectedPaymentMethod);
        // Si está configurado el pago sin elección, se le mandan los datos SIN
        // precio y con la pregunta de qué producto quiere. Es lo que el
        // operador escribió para este momento exacto.
        if (
          await maybeSendDirectPaymentWithoutChoice(
            convo,
            msgContent,
            config,
            "doble oferta"
          )
        ) {
          return true;
        }
        // Y si no lo está, al menos se le pregunta cuál — nunca un precio a dedo.
        await sendTwoTierChoiceClarification(convo, config, true);
        console.log(
          `[wf] convo ${convo.id} eligió pago "${route}" sin producto elegido → pregunto cuál antes de dar un precio`
        );
        return true;
      }
      const canUseDirectPaymentForRoute =
        shouldUseDirectPayment(config, "with_choice", convo.phone) && (route === "yape" || route === "plin");
      const linealDirectPayment =
        canUseDirectPaymentForRoute &&
        !isOrderBumpActive() &&
        !isBiofertaActive() &&
        !isDobleOfertaActive();
      const chosenOptionDirectPayment =
        canUseDirectPaymentForRoute &&
        !!orderBumpChoiceForPayment &&
        !hasConfiguredPaymentResponseForOption(
          config,
          orderBumpChoiceForPayment,
          route,
          convo.phone
        );
      if (linealDirectPayment || chosenOptionDirectPayment) {
        // Si su cuadrito ya presentó el pago, el texto general no lo repite:
        // salen solo las burbujas con los datos y el cierre.
        const textoGeneral = getDirectPaymentSteps(config, "with_choice", convo.phone);
        const directSteps = suTextoYaPresentoElPago
          ? sinLaPresentacionDeSiempre(textoGeneral)
          : textoGeneral;
        const directPrice =
          selectedPriceForPayment ??
          getEffectivePriceSoles(
            isDiscountActiveForConversation(convo, config),
            convo.phone
          );
        const lockedDirectPrice =
          lockPaymentPrice(convo, directPrice, selectedPriceSource, config) ??
          directPrice;
        console.log(
          `[wf] convo ${convo.id} eligio pago "${route}", usando pago directo editable`
        );
        cancelPendingActionsByTypeForConvo(convo.id, ACTION_SEND_PAYMENT_STEP);
        setSelectedPaymentMethod(convo.id, selectedPaymentMethod);
        reportInitiateCheckout(convo, selectedPaymentMethod, lockedDirectPrice);
        await schedulePaymentResponses(convo, "yape", directSteps, {
          orderBumpChoice: orderBumpChoiceForPayment,
          priceSoles: lockedDirectPrice,
          directPayment: true,
          sinPresentacion: directSteps.length < textoGeneral.length,
        });
        setConversationState(convo.id, "payment_done");
        // Queda anotado que ESTE método ya está contestado. Volver a nombrarlo
        // no repite el bloque; cambiar de método sí manda el del nuevo.
        setUltimaDecision(convo.id, claveDeMetodo(route));
        return true;
      }
      // Y lo mismo por el camino clásico: las respuestas de pago del país
      // también empiezan presentando ("puedes adquirir el curso de la siguiente
      // manera 👇") antes de dar la cuenta.
      const respuestasDelMetodo = getPaymentResponses(
        config,
        route,
        orderBumpChoiceForPayment,
        convo.phone
      );
      const responses = suTextoYaPresentoElPago
        ? sinLaPresentacionDeSiempre(respuestasDelMetodo)
        : respuestasDelMetodo;
      console.log(
        `[wf] convo ${convo.id} eligió pago "${route}", programando ${responses.length} respuestas`
      );
      // Cancela acciones de un pago previo (yape antes de que terminen sus
      // 3 mensajes y ahora dicen "bcp"). Solo el tipo payment_step — los
      // follow-ups deben seguir vivos hasta que se apruebe la compra.
      cancelPendingActionsByTypeForConvo(convo.id, ACTION_SEND_PAYMENT_STEP);
      setSelectedPaymentMethod(convo.id, selectedPaymentMethod);
      const paymentPrice =
        selectedPriceForPayment ??
        getEffectivePriceSoles(
          isDiscountActiveForConversation(convo, config),
          convo.phone
        );
      const lockedPaymentPrice =
        lockPaymentPrice(convo, paymentPrice, selectedPriceSource, config) ??
        paymentPrice;
      reportInitiateCheckout(convo, selectedPaymentMethod, lockedPaymentPrice);
      await schedulePaymentResponses(convo, route, responses, {
        orderBumpChoice: orderBumpChoiceForPayment,
        priceSoles: lockedPaymentPrice,
        sinPresentacion: responses.length < respuestasDelMetodo.length,
      });
      setConversationState(convo.id, "payment_done");
      setUltimaDecision(convo.id, claveDeMetodo(route));
      return true;
    }
    // Sin keyword, o keyword con objecion/desconfianza -> Salesbot/LLM.
    return trySalesbotOrLlm(convo, msgContent, config);
  }

  return trySalesbotOrLlm(convo, msgContent, config);
}

/**
 * Resetea por completo una conversación: cancela acciones programadas,
 * borra todos los mensajes (incluyendo el /restart que llegó), limpia el
 * nombre capturado, y deja el estado en 'new' para que el próximo mensaje
 * del cliente vuelva a disparar el saludo + intro.
 *
 * Después responde con un texto de confirmación.
 */
async function resetConversation(convo: ConversationRow): Promise<void> {
  cancelPendingActionsForConvo(convo.id);
  // Cascade a NocoDB ANTES de limpiar el rowId local (sino perdemos
  // la referencia y la fila remota queda colgada).
  await deleteLeadForConversation(convo.id);
  // La confirmación se entrega antes de borrar el registro local. El cliente
  // ve que el comando funcionó, pero el panel queda exactamente como tras usar
  // el tachito: sin mensajes, acciones ni medios de esa conversación.
  try {
    await sendBotText(convo, "🔄 Memoria reseteada. Empezamos de cero.");
  } catch (err) {
    console.error("[wf] no se pudo enviar confirmación de /restart:", err);
  } finally {
    deleteConversation(convo.id);
    console.log(`[wf] /restart borró por completo la convo ${convo.id}`);
  }
  // Una conversación reiniciada debe volver a elegir sus productos. Si estas
  // selecciones quedan guardadas, el primer método de pago del flujo nuevo
  // reutiliza la opción anterior y omite la oferta del order bump.
  // Tras enviar la confirmación borramos también ese mensaje de BD para
  // que el contador quede en 0 y el siguiente mensaje del cliente se vea
  // como verdaderamente "el primero".
}

/**
 * Programa TODOS los seguimientos (1, 2, 3...) por adelantado, a minutos
 * fijos desde T0 (primer mensaje del cliente), usando el
 * `delay_minutes_from_first_message` de CADA secuencia. Se envian a TODOS
 * los clientes que escriben, respondan o no — la oferta debe llegar a todos.
 *
 * Si la hora calculada cae en quiet hours, se difiere a RESUME_AT (07:00)
 * y se le aplica el offset de cola anti-rafaga (burst) para escalonar a los
 * que quedaron pendientes. Si el cliente paga antes, el guard de estado en
 * el handler de ACTION_START_FOLLOWUP salta el envio.
 */
function scheduleFollowupSequences(
  convoId: number,
  /** Desde cuál empezar. Sirve para volver a contar el reloj sin reenviar los
   *  que el cliente YA recibió. Ver `renovarEsperaDeLosSeguimientos`. */
  desdeIndice = 0
): void {
  const config = loadWorkflowConfig();
  // Toggle global de seguimientos: si está en false, no se agenda ninguno.
  if (config?.followups_enabled === false) return;
  const convo = getConversationById(convoId);
  const runtimeChannel =
    convo?.channel === "test"
      ? convo.test_channel ?? "whatsapp"
      : convo?.channel;
  // La modalidad queda GUARDADA en la acción (payload.modality), así que el
  // seguimiento sale meses después con la modalidad que tenía la conversación
  // cuando se agendó, no con la que esté activa ese día.
  const modality = config ? getActiveModalityKey(config) : "lineal";
  const channelConfig = runtimeChannel
    ? config?.channels?.[runtimeChannel]
    : undefined;
  // La agenda toma los seguimientos del canal real de la conversación. No
  // depende de un contexto temporal que puede no existir en el simulador.
  const channelSequences =
    channelConfig?.use_content === true
      ? channelConfig.modality_templates?.[modality]?.followups
      : undefined;
  const sequences = config
    ? followupSequencesFor(config, runtimeChannel, modality)
    : [];
  if (!sequences || sequences.length === 0) return;
  const sched = config?.followup_schedule;
  const burstDelays =
    sched?.burst_delays_seconds && sched.burst_delays_seconds.length > 0
      ? sched.burst_delays_seconds
      : DEFAULT_BURST_DELAYS;
  const slots = sched?.slots_peru ?? DEFAULT_FOLLOWUP_SLOTS;
  const minGapHours = sched?.min_gap_hours_between ?? DEFAULT_MIN_GAP_HOURS;
  const quietHoursEnabled = sched?.quiet_hours_enabled !== false;
  const now = Math.floor(Date.now() / 1000);
  // Regla reversible para leads tardíos: no mueve conversaciones ya creadas;
  // solo aplaza el primer calendario generado al entrar un contacto nuevo.
  const deferLateLead =
    sched?.defer_late_leads_enabled === true &&
    typeof sched.defer_late_leads_after === "string" &&
    isAtOrAfterLocalTime(now, sched.defer_late_leads_after);
  const deferredStartAt = deferLateLead
    ? nextLocalTime(now, sched?.quiet_hours?.resume_at || "07:00")
    : null;
  const useLayerDelays = Array.isArray(channelSequences);
  // Guardia 24h (API oficial de WhatsApp): no se puede enviar texto libre
  // pasadas 24h del ultimo mensaje del cliente. Si un seguimiento caeria
  // fuera, se descarta (y los siguientes tambien).
  const limit24h = now + 24 * 3600;

  // runAt del seguimiento anterior — sirve para calcular el slot del
  // siguiente respetando min_gap_hours_between (regla anti-solapamiento).
  let lastRunAt = 0;

  for (let i = 0; i < sequences.length; i++) {
    // LOS QUE YA RECIBIÓ NO SE VUELVEN A AGENDAR.
    //
    // Al reiniciar el reloj se vuelve a pasar por aquí, y sin esto el cliente
    // recibiría otra vez un seguimiento que ya leyó. La primera vez esto vale
    // cero y no se salta ninguno, así que el arranque no cambia.
    if (i < desdeIndice) continue;
    const seq = sequences[i];
    if (seq.enabled === false) {
      console.log(
        `[wf] convo ${convoId}: ${seq.name} está apagado (enabled:false), no se programa`
      );
      continue;
    }
    let runAt: number | null = null;
    // Toggle por seguimiento: si ESTE lleva encendido "ignorar horario de
    // silencio", la regla no se le aplica. Los demas seguimientos no cambian.
    const quietParaEste = quietHoursEnabled && seq.ignore_quiet_hours !== true;

    if (i === 0 || useLayerDelays) {
      // SEGUIMIENTO 1: rapido — delay relativo desde el primer mensaje.
      // Si caeria en horario silencioso (madrugada/manana) se difiere al
      // mediodia. Luego se aplica el offset de cola anti-rafaga (burst).
      const delayMin = seq.delay_minutes_from_first_message;
      if (typeof delayMin !== "number" || delayMin <= 0) {
        if (useLayerDelays && i > 0) {
          console.warn(
            `[wf] ${seq.name ?? `seguimiento_${i + 1}`} sin delay de capa valido, uso slots generales`
          );
        } else {
          console.warn(
            `[wf] ${seq.name ?? "seguimiento_1"} sin delay_minutes_from_first_message valido, no se programa`
          );
          continue;
        }
      } else {
        // Para un lead tardío, el seguimiento 1 arranca exactamente a la hora
        // de reanudación. Las capas posteriores conservan sus propios delays.
        // Toggle por seguimiento: con "ignorar hora limite" encendido, ESTE
        // seguimiento se salta el aplazamiento por lead tardio y cuenta sus
        // minutos desde el mensaje. Los demas siguen aplazandose.
        const target =
          deferredStartAt === null || seq.ignore_late_lead_defer === true
            ? now + Math.floor(delayMin * 60)
            : i === 0
              ? deferredStartAt
              : deferredStartAt + Math.floor(delayMin * 60);
        const ignoreQuiet =
          sched?.followup_1_ignore_quiet_hours === true && i === 0;
        const base =
          quietParaEste && !ignoreQuiet && isQuietHour(target)
            ? adjustForQuietHours(target)
            : target;
        const position = countPendingActionsInWindow(
          ACTION_START_FOLLOWUP,
          base,
          base + 3600
        );
        runAt = base + cumulativeBurstOffset(position, burstDelays);
      }
    }

    if (runAt === null) {
      // SEGUIMIENTOS 2+: franja fija (slots_peru), al menos min_gap_hours
      // despues del anterior, nunca en horario silencioso.
      const slot = computeNextFollowupSlot({
        nowSec: lastRunAt > 0 ? lastRunAt : now,
        lastFollowupAtSec: lastRunAt > 0 ? lastRunAt : null,
        slotsHHMM: slots,
        minGapHours,
        quietHoursEnabled: quietParaEste,
      });
      if (slot === null) {
        console.warn(
          `[wf] convo ${convoId}: ${seq.name} sin slot disponible, no se programa`
        );
        break;
      }
      const position = countPendingActionsInWindow(
        ACTION_START_FOLLOWUP,
        slot,
        slot + 3600
      );
      runAt = slot + cumulativeBurstOffset(position, burstDelays);
      // Si la cola anti-rafaga empuja el envio dentro de quiet hours,
      // lo descartamos (no enviar fuera de horario).
      if (quietParaEste && isQuietHour(runAt)) {
        console.log(
          `[wf] convo ${convoId}: ${seq.name} desbordo la cola a quiet hours, descarto (y siguientes)`
        );
        break;
      }
    }

    // Guardia 24h: si cae fuera de la ventana, descartamos este y los
    // siguientes (no se puede mandar texto libre pasadas las 24h).
    if (runAt > limit24h) {
      console.log(
        `[wf] convo ${convoId}: ${seq.name} caeria fuera de las 24h, descarto (y siguientes)`
      );
      break;
    }

    const payload: StartFollowupPayload = {
      sequence_index: i,
      channel: runtimeChannel,
      modality,
    };
    scheduleAction(
      convoId,
      ACTION_START_FOLLOWUP,
      payload as unknown as Record<string, unknown>,
      runAt
    );
    lastRunAt = runAt;
    console.log(
      `[wf] convo ${convoId}: ${seq.name} programado a ${new Date(runAt * 1000).toISOString()}`
    );
  }
}

async function maybeSendDirectPaymentWithoutChoice(
  convo: ConversationRow,
  msgContent: string,
  config: WorkflowConfig | null,
  source: "order bump" | "doble oferta"
): Promise<boolean> {
  const route = detectPaymentRoute(msgContent, convo.phone);
  if (
    !config ||
    !route ||
    (route !== "yape" && route !== "plin") ||
    messageHasPaymentConcern(msgContent) ||
    !shouldUseDirectPayment(config, "without_choice", convo.phone)
  ) {
    return false;
  }
  /**
   * CON DOS OPCIONES, NADIE RECIBE DATOS DE PAGO SIN HABER ELEGIDO.
   *
   * ES SU REGLA, ESCRITA POR ÉL: «en -DOU- y en -OB-, no hay manera de que
   * reciba datos de pago sin elección». Esta función es justo la manera que sí
   * había — su nombre lo dice— y está desde el primer commit.
   *
   * LO QUE COSTÓ — 16 de septiembre de 2026, convo 127. Escribió su método de
   * pago sin que su elección se hubiera registrado, y recibió DOS burbujas con
   * precio seguidas: una con los datos de pago y un importe que no era ninguna
   * de sus dos opciones, y otra recordándole las dos con sus precios de verdad.
   *
   * De dónde salía ese importe: el paso no lleva precio —por eso el log dice
   * «sin precio»— así que el comodín `{precio}` cae al precio base del bot,
   * `course_price_soles`. Esa caja es UNA y la comparten todas las modalidades;
   * el reparto por fichas solo la refresca para el producto ÚNICO y para el
   * BÁSICO de Bioferta, así que en Doble Oferta y en Order Bump se queda con lo
   * último que escribió otro. En su contenido valía 10 —el precio de su opción
   * menor— y la burbuja parecía correcta; el 15 de septiembre pasó a 7 y cantó.
   *
   * Y EL MOTOR YA HACÍA LO CORRECTO UNA LÍNEA ANTES, en el mismo turno:
   *
   *     [wf] anoto su método sin interrumpir la elección;
   *          al elegir producto los datos saldrán por ahí     <- su regla
   *     [wf] pidio pago sin elegir doble oferta               <- y esto la pisa
   *
   * ASÍ QUE AQUÍ SE ACOTA, NO SE QUITA. En LINEAL esta función es correcta y no
   * se toca ni una línea: hay un producto y un precio, `course_price_soles` ES
   * el suyo, y nombrar el método es lo único que falta para cobrar.
   *
   * Con dos opciones y sin elección se hace lo que él pide: el método queda
   * anotado —ya lo hizo `anotarMetodoElegidoDuranteLaEleccion`— y se le
   * recuerdan las dos opciones. Es lo MISMO que ya hace Order Bump un estado
   * antes, con esta misma función; aquí se iguala.
   *
   * NO SE TOCA EL COMODÍN. Las catorce rutas que sí pasan precio siguen igual:
   * `{precio}` sigue saliendo del producto elegido en la intro, en los
   * seguimientos, en la oferta y en la entrega. Lo que se corta es el único
   * camino que llegaba hasta él sin tener ninguno que dar.
   *
   * Y ORDER BUMP TAMPOCO SE TOCA, aunque también tenga dos opciones. Ahí nombrar
   * el método es el gesto que DESTAPA el segundo producto, y lo que sale detrás
   * es su presentación —tres burbujas suyas—, no unos datos de pago sueltos. Se
   * comprobó corriendo la venta con el cambio y sin él: sin esta condición, -OB-
   * pasaba de 3 burbujas a 1 y perdía el destape. Su recorrido tiene su propio
   * camino y ya cumple la regla por otro lado: primero se revelan los dos, y
   * solo al elegir uno salen los datos.
   */
  if (
    isDobleOfertaActive() &&
    convo.order_bump_choice !== "combo" &&
    convo.order_bump_choice !== "basico"
  ) {
    cancelPendingActionsByTypeForConvo(convo.id, ACTION_SEND_PAYMENT_STEP);
    await sendTwoOptionsReminder(convo, config);
    console.log(
      `[wf] convo ${convo.id}: nombró su método sin haber elegido ${source} → método anotado y le recuerdo las 2 opciones; los datos salen cuando elija`
    );
    return true;
  }
  cancelPendingActionsByTypeForConvo(convo.id, ACTION_SEND_PAYMENT_STEP);
  setSelectedPaymentMethod(convo.id, route === "plin" ? "plin" : "yape");
  reportInitiateCheckout(convo, route === "plin" ? "plin" : "yape");
  await schedulePaymentResponses(
    convo,
    "yape",
    getDirectPaymentSteps(config, "without_choice"),
    {
      directPayment: true,
      directPaymentMode: "without_choice",
      renderTwoTierPrices: true,
    }
  );
  console.log(
    `[wf] convo ${convo.id} pidio pago sin elegir ${source} -> envio pago directo sin precio`
  );
  return true;
}

/**
 * ¿LA VENTA TODAVÍA NO HABÍA LLEGADO AL PAGO?
 *
 * Son las etapas de ANTES de dar los datos de la cuenta. Fuera de ellas no se
 * toca el estado, y eso es lo que impide que este arreglo salpique al resto:
 *
 *  · Una elección pendiente (`awaiting_order_bump_choice`, las dos de bioferta,
 *    la del pago del bump) manda ella: adelantar el estado ahí sería abandonar
 *    la oferta a medias, que es cambiarle el modo de vender.
 *  · Postventa (`payment_approved`, correo, regalo) NUNCA retrocede. Volver a
 *    "esperando comprobante" desde ahí rompe la entrega y el regalo.
 */
function laVentaTodaviaNoLlegoAlPago(
  state: WorkflowState | null | undefined
): boolean {
  // Sin etapa apuntada es una conversación recién nacida: todavía no llegó al
  // pago. Es el mismo criterio que usa el resto del motor (`convo.state ?? "new"`).
  if (!state) return true;
  return (
    state === "new" ||
    state === "intro_running" ||
    state === "intro_done"
  );
}

/**
 * LOS DATOS DE PAGO SALIERON → LA VENTA QUEDA ESPERANDO EL COMPROBANTE.
 *
 * EL FALLO QUE CIERRA, y por qué estaba tan escondido.
 *
 * Cuando un cuadrito o un botón mandan los datos de un método, el motor anotaba
 * el método y nada más. Los otros quince caminos de pago dejan además la
 * conversación en `payment_done`, y de ese apunte cuelga TODO lo de después:
 *
 *   · la regla de arriba que manda el comprobante derecho al lector solo se
 *     activa si la venta está esperando un pago;
 *   · las respuestas rápidas de la etapa anterior siguen activas y pueden
 *     quedarse el turno —y con él, el comprobante—;
 *   · el reenvío de datos y el precio contra el que se valida el monto.
 *
 * La venta SÍ se cerraba, pero por una puerta que no era: solo si el operador
 * había escrito el número de cuenta a mano en las burbujas de su cuadrito. O
 * sea, solo si tenía el número duplicado. El día que lo dejó en un solo sitio
 * —lo correcto— la venta dejó de cerrarse, sin un solo aviso.
 *
 * Cerrarla depende de que los datos HAYAN SALIDO, no de quién los escribió.
 */
function dejarLaVentaEsperandoElComprobante(
  convo: ConversationRow,
  metodo: string,
  config: WorkflowConfig | null
): void {
  // El método se anota SIEMPRE, venga de donde venga la conversación: de él
  // dependen el reenvío y el método contra el que se lee el comprobante.
  setSelectedPaymentMethod(convo.id, metodo);
  if (!laVentaTodaviaNoLlegoAlPago(convo.state)) return;
  reportInitiateCheckout(
    convo,
    metodo,
    getEffectivePriceSoles(
      isDiscountActiveForConversation(convo, config),
      convo.phone
    )
  );
  setConversationState(convo.id, "payment_done");
  // Y la copia que lleva este turno en la mano se entera también. Un turno puede
  // pasar por aquí dos veces —el cuadrito cierra la venta y su acción manda los
  // datos—, y con la copia vieja la segunda vuelta creería que la venta sigue
  // abierta: avisaría a Meta del inicio de compra por duplicado.
  convo.state = "payment_done";
}

function reportInitiateCheckout(
  convo: ConversationRow,
  paymentMethod: string | null,
  value?: number
): void {
  const country = getCountryInfo(getEffectiveCountryCode(convo.phone));
  void sendInitiateCheckoutEvent({
    conversationId: convo.id,
    userData: buildMessagingUserData({
      channel: convo.channel,
      phone: convo.phone,
      firstName: convo.client_name ?? convo.name,
      email: convo.client_email,
      ctwa_clid: convo.ctwa_clid,
    }),
    value,
    currency: country.currency,
    paymentMethod,
  });
}

function lockPaymentPrice(
  convo: ConversationRow,
  priceSoles: number | null | undefined,
  source: string,
  config: WorkflowConfig | null = loadWorkflowConfig()
): number | undefined {
  if (typeof priceSoles !== "number" || !Number.isFinite(priceSoles) || priceSoles <= 0)
    return undefined;
  const discountActive = isDiscountActiveForConversation(convo, config);
  const effectiveSource = `${source}:${discountActive ? "discount" : "regular"}`;
  const existingLockedPrice = getLockedPriceSoles(convo);
  if (existingLockedPrice !== null && convo.locked_price_source === effectiveSource) {
    const applicablePrice = convo.frozen_prices
      ? Math.min(existingLockedPrice, priceSoles)
      : existingLockedPrice;
    if (applicablePrice < existingLockedPrice) {
      const currency = getCountryInfo(getEffectiveCountryCode(convo.phone)).currency;
      setLockedPrice(convo.id, applicablePrice, currency, effectiveSource, discountActive);
    }
    return applicablePrice;
  }
  const currency = getCountryInfo(getEffectiveCountryCode(convo.phone)).currency;
  setLockedPrice(
    convo.id,
    priceSoles,
    currency,
    effectiveSource,
    discountActive
  );
  return priceSoles;
}

function getMatchingLockedPrice(
  convo: ConversationRow,
  source: string,
  config: WorkflowConfig | null = loadWorkflowConfig()
): number | null {
  const discountActive = isDiscountActiveForConversation(convo, config);
  const effectiveSource = `${source}:${discountActive ? "discount" : "regular"}`;
  const lockedPrice = getLockedPriceSoles(convo);
  if (lockedPrice === null || convo.locked_price_source !== effectiveSource) {
    return null;
  }
  if (!convo.frozen_prices) return lockedPrice;
  const currentPrice = source.startsWith("two_tier:")
    ? getOrderBumpPriceSoles(
        source.endsWith("combo") ? "combo" : "basico",
        discountActive,
        convo.phone
      )
    : getEffectivePriceSoles(discountActive, convo.phone);
  return typeof currentPrice === "number" && currentPrice > 0
    ? Math.min(lockedPrice, currentPrice)
    : lockedPrice;
}

function getLockedOrCurrentBasePrice(
  convo: ConversationRow,
  config: WorkflowConfig | null = loadWorkflowConfig()
): number {
  const locked = getMatchingLockedPrice(convo, "base", config);
  const effective = getEffectivePriceSoles(
    isDiscountActiveForConversation(convo, config),
    convo.phone
  );
  // DIAG TEMPORAL: distingue precio CONGELADO (locked, de un test viejo) del
  // precio efectivo por país. Si locked!=null y difiere del efectivo, el número
  // "equivocado" es un lock viejo, no un bug de resolución por país.
  // Apagado salvo que se pida (DIAG_PAIS=1), por lo mismo que el de país: se
  // imprime en cada resolución de precio y ahoga el log de una prueba.
  if (
    process.env.DIAG_PAIS === "1" &&
    (convo.channel === "messenger" ||
      convo.channel === "instagram" ||
      convo.channel === "test")
  ) {
    console.log(
      `[DIAG-PRECIO] convo=${convo.id} country=${getEffectiveCountryCode(
        convo.phone,
        config
      )} locked=${locked ?? "null"} effective=${effective} -> ${locked ?? effective}`
    );
  }
  return locked ?? effective;
}

function formatConversationAmount(
  convo: ConversationRow,
  amount: number,
  config: WorkflowConfig | null = loadWorkflowConfig()
): string {
  const countryCode = getEffectiveCountryCode(convo.phone, config);
  return formatCurrencyAmount(
    amount,
    countryCode,
    convo.locked_price_currency ?? getCountryInfo(countryCode).currency
  );
}

/**
 * Estados en los que NO tiene sentido programar nuevos seguimientos
 * (el cliente ya compro, el flujo esta en proceso, o aun no llegamos al
 * primer seguimiento). El resto —intro_done, payment_done— son candidatos
 * validos.
 */
const INACTIVE_FOLLOWUP_STATES = new Set<string>([
  "new",
  "intro_running",
  "payment_approved",
  "awaiting_email",
  "awaiting_gift_consent",
  "awaiting_facebook_comment",
]);

/**
 * One-shot: agenda el siguiente seguimiento para convos huerfanas — es
 * decir, las que ya dispararon seg N pero por algun motivo (bug viejo o
 * client que no respondio antes de que quitaramos el engagement check)
 * no tienen seg N+1 agendado. Idempotente: si ya tienen uno futuro
 * pendiente, no hace nada. Pensado para llamarse desde un endpoint
 * manual una sola vez tras el deploy del fix.
 */
export function backfillNextFollowups(): {
  total_candidates: number;
  scheduled: number;
  skipped_inactive: number;
  skipped_already_pending: number;
} {
  const config = loadWorkflowConfig();
  const total = config?.followup_sequences?.length ?? 0;
  if (total <= 1) {
    return {
      total_candidates: 0,
      scheduled: 0,
      skipped_inactive: 0,
      skipped_already_pending: 0,
    };
  }
  // Candidatas: last_followup_index entre 0 y total-2 (al menos seg 1 ya
  // disparo, aun hay siguiente seg que encadenar).
  const candidates = getConversationsForFollowupBackfill(total - 1);
  let scheduled = 0;
  let skippedInactive = 0;
  let skippedAlreadyPending = 0;
  const nowSec = Math.floor(Date.now() / 1000);
  for (const convo of candidates) {
    if (convo.state && INACTIVE_FOLLOWUP_STATES.has(convo.state)) {
      skippedInactive++;
      continue;
    }
    if (
      hasFuturePendingActionType(convo.id, ACTION_START_FOLLOWUP, nowSec)
    ) {
      skippedAlreadyPending++;
      continue;
    }
    scheduleNextFollowup(convo.id, convo.last_followup_index);
    // Si scheduleNextFollowup logro programar, ahora SI hay uno futuro.
    if (
      hasFuturePendingActionType(convo.id, ACTION_START_FOLLOWUP, nowSec)
    ) {
      scheduled++;
    }
  }
  console.log(
    `[wf:backfill] candidatos=${candidates.length} scheduled=${scheduled} inactive=${skippedInactive} pending=${skippedAlreadyPending}`
  );
  return {
    total_candidates: candidates.length,
    scheduled,
    skipped_inactive: skippedInactive,
    skipped_already_pending: skippedAlreadyPending,
  };
}

/**
 * Hook que se llama en cada mensaje entrante: si el cliente ya recibio
 * el seguimiento N (N≥1) y aun no esta agendado el siguiente, lo programa
 * via scheduleNextFollowup. No hace nada si la convo no es candidata.
 */
function maybeScheduleNextFollowupOnUserMessage(
  convo: ConversationRow
): void {
  // MODELO NUEVO: todos los seguimientos se programan por adelantado a
  // minutos fijos desde el primer mensaje (ver scheduleFollowupSequences),
  // y se envian respondan o no. Por eso ya NO encadenamos cuando el cliente
  // responde — seria duplicar. Se deja la firma para no tocar el caller.
  void convo;
}

/**
 * Agenda el siguiente seguimiento (sequence_index = currentIndex + 1)
 * eligiendo el proximo slot horario de followup_schedule.slots_peru que:
 *   - sea >= ahora
 *   - este al menos min_gap_hours_between despues del ultimo seguimiento
 *   - no caiga en quiet hours
 *
 * Dentro del slot calculado, asigna posicion en cola anti-rafaga segun
 * cuantas convos ya tienen un start_followup pendiente en ese mismo slot.
 *
 * Si la posicion en cola empuja el run_at dentro de quiet hours (la cola
 * se desbordo), DESCARTA el envio — no se programa para evitar mensajes
 * a horas inapropiadas. El cliente queda fuera del seguimiento siguiente
 * (la spec del usuario: "dejarán de enviarse para evitar bloqueos").
 *
 * Idempotente: si ya hay un start_followup pendiente para esta convo,
 * no hace nada.
 */
function scheduleNextFollowup(
  convoId: number,
  currentIndex: number
): void {
  const config = loadWorkflowConfig();
  if (!config) return;
  const convo = getConversationById(convoId);
  if (!convo) return;
  const sequences = config.followup_sequences ?? [];
  const nextIndex = currentIndex + 1;
  if (nextIndex >= sequences.length) return; // ya estamos en el ultimo
  const nextSeq = sequences[nextIndex];
  if (!nextSeq) return;
  if (
    !chooseFollowupVariant(
      nextSeq,
      config,
      convo.ad_source_id,
      getEffectiveCountryCode(convo.phone, config),
      convo.camino
    )
  ) {
    console.log(
      `[wf:slot] convo ${convoId}: seguimiento ${nextIndex + 1} no tiene variantes listas, no se agenda`
    );
    return;
  }
  // Idempotencia: no duplicar si ya hay uno pendiente EN EL FUTURO. Usamos
  // hasFuturePendingActionType (filtra por run_at > now) en vez de
  // hasPendingActionType, porque esta funcion se llama desde dentro del
  // handler de start_followup, cuando la accion en curso todavia esta en
  // status='pending'. Con la version antigua, encadenar el siguiente
  // seguimiento abortaba porque "se a si mismo" como pendiente.
  const nowCheck = Math.floor(Date.now() / 1000);
  if (hasFuturePendingActionType(convoId, ACTION_START_FOLLOWUP, nowCheck)) {
    return;
  }

  const sched = config?.followup_schedule;
  const slots = sched?.slots_peru ?? DEFAULT_FOLLOWUP_SLOTS;
  const minGapHours = sched?.min_gap_hours_between ?? DEFAULT_MIN_GAP_HOURS;
  // Toggle por seguimiento: se respeta el "ignorar horario de silencio" del
  // seguimiento que se va a encadenar, no una regla global.
  const quietHoursEnabled =
    sched?.quiet_hours_enabled !== false && nextSeq.ignore_quiet_hours !== true;
  const burstDelays =
    sched?.burst_delays_seconds && sched.burst_delays_seconds.length > 0
      ? sched.burst_delays_seconds
      : DEFAULT_BURST_DELAYS;

  const nowSec = Math.floor(Date.now() / 1000);
  const lastAt =
    convo.last_followup_started_at && convo.last_followup_started_at > 0
      ? convo.last_followup_started_at
      : null;

  const slotBase = computeNextFollowupSlot({
    nowSec,
    lastFollowupAtSec: lastAt,
    slotsHHMM: slots,
    minGapHours,
    quietHoursEnabled,
  });
  if (slotBase === null) {
    console.warn(
      `[wf:slot] convo ${convoId}: no se encontro slot futuro para seguimiento ${nextIndex + 1}`
    );
    return;
  }

  // Posicion en la cola: cuantos start_followup ya pending caen en la
  // ventana [slotBase, slotBase + 1h). 1h cubre todas las posiciones
  // razonables (con delays [15,21,27,32] una cola de 100 personas seria
  // ~40 min). El nuevo cliente se ubica en la posicion `count` (0-based).
  // Si el offset desborda quiet hours, recalculamos slot al siguiente dia
  // habil (12:00) y reintentamos posicionar en esa nueva cola. Iteramos
  // por seguridad — en practica con 1 iteracion alcanza.
  let activeSlot = slotBase;
  let runAt = activeSlot;
  let position = 0;
  let offsetSec = 0;
  for (let attempt = 0; attempt < 5; attempt++) {
    position = countPendingActionsInWindow(
      ACTION_START_FOLLOWUP,
      activeSlot,
      activeSlot + 3600
    );
    offsetSec = cumulativeBurstOffset(position, burstDelays);
    runAt = activeSlot + offsetSec;
    if (!quietHoursEnabled || !isQuietHour(runAt)) break;
    // La cola se desbordo en quiet hours: diferimos al proximo slot del
    // dia siguiente al mediodia (12:00 Peru, RESUME_AT). Reusamos
    // computeNextFollowupSlot pasando como "nowSec" el instante en que
    // arranca quiet (asi forza el primer slot post-12:00 manana).
    const deferFrom = runAt; // ya esta en quiet
    const nextSlot = computeNextFollowupSlot({
      nowSec: deferFrom,
      lastFollowupAtSec: lastAt,
      slotsHHMM: slots,
      minGapHours,
      quietHoursEnabled,
    });
    if (nextSlot === null || nextSlot === activeSlot) {
      // Fail-safe: no se encontro slot nuevo, salimos del loop dejando
      // runAt en quiet → cae el chequeo de abajo y descarta.
      break;
    }
    console.log(
      `[wf:slot] convo ${convoId}: cola del slot ${new Date(activeSlot * 1000).toISOString()} desbordo en quiet, diferiendo a ${new Date(nextSlot * 1000).toISOString()}`
    );
    activeSlot = nextSlot;
  }

  // Defensa final: si tras los intentos el runAt sigue cayendo en quiet
  // (caso raro: slots mal configurados), descartamos para no enviar
  // fuera de horario.
  if (quietHoursEnabled && isQuietHour(runAt)) {
    console.warn(
      `[wf:slot] convo ${convoId}: no pude ubicar seguimiento ${nextIndex + 1} fuera de quiet hours tras varios intentos, DESCARTO`
    );
    return;
  }

  const payload: StartFollowupPayload = { sequence_index: nextIndex };
  scheduleAction(
    convoId,
    ACTION_START_FOLLOWUP,
    payload as unknown as Record<string, unknown>,
    runAt
  );
  console.log(
    `[wf:slot] convo ${convoId}: seguimiento ${nextIndex + 1} agendado a ${new Date(runAt * 1000).toISOString()} (slot ${new Date(activeSlot * 1000).toISOString()}, pos ${position} en cola, +${offsetSec}s)`
  );
}

type IntroChoice = {
  steps: NonNullable<ReturnType<typeof loadWorkflowConfig>>["intro_sequence"];
  variant: number;
  weight: number;
  /** Con el respaldo entre países APAGADO, su país no tiene intro: no se le manda ninguna
   *  (16/10/2026). Quien arranca la conversación lo pasa a humano. */
  faltaLaDeSuPais?: boolean;
  /** …y lo que falta es la de SU TIENDA, con el respaldo entre tiendas apagado (17/10/2026). */
  faltaPorTienda?: boolean;
};

function chooseIntroSequence(
  config: NonNullable<ReturnType<typeof loadWorkflowConfig>>,
  convo: ConversationRow | undefined,
  preferredVariant?: number | null
): IntroChoice {
  // Reparto al azar entre las intros activas y completas. Si ya se eligió una
  // para esta conversación, se reutiliza para no alterar el recorrido del lead.
  const allIntros = [
    config.intro_sequence,
    config.intro_sequence_2,
    config.intro_sequence_3,
    ...(Array.isArray(config.intro_extra_sequences)
      ? config.intro_extra_sequences
      : []),
  ];
  const enabled = Array.isArray(config.intro_enabled)
    ? config.intro_enabled
    : [true, false, false];
  const pool: IntroChoice[] = [];
  for (let v = 0; v < allIntros.length; v++) {
    const s = allIntros[v];
    if (
      enabled[v] === true &&
      Array.isArray(s) &&
      s.length > 0 &&
      !sectionHasPlaceholder(s)
    ) {
      const configuredWeight = Array.isArray(config.intro_weights)
        ? config.intro_weights[v]
        : undefined;
      const weight =
        typeof configuredWeight === "number" &&
        Number.isFinite(configuredWeight) &&
        configuredWeight > 0
          ? configuredWeight
          : 1;
      pool.push({ steps: s, variant: v + 1, weight });
    }
  }
  const previouslyChosen = pool.find(
    (item) => item.variant === preferredVariant
  );
  if (previouslyChosen) return previouslyChosen;

  // LA TIENDA, ANTES QUE NINGUNA OTRA ETIQUETA.
  //
  // Es la que más manda: decide por QUÉ NÚMERO se está vendiendo, y dentro de eso
  // deciden la forma, el país y el anuncio.
  //
  // Y ES LA ÚNICA QUE PUEDE DEJAR EL POOL VACÍO, a propósito. Las otras tres
  // llevan la guarda `suyas.length > 0` para no dejar a nadie sin intro; ésta no
  // la lleva porque vaciarlo aquí NO deja a nadie sin intro: unas líneas más
  // abajo, un pool vacío cae en `config.intro_sequence`, la intro de siempre.
  //
  // Esa diferencia es el motivo entero de la etiqueta: una intro escrita para la
  // tienda B nombra otros productos y otros precios, así que al cliente de la A
  // le sirve más la intro general que la de una tienda que no es la suya.
  // Ver `soloDeSuTienda`.
  //
  // SIN RESPALDO ENTRE TIENDAS (17/10/2026): si ninguna intro es de esta tienda, no se le
  // manda ninguna —ni la «de todas» ni la de siempre—: a humano, igual que sin la de su país.
  if (
    !usaRespaldoEntreTiendas(config) &&
    aLaTiendaLeFaltaLoSuyo(
      pool,
      (item) => tiendasDe({ tiendas: config.intro_tiendas?.[item.variant - 1] }),
      laTiendaQueAtiende()
    )
  ) {
    return { steps: [], variant: 1, weight: 1, faltaLaDeSuPais: true, faltaPorTienda: true };
  }
  {
    const suyas = soloDeSuTienda(
      pool,
      (item) => tiendasDe({ tiendas: config.intro_tiendas?.[item.variant - 1] }),
      laTiendaQueAtiende()
    );
    if (suyas.length !== pool.length) {
      pool.length = 0;
      pool.push(...suyas);
    }
  }

  // LA SEMIMODALIDAD, DESPUÉS. Es la más general de las tres etiquetas que quedan:
  // primero se decide con QUÉ FORMA se está vendiendo —«como hoy», COMO DOU o
  // COMO OB— y dentro de eso deciden la bandera y el anuncio.
  //
  // Lo pidió el dueño el 30/09/2026: «así las otras estén encendidas, pero la
  // modalidad no corresponde, no debería salir».
  //
  // VA DESPUÉS de reutilizar la intro ya elegida, igual que la bandera: cambiarle
  // la intro a mitad de conversación sería peor que cualquier segmentación.
  //
  // Y CON LA MISMA RED: si ninguna etiquetada corresponde juegan las que no
  // llevan etiqueta, y si tampoco hay, juegan todas. Sin etiquetas puestas esto
  // devuelve el pool entero y no cambia nada.
  {
    const activa = semimodalidadActiva(config);
    const suyas = porSemimodalidad(
      pool,
      (item) =>
        semimodalidadDe({
          semimodalidad: config.intro_semimodalidades?.[item.variant - 1],
        }),
      activa
    );
    if (suyas.length > 0 && suyas.length !== pool.length) {
      pool.length = 0;
      pool.push(...suyas);
    }
  }

  // LA BANDERA, DESPUÉS. Es una etiqueta más, como la del anuncio: si hay
  // alguna intro con la bandera del cliente, juegan SOLO ésas; si no hay
  // ninguna, juegan las que no llevan bandera.
  //
  // VA DESPUÉS de reutilizar la intro ya elegida a propósito: cambiarle la intro
  // a mitad de conversación sería peor que cualquier segmentación.
  //
  // Y SIN BANDERAS PUESTAS EL POOL NO SE TOCA: se filtra sobre una lista donde
  // todas son generales, así que sale entera.
  const paisDelCliente = String(
    getEffectiveCountryCode(convo?.phone ?? null, config) ?? ""
  )
    .trim()
    .toUpperCase();
  const banderasDeLaIntro = (index: number): string[] => {
    if (config.intro_pais_routing_enabled?.[index] === false) return [];
    return (config.intro_paises?.[index] ?? [])
      .map((p) => String(p ?? "").trim().toUpperCase())
      .filter(Boolean);
  };
  const deSuPais = pool.filter(
    (item) =>
      !!paisDelCliente &&
      banderasDeLaIntro(item.variant - 1).includes(paisDelCliente)
  );
  // SIN BANDERA NO SE DISPARA — la misma regla que en `elegirGrupoDeIntro`, y por el
  // mismo pedido del 02/10/2026: «si no tiene bandera elegida, no sale».
  //
  // ESTÁ ESCRITA EN DOS SITIOS PORQUE SON DOS LISTAS DISTINTAS —los cajones de intro y
  // las variantes de la intro— pero tienen que decidir IGUAL. Que una sirva lo que la
  // otra descarta es el fallo que este proyecto ha pagado tres veces. Si se toca una, se
  // toca la otra: lo vigila `prueba-sin-bandera-no-se-dispara`.
  //
  // Y SIN NINGUNA BANDERA PUESTA, NADA CAMBIA: esto es una plantilla y una instalación
  // nueva no tiene ninguna escrita. Ver el porqué largo en `elegirGrupoDeIntro`.
  const conBandera = pool.filter(
    (item) => banderasDeLaIntro(item.variant - 1).length > 0
  );
  const candidatas =
    conBandera.length === 0
      ? pool
      : deSuPais.length > 0
        ? deSuPais
        : conBandera;
  if (candidatas.length > 0 && candidatas.length !== pool.length) {
    pool.length = 0;
    pool.push(...candidatas);
  }
  // EL RESPALDO ENTRE PAÍSES SE PUEDE APAGAR (16/10/2026). Lo de arriba no se toca: con el
  // respaldo encendido decide como siempre. Apagado, a un país sin intro propia no se le
  // manda la de otro — ni tampoco la «intro de siempre» de más abajo, que también puede ser de
  // otro país. Con sus palabras: «respaldar en Argentina lo de Perú… sería ilógico».
  // Se devuelve sin pasos y marcado; quien arranca la conversación lo pasa a humano.
  if (
    conBandera.length > 0 &&
    deSuPais.length === 0 &&
    !usaRespaldoEntrePaises(config)
  ) {
    return { steps: [], variant: 1, weight: 1, faltaLaDeSuPais: true };
  }

  let chosen: IntroChoice;
  const adSourceId = convo?.ad_source_id?.trim();
  const introIds = (index: number) => {
    if (config.intro_ad_routing_enabled?.[index] === false) return [];
    const legacyIds = String(config.intro_ad_ids?.[index] ?? "")
      .split(/[\s,;]+/)
      .map((id) => id.trim())
      .filter(Boolean);
    return legacyIds.concat(adIdsForKeys(config, config.intro_ad_keys?.[index]));
  };
  const adMatchIndex = adSourceId
    ? allIntros.findIndex((_, index) => {
        return adIdMatches(adSourceId, introIds(index));
      })
    : -1;
  const adMatched = pool.find((item) => item.variant === adMatchIndex + 1);
  // Sin ID de anuncio o sin coincidencia, se sortean las intros activas.
  const eligiblePool = pool;
  if (adMatched) {
    chosen = adMatched;
  } else if (eligiblePool.length > 0) {
    const totalWeight = eligiblePool.reduce((sum, item) => sum + item.weight, 0);
    let ticket = Math.random() * totalWeight;
    chosen = eligiblePool[0];
    for (const item of eligiblePool) {
      ticket -= item.weight;
      if (ticket <= 0) {
        chosen = item;
        break;
      }
    }
  } else {
    chosen = { steps: config.intro_sequence, variant: 1, weight: 1 };
  }
  return chosen;
}

/**
 * Programa todas las acciones del intro con sus delays acumulados.
 */
/**
 * Programa los pasos de la intro DESDE un punto.
 *
 * Existe suelta porque la intro ya no siempre sale de una tirada: una burbuja
 * con botones la detiene, y al contestar hay que retomarla desde la siguiente.
 * Sin esto habría dos sitios calculando los mismos tiempos, y el segundo se
 * quedaría atrás en cuanto el primero cambiara.
 */
function programarPasosDeIntro(
  convoId: number,
  pasos: SequenceStep[],
  desde: number,
  variant: number,
  commercialRoute: "A" | "B"
): void {
  const now = Math.floor(Date.now() / 1000);
  // UNA BURBUJA APAGADA NO ESPERA.
  //
  // Antes se programaban TODAS, encendidas o no, y se sumaba la espera de todas.
  // La apagada llegaba, no enviaba nada… y las de después ya habían esperado su
  // pausa igual. Con cuatro fotos apagadas de 7 segundos entre medio, quien
  // había puesto 4 segundos veía pasar más de treinta.
  //
  // Y encima cada una gastaba su turno: el obrero atiende UNA burbuja por
  // conversación cada 2 segundos, así que las apagadas también hacían cola.
  //
  // Ahora ni se programan. Los índices siguen siendo los de siempre —el envío
  // lee la burbuja por su número— así que apagar y encender no descoloca nada.
  const aEnviar: number[] = [];
  for (let i = desde; i < pasos.length; i++) {
    if (pasos[i]?.enabled !== false) aEnviar.push(i);
  }
  // El "is_last" cierra la intro: marca intro_done y suelta lo que va detrás. Se
  // pasa a la última ENCENDIDA, porque la última de la lista puede estar apagada
  // y ya no se programa.
  const ultima = aEnviar[aEnviar.length - 1];
  let acumulado = 0;
  for (const i of aEnviar) {
    scheduleAction(
      convoId,
      ACTION_SEND_INTRO_STEP,
      {
        step_index: i,
        is_last: commercialRoute === "A" && i === ultima,
        variant,
        commercial_sales_route: commercialRoute,
      },
      now + acumulado
    );
    acumulado += pasos[i].delay_after_sec ?? 0;
  }
  // TODAS APAGADAS. La intro tiene que terminar igual: sin esto la conversación
  // se quedaría en "intro corriendo" para siempre, sin pedir el pago ni nada.
  if (aEnviar.length === 0 && commercialRoute === "A") {
    scheduleAction(
      convoId,
      ACTION_SEND_INTRO_STEP,
      {
        step_index: Math.max(0, pasos.length - 1),
        is_last: true,
        variant,
        commercial_sales_route: commercialRoute,
        skip_intro_step: true,
      },
      now
    );
  }
}

/** Los pasos de la intro que le tocan a esta conversación, con su variante. */
function pasosDeIntroDeLaConversacion(
  convo: ConversationRow,
  config: WorkflowConfig
): { pasos: SequenceStep[]; variant: number } {
  const elegida = chooseIntroSequence(config, convo, convo.intro_variant_sent);
  const ruta = (convo.commercial_sales_route === "B" ? "B" : "A");
  const pasos =
    ruta === "B"
      ? elegida.steps.slice(
          0,
          Math.max(0, elegida.steps.length - routeBReplaceLastIntroSteps(config))
        )
      : elegida.steps;
  return { pasos, variant: elegida.variant };
}

/**
 * La decisión que eligió el cliente, de la burbuja que dejó la intro en pausa.
 *
 * La marca guarda por dónde RETOMAR, así que la burbuja que preguntó es la
 * anterior. Se busca ahí y solo ahí: las decisiones de otra burbuja no pintan
 * nada en este momento, y mirarlas sería contestar a una pregunta que no se
 * hizo.
 */
function decisionDeLaBurbujaEnPausa(
  convo: ConversationRow,
  config: WorkflowConfig,
  msgContent: string
): BubbleDecision | null {
  const desde = convo.intro_paused_index;
  if (typeof desde !== "number" || desde <= 0) return null;
  const { pasos } = pasosDeIntroDeLaConversacion(convo, config);
  const laQuePregunto = pasos[desde - 1];
  return decisionQueCoincide(msgContent, laQuePregunto?.decisions);
}

/**
 * PALABRAS QUE CONTESTAN A CUALQUIER PREGUNTA.
 *
 * «Sí», «ok», «dale», «no» — no señalan NADA por sí solas: dicen que sí o que
 * no a lo último que se preguntó. Dentro de su momento valen; fuera de él son
 * una moneda al aire.
 *
 * Es la misma idea que ya sostiene el «sí» a secas del segundo producto, y la
 * misma lista de siempre: aquí no se añade vocabulario nuevo.
 */
/**
 * ETAPAS EN LAS QUE NO HAY NINGUNA PREGUNTA ESPERANDO RESPUESTA.
 *
 * Fuera de estas, el bot acaba de preguntar algo concreto —qué opción quiere,
 * su correo, si acepta el regalo— y esa rama sabe a qué se le contesta. Un
 * cuadrito de la intro metiéndose ahí respondería a otra pregunta.
 */
const ETAPAS_SIN_PREGUNTA_ABIERTA = new Set<string>([
  "new",
  "intro_running",
  "intro_done",
  "payment_done",
]);

const PALABRAS_QUE_NO_SEÑALAN =
  /^(si|sii+|sip|claro|dale|dalee+|ya|ok|okey|okk|k|bueno|listo|obvio|va|no|nop|nel|nada|ninguno|jamas|nunca)$/;

/**
 * EL CUADRITO DE LA INTRO, TAMBIÉN FUERA DE SU MOMENTO.
 *
 * QUÉ PASABA
 *
 *   Los cuadritos de la intro solo se leían mientras la intro estaba DETENIDA
 *   en esa burbuja. El cliente contestaba ahí mismo y funcionaba; pero si
 *   desviaba —una duda, una consulta al modelo— y volvía a elegir después, su
 *   texto no salía nunca. El mismo trabajo escrito, atendido o tirado según el
 *   momento en que el cliente contestara.
 *
 * POR QUÉ NO SE PODÍA A SECAS
 *
 *   Porque un cuadrito con la palabra «sí» leído en cualquier momento se come
 *   los turnos del modelo: cada «ok» de la conversación dispararía un texto de
 *   venta. Es el mismo fallo del «sí» del segundo producto, multiplicado por
 *   todos los cuadritos.
 *
 * LA REGLA
 *
 *   Fuera de su momento solo deciden las palabras que SEÑALAN algo —«yape»,
 *   «el completo», «transferencia»—. Las que contestan a cualquier pregunta
 *   —«sí», «ok», «no»— siguen valiendo únicamente dentro de la pausa, que es
 *   donde se sabe a qué contestan.
 *
 *   Y el comodín (un cuadrito sin palabras) tampoco: ahí dentro atrapa "lo que
 *   no encajó en las demás", que fuera de la pregunta es TODO.
 *
 *   Se filtran las palabras y se usa el MISMO comparador de siempre
 *   (`decisionQueCoincide`), para que un cuadrito no pueda entenderse de dos
 *   formas distintas según por dónde se lea.
 */
/**
 * LAS PALABRAS QUE NOMBRAN ALGO DE ESTE NEGOCIO.
 *
 * Salen ENTERAS de la configuración —los nombres de las dos opciones, el del
 * producto, el del extra y las etiquetas y alias de los métodos de pago—, así
 * que el código no conoce ninguna: cambie el dueño de producto y esta lista
 * cambia sola. Es lo contrario de una lista de palabras escrita a mano.
 *
 * Se piden 3 letras porque «de», «el» o «y» salen dentro de cualquier nombre y
 * no nombran nada.
 */
function palabrasQueNombranAlgo(config: WorkflowConfig | null): Set<string> {
  const limpia = (t: string | undefined | null): string =>
    (t ?? "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Mn}/gu, "")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  const oferta = getActiveTwoTierOffer(config);
  const fuentes: (string | undefined | null)[] = [
    oferta?.combo?.name,
    oferta?.basico?.name,
    config?.product_name,
    config?.product_name_2,
    seccionUpsell(config)?.name,
  ];
  for (const boton of config?.payment_buttons ?? []) {
    if (boton?.enabled === false) continue;
    fuentes.push(boton?.label);
    for (const alias of boton?.aliases ?? []) fuentes.push(alias);
  }
  const nombres = new Set<string>();
  for (const fuente of fuentes) {
    for (const palabra of limpia(fuente).split(" ")) {
      if (palabra.length >= 3) nombres.add(palabra);
    }
  }
  return nombres;
}

function cuadritoDeLaIntroQueSeñala(
  convo: ConversationRow,
  config: WorkflowConfig,
  msgContent: string
): BubbleDecision | null {
  // SOLO LA INTRO QUE ESTE CLIENTE RECIBIÓ.
  //
  // Hay varias intros y el bot sortea una. Sin el número de la suya, el
  // buscador elegiría una al azar y podría contestar con el cuadrito de una
  // burbuja que este cliente no vio nunca. Sin intro enviada no hay nada que
  // haya elegido.
  if (convo.intro_variant_sent == null) return null;
  const { pasos } = pasosDeIntroDeLaConversacion(convo, config);
  if (!Array.isArray(pasos)) return null;
  // UNA PALABRA CORRIENTE Y SUELTA NO DECIDE DENTRO DE UNA FRASE LARGA.
  //
  // LO QUE COSTÓ. El dueño puso «tengo» en un cuadrito «SI» —pensando en «tengo
  // yape»— y con eso cualquier frase que llevara ese verbo contestaba a esa
  // burbuja. El 2026-09-14, «mejor el otro por favor no tengo mucho dinero» se
  // leyó como un «sí» a una pregunta de la intro, y el turno murió ahí:
  //
  //     [wf:decision] "SI" ya estaba contestado → le reenvío sus datos
  //
  // Y no es de una palabra: él va a escribir cientos de respuestas
  // personalizadas. Vigilarlas una a una no es un plan.
  //
  // LA REGLA YA ESTABA ESCRITA EN ESTA CASA, para los cuadritos del segundo
  // producto: «quien contesta un cuadrito contesta CORTO; una palabra clave de
  // UNA sola palabra solo decide en respuestas cortas; las de varias siguen
  // valiendo en cualquier sitio, que nadie escribe eso por casualidad». Decía
  // expresamente «los cuadritos de la intro se quedan como estaban». Se iguala,
  // porque la trampa es la misma.
  //
  // CON UNA EXCEPCIÓN QUE AÑADE, NO QUITA: una sola palabra que NOMBRA algo del
  // negocio —«yape», «combo», el nombre de un producto— sigue decidiendo en
  // cualquier frase. Esas no aparecen por casualidad, y salen de la
  // configuración, así que la lista se rehace sola al cambiar de producto.
  const limpiarTexto = (t: string | undefined | null): string =>
    (t ?? "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Mn}/gu, "")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  const esRespuestaCorta =
    limpiarTexto(msgContent).split(" ").filter(Boolean).length <= 4;
  const nombranAlgo = palabrasQueNombranAlgo(config);
  const soloLasQueSeñalan = (decision: BubbleDecision): BubbleDecision | null => {
    if (decision.enabled === false) return null;
    const claves = (decision.keywords ?? []).filter((clave) => {
      const limpia = (clave ?? "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{Mn}/gu, "")
        .trim();
      if (limpia.length === 0) return false;
      if (PALABRAS_QUE_NO_SEÑALAN.test(limpia)) return false;
      // De varias palabras: siempre. Nadie escribe «tengo yape» por casualidad.
      if (limpiarTexto(limpia).includes(" ")) return true;
      // De una, pero nombra algo suyo: también siempre.
      if (nombranAlgo.has(limpiarTexto(limpia))) return true;
      // De una y corriente: solo si contestó corto, que es como se contesta un
      // cuadrito.
      return esRespuestaCorta;
    });
    if (claves.length === 0) return null;
    return { ...decision, keywords: claves };
  };
  for (const paso of pasos) {
    if ((paso as { enabled?: boolean }).enabled === false) continue;
    const candidatas = ((paso as { decisions?: BubbleDecision[] }).decisions ?? [])
      .map(soloLasQueSeñalan)
      .filter((decision): decision is BubbleDecision => decision !== null);
    const elegida = decisionQueCoincide(msgContent, candidatas);
    if (elegida) return elegida;
  }
  return null;
}

/**
 * EL «OK» QUE CONTESTA A LA PREGUNTA DE PAGO. SOLO EN LINEAL.
 *
 * QUÉ PASABA
 *
 *   La intro de Lineal termina preguntando cómo quiere pagar, y el dueño deja
 *   ahí sus cuadritos —uno por método—. Esos cuadritos se disparan por las
 *   palabras que él escribe, y `PALABRAS_QUE_NO_SEÑALAN` aparta a propósito las
 *   corrientes: «si», «ok», «dale», «listo». Con razón, porque un «ok» pelado
 *   no señala a NINGUNO de los dos métodos.
 *
 *   Resultado: el cliente decide comprar, escribe «ok» o «lo llevo», y el turno
 *   se va al modelo, que le vuelve a preguntar el método. Sus palabras: «en
 *   lineal es pérdida de tiempo; es un solo producto, la elección de método no
 *   debería ser una condición para soltar los datos».
 *
 * POR QUÉ AQUÍ SÍ SE PUEDE Y EN LAS DEMÁS NO
 *
 *   En Lineal hay UN producto, así que una afirmación solo puede querer decir
 *   una cosa: que compra. En -OB- el método es la primera elección a propósito
 *   —es lo que destapa la segunda intro— y en las de dos opciones falta saber
 *   CUÁL. Por eso esto empieza preguntando por la modalidad y se va si no es
 *   Lineal.
 *
 * NO ES UNA LISTA DE PALABRAS: ES LA PREGUNTA QUE QUEDÓ ABIERTA
 *
 *   Lo que decide no es el «ok», es que la pregunta de pago siga abierta. Se
 *   abre al terminar la intro y se cierra cuando el cliente tiene método
 *   anotado — de ahí la segunda condición, que es la que impide que esto vuelva
 *   a dispararse después. Y aguanta que el cliente se desvíe: puede preguntar
 *   tres cosas antes de decir «ok» y el «ok» sigue siendo de la pregunta de
 *   pago, porque nada la cerró. La afirmación solo desempata dentro de eso.
 *
 *   Las tres puertas que se apartan —pregunta de precio, duda sobre el pago, y
 *   que esté nombrando un método— son las mismas de la puerta de al lado, para
 *   que no se separen con el tiempo. Si nombra un método, ese turno es del
 *   cuadrito de siempre, que ya lo caza por su palabra.
 *
 * DEVUELVE SU CUADRITO, NO UN TEXTO DE FÁBRICA. Así sale lo que él escribió, y
 * el día que encienda sus burbujas salen las suyas sin tocar una línea.
 */
function esUnaAfirmacionALaPreguntaDePagoDeLineal(
  convo: ConversationRow,
  config: WorkflowConfig,
  msgContent: string
): boolean {
  if (getActiveModalityKey(config) !== "lineal") return false;
  // Con método ya anotado la pregunta está cerrada: de aquí en adelante manda
  // el camino de siempre, que sabe reenviar y cambiar de método.
  if (convo.selected_payment_method?.trim()) return false;
  // Sin intro enviada no hay pregunta que haya quedado abierta.
  if (convo.intro_variant_sent == null) return false;
  // LA ACEPTACIÓN SE LEE POR LO QUE EL MENSAJE NO DICE, NO POR UNA LISTA.
  //
  // `isPurchaseAffirmative` se queda: lo que hoy funciona sigue funcionando
  // igual, y es lo que atrapa «lo quiero», «me lo llevo» o «de una». Lo que se
  // añade al lado es `soloEstaDeAcuerdo`, que acepta cualquier mensaje que no
  // lleve NADA MÁS que acuerdo — y es lo que faltaba con «esta bien», que le
  // costó al dueño dos respuestas del modelo sin vender el 24/09.
  //
  // Van en OR porque cubren cosas distintas: una reconoce frases de compra
  // dentro de un mensaje largo, la otra reconoce un mensaje que es solo un sí.
  if (!isPurchaseAffirmative(msgContent) && !soloEstaDeAcuerdo(msgContent))
    return false;
  if (isPriceQuestion(msgContent)) return false;
  if (messageHasPaymentConcern(msgContent)) return false;
  // Nombrar un método es cosa del camino de siempre, que manda el que el
  // cliente pidió, no el principal.
  if (detectPaymentRoute(msgContent, convo.phone)) return false;
  // Y SI EL BOT ACABABA DE PREGUNTAR OTRA COSA, EL «OK» ES DE ESA OTRA COSA.
  //
  // LO QUE PASÓ — 25 de septiembre de 2026, su conversación 147. El bot cerró su
  // turno con:
  //
  //     «¿Te gustaría que te cuente más sobre lo que incluye? 😊»
  //
  // Él contestó «ok» — y se le abrió la oferta del segundo producto, como si
  // hubiera dicho que compraba. Con sus palabras: «que no se confunda, que dé
  // respuesta según el contexto; y si es otra frase del bot y el cliente dice
  // "sí", tampoco apruebe».
  //
  // POR QUÉ PASABA, Y ESTABA ESCRITO A PROPÓSITO. Esta función decide por el
  // ESTADO —«salió la intro y todavía no hay método»— no por lo que el bot acabó
  // de preguntar. Su comentario de arriba lo dice: «aguanta que el cliente se
  // desvíe: puede preguntar tres cosas antes de decir ok y el ok sigue siendo de
  // la pregunta de pago». Eso es cierto cuando el bot solo CONTESTA por el
  // camino; deja de serlo cuando el bot PREGUNTA otra cosa, porque entonces hay
  // dos preguntas abiertas y la última es la suya.
  //
  // NO ES UNA REGLA NUEVA: es la que ya usa la puerta del reenvío unas líneas
  // más arriba, `elBotOfrecioEnsenarAlgo`. La misma pregunta contestada en dos
  // sitios distintos es como se separan con el tiempo, así que se reutiliza.
  //
  // Y TRAE SU PROPIO FRENO, que es lo que hace que esto no rompa la venta: si lo
  // que el bot ofreció son los DATOS, el método o cómo adquirirlo, esa función
  // dice «no ofrecí una muestra» y el «ok» sigue comprando. Medido contra el
  // contenido del dueño antes de tocar nada: sus tres cierres de intro —las dos
  // variantes y la del order bump— hablan de pago, así que ninguno entra aquí.
  if (elBotOfrecioEnsenarAlgo(ultimoMensajeDelBot(convo.id), convo.id)) {
    return false;
  }
  return true;
}

/**
 * EL CUADRITO DE PAGO QUE YA LE SALIÓ A ESTE CLIENTE.
 *
 * `ultima_decision` guarda cuál fue el último cuadrito contestado. Si ese
 * cuadrito ya le dio los datos de pago con el texto del dueño, reenviar es
 * repetir ESE, no las burbujas de fábrica del método.
 *
 * Solo cuenta si sus burbujas llevan de verdad los datos —la misma pregunta que
 * gobierna la primera vez, `susBurbujasLlevanLosDatos`—: un cuadrito que solo
 * presentaba no sirve como reenvío, ahí el cliente se quedaría sin la cuenta.
 */
function elCuadritoDePagoQueYaLeSalio(
  convo: ConversationRow,
  config: WorkflowConfig
): BubbleDecision | null {
  const ultima = convo.ultima_decision?.trim();
  if (!ultima) return null;
  if (convo.intro_variant_sent == null) return null;
  const { pasos } = pasosDeIntroDeLaConversacion(convo, config);
  if (!Array.isArray(pasos)) return null;
  for (const paso of pasos) {
    if ((paso as { enabled?: boolean }).enabled === false) continue;
    for (const decision of (paso as { decisions?: BubbleDecision[] }).decisions ??
      []) {
      if (decision.enabled === false) continue;
      if (claveDeCuadrito(decision) !== ultima) continue;
      return susBurbujasLlevanLosDatos(decision.steps) ? decision : null;
    }
  }
  return null;
}

/**
 * Y SU CUADRITO, SI LO TIENE. La misma afirmación, pero contestada con el texto
 * del dueño en vez del de fábrica.
 *
 * Es opcional a propósito: cuando se midió con su contenido del 21/09, su intro
 * de Lineal NO tenía ningún cuadrito de pago —los que tiene escritos viven en
 * otra intro— así que una regla que dependiera de encontrar uno no habría hecho
 * nada. Si lo hay, sale el suyo; si no, los datos del método principal por el
 * camino de siempre.
 */
function elCuadritoDePagoDeUnaAfirmacion(
  convo: ConversationRow,
  config: WorkflowConfig,
  msgContent: string
): BubbleDecision | null {
  if (!esUnaAfirmacionALaPreguntaDePagoDeLineal(convo, config, msgContent))
    return null;
  const principal = getDefaultPaymentMethodId(convo.phone);
  if (!principal) return null;
  const { pasos } = pasosDeIntroDeLaConversacion(convo, config);
  if (!Array.isArray(pasos)) return null;
  for (const paso of pasos) {
    if ((paso as { enabled?: boolean }).enabled === false) continue;
    for (const decision of (paso as { decisions?: BubbleDecision[] }).decisions ??
      []) {
      if (decision.enabled === false) continue;
      if (decision.action !== "send_payment_method") continue;
      const suyo = (decision.payment_method ?? "").trim().toLowerCase();
      if (suyo && suyo === principal.trim().toLowerCase()) return decision;
    }
  }
  return null;
}

/**
 * ¿ESTE TURNO ES UN CAMBIO DE OPCIÓN? ENTONCES NO ES DE NADIE MÁS.
 *
 * LO QUE COSTÓ. Con la opción elegida y los datos de pago delante, el cliente
 * escribió «mejor el otro por favor no tengo mucho dinero». Su «NO» de la intro
 * —el cuadrito con la palabra `no tengo`— lo atrapó primero, contestó con su
 * texto y cerró el turno. La puerta que sí sabe cambiar de opción vive mucho
 * más abajo y no llegó a mirarlo nunca. El cliente pidió el barato y se quedó
 * con el caro anotado:
 *
 *     FALLA  y al decir «mejor el otro» cambia de verdad   combo → combo
 *
 * Y NO ES DE UNA PALABRA. Se filtraron las palabras corrientes de los cuadritos
 * —ver `cuadritoDeLaIntroQueSeñala`— y la frase cayó en el cuadrito de al lado,
 * con `no tengo`, que son dos y valen en cualquier sitio. Mientras el orden sea
 * «primero el cuadrito, después el cambio», siempre habrá una respuesta
 * personalizada que se cruce. El dueño va a escribir cientos.
 *
 * ASÍ QUE NO SE QUITA NINGÚN CUADRITO: SE LES PONE DELANTE EL DUEÑO DEL TURNO.
 * Es la misma forma de las tres guardas que ya tiene ese bloque —la duda sobre
 * el pago, el método negado, el comprobante sin leer—: no apagan nada, apartan
 * el cuadrito del turno que le toca a otro.
 *
 * LAS CONDICIONES SON LAS DE ESA PUERTA, LAS MISMAS Y EN EL MISMO ORDEN, para
 * que no se separen con el tiempo: si aquí se aparta, allí se atiende. Si algún
 * día dejaran de coincidir, el turno se iría al modelo —que es lo que hacía
 * antes de todo esto—, nunca a un cuadrito equivocado.
 */
/**
 * EL «SÍ» DEL CLIENTE A LO QUE EL BOT ACABA DE PROPONER.
 *
 * La decisión existe entera, pero repartida en las DOS mitades: la propuso el
 * BOT y la afirmó el CLIENTE. Ninguna de las puertas de elección mira las dos a
 * la vez — todas leen solo las palabras del cliente, y en un «sí» pelado no hay
 * ningún producto nombrado.
 *
 * VIVE EN UN SOLO SITIO A PROPÓSITO, y lo usan las DOS puertas: la primera
 * elección (`awaiting_doble_oferta_dos_choice`) y el CAMBIO de opción
 * (`payment_done` sin nada abonado). Es la misma disciplina que ya siguen
 * `opcionNombradaPorLoCompartido` y `elClienteEstaCambiandoDeOpcion`: dos
 * lecturas distintas de la misma frase es como se separan las puertas con el
 * tiempo.
 *
 * POR QUÉ TIENE QUE VALER TAMBIÉN PARA CAMBIAR — lo pidió el dueño el 16 de
 * septiembre de 2026, con estas palabras: «que eso que vas a implementar también
 * pueda cambiar de elección si el bot lo propone; que "quieres llevar el combo a
 * 14" no quede fijo». Tiene razón y es la venta real: el cliente elige, duda, se
 * desvía y vuelve, y el bot le propone otra cosa por el camino.
 *
 * Y NO QUEDA FIJA NUNCA, por construcción: siempre se lee la ÚLTIMA burbuja del
 * bot. La propuesta más nueva manda sobre la anterior, sin memoria que limpiar.
 *
 * LOS TRES FRENOS, todos heredados de reglas que ya estaban:
 *  · El bot tuvo que dejar una PREGUNTA abierta. El signo sí vale aquí, al revés
 *    que con el cliente: lo escribe el bot, que sí puntúa.
 *  · El cliente tuvo que decir un «sí» pelado, con el MISMO detector que usa el
 *    producto extra (`detectaSiSimpleAlUpsell`).
 *  · Y el bot tuvo que proponer UNA SOLA opción: si nombró las dos,
 *    `laOpcionQueElBotPropuso` devuelve vacío y «¿cuál prefieres?» + «sí» sigue
 *    sin elegir nada.
 */
function laPropuestaDelBotQueElClienteAfirmo(
  convo: ConversationRow,
  msgContent: string,
  config: WorkflowConfig | null,
  /**
   * ¿VALE TAMBIÉN UNA PALABRA DE ACUERDO SUELTA? Apagado por defecto, y a propósito.
   *
   * LO QUE PASÓ — 3 de octubre de 2026. Midiendo las tres semimodalidades del dueño con
   * las MISMAS frases, apareció una asimetría que nadie había escrito:
   *
   *                          un producto   COMO -OB-   COMO -DOU-
   *     «si», «ok», «dale»        sí           sí           sí
   *     «esta bien», «vale»       sí           sí           NO
   *     «de acuerdo», «listo»     sí           sí           NO
   *     «de una», «ya pues»       sí           sí           NO
   *
   * En COMO -DOU-, el bot propone una opción, el cliente contesta «esta bien» y la
   * elección NO se anotaba: el turno se iba al modelo. Es la forma exacta del fallo que
   * este proyecto ya pagó una vez —convo 127 del 16/09, cuando hubo que decir «si» dos
   * veces para lo mismo— y la regla de la casa es clara: si la parte que DECIDE depende de
   * que el modelo se acuerde, no está hecha.
   *
   * POR QUÉ UN INTERRUPTOR Y NO ARREGLARLO DENTRO. Esta función la llaman TRES sitios, y
   * los otros dos no son la elección de dos opciones. Ensanchar el detector de dentro los
   * movería a los tres: eso es malograr dos cosas para arreglar una. Con el interruptor
   * apagado por defecto, los otros dos sitios se comportan letra por letra como antes.
   *
   * Y NO SE ENSANCHA `detectaSiSimpleAlUpsell`, que sería lo natural: ese detector también
   * atiende la oferta del producto extra, y tocarlo cambiaría la segunda venta.
   *
   * LO QUE LO HACE SEGURO es `soloEstaDeAcuerdo`: exige que el mensaje NO DIGA NADA MÁS,
   * así que «si pero no es estafa» sigue sin anotar nada. Es la misma función que ya usan
   * las puertas de lineal y de COMO -OB-, probada y en pie desde el 2 de octubre.
   *
   * Y NO SE AÑADE `isPurchaseAffirmative`, QUE SERÍA LA PARIDAD TOTAL. Medido antes de
   * tocar nada: esa función dice «sí» a
   *
   *     «quiero SABER que contiene»   «quiero ver fotos»   «quiero preguntar algo»
   *
   * porque busca el verbo en cualquier parte. En lineal y en COMO -OB- hay guardas ANTES
   * que lo paran; en esta puerta no las hay, así que meterla aquí anotaría una elección
   * cuando el cliente solo está preguntando — y eso es cobrarle por una duda. Es el mismo
   * fallo que fija `prueba-querer-saber-no-es-querer-comprar`.
   *
   * ASÍ QUE CINCO FRASES QUEDAN FUERA A PROPÓSITO: «asi es», «por supuesto», «de una»,
   * «ya pues» y «ya quiero adquirirlo». Si algún día hacen falta, se traen CON sus guardas,
   * no sueltas.
   */
  opciones?: { tambienElAcuerdoSuelto?: boolean }
): "combo" | "basico" | null {
  const dijoQueSi =
    detectaSiSimpleAlUpsell(msgContent) ||
    (opciones?.tambienElAcuerdoSuelto === true && soloEstaDeAcuerdo(msgContent));
  if (!dijoQueSi) return null;
  // SU TURNO ENTERO, NO LA ÚLTIMA BURBUJA.
  //
  // LO QUE COSTÓ — 16 de septiembre de 2026, conversación HHEELLOO3, convo 136.
  // El bot contestó en CUATRO burbujas: el nombre de la opción iba en la
  // primera, y en la última solo quedaba «¿te gustaría ir por esa opción?».
  // Leyendo solo la última no hay ni nombre ni precio: nada que reconocer. El
  // cliente dijo «si» dos veces y la elección no se registró ninguna.
  //
  // El motor parte cada respuesta en trozos —el log lo dice, «4 chunks LLM»— y
  // cada trozo se guarda como un mensaje. «Lo último que dijo el bot» no es la
  // última fila de la tabla: es TODO lo que dijo desde que habló el cliente.
  //
  // Y ASÍ ES MÁS CORRECTO, no solo más ancho: si el bot repasó las dos opciones
  // repartidas en varias burbujas, juntas se ven las dos y la regla del menú las
  // aparta. Mirando una sola burbuja, la mitad de un menú parecía una oferta.
  //
  // LA VENTANA VA HOLGADA A PROPÓSITO. Cuántas burbujas manda no es fijo —el
  // dueño lo dice y sus registros lo confirman: cuatro, cinco, seis—, y la
  // intro suelta muchas más de corrido. El lazo recoge las que haya; lo que no
  // puede pasar es que la ventana corte un turno POR LA MITAD, porque entonces
  // la mitad que nombra la otra opción se queda fuera y un menú se leería como
  // una oferta. Con margen de sobra eso no ocurre, y leer unas filas más de la
  // tabla no cuesta nada.
  const loUltimoQueDijoElBot = (() => {
    const historia = getRecentHistory(convo.id, 30);
    const suTurno: string[] = [];
    for (let i = historia.length - 1; i >= 0; i--) {
      if (historia[i].role === "assistant") suTurno.unshift(historia[i].content ?? "");
      else if (suTurno.length > 0) break; // habló el cliente: su turno acabó ahí
    }
    return suTurno.join("\n");
  })();
  if (!/[?¿]/.test(loUltimoQueDijoElBot)) return null;
  // CON UNA OPCIÓN YA ELEGIDA, NOMBRAR LA OTRA BASTA. Ver el comentario de
  // `laOpcionQueElBotPropuso`: ahí lo único que puede pasar es un cambio, y las
  // dos puertas que atienden exigen que sea DISTINTA de la que tiene. Sin
  // ninguna elegida —la primera elección— se sigue pidiendo la frase o el
  // precio, exactamente como antes.
  const yaTieneUnaElegida =
    convo.order_bump_choice === "combo" || convo.order_bump_choice === "basico";
  return laOpcionQueElBotPropuso(loUltimoQueDijoElBot, config, {
    elClienteYaTieneUnaElegida: yaTieneUnaElegida,
  });
}

function elClienteEstaCambiandoDeOpcion(
  convo: ConversationRow,
  config: WorkflowConfig,
  msgContent: string,
  latestIsImage: boolean
): boolean {
  if (convo.state !== "payment_done") return false;
  if (!(isOrderBumpActive() || isDobleOfertaActive())) return false;
  if (isCommercialRouteB(convo)) return false;
  if (
    convo.order_bump_choice !== "combo" &&
    convo.order_bump_choice !== "basico"
  )
    return false;
  if (latestIsImage) return false;
  if (convo.paid_total_cents !== 0) return false;
  if (detectPaymentRoute(msgContent, convo.phone) !== null) return false;
  const otra =
    inferTwoTierChoiceFromContext(
      msgContent,
      convo.order_bump_choice,
      config,
      {
        elExtraNoEstaEnJuego:
          convo.upsell_state !== "ofrecido" && convo.upsell_state !== "aceptado",
        // Su precio, no el de la caja global. Ver la puerta del cambio de opción.
        phone: convo.phone,
      }
    ) ??
    // EL MISMO RESPALDO Y EN EL MISMO ORDEN que en la puerta que atiende. Si
    // aquí no se leyera igual, un «sí» a la propuesta del bot se apartaría aquí
    // y allí no se atendería — o al revés. Ver el comentario de esta función.
    laPropuestaDelBotQueElClienteAfirmo(convo, msgContent, config);
  return !!otra && otra !== convo.order_bump_choice;
}

/**
 * EL CUADRITO DE LA PREGUNTA DEL REGALO.
 *
 * Los cuadritos funcionaban en la intro y en la oferta del segundo producto. En
 * el regalo el editor los dejaba escribir igual, y no los leía nadie: se
 * escribía la respuesta al «sí quiero el regalo» y esa respuesta no le llegaba
 * a ningún cliente.
 *
 * Se miran las burbujas de la pregunta de consentimiento, que son las que el
 * cliente tiene delante en ese momento. Solo esas: las de otra burbuja no
 * pintan nada aquí, y mirarlas sería contestar a una pregunta que no se hizo.
 */
function decisionDelRegalo(
  config: WorkflowConfig,
  msgContent: string
): BubbleDecision | null {
  const pasos = config.gift_mechanic?.consent_sequence;
  if (!Array.isArray(pasos)) return null;
  for (const paso of pasos) {
    if ((paso as { enabled?: boolean }).enabled === false) continue;
    const elegida = decisionQueCoincide(
      msgContent,
      (paso as { decisions?: BubbleDecision[] }).decisions
    );
    if (elegida) return elegida;
  }
  return null;
}

/**
 * EL CUADRITO DE LA OFERTA DEL SEGUNDO PRODUCTO.
 *
 * Los cuadritos de decisión funcionaban SOLO en las burbujas de la intro. En la
 * oferta del extra el editor los dejaba escribir igual, y no los leía nadie: se
 * escribía la respuesta al «sí quiero» y esa respuesta no le llegaba a ningún
 * cliente. Una casilla que acepta trabajo y lo tira.
 *
 * CANDADO DE MODALIDAD (regla 5-bis). Las burbujas salen de `seccionUpsell`,
 * que devuelve la sección de la modalidad ACTIVA y `null` en las que no tienen
 * segundo producto —Lineal, Order Bump, Doble Oferta—. Así los cuadritos de
 * Doble Oferta + Upsell no se leen jamás desde la modalidad Upsell ni al revés,
 * y donde no hay extra esto no existe. Cada modalidad, lo suyo.
 *
 * Se miran ANTES las de la pregunta y después las de la invitación: la pregunta
 * es lo último que el cliente vio, así que su cuadrito manda.
 */
/**
 * ¿LA OFERTA DEL EXTRA SIGUE SIENDO LA ÚLTIMA PREGUNTA DE LA PANTALLA?
 *
 * La oferta queda ABIERTA a propósito: se acepta por su nombre en cualquier
 * momento, aunque hayan pasado horas. Pero abierta no es lo mismo que reciente,
 * y el «sí» a secas no dice a QUÉ dice que sí — lo decide quién preguntó
 * último.
 *
 * EL CASO REAL. Se ofreció el extra. El cliente no contestó ni sí ni no: cambió
 * de tema. El modelo le explicó lo que preguntaba y cerró con SU pregunta
 * («¿quieres que te cuente lo que incluye?»). El cliente escribió «si» —a esa
 * pregunta— y el bot le dio por comprado el segundo producto y le mandó los
 * datos de pago. Le pidió dinero por algo que no eligió.
 *
 * Esta regla ya existía en la casa, escrita para el regalo: cuando hay dos
 * preguntas abiertas, la respuesta es de la más reciente. Lo único que faltaba
 * era aplicarla también cuando quien preguntó fue el modelo.
 *
 * NO SE PIERDE LA VENTA. Lo que ya no decide aquí lo lee el modelo, que tiene
 * el marcador <<QUIERE_EXTRA>> y la instrucción de emitirlo solo cuando la
 * intención es clara — y `handler.ts` únicamente lo obedece con la oferta en
 * pie. Además la oferta sigue viva: el botón, el nombre del producto y las
 * frases de varias palabras («si quiero») la aceptan igual, sin condiciones.
 *
 * Hablar del extra NO rompe la frescura: responder «¿qué incluye?» con sus
 * burbujas vuelve a sellar, porque ahí no se cambió de tema.
 */
function laOfertaSigueSiendoLaUltimaPregunta(convo: ConversationRow): boolean {
  const sellada = convo.upsell_hablado_at;
  // Ofertas anteriores a esta columna: exactamente como siempre.
  if (!sellada) return true;
  return contarMensajesDelBotDespuesDe(convo.id, sellada) === 0;
}

function decisionDeLaOfertaDelExtra(
  config: WorkflowConfig,
  msgContent: string,
  // Con la oferta ya no reciente, un cuadrito solo puede decidir con palabras
  // que no dejen duda —las de varias palabras—. Es la misma exigencia que ya se
  // le pide dentro de una frase larga, por el mismo motivo: «si», «ok» o «k»
  // sueltos contestan a cualquier pregunta, y aquí ya no sabemos a cuál.
  esLaUltimaPregunta = true
): BubbleDecision | null {
  const up = seccionUpsell(config);
  if (!up) return null;
  // UNA PALABRA SUELTA NO DECIDE UNA VENTA DENTRO DE UNA FRASE LARGA.
  //
  // Los cuadritos del extra suelen tener «si» y «no» como palabra clave, y esas
  // dos aparecen dentro de cualquier frase: «ya pagué 7000 SI pago 500 me
  // entregan» lleva un «si» que es el condicional, no una respuesta. El cliente
  // preguntaba y recibió las burbujas del «SÍ QUIERO», con sus datos de pago.
  //
  // Quien contesta un cuadrito contesta CORTO —«si», «ok dale», «el pack»—. Así
  // que una palabra clave de UNA sola palabra solo decide en respuestas cortas.
  // Las de varias («si quiero», «no por ahora») siguen valiendo en cualquier
  // sitio: nadie escribe eso por casualidad. Y un cuadrito SIN palabras —el
  // comodín de «cualquier otra respuesta»— también, porque ahí no se adivina
  // nada: es una elección explícita del operador.
  //
  // Esto vale SOLO para la oferta del extra. Los cuadritos de la intro se
  // quedan exactamente como estaban.
  const limpiar = (t: string): string =>
    (t ?? "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Mn}/gu, "")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  const dicho = ` ${limpiar(msgContent)} `;
  const esRespuestaCorta = dicho.trim().split(" ").filter(Boolean).length <= 4;
  const puedeDecidirEnFraseLarga = (decision: BubbleDecision): boolean => {
    const claves = (decision.keywords ?? []).map(limpiar).filter(Boolean);
    if (claves.length === 0) return true;
    return claves.some((clave) => clave.includes(" ") && dicho.includes(` ${clave} `));
  };
  const burbujas = [
    ...(Array.isArray(up.pregunta_steps) ? up.pregunta_steps : []),
    // AQUÍ SE MIRAN TODOS LOS CAJONES, NO SOLO EL SORTEADO.
    //
    // Esto no envía nada: busca a qué cuadrito de decisión corresponde lo que
    // acaba de escribir el cliente. Mirando solo el cajón que le tocó, un botón
    // escrito en otro no se reconocería — y el cliente ya lo tiene delante si le
    // salió esa versión. Se aceptan los de todos.
    ...(up.intro_groups ?? []).flatMap((g) => g.steps ?? []),
    ...(Array.isArray(up.intro) ? up.intro : []),
  ].filter((paso) => (paso as { enabled?: boolean }).enabled !== false);
  for (const paso of burbujas) {
    const elegida = decisionQueCoincide(
      msgContent,
      (paso as { decisions?: BubbleDecision[] }).decisions
    );
    if (!elegida) continue;
    if (puedeDecidirEnFraseLarga(elegida)) return elegida;
    if (esRespuestaCorta && esLaUltimaPregunta) return elegida;
  }
  return null;
}

/**
 * Manda las burbujas del cuadrito y ejecuta lo que tenga linkeado.
 *
 * Devuelve si la acción del cuadrito YA se encargó de mandar los datos de pago
 * del extra. Con eso, quien llama sabe si todavía tiene que mandarlos él o si
 * solo le queda dejar anotado que el cliente aceptó.
 *
 * El precio que se les pasa es EL DEL EXTRA. Si no, estas burbujas saldrían con
 * el precio del producto que ya compró — el fallo de siempre, otra vez.
 */
async function responderConElCuadritoDelExtra(
  convo: ConversationRow,
  cuadrito: BubbleDecision,
  config: WorkflowConfig
): Promise<boolean> {
  const precioDelExtra =
    getUpsellPriceSoles(
      isDiscountActiveForConversation(convo, config),
      convo.phone,
      config
    ) ?? undefined;
  // APAGADA NO ES DICHA. Contando las apagadas, un cuadrito con sus burbujas en
  // OFF hacía que el bot diera por hecho que él ya mandó los datos del extra —y
  // entonces no manda NADA: ni las suyas, que están apagadas, ni las de fábrica.
  const suyas = tieneBurbujasEncendidas(cuadrito.steps);
  await sendConfiguredSteps(convo, cuadrito.steps, precioDelExtra);
  if (!cuadrito.action) return false;
  // SI EL CUADRITO TRAE SUS BURBUJAS, ESAS SON LA RESPUESTA.
  //
  // Con la acción enlazada salían las DOS: el texto propio del operador y,
  // detrás, los datos de pago de siempre. No es una repetición literal —una es
  // suya y otra la de fábrica— pero el cliente lee dos veces lo mismo con
  // distintas palabras. Suena a máquina, que es justo lo que se estaba
  // corrigiendo escribiéndolo a mano.
  //
  // El motor ya sabía hacer esto: `enviarDatos: false` deja hecho TODO lo que
  // no se ve —anota que aceptó, fija el precio del extra y el método— y se
  // salta solo las burbujas. Se usaba cuando el cuadrito NO tenía acción; le
  // faltaba usarse también cuando sí la tiene.
  //
  // Un cuadrito vacío con acción sigue recibiendo los datos de fábrica: ahí no
  // hay texto propio que respetar.
  if (cuadrito.action === "choose_upsell" && suyas) {
    if (!isUpsellUsable(loadWorkflowConfig())) {
      console.warn(
        `[wf] convo ${convo.id}: el cuadrito pide el segundo producto, pero le falta nombre, precio o entrega → no lo doy por aceptado`
      );
      return false;
    }
    await entregarDatosDePagoDelUpsell(convo, { enviarDatos: false });
    console.log(
      `[wf:upsell] convo ${convo.id}: sus burbujas llevaban los datos → no mando las de fábrica`
    );
    return true;
  }
  const laAccionMandoLosDatos = cuadrito.action === "choose_upsell";
  await ejecutarAccion(
    convo,
    cuadrito.action,
    cuadrito.payment_method,
    cuadrito.title || "este cuadrito de la oferta del extra",
    cuadrito.steps
  );
  return laAccionMandoLosDatos;
}

/**
 * EL CUADRITO CON EL QUE SE ACEPTA EL EXTRA, SI EL OPERADOR ARMÓ UNO.
 *
 * Es el que tiene enlazada la acción «elegir el segundo producto». Se busca
 * entre las burbujas de la oferta —las mismas que mira `decisionDeLaOfertaDelExtra`—
 * y solo en la modalidad activa (regla 5-bis).
 */
function cuadritoQueAceptaElExtra(
  config: WorkflowConfig | null
): BubbleDecision | null {
  const up = seccionUpsell(config);
  if (!up) return null;
  const burbujas = [
    ...(Array.isArray(up.pregunta_steps) ? up.pregunta_steps : []),
    // AQUÍ SE MIRAN TODOS LOS CAJONES, NO SOLO EL SORTEADO.
    //
    // Esto no envía nada: busca a qué cuadrito de decisión corresponde lo que
    // acaba de escribir el cliente. Mirando solo el cajón que le tocó, un botón
    // escrito en otro no se reconocería — y el cliente ya lo tiene delante si le
    // salió esa versión. Se aceptan los de todos.
    ...(up.intro_groups ?? []).flatMap((g) => g.steps ?? []),
    ...(Array.isArray(up.intro) ? up.intro : []),
  ].filter((paso) => (paso as { enabled?: boolean }).enabled !== false);
  for (const paso of burbujas) {
    const suyo = ((paso as { decisions?: BubbleDecision[] }).decisions ?? []).find(
      (decision) =>
        decision.enabled !== false &&
        decision.action === "choose_upsell" &&
        // Con las burbujas apagadas no hay texto suyo que respetar: este
        // cuadrito no es «el que trae lo que él escribió».
        tieneBurbujasEncendidas(decision.steps)
    );
    if (suyo) return suyo;
  }
  return null;
}

/**
 * ACEPTAR EL EXTRA CON LO QUE ESCRIBIÓ EL OPERADOR, VENGA POR DONDE VENGA.
 *
 * Hay CUATRO puertas para aceptar el segundo producto: el botón, el nombre del
 * producto escrito, el «sí» a secas y el marcador <<QUIERE_EXTRA>> del modelo.
 * Las tres primeras pasan por el cuadrito de la oferta y mandan lo que el
 * operador escribió. La cuarta no: llamaba directo a los datos de fábrica.
 *
 * Lo que se veía: el operador escribe sus tres burbujas —con SU cuenta y el
 * nombre del extra— y al cliente que acepta hablando con el modelo le llegan
 * las de siempre, que hablan del producto que YA compró («puedes adquirir el
 * curso…»). El mismo trabajo escrito y tirado según por dónde entrara el sí.
 *
 * Sin cuadrito armado no cambia nada: salen los datos de fábrica, como hoy.
 */
export async function aceptarElExtraComoLoEscribioElDueno(
  convo: ConversationRow
): Promise<void> {
  const config = loadWorkflowConfig();
  const cuadrito = config ? cuadritoQueAceptaElExtra(config) : null;
  if (!config || !cuadrito) {
    await entregarDatosDePagoDelUpsell(convo);
    return;
  }
  const yaMandoLosDatos = await responderConElCuadritoDelExtra(
    convo,
    cuadrito,
    config
  );
  // Sus burbujas SON la respuesta: queda anotado que aceptó —de ahí salen el
  // precio contra el que se valida el comprobante y el producto que se
  // entrega— pero no se mandan las de fábrica encima.
  if (!yaMandoLosDatos) {
    await entregarDatosDePagoDelUpsell(convo, { enviarDatos: false });
  }
  console.log(
    `[wf:upsell] convo ${convo.id}: aceptado con «${cuadrito.title || "su cuadrito"}»`
  );
}

/**
 * RETOMA LA INTRO donde se quedó esperando una respuesta.
 *
 * Una burbuja con botones detiene la intro: sin eso, las burbujas siguientes
 * seguirían cayendo mientras el cliente decide, y la respuesta a su elección
 * llegaría metida en medio de ellas.
 *
 * Se llama desde tres sitios —el botón, un mensaje escrito y el plazo— porque
 * ninguno de los tres puede dejar la conversación detenida para siempre.
 */
export async function reanudarIntroSiEstabaEnPausa(
  convoId: number,
  /**
   * Lo que el cliente acaba de escribir, SOLO cuando retoma por haber escrito.
   *
   * Se pasa nada más desde ahí. Al vencer el plazo no hay mensaje, y tocar un
   * botón o acertar un cuadrito es una elección, no un nombre: pasarlo en esos
   * casos guardaría «combo» o «yape» como nombre del cliente.
   */
  mensajeDelCliente?: string
): Promise<boolean> {
  const convo = getConversationById(convoId);
  const desde = convo?.intro_paused_index;
  if (!convo || typeof desde !== "number" || desde < 0) return false;
  const config = loadWorkflowConfig();
  if (!config) return false;
  // Se limpia ANTES de programar: si algo fallara al programar, la conversación
  // no queda marcada como "en pausa" para siempre, esperando algo que ya nadie
  // va a mandar.
  setIntroPausedIndex(convoId, null);
  cancelPendingActionsByTypeForConvo(convoId, ACTION_INTRO_REANUDAR);
  const { pasos, variant } = pasosDeIntroDeLaConversacion(convo, config);
  // SI LA BURBUJA QUE PREGUNTÓ PEDÍA EL NOMBRE, ESTO ES EL NOMBRE.
  //
  // La burbuja que preguntó es la ANTERIOR a la marca: la marca guarda por
  // dónde retomar, así que la pregunta quedó un paso atrás.
  //
  // Se usa el MISMO lector que el saludo. Tener aquí una segunda forma de sacar
  // el nombre daría dos resultados distintos para la misma frase según por
  // dónde entrara, y ese nombre acaba en el CRM y en Meta.
  const laQuePregunto = desde > 0 ? pasos[desde - 1] : undefined;
  if (laQuePregunto?.capturar_nombre === true && mensajeDelCliente?.trim()) {
    const nombre = extractNameFromMessage(mensajeDelCliente);
    if (nombre) {
      setClientName(convoId, nombre);
      console.log(
        `[wf] nombre capturado para convo ${convoId} en la intro: "${nombre}"`
      );
    }
  }
  if (desde >= pasos.length) {
    console.log(
      `[wf] convo ${convoId}: la intro estaba en pausa al final, no queda nada que retomar`
    );
    return false;
  }
  programarPasosDeIntro(
    convoId,
    pasos,
    desde,
    variant,
    (convo.commercial_sales_route === "B" ? "B" : "A")
  );
  console.log(
    `[wf] convo ${convoId}: intro retomada desde el paso ${desde} (${pasos.length - desde} pendientes)`
  );
  return true;
}

/**
 * A HUMANO PORQUE A SU PAÍS LE FALTA UNA PIEZA — solo con el respaldo entre países apagado.
 *
 * Lo pidió el dueño el 16/10/2026: mejor que lo atienda él que mandarle a un argentino la intro
 * de Perú «con sus condiciones al final». Es el MISMO camino que «país apagado» (más arriba en
 * `tryWorkflowOnIncoming`): modo humano y acciones pendientes canceladas. La diferencia es que
 * aquí NO se le escribe nada al cliente —su país sí vende, solo falta contenido— y al dueño
 * SÍ se le avisa, porque es un hueco que tiene que llenar.
 */
async function aHumanoPorqueFaltaLaPiezaDeSuPais(
  convo: ConversationRow,
  config: WorkflowConfig,
  pieza: string,
  /** Lo que falta es la de SU TIENDA, no la de su país (17/10/2026). Solo cambia el aviso. */
  porTienda = false
): Promise<void> {
  const pais = getEffectiveCountryCode(convo.phone, config) || "sin país";
  setMode(convo.id, "HUMAN");
  cancelPendingActionsForConvo(convo.id);
  console.log(
    porTienda
      ? `[wf:tienda] convo ${convo.id}: su tienda (${laTiendaQueAtiende() ?? "?"}) no tiene ${pieza} propia y el respaldo entre tiendas está apagado -> HUMANO`
      : `[wf:pais] convo ${convo.id}: ${pais} no tiene ${pieza} propia y el respaldo está apagado -> HUMANO`
  );
  try {
    await notifyAdmin(
      porTienda
        ? `⚠ Un cliente pasó a HUMANO: su tienda no tiene ${pieza} propia y el respaldo entre tiendas está apagado. Conversación ${convo.id}.`
        : `⚠ Un cliente de ${pais} pasó a HUMANO: su país no tiene ${pieza} y el respaldo entre países está apagado. Conversación ${convo.id}.`
    );
  } catch (err) {
    console.error(`[wf:pais] convo ${convo.id}: no pude avisar al dueño:`, err);
  }
}

async function scheduleIntroSequence(convoId: number): Promise<void> {
  const config = loadWorkflowConfig();
  if (!config) return;
  const convo = getConversationById(convoId);
  setConversationState(convoId, "intro_running");
  const now = Math.floor(Date.now() / 1000);
  let cumulativeDelay = 0;
  const chosen = chooseIntroSequence(config, convo, convo?.intro_variant_sent);
  const steps = chosen.steps;
  const variant = chosen.variant;
  setIntroVariantSent(convoId, variant);
  // Su camino, si todavía no lo tenía anotado (18/10/2026). Si ya lo tenía, no se toca: un
  // cliente no cambia de camino a mitad de conversación. Ver `etiqueta-de-camino.ts`.
  if (convo && !convo.camino) setCaminoDeLaConversacion(convoId, config.intro_caminos?.[variant - 1] ?? null);
  const commercialRoute = configuredCommercialRoute(convo, config);
  setCommercialSalesRoute(convoId, commercialRoute);
  const introStepsToSend =
    commercialRoute === "B"
      ? steps.slice(0, Math.max(0, steps.length - routeBReplaceLastIntroSteps(config)))
      : steps;

  programarPasosDeIntro(
    convoId,
    introStepsToSend,
    0,
    variant,
    commercialRoute
  );
  // Mismo criterio que arriba: lo apagado no espera. Contándolo, el cierre de
  // la ruta B salía muchísimo después de la última burbuja que se vio.
  cumulativeDelay = introStepsToSend.reduce(
    (suma, paso) =>
      paso.enabled === false ? suma : suma + (paso.delay_after_sec ?? 0),
    0
  );
  if (commercialRoute === "B") {
    scheduleAction(
      convoId,
      ACTION_SEND_INTRO_STEP,
      {
        step_index: 0,
        is_last: true,
        variant,
        commercial_sales_route: commercialRoute,
        skip_intro_step: true,
      },
      now + cumulativeDelay
    );
  }
  console.log(
    `[wf] intro programado para convo ${convoId} (${introStepsToSend.length}/${steps.length} pasos, intro ${variant}, ruta ${commercialRoute})`
  );
}

/**
 * Ejecuta una acción programada que ya venció.
 */
/**
 * Las acciones programadas (seguimientos, pasos de intro, pasos de pago) salen
 * del worker HORAS despues, cuando ya no hay un webhook delante que diga por
 * que numero contestar. Asi que el numero se recupera de la propia conversacion
 * y se fija antes de ejecutar nada.
 *
 * Sin numero guardado (conversaciones anteriores a esta columna, u otros
 * canales) el contexto queda vacio y se usa el numero activo: identico a antes.
 */
export async function executeAction(action: ScheduledActionRow): Promise<void> {
  const convo = getConversationById(action.conversation_id);
  // La intro y los seguimientos salen desde aqui, fuera de la peticion del
  // simulador. Sin esto, una prueba en Doble Oferta habria recibido la intro
  // de la modalidad que esta vendiendo de verdad.
  //
  // `test_modality` solo existe en conversaciones del simulador: en una real
  // es null y no se envuelve nada, asi que el camino queda identico al de hoy.
  // Y CON LA PRESENTACIÓN DE ESA CONVERSACIÓN, por el mismo motivo que la
  // modalidad de prueba: estas burbujas salen HORAS después, cuando el dueño
  // puede haber movido el selector «PRESENTA:» tres veces. La intro y los
  // seguimientos de un cliente tienen que seguir hablándole de lo que se le
  // prometió, no de lo que se vende ahora.
  //
  // Vacío = el selector de hoy, igual que arriba: las conversaciones de antes de
  // este cambio no tienen presentación anotada y el camino les queda idéntico.
  // Y CON SU TIENDA, por el mismo motivo que la presentación: estas burbujas
  // salen horas después, y para entonces el dueño puede tener otras tiendas o
  // haberle cambiado la semimodalidad a la suya. Un seguimiento tiene que seguir
  // hablándole de lo que se le prometió, y de la tienda por la que entró.
  return withModalidadDePrueba(convo?.test_modality ?? null, () =>
    conElTurnoDe(convo, () =>
      withOutboundWhatsAppNumber(convo?.wa_phone_number_id ?? null, () =>
        // Y POR SU PAGINA, si entro por Messenger. El gemelo del de arriba: sin
        // esto, con dos paginas conectadas la mitad de los seguimientos saldrian
        // por la pagina que no es, porque aqui ya no esta el webhook delante.
        withOutboundMessengerPage(convo?.messenger_page_id ?? null, () =>
          executeActionInner(action)
        )
      )
    )
  );
}

async function executeActionInner(action: ScheduledActionRow): Promise<void> {
  const convo = getConversationById(action.conversation_id);
  if (!convo) {
    console.warn(`[wf] acción ${action.id}: convo ${action.conversation_id} no existe`);
    return;
  }
  if (convo.mode !== "AI") {
    console.log(
      `[wf] acción ${action.id}: convo en modo HUMAN, saltando`
    );
    return;
  }

  const runtimeChannel =
    convo.channel === "test" ? convo.test_channel ?? "whatsapp" : convo.channel;
  if (getActiveWorkflowChannel() !== runtimeChannel) {
    return withWorkflowChannel(runtimeChannel, () => executeAction(action));
  }

  if (action.action_type === ACTION_MESSENGER_COUNTRY_REMINDER) {
    const setting = loadWorkflowConfig()?.messenger_country_prompt;
    const needsCountry =
      convo.channel === "messenger" ||
      convo.channel === "instagram" ||
      (convo.channel === "test" && convo.test_channel === "messenger");
    if (
      setting?.enabled !== true ||
      setting.reminder_enabled !== true ||
      !needsCountry ||
      !!convo.country_code ||
      convo.state !== "new"
    ) {
      console.log(
        `[messenger] recordatorio de país omitido para convo ${convo.id}`
      );
      return;
    }
    await sendBotText(convo, getMessengerCountryReminderMessage());
    console.log(`[messenger] recordatorio de país enviado a convo ${convo.id}`);
    return;
  }

  // AQUÍ HABÍA UN «RESCATE DE LA INTRO», Y SE BORRA.
  //
  // Era el temporizador de cinco minutos: si el cliente no contestaba al saludo,
  // soltaba la intro por su cuenta. Existía porque el bot se quedaba parado
  // esperando esa respuesta.
  //
  // Ya no se para, así que no hay nada que rescatar. Las acciones que quedaran
  // apuntadas en la cola de un cliente viejo caen en el «tipo desconocido» de
  // abajo y se descartan sin hacer nada.

  if (action.action_type === ACTION_SEND_INTRO_STEP) {
    const payload = JSON.parse(action.payload) as SendIntroStepPayload;
    const config = loadWorkflowConfig();
    if (!config) {
      console.warn(`[wf] acción ${action.id}: config no disponible`);
      return;
    }
    const introSeq =
      payload.variant === 3 && Array.isArray(config.intro_sequence_3)
        ? config.intro_sequence_3
        : payload.variant === 2 && Array.isArray(config.intro_sequence_2)
          ? config.intro_sequence_2
          : typeof payload.variant === "number" &&
              payload.variant >= 4 &&
              Array.isArray(config.intro_extra_sequences?.[payload.variant - 4])
            ? config.intro_extra_sequences[payload.variant - 4]
            : config.intro_sequence;
    const step = introSeq[payload.step_index];
    if (!payload.skip_intro_step && !step) {
      console.warn(
        `[wf] acción ${action.id}: step_index ${payload.step_index} fuera de rango`
      );
      return;
    }
    if (!payload.skip_intro_step && step) {
      console.log(
        `[wf] enviando intro step ${payload.step_index} (${step.type}) a convo ${convo.id}`
      );
    }
    const introPrice =
      lockPaymentPrice(
        convo,
        getEffectivePriceSoles(
          isDiscountActiveForConversation(convo, config),
          convo.phone
        ),
        "base",
        config
      ) ?? getLockedOrCurrentBasePrice(convo, config);
    // Si la burbuja está APAGADA (enabled === false), no la enviamos — pero el
    // is_last sigue su curso (intro_done + menú de pago del intro).
    if (!payload.skip_intro_step && step && step.enabled !== false) {
      const introVariantSeed =
        config.intro_variant_rotation_enabled !== false
          ? convo.id * 1000 + (payload.variant ?? 1) * 100 + payload.step_index
          : undefined;
      if ((step.buttons?.length ?? 0) > 0) {
        await sendResponseStep(convo, step, introPrice, true);
      } else if (step.type === "text") {
        const introText =
          pickVariant(step.body_variants, step.body, introVariantSeed) ?? "";
        if (introText.trim())
          await sendBotText(
            convo,
            applyPriceTemplate(
              renderOrderBumpTemplate(
                introText,
                isDiscountActiveForConversation(convo, config),
                convo.phone
              ),
              introPrice,
              convo
            )
          );
      } else {
        const introCaption = pickVariant(
          step.caption_variants,
          step.caption,
          introVariantSeed
        );
        await sendBotMediaFromDrive(
          convo,
          step.type,
          step.drive_url,
          introCaption
            ? applyPriceTemplate(
                renderOrderBumpTemplate(
                  introCaption,
                  isDiscountActiveForConversation(convo, config),
                  convo.phone
                ),
                introPrice,
                convo
              )
            : introCaption
        );
      }
    }
    // LA INTRO SE DETIENE EN UNA BURBUJA CON BOTONES.
    //
    // Sin esto, las burbujas siguientes seguirían cayendo mientras el cliente
    // decide, y lo que conteste su elección llegaría metido en medio de ellas.
    // La intro se retoma al tocar un botón, al escribir cualquier cosa, o al
    // vencer el plazo — tres salidas, para que nadie quede detenido.
    //
    // Solo si NO es la última: en la última no hay nada que detener, y ahí los
    // botones son el cierre de la intro, que ya tiene su propio camino.
    if (
      !payload.is_last &&
      !payload.skip_intro_step &&
      step &&
      step.enabled !== false &&
      // Solo cuentan las decisiones ENCENDIDAS: con todas apagadas, la burbuja
      // vuelve a ser una burbuja normal y la intro sale de corrido. Si aquí se
      // contaran todas, la conversación esperaría una respuesta que ningún
      // cuadrito va a reconocer.
      //
      // Y pedir el nombre TAMBIÉN detiene. No lleva cuadritos —un nombre es
      // texto libre y no hay palabra clave que lo reconozca—, así que sin esto
      // la burbuja preguntaría el nombre y seguiría de largo sin esperarlo.
      ((step.buttons?.length ?? 0) > 0 ||
        decisionesEncendidas(step.decisions).length > 0 ||
        step.capturar_nombre === true)
    ) {
      cancelPendingActionsByTypeForConvo(convo.id, ACTION_SEND_INTRO_STEP);
      setIntroPausedIndex(convo.id, payload.step_index + 1);
      // CADA BURBUJA CON SU PLAZO.
      //
      // Era uno solo para todas. Una pregunta de «sí o no» se contesta en
      // segundos y otra que obliga a pensar merece más, así que el número
      // global salía corto para una y eterno para la otra.
      //
      // Vacío o mal puesto = los 3 minutos de siempre, que es lo que hacían
      // todas hasta ahora.
      const suPlazo = step.espera_eleccion_minutos;
      const espera =
        typeof suPlazo === "number" && Number.isFinite(suPlazo) && suPlazo > 0
          ? Math.round(suPlazo * 60)
          : ESPERA_DE_ELECCION_EN_INTRO_SEGUNDOS;
      scheduleAction(
        convo.id,
        ACTION_INTRO_REANUDAR,
        {},
        Math.floor(Date.now() / 1000) + espera
      );
      console.log(
        `[wf] convo ${convo.id}: intro en pausa tras el paso ${payload.step_index} (espera una elección ${espera}s)`
      );
      return;
    }
    if (payload.is_last) {
      if (payload.commercial_sales_route === "B") {
        setConversationState(convo.id, "payment_done");
        try {
          await sendCommercialRouteBIntroClosing(convo);
        } catch (err) {
          console.error("[wf] error enviando cierre directo ruta B:", err);
        }
        console.log(`[wf] intro completado (ruta B) para convo ${convo.id}`);
        return;
      }
      // Modalidad Doble Oferta 2 Productos: al terminar la intro, en vez del
      // menú de pago normal, soltamos la elección (básico/combo) — SIN 2ª intro
      // ni pedir nombre — y esperamos que elija para ir directo al pago.
      if (isDobleOfertaActive()) {
        try {
          await presentDobleOfertaAndWaitForChoice(convo);
        } catch (err) {
          console.error("[wf] error enviando elección de doble oferta:", err);
        }
        console.log(
          `[wf] intro completado (doble oferta) para convo ${convo.id}`
        );
        return;
      }
      // Modalidad Doble Oferta (bioferta): al terminar la intro soltamos las 3
      // opciones (producto A / producto B / pack) para que elija antes de pagar.
      // Solo si la modalidad está activa y los 3 nombres están configurados.
      if (shouldOfferBiofertaChoiceOnIntro(loadWorkflowConfig())) {
        try {
          await presentBiofertaIntroChoiceAndWait(convo);
        } catch (err) {
          console.error(
            "[wf] error enviando elección de doble oferta (bioferta):",
            err
          );
        }
        console.log(
          `[wf] intro completado (doble oferta 3 opciones) para convo ${convo.id}`
        );
        return;
      }
      // LA INTRO NO PUEDE HACER RETROCEDER UNA VENTA QUE YA AVANZÓ.
      //
      // Esto ponía `intro_done` a secas. Y el cliente no espera a que la intro
      // termine para contestar: mientras siguen cayendo burbujas escribe
      // «yape», el motor le manda la cuenta y deja la venta esperando el
      // comprobante… y unos segundos después el último paso de la intro la
      // devolvía a `intro_done`. La venta se reabría sola, sin una línea en el
      // log, y con ella volvían las respuestas rápidas de la etapa anterior.
      //
      // No es de un camino: afecta a los quince que cierran una venta, porque
      // todos pueden ocurrir con la intro todavía en marcha.
      //
      // Se relee la conversación porque la copia de esta acción se cargó al
      // programarla, antes de todo eso.
      const alTerminarLaIntro = getConversationById(convo.id) ?? convo;
      if (laVentaTodaviaNoLlegoAlPago(alTerminarLaIntro.state)) {
        setConversationState(convo.id, "intro_done");
      } else {
        console.log(
          `[wf] convo ${convo.id}: la intro terminó, pero la venta ya iba por "${alTerminarLaIntro.state}" → no la hago retroceder`
        );
      }
      console.log(`[wf] intro completado para convo ${convo.id}`);
      // Menú de pago del intro (foto/video + texto + botones), como cierre del
      // intro si está activado. Reutiliza el mismo helper de los seguimientos.
      const introMenu = loadWorkflowConfig()?.intro_payment_menu;
      if (introMenu?.enabled) {
        try {
          await sendFollowupPaymentMenu(convo, introMenu);
        } catch (err) {
          console.error("[wf] error enviando menú de pago del intro:", err);
        }
      }
    }
    return;
  }

  // SALIDA 3 DE 3: se acabó el plazo y nadie contestó. La intro sigue sin la
  // elección, que es lo que corresponde: la pregunta era opcional y el resto de
  // la intro no lo es.
  if (action.action_type === ACTION_INTRO_REANUDAR) {
    const retomada = await reanudarIntroSiEstabaEnPausa(convo.id);
    if (retomada) {
      console.log(
        `[wf] convo ${convo.id}: nadie eligió en ${ESPERA_DE_ELECCION_EN_INTRO_SEGUNDOS}s, sigo con la intro`
      );
    }
    return;
  }

  if (action.action_type === ACTION_EXIT_AWAITING_EMAIL) {
    // Acción legacy de un modelo previo. Si quedó alguna pendiente en BD,
    // la consumimos sin hacer nada — el nuevo modelo programa el gift
    // directamente al final de payment_approved_sequence.
    console.log(
      `[wf] acción legacy exit_awaiting_email ${action.id} ignorada`
    );
    return;
  }

  if (action.action_type === ACTION_SEND_GIFT_CONSENT) {
    const config = loadWorkflowConfig();
    const gift = config?.gift_mechanic;
    if (!gift || sectionHasPlaceholder(gift)) {
      console.warn(
        `[wf] acción ${action.id}: gift_mechanic no listo, salteo consent`
      );
      return;
    }
    // No mandar si la convo ya pasó a otra etapa (ej. /restart).
    if (
      convo.state !== "payment_approved" &&
      convo.state !== "awaiting_email" &&
      convo.state !== "awaiting_gift_consent"
    ) {
      console.log(
        `[wf] acción ${action.id}: state es ${convo.state}, no envío gift consent`
      );
      return;
    }
    // NUEVO: si la pregunta de consentimiento tiene SECUENCIA con pasos
    // activos (texto/imagen/audio/video), la programamos paso a paso (mismo
    // mecanismo que la secuencia de aceptar). El estado pasa a
    // awaiting_gift_consent en el ÚLTIMO paso. Si NO hay secuencia → fallback
    // al texto único de siempre (comportamiento idéntico al anterior).
    const between =
      config?.between_messages_delay_seconds ?? DEFAULT_BETWEEN_MESSAGES_DELAY;
    const activeConsentSteps = gift.consent_sequence
      ?.map((step, index) => ({ step, index }))
      .filter(
        ({ step }) =>
          step.enabled !== false &&
          (step.type === "text"
            ? !!pickVariant(step.body_variants, step.body)?.trim()
            : !!step.drive_url?.trim())
      );
    if (activeConsentSteps?.length) {
      const now = Math.floor(Date.now() / 1000);
      let offset = 0;
      activeConsentSteps.forEach(({ step, index }, activeIndex) => {
        scheduleAction(
          convo.id,
          ACTION_SEND_GIFT_CONSENT_STEP,
          {
            step_index: index,
            is_last: activeIndex === activeConsentSteps.length - 1,
          } satisfies SendGiftStepPayload,
          now + offset
        );
        offset += Math.max(0, step.delay_after_sec ?? between);
      });
      console.log(
        `[wf] secuencia de consent (${activeConsentSteps.length} pasos) programada para convo ${convo.id}`
      );
      return;
    }
    // APAGAR TODAS LAS BURBUJAS TAMBIÉN APAGA EL TEXTO VIEJO.
    //
    // `consent_question` es el campo de antes de que existieran las burbujas.
    // Si hay secuencia configurada y está toda apagada, apagarla fue una
    // decisión: mandar igual ese texto contradice lo que se ve en pantalla.
    // Sin secuencia (configuraciones antiguas) se conserva tal cual.
    const haySecuenciaDeConsent = (gift.consent_sequence?.length ?? 0) > 0;
    await presentChoiceAndWait(convo, "awaiting_gift_consent", async () => {
      if (!haySecuenciaDeConsent) await sendBotText(convo, gift.consent_question);
      await sendGiftConsentButtonsIfEnabled(convo, gift);
    });
    console.log(
      `[wf] consent del regalo enviado a convo ${convo.id} → awaiting_gift_consent`
    );
    return;
  }

  if (action.action_type === ACTION_SEND_GIFT_CONSENT_STEP) {
    const payload = JSON.parse(action.payload) as SendGiftStepPayload;
    const gift = loadWorkflowConfig()?.gift_mechanic;
    const sequence = gift?.consent_sequence;
    const step = sequence?.[payload.step_index];
    if (!gift || !sequence || !step || step.enabled === false) return;
    // El consent va ANTES de que el cliente decida → estados válidos (igual
    // que el camino del texto único: payment_approved / awaiting_email).
    // awaiting_gift_consent también se permite por si un paso anterior ya lo fijó.
    if (
      convo.state !== "payment_approved" &&
      convo.state !== "awaiting_email" &&
      convo.state !== "awaiting_gift_consent"
    ) {
      console.log(
        `[wf] acción ${action.id}: state es ${convo.state}, no envío gift consent step`
      );
      return;
    }
    if (step.type === "text") {
      const textStep = step as { body?: string; body_variants?: string[] };
      const text = pickVariant(textStep.body_variants, textStep.body);
      if (text?.trim()) await sendBotText(convo, text);
    } else {
      const caption = pickVariant(step.caption_variants, step.caption);
      if (step.type === "audio") {
        await sendBotMediaFromDrive(convo, "audio", step.drive_url);
        if (caption?.trim()) await sendBotText(convo, caption);
      } else {
        await sendBotMediaFromDrive(convo, step.type, step.drive_url, caption);
      }
    }
    if (payload.is_last) {
      await presentChoiceAndWait(convo, "awaiting_gift_consent", async () => {
        await sendGiftConsentButtonsIfEnabled(convo, gift);
      });
      console.log(
        `[wf] secuencia de consent completada para convo ${convo.id} → awaiting_gift_consent`
      );
    }
    return;
  }

  if (action.action_type === ACTION_SEND_GIFT_STEP) {
    const payload = JSON.parse(action.payload) as SendGiftStepPayload;
    const gift = loadWorkflowConfig()?.gift_mechanic;
    const sequence = gift?.ask_sequence;
    const step = sequence?.[payload.step_index];
    if (!gift || !sequence || !step || step.enabled === false) return;
    if (convo.state !== "awaiting_gift_consent") {
      console.log(
        `[wf] acción ${action.id}: state es ${convo.state}, no envío gift step`
      );
      return;
    }

    const enabledTextIndexes = sequence
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.enabled !== false && item.type === "text")
      .map(({ index }) => index);
    const isPriorityText =
      step.type === "text" &&
      payload.step_index === enabledTextIndexes.at(-1);

    if (step.type === "text") {
      const textStep = step as { body?: string; body_variants?: string[] };
      const text = isPriorityText
          ? pickGiftTextByAd(getUsableGiftVariants(gift), convo.ad_source_id) ??
            pickWeightedGiftText(getUsableGiftVariants(gift)) ??
          pickVariant(textStep.body_variants, textStep.body)
        : pickVariant(textStep.body_variants, textStep.body);
      if (text?.trim()) await sendBotText(convo, text);
    } else {
      const caption = pickVariant(step.caption_variants, step.caption);
      if (step.type === "audio") {
        await sendBotMediaFromDrive(convo, "audio", step.drive_url);
        if (caption?.trim()) await sendBotText(convo, caption);
      } else {
        await sendBotMediaFromDrive(
          convo,
          step.type,
          step.drive_url,
          caption
        );
      }
    }

    if (payload.is_last) {
      setConversationState(convo.id, "awaiting_facebook_comment");
      console.log(
        `[wf] secuencia del regalo completada para convo ${convo.id} → awaiting_facebook_comment`
      );
    }
    return;
  }

  if (action.action_type === ACTION_SEND_GIFT_AUDIO) {
    const config = loadWorkflowConfig();
    const gift = config?.gift_mechanic;
    if (!gift || sectionHasPlaceholder(gift)) {
      console.warn(
        `[wf] acción ${action.id}: gift_mechanic no listo, saltando audio`
      );
      return;
    }
    // No enviar si ya cambió de estado (e.g. /restart). El audio del
    // regalo va en awaiting_gift_consent (después de "sí") — los otros
    // estados son legacy compatibility.
    if (
      convo.state !== "payment_approved" &&
      convo.state !== "awaiting_email" &&
      convo.state !== "awaiting_gift_consent"
    ) {
      console.log(
        `[wf] acción ${action.id}: state es ${convo.state}, no envío gift audio`
      );
      return;
    }
    await sendBotMediaFromDrive(convo, "audio", gift.ask_audio_drive_url);
    console.log(`[wf] gift audio enviado a convo ${convo.id}`);
    return;
  }

  if (action.action_type === ACTION_SEND_GIFT_TEXT) {
    const config = loadWorkflowConfig();
    const gift = config?.gift_mechanic;
    if (!gift || sectionHasPlaceholder(gift)) {
      console.warn(
        `[wf] acción ${action.id}: gift_mechanic no listo, saltando texto`
      );
      return;
    }
    if (
      convo.state !== "payment_approved" &&
      convo.state !== "awaiting_email" &&
      convo.state !== "awaiting_gift_consent"
    ) {
      console.log(
        `[wf] acción ${action.id}: state es ${convo.state}, no envío gift texto`
      );
      return;
    }
    // 1º intenta el enlace que corresponde al ANUNCIO del que vino el cliente
    // (match por ad_source_id). Si no hay match, cae al azar ponderado, y si
    // tampoco, al ask_text fijo.
    const giftText =
      pickGiftTextByAd(getUsableGiftVariants(gift), convo.ad_source_id) ??
      pickWeightedGiftText(getUsableGiftVariants(gift)) ??
      gift.ask_text;
    await sendBotText(convo, giftText);
    setConversationState(convo.id, "awaiting_facebook_comment");
    console.log(
      `[wf] gift texto enviado a convo ${convo.id} → awaiting_facebook_comment`
    );
    return;
  }

  if (action.action_type === ACTION_SEND_EMAIL_REMINDER) {
    if (convo.client_email || convo.email_reminder_sent) return;
    // Las burbujas mandan sobre el texto suelto: son lo que se ve y se edita en
    // la pantalla. El texto queda de respaldo para quien no las haya llenado.
    const burbujas = loadWorkflowConfig()?.email_reminder_steps;
    if (await sendConfiguredSteps(convo, burbujas)) {
      setEmailReminderSent(convo.id, true);
      console.log(
        `[wf] recordatorio de correo (burbujas) enviado a convo ${convo.id}`
      );
      return;
    }
    const reminder = getConfiguredEmailReminder(convo);
    if (!reminder) return;
    await sendBotText(convo, reminder);
    setEmailReminderSent(convo.id, true);
    console.log(`[wf] recordatorio unico de correo enviado a convo ${convo.id}`);
    return;
  }

  if (action.action_type === ACTION_SEND_CUSTOMER_SURVEY) {
    if (convo.customer_survey_sent) return;
    if (!convo.gift_rewarded) {
      console.log(
        `[wf] encuesta post-compra omitida para convo ${convo.id}: regalo aun no completado`
      );
      return;
    }
    const config = loadWorkflowConfig();
    const message = getCustomerSurveyMessage(config);
    if (!message) return;
    await sendBotText(convo, applyWhatsAppNameTemplate(message, convo));
    setCustomerSurveySent(convo.id, true);
    if (config?.customer_survey_auto_human_enabled === true) {
      setMode(convo.id, "HUMAN");
      cancelPendingActionsForConvo(convo.id);
      console.log(`[wf] convo ${convo.id} -> HUMANO tras encuesta post-compra`);
    }
    console.log(`[wf] encuesta post-compra enviada a convo ${convo.id}`);
    return;
  }

  if (action.action_type === ACTION_AUTO_SWITCH_HUMAN_AFTER_GIFT_COMMENT) {
    setMode(convo.id, "HUMAN");
    cancelPendingActionsForConvo(convo.id);
    console.log(
      `[wf] convo ${convo.id} -> HUMANO por auto-apagado tras comentario del regalo`
    );
    return;
  }

  if (action.action_type === ACTION_AUTO_SWITCH_HUMAN_AFTER_VENEZUELA_NOTICE) {
    if (convo.state !== "country_notice_pending") return;
    setMode(convo.id, "HUMAN");
    cancelPendingActionsForConvo(convo.id);
    console.log(`[wf:pais] convo ${convo.id} -> HUMANO tras aviso Venezuela`);
    return;
  }

  if (action.action_type === ACTION_SEND_TEXT_CHUNK) {
    const payload = JSON.parse(action.payload) as SendTextChunkPayload;
    if (!payload.body || !payload.body.trim()) return;
    console.log(
      `[wf] enviando text chunk a convo ${convo.id}`
    );
    await sendBotText(convo, payload.body);
    return;
  }

  if (action.action_type === ACTION_SEND_POST_SALE_DELIVERY_STEP) {
    const payload = JSON.parse(action.payload) as SendPostSaleDeliveryStepPayload;
    if (!payload.step || typeof payload.step !== "object") return;
    await sendResponseStep(convo, payload.step, undefined, true);
    return;
  }

  if (action.action_type === ACTION_SEND_DELIVERY_PREFERENCE) {
    const payload = JSON.parse(action.payload) as SendDeliveryPreferencePayload;
    const source =
      normalizeDeliverySource(payload.source) ??
      normalizeDeliverySource(convo.pending_delivery_source);
    if (!source || convo.state !== "awaiting_delivery_preference") return;
    setPendingDeliverySource(convo.id, source);
    const cfg = loadWorkflowConfig();
    const pref = cfg?.post_sale_delivery_preference;
    const promptSteps = Array.isArray(pref?.prompt_steps)
      ? pref.prompt_steps.filter((step) => step.enabled !== false)
      : [];
    const prompt = (pref?.prompt_text ?? "").trim();
    if (pref?.use_buttons === false) {
      if (promptSteps.length > 0) {
        await sendPostSaleDeliverySteps(convo, promptSteps);
      } else if (prompt) {
        await sendBotText(convo, applyWhatsAppNameTemplate(prompt, convo));
      }
    } else {
      if (pref?.separate_bubble === true) {
        if (promptSteps.length > 0) {
          await sendPostSaleDeliverySteps(convo, promptSteps);
        } else if (prompt) {
          await sendBotText(convo, applyWhatsAppNameTemplate(prompt, convo));
        }
      }
      const buttonPrompt =
        pref?.separate_bubble === true ? pref?.buttons_prompt : prompt;
      const cuerpo = cuerpoDeBotones(
        buttonPrompt,
        "preferencia de entrega: pregunta con botones"
      );
      const titulos = titulosDeBotones(
        [pref?.whatsapp_button_label, pref?.email_button_label],
        "preferencia de entrega: nombres de los 2 botones"
      );
      if (!cuerpo || !titulos) {
        // Ya PAGÓ. Dejarlo esperando una pregunta que no se puede mandar sería
        // lo peor que puede pasar aquí, así que le entregamos por WhatsApp —
        // exactamente lo que hace el bot cuando esta pregunta está apagada.
        console.warn(
          `[wf] convo ${convo.id}: no puedo preguntar la preferencia de entrega → entrego por WhatsApp para no dejarlo esperando`
        );
        deliverAfterPreference(convo, source);
        return;
      }
      await sendBotButtons(convo, applyWhatsAppNameTemplate(cuerpo, convo), [
        { id: "delivery_whatsapp", title: titulos[0] },
        { id: "delivery_email", title: titulos[1] },
      ]);
    }
    console.log(`[wf] preferencia de entrega enviada a convo ${convo.id}`);
    return;
  }

  if (action.action_type === ACTION_SEND_PAYMENT_APPROVED_STEP) {
    const payload = JSON.parse(action.payload) as SendPaymentApprovedStepPayload;
    const config = loadWorkflowConfig();
    // La entrega puede venir de la secuencia del producto B o del pack
    // (Bioferta Oferta Doble); por defecto, la payment_approved_sequence.
    const sequence =
      payload.source === "upsell" && typeof payload.fila_producto === "string"
        ? entregaDeLaFila(payload.fila_producto, config)
        : payload.source === "upsell"
        ? seccionUpsell(config)?.delivery
        : payload.source === "bioferta_a"
        ? config?.bioferta_doble?.product_a?.delivery
        : payload.source === "bioferta_b"
        ? config?.bioferta_doble?.product_b?.delivery
        : payload.source === "bioferta_pack"
          ? config?.bioferta_doble?.pack?.delivery
          : payload.source === "ob_combo"
            ? getActiveTwoTierOffer(config)?.combo?.delivery
            : payload.source === "ob_basico"
              ? getActiveTwoTierOffer(config)?.basico?.delivery
              : config?.payment_approved_sequence;
    if (!sequence) {
      console.warn(
        `[wf] acción ${action.id}: secuencia de entrega "${payload.source ?? "approved"}" no definida`
      );
      return;
    }
    const step = sequence[payload.step_index];
    if (!step) {
      console.warn(
        `[wf] acción ${action.id}: payment_approved step_index ${payload.step_index} fuera de rango`
      );
      return;
    }
    if (step.enabled === false) {
      console.log(
        `[wf] payment_approved step ${payload.step_index} apagado, no envio`
      );
      if (payload.is_last) await continuarTrasEntrega(convo);
      return;
    }
    console.log(
      `[wf] enviando payment_approved step ${payload.step_index} (${step.type}) a convo ${convo.id}`
    );
    // Resolvemos comodines de precio igual que en el resto de envíos: {price}/
    // {precio} con el precio de ESTA entrega (según la fuente) y, en las entregas
    // del order bump, también {{precio_1}}/{{precio_2}}/{{precio_extra}}. Antes
    // se enviaban crudos (los comodines salían literales en la entrega).
    const isObDelivery =
      payload.source === "ob_combo" || payload.source === "ob_basico";
    const deliveryPrice =
      payload.source === "upsell"
        ? getUpsellPriceSoles(
            isDiscountActiveForConversation(convo, config),
            convo.phone
          )
        : payload.source === "ob_combo"
        ? getOrderBumpPriceSoles(
            "combo",
            isDiscountActiveForConversation(convo, config),
            convo.phone
          )
        : payload.source === "ob_basico"
          ? getOrderBumpPriceSoles(
              "basico",
              isDiscountActiveForConversation(convo, config),
              convo.phone
            )
          : payload.source === "bioferta_pack"
            ? getBiofertaPriceSoles(
                "pack",
                isDiscountActiveForConversation(convo, config),
                convo.phone
              )
              : getEffectivePriceSoles(
                isDiscountActiveForConversation(convo, config),
                convo.phone
              );
    const renderDelivery = (t: string): string => {
      // EL NOMBRE DEL PRODUCTO ENTREGADO VA PRIMERO, Y NO ES UN CAPRICHO.
      //
      // AQUÍ ESTABA EL FALLO. `applyPriceTemplate` empieza llamando a
      // `applyProductName`, y ésa termina BORRANDO `{{PRODUCTO_ENTREGADO}}` — es
      // su red de seguridad, para que un comodín escrito fuera de una entrega no
      // le salga al cliente con las llaves puestas.
      //
      // Resolviéndolo después, la red ya se lo había llevado: al cliente le
      // llegaba «Entrega para **», con el hueco en medio. Resolviéndolo antes,
      // cuando la red pasa ya no queda nada que borrar.
      let out = aplicarProductoEntregado(
        t,
        payload.source ?? "approved",
        config
      );
      out = applyPriceTemplate(
        out,
        deliveryPrice ??
        getEffectivePriceSoles(
          isDiscountActiveForConversation(convo, config),
          convo.phone
        )
      );
      if (isObDelivery)
        out = renderOrderBumpTemplate(
          out,
          isDiscountActiveForConversation(convo, config),
          convo.phone
        );
      return out;
    };
    if (step.type === "text") {
      const textStep = step as { body?: string; body_variants?: string[] };
      const text = pickVariant(textStep.body_variants, textStep.body) ?? "";
      if (text.trim()) await sendBotText(convo, renderDelivery(text));
    } else {
      const approvedCaption = pickVariant(step.caption_variants, step.caption);
      const renderedCaption = approvedCaption
        ? renderDelivery(approvedCaption)
        : undefined;
      // RED DE SEGURIDAD ANTI-"ESTAFA": esta entrega sale DESPUÉS de que el
      // cliente pagó. Si la media falla (URL de Drive vacía/inválida por un
      // error de config o del panel), NUNCA dejamos al cliente sin nada: si el
      // caption trae el contenido (los enlaces suelen ir ahí), lo mandamos como
      // TEXTO. Además avisamos al admin. Así una media rota no parece estafa.
      try {
        await sendBotMediaFromDrive(
          convo,
          step.type,
          step.drive_url,
          renderedCaption
        );
      } catch (err) {
        console.error(
          `[wf] entrega media falló (step ${payload.step_index}, url="${step.drive_url}"):`,
          err
        );
        if (renderedCaption && renderedCaption.trim()) {
          await sendBotText(convo, renderedCaption);
          console.warn(
            `[wf] convo ${convo.id}: media rota → entregué el caption como TEXTO (fallback anti-estafa)`
          );
        } else {
          console.error(
            `[wf] convo ${convo.id}: media rota y SIN caption — nada que entregar; avisar al admin`
          );
          if (convo.channel !== "test") {
            try {
              await notifyAdmin(
                `⚠️ ENTREGA FALLIDA tras pago: convo ${convo.id} pagó pero la media de entrega no tiene URL válida ni caption. Revisa la config del producto.`
              );
            } catch {
              /* no romper el flujo si la notificación falla */
            }
          }
        }
      }
    }
    if (payload.is_last) {
      // Tras el último paso (pedido de email) toca el cierre postventa: o el
      // upsell, o directamente el regalo. Las dos ramas de `is_last` pasan por
      // la misma función para que no puedan divergir.
      await continuarTrasEntrega(convo);
    }
    return;
  }

  // Toca ofrecer el producto extra: pasaron los minutos de espera.
  //
  // Si algo falla al ofrecerlo, el regalo NO se pierde: se sigue el camino de
  // siempre. Prefiero perder la segunda venta que dejar a la clienta colgada
  // esperando un regalo que ya se ganó.
  if (action.action_type === ACTION_UPSELL_PRESENTAR) {
    const alDia = getConversationById(action.conversation_id);
    if (!alDia) return;
    // Si mientras tanto la conversación avanzó por otro lado —ya se le ofreció,
    // ya compró, ya salió el regalo— no se pisa nada.
    if (alDia.upsell_state && alDia.upsell_state !== "esperando") {
      console.log(
        `[wf:upsell] convo ${alDia.id}: ya no toca ofrecer (${alDia.upsell_state})`
      );
      return;
    }
    try {
      await presentarUpsell(alDia);
    } catch (err) {
      console.error(
        `[wf:upsell] convo ${alDia.id}: no pude ofrecerlo, sigo con el regalo:`,
        err
      );
      seguirConRegalo(alDia.id);
    }
    return;
  }

  // Toca recordarle el extra. Es una línea suya, no la presentación otra vez.
  // Todas las guardas viven dentro, para que las dos puertas que lo programan
  // no tengan que repetirlas: ver `recordarElUpsell`.
  if (action.action_type === ACTION_UPSELL_RECORDATORIO) {
    const alDia = getConversationById(action.conversation_id);
    if (!alDia) return;
    try {
      await recordarElUpsell(alDia);
    } catch (err) {
      // Un recordatorio que falla no puede arrastrar nada: la venta ya está
      // hecha y el regalo sigue su camino.
      console.error(
        `[wf:upsell] convo ${alDia.id}: no pude mandar el recordatorio:`,
        err
      );
    }
    return;
  }

  // Venció el plazo del upsell. Sale el regalo, pero la oferta NO se cierra:
  // si más tarde pide el segundo producto por su nombre, se le vende igual.
  if (action.action_type === ACTION_UPSELL_TIMEOUT) {
    if (convo.upsell_state === "pagado" || convo.upsell_state === "rechazado") {
      return; // ya se resolvió por otro lado
    }
    // ANTES, CON "aceptado", ESTO SE APLAZABA A SÍ MISMO PARA SIEMPRE.
    //
    // La idea era no interrumpir a quien está en mitad del pago. Pero el plazo
    // no se movía con la conversación, así que la única forma de no molestar
    // era volver a aplazarlo… y otra vez, y otra. Quien aceptaba el segundo
    // producto y no llegaba a pagarlo NO RECIBÍA EL REGALO NUNCA. Pasó de
    // verdad, y encima lo destapé yo al mandar este camino por aquí.
    //
    // Ya no hace falta: el plazo se reinicia con CADA mensaje del cliente. Si
    // la acción llegó a ejecutarse es porque hubo silencio de verdad durante
    // todo el plazo — y ahí no se está interrumpiendo nada.
    //
    // La oferta del segundo producto NO se cierra: sigue viva y sigue pagable.
    // UPSELLS EN FILA — EL SILENCIO ANTE EL ÚLTIMO, CON DOWNSELL, TRAE EL DOWNSELL.
    // Solo con la oferta delante sin contestar: quien ya dijo que sí está pagando.
    const cfgDelPlazo = loadWorkflowConfig();
    if (
      convo.upsell_state === "ofrecido" &&
      (await ofrecerElDownsellSiToca(convo, cfgDelPlazo))
    ) {
      return;
    }
    console.log(
      `[wf:upsell] convo ${convo.id}: silencio cumplido (estado ${convo.upsell_state ?? "sin ofrecer"}), suelto el regalo (la oferta sigue viva)`
    );
    // Sale el regalo: la fila no ofrece nada más. Solo con fila puesta.
    if (cfgDelPlazo?.filas_de_upsell?.length) pararLaFila(convo.id);
    seguirConRegalo(convo.id);
    return;
  }

  if (action.action_type === ACTION_START_FOLLOWUP) {
    const payload = JSON.parse(action.payload) as StartFollowupPayload;
    // Toggle global de seguimientos: apagado → no dispara ni los ya agendados.
    if (loadWorkflowConfig()?.followups_enabled === false) {
      console.log(
        `[wf:seguimiento] convo ${convo.id} seguimientos desactivados, no disparo`
      );
      return;
    }
    if (convo.state === "payment_approved") {
      console.log(
        `[wf:seguimiento] convo ${convo.id} ya pagó, no disparo seguimiento ${payload.sequence_index + 1}`
      );
      return;
    }
    const isSeg1 = payload.sequence_index === 0;

    // Check proactivo de ventana 24h Meta: si pasaron mas de 23h53m desde
    // el ultimo mensaje del cliente, NO intentamos enviar porque Meta lo
    // va a rechazar (error 131047). Aplica a todos los seguimientos.
    const checkNowSec = Math.floor(Date.now() / 1000);
    const lastUserMsgAt = getLastUserMessageTime(convo.id);
    if (
      lastUserMsgAt !== null &&
      checkNowSec - lastUserMsgAt >= META_24H_WINDOW_CUTOFF_SEC
    ) {
      const hoursSince = ((checkNowSec - lastUserMsgAt) / 3600).toFixed(1);
      console.log(
        `[wf:24h] convo ${convo.id} lleva ${hoursSince}h sin escribir (>23h53m), cancelo seguimiento ${payload.sequence_index + 1} sin llamar a Meta`
      );
      return;
    }

    // Quiet hours: solo aplica a seg 2 y seg 3. Seg 1 dispara siempre.
    // Si llegamos aqui con run_at en quiet hours es defensividad — no
    // deberia pasar porque scheduleNextFollowup ya filtra al programar.
    // Ademas se respeta el toggle propio de este seguimiento.
    const cfgParaQuiet = loadWorkflowConfig();
    const seqParaQuiet = cfgParaQuiet
      ? followupSequencesFor(
          cfgParaQuiet,
          payload.channel ?? convo.channel,
          payload.modality
        )[payload.sequence_index]
      : undefined;
    const quietHoursEnabled =
      cfgParaQuiet?.followup_schedule?.quiet_hours_enabled !== false &&
      seqParaQuiet?.ignore_quiet_hours !== true;
    if (quietHoursEnabled && !isSeg1 && isQuietHour(checkNowSec)) {
      console.log(
        `[wf:quiet] seguimiento ${payload.sequence_index + 1} de convo ${convo.id} disparo en quiet hours por race condition, descarto`
      );
      return;
    }

    // Engagement check DESACTIVADO temporalmente (reversible):
    // antes saltabamos seg 2/3 si el cliente no respondio al previo.
    // Ahora se mandan a todos. Para revertir, descomenta el bloque.
    // if (!isSeg1 && !hasUserMessageSinceFollowupStart(convo.id)) {
    //   console.log(
    //     `[wf:engagement] convo ${convo.id} no respondio al seguimiento ${payload.sequence_index}, salteo seguimiento ${payload.sequence_index + 1}`
    //   );
    //   return;
    // }

    const config = loadWorkflowConfig();
    if (!config) return;
    const sequences = followupSequencesFor(config, payload.channel ?? convo.channel, payload.modality);
    const seq = sequences?.[payload.sequence_index];
    if (!seq) {
      console.warn(
        `[wf:seguimiento] convo ${convo.id} accion ${action.id}: secuencia ${payload.sequence_index} no existe en config`
      );
      return;
    }
    // La accion pudo haberse creado antes de que el usuario apagara este
    // seguimiento. Revalidamos al ejecutarla para que un OFF nunca active
    // oferta, cambie estado ni programe sus burbujas.
    if (seq.enabled === false) {
      console.log(
        `[wf:seguimiento] convo ${convo.id}: ${seq.name} esta apagado, cancelo accion pendiente`
      );
      return;
    }
    const chosenFollowup = chooseFollowupVariant(
      seq,
      config,
      convo.ad_source_id,
      getEffectiveCountryCode(convo.phone, config),
      convo.camino
    );
    if (!chosenFollowup) {
      console.log(
        `[wf:seguimiento] ${seq.name} no tiene variantes listas, no se envia a convo ${convo.id}`
      );
      return;
    }
    // Si esta secuencia es la que dispara la oferta (config 1-based),
    // activamos el descuento en la convo. A partir de este momento,
    // payment.ts y el system prompt del LLM ven el precio reducido.
    const discountCfg = config?.discount_after_followup;
    if (
      discountCfg &&
      typeof discountCfg.sequence_index === "number" &&
      payload.sequence_index + 1 === discountCfg.sequence_index &&
      !convo.discount_active
    ) {
      activateDiscount(convo.id);
      // ESTA LÍNEA DECÍA UN PRECIO QUE NO ERA, Y LE COSTÓ UNA MAÑANA AL DUEÑO.
      //
      // LO QUE PASÓ — 2 de octubre de 2026. Imprimía `S/.${discountCfg.price_soles}`: un
      // número GLOBAL con el símbolo del sol escrito a mano. En sus tres pruebas en
      // paralelo —Argentina, Argentina y Ecuador— salió «S/.3.5» en las tres, y él lo
      // leyó como el precio que se le iba a cobrar al cliente. No lo era: el precio de
      // verdad sale de la ficha del producto y del país, mucho después.
      //
      // Un registro que dice un importe que nadie va a cobrar es peor que no decir nada:
      // manda a buscar el fallo donde no está. Ahora dice lo que de verdad pasó —que la
      // conversación entra en la etapa de oferta— y deja el precio a quien lo sabe.
      console.log(
        `[wf:descuento] convo ${convo.id} entra en etapa de oferta (el precio sale de la ficha y del país de cada cliente)`
      );
    }
    const now = Math.floor(Date.now() / 1000);
    /* UNA BURBUJA APAGADA NO ESPERA — LO MISMO QUE YA HACEN LAS INTROS.
     *
     * LO QUE PASÓ — 28 de septiembre de 2026. El dueño preguntó por qué sus
     * seguimientos tardaban, y al medirlo con su contenido salió esto:
     *
     *     segundo  0   paso 0  imagen   apagado
     *     segundo  6   paso 1  imagen   apagado
     *     segundo  9   paso 2  texto    SALE
     *     segundo 12   paso 3  imagen   apagado
     *     segundo 15   paso 4  video    apagado
     *     segundo 18   paso 5  texto    apagado
     *     segundo 24   paso 6  texto    SALE
     *
     *     salen 2 de 7 · la tanda ocupa 29s · 21s los gastan burbujas APAGADAS
     *
     * Su primera burbuja visible llegaba al segundo 9 en vez de al 0. Con sus
     * palabras: «¿por qué tiene que esperar el tiempo de las burbujas apagadas?».
     *
     * Y NO ERA UNA REGRESIÓN: este arreglo existe desde hace días, pero vive en
     * `programarPasosDeIntro` —la que programa la INTRO— y los seguimientos
     * tienen su propio programador, que nunca se tocó. La misma regla escrita en
     * dos sitios, arreglada en uno: la trampa de siempre de este proyecto.
     *
     * SE MIRARON LOS ONCE SITIOS que programan burbujas. Diez ya descartan las
     * apagadas ANTES de contar el tiempo —el cierre de la ruta B, el regalo, las
     * del upsell, la respuesta al elegir, el pago directo—. Este era el único que
     * faltaba.
     *
     * NO CAMBIA NADA DE LO QUE SE ENVÍA. Los índices siguen siendo los de siempre
     * —el envío lee la burbuja por su número— así que apagar y encender no
     * descoloca nada. Lo único que desaparece es el tiempo muerto.
     */
    const aEnviar: number[] = [];
    for (let i = 0; i < chosenFollowup.steps.length; i++) {
      if (chosenFollowup.steps[i]?.enabled !== false) aEnviar.push(i);
    }
    /* EL «is_last» PASA A LA ÚLTIMA ENCENDIDA.
     *
     * No es solo la última burbuja: es la que marca el seguimiento como enviado y
     * la que suelta el menú de pago del seguimiento y la elección de doble oferta.
     * Antes la llevaba la última de la LISTA, encendida o no —está puesto a
     * propósito y se conserva—; ahora la lleva la última que de verdad sale, que
     * es el mismo momento sin el tiempo muerto de por medio.
     */
    const ultima = aEnviar[aEnviar.length - 1];
    let cumulativeDelay = 0;
    for (const i of aEnviar) {
      const stepPayload: SendFollowupStepPayload = {
        sequence_index: payload.sequence_index,
        channel: payload.channel,
        modality: payload.modality,
        variant_index: chosenFollowup.variantIndex,
        step_index: i,
        is_last: i === ultima,
      };
      scheduleAction(
        convo.id,
        ACTION_SEND_FOLLOWUP_STEP,
        stepPayload as unknown as Record<string, unknown>,
        now + cumulativeDelay
      );
      cumulativeDelay += chosenFollowup.steps[i].delay_after_sec ?? 0;
    }
    /* TODAS APAGADAS: EL CIERRE TIENE QUE OCURRIR IGUAL.
     *
     * Es la red que ya tienen las intros, y aquí hace falta por lo mismo: si no se
     * programa ninguna, nadie marca el seguimiento como enviado ni suelta el menú
     * de pago, y la secuencia se queda a medias en silencio. Hoy eso no pasa
     * porque se programan todas; sin esta red, apagarlas todas lo rompería.
     *
     * No envía nada —el envío mira el interruptor— solo lleva el «is_last».
     */
    if (aEnviar.length === 0 && chosenFollowup.steps.length > 0) {
      const cierrePayload: SendFollowupStepPayload = {
        sequence_index: payload.sequence_index,
        channel: payload.channel,
        modality: payload.modality,
        variant_index: chosenFollowup.variantIndex,
        step_index: chosenFollowup.steps.length - 1,
        is_last: true,
      };
      scheduleAction(
        convo.id,
        ACTION_SEND_FOLLOWUP_STEP,
        cierrePayload as unknown as Record<string, unknown>,
        now
      );
    }
    // Marcar este momento como milestone: el proximo seguimiento solo
    // disparara si el cliente respondio DESPUES de este timestamp.
    // Tambien actualizamos last_followup_index para que cuando llegue un
    // mensaje del cliente sepamos cual seguimiento toca agendar (N+1).
    setLastFollowupStartedAt(convo.id, now);
    setLastFollowupIndex(convo.id, payload.sequence_index);
    // Si el cliente YA había elegido una opción, el seguimiento (que muestra el
    // precio del básico/oferta) deja esa elección "vencida": al elegir método de
    // pago tras el seguimiento le recordaremos las 2 opciones en vez de soltar el
    // precio viejo (que podría no coincidir con el de la oferta y generar duda).
    if (convo.order_bump_choice) setOrderBumpChoiceStale(convo.id, true);
    console.log(
      `[wf:seguimiento] arranca ${chosenFollowup.name} en convo ${convo.id} (${chosenFollowup.steps.length} pasos, milestone+indice actualizados)`
    );
    // MODELO NUEVO: ya NO encadenamos aqui. Los 3 seguimientos se programaron
    // por adelantado (scheduleFollowupSequences) a minutos fijos desde el
    // primer mensaje, por eso quitamos la llamada a scheduleNextFollowup.
    return;
  }

  if (action.action_type === ACTION_SEND_FOLLOWUP_STEP) {
    const payload = JSON.parse(action.payload) as SendFollowupStepPayload;
    if (loadWorkflowConfig()?.followups_enabled === false) return;
    if (convo.state === "payment_approved") {
      console.log(
        `[wf:seguimiento] convo ${convo.id} ya pagó, salteo step pendiente`
      );
      return;
    }
    const config = loadWorkflowConfig();
    if (!config) return;
    const seq = followupSequencesFor(
      config,
      payload.channel ?? convo.channel,
      payload.modality
    )[payload.sequence_index];
    if (!seq) {
      console.warn(
        `[wf:seguimiento] convo ${convo.id} accion ${action.id}: secuencia ${payload.sequence_index} no existe ya`
      );
      return;
    }
    if (seq.enabled === false) {
      console.log(
        `[wf:seguimiento] convo ${convo.id}: ${seq.name} está apagado, no envío`
      );
      return;
    }
    const selectedFollowup = resolveFollowupVariant(seq, payload.variant_index);
    if (!selectedFollowup) {
      console.warn(
        `[wf:seguimiento] convo ${convo.id}: variante ${payload.variant_index} no disponible en ${seq.name}`
      );
      return;
    }
    const step = selectedFollowup.steps[payload.step_index];
    if (!step) {
      console.warn(
        `[wf:seguimiento] convo ${convo.id}: step ${payload.step_index} fuera de rango en ${selectedFollowup.name}`
      );
      return;
    }
    // QUEDA ANOTADO QUÉ VARIANTE RECIBIÓ, PARA PODER LEER SUS BOTONES.
    //
    // Los botones se buscan por su id, y al duplicar una variante ese id se
    // copia tal cual: sin este apunte, el motor cogía la PRIMERA copia del
    // archivo —otra variante, con otra acción— y el botón hacía lo que no era.
    // Ver `runBubbleButtonAction`.
    fijarVarianteDeSeguimientoEnviada(convo.id, payload.variant_index ?? null);
    const fwPrice =
      lockPaymentPrice(
        convo,
        getEffectivePriceSoles(
          isDiscountActiveForConversation(convo, config),
          convo.phone
        ),
        "base",
        config
      ) ?? getLockedOrCurrentBasePrice(convo, config);
    // Si la burbuja está APAGADA (enabled === false), no la enviamos — pero el
    // is_last sigue su curso (markFollowupSent + menú de pago del seguimiento).
    if (step.enabled !== false) {
      if ((step.buttons?.length ?? 0) > 0) {
        await sendResponseStep(convo, step, fwPrice);
      } else if (step.type === "text") {
        const text = pickVariant(step.body_variants, step.body) ?? "";
        if (text.trim())
          await sendBotText(convo, applyPriceTemplate(text, fwPrice, convo));
      } else {
        const fwCaption =
          step.type !== "audio"
            ? pickVariant(step.caption_variants, step.caption)
            : undefined;
        await sendBotMediaFromDrive(
          convo,
          step.type,
          step.drive_url,
          fwCaption ? applyPriceTemplate(fwCaption, fwPrice, convo) : fwCaption
        );
      }
    }
    console.log(
      `[wf:seguimiento] ${selectedFollowup.name} step ${payload.step_index} (${step.type}) enviado a convo ${convo.id}${payload.is_last ? " [ultimo]" : ""}`
    );
    // Cuando termina el último step de una secuencia, marcamos Enviado N
    // en NocoDB (fire-and-forget).
    if (payload.is_last) {
      void markFollowupSent(convo.id, payload.sequence_index + 1);
      if (
        payload.sequence_index < 2 &&
        seq.offer_choice_menu_enabled &&
        isDobleOfertaActive()
      ) {
        try {
          await presentDobleOfertaAndWaitForChoice(convo);
        } catch (err) {
          console.error(
            `[wf:seguimiento] error enviando eleccion de doble oferta en ${seq.name}:`,
            err
          );
        }
        return;
      }
      // Menú de pago propio del seguimiento (foto/video + texto + botones),
      // enviado como cierre de la secuencia si está activado.
      const menu = seq.payment_menu;
      if (menu?.enabled) {
        try {
          await sendFollowupPaymentMenu(convo, menu);
        } catch (err) {
          console.error(
            `[wf:seguimiento] error enviando menú de pago de ${seq.name}:`,
            err
          );
        }
      }
    }
    return;
  }

  if (action.action_type === ACTION_SEND_PAYMENT_STEP) {
    const payload = JSON.parse(action.payload) as SendPaymentStepPayload;
    const config = loadWorkflowConfig();
    if (!config) {
      console.warn(`[wf] acción ${action.id}: config no disponible`);
      return;
    }
    const todos = payload.direct_payment
      ? getDirectPaymentSteps(config, payload.direct_payment_mode, convo.phone)
      : payload.upsell === true
        ? // Las del SEGUNDO producto. Ver el comentario del campo `upsell`.
          getUpsellPaymentResponses(config, payload.route, convo.phone)
        : getPaymentResponses(
            config,
            payload.route,
            payload.order_bump_choice,
            convo.phone
          );
    // EL MISMO RECORTE QUE SE HIZO AL PROGRAMAR, o los números no cuadran: aquí
    // la burbuja se busca por su posición, no viaja en el sobre.
    const steps =
      payload.sin_presentacion === true ||
      payload.direct_payment_sin_presentacion === true
        ? sinLaPresentacionDeSiempre(todos)
        : todos;
    const step = steps[payload.step_index];
    if (!step) {
      console.warn(
        `[wf] acción ${action.id}: payment step_index ${payload.step_index} fuera de rango`
      );
      return;
    }
    console.log(
      `[wf] enviando payment step ${payload.step_index} (${payload.route}) a convo ${convo.id}`
    );
    await sendResponseStep(
      convo,
      step,
      payload.price_soles,
      !!payload.order_bump_choice || payload.render_two_tier_prices === true
    );
    return;
  }

  console.warn(`[wf] action_type desconocido: ${action.action_type}`);
}

/**
 * Reparte un texto largo del LLM en mensajes separados.
 *
 * El LLM debe usar doble salto de línea (\n\n) para indicar dónde quiere
 * separar los mensajes — esto se controla desde el system prompt.
 *
 * Comportamiento:
 *  - Si la respuesta es un solo bloque → un único mensaje (igual que antes).
 *  - Si tiene varios bloques → primer mensaje inmediato, los demás
 *    programados con `between_messages_delay_seconds` de separación.
 */
export async function sendChunkedBotText(
  convo: ConversationRow,
  fullText: string,
  afterBubbles?: string[]
): Promise<void> {
  let chunks = fullText
    .split(/\n\s*\n/)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);

  // Burbujas de AYUDA (ej. order bump): van SIEMPRE al FINAL, después de todas
  // las del LLM, y NO cuentan contra el límite de burbujas del LLM.
  const after = (afterBubbles ?? []).map((t) => t.trim()).filter(Boolean);
  if (chunks.length === 0 && after.length === 0) return;

  const config = loadWorkflowConfig();
  if (config?.llm_bubble_limit_enabled === true) {
    const maxBubbles = Math.max(1, Math.floor(config.llm_max_bubbles ?? 3));
    if (chunks.length > maxBubbles) {
      chunks = chunks.slice(0, maxBubbles);
    }
  }

  const delay =
    config?.between_messages_delay_seconds ?? DEFAULT_BETWEEN_MESSAGES_DELAY;
  const now = Math.floor(Date.now() / 1000);

  // Primer chunk del LLM: inmediato. Los demás, programados en orden.
  if (chunks.length > 0) await sendBotText(convo, chunks[0]);
  for (let i = 1; i < chunks.length; i++) {
    scheduleAction(
      convo.id,
      ACTION_SEND_TEXT_CHUNK,
      { body: chunks[i] },
      now + delay * i
    );
  }
  // Ayuda al final: se programa DESPUÉS de la última burbuja del LLM.
  for (let j = 0; j < after.length; j++) {
    scheduleAction(
      convo.id,
      ACTION_SEND_TEXT_CHUNK,
      { body: after[j] },
      now + delay * (chunks.length + j)
    );
  }
  if (chunks.length > 1 || after.length > 0) {
    console.log(
      `[wf] respuesta: ${chunks.length} chunks LLM + ${after.length} ayuda para convo ${convo.id} (delay ${delay}s)`
    );
  }
}

/**
 * Reemplaza placeholders de plantilla en un texto antes de enviarlo.
 * Soporta `{price}` y `{precio}` → precio efectivo del curso o de la opción
 * elegida en el Order Bump.
 */
function applyWhatsAppNameTemplate(
  text: string,
  convo?: ConversationRow | null
): string {
  const base = applyCustomPlaceholders(text);
  if (!base || !isDobleOfertaActive()) return resolveSpintax(base);
  const name = (convo?.name ?? "").trim();
  const rendered = base
    .replace(/\{\{\s*NOMBRE_WHATSAPP\s*\}\}/gi, literal(name))
    .replace(/[ \t]+([!¡?¿,.;:])/g, "$1")
    .replace(/([¡¿])[ \t]+/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n");
  return resolveSpintax(rendered);
}

function applyPriceTemplate(
  text: string,
  priceSoles: number,
  convo?: ConversationRow | null
): string {
  // Formato: 2 decimales si el precio los tiene (9.9 → "9.90"), entero si no (3 → "3").
  const priceStr = Number.isInteger(priceSoles)
    ? String(priceSoles)
    : priceSoles.toFixed(2);
  // {moneda}/{{moneda}}/{simbolo} → símbolo de moneda del país seleccionado
  // (S/, $, Bs, Q, ₡…). Así el símbolo lo maneja el selector de país, no se
  // escribe a mano en cada texto.
  const moneda = getCountryInfo(
    getEffectiveCountryCode(convo?.phone, loadWorkflowConfig())
  );
  const precioCompleto = formatCurrencyAmount(
    priceSoles,
    getEffectiveCountryCode(convo?.phone, loadWorkflowConfig())
  );
  const config = loadWorkflowConfig();
  const countryCode = getEffectiveCountryCode(convo?.phone, config);
  const precioCompletoMayusculas = formatCurrencyAmount(
    priceSoles,
    countryCode,
    undefined,
    "upper"
  );
  const precioCompletoMinusculas = formatCurrencyAmount(
    priceSoles,
    countryCode,
    undefined,
    "lower"
  );
  // EL PRECIO ANTERIOR, UNO POR PRODUCTO.
  //
  // Había uno solo por país, así que en una modalidad con dos o tres productos
  // el mismo número salía para todos: al full se le ponía el "antes" del
  // básico y su descuento parecía más chico de lo que era. Ahora cada uno lee
  // el suyo, guardado junto a su precio.
  //
  // Vacío = no se imprime nada. Nunca se rellena con el de otro producto: un
  // precio anterior equivocado no se ve, solo hace que la oferta mienta.
  const perfilDelPais = resolveCountryPaymentProfile(countryCode, config);
  const conMoneda = (valor: number | undefined): string =>
    typeof valor === "number" && Number.isFinite(valor) && valor > 0
      ? formatCurrencyAmount(valor, countryCode)
      : "";
  // La ficha del producto manda, y detrás el país. Sale del mismo sitio y en el
  // MISMO ORDEN que en el otro renderizador: hay dos y no siempre corren los
  // dos, así que un precio anterior resuelto aquí y vacío —o distinto— allá era
  // posible. Lo destapó `prueba-los-precios-de-la-ficha` el 17/09/2026, cuando
  // la prioridad de la ficha se puso solo en uno de los dos.
  const precioMercado =
    preciosDeLaFichaEnElPais("unico", countryCode, config).tachado ??
    preciosDeLaFichaEnElPais("basico", countryCode, config).tachado ??
    mercadoConRespaldo(perfilDelPais?.market_price, config?.market_price);
  const precioMercadoCompleto = conMoneda(precioMercado);
  // El del básico ES el de siempre: vive junto a `course_price_soles`, que es
  // el precio del básico. Así `{{PRECIO_MERCADO}}` y `{{PRECIO_MERCADO_BASICO}}`
  // dan lo mismo y lo ya escrito no cambia de valor.
  const precioMercadoBasico = precioMercadoCompleto;
  // LOS TRES PRECIOS, TAMBIÉN AQUÍ.
  //
  // Hay dos renderizadores y no siempre corren los dos: `renderOrderBumpTemplate`
  // solo entra por algunas rutas. Si estos comodines vivieran solo allí, en las
  // demás saldrían crudos al cliente. Salen de las mismas funciones, así que no
  // pueden discrepar.
  const conDescuento = isDiscountActiveForConversation(convo, config);
  const estiloDeMonedaBase = perfilDelPais?.price_label_case;
  const estiloDeMonedaFull = perfilDelPais?.order_bump?.combo_price_label_case;
  const estiloDeMonedaUpsell = perfilDelPais?.upsell?.price_label_case;
  const conEstiloDeSuCajon = (
    valor: number | null | undefined,
    estilo: "upper" | "lower" | "off" | undefined
  ): string =>
    typeof valor === "number" && Number.isFinite(valor) && valor > 0
      ? formatCurrencyAmount(valor, countryCode, undefined, estilo ?? "upper")
      : "";
  const precioDelFull = conEstiloDeSuCajon(
    getOrderBumpPriceSoles("combo", conDescuento, convo?.phone ?? null),
    estiloDeMonedaFull
  );
  const precioDelBase = conEstiloDeSuCajon(
    getOrderBumpPriceSoles("basico", conDescuento, convo?.phone ?? null),
    estiloDeMonedaBase
  );
  const precioDelUpsell = conEstiloDeSuCajon(
    getUpsellPriceSoles(conDescuento, convo?.phone ?? null),
    estiloDeMonedaUpsell
  );
  const precioMercadoFull = conMoneda(perfilDelPais?.order_bump?.combo_market_price);
  // Una oferta de la fila lleva su propio «antes» (en el downsell, el precio normal).
  const ofertaDeLaFila = seccionUpsell(config)?.de_la_fila;
  const precioMercadoUpsell = conMoneda(
    ofertaDeLaFila
      ? preciosDeLaOfertaDeLaFila(ofertaDeLaFila, countryCode).tachado
      : perfilDelPais?.upsell?.market_price ?? seccionUpsell(config)?.market_price
  );
  // Inserta la lista editable del perfil de país dentro de una burbuja ya
  // existente. No crea pasos ni altera el orden configurado del embudo.
  const metodosPorPais = getPaymentText(convo?.phone);
  const listaMetodosPorPais = getPaymentMethodsList(convo?.phone);
  return applyWhatsAppNameTemplate(applyProductName(text), convo)
    // Compatibilidad multipaís: las burbujas antiguas escribían la moneda
    // alrededor de {precio}. Al cambiar de país antes solo cambiaba el número
    // y quedaba "2 SOLES". Reemplazamos la expresión completa por la moneda
    // efectiva sin obligar a reescribir todas las variantes existentes.
    .replace(
      /(?:S\/\.?|US?\$|\$|Bs\.?|Q|₡)\s*\{\{?\s*(?:precio|price)\s*\}?\}\s*(?:sol(?:es)?|d[oó]lares?|pesos?|bol[ií]vares?|quetzales?|colones?)/gi,
      literal(precioCompletoMayusculas)
    )
    .replace(
      /\{\{\s*(metodos_de_pago_por_pais|metodos_pago_pais|payment_methods_by_country)\s*\}\}/gi,
      literal(metodosPorPais)
    )
    .replace(
      /\{\{\s*(lista_metodos_por_pais|lista_metodos_pago_por_pais|payment_methods_list_by_country)\s*\}\}/gi,
      literal(listaMetodosPorPais)
    )
    // Los precios por producto, primero de todos.
    .replace(
      /\{\{\s*(precio_full|precio_combo)\s*\}\}/gi,
      literal(precioDelFull)
    )
    .replace(
      /\{\{\s*(precio_base|precio_basico)\s*\}\}/gi,
      literal(precioDelBase)
    )
    .replace(
      /\{\{\s*(precio_upsell|precio_upsell_solo)\s*\}\}/gi,
      literal(precioDelUpsell)
    )
    // Los tres «antes» van ANTES que {{PRECIO_MERCADO}} a secas: si no, el
    // genérico se comería su principio y dejaría "_FULL" suelto en el mensaje.
    .replace(
      /\{\{\s*(precio_mercado_basico|precio_anterior_basico|market_price_basico)\s*\}\}/gi,
      literal(precioMercadoBasico)
    )
    .replace(
      /\{\{\s*(precio_mercado_full|precio_mercado_combo|precio_anterior_full|market_price_full)\s*\}\}/gi,
      literal(precioMercadoFull)
    )
    .replace(
      /\{\{\s*(precio_mercado_upsell|precio_anterior_upsell|market_price_upsell)\s*\}\}/gi,
      literal(precioMercadoUpsell)
    )
    .replace(
      /\{\{\s*(precio_mercado|precio_anterior|precio_referencial|market_price|previous_price)\s*\}\}/gi,
      literal(precioMercadoCompleto)
    )
    .replace(
      /\{\{\s*(precio_completo_mayusculas|precio_full_mayusculas|full_price_upper)\s*\}\}/gi,
      literal(precioCompletoMayusculas)
    )
    .replace(
      /\{\{\s*(precio_completo_minusculas|precio_full_minusculas|full_price_lower)\s*\}\}/gi,
      literal(precioCompletoMinusculas)
    )
    // El precio del producto único obedece al botón May/Min/Off de su cajón,
    // igual que los de las modalidades con dos opciones. Sin esto, en Lineal
    // el botón se vería puesto y no haría nada.
    .replace(
      /\{\{\s*(precio_completo|precio_label|price_label|full_price)\s*\}\}/gi,
      literal(
        formatCurrencyAmount(
          priceSoles,
          countryCode,
          undefined,
          perfilDelPais?.price_label_case ?? "upper"
        )
      )
    )
    .replace(/\{\{\s*(currency|moneda_iso|codigo_moneda|currency_code)\s*\}\}/gi, literal(moneda.currency))
    .replace(/\{\{?\s*(moneda|simbolo|símbolo)\s*\}?\}/gi, literal(moneda.symbol))
    // {precio}/{price} con CONTEXTO en mayúsculas ("S/. 10 SOLES" / "$ 3 DÓLARES").
    // Mismo precio que priceStr, solo con símbolo + nombre de moneda del país.
    .replace(/\{price\}/gi, literal(precioCompletoMayusculas))
    .replace(/\{precio\}/gi, literal(precioCompletoMayusculas));
}

/**
 * Envía un único paso de respuesta (texto o media). Helper compartido
 * entre la respuesta inmediata y los pasos programados.
 */
/**
 * Envia UNA burbuja. Devuelve si de verdad salio algo.
 *
 * Devolvia `void`, y por eso una burbuja podia no enviarse sin que nadie se
 * enterara: si el texto queda vacio tras resolver las variantes, el `if` de
 * abajo no manda nada y la funcion terminaba igual que si hubiera enviado. Quien
 * la llama para SUSTITUIR otra cosa —la respuesta al elegir producto— necesita
 * saberlo: sustituir con nada deja al cliente en silencio.
 *
 * Los 15 sitios que ignoran el resultado siguen funcionando igual.
 */
async function sendResponseStep(
  convo: ConversationRow,
  step: ResponseStep,
  priceOverride?: number,
  renderOrderBumpComodines = false
): Promise<boolean> {
  const config = loadWorkflowConfig();
  // priceOverride: precio para el comodín {price} (ej. el de la opción del
  // order bump). Si no se pasa, lo resuelve `precioDeRespaldoDeEstaVenta`.
  // renderOrderBumpComodines: además de {price}, resuelve {{precio_1}},
  // {{precio_2}} y {{precio_extra}} (combo/básico/adicional) — se usa en el
  // intro del order bump para que los 3 precios sigan la etapa de oferta.
  const price =
    priceOverride ??
    getLockedOrCurrentBasePrice(convo, config);
  const render = (t: string): string => {
    // EL CAJÓN DE PAGO DEL PAÍS SE ABRE AQUÍ, NO AL ENVIAR.
    //
    // {{METODO_DE_PAGO_1}} es un texto que el operador escribe por país, y
    // lleva dentro sus propios comodines de precio. Se abría más tarde, dentro
    // del envío, donde este `price` ya no existe — así que el precio de dentro
    // del cajón se resolvía con el del curso y no con el de este paso.
    //
    // Se veía así: se aceptaba el segundo producto de 7.500 y los datos de pago
    // pedían 6.000, el precio de la compra anterior. Nadie lo nota hasta que
    // llega el comprobante por el monto que no era.
    const conCajones = expandirCajonesDePagoDelPais(t, convo);
    const withTwoTier = renderOrderBumpComodines
      ? renderOrderBumpTemplate(
          conCajones,
          isDiscountActiveForConversation(convo, config),
          convo.phone
        )
      : conCajones;
    return applyPriceTemplate(withTwoTier, price, convo);
  };
  const buttons = (step.buttons ?? [])
    .filter((button) => button.id.trim() && button.label.trim())
    .slice(0, 3)
    .map((button) => ({ id: `bubble:${button.id}`, title: button.label.trim().slice(0, 20) }));
  if (step.type === "text") {
    const bodyText = pickVariant(step.body_variants, step.body) ?? "";
    if (!bodyText.trim()) return false;
    if (buttons.length) await sendBotButtons(convo, render(bodyText), buttons);
    else await sendBotText(convo, render(bodyText));
    return true;
  }
  const captionRaw =
    step.type !== "audio"
      ? pickVariant(
          (step as { caption_variants?: string[] }).caption_variants,
          (step as { caption?: string }).caption
        )
      : undefined;
  const caption = captionRaw ? render(captionRaw) : undefined;
  if (buttons.length && (step.type === "image" || step.type === "video"))
    await sendBotButtonsWithMedia(convo, step.type, step.drive_url, caption ?? "", buttons);
  else {
    await sendBotMediaFromDrive(convo, step.type, step.drive_url, caption);
    if (buttons.length) await sendBotButtons(convo, "¿Qué deseas hacer?", buttons);
  }
  return !!step.drive_url?.trim() || !!caption?.trim() || buttons.length > 0;
}

/** Obtiene las respuestas del método para la opción elegida del Order Bump.
 *  Una lista vacía conserva compatibilidad usando la respuesta global. */
function getPaymentResponses(
  config: WorkflowConfig,
  route: string,
  orderBumpChoice?: "combo" | "basico",
  phone?: string | null
): ResponseStep[] {
  // Lee los pasos del método `route` (dinámico o clásico) de un bloque
  // payment_responses. Fallback clásico: "efectivo" usa los datos de
  // bcp_transferencia si no tiene su propio texto (comportamiento existente).
  const byRoute = (
    responses?: { [method: string]: ResponseStep[] | undefined }
  ): ResponseStep[] | undefined => {
    if (!responses) return undefined;
    const direct = responses[route];
    if (Array.isArray(direct) && direct.length > 0) return direct;
    if (route === "efectivo") return responses.bcp_transferencia;
    return undefined;
  };

  let steps: ResponseStep[] | undefined;

  if (orderBumpChoice) {
    // Respuestas de pago por opción de la modalidad ACTIVA (order bump o doble
    // oferta). Si la opción no las define, cae a las globales con {price}.
    // Respuestas por método de la opción, con textos POR PAÍS aplicados encima
    // del base (Yape/Plin, BCP, Efectivo). Vacío por país = usa el base.
    const opt = getOrderBumpOptionForCountry(orderBumpChoice, phone, config);
    const custom = byRoute(opt?.payment_responses);
    if (Array.isArray(custom) && custom.length > 0) steps = custom;
  }

  if (!steps) {
    const country = getEffectiveCountryCode(phone, config);
    const countryResponses =
      resolveCountryPaymentProfile(country, config)?.payment_responses;
    steps =
      byRoute(countryResponses) ??
      byRoute(config.payment_responses) ??
      config.payment_responses.bcp_transferencia ??
      config.payment_responses.yape ??
      [];
  }

  return steps.filter((step) => step.enabled !== false);
}

function hasConfiguredPaymentResponseForOption(
  config: WorkflowConfig,
  choice: "combo" | "basico",
  route: string,
  phone?: string | null
): boolean {
  const opt = getOrderBumpOptionForCountry(choice, phone, config);
  const direct = opt?.payment_responses?.[route];
  if (Array.isArray(direct) && direct.some((step) => step.enabled !== false)) {
    return true;
  }
  return route === "efectivo" &&
    Array.isArray(opt?.payment_responses?.bcp_transferencia) &&
    opt.payment_responses.bcp_transferencia.some((step) => step.enabled !== false);
}

function getUpsellPaymentResponses(
  config: WorkflowConfig,
  route: string,
  phone?: string | null
): ResponseStep[] {
  const own = seccionUpsell(config)?.payment_responses;
  const direct = own?.[route];
  const fallback = route === "efectivo" ? own?.bcp_transferencia : undefined;
  const steps =
    (Array.isArray(direct) && direct.length > 0 ? direct : fallback) ??
    getPaymentResponses(config, route, undefined, phone);
  return steps.filter((step) => step.enabled !== false);
}

function getDirectPaymentSteps(
  config: WorkflowConfig,
  mode: "with_choice" | "without_choice" = "with_choice",
  phone?: string | null
): ResponseStep[] {
  // EL TEXTO PROPIO DE ESTA MODALIDAD Y ESTE PAÍS, SI LO HAY.
  //
  // `direct_payment_steps` vive arriba, fuera de las capas: es UN texto para
  // todo el bot. En las modalidades de dos opciones no se nota, porque cada
  // opción tiene el suyo. En Lineal sí: es el único texto que el cliente recibe
  // al ir a pagar, y estaba compartido con las demás modalidades — así que
  // personalizarlo en una se lo cambiaba a todas.
  //
  // Ahora puede vivir en la capa del país, como el precio y los datos de pago.
  // Vacío = el global de siempre, así que quien no escriba el suyo no nota nada.
  //
  // Solo para "with_choice": el de "sin elección" es el que se manda ANTES de
  // que el cliente elija producto, y ahí todavía no hay opción de la que sea.
  const delPais =
    mode === "with_choice" && phone
      ? resolveCountryPaymentProfile(
          getEffectiveCountryCode(phone, config),
          config
        )
      : undefined;
  const propios = delPais?.direct_payment_steps;
  // ESCRIBIR TRES BURBUJAS Y APAGARLAS TODAS NO ES «QUIERO MANDAR VACÍO».
  //
  // LO QUE PASÓ — 27 de septiembre de 2026, su conversación de prueba 237. El
  // cliente eligió su opción y no recibió NI UN MENSAJE, y la venta quedó
  // marcada como si ya tuviera los datos de pago. Medido, comparando dos países
  // con la misma configuración global:
  //
  //     su país:  3 burbujas escritas, las 3 APAGADAS, cierre vacío  -> 0 pasos
  //     el otro:  0 burbujas escritas  -> usa las globales           -> 3 pasos
  //
  // Las dos cajas dicen lo mismo —aquí no hay nada que enviar— y se trataban
  // distinto: la vacía caía al global y la apagada dejaba al bot mudo. Esa
  // asimetría no la eligió nadie; es del motor.
  //
  // LO QUE SÍ SE CONSERVA, y es lo que este `if` protegía: un país que escribe
  // su texto manda el suyo aunque deje el CIERRE vacío a propósito. Eso sigue
  // igual, porque basta con que quede UNA burbuja viva o un cierre escrito.
  // Solo cuando no queda absolutamente nada se cae al global, que es lo mismo
  // que habría pasado sin escribir nada.
  //
  // Medido antes de tocarlo: en toda su configuración hay UN solo caso así, y
  // ningún país depende de quedarse mudo. Ver `prueba-elegir-opcion-nunca-deja-en-silencio`.
  const hayPropios = Array.isArray(propios) && propios.length > 0;
  const ctaPropio = hayPropios ? (delPais?.direct_payment_cta ?? "").trim() : "";
  const quedaAlgoPropio =
    hayPropios &&
    (propios.some((step) => step.enabled !== false) || ctaPropio.length > 0);
  if (hayPropios && !quedaAlgoPropio) {
    console.warn(
      `[wf] pago directo: el país tiene ${propios.length} burbuja(s) escritas pero TODAS apagadas y sin cierre → uso el texto global, como si no hubiera escrito ninguna`
    );
  }
  const rawSteps = quedaAlgoPropio
    ? propios
    : mode === "without_choice"
      ? config.direct_payment_without_choice_steps
      : config.direct_payment_steps;
  // El cierre acompaña al texto: si esta modalidad escribió el suyo, se usa el
  // suyo aunque esté vacío a propósito. Mezclarlo con el global pegaría un
  // cierre que habla de otra cosa.
  const rawCta = quedaAlgoPropio
    ? ctaPropio
    : mode === "without_choice"
      ? config.direct_payment_without_choice_cta
      : config.direct_payment_cta;
  const steps = Array.isArray(rawSteps)
    ? rawSteps.filter((step) => step.enabled !== false)
    : [];
  const cta = rawCta?.trim();
  const allSteps: ResponseStep[] = cta
    ? [...steps, { type: "text", body: cta }]
    : steps;
  return mode === "without_choice" ? allSteps.map(stripSinglePriceFromStep) : allSteps;
}

/**
 * ¿ESTA BURBUJA LLEVA LOS DATOS PARA PAGAR?
 *
 * Dos formas, y las dos se reconocen sin adivinar:
 *
 *   · POR COMODÍN. Los cajones de pago del país entran con
 *     {{METODO_DE_PAGO_1}} y compañía.
 *   · ESCRITO A MANO. Una cuenta o un número de Yape es una tirada larga de
 *     dígitos. Una frase de presentación no lleva ninguna: «puedes adquirirlo
 *     de la siguiente manera» no tiene seis cifras seguidas, y «S/. 10 soles»
 *     tampoco.
 *
 * Al principio solo se miraba el comodín, y con eso las respuestas escritas a
 * mano —que son la mayoría en los cuadritos— parecían no llevar datos. De ahí
 * salía el fallo: se daban por «solo presentación» y se les pegaba detrás la
 * de fábrica, con su presentación y sus datos otra vez.
 */
export function unTextoLlevaLosDatosParaPagar(texto: string): boolean {
  return (
    /\{\{\s*(metodo_de_pago|metodo_pago)_(1|2|3|principal|prioritario)\s*\}\}/i.test(
      texto
    ) || /(?:\d[\s.-]?){6,}/.test(texto)
  );
}

function llevaLosDatosParaPagar(step: ResponseStep): boolean {
  const s = step as {
    body?: string;
    body_variants?: string[];
    caption?: string;
    caption_variants?: string[];
  };
  return [
    s.body ?? "",
    ...(s.body_variants ?? []),
    s.caption ?? "",
    ...(s.caption_variants ?? []),
  ].some(unTextoLlevaLosDatosParaPagar);
}

/**
 * ¿ESTA BURBUJA LLEVA LA CUENTA ESCRITA CON SU COMODÍN?
 *
 * {{NUMERO_DE_CUENTA}} y {{CUENTA_<su método>}} son la cuenta, igual que
 * {{METODO_DE_PAGO_1}}: `sender.ts` los cambia por el número al enviar. Pero
 * aquí se mira el texto SIN resolver, y `llevaLosDatosParaPagar` no los veía.
 *
 * LO QUE COSTÓ — 13/10/2026, verificando Argentina. Su burbuja de datos lleva
 * «CBU: {{NUMERO_DE_CUENTA}}». Al reenviar, el bot no encontraba la burbuja de
 * los datos, no quitaba nada, y el cliente leía «Claro, aquí te envío los datos
 * nuevamente» y debajo «Excelente!, Puedes realizar tu pago…»: dos saludos
 * seguidos. Igual en Perú con BCP, Plin y Efectivo.
 *
 * SOLO LA USA `sinLaPresentacionDeSiempre`. `unTextoLlevaLosDatosParaPagar` no
 * se toca: la usan el detector de mensajes de handler.ts, el cuadrito que ya
 * lleva los datos y una guarda del motor, y ninguno tenía este fallo.
 */
function llevaUnaCuentaPorComodin(step: ResponseStep): boolean {
  const s = step as {
    body?: string;
    body_variants?: string[];
    caption?: string;
    caption_variants?: string[];
  };
  return [
    s.body ?? "",
    ...(s.body_variants ?? []),
    s.caption ?? "",
    ...(s.caption_variants ?? []),
  ].some((texto) =>
    /\{\{\s*(numero_de_cuenta|numero_cuenta|cuenta|account_number|cuenta_[a-z0-9_]+)\s*\}\}/i.test(
      texto
    )
  );
}

/**
 * ¿EL TEXTO DEL OPERADOR YA LE DICE AL CLIENTE DÓNDE PAGAR?
 *
 * De esto depende la única regla que gobierna todo esto:
 *
 *   SU TEXTO MANDA. Si sus burbujas ya llevan los datos, las de fábrica NO
 *   salen. Si no los llevan, sale solo la parte de fábrica que sí los lleva —
 *   nunca la presentación repetida.
 *
 * La misma regla para el cuadrito de la intro, el del segundo producto y el
 * mensaje propio de cada opción del Order Bump. Tenerlas distintas es como se
 * llegó a tres duplicados distintos, uno por sitio.
 */
function susBurbujasLlevanLosDatos(
  pasos: ResponseStep[] | undefined
): boolean {
  return burbujasQueVanASalir(pasos).some(llevaLosDatosParaPagar);
}

/**
 * LAS BURBUJAS QUE DE VERDAD VAN A SALIR.
 *
 * Es EXACTAMENTE el mismo filtro que aplica `sendConfiguredSteps` al mandarlas:
 * una burbuja apagada no se envía. Está aquí para que las dos no puedan
 * separarse, porque separadas ya se separaron una vez y el fallo era invisible:
 *
 *   Un cuadrito de pago con sus dos burbujas APAGADAS contaba igual como «el
 *   operador ya presentó». No salía ni una —correcto, están apagadas— pero el
 *   texto de fábrica se mandaba SIN su presentación, para no repetir algo que
 *   nadie había dicho. Resultado: de las tres burbujas del método faltaba la
 *   primera, la que presenta, y no había manera de saber por qué.
 *
 * Se mira solo el interruptor, no el contenido: es lo único que garantiza que
 * «lo que cuenta como dicho» y «lo que se manda» sean la misma lista.
 */
function burbujasQueVanASalir(
  pasos: ResponseStep[] | undefined
): ResponseStep[] {
  return (pasos ?? []).filter(
    (paso) => (paso as { enabled?: boolean }).enabled !== false
  );
}

/** ¿Este cuadrito tiene algo suyo que decir? Apagadas no cuentan. */
function tieneBurbujasEncendidas(pasos: ResponseStep[] | undefined): boolean {
  return burbujasQueVanASalir(pasos).length > 0;
}

/**
 * QUITA LA PRESENTACIÓN DE SIEMPRE, DEJANDO LOS DATOS.
 *
 * El texto general del pago directo son dos cosas pegadas: una frase que
 * PRESENTA («✅ ¡Perfecto! puedes adquirir el curso de la siguiente manera 👇»)
 * y, detrás, la burbuja con el cajón del país. Cuando el producto tiene su
 * propio mensaje, esa frase se dice dos veces con distintas palabras — que es
 * justo lo que se estaba corrigiendo escribiéndola a mano.
 *
 * Se quitan SOLO las frases que van DELANTE de la primera burbuja con datos.
 * Todo lo demás sale igual, así que nadie puede quedarse pagando sin saber a
 * dónde. Y en cuanto algo no encaja, no se toca nada:
 *
 *   · ninguna burbuja lleva el comodín → puede que los números estén escritos a
 *     mano en cualquiera de ellas. No se quita nada.
 *   · la primera burbuja ya es la de los datos → no hay presentación que quitar.
 *   · delante hay una imagen o un audio → una imagen nunca es una frase de
 *     presentación; puede ser el QR. No se quita nada.
 */
function sinLaPresentacionDeSiempre(pasos: ResponseStep[]): ResponseStep[] {
  const iDatos = pasos.findIndex(
    (paso) => llevaLosDatosParaPagar(paso) || llevaUnaCuentaPorComodin(paso)
  );
  if (iDatos <= 0) return pasos;
  const delante = pasos.slice(0, iDatos);
  if (!delante.every((paso) => (paso.type ?? "text") === "text")) return pasos;
  return pasos.slice(iDatos);
}

function stripSinglePriceFromStep(step: ResponseStep): ResponseStep {
  const strip = (text?: string): string | undefined =>
    typeof text === "string"
      ? text
          .replace(/\{\s*(price|precio)\s*\}/gi, "")
          .replace(/[ \t]{2,}/g, " ")
          .trim()
      : text;
  const stripList = (items?: string[]): string[] | undefined =>
    Array.isArray(items) ? items.map((item) => strip(item) ?? "") : items;
  if (step.type === "text") {
    return {
      ...step,
      body: strip(step.body),
      body_variants: stripList(step.body_variants),
    };
  }
  if (step.type === "audio") return step;
  return {
    ...step,
    caption: strip(step.caption),
    caption_variants: stripList(step.caption_variants),
  };
}

function shouldUseDirectPayment(
  config: WorkflowConfig | null,
  mode: "with_choice" | "without_choice" = "with_choice",
  // El teléfono decide el país, y el país puede tener SU propio texto. Sin
  // esto, una modalidad que escribiera el suyo y dejara el global vacío se
  // quedaría sin pago directo: aquí se diría que no hay nada que mandar y el
  // texto propio no llegaría a mirarse nunca.
  phone?: string | null
): boolean {
  return (
    config?.direct_payment_enabled === true &&
    getDirectPaymentSteps(config, mode, phone).length > 0
  );
}

/**
 * Manda la primera respuesta de pago inmediato y programa las siguientes
 * con `between_messages_delay_seconds` de separación. Así evitamos el
 * "spam por robotización" y el cliente puede leer cada mensaje.
 */
async function schedulePaymentResponses(
  convo: ConversationRow,
  route: string,
  steps: ResponseStep[],
  context?: {
    orderBumpChoice?: "combo" | "basico";
    priceSoles?: number;
    directPayment?: boolean;
    directPaymentMode?: "with_choice" | "without_choice";
    /** Los `steps` que llegan ya vienen sin la presentación. El worker tiene que
     *  recortar igual para que las posiciones coincidan. Vale para el pago
     *  directo y para las respuestas de pago del país: las dos empiezan
     *  presentando. */
    sinPresentacion?: boolean;
    /** Son las respuestas del SEGUNDO producto. Sin esto el worker vuelve a
     *  pedir las del primero y cose dos textos distintos. */
    upsell?: boolean;
    renderTwoTierPrices?: boolean;
  }
): Promise<void> {
  if (steps.length === 0) return;

  // Primer mensaje: lo mandamos ya — feedback inmediato al cliente.
  // renderOB solo cuando es order bump (hay opción elegida): así {{precio_1}},
  // {{precio_2}} y {{precio_extra}} funcionan en sus respuestas de pago, sin
  // afectar la venta lineal (que no tiene esas opciones).
  await sendResponseStep(
    convo,
    steps[0],
    context?.priceSoles,
    !!context?.orderBumpChoice || context?.renderTwoTierPrices === true
  );

  if (steps.length === 1) return;

  const config = loadWorkflowConfig();
  const delay =
    config?.between_messages_delay_seconds ?? DEFAULT_BETWEEN_MESSAGES_DELAY;
  const now = Math.floor(Date.now() / 1000);

  for (let i = 1; i < steps.length; i++) {
    const payload: Record<string, unknown> = {
      route,
      step_index: i,
      order_bump_choice: context?.orderBumpChoice,
      price_soles: context?.priceSoles,
      direct_payment: context?.directPayment === true,
      direct_payment_mode: context?.directPaymentMode,
      sin_presentacion: context?.sinPresentacion === true,
      upsell: context?.upsell === true,
      render_two_tier_prices: context?.renderTwoTierPrices === true,
    };
    scheduleAction(
      convo.id,
      ACTION_SEND_PAYMENT_STEP,
      payload,
      now + delay * i
    );
  }
}

/**
 * Re-envía DETERMINÍSTICAMENTE los datos del método que el cliente YA eligió
 * (selected_payment_method), con el CTA de la plantilla. Lo dispara el marcador
 * <<REENVIAR_PAGO>> cuando el cliente, tras un desvío, vuelve a querer pagar /
 * pide los datos. Los números y el CTA salen de tu plantilla — el LLM nunca los
 * escribe ni manda al cliente a "buscar arriba". Devuelve false si no hay método
 * guardado (el caller decide el fallback).
 */
export async function resendPaymentDetails(
  convo: ConversationRow,
  opciones?: {
    /**
     * QUIÉN PONE LA FRASE QUE ENMARCA EL REENVÍO.
     *
     * Cuando reenvía el MOTOR por su cuenta —el cliente vuelve a nombrar su
     * método— no habla nadie más, así que la frase la pone aquí el operador.
     * Cuando el reenvío lo pide el modelo con su marcador, la frase ya la
     * escribió él; ponerle otra encima serían dos saludos seguidos.
     */
    conFrase?: boolean;
  }
): Promise<boolean> {
  const config = loadWorkflowConfig();
  if (!config) return false;
  const method = convo.selected_payment_method;
  if (!method) return false;
  // SU TEXTO MANDA TAMBIÉN AL REENVIAR, Y POR TODAS LAS PUERTAS.
  //
  // LO QUE COSTÓ, en sus pruebas del 22/09/2026. Su cuadrito «QUIERE PAGAR»
  // lleva yape, bcp y las instrucciones en una sola burbuja. Salía la suya la
  // primera vez y las de fábrica después: UN método y ninguna instrucción, o
  // sea MENOS de lo que ya le habían dado. Pasó por dos caminos distintos —el
  // del cuadrito ya contestado y el de `handler.ts`, cuando el modelo iba a
  // repreguntar un método ya elegido— y se arregló primero solo en uno. Por eso
  // vive aquí: esta función es por donde reenvían las NUEVE puertas, así que
  // arreglarlo aquí lo arregla en todas y no hay dos versiones que se separen.
  //
  // SIN CUADRITO, TODO COMO ANTES. Si no hay ninguno contestado, o sus burbujas
  // no llevan los datos, se sigue por el camino de siempre, letra por letra.
  //
  // Y CON EL PRODUCTO EXTRA VIVO, ESTO NO SE MIRA. Su cuadrito lleva la cuenta y
  // el precio del PRIMER producto; mientras el extra está ofrecido o aceptado y
  // sin pagar, «pásame los datos» se refiere a ESA otra venta y la atiende la
  // salida de abajo, con su precio. Sin esta línea el cliente pagaría de menos y
  // su comprobante entraría como parcial — el mismo fallo que esa salida existe
  // para evitar, reintroducido por delante.
  const elExtraEstaEnJuego =
    convo.upsell_state === "ofrecido" || convo.upsell_state === "aceptado";
  /**
   * CON DOS OPCIONES Y SIN ELECCIÓN NO SE REENVÍA: SE LE PRESENTAN LAS DOS.
   *
   * ES SU REGLA DE SIEMPRE —«no hay manera de que reciba datos de pago sin
   * elección»— y le faltaba justo este camino. Se pone AQUÍ porque ésta es la
   * función por la que reenvían las NUEVE puertas: siete de ellas solo
   * preguntaban «¿tiene método elegido?», y ninguna «¿hay dos opciones y este
   * cliente no ha elegido?».
   *
   * DE DÓNDE SALE — 26/09/2026, el modo reenganche. Un cliente que empezó
   * viendo UN producto ya tiene método y datos; el dueño cambia el selector a
   * COMO DOU, el cliente dice «voy a pagar» y entraba por `engine.ts:2053`, que
   * mira si está esperando elegir producto. Como en lineal nunca hubo elección,
   * no está en ese estado: pasaba por debajo y recibía los datos del único
   * producto sin llegar a ver el segundo. Con sus palabras: «de frente, te
   * comento que tenemos 2 productos, ¿cuál deseas?».
   *
   * Y CADA FORMA CON SU PUERTA, que es como funcionan ya las dos modalidades:
   * en -OB- lo que corresponde es DESTAPAR el segundo producto (su segunda
   * intro), y solo si todavía está tapado — si ya se reveló, repetirla entera
   * sería el bucle. En -DOU- se le recuerdan las dos, igual que hace la puerta
   * del método sin elección.
   *
   * LOS TRES CANDADOS, y son los que impiden que esto toque lo que funciona:
   *
   *   · EL QUE YA PAGÓ NO SE ROZA. Su venta terminó; reenviar datos ahí es otra
   *     cosa (el reenvío del material, la postventa) y sigue igual que hoy.
   *   · EL PRODUCTO EXTRA TAMPOCO. Mientras está ofrecido o aceptado, «pásame
   *     los datos» se refiere a ESA venta y ya tiene su salida más abajo.
   *   · Y QUIEN YA ELIGIÓ recibe sus datos exactamente igual que siempre.
   */
  const noHaElegidoNinguna =
    convo.order_bump_choice !== "combo" && convo.order_bump_choice !== "basico";
  if (
    !elExtraEstaEnJuego &&
    (convo.paid_total_cents ?? 0) === 0 &&
    (isOrderBumpActive() || isDobleOfertaActive()) &&
    noHaElegidoNinguna
  ) {
    cancelPendingActionsByTypeForConvo(convo.id, ACTION_SEND_PAYMENT_STEP);
    if (isOrderBumpActive() && convo.order_bump_revealed !== 1) {
      await presentOrderBumpAndWaitForChoice(convo);
      console.log(
        `[wf] convo ${convo.id}: pidió pagar sin haber elegido → destapo la segunda opción en vez de reenviar`
      );
    } else {
      await sendTwoOptionsReminder(convo, config);
      console.log(
        `[wf] convo ${convo.id}: pidió pagar sin haber elegido → le recuerdo las 2 opciones en vez de reenviar`
      );
    }
    return true;
  }
  const suyo = elExtraEstaEnJuego
    ? null
    : elCuadritoDePagoQueYaLeSalio(convo, config);
  if (suyo) {
    if (opciones?.conFrase) await enmarcarElReenvio(convo);
    const salio = await sendConfiguredSteps(convo, suyo.steps);
    if (salio) {
      console.log(
        `[wf] convo ${convo.id}: reenvío el texto de "${suyo.title || "(sin título)"}" en vez del de fábrica`
      );
      return true;
    }
    console.warn(
      `[wf] convo ${convo.id}: el texto de "${suyo.title || "(sin título)"}" no envió nada → sigo con el de fábrica`
    );
  }
  // REENVIAR NO ES VOLVER A VENDER.
  //
  // Esto mandaba el bloque ENTERO, presentación incluida: «✅ ¡Perfecto! puedes
  // adquirir el curso de la siguiente manera 👇» y detrás la cuenta. El cliente
  // ya la había visto, así que no leía un reenvío: leía un bot que se olvidó de
  // que ya se lo había dicho. Eso es lo que se sentía como un bucle — no que
  // llegaran los datos otra vez, sino que le vendieran otra vez.
  //
  // Los datos salen igual. Lo que se va es la frase de primera vez.
  const comoReenvio = (pasos: ResponseStep[]) => sinLaPresentacionDeSiempre(pasos);
  if (opciones?.conFrase) await enmarcarElReenvio(convo);
  // Usa el método elegido TAL CUAL (dinámico o clásico). Único alias clásico:
  // "plin" comparte la respuesta de "yape".
  const route: string = method === "plin" ? "yape" : method;

  // EL SEGUNDO PRODUCTO COBRA LO SUYO.
  //
  // Mientras el extra está ofrecido o aceptado y sin pagar, "pásame los datos"
  // se refiere a ESA venta, no a la que ya cerró. Sin esta salida se reenviaban
  // los datos del primer producto CON EL PRECIO DEL PRIMERO: el cliente pagaba
  // de menos y el comprobante entraba como parcial.
  //
  // Cada fase cobra con lo suyo: sus pasos y su precio, igual que hace
  // `entregarDatosDePagoDelUpsell` cuando el cliente acepta la oferta.
  if (convo.upsell_state === "ofrecido" || convo.upsell_state === "aceptado") {
    const upsellSteps = getUpsellPaymentResponses(config, route, convo.phone);
    if (upsellSteps.length > 0) {
      const precioUpsell =
        getUpsellPriceSoles(
          isDiscountActiveForConversation(convo, config),
          convo.phone
        ) ?? undefined;
      cancelPendingActionsByTypeForConvo(convo.id, ACTION_SEND_PAYMENT_STEP);
      const delExtra = comoReenvio(upsellSteps);
      // `upsell: true` NO ESTABA, y sin él este reenvío mezclaba productos.
      //
      // El worker relee las burbujas POR SU POSICIÓN. Sin esta marca releía las
      // del PRIMER producto: salía la primera del extra y, detrás, las del que
      // el cliente ya había comprado — con su precio. Es el mismo descuido que
      // el recorte: lo que se decide al programar hay que decirlo en el sobre.
      await schedulePaymentResponses(convo, route, delExtra, {
        priceSoles: precioUpsell,
        upsell: true,
        sinPresentacion: delExtra.length < upsellSteps.length,
      });
      console.log(
        `[wf:upsell] convo ${convo.id}: reenvío de datos de pago del extra (${route}, ${precioUpsell})`
      );
      return true;
    }
  }
  const orderBumpChoice =
    convo.order_bump_choice === "combo" || convo.order_bump_choice === "basico"
      ? convo.order_bump_choice
      : undefined;
  if (shouldUseDirectPayment(config, "with_choice", convo.phone) && (route === "yape" || route === "plin")) {
    const directSteps = getDirectPaymentSteps(config, "with_choice", convo.phone);
    const priceSoles =
      (orderBumpChoice
        ? getMatchingLockedPrice(convo, `two_tier:${orderBumpChoice}`, config) ??
          getOrderBumpPriceSoles(
            orderBumpChoice,
            isDiscountActiveForConversation(convo, config),
            convo.phone
          ) ?? undefined
        : getLockedOrCurrentBasePrice(convo, config));
    const lockedPriceSoles =
      lockPaymentPrice(
        convo,
        priceSoles,
        orderBumpChoice ? `two_tier:${orderBumpChoice}` : "base",
        config
      ) ?? priceSoles;
    cancelPendingActionsByTypeForConvo(convo.id, ACTION_SEND_PAYMENT_STEP);
    const directoSinPresentar = comoReenvio(directSteps);
    await schedulePaymentResponses(convo, "yape", directoSinPresentar, {
      orderBumpChoice,
      priceSoles: lockedPriceSoles,
      directPayment: true,
      sinPresentacion: directoSinPresentar.length < directSteps.length,
    });
    return true;
  }
  const completos = getPaymentResponses(config, route, orderBumpChoice, convo.phone);
  if (!completos || completos.length === 0) return false;
  const steps = comoReenvio(completos);
  const priceSoles =
    (orderBumpChoice
      ? getMatchingLockedPrice(convo, `two_tier:${orderBumpChoice}`, config) ??
        getOrderBumpPriceSoles(
          orderBumpChoice,
          isDiscountActiveForConversation(convo, config),
          convo.phone
        ) ?? undefined
      : getLockedOrCurrentBasePrice(convo, config));
  const lockedPriceSoles =
    lockPaymentPrice(
      convo,
      priceSoles,
      orderBumpChoice ? `two_tier:${orderBumpChoice}` : "base",
      config
    ) ?? priceSoles;
  cancelPendingActionsByTypeForConvo(convo.id, ACTION_SEND_PAYMENT_STEP);
  await schedulePaymentResponses(convo, route, steps, {
    orderBumpChoice,
    priceSoles: lockedPriceSoles,
    sinPresentacion: steps.length < completos.length,
  });
  return true;
}

/**
 * LA FRASE QUE ENMARCA UN REENVÍO — «aquí te los reenvío 😊».
 *
 * Sin ella, los datos vuelven a caer a secas y parecen un error del bot. Con
 * ella se lee como servicio: el bot sabe que ya se los dio y se los repite
 * porque se lo han pedido.
 *
 * La escribe el operador, como todo lo que lee el cliente. Vacía = no sale
 * nada, y los datos llegan igual: nadie se queda sin saber dónde pagar por no
 * haber rellenado una caja.
 */
/**
 * «ESE VA APARTE» — cuando pide completar y nombra el producto del extra.
 *
 * El extra es una compra NUEVA con su propio ticket: nada de lo ya pagado se le
 * descuenta. Decirlo aquí, en el momento exacto en que lo pregunta, evita que el
 * cliente pague de menos convencido de que tenía un saldo a favor.
 */
async function responderQueElExtraSePagaEntero(
  convo: ConversationRow,
  config: WorkflowConfig | null
): Promise<void> {
  const nombre = seccionUpsell(config)?.name?.trim() || "ese";
  const precio = getUpsellPriceSoles(
    isDiscountActiveForConversation(convo, config),
    convo.phone
  );
  const conPrecio =
    precio == null
      ? ""
      : ` Son ${formatConversationAmount(convo, precio, config)}.`;
  await sendBotText(
    convo,
    `Ese va aparte 😊 *${nombre}* es una compra nueva, así que se paga completo: ` +
      `no se le descuenta lo que ya pagaste.${conPrecio}`
  );
}

/**
 * «¿A CUÁL TE REFIERES?» — con los dos nombres delante.
 *
 * Nunca dice «el full» ni «el upsell»: el cliente no conoce esas palabras. Dice
 * los nombres configurados, y de paso deja explicada la regla —de uno se puede
 * completar, del otro no— para que la respuesta ya venga informada.
 */
async function preguntarPorCualDeLosDos(
  convo: ConversationRow,
  config: WorkflowConfig | null
): Promise<void> {
  const laCara = getActiveTwoTierOffer(config)?.combo?.name?.trim();
  const elExtra = seccionUpsell(config)?.name?.trim();
  // Sin los dos nombres no se puede preguntar sin sonar a formulario. Ahí se
  // deja pasar el turno y contesta el modelo, que es lo que hacía antes.
  if (!laCara || !elExtra) return;
  await sendBotText(
    convo,
    `¿A cuál te refieres? 😊\n\n` +
      `• *${laCara}* — sí, puedes completar lo que ya pagaste.\n` +
      `• *${elExtra}* — ese va aparte y se paga completo.`
  );
}

async function enmarcarElReenvio(convo: ConversationRow): Promise<void> {
  const pasos = loadWorkflowConfig()?.payment_resend_steps;
  await sendConfiguredSteps(convo, pasos as ResponseStep[] | undefined);
}

/**
 * Envía el mensaje configurable de redirección por país (ej. Ecuador) — cada
 * elemento de country_redirect.<pais> es una burbuja (un mensaje). Lo dispara
 * el handler cuando la IA emite el marcador <<PAIS: ...>>. El texto es editable
 * desde el panel; el sistema lo manda (número exacto, sin que la IA lo invente).
 */
export async function sendCountryRedirect(
  convo: ConversationRow,
  pais: "ecuador"
): Promise<void> {
  const config = loadWorkflowConfig();
  const bubbles = config?.country_redirect?.[pais];
  if (!Array.isArray(bubbles) || bubbles.length === 0) return;
  for (const step of bubbles) {
    const s = step as { body?: string; body_variants?: string[] };
    const text = pickVariant(s.body_variants, s.body) ?? "";
    if (text.trim()) await sendBotText(convo, text);
    /* TODA SERIE DE BURBUJAS RESPETA SU TIEMPO. ESTA ERA LA ÚNICA QUE NO.
     *
     * ORDEN DEL DUEÑO — 29 de septiembre de 2026, con sus palabras: «de ahora en
     * adelante toda serie de burbujas consecutivas tienen que respetar su tiempo,
     * incluso en la intro de order bump, regalos etc, todas».
     *
     * SE AUDITARON LOS CATORCE SITIOS que mandan burbujas seguidas. Trece ya
     * respetaban `delay_after_sec`: la intro, los seguimientos, la entrega de la
     * postventa, el regalo, el consentimiento del regalo, el cierre de la ruta B,
     * la intro del order bump, la intro del upsell, su pregunta, sus burbujas de
     * «qué trae», la intro de la oferta, la respuesta al elegir y el pago directo.
     * Esta —la redirección por país— era la única que las mandaba de corrido.
     *
     * Y SU CONTENIDO YA TRAE EL CAMPO: en su YAML estas burbujas llevan
     * `delay_after_sec` escrito. Estaba puesto y no se leía, así que subirlo en el
     * editor no hacía nada.
     */
    const espera = (step as { delay_after_sec?: number }).delay_after_sec ?? 0;
    if (espera > 0) await new Promise((res) => setTimeout(res, espera * 1000));
  }
}

async function presentChoiceAndWait(
  convo: ConversationRow,
  state: WorkflowState,
  sendPresentation: () => Promise<void>
): Promise<void> {
  const startAt = Math.floor(Date.now() / 1000);
  setConversationState(convo.id, state);
  choicePresentationWindows.set(convo.id, {
    state,
    startAt,
    endAt: null,
    keepUntil: startAt + 180,
  });
  try {
    await sendPresentation();
  } finally {
    const endAt = Math.floor(Date.now() / 1000);
    choicePresentationWindows.set(convo.id, {
      state,
      startAt,
      endAt,
      keepUntil: endAt + 180,
    });
    setConversationState(convo.id, state);
  }
}

async function presentOrderBumpAndWaitForChoice(
  convo: ConversationRow
): Promise<void> {
  // SU CAMINO NO LLEGA A NINGUNA INTRO DE ORDER BUMP: SE QUEDA TRABADO (18/10/2026). «Mejor se
  // quede trabado, porque luego reconecto y sigue en humano y ni cuenta me doy». Ni se destapa,
  // ni cambia de estado, ni se le manda la intro de siempre: queda como estaba, y la pizarra
  // marca dónde termina ese camino. Solo pasa con caminos puestos. Ver `etiqueta-de-camino.ts`.
  {
    const config = loadWorkflowConfig();
    const apunte: { faltaLaDeSuCamino?: boolean } = {};
    if (config?.order_bump) {
      sorteaCajonDeIntro(config.order_bump.intro_groups, convo.id, getEffectiveCountryCode(convo.phone, config), apunte, true, convo.camino ?? "");
    }
    if (apunte.faltaLaDeSuCamino) {
      console.log(
        `[wf:camino] convo ${convo.id}: el camino «${convo.camino || "principal"}» no llega a ninguna intro de order bump: se queda aquí`
      );
      return;
    }
  }
  // A partir de aquí el cliente YA conoce las 2 opciones. Queda anotado para
  // siempre: si más adelante manda un comprobante sin elegir, se le puede pedir
  // que elija — antes de este momento, no.
  markOrderBumpRevealed(convo.id);
  await presentChoiceAndWait(convo, "awaiting_order_bump_choice", () =>
    sendOrderBump(convo)
  );
}

/**
 * Burbuja de AYUDA del order bump. Tras responder una pregunta de INFO de los
 * productos en la etapa de elección, agrega un recordatorio CORTO de las 2
 * opciones (personalizable, con spintax {a|b|c} y comodines {{OPCION_1}}…) para
 * que el cliente aturdido elija sin releer todo. Se dispara SOLO cuando el
 * cliente pidió info de los productos (NO en precio/pago), para no soltar los
 * productos cuando el "¿cuál eliges?" se refiere al método de pago.
 */
export function getOrderBumpChoiceHelperBubbles(
  convo: ConversationRow,
  customerMsg: string
): string[] | null {
  const config = loadWorkflowConfig();
  const ob = config?.order_bump;
  if (ob?.choice_helper_enabled !== true) return null;
  if (convo.state !== "awaiting_order_bump_choice") return null;
  const msg = (customerMsg ?? "").toLowerCase();
  const isContentQ =
    /\b(como es|que es|q es|que trae|q trae|incluye|contiene|contenido|informacion|info|explicame|detalles|sirve|funciona|material|producto|combo|basico|mega|kit|pack|diferencia|cual|opcion|opciones|eran 2|son 2|los 2|ambos)\b/.test(
      msg
    );
  if (!isContentQ || isPriceQuestion(msg)) return null;
  const steps = Array.isArray(ob.choice_helper)
    ? ob.choice_helper.filter(
        (s) => (s as { enabled?: boolean }).enabled !== false
      )
    : [];
  // Texto crudo de cada burbuja (con spintax/comodines); se resuelven al enviar.
  const bubbles = steps
    .map((s) => {
      const t = s as { body_variants?: string[]; body?: string };
      return (pickVariant(t.body_variants, t.body) ?? "").trim();
    })
    .filter(Boolean);
  return bubbles.length > 0
    ? bubbles
    : ["*Opción 1* — {{OPCION_1}}\n*Opción 2* — {{OPCION_2}}"];
}

async function sendCommercialRouteBIntroClosing(
  convo: ConversationRow
): Promise<void> {
  const config = loadWorkflowConfig();
  const steps = config?.commercial_routes?.route_b_closing_steps?.filter(
    (step) => step.enabled !== false
  );
  if (!config || !Array.isArray(steps) || steps.length === 0) return;
  const price =
    lockPaymentPrice(
      convo,
      getEffectivePriceSoles(
        isDiscountActiveForConversation(convo, config),
        convo.phone
      ),
      "base",
      config
    ) ?? getLockedOrCurrentBasePrice(convo, config);
  for (const step of steps) {
    await sendResponseStep(convo, step, price, true);
    const delay = (step as { delay_after_sec?: number }).delay_after_sec ?? 0;
    if (delay > 0) await new Promise((res) => setTimeout(res, delay * 1000));
  }
}

async function presentDobleOfertaAndWaitForChoice(
  convo: ConversationRow
): Promise<void> {
  await presentChoiceAndWait(convo, "awaiting_doble_oferta_dos_choice", () =>
    sendDobleOfertaChoice(convo)
  );
}

/**
 * QUÉ PASA AL TERMINAR LA ENTREGA del producto.
 *
 * Existe para que las DOS ramas que terminan una entrega —la del paso enviado
 * y la del paso apagado— hagan exactamente lo mismo. Antes cada una repetía el
 * bloque, y era el sitio perfecto para que el regalo se perdiera en una.
 *
 * Sin upsell usable, hace literalmente lo de siempre.
 */
export async function continuarTrasEntrega(
  convo: ConversationRow
): Promise<void> {
  const config = loadWorkflowConfig();
  let fresco = getConversationById(convo.id) ?? convo;
  // UPSELLS EN FILA — ¿LE TOCA EL SIGUIENTE PRODUCTO?
  //
  // Si acaba de pagar la oferta en curso y la fila tiene otro producto para él, la
  // conversación pasa a ese con la máquina del upsell a cero, y todo lo de abajo sigue
  // como siempre: «se le debe la oferta», con los minutos de ESE producto. Si no queda
  // nada, no se toca nada y sale el regalo, como hoy.
  //
  // SIN FILA PUESTA ESTO NO HACE NADA: devuelve false sin leer ni escribir. Ver
  // `prepararElSiguienteDeLaFila` y PLAN-UPSELLS-EN-FILA.md.
  if (prepararElSiguienteDeLaFila(fresco, config)) {
    fresco = getConversationById(convo.id) ?? fresco;
  }
  // ¿SE LE DEBE TODAVÍA LA SEGUNDA OFERTA?
  //
  // Antes se preguntaba solo por "nunca se le ofreció" (upsell_state vacío), y
  // eso perdía la oferta entera en un caso muy normal:
  //
  //   1. Se entrega el primer producto → se marca "esperando" y la oferta queda
  //      programada para dentro de N minutos.
  //   2. El cliente dice "no me llegó mi link" y el bot reenvía el material.
  //      Reenviar CANCELA todas las acciones pendientes de la conversación
  //      —para no duplicar entregas— y con ellas se lleva la oferta.
  //   3. Al terminar el reenvío se vuelve a pasar por aquí, pero el estado ya
  //      dice "esperando", así que no entraba: se iba directo al regalo.
  //
  // La segunda venta se perdía en silencio, y encima por un cliente que estaba
  // pendiente de su compra. Pasó de verdad, en la convo 29.
  //
  // "esperando" significa "se le debe la oferta". Si además no queda ninguna
  // programada, es que se canceló y hay que volver a programarla. Preguntar por
  // la acción pendiente conserva la protección de siempre —dos entregas
  // seguidas no programan la oferta dos veces— y arregla el caso perdido.
  const laOfertaSigueDebiendose =
    !fresco.upsell_state ||
    (fresco.upsell_state === "esperando" &&
      !hasPendingActionType(convo.id, ACTION_UPSELL_PRESENTAR));
  if (isUpsellUsable(config) && laOfertaSigueDebiendose) {
    // ESPERAR ANTES DE OFRECER.
    //
    // Encadenar la segunda oferta al mismo segundo en que llega la entrega se
    // lee como prisa. Con retraso_minutos se deja pasar un rato y llega como
    // otro mensaje, no como la coleta del anterior.
    //
    // Sin el campo, o con 0, se ofrece enseguida: es lo que se hacía siempre y
    // lo que siguen haciendo las modalidades de antes.
    const retraso = Math.max(
      0,
      Math.floor(seccionUpsell(config)?.retraso_minutos ?? 0)
    );
    if (retraso > 0) {
      // El estado se marca YA, no al presentarlo. Si se dejara sin marcar, una
      // segunda entrega dentro de esos minutos volvería a entrar aquí y
      // programaría la oferta dos veces.
      setUpsellState(convo.id, "esperando");
      scheduleAction(
        convo.id,
        ACTION_UPSELL_PRESENTAR,
        {},
        Math.floor(Date.now() / 1000) + retraso * 60
      );
      console.log(
        `[wf:upsell] convo ${convo.id}: lo ofrezco en ${retraso} min`
      );
      return;
    }
    try {
      await presentarUpsell(fresco);
      return;
    } catch (err) {
      // Si ofrecer el upsell falla, el regalo NO se pierde: se sigue el
      // camino de siempre. Prefiero perder la segunda venta que el regalo.
      console.error(
        `[wf:upsell] convo ${convo.id}: no pude ofrecerlo, sigo con el regalo:`,
        err
      );
    }
  }

  // SI NO SE OFRECE POR ESTAR A MEDIAS, QUE SE SEPA POR QUÉ.
  //
  // Antes esto se saltaba en silencio: el bot entregaba, seguía con el regalo, y
  // en el log no quedaba ni una línea. Desde fuera «no se ofrece» y «está roto»
  // se ven exactamente igual, y la única forma de averiguarlo era volver a
  // probar la venta entera a ciegas. Se pierde una tarde para descubrir que
  // faltaba una casilla.
  //
  // Se avisa SOLO de lo que le falta, no de que no tocaba: si ya se ofreció
  // antes —`laOfertaSigueDebiendose` en falso— no hay nada que explicar. Y solo
  // si alguien empezó a llenarla: una modalidad que nunca la usó no tiene por
  // qué llenar el log en cada venta.
  const loQueLeFalta = queLeFaltaAlUpsell(config);
  if (loQueLeFalta.length > 0 && (seccionUpsell(config)?.name ?? "").trim()) {
    console.log(
      `[wf:upsell] convo ${convo.id}: NO lo ofrezco — le falta ${loQueLeFalta.join(
        ", "
      )}`
    );
  }

  // EL SEGUNDO PRODUCTO SIGUE EN JUEGO: EL REGALO ESPERA.
  //
  // Esta entrega puede no ser la primera. Cuando el cliente sube de básico a
  // combo, se le entrega OTRA vez — y para entonces la oferta del extra ya está
  // hecha, o incluso aceptada y esperando su pago.
  //
  // Soltar el regalo ahí deja DOS preguntas abiertas a la vez y el cliente no
  // sabe a cuál está contestando. Pasó de verdad: dijo "sí quiero comprarlo"
  // pensando en el extra y el bot le contestó por el regalo.
  //
  // El plazo del extra ya tenía esta misma regla, pero solo en su temporizador.
  // Aquí faltaba. Y hace falta REPONERLO: la entrega cancela todo lo pendiente
  // de la conversación, así que ese plazo se perdió por el camino y sin volver a
  // ponerlo el regalo no llegaría nunca.
  // Y SI LA OFERTA SE QUEDÓ SIN CONTESTAR, SE LE RECUERDA. UNA VEZ.
  //
  // LO QUE COSTÓ — 14 de septiembre de 2026, con sus palabras: «luego del
  // upgrade y al no haber comprado el upsell, no le recuerda sobre el producto
  // del upsell».
  //
  // Se le ofrecía el extra, el cliente se ponía a completar su upgrade, y al
  // terminar la oferta seguía «ofrecida» pero sepultada bajo toda la
  // conversación del upgrade y su entrega. Nadie volvía a nombrarla: aquí solo
  // se reponía el plazo del regalo, salía el regalo y la segunda venta se
  // perdía sin que nada fallara.
  //
  // AQUÍ SE VOLVÍA A ENCOLAR LA PRESENTACIÓN ENTERA, Y ESO ESTABA MAL.
  //
  // Se reprogramaba `upsell_presentar`, o sea la intro completa del extra con
  // sus burbujas y sus botones. Y como por aquí se pasa después de CUALQUIER
  // entrega —incluido el reenvío de «no me llegó mi enlace»—, al cliente le
  // llegaba la presentación por segunda vez. El 15 de septiembre de 2026, con
  // sus palabras: «luego de reenviar el enlace, nuevamente se envía la intro
  // del upsell. Eso no debería pasar».
  //
  // Lo que había pedido no era repetir la intro: «un pequeño recordatorio,
  // quizás un mensaje predeterminado sin costo que diga amablemente si le
  // interesa el upsell». Eso es lo que sale ahora, y una sola vez —«luego ya no,
  // para no hostigar al cliente»—.
  //
  // SOLO «OFRECIDO», y eso es todo el cuidado que hace falta:
  //  · «aceptado» ya dijo que sí y está pagando — recordárselo sería dudar de
  //    él y puede hacerle pagar dos veces.
  //  · «rechazado» dijo que no. No se insiste.
  //  · «pagado» ya lo compró.
  if (fresco.upsell_state === "ofrecido") {
    programarRecordatorioDelUpsell(fresco, "tras la entrega");
  }

  if (
    fresco.upsell_state === "ofrecido" ||
    fresco.upsell_state === "aceptado"
  ) {
    if (!hasPendingActionType(convo.id, ACTION_UPSELL_TIMEOUT)) {
      // Un solo plazo, el de la sección Regalo, y contado desde el cliente.
      const minutos = Math.round(
        segundosDeSilencioAntesDelRegalo(config) / 60
      );
      scheduleAction(
        convo.id,
        ACTION_UPSELL_TIMEOUT,
        {},
        Math.floor(Date.now() / 1000) +
          loQueFaltaDeSilencio(
            convo.id,
            segundosDeSilencioAntesDelRegalo(config)
          )
      );
      console.log(
        `[wf:upsell] convo ${convo.id}: el extra sigue en juego, el regalo espera ${minutos} min`
      );
    } else {
      console.log(
        `[wf:upsell] convo ${convo.id}: el extra sigue en juego, el regalo espera`
      );
    }
    return;
  }
  seguirConRegalo(convo.id);
}

/** El cierre postventa de siempre: encuesta y regalo.
 *
 * No cambia el estado a awaiting_email: ese estado significa que el cliente
 * eligió explícitamente recibir también por correo. La postventa normal y el
 * camino «Solo WhatsApp» permanecen en payment_approved. */
function seguirConRegalo(conversationId: number): void {
  scheduleCustomerSurveyFallback(conversationId);
  const convo = getConversationById(conversationId);
  if (convo?.gift_rewarded) {
    console.log(
      `[wf] convo ${conversationId}: regalo ya entregado, no reprogramo consent`
    );
    return;
  }
  const cfg = loadWorkflowConfig();
  const timeoutSec =
    cfg?.awaiting_email_timeout_seconds ?? DEFAULT_AWAITING_EMAIL_TIMEOUT;
  // EL SILENCIO SE MIDE DESDE EL CLIENTE, NO DESDE AQUÍ.
  //
  // Aquí se llega cuando le toca el turno al regalo —normalmente al cerrarse la
  // ventana del segundo producto—, y programar `timeoutSec` desde este instante
  // sumaba las dos esperas. El dueño escribía un número y le salía otro.
  // Ver `loQueFaltaDeSilencio`.
  scheduleGiftConsentWithDelay(
    conversationId,
    loQueFaltaDeSilencio(conversationId, timeoutSec)
  );
}

/**
 * UPSELL — suelta la segunda intro entera, sin preguntar, y termina con el
 * "¿deseas llevarlo?". Deja la oferta abierta: si no contesta, a los N minutos
 * sale el regalo igual, pero seguirá pudiendo aceptarla por su nombre.
 */
/**
 * EL RECORDATORIO DEL EXTRA: una línea suya, una sola vez, sin pasar por el
 * modelo.
 *
 * NO ES PRESENTARLO. Presentar es la intro entera: sus burbujas, su galería y
 * sus botones. Esto es el texto que él escribe en el editor y nada más. La
 * diferencia importa porque antes se reencolaba la presentación, y al cliente
 * que pedía «no me llegó mi enlace» le volvía a caer la intro completa.
 *
 * CUÁNDO SE LLAMA, y son los dos casos que él describió:
 *
 *   · tras la entrega de un upgrade — compró, subió de opción, y la oferta del
 *     extra se quedó enterrada bajo esa conversación.
 *   · tras contestar al regalo — el regalo es lo último que queda, así que si
 *     se va de ahí sin que nadie nombre el extra, la segunda venta se pierde.
 *
 * UNA VEZ Y NO MÁS. Con sus palabras: «solo 1 vez luego ya no para no hostigar
 * al cliente».
 */
function programarRecordatorioDelUpsell(
  convo: ConversationRow,
  desde: string
): void {
  const config = loadWorkflowConfig();
  const up = seccionUpsell(config);
  const texto = up?.recordatorio?.trim();
  // SIN TEXTO NO PASA NADA, y es a propósito: mientras no lo escriba en el
  // editor, el bot se comporta EXACTAMENTE como antes de que esto existiera.
  if (!texto) return;
  // SIN NOMBRE DEL EXTRA, TAMPOCO. El comodín {{PRODUCTO_UPSELL}} se resuelve
  // vacío a propósito —«es preferible un hueco a nombrar algo que no se
  // vende»—, pero un hueco en una frase suelta se lee como un error del bot.
  // Antes callado que cojo.
  if (!(up?.name ?? "").trim()) return;
  // LA GUARDA QUE YA ESTABA EN EL BLOQUE QUE ESTO SUSTITUYE, Y SE CONSERVA.
  //
  // Si el extra no se puede vender —le falta la entrega, el precio o el
  // contenido— recordarlo es peor que callarse: el cliente diría que sí y no
  // habría nada que darle. En la práctica el estado ya lo cubre (sin poder
  // venderlo nunca se llegó a «ofrecido»), pero esta regla estaba escrita y no
  // se quita por sobrar hoy.
  if (!isUpsellUsable(config)) return;
  if (convo.upsell_recordatorio_enviado) return;
  if (hasPendingActionType(convo.id, ACTION_UPSELL_RECORDATORIO)) return;
  // Su propio ritmo, el mismo de la oferta: encadenarlo al segundo en que
  // termina lo anterior se lee como prisa. Con 0 sale enseguida.
  const retraso = Math.max(0, Math.floor(up?.retraso_minutos ?? 0));
  scheduleAction(
    convo.id,
    ACTION_UPSELL_RECORDATORIO,
    {},
    Math.floor(Date.now() / 1000) + retraso * 60
  );
  console.log(
    `[wf:upsell] convo ${convo.id}: la oferta se quedó sin contestar ${desde} → se la recuerdo en ${retraso} min (una sola vez)`
  );
}

/** Manda el recordatorio. Ver `programarRecordatorioDelUpsell`. */
async function recordarElUpsell(convo: ConversationRow): Promise<void> {
  const config = loadWorkflowConfig();
  const up = seccionUpsell(config);
  const texto = up?.recordatorio?.trim();
  if (!texto) return;
  const alDia = getConversationById(convo.id) ?? convo;
  // SE VUELVE A MIRAR AL SALIR, no solo al programar. Entre una cosa y otra
  // pasan minutos, y en esos minutos el cliente pudo decir que sí, decir que no
  // o pagarlo. Recordarle algo que ya compró es peor que no recordarlo.
  if (alDia.upsell_state !== "ofrecido") {
    console.log(
      `[wf:upsell] convo ${convo.id}: no lo recuerdo, la oferta ya está en «${alDia.upsell_state}»`
    );
    return;
  }
  // EL CANDADO DE UNA SOLA VEZ, y vive en la base de datos a propósito: las dos
  // puertas que lo mandan pueden coincidir en la misma conversación. El que
  // llega segundo recibe false y se calla.
  if (!marcarRecordatorioUpsellEnviado(convo.id)) {
    console.log(
      `[wf:upsell] convo ${convo.id}: el recordatorio ya había salido, no insisto`
    );
    return;
  }
  const precioDelExtra =
    getUpsellPriceSoles(
      isDiscountActiveForConversation(alDia, config),
      alDia.phone,
      config
    ) ?? undefined;
  // Sale por el camino de siempre, y con el MISMO cuarto parámetro que la
  // presentación, para que sus comodines se resuelvan igual: {{PRODUCTO_UPSELL}},
  // {{PRECIO_UPSELL}} y los demás. No pasa por el modelo: es su texto.
  await sendResponseStep(
    alDia,
    { type: "text", body: texto } as ResponseStep,
    precioDelExtra,
    true
  );
  console.log(
    `[wf:upsell] convo ${convo.id}: recordatorio enviado — no se vuelve a mandar`
  );
}

async function presentarUpsell(convo: ConversationRow): Promise<void> {
  const config = loadWorkflowConfig();
  const up = seccionUpsell(config);
  if (!up) return;

  // SIN RESPALDO ENTRE PAÍSES Y SIN UPSELL DE SU PAÍS: no se ofrece, y se sigue con el regalo
  // (16/10/2026). Se LANZA a propósito, antes de tocar nada: las tres puertas que llaman aquí
  // ya atrapan el fallo y siguen con el regalo — «prefiero perder la segunda venta que el
  // regalo» —, así que se reusa ese camino probado en vez de escribir otro.
  if (config && !usaRespaldoEntrePaises(config)) {
    const apunte: { faltaLaSuya?: boolean } = {};
    sorteaCajonDeIntro(
      up.intro_groups,
      convo.id,
      getEffectiveCountryCode(convo.phone, config),
      apunte,
      // En fila, sin la guarda de tienda: si no, cortaría antes de mirar el país.
      !up.de_la_fila
    );
    if (apunte.faltaLaSuya) {
      throw new Error(
        "su país no tiene upsell propio y el respaldo entre países está apagado"
      );
    }
  }
  // SIN RESPALDO ENTRE TIENDAS Y SIN UPSELL DE ESTA TIENDA: igual, se lanza antes de tocar nada
  // y las puertas que llaman siguen con el regalo (17/10/2026).
  // (Un upsell EN FILA no: su tienda ya la eligió la fila. Ver `sorteaCajonDeIntro`.)
  if (config && !usaRespaldoEntreTiendas(config) && !up.de_la_fila) {
    const apunte: { faltaLaSuya?: boolean; faltaLaDeSuTienda?: boolean } = {};
    sorteaCajonDeIntro(up.intro_groups, convo.id, getEffectiveCountryCode(convo.phone, config), apunte);
    if (apunte.faltaLaDeSuTienda) {
      throw new Error("esta tienda no tiene upsell propio y el respaldo entre tiendas está apagado");
    }
  }

  // FOTO DE LO PAGADO. Lo que entre por encima de esto es lo que cuenta para
  // el segundo producto; así la primera venta queda intacta y las dos no se
  // mezclan en el mismo contador.
  setUpsellBaseCents(convo.id, convo.paid_total_cents);
  setUpsellState(convo.id, "ofrecido");

  // EL PRECIO DE ESTE PRODUCTO, NO EL DEL CURSO.
  //
  // {price} vale, por defecto, el precio del producto que ya compró. En la
  // invitación al producto extra eso es un número EQUIVOCADO, no un hueco
  // vacío: se le anunciaría el extra al precio del primero. Y como sale un
  // número creíble, nadie lo nota hasta que alguien paga de menos.
  //
  // Se pasa el precio del extra igual que hace el order bump con el de cada
  // opción, y con el descuento de la conversación si lo tiene.
  const precioDelExtra =
    getUpsellPriceSoles(
      isDiscountActiveForConversation(convo, config),
      convo.phone,
      config
    ) ?? undefined;

  // SE CONGELA EL PRECIO AQUÍ, QUE ES DONDE SE LE DICE.
  //
  // A partir de este mensaje el cliente tiene un número en la pantalla. Si el
  // precio se toca en el panel mientras decide, el comprobante se validaba
  // contra el nuevo: se le pedía uno y se le contaba otro. No falla con ruido
  // — le dice que le falta dinero a quien pagó lo que se le pidió.
  //
  // Se guardan los DOS importes, normal y de oferta, porque cuál toca lo decide
  // el estado de descuento al validar, no ahora. Y se conserva el PRIMERO: si
  // por lo que sea se volviera a pasar por aquí, vale lo que ya se le dijo.
  if (config && !getUpsellFrozenPrices(convo)) {
    setUpsellFrozenPrices(convo.id, {
      modalidad: getActiveModalityKey(config),
      regular: getUpsellPriceSoles(false, convo.phone, config),
      discount: getUpsellPriceSoles(true, convo.phone, config),
      at: Math.floor(Date.now() / 1000),
    });
  }

  // La intro sale de los cajones y se sortea por peso; sin cajones, la de
  // siempre. Igual que en la oferta de Order Bump.
  const introDelUpsell =
    sorteaCajonDeIntro(
      up.intro_groups,
      convo.id,
      getEffectiveCountryCode(convo.phone, config),
      undefined,
      !up.de_la_fila
    ) ??
    up.intro ??
    [];
  for (const step of introDelUpsell) {
    if ((step as { enabled?: boolean }).enabled === false) continue;
    // El último true resuelve TAMBIÉN {{precio_1}}, {{precio_2}} y
    // {{precio_upsell}}. Sin él, la invitación al tercer producto no podía
    // nombrar lo que la clienta ya compró ("ya llevas el {{opcion_1}}, súmale
    // el X por {{precio_upsell}}") y los comodines salían crudos en el chat.
    await sendResponseStep(convo, step as ResponseStep, precioDelExtra, true);
    const d = (step as { delay_after_sec?: number }).delay_after_sec ?? 0;
    if (d > 0) await new Promise((res) => setTimeout(res, d * 1000));
  }

  // LA PREGUNTA, QUE AHORA SON BURBUJAS.
  //
  // La última burbuja encendida es la pregunta: la que lleva los botones. Las
  // de antes salen tal cual, en orden, igual que la intro de arriba.
  //
  // Si la última NO es texto, no hay cuerpo donde colgar los botones. Entonces
  // se mandan TODAS las burbujas —no se pierde nada— y la pregunta sale del
  // campo de texto de siempre. El editor avisa de esto en amarillo.
  const todasLasDePregunta = up.pregunta_steps ?? [];
  const burbujasDePregunta = todasLasDePregunta.filter(
    (step) => (step as { enabled?: boolean }).enabled !== false
  );
  // APAGARLA TIENE QUE APAGARLA.
  //
  // Hay burbujas, pero están TODAS apagadas: eso es alguien diciendo "no quiero
  // esta pregunta". Antes se caía igual al texto de respaldo y la pregunta salía
  // lo mismo — el interruptor no servía para nada.
  //
  // No es el mismo caso que no tener ninguna burbuja: ahí el respaldo sí vale,
  // porque es una configuración que todavía nadie tocó.
  const apagadaAProposito =
    todasLasDePregunta.length > 0 && burbujasDePregunta.length === 0;
  if (apagadaAProposito) {
    console.log(
      `[wf:upsell] convo ${convo.id}: la pregunta del final está apagada, no la mando`
    );
  }
  let textoDeLaUltima = "";
  if (burbujasDePregunta.length > 0) {
    const ultima = burbujasDePregunta[burbujasDePregunta.length - 1] as
      ResponseStep & { body?: string; body_variants?: string[] };
    const ultimaEsTexto = (ultima.type ?? "text") === "text";
    if (ultimaEsTexto) {
      textoDeLaUltima = pickVariant(ultima.body_variants, ultima.body) ?? "";
    } else {
      console.warn(
        `[wf:upsell] convo ${convo.id}: la última burbuja de la pregunta no es texto → los botones no tienen dónde ir; uso el texto de respaldo`
      );
    }
    const previas = ultimaEsTexto
      ? burbujasDePregunta.slice(0, -1)
      : burbujasDePregunta;
    for (const step of previas) {
      await sendResponseStep(convo, step as ResponseStep, precioDelExtra, true);
      const d = (step as { delay_after_sec?: number }).delay_after_sec ?? 0;
      if (d > 0) await new Promise((res) => setTimeout(res, d * 1000));
    }
  }

  // La pregunta también: es el sitio natural para rematar con el precio
  // ("¿lo llevas por {price}?"), y salía sin resolver.
  const preguntaCruda = apagadaAProposito
    ? ""
    : textoDeLaUltima.trim() ||
      pickVariant(up.pregunta_variants, up.pregunta) ||
      "";
  // La pregunta pasa por los MISMOS dos renderizadores que la invitación: es
  // el sitio natural para rematar con el precio ("¿lo llevas por
  // {{precio_upsell}}?") y salía tal cual, con las llaves a la vista.
  const pregunta = applyPriceTemplate(
    renderOrderBumpTemplate(
      preguntaCruda,
      isDiscountActiveForConversation(convo, config),
      convo.phone
    ),
    precioDelExtra ?? getLockedOrCurrentBasePrice(convo, config),
    convo
  );
  let mandada = false;
  if (up.use_buttons) {
    const cuerpo = cuerpoDeBotones(pregunta, "upsell: ¿deseas llevarlo?");
    const titulos = titulosDeBotones(
      [up.boton_si, up.boton_no],
      "upsell: nombres de los 2 botones"
    );
    if (cuerpo && titulos) {
      await sendBotButtons(convo, cuerpo, [
        { id: "upsell_si", title: titulos[0] },
        { id: "upsell_no", title: titulos[1] },
      ]);
      mandada = true;
    }
  }
  if (!mandada && pregunta.trim()) {
    await sendBotText(convo, pregunta);
  }

  // ÚLTIMA COSA DICHA: esta oferta. Con esto, un «sí» a secas que llegue ahora
  // es suyo — y deja de serlo en cuanto hable alguien más. Ver
  // `laOfertaSigueSiendoLaUltimaPregunta`.
  setUpsellHabladoAt(convo.id);

  // UN SOLO PLAZO, EL DE LA SECCIÓN REGALO. Ver
  // `segundosDeSilencioAntesDelRegalo`: antes esto leía los minutos de la
  // pestaña Upsell y se sumaban a los segundos de la de Regalo.
  // (Con fila y downsell detrás, el del downsell: ver `segundosDelPlazoDeLaOferta`.)
  const segundos = segundosDelPlazoDeLaOferta(
    convo,
    config,
    segundosDeSilencioAntesDelRegalo(config)
  );
  scheduleAction(
    convo.id,
    ACTION_UPSELL_TIMEOUT,
    {},
    Math.floor(Date.now() / 1000) + loQueFaltaDeSilencio(convo.id, segundos)
  );
  console.log(
    `[wf:upsell] convo ${convo.id}: ofrecido (regalo en ${segundos}s de silencio si no contesta)`
  );
}

/**
 * Pregunta por el contenido del segundo producto durante la oferta.
 *
 * Se responde con lo SUYO y sin gastar un token: primero su galería (si alguna
 * palabra clave encaja), luego sus burbujas de "qué trae", y si no hay nada
 * configurado, su respuesta genérica. Si tampoco la hay, devuelve false y lo
 * lleva el modelo como cualquier otra duda.
 *
 * Nunca lee el contenido ni la galería de otra modalidad (regla 5-bis).
 */
async function responderContenidoDelUpsell(
  convo: ConversationRow,
  msgContent: string,
  config: WorkflowConfig | null
): Promise<boolean> {
  // Por seccionUpsell y no por config.upsell: esta función responde con la
  // galería y el contenido del producto extra, y leerlo a pelo servía el de la
  // modalidad Upsell aunque estuviera vendiendo Doble Oferta + Upsell. Es
  // exactamente lo que prohíbe la regla 5-bis del comentario de arriba.
  const up = seccionUpsell(config);
  if (!up) return false;
  if (!looksLikeGuidedContentQuestion(msgContent)) return false;

  // RESPONDER SOBRE EL EXTRA NO ES CAMBIAR DE TEMA.
  //
  // Las tres salidas de aquí abajo vuelven a sellar la oferta como lo último
  // dicho, porque hablan DE ELLA: quien pregunta «¿qué incluye?» y luego dice
  // «si» está diciendo que sí a esto, no a otra cosa. Sin el sello, contestarle
  // su propia duda le habría quitado el derecho a aceptar con un «sí».
  const seguimosEnLoMismo = (): true => {
    setUpsellHabladoAt(convo.id);
    return true;
  };

  // 1. Su galería: el item cuyas palabras clave encajen.
  const texto = msgContent
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "");
  const item = (up.image_gallery ?? []).find((g) => {
    if (g.enabled === false || !g.drive_url?.trim()) return false;
    const claves = [g.topic, ...(g.keywords ?? [])]
      .map((k) => (k ?? "").trim().toLowerCase())
      .filter((k) => k.length >= 3);
    return claves.some((k) => texto.includes(k));
  });
  if (item?.drive_url && item.media_type) {
    const pie = pickVariant(item.caption_variants, item.caption);
    await enviarMuestraDeGaleria(convo, item, pie ?? undefined);
    console.log(`[wf:upsell] convo ${convo.id}: mandé su media "${item.topic}"`);
    return seguimosEnLoMismo();
  }

  // 2. Sus burbujas de "qué trae".
  const pasos = (up.info_steps ?? []).filter((s) => s.enabled !== false);
  if (pasos.length > 0) {
    for (const paso of pasos) {
      await sendResponseStep(convo, paso as ResponseStep, undefined, false);
      const d = (paso as { delay_after_sec?: number }).delay_after_sec ?? 0;
      if (d > 0) await new Promise((res) => setTimeout(res, d * 1000));
    }
    console.log(`[wf:upsell] convo ${convo.id}: respondí con sus burbujas`);
    return seguimosEnLoMismo();
  }

  // 3. Su respuesta genérica, para lo que no anticipó.
  const generica = (up.respuesta_generica ?? "").trim();
  const contradiceLaOferta =
    /no\s+(tenemos|hay|vendemos)|solo\s+(trabajamos|vendemos)|no\s+existen?\s+(otros|mas)|me\s+equivoqu[eé].*ofrecer/i.test(
      generica
    );
  if (generica && !contradiceLaOferta) {
    await sendBotText(convo, generica);
    console.log(`[wf:upsell] convo ${convo.id}: respuesta genérica`);
    return seguimosEnLoMismo();
  }
  return false;
}

/**
 * Aceptó el segundo producto: se le mandan sus datos de pago con SU precio.
 * El método es el que ya usó en la primera compra, así no vuelve a elegir.
 */
/**
 * Cierra la oferta del segundo producto por un NO: se responde lo configurado y
 * se sigue con el regalo de siempre. Vive aparte porque lo llaman dos caminos
 * —el botón y el "no" escrito— y tenerlo duplicado era la forma de que uno de
 * los dos se olvidara de cancelar la espera y el regalo saliera dos veces.
 */
async function rechazarUpsell(
  convo: ConversationRow,
  config: WorkflowConfig | null,
  // `enviarTexto: false` cuando un cuadrito de la oferta ya le contestó con SUS
  // burbujas. El rechazo se sigue anotando y el regalo sigue su curso: lo único
  // que se calla es el texto de respaldo, para no decirle dos veces lo mismo.
  opciones?: { enviarTexto?: boolean }
): Promise<void> {
  // UPSELLS EN FILA — EL «NO» AL ÚLTIMO, CON DOWNSELL, NO CIERRA: SE OFRECE EL DOWNSELL.
  //
  // Es lo que él pidió: «se aplica solo en el último upsell cuando el cliente no desea
  // comprarlo». Su mensaje hace de respuesta, así que el texto de rechazo no sale. Si el
  // downsell no toca —no hay fila, no es el último, ya se ofreció—, todo sigue abajo
  // exactamente como siempre.
  if (await ofrecerElDownsellSiToca(convo, config)) return;
  // El botón puede pulsarse incluso cuando ya venció el plazo. En ese caso
  // seguimos registrando el rechazo, pero el regalo ya fue iniciado por el
  // timeout y no se debe disparar una segunda vez.
  const regaloPendiente = hasPendingActionType(
    convo.id,
    ACTION_UPSELL_TIMEOUT
  );
  setUpsellState(convo.id, "rechazado");
  cancelPendingActionsByTypeForConvo(convo.id, ACTION_UPSELL_TIMEOUT);
  const rechazo = (seccionUpsell(config)?.respuesta_rechazo ?? "").trim();
  if (opciones?.enviarTexto !== false && rechazo) {
    await sendBotText(convo, rechazo);
  }
  if (regaloPendiente) seguirConRegalo(convo.id);
  // «Si no quiere el primero o el segundo, no se insiste más.» Solo con fila puesta.
  if (config?.filas_de_upsell?.length) pararLaFila(convo.id);
}

/**
 * OFRECE EL DOWNSELL, SI TOCA: el mismo producto, otra vez, a su precio menor.
 *
 * Se pone la máquina del upsell a cero en el downsell (sin precio congelado del normal,
 * sin recordatorio gastado) y se presenta por el camino de siempre, `presentarUpsell`,
 * que ya congela su precio, pone sus botones y su plazo. Devuelve false si no toca.
 *
 * SI FALLA, EL REGALO NO SE PIERDE: se suelta aquí mismo y se da por atendido. La regla
 * de la casa: «prefiero perder la segunda venta que el regalo».
 */
async function ofrecerElDownsellSiToca(
  convo: ConversationRow,
  config: WorkflowConfig | null
): Promise<boolean> {
  const fila = elDownsellQueToca(convo, config);
  if (!fila) return false;
  try {
    const puesto = getPuestoEnLaFila(convo.id);
    cancelPendingActionsByTypeForConvo(convo.id, ACTION_UPSELL_TIMEOUT);
    cancelPendingActionsByTypeForConvo(convo.id, ACTION_UPSELL_RECORDATORIO);
    moverLaFila(convo.id, fila.id, puesto?.upsell_producto_id ?? null, true);
    console.log(`[wf:fila] convo ${convo.id}: ofrezco el downsell`);
    await presentarUpsell(getConversationById(convo.id) ?? convo);
  } catch (err) {
    console.error(
      `[wf:fila] convo ${convo.id}: no pude ofrecer el downsell, sigo con el regalo:`,
      err
    );
    cancelPendingActionsByTypeForConvo(convo.id, ACTION_UPSELL_TIMEOUT);
    pararLaFila(convo.id);
    seguirConRegalo(convo.id);
  }
  return true;
}

export async function entregarDatosDePagoDelUpsell(
  convo: ConversationRow,
  // `enviarDatos: false` cuando un cuadrito de la oferta ya le mandó SUS
  // burbujas con los datos. Se hace igual TODO lo que no se ve —queda anotado
  // que aceptó y con qué método— porque de ese apunte dependen el precio contra
  // el que se valida el comprobante y el producto que se entrega después. Lo
  // único que se salta son las burbujas, para no mandarlas dos veces.
  opciones?: {
    enviarDatos?: boolean;
    /** El operador ya presentó el pago con su texto: el de fábrica sale sin
     *  repetir la presentación. */
    sinPresentacion?: boolean;
  }
): Promise<void> {
  const config = loadWorkflowConfig();
  if (!config) return;
  setUpsellState(convo.id, "aceptado");
  const descuento = isDiscountActiveForConversation(convo, config);
  const precio = getUpsellPriceSoles(descuento, convo.phone) ?? undefined;
  const metodo = convo.selected_payment_method;
  const route: string =
    metodo === "plin"
      ? "yape"
      : metodo && metodo.trim()
        ? metodo
        : getDefaultPaymentMethodId(convo.phone);
  setSelectedPaymentMethod(convo.id, route);
  if (opciones?.enviarDatos === false) {
    console.log(
      `[wf:upsell] convo ${convo.id}: aceptado por un cuadrito — sus burbujas ya llevaban los datos (${route}, ${precio})`
    );
    return;
  }
  const deFabrica = getUpsellPaymentResponses(config, route, convo.phone);
  const responses =
    opciones?.sinPresentacion === true
      ? sinLaPresentacionDeSiempre(deFabrica)
      : deFabrica;
  await schedulePaymentResponses(convo, route, responses, {
    priceSoles: precio,
    sinPresentacion: responses.length < deFabrica.length,
    upsell: true,
  });
  console.log(
    `[wf:upsell] convo ${convo.id}: aceptado → datos de pago (${route}, ${precio})`
  );
}

async function presentBiofertaIntroChoiceAndWait(
  convo: ConversationRow
): Promise<void> {
  await presentChoiceAndWait(convo, "awaiting_bioferta_intro_choice", () =>
    sendBiofertaIntroChoice(convo)
  );
}

/**
 * DOBLE OFERTA — al terminar la intro, suelta las 3 opciones (producto A,
 * producto B y el pack con los dos) para que el cliente elija ANTES de pagar.
 * Los productos ya se describieron en la intro, así que aquí va solo la
 * pregunta: con botones si `use_buttons`, en texto plano si no (y en Messenger
 * los botones se degradan solos a lista numerada, ver sendBotButtons).
 */
async function sendBiofertaIntroChoice(convo: ConversationRow): Promise<void> {
  const config = loadWorkflowConfig();
  const bf = config?.bioferta_doble;
  if (!bf) return;
  const names = getBiofertaIntroChoiceOptions(config);
  if (!names) return;
  const prompt = renderOrderBumpTemplate(
    pickVariant(bf.intro_choice_prompt_variants, bf.intro_choice_prompt) ?? "",
    isDiscountActiveForConversation(convo, config),
    convo.phone
  );
  if (bf.use_buttons) {
    const cuerpo = cuerpoDeBotones(
      prompt,
      "doble oferta: pregunta de las 3 opciones al final de la intro"
    );
    if (!cuerpo) return;
    await sendBotButtons(convo, cuerpo, [
      { id: "bf_a", title: names.a },
      { id: "bf_b", title: names.b },
      { id: "bf_pack", title: names.pack },
    ]);
    return;
  }
  if (prompt.trim()) await sendBotText(convo, prompt);
}

/**
 * ORDER BUMP — envía la oferta intermedia: el intro (imagen + texto con las 2
 * opciones) y luego el prompt de elección (botones si use_buttons, o texto).
 */
async function sendOrderBump(convo: ConversationRow): Promise<void> {
  const config = loadWorkflowConfig();
  const ob = config?.order_bump;
  if (!ob) return;
  // LA INTRO SALE DE LOS CAJONES, Y SE SORTEA POR PESO.
  //
  // Sin cajones —o con todos apagados— se usa la secuencia de siempre, así que
  // un bot que no los toque se comporta exactamente igual que antes.
  const apunteDelPais: { faltaLaSuya?: boolean; faltaLaDeSuTienda?: boolean } = {};
  const delCajon = sorteaCajonDeIntro(
    ob.intro_groups,
    convo.id,
    getEffectiveCountryCode(convo.phone, config),
    apunteDelPais,
    true,
    // La de SU camino (18/10/2026). Ver `etiqueta-de-camino.ts`.
    convo.camino ?? ""
  );
  // SIN RESPALDO ENTRE PAÍSES Y SIN INTRO DE ORDER BUMP DE SU PAÍS: a humano (16/10/2026).
  // Va ANTES de la secuencia de siempre a propósito: ésa también puede ser de otro país. Con
  // el respaldo encendido `faltaLaSuya` puede valer true, pero entonces el cajón de otro país
  // ya vino en `delCajon` y esto no se dispara.
  if (apunteDelPais.faltaLaSuya && config && !usaRespaldoEntrePaises(config)) {
    await aHumanoPorqueFaltaLaPiezaDeSuPais(convo, config, "intro de order bump");
    return;
  }
  // SIN RESPALDO ENTRE TIENDAS Y SIN INTRO DE ORDER BUMP DE ESTA TIENDA: a humano (17/10/2026).
  // También antes de la secuencia de siempre, que tampoco es de esta tienda.
  if (apunteDelPais.faltaLaDeSuTienda && config) {
    await aHumanoPorqueFaltaLaPiezaDeSuPais(convo, config, "intro de order bump", true);
    return;
  }
  const introDeLaOferta =
    delCajon ?? (Array.isArray(ob.intro) ? ob.intro : null);
  if (Array.isArray(introDeLaOferta)) {
    for (const step of introDeLaOferta) {
      // Respeta el toggle ON/OFF: una burbuja apagada NO se envía.
      if ((step as { enabled?: boolean }).enabled === false) continue;
      // true → resuelve {{precio_1}}/{{precio_2}}/{{precio_extra}} en el caption,
      // así los 3 precios de la oferta siguen la etapa (normal vs descuento).
      await sendResponseStep(convo, step as ResponseStep, undefined, true);
      // Respeta el delay configurado entre burbujas (no las manda de corrido).
      const d = (step as { delay_after_sec?: number }).delay_after_sec ?? 0;
      if (d > 0) await new Promise((res) => setTimeout(res, d * 1000));
    }
  }
  const prompt =
    renderOrderBumpTemplate(
      pickVariant(ob.choice_prompt_variants, ob.choice_prompt) ?? "",
      isDiscountActiveForConversation(convo, config),
      convo.phone
    );
  if (ob.use_buttons) {
    const cuerpo = cuerpoDeBotones(prompt, "order bump: pregunta de elección");
    const titulos = titulosDeBotones(
      [ob.combo?.name, ob.basico?.name],
      "order bump: nombres de las 2 opciones"
    );
    if (!cuerpo || !titulos) return;
    await sendBotButtons(convo, cuerpo, [
      { id: "ob_combo", title: titulos[0] },
      { id: "ob_basico", title: titulos[1] },
    ]);
  }
}

/**
 * DOBLE OFERTA 2 PRODUCTOS — al terminar la intro, suelta SOLO la elección
 * (básico/combo). A diferencia del order bump, NO manda una 2ª intro ni pide el
 * nombre: los productos ya se describieron en la intro principal. El prompt sale
 * siempre (texto), con botones si use_buttons está activo.
 */
async function sendDobleOfertaChoice(convo: ConversationRow): Promise<void> {
  const config = loadWorkflowConfig();
  // LA SECCIÓN DE LA MODALIDAD ACTIVA, no siempre "doble_oferta_dos".
  //
  // Esto leía doble_oferta_dos a pelo. En "Doble Oferta + Upsell" la elección
  // salía con el texto y los nombres de LA OTRA modalidad —normalmente los que
  // vienen de fábrica—, así que al terminar la intro se colaba un "¿Cuál
  // prefieres? Responde {{OPCION_1}} o {{OPCION_2}}" que no estaba en ningún
  // campo editable. Y por eso tampoco se podía apagar desde el editor: se
  // editaba una sección y el bot leía otra.
  const dd = seccionDobleOferta(config);
  if (!dd) return;
  // Apagado a propósito: no se manda nada al terminar la intro. El bot sigue
  // esperando la elección, que ya se pidió dentro de la intro.
  if (dd.choice_prompt_enabled === false) return;
  const prompt = renderOrderBumpTemplate(
    pickVariant(dd.choice_prompt_variants, dd.choice_prompt) ?? "",
    isDiscountActiveForConversation(convo, config),
    convo.phone
  );
  if (dd.use_buttons) {
    const titulos = titulosDeBotones(
      [dd.combo?.name, dd.basico?.name],
      "doble oferta 2 productos: nombres de las 2 opciones"
    );
    if (!titulos) return;
    const comboBtn = { id: "ob_combo", title: titulos[0] };
    const basicoBtn = { id: "ob_basico", title: titulos[1] };
    // Orden configurable: por defecto combo arriba/básico abajo; con basico_first
    // se invierte (básico arriba, combo abajo).
    const buttons = dd.basico_first
      ? [basicoBtn, comboBtn]
      : [comboBtn, basicoBtn];
    if (dd.separate_bubble) {
      if (prompt.trim()) await sendBotText(convo, prompt);
      const cuerpo = cuerpoDeBotones(
        dd.choice_buttons_prompt,
        "doble oferta 2 productos: texto de la burbuja de botones"
      );
      if (!cuerpo) return;
      await sendBotButtons(convo, cuerpo, buttons);
    } else {
      const cuerpo = cuerpoDeBotones(
        prompt,
        "doble oferta 2 productos: pregunta de elección"
      );
      if (!cuerpo) return;
      await sendBotButtons(convo, cuerpo, buttons);
    }
  } else if (prompt.trim()) {
    await sendBotText(convo, prompt);
  }
}

async function sendGiftConsentButtonsIfEnabled(
  convo: ConversationRow,
  gift: {
    consent_buttons_enabled?: boolean;
    consent_buttons_prompt?: string;
    consent_buttons?: {
      label?: string;
      action?: "accept" | "reject" | "text";
    }[];
    consent_yes_label?: string;
    consent_no_label?: string;
  }
): Promise<void> {
  if (!gift.consent_buttons_enabled) return;
  const configured = Array.isArray(gift.consent_buttons)
    ? gift.consent_buttons
        .map((button, index) => {
          const label = button.label?.trim();
          if (!label) return null;
          const action = button.action ?? "text";
          const id =
            action === "accept"
              ? `gift_accept:${index}`
              : action === "reject"
                ? `gift_reject:${index}`
                : `gift_text:${index}`;
          return { id, title: label };
        })
        .filter((button): button is { id: string; title: string } => !!button)
        .slice(0, 3)
    : [];
  const buttons =
    configured.length > 0
      ? configured
      : [
          {
            id: "gift_accept:0",
            title: gift.consent_yes_label?.trim() || "Si quiero",
          },
          {
            id: "gift_reject:1",
            title: gift.consent_no_label?.trim() || "Por ahora no",
          },
        ];
  await sendBotButtons(
    convo,
    gift.consent_buttons_prompt?.trim() || "Elige una opcion:",
    buttons
  );
}

/**
 * ¿EL BOT OFRECIÓ ENSEÑAR O CONTAR ALGO EN SU ÚLTIMO MENSAJE?
 *
 * Si ofreció una foto, una muestra, o contar qué incluye, el «sí» del cliente es
 * de ESO. Mandarle la cuenta en vez de lo que pidió es el mismo fallo que ya se
 * evita con el acuse seco — y la galería por confirmación vive en el handler,
 * DESPUÉS del motor, así que quedarse ese «sí» aquí la deja sin disparar.
 *
 * Lo visual lo decide `assistantOfferedVisualSample`, que ya existe y es la
 * misma respuesta que usa el resto del bot. Aquí solo se le suma el ofrecimiento
 * de CONTAR contenido, que esa función no cubre.
 *
 * Ante la duda se dice que sí ofreció: fallar hacia «que conteste el modelo»
 * deja las cosas como estaban hoy, que es lo seguro.
 */
function elBotOfrecioEnsenarAlgo(
  ultimoMensajeDelBot: string,
  conversationId: number
): boolean {
  const t = (ultimoMensajeDelBot ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "");
  const ofreceContar =
    /\b(te (cuento|explico|muestro|enseno|comparto|paso)|quieres (ver|que te (cuente|explique|muestre|ensene))|te (gustaria|interesa) (ver|saber|conocer)|puedo (mostrarte|ensenarte|contarte|explicarte)|que incluye|el contenido|una muestra|unas muestras)\b/.test(
      t
    );
  // OFRECER LOS DATOS DE PAGO NO ES OFRECER UNA MUESTRA — Y AQUÍ SE CONFUNDÍAN.
  //
  // ESTA GUARDA ESTÁ BIEN Y NO SE QUITA: si el bot ofreció enseñar una foto, el
  // «sí» del cliente es de la foto, y mandarle la cuenta en su lugar es el fallo
  // que ya se corrigió una vez.
  //
  // LO QUE LE FALTABA ERA MIRAR EL OBJETO DEL OFRECIMIENTO. «te paso» entra en
  // la lista de arriba sin preguntar qué se pasa. Y el bot cierra sus turnos con
  // frases del catálogo de CTA que dicen exactamente eso:
  //
  //     «¿Te animas a llevarte el combo? Solo dime y TE PASO LOS DATOS para pagar.»
  //
  // El cliente contesta «si» —que es justo pedir los datos— y esta guarda lo
  // leía como un «sí» a una muestra: bloqueaba el reenvío, el turno se iba al
  // modelo, y el modelo volvía a preguntar «¿quieres que te indique cómo
  // adquirirlo?». Dos «sí» para lo mismo. ESE es el semibucle que el dueño lleva
  // pidiendo quitar: no nacía del modelo, nacía de este freno.
  //
  // Se acota al caso exacto, que es lo que manda este repositorio: cuando lo
  // ofrecido son los datos, el método o cómo adquirirlo, esto NO es una muestra.
  // La señal de la muestra de verdad —`assistantOfferedVisualSample`, que exige
  // una palabra visual (foto, imagen, muestra…)— sigue intacta y sigue mandando
  // por su cuenta, así que el fallo que esta guarda tapaba no vuelve.
  //
  // Y las palabras de aquí son las NUESTRAS, las del catálogo de CTA que escribe
  // este mismo repositorio — no las del cliente. Por eso es una lista cerrada y
  // no una persecución de sinónimos.
  const loOfrecidoEsElPago =
    /\b(datos|cuenta|numero|numeros|metodo|metodos|pago|pagos|pagar|adquirirlo|adquirir|obtenerlo|conseguirlo|proceder|pasos)\b/.test(
      t
    );
  return (
    (ofreceContar && !loOfrecidoEsElPago) ||
    assistantOfferedVisualSample(conversationId)
  );
}

/**
 * ¿EL MENSAJE ES SOLO UN ACUSE DE RECIBO?
 *
 * «ok», «ya», «gracias», «perfecto» — el cliente dice que le llegó, y nada más.
 * No pregunta, no decide, no cuenta nada.
 *
 * Tiene que ser el mensaje ENTERO. Ahí está toda la seguridad de esta función:
 * «ok pero tengo una duda» lleva una pregunta detrás y no entra; «ok ya pagué»
 * tampoco, y además su llamador lo descarta aparte con el eco de pago.
 *
 * «listo» y «ya está» NO están en la lista a propósito: los reclama
 * `looksLikePaymentEcho`, porque en este bot suelen significar «ya pagué».
 */
function esUnAcuseSeco(msg: string): boolean {
  const t = (msg ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return false;
  // ACUSAR RECIBO NO ES CONFIRMAR UNA COMPRA.
  //
  // «ah ok esta bien» entró aquí después de un caso real: el bot explicó que era
  // un pago único, el cliente contestó eso — y se le volvió a soltar la cuenta
  // que ya tenía delante. Estaba diciendo «entendido», no «lo quiero».
  //
  // Que «si» esté en la lista NO se come las confirmaciones: quien llama a esto
  // exige antes que el bot NO haya dejado una pregunta abierta. Con una pregunta
  // delante, el «si» sigue su camino y lo atiende la guarda del reenvío.
  return /^(si|sip|ok|oka|okey|okay|okis|okk+|k|ya|yaa+|dale|bueno|vale|perfecto|excelente|genial|entendido|de acuerdo|ah|ah ya|ah ok|ah bueno|ya ok|ok ya|esta bien|ah ok esta bien|ok esta bien|si esta bien|ya esta bien|ah ya ok|esta bien gracias|gracias|muchas gracias|ok gracias|okey gracias|gracias ok|ya gracias|dale gracias|perfecto gracias|muy amable)$/.test(
    t
  );
}

/**
 * ¿El mensaje del cliente es un "sí" de compra? Cubre afirmaciones y verbos de
 * intención ("dale", "lo quiero", "me lo llevo"). Rechaza si hay una negación
 * ("no", "no quiero") para no confundir "no gracias" con un sí.
 */
function isPurchaseAffirmative(msg: string): boolean {
  const t = (msg ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .trim();
  if (!t) return false;
  if (/\bno\b/.test(t)) return false; // "no", "no quiero", "no gracias"...
  // ── UNA PALABRA DE ACUERDO SUELTA NO ES UNA FRASE DE COMPRA ──────────────
  //
  // LO QUE PASÓ — 2 de octubre de 2026. Tres veces seguidas, con tres mensajes distintos,
  // el bot le soltó los datos de pago a un cliente que estaba PREGUNTANDO:
  //
  //     «si pero que contiene»
  //     «si pero no me van a estafar»
  //     «si me hacen llegar el material o se pasan»
  //
  // Y EL DUEÑO PARÓ EL PARCHE: «entonces va a corregir esto y si responde otra pregunta
  // que diga "si pero dame el precio", ¿de nuevo va a joder la misma respuesta? NO PUEDES
  // ESTAR PARCHANDO ASI, HAY QUE BUSCAR LA RAIZ».
  //
  // LA RAÍZ ESTABA AQUÍ. Esta lista metía en el mismo saco dos cosas que no se parecen:
  //
  //     «si», «ok», «dale», «vale»   -> ACUERDO: solo significa sí cuando va SOLO
  //     «lo quiero», «me lo llevo»   -> COMPRA:  significa sí dentro de una frase larga
  //
  // Y se buscaba con `\b…\b`, o sea en cualquier parte. Así que bastaba con que la frase
  // llevara un «si» en algún sitio —da igual lo que dijera después— para que CUATRO
  // puertas distintas la leyeran como una compra.
  //
  // No era el fallo de una frase: era el de todas las que empiezan por «si».
  //
  // ── QUÉ CAMBIA ──────────────────────────────────────────────────────────
  //
  // Aquí se quedan SOLO las frases de compra, que son las que de verdad significan lo
  // mismo vayan donde vayan. Las palabras de acuerdo sueltas las lee `soloEstaDeAcuerdo`,
  // que ya existía, ya estaba probada, y exige que el mensaje NO DIGA NADA MÁS.
  //
  // Las puertas que deben aceptar un «sí» a secas preguntan por las DOS, con un O. Las que
  // solo quieren un sí limpio —como el reenvío de la cuenta— preguntan solo por la
  // segunda. Cada una pide lo que necesita, y ninguna se come a la otra.
  //
  // SE CONSERVAN LAS MULTIPALABRA —«asi es», «de acuerdo», «por supuesto», «de una», «ya
  // pues»— porque no aparecen dentro de una pregunta por accidente y quitarlas sí habría
  // sido una regresión.
  return /\b(asi es|de acuerdo|por supuesto|lo quiero|la quiero|los quiero|quiero|me lo llevo|me la llevo|lo compro|la compro|comprar|adquirir|adquiero|acepto|de una|ya pues)\b/.test(
    t
  );
}

/**
 * ¿El mensaje del cliente INMEDIATAMENTE anterior fue una pregunta de precio?
 * Sirve para saber si la elección actual es una desambiguación de precio (el
 * cliente solo quería saber cuánto cuesta) en vez de una decisión de compra.
 */
function previousCustomerMessageWasPriceQuestion(
  conversationId: number,
  currentContent: string
): boolean {
  const current = (currentContent ?? "").trim();
  // Los mensajes vienen del más reciente al más viejo. Saltamos el pick actual
  // y evaluamos el primer mensaje de texto del cliente anterior a este.
  for (const message of getRecentUserMessages(conversationId, 4)) {
    const text = (message.content ?? "").trim();
    if (!text || text === current) continue;
    return isPriceQuestion(text);
  }
  return false;
}

/**
 * ORDER BUMP — la elección llegó tras una pregunta de precio: en vez de mandar
 * los datos de pago de golpe, confirmamos el precio de la opción y preguntamos
 * si la quiere. Guardamos la opción y marcamos la espera del "sí".
 */
async function askOrderBumpPurchaseConfirm(
  convo: ConversationRow,
  choice: "combo" | "basico",
  config: WorkflowConfig
): Promise<void> {
  const option = getOrderBumpOptionForCountry(choice, convo.phone, config);
  const name =
    option?.name?.trim() ||
    getActiveTwoTierOffer(config)?.[choice]?.name?.trim() ||
    "esa opción";
  const priceSoles =
    getOrderBumpPriceSoles(
      choice,
      isDiscountActiveForConversation(convo, config),
      convo.phone
    ) ?? 0;
  const priceLabel = formatConversationAmount(convo, priceSoles, config);
  setOrderBumpChoice(convo.id, choice);
  setOrderBumpPriceConfirmPending(convo.id, true);
  await sendOrderBumpPriceChoiceConfirmation(
    convo,
    config,
    name,
    priceLabel,
    priceSoles
  );
  console.log(
    `[wf] convo ${convo.id}: pregunta de precio -> confirmo precio de "${choice}" antes de enviar pago`
  );
}

function replaceOrderBumpStepTokens(
  step: ResponseStep,
  replacements: Record<string, string>
): ResponseStep {
  const replaceText = (value: string | undefined): string | undefined => {
    if (typeof value !== "string") return value;
    return Object.entries(replacements).reduce(
      (current, [token, replacement]) =>
        current.replace(
          new RegExp(`\\{\\{\\s*(?:${token})\\s*\\}\\}`, "gi"),
          literal(replacement)
        ),
      value
    );
  };
  const raw = step as ResponseStep & {
    body?: string;
    body_variants?: string[];
    caption?: string;
    caption_variants?: string[];
  };
  return {
    ...raw,
    body: replaceText(raw.body),
    body_variants: raw.body_variants?.map((value) => replaceText(value) ?? ""),
    caption: replaceText(raw.caption),
    caption_variants: raw.caption_variants?.map((value) => replaceText(value) ?? ""),
  } as unknown as ResponseStep;
}

async function sendOrderBumpSteps(
  convo: ConversationRow,
  steps: ResponseStep[],
  replacements: Record<string, string>,
  priceSoles?: number
): Promise<void> {
  for (const step of steps) {
    if ((step as { enabled?: boolean }).enabled === false) continue;
    await sendResponseStep(
      convo,
      replaceOrderBumpStepTokens(step, replacements),
      priceSoles,
      true
    );
    const delay = (step as { delay_after_sec?: number }).delay_after_sec ?? 0;
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay * 1000));
  }
}

async function sendOrderBumpPriceChoiceConfirmation(
  convo: ConversationRow,
  config: WorkflowConfig | null,
  optionName: string,
  priceLabel: string,
  priceSoles: number
): Promise<void> {
  const steps = config?.order_bump?.price_choice_confirmation_steps;
  if (Array.isArray(steps)) {
    await sendOrderBumpSteps(
      convo,
      steps,
      {
        "OPCION_ELEGIDA|OPCION_SELECCIONADA": optionName,
        "PRECIO_OPCION_ELEGIDA|PRECIO_ELEGIDO|PRECIO_SELECCIONADO": priceLabel,
      },
      priceSoles
    );
    return;
  }
  const template =
    config?.order_bump?.price_choice_confirmation?.trim() ||
    "{{OPCION_ELEGIDA}} cuesta {{PRECIO_OPCION_ELEGIDA}}. ¿Lo quieres? Te paso los datos para el pago.";
  await sendBotText(
    convo,
    template
    .replace(/\{\{\s*(opcion_elegida|opcion_seleccionada)\s*\}\}/gi, literal(optionName))
    .replace(
      /\{\{\s*(precio_opcion_elegida|precio_elegido|precio_seleccionado)\s*\}\}/gi,
      literal(priceLabel)
    )
  );
}

async function sendOrderBumpComboUpgradeMessage(
  convo: ConversationRow,
  missingLabel: string,
  config: WorkflowConfig | null = loadWorkflowConfig()
): Promise<void> {
  // Doble Oferta conserva su mensaje propio: este textarea es exclusivo de
  // Order Bump para que las dos modalidades no compartan contenido comercial.
  const template = isOrderBumpActive()
    ? config?.order_bump?.combo_upgrade_message?.trim()
    : "";
  const steps = isOrderBumpActive()
    ? config?.order_bump?.combo_upgrade_steps
    : undefined;
  if (Array.isArray(steps)) {
    await sendOrderBumpSteps(
      convo,
      steps,
      {
        "MONTO_FALTANTE|SALDO_FALTANTE|DIFERENCIA_PENDIENTE": missingLabel,
      }
    );
    return;
  }
  await sendBotText(
    convo,
    (template ||
      "Sí, claro. Puedes completar {{MONTO_FALTANTE}} para llevarte el completo. Cuando envíes el comprobante del saldo restante, te lo dejo listo.")
      .replace(/\{\{\s*(monto_faltante|saldo_faltante|diferencia_pendiente)\s*\}\}/gi, literal(missingLabel))
  );
}

async function sendOrderBumpPartialPaymentChoiceMessage(
  convo: ConversationRow,
  config: WorkflowConfig | null,
  optionName: string,
  paidLabel: string,
  missingLabel: string
): Promise<void> {
  // Este caso solo existe en Order Bump. Doble Oferta conserva su flujo propio.
  const steps = isOrderBumpActive()
    ? config?.order_bump?.partial_payment_choice_steps
    : undefined;
  if (Array.isArray(steps)) {
    await sendOrderBumpSteps(convo, steps, {
      "OPCION_ELEGIDA|OPCION_SELECCIONADA": optionName,
      "MONTO_ABONADO|PAGO_ACUMULADO": paidLabel,
      "MONTO_FALTANTE|SALDO_FALTANTE|DIFERENCIA_PENDIENTE": missingLabel,
    });
    return;
  }
  const template = isOrderBumpActive()
    ? config?.order_bump?.partial_payment_choice_message?.trim()
    : "";
  await sendBotText(
    convo,
    (template ||
      "Perfecto, tomo tu elección de {{OPCION_ELEGIDA}}. Ya abonaste {{MONTO_ABONADO}} y falta completar {{MONTO_FALTANTE}}.")
      .replace(/\{\{\s*(opcion_elegida|opcion_seleccionada)\s*\}\}/gi, literal(optionName))
      .replace(/\{\{\s*(monto_abonado|pago_acumulado)\s*\}\}/gi, literal(paidLabel))
      .replace(/\{\{\s*(monto_faltante|saldo_faltante|diferencia_pendiente)\s*\}\}/gi, literal(missingLabel))
  );
}

/**
 * Recordatorio CORTO de las 2 opciones del order bump, en texto plano (sirve en
 * WhatsApp y Messenger, sin botones que no rendericen). Los nombres van por
 * COMODÍN ({{OPCION_1}}/{{OPCION_2}}) → renderOrderBumpTemplate los resuelve por
 * país y etapa (oferta/normal); nada de producto escrito fijo. No toca el prompt.
 */
function renderTwoOptionsReminder(
  convo: ConversationRow,
  config: WorkflowConfig | null
): string {
  const configuredTemplate = config?.order_bump?.price_question_response?.trim();
  if (configuredTemplate) {
    return renderOrderBumpTemplate(
      configuredTemplate,
      isDiscountActiveForConversation(convo, config),
      convo.phone
    );
  }
  // EL TEXTO POR DEFECTO, DICTADO POR EL DUEÑO EL 26/09/2026.
  //
  // Sustituye al de una sola línea. Escribe los nombres con {{PRODUCTO_FULL}} y
  // {{PRODUCTO_BASE}} en vez de {{OPCION_1}}/{{OPCION_2}}: los cuatro salen de la
  // misma vuelta —`renderOrderBumpTemplate` termina llamando a `applyProductName`—
  // así que dicen lo mismo, pero éstos nombran el PAPEL y no el hueco, que es lo
  // que se cruzaba entre -OB- y -DOU-. Ver `nombresDeLosProductos`.
  //
  // Solo es el respaldo: si él escribe el campo del editor, manda el suyo.
  return renderOrderBumpTemplate(
    "¡Genial! 🙌 \n\n*Pero recuerda que tenemos 2 opciones para ti:*\n\n {{PRODUCTO_FULL}}  \n\ny {{PRODUCTO_BASE}}. \n\n¿A cual de ellos te refieres? 😊",
    isDiscountActiveForConversation(convo, config),
    convo.phone
  );
}

/**
 * EL AVISO PARA QUIEN VENÍA DE UN SOLO PRODUCTO — texto del dueño, 26/09/2026.
 *
 * Es el respaldo: si él escribe el campo del editor, manda el suyo. Los nombres
 * salen de sus productos con los comodines de siempre, nunca escritos aquí.
 */
const AVISO_DE_ACTUALIZACION_POR_DEFECTO =
  "¡Hola! ‼️😊 \n\n*Te cuento que hemos actualizado nuestro contenido* y ahora tenemos *2 opciones* disponibles para tí: 🎉\n\n{{PRODUCTO_BASE}} y \n\n{{PRODUCTO_FULL}} tiene contenido adicional y novedades. 🤗";

function renderAvisoDeActualizacion(
  convo: ConversationRow,
  config: WorkflowConfig | null
): string {
  return renderOrderBumpTemplate(
    config?.order_bump?.aviso_actualizacion?.trim() ||
      AVISO_DE_ACTUALIZACION_POR_DEFECTO,
    isDiscountActiveForConversation(convo, config),
    convo.phone
  );
}

/**
 * SUELTA LA NOVEDAD — LA DICE EL MOTOR, CON EL TEXTO DEL DUEÑO.
 *
 * LO QUE PASÓ — 27 de septiembre de 2026. La novedad se le PEDÍA al modelo y se
 * daba por dicha si su respuesta nombraba las dos opciones. Pero con dos
 * opciones activas el modelo las nombra en casi cualquier respuesta, así que el
 * aviso se apagaba en el primer turno sin que el cliente leyera nunca la
 * noticia. En su registro se ve tres veces: «le conté que ahora hay dos
 * opciones» — y él, al otro lado, no vio ninguna exclusiva.
 *
 * DOS INTENTOS CON EL MODELO, DOS FALLOS. El primero lo marcaba al pedirlo y el
 * modelo se lo saltaba; el segundo lo marcaba al enviarlo y la comprobación era
 * demasiado floja. Es la lección de siempre en este proyecto: si la parte que
 * DECIDE depende de que el modelo se acuerde, no está hecha.
 *
 * Así que lo dice el motor y punto. No detiene la conversación —que era su
 * pega—: la novedad sale como una burbuja y JUSTO DETRÁS la respuesta del
 * modelo a lo que el cliente preguntara. Lee la noticia y lee su respuesta.
 *
 * Devuelve si salió de verdad: quien lo llama solo lo marca cuando salió, o
 * sustituiríamos con nada y el cliente se quedaría sin enterarse para siempre.
 */
export async function enviarAvisoDeActualizacion(
  convo: ConversationRow
): Promise<boolean> {
  const config = loadWorkflowConfig();
  const suyas = config?.order_bump?.aviso_actualizacion_steps;
  if (Array.isArray(suyas) && suyas.length > 0) {
    await sendOrderBumpSteps(convo, suyas, {});
    return true;
  }
  const texto = renderAvisoDeActualizacion(convo, config);
  if (!texto.trim()) return false;
  await sendBotText(convo, texto);
  return true;
}

/**
 * LA NOVEDAD DELANTE DE CUALQUIER PREGUNTA DE ELECCIÓN.
 *
 * Los dos sitios donde el motor le pide al cliente que elija entre las dos
 * opciones pasan por aquí primero. Antes solo lo hacía uno, y por el otro
 * —«eligió método sin producto elegido → pregunto cuál»— el reenganchado
 * recibía la pregunta sin haberse enterado nunca de que ahora hay dos.
 *
 * NO SUSTITUYE A LA PREGUNTA: sale la noticia y detrás lo de siempre. El texto
 * del dueño cuenta la novedad pero no pide elegir; sin la pregunta detrás, el
 * cliente se queda mirando.
 */
async function contarLaNovedadSiTocaba(
  convo: ConversationRow,
  config: WorkflowConfig | null
): Promise<void> {
  if (!hayQueAvisarDeLaActualizacion(convo, config)) return;
  if (await enviarAvisoDeActualizacion(convo)) {
    marcarAvisoDeActualizacionEnviado(convo.id);
    console.log(
      `[wf] convo ${convo.id}: venía de un solo producto → le cuento la actualización`
    );
  }
}

async function sendTwoOptionsReminder(
  convo: ConversationRow,
  config: WorkflowConfig | null
): Promise<void> {
  // EL QUE VENÍA DE UN SOLO PRODUCTO OYE PRIMERO LA NOVEDAD.
  //
  // Con sus palabras: «si dijese quiero pagar, le diga hola quiero contarte que
  // hemos actualizado a 2 productos». Éste es el turno que contesta el MOTOR, así
  // que aquí no hay modelo a quien pedirle la frase: sale el texto del dueño.
  //
  // Y SE MARCA AL DECIRLO, para que no se lo repita en cada mensaje.
  await contarLaNovedadSiTocaba(convo, config);
  const steps = config?.order_bump?.price_question_response_steps;
  if (Array.isArray(steps)) {
    await sendOrderBumpSteps(convo, steps, {});
    return;
  }
  await sendBotText(convo, renderTwoOptionsReminder(convo, config));
}

async function sendTwoTierChoiceClarification(
  convo: ConversationRow,
  config: WorkflowConfig | null,
  dobleOferta: boolean
): Promise<void> {
  // LA NOVEDAD PRIMERO. Por aquí entra «eligió método sin producto elegido →
  // pregunto cuál», que es justo por donde el reenganchado recibía la pregunta
  // sin haberse enterado de que ahora hay dos. Ver `contarLaNovedadSiTocaba`.
  await contarLaNovedadSiTocaba(convo, config);
  const section = dobleOferta ? seccionDobleOferta(config) : config?.order_bump;
  const template = section?.choice_clarification?.trim();
  if (template) {
    await sendBotText(
      convo,
      renderOrderBumpTemplate(
        template,
        isDiscountActiveForConversation(convo, config),
        convo.phone
      )
    );
    return;
  }
  if (!dobleOferta) {
    await sendTwoOptionsReminder(convo, config);
    return;
  }
  // La pregunta nombra los productos como los nombra el bot en todas partes. Si
  // aquí saliera «la opción Full», el cliente tendría que adivinar a qué se
  // refiere justo en el momento de decidir.
  const combo = nombreDeLaOpcion("combo", config) || "la opción Full";
  const basico = nombreDeLaOpcion("basico", config) || "la opción Básica";
  // Este es el RESPALDO: si el operador escribe su propio texto en «Aclaración
  // al responder ambiguo», manda el suyo y esto no se usa. Aun así se escribe
  // cálido, porque un respaldo también lo lee un cliente — y llega justo en el
  // momento de decidir, que es el peor sitio para sonar seco.
  await sendBotText(
    convo,
    `Te recuerdo que tenemos estas opciones disponibles para ti 😊 ¿Cuál prefieres: ${combo} o ${basico}?`
  );
}

/**
 * ORDER BUMP — el cliente eligió una opción: guardamos la elección y enviamos
 * su respuesta predefinida (método + precio). Pasa a payment_done; la entrega
 * la dispara el pago aprobado (payment.ts) según la opción.
 */
/**
 * LA RESPUESTA PROPIA DEL PRODUCTO QUE ACABA DE ELEGIR.
 *
 * ANTES NO SALÍA NUNCA. La respuesta por opción existía y se podía escribir,
 * pero con el pago directo encendido —que es lo normal— esta función se iba por
 * su rama y volvía antes de llegar a ella. Resultado: daba igual qué producto
 * eligiera el cliente, siempre recibía el mismo texto general. Había textos
 * escritos ahí desde hacía meses que no había leído nadie.
 *
 * Se puede tener MÁS DE UNA para el mismo producto, con su nombre, su color y
 * su interruptor, y se sortea entre la principal y las encendidas — igual que
 * las variantes de los seguimientos.
 *
 * SE SALTAN LAS QUE ESTÁN SIN LLENAR. Varias modalidades traen aquí el texto de
 * muestra («<<TEXTO_METODO_Y_PRECIO_BASICO…>>»). Encender esto sin esta guarda
 * le habría mandado ese texto crudo a un cliente el primer día.
 */
/**
 * ¿ESTA BURBUJA VA A SALIR DE VERDAD?
 *
 * Se pregunta lo mismo que se pregunta el envío, y en el mismo orden:
 * `pickVariant` descarta las variantes con «<<…>>» y, si no queda ninguna, cae
 * al campo suelto (`body`). Si de ahí sale cadena vacía, no se manda nada.
 *
 * Mira el PEOR sorteo, no uno al azar: basta con que una variante buena esté en
 * blanco para que algún cliente se quede sin esa burbuja justo al pagar.
 */
function laBurbujaSaleDeVerdad(step: ResponseStep): boolean {
  const conTexto = (t: string | null | undefined): boolean => !!(t ?? "").trim();
  const sinPlantilla = (t: string | null | undefined): boolean =>
    !((t ?? "").includes("<<") && (t ?? "").includes(">>"));
  const hayTexto = (
    variantes: string[] | undefined,
    suelto: string | undefined
  ): boolean => {
    const utiles = (variantes ?? []).filter(sinPlantilla);
    if (utiles.length > 0) return utiles.every(conTexto);
    return conTexto(suelto) && sinPlantilla(suelto);
  };
  if (step.type === "text") return hayTexto(step.body_variants, step.body);
  const media = step as {
    drive_url?: string;
    caption?: string;
    caption_variants?: string[];
  };
  return (
    (conTexto(media.drive_url) && sinPlantilla(media.drive_url)) ||
    hayTexto(media.caption_variants, media.caption)
  );
}

function respuestaAlElegirProducto(
  option: OrderBumpOption | undefined
): ResponseStep[] | null {
  const utilizable = (steps: unknown): ResponseStep[] | null => {
    if (!Array.isArray(steps)) return null;
    const vivos = (steps as ResponseStep[]).filter(
      (step) => (step as { enabled?: boolean }).enabled !== false
    );
    if (vivos.length === 0) return null;
    // LA GUARDA ANTERIOR MIRABA DONDE NO ESTABA EL TEXTO.
    //
    // `sectionHasPlaceholder` salta a propósito los arrays «_variants»… y el
    // editor guarda TODO el texto justo ahí, dejando `body` vacío. Así que en
    // una respuesta sin llenar veía `body: ""`, concluía «aquí no hay
    // plantilla» y la daba por buena. Después el envío sí descartaba el
    // «<<…>>», no quedaba texto, y no salía nada: el cliente elegía su
    // producto y recibía silencio, con las burbujas de pago ya canceladas por
    // haber dado la respuesta por buena. Ahora se pregunta por lo que de
    // verdad se va a enviar.
    if (!vivos.some(laBurbujaSaleDeVerdad)) return null;
    return vivos;
  };
  const candidatas: ResponseStep[][] = [];
  const principal = utilizable(option?.response);
  if (principal) candidatas.push(principal);
  for (const variante of option?.response_variants ?? []) {
    if (variante?.enabled === false) continue;
    const pasos = utilizable(variante?.steps);
    if (pasos) candidatas.push(pasos);
  }
  if (candidatas.length === 0) {
    const habiaAlgoEscrito =
      (option?.response?.length ?? 0) > 0 ||
      (option?.response_variants?.length ?? 0) > 0;
    if (habiaAlgoEscrito) {
      // Que se vea en el log. Este caso murió en silencio una vez.
      console.warn(
        `[wf] «Respuesta al elegir» sin texto utilizable (en blanco o con <<plantilla>>) → uso las burbujas de pago de siempre`
      );
    }
    return null;
  }
  return candidatas[Math.floor(Math.random() * candidatas.length)];
}

/**
 * Manda esas burbujas respetando el delay de cada una.
 *
 * SUSTITUYEN a las burbujas de pago de siempre, no se suman. El cajón del
 * editor se llama «Respuesta al elegir (método de pago + precio)»: está pensado
 * para ser la respuesta ENTERA de ese producto. Enviando las dos, el cliente
 * recibía su texto y a continuación el genérico diciendo lo mismo — dos veces
 * el mismo precio y dos veces la misma cuenta.
 *
 * Por eso quien la manda no programa después los pasos de pago. Y por eso el
 * editor avisa si estas burbujas no llevan los datos: aquí no hay red debajo.
 *
 * Devuelve si salió AL MENOS UNA burbuja, para que quien sustituye con ella
 * pueda comprobar que hay con qué sustituir antes de dar el pago por entregado.
 */
async function enviarRespuestaAlElegir(
  convo: ConversationRow,
  pasos: ResponseStep[] | null,
  precio: number
): Promise<boolean> {
  if (!pasos) return false;
  let salioAlguna = false;
  for (const step of pasos) {
    // true → además de {price} (precio de ESTA opción), resuelve
    // {{PRECIO_BASE}}/{{PRECIO_FULL}} por si la respuesta los usa.
    if (await sendResponseStep(convo, step, precio, true)) salioAlguna = true;
    const d = (step as { delay_after_sec?: number }).delay_after_sec ?? 0;
    if (d > 0) await new Promise((res) => setTimeout(res, d * 1000));
  }
  return salioAlguna;
}

async function deliverOrderBumpResponse(
  convo: ConversationRow,
  choice: "combo" | "basico",
  /** Lo que el cuadrito del operador ya le dijo en este turno, si vino de uno.
   *  Misma regla que en todas partes: su texto manda. */
  yaDicho?: { yaPresento?: boolean; yaDioLosDatos?: boolean }
): Promise<void> {
  const config = loadWorkflowConfig();
  // Opción de la modalidad ACTIVA (order bump o doble oferta 2 productos), con
  // los textos POR PAÍS aplicados (respuesta al elegir, mensaje directo, métodos).
  // La entrega sigue común. Vacío por país = usa el texto base (fallback).
  const option = getOrderBumpOptionForCountry(choice, convo.phone, config);
  setOrderBumpChoice(convo.id, choice);
  // Elección fresca → deja de estar "vencida" por un seguimiento previo.
  setOrderBumpChoiceStale(convo.id, false);
  cancelPendingActionsByTypeForConvo(convo.id, ACTION_SEND_PAYMENT_STEP);
  // Precio de ESTA opción para el comodín {price}: promo si la convo entró en
  // etapa de oferta y hay precio promo; si no, el normal de la opción.
  const optPrice =
    getOrderBumpPriceSoles(
      choice,
      isDiscountActiveForConversation(convo, config),
      convo.phone
    ) ?? 0;
  const lockedOptPrice =
    lockPaymentPrice(convo, optPrice, `two_tier:${choice}`, config) ?? optPrice;
  // ORDER BUMP CONSERVA SU FLUJO. AQUÍ NO SE TOCA NADA.
  //
  // Se probó a que la «respuesta al elegir» de la opción sustituyera a las
  // burbujas de pago, como se hace en Doble Oferta. Rompió esta modalidad, y por
  // un motivo que solo se ve mirando el CONTENIDO, no el código:
  //
  // El texto que el operador tiene escrito aquí está pensado para el flujo de
  // Order Bump, donde esa respuesta va ANTES del menú de métodos — así que
  // termina pidiendo el método de pago. Al convertirla en la última palabra, el
  // cliente elegía Yape, luego elegía el combo… y el bot le volvía a preguntar
  // el método que acababa de darle. Un fallo viejo, ya resuelto, de vuelta.
  //
  // La lección: dos modalidades con el mismo campo no tienen por qué usarlo
  // igual. Aquí la respuesta PRESENTA el pago; en Doble Oferta ES el pago.
  // EL MENSAJE PROPIO DEL PRODUCTO GANA SOBRE EL GLOBAL.
  //
  // El pago directo manda un texto ÚNICO para todos los productos: cambia el
  // precio del comodín y nada más. Con dos opciones eso suena a máquina — el
  // cliente elige el combo y le contestan «puedes adquirir el curso», igual que
  // si hubiera elegido el básico.
  //
  // Cada opción tiene su propio «mensaje directo antes de métodos de pago», con
  // su interruptor. Estaba escrito, encendido en una de ellas… y no salía: esta
  // rama global se ejecutaba antes y volvía sin llegar a mirarlo. Trabajo hecho
  // y tirado.
  //
  // Va DELANTE del texto global, y SOLO si está encendido a propósito: quien no
  // lo encienda sigue exactamente como hoy.
  //
  // Y CUANDO SALE EL SUYO, EL GENERAL NO REPITE LA PRESENTACIÓN.
  //
  // Salían las dos frases seguidas: la suya («🔥 Buena elección, elegiste esta
  // opción por X, ahora puedes pagar con estos métodos 👇») y detrás la de
  // fábrica («✅ ¡Perfecto! puedes adquirir el curso de la siguiente manera
  // 👇»). No es una repetición literal, pero el cliente lee dos veces lo mismo
  // con distintas palabras — que es justo lo que se estaba corrigiendo
  // escribiéndolo a mano.
  //
  // Lo que NO se toca son los datos. Se quitan solo las frases que van DELANTE
  // del cajón del país; el cajón y el cierre salen igual. Antes esto no se hacía
  // por no adivinar cuál burbuja era la presentación — y era verdad, adivinarlo
  // dejaría a un cliente pagando sin saber a dónde. Ya no hace falta adivinar:
  // el comodín {{METODO_DE_PAGO_x}} dice cuál es cuál, y si no aparece en
  // ninguna, no se quita nada. Ver `sinLaPresentacionDeSiempre`.
  // El cuadrito que trajo al cliente hasta aquí cuenta igual que el mensaje
  // propio de la opción: los dos son texto del operador, y detrás no puede ir
  // la misma presentación otra vez.
  const suCuadritoYaPresento = yaDicho?.yaPresento === true;
  const suCuadritoYaDioLosDatos = yaDicho?.yaDioLosDatos === true;
  const mandaElSuyo =
    config !== null &&
    option?.direct_payment_prompt_enabled === true &&
    shouldUseDirectPayment(config, "with_choice", convo.phone);
  // SUSTITUIR CON NADA NO ES SUSTITUIR.
  //
  // EL FALLO. El cliente eligió el combo y recibió solo la cuenta y el cierre:
  // le faltó la burbuja que presenta el pago. El básico —que no tiene mensaje
  // propio— sí la recibió. La diferencia estaba aquí.
  //
  // Con el mensaje propio ENCENDIDO, la presentación del texto general se quita
  // para no decir lo mismo dos veces. Correcto… mientras el mensaje propio diga
  // algo. Si está vacío, o sus burbujas están apagadas, o sus variantes son
  // plantilla sin rellenar, no sale NADA — y aun así se quitaba la presentación
  // general. El cliente se queda con la cuenta a secas, sin una frase que la
  // presente.
  //
  // Es la misma regla que ya rige en la respuesta al elegir producto: sustituir
  // con nada deja al cliente sin lo que se le quitó. Así que ya no basta con que
  // el interruptor esté puesto: tiene que HABER SALIDO algo.
  //
  // `sendResponseStep` ya devuelve si envió de verdad — devolvía ese dato y aquí
  // se tiraba. Solo hay que mirarlo.
  let suMensajePropioSalio = false;
  if (mandaElSuyo) {
    for (const step of option?.direct_payment_prompt ?? []) {
      if ((step as { enabled?: boolean }).enabled === false) continue;
      if (await sendResponseStep(convo, step, lockedOptPrice, true)) {
        suMensajePropioSalio = true;
      }
      const d = (step as { delay_after_sec?: number }).delay_after_sec ?? 0;
      if (d > 0) await new Promise((res) => setTimeout(res, d * 1000));
    }
    console.log(
      suMensajePropioSalio
        ? `[wf] convo ${convo.id} eligio "${choice}" -> su mensaje propio antes del pago`
        : `[wf] convo ${convo.id} eligio "${choice}": su mensaje propio está encendido pero no envió ninguna burbuja → mando el texto general COMPLETO, con su presentación`
    );
  }
  if (config && shouldUseDirectPayment(config, "with_choice", convo.phone)) {
    const textoGeneral = getDirectPaymentSteps(config, "with_choice", convo.phone);
    // Si su cuadrito ya dio la cuenta, no sale nada de fábrica encima; si solo
    // presentó, sale la parte de los datos.
    if (suCuadritoYaDioLosDatos) {
      setSelectedPaymentMethod(convo.id, "yape");
      reportInitiateCheckout(convo, "yape", lockedOptPrice);
      setConversationState(convo.id, "payment_done");
      console.log(
        `[wf] convo ${convo.id} eligio "${choice}" -> su cuadrito ya llevaba los datos, no mando las de fábrica`
      );
      return;
    }
    // SALIÓ, no «estaba encendido». Ver `suMensajePropioSalio` arriba: con el
    // interruptor puesto y las burbujas vacías se quitaba una presentación que
    // no había sustituido nadie.
    const directSteps =
      suMensajePropioSalio || suCuadritoYaPresento
        ? sinLaPresentacionDeSiempre(textoGeneral)
        : textoGeneral;
    if (directSteps.length < textoGeneral.length) {
      console.log(
        `[wf] convo ${convo.id}: su mensaje ya presentó el pago → me salto ${textoGeneral.length - directSteps.length} burbuja(s) del texto general`
      );
    }
    setSelectedPaymentMethod(convo.id, "yape");
    reportInitiateCheckout(convo, "yape", lockedOptPrice);
    await schedulePaymentResponses(convo, "yape", directSteps, {
      orderBumpChoice: choice,
      priceSoles: lockedOptPrice,
      directPayment: true,
      sinPresentacion: directSteps.length < textoGeneral.length,
    });
    setConversationState(convo.id, "payment_done");
    console.log(
      `[wf] convo ${convo.id} eligio "${choice}" -> pago directo editable`
    );
    return;
  }
  if (convo.selected_payment_method && config) {
    const route: string =
      convo.selected_payment_method === "plin"
        ? "yape"
        : convo.selected_payment_method;
    const deFabrica = getPaymentResponses(config, route, choice, convo.phone);
    if (suCuadritoYaDioLosDatos) {
      setConversationState(convo.id, "payment_done");
      console.log(
        `[wf] convo ${convo.id} cambió a "${choice}"; su cuadrito ya llevaba los datos, no mando las de fábrica`
      );
      return;
    }
    const responses = suCuadritoYaPresento
      ? sinLaPresentacionDeSiempre(deFabrica)
      : deFabrica;
    reportInitiateCheckout(convo, convo.selected_payment_method, lockedOptPrice);
    await schedulePaymentResponses(convo, route, responses, {
      orderBumpChoice: choice,
      priceSoles: lockedOptPrice,
      sinPresentacion: responses.length < deFabrica.length,
    });
    setConversationState(convo.id, "payment_done");
    console.log(
      `[wf] convo ${convo.id} cambió a "${choice}"; reutilizo pago "${convo.selected_payment_method}" con monto actualizado`
    );
    return;
  }

  if (option?.direct_payment_prompt_enabled === true) {
    for (const step of option.direct_payment_prompt ?? []) {
      if ((step as { enabled?: boolean }).enabled === false) continue;
      await sendResponseStep(convo, step, lockedOptPrice, true);
      const d = (step as { delay_after_sec?: number }).delay_after_sec ?? 0;
      if (d > 0) await new Promise((res) => setTimeout(res, d * 1000));
    }
    setConversationState(convo.id, "payment_done");
    await sendTwoTierPaymentMethodMenu(convo, lockedOptPrice);
    console.log(
      `[wf] convo ${convo.id} eligio "${choice}" -> menu de pago directo`
    );
    return;
  }

  // La respuesta al elegir, tal como estaba: solo por este camino —el que no
  // usa pago directo ni tiene método ya elegido—, y seguida del estado. Las dos
  // ramas de arriba vuelven antes, y así es como funciona Order Bump.
  await enviarRespuestaAlElegir(
    convo,
    respuestaAlElegirProducto(option),
    lockedOptPrice
  );
  setConversationState(convo.id, "payment_done");
}

/** Acepta el regalo extra: cancela el consent zombie y programa el audio+texto.
 *  Fuente única, usada por el detector determinístico y por el handler cuando el
 *  LLM confirma con <<REGALO_SI>>. */
export function acceptGiftConsent(convo: ConversationRow): void {
  // Ya se envió: el ciclo terminó y la clienta está en el paso de comentar. Una
  // segunda aceptación no vuelve a mandarlo.
  const fresco = getConversationById(convo.id) ?? convo;
  if (fresco.state === "awaiting_facebook_comment") {
    console.log(
      `[wf] convo ${convo.id} ya recibió el regalo; ignoro la segunda aceptación`
    );
    return;
  }
  // ACEPTAR DOS VECES NO ENVÍA DOS VECES.
  //
  // A esta función se llega desde cinco sitios: el detector de "sí" escrito, el
  // botón de aceptar, y el marcador <<REGALO_SI>> del modelo en WhatsApp,
  // Messenger e Instagram. Antes solo cancelaba las acciones de CONSENTIMIENTO,
  // así que una segunda aceptación —dos "sí" seguidos, o el botón y además
  // escribirlo— dejaba programado el envío anterior y agendaba otro: la
  // clienta recibía el mismo enlace dos veces.
  //
  // Cancelando también las del envío, la segunda llamada REEMPLAZA a la
  // primera en vez de sumarse.
  cancelPendingGiftActions(convo.id);
  scheduleGiftAudioAndText(convo.id);
  console.log(
    `[wf] convo ${convo.id} aceptó regalo extra → programo audio+texto`
  );
  // Y SI EL EXTRA SIGUE SIN CONTESTAR, SE LE RECUERDA. UNA VEZ.
  //
  // El regalo es lo último que queda del ciclo. Si el cliente se va de aquí sin
  // que nadie vuelva a nombrar el segundo producto, esa venta se pierde en
  // silencio: nadie falló, simplemente no se habló más de ella.
  //
  // Solo «ofrecido»: si dijo que sí, si dijo que no o si ya lo pagó, no hay
  // nada que recordar. Las guardas están todas dentro.
  if (fresco.upsell_state === "ofrecido") {
    programarRecordatorioDelUpsell(fresco, "tras el regalo");
  }
}

/** Rechaza el regalo extra: cierra con el mensaje cordial. Usada por el detector
 *  y por el handler cuando el LLM detecta rechazo con <<REGALO_NO>>. */
export async function declineGiftConsent(
  convo: ConversationRow
): Promise<void> {
  cancelPendingGiftActions(convo.id);
  const declineMsg = loadWorkflowConfig()?.gift_mechanic?.decline_message?.trim();
  if (declineMsg) {
    try {
      await sendBotText(convo, declineMsg);
    } catch (err) {
      console.error("[wf] error enviando decline_message:", err);
    }
  }
  setConversationState(convo.id, "payment_approved");
  console.log(`[wf] convo ${convo.id} rechazó regalo extra → cierre cordial`);
  // Decir que no al REGALO no es decir que no al EXTRA: son dos cosas distintas
  // y el cliente contestó solo a una. Si la oferta sigue sin contestar, se le
  // recuerda una vez. Ver `programarRecordatorioDelUpsell`.
  const alDia = getConversationById(convo.id) ?? convo;
  if (alDia.upsell_state === "ofrecido") {
    programarRecordatorioDelUpsell(alDia, "tras el regalo");
  }
}

/** Entrega el regalo tras confirmar el comentario en Facebook. Usada por el
 *  detector y por el handler cuando el LLM confirma con <<REGALO_HECHO>>. */
export async function claimGiftReward(convo: ConversationRow): Promise<void> {
  const cfg = loadWorkflowConfig();
  if (cfg?.gift_mechanic && !sectionHasPlaceholder(cfg.gift_mechanic)) {
    await sendBotText(convo, cfg.gift_mechanic.reward_message);
    setGiftRewarded(convo.id, true);
    console.log(`[wf] convo ${convo.id} reclamó el regalo de FB`);
  }
  cancelPendingGiftActions(convo.id);
  setConversationState(convo.id, "payment_approved");
  scheduleAutoHumanAfterGiftComment(convo.id);
  scheduleCustomerSurveyFallback(convo.id);
  // Petición de correo tras el regalo. Tiene SU PROPIO interruptor: antes iba
  // pegada al re-ofrecimiento del regalo y no había forma de quedarse solo con
  // una de las dos.
  if (pedirCorreoTrasElRegalo(cfg)) scheduleEmailReminderAfterGift(convo);
}

/** Ofrece completar el saldo para subir al combo (post-venta). Usada por el
 *  detector y por el handler cuando el LLM detecta la intención con
 *  <<UPGRADE_COMBO>>. Devuelve true si aplicó (había saldo pendiente). Si el
 *  pago acumulado ya cubre el combo, NO ofrece nada (el motor lo entrega solo). */
export async function offerComboUpgrade(
  convo: ConversationRow
): Promise<boolean> {
  if (!isOrderBumpActive() && !isDobleOfertaActive()) return false;
  const resolution = resolveAccumulatedOrderBumpChoice(convo.id, "combo");
  if (!resolution || resolution.approved) return false;
  const missingLabel = formatConversationAmount(convo, resolution.missingSoles);
  await sendOrderBumpComboUpgradeMessage(convo, missingLabel);
  console.log(
    `[wf] convo ${convo.id} → ofrecí upgrade a combo (saldo S/.${resolution.missingSoles})`
  );
  return true;
}

/**
 * DOBLE OFERTA 2 PRODUCTOS — al elegir Producto 1/Producto 2 NO pedimos método.
 * Enviamos directamente la respuesta personalizada de pago de esa opción.
 * Exportada para que el handler la dispare cuando el LLM confirma la elección
 * con el marcador <<ELIGE_PRODUCTO_1/2>> (casos que la detección no cazó).
 */
export async function deliverDobleOfertaPaymentDetails(
  convo: ConversationRow,
  choice: "combo" | "basico"
): Promise<void> {
  const config = loadWorkflowConfig();
  if (!config) return;

  setOrderBumpChoice(convo.id, choice);
  cancelPendingActionsByTypeForConvo(convo.id, ACTION_SEND_PAYMENT_STEP);

  const existingMethod = convo.selected_payment_method;
  // Si el cliente ya eligió método, lo usamos TAL CUAL (dinámico o clásico;
  // "plin" comparte yape). Si aún no eligió, vamos al método por DEFECTO (el
  // primero de la lista en el bot universal, o "yape" en clásico).
  const route: string =
    existingMethod === "plin"
      ? "yape"
      : existingMethod && existingMethod.trim()
        ? existingMethod
        : getDefaultPaymentMethodId(convo.phone);
  const selectedPaymentMethod = route;
  const priceSoles =
    getOrderBumpPriceSoles(
      choice,
      isDiscountActiveForConversation(convo, config),
      convo.phone
    ) ?? undefined;
  const lockedPriceSoles =
    lockPaymentPrice(convo, priceSoles, `two_tier:${choice}`, config) ??
    priceSoles;
  // LA RESPUESTA PROPIA DEL PRODUCTO, TAMBIÉN AQUÍ.
  //
  // Estaba puesta solo en `deliverOrderBumpResponse`, que es la entrega de Order
  // Bump. Doble Oferta —y Doble Oferta + Upsell, que vende igual en esta parte—
  // entrega por ESTA otra función, así que en esas modalidades la respuesta
  // personalizada seguía sin salir: se escribía y no la leía nadie. Dos caminos
  // para lo mismo y el arreglo aplicado a uno solo.
  //
  // Misma regla que allí: SUSTITUYE a las burbujas de pago —no se suma— y se
  // salta las que están sin llenar.
  const opcionElegida = getOrderBumpOptionForCountry(
    choice,
    convo.phone,
    config
  );
  const respuestaDelProducto = respuestaAlElegirProducto(opcionElegida);
  if (respuestaDelProducto) {
    // SUSTITUIR CON NADA NO ES SUSTITUIR.
    //
    // Esta rama cancela las burbujas de pago y marca la venta como entregada.
    // Si la respuesta propia no llega a enviar ninguna burbuja, el cliente se
    // queda sin datos de pago Y en `payment_done` — pidió el producto y no
    // recibió nada. Por eso el estado y el aviso a Meta van DESPUÉS de
    // comprobar que salió; si no salió, se sigue por el camino de siempre.
    const metodoDeLaRespuesta = shouldUseDirectPayment(config, "with_choice", convo.phone)
      ? "yape"
      : selectedPaymentMethod;
    setSelectedPaymentMethod(convo.id, metodoDeLaRespuesta);
    const salio = await enviarRespuestaAlElegir(
      convo,
      respuestaDelProducto,
      lockedPriceSoles ?? 0
    );
    if (salio) {
      reportInitiateCheckout(convo, metodoDeLaRespuesta, lockedPriceSoles);
      setConversationState(convo.id, "payment_done");
      console.log(
        `[wf] convo ${convo.id} doble oferta "${choice}" -> su respuesta propia (sustituye a las burbujas de pago)`
      );
      return;
    }
    console.warn(
      `[wf] convo ${convo.id} doble oferta "${choice}": la respuesta propia no envió ninguna burbuja → sigo con las burbujas de pago de siempre`
    );
  }
  if (shouldUseDirectPayment(config, "with_choice", convo.phone)) {
    const directSteps = getDirectPaymentSteps(config, "with_choice", convo.phone);
    setSelectedPaymentMethod(convo.id, "yape");
    reportInitiateCheckout(convo, "yape", lockedPriceSoles);
    await schedulePaymentResponses(convo, "yape", directSteps, {
      orderBumpChoice: choice,
      priceSoles: lockedPriceSoles,
      directPayment: true,
    });
    setConversationState(convo.id, "payment_done");
    console.log(
      `[wf] convo ${convo.id} doble oferta "${choice}" -> pago directo editable`
    );
    return;
  }
  const responses = getPaymentResponses(config, route, choice, convo.phone);

  setSelectedPaymentMethod(convo.id, selectedPaymentMethod);
  reportInitiateCheckout(convo, selectedPaymentMethod, lockedPriceSoles);
  // Sin respuesta propia: van las burbujas de pago de siempre. Si la tuviera,
  // se habría enviado arriba y esta parte no se alcanza.
  await schedulePaymentResponses(convo, route, responses, {
    orderBumpChoice: choice,
    priceSoles: lockedPriceSoles,
  });
  setConversationState(convo.id, "payment_done");
  console.log(
    `[wf] convo ${convo.id} doble oferta "${choice}" → datos de pago directos (${route})`
  );
}

/**
 * DOBLE OFERTA — el cliente eligió una de las 3 opciones al final de la intro:
 * le mandamos los datos de pago de siempre, pero con el PRECIO de ESA opción
 * (unitario para A/B, precio del pack para el pack). Mismo camino que usa la
 * Doble Oferta 2 Productos, sin respuestas de pago por opción (Bioferta no las
 * tiene: los textos son los globales/por país con {price} resuelto).
 */
export async function deliverBiofertaPaymentDetails(
  convo: ConversationRow,
  choice: "a" | "b" | "pack"
): Promise<void> {
  const config = loadWorkflowConfig();
  if (!config) return;

  setBiofertaChoice(convo.id, choice);
  cancelPendingActionsByTypeForConvo(convo.id, ACTION_SEND_PAYMENT_STEP);

  // Si ya eligió método lo respetamos; si no, el método por defecto del país.
  const existingMethod = convo.selected_payment_method;
  const route: string =
    existingMethod === "plin"
      ? "yape"
      : existingMethod && existingMethod.trim()
        ? existingMethod
        : getDefaultPaymentMethodId(convo.phone);
  const priceSoles =
    getBiofertaPriceSoles(
      choice,
      isDiscountActiveForConversation(convo, config),
      convo.phone
    ) ?? undefined;
  const lockedPriceSoles =
    lockPaymentPrice(convo, priceSoles, `bioferta:${choice}`, config) ??
    priceSoles;
  if (shouldUseDirectPayment(config, "with_choice", convo.phone)) {
    const directSteps = getDirectPaymentSteps(config, "with_choice", convo.phone);
    setSelectedPaymentMethod(convo.id, "yape");
    reportInitiateCheckout(convo, "yape", lockedPriceSoles);
    await schedulePaymentResponses(convo, "yape", directSteps, {
      priceSoles: lockedPriceSoles,
      directPayment: true,
    });
    setConversationState(convo.id, "payment_done");
    console.log(
      `[wf] convo ${convo.id} doble oferta "${choice}" -> pago directo editable`
    );
    return;
  }
  const responses = getPaymentResponses(config, route, undefined, convo.phone);
  setSelectedPaymentMethod(convo.id, route);
  reportInitiateCheckout(convo, route, lockedPriceSoles);
  await schedulePaymentResponses(convo, route, responses, {
    priceSoles: lockedPriceSoles,
  });
  setConversationState(convo.id, "payment_done");
  console.log(
    `[wf] convo ${convo.id} doble oferta "${choice}" → datos de pago (${route}, ${lockedPriceSoles})`
  );
}

/**
 * Envía el menú de métodos de pago como BOTONES (Yape/Plin/BCP). Lo dispara el
 * handler cuando la IA emite <<METODOS_PAGO>> y el toggle está activo. Al tocar
 * un botón, el título vuelve como texto → detectPaymentRoute lo reconoce igual.
 */
export async function sendPaymentOffer(
  convo: ConversationRow
): Promise<void> {
  const cfg = loadWorkflowConfig();
  // "Cara de texto" del menú (editable). Se usa con los botones APAGADOS y
  // también de respaldo si el texto de los botones está vacío: el cliente
  // siempre tiene que enterarse de cómo pagar.
  const enviarMenuEnTexto = async (): Promise<void> => {
    const price = lockPaymentPrice(
      convo,
      getEffectivePriceSoles(
        isDiscountActiveForConversation(convo, cfg),
        convo.phone
      ),
      "base",
      cfg
    );
    await sendBotText(
      convo,
      applyPriceTemplate(
        getPaymentText(convo.phone),
        price ?? getLockedOrCurrentBasePrice(convo, cfg),
        convo
      )
    );
  };
  if (!cfg?.payment_method_buttons) {
    await enviarMenuEnTexto();
    return;
  }
  const prompt = cuerpoDeBotones(
    cfg?.payment_buttons_prompt,
    "menú de métodos de pago"
  );
  if (!prompt) {
    await enviarMenuEnTexto();
    return;
  }
  // Botones editables (1-3): el `id` lleva el método (pmethod:<keyword>) para
  // enrutar sin depender de la etiqueta visible; el `title` es lo que el cliente
  // ve (puede tener emoji).
  const buttons = getPaymentButtons(convo.phone).map((b, i) => ({
    // El índice hace el id ÚNICO aunque dos botones tengan el mismo método
    // (WhatsApp rechaza ids de botón duplicados). El handler lee el método
    // tomando lo que va entre "pmethod:" y el siguiente ":".
    id: `pmethod:${b.method}:${i}`,
    title: b.label,
  }));
  // Sin métodos configurados no hay botones que mandar (WhatsApp rechaza una
  // burbuja de botones vacía). Cae al menú de texto, como en los demás casos:
  // el cliente siempre tiene que enterarse de cómo pagar.
  if (buttons.length === 0) {
    await enviarMenuEnTexto();
    return;
  }
  await sendBotButtons(convo, prompt, buttons);
}

async function sendTwoTierPaymentMethodMenu(
  convo: ConversationRow,
  priceSoles: number
): Promise<void> {
  const cfg = loadWorkflowConfig();
  // Menú en TEXTO: es lo que se manda cuando los botones están apagados, y
  // también el respaldo si los botones no se pueden armar. Nunca dejamos al
  // cliente sin saber cómo pagar.
  const enviarMenuEnTexto = async (): Promise<void> => {
    const text = renderOrderBumpTemplate(
      getPaymentText(convo.phone),
      isDiscountActiveForConversation(convo, cfg),
      convo.phone
    );
    await sendBotText(convo, applyPriceTemplate(text, priceSoles, convo));
  };
  if (!cfg?.payment_method_buttons) {
    await enviarMenuEnTexto();
    return;
  }
  const prompt = renderOrderBumpTemplate(
    cfg.payment_buttons_prompt ?? "",
    isDiscountActiveForConversation(convo, cfg),
    convo.phone
  );
  const cuerpo = cuerpoDeBotones(prompt, "menú de métodos de pago");
  if (!cuerpo) {
    await enviarMenuEnTexto();
    return;
  }
  const buttons = getPaymentButtons(convo.phone).map((b, i) => ({
    id: `pmethod:${b.method}:${i}`,
    title: b.label,
  }));
  // Sin métodos configurados no hay burbuja de botones posible: menú de texto.
  if (buttons.length === 0) {
    await enviarMenuEnTexto();
    return;
  }
  await sendBotButtons(convo, cuerpo, buttons);
}

/**
 * MENÚ DE PAGO DE UN SEGUIMIENTO: se envía al FINAL del seguimiento (foto/video
 * + texto propios del seguimiento + opcionalmente los botones compartidos).
 * 2 toggles:
 *   - use_buttons: mostrar los botones de método de pago.
 *   - separate_bubble: botones en burbuja APARTE (vs en la MISMA burbuja de la
 *     foto/video).
 */
async function sendFollowupPaymentMenu(
  convo: ConversationRow,
  menu: {
    enabled?: boolean;
    use_buttons?: boolean;
    separate_bubble?: boolean;
    media_type?: "image" | "video";
    media_url?: string;
    text?: string;
  }
): Promise<void> {
  const config = loadWorkflowConfig();
  const price =
    lockPaymentPrice(
      convo,
      getEffectivePriceSoles(
        isDiscountActiveForConversation(convo, config),
        convo.phone
      ),
      "base",
      config
    ) ?? getLockedOrCurrentBasePrice(convo, config);
  const text = applyPriceTemplate((menu.text ?? "").trim(), price, convo);
  const url = (menu.media_url ?? "").trim();
  const hasMedia = !!url;
  const kind: "image" | "video" = menu.media_type === "video" ? "video" : "image";

  // Sin botones → solo la foto/video con su texto (o solo texto).
  if (!menu.use_buttons) {
    if (hasMedia) await sendBotMediaFromDrive(convo, kind, url, text || undefined);
    else if (text) await sendBotText(convo, text);
    return;
  }

  const buttons = getPaymentButtons(convo.phone).map((b, i) => ({
    // El índice hace el id ÚNICO aunque dos botones tengan el mismo método
    // (WhatsApp rechaza ids de botón duplicados). El handler lee el método
    // tomando lo que va entre "pmethod:" y el siguiente ":".
    id: `pmethod:${b.method}:${i}`,
    title: b.label,
  }));
  // Sin métodos configurados no hay botones: el seguimiento sale igual con su
  // foto/video y su texto, solo que sin la burbuja de botones vacía.
  if (buttons.length === 0) {
    if (hasMedia) await sendBotMediaFromDrive(convo, kind, url, text || undefined);
    else if (text) await sendBotText(convo, text);
    return;
  }
  // El cuerpo de la burbuja de botones: el texto propio del seguimiento si lo
  // tiene, y si no el del menú de pago. Si los dos están vacíos no hay burbuja
  // que mandar, así que se manda solo la foto/video y se avisa en el log.
  const promptDelMenu = loadWorkflowConfig()?.payment_buttons_prompt ?? "";

  if (menu.separate_bubble) {
    // Foto/video + texto en una burbuja; los botones en otra.
    if (hasMedia) await sendBotMediaFromDrive(convo, kind, url, text || undefined);
    else if (text) await sendBotText(convo, text);
    const cuerpo = cuerpoDeBotones(
      hasMedia && text ? promptDelMenu : text || promptDelMenu,
      "menú de pago del seguimiento"
    );
    if (!cuerpo) return;
    await sendBotButtons(convo, cuerpo, buttons);
    return;
  }

  // MISMA burbuja: media en la cabecera + texto en el cuerpo + botones abajo.
  const cuerpo = cuerpoDeBotones(
    text || promptDelMenu,
    "menú de pago del seguimiento"
  );
  if (!cuerpo) {
    if (hasMedia) await sendBotMediaFromDrive(convo, kind, url);
    return;
  }
  if (hasMedia) {
    await sendBotButtonsWithMedia(convo, kind, url, cuerpo, buttons);
  } else {
    await sendBotButtons(convo, cuerpo, buttons);
  }
}

/**
 * Pregunta de precio ESTRICTA para el disparador de order bump al cliente
 * re-enganchado. A diferencia de isPriceQuestion (compartida), "cuanto" SOLO
 * cuenta como precio si va acompañado de una palabra de costo — así se evitan
 * falsos positivos como "cuanto dura", "cuanto pesa", "cuantas hojas".
 */
function asksPriceStrict(msg: string): boolean {
  const n = msg
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return (
    /\b(precio|precios|cuesta|cuestan|vale|valen|valor)\b/.test(n) ||
    /\ba\s+como\b/.test(n) ||
    /\bcuanto\s+(cuesta|cuestan|sale|salen|vale|valen|es|son|seria|serian|me\s+cuesta|pago|pagar|cobran|costaria)\b/.test(
      n
    )
  );
}

/**
 * Detecta señales de DESCONFIANZA / objeción / queja en torno al pago: el
 * cliente menciona un método pero NO para elegirlo, sino para quejarse o
 * expresar miedo (ej. "me robaron con el yape", "no confío en pagar primero",
 * "es estafa?"). En estos casos NO disparamos la respuesta automática de pago
 * — la IA debe escuchar y responder con empatía. Heurística conservadora:
 * solo palabras fuertes de fraude/robo/desconfianza/miedo (no el genérico "no",
 * para no bloquear elecciones legítimas tipo "no tengo yape, uso plin").
 */
export function messageHasPaymentConcern(msg: string): boolean {
  const lower = msg.toLowerCase();
  const patterns = [
    /estaf/, // estafa, estafaron, estafador
    /\brob[oóada]/, // robo, robó, robaron, robada
    /fraud/, // fraude, fraudulento
    /tim(?:o|ó|aron|ar)\b/, // timo, timaron
    /enga[ñn]/, // engaño, engañaron, engañan
    /desconf/, // desconfío, desconfianza
    /no\s+conf[ií]/, // no confío
    /no\s+me\s+f[ií]/, // no me fío
    /\bmiedo\b/,
    /\bsospech/, // sospecha, sospechoso
    /\bladr[oó]n/, // ladrón, ladrones
    // Miedo a PAGAR PRIMERO (desconfianza típica): "yapiar primero",
    // "pagar primero", "primero el pago"…
    /(?:pagar|pago|yap\w*|deposit\w*|transfer\w*)\s+primero/,
    /primero\s+(?:el\s+|me\s+)?(?:pag|cobr|dinero)/,
  ];
  return patterns.some((re) => re.test(lower));
}

/** Minusculas y sin tildes, para las dos detecciones de abajo. */
function normalizaMensaje(msg: string): string {
  return msg
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "");
}

/**
 * El cliente PIDE los datos de pago: "a que numero", "dame los datos",
 * "donde deposito", "cual es la cuenta".
 *
 * Pedir los datos ES querer pagar ya: solo le falta el numero. Por eso cuenta
 * como eleccion implicita cuando todavia no eligio metodo.
 *
 * Las frases venian de una sola expresion que mezclaba esto con "voy a pagar".
 * Se separan porque NO son lo mismo (ver messageAnnouncesPayment). Se conservan
 * todas las que ya habia y se anaden "a que numero / cuenta / banco", que era
 * literalmente lo que escribia la clienta y no matcheaba nada.
 */
function messageAsksForPaymentDetails(msg: string): boolean {
  // EL VERBO SUELTO PEDÍA LO QUE NADIE PIDIÓ.
  //
  // Esta lista aceptaba "dame", "envíame", "pásame" A SECAS, sin decir QUÉ. Se
  // dejó así porque el cliente ya había elegido método y re-enviarle SUS datos
  // parecía inofensivo. No lo era: la pregunta más normal después de pagar
  // —"¿a qué hora me envía?"— contiene "envía", así que el bot respondía
  // mandando otra vez el número de cuenta a alguien que ya había pagado.
  //
  // Y lo peor no se veía: ese bloque se queda el turno. Si el cliente mandó el
  // comprobante en esa misma burbuja, la foto nunca llegaba al lector.
  //
  // Ahora el verbo tiene que decir QUÉ se pide —datos, número o cuenta—, igual
  // que en `messageAsksWhereToPay`. "Reenvíame los datos" sigue funcionando;
  // "¿a qué hora me envía?" ya no.
  return /\b(como\s+(pago|pagar|hago|es\s+el\s+pago)|donde\s+(pago|deposito|transfiero)|cual(es)?\s+(es|son|era)\s+(el|los|la|tu|tus|sus)?\s*(numero|datos|cuenta)|a\s+que\s+(numero|cuenta|banco)|(dame|pasa(me)?|envia(me)?|reenvia(me)?|repite(me)?|recuerda(me)?)\s+(los\s+|el\s+|la\s+|tus\s+|sus\s+)?(datos|numero|cuenta)|los\s+datos|el\s+numero|la\s+cuenta)\b/.test(
    normalizaMensaje(msg)
  );
}

/**
 * Version ESTRICTA de la anterior, para cuando el cliente NO ha elegido metodo.
 *
 * La lista heredada acepta "dame" / "enviame" a secas, porque alli el cliente
 * ya habia elegido y re-enviarle SUS datos era inofensivo. Cuando no ha
 * elegido, un "dame un momento" no puede disparar el envio de datos de pago,
 * asi que aqui el verbo tiene que ir acompanado de lo que pide (datos, numero,
 * cuenta) o ser una pregunta explicita de donde/como pagar.
 */
function messageAsksWhereToPay(msg: string): boolean {
  return /\b(a\s+que\s+(numero|cuenta|banco)|cual(es)?\s+(es|son|era)\s+(el|los|la|tu|tus|sus)?\s*(numero|datos|cuenta)|donde\s+(pago|deposito|transfiero)|como\s+(pago|pagar|hago|es\s+el\s+pago)|(dame|pasa(me)?|envia(me)?|reenvia(me)?|repite(me)?|recuerda(me)?)\s+(los\s+|el\s+|la\s+|tus\s+)?(datos|numero|cuenta)|los\s+datos|el\s+numero|la\s+cuenta)\b/.test(
    normalizaMensaje(msg)
  );
}

/**
 * PIDE QUE LE REPITAN LOS DATOS, SIN AMBIGÜEDAD.
 *
 * Es más estricta que `messageAsksWhereToPay` A PROPÓSITO, y solo se usa para
 * decidir si vale la pena REPETIR una elección que ya se contestó.
 *
 * La otra acepta el sustantivo a secas —«los datos», «la cuenta», «el número»—
 * porque le vale con que el cliente los nombre. Aquí eso no sirve:
 *
 *   «¿esa es LA CUENTA bcp?»   ← pregunta por lo que ya recibió, no lo pide
 *
 * Con la lista floja, esa pregunta contaba como una petición, se le reenviaba el
 * bloque entero… y como la pregunta seguía sin responderse, el cliente la
 * repetía. Ese es el bucle, y no se cierra hasta que la pregunta se distingue
 * de la petición.
 *
 * Así que aquí hace falta el VERBO («mándame los datos») o una pregunta que
 * pida un dato que aún no tiene («¿a qué número?», «¿cuál es la cuenta?»).
 */
/**
 * LA MISMA LLAVE PARA LAS DOS COSAS QUE SE ELIGEN.
 *
 * Una elección es un cuadrito o un método de pago. Se guardan con prefijo para
 * que no se confundan entre sí: un cuadrito titulado «yape» y el método «yape»
 * son elecciones distintas, y bloquear una por la otra sería callar donde toca
 * hablar.
 */
const claveDeCuadrito = (decision: BubbleDecision): string =>
  `cuadrito:${decision.id || decision.title || ""}`;
const claveDeMetodo = (route: string): string => `metodo:${route}`;

function pideQueLeRepitanLosDatos(msg: string): boolean {
  return /\b((dame|pasa(me)?|envia(me)?|manda(me)?|reenvia(me)?|repite(me)?|recuerda(me)?)\s+(los\s+|el\s+|la\s+|tus\s+|sus\s+)?(datos|numero|cuenta)|a\s+que\s+(numero|cuenta|banco)|cual(es)?\s+(es|son|era)\s+(el|los|la|tu|tus|sus)?\s*(numero|datos|cuenta)|donde\s+(pago|deposito|transfiero)|(otra\s+vez|de\s+nuevo|nuevamente)\s+(los\s+)?(datos|numero|cuenta))\b/.test(
    normalizaMensaje(msg)
  );
}

/**
 * El cliente ANUNCIA que va a pagar: "voy a pagar", "procedo", "quiero pagar".
 *
 * NO es pedir los datos. Si ya eligio metodo, re-enviarle sus datos es lo
 * correcto. Pero si NO eligio, mandarle un metodo a dedo seria elegir por el:
 * ahi lo correcto es que el modelo le pregunte cual prefiere.
 */
function messageAnnouncesPayment(msg: string): boolean {
  return /\b(voy\s+a\s+(pagar|yapear|depositar|transferir)|quiero\s+pagar|procedo|paso\s+a\s+pagar)\b/.test(
    normalizaMensaje(msg)
  );
}

/**
 * Detecta si el cliente NOMBRA un metodo de pago pero para DESCARTARLO
 * ("no tengo yape", "no puedo pagar por transferencia", "sin yape").
 * El detector de metodos solo busca palabras sueltas, asi que sin esto una
 * negacion se lee como una eleccion y se envian los datos justo del metodo
 * que el cliente acaba de rechazar.
 *
 * Reglas:
 *  - Solo cuenta una negacion en las 4 palabras ANTERIORES al metodo. Con 3 se
 *    escapaba "no puedo pagar por yape"; con 5 daba falso positivo en "no se
 *    como pagar por yape", que si es una peticion legitima.
 *  - La puntuacion corta la negacion: en "no hay problema, yape" el "no"
 *    pertenece a otra idea. Sin esta barrera se suprimian elecciones validas.
 *
 * Generico: usa los metodos y alias configurados para el pais del cliente. No
 * hay ningun nombre de metodo escrito aqui, asi que sirve para cualquier pais.
 */
function methodMentionIsNegated(msg: string, phone?: string | null): boolean {
  const NEGACIONES = new Set(["no", "ni", "sin", "tampoco", "nunca", "jamas"]);
  const VENTANA = 4;
  const CORTE = "|";
  const norm = (s: string): string =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Mn}/gu, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  // La puntuacion se conserva como barrera antes de limpiar el resto.
  const marcado = msg
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .replace(/[,.;:!?]+/g, ` ${CORTE} `)
    .replace(/[^a-z0-9|]+/g, " ")
    .trim();
  if (!marcado) return false;
  const words = marcado.split(" ").filter(Boolean);
  const keywords = getPaymentMethods(phone)
    .flatMap((method) => [method.label, ...method.aliases])
    .map(norm)
    .filter((kw) => kw && !kw.includes(" "));
  if (keywords.length === 0) return false;
  // UNO SOLO SIN NEGAR BASTA PARA QUE ESTÉ ELIGIENDO.
  //
  // ANTES BASTABA CON QUE UNO ESTUVIERA NEGADO para dar por negado el mensaje
  // entero, y eso tiró una venta completa:
  //
  //   El cliente escribió «yape» y enseguida «no mejor plin». El antirráfaga los
  //   junta en un solo bloque — «yape \n no mejor plin» — y aquí «plin» lleva un
  //   «no» dos palabras antes. Se daba todo por negado, el motor se apartaba, y
  //   el turno se iba al modelo: no se abría la oferta ni salían los datos.
  //   «yape» estaba limpio, sin una sola negación delante, y no servía de nada.
  //
  // LA REGLA CORRECTA ES LA CONTRARIA: si el cliente nombra un método SIN
  // negarlo, está eligiendo ese. Solo es una negación de verdad cuando TODOS los
  // que nombró van negados — «no tengo yape», «no uso yape ni plin».
  //
  // Y lo que protegía sigue protegido: «no tengo yape» tiene una sola mención y
  // está negada, así que se sigue apartando igual que siempre. No se toca la
  // ventana ni la barrera de puntuación, que están ahí por sus propios motivos.
  let algunoNombrado = false;
  for (let i = 0; i < words.length; i++) {
    if (!keywords.includes(words[i])) continue;
    algunoNombrado = true;
    let negado = false;
    for (let j = i - 1; j >= Math.max(0, i - VENTANA); j--) {
      if (words[j] === CORTE) break; // idea distinta: no niega este metodo
      if (NEGACIONES.has(words[j])) {
        negado = true;
        break;
      }
    }
    if (!negado) return false;
  }
  return algunoNombrado;
}

/**
 * Detecta si el mensaje del cliente menciona Yape, BCP o transferencia.
 * Devuelve null si no matchea ninguno.
 */
function detectPaymentRoute(msg: string, phone?: string | null): string | null {
  // MÉTODOS DINÁMICOS primero (bot universal): si hay métodos definidos en el
  // config y uno calza por título/alias, ese manda. Si no hay métodos definidos
  // (o ninguno calza), caemos al reconocimiento CLÁSICO de abajo — Mundial y
  // cualquier config que use yape/bcp/efectivo funciona igual que siempre.
  const dyn = detectDynamicPaymentMethod(msg, phone);
  if (dyn) return dyn;
  if (getPaymentMethods(phone).length > 0) return null;

  const lower = msg.toLowerCase().trim();
  // EFECTIVO: depósito en efectivo en un agente (de preferencia BCP). Usa los
  // mismos datos BCP pero con su propia respuesta. Se revisa ANTES de BCP para
  // que "depósito en efectivo" caiga aquí y no en la ruta BCP normal.
  if (
    /\befectiv/.test(lower) || // efectiv, efectivo
    /\bcash\b/.test(lower) ||
    /\bagente\b/.test(lower)
  ) {
    return "efectivo";
  }
  if (
    /\byape?\b/.test(lower) || // "yape" y el corte "yap"; \b evita matchear "yapa"
    /\bayape?\b/.test(lower) || // "ayape"/"ayap" (a de mas al inicio)
    /\bplin/.test(lower) || // plin, plinn
    // Errores de tipeo comunes de "yape"/"plin" (el cliente escribe rápido y
    // se le va una letra). Lista EXPLÍCITA — no usamos coincidencia difusa
    // para no confundir otras palabras. Cada uno anclado con \b para que
    // nunca matchee dentro de otra palabra.
    /\byapr\b/.test(lower) ||
    /\byapee\b/.test(lower) ||
    /\byapeo\b/.test(lower) ||
    /\byappe\b/.test(lower) ||
    /\byaper\b/.test(lower) ||
    /\bllape\b/.test(lower) ||
    /\bplim\b/.test(lower) ||
    /\bpliin\b/.test(lower) ||
    /\bpilin\b/.test(lower) // transposicion de "plin"
  )
    return "yape";
  if (
    /\bbcp/.test(lower) || // bcp, bcpp
    /\btransfe/.test(lower) || // transfe, transfer, transferncia, transferencia, transferir...
    /\bdep[oó]sit/.test(lower) || // deposito, depósito, depositar

    // Banca móvil / banca por internet / interbancaria → formas concretas
    // de transferencia BCP. NO incluimos "aplicación" porque Yape también
    // es una app y crea ambiguedad.
    /banca\s*m[oó]vil/.test(lower) ||
    /banca\s*por\s*internet/.test(lower) ||
    /\binterbancaria\b/.test(lower)
  ) {
    return "bcp_transferencia";
  }
  return null;
}

/**
 * NOMBRAR UN MÉTODO MIENTRAS ELIGE PRODUCTO TAMBIÉN CUENTA.
 *
 * EL HUECO. El recorrido del dueño dice que el cliente cambia de opinión, y de
 * método, EN CUALQUIER MOMENTO. En todo el resto de la tubería nombrar un
 * método lo deja anotado; en la pantalla de elección de producto, no: si ahí
 * escribía «mejor con BCP», se le recordaban las dos opciones y su método nuevo
 * se perdía. Al elegir producto después, los datos salían por el método VIEJO.
 *
 * AQUÍ SOLO SE ANOTA. No se manda nada ni se consume el turno: sin producto
 * elegido no hay precio que mandar, y esa regla —«nadie recibe un precio que no
 * eligió»— es justo la que puso el reenvío en su sitio. La elección sigue su
 * camino igual que hoy y, cuando elija, los datos salen por SU método.
 *
 * LAS GUARDAS SON LAS MISMAS QUE USA EL PAGO, a propósito: si un día cambian,
 * tienen que cambiar en los dos sitios a la vez.
 *  · Desconfianza: «me robaron con el yape» NOMBRA el método sin elegirlo.
 *  · Negación: «no tengo yape» tampoco lo elige.
 *  · Y si repite el que ya tenía, no se escribe nada.
 */
function anotarMetodoElegidoDuranteLaEleccion(
  convo: ConversationRow,
  msgContent: string
): void {
  const route = detectPaymentRoute(msgContent, convo.phone);
  if (!route) return;
  if (messageHasPaymentConcern(msgContent)) return;
  if (methodMentionIsNegated(msgContent, convo.phone)) return;
  const metodo = normalizeSelectedPaymentMethod(route, msgContent);
  if (convo.selected_payment_method === metodo) return;
  setSelectedPaymentMethod(convo.id, metodo);
  // También la copia de este turno, para que lo que venga detrás la vea: si en
  // el mismo mensaje eligió producto Y método («el combo por BCP»), los datos
  // tienen que salir ya por el nuevo.
  convo.selected_payment_method = metodo;
  console.log(
    `[wf] convo ${convo.id}: anoto su método (${metodo}) sin interrumpir la elección; al elegir producto los datos saldrán por ahí`
  );
}

/**
 * Heurística simple para sacar un nombre del mensaje del cliente. No usamos IA
 * acá porque el LLM cuesta — esto es solo para guardar lo que dijo.
 *
 * Reglas:
 *  - Si el mensaje es corto (<= 4 palabras) y consiste mayormente en letras
 *    → lo tratamos como nombre.
 *  - Si tiene patrones tipo "me llamo X", "soy X", "mi nombre es X" → extraer X.
 *  - Si ninguno aplica → null (no guardamos nada).
 */
function normalizeSelectedPaymentMethod(route: string, msg: string): string {
  const normalizedMethod = msg
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "");
  return route === "yape" && /\bpl(?:in|im|iin)\b/.test(normalizedMethod)
    ? "plin"
    : route;
}

function extractNameFromMessage(msg: string): string | null {
  const text = msg.trim();
  if (!text || text.length > 60) return null;

  const patterns = [
    /me\s+llamo\s+([a-záéíóúñü\s]+)/i,
    /mi\s+nombre\s+es\s+([a-záéíóúñü\s]+)/i,
    /soy\s+([a-záéíóúñü\s]+)/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m && m[1]) {
      const candidate = cleanName(m[1]);
      return isPlausiblePersonName(candidate) ? candidate : null;
    }
  }

  // Mensaje corto y mayormente alfabético → asumimos nombre.
  const words = text.split(/\s+/);
  if (words.length <= 4) {
    const alpha = text.replace(/[^a-záéíóúñü\s]/gi, "").trim();
    if (alpha.length >= 2 && alpha.length / text.length > 0.7) {
      const candidate = cleanName(alpha);
      return isPlausiblePersonName(candidate) ? candidate : null;
    }
  }
  return null;
}

/** Evita guardar como nombre respuestas comunes a la pregunta inicial
 * ("precio", "información", "yape", "quiero comprar", etc.). Ante duda no
 * capturamos nada: es preferible hablar sin nombre que incomodar al cliente. */
function isPlausiblePersonName(candidate: string): boolean {
  const normalized = candidate
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .trim();
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length < 1 || words.length > 3) return false;
  const reserved = new Set([
    "precio", "costo", "valor", "informacion", "info", "detalles",
    "curso", "producto", "pack", "combo", "oferta", "promocion",
    "comprar", "compra", "quiero", "quisiera", "deseo", "necesito",
    "interesado", "interesada", "yape", "plin", "bcp", "transferencia",
    "deposito", "efectivo", "pago", "pagar", "hola", "buenas", "gracias",
    "si", "no", "ok", "listo", "cuanto", "como", "donde", "cuando",
    "peru", "ecuador", "de", "soy",
  ]);
  return words.every(
    (word) => word.length >= 2 && !reserved.has(word)
  );
}

/**
 * Extrae el primer email válido del texto del cliente. Acepta variantes
 * como "mi correo es juan@gmail.com", "Juan@gmail.com gracias", etc.
 * Devuelve null si no se encuentra ninguno.
 */
function extractEmailFromText(text: string): string | null {
  const match = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  return match ? match[0].toLowerCase() : null;
}

/**
 * Detecta si el mensaje del cliente acepta, rechaza o es ambiguo
 * respecto a la oferta del regalo extra.
 *
 * "yes" → procedemos con el audio + instrucciones FB.
 * "no"  → cerramos cordial y vamos a payment_approved.
 * "unclear" → LLM responde, esperamos otra respuesta clara.
 */
function detectGiftConsent(text: string): "yes" | "no" | "unclear" {
  const normalized = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .trim();

  // GUARD ANTI-CONFUSIÓN (regalo vs upgrade): si el mensaje habla de COMPRAR /
  // subir de producto (combo, pack, la diferencia, el otro, completar…), NO es una
  // respuesta al regalo. Devolvemos "unclear" → lo maneja el flujo de upgrade / el
  // LLM y NUNCA se manda el link de Facebook por error. No rompe un "sí/claro/
  // quiero" normal: esas respuestas no llevan estas palabras.
  if (
    /\b(combo|completo|pack|el\s+otro|el\s+mas\s+(caro|completo)|la\s+diferencia|el\s+saldo|el\s+resto|upgrade|completar)\b/.test(
      normalized
    )
  ) {
    return "unclear";
  }

  // Chequeo de NO primero (algunos contienen tokens que aparecen en "yes").
  //
  // OJO: NO usar regex tipo /^no[\s,.!?]/ — eso matchea cualquier mensaje
  // que empiece con "no " (espacio), incluyendo reportes de problemas
  // tecnicos como "no se abre", "no puedo descargar", "no encuentro".
  // Esos no son rechazos del regalo — son problemas reales del cliente
  // que deben caer al LLM para que invoque notify_admin_emergency.
  //
  // Solo clasificamos como rechazo cuando "no" va seguido de una palabra
  // EXPLICITA de rechazo (gracias, me interesa, quiero, etc).
  if (
    /^no$/.test(normalized) ||
    /^no\s*[,.!?]\s*$/.test(normalized) ||
    /\bno[\s,]+(gracias|me\s+interesa|quiero|es\s+necesario|hace\s+falta|por\s+ahora|me\s+gusta|deseo)\b/.test(
      normalized
    ) ||
    /\bpor\s+ahora\s+no\b/.test(normalized) ||
    /\bya\s+(esta|estoy)\s+(bien|ok)\b/.test(normalized) ||
    /\bdejalo\b/.test(normalized) ||
    /\bdejarlo\b/.test(normalized) ||
    /\botra\s+vez\b/.test(normalized) ||
    /\bmas\s+tarde\b/.test(normalized) ||
    /^nah\b/.test(normalized)
  ) {
    return "no";
  }

  // Chequeo de SI
  if (
    /^si+$/.test(normalized) ||
    /^si+[\s,.!?]/.test(normalized) ||
    /^(claro|dale|ok|okay|bueno|listo|perfecto|excelente|genial|sip|seguro|por\s+supuesto)\b/.test(
      normalized
    ) ||
    /\b(me\s+interesa|me\s+gustaria|me\s+gusta|lo\s+quiero|si\s+quiero|acepto|si\s+por\s+favor)\b/.test(
      normalized
    ) ||
    /\bpor\s+favor\b/.test(normalized) ||
    /\b(quiero|deseo|obvio)\b/.test(normalized) ||
    /\b(eso\s+si|claro\s+que\s+si|si\s+claro|de\s+una)\b/.test(normalized) ||
    /\bvamos\b/.test(normalized) ||
    /\bmandalo\b/.test(normalized) ||
    /\benvialo\b/.test(normalized) ||
    /\benviame\b/.test(normalized)
  ) {
    return "yes";
  }

  return "unclear";
}

/**
 * Detecta si el mensaje del cliente confirma que ya comentó en Facebook.
 * Acepta variantes: "comentado", "comente", "ya lo hice", "listo", "hecho",
 * "ya está", "ya dejé el comentario", etc. Quitamos acentos antes de matchear.
 *
 * Como esto solo se evalúa en estado `awaiting_facebook_comment`, podemos
 * ser un poco generosos con confirmaciones implícitas — un falso positivo
 * solo regala un PDF gratis, lo cual es preferible a dejar al cliente
 * esperando porque no usó la palabra mágica exacta.
 *
 * EXCEPCIÓN: si el mensaje contiene una negación explícita ("no lo he",
 * "todavía no", "aún no", "voy a", "lo haré"), NO disparamos.
 */
function containsCommentedKeyword(text: string): boolean {
  const normalized = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "");

  // Negación / futuro → NO es confirmación
  if (
    /\b(no|todavia|aun|aun no|todavia no)\s+(lo|la|he|hice|comente|puedo|deje|comentado)/.test(
      normalized
    ) ||
    /\b(todavia|aun)\s+no\b/.test(normalized) ||
    /\bvoy\s+a\b/.test(normalized) ||
    /\blo\s+har[eé]\b/.test(normalized) ||
    /\bahorita\b/.test(normalized) ||
    /\bdespu[eé]s\b/.test(normalized)
  ) {
    return false;
  }

  return (
    // Confirmación REAL de que ya comentó (pasado/hecho), no una intención
    // presente/futura: "comentado/comentada" y "comenté" cuentan; "comento"
    // ("solo comento y ya") NO — es lo que quiere hacer, no lo que ya hizo.
    /\bcomentad[oa]s?\b/.test(normalized) ||
    /\bcoment[eé]\b/.test(normalized) ||
    /\bya\s+(lo\s+)?(comente|hice|deje|puse|escrib|esta)\b/.test(normalized) ||
    /\blisto\b/.test(normalized) ||
    /\bhecho\b/.test(normalized) ||
    /\bya\s+esta\b/.test(normalized) ||
    /\bya\s+(lo\s+)?termine\b/.test(normalized) ||
    /\b(ahi\s+esta|ya\s+quedo|deje\s+mi\s+comentario)\b/.test(normalized)
  );
}

/**
 * Elige (al azar, PONDERADO por `weight`) el texto del post a comentar entre
 * gift_mechanic.ask_text_variants. Filtra variantes vacías o con placeholders
 * <<...>>. Devuelve null si no hay variantes válidas → el caller usa ask_text.
 * Cero IA / cero tokens: es selección en código, igual que el resto.
 */
/**
 * Si el cliente vino de un anuncio (convo.ad_source_id) y alguna variante lista
 * ese ID en su `ad_ids`, devuelve el texto de ESA variante → el comentario va
 * al post correcto del anuncio del que llegó. Si no hay match (o no hay
 * ad_source_id), devuelve null y el caller cae al azar ponderado.
 * Cero IA / cero tokens: es comparación de strings en código.
 */
const GIFT_AD_LINK_PLACEHOLDER = "{{ENLACE_ANUNCIO}}";

type GiftTextVariant = {
  text?: string;
  weight?: number;
  ad_ids?: string[];
  enabled?: boolean;
  ad_link?: string;
  registry_ad_id?: string;
  /** Marca la variante que sirve de MOLDE para generar los cajones por
   *  anuncio. Es un molde, no un mensaje: nunca se envía. */
  registry_template?: boolean;
};

/**
 * Las variantes que el bot puede llegar a enviar.
 *
 * La PLANTILLA queda fuera siempre. Es el molde del que se sacan los cajones
 * por anuncio, y estaba entrando en el sorteo: conserva peso, y si alguien le
 * pulsó "Añadir enlace" también conserva enlace, así que su texto se podía
 * resolver y salir tal cual. Peor todavía, arrastra los `ad_ids` del cajón del
 * que se hizo, con lo que podía ganarle por coincidencia de anuncio al cajón
 * de verdad y mandar el molde en su lugar. Apagarla tampoco servía si nadie se
 * acordaba de apagarla.
 *
 * Si se quedaran todos los cajones apagados, no hay texto y el ciclo cae al
 * `ask_text` de siempre, que es su respaldo natural.
 */
function getUsableGiftVariants(gift: {
  ask_text_variants?: GiftTextVariant[];
  registry_sync_enabled?: boolean;
}): GiftTextVariant[] | undefined {
  const sinPlantilla = gift.ask_text_variants?.filter(
    (variant) => variant.registry_template !== true
  );
  return gift.registry_sync_enabled === false
    ? sinPlantilla?.filter((variant) => !variant.registry_ad_id)
    : sinPlantilla;
}

function renderGiftVariantText(variant: GiftTextVariant): string | null {
  const text = variant.text?.trim();
  if (!text || (text.includes("<<") && text.includes(">>"))) return null;
  if (!text.includes(GIFT_AD_LINK_PLACEHOLDER)) return text;
  const link = variant.ad_link?.trim();
  return link ? text.split(GIFT_AD_LINK_PLACEHOLDER).join(link) : null;
}

function pickGiftTextByAd(
  variants: GiftTextVariant[] | undefined,
  adSourceId: string | null | undefined
): string | null {
  if (!variants || !adSourceId) return null;
  const wanted = String(adSourceId).trim();
  if (!wanted) return null;
  const match = variants.find(
    (v) =>
      v.enabled !== false &&
      Array.isArray(v.ad_ids) &&
      v.ad_ids.some((id) => String(id).trim() === wanted) &&
      renderGiftVariantText(v)
  );
  return match ? renderGiftVariantText(match) : null;
}

function pickWeightedGiftText(
  variants: GiftTextVariant[] | undefined
): string | null {
  if (!variants || variants.length === 0) return null;
  const valid = variants.filter(
    (v) =>
      v.enabled !== false &&
      renderGiftVariantText(v)
  );
  if (valid.length === 0) return null;
  const weightOf = (v: { weight?: number }) =>
    typeof v.weight === "number" && v.weight > 0 ? v.weight : 1;
  const total = valid.reduce((s, v) => s + weightOf(v), 0);
  let r = Math.random() * total;
  for (const v of valid) {
    const w = weightOf(v);
    if (r < w) return renderGiftVariantText(v);
    r -= w;
  }
  return renderGiftVariantText(valid[valid.length - 1]);
}

/**
 * Cancela todas las acciones del ciclo del regalo (consent, audio, text)
 * que aún estén pendientes. Lo llamamos cuando el ciclo termina (por
 * COMENTADO recibido, "no" en consent, o cuando reprogramamos el inicio)
 * para que no queden acciones zombie que disparen una segunda vez.
 */
function cancelPendingGiftActions(convoId: number): void {
  cancelPendingActionsByTypeForConvo(convoId, ACTION_SEND_GIFT_CONSENT);
  cancelPendingActionsByTypeForConvo(convoId, ACTION_SEND_GIFT_CONSENT_STEP);
  cancelPendingActionsByTypeForConvo(convoId, ACTION_SEND_GIFT_STEP);
  cancelPendingActionsByTypeForConvo(convoId, ACTION_SEND_GIFT_AUDIO);
  cancelPendingActionsByTypeForConvo(convoId, ACTION_SEND_GIFT_TEXT);
}

/**
 * VUELVE A EMPEZAR LA CUENTA DEL REGALO CON CADA MENSAJE DEL CLIENTE.
 *
 * El regalo llega por dos caminos, y los dos esperan un rato antes de salir:
 *
 *   · el plazo del segundo producto (si no contesta, sale el regalo)
 *   · la pregunta del regalo en sí
 *
 * Los dos se programaban a una hora fija. Si el cliente seguía escribiendo, el
 * regalo caía encima de la conversación — y con el segundo producto ofrecido,
 * eso deja dos preguntas abiertas y el cliente no sabe a cuál contesta.
 *
 * Aquí se empujan los dos hacia adelante. El plazo no cambia de duración: lo
 * que cambia es desde cuándo se cuenta, que pasa a ser el ÚLTIMO mensaje. Si el
 * cliente se calla, el regalo sale igual que siempre.
 *
 * No se toca nada que ya esté en marcha: si la pregunta del regalo ya salió, no
 * hay nada pendiente que empujar y esto no hace nada.
 */
/**
 * LOS SEGUIMIENTOS TAMBIÉN ESPERAN A QUE HAYA SILENCIO.
 *
 * EL PROBLEMA. El plazo se contaba desde el primer mensaje y no se movía. Si el
 * cliente seguía escribiendo, el seguimiento caía en mitad de la conversación:
 * «¿sigues ahí?» a alguien que acaba de escribir hace dos minutos. Queda mal y
 * encima interrumpe, porque deja dos preguntas abiertas a la vez.
 *
 * Un seguimiento es para el que se calló. Así que cada mensaje del cliente
 * vuelve a poner el reloj a cero, exactamente igual que ya hacía el regalo.
 *
 * TRES CANDADOS, Y LOS TRES HACEN FALTA:
 *
 *   1. Si ya pagó, no se toca. Ahí los seguimientos no van.
 *   2. Si no hay ninguno pendiente, no se crea ninguno. Sin esto, escribir
 *      después de recibirlos todos resucitaría la cadena entera — o peor,
 *      devolvería los que alguien canceló a propósito.
 *   3. Se vuelve a agendar SOLO desde el siguiente al último que recibió. Sin
 *      esto, el cliente que escribe tras leer el primero recibe el primero otra
 *      vez.
 */
function renovarEsperaDeLosSeguimientos(convo: ConversationRow): void {
  if (convo.state === "payment_approved") return;
  const ahora = Math.floor(Date.now() / 1000);
  if (!hasFuturePendingActionType(convo.id, ACTION_START_FOLLOWUP, ahora)) {
    return;
  }
  cancelPendingActionsByTypeForConvo(convo.id, ACTION_START_FOLLOWUP);
  // `last_followup_index` vale -1 mientras no se haya enviado ninguno, así que
  // el siguiente es el 0 y se reagenda la cadena entera.
  scheduleFollowupSequences(convo.id, (convo.last_followup_index ?? -1) + 1);
  console.log(
    `[wf] convo ${convo.id}: sigue escribiendo, los seguimientos vuelven a contar desde ahora`
  );
}

/**
 * LOS SEGUNDOS QUE FALTAN PARA CUMPLIR EL SILENCIO, CONTADOS DESDE EL ÚLTIMO
 * MENSAJE DEL CLIENTE.
 *
 * EL CAMPO SE LLAMA «SILENCIO ANTES DE OFRECER EL REGALO», Y NO ERA SILENCIO.
 *
 * El plazo se programaba desde el instante en que le tocaba el turno al regalo
 * —o sea, desde que se cerraba la ventana del segundo producto—, así que el
 * número del dueño se SUMABA a esa ventana en vez de medir su silencio. Con la
 * ventana en 3 min y el campo en 60 s, el regalo salía a los 4 minutos, y él
 * solo había escrito uno de los dos números.
 *
 * Peor: al contarse desde el cierre de la ventana y no desde el cliente, bastaba
 * con que el bot tardara en contestar —hubo respuestas de 32 segundos— para que
 * la ventana se comiera casi entera y el regalo cayera encima de la
 * conversación. Pasó el 14 de septiembre de 2026: el cliente estaba decidiendo
 * el segundo producto, se cruzó la pregunta del regalo, quedaron DOS preguntas
 * abiertas y el bot ya no supo a cuál contestaba su «ok» — hasta se rió para
 * salir del paso.
 *
 * Ahora el plazo se ancla al ÚLTIMO MENSAJE DEL CLIENTE. Pone 300 y el regalo
 * sale cuando el cliente lleva 300 segundos callado, no 300 después de otra
 * cosa. Nunca en el pasado: si ese momento ya pasó, sale al segundo siguiente.
 *
 * La ventana del segundo producto NO se toca: sigue siendo suya y sigue
 * mandando mientras esté abierta. Lo único que cambia es desde dónde cuenta el
 * regalo.
 */
/**
 * EL ÚNICO PLAZO DEL REGALO, EN SEGUNDOS.
 *
 * ANTES ERAN DOS, Y LOS DOS SE LLAMABAN IGUAL. En el editor había un campo en la
 * pestaña Upsell —«Minutos de SILENCIO antes de soltar el regalo»— y otro en la
 * de Regalo —«Silencio antes de ofrecer el regalo (seg)»—. El primero decidía
 * cuándo se soltaba el regalo y el segundo cuándo salía su pregunta, así que el
 * tiempo real era la SUMA de ambos y el dueño solo escribía uno. Puso 60
 * segundos y el regalo llegaba a los cuatro minutos.
 *
 * Orden suya, del 14 de septiembre de 2026: «necesito que solo haya un tiempo de
 * espera para mostrar el ofrecimiento de regalo, deja solo el de la sección
 * regalo». Así que manda ese, y el de la pestaña Upsell deja de leerse.
 *
 * SE RENUEVA CON CADA MENSAJE DEL CLIENTE — ver `renovarEsperaDelRegalo`— y se
 * cuenta desde el último, no desde que le tocó el turno al regalo — ver
 * `loQueFaltaDeSilencio`.
 */
function segundosDeSilencioAntesDelRegalo(
  config: WorkflowConfig | null
): number {
  return Math.max(
    1,
    Math.floor(
      config?.awaiting_email_timeout_seconds ?? DEFAULT_AWAITING_EMAIL_TIMEOUT
    )
  );
}

function loQueFaltaDeSilencio(
  conversationId: number,
  segundos: number
): number {
  const ahora = Math.floor(Date.now() / 1000);
  const ultimoDelCliente = getLatestUserMessage(conversationId);
  const desde = ultimoDelCliente?.created_at ?? ahora;
  return Math.max(1, desde + segundos - ahora);
}

/**
 * LA OFERTA DEL SEGUNDO PRODUCTO TAMBIÉN ESPERA AL SILENCIO.
 *
 * Su plazo se programaba desde la ENTREGA y no se movía, así que caía encima de
 * la conversación igual que hacía el regalo antes de arreglarlo. Dictado por el
 * dueño el 2026-09-14:
 *
 *   «cliente compra, se activa el reloj de upsell y de regalo —por ejemplo,
 *    upsell a los 2 minutos y regalo a los 4—. Si el cliente sigue hablando se
 *    reinician los dos. Cliente agradece y se va: sale primero el upsell. Si
 *    entonces lee y conversa, el reloj del upsell YA TERMINÓ y no se reinicia;
 *    el que se reinicia es el del regalo, que no terminó.»
 *
 * Esa última parte sale sola y no hay que programarla: aquí solo se renueva lo
 * que sigue PENDIENTE. Un plazo que ya disparó deja de existir, así que no hay
 * nada que devolver a cero.
 *
 * SIN ESPERA CONFIGURADA NO SE TOCA NADA: con `retraso_minutos` en 0 la oferta
 * sale enseguida tras la entrega, que es lo que han hecho siempre las
 * modalidades de antes.
 */
function renovarEsperaDelUpsell(
  convo: ConversationRow,
  config: WorkflowConfig
): void {
  if (!hasPendingActionType(convo.id, ACTION_UPSELL_PRESENTAR)) return;
  const minutos = Math.max(
    0,
    Math.floor(seccionUpsell(config)?.retraso_minutos ?? 0)
  );
  if (minutos <= 0) return;
  const segundos = minutos * 60;
  cancelPendingActionsByTypeForConvo(convo.id, ACTION_UPSELL_PRESENTAR);
  scheduleAction(
    convo.id,
    ACTION_UPSELL_PRESENTAR,
    {},
    Math.floor(Date.now() / 1000) + loQueFaltaDeSilencio(convo.id, segundos)
  );
  console.log(
    `[wf:upsell] convo ${convo.id}: sigue hablando, la oferta vuelve a contar ${minutos} min de silencio`
  );
}

function renovarEsperaDelRegalo(
  convo: ConversationRow,
  config: WorkflowConfig
): void {
  // Los DOS relojes vuelven a cero con cada mensaje. Va fuera del freno del
  // regalo entregado: la oferta del segundo producto es independiente de si el
  // regalo ya se dio o no.
  renovarEsperaDelUpsell(convo, config);
  if (convo.gift_rewarded) return;
  // El plazo del segundo producto manda mientras su oferta siga en pie.
  if (hasPendingActionType(convo.id, ACTION_UPSELL_TIMEOUT)) {
    // El mismo y único plazo, otra vez entero desde ahora: el cliente acaba de
    // escribir, así que su silencio vuelve a empezar aquí.
    const segundos = segundosDelPlazoDeLaOferta(
      convo,
      config,
      segundosDeSilencioAntesDelRegalo(config)
    );
    cancelPendingActionsByTypeForConvo(convo.id, ACTION_UPSELL_TIMEOUT);
    scheduleAction(
      convo.id,
      ACTION_UPSELL_TIMEOUT,
      {},
      Math.floor(Date.now() / 1000) + loQueFaltaDeSilencio(convo.id, segundos)
    );
    console.log(
      `[wf:upsell] convo ${convo.id}: sigue hablando, el regalo vuelve a contar ${segundos}s de silencio`
    );
    return;
  }
  // Si no, la pregunta del regalo con su propia espera.
  if (hasPendingActionType(convo.id, ACTION_SEND_GIFT_CONSENT)) {
    const segundos = Math.max(
      1,
      Math.floor(
        config.awaiting_email_timeout_seconds ?? DEFAULT_AWAITING_EMAIL_TIMEOUT
      )
    );
    cancelPendingActionsByTypeForConvo(convo.id, ACTION_SEND_GIFT_CONSENT);
    // Desde SU último mensaje, que es lo que significa «silencio». Ver
    // `loQueFaltaDeSilencio`.
    const faltan = loQueFaltaDeSilencio(convo.id, segundos);
    scheduleAction(
      convo.id,
      ACTION_SEND_GIFT_CONSENT,
      {},
      Math.floor(Date.now() / 1000) + faltan
    );
    console.log(
      `[wf] convo ${convo.id}: sigue hablando, la pregunta del regalo se corre ${faltan}s más`
    );
  }
}

/**
 * Programa la pregunta de consentimiento del regalo con un retraso
 * inicial. Reemplaza al antiguo "scheduleGiftSequenceWithDelay" —
 * ahora la primera cosa que llega al cliente es UNA PREGUNTA pidiendo
 * si quiere el bonus, no directamente el audio + link FB.
 *
 * Si el cliente acepta, recién se programa el audio + texto (vía
 * scheduleGiftAudioAndText). Si rechaza, se cierra cordial. Si no
 * responde, queda en awaiting_gift_consent indefinidamente.
 */
function scheduleGiftConsentWithDelay(
  convoId: number,
  initialDelaySec: number
): void {
  const config = loadWorkflowConfig();
  const gift = config?.gift_mechanic;
  if (!gift) return;
  if (sectionHasPlaceholder(gift)) {
    console.log(
      `[wf] gift_mechanic tiene placeholders, no programo consent`
    );
    return;
  }
  // Cancelamos cualquier consent/audio/text previo para evitar que una
  // accion zombie dispare la consent de nuevo despues de cerrado el ciclo.
  cancelPendingGiftActions(convoId);
  setGiftReminderSent(convoId, false);
  const now = Math.floor(Date.now() / 1000);
  scheduleAction(
    convoId,
    ACTION_SEND_GIFT_CONSENT,
    {},
    now + initialDelaySec
  );
  console.log(
    `[wf] pregunta de consent del regalo programada para convo ${convoId} en ${initialDelaySec}s`
  );
}

/** Repite UNA vez la secuencia visual de consentimiento después de capturar
 * el correo mientras la invitación al regalo seguía pendiente. */
function scheduleGiftConsentReminder(
  convoId: number,
  delaySec: number
): void {
  cancelPendingActionsByTypeForConvo(convoId, ACTION_SEND_GIFT_CONSENT);
  cancelPendingActionsByTypeForConvo(convoId, ACTION_SEND_GIFT_CONSENT_STEP);
  setGiftReminderSent(convoId, true);
  scheduleAction(
    convoId,
    ACTION_SEND_GIFT_CONSENT,
    {},
    Math.floor(Date.now() / 1000) + delaySec
  );
  console.log(
    `[wf] recordatorio visual del regalo programado una vez para convo ${convoId}`
  );
}

/**
 * ¿Se vuelve a pedir el correo después del regalo?
 *
 * Interruptor propio. Cuando falta —una configuración que nadie ha tocado desde
 * que esto existe— hereda el del re-ofrecimiento del regalo, que es con quien
 * iba pegado: así el bot se comporta exactamente igual que antes hasta que
 * alguien decida separarlos.
 */
function pedirCorreoTrasElRegalo(config: WorkflowConfig | null): boolean {
  if (typeof config?.post_sale_email_reminder_enabled === "boolean") {
    return config.post_sale_email_reminder_enabled;
  }
  return config?.post_sale_reoffer !== false;
}

/** Repite una sola vez el pedido de correo configurable despues del regalo. */
function scheduleEmailReminderAfterGift(convo: ConversationRow): void {
  if (loadWorkflowConfig()?.post_sale_delivery_preference?.enabled === true) return;
  if (convo.client_email || convo.email_reminder_sent) return;
  if (hasPendingActionType(convo.id, ACTION_SEND_EMAIL_REMINDER)) return;
  const delay =
    loadWorkflowConfig()?.between_messages_delay_seconds ??
    DEFAULT_BETWEEN_MESSAGES_DELAY;
  scheduleAction(
    convo.id,
    ACTION_SEND_EMAIL_REMINDER,
    {},
    Math.floor(Date.now() / 1000) + delay
  );
}

function normalizeDeliverySource(value: unknown): DeliverySource | null {
  return value === "approved" ||
    value === "upsell" ||
    value === "bioferta_a" ||
    value === "bioferta_b" ||
    value === "bioferta_pack" ||
    value === "ob_combo" ||
    value === "ob_basico"
    ? value
    : null;
}

function detectDeliveryPreference(text: string): "whatsapp" | "email" | null {
  const normalized = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .replace(/[^a-z0-9@._+-]+/g, " ")
    .trim();
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text)) return "email";
  if (detectEmailDeclineOrProblem(text)) return "whatsapp";
  if (
    /\b(correo|crreo|email|e mail|gmail|g mail|hotmail|outlook|live|yahoo|icloud|a los dos|los dos|tambien|ambos)\b/.test(
      normalized
    )
  ) {
    return "email";
  }
  if (
    /\b(solo\s*)?(whatsapp|whatsa|wsp|wasap|wa)\b/.test(normalized) ||
    /\b(solo|por aqui|aca nomas|aqui nomas|por este medio|no tengo correo|no uso correo|sin correo|no recuerdo mi correo|despues correo)\b/.test(
      normalized
    )
  ) {
    return "whatsapp";
  }
  return null;
}

function normalizeEmailIntentText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .replace(/[^a-z0-9@._+-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function mentionsEmailChannel(text: string): boolean {
  const normalized = normalizeEmailIntentText(text);
  return /\b(correo|crreo|email|e mail|mail|gmail|g mail|hotmail|outlook|live|yahoo|icloud)\b/.test(
    normalized
  );
}

function detectEmailDeclineOrProblem(text: string): boolean {
  if (extractEmailFromText(text)) return false;
  const normalized = normalizeEmailIntentText(text);
  if (!normalized) return false;
  if (
    /\b(solo|mejor|mandalo|mandame|envialo|enviame|dejalo)\s+(por\s+)?(whatsapp|whatsa|wsp|wasap|wa|aqui)\b/.test(
      normalized
    ) ||
    /\b(whatsapp|whatsa|wsp|wasap|wa)\s*(nomas|no mas|solo)\b/.test(
      normalized
    ) ||
    /\bpor\s+(aqui|este\s+medio)\b/.test(normalized) ||
    /\baqui\s+nomas\b/.test(normalized)
  ) {
    return true;
  }
  if (
    /\b(no\s+tengo|no\s+uso|no\s+recuerdo|no\s+me\s+acuerdo|no\s+puedo|no\s+se|sin)\s+(correo|crreo|email|e mail|mail|gmail|hotmail|outlook|clave|contrasena)\b/.test(
      normalized
    ) ||
    /\b(correo|crreo|email|e mail|mail|gmail|hotmail|outlook|live|yahoo|icloud)\s+(lleno|llena|bloqueado|bloqueada|saturado|saturada)\b/.test(
      normalized
    ) ||
    /\b(se\s+me\s+olvido|olvide|olvido|perdi)\s+(la\s+)?(clave|contrasena|correo|crreo|email)\b/.test(
      normalized
    ) ||
    /\b(no\s+tengo|no\s+recuerdo|no\s+me\s+acuerdo|se\s+me\s+olvido|olvide|olvido|correo\s+lleno|esta\s+lleno|esta\s+llena)\b/.test(
      normalized
    )
  ) {
    return true;
  }
  return false;
}

function looksLikeInvalidEmailAttempt(text: string): boolean {
  if (extractEmailFromText(text) || detectEmailDeclineOrProblem(text)) {
    return false;
  }
  const normalized = normalizeEmailIntentText(text);
  if (text.includes("@")) return true;
  if (
    /\b[a-z0-9._%+-]{2,}\s+(gmail|g mail|hotmail|outlook|live|yahoo|icloud)\s+(com|pe|es|net|org)\b/.test(
      normalized
    ) ||
    /\b(gmail|g mail|hotmail|outlook|live|yahoo|icloud)\s+(com|pe|es|net|org)\b/.test(
      normalized
    )
  ) {
    return true;
  }
  return false;
}

function looksLikeSuspiciousEmailTypo(email: string): boolean {
  const normalized = email.toLowerCase();
  const domain = normalized.split("@")[1] ?? "";
  return [
    "gamil.com",
    "gmial.com",
    "gmail.con",
    "gmail.co",
    "hotmai.com",
    "hotmal.com",
    "hotmail.con",
    "outlok.com",
    "outlook.con",
    "live.con",
    "yaho.com",
    "yahoo.con",
    "icloud.con",
  ].includes(domain);
}

function getDeliveryPreferenceEmailRequestText(
  config: WorkflowConfig | null
): string {
  return (
    config?.post_sale_delivery_preference?.email_request_text?.trim() ||
    "Genial. Enviame tu correo y tambien te lo envio alli para que conserves tu acceso."
  );
}

async function sendPostSaleDeliverySteps(
  convo: ConversationRow,
  steps: ResponseStep[] | undefined
): Promise<boolean> {
  const activeSteps = Array.isArray(steps)
    ? steps.filter((step) => step.enabled !== false)
    : [];
  if (activeSteps.length === 0) return false;
  for (const step of activeSteps) {
    await sendResponseStep(convo, step, undefined, true);
    const delay = Math.max(
      0,
      Math.floor((step as { delay_after_sec?: number }).delay_after_sec ?? 0)
    );
    if (delay > 0) await new Promise((res) => setTimeout(res, delay * 1000));
  }
  return true;
}

function getDeliveryPreferenceFallbackText(config: WorkflowConfig | null): string {
  return (
    config?.post_sale_delivery_preference?.fallback_whatsapp_text?.trim() ||
    "Te lo dejo por WhatsApp para que lo tengas ahora. Si luego quieres respaldo por correo, enviame tu email."
  );
}

async function sendDeliveryPreferenceEmailRequestNow(
  convo: ConversationRow,
  config: WorkflowConfig | null
): Promise<void> {
  const sentSteps = await sendPostSaleDeliverySteps(
    convo,
    config?.post_sale_delivery_preference?.email_request_steps
  );
  if (!sentSteps) {
    await sendBotText(convo, getDeliveryPreferenceEmailRequestText(config));
  }
}

async function sendDeliveryPreferenceFallbackNow(
  convo: ConversationRow,
  config: WorkflowConfig | null
): Promise<void> {
  const sentSteps = await sendPostSaleDeliverySteps(
    convo,
    config?.post_sale_delivery_preference?.fallback_whatsapp_steps
  );
  if (!sentSteps) {
    await sendBotText(convo, getDeliveryPreferenceFallbackText(config));
  }
}

function scheduleDeliveryPreferenceEmailRequest(
  convo: ConversationRow,
  config: WorkflowConfig | null
): void {
  const delay =
    config?.between_messages_delay_seconds ?? DEFAULT_BETWEEN_MESSAGES_DELAY;
  const steps =
    config?.post_sale_delivery_preference?.email_request_steps?.filter(
      (step) => step.enabled !== false
    ) ?? [];
  if (steps.length > 0) {
    let runAt = Math.floor(Date.now() / 1000) + delay;
    for (const step of steps) {
      scheduleAction(
        convo.id,
        ACTION_SEND_POST_SALE_DELIVERY_STEP,
        { step },
        runAt
      );
      runAt += Math.max(
        0,
        Math.floor(
          (step as { delay_after_sec?: number }).delay_after_sec ??
            DEFAULT_BETWEEN_MESSAGES_DELAY
        )
      );
    }
    return;
  }
  scheduleAction(
    convo.id,
    ACTION_SEND_TEXT_CHUNK,
    { body: getDeliveryPreferenceEmailRequestText(config) },
    Math.floor(Date.now() / 1000) + delay
  );
}

function deliverAfterPreference(
  convo: ConversationRow,
  source: DeliverySource
): boolean {
  if (!claimDeliveryPreference(convo.id)) {
    console.log(
      `[wf] convo ${convo.id}: elección de entrega ya procesada, no duplico la entrega`
    );
    return false;
  }
  const delivered = scheduleDeliveryBySource(convo.id, source, {
    skipLastStep: true,
    sendFirstStepImmediately: true,
  });
  if (!delivered) {
    console.warn(
      `[wf] convo ${convo.id}: no pude programar entrega por preferencia (${source})`
    );
    setConversationState(convo.id, "payment_approved");
    setPendingDeliverySource(convo.id, null);
  }
  return delivered;
}

function getConfiguredEmailReminder(convo: ConversationRow): string | null {
  // Recordatorio de correo: SOLO ofrece enviar el material al correo y pide la
  // dirección. NO reenvía el enlace del producto. (Antes reconstruía el texto
  // desde la secuencia de ENTREGA y terminaba reenviando el enlace de descarga
  // ya entregado — se veía como un re-envío del producto sin motivo.) Se puede
  // personalizar por producto con el campo `email_reminder_text` de la config.
  const configured = loadWorkflowConfig()?.email_reminder_text?.trim();
  void convo;
  return (
    configured ||
    "*Recuerda que los mensajes de whatsapp suelen desaparecer con el tiempo.*\n\n*Envíame tu correo electrónico* 📧 para que lo tengas siempre a la mano y *no pierdas acceso* 😊."
  );
}

/**
 * Programa el audio + texto del regalo a continuación de un "sí" del
 * cliente en awaiting_gift_consent. Audio sale en ~between segundos
 * desde ahora, texto sale audio + between después.
 */
function scheduleGiftAudioAndText(convoId: number): void {
  const config = loadWorkflowConfig();
  const gift = config?.gift_mechanic;
  if (!gift || sectionHasPlaceholder(gift)) return;
  const between =
    config?.between_messages_delay_seconds ?? DEFAULT_BETWEEN_MESSAGES_DELAY;
  const now = Math.floor(Date.now() / 1000);
  const activeSteps = gift.ask_sequence
    ?.map((step, index) => ({ step, index }))
    .filter(
      ({ step }) =>
        step.enabled !== false &&
        (step.type === "text"
          ? !!pickVariant(step.body_variants, step.body)?.trim()
          : !!step.drive_url?.trim())
    );
  if (activeSteps?.length) {
    let offset = between;
    activeSteps.forEach(({ step, index }, activeIndex) => {
      scheduleAction(
        convoId,
        ACTION_SEND_GIFT_STEP,
        {
          step_index: index,
          is_last: activeIndex === activeSteps.length - 1,
        } satisfies SendGiftStepPayload,
        now + offset
      );
      offset += Math.max(0, step.delay_after_sec ?? between);
    });
    console.log(
      `[wf] secuencia del regalo (${activeSteps.length} pasos) programada para convo ${convoId}`
    );
    return;
  }
  // APAGAR TODAS LAS BURBUJAS NO RESUCITA EL AUDIO VIEJO.
  //
  // El camino de abajo es para configuraciones antiguas, sin secuencia: manda
  // el audio del campo "Audio del regalo" y luego el texto. Pero si la
  // secuencia EXISTE y está toda apagada, apagarla fue una decisión: mandar
  // igual ese audio contradice lo que se ve en pantalla —la burbuja de audio
  // apagada— y suena un audio que nadie pidió.
  //
  // En ese caso va solo el texto. No puede ir nada: el ciclo se quedaría a
  // medias, sin avisar a la clienta y sin pasar al paso de comentar.
  const haySecuenciaConfigurada = (gift.ask_sequence?.length ?? 0) > 0;
  if (haySecuenciaConfigurada) {
    scheduleAction(convoId, ACTION_SEND_GIFT_TEXT, {}, now + between);
    console.log(
      `[wf] secuencia del regalo toda apagada en convo ${convoId}: mando solo el texto, sin el audio viejo`
    );
    return;
  }
  const audioAt = now + between;
  const textAt = audioAt + between;
  scheduleAction(convoId, ACTION_SEND_GIFT_AUDIO, {}, audioAt);
  scheduleAction(convoId, ACTION_SEND_GIFT_TEXT, {}, textAt);
  console.log(
    `[wf] audio + texto del regalo programados para convo ${convoId}: audio en ${between}s, texto en ${between * 2}s`
  );
}

/**
 * Si el mensaje del cliente trae un email válido, lo guarda, manda el correo
 * del curso por SMTP, y confirma. Si ya había correo, permite actualizarlo y
 * reenviar a uno nuevo tras la venta.
 * NO cambia el estado de la conversación — eso lo gestiona el caller.
 * Devuelve true si capturó algo, false si no había email.
 */
async function tryCaptureEmail(
  convo: ConversationRow,
  msgContent: string
): Promise<boolean> {
  const email = extractEmailFromText(msgContent);
  if (!email) return false;
  if (looksLikeSuspiciousEmailTypo(email)) {
    await sendBotText(
      convo,
      `Creo que el correo *${email}* tiene un error. Enviamelo completo y revisado, por ejemplo: nombre@gmail.com`
    );
    return true;
  }

  setClientEmail(convo.id, email);
  console.log(`[wf] email capturado/actualizado para convo ${convo.id}: ${email}`);

  const emailSent = await trySendCourseEmail(email, convo);
  if (emailSent) {
    await sendBotText(
      convo,
      `✅ ¡Recibí tu correo: *${email}*!\n\n📧 Te lo envié también allí para que no lo pierdas. Si no te aparece en tu bandeja de entrada, revisa la carpeta de *SPAM* / *Correo no deseado* 🔎`
    );
  } else {
    await sendBotText(
      convo,
      `✅ ¡Recibí tu correo: *${email}*!\n\nHubo un detalle al enviarlo, pero ya tienes el enlace aquí en WhatsApp. Si lo necesitas reenviado, avísame.`
    );
  }
  await maybeSendCustomerSurveyNow(convo.id);
  return true;
}

/**
 * Envía el email del curso al cliente. Devuelve true si OK, false si
 * faltó configuración o el SMTP rechazó. Nunca tira excepción para que
 * la captura del email no rompa el flujo de WhatsApp.
 */
async function trySendCourseEmail(
  to: string,
  convo: ConversationRow
): Promise<boolean> {
  if (convo.channel === "test") {
    console.log(`[test] correo suprimido para convo ${convo.id}`);
    return true;
  }
  const config = loadWorkflowConfig();
  // El correo sigue la ÚLTIMA opción que recibió el cliente: si terminó en el
  // combo (compra directa o upgrade desde el básico), usa la plantilla VIP; si
  // no, la básica. Vale para order bump Y doble oferta 2 productos (antes exigía
  // order_bump.enabled, así que en doble oferta el combo recibía el correo básico).
  const isVipPurchase = convo.order_bump_choice === "combo";
  // EL SEGUNDO PRODUCTO TIENE SU PROPIO CORREO, y manda sobre los otros dos.
  //
  // Quien acaba de pagar el extra necesita SU acceso. Con las plantillas de
  // arriba recibía el enlace del primer producto: el equivocado, y encima uno
  // que ya tenía. Igual que la entrega, que también va aparte.
  //
  // Sin plantilla propia no se manda nada y queda escrito. Es a propósito:
  // mandar el acceso del producto que no era es peor que no mandar correo.
  const esCompraDelExtra = convo.upsell_state === "pagado";
  // UPSELLS EN FILA: la plantilla del extra es la del upsell de SIEMPRE. Si lo que acaba
  // de pagar es otro producto de la fila —o su downsell de otro producto—, esa plantilla
  // lleva el acceso equivocado. La regla de arriba manda: mejor ningún correo que el
  // acceso de otro producto. Su material ya le llegó por WhatsApp.
  if (esCompraDelExtra && convo.upsell_producto_id) {
    console.warn(
      `[email] convo ${convo.id}: compró un producto de la fila; la plantilla del extra es de otro producto, no se envía email`
    );
    return false;
  }
  const cual = esCompraDelExtra
    ? "email_template_upsell"
    : isVipPurchase
      ? "email_template_vip"
      : "email_template";
  const tpl = esCompraDelExtra
    ? config?.email_template_upsell
    : isVipPurchase
      ? config?.email_template_vip
      : config?.email_template;
  if (!tpl) {
    console.warn(`[email] ${cual} no configurado, no se envía email`);
    return false;
  }
  if (sectionHasPlaceholder(tpl)) {
    console.warn("[email] email_template tiene placeholders, no se envía email");
    return false;
  }
  // Plantilla SIN RELLENAR: existe como objeto pero con los campos en blanco.
  // Pasa los dos guardas de arriba, así que hay que mirarla aparte. Sin esto,
  // una modalidad recién creada le mandaría un correo vacío a quien pagó.
  if (!tpl.subject?.trim() || !tpl.body?.trim()) {
    console.warn(
      `[email] ${cual} está vacío (sin asunto o sin cuerpo), no se envía email`
    );
    return false;
  }
  const discountActive = isDiscountActiveForConversation(convo, config);
  // El precio de los comodines sigue al producto del correo. Con el del primero
  // el correo del extra anunciaría un importe que no es el que se pagó.
  const price = esCompraDelExtra
    ? getUpsellPriceSoles(discountActive, convo.phone, config) ??
      getLockedOrCurrentBasePrice(convo, config)
    : convo.order_bump_choice === "combo" || convo.order_bump_choice === "basico"
      ? getOrderBumpPriceSoles(convo.order_bump_choice, discountActive, convo.phone) ??
        getLockedOrCurrentBasePrice(convo, config)
      : getLockedOrCurrentBasePrice(convo, config);
  const renderEmailText = (text: string): string =>
    applyPriceTemplate(
      renderOrderBumpTemplate(text, discountActive, convo.phone),
      price,
      convo
    );
  try {
    await sendEmail({
      to,
      fromName: renderEmailText(tpl.from_name),
      subject: renderEmailText(tpl.subject),
      body: renderEmailText(tpl.body),
    });
    console.log(`[email] enviado a ${to}`);
    return true;
  } catch (err) {
    console.error(`[email] fallo enviando a ${to}:`, err);
    return false;
  }
}

function cleanName(raw: string): string {
  const cleaned = raw.trim().replace(/\s+/g, " ").slice(0, 40);
  // Capitalizar inicial de cada palabra.
  return cleaned
    .split(" ")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(" ");
}
