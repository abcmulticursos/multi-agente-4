// PREGUNTAR EL PRECIO TRAS UN SEGUIMIENTO RECUERDA LAS 2 OPCIONES.
//
// LO QUE PASO — 25 de septiembre de 2026, su prueba en «como -OB-», dos
// conversaciones a la vez con resultados distintos:
//
//   HOLAPER3 — todavia SIN elegir. Pregunto «precio» y el bot le recordo las dos
//              opciones. Correcto: es la puerta de `awaiting_order_bump_choice`.
//   HOLAPER2 — YA habia elegido, y venia de un seguimiento. Pregunto «precio», no
//              habia puerta, contesto el modelo — y le dio los precios de ANTES de
//              la oferta, copiados de la propia conversacion.
//
// Su regla, con sus palabras: «cuando uno pregunta por el precio luego de la intro
// 1 o la intro 2, debe hacerle un recordatorio al cliente que existen 2 opciones».
//
// NO ES UNA PUERTA NUEVA: ES LA MISMA CONDICION, CONSULTADA DONDE FALTABA.
// `ob_choice_stale` —«un seguimiento corrio DESPUES de que eligio»— ya existia y
// ya disparaba este mismo recordatorio, pero solo cuando el cliente NOMBRABA UN
// METODO DE PAGO. Preguntar el precio es el mismo caso y el mismo riesgo: el
// seguimiento le enseno el precio de la oferta, y soltarle el de su eleccion vieja
// es ensenarle dos numeros distintos.
//
// Y ES SU TEXTO, no uno de fabrica: `sendTwoOptionsReminder` usa la plantilla del
// editor —«Respuesta a "precio" (recordatorio de las 2 opciones)»— con sus
// comodines. En el codigo no se escribe ni una palabra de cara al cliente.
//
// LO QUE NO PUEDE ROMPERSE — los cinco frenos:
//
//   · PREGUNTAR POR UNA OPCION CONCRETA no entra: ahi esta nombrando la que
//     quiere, y recordarle las dos seria no contestarle.
//   · SOLO CON LA ELECCION VENCIDA por un seguimiento.
//   · SIN NADA ABONADO: con un pago encima, un precio es una cuenta de saldo.
//   · UN METODO DE PAGO no es una pregunta de precio, y su rama ya lo atiende.
//   · Y CON UNA IMAGEN no se entra: el comprobante manda siempre.
//
//   node scripts/prueba-el-precio-tras-el-seguimiento-recuerda-las-dos.mjs
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
        source:
          "export const getConversationByPhone=()=>null;export const getFrozenPrices=()=>null;export const getUpsellFrozenPrices=()=>null;export const getPuestoEnLaFila=()=>null;export const leerCompradosDeLaFila=()=>[];export const moverLaFila=()=>{};export const setFrozenPrices=()=>{};export const getConversationById=()=>null;",
      };
    return next(url, ctx);
  },
});

const CARO = "TORNADO AZUL";
const BARATO = "CANELA SIMPLE";
const CASA = mkdtempSync(join(tmpdir(), "precio-seguimiento-"));
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
    biblioteca_de_productos: [
      { id: "pb", name: BARATO, price_soles: 10 },
      { id: "pf", name: CARO, price_soles: 14 },
    ],
    lineal: { enabled: true },
    segunda_opcion_prestada: "segunda_oculta",
    alineacion_por_modalidad: {
      lineal: { basico: "pb", unico: "pb", full: "pf" },
    },
  }),
  "utf8"
);
const fecha = new Date(1_700_000_000_000);
utimesSync(ARCHIVO, fecha, fecha);
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

