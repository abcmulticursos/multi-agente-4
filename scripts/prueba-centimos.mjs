// Los céntimos se dicen como céntimos, no como soles.
//
// El caso real: el curso costaba S/. 8.90, el cliente pagó 8, y el bot le dijo
// que faltaban "S/. 0.90 Soles". El cliente lo leyó como soles, mandó 9, y hubo
// que devolverle la diferencia. Menos de una unidad tiene que decirse en la
// parte pequeña de la moneda: "90 céntimos".
//
// Corre sobre el CÓDIGO REAL: compila countries.ts y lo interroga.
//
//   node scripts/prueba-centimos.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const RAIZ = process.cwd();
const TMP = join(RAIZ, "scripts", "_tmp-centimos");
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
      include: ["../../src/lib/countries.ts"],
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
const { formatCurrencyAmount } = require(join(TMP, "countries.js"));

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);

const casos = [
  // ── EL CASO REAL ─────────────────────────────────────────────────────────
  { nombre: "EL CASO REAL: falta 0.90 en Perú", monto: 0.9, pais: "PE", espera: "90 Céntimos" },
  { nombre: "un solo céntimo va en singular", monto: 0.01, pais: "PE", espera: "1 Céntimo" },
  { nombre: "medio sol", monto: 0.5, pais: "PE", espera: "50 Céntimos" },

  // ── LO QUE NO DEBE CAMBIAR ───────────────────────────────────────────────
  // 8.90 y no 8.9: los montos con decimales siempre se han mostrado con dos.
  { nombre: "el precio entero sigue igual", monto: 8.9, pais: "PE", espera: "S/. 8.90 Soles" },
  { nombre: "un sol exacto sigue en soles", monto: 1, pais: "PE", espera: "S/. 1 Sol" },
  { nombre: "diez soles siguen igual", monto: 10, pais: "PE", espera: "S/. 10 Soles" },
  { nombre: "cero no se dice en céntimos", monto: 0, pais: "PE", espera: "S/. 0 Soles" },

  // ── LOS OTROS PAÍSES ─────────────────────────────────────────────────────
  { nombre: "Argentina: centavos", monto: 0.9, pais: "AR", espera: "90 Centavos" },
  { nombre: "México: centavos", monto: 0.25, pais: "MX", espera: "25 Centavos" },
  { nombre: "Ecuador (dólar): centavos", monto: 0.75, pais: "EC", espera: "75 Centavos" },
  { nombre: "Bolivia: centavos", monto: 0.4, pais: "BO", espera: "40 Centavos" },
  { nombre: "Guatemala: centavos", monto: 0.6, pais: "GT", espera: "60 Centavos" },
  { nombre: "Costa Rica: céntimos", monto: 0.3, pais: "CR", espera: "30 Céntimos" },
  { nombre: "Venezuela: céntimos", monto: 0.2, pais: "VE", espera: "20 Céntimos" },
];

const comprobar = (nombre, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(nombre, 46)} ${valor}`);
};

for (const caso of casos) {
  const salida = formatCurrencyAmount(caso.monto, caso.pais);
  const ok = salida === caso.espera;
  if (!ok) fallos++;
  console.log(
    `${ok ? "ok   " : "FALLA"} ${pad(caso.nombre, 46)} ${pad(caso.monto, 6)} → "${salida}"`
  );
  if (!ok) console.log(`        esperaba "${caso.espera}"`);
}

// ── Chile y Colombia: no tienen centavos en la calle ────────────────────────
for (const pais of ["CL", "CO"]) {
  const salida = formatCurrencyAmount(0.9, pais);
  comprobar(
    `${pais}: no inventa centavos que nadie puede pagar`,
    !/centavo|céntimo/i.test(salida),
    `0.9 → "${salida}"`
  );
}

// ── Bordes ──────────────────────────────────────────────────────────────────
comprobar(
  "0.996 no se dice '100 céntimos' sino como una unidad",
  !formatCurrencyAmount(0.996, "PE").includes("100"),
  `0.996 → "${formatCurrencyAmount(0.996, "PE")}"`
);
comprobar(
  "el nombre respeta minúsculas cuando se piden",
  formatCurrencyAmount(0.9, "PE", null, "lower") === "90 céntimos",
  `"${formatCurrencyAmount(0.9, "PE", null, "lower")}"`
);
comprobar(
  "el nombre respeta mayúsculas cuando se piden",
  formatCurrencyAmount(0.9, "PE", null, "upper") === "90 CÉNTIMOS",
  `"${formatCurrencyAmount(0.9, "PE", null, "upper")}"`
);
comprobar(
  "un monto negativo no se rompe",
  typeof formatCurrencyAmount(-0.5, "PE") === "string",
  `-0.5 → "${formatCurrencyAmount(-0.5, "PE")}"`
);

rmSync(TMP, { recursive: true, force: true });
console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} comprobación(es) mal.`);
process.exit(fallos === 0 ? 0 : 1);
