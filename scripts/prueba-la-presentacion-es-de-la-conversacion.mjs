// LA PRESENTACION ES DE LA CONVERSACION, NO DEL SELECTOR DE HOY.
//
// LO QUE PIDIO EL DUENO — 25 de septiembre de 2026, con sus palabras: «yo uso
// como lineal, y cambio a como dou y cambio a como ob cuando yo desee, debe estar
// preparado para el cambio sin romperse».
//
// EL PROBLEMA. El selector «PRESENTA:» vive en la configuracion, o sea que es uno
// para todos. Al moverlo, los clientes que estaban a media conversacion cambiaban
// de venta en seco: a alguien a quien se le presento UN producto y se le dio SU
// precio, el bot empezaba a hablarle de dos opciones y una mas cara. Le
// contradecia lo que acababa de decirle.
//
// LO QUE SE HIZO. Cada conversacion anota con que presentacion nacio y la lee en
// cada turno. Los que ya estaban terminan su venta como empezo; los nuevos
// arrancan con lo nuevo. Es el mismo principio que los precios congelados, que ya
// existian y por el mismo motivo: lo que se le prometio a un cliente no se le
// cambia por debajo.
//
// Y ES EL MECANISMO DEL SIMULADOR, COPIADO, NO INVENTADO: un almacen por turno
// —`AsyncLocalStorage`— que ya se usa para probar una modalidad sin tocar la que
// venden las clientas. Lleva semanas funcionando con conversaciones en paralelo.
//
// LO QUE NO PUEDE ROMPERSE:
//
//   · SIN NADA ANOTADO SE LEE EL SELECTOR DE HOY. Es el comportamiento anterior
//     letra por letra, y es lo que hace que el peor fallo posible de este cambio
//     sea «se comporta como antes» y nunca «se rompe». Las conversaciones que ya
//     existian no tienen nada anotado.
//   · «NINGUNA» ES UNA RESPUESTA, NO UN HUECO: significa «esta conversacion
//     empezo vendiendo un solo producto». Sin guardarlo, al encender el selector
//     la conversacion de ayer se leeria como si hubiera nacido con dos.
//   · SE ESCRIBE UNA SOLA VEZ, y lo garantiza la base de datos con su
//     `WHERE presentacion_de_venta IS NULL`.
//   · Y LA COMPROBACION DEL DATO NO SE SALTA: aunque la conversacion naciera con
//     la presentacion puesta, si hoy no hay dos productos sentados no hay dos que
//     vender.
//
//   node scripts/prueba-la-presentacion-es-de-la-conversacion.mjs
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, utimesSync } from "node:fs";
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
        source: `
          export const getConversationByPhone = () => null;
          export const getConversationById = () => null;
          export const getFrozenPrices = () => null;
          export const getUpsellFrozenPrices = () => null; export const getPuestoEnLaFila = () => null; export const leerCompradosDeLaFila = () => []; export const moverLaFila = () => {};
          export const setFrozenPrices = () => {};
        `,
      };
    return next(url, ctx);
  },
});

const CARO = "TORNADO AZUL";
const BARATO = "CANELA SIMPLE";
const CASA = mkdtempSync(join(tmpdir(), "presentacion-convo-"));
mkdirSync(join(CASA, "config"), { recursive: true });
const ARCHIVO = join(CASA, "config", "intro-data.yaml");
let reloj = 1_700_000_000;
const montar = (extra) => {
  writeFileSync(
    ARCHIVO,
    aYaml({
      country: "PE",
      greeting: { body_variants: ["hola"] },
      intro_sequence: [{ type: "text", body_variants: ["la intro"] }],
      payment_responses: { yape: [{ type: "text", body_variants: ["datos"] }] },
      course_price_soles: 10,
      biblioteca_de_productos: [
        { id: "pb", name: BARATO, price_soles: 10 },
        { id: "pf", name: CARO, price_soles: 14 },
      ],
      lineal: { enabled: true },
      alineacion_por_modalidad: {
        lineal: { basico: "pb", unico: "pb", full: "pf" },
      },
      ...extra,
    }),
    "utf8"
  );
  reloj += 60;
  const f = new Date(reloj * 1000);
  utimesSync(ARCHIVO, f, f);
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
    `${ok ? "ok   " : "FALLA"} ${titulo.padEnd(56).slice(0, 56)} ${nota}`
  );
};

