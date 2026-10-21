// LA PIZARRA DICE LO QUE HACE EL BOT — contra el motor de verdad, con su contenido real.
//
// LO PIDIÓ EL DUEÑO el 16/10/2026 al aprobar la vista pizarra: «NO DEBE ROMPERSE EL
// COMPORTAMIENTO DEL BOT, es como un reloj». Y una pizarra que dibuja «esto sale» cuando el
// bot manda otra cosa es peor que no tener pizarra: él corregiría la pieza equivocada.
//
// QUÉ SE COMPARA. La pizarra decide con `loQueSaleEnLaEstacion` (src/lib/editor). El motor
// decide la intro de order bump con `sorteaCajonDeIntro` (config.ts). Aquí se ejecutan LOS
// DOS sobre los mismos cajones —los suyos, leídos de `config/intro-data.yaml`—, dentro del
// turno de cada tienda y para cada país, y se exige que el motor solo saque piezas que la
// pizarra dibuja, y que la pizarra no dibuje piezas que el motor nunca saca.
//
// SE SORTEA CON MUCHAS SEMILLAS porque el motor reparte por peso: una sola tirada vería una
// pieza de dos.
//
//   node scripts/prueba-la-pizarra-dice-lo-que-hace-el-bot.mjs
//
// Y SE CORRE DOS VECES: con el respaldo entre países encendido y APAGADO (16/10/2026). Las dos
// sobre una COPIA de su contenido en una carpeta temporal, con el interruptor puesto a mano: su
// archivo no se toca nunca. (Al principio la primera vuelta usaba su archivo tal cual, que
// entonces tenía el respaldo encendido; ese mismo día él lo apagó y la vuelta «encendida»
// comparaba la pizarra con respaldo contra un motor sin él.)
import { registerHooks } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { parse } from "yaml";

const RAIZ = process.env.PRUEBA_RAIZ ?? process.cwd();
const SIN_RESPALDO = process.env.PRUEBA_SIN_RESPALDO === "1";
{
  // El motor lee `config/intro-data.yaml` desde la carpeta de trabajo: se le da una copia.
  const copia = mkdtempSync(join(tmpdir(), "pizarra-respaldo-"));
  mkdirSync(join(copia, "config"));
  const original = readFileSync(join(RAIZ, "config", "intro-data.yaml"), "utf8");
  writeFileSync(
    join(copia, "config", "intro-data.yaml"),
    original.replace(/^respaldo_entre_paises:.*$/m, "") + `\nrespaldo_entre_paises: ${SIN_RESPALDO ? "false" : "true"}\n`
  );
  process.chdir(copia);
}
const DOBLE = "stub:db";
registerHooks({
  resolve(esp, ctx, next) {
    if (esp === "@/lib/db") return { url: DOBLE, format: "module", shortCircuit: true };
    if (esp.startsWith("@/")) {
      const rel = esp.slice(2);
      const conExt = /\.[a-z]+$/.test(rel) ? rel : `${rel}.ts`;
      return { url: pathToFileURL(join(RAIZ, "src", conExt)).href, shortCircuit: true };
    }
    return next(esp, ctx);
  },
  load(url, ctx, next) {
    if (url === DOBLE)
      return {
        format: "module", shortCircuit: true,
        source: `
          export const getConversationByPhone = () => null;
          export const getConversationById = () => null;
          export const getFrozenPrices = () => null;
          export const getUpsellFrozenPrices = () => null; export const getPuestoEnLaFila = () => null; export const leerCompradosDeLaFila = () => []; export const moverLaFila = () => {};
          export const setFrozenPrices = () => {};
        `,
      };
    return next(url, ctx);
  },
});
const motor = await import(pathToFileURL(join(RAIZ, "src", "lib", "workflow", "config.ts")).href);
const pizarra = await import(pathToFileURL(join(RAIZ, "src", "lib", "editor", "pizarra-quien-sale.ts")).href);

