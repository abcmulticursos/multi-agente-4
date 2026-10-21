// DECIR QUE NO AL AÑADIDO NO PUEDE COMPRARLO.
//
// LO QUE PASÓ — 25 de septiembre de 2026. Midiendo la eleccion de producto con
// TRES pares de nombres distintos, el cliente rechazaba el añadido y el motor le
// registraba justo la opcion CARA:
//
//     «sin escobilla»                -> la opcion con escobilla
//     «no quiero la escobilla»       -> la opcion con escobilla
//     «la escobilla no la necesito»  -> la opcion con escobilla
//     «sin camote»                   -> la opcion con camote
//     «no me mandes lapices»         -> la opcion con lapices
//
// Siete de siete, y SIEMPRE al mismo lado: cobrando el caro a quien dijo que NO
// queria el plus. Con las palabras del dueño: «yo voy a vender 100 productos
// diferentes», asi que esto no era de un producto — era de cualquier añadido.
//
// LA CAUSA. La eleccion se decide comparando los DOS nombres y quedandose con la
// palabra que los DISTINGUE. Eso es correcto y es lo que hace que sirva para 100
// productos sin escribir ninguno en el codigo. Pero miraba solo si la palabra
// APARECIA, no COMO venia: «escobilla» esta igual de presente en «con escobilla»
// que en «sin escobilla».
//
// LO QUE SE HIZO. Una palabra negada deja de contar. Y el motor NO se inventa la
// opcion contraria: se APARTA y contesta el modelo, que si entiende «no quiero la
// escobilla». Es lo que pidio el dueño — que cuando hay matiz decida quien lee la
// frase entera, no una comparacion.
//
// LA REGLA NO SE INVENTO: es la que ya protege los metodos de pago desde que «no
// tengo yape» mandaba los datos de Yape (`methodMentionIsNegated`), con sus dos
// medidas y una tercera que hizo falta aqui:
//
//   · Cuatro palabras ANTES. Con tres se escapaba «no puedo pagar por yape»; con
//     cinco daba falso positivo en «no se como pagar por yape».
//   · DOS palabras DESPUES, mas corto a proposito: el cliente pone el añadido
//     delante y lo rechaza detras («el papel no lo uso»).
//   · La puntuacion CORTA: en «escobilla, no hay problema» el «no» es de otra
//     idea.
//   · Y «no el otro» niega AL OTRO: «quiero la escobilla no la otra» sigue
//     siendo una eleccion.
//
// NADA DE ESTO NOMBRA UN PRODUCTO: «no», «ni», «sin», «tampoco», «nunca» y
// «jamas» son gramatica, y valen igual con los 100 que venda mañana. Los nombres
// de esta prueba son inventados por la misma razon.
//
//   node scripts/prueba-decir-que-no-al-plus-no-lo-compra.mjs
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from "node:fs";
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
          "export const getConversationByPhone=()=>null;export const getFrozenPrices=()=>null;export const getUpsellFrozenPrices=()=>null;export const getPuestoEnLaFila=()=>null;export const leerCompradosDeLaFila=()=>[];export const moverLaFila=()=>{};export const setFrozenPrices=()=>{};",
      };
    return next(url, ctx);
  },
});

const CASA = mkdtempSync(join(tmpdir(), "negado-"));
mkdirSync(join(CASA, "config"), { recursive: true });
const ARCHIVO = join(CASA, "config", "intro-data.yaml");
let reloj = 1_700_000_000;
const montar = (caro, barato) => {
  writeFileSync(
    ARCHIVO,
    aYaml({
      country: "PE",
      greeting: { body_variants: ["hola"] },
      intro_sequence: [{ type: "text", body_variants: ["la intro"] }],
      payment_responses: { yape: [{ type: "text", body_variants: ["datos"] }] },
      order_bump: {
        enabled: true,
        combo: { name: caro, price_soles: 30 },
        basico: { name: barato, price_soles: 20 },
      },
    }),
    "utf8"
  );
  reloj += 60;
  const fecha = new Date(reloj * 1000);
  utimesSync(ARCHIVO, fecha, fecha);
};

