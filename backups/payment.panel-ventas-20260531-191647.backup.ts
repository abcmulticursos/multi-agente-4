import {
  addToPaidTotal,
  cancelPendingActionsForConvo,
  getConversationById,
  incrementPaymentAttemptsFailed,
  resetPaymentAttemptsFailed,
  scheduleAction,
  setConversationState,
  type ConversationRow,
} from "@/lib/db";
import {
  getEffectivePriceSoles,
  loadWorkflowConfig,
  sectionHasPlaceholder,
} from "@/lib/workflow/config";
import { sendPurchaseEvent } from "@/lib/meta/conversions";
import { notifyAdmin } from "@/lib/notifications";
import { syncLeadStatus } from "@/lib/leads-sync";

/** Tipo de método de pago que el LLM puede reportar. */
export type PaymentMethod = "yape" | "plin" | "bcp" | "transferencia";

/**
 * Argumentos que el LLM le pasa a la herramienta cuando ve un comprobante.
 * Los completa leyendo la imagen.
 */
export interface RegisterPaymentArgs {
  amount_soles: number;
  payment_method: PaymentMethod;
  /** Nombre del receptor visible en el comprobante. Puede estar parcial
   *  (Yape oculta apellido). Solo aplica a yape/plin. */
  recipient_name?: string;
}

/** Resultado que la herramienta devuelve al LLM. */
export interface RegisterPaymentResult {
  status: "APPROVED" | "PARTIAL" | "REJECTED";
  paid_total_soles: number;
  course_price_soles: number;
  missing_soles: number;
  reason?: string;
  /** Cuántas veces consecutivas se rechazó un comprobante en esta convo.
   *  El LLM usa este número para escalar al asesor humano cuando llega a 3+. */
  failed_attempts_count?: number;
}

/**
 * Definición OpenAI tool calling para que el LLM extraiga datos de un
 * comprobante. Importable y usable en openrouter.ts.
 */
export const REGISTER_PAYMENT_TOOL = {
  type: "function" as const,
  function: {
    name: "register_payment_amount",
    description:
      "When the customer sends an image of a payment receipt (Yape, Plin, BCP, transfer), USE this tool to register it. Extract the exact amount and the method. If it's Yape or Plin, also extract the recipient's name (it may be partial like 'Alberto S***'). The system validates and adds to previous amounts if they were partial.",
    parameters: {
      type: "object",
      properties: {
        amount_soles: {
          type: "number",
          description:
            "Amount in soles from the receipt (e.g. 10, 5.5, 10.00). Just the number.",
        },
        payment_method: {
          type: "string",
          enum: ["yape", "plin", "bcp", "transferencia"],
          description: "Payment method according to the receipt.",
        },
        recipient_name: {
          type: "string",
          description:
            "Name of the payment recipient exactly as it appears on the receipt (may be partial, e.g. 'Alberto S***'). Only applies to Yape/Plin. For BCP/transfer, omit.",
        },
      },
      required: ["amount_soles", "payment_method"],
    },
  },
} as const;

/**
 * Incrementa el contador de intentos fallidos de pago para esta convo.
 * Si alcanza 3, dispara una notificación al admin (formato ⚠️).
 * Devuelve el nuevo conteo para que el caller lo pase al LLM si quiere.
 */
export function trackFailedPaymentAttempt(
  convo: ConversationRow,
  reason: string
): number {
  const newCount = incrementPaymentAttemptsFailed(convo.id);
  console.log(
    `[wf:pago] convo ${convo.id} comprobante REJECTED (intentos fallidos: ${newCount}). Razón: ${reason}`
  );
  if (newCount >= 3) {
    const customerName = convo.client_name ?? convo.name ?? "Sin nombre";
    void notifyAdmin(
      `⚠️ *Un usuario quiere comunicarse contigo*: ⚠️\n\n` +
        `Numero: ${convo.phone}\n` +
        `Nombre: ${customerName}\n` +
        `Asunto: El usuario tiene problemas para realizar su pago, ha fallado ${newCount} intentos consecutivos. Última razón: ${reason}.`
    );
  }
  return newCount;
}

/**
 * Ejecuta la herramienta cuando el LLM la llama. Valida, suma al total
 * acumulado, decide aprobación, y si aprueba dispara la secuencia de
 * pago aprobado.
 */
