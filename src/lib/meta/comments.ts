import {
  addPendingComment,
  getConversationByPhone,
  getDuePendingComments,
  getSentPendingComments,
  markPendingComment,
  getActiveMetaConnection,
  setMode,
  countCommentsByCommenter,
  reactivateOldestSkipped,
  setLeadOrigin,
  lastCommentReplyTo,
  ignoredRepliesBy,
  type PendingCommentRow,
} from "@/lib/db";
import { loadWorkflowConfig } from "@/lib/workflow/config";
import { notifyAdmin } from "@/lib/notifications";

/**
 * RESPUESTA A COMENTARIOS DE FACEBOOK.
 *
 * Aislado a propósito: nada de aquí se ejecuta si el interruptor
 * `comment_automation.enabled` está apagado, que es como nace. El camino de
 * los mensajes de Messenger no pasa por este archivo.
 */

const HORAS_POR_DEFECTO_SIN_COINCIDIR = 24;
const HORAS_POR_DEFECTO_ABANDONO = 24;
/** Meta solo deja responder en privado dentro de los 7 dias del comentario.
 *  Se corta en 6 para tener margen: mas alla, el envio falla siempre. */
const TOPE_ESPERA_SEG = 6 * 24 * 3600;

function ajustes() {
  return loadWorkflowConfig()?.comment_automation;
}

export function comentariosActivos(): boolean {
  return ajustes()?.enabled === true;
}

/**
 * ¿El texto del comentario dispara la respuesta inmediata?
 *
 * Se acepta tanto una expresión regular como una lista de palabras separadas
 * por coma. Si el patrón está mal escrito NO se rompe nada: se cae a buscar
 * las palabras sueltas, y si tampoco hay, no coincide.
 */
export function coincide(texto: string, patron: string | undefined): boolean {
  const contenido = (texto ?? "").trim();
  const bruto = (patron ?? "").trim();
  if (!contenido || !bruto) return false;

  const pareceRegex = /[\\^$.*+?()[\]{}|]/.test(bruto);
  if (pareceRegex) {
    try {
      const conBandera = bruto.startsWith("(?i)");
      const cuerpo = conBandera ? bruto.slice(4) : bruto;
      return new RegExp(cuerpo, conBandera ? "i" : "").test(contenido);
    } catch {
      // Patrón inválido: seguimos con la comparación por palabras.
    }
  }

  const normal = contenido.toLowerCase();
  return bruto
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean)
    .some((palabra) => normal.includes(palabra));
}

