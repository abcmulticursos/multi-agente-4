// «COMO -OB-» LEE AL CLIENTE COMO -OB-, NO COMO LINEAL.
//
// LO QUE PASO — 25 de septiembre de 2026, su conversacion 138. Vendiendo en
// lineal con el selector «PRESENTA: COMO -OB-», con las dos opciones en
// pantalla, escribio:
//
//     «el que viene completo»
//
// y recibio «✅ Recibido. Revisa los siguientes mensajes» — el mensaje de cuando
// se agotan los intentos del modelo.
//
// LA CAUSA, medida con la misma funcion y las mismas frases, cambiando SOLO el
// interruptor: `laLecturaFinaDeLaEleccionEstaActiva` preguntaba por el NOMBRE de
// la modalidad —order_bump o doble_oferta_upsell— y con el selector la modalidad
// sigue llamandose lineal. Apagada, el «que» vuelve a la regla tosca: cualquier
// «que» en cualquier sitio es una pregunta. Y el motor se aparta.
//
//     el que viene completo                      PREGUNTA -> no elige
//     el que viene con todo                      PREGUNTA -> no elige
//     creo que el <caro>                         PREGUNTA -> no elige
//     ok que sea el <caro>                       PREGUNTA -> no elige
//     mejor el <barato> por que no tengo plata   PREGUNTA -> no elige
//
// Y CIERRA LAS DOS PUERTAS A LA VEZ, que es lo que lo volvio un mensaje de
// emergencia: la herramienta con la que el MODELO registra la eleccion pregunta
// por esta MISMA lectura (`openrouter.ts`), asi que le dijo que no tres veces
// seguidas hasta agotar el techo de vueltas.
//
// Es la averia que este proyecto tiene escrita como la mas cara: preguntar por
// el nombre de la modalidad en vez de por el dato. Van cuatro.
//
// LO QUE NO PUEDE ROMPERSE:
//
//   · LINEAL PURO NO SE ENTERA. Sin oferta de dos opciones sentada esto sigue
//     apagado, palabra por palabra como antes. Es la mitad que el dueno pidio
//     proteger: «dejamos lineal quieto».
//   · -OB- Y -DOU- DE VERDAD, IGUAL QUE SIEMPRE: ya pasaban por el nombre.
//   · «COMO -DOU-» NO SE ENCIENDE, y no es un olvido: toma la forma de Doble
//     Oferta 2 Productos, que tampoco la tiene. Cada presentacion se comporta
//     como la modalidad cuya forma toma prestada.
//   · Y NO SE PREGUNTA POR EL INTERRUPTOR, SINO POR EL DATO: sin el segundo
//     producto sentado, `isOrderBumpActive` dice no.
//
//   node scripts/prueba-la-presentacion-prestada-lee-fino.mjs
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

// Nombres inventados, como manda la casa.
const CARO = "TORNADO AZUL";
const BARATO = "CANELA SIMPLE";
const CASA = mkdtempSync(join(tmpdir(), "prestada-fina-"));
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
        { id: "pb", name: BARATO, price_soles: 10 },
        { id: "pf", name: CARO, price_soles: 14 },
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
    `${ok ? "ok   " : "FALLA"} ${titulo.padEnd(52).slice(0, 52)} ${nota}`
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
    combo: { name: CARO, price_soles: 14 },
    basico: { name: BARATO, price_soles: 10 },
  },
  alineacion_por_modalidad: {
    order_bump: { basico: "pb", complementario: "pf", full: "pf" },
  },
};
const COMO_DOU = {
  lineal: { enabled: true },
  segunda_opcion_prestada: "dos_juntas",
  alineacion_por_modalidad: {
    lineal: { basico: "pb", unico: "pb", full: "pf" },
  },
};

const con = (extra) => {
  montar(extra);
  return m.loadWorkflowConfig();
};

