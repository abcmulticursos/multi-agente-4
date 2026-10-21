// QUIEN PAGA RECIBE SU MATERIAL, TAMBIEN CON LA PRESENTACION PRESTADA.
//
// LO QUE PASO — 23 de septiembre de 2026. El dueño vendio dos productos con
// «PRESENTA:» encendido. Su recorrido, en sus registros:
//
//     LLM confirmo eleccion "basico"          <- eligio
//     convo 43 cambio de "basico" a "combo"   <- cambio de idea
//     reutilizo pago "yape" con monto actualizado
//     [wf:pago] convo 43 APROBADO (total: S/. 10 Soles)
//     [wf:pago] convo 43: PAGO y no hay entrega que mandar (la opcion Full)
//
//   Cuatro escalones perfectos y el ultimo vacio. Pago y no recibio nada.
//
// LA CAUSA. La oferta prestada se armaba VACIA —`{ combo: {}, basico: {} }`— y
// solo se le ponia el NOMBRE encima. Medido con su configuracion:
//
//     ficha del producto del Full : entrega 1 paso     <- SI la tenia
//     doble_oferta_dos.combo      : entrega 1 paso     <- el reparto la copio
//     getOrderBumpOption("combo") : entrega (nada)     <- y el motor leia ESTO
//         campos=[name]
//
//   Como la entrega salia vacia Y ese puesto lo llena un producto elegido, el
//   motor hizo lo correcto: pararse, en vez de mandar el material del producto
//   anterior. Lo que fallaba era de donde sacaba la entrega.
//
//   Los precios y los nombres no lo notaban porque van por su propio camino. Por
//   eso el fallo solo aparecia en el ultimo escalon de la venta.
//
// LO QUE NO PUEDE ROMPERSE
//
//   1. LAS MODALIDADES SON HERMETICAS. Se copia lo que sale de la FICHA del
//      producto —entrega, apodos, precios, regalos— y NUNCA el guion de venta de
//      la caja: respuesta al elegir, mensaje directo, respuestas por metodo y
//      textos por pais. Importar si, prestar no.
//   2. SIN LOS DOS NOMBRES NO HAY OFERTA. Si todavia no sento al segundo
//      producto, se sigue vendiendo uno, igual que hoy.
//   3. -OB- Y LAS DOS DOBLES OFERTAS no se tocan: sus ramas van antes.
//
//   node scripts/prueba-la-entrega-llega-con-la-presentacion-prestada.mjs
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

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
        source:
          "export const getConversationByPhone=()=>null;export const getFrozenPrices=()=>null;export const getUpsellFrozenPrices=()=>null;export const getPuestoEnLaFila=()=>null;export const leerCompradosDeLaFila=()=>[];export const moverLaFila=()=>{};export const setFrozenPrices=()=>{};",
      };
    return next(url, ctx);
  },
});

