// La cabecera de un cajon de intro: solo simbolos, y la papelera al final.
//
// COMO ESTABA
//
//   Una fila con «☐ Copiar», «↑», «↓», «⋮⋮ Mover» y «▲ Ocultar / ▼ Mostrar»,
//   y dentro del cajon, ademas, «Duplicar cajon» y «Quitar». Con el nombre del
//   cajon compitiendo por el mismo renglon, los titulos largos se partian en
//   dos lineas y los botones se apilaban.
//
// COMO QUEDA
//
//   Solo el check —verde al marcarlo—, los simbolos de subir, bajar y mover, y
//   la papelera. Lo que decia cada palabra sigue en el `title`, que es donde se
//   mira cuando de verdad hay duda.
//
// «OCULTAR» SOBRABA
//
//   La flecha de la izquierda ya dice si esta abierto o cerrado, y la barra
//   entera es el boton. Decirlo otra vez con palabras al otro extremo no añadia
//   nada. Se queda «Mostrar» solo cuando esta cerrado, que es la unica de las
//   dos que invita a hacer algo.
//
// «INICIO INMEDIATO» SE RETIRA, Y NO SOLO DE LA PANTALLA
//
//   Era un interruptor POR INTRO que decidia si esa intro esperaba la respuesta
//   al saludo o salia de una. Se puso para saltarse la burbuja del saludo
//   inicial en algunas intros. Esa burbuja ya no esta, asi que el interruptor
//   decidia sobre algo que no existe: en unas intros el bot esperaba y en otras
//   no, sin nada visible que lo explicara.
//
//   Queda UN solo mando, el de la pestaña Intro, que vale para todas.
//
//   node scripts/prueba-cabecera-del-cajon-de-intro.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");
const editor = leer("src", "app", "editor", "page.tsx");
const motor = leer("src", "lib", "workflow", "engine.ts");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

const cajon = (() => {
  const i = editor.indexOf("function ChannelIntroEditor(");
  const f = editor.indexOf("function ChannelFollowupsEditor(", i);
  return i < 0 || f < 0 ? "" : editor.slice(i, f);
})();
comprobar("se encuentra el cajon de intro", cajon.length > 0, "ChannelIntroEditor");

// -- 1. EL CHECK, SOLO Y VERDE -----------------------------------------------
comprobar(
  "el check va solo, sin la palabra Copiar",
  /<span className="sr-only">Seleccionar para copiar<\/span>/.test(cajon) &&
    !/\n\s*Copiar\s*\n\s*<\/label>/.test(cajon),
  "sin texto al lado"
);
// El verde es lo que hace falta: hay que ver de un vistazo cuales estan
// marcados antes de copiar.
comprobar(
  "y se pone verde al marcarlo",
  /accent-emerald-600/.test(cajon),
  "se ve cuales van"
);

// -- 2. SUBIR, BAJAR Y MOVER SE QUEDAN SIN PALABRA ---------------------------
//
// ESTO DESHACE LO QUE ESTA MISMA PRUEBA EXIGIA ANTES, asi que queda contado.
//
// ANTES se pedia la palabra al lado del simbolo, y el motivo era bueno: se
// habian probado con «⌃» y «⌄», que parecen pareja y no lo son —ningun tipo de
// letra los dibuja igual, el de bajar salia mas fino y mas corto—.
//
// AHORA se usan «↑» y «↓», que si son pareja de verdad y se dibujan iguales en
// cualquier tipo de letra: el problema de entonces no puede volver.
//
// Y LO PIDIO EL DUENO el 30/09/2026, con un motivo de espacio: la etiqueta de
// semimodalidad entra en esta misma fila. Con sus palabras: «hay que minimizar
// espacio... quitar el texto y que solo queden las flechas».
//
// Lo que NO se pierde: cada boton sigue diciendo que hace al pasar el raton, y
// lo lleva en `aria-label` para quien no ve la pantalla. Eso es lo que se
// comprueba ahora.
for (const [que, etiqueta] of [
  ["subir", 'aria-label="Subir este cajón"'],
  ["bajar", 'aria-label="Bajar este cajón"'],
  ["mover", 'aria-label="Arrastrar para moverlo de sitio"'],
]) {
  comprobar(`«${que}» dice que hace, sin ocupar sitio`, cajon.includes(etiqueta), etiqueta);
}
comprobar(
  "y ya no gastan sitio con la palabra",
  !/>\s*↑ Subir\s*</.test(cajon) &&
    !/>\s*↓ Bajar\s*</.test(cajon) &&
    !/>\s*⋮⋮ Mover\s*</.test(cajon),
  "el sitio es para la etiqueta"
);
comprobar(
  "que es lo que entra en su lugar",
  cajon.includes("PastillaDeSemimodalidad"),
  "la etiqueta, en la fachada"
);

