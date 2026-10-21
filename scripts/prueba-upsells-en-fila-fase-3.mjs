// UPSELLS EN FILA — FASE 3: EL MOTOR. BANCO CON EL CODIGO REAL.
//
// ──── DE DONDE SALE ────────────────────────────────────────────────────────
//
// Lo pidio el 10/10/2026. Ver PLAN-UPSELLS-EN-FILA.md. Sus condiciones, que mandan:
//
//   «NO TOCAR EL COMPORTAMIENTO… todo eso esta como un reloj».
//   «No debe haber manera de equivocarse, no sea que el bot recuerde un producto que ya
//    vendio, o no se vaya a confundir con el upgrade.»
//   «Si el cliente no quiere el primero o el segundo, no se insiste mas.»
//   «El downsell no invade la lista de upsells, sino se aplica solo en el ultimo.»
//
// Ejecuta `config.ts` DE VERDAD —no una copia— con una configuracion inventada y la base
// de datos sustituida por una conversacion en memoria. Productos con nombres neutros: una
// prueba con los productos reales taparia justo lo que esta regla evita.
//
//   node scripts/prueba-upsells-en-fila-fase-3.mjs
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from "node:fs";
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
        // La conversacion vive en globalThis.__convo; las lecturas de la fila la cuentan.
        source: `
          const c = () => globalThis.__convo;
          export const getConversationByPhone = () => c();
          export const getConversationById = () => c();
          export const getFrozenPrices = () => null;
          export const getUpsellFrozenPrices = () => null;
          export const setFrozenPrices = () => {};
          export const getPuestoEnLaFila = (id) => {
            globalThis.__lecturas = (globalThis.__lecturas ?? 0) + 1;
            return c() && c().id === id ? { ...c() } : null;
          };
          export const leerCompradosDeLaFila = (x) => {
            try { return x?.upsell_comprados ? JSON.parse(x.upsell_comprados) : []; } catch { return []; }
          };
          export const moverLaFila = (id, fila, producto, downsell) => {
            Object.assign(c(), {
              upsell_fila_id: fila, upsell_producto_id: producto,
              upsell_downsell: downsell ? 1 : 0, upsell_state: null,
            });
          };
        `,
      };
    return next(url, ctx);
  },
});

const texto = (t) => ({ type: "text", body_variants: [t] });
const producto = (id, extra = {}) => ({
  id,
  name: `PRODUCTO ${id.toUpperCase()}`,
  delivery: [texto(`enlace de ${id}`)],
  ...extra,
});
const presentacion = (id) => ({
  intro: [texto(`intro de ${id}`)],
  pregunta_steps: [texto(`¿llevas ${id}?`)],
  boton_si: "Si",
  boton_no: "No",
  respuesta_rechazo: `rechazo de ${id}`,
  recordatorio: `recuerda ${id}`,
});
const PE = (n) => ({ PE: { price_soles: n } });

