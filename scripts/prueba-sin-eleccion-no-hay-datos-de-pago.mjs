// Con DOS opciones, nadie recibe datos de pago sin haber elegido.
//
// ES SU REGLA, ESCRITA POR EL — para -DOU- y para -OB-:
//
//     «Aparentemente no hay manera que reciba datos de pago sin elección.»
//
// Si la habia. Se llama `maybeSendDirectPaymentWithoutChoice`, su nombre lo dice,
// y esta desde el primer commit.
//
// LO QUE COSTO — 16 de septiembre de 2026, convo 127. Escribio su metodo de pago
// sin que su eleccion se hubiera registrado, y recibio DOS burbujas con precio
// seguidas:
//
//     «estos son los datos de pago»
//     «Yape/Plin: ... Monto: S/. 7 SOLES»              <- ni 14 ni 10
//     «Recuerda que tenemos 2 productos: 14 ... 10»    <- los de verdad
//
// DE DONDE SALIA ESE 7. El paso no lleva precio —por eso el log dice «sin
// precio»— asi que el comodin {precio} cae al precio base del bot,
// `course_price_soles`. Esa caja es UNA y la comparten todas las modalidades: el
// reparto por fichas solo la refresca para el producto UNICO y para el BASICO de
// Bioferta. En Doble Oferta y en Order Bump se queda con lo ultimo que escribio
// otro. En su contenido valia 10 —el precio de su opcion menor— y la burbuja
// parecia correcta; el 15 de septiembre paso a 7 y canto.
//
// Y EL MOTOR YA HACIA LO CORRECTO UNA LINEA ANTES, en el mismo turno:
//
//     [wf] anoto su metodo sin interrumpir la eleccion;
//          al elegir producto los datos saldran por ahi     <- su regla
//     [wf] pidio pago sin elegir doble oferta               <- y esto la pisa
//
// EL COMODIN NO SE TOCA. Las catorce rutas que si pasan precio siguen igual:
// {precio} sale del producto elegido en la intro, en los seguimientos, en la
// oferta y en la entrega. Lo que se corta es el unico camino que llegaba hasta
// el sin tener ningun precio que dar.
//
//   node scripts/prueba-sin-eleccion-no-hay-datos-de-pago.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const motor = readFileSync(
  join(RAIZ, "src", "lib", "workflow", "engine.ts"),
  "utf8"
).replace(/\r\n/g, "\n");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

const puerta = (() => {
  const i = motor.indexOf("async function maybeSendDirectPaymentWithoutChoice(");
  if (i < 0) return "";
  const f = motor.indexOf("\n}", i);
  return f < 0 ? "" : motor.slice(i, f);
})();

console.log("\n— con dos opciones y sin elección, no salen datos de pago —\n");
comprobar("se encuentra la puerta del pago directo", puerta.length > 300);
comprobar(
  "solo corta en Doble Oferta",
  /isDobleOfertaActive\(\) &&/.test(puerta),
  "lineal y -OB- no se enteran"
);
// ORDER BUMP QUEDA FUERA A PROPÓSITO, y se midió. Ahí nombrar el método es el
// gesto que DESTAPA el segundo producto, y lo que sale detrás es su presentación
// —tres burbujas suyas—, no unos datos de pago sueltos. Corriendo la venta con
// el candado ancho, -OB- pasaba de 3 burbujas a 1 y perdía el destape.
comprobar(
  "y queda escrito por qué -OB- no entra",
  /ORDER BUMP TAMPOCO SE TOCA/.test(puerta) &&
    /pasaba de 3 burbujas a 1/.test(puerta),
  "para que nadie lo ensanche sin medir"
);
comprobar(
  "y solo mientras no haya elección anotada",
  /convo\.order_bump_choice !== "combo" &&\s*\n\s*convo\.order_bump_choice !== "basico"/.test(
    puerta
  ),
  "con elección, sigue como siempre"
);
comprobar(
  "en su lugar le recuerda las 2 opciones",
  /await sendTwoOptionsReminder\(convo, config\);/.test(puerta),
  "lo mismo que ya hace -OB-"
);
comprobar(
  "y queda dicho en el log, no en silencio",
  /nombró su método sin haber elegido \$\{source\}/.test(puerta),
  "se ve por qué no salieron"
);
comprobar(
  "consume el turno: el modelo no improvisa encima",
  /await sendTwoOptionsReminder\(convo, config\);[\s\S]{0,400}?return true;/.test(
    puerta
  ),
  "una sola respuesta"
);

// ── LO QUE NO SE PUEDE HABER ROTO ───────────────────────────────────────────
console.log("\n— y lo que estaba bien sigue igual —\n");
// EL MÉTODO SE SIGUE ANOTANDO. Lo hace `anotarMetodoElegidoDuranteLaEleccion`
// ANTES de llegar aquí, y es lo que permite que al elegir producto los datos
// salgan por SU método sin repreguntar nada. Si eso se cayera, el cliente
// tendría que volver a elegir método — que es justo lo que él no quiere.
comprobar(
  "el método se sigue anotando durante la elección",
  /function anotarMetodoElegidoDuranteLaEleccion\(/.test(motor) &&
    /anoto su método \(\$\{metodo\}\) sin interrumpir la elección/.test(motor),
  "al elegir producto salen por ahí"
);
// EN LINEAL NO SE TOCA NADA: ahí hay un producto y un precio, y nombrar el
// método es lo único que falta para cobrar.
comprobar(
  "en lineal el pago directo sigue entero",
  /shouldUseDirectPayment\(config, "without_choice", convo\.phone\)/.test(puerta) &&
    /await schedulePaymentResponses\(/.test(puerta),
  "un producto, un precio"
);
// Y LAS GUARDAS DE SIEMPRE, que ya estaban: solo yape/plin, y nunca con una
// queja o una negación del método de por medio.
comprobar(
  "sigue sin dispararse con una queja del método",
  /messageHasPaymentConcern\(msgContent\) \|\|/.test(puerta),
  "«me robaron con el yape»"
);
comprobar(
  "y sigue siendo solo para los métodos de cobro directo",
  /\(route !== "yape" && route !== "plin"\) \|\|/.test(puerta),
  "como antes"
);

// ── EL COMODÍN, QUE ES LO QUE ÉL NO QUERÍA QUE SE TOCARA ────────────────────
console.log("\n— el comodín {precio} no se ha tocado —\n");
comprobar(
  "sigue mandando el precio que le pasa cada ruta",
  /const price =\s*\n?\s*priceOverride \?\?\s*\n?\s*getLockedOrCurrentBasePrice\(convo, config\);/.test(
    motor
  ),
  "las 14 rutas que sí lo pasan, iguales"
);

console.log(
  fallos === 0
    ? "\nTODO OK — sin elección no hay datos de pago, y el comodín intacto\n"
    : `\n${fallos} comprobacion(es) mal.\n`
);
process.exit(fallos === 0 ? 0 : 1);
