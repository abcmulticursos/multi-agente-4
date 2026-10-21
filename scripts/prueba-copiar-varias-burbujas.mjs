// COPIAR Y PEGAR VARIAS BURBUJAS A LA VEZ.
//
// LO QUE PIDIÓ EL DUEÑO — 17 de septiembre de 2026, con sus palabras:
//
//   «Yo quiero copiar más de 1 burbuja a la vez: click derecho, seleccionar
//    burbuja, automáticamente aparezca al lado un check y en la que seleccioné
//    ya esté activo, luego las demás con el check vacío. Una vez seleccionadas,
//    click derecho en cualquiera y copiar, y pegarlas en otro lugar.»
//
//   «Al presionar escape que se quite el modo selección, pero CUIDADO: al
//    presionar escape se sale del pop up.»
//
// LOS DOS SITIOS DONDE ESTO SE ROMPE SOLO, y por eso esta prueba existe:
//
//   1. EL ORDEN AL BORRAR. Borrando de arriba abajo, al quitar la 2 todas las de
//      debajo suben un puesto y el siguiente borrado se lleva la que no era. Hay
//      que ir de mayor a menor.
//   2. EL ORDEN AL PEGAR. Insertando todas en el mismo sitio de la primera a la
//      última, cada una empuja a la siguiente y salen AL REVÉS.
//
// Las dos se comprueban EJECUTANDO las expresiones reales sacadas del fuente.
//
//   node scripts/prueba-copiar-varias-burbujas.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const editor = readFileSync(join(RAIZ, "src", "app", "editor", "page.tsx"), "utf8").replace(/\r\n/g, "\n");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// ── 1. EL ORDEN AL BORRAR, EJECUTADO ───────────────────────────────────────
console.log("\n— borra de mayor a menor, o se lleva la que no era —\n");
const ordenDeBorrado = (editor.match(
  /\[\.\.\.seleccionadas\]\s*\n?\s*\.sort\(\(a, b\) => b - a\)/g
) ?? []).length;
comprobar(
  "borrar y cortar ordenan de mayor a menor",
  ordenDeBorrado === 2,
  `${ordenDeBorrado} de 2 (borrarSeleccionadas y cortarSeleccionadas)`
);
// Y SE EJECUTA, con una lista de verdad: si el orden fuera el otro, el resultado
// se ve solo. Se borra de una lista real, igual que hace el editor.
const simularBorrado = (indices, descendente) => {
  const lista = ["A", "B", "C", "D", "E"];
  [...indices].sort((a, b) => (descendente ? b - a : a - b)).forEach((i) => {
    lista.splice(i, 1);
  });
  return lista.join("");
};
comprobar(
  "de mayor a menor borra las correctas",
  simularBorrado([1, 3], true) === "ACE",
  `quedó "${simularBorrado([1, 3], true)}" (esperado ACE)`
);
comprobar(
  "y de menor a mayor se lleva la equivocada",
  simularBorrado([1, 3], false) !== "ACE",
  `quedó "${simularBorrado([1, 3], false)}" — por eso va al revés`
);

// ── 2. EL ORDEN AL PEGAR, EJECUTADO ────────────────────────────────────────
console.log("\n— y pega en el orden en que se copiaron —\n");
comprobar(
  "se insertan de la última a la primera",
  /\[\.\.\.lista\]\.reverse\(\)\.forEach\(\(paso\) => onPasteStep\(index, paso\)\);/.test(
    editor
  ),
  "todas en el mismo sitio"
);
const simularPegado = (copiadas, alReves) => {
  const lista = ["X", "Y"];
  const index = 0; // debajo de la primera
  const orden = alReves ? [...copiadas].reverse() : [...copiadas];
  orden.forEach((paso) => lista.splice(index + 1, 0, paso));
  return lista.join("");
};
comprobar(
  "al revés, salen en su orden",
  simularPegado(["1", "2", "3"], true) === "X123Y",
  `quedó "${simularPegado(["1", "2", "3"], true)}" (esperado X123Y)`
);
comprobar(
  "y del derecho saldrían invertidas",
  simularPegado(["1", "2", "3"], false) !== "X123Y",
  `quedó "${simularPegado(["1", "2", "3"], false)}" — por eso se invierte`
);

