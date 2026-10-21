// Cuando Meta no deja generar el token permanente, decir QUÉ HACER.
//
// Meta contesta un rechazo por cada negocio y usuario del sistema. Leídos en
// bruto no dicen qué falta. Pero juntos sí: el negocio cuyo fallo NO es "la app
// no pertenece a este negocio" es el dueño de la app, y es el único donde se
// puede generar el token.
//
// El caso de prueba son los mensajes REALES que devolvió Meta.
//
//   node scripts/prueba-sugerencia-token.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const RAIZ = process.cwd();
const TMP = join(RAIZ, "scripts", "_tmp-sugerencia");
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
        noEmit: false,
        baseUrl: "../..",
        paths: { "@/*": ["src/*"] },
      },
      include: ["../../src/lib/meta/errores-token-permanente.ts"],
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
} catch {}

const require = createRequire(import.meta.url);
const { sugerenciaTokenPermanente } = require(
  join(TMP, "errores-token-permanente.js")
);

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (nombre, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(nombre, 56)} ${valor}`);
};

const NO_PERTENECE = "(#3953) Provided application does not belong to the business";
const RARO = "An unexpected error has occurred. Please retry your request later.";

// ── EL CASO REAL ────────────────────────────────────────────────────────────
// Muchos negocios rechazan por no ser dueños, y solo uno falla distinto: ese es
// el dueño de la app.
const caseReal = [
  { negocio: "BM Basura 2", usuario: "Bot lector de Anuncios", mensaje: NO_PERTENECE },
  { negocio: "Premium Academy Violeta", usuario: "Admin", mensaje: NO_PERTENECE },
  { negocio: "BM Creart", usuario: null, mensaje: "no tiene ningún usuario del sistema" },
  { negocio: "Atencion Market SAC", usuario: "Administrador", mensaje: NO_PERTENECE },
  { negocio: "Aula Virtual Pro", usuario: "Admin", mensaje: RARO },
];
const sugerencia = sugerenciaTokenPermanente(caseReal);

comprobar(
  "EL CASO REAL: señala el negocio dueño de la app",
  sugerencia?.negocio === "Aula Virtual Pro",
  sugerencia?.negocio ?? "(ninguno)"
);
comprobar(
  "y dice que hay que asignarle la app al usuario del sistema",
  /Agregar activos|asignada al usuario del sistema/i.test(
    `${sugerencia?.quePasa} ${sugerencia?.queHacer}`
  ),
  "sí"
);
comprobar(
  "nombra al usuario del sistema concreto",
  (sugerencia?.queHacer ?? "").includes("Admin"),
  "sí"
);

// ── La app no está en ningún negocio ────────────────────────────────────────
const todosRechazan = sugerenciaTokenPermanente([
  { negocio: "Uno", usuario: "Admin", mensaje: NO_PERTENECE },
  { negocio: "Dos", usuario: "Admin", mensaje: NO_PERTENECE },
]);
comprobar(
  "si ninguno es dueño, lo dice y no señala un negocio al azar",
  Boolean(todosRechazan) && !todosRechazan.negocio,
  "sin negocio señalado"
);
comprobar(
  "y explica que hay que agregar la app a un negocio",
  /Apps|app/i.test(todosRechazan?.queHacer ?? ""),
  "sí"
);

// ── Ningún negocio tiene usuarios del sistema ───────────────────────────────
const sinUsuarios = sugerenciaTokenPermanente([
  { negocio: "Uno", usuario: null, mensaje: "no tiene ningún usuario del sistema" },
  { negocio: "Dos", usuario: null, mensaje: "no tiene ningún usuario del sistema" },
]);
comprobar(
  "si no hay usuarios del sistema, dice que hay que crear uno",
  /Usuarios del sistema.*Agregar|«Agregar»/i.test(sinUsuarios?.queHacer ?? ""),
  "sí"
);

// ── Y no inventar ───────────────────────────────────────────────────────────
comprobar(
  "sin intentos no hay sugerencia",
  sugerenciaTokenPermanente([]) === null,
  "null"
);

rmSync(TMP, { recursive: true, force: true });
console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} comprobación(es) mal.`);
process.exit(fallos === 0 ? 0 : 1);
