// Subir de opción es subir AL COMBO. Nunca «a la más cara».
//
// LO QUE PASO — 16 de septiembre de 2026, en la etapa de descuento. El registro
// del dueño decía esto, y la palabra «subo» no es una errata:
//
//     [wf:pago] abono 10500 cubre "basico" (6000) — subo "combo" → "basico"
//
// Había elegido el COMBO, pagó de más, y el motor lo pasó al BÁSICO. Le entregó
// el producto pequeño a quien había pedido el grande.
//
// LA CAUSA. La línea buscaba «la opción con precio mayor» y la trataba como la
// superior. Eso vale mientras el combo sea el caro —que es lo normal—, pero el
// descuento no tiene por qué respetar esa escalera. Medido con su contenido,
// ejecutando `getOrderBumpPriceSoles`:
//
//     sin descuento     basico 10    combo 14      escalera correcta
//     con descuento     combo  7     basico  8     CRUZADA
//
// Con los precios cruzados, «la más cara» es la pequeña y ascender lleva hacia
// abajo. Y no es la rareza de un contenido: pasa igual en los dos bots.
//
// LA REGLA BUENA NO ES DE PRECIO, ES DE QUÉ CONTIENE QUÉ. El combo ES el básico
// más algo, así que subir solo puede ir de básico a combo. Y se exige ADEMÁS que
// el combo cueste más: si el descuento lo dejó por debajo, pagar el precio del
// básico no demuestra que quisiera el combo — regalarlo sería entregar de más.
//
// AQUÍ SE EJECUTA EL CÓDIGO DE VERDAD, sacado del archivo. Los precios son
// inventados a propósito: lo que se prueba es la escalera, no los suyos.
//
//   node scripts/prueba-subir-es-subir-al-combo.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const pago = readFileSync(
  join(RAIZ, "src", "lib", "workflow", "payment.ts"),
  "utf8"
).replace(/\r\n/g, "\n");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// ── El cálculo real, sacado del archivo ──────────────────────────────────────
const trozo = (desde, hasta) => {
  const i = pago.indexOf(desde);
  if (i < 0) return "";
  const f = pago.indexOf(hasta, i);
  return f < 0 ? "" : pago.slice(i, f + hasta.length);
};
const lineaCurrent = trozo(
  "const current = choices.find((item) => item.choice === obChoice);",
  ";"
);
const lineaCombo = trozo(
  'const elCombo = choices.find((item) => item.choice === "combo");',
  ";"
);
const lineaHigher = trozo("const higher =\n      current && obChoice ===", "undefined;");
if (!lineaCurrent || !lineaCombo || !lineaHigher) {
  throw new Error("no encuentro el cálculo de la opción superior en payment.ts");
}

const decidir = new Function(
  "choices",
  "obChoice",
  [lineaCurrent, lineaCombo, lineaHigher, "return { current, higher };"].join("\n")
);

// ── Las dos escaleras, con precios inventados ────────────────────────────────
const NORMAL = [
  { choice: "basico", price: 10 },
  { choice: "combo", price: 14 },
];
// La del descuento, cruzada: el combo rebajado cuesta MENOS que el básico.
const CRUZADA = [
  { choice: "combo", price: 7 },
  { choice: "basico", price: 8 },
];

console.log("\n— con la escalera de siempre, nada cambia —\n");
const normalDesdeBasico = decidir(NORMAL, "basico");
comprobar(
  "quien eligió el básico puede subir al combo",
  normalDesdeBasico.higher?.choice === "combo",
  "es el que contiene al otro"
);
comprobar(
  "y el precio al que sube es el del combo",
  normalDesdeBasico.higher?.price === 14
);
const normalDesdeCombo = decidir(NORMAL, "combo");
comprobar(
  "quien ya eligió el combo no sube a ningún sitio",
  normalDesdeCombo.higher === undefined,
  "ya está arriba"
);

console.log("\n— y con la escalera cruzada, no baja a nadie —\n");
const cruzadaDesdeCombo = decidir(CRUZADA, "combo");
comprobar(
  "quien eligió el combo NO acaba en el básico",
  cruzadaDesdeCombo.higher === undefined,
  "era el fallo de su registro"
);
// LA OTRA MITAD, que es la que se regalaría: con el combo por debajo, pagar el
// precio del básico no demuestra que quisiera el combo.
const cruzadaDesdeBasico = decidir(CRUZADA, "basico");
comprobar(
  "y quien eligió el básico tampoco se lleva el combo de regalo",
  cruzadaDesdeBasico.higher === undefined,
  "el combo cuesta menos: no prueba nada"
);

console.log("\n— y con una sola opción configurada, no se inventa nada —\n");
for (const [nombre, lista] of [
  ["solo el básico", [{ choice: "basico", price: 10 }]],
  ["solo el combo", [{ choice: "combo", price: 14 }]],
]) {
  const r = decidir(lista, lista[0].choice);
  comprobar(`${nombre}: no sube`, r.higher === undefined);
}

// ── La forma, para que no se deshaga sin querer ──────────────────────────────
console.log("\n— la forma del arreglo —\n");
comprobar(
  "la dirección la decide el papel, no el precio",
  /obChoice === "basico" && elCombo/.test(pago),
  "de básico a combo, nunca al revés"
);
comprobar(
  "y además el combo tiene que costar más",
  /elCombo\.price > current\.price/.test(pago),
  "si no, no prueba nada"
);
// LO QUE NO PUEDE VOLVER: elegir la superior por precio.
comprobar(
  "ya no busca «la más cara»",
  !/const higher = current\s*\n?\s*\? choices\.find\(\(item\) => item\.price > current\.price\)/.test(
    pago
  ),
  "esa era la línea"
);
// Y SI LA ESCALERA ESTÁ CRUZADA, QUE SE VEA: puede ser a propósito o un
// descuento mal puesto, y eso solo lo sabe el dueño. Callarlo es lo que costó
// encontrarlo en un registro de madrugada.
comprobar(
  "y avisa por consola cuando los precios están cruzados",
  /NO cuesta más que la menor/.test(pago),
  "revisa los precios en el editor"
);

// ── Y LA ETAPA DEL EXTRA NO PASA POR AQUÍ ───────────────────────────────────
//
// Lo preguntó el dueño: «¿consideraste la etapa de upsell?». En esta mitad la
// respuesta es que este bloque entero se aparta cuando el comprobante es del
// producto extra — y tiene que seguir siendo así. Si esa guarda se cae, el
// dinero del extra volvería a contarse para subir de opción en la PRIMERA venta,
// que es el fallo que su propio comentario cuenta ahí arriba: «el cliente se
// llevaba el ascenso pagado con el dinero del segundo producto».
console.log("\n— y el comprobante del extra no entra aquí —\n");
comprobar(
  "el bloque se aparta si el pago es del extra",
  /isTwoTierActive\(\) &&\s*\n\s*!esPagoDeUpsell &&/.test(pago),
  "el extra lleva su propia cuenta"
);
comprobar(
  "y el extra es del extra mientras esté ofrecido o aceptado",
  /const esPagoDeUpsell =\s*\n\s*!pidioSubirAlCombo &&\s*\n\s*\(convo\.upsell_state === "aceptado" \|\| convo\.upsell_state === "ofrecido"\);/.test(
    pago
  ),
  "las dos etapas en que se le cobra"
);

console.log(
  fallos === 0
    ? "\nTODO OK — subir lleva al combo, y solo cuando de verdad es subir\n"
    : `\n${fallos} comprobacion(es) mal.\n`
);
process.exit(fallos === 0 ? 0 : 1);
