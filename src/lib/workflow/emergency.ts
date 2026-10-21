import { getConversationById, markHadEmergency } from "@/lib/db";
import { notifyAdmin } from "@/lib/notifications";
import { syncLeadStatus } from "@/lib/leads-sync";

/** Argumentos que el LLM le pasa a la tool. */
export interface NotifyEmergencyArgs {
  /** Resumen breve del problema del cliente, tal como lo entiende el LLM. */
  reason: string;
}

/** Resultado que la tool devuelve al LLM. */
export interface NotifyEmergencyResult {
  status: "sent" | "missing_data";
  message?: string;
}

/**
 * Definición OpenAI tool calling para que el LLM avise al admin cuando
 * el cliente tiene un problema real que requiere intervención humana.
 * Se importa en openrouter.ts.
 */
export const NOTIFY_EMERGENCY_TOOL = {
  type: "function" as const,
  function: {
    name: "notify_admin_emergency",
    description:
      "USE WITH JUDGMENT, NOT BY REFLEX. Applies to ANY customer problem (payment, download, access, usage, etc.). Invoke this tool ONLY when ALL these conditions are met: (1) the customer reports a real problem, (2) you have ALREADY tried to help them at least 2 times with specific info you handle (video instructivo, link received, payment details, practical suggestions), (3) the customer keeps insisting or is clearly frustrated and the problem isn't resolved, (4) you explicitly offered an advisor with the question '¿Deseas que un asesor especializado se comunique contigo?', and (5) the customer responded affirmatively. Do NOT use it on the FIRST message of any problem ('no puedo pagar', 'no puedo descargar', 'no me sale', 'no se como', etc.) — first try to solve it yourself. Do NOT use it for minor problems or ones solvable with the info the customer already received.",
    parameters: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description:
            "Clear summary of the problem (1-2 sentences) as you understand it, written in Spanish. Example: 'El usuario no puede descargar el material, dice que el enlace no abre'.",
        },
      },
      required: ["reason"],
    },
  },
} as const;

/**
 * Ejecuta la tool: arma el mensaje al admin (formato 🚨) y lo envía.
 * Fire-and-forget para el envío — si Meta falla por ventana 24h, se loguea.
 */
export async function executeNotifyEmergency(
  conversationId: number,
  args: NotifyEmergencyArgs
): Promise<NotifyEmergencyResult> {
  const convo = getConversationById(conversationId);
  if (!convo) {
    return { status: "missing_data", message: "Conversación no encontrada" };
  }
  const reason = (args.reason ?? "").trim();
  if (!reason) {
    return { status: "missing_data", message: "Falta el motivo (reason)" };
  }
  const customerName = convo.client_name ?? convo.name ?? "Sin nombre";
  if (convo.channel !== "test") void notifyAdmin(
    `🚨 *Un usuario quiere comunicarse contigo*: 🚨\n\n` +
      `Numero: ${convo.phone}\n` +
      `Nombre: ${customerName}\n` +
      `Asunto: ${reason}`
  );
  // Marcamos la convo con had_emergency=1 para que el Label en NocoDB
  // pase a "reclamo" en la próxima sync.
  markHadEmergency(conversationId);
  void syncLeadStatus(conversationId);
  console.log(
    `[wf:emergencia] convo ${conversationId} marcó emergencia: ${reason.slice(
      0,
      120
    )}`
  );
  return { status: "sent" };
}

// ─────────────────────────────────────────────────────────────────────────
// Tool de pedido de asesor para VENTAS (no emergencia)
// ─────────────────────────────────────────────────────────────────────────

export interface NotifyAdvisorArgs {
  /** Resumen de qué información necesita el cliente y por qué no se le
   *  pudo convencer con la conversación. */
  reason: string;
}

export interface NotifyAdvisorResult {
  status: "sent" | "missing_data";
  message?: string;
}

export const NOTIFY_ADVISOR_TOOL = {
  type: "function" as const,
  function: {
    name: "notify_admin_advisor_request",
    description:
      "USE ONLY IN STRONG CASES. Invoke this tool only when: (1) the customer EXPLICITLY asks to talk to a human/advisor, OR (2) the customer CLEARLY expresses intent to enroll AND at the same time CLEARLY says something isn't clear to them and that's blocking their decision (both signals combined in their message). Valid examples: 'quiero inscribirme pero no me queda clara la informacion', 'lo necesito urgente pero no me queda claro que hacer'. Do NOT use it for normal questions (price, content, age, format, how to download, installments, duration), even if they repeat or the customer says 'no entiendo' — re-explain it yourself. Do NOT use it for 'dejame pensarlo' or soft doubts. Do NOT use it for post-sale technical problems (that's notify_admin_emergency). Only invoke this tool AFTER having offered an advisor with the agreed text and having received an affirmative response from the customer.",
    parameters: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description:
            "Clear summary (1-2 sentences), written in Spanish, of WHAT information the customer needs and why we got to this point. E.g.: 'El usuario desea comprar pero necesita información más detallada del producto antes de decidir; se le sugirió un asesor para info a detalle.'",
        },
      },
      required: ["reason"],
    },
  },
} as const;

export async function executeNotifyAdvisor(
  conversationId: number,
  args: NotifyAdvisorArgs
): Promise<NotifyAdvisorResult> {
  const convo = getConversationById(conversationId);
  if (!convo) {
    return { status: "missing_data", message: "Conversación no encontrada" };
  }
  const reason = (args.reason ?? "").trim();
  if (!reason) {
    return { status: "missing_data", message: "Falta el motivo (reason)" };
  }
  const customerName = convo.client_name ?? convo.name ?? "Sin nombre";
  if (convo.channel !== "test") void notifyAdmin(
    `🧐 *Un usuario quiere comunicarse contigo:* 🤷🏻‍♂️\n\n` +
      `Numero: ${convo.phone}\n` +
      `Nombre: ${customerName}\n` +
      `Asunto: ${reason}`
  );
  console.log(
    `[wf:asesor-ventas] convo ${conversationId} pidió asesor: ${reason.slice(
      0,
      120
    )}`
  );
  return { status: "sent" };
}
