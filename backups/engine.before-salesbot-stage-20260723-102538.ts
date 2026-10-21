import {
  activateDiscount,
  addToPaidTotal,
  cancelPendingActionsByTypeForConvo,
  cancelPendingActionsForConvo,
  clearClientEmail,
  clearClientName,
  clearNocodbSync,
  countPendingActionsInWindow,
  deactivateDiscount,
  deleteAllMessages,
  getConversationById,
  getLastUserMessageTime,
  getLatestUserMessage,
  getRecentUserMessages,
  getConversationsForFollowupBackfill,
  hasFuturePendingActionType,
  hasPendingActionType,
  hasUserMessageSinceFollowupStart,
  resetFollowupTracking,
  resetPaidTotal,
  resetPaymentAttemptsFailed,
  scheduleAction,
  setBiofertaChoice,
  setOrderBumpChoice,
  setIntroVariantSent,
  setSelectedPaymentMethod,
  setClientEmail,
  setClientName,
  setConversationState,
  setEmailReminderSent,
  setGiftReminderSent,
  setGiftRewarded,
  setCustomerSurveySent,
  setLastFollowupIndex,
  setLastFollowupStartedAt,
  setMode,
  type ConversationRow,
  type ScheduledActionRow,
  type WorkflowState,
} from "@/lib/db";
import {
  adjustForQuietHours,
  computeNextFollowupSlot,
  cumulativeBurstOffset,
  isQuietHour,
} from "@/lib/workflow/quiet-hours";

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
import {
  applyCustomPlaceholders,
  applyProductName,
  detectBiofertaChoice,
  detectTwoTierPick,
  detectDynamicPaymentMethod,
  getDefaultPaymentMethodId,
  getEffectiveCountryCode,
  inferTwoTierChoiceFromContext,
  getBiofertaPriceSoles,
  getEffectivePriceSoles,
  getPaymentButtons,
  getPaymentMethods,
  getPaymentText,
  isCountrySalesEnabled,
  getOrderBumpPriceSoles,
  getActiveWorkflowChannel,
  isDiscountActiveForConversation,
  isBiofertaActive,
  isOrderBumpActive,
  isDobleOfertaActive,
  getActiveTwoTierOffer,
  loadWorkflowConfig,
  withWorkflowChannel,
  DEFAULT_BETWEEN_MESSAGES_DELAY,
  DEFAULT_CUSTOMER_SURVEY_MESSAGE,
  pickVariant,
  renderOrderBumpTemplate,
  resolveSpintax,
  sectionHasPlaceholder,
  type SalesbotRule,
  type FollowupSequence,
  type ResponseStep,
  type WorkflowConfig,
} from "@/lib/workflow/config";
import {
  deliverBiofertaTier,
  resolveAccumulatedOrderBumpChoice,
  resendApprovedMaterial,
} from "@/lib/workflow/payment";
import {
  sendBotButtons,
  sendBotButtonsWithMedia,
  sendBotMediaFromDrive,
  sendBotText,
} from "@/lib/workflow/sender";
import { sendEmail } from "@/lib/email";
import { notifyAdmin } from "@/lib/notifications";
import { getCountryInfo } from "@/lib/countries";
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
 *  - fallback_intro:  si tras el saludo el cliente no respondió, lanza el
 *                     intro de igual forma (timer de N min)
 */
type ActionType =
  | "send_intro_step"
  | "fallback_intro"
  | "send_payment_step"
  | "send_text_chunk"
  | "send_payment_approved_step"
  | "send_gift_consent"
  | "send_gift_consent_step"
  | "send_gift_step"
  | "send_gift_audio"
  | "send_gift_text"
  | "send_email_reminder"
  | "send_customer_survey"
  | "exit_awaiting_email"
  | "auto_switch_human_after_gift_comment"
  | "start_followup"
  | "send_followup_step";

interface SendIntroStepPayload {
  step_index: number;
  is_last: boolean;
  variant?: number;
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
  render_two_tier_prices?: boolean;
}

interface SendTextChunkPayload {
  body: string;
}

interface SendPaymentApprovedStepPayload {
  step_index: number;
  is_last: boolean;
  /** De qué secuencia entregar. "approved" (por defecto) = la
   *  payment_approved_sequence existente (producto principal).
   *  Bioferta: "bioferta_b" = entrega del producto B; "bioferta_pack" = pack.
   *  Order bump: "ob_combo" / "ob_basico" = entrega de esa opción. */
  source?:
    | "approved"
    | "bioferta_b"
    | "bioferta_pack"
    | "ob_combo"
    | "ob_basico";
}

interface SendGiftStepPayload {
  step_index: number;
  is_last: boolean;
}

interface StartFollowupPayload {
  /** Indice de la secuencia en config.followup_sequences (0-based). */
  sequence_index: number;
}

interface SendFollowupStepPayload {
  sequence_index: number;
  variant_index?: number;
  step_index: number;
  is_last: boolean;
}

const ACTION_FALLBACK_INTRO: ActionType = "fallback_intro";
const ACTION_SEND_INTRO_STEP: ActionType = "send_intro_step";
const ACTION_SEND_PAYMENT_STEP: ActionType = "send_payment_step";
const ACTION_SEND_TEXT_CHUNK: ActionType = "send_text_chunk";
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
const ACTION_AUTO_SWITCH_HUMAN_AFTER_GIFT_COMMENT: ActionType =
  "auto_switch_human_after_gift_comment";
const ACTION_START_FOLLOWUP: ActionType = "start_followup";
const ACTION_SEND_FOLLOWUP_STEP: ActionType = "send_followup_step";

function chooseFollowupVariant(seq: FollowupSequence): {
  variantIndex: number;
  name: string;
  steps: FollowupSequence["steps"];
} | null {
  const candidates: {
    variantIndex: number;
    name: string;
    steps: FollowupSequence["steps"];
  }[] = [];
  const base = {
    name: seq.name,
    steps: Array.isArray(seq.steps) ? seq.steps : [],
  };
  if (base.steps.length > 0 && !sectionHasPlaceholder(base)) {
    candidates.push({ variantIndex: 0, name: seq.name, steps: base.steps });
  }
  for (const [index, variant] of (seq.variants ?? []).entries()) {
    const steps = Array.isArray(variant.steps) ? variant.steps : [];
    if (
      variant.enabled !== false &&
      steps.length > 0 &&
      !sectionHasPlaceholder({ steps })
    ) {
      candidates.push({
        variantIndex: index + 1,
        name: variant.name || `${seq.name} variante ${index + 2}`,
        steps,
      });
    }
  }
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
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
  if (!fresh.client_email || !fresh.gift_rewarded) return;
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
    `[wf] encuesta post-compra enviada temprano a convo ${conversationId} (email + regalo completados)`
  );
}

/** Comando de reseteo manual desde WhatsApp. */
const RESTART_COMMANDS = ["/restart", "/reset", "/reiniciar"];

const SALESBOT_STATES: WorkflowState[] = [
  "new",
  "awaiting_response",
  "intro_running",
  "intro_done",
  "payment_done",
  "payment_approved",
  "awaiting_email",
  "awaiting_gift_consent",
  "awaiting_facebook_comment",
  "awaiting_bioferta_choice",
  "awaiting_order_bump_choice",
  "awaiting_order_bump_payment_choice",
  "awaiting_doble_oferta_dos_choice",
];

type SalesbotResult = "inactive" | "handled" | "fallback_ai";

