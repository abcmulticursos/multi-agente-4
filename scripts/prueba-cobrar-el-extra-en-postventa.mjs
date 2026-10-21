// El segundo producto se ofrecia despues de la compra, y justo ahi el bot se
// quedaba sin saber cobrar.
//
// EL CEREBRO SE QUEDA SIN LA SECCION DE PAGO EN POSTVENTA.
//
// Es a proposito y esta bien: cuando el cliente ya compro se quitan las
// secciones "pago" y "precio_cierre" (~2.500 tokens) porque no hay que venderle
// nada. El problema es que el extra se vende EXACTAMENTE ahi.
//
// Lo que paso de verdad: el cliente ya habia comprado, el bot le presento el
// extra y el cliente pregunto "se paga a la misma cuenta". El modelo no tenia
// metodos, ni datos, ni la regla del marcador. Improviso dos veces:
//
//   1. ofrecio billeteras que no estaban configuradas para ese pais -- el
//      guardarail lo detecto y le hizo repetir la llamada entera (una llamada
//      al modelo tirada a la basura)
//   2. escribio un numero de cuenta y un titular que no era el de ese pais
//
// Y AUNQUE HUBIERA PEDIDO LOS DATOS BIEN, LLEGABAN MAL.
//
// El reenvio deterministico no sabia nada del extra: mandaba los datos del
// PRIMER producto con el PRECIO DEL PRIMERO. El cliente pagaba de menos y su
// comprobante entraba como pago parcial de algo que ya estaba pagado.
//
// Ahora: en postventa con el extra en juego, el modelo pide los datos con el
// marcador y el sistema manda los del extra con SU precio. Cada fase cobra con
// lo suyo.
//
//   node scripts/prueba-cobrar-el-extra-en-postventa.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");

const cerebro = leer("src", "lib", "openrouter.ts");
const engine = leer("src", "lib", "workflow", "engine.ts");
const handler = leer("src", "lib", "meta", "handler.ts");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 60)} ${valor}`);
};

// ── 1. En postventa con el extra en juego, el modelo usa el marcador ────────
comprobar(
  "hay una regla de pago para el extra en postventa",
  /SECOND-PRODUCT PAYMENT/.test(cerebro),
  "SECOND-PRODUCT PAYMENT"
);
comprobar(
  "solo se activa con el extra ofrecido o aceptado",
  /isPostSale &&\s*\r?\n\s*\(convo\?\.upsell_state === "ofrecido" \|\| convo\?\.upsell_state === "aceptado"\)/.test(
    cerebro
  ),
  "ofrecido / aceptado"
);
comprobar(
  // ESTE es el fallo: sin esto el modelo escribia el numero y el titular.
  "le prohibe escribir cuenta, titular o monto",
  /SECOND-PRODUCT PAYMENT[\s\S]{0,600}do NOT write any account number, holder name or amount yourself/.test(
    cerebro
  ),
  "los manda el sistema"
);
comprobar(
  "y le da la puerta correcta",
  /SECOND-PRODUCT PAYMENT[\s\S]{0,700}<<REENVIAR_PAGO>>/.test(cerebro),
  "marcador"
);

// ── 2. El reenvio manda los datos del extra, no los del primer producto ─────
const reenvio = engine.slice(
  engine.indexOf("export async function resendPaymentDetails"),
  engine.indexOf("function getUpsellPaymentResponses") > 0
    // La ventana se mide por lo que hay que comprobar, no por lo que medía la
    // función el día que se escribió esto: el 22/09/2026 se le añadió al reenvío
    // la salida que respeta el texto del dueño y esto se quedó fuera de los
    // 4.000 sin que el código del extra cambiara. Se amplía con holgura.
    ? engine.indexOf("export async function resendPaymentDetails") + 7000
    : undefined
);
comprobar(
  "el reenvio reconoce que el extra esta en juego",
  /convo\.upsell_state === "ofrecido" \|\| convo\.upsell_state === "aceptado"/.test(
    reenvio
  ),
  "upsell_state"
);
comprobar(
  "usa los pasos de pago DEL EXTRA",
  /getUpsellPaymentResponses\(config, route, convo\.phone\)/.test(reenvio),
  "sus propios pasos"
);
comprobar(
  // Mandar el precio del primer producto es cobrar de menos: el comprobante
  // entra como parcial y la venta del extra no se cierra.
  "y el precio DEL EXTRA",
  /getUpsellPriceSoles\(/.test(reenvio),
  "su propio precio"
);
comprobar(
  "si el extra no tiene pasos propios, no se fuerza esta ruta",
  /if \(upsellSteps\.length > 0\)/.test(reenvio),
  "sin pasos, sigue el camino normal"
);

// ── 3. Lo que NO se toca ───────────────────────────────────────────────────
// El camino del primer producto sigue leyendo SUS respuestas. Lo unico que
// cambio es que un reenvio ya no repite la presentacion de primera vez —los
// datos son los mismos, y siguen saliendo de `getPaymentResponses`.
comprobar(
  "el reenvio normal del primer producto sigue igual",
  /const completos = getPaymentResponses\(config, route, orderBumpChoice, convo\.phone\);/.test(
    engine
  ) && /const steps = comoReenvio\(completos\);/.test(engine),
  "intacto"
);
comprobar(
  "el marcador se sigue atendiendo en el panel",
  /if \(\/<<\\s\*REENVIAR_PAGO\\s\*>>\/i\.test\(reply\)\)/.test(handler),
  "handler intacto"
);
comprobar(
  "y si no hay metodo guardado, el cliente igual ve el menu",
  /if \(!ok\) await sendPaymentOffer\(latestPaymentConvo\);/.test(handler),
  "respaldo intacto"
);
comprobar(
  "la entrega de datos al aceptar el extra sigue en pie",
  /export async function entregarDatosDePagoDelUpsell/.test(engine),
  "entregarDatosDePagoDelUpsell"
);

console.log(
  fallos === 0
    ? "\nTODO OK — el extra se cobra con sus datos y su precio"
    : `\n${fallos} FALLA(S)`
);
process.exit(fallos === 0 ? 0 : 1);
