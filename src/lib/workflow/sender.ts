import {
  insertMessage,
  insertMessageWithMedia,
  setTestMessageButtons,
  updateMessageStatus,
  updateMessageWaId,
  type ConversationRow,
} from "@/lib/db";
import {
  sendTextMessage,
  sendAudioMessage,
  sendImageMessage,
  sendInteractiveButtons,
  sendVideoMessage,
  sendDocumentMessage,
  uploadMediaToMeta,
} from "@/lib/meta/client";
import { sendMessengerMedia, sendMessengerText } from "@/lib/messenger/client";
import { sendInstagramMedia, sendInstagramText } from "@/lib/instagram/client";
import { getReadyMediaFromDrive } from "@/lib/workflow/drive";
import { marcaDeAdjunto } from "@/lib/marca-de-adjunto";
import { formatCurrencyAmount, getCountryInfo } from "@/lib/countries";
import {
  applyProductName,
  getEffectiveCountryCode,
  getEffectivePriceSoles,
  getNombreCompleto,
  getNumeroDeCuenta,
  getPaymentMethodsList,
  getPaymentRecipientName,
  getPaymentText,
  getOrderBumpPriceSoles,
  isDiscountActiveForConversation,
  loadWorkflowConfig,
  renderOrderBumpTemplate,
  resolveCountryPaymentProfile,
  resolveSpintax,
} from "@/lib/workflow/config";
import { literal } from "@/lib/texto-literal";

function isUsableDisplayName(value: string | null | undefined): boolean {
  const text = (value ?? "").trim();
  if (!text || text.length > 40) return false;
  const normalized = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  if (!normalized || /^\d+$/.test(normalized)) return false;
  const words = normalized.split(" ").filter(Boolean);
  if (words.length < 1 || words.length > 3) return false;
  const blocked = new Set([
    "cliente",
    "usuario",
    "whatsapp",
    "ventas",
    "venta",
    "tienda",
    "negocio",
    "empresa",
    "precio",
    "info",
    "informacion",
    "curso",
    "producto",
    "pack",
    "combo",
    "oferta",
    "yape",
    "plin",
    "bcp",
    "pago",
  ]);
  return words.every((word) => word.length >= 2 && !blocked.has(word));
}

function resolveDisplayName(convo: ConversationRow): string {
  const clientName = (convo.client_name ?? "").trim();
  if (isUsableDisplayName(clientName)) return clientName;
  const whatsappName = (convo.name ?? "").trim();
  if (isUsableDisplayName(whatsappName)) return whatsappName;
  return "";
}

/**
 * LOS CAJONES DE PAGO DEL PAÍS, PUESTOS EN SU SITIO.
 *
 * {{METODO_DE_PAGO_1}} y compañía no son un dato: son un TEXTO que el operador
 * escribe por país, y ese texto lleva dentro sus propios comodines
 * ({{NOMBRE_RECEPTOR}}, {{PRECIO_COMPLETO}}, {precio}…). Por eso se expanden
 * ANTES: lo que sale de aquí todavía tiene que pasar por el resolvedor de
 * precios, o esos comodines de dentro salen crudos.
 *
 * ESTABA SOLO DENTRO DEL ENVÍO, Y AHÍ YA ERA TARDE.
 *
 * Cuando el motor manda un paso con un precio DISTINTO al del curso —el del
 * upsell, el de la opción elegida— pasa ese precio aparte. Pero el cajón se
 * abría después, dentro del envío, donde ese precio ya no existe: el
 * {{PRECIO_COMPLETO}} de dentro del cajón se resolvía con el precio de la
 * PRIMERA compra.
 *
 * Pasó de verdad: se aceptaba el segundo producto de 7.500 y los datos de pago
 * pedían 6.000, que era lo que el cliente ya había pagado. No da error, no
 * avisa: cobra de menos y queda un comprobante correcto por el monto
 * equivocado.
 *
 * Ahora se puede abrir el cajón antes, desde el motor, para que su contenido
 * pase por el mismo resolvedor que el resto del paso. Aplicarlo dos veces no
 * hace daño: la segunda ya no encuentra nada que sustituir.
 */
