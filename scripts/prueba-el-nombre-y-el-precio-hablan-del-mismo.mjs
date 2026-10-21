// EL NOMBRE Y EL PRECIO DE UNA BURBUJA HABLAN DEL MISMO PRODUCTO.
//
// LO QUE PASO — 28 de septiembre de 2026, su prueba HOLAP2. Su respuesta rapida
// de precio, la del Salesbot economico de lineal, dice:
//
//     «El valor actual de *{{PRODUCTO}}* es *{{PRECIO_COMPLETO}}*»
//
// y al cliente le llego «SUPER PACK 2 EN 1 es S/. 8 SOLES». El SUPER PACK vale
// 10; el 8 es el precio de la OTRA opcion. Con sus palabras: «me dio mal el
// precio, me dijo que el super pack estaba a 8 soles, y estaba a 10 con
// descuento».
//
// ES EL FALLO MAS CARO DE ESTE BOT: el cliente paga lo que leyo, el validador
// reconoce la opcion POR EL MONTO, y se entrega el producto que no era.
//
// NO FUE EL MODELO, y por eso ningun guardarrail lo vio. Esa burbuja la manda el
// motor con SU texto —en el registro de esa conversacion no hay ni una llamada al
// modelo en ese turno—. Los guardarrailes de `openrouter.ts` revisan lo que
// escribe el modelo; una burbuja del dueno no pasa por ahi.
//
// LA CAUSA, MEDIDA con su configuracion:
//
//     {{PRODUCTO}}         -> «SUPER PACK 2 EN 1»   (el primer puesto: el CARO)
//     {{PRECIO_COMPLETO}}  -> 8                     (el precio base: el BARATO)
//
// Los dos comodines se resolvian por caminos distintos. Con UN producto apuntan
// al mismo y sale bien — por eso llevaba meses funcionando. Con DOS se cruzan
// SIEMPRE: no es mala suerte, es estructural.
//
// LAS DOS MITADES DEL ARREGLO, y las dos se prueban aqui:
//
//   1. QUE NO PUEDAN DISCREPAR. El nombre se resuelve con el producto cuyo
//      precio lleva la burbuja.
//   2. QUE NI ASI SE DIGA UN PRECIO ANTES DE ELEGIR. Con dos opciones a la vista
//      y sin eleccion, esa respuesta no sale: sale el recordatorio de las dos.
//      Lo pidio el: «que el bot le diga que hay dos y le pregunte cual quiere».
//
//   node scripts/prueba-el-nombre-y-el-precio-hablan-del-mismo.mjs
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

// ── SE TRAE EL CODIGO DE VERDAD, NO UNA COPIA ──────────────────────────────
//
// Reimplementarlo probaria lo que uno CREE que hace, que es justo lo que se esta
// poniendo en duda. Se corta del archivo y se ejecuta.
const trozo = (() => {
  const i = motor.indexOf("const PRECIO_SIN_DUENO =");
  const f = motor.indexOf("function renderSalesbotResponse(", i);
  return i < 0 || f < 0 ? "" : motor.slice(i, f);
})();
comprobar("se encuentra el codigo nuevo", trozo.length > 0);
if (!trozo) {
  console.log("\nsin el codigo no se puede ejecutar nada. PARO.\n");
  process.exit(1);
}

const sinTipos = trozo
  .replace(/text: string,/g, "text,")
  .replace(/selectedOption: "combo" \| "basico" \| undefined,/g, "selectedOption,")
  .replace(/config: WorkflowConfig \| null/g, "config")
  .replace(/convo: ConversationRow,/g, "convo,")
  .replace(/\): string \{/g, ") {")
  .replace(/\): boolean \{/g, ") {");

/** Monta las dos funciones con dependencias de mentira, controladas desde aqui. */
function montar({ oferta, nombres, enOrderBump, enDobleOferta }) {
  return new Function(
    "getActiveTwoTierOffer",
    "nombreDeLaOpcion",
    "literal",
    "isOrderBumpActive",
    "isDobleOfertaActive",
    `${sinTipos}\nreturn { PRECIO_SIN_DUENO, elNombreSigueAlPrecio, lasDosSinElegir };`
  )(
    () => oferta,
    (cual) => nombres[cual] ?? "",
    (s) => s,
    () => enOrderBump,
    () => enDobleOferta
  );
}

// Nombres inventados a proposito: una prueba escrita con sus productos reales
// taparia el fallo que la regla «nada de productos en el codigo» evita.
const NOMBRES = { combo: "PACK GRANDE", basico: "PACK CHICO" };
const CON_DOS = { combo: { name: NOMBRES.combo }, basico: { name: NOMBRES.basico } };

