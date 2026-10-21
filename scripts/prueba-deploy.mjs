// ¿Qué hará el bot con el código nuevo y la configuración que hay HOY en
// producción?
//
// No razona: carga el intro-data.yaml que está en la rama publicada, lo pasa
// por el cargador de verdad y pregunta. Base de datos en memoria: no toca nada.
//
//   node scripts/prueba-deploy.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const RAIZ = process.cwd();
const TMP = join(RAIZ, "scripts", "_tmp-deploy");
rmSync(TMP, { recursive: true, force: true });
mkdirSync(join(TMP, "compilado"), { recursive: true });
mkdirSync(join(TMP, "casa", "config"), { recursive: true });

// La configuración PUBLICADA, no la del disco: es la que el bot está usando.
const yaml = execFileSync("git", ["show", "origin/main:config/intro-data.yaml"], {
  cwd: RAIZ,
  maxBuffer: 64 * 1024 * 1024,
});
writeFileSync(join(TMP, "casa", "config", "intro-data.yaml"), yaml);

writeFileSync(
  join(TMP, "compilado", "tsconfig.json"),
  JSON.stringify({
    compilerOptions: {
      outDir: ".",
      module: "commonjs",
      target: "es2022",
      moduleResolution: "node",
      skipLibCheck: true,
      esModuleInterop: true,
      resolveJsonModule: true,
      noEmit: false,
      baseUrl: "../../..",
      paths: { "@/*": ["src/*"] },
    },
    include: ["../../../src/lib/workflow/config.ts"],
  }),
  "utf8"
);

try {
  execFileSync(
    process.execPath,
    [
      join(RAIZ, "node_modules", "typescript", "bin", "tsc"),
      "-p",
      join(TMP, "compilado", "tsconfig.json"),
    ],
    { stdio: "pipe" }
  );
} catch {
  // Los tipos ambientales del proyecto se quejan y aquí no pintan nada.
}
if (!existsSync(join(TMP, "compilado", "workflow", "config.js"))) {
  throw new Error("no se pudo compilar config.ts");
}

process.env.NEXT_PHASE = "phase-production-build";
process.chdir(join(TMP, "casa"));

const require = createRequire(import.meta.url);
const Module = require("node:module");
const resolverOriginal = Module._resolveFilename;
Module._resolveFilename = function (peticion, ...resto) {
  if (peticion.startsWith("@/lib/")) {
    peticion = join(TMP, "compilado", peticion.slice("@/lib/".length));
  }
  return resolverOriginal.call(this, peticion, ...resto);
};

const cfgMod = require(join(TMP, "compilado", "workflow", "config.js"));
const config = cfgMod.loadWorkflowConfig();
if (!config) throw new Error("el cargador no leyó la configuración");

const modalidad = cfgMod.getActiveModalityKey(config);
const dosOpciones = cfgMod.getActiveTwoTierOffer(config);
const ofreceUpsell = cfgMod.isUpsellUsable(config);
// La etapa de la modalidad que vende, por la MISMA puerta que usa el motor: cada
// modalidad lee la suya y ninguna la de otra.
const upsell = cfgMod.seccionUpsell(config);
const moderacion = config.moderacion ?? {};

