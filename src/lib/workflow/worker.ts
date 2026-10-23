import {
  claimScheduledAction,
  getDueActions,
  markActionCompleted,
  markActionFailed,
} from "@/lib/db";
import { executeAction } from "@/lib/workflow/engine";
import { ejecutarAccionDelTablero } from "@/lib/tablero/motor";
import { maybePurgeStaleConversations } from "@/lib/workflow/purge";
import { tickComentarios } from "@/lib/meta/comments";

const POLL_INTERVAL_MS = 2 * 1000;
const BATCH_SIZE = 50;

// Guard global — instrumentation puede dispararse más de una vez en dev.
const G = globalThis as unknown as { __wfWorkerStarted?: boolean };

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let inFlight = false;

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
    const seenConvos = new Set<number>();
    const toProcess: typeof due = [];
    for (const action of due) {
      if (seenConvos.has(action.conversation_id)) continue;
      seenConvos.add(action.conversation_id);
      toProcess.push(action);
    }

    if (toProcess.length === 0) return;
    console.log(
      `[wf:worker] procesando ${toProcess.length} acciones (${due.length} vencidas, una por conversación)`
    );
    for (const action of toProcess) {
      try {
        if (!claimScheduledAction(action.id, now)) {
          console.log(
            `[wf:worker] acción ${action.id} ya fue tomada por otro worker`
          );
          continue;
        }
        // Lo programado del tablero va a su motor; lo demás, al de siempre, como antes.
        if (action.action_type.startsWith("tablero_")) await ejecutarAccionDelTablero(action);
        else await executeAction(action);
        markActionCompleted(action.id);
      } catch (err) {
        console.error(
          `[wf:worker] acción ${action.id} (${action.action_type}) falló:`,
          err
        );
        markActionFailed(action.id);
      }
    }
  } catch (err) {
    console.error("[wf:worker] error en tick:", err);
  } finally {
    inFlight = false;
  }
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
  intervalHandle = setInterval(() => {
    void tick();
  }, POLL_INTERVAL_MS);
}

export function stopWorkflowWorker(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  G.__wfWorkerStarted = false;
}
