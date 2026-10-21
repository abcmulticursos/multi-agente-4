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
      "USAR CON CRITERIO, NO POR REFLEJO. Aplica a CUALQUIER problema del cliente (pago, descarga, acceso, uso, etc.). Invoca esta tool SOLO cuando se cumplan TODAS estas condiciones: (1) el cliente reporta un problema real, (2) YA intentaste ayudarlo al menos 2 veces con info especifica que vos manejas (video instructivo, enlace recibido, datos de pago, sugerencias practicas), (3) el cliente sigue insistiendo o esta claramente frustrado y el problema no se resuelve, (4) le ofreciste explicitamente un asesor con la pregunta '¿Deseas que un asesor especializado se comunique contigo?', y (5) el cliente respondio afirmativamente. NO la uses en el PRIMER mensaje de cualquier problema ('no puedo pagar', 'no puedo descargar', 'no me sale', 'no se como', etc.) — primero intenta resolver vos. NO la uses para problemas leves o resolubles con la info que el cliente ya recibio.",
    parameters: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description:
            "Resumen claro del problema (1-2 oraciones) tal como tú lo entiendes. Ejemplo: 'El usuario no puede descargar el material, dice que el enlace no abre'.",
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
  void notifyAdmin(
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
      "USAR SOLO EN CASOS FUERTES. Invoca esta tool unicamente cuando: (1) el cliente pide EXPLICITAMENTE hablar con un humano/asesor, O (2) el cliente expresa CLARAMENTE intencion de inscribirse Y a la vez dice CLARAMENTE que algo no le queda claro y eso le impide decidir (la combinacion de las dos señales en su mensaje). Ejemplos validos: 'quiero inscribirme pero no me queda clara la informacion', 'lo necesito urgente pero no me queda claro que hacer'. NO la uses por preguntas normales (precio, contenido, edad, formato, como descargar, cuotas, duracion), aunque se repitan o el cliente diga 'no entiendo' — re-explicale tu. NO la uses para 'dejame pensarlo' o dudas suaves. NO la uses para problemas tecnicos post-venta (esa es notify_admin_emergency). Solo invoca esta tool DESPUES de haberle ofrecido un asesor con el texto pactado y haber recibido respuesta afirmativa del cliente.",
    parameters: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description:
            "Resumen claro (1-2 oraciones) de QUÉ información necesita el cliente y por qué llegamos a este punto. Ej: 'El usuario desea inscribirse pero necesita información detallada sobre cómo aplicar el método con su hija de 7 años; se le sugirió un asesor para info a detalle.'",
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
  void notifyAdmin(
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
