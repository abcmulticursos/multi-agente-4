import crypto from "node:crypto";
import {
  cancelPendingActionsByTypeForConvo,
  fijarPresentacionDeVentaSiFalta,
  fijarTiendaPorFraseSiFalta,
  marcarAvisoDeActualizacionEnviado,
  getConversationById,
  getLatestUserMessage,
  getOrCreateConversation,
  getRecentHistory,
  insertMessage,
  insertMessageWithMedia,
  isNumberBlocked,
  listMetaWhatsAppConnections,
  markMessageProcessed,
  setConversationAdReferral,
  setConversationWaPhoneNumberId,
  updateMessageStatus,
  wasMessageProcessed,
  getSentMedia,
  markMediaSent,
  blockNumber,
  sumarStrike,
  type ConversationRow,
  type MediaPayload,
  type WaStatus,
} from "@/lib/db";
import { evaluarModeracion } from "@/lib/workflow/moderation";
import { vinoDeAnuncio } from "@/lib/origen-de-lead";
import {
  generateReply,
  seLePidioOfrecerImagenesEnElTurnoAnterior,
  olvidarLaOfertaDeImagenes,
} from "@/lib/openrouter";
import { markMessageRead, sendTextMessage } from "@/lib/meta/client";
import { downloadMediaFromMeta, esComprobantePdf } from "@/lib/meta/media";
import {
  getOutboundWhatsAppNumber,
  getWhatsAppRuntimeConfig,
  withOutboundWhatsAppNumber,
} from "@/lib/meta/runtime-config";
import { transcribeAudio } from "@/lib/transcription";
import {
  acceptGiftConsent,
  claimGiftReward,
  declineGiftConsent,
  deliverDobleOfertaPaymentDetails,
  aceptarElExtraComoLoEscribioElDueno,
  offerComboUpgrade,
  enviarAvisoDeActualizacion,
  resendPaymentDetails,
  unTextoLlevaLosDatosParaPagar,
  sendChunkedBotText,
  getOrderBumpChoiceHelperBubbles,
  sendSamplesAfterContent,
  sendCountryRedirect,
  sendPaymentOffer,
  tryWorkflowOnIncoming,
} from "@/lib/workflow/engine";
import {
  sendBotMediaFromDrive,
  sendBotText,
  enviarMuestraDeGaleria,
} from "@/lib/workflow/sender";
import { handleMessengerCountryGate } from "@/lib/workflow/messenger-country";
import {
  getDistrustMessage,
  getActiveTwoTierOffer,
  getImageGallery,
  getProductInfoTopics,
  getProgressiveSamplesConfig,
  isPriceQuestion,
  loadWorkflowConfig,
  isDobleOfertaActive,
  seccionUpsell,
  freezePricesForConvo,
  hayQueAvisarDeLaActualizacion,
  isOrderBumpActive,
  laPresentacionConLaQueNace,
  conLaPresentacionDeLaConversacion,
  conLaTiendaDelTurno,
  laTiendaDeLaConversacion,
  tiendaPorFraseDeEntrada,
  conElTurnoDe,
  getActiveModalityKey,
  getPaymentMethods,
  getSamplesOfferBubble,
} from "@/lib/workflow/config";
import { resendApprovedMaterial } from "@/lib/workflow/payment";
import { overrideResumenInNocodb, syncLeadStatus } from "@/lib/leads-sync";
import { marcaDeAdjunto } from "@/lib/marca-de-adjunto";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** La galería comercial siempre termina con un siguiente paso claro. */
async function sendSamplesClosing(convo: import("@/lib/db").ConversationRow): Promise<void> {
  await sendSamplesAfterContent(convo);
}

/**
 * La confirmacion corta ("si", "dale") no debe saltarse la preferencia del
 * editor. Con "todas juntas" activo, usa exactamente los temas marcados en
 * Info de contenido y respeta su orden; apagado conserva una sola muestra.
 */
async function sendGalleryAfterVisualConsent(
  convo: import("@/lib/db").ConversationRow,
  fallbackItem: NonNullable<ReturnType<typeof pickGalleryAfterVisualConsent>>,
  gallery: ReturnType<typeof getImageGallery>
): Promise<string[]> {
  const progressive = getProgressiveSamplesConfig();
  const alreadySent = new Set(
    getSentMedia(convo.id).map((topic) => topic.toLowerCase())
  );
  // EL ORDEN LO MANDA LA GALERÍA, NO LA LISTA DE TEMAS.
  //
  // Esto recorría `product_info_topics` y buscaba cada tema en la galería, así
  // que las mandaba en el orden en que estuvieran escritos los temas — y ahí se
  // perdía la regla de orden del dueño: «siempre arrancando desde el BÁSICO, si
  // hay un COMPLEMENTARIO sigue ese, y si hay un FULL que aparezca AL ÚLTIMO»
  // (commit `a806230`). Con su contenido de hoy en -DOU- eso significaba mandar
  // el FULL primero y el básico después, justo al revés.
  //
  // Se recorre la GALERÍA, que ya viene ordenada por puesto, y se queda con las
  // que él tenga marcadas. El conjunto es exactamente el mismo: solo cambia el
  // orden, que es el que él pidió.
  const seleccionados = new Set(
    getProductInfoTopics().map((topic) => topic.toLowerCase())
  );
  const selectedItems = gallery
    .filter((item) => seleccionados.has(item.topic.toLowerCase()))
    .filter((item) => !alreadySent.has(item.topic.toLowerCase()));

  const items = progressive.enabled
    ? [fallbackItem]
    : selectedItems.length > 0
      ? selectedItems
      : [fallbackItem];
  const sent: string[] = [];
  for (const item of items) {
    if (sent.some((topic) => topic.toLowerCase() === item.topic.toLowerCase())) {
      continue;
    }
    await enviarMuestraDeGaleria(convo, item);
    markMediaSent(convo.id, item.topic);
    sent.push(item.topic);
  }
  return sent;
}

function buildDebouncedWorkflowContent(
  conversationId: number,
  fallback: string,
  debounceSec: number
): string {
  const history = getRecentHistory(conversationId, 12);
  const newestUser = [...history].reverse().find((item) => item.role === "user");
  if (!newestUser) return fallback;

  const windowSec = Math.max(10, debounceSec + 2);
  const block: string[] = [];
  for (const message of [...history].reverse()) {
    if (message.role !== "user") break;
    if (newestUser.created_at - message.created_at > windowSec) break;
    const text = message.content.trim();
    if (text) block.push(text);
    if (block.length >= 6) break;
  }

  return block.reverse().join("\n").trim() || fallback;
}

function shouldSuppressDuplicatePriceReply(
  conversationId: number,
  currentText: string
): boolean {
  if (!isPriceQuestion(currentText)) return false;
  const history = getRecentHistory(conversationId, 12);
  const newestUser = [...history].reverse().find((item) => item.role === "user");
  if (!newestUser) return false;
  const previousPriceUser = [...history]
    .reverse()
    .find(
      (item) =>
        item.role === "user" &&
        item.id !== newestUser.id &&
        newestUser.created_at - item.created_at <= 45 &&
        isPriceQuestion(item.content)
    );
  if (!previousPriceUser) return false;
  return history.some(
    (item) =>
      item.role === "assistant" &&
      item.id > previousPriceUser.id &&
      item.id < newestUser.id &&
      Math.floor(Date.now() / 1000) - item.created_at <= 60 &&
      looksLikeDirectPriceAnswer(item.content) &&
      /\b(s\/\.|soles?|precio|inversion|inversi[oó]n)\b/i.test(item.content)
  );
}

function looksLikeDirectPriceAnswer(content: string): boolean {
  const normalized = content
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "");
  const hasDirectPricePhrase =
    /\b(la\s+inversion\s+es|la\s+inversion\s+queda|el\s+precio\s+es|son\s+\*?\s*(s\/\.|\$|usd|pen)?|cuesta|vale)\b/.test(
      normalized
    ) || /\b(s\/\.|\$|usd|pen)\s*\d+/.test(normalized);
  const hasSalesCta =
    /\b(quieres|deseas|te\s+indico|te\s+paso|te\s+muestro|como\s+adquir|como\s+pagar|metodo\s+de\s+pago|proceder)\b/.test(
      normalized
    );
  return hasDirectPricePhrase && hasSalesCta;
}