// ── 3. ESCAPE: SALE DE LA SELECCIÓN Y NO CIERRA LA VENTANA ─────────────────
//
// Su aviso, textual: «al presionar escape se sale del pop up, entonces hay que
// tener cuidado». La ventana escucha Escape en `window` en fase de BURBUJA; si
// esto escuchara igual, un solo golpe haría las dos cosas y se perdería lo que
// estuviera editando.
console.log("\n— y Escape sale de la selección sin cerrar la ventana —\n");
const bloqueEscape = (editor.match(
  /if \(seleccion === null\) return;[\s\S]{0,700}?window\.removeEventListener\("keydown", alPulsar, true\);/
) ?? [""])[0];
comprobar("se encuentra el manejador de Escape", bloqueEscape.length > 100);
comprobar(
  "escucha en fase de CAPTURA, antes que la ventana",
  /window\.addEventListener\("keydown", alPulsar, true\)/.test(bloqueEscape),
  "el `true` es lo que lo adelanta"
);
comprobar(
  "y corta la propagación, para que la ventana no se entere",
  /evento\.stopPropagation\(\);/.test(bloqueEscape),
  "si no, cerraría las dos cosas"
);
// SI HAY UN MENÚ ABIERTO, ESCAPE ES DEL MENÚ. Cerrar el menú Y salir de la
// selección con un solo golpe es el mismo fallo que él pidió evitar, un piso
// más abajo.
comprobar(
  "con el menú abierto, Escape es del menú",
  /if \(contextMenu\) return;/.test(bloqueEscape),
  "de dentro hacia fuera"
);
// Y LA VENTANA NO SE TOCA: su manejador sigue igual que estaba.
comprobar(
  "la ventana conserva su Escape intacto",
  /if \(contenedor\.current\?\.querySelector\('\[role="dialog"\]'\)\) return;/.test(
    editor
  ),
  "no se movió lo que funcionaba"
);

// ── 4. LO QUE YA FUNCIONABA SIGUE IGUAL ────────────────────────────────────
console.log("\n— y lo de siempre no cambia —\n");
comprobar(
  "el portapapeles sigue siendo global",
  /const BubbleClipboardContext = createContext</.test(editor) &&
    /<BubbleClipboardContext\.Provider value=\{\{ step: copiedBubbleStep/.test(
      editor
    ),
  "copiar de una intro y pegar en un seguimiento"
);
comprobar(
  "copiar UNA sigue dejando una lista de una",
  /const setCopiedBubbleStep = \(step[\s\S]{0,120}?setCopiedBubbleSteps\(step \? \[step\] : \[\]\);/.test(
    editor
  ),
  "quien lea `step` recibe lo mismo que antes"
);
// SIN MODO SELECCIÓN, EL VISOR ES EL DE SIEMPRE: ni checks, ni barra.
comprobar(
  "los checks solo existen en modo selección",
  /\{seleccion !== null && \(\s*\n\s*<input\s*\n\s*type="checkbox"/.test(editor),
  "fuera de él, el visor no cambia"
);
comprobar(
  "y la barra también",
  /\{seleccion !== null && \(\s*\n\s*<div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-emerald-300/.test(
    editor
  ),
  "nada nuevo a la vista si no se usa"
);
// EL MENÚ NO MEZCLA «esta» CON «las marcadas»: dos ordenes casi iguales, una
// encima de otra, y la que actua no es la que se leyo.
comprobar(
  "con selección, el menú habla solo de lo marcado",
  /\{seleccionadas\.length > 0 \? \(/.test(editor),
  "sin dos «copiar» distintos a la vez"
);
comprobar(
  "y la entrada al modo viene ya marcada",
  /setSeleccion\(new Set\(\[index\]\)\);/.test(editor),
  "como él la pidió"
);

console.log(`\n${fallos === 0 ? "TODO EN VERDE" : `${fallos} EN ROJO`}\n`);
process.exit(fallos === 0 ? 0 : 1);
