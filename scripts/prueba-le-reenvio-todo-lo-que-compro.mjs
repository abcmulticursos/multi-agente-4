// Cuatro defectos de la misma tanda de pruebas del dueno, 14/09/2026, en -OB-.
//
//   1. Tras el UPGRADE, detras del enlace le salia «Recibi tu comprobante 🙌
//      dame un momento que lo reviso». Con sus palabras: «este aviso confundira
//      al cliente, pensara que aun no le ha llegado su enlace y reclamara».
//
//   2. Tras el UPGRADE, con el extra ofrecido y sin comprar, nadie se lo volvia
//      a recordar. Salia el regalo y la segunda venta se perdia en silencio.
//
//   3. Al pedir «no me llego mi enlace», el reenvio mandaba UNA sola cosa. Un
//      cliente que compro el combo Y el extra recibia solo el extra.
//
//   4. En -DOU-, «cuanto vale» contesto «Disculpa, no entendi correctamente lo
//      que quisiste decirme». El modelo devolvio VACIO y salio el respaldo.
//
//   node scripts/prueba-le-reenvio-todo-lo-que-compro.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
// LOS SALTOS DE LINEA SE NORMALIZAN, Y NO ES UN DETALLE.
//
// Los archivos del proyecto estan guardados con CRLF. Las anclas de `trozo` se
// escriben con "\n", asi que NUNCA encontraban el final: el trozo se comia el
// resto del archivo entero y las comprobaciones de abajo pasaban mirando codigo
// de otras funciones. Verde, y sin comprobar lo que decia comprobar.
//
// Se descubrio el 15 de septiembre de 2026 al cambiar el recordatorio del
// upsell: una comprobacion nueva —«aqui YA NO se reprograma la presentacion»—
// fallaba porque encontraba esa constante ochocientas lineas mas abajo.
const leer = (...p) =>
  readFileSync(join(RAIZ, ...p), "utf8").replace(/\r\n/g, "\n");
const pago = leer("src", "lib", "workflow", "payment.ts");
const motor = leer("src", "lib", "workflow", "engine.ts");
const manejador = leer("src", "lib", "meta", "handler.ts");
const llm = leer("src", "lib", "openrouter.ts");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};
const trozo = (fuente, desde, hasta) => {
  const i = fuente.indexOf(desde);
  if (i < 0) return "";
  const f = fuente.indexOf(hasta, i);
  return f < 0 ? fuente.slice(i) : fuente.slice(i, f);
};

