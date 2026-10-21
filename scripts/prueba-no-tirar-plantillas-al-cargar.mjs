// Al cargar el editor se tiraban DOS modalidades.
//
// LO QUE PASABA
//
// Al abrir el editor se rellenan con una plantilla en blanco las modalidades
// que aun no tienen la suya. Pero se escribia un objeto NUEVO con solo cuatro
// claves —lineal, order_bump, bioferta, doble_oferta_dos—, asi que
// `doble_oferta_upsell` y `upsell` se perdian. En cada carga. Y al guardar
// despues, esa perdida se grababa en el archivo.
//
// De ahi salia todo lo demas:
//   - el contenido de Doble Oferta + Upsell "no aparecia" aunque estuviera
//     bien guardado en el archivo;
//   - su plantilla faltaba en los archivos exportados;
//   - y parecia que se borraba al cambiar de modalidad, cuando en realidad se
//     tiraba antes, nada mas abrir el editor.
//
// EL ARREGLO
//
// `...mt` primero: conserva TODAS las plantillas que haya. Las cuatro de la
// lista solo se usan si esa modalidad no tiene la suya todavia.
//
//   node scripts/prueba-no-tirar-plantillas-al-cargar.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const editor = readFileSync(
  join(process.cwd(), "src", "app", "editor", "page.tsx"),
  "utf8"
);

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 60)} ${valor}`);
};

const bloque =
  editor.match(/loaded\.modality_templates = \{[\s\S]*?\n        \};/)?.[0] ?? "";

comprobar("el bloque está donde se le busca", bloque.length > 0, "sí");
comprobar(
  // ESTE era el fallo: sin esto, lo que no esté en la lista se pierde.
  "conserva TODAS las plantillas que ya existen",
  /\{\s*\r?\n\s*\.\.\.mt,/.test(bloque),
  "...mt"
);
comprobar(
  "y el ...mt va PRIMERO, para que los respaldos no lo pisen",
  bloque.indexOf("...mt") < bloque.indexOf("lineal:"),
  "primero"
);
comprobar(
  "las cuatro por defecto siguen ahí, para las que falten",
  ["lineal:", "order_bump:", "bioferta:", "doble_oferta_dos:"].every((k) =>
    bloque.includes(k)
  ),
  "intactas"
);
comprobar(
  "y solo se usan si esa modalidad no tiene la suya",
  (bloque.match(/mt\.\w+ \?\?/g) ?? []).length === 4,
  "con ??"
);

// La prueba de verdad: simular el objeto que se arma.
const mt = {
  lineal: { product_name: "LINEAL" },
  doble_oferta_upsell: { product_name: "*KIT EMPRENDEDOR FULL*" },
  upsell: { product_name: "UPSELL" },
};
const mk = () => ({ product_name: "" });
const resultado = {
  ...mt,
  lineal: mt.lineal ?? mk(),
  order_bump: mt.order_bump ?? mk(),
  bioferta: mt.bioferta ?? mk(),
  doble_oferta_dos: mt.doble_oferta_dos ?? mk(),
};
comprobar(
  "  Doble Oferta + Upsell sobrevive a la carga",
  resultado.doble_oferta_upsell?.product_name === "*KIT EMPRENDEDOR FULL*",
  "sobrevive"
);
comprobar(
  "  Upsell también",
  resultado.upsell?.product_name === "UPSELL",
  "sobrevive"
);
comprobar(
  "  y las que faltaban se crean en blanco",
  resultado.order_bump?.product_name === "" &&
    resultado.bioferta?.product_name === "",
  "creadas"
);
comprobar(
  "  sin pisar las que ya tenían contenido",
  resultado.lineal?.product_name === "LINEAL",
  "intacta"
);

console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} comprobación(es) mal.`);
process.exit(fallos === 0 ? 0 : 1);
