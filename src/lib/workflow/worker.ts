import {
  claimScheduledAction,
  getConversationById,
  getDueActions,
  markActionCompleted,
  markActionFailed,
  reprogramarAccion,
  salioAlgoDelBotDesde,
  ultimoMensajeDe,
  type ScheduledActionRow,
} from "@/lib/db";
import { executeAction } from "@/lib/workflow/engine";
import { conLaHoraDelCliente } from "@/lib/workflow/quiet-hours";
import { ejecutarAccionDelTablero } from "@/lib/tablero/motor";
import { maybePurgeStaleConversations } from "@/lib/workflow/purge";
import { tickComentarios } from "@/lib/meta/comments";
import { publicarSiToca } from "@/lib/contenido";

const POLL_INTERVAL_MS = 2 * 1000;
const BATCH_SIZE = 50;

/**
 * UN CLIENTE ATASCADO NUNCA FRENA A LOS DEMÁS (05/11/2026). Su caso: «a veces cuando grabo un cambio… se
 * traba… los seguimientos que correspondían en ese tiempo no salen».
 *
 * Antes el obrero atendía lo programado DE UNO EN UNO y esperaba a que terminara cada acción antes de mirar la
 * siguiente: si una se quedaba esperando a la IA o a Meta, nadie más recibía nada hasta que terminara. Ahora
 * cada conversación corre por su lado (hasta MAX_A_LA_VEZ juntas). Lo que NO cambia:
 * - Dentro de una conversación, una acción a la vez y la más antigua primero: la siguiente no arranca hasta
 *   que la anterior terminó (así se conservan los tiempos entre burbujas y el orden).
 * - El reclamo atómico en la base (`claimScheduledAction`): la misma acción no corre dos veces.
 * - Los tiempos de cada acción (run_at), la cola antirráfaga y las horas de silencio: salen de la base, no de
 *   cuánto tardaba el obrero.
 */
const MAX_A_LA_VEZ = 10;

/** Si una acción falla por la red SIN haber mandado nada al cliente, se reintenta al minuto (máx. 2 veces). */
const REINTENTO_EN_S = 60;
const MAX_REINTENTOS = 2;

// Guard global — instrumentation puede dispararse más de una vez en dev. Lo que corre va también en globalThis:
// /api/cron/tick puede cargar este archivo en otro paquete y debe ver las mismas conversaciones en curso.
const G = globalThis as unknown as {
  __wfWorkerStarted?: boolean;
  __wfCorriendo?: Map<number, { id: number; tipo: string; desde: number }>;
  __wfReintentos?: Map<number, number>;
};
const corriendo = (G.__wfCorriendo ??= new Map());
const reintentos = (G.__wfReintentos ??= new Map());

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let inFlight = false;
// EL LATIDO (05/11/2026): solo anota. Deja escrito en el log si el servidor se quedó trabado y si una acción
// lleva mucho esperando, para que la próxima vez la causa quede en el registro de EasyPanel.
let latidoHandle: ReturnType<typeof setInterval> | null = null;

/** ¿Falló por la red o por un tiempo máximo (no por un error del bot)? Solo esas se reintentan. */
function esFalloDeRed(err: unknown): boolean {
  for (let e: unknown = err, i = 0; e && i < 4; e = (e as { cause?: unknown }).cause, i++) {
    const nombre = String((e as { name?: unknown }).name ?? "");
    const texto = `${String((e as { code?: unknown }).code ?? "")} ${String((e as { message?: unknown }).message ?? "")}`;
    if (/^(TimeoutError|AbortError|APIConnectionError|APIConnectionTimeoutError)$/.test(nombre)) return true;
    if (/fetch failed|ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|UND_ERR|socket hang up|timed? ?out/i.test(texto)) return true;
  }
  return false;
}