const CASA = mkdtempSync(join(tmpdir(), "fila-fase-3-"));
mkdirSync(join(CASA, "config"), { recursive: true });
const ARCHIVO = join(CASA, "config", "intro-data.yaml");
let reloj = 1_700_000_000;
const montar = ({ sinFila = false, upsellApagado = false, downsellPE = 6, presP2 = null } = {}) => {
  writeFileSync(
    ARCHIVO,
    aYaml({
      country: "PE",
      greeting: { body_variants: ["hola"] },
      intro_sequence: [texto("la intro")],
      payment_responses: { yape: [texto("datos")] },
      course_price_soles: 10,
      upsell: {
        enabled: !upsellApagado,
        // Nombre, precio y entrega salen del producto sentado en el puesto «upsell» (pu),
        // como en las tiendas de verdad.
        intro: [texto("intro del de siempre")],
        respuesta_rechazo: "rechazo del de siempre",
        recordatorio: "recuerda el de siempre",
        use_buttons: true,
        boton_si: "Si",
        boton_no: "No",
      },
      biblioteca_de_productos: [
        producto("pb", { precios_por_pais: PE(10) }),
        {
          id: "pu",
          name: "UPSELL DE SIEMPRE",
          precios_por_pais: PE(5),
          delivery: [texto("enlace del de siempre")],
        },
        producto("p2", { precios_por_pais: PE(7), presentacion_upsell: presP2 ?? presentacion("p2") }),
        // Sin presentacion: se salta.
        producto("p3", { precios_por_pais: PE(8) }),
        // Sin precio en Peru: se salta en Peru.
        producto("p4", {
          precios_por_pais: { EC: { price_soles: 3 } },
          presentacion_upsell: presentacion("p4"),
        }),
        producto("p5", { precios_por_pais: PE(9), presentacion_upsell: presentacion("p5") }),
      ],
      alineacion_por_modalidad: {
        upsell: { unico: "pb", upsell: "pu" },
        lineal: { unico: "pb", upsell: "pu" },
      },
      ...(sinFila
        ? {}
        : {
            filas_de_upsell: [
              {
                id: "fila_general",
                puestos: [
                  // El principal metido en la fila: no se ofrece nunca.
                  { producto_id: "pb", minutos: 1 },
                  { producto_id: "p2", minutos: 5 },
                  { producto_id: "p3", minutos: 5 },
                  { producto_id: "p4", minutos: 5 },
                  { producto_id: "p5", minutos: 10 },
                  // Repetido: no se ofrece dos veces.
                  { producto_id: "p2", minutos: 5 },
                ],
                downsell: {
                  enabled: true,
                  precios_por_pais: PE(downsellPE),
                  espera_minutos: 30,
                  steps: [texto("te lo dejo a menos")],
                  boton_si: "Lo quiero",
                  boton_no: "No gracias",
                },
              },
              {
                id: "fila_de_b",
                tiendas: ["tienda_b"],
                puestos: [{ producto_id: "p5", minutos: 2 }],
              },
            ],
          }),
    }),
    "utf8"
  );
  reloj += 60;
  const f = new Date(reloj * 1000);
  utimesSync(ARCHIVO, f, f);
};
const convoNueva = () => {
  globalThis.__convo = {
    id: 7,
    phone: "51999000111",
    country_code: "PE",
    upsell_state: null,
    upsell_fila_id: null,
    upsell_producto_id: null,
    upsell_downsell: 0,
    upsell_fila_parada: 0,
    upsell_comprados: null,
    gift_rewarded: 0,
    state: "payment_approved",
  };
  return globalThis.__convo;
};

montar();
convoNueva();
process.chdir(CASA);
const m = await import(
  pathToFileURL(join(RAIZ, "src", "lib", "workflow", "config.ts")).href
);

let fallos = 0;
const comprobar = (titulo, ok, nota = "") => {
  if (!ok) fallos++;
  console.log(`${ok ? "ok   " : "FALLA"} ${titulo.padEnd(60).slice(0, 60)} ${nota}`);
};
const enSuTurno = (fn) => m.conLaFilaDe(7, fn);
const cfg = () => m.loadWorkflowConfig();

console.log("— sin fila en juego, el upsell de siempre letra por letra —\n");
{
  const fuera = m.seccionUpsell(cfg());
  comprobar("sin conversacion en el turno: el de siempre", fuera?.name === "UPSELL DE SIEMPRE");
  const dentro = enSuTurno(() => m.seccionUpsell(cfg()));
  comprobar(
    "con la conversacion y el puesto vacio: el MISMO objeto",
    dentro === fuera,
    "ni una copia"
  );
  comprobar(
    "y su precio, el de siempre",
    enSuTurno(() => m.getUpsellPriceSoles(false, "51999000111", cfg())) === 5
  );
  montar({ sinFila: true });
  globalThis.__lecturas = 0;
  const c = convoNueva();
  c.upsell_state = "pagado";
  const movio = enSuTurno(() => m.prepararElSiguienteDeLaFila(c, cfg()));
  comprobar(
    "sin filas guardadas no mueve nada ni lee la base",
    movio === false && globalThis.__lecturas === 0,
    `${globalThis.__lecturas} lecturas`
  );
  comprobar(
    "ni ofrece downsell",
    enSuTurno(() => m.elDownsellQueToca(c, cfg())) === null
  );
  comprobar(
    "y el plazo del regalo es el de siempre",
    enSuTurno(() => m.segundosDelPlazoDeLaOferta(c, cfg(), 1800)) === 1800
  );
  montar();
}

console.log("\n— que producto toca —\n");
{
  const c = convoNueva();
  const sig = (desde) => m.siguienteDeLaFila(cfg(), { ...c }, desde)?.producto_id ?? null;
  comprobar("tras el de siempre: p2 (el principal de la fila se salta)", sig(null) === "p2", sig(null));
  comprobar(
    "tras p2: p5 (p3 sin presentacion, p4 sin precio en su pais)",
    sig("p2") === "p5",
    sig("p2")
  );
  comprobar("tras p5: ninguno (el repetido no vuelve)", sig("p5") === null, String(sig("p5")));
  c.upsell_comprados = JSON.stringify([{ producto_id: "p5", downsell: false, cents: 900, at: 1 }]);
  comprobar("lo que ya compro no se ofrece nunca", sig("p2") === null, String(sig("p2")));
}