function normalizeGalleryKey(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function shouldPreferVideoForGallery(
  inboundText: string,
  replyText: string
): boolean {
  const haystack = `${inboundText} ${replyText}`.toLowerCase();
  return (
    /\bvideo\b/.test(haystack) ||
    /\b(verlo|verlo\?|verlo\.|quiero verlo|quiero ver|muestrame|mu[eé]strame)\b/.test(
      haystack
    )
  );
}

function resolveGalleryItem(
  gallery: ReturnType<typeof getImageGallery>,
  topic: string,
  inboundText: string,
  replyText: string
): (typeof gallery)[number] | undefined {
  const normalizedTopic = normalizeGalleryKey(topic);
  const exact = gallery.find(
    (item) => normalizeGalleryKey(item.topic) === normalizedTopic
  );
  if (!shouldPreferVideoForGallery(inboundText, replyText)) return exact;

  const videoCandidate = gallery.find((item) => {
    if (item.media_type !== "video") return false;
    const normalizedItemTopic = normalizeGalleryKey(item.topic);
    return (
      normalizedItemTopic === normalizedTopic ||
      normalizedItemTopic.startsWith(`${normalizedTopic} video`) ||
      normalizedItemTopic.startsWith(normalizedTopic) ||
      normalizedTopic.startsWith(normalizedItemTopic)
    );
  });
  return videoCandidate ?? exact;
}

/**
 * ¿EL CLIENTE PIDIÓ CAMBIAR DE MÉTODO DE PAGO?
 *
 * Vive en un solo sitio porque la usan las DOS puertas que deciden lo mismo: la
 * del marcador `<<METODOS_PAGO>>` y la que revisa el texto del bot antes de
 * enviarlo. Con una copia en cada una, un día una diría que sí y la otra que no.
 */
function elClientePidioCambiarDeMetodo(text: string): boolean {
  return /\b(cambiar|cambio|cambia|otro|otra)\b[\s\S]*\b(metodo|pago|yape|plin|bcp|transferencia)\b/i.test(
    text
  );
}

/**
 * ¿LA RESPUESTA DEL BOT VUELVE A PEDIR QUE ELIJA MÉTODO DE PAGO?
 *
 * NO SE ADIVINAN FRASES. Se mira una señal que sale de TU configuración: para
 * preguntar «¿cuál prefieres?» hay que NOMBRAR los métodos. Así que si la
 * respuesta nombra DOS O MÁS de los métodos configurados para el país de este
 * cliente y además pregunta algo, está ofreciendo el menú.
 *
 * Por eso esto no envejece: el día que cambies los métodos en el panel, esta
 * función cambia con ellos sola. No hay ni un nombre de método escrito aquí.
 *
 * Dos condiciones, y las dos hacen falta:
 *  · DOS o más. Con uno solo puede estar confirmando el que ya eligió
 *    («perfecto, con Yape entonces»), que es lo correcto y no se toca.
 *  · Y una pregunta. Sin interrogación está informando, no pidiendo que elija.
 */
function laRespuestaVuelveAPedirElMetodo(
  reply: string,
  phone: string | null | undefined
): boolean {
  if (!/[?¿]/.test(reply)) return false;
  const texto = ` ${normalizeGalleryKey(reply)} `;
  const nombrados = getPaymentMethods(phone).filter((metodo) =>
    [metodo.label, ...(metodo.aliases ?? [])].some((termino) => {
      const clave = normalizeGalleryKey(termino ?? "");
      return clave.length >= 3 && texto.includes(` ${clave} `);
    })
  );
  return nombrados.length >= 2;
}

/**
 * LO QUE EL BOT YA HABÍA CONTESTADO, ANTES DE PEDIR EL MÉTODO DE MÁS.
 *
 * EL FALLO, VISTO EN UNA PRUEBA REAL. El cliente ya tenía Yape y sus datos
 * delante, y preguntó «se paga mensual». El modelo le contestó bien —es un pago
 * único— y remató pidiéndole otra vez el método. La puerta de abajo hizo lo suyo
 * y no dejó salir esa pregunta… pero se llevó por delante la respuesta entera:
 * el cliente vio los datos repetidos y su duda sin contestar.
 *
 * El comentario de esa puerta ya decía lo correcto —«esa frase no sale y salen
 * sus datos»—; lo que faltaba era distinguir la frase que sobra del resto.
 *
 * CÓMO SE SEPARA, Y POR QUÉ ASÍ. Se conserva lo que va ANTES de la primera
 * frase que abre una pregunta o nombra un método. Eso es la respuesta a la duda,
 * en las palabras del modelo.
 *
 * No se corta frase a frase a propósito: un «Tenemos Yape y Plin. ¿Cuál
 * prefieres?» se escaparía —la primera nombra dos métodos pero no pregunta, la
 * segunda pregunta pero no nombra ninguno— y saldría justo lo que la puerta
 * existe para frenar. Cortando por delante, el freno queda intacto.
 *
 * Si no queda nada con sustancia, devuelve cadena vacía y la puerta se comporta
 * exactamente como hasta hoy. El peor caso de esto es el comportamiento actual.
 *
 * SE LE PASA EL TEXTO YA SIN MARCADORES. `stripMarkers` vive dentro del handler,
 * y los marcadores no pueden llegar al cliente: se limpian en la llamada, igual
 * que hacen las otras puertas del archivo.
 */
/**
 * ¿LOS DATOS PARA PAGAR SIGUEN EN PANTALLA?
 *
 * Mira el ÚLTIMO TURNO del bot: todas las burbujas que mandó seguidas, hasta el
 * mensaje anterior del cliente. Si alguna lleva la cuenta, el cliente la tiene
 * delante y reenviarla es repetirse.
 *
 * SE MIRA EL TURNO Y NO LA ÚLTIMA BURBUJA, y es la diferencia que importa: sus
 * datos de pago salen en dos burbujas —la cuenta, y detrás «una vez realizado
 * nos envías la imagen»—. Mirando solo la última, la de la cuenta se queda fuera
 * y el freno no serviría para nada.
 *
 * SE PREGUNTA POR EL DATO, no por la redacción: `unTextoLlevaLosDatosParaPagar`
 * busca el comodín del cajón de pago o una tirada larga de dígitos. Vive en el
 * motor y se comparte a propósito, para que las dos puertas no puedan tener
 * ideas distintas de qué es «llevar los datos».
 */
function losDatosSiguenEnPantalla(conversationId: number): boolean {
  // ── NO SOLO EL ÚLTIMO TURNO: TODO LO RECIENTE ──────────────────────────
  //
  // LO QUE PASÓ — 2 de octubre de 2026. El cliente ya tenía la cuenta, escribió «si pero
  // no me van a estafar», y el bot le soltó la cuenta otra vez. Con sus palabras: «pero yo
  // no he pedido datos… ¿por qué tiene que soltar datos?».
  //
  // Y TENÍA RAZÓN. La puerta de arriba mira lo que el BOT va a decir, no lo que preguntó
  // el cliente. Vio que el modelo iba a pedir un método ya elegido y razonó «quiere pagar
  // → dale los datos». Falso: estaba desconfiando.
  //
  // Mirar al cliente para distinguirlo llevaría a una lista de palabras, que es lo que
  // esta casa tiene prohibido. Así que se corrige por el otro lado, que sí es un dato:
  // ¿SE LOS ACABO DE DAR?
  //
  // ANTES SE MIRABA UN SOLO TURNO y por eso no servía: entre la cuenta y su pregunta se
  // habían metido un seguimiento y una respuesta, así que los datos quedaron dos turnos
  // atrás y el freno los dio por perdidos. En una conversación real SIEMPRE se mete algo
  // en medio.
  //
  // VEINTE MENSAJES es «hace un rato» en un chat: lo que cabe en una pantalla de teléfono
  // sin desplazarse mucho. Si el cliente los recibió dentro de esa ventana, los tiene, y
  // repetirlos es ruido. Más allá, la conversación ya se fue a otra parte y volver a
  // dárselos sí ayuda.
  //
  // Y NO DEJA A NADIE SIN DATOS: quien los pida de verdad los recibe por su propio camino
  // —el reenvío explícito, el «no me llegó»— que no pasa por aquí.
  const historia = [...getRecentHistory(conversationId, 20)].reverse();
  // PRIMERO SE SALTA LO QUE ACABA DE ESCRIBIR EL CLIENTE.
  //
  // LO QUE PASÓ — 2 de octubre de 2026, su conversación HOLAp1. Escribió «HOLA» y el bot
  // le soltó los datos de pago encima, con sus palabras: «¿qué carajos está pasando?».
  //
  // Y ESTE FRENO EXISTÍA PARA IMPEDIR EXACTAMENTE ESO. Se puso el 28/09 cuando él dijo
  // «me lanzó los datos de pago». Nunca llegó a funcionar: no fallaba a veces, fallaba
  // SIEMPRE.
  //
  // EL MOTIVO, medido ejecutando esta misma función:
  //
  //     con el mensaje del cliente guardado : false
  //     sin el mensaje del cliente          : true
  //
  // El mensaje entrante se guarda en cuanto llega —línea ~1393—, y esta puerta pregunta
  // mucho después. Así que al mirar hacia atrás, lo PRIMERO que encontraba era el mensaje
  // del cliente, cortaba ahí y devolvía «no están en pantalla» sin haber mirado una sola
  // burbuja del bot.
  //
  // SE RECORRE LA VENTANA ENTERA, SIN PARARSE EN EL PRIMER MENSAJE DEL CLIENTE.
  //
  // Antes el recorrido cortaba ahí, y por eso solo leía el ÚLTIMO turno del bot. Era el
  // mismo fallo dos veces: primero cortaba en el mensaje que el cliente acaba de escribir
  // —y entonces no leía nada—, y después cortaba en el anterior, así que ensanchar la
  // ventana no habría servido de nada.
  //
  // Ahora la pregunta es la que de verdad importa: «¿le di la cuenta hace poco?», no «¿fue
  // lo último que dije?».
  return historia.some(
    (mensaje) =>
      mensaje.role === "assistant" &&
      unTextoLlevaLosDatosParaPagar(mensaje.content ?? "")
  );
}

function loQueElBotYaRespondio(
  reply: string,
  phone: string | null | undefined
): string {
  const claves = getPaymentMethods(phone)
    .flatMap((metodo) => [metodo.label, ...(metodo.aliases ?? [])])
    .map((termino) => normalizeGalleryKey(termino ?? ""))
    .filter((clave) => clave.length >= 3);
  const nombraUnMetodo = (fragmento: string): boolean => {
    const texto = ` ${normalizeGalleryKey(fragmento)} `;
    return claves.some((clave) => texto.includes(` ${clave} `));
  };
  // UN PUNTO PEGADO A UN NÚMERO NO TERMINA UNA FRASE.
  //
  // LO QUE SE MIDIÓ el 28/09/2026, buscando otra cosa: este partidor corta en
  // CADA punto, y los importes llevan puntos dentro. Con su moneda:
  //
  //     «...tiene un precio de *S/. 10 SOLES*»  →  «...de *S/. »  +  «10 SOLES*»
  //     «Cuesta $ 9.500 ARS»                    →  «Cuesta $ 9.»  +  «500 ARS»
  //
  // El importe queda partido en dos, así que cualquier regla que descarte un
  // trozo puede quedarse con el símbolo y tirar el número — o quedarse con el
  // «9» de un «9.500». Un precio a medias en una venta es de lo peor que puede
  // salir, y no hacía falta que pasara para arreglarlo.
  //
  // SE PROTEGE EL PUNTO, NO SE CAMBIA EL PARTIDOR. Un punto seguido de un
  // número no cierra frase: se aparta antes de partir y se devuelve después, así
  // que lo que sale es LETRA POR LETRA lo que escribió el modelo.
  //
  // Y NO PUEDE PEGAR UNA FRASE A LA PREGUNTA DEL MÉTODO, que es lo único
  // peligroso: esa pregunta empieza por una palabra, nunca por una cifra. Lo
  // más que puede unir son dos frases inocentes, y eso no cambia nada.
  const PUNTO_DE_UN_IMPORTE = "";
  const devolverElPunto = (trozo: string): string =>
    trozo.split(PUNTO_DE_UN_IMPORTE).join(".");
  const protegido = reply.replace(/\.(?=\s*\d)/g, PUNTO_DE_UN_IMPORTE);
  // Trozos de frase conservando su puntuación y sus espacios: al pegarlos no se
  // pierde ni se altera nada de lo que escribió el modelo.
  const fragmentos = protegido.match(/[^.!?\n]+[.!?]*\s*/g) ?? [];
  const conservados: string[] = [];
  for (const fragmento of fragmentos) {
    // SE CORTA EN EL PRIMER MÉTODO NOMBRADO, Y YA NO EN CUALQUIER PREGUNTA.
    //
    // LO QUE PASÓ — 28 de septiembre de 2026, su prueba HOLAP1. El cliente
    // preguntó «es seguro» con la cuenta ya en pantalla. El modelo le contestó
    // bien y remató pidiéndole el método; esta función cortaba en el primer
    // trozo con signo de interrogación, y la tranquilización venía justo
    // después. Al cliente le llegó «¡Entiendo tu pregunta!» y nada más — su
    // duda sin contestar.
    //
    // POR QUÉ ES SEGURO QUITAR EL SIGNO DE PREGUNTA DE ESTE CORTE, y es un
    // candado de quien llama, no una opinión: aquí solo se entra cuando
    // `laRespuestaVuelveAPedirElMetodo` dice sí, y ésa exige que la respuesta
    // NOMBRE DOS O MÁS de los métodos configurados. El menú del método no
    // existe sin sus nombres. Cortando en el primero, ninguno puede
    // sobrevivir — así que tampoco puede sobrevivir el menú.
    //
    // Y EL CASO QUE PUSO ESTA REGLA SIGUE IGUAL. «Tenemos Yape y Plin. ¿Cuál
    // prefieres?»: el primer trozo ya nombra métodos, así que se corta ahí y no
    // se conserva nada, exactamente como hasta hoy. Ver la comprobación de
    // abajo, que lo deja por escrito en el código.
    if (nombraUnMetodo(devolverElPunto(fragmento))) break;
    conservados.push(fragmento);
  }
  // Y LA PREGUNTA DEL FINAL SE TIRA, SI LA HAY.
  //
  // Es la otra mitad de quitar el signo de pregunta de arriba, y la puso una
  // prueba en rojo: «¿Con cuál pagas? Tenemos X y Z.» corta en el segundo trozo
  // —el que nombra los métodos— y conservaba el primero… que ES la pregunta del
  // método, escrita sin nombrarlos. Justo lo que esta puerta existe para frenar.
  //
  // La distinción es de SITIO, no de palabras: una pregunta pegada al menú forma
  // parte del menú; una pregunta en medio, con su respuesta detrás, es del
  // cliente y se contesta. Tirando solo las del final, las dos quedan bien.
  //
  // Lo que sale de aquí no nombra ningún método y no acaba en pregunta, así que
  // no se puede leer como «elige tu método».
  while (
    conservados.length > 0 &&
    /[?¿]/.test(conservados[conservados.length - 1])
  ) {
    conservados.pop();
  }
  const conservado = conservados.join("");
  // LO QUE ANUNCIA LA LISTA NO ES UNA RESPUESTA.
  //
  // LO QUE COSTÓ, el 22/09/2026. El cliente preguntó «no hay rebaja» y el modelo
  // contestó «¡Claro! 😊 Los métodos de pago disponibles son: …». Esta función
  // corta al llegar al primer método, así que salvó «¡Claro! 😊 Los métodos de
  // pago disponibles son» y se lo mandó tal cual. Una frase cortada a la mitad,
  // que no contesta nada y encima anuncia una lista que ya no va a salir.
  //
  // NO SE MIRA QUÉ DICE, SE MIRA SI TERMINA. Una respuesta de verdad cierra su
  // frase con punto, cierre de admiración o de interrogación. Un anuncio de lo
  // que viene detrás se corta en el sitio donde empezaba la lista —dos puntos,
  // un salto de línea— y llega aquí sin puntuación final. Ese último trozo
  // inacabado se suelta; lo que quedó cerrado antes se conserva entero. Así no
  // hay ninguna lista de frases que mantener, y da igual cómo lo redacte el
  // modelo la próxima vez.
  const cerrados = conservado.match(/[^.!?\n]+[.!?]+\s*/g) ?? [];
  const conservado2 = cerrados.join("");
  // Y AQUÍ SE DEVUELVEN LOS PUNTOS DE LOS IMPORTES, justo antes de mirar y de
  // entregar: lo que sale es el texto del modelo tal cual.
  const limpio = devolverElPunto(conservado2 || conservado).trim();
  // Con sustancia: que quede una frase de verdad y no un resto de puntuación.
  if (!(limpio.length >= 12 && /\p{L}/u.test(limpio))) return "";
  // EL CERROJO, Y AQUÍ NO SE OPINA: SE PREGUNTA.
  //
  // Lo que se conserva se pasa por la MISMA función que decidió que había que
  // frenar. Si lo que va a salir sigue siendo una petición de método, no sale
  // nada y la puerta se comporta como antes de todo esto.
  //
  // Es lo que hace imposible aflojar este recorte por accidente: el día que
  // alguien lo toque, esta línea se lo dice.
  return laRespuestaVuelveAPedirElMetodo(limpio, phone) ? "" : limpio;
}

function isCommerceOrPriceQuestion(text: string): boolean {
  const normalized = normalizeGalleryKey(text);
  return (
    isPriceQuestion(text) ||
    /\b(caro|cara|barato|barata|economico|economica|precio|precios|pago|pagar|yape|plin|bcp|transferencia|tarjeta|cuenta|metodo|metodos|opcion|opciones|combo|basico)\b/.test(
      normalized
    )
  );
}

/**
 * ¿ESTO ES UN «SÍ» A LAS IMÁGENES QUE EL BOT ACABA DE OFRECER?
 *
 * DÓNDE SE USA, QUE ES LO QUE LA HACE SEGURA: en UN solo sitio, la puerta de las
 * imágenes, y esa puerta solo se abre si el motor acaba de ofrecerlas, quedan
 * muestras sin ver y hay galería. Además el motor de venta corre ANTES, así que
 * un «sí» que era para comprar lo atiende él y aquí no llega nunca. No toca ni
 * métodos de pago ni elección de producto: esos van por otros detectores.
 *
 * POR ESO AQUÍ SÍ VALE UNA LISTA, y no contradice la regla del dueño: en su
 * CLAUDE.md la lista de palabras se prohíbe como REGLA ENTERA, y se permite como
 * desempate DENTRO de una regla estructural. Esta lo es.
 *
 * LO QUE FALTABA, medido por él en vivo: «me sugirió la imagen, le dije "está
 * bien" y no la aceptó como decisión». Tenía razón — `esta bien` no estaba, y
 * `ya envieme` tampoco, porque la lista tenía `ya` SOLA. Se añaden esas y sus
 * hermanas obvias.
 *
 * Y NO SE CONFÍA TODO A ESTA LISTA, porque crecería sin freno cada semana: lo que
 * no entre aquí lo resuelve el modelo en el turno siguiente, sin coste extra —ese
 * turno ya iba al modelo—. Ver la CAPA 2 en `openrouter.ts`.
 */
function isShortVisualConsent(text: string): boolean {
  const normalized = normalizeGalleryKey(text).replace(/\s+/g, " ");
  if (!normalized || normalized.length > 40) return false;
  return (
    /^(s|si|si por favor|si claro|claro|claro que si|dale|ok|okay|oki|vale|ya|ya dale|ya pues|bueno|listo|perfecto|genial|obvio|por supuesto|de una|va|esta bien|estabien|me gustaria|quiero|quiero verlas|quiero verlos|manda|mandala|mandalas|enviala|envialas|pasala|pasalas|muestrame|muestramelas|quiero verla|quiero verlo)$/.test(
      normalized
    ) ||
    /^si\b/.test(normalized) ||
    /^(esta bien|ya envia|ya enviame|ya envieme|ya manda|ya mandame|ya mandeme|ya muestra|ya muestrame|bueno dale|claro que|por supuesto|me gustaria|quiero ver)\b/.test(
      normalized
    ) ||
    /^(manda|mandame|mandeme|envia|enviame|envieme|pasa|pasame|paseme|muestra|muestrame|muestreme|ensena|ensename|enseneme)\b/.test(
      normalized
    )
  );
}

/**
 * ¿EL BOT LE CONTESTA A ESTA CONVERSACIÓN?
 *
 * Devuelve false solo en un caso: el interruptor `no_responder_organicos` está
 * encendido Y esta conversación no vino de un anuncio.
 *
 * POR QUÉ.
 *
 * Desde el 1 de octubre de 2026 Meta cobra POR MENSAJE todo lo que el bot envía
 * dentro de la ventana de 24 horas. Recibir es gratis; se paga lo que sale. La
 * excepción es quien llegó por un anuncio de clic a WhatsApp o por el botón de
 * una página de Facebook: ahí la ventana de 72 horas es gratis entera.
 *
 * Callar no cuesta nada y no pierde nada: el mensaje del cliente ya está
 * guardado y la conversación sigue en la bandeja para atenderla a mano.
 *
 * EL GUARDIA: QUIEN YA PAGÓ SE ATIENDE SIEMPRE.
 *
 * `paid_at` manda sobre el interruptor. El que compró ayer por un anuncio y hoy
 * escribe pidiendo su material llega SIN el origen del anuncio, porque la
 * conversación es otra. Callarle no sería ahorrar: sería dejar tirado al único
 * cliente que ya soltó el dinero, y romper el modo de entregar.
 *
 * Lo mismo vale para quien está a mitad del pago: si mandó el comprobante y el
 * bot se calla, el cobro se cae con el dinero ya transferido.
 */
/**
 * LAS HORAS TRAS LAS QUE EL BOT YA NO CONTESTA A NADIE.
 *
 * LO PIDIÓ EL DUEÑO — 3 de octubre de 2026: «dale la capacidad que cualquier persona que
 * ingresó jamás reciba respuesta luego de las 72 horas. Esto para evitar gastos de pago de
 * Meta por las nuevas reglas, si es posible a las 70 horas».
 *
 * POR QUÉ 70 Y NO 72. La ventana gratis de quien llega por un anuncio de clic a WhatsApp o
 * por el botón de una página dura 72 horas. A las 70 queda margen: una respuesta que se
 * empieza a preparar en la hora 71 y sale en la 72 ya se cobra.
 *
 * SIN NINGUNA EXCEPCIÓN, Y LO DECIDIÓ ÉL. Se le advirtió que esto deja fuera también al que
 * YA PAGÓ —el que compró y a las 80 horas escribe «no me llegó mi material» se queda sin
 * respuesta— y lo confirmó con estas palabras: «para todos sin excepción que ya no responda
 * a partir de las 70 horas». Queda escrito aquí para que nadie lo tome por un olvido.
 *
 * SE CUENTA DESDE QUE NACIÓ LA CONVERSACIÓN, que es cuando Meta abre esa ventana.
 *
 * CALLAR NO PIERDE EL MENSAJE: el del cliente ya se guardó antes de llegar aquí, y la
 * conversación sigue en la bandeja para atenderla a mano. En el chat del panel sale un
 * aviso diciendo que pasaron las 70 horas.
 */
const HORAS_PARA_DEJAR_DE_RESPONDER = 70;

/** ¿Esta conversación ya pasó de las 70 horas? Lo usan el bot y el panel. */
export function pasoLaVentanaDeRespuesta(
  convo: { created_at?: number | null } | null | undefined,
  ahoraSeg: number = Math.floor(Date.now() / 1000)
): boolean {
  const nacio = convo?.created_at;
  if (typeof nacio !== "number" || !(nacio > 0)) return false;
  return ahoraSeg - nacio >= HORAS_PARA_DEJAR_DE_RESPONDER * 3600;
}

function leContestamos(convo: ConversationRow): boolean {
  // LA VENTANA VA PRIMERO: manda sobre todo lo demás, incluido quien ya pagó. Ver arriba.
  if (pasoLaVentanaDeRespuesta(convo)) {
    console.log(
      `[wh] convo ${convo.id}: pasaron las ${HORAS_PARA_DEJAR_DE_RESPONDER} horas desde que entró — no contesto (su mensaje queda guardado)`
    );
    return false;
  }
  if (loadWorkflowConfig()?.no_responder_organicos !== true) return true;
  if (vinoDeAnuncio(convo)) return true;
  if (convo.paid_at) return true;
  // SI EL BOT YA LE HABLÓ, SIGUE HABLÁNDOLE.
  //
  // Esta es la regla que de verdad protege la venta, y la anterior se quedaba
  // corta: enumeraba los estados de cobro y entrega, pero no `intro_done`. Ahí
  // está justo el cliente al que el bot YA le pasó los datos de pago y que
  // todavía no ha mandado el comprobante. Callarle en ese punto es lo peor que
  // puede hacer este interruptor: el cliente transfiere el dinero, manda la
  // foto, y no le contesta nadie.
  //
  // Pasa de verdad en dos casos: al encender el interruptor con conversaciones
  // ya en marcha, y con el cliente orgánico que vuelve al día siguiente.
  //
  // `new` es el único estado en que el bot no ha abierto la boca. Mientras
  // siga ahí, callar no interrumpe nada. En cuanto sale de `new`, hay una
  // conversación empezada y se termina.
  if (convo.state !== "new") return true;
  console.log(
    `[wh] convo ${convo.id} entró sin anuncio y «no responder orgánicos» está encendido: no contesto`
  );
  return false;
}

/**
 * MODERACIÓN — devuelve true si el mensaje se cortó aquí y no debe seguir.
 *
 * Suma un aviso y solo al llegar al umbral despide y bloquea. Los dos
 * interruptores están apagados salvo que se enciendan a mano, así que por
 * defecto esta función devuelve false siempre y el bot trabaja como hoy.
 */
async function moderarSiCorresponde(
  convo: ConversationRow,
  texto: string
): Promise<boolean> {
  const mod = loadWorkflowConfig()?.moderacion;
  if (!mod) return false;
  const tipo = evaluarModeracion({
    texto,
    estado: convo.state,
    yaPago: convo.paid_at != null || convo.paid_total_cents > 0,
    piroposActivo: mod.piropos_enabled === true,
    basuraActivo: mod.basura_enabled === true,
  });
  if (!tipo) return false;

  const umbral =
    tipo === "piropo"
      ? Math.max(1, Math.floor(mod.piropos_umbral ?? 3))
      : Math.max(1, Math.floor(mod.basura_umbral ?? 2));
  const acumulados = sumarStrike(convo.id, tipo);
  console.log(
    `[moderacion] convo ${convo.id}: ${tipo} ${acumulados}/${umbral} — "${texto.slice(0, 60)}"`
  );
  // Antes del umbral no se responde nada: ni bloqueo, ni tokens, ni ruido.
  if (acumulados < umbral) return true;

  const despedida = (mod.mensaje_despedida ?? "").trim();
  if (despedida) {
    try {
      await sendTextMessage(convo.phone, despedida);
    } catch (err) {
      console.error(`[moderacion] no se pudo despedir a ${convo.phone}:`, err);
    }
  }
  // El motivo queda escrito en la lista de bloqueados, para poder revisarlo
  // y deshacerlo desde el panel.
  blockNumber(
    convo.phone,
    `${tipo} — ${acumulados} mensajes. Último: "${texto.slice(0, 80)}"`
  );
  console.log(
    `[moderacion] convo ${convo.id} BLOQUEADO por ${tipo} (${acumulados} mensajes)`
  );
  return true;
}

function isStageGuidedSalesbotActive(): boolean {
  const config = loadWorkflowConfig();
  if (!config?.salesbot?.modes) return false;
  const modality = getActiveModalityKey(config);
  return config.salesbot.modes[modality] === "salesbot_stage_guided";
}

function offeredVisualSample(text: string): boolean {
  const normalized = normalizeGalleryKey(text).replace(/\s+/g, " ");
  if (!normalized) return false;
  const visual = /\b(foto|imagen|imagenes|muestra|muestras|captura|visual|verla|verlo|mostrarte|mostrartelo)\b/.test(
    normalized
  );
  const offer = /\b(quieres|quieres que|te muestro|te puedo mostrar|puedo mostrarte|te envio|te puedo enviar|puedo enviarte|te mando|te paso|te comparto|te enseno|te puedo ensenar|mando|envio|paso|comparto)\b/.test(
    normalized
  );
  return visual && offer && !isCommerceOrPriceQuestion(text);
}

/**
 * LA MARCA DE QUE EL BOT OFRECIÓ LAS IMÁGENES.
 *
 * El dueño pidió (17 de septiembre de 2026) que, a la primera intención de
 * conocer el contenido, el bot explique por escrito COMO SIEMPRE y al final
 * ofrezca enseñar las imágenes — y solo cuando la galería tenga muestras que
 * este cliente no haya visto. La frase la redacta el modelo: «deja que el
 * agente diga lo que desee en ese aspecto».
 *
 * Y AHÍ ESTÁ EL PROBLEMA QUE ESTA MARCA RESUELVE. La puerta que atiende el «sí»
 * —`offeredVisualSample`, aquí abajo— reconoce la oferta por una LISTA DE
 * PALABRAS contra el texto que escribe el MODELO. CLAUDE.md ya la tenía
 * señalada como sospechosa, y al medirla con las formas en que un modelo cierra
 * esa oferta falló 7 de cada 10 — incluida la frase textual del dueño,
 * «¿deseas ver unas imágenes?»: `deseas` no está en la lista, y `fotos` tampoco
 * porque solo estaba `foto`. Sin esto, el bot ofrece, el cliente dice «sí» y no
 * pasa nada: el mismo fallo de la conversación HELLO1.
 *
 * NO SE ARREGLA AÑADIENDO PALABRAS —es lo intocable nº 2— sino con el mecanismo
 * que este bot ya usa y le funciona: un MARCADOR que emite el modelo y que el
 * motor intercepta y borra, como `<<METODOS_PAGO>>` o `<<ELIGE_PRODUCTO_1>>`.
 * Cuando el modelo escribe la oferta, cierra con `<<OFRECI_IMAGENES>>`; el
 * motor lo quita del texto y lo anota aquí. El cliente nunca lo ve.
 *
 * POR QUÉ NO SE PUEDE QUEDAR COLGADA. Solo dispara si además queda alguna
 * muestra por ver, y al enviarlas todas quedan marcadas: entonces la marca ya no
 * puede volver a actuar. Y el motor de venta corre ANTES que esta puerta, así
 * que un «sí» que de verdad era para comprar lo atiende él y aquí no llega.
 *
 * LA LISTA DE PALABRAS SE QUEDA COMO ESTABA, de respaldo: si el modelo olvida el
 * marcador pero redacta una de las formas que sí reconoce, el «sí» sigue
 * funcionando igual que hasta hoy. No se quita nada.
 */
const MARCA_DE_OFERTA_DE_IMAGENES = "__oferta_imagenes__";

function pickGalleryAfterVisualConsent(
  inboundText: string,
  lastAssistantText: string,
  gallery: ReturnType<typeof getImageGallery>,
  alreadySent: string[],
  elMotorSeLoPidio = false
): (typeof gallery)[number] | null {
  // TRES SEÑALES, Y LA PRIMERA ES LA ÚNICA QUE NO DEPENDE DEL MODELO.
  //
  // El orden no es casual: primero lo que sabe el motor por sí mismo, después la
  // marca que el modelo pudo poner, y al final la lista de palabras de siempre.
  // Las dos últimas no se quitan —son respaldo—, pero ninguna decide sola.
  const elBotLoOfrecio =
    elMotorSeLoPidio ||
    alreadySent.includes(MARCA_DE_OFERTA_DE_IMAGENES) ||
    offeredVisualSample(lastAssistantText);
  if (!isShortVisualConsent(inboundText) || !elBotLoOfrecio) {
    return null;
  }
  const byLastOffer = findLocalGalleryKeywordMatch(
    lastAssistantText,
    gallery,
    alreadySent
  );
  if (byLastOffer) return byLastOffer;
  const sent = new Set(alreadySent.map((item) => item.toLowerCase()));
  return gallery.find((item) => !sent.has(item.topic.toLowerCase())) ?? null;
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 2) return 3;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] =
        a[i - 1] === b[j - 1]
          ? prev[j - 1]
          : Math.min(prev[j - 1], prev[j], cur[j - 1]) + 1;
    }
    prev = cur;
  }
  return prev[b.length] ?? 3;
}

