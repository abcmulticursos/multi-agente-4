// EL BOT NO MANDA NADA ANTES DE LA INTRO. EL CLIENTE ESCRIBE Y CONTESTA.
//
// ESTA PRUEBA EXISTE PARA AVISAR SI ESO VUELVE.
//
// QUE ERA
//
//   Habia un mensaje suelto que salia por delante de la intro, con su propia
//   casilla de UN solo texto. Se hizo en su dia para preguntar el nombre y
//   esperar la respuesta.
//
// QUE ROMPIO
//
//   Esa casilla admite UNA burbuja. El reparto del canal le metia dentro el
//   PRIMER cajon entero: entraba su primera burbuja y las otras nueve —el
//   contenido, las fotos, el video, el precio, el cierre— no tenian donde ir y
//   se descartaban en silencio. Sin error y sin aviso.
//
//   Y como los demas cajones estaban apagados, no quedaba intro del canal: el
//   motor se iba a buscarla a la modalidad y salia la de OTRO producto.
//
//   Una intro de diez burbujas se envio con una, seguida del producto
//   equivocado. En una venta real.
//
// POR QUE NO SE VIO ANTES
//
//   Fue inofensivo mientras el editor dibujaba ese cajon aparte: uno veia una
//   caja de una burbuja y ponia una burbuja. Al unir la intro en una sola lista,
//   la pantalla paso a invitar a llenarlo entero y el motor siguio leyendo una.
//   La pantalla cambio y el motor no.
//
// LO QUE VIGILA
//
//   1. Que el motor no envie nada antes de la intro.
//   2. Que el canal no gaste su primer cajon en esa casilla.
//   3. Que la pantalla no vuelva a ofrecer ese mensaje ni a partir la lista de
//      cajones en dos.
//
//   node scripts/prueba-sin-mensaje-suelto-antes-de-la-intro.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const motor = readFileSync(join(RAIZ, "src", "lib", "workflow", "engine.ts"), "utf8");
const config = readFileSync(join(RAIZ, "src", "lib", "workflow", "config.ts"), "utf8");
const editor = readFileSync(join(RAIZ, "src", "app", "editor", "page.tsx"), "utf8");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// -- 1. EL MOTOR NO MANDA NADA ANTES -----------------------------------------
const arranque = (() => {
  const i = motor.indexOf('if (state === "new") {');
  const f = motor.indexOf("AQUÍ HABÍA DOS ESTADOS DE ESPERA", i);
  return i < 0 || f < 0 ? "" : motor.slice(i, f);
})();
comprobar("se encuentra el arranque", arranque.length > 0, 'state === "new"');
comprobar(
  "el cliente escribe y sale la intro, nada más",
  /await scheduleIntroSequence\(convo\.id\);/.test(arranque) &&
    !/config\.greeting\.text_variants/.test(arranque) &&
    !/config\.greeting\.buttons/.test(arranque),
  "sin nada por delante"
);
// Si alguien vuelve a enviarlo, estas llamadas reaparecen en el arranque.
comprobar(
  "no se envía ningún texto suelto al empezar",
  !/sendBotText\(convo, texto\)/.test(arranque) &&
    !/sendBotButtons\(convo, cuerpo/.test(arranque),
  "ni texto ni botones"
);

// -- 2. EL CANAL NO GASTA SU PRIMER CAJON ------------------------------------
const reparto = (() => {
  const i = config.indexOf("function applyChannelContent(");
  const f = config.indexOf("if (Array.isArray(content.followups))", i);
  return i < 0 || f < 0 ? "" : config.slice(i, f);
})();
comprobar("se encuentra el reparto del canal", reparto.length > 0, "applyChannelContent");
comprobar(
  "todos los cajones son intro, desde el primero",
  /const introOnlyGroups = introGroups\.filter\(/.test(reparto) &&
    !/introGroups\.slice\(1\)/.test(reparto),
  "no empieza en el segundo"
);
// Si quedara algo en esa casilla saldria por delante de la intro, que es justo
// el comportamiento que se esta quitando.
comprobar(
  "y la casilla vieja se vacía a propósito",
  /next\.greeting = \{ \.\.\.next\.greeting, text: "", text_variants: \[\] \};/.test(
    reparto
  ),
  "no puede colarse"
);
comprobar(
  "ya no se busca una burbuja de saludo en el cajón",
  !/greetingStep/.test(reparto) && !/greetingGroup/.test(reparto),
  "no hay cajón especial"
);

// -- 3. LA PANTALLA NO LO OFRECE NI PARTE LA LISTA ---------------------------
comprobar(
  "el editor ya no tiene cajón de saludo",
  !/<Collapsible title="Saludo inicial"/.test(editor) &&
    !/titleKey="journey:greeting"/.test(editor),
  "no se puede escribir"
);
comprobar(
  "ni pregunta inicial de sí o no",
  !/titleKey="journey:initial-question"/.test(editor),
  "tenía la misma espera detrás"
);
// Mientras existan, alguien puede volver a esconder el primer cajon sin saber
// que el motor lo trataba distinto. Que es exactamente lo que paso.
comprobar(
  "y no quedan mandos para partir la lista de cajones",
  !/soloIndice/.test(editor) && !/desdeIndice/.test(editor),
  "la lista se ve entera"
);
// Renombrarlo solo haria creer que sigue habiendo un paso antes.
comprobar(
  // NINGUN cajon se renombra solo, ni el primero ni los demas. La regla que lo
  // hacia corria en CADA pintada, no una vez para migrar, asi que dejo cuatro
  // nombres prohibidos para siempre —el vacio entre ellos— y era imposible
  // quitarle el titulo a un cajon. Ahora el que no tiene nombre lo pide en rojo.
  "el primer cajón del canal ya no se renombra solo",
  !/isLegacyGreetingName/.test(editor) &&
    !/name: sinNombre \?/.test(editor) &&
    !/const sinNombre =/.test(editor),
  "es una intro más"
);
// Esta lista alimenta el visor del recorrido y el clonado a canales. Con la
// burbuja delante, el recorrido enseñaba un mensaje que nadie recibe.
comprobar(
  "el recorrido no enseña un mensaje que no se envía",
  !/label: "Saludo inicial",/.test(editor),
  "lo que se ve es lo que sale"
);
comprobar(
  "y un canal nuevo nace con una intro, no con un saludo",
  /name: "Intro 1",/.test(editor),
  "sin cajón especial"
);

console.log(fallos === 0 ? "\nTODO OK" : `\n${fallos} FALLO(S)`);
process.exit(fallos === 0 ? 0 : 1);
