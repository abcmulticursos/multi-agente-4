// Tabla de verdad de "¿se vende en este país?".
//
// El perfil de pago de un país vive en la CAPA de la modalidad activa (lo que
// ves y editas en pantalla) y solo cae a la RAÍZ si esa capa no existe. Esta
// prueba fija que el interruptor de venta lea por ese mismo camino, para que
// nunca vuelva a pasar lo de Argentina: encendido en el editor, apagado para el
// bot, porque en la raíz había quedado un "no vender" viejo.
//
// Corre sobre el CÓDIGO REAL: compila config.ts y lo interroga. Usa base de
// datos en memoria (NEXT_PHASE), así que no toca ningún archivo del bot.
//
//   node scripts/prueba-pais-modalidad.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const RAIZ = process.cwd();
const TMP = join(RAIZ, "scripts", "_tmp-pais");
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

const { isCountrySalesEnabled, getActiveModalityKey, resolveCountryPaymentProfile } =
  require(join(TMP, "workflow", "config.js"));

// Atajos para armar configuraciones de prueba.
const enOrderBump = { order_bump: { enabled: true } };
const raiz = (perfil) => ({ payment_profiles_by_country: { AR: perfil } });
const capa = (modalidad, perfil) => ({
  modality_payment_profiles: { [modalidad]: { AR: perfil } },
});
const juntar = (...partes) => Object.assign({}, ...partes);

const casos = [
  {
    nombre: "sin configurar nada",
    cfg: {},
    modalidad: "lineal",
    vende: true,
    porque: "sin veto en ningún sitio, se vende",
  },
  {
    nombre: "raíz apagada, sin capas",
    cfg: raiz({ enabled: false }),
    modalidad: "lineal",
    vende: false,
    porque: "no hay capa, manda la raíz",
  },
  {
    nombre: "EL CASO ARGENTINA: raíz apagada, capa activa encendida",
    cfg: juntar(enOrderBump, raiz({ enabled: false }), capa("order_bump", { enabled: true })),
    modalidad: "order_bump",
    vende: true,
    porque: "lo que ves en pantalla es lo que manda",
  },
  {
    nombre: "al revés: raíz encendida, capa activa apagada",
    cfg: juntar(enOrderBump, raiz({ enabled: true }), capa("order_bump", { enabled: false })),
    modalidad: "order_bump",
    vende: false,
    porque: "si lo apagaste en esta modalidad, no vende",
  },
  {
    nombre: "capa de OTRA modalidad encendida, raíz apagada",
    cfg: juntar(enOrderBump, raiz({ enabled: false }), capa("lineal", { enabled: true })),
    modalidad: "order_bump",
    vende: false,
    porque: "una modalidad no le presta su perfil a otra",
  },
  {
    nombre: "capa activa encendida pero la bandera del país en false",
    cfg: juntar(enOrderBump, capa("order_bump", { enabled: true }), {
      country_sales_enabled: { AR: false },
    }),
    modalidad: "order_bump",
    vende: false,
    porque: "la bandera del país veta por encima de todo",
  },
  {
    nombre: "capa activa encendida y bandera del país en true",
    cfg: juntar(enOrderBump, raiz({ enabled: false }), capa("order_bump", { enabled: true }), {
      country_sales_enabled: { AR: true },
    }),
    modalidad: "order_bump",
    vende: true,
    porque: "todo dice que sí",
  },
  {
    nombre: "lista blanca: nada activado",
    cfg: { country_sales_whitelist: true },
    modalidad: "lineal",
    vende: false,
    porque: "en lista blanca hay que activar a mano",
  },
  {
    nombre: "lista blanca: capa activa encendida",
    cfg: juntar(enOrderBump, { country_sales_whitelist: true }, capa("order_bump", { enabled: true })),
    modalidad: "order_bump",
    vende: true,
    porque: "el perfil encendido basta para entrar en la lista",
  },
  {
    nombre: "lista blanca: solo la raíz encendida, sin capa",
    cfg: juntar(enOrderBump, { country_sales_whitelist: true }, raiz({ enabled: true })),
    modalidad: "order_bump",
    vende: true,
    porque: "sin capa se usa la raíz de respaldo",
  },
  {
    nombre: "lista blanca: raíz encendida pero capa activa apagada",
    cfg: juntar(
      enOrderBump,
      { country_sales_whitelist: true },
      raiz({ enabled: true }),
      capa("order_bump", { enabled: false })
    ),
    modalidad: "order_bump",
    vende: false,
    porque: "la capa tapa a la raíz también en lista blanca",
  },
  {
    nombre: "la capa manda entera: capa sin 'enabled' sobre raíz apagada",
    cfg: juntar(enOrderBump, raiz({ enabled: false }), capa("order_bump", { course_price_soles: 5 })),
    modalidad: "order_bump",
    vende: true,
    porque: "el perfil de la capa sustituye al de la raíz, no se mezclan",
  },
];

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);