// ── 1. SU CASO, LA FRASE QUE COSTO LA VENTA ─────────────────────────────────
console.log("-- 1. «como ob»: su frase del 25/09 ----------------------");
let cfg = con(COMO_OB);
comprobar(
  "la lectura fina esta encendida",
  m.laLecturaFinaDeLaEleccionEstaActiva() === true,
  "la modalidad sigue llamandose lineal"
);
const elige = (frase, cfgAhora) => {
  const r = m.detectTwoTierPick(frase, cfgAhora);
  return r === "combo" ? "CARO" : r === "basico" ? "BARATO" : "no elige";
};
for (const [frase, espera] of [
  ["el que viene completo", "CARO"],
  ["el que viene con todo", "CARO"],
  [`creo que el ${CARO}`, "CARO"],
  [`ok que sea el ${CARO}`, "CARO"],
  ["el mas caro", "CARO"],
  ["el completo", "CARO"],
]) {
  comprobar(`«${frase}»`, elige(frase, cfg) === espera, espera);
}
comprobar(
  "y el «que» ya no convierte la frase en pregunta",
  m.isOrderBumpConversationQuestion("el que viene completo") === false,
  "su frase, literal"
);

// ── 1-bis. Y EL ORDINAL, QUE COLGABA DEL MISMO INTERRUPTOR ─────────────────
console.log("\n-- 1-bis. el ordinal y el numero --------------------------");
for (const [frase, espera] of [
  ["el primero", "CARO"],
  ["el segundo", "BARATO"],
]) {
  comprobar(`«${frase}»`, elige(frase, cfg) === espera, espera);
}

// ── 2. LINEAL PURO NO SE ENTERA ────────────────────────────────────────────
//
// La mitad que el dueno pidio proteger, con sus palabras: «dejamos lineal
// quieto». Sin oferta de dos no hay nada que elegir, y la lectura fina se apaga.
console.log("\n-- 2. lineal puro, intacto -------------------------------");
cfg = con(LINEAL_PURO);
comprobar(
  "la lectura fina esta apagada",
  m.laLecturaFinaDeLaEleccionEstaActiva() === false,
  "un solo producto"
);
comprobar(
  "y el «que» vuelve a la regla de siempre",
  m.isOrderBumpConversationQuestion("el que viene completo") === true,
  "palabra por palabra como antes"
);
comprobar(
  "no elige nada, porque no hay dos",
  elige("el que viene completo", cfg) === "no elige",
  "no hay entre que elegir"
);

// ── 3. -OB- DE VERDAD, IGUAL QUE SIEMPRE ───────────────────────────────────
console.log("\n-- 3. -OB- de verdad, igual que siempre ------------------");
cfg = con(OB_DE_VERDAD);
comprobar(
  "la lectura fina sigue encendida",
  m.laLecturaFinaDeLaEleccionEstaActiva() === true,
  "ya pasaba por el nombre"
);
comprobar(
  "«el que viene completo» sigue eligiendo el caro",
  elige("el que viene completo", cfg) === "CARO",
  "no se le toco nada"
);

// ── 4. «COMO -DOU-» TAMBIEN LEE FINO ───────────────────────────────────────
//
// Se dejo fuera en el primer arreglo —esa presentacion toma la forma de Doble
// Oferta 2 Productos, que no la tiene— y el dueno lo corrigio en el acto: «yo uso
// como lineal, y cambio a como dou y cambio a como ob cuando yo desee, debe estar
// preparado para el cambio sin romperse». Un selector que deja una de las tres
// cojas no es un selector.
console.log("\n-- 4. «como dou» tambien lee fino -----------------------");
cfg = con(COMO_DOU);
comprobar(
  "la lectura fina esta encendida",
  m.laLecturaFinaDeLaEleccionEstaActiva() === true,
  "mueve el selector cuando quiere"
);
comprobar(
  "«el que viene completo» elige el caro",
  elige("el que viene completo", cfg) === "CARO",
  "igual que en «como ob»"
);
comprobar(
  "y «el primero» elige, que ahi es lo natural",
  elige("el primero", cfg) !== "no elige",
  "las dos opciones se presentan juntas"
);

// ── 5. SE PREGUNTA POR EL DATO, NO POR EL SELECTOR ─────────────────────────
//
// Con el selector puesto pero SIN el segundo producto sentado no hay oferta de
// dos, asi que no hay lectura fina que valga: es lo que ya exige
// `isOrderBumpActive` y aqui se conserva.
console.log("\n-- 5. el selector solo no basta --------------------------");
con({
  lineal: { enabled: true },
  segunda_opcion_prestada: "segunda_oculta",
  alineacion_por_modalidad: { lineal: { unico: "pb", basico: "pb" } },
});
comprobar(
  "sin el segundo sentado, apagada",
  m.laLecturaFinaDeLaEleccionEstaActiva() === false,
  "el dato, no el interruptor"
);

