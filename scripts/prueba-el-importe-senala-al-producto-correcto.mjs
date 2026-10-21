// UN IMPORTE SEÑALA AL PRODUCTO QUE DE VERDAD CUESTA ESO.
//
// LO QUE PASO — 28 de septiembre de 2026, su prueba HOL3. El cliente tenia la
// opcion CARA elegida, la oferta estaba corriendo, escribio «ESTA A 10 soles»
// —repitiendo el precio que tenia delante— y el bot lo cambio a la BARATA y le
// cobro 8.
//
// MEDIDO con su configuracion, y esto lo explica entero:
//
//     CAJAS de la oferta          QUIEN COBRA (ficha + pais)
//       cara    0  /  0             cara    14 / 10 en oferta
//       barata 10  /  8             barata  10 /  8 en oferta
//
// Las DOS funciones que leen un numero miraban LAS CAJAS. Ahi el precio de la
// opcion cara vale CERO —sus precios viven en la ficha, por pais, que es como
// manda CLAUDE.md— asi que:
//
//   · ningun importe podia señalar a la cara: «quiero el de 14» no era nada;
//   · y cualquier importe que coincidiera con la barata la elegia a ella.
//
// NO ES EL CASO RARO DEL CAMBIO DE MODALIDAD. Se midio en «como DOU» y en «como
// OB» y es identico: pasa todos los dias, con cualquier lista de precios.
//
// Y EL ORDEN IMPORTA MAS QUE LA FUENTE. Con la oferta corriendo, «10» es la CARA
// con descuento y tambien la BARATA a precio normal. El cliente repite el numero
// que tiene DELANTE, y eso depende de la etapa. Por eso se prueban primero los
// precios de SU etapa.
//
// LAS DOS FUNCIONES:
//   · `detectTwoTierPick`              -> la PRIMERA eleccion
//   · `inferTwoTierChoiceFromContext`  -> el CAMBIO de eleccion (el caso de HOL3)
//
//   node scripts/prueba-el-importe-senala-al-producto-correcto.mjs
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import {
  readFileSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  utimesSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";

const RAIZ = process.cwd();
const YAML = createRequire(join(RAIZ, "package.json"))("yaml");
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
        // LAS CINCO DE SIEMPRE. Una sexta rompe los ~20 bancos a la vez.
        source: `
          export const getConversationByPhone = () => null;
          export const getConversationById = () => null;
          export const getFrozenPrices = () => null;
          export const getUpsellFrozenPrices = () => null; export const getPuestoEnLaFila = () => null; export const leerCompradosDeLaFila = () => []; export const moverLaFila = () => {};
          export const setFrozenPrices = () => {};
        `,
      };
    return next(url, ctx);
  },
});

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 54)} ${valor}`);
};

// ── SU FORMA DE TENER LOS PRECIOS, CON PRODUCTOS INVENTADOS ────────────────
//
// La clave del fixture: los precios viven en la FICHA (por pais) y las cajas de
// la oferta quedan vacias, que es exactamente como el los tiene. Nunca con sus
// productos reales: una prueba escrita con ellos tapa este mismo fallo.
const CARA = "PACK GRANDE";
const BARATA = "PACK CHICO";
const CASA = mkdtempSync(join(tmpdir(), "importe-senala-"));
mkdirSync(join(CASA, "config"), { recursive: true });
const ARCHIVO = join(CASA, "config", "intro-data.yaml");
let reloj = 1_700_000_000;
const montar = (extra) => {
  writeFileSync(
    ARCHIVO,
    YAML.stringify({
      country: "PE",
      greeting: { body_variants: ["hola"] },
      intro_sequence: [{ type: "text", body_variants: ["la intro"] }],
      payment_responses: { yape: [{ type: "text", body_variants: ["datos"] }] },
      course_price_soles: 30,
      // EL SOLAPE ES LA CLAVE DEL FIXTURE, y es el de su caso: el precio de
      // OFERTA de la cara (40) es el MISMO que el precio NORMAL de la barata.
      // Sin ese solape el fallo no se reproduce, porque cualquier orden acierta.
      biblioteca_de_productos: [
        { id: "pb", name: BARATA, price_soles: 40, discount_price_soles: 24 },
        { id: "pf", name: CARA, price_soles: 50, discount_price_soles: 40 },
      ],
      lineal: { enabled: true },
      alineacion_por_modalidad: {
        lineal: { basico: "pb", unico: "pb", full: "pf" },
      },
      segunda_opcion_prestada: "dos_juntas",
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

const TEL = "51900000000";

// ── 1. EL FIXTURE REPRODUCE SU SITUACION ───────────────────────────────────
console.log("— 1. las cajas vacias y la ficha llena, como las tiene el —\n");
const cfg = m.loadWorkflowConfig();
const ob = m.getActiveTwoTierOffer(cfg);
comprobar("hay dos opciones", ob !== null);
if (!ob) {
  console.log("\nsin dos opciones no hay caso. PARO.\n");
  process.exit(1);
}
const pCara = m.getOrderBumpPriceSoles("combo", false, TEL);
const pCaraOferta = m.getOrderBumpPriceSoles("combo", true, TEL);
const pBarata = m.getOrderBumpPriceSoles("basico", false, TEL);
const pBarataOferta = m.getOrderBumpPriceSoles("basico", true, TEL);
// EL SOLAPE, QUE ES LO QUE HACE QUE EL ORDEN DECIDA.
//
// En su configuracion el origen del fallo era que la CAJA de la opcion cara
// valia cero —sus precios viven en la ficha por pais—. Aqui se reproduce la otra
// mitad, que es la que se puede montar en un fixture y la que de verdad manda:
// un importe que es el de OFERTA de la cara y el NORMAL de la barata. Mirando
// los precios normales primero se elige la barata; mirando los de SU etapa, la
// cara. Es exactamente lo que le paso.
comprobar(
  "el precio de oferta de la cara = el normal de la barata",
  m.getOrderBumpPriceSoles("combo", true, TEL) ===
    m.getOrderBumpPriceSoles("basico", false, TEL),
  `${m.getOrderBumpPriceSoles("combo", true, TEL)} en las dos lecturas`
);
comprobar(
  "quien cobra sabe el precio de la cara",
  pCara > 0 && pCaraOferta > 0,
  `cobra=${pCara}/${pCaraOferta}`
);
comprobar(
  "y los de la barata",
  pBarata > 0 && pBarataOferta > 0,
  `cobra=${pBarata}/${pBarataOferta}`
);

// ── 2. LA PRIMERA ELECCION POR IMPORTE ─────────────────────────────────────
console.log("\n— 2. la primera eleccion: el importe elige bien —\n");
const primera = (frase, conOferta) =>
  m.detectTwoTierPick(frase, cfg, { phone: TEL, conOferta });

comprobar(
  `«el de ${pCara}» elige la CARA ← antes no elegia nada`,
  primera(`quiero el de ${pCara}`, false) === "combo",
  "su precio normal"
);
comprobar(
  `«el de ${pCaraOferta}» con la oferta elige la CARA`,
  primera(`quiero el de ${pCaraOferta}`, true) === "combo",
  "el precio que tiene delante"
);
comprobar(
  `«el de ${pBarataOferta}» con la oferta elige la BARATA`,
  primera(`quiero el de ${pBarataOferta}`, true) === "basico",
  "cada una la suya"
);
comprobar(
  `«el de ${pBarata}» sin oferta elige la BARATA`,
  primera(`quiero el de ${pBarata}`, false) === "basico",
  "como siempre"
);

// ── 3. EL CAMBIO DE ELECCION — SU CASO DE HOL3 ─────────────────────────────
console.log("\n— 3. el cambio de eleccion: SU CASO —\n");
const cambio = (frase, elegido, conOferta) =>
  m.inferTwoTierChoiceFromContext(frase, elegido, cfg, {
    elExtraNoEstaEnJuego: true,
    phone: TEL,
    conOferta,
  });

comprobar(
  `«esta a ${pCaraOferta} soles» con la CARA elegida NO la cambia ← SU FALLO`,
  cambio(`esta a ${pCaraOferta} soles`, "combo", true) === "combo",
  "repetia el precio de la suya"
);
comprobar(
  `  y sin oferta ese importe SI es la barata`,
  cambio(`esta a ${pBarata} soles`, "combo", false) === "basico",
  "ahi el cambio es correcto"
);
comprobar(
  `«mejor el de ${pBarataOferta}» con la CARA elegida cambia a la barata`,
  cambio(`mejor el de ${pBarataOferta}`, "combo", true) === "basico",
  "cambiar de verdad sigue funcionando"
);

// ── 4. LO QUE NO SE PUEDE HABER ROTO ───────────────────────────────────────
console.log("\n— 4. lo que NO cambia —\n");
comprobar(
  "una PREGUNTA de precio no elige nada",
  primera(`cual cuesta ${pCara}`, true) === null &&
    primera(`cuanto vale el de ${pBarata}`, true) === null,
  "el numero es el sujeto de la pregunta"
);
comprobar(
  "un numero de CANTIDAD tampoco",
  primera(`son ${pCara} soles`, true) === null &&
    primera(`no costaba ${pBarata}`, true) === null,
  "los candados de siempre"
);
comprobar(
  "nombrar la opcion sigue mandando sobre el importe",
  primera(`quiero el ${CARA}`, true) === "combo",
  "el nombre primero"
);
// SIN TELEFONO NI ETAPA — las llamadas que no tienen la conversacion delante (la
// reconciliacion del comprobante, la deteccion de upgrade). Leen el PAIS POR
// DEFECTO y los precios NORMALES primero, que es el mismo sitio del que salian
// las cajas globales. No se queda sin decidir.
comprobar(
  "sin telefono ni etapa sigue decidiendo",
  m.detectTwoTierPick(`quiero el de ${pCara}`, cfg) === "combo" &&
    m.detectTwoTierPick(`quiero el de ${pBarataOferta}`, cfg) === "basico",
  "pais por defecto, precios normales primero"
);

// ── 5. UN IMPORTE COMPARTIDO NO SEÑALA A NADIE ──────────────────────────────
//
// Si en esa etapa las dos valen lo mismo, ese numero es de las dos y no decide.
console.log("\n— 5. si las dos valen lo mismo —\n");
montar({
  biblioteca_de_productos: [
    { id: "pb", name: BARATA, price_soles: 30, discount_price_soles: 24 },
    { id: "pf", name: CARA, price_soles: 30, discount_price_soles: 24 },
  ],
});
const iguales = m.loadWorkflowConfig();
comprobar(
  "el importe compartido no elige ninguna",
  m.detectTwoTierPick(`quiero el de 30`, iguales, {
    phone: TEL,
    conOferta: false,
  }) === null,
  "la regla de la ambiguedad, intacta"
);

// ── 6. Y LAS DOS FUNCIONES COMPARTEN LA LECTURA ────────────────────────────
console.log("\n— 6. una sola lectura para las dos —\n");
const fuente = readFileSync(
  join(RAIZ, "src", "lib", "workflow", "config.ts"),
  "utf8"
);
comprobar(
  "existe una sola funcion que lo decide",
  /function laOpcionPorElPrecioQueCobra\(/.test(fuente),
  "no una copia en cada sitio"
);
comprobar(
  "y la usan las DOS",
  (fuente.match(/= laOpcionPorElPrecioQueCobra\(/g) ?? []).length === 2,
  "la primera eleccion y el cambio"
);
comprobar(
  "prueba primero los precios de SU etapa",
  /return enEsaEtapa\(conOferta\) \?\? enEsaEtapa\(!conOferta\);/.test(fuente),
  "el cliente repite lo que tiene delante"
);
comprobar(
  "y el motor le pasa el telefono y la etapa",
  (() => {
    const motor = readFileSync(
      join(RAIZ, "src", "lib", "workflow", "engine.ts"),
      "utf8"
    );
    return (
      (motor.match(
        /conOferta: isDiscountActiveForConversation\(convo, config\)/g
      ) ?? []).length >= 3
    );
  })(),
  "en las tres puertas"
);

console.log(`\n${fallos === 0 ? "TODO EN VERDE" : `${fallos} EN ROJO`}\n`);
process.exit(fallos === 0 ? 0 : 1);
