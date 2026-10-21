// La pestaña CONTENIDO se edita en ventanas, no en cajones desplegables.
//
// COMO ESTABA
//
//   Seis cajones apilados, cada uno con un editor entero dentro: el nombre del
//   producto, su contenido, su galeria de muestras, las casillas de «Info de
//   contenido», las burbujas del cierre. Abrir dos dejaba la pagina kilometrica
//   y se perdia de vista en cual se estaba escribiendo.
//
// COMO QUEDA
//
//   La barra se queda EXACTAMENTE igual que un cajon plegado —mismo recuadro,
//   misma flecha, mismo borde de «estoy aqui», mismo clic derecho—. Lo unico
//   que cambia es a donde va el contenido: a una ventana.
//
// SE HACE EN EL CAJON, CON UN INTERRUPTOR
//
//   La otra salida era escribir barras a mano, como se hizo en Canales. Dos
//   barras escritas por separado acaban pareciendose cada vez menos, y el dia
//   que una cambie la otra se queda vieja sin que nadie lo note.
//
//   Y el contenido de la ventana es `children` TAL CUAL. Copiar el editor para
//   la ventana es lo que dejo corta la de «Editar esta burbuja»: le faltaban la
//   mitad de los campos y nada lo decia.
//
// LO QUE NO PUEDE PASAR
//
//   1. Que en alguna modalidad quede un cajon de Contenido sin ventana. La
//      pestaña es la misma para las seis, pero no todos los cajones salen en
//      todas: si uno se quedara desplegable, esa modalidad tendria la pestaña a
//      medias.
//
//   2. Que la ventana se recuerde. Un cajon se deja abierto a proposito; una
//      ventana tapa la pantalla, y recordarla significaria entrar a la pestaña
//      y encontrarse una ventana encima que nadie acaba de abrir.
//
//   3. Que el clic derecho de «campo enlazable» se quede detras del fondo
//      oscuro. Ese menu se dibuja fuera de las ventanas, y a la misma altura
//      ganaba la ventana: el clic derecho parecia no hacer nada.
//
//   node scripts/prueba-contenido-en-ventanas.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const editor = readFileSync(join(RAIZ, "src", "app", "editor", "page.tsx"), "utf8");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// -- 1. EL INTERRUPTOR VIVE EN EL CAJON --------------------------------------
const cajon = (() => {
  const i = editor.indexOf("function Collapsible(");
  const f = editor.indexOf("function ChapaDeComodin(", i);
  return i < 0 ? "" : editor.slice(i, f > i ? f : i + 12000);
})();
comprobar("se encuentra el cajon", cajon.length > 0, "Collapsible");
comprobar(
  "el cajon sabe abrirse en ventana",
  /enVentana = false,/.test(cajon) && /enVentana\?: boolean;/.test(cajon),
  "apagado por defecto"
);
// `children` TAL CUAL. Si aqui apareciera un editor escrito aparte, volveria el
// fallo de la ventana de la burbuja: dos editores del mismo sitio, y el que se
// queda corto lo hace en silencio.
comprobar(
  "la ventana enseña el MISMO contenido",
  /\{enVentana && open && \(\s*\r?\n\s*<VentanaDeProducto/.test(cajon) &&
    /<div className=\{bodyClassName \?\? ""\}>\{body\}<\/div>/.test(cajon),
  "children, no una copia"
);
// Escribe directo en la configuracion, letra a letra, igual que el cajon. Un
// «Cancelar» prometeria deshacer algo que ya esta hecho.
comprobar(
  "y no promete cancelar lo que ya esta escrito",
  !/onCancelar=/.test(
    cajon.slice(cajon.indexOf("<VentanaDeProducto"), cajon.indexOf("<MenuDeCajon"))
  ),
  "para eso esta Deshacer"
);

// -- 2. LA BARRA SE VE PLEGADA -----------------------------------------------
//
// Si mirara `open`, al abrir la ventana la barra de debajo se quedaba con cara
// de desplegada —flecha abajo, fondo verde, linea de separacion— y sin nada
// debajo: al cerrar la ventana se veia un cajon abierto y vacio.
comprobar(
  "la barra en ventana se ve plegada",
  /const desplegado = open && !enVentana;/.test(cajon),
  "flecha, fondo y linea"
);
comprobar(
  "y el cuerpo de dentro solo sale si NO va en ventana",
  /\{desplegado && \(\s*\r?\n\s*<div className=\{`px-4 pb-4 pt-3/.test(cajon),
  "uno u otro, nunca los dos"
);

// -- 3. UNA VENTANA NO SE RECUERDA -------------------------------------------
comprobar(
  "en ventana no se anota abierto ni cerrado",
  /const recuerda = !enVentana;/.test(cajon) &&
    /if \(!recuerda\) return;/.test(cajon),
  "no reaparece sola"
);
// Lo de siempre sigue igual: un cajon normal se recuerda como se dejo.
comprobar(
  "y el cajon de siempre sigue recordandose",
  /localStorage\.setItem\(storageKey, valor\)/.test(cajon) &&
    /apuntar\(next \? "1" : "0"\)/.test(cajon),
  "sin cambios"
);

// -- 4. NINGUNA MODALIDAD SE QUEDA A MEDIAS ----------------------------------
const pestana = (() => {
  const i = editor.indexOf('tab === "contenido"');
  const f = editor.indexOf('tab === "cerebro"', i);
  return i < 0 || f < 0 ? "" : editor.slice(i, f);
})();
comprobar("se encuentra la pestaña", pestana.length > 0, "Contenido");
const cajones = [...pestana.matchAll(/<Collapsible\b[\s\S]*?>/g)];
comprobar(
  "todos los cajones de Contenido van en ventana",
  cajones.length >= 6 && cajones.every((m) => /enVentana/.test(m[0])),
  `${cajones.filter((m) => /enVentana/.test(m[0])).length} de ${cajones.length}`
);
// Este vive en su propio componente, fuera del recorte de arriba, y es el
// septimo: sin el, «Campos dinamicos» seria el unico desplegable de la pestaña.
const campos = (() => {
  const i = editor.indexOf("function DynamicFieldsEditor(");
  const f = editor.indexOf("function VisorDeComodines(", i);
  return i < 0 || f < 0 ? "" : editor.slice(i, f);
})();
comprobar(
  "y «Campos dinamicos» tambien, aunque viva aparte",
  /<Collapsible title="Campos dinamicos de esta modalidad" enVentana>/.test(
    campos
  ),
  "el septimo"
);

// -- 5. EL CLIC DERECHO SIGUE ALCANZABLE -------------------------------------
//
// El menu de «campo enlazable» se dibuja arriba del todo, fuera de las
// ventanas, pero se abre con el clic derecho sobre el nombre o el contenido de
// un producto — y esos campos ahora viven DENTRO de una ventana.
comprobar(
  "el menú de campo enlazable va por encima",
  /ref=\{dynamicSourceMenuRef\} className="fixed z-\[70\]/.test(editor),
  "no detrás del fondo"
);

console.log(fallos === 0 ? "\nTODO OK" : `\n${fallos} FALLO(S)`);
process.exit(fallos === 0 ? 0 : 1);
