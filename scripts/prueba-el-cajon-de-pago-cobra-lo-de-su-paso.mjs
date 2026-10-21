// El cajon de pago del pais tiene que cobrar EL PRECIO DE SU PASO.
//
// {{METODO_DE_PAGO_1}} y {{METODO_DE_PAGO_PRINCIPAL}} son texto que el operador
// escribe por pais, y ese texto lleva dentro sus propios comodines de precio
// ({{PRECIO_COMPLETO}}). Asi que hay dos momentos posibles para abrir el cajon:
//
//   a) DENTRO DEL MOTOR, donde se sabe el precio de ESTE paso (el del basico,
//      el del full o el del extra, segun a que venta pertenece el paso).
//   b) AL ENVIAR, donde ese precio ya no existe y solo queda el CONGELADO en la
//      conversacion, que es el de la compra anterior.
//
// Si se abre en (b), el segundo producto pide el monto del primero. Paso de
// verdad: se aceptaba el extra de 7.500 y los datos de pago decian 6.000. No es
// un hueco vacio que se note — es un numero creible y equivocado, y nadie lo ve
// hasta que llega el comprobante corto.
//
// LO QUE VIGILA ESTA PRUEBA
//
//   1. El motor abre el cajon ANTES de resolver el precio, no despues.
//   2. Las dos entradas del extra le pasan SU precio, no el del curso.
//   3. El comprobante del extra se valida contra el precio del extra.
//   4. Todo cajon que este puesto en un texto viaja por el motor.
//
// El punto 4 es el que se rompe solo: basta con que alguien pegue un
// {{METODO_DE_PAGO_1}} en una burbuja de intro o de seguimiento para que ese
// cajon salga por la ruta del emisor, con el precio congelado.
//
//   node scripts/prueba-el-cajon-de-pago-cobra-lo-de-su-paso.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");
const YAML = createRequire(join(RAIZ, "package.json"))("yaml");

const motor = leer("src", "lib", "workflow", "engine.ts");
const emisor = leer("src", "lib", "workflow", "sender.ts");
const pagos = leer("src", "lib", "workflow", "payment.ts");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// ── 1. El motor abre el cajon antes de poner el precio ─────────────────────
const paso = motor.slice(
  motor.indexOf("async function sendResponseStep("),
  motor.indexOf("async function sendResponseStep(") + 2500
);
const abre = paso.indexOf("expandirCajonesDePagoDelPais(t, convo)");
const pone = paso.indexOf("applyPriceTemplate(withTwoTier, price, convo)");
comprobar(
  "el motor abre el cajon del pais al armar el paso",
  abre > 0,
  "expandirCajonesDePagoDelPais"
);
comprobar(
  "y lo abre ANTES de resolver el precio",
  abre > 0 && pone > abre,
  abre > 0 && pone > abre ? "el precio del paso entra al cajon" : "ORDEN INVERTIDO"
);

// ── 2. Las dos entradas del extra cobran lo del extra ──────────────────────
const trozo = (desde, largo) => {
  const i = motor.indexOf(desde);
  return i < 0 ? "" : motor.slice(i, i + largo);
};
const entrega = trozo("export async function entregarDatosDePagoDelUpsell(", 2400);
comprobar(
  "al aceptar el extra se manda el precio del extra",
  /getUpsellPriceSoles\(/.test(entrega) &&
    /schedulePaymentResponses\([\s\S]{0,160}priceSoles: precio/.test(entrega),
  "getUpsellPriceSoles"
);
// La ventana se mide por lo que hay que comprobar, no por lo que medía la
// función el día que se escribió esto: el 22/09/2026 se le añadió al reenvío la
// salida que respeta el texto del dueño, y la afirmación de abajo se quedó fuera
// de los 2.400 sin que el codigo hubiera cambiado. Se amplía con holgura.
const reenvio = trozo("export async function resendPaymentDetails(", 5200);
comprobar(
  // «pasame los datos otra vez» mientras el extra esta vivo se refiere a ESA
  // venta, no a la que ya cerro.
  "al reenviar los datos con el extra vivo, tambien",
  /upsell_state === "ofrecido"[\s\S]{0,900}getUpsellPriceSoles\(/.test(reenvio),
  "su propia salida"
);

// ── 3. El comprobante del extra se mide con el precio del extra ────────────
comprobar(
  "el comprobante del extra no se mide con el precio congelado",
  /priceSoles = precioUpsell;\s*\r?\n\s*priceSource = "upsell";/.test(pagos),
  "priceSource = upsell"
);

// ── 4. El emisor conserva su propia apertura ───────────────────────────────
//
// Es la red para los textos que NO pasan por el motor. No sobra: sin ella esos
// saldrian con las llaves a la vista, que es peor que con el precio viejo.
comprobar(
  "el emisor sigue abriendo el cajon por su lado",
  /const withInserts = expandirCajonesDePagoDelPais\(text, convo\);/.test(emisor),
  "red de seguridad"
);

// ── 5. Ningun cajon puesto fuera de un paso de pago ────────────────────────
//
// Un cajon dentro de una burbuja de intro o de seguimiento viaja por el emisor,
// y ahi solo existe el precio congelado.
const cfg = YAML.parse(leer("config", "intro-data.yaml"));
const RUTA_DE_PAGO =
  /(^|\.)payment_responses(\.|\[)|(^|\.)direct_payment_steps\[|(^|\.)direct_payment_without_choice_steps\[/;
const fuera = [];
(function recorrer(nodo, ruta) {
  if (typeof nodo === "string") {
    if (/\{\{\s*metodo_(de_)?pago_/i.test(nodo) && !RUTA_DE_PAGO.test(ruta))
      fuera.push(ruta);
    return;
  }
  if (Array.isArray(nodo))
    return nodo.forEach((v, i) => recorrer(v, `${ruta}[${i}]`));
  if (nodo && typeof nodo === "object")
    for (const [k, v] of Object.entries(nodo))
      recorrer(v, ruta ? `${ruta}.${k}` : k);
})(cfg, "");
comprobar(
  "todo cajon puesto en un texto viaja por el motor",
  fuera.length === 0,
  fuera.length ? fuera.slice(0, 3).join(" · ") : "ninguno suelto"
);

console.log(
  fallos === 0
    ? "\nTODO OK — el cajon de pago cobra el precio del paso que lo lleva"
    : `\n${fallos} FALLA(S)`
);
process.exit(fallos === 0 ? 0 : 1);
