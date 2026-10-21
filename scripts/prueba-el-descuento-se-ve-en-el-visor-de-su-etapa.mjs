// EL DESCUENTO SE VE EN EL VISOR DESDE LA ETAPA EN QUE EMPIEZA.
//
// LO QUE PASO — 23 de septiembre de 2026, contado por el dueño:
//
//   «En los visores tambien debe reflejarse el precio con descuento a partir de
//    la etapa que se definio. Yo en mi seguimiento 2 hice que empiece el
//    descuento, y el comodin del precio full no aparece con descuento: sigue
//    mostrando el precio completo.»
//
// LA CAUSA, y es la misma familia que este proyecto ya pago cuatro veces:
// preguntar por el NOMBRE de la modalidad en vez de por el DATO.
//
//     previewOrderBumpPriceForFollowup:
//         if (... || activeModality(c) !== "order_bump") return regular;
//
//   La ETAPA DE DESCUENTO no es de ninguna modalidad: el motor la decide con
//   `isDiscountActiveForConversation`, que solo mira en que seguimiento va la
//   conversacion. Con ese candado dentro, el visor solo enseñaba el descuento en
//   -OB-. En Lineal con «PRESENTA:» encendido —lo suyo— y tambien en -DOU- y en
//   Doble Oferta Dos, enseñaba el precio entero mientras el bot cobraba el
//   rebajado. El espejo mentia.
//
// MEDIDO EN SU CONFIGURACION, antes de tocar nada:
//
//     discount_after_followup.sequence_index = 2     (seguimiento 2)
//     ficha del producto en el Full:  PE  10 -> 7     AR  10.000 -> 6.000
//
// LO QUE NO PUEDE ROMPERSE
//
//   1. ANTES DE SU ETAPA NO HAY DESCUENTO. En el seguimiento 1 se sigue viendo
//      el precio entero.
//   2. EN LAS DE UN SOLO PRODUCTO no se inventa un full: el combo se queda como
//      estaba y el base delega en el resolvedor de siempre, en vez de leer el
//      descuento de la seccion de otra modalidad.
//   3. UN DESCUENTO MAS CARO QUE EL PRECIO NO ES UN DESCUENTO: se ignora.
//
//   node scripts/prueba-el-descuento-se-ve-en-el-visor-de-su-etapa.mjs
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

