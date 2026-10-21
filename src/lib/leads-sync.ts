import {
  countUserMessages,
  getConversationById,
  setNocodbLabel,
  setNocodbResumen,
  setNocodbRowId,
  type ConversationRow,
} from "@/lib/db";
import {
  createLead,
  deleteLead,
  updateLead,
  type LeadRowData,
} from "@/lib/nocodb";
import { getProductName } from "@/lib/workflow/config";

/**
 * Formatea un timestamp UNIX como datetime naive en UTC
 * ("YYYY-MM-DD HH:mm:ss").
 *
 * IMPORTANTE — por qué UTC y NO hora de Perú: NocoDB toma el string naive
 * que le mandás, lo interpreta como UTC, y lo MUESTRA convertido a la zona
 * del servidor (que es Perú, UTC-5). Entonces hay que mandarle la hora UTC
 * real del evento: NocoDB le resta 5h al mostrarla y queda en hora de Perú
 * correcta.
 *
 * (Comprobado en producción: mandar la hora de Perú "pelada" la mostraba
 * 5h corrida — NocoDB la tomaba como UTC y le restaba otras 5h.)
 */
function formatNocodbDateTime(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

export type LeadLabel =
  | "warm"
  | "hot"
  | "pago"
  | "pago-reclamo"
  | "reclamo";

/** Cuántos mensajes del cliente hacen pasar de "warm" a "hot". */
const HOT_THRESHOLD = 5;

/**
 * Calcula la etiqueta del lead según el estado actual de la convo.
 * Prioridad:
 *  - pago-reclamo: ya pagó Y activó una emergencia (no puede descargar, etc.)
 *  - pago: ya pagó (sin emergencia)
 *  - reclamo: emergencia activada antes de pagar
 *  - hot: muchos mensajes del cliente sin pagar (interés alto)
 *  - warm: default
 */
function computeLabel(convo: ConversationRow): LeadLabel {
  const isPaid =
    convo.state === "payment_approved" ||
    convo.state === "awaiting_email" ||
    convo.state === "awaiting_gift_consent" ||
    convo.state === "awaiting_facebook_comment";
  if (isPaid && convo.had_emergency) return "pago-reclamo";
  if (isPaid) return "pago";
  if (convo.had_emergency) return "reclamo";
  const userMsgs = countUserMessages(convo.id);
  if (userMsgs >= HOT_THRESHOLD) return "hot";
  return "warm";
}

/**
 * Genera un resumen humano-legible del estado actual del lead. Heurística
 * pura — no consume tokens del LLM.
 */
function computeResumen(convo: ConversationRow): string {
  const productName = getProductName();
  switch (convo.state) {
    case "new":
    case "awaiting_response":
      return `El usuario inició la conversación y mostró interés en ${productName}.`;
    case "intro_running":
      return `El usuario está recibiendo la información de bienvenida de ${productName}.`;
    case "intro_done":
      return `El usuario recibió la información completa de ${productName} y evalúa la compra.`;
    case "payment_done":
      return "El usuario eligió método de pago, esperando comprobante para confirmar la compra.";
    case "payment_approved":
      return `El usuario adquirió ${productName}.`;
    case "awaiting_email":
      return "El usuario completó la compra, se espera su correo electrónico para enviar el material.";
    case "awaiting_facebook_comment":
      return "El usuario completó la compra y va a reclamar el regalo adicional comentando en Facebook.";
    default:
      return `El usuario está interesado en ${productName}.`;
  }
}

/**
 * Asegura que la convo tenga una fila en NocoDB. Si todavía no existe,
 * la crea. Devuelve el rowId resultante (o null si NocoDB falló / no
 * está configurado).
 */
async function ensureLeadRow(convo: ConversationRow): Promise<string | null> {
  if (convo.nocodb_row_id) return convo.nocodb_row_id;

  // Para "Nombre" priorizamos el push name de WhatsApp (convo.name) porque
  // es lo que se ve naturalmente en cualquier CRM o panel — el nombre que
  // el cliente tiene seteado en su perfil de WhatsApp. Si por alguna razón
  // no viene, caemos al client_name (lo que dijo en conversación).
  const leadName =
    convo.name?.trim() || convo.client_name?.trim() || null;

  const data: LeadRowData = {
    Fecha: formatNocodbDateTime(convo.created_at),
    Numero: convo.phone,
    ConversationID: convo.id,
    Nombre: leadName,
    // El valor "Whatsapp" (con solo la W mayúscula) debe coincidir
    // EXACTAMENTE con la opción que se creó en la columna SingleSelect
    // de NocoDB. Si la cambiás en NocoDB, hay que actualizar acá también.
    Canal: "Whatsapp",
    Resumen: computeResumen(convo),
    Label: computeLabel(convo),
    "Enviado 1": "No",
    "Enviado 2": "No",
    "Enviado 3": "No",
    "Enviado 4": "No",
  };
  const rowId = await createLead(data);
  if (rowId) {
    setNocodbRowId(convo.id, rowId);
    if (data.Label) setNocodbLabel(convo.id, data.Label);
    if (data.Resumen) setNocodbResumen(convo.id, data.Resumen);
  }
  return rowId;
}

/**
 * Sincroniza el estado del lead a NocoDB. Crea la fila si no existe.
 * Solo PATCHea los campos que cambiaron respecto a lo último que pusheamos
 * (para no spamear updates innecesarios).
 *
 * Fire-and-forget — si NocoDB falla, loguea pero no rompe el flujo.
 */
export async function syncLeadStatus(conversationId: number): Promise<void> {
  const convo = getConversationById(conversationId);
  if (!convo) return;
  if (convo.channel === "test") {
    console.log(`[test] NocoDB suprimido para convo ${conversationId}`);
    return;
  }

  const rowId = await ensureLeadRow(convo);
  if (!rowId) return;

  const newLabel = computeLabel(convo);
  const newResumen = computeResumen(convo);
  // Push name de WhatsApp tiene prioridad para "Nombre" en NocoDB
  // (consistente con ensureLeadRow).
  const newName =
    convo.name?.trim() || convo.client_name?.trim() || null;

  const patch: Partial<LeadRowData> = {};
  if (newLabel !== convo.nocodb_label) patch.Label = newLabel;
  if (newResumen !== convo.nocodb_resumen) patch.Resumen = newResumen;
  if (newName) patch.Nombre = newName;

  if (Object.keys(patch).length === 0) return;

  const ok = await updateLead(rowId, patch);
  if (ok) {
    if (patch.Label) setNocodbLabel(convo.id, patch.Label);
    if (patch.Resumen) setNocodbResumen(convo.id, patch.Resumen);
  }
}

/**
 * Marca el seguimiento N (1-based, 1..4) como "Sí" en NocoDB.
 * Asegura la existencia de la fila si todavía no se creó.
 */
export async function markFollowupSent(
  conversationId: number,
  sequenceIndex1Based: number
): Promise<void> {
  if (sequenceIndex1Based < 1 || sequenceIndex1Based > 4) return;
  const convo = getConversationById(conversationId);
  if (!convo) return;
  if (convo.channel === "test") return;
  const rowId = await ensureLeadRow(convo);
  if (!rowId) return;

  const field = `Enviado ${sequenceIndex1Based}` as
    | "Enviado 1"
    | "Enviado 2"
    | "Enviado 3"
    | "Enviado 4";
  // "Si" sin tilde — NocoDB normalizó las opciones de SingleSelect a esa
  // forma. Si lo cambiás manualmente en NocoDB a "Sí" (con tilde),
  // tenés que actualizar este string también.
  await updateLead(rowId, { [field]: "Si" } as Partial<LeadRowData>);
}

/**
 * Borra la fila de NocoDB asociada a esta convo (si tiene rowId).
 * Lo llamamos ANTES de borrar la convo localmente desde la UI tipo
 * WhatsApp, para que el cascade funcione.
 */
export async function deleteLeadForConversation(
  conversationId: number
): Promise<void> {
  const convo = getConversationById(conversationId);
  if (convo?.channel === "test") return;
  if (!convo?.nocodb_row_id) return;
  await deleteLead(convo.nocodb_row_id);
}

/**
 * Sobreescribe el Resumen del lead con un texto generado por el LLM,
 * que tiene visibilidad del CONTENIDO concreto de la conversación
 * (lo que está preguntando, cómo se siente, etc.). Reemplaza al
 * Resumen heurístico basado solo en el state.
 *
 * Se llama desde handler.ts después de cada respuesta del LLM cuando
 * el modelo emitió un marcador <<RESUMEN: ...>>.
 */
export async function overrideResumenInNocodb(
  conversationId: number,
  resumen: string
): Promise<void> {
  const trimmed = resumen.trim().slice(0, 500);
  if (!trimmed) return;
  const convo = getConversationById(conversationId);
  if (convo?.channel === "test") return;
  if (!convo?.nocodb_row_id) return;
  if (trimmed === convo.nocodb_resumen) return;
  const ok = await updateLead(convo.nocodb_row_id, { Resumen: trimmed });
  if (ok) setNocodbResumen(conversationId, trimmed);
}
