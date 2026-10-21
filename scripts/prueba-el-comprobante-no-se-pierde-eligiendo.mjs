// ¿SE PIERDE UN COMPROBANTE QUE LLEGA MIENTRAS EL CLIENTE ELIGE?
//
// LO QUE PASO — 2 de octubre de 2026, su prueba en «como -DOU-», convo 468. Mando el
// comprobante con un pie de foto que nombraba una opcion. El pie se leyo como eleccion, se
// le enviaron los datos de pago, y el turno termino ahi. Su comprobante no lo abrio nadie:
// en su registro NO HAY NI UNA LINEA de pago para esa conversacion — ni aprobado, ni
// parcial, ni rechazado. Silencio.
//
// Con sus palabras: «el bot recibio la imagen, pero no me aprobo la compra de 8».
//
// LA REGLA YA EXISTIA, y es lo que duele: esta escrita desde semanas antes en la puerta del
// reenvio de datos de pago, con este comentario —
//
//     «UN TURNO CON COMPROBANTE NO SE INTERCEPTA JAMAS. El cliente manda la foto y escribe
//      en la misma burbuja. Si esa frase caia en los detectores de abajo, este bloque se
//      quedaba el turno, le reenviaba los datos de pago y el modelo NUNCA veia la imagen:
//      nadie leia el monto y la venta no se registraba. Y no era un retraso, era una
//      perdida.»
//
// — y FALTABA en la puerta de la eleccion de «como -DOU-». El fallo de siempre de este
// proyecto: la misma regla en dos sitios y arreglada en uno.
//
// QUE VIGILA ESTA PRUEBA, y por que mira el fuente en vez de correr una conversacion: la
// puerta vive dentro de `tryWorkflowOnIncoming`, que necesita servidor, base de datos y
// worker. El recorrido completo cubre eso; aqui se fija lo que el recorrido no distingue —
// que la guarda siga ESTANDO, en esta puerta y en la de arriba, y que sea la MISMA.
//
//   node scripts/prueba-el-comprobante-no-se-pierde-eligiendo.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const fuente = readFileSync(
  join(RAIZ, "src", "lib", "workflow", "engine.ts"),
  "utf8"
);

let fallos = 0;
const comprobar = (titulo, condicion, detalle) => {
  const marca = condicion ? "  ok  " : "> FALLA";
  if (!condicion) fallos++;
  console.log(`${marca} ${titulo.padEnd(56)} ${detalle ?? ""}`);
};

// -- 1. LA PUERTA DE LA ELECCION DE -DOU- SUELTA EL TURNO CON UNA FOTO --------
//
// Se busca el trozo que va DESDE el arranque de la puerta HASTA su primer detector de
// eleccion. La guarda tiene que estar dentro: si se cuela despues, el detector ya se quedo
// el turno y el comprobante se perdio igual.
const puerta = fuente.indexOf('if (state === "awaiting_doble_oferta_dos_choice") {');
comprobar(
  "la puerta de la eleccion de -DOU- existe",
  puerta > 0,
  "awaiting_doble_oferta_dos_choice"
);
const trasPuerta = fuente.slice(puerta, puerta + 4000);
const hastaElDetector = trasPuerta.slice(0, trasPuerta.indexOf("detectTwoTierPick"));
comprobar(
  "con una foto NO se queda el turno, antes de mirar el texto",
  /if \(estaFotoLlegaEnEsteMensaje\)/.test(hastaElDetector),
  "la guarda va ANTES del detector de eleccion"
);
comprobar(
  "y el turno se lo pasa a quien sabe leer el monto",
  /if \(estaFotoLlegaEnEsteMensaje\)[\s\S]{0,400}?return trySalesbotOrLlm\(/.test(
    hastaElDetector
  ),
  "no lo cierra en seco: lo entrega"
);

// -- 2. LA SEÑAL ES ESTRECHA, Y ESO ES LA GARANTIA ---------------------------
//
// Tiene que preguntar por la foto de ESTE mensaje, NO por `latestIsImage`. La ancha tambien
// vale cuando la foto llego en otro mensaje del mismo bloque sin contestar, y aqui eso
// abriria la puerta en turnos de SOLO TEXTO — que son los que registran la eleccion. Seria
// romper las seis semimodalidades de golpe, justo lo que el dueño prohibio.
//
// En una pasada del recorrido en lineal saltaron dos comprobaciones de datos de pago con la
// señal ancha puesta. Con la estrecha ese camino es imposible.
comprobar(
  "pregunta por la foto de ESTE mensaje, no por la señal ancha",
  /const estaFotoLlegaEnEsteMensaje =[\s\S]{0,260}?media_type === "image"/.test(
    hastaElDetector
  ) && !/if \(latestIsImage\)/.test(hastaElDetector),
  "un mensaje escrito pasa de largo aunque haya fotos alrededor"
);
comprobar(
  "y no se cuela la señal ancha dentro de la estrecha",
  !/const estaFotoLlegaEnEsteMensaje =[\s\S]{0,260}?pairedUserMedia/.test(
    hastaElDetector
  ),
  "sin pairedUserMedia: eso es lo que la haria ancha"
);

// -- 3. LA REGLA HERMANA SIGUE EN PIE ----------------------------------------
//
// La de arriba es la original. Si alguien la quita, este arreglo se queda solo y vuelve el
// mismo fallo por el otro camino — que es exactamente como nacio este.
comprobar(
  "la regla original del reenvio sigue puesta",
  /UN TURNO CON COMPROBANTE NO SE INTERCEPTA JAMÁS/.test(fuente),
  "las dos puertas dicen lo mismo"
);
comprobar(
  "y las dos preguntan por la MISMA señal",
  (fuente.match(/latestIsImage/g) ?? []).length >= 6,
  "nadie se inventa su propia forma de ver una foto"
);

// -- 4. LO QUE QUEDA FUERA, DICHO A PROPOSITO --------------------------------
//
// En «como -OB-» esta puerta NO lleva la guarda, y es una decision de la casa: su estado de
// eleccion esta en `laImagenAquiNoEsUnPago`, o sea «una imagen aqui NO es un pago». Se deja
// como esta y se deja escrito, para que el dia que el dueño lo vea no parezca un olvido.
comprobar(
  "en -OB- la casa decidio que una imagen eligiendo no es un pago",
  /laImagenAquiNoEsUnPago[\s\S]{0,300}?awaiting_order_bump_choice/.test(fuente),
  "no se toca, queda anotado"
);

console.log("");
if (fallos > 0) {
  console.log(`> ${fallos} FALLA(S)`);
  process.exit(1);
}
console.log("TODO OK — un comprobante no se pierde por llegar mientras elige");
