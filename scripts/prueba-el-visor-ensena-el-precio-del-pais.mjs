// EL VISOR ENSEÑA EL PRECIO QUE EL BOT VA A COBRAR, NO UNO VIEJO.
//
// LO QUE CONTÓ EL DUEÑO — 21 de septiembre de 2026, con sus palabras:
//
//   «¿Por qué en modalidad lineal, si yo he puesto 20 soles en precio Perú,
//    está reflejando 7 soles en el previsualizador de WhatsApp?»
//
// QUÉ PASABA. Sus precios viven en `precios_por_pais` —20 en Perú, 5.70 en
// Ecuador— y el campo suelto de la ficha se queda en 0, que es lo correcto: un
// producto que cobra distinto en cada país no tiene UN precio.
//
// Pero las dos funciones del visor miraban SOLO ese campo suelto. Con el 0
// descartado y la capa del país también en 0, la cuenta se caía al último
// respaldo: un número viejo guardado en la raíz del archivo. Ahí había un 7.
//
// Así que la pantalla decía 7 y el bot cobraba 20. Sin error y sin aviso.
//
// EL MOTOR YA LO HACÍA BIEN desde el 18/09: el arreglo de aquel día entró en el
// camino del dinero y no en el espejo.
//
// POR QUÉ ESTA PRUEBA EJECUTA Y NO LEE. Comprobar que el texto «precios_por_pais»
// aparece en el archivo no dice NADA sobre qué número acaba en la pantalla. Así
// que se sacan las funciones del editor y se corren con su caso.
//
//   node scripts/prueba-el-visor-enseña-el-precio-del-pais.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

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

// ── EL CÓDIGO REAL DEL EDITOR ──────────────────────────────────────────────
const sacar = (patron) => (editor.match(patron) ?? [])[1];

const cuerpoNumeroUtil = sacar(
  /const numeroUtil = \(valor: number \| undefined\): number \| undefined =>\n([\s\S]*?);\n/
);
const cuerpoDelPais = sacar(
  /function deLaFichaEnElPais\([\s\S]*?\): number \| undefined \{\n([\s\S]*?)\n\}/
);
const cuerpoPrecio = sacar(
  /function precioDeLaFicha\(\n[\s\S]*?\): number \| undefined \{\n([\s\S]*?)\n\}/
);
const cuerpoMercado = sacar(
  /function mercadoDeLaFicha\(\n[\s\S]*?\): number \| undefined \{\n([\s\S]*?)\n\}/
);

console.log("— se encuentra el código que decide —\n");
comprobar("numeroUtil", !!cuerpoNumeroUtil);
comprobar("el importe del país en la ficha", !!cuerpoDelPais);
comprobar("el precio de la ficha", !!cuerpoPrecio);
comprobar("el «antes» tachado de la ficha", !!cuerpoMercado);
if (fallos > 0) {
  console.log("\nsin el código no se puede ejecutar nada. PARO.\n");
  process.exit(1);
}

const sinTipos = (s) =>
  (s ?? "")
    .replace(/: FullConfig/g, "")
    .replace(/: ProductoEditor \| undefined/g, "")
    .replace(/: "price_soles" \| "discount_price_soles" \| "market_price"/g, "")
    .replace(/: CountryCode \| undefined = activePreviewCountry/g, "")
    .replace(/: PuestoDeProducto\[\]/g, "")
    .replace(/: number \| undefined/g, "");

/** Monta las cuatro funciones reales, una encima de otra, con la ficha y el
 *  país que le demos. Es el mismo código del editor, sin tipos. */
function montar(fichaPorPuesto, pais) {
  const fuente = `
    const activePreviewCountry = ${JSON.stringify(pais ?? null)} ?? undefined;
    const numeroUtil = (valor) =>${sinTipos(cuerpoNumeroUtil)};
    const fichaEnPuesto = (c, puesto) => fichas[puesto];
    function deLaFichaEnElPais(ficha, campo, country = activePreviewCountry) {
${sinTipos(cuerpoDelPais)}
    }
    function precioDeLaFicha(c, ...puestos) {
${sinTipos(cuerpoPrecio)}
    }
    function mercadoDeLaFicha(c, ...puestos) {
${sinTipos(cuerpoMercado)}
    }
    return { precioDeLaFicha, mercadoDeLaFicha };
  `;
  return new Function("fichas", fuente)(fichaPorPuesto);
}