// ── 1. ¿QUE CUENTA COMO «PRECIO SIN DUEÑO»? ────────────────────────────────
console.log("\n— 1. cual de los comodines de precio no dice de quien es —\n");
const { PRECIO_SIN_DUENO } = montar({
  oferta: CON_DOS,
  nombres: NOMBRES,
  enOrderBump: false,
  enDobleOferta: true,
});
const sinDueno = [
  ["su texto de verdad", "El valor actual de *{{PRODUCTO}}* es *{{PRECIO_COMPLETO}}*."],
  ["{precio} a secas", "cuesta solo {precio} y es pago unico"],
  ["{{PRECIO_COMPLETO_MAYUSCULAS}}", "son {{PRECIO_COMPLETO_MAYUSCULAS}}"],
  ["{{PRECIO_LABEL}}", "monto {{PRECIO_LABEL}}"],
];
for (const [etq, texto] of sinDueno) {
  comprobar(`  SIN dueño: ${etq}`, PRECIO_SIN_DUENO.test(texto), "hay que cuadrarlo");
}
const conDueno = [
  ["{{PRECIO_FULL}}", "el grande sale {{PRECIO_FULL}}"],
  ["{{PRECIO_BASE}}", "el chico sale {{PRECIO_BASE}}"],
  ["{{PRECIO_1}} y {{PRECIO_2}}", "opcion 1 {{PRECIO_1}} · opcion 2 {{PRECIO_2}}"],
  ["{{PRECIO_UPSELL}}", "el extra sale {{PRECIO_UPSELL}}"],
  ["{{PRECIO_MERCADO}}", "antes {{PRECIO_MERCADO}}"],
  ["su regla de saludo, sin precio", "¡Hola! ¿Que te gustaria saber sobre *{{PRODUCTO}}*?"],
];
for (const [etq, texto] of conDueno) {
  comprobar(`  CON dueño: ${etq}`, !PRECIO_SIN_DUENO.test(texto), "no se toca");
}

// ── 2. EL CRUCE, EJECUTADO ─────────────────────────────────────────────────
console.log("\n— 2. el nombre sale del dueño del precio —\n");
const SU_TEXTO = "El valor actual de *{{PRODUCTO}}* es *{{PRECIO_COMPLETO}}*.";

const dosSinElegir = montar({
  oferta: CON_DOS,
  nombres: NOMBRES,
  enOrderBump: false,
  enDobleOferta: true,
});
const salidaSinElegir = dosSinElegir.elNombreSigueAlPrecio(SU_TEXTO, undefined, {});
comprobar(
  "sin elegir, el nombre es el del precio BASE ← SU FALLO",
  salidaSinElegir.includes(NOMBRES.basico) && !salidaSinElegir.includes(NOMBRES.combo),
  salidaSinElegir.replace(/\s+/g, " ").slice(0, 46)
);
comprobar(
  "eligiendo la cara, el nombre es el de la cara",
  dosSinElegir.elNombreSigueAlPrecio(SU_TEXTO, "combo", {}).includes(NOMBRES.combo),
  "el precio ya era el suyo"
);
comprobar(
  "eligiendo la barata, el nombre es el de la barata",
  dosSinElegir.elNombreSigueAlPrecio(SU_TEXTO, "basico", {}).includes(NOMBRES.basico),
  "nunca uno con el precio del otro"
);

// LO QUE NO SE PUEDE HABER ROTO.
console.log("\n— y lo que NO se toca —\n");
const unProducto = montar({
  oferta: null,
  nombres: NOMBRES,
  enOrderBump: false,
  enDobleOferta: false,
});
comprobar(
  "con UN producto el texto sale intacto",
  unProducto.elNombreSigueAlPrecio(SU_TEXTO, undefined, {}) === SU_TEXTO,
  "lineal queda igual que ayer"
);
const SIN_PRECIO = "¡Hola! ¿Que te gustaria saber sobre *{{PRODUCTO}}*?";
comprobar(
  "una burbuja sin precio sale intacta",
  dosSinElegir.elNombreSigueAlPrecio(SIN_PRECIO, undefined, {}) === SIN_PRECIO,
  "sin pareja no hay nada que cuadrar"
);
const CON_DUENO_ESCRITO =
  "*{{PRODUCTO_FULL}}* a {{PRECIO_FULL}} y *{{PRODUCTO_BASE}}* a {{PRECIO_BASE}}";
