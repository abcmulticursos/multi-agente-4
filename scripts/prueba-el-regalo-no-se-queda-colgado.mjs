// El regalo no llegaba NUNCA a quien aceptaba el segundo producto sin pagarlo.
//
// LO QUE PASO (convo 49, del log)
//
//   [wf:upsell] convo 49: aceptado → datos de pago (yape, 7500)
//   ...el cliente se va al upgrade y nunca paga ese extra...
//   [wf:pago]   convo 49 APROBADO (total: $7.000 ARS)
//   [wf:upsell] convo 49: el extra sigue en juego, el regalo espera 30 min
//   [wf:upsell] convo 49: sigue hablando, el regalo se corre 30 min más
//   ...y el regalo no salio nunca.
//
// POR QUE
//
// El plazo del segundo producto, al vencer con el estado en "aceptado", SE
// APLAZABA A SI MISMO. La idea era no interrumpir a quien esta en mitad del
// pago — pero como el plazo no se movia con la conversacion, la unica forma de
// no molestar era volver a aplazarlo. Y otra vez. Y otra.
//
// Quien aceptaba el extra y no llegaba a pagarlo se quedaba SIN REGALO PARA
// SIEMPRE. Existia desde antes, pero lo destape yo: al hacer que la entrega del
// upgrade tambien pasara por este plazo, el caso dejo de ser raro.
//
// AHORA
//
// Ya no hace falta aplazar: el plazo se reinicia con CADA mensaje del cliente.
// Si esta accion llega a ejecutarse es porque hubo silencio de verdad durante
// todo el plazo, y ahi no se interrumpe nada.
//
// La oferta del segundo producto NO se cierra: sigue viva y sigue pagable.
//
//   node scripts/prueba-el-regalo-no-se-queda-colgado.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const engine = readFileSync(
  join(RAIZ, "src", "lib", "workflow", "engine.ts"),
  "utf8"
);

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 60)} ${valor}`);
};

const bloque =
  engine.match(
    /if \(action\.action_type === ACTION_UPSELL_TIMEOUT\)[\s\S]*?\n  \}/
  )?.[0] ?? "";

comprobar("el plazo del extra está donde se le busca", bloque.length > 0, "sí");
comprobar(
  // ESTE era el candado. Aplazarse a sí mismo sin condición de salida es un
  // bucle: el regalo no llega nunca.
  "ya no se aplaza a sí mismo",
  !/scheduleAction\([\s\S]{0,140}ACTION_UPSELL_TIMEOUT/.test(bloque),
  "sin bucle"
);
comprobar(
  "y con «aceptado» el regalo sale igual",
  /seguirConRegalo\(convo\.id\);/.test(bloque) &&
    !/upsell_state === "aceptado"/.test(bloque),
  "sale"
);
comprobar(
  // Pagado o rechazado ya se resolvieron por otro camino: soltar el regalo otra
  // vez aquí lo mandaría dos veces.
  "pagado y rechazado siguen saliendo por su camino",
  /if \(convo\.upsell_state === "pagado" \|\| convo\.upsell_state === "rechazado"\) \{\s*\r?\n\s*return;/.test(
    bloque
  ),
  "intacto"
);
comprobar(
  "queda escrito con el estado en que estaba",
  /silencio cumplido \(estado \$\{convo\.upsell_state \?\? "sin ofrecer"\}\)/.test(
    bloque
  ),
  "en el registro"
);
comprobar(
  // Soltar el regalo NO puede cancelar la venta abierta: el cliente todavía
  // puede pagar el extra después.
  "la oferta del extra no se cierra al soltar el regalo",
  !/setUpsellState\(convo\.id, "rechazado"\)/.test(bloque),
  "sigue viva"
);

// ── Lo que sostiene el arreglo ──────────────────────────────────────────────
comprobar(
  // Sin la renovación por silencio, quitar el aplazamiento sí interrumpiría a
  // quien está pagando. Las dos piezas van juntas.
  "el plazo se sigue reiniciando con cada mensaje",
  /function renovarEsperaDelRegalo\(/.test(engine) &&
    /renovarEsperaDelRegalo\(convo, config\);/.test(engine),
  "sí"
);
comprobar(
  "y la entrega del upgrade sigue reponiendo el plazo",
  /el extra sigue en juego, el regalo espera/.test(engine),
  "intacto"
);

console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} comprobación(es) mal.`);
process.exit(fallos === 0 ? 0 : 1);