function findLocalGalleryKeywordMatch(
  text: string,
  gallery: ReturnType<typeof getImageGallery>,
  alreadySent: string[]
): (typeof gallery)[number] | null {
  const normalized = normalizeGalleryKey(text).replace(/\s+/g, " ");
  if (!normalized || isCommerceOrPriceQuestion(text)) return null;

  const haystack = ` ${normalized} `;
  const tokens = normalized.split(" ").filter(Boolean);
  const sent = new Set(alreadySent.map((item) => item.toLowerCase()));

  for (const item of gallery) {
    if (sent.has(item.topic.toLowerCase())) continue;
    const keys = (item.keywords ?? [])
      .map((key) => normalizeGalleryKey(key).replace(/\s+/g, " "))
      .filter((key) => key.length >= 3);
    if (keys.length === 0) continue;

    for (const key of keys) {
      if (haystack.includes(` ${key} `)) return item;
      if (!key.includes(" ") && tokens.includes(key)) return item;
    }
  }

  for (const item of gallery) {
    if (sent.has(item.topic.toLowerCase())) continue;
    const keys = (item.keywords ?? [])
      .map((key) => normalizeGalleryKey(key).replace(/\s+/g, " "))
      .filter((key) => key.length >= 5 && !key.includes(" "));
    for (const key of keys) {
      const threshold = key.length >= 8 ? 2 : 1;
      if (tokens.some((token) => editDistance(token, key) <= threshold)) {
        return item;
      }
    }
  }

  return null;
}

function shouldHideOrderBumpSecondProduct(
  convo: NonNullable<ReturnType<typeof getConversationById>>
): boolean {
  const cfg = loadWorkflowConfig();
  const orderBump = cfg?.order_bump;
  const postSaleStates = new Set([
    "payment_approved",
    "awaiting_email",
    "awaiting_gift_consent",
    "awaiting_facebook_comment",
  ]);
  const orderBumpPostSale = postSaleStates.has(convo.state ?? "");
  const deferredUntilPayment =
    convo.state === "intro_done" &&
    !convo.order_bump_choice &&
    (convo.last_followup_index >= 0 ||
      orderBump?.offer_on_intro_first_message === false);
  return !!orderBump?.enabled && !orderBumpPostSale && deferredUntilPayment;
}

// Mutex en memoria por numero de telefono: serializa el procesamiento de
// mensajes de un mismo cliente. Sin esto, dos mensajes que llegan en
// paralelo pueden pasar ambos por el branch state === "new" antes de que
// el primero alcance a actualizar el estado, causando saludos / intros
// duplicados. Indexado por phone porque esta disponible antes de
// getOrCreateConversation (y un mismo phone siempre mapea a una misma
// convo). Vive solo en memoria — si el proceso reinicia el lock se
// pierde, pero a esa altura no hay mensajes en vuelo.
const phoneLocks = new Map<string, Promise<unknown>>();

// Debounce anti-ráfaga: guarda el ID del ÚLTIMO mensaje recibido por número.
// Cuando un cliente escribe varios mensajitos seguidos, solo el último genera
// respuesta (los anteriores se descartan tras la espera). Ver FASE 2 en
// handleIncomingMessage. Vive en memoria; si el proceso reinicia, se pierde
// (sin consecuencias: a esa altura no hay ráfagas en vuelo).
const latestInboundMsgId = new Map<string, string>();

function withPhoneLock<T>(
  phone: string,
  fn: () => Promise<T>
): Promise<T> {
  const prev = phoneLocks.get(phone) ?? Promise.resolve();
  // Encadenamos sobre la promesa previa. Pasamos `fn` como handler de
  // ambos lados (resuelto y rechazado) para que un error previo no
  // bloquee a los siguientes.
  const next = prev.then(fn, fn) as Promise<T>;
  // Trackeamos una version que no rechaza para no contaminar la cadena
  // siguiente con errores ajenos.
  const tracked = next.catch(() => {});
  phoneLocks.set(phone, tracked);
  return next.finally(() => {
    if (phoneLocks.get(phone) === tracked) {
      phoneLocks.delete(phone);
    }
  });
}

interface IncomingContact {
  wa_id?: string;
  profile?: { name?: string | null };
}

interface IncomingAudio {
  id?: string;
  mime_type?: string;
  voice?: boolean;
}

interface IncomingImage {
  id?: string;
  mime_type?: string;
  caption?: string;
  sha256?: string;
}

interface IncomingVideo {
  id?: string;
  mime_type?: string;
  caption?: string;
  sha256?: string;
}

interface IncomingDocument {
  id?: string;
  mime_type?: string;
  filename?: string;
  caption?: string;
  sha256?: string;
}

interface IncomingReferral {
  source_url?: string;
  source_id?: string;
  source_type?: string;
  headline?: string;
  body?: string;
  ctwa_clid?: string;
}

interface IncomingMessage {
  from?: string;
  id?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  audio?: IncomingAudio;
  image?: IncomingImage;
  video?: IncomingVideo;
  document?: IncomingDocument;
  referral?: IncomingReferral;
  // Respuesta a botones interactivos (reply buttons). Cuando el cliente toca
  // un botón, WhatsApp envía el id + el título elegido.
  interactive?: {
    type?: string;
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string };
  };
  // Botones de plantilla (formato legacy).
  button?: { text?: string; payload?: string };
}

interface IncomingStatus {
  id?: string;
  status?: string;
  recipient_id?: string;
  /**
   * Motivo del fallo. Meta lo manda SIEMPRE que el status es "failed", y antes
   * se descartaba: en el log solo quedaba "status failed" sin decir por que,
   * asi que un audio o un mensaje que no llegaba no habia forma de explicarlo.
   */
  errors?: Array<{
    code?: number;
    title?: string;
    message?: string;
    error_data?: { details?: string };
  }>;
}

interface ChangeValue {
  messaging_product?: string;
  metadata?: Record<string, unknown>;
  contacts?: IncomingContact[];
  messages?: IncomingMessage[];
  statuses?: IncomingStatus[];
}

interface Change {
  field?: string;
  value?: ChangeValue;
}

interface Entry {
  id?: string;
  changes?: Change[];
}

interface WebhookPayload {
  object?: string;
  entry?: Entry[];
}