let fallos = 0;
let comparados = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 62)} ${valor}`);
};

// ── 1. CON SU CONTENIDO DE HOY ──────────────────────────────────────────────
const contenido = parse(readFileSync(join(RAIZ, "config", "intro-data.yaml"), "utf8"));
const tiendas = (contenido.tiendas ?? []).filter((t) => t?.id && t?.numero);
const SEMIS = ["", "dos_juntas", "segunda_oculta"];

/** Todos los juegos de cajones de intro de order bump que tiene escritos, con su sitio. */
const juegos = [];
for (const [canal, c] of Object.entries(contenido.channels ?? {})) {
  for (const [modo, t] of Object.entries(c?.modality_templates ?? {})) {
    const g = t?.order_bump_intro_groups;
    if (Array.isArray(g) && g.length > 0) juegos.push({ donde: `${canal}/${modo}`, grupos: g });
    // Y LOS DEL UPSELL (16/10/2026): los sortea la MISMA función, y la pizarra los dibuja por
    // carril igual que la oferta.
    const u = t?.upsell_intro_groups;
    if (Array.isArray(u) && u.length > 0) juegos.push({ donde: `${canal}/${modo} upsell`, grupos: u });
  }
}
for (const [modo, t] of Object.entries(contenido.modality_templates ?? {})) {
  const g = t?.order_bump?.intro_groups;
  if (Array.isArray(g) && g.length > 0) juegos.push({ donde: `modalidad/${modo}`, grupos: g });
  const u = t?.upsell?.intro_groups;
  if (Array.isArray(u) && u.length > 0) juegos.push({ donde: `modalidad/${modo} upsell`, grupos: u });
}

console.log(
  `\n— 1. intro de order bump: pizarra contra motor, con su contenido · RESPALDO ${SIN_RESPALDO ? "APAGADO (copia)" : "encendido"} —\n`
);
console.log(`   ${juegos.length} juego(s) de cajones · ${tiendas.length} tienda(s) con número\n`);

const paisesDe = (grupos) => {
  const p = pizarra.paisesConBandera(grupos);
  return [...new Set([...p, "PE", "AR", "EC", "MX"])];
};

/** Lo que saca el motor de verdad, sorteando muchas veces dentro del turno de la tienda. */
const loQueSacaElMotor = (grupos, numero, semi, pais) => {
  // La semimodalidad la manda la tienda: se le pone la que se está probando a una copia.
  const sacadas = new Set();
  const turno = { id: null, wa_phone_number_id: numero };
  for (let semilla = 0; semilla < 60; semilla++) {
    const apunte = {};
    const pasos = motor.conElTurnoDe(turno, () => motor.sorteaCajonDeIntro(grupos, semilla, pais, apunte));
    if (apunte.faltaLaSuya) sacadas.falta = true;
    if (!pasos) { sacadas.add("∅"); continue; }
    const i = grupos.findIndex((g) => g.steps === pasos);
    sacadas.add(i);
  }
  return sacadas;
};

for (const { donde, grupos } of juegos) {
  for (const tienda of tiendas) {
    // La semimodalidad de la tienda es la de su contenido: el turno la lee de ahí. Las otras
    // dos se comparan en la parte 2, con piezas inventadas, sin tocar su archivo.
    const semi = tienda.semimodalidad ?? "";
    for (const pais of paisesDe(grupos)) {
      const motorSaca = loQueSacaElMotor(grupos, String(tienda.numero), semi, pais);
      const fila = pizarra
        .loQueSaleEnLaEstacion(
          grupos.map((g, i) => ({ ...g, __i: i })).filter((g) => (g.steps ?? []).length > 0),
          tienda.id,
          semi,
          [pais],
          !SIN_RESPALDO
        )
        .porPais[0];
      const pizarraDibuja = new Set(fila.piezas.map((g) => g.__i));
      if (pizarraDibuja.size === 0) pizarraDibuja.add("∅");
      // Y que los dos digan lo mismo de si FALTA la suya: la pizarra lo pinta como hueco o
      // como prestada, y el motor lo apunta.
      const faltaEnLaPizarra = fila.estado === "falta" || fila.estado === "prestada";
      const iguales =
        motorSaca.size === pizarraDibuja.size &&
        [...motorSaca].every((x) => pizarraDibuja.has(x)) &&
        !!motorSaca.falta === faltaEnLaPizarra;
      comparados++;
      comprobar(
        `${donde} · ${String(tienda.nombre).slice(0, 18)} · ${pais}`,
        iguales,
        `motor=${[...motorSaca].join(",")} pizarra=${[...pizarraDibuja].join(",")} (${fila.estado})`
      );
    }
  }
}

// ── 2. CON PIEZAS INVENTADAS: los casos que su contenido de hoy no tiene ──────
console.log(`\n— 2. casos fijos, con nombres inventados —\n`);
const pieza = (n, etiquetas = {}) => ({ name: n, enabled: true, steps: [{ type: "text", body: n }], ...etiquetas });
const nombres = (r) => r.piezas.map((p) => p.name).join(",") || "∅";
const caso = (texto, piezas, tienda, semi, pais, espera, estado) => {
  const r = pizarra.loQueSaleEnLaEstacion(piezas, tienda, semi, [pais]).porPais[0];
  comprobar(texto, nombres(r) === espera && r.estado === estado, `${nombres(r)} (${r.estado})`);
};
const T = "tienda_x";
caso("sin ninguna etiqueta: juegan todas", [pieza("A"), pieza("B")], T, "", "PE", "A,B", "general");
caso("con su bandera: solo la suya", [pieza("A", { paises: ["PE"] }), pieza("B", { paises: ["AR"] })], T, "", "PE", "A", "propia");
caso("país sin pieza: le llega una de otro (rojo)", [pieza("A", { paises: ["PE"] })], T, "", "AR", "A", "prestada");
caso("sin bandera no sale si alguien etiquetó", [pieza("A", { paises: ["PE"] }), pieza("G")], T, "", "AR", "A", "prestada");
caso("la de otra tienda no sale nunca", [pieza("A", { tiendas: ["otra"] })], T, "", "PE", "∅", "vacia");
caso("con piezas de su tienda, la general no juega", [pieza("A", { tiendas: [T] }), pieza("G")], T, "", "PE", "A", "general");
caso("COMO OB: juega la etiquetada ob", [pieza("L", { semimodalidad: "lineal" }), pieza("O", { semimodalidad: "ob" })], T, "segunda_oculta", "PE", "O", "general");
caso("apagada no juega", [pieza("A", { enabled: false }), pieza("B")], T, "", "PE", "B", "general");
caso("dirigir por país apagado = sin bandera", [pieza("A", { paises: ["PE"], pais_routing_enabled: false }), pieza("B", { paises: ["AR"] })], T, "", "PE", "B", "prestada");

// ── 3. SIN RESPALDO: lo que falta no se rellena con otro país ────────────────
console.log(`\n— 3. sin respaldo entre países —\n`);
const sin = (texto, piezas, pais, espera, estado) => {
  const r = pizarra.loQueSaleEnLaEstacion(piezas, T, "", [pais], false).porPais[0];
  comprobar(texto, nombres(r) === espera && r.estado === estado, `${nombres(r)} (${r.estado})`);
};
sin("país sin pieza: no le llega la de otro", [pieza("A", { paises: ["PE"] })], "AR", "∅", "falta");
sin("con la suya: sale la suya, igual que con respaldo", [pieza("A", { paises: ["PE"] }), pieza("B", { paises: ["AR"] })], "AR", "B", "propia");
sin("sin ninguna bandera: nada cambia", [pieza("A"), pieza("B")], "AR", "A,B", "general");

console.log(`\n${fallos === 0 ? "TODO OK" : `${fallos} FALLO(S)`} · ${comparados} comparaciones contra el motor\n`);

// La segunda vuelta, con el respaldo apagado, en otro proceso: el motor guarda la
// configuración en memoria al cargarla y no se le puede cambiar a mitad.
if (!SIN_RESPALDO) {
  const yo = fileURLToPath(import.meta.url);
  const otra = spawnSync(process.execPath, [yo], {
    env: { ...process.env, PRUEBA_SIN_RESPALDO: "1", PRUEBA_RAIZ: RAIZ },
    stdio: "inherit",
  });
  process.exit(fallos === 0 && otra.status === 0 ? 0 : 1);
}
process.exit(fallos === 0 ? 0 : 1);
