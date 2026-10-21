// EL MODO REENGANCHE — Y «LINEAL EXTENDIDA» SIGUE SIENDO LO DE FABRICA.
//
// LO QUE PIDIO EL DUENO — 26 de septiembre de 2026, con sus palabras: «quiero que
// lineal extendida sea el nombre por defecto y que modo reenganche sea el otro.
// Un toggle: que en este momento sea tal como esta en lineal extendido y yo al
// cambiar el toggle pase al otro».
//
// POR QUE LO PIDIO, que es lo que no se puede perder de vista. Al cambiar el
// selector a COMO DOU el tambien reescribe los textos de los seguimientos para
// dos productos — y esos textos NO se congelan, salen siempre del panel de hoy.
// Asi que una conversacion congelada en un producto recibia un seguimiento que
// nombra dos, y los dos comodines devolvian EL MISMO NOMBRE (el respaldo
// `elQueHaya` de `nombresDeLosProductos`). Con sus palabras: «el cliente lo vera
// sin seriedad... ya queda manchada la categoria que uno tiene».
//
// O SEA: el congelado protege mientras el contenido no cambia. En cuanto cambia,
// es el que miente. Por eso se puede apagar — y solo por eso.
//
// SUS CUATRO CASOS, dictados el mismo dia:
//
//   1. Recibio informacion SIN eleccion -> al reenganchar entra por la puerta
//      normal de la forma nueva.
//   2. Ya recibio DATOS y vuelve a decir «voy a pagar» -> se le presentan las 2
//      opciones («de frente, te comento que tenemos 2 productos, ¿cual
//      deseas?»), sin anunciar ningun cambio de stock.
//   3. Ya recibio datos y PAGA -> se entrega sin pedir eleccion. Lo que pago es
//      el basico, «jamas pagara desde como lineal el producto full».
//   4. PREGUNTA en vez de pagar -> sigue su curso normal.
//
//   Y EN TODOS: «el bot debe respetar el precio que se le dijo en lineal para que
//   no haya rechazos, ya que yo hago cambios de precios en cualquier momento».
//
// LO QUE NO PUEDE ROMPERSE:
//
//   · APAGADO, TODO IGUAL QUE HOY. Es lo de fabrica, y el peor fallo posible de
//     este cambio tiene que ser «se comporta como antes».
//   · LA PRESENTACION SE SIGUE ANOTANDO AL NACER, encendido o apagado. Asi
//     apagar el reenganche devuelve a cada conversacion a la forma con la que
//     empezo, en vez de dejarlas sin nada.
//   · LA COMPROBACION DEL DATO NO SE SALTA: sin dos productos sentados no hay
//     dos que vender, lo diga quien lo diga.
//   · EL QUE YA PAGO, EL PRODUCTO EXTRA Y EL QUE YA ELIGIO no se rozan.
//
//   node scripts/prueba-el-modo-reenganche.mjs
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

const CARO = "TORNADO AZUL";
const BARATO = "CANELA SIMPLE";
const CASA = mkdtempSync(join(tmpdir(), "modo-reenganche-"));
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

const conPanel = (presentacion, reenganche) => {
  montar({
    ...(presentacion ? { segunda_opcion_prestada: presentacion } : {}),
    ...(reenganche === undefined ? {} : { modo_reenganche: reenganche }),
  });
  return m.loadWorkflowConfig();
};
/** Lo que el bot cree que vende atendiendo a ESA conversacion. */
const comoVende = (presentacionDeLaConvo, cfg) =>
  m.conLaPresentacionDeLaConversacion(presentacionDeLaConvo, () => ({
    prestada: m.segundaOpcionPrestada(cfg),
    esOB: m.isOrderBumpActive(),
    hayDos: m.getActiveTwoTierOffer(cfg) !== null,
  }));

