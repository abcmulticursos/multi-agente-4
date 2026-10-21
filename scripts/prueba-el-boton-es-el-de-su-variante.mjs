// EL BOTON QUE TOCA EL CLIENTE ES EL DE **SU** BURBUJA, NO EL DE OTRA VARIANTE.
//
// LO QUE PASO — 27 de septiembre de 2026, sus ocho conversaciones en paralelo.
// Su seguimiento 2 lleva un boton enlazado a la opcion CARA. El cliente lo tocaba
// y el bot le cobraba la BARATA, le confirmaba que ese era el precio de la cara,
// y al pagar le entregaba el producto barato. Con sus palabras: «el boton esta
// perfectamente configurado... cuando presiono el boton le da el precio del
// basico, incluso yo le pregunto si ese es el precio del combo y me dice que si».
//
// MEDIDO CON SU ARCHIVO, y esto es lo que lo destapo: ese id de boton existe
// CINCO veces, una por cada variante del mismo seguimiento —al duplicar una
// variante, el id del boton se copia tal cual—:
//
//     variants[0] -> choose_basico   <- la que cogia SIEMPRE
//     variants[1] -> choose_basico
//     variants[2] -> choose_combo    <- las que el habia actualizado
//     variants[3] -> choose_combo
//     variants[5] -> choose_combo
//
// `findBubbleButton` recorre la configuracion entera y se queda con LA PRIMERA,
// sin mirar cual se envio. Asi que al cliente le llegaba la burbuja de una
// variante y el motor ejecutaba la accion de otra.
//
// NO SE VEIA EN EL REGISTRO: el log decia la accion ejecutada, no la variante de
// la que salio. Por eso parecia que el boton estaba mal configurado.
//
// COMO SE ARREGLA: se anota que variante recibio ESA conversacion al enviarsela,
// y el boton se busca primero ahi. Es el mismo patron que `intro_variant_sent`,
// que lleva meses funcionando.
//
// LO QUE NO PUEDE ROMPERSE:
//
//   · SI NO APARECE EN SU VARIANTE, se busca como hasta hoy. Los botones de la
//     intro, del saludo y de cualquier otro sitio se resuelven igual que antes.
//   · SIN VARIANTE ANOTADA —las conversaciones de antes de esto— tambien.
//   · Y EN LINEAL NO PASA NADA aunque una variante vieja diga "elegir basico":
//     ahi no hay oferta de dos y esa accion ya avisa y no hace nada.
//
//   node scripts/prueba-el-boton-es-el-de-su-variante.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const motor = readFileSync(join(RAIZ, "src", "lib", "workflow", "engine.ts"), "utf8");
const base = readFileSync(join(RAIZ, "src", "lib", "db.ts"), "utf8");

let fallos = 0;
const comprobar = (titulo, ok, nota = "") => {
  if (!ok) fallos++;
  console.log(
    `${ok ? "ok   " : "FALLA"} ${titulo.padEnd(54).slice(0, 54)} ${nota}`
  );
};

// -- 1. EL FALLO, EJECUTADO -------------------------------------------------
//
// Se trae `findBubbleButton` del archivo —no se reescribe— y se le da una
// configuracion con la forma de la suya: dos variantes del mismo seguimiento con
// EL MISMO id de boton y acciones distintas.
console.log("-- 1. el id duplicado, ejecutado ------------------------");
const trozo = (desde, hasta) => {
  const i = motor.indexOf(desde);
  const f = motor.indexOf(hasta, i);
  return i < 0 || f < 0 ? "" : motor.slice(i, f);
};
// Solo la funcion, sin el comentario de la de al lado (que lleva tipos dentro).
const soloFindBubbleButton = (() => {
  const entero = trozo(
    "function findBubbleButton(",
    "function elBotonDeSuSeguimiento("
  );
  const corte = entero.lastIndexOf("/**");
  return corte > 0 ? entero.slice(0, corte) : entero;
})();
const findBubbleButton = new Function(
  soloFindBubbleButton
    .replace(/: unknown|: string|: BubbleButton \| null/g, "")
    .replace(/\(item\): item is BubbleButton =>/, "(item) =>")
    .replace(/\(item as BubbleButton\)/g, "item")
    .replace(/value as Record<string, unknown>/, "value") +
    "\nreturn findBubbleButton;"
)();

const ID = "el-mismo-id-en-las-dos";
const laVieja = {
  name: "variante vieja",
  steps: [
    { type: "text", buttons: [{ id: ID, label: "QUIERO EL DESCUENTO", action: "choose_basico" }] },
  ],
};
const laNueva = {
  name: "variante nueva",
  steps: [
    { type: "text", buttons: [{ id: ID, label: "QUIERO EL DESCUENTO", action: "choose_combo" }] },
  ],
};
// La forma de su archivo: las variantes viejas van ANTES que las suyas.
const configEntera = {
  channels: { whatsapp: { modality_templates: { lineal: { followups: [{ variants: [laVieja, laNueva] }] } } } },
  followup_sequences: [{ variants: [laVieja, laNueva] }],
};

comprobar(
  "buscando en todo el archivo sale la variante VIEJA",
  findBubbleButton(configEntera, ID)?.action === "choose_basico",
  "ese era el fallo"
);
comprobar(
  "buscando en SU variante sale la que le llego",
  findBubbleButton(laNueva.steps, ID)?.action === "choose_combo",
  "la del boton que toco"
);
comprobar(
  "y la vieja sigue resolviendose bien en la suya",
  findBubbleButton(laVieja.steps, ID)?.action === "choose_basico",
  "cada una la suya"
);

