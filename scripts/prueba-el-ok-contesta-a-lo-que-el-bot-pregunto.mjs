// EL «OK» CONTESTA A LO QUE EL BOT PREGUNTO, Y SIN FOTOS NO SE OFRECE NADA.
//
// DOS FALLOS DE SU PRUEBA DEL 25 DE SEPTIEMBRE DE 2026, tres conversaciones en
// paralelo en «como -OB-».
//
// FALLO 1 — EL «OK» QUE NO ERA DE COMPRA (su conversacion 147). El bot cerro su
// turno con «¿Te gustaria que te cuente mas sobre lo que incluye? 😊», el
// contesto «ok», y se le abrio la oferta del segundo producto como si hubiera
// dicho que compraba. Con sus palabras: «que no se confunda, que de respuesta
// segun el contexto; y si es otra frase del bot y el cliente dice "si", tampoco
// apruebe».
//
// POR QUE PASABA, Y ESTABA ESCRITO A PROPOSITO: la puerta decide por el ESTADO
// —«salio la intro y todavia no hay metodo»— no por lo que el bot acaba de
// preguntar. Su propio comentario lo dice: «aguanta que el cliente se desvie».
// Eso es cierto cuando el bot solo CONTESTA por el camino; deja de serlo cuando
// el bot PREGUNTA otra cosa, porque entonces la ultima pregunta abierta es suya.
//
// NO ES UNA REGLA NUEVA: es `elBotOfrecioEnsenarAlgo`, la que ya usa la puerta
// del reenvio. Se reutiliza, porque la misma pregunta contestada en dos sitios es
// como se separan con el tiempo.
//
// FALLO 2 — LA HERRAMIENTA DE FOTOS SIN FOTOS. El modelo ofrecia imagenes que no
// existen y el guardarrail tiraba la respuesta entera: ~8.000 tokens pagados dos
// veces, el 8-12% del coste de cada prueba. Con sus palabras: «si no sirve no
// tiene sentido esas llamadas; pero cuando haya imagen deberia funcionar las
// fotos, y si no hay, apagarlo para que no intente».
//
// Se apaga de verdad: sin nada que ensenar, la herramienta NO viaja y las dos
// frases del prompt que la nombran TAMPOCO. Quitar el dato en vez de pedirle que
// lo ignore: lo que no esta no compite.
//
// LO QUE NO PUEDE ROMPERSE:
//
//   · EL «OK» DE COMPRA SIGUE COMPRANDO. Si lo que el bot ofrecio son los DATOS,
//     el metodo o como adquirirlo, `elBotOfrecioEnsenarAlgo` dice que no ofrecio
//     ninguna muestra. MEDIDO contra el contenido del dueno antes de tocar nada:
//     sus tres cierres de intro hablan de pago, asi que ninguno entra ahi.
//   · CON GALERIA, LAS FOTOS FUNCIONAN IGUAL QUE SIEMPRE: la herramienta viaja,
//     el modelo la llama y el motor manda las imagenes con el pie del editor.
//   · Y LA MAQUETACION DEL PROMPT NO SE TOCA: de ese parrafo se quita SOLO la
//     frase de las imagenes; el resto queda letra por letra.
//
//   node scripts/prueba-el-ok-contesta-a-lo-que-el-bot-pregunto.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const motor = readFileSync(join(RAIZ, "src", "lib", "workflow", "engine.ts"), "utf8");
const cerebro = readFileSync(join(RAIZ, "src", "lib", "openrouter.ts"), "utf8");

let fallos = 0;
const comprobar = (titulo, ok, nota = "") => {
  if (!ok) fallos++;
  console.log(
    `${ok ? "ok   " : "FALLA"} ${titulo.padEnd(54).slice(0, 54)} ${nota}`
  );
};
const trozo = (fuente, desde, hasta) => {
  const i = fuente.indexOf(desde);
  if (i < 0) return "";
  const f = fuente.indexOf(hasta, i);
  return f < 0 ? fuente.slice(i) : fuente.slice(i, f);
};

