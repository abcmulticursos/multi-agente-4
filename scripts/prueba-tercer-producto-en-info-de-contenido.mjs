// El tercer producto no se podia marcar en «Info de contenido».
//
// LO QUE PASABA
//
// "Doble Oferta + Upsell" se edita desde DOS pestañas: "Doble Oferta 2 Prod"
// para las dos opciones, y "Upsell" para el tercer producto. La lista de «Info
// de contenido» miraba SOLO la pestaña en la que uno estuviera parado, y en la
// primera devolvia dos productos, no tres:
//
//   parado en Doble Oferta + Upsell  ->  FULL, BASICO, PAGINAS SECRETAS
//   parado en Doble Oferta 2 Prod    ->  FULL, BASICO            <-- faltaba
//
// Y el bot estaba vendiendo los tres igual. Ademas las marcas son UNA sola
// lista, comun a todo (product_info_topics): al motor le da igual desde que
// pestaña se marcaron. Asi que esconder el tercero por la pestaña no protegia
// nada — solo dejaba sin forma de marcarlo.
//
// AHORA
//
// Estando en la pestaña de las dos opciones, el tercero se suma A LA LISTA
// cuando el bot lo vende DE VERDAD (por la modalidad en marcha, no por la
// pestaña). En "Doble Oferta 2 Prod" a secas el tercero no existe, y ahi sigue
// sin aparecer: la regla de que ninguna modalidad enseña contenido de otra
// queda intacta.
//
//   node scripts/prueba-tercer-producto-en-info-de-contenido.mjs
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
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 62)} ${valor}`);
};

// ── 1. La función, ejecutada de verdad ──────────────────────────────────────
// Se ejecutan LAS DOS: `productInfoOptions` y la que responde si esta modalidad
// vende el extra. La segunda se extrajo aparte cuando la etapa Upsell pasó a
// vivir en la capa de cada modalidad —antes era una lista de nombres escrita
// dentro— y sin ella esto reventaba con «no está definida».
const trozo = (nombre) => {
  const desde = editor.indexOf(`function ${nombre}`);
  if (desde < 0) return "";
  const finWin = editor.indexOf("\r\n}\r\n", desde);
  const hasta = finWin >= 0 ? finWin : editor.indexOf("\n}\n", desde);
  return editor.slice(desde, hasta + 5);
};
const sinTipos = (src) =>
  src
    .replace(/: FullConfig/g, "")
    .replace(/\): boolean \{/g, ") {")
    .replace(/: Array<\{ topic: string; label: string \}>/g, "");

const fuente = trozo("productInfoOptions");
const fuenteExtra = trozo("modalidadVendeElExtra");

comprobar(
  "las funciones están donde se les busca",
  fuente.length > 0 && fuenteExtra.length > 0,
  "sí"
);

const uniqNonEmpty = (values) =>
  values
    .map((v) => v?.trim() ?? "")
    .filter((v, i, a) => !!v && a.indexOf(v) === i);

const cuerpo = `${sinTipos(fuenteExtra)}\n${sinTipos(fuente)}\nreturn productInfoOptions(c);`;

const hacer = (modoPestaña, modoReal) =>
  new Function("c", "uniqNonEmpty", "activeModality", "runtimeModality", cuerpo)(
    muestra,
    uniqNonEmpty,
    () => modoPestaña,
    () => modoReal
  ).map((o) => o.topic);

// Un config de mentira, con los tres productos y sus muestras.
const muestra = {
  product_name: "FULL",
  product_name_2: "BASICO",
  image_gallery: [{ topic: "tema full" }],
  image_gallery_2: [{ topic: "tema basico" }],
  pack_gallery: [],
  upsell: { name: "Paginas secretas", image_gallery: [{ topic: "tema extra" }] },
};

comprobar(
  "parado en Doble Oferta + Upsell salen los tres",
  JSON.stringify(hacer("doble_oferta_upsell", "doble_oferta_upsell")) ===
    JSON.stringify(["tema full", "tema basico", "tema extra"]),
  "3 muestras"
);
comprobar(
  // ESTE era el fallo: la misma venta, otra pestaña, y el tercero desaparecía.
  "parado en Doble Oferta 2 Prod TAMBIÉN salen los tres",
  JSON.stringify(hacer("doble_oferta_dos", "doble_oferta_upsell")) ===
    JSON.stringify(["tema full", "tema basico", "tema extra"]),
  "3 muestras"
);
comprobar(
  // Y la regla de siempre: en Doble Oferta 2 Prod a secas el tercero no existe.
  "en Doble Oferta 2 Prod a secas el tercero NO sale",
  JSON.stringify(hacer("doble_oferta_dos", "doble_oferta_dos")) ===
    JSON.stringify(["tema full", "tema basico"]),
  "2 muestras"
);
comprobar(
  "y en Lineal sigue saliendo solo lo suyo",
  JSON.stringify(hacer("lineal", "lineal")) === JSON.stringify(["tema full"]),
  "1 muestra"
);
comprobar(
  "el tercero se etiqueta con su nombre, no con el tema",
  new Function("c", "uniqNonEmpty", "activeModality", "runtimeModality", cuerpo)(
    muestra,
    uniqNonEmpty,
    () => "doble_oferta_dos",
    () => "doble_oferta_upsell"
  ).some((o) => o.label === "Paginas secretas"),
  "con su nombre"
);

// ── 2. El cartel de arriba deja de mentir ───────────────────────────────────
comprobar(
  "el cartel ya no dice «solo Producto 1 y 2» cuando hay tres",
  /isDobleOfertaDos && runtimeModality\(cfg\) !== "doble_oferta_upsell"/.test(
    editor
  ),
  "avisa del tercero"
);

console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} comprobación(es) mal.`);
process.exit(fallos === 0 ? 0 : 1);
