// El regalo se metia en medio de la venta del segundo producto.
//
// LO QUE PASO (convo 48, del log de Alberto)
//
//   1. Compra el basico. Se le ofrece el segundo producto y lo acepta:
//        [wf:upsell] convo 48: aceptado → datos de pago (yape, 7500)
//   2. Antes de pagarlo, pide subir al FULL. Paga el saldo:
//        [wf:pago] convo 48 APROBADO (total: $7.000 ARS)
//   3. Y justo detras de ESA entrega:
//        [wf] pregunta de consent del regalo programada para convo 48 en 60s
//   4. Con dos preguntas abiertas a la vez, el cliente escribio
//      "si quiero comprarlo" pensando en el segundo producto — y el bot le
//      contesto por el regalo. La venta quedo colgada.
//
// POR QUE
//
// La entrega del upgrade vuelve a pasar por el cierre post-entrega, y ahi el
// regalo sale siempre que la oferta del extra no este "pendiente". Con el extra
// ya ACEPTADO, la condicion no se cumplia y el regalo salia igual.
//
// El plazo del extra ya tenia esta misma regla —"aceptado y pagando, aplazo el
// regalo"— pero solo dentro de SU temporizador. En el cierre post-entrega
// faltaba.
//
// Y hay un detalle que no se puede olvidar: la entrega CANCELA todo lo pendiente
// de la conversacion, asi que ese plazo se perdio por el camino. Sin reponerlo,
// callar aqui dejaria al cliente sin regalo para siempre.
//
// ── Y EL TEXTO DUPLICADO ────────────────────────────────────────────────────
//
// Al aceptar el segundo producto llegaba esto, en este orden:
//
//   «¡Genial! Me alegra que te guste 😊»          ← del modelo
//   «✅ ¡Perfecto! puedes adquirir el curso...»    ← datos de pago
//   «Dale, te paso los datos...»                  ← del modelo otra vez
//   «🔴 Transferencia: ...»                       ← datos de pago
//
// El texto del modelo se repartia en burbujas CON PAUSAS, y los datos de pago
// tambien van programados: los dos se intercalaban, y encima decian lo mismo.
//
//   node scripts/prueba-regalo-no-se-mete-en-medio.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");

const engine = leer("src", "lib", "workflow", "engine.ts");
const handler = leer("src", "lib", "meta", "handler.ts");
const cerebro = leer("src", "lib", "openrouter.ts");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 60)} ${valor}`);
};

// ── 1. El regalo espera si el extra sigue en juego ──────────────────────────
const cierre =
  engine.match(
    /export async function continuarTrasEntrega\([\s\S]*?\r?\n\}\r?\n/
  )?.[0] ?? "";

comprobar("el cierre post-entrega está donde se le busca", cierre.length > 0, "sí");
comprobar(
  // ESTE es el fallo. Sin esto, la entrega del upgrade suelta el regalo encima
  // de una venta abierta.
  "con el extra ofrecido o aceptado, el regalo no sale",
  /if \(\s*\r?\n\s*fresco\.upsell_state === "ofrecido" \|\|\s*\r?\n\s*fresco\.upsell_state === "aceptado"\s*\r?\n\s*\) \{/.test(
    cierre
  ),
  "espera"
);
comprobar(
  // La entrega cancela lo pendiente: sin reponer el plazo, el regalo no llegaría
  // NUNCA. Callar sin reponer sería cambiar un fallo por otro peor.
  "y se repone el plazo del extra, que la entrega canceló",
  /if \(!hasPendingActionType\(convo\.id, ACTION_UPSELL_TIMEOUT\)\) \{[\s\S]*?ACTION_UPSELL_TIMEOUT,/.test(
    cierre
  ),
  "se repone"
);
comprobar(
  "sin duplicarlo si ya estaba puesto",
  /!hasPendingActionType\(convo\.id, ACTION_UPSELL_TIMEOUT\)/.test(cierre),
  "solo si falta"
);
comprobar(
  "y queda escrito en el registro",
  /el extra sigue en juego, el regalo espera/.test(cierre),
  "sí"
);
comprobar(
  // Sin extra en juego, todo sigue como siempre.
  "sin extra en juego el regalo sale igual que antes",
  /seguirConRegalo\(convo\.id\);\s*\r?\n\}/.test(cierre),
  "intacto"
);
comprobar(
  // Aquí se calla el regalo, pero el plazo del extra TIENE que acabar
  // soltándolo. Cuando escribí esto, ese plazo se aplazaba a sí mismo con el
  // estado en «aceptado» y el regalo no llegaba nunca: callar aquí lo volvía
  // un candado. Se quitó — el detalle está en
  // prueba-el-regalo-no-se-queda-colgado.mjs.
  "y el plazo del extra sí acaba soltándolo",
  !/aceptado y pagando, aplazo el regalo/.test(engine) &&
    /silencio cumplido \(estado /.test(engine),
  "sin candado"
);

// ── 2. El texto del modelo, de una vez y antes ─────────────────────────────
comprobar(
  // En trozos programados se intercalaba con los datos de pago.
  "el texto del modelo sale de una sola vez",
  /if \(leftover\) await sendBotText\(freshUpsell, leftover\);/.test(handler),
  "sin trocear"
);
comprobar(
  // Los datos salen DESPUÉS, ahora a través de la función que respeta lo que
  // el dueño escribió para aceptar el extra. El orden es lo que se vigila aquí.
  "y antes que los datos de pago",
  /await sendBotText\(freshUpsell, leftover\);[\s\S]{0,400}?await aceptarElExtraComoLoEscribioElDueno\(freshUpsell\);/.test(
    handler
  ),
  "en orden"
);
comprobar(
  // El mensaje de pago YA dice "puedes adquirirlo así": decirlo dos veces suena
  // a bot repitiéndose.
  "y al modelo se le pide una sola frase, sin anunciar los datos",
  /Reply with ONE short warm sentence only/.test(cerebro) &&
    /Do NOT announce that you are sending the data/.test(cerebro),
  "sí"
);

console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} comprobación(es) mal.`);
process.exit(fallos === 0 ? 0 : 1);
