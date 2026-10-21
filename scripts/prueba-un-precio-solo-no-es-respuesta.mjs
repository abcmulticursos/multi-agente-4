// CON DOS OPCIONES Y SIN ELEGIR, EL PRECIO DE UNA SOLA NO ES UNA RESPUESTA.
//
// LO QUE PASO — 28 de septiembre de 2026, su prueba HPRU1. La conversacion nacio
// vendiendo un producto y el selector se cambio a dos en medio. El cliente
// escribio «precio», el motor le conto la novedad —«ahora tenemos 2 opciones»— y
// justo detras el modelo le dio UN precio: el del producto base, a secas.
//
// Con sus palabras: «cuando hay 2 productos se le entrega el precio de los 2,
// primero la presentacion y luego se le dice cuanto, o se le presentan los 2...
// pero no entregarle el precio del basico».
//
// Y TIENE RAZON: anunciarle dos y contestarle el precio de una es peor que no
// decir ninguno. El cliente se queda creyendo que ese importe es EL precio, paga
// por el, y el validador reconoce la opcion POR EL MONTO — asi que elige por el
// una opcion que nunca eligio.
//
// NO ES EL CRUCE DE `prueba-el-nombre-y-el-precio-hablan-del-mismo`. Alli el
// nombre y el precio eran de productos distintos; aqui pueden estar bien
// emparejados. Lo que falta es la otra mitad de la respuesta, y eso el otro
// guardarrail no lo puede ver.
//
// SE EJECUTA CONTRA SU CONFIGURACION DE VERDAD, con una copia en un directorio
// temporal: su archivo no se toca.
//
//   node scripts/prueba-un-precio-solo-no-es-respuesta.mjs
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

// ── UNA CONFIGURACION DE JUGUETE, CON NOMBRES Y PRECIOS INVENTADOS ─────────
//
// Nunca con sus productos: una prueba escrita con los reales tapa justo el fallo
// que la regla «nada de productos en el codigo» evita.
const CASA = mkdtempSync(join(tmpdir(), "precio-solo-"));
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
      biblioteca_de_productos: [
        { id: "pb", name: "PACK CHICO", price_soles: 30, discount_price_soles: 24 },
        { id: "pf", name: "PACK GRANDE", price_soles: 50, discount_price_soles: 40 },
      ],
      lineal: { enabled: true },
      alineacion_por_modalidad: {
        lineal: { basico: "pb", unico: "pb", full: "pf" },
      },
      // La forma de «dos juntas»: es la que el usa cuando pasa a dos productos.
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
const oferta = m.getActiveTwoTierOffer(cfg);
comprobar("la config de juguete tiene dos opciones", oferta !== null);
if (!oferta) {
  console.log("\nsin dos opciones no hay caso que probar. PARO.\n");
  process.exit(1);
}
const CARA = oferta.combo?.name;
const BARATA = oferta.basico?.name;
const pCara = m.getOrderBumpPriceSoles("combo", false, TEL);
const pCaraOferta = m.getOrderBumpPriceSoles("combo", true, TEL);
const pBarata = m.getOrderBumpPriceSoles("basico", false, TEL);
const pBarataOferta = m.getOrderBumpPriceSoles("basico", true, TEL);
console.log(
  `\n   «${CARA}» ${pCara}/${pCaraOferta}   ·   «${BARATA}» ${pBarata}/${pBarataOferta}\n`
);

// LA ETAPA IMPORTA, y es el arreglo del 28/09/2026 medido en vivo: el cliente
// solo ve UN par de precios —el de su etapa— y contra ese par se compara. Sin
// esto se comparaba contra los cuatro y saltaba un falso positivo en cada
// pregunta de precio. Por defecto, etapa normal.
const caza = (texto, conOferta = false) =>
  m.elPrecioDeUnaSolaOpcionSinElegir(texto, TEL, cfg, conOferta);

