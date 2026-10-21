// «Ya pagué 7000, si pago 500 me entregan» — y el bot lo dio por aceptado.
//
// LO QUE PASO
//
//   El cliente ya habia comprado y subido del basico al full. Se le ofrecio el
//   producto EXTRA (independiente, con su propio precio). Pregunto si con 500
//   mas se lo entregaban —una idea equivocada, porque no es una diferencia— y
//   en vez de explicarselo, el bot lo tomo por un «si» y le mando los datos de
//   pago.
//
//   Dos caminos distintos llevaban al mismo error, y los dos por UNA palabra
//   suelta dentro de una frase larga:
//
//     detectaSiSimpleAlUpsell   miraba solo el PRINCIPIO -> «YA pague 7000...»
//     los cuadritos del extra   tienen «si» de palabra clave -> «...SI pago...»
//
//   Sin tildes, «si» y «si» son la misma palabra. Y la gente no escribe signos
//   de interrogacion. Asi que ninguna lista puede distinguir la pregunta de la
//   afirmacion: hace falta ENTENDER la frase.
//
// LA REGLA
//
//   La lista se queda con lo que puede afirmar sin entender nada: que el
//   mensaje ES esa respuesta. Todo lo demas lo decide el modelo, que ya tiene
//   el marcador <<QUIERE_EXTRA>> y la instruccion de emitirlo solo cuando la
//   intencion es clara. Ninguna venta se pierde; solo se piensa donde hace
//   falta pensar.
//
// LO QUE VIGILA ESTA PRUEBA
//
//   1. El «si» a secas cubre el mensaje ENTERO, no solo su principio.
//   2. El vocabulario NO cambio: las mismas palabras de antes, ni una mas.
//   3. Un «si»/«ok»/«dale» pelado sigue aceptando al instante y sin tokens.
//   4. Los cuadritos del extra: una palabra clave de UNA palabra solo decide en
//      respuestas cortas; las de varias y el comodin siguen igual.
//   5. Los cuadritos de la INTRO no se tocaron.
//
//   node scripts/prueba-una-pregunta-no-es-un-si.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");
const tipos = leer("src", "lib", "workflow", "config.ts");
const motor = leer("src", "lib", "workflow", "engine.ts");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// ── 1. El «si» a secas, anclado a los dos extremos ───────────────────────────
const siSimple = (() => {
  const i = tipos.indexOf("export function detectaSiSimpleAlUpsell(");
  return i < 0 ? "" : tipos.slice(i, i + 1400);
})();
const lista = (siSimple.match(/return \/\^\(([^)]*)\)(\$|\\b)\//) ?? [null, "", ""]);
comprobar(
  "el «si» a secas exige el mensaje entero",
  lista[2] === "$",
  lista[2] === "$" ? "^(...)$" : "^(...)\\b  ← solo mira el principio"
);

// ── 2. Mismo vocabulario que antes, ni una palabra mas ───────────────────────
//
// El arreglo NO es «reconocer mejor»: es dejar de decidir donde no se puede.
// Si alguien intenta arreglarlo añadiendo palabras, esto lo detiene.
const VOCABULARIO_ORIGINAL = [
  "si", "sii+", "claro", "dale", "ya", "obvio", "dame", "lo quiero", "la quiero",
  "me lo llevo", "me la llevo", "quiero", "dalee+", "dale pues", "dale si",
  "dsp no", "dale ok", "ok", "okey", "dale gracias", "si porfa", "si por favor",
  "si quiero", "sip", "dale vamos",
];
const actual = lista[1].split("|");
comprobar(
  "no se añadio ni una palabra al vocabulario",
  actual.length === VOCABULARIO_ORIGINAL.length &&
    actual.every((p, i) => p === VOCABULARIO_ORIGINAL[i]),
  `${actual.length} palabras`
);

// ── 3. La regla, ejecutada ───────────────────────────────────────────────────
const reconoce = (msg) => {
  const t = (msg ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .replace(/[!¡.,¿?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return false;
  return new RegExp(`^(${lista[1]})$`).test(t);
};
console.log("\n--- el «si» a secas ---");
for (const [msg, esperado] of [
  ["si", true],
  ["dale", true],
  ["ok", true],
  ["ya", true],
  ["si quiero", true],
  ["dale ok", true],
  ["Sí!", true],
  ["ya pague 7000 si pago 500 me entregan", false],
  ["si pago 500 me entregan", false],
  ["ya tengo el basico", false],
  ["quiero saber si tiene descuento", false],
  ["ok pero cuanto sale", false],
]) {
  const dio = reconoce(msg);
  comprobar(`«${msg}»`, dio === esperado, dio ? "acepta" : "va al modelo");
}

// ── 4. Los cuadritos del extra ───────────────────────────────────────────────
const cuadritos = (() => {
  const i = motor.indexOf("function decisionDeLaOfertaDelExtra(");
  return i < 0 ? "" : motor.slice(i, i + 3600);
})();
comprobar(
  "el extra mide si es una respuesta corta",
  /const esRespuestaCorta = /.test(cuadritos),
  "esRespuestaCorta"
);
comprobar(
  "una clave de varias palabras sigue valiendo siempre",
  /clave\.includes\(" "\)/.test(cuadritos),
  "«si quiero», «no por ahora»"
);
comprobar(
  "el comodin (sin palabras) sigue valiendo siempre",
  /if \(claves\.length === 0\) return true;/.test(cuadritos),
  "es una eleccion explicita, no una adivinanza"
);

// La regla, ejecutada con TUS cuadritos de hoy.
const limpiar = (t) =>
  (t ?? "").toLowerCase().normalize("NFD").replace(/\p{Mn}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const CUADRITOS_DE_HOY = [
  { title: "SI QUIERO", keywords: ["sí", "si", "ok", "esta bien", "si quiero", "sí quiero", "quiero", "claro"] },
  { title: "NO QUIERO", keywords: ["no", "no gracias", "no quiero", "por ahora no", "no deseo", "otro dia"] },
];
const decide = (msg) => {
  const dicho = ` ${limpiar(msg)} `;
  const corta = dicho.trim().split(" ").filter(Boolean).length <= 4;
  for (const d of CUADRITOS_DE_HOY) {
    const claves = d.keywords.map(limpiar).filter(Boolean);
    if (!claves.some((k) => dicho.includes(` ${k} `))) continue;
    if (corta) return d.title;
    if (claves.length === 0) return d.title;
    if (claves.some((k) => k.includes(" ") && dicho.includes(` ${k} `))) return d.title;
    return null;
  }
  return null;
};
console.log("\n--- los cuadritos, con tu configuracion de hoy ---");
for (const [msg, esperado] of [
  ["si", "SI QUIERO"],
  ["si quiero", "SI QUIERO"],
  ["no gracias", "NO QUIERO"],
  ["ya pague 7000 si pago 500 me entregan", null],
  ["y ese otro que me ofreciste es nuevo", null],
  ["no entiendo cuanto tengo que pagar ahora", null],
  ["si quiero pero cuando me lo mandan", "SI QUIERO"],
]) {
  const dio = decide(msg);
  comprobar(
    `«${msg}»`,
    dio === esperado,
    `${dio ?? "nadie decide → modelo"}`
  );
}

// ── 5. La intro no se toco ───────────────────────────────────────────────────
//
// «un poco / no mucho» tiene que seguir eligiendo NO en la intro: es una
// respuesta larga con la palabra suelta, justo lo que aqui se restringio. Por
// eso la restriccion vive en `decisionDeLaOfertaDelExtra` y NO en
// `decisionQueCoincide`, que es la compartida.
const compartida = (() => {
  const i = tipos.indexOf("export function decisionQueCoincide(");
  return i < 0 ? "" : tipos.slice(i, i + 1600);
})();
comprobar(
  "la funcion compartida no mide longitud",
  !/esRespuestaCorta|length <= 4/.test(compartida),
  "la intro sigue igual"
);

console.log(`\n${fallos === 0 ? "TODO OK — una pregunta ya no es un si" : `${fallos} FALLOS`}`);
process.exit(fallos === 0 ? 0 : 1);
