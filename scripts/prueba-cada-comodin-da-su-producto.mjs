// CADA COMODIN DA SU PRODUCTO, TAMBIEN CON LA PRESENTACION PRESTADA.
//
// LO QUE PASO — 23 de septiembre de 2026.
//
//   El dueño sento un producto en el BASICO y otro en el FULL, encendio el
//   selector violeta, y los DOS comodines le salian con el nombre del basico.
//   Con sus palabras: «al yo poner los comodines, basico y full, ambos salian
//   representados con el nombre del producto base».
//
// LA CAUSA, y es la misma que este proyecto ya pago tres veces: preguntar por
// el NOMBRE de la modalidad en vez de por el DATO.
//
//     if (modo === "lineal" || modo === "upsell")
//         -> los dos comodines devolvian el mismo producto
//
//   Y esa linea era CORRECTA hasta que existio la presentacion prestada: en
//   Lineal se vende uno, asi que «el barato» y «el caro» son el mismo. Con el
//   selector encendido ya no.
//
// LO QUE NO PUEDE ROMPERSE
//
//   1. LINEAL A SECAS. Sin el selector, los dos comodines siguen dando el mismo
//      producto — eso se puso a proposito y hay textos escritos contando con
//      ello.
//   2. SIN EL SEGUNDO PRODUCTO SENTADO tampoco cambia: no hay dos que repartir.
//   3. -OB- Y LAS DOS DOBLES OFERTAS no se tocan: sus ramas van antes.
//   4. Y el comodin NO puede ser cosmetico: el nombre tiene que salir del mismo
//      reparto que decide lo que el bot vende.
//
//   node scripts/prueba-cada-comodin-da-su-producto.mjs
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const RAIZ = process.cwd();
const DOBLE = "stub:db";
registerHooks({
  resolve(esp, ctx, next) {
    if (esp === "@/lib/db")
      return { url: DOBLE, format: "module", shortCircuit: true };
    if (esp.startsWith("@/")) {
      const rel = esp.slice(2);
      const conExt = /\.[a-z]+$/.test(rel) ? rel : `${rel}.ts`;
      return {
        url: pathToFileURL(join(RAIZ, "src", conExt)).href,
        shortCircuit: true,
      };
    }
    return next(esp, ctx);
  },
  load(url, ctx, next) {
    if (url === DOBLE)
      return {
        format: "module",
        shortCircuit: true,
        source:
          "export const getConversationByPhone=()=>null;export const getFrozenPrices=()=>null;export const getUpsellFrozenPrices=()=>null;export const getPuestoEnLaFila=()=>null;export const leerCompradosDeLaFila=()=>[];export const moverLaFila=()=>{};export const setFrozenPrices=()=>{};",
      };
    return next(url, ctx);
  },
});

