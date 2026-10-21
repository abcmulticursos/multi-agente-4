// «COMO -DOU-» DEJA ELEGIR POR EL NÚMERO Y POR EL ORDINAL.
//
// LO QUE PASÓ — 25 de septiembre de 2026. El dueño preguntó si a «como dou» le
// pasaba lo mismo que acabábamos de arreglar en «como ob». Le pasaba, en dos
// conductas:
//
//     «1», «2», «producto 1», «opcion 2»   -> no decidia
//     «el primero», «quiero el segundo»    -> no decidia
//
// Y ES JUSTO LA MODALIDAD DONDE MAS SE USAN: en -DOU- las dos opciones se
// presentan desde el primer mensaje, normalmente en una lista numerada, asi que
// «el primero» o «2» es la respuesta mas natural del cliente. En su prueba del
// 24/09 se vio: «el primero» no decidia y el turno se iba al modelo — 8.000
// tokens y el riesgo de que interprete mal.
//
// LA CAUSA, la misma familia de todo el dia: las dos conductas preguntaban por el
// NOMBRE de la modalidad —`doble_oferta_dos.enabled`— y con el selector la
// modalidad sigue llamandose lineal, asi que ese interruptor esta apagado.
//
// LO QUE NO PUEDE ROMPERSE:
//
//   · El -DOU- de verdad se comporta EXACTAMENTE igual que antes.
//   · «Como ob» NO gana el ordinal, y es a proposito: ahi solo se conoce un
//     producto hasta que se revela el segundo, asi que «el primero» y «el
//     segundo» no tienen a que referirse todavia.
//   · Y se compone con la configuracion que recibe, sin salir a buscar la global:
//     hay pruebas que le pasan una inventada.
//
//   node scripts/prueba-como-dou-deja-elegir-por-el-numero.mjs
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from "node:fs";
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

const CASA = mkdtempSync(join(tmpdir(), "comodou-"));
mkdirSync(join(CASA, "config"), { recursive: true });
const ARCHIVO = join(CASA, "config", "intro-data.yaml");
let reloj = 1_700_000_000;
const CARO = "PRODUCTO ALFA + BETA";
const BARATO = "PRODUCTO ALFA";
const montar = (extra) => {
  writeFileSync(
    ARCHIVO,
    aYaml({
      country: "PE",
      greeting: { body_variants: ["hola"] },
      intro_sequence: [{ type: "text", body_variants: ["la intro"] }],
      payment_responses: { yape: [{ type: "text", body_variants: ["datos"] }] },
      biblioteca_de_productos: [
        { id: "pb", name: BARATO, price_soles: 20 },
        { id: "pf", name: CARO, price_soles: 30 },
      ],
      alineacion_por_modalidad: {
        lineal: { basico: "pb", unico: "pb", full: "pf" },
      },
      lineal: { enabled: true },
      ...extra,
    }),
    "utf8"
  );
  reloj += 60;
  const fecha = new Date(reloj * 1000);
  utimesSync(ARCHIVO, fecha, fecha);
};

montar({});
process.chdir(CASA);
const m = await import(
  pathToFileURL(join(RAIZ, "src", "lib", "workflow", "config.ts")).href
);

let fallos = 0;
const comprobar = (titulo, ok, nota = "") => {
  if (!ok) fallos++;
  console.log(
    `${ok ? "ok   " : "FALLA"} ${titulo.padEnd(48).slice(0, 48)} ${nota}`
  );
};
const elige = (cfg, frase) => {
  const r = m.detectExactOrderBumpChoice(frase, cfg);
  return r === "combo" ? "CARO" : r === "basico" ? "BARATO" : "no decide";
};

// ── 1. «COMO DOU»: EL NÚMERO Y EL ORDINAL DECIDEN ───────────────────────────
console.log("-- 1. «como dou»: el numero y el ordinal ------------------");
montar({ segunda_opcion_prestada: "dos_juntas" });
let cfg = m.loadWorkflowConfig();
for (const [frase, espera] of [
  ["1", "CARO"],
  ["2", "BARATO"],
  ["producto 1", "CARO"],
  ["opcion 2", "BARATO"],
  ["el primero", "CARO"],
  ["quiero el segundo", "BARATO"],
  ["el segundo", "BARATO"],
]) {
  comprobar(`«${frase}»`, elige(cfg, frase) === espera, espera);
}

// ── 2. Y LO QUE NO PUEDE PASAR: UN NÚMERO DENTRO DE UNA FRASE ───────────────
//
// El comentario del codigo lo cuenta: «a eran 2», «son 2 productos» disparaban
// el pago. El ordinal solo cuenta cuando es indicacion CLARA.
console.log("\n-- 2. un numero suelto en una frase no elige --------------");
for (const frase of ["son 2 productos", "a eran 2", "tengo 2 hijos"]) {
  comprobar(`«${frase}»`, elige(cfg, frase) === "no decide", "no dispara el pago");
}

// ── 3. «COMO OB» NO GANA EL ORDINAL, A PROPÓSITO ────────────────────────────
//
// Alli solo se conoce UN producto hasta que se revela el segundo, asi que «el
// primero» y «el segundo» no tienen a que referirse todavia.
console.log("\n-- 3. «como ob» sigue sin ordinal ------------------------");
montar({ segunda_opcion_prestada: "segunda_oculta" });
cfg = m.loadWorkflowConfig();
for (const frase of ["producto 1", "opcion 2", "el primero", "el segundo"]) {
  comprobar(`«${frase}»`, elige(cfg, frase) === "no decide", "su forma es la otra");
}

// ── 4. EL -DOU- DE VERDAD, LETRA POR LETRA ──────────────────────────────────
console.log("\n-- 4. el -DOU- de verdad, intacto ------------------------");
montar({
  doble_oferta_dos: {
    enabled: true,
    combo: { name: CARO, price_soles: 30 },
    basico: { name: BARATO, price_soles: 20 },
  },
  alineacion_por_modalidad: { doble_oferta_dos: { basico: "pb", full: "pf" } },
});
cfg = m.loadWorkflowConfig();
for (const [frase, espera] of [
  ["1", "CARO"],
  ["2", "BARATO"],
  ["producto 1", "CARO"],
  ["el primero", "CARO"],
  ["el segundo", "BARATO"],
]) {
  comprobar(`«${frase}»`, elige(cfg, frase) === espera, espera);
}

// ── 5. Y SE COMPONE CON LA CONFIGURACIÓN QUE RECIBE ─────────────────────────
console.log("\n-- 5. no sale a buscar la configuracion global ------------");
const fuente = (await import("node:fs")).readFileSync(
  join(RAIZ, "src", "lib", "workflow", "config.ts"),
  "utf8"
);
comprobar(
  "usa el config del argumento",
  /const dobleOfertaDos =\s*\r?\n?\s*!!config\?\.doble_oferta_dos\?\.enabled \|\|\s*\r?\n?\s*vendeConPresentacionPrestada\(config, "dos_juntas"\);/.test(
    fuente
  ),
  "hay pruebas que le pasan una inventada"
);

process.chdir(RAIZ);
console.log(
  fallos === 0
    ? "\nTODO OK — «como dou» deja elegir por el numero y el ordinal\n"
    : `\n${fallos} comprobacion(es) mal.\n`
);
process.exit(fallos === 0 ? 0 : 1);
