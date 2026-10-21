// UN NUMERO SUELTO NO COMPRA, Y EL PRECIO DE ANTES NO SE DICE EN LA OFERTA.
//
// LO QUE PASO — 25 de septiembre de 2026, tres conversaciones en paralelo. Dos
// fueron bien de principio a fin; la tercera enseno dos fallos distintos.
//
// FALLO 1 — EL NUMERO DEL NOMBRE COMPRABA. Su opcion cara se llamaba «<algo> 2
// EN 1», asi que el digito «2» quedo como palabra EXCLUSIVA de esa opcion. La
// puerta que mira si el cliente nombro un producto dentro de una frase lo tomaba
// por el nombre:
//
//     «son 2»                  -> registraba la opcion cara y soltaba sus datos
//     «pregunte si son 2»      -> otra vez
//     «quiero saber si son 2»  -> otra vez
//     «tengo 2 hijos»          -> otra vez
//
// Y con el BARATO ya elegido, ese mismo «son 2» se lo CAMBIABA al caro: es
// cobrarle de mas por hacer una pregunta. El dueno lo vio dos veces seguidas.
//
// Con sus palabras: «¿acaso el bot es tan bobo que no se da cuenta que eso no es
// una peticion?». El modelo no era el bobo — nunca vio el mensaje. El motor
// decidia antes y le quitaba el turno. Quitando el numero, el motor se aparta y
// contesta quien sabe leer la frase entera.
//
// LOS NUMEROS TIENEN SU PROPIO CAMINO y es mejor que este: el que mira la
// numeracion que el bot escribio en su ultimo mensaje. Aqui solo estorbaban.
//
// FALLO 2 — EL PRECIO DE ANTES EN PLENA OFERTA. La conversacion entro en la
// etapa de oferta —precios de ahora 10 y 8— y al preguntar «precio» el bot
// contesto con 14 y 10, los de antes. No se los invento: los copio de un mensaje
// suyo anterior de esa misma conversacion. El motor cobro bien; el cliente leyo
// otra cosa.
//
// NO SE ARREGLO EN EL PROMPT, y el dueno pidio expresamente que no: «busca la
// solucion sin uso de prompt, si es que se puede». En el prompt todo compite a la
// vez y la conversacion entera esta llena de los precios viejos. Se arregla en la
// vigilancia que ya mira lo que el bot IBA a mandar: si el importe no es uno de
// los que puede cobrar HOY, la respuesta se rehace.
//
// LO QUE NO PUEDE ROMPERSE:
//
//   · NOMBRAR EL PRODUCTO CON PALABRAS SIGUE ELIGIENDO.
//   · EL AHORRO SIGUE SIENDO SUYO. Las restas se calculan con el precio viejo
//     todavia dentro, asi que «te ahorras 4» pasa.
//   · EL PRECIO DE OFERTA DE UNA OPCION NO SE BORRA AUNQUE SEA EL PRECIO NORMAL
//     DE LA OTRA. Lo pillo la medicion antes de subirlo: el de oferta del caro
//     era 10, que es el normal del barato, y se estaba borrando.
//   · Y SIN OFERTA ACTIVA NO CAMBIA NADA: los precios normales siguen siendo los
//     suyos, letra por letra.
//
//   node scripts/prueba-un-numero-suelto-no-compra-ni-revive-el-precio-viejo.mjs
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

// Nombres INVENTADOS. Lo que importa es la FORMA: el caro lleva digitos dentro.
const CARO = "TORNADO 2 EN 1";
const BARATO = "CANELA SIMPLE";
const CASA = mkdtempSync(join(tmpdir(), "numero-suelto-"));
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
      {
        id: "pb",
        name: BARATO,
        precios_por_pais: { PE: { price_soles: 10, discount_price_soles: 8 } },
      },
      {
        id: "pf",
        name: CARO,
        precios_por_pais: { PE: { price_soles: 14, discount_price_soles: 10 } },
      },
    ],
    payment_profiles_by_country: { PE: { market_price: 45 } },
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
    `${ok ? "ok   " : "FALLA"} ${titulo.padEnd(52).slice(0, 52)} ${nota}`
  );
};
const registra = (frase, teniendo) => {
  const r = m.inferTwoTierChoiceFromContext(frase, teniendo, cfg, {
    elExtraNoEstaEnJuego: true,
  });
  return r === null ? "nada" : r === "combo" ? "CARO" : "BARATO";
};

