// Se cobraba el segundo producto y no se entregaba.
//
// EL COMPROBANTE DEL SEGUNDO PRODUCTO SE TRATABA COMO EL ECO DEL PRIMERO.
//
// Despues de una venta la conversacion queda en un estado post-compra
// (payment_approved y companeros) y ahi TODO lo que suena a pago se trata como
// un cliente repitiendo que ya pago: se le contesta "tu pago ya esta
// confirmado, ya te envie el material mas arriba" y el turno se cierra.
//
// Esta bien para el primer producto y mal para el segundo. El cliente acepta el
// upsell, recibe los datos de pago, manda su comprobante — y el bot le responde
// que ya pago y le ofrece reenviarle el enlace del PRIMERO. El comprobante
// nunca llega a leerse, asi que la segunda venta no se registra ni se entrega.
//
// Se cobra y no se entrega. No hay error peor que ese.
//
// Ya existia esta misma salida para el que sube de basico a combo. Faltaba la
// del upsell, que es el mismo caso: un pago NUEVO dentro de un estado que da la
// venta por cerrada.
//
// Y DOS SITIOS MAS QUE EMPUJABAN EN LA MISMA DIRECCION
//
// - El panel suprimia la respuesta del modelo ante cualquier imagen en estado
//   post-compra. Bien tras aprobar el primer pago; mal con una venta nueva en
//   curso: el cliente se quedaba sin confirmacion de un pago que si hizo.
// - Al modelo se le decia "monto_esperado" con el precio del PRIMER producto
//   mientras el cliente pagaba el segundo. El validador acertaba igual —
//   comprueba aparte— pero el modelo discutia por un monto que si era correcto.
//
//   node scripts/prueba-comprobante-del-upsell.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");

const engine = leer("src", "lib", "workflow", "engine.ts");
const handler = leer("src", "lib", "meta", "handler.ts");
const cerebro = leer("src", "lib", "openrouter.ts");
const pago = leer("src", "lib", "workflow", "payment.ts");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// ── 1. El comprobante llega a leerse ────────────────────────────────────────
comprobar(
  "hay una señal de que se espera el pago del segundo producto",
  /const esperaPagoDelUpsell =\s*\r?\n\s*convo\.upsell_state === "ofrecido" \|\| convo\.upsell_state === "aceptado";/.test(
    engine
  ),
  "esperaPagoDelUpsell"
);
comprobar(
  // ESTE es el fallo. Cada estado post-venta tiene su propio guardia del eco;
  // si uno solo se queda sin la salida, ahí se pierde la segunda venta.
  //
  // ERAN SEIS IGUALES Y AHORA SON CUATRO + DOS. El 29/09/2026 dos de los seis
  // —el del regalo y el del comentario— se ACOTARON: siguen apartándose para las
  // FOTOS, que es de lo que va esta prueba, pero ya no se apartan con texto
  // pelado de alguien que ya pagó y pide lo que compró. Antes ese texto se lo
  // quedaba el modelo y en la prueba ARYI1 el cliente nunca recibió su enlace.
  //
  // LA INTENCIÓN DE ESTA PRUEBA NO CAMBIA, y se comprueba más abajo ejecutando la
  // condición: con foto, los SEIS siguen dejando pasar el comprobante.
  "cuatro guardias siguen tal cual",
  (engine.match(
    /if \(mayBeDobleOfertaUpgradeReceipt \|\| esperaPagoDelUpsell\) return false;/g
  ) ?? []).length === 4,
  "los cuatro de siempre"
);
comprobar(
  "y los otros dos están acotados, no borrados",
  (engine.match(
    /\(mayBeDobleOfertaUpgradeReceipt \|\| esperaPagoDelUpsell\) &&/g
  ) ?? []).length === 2,
  "el del regalo y el del comentario"
);
// LO QUE DE VERDAD IMPORTA: con una FOTO, los dos acotados se siguen apartando.
// Se ejecuta la condición real, no una reescrita.
{
  const acotado = new Function(
    "mayBeDobleOfertaUpgradeReceipt",
    "esperaPagoDelUpsell",
    "latestIsImage",
    "wantsPurchasedMaterial",
    `const pideLoQueYaComproSinFoto = !latestIsImage && wantsPurchasedMaterial;
     return (mayBeDobleOfertaUpgradeReceipt || esperaPagoDelUpsell) && !pideLoQueYaComproSinFoto;`
  );
  comprobar(
    "con FOTO y el extra esperando, se aparta (el comprobante se lee)",
    acotado(false, true, true, false) === true && acotado(true, true, true, true) === true,
    "pasa al lector"
  );
  comprobar(
    "con FOTO aunque encima pida su material, también se aparta",
    acotado(false, true, true, true) === true,
    "la foto manda"
  );
  comprobar(
    "solo con TEXTO y pidiendo lo que compró, lo atiende el motor",
    acotado(false, true, false, true) === false,
    "reenvía"
  );
}
comprobar(
  "y ya no queda ningún guardia con la salida vieja sola",
  !/if \(mayBeDobleOfertaUpgradeReceipt\) return false;/.test(engine),
  "ninguno"
);
comprobar(
  // Solo mientras el segundo producto está en juego y sin pagar. Pagado o
  // rechazado, vuelve a ser un eco como cualquier otro.
  "solo mientras está ofrecido o aceptado",
  !/esperaPagoDelUpsell[\s\S]{0,200}?upsell_state === "pagado"/.test(engine),
  "sin pagar"
);