// ── 6. Y LA CASILLA VACIA YA NO DICE QUE EL CARO ES EL BARATO ──────────────
//
// LO QUE PASO — la misma medicion del 25/09 con la configuracion del dueno:
//
//     ob.combo.price_soles   = 0      <- la casilla de la opcion
//     ob.basico.price_soles  = 10
//     lo que COBRA de verdad = 14 y 10
//
// «El completo» y «el mas caro» se resuelven comparando esas casillas, y con el
// combo en cero devolvian EL BARATO: el producto equivocado, con su precio.
console.log("\n-- 6. la casilla vacia pregunta al que cobra -------------");
cfg = con({
  ...COMO_OB,
  // La caja de la oferta SIN importes, que es como queda cuando el precio es por
  // pais: el reparto no la refresca.
  order_bump: { combo: { price_soles: 0 }, basico: { price_soles: 0 } },
  payment_profiles_by_country: {
    PE: { course_price_soles: 10, order_bump: { combo_price_soles: 14 } },
  },
});
comprobar(
  "«el mas caro» sigue siendo el caro",
  elige("el mas caro", cfg) === "CARO",
  "antes devolvia el barato"
);
comprobar(
  "y «el completo» tambien",
  elige("el completo", cfg) === "CARO",
  "el que cobra 14"
);

// ── 7. LA FORMA DEL ARREGLO ────────────────────────────────────────────────
console.log("\n-- 7. la forma ------------------------------------------");
const fuente = readFileSync(
  join(RAIZ, "src", "lib", "workflow", "config.ts"),
  "utf8"
);
comprobar(
  "la puerta pregunta por el dato, y por las dos prestadas",
  /isOrderBumpActive\(\) \|\|\s*\r?\n?\s*vendeConPresentacionPrestada\(cfg, "dos_juntas"\) \|\|\s*\r?\n?\s*modo === "order_bump" \|\|\s*\r?\n?\s*modo === "doble_oferta_upsell"/.test(
    fuente
  ),
  "y conserva los dos nombres"
);
comprobar(
  "y su hermana se apoya en el mismo punto de verdad",
  /export function laModalidadActivaEsOrderBump\(\): boolean \{\s*\r?\n\s*return isOrderBumpActive\(\);/.test(
    fuente
  ),
  "un solo sitio decide"
);
comprobar(
  "la casilla vacia cae al precio que cobra",
  /comboPrice = comboPrice \?\? delQueCobra\("combo"\);/.test(fuente),
  "getOrderBumpPriceSoles"
);
// EL NOMBRE ENTERO DENTRO DE LA FRASE, y solo cuando los dos nombres no se
// solapan: ahi manda `opcionNombradaPorLoCompartido`, que sabe si el cliente solo
// esta repitiendo la que ya tenia.
comprobar(
  "el nombre completo dentro de la frase elige",
  /const comboDentro = dentroDeLaFrase\(nombreCombo\);/.test(fuente),
  "«creo que el <nombre>»"
);
comprobar(
  "pero no cuando un nombre esta dentro del otro",
  /if \(!unNombreDentroDelOtro\) \{/.test(fuente),
  "ese caso tiene su lectura"
);
comprobar(
  "y solo el NOMBRE, nunca los alias",
  /normalize\(nombreDeLaOpcion\(cual, config\) \?\? ""\)/.test(fuente),
  "hubo un alias que era «quiero»"
);
comprobar(
  "y con las dos casillas llenas manda lo de siempre",
  /if \(comboPrice === null \|\| basicoPrice === null\) \{/.test(fuente),
  "no se toca lo que ya servia"
);

process.chdir(RAIZ);
console.log(
  fallos === 0
    ? "\nTODO OK — «como ob» lee al cliente como -OB-\n"
    : `\n${fallos} comprobacion(es) mal.\n`
);
process.exit(fallos === 0 ? 0 : 1);
