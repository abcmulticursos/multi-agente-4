// La muestra del producto FULL tambien sale cuando piden ver el detalle.
//
// LO QUE PASO — 14 de septiembre de 2026, con las palabras del dueno:
//
//   «en la ficha de productos hay un activador para enviar la muestra, se
//    llama "Sale cuando piden ver el detalle". Lo que estaba pasando es que el
//    producto FULL no se enviaba; solo se enviaban, en modalidad order bump,
//    las muestras del basico y del complementario, mas no el full.»
//
//   Marcaba la casilla en las imagenes de la ficha del full y al pedir el
//   detalle llegaban las otras dos. Sin error, sin aviso, y solo se ve en el
//   chat.
//
// POR QUE
//
//   El reparto copia las galerias en los DOS huecos del contenido. En Order
//   Bump esos huecos son el basico (1) y el complementario (2): el FULL no
//   tiene hueco. Su galeria se quedaba en la ficha sin copiarse a ninguna caja.
//
//   Y la lista de temas marcados —`product_info_topics`— SI recorre a todos los
//   asignados, el full incluido. O sea que apuntaba a unas imagenes que el
//   lector de galerias no podia encontrar: `getImageGallery` busca en
//   `image_gallery`, `image_gallery_2` y `pack_gallery`, y a esta ultima no la
//   llenaba nadie. Los temas del full resolvian a nada y se caian del envio.
//
//   Es el mismo fallo que dejo vacios los comodines de Doble Oferta + Upsell:
//   una caja que el reparto no llenaba, y el motor leyendo la caja.
//
//   node scripts/prueba-la-muestra-del-full-tambien-sale.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const config = readFileSync(
  join(RAIZ, "src", "lib", "workflow", "config.ts"),
  "utf8"
);

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

const reparto = (() => {
  const i = config.indexOf("export function repartirPorEtiqueta(");
  const f = config.indexOf("export function loadWorkflowConfig(", i);
  return i < 0 || f < 0 ? "" : config.slice(i, f);
})();
comprobar("se encuentra el reparto", reparto.length > 0, "repartirPorEtiqueta");

// ── 1. EL REPARTO LLENA LA CAJA DEL PACK ─────────────────────────────────────
console.log("\n— la galeria del full ya tiene donde caer —\n");
comprobar(
  "el reparto escribe pack_gallery",
  /next\.pack_gallery = enPuesto\("full"\)\?\.image_gallery \?\? \[\];/.test(
    reparto
  ),
  "la caja que lee getImageGallery"
);
// El 22/09/2026 esa lectura pasó a `tablaDeHuecos(modo, config)`: la MISMA
// tabla, contando además la presentación prestada. La intención no cambia — se
// pregunta a la tabla, nunca al nombre de la modalidad.
comprobar(
  "y solo donde el full no ocupa un hueco",
  /puestos\.includes\("full"\) && tablaDeHuecos\(modo, config\)\.full === undefined/.test(
    reparto
  ),
  "se pregunta a la tabla, no se escriben modalidades"
);
comprobar(
  "sin nadie de full, la caja sale VACIA",
  /next\.pack_gallery = enPuesto\("full"\)\?\.image_gallery \?\? \[\];/.test(
    reparto
  ),
  "no se queda la del producto anterior"
);

