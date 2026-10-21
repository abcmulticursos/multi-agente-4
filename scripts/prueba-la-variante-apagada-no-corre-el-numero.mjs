// UNA VARIANTE APAGADA NO PUEDE CORRER EL NÚMERO DE LAS DEMÁS.
//
// LO QUE CONTÓ EL DUEÑO — 21 de septiembre de 2026, después de que le entregara
// DOS arreglos que no eran éste:
//
//   «En el pop up del seguimiento 2, modo recorrido, le doy click derecho, hago
//    un cambio y le doy guardar: EL CAMBIO NO SE REALIZA. Cierro el pop up y el
//    contenido sigue igual sin actualizarse.»
//
// QUÉ PASABA, medido con su contenido de verdad. Su seguimiento 2 tiene DOS
// variantes y la PRIMERA ESTÁ APAGADA. El recorrido las FILTRABA primero y las
// numeraba después, así que a la variante que él ve —la segunda de la lista— le
// ponía el número 0. Y el guardado escribe por ese número en la lista COMPLETA:
// su texto acababa dentro de la variante apagada.
//
// Se guardaba de verdad. En el sitio equivocado, y en uno que no se ve. Por eso
// «no pasaba nada» por más que guardara.
//
// Y NO ERA SOLO EL GUARDADO: el `id` y las `openKeys` de esa entrada llevaban el
// mismo número corrido, así que «ir a editarlo» abría otra variante.
//
// EL ARREGLO YA EXISTÍA DOS LÍNEAS MÁS ARRIBA. Las intros numeran ANTES de
// filtrar, con un comentario que describe este mismo fallo: «al ocultar una
// intro apagada, su posición visual deja de coincidir con la posición real que
// se debe editar». Llegó a las intros y no a las variantes de los seguimientos.
//
// POR ESO ESTA PRUEBA EJECUTA LAS DOS: si mañana alguien arregla una y se olvida
// de la otra, se pone roja.
//
//   node scripts/prueba-la-variante-apagada-no-corre-el-numero.mjs
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

// ── 1. LA NUMERACIÓN DE LAS VARIANTES, EJECUTADA ───────────────────────────
console.log("— cómo se numeran las variantes —\n");

// LA CADENA SE SACA ENTERA, con comentarios y todo, y se le quitan despues.
//
// EL 07/10/2026 esta cadena crecio: las variantes pasaron a filtrarse ANTES por tienda,
// semimodalidad y bandera —ahi viven sus etiquetas, no en el seguimiento— y ahora traen su
// indice puesto de antes. La extraccion se hacia pidiendo la forma EXACTA de una linea, asi
// que dejo de encontrarla y la prueba se evaluaba a si misma contra un respaldo. Ahora se
// captura hasta el `.filter`, que es lo que de verdad importa: QUE EL MAPEO VAYA PRIMERO.
//
// Los comentarios se quitan antes de ejecutar porque la cadena se aplana a una linea, y un
// `//` aplanado se comeria el resto del codigo.
const cadenaCruda = (editor.match(
  /\.\.\.\(followup\.variants \?\? \[\]\)\r?\n([\s\S]*?\.filter\(\(\{ variant \}\) => variant\.enabled !== false\))/
) ?? [])[1];
const cadena = cadenaCruda
  ?.split(/\r?\n/)
  .filter((l) => !/^\s*\/\//.test(l))
  .join("\n");
comprobar(
  "se numera ANTES de filtrar",
  !!cadena && cadena.indexOf(".map(") < cadena.indexOf(".filter("),
  cadena ? "el mapeo va delante" : "sigue filtrando primero"
);

// Y SE LE QUITAN LAS ANOTACIONES DE TIPO. La cadena es TypeScript y aqui se ejecuta como
// JavaScript puro: un `as { … }` la rompe con «Unexpected identifier 'as'». Quitarlas no
// cambia lo que hace el codigo —son solo para el compilador— y permite probar LA CADENA DE
// VERDAD en vez de una copia escrita a mano, que es lo que da valor a esta prueba.
const sinTipos = (s) => s.replace(/ as \{[^}]*\}/g, "").replace(/ as [A-Za-z<>[\]|]+/g, "");
const numerar = new Function(
  "variants",
  sinTipos(
    `return (variants ?? [])${cadena ?? ".filter((v) => v.enabled !== false).map((variant, variantIndex) => ({ variant, variantIndex }))"}`
  ).replace(/\s+/g, " ") + ";"
);