// -- 3. LA PAPELERA, EN LA CABECERA Y LA ULTIMA ------------------------------
comprobar(
  "la papelera esta en la cabecera",
  /title="Quitar este cajón"[\s\S]{0,300}?🗑️/.test(cajon),
  "sin abrir el cajon"
);
// Lo que borra nunca se pone al lado de lo que se pulsa a menudo.
comprobar(
  "y va la ultima de la fila",
  cajon.indexOf('title="Quitar este cajón"') >
    cajon.indexOf('title="Arrastrar para moverlo de sitio"'),
  "detras de mover"
);
comprobar(
  "ya no hay un «Quitar» dentro del cajon",
  !/>\s*\r?\n\s*Quitar\s*\r?\n\s*<\/button>/.test(cajon),
  "un solo sitio"
);
comprobar(
  "y «Duplicar cajón» se queda",
  /Duplicar cajón/.test(cajon),
  "como se pidio"
);

// -- 4. «OCULTAR» SOBRABA ----------------------------------------------------
const barra = (() => {
  const i = editor.indexOf("function Collapsible(");
  const f = editor.indexOf("function ChapaDeComodin(", i);
  return i < 0 || f < 0 ? "" : editor.slice(i, f);
})();
// LA CHAPA SE VA ENTERA, no solo la mitad. La flecha de la izquierda ya dice si
// esta abierto o cerrado, y la barra entera es el boton.
// Se busca la chapa DIBUJADA, no las palabras sueltas: el comentario que
// explica por que se fue las nombra, y buscarlas a secas encontraria ese
// comentario y daria falso rojo para siempre.
comprobar(
  "la barra ya no dibuja Ocultar ni Mostrar",
  !/>\s*\r?\n\s*▲ Ocultar/.test(barra) &&
    !/>\s*\r?\n\s*▼ Mostrar/.test(barra),
  "la flecha ya lo dice"
);

