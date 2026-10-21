// «El bot no sabe reconocer cuando 2 productos tienen el mismo nombre».
//
// Con un KIT EMPRENDEDOR FULL y un KIT EMPRENDEDOR BASICO, el cliente escribia
// «el kit emprendedor» —que no dice cual— y el bot entregaba el BASICO sin
// preguntar. Un niño de 8 anos ve que hay dos; el bot no.
//
// POR QUE. La comparacion no miraba los nombres de los productos, sino OTRO
// campo —el nombre de la opcion dentro de la oferta— que es lo mismo escrito
// dos veces y que suele quedarse vacio o con el texto de muestra
// «<<NOMBRE_OPCION_COMBO>>». Con ese campo en blanco el bot se quedaba sin nada
// que comparar: ni reconocia la eleccion diciendo el nombre exacto, ni podia
// notar que dos productos se llaman casi igual. El turno acababa en el modelo,
// que si adivina — y adivinaba mal.
//
// LA REGLA, QUE ES GENERICA. No hay ningun nombre de producto escrito en el
// codigo. Se comparan los nombres reales: las palabras que comparten y las que
// distinguen. Si el cliente dice SOLO palabras compartidas, no eligio → se le
// pregunta cual. Vale para «plan emprendedor», «super kit», o lo que sea.
//
//   node scripts/prueba-dos-productos-con-el-mismo-nombre.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");
const tipos = leer("src", "lib", "workflow", "config.ts");
const motor = leer("src", "lib", "workflow", "engine.ts");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// ── 1. El nombre sale de donde el operador lo escribio UNA vez ──────────────
const helper = (() => {
  const i = tipos.indexOf("export function nombreDeLaOpcion(");
  return i < 0 ? "" : tipos.slice(i, i + 1200);
})();
comprobar("existe el nombre efectivo de la opcion", helper.length > 0, "nombreDeLaOpcion");
comprobar(
  // Sin esto, un «<<NOMBRE_OPCION_COMBO>>» cuenta como nombre y arruina la
  // comparacion: parece que hay nombre y no lo hay.
  "un texto de muestra no cuenta como nombre",
  /valor\.includes\("<<"\) && valor\.includes\(">>"\)/.test(helper),
  "cuenta como vacio"
);
comprobar(
  "y cae al nombre del producto por su papel",
  /nombresDeLosProductos\(cfg\)/.test(helper) &&
    /cual === "combo" \? porPapel\.full : porPapel\.base/.test(helper),
  "sin campos duplicados"
);

// ── 2. Lo usan los dos que deciden ─────────────────────────────────────────
for (const [que, marca] of [
  ["reconocer la eleccion", "detectExactOrderBumpChoice"],
  ["notar que se llaman igual", "isAmbiguousTwoTierChoice"],
]) {
  const i = tipos.indexOf(`export function ${marca}(`);
  const trozo = i < 0 ? "" : tipos.slice(i, i + 2200);
  comprobar(
    // Puede llamarlo directamente o a traves de `tokensPropiosDeCadaOpcion`,
    // que es quien calcula —en un solo sitio— que palabra distingue a cada
    // opcion. Lo que se vigila es que NO vuelva a una lista escrita a mano.
    `${que} usa el nombre efectivo`,
    /nombreDeLaOpcion\((cual|"combo"|"basico")/.test(trozo) ||
      /tokensPropiosDeCadaOpcion\(config\)/.test(trozo),
    marca
  );
}
comprobar(
  "y la pregunta al cliente nombra los productos",
  /nombreDeLaOpcion\("combo", config\) \|\| "la opción Full"/.test(motor),
  "no «la opción Full»"
);

// ── 3. LA REGLA, contra los casos reales ───────────────────────────────────
//
// Se reproduce la comparacion tal como la hace el motor, para poder probarla
// con nombres de verdad sin arrancar el bot entero.
const normalize = (v) =>
  String(v ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .filter(Boolean);
const ignored = new Set(["el","la","los","las","de","del","un","una","y","o","quiero","prefiero","elijo","escojo","dame","con","solo","curso","cursos","kit","producto","productos","opcion","opciones"]);
const decidir = (nCombo, nBasico, msg) => {
  const combo = new Set(normalize(nCombo));
  const basico = new Set(normalize(nBasico));
  const shared = new Set([...combo].filter((t) => basico.has(t)));
  const comboOnly = new Set([...combo].filter((t) => !basico.has(t)));
  const basicoOnly = new Set([...basico].filter((t) => !combo.has(t)));
  const words = normalize(msg).filter((w) => !ignored.has(w));
  const c = words.some((w) => comboOnly.has(w));
  const b = words.some((w) => basicoOnly.has(w));
  if (c !== b) return c ? "full" : "basico";
  if (shared.size === 0) return "nada";
  if (words.length === 0 || !words.some((w) => shared.has(w))) return "nada";
  return "pregunta";
};

const FULL = "KIT EMPRENDEDOR FULL";
const BASE = "KIT EMPRENDEDOR BASICO";
const CASOS = [
  // Solo palabras compartidas: no eligio, hay que preguntar.
  ["el kit emprendedor", "pregunta"],
  ["quiero el emprendedor", "pregunta"],
  ["emprendedor", "pregunta"],
  // Dice la palabra que distingue: eso SI es elegir.
  ["el kit emprendedor full", "full"],
  ["quiero el basico", "basico"],
  ["full", "full"],
];
for (const [frase, esperado] of CASOS) {
  const salio = decidir(FULL, BASE, frase);
  comprobar(
    `«${frase}»`,
    salio === esperado,
    `${salio}${salio === esperado ? "" : ` (esperaba ${esperado})`}`
  );
}
// Y con nombres que NO se parecen, nada cambia: no hay ambiguedad que inventar.
comprobar(
  "con nombres distintos no pregunta de mas",
  decidir("PACK 2 EN 1", "GRAFISMO FONETICO", "quiero el pack") === "full" &&
    decidir("PACK 2 EN 1", "GRAFISMO FONETICO", "grafismo") === "basico",
  "sigue eligiendo directo"
);

console.log(
  fallos === 0
    ? "\nTODO OK — si dos productos se llaman casi igual, el bot pregunta cual"
    : `\n${fallos} FALLA(S)`
);
process.exit(fallos === 0 ? 0 : 1);