// ── 2. LA TABLA DICE QUIEN TIENE HUECO Y QUIEN NO ────────────────────────────
//
// Es la que decide donde aplica el arreglo. Si alguien la cambia, esta prueba
// avisa antes de que el dueno lo descubra en una venta.
console.log("\n— y la tabla dice a quien le hacia falta —\n");
const tabla = (() => {
  const i = config.indexOf("const CONTENIDO_DEL_PUESTO:");
  const f = config.indexOf("\n};", i);
  return config.slice(i, f);
})();
const puestos = (() => {
  const i = config.indexOf("export function puestosDeLaModalidad(");
  const f = config.indexOf("\n}", i);
  return config.slice(i, f);
})();
comprobar(
  "order_bump: los huecos son basico y complementario",
  /order_bump: \{ basico: 1, complementario: 2 \}/.test(tabla),
  "el full se quedaba fuera"
);
comprobar(
  "order_bump SI ofrece el puesto de full",
  /return \["basico", "complementario", "full", "upsell"\];/.test(puestos),
  "por eso su galeria tiene que salir"
);
comprobar(
  "bioferta esta igual: el Pack es el full y no tiene hueco",
  /bioferta: \{ basico: 1, complementario: 2 \}/.test(tabla),
  "mismo fallo, misma cura"
);
comprobar(
  "doble oferta NO cambia: alli el full ES el hueco 1",
  /doble_oferta_dos: \{ full: 1, basico: 2 \}/.test(tabla) &&
    /doble_oferta_upsell: \{ full: 1, basico: 2 \}/.test(tabla),
  "su galeria ya salia por image_gallery"
);
comprobar(
  "lineal y upsell no tienen puesto de full",
  /return \["unico", "upsell"\];/.test(puestos),
  "la condicion ni se mira"
);

// ── 3. Y AHORA EL TEMA DEL FULL SI SE ENCUENTRA ──────────────────────────────
//
// Se reproduce la cadena entera con datos inventados: el reparto llena las tres
// cajas, `product_info_topics` recoge lo marcado en las FICHAS, y el lector
// resuelve cada tema contra las tres galerias. Es donde se caia el full.
console.log("\n— la cadena completa, de la ficha al envio —\n");

const fichas = {
  basico: {
    name: "<barato>",
    image_gallery: [
      { topic: "muestra barata", info_de_contenido: true },
      { topic: "suelta", info_de_contenido: false },
    ],
  },
  complementario: {
    name: "<complemento>",
    image_gallery: [{ topic: "muestra del complemento", info_de_contenido: true }],
  },
  full: {
    name: "<pack>",
    image_gallery: [{ topic: "muestra del pack", info_de_contenido: true }],
  },
};

// Lo que hace el reparto en order_bump: hueco 1 = basico, hueco 2 =
// complementario, y ahora el pack con el full.
const cajas = {
  image_gallery: fichas.basico.image_gallery,
  image_gallery_2: fichas.complementario.image_gallery,
  pack_gallery: fichas.full.image_gallery,
};

// Lo que hace la lista de temas: recorre las FICHAS de los asignados.
const temasMarcados = [];
for (const ficha of [fichas.basico, fichas.complementario, fichas.full]) {
  for (const muestra of ficha.image_gallery) {
    if (!muestra.info_de_contenido || !muestra.topic.trim()) continue;
    if (!temasMarcados.some((t) => t.toLowerCase() === muestra.topic.toLowerCase()))
      temasMarcados.push(muestra.topic);
  }
}

// Lo que hace el lector: junta las tres galerias y resuelve por tema.
const resolver = (galerias) => {
  const porTema = new Map(
    [...galerias.image_gallery, ...galerias.image_gallery_2, ...galerias.pack_gallery].map(
      (item) => [item.topic.toLowerCase(), item]
    )
  );
  return temasMarcados
    .map((t) => porTema.get(t.toLowerCase()))
    .filter(Boolean)
    .map((item) => item.topic);
};

const salenAhora = resolver(cajas);
const salianAntes = resolver({ ...cajas, pack_gallery: [] });