export function expandirCajonesDePagoDelPais(
  text: string,
  convo: ConversationRow
): string {
  if (!text) return text;
  const profile = resolveCountryPaymentProfile(getEffectiveCountryCode(convo.phone));
  return text
    .replace(
      /\{\{\s*(precio_pre_eleccion|precio_preeleccion|pre_choice_price|pre_eleccion)\s*\}\}/gi,
      literal(profile?.pre_choice_price_response ?? "")
    )
    .replace(
      /\{\{\s*(metodo_de_pago_1|metodo_pago_1)\s*\}\}/gi,
      literal(profile?.metodo_pago_1 ?? "")
    )
    .replace(
      /\{\{\s*(metodo_de_pago_2|metodo_pago_2)\s*\}\}/gi,
      literal(profile?.metodo_pago_2 ?? "")
    )
    .replace(
      /\{\{\s*(metodo_de_pago_3|metodo_pago_3)\s*\}\}/gi,
      literal(profile?.metodo_pago_3 ?? "")
    )
    .replace(
      /\{\{\s*(metodo_de_pago_principal|metodo_pago_principal|metodo_de_pago_prioritario)\s*\}\}/gi,
      literal(profile?.metodo_pago_principal ?? "")
    );
}

function renderOutboundTemplate(text: string, convo: ConversationRow): string {
  if (!text) return text;
  const discountActive = isDiscountActiveForConversation(convo);
  const countryCode = getEffectiveCountryCode(convo.phone);
  const country = getCountryInfo(countryCode);
  const lockedPrice =
    typeof convo.locked_price_cents === "number" && convo.locked_price_cents > 0
      ? convo.locked_price_cents / 100
      : null;
  const currentBasePrice = getEffectivePriceSoles(discountActive, convo.phone);
  const lockedChoice = convo.locked_price_source?.startsWith("two_tier:")
    ? convo.locked_price_source.includes("combo")
      ? "combo"
      : "basico"
    : null;
  const currentLockedPrice = lockedChoice
    ? getOrderBumpPriceSoles(lockedChoice, discountActive, convo.phone) ?? currentBasePrice
    : currentBasePrice;
  const price = lockedPrice !== null && convo.frozen_prices
    ? Math.min(lockedPrice, currentLockedPrice)
    : lockedPrice ?? currentBasePrice;
  const priceText = Number.isInteger(price) ? String(price) : price.toFixed(2);
  const fullPriceUpper = formatCurrencyAmount(
    price,
    countryCode,
    convo.locked_price_currency ?? country.currency,
    "upper"
  );
  const paymentRecipient = getPaymentRecipientName(convo.phone);
  const nombreCompleto = getNombreCompleto(convo.phone);
  // LA CUENTA DEL MÉTODO QUE ELIGIÓ, no «la cuenta del país».
  //
  // En un país se cobra por billetera Y por banco, y son cuentas distintas. El
  // método ya venía guardado en la conversación desde antes de esto, así que no
  // hubo que pasarlo de función en función: se lee de aquí.
  //
  // Sin método elegido todavía —un texto que nombra la cuenta antes de elegir—
  // devuelve la cuenta suelta, que es el comportamiento de siempre.
  const numeroDeCuenta = getNumeroDeCuenta(
    convo.phone,
    convo.selected_payment_method
  );
  const paymentMethodsText = getPaymentText(convo.phone);
  const paymentMethodsList = getPaymentMethodsList(convo.phone);
  // {{PRECIO_SEGUN_ELECCION}}: precio de la OPCIÓN elegida (combo/básico) con
  // contexto en mayúsculas ("$ 2 DÓLARES"). Sin elección aún, usa el precio base.
  const choice = convo.order_bump_choice;
  const precioSegunEleccionSoles =
    choice === "combo" || choice === "basico"
      ? getOrderBumpPriceSoles(choice, discountActive, convo.phone) ?? price
      : price;
  const precioSegunEleccion = formatCurrencyAmount(
    precioSegunEleccionSoles,
    countryCode,
    convo.locked_price_currency ?? country.currency,
    "upper"
  );
  const withInserts = expandirCajonesDePagoDelPais(text, convo);
  return renderOrderBumpTemplate(withInserts, discountActive, convo.phone)
    .replace(
      /\{\{\s*(precio_segun_eleccion|precio_eleccion|precio_elegido|precio_opcion|precio_segun_opcion)\s*\}\}/gi,
      literal(precioSegunEleccion)
    )
    .replace(
      /(?:S\/\.?|US?\$|\$|Bs\.?|Q|₡)\s*\{\{?\s*(?:precio|price)\s*\}?\}\s*(?:sol(?:es)?|d[oó]lares?|pesos?|bol[ií]vares?|quetzales?|colones?)/gi,
      literal(fullPriceUpper)
    )
    .replace(
      /\{\{\s*(precio_completo_mayusculas|precio_full_mayusculas|full_price_upper)\s*\}\}/gi,
      literal(formatCurrencyAmount(
        price,
        countryCode,
        convo.locked_price_currency ?? country.currency,
        "upper"
      ))
    )
    .replace(
      /\{\{\s*(precio_completo_minusculas|precio_full_minusculas|full_price_lower)\s*\}\}/gi,
      literal(formatCurrencyAmount(
        price,
        countryCode,
        convo.locked_price_currency ?? country.currency,
        "lower"
      ))
    )
    .replace(
      // `precio_full` YA NO ESTÁ AQUÍ: en este proyecto significaba "precio
      // completo" (el precio con su moneda), y ese nombre se lo quedó el
      // precio del producto FULL, que lo resuelve renderOrderBumpTemplate más
      // arriba. Dos significados para el mismo nombre y ganaba el de abajo:
      // escribías {{PRECIO_FULL}} y salía el precio del base.
      /\{\{\s*(precio_completo|precio_label|price_label|full_price)\s*\}\}/gi,
      literal(formatCurrencyAmount(price, countryCode, convo.locked_price_currency ?? country.currency))
    )
    .replace(
      /\{\{\s*(nombre_receptor|receptor_pago|payment_recipient|recipient_name)\s*\}\}/gi,
      literal(paymentRecipient || "[Nombre del receptor sin configurar]")
    )
    // TU NOMBRE COMPLETO, SOLO PARA LEER.
    //
    // Va ANTES del receptor no, va justo detrás: son dos comodines distintos y
    // no se pisan. El del receptor valida el comprobante y no se puede tocar;
    // éste es libre y no entra en ninguna comprobación. Vacío cae en el del
    // receptor, así que quien no lo llene ve lo de siempre.
    .replace(
      /\{\{\s*(nombre_completo|mi_nombre|nombre_vendedor|full_name)\s*\}\}/gi,
      literal(nombreCompleto || "[Tu nombre sin configurar]")
    )
    // VA DESPUÉS DE LOS CAJONES A PROPÓSITO.
    //
    // `expandirCajonesDePagoDelPais` ya corrió arriba, así que aquí el texto de
    // «Datos de pago 1/2/3» ya está puesto. Por eso el número también se
    // resuelve cuando se escribe DENTRO de un cajón, que es donde de verdad se
    // va a usar. Mismo sitio y mismo motivo que el nombre del receptor.
    // UNA CUENTA CONCRETA, NOMBRÁNDOLA: {{CUENTA_<SU MÉTODO>}}
    //
    // Los ejemplos van sin marcas a propósito —«{{CUENTA_BILLETERA}}»,
    // «{{CUENTA_BANCO}}»—: en este código no se escribe ningún nombre de método de
    // pago ni de banco, porque son distintos en cada país y esto es una plantilla.
    //
    // LO ENCONTRÓ EL DUEÑO USÁNDOLO, el 01/10/2026: «PUTA MADRE ME MAREO, YA QUE
    // EN UNA BURBUJA TENGO EL NUMERO DE BCP Y EL YAPE JUNTOS».
    //
    // Y tenía razón: hay burbujas suyas que listan LAS DOS cuentas en el mismo
    // texto —«Yape: … / BCP: …»— para que el cliente elija al leer. Ahí
    // {{NUMERO_DE_CUENTA}} no alcanza: ése se resuelve por el método ELEGIDO, y
    // cuando todavía no hay ninguno elegido, o cuando hacen falta dos a la vez,
    // solo puede dar uno. Medido en su configuración: 3 sitios así.
    //
    // Éste se resuelve por el método que se NOMBRA en el comodín, no por el
    // elegido. Así una burbuja puede listar las dos cuentas y las dos siguen al
    // usuario que cobra en ese número.
    //
    // LA CLAVE ES SUYA, no del código: {{CUENTA_<lo que él llamó al método>}}.
    // El motor no conoce ni un nombre de método — se busca en su tabla, y si no
    // está, se avisa en el propio mensaje en vez de dejar un hueco mudo.
    // Aquí no hace falta `literal`: lo que devuelve una función de reemplazo se
    // escribe tal cual, así que un «$» del número no se interpreta.
    .replace(
      /\{\{\s*cuenta_([a-z0-9_]+)\s*\}\}/gi,
      (_entero: string, metodo: string) =>
        getNumeroDeCuenta(convo.phone, metodo) ||
        `[Cuenta de ${metodo} sin configurar]`
    )
    .replace(
      /\{\{\s*(numero_de_cuenta|numero_cuenta|cuenta|account_number)\s*\}\}/gi,
      literal(numeroDeCuenta || "[Número de cuenta sin configurar]")
    )
    .replace(
      /\{\{\s*(metodos_de_pago_por_pais|metodos_pago_pais|payment_methods_by_country)\s*\}\}/gi,
      literal(paymentMethodsText)
    )
    .replace(
      /\{\{\s*(lista_metodos_por_pais|lista_metodos_pago_por_pais|payment_methods_list_by_country)\s*\}\}/gi,
      literal(paymentMethodsList)
    )
    .replace(
      /\{\{\s*(currency|moneda_iso|codigo_moneda|currency_code)\s*\}\}/gi,
      literal(convo.locked_price_currency ?? country.currency)
    )
    .replace(/\{\{?\s*(moneda|simbolo|sÃ­mbolo|símbolo)\s*\}?\}/gi, literal(country.symbol))
    // {precio}/{price} con CONTEXTO en mayúsculas ("S/. 10 SOLES" / "$ 3 DÓLARES").
    // El caso "S/. {precio} soles" (moneda escrita a mano alrededor) ya se colapsó
    // arriba, así que aquí solo quedan los {precio} sueltos.
    .replace(/\{price\}/gi, literal(fullPriceUpper))
    .replace(/\{precio\}/gi, literal(fullPriceUpper));
}