const motor = await import(
  pathToFileURL(join(RAIZ, "src", "lib", "workflow", "config.ts")).href
);
const {
  repartirPorEtiqueta,
  preciosDeLaFichaEnElPais,
  isDiscountActiveForConversation,
} = motor;

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 56)} ${valor}`);
};

// PRODUCTOS INVENTADOS, con precio y descuento por pais. Con los reales se
// taparia justo el fallo que la regla de la plantilla evita.
const PAIS = "XX";
const biblioteca = [
  {
    id: "pB",
    name: "PRODUCTO ALFA",
    price_soles: 10,
    precios_por_pais: { XX: { price_soles: 111, discount_price_soles: 90 } },
  },
  {
    id: "pF",
    name: "PRODUCTO BETA",
    price_soles: 15,
    precios_por_pais: { XX: { price_soles: 222, discount_price_soles: 180 } },
  },
];

// -- 1. LA ETAPA DE DESCUENTO NO PREGUNTA POR LA MODALIDAD -------------------
//
// Es el motor quien manda, y se ejecuta de verdad: la misma funcion que decide
// si al cliente se le cobra rebajado.
console.log("\n-- 1. la etapa de descuento no mira la modalidad ------------");
const cfgEtapa = { discount_after_followup: { sequence_index: 2 } };
comprobar(
  "en el seguimiento 1 todavia no",
  isDiscountActiveForConversation({ last_followup_index: 0 }, cfgEtapa) === false,
  "0 + 1 >= 2 es falso"
);
comprobar(
  "en el seguimiento 2 ya si",
  isDiscountActiveForConversation({ last_followup_index: 1 }, cfgEtapa) === true,
  "1 + 1 >= 2"
);
comprobar(
  "y de ahi en adelante tambien",
  isDiscountActiveForConversation({ last_followup_index: 5 }, cfgEtapa) === true,
  "no se apaga sola"
);

// -- 2. LA FICHA DEL FULL TIENE SU DESCUENTO, CON LA PRESTADA ----------------
console.log("\n-- 2. la ficha del full tiene su descuento ------------------");
const cfgPrestada = repartirPorEtiqueta({
  biblioteca_de_productos: biblioteca,
  alineacion_por_modalidad: { lineal: { unico: "pB", basico: "pB", full: "pF" } },
  segunda_opcion_prestada: "dos_juntas",
});
const fichaFull = preciosDeLaFichaEnElPais("full", PAIS, cfgPrestada);
const fichaBasico = preciosDeLaFichaEnElPais("basico", PAIS, cfgPrestada);
comprobar(
  "el full: precio entero y precio rebajado",
  fichaFull.precio === 222 && fichaFull.descuento === 180,
  `${fichaFull.precio} -> ${fichaFull.descuento}`
);
comprobar(
  "y el base tiene el SUYO, no el del full",
  fichaBasico.descuento === 90,
  `${fichaBasico.precio} -> ${fichaBasico.descuento}`
);

// -- 3. Y EL VISOR PREGUNTA LO MISMO QUE EL MOTOR ----------------------------
//
// Esta es la mitad que fallaba. El motor ya cobraba rebajado; lo que enseñaba
// el precio entero era la vista previa del seguimiento.
console.log("\n-- 3. el visor pregunta lo mismo que el motor ---------------");
const editor = readFileSync(
  join(RAIZ, "src", "app", "editor", "page.tsx"),
  "utf8"
);
comprobar(
  "se quito el candado del nombre de la modalidad",
  !/activeModality\(c\) !== "order_bump"\) return regular/.test(editor),
  "la etapa no es de nadie"
);
comprobar(
  "el corte es solo por la etapa",
  /if \(!previewOfferIsActiveForFollowup\(c, followupIndex\)\) return regular;/.test(
    editor
  ),
  "antes de su seguimiento, precio entero"
);
comprobar(
  "y la etapa se lee del mismo sitio que el motor",
  /const trigger = c\.offer\?\.sequence_index;[\s\S]{0,140}?followupIndex \+ 1 >= trigger/.test(
    editor
  ),
  "cfg.offer == discount_after_followup"
);
comprobar(
  "la ficha manda en el descuento del full",
  /descuentoDeLaFicha\(c, "full"\) \?\?/.test(editor),
  "y no la capa del pais"
);
comprobar(
  "y la capa es la de la modalidad que vende",
  /c\.modality_payment_profiles\?\.\[mode\]\?\.\[country\] \?\?\s*c\.payment_profiles_by_country\?\.\[country\]/.test(
    editor
  ),
  "no la de order_bump escrita a mano"
);

// -- 4. LAS DE UN SOLO PRODUCTO NO SE INVENTAN UN FULL -----------------------
console.log("\n-- 4. las de un solo producto no se inventan un full --------");
comprobar(
  "el combo se queda como estaba y el base delega",
  /if \(!modalidadDeDosOpciones\(c\)\) \{\s*return option === "combo"\s*\? regular\s*: previewFullPriceForFollowup\(c, followupIndex, country\);/.test(
    editor
  ),
  "nada de la seccion de otra modalidad"
);

// -- 5. UN DESCUENTO MAS CARO NO ES UN DESCUENTO -----------------------------
console.log("\n-- 5. un descuento mas caro no es un descuento --------------");
comprobar(
  "solo se aplica si es positivo y no sube el precio",
  /promo > 0 && promo <= regular \? promo : regular/.test(editor),
  "la guarda de siempre sigue en pie"
);

console.log(
  fallos === 0
    ? "\nTODO OK — el descuento se ve desde su etapa, y antes no\n"
    : `\n${fallos} comprobacion(es) mal.\n`
);
process.exit(fallos === 0 ? 0 : 1);