comprobar(
  "los comodines que YA dicen de cual, intactos",
  dosSinElegir.elNombreSigueAlPrecio(CON_DUENO_ESCRITO, undefined, {}) ===
    CON_DUENO_ESCRITO,
  "son los que el usa"
);
const MEZCLA = "*{{PRODUCTO_SECUNDARIO}}* y *{{PRODUCTO}}* por {precio}";
const salidaMezcla = dosSinElegir.elNombreSigueAlPrecio(MEZCLA, undefined, {});
comprobar(
  "solo cambia el comodin generico, no sus vecinos",
  salidaMezcla.includes("{{PRODUCTO_SECUNDARIO}}") &&
    salidaMezcla.includes(NOMBRES.basico),
  "las llaves tienen que cerrar tras «producto»"
);

// ── 3. Y ANTES DE ELEGIR NO SALE NINGUN PRECIO ─────────────────────────────
console.log("\n— 3. con dos opciones sin elegir, se pregunta cual —\n");
const caso = (etq, esperado, convo, deps) => {
  const { lasDosSinElegir } = montar(deps);
  comprobar(etq, lasDosSinElegir(convo, {}) === esperado, esperado ? "pregunta" : "sale su texto");
};
caso(
  "dos a la vista y sin elegir ← LO QUE PIDIO",
  true,
  { id: 1, order_bump_choice: null, order_bump_revealed: 0 },
  { oferta: CON_DOS, nombres: NOMBRES, enOrderBump: false, enDobleOferta: true }
);
caso(
  "ya eligio: su respuesta sale, con el precio suyo",
  false,
  { id: 1, order_bump_choice: "combo", order_bump_revealed: 1 },
  { oferta: CON_DOS, nombres: NOMBRES, enOrderBump: false, enDobleOferta: true }
);
caso(
  "un solo producto: nada cambia",
  false,
  { id: 1, order_bump_choice: null, order_bump_revealed: 0 },
  { oferta: null, nombres: NOMBRES, enOrderBump: false, enDobleOferta: false }
);
// SU REGLA DURA DE ORDER BUMP: del segundo producto no se dice ni el precio ni el
// contenido hasta que el cliente decide pagar. Preguntar «¿cual de las dos?»
// antes del destape se la salta.
caso(
  "order bump SIN destapar: no se menciona la segunda",
  false,
  { id: 1, order_bump_choice: null, order_bump_revealed: 0 },
  { oferta: CON_DOS, nombres: NOMBRES, enOrderBump: true, enDobleOferta: false }
);
caso(
  "order bump YA destapado: ahi si se pregunta",
  true,
  { id: 1, order_bump_choice: null, order_bump_revealed: 1 },
  { oferta: CON_DOS, nombres: NOMBRES, enOrderBump: true, enDobleOferta: false }
);

// ── 4. COMO QUEDA CONECTADO EN LA REGLA ────────────────────────────────────
console.log("\n— 4. conectado donde se manda el texto —\n");
comprobar(
  "la regla mira su respuesta ESCRITA, no la renderizada",
  /PRECIO_SIN_DUENO\.test\(rule\.response \?\? ""\)/.test(motor),
  "el comodin es un dato, no una redaccion"
);
comprobar(
  "y manda el recordatorio de las dos, el de siempre",
  /if \(hayQuePreguntarCual\) \{[\s\S]{0,400}?await sendTwoOptionsReminder\(convo, config\);/.test(
    motor
  ),
  "no una respuesta nueva en el codigo"
);
comprobar(
  "SOLO sustituye el texto: la accion sigue corriendo",
  /\} else if \(response && !actionUsesEngineMessage\) \{\n\s*await sendBotText\(convo, response\);/.test(
    motor
  ),
  "next_state y stop_after_action, intactos"
);
comprobar(
  "no se mete con las acciones del motor",
  /!actionUsesEngineMessage &&\n\s*PRECIO_SIN_DUENO\.test/.test(motor),
  "elegir, cobrar y entregar no pasan por aqui"
);
comprobar(
  "y el nombre se cuadra antes de resolver el precio",
  /elNombreSigueAlPrecio\(text, selectedOption, config\)/.test(motor),
  "en el mismo sitio de siempre"
);
comprobar(
  "queda en el registro cuando pasa",
  /lleva un precio sin dueño y hay dos opciones sin elegir/.test(motor),
  "para poder verlo en el log"
);

console.log(`\n${fallos === 0 ? "TODO EN VERDE" : `${fallos} EN ROJO`}\n`);
process.exit(fallos === 0 ? 0 : 1);