let fallos = 0;
const comprobar = (nombre, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${nombre}: ${valor}`);
};

// La modalidad que toca según los interruptores del propio YAML. No se da por
// hecho ninguna en concreto: cada bot corre en la suya y puede cambiarla.
//
// EL INTERRUPTOR DE LA MODALIDAD UPSELL VA APARTE DEL DE SU ETAPA.
//
// `upsell.enabled` paso a significar «esta modalidad ofrece un segundo producto
// tras entregar», y eso lo puede tener cualquiera. Quien vende lo dice
// `upsell_modalidad_enabled`. Con el campo viejo, encender la etapa en Order
// Bump se leia aqui como «vende la modalidad Upsell» — y esta prueba se ponia
// roja avisando de un cambio de modalidad que no existia.
//
// El `??` es la compatibilidad, igual que en el motor: un archivo que todavia no
// se ha guardado con esta version se sigue decidiendo con el campo antiguo.
const escalera = config.doble_oferta_upsell?.enabled
  ? "doble_oferta_upsell"
  : (config.upsell_modalidad_enabled ?? config.upsell?.enabled)
    ? "upsell"
    : config.doble_oferta_dos?.enabled
      ? "doble_oferta_dos"
      : config.order_bump?.enabled
        ? "order_bump"
        : config.bioferta_doble?.enabled
          ? "bioferta"
          : "lineal";
const DOS_OPCIONES = [
  "order_bump",
  "doble_oferta_dos",
  "doble_oferta_upsell",
  "bioferta",
];

// AVISO APARTE: una modalidad encendida pero SIN LLENAR.
//
// Es lo que paso de verdad: se activo "Doble Oferta + Upsell" desde el
// desplegable —el unico camino que quedaba, porque un fallo impedia entrar a
// sus pestañas— y quedo vendiendo con los nombres de muestra puestos. Nada
// fallaba: el bot arrancaba y ofrecia "<<NOMBRE_OPCION_COMBO>>".
const nombresDeMuestra = [
  dosOpciones?.combo?.name,
  dosOpciones?.basico?.name,
].filter((n) => typeof n === "string" && n.includes("<<"));

comprobar(
  `la modalidad que venderá es la que dicen los interruptores (${escalera})`,
  modalidad === escalera,
  modalidad
);
// CON «PRESENTA:», UNA MODALIDAD DE UNA PUEDE VENDER DOS.
//
// Hasta el 23/09/2026 solo -OB- y las dos Dobles Ofertas podian tener oferta de
// dos opciones, y aqui se comprobaba justo eso. El selector «PRESENTA:» rompe
// esa equivalencia a proposito: lineal vende dos SIN dejar de llamarse lineal,
// que es lo que permite cambiar de forma sin mover el contenido.
//
// Lo que esta comprobacion protege NO cambia: que lo que el bot ofrece y lo que
// dicen los interruptores digan lo mismo. Solo se le añade el tercer caso.
const prestada = config?.segunda_opcion_prestada;
const puedeOfrecerDos =
  DOS_OPCIONES.includes(modalidad) ||
  prestada === "dos_juntas" ||
  prestada === "segunda_oculta";
comprobar(
  puedeOfrecerDos
    ? "la oferta de 2 opciones sigue en pie"
    : "esta modalidad no ofrece 2 opciones, y no las ofrece",
  puedeOfrecerDos ? dosOpciones !== null : dosOpciones === null,
  dosOpciones ? `${dosOpciones.basico?.name} / ${dosOpciones.combo?.name}` : "ninguna"
);
comprobar(
  "la modalidad activa esta LLENA, no con textos de muestra",
  nombresDeMuestra.length === 0,
  nombresDeMuestra.length ? nombresDeMuestra.join(" / ") : "sin textos de muestra"
);
// LA ETAPA UPSELL YA ES DE CUALQUIER MODALIDAD.
//
// Antes esto vigilaba que solo la ofrecieran «Upsell» y «Doble Oferta + Upsell»,
// porque fuera de ellas la puerta devolvia null. Ahora cada modalidad guarda la
// suya, asi que ofrecerla en Order Bump o en Lineal es lo esperado.
//
// Lo que hay que seguir mirando antes de deployar es que la que se va a ofrecer
// este COMPLETA: encendida, con nombre de verdad y con precio. Una a medias no
// se ofrece —el motor lo impide— pero se descubre despues de una venta, y esta
// prueba existe justo para no descubrir nada despues.
comprobar(
  ofreceUpsell
    ? "el segundo producto que se va a ofrecer está completo"
    : "esta modalidad no ofrece un segundo producto",
  ofreceUpsell === false ||
    ((upsell?.name ?? "").trim().length >= 2 &&
      !(upsell?.name ?? "").includes("<<")),
  ofreceUpsell
    ? `${upsell?.name ?? "(sin nombre)"} en modalidad ${modalidad}`
    : "ninguno"
);
comprobar(
  "la moderación no bloqueará a nadie",
  moderacion.piropos_enabled !== true && moderacion.basura_enabled !== true,
  `piropos=${moderacion.piropos_enabled === true} basura=${moderacion.basura_enabled === true}`
);
comprobar(
  "el modo silencioso sigue como estaba",
  true,
  String(config.silent_mode === true)
);
comprobar(
  "los seguimientos siguen como estaban",
  true,
  String(config.followups_enabled !== false)
);

process.chdir(RAIZ);
rmSync(TMP, { recursive: true, force: true });
console.log(
  fallos === 0
    ? "\nCon la configuración de hoy, el bot se comporta igual que antes."
    : `\n${fallos} cosa(s) cambiarían. NO deployar sin revisar.`
);
process.exit(fallos === 0 ? 0 : 1);
