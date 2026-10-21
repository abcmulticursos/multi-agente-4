// La cabecera de un cajon: que abre, que apaga, y que NO hace al tocarla.
//
// LO QUE PASABA
//
//   1. La barra ENTERA abria y cerraba. Asi que seleccionar el texto de un campo
//      de la cabecera, o soltar el raton un pelo fuera de un boton, plegaba lo
//      que estabas mirando. En las fichas de producto nunca estorbo, y ahi se
//      abre con un boton: se iguala.
//
//   2. Para saber si una intro estaba encendida habia que ABRIRLA. En una lista
//      de catorce, eso es abrirlas todas.
//
//   3. Escape en pantalla completa: el primero salia de pantalla completa y
//      hacia falta otro para cerrar la ventana. Dos pulsaciones para una
//      intencion, y la primera deshacia algo que nadie pidio deshacer.
//
//   4. «Cancelar» seguia diciendo «Cancelar» sin nada que cancelar. Lo unico que
//      hacia era cerrar, y una etiqueta que miente hace dudar antes de pulsarla.
//
//   node scripts/prueba-la-cabecera-de-un-cajon.mjs
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

// -- 1. SOLO EL TRIANGULITO Y LA CHAPA ABREN ---------------------------------
// El corte va desde el comentario que explica el cambio hasta el cuerpo del
// cajon. Se busca por el comentario y no por la etiqueta `<div`, que se escribe
// de mil formas y con CRLF de por medio.
const cabecera = (() => {
  const i = editor.indexOf("LA BARRA ENTERA YA NO ABRE EL CAJÓN");
  const f = editor.indexOf("EL CUERPO", i);
  return i < 0 ? "" : editor.slice(i, f > 0 ? f : i + 6000);
})();
comprobar("se encuentra la cabecera", cabecera.length > 0, "Collapsible");
comprobar(
  "la barra entera ya no abre el cajón",
  !/role="button"[\s\S]{0,80}onClick=\{toggle\}/.test(cabecera),
  "no se pliega sin querer"
);
comprobar(
  "el triangulito abre y cierra",
  /<button[\s\S]{0,200}onClick=\{toggle\}[\s\S]{0,400}\{desplegado \? "▼" : "▶"\}/.test(
    cabecera
  ),
  "y dice cómo está"
);
comprobar(
  "y la chapa de «Abrir» también",
  /<button[\s\S]{0,200}onClick=\{toggle\}[\s\S]{0,300}\? "Cerrar" : "Abrir"/.test(
    cabecera
  ),
  "dice qué pasa al tocar"
);
// EL CLIC DERECHO SE QUEDA EN TODA LA BARRA: es el menu de copiar y pegar el
// cajon, y apuntar a un boton de 20 px para abrirlo seria peor que antes.
comprobar(
  "el menú del clic derecho sigue en toda la barra",
  /onContextMenu=\{hayMenu \? menuDelCajon\.abrir : undefined\}/.test(cabecera),
  "copiar y pegar intactos"
);

