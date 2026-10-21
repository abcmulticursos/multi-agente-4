// SE EXPLICA POR ESCRITO Y AL FINAL SE OFRECEN LAS IMÁGENES — Y CADA MUESTRA EN
// SU ETAPA.
//
// LO QUE PIDIÓ EL DUEÑO — 17 de septiembre de 2026, con sus palabras:
//
//   «Que a la primera intención del cliente de saber qué contiene, el bot le dé
//    la información como de costumbre, y al final de la explicación le diga
//    "¿deseas ver unas imágenes?". Esto solo lo va a decir cuando haya imágenes
//    en la galería; si no hay imágenes ni check activo no se ofrece, se envía
//    texto y punto. Lo que ocurre es que yo necesitaba que el bot le enseñe las
//    imágenes cuando pregunte, ya que una imagen habla más que mil palabras.»
//
//   «En order bump, en la etapa donde el full está oculto, no enviar la imagen
//    del complementario ni del full; luego de la presentación del order bump ya
//    puede enviar ambas fotos: base, complementario y full, en ese orden.»
//
//   «El envío de imágenes solo se realiza una vez.»
//
// ANTES DE ESTE DISEÑO HUBO TRES QUE NO FUNCIONARON, y están escritos aquí para
// que nadie los repita. Todos intentaban que la imagen SUSTITUYERA al texto:
//
//   1. «Contesta en texto Y manda las imágenes» — el modelo cumplía la orden
//      principal (escribir) y se saltaba la otra. En el prompt, un «además de»
//      pierde siempre contra la orden principal.
//   2. La regla metida en los bloques de -DOU- y -OB-. El dueño probó en LINEAL,
//      que no recibe ninguno de los dos: texto y ninguna imagen. Era la lista
//      que se olvida de una modalidad, ahora en el prompt.
//   3. Quitarle la razón a las tres órdenes que mandaban contestar por escrito,
//      con una salvedad en cada una. Tampoco: seguían compitiendo.
//
// POR QUÉ ESTE SÍ PUEDE FUNCIONAR: no pelea con nada. Las órdenes de contestar
// el contenido por escrito se quedan EXACTAMENTE como estaban, y esta solo AÑADE
// un cierre. No hay dos instrucciones disputándose el turno.
//
//   node scripts/prueba-las-muestras-van-por-etapa.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const llm = readFileSync(join(RAIZ, "src", "lib", "openrouter.ts"), "utf8").replace(
  /\r\n/g,
  "\n"
);

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 56)} ${valor}`);
};

// ── 1. LA EXPLICACIÓN ES DE TEXTO, Y LA OFERTA LA PONE EL MOTOR ─────────────
//
// EL QUINTO DISEÑO, Y EL PRIMERO QUE NO LE PIDE NADA AL MODELO. El cuarto —«al
// cerrar, ofrécele las imágenes»— el dueño lo contó: SALIÓ 4 VECES DE 11. Antes,
// con un marcador, 1 de 6. En un prompt de 8.500 tokens una orden compite con
// todo lo demás y no hay redacción que lo arregle.
const config = readFileSync(join(RAIZ, "src", "lib", "workflow", "config.ts"), "utf8").replace(/\r\n/g, "\n");
const handler = readFileSync(join(RAIZ, "src", "lib", "meta", "handler.ts"), "utf8").replace(/\r\n/g, "\n");

console.log("\n— la oferta la pone el motor, no el modelo —\n");
comprobar(
  "existe la burbuja de oferta en el contenido",
  /export function getSamplesOfferBubble\(\)/.test(config),
  "y no en el prompt"
);
comprobar(
  "admite variantes, no es un texto fijo",
  /return resolveSpintax\(/.test(
    (config.match(/export function getSamplesOfferBubble\(\)[\s\S]{0,700}?\n\}/) ?? [""])[0]
  ),
  "suena distinto cada vez"
);
comprobar(
  "el texto lo manda el dueño desde su contenido",
  /modality_templates\?\.\[mode\]\?\.samples_offer_bubble/.test(config) &&
    /config\?\.samples_offer_bubble/.test(config),
  "modalidad, raíz, y un por defecto"
);
// UN CAMPO VACÍO POR MODALIDAD NO PUEDE TAPAR EL DE LA RAÍZ. Es una trampa que
// en este proyecto ya ha dejado burbujas mudas más de una vez.
comprobar(
  "y un campo vacío no tapa al de más arriba",
  /texto\.trim\(\)\.length > 0/.test(config),
  "gana el primero con texto de verdad"
);
comprobar(
  "sale por la ruta de burbujas que YA existía",
  /await sendChunkedBotText\(fresh, reply, burbujas \?\? undefined\);/.test(handler),
  "no se abre camino nuevo de envío"
);
// Y EL MODELO TIENE PROHIBIDO ESCRIBIRLA, o el cliente vería la pregunta dos
// veces. Es una prohibición, no una tarea: no depende de que se acuerde.
const laProhibicion = (llm.match(
  /CONTENT — DO NOT OFFER IMAGES YOURSELF IN THIS TURN[\s\S]{0,900}?`\);/
) ?? [""])[0];
comprobar("se le prohíbe al modelo ofrecerla él", laProhibicion.length > 100);
comprobar(
  "y se le dice que conteste en texto como siempre",
  /Answer their question in text exactly as you normally would/.test(laProhibicion),
  "la explicación no cambia"
);