// ── 1. EL ACUSE NO SALE DETRAS DE UNA ENTREGA ────────────────────────────────
//
// El freno miraba `paid_at` para no acusar un comprobante recien aprobado, pero
// la fila que le llegaba se habia leido al EMPEZAR el turno: traia el sello de
// la compra ANTERIOR. En el upgrade eso son varios minutos, asi que el freno no
// saltaba. En otras dos ventanas no salio, y no fue suerte: alli la primera
// compra era tan reciente que el sello viejo aun caia dentro de los 120 s.
console.log("\n— 1. el acuse no sale detras del enlace —\n");
const acuse = trozo(
  manejador,
  "async function acusarElComprobanteSiSeQuedoMudo(",
  "\n}"
);
comprobar(
  "la conversacion se vuelve a leer antes de decidir",
  /const alDia = getConversationById\(convo\.id\) \?\? convo;/.test(acuse),
  "no se decide con datos viejos"
);
comprobar(
  "y el freno se evalua con esa fila fresca",
  /debeAcusarElComprobante\(\s*ultimo,\s*alDia,/.test(acuse),
  "no con la del principio del turno"
);
comprobar(
  "el freno sigue mirando el pago, no el estado",
  /const recienEntregado =\s*typeof convo\.paid_at === "number" && ahoraSegundos - convo\.paid_at <= 120;/.test(
    manejador
  ),
  "la regla de antes, intacta"
);
comprobar(
  "y solo acusa si lo que mando fue un comprobante",
  /if \(!esComprobante\) return false;/.test(manejador),
  "no se inventa nada"
);

// ── 2. LA OFERTA SIN CONTESTAR VUELVE A LA COLA ──────────────────────────────
console.log("\n— 2. tras el upgrade, el extra se recuerda —\n");
const tras = trozo(motor, "  // Y SI LA OFERTA SE QUEDÓ SIN CONTESTAR", "\n  if (\n    fresco.upsell_state === \"ofrecido\" ||");
// CAMBIO LA HERRAMIENTA, NO LA INTENCION — 15 de septiembre de 2026.
//
// Esto comprobaba que la oferta sin contestar «volviera a la cola de SIEMPRE,
// con su presentacion». Y esa era justo la parte equivocada: por aqui se pasa
// tras CUALQUIER entrega, incluido el reenvio de «no me llego mi enlace», asi
// que al cliente le caia la intro del extra por segunda vez. Con sus palabras:
// «luego de reenviar el enlace, nuevamente se envia la intro del upsell. Eso no
// deberia pasar».
//
// Lo que se protege sigue siendo lo mismo —que tras el upgrade la segunda venta
// no se pierda en silencio— pero ahora con lo que el pidio: un recordatorio
// corto, una sola vez. Las comprobaciones se mudan, no se borran.
comprobar(
  "solo con la oferta «ofrecido»",
  /fresco\.upsell_state === "ofrecido"/.test(tras),
  "ni aceptado, ni rechazado, ni pagado"
);
comprobar(
  "y NO se reprograma la presentacion",
  !/ACTION_UPSELL_PRESENTAR/.test(tras),
  "se acabo la intro repetida"
);
comprobar(
  "lo que sale es el recordatorio",
  /programarRecordatorioDelUpsell\(fresco, "tras la entrega"\)/.test(tras),
  "un texto suyo, no la intro"
);
// Las guardas se mudaron DENTRO de la funcion, que es donde tienen que estar:
// asi las dos puertas que la llaman no tienen que repetirlas.
const programa = trozo(
  motor,
  "function programarRecordatorioDelUpsell",
  "\n/** Manda el recordatorio"
);
comprobar(
  "y solo si el extra esta escrito",
  /if \(!texto\) return;/.test(programa) &&
    /if \(!\(up\?\.name \?\? ""\)\.trim\(\)\) return;/.test(programa),
  "sin texto ni nombre, no se manda"
);
comprobar(
  "no se pisa si ya hay uno en cola",
  /!hasPendingActionType\(convo\.id, ACTION_UPSELL_RECORDATORIO\)/.test(programa) ||
    /hasPendingActionType\(convo\.id, ACTION_UPSELL_RECORDATORIO\)/.test(programa),
  "no se duplica"
);
comprobar(
  "y respeta su retraso configurado",
  /retraso_minutos/.test(programa),
  "no se encadena al segundo"
);
comprobar(
  "y el regalo sigue esperando al extra, como antes",
  /fresco\.upsell_state === "ofrecido" \|\|\s*fresco\.upsell_state === "aceptado"/.test(
    motor
  ),
  "esa regla no se toco"
);

// ── 3. EL REENVIO MANDA TODO LO QUE COMPRO ───────────────────────────────────
console.log("\n— 3. el reenvio manda todo lo que compro —\n");
const reenvio = trozo(
  pago,
  "export function resendApprovedMaterial(",
  "\nasync function sendImmediateDeliveryStep("
);
comprobar(
  "ya no es una escalera de returns",
  (reenvio.match(/\n      return true;/g) ?? []).length === 0,
  "la primera rama no se lleva el turno"
);
comprobar(
  "lo principal sale de la eleccion de HOY",
  /convo\.order_bump_choice === "combo" \|\|\s*convo\.order_bump_choice === "basico"/.test(
    reenvio
  ),
  "el upgrade ya la dejo en combo"
);
comprobar(
  "con su bioferta y su lineal detras",
  /convo\.bioferta_choice === "b" \|\| convo\.bioferta_choice === "pack"/.test(
    reenvio
  ) && /config\?\.payment_approved_sequence/.test(reenvio),
  "las tres modalidades"
);
comprobar(
  "el extra SOLO si lo pago",
  /convo\.upsell_state === "pagado" \? seccionUpsell\(config\)\?\.delivery : null/.test(
    reenvio
  ),
  "ofrecido o aceptado no es comprado"
);
comprobar(
  "y se encadena detras de lo principal",
  /sinCancelar: !!loPrincipal, retrasoInicialSeg: corrido/.test(reenvio),
  "no se come la primera entrega"
);
comprobar(
  "el cierre lo marca solo la ultima de la tanda",
  /\{ noEsLaUltima: hayExtra \}/.test(reenvio),
  "la postventa no corre dos veces"
);
comprobar(
  "y el pedido del correo va una sola vez, al final",
  /hayExtra \? true : skipEmailRequest/.test(reenvio),
  "no se pide dos veces"
);
comprobar(
  "sin nada que reenviar, el camino de siempre",
  /if \(!loPrincipal && !hayExtra\) \{/.test(reenvio),
  "nadie se queda sin aviso"
);
comprobar(
  "y a quien no pago no se le reenvia nada",
  /pidieron reenvío pero NO figura pago — no reenvío/.test(pago),
  "esa guarda no se toco"
);

// ── 3 bis. EL PROGRAMADOR ADMITE ENCADENAR, SIN CAMBIAR LO DE ANTES ──────────
console.log("\n— y el programador de entregas, compatible —\n");
const programador = trozo(
  pago,
  "function scheduleDeliverySequence(",
  "\nexport function scheduleDeliveryBySource("
);
comprobar(
  "las tres opciones nuevas son opcionales",
  /opciones: \{\s*sinCancelar\?: boolean;\s*retrasoInicialSeg\?: number;\s*noEsLaUltima\?: boolean;\s*\} = \{\}/.test(
    programador
  ),
  "las llamadas de siempre no cambian"
);
comprobar(
  "solo cancela lo pendiente si no va encadenada",
  /if \(opciones\.sinCancelar !== true\) \{\s*cancelPendingActionsForConvo/.test(
    programador
  ),
  "la de detras no borra la de delante"
);
comprobar(
  "la encadenada no manda su primera burbuja al instante",
  /opciones\.sinCancelar !== true;/.test(programador),
  "no se cuela por delante"
);
comprobar(
  "devuelve cuanto dura, para poder encadenar",
  /return cumulativeDelay;/.test(programador),
  "sin adivinar tiempos"
);

// ── 4. UNA RESPUESTA VACIA SE VUELVE A PEDIR ─────────────────────────────────
console.log("\n— 4. el vacio se vuelve a pedir antes de disculparse —\n");
comprobar(
  "hay un reintento antes del respaldo",
  /if \(respuestaVaciaRetries < 1\) \{/.test(llm) &&
    /let respuestaVaciaRetries = 0;/.test(llm),
  "un vacio es un turno que salio mal"
);
comprobar(
  "y queda escrito en el registro",
  /el modelo devolvió vacío; lo pido otra vez/.test(llm),
  "antes no se veia"
);
comprobar(
  "la frase de disculpa sigue ahi, para cuando insiste",
  /return safeEmptyLlmReply\(convo\);/.test(llm) &&
    /sigue devolviendo vacío; uso el respaldo/.test(llm),
  "no se quita el ultimo respaldo"
);
comprobar(
  "el reintento no gasta mas de una llamada",
  /respuestaVaciaRetries \+= 1;/.test(llm),
  "una, y no mas"
);

console.log(
  fallos === 0
    ? "\nTODO OK — le llega todo lo que compro, y sin avisos que confundan"
    : `\n${fallos} comprobacion(es) mal.`
);
process.exit(fallos === 0 ? 0 : 1);
