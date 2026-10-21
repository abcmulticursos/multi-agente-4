// Lo que se escribe en Canales llega a Doble Oferta + Upsell.
//
// LO QUE PASO — 15 de septiembre de 2026. El dueno duplico el cajon del upsell
// en Canales, edito la copia, apago el original… y a sus tres clientes de prueba
// les llego el texto del APAGADO. Con sus palabras: «lo que llego en las pruebas
// fue el contenido del cajon apagado».
//
// NO LO ELIGIO EL SORTEO. Ninguno de los dos cajones se miro. La capa del canal
// escribe en `next.upsell`, y esa modalidad lee su PROPIA caja:
//
//     if (key === "doble_oferta_upsell") return cfg.doble_oferta_upsell?.upsell;
//
// Al no encontrar cajones, el motor caia al respaldo `intro`, que es de donde el
// cajon apagado se habia sembrado al abrir la pantalla por primera vez. Padre e
// hijo dicen lo mismo, y por eso parecia que salia el apagado. La prueba de que
// el interruptor funciona es que el ENCENDIDO tampoco salio: a los tres clientes
// les llego lo mismo.
//
//     canal whatsapp / DOU  upsell_intro_groups     = 2 cajones
//     doble_oferta_upsell.upsell.intro_groups       = 0
//     doble_oferta_upsell.upsell.intro              = 5 burbujas  <- salia esto
//
// ESTA PRUEBA LO MIDE SOBRE EL CONTENIDO REAL: arma lo que el motor leeria antes
// y despues del arreglo, y compara.
//
//   node scripts/prueba-el-canal-llega-a-doble-oferta-upsell.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const RAIZ = process.cwd();
const require = createRequire(join(RAIZ, "package.json"));
const yaml = require("js-yaml");
const config = readFileSync(
  join(RAIZ, "src", "lib", "workflow", "config.ts"),
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
const trozo = (desde, hasta) => {
  const i = config.indexOf(desde);
  if (i < 0) return "";
  const f = config.indexOf(hasta, i);
  return f < 0 ? config.slice(i) : config.slice(i, f);
};

// ── 1. LA LINEA QUE OBLIGA A TODO ESTO ───────────────────────────────────────
console.log("\n— por qué hacía falta —\n");
comprobar(
  "-DOU- lee su propia caja de upsell",
  /if \(key === "doble_oferta_upsell"\) return cfg\.doble_oferta_upsell\?\.upsell \?\? null;/.test(
    config
  ),
  "no la de arriba"
);
comprobar(
  "y su propia caja de oferta",
  /if \(key === "doble_oferta_upsell" && cfg\.doble_oferta_upsell\)/.test(config),
  "getActiveTwoTierOffer"
);
comprobar(
  "el sorteo SÍ respeta el interruptor",
  /\(g\) => g\?\.enabled !== false && \(g\?\.steps \?\? \[\]\)\.length > 0/.test(
    config
  ),
  "el apagado nunca entró"
);

// ── 2. LA CAPA DEL CANAL YA ESCRIBE EN LAS DOS CAJAS ─────────────────────────
console.log("\n— y ahora el canal llega a las dos cajas —\n");
const capa = trozo("function applyChannelContent(", "\nfunction ");
comprobar(
  "el upsell del canal entra en la caja de -DOU-",
  /intro_groups: suyo\.intro_groups/.test(capa),
  "sus cajones"
);
for (const [campo, marca] of [
  ["la pregunta del final", "pregunta_steps: suyo.pregunta_steps"],
  ["los botones", "use_buttons: suyo.use_buttons"],
  ["el botón SÍ", "boton_si: suyo.boton_si"],
  ["el botón NO", "boton_no: suyo.boton_no"],
  ["el texto de rechazo", "respuesta_rechazo: suyo.respuesta_rechazo"],
]) {
  comprobar(`y también ${campo}`, capa.includes(marca), "campo a campo");
}
comprobar(
  "la OFERTA de -DOU- también recibe sus cajones",
  /intro_groups: deLaOferta\.intro_groups/.test(capa),
  "el mismo hueco"
);
comprobar(
  "y su pregunta con botones",
  /use_buttons: deLaOferta\.use_buttons/.test(capa) &&
    /choice_prompt: deLaOferta\.choice_prompt/.test(capa),
  "igual"
);
comprobar(
  "solo si el canal opinó: lo ausente sigue mandando a la modalidad",
  (capa.match(/\(content\.upsell_intro_groups \?\? \[\]\)\.length > 0/g) ?? [])
    .length >= 2,
  "una clave ausente no apaga nada"
);
comprobar(
  "y no se toca la caja si esa modalidad no existe",
  /if \(next\.doble_oferta_upsell\?\.upsell && next\.upsell\)/.test(capa),
  "no se inventa"
);

// ── 3. SOBRE SU CONTENIDO: QUÉ SALDRÍA ANTES Y DESPUÉS ───────────────────────
//
// Se reproduce lo que hace el motor: pedir los cajones de la caja de -DOU-, y si
// no hay, caer al respaldo `intro`.
console.log("\n— y sobre su contenido de verdad —\n");
const delCanal =
  cfg.channels?.whatsapp?.modality_templates?.doble_oferta_upsell ?? {};
const cajaDou = cfg.doble_oferta_upsell?.upsell ?? {};
const susCajones = delCanal.upsell_intro_groups ?? [];

const textoDe = (pasos) =>
  (pasos ?? [])
    .map((p) => {
      const t =
        p?.body ?? (p?.body_variants ?? [])[0] ?? (p?.texts ?? [])[0] ?? p?.caption ?? "";
      return String(t).slice(0, 40);
    })
    .join(" | ");

const loQueSaldria = (cajones) => {
  const vivos = (cajones ?? []).filter(
    (g) => g?.enabled !== false && (g?.steps ?? []).length > 0
  );
  if (vivos.length === 0) return { de: "el respaldo intro", pasos: cajaDou.intro };
  return { de: `«${vivos[0].name || "sin nombre"}»`, pasos: vivos[0].steps };
};

const antes = loQueSaldria(cajaDou.intro_groups);
const despues = loQueSaldria(susCajones);
console.log(`     ANTES   sale de ${antes.de}`);
console.log(`             ${textoDe(antes.pasos).slice(0, 90)}`);
console.log(`     DESPUES sale de ${despues.de}`);
console.log(`             ${textoDe(despues.pasos).slice(0, 90)}`);
console.log("");

comprobar(
  "el dueño tiene cajones escritos en el canal",
  susCajones.length > 0,
  `${susCajones.length} cajones`
);
comprobar(
  "y alguno apagado, que es lo que motivó todo",
  susCajones.some((g) => g.enabled === false),
  "el original que duplicó"
);
comprobar(
  "ANTES salía el respaldo, no sus cajones",
  antes.de === "el respaldo intro",
  "por eso parecía el apagado"
);
comprobar(
  "DESPUÉS sale un cajón suyo, y ENCENDIDO",
  despues.de !== "el respaldo intro" &&
    susCajones.find((g) => (g.name || "sin nombre") === despues.de.replace(/[«»]/g, ""))
      ?.enabled !== false,
  despues.de
);
comprobar(
  "y no es el apagado",
  textoDe(despues.pasos) !== textoDe(susCajones.find((g) => g.enabled === false)?.steps),
  "el interruptor manda"
);

console.log(
  fallos === 0
    ? "\nTODO OK — lo que escribe en Canales llega a -DOU-"
    : `\n${fallos} comprobacion(es) mal.`
);
process.exit(fallos === 0 ? 0 : 1);
