// La segunda oferta se perdia si el cliente pedia su enlace otra vez.
//
// LO QUE PASO DE VERDAD (convo 29)
//
//   1. Se entrega el primer producto. Se marca "esperando" y la oferta del
//      segundo queda programada para dentro de N minutos.
//        [wf:upsell] convo 29: lo ofrezco en 2 min
//   2. El cliente escribe "no me llego mi link" y el bot reenvia el material.
//        [wf:pago] convo 29: REENVIO de material (ya pago)
//      Reenviar CANCELA todas las acciones pendientes de la conversacion —para
//      no duplicar entregas— y con ellas se lleva la oferta programada.
//   3. Al terminar el reenvio se vuelve a pasar por continuarTrasEntrega, pero
//      la condicion era "nunca se le ofrecio" (upsell_state vacio) y el estado
//      ya decia "esperando". No entraba: se iba directo al regalo.
//        [wf] pregunta de consent del regalo programada para convo 29 en 60s
//
// La segunda venta se perdia en silencio, y encima con un cliente que estaba
// pendiente de su compra — de los mas dispuestos a comprar otra vez.
//
// LA CORRECCION
//
// "esperando" significa "se le debe la oferta". Si ademas no queda ninguna
// programada, es que se cancelo y hay que volver a programarla.
//
// Preguntar por la accion pendiente conserva la proteccion de siempre —dos
// entregas seguidas no programan la oferta dos veces, que es justo por lo que
// el estado se marca ANTES de presentarla— y arregla el caso perdido.
//
//   node scripts/prueba-upsell-no-se-pierde.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");

const engine = leer("src", "lib", "workflow", "engine.ts");
const pago = leer("src", "lib", "workflow", "payment.ts");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// ── 1. Reenviar sigue cancelando lo pendiente ───────────────────────────────
//
// Esto NO se toca: es lo que evita entregar dos veces. La corrección va en el
// otro lado, en quien decide si la oferta sigue debiéndose.
comprobar(
  "reenviar el material cancela lo pendiente",
  /cancelPendingActionsForConvo\(conversationId\);\s*\r?\n\s*setPendingDeliverySource\(conversationId, null\);/.test(
    pago
  ),
  "intacto"
);
comprobar(
  "y el reenvío termina volviendo a pasar por la continuación",
  /entregarUpsell\(conversationId\)/.test(pago) &&
    /continuarTrasEntrega/.test(pago),
  "sí"
);

// ── 2. La oferta se vuelve a programar si se perdió ─────────────────────────
comprobar(
  "existe la pregunta «¿se le debe todavía la oferta?»",
  /const laOfertaSigueDebiendose =/.test(engine),
  "sí"
);
comprobar(
  // ESTE es el fallo. Con solo "nunca se le ofreció", cualquier cancelación
  // deja la segunda venta muerta para siempre.
  "no basta con que nunca se le haya ofrecido",
  /!fresco\.upsell_state \|\|\s*\r?\n\s*\(fresco\.upsell_state === "esperando" &&/.test(
    engine
  ),
  "también si se debe"
);
comprobar(
  "se reprograma solo si NO quedó ninguna programada",
  /!hasPendingActionType\(convo\.id, ACTION_UPSELL_PRESENTAR\)\);/.test(engine),
  "sí"
);
comprobar(
  "y esa pregunta es la que decide si se ofrece",
  /if \(isUpsellUsable\(config\) && laOfertaSigueDebiendose\) \{/.test(engine) &&
    !/if \(isUpsellUsable\(config\) && !fresco\.upsell_state\) \{/.test(engine),
  "sí"
);

// ── 3. Lo que NO puede romperse al arreglarlo ───────────────────────────────
comprobar(
  // El estado se marca ANTES de presentarla justamente para que dos entregas
  // seguidas no la programen dos veces. Si eso se pierde, el cliente recibe la
  // oferta duplicada.
  "el estado se sigue marcando al programar, no al presentar",
  /setUpsellState\(convo\.id, "esperando"\);\s*\r?\n\s*scheduleAction\(\s*\r?\n\s*convo\.id,\s*\r?\n\s*ACTION_UPSELL_PRESENTAR,/.test(
    engine
  ),
  "sin duplicar"
);
comprobar(
  // "pagado" y "rechazado" son finales: ahí la oferta ya no se debe.
  "pagado o rechazado ya no reabren la oferta",
  !/upsell_state === "pagado"[\s\S]{0,80}?laOfertaSigueDebiendose/.test(engine),
  "cerrada"
);
comprobar(
  "si ofrecerla falla, el regalo NO se pierde",
  /no pude ofrecerlo, sigo con el regalo/.test(engine) &&
    /seguirConRegalo\(convo\.id\);\s*\r?\n\}/.test(engine),
  "sigue"
);

console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} comprobación(es) mal.`);
process.exit(fallos === 0 ? 0 : 1);
