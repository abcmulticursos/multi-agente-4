// EL INTERRUPTOR DE LAS ETIQUETAS DE AD SE GUARDA, Y LA ETIQUETA TAMBIEN.
//
// LO QUE PASABA, contado como lo entendio el dueño el 24 de septiembre de 2026:
//
//   «Hay un boton verde ON/OFF al lado de las etiquetas de AD. Sirve para dejar
//    las etiquetas puestas pero que el bot no les haga caso, y ese seguimiento
//    vuelva a salir a todos. Lo apagas, guardas, refrescas, y aparece encendido
//    otra vez.»
//
// LA CAUSA, LA MISMA DE LAS BANDERAS: la ruta de guardado no COPIA el
// contenido, lo vuelve a construir campo por campo. El campo que no esta
// nombrado ahi se cae en silencio, sin error y sin aviso.
//
// Y AL MEDIR LA ZONA ENTERA APARECIERON TRES, no uno:
//
//   1. EL INTERRUPTOR (`ad_routing_enabled`) no se escribia en NINGUN sitio, y
//      tampoco se leia. El boton existe en pantalla y el motor lo obedece
//      —`engine.ts`, donde una etiqueta apagada se convierte en lista vacia—
//      pero nunca llegaba al archivo.
//   2. LA ETIQUETA DE LAS SUB PESTAÑAS DE CANALES se ESCRIBIA pero no se LEIA.
//      Vivia un guardado y moria en el siguiente: al abrir el editor volvia
//      vacia, y el guardado siguiente la borraba de verdad.
//   3. LA ETIQUETA DEL SEGUIMIENTO ENTERO EN CANALES no se escribia. Hoy no hay
//      selector para ella en esa pantalla, asi que no se nota; se nombra para
//      que un valor escrito a mano no desaparezca al primer guardado.
//
// LO QUE NO PUEDE ROMPERSE: sin ningun interruptor apagado —que es como esta su
// contenido— NADA cambia. Un interruptor que nadie toco vale ON, igual que
// antes.
//
//   node scripts/prueba-el-interruptor-de-ads-se-guarda.mjs
import { join } from "node:path";
import { readFileSync } from "node:fs";

const RAIZ = process.cwd();
const ruta = readFileSync(
  join(RAIZ, "src", "app", "api", "workflow", "route.ts"),
  "utf8"
);

let fallos = 0;
const comprobar = (titulo, ok, nota = "") => {
  if (!ok) fallos++;
  console.log(
    `${ok ? "ok   " : "FALLA"} ${titulo.padEnd(56).slice(0, 56)} ${nota}`
  );
};

// ── EL BANCO: LAS FUNCIONES DE VERDAD, SACADAS DEL ARCHIVO ──────────────────
//
// No se reescriben de memoria: un codigo reimplementado prueba lo que uno CREE
// que hace, que es justo lo que se esta poniendo en duda.
const sinTipos = (s) =>
  s
    .replace(/as Record<string, unknown>\[\]/g, "")
    .replace(/as Record<string, unknown>/g, "")
    .replace(/: Record<string, unknown>\[\]/g, "")
    .replace(/: Record<string, unknown>/g, "")
    .replace(/as EditorStep\[\]/g, "")
    .replace(/: EditorStep\[\]/g, "")
    .replace(/as unknown\[\]/g, "")
    .replace(/: unknown/g, "")
    .replace(/: string\[\]/g, "")
    .replace(/: string/g, "")
    .replace(/: number/g, "")
    .replace(/: boolean/g, "");

const cuerpoDesde = (fuente, nombre, arg, marcador) => {
  const i = fuente.indexOf(`function ${nombre}(`);
  const j = fuente.indexOf(marcador, i);
  const f = fuente.indexOf("\n}", j);
  return `function ${nombre}(${arg}) {\n${sinTipos(fuente.slice(j, f))}\n}`;
};

