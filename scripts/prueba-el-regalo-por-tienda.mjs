// EL REGALO POR TIENDA, Y SIN REGALO PROPIO NADA CAMBIA.
//
// LO PIDIÓ EL DUEÑO el 17/10/2026: «no todos los regalos van a ser iguales, por tienda es diferente…
// son productos diferentes y regalos diferentes».
//
// QUÉ PROTEGE:
//   1. Sin tienda, o con una sin regalo propio: EL MISMO objeto de configuración (nada cambia).
//   2. Con regalo propio: pisa SOLO lo que trae (ofrecimiento, enlace para comentar, premio,
//      despedida); botones, enlaces por anuncio, audio e interruptores siguen siendo los del bot.
//   3. Un campo vacío no pisa (vacío = «no lo he escrito», nunca «que no salga nada»).
//   4. Se aplica al armar la configuración de cada turno, que ya va por tienda (y su caché también).
//   5. La ruta lo guarda y lo lee con la tienda.
//
//   node scripts/prueba-el-regalo-por-tienda.mjs
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");
const config = leer("src", "lib", "workflow", "config.ts");
const ruta = leer("src", "app", "api", "workflow", "route.ts");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 66)} ${valor}`);
};

// La función real, sacada del archivo (sin reescribirla).
const i = config.indexOf("export function conElRegaloDeLaTienda(");
const resto = config.slice(i);
const fin = resto.search(/\r?\n\}\r?\n/);
const cuerpo = resto.slice(0, fin) + "\n}";
const dir = mkdtempSync(join(tmpdir(), "regalo-tienda-"));
const archivo = join(dir, "regalo.ts");
writeFileSync(archivo, `type WorkflowConfig = any; type Tienda = any; type SequenceStep = any;\n${cuerpo}\n`, "utf8");
const { conElRegaloDeLaTienda } = await import(pathToFileURL(archivo).href);

console.log("\n— 1. sin regalo propio, nada cambia —\n");
const general = {
  consent_sequence: [{ type: "text", body: "¿Quieres un regalo?" }],
  ask_sequence: [{ type: "text", body: "Comenta aquí" }],
  reward_message: "Aquí tu premio",
  decline_message: "Gracias",
  consent_buttons_enabled: true,
  ask_text_variants: [{ text: "x", ad_ids: ["1"] }],
};
const cfg = { gift_mechanic: general, otra: 1 };
comprobar("sin tienda → el mismo objeto", conElRegaloDeLaTienda(cfg, null) === cfg);
comprobar("tienda sin regalo → el mismo objeto", conElRegaloDeLaTienda(cfg, { id: "t" }) === cfg);
comprobar("regalo propio vacío → el mismo objeto", conElRegaloDeLaTienda(cfg, { regalo: { consent_sequence: [], reward_message: "  " } }) === cfg);
comprobar("bot sin regalo → el mismo objeto", conElRegaloDeLaTienda({ otra: 1 }, { regalo: { reward_message: "x" } }).gift_mechanic === undefined);

console.log("\n— 2. con regalo propio, pisa solo lo que trae —\n");
const suyo = conElRegaloDeLaTienda(cfg, {
  regalo: { consent_sequence: [{ type: "text", body: "¿Quieres el regalo de LA TIENDA?" }], reward_message: "Premio de LA TIENDA" },
});
comprobar("el ofrecimiento es el suyo", suyo.gift_mechanic.consent_sequence[0].body.includes("LA TIENDA"));
comprobar("el premio es el suyo", suyo.gift_mechanic.reward_message === "Premio de LA TIENDA");
comprobar("el enlace para comentar sigue siendo el general", suyo.gift_mechanic.ask_sequence[0].body === "Comenta aquí");
comprobar("la despedida sigue siendo la general", suyo.gift_mechanic.decline_message === "Gracias");
comprobar("botones y enlaces por anuncio, los del bot", suyo.gift_mechanic.consent_buttons_enabled === true && suyo.gift_mechanic.ask_text_variants.length === 1);
comprobar("el resto de la configuración, intacto", suyo.otra === 1);
comprobar("el general no se toca", cfg.gift_mechanic.reward_message === "Aquí tu premio");

console.log("\n— 3. se aplica en cada turno, con su tienda —\n");
comprobar("al armar la configuración del turno", /const runtimeConfig = conElRegaloDeLaTienda\(\s*\r?\n\s*applyChannelContent\(aplicarVersionActiva\(repartirPorEtiqueta\(config\)\), channel\),\s*\r?\n\s*suTienda \?\? null\s*\r?\n\s*\);/.test(config));
comprobar("la caché ya va por tienda", /const clave = \[channel, laSuya \?\? "", suTienda\?\.id \?\? ""\]/.test(config));

console.log("\n— 4. se guarda y se lee con la tienda —\n");
comprobar("la ruta lo escribe con las burbujas del archivo", /doc\.set\("tiendas", leeTiendas\(body\.tiendas, "escribir"\)\)/.test(ruta));
comprobar("y solo si trae algo", /\.\.\.\(suRegalo\(t\?\.regalo\) \? \{ regalo: suRegalo\(t\?\.regalo\) \} : \{\}\)/.test(ruta));

console.log(`\n${fallos === 0 ? "TODO OK — cada tienda con su regalo, y sin el suyo nada cambia" : `${fallos} FALLO(S)`}\n`);
process.exit(fallos === 0 ? 0 : 1);
