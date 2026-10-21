// EL «SÍ» A LAS IMÁGENES QUE EL BOT OFRECIÓ.
//
// LO QUE PIDIÓ EL DUEÑO — 17 de septiembre de 2026, con sus palabras:
//
//   «Que a la primera intención del cliente de saber qué contiene, el bot le dé
//    la información como de costumbre, y al final de la explicación le diga
//    "¿deseas ver unas imágenes?". Esto solo lo va a decir cuando haya imágenes
//    en la galería; si no hay imágenes ni check activo no se ofrece, se envía
//    texto y punto.»
//
//   «Deja que el agente diga lo que desee en ese aspecto.»  ← la frase la
//    redacta el MODELO, no está escrita en ningún sitio.
//
// Y AHÍ ESTABA EL AGUJERO. La puerta que atiende el «sí» reconocía la oferta con
// una LISTA DE PALABRAS contra el texto que escribe el modelo. Al medirla contra
// las formas en que un modelo cierra esa oferta, falló 7 de cada 10 — incluida
// la frase textual del dueño. Sin arreglarlo: el bot ofrece, el cliente dice
// «sí» y no pasa nada, que es exactamente el fallo de la conversación HELLO1.
//
// ESTA PRUEBA NO COMPRUEBA QUE UN TEXTO ESTÉ ESCRITO: EJECUTA EL CÓDIGO REAL,
// sacado del archivo fuente, y mira lo que devuelve. Es la diferencia que el
// dueño reclamó — «¿no hiciste la prueba?» — después de cuatro intentos
// verificados solo con pruebas estáticas.
//
//   node scripts/prueba-el-si-a-las-imagenes-ofrecidas.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const handler = readFileSync(join(RAIZ, "src", "lib", "meta", "handler.ts"), "utf8").replace(/\r\n/g, "\n");
const config = readFileSync(join(RAIZ, "src", "lib", "workflow", "config.ts"), "utf8").replace(/\r\n/g, "\n");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// ── Se extrae la función REAL del archivo fuente y se ejecuta ────────────────
//
// Reimplementarla de memoria probaría lo que uno CREE que hace, que es justo lo
// que se está poniendo en duda. Solo se le quitan las anotaciones de tipo.
function sacar(fuente, nombre) {
  const i = fuente.indexOf(`function ${nombre}(`);
  if (i < 0) throw new Error(`no encuentro ${nombre} en el fuente`);
  const abre = fuente.indexOf("{", i);
  let nivel = 0;
  for (let k = abre; k < fuente.length; k++) {
    if (fuente[k] === "{") nivel++;
    else if (fuente[k] === "}") {
      nivel--;
      if (nivel === 0) {
        return fuente
          .slice(i, k + 1)
          .replace(/:\s*\(typeof gallery\)\[number\] \| null/g, "")
          .replace(/:\s*ReturnType<typeof getImageGallery>/g, "")
          .replace(/:\s*(string|boolean|number)\[\]/g, "")
          .replace(/:\s*string \| null/g, "")
          .replace(/:\s*(string|boolean|number|void)\b/g, "")
          .replace(/ = false\)/, " = false)");
      }
    }
  }
  throw new Error(`no cierra ${nombre}`);
}

const MARCA = (handler.match(
  /const MARCA_DE_OFERTA_DE_IMAGENES = "([^"]+)"/
) ?? [])[1];
comprobar("la marca de la oferta existe en el motor", !!MARCA, MARCA ?? "—");

const codigo = [
  sacar(config, "isPriceQuestion"),
  sacar(handler, "normalizeGalleryKey"),
  sacar(handler, "isCommerceOrPriceQuestion"),
  sacar(handler, "isShortVisualConsent"),
  sacar(handler, "offeredVisualSample"),
  sacar(handler, "editDistance"),
  sacar(handler, "findLocalGalleryKeywordMatch"),
  `const MARCA_DE_OFERTA_DE_IMAGENES = ${JSON.stringify(MARCA)};`,
  sacar(handler, "pickGalleryAfterVisualConsent"),
].join("\n\n");

const { pickGalleryAfterVisualConsent, offeredVisualSample, isShortVisualConsent } =
  new Function(
    `${codigo}\nreturn { pickGalleryAfterVisualConsent, offeredVisualSample, isShortVisualConsent };`
  )();