// ── 1. SU CASO ─────────────────────────────────────────────────────────────
console.log("— 1. un precio suelto, con dos en oferta —\n");
const suCaso = caza(
  `Claro 😊 El valor actual es de S/. ${pBarata} SOLES.\n\nUn unico pago y acceso permanente. ¿Deseas que te indique los metodos de pago?`
);
comprobar(
  "solo el precio de la barata ← SU FALLO",
  suCaso !== null && suCaso.laOtra === CARA,
  suCaso ? `se callo «${suCaso.laOtra}»` : "no cazo"
);
const alReves = caza(`Son S/. ${pCara} SOLES, pago unico.`);
comprobar(
  "solo el precio de la cara, tambien",
  alReves !== null && alReves.laOtra === BARATA,
  alReves ? `se callo «${alReves.laOtra}»` : "no cazo"
);
comprobar(
  "y con el precio de OFERTA de una sola, EN la oferta",
  caza(`Hoy esta a S/. ${pBarataOferta} SOLES`, true) !== null,
  "la oferta no lo excusa"
);
// Y EL FALSO POSITIVO QUE ENCONTRO LA PRUEBA EN VIVO, fijado aqui para que no
// vuelva: el modelo nombra las DOS con sus dos precios de la etapa. Esta
// completo y no se toca. Antes se marcaba, se gastaba un reintento en cada
// pregunta de precio, y al cliente le llegaba la misma pregunta dos veces.
comprobar(
  "los dos precios de SU etapa: no se marca ← EL FALSO POSITIVO",
  caza(
    `*${CARA}* a S/. ${pCara} SOLES y *${BARATA}* a S/. ${pBarata} SOLES. ¿Cual prefieres?`,
    false
  ) === null,
  "la respuesta ya estaba completa"
);
comprobar(
  "  y los dos de la etapa de oferta, tampoco",
  caza(
    `*${CARA}* a S/. ${pCaraOferta} SOLES y *${BARATA}* a S/. ${pBarataOferta} SOLES`,
    true
  ) === null,
  "cada etapa con su par"
);
comprobar(
  "  pero el par de la OTRA etapa no cuenta como completo",
  caza(`*${CARA}* a S/. ${pCaraOferta} y *${BARATA}* a S/. ${pBarataOferta}`, false) ===
    null,
  "ninguno de los dos de hoy: lo mira el otro guardarrail"
);

// ── 2. LO QUE SI ESTA BIEN Y NO SE TOCA ────────────────────────────────────
console.log("\n— 2. lo que ya estaba bien —\n");
comprobar(
  "los DOS precios: es comparar, y esta bien",
  caza(
    `*${CARA}* a S/. ${pCara} SOLES y *${BARATA}* a S/. ${pBarata} SOLES. ¿Cual prefieres?`
  ) === null,
  "es lo que se quiere"
);
comprobar(
  "los dos, en precio de oferta",
  caza(
    `*${CARA}* a S/. ${pCaraOferta} SOLES y *${BARATA}* a S/. ${pBarataOferta} SOLES`
  ) === null,
  "tambien completo"
);
comprobar(
  "ningun precio: nada que corregir",
  caza(`Tenemos dos opciones: *${CARA}* y *${BARATA}*. ¿Cual prefieres?`) === null,
  "preguntar sin importes vale"
);
comprobar(
  "un texto sin importes ni nombres",
  caza("Con gusto te explico como funciona el material 😊") === null,
  "no se mete donde no hay precio"
);
comprobar(
  "y un numero que no es un importe",
  caza("Son 55 modelos y 32 videos incluidos") === null,
  "sin moneda no es un precio"
);

// ── 3. CON UN SOLO PRODUCTO EL CASO NO EXISTE ──────────────────────────────
console.log("\n— 3. con un solo producto —\n");
montar({ segunda_opcion_prestada: "" });
const soloUno = m.loadWorkflowConfig();
comprobar(
  "no hay dos opciones",
  m.getActiveTwoTierOffer(soloUno) === null,
  "lineal de siempre"
);
comprobar(
  "asi que ningun precio se marca",
  m.elPrecioDeUnaSolaOpcionSinElegir(
    `El valor es S/. ${pBarata} SOLES`,
    TEL,
    soloUno
  ) === null,
  "«el precio» es el suyo"
);

