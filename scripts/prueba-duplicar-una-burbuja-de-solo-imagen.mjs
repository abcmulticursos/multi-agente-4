// DUPLICAR UNA BURBUJA QUE SOLO TIENE IMAGEN, Y PODER ESCRIBIRLE DESPUÉS.
//
// LO QUE CONTÓ EL DUEÑO — 21 de septiembre de 2026, con sus palabras:
//
//   «Cuando yo guardo un texto todo funciona perfecto, incluso cuando le doy
//    click derecho a las burbujas las puedo editar sin problemas. Pero cuando
//    DUPLICO una burbuja que tiene SOLO UNA IMAGEN y le doy click derecho
//    editar burbuja, y quiero pegar un texto, NO ME DEJA PEGAR. Y parece que
//    ese error borra el contenido que ya había editado. Lo hice 2 veces y 2
//    veces pasó eso.»
//
// QUÉ PASABA, medido ejecutando este mismo código del editor:
//
//   1. Una muestra de solo imagen no tiene pie de foto, así que `item.caption`
//      viene SIN PONER y la lista de textos salía como `[undefined]`.
//   2. Al duplicar, la copia pasa por JSON y ese hueco se vuelve `null` — que
//      sí se guarda. `aplicarPasos` lo escribe de vuelta en `caption_variants`,
//      así que desde ese momento el nulo es permanente.
//   3. La casilla de texto recibía `value={undefined}`. Una casilla cuyo valor
//      no está puesto DEJA DE ESTAR CONTROLADA: lo que se teclea o se pega se
//      queda en la pantalla y no vuelve al editor.
//
// POR QUÉ PARECÍA QUE BORRABA. No borraba. Lo tecleado nunca entraba, y al
// repintar volvía a enseñarse lo guardado —nada—. Por eso CON un pie ya escrito
// funcionaba bien: exactamente lo que él describió.
//
// ESTA PRUEBA NO MIRA SI EL ARREGLO ESTÁ ESCRITO: saca el código del archivo y
// lo EJECUTA con su caso. Comprobar que un `?? ""` está puesto no dice nada
// sobre lo que le llega a la casilla.
//
//   node scripts/prueba-duplicar-una-burbuja-de-solo-imagen.mjs
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

// ── EL CÓDIGO REAL, SACADO DEL ARCHIVO ─────────────────────────────────────
const lineaTexts = (editor.match(
  /const texts = \(\s*\n?\s*(item\.caption_variants\?\.length \? item\.caption_variants : \[item\.caption\])\s*\n?\s*\)((?:\s|\n)*\.map\([^;]*\));/
) ?? []);
const expresionTexts = lineaTexts[1]
  ? `(${lineaTexts[1]})${lineaTexts[2]}`
  : (editor.match(
      /const texts = (item\.caption_variants\?\.length \? item\.caption_variants : \[item\.caption\]);/
    ) ?? [])[1];

const lineaPrimera = (editor.match(
  /const primera: EditorStep = (\{ type: item\.media_type[^;]+\});/
) ?? [])[1];
const cuerpoAplicar = (editor.match(
  /const aplicarPasos = \(siguientes: EditorStep\[\]\) => \{([\s\S]*?)\n  \};/
) ?? [])[1];
const cuerpoDuplicar = (editor.match(
  /const duplicateStep = \(i: number\) => \{([\s\S]*?)\n  \};/
) ?? [])[1];

console.log("— se encuentra el código que decide —\n");
comprobar("la lista de textos de la muestra", !!expresionTexts);
comprobar("la burbuja que lleva el archivo", !!lineaPrimera);
comprobar("lo que se escribe de vuelta", !!cuerpoAplicar);
comprobar("la función de duplicar", !!cuerpoDuplicar);
if (fallos > 0) {
  console.log("\nsin el código no se puede ejecutar nada. PARO.\n");
  process.exit(1);
}

const sinTipos = (s) =>
  (s ?? "")
    .replace(/: EditorStep\[\]/g, "")
    .replace(/: EditorStep/g, "")
    .replace(/: number/g, "")
    .replace(/ as GalleryMediaType/g, "");

const calcularTexts = new Function("item", `return ${expresionTexts};`);
const calcularPrimera = new Function("item", "texts", `return ${lineaPrimera};`);

const aplicar = new Function(
  "siguientes",
  "onEdit",
  "onChange",
  "id",
  sinTipos(cuerpoAplicar)
);
const correrAplicar = (pasos) => {
  let parche = null;
  aplicar(pasos, () => {}, (p) => { parche = p; }, "x");
  return parche;
};

const duplicar = new Function(
  "i",
  "steps",
  "onSnapshot",
  "onChange",
  sinTipos(cuerpoDuplicar)
);
const correrDuplicar = (i, steps) => {
  let salida = null;
  duplicar(i, steps, () => {}, (c) => { salida = c; });
  return salida;
};

/** Recorre el camino entero: abrir → duplicar la burbuja i → volver a abrir. */
function duplicarYReabrir(item, i = 0) {
  const texts = calcularTexts(item);
  const primera = calcularPrimera(item, texts);
  const pasos = [primera, ...(item.pasos_extra ?? [])];
  const tras = correrDuplicar(i, pasos);
  const parche = correrAplicar(tras);
  const siguiente = { ...item, ...parche };
  return { siguiente, textsAhora: calcularTexts(siguiente) };
}