console.log("\n— pasar al siguiente —\n");
{
  const c = convoNueva();
  c.upsell_state = "ofrecido";
  comprobar(
    "con la oferta delante, no se mueve",
    enSuTurno(() => m.prepararElSiguienteDeLaFila(c, cfg())) === false
  );
  c.upsell_state = "pagado";
  comprobar(
    "pago el de siempre: pasa a p2",
    enSuTurno(() => m.prepararElSiguienteDeLaFila(c, cfg())) === true &&
      c.upsell_producto_id === "p2" &&
      c.upsell_state === null
  );
  const up = enSuTurno(() => m.seccionUpsell(cfg()));
  comprobar("la puerta contesta con p2", up?.name === "PRODUCTO P2");
  comprobar("con SU precio", enSuTurno(() => m.getUpsellPriceSoles(false, "51999000111", cfg())) === 7);
  comprobar("con SU entrega", up?.delivery?.[0]?.body_variants?.[0] === "enlace de p2");
  comprobar("con SU intro, sin los cajones del de siempre", up?.intro?.[0]?.body_variants?.[0] === "intro de p2" && up?.intro_groups?.length === 0);
  comprobar("con SUS minutos", up?.retraso_minutos === 5);
  comprobar("con SU rechazo y SU recordatorio", up?.respuesta_rechazo === "rechazo de p2" && up?.recordatorio === "recuerda p2");
  comprobar("y se puede ofrecer", enSuTurno(() => m.isUpsellUsable(cfg())) === true);

  const parado = { ...c, upsell_state: "pagado", upsell_fila_parada: 1 };
  globalThis.__convo = parado;
  comprobar(
    "si dijo que no o callo (fila parada), no hay siguiente",
    enSuTurno(() => m.prepararElSiguienteDeLaFila(parado, cfg())) === false
  );
  const conRegalo = { ...c, upsell_state: "pagado", upsell_fila_parada: 0, gift_rewarded: 1 };
  globalThis.__convo = conRegalo;
  comprobar(
    "quien ya llego al regalo no reabre la fila",
    enSuTurno(() => m.prepararElSiguienteDeLaFila(conRegalo, cfg())) === false
  );
}

console.log("\n— el upsell de siempre apagado: la fila empieza por su primero —\n");
{
  montar({ upsellApagado: true });
  const c = convoNueva();
  comprobar(
    "primera entrega: pasa a p2",
    enSuTurno(() => m.prepararElSiguienteDeLaFila(c, cfg())) === true &&
      c.upsell_producto_id === "p2"
  );
  montar();
}

console.log("\n— el downsell —\n");
{
  const c = convoNueva();
  c.upsell_fila_id = "fila_general";
  c.upsell_producto_id = "p2";
  c.upsell_state = "ofrecido";
  comprobar("en p2 no toca: no es el ultimo", enSuTurno(() => m.elDownsellQueToca(c, cfg())) === null);
  c.upsell_producto_id = "p5";
  comprobar("en p5, el ultimo, toca", enSuTurno(() => m.elDownsellQueToca(c, cfg()))?.id === "fila_general");
  comprobar(
    "y su silencio cuenta con los minutos del downsell",
    enSuTurno(() => m.segundosDelPlazoDeLaOferta(c, cfg(), 999)) === 30 * 60
  );
  c.upsell_downsell = 1;
  const ds = enSuTurno(() => m.seccionUpsell(cfg()));
  comprobar("el downsell es el mismo producto", ds?.name === "PRODUCTO P5" && ds?.delivery?.[0]?.body_variants?.[0] === "enlace de p5");
  comprobar("a su precio fijo", enSuTurno(() => m.getUpsellPriceSoles(false, "51999000111", cfg())) === 6);
  comprobar("con su mensaje y sus botones", ds?.pregunta_steps?.[0]?.body_variants?.[0] === "te lo dejo a menos" && ds?.boton_si === "Lo quiero" && (ds?.intro ?? []).length === 0);
  comprobar("sin recordatorio", ds?.recordatorio === "");
  comprobar("una sola vez", enSuTurno(() => m.elDownsellQueToca(c, cfg())) === null);
  comprobar(
    "tras el downsell no hay siguiente",
    enSuTurno(() => m.prepararElSiguienteDeLaFila({ ...c, upsell_state: "pagado" }, cfg())) === false
  );
  montar({ downsellPE: 9 });
  c.upsell_downsell = 0;
  comprobar("un downsell que no es mas barato no se manda", enSuTurno(() => m.elDownsellQueToca(c, cfg())) === null);
  montar();
}

