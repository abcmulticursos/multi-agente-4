// Cuantas puertas pueden tragarse un comprobante antes de que alguien lo lea.
//
// Aprobar un ticket es simple: leer el monto, compararlo con lo que debia pagar
// y comprobar que no sea repetido. Esa parte casi nunca fallo.
//
// Lo complicado es que el ticket LLEGUE al lector. El motor tiene DECENAS de
// sitios donde puede decir «esto lo contesto yo» y quedarse el turno, y cada
// uno tenia que acordarse por su cuenta de que una foto no se toca. Unos se
// acuerdan y otros no: el del re-envio de datos NO se acordaba, aunque su
// comentario juraba que si.
//
// Todos los fallos de comprobante han sido eso — una puerta que se olvido—,
// nunca que el lector leyera mal. Arreglarlas de una en una es perder: son
// demasiadas y siempre queda una.
//
// LO QUE VIGILA ESTA PRUEBA
//
//   1. La regla se dice UNA vez y ANTES que ninguna puerta.
//   2. Cuenta cuantas puertas quedan por delante de un comprobante. Debe ser
//      cero: el numero es el que hay que mirar cuando alguien toque esto.
//   3. Las tres excepciones siguen en pie — son las que impiden que esto
//      salpique al regalo, a la eleccion de opcion y al correo.
//
//   node scripts/prueba-el-comprobante-va-derecho-al-lector.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const motor = readFileSync(join(RAIZ, "src", "lib", "workflow", "engine.ts"), "utf8");
const L = motor.split(/\r?\n/);

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// ── 1. La regla existe y esta antes que las puertas ────────────────────────
const inicio = L.findIndex((t) =>
  /export async function tryWorkflowOnIncoming\(/.test(t)
);
const laRegla = L.findIndex(
  (t, i) => i > inicio && /if \(latestIsImage && esperandoUnPago && !laImagenAquiNoEsUnPago\)/.test(t)
);
let fin = L.findIndex(
  (t, i) => i > inicio + 5 && /^(export )?(async )?function /.test(t)
);
if (fin < 0) fin = L.length;

comprobar("la regla del comprobante existe", laRegla > 0, `linea ${laRegla + 1}`);
comprobar(
  "y suelta el turno en vez de contestar",
  /return false;/.test(L.slice(laRegla, laRegla + 6).join("\n")),
  "va al lector"
);

// ── 2. EL NUMERO: puertas por delante de un comprobante ────────────────────
//
// Se cuentan los «me quedo el turno» que un mensaje con foto podria alcanzar.
// Antes de la regla eran todas las de la funcion; ahora tienen que ser cero.
const puertas = (desde, hasta) => {
  let n = 0;
  for (let i = desde; i < hasta; i++) {
    if (/^\s*return true;\s*$/.test(L[i] ?? "")) n++;
  }
  return n;
};
const antesDeLaRegla = puertas(inicio, laRegla);
const despuesDeLaRegla = puertas(laRegla, fin);

console.log(
  `\n     puertas ANTES de la regla:   ${antesDeLaRegla}  (las alcanza el comprobante)`
);
console.log(
  `     puertas DESPUES de la regla: ${despuesDeLaRegla}  (ya no las alcanza)\n`
);
comprobar(
  // Las que quedan delante son los guardias legitimos: canal equivocado,
  // /reiniciar, pais apagado, aviso de Venezuela. Ninguna contesta al cliente
  // sobre su pago. Si este numero crece, alguien metio una puerta por delante.
  "casi ninguna puerta alcanza ya al comprobante",
  antesDeLaRegla <= 5,
  `${antesDeLaRegla} guardias de entrada`
);
comprobar(
  "y las que se lo tragaban quedan todas detras",
  despuesDeLaRegla > 40,
  `${despuesDeLaRegla} puertas neutralizadas`
);
comprobar(
  // El fallo de la conversacion real: esta puerta va DESPUES de la regla.
  "el re-envio de datos ya no puede tragarse la foto",
  motor.indexOf("RE-ENVÍO DETERMINÍSTICO DE DATOS DE PAGO") >
    motor.indexOf("if (latestIsImage && esperandoUnPago"),
  "queda detras"
);

// ── 3. Las excepciones, que son lo que evita salpicar ──────────────────────
const bloque = L.slice(Math.max(0, laRegla - 12), laRegla + 2).join("\n");
const EXCEPCIONES = [
  ["la eleccion de opcion sigue leyendo su foto", "awaiting_order_bump_choice"],
  ["el regalo sigue recibiendo su captura", "awaiting_facebook_comment"],
  ["y su consentimiento", "awaiting_gift_consent"],
  ["el correo no confunde una imagen con un pago", "awaiting_email"],
];
for (const [que, estado] of EXCEPCIONES) {
  comprobar(que, bloque.includes(estado), estado);
}
comprobar(
  // Sin esto la regla dispararia con cualquier foto en cualquier momento —una
  // captura de una duda, una pantalla del curso— y mandaria al lector cosas
  // que no son pagos.
  "solo actua cuando se espera un pago",
  /const esperandoUnPago =\s*\r?\n\s*state === "payment_done" \|\|\s*\r?\n\s*yaLeDimosLaCuenta \|\|\s*\r?\n\s*convo\.upsell_state === "ofrecido" \|\|\s*\r?\n\s*convo\.upsell_state === "aceptado";/.test(
    motor
  ),
  "pago pendiente o extra ofrecido"
);
// «ESPERAR UN PAGO» ES UN HECHO, NO SOLO UNA ETAPA.
//
// Esto se apoyaba SOLO en la etapa. Un camino que mandaba los datos sin dejar la
// etapa apuntada dejaba la conversacion en `intro_done` con la cuenta ya
// enviada: llego el voucher con «listo ya pague, a que hora me manda», la regla
// no se activo, y una respuesta rapida de la etapa anterior se quedo el turno.
// Si tiene un metodo anotado es que se le dieron los datos.
comprobar(
  "y tambien si ya tiene la cuenta delante aunque la etapa se quedara atras",
  /const yaLeDimosLaCuenta =\s*\r?\n\s*!!convo\.selected_payment_method\?\.trim\(\) &&\s*\r?\n\s*laVentaTodaviaNoLlegoAlPago\(state\);/.test(
    motor
  ),
  "el hecho manda sobre la etapa"
);
// Limitado a las etapas de ANTES del pago: en la postventa una imagen puede ser
// cualquier cosa y esa puerta no se abre.
comprobar(
  "sin abrir esa puerta en la postventa",
  /function laVentaTodaviaNoLlegoAlPago\(/.test(motor),
  "solo antes del pago"
);
comprobar(
  "y deja rastro en el registro",
  /derecho al lector, sin desvíos/.test(motor),
  "diagnosticable"
);

console.log(
  fallos === 0
    ? "\nTODO OK — un comprobante ya no depende de que 70 puertas se acuerden"
    : `\n${fallos} FALLA(S)`
);
process.exit(fallos === 0 ? 0 : 1);
