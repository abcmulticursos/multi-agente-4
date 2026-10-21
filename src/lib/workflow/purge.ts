import { getStaleConversations, deleteConversation } from "@/lib/db";
import { loadWorkflowConfig } from "@/lib/workflow/config";

/**
 * Autopurga de conversaciones inactivas.
 *
 * Borra los chats que llevan más de `autopurge_inactive_days` (del YAML) SIN
 * actividad, EXCEPTO los compradores (esos nunca se tocan — su venta queda
 * intacta en el panel). El borrado reutiliza deleteConversation, que también
 * limpia los archivos de media y cancela los seguimientos pendientes (cascade).
 *
 * Se llama desde el worker en cada tick, pero se auto-limita: corre como mucho
 * una vez cada MIN_GAP_SEC. Si la opción no está en el YAML (o es 0), no hace
 * absolutamente nada (desactivada).
 */

const DAY_SEC = 86400;
const MIN_GAP_SEC = 12 * 3600; // como mucho dos corridas al día

let lastRunUnix = 0;

/** Lista (sin borrar) las conversaciones que la purga eliminaría con la
 *  ventana de `days` días. Para el endpoint de previsualización. */
export function previewStalePurge(days: number) {
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - Math.max(1, days) * DAY_SEC;
  return getStaleConversations(cutoff);
}

/** Ejecuta la autopurga si está activada y no corrió hace poco. Idempotente
 *  y a prueba de fallos: cualquier error se loguea pero no rompe el worker. */
export function maybePurgeStaleConversations(): void {
  const now = Math.floor(Date.now() / 1000);
  if (now - lastRunUnix < MIN_GAP_SEC) return;

  const cfg = loadWorkflowConfig();
  const days = cfg?.autopurge_inactive_days ?? 0;
  // Marcamos el intento aunque esté desactivada, para no recalcular cada 2s.
  lastRunUnix = now;
  if (!days || days <= 0) return; // autopurga desactivada

  const cutoff = now - days * DAY_SEC;
  const stale = getStaleConversations(cutoff);
  if (stale.length === 0) {
    console.log(
      `[purge] nada que borrar (>${days}d inactivos, compradores excluidos)`
    );
    return;
  }

  let deleted = 0;
  for (const c of stale) {
    try {
      deleteConversation(c.id);
      deleted++;
    } catch (err) {
      console.error(`[purge] no se pudo borrar convo ${c.id}:`, err);
    }
  }
  console.log(
    `[purge] borradas ${deleted}/${stale.length} conversaciones inactivas >${days} días (compradores excluidos)`
  );
}
