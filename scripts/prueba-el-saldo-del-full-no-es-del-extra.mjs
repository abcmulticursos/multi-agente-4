// El saldo del full es del full, aunque haya un extra ofrecido.
//
// LO QUE PASO (Doble Oferta + Upsell)
//
//   Compro el basico (6.000) y se le entrego. Pidio subir al full (7.000) y el
//   bot calculo bien: «faltan 1.000». Antes de pagar pregunto:
//
//       «puedo completar el otro que CUESTA 7000»
//
//   Pago los 1.000. Y el bot le contesto:
//
//       «ya registre 0 ARS, aun falta completar 7.500»
//
//   El dinero SI fue donde tenia que ir —«de este comprobante, 1000 completan
//   la primera venta y 0 van al extra»— pero el validador creia que estaba
//   pagando el EXTRA, asi que le contesto por el extra. Y el full no se
//   entrego, porque esa entrega vive en la rama de la primera venta.
//
//   Pago, se le contabilizo, no recibio nada, y encima se le dijo que no habia
//   pagado.
//
// LA CAUSA
//
//   Para saber si un comprobante es del upgrade, se miraba el PRECIO ANOTADO
//   (`two_tier:combo`). Y ese apunte lo reescribe cualquier pregunta de precio:
//   el cerebro vuelve a anotar el precio citado en cada una, y con un extra
//   ofrecido anota el del extra. Su propia pregunta —«¿cuanto cuesta?»— borro
//   la prueba de que estaba pagando el upgrade.
//
//   La ELECCION, en cambio, no la pisa una pregunta.
//
//   node scripts/prueba-el-saldo-del-full-no-es-del-extra.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const pago = readFileSync(
  join(RAIZ, "src", "lib", "workflow", "payment.ts"),
  "utf8"
);

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 62)} ${valor}`);
};

// ── 1. La señal nueva, que no se puede pisar ─────────────────────────────────
comprobar(
  "se reconoce el upgrade por la elección, no solo por el precio",
  /const yaComproYQuiereElCombo = convo\.paid_at != null && obChoice === "combo";/.test(
    pago
  ),
  "una pregunta no la borra"
);
comprobar(
  "y decide de quién es el comprobante",
  /\(cotizadoElUpgrade \|\|\s*\r?\n\s*yaComproYQuiereElCombo \|\|/.test(pago),
  "del upgrade, no del extra"
);

// ── 2. Se AÑADE, no se sustituye ─────────────────────────────────────────────
//
// Solo puede reconocer MAS casos de upgrade, nunca menos: lo que hoy funciona
// sigue funcionando exactamente igual.
comprobar(
  "la señal de antes sigue en pie",
  /const cotizadoElUpgrade = \(convo\.locked_price_source \?\? ""\)\.startsWith\(/.test(
    pago
  ),
  "no se quitó"
);
// LA TERCERA PUERTA SIGUE, PERO CON LA VENTANA ACOTADA — 15/09/2026.
//
// Antes esto exigia que `getRecentUserMessages` viniera pegado a la eleccion.
// Ahora hay un filtro en medio, y por un fallo real: la ventana alcanzaba lo que
// el cliente dijo MIENTRAS ELEGIA, y ahi el nombre de la opcion cara y «el otro»
// disparan el detector. Su convo 108 pago el producto extra y se conto como
// upgrade a la opcion cara.
//
// Lo que esta comprobacion protege —que la tercera puerta exista— no cambia.
comprobar(
  "y la de «lo pidió y aún no se anotó» también",
  /obChoice === "basico" &&[\s\S]{0,1600}getRecentUserMessages\(conversationId, 6\)/.test(
    pago
  ),
  "las tres puertas"
);
comprobar(
  "acotada a lo dicho DESPUES de la compra",
  /convo\.paid_at != null && message\.created_at > convo\.paid_at/.test(pago),
  "antes de comprar no hay de que subir"
);

// ── 3. Y NO puede trabar a quien no está en ese caso ─────────────────────────
//
// Es lo que hay que proteger: que arreglar el upgrade no bloquee un pago del
// extra perfectamente legitimo en otra modalidad.
comprobar(
  "\nsolo aplica si el combo está SIN CUBRIR",
  /const pidioSubirAlCombo =\s*\r?\n\s*comboSinCubrir &&/.test(pago),
  "nada que subir, no aplica"
);
// Lineal y Upsell no tienen dos opciones: `precioComboUpgrade` es null y
// `comboSinCubrir` es falso, asi que esto ni se mira.
comprobar(
  "y en las modalidades sin dos opciones ni se mira",
  /const precioComboUpgrade = isTwoTierActive\(\)\s*\r?\n\s*\? getOrderBumpPriceSoles\("combo", discountActive, convo\.phone\)\s*\r?\n\s*: null;/.test(
    pago
  ) &&
    /const comboSinCubrir =\s*\r?\n\s*precioComboUpgrade !== null &&/.test(pago),
  "Lineal y Upsell intactas"
);
// Quien compro el basico y NUNCA pidio subir tiene su eleccion en «basico»: su
// pago del extra sigue yendo al extra.
comprobar(
  "y quien no pidió subir sigue pagando su extra al extra",
  /convo\.paid_at != null && obChoice === "combo"/.test(pago),
  "hace falta la elección puesta"
);

// ── 4. Lo que NO se toca ─────────────────────────────────────────────────────
comprobar(
  "el reparto del comprobante entre las dos ventas sigue igual",
  /const alExtra = isDuplicateReceipt\s*\r?\n\s*\? 0\s*\r?\n\s*: Math\.max\(0, cents - debidoDeLaPrimera\);/.test(
    pago
  ),
  "primero lo que ya se llevó"
);
comprobar(
  "y el extra sigue con su propia cuenta y su precio",
  /const abonadoAlUpsell = abonadoAntes \+ alExtra;/.test(pago) &&
    /if \(abonadoAlUpsell < priceCents\) \{/.test(pago),
  "intacto"
);

console.log(
  fallos === 0
    ? "\nTODO OK — el saldo del full va al full, y el extra sigue esperando entero"
    : `\n${fallos} comprobacion(es) mal.`
);
process.exit(fallos === 0 ? 0 : 1);