montar("PRODUCTO ALFA + BETA", "PRODUCTO ALFA");
process.chdir(CASA);
const m = await import(
  pathToFileURL(join(RAIZ, "src", "lib", "workflow", "config.ts")).href
);

let fallos = 0;
const comprobar = (titulo, ok, nota = "") => {
  if (!ok) fallos++;
  console.log(
    `${ok ? "ok   " : "FALLA"} ${titulo.padEnd(50).slice(0, 50)} ${nota}`
  );
};

/** Cada par de nombres se mide con las MISMAS frases: si algo dependiera del
 *  producto, aquí se vería. */
const medir = (caro, barato, plus, base) => {
  montar(caro, barato);
  const cfg = m.loadWorkflowConfig();
  const elige = (frase) => {
    const r = m.detectOrderBumpChoice(frase, cfg);
    return r === "combo" ? "CARO" : r === "basico" ? "BARATO" : "no decide";
  };
  console.log(`\n-- «${barato}» contra «${caro}» --`);
  // LO QUE NO PUEDE COMPRAR EL CARO: el cliente rechaza el añadido.
  for (const frase of [
    `sin ${plus}`,
    `no quiero ${plus}`,
    `no quiero el ${plus}`,
    `el ${plus} no lo uso`,
    `${plus} no gracias`,
    `no me mandes ${plus}`,
    `ni ${plus}`,
    `tampoco ${plus}`,
  ]) {
    comprobar(
      `rechaza el plus: «${frase}»`,
      elige(frase) !== "CARO",
      elige(frase) === "no decide" ? "lo resuelve el modelo" : elige(frase)
    );
  }
  // LO QUE SÍ ELIGE, Y NO PUEDE DEJAR DE ELEGIR.
  for (const [frase, espera] of [
    [`quiero con ${plus}`, "CARO"],
    [`el de ${plus}`, "CARO"],
    [`dame el de ${plus}`, "CARO"],
    [`${base} y ${plus}`, "CARO"],
    [`quiero ${plus} no la otra`, "CARO"],
    [`${plus}, no hay problema`, "CARO"],
    [`solo ${base}`, "BARATO"],
    [`${base}`, "BARATO"],
  ]) {
    comprobar(`elige igual que antes: «${frase}»`, elige(frase) === espera, espera);
  }
};

medir("ZAPATOS + ESCOBILLA", "ZAPATOS", "escobilla", "zapatos");
medir("PAPAS CON CAMOTE", "PAPAS", "camote", "papas");
medir("CUADERNO + LAPICES", "CUADERNO", "lapices", "cuaderno");

// ── Y LA REGLA NO TRAE NINGÚN PRODUCTO DENTRO ───────────────────────────────
console.log("\n-- la regla es gramatica, no vocabulario -------------------");
const fuente = (await import("node:fs")).readFileSync(
  join(RAIZ, "src", "lib", "workflow", "config.ts"),
  "utf8"
);
const lista = (fuente.match(/const NEGACIONES_DEL_CLIENTE = new Set\(\[[\s\S]*?\]\)/) ?? [""])[0];
comprobar(
  "solo lleva negaciones, ningun nombre",
  /"no"/.test(lista) && /"sin"/.test(lista) && !/produc|kit|pack|papel/i.test(lista),
  "vale para los 100 productos"
);
comprobar(
  "reutiliza la medida de los metodos de pago",
  /methodMentionIsNegated/.test(fuente),
  "no se invento una regla nueva"
);

process.chdir(RAIZ);
console.log(
  fallos === 0
    ? "\nTODO OK — decir que no al plus nunca lo compra\n"
    : `\n${fallos} comprobacion(es) mal.\n`
);
process.exit(fallos === 0 ? 0 : 1);