function normalizeSalesbotText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getSalesbotModality(config: WorkflowConfig):
  | "lineal"
  | "order_bump"
  | "bioferta"
  | "doble_oferta_dos" {
  if (config.order_bump?.enabled) return "order_bump";
  if (config.bioferta_doble?.enabled) return "bioferta";
  if (config.doble_oferta_dos?.enabled) return "doble_oferta_dos";
  return "lineal";
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
  if (rule?.match === "contains_all") {
    return keywords.every((keyword) => normalized.includes(keyword));
  }
  return keywords.some((keyword) => normalized.includes(keyword));
}

function renderSalesbotResponse(
  text: string,
  convo: ConversationRow
): string {
  return applyWhatsAppNameTemplate(applyProductName(text), convo).trim();
}

async function sendSalesbotSteps(
  convo: ConversationRow,
  steps: ResponseStep[] | undefined
): Promise<boolean> {
  const activeSteps = Array.isArray(steps)
    ? steps.filter((step) => step.enabled !== false)
    : [];
  if (activeSteps.length === 0) return false;
  for (const step of activeSteps) {
    await sendResponseStep(convo, step, undefined, true);
    const delay = (step as { delay_after_sec?: number }).delay_after_sec ?? 0;
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay * 1000));
    }
  }
  return true;
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
  if (response && !actionUsesEngineMessage) {
    await sendBotText(convo, response);
  }

  switch (action) {
    case "send_steps": {
      const sent = await sendSalesbotSteps(convo, rule.steps);
      if (!sent && response) await sendBotText(convo, response);
      break;
    }
    case "show_order_bump":
      await sendOrderBump(convo);
      setConversationState(convo.id, "awaiting_order_bump_choice");
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
      await resendPaymentDetails(convo);
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
  if (getActiveWorkflowChannel() !== convo.channel) {
    return withWorkflowChannel(convo.channel, () =>
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

  const effectiveCountry = getEffectiveCountryCode(convo.phone, config);
  if (!isCountrySalesEnabled(effectiveCountry, config)) {
    await sendBotText(
      convo,
      "Gracias por escribirnos. Por ahora no tenemos venta disponible para tu pais."
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
  if (
    !isPostSaleState &&
    convo.selected_payment_method &&
    detectPaymentRoute(msgContent, convo.phone) === null &&
    /\b(como\s+(pago|pagar|hago|es\s+el\s+pago)|donde\s+(pago|deposito|transfiero)|cual(es)?\s+(es|son|era)\s+(el|los|la|tu|tus|sus)?\s*(numero|datos|cuenta)|(dame|pasa(me)?|envia(me)?|reenvia(me)?|repite(me)?|recuerda(me)?)\b|los\s+datos|el\s+numero|la\s+cuenta|voy\s+a\s+(pagar|yapear|depositar|transferir)|quiero\s+pagar|procedo|paso\s+a\s+pagar)\b/.test(
      msgContent
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{Mn}/gu, "")
    )
  ) {
    const ok = await resendPaymentDetails(convo);
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
  const latestIsImage = getLatestUserMessage(convo.id)?.media_type === "image";
  const wantsPurchasedMaterial =
    /\b(no\s+me\s+(llega|llego|envian|enviaron|mandan|mandaron)|donde\s+esta|a\s+que\s+hora|cuando\s+me\s+(llega|llego|envian|mandan)|me\s+(envian|mandan|reenvian|pasan)|reenviame|reenvia|envia(me)?|manda(me)?|pasame)\b[\s\S]*\b(material|curso|link|enlace|acceso|video|pack|producto)\b/.test(
      normalizedPostSaleText
    ) ||
    /\b(material|curso|link|enlace|acceso|video|pack|producto)\b[\s\S]*\b(no\s+me\s+(llega|llego)|donde\s+esta|reenviame|reenvia|envia(me)?|manda(me)?|pasame)\b/.test(
      normalizedPostSaleText
    ) ||
    /\b(no\s+lo\s+(veo|encuentro|ubico|tengo|recibi|recibo)|no\s+me\s+aparece|no\s+aparece|se\s+(perdio|borro)|lo\s+perdi|pasamelo|pasame(lo)?|mandamelo|manda(me)?lo|envia(me)?lo|reenviar|reenviamelo|reenvialo)\b/.test(
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
  const upgradeIntentRe =
    /\b(completar|completarlo|completar\s+todo|completar\s+el\s+resto|completar\s+la\s+diferencia|resto|diferencia|saldo|llevarme\s+el\s+(completo|combo)|quiero\s+el\s+(completo|combo|otro)|pasarme\s+al\s+(completo|combo)|upgrade|subir\s+al\s+(completo|combo)|el\s+(completo|combo|pack|otro)|el\s+mas\s+(caro|completo))\b/;
  const wantsUpgradeToCombo =
    convo.order_bump_choice === "basico" &&
    upgradeIntentRe.test(normalizedPostSaleText);
  const hasRecentUpgradeIntent =
    wantsUpgradeToCombo ||
    getRecentUserMessages(convo.id, 6).some((message) =>
      upgradeIntentRe.test(
        message.content.toLowerCase().normalize("NFD").replace(/\p{Mn}/gu, "")
      )
    );
  const mayBeDobleOfertaUpgradeReceipt =
    latestIsImage &&
    (isOrderBumpActive() || isDobleOfertaActive()) &&
    convo.order_bump_choice === "basico" &&
    hasRecentUpgradeIntent;

  if (
    isPostSaleState &&
    wantsUpgradeToCombo &&
    (isOrderBumpActive() || isDobleOfertaActive())
  ) {
    const resolution = resolveAccumulatedOrderBumpChoice(convo.id, "combo");
    if (resolution?.approved) return true;
    if (resolution) {
      await sendBotText(
        convo,
        `Si, claro. Puedes completar S/.${resolution.missingSoles} para llevarte el completo. Cuando envies el comprobante del saldo restante, te lo dejo listo.`
      );
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
    // SWITCH skip_ask_name: ENCENDIDO → NO preguntamos el nombre; lanzamos la
    // intro de inmediato sobre el PRIMER mensaje entrante. Default (apagado) =
    // comportamiento actual (saludo + esperar respuesta + fallback). Reversible.
    if (config.greeting?.skip_ask_name === true) {
      console.log(
        `[wf] convo ${convo.id} → skip_ask_name: intro inmediata sin pedir nombre`
      );
      await scheduleIntroSequence(convo.id);
      return true;
    }
    const greetingText =
      pickVariant(config.greeting.text_variants, config.greeting.text) ?? "";
    if (greetingText.trim())
      await sendBotText(convo, applyWhatsAppNameTemplate(greetingText, convo));
    setConversationState(convo.id, "awaiting_response");
    const runAt =
      Math.floor(Date.now() / 1000) + config.no_response_delay_seconds;
    scheduleAction(convo.id, ACTION_FALLBACK_INTRO, {}, runAt);
    console.log(
      `[wf] saludo enviado a convo ${convo.id}, fallback intro en ${config.no_response_delay_seconds}s`
    );
    return true;
  }

  // CASO 2: cliente respondió al saludo → cancelamos timer, capturamos nombre
  // si parece serlo, y disparamos intro inmediatamente.
  if (state === "awaiting_response") {
    const possibleName = extractNameFromMessage(msgContent);
    if (possibleName) {
      setClientName(convo.id, possibleName);
      console.log(
        `[wf] nombre capturado para convo ${convo.id}: "${possibleName}"`
      );
    }
    // Solo cancelamos el fallback_intro — los follow-ups deben preservarse
    // (estos disparan a tiempos absolutos desde T0 independientemente de si
    // el cliente respondió al saludo o no).
    cancelPendingActionsByTypeForConvo(convo.id, ACTION_FALLBACK_INTRO);
    await scheduleIntroSequence(convo.id);
    return true;
  }

  // CASO 3: intro corriendo → no respondemos para no cortar el flujo.
  if (state === "intro_running") {
    console.log(`[wf] convo ${convo.id} en intro_running, IA suprimida`);
    return true;
  }

  const hasEmailLikeText = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(
    msgContent
  );
  if (state === "awaiting_email" && !hasEmailLikeText) {
    if (wantsPurchasedMaterial) {
      await sendBotText(convo, "Claro, te lo reenvio ahora mismo.");
      const ok = resendApprovedMaterial(convo);
      console.log(
        `[wf] convo ${convo.id} -> reenvio deterministico de material en awaiting_email (ok=${ok})`
      );
      return true;
    }
    if (looksLikePaymentEcho) {
      if (mayBeDobleOfertaUpgradeReceipt) return false;
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
    if (/\b(correo|e-?mail|gmail|hotmail|outlook)\b/i.test(msgContent)) {
      await sendBotText(
        convo,
        "¡Claro! 😊 Escríbeme tu correo y te envío el material ahí también 📧"
      );
      return true;
    }
    // Sin email -> Salesbot si esta activo; si no, LLM responde.
    return trySalesbotOrLlm(convo, msgContent, config);
  }

  // Si está en payment_approved pero todavía NO tiene email guardado,
  // seguimos buscando en cada mensaje hasta capturarlo.
  if (state === "payment_approved" && !convo.client_email) {
    if (await tryCaptureEmail(convo, msgContent)) {
      await maybeSendCustomerSurveyNow(convo.id);
      return true;
    }
  }
  if (state === "payment_approved") {
    if (wantsUpgradeToCombo && (isOrderBumpActive() || isDobleOfertaActive())) {
      const resolution = resolveAccumulatedOrderBumpChoice(convo.id, "combo");
      if (resolution && !resolution.approved) {
        await sendBotText(
          convo,
          `Sí, claro. Puedes completar S/.${resolution.missingSoles} para llevarte el completo. Cuando envíes el comprobante del saldo restante, te lo dejo listo.`
        );
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
      if (mayBeDobleOfertaUpgradeReceipt) return false;
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
    if (mayBeDobleOfertaUpgradeReceipt) return false;
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
      // RE-OFRECIMIENTO del regalo (switch post_sale_reoffer). Si está apagado,
      // NO re-ofrecemos el regalo aunque el cliente aún no lo haya aceptado.
      if (!convo.gift_reminder_sent && config?.post_sale_reoffer !== false) {
        const between =
          config?.between_messages_delay_seconds ??
          DEFAULT_BETWEEN_MESSAGES_DELAY;
        scheduleGiftConsentReminder(convo.id, between);
      }
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
      if (mayBeDobleOfertaUpgradeReceipt) return false;
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
    if (mayBeDobleOfertaUpgradeReceipt) return false;
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
      if (mayBeDobleOfertaUpgradeReceipt) return false;
      await sendBotText(
        convo,
        "Tu pago ya esta confirmado, tu material ya fue enviado."
      );
      return true;
    }
    // Ni COMENTADO ni email → LLM responde guiando al cliente. El system
    // prompt tiene reglas específicas para no inventar links de regalo.
  }

  // CASO ORDER BUMP: ya se mostró la oferta intermedia (combo/básico) y
  // esperamos que el cliente elija (escribiendo el nombre o tocando un botón).
  if (state === "awaiting_order_bump_payment_choice") {
    // Otro comprobante se registra antes de volver a pedir confirmacion.
    if (getLatestUserMessage(convo.id)?.media_type === "image") return false;
    const choice = inferTwoTierChoiceFromContext(
      msgContent,
      convo.order_bump_choice,
      config
    );
    // Cualquier respuesta natural se interpreta con criterio mediante la tool
    // seleccionar_opcion; el motor solo acelera botones/nombres exactos.
    if (!choice) return trySalesbotOrLlm(convo, msgContent, config);

    const resolution = resolveAccumulatedOrderBumpChoice(convo.id, choice);
    if (!resolution) return trySalesbotOrLlm(convo, msgContent, config);
    if (resolution.approved) return true;

    const optionName =
      getActiveTwoTierOffer(config)?.[choice]?.name?.trim() ||
      "la opcion elegida";
    await sendBotText(
      convo,
      `Perfecto, tomo tu eleccion de ${optionName}. Ya abonaste S/.${resolution.paidTotalSoles} y falta completar S/.${resolution.missingSoles}.`
    );
    return true;
  }

  if (state === "awaiting_order_bump_choice") {
    const obChoice = detectTwoTierPick(msgContent, config);
    if (obChoice) {
      console.log(`[wf] convo ${convo.id} eligió order bump "${obChoice}"`);
      const recentReceiptImage = getRecentUserMessages(convo.id, 5).find(
        (message) =>
          message.media_type === "image" &&
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
      await deliverOrderBumpResponse(convo, obChoice);
      return true;
    }
    if (
      await maybeSendDirectPaymentWithoutChoice(
        convo,
        msgContent,
        config,
        "order bump"
      )
    ) {
      return true;
    }
    // Preguntas, comparaciones, palabras sueltas y elecciones naturales pasan
    // al modelo. La tool registra la opcion solo cuando el modelo ve decisión.
    return trySalesbotOrLlm(convo, msgContent, config);
  }

  // DOBLE OFERTA 2 PRODUCTOS: terminó la intro y se mostró la elección al final.
  // Si el cliente elige una opción (nombre o botón), enviamos directo los datos
  // de pago personalizados de ESA opción. Elección ambigua/pregunta → LLM.
  if (state === "awaiting_doble_oferta_dos_choice") {
    const choice = detectTwoTierPick(msgContent, config);
    if (choice) {
      console.log(`[wf] convo ${convo.id} eligió doble oferta "${choice}"`);
      await deliverDobleOfertaPaymentDetails(convo, choice);
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

  // CASO BIOFERTA: el cliente pagó el precio UNITARIO pero aún no había
  // elegido cuál de los 2 productos quiere. Esperamos que escriba el NOMBRE.
  if (state === "awaiting_bioferta_choice") {
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
      if (convo.order_bump_choice) setOrderBumpChoice(convo.id, null);
      cancelPendingActionsByTypeForConvo(convo.id, ACTION_SEND_PAYMENT_STEP);
      await sendOrderBump(convo);
      setConversationState(convo.id, "awaiting_order_bump_choice");
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
      config?.order_bump?.offer_on_reengaged_price !== false &&
      !messageHasPaymentConcern(msgContent) &&
      asksPriceStrict(msgContent)
    ) {
      cancelPendingActionsByTypeForConvo(convo.id, ACTION_SEND_PAYMENT_STEP);
      await sendOrderBump(convo);
      setConversationState(convo.id, "awaiting_order_bump_choice");
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
        config
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
            await sendBotText(
              convo,
              `Perfecto, tomo tu eleccion de ${optionName}. Ya abonaste S/.${resolution.paidTotalSoles} y falta completar S/.${resolution.missingSoles}.`
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

    const route = detectPaymentRoute(msgContent, convo.phone);
    // GUARDA "no soy un soldado sordo": si el cliente menciona un método de
    // pago PERO en contexto de desconfianza/queja/objeción (ej. "me robaron
    // con el yape, no confío en pagar primero"), NO disparamos la respuesta
    // automática. Dejamos que la IA escuche y responda con empatía.
    if (route && !messageHasPaymentConcern(msgContent)) {
      const normalizedMethod = msgContent
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{Mn}/gu, "");
      const selectedPaymentMethod =
        route === "yape" && /\bpl(?:in|im|iin)\b/.test(normalizedMethod)
          ? "plin"
          : route;
      // ORDER BUMP: una selección de método hecha desde el menú INICIAL
      // (`intro_done`) abre la oferta intermedia. Una vez elegida una opción,
      // `deliverOrderBumpResponse` deja la conversación en `payment_done`; el
      // siguiente método de pago debe continuar hacia `payment_responses`, no
      // volver a ejecutar la respuesta de la opción (esa respuesta precisamente
      // vuelve a pedir el método y produciría un bucle).
      let orderBumpChoiceForPayment: "combo" | "basico" | undefined;
      let selectedPriceForPayment: number | undefined;
      if (isOrderBumpActive()) {
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
          await sendOrderBump(convo);
          setConversationState(convo.id, "awaiting_order_bump_choice");
          return true;
        }
        console.log(
          `[wf] convo ${convo.id} → order bump "${chosen}" confirmado, continúo con pago "${route}"`
        );
        orderBumpChoiceForPayment = chosen;
        selectedPriceForPayment =
          getOrderBumpPriceSoles(
            chosen,
            isDiscountActiveForConversation(convo, config)
          ) ?? undefined;
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
          console.log(
            `[wf] convo ${convo.id} → doble oferta "${chosenBioferta}", continúo con pago "${route}"`
          );
        }
      }
      const canUseDirectPaymentForRoute =
        shouldUseDirectPayment(config) && (route === "yape" || route === "plin");
      const linealDirectPayment =
        canUseDirectPaymentForRoute &&
        !isOrderBumpActive() &&
        !isBiofertaActive() &&
        !isDobleOfertaActive();
      const chosenOptionDirectPayment =
        canUseDirectPaymentForRoute && !!orderBumpChoiceForPayment;
      if (linealDirectPayment || chosenOptionDirectPayment) {
        const directSteps = getDirectPaymentSteps(config);
        const directPrice =
          selectedPriceForPayment ??
          getEffectivePriceSoles(
            isDiscountActiveForConversation(convo, config),
            convo.phone
          );
        console.log(
          `[wf] convo ${convo.id} eligio pago "${route}", usando pago directo editable`
        );
        cancelPendingActionsByTypeForConvo(convo.id, ACTION_SEND_PAYMENT_STEP);
        setSelectedPaymentMethod(convo.id, selectedPaymentMethod);
        reportInitiateCheckout(convo, selectedPaymentMethod, directPrice);
        await schedulePaymentResponses(convo, "yape", directSteps, {
          orderBumpChoice: orderBumpChoiceForPayment,
          priceSoles: directPrice,
          directPayment: true,
        });
        setConversationState(convo.id, "payment_done");
        return true;
      }
      const responses = getPaymentResponses(
        config,
        route,
        orderBumpChoiceForPayment,
        convo.phone
      );
      console.log(
        `[wf] convo ${convo.id} eligió pago "${route}", programando ${responses.length} respuestas`
      );
      // Cancela acciones de un pago previo (yape antes de que terminen sus
      // 3 mensajes y ahora dicen "bcp"). Solo el tipo payment_step — los
      // follow-ups deben seguir vivos hasta que se apruebe la compra.
      cancelPendingActionsByTypeForConvo(convo.id, ACTION_SEND_PAYMENT_STEP);
      setSelectedPaymentMethod(convo.id, selectedPaymentMethod);
      reportInitiateCheckout(convo, selectedPaymentMethod, selectedPriceForPayment);
      await schedulePaymentResponses(convo, route, responses, {
        orderBumpChoice: orderBumpChoiceForPayment,
        priceSoles: selectedPriceForPayment,
      });
      setConversationState(convo.id, "payment_done");
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
  deleteAllMessages(convo.id);
  clearClientName(convo.id);
  clearClientEmail(convo.id);
  resetPaidTotal(convo.id);
  resetPaymentAttemptsFailed(convo.id);
  deactivateDiscount(convo.id);
  // Una conversación reiniciada debe volver a elegir sus productos. Si estas
  // selecciones quedan guardadas, el primer método de pago del flujo nuevo
  // reutiliza la opción anterior y omite la oferta del order bump.
  setBiofertaChoice(convo.id, null);
  setOrderBumpChoice(convo.id, null);
  setSelectedPaymentMethod(convo.id, null);
  setGiftReminderSent(convo.id, false);
  setGiftRewarded(convo.id, false);
  setEmailReminderSent(convo.id, false);
  setCustomerSurveySent(convo.id, false);
  clearNocodbSync(convo.id);
  resetFollowupTracking(convo.id);
  setConversationState(convo.id, "new");
  console.log(`[wf] /restart aplicado a convo ${convo.id}`);
  try {
    await sendBotText(convo, "🔄 Memoria reseteada. Empezamos de cero.");
  } catch (err) {
    console.error("[wf] error mandando confirmación de reset:", err);
  }
  // Tras enviar la confirmación borramos también ese mensaje de BD para
  // que el contador quede en 0 y el siguiente mensaje del cliente se vea
  // como verdaderamente "el primero".
  deleteAllMessages(convo.id);
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
function scheduleFollowupSequences(convoId: number): void {
  const config = loadWorkflowConfig();
  // Toggle global de seguimientos: si está en false, no se agenda ninguno.
  if (config?.followups_enabled === false) return;
  const sequences = config?.followup_sequences;
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
  const useLayerDelays = config?.__channel_content_active === true;
  // Guardia 24h (API oficial de WhatsApp): no se puede enviar texto libre
  // pasadas 24h del ultimo mensaje del cliente. Si un seguimiento caeria
  // fuera, se descarta (y los siguientes tambien).
  const limit24h = now + 24 * 3600;

  // runAt del seguimiento anterior — sirve para calcular el slot del
  // siguiente respetando min_gap_hours_between (regla anti-solapamiento).
  let lastRunAt = 0;

  for (let i = 0; i < sequences.length; i++) {
    const seq = sequences[i];
    if (seq.enabled === false) {
      console.log(
        `[wf] convo ${convoId}: ${seq.name} está apagado (enabled:false), no se programa`
      );
      continue;
    }
    let runAt: number | null = null;

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
        const target = now + Math.floor(delayMin * 60);
        const ignoreQuiet = sched?.followup_1_ignore_quiet_hours === true && i === 0;
        const base =
          quietHoursEnabled && !ignoreQuiet && isQuietHour(target)
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
        quietHoursEnabled,
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
      if (quietHoursEnabled && isQuietHour(runAt)) {
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

    const payload: StartFollowupPayload = { sequence_index: i };
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
    !shouldUseDirectPayment(config, "without_choice")
  ) {
    return false;
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

/**
 * Estados en los que NO tiene sentido programar nuevos seguimientos
 * (el cliente ya compro, el flujo esta en proceso, o aun no llegamos al
 * primer seguimiento). Resto de estados (intro_done, payment_done,
 * awaiting_response post-seg1) son candidatos validos.
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
  const sequences = config?.followup_sequences ?? [];
  const nextIndex = currentIndex + 1;
  if (nextIndex >= sequences.length) return; // ya estamos en el ultimo
  const nextSeq = sequences[nextIndex];
  if (!nextSeq) return;
  if (!chooseFollowupVariant(nextSeq)) {
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
  const quietHoursEnabled = sched?.quiet_hours_enabled !== false;
  const burstDelays =
    sched?.burst_delays_seconds && sched.burst_delays_seconds.length > 0
      ? sched.burst_delays_seconds
      : DEFAULT_BURST_DELAYS;

  const convo = getConversationById(convoId);
  if (!convo) return;
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

/**
 * Programa todas las acciones del intro con sus delays acumulados.
 */
async function scheduleIntroSequence(convoId: number): Promise<void> {
  const config = loadWorkflowConfig();
  if (!config) return;
  const convo = getConversationById(convoId);
  setConversationState(convoId, "intro_running");
  const now = Math.floor(Date.now() / 1000);
  let cumulativeDelay = 0;

  // Reparto al azar entre las intros ACTIVAS y completas.
  // Si ninguna está activa/completa, usa la Intro 1 como respaldo seguro.
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
  const pool: {
    steps: typeof config.intro_sequence;
    variant: number;
    weight: number;
  }[] = [];
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
  let chosen: (typeof pool)[number] | { steps: typeof config.intro_sequence; variant: number };
  const adSourceId = convo?.ad_source_id?.trim();
  const adMatchIndex =
    adSourceId && Array.isArray(config.intro_ad_ids)
      ? config.intro_ad_ids.findIndex((raw) =>
          String(raw)
            .split(/[\s,;]+/)
            .map((id) => id.trim())
            .filter(Boolean)
            .includes(adSourceId)
        )
      : -1;
  const adMatched = pool.find((item) => item.variant === adMatchIndex + 1);
  if (adMatched) {
    chosen = adMatched;
  } else if (pool.length > 0) {
    const totalWeight = pool.reduce((sum, item) => sum + item.weight, 0);
    let ticket = Math.random() * totalWeight;
    chosen = pool[0];
    for (const item of pool) {
      ticket -= item.weight;
      if (ticket <= 0) {
        chosen = item;
        break;
      }
    }
  } else {
    chosen = { steps: config.intro_sequence, variant: 1 };
  }
  const steps = chosen.steps;
  const variant = chosen.variant;
  setIntroVariantSent(convoId, variant);

  for (let i = 0; i < steps.length; i++) {
    const isLast = i === steps.length - 1;
    const payload: Record<string, unknown> = {
      step_index: i,
      is_last: isLast,
      variant,
    };
    scheduleAction(
      convoId,
      ACTION_SEND_INTRO_STEP,
      payload,
      now + cumulativeDelay
    );
    cumulativeDelay += steps[i].delay_after_sec;
  }
  console.log(
    `[wf] intro programado para convo ${convoId} (${steps.length} pasos, intro ${variant})`
  );
}

/**
 * Ejecuta una acción programada que ya venció.
 */
export async function executeAction(action: ScheduledActionRow): Promise<void> {
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

  if (getActiveWorkflowChannel() !== convo.channel) {
    return withWorkflowChannel(convo.channel, () => executeAction(action));
  }

  if (action.action_type === ACTION_FALLBACK_INTRO) {
    if (convo.state !== "awaiting_response") {
      console.log(
        `[wf] fallback_intro acción ${action.id}: state ya es ${convo.state}, saltando`
      );
      return;
    }
    console.log(`[wf] fallback intro disparado para convo ${convo.id}`);
    await scheduleIntroSequence(convo.id);
    return;
  }

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
    if (!step) {
      console.warn(
        `[wf] acción ${action.id}: step_index ${payload.step_index} fuera de rango`
      );
      return;
    }
    console.log(
      `[wf] enviando intro step ${payload.step_index} (${step.type}) a convo ${convo.id}`
    );
    const introPrice = getEffectivePriceSoles(
      isDiscountActiveForConversation(convo, config),
      convo.phone
    );
    // Si la burbuja está APAGADA (enabled === false), no la enviamos — pero el
    // is_last sigue su curso (intro_done + menú de pago del intro).
    if (step.enabled !== false) {
      const introVariantSeed =
        config.intro_variant_rotation_enabled !== false
          ? convo.id * 1000 + (payload.variant ?? 1) * 100 + payload.step_index
          : undefined;
      if (step.type === "text") {
        const introText =
          pickVariant(step.body_variants, step.body, introVariantSeed) ?? "";
        if (introText.trim())
          await sendBotText(
            convo,
            applyPriceTemplate(introText, introPrice, convo)
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
            ? applyPriceTemplate(introCaption, introPrice, convo)
            : introCaption
        );
      }
    }
    if (payload.is_last) {
      // Modalidad Doble Oferta 2 Productos: al terminar la intro, en vez del
      // menú de pago normal, soltamos la elección (básico/combo) — SIN 2ª intro
      // ni pedir nombre — y esperamos que elija para ir directo al pago.
      if (isDobleOfertaActive()) {
        setConversationState(convo.id, "awaiting_doble_oferta_dos_choice");
        try {
          await sendDobleOfertaChoice(convo);
        } catch (err) {
          console.error("[wf] error enviando elección de doble oferta:", err);
        }
        console.log(
          `[wf] intro completado (doble oferta) para convo ${convo.id}`
        );
        return;
      }
      setConversationState(convo.id, "intro_done");
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
    await sendBotText(convo, gift.consent_question);
    await sendGiftConsentButtonsIfEnabled(convo, gift);
    setConversationState(convo.id, "awaiting_gift_consent");
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
      await sendGiftConsentButtonsIfEnabled(convo, gift);
      setConversationState(convo.id, "awaiting_gift_consent");
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
        ? pickGiftTextByAd(gift.ask_text_variants, convo.ad_source_id) ??
          pickWeightedGiftText(gift.ask_text_variants) ??
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
      pickGiftTextByAd(gift.ask_text_variants, convo.ad_source_id) ??
      pickWeightedGiftText(gift.ask_text_variants) ??
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
    const reminder = getConfiguredEmailReminder(convo);
    if (!reminder) return;
    await sendBotText(convo, reminder);
    setEmailReminderSent(convo.id, true);
    console.log(`[wf] recordatorio unico de correo enviado a convo ${convo.id}`);
    return;
  }

  if (action.action_type === ACTION_SEND_CUSTOMER_SURVEY) {
    if (convo.customer_survey_sent) return;
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

  if (action.action_type === ACTION_SEND_TEXT_CHUNK) {
    const payload = JSON.parse(action.payload) as SendTextChunkPayload;
    if (!payload.body || !payload.body.trim()) return;
    console.log(
      `[wf] enviando text chunk a convo ${convo.id}`
    );
    await sendBotText(convo, payload.body);
    return;
  }

  if (action.action_type === ACTION_SEND_PAYMENT_APPROVED_STEP) {
    const payload = JSON.parse(action.payload) as SendPaymentApprovedStepPayload;
    const config = loadWorkflowConfig();
    // La entrega puede venir de la secuencia del producto B o del pack
    // (Bioferta Oferta Doble); por defecto, la payment_approved_sequence.
    const sequence =
      payload.source === "bioferta_b"
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
      if (payload.is_last) {
        scheduleCustomerSurveyFallback(convo.id);
        setConversationState(convo.id, "awaiting_email");
        if (!convo.gift_rewarded) {
          const cfg = loadWorkflowConfig();
          const timeoutSec =
            cfg?.awaiting_email_timeout_seconds ??
            DEFAULT_AWAITING_EMAIL_TIMEOUT;
          scheduleGiftConsentWithDelay(convo.id, timeoutSec);
        }
      }
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
      payload.source === "ob_combo"
        ? getOrderBumpPriceSoles(
            "combo",
            isDiscountActiveForConversation(convo, config)
          )
        : payload.source === "ob_basico"
          ? getOrderBumpPriceSoles(
              "basico",
              isDiscountActiveForConversation(convo, config)
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
      let out = applyPriceTemplate(
        t,
        deliveryPrice ??
        getEffectivePriceSoles(
          isDiscountActiveForConversation(convo, config),
          convo.phone
        )
      );
      if (isObDelivery)
        out = renderOrderBumpTemplate(
          out,
          isDiscountActiveForConversation(convo, config)
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
    if (payload.is_last) {
      // Tras el último paso (pedido de email), pasamos a awaiting_email
      // y programamos directamente el gift al cumplirse el timeout.
      // Si el cliente da su email mientras tanto, se captura igual y se
      // manda el SMTP, pero el gift sigue al horario programado.
      scheduleCustomerSurveyFallback(convo.id);
      setConversationState(convo.id, "awaiting_email");
      if (convo.gift_rewarded) {
        console.log(
          `[wf] payment_approved sequence completada, convo ${convo.id} -> awaiting_email, gift ya completado; no reprogramo consent`
        );
      } else {
        const cfg = loadWorkflowConfig();
        const timeoutSec =
          cfg?.awaiting_email_timeout_seconds ?? DEFAULT_AWAITING_EMAIL_TIMEOUT;
        scheduleGiftConsentWithDelay(convo.id, timeoutSec);
        console.log(
          `[wf] payment_approved sequence completada, convo ${convo.id} -> awaiting_email, gift programado en ${timeoutSec}s`
        );
      }
    }
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
    const quietHoursEnabled =
      loadWorkflowConfig()?.followup_schedule?.quiet_hours_enabled !== false;
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
    const sequences = config?.followup_sequences;
    const seq = sequences?.[payload.sequence_index];
    if (!seq) {
      console.warn(
        `[wf:seguimiento] convo ${convo.id} accion ${action.id}: secuencia ${payload.sequence_index} no existe en config`
      );
      return;
    }
    const chosenFollowup = chooseFollowupVariant(seq);
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
      console.log(
        `[wf:descuento] convo ${convo.id} entra en etapa de oferta — precio ahora S/.${discountCfg.price_soles}`
      );
    }
    const now = Math.floor(Date.now() / 1000);
    let cumulativeDelay = 0;
    for (let i = 0; i < chosenFollowup.steps.length; i++) {
      const isLast = i === chosenFollowup.steps.length - 1;
      const stepPayload: SendFollowupStepPayload = {
        sequence_index: payload.sequence_index,
        variant_index: chosenFollowup.variantIndex,
        step_index: i,
        is_last: isLast,
      };
      scheduleAction(
        convo.id,
        ACTION_SEND_FOLLOWUP_STEP,
        stepPayload as unknown as Record<string, unknown>,
        now + cumulativeDelay
      );
      cumulativeDelay += chosenFollowup.steps[i].delay_after_sec ?? 0;
    }
    // Marcar este momento como milestone: el proximo seguimiento solo
    // disparara si el cliente respondio DESPUES de este timestamp.
    // Tambien actualizamos last_followup_index para que cuando llegue un
    // mensaje del cliente sepamos cual seguimiento toca agendar (N+1).
    setLastFollowupStartedAt(convo.id, now);
    setLastFollowupIndex(convo.id, payload.sequence_index);
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
    const seq = config?.followup_sequences?.[payload.sequence_index];
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
    const fwPrice = getEffectivePriceSoles(
      isDiscountActiveForConversation(convo, config),
      convo.phone
    );
    // Si la burbuja está APAGADA (enabled === false), no la enviamos — pero el
    // is_last sigue su curso (markFollowupSent + menú de pago del seguimiento).
    if (step.enabled !== false) {
      if (step.type === "text") {
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
          await sendDobleOfertaChoice(convo);
          setConversationState(convo.id, "awaiting_doble_oferta_dos_choice");
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
    const steps = payload.direct_payment
      ? getDirectPaymentSteps(config, payload.direct_payment_mode)
      : getPaymentResponses(
          config,
          payload.route,
          payload.order_bump_choice,
          convo.phone
        );
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
  fullText: string
): Promise<void> {
  let chunks = fullText
    .split(/\n\s*\n/)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);

  if (chunks.length === 0) return;

  const config = loadWorkflowConfig();
  if (config?.llm_bubble_limit_enabled === true) {
    const maxBubbles = Math.max(1, Math.floor(config.llm_max_bubbles ?? 3));
    if (chunks.length > maxBubbles) {
      chunks = chunks.slice(0, maxBubbles);
    }
  }

  // Primer chunk: inmediato.
  await sendBotText(convo, chunks[0]);
  if (chunks.length === 1) return;

  const delay =
    config?.between_messages_delay_seconds ?? DEFAULT_BETWEEN_MESSAGES_DELAY;
  const now = Math.floor(Date.now() / 1000);

  for (let i = 1; i < chunks.length; i++) {
    const payload: Record<string, unknown> = { body: chunks[i] };
    scheduleAction(
      convo.id,
      ACTION_SEND_TEXT_CHUNK,
      payload,
      now + delay * i
    );
  }
  console.log(
    `[wf] respuesta LLM partida en ${chunks.length} chunks para convo ${convo.id} (delay ${delay}s)`
  );
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
    .replace(/\{\{\s*NOMBRE_WHATSAPP\s*\}\}/gi, name)
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
  ).symbol;
  return applyWhatsAppNameTemplate(applyProductName(text), convo)
    .replace(/\{\{?\s*(moneda|simbolo|símbolo)\s*\}?\}/gi, moneda)
    .replace(/\{price\}/gi, priceStr)
    .replace(/\{precio\}/gi, priceStr);
}

/**
 * Envía un único paso de respuesta (texto o media). Helper compartido
 * entre la respuesta inmediata y los pasos programados.
 */
async function sendResponseStep(
  convo: ConversationRow,
  step: ResponseStep,
  priceOverride?: number,
  renderOrderBumpComodines = false
): Promise<void> {
  const config = loadWorkflowConfig();
  // priceOverride: precio para el comodín {price} (ej. el de la opción del
  // order bump). Si no se pasa, usa el precio efectivo del curso.
  // renderOrderBumpComodines: además de {price}, resuelve {{precio_1}},
  // {{precio_2}} y {{precio_extra}} (combo/básico/adicional) — se usa en el
  // intro del order bump para que los 3 precios sigan la etapa de oferta.
  const price =
    priceOverride ??
    getEffectivePriceSoles(
      isDiscountActiveForConversation(convo, config),
      convo.phone
    );
  const render = (t: string): string => {
    const withTwoTier = renderOrderBumpComodines
      ? renderOrderBumpTemplate(
          t,
          isDiscountActiveForConversation(convo, config)
        )
      : t;
    return applyPriceTemplate(withTwoTier, price, convo);
  };
  if (step.type === "text") {
    const bodyText = pickVariant(step.body_variants, step.body) ?? "";
    if (bodyText.trim()) {
      await sendBotText(convo, render(bodyText));
    }
  } else {
    const captionRaw =
      step.type !== "audio"
        ? pickVariant(
            (step as { caption_variants?: string[] }).caption_variants,
            (step as { caption?: string }).caption
          )
        : undefined;
    const caption = captionRaw ? render(captionRaw) : undefined;
    await sendBotMediaFromDrive(
      convo,
      step.type,
      step.drive_url,
      caption
    );
  }
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
    const activeOffer = getActiveTwoTierOffer(config);
    const custom = byRoute(activeOffer?.[orderBumpChoice]?.payment_responses);
    if (Array.isArray(custom) && custom.length > 0) steps = custom;
  }

  if (!steps) {
    const country = getEffectiveCountryCode(phone, config);
    const countryResponses =
      config.payment_profiles_by_country?.[country]?.payment_responses;
    steps =
      byRoute(countryResponses) ??
      byRoute(config.payment_responses) ??
      config.payment_responses.bcp_transferencia ??
      config.payment_responses.yape ??
      [];
  }

  return steps.filter((step) => step.enabled !== false);
}

function getDirectPaymentSteps(
  config: WorkflowConfig,
  mode: "with_choice" | "without_choice" = "with_choice"
): ResponseStep[] {
  const rawSteps =
    mode === "without_choice"
      ? config.direct_payment_without_choice_steps
      : config.direct_payment_steps;
  const rawCta =
    mode === "without_choice"
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
  mode: "with_choice" | "without_choice" = "with_choice"
): boolean {
  return (
    config?.direct_payment_enabled === true &&
    getDirectPaymentSteps(config, mode).length > 0
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
  convo: ConversationRow
): Promise<boolean> {
  const config = loadWorkflowConfig();
  if (!config) return false;
  const method = convo.selected_payment_method;
  if (!method) return false;
  // Usa el método elegido TAL CUAL (dinámico o clásico). Único alias clásico:
  // "plin" comparte la respuesta de "yape".
  const route: string = method === "plin" ? "yape" : method;
  const orderBumpChoice =
    convo.order_bump_choice === "combo" || convo.order_bump_choice === "basico"
      ? convo.order_bump_choice
      : undefined;
  if (shouldUseDirectPayment(config) && (route === "yape" || route === "plin")) {
    const directSteps = getDirectPaymentSteps(config);
    const priceSoles = orderBumpChoice
      ? getOrderBumpPriceSoles(
          orderBumpChoice,
          isDiscountActiveForConversation(convo, config)
        ) ??
        undefined
      : undefined;
    cancelPendingActionsByTypeForConvo(convo.id, ACTION_SEND_PAYMENT_STEP);
    await schedulePaymentResponses(convo, "yape", directSteps, {
      orderBumpChoice,
      priceSoles,
      directPayment: true,
    });
    return true;
  }
  const steps = getPaymentResponses(config, route, orderBumpChoice, convo.phone);
  if (!steps || steps.length === 0) return false;
  const priceSoles = orderBumpChoice
    ? getOrderBumpPriceSoles(
        orderBumpChoice,
        isDiscountActiveForConversation(convo, config)
      ) ??
      undefined
    : undefined;
  cancelPendingActionsByTypeForConvo(convo.id, ACTION_SEND_PAYMENT_STEP);
  await schedulePaymentResponses(convo, route, steps, {
    orderBumpChoice,
    priceSoles,
  });
  return true;
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
  }
}

/**
 * ORDER BUMP — envía la oferta intermedia: el intro (imagen + texto con las 2
 * opciones) y luego el prompt de elección (botones si use_buttons, o texto).
 */
async function sendOrderBump(convo: ConversationRow): Promise<void> {
  const config = loadWorkflowConfig();
  const ob = config?.order_bump;
  if (!ob) return;
  if (Array.isArray(ob.intro)) {
    for (const step of ob.intro) {
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
      pickVariant(ob.choice_prompt_variants, ob.choice_prompt) ??
        "Elige tu opción 👇",
      isDiscountActiveForConversation(convo, config)
    );
  if (ob.use_buttons) {
    const comboName = ob.combo?.name?.trim() || "Combo";
    const basicoName = ob.basico?.name?.trim() || "Básico";
    await sendBotButtons(convo, prompt, [
      { id: "ob_combo", title: comboName },
      { id: "ob_basico", title: basicoName },
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
  const dd = config?.doble_oferta_dos;
  if (!dd) return;
  const prompt = renderOrderBumpTemplate(
    pickVariant(dd.choice_prompt_variants, dd.choice_prompt) ??
      "Elige tu opción 👇",
    isDiscountActiveForConversation(convo, config)
  );
  if (dd.use_buttons) {
    const comboName = dd.combo?.name?.trim() || "Combo";
    const basicoName = dd.basico?.name?.trim() || "Básico";
    const comboBtn = { id: "ob_combo", title: comboName };
    const basicoBtn = { id: "ob_basico", title: basicoName };
    // Orden configurable: por defecto combo arriba/básico abajo; con basico_first
    // se invierte (básico arriba, combo abajo).
    const buttons = dd.basico_first
      ? [basicoBtn, comboBtn]
      : [comboBtn, basicoBtn];
    if (dd.separate_bubble) {
      if (prompt.trim()) await sendBotText(convo, prompt);
      await sendBotButtons(
        convo,
        dd.choice_buttons_prompt?.trim() || "¿Qué opción prefieres?",
        buttons
      );
    } else {
      await sendBotButtons(convo, prompt, buttons);
    }
  } else {
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
 * ORDER BUMP — el cliente eligió una opción: guardamos la elección y enviamos
 * su respuesta predefinida (método + precio). Pasa a payment_done; la entrega
 * la dispara el pago aprobado (payment.ts) según la opción.
 */
async function deliverOrderBumpResponse(
  convo: ConversationRow,
  choice: "combo" | "basico"
): Promise<void> {
  const config = loadWorkflowConfig();
  // Opción de la modalidad ACTIVA (order bump o doble oferta 2 productos).
  const ob = getActiveTwoTierOffer(config);
  const option = choice === "combo" ? ob?.combo : ob?.basico;
  setOrderBumpChoice(convo.id, choice);
  cancelPendingActionsByTypeForConvo(convo.id, ACTION_SEND_PAYMENT_STEP);
  // Precio de ESTA opción para el comodín {price}: promo si la convo entró en
  // etapa de oferta y hay precio promo; si no, el normal de la opción.
  const optPrice =
    getOrderBumpPriceSoles(
      choice,
      isDiscountActiveForConversation(convo, config)
    ) ?? 0;
  if (config && shouldUseDirectPayment(config)) {
    const directSteps = getDirectPaymentSteps(config);
    setSelectedPaymentMethod(convo.id, "yape");
    reportInitiateCheckout(convo, "yape", optPrice);
    await schedulePaymentResponses(convo, "yape", directSteps, {
      orderBumpChoice: choice,
      priceSoles: optPrice,
      directPayment: true,
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
    const responses = getPaymentResponses(
      config,
      route,
      choice,
      convo.phone
    );
    reportInitiateCheckout(convo, convo.selected_payment_method, optPrice);
    await schedulePaymentResponses(convo, route, responses, {
      orderBumpChoice: choice,
      priceSoles: optPrice,
    });
    setConversationState(convo.id, "payment_done");
    console.log(
      `[wf] convo ${convo.id} cambió a "${choice}"; reutilizo pago "${convo.selected_payment_method}" con monto actualizado`
    );
    return;
  }

  if (Array.isArray(option?.response)) {
    for (const step of option.response) {
      // Respeta el toggle ON/OFF: una burbuja apagada NO se envía.
      if ((step as { enabled?: boolean }).enabled === false) continue;
      // true → además de {price} (precio de ESTA opción), resuelve
      // {{precio_1}}/{{precio_2}}/{{precio_extra}} por si la respuesta los usa.
      await sendResponseStep(convo, step, optPrice, true);
      // Respeta el delay configurado entre burbujas (no las manda de corrido).
      const d = (step as { delay_after_sec?: number }).delay_after_sec ?? 0;
      if (d > 0) await new Promise((res) => setTimeout(res, d * 1000));
    }
  }
  setConversationState(convo.id, "payment_done");
}

/** Acepta el regalo extra: cancela el consent zombie y programa el audio+texto.
 *  Fuente única, usada por el detector determinístico y por el handler cuando el
 *  LLM confirma con <<REGALO_SI>>. */
export function acceptGiftConsent(convo: ConversationRow): void {
  cancelPendingActionsByTypeForConvo(convo.id, ACTION_SEND_GIFT_CONSENT);
  cancelPendingActionsByTypeForConvo(convo.id, ACTION_SEND_GIFT_CONSENT_STEP);
  scheduleGiftAudioAndText(convo.id);
  console.log(
    `[wf] convo ${convo.id} aceptó regalo extra → programo audio+texto`
  );
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
  await maybeSendCustomerSurveyNow(convo.id);
  // NUEVA petición de correo tras el regalo (switch post_sale_reoffer). Si está
  // apagado, no volvemos a pedir el correo — se pidió una sola vez al inicio.
  if (cfg?.post_sale_reoffer !== false) scheduleEmailReminderAfterGift(convo);
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
  await sendBotText(
    convo,
    `Sí, claro. Puedes completar S/.${resolution.missingSoles} para llevarte el completo. Cuando envíes el comprobante del saldo restante, te lo dejo listo.`
  );
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
      isDiscountActiveForConversation(convo, config)
    ) ?? undefined;
  if (shouldUseDirectPayment(config)) {
    const directSteps = getDirectPaymentSteps(config);
    setSelectedPaymentMethod(convo.id, "yape");
    reportInitiateCheckout(convo, "yape", priceSoles);
    await schedulePaymentResponses(convo, "yape", directSteps, {
      orderBumpChoice: choice,
      priceSoles,
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
  reportInitiateCheckout(convo, selectedPaymentMethod, priceSoles);
  await schedulePaymentResponses(convo, route, responses, {
    orderBumpChoice: choice,
    priceSoles,
  });
  setConversationState(convo.id, "payment_done");
  console.log(
    `[wf] convo ${convo.id} doble oferta "${choice}" → datos de pago directos (${route})`
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
  if (!cfg?.payment_method_buttons) {
    // Botones APAGADOS → enviamos la "cara de texto" del menú (editable).
    await sendBotText(
      convo,
      applyPriceTemplate(
        getPaymentText(convo.phone),
        getEffectivePriceSoles(
          isDiscountActiveForConversation(convo, cfg),
          convo.phone
        ),
        convo
      )
    );
    return;
  }
  const prompt =
    cfg?.payment_buttons_prompt?.trim() ||
    "Puedes elegir tu método de pago 👇";
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
  await sendBotButtons(convo, prompt, buttons);
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
  const price = getEffectivePriceSoles(
    isDiscountActiveForConversation(convo, loadWorkflowConfig()),
    convo.phone
  );
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
  const prompt =
    loadWorkflowConfig()?.payment_buttons_prompt?.trim() ||
    "Puedes elegir tu método de pago 👇";

  if (menu.separate_bubble) {
    // Foto/video + texto en una burbuja; los botones en otra.
    if (hasMedia) await sendBotMediaFromDrive(convo, kind, url, text || undefined);
    else if (text) await sendBotText(convo, text);
    await sendBotButtons(convo, hasMedia && text ? prompt : text || prompt, buttons);
    return;
  }

  // MISMA burbuja: media en la cabecera + texto en el cuerpo + botones abajo.
  if (hasMedia) {
    await sendBotButtonsWithMedia(convo, kind, url, text || prompt, buttons);
  } else {
    await sendBotButtons(convo, text || prompt, buttons);
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
function messageHasPaymentConcern(msg: string): boolean {
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
 * Heurística simple para sacar un nombre del mensaje del cliente. No usamos IA
 * acá porque el LLM cuesta — esto es solo para guardar lo que dijo.
 *
 * Reglas:
 *  - Si el mensaje es corto (<= 4 palabras) y consiste mayormente en letras
 *    → lo tratamos como nombre.
 *  - Si tiene patrones tipo "me llamo X", "soy X", "mi nombre es X" → extraer X.
 *  - Si ninguno aplica → null (no guardamos nada).
 */
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
function pickGiftTextByAd(
  variants:
    | { text?: string; weight?: number; ad_ids?: string[]; enabled?: boolean }[]
    | undefined,
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
      v.text &&
      v.text.trim() &&
      !(v.text.includes("<<") && v.text.includes(">>"))
  );
  return match?.text ?? null;
}

function pickWeightedGiftText(
  variants:
    | { text?: string; weight?: number; ad_ids?: string[]; enabled?: boolean }[]
    | undefined
): string | null {
  if (!variants || variants.length === 0) return null;
  const valid = variants.filter(
    (v) =>
      v.enabled !== false &&
      v.text &&
      v.text.trim() &&
      !(v.text.includes("<<") && v.text.includes(">>"))
  );
  if (valid.length === 0) return null;
  const weightOf = (v: { weight?: number }) =>
    typeof v.weight === "number" && v.weight > 0 ? v.weight : 1;
  const total = valid.reduce((s, v) => s + weightOf(v), 0);
  let r = Math.random() * total;
  for (const v of valid) {
    const w = weightOf(v);
    if (r < w) return v.text ?? null;
    r -= w;
  }
  return valid[valid.length - 1].text ?? null;
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

/** Repite una sola vez el pedido de correo configurable despues del regalo. */
function scheduleEmailReminderAfterGift(convo: ConversationRow): void {
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
  const audioAt = now + between;
  const textAt = audioAt + between;
  scheduleAction(convoId, ACTION_SEND_GIFT_AUDIO, {}, audioAt);
  scheduleAction(convoId, ACTION_SEND_GIFT_TEXT, {}, textAt);
  console.log(
    `[wf] audio + texto del regalo programados para convo ${convoId}: audio en ${between}s, texto en ${between * 2}s`
  );
}

/**
 * Si el mensaje del cliente trae un email válido (y no tenemos uno ya
 * guardado), lo guarda, manda el correo del curso por SMTP, y confirma.
 * NO cambia el estado de la conversación — eso lo gestiona el caller.
 * Devuelve true si capturó algo, false si no había email o ya teníamos uno.
 */
async function tryCaptureEmail(
  convo: ConversationRow,
  msgContent: string
): Promise<boolean> {
  if (convo.client_email) return false; // ya tenemos email guardado
  const email = extractEmailFromText(msgContent);
  if (!email) return false;

  setClientEmail(convo.id, email);
  console.log(`[wf] email capturado para convo ${convo.id}: ${email}`);

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
  const config = loadWorkflowConfig();
  // El correo sigue la ÚLTIMA opción que recibió el cliente: si terminó en el
  // combo (compra directa o upgrade desde el básico), usa la plantilla VIP; si
  // no, la básica. Vale para order bump Y doble oferta 2 productos (antes exigía
  // order_bump.enabled, así que en doble oferta el combo recibía el correo básico).
  const isVipPurchase = convo.order_bump_choice === "combo";
  const tpl = isVipPurchase
    ? config?.email_template_vip
    : config?.email_template;
  if (!tpl) {
    console.warn(
      `[email] ${isVipPurchase ? "email_template_vip" : "email_template"} no configurado, no se envía email`
    );
    return false;
  }
  if (sectionHasPlaceholder(tpl)) {
    console.warn("[email] email_template tiene placeholders, no se envía email");
    return false;
  }
  try {
    await sendEmail({
      to,
      fromName: tpl.from_name,
      subject: tpl.subject,
      body: tpl.body,
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
