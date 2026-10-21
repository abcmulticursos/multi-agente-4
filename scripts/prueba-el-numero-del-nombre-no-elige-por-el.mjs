// UN NUMERO DENTRO DEL NOMBRE NO PUEDE ELEGIR POR EL CLIENTE.
//
// LO QUE PASO — 25 de septiembre de 2026, midiendo ANTES de que el dueno
// probara. Su opcion cara se llamaba «<algo> 2 EN 1», asi que los digitos 1 y 2
// estaban los DOS dentro de ese nombre:
//
//     el bot escribe   1) <la barata> S/.10    2) <la cara> S/.14
//     el cliente dice  «el 1»
//     el bot registra  LA CARA        <- el producto equivocado, y mas caro
//
// Y con las dos ordenaciones igual: la numeracion que el propio bot acababa de
// escribir no llegaba a mandar. Es el fallo mas caro que puede tener esto:
// registra otro producto, y el comprobante se valida contra otro precio.
//
// TRES COSAS ESTABAN MAL, Y LAS TRES SE VEN SOLO EJECUTANDO:
//
//   1. El digito del nombre decidia. «1» estaba en las palabras propias de la
//      cara, asi que «el 1» la elegia.
//   2. El orden de respaldo —«sin numeros en el editor, 1=la primera que se
//      muestra»— contestaba ANTES de que nadie mirara lo que el bot numero.
//   3. Y el lector de la numeracion tenia dos fallos propios: se llevaba 140
//      caracteres, que en una lista corta incluyen la OTRA opcion; y metia el
//      marcador «1)» en el texto, asi que el numero de la lista se reconocia a si
//      mismo como si fuera parte del nombre.
//
// LA REGLA ES DE AMBIGUEDAD, NO DE NOMBRES. El dueno vende «100 productos o mas»
// y los renombra cuando quiere, asi que esto pregunta por lo que haya puesto hoy:
//
//   · «PACK 1» y «PACK 2»      -> cada numero senala a uno  -> decide, como hoy
//   · «<algo> 2 EN 1» y otro   -> los dos numeros en uno    -> se abstiene
//   · nombres sin numeros      -> no hay nada que mirar     -> igual que hoy
//
// Y ABSTENERSE NO ES QUEDARSE MUDO: decide la numeracion que el bot escribio de
// verdad, y si no numero, contesta el modelo — que si puede preguntar cual quiere.
//
//   node scripts/prueba-el-numero-del-nombre-no-elige-por-el.mjs
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
          "export const getConversationByPhone=()=>null;export const getFrozenPrices=()=>null;export const getUpsellFrozenPrices=()=>null;export const getPuestoEnLaFila=()=>null;export const leerCompradosDeLaFila=()=>[];export const moverLaFila=()=>{};export const setFrozenPrices=()=>{};export const getConversationById=()=>null;",
      };
    return next(url, ctx);
  },
});

const CASA = mkdtempSync(join(tmpdir(), "numero-nombre-"));
mkdirSync(join(CASA, "config"), { recursive: true });
const ARCHIVO = join(CASA, "config", "intro-data.yaml");
let reloj = 1_700_000_000;
// Nombres INVENTADOS, como manda la casa. Lo que importa es la FORMA: uno de los
// dos lleva los dos digitos dentro.
const montar = (caro, barato) => {
  writeFileSync(
    ARCHIVO,
    aYaml({
      country: "PE",
      greeting: { body_variants: ["hola"] },
      intro_sequence: [{ type: "text", body_variants: ["la intro"] }],
      payment_responses: { yape: [{ type: "text", body_variants: ["datos"] }] },
      course_price_soles: 10,
      biblioteca_de_productos: [
        { id: "pb", name: barato, price_soles: 10 },
        { id: "pf", name: caro, price_soles: 14 },
      ],
      lineal: { enabled: true },
      segunda_opcion_prestada: "segunda_oculta",
      alineacion_por_modalidad: {
        lineal: { basico: "pb", unico: "pb", full: "pf" },
      },
    }),
    "utf8"
  );
  reloj += 60;
  const f = new Date(reloj * 1000);
  utimesSync(ARCHIVO, f, f);
};
montar("TORNADO 2 EN 1", "CANELA SIMPLE");
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
const ver = (r) => (r === null ? "no elige" : r === "combo" ? "CARO" : "BARATO");
const elige = (frase, cfg, ultimaDelBot) =>
  ver(m.detectTwoTierPick(frase, cfg, ultimaDelBot ? { ultimaDelBot } : undefined));