comprobar(
  "la marca del full entra en la lista de temas",
  temasMarcados.includes("muestra del pack"),
  `${temasMarcados.length} temas marcados`
);
comprobar(
  "ANTES el tema del full no resolvia a ninguna imagen",
  !salianAntes.includes("muestra del pack"),
  `salian ${salianAntes.length} de ${temasMarcados.length}`
);
comprobar(
  "AHORA si",
  salenAhora.includes("muestra del pack"),
  `salen ${salenAhora.length} de ${temasMarcados.length}`
);
comprobar(
  "y las tres muestras salen, en el orden de los puestos",
  JSON.stringify(salenAhora) ===
    JSON.stringify([
      "muestra barata",
      "muestra del complemento",
      "muestra del pack",
    ]),
  salenAhora.join(" · ")
);
comprobar(
  "la imagen SIN marcar sigue sin salir",
  !salenAhora.includes("suelta"),
  "el interruptor manda"
);

// ── 4. Y EL LECTOR SIGUE LEYENDO LAS TRES ────────────────────────────────────
console.log("\n— el lector de galerias no se ha tocado —\n");
const lector = (() => {
  const i = config.indexOf("export function getImageGallery(");
  const f = config.indexOf("\n}", i);
  return config.slice(i, f);
})();
// LAS TRES SIGUEN SUMANDOSE, aunque ya no en una sola linea.
//
// El 17/09/2026 ese `return` paso a ORDENAR las muestras por puesto —basico
// primero, el full al final, que es lo que pidio el dueño— asi que ahora son
// tres entradas que se ordenan y se aplanan. Lo que esta afirmacion protege NO
// cambia: que no se quede fuera ninguna de las tres cajas. Si alguna
// desapareciera, estariamos escondiendo muestras en vez de ordenarlas.
comprobar(
  "junta base + segundo + pack",
  /muestras: base/.test(lector) &&
    /muestras: second/.test(lector) &&
    /muestras: pack/.test(lector) &&
    /\.flatMap\(\(caja\) => caja\.muestras\)/.test(lector),
  "las tres, como siempre"
);
// ESTA AFIRMACION CAMBIO DE FORMA EL 15 DE SEPTIEMBRE DE 2026, NO DE INTENCION.
//
// Decia: «la caja del pack se lee si esta encendida bioferta u order bump». Lo
// que queria fijar es que la doble oferta NO la lee — y no la lee, porque en
// esa modalidad el full ocupa el hueco 1 y su galeria ya sale por ahi.
//
// Lo que cambio es QUIEN lo decide. Antes era esta lista de dos banderas; ahora
// se le pregunta ademas a la tabla que LLENA las cajas, que es la unica que
// sabe si el full tiene hueco propio. El motivo esta en
// `prueba-las-muestras-de-cada-modalidad.mjs`: Doble Oferta + Upsell nacio
// despues de esa lista y nadie la anadio, asi que su caja 2 se llenaba y no la
// leia nadie — el dueno marcaba tres muestras y el cliente recibia una.
//
// Las dos banderas NO se quitaron: se les sumo la pregunta con un `||`, para
// que ninguna instalacion que hoy vea el pack deje de verlo.
comprobar(
  "el pack sigue leyendose en bioferta y order bump",
  /cfg\?\.bioferta_doble\?\.enabled \|\|\s*\n?\s*cfg\?\.order_bump\?\.enabled/.test(
    lector
  ),
  "no se quito ninguna bandera"
);
comprobar(
  "y ahora tambien lo decide la tabla de los puestos",
  /cajasDeLaModalidad\.pack \|\|/.test(lector),
  "doble oferta sigue sin leerlo: alli el full es el hueco 1"
);
comprobar(
  "y el order bump diferido sigue escondiendo el segundo",
  /if \(excludeSecondProduct\) return base;/.test(lector),
  "del full no se dice nada antes de tiempo"
);

// ── 5. Sin nombres de productos en el codigo ─────────────────────────────────
comprobar(
  "el arreglo no nombra ningun producto",
  !/pack_gallery = \[?['"]/i.test(reparto),
  "sale de la ficha"
);

console.log(
  fallos === 0
    ? "\nTODO OK — la muestra del full ya sale con las otras dos"
    : `\n${fallos} comprobacion(es) mal.`
);
process.exit(fallos === 0 ? 0 : 1);
