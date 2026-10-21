// LAS MUESTRAS SALEN EN ORDEN: BASICO, COMPLEMENTARIO, Y EL FULL AL FINAL.
//
// LO QUE PIDIO EL DUEÑO — 17 de septiembre de 2026, con sus palabras:
//
//     «El bot debe enviar en orden las imagenes siempre arrancando desde el
//      BASICO, si hay un COMPLEMENTARIO sigue ese, y si hay un FULL que
//      complemente esto —como en el caso de OB— que aparezca AL ULTIMO.»
//
// POR QUE HACIA FALTA. Las tres cajas salian siempre en el mismo orden —la del
// hueco 1, la del hueco 2, la del pack— y QUIEN ocupa cada hueco cambia con la
// modalidad. En Order Bump y en Bioferta el hueco 1 es el basico, asi que ya
// salia bien. Pero en las DOS Doble Oferta el hueco 1 es el FULL —lo dice
// `CONTENIDO_DEL_PUESTO`, y la pestaña del editor tambien: ahi el «Producto 1» es
// el mas caro— y las muestras salian al reves: primero el combo y despues el
// basico. Enseñar primero lo caro es empezar la presentacion por el final.
//
// NO SE ORDENA POR MODALIDAD, y es a proposito. Una lista de modalidades escrita
// a mano es el fallo que ya costo tres veces esta semana: siempre se olvida una.
// Se pregunta por el DATO —que puesto ocupa cada caja— y el orden sale solo en
// las seis, hoy y cuando el dueño cambie la alineacion.
//
//   node scripts/prueba-el-orden-de-las-muestras.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const fuente = readFileSync(
  join(RAIZ, "src", "lib", "workflow", "config.ts"),
  "utf8"
).replace(/\r\n/g, "\n");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 54)} ${valor}`);
};

const galeria = (() => {
  const i = fuente.indexOf("export function getImageGallery(");
  if (i < 0) return "";
  const f = fuente.indexOf("\n}", i);
  return f < 0 ? "" : fuente.slice(i, f + 2);
})();

// ── 1. LA REGLA ESTA ESCRITA, Y ESTA ESCRITA UNA SOLA VEZ ───────────────────
console.log("\n— el orden lo manda el puesto, no la caja —\n");
comprobar("se encuentra el armado de la galería", galeria.length > 300);
comprobar(
  "hay un rango por puesto, en un solo sitio",
  /const RANGO_DEL_PUESTO: Partial<Record<PuestoDeProducto, number>> = \{[\s\S]{0,200}?basico: 1,[\s\S]{0,200}?unico: 1,[\s\S]{0,200}?complementario: 2,[\s\S]{0,200}?full: 3,/.test(
    galeria
  ),
  "básico, complementario, full"
);
// El 22/09/2026 esa lectura pasó a `tablaDeHuecos(...)`: la MISMA tabla,
// contando además la presentación prestada. Lo que se defiende aquí no cambia:
// el puesto sale de la tabla, nunca de una lista escrita a mano.
comprobar(
  "el puesto de cada caja se pregunta a la tabla",
  /tablaDeHuecos\(activeModalityKey\(cfg\), cfg\)/.test(galeria),
  "no se escribe a mano"
);
comprobar(
  "y el pack cierra con el rango del full",
  /orden: RANGO_DEL_PUESTO\.full \?\? 3, muestras: pack/.test(galeria),
  "el pack es del full"
);
comprobar(
  "se ordena y se aplana, sin perder ninguna",
  /\.sort\(\(una, otra\) => una\.orden - otra\.orden\)\s*\n?\s*\.flatMap\(\(caja\) => caja\.muestras\);/.test(
    galeria
  ),
  "mismas muestras, otro orden"
);
comprobar(
  "un puesto desconocido va al final, no delante",
  /\?\? 9;/.test(galeria),
  "no se cuela nadie"
);
// NINGUNA MODALIDAD SE NOMBRA AL ORDENAR. Es la condición que impide que esto se
// convierta en la lista que se olvida de una.
const trozoDelOrden = galeria.slice(galeria.indexOf("RANGO_DEL_PUESTO"));
comprobar(
  "y no se nombra ninguna modalidad al ordenar",
  !/doble_oferta|order_bump|bioferta|lineal/.test(trozoDelOrden),
  "se pregunta por el dato"
);

// ── 2. EL ORDEN QUE SALE EN CADA MODALIDAD, CORRIDO DE VERDAD ───────────────
//
// Se leen del archivo la tabla de puestos y la lista de puestos por modalidad, y
// se aplica la misma regla. Si mañana alguien cambia la tabla, esto lo canta.
console.log("\n— y así queda en las seis modalidades —\n");
const tabla = (() => {
  const i = fuente.indexOf("const CONTENIDO_DEL_PUESTO");
  const bloque = fuente.slice(i, fuente.indexOf("};", i) + 2);
  const out = {};
  for (const linea of bloque.split("\n")) {
    const m = /^\s*([a-z_]+):\s*\{([^}]*)\}/.exec(linea);
    if (!m) continue;
    const asignaciones = {};
    for (const par of m[2].split(",")) {
      const p = /([a-z]+):\s*([12])/.exec(par);
      if (p) asignaciones[p[1]] = Number(p[2]);
    }
    if (Object.keys(asignaciones).length) out[m[1]] = asignaciones;
  }
  return out;
})();
const puestosDeLaModalidad = (() => {
  const k = fuente.indexOf("export function puestosDeLaModalidad");
  let nivel = 0;
  let fin = k;
  let abierto = false;
  for (let p = k; p < fuente.length; p++) {
    if (fuente[p] === "{") {
      nivel++;
      abierto = true;
    } else if (fuente[p] === "}") {
      nivel--;
      if (abierto && nivel === 0) {
        fin = p + 1;
        break;
      }
    }
  }
  // SE LE QUITAN LOS TIPOS PARA PODERLA CORRER. Antes era un solo reemplazo
  // porque la firma cabía en una línea; el 22/09/2026 gano un segundo parametro
  // —la configuracion, para contar la presentacion prestada— y pasó a varias.
  // Se quitan los tipos uno a uno, que aguanta que la firma se siga moviendo.
  //
  // Se la llama SIN configuracion, asi que la rama de lo prestado no se ejecuta
  // y no hace falta traerse `activeModalityKey` ni `segundaOpcionPrestada`.
  const sinTipos = fuente
    .slice(k, fin)
    .replace("export function", "function")
    .replace(/modo:\s*string/, "modo")
    .replace(/config\?:\s*WorkflowConfig \| null/, "config")
    .replace(/\):\s*PuestoDeProducto\[\]/, ")");
  return new Function(`${sinTipos}\nreturn puestosDeLaModalidad;`)();
})();
const RANGO = { basico: 1, unico: 1, complementario: 2, full: 3 };
const ordenDe = (modo) => {
  const t = tabla[modo] ?? {};
  const delHueco = (h) => Object.keys(t).find((p) => t[p] === h);
  const tienePack =
    puestosDeLaModalidad(modo).includes("full") && t.full === undefined;
  return [
    { orden: RANGO[delHueco(1)] ?? 9, quien: delHueco(1) },
    { orden: RANGO[delHueco(2)] ?? 9, quien: delHueco(2) },
    ...(tienePack ? [{ orden: RANGO.full, quien: "full" }] : []),
  ]
    .filter((c) => c.quien)
    .sort((a, b) => a.orden - b.orden)
    .map((c) => c.quien);
};
for (const [modo, esperado] of [
  ["lineal", "unico"],
  ["upsell", "unico"],
  ["order_bump", "basico → complementario → full"],
  ["bioferta", "basico → complementario → full"],
  ["doble_oferta_dos", "basico → full"],
  ["doble_oferta_upsell", "basico → full"],
]) {
  const salida = ordenDe(modo).join(" → ");
  comprobar(`${modo}`, salida === esperado, salida);
}
// LA REGLA DEL DUEÑO, EN UNA LINEA: ninguna modalidad puede empezar por el full.
for (const modo of Object.keys(tabla)) {
  const primero = ordenDe(modo)[0];
  comprobar(
    `${modo}: no empieza por el full`,
    primero === "basico" || primero === "unico",
    `empieza por «${primero}»`
  );
}

// ── 3. LO QUE NO SE PUEDE HABER ROTO ────────────────────────────────────────
console.log("\n— y lo de antes sigue en pie —\n");
comprobar(
  "el producto extra sigue oculto hasta que se ofrece",
  /const enOferta =\s*\n?\s*convo\?\.upsell_state === "ofrecido" \|\| convo\?\.upsell_state === "aceptado";/.test(
    galeria
  ),
  "y devuelve solo la suya"
);
comprobar(
  "el order bump diferido sigue excluyendo el 2º producto",
  /if \(excludeSecondProduct\) return base;/.test(galeria),
  "antes de mirar nada más"
);
comprobar(
  "las cajas se siguen eligiendo igual que antes",
  /const cajasDeLaModalidad = cajasDeMuestraDeLaModalidad\(cfg\);/.test(galeria),
  "esto solo reordena, no filtra"
);
// MISMAS MUESTRAS, OTRO ORDEN: si esto dejara de sumar las tres cajas, estaríamos
// escondiendo muestras en vez de ordenarlas.
comprobar(
  "y se siguen sumando las tres cajas",
  /muestras: base/.test(galeria) &&
    /muestras: second/.test(galeria) &&
    /muestras: pack/.test(galeria),
  "ninguna se queda fuera"
);

console.log(
  fallos === 0
    ? "\nTODO OK — básico primero, el full al final, en las seis\n"
    : `\n${fallos} comprobacion(es) mal.\n`
);
process.exit(fallos === 0 ? 0 : 1);