async function correr(action: ScheduledActionRow): Promise<void> {
  const desde = Date.now();
  let antes = 0;
  try {
    antes = ultimoMensajeDe(action.conversation_id);
  } catch {
    antes = Number.MAX_SAFE_INTEGER; // sin poder medirlo, no se reintenta
  }
  try {
    // Lo programado del tablero va a su motor; lo demás, al de siempre, como antes.
    // Con la hora del país de SU cliente: horas de silencio y horarios fijos (09/11/2026).
    let phone: string | undefined;
    try { phone = getConversationById(action.conversation_id)?.phone; } catch { phone = undefined; }
    await conLaHoraDelCliente(phone, () =>
      action.action_type.startsWith("tablero_") ? ejecutarAccionDelTablero(action) : executeAction(action));
    if (Date.now() - desde > 30_000) console.log(`[latido] la acción ${action.id} (${action.action_type}) tardó ${Math.round((Date.now() - desde) / 1000)} s`);
    markActionCompleted(action.id);
    reintentos.delete(action.id);
  } catch (err) {
    const hechos = reintentos.get(action.id) ?? 0;
    let mudo = false;
    try {
      mudo = antes !== Number.MAX_SAFE_INTEGER && !salioAlgoDelBotDesde(action.conversation_id, antes);
    } catch {
      mudo = false;
    }
    // Solo si no salió NADA al cliente: así un reintento nunca le repite una burbuja.
    if (mudo && hechos < MAX_REINTENTOS && esFalloDeRed(err)) {
      reintentos.set(action.id, hechos + 1);
      reprogramarAccion(action.id, Math.floor(Date.now() / 1000) + REINTENTO_EN_S);
      console.error(
        `[wf:worker] acción ${action.id} (${action.action_type}) falló por la red sin mandar nada; se reintenta en ${REINTENTO_EN_S} s (intento ${hechos + 2} de ${MAX_REINTENTOS + 1}):`,
        err instanceof Error ? err.message : err
      );
    } else {
      reintentos.delete(action.id);
      console.error(
        `[wf:worker] acción ${action.id} (${action.action_type}) falló:`,
        err
      );
      markActionFailed(action.id);
    }
  } finally {
    corriendo.delete(action.conversation_id);
  }
}

/**
 * Procesa todas las acciones cuyo run_at ya venció. Idempotente y
 * re-entrante: si ya hay un tick corriendo, las llamadas concurrentes
 * salen inmediatamente. Exportado para que el endpoint /api/cron/tick
 * lo pueda invocar desde un cron externo (UptimeRobot, cron-job.org)
 * y asi tener disparos puntuales incluso si el container fue dormido
 * por el hosting y el setInterval quedo congelado.
 */
export async function tick(): Promise<void> {
  if (inFlight) return; // evita solapamientos si una corrida tarda más de 2s
  inFlight = true;
  try {
    // Autopurga de chats inactivos (se auto-limita a una corrida al día; si
    // está desactivada en el YAML, sale al instante). A prueba de fallos.
    try {
      maybePurgeStaleConversations();
    } catch (err) {
      console.error("[purge] error en autopurga:", err);
    }

    // EL RESPALDO DEL CONTENIDO EN GITHUB (30/10/2026): lo guardado que aún no subió se reintenta solo.
    // Sin esperar (no frena las acciones de abajo) y solo si hay algo pendiente y ya toca.
    try {
      publicarSiToca();
    } catch (err) {
      console.error("[contenido] error al reintentar el respaldo:", err);
    }

    // Respuesta a comentarios de Facebook. Se lanza SIN esperar y con su
    // propio catch: aunque Meta tarde o falle, el worker sigue procesando las
    // acciones del bot sin bloquearse. Si está apagada, sale al instante.
    void tickComentarios().catch((err) =>
      console.error("[comentarios] error en el tick:", err)
    );

    const now = Math.floor(Date.now() / 1000);
    const due = getDueActions(now, BATCH_SIZE);
    if (due.length === 0) return;

    // Procesamos máximo UNA acción por conversación por tick. Si dos pasos
    // del intro se vencieron juntos (porque el worker se atrasó), solo
    // disparamos el más antiguo y dejamos el otro para el siguiente tick.
    // Esto preserva los delays incluso si hay congestión.
    // Y una conversación que todavía tiene una acción corriendo espera a que termine.
    const seenConvos = new Set<number>();
    const toProcess: typeof due = [];
    for (const action of due) {
      if (seenConvos.has(action.conversation_id)) continue;
      seenConvos.add(action.conversation_id);
      if (corriendo.has(action.conversation_id)) continue;
      toProcess.push(action);
    }

    if (toProcess.length === 0) return;
    console.log(
      `[wf:worker] procesando ${toProcess.length} acciones (${due.length} vencidas, una por conversación)`
    );
    for (const action of toProcess) {
      if (corriendo.size >= MAX_A_LA_VEZ) break; // las demás, en el siguiente tick
      try {
        if (!claimScheduledAction(action.id, now)) {
          console.log(
            `[wf:worker] acción ${action.id} ya fue tomada por otro worker`
          );
          continue;
        }
      } catch (err) {
        console.error(`[wf:worker] no se pudo tomar la acción ${action.id}:`, err);
        continue;
      }
      corriendo.set(action.conversation_id, { id: action.id, tipo: action.action_type, desde: Date.now() });
      // Sin esperar: cada conversación por su lado.
      void correr(action);
    }
  } catch (err) {
    console.error("[wf:worker] error en tick:", err);
  } finally {
    inFlight = false;
  }
}

