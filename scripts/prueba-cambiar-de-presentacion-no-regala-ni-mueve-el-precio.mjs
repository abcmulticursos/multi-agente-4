// CAMBIAR DE PRESENTACION A MEDIA CONVERSACION NO REGALA EL FULL NI MUEVE EL PRECIO.
//
// LO QUE PASO — 25 de septiembre de 2026. El dueno vende en lineal y cambia la
// presentacion con el selector cuando quiere, tambien con clientes a media
// conversacion. Con sus palabras: «cliente escribe en como lineal, recibe info
// como lineal... luego cambio yo en cualquier etapa a como dou o como ob». Y su
// regla: «si recibio informacion y datos en lineal y paga, se le entregaria el
// producto» — el que le mostraron.
//
// DOS COSAS LE COSTABAN DINERO, las dos medidas en el codigo:
//
// 1) EL FULL REGALADO. Al pagar sin haber visto nunca las dos opciones, la
//    entrega era el COMBO. Esa excepcion se escribio para la clienta que hablaba
//    con dos bots a la vez —vio la oferta en uno, pago, y mando el comprobante al
//    otro—, y su motivo sigue siendo bueno: «preferimos regalar de mas en un caso
//    entre mil antes que un reclamo de alguien que ya pago». Pero con el selector
//    ese caso entre mil pasa a ser la NORMA: el cliente pago el basico y recibia
//    el full.
//
//    AHORA LO DECIDE EL IMPORTE: quien pago el combo recibe el combo —la clienta
//    de los dos bots sigue atendida— y quien pago el basico recibe el basico.
//    Nadie recibe menos de lo que pago y nadie recibe de mas. Es la misma
//    doctrina que ya usa la bioferta: «pagar el precio del pack es la senal mas
//    clara que puede dar».
//
// 2) LOS DOS PRECIOS SIN CONGELAR. El congelado por conversacion —el que impide
//    que un importe cambie bajo el cliente— preguntaba por el NOMBRE de la
//    modalidad, y con el selector la modalidad sigue llamandose lineal. Asi que
//    guardaba UN precio en vez de dos, y al leerlos se ignoraba el congelado
//    entero. El dueno lo daba por hecho: «su precio estaba congelado y su
//    comprobante tendra validez».
//
// LO QUE NO PUEDE ROMPERSE:
//
//   · LA CLIENTA DE LOS DOS BOTS sigue recibiendo el combo si su pago lo cubre.
//   · SI VIO LA OFERTA Y NO ELIGIO, sigue siendo el BASICO de siempre.
//   · -OB- DE VERDAD congela y lee exactamente lo de antes.
//   · LINEAL PURO congela solo su precio, como siempre.
//
//   node scripts/prueba-cambiar-de-presentacion-no-regala-ni-mueve-el-precio.mjs
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { stringify as aYaml } from "yaml";

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
        source: `
          export const getConversationByPhone = () => ({ id: 1, phone: "51999888777" });
          export const getConversationById = () => ({ id: 1, phone: "51999888777" });
          export const getFrozenPrices = () => globalThis.__congelado ?? null;
          export const setFrozenPrices = (id, map) => { globalThis.__congelado = map; };
          export const getUpsellFrozenPrices = () => null; export const getPuestoEnLaFila = () => null; export const leerCompradosDeLaFila = () => []; export const moverLaFila = () => {};
        `,
      };
    return next(url, ctx);
  },
});

const CARO = "TORNADO AZUL";
const BARATO = "CANELA SIMPLE";
const CASA = mkdtempSync(join(tmpdir(), "congelado-"));
mkdirSync(join(CASA, "config"), { recursive: true });
const ARCHIVO = join(CASA, "config", "intro-data.yaml");
let reloj = 1_700_000_000;
const montar = (extra) => {
  writeFileSync(
    ARCHIVO,
    aYaml({
      country: "PE",
      greeting: { body_variants: ["hola"] },
      intro_sequence: [{ type: "text", body_variants: ["la intro"] }],
      payment_responses: { yape: [{ type: "text", body_variants: ["datos"] }] },
      course_price_soles: 10,
      biblioteca_de_productos: [
        {
          id: "pb",
          name: BARATO,
          precios_por_pais: { PE: { price_soles: 10, discount_price_soles: 8 } },
        },
        {
          id: "pf",
          name: CARO,
          precios_por_pais: { PE: { price_soles: 14, discount_price_soles: 11 } },
        },
      ],
      ...extra,
    }),
    "utf8"
  );
  reloj += 60;
  const f = new Date(reloj * 1000);
  utimesSync(ARCHIVO, f, f);
};
montar({});
process.chdir(CASA);
const m = await import(
  pathToFileURL(join(RAIZ, "src", "lib", "workflow", "config.ts")).href
);

let fallos = 0;
const comprobar = (titulo, ok, nota = "") => {
  if (!ok) fallos++;
  console.log(
    `${ok ? "ok   " : "FALLA"} ${titulo.padEnd(54).slice(0, 54)} ${nota}`
  );
};

const COMO_OB = {
  lineal: { enabled: true },
  segunda_opcion_prestada: "segunda_oculta",
  alineacion_por_modalidad: {
    lineal: { basico: "pb", unico: "pb", full: "pf" },
  },
};
const LINEAL_PURO = {
  lineal: { enabled: true },
  alineacion_por_modalidad: { lineal: { unico: "pb" } },
};
const OB_DE_VERDAD = {
  order_bump: {
    enabled: true,
    combo: { name: CARO },
    basico: { name: BARATO },
  },
  alineacion_por_modalidad: {
    order_bump: { basico: "pb", complementario: "pf", full: "pf" },
  },
};

