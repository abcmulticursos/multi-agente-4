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

export function reenviarLoDelTablero(convo: ConversationRow, loQueDijo = "", enmarcar = false): boolean {
  if (!estadoEnElTablero(convo.id)) return false;
  let productos = entregasDelCliente(convo.id);
  if (productos.length === 0) {
    console.log(`[tablero] convo ${convo.id}: pidió reenvío pero el tablero no le entregó nada todavía`);
    return true;
  }
  const config = loadWorkflowConfig();
  // SOLO LO QUE PIDE (27/10/2026, la ronda de clientes simulados): «no me llegó el segundo» reenviaba las
  // dos entregas, y cada vez. Si nombra un producto, ése; si dice «el segundo / el último / el otro / el
  // nuevo», la última entrega; si no, todas, como antes.
  if (productos.length > 1 && loQueDijo) {
    const plano = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{Mn}/gu, "");
    const dicho = plano(loQueDijo);
    const palabras = (clave: string) => plano(laEntrega(config, clave)?.producto.name ?? "").split(/[^a-z0-9ñ]+/).filter((w) => w.length >= 4);
    // Nombrado = dijo una palabra de su nombre que los otros no tienen.
    const nombrado = productos.filter((clave) => {
      const otras = new Set(productos.filter((o) => o !== clave).flatMap(palabras));
      return palabras(clave).some((w) => !otras.has(w) && new RegExp(`\\b${w}\\b`).test(dicho));
    });
    if (nombrado.length === 1) productos = nombrado;
    else if (/\b(segundo|ultimo|el otro|nuevo|lo ultimo)\b/.test(dicho)) productos = [productos[productos.length - 1]];
  }
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
      // Enmarcado como la venta de siempre (`enmarcarElReenvio`): primero «te lo reenvío».
      // (Desde el motor de siempre no: ahí ya lo dice antes de llamar.)
      const marco = enmarcar ? [{ type: "text", body: "Claro, te lo reenvío ahora mismo 😊👇", delay_after_sec: 2 }] : [];
      return sendConfiguredSteps(convo, [...marco, ...pasos] as never);
    })
    .catch((err) => console.error(`[tablero] convo ${convo.id}: falló el reenvío`, err));
  return true;
}
