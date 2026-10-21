// El editor tiene sitio para escribir, y el visor sigue siendo un teléfono.
//
// DE DONDE SALE
//
//   «El cajón donde se debe escribir está muy estrecho, que al escribir una
//   letra ni aparece.» Y: «el ancho del editor es muy estrecho, amplíalo, pero
//   ojo: al ensanchar, los visores de WhatsApp NO deben ancharse.»
//
// QUE SE HIZO
//
//   1. La página pasa de 768 px a 1152 px: un 50% más. Sigue centrada y con
//      aire; no ocupa toda la pantalla.
//   2. El visor de WhatsApp lleva su propio tope de ancho de teléfono, así que
//      no crece con la página. Estirado dejaría de parecerse a lo que ve el
//      cliente, que es para lo único que sirve.
//   3. El nombre del botón ocupa su propia línea. Iba en una fila de tres
//      —nombre, acción, papelera— y la acción se lleva 220 px fijos; dentro de
//      la columna de la izquierda al nombre le quedaban unos 100 px.
//
//   node scripts/prueba-el-editor-tiene-sitio-para-escribir.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const editor = readFileSync(
  join(RAIZ, "src", "app", "editor", "page.tsx"),
  "utf8"
);

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 60)} ${valor}`);
};

// ── 1. La página, un 20% más ancha ───────────────────────────────────────────
//
// Se probó primero con un 50% (1152 px) y era demasiado: tan ancha que la vista
// se dispersaba. Un 20% es lo justo — el cajón de texto deja de ahogarse y la
// página sigue leyéndose de un vistazo.
comprobar(
  "la página es un 20% más ancha",
  /mx-auto max-w-\[922px\] px-4 pb-56 pt-6/.test(editor),
  "768 → 922 px"
);
comprobar(
  "y no queda ni un resto de los anchos anteriores",
  !/mx-auto max-w-3xl px-4 py-6/.test(editor) &&
    !/mx-auto max-w-\[1152px\] px-4 py-6/.test(editor),
  "ni 768 ni 1152"
);

// ── 2. El visor NO se ancha con ella ─────────────────────────────────────────
//
// Era la condición que puso: lo demás sí, el visor no.
const visor = (() => {
  const i = editor.indexOf("function ChatPreview(");
  return i < 0 ? "" : editor.slice(i, i + 34000);
})();
comprobar(
  "el visor se queda del ancho de un teléfono",
  /sinTopeDeAncho \? "" : "w-full max-w-\[420px\]"/.test(visor),
  "420 px"
);
comprobar(
  "y el tope está puesto por defecto",
  /sinTopeDeAncho = false,/.test(visor),
  "hay que pedir lo contrario"
);
// La ventana de recorrido tiene su propio selector móvil/normal/ancho A LA
// VISTA. Un tope ahí contradiría un botón que el operador está pulsando.
comprobar(
  "salvo donde él elige el ancho con un botón",
  /\/\/ La ventana de recorrido ya tiene su selector móvil\/normal\/ancho a\s*\r?\n\s*\/\/ la vista: aquí manda ese botón, no el tope\.\s*\r?\n\s*sinTopeDeAncho/.test(
    editor
  ),
  "solo el recorrido"
);

// ── 3. El nombre del botón, en su propia línea ───────────────────────────────
const botones = (() => {
  const i = editor.indexOf("function BubbleButtonsEditor(");
  return i < 0 ? "" : editor.slice(i, i + 6000);
})();
comprobar(
  "el nombre del botón ocupa el ancho entero",
  /Texto del botón \(lo que ve el cliente\)/.test(botones) &&
    /className="mt-1 block w-full min-w-0 rounded border/.test(botones),
  "su propia línea"
);
comprobar(
  "y la acción va debajo, no compitiendo por el ancho",
  /grid gap-2 grid-cols-\[minmax\(0,1fr\)_auto\]/.test(botones) &&
    !/md:grid-cols-\[minmax\(0,1fr\)_220px_auto\]/.test(botones),
  "sin los 220 px fijos al lado"
);

console.log(
  fallos === 0
    ? "\nTODO OK — hay sitio para escribir y el visor sigue siendo un teléfono"
    : `\n${fallos} comprobacion(es) mal.`
);
process.exit(fallos === 0 ? 0 : 1);
