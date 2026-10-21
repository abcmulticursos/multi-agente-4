// El upsell de Doble Oferta + Upsell es el que el dueno eligio en la alineacion.
//
// LO QUE PASO — 15 de septiembre de 2026
//
//   Puso un producto de S/.8 como upsell y en -DOU- le llegaba el contenido y
//   el precio de OTRO producto, de S/.3000, que era el que habia ahi de una
//   configuracion anterior. Con sus palabras: «¿por que no esta llegando el
//   contenido […] y de donde esta llegando el contenido equivocado?».
//
// POR QUE
//
//   Hay DOS cajas de upsell, y `seccionUpsell` tiene UNA linea que se sale del
//   camino comun:
//
//       if (key === "doble_oferta_upsell") return cfg.doble_oferta_upsell?.upsell;
//       ...
//       return cfg.upsell;
//
//   Las otras cinco modalidades caen en el `return` de abajo y leen la caja que
//   el reparto llena. -DOU- lee la SUYA, y a esa no la llenaba nadie: se
//   quedaba con el producto de antes, callada, y el motor la creia.
//
//   Es el mismo fallo que dejo vacios los comodines de -DOU- y que dejo fuera
//   la muestra del full: una caja que el reparto no llena, y el motor leyendola.
//
//   node scripts/prueba-el-upsell-de-dou-es-el-que-eligio.mjs
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
const trozo = (desde, hasta) => {
  const i = config.indexOf(desde);
  if (i < 0) return "";
  const f = config.indexOf(hasta, i);
  return f < 0 ? config.slice(i) : config.slice(i, f);
};

const reparto = trozo(
  "export function repartirPorEtiqueta(",
  "export function loadWorkflowConfig("
);
comprobar("se encuentra el reparto", reparto.length > 0, "repartirPorEtiqueta");

// ── 1. LAS DOS CAJAS SE LLENAN DE LA MISMA FICHA ─────────────────────────────
console.log("\n— el producto se escribe en las dos cajas —\n");
comprobar(
  "lo del producto se arma una sola vez",
  /const loDelProducto = \{/.test(reparto),
  "una fuente, dos destinos"
);
comprobar(
  "y se escribe en cfg.upsell, como siempre",
  /next\.upsell = \{ \.\.\.\(next\.upsell \?\? \{\}\), \.\.\.loDelProducto \};/.test(
    reparto
  ),
  "las otras cinco modalidades"
);
comprobar(
  "y TAMBIEN en la caja que lee -DOU-",
  /upsell: \{\s*\.\.\.\(next\.doble_oferta_upsell\.upsell \?\? \{\}\),\s*\.\.\.loDelProducto,\s*\},/.test(
    reparto
  ),
  "la que faltaba"
);
comprobar(
  "las dos salen de quien juega de upsell",
  /const upsell = enPuesto\("upsell"\);/.test(reparto) &&
    /if \(hayPuesto\("upsell"\)\) \{/.test(reparto),
  "de la alineacion, no del codigo"
);

// ── 2. EL GUION DE LA ETAPA NO SE TOCA ───────────────────────────────────────
//
// La etapa tiene lo suyo —las burbujas con las que se ofrece, los botones, la
// pregunta del final, el texto de rechazo y los minutos de espera— y eso es del
// guion, no del producto. Cambiar de producto no puede reiniciar nada de eso.
console.log("\n— y el guion de la etapa se conserva entero —\n");
const campos = [
  "name",
  "aliases",
  "price_soles",
  "discount_price_soles",
  "market_price",
  "image_gallery",
  "course_content",
  "delivery",
];
const loQueEscribe = trozo("const loDelProducto = {", "};");
for (const campo of campos) {
  comprobar(
    `copia «${campo}»`,
    new RegExp(`\\b${campo}:`).test(loQueEscribe),
    "del producto"
  );
}
for (const intocable of [
  "intro",
  "intro_groups",
  "pregunta_steps",
  "use_buttons",
  "boton_si",
  "boton_no",
  "retraso_minutos",
  "enabled",
]) {
  comprobar(
    `NO toca «${intocable}»`,
    !new RegExp(`\\b${intocable}:`).test(loQueEscribe),
    "es de la etapa"
  );
}
comprobar(
  "y se escribe campo a campo, no de un volcado",
  /\.\.\.\(next\.doble_oferta_upsell\.upsell \?\? \{\}\)/.test(reparto),
  "lo de antes se conserva"
);

// ── 3. LA LINEA QUE OBLIGA A TODO ESTO SIGUE AHI ─────────────────────────────
console.log("\n— y el lector no ha cambiado —\n");
comprobar(
  "-DOU- lee su propia caja",
  /if \(key === "doble_oferta_upsell"\) return cfg\.doble_oferta_upsell\?\.upsell \?\? null;/.test(
    config
  ),
  "por eso hay que llenarla"
);
comprobar(
  "y las demas leen la de siempre",
  /return cfg\.upsell \?\? null;/.test(config),
  "esa no se toca"
);
comprobar(
  "sin seccion de -DOU- no se escribe nada",
  /if \(next\.doble_oferta_upsell\) \{/.test(reparto),
  "no se inventa la caja"
);

// ── 4. Nada de productos en el codigo ────────────────────────────────────────
comprobar(
  "el arreglo no nombra ningun producto ni precio",
  !/3000|pantonera|mockup/i.test(reparto),
  "sale de la ficha"
);

console.log(
  fallos === 0
    ? "\nTODO OK — en -DOU- el upsell es el que el eligio"
    : `\n${fallos} comprobacion(es) mal.`
);
process.exit(fallos === 0 ? 0 : 1);