export async function processWebhookPayload(payload: unknown): Promise<void> {
  const root = payload as WebhookPayload | null | undefined;
  if (!root || root.object !== "whatsapp_business_account") return;

  for (const entry of root.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages") continue;
      const value = change.value ?? {};

      // Filtro multi-tenant: si la misma Meta App tiene acceso a OTRA
      // WABA/numero, Meta nos manda esos webhooks tambien. Hay que quedarse
      // solo con los NUESTROS.
      //
      // Antes se comparaba contra UN solo numero (el activo) y se descartaba
      // todo lo demas, asi que un segundo numero conectado quedaba mudo: sus
      // mensajes llegaban aqui y se tiraban. Ahora vale cualquier numero que
      // este CONECTADO en Meta Connect, no solo el activo.
      //
      // Si no hay ninguna conexion guardada (instalacion por variables de
      // entorno), se sigue comparando contra el numero del entorno, igual que
      // antes.
      const incomingPhoneId = (
        value.metadata as { phone_number_id?: string } | undefined
      )?.phone_number_id;
      // PAUSADO EN ESTE PROYECTO (21/10/2026, con su permiso): otro proyecto atiende ese
      // número y no debe haber dos bots contestando. Se ignora aquí, antes de leer nada (sin
      // gastar tokens). Es una línea AÑADIDA: lo de abajo sigue igual.
      if (
        incomingPhoneId &&
        listMetaWhatsAppConnections().some((c) => c.phone_number_id === incomingPhoneId && c.pausado === 1)
      ) {
        console.log(`[wh] webhook para phone_number_id ${incomingPhoneId}: pausado en este proyecto, ignoro`);
        continue;
      }
      const conectados = listMetaWhatsAppConnections().map(
        (c) => c.phone_number_id
      );
      const propios =
        conectados.length > 0
          ? conectados
          : [getWhatsAppRuntimeConfig().phoneNumberId].filter(
              (x): x is string => !!x
            );
      if (
        incomingPhoneId &&
        propios.length > 0 &&
        !propios.includes(incomingPhoneId)
      ) {
        console.log(
          `[wh] webhook para phone_number_id ${incomingPhoneId}, no es nuestro (${propios.join(", ")}), ignoro`
        );
        continue;
      }

      for (const status of value.statuses ?? []) {
        const waId = status.id;
        const raw = status.status;
        if (!waId || !raw) continue;
        // Meta manda: sent / delivered / read / failed. Cualquier otro
        // (ej. 'deleted') lo ignoramos por ahora.
        const mapped: WaStatus | null =
          raw === "sent" || raw === "delivered" || raw === "read" || raw === "failed"
            ? (raw as WaStatus)
            : null;
        if (!mapped) {
          console.log(`[wh] status desconocido "${raw}" para ${waId}, ignorando`);
          continue;
        }
        try {
          updateMessageStatus(waId, mapped);
          if (mapped === "failed") {
            // El motivo va COMPLETO al log: es la unica pista para saber por
            // que WhatsApp no entrego el mensaje (ventana de 24h, numero que
            // no recibe, formato de audio rechazado...).
            const motivo = (status.errors ?? [])
              .map(
                (e) =>
                  `codigo ${e.code ?? "?"}: ${e.title ?? "sin titulo"}` +
                  (e.message ? ` — ${e.message}` : "") +
                  (e.error_data?.details ? ` (${e.error_data.details})` : "")
              )
              .join(" | ");
            console.warn(
              `[wh] status FAILED para ${waId.slice(-12)} -> ${motivo || "Meta no mando motivo"}`
            );
          } else {
            console.log(`[wh] status ${mapped} para ${waId.slice(-12)}`);
          }
        } catch (err) {
          console.error(`[wh] error actualizando status ${mapped} de ${waId}:`, err);
        }
      }

      const contacts = value.contacts ?? [];
      const nameByPhone = new Map<string, string | null>();
      for (const c of contacts) {
        if (c.wa_id) nameByPhone.set(c.wa_id, c.profile?.name ?? null);
      }

      for (const msg of value.messages ?? []) {
        try {
          // Todo el procesamiento de ESTE mensaje corre "dentro" del numero por
          // el que entro, para que las respuestas salgan por el mismo. Con un
          // solo numero conectado no cambia nada: el contexto apunta al unico
          // que hay, que es tambien el activo.
          await withOutboundWhatsAppNumber(incomingPhoneId, () =>
            handleIncomingMessage(
              msg,
              (msg.from && nameByPhone.get(msg.from)) ?? null
            )
          );
        } catch (err) {
          console.error("[wh] error en handleIncomingMessage:", err);
        }
      }
    }
  }
}

interface TestIncomingOptions {
  channel: "test";
  media?: MediaPayload | null;
}

export async function processTestIncomingMessage(input: {
  phone: string;
  name: string;
  content: string;
  media?: MediaPayload | null;
  button?: { id: string; title: string } | null;
}): Promise<void> {
  await handleIncomingMessage(
    {
      id: `test:${crypto.randomUUID()}`,
      from: input.phone,
      type: input.button ? "interactive" : "text",
      text: { body: input.content },
      interactive: input.button
        ? { type: "button_reply", button_reply: input.button }
        : undefined,
    },
    input.name,
    { channel: "test", media: input.media }
  );
}

