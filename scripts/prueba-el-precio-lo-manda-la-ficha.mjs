// EL PRECIO LO MANDA LA FICHA DEL PRODUCTO, PAÍS POR PAÍS.
//
// LO QUE PIDIÓ EL DUEÑO — 17 de septiembre de 2026, con sus palabras:
//
//   «Que cada producto tenga su precio fijado y que al activarlo respete ese
//    precio como PRIORIDAD sobre el precio de la sección precios y pagos
//    (básico, full y upsell).»
//
//   «Los precios iguales para cada modalidad de acuerdo al país.»
//
//   «Jamás deben tener precios de otro país ya que son monedas y montos
//    distintos. El precio universal para todos es una locura, y el reemplazo
//    también.»
//
// QUÉ ESTABA MAL. El precio del puesto vivía en la capa del país de CADA
// modalidad, y la ficha quedaba de respaldo. Así que al cambiar qué producto
// juega de básico, el precio se quedaba con el PUESTO y no con el producto: se
// seguía cobrando el del anterior. Y los tres campos «todos los países» eran UN
// número para siete monedas distintas.
//
// ESTA PRUEBA EJECUTA EL CÓDIGO REAL, sacado del fuente, con productos
// inventados — nunca los suyos, que es la regla de la casa.
//
//   node scripts/prueba-el-precio-lo-manda-la-ficha.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const cfgSrc = readFileSync(join(RAIZ, "src", "lib", "workflow", "config.ts"), "utf8").replace(/\r\n/g, "\n");
const editor = readFileSync(join(RAIZ, "src", "app", "editor", "page.tsx"), "utf8").replace(/\r\n/g, "\n");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// ── Se extrae la función REAL y se ejecuta ──────────────────────────────────
// OJO CON EL TIPO DE RETORNO. Esta función devuelve un objeto anotado —`): {
// precio?: number; ... } {`— así que el primer `{` después de los paréntesis NO
// es el cuerpo: es el tipo. Contar llaves desde ahí devolvía la cabecera sola,
// sin una línea de código dentro, y la prueba «pasaba» sin ejecutar nada.
function sacar(fuente, nombre) {
  const i = fuente.indexOf(`export function ${nombre}(`);
  if (i < 0) throw new Error(`no encuentro ${nombre}`);
  const cierraParams = fuente.indexOf(")", fuente.indexOf("(", i));
  let abre = fuente.indexOf("{", cierraParams);
  // Si entre `)` y el primer `{` solo hay `:` y espacios, ese `{` es el tipo de
  // retorno: se salta entero y el cuerpo es el siguiente.
  if (/^\)\s*:\s*$/.test(fuente.slice(cierraParams, abre))) {
    let n = 0;
    for (let k = abre; k < fuente.length; k++) {
      if (fuente[k] === "{") n++;
      else if (fuente[k] === "}") {
        n--;
        if (n === 0) {
          abre = fuente.indexOf("{", k + 1);
          break;
        }
      }
    }
  }
  let nivel = 0;
  for (let k = abre; k < fuente.length; k++) {
    if (fuente[k] === "{") nivel++;
    else if (fuente[k] === "}") {
      nivel--;
      if (nivel === 0) {
        const trozo = fuente.slice(i, k + 1);
        if (!trozo.includes("return")) {
          throw new Error(`saqué ${nombre} sin cuerpo — revisa el extractor`);
        }
        return trozo;
      }
    }
  }
  throw new Error(`no cierra ${nombre}`);
}

const cuerpo = sacar(cfgSrc, "preciosDeLaFichaEnElPais")
  .replace(/^export /, "")
  .replace(/:\s*PuestoDeProducto/g, "")
  .replace(/:\s*string \| null \| undefined/g, "")
  .replace(/:\s*WorkflowConfig \| null/g, "")
  .replace(/\)\s*:\s*\{[^}]*\}\s*\{/, ") {")
  .replace(/:\s*number \| undefined/g, "")
  .replace(/:\s*unknown/g, "")
  // La oferta de la fila (upsells en fila, fase 3): aquí no se pasa nunca.
  .replace(/:\s*OfertaDeLaFila \| null/g, "")
  // Los parámetros opcionales de TypeScript (`config?`) no existen en JS.
  .replace(/(\w)\?(\s*[,)])/g, "$1$2");

