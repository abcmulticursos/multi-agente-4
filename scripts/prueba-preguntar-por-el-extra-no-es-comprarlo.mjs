// PREGUNTAR POR EL PRODUCTO EXTRA NO ES COMPRARLO.
//
// LO QUE PASO — 26 de septiembre de 2026, su prueba HOLAPER1. El cliente ya
// habia comprado y recibido su material. El bot le ofrecio el producto extra y
// el escribio:
//
//     «las tintas pepito cuanto cuestan»
//
// El motor lo leyo como un «si, lo quiero» —porque la frase NOMBRA el producto—
// y le solto los datos de pago con el importe, sin haberle dicho nunca cuanto
// costaba. Con las palabras del dueno: «no puede ser que al decir las tintas
// pepito cuanto cuestan enviar los datos, cualquier persona abandona la
// conversacion por que le estan diciendo que pague».
//
// POR QUE PASABA. `detectaAceptacionDeUpsell` decidia con UNA sola cosa: que el
// mensaje contuviera el nombre del producto o uno de sus alias. Nombrarlo era
// quererlo, preguntaras lo que preguntaras.
//
// Y NO ERA EL CRITERIO ENTERO EL QUE FALLABA: en la misma tanda, «como es lo de
// las tintas» SI se contesto explicando, y al final —tras la explicacion y la
// pregunta del bot— un «dale» cerro la venta. Lo que faltaba era separar la
// PREGUNTA de la ACEPTACION, que es una diferencia de estructura, no de
// palabras: se reutilizan las dos funciones que ya deciden eso en el motor.
//
// LO QUE NO PUEDE ROMPERSE:
//
//   · PEDIRLO POR SU NOMBRE SIGUE VALIENDO. «quiero las tintas», «dale, las
//     tintas», «me llevo las tintas» no son preguntas: entran igual que ayer.
//     Eso es lo que mantiene viva la oferta cuando ya paso el plazo.
//   · SIN LA ETAPA ENCENDIDA no decide nada, como siempre.
//   · Y NO SE TOCAN los otros dos caminos de aceptacion —el boton y el «si» a
//     secas—, que tienen sus propias guardas.
//
//   node scripts/prueba-preguntar-por-el-extra-no-es-comprarlo.mjs
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
      return { url: pathToFileURL(join(RAIZ, "src", conExt)).href, shortCircuit: true };
    }
    return next(esp, ctx);
  },
  load(url, ctx, next) {
    if (url === DOBLE)
      return {
        format: "module",
        shortCircuit: true,
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

// Nombre inventado, como manda la casa: una prueba escrita con sus productos
// reales taparia justo el fallo que esa regla evita.
const EXTRA = "ESENCIAS BRUMA";
const CASA = mkdtempSync(join(tmpdir(), "extra-pregunta-"));
mkdirSync(join(CASA, "config"), { recursive: true });
const ARCHIVO = join(CASA, "config", "intro-data.yaml");
writeFileSync(
  ARCHIVO,
  aYaml({
    country: "PE",
    greeting: { body_variants: ["hola"] },
    intro_sequence: [{ type: "text", body_variants: ["la intro"] }],
    payment_responses: { yape: [{ type: "text", body_variants: ["datos"] }] },
    course_price_soles: 10,
    lineal: { enabled: true },
    upsell: {
      enabled: true,
      name: EXTRA,
      aliases: ["esencias"],
      price_soles: 7,
      intro: [{ type: "text", body_variants: ["mira esto"] }],
      delivery: [{ type: "text", body_variants: ["tu enlace"] }],
    },
    biblioteca_de_productos: [{ id: "pb", name: "CANELA SIMPLE", price_soles: 10 }],
    alineacion_por_modalidad: { lineal: { unico: "pb" } },
  }),
  "utf8"
);
const f = new Date(1_700_000_000 * 1000);
utimesSync(ARCHIVO, f, f);
process.chdir(CASA);
const m = await import(
  pathToFileURL(join(RAIZ, "src", "lib", "workflow", "config.ts")).href
);
const cfg = m.loadWorkflowConfig();

let fallos = 0;
const comprobar = (titulo, ok, nota = "") => {
  if (!ok) fallos++;
  console.log(
    `${ok ? "ok   " : "FALLA"} ${titulo.padEnd(54).slice(0, 54)} ${nota}`
  );
};
const acepta = (frase) => m.detectaAceptacionDeUpsell(frase, cfg);

// -- 1. PREGUNTAR NO ES COMPRAR --------------------------------------------
console.log("-- 1. preguntar por el no es quererlo -------------------");
comprobar(
  `«${EXTRA.toLowerCase()} cuanto cuestan»`,
  acepta(`${EXTRA.toLowerCase()} cuanto cuestan`) === false,
  "el de HOLAPER1"
);
for (const frase of [
  `cuanto cuesta ${EXTRA.toLowerCase()}`,
  `${EXTRA.toLowerCase()} que precio tiene`,
  `que trae ${EXTRA.toLowerCase()}`,
  `que incluye ${EXTRA.toLowerCase()}`,
  `cual es ${EXTRA.toLowerCase()}`,
]) {
  comprobar(`«${frase}»`, acepta(frase) === false, "es una pregunta");
}

// -- 2. PERO PEDIRLO POR SU NOMBRE SIGUE VALIENDO --------------------------
//
// Es la mitad que mantiene viva la oferta: el dueno lo dejo escrito cuando se
// diseno, «pedirlo por su NOMBRE vale en cualquier momento».
console.log("\n-- 2. pedirlo por su nombre sigue comprando -------------");
for (const frase of [
  `quiero ${EXTRA.toLowerCase()}`,
  `dale, las esencias`,
  `me llevo ${EXTRA.toLowerCase()}`,
  `si, ${EXTRA.toLowerCase()}`,
  EXTRA,
]) {
  comprobar(`«${frase}»`, acepta(frase) === true, "no es pregunta");
}

// -- 3. Y LO DE SIEMPRE, INTACTO -------------------------------------------
console.log("\n-- 3. los candados de siempre ---------------------------");
comprobar(
  "sin nombrarlo no acepta nada",
  acepta("cuanto cuesta") === false && acepta("hola") === false,
  "como ayer"
);
const fuente = readFileSync(
  join(RAIZ, "src", "lib", "workflow", "config.ts"),
  "utf8"
);
const laFuncion = (() => {
  const i = fuente.indexOf("export function detectaAceptacionDeUpsell(");
  return i < 0 ? "" : fuente.slice(i, fuente.indexOf("\n}", i));
})();
comprobar(
  "la etapa apagada sigue mandando",
  /if \(!up\?\.enabled\) return false;/.test(laFuncion),
  "el primer candado"
);
comprobar(
  "se pregunta con las funciones que ya existen",
  /if \(isPriceQuestion\(msg\) \|\| isProductInformationQuestion\(msg\)\) return false;/.test(
    laFuncion
  ),
  "ninguna lista de palabras nueva"
);
comprobar(
  "y el nombre se sigue leyendo igual que antes",
  /claves\.some\(\(k\) => lower\.includes\(k\)\)/.test(laFuncion),
  "no se toco"
);

process.chdir(RAIZ);
console.log(
  fallos === 0
    ? "\nTODO OK — preguntar por el extra no lo compra, y pedirlo si\n"
    : `\n${fallos} comprobacion(es) mal.\n`
);
process.exit(fallos === 0 ? 0 : 1);