async function handleIncomingMessage(
  msg: IncomingMessage,
  pushName: string | null,
  testOptions?: TestIncomingOptions
): Promise<void> {
  const waMsgId = msg.id;
  const phone = msg.from;
  if (!waMsgId || !phone) {
    console.warn("[wh] mensaje sin id o from, ignorando");
    return;
  }

  if (wasMessageProcessed(waMsgId)) {
    console.log(`[wh] mensaje ${waMsgId} ya procesado, ignorando`);
    return;
  }
  markMessageProcessed(waMsgId);

  // Blacklist: si el número está bloqueado, ignoramos el mensaje por
  // completo — no lo guardamos, no respondemos, no disparamos workflow.
  if (!testOptions && isNumberBlocked(phone)) {
    console.log(`[wh] número ${phone} bloqueado, ignorando mensaje ${waMsgId}`);
    return;
  }

  let content: string;
  /**
   * LO QUE QUEDA ESCRITO EN EL CHAT, CUANDO NO ES LO MISMO QUE SE ENRUTA.
   *
   * Solo lo usan los botones del editor. Su id —«bubble:<uuid>»— es lo ÚNICO que
   * permite encontrar la acción configurada, así que por ahí tiene que viajar;
   * pero guardarlo como el mensaje del cliente dejaba esto en la conversación:
   *
   *     «bubble:c7633c9e-3acb-4b2d-b735-f66afc3b2e86»
   *
   * Con palabras del dueño: «yo pensé que al presionar el botón aparecería
   * "quiero el descuento"». Y no es solo estética: ese texto entra en el
   * historial que lee el modelo, así que donde debería leer qué eligió el
   * cliente, leía una cadena sin significado.
   *
   * El resto de botones —regalo, producto extra— ya guardaban su etiqueta, y hay
   * un comentario largo ahí abajo explicando por qué: «en el chat quedaba escrito
   * algo que el cliente nunca escribió; al revisar una conversación para entender
   * qué pasó, eso engaña». Estos eran la excepción, y ya no lo son.
   *
   * Null = se guarda `content`, como siempre.
   */
  let contenidoVisible: string | null = null;
  let media: MediaPayload | null = null;

  if (testOptions?.media) {
    content =
      msg.text?.body?.trim() || marcaDeAdjunto(testOptions.media.media_type);
    media = testOptions.media;
  } else if (msg.type === "text") {
    const text = msg.text?.body?.trim();
    if (!text) {
      console.log(`[wh] mensaje ${waMsgId} sin texto, ignorando`);
      return;
    }
    content = text;
  } else if (msg.type === "interactive" || msg.type === "button") {
    // El cliente tocó un BOTÓN. Para los botones de MÉTODO DE PAGO, el id lleva
    // "pmethod:<keyword>" → enrutamos por ese método (así la etiqueta puede tener
    // emoji/mayúsculas sin afectar el ruteo). Para los demás (order bump / doble
    // oferta) usamos el TÍTULO, que el motor reconoce por nombre.
    const id =
      msg.interactive?.button_reply?.id ??
      msg.interactive?.list_reply?.id ??
      "";
    const title =
      msg.interactive?.button_reply?.title ??
      msg.interactive?.list_reply?.title ??
      msg.button?.text ??
      "";
    // El id de pago viene como "pmethod:<método>:<índice>" (el índice solo da
    // unicidad). Tomamos el método = lo que va entre "pmethod:" y el siguiente
    // ":". Compatible con el formato viejo "pmethod:<método>" (sin índice).
    // Botones del ORDER BUMP (id "ob_combo"/"ob_basico"): usamos el NOMBRE
    // COMPLETO de la opción desde la config — NO el título, que WhatsApp trunca
    // a 20 caracteres y haría fallar el reconocimiento de la elección (entonces
    // el pago se validaría contra el precio individual = bug crítico).
    // LA TRADUCCIÓN DEL BOTÓN VIVE EN `textoDelBotonPulsado` (22/10/2026): la usa también Messenger,
    // con sus respuestas rápidas. Una sola regla para los dos canales.
    const traducido = textoDelBotonPulsado(id, title);
    const text = traducido.texto;
    if (traducido.visible !== null) contenidoVisible = traducido.visible;
    if (!text) {
      console.log(`[wh] interactivo ${waMsgId} sin título, ignorando`);
      return;
    }
    content = text;
    console.log(`[wh] botón tocado en ${waMsgId}: "${text}" (id: ${id})`);
  } else if (msg.type === "document") {
    const docId = msg.document?.id;
    if (!docId) {
      console.warn(`[wh] documento ${waMsgId} sin id, ignorando`);
      return;
    }
    try {
      const downloaded = await downloadMediaFromMeta(docId, "document");
      const caption = msg.document?.caption?.trim() ?? "";
      const filename = msg.document?.filename?.trim() ?? null;
      content = caption || filename || "[documento]";
      media = {
        media_type: "document",
        media_url: downloaded.rel_path,
        media_mime: downloaded.mime,
        media_filename: filename,
        transcription: null,
        duration_sec: null,
      };
      console.log(
        `[wh] documento ${waMsgId} recibido (${downloaded.mime}, ${downloaded.size_bytes}B), filename: "${filename}", caption: "${caption.slice(0, 80)}"`
      );
    } catch (err) {
      console.error(`[wh] fallo descargando documento ${waMsgId}:`, err);
      return;
    }
  } else if (msg.type === "video") {
    const videoId = msg.video?.id;
    if (!videoId) {
      console.warn(`[wh] video ${waMsgId} sin id, ignorando`);
      return;
    }
    try {
      const downloaded = await downloadMediaFromMeta(videoId, "video");
      const caption = msg.video?.caption?.trim() ?? "";
      content = caption || "[video]";
      media = {
        media_type: "video",
        media_url: downloaded.rel_path,
        media_mime: downloaded.mime,
        media_filename: null,
        transcription: null,
        duration_sec: null,
      };
      console.log(
        `[wh] video ${waMsgId} recibido (${downloaded.mime}, ${downloaded.size_bytes}B), caption: "${caption.slice(0, 80)}"`
      );
    } catch (err) {
      console.error(`[wh] fallo descargando video ${waMsgId}:`, err);
      return;
    }
  } else if (msg.type === "image") {
    const imageId = msg.image?.id;
    if (!imageId) {
      console.warn(`[wh] imagen ${waMsgId} sin id, ignorando`);
      return;
    }
    try {
      const downloaded = await downloadMediaFromMeta(imageId, "image");
      const caption = msg.image?.caption?.trim() ?? "";
      content = caption || "[imagen]";
      media = {
        media_type: "image",
        media_url: downloaded.rel_path,
        media_mime: downloaded.mime,
        media_filename: null,
        transcription: null,
        duration_sec: null,
      };
      console.log(
        `[wh] imagen ${waMsgId} recibida (${downloaded.mime}, ${downloaded.size_bytes}B), caption: "${caption.slice(0, 80)}"`
      );
    } catch (err) {
      console.error(`[wh] fallo descargando imagen ${waMsgId}:`, err);
      return;
    }
  } else if (msg.type === "audio") {
    const audioId = msg.audio?.id;
    if (!audioId) {
      console.warn(`[wh] audio ${waMsgId} sin id, ignorando`);
      return;
    }
    try {
      const downloaded = await downloadMediaFromMeta(audioId, "audio");
      let transcription = "";
      let durationSec: number | null = null;
      try {
        const result = await transcribeAudio(downloaded.abs_path, downloaded.mime);
        transcription = result.text;
        durationSec = result.duration_sec;
        console.log(
          `[wh] audio ${waMsgId} transcrito (${durationSec ?? "?"}s): "${transcription.slice(0, 80)}"`
        );
      } catch (err) {
        console.error(`[wh] fallo transcribiendo ${waMsgId}:`, err);
      }
      content = transcription || "[audio sin transcripción]";
      media = {
        media_type: "audio",
        media_url: downloaded.rel_path,
        media_mime: downloaded.mime,
        media_filename: null,
        transcription: transcription || null,
        duration_sec: durationSec,
      };
    } catch (err) {
      console.error(`[wh] fallo descargando audio ${waMsgId}:`, err);
      return;
    }
  } else {
    console.log(
      `[wh] tipo ${msg.type ?? "?"} no soportado todavía, ignorando ${waMsgId}`
    );
    return;
  }

  // FASE 1 — INGESTA: guardamos el mensaje del cliente. Serializado por phone
  // para no duplicar la conversación/saludo si llegan dos casi juntos. Esto
  // SIEMPRE corre (todos los mensajes se guardan); la RESPUESTA se decide
  // después, en la FASE 2, tras el debounce.
  let convoId = 0;
  await withPhoneLock(phone, async () => {
  const convo = getOrCreateConversation(phone, pushName, testOptions?.channel);
  convoId = convo.id;
  // Deja anotado por cual de NUESTROS numeros entro, para responderle por el
  // mismo tambien en los seguimientos programados, que salen del worker horas
  // despues y ya no tienen el webhook delante.
  setConversationWaPhoneNumberId(convo.id, getOutboundWhatsAppNumber());
  // LA FRASE DE ENTRADA ELIGE LA TIENDA — para que un número atienda varias (12/10/2026).
  //
  // Va AQUÍ, antes que todo lo que depende de la tienda —el precio congelado, la
  // presentación con la que nace y la intro—, para que la conversación nazca ya en su
  // tienda. Solo actúa si alguna tienda de ESTE número tiene frases y el mensaje trae una;
  // si no, no escribe nada y la tienda sale del número exactamente como siempre.
  //
  // La base solo la anota si la conversación es nueva y no tenía tienda: una frase a mitad
  // de una venta no le cambia nada. Ver `fijarTiendaPorFraseSiFalta`.
  // El número es el del aviso de Meta. En el simulador no hay aviso: ahí está guardado en la
  // conversación, que es el mismo dato con el que entra un cliente real a esa tienda.
  const tiendaPorFrase = tiendaPorFraseDeEntrada(
    content,
    getOutboundWhatsAppNumber() ?? convo.wa_phone_number_id
  );
  if (tiendaPorFrase && fijarTiendaPorFraseSiFalta(convo.id, tiendaPorFrase.id)) {
    convo.tienda_id = tiendaPorFrase.id;
    console.log(
      `[wf:tienda] convo ${convo.id}: su frase de entrada la lleva a la tienda «${
        tiendaPorFrase.nombre ?? tiendaPorFrase.id
      }»`
    );
  }
  // WhatsApp conoce el país por la lada; en el simulador se congela después de
  // elegir país. Esto no toca estados ni acciones de seguimientos.
  freezePricesForConvo(convo);
  // Y CON QUÉ PRESENTACIÓN VA A VENDER ESTA CONVERSACIÓN — la misma idea que el
  // precio congelado de la línea de arriba: lo que ya se le prometió a un
  // cliente no se le cambia por debajo. El dueño mueve el selector «PRESENTA:»
  // cuando quiere, también con clientes a media conversación.
  //
  // Escribe UNA sola vez (la base lo garantiza con su `WHERE ... IS NULL`), así
  // que estar en el camino de cada mensaje es inofensivo.
  //
  // QUIEN DECIDE EL VALOR ES `config.ts` Y QUIEN ESCRIBE ES ESTE LADO, a
  // propósito: `config.ts` no puede ganar dependencias nuevas de la base, porque
  // los bancos de pruebas la importan con un doble de cinco funciones y una sexta
  // los rompe todos a la vez.
  // CON SU TIENDA PUESTA, Y ESTO ES EL ARREGLO — 5 de octubre de 2026.
  //
  // ANTES SE LLAMABA A PELO, y aquí arriba todavía no hay tienda abierta: la abre
  // `conElTurnoDe` cien líneas más abajo. Así que el sello se escribía leyendo el
  // selector GENERAL, y la tienda llegaba tarde.
  //
  // LO QUE COSTÓ, y lo vio él testeando el 05/10/2026, dos veces el mismo día:
  //
  //   · Puso su tienda en COMO -DOU- y el bot le soltó la intro de otra cosa, porque
  //     la conversación nació sellada con lo que decía el general.
  //   · Y una conversación NATIVA de -OB- recibía «hemos actualizado nuestro contenido
  //     y ahora tenemos 2 opciones», que es el aviso de una transición que nunca
  //     ocurrió: nació sellada «un producto» por el general, la tienda vendía con dos,
  //     y el bot creyó que el cliente venía de antes.
  //
  // Y LE IMPEDÍA LO QUE MÁS NECESITA: tener una tienda en lineal, otra en -OB- y otra
  // en -DOU- a la vez. El general solo puede decir una cosa, así que las conversaciones
  // nuevas nacían todas con la misma, y «un número, una venta» quedaba a medias.
  //
  // SE ENVUELVE SOLO ESTA LLAMADA, no el bloque entero: es la única de aquí arriba que
  // pregunta por el selector. `conElTurnoDe` sigue abriendo la tienda abajo igual que
  // antes, para todo lo demás — esto no se la quita ni la duplica, porque
  // `conLaTiendaDelTurno` sin tienda no envuelve nada.
  //
  // SIN TIENDAS CREADAS NO CAMBIA NADA: `laTiendaDeLaConversacion` devuelve null, el
  // envoltorio no hace nada, y se lee el general letra por letra como hasta hoy.
  const presentacionAlNacer = conLaTiendaDelTurno(
    laTiendaDeLaConversacion(convo),
    () => laPresentacionConLaQueNace(convo)
  );
  if (presentacionAlNacer) {
    fijarPresentacionDeVentaSiFalta(convo.id, presentacionAlNacer);
    // QUEDA ESCRITO EN EL REGISTRO, y no es adorno: el día que el dueño mueva el
    // selector y un cliente siga comportándose «como antes», esta línea dice por
    // qué sin tener que adivinarlo. Es la misma disciplina que el resto del motor.
    console.log(
      `[wf] convo ${convo.id}: vende con la presentación «${presentacionAlNacer}» y se queda con ella`
    );
  }

  // Si este mensaje vino de un click en un anuncio de "Enviar mensaje por
  // WhatsApp", Meta adjunta el bloque `referral` con el ctwa_clid. Lo
  // guardamos para luego mandarlo a CAPI y que la atribución funcione en
  // Ads Manager. setConversationAdReferral solo escribe si la convo aún
  // no tenía un ctwa_clid (preserva la primera atribución).
  if (msg.referral?.ctwa_clid) {
    setConversationAdReferral(
      convo.id,
      msg.referral.ctwa_clid,
      msg.referral.source_id ?? null,
      msg.referral.source_url ?? null,
      msg.referral.headline ?? null
    );
    console.log(
      `[wh] convo ${convo.id} viene de ad ${msg.referral.source_id ?? "?"} (clid=${msg.referral.ctwa_clid.slice(0, 16)}…)`
    );
  }

  // LO QUE SE GUARDA ES LO QUE EL CLIENTE VIO. Para todo menos los botones del
  // editor es exactamente `content`; para esos, su etiqueta. Ver
  // `contenidoVisible`.
  const contenidoGuardado = contenidoVisible ?? content;
  if (media) {
    insertMessageWithMedia(convo.id, "user", contenidoGuardado, waMsgId, media);
  } else {
    insertMessage(convo.id, "user", contenidoGuardado, waMsgId);
  }
  // Si el cliente responde mientras una contestacion del LLM aun tiene
  // burbujas demoradas, esas burbujas ya no consideran el mensaje nuevo.
  // Cancelamos solo esos fragmentos; no toca intros, pagos ni entregas.
  cancelPendingActionsByTypeForConvo(convo.id, "send_text_chunk");
  console.log(
    `[wh] <- mensaje de ${phone} (${pushName ?? "?"}): "${contenidoGuardado.slice(0, 80)}"`
  );

  // Sincronizar lead a NocoDB tras cada mensaje del cliente (fire-and-forget).
  // La función solo PATCHea si cambió algo (label/resumen/nombre), así que es
  // barata si nada cambió.
  if (!testOptions) void syncLeadStatus(convo.id);
  }); // fin FASE 1 (ingesta)

  // DEBOUNCE anti-fragmentación: la gente escribe en RÁFAGAS de mensajitos.
  // En vez de responder a cada uno (lo que produce respuestas incoherentes),
  // esperamos unos segundos; si llega OTRO mensaje del mismo número, este se
  // descarta y solo el ÚLTIMO genera la respuesta, viendo TODO el bloque en
  // contexto. Como el webhook ya respondió 200 y procesa en background, esta
  // espera no afecta a Meta. 0 lo desactiva. Bonus: menos llamadas al LLM =
  // menos costo.
  //
  // AHORA SE EDITA DESDE EL PANEL.
  //
  // Vivía SOLO en la variable de entorno BOT_DEBOUNCE_SECONDS, o sea en
  // EasyPanel y con reinicio. Es el número que decide si al cliente que escribe
  // en tres pedazos se le contesta una vez o tres, así que tenerlo lejos del
  // panel —donde están los otros dos tiempos— hacía imposible cuadrarlos entre
  // sí sin salir de la aplicación.
  //
  // La variable de entorno SIGUE VALIENDO como respaldo, para no cambiarle el
  // comportamiento a un despliegue que aún no ha guardado desde el panel.
  const debounceConfigurado = loadWorkflowConfig()?.bot_debounce_seconds;
  const debounceSec =
    typeof debounceConfigurado === "number" && debounceConfigurado >= 0
      ? debounceConfigurado
      : Number(process.env.BOT_DEBOUNCE_SECONDS ?? 8);
  if (debounceSec > 0 && convoId > 0) {
    latestInboundMsgId.set(phone, waMsgId);
    await sleep(debounceSec * 1000);
    if (latestInboundMsgId.get(phone) !== waMsgId) {
      console.log(
        `[wh] ${phone}: "${content.slice(0, 40)}" superado por otro mensaje más nuevo → no respondo (debounce, espero el bloque completo)`
      );
      return;
    }
  }

  // FASE 2 — REACCIÓN: workflow + respuesta del LLM. Serializada por phone.
  await withPhoneLock(phone, async () => {
  const convo = getConversationById(convoId);
  if (!convo) return;
  // TODO EL TURNO SE ATIENDE CON LA PRESENTACIÓN DE **ESTA** CONVERSACIÓN.
  //
  // El dueño mueve el selector «PRESENTA:» cuando quiere, también con clientes a
  // media conversación. Sin esto, alguien a quien se le presentó UN producto y se
  // le dio SU precio pasaba de golpe a una venta de dos opciones: el bot le
  // contradecía lo que acababa de decirle.
  //
  // ENVUELVE EL TURNO ENTERO —motor, modelo y envío— porque la pregunta «¿hay dos
  // opciones?» se hace en 62 sitios y a cualquier profundidad. Es el mismo
  // mecanismo que ya usa el simulador (`withModalidadDePrueba`), copiado, no
  // inventado.
  //
  // VACÍO = EL SELECTOR DE HOY. Las conversaciones que ya existían no tienen
  // presentación anotada, y para ellas esto no envuelve nada: siguen vendiendo
  // exactamente como hasta hoy.
  // Y CON SU TIENDA. `conElTurnoDe` abre las dos: la tienda de su número —de la
  // que sale el selector— y, dentro, la presentación con la que nació esta
  // conversación. Sin tienda escrita no envuelve nada y esto es la línea de
  // antes, letra por letra.
  await conElTurnoDe(convo, async () => {
  // Estado al entrar al lock de reacción: si ya estaba "payment_approved",
  // el guard de más abajo suprime la respuesta celebratoria del LLM fuera
  // de contexto (race con el worker que pasa a "awaiting_email").
  const stateAtLockStart = convo.state;

  const fresh = getConversationById(convo.id);
  if (!fresh || fresh.mode !== "AI") {
    console.log(`[wh] convo ${convo.id} en modo HUMAN, no respondo`);
    return;
  }

  // ¿LE CONTESTAMOS A ESTE? Va lo PRIMERO, antes incluso de moderar.
  //
  // Si el bot no va a hablar, no hay nada que moderar, nada que marcar como
  // leído y nada que esperar. Cortar aquí es lo que hace que no cueste ni un
  // mensaje ni un token.
  if (!testOptions && !leContestamos(fresh)) return;

  // MODERACIÓN. Va antes que nada para que un pesado no cueste ni un token:
  // si aquí se corta, el motor y el modelo no llegan a ejecutarse.
  if (!testOptions && await moderarSiCorresponde(fresh, content)) return;

  // MARCAR COMO LEÍDO NO ES UN DELAY, Y NO PUEDE DEPENDER DE UNO.
  //
  // Esto vivía DENTRO del `if (responseDelaySec > 0)`, así que poner el delay
  // humano en 0 —lo que uno hace para que el bot responda rápido— apagaba de
  // paso el doble check azul y el «escribiendo…». Al cliente le quedaba un
  // mensaje sin leer durante toda la espera anti-ráfaga: parece que lo están
  // ignorando, que es justo lo contrario de lo que se buscaba al bajarlo.
  //
  // Son dos cosas distintas: avisar de que lo leímos, y esperar. Ahora el aviso
  // sale siempre y solo la espera es configurable.
  try {
    if (!testOptions) await markMessageRead(waMsgId, true);
  } catch (err) {
    console.error(
      `[wh] no se pudo marcar leído + typing para ${waMsgId}:`,
      err
    );
  }
  // Delay humano: esperar antes de contestar para no parecer un robot que
  // responde al instante. 0 = contesta en cuanto tiene la respuesta.
  const responseDelaySec =
    loadWorkflowConfig()?.bot_response_delay_seconds ?? 0;
  if (responseDelaySec > 0) {
    await sleep(responseDelaySec * 1000);
  }

  // Workflow engine: si el cliente está en algún paso scripted (saludo /
  // intro / pago), el engine maneja la respuesta y devolvemos sin llamar al
  // LLM. Si devuelve false, seguimos con la lógica IA normal.
  // El cliente puede responder su país y mandar otro mensaje enseguida (ej.
  // "Ecuador" y luego "precio"); el debounce descartaría el "Ecuador". Pasamos
  // el bloque combinado de mensajes recientes para no perder la respuesta.
  const gateContent = buildDebouncedWorkflowContent(fresh.id, content, debounceSec);
  if (testOptions) {
    const gateHandled = await handleMessengerCountryGate(fresh, gateContent);
    const withCountry = getConversationById(fresh.id);
    if (withCountry) freezePricesForConvo(withCountry);
    if (gateHandled) return;
  }

  try {
    const handled = await tryWorkflowOnIncoming(fresh, content);
    if (
      !handled &&
      (msg.type === "text" || msg.type === "interactive" || msg.type === "button")
    ) {
      const workflowContent = buildDebouncedWorkflowContent(
        fresh.id,
        content,
        debounceSec
      );
      if (workflowContent !== content) {
        const handledFromBlock = await tryWorkflowOnIncoming(
          getConversationById(fresh.id) ?? fresh,
          workflowContent
        );
        if (handledFromBlock) return;
      }
    }
    if (handled) return;
  } catch (err) {
    console.error("[wh] workflow engine falló, fallback a IA:", err);
  }

  // MODO SILENCIOSO: el bot NO charla con el LLM. Pero una IMAGEN (posible
  // comprobante) SÍ debe pasar al LLM — leerla con visión es lo que aprueba el
  // pago; si la suprimiéramos, se caerían las ventas. Vender/seguir es del
  // engine (ya corrió arriba); los seguimientos tienen su propio toggle.
  if (loadWorkflowConfig()?.silent_mode === true) {
    const ultimoDelCliente = getLatestUserMessage(convo.id);
    // El comprobante puede venir como foto o como PDF del banco: los dos pasan.
    const latestIsImage =
      ultimoDelCliente?.media_type === "image" ||
      (!!ultimoDelCliente && esComprobantePdf(ultimoDelCliente));
    if (!latestIsImage) {
      console.log(
        `[wh] convo ${convo.id} modo silencioso: no respondo (texto, sin LLM)`
      );
      return;
    }
    // Imagen → seguimos al LLM para leer el comprobante y aprobar el pago.
  }

  if (shouldSuppressDuplicatePriceReply(fresh.id, content)) {
    console.log(
      `[wh] convo ${fresh.id}: suprimo pregunta de precio repetida reciente`
    );
    return;
  }

  // Confirmación corta tras oferta visual: si el bot acaba de ofrecer una foto,
  // imagen o muestra, "si/s/ya/dale" manda la galería sin gastar tokens.
  if (
    !isStageGuidedSalesbotActive() &&
    (msg.type === "text" || msg.type === "interactive" || msg.type === "button")
  ) {
    const gallery = getImageGallery(shouldHideOrderBumpSecondProduct(fresh), fresh);
    // EL TURNO ENTERO DEL BOT, NO LA ÚLTIMA BURBUJA.
    //
    // Esto leía SOLO el último mensaje del bot. Y el bot no habla de una vez:
    // parte su respuesta en 4, 5 y hasta 6 burbujas —se ve en su registro,
    // `respuesta: 5 chunks LLM`—. Si la oferta de las imágenes cae en la burbuja
    // 3 de 5, este respaldo no la veía nunca.
    //
    // Es EL MISMO FALLO de la conversación HELLO1, que ya se arregló para la
    // elección de producto en `laPropuestaDelBotQueElClienteAfirmo` (commit
    // `d97d20c`) y que aquí nadie había portado. Lo preguntó el dueño antes de
    // que lo tocara: «eso ya se solucionó, ¿esto no pasará aquí?». Pasaba.
    //
    // Se recogen hacia atrás todas las burbujas del bot hasta topar con el
    // cliente: eso es su turno. Ventana 30, que son unos cinco turnos partidos.
    const historyForConsent = getRecentHistory(fresh.id, 30);
    const turnoEnteroDelBot = (() => {
      const suTurno: string[] = [];
      for (let i = historyForConsent.length - 1; i >= 0; i--) {
        if (historyForConsent[i].role === "assistant") {
          suTurno.unshift(historyForConsent[i].content ?? "");
        } else if (suTurno.length > 0) {
          break;
        }
      }
      return suTurno.join("\n").trim();
    })();
    // SE MIRA SIN CONSUMIR. Si esta puerta no actúa, el turno sigue hacia el
    // modelo y ALLÍ hace falta saber lo mismo —es la red de la capa 2—. Se
    // consume abajo, solo si de verdad se mandan las imágenes; y si no, se
    // reescribe sola en la siguiente llamada al modelo.
    const elMotorLePidioOfrecer = seLePidioOfrecerImagenesEnElTurnoAnterior(
      fresh.id
    );
    const item = turnoEnteroDelBot
      ? pickGalleryAfterVisualConsent(
          content,
          turnoEnteroDelBot,
          gallery,
          getSentMedia(fresh.id),
          !!elMotorLePidioOfrecer
        )
      : null;
    if (item) {
      let consentGallerySent = false;
      try {
        const sentTopics = await sendGalleryAfterVisualConsent(
          fresh,
          item,
          gallery
        );
        // QUEDA ESCRITO POR QUÉ SALIERON. Si mañana vuelve a fallar, esto dice
        // en una línea cuál de las tres señales actuó, sin tener que adivinarlo.
        console.log(
          `[wh] convo ${fresh.id} -> media galeria por confirmacion (${sentTopics.join(
            ", "
          )}) — ${
            elMotorLePidioOfrecer
              ? "lo apunto el motor"
              : getSentMedia(fresh.id).includes(MARCA_DE_OFERTA_DE_IMAGENES)
                ? "por el marcador del modelo"
                : "por el texto de la oferta"
          }`
        );
        // CONSUMIDA. Las imágenes ya salieron: esta nota no puede quedarse
        // esperando otro «sí» más adelante.
        olvidarLaOfertaDeImagenes(fresh.id);
        await sendSamplesClosing(fresh);
        consentGallerySent = true;
      } catch (err) {
        console.error(
          `[wh] envio de media galeria por confirmacion "${item.topic}" fallo:`,
          err
        );
      }
      if (consentGallerySent) return;
    }
  }

  // Palabras clave locales de la galeria: si el operador configuro keywords
  // para una muestra, podemos mandarla sin gastar tokens ni tocar el prompt.
  // Se ejecuta despues del workflow y respeta el ocultamiento del 2do producto
  // en Order Bump para no filtrar otra modalidad/etapa.
  if (msg.type === "text" || msg.type === "interactive" || msg.type === "button") {
    const gallery = getImageGallery(shouldHideOrderBumpSecondProduct(fresh), fresh);
    const item = findLocalGalleryKeywordMatch(
      content,
      gallery,
      getSentMedia(fresh.id)
    );
    if (item) {
      let localGallerySent = false;
      try {
        await enviarMuestraDeGaleria(fresh, item);
        markMediaSent(fresh.id, item.topic);
        console.log(
          `[wh] convo ${fresh.id} -> media galeria local "${item.topic}"`
        );
        await sendSamplesClosing(fresh);
        localGallerySent = true;
      } catch (err) {
        console.error(
          `[wh] envio de media galeria local "${item.topic}" fallo:`,
          err
        );
      }
      if (localGallerySent) return;
    }
  }

  const history = getRecentHistory(convo.id, 20);
  // Releer convo por si workflow guardó nombre del cliente.
  const ctx = getConversationById(convo.id);
  const startedAt = Date.now();
  let reply: string;
  try {
    reply = await generateReply(history, {
      clientName: ctx?.client_name ?? null,
      pushName: ctx?.name ?? pushName ?? null,
      conversationId: convo.id,
    });
  } catch (err) {
    console.error("[wh] error generando respuesta LLM:", err);
    return;
  }
  console.log(`[wh] LLM en ${Date.now() - startedAt}ms`);

  // Extraer el marcador <<RESUMEN: ...>> que el LLM agrega al final de su
  // respuesta. Lo usamos para sincronizar a NocoDB con un resumen
  // específico de esta conversación (más rico que la heurística basada
  // en state). Se quita del texto antes de mandar al cliente.
  const resumenMatch = reply.match(/<<\s*RESUMEN\s*:\s*([^>]+)>>/i);
  if (resumenMatch) {
    const llmResumen = resumenMatch[1].trim();
    reply = reply.replace(/<<\s*RESUMEN\s*:\s*[^>]+>>\s*/gi, "").trim();
    if (llmResumen) {
      void overrideResumenInNocodb(convo.id, llmResumen);
    }
  }
  // Defensa ante marcadores truncados o mal formados (p. ej. un solo "<" o
  // sin cierre por límite del proveedor). Nunca deben llegar al cliente.
  reply = reply.replace(/<{1,2}\s*RESUMEN\s*:[\s\S]*$/i, "").trim();

  // Marcador <<OFRECI_IMAGENES>>: el bot acaba de ofrecer enseñar las muestras
  // al cerrar su explicación. Se anota para que el «sí» del cliente lo atienda
  // el CÓDIGO y no dependa de acertar cómo redactó la oferta. Ver
  // `MARCA_DE_OFERTA_DE_IMAGENES`.
  //
  // VA AQUÍ ARRIBA, ANTES QUE NINGÚN OTRO MARCADOR, por una razón concreta: más
  // abajo hay puertas que TERMINAN el turno —la redirección de Ecuador, el menú
  // de pago— y si el texto saliera por una de ellas sin pasar por aquí, el
  // cliente vería el marcador escrito en su WhatsApp. Se quita del texto SIEMPRE,
  // pase lo que pase después.
  if (/<<\s*OFRECI_IMAGENES\s*>>/i.test(reply)) {
    reply = reply.replace(/<<\s*OFRECI_IMAGENES\s*>>/gi, "").trim();
    markMediaSent(fresh.id, MARCA_DE_OFERTA_DE_IMAGENES);
    console.log(
      `[wh] convo ${fresh.id}: el bot ofrecio las imagenes — el "si" ya tiene puerta`
    );
  }
  // Y la misma defensa del truncado: si el proveedor corta la respuesta a media
  // marca, tampoco debe llegar nada raro.
  reply = reply.replace(/<{1,2}\s*OFRECI_IMAGENES\s*>{0,2}\s*$/i, "").trim();

  // Marcador <<PAIS: ecuador>>: el cliente es de Ecuador. En vez del texto del
  // LLM, mandamos el mensaje de redirección configurable (con el número de la
  // línea de Ecuador), que el operador edita en el panel. Otros países los
  // maneja el LLM con naturalidad (sin marcador).
  if (/<<\s*PAIS\s*:\s*ecuador\s*>>/i.test(reply)) {
    try {
      await sendCountryRedirect(fresh, "ecuador");
      console.log(`[wh] convo ${convo.id} redirigido a línea Ecuador`);
    } catch (err) {
      console.error("[wh] country redirect (ecuador) falló:", err);
    }
    return;
  }

  // Marcador <<ELIGE_PRODUCTO_1/2>>: en Doble Oferta 2 Productos, el LLM confirma
  // que el cliente eligió UNA de las 2 opciones (para lo que la detección
  // determinística NO cazó: frases raras, typos, tras un diálogo). El sistema
  // entrega los datos de pago de ESA opción (Producto 1 = combo, Producto 2 =
  // básico, mismo orden que el prompt). Solo actúa con la modalidad activa.
  const eligeMatch = /<<\s*ELIGE_PRODUCTO_([12])\s*>>/i.exec(reply);
  // isDobleOfertaActive() cubre las DOS modalidades de doble oferta. Con la
  // sección a pelo, en "Doble Oferta + Upsell" este marcador se ignoraba: si la
  // clienta decía cuál quiere con una frase rara o un typo, la detección
  // determinística no la cazaba, el modelo sí, y aun así no le llegaban los
  // datos de pago. Se quedaba esperando.
  if (eligeMatch && isDobleOfertaActive()) {
    const choice = eligeMatch[1] === "1" ? "combo" : "basico";
    const leftover = reply
      .replace(/<<\s*ELIGE_PRODUCTO_[12]\s*>>\s*/gi, "")
      .trim();
    try {
      // AQUÍ HABLA EL SISTEMA, NO EL MODELO.
      //
      // El texto del modelo se mandaba además de los datos de pago, y las dos
      // tandas se programaban desde el mismo instante: salían entrelazadas —una
      // burbuja del modelo, una de pago, otra del modelo— con el número de
      // cuenta en medio de una frase partida.
      //
      // Y aunque no se cruzaran, sobraban: el modelo escribía «te paso los
      // datos» justo antes de que las burbujas de pago dijeran lo mismo. Dos
      // voces anunciando lo mismo, y una de ellas improvisando el nombre del
      // producto —en una prueba se inventó uno que no era.
      //
      // El marcador significa que el sistema toma el control. Entonces lo toma
      // entero: mandan las burbujas de Precios y pagos, que son fijas, llevan
      // el precio de lo que eligió y las escribes tú.
      if (leftover) {
        console.log(
          `[wh] convo ${convo.id}: descarto el texto del modelo (${leftover.length} car.) — los datos de pago los manda el sistema`
        );
      }
      await deliverDobleOfertaPaymentDetails(fresh, choice);
      console.log(
        `[wh] convo ${convo.id} → LLM confirmó elección "${choice}" (<<ELIGE_PRODUCTO_${eligeMatch[1]}>>), entrego datos de pago`
      );
    } catch (err) {
      console.error("[wh] entrega por marcador ELIGE_PRODUCTO falló:", err);
    }
    return;
  }

  // Marcadores del REGALO y el UPGRADE (misma idea que ELIGE_PRODUCTO): el LLM
  // confirma la intención cuando la detección determinística no la cazó, y el
  // SISTEMA ejecuta la acción. Cada uno con guard de ESTADO para que un marcador
  // suelto no dispare nada fuera de lugar. El texto del marcador nunca se envía.
  const stripMarkers = (r: string): string =>
    r
      .replace(
        /<<\s*(REGALO_SI|REGALO_NO|REGALO_HECHO|UPGRADE_COMBO|QUIERE_EXTRA)\s*>>\s*/gi,
        ""
      )
      .trim();
  // <<QUIERE_EXTRA>>: ACEPTÓ EL SEGUNDO PRODUCTO.
  //
  // EL AGUJERO QUE TAPA. Al modelo se le dice "si acepta, no escribas los datos
  // de pago: los manda el SISTEMA". Y el sistema los mandaba solo si el motor
  // reconocía la aceptación, que exige el NOMBRE configurado del producto o un
  // "sí" pelado antes de que salga el regalo.
  //
  // Con el producto llamado "PRODUCTO UPSELL" —el nombre de fábrica— nadie
  // escribe eso nunca. Y una vez ofrecido el regalo, el "sí" pelado deja de
  // valer a propósito, porque hay dos preguntas abiertas.
  //
  // Resultado real: el cliente escribió "quiero comprar las paginas secretas",
  // el bot contestó "te paso los datos"… y no llegaron nunca. Prometido y no
  // cumplido, con la venta perdida.
  //
  // Ahora el modelo avisa con un marcador y el sistema cumple. El marcador nunca
  // se le enseña al cliente.
  const freshUpsell = getConversationById(convo.id);
  // TAMBIÉN CON "aceptado", Y NO ES UN DESCUIDO.
  //
  // Antes solo valía "ofrecido". Pero quien ya dijo que sí sigue preguntando
  // —qué trae, si es estafa, ver el producto— y al final vuelve a decir "sí".
  // El modelo emite el marcador otra vez, se ignoraba, y el cliente se quedaba
  // con un "¡Genial!" a secas y sin datos de pago. Ahí moría la venta.
  //
  // Reenviarlos no hace daño: son los mismos datos y ya los pidió. Lo que sí
  // hace daño es callar.
  //
  // "pagado" y "rechazado" siguen fuera: a quien ya pagó no se le vuelve a
  // cobrar, y a quien dijo que no no se le insiste.
  if (
    /<<\s*QUIERE_EXTRA\s*>>/i.test(reply) &&
    (freshUpsell?.upsell_state === "ofrecido" ||
      freshUpsell?.upsell_state === "aceptado")
  ) {
    const leftover = stripMarkers(reply);
    try {
      // AQUÍ HABLA EL SISTEMA, NO EL MODELO.
      //
      // Antes salía el texto del modelo por delante de los datos, y era SIEMPRE
      // lo mismo: un «¡Genial! 😊» suelto, y detrás las burbujas del operador
      // diciendo lo suyo. El cliente lee dos presentaciones para una sola cosa,
      // y la de arriba no la escribió nadie: la improvisó el modelo.
      //
      // ESTA DECISIÓN YA ESTABA TOMADA en el bloque hermano de la venta normal
      // —el del marcador `<<ELIGE_PRODUCTO_1/2>>`, unas líneas más arriba— con
      // este mismo razonamiento: si el marcador significa que el sistema toma el
      // control, lo toma ENTERO. Faltaba aplicarla aquí, y por eso el «¡Genial!»
      // seguía saliendo en la etapa del segundo producto.
      //
      // Las burbujas que el cliente ve son las del operador: llevan su texto, su
      // precio y su cuenta. El modelo no aporta nada que no esté ya ahí.
      if (leftover) {
        console.log(
          `[wh] convo ${convo.id}: descarto el texto del modelo (${leftover.length} car.) — los datos del extra los manda el sistema`
        );
      }
      // CON LO QUE ESCRIBIÓ EL OPERADOR, si armó su cuadrito de aceptación.
      // Llamando directo a los datos de fábrica, quien aceptaba hablando con
      // el modelo recibía un texto que habla del producto que YA compró,
      // mientras el que el dueño escribió para el extra no salía nunca.
      await aceptarElExtraComoLoEscribioElDueno(freshUpsell);
      console.log(
        `[wh] convo ${convo.id} → LLM confirmó que quiere el segundo producto, mando sus datos de pago`
      );
    } catch (err) {
      console.error("[wh] marcador QUIERE_EXTRA falló:", err);
    }
    return;
  }
  // Fuera de "ofrecido" el marcador no dispara nada: se quita y el texto sigue
  // su curso. Sin esto, un marcador suelto reenviaría datos de pago a quien ya
  // pagó el extra o lo rechazó.
  if (/<<\s*QUIERE_EXTRA\s*>>/i.test(reply)) {
    console.warn(
      `[wh] convo ${convo.id}: <<QUIERE_EXTRA>> fuera de la oferta (estado ${freshUpsell?.upsell_state ?? "ninguno"}) → lo ignoro`
    );
    reply = stripMarkers(reply);
  }
  // <<REGALO_SI>> / <<REGALO_NO>>: aceptar/rechazar el regalo (solo en su estado).
  if (
    /<<\s*REGALO_(SI|NO)\s*>>/i.test(reply) &&
    fresh.state === "awaiting_gift_consent"
  ) {
    const accepts = /<<\s*REGALO_SI\s*>>/i.test(reply);
    const leftover = stripMarkers(reply);
    try {
      if (leftover) await sendChunkedBotText(fresh, leftover);
      if (accepts) acceptGiftConsent(fresh);
      else await declineGiftConsent(fresh);
      console.log(
        `[wh] convo ${convo.id} → LLM confirmó regalo ${accepts ? "SÍ" : "NO"}`
      );
    } catch (err) {
      console.error("[wh] marcador REGALO_SI/NO falló:", err);
    }
    return;
  }
  // <<REGALO_HECHO>>: el cliente confirmó que comentó (solo en su estado).
  if (
    /<<\s*REGALO_HECHO\s*>>/i.test(reply) &&
    fresh.state === "awaiting_facebook_comment"
  ) {
    const leftover = stripMarkers(reply);
    try {
      if (leftover) await sendChunkedBotText(fresh, leftover);
      await claimGiftReward(fresh);
      console.log(`[wh] convo ${convo.id} → LLM confirmó comentario, entrego regalo`);
    } catch (err) {
      console.error("[wh] marcador REGALO_HECHO falló:", err);
    }
    return;
  }
  // <<UPGRADE_COMBO>>: el cliente (que ya compró) quiere subir al combo. El helper
  // valida internamente que haya saldo pendiente; si ya lo cubrió, no hace nada.
  if (/<<\s*UPGRADE_COMBO\s*>>/i.test(reply)) {
    try {
      const applied = await offerComboUpgrade(fresh);
      if (applied) {
        console.log(
          `[wh] convo ${convo.id} → LLM confirmó upgrade a combo, ofrecí saldo`
        );
        return;
      }
    } catch (err) {
      console.error("[wh] marcador UPGRADE_COMBO falló:", err);
    }
    // No aplicó (ya cubrió el combo o no había compra): quitamos el marcador y
    // dejamos que el reply del LLM siga su curso normal (se envía una sola vez).
    reply = stripMarkers(reply);
  }

  // Marcador <<METODOS_PAGO>>: el LLM pide mostrar el menú de pago con BOTONES
  // (solo cuando el toggle está activo). Quitamos el marcador; si quedó texto
  // del LLM lo mandamos antes, y luego enviamos los botones (Yape/Plin/BCP).
  if (/<<\s*METODOS_PAGO\s*>>/i.test(reply)) {
    const leftover = reply.replace(/<<\s*METODOS_PAGO\s*>>\s*/gi, "").trim();
    const paymentConvo = getConversationById(convo.id);
    const wantsPaymentMethodChange = elClientePidioCambiarDeMetodo(content);
    if (
      paymentConvo?.state === "payment_done" &&
      paymentConvo.selected_payment_method &&
      !wantsPaymentMethodChange
    ) {
      // El cliente YA eligió método y vuelve a preguntar por el pago. En vez de
      // mandarlo a "buscar más arriba", RE-ENVIAMOS los datos del método que
      // eligió (mismo flujo determinístico que <<REENVIAR_PAGO>>). El LLM nunca
      // escribe los números de cuenta.
      const leftover = reply.replace(/<<\s*METODOS_PAGO\s*>>\s*/gi, "").trim();
      try {
        if (leftover) await sendChunkedBotText(fresh, leftover);
        const latestPaymentConvo = getConversationById(convo.id) ?? fresh;
        const ok = await resendPaymentDetails(latestPaymentConvo);
        if (!ok) await sendPaymentOffer(latestPaymentConvo);
        console.log(
          `[wh] convo ${convo.id} → reenvío de datos de pago (METODOS_PAGO, ok=${ok})`
        );
      } catch (err) {
        console.error(
          "[wh] reenvío de datos de pago (METODOS_PAGO) falló:",
          err
        );
      }
      return;
    }
    try {
      if (leftover) await sendChunkedBotText(fresh, leftover);
      // Envía el menú de pago configurado: texto (toggle OFF) o botones (ON).
      await sendPaymentOffer(fresh);
      console.log(`[wh] convo ${convo.id} → menú de métodos de pago`);
    } catch (err) {
      console.error("[wh] envío del menú de pago falló:", err);
    }
    return;
  }

  // Marcador <<TRANQUILIZAR>>: el cliente expresó desconfianza / miedo a estafa.
  // El SISTEMA manda el mensaje editable de tranquilización + su CTA (texto del
  // operador, no improvisado por el LLM). Si NO hay texto configurado, quitamos
  // el marcador y dejamos que la respuesta del LLM siga su curso normal.
  if (/<<\s*TRANQUILIZAR\s*>>/i.test(reply)) {
    const distrust = getDistrustMessage();
    if (distrust) {
      const leftover = reply.replace(/<<\s*TRANQUILIZAR\s*>>\s*/gi, "").trim();
      try {
        if (leftover) await sendChunkedBotText(fresh, leftover);
        await sendChunkedBotText(fresh, distrust);
        console.log(`[wh] convo ${convo.id} → mensaje de tranquilización enviado`);
      } catch (err) {
        console.error("[wh] envío de tranquilización falló:", err);
      }
      return;
    }
    reply = reply.replace(/<<\s*TRANQUILIZAR\s*>>\s*/gi, "").trim();
  }

  // Marcador <<REENVIAR_PAGO>>: el cliente, tras un desvío, vuelve a querer
  // pagar / pide los datos del método de nuevo. El SISTEMA re-envía la plantilla
  // del método que YA eligió (datos correctos + el CTA editable), en vez de
  // decirle "búscalo arriba". El LLM NUNCA escribe los números. Va ANTES del
  // <<REENVIAR>> para evitar solape de regex.
  if (/<<\s*REENVIAR_PAGO\s*>>/i.test(reply)) {
    const leftover = reply.replace(/<<\s*REENVIAR_PAGO\s*>>\s*/gi, "").trim();
    try {
      if (leftover) await sendChunkedBotText(fresh, leftover);
      const latestPaymentConvo = getConversationById(convo.id) ?? fresh;
      const ok = await resendPaymentDetails(latestPaymentConvo);
      // Si no hay método guardado, no dejamos al cliente sin nada (ni que el LLM
      // improvise): mostramos el menú de métodos como fallback seguro.
      if (!ok) await sendPaymentOffer(latestPaymentConvo);
      console.log(
        `[wh] convo ${convo.id} → reenvío de datos de pago (método guardado=${ok})`
      );
    } catch (err) {
      console.error("[wh] reenvío de datos de pago falló:", err);
    }
    return;
  }

  // Marcador <<REENVIAR>>: un cliente que YA PAGÓ pide su material/enlace de
  // nuevo (lo borró, lo perdió, no lo encuentra, "me lo reenvías?"). El SISTEMA
  // reenvía la secuencia de pago aprobado REAL (video + enlace + pedido de
  // correo); el LLM NUNCA escribe el enlace. Solo reenvía si la convo figura
  // pagada (resendApprovedMaterial lo verifica).
  if (/<<\s*REENVIAR\s*>>/i.test(reply)) {
    const leftover = reply.replace(/<<\s*REENVIAR\s*>>\s*/gi, "").trim();
    try {
      if (leftover) await sendChunkedBotText(fresh, leftover);
      const ok = resendApprovedMaterial(fresh);
      console.log(
        `[wh] convo ${convo.id} → reenvío de material solicitado (pagado=${ok})`
      );
    } catch (err) {
      console.error("[wh] reenvío de material falló:", err);
    }
    return;
  }

  // Marcador <<MEDIA: tema>>: el LLM decide mandar una imagen/video de la
  // galería (configurable). El bot lo emite SOLO cuando es relevante (el prompt
  // lo controla), así que lo enviamos SIEMPRE que lo pida — incluso si el cliente
  // RE-pregunta (se re-envía, sin el bug del "te envié y no llegó"). Cap del
  // sistema: UNA media por respuesta.
  const mediaMatches = [...reply.matchAll(/<<\s*MEDIA\s*:\s*([^>]+)>>/gi)];
  if (mediaMatches.length > 0) {
    const isPostSaleConversation =
      fresh.paid_at != null ||
      [
        "payment_approved",
        "awaiting_email",
        "awaiting_gift_consent",
        "awaiting_facebook_comment",
      ].includes(fresh.state ?? "");
    const productInfoTopics = new Set(
      getProductInfoTopics().map((topic) => topic.toLowerCase())
    );
    const requestsProductInfo = mediaMatches.some((match) =>
      productInfoTopics.has(match[1].trim().toLowerCase())
    );
    if (isPostSaleConversation && requestsProductInfo) {
      reply = reply.replace(/<<\s*MEDIA\s*:\s*[^>]+>>\s*/gi, "").trim();
      if (!reply) {
        reply =
          "Tu material ya esta disponible. Si necesitas ayuda para ubicar o usar una parte, dime cual y te oriento.";
      }
      console.log(
        `[wh] convo ${convo.id} postventa: bloqueo de imagen comercial solicitada`
      );
    } else {
    reply = reply.replace(/<<\s*MEDIA\s*:\s*[^>]+>>\s*/gi, "").trim();
    const gallery = getImageGallery();
    // Si el item NO tiene caption fijo, usamos el texto que el BOT escribió como
    // caption (misma burbuja). Guard de longitud: WhatsApp limita el caption
    // (~1024); si es muy largo, va aparte.
    let captionFromBotUsed = false;
    let sentProductInfoMedia = false;
    for (const m of mediaMatches) {
      const topic = m[1].trim().toLowerCase();
      if (!topic) continue;
      const item = resolveGalleryItem(gallery, topic, content, reply);
      if (!item) continue;
      sentProductInfoMedia = getProductInfoTopics().some(
        (productTopic) => productTopic.toLowerCase() === item.topic.toLowerCase()
      );
      let caption = item.caption?.trim() || undefined;
      if (!caption && reply.trim() && reply.trim().length <= 1000) {
        caption = reply.trim();
        captionFromBotUsed = true;
      }
      try {
        await enviarMuestraDeGaleria(fresh, item, caption);
        console.log(`[wh] convo ${convo.id} → media galería "${topic}"`);
      } catch (err) {
        console.error(`[wh] envío de media galería "${topic}" falló:`, err);
      }
      break; // solo la PRIMERA media válida — una por respuesta
    }
    if (sentProductInfoMedia) {
      await sendSamplesClosing(fresh);
      // El cierre ya lo envía el sistema; no permitimos que el LLM lo repita,
      // se corte o lo difiera en burbujas posteriores.
      reply = "";
    }
    // Si el texto del bot ya fue como caption de la foto, no lo repetimos abajo.
    if (captionFromBotUsed) reply = "";
    }
  }

  const refreshed = getConversationById(convo.id);
  // Suprimimos la respuesta del LLM si el state era payment_approved al
  // ENTRAR al lock (mientras la secuencia scripted estaba entregando
  // video + link + pedido de email) o si SIGUE siendo payment_approved.
  // El check del estado inicial cubre el race: el worker puede cambiar
  // state a "awaiting_email" mientras el LLM genera, lo que dejaba pasar
  // la respuesta celebratoria fuera de contexto (mensajes tipo
  // "¡Pago confirmado!", "A disfrutar del material" que venian del
  // prompt de payment_approved pero se enviaban cuando ya estabamos en
  // awaiting_email). Si fue payment_approved en algun momento de este
  // turno, el cliente ya recibio la confirmacion scripted — no necesita
  // otra del LLM.
  // ENTREGA / POST-COMPRA: cuando un COMPROBANTE (imagen) fue aprobado, el
  // sistema YA entrega el material con su mensaje de cierre. NO dejamos que el
  // LLM agregue otra respuesta — era la que re-mandaba enlaces y decía "tu pago
  // fue confirmado, en breve recibirás el acceso..." (confunde: el cliente cree
  // que el enlace ya enviado NO es el suyo y espera otro). Suprimimos si el
  // comprobante dejó la convo en CUALQUIER estado post-compra, sin depender del
  // timing exacto del worker. Un comprobante RECHAZADO NO pasa a estos estados,
  // así que ahí el LLM SÍ responde para explicar el rechazo.
  const latestUserIsImage =
    getLatestUserMessage(convo.id)?.media_type === "image";
  const postPurchaseStates = new Set([
    "payment_approved",
    "awaiting_email",
    "awaiting_gift_consent",
    "awaiting_facebook_comment",
  ]);
  // EXCEPCIÓN: el comprobante del SEGUNDO producto.
  //
  // Esta supresión existe para que, tras aprobar un comprobante, el modelo no
  // agregue un "tu pago fue confirmado, en breve recibirás el acceso" encima de
  // la entrega que el sistema ya mandó — el cliente creía que el enlace de
  // arriba no era el suyo y se quedaba esperando otro.
  //
  // Pero mientras el segundo producto está en juego y sin pagar, ese
  // comprobante es de una venta NUEVA. Callar ahí deja al cliente sin
  // confirmación de un pago que sí acaba de hacer.
  const comprobanteDelSegundoProducto =
    refreshed?.upsell_state === "ofrecido" ||
    refreshed?.upsell_state === "aceptado";
  if (
    latestUserIsImage &&
    !comprobanteDelSegundoProducto &&
    (stateAtLockStart === "payment_approved" ||
      postPurchaseStates.has(refreshed?.state ?? ""))
  ) {
    console.log(
      `[wh] convo ${convo.id} entrega/post-compra (initial=${stateAtLockStart}, now=${refreshed?.state}, img=${latestUserIsImage}), suprimo respuesta LLM`
    );
    return;
  }

  // ── LA ÚLTIMA PUERTA: NO SE PIDE UN MÉTODO QUE YA ESTÁ ELEGIDO ───────────
  //
  // EL PROBLEMA, VISTO EN VARIAS PRUEBAS. El cliente eligió Yape, eligió su
  // producto y recibió la cuenta. Pregunta algo, el bot se lo aclara… y remata
  // con «para darte los datos, dime: ¿con qué método prefieres pagar? Yape,
  // Plin o BCP». Le pide lo que decidió veinte mensajes antes. El cliente dice
  // «sí», y vuelve a preguntar. De ahí sale el semi-bucle.
  //
  // POR QUÉ NO SE ARREGLÓ ANTES, Y ESTO IMPORTA PARA NO REPETIRLO:
  //
  //  · Pedírselo al modelo en el prompt NO GANA. Se probó: con el aviso puesto
  //    siguió pidiendo el método. Compite con las reglas de venta del cerebro,
  //    que son más específicas, y pierde.
  //  · Adivinar lo que escribe el CLIENTE no termina nunca. Cada prueba trae
  //    una frase nueva; la lista de palabras crece y nunca cubre la siguiente.
  //
  // LA DIFERENCIA DE ESTA PUERTA: no mira al cliente ni le pide nada al modelo.
  // Mira lo que el bot VA A DECIR, justo antes de decirlo. Si va a pedir algo
  // que ya está decidido, esa frase no sale y salen sus datos. Da igual cómo la
  // formule: es la última puerta y no hay forma de rodearla.
  //
  // Y NO ES UN CAMINO NUEVO: es el mismo que ya existe unas líneas más arriba
  // para el marcador `<<METODOS_PAGO>>`, que hace exactamente esto cuando el
  // modelo lo emite. La red ya estaba puesta; se le escapaba lo que el modelo
  // pregunta en texto normal, sin marcador. Esto tapa ese agujero, con la misma
  // función de reenvío y las mismas condiciones.
  //
  // LOS CINCO FRENOS, cada uno por algo que se rompería sin él:
  //
  //  · SOLO EN `payment_done` Y CON MÉTODO ANOTADO. Antes de eso no hay nada
  //    elegido y preguntar es lo correcto.
  //  · SI EL CLIENTE PIDIÓ CAMBIAR DE MÉTODO, el bot SÍ debe preguntar. Misma
  //    comprobación que usa la puerta del marcador, compartida a propósito.
  //  · CON UNA IMAGEN EN JUEGO no se toca nada: el comprobante manda siempre.
  //  · CON EL PRODUCTO EXTRA OFRECIDO tampoco: ahí el reenvío cobra otra cosa y
  //    esa etapa la lleva la postventa.
  //  · Y SOLO SI HAY DATOS QUE REENVIAR. Si `resendPaymentDetails` no encuentra
  //    qué mandar, se deja pasar la respuesta del modelo — nunca se le deja sin
  //    respuesta por culpa de esta puerta.
  const alEnviar = getConversationById(convo.id);
  if (
    alEnviar?.state === "payment_done" &&
    !!alEnviar.selected_payment_method?.trim() &&
    alEnviar.upsell_state !== "ofrecido" &&
    alEnviar.upsell_state !== "aceptado" &&
    !latestUserIsImage &&
    !elClientePidioCambiarDeMetodo(content) &&
    laRespuestaVuelveAPedirElMetodo(reply, alEnviar.phone)
  ) {
    // LO QUE YA CONTESTÓ SE CONSERVA, Y ES LA MISMA RUTA DE SUS HERMANAS.
    //
    // Las tres puertas de marcador de este archivo —`<<METODOS_PAGO>>`,
    // `<<TRANQUILIZAR>>` y `<<REENVIAR_PAGO>>`— ya hacen esto: «si quedó texto
    // del LLM lo mandamos antes, y luego enviamos los datos». Aquí no había
    // marcador que quitar, así que se tiraba la respuesta entera y la duda del
    // cliente se quedaba sin contestar. Ver `loQueElBotYaRespondio`.
    //
    // EL ORDEN IMPORTA: primero su respuesta, después sus datos, como en las
    // otras tres. Y si ya salió esa respuesta, esta puerta NO deja pasar el
    // texto del modelo por abajo, ni cuando el reenvío falla ni cuando revienta:
    // sería mandar dos veces lo mismo, con la pregunta de más incluida. El
    // freno de «nunca se le deja sin respuesta» sigue cumpliéndose, porque la
    // respuesta ya se envió.
    let suRespuestaYaSalio = false;
    try {
      const yaRespondido = loQueElBotYaRespondio(
        stripMarkers(reply),
        alEnviar.phone
      );
      if (yaRespondido) {
        await sendChunkedBotText(fresh, yaRespondido);
        suRespuestaYaSalio = true;
      }
      // SI LOS DATOS SIGUEN EN PANTALLA, NO SE REPITEN.
      //
      // LO QUE PASÓ — 28 de septiembre de 2026, su prueba HOLAP1. El cliente
      // acababa de recibir la cuenta y preguntó «es seguro». El modelo le
      // contestó y remató pidiéndole el método otra vez; esta puerta hizo lo
      // suyo con la pregunta y ADEMÁS le soltó la cuenta encima. Con sus
      // palabras: «me lanzó los datos de pago».
      //
      // Y ES EL MISMO FRENO QUE YA TIENE SU HERMANA DEL MOTOR —ver
      // `resendPaymentDetails` llamado desde el «confirmó con los datos ya
      // enviados»—: si el bot acaba de darla, no hay nada que reenviar. Aquí
      // faltaba, y la única diferencia es que allí se mira UNA burbuja y aquí el
      // TURNO entero, porque los datos y su frase de cierre son dos burbujas.
      const yaEstabanEnPantalla = losDatosSiguenEnPantalla(convo.id);
      const reenviado = yaEstabanEnPantalla
        ? false
        : await resendPaymentDetails(alEnviar, { conFrase: true });
      if (reenviado) {
        console.log(
          `[wh] convo ${convo.id}: el bot iba a pedir un método ya elegido (${alEnviar.selected_payment_method}) → ${
            suRespuestaYaSalio
              ? "mando lo que ya había contestado y luego sus datos"
              : "mando sus datos en vez de esa respuesta"
          }`
        );
        return;
      }
      if (suRespuestaYaSalio) {
        console.warn(
          `[wh] convo ${convo.id}: ${
            yaEstabanEnPantalla
              ? "sus datos siguen en pantalla, así que no los repito"
              : "no hay datos que reenviar"
          }, pero su duda ya quedó contestada → no repito la pregunta del método`
        );
        return;
      }
      // NI DATOS NI RESPUESTA QUE CONSERVAR: SE DEJA PASAR LA DEL MODELO.
      //
      // Es el caso feo y a propósito NO se calla: dejar al cliente en silencio
      // es peor que dejar salir una pregunta de más. Ver la regla de la casa,
      // «sustituir con nada».
      if (yaEstabanEnPantalla) {
        console.warn(
          `[wh] convo ${convo.id}: sus datos siguen en pantalla y no quedó nada que conservar → dejo pasar su respuesta`
        );
      }
      console.warn(
        `[wh] convo ${convo.id}: iba a pedir el método otra vez, pero no hay datos que reenviar → dejo pasar su respuesta`
      );
    } catch (err) {
      console.error("[wh] reenvío en vez de repreguntar el método falló:", err);
      if (suRespuestaYaSalio) return;
    }
  }

  // Si la respuesta del LLM tiene doble salto de línea (\n\n) la partimos
  // en mensajes separados con delay configurable. El LLM controla esto
  // desde el system prompt (instrucción de separar "ideas" con \n\n).
  try {
    // Burbuja de ayuda del order bump: si el cliente pidió INFO de los productos
    // en la etapa de elección, se AGREGA al FINAL (después de todas las burbujas
    // del LLM) el recordatorio corto de las 2 opciones. Solo si está activado y no
    // fue pregunta de precio/pago.
    const helperBubbles = getOrderBumpChoiceHelperBubbles(fresh, content);
    // LA OFERTA DE LAS IMÁGENES, PUESTA POR EL MOTOR.
    //
    // POR QUÉ NO LA ESCRIBE EL MODELO: se le pidió y la escribió 4 veces de 11
    // —el dueño las contó—, y antes, con un marcador, 1 de 6. En un prompt de
    // 8.500 tokens una orden compite con todo lo demás. Aquí sale siempre.
    //
    // VA POR LA RUTA QUE YA EXISTÍA. `sendChunkedBotText` admite burbujas de
    // AYUDA que se programan DESPUÉS de la última del modelo y no cuentan contra
    // su límite — es lo que ya usa el recordatorio de las dos opciones. No se
    // abre ningún camino nuevo de envío.
    //
    // SE ANOTA DESPUÉS DE ENVIAR, NO ANTES. Si se anotara antes y el envío
    // fallara, la etapa quedaría marcada como ofrecida sin que el cliente haya
    // visto nada, y no volvería a ofrecerse nunca. Es la regla de la casa: no dar
    // por hecho lo que no salió.
    const laEtapaDeLaOferta = seLePidioOfrecerImagenesEnElTurnoAnterior(fresh.id);
    const laOferta = laEtapaDeLaOferta ? getSamplesOfferBubble() : "";
    const burbujas = laOferta
      ? [...(helperBubbles ?? []), laOferta]
      : helperBubbles;
    if (reply.trim() || (burbujas && burbujas.length > 0)) {
      // LA NOVEDAD VA DELANTE, Y LA DICE EL MOTOR.
      //
      // 27/09/2026. Se le pedia al modelo y se daba por dicha si su respuesta
      // nombraba las dos opciones — pero con dos opciones activas el modelo las
      // nombra en casi cualquier respuesta, asi que el aviso se apagaba en el
      // primer turno y el cliente no leia ninguna exclusiva. Dos intentos
      // apoyados en el modelo, dos fallos: la parte que DECIDE no puede depender
      // de que se acuerde.
      //
      // Sale como burbuja propia y JUSTO DETRAS la respuesta a lo que pregunto,
      // asi que no se detiene en la noticia: la lee y sigue su conversacion.
      //
      // EN «COMO -OB-» NO, mientras el segundo producto siga tapado: ahi lo
      // destapa el motor con la segunda intro del dueno cuando el cliente
      // decide pagar, y adelantarlo romperia su regla dura.
      if (
        hayQueAvisarDeLaActualizacion(fresh, loadWorkflowConfig()) &&
        !(isOrderBumpActive() && fresh.order_bump_revealed !== 1)
      ) {
        try {
          if (await enviarAvisoDeActualizacion(fresh)) {
            marcarAvisoDeActualizacionEnviado(fresh.id);
            console.log(
              `[wh] convo ${fresh.id}: le cuento que ahora hay dos opciones — no se repite`
            );
          }
        } catch (err) {
          console.error("[wh] el aviso de la actualizacion fallo:", err);
        }
      }
      await sendChunkedBotText(fresh, reply, burbujas ?? undefined);
      if (laEtapaDeLaOferta && laOferta) {
        markMediaSent(fresh.id, laEtapaDeLaOferta);
        console.log(
          `[wh] convo ${fresh.id}: el motor ofrecio las imagenes — una vez por etapa`
        );
      }
      console.log(`[wh] -> reply enviado a ${phone}`);
    } else {
      // EL BOT SE QUEDÓ MUDO, Y HASTA AHORA NO LO DECÍA NADIE.
      //
      // Si el motor no atendió el turno y el modelo devuelve vacío, aquí no se
      // enviaba nada y tampoco se escribía nada: desde fuera el bot no
      // contesta, y en el registro no hay ni una línea que lo explique. Un
      // silencio después de una compra es de lo peor que puede pasar, y era
      // justo lo que no se podía diagnosticar.
      //
      // No se inventa una respuesta —no hay ninguna que sea correcta siempre—
      // pero queda escrito con el estado y lo que dijo el cliente.
      console.error(
        `[wh] convo ${fresh.id}: SIN RESPUESTA. El motor no atendió el turno y el modelo devolvió vacío. estado=${fresh.state} cliente="${content.slice(0, 80)}"`
      );
      // PERO SI LO QUE MANDÓ FUE UN COMPROBANTE, EL SILENCIO NO VALE.
      await acusarElComprobanteSiSeQuedoMudo(fresh);
    }
  } catch (err) {
    console.error(`[wh] fallo al enviar a ${phone}:`, err);
  }
  }); // fin conLaPresentacionDeLaConversacion
  }); // fin withPhoneLock
}

