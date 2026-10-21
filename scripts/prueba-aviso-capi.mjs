// El aviso de que un evento no llegó a Meta.
//
// Antes ese fallo solo vivía en el log del servidor: el bot seguía vendiendo
// igual y el evento perdido no se notaba hasta mirar los números días después.
// Ahora la conversación se marca en rojo y se puede ver el motivo.
//
// Lo que se fija aquí:
//
//  1. Que anotar el resultado NUNCA pueda romper un envío. Es informativo.
//  2. Que solo se pueda reintentar un evento que FALLÓ. Reintentar uno que sí
//     llegó lo contaría dos veces en Meta.
//  3. Que si no reconocemos el error, no se invente una causa.
//
//   node scripts/prueba-aviso-capi.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const RAIZ = process.cwd();
const TMP = join(RAIZ, "scripts", "_tmp-aviso-capi");
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
      include: ["../../src/lib/meta/errores-capi.ts"],
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
const { explicarErrorCapi, subcodigoDe } = require(
  join(TMP, "errores-capi.js")
);

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (nombre, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(nombre, 56)} ${valor}`);
};

// ── Traducción de errores ───────────────────────────────────────────────────
const respuestaDeMeta = (subcode, mensaje) =>
  JSON.stringify({
    error: { message: mensaje, code: 100, error_subcode: subcode },
  });

comprobar(
  "reconoce el dataset sin WABA asociada",
  /WhatsApp \(WABA\)/.test(
    explicarErrorCapi(respuestaDeMeta(2804132, "Invalid parameter"))?.quePasa ?? ""
  ),
  "sí"
);
comprobar(
  "reconoce que falta el click del anuncio",
  /ctwa_clid/.test(
    explicarErrorCapi(respuestaDeMeta(2804071, "Invalid parameter"))?.quePasa ?? ""
  ),
  "sí"
);
comprobar(
  "reconoce que falta la página",
  Boolean(explicarErrorCapi(respuestaDeMeta(2804069, "Invalid parameter"))),
  "sí"
);
comprobar(
  "reconoce el permiso faltante aunque no traiga subcódigo",
  /permiso/.test(explicarErrorCapi("(#100) Missing Permission")?.quePasa ?? ""),
  "sí"
);
comprobar(
  "reconoce el token vencido",
  /caduc/.test(
    explicarErrorCapi("Error validating access token: Session has expired")
      ?.quePasa ?? ""
  ),
  "sí"
);

// LO IMPORTANTE: no inventar.
comprobar(
  "un error desconocido NO se explica con una causa inventada",
  explicarErrorCapi("Algo rarísimo que Meta nunca dijo") === null,
  "devuelve null"
);
comprobar(
  "sin error no hay explicación",
  explicarErrorCapi(null) === null && explicarErrorCapi("") === null,
  "null"
);
comprobar(
  "saca el subcódigo del JSON de Meta",
  subcodigoDe(respuestaDeMeta(2804132, "x")) === "2804132",
  "2804132"
);

// ── Anotar no puede romper un envío ─────────────────────────────────────────
const db = readFileSync(join(RAIZ, "src", "lib", "db.ts"), "utf8");
const registrar = db.slice(db.indexOf("export function registrarEventoCapi"));
comprobar(
  "anotar el resultado no puede tumbar un envío",
  /try \{[\s\S]{0,300}?\} catch/.test(registrar.slice(0, 700)),
  "va envuelto"
);

const conversions = readFileSync(
  join(RAIZ, "src", "lib", "meta", "conversions.ts"),
  "utf8"
);
comprobar(
  "se anota tanto cuando falla como cuando sale bien",
  (conversions.match(/registrarEventoCapi\(/g) ?? []).length >= 3,
  `${(conversions.match(/registrarEventoCapi\(/g) ?? []).length} sitios`
);

// ── Reintentar solo lo que falló ────────────────────────────────────────────
const ruta = readFileSync(
  join(RAIZ, "src", "app", "api", "meta", "capi-estado", "[conversationId]", "route.ts"),
  "utf8"
);
comprobar(
  "solo se reintenta un evento que FALLÓ",
  /capi_last_ok !== 0/.test(ruta) && /status: 400/.test(ruta),
  "sí"
);
comprobar(
  "se explica por qué no se reintenta lo que sí llegó",
  /contaría dos veces|dos veces/.test(ruta),
  "sí"
);

rmSync(TMP, { recursive: true, force: true });
console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} comprobación(es) mal.`);
process.exit(fallos === 0 ? 0 : 1);