// ── 4. UN PRECIO COMPARTIDO NO SEÑALA A NADIE ──────────────────────────────
//
// Si las dos valen lo mismo en ese pais, ese importe es de las dos y la
// respuesta esta completa. Sin este candado, decir el precio bueno saltaria.
console.log("\n— 4. si las dos valen lo mismo —\n");
montar({
  biblioteca_de_productos: [
    { id: "pb", name: "PACK CHICO", price_soles: 30, discount_price_soles: 24 },
    { id: "pf", name: "PACK GRANDE", price_soles: 30, discount_price_soles: 24 },
  ],
});
const mismoPrecio = m.loadWorkflowConfig();
comprobar(
  "el importe compartido no se marca",
  m.elPrecioDeUnaSolaOpcionSinElegir(
    `Las dos estan a S/. ${pBarata} SOLES`,
    TEL,
    mismoPrecio
  ) === null,
  "es de las dos"
);

// ── 5. COMO QUEDA CONECTADO ────────────────────────────────────────────────
console.log("\n— 5. conectado al guardarrail de siempre —\n");
const cerebro = readFileSync(join(RAIZ, "src", "lib", "openrouter.ts"), "utf8");
comprobar(
  "entra en el guardarrail que ya existia",
  /datosDePagoSinElegir \|\|\s*importesInventados\.length > 0 \|\|\s*cruzado \|\|\s*unSoloPrecio/.test(
    cerebro
  ),
  "no una rama nueva en paralelo"
);
comprobar(
  "solo con dos opciones y sin haber elegido",
  /hayDosOpciones &&\s*!yaEligio &&/.test(cerebro),
  "los dos candados de la casa"
);
comprobar(
  "NO en la postventa",
  /!enLaPostventa &&[\s\S]{0,120}?\(convo\?\.paid_total_cents \?\? 0\) === 0/.test(
    cerebro
  ),
  "ahi el precio es del producto del upsell"
);
// SI EL CLIENTE PREGUNTO POR UNA EN CONCRETO, contestarle el precio de ESA es lo
// correcto: obligar a los dos seria contestar otra cosa de la que pregunto, y
// gastar un reintento en cada turno de esos. Se pregunta con la funcion que ya
// usa el motor para eso, no con una lista de palabras nueva.
comprobar(
  "ni cuando pregunto por una opcion concreta",
  /!preguntoPorUnaEnConcreto &&/.test(cerebro) &&
    /isSpecificOrderBumpPriceQuestion\(\s*ctx\.latestUserText/.test(cerebro),
  "«¿cuanto el grande?» se contesta con el del grande"
);
comprobar(
  "y el reintento le pide los DOS con su precio",
  /name BOTH options with those prices/.test(cerebro),
  "y cerrando con la pregunta de cual"
);
comprobar(
  "queda en el registro cuando pasa",
  /se callo el de/.test(cerebro),
  "para poder verlo en el log"
);

// ── 6. Y NO PUEDE CONVERTIRSE EN UN BUCLE ──────────────────────────────────
//
// LO QUE PASO — 28/09/2026, su prueba HOLPER4. Cambio a dos opciones con la
// conversacion en `payment_done` y SIN eleccion hecha. Pregunto «precio», y
// despues «como es eso» dos veces. Las TRES veces recibio el MISMO texto de
// elegir, y su pregunta no se contesto ninguna. Con sus palabras: «me aburri,
// seleccione boton».
//
// DOS FALLOS DE DISEÑO, los dos mios:
//
//   a) EL REINTENTO PEDIA ALGO IMPOSIBLE. Decia «nombra las dos opciones con su
//      precio» y NO le daba los precios. El modelo insistio en los tres turnos:
//      no desobedecia, no podia cumplir.
//   b) Y AL INSISTIR SUSTITUIA la respuesta del modelo por el texto de elegir,
//      asi que la pregunta del cliente se perdia. Tres turnos, tres veces igual.
//
// Es su propia regla: «tampoco irse al extremo de quedarse bloqueado en solo
// responder metodo y producto: que la conversacion siga siendo fluida y no
// bucleada».
console.log("\n— 6. y no se convierte en un bucle —\n");
comprobar(
  "el reintento le DA los dos nombres con sus precios",
  /These are the two options with their exact prices/.test(cerebro) &&
    /\{\{OPCION_1\}\} = \{\{PRECIO_1_COMPLETO\}\}/.test(cerebro) &&
    /\{\{OPCION_2\}\} = \{\{PRECIO_2_COMPLETO\}\}/.test(cerebro),
  "ya puede cumplir"
);
comprobar(
  "  y salen de SU configuracion, por pais y etapa",
  /renderOrderBumpTemplate\(\s*\n?\s*"  · \{\{OPCION_1\}\}[\s\S]{0,200}?isDiscountActiveForConversation\(convo, workflowConfig\),\s*\n?\s*convo\?\.phone/.test(
    cerebro
  ),
  "ni un nombre ni un importe escrito a mano"
);
comprobar(
  "al insistir AÑADE su respuesta, no la sustituye ← EL BUCLE",
  /if \(unSoloPrecio && !datosDePagoSinElegir && importesInventados\.length === 0\) \{[\s\S]{0,400}?return elTextoDeElegir \? `\$\{text\}\\n\\n\$\{elTextoDeElegir\}` : text;/.test(
    cerebro
  ),
  "la duda del cliente se contesta"
);
comprobar(
  "y los otros dos motivos SIGUEN sustituyendo",
  /\/\/ Los otros dos motivos: no se le manda al cliente, se cierra con SU texto\.[\s\S]{0,300}?return elTextoDeElegir;/.test(
    cerebro
  ),
  "esos si son dinero mal cobrado"
);
comprobar(
  "y se distingue en el registro",
  /mando su respuesta y detrás las dos opciones/.test(cerebro) &&
    /mando su texto de elección/.test(cerebro),
  "dos lineas distintas, para saber cual fue"
);

// ── 7. Y EL PROMPT DEJA DE ORDENAR LO CONTRARIO ────────────────────────────
//
// AQUI ESTABA EL RIO, y sin esto los dos arreglos de arriba no bastan. El propio
// prompt le ordenaba al modelo, con estas palabras:
//
//     EFFECTIVE PRICE FOR THIS CUSTOMER: <un importe>. This is the ONLY price
//     you must quote when they ask how much it costs.
//
// El cliente escribio «precio». Coincidencia palabra por palabra. El reintento
// pedia lo contrario EN LA MISMA LLAMADA, asi que el modelo tenia dos ordenes y
// gano la que era absoluta. No desobedecia: se le daba el dato Y la orden de
// usarlo.
//
// Es el mismo fallo que ya esta documentado sobre esta misma linea en
// `precioDeLoQueQuedaEnVenta`, y la cura es la que esta escrita alli: QUITARLE EL
// DATO, no pedirle que lo ignore. Lo que no esta, no compite.
console.log("\n— 7. el prompt ya no ordena un precio unico —\n");
comprobar(
  "con dos a la vista y sin elegir, dice los DOS",
  /EFFECTIVE PRICES FOR THIS CUSTOMER — there are TWO options on offer and they have NOT chosen one yet, so there is NO single price to quote/.test(
    cerebro
  ),
  "el hueco deja de mentir"
);
comprobar(
  "  y los saca de SU configuracion",
  /\$\{renderOrderBumpTemplate\(\s*\n?\s*"  · \{\{OPCION_1\}\} = \{\{PRECIO_1_COMPLETO\}\}/.test(
    cerebro
  ),
  "su pais, su etapa, su moneda"
);
comprobar(
  "la linea de UN precio sigue intacta para los demas casos",
  /EFFECTIVE PRICE FOR THIS CUSTOMER: \$\{precioEnVenta\}\. This is the ONLY price you must quote when they ask how much it costs\./.test(
    cerebro
  ),
  "con la opcion elegida vuelve a haber uno"
);
comprobar(
  "y las dos ramas mantienen la orden del comprobante",
  (cerebro.match(/call register_payment_amount with the exact amount from the receipt/g) ??
    []).length >= 2,
  "el lector del comprobante no se queda sin ella"
);
// SU REGLA DURA DE ORDER BUMP: mientras el segundo producto sigue tapado, aqui no
// se nombra ni su precio ni su nombre. Se pregunta con las MISMAS banderas que usa
// el bloque del order bump, no con una copia.
comprobar(
  "y en Order Bump tapado NO se dan los dos precios",
  /!\(isOrderBumpActive\(\) && \(orderBumpDeferredUntilPayment \|\| orderBumpPostSale\)\)/.test(
    cerebro
  ),
  "su regla dura, intacta"
);
comprobar(
  "solo antes de elegir",
  /convo\?\.order_bump_choice !== "combo" &&\s*\n\s*convo\?\.order_bump_choice !== "basico" &&/.test(
    cerebro
  ),
  "elegida una, vuelve la linea de siempre"
);

// ── 8. Y EN «COMO OB» NADA DE ESTO DESTAPA EL PRODUCTO OCULTO ──────────────
//
// EL AGUJERO QUE ESTO CIERRA, y era de este mismo dia: en Order Bump el segundo
// producto NO existe para el cliente hasta que muestra intencion de pagar. Es su
// regla dura: «del producto full no se dice NI EL PRECIO NI EL CONTENIDO hasta ese
// momento».
//
// Sin este freno pasaba lo siguiente: el cliente pregunta el precio, el modelo
// contesta con el del producto BASE —que ahi es lo correcto— y el guardarrail lo
// tomaba por una omision y le PEDIA nombrar las dos opciones con sus dos precios.
// El freno que existe para no equivocar un precio habria destapado el oculto.
//
// Se pregunta en UN solo sitio, `elSegundoProductoSigueTapado`, porque hay cuatro
// puertas que deciden esto y una copia en cada una acaba discrepando — y aqui
// discrepar significa destapar el producto por un despiste.
console.log("\n— 8. en «como OB» no se destapa el oculto —\n");
montar({ segunda_opcion_prestada: "segunda_oculta" });
const comoOb = m.loadWorkflowConfig();
comprobar(
  "en «como OB» hay dos opciones",
  m.getActiveTwoTierOffer(comoOb) !== null,
  "la oferta existe en la configuracion"
);
comprobar(
  "pero el segundo esta TAPADO hasta que se destapa",
  m.elSegundoProductoSigueTapado({ order_bump_revealed: 0 }) === true &&
    m.elSegundoProductoSigueTapado({ order_bump_revealed: 1 }) === false,
  "su regla dura"
);
comprobar(
  "  y sin el dato se asume tapado",
  m.elSegundoProductoSigueTapado(null) === true,
  "ante la duda, no se destapa"
);
montar({ segunda_opcion_prestada: "dos_juntas" });
m.loadWorkflowConfig();
comprobar(
  "en «como DOU» no hay nada tapado, nunca",
  m.elSegundoProductoSigueTapado({ order_bump_revealed: 0 }) === false,
  "ahi las dos se presentan desde el inicio"
);
comprobar(
  "el guardarrail del precio pregunta por esa bandera",
  /!elSegundoProductoSigueTapado\(convo\) &&/.test(cerebro),
  "no se arma con el oculto tapado"
);
comprobar(
  "y el precio del prompt tambien",
  /!elSegundoProductoSigueTapado\(convo\);/.test(cerebro),
  "los dos precios no viajan si uno esta tapado"
);
comprobar(
  "y vive en un solo sitio",
  /export function elSegundoProductoSigueTapado\(/.test(
    readFileSync(join(RAIZ, "src", "lib", "workflow", "config.ts"), "utf8")
  ),
  "cuatro puertas, una sola pregunta"
);

console.log(`\n${fallos === 0 ? "TODO EN VERDE" : `${fallos} EN ROJO`}\n`);
process.exit(fallos === 0 ? 0 : 1);