// ── 1. LAS DOS LECTURAS QUE DECIDEN, EJECUTADAS ─────────────────────────────
//
// La puerta se apoya en dos preguntas: ¿es una pregunta de precio? y ¿nombra una
// opcion concreta? Si la segunda dice si, no se entra. Se ejecutan de verdad,
// porque es lo unico que demuestra que la puerta se abre y se cierra donde debe.
console.log("-- 1. que cuenta como «pregunta el precio» ---------------");
for (const frase of ["precio", "cuanto cuesta", "a como esta", "y los precios"]) {
  comprobar(
    `«${frase}» abre el recordatorio`,
    m.isPriceQuestion(frase) === true &&
      m.isSpecificOrderBumpPriceQuestion(frase, cfg) === false,
    "no nombra ninguna"
  );
}
console.log("\n-- 2. y lo que NO lo abre, porque nombra una -------------");
for (const frase of [
  `cuanto cuesta el ${CARO}`,
  `a como el ${BARATO}`,
  `precio del ${CARO}`,
]) {
  comprobar(
    `«${frase.slice(0, 40)}»`,
    m.isSpecificOrderBumpPriceQuestion(frase, cfg) === true,
    "esa se contesta con su precio"
  );
}
console.log("\n-- 3. ni un mensaje que no pregunta el precio ------------");
for (const frase of ["hola", "ya pague", "gracias", "el otro"]) {
  comprobar(
    `«${frase}»`,
    m.isPriceQuestion(frase) === false,
    "la puerta no se abre"
  );
}

// ── 4. LA FORMA DE LA PUERTA, CON SUS CINCO FRENOS ──────────────────────────
console.log("\n-- 4. la puerta y sus frenos ----------------------------");
const motor = readFileSync(
  join(RAIZ, "src", "lib", "workflow", "engine.ts"),
  "utf8"
);
const laPuerta = (() => {
  const i = motor.indexOf(
    "  // PREGUNTA EL PRECIO TRAS UN SEGUIMIENTO, CON LA ELECCIÓN YA VENCIDA."
  );
  const f = motor.indexOf("  // UN «OK» SECO, CON LOS DATOS DE PAGO", i);
  return i < 0 || f < 0 ? "" : motor.slice(i, f);
})();
comprobar(
  "existe y usa la marca que ya existia",
  /convo\.ob_choice_stale &&/.test(laPuerta),
  "no se invento una nueva"
);
comprobar(
  "manda el recordatorio con SU plantilla",
  /await sendTwoOptionsReminder\(convo, config\);/.test(laPuerta),
  "ni una palabra en el codigo"
);
comprobar(
  "freno 1: si nombra una opcion, no entra",
  /!isSpecificOrderBumpPriceQuestion\(msgContent, config\) &&/.test(laPuerta),
  "la misma funcion que la otra puerta"
);
comprobar(
  "freno 2: solo con una eleccion hecha",
  /\(convo\.order_bump_choice === "combo" \|\|\s*\r?\n?\s*convo\.order_bump_choice === "basico"\) &&/.test(
    laPuerta
  ),
  "sin elegir manda la otra puerta"
);
comprobar(
  "freno 3: sin nada abonado",
  /convo\.paid_total_cents === 0 &&/.test(laPuerta),
  "con pago encima es un saldo"
);
comprobar(
  "freno 4: un metodo de pago no entra",
  /detectPaymentRoute\(msgContent, convo\.phone\) === null/.test(laPuerta),
  "su rama ya lo atiende"
);
comprobar(
  "freno 5: con una imagen no entra",
  /!latestIsImage &&/.test(laPuerta),
  "el comprobante manda"
);
comprobar(
  "y cancela los pasos de pago pendientes",
  /cancelPendingActionsByTypeForConvo\(convo\.id, ACTION_SEND_PAYMENT_STEP\);/.test(
    laPuerta
  ),
  "no sale el precio viejo detras"
);

// ── 5. Y LA RAMA VIEJA SIGUE EN PIE ─────────────────────────────────────────
console.log("\n-- 5. la rama del metodo, intacta -----------------------");
comprobar(
  "el recordatorio tras el seguimiento al nombrar metodo",
  /if \(state === "payment_done" && hasCurrentChoice && convo\.ob_choice_stale\) \{/.test(
    motor
  ),
  "no se toco"
);

process.chdir(RAIZ);
console.log(
  fallos === 0
    ? "\nTODO OK — el precio tras el seguimiento recuerda las 2 opciones\n"
    : `\n${fallos} comprobacion(es) mal.\n`
);
process.exit(fallos === 0 ? 0 : 1);