// EL AYUDANTE QUE DICE QUE PRODUCTOS JUEGAN, tambien extraido del codigo real.
//
// El 02/10/2026 `preciosDeLaFichaEnElPais` dejo de leer `alineacion_por_modalidad` a pelo
// y paso a preguntar a `laAlineacionQueJuega` — porque leyendola a pelo se saltaba la
// tienda, y el bot daba el NOMBRE de un producto con el PRECIO de otro. Aqui se trae el
// ayudante de verdad, no una copia: una copia probaria lo que uno cree que hace.
//
// Sin tienda en el turno, `tiendaDelTurno.getStore()` devuelve undefined y el ayudante cae
// en la alineacion de la modalidad — que es lo que esta prueba mide.
const ayudante = sacar(cfgSrc, "laAlineacionQueJuega")
  .replace(/^export /, "")
  .replace(/config:\s*WorkflowConfig \| null \| undefined/, "config")
  .replace(/modo\?:\s*string/, "modo")
  .replace(/\)\s*:\s*Record<string, string> \| undefined\s*\{/, ") {");

const { preciosDeLaFichaEnElPais } = new Function(
  `const loadWorkflowConfig = () => null;
   const activeModalityKey = (cfg) => cfg.__modo;
   const tiendaDelTurno = { getStore: () => undefined };
   ${ayudante}
   ${cuerpo}
   return { preciosDeLaFichaEnElPais };`
)();

// Nombres y montos inventados a propósito: una prueba con sus productos reales
// tapa justo el fallo que la regla de la casa evita.
const config = {
  __modo: "doble_oferta_upsell",
  alineacion_por_modalidad: {
    doble_oferta_upsell: { basico: "p-uno", full: "p-dos", upsell: "p-tres" },
    order_bump: { basico: "p-uno", complementario: "p-cuatro", full: "p-dos" },
  },
  biblioteca_de_productos: [
    {
      id: "p-uno",
      name: "PRODUCTO UNO",
      precios_por_pais: {
        PE: { price_soles: 11, discount_price_soles: 7, market_price: 40 },
        AR: { price_soles: 9000 },
      },
    },
    { id: "p-dos", name: "PRODUCTO DOS", precios_por_pais: { PE: { price_soles: 19 } } },
    { id: "p-tres", name: "PRODUCTO TRES", precios_por_pais: { PE: { price_soles: 31 } } },
    { id: "p-cuatro", name: "PRODUCTO CUATRO" },
  ],
};

// ── 1. CADA PAÍS EL SUYO, Y NINGUNO HEREDA DEL OTRO ────────────────────────
console.log("\n— cada país lleva el suyo, sin heredar de nadie —\n");
comprobar(
  "el básico en Perú da su precio",
  preciosDeLaFichaEnElPais("basico", "PE", config).precio === 11,
  String(preciosDeLaFichaEnElPais("basico", "PE", config).precio)
);
comprobar(
  "y en Argentina da OTRO, no el de Perú",
  preciosDeLaFichaEnElPais("basico", "AR", config).precio === 9000,
  "monedas distintas"
);
comprobar(
  "un país sin precio propio NO hereda",
  preciosDeLaFichaEnElPais("basico", "MX", config).precio === undefined,
  "«jamás el precio de otro país»"
);
comprobar(
  "y en minúsculas también lo encuentra",
  preciosDeLaFichaEnElPais("basico", "pe", config).precio === 11,
  "el código de país no distingue mayúsculas"
);

// ── 2. EL PRECIO VIAJA CON EL PRODUCTO ─────────────────────────────────────
//
// Es el fallo que motivó todo: al cambiar quién juega de básico, el importe se
// quedaba con el puesto y se cobraba el del producto anterior.
console.log("\n— y el precio viaja con el producto, no con el puesto —\n");
comprobar(
  "el full da el suyo, no el del básico",
  preciosDeLaFichaEnElPais("full", "PE", config).precio === 19,
  "19, no 11"
);
const cambiado = {
  ...config,
  alineacion_por_modalidad: {
    ...config.alineacion_por_modalidad,
    doble_oferta_upsell: { basico: "p-dos", full: "p-uno", upsell: "p-tres" },
  },
};
comprobar(
  "al intercambiarlos, los precios se intercambian solos",
  preciosDeLaFichaEnElPais("basico", "PE", cambiado).precio === 19 &&
    preciosDeLaFichaEnElPais("full", "PE", cambiado).precio === 11,
  "sin tocar Precios y pagos"
);

// ── 3. EL UPSELL, QUE ES EL QUE NO SE OFRECÍA ──────────────────────────────
console.log("\n— y el upsell lee de su ficha —\n");
comprobar(
  "el upsell da el precio de su ficha",
  preciosDeLaFichaEnElPais("upsell", "PE", config).precio === 31,
  "sin precio no se ofrece: por eso importa"
);