// ── LAS AFIRMACIONES QUE EL DUEÑO PROBÓ EN VIVO ─────────────────────────────
//
// Con sus palabras: «solo está aceptando afirmaciones claras, como sí; pero si
// el usuario dice "está bien", o "ok", o "ya envíeme", o cualquier afirmación
// que no coincida, no la está enviando». Tenía razón: `esta bien` no estaba, y
// `ya envieme` tampoco, porque la lista tenía `ya` SOLA.
console.log("\n— y reconoce las afirmaciones que él probó —\n");
for (const frase of [
  "si",
  "sí",
  "ok",
  "dale",
  "está bien",
  "esta bien",
  "ya envieme",
  "ya envíeme",
  "si mandeme",
  "muestrame",
  "claro que si",
  "por supuesto",
  "de una",
  "me gustaria",
]) {
  comprobar(`acepta «${frase}»`, isShortVisualConsent(frase) === true);
}
// Y LO QUE NO ES UNA AFIRMACIÓN SIGUE SIN SERLO.
for (const frase of ["no", "no gracias", "cuanto cuesta", "que contiene"]) {
  comprobar(`NO acepta «${frase}»`, isShortVisualConsent(frase) === false);
}

// Nombres inventados a propósito: en las pruebas NUNCA van los productos reales
// (regla de CLAUDE.md), porque una prueba escrita con ellos tapa el fallo.
const galeria = [
  { topic: "muestra-uno", keywords: ["uno"] },
  { topic: "muestra-dos", keywords: ["dos"] },
];

// ── 1. LAS FORMAS EN QUE UN MODELO REDACTA LA OFERTA ────────────────────────
//
// La primera es la que escribió el dueño con sus propias palabras. Ninguna de
// estas cuatro la reconoce la lista de palabras: son justo las que se perdían.
console.log("\n— el «sí» funciona aunque el modelo redacte como quiera —\n");
const ofertasQueLaListaNoReconoce = [
  "Te cuento todo lo que incluye... ¿Deseas ver unas imágenes?",
  "¿Te gustaría ver unas imágenes del contenido?",
  "¿Te comparto unas fotos?",
  "¿Te interesa ver fotos de lo que incluye?",
];
for (const oferta of ofertasQueLaListaNoReconoce) {
  comprobar(
    `la lista de palabras NO la reconoce: «${oferta.slice(-34)}»`,
    offeredVisualSample(oferta) === false,
    "por eso hace falta la marca"
  );
  const conMarca = pickGalleryAfterVisualConsent("si", oferta, galeria, [MARCA]);
  comprobar(
    "  …y aun así el «sí» manda la galería",
    conMarca?.topic === "muestra-uno",
    conMarca ? conMarca.topic : "NADA — el cliente se queda esperando"
  );
}

// ── 1.bis LA SEÑAL QUE NO DEPENDE DEL MODELO ────────────────────────────────
//
// LO QUE FALLÓ EN SUS TRES PRUEBAS EN PARALELO del 17 de septiembre de 2026: el
// marcador lo ponía el MODELO, y en sus registros aparece UNA sola vez en tres
// conversaciones. Ofreció bien en las tres; lo marcó en una. En las otras dos el
// «sí» se fue al modelo: una contestó texto y la otra tiró del OTRO camino de
// imágenes —`<<MEDIA: tema>>`, que manda UNA foto por diseño— así que de sus dos
// fichas marcadas recibió una. Con sus palabras: «eso es terrible».
//
// LA SEÑAL BUENA ES LA DEL MOTOR: fue el motor quien le pidió ofrecer, así que lo
// sabe sin preguntarle a nadie. Aquí se comprueba que con esa señal el «sí»
// funciona SIN marcador y SIN que el texto de la oferta se parezca a nada.
console.log("\n— y sin marcador ni texto reconocible, el motor basta —\n");
const sinNadaReconocible = "Con gusto. Dime si te muestro un par de vistazos.";
comprobar(
  "el texto de la oferta no lo reconoce nadie",
  offeredVisualSample(sinNadaReconocible) === false,
  "ni la lista de palabras"
);
comprobar(
  "y aun sin marcador, el «sí» manda la galería",
  pickGalleryAfterVisualConsent("si", sinNadaReconocible, galeria, [], true)
    ?.topic === "muestra-uno",
  "lo apuntó el motor"
);
comprobar(
  "pero si el motor NO lo pidió, no dispara",
  pickGalleryAfterVisualConsent("si", sinNadaReconocible, galeria, [], false) ===
    null,
  "no vale cualquier «sí»"
);
comprobar(
  "con la señal del motor, un «no» tampoco",
  pickGalleryAfterVisualConsent("no", sinNadaReconocible, galeria, [], true) ===
    null,
  "hace falta afirmar"
);
comprobar(
  "ni con las muestras ya vistas",
  pickGalleryAfterVisualConsent("si", sinNadaReconocible, galeria, [
    "muestra-uno",
    "muestra-dos",
  ], true) === null,
  "su «una sola vez»"
);

