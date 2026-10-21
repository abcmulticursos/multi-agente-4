// El pixel del CAPI, elegido desde la pantalla en vez de EasyPanel.
//
// Lo que se fija aquí:
//
//  1. Que el motor lea el pixel ELEGIDO, y que si no hay elección siga
//     funcionando con la variable de entorno de siempre. Si esto se rompe, los
//     eventos se irían a otro dataset o a ninguno.
//  2. Que se listen los pixels PROPIOS y los COMPARTIDOS. Mirando solo los
//     propios, un pixel que otro negocio comparte no aparecería.
//  3. Que con varios pixels no se elija uno por ti. Quedarse con el primero que
//     devuelva Meta sería adivinar a qué dataset van tus compras.
//
//   node scripts/prueba-pixel-capi.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const RAIZ = process.cwd();
const TMP = join(RAIZ, "scripts", "_tmp-pixel");
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
      include: ["../../src/lib/meta/runtime-config.ts"],
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

process.env.NEXT_PHASE = "phase-production-build";
const require = createRequire(import.meta.url);
const Module = require("node:module");
const resolverOriginal = Module._resolveFilename;
Module._resolveFilename = function (p, ...r) {
  if (p.startsWith("@/lib/")) p = join(TMP, p.slice("@/lib/".length));
  return resolverOriginal.call(this, p, ...r);
};

const { getCapiPixelId } = require(join(TMP, "meta", "runtime-config.js"));
const { setMetaRuntimeSettings, deleteMetaRuntimeSettings } = require(join(TMP, "db.js"));

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (nombre, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(nombre, 58)} ${valor}`);
};

// ── 1. Quién manda ──────────────────────────────────────────────────────────
delete process.env.META_PIXEL_ID;
delete process.env.META_CAPI_PIXEL_ID;
deleteMetaRuntimeSettings(["capi_pixel_id"]);
comprobar(
  "sin elección y sin variable, no hay pixel",
  getCapiPixelId() === null,
  String(getCapiPixelId())
);

process.env.META_CAPI_PIXEL_ID = "111111";
comprobar(
  "sin elección, manda la variable de entorno (como siempre)",
  getCapiPixelId() === "111111",
  getCapiPixelId()
);

setMetaRuntimeSettings({ capi_pixel_id: "999999" });
comprobar(
  "con elección, manda la elegida en la pantalla",
  getCapiPixelId() === "999999",
  getCapiPixelId()
);

deleteMetaRuntimeSettings(["capi_pixel_id"]);
comprobar(
  "al deshacer la elección, vuelve la variable de entorno",
  getCapiPixelId() === "111111",
  getCapiPixelId()
);

// ── 2. De dónde salen los pixels ────────────────────────────────────────────
const connect = readFileSync(join(RAIZ, "src", "lib", "meta", "connect.ts"), "utf8");
comprobar(
  "se piden los pixels PROPIOS y los COMPARTIDOS",
  connect.includes("owned_pixels") && connect.includes("client_pixels"),
  "sí"
);

// ── 3. No elegir por el usuario ─────────────────────────────────────────────
const callback = readFileSync(
  join(RAIZ, "src", "app", "api", "meta", "connect", "callback", "route.ts"),
  "utf8"
);
comprobar(
  "solo se preselecciona cuando hay UN pixel",
  /pixelOptions\.length === 1/.test(callback),
  "sí"
);
comprobar(
  "no se pisa una elección ya hecha",
  /!getMetaRuntimeSetting\("capi_pixel_id"\)/.test(callback),
  "sí"
);
comprobar(
  "si listar los pixels falla, la conexión no se rompe",
  /try \{[\s\S]{0,600}?fetchPixelOptions[\s\S]{0,600}?\} catch/.test(callback),
  "sí"
);

// ── 4. No se puede guardar un pixel inventado ───────────────────────────────
const ruta = readFileSync(
  join(RAIZ, "src", "app", "api", "meta", "connect", "pixel", "route.ts"),
  "utf8"
);
comprobar(
  "solo se acepta un pixel de los detectados",
  /conocido/.test(ruta) && /status: 400/.test(ruta),
  "sí"
);

// ── 5. El motor usa el resolvedor, no la variable a pelo ────────────────────
const conversions = readFileSync(
  join(RAIZ, "src", "lib", "meta", "conversions.ts"),
  "utf8"
);
comprobar(
  "conversions.ts ya no lee la variable directamente",
  conversions.includes("getCapiPixelId()") &&
    !/process\.env\.META_PIXEL_ID/.test(conversions),
  "sí"
);

rmSync(TMP, { recursive: true, force: true });
console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} comprobación(es) mal.`);
process.exit(fallos === 0 ? 0 : 1);
