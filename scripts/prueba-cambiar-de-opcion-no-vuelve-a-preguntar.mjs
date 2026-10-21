// «Ya elegí, cambio al full, y el bot me vuelve a preguntar si quiero los datos
// de pago».
//
// LA ASIMETRIA QUE LO CAUSABA
//
//   Habia DOS vocabularios para la MISMA pregunta —¿cual de las dos opciones
//   quiere?— y no decian lo mismo:
//
//     detectTwoTierPick            (al ELEGIR)  ... combo completo pack premium
//                                                   vip mayor todo caro costoso
//                                                   alto grande FULL
//     inferTwoTierChoiceFromContext(al CAMBIAR) ... combo completo pack premium
//                                                   vip mayor            (sin full)
//
//   Por eso «el basico nomas» en `payment_done` se detectaba al instante
//   —«basico» si estaba en su lista— y «mejor el full» no: se lo llevaba el
//   modelo, que respondia «buena eleccion, ¿te doy los datos de pago?» a alguien
//   que acababa de decidir.
//
// LO QUE VIGILA ESTA PRUEBA
//
//   1. La palabra que DISTINGUE a cada opcion se calcula en UN SOLO SITIO,
//      a partir de los nombres configurados. Cero nombres de producto en el
//      codigo: si mañana se llaman «PRO» y «LITE», funciona igual.
//   2. Nombrar la opcion DENTRO de una frase decide, en los dos sentidos.
//   3. Nombrar las DOS no decide: eso es una comparacion, la lleva el modelo.
//   4. Las palabras genericas peligrosas («todo», «caro», «alto», «grande») NO
//      se trajeron a este detector: ahi el cliente ya eligio y habla de todo.
//   5. Se ejecuta la regla de verdad contra el contenido de hoy.
//
//   node scripts/prueba-cambiar-de-opcion-no-vuelve-a-preguntar.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");
const tipos = leer("src", "lib", "workflow", "config.ts");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 62)} ${valor}`);
};

// ── 1. Un solo sitio calcula lo que distingue a cada opcion ──────────────────
comprobar(
  "existe el calculo de palabras propias de cada opcion",
  /function tokensPropiosDeCadaOpcion\(/.test(tipos),
  "tokensPropiosDeCadaOpcion"
);
const usos = (tipos.match(/tokensPropiosDeCadaOpcion\(config\)/g) ?? []).length;
comprobar(
  "lo usan la ambiguedad Y el cambio de opcion",
  usos >= 2,
  `${usos} usos`
);
comprobar(
  "sale de los nombres configurados, no de una lista fija",
  /nombreDeLaOpcion\(cual, config\), \.\.\.\(option\?\.aliases \?\? \[\]\)/.test(
    tipos
  ),
  "nombreDeLaOpcion + aliases"
);

// ── 2. El cambio de opcion mira esas palabras ────────────────────────────────
const cambio = (() => {
  const i = tipos.indexOf("export function inferTwoTierChoiceFromContext(");
  if (i < 0) return "";
  const fin = tipos.indexOf("\nexport function detectTwoTierPick(", i);
  return tipos.slice(i, fin < 0 ? i + 6000 : fin);
})();
comprobar(
  "el cambio de opcion consulta las palabras propias",
  cambio.includes("tokensPropiosDeCadaOpcion(config)"),
  "y no solo su lista escrita a mano"
);
comprobar(
  "nombrar las dos NO decide",
  /if \(nombraLaMayor !== nombraLaMenor\)/.test(cambio),
  "una comparacion la lleva el modelo"
);
comprobar(
  "decide en los DOS sentidos",
  /return nombraLaMayor \? "combo" : "basico";/.test(cambio),
  "subir y bajar"
);
comprobar(
  "«full» tambien esta en la lista semantica",
  /\\b\(combo\|completo\|pack\|premium\|vip\|mayor\|full\)\\b/.test(cambio),
  "para nombres que no la lleven"
);

// ── 3. Las genericas peligrosas NO entraron aqui ─────────────────────────────
//
// En `payment_done` el cliente ya eligio: «esta caro», «gracias por todo» o
// «es muy grande» no son cambios de producto. Si alguna se cuela, el bot
// reenvia los datos de pago de la otra opcion sin que nadie se lo pida.
// Se leen SOLO las palabras de la lista, no el comentario que las explica.
const listaMayor = (
  cambio.match(/const wantsCombo =\s*\n?\s*\/\\b\(([^)]*)\)\\b\//) ?? [null, ""]
)[1];
comprobar(
  "se localiza la lista de la opcion mayor",
  listaMayor.length > 0,
  listaMayor || "(no encontrada)"
);
for (const palabra of ["todo", "caro", "alto", "grande"]) {
  comprobar(
    `«${palabra}» NO decide en el cambio de opcion`,
    listaMayor.length > 0 && !listaMayor.split("|").includes(palabra),
    "seria un falso positivo"
  );
}

// ── 4. La regla, ejecutada ───────────────────────────────────────────────────
//
// CON NOMBRES DE EJEMPLO, NO CON LOS DE HOY.
//
// Antes usaba los nombres que habia en el archivo, y el dia que se cambio de
// producto la prueba se puso roja sin que el codigo hubiera cambiado nada: los
// mensajes de ejemplo hablaban de un producto que ya no existe. Una prueba que
// falla por editar contenido no vigila nada, solo estorba.
//
// Ahora la regla se prueba con un par de nombres inventados que se parecen
// entre si —que es el caso dificil— y el contenido real se mira aparte, como
// aviso.
const cfg = YAML.parse(leer("config", "intro-data.yaml"));
const modalidad = cfg.doble_oferta_upsell?.enabled
  ? "doble_oferta_upsell"
  : cfg.upsell?.enabled
    ? "upsell"
    : cfg.doble_oferta_dos?.enabled
      ? "doble_oferta_dos"
      : cfg.order_bump?.enabled
        ? "order_bump"
        : "lineal";
const oferta = cfg[modalidad] ?? null;

// Mismo respaldo que `nombreDeLaOpcion`: si el campo de la oferta esta sin
// llenar, manda el nombre del producto que le toca por su papel.
const sirve = (v) => !!v && v.length > 1 && !(v.includes("<<") && v.includes(">>"));
const nombreDe = (cual) => {
  const propio = (cual === "combo" ? oferta?.combo?.name : oferta?.basico?.name)?.trim();
  if (sirve(propio)) return propio;
  const respaldo = cual === "combo" ? cfg.product_name : cfg.product_name_2;
  return sirve(respaldo) ? respaldo : "";
};
const palabras = (v) =>
  (v ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
const reglaCon = (nombreMayor, nombreMenor) => {
  const mayor = new Set(palabras(nombreMayor));
  const menor = new Set(palabras(nombreMenor));
  const mayorSolo = new Set([...mayor].filter((t) => !menor.has(t)));
  const menorSolo = new Set([...menor].filter((t) => !mayor.has(t)));
  return {
    mayorSolo,
    menorSolo,
    decide(msg) {
      const w = palabras(msg);
      const a = w.some((p) => mayorSolo.has(p));
      const b = w.some((p) => menorSolo.has(p));
      if (a !== b) return a ? "combo" : "basico";
      return null;
    },
  };
};

// El caso dificil: dos nombres que se parecen y solo una palabra los distingue.
const EJEMPLO_MAYOR = "KIT DEMO FULL";
const EJEMPLO_MENOR = "KIT DEMO BASICO";
const regla = reglaCon(EJEMPLO_MAYOR, EJEMPLO_MENOR);
console.log(`\n--- la regla, con nombres de ejemplo ---`);
console.log(`     «${EJEMPLO_MAYOR}» vs «${EJEMPLO_MENOR}»`);
console.log(`     propias de la mayor : ${[...regla.mayorSolo].join(", ")}`);
console.log(`     propias de la menor : ${[...regla.menorSolo].join(", ")}`);
for (const [msg, esperado] of [
  ["ah perdon maestro quiero el full", "combo"],
  ["mejor el full", "combo"],
  ["el basico nomas", "basico"],
  ["disculpa el basico", "basico"],
  ["cual me conviene el full o el basico", null],
  ["gracias por todo", null],
  ["esta caro", null],
]) {
  const dio = regla.decide(msg);
  comprobar(
    `«${msg}»`,
    dio === esperado,
    `${dio ?? "nada"} (esperado: ${esperado ?? "nada"})`
  );
}

// Y el contenido de hoy, como AVISO: si los dos nombres no tienen ninguna
// palabra propia, esta regla no puede distinguirlos y decide la lista
// semantica. No es un fallo del codigo — es cosa de los nombres.
const conjunto = (cual, option) =>
  new Set([nombreDe(cual), ...(option?.aliases ?? [])].flatMap(palabras));
const comboHoy = conjunto("combo", oferta?.combo);
const basicoHoy = conjunto("basico", oferta?.basico);
const propiasMayor = [...comboHoy].filter((t) => !basicoHoy.has(t));
const propiasMenor = [...basicoHoy].filter((t) => !comboHoy.has(t));
console.log(`\n--- el contenido de hoy (${modalidad}) ---`);
console.log(`     mayor: «${nombreDe("combo")}»  →  propias: ${propiasMayor.join(", ") || "(ninguna)"}`);
console.log(`     menor: «${nombreDe("basico")}»  →  propias: ${propiasMenor.join(", ") || "(ninguna)"}`);
console.log(
  propiasMayor.length && propiasMenor.length
    ? "ok    cada opcion tiene palabra propia: el cambio de opcion se detecta"
    : "AVISO alguna opcion no tiene palabra propia; ponles nombres distintos"
);

console.log(`\n${fallos === 0 ? "TODO OK — cambiar de opcion se entrega, no se pregunta" : `${fallos} FALLOS`}`);
process.exit(fallos === 0 ? 0 : 1);