const motor = await import(
  pathToFileURL(join(RAIZ, "src", "lib", "workflow", "config.ts")).href
);
const { repartirPorEtiqueta, getActiveTwoTierOffer } = motor;

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 56)} ${valor}`);
};
const pasos = (a) => (Array.isArray(a) ? a.length : 0);

// PRODUCTOS INVENTADOS. Con los reales se taparia justo el fallo que la regla de
// la plantilla evita. Cada uno con SU entrega, SUS apodos y SU regalo.
const biblioteca = [
  {
    id: "pB",
    name: "PRODUCTO ALFA",
    price_soles: 111,
    aliases: ["alfa", "el barato"],
    regalos: "regalo del barato",
    delivery: [{ type: "text", body: "AQUI TIENES EL ALFA" }],
  },
  {
    id: "pF",
    name: "PRODUCTO BETA",
    price_soles: 222,
    aliases: ["beta", "el caro"],
    regalos: "regalo del caro",
    delivery: [
      { type: "text", body: "AQUI TIENES EL BETA" },
      { type: "text", body: "y su segundo paso" },
    ],
  },
];

// EL GUION DE VENTA QUE NO PUEDE VIAJAR. Se siembra en la caja de la otra
// modalidad a proposito: es exactamente lo que no debe aparecer en la prestada.
const GUION_AJENO = {
  response: [{ type: "text", body: "GUION DE LA OTRA MODALIDAD" }],
  direct_payment_prompt: [{ type: "text", body: "PAGO DIRECTO AJENO" }],
  payment_responses: { yape: [{ type: "text", body: "YAPE AJENO" }] },
  by_country: { PE: { response: [{ type: "text", body: "PERU AJENO" }] } },
};

const montar = (forma, alineacion) =>
  repartirPorEtiqueta({
    biblioteca_de_productos: biblioteca,
    alineacion_por_modalidad: { lineal: alineacion },
    doble_oferta_dos: { combo: { ...GUION_AJENO }, basico: { ...GUION_AJENO } },
    ...(forma ? { segunda_opcion_prestada: forma } : {}),
  });

const losDos = { unico: "pB", basico: "pB", full: "pF" };
const soloUno = { unico: "pB" };

// -- 1. LA ENTREGA LLEGA, EN LAS DOS FORMAS Y EN LAS DOS OPCIONES ------------
console.log("\n-- 1. la entrega llega -------------------------------------");
for (const forma of ["dos_juntas", "segunda_oculta"]) {
  const oferta = getActiveTwoTierOffer(montar(forma, losDos));
  comprobar(
    `«${forma}»: el caro trae SU entrega`,
    pasos(oferta?.combo?.delivery) === 2,
    `${pasos(oferta?.combo?.delivery)} pasos`
  );
  comprobar(
    `«${forma}»: y el barato la SUYA`,
    pasos(oferta?.basico?.delivery) === 1,
    `${pasos(oferta?.basico?.delivery)} pasos`
  );
  comprobar(
    `«${forma}»: y no es la misma entrega para los dos`,
    JSON.stringify(oferta?.combo?.delivery) !==
      JSON.stringify(oferta?.basico?.delivery),
    "cada producto el suyo"
  );
}

// -- 2. Y LO DEMAS QUE ES DEL PRODUCTO TAMBIEN -------------------------------
//
// Los apodos hacen falta para reconocer la eleccion sin depender del modelo, y
// los regalos para que el bot sepa que incluye cada opcion.
console.log("\n-- 2. los apodos y los regalos tambien ----------------------");
const oferta = getActiveTwoTierOffer(montar("dos_juntas", losDos));
comprobar(
  "el caro trae sus apodos",
  (oferta?.combo?.aliases ?? []).includes("el caro"),
  JSON.stringify(oferta?.combo?.aliases ?? [])
);
comprobar(
  "y su regalo",
  oferta?.combo?.regalos === "regalo del caro",
  `${oferta?.combo?.regalos}`
);
comprobar(
  "el barato trae los suyos",
  (oferta?.basico?.aliases ?? []).includes("el barato") &&
    oferta?.basico?.regalos === "regalo del barato",
  "cada uno el suyo"
);

// -- 3. EL GUION DE LA OTRA MODALIDAD NO VIAJA -------------------------------
//
// EL CANDADO QUE MAS IMPORTA. Modalidades hermeticas: importar si, prestar no.
// Si esto se rompe, el cliente de Lineal leeria el texto de venta de Doble
// Oferta sin que nadie lo haya escrito ahi.
console.log("\n-- 3. el guion de la otra modalidad NO viaja ----------------");
for (const lado of ["combo", "basico"]) {
  for (const campo of [
    "response",
    "response_variants",
    "direct_payment_prompt",
    "payment_responses",
    "by_country",
  ]) {
    comprobar(
      `«${lado}» no trae «${campo}»`,
      oferta?.[lado]?.[campo] === undefined,
      "vacio, como hasta hoy"
    );
  }
}

// EL NOMBRE ESCRITO A MANO EN LA CAJA VECINA TAMPOCO VIAJA.
//
// Lo pillo `prueba-la-presentacion-prestada` en el primer intento de este
// arreglo. `conLosNombresDelContenido` deja ganar al nombre escrito a mano en la
// caja —hay quien le mete el precio dentro para los botones—, asi que copiar el
// `name` era la unica via por la que un texto de otra modalidad podia llegarle
// al cliente. Los nombres vienen por su camino: `product_name` y `product_name_2`.
const conNombreAjeno = montar("dos_juntas", losDos);
conNombreAjeno.doble_oferta_dos = {
  combo: { name: "NOMBRE_DE_LA_VECINA" },
  basico: { name: "TAMPOCO_ES_MIO" },
};
const sinContagio = getActiveTwoTierOffer(conNombreAjeno);
comprobar(
  "el nombre escrito a mano en la vecina no viaja",
  sinContagio?.combo?.name !== "NOMBRE_DE_LA_VECINA" &&
    sinContagio?.basico?.name !== "TAMPOCO_ES_MIO",
  `${sinContagio?.combo?.name} / ${sinContagio?.basico?.name}`
);

// -- 4. SIN EL SEGUNDO SENTADO, SE SIGUE VENDIENDO UNO -----------------------
console.log("\n-- 4. sin el segundo sentado no hay oferta ------------------");
comprobar(
  "no se inventa una segunda opcion",
  getActiveTwoTierOffer(montar("dos_juntas", soloUno)) === null,
  "se comporta como hoy"
);

// -- 4-TER. Y EL AVISO SE DICE UNA VEZ, NO CINCUENTA -------------------------
//
// LO QUE PIDIO EL DUEÑO — 24/09/2026, viendo su registro con el mismo renglon
// quince veces seguidas: «me refiero a la cantidad de texto que bota, es
// muchisimo, creo que eso estaba antes quitado el texto innecesario».
//
// Tenia razon: la cura ya existia —el diagnostico de pais se apago por lo mismo,
// «una linea util por cada cincuenta de ruido»— y este aviso nacio despues sin
// heredarla. Se dispara en CADA lectura de la oferta, y hay muchas por turno.
//
// NO SE APAGA: es el que dice POR QUE el bot sigue vendiendo uno. Lo que sobra
// es repetirlo.
console.log("\n-- 4-ter. el aviso se dice una vez -------------------------");
const cfgSinSegundo = repartirPorEtiqueta({
  biblioteca_de_productos: [{ id: "pX", name: "PRODUCTO PARA EL AVISO" }],
  alineacion_por_modalidad: { lineal: { unico: "pX", basico: "pX" } },
  segunda_opcion_prestada: "dos_juntas",
});
const warnDeVerdad = console.warn;
let avisos = 0;
console.warn = (...args) => {
  if (String(args[0] ?? "").includes("PRODUCTO PARA EL AVISO")) avisos++;
};
for (let i = 0; i < 5; i++) getActiveTwoTierOffer(cfgSinSegundo);
console.warn = warnDeVerdad;
comprobar(
  "cinco lecturas, un solo aviso",
  avisos === 1,
  `${avisos} aviso(s) en 5 lecturas`
);

// -- 4-BIS. Y CON UN SOLO PRODUCTO, EL UNICO SIGUE COBRANDO Y ENTREGANDO -----
//
// LO QUE PASO — 23/09/2026. Lo destapo una pregunta del dueño: «¿puedo imitar
// lineal dejando el selector puesto y sentando un solo producto?». Vender uno
// solo SI funcionaba. Lo que no: su precio y su entrega no se refrescaban.
//
//     selector apagado    cobra 55    entrega la suya
//     selector encendido  cobra 999   entrega la de la plantilla vieja
//
// Habia DOS VERDADES. La venta miraba los productos, veia uno y vendia uno por
// el camino del Unico. `puestosDeLaModalidad` miraba el INTERRUPTOR y decia que
// el Unico no existe aqui, asi que el reparto nunca le copiaba nada. Al cliente
// le llegaba el material de OTRO producto, que es el peor fallo de esta casa.
console.log("\n-- 4-bis. con un solo producto, el Unico sigue vivo ---------");
const ENTREGA_VIEJA = [{ type: "text", body: "ENTREGA DE LA PLANTILLA VIEJA" }];
const unSoloProducto = (forma) =>
  repartirPorEtiqueta({
    biblioteca_de_productos: [
      {
        id: "pS",
        name: "PRODUCTO SOLO",
        price_soles: 55,
        delivery: [{ type: "text", body: "LO QUE RECIBE QUIEN COMPRA EL SOLO" }],
      },
    ],
    alineacion_por_modalidad: { lineal: { unico: "pS", basico: "pS" } },
    payment_approved_sequence: ENTREGA_VIEJA,
    course_price_soles: 999,
    ...(forma ? { segunda_opcion_prestada: forma } : {}),
  });
const textoDeLaEntrega = (cfg) => {
  const p = cfg?.payment_approved_sequence?.[0];
  return String(p?.body ?? p?.body_variants?.[0] ?? "");
};
for (const forma of [null, "dos_juntas", "segunda_oculta"]) {
  const cfg = unSoloProducto(forma);
  const nombre = forma ?? "apagado";
  comprobar(
    `«${nombre}»: entrega LA SUYA, no la vieja`,
    textoDeLaEntrega(cfg).includes("QUIEN COMPRA EL SOLO"),
    textoDeLaEntrega(cfg).slice(0, 34)
  );
  comprobar(
    `«${nombre}»: y cobra SU precio`,
    cfg?.course_price_soles === 55,
    `${cfg?.course_price_soles}`
  );
}

// -- 5. LINEAL A SECAS NO SE MOVIO -------------------------------------------
console.log("\n-- 5. lineal a secas no se movio ---------------------------");
comprobar(
  "sin el interruptor, sigue sin oferta de dos",
  getActiveTwoTierOffer(montar(null, losDos)) === null,
  "el selector es el que manda"
);

console.log(
  fallos === 0
    ? "\nTODO OK — quien paga recibe lo suyo, y nada de otra modalidad viaja\n"
    : `\n${fallos} comprobacion(es) mal.\n`
);
process.exit(fallos === 0 ? 0 : 1);