// ── LO QUE MATÓ A LOS TRES INTENTOS ANTERIORES: LA COMPETENCIA ──────────────
//
// El intento 3 puso una salvedad en las tres órdenes que mandan contestar el
// contenido por escrito, para que la regla de las imágenes las sobreescribiera.
// Ese diseño se descartó: ahora esas órdenes vuelven a mandar sin excepción, y
// la regla nueva NO las contradice. Si alguien vuelve a meter una salvedad, es
// que está reintentando el diseño que ya falló.
console.log("\n— y no compite con ninguna otra orden del prompt —\n");
comprobar(
  "ninguna orden lleva ya la salvedad del intento anterior",
  !/UNLESS the CONTENT rule about pending sample images/.test(llm),
  "las de texto mandan sin excepción"
);
comprobar(
  "ninguna orden manda escribir NADA MÁS que la imagen",
  !/write NOTHING ELSE in that turn/.test(llm),
  "eso era sustituir el texto"
);
comprobar(
  "PRODUCT CONTENT sigue siendo la fuente de las respuestas",
  /use it for all questions about contents, format, audience, duration, delivery or usage\)/.test(
    llm
  ),
  "intacto, sin salvedades"
);

// ── LA REGLA VIVE EN UN SOLO SITIO, Y LO RECIBEN LAS SEIS ────────────────────
//
// El intento 2 se escribió dentro del bloque de Doble Oferta y del de Order
// Bump, y el dueño probó en LINEAL — que no recibe ninguno de los dos.
console.log("\n— y la decisión vive en un solo sitio, para las seis —\n");
comprobar(
  "la prohibición aparece UNA sola vez",
  (llm.match(/CONTENT — DO NOT OFFER IMAGES YOURSELF IN THIS TURN/g) ?? []).length === 1,
  "una lectura, no una por modalidad"
);
comprobar(
  "y no está dentro de ningún bloque de modalidad",
  /^  if \(tocaOfrecerLasMuestras\) \{$/m.test(llm),
  "sangría de función: la reciben todas"
);
comprobar(
  "la condición son datos del motor, no la modalidad",
  !/isDobleOfertaActive|orderBump\?\.enabled|bioferta\?\.enabled|linearMode/.test(
    (llm.match(/const tocaOfrecerLasMuestras =[\s\S]{0,400}?;/) ?? [""])[0]
  ),
  "muestras pendientes + no ofrecido aún"
);

// ── UNA VEZ POR ETAPA ───────────────────────────────────────────────────────
//
// SU REGLA: «solo se ofrecen luego de la primera consulta, luego puro texto».
// Y en -OB- son DOS etapas: tras el destape vuelve a ofrecer una vez.
console.log("\n— y se ofrece una vez por etapa —\n");
comprobar(
  "la clave se forma con las muestras de la etapa",
  /const claveDeLaEtapa =\s*\n?\s*"__oferta__" \+/.test(llm),
  "no con el nombre de la modalidad"
);
comprobar(
  "y si ya se ofreció en esta etapa, no se repite",
  /const laOfertaYaSeHizoEnEstaEtapa = yaRecibidas\.has\(claveDeLaEtapa\);/.test(llm),
  "de ahí en adelante, texto"
);

// ── LA CAPA 2: LA RED PARA LAS AFIRMACIONES QUE EL MOTOR NO CAZA ────────────
//
// Solo existe en el turno siguiente a la oferta, y no cuesta una llamada de más:
// ese turno ya iba al modelo. Es una pregunta binaria, no un encargo de memoria.
console.log("\n— y la capa 2 solo existe tras la oferta —\n");
const capa2 = (llm.match(
  /CURRENT TURN — YOU JUST OFFERED TO SHOW THE IMAGES[\s\S]{0,1200}?`\);/
) ?? [""])[0];
comprobar("se encuentra la capa 2", capa2.length > 200);
comprobar(
  "vive dentro del `if` de que venía de ofrecer",
  /if \(veniaDeOfrecerLasMuestras\) \{\s*\n\s*add\(`\\n\\nCURRENT TURN — YOU JUST OFFERED/.test(
    llm
  ),
  "no viaja en todos los turnos"
);
comprobar(
  "juzga el significado, no palabras concretas",
  /judge the meaning, never particular words/.test(capa2),
  "sin listas"
);
comprobar(
  "y si NO acepta, contesta normal",
  /ignore this rule completely and answer them normally/.test(capa2),
  "no deja al cliente colgado"
);

// ── LA HERRAMIENTA Y LA CAPA 2 NO SE CONTRADICEN ───────────────────────────
console.log("\n— y la herramienta está de acuerdo con la capa 2 —\n");
const herramienta = (() => {
  const i = llm.indexOf("const SEND_PRODUCT_INFO_TOOL");
  return i < 0 ? "" : llm.slice(i, i + 3000);
})();
comprobar(
  "la herramienta admite el caso de la capa 2",
  /a CURRENT TURN instruction tells you they are accepting an offer/.test(
    herramienta
  ),
  "si no, una prohibiría lo que la otra manda"
);
comprobar(
  "y no para responder qué contiene el producto",
  /content questions are answered in text/.test(herramienta),
  "eso es texto"
);
comprobar(
  "nunca ante precio, pago ni tiempo de entrega",
  /NEVER for a price, payment or delivery-timing intent/.test(herramienta),
  "intacto"
);
const bloqueMedia = (llm.match(
  /MEDIA GALLERY — you can send[\s\S]{0,3000}?`\);/
) ?? [""])[0];
comprobar(
  "y el bloque de una foto suelta está de acuerdo",
  /IF CONFIGURED SAMPLES ARE STILL PENDING, do NOT send a single item from here/.test(
    bloqueMedia
  ),
  "las dos puntas, lo mismo"
);

// ── 2. CADA MUESTRA EN SU ETAPA ─────────────────────────────────────────────
console.log("\n— y el producto oculto sigue oculto —\n");
comprobar(
  "hay UNA sola función que dice si sigue oculto",
  (llm.match(/function elOrderBumpSigueOculto\(/g) ?? []).length === 1,
  "un dato, no dos lecturas"
);
const usos = llm
  .split("\n")
  .filter((l) => {
    const t = l.trim();
    if (!t.includes("elOrderBumpSigueOculto")) return false;
    if (t.startsWith("//") || t.startsWith("*")) return false;
    return !t.startsWith("function ");
  }).length;
comprobar(
  "y la usan los DOS caminos de imágenes",
  usos >= 2,
  `${usos} usos: la galería del prompt y la secuencia`
);
comprobar(
  "la secuencia ya no pide la galería sin filtrar",
  !/const gallery = getImageGallery\(false, convo\);/.test(llm),
  "ese `false` dejaba salir la oculta"
);
comprobar(
  "sino excluyendo lo que todavía no le toca",
  /const gallery = getImageGallery\(elOrderBumpSigueOculto\(convo\), convo\);/.test(
    llm
  ),
  "la regla dura de order bump"
);
// DESPUÉS DE LA COMPRA NO HAY NADA QUE DESTAPAR: manda la postventa.
comprobar(
  "y después de la compra deja de estar oculto",
  /const postVenta =[\s\S]{0,300}?if \(postVenta\) return false;/.test(llm),
  "ahí manda la postventa"
);

// ── 3. «YA ENVIADAS» ES POR ETAPA, NO PARA SIEMPRE ──────────────────────────
console.log("\n— y el freno de «ya enviadas» entiende de etapas —\n");
comprobar(
  "mira si queda alguna muestra de ESTA etapa sin ver",
  /const leQuedaAlgunaMuestraPorVer = muestrasDeEstaEtapa\.some\(/.test(llm),
  "no solo la marca de la tanda"
);
comprobar(
  "comparando en minúsculas, que es como se guardan",
  /!yaRecibidas\.has\(muestra\.topic\.toLowerCase\(\)\)/.test(llm),
  "si no, el freno no actuaría nunca"
);
comprobar(
  "y el freno sigue actuando cuando ya las vio todas",
  /yaRecibidas\.has\("__product_info_sequence__"\) &&\s*\n?\s*!leQuedaAlgunaMuestraPorVer;/.test(
    llm
  ),
  "lineal y doble oferta, igual que antes"
);
// UN DATO, UNA LECTURA. La etapa se calcula UNA vez y la usan el freno y la
// regla de la oferta. Si cada uno la mirara por su cuenta acabarían discrepando.
comprobar(
  "y la etapa se calcula una sola vez, arriba",
  /const muestrasDeEstaEtapa = convo \? getImageGallery\(orderBumpHidden, convo\) : \[\];/.test(
    llm
  ),
  "la usan el freno y la regla"
);

// ── 4. LO QUE NO SE PUEDE HABER ROTO ────────────────────────────────────────
console.log("\n— y lo que estaba bien sigue igual —\n");
comprobar(
  "sin galería configurada, no se ofrecen imágenes",
  /MEDIA AVAILABILITY: there are NO configured images\/videos available for this turn\. Do NOT offer to send images/.test(
    llm
  ),
  "su regla, intacta"
);
comprobar(
  "después de la compra no se reabre la presentación",
  /post_sale_content_blocked/.test(llm),
  "intacto"
);
comprobar(
  "y el otro camino de imágenes sigue mirando la etapa",
  /const gallery = getImageGallery\(orderBumpHidden, convo\);/.test(llm),
  "intacto"
);

console.log(`\n${fallos === 0 ? "TODO EN VERDE" : `${fallos} EN ROJO`}\n`);
process.exit(fallos === 0 ? 0 : 1);