// ── 1. APAGADO: LINEAL EXTENDIDA, EXACTAMENTE COMO HOY ──────────────────────
//
// Es la mitad que protege lo que esta vendiendo ahora mismo. Se prueba con el
// interruptor SIN ESCRIBIR (una configuracion que nunca lo ha guardado) y
// escrito en false, porque son dos situaciones distintas en el archivo.
console.log("-- 1. apagado: la conversacion manda, como hoy -----------");
for (const [comoEsta, etiqueta] of [
  [undefined, "sin escribir"],
  [false, "escrito en false"],
]) {
  const cfg = conPanel("segunda_oculta", comoEsta);
  comprobar(
    `el que nacio en lineal sigue en lineal (${etiqueta})`,
    comoVende("ninguna", cfg).prestada === null,
    "aunque el panel diga «como ob»"
  );
  comprobar(
    `y el que nacio con ella la conserva (${etiqueta})`,
    comoVende("dos_juntas", conPanel(null, comoEsta)).prestada === "dos_juntas",
    "aunque el panel este apagado"
  );
}

// ── 2. ENCENDIDO: MANDA EL PANEL DE HOY ─────────────────────────────────────
console.log("\n-- 2. encendido: manda el panel de hoy -------------------");
let cfg = conPanel("dos_juntas", true);
let visto = comoVende("ninguna", cfg);
comprobar(
  "el que nacio en lineal PASA a ver las dos",
  visto.prestada === "dos_juntas" && visto.hayDos === true,
  "es el reenganche que pidio"
);
cfg = conPanel("segunda_oculta", true);
comprobar(
  "y con «como ob» pasa a Order Bump",
  comoVende("ninguna", cfg).esOB === true,
  "su segunda intro vuelve a estar viva"
);
cfg = conPanel(null, true);
comprobar(
  "y al volver a un producto, el que nacio con dos lo suelta",
  comoVende("dos_juntas", cfg).prestada === null,
  "manda el panel en las dos direcciones"
);

// ── 3. SE SIGUE ANOTANDO AL NACER, ENCENDIDO O APAGADO ──────────────────────
//
// Es lo que hace que el interruptor sea REVERSIBLE: si dejara de anotarse,
// volver a «lineal extendida» dejaria a esas conversaciones sin forma propia y
// el bot tendria que adivinarla.
console.log("\n-- 3. se sigue anotando al nacer -------------------------");
cfg = conPanel("segunda_oculta", true);
comprobar(
  "con el reenganche encendido tambien se anota",
  m.laPresentacionConLaQueNace({ id: 7, presentacion_de_venta: null }) ===
    "segunda_oculta",
  "para poder volver atras"
);
cfg = conPanel(null, true);
comprobar(
  "y en un producto anota «ninguna», no vacio",
  m.laPresentacionConLaQueNace({ id: 8, presentacion_de_venta: null }) ===
    "ninguna",
  "vacio significaria «lee el de hoy»"
);

// ── 4. LA COMPROBACION DEL DATO NO SE SALTA ─────────────────────────────────
console.log("\n-- 4. sin el segundo sentado, no hay oferta --------------");
montar({
  segunda_opcion_prestada: "dos_juntas",
  modo_reenganche: true,
  alineacion_por_modalidad: { lineal: { unico: "pb", basico: "pb" } },
});
cfg = m.loadWorkflowConfig();
visto = comoVende("ninguna", cfg);
// Se mira lo mismo que mira el motor para vender —`vendeConPresentacionPrestada`
// y `getActiveTwoTierOffer`—, no el valor suelto del selector: ese dice lo que
// esta PEDIDO, y quien decide si se puede es el producto sentado.
comprobar(
  "no se inventa una segunda opcion",
  visto.esOB === false && visto.hayDos === false,
  "el dato manda sobre el interruptor"
);

