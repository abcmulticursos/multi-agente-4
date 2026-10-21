// Elegir metodo de pago SIN haber elegido producto entregaba un precio a dedo.
//
// En una modalidad de dos opciones, el cliente decia «transferencia» sin haber
// dicho cual producto quiere, y el bot le mandaba los datos con el precio del
// BASICO — el que se usa cuando no hay eleccion. El cliente transferia ese monto
// creyendo que llevaba el otro, y su comprobante entraba corto.
//
// No daba error ni aviso: un numero plausible y equivocado, que es la peor
// forma de fallar en la ruta del pago.
//
// ORDER BUMP YA ESTABA BIEN. Su caso se atiende mucho antes: al nombrar un
// metodo sin eleccion, suelta la oferta y espera. Lo que no tenia nada
// equivalente eran las modalidades de Doble Oferta.
//
// LO QUE VIGILA ESTA PRUEBA
//
//   1. La guarda existe y actua ANTES de cualquier envio con precio.
//   2. Order Bump no la toca: su camino sigue exactamente donde estaba.
//   3. Las modalidades de un solo producto no se enteran de nada.
//   4. Se recuerda el metodo que nombro, para no volver a preguntarselo.
//
//   node scripts/prueba-nadie-paga-un-precio-que-no-eligio.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const motor = readFileSync(
  join(RAIZ, "src", "lib", "workflow", "engine.ts"),
  "utf8"
);

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// ── 1. La guarda existe ────────────────────────────────────────────────────
const iGuarda = motor.indexOf("NADIE PAGA UN PRECIO QUE NADIE ELIGIÓ");
comprobar("existe la guarda", iGuarda > 0, `linea ~${motor.slice(0, iGuarda).split("\n").length}`);
const guarda = iGuarda < 0 ? "" : motor.slice(iGuarda, iGuarda + 4200);
comprobar(
  "solo actua en modalidades de dos opciones",
  /const ofertaDeDosOpciones = !!getActiveTwoTierOffer\(config\);/.test(guarda),
  "getActiveTwoTierOffer"
);
// «NO HAY PRODUCTO ELEGIDO» SE MIRA EN LA CONVERSACION, no en una variable que
// solo se rellena en Order Bump. Mirando solo esa variable, en Doble Oferta la
// guarda no guardaba nada: el cliente elegia, recibia sus datos con su precio, y
// al volver a nombrar su metodo le llegaba el bloque SIN IMPORTE con los dos
// productos otra vez y «¿cual eliges?». Su decision, borrada, y sin memoria: se
// repetia cada vez.
comprobar(
  "y solo cuando NO hay producto elegido",
  /!orderBumpChoiceForPayment &&/.test(guarda) &&
    /const yaEligioSuProducto =\s*\r?\n\s*convo\.order_bump_choice === "combo" \|\|\s*\r?\n\s*convo\.order_bump_choice === "basico";/.test(
      guarda
    ) &&
    /!yaEligioSuProducto &&/.test(guarda),
  "sin eleccion"
);

// ── 2. Actua ANTES de cualquier envio con precio ───────────────────────────
//
// Si corriera despues, los datos ya habrian salido con el precio del basico y
// la guarda no serviria de nada.
const iDirecto = motor.indexOf("const canUseDirectPaymentForRoute =");
const iRespuestas = motor.indexOf("const responses = getPaymentResponses(");
comprobar(
  "va antes del pago directo",
  iGuarda > 0 && iDirecto > iGuarda,
  "primero pregunta"
);
comprobar(
  "y antes de las respuestas por metodo",
  iGuarda > 0 && iRespuestas > iGuarda,
  "primero pregunta"
);

// ── 3. Order Bump sigue como estaba ────────────────────────────────────────
comprobar(
  // Su interceptacion vive mucho antes y devuelve el turno, asi que nunca llega
  // a la guarda sin eleccion. Si alguien la quitara, esto se pone en rojo.
  "Order Bump conserva su propia interceptacion",
  /order bump \(interceptando pago\)/.test(motor) &&
    /await presentOrderBumpAndWaitForChoice\(convo\);/.test(motor),
  "intacta"
);
comprobar(
  "y esta antes que la guarda nueva",
  motor.indexOf("order bump (interceptando pago)") < iGuarda,
  "no se pisan"
);
comprobar(
  // El cierre directo no pide elegir: ahi no hay dos opciones que ofrecer.
  "la ruta comercial B queda fuera",
  /!isCommercialRouteB\(convo\)/.test(guarda),
  "sin cambios"
);

// ── 4. Lo que hace en vez de dar un precio ─────────────────────────────────
comprobar(
  "usa el pago sin eleccion si esta configurado",
  /await maybeSendDirectPaymentWithoutChoice\(/.test(guarda),
  "datos sin precio + pregunta"
);
comprobar(
  "y si no, pregunta cual",
  /await sendTwoTierChoiceClarification\(convo, config, true\);/.test(guarda),
  "nunca un precio a dedo"
);
comprobar(
  // Sin esto habria que volver a preguntarle el metodo despues de elegir.
  "recuerda el metodo que acaba de nombrar",
  /setSelectedPaymentMethod\(convo\.id, selectedPaymentMethod\);/.test(guarda),
  "no se le pregunta dos veces"
);
comprobar(
  "y deja rastro en el registro",
  /sin producto elegido → pregunto cuál antes de dar un precio/.test(guarda),
  "diagnosticable"
);

console.log(
  fallos === 0
    ? "\nTODO OK — sin producto elegido, el bot pregunta en vez de poner un precio"
    : `\n${fallos} FALLA(S)`
);
process.exit(fallos === 0 ? 0 : 1);
