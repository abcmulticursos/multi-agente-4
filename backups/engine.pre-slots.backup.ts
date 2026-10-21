import {
  activateDiscount,
  addToPaidTotal,
  cancelPendingActionsByTypeForConvo,
  cancelPendingActionsForConvo,
  clearClientEmail,
  clearClientName,
  clearNocodbSync,
  deactivateDiscount,
  deleteAllMessages,
  getConversationById,
  getLastUserMessageTime,
  getLatestPendingActionSlot,
  resetPaidTotal,
  resetPaymentAttemptsFailed,
  scheduleAction,
  setClientEmail,
  setClientName,
  setConversationState,
  setLastFollowupStartedAt,
  shiftPendingActionsByType,
  type ConversationRow,
  type ScheduledActionRow,
} from "@/lib/db";
import { adjustForQuietHours, isQuietHour } from "@/lib/workflow/quiet-hours";

// Spacing aleatorio entre seguimientos diferidos en la cola del despertar
// (07:00 Peru). Cada cliente recibe random 45-75s despues del slot anterior.
// Promedio 60s → cola de 60 personas termina ~08:00.
const WAKE_QUEUE_MIN_GAP_SEC = 45;
const WAKE_QUEUE_MAX_GAP_SEC = 75;
const WAKE_QUEUE_INITIAL_OFFSET_MAX_SEC = 30;

// Check proactivo de ventana 24h Meta: si paso este tiempo desde el ultimo
// mensaje del cliente, cancelamos el seguimiento sin llamar a Meta API
// (la API rechazaria con error 131047 - "more than 24 hours" y eso queda
// como senal debil de calidad). Usamos 23h53m = 7 min de margen para
// cubrir clock drift y latencia red.
const META_24H_WINDOW_CUTOFF_SEC = (24 * 60 - 7) * 60; // 85,620 seg = 23h53m
import {
  getEffectivePriceSoles,
  loadWorkflowConfig,
  DEFAULT_BETWEEN_MESSAGES_DELAY,
  pickVariant,
  sectionHasPlaceholder,
  type ResponseStep,
} from "@/lib/workflow/config";
import { sendBotMediaFromDrive, sendBotText } from "@/lib/workflow/sender";
import { sendEmail } from "@/lib/email";
import { sendContactEvent } from "@/lib/meta/conversions";
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
  | "send_gift_audio"
  | "send_gift_text"
  | "exit_awaiting_email"
  | "start_followup"
  | "send_followup_step";

interface SendIntroStepPayload {
  step_index: number;
  is_last: boolean;
}

interface SendPaymentStepPayload {
  route: "yape" | "bcp_transferencia";
  step_index: number;
}

interface SendTextChunkPayload {
  body: string;
}

interface SendPaymentApprovedStepPayload {
  step_index: number;
  is_last: boolean;
}

interface StartFollowupPayload {
  /** Indice de la secuencia en config.followup_sequences (0-based). */
  sequence_index: number;
}

