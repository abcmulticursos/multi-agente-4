// Un seguimiento es UNA lista de cajones, y lo que se envia no cambia.
//
// LO QUE PIDIO EL DUENO el 15 de septiembre de 2026: que «Mensajes principales»
// deje de ser una pestana especial —sin botones, sin renombrar, sin duplicar— y
// pase a ser el primer cajon de una lista de hermanos, como en Intro; y que
// «Variantes» desaparezca de la pantalla.
//
// POR QUE NO CAMBIA LO QUE SE ENVIA
//
//   El motor ya los trataba igual. Arma UNA bolsa de candidatos con el principal
//   y las variantes que esten ENCENDIDOS y con texto, y saca uno al azar:
//
//       if (seq.steps_enabled !== false && base.steps.length > 0 && ...) push()
//       for (const variant of seq.variants) if (variant.enabled !== false ...) push()
//       return pool[Math.floor(Math.random() * pool.length)];
//
//   El principal no tenia ninguna preferencia. Asi que mover su contenido a la
//   cabeza de la lista deja la bolsa EXACTAMENTE igual: los mismos textos, el
//   mismo numero de candidatos.
//
// ESTA PRUEBA LO MIDE SOBRE EL CONTENIDO REAL DEL DUENO: cuenta la bolsa antes,
// ejecuta la migracion de verdad —extraida del editor— y vuelve a contarla.
//
//   node scripts/prueba-el-seguimiento-es-una-sola-lista.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const RAIZ = process.cwd();
const require = createRequire(join(RAIZ, "package.json"));
const yaml = require("js-yaml");
const editor = readFileSync(join(RAIZ, "src", "app", "editor", "page.tsx"), "utf8");
const motor = readFileSync(
  join(RAIZ, "src", "lib", "workflow", "engine.ts"),
  "utf8"
);
const cfg = yaml.load(
  readFileSync(join(RAIZ, "config", "intro-data.yaml"), "utf8")
);

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 56)} ${valor}`);
};
const trozo = (fuente, desde, hasta) => {
  const i = fuente.indexOf(desde);
  if (i < 0) return "";
  const f = fuente.indexOf(hasta, i);
  return f < 0 ? fuente.slice(i) : fuente.slice(i, f);
};

// ── La migracion real, sacada del editor ─────────────────────────────────────
// Hasta la linea que la usa: asi se lleva la funcion ENTERA, con su cierre.
const fuenteMigracion = trozo(
  editor,
  "      const bajarPrincipalALaLista = (",
  "\n      loaded.followups = "
)
  // La firma ocupa varias lineas y lleva tipos: se quitan uno a uno. Con un
  // regex generico se comia media funcion, porque el `) => {` de la firma lleva
  // el tipo de retorno en medio y el siguiente que casa es el del `.map`.
  .replace("lista: EditorFollowup[] | undefined", "lista")
  .replace("): EditorFollowup[] | undefined => {", ") => {")
  .replace(/: EditorFollowupVariant/g, "")
  .replace(/ as EditorStep\[\]/g, "");

comprobar(
  "se encuentra la migracion",
  fuenteMigracion.includes("bajarPrincipalALaLista"),
  "bajarPrincipalALaLista"
);

const migrar = (lista) =>
  new Function(
    "lista",
    `${fuenteMigracion}\n      return bajarPrincipalALaLista(lista);`
  )(lista);

// ── La bolsa del sorteo, tal como la arma el motor ───────────────────────────
//
// Mismas condiciones, leidas del motor: encendido, con pasos, y con alguna
// burbuja que salga de verdad.
const saleDeVerdad = (paso) => {
  if (!paso || paso.enabled === false) return false;
  const texto =
    paso.body ??
    (paso.body_variants ?? [])[0] ??
    (paso.texts ?? [])[0] ??
    paso.caption ??
    paso.drive_url ??
    "";
  return String(texto).trim().length > 0;
};
const bolsa = (seg) => {
  const dentro = [];
  if (seg.steps_enabled !== false && (seg.steps ?? []).some(saleDeVerdad)) {
    dentro.push(JSON.stringify(seg.steps));
  }
  for (const v of seg.variants ?? []) {
    if (v.enabled !== false && (v.steps ?? []).some(saleDeVerdad)) {
      dentro.push(JSON.stringify(v.steps));
    }
  }
  return dentro;
};

// ── 1. SOBRE EL CONTENIDO REAL: LA BOLSA NO CAMBIA ───────────────────────────
console.log("\n— sobre su contenido de verdad —\n");
const sitios = [];
if (Array.isArray(cfg.followup_sequences))
  sitios.push(["raiz", cfg.followup_sequences]);
for (const ch of ["whatsapp", "messenger", "instagram"]) {
  const mt = cfg.channels?.[ch]?.modality_templates ?? {};
  for (const m of Object.keys(mt))
    if (Array.isArray(mt[m]?.followups)) sitios.push([`${ch}/${m}`, mt[m].followups]);
}
for (const m of Object.keys(cfg.modality_templates ?? {})) {
  const f = cfg.modality_templates[m]?.followups;
  if (Array.isArray(f)) sitios.push([`modalidad ${m}`, f]);
}

let mirados = 0;
let movidos = 0;
let bolsasIguales = 0;
let bolsasDistintas = [];
for (const [donde, lista] of sitios) {
  // El editor guarda las burbujas como `texts`; el archivo como
  // `body_variants`. Para contar la bolsa da igual: se compara el ANTES contra
  // el DESPUES con la misma regla en los dos lados.
  const antes = lista.map(bolsa);
  const despues = migrar(JSON.parse(JSON.stringify(lista))).map(bolsa);
  lista.forEach((seg, i) => {
    mirados++;
    if ((seg.steps ?? []).some(saleDeVerdad)) movidos++;
    const a = antes[i].slice().sort();
    const d = despues[i].slice().sort();
    if (JSON.stringify(a) === JSON.stringify(d)) bolsasIguales++;
    else bolsasDistintas.push(`${donde} #${i + 1}: ${a.length} -> ${d.length}`);
  });
}
console.log(`     seguimientos mirados          : ${mirados}`);
console.log(`     con contenido que se mueve    : ${movidos}`);
console.log(`     con la MISMA bolsa despues    : ${bolsasIguales}`);
comprobar(
  "la bolsa del sorteo es identica en TODOS",
  bolsasDistintas.length === 0,
  bolsasDistintas.length ? bolsasDistintas.join(" · ") : "mismos textos, mismo numero"
);
// ESTA COMPROBACION EXISTIA PARA QUE LA DE ARRIBA NO FUERA VACIA: comparar dos
// bolsas identicas no prueba nada si no habia nada que mover.
//
// El 15 de septiembre de 2026 el dueno deployo y guardo, y la migracion CORRIO:
// sus 45 seguimientos ya tienen el principal vacio y su contenido como cajon 1.
// Asi que `movidos` es cero con razon — y eso es justo lo que hay que exigir
// ahora: o queda algo por mover, o ya esta movido. Lo que no vale es que no haya
// ni lo uno ni lo otro, que seria contenido perdido.
const yaMigrados = sitios
  .flatMap(([, lista]) => lista)
  .filter(
    (seg) =>
      (seg.steps ?? []).length === 0 &&
      (seg.variants ?? []).some((v) => (v.steps ?? []).some(saleDeVerdad))
  ).length;
