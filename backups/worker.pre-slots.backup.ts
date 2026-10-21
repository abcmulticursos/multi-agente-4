import {
  getDueActions,
  markActionCompleted,
  markActionFailed,
} from "@/lib/db";
import { executeAction } from "@/lib/workflow/engine";

const POLL_INTERVAL_MS = 2 * 1000;
const BATCH_SIZE = 50;

// Guard global — instrumentation puede dispararse más de una vez en dev.
const G = globalThis as unknown as { __wfWorkerStarted?: boolean };

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let inFlight = false;

async function tick(): Promise<void> {
  if (inFlight) return; // evita solapamientos si una corrida tarda más de 2s
  inFlight = true;
  try {
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
        await executeAction(action);
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