const motor = await import(
  pathToFileURL(join(RAIZ, "src", "lib", "workflow", "config.ts")).href
);
const { repartirPorEtiqueta, nombresDeLosProductos } = motor;

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 54)} ${valor}`);
};

// PRODUCTOS INVENTADOS. Una prueba con los reales tapa justo el fallo que la
// regla de la plantilla evita.
const biblioteca = [
  { id: "pB", name: "PRODUCTO ALFA", price_soles: 10 },
  { id: "pF", name: "PRODUCTO BETA", price_soles: 15 },
  { id: "pU", name: "PRODUCTO GAMA", price_soles: 7 },
];

/** Su montaje: uno en el basico, otro en el full. */
const montaje = (forma, alineacion) =>
  repartirPorEtiqueta({
    biblioteca_de_productos: biblioteca,
    alineacion_por_modalidad: { lineal: alineacion },
    ...(forma ? { segunda_opcion_prestada: forma } : {}),
  });

const losDos = { unico: "pB", basico: "pB", full: "pF", upsell: "pU" };
const soloUno = { unico: "pB", upsell: "pU" };

// Lo que van a dar los dos comodines. Se ejecuta la decision REAL: es la misma
// funcion que resuelve {{PRODUCTO_BASE}} y {{PRODUCTO_FULL}} al enviar.
const resolver = (cfg) => {
  const n = nombresDeLosProductos(cfg);
  return `barato=${n.base} caro=${n.full}`;
};

console.log("\n-- 1. con el selector encendido, cada uno el suyo ------------");
for (const forma of ["dos_juntas", "segunda_oculta"]) {
  const cfg = montaje(forma, losDos);
  const salida = resolver(cfg);
  comprobar(
    `«${forma}»: el barato es el suyo`,
    /barato=PRODUCTO ALFA/.test(salida),
    salida.slice(0, 46)
  );
  comprobar(
    `«${forma}»: y el caro es OTRO`,
    /caro=PRODUCTO BETA/.test(salida),
    "no repite el barato"
  );
}

console.log("\n-- 2. lineal a secas NO cambia ------------------------------");
// Se puso a proposito y hay textos escritos contando con ello: en Lineal «el
// barato» y «el caro» son el mismo, porque solo hay uno.
const pelado = resolver(montaje(null, soloUno));
comprobar(
  "los dos comodines dan el mismo producto",
  /barato=PRODUCTO ALFA/.test(pelado) && /caro=PRODUCTO ALFA/.test(pelado),
  pelado.slice(0, 46)
);

console.log("\n-- 3. encendido pero SIN el segundo sentado -----------------");
// No hay dos que repartir, asi que se comporta como lineal de siempre.
const aMedias = resolver(montaje("dos_juntas", soloUno));
comprobar(
  "sigue dando el mismo en los dos",
  /barato=PRODUCTO ALFA/.test(aMedias) && /caro=PRODUCTO ALFA/.test(aMedias),
  "no se inventa un segundo"
);

console.log("\n-- 4. el comodin NO es cosmetico ----------------------------");
// EL CANDADO QUE MAS IMPORTA. El nombre tiene que salir del MISMO reparto que
// decide lo que el bot vende: si discreparan, el cliente leeria un producto y
// recibiria otro.
const cfgDos = montaje("dos_juntas", losDos);
comprobar(
  "el caro del comodin es el del hueco que se vende",
  cfgDos.product_name === "PRODUCTO BETA",
  `hueco 1 = ${cfgDos.product_name}`
);
comprobar(
  "y el barato tambien",
  cfgDos.product_name_2 === "PRODUCTO ALFA",
  `hueco 2 = ${cfgDos.product_name_2}`
);

// -- 5. Y EL VISOR MIRA LA MISMA TABLA DE CAJAS ------------------------------
//
// EL SITIO QUE FALTABA. Arreglados el motor y «quien es el barato», el dueño
// SEGUIA viendo el mismo nombre en los dos comodines: el visor pregunta aparte
// de que PUESTO sale cada caja, y esa tabla solo miraba el nombre de la
// modalidad. En lineal decia «caja 1 = el unico, caja 2 = no existe», asi que
// la caja 2 se caia al campo viejo del cajon y las dos acababan igual.
console.log("\n-- 5. el visor mira la misma tabla de cajas ------------------");
const { readFileSync } = await import("node:fs");
const editor = readFileSync(join(RAIZ, "src", "app", "editor", "page.tsx"), "utf8");
comprobar(
  "la tabla de cajas cuenta la presentacion prestada",
  /if \(c && modo === runtimeModality\(c\) && segundaOpcionPrestada\(c\)\) \{[\s\S]{0,120}?\["full", "basico"\]/.test(
    editor
  ),
  "el caro en la 1, el barato en la 2"
);
comprobar(
  "y el visor se la pide con la configuracion",
  /puestoDelCajonDeContenido\(previewMode, 1, c\)/.test(editor) &&
    /puestoDelCajonDeContenido\(previewMode, 2, c\)/.test(editor),
  "sin esto no se entera"
);

// -- 6. Y EL PRECIO DEL FULL TIENE DONDE PONERSE -----------------------------
//
// LO QUE PASO — 23/09/2026. Al cambiar a «como -DOU-», en Precios y pagos NO
// aparecia el boton del FULL: sin el no hay donde ponerle precio, y
// {{PRECIO_FULL}} se quedaba sin nada que enseñar. Mismo fallo de siempre:
// preguntaba por el NOMBRE de la modalidad.
console.log("\n-- 6. el precio del full tiene donde ponerse -----------------");
comprobar(
  "el boton del FULL cuenta la presentacion prestada",
  /layerMode === "doble_oferta_upsell" \|\|\s*\r?\n?\s*vendeDosPorPrestada\)/.test(
    editor
  ),
  "no solo -OB- y -DOU-"
);
comprobar(
  "y se pregunta por el DATO, con la capa que vende",
  /const vendeDosPorPrestada =[\s\S]{0,180}?layerMode === runtimeModality\(cfg\) && !!segundaOpcionPrestada\(cfg\)/.test(
    editor
  ),
  "no en una capa que no lo usa"
);

// -- 7. Y EL PRECIO DEL FULL SALE DE SU FICHA --------------------------------
//
// LO QUE PASO — 23/09/2026, dicho por el dueño: «los precios ya no se toman de
// la seccion precios y pagos cuando estan vacias sino de la misma ficha; el
// precio base lo hace asi y va directo al comodin, haz lo mismo con el full».
//
// MEDIDO con su configuracion: el MOTOR ya lo hacia —ficha del producto sentado
// en el Full, 10 en Peru y 10.000 en Argentina, con Precios y pagos en cero—.
// Quien mentia era el VISOR: `modalidadDeDosOpciones` preguntaba por el NOMBRE
// de la modalidad, devolvia false en Lineal aunque «PRESENTA:» estuviera
// encendido, y el precio del full salia «sin configurar».
//
// El base no se notaba porque su rama de un solo producto cae a la ficha del
// Unico, y ahi si habia precio. Por eso uno funcionaba y el otro no.
console.log("\n-- 7. el precio del full sale de su ficha --------------------");
const PAIS = "XX";
const conPrecios = [
  { id: "pB", name: "PRODUCTO ALFA", price_soles: 10, precios_por_pais: { XX: { price_soles: 111 } } },
  { id: "pF", name: "PRODUCTO BETA", price_soles: 15, precios_por_pais: { XX: { price_soles: 222 } } },
];
const cfgPrecios = repartirPorEtiqueta({
  biblioteca_de_productos: conPrecios,
  alineacion_por_modalidad: { lineal: { unico: "pB", basico: "pB", full: "pF" } },
  segunda_opcion_prestada: "dos_juntas",
});
const { preciosDeLaFichaEnElPais } = motor;
comprobar(
  "la ficha del full contesta con la prestada",
  preciosDeLaFichaEnElPais("full", PAIS, cfgPrecios).precio === 222,
  `${preciosDeLaFichaEnElPais("full", PAIS, cfgPrecios).precio}`
);
comprobar(
  "y NO es el precio del base",
  preciosDeLaFichaEnElPais("basico", PAIS, cfgPrecios).precio === 111,
  "cada uno el suyo"
);

// Y EL VISOR PREGUNTA LO MISMO. Es la mitad que fallaba: el motor resolvia bien
// y la vista previa enseñaba «sin configurar».
comprobar(
  "el visor cuenta la presentacion prestada",
  /modo === runtimeModality\(c\) &&\s*!!segundaOpcionPrestada\(c\) &&\s*!!fichaEnPuesto\(c, "full"\)/.test(
    editor
  ),
  "no solo las tres de siempre"
);
comprobar(
  "y sigue exigiendo que el full este sentado",
  /!!fichaEnPuesto\(c, "full"\)/.test(editor),
  "sin producto no hay precio"
);

// -- 8. CON EL SELECTOR PUESTO Y UN SOLO PRODUCTO, EL NOMBRE ES EL SUYO ------
//
// LO QUE PASO — 24/09/2026. El dueño vio que el bot llamaba a su curso
// «Producto principal». Medido con su configuracion:
//
//     product_name   (hueco 1): ""                    <- el FULL, vacio
//     product_name_2 (hueco 2): "QUIMICA EN ACCION"
//     getProductName()        : "Producto principal"  <- el respaldo de fabrica
//
// Tenia el selector encendido y el asiento FULL vacio. Con la tabla de dos
// opciones el hueco 1 lo llena el FULL; sin nadie ahi, el hueco 1 sale vacio y
// el nombre cae al texto de fabrica — que acaba en el chat de un cliente.
//
// El resto del motor ya se comportaba como UN producto en ese caso. Faltaba la
// tabla de huecos, y por eso los nombres iban por un lado y la venta por otro.
console.log("\n-- 8. con el selector y un solo producto --------------------");
for (const forma of [null, "dos_juntas", "segunda_oculta"]) {
  const cfg = montaje(forma, soloUno);
  const nombre = forma ?? "apagado";
  comprobar(
    `«${nombre}»: el hueco 1 lleva SU producto`,
    cfg.product_name === "PRODUCTO ALFA",
    `${cfg.product_name || "(VACIO)"}`
  );
}
// Y CON LOS DOS SENTADOS NO SE MOVIO NADA: el caro sigue en el hueco 1.
comprobar(
  "y con los dos sentados sigue mandando el caro",
  montaje("dos_juntas", losDos).product_name === "PRODUCTO BETA",
  "el reparto de dos no se toco"
);

console.log(
  fallos === 0
    ? "\nTODO OK — cada comodin da su producto, y lineal a secas no se movio\n"
    : `\n${fallos} comprobacion(es) mal.\n`
);
process.exit(fallos === 0 ? 0 : 1);
