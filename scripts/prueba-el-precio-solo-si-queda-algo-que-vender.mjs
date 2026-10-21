// EL PRECIO SOLO VIAJA SI QUEDA ALGO QUE VENDER.
//
// LO QUE PASO — 24 de septiembre de 2026, contado por el dueño con su registro
// delante. Compro el curso, el bot le ofrecio el regalo, el pregunto «cuanto
// cuesta» y el bot le contesto el precio del producto que ACABABA DE PAGAR:
//
//     «El precio es de S/. 20 Soles. ¿Te gustaria que te indique como
//      adquirirlo?»
//
// Y con su «ok» —que contestaba a esa pregunta de venta— acepto el REGALO sin
// querer, porque el motor estaba esperando un si/no del regalo. Dos preguntas
// abiertas a la vez, y la respuesta se fue a la que no era.
//
// LA CAUSA, medida en el propio prompt: al modelo le llegaban DOS ordenes
// contrarias en la misma peticion.
//
//     POST-SALE SUPPORT MODE: ...already paid... Do NOT ... quote prices...
//     EFFECTIVE PRICE FOR THIS CUSTOMER: S/. 20. This is the ONLY price you
//     must quote WHEN THEY ASK HOW MUCH IT COSTS.
//
// El escribio exactamente «cuanto cuesta». La segunda es mas concreta y coincide
// palabra por palabra, asi que gano. No es que el modelo desobedeciera: se le
// dio el dato Y la orden de usarlo.
//
// Y LA OTRA CONVERSACION ACERTO POR CASUALIDAD: alli pregunto antes «y esto», el
// modelo explico que era el regalo, y «precio» ya no disparo esa orden. Mismo
// estado, mismo guion, distinto orden de preguntas.
//
// LA REGLA, Y NO MIRA LA MODALIDAD. Se pregunta por el DATO: ¿queda algo con
// precio esperando a este cliente? Asi da igual que el mueva el selector entre
// un producto, «COMO -DOU-» y «COMO -OB-» — sus palabras: «yo en cualquier
// momento cambio de como lineal a como ob o a como dou, no quiero que haya esto
// ni se bloquee algo, quiero que todo sea coherente».
//
// LO QUE NO PUEDE ROMPERSE — y es casi todo:
//
//   1. ANTES DE COMPRAR el precio viaja SIEMPRE, igual que toda la vida.
//   2. CON LA ETAPA UPSELL VIVA tambien: queda un producto por vender.
//   3. SI PUEDE SUBIR de la opcion barata a la cara, tambien.
//   4. Lo UNICO que cambia: ya compro y no queda nada en venta.
//
//   node scripts/prueba-el-precio-solo-si-queda-algo-que-vender.mjs
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { readFileSync } from "node:fs";

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

// La decision vive en `config.ts`, con sus vecinas y no en el cerebro: asi se
// puede EJECUTAR aqui. `openrouter.ts` arrastra medio proyecto y sus pruebas lo
// leen como texto.
const motor = await import(
  pathToFileURL(join(RAIZ, "src", "lib", "workflow", "config.ts")).href
);
const { precioDeLoQueQuedaEnVenta } = motor;

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 56)} ${valor}`);
};

const ETIQUETA = "S/. 20 Soles";
const pedir = (extra) =>
  precioDeLoQueQuedaEnVenta({
    isPostSale: false,
    quedaElUpsell: false,
    yaEligioLaBarata: false,
    hayOfertaDeDos: false,
    etiqueta: ETIQUETA,
    ...extra,
  });

// -- 1. ANTES DE COMPRAR, EL PRECIO VIAJA SIEMPRE ----------------------------
//
// Es la mitad que no se puede tocar: la venta normal, en las tres formas del
// selector. Aqui no cambia absolutamente nada respecto a antes.
console.log("\n-- 1. antes de comprar, viaja siempre ----------------------");
comprobar(
  "vendiendo un producto",
  pedir({}) === ETIQUETA,
  "como toda la vida"
);
comprobar(
  "vendiendo dos opciones",
  pedir({ hayOfertaDeDos: true }) === ETIQUETA,
  "el bloque de las dos lo pisa despues"
);
comprobar(
  "y aunque ya haya elegido la barata",
  pedir({ hayOfertaDeDos: true, yaEligioLaBarata: true }) === ETIQUETA,
  "sigue sin pagar"
);

// -- 2. YA COMPRO, PERO QUEDA ALGO EN VENTA ----------------------------------
console.log("\n-- 2. ya compro, pero queda algo --------------------------");
comprobar(
  "queda la etapa upsell",
  pedir({ isPostSale: true, quedaElUpsell: true }) === ETIQUETA,
  "hay un segundo producto"
);
comprobar(
  "puede subir de la barata a la cara",
  pedir({
    isPostSale: true,
    hayOfertaDeDos: true,
    yaEligioLaBarata: true,
  }) === ETIQUETA,
  "el upgrade sigue abierto"
);

// -- 3. YA COMPRO Y NO QUEDA NADA: NO VIAJA NINGUN PRECIO --------------------
//
// EL UNICO CASO QUE CAMBIA. Es el suyo: compro, la etapa upsell esta vacia y el
// regalo es gratis. No habia nada con precio, y aun asi se le entregaba uno.
console.log("\n-- 3. ya compro y no queda nada ---------------------------");
comprobar(
  "no se le entrega ningun precio",
  pedir({ isPostSale: true }) === null,
  "nada que cotizar"
);
comprobar(
  "ni habiendo elegido la cara",
  pedir({ isPostSale: true, hayOfertaDeDos: true, yaEligioLaBarata: false }) ===
    null,
  "ya se llevo la de arriba"
);
comprobar(
  "ni con oferta de dos pero sin haber elegido la barata",
  pedir({ isPostSale: true, hayOfertaDeDos: true }) === null,
  "no hay a que subir"
);

// -- 4. Y NO PREGUNTA POR LA MODALIDAD ---------------------------------------
//
// EL CANDADO DEL DUEÑO: el cambia el selector cuando quiere. Si esta funcion
// nombrara una modalidad, habria que acordarse de ella en cada cambio.
console.log("\n-- 4. no pregunta por la modalidad ------------------------");
const fuente = readFileSync(join(RAIZ, "src", "lib", "openrouter.ts"), "utf8");
const cfgSrc = readFileSync(
  join(RAIZ, "src", "lib", "workflow", "config.ts"),
  "utf8"
);
const desde = cfgSrc.indexOf("export function precioDeLoQueQuedaEnVenta");
const cuerpo = cfgSrc.slice(desde, cfgSrc.indexOf("\n}", desde));
comprobar(
  "no nombra lineal, -OB- ni -DOU-",
  !/"lineal"|"order_bump"|"doble_oferta/.test(cuerpo),
  "solo mira los datos"
);
comprobar(
  "y el cerebro le pasa el upsell por el mismo sitio que lo ofrece",
  /quedaElUpsell: isUpsellUsable\(loadWorkflowConfig\(\)\)/.test(fuente),
  "isUpsellUsable, una sola verdad"
);
comprobar(
  "el precio solo se añade si hay algo que vender",
  /if \(precioEnVenta\) \{\s*add\(`\\n\\nEFFECTIVE PRICE/.test(fuente),
  "sin venta, sin precio"
);

console.log(
  fallos === 0
    ? "\nTODO OK — el precio viaja mientras haya venta, y calla cuando no\n"
    : `\n${fallos} comprobacion(es) mal.\n`
);
process.exit(fallos === 0 ? 0 : 1);
