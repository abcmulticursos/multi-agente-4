/**
 * Hook de Next.js que se ejecuta una vez al arrancar el servidor (Node).
 * Usamos esto para iniciar el worker que procesa scheduled_actions.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // El log también a disco (data/logs), para descargarlo entero desde el panel.
    const { guardarElLogEnDisco } = await import("@/lib/registro-a-disco");
    guardarElLogEnDisco();
    const { startWorkflowWorker } = await import("@/lib/workflow/worker");
    startWorkflowWorker();
  }
}