console.log("\n— la tienda y lo que no existe —\n");
{
  const c = convoNueva();
  comprobar(
    "sin tienda: la fila general",
    m.filaDeLaConversacion(cfg(), { upsell_fila_id: null })?.id === "fila_general"
  );
  comprobar(
    "con su tienda: SU fila",
    m.conLaTiendaDelTurno({ id: "tienda_b" }, () =>
      m.filaDeLaConversacion(cfg(), { upsell_fila_id: null })?.id
    ) === "fila_de_b"
  );
  c.upsell_fila_id = "fila_general";
  c.upsell_producto_id = "producto_borrado";
  comprobar(
    "producto borrado: ni se cobra ni se entrega",
    enSuTurno(() => m.getUpsellPriceSoles(false, "51999000111", cfg())) === null
  );
}

console.log("\n— su presentacion: cajones, casilla de botones y cada canal —\n");
{
  // Lo pidio el 10/10/2026: «que funcione igual» que el upsell de Canales.
  montar({
    presP2: {
      intro_groups: [
        { name: "A", weight: 1, steps: [texto("cajon A de p2")] },
        { name: "B", enabled: false, weight: 1, steps: [texto("cajon B apagado")] },
      ],
      pregunta_steps: [texto("¿llevas p2?")],
      use_buttons: false,
      boton_si: "Si",
      boton_no: "No",
      por_canal: {
        messenger: {
          use_buttons: true,
          boton_si: "Dale",
          pregunta_steps: [texto("¿te lo llevas por messenger?")],
        },
      },
    },
  });
  const c = convoNueva();
  c.upsell_fila_id = "fila_general";
  c.upsell_producto_id = "p2";
  const enWhatsApp = enSuTurno(() => m.seccionUpsell(cfg()));
  comprobar(
    "sus cajones, y no los del upsell de siempre",
    enWhatsApp?.intro_groups?.length === 2 &&
      enWhatsApp.intro_groups[0].steps[0].body_variants[0] === "cajon A de p2"
  );
  comprobar(
    "la casilla apagada apaga los botones, aunque haya textos",
    enWhatsApp?.use_buttons === false
  );
  comprobar("y se puede ofrecer con solo cajones", enSuTurno(() => m.isUpsellUsable(cfg())) === true);
  const enMessenger = m.withWorkflowChannel("messenger", () =>
    enSuTurno(() => m.seccionUpsell(cfg()))
  );
  comprobar(
    "en Messenger manda lo suyo",
    enMessenger?.use_buttons === true &&
      enMessenger.boton_si === "Dale" &&
      enMessenger.pregunta_steps?.[0]?.body_variants?.[0] === "¿te lo llevas por messenger?"
  );
  comprobar(
    "y lo que dejo en blanco es lo de WhatsApp",
    enMessenger?.boton_no === "No" && enMessenger.intro_groups?.length === 2
  );
  const enInstagram = m.withWorkflowChannel("instagram", () =>
    enSuTurno(() => m.seccionUpsell(cfg()))
  );
  comprobar("Instagram sin nada propio: todo lo de WhatsApp", enInstagram?.use_buttons === false && enInstagram.boton_si === "Si");
  montar();
  const deAntes = enSuTurno(() => m.seccionUpsell(cfg()));
  comprobar(
    "una presentacion de antes de la casilla: botones si estan los dos textos",
    deAntes?.use_buttons === true
  );
}

console.log("\n— el reenvio de «no me llego» —\n");
{
  const c = convoNueva();
  comprobar("sin compras de la fila: lo de siempre", m.entregasDeLoCompradoEnLaFila(c, cfg()) === null);
  c.upsell_producto_id = "p5";
  c.upsell_comprados = JSON.stringify([
    { producto_id: null, downsell: false, cents: 500, at: 1 },
    { producto_id: "p2", downsell: false, cents: 700, at: 2 },
  ]);
  const lista = m.entregasDeLoCompradoEnLaFila(c, cfg()) ?? [];
  comprobar(
    "todo lo comprado, en orden, cada uno con su entrega",
    lista.length === 2 &&
      lista[0].producto_id === "" &&
      lista[0].pasos[0].body_variants[0] === "enlace del de siempre" &&
      lista[1].pasos[0].body_variants[0] === "enlace de p2",
    lista.map((e) => e.producto_id || "(de siempre)").join(", ")
  );
}

console.log("");
if (fallos > 0) {
  console.log(`${fallos} FALLA(S)`);
  process.exit(1);
}
console.log("TODO OK — la fila hace lo que se dicto, y sin fila el upsell es el de siempre");
