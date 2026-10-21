// «no costaba 10» es una pregunta, no una eleccion.
//
// LO QUE PASO — 14 de septiembre de 2026, -OB-
//
//   Con las dos opciones en pantalla, el cliente se hizo el desentendido y
//   escribio:
//
//       «no entiendo»
//       «no costaba 10»
//
//   preguntando por el precio que le habian dicho. El registro:
//
//       [wf] convo 63 eligió order bump "basico"
//       [wf] convo 63 eligio "basico" -> pago directo editable
//
//   Le dio ese producto por elegido y le mando sus datos de pago.
//
// LA CAUSA: UNA CONJUGACION A MEDIAS
//
//   `isPriceQuestion` conocia `cuesta` y `cuestan`, pero no `costaba`, `costo`
//   ni `costaria`. Como nadie lo reconocio como pregunta, el «10» cayo en el
//   buscador de precios de `detectTwoTierPick`, coincidio con el importe del
//   basico, y decidio la venta.
//
// EL ARREGLO
//
//   Se completan DOS listas que ya existian y ya tenian esa forma:
//     · `isPriceQuestion` — el mismo verbo en otro tiempo;
//     · «el numero no elige» — que ya descartaba el numero de cantidad («son 3»,
//       «tengo 2») y ahora tambien el numero que el cliente REPITE porque se lo
//       dijeron.
//
//   node scripts/prueba-repetir-un-precio-no-es-elegirlo.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const config = readFileSync(
  join(RAIZ, "src", "lib", "workflow", "config.ts"),
  "utf8"
);

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 50)} ${valor}`);
};

// ── Los detectores reales ────────────────────────────────────────────────────
const fn = (firma, nombre) => {
  const i = config.indexOf(firma);
  if (i < 0) throw new Error(`no encuentro ${nombre}`);
  const f = config.indexOf("\n}", i);
  return (
    config
      .slice(i, f)
      .replace(
        /(?:export )?function (\w+)\((\w+): string\): boolean \{/,
        "function $1($2) {"
      ) + "\n}"
  );
};
const { isPriceQuestion } = new Function(
  fn("export function isPriceQuestion(msg: string): boolean {", "isPriceQuestion") +
    "\nreturn { isPriceQuestion };"
)();

// El trozo que decide si un numero elige, sacado de detectTwoTierPick.
const iNum = config.indexOf("const numberIsQuantity =");
const bloqueNum = config.slice(iNum, config.indexOf(";", config.indexOf("valia)\\b/.test(", iNum)) + 1);
const elNumeroNoElige = (msg) =>
  new Function(
    "normalized",
    bloqueNum + "\nreturn numberIsQuantity;"
  )(msg.toLowerCase());

// ── 1. El caso que desvio la compra ──────────────────────────────────────────
console.log("— repetir un precio que le dijeron NO es elegirlo —\n");
const PREGUNTAS = [
  "no costaba 10",
  "no entiendo no costaba 10",
  "no era 10",
  "no me dijiste 10",
  "no estaba a 10",
  "no decia 10",
  "costaba 10 no",
  "me habias dicho 10",
];
for (const frase of PREGUNTAS) {
  comprobar(
    `«${frase}»`,
    isPriceQuestion(frase) || elNumeroNoElige(frase),
    "no elige producto"
  );
}

// ── 2. ELEGIR POR PRECIO SIGUE FUNCIONANDO ───────────────────────────────────
//    Es la puerta que permite «el de 10» o «quiero el de 14». Si se rompiera,
//    se perderia una forma normal de elegir.
console.log("\n— pero elegir por el precio sigue valiendo —\n");
const ELECCIONES = ["el de 10", "quiero el de 14", "dame el de 10", "el de diez"];
for (const frase of ELECCIONES) {
  comprobar(
    `«${frase}»`,
    !isPriceQuestion(frase) && !elNumeroNoElige(frase),
    "el numero sigue eligiendo"
  );
}

// -- 2-bis. LA «S» QUE SUENA IGUAL QUE LA «C» ---------------------------------
//
//    LO QUE PASO — 25 de septiembre de 2026. El dueno aviso de que iba a probar
//    escribiendo mal a proposito, y nombro «presio». Medido: «presio» y «cual es
//    el presio» NO se leian como pregunta de precio, mientras «cuanto vle» y
//    «qanto cuesta» si.
//
//    Y EL RIESGO NO ES QUE NO CONTESTE: es el mismo de la seccion 1. Sin
//    reconocerla como pregunta, el numero que venga detras cae en el buscador de
//    importes y le da un producto por elegido.
//
//    NO ES UNA PALABRA NUEVA EN UNA LISTA: es la MISMA palabra. En America
//    Latina la c, la s y la z suenan igual, asi que quien escribe rapido usa
//    cualquiera de las tres. Se cubren las tres de una vez.
console.log("\n- y la misma palabra escrita como suena -\n");
for (const frase of [
  "presio",
  "cual es el presio",
  "q presio tiene",
  "prezio",
  "presios",
]) {
  comprobar(`«${frase}»`, isPriceQuestion(frase), "sigue siendo pregunta");
}

// ── 3. Y las preguntas de precio de siempre ──────────────────────────────────
console.log("\n— y las preguntas de siempre, intactas —\n");
for (const frase of ["cuanto cuesta", "cual es el precio", "que vale", "a como"]) {
  comprobar(`«${frase}»`, isPriceQuestion(frase), "sigue siendo pregunta");
}

// ── 4. La forma ──────────────────────────────────────────────────────────────
console.log("\n— la forma del arreglo —\n");
comprobar(
  "las listas de antes NO se tocaron",
  // «precio|precios» quedo escrito como «pre[csz]ios?» — la MISMA palabra con la
  // letra que suena igual (ver 2-bis). El resto de la lista, intacto.
  /pre\[csz\]ios\?\|cuesta\|cuestan\|/.test(config) &&
    /son\|eran\|hay\|habia\|habian\|tengo\|tienes\|cuantos\|cuantas/.test(config),
  "solo se anadio"
);
comprobar(
  "y el numero de cantidad se sigue descartando aparte",
  /\|\|\s*\r?\n?\s*\/\\b\(costaba\|costaban\|costo\|costaria\|era\|estaba/.test(
    config
  ),
  "dos motivos distintos"
);

console.log(
  fallos === 0
    ? "\nTODO OK — preguntar un precio ya no compra un producto"
    : `\n${fallos} comprobacion(es) mal.`
);
process.exit(fallos === 0 ? 0 : 1);