for (const caso of casos) {
  const modalidad = getActiveModalityKey(caso.cfg);
  const vende = isCountrySalesEnabled("AR", caso.cfg);
  const perfil = resolveCountryPaymentProfile("AR", caso.cfg);
  const ok = modalidad === caso.modalidad && vende === caso.vende;
  if (!ok) fallos++;
  console.log(
    `${ok ? "ok   " : "FALLA"} ${pad(caso.nombre, 52)} modalidad=${pad(modalidad, 12)} ` +
      `vende=${pad(vende, 6)} perfil=${pad(perfil ? "sí" : "no", 3)} (${caso.porque})`
  );
  if (!ok) {
    console.log(`        esperaba modalidad=${caso.modalidad} vende=${caso.vende}`);
  }
}

// ---------------------------------------------------------------------------
// Lo que de verdad se pide del botón: es del PAÍS, no de la modalidad. Si lo
// enciendes, el país vende en las cinco. Si lo apagas, no vende en ninguna.
// ---------------------------------------------------------------------------
const MODALIDADES = ["lineal", "order_bump", "bioferta", "doble_oferta_dos", "upsell"];

// Enciende una modalidad y apaga las demás.
const enModalidad = (m, extra = {}) => ({
  order_bump: { enabled: m === "order_bump" },
  bioferta_doble: { enabled: m === "bioferta" },
  doble_oferta_dos: { enabled: m === "doble_oferta_dos" },
  upsell: { enabled: m === "upsell" },
  ...extra,
});

console.log("");
let fallosModalidad = 0;
const revisarTodas = (titulo, extra, esperado) => {
  const resultados = MODALIDADES.map((m) => {
    const cfg = enModalidad(m, extra);
    const modalidad = getActiveModalityKey(cfg);
    const vende = isCountrySalesEnabled("AR", cfg);
    return { m, modalidad, vende, ok: modalidad === m && vende === esperado };
  });
  const todoBien = resultados.every((r) => r.ok);
  if (!todoBien) fallosModalidad++;
  console.log(
    `${todoBien ? "ok   " : "FALLA"} ${pad(titulo, 52)} ` +
      resultados.map((r) => `${r.m.slice(0, 6)}=${r.vende ? "SÍ" : "no"}`).join("  ")
  );
  if (!todoBien) {
    console.log(`        esperaba ${esperado ? "SÍ" : "no"} en las cinco`);
    for (const r of resultados.filter((x) => !x.ok)) {
      console.log(`        ${r.m}: modalidad detectada=${r.modalidad} vende=${r.vende}`);
    }
  }
};

// El botón encendido, con la raíz apagada y capa SOLO en lineal: es justo la
// situación en la que Argentina vendía en unas modalidades y en otras no.
revisarTodas(
  "botón ENCENDIDO: vende en las cinco modalidades",
  juntar(
    { country_sales_enabled: { AR: true } },
    raiz({ enabled: false }),
    capa("lineal", { enabled: true })
  ),
  true
);
revisarTodas(
  "botón APAGADO: no vende en ninguna, ni con capa encendida",
  juntar(
    { country_sales_enabled: { AR: false } },
    raiz({ enabled: true }),
    capa("lineal", { enabled: true }),
    capa("upsell", { enabled: true })
  ),
  false
);
revisarTodas(
  "botón ENCENDIDO en lista blanca: vende en las cinco",
  juntar({ country_sales_whitelist: true }, { country_sales_enabled: { AR: true } }, raiz({ enabled: false })),
  true
);
revisarTodas(
  "botón APAGADO en lista blanca: no vende en ninguna",
  juntar({ country_sales_whitelist: true }, { country_sales_enabled: { AR: false } }, raiz({ enabled: true })),
  false
);

rmSync(TMP, { recursive: true, force: true });
const total = fallos + fallosModalidad;
console.log(
  total === 0
    ? `\nCorrecto: ${casos.length} casos sueltos y 4 comprobaciones sobre las cinco modalidades.`
    : `\n${total} comprobación(es) mal.`
);
process.exit(total === 0 ? 0 : 1);
