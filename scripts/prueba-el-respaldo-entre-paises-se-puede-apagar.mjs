// EL RESPALDO ENTRE PAÍSES SE PUEDE APAGAR, Y ENCENDIDO NO CAMBIA NADA.
//
// LO PIDIÓ EL DUEÑO el 16/10/2026: «si yo tengo una intro de Perú y tiene unas condiciones al
// final de la intro, esa no me serviría para Argentina, por lo tanto respaldar en Argentina lo
// de Perú… sería ilógico». Y que no se quitara a ciegas: «hazlo mejor con un switch o una
// opción en ajustes: usar respaldo, y si está apagado que funcione como tú dices».
//
// QUÉ PROTEGE:
//   1. La regla, ejecutada: encendida decide como siempre; apagada no rellena con otro país.
//   2. Ausente = encendido. Ninguna instalación cambia sin que la toquen.
//   3. Los tres sitios del motor que eligen por bandera obedecen al interruptor, y lo de antes
//      sigue escrito tal cual encima (las líneas viejas no se tocaron: se añadió debajo).
//   4. Lo que pasa cuando falta: intro y order bump → humano con aviso y SIN escribirle nada al
//      cliente; seguimiento → no se agenda; upsell → se lanza ANTES de tocar nada, para que las
//      puertas que ya existen sigan con el regalo.
//   5. El interruptor se guarda encendido Y apagado, y se ve en Ajustes.
//
//   node scripts/prueba-el-respaldo-entre-paises-se-puede-apagar.mjs
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
registerHooks({
  resolve(esp, ctx, next) {
    if (esp.startsWith("@/")) {
      const rel = esp.slice(2);
      const conExt = /\.[a-z]+$/.test(rel) ? rel : `${rel}.ts`;
      return { url: pathToFileURL(join(RAIZ, "src", conExt)).href, shortCircuit: true };
    }
    return next(esp, ctx);
  },
});
const regla = await import(pathToFileURL(join(RAIZ, "src", "lib", "workflow", "etiqueta-de-bandera.ts")).href);