// ── 1. EL «OK» MIRA LO QUE EL BOT PREGUNTO ──────────────────────────────────
console.log("-- 1. el «ok» mira la pregunta del bot -------------------");
const laPuerta = trozo(
  motor,
  "function esUnaAfirmacionALaPreguntaDePagoDeLineal(",
  "\n/**"
);
comprobar(
  "la puerta consulta si el bot ofrecio ensenar algo",
  /if \(elBotOfrecioEnsenarAlgo\(ultimoMensajeDelBot\(convo\.id\), convo\.id\)\) \{\s*\r?\n\s*return false;/.test(
    laPuerta
  ),
  "la regla ya existia"
);
comprobar(
  "y sigue exigiendo que sea lineal",
  /if \(getActiveModalityKey\(config\) !== "lineal"\) return false;/.test(
    laPuerta
  ),
  "en -OB- y -DOU- no aplica"
);
comprobar(
  "y que la pregunta de pago siga abierta",
  /if \(convo\.selected_payment_method\?\.trim\(\)\) return false;/.test(laPuerta) &&
    /if \(convo\.intro_variant_sent == null\) return false;/.test(laPuerta),
  "los frenos de antes, intactos"
);
comprobar(
  "y los otros tres apartados de siempre",
  /if \(isPriceQuestion\(msgContent\)\) return false;/.test(laPuerta) &&
    /if \(messageHasPaymentConcern\(msgContent\)\) return false;/.test(laPuerta) &&
    /if \(detectPaymentRoute\(msgContent, convo\.phone\)\) return false;/.test(
      laPuerta
    ),
  "precio, duda de pago y metodo"
);

// ── 2. Y EL FRENO QUE PROTEGE AL «OK» DE COMPRA ─────────────────────────────
//
// Es lo que hace que esto no rompa la venta: cuando lo ofrecido son los datos,
// el metodo o como adquirirlo, no cuenta como «ofreci una muestra».
console.log("\n-- 2. el «ok» de compra sigue comprando ------------------");
const laFuncion = trozo(
  motor,
  "function elBotOfrecioEnsenarAlgo(",
  "\n/**\n * ¿EL MENSAJE ES SOLO UN ACUSE"
);
comprobar(
  "ofrecer los datos de pago NO es ofrecer una muestra",
  /const loOfrecidoEsElPago =/.test(laFuncion) &&
    /\(ofreceContar && !loOfrecidoEsElPago\)/.test(laFuncion),
  "el freno que ya estaba"
);
comprobar(
  "y la senal visual sigue mandando por su cuenta",
  /assistantOfferedVisualSample\(conversationId\)/.test(laFuncion),
  "no se toco"
);

// ── 3. SIN NADA QUE ENSENAR, LA HERRAMIENTA NO VIAJA ────────────────────────
console.log("\n-- 3. sin fotos, la herramienta se apaga -----------------");
comprobar
(
  "se pregunta lo mismo que pregunta la herramienta",
  /const hayAlgoQueEnsenar =\s*\r?\n?\s*getProductInfoTopics\(\)\.length > 0 \|\| !!getComplementInfoTopic\(\);/.test(
    cerebro
  ),
  "sus dos fuentes de temas"
);
comprobar(
  "y solo viaja si hay algo",
  /\.\.\.\(hayAlgoQueEnsenar \? \[SEND_PRODUCT_INFO_TOOL\] : \[\]\),/.test(cerebro),
  "antes viajaba siempre"
);
comprobar(
  "las otras herramientas no se tocaron",
  /SELECT_OPTION_TOOL,\s*\r?\n\s*ORDER_BUMP_CONTENT_TOOL,/.test(cerebro),
  "elegir y comparar, intactas"
);

// ── 4. NI LAS FRASES DEL PROMPT QUE LA NOMBRAN ──────────────────────────────
console.log("\n-- 4. ni las frases que la invitan -----------------------");
comprobar(
  "en -OB-: la frase del complemento es condicional",
  /const laFraseDeVerElComplemento =\s*\r?\n?\s*getProductInfoTopics\(\)\.length > 0 \|\| getComplementInfoTopic\(\)/.test(
    cerebro
  ),
  "con galeria vacia no viaja"
);
comprobar(
  "en «como dou»: la suya tambien",
  /const laFraseDeLasImagenesDeLaOferta =\s*\r?\n?\s*getProductInfoTopics\(\)\.length > 0 \|\| getComplementInfoTopic\(\)/.test(
    cerebro
  ),
  "mueve el selector cuando quiere"
);
comprobar(
  "y la maquetacion de las opciones se queda",
  /One option per paragraph separated by a blank line; configured names in bold/.test(
    cerebro
  ),
  "no tiene que ver con las imagenes"
);
comprobar(
  "y el guardarrail de las fotos sigue en pie",
  /ofrecio material visual sin galeria; reintento/.test(cerebro),
  "la red de abajo"
);

// ── 5. Y LA REGLA, EJECUTADA DE VERDAD ─────────────────────────────────────
//
// Las comprobaciones de arriba miran la FORMA del codigo. Esto EJECUTA la regla
// con la frase que fallo, que es lo unico que demuestra que el arreglo llega.
// La funcion se trae DEL ARCHIVO, no se reescribe: un codigo reimplementado
// prueba lo que uno cree que hace, que es justo lo que se esta poniendo en duda.
//
// La senal visual se apaga a proposito: va por su cuenta y no es la mitad que se
// anadio. Lo que se mide aqui es el ofrecimiento de CONTAR.
console.log("\n-- 5. la regla, ejecutada con la frase que fallo ---------");
const laRegla = (() => {
  const i = motor.indexOf("function elBotOfrecioEnsenarAlgo(");
  const j = motor.indexOf("assistantOfferedVisualSample(conversationId)", i);
  const k = motor.indexOf("\n}", j);
  const cuerpo = motor
    .slice(i, k + 2)
    .replace(
      /function elBotOfrecioEnsenarAlgo\(\s*\r?\n?\s*ultimoMensajeDelBot: string,\s*\r?\n?\s*conversationId: number\s*\r?\n?\): boolean \{/,
      "function elBotOfrecioEnsenarAlgo(ultimoMensajeDelBot, conversationId) {"
    );
  return new Function(
    "const assistantOfferedVisualSample = () => false;\n" +
      cuerpo +
      "\nreturn elBotOfrecioEnsenarAlgo;"
  )();
})();
for (const frase of [
  "¿Te gustaría que te cuente más sobre lo que incluye? 😊",
  "¿Quieres que te explique qué incluye?",
  "¿Te muestro el contenido?",
  "¿Te gustaría ver unas muestras?",
]) {
  comprobar(
    `ofrecio ensenar · «${frase.slice(0, 34)}…»`,
    laRegla(frase, 1) === true,
    "el «ok» NO compra"
  );
}
for (const frase of [
  "¿Te animas? Solo dime y te paso los datos para pagar.",
  "¿Deseas adquirirlo? Te indico cómo.",
  "Responde con un método de pago 👇",
  "Realiza tu pago y envíame el comprobante 🙌",
]) {
  comprobar(
    `cierre de compra · «${frase.slice(0, 34)}…»`,
    laRegla(frase, 1) === false,
    "el «ok» SÍ compra"
  );
}

console.log(
  fallos === 0
    ? "\nTODO OK — el «ok» contesta a lo que el bot pregunto\n"
    : `\n${fallos} comprobacion(es) mal.\n`
);
process.exit(fallos === 0 ? 0 : 1);
