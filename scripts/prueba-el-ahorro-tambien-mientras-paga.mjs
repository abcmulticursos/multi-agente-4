// El paquete de ahorro también cubre la etapa en la que el cliente paga.
//
// DE DONDE SALE
//
//   Sus tres respuestas rápidas de Lineal eran TODAS de `intro_done`: valen
//   antes de que el cliente tenga la cuenta. En cuanto la tiene, la conversación
//   pasa a `payment_done` y no quedaba ni una — así que la etapa donde más
//   escribe la gente, y donde más se repiten las mismas cuatro preguntas, se iba
//   entera al modelo. Order Bump ya tenía dos reglas ahí; Lineal, ninguna.
//
//   La pregunta que hizo en su propia prueba —«a que hora me entregan»— es
//   justo una de ellas.
//
// LAS CUATRO
//
//   · reenviar los datos de pago   → lo hace el MOTOR, cero tokens
//   · cuánto tengo que pagar       → sale del comodín del precio
//   · cuándo lo recibo             → «en cuanto me envíes la foto…»
//   · dice que ya pagó, sin foto   → le pide la foto
//
//   Ninguna nombra un producto ni un método: esto es una plantilla.
//
// ESTA PRUEBA EJECUTA EL CODIGO REAL del motor que decide si una regla coincide,
// contra las palabras clave REALES del paquete.
//
//   node scripts/prueba-el-ahorro-tambien-mientras-paga.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const editor = readFileSync(join(RAIZ, "src", "app", "editor", "page.tsx"), "utf8");
const motor = readFileSync(join(RAIZ, "src", "lib", "workflow", "engine.ts"), "utf8");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 60)} ${valor}`);
};

// ── El motor de coincidencia, sacado del propio engine.ts ────────────────────
function sacar(nombre) {
  const i = motor.indexOf(`function ${nombre}(`);
  const f = motor.indexOf("\n}", i);
  return motor.slice(i, f + 2);
}
const sinTipos = (c) =>
  c
    .replace(/\)\s*:\s*[A-Za-z[\]|\s]+\{/g, ") {")
    .replace(/(\w+)\s*:\s*(?:string\[\]|string|SalesbotRule)\s*(?=[,)])/g, "$1");
const { salesbotRuleMatches } = new Function(
  [
    `const LARGO_MINIMO_PARA_TOLERAR_DEDAZOS = ${
      motor.match(/const LARGO_MINIMO_PARA_TOLERAR_DEDAZOS = (\d+);/)?.[1] ?? 5
    };`,
    sinTipos(sacar("normalizeSalesbotText")),
    sinTipos(sacar("areSalesbotWordsClose")),
    sinTipos(sacar("fuzzySalesbotPhraseMatches")),
    sinTipos(sacar("salesbotRuleMatches")),
    "return { salesbotRuleMatches };",
  ].join("\n\n")
)();

// ── Las palabras clave REALES del paquete, leidas del editor ─────────────────
function palabrasDe(id) {
  const i = editor.indexOf(`"${id}",`);
  if (i < 0) return null;
  const trozo = editor.slice(i, i + 1400);
  const lista = trozo.match(/\[\s*([\s\S]*?)\]/);
  if (!lista) return null;
  return lista[1]
    .split(",")
    .map((s) => s.trim().replace(/^"|"$/g, ""))
    .filter((s) => s && !s.startsWith("//"));
}
const comoRegla = (id) => ({ match: "contains_any", keywords: palabrasDe(id) ?? [] });

// ── 1. Las cuatro existen, y en la etapa correcta ────────────────────────────
const LAS_CUATRO = [
  ["ahorro_lineal_pago_datos", "resend_payment"],
  ["ahorro_lineal_pago_monto", "send_text"],
  ["ahorro_lineal_pago_entrega", "send_text"],
  ["ahorro_lineal_pago_avisa", "send_text"],
];
for (const [id, accion] of LAS_CUATRO) {
  const i = editor.indexOf(`"${id}",`);
  const bloque = i < 0 ? "" : editor.slice(i, i + 1600);
  comprobar(
    `existe ${id}`,
    i > 0 && bloque.includes(`"${accion}"`) && /\["payment_done"\]/.test(bloque),
    `${accion} · payment_done`
  );
}

// ── 2. Cogen lo que tienen que coger (codigo real) ───────────────────────────
const DEBEN_COGER = [
  ["ahorro_lineal_pago_entrega", "a que hora me entregan"],
  ["ahorro_lineal_pago_entrega", "cuanto demora"],
  ["ahorro_lineal_pago_monto", "cuanto era"],
  ["ahorro_lineal_pago_monto", "cual es el monto"],
  ["ahorro_lineal_pago_datos", "cual es la cuenta"],
  ["ahorro_lineal_pago_datos", "mandame los datos"],
  ["ahorro_lineal_pago_avisa", "ya pague"],
];
for (const [id, frase] of DEBEN_COGER) {
  comprobar(`«${frase}»`, salesbotRuleMatches(comoRegla(id), frase), id.replace("ahorro_lineal_", ""));
}

// ── 3. Y no se pisan entre ellas ─────────────────────────────────────────────
//
// Con `contains_any` y prioridades, dos reglas que cogen la misma frase hacen
// que gane la de menor numero — y el operador no tiene forma de verlo.
const NO_DEBEN_COGER = [
  ["ahorro_lineal_pago_monto", "a que hora me entregan"],
  ["ahorro_lineal_pago_entrega", "cual es el monto"],
  ["ahorro_lineal_pago_datos", "cuanto era"],
  ["ahorro_lineal_pago_avisa", "cual es la cuenta"],
];
for (const [id, frase] of NO_DEBEN_COGER) {
  comprobar(
    `«${frase}» NO es de ${id.replace("ahorro_lineal_pago_", "")}`,
    !salesbotRuleMatches(comoRegla(id), frase),
    "sin solaparse"
  );
}

// ── 4. Y el comprobante sigue mandando sobre todas ───────────────────────────
//
// «ya pague» es palabra clave de una regla. Con una FOTO delante eso no puede
// quedarse el turno: la regla del comprobante corre ANTES que el salesbot y lo
// manda derecho al lector. Si algun dia se invierte ese orden, un comprobante
// volveria a perderse — y con una respuesta amable, que es lo peor.
comprobar(
  "el comprobante se atiende ANTES que cualquier regla",
  motor.indexOf("derecho al lector, sin desvíos") <
    motor.lastIndexOf("return trySalesbotOrLlm(convo, msgContent, config);"),
  "el orden importa"
);

// ── 5. El reenvio del paquete usa la frase del dueño ─────────────────────────
comprobar(
  "reenviar desde una regla lleva su frase",
  /case "resend_payment":[\s\S]{0,240}?await resendPaymentDetails\(convo, \{ conFrase: true \}\);/.test(
    motor
  ),
  "no cae a secas"
);

// ── 6. Nada de esto nombra un producto ───────────────────────────────────────
const paquete = (() => {
  const i = editor.indexOf('"ahorro_lineal_pago_datos"');
  const f = editor.indexOf('if (modality === "order_bump")');
  return i < 0 || f < 0 ? "" : editor.slice(i, f);
})();
comprobar(
  "y todo sale de comodines, sin nombres propios",
  /\{\{PRECIO_COMPLETO\}\}/.test(paquete) && !/yape|plin|bcp/i.test(paquete),
  "es una plantilla"
);

console.log(
  fallos === 0
    ? "\nTODO OK — la etapa del pago también ahorra"
    : `\n${fallos} comprobacion(es) mal.`
);
process.exit(fallos === 0 ? 0 : 1);