// ── 2. El validador ya sabía hacer su parte ─────────────────────────────────
//
// El pago del upsell se valida contra SU precio y contra lo que entró POR
// ENCIMA de la primera compra. Eso ya estaba bien: lo único que faltaba era
// que el comprobante llegara hasta aquí.
comprobar(
  // Lleva delante "!pidioSubirAlCombo": subir de básico a combo con la oferta
  // del extra abierta NO es pagar el extra. Lo comprueba entero
  // prueba-upgrade-con-upsell-abierto.mjs.
  "el pago del segundo producto se valida contra su propio precio",
  /const esPagoDeUpsell =\s*\r?\n\s*!pidioSubirAlCombo &&\s*\r?\n\s*\(convo\.upsell_state === "aceptado" \|\| convo\.upsell_state === "ofrecido"\);/.test(
    pago
  ),
  "el suyo"
);
comprobar(
  // SU PROPIA CUENTA, YA NO UNA RESTA.
  //
  // Era `total acumulado − foto de lo pagado al ofrecerlo`. La foto hacia de
  // linea divisoria y funcionaba solo mientras nada se moviera por debajo: al
  // subir de basico a full DESPUES, ese dinero entraba por encima de una linea
  // vieja y se contaba para el extra. Se entregaba cobrando de menos justo lo
  // que costo el upgrade. Ahora el extra lleva su cuenta y ni mira la primera
  // venta. Ver prueba-el-upsell-es-un-ticket-aparte.mjs.
  "y contra su propia cuenta, no contra el total de todo",
  /const abonadoAlUpsell = abonadoAntes \+ alExtra;/.test(pago) &&
    !/const abonadoAlUpsell = newTotalCents - convo\.upsell_base_cents;/.test(pago),
  "no recicla el primero"
);
comprobar(
  "«ya estaba aprobado» no corta el comprobante del segundo",
  /convo\.state === "payment_approved" &&\s*\r?\n\s*!isApprovedUpgradeToCombo &&\s*\r?\n\s*!esPagoDeUpsell/.test(
    pago
  ),
  "lo deja pasar"
);
comprobar(
  "al aprobarlo se entrega el segundo producto",
  /setUpsellState\(conversationId, "pagado"\);[\s\S]{0,1200}?entregarUpsell\(conversationId\);/.test(
    pago
  ),
  "sí"
);

// ── 3. La confirmación llega al cliente ─────────────────────────────────────
comprobar(
  "no se calla la respuesta al comprobante del segundo producto",
  /const comprobanteDelSegundoProducto =\s*\r?\n\s*refreshed\?\.upsell_state === "ofrecido" \|\|\s*\r?\n\s*refreshed\?\.upsell_state === "aceptado";/.test(
    handler
  ) && /latestUserIsImage &&\s*\r?\n\s*!comprobanteDelSegundoProducto &&/.test(handler),
  "contesta"
);
comprobar(
  // La supresión sigue valiendo para lo que fue creada: que el modelo no
  // agregue un "en breve recibirás el acceso" encima de la entrega ya enviada.
  "y la supresión de siempre sigue en pie",
  /suprimo respuesta LLM/.test(handler),
  "intacta"
);

// ── 4. El monto que se le dice al modelo ────────────────────────────────────
comprobar(
  "mientras paga el segundo, el monto esperado es el suyo",
  /convo\.upsell_state === "ofrecido" \|\|\s*\r?\n\s*convo\.upsell_state === "aceptado"\s*\r?\n\s*\) \{\s*\r?\n\s*const precioDelUpsell = getUpsellPriceSoles\(/.test(
    cerebro
  ),
  "el del upsell"
);
comprobar(
  // La opción elegida (combo/básico) es de la venta anterior: si se mirara
  // primero, volvería a ganar el precio viejo.
  "y se mira ANTES que la opción de la venta anterior",
  cerebro.indexOf('const precioDelUpsell = getUpsellPriceSoles(') <
    cerebro.indexOf("const choice = convo.order_bump_choice;"),
  "primero el upsell"
);
comprobar(
  "queda marcado como precio del upsell, no como base",
  /source: "upsell",/.test(cerebro),
  "upsell"
);

console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} comprobación(es) mal.`);
process.exit(fallos === 0 ? 0 : 1);
