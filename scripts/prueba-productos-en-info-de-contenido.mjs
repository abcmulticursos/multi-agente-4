// «Info de contenido»: salen los TRES productos, tengan muestras o no.
//
// LO QUE PASABA
//
// La lista pintaba las muestras SUELTAS, sin decir de que producto era cada
// una. Con tres productos en juego eso no se puede leer:
//
//   [ ] IMAGEN SUPER KIT FLORES DE PAPEL
//   [ ] PAGINAS SECRETAS
//
// Dos casillas, y ninguna forma de saber cual era del tercer producto ni si
// faltaba alguna. Y encima el Producto 2, que todavia no tiene muestras,
// desaparecia ENTERO de la pantalla.
//
// Ahi esta el fallo de verdad: un producto solo aparecia DESPUES de tener algo
// dentro. Justo al reves de como se usa esto — primero ves el hueco, despues lo
// llenas.
//
// AHORA
//
//   SUPER KIT FLORES DE PAPEL
//     [ ] IMAGEN SUPER KIT FLORES DE PAPEL
//   Producto 2
//     Todavia sin muestras. Agregalas en su galeria...
//   Paginas secretas
//     [ ] PAGINAS SECRETAS
//
// Todos los productos de la modalidad, con su nombre, siempre. Los que aun no
// tienen muestras lo dicen en vez de esconderse.
//
//   node scripts/prueba-productos-en-info-de-contenido.mjs
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

const trozo = (nombre) => {
  const desde = editor.indexOf(`function ${nombre}`);
  const crlf = editor.indexOf("\r\n}\r\n", desde);
  const hasta = crlf >= 0 ? crlf : editor.indexOf("\n}\n", desde);
  return editor.slice(desde, hasta + 5);
};

const uniqNonEmpty = (values) =>
  values
    .map((v) => v?.trim() ?? "")
    .filter((v, i, a) => !!v && a.indexOf(v) === i);

// Las dos funciones reales, ejecutadas de verdad.
const cuerpoDe = (nombre, firma) =>
  trozo(nombre)
    .replace(/: FullConfig/g, "")
    .replace(/: Array<\{ topic: string; label: string \}>/g, "")
    .replace(/\): Array<\{ product: string; topics: string\[\] \}>/g, ")")
    .replace(/: Array<\{ topic\?: string \}>/g, "")
    .replace(/: string\[\]/g, "")
    .replace(/: string/g, "")
    .replace(/: boolean/g, "")
    .replace(/new Set<string>\(\)/g, "new Set()")
    // Los parámetros opcionales de TypeScript ("galeria?") quedan sueltos al
    // quitarles el tipo, y en JS eso no se puede escribir.
    .replace(/(\w)\?(\s*[),])/g, "$1$2")
    .replace(/const grupos: Array<\{ product; topics \}> =/, "const grupos =")
    .replace(new RegExp(`^function ${nombre}\\(\\s*${firma}\\s*\\)\\s*\\{`), "")
    .replace(/\}\s*$/, "");

// Quién vende el extra se pregunta en un solo sitio, y las dos de abajo lo
// consultan. Antes era una lista de nombres de modalidad escrita dentro de cada
// una; al mudarse a su propia función, sin pasarla aquí esto reventaba.
const vendeElExtra = (c, pestaña, real) =>
  new Function(
    "c",
    "activeModality",
    "runtimeModality",
    cuerpoDe("modalidadVendeElExtra", "c")
  )(c, () => pestaña, () => real);

const opciones = (c, pestaña, real) =>
  new Function(
    "c",
    "uniqNonEmpty",
    "activeModality",
    "runtimeModality",
    "modalidadVendeElExtra",
    cuerpoDe("productInfoOptions", "c")
  )(c, uniqNonEmpty, () => pestaña, () => real, (cc) =>
    vendeElExtra(cc, pestaña, real)
  );

