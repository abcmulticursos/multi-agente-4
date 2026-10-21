// EL «GUARDAR CAMBIOS» DEL RECORRIDO SE APAGA CUANDO NO HAY NADA QUE GUARDAR.
//
// LO QUE CONTÓ EL DUEÑO — 21 de septiembre de 2026, con sus palabras:
//
//   «El visor del recorrido tiene un botón de "guardar cambios", este botón
//    está activo así los cambios estén guardados.»
//
// QUÉ PASABA. El botón solo se apagaba MIENTRAS estaba guardando —`disabled={
// saving}`— y nunca por no tener nada que guardar. Recién guardado seguía
// encendido, invitando a pulsarlo otra vez.
//
// POR QUÉ NO SE ARREGLABA SOLO. El editor YA sabe si hay cambios: `isDirty`
// compara el borrador entero contra lo último guardado, y lo reparte por un
// contexto a todas las ventanas. Pero ÉSTA se dibuja FUERA de ese proveedor
// —cuelga del final de la página, no de `<main>`—, así que no puede leerlo. Por
// eso el dato se le pasa a mano.
//
//   node scripts/prueba-guardar-del-recorrido-se-apaga.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const editor = readFileSync(
  join(RAIZ, "src", "app", "editor", "page.tsx"),
  "utf8"
).replace(/\r\n/g, "\n");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// ── 1. LA CONDICIÓN DEL BOTÓN, EJECUTADA ───────────────────────────────────
//
// Comprobar que el texto está escrito no dice nada sobre cuándo se apaga. Se
// saca la condición real y se corre con los cuatro casos que se dan de verdad.
console.log("— cuándo se apaga el botón —\n");

const condicion = (editor.match(/disabled=\{(saving \|\| !hayCambios)\}/) ?? [])[1];
comprobar("se encuentra la condición del botón", !!condicion, condicion ?? "—");

const decide = new Function(
  "saving",
  "hayCambios",
  `return (${condicion ?? "false"}) ? "apagado" : "encendido";`
);

for (const [caso, saving, hayCambios, esperado] of [
  ["recién guardado, sin tocar nada ← SU CASO", false, false, "apagado"],
  ["tocó algo y no ha guardado", false, true, "encendido"],
  ["guardando ahora mismo", true, true, "apagado"],
  ["guardando y ya sin cambios", true, false, "apagado"],
]) {
  const salio = decide(saving, hayCambios);
  comprobar(`  ${caso}`, salio === esperado, salio);
}

// ── 2. Y SE VE POR QUÉ ESTÁ APAGADO ────────────────────────────────────────
//
// Un botón gris sin explicación parece roto. Dice «Guardado».
console.log("\n— y dice por qué —\n");

const etiqueta = (editor.match(
  /\{saving \? "Guardando\.\.\." : (hayCambios \? "Guardar cambios" : "Guardado")\}/
) ?? [])[1];
comprobar("la etiqueta cambia con el estado", !!etiqueta, etiqueta ?? "—");

const texto = new Function(
  "saving",
  "hayCambios",
  `return saving ? "Guardando..." : (${etiqueta ?? '""'});`
);
comprobar("  sin cambios dice «Guardado»", texto(false, false) === "Guardado");
comprobar("  con cambios dice «Guardar cambios»", texto(false, true) === "Guardar cambios");
comprobar("  guardando dice «Guardando...»", texto(true, true) === "Guardando...");

// ── 3. EL DATO LLEGA DE DONDE TIENE QUE LLEGAR ─────────────────────────────
console.log("\n— y el dato es el mismo que usan las demás ventanas —\n");

comprobar(
  "se le pasa `isDirty`, no un cálculo propio",
  /hayCambios=\{isDirty\}/.test(editor),
  "dos formas de saber lo mismo acaban discrepando"
);
comprobar(
  "y `isDirty` sigue siendo la comparación del borrador entero",
  /const isDirty = cfg !== null && huellaDelBorrador !== baseline;/.test(editor),
  "incluye los textos"
);
comprobar(
  "la ventana lo recibe como propiedad",
  /hayCambios: boolean;/.test(editor)
);

// ── 4. LO QUE NO SE PUEDE HABER ROTO ───────────────────────────────────────
console.log("\n— lo que ya estaba sigue en pie —\n");

comprobar(
  "el botón sigue llamando a guardar",
  /onClick=\{onSave\}/.test(editor)
);
comprobar(
  "y el recorrido sigue recibiendo la orden de guardar",
  /onSave=\{\(\) => void save\(\)\}/.test(editor)
);
comprobar(
  "deshacer y rehacer no se tocan",
  /onUndo=\{undo\}/.test(editor) && /onRedo=\{redo\}/.test(editor)
);

console.log(`\n${fallos === 0 ? "TODO EN VERDE" : `${fallos} EN ROJO`}\n`);
process.exit(fallos === 0 ? 0 : 1);