/** Lo único que se dice cuando no hay nada más que decir: que llegó.
 *
 *  No nombra producto, ni precio, ni método — no puede contradecir a nadie. */
const ACUSE_DEL_COMPROBANTE =
  "Recibí tu comprobante 🙌 Dame un momento que lo reviso y te confirmo por aquí.";

/**
 * ¿HAY QUE ACUSAR EL COMPROBANTE PORQUE EL BOT SE QUEDÓ MUDO?
 *
 * LO QUE PASÓ, EL 14 DE SEPTIEMBRE DE 2026. El cliente estaba completando el
 * saldo de su upgrade. Mandó la foto del pago y escribió «ahi tiene». El motor
 * reconoció el comprobante, no supo resolverlo, el modelo devolvió vacío — y no
 * salió NADA. Volvió a insistir: «maestro ya complete para el otro». Nada otra
 * vez. Pagó, y del otro lado no hubo ni una palabra.
 *
 * Aquí ya se anotaba el silencio en el registro —eso lo puso la sesión
 * anterior— pero anotarlo no le devuelve la respuesta al cliente. Y la regla del
 * dueño es clara: «silencio es un fallo, no un caso menor».
 *
 * CUÁNDO SÍ Y CUÁNDO NO:
 *
 *  · Solo si su último mensaje fue un COMPROBANTE (foto o PDF del banco). Si
 *    escribió texto y el modelo se quedó mudo, eso es otro problema y se
 *    diagnostica con la línea del registro; acusar un comprobante que no existe
 *    sería inventar.
 *  · NO si el pago se acaba de aprobar. Ahí la entrega ya salió con sus
 *    burbujas, y añadir «dame un momento que lo reviso» detrás sería
 *    contradecirla — el peor mensaje posible justo después de entregar.
 *
 * NO VA ACOTADO A UNA MODALIDAD, y es a propósito: no existe ninguna en la que
 * callarse tras recibir un pago sea correcto. Además solo se ejecuta cuando el
 * bot NO iba a enviar absolutamente nada, así que no puede pisar ningún
 * comportamiento que hoy funcione.
 */
