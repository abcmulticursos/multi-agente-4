// «Elegí el full y no me respondió ninguna burbuja».
//
// LO QUE PASO, EN ORDEN
//
//   1. La opcion FULL tenia la «Respuesta al elegir» SIN ESCRIBIR: seguia con el
//      texto de plantilla «<<TEXTO_METODO_Y_PRECIO_COMBO ...>>».
//   2. La guarda que debia saltarse las respuestas sin llenar era
//      `sectionHasPlaceholder`, que a proposito NO mira dentro de los arrays
//      «_variants»... y el editor guarda TODO el texto justo ahi, dejando
//      `body` vacio. Vio `body: ""`, dijo «aqui no hay plantilla» y la dio por
//      buena.
//   3. Al darla por buena, el motor tomo la rama «su respuesta propia SUSTITUYE
//      a las burbujas de pago» y CANCELO los datos de pago.
//   4. Al ir a enviarla, `pickVariant` si descarta los «<<...>>»: no quedo
//      texto y no salio nada.
//   5. Y aun asi marco la conversacion como `payment_done`.
//
//   Resultado: el cliente eligio su producto y recibio SILENCIO, sin datos de
//   pago y con la venta dada por entregada. Volvio a escribir, cayo ya en
//   `payment_done`, y el modelo lleno el hueco con «¿queres que te indique como
//   adquirirlo?» — que fue el segundo sintoma. UN SOLO FALLO, no dos.
//
// LO QUE VIGILA ESTA PRUEBA
//
//   1. La guarda pregunta por lo que DE VERDAD se va a enviar, mirando tambien
//      `body_variants`, que es donde el editor escribe.
//   2. Enviar informa de si salio algo: `sendResponseStep` y
//      `enviarRespuestaAlElegir` devuelven booleano.
//   3. Sustituir con nada no es sustituir: el estado `payment_done` y el aviso a
//      Meta van DESPUES de comprobar que salio; si no salio, se sigue por las
//      burbujas de pago de siempre.
//   4. Order Bump no se toca: sus dos ramas de pago siguen volviendo antes.
//   5. Aviso (no fallo) si en el contenido de hoy alguna opcion de la modalidad
//      activa tiene esa respuesta sin llenar.
//
//   node scripts/prueba-sustituir-el-pago-con-nada.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");
const motor = leer("src", "lib", "workflow", "engine.ts");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 60)} ${valor}`);
};
const trozo = (desde, largo) => {
  const i = motor.indexOf(desde);
  return i < 0 ? "" : motor.slice(i, i + largo);
};

// ── 1. La guarda mira donde el editor escribe ────────────────────────────────
const guarda = trozo("function laBurbujaSaleDeVerdad(", 1400);
comprobar(
  "existe la guarda de «¿esta burbuja sale?»",
  guarda.length > 0,
  "laBurbujaSaleDeVerdad"
);
comprobar(
  "mira body_variants, no solo body",
  guarda.includes("body_variants"),
  "el editor guarda ahi el texto"
);
comprobar(
  "descarta las variantes con <<plantilla>>",
  guarda.includes('"<<"') && guarda.includes('">>"'),
  "sinPlantilla"
);
comprobar(
  "exige que TODA variante buena tenga texto",
  guarda.includes("utiles.every(conTexto)"),
  "mira el peor sorteo, no uno al azar"
);
comprobar(
  "cae al campo suelto si no queda ninguna variante",
  guarda.includes("conTexto(suelto)"),
  "igual que pickVariant"
);

const eleccion = trozo("function respuestaAlElegirProducto(", 3000);
comprobar(
  "la respuesta al elegir usa esa guarda",
  eleccion.includes("laBurbujaSaleDeVerdad"),
  "vivos.some(...)"
);
comprobar(
  "y avisa en el log cuando la descarta",
  /console\.warn\([^)]*Respuesta al elegir/s.test(eleccion),
  "este caso murio en silencio una vez"
);

// ── 2. Enviar informa de si salio algo ───────────────────────────────────────
const envioPaso = trozo("async function sendResponseStep(", 2600);
comprobar(
  "sendResponseStep devuelve booleano",
  /async function sendResponseStep\([\s\S]*?\): Promise<boolean>/.test(envioPaso),
  "Promise<boolean>"
);
comprobar(
  "y devuelve false cuando no hay texto",
  /if \(!bodyText\.trim\(\)\) return false;/.test(envioPaso),
  "sin texto no se manda nada"
);

const envioRespuesta = trozo("async function enviarRespuestaAlElegir(", 1200);
comprobar(
  "enviarRespuestaAlElegir devuelve booleano",
  /\): Promise<boolean>/.test(envioRespuesta),
  "salio al menos una burbuja"
);
comprobar(
  "acumula el resultado de cada burbuja",
  envioRespuesta.includes("salioAlguna"),
  "no basta con que existan pasos"
);

// ── 3. Sustituir con nada no es sustituir ────────────────────────────────────
const dou = trozo("export async function deliverDobleOfertaPaymentDetails(", 4500);
const ramaPropia = dou.slice(
  dou.indexOf("const respuestaDelProducto"),
  // El pago directo mira ahora el telefono, para poder usar el texto propio de
  // esta modalidad y pais en vez del global.
  dou.indexOf(
    'if (shouldUseDirectPayment(config, "with_choice", convo.phone)) {',
    dou.indexOf("const respuestaDelProducto")
  )
);
comprobar(
  "la doble oferta comprueba que salio",
  /const salio = await enviarRespuestaAlElegir\(/.test(ramaPropia),
  "salio"
);
comprobar(
  "payment_done solo si salio",
  ramaPropia.indexOf("if (salio)") > 0 &&
    ramaPropia.indexOf("if (salio)") <
      ramaPropia.indexOf('setConversationState(convo.id, "payment_done")'),
  "el estado va despues de la comprobacion"
);
comprobar(
  "el aviso a Meta solo si salio",
  ramaPropia.indexOf("if (salio)") <
    ramaPropia.indexOf("reportInitiateCheckout(convo, metodoDeLaRespuesta"),
  "no se avisa de una compra que nadie vio"
);
comprobar(
  "si no salio, sigue por las burbujas de siempre",
  /console\.warn\([\s\S]*?no envió ninguna burbuja/.test(ramaPropia) &&
    !/if \(salio\)[\s\S]*?\n    \}\n    return;/.test(ramaPropia),
  "no hay return en el camino de fallo"
);
// El `return` solo puede estar DENTRO del `if (salio)`. Si estuviera fuera, la
// conversacion se quedaria sin datos de pago igual que el dia del fallo.
const finDeLaRama = ramaPropia.slice(ramaPropia.indexOf("if (salio)"));
comprobar(
  "el unico return de la rama esta dentro del if",
  (finDeLaRama.match(/\n      return;/g) ?? []).length === 1 &&
    !/\n    return;/.test(finDeLaRama),
  "un return suelto reabriria el fallo"
);

// ── 4. Order Bump sigue como estaba ──────────────────────────────────────────
// La ventana tiene que cubrir la funcion ENTERA. Al meterle una rama nueva —el
// mensaje propio de cada producto— la respuesta al elegir se salio del recorte,
// y la prueba dijo "no esta" cuando si estaba: solo que mas abajo.
const ob = trozo("async function deliverOrderBumpResponse(", 12000);
// El pago directo mira ahora el telefono: el texto puede ser propio de esta
// modalidad y pais, no solo el global de arriba.
const posPagoDirecto = ob.indexOf(
  'if (config && shouldUseDirectPayment(config, "with_choice", convo.phone)) {'
);
const posMetodoElegido = ob.indexOf("if (convo.selected_payment_method && config) {");
const posRespuesta = ob.indexOf("await enviarRespuestaAlElegir(");
comprobar(
  "order bump: pago directo vuelve antes de la respuesta",
  posPagoDirecto > 0 && posPagoDirecto < posRespuesta,
  `rama en ${posPagoDirecto}, respuesta en ${posRespuesta}`
);
comprobar(
  "order bump: metodo ya elegido vuelve antes de la respuesta",
  posMetodoElegido > 0 && posMetodoElegido < posRespuesta,
  `rama en ${posMetodoElegido}`
);
comprobar(
  "order bump: su respuesta NO sustituye al pago",
  !ob.includes("sustituye a las burbujas de pago"),
  "aqui la respuesta PRESENTA el pago"
);

// ── 5. Seguimientos: el mismo agujero, tapado ────────────────────────────────
const seguimientos = trozo("const algunaBurbujaSale", 700);
comprobar(
  "los seguimientos comprueban lo mismo",
  seguimientos.includes("laBurbujaSaleDeVerdad"),
  "un seguimiento que no envia nada no es un seguimiento"
);

// ── 6. Aviso sobre el contenido de hoy ───────────────────────────────────────
const cfg = YAML.parse(leer("config", "intro-data.yaml"));
const modalidad = cfg.doble_oferta_upsell?.enabled
  ? "doble_oferta_upsell"
  : cfg.upsell?.enabled
    ? "upsell"
    : cfg.doble_oferta_dos?.enabled
      ? "doble_oferta_dos"
      : cfg.order_bump?.enabled
        ? "order_bump"
        : cfg.bioferta_doble?.enabled
          ? "bioferta"
          : "lineal";
const oferta =
  cfg[modalidad === "doble_oferta_upsell" ? "doble_oferta_upsell" : modalidad] ??
  null;
const sale = (paso) => {
  const conTexto = (t) => !!(t ?? "").trim();
  const sinPlantilla = (t) => !((t ?? "").includes("<<") && (t ?? "").includes(">>"));
  const hayTexto = (variantes, suelto) => {
    const utiles = (variantes ?? []).filter(sinPlantilla);
    if (utiles.length > 0) return utiles.every(conTexto);
    return conTexto(suelto) && sinPlantilla(suelto);
  };
  if (paso?.type === "text") return hayTexto(paso.body_variants, paso.body);
  return (
    (conTexto(paso?.drive_url) && sinPlantilla(paso?.drive_url)) ||
    hayTexto(paso?.caption_variants, paso?.caption)
  );
};
// ── EL REENVÍO TAMPOCO LLEGA A SECAS ────────────────────────────────────────
//
// LO QUE PASÓ — 24 de septiembre de 2026, seis conversaciones en paralelo. El
// cliente escribió «quiero pagar» (Perú) y «voy a pagar» (Argentina), y le llegó
// el número de cuenta SIN la burbuja que lo presenta. Con sus palabras: «esa
// burbuja es importante para que no parezca que le están tirando el método de
// pago en la cara».
//
// Es el mismo fallo de este archivo, en otra puerta. La frase del reenvío es
// opcional a propósito: cuando el reenvío lo pide el MODELO con su marcador, él
// ya escribió algo y otra frase encima serían dos saludos. Pero la puerta del
// MOTOR —la que atiende «quiero pagar»— se queda el turno y el modelo NO habla.
// Al no pedir la frase, no la decía nadie.
console.log("\n--- el reenvío del motor lleva su frase ---");
comprobar(
  "«quiero pagar» no recibe la cuenta a secas",
  /re-envío determinístico[\s\S]{0,400}/.test(motor) &&
    /resendPaymentDetails\(convo, \{ conFrase: true \}\);\s*\n\s*if \(ok\) \{\s*\n\s*console\.log\(\s*\n\s*`\[wf\] convo \$\{convo\.id\} → re-envío determinístico/.test(
      motor
    ),
  "sale su burbuja antes de los datos"
);
// Y LA OTRA MITAD: donde SÍ habla el modelo, la frase no se repite. Si algún día
// alguien se la pone también ahí, el cliente leería dos presentaciones seguidas.
comprobar(
  "y donde habla el modelo no se duplica",
  /<<\s*REENVIAR_PAGO[\s\S]{0,600}?resendPaymentDetails\(latestPaymentConvo\);/.test(
    leer("src", "lib", "meta", "handler.ts")
  ),
  "el marcador la trae escrita"
);

console.log(`\n--- contenido de hoy (modalidad activa: ${modalidad}) ---`);
for (const cual of ["combo", "basico"]) {
  const pasos = (oferta?.[cual]?.response ?? []).filter((p) => p?.enabled !== false);
  if (pasos.length === 0) continue;
  const utiles = pasos.filter(sale).length;
  console.log(
    utiles > 0
      ? `ok    «Respuesta al elegir» de ${cual}: ${utiles}/${pasos.length} burbujas con texto`
      : `AVISO «Respuesta al elegir» de ${cual} esta SIN LLENAR (solo plantilla).\n      No es un fallo: el bot manda las burbujas de pago de siempre.\n      Si la quieres personalizada, escribela en el editor.`
  );
}

console.log(`\n${fallos === 0 ? "TODO OK" : `${fallos} FALLOS`}`);
process.exit(fallos === 0 ? 0 : 1);