function arrancarLatido(): void {
  if (latidoHandle) return;
  const CADA_MS = 5_000;
  let esperado = Date.now() + CADA_MS;
  const avisadas = new Set<number>();
  let ultimaMemoria = Date.now();
  latidoHandle = setInterval(() => {
    const ahora = Date.now();
    const atraso = ahora - esperado;
    esperado = ahora + CADA_MS;
    if (atraso > 3_000) console.log(`[latido] el servidor estuvo trabado ${(atraso / 1000).toFixed(1)} s (no atendía a nadie)`);
    for (const [convo, a] of corriendo) {
      const s = Math.round((ahora - a.desde) / 1000);
      // Un aviso cada 30 s por acción: a los 30, 60, 90…
      const marca = a.id * 1000 + Math.floor(s / 30);
      if (s >= 30 && !avisadas.has(marca)) {
        avisadas.add(marca);
        console.log(`[latido] la acción ${a.id} (${a.tipo}) de la conversación ${convo} lleva ${s} s; las demás conversaciones siguen saliendo (${corriendo.size} corriendo)`);
      }
    }
    if (avisadas.size > 500) avisadas.clear();
    // LA MEMORIA, SOLO SI ES UN PROBLEMA (06/11/2026). Él: «me asusta, me hace pensar que el bot está atorando el vps».
    // La línea «vivo» de cada 5 min se quita; se mira igual cada 5 min y solo se avisa pasando de 1,5 GB (hoy usa ~0,4).
    if (ahora - ultimaMemoria > 5 * 60_000) {
      ultimaMemoria = ahora;
      const m = process.memoryUsage();
      const mb = Math.round(m.rss / 1048576);
      if (mb > 1536) console.log(`[latido] ⚠️ el bot está usando mucha memoria: ${mb} MB (montón ${Math.round(m.heapUsed / 1048576)} MB). Si sigue subiendo, copia este log.`);
    }
  }, CADA_MS);
}

export function startWorkflowWorker(): void {
  if (G.__wfWorkerStarted) {
    console.log("[wf:worker] ya estaba corriendo, no arranco otra vez");
    return;
  }
  G.__wfWorkerStarted = true;
  console.log(`[wf:worker] arrancando, poll cada ${POLL_INTERVAL_MS}ms`);
  // Primer tick inmediato — recoge acciones acumuladas durante el restart.
  void tick();
  arrancarLatido();
  intervalHandle = setInterval(() => {
    void tick();
  }, POLL_INTERVAL_MS);
}

export function stopWorkflowWorker(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  if (latidoHandle) {
    clearInterval(latidoHandle);
    latidoHandle = null;
  }
  G.__wfWorkerStarted = false;
}