interface SendFollowupStepPayload {
  sequence_index: number;
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
const ACTION_SEND_GIFT_AUDIO: ActionType = "send_gift_audio";
const ACTION_SEND_GIFT_TEXT: ActionType = "send_gift_text";
const ACTION_EXIT_AWAITING_EMAIL: ActionType = "exit_awaiting_email";
const ACTION_START_FOLLOWUP: ActionType = "start_followup";
const ACTION_SEND_FOLLOWUP_STEP: ActionType = "send_followup_step";

const DEFAULT_AWAITING_EMAIL_TIMEOUT = 300;

/** Comando de reseteo manual desde WhatsApp. */
const RESTART_COMMANDS = ["/restart", "/reset", "/reiniciar"];

/**
 * Devuelve true si el workflow ya gestionó este turno (no hay que llamar al
 * LLM). Devuelve false si no aplica y la lógica IA estándar debe seguir.
 */
export async function tryWorkflowOnIncoming(
  convo: ConversationRow,
  msgContent: string
): Promise<boolean> {
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

  const state = convo.state;

  // Conversaciones pre-existentes a esta feature: state === null.
  // Las marcamos silenciosamente como intro_done para que la IA siga normal.
  if (state === null || state === undefined) {
    setConversationState(convo.id, "intro_done");
    return false;
  }

  // CASO 1: estado 'new' (brand-new o post-/restart) → saludar y programar fallback.
  if (state === "new") {
    const greetingText =
      pickVariant(config.greeting.text_variants, config.greeting.text) ?? "";
    if (greetingText.trim()) await sendBotText(convo, greetingText);
    setConversationState(convo.id, "awaiting_response");
    const runAt =
      Math.floor(Date.now() / 1000) + config.no_response_delay_seconds;
    scheduleAction(convo.id, ACTION_FALLBACK_INTRO, {}, runAt);
    console.log(
      `[wf] saludo enviado a convo ${convo.id}, fallback intro en ${config.no_response_delay_seconds}s`
    );
    // Programa las secuencias de seguimiento desde T0 = primer mensaje.
    // Si no hay followup_sequences en config, no programa nada.
    scheduleFollowupSequences(convo.id);
    // Meta CAPI: reportamos el contacto inicial para atribución de ads.
    void sendContactEvent({
      conversationId: convo.id,
      userData: {
        phone: convo.phone,
        firstName: convo.name,
        ctwa_clid: convo.ctwa_clid,
      },
    });
    // NocoDB: aseguramos crear la fila del lead aunque después el cliente
    // no escriba otro mensaje (handler.ts sync solo dispara con mensaje).
    void syncLeadStatus(convo.id);
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
    // Sin email → LLM responde. El system prompt tiene reglas específicas
    // para no repetir info ya dada (enlace de descarga, etc.).
    return false;
  }

  // Si está en payment_approved pero todavía NO tiene email guardado,
  // seguimos buscando en cada mensaje hasta capturarlo.
  if (state === "payment_approved" && !convo.client_email) {
    if (await tryCaptureEmail(convo, msgContent)) return true;
  }

  // CASO: cliente recibió la pregunta de consentimiento del regalo extra
  // y le toca responder sí / no / ambiguo.
  if (state === "awaiting_gift_consent") {
    // Capturamos email si todavía no lo tenía y vino uno en este mensaje.
    let emailJustCaptured = false;
    if (!convo.client_email) {
      emailJustCaptured = await tryCaptureEmail(convo, msgContent);
    }

    const consent = detectGiftConsent(msgContent);
    if (consent === "yes") {
      console.log(`[wf] convo ${convo.id} aceptó regalo extra → programo audio+texto`);
      // Cancelar cualquier consent zombie pendiente antes de avanzar.
      cancelPendingActionsByTypeForConvo(convo.id, ACTION_SEND_GIFT_CONSENT);
      scheduleGiftAudioAndText(convo.id);
      return true;
    }
    if (consent === "no") {
      console.log(`[wf] convo ${convo.id} rechazó regalo extra → cierre cordial`);
      // Cancelar cualquier accion del ciclo del regalo pendiente — el
      // cliente eligio no, no queremos que vuelva a aparecer la oferta.
      cancelPendingGiftActions(convo.id);
      const cfg = loadWorkflowConfig();
      const declineMsg = cfg?.gift_mechanic?.decline_message?.trim();
      if (declineMsg) {
        try {
          await sendBotText(convo, declineMsg);
        } catch (err) {
          console.error("[wf] error enviando decline_message:", err);
        }
      }
      setConversationState(convo.id, "payment_approved");
      return true;
    }
    // Ambiguo: si captó email lo confirmamos, sino dejamos al LLM responder.
    if (emailJustCaptured) return true;
    return false;
  }

  // Mecánica de regalo por comentar en Facebook. En este estado puede
  // pasar 3 cosas a la vez:
  //  - Cliente escribe "COMENTADO" → enviamos reward, transicionamos
  //  - Cliente da su correo (aún sin capturar) → capturamos sin cambiar estado
  //  - Ambas → capturamos email + enviamos reward
  if (state === "awaiting_facebook_comment") {
    const wantsReward = containsCommentedKeyword(msgContent);

    let emailJustCaptured = false;
    if (!convo.client_email) {
      emailJustCaptured = await tryCaptureEmail(convo, msgContent);
    }

    if (wantsReward) {
      const cfg = loadWorkflowConfig();
      if (cfg?.gift_mechanic && !sectionHasPlaceholder(cfg.gift_mechanic)) {
        await sendBotText(convo, cfg.gift_mechanic.reward_message);
        console.log(`[wf] convo ${convo.id} reclamó el regalo de FB`);
      }
      // Cierre del ciclo del regalo — cancelar cualquier accion pendiente
      // del flujo gift que haya quedado zombie. Esto previene que la
      // pregunta de consent se dispare de vuelta tras el COMENTADO.
      cancelPendingGiftActions(convo.id);
      setConversationState(convo.id, "payment_approved");
      return true;
    }

    if (emailJustCaptured) return true;
    // Ni COMENTADO ni email → LLM responde guiando al cliente. El system
    // prompt tiene reglas específicas para no inventar links de regalo.
  }

  // CASO 4: intro terminado o ya en payment_done → detectar palabra clave
  // de pago. Permitimos que cambien de opinión (yape → bcp y viceversa).
  if (state === "intro_done" || state === "payment_done") {
    const route = detectPaymentRoute(msgContent);
    if (route) {
      const responses =
        route === "yape"
          ? config.payment_responses.yape
          : config.payment_responses.bcp_transferencia;
      console.log(
        `[wf] convo ${convo.id} eligió pago "${route}", programando ${responses.length} respuestas`
      );
      // Cancela acciones de un pago previo (yape antes de que terminen sus
      // 3 mensajes y ahora dicen "bcp"). Solo el tipo payment_step — los
      // follow-ups deben seguir vivos hasta que se apruebe la compra.
      cancelPendingActionsByTypeForConvo(convo.id, ACTION_SEND_PAYMENT_STEP);
      await schedulePaymentResponses(convo, route, responses);
      setConversationState(convo.id, "payment_done");
      return true;
    }
    // Sin keyword → cae al LLM
    return false;
  }

  return false;
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
  clearNocodbSync(convo.id);
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
 * Programa los `start_followup` de cada secuencia configurada en
 * `followup_sequences` con sus delays absolutos desde ahora (T0).
 *
 * Diseño: schedule lazy — programamos solo el "arranque" de cada secuencia.
 * Cuando llega su momento, recién ahí leemos config y programamos los
 * pasos individuales (esto permite editar el YAML en runtime y que los
 * cambios apliquen a follow-ups aún no disparados).
 *
 * Si una secuencia tiene placeholders en sus steps, igual programamos
 * el start_followup — el chequeo de placeholders se hace al ejecutar.
 */
function scheduleFollowupSequences(convoId: number): void {
  const config = loadWorkflowConfig();
  const sequences = config?.followup_sequences;
  if (!sequences || sequences.length === 0) return;
  const now = Math.floor(Date.now() / 1000);
  for (let i = 0; i < sequences.length; i++) {
    const seq = sequences[i];
    const delayMin = seq.delay_minutes_from_first_message;
    if (typeof delayMin !== "number" || delayMin <= 0) {
      console.warn(
        `[wf] followup_sequences[${i}] (${seq.name ?? "?"}) tiene delay invalido, salteo`
      );
      continue;
    }
    const runAt = now + Math.floor(delayMin * 60);
    const payload: StartFollowupPayload = { sequence_index: i };
    scheduleAction(
      convoId,
      ACTION_START_FOLLOWUP,
      payload as unknown as Record<string, unknown>,
      runAt
    );
  }
  console.log(
    `[wf] convo ${convoId}: ${sequences.length} secuencias de seguimiento programadas`
  );
}

/**
 * Programa todas las acciones del intro con sus delays acumulados.
 */
async function scheduleIntroSequence(convoId: number): Promise<void> {
  const config = loadWorkflowConfig();
  if (!config) return;
  setConversationState(convoId, "intro_running");
  const now = Math.floor(Date.now() / 1000);
  let cumulativeDelay = 0;
  for (let i = 0; i < config.intro_sequence.length; i++) {
    const isLast = i === config.intro_sequence.length - 1;
    const payload: Record<string, unknown> = {
      step_index: i,
      is_last: isLast,
    };
    scheduleAction(
      convoId,
      ACTION_SEND_INTRO_STEP,
      payload,
      now + cumulativeDelay
    );
    cumulativeDelay += config.intro_sequence[i].delay_after_sec;
  }
  console.log(
    `[wf] intro programado para convo ${convoId} (${config.intro_sequence.length} pasos)`
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
    const step = config.intro_sequence[payload.step_index];
    if (!step) {
      console.warn(
        `[wf] acción ${action.id}: step_index ${payload.step_index} fuera de rango`
      );
      return;
    }
    console.log(
      `[wf] enviando intro step ${payload.step_index} (${step.type}) a convo ${convo.id}`
    );
    const introCaption = pickVariant(step.caption_variants, step.caption);
    await sendBotMediaFromDrive(convo, step.type, step.drive_url, introCaption);
    if (payload.is_last) {
      setConversationState(convo.id, "intro_done");
      console.log(`[wf] intro completado para convo ${convo.id}`);
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
      convo.state !== "awaiting_email"
    ) {
      console.log(
        `[wf] acción ${action.id}: state es ${convo.state}, no envío gift consent`
      );
      return;
    }
    await sendBotText(convo, gift.consent_question);
    setConversationState(convo.id, "awaiting_gift_consent");
    console.log(
      `[wf] consent del regalo enviado a convo ${convo.id} → awaiting_gift_consent`
    );
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
    await sendBotText(convo, gift.ask_text);
    setConversationState(convo.id, "awaiting_facebook_comment");
    console.log(
      `[wf] gift texto enviado a convo ${convo.id} → awaiting_facebook_comment`
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
    if (!config?.payment_approved_sequence) {
      console.warn(`[wf] acción ${action.id}: payment_approved_sequence no definido`);
      return;
    }
    const step = config.payment_approved_sequence[payload.step_index];
    if (!step) {
      console.warn(
        `[wf] acción ${action.id}: payment_approved step_index ${payload.step_index} fuera de rango`
      );
      return;
    }
    console.log(
      `[wf] enviando payment_approved step ${payload.step_index} (${step.type}) a convo ${convo.id}`
    );
    if (step.type === "text") {
      const textStep = step as { body?: string; body_variants?: string[] };
      const text = pickVariant(textStep.body_variants, textStep.body) ?? "";
      if (text.trim()) await sendBotText(convo, text);
    } else {
      const approvedCaption = pickVariant(step.caption_variants, step.caption);
      await sendBotMediaFromDrive(convo, step.type, step.drive_url, approvedCaption);
    }
    if (payload.is_last) {
      // Tras el último paso (pedido de email), pasamos a awaiting_email
      // y programamos directamente el gift al cumplirse el timeout.
      // Si el cliente da su email mientras tanto, se captura igual y se
      // manda el SMTP, pero el gift sigue al horario programado.
      setConversationState(convo.id, "awaiting_email");
      const cfg = loadWorkflowConfig();
      const timeoutSec =
        cfg?.awaiting_email_timeout_seconds ?? DEFAULT_AWAITING_EMAIL_TIMEOUT;
      scheduleGiftConsentWithDelay(convo.id, timeoutSec);
      console.log(
        `[wf] payment_approved sequence completada, convo ${convo.id} → awaiting_email, gift programado en ${timeoutSec}s`
      );
    }
    return;
  }

  if (action.action_type === ACTION_START_FOLLOWUP) {
    const payload = JSON.parse(action.payload) as StartFollowupPayload;
    if (convo.state === "payment_approved") {
      console.log(
        `[wf:seguimiento] convo ${convo.id} ya pagó, no disparo seguimiento ${payload.sequence_index + 1}`
      );
      return;
    }
    // Check proactivo de ventana 24h Meta: si pasaron mas de 23h53m desde
    // el ultimo mensaje del cliente, NO intentamos enviar porque Meta lo
    // va a rechazar (error 131047). Cancelamos limpio sin tocar la API
    // para no generar senales de calidad. seg_1/2/3 caen siempre dentro
    // de 24h; solo seg_4 puede caer fuera por quiet hours retrasandolo.
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
    // Horario silencioso 22:00-07:00 Peru: si caemos aqui, posponemos este
    // seguimiento al proximo 07:00 y desplazamos los siguientes el mismo
    // delta para preservar los gaps configurados en el YAML.
    // ORDEN CRITICO: primero shift de los pendientes, despues schedule del
    // nuevo. Si lo hacemos al reves, el nuevo (que tiene run_at > nowSec)
    // tambien queda atrapado por el shift y se desplaza dos veces.
    const nowSec = Math.floor(Date.now() / 1000);
    if (isQuietHour(nowSec)) {
      // Calcular el slot del nuevo seguimiento en la cola del despertar:
      // cada cliente entra al final de la cola con un gap aleatorio de
      // 45-75s respecto al cliente anterior. Esto evita ráfagas robóticas
      // a las 07:00:00 clavadas.
      const wakeBase = adjustForQuietHours(nowSec);
      const lastSlot = getLatestPendingActionSlot(
        ACTION_START_FOLLOWUP,
        wakeBase
      );
      let newRunAt: number;
      if (lastSlot === null) {
        newRunAt =
          wakeBase +
          Math.floor(Math.random() * (WAKE_QUEUE_INITIAL_OFFSET_MAX_SEC + 1));
      } else {
        const gapSec =
          WAKE_QUEUE_MIN_GAP_SEC +
          Math.floor(
            Math.random() *
              (WAKE_QUEUE_MAX_GAP_SEC - WAKE_QUEUE_MIN_GAP_SEC + 1)
          );
        newRunAt = lastSlot + gapSec;
      }
      const deltaSec = newRunAt - nowSec;
      const shifted = shiftPendingActionsByType(
        convo.id,
        ACTION_START_FOLLOWUP,
        deltaSec,
        nowSec
      );
      scheduleAction(
        convo.id,
        ACTION_START_FOLLOWUP,
        payload as unknown as Record<string, unknown>,
        newRunAt
      );
      console.log(
        `[wf:quiet] seguimiento ${payload.sequence_index + 1} de convo ${convo.id} cae en silencio, pospuesto a ${new Date(newRunAt * 1000).toISOString()} (+${Math.round(deltaSec / 60)}min, ${shifted} siguientes desplazados)`
      );
      return;
    }
    const config = loadWorkflowConfig();
    const sequences = config?.followup_sequences;
    const seq = sequences?.[payload.sequence_index];
    if (!seq) {
      console.warn(
        `[wf:seguimiento] convo ${convo.id} accion ${action.id}: secuencia ${payload.sequence_index} no existe en config`
      );
      return;
    }
    if (sectionHasPlaceholder(seq)) {
      console.log(
        `[wf:seguimiento] ${seq.name} aun tiene placeholders, no se envia a convo ${convo.id}`
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
    for (let i = 0; i < seq.steps.length; i++) {
      const isLast = i === seq.steps.length - 1;
      const stepPayload: SendFollowupStepPayload = {
        sequence_index: payload.sequence_index,
        step_index: i,
        is_last: isLast,
      };
      scheduleAction(
        convo.id,
        ACTION_SEND_FOLLOWUP_STEP,
        stepPayload as unknown as Record<string, unknown>,
        now + cumulativeDelay
      );
      cumulativeDelay += seq.steps[i].delay_after_sec ?? 0;
    }
    // Marcar este momento como milestone: el proximo seguimiento solo
    // disparara si el cliente respondio DESPUES de este timestamp.
    setLastFollowupStartedAt(convo.id, now);
    console.log(
      `[wf:seguimiento] arranca ${seq.name} en convo ${convo.id} (${seq.steps.length} pasos, milestone actualizado)`
    );
    return;
  }

  if (action.action_type === ACTION_SEND_FOLLOWUP_STEP) {
    const payload = JSON.parse(action.payload) as SendFollowupStepPayload;
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
    const step = seq.steps[payload.step_index];
    if (!step) {
      console.warn(
        `[wf:seguimiento] convo ${convo.id}: step ${payload.step_index} fuera de rango en ${seq.name}`
      );
      return;
    }
    if (step.type === "text") {
      const text = pickVariant(step.body_variants, step.body) ?? "";
      if (text.trim()) await sendBotText(convo, text);
    } else {
      const fwCaption =
        step.type !== "audio"
          ? pickVariant(step.caption_variants, step.caption)
          : undefined;
      await sendBotMediaFromDrive(
        convo,
        step.type,
        step.drive_url,
        fwCaption
      );
    }
    console.log(
      `[wf:seguimiento] ${seq.name} step ${payload.step_index} (${step.type}) enviado a convo ${convo.id}${payload.is_last ? " [ultimo]" : ""}`
    );
    // Cuando termina el último step de una secuencia, marcamos Enviado N
    // en NocoDB (fire-and-forget).
    if (payload.is_last) {
      void markFollowupSent(convo.id, payload.sequence_index + 1);
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
    const steps =
      payload.route === "yape"
        ? config.payment_responses.yape
        : config.payment_responses.bcp_transferencia;
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
    await sendResponseStep(convo, step);
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
  const chunks = fullText
    .split(/\n\s*\n/)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);

  if (chunks.length === 0) return;

  // Primer chunk: inmediato.
  await sendBotText(convo, chunks[0]);
  if (chunks.length === 1) return;

  const config = loadWorkflowConfig();
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
 * Hoy soporta `{price}` y `{precio}` → precio efectivo del curso para
 * esta convo (S/.10 normalmente, S/.8 si entró en etapa de oferta).
 */
function applyPriceTemplate(text: string, priceSoles: number): string {
  return text
    .replace(/\{price\}/gi, String(priceSoles))
    .replace(/\{precio\}/gi, String(priceSoles));
}

/**
 * Envía un único paso de respuesta (texto o media). Helper compartido
 * entre la respuesta inmediata y los pasos programados.
 */
async function sendResponseStep(
  convo: ConversationRow,
  step: ResponseStep
): Promise<void> {
  const price = getEffectivePriceSoles(!!convo.discount_active);
  if (step.type === "text") {
    const bodyText = pickVariant(step.body_variants, step.body) ?? "";
    if (bodyText.trim()) {
      await sendBotText(convo, applyPriceTemplate(bodyText, price));
    }
  } else {
    const captionRaw =
      step.type !== "audio"
        ? pickVariant(
            (step as { caption_variants?: string[] }).caption_variants,
            (step as { caption?: string }).caption
          )
        : undefined;
    const caption = captionRaw
      ? applyPriceTemplate(captionRaw, price)
      : undefined;
    await sendBotMediaFromDrive(
      convo,
      step.type,
      step.drive_url,
      caption
    );
  }
}

/**
 * Manda la primera respuesta de pago inmediato y programa las siguientes
 * con `between_messages_delay_seconds` de separación. Así evitamos el
 * "spam por robotización" y el cliente puede leer cada mensaje.
 */
async function schedulePaymentResponses(
  convo: ConversationRow,
  route: "yape" | "bcp_transferencia",
  steps: ResponseStep[]
): Promise<void> {
  if (steps.length === 0) return;

  // Primer mensaje: lo mandamos ya — feedback inmediato al cliente.
  await sendResponseStep(convo, steps[0]);

  if (steps.length === 1) return;

  const config = loadWorkflowConfig();
  const delay =
    config?.between_messages_delay_seconds ?? DEFAULT_BETWEEN_MESSAGES_DELAY;
  const now = Math.floor(Date.now() / 1000);

  for (let i = 1; i < steps.length; i++) {
    const payload: Record<string, unknown> = {
      route,
      step_index: i,
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
 * Detecta si el mensaje del cliente menciona Yape, BCP o transferencia.
 * Devuelve null si no matchea ninguno.
 */
function detectPaymentRoute(
  msg: string
): "yape" | "bcp_transferencia" | null {
  const lower = msg.toLowerCase().trim();
  if (/\byape\b/.test(lower) || /\bplin\b/.test(lower)) return "yape";
  if (
    /\bbcp\b/.test(lower) ||
    /\btransferencia\b/.test(lower) ||
    /\btransferir\b/.test(lower) ||
    /\btransferi\b/.test(lower) ||
    /\bdep[oó]sito\b/.test(lower) ||
    /\bdepositar\b/.test(lower) ||
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
      return cleanName(m[1]);
    }
  }

  // Mensaje corto y mayormente alfabético → asumimos nombre.
  const words = text.split(/\s+/);
  if (words.length <= 4) {
    const alpha = text.replace(/[^a-záéíóúñü\s]/gi, "").trim();
    if (alpha.length >= 2 && alpha.length / text.length > 0.7) {
      return cleanName(alpha);
    }
  }
  return null;
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

  // Chequeo de NO primero (algunos contienen tokens que aparecen en "yes")
  if (
    /^no$/.test(normalized) ||
    /^no[\s,.!?]/.test(normalized) ||
    /\bno\s+(gracias|me\s+interesa|quiero|es\s+necesario|hace\s+falta|por\s+ahora|me\s+gusta|deseo)\b/.test(
      normalized
    ) ||
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
    /^si$/.test(normalized) ||
    /^si[\s,.!?]/.test(normalized) ||
    /^(claro|dale|ok|okay|bueno|listo|perfecto|excelente|genial|sip|seguro|por\s+supuesto)\b/.test(
      normalized
    ) ||
    /\b(me\s+interesa|me\s+gustaria|me\s+gusta|lo\s+quiero|si\s+quiero|acepto|si\s+por\s+favor)\b/.test(
      normalized
    ) ||
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
    /\bcomentad[oa]?\b/.test(normalized) ||
    /\bcomente\b/.test(normalized) ||
    /\bya\s+(lo\s+)?(comente|hice|deje|puse|esta)\b/.test(normalized) ||
    /\blisto\b/.test(normalized) ||
    /\bhecho\b/.test(normalized) ||
    /\bya\s+esta\b/.test(normalized) ||
    /\bya\s+lo\s+termine\b/.test(normalized)
  );
}

/**
 * Cancela todas las acciones del ciclo del regalo (consent, audio, text)
 * que aún estén pendientes. Lo llamamos cuando el ciclo termina (por
 * COMENTADO recibido, "no" en consent, o cuando reprogramamos el inicio)
 * para que no queden acciones zombie que disparen una segunda vez.
 */
function cancelPendingGiftActions(convoId: number): void {
  cancelPendingActionsByTypeForConvo(convoId, ACTION_SEND_GIFT_CONSENT);
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

  const emailSent = await trySendCourseEmail(email);
  if (emailSent) {
    await sendBotText(
      convo,
      `✅ ¡Recibí tu correo: *${email}*!\n\n📧 Te lo envié también allí para que no lo pierdas.`
    );
  } else {
    await sendBotText(
      convo,
      `✅ ¡Recibí tu correo: *${email}*!\n\nHubo un detalle al enviarlo, pero ya tienes el enlace aquí en WhatsApp. Si lo necesitas reenviado, avísame.`
    );
  }
  return true;
}

/**
 * Envía el email del curso al cliente. Devuelve true si OK, false si
 * faltó configuración o el SMTP rechazó. Nunca tira excepción para que
 * la captura del email no rompa el flujo de WhatsApp.
 */
async function trySendCourseEmail(to: string): Promise<boolean> {
  const config = loadWorkflowConfig();
  const tpl = config?.email_template;
  if (!tpl) {
    console.warn("[email] email_template no configurado, no se envía email");
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
