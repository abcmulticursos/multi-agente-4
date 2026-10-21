// Un «si» a secas contesta a la ULTIMA pregunta, no a la que quedo abierta.
//
// LO QUE PASO (prueba real, modalidad Lineal)
//
//   Se entrego el primer producto y se ofrecio el extra. El cliente no contesto
//   ni si ni no: cambio de tema —«este es otro», «es nuevo»—. El modelo le
//   explico lo que preguntaba y cerro con SU pregunta: «¿quieres que te cuente
//   lo que incluye?». El cliente escribio «si» a ESA pregunta.
//
//   El bot le dio por comprado el segundo producto y le mando los datos de
//   pago. Le pidio dinero por algo que no eligio.
//
// POR QUE
//
//   La oferta del extra queda ABIERTA a proposito: se acepta por su nombre en
//   cualquier momento, aunque hayan pasado horas. Pero ABIERTA no es RECIENTE, y
//   un «si» pelado no dice a que dice que si — eso lo decide quien pregunto
//   ultimo.
//
//   Y no era una puerta, eran dos: el detector del «si» a secas, y el cuadrito
//   «SI» de la oferta, que tiene entre sus palabras «si», «ok», «claro» y «k».
//   Arreglar una sola dejaba la otra abierta.
//
// LA REGLA
//
//   La misma que ya estaba escrita para el regalo —«cuando hay dos preguntas
//   abiertas, la respuesta es de la mas reciente»— aplicada tambien a los
//   demas: el modelo, un seguimiento, o una persona desde el panel.
//
//   NO SE PIERDE LA VENTA. Lo que ya no decide aqui lo lee el modelo, que tiene
//   el marcador <<QUIERE_EXTRA>> y solo lo emite cuando la intencion es clara, y
//   handler.ts unicamente lo obedece con la oferta en pie. Y la oferta sigue
//   viva: el boton, el nombre del producto y las frases de varias palabras
//   («si quiero») la aceptan igual, sin condiciones.
//
//   node scripts/prueba-el-si-es-de-la-ultima-pregunta.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");
const motor = leer("src", "lib", "workflow", "engine.ts");
const base = leer("src", "lib", "db.ts");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 60)} ${valor}`);
};

// ── 1. Hay donde apuntar cuando se hablo del extra ───────────────────────────
//
// Sin la columna no hay forma de saber si la oferta sigue siendo lo ultimo: el
// unico dato disponible era «esta ofrecida», que no caduca nunca.
comprobar(
  "la conversacion recuerda cuando se hablo del extra",
  /upsell_hablado_at: number \| null;/.test(base) &&
    /\["upsell_hablado_at", "INTEGER"\]/.test(base),
  "tipo y migracion"
);
// Migracion idempotente como todas las demas: una columna nueva NULL no toca
// ninguna conversacion existente.
comprobar(
  "y el sello se escribe con la hora de ahora",
  /export function setUpsellHabladoAt\(conversationId: number\): void \{[\s\S]{0,200}?Math\.floor\(Date\.now\(\) \/ 1000\)/.test(
    base
  ),
  "setUpsellHabladoAt"
);
// 'human' cuenta igual que 'assistant': al cliente le da lo mismo quien
// escribio, lo que ve es que le hablaron de otra cosa.
comprobar(
  "se cuenta lo que hablo el bot DESPUES del sello",
  /role != 'user' AND created_at > \?/.test(base) &&
    /export function contarMensajesDelBotDespuesDe\(/.test(base),
  "assistant y human"
);
// Si la consulta falla, que no cambie nada: 0 = todo como siempre.
comprobar(
  "y ante la duda no cambia nada",
  /catch \{[\s\S]{0,220}?return 0;/.test(base),
  "0 = como siempre"
);

// ── 2. El motor sella cuando ofrece ──────────────────────────────────────────
const ofrecer = (() => {
  const i = motor.indexOf("async function presentarUpsell(");
  return i < 0 ? "" : motor.slice(i, i + 9000);
})();
comprobar(
  "al ofrecer el extra, la oferta queda como lo ultimo dicho",
  /setUpsellHabladoAt\(convo\.id\);/.test(ofrecer),
  "sella al presentar"
);
// Y DESPUES de mandar todas sus burbujas: sellar antes dejaria sus propias
// burbujas contadas como «hablo alguien mas», y el «si» de quien contesta al
// instante no valdria.
const iSello = ofrecer.indexOf("setUpsellHabladoAt(convo.id);");
const iPregunta = ofrecer.indexOf("await sendBotText(convo, pregunta);");
comprobar(
  "y sella despues de mandarlas, no antes",
  iSello > 0 && iPregunta > 0 && iSello > iPregunta,
  "sus propias burbujas no cuentan"
);

// ── 3. Responder sobre el extra NO es cambiar de tema ────────────────────────
//
// Quien pregunta «¿que incluye?» y luego dice «si» esta diciendo que si a esto.
// Sin volver a sellar, contestarle su propia duda le habria quitado el derecho
// a aceptar con un «si» — un arreglo que rompe la venta que venia a proteger.
const contenido = (() => {
  const i = motor.indexOf("async function responderContenidoDelUpsell(");
  return i < 0 ? "" : motor.slice(i, i + 3200);
})();
comprobar(
  "contestar una duda del extra vuelve a sellar",
  /const seguimosEnLoMismo = \(\): true => \{[\s\S]{0,120}?setUpsellHabladoAt\(convo\.id\);/.test(
    contenido
  ),
  "sigue siendo su pregunta"
);
comprobar(
  "y lo hacen sus TRES salidas",
  (contenido.match(/return seguimosEnLoMismo\(\);/g) ?? []).length === 3,
  "galeria, burbujas y generica"
);

// ── 4. La regla, en el sitio donde se decide ─────────────────────────────────
comprobar(
  "hay quien responda si la oferta sigue siendo la ultima pregunta",
  /function laOfertaSigueSiendoLaUltimaPregunta\(convo: ConversationRow\): boolean \{/.test(
    motor
  ),
  "laOfertaSigueSiendoLaUltimaPregunta"
);
// Cero mensajes despues del sello = nadie mas tomo la palabra.
comprobar(
  "y responde que si solo cuando nadie mas hablo",
  /return contarMensajesDelBotDespuesDe\(convo\.id, sellada\) === 0;/.test(motor),
  "cero mensajes en medio"
);
// LAS CONVERSACIONES DE ANTES NO CAMBIAN. Sin sello no hay nada que comparar, y
// adivinar seria peor que dejarlo como estaba.
comprobar(
  "las ofertas anteriores a esto siguen exactamente igual",
  /if \(!sellada\) return true;/.test(motor),
  "NULL = como siempre"
);

// ── 5. Las DOS puertas, cerradas con la misma llave ──────────────────────────
comprobar(
  // LA GUARDA SIGUE, PERO YA NO MATA EL «SI» PARA SIEMPRE.
  //
  // Antes la primera mitad era `hasPendingActionType(ACTION_UPSELL_TIMEOUT)` —
  // «el plazo del segundo producto sigue vivo»—, y ese plazo, una vez vencido,
  // NO VUELVE. Asi que desde que salia el regalo un «si» pelado dejaba de
  // aceptar el segundo producto para el resto de la conversacion.
  //
  // La regla que se queria escribir es la de aqui al lado: con la pregunta del
  // regalo EN PANTALLA hay dos preguntas abiertas. Eso dura lo que dura esa
  // pregunta, no para siempre. La intencion no cambia; cambia cuanto dura.
  "el «si» y el «no» a secas exigen que nadie mas preguntara",
  /const nadieMasPregunto =\s*\r?\n\s*!elRegaloEstaEsperandoRespuesta && esLaUltimaPregunta;/.test(
    motor
  ) &&
    /if \(nadieMasPregunto && detectaSiSimpleAlUpsell\(msgContent\)\)/.test(motor) &&
    /if \(nadieMasPregunto && detectaRechazoDeUpsell\(msgContent\)\)/.test(motor),
  "junto al del regalo, que es la misma regla"
);
comprobar(
  "y el cuadrito de la oferta se mide con la misma vara",
  /const cuadrito = decisionDeLaOfertaDelExtra\(\s*\r?\n\s*config,\s*\r?\n\s*msgContent,\s*\r?\n\s*esLaUltimaPregunta\s*\r?\n\s*\);/.test(
    motor
  ),
  "«si», «ok» y «k» tambien eran una puerta"
);
// Se calcula UNA vez: dos llamadas podrian dar respuestas distintas si entre
// medias entrara un mensaje, y entonces una puerta aceptaria y la otra no.
comprobar(
  "la pregunta se hace una sola vez",
  (motor.match(/laOfertaSigueSiendoLaUltimaPregunta\(convo\)/g) ?? []).length === 1,
  "una respuesta para las dos puertas"
);
// Y se ve en el log por que no acepto. Sin esto, la proxima vez que pase habria
// que adivinarlo otra vez desde cero.
comprobar(
  "y queda dicho en el log",
  /la oferta ya no es la última pregunta — un «sí» a secas no la acepta/.test(
    motor
  ),
  "no hay que adivinar"
);

// ── 6. LO QUE NO CAMBIA ──────────────────────────────────────────────────────
//
// Esto es lo que hace que el arreglo no cueste ventas. Las tres formas
// INEQUIVOCAS de aceptar siguen sin condiciones: tocar el boton, decir el
// nombre del producto, y las claves de varias palabras.
const bloque = (() => {
  const i = motor.indexOf('if (convo.upsell_state === "ofrecido") {');
  return i < 0 ? "" : motor.slice(i, i + 6000);
})();
comprobar(
  "tocar el boton sigue aceptando sin condiciones",
  /const tocoUnBoton = botonDelUpsell\(msgContent, config\);[\s\S]{0,400}?if \(tocoUnBoton === "si"\) \{/.test(
    bloque
  ),
  "lo menos ambiguo que existe"
);
comprobar(
  "pedirlo por su nombre sigue aceptando sin condiciones",
  /if \(detectaAceptacionDeUpsell\(msgContent, config\)\) \{/.test(bloque) &&
    !/esLaUltimaPregunta && detectaAceptacionDeUpsell/.test(bloque),
  "«las flores amarillas»"
);
const cuadritos = (() => {
  const i = motor.indexOf("function decisionDeLaOfertaDelExtra(");
  return i < 0 ? "" : motor.slice(i, i + 3600);
})();
comprobar(
  "una clave de varias palabras decide siempre",
  /if \(puedeDecidirEnFraseLarga\(elegida\)\) return elegida;/.test(cuadritos),
  "«si quiero», «no por ahora»"
);
comprobar(
  "y la corta solo si la oferta es la ultima pregunta",
  /if \(esRespuestaCorta && esLaUltimaPregunta\) return elegida;/.test(cuadritos),
  "«si», «ok», «k»"
);
// El parametro por defecto es `true`: cualquier llamada que no sepa de esto se
// comporta como antes. Un arreglo no puede cambiar caminos que no vino a tocar.
comprobar(
  "quien no pregunte por esto se comporta como antes",
  /esLaUltimaPregunta = true\s*\r?\n\): BubbleDecision \| null \{/.test(cuadritos),
  "por defecto, como siempre"
);

// ── 7. La red del modelo sigue puesta ────────────────────────────────────────
//
// Sin ella esto SI costaria ventas: el «si» que ya no decide aqui tiene que
// poder decidirse en otro sitio.
const manejador = leer("src", "lib", "meta", "handler.ts");
comprobar(
  "el modelo puede aceptar el extra el mismo",
  /<<\\s\*QUIERE_EXTRA\\s\*>>/.test(manejador.replace(/\\/g, "\\")) ||
    /QUIERE_EXTRA/.test(manejador),
  "<<QUIERE_EXTRA>>"
);
comprobar(
  "y solo con la oferta en pie",
  /fuera de la oferta \(estado/.test(manejador),
  "fuera de ella se ignora"
);

console.log(
  fallos === 0
    ? "\nTODO OK — el «si» es de la ultima pregunta"
    : `\n${fallos} comprobacion(es) mal.`
);
process.exit(fallos === 0 ? 0 : 1);