export async function executeRegisterPayment(
  conversationId: number,
  args: RegisterPaymentArgs
): Promise<RegisterPaymentResult> {
  const config = loadWorkflowConfig();

  const convo = getConversationById(conversationId);
  if (!convo) {
    return {
      status: "REJECTED",
      paid_total_soles: 0,
      course_price_soles: config?.course_price_soles ?? 10,
      missing_soles: config?.course_price_soles ?? 10,
      reason: "Conversación no encontrada",
    };
  }

  // Precio efectivo para ESTA convo: si entró en etapa de oferta, es el
  // descuento; sino, el precio normal del curso.
  const priceSoles = getEffectivePriceSoles(!!convo.discount_active);

  const baseResult = (
    overrides: Partial<RegisterPaymentResult>
  ): RegisterPaymentResult => ({
    status: "REJECTED",
    paid_total_soles: 0,
    course_price_soles: priceSoles,
    missing_soles: priceSoles,
    ...overrides,
  });

  // Si ya estaba aprobado, no procesamos el pago de nuevo.
  if (convo.state === "payment_approved") {
    return baseResult({
      status: "APPROVED",
      paid_total_soles: convo.paid_total_cents / 100,
      missing_soles: 0,
      reason: "Pago ya estaba aprobado",
    });
  }

  if (
    typeof args.amount_soles !== "number" ||
    !Number.isFinite(args.amount_soles) ||
    args.amount_soles <= 0
  ) {
    const reason = "Monto inválido";
    const failed_attempts_count = trackFailedPaymentAttempt(convo, reason);
    return baseResult({ reason, failed_attempts_count });
  }

  // Validación de receptor para Yape/Plin
  if (args.payment_method === "yape" || args.payment_method === "plin") {
    const expectedPrefix = (
      config?.payment_validation?.yape_recipient_name_starts_with ?? "Alberto"
    )
      .trim()
      .toLowerCase();
    const got = (args.recipient_name ?? "").trim().toLowerCase();
    if (!got) {
      const reason = `Para ${args.payment_method} necesito ver el nombre del receptor en el comprobante`;
      const failed_attempts_count = trackFailedPaymentAttempt(convo, reason);
      return baseResult({ reason, failed_attempts_count });
    }
    if (!got.startsWith(expectedPrefix)) {
      const expectedDisplay =
        expectedPrefix.charAt(0).toUpperCase() + expectedPrefix.slice(1);
      const reason = `El comprobante muestra que el pago fue a "${
        args.recipient_name
      }", pero debe ser a un nombre que empiece con "${expectedDisplay}"`;
      const failed_attempts_count = trackFailedPaymentAttempt(convo, reason);
      return baseResult({ reason, failed_attempts_count });
    }
  }
  // Para BCP/transferencia: solo el monto se valida (los tickets no traen
  // nombre fiable). El bot debe verificar esto en el prompt.

  // Suma al total acumulado.
  const cents = Math.round(args.amount_soles * 100);
  const newTotalCents = addToPaidTotal(conversationId, cents);
  const priceCents = Math.round(priceSoles * 100);

  if (newTotalCents >= priceCents) {
    // ¡APROBADO! Disparar la secuencia.
    schedulePaymentApprovedSequence(conversationId);
    setConversationState(conversationId, "payment_approved");
    // Reseteamos el contador de fallos por si en intentos previos se
    // habia incrementado pero ahora cerró bien.
    resetPaymentAttemptsFailed(conversationId);
    const paidTotalSoles = newTotalCents / 100;
    console.log(
      `[wf:pago] convo ${conversationId} APROBADO (total: S/.${paidTotalSoles})`
    );
    // Meta CAPI: reportamos la compra a Meta para optimización de ads.
    // Fire-and-forget — si falla, no rompe el flujo del cliente.
    void sendPurchaseEvent({
      conversationId,
      userData: {
        phone: convo.phone,
        firstName: convo.client_name ?? convo.name,
        email: convo.client_email,
        ctwa_clid: convo.ctwa_clid,
      },
      value: paidTotalSoles,
      currency: "PEN",
    });
    // Notifica al admin por WhatsApp que llegó una compra nueva.
    const customerName = convo.client_name ?? convo.name ?? "Sin nombre";
    void notifyAdmin(
      `🛒 *Venta Realizada*: ‼️🫰🏼💵\n\n` +
        `Numero: ${convo.phone}\n` +
        `Nombre: ${customerName}\n` +
        `Asunto: El usuario acaba de adquirir el curso de Grafismo Fonético y ha realizado una transacción a través de ${args.payment_method} por S/.${paidTotalSoles}.`
    );
    // NocoDB: el state ya cambió a payment_approved → la próxima sync
    // pondrá Label = "pago" y Resumen actualizado.
    void syncLeadStatus(conversationId);
    return {
      status: "APPROVED",
      paid_total_soles: paidTotalSoles,
      course_price_soles: priceSoles,
      missing_soles: 0,
    };
  }

  console.log(
    `[wf:pago] convo ${conversationId} PARCIAL (total: S/.${
      newTotalCents / 100
    } / S/.${priceSoles})`
  );
  return {
    status: "PARTIAL",
    paid_total_soles: newTotalCents / 100,
    course_price_soles: priceSoles,
    missing_soles: (priceCents - newTotalCents) / 100,
  };
}

/**
 * Programa la secuencia "pago aprobado" (video + caption + lo que sea
 * que el operador haya configurado en el YAML).
 */
function schedulePaymentApprovedSequence(conversationId: number): void {
  const config = loadWorkflowConfig();
  if (!config?.payment_approved_sequence) {
    console.warn(
      `[wf:pago] payment_approved_sequence no definido en config — pago aprobado pero sin secuencia que disparar`
    );
    return;
  }
  if (sectionHasPlaceholder(config.payment_approved_sequence)) {
    console.warn(
      `[wf:pago] payment_approved_sequence aún tiene placeholders — falta llenar URL del video y caption en el YAML`
    );
    return;
  }
  // Cancelamos cualquier acción pendiente previa antes de programar la
  // nueva secuencia.
  cancelPendingActionsForConvo(conversationId);
  const now = Math.floor(Date.now() / 1000);
  let cumulativeDelay = 0;
  for (let i = 0; i < config.payment_approved_sequence.length; i++) {
    const isLast = i === config.payment_approved_sequence.length - 1;
    const payload: Record<string, unknown> = {
      step_index: i,
      is_last: isLast,
    };
    scheduleAction(
      conversationId,
      "send_payment_approved_step",
      payload,
      now + cumulativeDelay
    );
    cumulativeDelay += config.payment_approved_sequence[i].delay_after_sec ?? 0;
  }
  console.log(
    `[wf:pago] secuencia pago aprobado programada para convo ${conversationId} (${config.payment_approved_sequence.length} pasos)`
  );
}