// -- 4 bis. EL CAJON ABIERTO SE DISTINGUE ------------------------------------
//
// Todos se veian igual, asi que con uno abierto no habia forma de saber cual se
// estaba editando: habia que fijarse en cual tenia cosas debajo.
//
// Se marca con BORDE, no atenuando los demas: atenuar obliga a apagar los
// nombres de los otros cajones, que es lo que hace falta leer para orientarse.
// Y ES UNO SOLO: el ULTIMO que se toco. Antes marcaba «abierto», y se pueden
// tener varios abiertos a la vez: al final media pantalla iba con borde y
// dejaba de decir nada.
// UNA SOLA LINEA, Y DEL MISMO GROSOR QUE LA NORMAL: solo cambia el color.
// Con un borde mas grueso la pestaña crecia un pixel al activarse y todo lo de
// abajo daba un saltito. Y dos lineas —borde mas aro— se funden en un Mac y se
// ven separadas en un PC, asi que lo mismo se veia distinto segun la pantalla.
comprobar(
  "el cajon activo lleva borde propio",
  // Se mira la linea del contenedor, no todo el archivo: `border-2` aparece en
  // medio editor para otras cosas y buscarlo suelto daria rojo para siempre.
  // EL GROSOR SOLO CRECE EN LA SELECCIONADA: 2 px marcada, 1 px sin marcar.
  //
  // Se probo dejando 2 px en las dos, para que no diera el saltito de un pixel
  // al marcarla, y engordaba TODAS las pestañas. La linea gruesa es la marca de
  // «estoy aqui»: si la llevan todas, deja de marcar nada.
  //
  // El ancho va DENTRO de cada rama, no en la base: dos anchos de borde sueltos
  // en la misma clase y gana el que decida el CSS generado, no el orden en que
  // se escriben.
  //
  // Y LA BARRA YA NO ES GRIS: ES UNA TARJETA BLANCA SOBRE EL PANEL GRIS.
  // Era gris muy claro sobre un suelo casi blanco, o sea una lista de barras
  // planas todas iguales. Ahora es la fila de Canales, para todas.
  /className=\{`rounded-2xl bg-tarjeta \$\{\s*\r?\n\s*activo\s*\r?\n?\s*\? "border-2 border-emerald-600 shadow-md"\s*\r?\n?\s*: "border border-borde shadow-sm"/.test(
    barra
  ),
  "2 px marcada, 1 px sin marcar"
);
comprobar(
  "y solo puede haber uno",
  /setActivo\(cual === storageKey\);/.test(barra),
  "los demas se apagan solos"
);
// Un clic DENTRO tambien lo activa: no hace falta volver a la cabecera para
// decir «estoy aqui». Y en los anidados gana el mas interno, que es donde esta
// la mano.
comprobar(
  "un clic dentro tambien lo activa",
  /onClickCapture=\{\(evento\) => \{[\s\S]{0,260}?anunciarCajonActivo\(storageKey\);/.test(
    barra
  ),
  "sin volver a la cabecera"
);
comprobar(
  "y en los anidados gana el de dentro",
  /if \(clic\.__cajonAtendido\) return;\s*\r?\n\s*clic\.__cajonAtendido = true;/.test(
    barra
  ),
  "el mas interno"
);
// El tinte mira `desplegado`, no `open`: un cajon que manda su contenido a una
// ventana esta abierto pero NO desplegado, y su barra tiene que seguir con cara
// de plegada. Ver `enVentana`.
comprobar(
  "y su barra va tintada",
  /titleClassName \?\? \(desplegado \? "bg-emerald-50" : "bg-tarjeta"\)/.test(
    barra
  ),
  "el borde no va solo"
);
// `titleClassName` sigue mandando cuando lo hay: es lo que pinta de gris los
// cajones apagados, y eso no puede taparlo un tinte.
comprobar(
  "sin tapar el gris de los apagados",
  barra.indexOf("titleClassName ??") > 0,
  "manda el suyo"
);

// -- 5. «INICIO INMEDIATO» SE FUE DE LOS DOS SITIOS --------------------------
comprobar(
  "no queda el boton en la pantalla",
  !/Inicio inmediato/.test(editor),
  "se fue"
);
// Y del motor: si se quitara solo de la pantalla, el campo escrito seguiria
// mandando y unas intros arrancarian distinto que otras sin nada que lo diga.
comprobar(
  "y el motor ya no lo lee",
  !/skipAskNameForChosenIntro/.test(motor),
  "un solo mando"
);
// Y DESPUES SE FUE TAMBIEN EL MANDO GLOBAL.
//
// Ya no hay ninguno: la intro sale sola. La pausa existia porque el saludo era
// un paso aparte hecho para capturar el nombre, y hoy el nombre lo pide
// cualquier burbuja con su casilla.
comprobar(
  "ya no queda ningun mando de pausa",
  !/skip_ask_name === true/.test(motor),
  "el cliente escribe y el bot contesta"
);
// Y TAMPOCO SALE NADA POR DELANTE DE LA INTRO.
//
// Aqui se exigia que el mensaje suelto del arranque saliera primero. Ya no
// existe: su casilla admitia UNA burbuja y se comia las demas del cajon. Ver
// `prueba-sin-mensaje-suelto-antes-de-la-intro`.
comprobar(
  "la intro sale sola",
  /await scheduleIntroSequence\(convo\.id\);\s*\r?\n\s*return true;\s*\r?\n\s*\}/.test(
    motor
  ) && /intro \$\{chosenIntro\.variant\} de corrido/.test(motor),
  "nada por delante"
);
// Sin estado de espera no hace falta el temporizador que rescataba la intro.
comprobar(
  "y sin temporizador de rescate al arrancar",
  !/scheduleAction\(convo\.id, ACTION_FALLBACK_INTRO, \{\}, runAt\)/.test(motor),
  "no hay nada parado que rescatar"
);
// El campo del archivo NO se borra: se deja de leer. Quien lo tenga escrito no
// pierde nada, y volver atras es leerlo otra vez.
comprobar(
  "el campo del archivo no se borra",
  /intro_skip_ask_name/.test(editor),
  "solo se deja de leer"
);

console.log(fallos === 0 ? "\nTODO OK" : `\n${fallos} FALLO(S)`);
process.exit(fallos === 0 ? 0 : 1);
