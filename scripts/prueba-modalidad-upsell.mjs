// Tabla de verdad de la modalidad Upsell.
//
// Comprueba lo único que de verdad importa: que el segundo producto NO se
// ofrezca fuera de su modalidad, y que encender el Upsell no altere lo que
// hacen Order Bump ni las Dobles Ofertas.
//
// Corre sobre el CÓDIGO REAL: compila config.ts y lo interroga. Usa base de
// datos en memoria (NEXT_PHASE), así que no toca ningún archivo del bot.
//
//   node scripts/prueba-modalidad-upsell.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const RAIZ = process.cwd();
const TMP = join(RAIZ, "scripts", "_tmp-upsell");
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

writeFileSync(
  join(TMP, "tsconfig.json"),
  JSON.stringify(
    {
      compilerOptions: {
        outDir: ".",
        module: "commonjs",
        target: "es2022",
        moduleResolution: "node",
        skipLibCheck: true,
        esModuleInterop: true,
        resolveJsonModule: true,
        noEmit: false,
        baseUrl: "../..",
        paths: { "@/*": ["src/*"] },
      },
      include: ["../../src/lib/workflow/config.ts"],
    },
    null,
    2
  ),
  "utf8"
);

try {
  execFileSync(
    process.execPath,
    [join(RAIZ, "node_modules", "typescript", "bin", "tsc"), "-p", join(TMP, "tsconfig.json")],
    { stdio: "pipe" }
  );
} catch {
  // Los tipos ambientales del proyecto se quejan aquí y no pintan nada. Si el
  // archivo no se hubiera escrito, el require de abajo falla y nos enteramos.
}

process.env.NEXT_PHASE = "phase-production-build";
const require = createRequire(import.meta.url);
// El compilador no traduce los atajos "@/lib/...", así que se traducen aquí.
const Module = require("node:module");
const resolverOriginal = Module._resolveFilename;
Module._resolveFilename = function (peticion, ...resto) {
  if (peticion.startsWith("@/lib/")) {
    peticion = join(TMP, peticion.slice("@/lib/".length));
  }
  return resolverOriginal.call(this, peticion, ...resto);
};

const { getActiveModalityKey, isUpsellUsable, getActiveTwoTierOffer } =
  require(join(TMP, "workflow", "config.js"));

const entregaOk = [{ type: "text", body: "Aquí tienes el segundo producto" }];
const upsellCompleto = {
  enabled: true,
  name: "Curso de Lectura",
  price_soles: 30,
  delivery: entregaOk,
};

const casos = [
  { nombre: "Order Bump solo (como hoy)", cfg: { order_bump: { enabled: true } }, modalidad: "order_bump", ofrece: false, dosOpciones: true },
  { nombre: "Lineal pelado", cfg: {}, modalidad: "lineal", ofrece: false, dosOpciones: false },
  { nombre: "Doble Oferta 2 sola", cfg: { doble_oferta_dos: { enabled: true } }, modalidad: "doble_oferta_dos", ofrece: false, dosOpciones: true },
  { nombre: "Upsell sola y completa", cfg: { upsell: upsellCompleto }, modalidad: "upsell", ofrece: true, dosOpciones: false },
  { nombre: "Upsell completa PERO con Order Bump encendido", cfg: { upsell: upsellCompleto, order_bump: { enabled: true } }, modalidad: "upsell", ofrece: true, dosOpciones: false },
  { nombre: "Order Bump con datos de upsell pero APAGADO", cfg: { order_bump: { enabled: true }, upsell: { ...upsellCompleto, enabled: false } }, modalidad: "order_bump", ofrece: false, dosOpciones: true },
  { nombre: "Upsell encendida SIN entrega", cfg: { upsell: { ...upsellCompleto, delivery: [] } }, modalidad: "upsell", ofrece: false, dosOpciones: false },
  { nombre: "Upsell encendida SIN nombre", cfg: { upsell: { ...upsellCompleto, name: "" } }, modalidad: "upsell", ofrece: false, dosOpciones: false },
  { nombre: "Upsell encendida con nombre de plantilla", cfg: { upsell: { ...upsellCompleto, name: "<<NOMBRE_PRODUCTO_2>>" } }, modalidad: "upsell", ofrece: false, dosOpciones: false },
  { nombre: "Upsell encendida SIN precio", cfg: { upsell: { ...upsellCompleto, price_soles: 0 } }, modalidad: "upsell", ofrece: false, dosOpciones: false },
];

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);

for (const caso of casos) {
  const modalidad = getActiveModalityKey(caso.cfg);
  const ofrece = isUpsellUsable(caso.cfg);
  const dosOpciones = getActiveTwoTierOffer(caso.cfg) !== null;
  const ok =
    modalidad === caso.modalidad &&
    ofrece === caso.ofrece &&
    dosOpciones === caso.dosOpciones;
  if (!ok) fallos++;
  console.log(
    `${ok ? "ok   " : "FALLA"} ${pad(caso.nombre, 46)} modalidad=${pad(modalidad, 17)} ` +
      `ofrece2º=${pad(ofrece, 6)} dosOpciones=${dosOpciones}`
  );
  if (!ok) {
    console.log(
      `        esperaba modalidad=${caso.modalidad} ofrece2º=${caso.ofrece} dosOpciones=${caso.dosOpciones}`
    );
  }
}

rmSync(TMP, { recursive: true, force: true });
console.log(
  fallos === 0 ? `\nLos ${casos.length} casos correctos.` : `\n${fallos} de ${casos.length} mal.`
);
process.exit(fallos === 0 ? 0 : 1);
