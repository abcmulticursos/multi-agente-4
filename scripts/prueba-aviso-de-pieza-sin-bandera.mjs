// UNA PIEZA ENCENDIDA SIN BANDERA SE VE, Y LAS APAGADAS NO SE MANCHAN.
//
// LO PIDIÓ EL DUEÑO el 2 de octubre de 2026: «necesito que sin país seleccionado no
// salga nada: que se ponga rojo el borde del seguimiento, intro, intro de order bump etc
// y un aviso rojito de peligro, o de warning rojo, pequeño suficiente para que uno lo
// note, y en los apagados no aparezca nada de eso».
//
// ── POR QUÉ ES UN AVISO Y NO UN CANDADO ────────────────────────────────────
//
// Él lo pidió primero como candado: «si no se elige bandera de país, no se pueda
// trabajar, incluso no se pueda guardar». Se midió su contenido antes de hacerlo:
//
//     piezas encendidas SIN bandera    125
//     piezas encendidas CON bandera     34
//
// Las 125 funcionan A PROPÓSITO. El motor lo dice con estas palabras: «SIN BANDERAS
// PUESTAS NO CAMBIA NADA: todos quedan generales» y «la bandera dirige; nunca deja a
// nadie fuera».
//
// Y ese último respaldo lo puso una prueba SUYA: con todos los cajones etiquetados y un
// cliente de un país sin cajón, el bot se quedaba SIN INTRO. Un cliente sin intro es una
// venta perdida segura — mucho peor que una intro que no era para él.
//
// Así que no se apaga nada ni se bloquea el guardado: se hace que esas 125 SE VEAN, para
// que él las etiquete y el respaldo deje de hacer falta por sí solo.
//
//   node scripts/prueba-aviso-de-pieza-sin-bandera.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const pantalla = readFileSync(join(RAIZ, "src", "app", "editor", "page.tsx"), "utf8");
const motor = readFileSync(join(RAIZ, "src", "lib", "workflow", "config.ts"), "utf8");