const PRELUDIO = `
  const str = (x) => (typeof x === "string" ? x : "");
  const num = (x, d) => (typeof x === "number" && Number.isFinite(x) ? x : d);
  const strList = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
  const readStep = (s) => s;
  const writeStep = (s) => s;
  const readPaymentMenu = (m) => ({ enabled: m?.enabled === true });
  // La TERCERA etiqueta (30/09/2026). Ver el mismo doble en la prueba de la bandera.
  const leeSemimodalidad = (v) => {
    const s = String(v ?? "").trim().toLowerCase();
    return s === "lineal" || s === "dou" || s === "ob" ? s : "";
  };
`;

/** El viaje de Canales: pantalla -> archivo -> pantalla. Con `conElArreglo` en
 *  false se borran las lineas nuevas, para ver el fallo como lo vio el dueño. */
const viajeDelCanal = (conElArreglo, cuerpo) => {
  const fuente = conElArreglo
    ? ruta
    : ruta
        .replace(/^\s*(ad_routing_enabled|adRoutingEnabled):.*$/gm, "")
        .replace(/\s*\.\.\.\([^)]*ad_routing_enabled[\s\S]*?:\s*\{\}\),/g, "")
        // La etiqueta de la sub pestaña, que ANTES se escribia y no se leia:
        // se quita solo de la lectura para reproducir ese medio viaje.
        .replace(
          /(function readChannelContent[\s\S]*?variants:[\s\S]{0,900}?)\n\s*ad_keys: strList\(variant\?\.ad_keys\),/,
          "$1"
        );
  const piezas = [
    cuerpoDesde(fuente, "readGruposDeIntro", "value", "  if (!Array.isArray(value)) return [];"),
    cuerpoDesde(fuente, "readChannelContent", "v", "  const c = (v ?? {})"),
    cuerpoDesde(fuente, "writeChannelContent", "content", "  const writeSteps ="),
    cuerpoDesde(fuente, "writeGruposDeIntro", "value", "  if (!Array.isArray(value)) return [];"),
  ].join("\n\n");
  return new Function(`${PRELUDIO}\n${piezas}\n${cuerpo}`)();
};

const CUERPO = `
  // Un canal como el suyo: un cajon de intro con su etiqueta y el boton
  // APAGADO, y un seguimiento con una sub pestaña igual.
  const delEditor = {
    intro_groups: [{
      name: "INTRO", weight: 1, steps: [],
      adKeys: ["ad_uno"], adRoutingEnabled: false,
    }],
    followups: [{
      name: "SEG1", delay_minutes_from_first_message: 60, steps: [],
      variants: [{
        name: "cajon", steps: [],
        ad_keys: ["ad_dos"], ad_routing_enabled: false,
      }],
    }],
    payment: [], delivery: [], delivery_groups: [],
    order_bump_intro_groups: [], upsell_intro_groups: [], post_sale: {},
  };
  const foto = (c) => [
    (c.intro_groups?.[0]?.adKeys ?? []).join("") || "-",
    c.intro_groups?.[0]?.adRoutingEnabled === false ? "OFF" : "ON",
    (c.followups?.[0]?.variants?.[0]?.ad_keys ?? []).join("") || "-",
    c.followups?.[0]?.variants?.[0]?.ad_routing_enabled === false ? "OFF" : "ON",
  ].join(" ");

  const enElArchivo = writeChannelContent(delEditor);
  const alRefrescar = readChannelContent(enElArchivo);
  // Y el segundo guardado, que es donde moria la etiqueta de la sub pestaña.
  const trasGuardarOtraVez = writeChannelContent(alRefrescar);
  return [foto(delEditor), foto(enElArchivo), foto(alRefrescar), foto(trasGuardarOtraVez)];
`;

console.log("-- el viaje del interruptor, escalon a escalon -------------");
const [pantalla, archivo, refresco, segundoGuardado] = viajeDelCanal(true, CUERPO);
console.log(`     1. lo que manda la pantalla    ${pantalla}`);
console.log(`     2. escrito en el archivo       ${archivo}`);
console.log(`     3. leido al refrescar          ${refresco}`);
console.log(`     4. tras guardar otra vez       ${segundoGuardado}`);
comprobar(
  "el interruptor y la etiqueta llegan al archivo",
  archivo === pantalla,
  "cajon de intro y sub pestaña"
);
comprobar("y siguen ahi al refrescar", refresco === pantalla, "vuelven a la pantalla");
comprobar(
  "y aguantan un segundo guardado",
  segundoGuardado === pantalla,
  "aqui moria la etiqueta de la sub pestaña"
);