// ── 1. SU CASO: EL NOMBRE LLEVA LOS DOS NUMEROS ─────────────────────────────
console.log("-- 1. el nombre lleva el 1 y el 2 ------------------------");
let cfg = m.loadWorkflowConfig();
const BARATO_PRIMERO =
  "Tenemos dos opciones:\n1) CANELA SIMPLE por S/. 10\n2) TORNADO 2 EN 1 por S/. 14\n¿Cuál prefieres?";
const CARO_PRIMERO =
  "Tenemos dos opciones:\n1) TORNADO 2 EN 1 por S/. 14\n2) CANELA SIMPLE por S/. 10\n¿Cuál prefieres?";
for (const [frase, espera] of [
  ["el 1", "BARATO"],
  ["1", "BARATO"],
  ["el primero", "BARATO"],
  ["el 2", "CARO"],
  ["2", "CARO"],
  ["el segundo", "CARO"],
]) {
  comprobar(
    `el bot numero 1=barato · «${frase}»`,
    elige(frase, cfg, BARATO_PRIMERO) === espera,
    espera
  );
}
for (const [frase, espera] of [
  ["el 1", "CARO"],
  ["el 2", "BARATO"],
]) {
  comprobar(
    `y al reves, 1=caro · «${frase}»`,
    elige(frase, cfg, CARO_PRIMERO) === espera,
    espera
  );
}

// ── 2. LO QUE NO PUEDE ROMPERSE: EL NUMERO QUE SI IDENTIFICA ───────────────
//
// Es para lo que existe esta regla: nombres como «PACK 1» y «PACK 2», donde el
// numero ES el identificador. Ahi el nombre sigue mandando, como siempre.
console.log("\n-- 2. cuando el numero SI senala, decide igual -----------");
montar("PACK 2", "PACK 1");
cfg = m.loadWorkflowConfig();
comprobar(
  "«1» elige el que se llama 1",
  elige("1", cfg) === "BARATO",
  "aunque nadie numere"
);
comprobar(
  "«2» elige el que se llama 2",
  elige("2", cfg) === "CARO",
  "el nombre manda"
);

// ── 3. NOMBRES SIN NUMEROS: TODO COMO ANTES ────────────────────────────────
console.log("\n-- 3. nombres sin numeros, como siempre -----------------");
montar("TORNADO AZUL", "CANELA SIMPLE");
cfg = m.loadWorkflowConfig();
comprobar(
  "sin numeracion del bot, el orden mostrado",
  elige("1", cfg) === "CARO" && elige("2", cfg) === "BARATO",
  "el respaldo de siempre"
);
comprobar(
  "y con numeracion del bot, la suya",
  elige("1", cfg, "1) CANELA SIMPLE\n2) TORNADO AZUL") === "BARATO",
  "lo que el cliente tiene delante"
);

// ── 4. EL LECTOR DE LA NUMERACION, SUS DOS FALLOS ──────────────────────────
console.log("\n-- 4. el lector de la numeracion -------------------------");
const fuente = (await import("node:fs")).readFileSync(
  join(RAIZ, "src", "lib", "workflow", "config.ts"),
  "utf8"
);
comprobar(
  "lee lo que va DETRAS del numero, sin el numero",
  /const inicio = m\.index \+ m\[0\]\.length;/.test(fuente),
  "el «1)» se reconocia a si mismo"
);
comprobar(
  "y corta donde empieza el siguiente",
  /const siguiente = \/\[\^a-z0-9\]\\d\+\\s\*\[\.\)\\-:\]\/\.exec\(trozo\);/.test(
    fuente
  ),
  "140 caracteres se llevaban la otra opcion"
);
comprobar(
  "el numero tiene que senalar a una sola opcion",
  /const elNumeroSenalaUnaOpcion = \(numero: string\): boolean =>/.test(fuente),
  "regla de ambiguedad, no de nombres"
);
comprobar(
  "y el orden de respaldo cede a la numeracion del bot",
  /if \(!laLecturaFinaDeLaEleccionEstaActiva\(\)\) \{\s*\r?\n\s*if \(normalized === "1"\) return "combo";/.test(
    fuente
  ),
  "donde hay algo mejor, no contesta"
);

process.chdir(RAIZ);
console.log(
  fallos === 0
    ? "\nTODO OK — el numero del nombre ya no elige por el cliente\n"
    : `\n${fallos} comprobacion(es) mal.\n`
);
process.exit(fallos === 0 ? 0 : 1);