const ARCHIVO = "https://drive.google.com/file/d/ABC/view";

// ── 1. EL CASO DEL DUEÑO: SOLO IMAGEN, SIN PIE ─────────────────────────────
console.log("\n— su caso: una muestra que solo tiene imagen —\n");

const soloImagen = {
  media_type: "image",
  drive_url: ARCHIVO,
  caption: undefined,
  caption_variants: undefined,
  pasos_extra: [],
  enabled: true,
};

const alAbrir = calcularTexts(soloImagen);
comprobar(
  "al abrirla, la casilla ya recibe un texto",
  typeof alAbrir[0] === "string",
  JSON.stringify(alAbrir[0])
);

const r1 = duplicarYReabrir(soloImagen);
comprobar(
  "  y tras DUPLICAR sigue recibiendo un texto ← EL FALLO",
  typeof r1.textsAhora[0] === "string",
  `value = ${JSON.stringify(r1.textsAhora[0])}`
);
comprobar(
  "  (con un valor sin poner, la casilla se descontrola)",
  r1.textsAhora[0] !== undefined && r1.textsAhora[0] !== null,
  "y lo pegado no vuelve al editor"
);
comprobar(
  "  no se guarda ningún nulo en las variantes",
  (r1.siguiente.caption_variants ?? []).every((t) => typeof t === "string"),
  JSON.stringify(r1.siguiente.caption_variants)
);
comprobar(
  "  la imagen sigue en su sitio",
  r1.siguiente.drive_url === ARCHIVO,
  "duplicar no puede perder el archivo"
);
comprobar(
  "  y ahora hay dos burbujas",
  (r1.siguiente.pasos_extra ?? []).length === 1
);

// ── 2. LO QUE YA FUNCIONABA NO SE PUEDE ROMPER ─────────────────────────────
//
// Él lo dijo: «cuando yo guardo un texto todo funciona perfecto». Ese camino
// es el que NO se puede tocar.
console.log("\n— y el texto ya escrito se conserva intacto —\n");

const conPie = {
  media_type: "image",
  drive_url: ARCHIVO,
  caption: "Mi texto de antes",
  caption_variants: ["Mi texto de antes"],
  pasos_extra: [],
  enabled: true,
};
const r2 = duplicarYReabrir(conPie);
comprobar(
  "el pie escrito sobrevive a duplicar",
  r2.siguiente.caption === "Mi texto de antes",
  JSON.stringify(r2.siguiente.caption)
);
comprobar(
  "  y la casilla lo sigue enseñando",
  r2.textsAhora[0] === "Mi texto de antes"
);

const variasVariantes = {
  ...conPie,
  caption: "Uno",
  caption_variants: ["Uno", "Dos", "Tres"],
};
const r3 = duplicarYReabrir(variasVariantes);
comprobar(
  "las tres variantes siguen enteras",
  JSON.stringify(r3.siguiente.caption_variants) ===
    JSON.stringify(["Uno", "Dos", "Tres"]),
  JSON.stringify(r3.siguiente.caption_variants)
);

// ── 3. Y SI YA QUEDÓ UN NULO GUARDADO DE ANTES, SE LEE COMO VACÍO ──────────
console.log("\n— y si el fallo ya dejó un nulo guardado —\n");

const conNuloGuardado = {
  media_type: "image",
  drive_url: ARCHIVO,
  caption: "",
  caption_variants: [null],
  pasos_extra: [],
  enabled: true,
};
const textsNulo = calcularTexts(conNuloGuardado);
comprobar(
  "se lee como texto vacío, no como nada",
  textsNulo[0] === "",
  JSON.stringify(textsNulo[0])
);
const r4 = duplicarYReabrir(conNuloGuardado);
comprobar(
  "  y al duplicar ya no se propaga",
  (r4.siguiente.caption_variants ?? []).every((t) => typeof t === "string"),
  JSON.stringify(r4.siguiente.caption_variants)
);

// ── 4. LO QUE NO SE PUEDE HABER ROTO ───────────────────────────────────────
console.log("\n— lo que ya protegía sigue en pie —\n");

comprobar(
  "la primera burbuja sigue siendo la que lleva el archivo",
  /const primera: EditorStep = \{ type: item\.media_type, drive_url: item\.drive_url/.test(
    editor
  ),
  "es lo que identifica la muestra"
);
comprobar(
  "al escribir de vuelta, el archivo sale de la cabeza",
  /drive_url: cabeza\.drive_url/.test(cuerpoAplicar),
  "no de otra burbuja"
);
comprobar(
  "duplicar sigue copiando la lista de textos, no compartiéndola",
  /texts: \[\.\.\.step\.texts\]/.test(cuerpoDuplicar),
  "si no, escribir en una cambiaría la otra"
);

console.log(`\n${fallos === 0 ? "TODO EN VERDE" : `${fallos} EN ROJO`}\n`);
process.exit(fallos === 0 ? 0 : 1);
