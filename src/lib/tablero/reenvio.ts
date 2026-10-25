/**
 * EL REENVÍO DEL MATERIAL DE UN CLIENTE DEL TABLERO (23/10/2026).
 *
 * Cuando el cliente dice «no me llegó», el motor de siempre reenvía lo que vendió ÉL. Un cliente
 * del tablero no compró eso: recibió lo que entregaron sus fichas «Entregar». Esta función lo
 * reenvía, y le dice al motor de siempre que ya está atendido (true). Para una conversación que
 * no es del tablero devuelve false y no hace nada: el reenvío de siempre sigue igual.
 */
import type { ConversationRow } from "@/lib/db";
import { loadWorkflowConfig } from "@/lib/workflow/config";
import { entregasDelCliente, estadoEnElTablero } from "./estado";
import { laEntrega } from "./entregas";

export function reenviarLoDelTablero(convo: ConversationRow): boolean {
  if (!estadoEnElTablero(convo.id)) return false;
  const productos = entregasDelCliente(convo.id);
  if (productos.length === 0) {
    console.log(`[tablero] convo ${convo.id}: pidió reenvío pero el tablero no le entregó nada todavía`);
    return true;
  }
  const config = loadWorkflowConfig();
  console.log(`[tablero] convo ${convo.id}: REENVÍO de lo que entregó el tablero (${productos.join(", ")})`);
  // Se importa al llamarse: el motor de siempre usa este archivo y al revés habría un círculo.
  // Cada entrega con SU nombre en {{PRODUCTO_ENTREGADO}}, como la entrega de la ficha (24/10/2026:
  // el reenvío salía «Entrega de **»).
  void Promise.all([import("@/lib/workflow/engine"), import("./pago")])
    .then(([{ sendConfiguredSteps }, { conElNombreDelProducto }]) => {
      // Cada clave es una entrega: la principal de un producto o una extra suya (muestras, un nivel…).
      const pasos = productos.flatMap((clave) => {
        const e = laEntrega(config, clave);
        return e?.pasos?.length ? conElNombreDelProducto(e.pasos as never, e.producto.name) : [];
      });
      return sendConfiguredSteps(convo, pasos as never);
    })
    .catch((err) => console.error(`[tablero] convo ${convo.id}: falló el reenvío`, err));
  return true;
}
