// EL «SÍ» AL CAMBIO QUE PROPONE EL BOT SE REGISTRA, ESCRIBA COMO ESCRIBA.
//
// LO QUE PASÓ — 25 de septiembre de 2026, conversación 136 del dueño. Tenía la
// opción CARA elegida y los datos de pago ya enviados. Escribió:
//
//     él:   «no me alcanzamejor el otro»
//     bot:  «¡Claro, lo entiendo perfectamente!»
//           «La otra opción es <la barata>, que incluye …»
//           «¿Te gustaría ir por esa opción?»
//     él:   «si»
//     bot:  «Claro, aquí te envío los datos nuevamente» + los datos de LA CARA
//
// El bot entendió y propuso bien; el motor no registró nada y le reenvió la
// opción que ya tenía. Con sus palabras: «estamos regresando al juego de las
// letritas — o sea que si la palabra no encaja se corrompe el resultado, eso no
// puede pasar».
//
// EL ESCALÓN, medido con su texto real contra la función real:
// `laOpcionQueElBotPropuso` devolvía vacío. Se salía en el freno que exige que
// el cierre del bot esté entre DIECISIETE frases conocidas o que el turno lleve
// un precio. «¿Te gustaría ir por esa opción?» es la dieciochoava, y detrás
// viene la diecinueve: esas burbujas LAS REDACTA EL MODELO, no están escritas
// en ningún archivo. Perseguir la frase siguiente es la trampa que CLAUDE.md
// prohíbe.
//
// LO QUE SE HIZO. Cuando el cliente YA TIENE UNA OPCIÓN ELEGIDA, nombrar la
// OTRA ya es proponer el cambio: es lo único que puede ocurrir ahí, porque las
// dos puertas que atienden exigen que sea DISTINTA de la que tiene. Se decide
// por el NOMBRE, que sale de su editor — no por cómo redacte el modelo.
//
// LO QUE NO PUEDE ROMPERSE:
//
//   · LA PRIMERA ELECCIÓN SIGUE IGUAL. Sin ninguna opción elegida se siguen
//     exigiendo la frase o el precio, porque ahí sí se estrenaría una opción que
//     nadie pidió — el «¿ya trabajaste con <opción>?» de la intro.
//   · EL MENÚ NO ELIGE. Si el bot nombra las DOS, esto devuelve vacío: «¿cuál
//     prefieres?» + «sí» no decide nada, ni antes ni ahora.
//   · Y SI NO NOMBRA NINGUNA, tampoco.
//
//   node scripts/prueba-el-si-al-cambio-que-propone-el-bot.mjs
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
          "export const getConversationByPhone=()=>null;export const getFrozenPrices=()=>null;export const getUpsellFrozenPrices=()=>null;export const getPuestoEnLaFila=()=>null;export const leerCompradosDeLaFila=()=>[];export const moverLaFila=()=>{};export const setFrozenPrices=()=>{};",
      };
    return next(url, ctx);
  },
});

