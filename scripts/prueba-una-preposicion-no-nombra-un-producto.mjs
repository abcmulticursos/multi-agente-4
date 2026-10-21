// UNA PREPOSICION NO NOMBRA UN PRODUCTO, Y UN IMPORTE EXACTO SI.
//
// LO QUE PASO — 28 de septiembre de 2026, sus pruebas HOLARG1 y HOLAPER1. Las
// dos venian de vender UN SOLO producto, asi que no tenian ninguna eleccion
// anotada. Su registro lo cuenta en dos lineas, y solo aparece en esas dos
// conversaciones —las otras cuatro fueron normales—:
//
//     [wf:pago] sincronizo order bump "ninguno" -> "combo" segun intencion reciente
//     [wf:pago] PARCIAL (total: S/. 10 Soles / S/. 14 Soles)
//
// El bot le pidio 10, pago 10, y le reclamo 4 mas. Una de las dos NUNCA recibio
// el material: tuvo que insistir cinco veces y el bot le repitio que ya se lo
// habia enviado.
//
// LA CAUSA, medida ejecutando la funcion real con su configuracion. Su opcion
// cara se llamaba «<algo> 2 EN 1», asi que la preposicion «EN» quedo como palabra
// EXCLUSIVA de esa opcion. Doce de diecisiete frases normales de un cliente que
// NO estaba eligiendo nada registraban la opcion CARA:
//
//     «pago en yape»   «estoy en casa»   «lo vi en facebook»   «vivo en lima»
//
// Y ES EL MISMO FALLO DEL 25/09, TRES DIAS DESPUES. Aquel arreglo quito los
// NUMEROS de ese mismo nombre —«son 2» registraba la cara— y dejo la preposicion.
// Tapo el digito, no la clase: «una palabra del nombre que no identifica nada».
//
// LOS DOS ARREGLOS, y cada uno por separado habria evitado su caso:
//
//   1. `tokensPropiosDeCadaOpcion` no cuenta las palabras de gramatica.
//   2. Sin eleccion previa, un importe exacto manda sobre una palabra suelta.
//
// EL SEGUNDO ES EL QUE CIERRA LA FAMILIA: cualquier palabra del nombre puede
// volver a coincidir por casualidad el dia que cambie de producto.
//
//   node scripts/prueba-una-preposicion-no-nombra-un-producto.mjs
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import {
  readFileSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  utimesSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";

const RAIZ = process.cwd();
const YAML = createRequire(join(RAIZ, "package.json"))("yaml");
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
        // LAS CINCO DE SIEMPRE. Una sexta rompe los ~20 bancos a la vez.
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

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 56)} ${valor}`);
};

// ── SU FORMA DE NOMBRAR, CON PRODUCTOS INVENTADOS ───────────────────────────
//
// La clave del fixture: el nombre de la opcion cara lleva una PREPOSICION y un
// NUMERO, que es la forma real en que el nombra un pack. Nunca con sus productos
// reales: una prueba escrita con ellos tapa este mismo fallo.
const CARA = "PACK GRANDE 2 EN 1";
const BARATA = "GUIA CHICA";
const CASA = mkdtempSync(join(tmpdir(), "preposicion-no-nombra-"));
mkdirSync(join(CASA, "config"), { recursive: true });
const ARCHIVO = join(CASA, "config", "intro-data.yaml");
let reloj = 1_700_000_000;
const montar = (extra) => {
  writeFileSync(
    ARCHIVO,
    YAML.stringify({
      country: "PE",
      greeting: { body_variants: ["hola"] },
      intro_sequence: [{ type: "text", body_variants: ["la intro"] }],
      payment_responses: { yape: [{ type: "text", body_variants: ["datos"] }] },
      course_price_soles: 30,
      // EL SOLAPE ES EL SUYO: el precio de OFERTA de la cara (40) es el MISMO que
      // el precio NORMAL de la barata. Con los cuatro precios en una bolsa, un
      // pago de 40 calza con las dos y no desempata nadie.
      biblioteca_de_productos: [
        { id: "pb", name: BARATA, price_soles: 40, discount_price_soles: 24 },
        { id: "pf", name: CARA, price_soles: 50, discount_price_soles: 40 },
      ],
      lineal: { enabled: true },
      alineacion_por_modalidad: {
        lineal: { basico: "pb", unico: "pb", full: "pf" },
      },
      segunda_opcion_prestada: "dos_juntas",
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
const TEL = "51900000000";

const cfg = m.loadWorkflowConfig();
comprobar("el fixture tiene dos opciones", m.getActiveTwoTierOffer(cfg) !== null);
if (m.getActiveTwoTierOffer(cfg) === null) {
  console.log("\nsin dos opciones no hay caso. PARO.\n");
  process.exit(1);
}

// ── 1. LAS FRASES DE SU PRUEBA YA NO ELIGEN NADA ────────────────────────────
console.log("\n— 1. una frase normal con «en» no registra la opcion cara —\n");
const NO_ELIGEN = [
  // Las dos exactas de su registro, HOLARG1 y HOLAPER1.
  "si en eso estoy",
  "en que momento me envian",
  // Y las que salieron del banco, que son de cualquier dia.
  "pago en yape",
  "estoy en casa",
  "lo vi en facebook",
  "vivo en lima",
  "mi hija esta en primaria",
  "trabajo en un colegio",
  "y en fisico lo tienen",
  "en pdf o impreso",
  "en un rato te pago",
];
for (const frase of NO_ELIGEN) {
  const r = m.inferTwoTierChoiceFromContext(frase, null, cfg);
  comprobar(`«${frase}» no elige`, r === null, r ?? "null");
}

// ── 2. Y NOMBRAR EL PRODUCTO SIGUE ELIGIENDO ────────────────────────────────
//
// Es la mitad que no se puede perder. Si por quitar «en» dejara de reconocerse
// el nombre, el arreglo seria peor que el fallo.
console.log("\n— 2. nombrar el producto sigue eligiendo, en frase y entero —\n");
const SI_ELIGEN = [
  ["quiero el pack grande 2 en 1", "combo"],
  ["ah perdon maestro quiero el grande", "combo"],
  ["me llevo el pack", "combo"],
  ["quiero la guia chica", "basico"],
  ["mejor la chica no tengo mucho", "basico"],
  [CARA.toLowerCase(), "combo"],
  [BARATA.toLowerCase(), "basico"],
];
for (const [frase, esperado] of SI_ELIGEN) {
  const r = m.inferTwoTierChoiceFromContext(frase, null, cfg);
  comprobar(`«${frase}» -> ${esperado}`, r === esperado, r ?? "null");
}

// ── 3. NI LA PRIMERA ELECCION NI EL NOMBRE EXACTO SE MUEVEN ─────────────────
console.log("\n— 3. las otras puertas que beben del mismo calculo —\n");
comprobar(
  "el nombre exacto sigue eligiendo la cara",
  m.detectExactOrderBumpChoice(CARA.toLowerCase(), cfg) === "combo"
);
comprobar(
  "el nombre exacto sigue eligiendo la barata",
  m.detectExactOrderBumpChoice(BARATA.toLowerCase(), cfg) === "basico"
);
comprobar(
  "la PRIMERA eleccion no se dispara con «pago en yape»",
  m.detectTwoTierPick("pago en yape", cfg, { phone: TEL }) === null,
  String(m.detectTwoTierPick("pago en yape", cfg, { phone: TEL }))
);
comprobar(
  "la PRIMERA eleccion sigue cazando el nombre en una frase",
  m.detectTwoTierPick("quiero el grande", cfg, { phone: TEL }) === "combo",
  String(m.detectTwoTierPick("quiero el grande", cfg, { phone: TEL }))
);

// ── 4. UN NOMBRE QUE SOLO ES GRAMATICA NO SE QUEDA MANDANDO ─────────────────
//
// El caso extremo, y tiene que abstenerse en vez de elegir por una palabra que
// esta en cualquier frase. Es lo mismo que ya pasa con un nombre que es solo un
// numero.
console.log("\n— 4. el caso extremo: un nombre de pura gramatica —\n");
montar({
  biblioteca_de_productos: [
    { id: "pb", name: "GUIA CHICA", price_soles: 40, discount_price_soles: 24 },
    { id: "pf", name: "EL DE LOS 2", price_soles: 50, discount_price_soles: 40 },
  ],
});
const cfg4 = m.loadWorkflowConfig();
comprobar(
  "«pago en yape con el de mi mama» no elige",
  m.inferTwoTierChoiceFromContext("pago en yape con el de mi mama", null, cfg4) ===
    null,
  String(m.inferTwoTierChoiceFromContext("pago en yape con el de mi mama", null, cfg4))
);
comprobar(
  "y la barata se sigue pudiendo nombrar",
  m.inferTwoTierChoiceFromContext("quiero la chica", null, cfg4) === "basico",
  String(m.inferTwoTierChoiceFromContext("quiero la chica", null, cfg4))
);

// ── 5. EL SEGUNDO ARREGLO: EL IMPORTE MANDA, Y SUS TRES CANDADOS ────────────
//
// Esto es estatico a proposito: la funcion vive dentro de `executeRegisterPayment`
// y para ejecutarla haria falta la base de datos entera. Lo que se fija aqui son
// los candados, que son lo que no puede desaparecer en una edicion futura.
console.log("\n— 5. sin eleccion previa, el importe exacto manda —\n");
process.chdir(RAIZ);
const pago = readFileSync(join(RAIZ, "src", "lib", "workflow", "payment.ts"), "utf8");
const bloque = pago.slice(
  pago.indexOf("const elImporteSenala ="),
  pago.indexOf("obChoice = recentChoice;")
);
comprobar("el bloque nuevo existe", bloque.length > 400, `${bloque.length} letras`);
comprobar(
  "CANDADO 1: solo cuando no habia eleccion previa",
  /!obChoice\s*&&\s*!laEleccionFueExplicita/.test(bloque)
);
comprobar(
  "CANDADO 2: una eleccion explicita sigue mandando",
  /laEleccionFueExplicita/.test(bloque) &&
    /detectExactOrderBumpChoice\(message\.content, config\) === elegida/.test(pago)
);
comprobar(
  "CANDADO 3: se le pasa la etapa, para desempatar el precio solapado",
  /inferOrderBumpChoiceFromAmount\(\s*args\.amount_soles,\s*convo\.phone,\s*discountActive/.test(
    bloque
  )
);
comprobar(
  "el ganador se elige igual que antes (el primero, con break)",
  /const elegida = inferTwoTierChoiceFromContext\(/.test(pago) &&
    /recentChoice = elegida;/.test(pago) &&
    /break;/.test(pago)
);
comprobar(
  "y la relectura sigue mandando cuando el importe no desempata",
  /sincronizo order bump/.test(pago)
);

// ── 6. LA ETAPA DESEMPATA EL PRECIO SOLAPADO ────────────────────────────────
//
// Con el solape de su fixture, 40 es la CARA con oferta y la BARATA sin ella. Se
// comprueba con los precios de verdad que dentro de UNA etapa no hay empate, que
// es lo que hace util al arreglo 2 con SUS precios.
console.log("\n— 6. dentro de una etapa, el importe no empata —\n");
process.chdir(CASA);
montar({});
const cfg6 = m.loadWorkflowConfig();
const precio = (cual, conOferta) =>
  m.getOrderBumpPriceSoles(cual, conOferta, TEL);
comprobar(
  "sin oferta, la cara y la barata cuestan distinto",
  precio("combo", false) !== precio("basico", false),
  `cara ${precio("combo", false)} · barata ${precio("basico", false)}`
);
comprobar(
  "con oferta, tambien",
  precio("combo", true) !== precio("basico", true),
  `cara ${precio("combo", true)} · barata ${precio("basico", true)}`
);
comprobar(
  "y el solape existe DE VERDAD entre etapas (si no, no habia caso)",
  precio("combo", true) === precio("basico", false),
  `cara con oferta ${precio("combo", true)} = barata sin oferta ${precio("basico", false)}`
);
comprobar(
  "la funcion del importe acepta la etapa",
  /conOferta\?: boolean/.test(pago) &&
    /typeof conOferta === "boolean"/.test(pago)
);
comprobar(
  "y sin etapa se comporta como siempre (los cuatro precios)",
  /near\(getOrderBumpPriceSoles\("combo", false, phone\)\) \|\|/.test(pago)
);
// Y LA OTRA PUERTA DEL IMPORTE, la que decide cuando NADIE eligio nunca. Sin la
// etapa se abstenia con sus precios —10 calza con la cara en oferta y con la
// barata sin ella— y le pedia elegir a quien acababa de pagar bien. Es la pieza
// que hace que HOLAPER1 acabe ENTREGANDO y no solo dejando de cobrar de mas.
comprobar(
  "la inferencia por monto sin eleccion tambien recibe la etapa",
  /const amountChoice = inferOrderBumpChoiceFromAmount\(\s*args\.amount_soles,\s*convo\.phone,\s*discountActive/.test(
    pago
  )
);
comprobar(
  "y sigue detras del candado de «no habia eleccion»",
  /!obChoice &&\s*\n\s*!routeBPostPaymentOrderBump/.test(pago)
);

// ── 7. LA LISTA ES DE GRAMATICA, NO DE PRODUCTOS ───────────────────────────
console.log("\n— 7. lo que dice CLAUDE.md: ningun producto en el codigo —\n");
const conf = readFileSync(join(RAIZ, "src", "lib", "workflow", "config.ts"), "utf8");
const lista = conf.slice(
  conf.indexOf("const PALABRAS_QUE_NO_NOMBRAN_UN_PRODUCTO"),
  conf.indexOf("]);", conf.indexOf("const PALABRAS_QUE_NO_NOMBRAN_UN_PRODUCTO"))
);
comprobar("la lista existe", lista.length > 100, `${lista.length} letras`);
comprobar("lleva la preposicion del caso", /"en"/.test(lista));
comprobar(
  "y NINGUN nombre de producto, precio ni marca de pago",
  !/pack|grafismo|fonetico|super|yape|plin|bcp|soles/i.test(lista)
);
comprobar(
  "se aplica DESPUES de los numeros, sin quitar esa regla",
  /!\/\^\\d\+\$\/\.test\(token\)/.test(conf) &&
    /PALABRAS_QUE_NO_NOMBRAN_UN_PRODUCTO\.has\(token\)/.test(conf)
);

// ── 8. Y EN «COMO OB», DONDE EL SEGUNDO PRODUCTO ESTA TAPADO ────────────────
//
// LO PREGUNTO EL DUEÑO, y con razon: el recorrido de -OB- sale verde pero se para
// ANTES del comprobante, asi que no lo cubria. Es la forma donde mas caro sale:
// del producto full no se dice ni el precio ni el contenido hasta que el cliente
// decide pagar, y una preposicion le anotaba justo ese producto TAPADO — uno que
// el cliente no ha visto nunca.
//
// Las dos formas beben de la MISMA funcion, asi que las dos estaban igual. Aqui se
// comprueba la de -OB- de verdad, no por parecido: se exige que sea order bump y
// NO doble oferta, y que el segundo siga tapado.
console.log("\n— 8. en «como OB», con el segundo producto tapado —\n");
montar({ segunda_opcion_prestada: "segunda_oculta" });
const cfgOb = m.loadWorkflowConfig();
comprobar(
  "es «como OB» de verdad: order bump si, doble oferta no",
  m.isOrderBumpActive(cfgOb) === true && m.isDobleOfertaActive(cfgOb) === false,
  `ob=${m.isOrderBumpActive(cfgOb)} dou=${m.isDobleOfertaActive(cfgOb)}`
);
comprobar(
  "y el segundo producto sigue tapado",
  m.elSegundoProductoSigueTapado({}, cfgOb) === true
);
for (const frase of [
  "si en eso estoy",
  "en que momento me envian",
  "pago en yape",
  "estoy en casa",
]) {
  const r = m.inferTwoTierChoiceFromContext(frase, null, cfgOb);
  comprobar(`«${frase}» no destapa el producto tapado`, r === null, r ?? "null");
}
comprobar(
  "y nombrar el producto sigue eligiendo en -OB-",
  m.inferTwoTierChoiceFromContext("quiero el grande", null, cfgOb) === "combo"
);
comprobar(
  "tambien la barata",
  m.inferTwoTierChoiceFromContext("quiero la chica", null, cfgOb) === "basico"
);

console.log(
  fallos === 0
    ? "\nTODO OK — una preposicion ya no nombra un producto, y el importe manda cuando nadie eligio\n"
    : `\n${fallos} FALLO(S)\n`
);
process.exit(fallos === 0 ? 0 : 1);
