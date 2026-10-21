// El cliente escribe y el bot contesta. Sin pausa.
//
// COMO ESTABA
//
//   Habia TRES sitios que podian frenar la conversacion nada mas empezarla:
//
//     1. Un «inicio inmediato» POR CADA INTRO. Unas esperaban y otras no, sin
//        nada visible que lo explicara.
//     2. Un interruptor global. Apagado, el bot mandaba el saludo, se quedaba en
//        «esperando respuesta» y soltaba la intro solo cuando el cliente volvia
//        a escribir — o cuando vencia un temporizador de cinco minutos.
//     3. Una «pregunta inicial» de si o no, con esa misma espera detras.
//
// POR QUE EXISTIAN, Y POR QUE YA NO
//
//   El saludo era un paso APARTE, hecho para capturar el nombre: se mandaba, se
//   esperaba la respuesta, y de ahi salia el nombre del cliente.
//
//   Hoy el nombre lo pide cualquier burbuja con su casilla, y con plazo propio.
//   Sin esa razon, la espera solo aportaba un hueco muerto al principio de cada
//   conversacion: el cliente escribia, recibia una linea, y el resto llegaba
//   cuando volvia a escribir o cinco minutos despues.
//
// COMO QUEDA
//
//   El saludo sale como el PRIMER MENSAJE, no como un paso que espera, y la
//   intro va detras con su separacion de siempre.
//
// LO QUE NO SE TOCA
//
//   La burbuja con cuadritos de decision SI sigue esperando: ahi hay una
//   pregunta de verdad. Y no se borra nada del archivo: los campos siguen
//   escritos y los caminos de la pregunta inicial siguen enteros; simplemente ya
//   nadie los arranca.
//
//   node scripts/prueba-la-intro-sale-sola.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");
const motor = leer("src", "lib", "workflow", "engine.ts");
const config = leer("src", "lib", "workflow", "config.ts");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

const arranque = (() => {
  const i = motor.indexOf("LA INTRO SALE SOLA. NO HAY PAUSA QUE ESPERAR");
  // El tope era la rama de la pregunta inicial, que ya no existe.
  const f = motor.indexOf("AQUÍ HABÍA DOS ESTADOS DE ESPERA", i);
  return i < 0 || f < 0 ? "" : motor.slice(i, f);
})();
comprobar("se encuentra el arranque", arranque.length > 0, "primer mensaje");

// -- 1. NINGUNA DE LAS TRES PAUSAS ARRANCA -----------------------------------
comprobar(
  "no queda el «inicio inmediato» por intro",
  !/skipAskNameForChosenIntro/.test(motor),
  "1 de 3"
);
comprobar(
  "ni el interruptor global",
  !/skip_ask_name === true/.test(motor),
  "2 de 3"
);
comprobar(
  "ni la pregunta inicial",
  !/initial_question_flow;/.test(arranque),
  "3 de 3"
);
// Sin estado de espera no hay nada parado que rescatar.
comprobar(
  "y no se deja la conversacion esperando",
  !/setConversationState\(convo\.id, "awaiting_response"\)/.test(arranque),
  "sin estado de espera"
);
comprobar(
  "ni se programa el rescate de cinco minutos",
  !/ACTION_FALLBACK_INTRO/.test(arranque),
  "sin temporizador"
);

// -- 2. Y NO SALE NADA POR DELANTE DE ELLA -----------------------------------
//
// Aqui se exigia lo contrario: que el mensaje suelto del arranque siguiera
// saliendo. Ya no existe.
//
// Esa casilla admitia UNA burbuja, y el reparto del canal le metia dentro el
// primer cajon entero: entraba su primera burbuja y las otras nueve se
// descartaban en silencio. Una intro de diez se envio con una, en una venta
// real. Ver `prueba-sin-mensaje-suelto-antes-de-la-intro`.
comprobar(
  "la intro sale sola, sin nada por delante",
  /await scheduleIntroSequence\(convo\.id\);/.test(arranque) &&
    !/greetingText/.test(arranque) &&
    !/botonesDelSaludo/.test(arranque),
  "el cliente escribe y el bot contesta"
);
// El orden importa: primero el saludo, despues la intro.
comprobar(
  "en ese orden, saludo y luego intro",
  arranque.indexOf("if (greetingText.trim())") <
    arranque.indexOf("await scheduleIntroSequence(convo.id);"),
  "no al reves"
);

// -- 3. LO QUE SI SIGUE ESPERANDO --------------------------------------------
//
// Una burbuja con cuadritos de decision es una pregunta de verdad, y ahi la
// pausa tiene sentido. Si esto se cayera, la intro pasaria por encima de la
// pregunta y la respuesta del cliente llegaria metida en medio.
comprobar(
  "una burbuja con cuadritos sigue deteniendo la intro",
  /decisionesEncendidas\(step\.decisions\)\.length > 0/.test(motor),
  "ahi si hay pregunta"
);
comprobar(
  "y la que pide el nombre, tambien",
  /step\.capturar_nombre === true/.test(motor),
  "con su plazo propio"
);

// -- 4. NO SE BORRA NADA DEL ARCHIVO -----------------------------------------
comprobar(
  "los campos siguen existiendo",
  /skip_ask_name\?: boolean;/.test(config) &&
    /initial_question_flow\?:/.test(config),
  "solo se dejan de leer"
);

console.log(fallos === 0 ? "\nTODO OK" : `\n${fallos} FALLO(S)`);
process.exit(fallos === 0 ? 0 : 1);