const CONVO = { id: 1, phone: "51999888777", channel: "whatsapp" };
const congelar = (extra) => {
  globalThis.__congelado = null;
  montar(extra);
  m.loadWorkflowConfig();
  m.freezePricesForConvo(CONVO);
  return globalThis.__congelado;
};

// ── 1. «COMO OB» CONGELA LOS DOS PRECIOS ────────────────────────────────────
console.log("-- 1. «como ob» congela los dos precios ------------------");
let mapa = congelar(COMO_OB);
comprobar(
  "se guarda algo",
  !!mapa,
  `modalidad anotada = ${mapa?.modality}`
);
comprobar(
  "el precio del caro queda guardado",
  mapa?.combo?.regular === 14 && mapa?.combo?.discount === 11,
  `${mapa?.combo?.regular} / ${mapa?.combo?.discount}`
);
comprobar(
  "y el del barato tambien",
  mapa?.basico?.regular === 10 && mapa?.basico?.discount === 8,
  `${mapa?.basico?.regular} / ${mapa?.basico?.discount}`
);
comprobar(
  "y el precio del producto unico se sigue guardando",
  mapa?.base?.regular === 10,
  "no se le quito nada a lo de antes"
);

// ── 2. Y EL CONGELADO SE LEE: EL PRECIO NO SUBE BAJO EL CLIENTE ────────────
//
// Se sube el precio en la ficha DESPUES de congelar, que es lo que pasa cuando
// se cierra la ventana de descuento a media conversacion. El cliente tiene que
// seguir viendo el que le dijeron.
console.log("\n-- 2. el precio no sube bajo el cliente ------------------");
montar({
  ...COMO_OB,
  biblioteca_de_productos: [
    {
      id: "pb",
      name: BARATO,
      precios_por_pais: { PE: { price_soles: 99, discount_price_soles: 99 } },
    },
    {
      id: "pf",
      name: CARO,
      precios_por_pais: { PE: { price_soles: 99, discount_price_soles: 99 } },
    },
  ],
});
m.loadWorkflowConfig();
comprobar(
  "el caro sigue en lo congelado",
  m.getOrderBumpPriceSoles("combo", false, CONVO.phone) === 14,
  "aunque la ficha diga 99"
);
comprobar(
  "y el barato tambien",
  m.getOrderBumpPriceSoles("basico", false, CONVO.phone) === 10,
  "aunque la ficha diga 99"
);

// ── 3. -OB- DE VERDAD, IGUAL QUE ANTES ─────────────────────────────────────
console.log("\n-- 3. -OB- de verdad, igual que antes -------------------");
mapa = congelar(OB_DE_VERDAD);
comprobar(
  "congela los dos precios de la oferta",
  mapa?.combo?.regular === 14 && mapa?.basico?.regular === 10,
  "letra por letra"
);
comprobar(
  "y NO guarda el del producto unico",
  mapa?.base?.regular === null,
  "ahi no hay producto unico"
);

// ── 4. LINEAL PURO, IGUAL QUE ANTES ────────────────────────────────────────
console.log("\n-- 4. lineal puro, igual que antes ---------------------");
mapa = congelar(LINEAL_PURO);
comprobar(
  "guarda su precio",
  mapa?.base?.regular === 10,
  "el del producto unico"
);
comprobar(
  "y no inventa precios de opciones que no existen",
  mapa?.combo?.regular === null && mapa?.basico?.regular === null,
  "no hay oferta de dos"
);

// ── 5. LA ENTREGA YA NO REGALA EL FULL ─────────────────────────────────────
console.log("\n-- 5. la entrega la decide el importe -------------------");
const pago = readFileSync(
  join(RAIZ, "src", "lib", "workflow", "payment.ts"),
  "utf8"
);
comprobar(
  "el importe se compara con el precio del combo",
  /const suPagoCubreElCombo =\s*\r?\n?\s*elPrecioDelCombo !== null &&\s*\r?\n?\s*newTotalCents >= Math\.round\(elPrecioDelCombo \* 100\);/.test(
    pago
  ),
  "no se adivina"
);
comprobar(
  "solo se entrega el combo si el pago lo cubre",
  /ofertaNuncaRevelada && suPagoCubreElCombo \? "combo" : "basico";/.test(pago),
  "la clienta de los dos bots sigue atendida"
);
comprobar(
  "y ya no se regala por «no vio la oferta»",
  !/const aEntregar = ofertaNuncaRevelada \? "combo" : "basico";/.test(pago),
  "esa linea entregaba el full"
);
comprobar(
  "la excepcion de los dos bots sigue escrita",
  /ofertaNuncaRevelada = convo\.order_bump_revealed !== 1;/.test(pago),
  "no se quito la regla, se acoto"
);

// ── 6. LA FORMA DEL ARREGLO ────────────────────────────────────────────────
console.log("\n-- 6. la forma -----------------------------------------");
const fuente = readFileSync(
  join(RAIZ, "src", "lib", "workflow", "config.ts"),
  "utf8"
);
comprobar(
  "congela preguntando por el dato",
  /if \(getActiveTwoTierOffer\(config\)\) \{\s*\r?\n\s*map\.combo\.regular =/.test(
    fuente
  ),
  "no por el nombre"
);
comprobar(
  "y al leer se compara la modalidad del congelado",
  /if \(!config \|\| !frozen \|\| frozen\.modality !== activeModalityKey\(config\)\) \{/.test(
    fuente
  ),
  "antes exigia llamarse order_bump"
);

process.chdir(RAIZ);
console.log(
  fallos === 0
    ? "\nTODO OK — cambiar de presentacion no regala el full ni mueve el precio\n"
    : `\n${fallos} comprobacion(es) mal.\n`
);
process.exit(fallos === 0 ? 0 : 1);
