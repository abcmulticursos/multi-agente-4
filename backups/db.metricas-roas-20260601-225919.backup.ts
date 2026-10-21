import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export type Mode = "AI" | "HUMAN";
export type Role = "user" | "assistant" | "human";
export type MediaType = "audio" | "image" | "video" | "document";
export type WaStatus = "sent" | "delivered" | "read" | "failed";
export type WorkflowState =
  | "new"
  | "awaiting_response"
  | "intro_running"
  | "intro_done"
  | "payment_done"
  | "payment_approved"
  | "awaiting_email"
  | "awaiting_gift_consent"
  | "awaiting_facebook_comment";

export interface ConversationRow {
  id: number;
  phone: string;
  name: string | null;
  mode: Mode;
  last_message_at: number | null;
  created_at: number;
  state: WorkflowState | null;
  client_name: string | null;
  client_email: string | null;
  paid_total_cents: number;
  /** unixepoch del momento en que el pago se APROBÓ (cruzó el monto del
   *  curso). NULL si todavía no compró. Solo de lectura para el panel de
   *  ventas — no interviene en el flujo del bot. */
  paid_at: number | null;
  /** Contador de comprobantes rechazados consecutivos. Se incrementa cada
   *  vez que executeRegisterPayment devuelve REJECTED y se resetea cuando
   *  hay APPROVED. Al alcanzar 3, dispara una notificación al admin. */
  payment_attempts_failed: number;
  /** 0 = precio normal; 1 = la convo entró a etapa de oferta (precio
   *  reducido). Se activa cuando arranca el seguimiento configurado en
   *  discount_after_followup. */
  discount_active: number;
  /** ID de la fila en NocoDB que representa este lead. NULL si todavía no
   *  se sincronizó (NocoDB no configurado o creación pendiente). */
  nocodb_row_id: string | null;
  /** Último valor de Label que pusheamos a NocoDB. Sirve para no PATCHear
   *  si no cambió. */
  nocodb_label: string | null;
  /** Último valor de Resumen pusheado. Misma idea que nocodb_label. */
  nocodb_resumen: string | null;
  /** 0 = sin emergencia; 1 = se invocó notify_admin_emergency al menos una
   *  vez. Define el label "reclamo" en NocoDB. */
  had_emergency: number;
  // Click-To-WhatsApp Ads attribution: capturados del primer mensaje del
  // cliente cuando viene de un anuncio. Permiten que Meta atribuya Contact
  // y Purchase events al anuncio específico que generó el click.
  ctwa_clid: string | null;
  ad_source_id: string | null;
  ad_source_url: string | null;
  ad_headline: string | null;
  /** 1 = conversación pineada al top de la lista. */
  pinned: number;
  /** unixepoch del momento en que se pineó (para ordenar las pineadas). */
  pinned_at: number | null;
  /** unixepoch hasta donde el operador leyó la conversación. */
  last_read_at: number;
  /** 1 = el operador la marcó manualmente como no leída (estilo WhatsApp:
   *  puntito verde sin número aunque no haya mensajes nuevos del cliente).
   *  Se limpia al marcarla como leída. */
  manually_unread: number;
  /** Indice 0-based del ULTIMO seguimiento disparado para esta convo:
   *  -1 = ninguno, 0 = seg 1, 1 = seg 2, 2 = seg 3.
   *  Usado por el sistema de slots: cuando llega un mensaje del cliente,
   *  si este indice es 0 o 1, se programa el seguimiento siguiente. */
  last_followup_index: number;
  /** Timestamp (unix sec) del ultimo seguimiento que arranco. Sirve como
   *  milestone para el check de engagement y para la regla min_gap del
   *  sistema de slots. 0 = ninguno aun. */
  last_followup_started_at: number;
}

export interface QuickReplyRow {
  id: number;
  shortcut: string | null;
  content: string;
  created_at: number;
}

export interface BlockedNumberRow {
  phone: string;
  reason: string | null;
  blocked_at: number;
}

export interface ScheduledActionRow {
  id: number;
  conversation_id: number;
  action_type: string;
  payload: string;
  run_at: number;
  status: "pending" | "completed" | "cancelled" | "failed";
  created_at: number;
}

export interface ConversationListRow extends ConversationRow {
  last_message_preview: string | null;
  /** Cantidad de mensajes del cliente sin leer (created_at > last_read_at). */
  unread_count: number;
}

export interface MessageRow {
  id: number;
  conversation_id: number;
  role: Role;
  content: string;
  wa_message_id: string | null;
  created_at: number;
  media_type: MediaType | null;
  media_url: string | null;
  media_mime: string | null;
  media_filename: string | null;
  transcription: string | null;
  duration_sec: number | null;
  /** Estado del mensaje saliente según los webhooks de Meta. Para mensajes
   *  entrantes (role='user') queda NULL — no se renderizan checks. */
  wa_status: WaStatus | null;
}