// ── 5. SU CASO 2: PEDIR PAGAR SIN HABER ELEGIDO NO REENVIA ──────────────────
//
// Se mide sobre `resendPaymentDetails`, que es por donde reenvian las NUEVE
// puertas. Siete de ellas solo preguntaban «¿tiene metodo elegido?», y ninguna
// «¿hay dos opciones y este cliente no ha elegido?»: por ahi se colaba el que
// venia de lineal con sus datos ya recibidos.
console.log("\n-- 5. pedir pagar sin elegir no reenvia ------------------");
const motor = readFileSync(
  join(RAIZ, "src", "lib", "workflow", "engine.ts"),
  "utf8"
);
const elReenvio = (() => {
  const i = motor.indexOf("export async function resendPaymentDetails(");
  const f = motor.indexOf("\n  const suyo = elExtraEstaEnJuego", i);
  return i < 0 || f < 0 ? "" : motor.slice(i, f);
})();
comprobar(
  "la guarda vive en el punto unico del reenvio",
  /noHaElegidoNinguna/.test(elReenvio) &&
    /\(isOrderBumpActive\(\) \|\| isDobleOfertaActive\(\)\)/.test(elReenvio),
  "no repetida en siete sitios"
);
comprobar(
  "en «como ob» DESTAPA la segunda, y solo si sigue tapada",
  /if \(isOrderBumpActive\(\) && convo\.order_bump_revealed !== 1\) \{/.test(
    elReenvio
  ) && /presentOrderBumpAndWaitForChoice\(convo\)/.test(elReenvio),
  "repetirla entera seria el bucle"
);
comprobar(
  "en «como dou» le recuerda las dos",
  /sendTwoOptionsReminder\(convo, config\)/.test(elReenvio),
  "«¿cual deseas?»"
);
comprobar(
  "EL QUE YA PAGO no se roza",
  /\(convo\.paid_total_cents \?\? 0\) === 0/.test(elReenvio),
  "su venta termino"
);
comprobar(
  "el producto extra tampoco",
  /!elExtraEstaEnJuego/.test(elReenvio),
  "esa es otra venta, con su precio"
);
comprobar(
  "y quien ya eligio recibe sus datos igual",
  /convo\.order_bump_choice !== "combo" && convo\.order_bump_choice !== "basico"/.test(
    elReenvio
  ),
  "el camino de siempre"
);

// ── 6. SU CASO 5: EL PRECIO QUE SE LE DIJO EN LINEAL ────────────────────────
//
// Una conversacion que empezo con UN producto congelo solo `base`: las casillas
// del combo y del basico estan vacias porque entonces no habia dos opciones. Al
// reenganchar aparecen las dos, y sin esto el basico saldria al precio de HOY.
console.log("\n-- 6. el precio que se le dijo se respeta ----------------");
const cerebro = readFileSync(
  join(RAIZ, "src", "lib", "workflow", "config.ts"),
  "utf8"
);
const elCongelado = (() => {
  const i = cerebro.indexOf("const applyFrozenPrice = (currentPrice");
  const f = cerebro.indexOf("\n  };", i);
  return i < 0 || f < 0 ? "" : cerebro.slice(i, f);
})();
comprobar(
  "el basico cae al precio del producto unico",
  /key === "basico" &&/.test(elCongelado) &&
    /frozen\.base\.discount/.test(elCongelado) &&
    /frozen\.base\.regular/.test(elCongelado),
  "lo que se le dijo en lineal"
);
comprobar(
  "SOLO el basico: del full nunca se le hablo",
  !/key === "combo" &&\s*\r?\n?\s*!\(typeof frozenPrice/.test(elCongelado),
  "«jamas pagara el producto full»"
);
comprobar(
  "y solo si AHORA hay dos opciones de verdad",
  /getActiveTwoTierOffer\(config\) !== null &&/.test(elCongelado),
  "lineal puro no se toca"
);
comprobar(
  "no puede cobrar de mas: sigue el menor de los dos",
  /Math\.min\(frozenPrice, currentPrice\)/.test(elCongelado),
  "el candado de siempre"
);

// ── 7. EL INTERRUPTOR VIAJA, Y NACE APAGADO ─────────────────────────────────
//
// Un campo que el editor enseña pero la API no guarda se pierde al guardar, y
// eso no da error: se descubre cuando el bot no hace lo que dice la pantalla.
console.log("\n-- 7. el interruptor viaja de la pantalla al bot ---------");
const api = readFileSync(
  join(RAIZ, "src", "app", "api", "workflow", "route.ts"),
  "utf8"
);
comprobar(
  "la API lo devuelve, apagado salvo que este escrito",
  /modo_reenganche: config\?\.modo_reenganche === true,/.test(api),
  "nadie se lo encuentra puesto"
);
comprobar(
  "y lo escribe SIEMPRE, encendido y apagado",
  /doc\.set\("modo_reenganche", g\.modo_reenganche === true\);/.test(api),
  "o no se podria volver a apagar"
);
const editor = readFileSync(
  join(RAIZ, "src", "app", "editor", "page.tsx"),
  "utf8"
);
comprobar(
  "el editor tiene el interruptor",
  /modo_reenganche: cfg\.globals\.modo_reenganche !== true,/.test(editor),
  "junto al selector de «Presenta:»"
);
comprobar(
  "y dice en que modo esta",
  /\? "REENGANCHE"\s*\r?\n?\s*: "LINEAL EXTENDIDA"/.test(editor),
  "con sus dos nombres"
);
comprobar(
  "el motor solo lo enciende con un true explicito",
  /if \(config\.modo_reenganche === true\) \{/.test(cerebro),
  "cualquier otra cosa es lineal extendida"
);
// Y EL INTERRUPTOR VIAJA CON EL SELECTOR, desde el 28/09/2026. Con sus palabras:
// «quiero que al cambiar a "como lineal" quede como "lineal extendida" y cuando
// cambie a como dou, o como ob automaticamente cambie a reenganche, lo que ocurre
// es que estoy testeando y me estoy olvidando de cambiarlo en mis pruebas».
//
// UN PRODUCTO -> apagado. COMO DOU o COMO OB -> encendido. Y nada mas: el circulo
// sigue siendo suyo y puede tocarlo despues.
comprobar(
  "al cambiar de presentacion se mueve el interruptor",
  /modo_reenganche: valor !== "",/.test(editor),
  "un producto apaga, dos opciones encienden"
);
comprobar(
  "  y va en el MISMO cambio que la presentacion",
  /segunda_opcion_prestada: valor,[\s\S]{0,1600}?modo_reenganche: valor !== "",/.test(
    editor
  ),
  "el guardado que corre despues lleva los dos"
);

// ── 8. EL AVISO: «HEMOS ACTUALIZADO», A QUIEN TOCA Y UNA SOLA VEZ ───────────
//
// Con sus palabras, 26/09/2026: «el "hemos actualizado" es por si el cliente
// vuelve a retomar la conversacion... y si dijese quiero pagar, le diga hola
// quiero contarte que hemos actualizado a 2 productos». Y su limite: «los
// seguimientos deberian dispararse de manera normal, sin avisos de
// actualizacion», y «la cosa es que no se detenga en hemos actualizado».
//
// SE EJECUTA la decision, que es la que reparte: quien lo oye y quien no.
console.log("\n-- 8. el aviso de la actualizacion -----------------------");
const elQueVieneDeUno = {
  id: 1,
  presentacion_de_venta: "ninguna",
  aviso_actualizacion_enviado: 0,
  intro_variant_sent: 1,
};
cfg = conPanel("dos_juntas", true);
comprobar(
  "al que venia de un producto SI se le cuenta",
  m.hayQueAvisarDeLaActualizacion(elQueVieneDeUno, cfg) === true,
  "es el reenganchado"
);
comprobar(
  "pero solo UNA vez",
  m.hayQueAvisarDeLaActualizacion(
    { ...elQueVieneDeUno, aviso_actualizacion_enviado: 1 },
    cfg
  ) === false,
  "se marca al decirlo"
);
comprobar(
  "al que aun no ha recibido nada, no",
  m.hayQueAvisarDeLaActualizacion(
    { ...elQueVieneDeUno, intro_variant_sent: null },
    cfg
  ) === false,
  "para el esto es lo que hay"
);
comprobar(
  "al que ya veia dos, tampoco",
  m.hayQueAvisarDeLaActualizacion(
    { ...elQueVieneDeUno, presentacion_de_venta: "dos_juntas" },
    cfg
  ) === false,
  "decirle «ahora hay dos» seria mentirle"
);
comprobar(
  "a las conversaciones de antes de esto, tampoco",
  m.hayQueAvisarDeLaActualizacion(
    { ...elQueVieneDeUno, presentacion_de_venta: null },
    cfg
  ) === false,
  "no se sabe con que nacieron"
);
// ── Y NO DESPUES DE LA COMPRA ──────────────────────────────────────────────
//
// LO QUE PASO — 28/09/2026, su prueba HPRU3. El cliente pago, se le entrego, el
// bot le presento el producto de la etapa upsell y el contesto «ese es otro no».
// Respuesta del bot: «te cuento que hemos actualizado... ahora tenemos 2
// opciones». Con sus palabras: «esto no puede pasar, por que luego de la venta
// ¿como va a presentar 2 productos si ya vendio? yo pregunte por el upsell, no
// por lo anterior».
//
// Esas dos opciones SON la venta que ya se hizo, y encima la conversacion iba de
// otro producto con su propio precio. El aviso se metia en medio de otra venta.
for (const estado of [
  "payment_approved",
  "awaiting_email",
  "awaiting_gift_consent",
  "awaiting_facebook_comment",
]) {
  comprobar(
    `  en ${estado} no se anuncia nada ← SU CASO`,
    m.hayQueAvisarDeLaActualizacion({ ...elQueVieneDeUno, state: estado }, cfg) ===
      false,
    "la venta ya esta hecha"
  );
}
comprobar(
  "  ni con un pago ya registrado",
  m.hayQueAvisarDeLaActualizacion(
    { ...elQueVieneDeUno, paid_total_cents: 1000 },
    cfg
  ) === false,
  "el dinero manda, sea cual sea el estado"
);
// LO QUE NO SE PUEDE HABER ROTO: mientras la venta sigue abierta, se cuenta. En
// `payment_done` el cliente tiene los datos y todavia no ha pagado — ese es
// justo el momento en que el aviso le sirve.
comprobar(
  "  pero con los datos enviados y sin pagar, SI",
  m.hayQueAvisarDeLaActualizacion(
    { ...elQueVieneDeUno, state: "payment_done", paid_total_cents: 0 },
    cfg
  ) === true,
  "ahi la venta sigue viva"
);
comprobar(
  "  y en intro_done tambien",
  m.hayQueAvisarDeLaActualizacion(
    { ...elQueVieneDeUno, state: "intro_done" },
    cfg
  ) === true,
  "como hasta hoy"
);
comprobar(
  "y CON EL REENGANCHE APAGADO no se avisa a nadie",
  m.hayQueAvisarDeLaActualizacion(elQueVieneDeUno, conPanel("dos_juntas", false)) ===
    false &&
    m.hayQueAvisarDeLaActualizacion(
      elQueVieneDeUno,
      conPanel("dos_juntas", undefined)
    ) === false,
  "esa conversacion sigue vendiendo uno"
);
// El dato manda sobre el interruptor, igual que en todo lo demas.
montar({
  segunda_opcion_prestada: "dos_juntas",
  modo_reenganche: true,
  alineacion_por_modalidad: { lineal: { unico: "pb", basico: "pb" } },
});
comprobar(
  "sin dos productos sentados no se anuncia una segunda",
  m.hayQueAvisarDeLaActualizacion(elQueVieneDeUno, m.loadWorkflowConfig()) ===
    false,
  "no se inventa lo que no hay"
);

// ── 9. Y CADA BOCA DICE LO SUYO ─────────────────────────────────────────────
//
// El bot contesta por dos sitios y la novedad tiene que entrar por los dos: el
// MOTOR cuando manda el recordatorio de las dos opciones (ahi no hay modelo a
// quien pedirle la frase) y el MODELO en los turnos que contesta el.
console.log("\n-- 9. las dos bocas por las que contesta ------------------");
const elRecordatorio = (() => {
  const i = motor.indexOf("async function sendTwoOptionsReminder(");
  return i < 0 ? "" : motor.slice(i, motor.indexOf("\n}", i));
})();
// LOS DOS SITIOS donde el motor pide elegir entre las dos pasan por el mismo
// punto: el recordatorio de siempre y «eligio metodo sin producto elegido →
// pregunto cual». Por el segundo el reenganchado recibia la pregunta sin
// haberse enterado nunca de que ahora hay dos.
const laAclaracion = (() => {
  const i = motor.indexOf("async function sendTwoTierChoiceClarification(");
  return i < 0 ? "" : motor.slice(i, motor.indexOf("\n}", i));
})();
comprobar(
  "el motor manda el aviso antes que el recordatorio",
  /await contarLaNovedadSiTocaba\(convo, config\);/.test(elRecordatorio) &&
    /await contarLaNovedadSiTocaba\(convo, config\);/.test(laAclaracion),
  "por las dos puertas de eleccion"
);
const elEnvioDelAviso = (() => {
  const i = motor.indexOf("export async function enviarAvisoDeActualizacion(");
  return i < 0 ? "" : motor.slice(i, motor.indexOf("\n}", i));
})();
comprobar(
  "con burbujas vacias se cae al texto, no al silencio",
  /Array\.isArray\(suyas\) && suyas\.length > 0/.test(elEnvioDelAviso) &&
    /if \(!texto\.trim\(\)\) return false;/.test(elEnvioDelAviso),
  "sustituir con nada deja sin respuesta"
);
const elPuntoUnico = (() => {
  const i = motor.indexOf("async function contarLaNovedadSiTocaba(");
  return i < 0 ? "" : motor.slice(i, motor.indexOf("\n}", i));
})();
comprobar(
  "y lo marca al enviarlo, solo si salio",
  /if \(await enviarAvisoDeActualizacion\(convo\)\) \{/.test(elPuntoUnico) &&
    /marcarAvisoDeActualizacionEnviado\(convo\.id\)/.test(elPuntoUnico),
  "no se repite, y no se pierde"
);
comprobar(
  "y NO sustituye a la pregunta de elegir",
  elRecordatorio.indexOf("await contarLaNovedadSiTocaba(convo, config);") <
    elRecordatorio.indexOf("renderTwoOptionsReminder(convo, config)"),
  "el texto del dueno no pide elegir"
);
const cerebroTxt = readFileSync(
  join(RAIZ, "src", "lib", "openrouter.ts"),
  "utf8"
);
// Y EL CEREBRO SOLO DEJA LA TRAZA: la novedad ya no depende de el, pero el
// registro tiene que poder seguirse cuando el dueno pega sus logs.
comprobar(
  "el cerebro deja constancia y nada mas",
  /la novedad la suelta el motor/.test(cerebroTxt),
  "para poder seguirlo en el registro"
);

// ── 9-bis. SE DA POR DICHA CUANDO SE DIJO, NO CUANDO SE PIDIO ──────────────
//
// LO QUE PASO — sus seis pruebas del 26/09/2026: la novedad salio en TRES y en
// las otras tres no, justo en las que el cliente pregunto el precio. Se marcaba
// al INYECTARLE la nota al modelo, asi que si el modelo pasaba de ella —y paso—
// se daba por dicho algo que el cliente nunca leyo, y sin segunda oportunidad.
console.log("\n-- 9-bis. dicha de verdad, no solo pedida ----------------");
comprobar(
  "el cerebro ya NO la marca al inyectarla",
  !/marcarAvisoDeActualizacionEnviado/.test(cerebroTxt),
  "ese era el primer fallo"
);
// Y TAMPOCO SE LA PIDE AL MODELO. 27/09/2026: el segundo intento la daba por
// dicha si la respuesta nombraba las dos opciones — pero con dos opciones
// activas el modelo las nombra en casi cualquier respuesta, asi que el aviso se
// apagaba en el primer turno y el cliente no leia ninguna exclusiva. Su registro
// lo dice tres veces: «le conte que ahora hay dos opciones», y el no vio nada.
comprobar(
  "ni se la pide al modelo: la suelta el motor",
  !/RETURNING CUSTOMER - CATALOG UPDATE/.test(cerebroTxt) &&
    /export async function enviarAvisoDeActualizacion\(/.test(motor),
  "si depende de que se acuerde, no esta hecho"
);
// Y NO SE CUENTA CON EL SEGUNDO PRODUCTO TAPADO. En «como -OB-» la segunda
// opcion no existe para el cliente hasta que decide pagar, y el reenganchado cae
// justo ahi: intro terminada, sin elegir y con un seguimiento encima. Sin esta
// guarda, el aviso le pedia al modelo nombrar las dos — o sea, destapar el
// producto oculto antes de tiempo. Es su regla dura de -OB-.
const elHandler = readFileSync(
  join(RAIZ, "src", "lib", "meta", "handler.ts"),
  "utf8"
);
comprobar(
  "el handler la suelta ANTES de la respuesta del modelo",
  /await enviarAvisoDeActualizacion\(fresh\)/.test(elHandler) &&
    elHandler.indexOf("await enviarAvisoDeActualizacion(fresh)") <
      elHandler.indexOf("await sendChunkedBotText(fresh, reply, burbujas"),
  "la noticia y detras su respuesta"
);
comprobar(
  "y solo la marca si SALIO de verdad",
  /if \(await enviarAvisoDeActualizacion\(fresh\)\) \{\s*\r?\n?\s*marcarAvisoDeActualizacionEnviado\(fresh\.id\);/.test(
    elHandler
  ),
  "sustituir con nada la perderia"
);
comprobar(
  "en «como -OB-» no, mientras siga tapada",
  /!\(isOrderBumpActive\(\) && fresh\.order_bump_revealed !== 1\)/.test(elHandler),
  "la destapa la segunda intro"
);
comprobar(
  "un fallo al enviarla no tumba la respuesta",
  /catch \(err\) \{\s*\r?\n?\s*console\.error\("\[wh\] el aviso de la actualizacion fallo:", err\);/.test(
    elHandler
  ),
  "el cliente recibe lo suyo igual"
);
comprobar(
  "el texto por defecto es el del dueño, con comodines",
  /Te cuento que hemos actualizado nuestro contenido/.test(motor) &&
    /\{\{PRODUCTO_BASE\}\}/.test(motor) &&
    /\{\{PRODUCTO_FULL\}\}/.test(motor),
  "ningun nombre escrito a mano"
);
comprobar(
  "y es editable: la API lo lee y lo escribe",
  /aviso_actualizacion: str\(obCfg\?\.aviso_actualizacion\)/.test(
    readFileSync(join(RAIZ, "src", "app", "api", "workflow", "route.ts"), "utf8")
  ) &&
    /aviso_actualizacion_steps: Array\.isArray\(ob\?\.aviso_actualizacion_steps\)/.test(
      readFileSync(
        join(RAIZ, "src", "app", "api", "workflow", "route.ts"),
        "utf8"
      )
    ),
  "si no, se pierde al guardar"
);
comprobar(
  "y el editor tiene su campo",
  /idPrefix="ob_aviso_actualizacion"/.test(editor),
  "junto al recordatorio de las dos"
);
// SUS SEGUIMIENTOS, INTACTOS. La decision se consulta en DOS sitios y ninguno es
// el del seguimiento: si apareciera en un tercero, el aviso se colaria ahi.
comprobar(
  "los seguimientos no lo miran: solo hay dos bocas",
  (motor.match(/hayQueAvisarDeLaActualizacion\(/g) ?? []).length === 1 &&
    (cerebroTxt.match(/hayQueAvisarDeLaActualizacion\(/g) ?? []).length === 1,
  "«sin avisos de actualizacion»"
);

process.chdir(RAIZ);
console.log(
  fallos === 0
    ? "\nTODO OK — el reenganche se enciende y lineal extendida sigue de fabrica\n"
    : `\n${fallos} comprobacion(es) mal.\n`
);
process.exit(fallos === 0 ? 0 : 1);