// SU CASO: la primera apagada, la segunda encendida.
const suyas = [
  { name: "Mensajes principales", enabled: false, steps: [{ texts: ["apagada"] }] },
  { name: "Mensajes principales copia", steps: [{ texts: ["la que él ve"] }] },
];
const vistas = numerar(suyas);
comprobar(
  "  solo se enseña la encendida",
  vistas.length === 1 && vistas[0].variant.name === "Mensajes principales copia",
  `${vistas.length} visible(s)`
);
comprobar(
  "  y lleva su número REAL, el 1 ← EL FALLO",
  vistas[0]?.variantIndex === 1,
  `lleva el ${vistas[0]?.variantIndex}`
);

// Y los casos normales no se mueven.
comprobar(
  "con todas encendidas, los números son los de siempre",
  JSON.stringify(
    numerar([{ name: "a" }, { name: "b" }, { name: "c" }]).map((x) => x.variantIndex)
  ) === JSON.stringify([0, 1, 2])
);
comprobar(
  "con la del medio apagada, las otras conservan el suyo",
  JSON.stringify(
    numerar([{ name: "a" }, { name: "b", enabled: false }, { name: "c" }]).map(
      (x) => x.variantIndex
    )
  ) === JSON.stringify([0, 2]),
  "0 y 2, no 0 y 1"
);
comprobar(
  "sin variantes, nada",
  numerar(undefined).length === 0 && numerar([]).length === 0
);

// ── 2. Y EL TEXTO ACABA EN LA VARIANTE QUE SE VE ───────────────────────────
//
// Se saca el actualizador real y se corre con el número que produce la lista.
console.log("\n— y lo escrito acaba donde se está mirando —\n");

const actualizador = (editor.match(
  /onEdit=\{\(stepIndex\) => channelUsesOwnContent\n\s*\? openChannelStepEditor\(followup\.title, followup\.steps, stepIndex, \(steps\) => \{\n([\s\S]*?)\n\s*\}, \{/
) ?? [])[1];
comprobar("se encuentra el actualizador", !!actualizador);

if (actualizador && vistas.length === 1) {
  const MARCA = "LO QUE ESCRIBIO EL DUENO";
  const followups = [
    { name: "seguimiento_1", steps: [], variants: [{ name: "v", steps: [{ texts: ["s1"] }] }] },
    { name: "seguimiento_2", steps: [], variants: suyas.map((v) => ({ ...v })) },
  ];
  const entrada = {
    editorPrefix: `channel_whatsapp_followup_1_variant_${vistas[0].variantIndex}`,
  };
  let escrito = null;
  new Function("followup", "channelContent", "steps", "updateChannelContent", actualizador)(
    entrada,
    { followups },
    [{ texts: [MARCA] }],
    (c) => { escrito = c; }
  );
  const enLaQueVe = JSON.stringify(escrito?.followups?.[1]?.variants?.[1] ?? {}).includes(MARCA);
  const enLaApagada = JSON.stringify(escrito?.followups?.[1]?.variants?.[0] ?? {}).includes(MARCA);
  comprobar("  llega a la variante ENCENDIDA", enLaQueVe, "la que él está mirando");
  comprobar("  y NO a la apagada ← lo que pasaba antes", !enLaApagada, "ahí se perdía");
  comprobar(
    "  y no toca el seguimiento 1",
    !JSON.stringify(escrito?.followups?.[0] ?? {}).includes(MARCA)
  );
}

// ── 3. LO QUE YA ESTABA BIEN SIGUE BIEN ────────────────────────────────────
//
// Las intros llevan este mismo arreglo desde antes. Si alguien lo quita de ahí,
// vuelve el fallo por el otro lado.
console.log("\n— y las intros conservan el suyo —\n");

comprobar(
  "las intros siguen numerando antes de filtrar",
  /\.map\(\(group, sourceIndex\) => \(\{ \.\.\.group, sourceIndex \}\)\)\n\s*\.filter\(\(group\) => group\.sourceIndex === 0 \|\| group\.enabled !== false\);/.test(
    editor
  ),
  "es el mismo arreglo, en su hermano"
);
comprobar(
  "y el seguimiento sigue llevando su propio índice",
  /editorPrefix: channelUsesOwnContent\n\s*\? `channel_\$\{channel\}_followup_\$\{followupIndex\}_variant_\$\{variantIndex\}`/.test(
    editor
  )
);

console.log(`\n${fallos === 0 ? "TODO EN VERDE" : `${fallos} EN ROJO`}\n`);
process.exit(fallos === 0 ? 0 : 1);
