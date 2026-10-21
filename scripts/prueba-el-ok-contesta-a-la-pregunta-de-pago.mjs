// EL «OK» QUE CONTESTA A LA PREGUNTA DE PAGO. SOLO EN LINEAL.
//
// LO QUE PASABA
//
//   La intro de Lineal termina preguntando como quiere pagar, y el dueño deja
//   ahi sus cuadritos: uno por metodo. Esos cuadritos se disparan por las
//   palabras que el escribe, y las corrientes —«si», «ok», «dale», «listo»—
//   estan apartadas a proposito (`PALABRAS_QUE_NO_SEÑALAN`), con razon: un «ok»
//   pelado no señala NI yape NI bcp.
//
//   Asi que el cliente decidia comprar, escribia «ok» o «lo llevo», y el turno
//   se iba al modelo, que le volvia a preguntar el metodo.
//
//   Sus palabras, el 21 de septiembre de 2026: «en lineal es perdida de tiempo;
//   es un solo producto, la eleccion de metodo no deberia ser una condicion
//   para soltar los datos».
//
// COMO SE ARREGLO
//
//   NO CON UNA LISTA DE PALABRAS. Lo que decide es que la PREGUNTA DE PAGO siga
//   abierta: se abre al terminar la intro y se cierra cuando el cliente tiene
//   metodo anotado. Por eso aguanta que se desvie —puede preguntar tres cosas
//   antes de decir «ok»— y por eso no se repite despues. La afirmacion solo
//   desempata dentro de esa regla.
//
//   Y DEVUELVE SU CUADRITO, no un texto de fabrica: asi sale lo que el escribio,
//   y el dia que encienda sus burbujas salen las suyas sin tocar una linea.
//
// LO QUE NO PUEDE VOLVER A PASAR
//
//   1. Que esto se extienda a otra modalidad. En -OB- el metodo es la primera
//      eleccion A PROPOSITO —destapa la segunda intro— y en las de dos opciones
//      falta saber CUAL producto.
//   2. Que se adelante al cuadrito del dueño: quien escriba su palabra tiene que
//      seguir yendo a SU cuadrito, no al del metodo principal.
//   3. Que conteste a una pregunta o a una duda sobre el pago.
//   4. Que aparezca un nombre de metodo escrito a mano. Es una plantilla: el
//      metodo principal sale del pais, no del codigo.
//
//   node scripts/prueba-el-ok-contesta-a-la-pregunta-de-pago.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const motor = readFileSync(join(RAIZ, "src", "lib", "workflow", "engine.ts"), "utf8");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

const trozo = (nombre) => {
  const i = motor.indexOf(`function ${nombre}(`);
  if (i < 0) return "";
  const j = motor.indexOf("\n}", i);
  return j < 0 ? motor.slice(i) : motor.slice(i, j + 2);
};
const regla = trozo("esUnaAfirmacionALaPreguntaDePagoDeLineal");
const conCuadrito = trozo("elCuadritoDePagoDeUnaAfirmacion");

// -- 1. EXISTE, Y SOLO EN LINEAL ---------------------------------------------
comprobar(
  "la regla existe",
  regla.length > 0,
  "esUnaAfirmacionALaPreguntaDePagoDeLineal"
);
comprobar(
  "y se va si la modalidad no es lineal",
  /getActiveModalityKey\(config\) !== "lineal"\) return false;/.test(regla),
  "-OB- y las de dos opciones, intactas"
);

// -- 2. LA PREGUNTA ABIERTA, QUE ES LO QUE DE VERDAD DECIDE -------------------
comprobar(
  "con metodo ya anotado, la pregunta esta cerrada",
  /convo\.selected_payment_method\?\.trim\(\)\) return false;/.test(regla),
  "no se repite despues"
);
comprobar(
  "sin intro enviada no hay pregunta abierta",
  /convo\.intro_variant_sent == null\) return false;/.test(regla),
  "nadie pregunto nada todavia"
);

// -- 3. LAS TRES PUERTAS QUE SE APARTAN --------------------------------------
comprobar(
  "una pregunta de precio no compra",
  /isPriceQuestion\(msgContent\)\) return false;/.test(regla),
  "la contesta el modelo"
);
comprobar(
  "una duda sobre el pago tampoco",
  /messageHasPaymentConcern\(msgContent\)\) return false;/.test(regla),
  "«no sera estafa»"
);
comprobar(
  "y nombrar un metodo va por el camino de siempre",
  /detectPaymentRoute\(msgContent, convo\.phone\)\) return false;/.test(regla),
  "manda el que pidio, no el principal"
);
comprobar(
  // LA MISMA INTENCIÓN, CON DOS SEÑALES EN VEZ DE UNA.
  //
  // El 24/09 se añadió `soloEstaDeAcuerdo` al lado de la de siempre: la primera
  // reconoce frases de compra dentro de un mensaje largo, la segunda reconoce un
  // mensaje que no dice NADA MÁS que un sí —«esta bien», que se escapaba—. Lo
  // que esta comprobación protege no ha cambiado: la afirmación desempata dentro
  // de la pregunta abierta, no decide sola.
  "la afirmacion solo desempata, no decide sola",
  /!isPurchaseAffirmative\(msgContent\) && !soloEstaDeAcuerdo\(msgContent\)\)\s*\n?\s*return false;/.test(
    regla
  ),
  "dentro de la pregunta abierta"
);

// -- 4. FUNCIONA CON CUADRITO Y SIN EL ---------------------------------------
//
// LO QUE COSTÓ. La primera versión SOLO sabía disparar el cuadrito del dueño, y
// al medirlo con su contenido del 21/09 no hizo nada: su intro de Lineal no
// tenía ningún cuadrito de pago. El «ok» siguió yéndose al modelo, que le
// preguntó el método otra vez — el fallo entero, intacto.
comprobar(
  "sin cuadrito, salen los datos del metodo principal",
  /afirmaLaCompraEnLineal/.test(motor) &&
    /messageAsksWhereToPay\(msgContent\) \|\| afirmaLaCompraEnLineal/.test(motor),
  "por el camino de siempre"
);
comprobar(
  "con cuadrito, sale el suyo",
  /decision\.action !== "send_payment_method"/.test(conCuadrito) &&
    /getDefaultPaymentMethodId\(convo\.phone\)/.test(conCuadrito),
  "su texto manda"
);
// NADA DE METODOS ESCRITOS A MANO. Es una plantilla: mañana vende en otro pais.
comprobar(
  "y no hay ningun metodo escrito en el codigo",
  !/\b(yape|plin|bcp|transferencia|nequi|mercadopago)\b/i.test(regla + conCuadrito),
  "sale de la configuracion"
);

// -- 5. NO SE ADELANTA AL CUADRITO DEL DUEÑO ---------------------------------
//
// Va DESPUES, con `??`: quien escriba su palabra sigue yendo a SU cuadrito.
comprobar(
  "el cuadrito del dueño se mira PRIMERO",
  /cuadritoDeLaIntroQueSeñala\(convo, config, msgContent\) \?\?\s*\n\s*elCuadritoDePagoDeUnaAfirmacion\(convo, config, msgContent\)/.test(
    motor
  ),
  "esto es solo el respaldo"
);

console.log(
  fallos === 0
    ? "\nTODO OK — en lineal, un «ok» contesta a la pregunta de pago"
    : `\n${fallos} FALLO(S)`
);
process.exit(fallos === 0 ? 0 : 1);