// ── 1. SU CASO, TAL CUAL ───────────────────────────────────────────────────
console.log("\n— su caso: precios por país, campo suelto en 0 —\n");

const suFicha = {
  name: "QUIMICA EN ACCION",
  price_soles: 0,
  market_price: 0,
  precios_por_pais: {
    PE: { price_soles: 20, discount_price_soles: 15, market_price: 99 },
    EC: { price_soles: 5.7, discount_price_soles: 4.5, market_price: 30 },
  },
};

const enPeru = montar({ unico: suFicha }, "PE");
comprobar(
  "en Perú el visor saca 20 ← lo que él escribió",
  enPeru.precioDeLaFicha({}, "unico") === 20,
  `sale ${enPeru.precioDeLaFicha({}, "unico")}`
);
comprobar(
  "  y el «antes» tachado, 99",
  enPeru.mercadoDeLaFicha({}, "unico") === 99,
  `sale ${enPeru.mercadoDeLaFicha({}, "unico")}`
);
comprobar(
  "  NO devuelve vacío, que es lo que lo tiraba al número viejo",
  enPeru.precioDeLaFicha({}, "unico") !== undefined,
  "antes: undefined -> caía al 7 de la raíz"
);

const enEcuador = montar({ unico: suFicha }, "EC");
comprobar(
  "en Ecuador saca 5.7, no el de Perú",
  enEcuador.precioDeLaFicha({}, "unico") === 5.7,
  `sale ${enEcuador.precioDeLaFicha({}, "unico")}`
);

// ── 2. LO QUE NO SE PUEDE HABER ROTO ───────────────────────────────────────
//
// Quien NO reparte sus precios por país tiene que seguir viendo el suyo.
console.log("\n— y lo de siempre sigue funcionando —\n");

const fichaSuelta = { name: "CON PRECIO UNICO", price_soles: 33, market_price: 80 };
const suelta = montar({ unico: fichaSuelta }, "PE");
comprobar(
  "una ficha con precio suelto sigue dando el suyo",
  suelta.precioDeLaFicha({}, "unico") === 33,
  `sale ${suelta.precioDeLaFicha({}, "unico")}`
);
comprobar(
  "  y su tachado también",
  suelta.mercadoDeLaFicha({}, "unico") === 80
);

const mixta = {
  name: "MIXTA",
  price_soles: 33,
  precios_por_pais: { PE: { price_soles: 20 } },
};
comprobar(
  "con los dos puestos, manda el del PAÍS",
  montar({ unico: mixta }, "PE").precioDeLaFicha({}, "unico") === 20,
  "es el orden del motor"
);
comprobar(
  "  y en un país sin precio propio, cae al suelto",
  montar({ unico: mixta }, "MX").precioDeLaFicha({}, "unico") === 33,
  "no se queda sin precio"
);
comprobar(
  "sin país elegido, cae al suelto",
  montar({ unico: mixta }, null).precioDeLaFicha({}, "unico") === 33
);
comprobar(
  "un puesto vacío no inventa un precio",
  montar({}, "PE").precioDeLaFicha({}, "unico") === undefined
);
comprobar(
  "y se sigue probando puesto por puesto, en orden",
  montar({ basico: suFicha }, "PE").precioDeLaFicha({}, "unico", "basico") === 20,
  "el Único de Lineal llena también las otras cajas"
);

// ── 3. QUE EL CASO SEA EL SUYO, NO UNO INVENTADO ───────────────────────────
console.log("\n— y esto es su contenido de verdad —\n");