console.log("\n-- y asi se perdia antes ----------------------------------");
const [, sinArreglo, , sinArregloDos] = viajeDelCanal(false, CUERPO);
console.log(`     2. escrito en el archivo       ${sinArreglo}`);
console.log(`     4. tras guardar otra vez       ${sinArregloDos}`);
comprobar(
  "sin el arreglo el interruptor volvia a ON",
  sinArreglo.includes("ON") && !sinArreglo.includes("OFF"),
  "el rojo que el vio"
);
comprobar(
  "y la etiqueta de la sub pestaña moria al segundo guardado",
  sinArregloDos.split(" ")[2] === "-",
  "vivia un guardado"
);

// ── LOS SEGUIMIENTOS DE LA MODALIDAD ────────────────────────────────────────
//
// Esos no pasan por `writeChannelContent`: tienen su propio tramo, donde el
// YAML se deja limpio y solo se escribe lo APAGADO.
console.log("\n-- los seguimientos de la modalidad ------------------------");
comprobar(
  "el interruptor del seguimiento se escribe",
  /\{ ad_routing_enabled: false \}/.test(ruta),
  "solo cuando esta apagado"
);
comprobar(
  "y el de su sub pestaña tambien",
  (ruta.match(/\{ ad_routing_enabled: false \}/g) ?? []).length >= 2,
  "los dos niveles"
);
comprobar(
  "y los dos se vuelven a leer",
  /ad_routing_enabled: f\?\.ad_routing_enabled !== false/.test(ruta) &&
    /ad_routing_enabled: v\?\.ad_routing_enabled !== false/.test(ruta),
  "o no volverian a la pantalla"
);

// ── LO QUE NO PUEDE CAMBIAR ─────────────────────────────────────────────────
console.log("\n-- sin nada apagado, nada cambia --------------------------");
const [pantallaLimpia, archivoLimpio, refrescoLimpio] = viajeDelCanal(
  true,
  `
  const delEditor = {
    intro_groups: [{ name: "INTRO", weight: 1, steps: [], adKeys: ["ad_uno"] }],
    followups: [{
      name: "SEG1", delay_minutes_from_first_message: 60, steps: [],
      variants: [{ name: "cajon", steps: [], ad_keys: ["ad_dos"] }],
    }],
    payment: [], delivery: [], delivery_groups: [],
    order_bump_intro_groups: [], upsell_intro_groups: [], post_sale: {},
  };
  const foto = (c) => [
    (c.intro_groups?.[0]?.adKeys ?? []).join("") || "-",
    c.intro_groups?.[0]?.adRoutingEnabled === false ? "OFF" : "ON",
    (c.followups?.[0]?.variants?.[0]?.ad_keys ?? []).join("") || "-",
    c.followups?.[0]?.variants?.[0]?.ad_routing_enabled === false ? "OFF" : "ON",
  ].join(" ");
  const enElArchivo = writeChannelContent(delEditor);
  return [foto(delEditor), foto(enElArchivo), foto(readChannelContent(enElArchivo))];
`
);
comprobar(
  "un interruptor que nadie toco vale ON",
  pantallaLimpia.includes("ON") && !archivoLimpio.includes("OFF"),
  "como antes del arreglo"
);
comprobar(
  "y las etiquetas siguen llegando enteras",
  refrescoLimpio === pantallaLimpia,
  "no se perdio ninguna"
);

console.log(
  fallos === 0
    ? "\nTODO OK — el interruptor y la etiqueta sobreviven al guardado\n"
    : `\n${fallos} comprobacion(es) mal.\n`
);
process.exit(fallos === 0 ? 0 : 1);
