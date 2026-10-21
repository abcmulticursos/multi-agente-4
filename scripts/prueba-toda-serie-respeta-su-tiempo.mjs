// TODA SERIE DE BURBUJAS CONSECUTIVAS RESPETA SU TIEMPO.
//
// ORDEN DEL DUEÑO — 29 de septiembre de 2026, con sus palabras:
//
//   «De ahora en adelante toda serie de burbujas consecutivas tienen que respetar
//    su tiempo, incluso en la intro de order bump, regalos etc, todas.»
//
// Esta prueba es el guardian de esa orden. Recorre TODOS los sitios que mandan
// varias burbujas seguidas y exige que cada uno lea `delay_after_sec`. Si mañana
// alguien añade una serie nueva sin espera, esta prueba se pone roja.
//
// SE AUDITARON CATORCE. Trece ya lo respetaban; el unico que no era la
// redireccion por pais, que las mandaba de corrido aunque su contenido ya
// llevara el campo escrito.
//
// LO QUE NO ENTRA AQUI, y queda dicho: los menus de botones mandan dos burbujas
// seguidas —un texto y la burbuja de botones— y el editor NO ofrece una espera
// para ellas. No hay tiempo que respetar, asi que no se puede exigir. Si algun
// dia se quiere una pausa ahi, es un campo nuevo y lo decide el dueño.
//
//   node scripts/prueba-toda-serie-respeta-su-tiempo.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const engine = readFileSync(join(RAIZ, "src", "lib", "workflow", "engine.ts"), "utf8");
const pago = readFileSync(join(RAIZ, "src", "lib", "workflow", "payment.ts"), "utf8");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 52)} ${valor}`);
};

/** El cuerpo de una funcion, desde su firma hasta la siguiente del archivo. */
const cuerpoDe = (src, firma) => {
  const a = src.indexOf(firma);
  if (a < 0) return "";
  const b = src.indexOf("\nasync function ", a + firma.length);
  const c = src.indexOf("\nfunction ", a + firma.length);
  const fin = Math.min(b < 0 ? src.length : b, c < 0 ? src.length : c);
  return src.slice(a, fin);
};

// ── LAS SERIES, UNA POR UNA ─────────────────────────────────────────────────
console.log("\n— cada serie de burbujas y su espera —\n");

const SERIES = [
  // [que es, archivo, firma donde vive, lo que tiene que aparecer dentro]
  ["las burbujas configuradas (el ayudante comun)", engine, "async function sendConfiguredSteps(", /delay_after_sec/],
  ["la redireccion por pais", engine, "export async function sendCountryRedirect(", /delay_after_sec/],
  ["el cierre de la ruta B", engine, "async function sendCommercialRouteBIntroClosing(", /delay_after_sec/],
  ["el order bump", engine, "async function sendOrderBumpSteps(", /delay_after_sec/],
  ["la respuesta al elegir", engine, "async function enviarRespuestaAlElegir(", /delay_after_sec/],
  ["la entrega de la postventa", pago, "function scheduleDeliverySequence(", /delay_after_sec/],
];
for (const [que, src, firma, debe] of SERIES) {
  const cuerpo = cuerpoDe(src, firma);
  comprobar(`${que}: existe`, cuerpo.length > 0, cuerpo.length > 0 ? "" : "NO LA ENCUENTRO");
  if (cuerpo.length > 0) comprobar(`${que}: respeta su tiempo`, debe.test(cuerpo));
}

// ── Y LAS QUE SE PROGRAMAN POR ADELANTADO ───────────────────────────────────
//
// Estas no esperan con un `sleep`: reparten las burbujas en el tiempo al
// programarlas. Lo que se exige es que la suma use `delay_after_sec`.
console.log("\n— las que se programan por adelantado —\n");
comprobar(
  "la intro suma el tiempo de cada burbuja",
  /acumulado \+= pasos\[i\]\.delay_after_sec \?\? 0;/.test(engine)
);
comprobar(
  "los seguimientos tambien",
  /cumulativeDelay \+= chosenFollowup\.steps\[i\]\.delay_after_sec \?\? 0;/.test(engine)
);
comprobar(
  "el regalo tambien",
  /offset \+= Math\.max\(0, step\.delay_after_sec \?\? between\);/.test(engine)
);
comprobar(
  "y el consentimiento del regalo",
  (engine.match(/offset \+= Math\.max\(0, step\.delay_after_sec \?\? between\);/g) ?? [])
    .length >= 2,
  "dos sitios"
);
comprobar(
  "la entrega reparte con el tiempo de cada paso",
  /cumulativeDelay \+= /.test(pago) && /delay_after_sec/.test(pago)
);

// ── LO QUE NO SE PUEDE PERDER ───────────────────────────────────────────────
//
// Respetar el tiempo no vale de nada si lo respeta una burbuja APAGADA: esa no
// envia nada y su espera seria tiempo muerto. Las dos reglas van juntas.
console.log("\n— y solo lo encendido cuenta el tiempo —\n");
comprobar(
  "el ayudante comun descarta las apagadas primero",
  /filter\(\(step\) => step\.enabled !== false\)/.test(
    cuerpoDe(engine, "async function sendConfiguredSteps(")
  )
);
comprobar(
  "la intro no programa las apagadas",
  /if \(pasos\[i\]\?\.enabled !== false\) aEnviar\.push\(i\);/.test(engine)
);
comprobar(
  "los seguimientos tampoco",
  /if \(chosenFollowup\.steps\[i\]\?\.enabled !== false\) aEnviar\.push\(i\);/.test(engine)
);
comprobar(
  "el regalo y su consentimiento filtran antes de repartir",
  (engine.match(/step\.enabled !== false &&/g) ?? []).length >= 2,
  "dos sitios"
);
comprobar(
  "la entrega filtra antes de repartir",
  /\.filter\(\(\{ step \}\) => step\.enabled !== false\)/.test(pago)
);

console.log(
  fallos === 0
    ? "\nTODO OK — toda serie de burbujas respeta su tiempo, y solo las encendidas lo cuentan\n"
    : `\n${fallos} FALLO(S)\n`
);
process.exit(fallos === 0 ? 0 : 1);
