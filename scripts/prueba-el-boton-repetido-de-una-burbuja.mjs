// EL BOTÓN REPETIDO DENTRO DE UNA FICHA (el del DNI, 18/10/2026).
//
// LO QUE PASABA: al duplicar una burbuja, sus botones se copiaban con el MISMO código. En el
// seguimiento, el bot ejecutaba el botón de la PRIMERA burbuja que lo tuviera, aunque estuviera
// apagada y tuviera otra acción.
//
// QUÉ PROTEGE:
//   Motor (`elBotonDeSuSeguimiento`):
//     1. código repetido: gana el de la burbuja ENCENDIDA;
//     2. código que no se repite: el mismo botón que antes (nada cambia);
//     3. ninguna encendida lo tiene: lo de siempre (el primero).
//   Editor (`sinBotonesRepetidos`):
//     4. duplicar o pegar en la misma ficha: códigos nuevos, y el original no cambia;
//     5. cortar y pegar (mover): conserva sus códigos, para quien ya la recibió.
//
//   node scripts/prueba-el-boton-repetido-de-una-burbuja.mjs
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const RAIZ = process.cwd();
const motor = readFileSync(join(RAIZ, "src", "lib", "workflow", "engine.ts"), "utf8");
const editor = readFileSync(join(RAIZ, "src", "app", "editor", "page.tsx"), "utf8");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 66)} ${valor}`);
};
/** El cuerpo de una función de nivel superior, tal cual está en el archivo. */
const funcion = (fuente, firma) => {
  const i = fuente.indexOf(firma);
  if (i < 0) throw new Error(`No encontré ${firma}`);
  const resto = fuente.slice(i);
  return resto.slice(0, resto.search(/\r?\n\}\r?\n/)) + "\n}";
};

const dir = mkdtempSync(join(tmpdir(), "boton-repetido-"));
// El bloque nuevo del motor, sacado del archivo y envuelto para llamarlo con una variante.
const inicio = motor.indexOf("  const pasos: unknown[] = Array.isArray(suya.steps)");
const fin = motor.indexOf("  return findBubbleButton(suya.steps, id);", inicio);
if (inicio < 0 || fin < 0) throw new Error("No encontré el bloque nuevo de elBotonDeSuSeguimiento");
const bloque = motor.slice(inicio, fin) + "  return findBubbleButton(suya.steps, id);\n";
writeFileSync(
  join(dir, "motor.ts"),
  `type BubbleButton = any;\n${funcion(motor, "function findBubbleButton(")}\nexport function deSuFicha(suya: any, id: string) {\n${bloque}}\n`,
  "utf8"
);
writeFileSync(
  join(dir, "editor.ts"),
  `type EditorStep = any;\n${funcion(editor, "function sinBotonesRepetidos(")}\n${funcion(editor, "function conBotonesNuevos<T>(")}\nexport { sinBotonesRepetidos };\n`,
  "utf8"
);
const { deSuFicha } = await import(pathToFileURL(join(dir, "motor.ts")).href);
const { sinBotonesRepetidos } = await import(pathToFileURL(join(dir, "editor.ts")).href);

console.log("\n— motor —\n");
const boton = (id, action) => ({ id, label: "YAPE", action });
const repetida = {
  steps: [
    { type: "text", texts: ["hola"] },
    { type: "text", enabled: false, buttons: [boton("dni", "send_payment_method")] },
    { type: "text", buttons: [boton("dni", "choose_combo")] },
  ],
};
comprobar("1. repetido: gana el de la burbuja encendida", deSuFicha(repetida, "dni")?.action === "choose_combo", deSuFicha(repetida, "dni")?.action);
const unica = { steps: [{ type: "text", buttons: [boton("solo", "send_steps")] }] };
comprobar("2. sin repetir: el mismo botón de siempre", deSuFicha(unica, "solo")?.action === "send_steps");
const apagadas = {
  steps: [
    { type: "text", enabled: false, buttons: [boton("x", "send_payment_method")] },
    { type: "text", enabled: false, buttons: [boton("x", "choose_combo")] },
  ],
};
comprobar("3. ninguna encendida: el primero, como siempre", deSuFicha(apagadas, "x")?.action === "send_payment_method");
comprobar("   un código que no existe sigue sin encontrarse", deSuFicha(unica, "nada") === null);

console.log("\n— editor —\n");
const lista = [{ type: "text", texts: ["a"], buttons: [boton("b1", "send_steps")] }];
const original = JSON.stringify(lista[0]);
const duplicada = sinBotonesRepetidos(lista[0], lista);
comprobar("4. duplicar en la misma ficha: código nuevo", duplicada.buttons[0].id !== "b1" && duplicada.buttons[0].id.startsWith("b1~c"), duplicada.buttons[0].id);
comprobar("   el original no cambia", JSON.stringify(lista[0]) === original);
comprobar("   la copia es otra (no comparte botones)", duplicada.buttons !== lista[0].buttons);
const movida = sinBotonesRepetidos({ type: "text", texts: ["m"], buttons: [boton("b2", "send_steps")] }, lista);
comprobar("5. mover (no está en la ficha): conserva su código", movida.buttons[0].id === "b2");

console.log("\n— dónde se usa —\n");
comprobar("duplicar y pegar del editor pasan por sinBotonesRepetidos", (editor.match(/sinBotonesRepetidos\(/g) ?? []).length >= 6, (editor.match(/sinBotonesRepetidos\(/g) ?? []).length);
comprobar("el seguimiento busca en su ficha antes que en todo", /elBotonDeSuSeguimiento\(convo, id\) \?\? findBubbleButton\(loadWorkflowConfig\(\), id\)/.test(motor));

console.log(`\n${fallos === 0 ? "TODO OK — el botón que se toca es el de la burbuja que se envió" : `${fallos} FALLO(S)`}\n`);
process.exit(fallos === 0 ? 0 : 1);