export interface MediaPayload {
  media_type: MediaType;
  media_url: string;
  media_mime: string;
  media_filename: string | null;
  transcription: string | null;
  duration_sec: number | null;
}

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "messages.db");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(DB_PATH);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT UNIQUE NOT NULL,
    name TEXT,
    mode TEXT CHECK(mode IN ('AI','HUMAN')) NOT NULL DEFAULT 'AI',
    last_message_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id),
    role TEXT CHECK(role IN ('user','assistant','human')) NOT NULL,
    content TEXT NOT NULL,
    wa_message_id TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE INDEX IF NOT EXISTS idx_messages_conv
    ON messages(conversation_id, created_at);

  CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_wa_id
    ON messages(wa_message_id) WHERE wa_message_id IS NOT NULL;

  CREATE TABLE IF NOT EXISTS processed_webhook_messages (
    wa_message_id TEXT PRIMARY KEY,
    processed_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
`);

// Migración idempotente: añadir columnas de media si no existen.
// SQLite lanza error si la columna ya existe — lo ignoramos.
const mediaColumns: Array<[string, string]> = [
  ["media_type", "TEXT"],
  ["media_url", "TEXT"],
  ["media_mime", "TEXT"],
  ["media_filename", "TEXT"],
  ["transcription", "TEXT"],
  ["duration_sec", "INTEGER"],
  // Estado WhatsApp del mensaje saliente: sent / delivered / read / failed.
  // NULL para mensajes entrantes.
  ["wa_status", "TEXT"],
];
for (const [name, type] of mediaColumns) {
  try {
    db.exec(`ALTER TABLE messages ADD COLUMN ${name} ${type}`);
  } catch {
    // ya existe, no pasa nada
  }
}

const conversationColumns: Array<[string, string]> = [
  ["state", "TEXT"],
  ["client_name", "TEXT"],
  ["client_email", "TEXT"],
  ["paid_total_cents", "INTEGER NOT NULL DEFAULT 0"],
  // Fecha (unixepoch) en que el pago se aprobó. Para el panel de ventas
  // (filtro por fechas + sumas de dinero). NULL = aún no compró.
  ["paid_at", "INTEGER"],
  ["ctwa_clid", "TEXT"],
  ["ad_source_id", "TEXT"],
  ["ad_source_url", "TEXT"],
  ["ad_headline", "TEXT"],
  ["payment_attempts_failed", "INTEGER NOT NULL DEFAULT 0"],
  ["discount_active", "INTEGER NOT NULL DEFAULT 0"],
  ["nocodb_row_id", "TEXT"],
  ["nocodb_label", "TEXT"],
  ["nocodb_resumen", "TEXT"],
  ["had_emergency", "INTEGER NOT NULL DEFAULT 0"],
  // Pinear conversaciones al top de la lista.
  ["pinned", "INTEGER NOT NULL DEFAULT 0"],
  ["pinned_at", "INTEGER"],
  // Indicador de no leídos: unixepoch hasta el cual el operador "leyó"
  // la conversación. Un mensaje del cliente con created_at > last_read_at
  // cuenta como no leído.
  ["last_read_at", "INTEGER NOT NULL DEFAULT 0"],
  // Flag de "marcado manual como no leído" estilo WhatsApp: cuando el
  // operador clickea el botón "marcar como no leído" sin que haya
  // mensajes nuevos del cliente, esto vale 1 y la UI muestra un puntito
  // verde sin número. Se limpia al marcar como leído.
  ["manually_unread", "INTEGER NOT NULL DEFAULT 0"],
  // Timestamp (unix sec) del ULTIMO seguimiento que disparo para esta
  // convo. Sirve como "milestone" para el check de engagement: antes de
  // disparar un seguimiento, verificamos si el cliente respondio DESDE
  // el ultimo milestone. Si esta silencioso, cancelamos el seguimiento
  // para no insistir y reducir bloqueos.
  // Si es 0, usamos conversations.created_at (T0) como referencia.
  ["last_followup_started_at", "INTEGER NOT NULL DEFAULT 0"],
  // Indice 0-based del ultimo seguimiento disparado (-1 = ninguno aun).
  // Sirve para que cuando llegue un mensaje del cliente, sepamos si toca
  // programar seg 2 o seg 3.
  ["last_followup_index", "INTEGER NOT NULL DEFAULT -1"],
];
for (const [name, type] of conversationColumns) {
  try {
    db.exec(`ALTER TABLE conversations ADD COLUMN ${name} ${type}`);
  } catch {
    // ya existe
  }
}

db.exec(`
  CREATE TABLE IF NOT EXISTS scheduled_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    action_type TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}',
    run_at INTEGER NOT NULL,
    status TEXT CHECK(status IN ('pending','completed','cancelled','failed')) NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_scheduled_due
    ON scheduled_actions(status, run_at);
  CREATE INDEX IF NOT EXISTS idx_scheduled_convo
    ON scheduled_actions(conversation_id, status);

  CREATE TABLE IF NOT EXISTS quick_replies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shortcut TEXT,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS blocked_numbers (
    phone TEXT PRIMARY KEY,
    reason TEXT,
    blocked_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
`);

// Limpieza one-shot del bug de SQL en stmtUpdateMsgStatus: por falta de
// parentesis, un solo webhook 'failed' marcaba TODA la tabla messages como
// failed. user_version garantiza que esto corre una sola vez aunque se
// reinicie el proceso.
{
  const currentVersion = db.pragma("user_version", { simple: true }) as number;
  if (currentVersion < 1) {
    const cleared = db
      .prepare("UPDATE messages SET wa_status = NULL WHERE wa_status = 'failed'")
      .run();
    console.log(
      `[db] limpieza wa_status corrupto: ${cleared.changes} mensajes reseteados`
    );
    db.pragma("user_version = 1");
  }
}

const stmtGetConvoByPhone = db.prepare<[string], ConversationRow>(
  "SELECT * FROM conversations WHERE phone = ?"
);
const stmtInsertConvo = db.prepare<[string, string | null]>(
  "INSERT INTO conversations (phone, name, state) VALUES (?, ?, 'new')"
);
const stmtUpdateConvoName = db.prepare<[string, number]>(
  "UPDATE conversations SET name = ? WHERE id = ?"
);
const stmtGetConvoById = db.prepare<[number], ConversationRow>(
  "SELECT * FROM conversations WHERE id = ?"
);
const stmtInsertMessage = db.prepare<[number, Role, string, string | null]>(
  "INSERT INTO messages (conversation_id, role, content, wa_message_id) VALUES (?, ?, ?, ?)"
);
const stmtInsertMessageWithMedia = db.prepare<
  [
    number,
    Role,
    string,
    string | null,
    MediaType,
    string,
    string,
    string | null,
    string | null,
    number | null
  ]
>(
  `INSERT INTO messages
    (conversation_id, role, content, wa_message_id,
     media_type, media_url, media_mime, media_filename, transcription, duration_sec)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
const stmtTouchConvo = db.prepare<[number, number]>(
  "UPDATE conversations SET last_message_at = ? WHERE id = ?"
);
const stmtUpdateMsgWaId = db.prepare<[string, number]>(
  "UPDATE messages SET wa_message_id = ?, wa_status = 'sent' WHERE id = ?"
);
// Actualiza el estado de un mensaje saliente de forma monotónica:
// failed > read > delivered > sent > null. Así un 'delivered' tardío
// nunca pisa un 'read' que ya llegó. 'failed' siempre gana porque es
// terminal y accionable.
const stmtUpdateMsgStatus = db.prepare<[WaStatus, string, WaStatus, WaStatus]>(
  `UPDATE messages
      SET wa_status = ?
    WHERE wa_message_id = ?
      AND (
        COALESCE(
          CASE wa_status
            WHEN 'failed' THEN 99
            WHEN 'read' THEN 3
            WHEN 'delivered' THEN 2
            WHEN 'sent' THEN 1
            ELSE 0
          END, 0
        ) < CASE ?
          WHEN 'failed' THEN 99
          WHEN 'read' THEN 3
          WHEN 'delivered' THEN 2
          WHEN 'sent' THEN 1
          ELSE 0
        END
        OR ? = 'failed'
      )`
);
const stmtGetMessages = db.prepare<[number, number], MessageRow>(
  "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, id ASC LIMIT ?"
);
const stmtGetMessageById = db.prepare<[number], MessageRow>(
  "SELECT * FROM messages WHERE id = ?"
);
const stmtGetRecentDesc = db.prepare<[number, number], MessageRow>(
  "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC, id DESC LIMIT ?"
);
const stmtSetMode = db.prepare<[Mode, number]>(
  "UPDATE conversations SET mode = ? WHERE id = ?"
);
const stmtListConvos = db.prepare<[], ConversationListRow>(`
  SELECT c.*,
    (SELECT m.content FROM messages m
       WHERE m.conversation_id = c.id
       ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_message_preview,
    (SELECT COUNT(*) FROM messages m
       WHERE m.conversation_id = c.id
         AND m.role = 'user'
         AND m.created_at > c.last_read_at) AS unread_count
  FROM conversations c
  ORDER BY
    c.pinned DESC,
    CASE WHEN c.pinned = 1 THEN c.pinned_at ELSE COALESCE(c.last_message_at, c.created_at) END DESC
`);
const stmtDeleteMessages = db.prepare<[number]>(
  "DELETE FROM messages WHERE conversation_id = ?"
);
const stmtDeleteConvo = db.prepare<[number]>(
  "DELETE FROM conversations WHERE id = ?"
);
const stmtIsProcessed = db.prepare<[string], { wa_message_id: string }>(
  "SELECT wa_message_id FROM processed_webhook_messages WHERE wa_message_id = ?"
);
const stmtMarkProcessed = db.prepare<[string]>(
  "INSERT OR IGNORE INTO processed_webhook_messages (wa_message_id) VALUES (?)"
);

export function getOrCreateConversation(
  phone: string,
  name?: string | null
): ConversationRow {
  const existing = stmtGetConvoByPhone.get(phone);
  if (existing) {
    if (name && existing.name !== name) {
      stmtUpdateConvoName.run(name, existing.id);
      existing.name = name;
    }
    return existing;
  }
  const info = stmtInsertConvo.run(phone, name ?? null);
  const created = stmtGetConvoById.get(Number(info.lastInsertRowid));
  if (!created) throw new Error("No se pudo crear la conversación");
  return created;
}

export function getConversationById(id: number): ConversationRow | undefined {
  return stmtGetConvoById.get(id);
}

const insertMessageTx = db.transaction(
  (
    conversationId: number,
    role: Role,
    content: string,
    waMessageId: string | null
  ): number => {
    const info = stmtInsertMessage.run(conversationId, role, content, waMessageId);
    stmtTouchConvo.run(Math.floor(Date.now() / 1000), conversationId);
    return Number(info.lastInsertRowid);
  }
);

const insertMessageWithMediaTx = db.transaction(
  (
    conversationId: number,
    role: Role,
    content: string,
    waMessageId: string | null,
    media: MediaPayload
  ): number => {
    const info = stmtInsertMessageWithMedia.run(
      conversationId,
      role,
      content,
      waMessageId,
      media.media_type,
      media.media_url,
      media.media_mime,
      media.media_filename,
      media.transcription,
      media.duration_sec
    );
    stmtTouchConvo.run(Math.floor(Date.now() / 1000), conversationId);
    return Number(info.lastInsertRowid);
  }
);

export function insertMessage(
  conversationId: number,
  role: Role,
  content: string,
  waMessageId?: string | null
): number {
  return insertMessageTx(conversationId, role, content, waMessageId ?? null);
}

export function insertMessageWithMedia(
  conversationId: number,
  role: Role,
  content: string,
  waMessageId: string | null,
  media: MediaPayload
): number {
  return insertMessageWithMediaTx(
    conversationId,
    role,
    content,
    waMessageId,
    media
  );
}

export function updateMessageWaId(messageId: number, waMessageId: string): void {
  stmtUpdateMsgWaId.run(waMessageId, messageId);
}

/**
 * Actualiza el estado de entrega de un mensaje saliente a partir del
 * wa_message_id que viene en el webhook de status de Meta. La query es
 * monotónica — no pisa estados más avanzados con estados más viejos.
 */
export function updateMessageStatus(
  waMessageId: string,
  status: WaStatus
): void {
  stmtUpdateMsgStatus.run(status, waMessageId, status, status);
}

export function getMessages(conversationId: number, limit = 50): MessageRow[] {
  return stmtGetMessages.all(conversationId, limit);
}

export function getMessageById(id: number): MessageRow | undefined {
  return stmtGetMessageById.get(id);
}

export function getRecentHistory(
  conversationId: number,
  limit = 20
): MessageRow[] {
  const desc = stmtGetRecentDesc.all(conversationId, limit);
  return desc.reverse();
}

export function setMode(conversationId: number, mode: Mode): void {
  stmtSetMode.run(mode, conversationId);
}

export function listConversations(): ConversationListRow[] {
  return stmtListConvos.all();
}

const stmtGetMessageMediaUrlsForConvo = db.prepare<
  [number],
  { media_url: string }
>(
  "SELECT media_url FROM messages WHERE conversation_id = ? AND media_url IS NOT NULL"
);

/**
 * Resuelve un rel_path (relativo a data/) a ruta absoluta. Igual que
 * resolveMediaAbsPath en meta/media.ts pero inlineado para evitar import
 * circular hacia ese módulo.
 */
function resolveMediaPathLocal(relPath: string): string | null {
  const normalized = path.normalize(relPath).replace(/^([/\\])+/, "");
  if (normalized.startsWith("..")) return null;
  return path.join(DATA_DIR, normalized);
}

/**
 * Borra de disco los archivos referenciados en una lista de media_urls.
 * SALTA los que están en `cache/...` porque esos son templates compartidos
 * (videos/audios de Drive) que sirven a TODAS las conversaciones.
 */
function deleteFilesForMediaUrls(urls: string[]): void {
  let deleted = 0;
  let skipped = 0;
  for (const relPath of urls) {
    if (!relPath) continue;
    if (relPath.startsWith("cache/") || relPath.startsWith("cache\\")) {
      skipped++;
      continue;
    }
    const absPath = resolveMediaPathLocal(relPath);
    if (!absPath) continue;
    try {
      if (fs.existsSync(absPath)) {
        fs.unlinkSync(absPath);
        deleted++;
      }
    } catch (err) {
      console.error(`[db] no se pudo borrar ${absPath}:`, err);
    }
  }
  if (deleted + skipped > 0) {
    console.log(
      `[db] limpieza media: ${deleted} archivos eliminados, ${skipped} templates preservados`
    );
  }
}

const deleteConversationDbTx = db.transaction((id: number) => {
  stmtDeleteMessages.run(id);
  stmtDeleteConvo.run(id);
});

export function deleteConversation(id: number): void {
  // Leer URLs ANTES de borrar las filas, sino se pierden.
  const urls = stmtGetMessageMediaUrlsForConvo
    .all(id)
    .map((r) => r.media_url);
  deleteConversationDbTx(id);
  deleteFilesForMediaUrls(urls);
}

// ─── Autopurga de conversaciones inactivas ───────────────────────────────
// Selecciona conversaciones SIN actividad desde antes del cutoff, EXCLUYENDO
// a cualquiera que haya comprado. La exclusión es doble (cinturón + tirantes):
//   1) paid_total_cents = 0  → nunca registró un pago.
//   2) state NO está en los estados post-compra.
// Así un comprador JAMÁS entra en la purga, pase lo que pase.
export interface StaleConversation {
  id: number;
  name: string | null;
  phone: string;
  last_message_at: number | null;
  created_at: number;
}

const stmtStaleConversations = db.prepare<[number], StaleConversation>(
  `SELECT id, name, phone, last_message_at, created_at
     FROM conversations
    WHERE COALESCE(last_message_at, created_at) < ?
      AND paid_total_cents = 0
      AND (
        state IS NULL
        OR state NOT IN (
          'payment_approved',
          'awaiting_email',
          'awaiting_gift_consent',
          'awaiting_facebook_comment'
        )
      )
    ORDER BY COALESCE(last_message_at, created_at) ASC`
);

/** Conversaciones candidatas a purga: inactivas desde antes de cutoffUnix y
 *  que NO son compradores. NO borra nada — solo las lista. */
export function getStaleConversations(cutoffUnix: number): StaleConversation[] {
  return stmtStaleConversations.all(cutoffUnix);
}

export function wasMessageProcessed(waMessageId: string): boolean {
  return stmtIsProcessed.get(waMessageId) !== undefined;
}

export function markMessageProcessed(waMessageId: string): void {
  stmtMarkProcessed.run(waMessageId);
}

// ─── Workflow / scheduled actions ────────────────────────────────────────────

const stmtSetState = db.prepare<[string, number]>(
  "UPDATE conversations SET state = ? WHERE id = ?"
);
const stmtSetClientName = db.prepare<[string, number]>(
  "UPDATE conversations SET client_name = ? WHERE id = ?"
);
const stmtCountMessages = db.prepare<[number], { c: number }>(
  "SELECT COUNT(*) AS c FROM messages WHERE conversation_id = ?"
);
const stmtInsertScheduled = db.prepare<
  [number, string, string, number]
>(
  "INSERT INTO scheduled_actions (conversation_id, action_type, payload, run_at) VALUES (?, ?, ?, ?)"
);
const stmtGetDueActions = db.prepare<[number, number], ScheduledActionRow>(
  "SELECT * FROM scheduled_actions WHERE status = 'pending' AND run_at <= ? ORDER BY run_at ASC LIMIT ?"
);
const stmtMarkActionStatus = db.prepare<[string, number]>(
  "UPDATE scheduled_actions SET status = ? WHERE id = ?"
);
const stmtCancelPendingForConvo = db.prepare<[number]>(
  "UPDATE scheduled_actions SET status = 'cancelled' WHERE conversation_id = ? AND status = 'pending'"
);
const stmtCancelPendingByTypeForConvo = db.prepare<[number, string]>(
  "UPDATE scheduled_actions SET status = 'cancelled' WHERE conversation_id = ? AND action_type = ? AND status = 'pending'"
);
const stmtCountPendingActionTypeForConvo = db.prepare<
  [number, string],
  { c: number }
>(
  "SELECT COUNT(*) AS c FROM scheduled_actions WHERE conversation_id = ? AND action_type = ? AND status = 'pending'"
);
const stmtCountFuturePendingActionTypeForConvo = db.prepare<
  [number, string, number],
  { c: number }
>(
  "SELECT COUNT(*) AS c FROM scheduled_actions WHERE conversation_id = ? AND action_type = ? AND status = 'pending' AND run_at > ?"
);
// Para backfill: convos que ya dispararon algun seguimiento (index >= 0) y
// aun no completaron toda la cadena (index < total - 1). El estado lo filtra
// el caller — aqui solo damos el universo de candidatos.
const stmtConvosForFollowupBackfill = db.prepare<[number], ConversationRow>(
  "SELECT * FROM conversations WHERE last_followup_index >= 0 AND last_followup_index < ?"
);
export function getConversationsForFollowupBackfill(
  maxIndexExclusive: number
): ConversationRow[] {
  return stmtConvosForFollowupBackfill.all(maxIndexExclusive);
}

export function setConversationState(
  conversationId: number,
  state: WorkflowState
): void {
  stmtSetState.run(state, conversationId);
}

export function setClientName(conversationId: number, name: string): void {
  stmtSetClientName.run(name, conversationId);
}

const stmtClearClientName = db.prepare<[number]>(
  "UPDATE conversations SET client_name = NULL WHERE id = ?"
);
export function clearClientName(conversationId: number): void {
  stmtClearClientName.run(conversationId);
}

const stmtSetClientEmail = db.prepare<[string, number]>(
  "UPDATE conversations SET client_email = ? WHERE id = ?"
);
export function setClientEmail(conversationId: number, email: string): void {
  stmtSetClientEmail.run(email, conversationId);
}

const stmtClearClientEmail = db.prepare<[number]>(
  "UPDATE conversations SET client_email = NULL WHERE id = ?"
);
export function clearClientEmail(conversationId: number): void {
  stmtClearClientEmail.run(conversationId);
}

const stmtSetAdReferral = db.prepare<
  [string, string | null, string | null, string | null, number]
>(
  `UPDATE conversations
     SET ctwa_clid = ?, ad_source_id = ?, ad_source_url = ?, ad_headline = ?
   WHERE id = ? AND ctwa_clid IS NULL`
);

/**
 * Guarda la atribución del anuncio que generó este chat. Solo escribe si
 * todavía no hay ctwa_clid — así un cliente recurrente no pierde la
 * atribución original si vuelve a darle click a otro anuncio.
 */
export function setConversationAdReferral(
  conversationId: number,
  ctwaClid: string,
  sourceId: string | null,
  sourceUrl: string | null,
  headline: string | null
): void {
  stmtSetAdReferral.run(
    ctwaClid,
    sourceId,
    sourceUrl,
    headline,
    conversationId
  );
}

const stmtDeleteAllMessages = db.prepare<[number]>(
  "DELETE FROM messages WHERE conversation_id = ?"
);
export function deleteAllMessages(conversationId: number): void {
  // Leer URLs antes de borrar para luego limpiar de disco.
  const urls = stmtGetMessageMediaUrlsForConvo
    .all(conversationId)
    .map((r) => r.media_url);
  stmtDeleteAllMessages.run(conversationId);
  deleteFilesForMediaUrls(urls);
}

const stmtAddToPaidTotal = db.prepare<[number, number]>(
  "UPDATE conversations SET paid_total_cents = paid_total_cents + ? WHERE id = ?"
);
const stmtResetPaidTotal = db.prepare<[number]>(
  "UPDATE conversations SET paid_total_cents = 0 WHERE id = ?"
);
const stmtGetPaidTotal = db.prepare<[number], { paid_total_cents: number }>(
  "SELECT paid_total_cents FROM conversations WHERE id = ?"
);

export function addToPaidTotal(conversationId: number, cents: number): number {
  stmtAddToPaidTotal.run(cents, conversationId);
  return stmtGetPaidTotal.get(conversationId)?.paid_total_cents ?? 0;
}

export function getPaidTotal(conversationId: number): number {
  return stmtGetPaidTotal.get(conversationId)?.paid_total_cents ?? 0;
}

export function resetPaidTotal(conversationId: number): void {
  stmtResetPaidTotal.run(conversationId);
}

// Sello de fecha del pago aprobado (solo lectura para el panel de ventas).
// Aditivo: no interviene en ninguna lógica del bot.
const stmtSetPaidAt = db.prepare<[number, number]>(
  "UPDATE conversations SET paid_at = ? WHERE id = ?"
);

/** Graba el unixepoch en que se aprobó el pago. Idempotente en la práctica
 *  porque solo se llama una vez, al cruzar el monto del curso. */
export function setPaidAt(conversationId: number, unixSec: number): void {
  stmtSetPaidAt.run(unixSec, conversationId);
}

const stmtIncrPaymentAttemptsFailed = db.prepare<[number]>(
  "UPDATE conversations SET payment_attempts_failed = payment_attempts_failed + 1 WHERE id = ?"
);
const stmtGetPaymentAttemptsFailed = db.prepare<
  [number],
  { payment_attempts_failed: number }
>("SELECT payment_attempts_failed FROM conversations WHERE id = ?");
const stmtResetPaymentAttemptsFailed = db.prepare<[number]>(
  "UPDATE conversations SET payment_attempts_failed = 0 WHERE id = ?"
);

export function incrementPaymentAttemptsFailed(
  conversationId: number
): number {
  stmtIncrPaymentAttemptsFailed.run(conversationId);
  return (
    stmtGetPaymentAttemptsFailed.get(conversationId)?.payment_attempts_failed ??
    0
  );
}

export function resetPaymentAttemptsFailed(conversationId: number): void {
  stmtResetPaymentAttemptsFailed.run(conversationId);
}

const stmtActivateDiscount = db.prepare<[number]>(
  "UPDATE conversations SET discount_active = 1 WHERE id = ?"
);
const stmtDeactivateDiscount = db.prepare<[number]>(
  "UPDATE conversations SET discount_active = 0 WHERE id = ?"
);

export function activateDiscount(conversationId: number): void {
  stmtActivateDiscount.run(conversationId);
}

/** Solo se usa en /restart para limpiar la oferta. */
export function deactivateDiscount(conversationId: number): void {
  stmtDeactivateDiscount.run(conversationId);
}

// ─── NocoDB sync helpers ─────────────────────────────────────────────────

const stmtSetNocodbRowId = db.prepare<[string | null, number]>(
  "UPDATE conversations SET nocodb_row_id = ? WHERE id = ?"
);
const stmtSetNocodbLabel = db.prepare<[string, number]>(
  "UPDATE conversations SET nocodb_label = ? WHERE id = ?"
);
const stmtSetNocodbResumen = db.prepare<[string, number]>(
  "UPDATE conversations SET nocodb_resumen = ? WHERE id = ?"
);
const stmtMarkHadEmergency = db.prepare<[number]>(
  "UPDATE conversations SET had_emergency = 1 WHERE id = ?"
);
const stmtGetConvoByNocodbRowId = db.prepare<[string], ConversationRow>(
  "SELECT * FROM conversations WHERE nocodb_row_id = ?"
);
const stmtCountUserMessages = db.prepare<[number], { c: number }>(
  "SELECT COUNT(*) AS c FROM messages WHERE conversation_id = ? AND role = 'user'"
);

export function setNocodbRowId(
  conversationId: number,
  rowId: string | null
): void {
  stmtSetNocodbRowId.run(rowId, conversationId);
}

export function setNocodbLabel(conversationId: number, label: string): void {
  stmtSetNocodbLabel.run(label, conversationId);
}

export function setNocodbResumen(conversationId: number, resumen: string): void {
  stmtSetNocodbResumen.run(resumen, conversationId);
}

export function markHadEmergency(conversationId: number): void {
  stmtMarkHadEmergency.run(conversationId);
}

export function getConversationByNocodbRowId(
  rowId: string
): ConversationRow | undefined {
  return stmtGetConvoByNocodbRowId.get(rowId);
}

export function countUserMessages(conversationId: number): number {
  return stmtCountUserMessages.get(conversationId)?.c ?? 0;
}

const stmtGetLatestUserMessage = db.prepare<[number], MessageRow>(
  "SELECT * FROM messages WHERE conversation_id = ? AND role = 'user' ORDER BY created_at DESC, id DESC LIMIT 1"
);

/**
 * Devuelve el último mensaje del cliente (rol 'user') en la convo, o
 * undefined si no hay ninguno. Lo usa el guardarail anti-alucinación
 * de pago: solo permitimos register_payment_amount si el último mensaje
 * trae media_type === 'image'.
 */
export function getLatestUserMessage(
  conversationId: number
): MessageRow | undefined {
  return stmtGetLatestUserMessage.get(conversationId);
}

const stmtGetRecentUserMessages = db.prepare<[number, number], MessageRow>(
  "SELECT * FROM messages WHERE conversation_id = ? AND role = 'user' ORDER BY created_at DESC, id DESC LIMIT ?"
);

/**
 * Devuelve los últimos N mensajes del cliente (rol 'user'), del más
 * reciente al más viejo. Lo usa el guardarail tolerante de pago:
 * si la imagen está en cualquiera de los últimos N mensajes (no solo
 * el más reciente), se considera válida — esto cubre el caso de cliente
 * que manda imagen + texto, o que manda "?" tras esperar respuesta.
 */
export function getRecentUserMessages(
  conversationId: number,
  limit: number
): MessageRow[] {
  return stmtGetRecentUserMessages.all(conversationId, limit);
}

const stmtClearNocodbSync = db.prepare<[number]>(
  `UPDATE conversations
     SET nocodb_row_id = NULL,
         nocodb_label = NULL,
         nocodb_resumen = NULL,
         had_emergency = 0
   WHERE id = ?`
);

/**
 * Limpia toda la metadata de sync con NocoDB para esta convo. Lo llama
 * /restart después de eliminar la fila remota — así el próximo mensaje
 * crea una fila fresca en NocoDB en vez de actualizar la vieja.
 */
export function clearNocodbSync(conversationId: number): void {
  stmtClearNocodbSync.run(conversationId);
}

export function countMessages(conversationId: number): number {
  const r = stmtCountMessages.get(conversationId);
  return r?.c ?? 0;
}

export function scheduleAction(
  conversationId: number,
  actionType: string,
  payload: Record<string, unknown>,
  runAtUnix: number
): number {
  const info = stmtInsertScheduled.run(
    conversationId,
    actionType,
    JSON.stringify(payload),
    runAtUnix
  );
  return Number(info.lastInsertRowid);
}

export function getDueActions(
  nowUnix: number,
  limit = 50
): ScheduledActionRow[] {
  return stmtGetDueActions.all(nowUnix, limit);
}

export function markActionCompleted(id: number): void {
  stmtMarkActionStatus.run("completed", id);
}

export function markActionFailed(id: number): void {
  stmtMarkActionStatus.run("failed", id);
}

export function cancelPendingActionsForConvo(conversationId: number): void {
  stmtCancelPendingForConvo.run(conversationId);
}

export function cancelPendingActionsByTypeForConvo(
  conversationId: number,
  actionType: string
): void {
  stmtCancelPendingByTypeForConvo.run(conversationId, actionType);
}

export function hasPendingActionType(
  conversationId: number,
  actionType: string
): boolean {
  const r = stmtCountPendingActionTypeForConvo.get(conversationId, actionType);
  return (r?.c ?? 0) > 0;
}

/**
 * Igual que hasPendingActionType pero solo cuenta acciones cuya `run_at`
 * es ESTRICTAMENTE futura. Util para idempotencia desde DENTRO del handler
 * de una accion que se esta ejecutando: la accion en curso todavia esta
 * en status='pending' hasta que el worker llame markActionCompleted, asi
 * que hasPendingActionType la encontraria a si misma y devolveria true.
 * Filtrando por run_at > now la excluimos (la accion en curso tiene
 * run_at <= now porque ya estaba vencida).
 */
export function hasFuturePendingActionType(
  conversationId: number,
  actionType: string,
  nowSec: number
): boolean {
  const r = stmtCountFuturePendingActionTypeForConvo.get(
    conversationId,
    actionType,
    nowSec
  );
  return (r?.c ?? 0) > 0;
}

const stmtShiftPendingActionsByType = db.prepare<[number, number, string, number]>(
  `UPDATE scheduled_actions
      SET run_at = run_at + ?
    WHERE conversation_id = ?
      AND status = 'pending'
      AND action_type = ?
      AND run_at > ?`
);

/**
 * Desplaza hacia adelante (en deltaSec segundos) todas las acciones pendientes
 * de un tipo dado para una conversacion que esten programadas despues de
 * afterUnixSec. Usado por el sistema de horario silencioso: cuando un
 * seguimiento se pospone por caer en madrugada, los siguientes seguimientos
 * de la misma convo deben desplazarse el mismo delta para preservar los gaps.
 */
export function shiftPendingActionsByType(
  conversationId: number,
  actionType: string,
  deltaSec: number,
  afterUnixSec: number
): number {
  const info = stmtShiftPendingActionsByType.run(
    deltaSec,
    conversationId,
    actionType,
    afterUnixSec
  );
  return info.changes;
}

const stmtMaxPendingActionRunAt = db.prepare<
  [string, number],
  { max_run_at: number | null }
>(
  `SELECT MAX(run_at) AS max_run_at
     FROM scheduled_actions
    WHERE status = 'pending'
      AND action_type = ?
      AND run_at >= ?`
);

/**
 * Devuelve el ultimo run_at programado para un tipo de accion en la cola
 * de despertar (acciones pendientes con run_at >= baseUnixSec). Usado por
 * el spacing aleatorio de la cola del amanecer: cuando un seguimiento se
 * difiere a la mañana siguiente, ocupa el siguiente slot disponible (last
 * slot + random 45-75s). Devuelve null si la cola esta vacia.
 */
export function getLatestPendingActionSlot(
  actionType: string,
  baseUnixSec: number
): number | null {
  const r = stmtMaxPendingActionRunAt.get(actionType, baseUnixSec);
  return r?.max_run_at ?? null;
}

const stmtLastUserMessageTime = db.prepare<
  [number],
  { last_at: number | null }
>(
  `SELECT MAX(created_at) AS last_at
     FROM messages
    WHERE conversation_id = ? AND role = 'user'`
);

/**
 * Devuelve el unix timestamp del mensaje mas reciente del cliente para
 * esta convo, o null si no hay mensajes del cliente. Usado por el check
 * proactivo de ventana 24h de Meta: si pasaron mas de 23h53m desde el
 * ultimo mensaje del cliente, cancelamos el seguimiento sin llamar a la
 * Meta API (porque sabemos que va a fallar con error 131047).
 */
export function getLastUserMessageTime(conversationId: number): number | null {
  const r = stmtLastUserMessageTime.get(conversationId);
  return r?.last_at ?? null;
}

const stmtSetLastFollowupStarted = db.prepare<[number, number]>(
  "UPDATE conversations SET last_followup_started_at = ? WHERE id = ?"
);

/**
 * Marca el timestamp en que se dispara un seguimiento. Usado como
 * milestone para el check de engagement en seguimientos posteriores.
 */
export function setLastFollowupStartedAt(
  conversationId: number,
  unixSec: number
): void {
  stmtSetLastFollowupStarted.run(unixSec, conversationId);
}

const stmtSetLastFollowupIndex = db.prepare<[number, number]>(
  "UPDATE conversations SET last_followup_index = ? WHERE id = ?"
);

/**
 * Marca el indice 0-based del ultimo seguimiento disparado. -1 reset.
 * Llamado al ejecutar el ultimo step de cada secuencia de seguimiento.
 */
export function setLastFollowupIndex(
  conversationId: number,
  index: number
): void {
  stmtSetLastFollowupIndex.run(index, conversationId);
}

const stmtResetFollowupTracking = db.prepare<[number]>(
  `UPDATE conversations
     SET last_followup_index = -1,
         last_followup_started_at = 0
   WHERE id = ?`
);

/** Resetea el tracking de seguimientos (indice + milestone). Lo usa
 *  /restart. */
export function resetFollowupTracking(conversationId: number): void {
  stmtResetFollowupTracking.run(conversationId);
}

const stmtCountPendingActionsInWindow = db.prepare<
  [string, number, number],
  { c: number }
>(
  `SELECT COUNT(*) AS c
     FROM scheduled_actions
    WHERE status = 'pending'
      AND action_type = ?
      AND run_at >= ?
      AND run_at < ?`
);

/**
 * Cuenta cuantas acciones pendientes de un tipo existen con run_at
 * dentro de [fromUnixSec, toUnixSec). Usado por la cola anti-rafaga de
 * seguimientos: cuando programamos un nuevo start_followup para un slot,
 * miramos cuantos ya estan agendados en la ventana de ese slot para
 * elegir la siguiente posicion en la cola.
 */
export function countPendingActionsInWindow(
  actionType: string,
  fromUnixSec: number,
  toUnixSec: number
): number {
  const r = stmtCountPendingActionsInWindow.get(
    actionType,
    fromUnixSec,
    toUnixSec
  );
  return r?.c ?? 0;
}

const stmtHasUserMessageSinceFollowupStart = db.prepare<
  [number, number],
  { c: number }
>(
  `SELECT COUNT(*) AS c
     FROM messages
    WHERE conversation_id = ?
      AND role = 'user'
      AND created_at > (
        SELECT MAX(created_at, COALESCE(last_followup_started_at, 0))
        FROM conversations
        WHERE id = ?
      )`
);

/**
 * Check de engagement: devuelve true si el cliente envio algun mensaje
 * DESPUES del ultimo milestone (intro_data si no hay seguimientos, o
 * el ultimo seguimiento que disparo).
 *
 * Usado para cancelar seguimientos cuando el cliente esta silencioso —
 * si no respondio desde la ultima vez que el bot le envio una secuencia
 * scripted, no insistimos (evita bloqueos y baja calidad).
 *
 * Compara contra MAX(conversations.created_at, last_followup_started_at)
 * para que la T0 (primer mensaje del cliente) NO cuente como engagement
 * — se requiere un segundo mensaje del cliente para activar el seguimiento.
 */
export function hasUserMessageSinceFollowupStart(
  conversationId: number
): boolean {
  const r = stmtHasUserMessageSinceFollowupStart.get(
    conversationId,
    conversationId
  );
  return (r?.c ?? 0) > 0;
}

// ─── Respuestas rápidas (quick replies) ──────────────────────────────────

const stmtListQuickReplies = db.prepare<[], QuickReplyRow>(
  "SELECT * FROM quick_replies ORDER BY created_at ASC"
);
const stmtGetQuickReplyById = db.prepare<[number], QuickReplyRow>(
  "SELECT * FROM quick_replies WHERE id = ?"
);
const stmtInsertQuickReply = db.prepare<[string | null, string]>(
  "INSERT INTO quick_replies (shortcut, content) VALUES (?, ?)"
);
const stmtUpdateQuickReply = db.prepare<[string | null, string, number]>(
  "UPDATE quick_replies SET shortcut = ?, content = ? WHERE id = ?"
);
const stmtDeleteQuickReply = db.prepare<[number]>(
  "DELETE FROM quick_replies WHERE id = ?"
);

export function listQuickReplies(): QuickReplyRow[] {
  return stmtListQuickReplies.all();
}

export function createQuickReply(
  shortcut: string | null,
  content: string
): QuickReplyRow {
  const info = stmtInsertQuickReply.run(shortcut, content);
  const row = stmtGetQuickReplyById.get(Number(info.lastInsertRowid));
  if (!row) throw new Error("No se pudo crear la respuesta rápida");
  return row;
}

export function updateQuickReply(
  id: number,
  shortcut: string | null,
  content: string
): boolean {
  const info = stmtUpdateQuickReply.run(shortcut, content, id);
  return info.changes > 0;
}

export function deleteQuickReply(id: number): boolean {
  const info = stmtDeleteQuickReply.run(id);
  return info.changes > 0;
}

// ─── Números bloqueados (blacklist) ──────────────────────────────────────

const stmtListBlockedNumbers = db.prepare<[], BlockedNumberRow>(
  "SELECT * FROM blocked_numbers ORDER BY blocked_at DESC"
);
const stmtIsBlocked = db.prepare<[string], { phone: string }>(
  "SELECT phone FROM blocked_numbers WHERE phone = ?"
);
const stmtBlockNumber = db.prepare<[string, string | null]>(
  "INSERT OR REPLACE INTO blocked_numbers (phone, reason) VALUES (?, ?)"
);
const stmtUnblockNumber = db.prepare<[string]>(
  "DELETE FROM blocked_numbers WHERE phone = ?"
);

export function listBlockedNumbers(): BlockedNumberRow[] {
  return stmtListBlockedNumbers.all();
}

export function isNumberBlocked(phone: string): boolean {
  return stmtIsBlocked.get(phone) !== undefined;
}

export function blockNumber(phone: string, reason: string | null): void {
  stmtBlockNumber.run(phone, reason);
}

export function unblockNumber(phone: string): boolean {
  const info = stmtUnblockNumber.run(phone);
  return info.changes > 0;
}

// ─── Pinear conversaciones ───────────────────────────────────────────────

const stmtSetPinned = db.prepare<[number, number | null, number]>(
  "UPDATE conversations SET pinned = ?, pinned_at = ? WHERE id = ?"
);

export function setConversationPinned(
  conversationId: number,
  pinned: boolean
): void {
  stmtSetPinned.run(
    pinned ? 1 : 0,
    pinned ? Math.floor(Date.now() / 1000) : null,
    conversationId
  );
}

// ─── Indicador de no leídos ──────────────────────────────────────────────

// Al marcar como LEÍDO: avanzamos last_read_at al ahora (los mensajes
// previos del cliente dejan de contar como no leídos) y limpiamos el
// flag de "marcado manual como no leído" si estaba activo.
const stmtMarkConvoRead = db.prepare<[number, number]>(
  "UPDATE conversations SET last_read_at = ?, manually_unread = 0 WHERE id = ?"
);
// Al marcar como NO LEÍDO manualmente (estilo WhatsApp): activamos el
// flag manually_unread = 1. NO tocamos last_read_at — los mensajes ya
// leídos siguen contados como leídos. Esto produce el "puntito sin
// número" en la UI cuando unread_count = 0.
const stmtMarkConvoUnread = db.prepare<[number]>(
  "UPDATE conversations SET manually_unread = 1 WHERE id = ?"
);

export function markConversationRead(conversationId: number): void {
  stmtMarkConvoRead.run(Math.floor(Date.now() / 1000), conversationId);
}

export function markConversationUnread(conversationId: number): void {
  stmtMarkConvoUnread.run(conversationId);
}

export default db;
