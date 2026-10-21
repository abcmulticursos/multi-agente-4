// DE «COMO HOY» A COMO OB CON LOS DATOS DE PAGO YA ENVIADOS (su prueba HP1, 18/10/2026).
//
// LO QUE PASÓ: la conversación recibió los datos de pago vendiendo UN producto (queda en
// «payment_done» sin opción elegida). La tienda pasó a COMO OB y el cliente preguntó «¿qué trae
// el curso?». La IA recibió los DOS productos y le habló de dos cursos, sin que la intro de
// order bump se hubiera mostrado nunca. Su regla dura: «del producto full no se dice ni el
// precio ni el contenido» hasta que el motor lo destapa con la segunda intro.
//
// QUÉ PROTEGE:
//   1. Las dos puertas que deciden «sigue oculto» incluyen este caso, con la MISMA condición:
//      `orderBumpDeferredUntilPayment` (el bloque de los dos productos y el aviso) y
//      `elOrderBumpSigueOculto` (modo un producto, fotos).
//   2. Solo este caso: «payment_done» + sin elegir + segunda intro NUNCA mostrada. Con la intro
//      mostrada o la opción elegida, todo sigue igual.
//   3. Lo de antes sigue intacto (intro_done tras un seguimiento, o sin ofrecer en el primer mensaje).
//
//   node scripts/prueba-la-transicion-a-ob-con-pago-enviado.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const fuente = readFileSync(join(process.cwd(), "src", "lib", "openrouter.ts"), "utf8");
let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 66)} ${valor}`);
};

const CASO = /convo\?\.state === "payment_done" && !convo\.order_bump_choice && elSegundoProductoSigueTapado\(convo\)/g;

console.log("\n— 1. las dos puertas —\n");
const diferido = fuente.slice(fuente.indexOf("const orderBumpDeferredUntilPayment ="), fuente.indexOf("// CON DOS OPCIONES A LA VISTA Y SIN ELEGIR"));
comprobar("el bloque de los dos productos lo frena", CASO.test(diferido));
CASO.lastIndex = 0;
const oculto = fuente.slice(fuente.indexOf("function elOrderBumpSigueOculto("), fuente.indexOf("return diferido || transicion;") + 30);
comprobar("el modo un producto y las fotos, también", CASO.test(oculto) && /return diferido \|\| transicion;/.test(oculto));
CASO.lastIndex = 0;
comprobar("y la segunda sabe de la marca de la segunda intro", /order_bump_revealed\?: number \| null;/.test(oculto));

console.log("\n— 2. y lo de antes, intacto —\n");
comprobar("intro_done tras un seguimiento sigue diferido", /convo\?\.state === "intro_done" &&\s*!convo\.order_bump_choice &&\s*\(convo\.last_followup_index >= 0 \|\|/.test(diferido));
comprobar("sin ofrecer en el primer mensaje sigue diferido", /orderBump\?\.offer_on_intro_first_message === false\)\) \|\|/.test(diferido));
comprobar("el bloque de -OB- se inyecta con la misma condición de siempre", /isOrderBumpActive\(\) &&\s*!orderBumpPostSale &&\s*!orderBumpDeferredUntilPayment/.test(fuente));
comprobar("la herramienta del segundo producto, solo tras destapar o elegir", /convo\.state === "awaiting_order_bump_choice" \|\|\s*convo\.order_bump_choice === "combo" \|\|/.test(fuente));

console.log(`\n${fallos === 0 ? "TODO OK — sin la segunda intro, el segundo producto sigue oculto también tras la transición" : `${fallos} FALLO(S)`}\n`);
process.exit(fallos === 0 ? 0 : 1);