/** Encola un comentario recién llegado. No envía nada todavía. */
export function registrarComentario(input: {
  commentId: string;
  pageId: string;
  postId?: string | null;
  commenterId: string | null;
  commenterName: string | null;
  text: string | null;
}): void {
  const cfg = ajustes();
  if (cfg?.enabled !== true) return;

  // Con "aceptar cualquier comentario" no se miran las palabras clave: todo
  // comentario cuenta como si hubiera coincidido.
  const acierta =
    cfg.accept_any === true || coincide(input.text ?? "", cfg.keywords);

  if (input.commenterId) {
    // TOPE POR PERSONA. Sin esto se envía un privado por comentario, así que
    // quien comenta cinco veces recibe cinco mensajes iguales. Con la opción
    // de aceptar cualquier comentario eso seria spam asegurado.
    const topeHoras =
      typeof cfg.one_per_person_hours === "number" ? cfg.one_per_person_hours : 0;
    if (topeHoras > 0) {
      const ultimo = lastCommentReplyTo(input.commenterId);
      const ahoraSec = Math.floor(Date.now() / 1000);
      if (ultimo > 0 && ahoraSec - ultimo < topeHoras * 3600) {
        const faltan = Math.round(
          (topeHoras * 3600 - (ahoraSec - ultimo)) / 60
        );
        console.log(
          `[comentarios] ${input.commentId}: a ${input.commenterName ?? input.commenterId} ya se le escribio hace poco, no insisto (faltan ${faltan} min)`
        );
        return;
      }
    }

    // QUIEN YA IGNORO. Meta no avisa si alguien borra el chat, pero el
    // silencio vale igual: si no contesto, no se le vuelve a escribir.
    if (cfg.skip_after_ignored_enabled === true) {
      const tope = Math.max(1, Math.round(cfg.skip_after_ignored ?? 1));
      const ignorados = ignoredRepliesBy(input.commenterId);
      if (ignorados >= tope) {
        console.log(
          `[comentarios] ${input.commentId}: ${input.commenterName ?? input.commenterId} ya ignoro ${ignorados} privado(s), lo dejo en paz`
        );
        return;
      }
    }
  }
  const esperaPedida =
    typeof cfg.delay_no_match_seconds === "number"
      ? cfg.delay_no_match_seconds
      : Math.round(
          (typeof cfg.delay_no_match_hours === "number"
            ? cfg.delay_no_match_hours
            : HORAS_POR_DEFECTO_SIN_COINCIDIR) * 3600
        );
  // VENTANA DE META: solo se puede responder en privado dentro de los 7 dias
  // del comentario. Una espera mayor garantiza que el envio falle. Se acorta a
  // 6 dias, con margen, y se avisa en el log. Las esperas normales (horas) no
  // pasan por aqui.
  const esperaSeg =
    esperaPedida > TOPE_ESPERA_SEG
      ? (console.warn(
          `[comentarios] la espera configurada (${Math.round(esperaPedida / 3600)}h) supera la ventana de 7 dias de Meta; la acorto a 6 dias`
        ),
        TOPE_ESPERA_SEG)
      : esperaPedida;

  // Sin coincidencia y con espera en 0: no se le escribe nunca.
  if (!acierta && esperaSeg <= 0) {
    console.log(`[comentarios] ${input.commentId} no coincide y la espera es 0, lo ignoro`);
    return;
  }

  const ahora = Math.floor(Date.now() / 1000);
  addPendingComment({
    ...input,
    matched: acierta,
    sendAt: acierta ? ahora : ahora + esperaSeg,
  });

  // Regla de insistencia: si esta encendida, al que NO coincide solo se le
  // escribe cuando ha comentado `repeat_count` veces. Un comentario suelto no
  // dispara nada; dos ya son señal de interés. Al alcanzar el número, se
  // despierta su comentario más antiguo que siguiera esperando.
  if (!acierta && cfg.repeat_enabled === true && input.commenterId) {
    const necesarios = Math.max(1, Math.round(cfg.repeat_count ?? 2));
    const suyos = countCommentsByCommenter(input.commenterId);
    if (suyos < necesarios) {
      // Todavía no insiste lo suficiente: su comentario queda en espera pero
      // marcado para no enviarse por sí solo.
      markPendingComment(input.commentId, "skipped", {
        error: `esperando ${necesarios} comentarios (lleva ${suyos})`,
      });
      console.log(
        `[comentarios] ${input.commentId} no coincide y lleva ${suyos}/${necesarios} comentarios, no envio todavia`
      );
      return;
    }
    reactivateOldestSkipped(input.commenterId, ahora + esperaSeg);
    console.log(
      `[comentarios] ${input.commenterId} llego a ${suyos} comentarios sin coincidir, activo el envio`
    );
  }

  console.log(
    `[comentarios] ${input.commentId} encolado (${acierta ? "coincide" : `espera ${esperaSeg}s`})`
  );
}

/**
 * Envía la respuesta privada a un comentario.
 *
 * Va por la API de Messenger: POST /PAGE-ID/messages, con el comentario como
 * destinatario. El camino antiguo (/{comment_id}/private_replies) devolvia
 * "Object ... does not exist" (code 100, subcode 33) aunque el comentario
 * existiera y la pagina fuera la correcta.
 */
async function responderEnPrivado(
  pageId: string,
  commentId: string,
  mensaje: string,
  pageAccessToken: string
): Promise<{ ok: boolean; detail: string }> {
  const version = process.env.META_GRAPH_VERSION?.trim() || "v21.0";
  try {
    const url = new URL(`https://graph.facebook.com/${version}/${pageId}/messages`);
    url.searchParams.set("access_token", pageAccessToken);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: { comment_id: commentId },
        message: { text: mensaje },
      }),
      cache: "no-store",
    });
    const detail = await res.text();
    return { ok: res.ok, detail };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Texto del privado. Sale de la PRIMERA burbuja de texto activa; si no hay
 * burbujas se usa el texto plano antiguo. Meta solo admite un privado por
 * comentario, por eso no se envían las demás.
 */
function textoDelMensaje(
  cfg: NonNullable<ReturnType<typeof ajustes>>
): string {
  for (const paso of cfg.message_steps ?? []) {
    if (paso.enabled === false) continue;
    if (paso.type && paso.type !== "text") continue;
    const cuerpo = (paso.body ?? "").trim();
    if (cuerpo) return cuerpo;
  }
  return (cfg.message ?? "").trim();
}

