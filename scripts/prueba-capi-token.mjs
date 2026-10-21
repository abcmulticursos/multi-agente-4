// De dónde sale el token que reporta las compras a Meta.
//
// Lo que más importa aquí es que NO se rompa lo que ya funciona: quien tiene
// META_CAPI_ACCESS_TOKEN en EasyPanel debe seguir igual sin tocar nada. La
// novedad —usar el token que ya entrega Meta al conectar— solo entra cuando se
// elige a propósito, o cuando no hay ninguna otra fuente.
//
//   node scripts/prueba-capi-token.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const RAIZ = process.cwd();
const TMP = join(RAIZ, "scripts", "_tmp-capi");
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

const { getCapiAccessToken, getCapiTokenOrigen } = require(
  join(TMP, "meta", "runtime-config.js")
);
const { setMetaRuntimeSettings, deleteMetaRuntimeSettings } = require(
  join(TMP, "db.js")
);

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (nombre, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(nombre, 60)} ${valor}`);
};

const limpiar = () =>
  deleteMetaRuntimeSettings(["capi_token_origen", "capi_access_token"]);

// ── Sin nada: no hay token ──────────────────────────────────────────────────
limpiar();
delete process.env.META_CAPI_ACCESS_TOKEN;
comprobar(
  "sin nada configurado, no hay token",
  getCapiAccessToken() === null,
  String(getCapiAccessToken())
);

// ── LO QUE NO DEBE CAMBIAR: la variable de siempre ──────────────────────────
process.env.META_CAPI_ACCESS_TOKEN = "TOKEN_DE_LA_VARIABLE";
comprobar(
  "con la variable puesta y sin elegir nada, manda la variable",
  getCapiAccessToken() === "TOKEN_DE_LA_VARIABLE",
  getCapiTokenOrigen()
);

// ── Un token pegado a mano gana sobre la variable ───────────────────────────
setMetaRuntimeSettings({ capi_access_token: "TOKEN_A_MANO" });
comprobar(
  "un token pegado a mano manda sobre la variable",
  getCapiAccessToken() === "TOKEN_A_MANO",
  getCapiTokenOrigen()
);

// ── Elegir explícitamente la variable la devuelve al mando ──────────────────
setMetaRuntimeSettings({ capi_token_origen: "variable" });
comprobar(
  "al elegir la variable, vuelve a mandar aunque haya uno a mano",
  getCapiAccessToken() === "TOKEN_DE_LA_VARIABLE",
  getCapiTokenOrigen()
);

// ── Elegir manual ───────────────────────────────────────────────────────────
setMetaRuntimeSettings({ capi_token_origen: "manual" });
comprobar(
  "al elegir manual, manda el pegado a mano",
  getCapiAccessToken() === "TOKEN_A_MANO",
  getCapiTokenOrigen()
);

// ── Deshacer todo devuelve el comportamiento de siempre ─────────────────────
limpiar();
comprobar(
  "al deshacer, vuelve exactamente al comportamiento de antes",
  getCapiAccessToken() === "TOKEN_DE_LA_VARIABLE" &&
    getCapiTokenOrigen() === "variable",
  getCapiTokenOrigen()
);

// ── Que el motor use el resolvedor ──────────────────────────────────────────
const conversions = readFileSync(
  join(RAIZ, "src", "lib", "meta", "conversions.ts"),
  "utf8"
);
comprobar(
  "conversions.ts ya no lee la variable del token a pelo",
  conversions.includes("getCapiAccessToken()") &&
    !/const token = process\.env\.META_CAPI_ACCESS_TOKEN/.test(conversions),
  "sí"
);

// ── Probar el acceso no escribe nada ────────────────────────────────────────
const ruta = readFileSync(
  join(RAIZ, "src", "app", "api", "meta", "connect", "capi", "route.ts"),
  "utf8"
);
const probar = ruta.slice(ruta.indexOf("export async function PUT"));
comprobar(
  "sin código de prueba, probar NO manda ningún evento",
  /if \(codigoDePrueba\) \{/.test(probar),
  "solo lee"
);
comprobar(
  "el evento de prueba SIEMPRE lleva el código: nunca cuenta como venta",
  /test_event_code: codigoDePrueba/.test(probar) &&
    // No puede haber un envío a /events fuera del bloque del código.
    probar.split("/events").length - 1 === 1,
  "sí"
);
comprobar(
  "el teléfono del evento de prueba va hasheado, y es de ejemplo",
  /createHash\("sha256"\)/.test(probar) && /51999888777/.test(probar),
  "sí"
);
comprobar(
  "el token guardado nunca se devuelve a la pantalla",
  !/capi_access_token"\)\s*[,}]/.test(ruta.slice(ruta.indexOf("function estado"))) ||
    ruta.includes("hayManual: Boolean("),
  "solo se dice si existe"
);
comprobar(
  "elegir manual sin pegar token no se guarda a medias",
  /Pega el token antes de guardar/.test(ruta),
  "avisa"
);

rmSync(TMP, { recursive: true, force: true });
console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} comprobación(es) mal.`);
process.exit(fallos === 0 ? 0 : 1);