// Nombres INVENTADOS, como manda la casa: una prueba escrita con los productos
// reales tapa justo el fallo que la regla evita.
const CARA = "TORNADO AZUL";
const BARATA = "CANELA SIMPLE";
const CASA = mkdtempSync(join(tmpdir(), "sialcambio-"));
mkdirSync(join(CASA, "config"), { recursive: true });
const ARCHIVO = join(CASA, "config", "intro-data.yaml");
writeFileSync(
  ARCHIVO,
  aYaml({
    country: "PE",
    greeting: { body_variants: ["hola"] },
    intro_sequence: [{ type: "text", body_variants: ["la intro"] }],
    payment_responses: { yape: [{ type: "text", body_variants: ["datos"] }] },
    biblioteca_de_productos: [
      { id: "pb", name: BARATA, price_soles: 20 },
      { id: "pf", name: CARA, price_soles: 30 },
    ],
    alineacion_por_modalidad: {
      order_bump: { basico: "pb", complementario: "pf", full: "pf" },
    },
    order_bump: {
      enabled: true,
      combo: { name: CARA, price_soles: 30 },
      basico: { name: BARATA, price_soles: 20 },
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
const lee = (texto, yaTiene) =>
  m.laOpcionQueElBotPropuso(texto, cfg, {
    elClienteYaTieneUnaElegida: yaTiene,
  });

// ── 1. SU CASO, LETRA POR LETRA ─────────────────────────────────────────────
console.log("-- 1. su conversacion 136 ---------------------------------");
// Las cuatro burbujas de su turno, juntas como las lee el motor.
const SU_TURNO = [
  "¡Claro, lo entiendo perfectamente! 😊",
  `La otra opción es el ${BARATA}, que incluye 5 libros didácticos para el aprendizaje verbal.`,
  `La otra opción es el ${BARATA}, que incluye 5 libros didácticos para el aprendizaje verbal.`,
  "¿Te gustaría ir por esa opción? 😊",
].join("\n");
comprobar(
  "teniendo la cara, propone la barata -> la barata",
  lee(SU_TURNO, true) === "basico",
  "sin frase conocida y sin precio"
);
comprobar(
  "y al reves: propone la cara -> la cara",
  lee(
    `También tienes el ${CARA}, que trae las dos cosas. ¿Te gustaría ir por esa opción?`,
    true
  ) === "combo",
  "el cambio vale en los dos sentidos"
);

// ── 2. LA PRIMERA ELECCIÓN NO SE TOCA ───────────────────────────────────────
//
// Sin ninguna opción elegida se sigue exigiendo la frase o el precio. Esto es lo
// que impide que un «¿ya trabajaste con <opción>?» de la intro, más un «sí»,
// cierre la venta de una opción que el cliente nunca pidió.
console.log("\n-- 2. sin nada elegido, todo sigue como estaba ------------");
comprobar(
  "el mismo turno, sin opcion elegida -> no decide",
  lee(SU_TURNO, false) === null,
  "la puerta de la primera eleccion, intacta"
);
comprobar(
  "con frase conocida si decide, como siempre",
  lee(`La otra opción es el ${BARATA}. ¿Te animas?`, false) === "basico",
  "la lista sigue cazando lo que cazaba"
);
comprobar(
  "con el precio de una sola tambien, como siempre",
  lee(`La otra opción es el ${BARATA} por S/. 20. ¿La quieres?`, false) ===
    "basico",
  "el segundo camino, intacto"
);
comprobar(
  "y sin el argumento nuevo se comporta igual que antes",
  m.laOpcionQueElBotPropuso(SU_TURNO, cfg) === null,
  "quien no lo pase no nota nada"
);

// ── 3. LOS FRENOS QUE NO SE TOCAN ───────────────────────────────────────────
console.log("\n-- 3. los frenos de siempre, en pie -----------------------");
comprobar(
  "nombra las DOS -> no decide (es el menu)",
  lee(`Tenemos el ${CARA} y el ${BARATA}. ¿Cuál prefieres?`, true) === null,
  "«¿cual prefieres?» + «si» no elige"
);
comprobar(
  "no nombra ninguna -> no decide",
  lee("¡Claro que sí! ¿Te ayudo con algo más?", true) === null,
  "sin opcion nombrada no hay propuesta"
);
comprobar(
  "sin pregunta no entra (lo decide el motor)",
  /if \(!\/\[\?¿\]\/\.test\(loUltimoQueDijoElBot\)\) return null;/.test(
    readFileSync(join(RAIZ, "src", "lib", "workflow", "engine.ts"), "utf8")
  ),
  "el bot tuvo que preguntar algo"
);

// ── 4. Y EL MOTOR PASA EL DATO DESDE LA CONVERSACIÓN ────────────────────────
//
// No se decide por la etapa ni por el nombre de la modalidad: por si hay una
// opción anotada en ESA conversación.
console.log("\n-- 4. el motor mira la eleccion anotada -------------------");
const motor = readFileSync(
  join(RAIZ, "src", "lib", "workflow", "engine.ts"),
  "utf8"
);
comprobar(
  "el dato sale de convo.order_bump_choice",
  /const yaTieneUnaElegida =\s*\r?\n?\s*convo\.order_bump_choice === "combo" \|\| convo\.order_bump_choice === "basico";/.test(
    motor
  ),
  "no por etapa ni por modalidad"
);
comprobar(
  "y viaja a la lectura de la propuesta",
  /laOpcionQueElBotPropuso\(loUltimoQueDijoElBot, config, \{\s*\r?\n?\s*elClienteYaTieneUnaElegida: yaTieneUnaElegida,/.test(
    motor
  ),
  "un solo sitio para las dos puertas"
);

// ── 5. Y SUBIR A LA CARA CUENTA IGUAL CON CUALQUIER VERBO ───────────────────
//
// VIVE AQUÍ porque es el mismo recorrido: el cliente que se mueve entre las dos
// opciones. El upgrade es cambiar a la cara pagando la diferencia.
//
// LO QUE PASÓ — 25 de septiembre de 2026, midiendo el recorrido que el dueño iba
// a probar: «quiero subir al pack» NO contaba como upgrade, y «quiero el pack»
// sí. No faltaba una palabra: cada verbo llevaba su propia lista de sustantivos,
// unas con `pack` y otras sin él, así que la misma intención contaba o no según
// el verbo. Ahora los cuatro sustantivos —los mismos de siempre— valen para
// todos los verbos.
console.log("\n-- 5. subir a la cara, con cualquier verbo ----------------");
for (const frase of [
  "quiero subir al pack",
  "pasarme al pack",
  "quiero el pack",
  "llevarme el combo",
  "quiero completar",
  "pago la diferencia",
  "upgrade",
]) {
  comprobar(
    `«${frase}»`,
    m.detectaIntencionDeSubirAlCombo(frase, cfg) === true,
    "es un upgrade"
  );
}
for (const frase of ["hola", "cuanto cuesta", "ya pague", "gracias"]) {
  comprobar(
    `«${frase}» NO es upgrade`,
    m.detectaIntencionDeSubirAlCombo(frase, cfg) === false,
    "no dispara solo"
  );
}

process.chdir(RAIZ);
console.log(
  fallos === 0
    ? "\nTODO OK — el «si» al cambio que propone el bot se registra\n"
    : `\n${fallos} comprobacion(es) mal.\n`
);
process.exit(fallos === 0 ? 0 : 1);
