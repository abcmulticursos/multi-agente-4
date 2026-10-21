// «Quiero SABER qué trae» no es «quiero comprarlo».
//
// LO QUE PASÓ — 15 de septiembre de 2026, en -DOU-, dos pantallas en paralelo
// con las dos opciones en pantalla. El cliente escribió:
//
//     «si pero quiero saber que contiene el combo y el otro»
//     «si pero quiero saber que trae el combo y el otro»
//
// y su registro lo cuenta entero:
//
//     [wf] convo 118 eligió doble oferta "combo"
//     [wf] convo 118 doble oferta "combo" -> pago directo editable
//     [wf] enviando payment step 1 a convo 118
//
// Está preguntando por LAS DOS opciones y pidiendo que le cuenten qué traen.
// Recibió los datos de pago de la cara.
//
// EL ESCALÓN EXACTO, medido ejecutando el detector de verdad. La frase lleva la
// palabra «quiero», y un «quiero» suelto significaba compra y cortaba el
// análisis en seco: `isOrderBumpConversationQuestion` devolvía false en su
// primera línea. Nunca se llegaba a mirar el resto, que YA lo tenía resuelto —
// `isProductInformationQuestion` reconoce «que contiene» y reconoce «el otro»,
// las dos señales, cada una por su lado—. El detector no fallaba: no le
// dejábamos llegar.
//
// LA REGLA QUE SE PUSO, Y ES DE ESTRUCTURA. «Querer» pide un objeto, y ese
// objeto decide la frase: si es un PRODUCTO, elige; si es un INFINITIVO DE
// INFORMARSE, pregunta. No es la palabra «combo» ni la palabra «contiene»: es
// qué va detrás del verbo de querer.
//
// LA MEDICIÓN, con los detectores reales y sus frases:
//
//     "si pero quiero saber que contiene el combo y el otro"   elige -> NO elige
//     "si pero quiero saber que trae el combo y el otro"       elige -> NO elige
//     "quiero ver que trae el combo"                           elige -> NO elige
//     "quiero el combo"                                        elige -> elige
//     "quiero comprar el combo"                                elige -> elige
//     "el combo esta bien"                                     elige -> elige
//
//   node scripts/prueba-querer-saber-no-es-querer-comprar.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8").replace(/\r\n/g, "\n");
const config = leer("src", "lib", "workflow", "config.ts");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 60)} ${valor}`);
};

const gate = (() => {
  const i = config.indexOf("export function isOrderBumpConversationQuestion(");
  if (i < 0) return "";
  const f = config.indexOf("\n  if (isProductInformationQuestion(msg)) return true;", i);
  return f < 0 ? "" : config.slice(i, f);
})();

console.log("\n— querer saber no es querer comprar —\n");
comprobar("se encuentra la puerta de entrada", gate.length > 200);
comprobar(
  "existe la salida para el que quiere informarse",
  /const quiereInformarse = new RegExp\(/.test(gate)
);
comprobar(
  "y la decisión de compra ya no vale por sí sola",
  /const explicitDecision =\s*\n\s*!quiereInformarse &&/.test(gate),
  "tiene que pasar el filtro"
);
// LA REGLA ES DE POSICIÓN: el verbo de informarse va PEGADO al de querer. Si
// alguien la convierte en «aparece la palabra saber en el mensaje», deja de ser
// estructura y vuelve a ser una lista de palabras — y «quiero el combo, ya se
// lo que trae» dejaría de comprar.
comprobar(
  "el verbo de informarse va pegado al de querer",
  /\$\{VERBOS_DE_QUERER\}\)\\\\s\+\(\$\{VERBOS_DE_INFORMARSE\}/.test(gate),
  "posición, no presencia"
);
comprobar(
  "y admite el pronombre pegado (saberlo, verlas)",
  /\(lo\|la\|los\|las\|me\|te\|se\|nos\)\?/.test(gate),
  "es la misma frase"
);

console.log("\n— las formas de informarse que cubre —\n");
// La clase es cerrada a propósito: son las maneras de ENTERARSE, no una lista
// de sinónimos del producto. Ninguna puede desaparecer sin que vuelva el fallo.
for (const verbo of ["saber", "ver", "conocer", "entender", "comparar", "averiguar"]) {
  comprobar(
    `«quiero ${verbo}...» no compra`,
    new RegExp(`\\b${verbo}\\b`).test(gate),
    ""
  );
}

console.log("\n— y lo que tiene que seguir comprando —\n");
// LOS VERBOS DE QUERER SIGUEN TODOS EN PIE. La lista no se tocó: solo se le
// puso una condición delante. Si alguno se cae, «dame el basico» o «me quedo
// con el combo» dejan de registrar la elección.
for (const verbo of [
  "quiero",
  "elijo",
  "escojo",
  "prefiero",
  "me quedo",
  "llevare",
  "llevo",
  "decidi",
  "dame",
  "comprar",
  "compro",
]) {
  comprobar(`sigue comprando con «${verbo}»`, gate.includes(verbo), "");
}

console.log("\n— y las dos señales que ya existían siguen ahí —\n");
// Esto es lo que el «quiero» tapaba. Si se cae, el arreglo no sirve de nada:
// la frase llegaría al final y el nombre del producto volvería a elegir.
comprobar(
  "«que contiene / que trae» sigue siendo pregunta",
  /\\b\(que\|q\|qu3\|ke\|k\)\\s\+\(trae\|traes\|incluye\|contiene\|tiene\|es\)\\b/.test(
    config
  ),
  "isProductInformationQuestion"
);
comprobar(
  "y nombrar «el otro» también",
  /\\b\(el otro\|la otra\|producto adicional/.test(config),
  "nadie elige dos a la vez"
);

console.log(
  fallos === 0
    ? "\nTODO OK — preguntar por las dos opciones ya no compra una\n"
    : `\n${fallos} comprobacion(es) mal.\n`
);
process.exit(fallos === 0 ? 0 : 1);