// ── 1. UN NUMERO SUELTO NO REGISTRA NADA ────────────────────────────────────
console.log("-- 1. un numero suelto no compra -------------------------");
for (const frase of [
  "son 2",
  "QUE SON 2",
  "pregunte si son 2",
  "quiero saber si son 2",
  "tengo 2 hijos",
  "son 2 dias",
  "me llegan 2 archivos",
]) {
  comprobar(
    `teniendo el caro · «${frase}»`,
    registra(frase, "combo") === "nada",
    "el turno es del modelo"
  );
}
comprobar(
  "y con el BARATO elegido no se lo cambian al caro",
  registra("son 2", "basico") === "nada",
  "eso era cobrarle de mas"
);

// ── 2. NOMBRAR EL PRODUCTO CON PALABRAS SIGUE ELIGIENDO ─────────────────────
console.log("\n-- 2. nombrar el producto sigue eligiendo ----------------");
comprobar(
  "«mejor el tornado»",
  registra("mejor el tornado", "basico") === "CARO",
  "la palabra del nombre manda"
);
comprobar(
  "«mejor la canela»",
  registra("mejor la canela", "combo") === "BARATO",
  "en los dos sentidos"
);

// ── 3. EL PRECIO DE ANTES NO SE DICE EN PLENA OFERTA ────────────────────────
console.log("\n-- 3. el precio de antes, con la oferta activa -----------");
const TEL = "51999888777";
const sinOferta = (t) => m.importesQueNoSonSuyos(t, TEL, 0, false);
const conOferta = (t) => m.importesQueNoSonSuyos(t, TEL, 0, true);
comprobar(
  "el precio viejo del caro queda rechazado",
  conOferta("El TORNADO está S/. 14").length === 1,
  "hoy cuesta 10"
);
comprobar(
  "y sin oferta pasa, como siempre",
  sinOferta("El TORNADO está S/. 14").length === 0,
  "letra por letra como antes"
);
comprobar(
  "el precio de oferta del caro pasa",
  conOferta("Hoy el TORNADO está S/. 10").length === 0,
  "aunque sea el normal del barato"
);
comprobar(
  "el precio de oferta del barato pasa",
  conOferta("Hoy la CANELA está S/. 8").length === 0,
  "es lo que cobra"
);
comprobar(
  "el ahorro sigue siendo suyo",
  conOferta("Te ahorras S/. 4").length === 0,
  "las restas se calculan antes"
);
comprobar(
  "el tachado («antes») sigue valiendo",
  conOferta("Antes S/. 45, hoy solo S/. 8").length === 0,
  "tiene su propio campo"
);
comprobar(
  "y un importe inventado se sigue rechazando",
  conOferta("Te lo dejo en S/. 12").length === 1,
  "lo de siempre"
);

// ── 4. LA FORMA ─────────────────────────────────────────────────────────────
console.log("\n-- 4. la forma ------------------------------------------");
const fuente = readFileSync(
  join(RAIZ, "src", "lib", "workflow", "config.ts"),
  "utf8"
);
comprobar(
  "los numeros no son palabras propias de un producto",
  /\.filter\(\(token\) => !\/\^\\d\+\$\/\.test\(token\)\)/.test(fuente),
  "tienen su propio camino"
);
comprobar(
  "y no se borra un precio que sí se cobra hoy",
  /if \(viejo === Math\.trunc\(oferta\) \|\| losDeAhora\.has\(viejo\)\) return;/.test(
    fuente
  ),
  "lo pillo la medicion"
);
comprobar(
  "la vigilancia recibe si la oferta está activa",
  /isDiscountActiveForConversation\(convo, workflowConfig\)\s*\r?\n?\s*\)/.test(
    readFileSync(join(RAIZ, "src", "lib", "openrouter.ts"), "utf8")
  ),
  "sin tocar el prompt"
);

process.chdir(RAIZ);
console.log(
  fallos === 0
    ? "\nTODO OK — un numero suelto no compra y el precio viejo no vuelve\n"
    : `\n${fallos} comprobacion(es) mal.\n`
);
process.exit(fallos === 0 ? 0 : 1);
