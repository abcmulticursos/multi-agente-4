// ESCRIBIR EN LA VENTANA «EDITAR ESTA BURBUJA», AUNQUE NO TENGA NINGÚN TEXTO.
//
// LO QUE CONTÓ EL DUEÑO — 21 de septiembre de 2026, con sus palabras:
//
//   «Yo duplico una burbuja que contiene SOLO UNA IMAGEN, a la copia le doy
//    click derecho, editar burbuja, se abre el pop up y NO PUEDO EDITAR EL
//    TEXTO.»
//
// QUÉ PASABA. Una burbuja de imagen sin pie llega con la lista de textos VACÍA.
// La ventana recorría esa lista con `.map` para cambiar el texto de la posición
// que se estaba tecleando — y recorrer una lista vacía devuelve otra lista
// vacía. Cada tecla escribía `[]`: lo tecleado no entraba nunca y la casilla
// volvía a salir en blanco. Sin error, sin aviso.
//
// LA MISMA FUNCIÓN ESTABA ESCRITA DOS VECES. La de la LISTA (`updateText` de
// `StepList`) ya tenía el guardia, puesto por este mismo motivo; su comentario
// lo dice: «al teclear hay que crear el hueco en vez de recorrer una lista que
// no tiene nada». La de la VENTANA era una segunda copia a la que nunca llegó el
// arreglo — por eso desde la lista se podía escribir y desde la ventana no.
//
// POR ESO ESTA PRUEBA CORRE LAS DOS Y EXIGE QUE DEN LO MISMO. Si mañana alguien
// arregla una y se olvida de la otra, esto se pone rojo. Es el fallo de este
// proyecto que más veces ha vuelto: dos sitios que deciden lo mismo y se separan.
//
//   node scripts/prueba-escribir-en-la-ventana-de-la-burbuja.mjs
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
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 56)} ${valor}`);
};

// ── EL CÓDIGO REAL DE LOS DOS SITIOS ───────────────────────────────────────
const deLaLista = (editor.match(
  /const updateText = \(i: number, ti: number, v: string\) => \{[\s\S]*?texts: (s\.texts\.length[\s\S]*?\[v\])/
) ?? [])[1];

const deLaVentana = (editor.match(
  /onUpdateText=\{\(ti, value\) =>\s*\n\s*update\(\{\s*\n\s*texts: ([\s\S]*?),\s*\n\s*\}\)/
) ?? [])[1];

console.log("— se encuentra el código de los dos sitios —\n");
comprobar("el de la LISTA", !!deLaLista, (deLaLista ?? "").replace(/\s+/g, " ").slice(0, 46));
comprobar("el de la VENTANA", !!deLaVentana, (deLaVentana ?? "").replace(/\s+/g, " ").slice(0, 46));
if (!deLaLista || !deLaVentana) {
  console.log("\nsin el código no se puede ejecutar nada. PARO.\n");
  process.exit(1);
}

const correr = (expresion, texts, ti, value) => {
  const fn = new Function("s", "step", "ti", "v", "value", `return (${expresion});`);
  return fn({ texts }, { texts }, ti, value, value);
};

// ── EL CASO DEL DUEÑO: UNA IMAGEN SIN NINGÚN TEXTO ─────────────────────────
console.log("\n— su caso: una imagen sin ningún texto —\n");

const ESCRITO = "lo que el dueño teclea";
const vacia = correr(deLaVentana, [], 0, ESCRITO);
comprobar(
  "desde la VENTANA, lo escrito ENTRA ← EL FALLO",
  Array.isArray(vacia) && vacia[0] === ESCRITO,
  JSON.stringify(vacia)
);
comprobar(
  "  y no se queda en una lista vacía",
  Array.isArray(vacia) && vacia.length === 1,
  "antes cada tecla escribía []"
);

const vaciaLista = correr(deLaLista, [], 0, ESCRITO);
comprobar(
  "desde la LISTA sigue entrando, como siempre",
  Array.isArray(vaciaLista) && vaciaLista[0] === ESCRITO,
  JSON.stringify(vaciaLista)
);

// ── LOS DOS SITIOS TIENEN QUE DAR LO MISMO ─────────────────────────────────
console.log("\n— y los dos sitios no se pueden separar otra vez —\n");

for (const [etiqueta, texts, ti] of [
  ["sin ningún texto", [], 0],
  ["con un texto", ["hola"], 0],
  ["con dos variantes, tocando la 1ª", ["uno", "dos"], 0],
  ["con dos variantes, tocando la 2ª", ["uno", "dos"], 1],
  ["con tres variantes, la del medio", ["a", "b", "c"], 1],
]) {
  const l = correr(deLaLista, texts, ti, ESCRITO);
  const v = correr(deLaVentana, texts, ti, ESCRITO);
  comprobar(
    `  ${etiqueta}`,
    JSON.stringify(l) === JSON.stringify(v),
    JSON.stringify(v)
  );
}

// ── LO QUE NO SE PUEDE HABER ROTO ──────────────────────────────────────────
console.log("\n— lo que ya funcionaba sigue igual —\n");

const unTexto = correr(deLaVentana, ["antes"], 0, ESCRITO);
comprobar(
  "cambiar un texto existente lo reemplaza",
  JSON.stringify(unTexto) === JSON.stringify([ESCRITO]),
  JSON.stringify(unTexto)
);

const dosTextos = correr(deLaVentana, ["uno", "dos"], 1, ESCRITO);
comprobar(
  "y tocar una variante NO pisa a las otras",
  JSON.stringify(dosTextos) === JSON.stringify(["uno", ESCRITO]),
  JSON.stringify(dosTextos)
);

comprobar(
  "la ventana sigue editando un borrador, no la burbuja real",
  /const \[borrador, setBorrador\] = useState<EditorStep\[\]>\(steps\);/.test(editor),
  "Escape tiene que poder descartar"
);
comprobar(
  "y Escape sigue descartando sin guardar",
  /\/\/ Escape DESCARTA: no se llama a onChange\.\s*\n\s*onClose\(\);/.test(editor)
);

console.log(`\n${fallos === 0 ? "TODO EN VERDE" : `${fallos} EN ROJO`}\n`);
process.exit(fallos === 0 ? 0 : 1);