let fallos = 0;
const pad = (s, n) => (String(s ?? "") + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// ── 1. LA REGLA VIVE EN UN SOLO SITIO ──────────────────────────────────────
//
// Son TRES piezas distintas —la intro, el seguimiento y su variante— y la misma regla
// escrita tres veces es exactamente cómo se rompe este proyecto: se arregla en una y las
// otras dos se quedan atrás. Ya pasó con `image_gallery_2` y con los tiempos de las
// burbujas.
console.log("\n— 1. una sola regla para las tres piezas —\n");
comprobar(
  "existe `leFaltaLaBandera`, una sola vez",
  (pantalla.match(/function leFaltaLaBandera\(/g) ?? []).length === 1,
  "no copiada en cada sitio"
);
comprobar(
  "y la usan las tres piezas",
  (pantalla.match(/leFaltaLaBandera\(\{/g) ?? []).length >= 6,
  "aviso + borde en cada una"
);

// ── 2. LOS DOS CASOS EN QUE NO SE AVISA ────────────────────────────────────
console.log("\n— 2. cuándo se calla —\n");
comprobar(
  "una pieza APAGADA no se mancha",
  /if \(pieza\.apagada\) return false;/.test(pantalla),
  "lo pidió él expreso"
);
// ESTA COMPROBACION CAMBIO DE INTENCION EL 02/10/2026, Y LA CAZO EL DUEÑO.
//
// DECIA: con «dirigir por pais» apagado NO se avisa, porque «es una respuesta suya, no un
// olvido». Ese razonamiento valia cuando una pieza sin bandera salia para todos. Dejo de
// valer el mismo dia, cuando el pidio que sin bandera no saliera — y nadie volvio a mirar
// aqui.
//
// Con sus palabras: «tambien hay un boton de off que apaga las banderas; eso deberia
// equivaler a no tener bandera».
//
// Y ES LO QUE HACE EL MOTOR: `banderasDe` devuelve lista VACIA con ese interruptor
// apagado, en los tres sitios que encaminan por pais. Asi que la pieza NO SALE. La
// pantalla decia que todo estaba bien mientras el motor la silenciaba: dos sitios
// contestando distinto a la misma pregunta, el fallo numero uno de esta casa.
comprobar(
  "y el encaminado por país apagado es como no tener bandera",
  /if \(pieza\.routingEnabled === false\) return true;/.test(pantalla),
  "el motor tampoco la envía"
);
// LA MISMA PREGUNTA QUE HACE EL MOTOR. Si el aviso dijera «te falta» donde el motor lee
// «general a propósito», estaría mandándole a arreglar algo que ya está bien.
comprobar(
  "y el motor lee ese interruptor igual",
  /pais_routing_enabled === false\s*\r?\n?\s*\? \[\]/.test(motor),
  "no pueden decir cosas distintas"
);

// ── 3. UN PAÍS EN BLANCO NO CUENTA COMO PAÍS ───────────────────────────────
//
// Una lista con [""] dentro existe y está vacía de verdad. El motor hace el mismo
// `filter(Boolean)` antes de decidir.
console.log("\n— 3. un país en blanco no cuenta —\n");
comprobar(
  "se descartan los vacíos antes de contar",
  /\(pieza\.paises \?\? \[\]\)\.filter\(\(p\) => String\(p \?\? ""\)\.trim\(\)\)\.length === 0/.test(
    pantalla
  ),
  "igual que el motor"
);

// ── 4. SE VE: AVISO ROJO Y BORDE ROJO ──────────────────────────────────────
//
// Él pidió las dos cosas: «que se ponga rojo el borde… y un aviso rojito de peligro…
// pequeño suficiente para que uno lo note».
console.log("\n— 4. se ve, y es pequeño —\n");
// EL AVISO SE QUEDO EN EL SIMBOLO SOLO el 02/10/2026, a peticion del dueño: «el simbolo
// pequeño de warning, un hint invisible al yo poner el mouse… esto, PARA NO ENSUCIAR LA
// PANTALLA». Llevaba el texto «sin pais» al lado, y en una lista de cuarenta pestañas eso
// es cuarenta veces la misma frase.
comprobar(
  "el aviso es rojo y pequeño",
  /function AvisoSinBandera\(/.test(pantalla) &&
    /border-red-400 bg-red-50/.test(pantalla) &&
    /text-\[11px\] font-bold text-red-700/.test(pantalla),
  "solo el símbolo"
);
comprobar(
  "y dice qué hacer, no solo que está mal",
  /Elige la bandera del país al que va esta pestaña/.test(pantalla),
  "un aviso sin salida enseña a ignorarlo"
);
comprobar(
  "el borde se pone rojo",
  /function bordeSinBandera</.test(pantalla) && /border-red-500 bg-red-50/.test(pantalla)
);
comprobar(
  "y respeta el color que ya tenía cuando no falta",
  /return falta \? "border border-red-500 bg-red-50 text-red-900" : deSiempre;/.test(
    pantalla
  ),
  "no repinta lo que estaba bien"
);
// LA PALABRA `border` SUELTA, Y NO SOBRA.
//
// LO VIO EL DUEÑO el 02/10/2026: «se pone un poco rojizo el background de la fachada, yo
// necesito que el BORDE tambien se ponga un poco rojo».
//
// La cabecera del cajon no trae grosor de borde —solo relleno y color de fondo— asi que
// `border-red-500` pintaba el color de un borde que NO EXISTIA: el fondo se veia y el
// trazo no. Sin esta palabra, el aviso vuelve a ser medio aviso.
comprobar(
  "el borde tiene grosor, no solo color",
  /falta \? "border border-red-500/.test(pantalla),
  "un color sin trazo no se ve"
);
// ── Y EN LA FACHADA, QUE ES DONDE EL MIRA ──────────────────────────────────
//
// LO COMPROBO EL DUEÑO el 02/10/2026: «acabo de quitarle el pais y no pasa nada, sigue
// igual». Tenia razon: estaba puesto solo en la cabecera de «Variante principal», que
// esta DENTRO del seguimiento, asi que habia que abrirlo para verlo. La fachada es la
// TARJETA de fuera y su barra — lo que se ve con la lista cerrada.
comprobar(
  "la tarjeta del seguimiento se pone roja",
  /className=\{`rounded-lg border p-4 \$\{bordeSinBandera\(/.test(pantalla),
  "la fachada, no solo lo de dentro"
);
comprobar(
  "y su barra de titulo tambien",
  /mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 \$\{bordeSinBandera\(/.test(
    pantalla
  )
);
comprobar(
  "y el cajon de intro lleva su borde en la fachada",
  /titleClassName=\{bordeSinBandera\(\s*\r?\n?\s*leFaltaLaBandera\(\{\s*\r?\n?\s*paises: grupo\.paises,/.test(
    pantalla
  ),
  "intro, intro de order bump, etc"
);

// ── 4-bis. LA BANDERA SE ELIGE EN LA FACHADA ───────────────────────────────
//
// LO PIDIO EL DUEÑO el 02/10/2026: «al lado de lineal a su izquierda este el selector de
// banderas, que al desplegar aparezca la bandera con el nombre pero al ser seleccionado
// solo muestre la bandera», «para evitar agrandar el espacio».
console.log("\n— 4-bis. la bandera se elige en la fachada —\n");
comprobar(
  "existe la pastilla de pais",
  /function PastillaDePais\(/.test(pantalla)
);
comprobar(
  "va a la IZQUIERDA de la semimodalidad",
  // El hueco da para la pastilla, el aviso rojo de al lado y el comentario que explica
  // el orden. Lo que se comprueba es el ORDEN, no la distancia.
  /<PastillaDePais[\s\S]{0,1400}?<PastillaDeSemimodalidad/.test(pantalla),
  "el orden que el pidio"
);
comprobar(
  "cerrada enseña solo la bandera",
  /\{puestos\.length > 0 \? puestos\.map\(banderaDe\)\.join\(""\) : "\+ país"\}/.test(
    pantalla
  ),
  "sin el nombre, para no ensanchar"
);
comprobar(
  "y abierta, la bandera con el nombre",
  /<span aria-hidden>\{banderaDe\(p\.code\)\}<\/span>\s*\r?\n?\s*\{nombreDe\(p\.code\)\}/.test(
    pantalla
  )
);
comprobar(
  "la bandera ya no se repite pegada al nombre",
  !/banderasDeLaPieza\(grupo\.paises\)\s*\r?\n?\s*\? `\$\{banderasDeLaPieza\(grupo\.paises\)\} `/.test(
    pantalla
  ),
  "estaba en dos sitios y partia el titulo"
);
comprobar(
  // La bandera y el nombre salen del MISMO sitio que en el resto de la pantalla. Otra
  // lista de banderas escrita aparte serian dos verdades sobre el mismo pais.
  "y sale del mismo sitio que el resto",
  /const banderaDe = \(code: string\): string => banderasDeLaPieza\(\[code\]\);/.test(
    pantalla
  ),
  "una sola lista de paises"
);

// ── 5. QUÉ HACE EL MOTOR CON ESTO ──────────────────────────────────────────
//
// AQUI ESTABA LA MITAD QUE CAMBIO. Esta prueba nacio la mañana del 02/10/2026 diciendo
// que el motor NO se tocaba: el aviso era solo un aviso y las piezas sin bandera seguian
// saliendo. Esa tarde el dueño pidio cuatro veces lo contrario —«sino no se disparan»—,
// se le midio su contenido con los nombres delante, y se encendio.
//
// La regla y sus tres sitios se comprueban en `prueba-sin-bandera-no-se-dispara`. Aqui
// solo queda lo que sigue siendo de esta prueba: que el aviso y el motor PREGUNTEN LO
// MISMO. Si el aviso dijera «te falta» donde el motor deja pasar —o al reves— el dueño
// estaria arreglando lo que no esta roto, o creyendo que algo sale cuando no sale.
console.log("\n— 5. el aviso y el motor preguntan lo mismo —\n");
comprobar(
  "el motor descarta lo que no lleva bandera",
  /const conBandera = encendidos\.filter\(\(g\) => banderasDe\(g\)\.length > 0\);/.test(
    motor
  ),
  "y el aviso señala justo esas"
);
comprobar(
  "salvo que NINGUNA la lleve, y entonces nada cambia",
  /conBandera\.length === 0\s*\r?\n?\s*\? encendidos/.test(motor),
  "esto es una plantilla"
);
comprobar(
  "y nadie se queda sin intro por una bandera",
  /: deSuPais\.length > 0\s*\r?\n?\s*\? deSuPais\s*\r?\n?\s*: conBandera;/.test(motor),
  "el último respaldo, puesto por una prueba suya"
);

console.log(
  fallos === 0
    ? "\nTODO OK — la pieza encendida sin bandera se ve, y el motor no cambia\n"
    : `\n${fallos} FALLO(S)\n`
);
process.exit(fallos === 0 ? 0 : 1);