let cfg = null;
try {
  cfg = parseYaml(
    readFileSync(join(RAIZ, "config", "intro-data.yaml"), "utf8")
  );
} catch {
  /* si no se puede leer, los avisos de abajo lo dicen */
}
if (!cfg) {
  console.log("aviso  no se pudo leer su contenido; los casos de arriba bastan");
} else {
  const idLineal = cfg?.alineacion_por_modalidad?.lineal?.unico;
  const ficha = (cfg?.biblioteca_de_productos ?? []).find((p) => p?.id === idLineal);
  const pePorPais = ficha?.precios_por_pais?.PE?.price_soles;
  const peSuelto = ficha?.price_soles;
  const global = cfg?.course_price_soles;
  console.log(`       lineal vende: ${ficha?.name ?? "(sin producto)"}`);
  console.log(`       su precio en PE, por país : ${pePorPais}`);
  console.log(`       su campo suelto           : ${peSuelto}`);
  console.log(`       el número viejo de la raíz: ${global}`);
  comprobar(
    "tiene precio por país y el campo suelto vacío",
    typeof pePorPais === "number" && pePorPais > 0 && !peSuelto,
    "por eso caía al número viejo"
  );
  const real = montar({ unico: ficha }, "PE");
  comprobar(
    `el visor enseñaría ${pePorPais}, no ${global}`,
    real.precioDeLaFicha({}, "unico") === pePorPais,
    `sale ${real.precioDeLaFicha({}, "unico")}`
  );
}

// ── 4. Y LA VISTA DE CANALES DEJA DE COGERLO A PELO ────────────────────────
console.log("\n— la vista de Canales pregunta, ya no coge el número viejo —\n");

comprobar(
  "usa el mismo resolvedor que el resto",
  /const price = previewFullPriceFromConfig\(cfg\);/.test(editor),
  "antes: cfg.globals.course_price_soles"
);

// ── 5. Y EL ORDEN ES EL DEL MOTOR: LA FICHA PRIMERO ────────────────────────
//
// LO QUE PIDIÓ EL DUEÑO — 21 de septiembre de 2026:
//
//   «Que se respeten los precios de las fichas y que los precios se reflejen en
//    los visores como debe ser, y que ese precio sea el correcto para el cobro.
//    Nada de falsedades ni errores.»
//
// El motor pregunta primero a la ficha y después a la capa del país. Estas
// vistas lo hacían al revés, y con los dos llenos enseñaban uno y cobraban otro.
// Medido en su contenido: cuatro casos discrepaban —order_bump EC (10 vs 5.70),
// doble oferta PE full (10 vs 14), PE upsell (10 vs 8) y EC básico (2 vs 3)—.
console.log("\n— y el orden es el del motor: la ficha primero —\n");

const alReves = [
  ...editor.matchAll(
    /numeroUtil\([^)]*\)\s*\?\?\s*\n\s*(precioDeLaFicha|mercadoDeLaFicha)\(/g
  ),
];
comprobar(
  "ninguna vista pregunta a la capa antes que a la ficha",
  alReves.length === 0,
  alReves.length === 0 ? "" : `quedan ${alReves.length}`
);

const fichaPrimero = [
  ...editor.matchAll(
    /(precioDeLaFicha|mercadoDeLaFicha)\(c,[^)]*\)\s*\?\?\s*\n\s*numeroUtil\(/g
  ),
];
comprobar(
  "y hay varias que sí preguntan a la ficha primero",
  fichaPrimero.length >= 6,
  `${fichaPrimero.length} sitios`
);

// EL RESPALDO SE QUEDA DONDE ESTABA. Es el número guardado en la raíz, que el
// motor reemplaza al arrancar: tiene que seguir siendo el ÚLTIMO de todos.
comprobar(
  "el número viejo de la raíz sigue siendo el último recurso",
  /precioDeLaFicha\(c, "unico"\) \?\?\s*\n\s*numeroUtil\(profile\?\.course_price_soles\) \?\?\s*\n\s*c\.globals\.course_price_soles/.test(
    editor
  ),
  "solo sale cuando no hay nada más"
);

