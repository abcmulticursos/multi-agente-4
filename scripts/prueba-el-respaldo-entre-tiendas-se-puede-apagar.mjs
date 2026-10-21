// EL RESPALDO ENTRE TIENDAS SE PUEDE APAGAR, Y ENCENDIDO NO CAMBIA NADA.
//
// LO PIDIÓ EL DUEÑO el 17/10/2026, gemelo del de países: «no podemos trabajar "me olvidé la
// tienda, se agarra de la otra"… ¿y si agarra otro producto? ¿qué le llega al cliente?».
//
// QUÉ PROTEGE:
//   1. La regla, ejecutada: encendida = `soloDeSuTienda` de siempre; apagada, a una tienda sin
//      lo suyo no le juega nada «de todas».
//   2. Ausente = encendido.
//   3. Cada sitio del motor obedece: intro → humano, intro de order bump → humano, seguimiento →
//      no se agenda, upsell → se lanza antes de tocar nada (sigue el regalo), fila → ninguna.
//   4. Se guarda, se ve en Ajustes y la pizarra lo dibuja igual que el motor.
//
//   node scripts/prueba-el-respaldo-entre-tiendas-se-puede-apagar.mjs
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
const regla = await import(pathToFileURL(join(RAIZ, "src", "lib", "workflow", "etiqueta-de-tienda.ts")).href);
const pizarra = await import(pathToFileURL(join(RAIZ, "src", "lib", "editor", "pizarra-quien-sale.ts")).href);

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

console.log("\n— 1. la regla, ejecutada (nombres inventados) —\n");
const t = (x) => x.t ?? [];
const G = { n: "G" };
const A = { n: "A", t: ["tA"] };
const B = { n: "B", t: ["tB"] };
comprobar("ausente = encendido", regla.usaRespaldoEntreTiendas({}) && regla.usaRespaldoEntreTiendas(null));
comprobar("solo false lo apaga", regla.usaRespaldoEntreTiendas({ respaldo_entre_tiendas: false }) === false);
comprobar("a la tienda A le falta lo suyo con solo G", regla.aLaTiendaLeFaltaLoSuyo([G, B], t, "tA") === true);
comprobar("con la suya, no le falta", regla.aLaTiendaLeFaltaLoSuyo([G, A], t, "tA") === false);
comprobar("sin tienda atendiendo, no falta nada", regla.aLaTiendaLeFaltaLoSuyo([G], t, null) === false);
comprobar("sin candidatos, no falta nada (no hay nada que respaldar)", regla.aLaTiendaLeFaltaLoSuyo([], t, "tA") === false);
comprobar("encendido sigue igual: A sin lo suyo recibe G", regla.soloDeSuTienda([G, B], t, "tA").map((x) => x.n).join() === "G");

console.log("\n— 2. la pizarra dice lo mismo que el motor —\n");
const piezas = [{ id: "g", enabled: true }, { id: "b", enabled: true, tiendas: ["tB"] }];
const enc = pizarra.loQueSaleEnLaEstacion(piezas, "tA", "", [], true, true);
const apa = pizarra.loQueSaleEnLaEstacion(piezas, "tA", "", [], true, false);
comprobar("encendido: juega la general", enc.enJuego.map((p) => p.id).join() === "g");
comprobar("apagado: no juega nada", apa.enJuego.length === 0);
const conSuya = pizarra.loQueSaleEnLaEstacion([...piezas, { id: "a", enabled: true, tiendas: ["tA"] }], "tA", "", [], true, false);
comprobar("apagado con la suya: juega la suya", conSuya.enJuego.map((p) => p.id).join() === "a");

console.log("\n— 3. cada sitio del motor obedece, y lo de antes sigue escrito —\n");
comprobar("la regla de siempre intacta", /return suyas\.length > 0 \? suyas : generales;/.test(leer("src", "lib", "workflow", "etiqueta-de-tienda.ts")));
comprobar("cajones: apagado lo apunta y devuelve null", /!usaRespaldoEntreTiendas\(loadWorkflowConfig\(\)\) &&[\s\S]{0,200}?apunte\.faltaLaDeSuTienda = true;\s*\r?\n\s*return null;/.test(config));
comprobar("fila de upsell: apagado y sin la suya, ninguna", /!usaRespaldoEntreTiendas\(cfg\) &&[\s\S]{0,200}?return null;/.test(config));
comprobar("seguimiento: no se agenda", /!usaRespaldoEntreTiendas\(config\) &&\s*\r?\n\s*aLaTiendaLeFaltaLoSuyo\(candidates[\s\S]{0,80}?return null;/.test(engine));
comprobar("intro: marcada, sin pasos, por tienda", /faltaLaDeSuPais: true, faltaPorTienda: true/.test(engine));
comprobar("intro: pasa a humano con el aviso de tienda", /aHumanoPorqueFaltaLaPiezaDeSuPais\(convo, config, "intro", chosenIntro\.faltaPorTienda === true\)/.test(engine));
comprobar(
  "intro de order bump: a humano ANTES de la de siempre",
  /apunteDelPais\.faltaLaDeSuTienda && config\) \{\s*\r?\n\s*await aHumanoPorqueFaltaLaPiezaDeSuPais\(convo, config, "intro de order bump", true\);\s*\r?\n\s*return;\s*\r?\n\s*\}\s*\r?\n\s*const introDeLaOferta/.test(engine)
);
const upsell = engine.match(/async function presentarUpsell[\s\S]*?setUpsellBaseCents/)?.[0] ?? "";
comprobar("upsell: se lanza antes de marcarse ofrecido", /faltaLaDeSuTienda\) \{\s*\r?\n\s*throw new Error\(/.test(upsell) && !/setUpsellState/.test(upsell));
const aHumano = engine.match(/async function aHumanoPorqueFaltaLaPiezaDeSuPais[\s\S]*?\n\}/)?.[0] ?? "";
comprobar("el paso a humano NO le escribe al cliente", aHumano.length > 0 && !/sendBot\w*\(/.test(aHumano));

console.log("\n— 4. se guarda y se ve —\n");
comprobar("se lee: ausente = encendido", /respaldo_entre_tiendas: config\?\.respaldo_entre_tiendas !== false/.test(ruta));
comprobar("se escribe siempre", /doc\.set\("respaldo_entre_tiendas", g\.respaldo_entre_tiendas !== false\)/.test(ruta));
comprobar("está en Ajustes", /🏪 Usar respaldo entre tiendas/.test(pantalla));
comprobar("la pizarra lo recibe", /cfg\.globals\?\.respaldo_entre_tiendas !== false\s*\r?\n\s*\);/.test(pantalla));

console.log(`\n${fallos === 0 ? "TODO OK — el respaldo entre tiendas se apaga, y encendido nada cambia" : `${fallos} FALLO(S)`}\n`);
process.exit(fallos === 0 ? 0 : 1);