export function debeAcusarElComprobante(
  ultimoDelCliente: { media_type?: string | null } | null | undefined,
  convo: { state?: string | null; paid_at?: number | null },
  ahoraSegundos: number,
  esPdfDeBanco = false
): boolean {
  const esComprobante = ultimoDelCliente?.media_type === "image" || esPdfDeBanco;
  if (!esComprobante) return false;
  // EL FRENO MIRA EL PAGO, NO EL ESTADO. Y ESO ME COSTÓ UN MENSAJE TONTO.
  //
  // La primera versión exigía `state === "payment_approved"`. Parecía lo mismo y
  // no lo era: en el UPGRADE, el motor aprueba el pago y programa la entrega
  // mientras la conversación todavía figura en `payment_done`. El freno no
  // saltaba, y detrás del «¡PAGO APROBADO!» con su enlace salía un
  // «Recibí tu comprobante, dame un momento que lo reviso». Lo vio el dueño el
  // 14 de septiembre de 2026, en su recorrido de -OB-:
  //
  //     [wf:pago] convo 61 APROBADO (total: S/. 15 Soles)
  //     [wh] convo 61: ... estado=payment_done
  //     [wh] convo 61: llegó un comprobante y nadie contestó → acuso recibo
  //
  // `setPaidAt` se graba EN LA APROBACIÓN (payment.ts:1448 y :2057), pase lo que
  // pase con el estado. Así que preguntar por el sello del pago sí distingue
  // «acaban de cobrarle» de «su comprobante se quedó sin resolver», que es lo
  // único que este acuse tiene que separar.
  const recienEntregado =
    typeof convo.paid_at === "number" && ahoraSegundos - convo.paid_at <= 120;
  return !recienEntregado;
}