const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");
const engine = leer("src", "lib", "workflow", "engine.ts");
const config = leer("src", "lib", "workflow", "config.ts");
const ruta = leer("src", "app", "api", "workflow", "route.ts");
const pantalla = leer("src", "app", "editor", "page.tsx");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 64)} ${valor}`);
};

// ── 1 y 2. LA REGLA, EJECUTADA ───────────────────────────────────────────────
console.log("\n— 1. la regla, ejecutada (nombres inventados) —\n");
const b = (x) => x.b ?? [];
const P = { n: "P", b: ["PE"] };
const A = { n: "A", b: ["AR"] };
const G = { n: "G" };
const quien = (r) => r.jugadas.map((x) => x.n).join(",") || "∅";
const r1 = regla.porBanderaDelCliente([P], b, "AR", true);
comprobar("encendido: al país sin la suya le llega la de otro", quien(r1) === "P" && r1.faltaLaSuya, quien(r1));
const r2 = regla.porBanderaDelCliente([P], b, "AR", false);
comprobar("apagado: no le llega nada, y se sabe que falta", quien(r2) === "∅" && r2.faltaLaSuya, quien(r2));
const r3 = regla.porBanderaDelCliente([P, A], b, "AR", false);
comprobar("apagado: con la suya, sale la suya", quien(r3) === "A" && !r3.faltaLaSuya, quien(r3));
const r4 = regla.porBanderaDelCliente([G, { n: "H" }], b, "AR", false);
comprobar("sin ninguna bandera puesta, nada cambia", quien(r4) === "G,H" && !r4.faltaLaSuya, quien(r4));
comprobar("ausente = encendido", regla.usaRespaldoEntrePaises({}) === true && regla.usaRespaldoEntrePaises(null) === true);
comprobar("solo false lo apaga", regla.usaRespaldoEntrePaises({ respaldo_entre_paises: false }) === false);

// ── 3. LOS TRES SITIOS DEL MOTOR ─────────────────────────────────────────────
console.log("\n— 2. los tres sitios del motor obedecen, y lo de antes sigue escrito —\n");
comprobar(
  "cajones (order bump / upsell): lo de antes intacto",
  /conBandera\.length === 0\s*\r?\n?\s*\? encendidos\s*\r?\n?\s*: deSuPais\.length > 0\s*\r?\n?\s*\? deSuPais\s*\r?\n?\s*: conBandera;/.test(config)
);
comprobar(
  "cajones: apagado devuelve null y lo apunta",
  /if \(apunte\) apunte\.faltaLaSuya = faltaLaSuya;\s*\r?\n\s*if \(faltaLaSuya && !usaRespaldoEntrePaises\(loadWorkflowConfig\(\)\)\) return null;/.test(config)
);
comprobar(
  "seguimientos: apagado y sin el suyo -> no se agenda",
  /losSuyos\.length === 0 &&\s*\r?\n\s*!usaRespaldoEntrePaises\(config\)\s*\r?\n\s*\) \{[\s\S]{0,300}?return null;/.test(engine)
);
comprobar(
  "intro: apagado y sin la suya -> marcada, sin pasos",
  /deSuPais\.length === 0 &&\s*\r?\n\s*!usaRespaldoEntrePaises\(config\)\s*\r?\n\s*\) \{\s*\r?\n\s*return \{ steps: \[\], variant: 1, weight: 1, faltaLaDeSuPais: true \};/.test(engine)
);

// ── 4. LO QUE PASA CUANDO FALTA ──────────────────────────────────────────────
console.log("\n— 3. lo que pasa cuando falta —\n");
const aHumano = engine.match(/async function aHumanoPorqueFaltaLaPiezaDeSuPais[\s\S]*?\n\}/)?.[0] ?? "";
comprobar("existe el paso a humano", aHumano.length > 0);
comprobar("pasa a humano y cancela lo pendiente", /setMode\(convo\.id, "HUMAN"\)/.test(aHumano) && /cancelPendingActionsForConvo\(convo\.id\)/.test(aHumano));
comprobar("te avisa a ti", /notifyAdmin\(/.test(aHumano));
comprobar("y NO le escribe nada al cliente", !/sendBot\w*\(/.test(aHumano));
comprobar(
  "la intro lo usa al arrancar la conversación",
  // (17/10: lleva un cuarto argumento, «es por tienda», que solo cambia el aviso)
  /if \(chosenIntro\.faltaLaDeSuPais\) \{\s*\r?\n\s*await aHumanoPorqueFaltaLaPiezaDeSuPais\(convo, config, "intro"(, [^)]*)?\);\s*\r?\n\s*return true;/.test(engine)
);
comprobar(
  "la intro de order bump, ANTES de caer a la de siempre",
  // (17/10: entre las dos puede ir la guarda gemela de tiendas, que también vuelve antes)
  /apunteDelPais\.faltaLaSuya && config && !usaRespaldoEntrePaises\(config\)\) \{\s*\r?\n\s*await aHumanoPorqueFaltaLaPiezaDeSuPais\(convo, config, "intro de order bump"\);\s*\r?\n\s*return;\s*\r?\n\s*\}(?:[\s\S](?!delCajon \?\?))*?\s*const introDeLaOferta =\s*\r?\n\s*delCajon \?\?/.test(engine)
);
const upsell = engine.match(/async function presentarUpsell[\s\S]*?setUpsellBaseCents/)?.[0] ?? "";
comprobar("el upsell se corta ANTES de marcarse como ofrecido", /throw new Error\(/.test(upsell) && !/setUpsellState/.test(upsell));

// ── 5. SE GUARDA Y SE VE ─────────────────────────────────────────────────────
console.log("\n— 4. se guarda encendido y apagado, y se ve en Ajustes —\n");
comprobar("se lee: ausente = encendido", /respaldo_entre_paises: config\?\.respaldo_entre_paises !== false/.test(ruta));
comprobar("se escribe siempre", /doc\.set\("respaldo_entre_paises", g\.respaldo_entre_paises !== false\)/.test(ruta));
comprobar("está en Ajustes", /🌎 Usar respaldo entre países/.test(pantalla));

console.log(`\n${fallos === 0 ? "TODO OK — el respaldo se apaga, y encendido nada cambia" : `${fallos} FALLO(S)`}\n`);
process.exit(fallos === 0 ? 0 : 1);