const conSelector = (valor) => {
  montar(valor ? { segunda_opcion_prestada: valor } : {});
  return m.loadWorkflowConfig();
};
/** Lo que el bot cree que esta vendiendo, atendiendo a ESA conversacion. */
const comoVende = (presentacionDeLaConvo, cfg) =>
  m.conLaPresentacionDeLaConversacion(presentacionDeLaConvo, () => ({
    prestada: m.segundaOpcionPrestada(cfg),
    esOB: m.isOrderBumpActive(),
    hayDos: m.getActiveTwoTierOffer(cfg) !== null,
  }));

// ── 1. EL SELECTOR CAMBIA Y LA CONVERSACION NO SE ENTERA ────────────────────
console.log("-- 1. el cliente que empezo en lineal sigue en lineal -----");
let cfg = conSelector("segunda_oculta"); // el dueno acaba de moverlo
let visto = comoVende("ninguna", cfg);
comprobar(
  "nacio en lineal: no hay presentacion prestada",
  visto.prestada === null,
  "aunque el selector diga «como ob»"
);
comprobar(
  "y para el no hay Order Bump",
  visto.esOB === false,
  "se le prometio un producto"
);

// ── 2. Y EL QUE NACIO CON ELLA LA CONSERVA ──────────────────────────────────
console.log("\n-- 2. y el que nacio con la oferta la conserva -----------");
cfg = conSelector(null); // ahora el dueno lo apago
visto = comoVende("segunda_oculta", cfg);
comprobar(
  "nacio en «como ob»: sigue en «como ob»",
  visto.prestada === "segunda_oculta",
  "aunque el selector este apagado"
);
comprobar(
  "y para el SI hay Order Bump",
  visto.esOB === true,
  "se le presentaron dos opciones"
);

// ── 3. LAS DOS A LA VEZ, QUE ES LA VENTA REAL ───────────────────────────────
//
// El dueno atiende muchas conversaciones en paralelo. Dos clientes, en el mismo
// segundo, con presentaciones distintas: cada uno tiene que ver la suya.
console.log("\n-- 3. dos conversaciones a la vez, cada una la suya ------");
cfg = conSelector("dos_juntas");
const unaEnLineal = comoVende("ninguna", cfg);
const otraEnDou = comoVende("dos_juntas", cfg);
comprobar(
  "la de lineal no ve la oferta",
  unaEnLineal.prestada === null,
  "no se contaminan"
);
comprobar(
  "la de «como dou» si la ve",
  otraEnDou.prestada === "dos_juntas",
  "en el mismo segundo"
);

// ── 4. LO QUE NO PUEDE ROMPERSE: SIN NADA ANOTADO, COMO ANTES ───────────────
//
// Es la mitad que protege a quien esta hablando ahora mismo: las conversaciones
// de antes de este cambio no tienen presentacion anotada.
console.log("\n-- 4. sin nada anotado, el selector de hoy ---------------");
cfg = conSelector("segunda_oculta");
comprobar(
  "fuera del almacen manda el selector",
  m.segundaOpcionPrestada(cfg) === "segunda_oculta",
  "letra por letra como antes"
);
for (const vacio of [null, undefined]) {
  comprobar(
    `y con la presentacion en ${vacio === null ? "null" : "undefined"} tambien`,
    comoVende(vacio, cfg).prestada === "segunda_oculta",
    "las conversaciones de ayer"
  );
}

// ── 5. LA COMPROBACION DEL DATO NO SE SALTA ─────────────────────────────────
//
// Con la presentacion anotada pero SIN el segundo producto sentado no hay dos que
// vender. Presentar dos cuando solo hay una es peor que no presentar ninguna.
console.log("\n-- 5. sin el segundo sentado, no hay oferta --------------");
montar({
  segunda_opcion_prestada: null,
  alineacion_por_modalidad: { lineal: { unico: "pb", basico: "pb" } },
});
cfg = m.loadWorkflowConfig();
visto = comoVende("segunda_oculta", cfg);
comprobar(
  "no se inventa una segunda opcion",
  visto.esOB === false && visto.hayDos === false,
  "el dato manda sobre lo anotado"
);