async function acusarElComprobanteSiSeQuedoMudo(
  convo: ConversationRow
): Promise<void> {
  const ultimo = getLatestUserMessage(convo.id);
  const esPdf = !!ultimo && esComprobantePdf(ultimo);
  // LA CONVERSACIÓN SE VUELVE A LEER, Y ESA ERA LA MITAD QUE FALTABA.
  //
  // El freno de abajo pregunta por `paid_at` para no acusar un comprobante que
  // ACABA de aprobarse. Pero la fila que llega aquí se leyó al EMPEZAR el turno,
  // antes de que el lector aprobara el pago del upgrade: traía el `paid_at` de
  // la compra anterior, de hace varios minutos, así que el freno no saltaba.
  //
  // El dueño lo vio el 14 de septiembre de 2026 en -OB-: se le entregó el enlace
  // del upgrade y detrás le salió «Recibí tu comprobante 🙌 dame un momento que
  // lo reviso». Con sus palabras, «este aviso confundirá al cliente, pensará que
  // aún no le ha llegado su enlace y reclamará».
  //
  //     [wf:pago] convo 84 APROBADO (total: S/. 15 Soles)
  //     [wf] enviando payment_approved step 0 (text) a convo 84
  //     [wh] convo 84: llegó un comprobante y nadie contestó → acuso recibo
  //
  // En otras dos ventanas no salió, y no fue suerte: allí la primera compra era
  // tan reciente que el sello viejo todavía caía dentro de los 120 segundos.
  const alDia = getConversationById(convo.id) ?? convo;
  if (
    !debeAcusarElComprobante(
      ultimo,
      alDia,
      Math.floor(Date.now() / 1000),
      esPdf
    )
  )
    return;
  try {
    await sendChunkedBotText(convo, ACUSE_DEL_COMPROBANTE);
    console.log(
      `[wh] convo ${convo.id}: llegó un comprobante y nadie contestó → acuso recibo para no dejarlo en silencio`
    );
  } catch (err) {
    console.error("[wh] no pude acusar el comprobante:", err);
  }
}

/**
 * QUÉ SIGNIFICA UN BOTÓN PULSADO (22/10/2026). Antes vivía dentro de `processIncomingMessage`, solo
 * para WhatsApp. Messenger manda sus botones como respuestas rápidas con el MISMO id, y llega aquí
 * para traducirse igual: `texto` es lo que se enruta al motor; `visible`, lo que queda escrito en el
 * chat cuando no es lo mismo (solo los botones del editor). El cuerpo es el de siempre, sin cambios.
 */
export function textoDelBotonPulsado(id: string, title: string): { texto: string; visible: string | null } {
  let text: string;
  let visible: string | null = null;
  if (id.startsWith("pmethod:")) {
    text = id.slice("pmethod:".length).split(":")[0].trim();
  } else if (id.startsWith("bubble:")) {
    // Botón configurable del editor: el id interno es lo que se enruta —es lo
    // único que encuentra la acción—, pero en el chat queda SU ETIQUETA.
    // Ver `contenidoVisible` arriba.
    text = id;
    visible = title.trim() || id;
  } else if (id === "upsell_si" || id === "upsell_no") {
    // Botones del PRODUCTO EXTRA: va el TEXTO DEL BOTÓN, tal cual.
    //
    // Antes se cambiaba por el nombre del producto, para que la detección lo
    // reconociera. Funcionaba, pero dejaba escrito en la conversación algo
    // que el cliente nunca escribió: él tocaba «Sí, lo quiero» y en el chat
    // quedaba «PRODUCTO UPSELL». Al revisar un chat para entender qué pasó,
    // eso engaña.
    //
    // Ahora el motor reconoce la elección comparándola contra las etiquetas
    // configuradas (ver botonDelUpsell), así que el disfraz sobra.
    text = title.trim();
  } else if (id === "ob_combo" || id === "ob_basico") {
    // Estos SÍ se traducen, y por un motivo distinto: aquí el título del
    // botón ES el nombre del producto, solo que WhatsApp lo corta a 20
    // caracteres. No se está cambiando por otra cosa, se está completando —
    // y si no se completa, la elección no se reconoce y el pago se valida
    // contra el precio equivocado.
    // Resuelve el nombre desde la modalidad ACTIVA (order bump O doble oferta 2
    // productos), NO desde order_bump fijo. Si no, el botón de doble oferta
    // jalaba el nombre de una opción de order bump y rompía la
    // elección → caía al LLM y hablaba del producto que no era.
    const ob = getActiveTwoTierOffer(loadWorkflowConfig());
    const opt = id === "ob_combo" ? ob?.combo : ob?.basico;
    text = opt?.name?.trim() || title.trim();
  } else if (id.startsWith("gift_accept:") || id.startsWith("gift_reject:")) {
    // BOTONES DEL REGALO: va el TEXTO DEL BOTÓN, tal cual. Mismo motivo que
    // los del producto extra, y aquí además hacía daño de verdad.
    //
    // Antes se cambiaban por "Si quiero" y "Por ahora no", pasara lo que
    // pasara con la etiqueta configurada. Dos problemas:
    //
    //  · En el chat quedaba escrito algo que el cliente nunca escribió. Al
    //    revisar una conversación para entender qué pasó, eso engaña.
    //  · Y "si quiero" es una respuesta genérica que CUALQUIER otra pregunta
    //    abierta puede reclamar. Con la oferta del segundo producto en pie,
    //    tocar el botón del REGALO disparaba la compra del UPSELL — siempre,
    //    no por casualidad: el disfraz coincidía palabra por palabra con sus
    //    palabras clave. Ponerle otra etiqueta al botón no servía de nada,
    //    porque la etiqueta se tiraba aquí.
    //
    // Mandando el texto real, el motor lo reconoce comparándolo contra las
    // etiquetas configuradas (ver botonDelRegalo) — exacto, sin adivinar — y
    // ninguna otra pregunta puede confundirlo con un "sí" suelto.
    text = title.trim();
  } else {
    text = title.trim();
  }
  return { texto: text, visible };
}