console.log(`     ya migrados de antes          : ${yaMigrados}`);
comprobar(
  "habia algo que mover, o ya estaba movido",
  movidos > 0 || yaMigrados > 0,
  movidos > 0 ? `${movidos} por mover` : `${yaMigrados} ya migrados`
);

// ── 2. ES IDEMPOTENTE ────────────────────────────────────────────────────────
//
// Abrir el editor mil veces no puede duplicar nada.
console.log("\n— y correrla dos veces no duplica nada —\n");
const unaVez = migrar(JSON.parse(JSON.stringify(sitios[0][1])));
const dosVeces = migrar(JSON.parse(JSON.stringify(unaVez)));
comprobar(
  "la segunda pasada no cambia nada",
  JSON.stringify(unaVez) === JSON.stringify(dosVeces),
  "idempotente"
);
comprobar(
  "el hueco viejo queda vacio y apagado",
  unaVez.every((s) => (s.steps ?? []).length === 0 && s.steps_enabled === false),
  "no puede volver a la bolsa"
);
comprobar(
  "y el principal entra el PRIMERO de la lista",
  unaVez.every(
    (s) => (s.variants ?? []).length === 0 || s.variants[0].name === "Mensajes principales"
  ),
  "a la cabeza, no al final"
);

// ── 3. CONSERVA SU ENCENDIDO ─────────────────────────────────────────────────
console.log("\n— y conserva encendido, anuncios y texto —\n");
const conApagado = migrar([
  {
    name: "x",
    delay_minutes_from_first_message: 1,
    steps: [{ type: "text", texts: ["hola"], drive_url: "" }],
    steps_enabled: false,
    ad_keys: ["k1"],
    ad_routing_enabled: false,
    variants: [],
  },
]);
comprobar(
  "el principal APAGADO llega apagado",
  conApagado[0].variants[0].enabled === false,
  "como estaba"
);
comprobar(
  "el principal ENCENDIDO llega encendido",
  migrar([
    {
      name: "y",
      delay_minutes_from_first_message: 1,
      steps: [{ type: "text", texts: ["hola"], drive_url: "" }],
      variants: [],
    },
  ])[0].variants[0].enabled === true,
  "como estaba"
);
comprobar(
  "se lleva sus etiquetas de anuncio",
  JSON.stringify(conApagado[0].variants[0].ad_keys) === '["k1"]' &&
    conApagado[0].variants[0].ad_routing_enabled === false,
  "no se pierde el enrutado"
);
comprobar(
  "y las variantes que ya habia se quedan detras",
  migrar([
    {
      name: "z",
      delay_minutes_from_first_message: 1,
      steps: [{ type: "text", texts: ["principal"], drive_url: "" }],
      variants: [{ name: "la mia", steps: [{ type: "text", texts: ["v"], drive_url: "" }] }],
    },
  ])[0].variants.map((v) => v.name).join(",") === "Mensajes principales,la mia",
  "en orden"
);
comprobar(
  "un seguimiento SIN texto en el principal no se toca",
  migrar([
    { name: "w", delay_minutes_from_first_message: 1, steps: [], variants: [] },
  ])[0].variants.length === 0,
  "no se inventa un cajón vacío"
);

