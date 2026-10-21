// Los dos relojes -upsell y regalo- vuelven a cero cuando el cliente escribe.
//
// EL MODELO, dictado por Alberto el 14 de septiembre de 2026:
//
//   «Cliente compra, se activa el reloj de upsell y de regalo -por ejemplo,
//    upsell a los 2 minutos y regalo a los 4-. Si el cliente sigue hablando se
//    reinicia el reloj, si vuelve a hablar se reinicia, (de ambos). Cliente
//    agradece y se va: entonces sigue corriendo el reloj que se reinicio, y
//    primero se presenta el upsell. Si el cliente lee y conversa, el reloj del
//    upsell YA TERMINO y no se reinicia; el que se reinicia ahora es el del
//    regalo, que no termino.»
//
// LO QUE FALTABA
//
//   El plazo del regalo ya se renovaba. El de la OFERTA del segundo producto no:
//   se programaba desde la entrega y no se movia, asi que caia encima de la
//   conversacion igual que hacia el regalo antes de arreglarlo.
//
// LO QUE NO HUBO QUE PROGRAMAR
//
//   «El que ya termino no revive» sale solo: aqui unicamente se renueva lo que
//   sigue PENDIENTE. Un plazo que ya disparo deja de existir.
//
//   node scripts/prueba-los-dos-relojes-vuelven-a-cero.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const motor = readFileSync(
  join(RAIZ, "src", "lib", "workflow", "engine.ts"),
  "utf8"
);

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 56)} ${valor}`);
};

// ── El renovador real de la oferta, sacado del motor ─────────────────────────
const i = motor.indexOf("function renovarEsperaDelUpsell(");
if (i < 0) throw new Error("no encuentro renovarEsperaDelUpsell en engine.ts");
const cuerpo = motor
  .slice(i, motor.indexOf("\nfunction renovarEsperaDelRegalo(", i))
  .replace(
    /function renovarEsperaDelUpsell\([\s\S]*?\): void \{/,
    "function renovarEsperaDelUpsell(convo, config) {"
  );

const armar = ({ pendiente, minutos }) => {
  const hechos = { cancelo: false, programo: 0 };
  const f = new Function(
    "convo",
    "config",
    "hechos",
    [
      `const hasPendingActionType = () => ${pendiente};`,
      `const seccionUpsell = () => ({ retraso_minutos: ${minutos} });`,
      "const ACTION_UPSELL_PRESENTAR = 'x';",
      "const cancelPendingActionsByTypeForConvo = () => { hechos.cancelo = true; };",
      "const scheduleAction = (a, b, c, cuando) => { hechos.programo = cuando; };",
      "const loQueFaltaDeSilencio = (id, s) => s;",
      "const console = { log: () => {} };",
      cuerpo,
      "renovarEsperaDelUpsell(convo, config);",
    ].join("\n\n")
  );
  f({ id: 1 }, {}, hechos);
  return hechos;
};

// ── 1. Con la oferta pendiente, vuelve a cero ────────────────────────────────
console.log("— el cliente escribe: la oferta vuelve a contar —\n");
const conEspera = armar({ pendiente: true, minutos: 2 });
comprobar(
  "cancela el plazo anterior",
  conEspera.cancelo === true,
  "no se acumulan"
);
comprobar(
  "y programa los 2 min ENTEROS otra vez",
  conEspera.programo > 0,
  "desde el ultimo mensaje"
);

// ── 2. EL QUE YA TERMINO NO REVIVE ───────────────────────────────────────────
//    Es la parte que el dueno recalco, y sale sola: si el plazo ya disparo, ya
//    no esta pendiente y aqui no se toca nada.
console.log("\n— el reloj que ya termino NO revive —\n");
const yaDisparo = armar({ pendiente: false, minutos: 2 });
comprobar(
  "oferta ya presentada -> no cancela nada",
  yaDisparo.cancelo === false,
  "no revive"
);
comprobar(
  "oferta ya presentada -> no programa nada",
  yaDisparo.programo === 0,
  "se quedo hecha"
);

// ── 3. Sin espera configurada, todo como siempre ─────────────────────────────
console.log("\n— sin espera configurada, nada cambia —\n");
const sinEspera = armar({ pendiente: true, minutos: 0 });
comprobar(
  "retraso 0 -> no se toca el plazo",
  sinEspera.cancelo === false && sinEspera.programo === 0,
  "sale enseguida, como siempre"
);

// ── 4. Los DOS relojes, en el mismo sitio ────────────────────────────────────
console.log("\n— los dos relojes se renuevan en cada mensaje —\n");
comprobar(
  "la oferta se renueva junto al regalo",
  /renovarEsperaDelUpsell\(convo, config\);\s*\r?\n\s*if \(convo\.gift_rewarded\) return;/.test(
    motor
  ),
  "y antes del freno del regalo"
);
comprobar(
  "y eso corre en CADA mensaje del cliente",
  /renovarEsperaDelRegalo\(convo, config\);[\s\S]{0,400}?renovarEsperaDeLosSeguimientos\(convo\);/.test(
    motor
  ),
  "tryWorkflowOnIncoming"
);
comprobar(
  "los dos miden desde el ultimo mensaje del cliente",
  (motor.match(/loQueFaltaDeSilencio\(/g) || []).length >= 5,
  "mismo ancla"
);

console.log(
  fallos === 0
    ? "\nTODO OK — los dos vuelven a cero, y el que termino se queda hecho"
    : `\n${fallos} comprobacion(es) mal.`
);
process.exit(fallos === 0 ? 0 : 1);
