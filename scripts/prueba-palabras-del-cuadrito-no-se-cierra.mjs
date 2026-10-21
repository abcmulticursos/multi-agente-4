// Tocar el campo de palabras cerraba la decision entera.
//
// En el cuadrito de decision, el campo "Palabras que activan esta respuesta"
// abre una ventana grande para escribirlas comodas. Al tocar el TITULO, la
// ventana se abria bien. Al tocar el CAMPO, se abria medio segundo y se cerraba
// sola, como si hubieran dado a Cancelar: se perdia la decision entera.
//
// POR QUE PASABA
//
// El campo vive dentro del cuadro blanco, que frena los clics. La ventana
// grande de palabras es HERMANA de ese cuadro y cuelga del fondo oscuro, que
// descarta la decision al recibir un clic.
//
// Al tocar el campo:
//   1. se aprieta el boton sobre el campo
//   2. el campo abre la ventana, que tapa la pantalla entera
//   3. el dedo se levanta YA sobre la ventana nueva, no sobre el campo
//   4. el navegador, al ver que se apreto en un sitio y se solto en otro,
//      dispara el clic en el ancestro comun de ambos: el fondo oscuro
//   5. el fondo descarta
//
// Tocar el titulo nunca fallo porque el titulo si esta dentro del cuadro
// blanco: ese clic no llega nunca al fondo.
//
// EL ARREGLO
//
// Con la ventana de palabras abierta, el fondo de atras no cierra nada. No hace
// falta que lo haga: la ventana de palabras tapa la pantalla entera y tiene su
// propio cierre (su fondo, su boton Listo y Escape).
//
//   node scripts/prueba-palabras-del-cuadrito-no-se-cierra.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const editor = readFileSync(join(RAIZ, "src", "app", "editor", "page.tsx"), "utf8");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 60)} ${valor}`);
};

// La ventana de la decision. Se ubica por su titulo, que es unico: hay varias
// ventanas con el mismo fondo oscuro y buscar por la clase daba con otra.
const titulo = editor.indexOf("Editar esta decisi");
const zona = editor.slice(Math.max(0, titulo - 5000), titulo);

comprobar(
  "existe la ventana de la decision",
  titulo > 0,
  titulo > 0 ? "encontrada" : "NO ENCONTRADA"
);
comprobar(
  // ESTE es el arreglo.
  "con las palabras abiertas, el fondo ya no descarta",
  /if \(palabrasAbiertas\) return;\s*\r?\n\s*onCerrar\(\);/.test(zona),
  "guarda puesta"
);
comprobar(
  "el fondo ya no llama a onCerrar a secas",
  !/bg-black\/40 p-4"\s*\r?\n\s*onClick=\{onCerrar\}/.test(zona),
  "sin cierre directo"
);

// Lo que NO se toca: las tres formas de cerrar siguen ahi.
comprobar(
  "el campo sigue abriendo la ventana al tocarlo",
  /onFocus=\{\(\) => setPalabrasAbiertas\(true\)\}/.test(editor) &&
    /onClick=\{\(\) => setPalabrasAbiertas\(true\)\}/.test(editor),
  "clic y foco"
);
comprobar(
  "la ventana de palabras conserva su propio cierre",
  /setPalabrasAbiertas\(false\)/.test(editor),
  "fondo, boton Listo y Escape"
);
comprobar(
  // Sin la ventana de palabras abierta, el fondo debe seguir descartando: es
  // como se cierra la decision de siempre.
  "sin la ventana abierta, el fondo sigue descartando",
  /if \(palabrasAbiertas\) return;/.test(zona) && /onCerrar\(\);/.test(zona),
  "comportamiento de siempre"
);
comprobar(
  "el cuadro blanco sigue frenando sus clics",
  /onClick=\{\(evento\) => evento\.stopPropagation\(\)\}/.test(zona),
  "stopPropagation"
);

console.log(
  fallos === 0
    ? "\nTODO OK — tocar el campo de palabras ya no cierra la decision"
    : `\n${fallos} FALLA(S)`
);
process.exit(fallos === 0 ? 0 : 1);
