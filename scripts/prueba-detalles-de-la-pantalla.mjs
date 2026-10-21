// Cuatro cosas pequeÃ±as que costaban mas de lo que parecen.
//
//   node scripts/prueba-detalles-de-la-pantalla.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");
const editor = leer("src", "app", "editor", "page.tsx");
const selector = leer("src", "components", "EmojiPicker.tsx");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// -- 1. EL SELECTOR DE EMOJIS NO SE CORTA ------------------------------------
//
// LO QUE PASABA. El panel colgaba del boton con posicion relativa. Dentro del
// editor de una burbuja, la columna de la izquierda se desplaza a lo ancho, y
// CUALQUIER antepasado que recorte deja el panel cortado por su borde: se veia
// media rejilla de emojis y la otra mitad desaparecia.
//
// No se arregla ensanchando ni subiendo el z-index. El recorte lo hace el
// contenedor, y un hijo no puede salirse de su padre.
comprobar(
  "el panel se dibuja fuera de todo contenedor",
  /createPortal\(/.test(selector) && /document\.body\s*\r?\n?\s*\)\}/.test(selector),
  "pegado al body"
);
comprobar(
  "y en coordenadas de pantalla",
  /className="fixed z-\[200\] w-80/.test(selector) &&
    /style=\{\{ left: sitio\.left, top: sitio\.top \}\}/.test(selector),
  "sin padre que lo recorte"
);
// SE MIDE, NO SE ADIVINA: si no cabe debajo, va encima. Antes lo decidia a mano
// quien lo colocaba, y en una ventana alta se equivocaba.
comprobar(
  "se pone encima si no cabe debajo",
  /const cabeDebajo = caja\.bottom \+ ALTO \+ 8 <= window\.innerHeight;/.test(
    selector
  ),
  "medido de verdad"
);
// Y NO SE SALE POR LA DERECHA. En un campo pegado al borde, el panel quedaba
// medio fuera de la pantalla.
comprobar(
  "ni se sale por el borde derecho",
  /Math\.min\(caja\.left, window\.innerWidth - ANCHO - 8\)/.test(selector),
  "se pega al borde"
);
// AL DESPLAZAR, EL BOTON SE MUEVE Y EL PANEL NO. Sin volver a medir, el panel se
// queda flotando en el sitio de antes, lejos de su boton.
comprobar(
  "y se vuelve a medir al desplazar",
  /window\.addEventListener\("scroll", medir, true\);/.test(selector),
  "sigue a su botón"
);
// EL CLIC FUERA TIENE QUE PREGUNTARLE TAMBIEN AL PANEL. Como ya no cuelga del
// boton, elegir un emoji contaba como «clic fuera» y se cerraba antes de
// insertarlo.
comprobar(
  "elegir un emoji no cuenta como clic fuera",
  /if \(panelRef\.current\?\.contains\(destino\)\) return;/.test(selector),
  "se inserta"
);

// -- 2. EL TRIANGULITO DE LA BARRA -------------------------------------------
//
// Se quito al poner la chapa de «Abrir / Cerrar», pensando que decian lo mismo.
// No lo dicen: la chapa dice que PASA al tocar y el triangulito dice COMO ESTA.
// En una lista de catorce cajones, ver de un vistazo cuales estan abiertos es lo
// que dice donde te quedaste.
const cajon = (() => {
  const i = editor.indexOf("function Collapsible(");
  const f = editor.indexOf("function PlaceholderHelp(", i);
  return i < 0 || f < 0 ? "" : editor.slice(i, f);
})();
comprobar(
  "la barra lleva su triangulito",
  /\{desplegado \? "▼" : "▶"\}/.test(cajon),
  "a la derecha cerrado, abajo abierto"
);
// Y LA CHAPA SE QUEDA: dicen cosas distintas y las dos hacen falta.
comprobar(
  "y la chapa de Abrir / Cerrar también",
  /\{desplegado \|\| \(enVentana && open\) \? "Cerrar" : "Abrir"\}/.test(cajon),
  "estado y acción"
);
// EL TRIANGULITO VA ANTES DEL CUADRADO DE COLOR. Detras quedaria en medio del
// titulo, y lo que ordena la columna es que todas empiecen igual.
comprobar(
  "va delante del cuadrado de color",
  cajon.indexOf('{desplegado ? "▼" : "▶"}') < cajon.indexOf("<FichaDeIcono"),
  "la columna se lee derecha"
);

// -- 3. EL RELOJ EN EL DELAY DE LOS SEGUIMIENTOS -----------------------------
//
// Es el campo que decide a las cuantas horas sale el seguimiento, y estaba
// escrito igual que cualquier otra etiqueta.
comprobar(
  "el delay de los seguimientos lleva reloj",
  (editor.match(/🕒 Delay \(min\)/g) ?? []).length >= 2,
  "en la base y en el canal"
);

console.log(
  fallos === 0 ? "\nTODO OK" : `\n${fallos} FALLO(S)`
);
process.exit(fallos === 0 ? 0 : 1);