const grupos = (c, pestaña, real) =>
  new Function(
    "c",
    "uniqNonEmpty",
    "activeModality",
    "runtimeModality",
    "productInfoOptions",
    "modeSupportsSecondProduct",
    "modeSupportsPack",
    "modalidadVendeElExtra",
    cuerpoDe("productInfoGroups", "c")
  )(
    c,
    uniqNonEmpty,
    () => pestaña,
    () => real,
    (cc) => opciones(cc, pestaña, real),
    (m) => m !== "lineal" && m !== "upsell",
    (m) => m === "order_bump" || m === "bioferta",
    (cc) => vendeElExtra(cc, pestaña, real)
  );

// El caso real de Alberto: el Producto 2 todavía vacío.
const suyo = {
  product_name: "SUPER KIT FLORES DE PAPEL",
  product_name_2: "",
  image_gallery: [{ topic: "IMAGEN SUPER KIT FLORES DE PAPEL" }],
  image_gallery_2: [],
  pack_gallery: [],
  upsell: { name: "Paginas secretas", image_gallery: [{ topic: "PAGINAS SECRETAS" }] },
};

const g = grupos(suyo, "doble_oferta_upsell", "doble_oferta_upsell");

comprobar("salen los tres productos, no dos muestras sueltas", g.length === 3, `${g.length} productos`);
comprobar(
  "el tercer producto está, y con su nombre",
  g[2]?.product === "Paginas secretas",
  `«${g[2]?.product}»`
);
comprobar(
  // ESTE era el fallo: sin muestras, el producto no existía en pantalla.
  "el producto sin muestras TAMBIÉN sale",
  g[1]?.product === "Producto 2" && g[1]?.topics.length === 0,
  "con su hueco"
);
comprobar(
  "y cada muestra queda bajo su producto",
  g[0]?.topics[0] === "IMAGEN SUPER KIT FLORES DE PAPEL" &&
    g[2]?.topics[0] === "PAGINAS SECRETAS",
  "ordenadas"
);

// Parado en la otra pestaña desde la que se edita la misma venta.
const g2 = grupos(suyo, "doble_oferta_dos", "doble_oferta_upsell");
comprobar(
  "parado en Doble Oferta 2 Prod también salen los tres",
  g2.length === 3 && g2[2]?.product === "Paginas secretas",
  `${g2.length} productos`
);

// Y la regla de siempre: en Doble Oferta 2 Prod a secas el tercero no existe.
const g3 = grupos(suyo, "doble_oferta_dos", "doble_oferta_dos");
comprobar(
  "en Doble Oferta 2 Prod a secas el tercero NO sale",
  g3.length === 2,
  `${g3.length} productos`
);
const g4 = grupos(suyo, "lineal", "lineal");
comprobar("y en Lineal sale solo el suyo", g4.length === 1, `${g4.length} producto`);

// Nada se puede marcar que no esté permitido.
comprobar(
  "no se puede marcar nada fuera de la lista permitida",
  g
    .flatMap((x) => x.topics)
    .every((t) =>
      opciones(suyo, "doble_oferta_upsell", "doble_oferta_upsell").some(
        (o) => o.topic === t
      )
    ),
  "coinciden"
);
comprobar(
  "y ninguna muestra se repite en dos productos",
  new Set(g.flatMap((x) => x.topics)).size === g.flatMap((x) => x.topics).length,
  "sin repetidas"
);

// ── La pantalla ─────────────────────────────────────────────────────────────
comprobar(
  "la pantalla pinta por producto, no la lista suelta",
  /const grupos = productInfoGroups\(cfg\);/.test(editor) &&
    /\{grupos\.map\(\(grupo\) => \(/.test(editor),
  "agrupada"
);
comprobar(
  "y el producto vacío dice qué hacer",
  /Todavía sin muestras\. Agrégalas en su galería/.test(editor),
  "lo dice"
);

console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} comprobación(es) mal.`);
process.exit(fallos === 0 ? 0 : 1);