// ── 6. EL PRECIO DE OFERTA TAMBIÉN SALE DE LA FICHA ────────────────────────
//
// LO QUE CONTÓ EL DUEÑO, el mismo día y justo después:
//
//   «El precio de descuento se activa en cierta etapa de seguimiento según yo lo
//    decida. Esto se estaba reflejando en el visor: si yo ponía el descuento en
//    el seguimiento 2, automáticamente el visor me mostraba el precio con
//    descuento. Me parece que con el arreglo se ha quitado.»
//
// TENÍA RAZÓN. El descuento de las vistas NUNCA miró la ficha: leía solo la capa
// del país. Mientras el precio normal también salía de la capa, los dos venían
// del mismo sitio y la pareja cuadraba. Al pasar el normal a salir de la FICHA,
// quedó descuadrada — precio de la ficha contra descuento de la capa— y como él
// escribe los dos importes en la ficha, la oferta dejaba de verse.
//
// Medido en su contenido: SEIS de las siete combinaciones activas enseñaban un
// descuento que no era, o ninguno. Ahora las siete coinciden con el motor.
console.log("\n— y el precio de oferta, igual: la ficha primero —\n");

comprobar(
  "existe el hermano del precio para el descuento",
  /function descuentoDeLaFicha\(/.test(editor),
  "antes solo había precio y «antes» tachado"
);
comprobar(
  "  y lee el importe por país de la ficha",
  /deLaFichaEnElPais\(ficha, "discount_price_soles"\)/.test(editor)
);
comprobar(
  "la etapa de oferta pregunta a la ficha antes que a la capa",
  /const promo =\s*\n\s*descuentoDeLaFicha\(c, "unico", "basico"\) \?\?/.test(editor),
  "es lo que hacía que la oferta dejara de verse"
);
comprobar(
  "en la oferta de dos opciones, el combo lee la del FULL",
  /descuentoDeLaFicha\(c, "full"\) \?\?/.test(editor),
  "igual que el motor"
);
comprobar(
  "  y el básico la del BÁSICO",
  /descuentoDeLaFicha\(c, "basico", "unico"\) \?\?\s*\n\s*profile\?\.discount_price_soles/.test(
    editor
  )
);

// Y EJECUTADO, que es lo que de verdad dice qué número sale.
const conDescuento = {
  name: "CON OFERTA",
  price_soles: 0,
  discount_price_soles: 0,
  precios_por_pais: {
    PE: { price_soles: 20, discount_price_soles: 15 },
    EC: { price_soles: 5.7, discount_price_soles: 4.5 },
  },
};
const cuerpoDescuento = sacar(
  /function descuentoDeLaFicha\(\n[\s\S]*?\): number \| undefined \{\n([\s\S]*?)\n\}/
);
comprobar("se encuentra el código del descuento", !!cuerpoDescuento);
if (cuerpoDescuento) {
  const correrDesc = (pais) =>
    new Function(
      "fichas",
      `const activePreviewCountry = ${JSON.stringify(pais)} ?? undefined;
       const numeroUtil = (valor) =>${sinTipos(cuerpoNumeroUtil)};
       const fichaEnPuesto = (c, puesto) => fichas[puesto];
       function deLaFichaEnElPais(ficha, campo, country = activePreviewCountry) {
${sinTipos(cuerpoDelPais)}
       }
       function descuentoDeLaFicha(c, ...puestos) {
${sinTipos(cuerpoDescuento)}
       }
       return descuentoDeLaFicha({}, "unico");`
    )({ unico: conDescuento });
  comprobar("  en Perú el descuento sale 15", correrDesc("PE") === 15, `sale ${correrDesc("PE")}`);
  comprobar("  en Ecuador sale 4.5", correrDesc("EC") === 4.5, `sale ${correrDesc("EC")}`);
  comprobar(
    "  y en un país sin oferta propia, nada",
    correrDesc("MX") === undefined,
    "no inventa un descuento"
  );
}

console.log(`\n${fallos === 0 ? "TODO EN VERDE" : `${fallos} EN ROJO`}\n`);
process.exit(fallos === 0 ? 0 : 1);