// ── 4. LO QUE NO CONTESTA, PARA QUE EL DE ANTES SIGA MANDANDO ──────────────
//
// Si la ficha no tiene número, esta función calla y el que llama sigue con la
// capa del país y su respaldo. Quien no use las fichas no nota nada.
console.log("\n— y calla cuando no le toca, para no pisar nada —\n");
comprobar(
  "un producto sin precios no contesta",
  preciosDeLaFichaEnElPais("complementario", "PE", {
    ...config,
    __modo: "order_bump",
  }).precio === undefined,
  "sigue mandando lo de siempre"
);
comprobar(
  "un puesto que nadie ocupa no contesta",
  preciosDeLaFichaEnElPais("unico", "PE", config).precio === undefined
);
comprobar(
  "sin país no contesta",
  preciosDeLaFichaEnElPais("basico", null, config).precio === undefined
);
// UN CERO NO ES «GRATIS», ES «SIN PONER». Si se leyera como precio, el bot
// cobraría 0 y entregaría — y eso no da error en ninguna parte.
comprobar(
  "un 0 se lee como «sin poner», nunca como gratis",
  preciosDeLaFichaEnElPais("basico", "PE", {
    ...config,
    biblioteca_de_productos: [
      { id: "p-uno", precios_por_pais: { PE: { price_soles: 0 } } },
    ],
  }).precio === undefined,
  "cae a lo de siempre"
);

// ── 5. Y LA CONSULTAN TODOS LOS SITIOS QUE COBRAN ──────────────────────────
//
// Un sitio que se olvide de preguntar cobra distinto que los demás, y eso no da
// error: cobra de menos y entrega lo que no es.
console.log("\n— y la consultan TODOS los sitios que resuelven un precio —\n");
for (const [sitio, patron] of [
  ["el precio único (lineal)", /const deLaFicha = \(\(\) => \{\s*\n\s*const unico = preciosDeLaFichaEnElPais\("unico", country, config\);/],
  ["la opción combo (full)", /const deLaFicha = preciosDeLaFichaEnElPais\("full", country, config\);/],
  ["la opción básico", /const deLaFichaBasico = preciosDeLaFichaEnElPais\("basico", country, config\);/],
  ["el upsell", /const deLaFicha = preciosDeLaFichaEnElPais\(\s*\n?\s*"upsell",/],
  ["el tachado del base", /const tachadoDeLaFicha = \(\(\) => \{/],
  ["el tachado del full", /preciosDeLaFichaEnElPais\("full", country\)\.tachado \?\?/],
  ["el tachado del upsell", /preciosDeLaFichaEnElPais\("upsell", country\)\.tachado \?\?/],
]) {
  comprobar(`la consulta ${sitio}`, patron.test(cfgSrc));
}
// Y VA PRIMERO, no detrás: si fuera detrás seguiría mandando el país.
comprobar(
  "y va DELANTE del precio del país",
  /const countryPrice =\s*\n\s*deLaFicha\.precio \?\?/.test(cfgSrc) &&
    /const regular =\s*\n\s*deLaFicha\.precio \?\?/.test(cfgSrc) &&
    /const regular =\s*\n\s*deLaFichaBasico\.precio \?\?/.test(cfgSrc),
  "prioridad, no respaldo"
);

// ── 6. LA FICHA GUARDA EN EL PRODUCTO, Y LOS CAMPOS GLOBALES SE FUERON ─────
console.log("\n— y el editor guarda en el producto —\n");
comprobar(
  "los campos escriben en biblioteca_de_productos",
  /onEdit\("biblioteca_de_productos"\);/.test(editor) &&
    /precios_por_pais: \{/.test(editor),
  "ya no en modality_payment_profiles"
);
comprobar(
  "ya no existen los tres campos «TODOS los países»",
  !/Precio · TODOS los países/.test(editor) &&
    !/Con descuento · TODOS/.test(editor) &&
    !/Antes \/ tachado · TODOS/.test(editor),
  "un respaldo entre monedas distintas cobra mal"
);
comprobar(
  "y todos los productos llevan sus precios, jueguen o no",
  /\{onCfg && \(\s*\n\s*<PreciosDelProductoPorPais/.test(editor),
  "también el complementario, por si lo asciende"
);

console.log(`\n${fallos === 0 ? "TODO EN VERDE" : `${fallos} EN ROJO`}\n`);
process.exit(fallos === 0 ? 0 : 1);