function renderNameTemplate(text: string, convo: ConversationRow): string {
  if (!text) return text;
  const withProduct = resolveSpintax(applyProductName(renderOutboundTemplate(text, convo)));
  if (!/\{\{\s*NOMBRE(?:_WHATSAPP)?\s*\}\}/i.test(withProduct)) {
    return withProduct;
  }
  const name = resolveDisplayName(convo);
  return withProduct
    .replace(/\{\{\s*NOMBRE(?:_WHATSAPP)?\s*\}\}/gi, literal(name))
    .replace(/[ \t]+([!¡?¿,.;:])/g, "$1")
    .replace(/([¡¿])[ \t]+/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(
      /\b(Hola|Buenos dias|Buenas tardes|Buenas noches),\s*([!¡?¿])/gi,
      "$1 $2"
    )
    .trim();
}

function sanitizeOutboundText(text: string): string {
  return text.replace(/\bal\s+toque\b/gi, "de inmediato");
}

/**
 * UNA MUESTRA ENTERA: SU ARCHIVO Y LAS BURBUJAS QUE LA ACOMPAÑAN.
 *
 * Una muestra era UN archivo con su pie, y nada más. Para decir dos cosas había
 * que crear una segunda muestra, y las muestras se reparten por TEMA: la segunda
 * salía en otro momento, o no salía. Ahora una muestra puede llevar burbujas
 * detrás, y salen pegadas a ella, antes de la siguiente.
 *
 * VIVE AQUÍ Y NO EN CADA SITIO QUE ENVÍA UNA. Hay seis, y escrito seis veces
 * acabaría enviándose distinto según por dónde saliera el mensaje.
 *
 * SIN BURBUJAS EXTRA HACE EXACTAMENTE LO DE ANTES: manda el archivo y se acabó.
 */
export async function enviarMuestraDeGaleria(
  convo: ConversationRow,
  muestra: {
    media_type?: "image" | "video" | "document" | "audio";
    drive_url?: string;
    caption?: string;
    pasos_extra?: {
      type?: string;
      enabled?: boolean;
      drive_url?: string;
      body?: string;
      body_variants?: string[];
      caption?: string;
      caption_variants?: string[];
      delay_after_sec?: number;
    }[];
  },
  /** El pie ya resuelto, si quien llama lo eligió (variantes, comodines). */
  pie?: string
): Promise<void> {
  await sendBotMediaFromDrive(
    convo,
    muestra.media_type ?? "image",
    muestra.drive_url ?? "",
    (pie ?? muestra.caption)?.trim() || undefined
  );
  for (const paso of muestra.pasos_extra ?? []) {
    if (paso?.enabled === false) continue;
    const texto =
      (paso.body_variants ?? []).find((t) => (t ?? "").trim()) ??
      paso.body ??
      (paso.caption_variants ?? []).find((t) => (t ?? "").trim()) ??
      paso.caption ??
      "";
    const tipo = paso.type ?? "text";
    // Una burbuja sin nada dentro no se manda: en blanco el cliente ve un
    // mensaje vacío y no hay forma de saber que faltaba algo.
    if (tipo === "text") {
      if (texto.trim()) await sendBotText(convo, texto);
    } else if ((paso.drive_url ?? "").trim()) {
      await sendBotMediaFromDrive(
        convo,
        tipo as "image" | "video" | "document" | "audio",
        paso.drive_url ?? "",
        texto.trim() || undefined
      );
    }
    const espera = paso.delay_after_sec ?? 0;
    if (espera > 0) await new Promise((r) => setTimeout(r, espera * 1000));
  }
}

/** Envía texto como bot, lo guarda en BD y actualiza wa_message_id. */
export async function sendBotText(
  convo: ConversationRow,
  body: string
): Promise<number> {
  const safeBody = sanitizeOutboundText(renderNameTemplate(body, convo));
  // NUNCA UNA BURBUJA EN BLANCO.
  //
  // Un comodín que no tiene nada detrás —típico: {{METODO_DE_PAGO_1}} en un país
  // cuya tienda todavía no tiene escritos sus datos de pago— deja el texto
  // vacío, y hasta ahora esa burbuja se mandaba igual. El cliente veía un globo
  // blanco en medio de los datos de pago: no da error, no avisa a nadie, y lo
  // que falta es justo el número al que hay que pagar.
  //
  // Se descarta y se deja escrito en el registro con el principio del texto sin
  // resolver, para poder ver QUÉ comodín se quedó sin valor.
  if (!safeBody.trim()) {
    console.error(
      `[wf] convo ${convo.id}: burbuja VACÍA descartada. Sin resolver: ${JSON.stringify(
        (body ?? "").slice(0, 120)
      )} — revisa Precios y pagos del país de esta conversación.`
    );
    return 0;
  }
  const messageId = insertMessage(convo.id, "assistant", safeBody, null);
  if (convo.channel === "test") {
    updateMessageWaId(messageId, `test:${messageId}`);
    updateMessageStatus(`test:${messageId}`, "delivered");
    return messageId;
  }
  if (convo.channel === "messenger") {
    try {
      await sendMessengerText(convo.phone.replace(/^messenger:/, ""), safeBody);
      updateMessageWaId(messageId, `messenger:${messageId}`);
      updateMessageStatus(`messenger:${messageId}`, "sent");
    } catch (err) {
      console.error("[wf] error enviando texto Messenger:", err);
      throw err;
    }
    return messageId;
  }
  if (convo.channel === "instagram") {
    try {
      await sendInstagramText(convo.phone.replace(/^instagram:/, ""), safeBody);
      updateMessageWaId(messageId, `instagram:${messageId}`);
      updateMessageStatus(`instagram:${messageId}`, "sent");
    } catch (err) {
      console.error("[wf] error enviando texto Instagram:", err);
      throw err;
    }
    return messageId;
  }
  try {
    const { wa_message_id } = await sendTextMessage(convo.phone, safeBody);
    updateMessageWaId(messageId, wa_message_id);
  } catch (err) {
    console.error("[wf] error enviando texto:", err);
    throw err;
  }
  return messageId;
}

/**
 * Envía un mensaje con BOTONES de respuesta como bot y lo guarda en BD (la UI
 * del agente muestra el texto del cuerpo). El cliente elige tocando un botón.
 */
/**
 * Guarda los botones que acompañaron a un mensaje, para poder dibujarlos
 * después en el chat del panel.
 *
 * Es COSMÉTICO. Va siempre después de que el mensaje ya salió, y envuelto: si
 * este guardado fallara, se anota y se sigue. Nunca puede cortar un envío ni la
 * secuencia de entrega que venga detrás — eso es lo último que debe pasar.
 */
function recordarBotones(
  messageId: number,
  buttons: { id: string; title: string }[]
): void {
  try {
    setTestMessageButtons(messageId, buttons);
  } catch (err) {
    console.error("[wf] no se pudieron guardar los botones del mensaje:", err);
  }
}

export async function sendBotButtons(
  convo: ConversationRow,
  bodyText: string,
  buttons: { id: string; title: string }[]
): Promise<number> {
  const safeBody = sanitizeOutboundText(renderNameTemplate(bodyText, convo));
  if (convo.channel === "test") {
    const messageId = insertMessage(convo.id, "assistant", safeBody, null);
    recordarBotones(messageId, buttons);
    updateMessageWaId(messageId, `test:${messageId}`);
    updateMessageStatus(`test:${messageId}`, "delivered");
    return messageId;
  }
  if (convo.channel === "messenger" || convo.channel === "instagram") {
    const asText = [
      safeBody,
      ...buttons.map((button, index) => `${index + 1}. ${button.title}`),
    ]
      .filter(Boolean)
      .join("\n");
    return sendBotText(convo, asText);
  }
  const messageId = insertMessage(convo.id, "assistant", safeBody, null);
  try {
    const { wa_message_id } = await sendInteractiveButtons(
      convo.phone,
      safeBody,
      buttons
    );
    updateMessageWaId(messageId, wa_message_id);
  } catch (err) {
    console.error("[wf] error enviando botones:", err);
    throw err;
  }
  // El mensaje ya salió. Los botones se guardan solo para poder verlos luego en
  // el chat: antes se guardaban únicamente en el simulador y en una
  // conversación real se perdían.
  recordarBotones(messageId, buttons);
  return messageId;
}

/**
 * Botones de respuesta CON media (imagen/video) en la cabecera — todo en UNA
 * burbuja: media arriba, texto en el cuerpo, botones abajo.
 */
export async function sendBotButtonsWithMedia(
  convo: ConversationRow,
  kind: "image" | "video",
  driveUrl: string,
  bodyText: string,
  buttons: { id: string; title: string }[]
): Promise<number> {
  if (convo.channel === "test") {
    await sendBotMediaFromDrive(convo, kind, driveUrl);
    return sendBotButtons(convo, bodyText, buttons);
  }
  if (convo.channel === "messenger" || convo.channel === "instagram") {
    await sendBotMediaFromDrive(convo, kind, driveUrl);
    return sendBotButtons(convo, bodyText, buttons);
  }
  const ready = await getReadyMediaFromDrive(driveUrl, kind);
  const { media_id } = await uploadMediaToMeta(ready.abs_path, ready.mime);
  const safeBody = sanitizeOutboundText(renderNameTemplate(bodyText, convo));
  const messageId = insertMessage(convo.id, "assistant", safeBody, null);
  try {
    const { wa_message_id } = await sendInteractiveButtons(
      convo.phone,
      safeBody,
      buttons,
      { mediaType: kind, mediaId: media_id }
    );
    updateMessageWaId(messageId, wa_message_id);
  } catch (err) {
    console.error("[wf] error enviando botones con media:", err);
    throw err;
  }
  recordarBotones(messageId, buttons);
  return messageId;
}

/**
 * Envía media (audio/image/video/document) descargado desde Drive como bot. Guarda en
 * BD para que aparezca en la UI del agente y queda como historial.
 */
export async function sendBotMediaFromDrive(
  convo: ConversationRow,
  kind: "audio" | "image" | "video" | "document",
  driveUrl: string,
  caption?: string
): Promise<number> {
  if (convo.channel === "test") {
    const ready = await getReadyMediaFromDrive(driveUrl, kind);
    const safeCaption = caption
      ? sanitizeOutboundText(renderNameTemplate(caption, convo))
      : undefined;
    const content = safeCaption || marcaDeAdjunto(kind);
    const messageId = insertMessageWithMedia(convo.id, "assistant", content, null, {
      media_type: kind,
      media_url: ready.rel_path,
      media_mime: ready.mime,
      media_filename: null,
      transcription: null,
      duration_sec: null,
    });
    updateMessageWaId(messageId, `test:${messageId}`);
    updateMessageStatus(`test:${messageId}`, "delivered");
    return messageId;
  }
  if (convo.channel === "messenger") {
    const ready = await getReadyMediaFromDrive(driveUrl, kind);
    const safeCaption = caption
      ? sanitizeOutboundText(renderNameTemplate(caption, convo))
      : undefined;
    const content = safeCaption || marcaDeAdjunto(kind);
    const messageId = insertMessageWithMedia(convo.id, "assistant", content, null, {
      media_type: kind,
      media_url: ready.rel_path,
      media_mime: ready.mime,
      media_filename: null,
      transcription: null,
      duration_sec: null,
    });
    try {
      await sendMessengerMedia(
        convo.phone.replace(/^messenger:/, ""),
        kind,
        ready.abs_path,
        ready.mime,
        safeCaption
      );
      updateMessageWaId(messageId, `messenger:${messageId}`);
      updateMessageStatus(`messenger:${messageId}`, "sent");
    } catch (err) {
      console.error("[wf] error enviando media Messenger:", err);
      throw err;
    }
    return messageId;
  }
  if (convo.channel === "instagram") {
    const ready = await getReadyMediaFromDrive(driveUrl, kind);
    const safeCaption = caption
      ? sanitizeOutboundText(renderNameTemplate(caption, convo))
      : undefined;
    const content = safeCaption || marcaDeAdjunto(kind);
    const messageId = insertMessageWithMedia(convo.id, "assistant", content, null, {
      media_type: kind,
      media_url: ready.rel_path,
      media_mime: ready.mime,
      media_filename: null,
      transcription: null,
      duration_sec: null,
    });
    try {
      await sendInstagramMedia(
        convo.phone.replace(/^instagram:/, ""),
        kind,
        ready.abs_path,
        ready.mime,
        safeCaption
      );
      updateMessageWaId(messageId, `instagram:${messageId}`);
      updateMessageStatus(`instagram:${messageId}`, "sent");
    } catch (err) {
      console.error("[wf] error enviando media Instagram:", err);
      throw err;
    }
    return messageId;
  }
  const ready = await getReadyMediaFromDrive(driveUrl, kind);
  const { media_id } = await uploadMediaToMeta(ready.abs_path, ready.mime);

  let waMsgId: string;
  const safeCaption = caption
    ? sanitizeOutboundText(renderNameTemplate(caption, convo))
    : undefined;
  if (kind === "audio") {
    waMsgId = (await sendAudioMessage(convo.phone, media_id)).wa_message_id;
  } else if (kind === "image") {
    waMsgId = (await sendImageMessage(convo.phone, media_id, safeCaption))
      .wa_message_id;
  } else if (kind === "video") {
    waMsgId = (await sendVideoMessage(convo.phone, media_id, safeCaption))
      .wa_message_id;
  } else {
    waMsgId = (
      await sendDocumentMessage(convo.phone, media_id, "muestra.pdf", safeCaption)
    ).wa_message_id;
  }

  const content = safeCaption || marcaDeAdjunto(kind);
  const messageId = insertMessageWithMedia(convo.id, "assistant", content, waMsgId, {
    media_type: kind,
    media_url: ready.rel_path,
    media_mime: ready.mime,
    media_filename: null,
    transcription: null,
    duration_sec: null,
  });
  // Acá el INSERT no setea wa_status (insertMessageWithMedia no lo toca);
  // marcamos 'sent' explícitamente para que la UI muestre la palomita
  // gris desde ya. El webhook luego mueve a delivered/read.
  updateMessageStatus(waMsgId, "sent");
  return messageId;
}