// ── 6. QUE SE ANOTA AL NACER ────────────────────────────────────────────────
//
// `config.ts` DECIDE EL VALOR Y EL HANDLER ESCRIBE, a proposito: config.ts no
// puede ganar dependencias nuevas de la base de datos. Los ~20 bancos de pruebas
// la importan con un doble que exporta cinco funciones, y una sexta los rompe
// todos a la vez — paso en el primer intento de esto, 26 pruebas en rojo por un
// import.
console.log("\n-- 6. que se anota al nacer ------------------------------");
cfg = conSelector("segunda_oculta");
comprobar(
  "con el selector puesto, anota esa presentacion",
  m.laPresentacionConLaQueNace({ id: 7, presentacion_de_venta: null }) ===
    "segunda_oculta",
  "la de hoy, al nacer"
);
cfg = conSelector(null);
comprobar(
  "en lineal puro anota «ninguna», no vacio",
  m.laPresentacionConLaQueNace({ id: 8, presentacion_de_venta: null }) ===
    "ninguna",
  "vacio significaria «lee el de hoy»"
);
comprobar(
  "y a quien ya la tiene no se le toca",
  m.laPresentacionConLaQueNace({ id: 9, presentacion_de_venta: "dos_juntas" }) ===
    null,
  "no hay nada que escribir"
);

// ── 7. LOS TRES SITIOS DONDE EMPIEZA UN TURNO ───────────────────────────────
//
// Si un camino se olvidara de abrir el almacen, esa conversacion leeria el
// selector de hoy — o sea, se comportaria como antes. Aun asi se fijan aqui,
// porque el silencio de un camino olvidado no se ve por ningun otro lado.
console.log("\n-- 7. los sitios donde se abre el almacen ---------------");
const handler = readFileSync(
  join(RAIZ, "src", "lib", "meta", "handler.ts"),
  "utf8"
);
const motor = readFileSync(
  join(RAIZ, "src", "lib", "workflow", "engine.ts"),
  "utf8"
);
// EL 05/10/2026 ESA LLAMADA SE ENVOLVIO CON LA TIENDA, y esta afirmacion se actualiza
// conservando su intencion: lo que fija es que EL SELLO SE ANOTA AL LLEGAR EL MENSAJE, al
// lado del precio congelado. Eso sigue igual; lo que cambio es de donde sale el valor.
//
// POR QUE SE ENVOLVIO: aqui arriba no hay tienda abierta —la abre `conElTurnoDe` cien lineas
// mas abajo—, asi que el sello se escribia leyendo el selector GENERAL. El dueño lo vio dos
// veces el mismo dia: una tienda en COMO -DOU- soltando la intro de otra cosa, y una
// conversacion NATIVA de -OB- recibiendo «hemos actualizado... ahora tenemos 2 opciones», que
// es el aviso de una transicion que nunca ocurrio. Ver `prueba-el-sello-sale-de-la-tienda`.
comprobar(
  "el mensaje que llega: se anota al ingresarlo",
  /const presentacionAlNacer = conLaTiendaDelTurno\(\s*\r?\n\s*laTiendaDeLaConversacion\(convo\),\s*\r?\n\s*\(\) => laPresentacionConLaQueNace\(convo\)\s*\r?\n\s*\);/.test(
    handler
  ) && /fijarPresentacionDeVentaSiFalta\(convo\.id, presentacionAlNacer\);/.test(handler),
  "al lado del precio congelado, y con su tienda"
);
// EL 30/09/2026 LAS DOS LLAMADAS PASARON A SER UNA. `conElTurnoDe` abre la
// tienda del número y, DENTRO, la presentación de la conversación — en ese orden,
// porque la presentación manda sobre el selector de la tienda. La intención de
// estas dos comprobaciones no cambia: el turno entero se atiende con la suya.
comprobar(
  "y el turno entero se atiende con la suya",
  /await conElTurnoDe\(convo, async \(\) => \{/.test(handler),
  "motor, modelo y envio"
);
comprobar(
  "el worker de los seguimientos, tambien",
  /conElTurnoDe\(convo, \(\) =>/.test(motor),
  "salen horas despues"
);
comprobar(
  "y dentro sigue abriendose la presentacion de la conversacion",
  /conLaPresentacionDeLaConversacion\([\s\S]{0,200}?presentacion_de_venta/.test(
    readFileSync(join(RAIZ, "src", "lib", "workflow", "config.ts"), "utf8")
  ),
  "la tienda no la reemplaza"
);
comprobar(
  "y se escribe una sola vez desde la base",
  /WHERE id = \? AND presentacion_de_venta IS NULL/.test(
    readFileSync(join(RAIZ, "src", "lib", "db.ts"), "utf8")
  ),
  "no depende de acordarse"
);

process.chdir(RAIZ);
console.log(
  fallos === 0
    ? "\nTODO OK — cada conversacion vende con la presentacion que empezo\n"
    : `\n${fallos} comprobacion(es) mal.\n`
);
process.exit(fallos === 0 ? 0 : 1);