// LA NOTA DURA UN SOLO TURNO Y SE CONSUME AL LEERLA. Si se quedara puesta, un
// «sí» de compra de la semana que viene sacaría fotos.
console.log("\n— y la nota del motor dura un solo turno —\n");
const llm = readFileSync(join(RAIZ, "src", "lib", "openrouter.ts"), "utf8").replace(
  /\r\n/g,
  "\n"
);
const memoria = new Function(
  `const laOfertaDeImagenesQuedoPedida = new Map();
   ${sacar(llm, "apuntarQueSeLePidioOfrecerImagenes")}
   ${sacar(llm, "seLePidioOfrecerImagenesEnElTurnoAnterior")}
   ${sacar(llm, "olvidarLaOfertaDeImagenes")}
   return {
     apuntar: apuntarQueSeLePidioOfrecerImagenes,
     leer: seLePidioOfrecerImagenesEnElTurnoAnterior,
     olvidar: olvidarLaOfertaDeImagenes,
   };`
)();
memoria.apuntar(1, "__oferta__a|b");
comprobar("la nota guarda la ETAPA, no un sí/no", memoria.leer(1) === "__oferta__a|b");
comprobar(
  "y se puede leer dos veces sin perderla",
  memoria.leer(1) === "__oferta__a|b",
  "la capa 2 la necesita después"
);
memoria.olvidar(1);
comprobar("se consume al mandar las imágenes", memoria.leer(1) === null);
memoria.apuntar(1, null);
comprobar(
  "y un turno que no toca la deja apagada",
  memoria.leer(1) === null,
  "se reescribe en cada turno"
);
// SE ESCRIBE EN CADA LLAMADA AL MODELO, también a `null`. Si solo se escribiera
// cuando toca, la nota de un turno viejo sobreviviría a los turnos de en medio.
comprobar(
  "el motor la escribe con la clave de la etapa",
  /apuntarQueSeLePidioOfrecerImagenes\(\s*convo\.id,\s*\n?\s*tocaOfrecerLasMuestras \? claveDeLaEtapa : null\s*\n?\s*\);/.test(
    llm
  ),
  "o null si no toca"
);
comprobar(
  "y la puerta del «sí» la lee sin consumirla",
  /const elMotorLePidioOfrecer = seLePidioOfrecerImagenesEnElTurnoAnterior\(/.test(
    handler
  ),
  "para que la capa 2 la vea"
);

// ── UNA VEZ POR ETAPA, Y EN ORDER BUMP LA ETAPA CAMBIA ──────────────────────
//
// SU REGLA, con sus palabras: «solo se ofrecen luego de la primera consulta,
// luego a la siguiente consulta ya son puro texto; pero en order bump hay 2
// etapas: si vuelve a preguntar en la etapa donde ya se reveló el full, el bot
// debe enviar otra vez todas las imágenes si es la primera consulta luego del
// destape, de ahí en adelante puro texto».
//
// La clave se forma con las muestras DE LA ETAPA, así que al destaparse el full
// la clave cambia sola y la oferta vuelve una vez. Sin nombrar la modalidad.
console.log("\n— y se ofrece una vez por ETAPA, no una por pregunta —\n");
const claveDe = new Function(
  `return (muestras) => {
     ${
       (llm.match(
         /const claveDeLaEtapa =\s*\n?\s*"__oferta__" \+[\s\S]{0,400}?\.join\("\|"\);/
       ) ?? [""])[0]
     }
     return claveDeLaEtapa;
   };`.replace(/muestrasDeEstaEtapa/g, "muestras")
)();
const antesDelDestape = claveDe([{ topic: "BASE" }]);
const despuesDelDestape = claveDe([
  { topic: "BASE" },
  { topic: "COMPLEMENTO" },
  { topic: "FULL" },
]);
comprobar("se encuentra la clave de la etapa", antesDelDestape.length > 10);
comprobar(
  "la etapa del order bump tapado tiene su clave",
  antesDelDestape !== despuesDelDestape,
  `${antesDelDestape}  ≠  ${despuesDelDestape}`
);
comprobar(
  "y dos veces la misma etapa da la MISMA clave",
  claveDe([{ topic: "BASE" }]) === antesDelDestape,
  "por eso no vuelve a ofrecer en la misma etapa"
);
comprobar(
  "el orden en que lleguen no cambia la clave",
  claveDe([{ topic: "FULL" }, { topic: "BASE" }, { topic: "COMPLEMENTO" }]) ===
    despuesDelDestape,
  "se ordenan antes de juntarlas"
);
comprobar(
  "y solo se apunta como ofrecida DESPUÉS de enviarla",
  /await sendChunkedBotText\(fresh, reply, burbujas \?\? undefined\);\s*\n\s*if \(laEtapaDeLaOferta && laOferta\) \{\s*\n\s*markMediaSent\(fresh\.id, laEtapaDeLaOferta\);/.test(
    handler
  ),
  "no se da por hecho lo que no salió"
);

// ── 1.ter Y SALEN TODAS, EN EL ORDEN QUE ÉL PIDIÓ ───────────────────────────
//
// SU QUEJA, con sus palabras: «me mandó una imagen, solo una, pero yo tengo
// checkada 2, 1 en cada ficha». Aquella salió por el camino de la foto suelta,
// que manda UNA por diseño. Por la puerta del motor salen todas — y ahora
// además en el orden de la GALERÍA, no en el de la lista de temas.
//
// EL FALLO QUE SE ARREGLA AQUÍ: esto recorría `product_info_topics` y las
// mandaba en el orden en que estuvieran escritos los temas. Con su contenido de
// hoy en -DOU- eso mandaba el FULL primero, justo al revés de su regla «siempre
// arrancando desde el BÁSICO... y el FULL al último».
console.log("\n— y salen todas, básico primero y full al final —\n");
const trozoDelReparto = (handler.match(
  /const seleccionados = new Set\([\s\S]{0,600}?\.filter\(\(item\) => !alreadySent\.has\(item\.topic\.toLowerCase\(\)\)\);/
) ?? [""])[0];
comprobar("se encuentra el reparto en el motor", trozoDelReparto.length > 80);
const reparto = new Function(
  `return (gallery) => {
     const getProductInfoTopics = () => ${JSON.stringify([
       "FULL-INVENTADO",
       "BASICO-INVENTADO",
       "UNO-QUE-NO-ESTA",
     ])};
     const alreadySent = new Set();
     ${trozoDelReparto}
     return selectedItems.map((i) => i.topic);
   };`
)();
// La galería llega ya ordenada por puesto: básico primero, full al final.
const galeriaOrdenada = [
  { topic: "BASICO-INVENTADO" },
  { topic: "FULL-INVENTADO" },
];
const salen = reparto(galeriaOrdenada);
comprobar(
  "salen las DOS que él tiene marcadas",
  salen.length === 2,
  `${salen.length} de 2`
);
comprobar(
  "y el básico va primero, el full al final",
  salen[0] === "BASICO-INVENTADO" && salen[1] === "FULL-INVENTADO",
  salen.join(" → ")
);
comprobar(
  "y un tema marcado que no está en la galería no estorba",
  !salen.includes("UNO-QUE-NO-ESTA"),
  "se ignora"
);

// ── 2. LO QUE YA FUNCIONABA SIGUE FUNCIONANDO ───────────────────────────────
//
// La lista de palabras no se quita: se queda de respaldo. Si el modelo olvida la
// marca pero redacta una de las formas que sí reconoce, el «sí» sigue valiendo
// igual que hasta hoy. No se sustituye nada, se añade una segunda puerta.
console.log("\n— y la puerta que ya existía no se ha tocado —\n");
comprobar(
  "sin marca, una oferta reconocible sigue valiendo",
  pickGalleryAfterVisualConsent("si", "¿quieres ver unas imágenes?", galeria, [])
    ?.topic === "muestra-uno",
  "el respaldo intacto"
);
comprobar(
  "sin marca y sin oferta, no se manda nada",
  pickGalleryAfterVisualConsent("si", "¿cuál de los dos prefieres?", galeria, []) ===
    null,
  "no dispara por cualquier «sí»"
);

// ── 3. LOS FRENOS ───────────────────────────────────────────────────────────
//
// La marca no puede quedarse colgada disparando para siempre. Tiene tres topes:
// hace falta una afirmación, hace falta que quede alguna muestra sin ver, y el
// motor de venta corre ANTES que esta puerta — un «sí» que de verdad era para
// comprar lo atiende él y aquí no llega nunca.
console.log("\n— y la marca no dispara sola —\n");
comprobar(
  "un «no» no manda imágenes",
  pickGalleryAfterVisualConsent("no gracias", "¿deseas ver unas imágenes?", galeria, [
    MARCA,
  ]) === null,
  "hace falta afirmar"
);
comprobar(
  "una pregunta de precio tampoco",
  pickGalleryAfterVisualConsent(
    "cuanto cuesta",
    "¿deseas ver unas imágenes?",
    galeria,
    [MARCA]
  ) === null,
  "eso no es un «sí»"
);
comprobar(
  "y con todas las muestras ya vistas, se apaga",
  pickGalleryAfterVisualConsent("si", "¿deseas ver unas imágenes?", galeria, [
    MARCA,
    "muestra-uno",
    "muestra-dos",
  ]) === null,
  "su «una sola vez»"
);
comprobar(
  "sin galería configurada, no hay nada que mandar",
  pickGalleryAfterVisualConsent("si", "¿deseas ver unas imágenes?", [], [MARCA]) ===
    null,
  "«si no hay imágenes no se ofrece»"
);

// ── 4. EL MARCADOR NUNCA LLEGA AL CLIENTE ───────────────────────────────────
//
// Se quita del texto ANTES que ningún otro marcador, porque más abajo hay
// puertas que terminan el turno —Ecuador, el menú de pago— y si el texto saliera
// por una de ellas sin pasar por aquí, el cliente lo vería escrito.
console.log("\n— y el marcador no se le escapa al cliente —\n");
const limpiador = (handler.match(
  /if \(\/<<\\s\*OFRECI_IMAGENES\\s\*>>\/i\.test\(reply\)\) \{[\s\S]{0,600}?\n  \}/
) ?? [""])[0];
comprobar("se intercepta el marcador", limpiador.length > 100);
comprobar(
  "se borra del texto y se anota la oferta",
  /reply\.replace\(\/<<\\s\*OFRECI_IMAGENES\\s\*>>\/gi, ""\)/.test(limpiador) &&
    /markMediaSent\(fresh\.id, MARCA_DE_OFERTA_DE_IMAGENES\)/.test(limpiador),
  "las dos cosas en el mismo sitio"
);
const posicionMarca = handler.indexOf("OFRECI_IMAGENES");
const posicionEcuador = handler.indexOf("<<\\s*PAIS\\s*:\\s*ecuador");
comprobar(
  "y se limpia ANTES de las puertas que cortan el turno",
  posicionMarca > 0 && posicionEcuador > 0 && posicionMarca < posicionEcuador,
  `marca en ${posicionMarca}, Ecuador en ${posicionEcuador}`
);
comprobar(
  "con defensa por si el proveedor corta la respuesta",
  /<\{1,2\}\\s\*OFRECI_IMAGENES/.test(handler),
  "ni medio marcador"
);

console.log(
  `\n${fallos === 0 ? "TODO EN VERDE" : `${fallos} EN ROJO`}\n`
);
process.exit(fallos === 0 ? 0 : 1);
