// La papelera de cuentas de lectura de Ads.
//
// Lo que se comprueba es que "Quitar" deje de ser irreversible: que la cuenta
// se esconda pero su token siga ahí, que restaurarla la devuelva entera, y que
// el borrado definitivo no pueda alcanzar por error a una cuenta en uso.
//
// Corre sobre el código real con base de datos EN MEMORIA (NEXT_PHASE), así
// que no toca la base del bot.
//
//   node scripts/prueba-papelera-lectores.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const RAIZ = process.cwd();
const TMP = join(RAIZ, "scripts", "_tmp-papelera");
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

writeFileSync(
  join(TMP, "tsconfig.json"),
  JSON.stringify({
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
    include: ["../../src/lib/db.ts"],
  }),
  "utf8"
);

try {
  execFileSync(
    process.execPath,
    [join(RAIZ, "node_modules", "typescript", "bin", "tsc"), "-p", join(TMP, "tsconfig.json")],
    { stdio: "pipe" }
  );
} catch {
  // Los tipos ambientales del proyecto se quejan y no pintan nada aquí.
}

process.env.NEXT_PHASE = "phase-production-build";
const require = createRequire(import.meta.url);
const Module = require("node:module");
const resolverOriginal = Module._resolveFilename;
Module._resolveFilename = function (peticion, ...resto) {
  if (peticion.startsWith("@/lib/")) peticion = join(TMP, peticion.slice("@/lib/".length));
  return resolverOriginal.call(this, peticion, ...resto);
};

const db = require(join(TMP, "db.js"));

let fallos = 0;
const comprobar = (nombre, condicion) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${nombre}`);
};

const activas = () => db.listMetaAdsReaders().map((r) => r.name);
const enPapelera = () => db.listMetaAdsReadersEnPapelera().map((r) => r.name);

db.saveMetaAdsReader("Cuenta A", "token-A");
db.saveMetaAdsReader("Cuenta B", "token-B");
const a = db.listMetaAdsReaders().find((r) => r.name === "Cuenta A");
const b = db.listMetaAdsReaders().find((r) => r.name === "Cuenta B");

comprobar(
  "nacen activas y fuera de la papelera",
  activas().length === 2 && enPapelera().length === 0
);

db.deleteMetaAdsReader(a.id);
comprobar(
  "quitar la esconde de la lista",
  !activas().includes("Cuenta A") && activas().includes("Cuenta B")
);
comprobar("quitar la manda a la papelera", enPapelera().includes("Cuenta A"));
comprobar(
  "el token sobrevive en la papelera",
  db.getMetaAdsReader(a.id)?.token === "token-A"
);

comprobar(
  "una cuenta en la papelera no se puede editar",
  db.updateMetaAdsReader({ id: a.id, name: "Otro nombre" }) === false
);

comprobar(
  "restaurar la devuelve con su token",
  db.restoreMetaAdsReader(a.id) === true &&
    activas().includes("Cuenta A") &&
    enPapelera().length === 0 &&
    db.getMetaAdsReader(a.id)?.token === "token-A"
);

// El borrado definitivo NUNCA debe alcanzar a una cuenta en uso.
comprobar(
  "borrar definitivo no toca una cuenta activa",
  db.purgeMetaAdsReader(a.id) === false && activas().includes("Cuenta A")
);

db.deleteMetaAdsReader(a.id);
comprobar(
  "borrar definitivo sí actúa desde la papelera",
  db.purgeMetaAdsReader(a.id) === true &&
    db.getMetaAdsReader(a.id) === null &&
    enPapelera().length === 0
);

comprobar(
  "restaurar algo que ya no existe avisa en vez de romper",
  db.restoreMetaAdsReader(a.id) === false
);

// Quitada tiene que dejar de SERVIR, no solo de verse: las rutas que leen
// anuncios preguntan por la activa, y una de la papelera no debe responder.
db.saveMetaAdsReader("Cuenta C", "token-C");
const c = db.listMetaAdsReaders().find((r) => r.name === "Cuenta C");
comprobar(
  "activa: sirve para leer anuncios",
  db.getMetaAdsReaderActivo(c.id)?.token === "token-C"
);
db.deleteMetaAdsReader(c.id);
comprobar(
  "en la papelera: deja de servir para leer anuncios",
  db.getMetaAdsReaderActivo(c.id) === null &&
    db.getMetaAdsReader(c.id)?.token === "token-C"
);
db.restoreMetaAdsReader(c.id);

// El nombre es único: volver a crear una que está en la papelera tiene que
// devolverla a la lista, no dejarla escondida.
db.deleteMetaAdsReader(b.id);
db.saveMetaAdsReader("Cuenta B", "token-B-nuevo");
comprobar(
  "recrear un nombre que está en la papelera la devuelve activa",
  activas().includes("Cuenta B") &&
    enPapelera().length === 0 &&
    db.getMetaAdsReader(b.id)?.token === "token-B-nuevo"
);

rmSync(TMP, { recursive: true, force: true });
console.log(fallos === 0 ? "\nLos 12 casos correctos." : `\n${fallos} mal.`);
process.exit(fallos === 0 ? 0 : 1);