// -- 2. EL MOTOR BUSCA PRIMERO EN SU VARIANTE -------------------------------
console.log("\n-- 2. el motor mira primero su variante ----------------");
const laPuerta = (() => {
  const i = motor.indexOf("function elBotonDeSuSeguimiento(");
  return i < 0 ? "" : motor.slice(i, motor.indexOf("\nasync function runBubbleButtonAction(", i));
})();
comprobar(
  "existe la lectura por variante",
  laPuerta.length > 0 &&
    /const variante = convo\.followup_variant_sent;/.test(laPuerta),
  "la que recibio ese cliente"
);
comprobar(
  "usa la MISMA lista con la que se envio",
  /followupSequencesFor\(config, convo\.channel, undefined\)\[indice\]/.test(
    laPuerta
  ),
  "el canal manda, igual que al mandarlo"
);
comprobar(
  "y resuelve la variante con la funcion de siempre",
  /resolveFollowupVariant\(seq, variante\)/.test(laPuerta),
  "no una copia"
);
comprobar(
  "el boton se busca SOLO en los pasos de esa variante",
  /return findBubbleButton\(suya\.steps, id\);/.test(laPuerta),
  "no en el archivo entero"
);
comprobar(
  "y si no esta ahi, se busca como hasta hoy",
  /elBotonDeSuSeguimiento\(convo, id\) \?\? findBubbleButton\(loadWorkflowConfig\(\), id\)/.test(
    motor
  ),
  "la intro y el saludo, intactos"
);
comprobar(
  "sin variante anotada tambien cae al camino de siempre",
  /typeof variante !== "number" \|\| typeof indice !== "number" \|\| indice < 0/.test(
    laPuerta
  ),
  "las conversaciones de antes"
);

// -- 3. LA VARIANTE SE ANOTA AL ENVIARLA ------------------------------------
console.log("\n-- 3. se anota al enviar el seguimiento -----------------");
comprobar(
  "el motor la anota con la que de verdad mando",
  /fijarVarianteDeSeguimientoEnviada\(convo\.id, payload\.variant_index \?\? null\);/.test(
    motor
  ),
  "la del payload, no otra"
);
comprobar(
  "y la base tiene su casilla",
  /\["followup_variant_sent", "INTEGER"\]/.test(base) &&
    /followup_variant_sent = \? WHERE id = \?/.test(base),
  "como intro_variant_sent"
);

// -- 4. Y EN LINEAL NO COBRA NADA AUNQUE LA VARIANTE VIEJA DIGA "BASICO" ----
//
// Es la otra mitad de su pregunta: «verifica si al usar el boton del seguimiento
// 2 de las pruebas lineales van a tener el mismo problema». No: ahi no hay oferta
// de dos opciones y la accion ya avisa y se va sin hacer nada.
console.log("\n-- 4. en lineal esa accion no hace nada -----------------");
comprobar(
  "sin oferta de dos, la accion avisa y no actua",
  /if \(!getActiveTwoTierOffer\(\)\) \{[\s\S]{0,400}?esa acción no hace nada/.test(
    motor
  ),
  "el candado que ya estaba"
);

// -- 5. Y EN «COMO OB» EL BOTON DESTAPA ANTES DE COBRAR --------------------
//
// LO PIDIO EL DUEÑO el 27/09/2026. En Order Bump el segundo producto no existe
// para el cliente hasta que muestra intencion de pagar —su regla dura: «del
// producto full no se dice NI EL PRECIO NI EL CONTENIDO hasta ese momento»— y un
// boton enlazado a «elegir combo» se la saltaba: mandaba los datos de pago del
// producto caro sin haberlo presentado nunca.
//
// Tocar ese boton SI es intencion de pagar, asi que el momento de revelarlo es
// ese. Lo que no encajaba era saltarse la presentacion.
console.log("\n-- 5. en «como ob», primero se destapa -------------------");
const laAccion = (() => {
  const i = motor.indexOf('    case "choose_combo":');
  return i < 0 ? "" : motor.slice(i, motor.indexOf('    case "choose_upsell"', i));
})();
comprobar(
  "destapa con la segunda intro de siempre",
  /if \(isOrderBumpActive\(\) && convo\.order_bump_revealed !== 1\) \{[\s\S]{0,200}?presentOrderBumpAndWaitForChoice\(convo\)/.test(
    laAccion
  ),
  "no una copia"
);
comprobar(
  "SOLO en order bump",
  /isOrderBumpActive\(\) &&/.test(laAccion),
  "«como dou» y lineal, intactos"
);
comprobar(
  "y SOLO antes del destape",
  /convo\.order_bump_revealed !== 1/.test(laAccion),
  "el flujo normal de -OB- llega ya revelado"
);
comprobar(
  "no anota eleccion de un producto que no ha visto",
  laAccion.indexOf("presentOrderBumpAndWaitForChoice(convo)") <
    laAccion.indexOf("await deliverOrderBumpResponse(convo, cual"),
  "elige despues de verlo"
);
comprobar(
  "y despues del destape hace lo de siempre",
  /await deliverOrderBumpResponse\(convo, cual, \{/.test(laAccion),
  "sin tocar una linea"
);

console.log(
  fallos === 0
    ? "\nTODO OK — cada boton ejecuta lo de SU burbuja\n"
    : `\n${fallos} comprobacion(es) mal.\n`
);
process.exit(fallos === 0 ? 0 : 1);