// ── 4. LA PANTALLA: UNA SOLA LISTA, CON LA BARRA COMPLETA ────────────────────
console.log("\n— y en la pantalla, una sola lista —\n");
const seguimientos = trozo(
  editor,
  "function ChannelFollowupsEditor(",
  '\n      <button\n        type="button"\n        onClick={addFollowup}'
);
comprobar(
  "«Mensajes principales» ya no es una pestaña",
  !/title="💬 Mensajes principales"/.test(seguimientos),
  "es el cajón 1"
);
comprobar(
  "y «Variantes» tampoco",
  !/title="🎲 Variantes"/.test(seguimientos),
  "desaparece de la pantalla"
);
// LOS BOTONES PERDIERON SU PALABRA EL 30/09/2026 —la etiqueta de semimodalidad
// entra en esta fila y no cabía todo—, así que se reconocen por su `aria-label`.
// La intención de la comprobación no cambia: el cajón tiene los mismos controles
// que en Intro.
for (const [boton, marca] of [
  ["subir", 'aria-label="Subir este cajón"'],
  ["bajar", 'aria-label="Bajar este cajón"'],
  ["mover", 'aria-label="Arrastrar para moverlo de sitio"'],
  // DUPLICAR BAJO A LA FILA el 30/09/2026, a peticion del dueño: antes habia que
  // abrir el cajon para poder duplicarlo.
  ["duplicar", 'aria-label="Duplicar este cajón"'],
  ["la papelera", "🗑️"],
  ["el punto de encendido", "CirculoDeEncendido"],
  ["la etiqueta de semimodalidad", "PastillaDeSemimodalidad"],
]) {
  comprobar(
    `cada cajón tiene «${boton}»`,
    seguimientos.includes(marca),
    "como en Intro"
  );
}
comprobar(
  "arrastrar solo acepta cajones de ESTE seguimiento",
  /clase !== "cajon-seg" \|\| deQuien !== `\$\{channel\}-\$\{index\}`/.test(
    seguimientos
  ),
  "no se cruzan los seguimientos"
);
comprobar(
  "el botón de abajo ya no dice «variante»",
  /Agregar cajón/.test(seguimientos) && !/Agregar variante/.test(seguimientos),
  "aquí todos son cajones"
);
comprobar(
  "y el cajón nuevo nace en blanco y se llama «Cajón N»",
  /name: `Cajón \$\{variants\.length \+ 1\}`/.test(editor),
  "ya no hay un original del que variar"
);

// ── 5. EL MOTOR NO SE TOCA ───────────────────────────────────────────────────
console.log("\n— y el motor sigue igual —\n");
comprobar(
  "sigue armando UNA bolsa con los dos sitios",
  /seq\.steps_enabled !== false &&/.test(motor) &&
    /for \(const \[index, variant\] of \(seq\.variants \?\? \[\]\)\.entries\(\)\)/.test(
      motor
    ),
  "no hubo que tocarlo"
);
comprobar(
  "y saca uno al azar de la bolsa",
  /return pool\[Math\.floor\(Math\.random\(\) \* pool\.length\)\];/.test(motor),
  "el sorteo de siempre"
);

console.log(
  fallos === 0
    ? "\nTODO OK — una sola lista, y lo que se envia no cambia"
    : `\n${fallos} comprobacion(es) mal.`
);
process.exit(fallos === 0 ? 0 : 1);