function armarMensaje(plantilla: string, nombre: string | null): string {
  const primerNombre = (nombre ?? "").trim().split(/\s+/)[0] ?? "";
  return plantilla
    .replace(/\{\{\s*NOMBRE\s*\}\}/gi, primerNombre)
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * ¿Esa persona ya tiene conversación con mensajes suyos?
 *
 * Al confirmar que contestó se marca su conversación como venida de un
 * comentario, con la publicación de origen. Así el panel puede separar las
 * ventas de este canal y atribuir al anuncio las que salgan de un post
 * promocionado. Se usa COALESCE: si ya traía origen, no se pisa.
 */
function yaRespondio(fila: PendingCommentRow, desde: number): boolean {
  if (!fila.commenter_id) return false;
  const convo = getConversationByPhone(`messenger:${fila.commenter_id}`);
  if (!convo) return false;
  const ultimo = convo.last_message_at ?? 0;
  if (ultimo <= desde) return false;
  try {
    setLeadOrigin(convo.id, "comment", fila.post_id);
  } catch (error) {
    console.warn(`[comentarios] no pude marcar el origen: ${String(error)}`);
  }
  return true;
}

/**
 * Tick de comentarios: envía los que toca y cierra los que nadie contestó.
 * Lo llama el worker. Si el interruptor está apagado, no hace nada.
 */
let corriendo = false;

export async function tickComentarios(): Promise<void> {
  const cfg = ajustes();
  if (cfg?.enabled !== true) return;
  // El tick del worker no espera a este, así que dos corridas podrían
  // solaparse y responder dos veces al mismo comentario. Este cerrojo lo evita.
  if (corriendo) return;
  corriendo = true;
  try {
    await procesarComentarios(cfg);
  } finally {
    corriendo = false;
  }
}

async function procesarComentarios(
  cfg: NonNullable<ReturnType<typeof ajustes>>
): Promise<void> {
  const conexion = getActiveMetaConnection();
  if (!conexion) return;

  const plantilla = textoDelMensaje(cfg);
  const ahora = Math.floor(Date.now() / 1000);

  // 1. Los que ya toca enviar.
  for (const fila of getDuePendingComments(ahora)) {
    if (!plantilla) {
      markPendingComment(fila.comment_id, "skipped", {
        error: "sin mensaje configurado",
      });
      continue;
    }
    const resultado = await responderEnPrivado(
      fila.page_id || conexion.page_id,
      fila.comment_id,
      armarMensaje(plantilla, fila.commenter_name),
      conexion.page_access_token
    );
    if (resultado.ok) {
      markPendingComment(fila.comment_id, "sent", { sentAt: ahora });
      console.log(`[comentarios] privado enviado a ${fila.commenter_name ?? fila.commenter_id}`);
    } else {
      // Meta solo admite una respuesta por comentario: no se reintenta.
      markPendingComment(fila.comment_id, "failed", {
        error: resultado.detail.slice(0, 300),
      });
      console.warn(
        `[comentarios] fallo el privado de ${fila.comment_id} ` +
          `(pagina activa=${conexion.page_id}, pagina del comentario=${fila.page_id}): ${resultado.detail}`
      );
      // AVISO AL ADMIN: sin esto el fallo se quedaba solo en el log y se
      // perdia el lead en silencio. No se reintenta, asi que es la unica
      // oportunidad de enterarse. Fire-and-forget: nunca frena el tick.
      void notifyAdmin(
        `⚠️ No se pudo enviar el mensaje privado a ${fila.commenter_name ?? fila.commenter_id ?? "un comentarista"} de Facebook.\n\n` +
          `Motivo: ${resultado.detail.slice(0, 200)}\n\n` +
          `Meta no permite reintentar sobre el mismo comentario.`
      ).catch(() => {});
    }
  }

  // 2. Los enviados: ¿contestaron?
  const abandonoHoras =
    typeof cfg.abandon_hours === "number"
      ? cfg.abandon_hours
      : HORAS_POR_DEFECTO_ABANDONO;
  const pasarAHumano = cfg.to_human_enabled === true;
  const humanoHoras =
    typeof cfg.to_human_hours === "number" ? cfg.to_human_hours : abandonoHoras;

  for (const fila of getSentPendingComments()) {
    const enviado = fila.sent_at ?? fila.created_at;
    if (yaRespondio(fila, enviado)) {
      markPendingComment(fila.comment_id, "replied");
      continue;
    }

    // Pasar a humano: solo si el usuario lo activó en el editor.
    if (
      pasarAHumano &&
      humanoHoras > 0 &&
      fila.commenter_id &&
      ahora - enviado >= humanoHoras * 3600
    ) {
      const convo = getConversationByPhone(`messenger:${fila.commenter_id}`);
      if (convo) {
        setMode(convo.id, "HUMAN");
        console.log(
          `[comentarios] ${fila.comment_id} sin respuesta en ${humanoHoras}h, paso la conversacion a HUMANO`
        );
      } else {
        // Sin conversación no hay chat que atender: Meta no la crea hasta que
        // la persona contesta. Se registra para que quede constancia.
        console.log(
          `[comentarios] ${fila.comment_id} sin respuesta en ${humanoHoras}h y sin chat abierto, no hay nada que pasar a humano`
        );
      }
      markPendingComment(fila.comment_id, "lost");
      continue;
    }

    if (abandonoHoras > 0 && ahora - enviado >= abandonoHoras * 3600) {
      markPendingComment(fila.comment_id, "lost");
      console.log(`[comentarios] ${fila.comment_id} sin respuesta en ${abandonoHoras}h, lo doy por perdido`);
    }
  }
}
