// Cada modalidad enseña TODAS sus muestras marcadas, no solo las de una caja.
//
// LO QUE PASÓ — 15 de septiembre de 2026, en Doble Oferta + Upsell. El dueño
// marcó el check «sale cuando piden ver el detalle» en sus tres fichas y al
// cliente le llegaba UNA. Su registro lo dijo tres veces seguidas, en tres
// conversaciones en paralelo:
//
//     [wf:muestras] convo 118: mando 1 de 3 — el resto es de otra etapa
//     [wf:muestras] convo 119: mando 1 de 3 — el resto es de otra etapa
//     [wf:muestras] convo 120: mando 1 de 3 — el resto es de otra etapa
//
// Y no era «de otra etapa»: era la muestra del producto BÁSICO, que se está
// vendiendo en esa misma pantalla, al lado del full.
//
// POR QUÉ. Las cajas de muestras se llenan mirando una tabla —qué puesto ocupa
// el hueco 1 de cada modalidad, y cuál el 2—. Pero cuáles se LEÍAN lo decidía
// otra lista, escrita a mano, con el nombre de tres modalidades: Doble Oferta 2
// Productos, Bioferta y Order Bump. Doble Oferta + Upsell nació después y nadie
// la añadió. Su caja 2 se llenaba y no la leía nadie: sin error y sin aviso.
//
// LA MEDICIÓN, con su contenido de verdad, ejecutando el reparto real:
//
//     modalidad              antes      después
//     lineal                 1 de 2     1 de 2      (no se mueve)
//     upsell                 1 de 2     1 de 2      (no se mueve)
//     order_bump             3 de 4     3 de 4      (no se mueve)
//     doble_oferta_dos       1 de 2     1 de 2      (no se mueve)
//     doble_oferta_upsell    1 de 3     2 de 3      <- el arreglo
//     bioferta               1 de 2     1 de 2      (no se mueve)
//
// Las que quedan por debajo del total son las muestras del producto extra, que
// de verdad son de otra etapa y no deben salir mientras el cliente elige.
//
// LO QUE ESTA PRUEBA FIJA: que la decisión salga de la TABLA que llena las
// cajas, y no de una lista de nombres de modalidad escrita a mano. Una lista
// así vuelve a quedarse corta en cuanto nazca la séptima modalidad — que es
// exactamente lo que pasó aquí.
//
//   node scripts/prueba-las-muestras-de-cada-modalidad.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8").replace(/\r\n/g, "\n");
const config = leer("src", "lib", "workflow", "config.ts");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 62)} ${valor}`);
};

// ── 1. LA DECISIÓN VIVE EN UN SOLO SITIO ────────────────────────────────────
console.log("\n— quién decide qué cajas se miran —\n");
comprobar(
  "existe la función que responde por la modalidad",
  /export function cajasDeMuestraDeLaModalidad\(/.test(config),
  "cajasDeMuestraDeLaModalidad"
);

const cuerpo = (() => {
  const i = config.indexOf("export function cajasDeMuestraDeLaModalidad(");
  if (i < 0) return "";
  const f = config.indexOf("\n}", i);
  return f < 0 ? "" : config.slice(i, f);
})();

comprobar("se encuentra su cuerpo", cuerpo.length > 100);
// LA CLAVE DEL ARREGLO: pregunta a la tabla que LLENA las cajas.
// El 22/09/2026 esa lectura pasó a `tablaDeHuecos(modo, config)`, que devuelve
// LA MISMA tabla y además cuenta la presentación prestada. Sigue siendo la tabla
// que llena las cajas — que es lo único que esta prueba defiende.
comprobar(
  "pregunta a la tabla que llena las cajas",
  /tablaDeHuecos\(modo, config\)/.test(cuerpo),
  "no a una lista aparte"
);
comprobar(
  "la caja 2 se lee si la modalidad tiene hueco 2",
  /Object\.values\(tabla\)\.includes\(2\)/.test(cuerpo)
);
// LA MISMA CONDICIÓN CON LA QUE SE ESCRIBE LA CAJA DEL PACK, letra por letra.
// Si una de las dos se mueve sin la otra, vuelve el fallo de la caja fantasma:
// alguien la llena y nadie la lee, o al revés.
comprobar(
  "la del pack usa la condición con la que se escribe",
  /puestosDeLaModalidad\(modo, config\)\.includes\("full"\)/.test(cuerpo) &&
    /tabla\.full === undefined/.test(cuerpo),
  "misma que arriba"
);
const escribeElPack =
  /puestos\.includes\("full"\) && tablaDeHuecos\(modo, config\)\.full === undefined/.test(
    config
  );
comprobar("y esa condición sigue escribiendo la caja", escribeElPack, "pack_gallery");

// LO QUE NO PUEDE VOLVER: decidir por nombre de modalidad escrito a mano.
comprobar(
  "no decide por el nombre de ninguna modalidad",
  !/modo === "(order_bump|bioferta|doble_oferta_dos|doble_oferta_upsell|lineal|upsell)"/.test(
    cuerpo
  ),
  "la séptima quedaría fuera otra vez"
);

// ── 2. Y EL LECTOR DE GALERÍAS LA USA, SIN QUITAR NADA ──────────────────────
console.log("\n— y la galería la usa, sumando, nunca quitando —\n");
// EL FINAL DE LA FUNCION SE BUSCA POR LA FUNCION, NO POR SU ULTIMA LINEA.
// Estaba anclado al texto `return [...base, ...second, ...pack];`, y el
// 17/09/2026 ese return se cambio para ORDENAR las muestras (basico primero, el
// full al final). La extraccion se quedo sin ancla y cuatro comprobaciones de
// aqui abajo se cayeron de golpe, sin que nada de lo que protegen hubiera
// cambiado. Se busca el cierre de la funcion y ya no depende de como termine.
const galeria = (() => {
  const i = config.indexOf("export function getImageGallery(");
  if (i < 0) return "";
  const f = config.indexOf("\n}", i);
  return f < 0 ? "" : config.slice(i, f);
})();
comprobar("se encuentra getImageGallery", galeria.length > 300);
comprobar(
  "le pregunta a la función",
  /cajasDeMuestraDeLaModalidad\(cfg\)/.test(galeria)
);
comprobar(
  "la caja 2 se suma a lo de antes",
  /cajasDeLaModalidad\.segunda \|\|/.test(galeria),
  "un || , no un reemplazo"
);
comprobar(
  "la del pack también",
  /cajasDeLaModalidad\.pack \|\|/.test(galeria),
  "un || , no un reemplazo"
);
// LAS TRES BANDERAS DE ANTES SIGUEN EN PIE. Eran ciertas donde lo eran, y hay
// instalaciones que no usan el reparto por fichas y llenan esas cajas a mano:
// quitarlas las dejaría sin muestras. Esto solo puede AÑADIR una caja.
for (const bandera of [
  "doble_oferta_dos",
  "bioferta_doble",
  "order_bump",
]) {
  comprobar(
    `sigue en pie la bandera de ${bandera}`,
    new RegExp(`cfg\\?\\.${bandera}\\?\\.enabled`).test(galeria),
    "no se quitó nada"
  );
}

// ── 3. LO QUE SIGUE SIENDO «DE OTRA ETAPA», Y ESTÁ BIEN ─────────────────────
console.log("\n— y lo del producto extra sigue esperando su turno —\n");
// El producto extra tiene su galería propia y no se enseña mientras el cliente
// elige. Eso no es el fallo: es la regla. Si esto se cayera, el bot enseñaría
// el tercer producto antes de la venta.
comprobar(
  "con el extra en oferta, la galería es la suya",
  /const enOferta =\s*\n?\s*convo\?\.upsell_state === "ofrecido" \|\| convo\?\.upsell_state === "aceptado";/.test(
    galeria
  )
);
comprobar(
  "el order bump diferido sigue tapando el 2º producto",
  /if \(excludeSecondProduct\) return base;/.test(galeria),
  "ni precio ni contenido antes de tiempo"
);

console.log(
  fallos === 0
    ? "\nTODO OK — cada modalidad enseña las muestras que tiene marcadas\n"
    : `\n${fallos} comprobacion(es) mal.\n`
);
process.exit(fallos === 0 ? 0 : 1);