// -- 2. EL CIRCULO DE ENCENDIDO ----------------------------------------------
//
// Claro encendido, oscuro apagado, y sin marca dentro: ni un check ni un punto.
// La fila ya lleva dibujo, titulo y chapa; una marca mas es ruido, y el color
// solo ya lo dice.
comprobar(
  "hay un círculo de encendido para la cabecera",
  /function CirculoDeEncendido\(/.test(editor),
  "sin abrir el cajón"
);
comprobar(
  "claro encendido, oscuro apagado",
  /encendido\s*\r?\n?\s*\? "border-emerald-600 bg-emerald-300/.test(editor) &&
    /: "border-neutral-600 bg-neutral-600/.test(editor),
  "el color lo dice"
);
comprobar(
  "y sin marca dentro que ensucie",
  /className=\{`h-5 w-5 shrink-0 rounded-full border transition-colors \$\{/.test(
    editor
  ) && /\}`\}\s*\r?\n\s*\/>/.test(editor),
  "ni check ni punto"
);
comprobar(
  // LO QUE PROTEGE NO CAMBIA: que el circulo de encendido viva en la CABECERA, visible
  // con la pieza plegada. El 02/10/2026 dejo de ser lo primero que hay ahi —delante
  // entraron la pastilla de pais y su aviso, que el pidio— asi que se comprueba que
  // ESTE en la cabecera, no que sea el unico.
  "las intros lo llevan en su cabecera",
  /headerActions=\{[\s\S]{0,1800}?<CirculoDeEncendido/.test(editor),
  "plegadas o no"
);
// Y LOS SEGUIMIENTOS TAMBIEN: era una chapa de «ON / OFF» que se leia distinta a
// la de al lado. Dos formas de decir lo mismo en la misma pantalla.
comprobar(
  "y los seguimientos también",
  /<CirculoDeEncendido\s*\r?\n\s*encendido=\{!followupDisabled\}/.test(editor),
  "el mismo en los dos sitios"
);

// -- 3. ESCAPE ES DE LA VENTANA ----------------------------------------------
comprobar(
  "con una ventana abierta, Escape no sale de pantalla completa",
  /if \(document\.querySelector\('\[role="dialog"\]'\)\) return;/.test(editor),
  "una pulsación, una cosa"
);

// -- 4. LA LLAVE DE UN CAJON NO LLEVA SU NOMBRE ------------------------------
//
// React usa la llave para saber si un panel sigue siendo el mismo. Con el nombre
// dentro, escribir o borrar UNA letra la cambiaba: React daba el panel por otro,
// tiraba el que habia y construia uno nuevo. El campo se quedaba sin cursor en
// cada tecla, asi que borrar un titulo era hacer clic, borrar una letra, volver
// a hacer clic. Le pasaba a los seguimientos y a las variantes de Canales.
comprobar(
  "ninguna llave de cajón lleva el nombre dentro",
  !/key=\{`\$\{(followup|variant|group|sourceVariant)\.name\}/.test(editor),
  "el cursor no se pierde"
);
comprobar(
  "y la posición basta para distinguirlos",
  /key=\{`channel-\$\{channel\}-own-followup-\$\{index\}`\}/.test(editor) &&
    /key=\{`channel-\$\{channel\}-followup-\$\{index\}-variant-\$\{variantIndex\}`\}/.test(
      editor
    ),
  "y no cambia al escribir"
);

// -- 5. EL ROTULO DE RELLENO, EN GRIS ----------------------------------------
//
// Al borrar el nombre, el cajon se pone uno generico para no quedarse sin
// rotulo. En negro se leia igual que un nombre escrito a mano, asi que borrar el
// campo parecia no haber funcionado: abajo vacio y arriba el mismo texto.
// EN ROJO, Y PIDIENDO EL NOMBRE. Antes el cajon se renombraba solo al quedarse
// vacio, asi que el titulo no se podia borrar nunca y nada lo explicaba. Ahora
// se queda vacio de verdad y la barra pide el nombre: es algo que hay que hacer,
// no un dato que enseñar.
comprobar(
  "el título que pone el cajón se distingue del escrito",
  /tituloDeRelleno \? "text-red-600" : "text-tinta"/.test(editor) &&
    (editor.match(/"Ponle un título al cajón"/g) ?? []).length >= 4,
  "en rojo, y lo pide"
);
comprobar(
  "y los cajones dicen cuándo su título es de relleno",
  (editor.match(/tituloDeRelleno=\{!/g) ?? []).length >= 4,
  "intros, seguimientos y variantes"
);

console.log(
  fallos === 0
    ? "\nTODO OK — la cabecera abre donde se toca, y dice si está encendido"
    : `\n${fallos} FALLO(S)`
);
process.exit(fallos === 0 ? 0 : 1);
