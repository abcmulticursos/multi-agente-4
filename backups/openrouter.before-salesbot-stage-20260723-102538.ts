import fs from "node:fs";
import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionMessageToolCall,
} from "openai/resources/chat/completions";
import {
  getConversationById,
  getRecentUserMessages,
  getSentMedia,
  markMediaSent,
  type ConversationRow,
  type MessageRow,
} from "@/lib/db";
import { resolveMediaAbsPath } from "@/lib/meta/media";
import { getCountryInfo } from "@/lib/countries";
import { sendBotMediaFromDrive, sendBotText } from "@/lib/workflow/sender";
import { SYSTEM_PROMPT, assemblePrompt } from "@/lib/system-prompt";
import {
  DEFAULT_ORDER_BUMP_OPTION_PRESENTATION_RULE,
  applyProductName,
  detectOrderBumpChoice,
  getEffectiveCountryCode,
  getBiofertaPriceSoles,
  getEffectivePriceSoles,
  getComplementInfoTopic,
  getDetailGallery,
  getDistrustMessage,
  getImageGallery,
  getOrderBumpPriceSoles,
  getPaymentText,
  getProductInfoTopics,
  getProgressiveSamplesConfig,
  inferTwoTierChoiceFromContext,
  isDiscountActiveForConversation,
  isOrderBumpConversationQuestion,
  isPriceQuestion,
  loadWorkflowConfig,
  renderOrderBumpTemplate,
} from "@/lib/workflow/config";
import {
  REGISTER_PAYMENT_TOOL,
  SELECT_OPTION_TOOL,
  executeRegisterPayment,
  executeSelectOrderBumpOption,
  trackFailedPaymentAttempt,
  type RegisterPaymentArgs,
} from "@/lib/workflow/payment";
import {
  NOTIFY_EMERGENCY_TOOL,
  NOTIFY_ADVISOR_TOOL,
  executeNotifyEmergency,
  executeNotifyAdvisor,
  type NotifyEmergencyArgs,
  type NotifyAdvisorArgs,
} from "@/lib/workflow/emergency";

let cached: OpenAI | null = null;

const COMPACT_REGISTER_PAYMENT_TOOL: ChatCompletionTool = {
  type: "function",
  function: {
    name: "register_payment_amount",
    description:
      "Extract visible receipt data from the image. Use only for a real payment receipt.",
    parameters: {
      type: "object",
      properties: {
        amount_soles: {
          type: "number",
          description: "Exact visible paid amount.",
        },
        payment_method: {
          type: "string",
          enum: ["yape", "plin", "bcp", "transferencia"],
          description: "Visible payment method.",
        },
        recipient_name: {
          type: "string",
          description: "Visible recipient name for Yape/Plin, if present.",
        },
        receipt_date: {
          type: "string",
          description: "Visible receipt date/time, if present.",
        },
        operation_number: {
          type: "string",
          description: "Visible operation/transaction number, if present.",
        },
      },
      required: ["amount_soles", "payment_method"],
    },
  },
};

const ORDER_BUMP_CONTENT_TOOL: ChatCompletionTool = {
  type: "function",
  function: {
    name: "consultar_contenido_order_bump",
    description:
      "Use for Order Bump content questions. scope='options' compares the TWO SELLABLE options and must be used for confusion, differences, recommendations, or general content questions. scope='complement' is allowed ONLY when the customer explicitly asks what the non-sellable complement itself contains.",
    parameters: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          enum: ["options", "complement"],
          description:
            "'options' for the normal sales conversation; 'complement' only for an explicit request about the complement's own contents.",
        },
      },
      required: ["scope"],
      additionalProperties: false,
    },
  },
};

const SEND_PRODUCT_INFO_TOOL: ChatCompletionTool = {
  type: "function",
  function: {
    name: "enviar_info_contenido",
    description:
      "Sends configured content images in editor order, each with its caption. Use ONLY after the customer confirms they want to SEE the content; NEVER unprompted or for a price question. objetivo='oferta' sends the configured visual sequence for the purchasable options; if progressive samples are enabled, the system sends only the next batch. objetivo='complemento' sends only the complement when explicitly requested.",
    parameters: {
      type: "object",
      properties: {
        objetivo: {
          type: "string",
          enum: ["oferta", "complemento"],
          description:
            "'oferta' (default) = the two options' content (main + pack). 'complemento' = only the complementary product's image, when they ask specifically about the complement.",
        },
        introduccion: {
          type: "string",
          description:
            "One short, natural Spanish line announcing that the configured images will be shown now. Do not include product facts, prices or promises about future delivery.",
        },
        force_resend: {
          type: "boolean",
          description:
            "Set true ONLY when the customer explicitly says they cannot see/find the previously shown images or directly asks to receive them again. Otherwise false.",
        },
      },
      required: ["introduccion", "force_resend"],
      additionalProperties: false,
    },
  },
};

const SEND_EXTRA_IMAGES_TOOL: ChatCompletionTool = {
  type: "function",
  function: {
    name: "enviar_imagenes_extra",
    description:
      "Use when the customer wants to SEE additional images of the product (they accepted your offer to show pictures, or asked to see how it looks). Sends the configured extra images, each with its caption. ONLY call it when they actually want to see the images; never unprompted. This is a separate set from the order bump content — it can be re-sent whenever they ask.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
};

function getClient(): OpenAI {
  if (cached) return cached;
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY no configurada");
  }
  cached = new OpenAI({
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
      "HTTP-Referer": "http://localhost:3000",
      "X-Title": "Agente WhatsApp",
    },
  });
  return cached;
}

function imageToDataUrl(relPath: string, mime: string): string | null {
  try {
    const abs = resolveMediaAbsPath(relPath);
    const buffer = fs.readFileSync(abs);
    return `data:${mime};base64,${buffer.toString("base64")}`;
  } catch (err) {
    console.error("[llm] fallo leyendo imagen para visión:", err);
    return null;
  }
}

interface ReplyContext {
  clientName?: string | null;
  pushName?: string | null;
  /** Si está presente, habilitamos la tool register_payment_amount y los
   *  resultados se reportan a esta conversación. */
  conversationId?: number | null;
  /** Ultimo texto del cliente para cargar contenido adicional solo si aplica. */
  latestUserText?: string;
  /** Ultima respuesta visible del bot, usada solo para no recortar de mas. */
  latestAssistantText?: string;
}

const RECENT_VISION_IMAGE_WINDOW_SEC = 180;

function getRecentVisionImage(history: MessageRow[]): MessageRow | null {
  const latestUser = [...history].reverse().find((m) => m.role === "user");
  if (!latestUser) return null;
  return (
    [...history]
      .reverse()
      .find(
        (m) =>
          m.role === "user" &&
          m.media_type === "image" &&
          !!m.media_url &&
          !!m.media_mime &&
          latestUser.created_at - m.created_at <= RECENT_VISION_IMAGE_WINDOW_SEC
      ) ?? null
  );
}

function isUsableSpokenName(value: string | null | undefined): value is string {
  if (!value?.trim()) return false;
  const normalized = value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "");
  return !/\b(precio|costo|valor|informacion|info|curso|producto|pack|oferta|comprar|compra|yape|plin|bcp|transferencia|efectivo|pago|hola|gracias)\b/.test(
    normalized
  );
}

function normalizeIntentText(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function promptSectionExclusionsForTurn(params: {
  state?: string | null;
  latestIntentText: string;
  isPostSale: boolean;
}): string[] {
  const { state, latestIntentText, isPostSale } = params;
  const exclude = new Set<string>();
  const paymentIntent =
    /\b(yape|plin|bcp|banca|interbancaria|transferencia|transferir|deposito|depositar|efectivo|agente|pago|pagar|comprobante|voucher|recibo|constancia|metodo|metodos|datos|cuenta|numero|estafa|miedo|confio|confiar|robaron)\b/.test(
      latestIntentText
    );
  const countryIntent =
    /\b(peru|peruano|peruana|ecuador|ecuatoriano|ecuatoriana|dolar|dolares|usd|extranjero|extranjera|pais|ciudad|mexico|colombia|chile|argentina|bolivia|venezuela|espana|eeuu|estados unidos)\b/.test(
      latestIntentText
    );
  const priceIntent =
    /\b(precio|precios|cuanto|cuesta|costaria|vale|valor|sale|inversion)\b/.test(
      latestIntentText
    );
  const activeChoiceState =
    state === "awaiting_order_bump_choice" ||
    state === "awaiting_order_bump_payment_choice" ||
    state === "awaiting_doble_oferta_dos_choice" ||
    state === "awaiting_bioferta_choice";

  if (!countryIntent) exclude.add("idioma_pais");

  if (isPostSale) {
    exclude.add("pago");
    exclude.add("precio_cierre");
    return [...exclude];
  }

  exclude.add("postventa");

  if (state === "payment_done") {
    exclude.add("precio_cierre");
    if (!paymentIntent) exclude.add("pago");
    return [...exclude];
  }

  if (activeChoiceState) {
    exclude.add("precio_cierre");
    if (!paymentIntent) exclude.add("pago");
    return [...exclude];
  }

  if (!paymentIntent) exclude.add("pago");
  if (!priceIntent && state !== "intro_done") exclude.add("precio_cierre");

  return [...exclude];
}

function isAffirmativeShortAnswer(text: string): boolean {
  return /^(si|sí|sii|claro|ok|okay|dale|va|listo|ya|por favor|porfa|quiero|muestrame|muéstrame)$/.test(
    text
  );
}

function looksLikeProductContentTurn(text: string): boolean {
  if (!text) return false;
  return /\b(como es|que es|q es|que trae|q trae|incluye|contiene|contenido|informacion|info|explicame|detalles|sirve|funciona|uso|usar|aprende|aprendo|material|curso|producto|papercraft|manualidad|plantilla|molde|pdf|video|videos|archivo|archivos|descarga|descargar|diferencia|diferente|otro|combo|basico|basico|mega|kit|pack)\b/.test(
    text
  );
}

function looksLikeMediaTurn(text: string): boolean {
  if (!text) return false;
  return /\b(imagen|imagenes|foto|fotos|muestra|muestras|ver|vea|verlo|verla|verlos|verlas|mostrar|muestrame|muéstrame|ensena|enseña|ejemplo|captura|video|videos)\b/.test(
    text
  );
}

function looksLikeOptionMeaningQuestion(text: string): boolean {
  if (!text) return false;
  const asksMeaning =
    /\b(cual es|cuál es|que es|qué es|que trae|qué trae|que incluye|qué incluye|que contiene|qué contiene|diferencia|diferente)\b/.test(
      text
    );
  const namesOption =
    /\b(combo|pack|mega|completo|basico|básico|kit|opcion|opción|producto)\b/.test(
      text
    );
  const asksPrice = /\b(precio|precios|cuanto|cuánto|cuesta|cuestan|vale|valen|valor|sale|pago|pagaria|pagaría)\b/.test(
    text
  );
  return asksMeaning && namesOption && !asksPrice;
}

function looksLikeReactionToShownContent(text: string): boolean {
  if (!text) return false;
  return /\b(entonces|osea|o\s+sea|ah|ok|listo|ya)\b.*\b(trae|incluye|viene|contiene|es|seria|sería)\b.*\b(eso|todo eso|todo|lo mostrado|lo de arriba|las imagenes|las imágenes|la imagen|las fotos|las muestras)\b|\b(trae|incluye|viene|contiene)\b.*\b(eso|todo eso|todo|lo mostrado|las imagenes|las imágenes|las fotos|las muestras)\b/.test(
    text
  );
}

function looksLikeMinimizedOrderBumpBasicReply(text: string): boolean {
  const normalized = normalizeIntentText(text);
  if (!normalized) return false;
  const mentionsBasicLabel =
    /\b(basico|opcion 2|segunda opcion|producto basico)\b/.test(normalized);
  const minimizing =
    /\b(solo|solamente|tan solo|nada mas|principal|version menor|version reducida|inferior|incompleta)\b/.test(
      normalized
    );
  const optionNumbered =
    /(?:^|\n)\s*(?:[12]\s*[).:-]|[12]\ufe0f?\u20e3)/.test(text);
  const hasConfiguredOptionPrice =
    /\b(?:s\s*\/\s*\.?\s*\d|\d+\s*sol(?:es)?)\b/i.test(text);
  const hasOrderBumpShape =
    optionNumbered ||
    mentionsBasicLabel ||
    /(?:^|\n)\s*(?:⭐|📦|✅|👉)/.test(text) ||
    hasConfiguredOptionPrice ||
    /\bpor\s+(?:s\s*\/|{{\s*precio_?2\s*}}|\d+\s*sol)/.test(normalized);
  return hasOrderBumpShape && minimizing;
}

function buildSystemPrompt(ctx: ReplyContext): {
  cacheable: string;
  dynamic: string;
} {
  // Prompt base editable desde el panel. Prioridad: cajas (system_prompt_sections)
  // → prompt único legacy → SYSTEM_PROMPT por defecto del código. Las piezas
  // mecánicas (precio, marcadores, bloques de estado/bioferta) se añaden abajo.
  const cfgPrompt = loadWorkflowConfig();
  // Precio efectivo (config-driven, editable desde el panel SIN deploy). Si el
  // cliente entró en oferta (discount_active) usa el precio reducido.
  const convo = ctx.conversationId
    ? getConversationById(ctx.conversationId)
    : undefined;
  // GATING DE TOKENS (simétrico, sin comprimir ni cambiar texto — las secciones
  // siguen intactas en el panel; solo se OMITEN cuando no aplican al estado):
  //  • EN VENTA (antes de cerrar): se omite "postventa" (~1.580 tk) — esa sección
  //    solo sirve tras la compra.
  //  • EN POSTVENTA (pago aprobado / correo / regalo / comentario FB): se omiten
  //    "pago" y "precio_cierre" (~2.500 tk) — ya pagó, no hay que vender ni
  //    cotizar ni mostrar métodos. La entrega y el "reenviar material" son
  //    determinísticos (no dependen de estas secciones del cerebro).
  const isPostSale =
    convo?.state === "payment_approved" ||
    convo?.state === "awaiting_email" ||
    convo?.state === "awaiting_gift_consent" ||
    convo?.state === "awaiting_facebook_comment";
  const latestIntentText = normalizeIntentText(ctx.latestUserText);
  const promptSectionExclusions = promptSectionExclusionsForTurn({
    state: convo?.state,
    latestIntentText,
    isPostSale,
  });
  let brain: string;
  if (cfgPrompt?.system_prompt_sections) {
    brain = assemblePrompt(cfgPrompt.system_prompt_sections, promptSectionExclusions);
  } else if (cfgPrompt?.system_prompt?.trim()) {
    brain = cfgPrompt.system_prompt;
  } else {
    brain = assemblePrompt(undefined, promptSectionExclusions);
  }
  const discountActive = isDiscountActiveForConversation(convo, cfgPrompt);
  const fullPrice = convo
    ? getConversationExpectedPrice(convo, false)
    : getEffectivePriceSoles(false);
  const effectivePrice = convo
    ? getConversationExpectedPrice(convo)
    : getEffectivePriceSoles(false);
  const latestAssistantIntentText = normalizeIntentText(ctx.latestAssistantText);
  const previousBotOfferedMedia =
    isAffirmativeShortAnswer(latestIntentText) &&
    looksLikeMediaTurn(latestAssistantIntentText);
  const currentTurnNeedsMedia =
    looksLikeMediaTurn(latestIntentText) ||
    /\bcomo es\b/.test(latestIntentText) ||
    previousBotOfferedMedia;
  const currentTurnNeedsProductContent =
    isPostSale ||
    currentTurnNeedsMedia ||
    looksLikeProductContentTurn(latestIntentText) ||
    isOrderBumpConversationQuestion(ctx.latestUserText ?? "");

  // CACHEABLE: el cerebro estático (idéntico para todos los clientes al mismo
  // precio) con sus comodines {{PRICE}}/{{PRODUCTO}} ya resueltos. Es el prefijo
  // que se marca como cacheable. Su TEXTO no cambia — solo se separa para poder
  // etiquetarlo; `cacheable` + `dynamic` da EXACTAMENTE el mismo prompt de antes.
  // Selector de país: símbolo de moneda ({{MONEDA}}/{{SIMBOLO}}) y DIALECTO.
  // Ambos son constantes por despliegue (no cambian por cliente), así que van en
  // la parte CACHEADA — costo mínimo. El dialecto es autoritativo: manda sobre
  // cualquier instrucción de dialecto que traiga el contenido (ej. si el brain
  // dice "peruano" pero el país es Argentina, gana el voseo del selector).
  const countryCode = getEffectiveCountryCode(convo?.phone, loadWorkflowConfig());
  const country = getCountryInfo(countryCode);
  const cacheable =
    applyProductName(
      brain
        .split("{{PRICE}}")
        .join(String(effectivePrice))
        .split("{{MONEDA}}")
        .join(country.symbol)
        .split("{{SIMBOLO}}")
        .join(country.symbol)
    ) +
    `\n\nDIALECT — AUTHORITATIVE (this OVERRIDES any dialect mentioned elsewhere in this prompt): ${country.dialect}`;

  // DYNAMIC: todo lo per-cliente / per-turno (nombre, precio, bioferta, order
  // bump, contenido, estado…). Mismo texto y mismo orden que antes; solo que va
  // en una 2ª parte (no cacheada). Empieza con el bloque del nombre del cliente.
  let prompt = "";
  // NOMBRE DEL CLIENTE — fix confiable: NO le pasamos el nombre al modelo, así
  // no puede saludar ni "salpicar" el nombre (se sentía confianzudo). El nombre
  // sigue guardándose aparte (DB/NocoDB); solo se oculta del prompt conversacional.
  prompt += `\n\nCUSTOMER NAME — DO NOT USE ANY NAME: never address the customer by name — do not greet them by name and do not sprinkle a name into messages. Using their name feels intrusive and overfamiliar ("confianzudo"). Speak naturally, warmly, without any name.`;
  prompt += `\n\nEMOJI TONE — include 1 context-appropriate emoji in every conversational reply (2 maximum across the full reply). Keep it professional and relevant; never use kisses, romantic hearts, winks or overly familiar emojis.`;
  prompt += `\n\nPROFESSIONAL DISTANCE — avoid overfamiliar slang or casual reassurance such as "tranqui", "no te preocupes", "amigo/amiga", "bro", "corazon", "lindo/linda", "mi reina", "mi estimado/estimada" or similar. Use respectful, neutral phrases instead: "claro", "con gusto", "te explico", "sí, correcto", "puedes hacerlo así".`;
  prompt += `\n\nEFFECTIVE PRICE FOR THIS CUSTOMER: ${country.symbol}${effectivePrice}. This is the ONLY price you must quote when they ask how much it costs. When a receipt arrives, call register_payment_amount with the exact amount from the receipt — the system validates internally against this effective price.`;
  if (cfgPrompt?.llm_bubble_limit_enabled === true) {
    const maxBubbles = Math.max(1, Math.floor(cfgPrompt.llm_max_bubbles ?? 3));
    prompt += `\n\nREPLY LENGTH AND SUMMARY MODE: answer in at most ${maxBubbles} WhatsApp bubble(s), separated with double line breaks. Do NOT squeeze a long answer into one huge bubble. If your first draft needs more than ${maxBubbles} bubbles, summarize and prioritize: keep only the answer to the customer's current doubt, one key value point, and one short next step. Each bubble should be short and readable, usually 1-3 compact lines. Omit examples, repeated CTAs, repeated payment/menu wording and secondary details unless they are essential for this exact turn.`;
  }
  if (discountActive) {
    prompt += ` (This customer entered the offer stage — the price dropped from ${country.symbol}${fullPrice} to ${country.symbol}${effectivePrice}. If they ask why it's cheaper, you can tell them it's a special promotion for staying interested.)`;
  }

  // BIOFERTA OFERTA DOBLE: si está activa, informamos al LLM que hay 2
  // productos + un pack (con sus precios) y que el cliente elige ESCRIBIENDO
  // el nombre. Si está APAGADA → no se inyecta nada (0 tokens extra).
  const bioferta = loadWorkflowConfig()?.bioferta_doble;
  if (bioferta?.enabled) {
    const nameA = bioferta.product_a?.name?.trim() || "Producto 1";
    const nameB = bioferta.product_b?.name?.trim() || "Producto 2";
    const namePack = bioferta.pack?.name?.trim() || "Pack (los 2 juntos)";
    const packPrice = getBiofertaPriceSoles(
      "pack",
      discountActive,
      convo?.phone
    );
    prompt += `\n\nDOUBLE OFFER ACTIVE — there are TWO products plus a bundle (this OVERRIDES the "only price" note above):
- "${nameA}" — price ${country.symbol}${effectivePrice} each.
- "${nameB}" — price ${country.symbol}${effectivePrice} each.
- BUNDLE "${namePack}" (both together) — price ${country.symbol}${packPrice}.
The customer chooses by WRITING THE NAME of what they want (NOT a number). When they tell you which, confirm warmly and remind them how to pay the matching amount.
After payment, the SYSTEM delivers the corresponding material AUTOMATICALLY. NEVER invent, write, paste or promise any download link or URL. If the customer already paid the single-product price but you don't yet know which of the two they bought, ask them to WRITE THE NAME of the product they purchased.
When a receipt arrives, call register_payment_amount with the exact amount — the system routes the delivery by the amount paid (single price vs bundle price).`;
  }

  const dobleOfertaCfg = loadWorkflowConfig();
  const dobleOfertaDos = dobleOfertaCfg?.doble_oferta_dos;
  if (dobleOfertaDos?.enabled) {
    const product1Name = dobleOfertaDos.combo?.name?.trim() || "Producto 1";
    const product2Name = dobleOfertaDos.basico?.name?.trim() || "Producto 2";
    const product1Price = getOrderBumpPriceSoles("combo", discountActive);
    const product2Price = getOrderBumpPriceSoles("basico", discountActive);
    const content2 = dobleOfertaCfg?.course_content_2?.trim();
    prompt += `\n\nDOBLE OFERTA 2 PRODUCTOS ACTIVE — exactly TWO sellable options, no pack, no bundle and no complementary product:
- "${product1Name}" — S/.${product1Price}.
- "${product2Name}" — S/.${product2Price}.
The customer chooses one of these two products. Never mention "Pack 2 en 1", "complemento", "producto complementario" or a third option in this modality. If those words appear in old gallery topics or old captions, treat them as obsolete internal labels and do not repeat them unless the customer literally asks about an old message.
If the customer asks about contents, differences or what each option includes, answer using PRODUCT CONTENT for Producto 1 and SECOND PRODUCT CONTENT for Producto 2. If they ask for images, call enviar_info_contenido with objetivo='oferta'.

CHOICE CONFIRMATION (CRITICAL): When the customer CLEARLY decides on ONE of the two options — by name, by price ("el de ${product1Price}", "el de ${product2Price}"), "el caro/barato", "el completo/básico", "quiero ese", or a clear yes to one — respond with ONLY the marker and NOTHING else: output "<<ELIGE_PRODUCTO_1>>" if they chose "${product1Name}" (S/.${product1Price}), or "<<ELIGE_PRODUCTO_2>>" if they chose "${product2Name}" (S/.${product2Price}). The SYSTEM then sends the payment details of that option directly — never ask them to pick a payment method first, and never write account numbers. If the customer is only ASKING, comparing, doubting, or is UNSURE which one, do NOT output any marker — just answer naturally and, if helpful, invite them to pick. NEVER output a marker in response to a question (e.g. "¿son 2?", "¿qué trae el básico?", "¿cuál me recomiendas?").

UPGRADE MARKER (post-purchase): If a customer who ALREADY bought "${product2Name}" (the cheaper one) later clearly wants to ALSO get "${product1Name}" / the complete one / pay the difference ("quiero completar", "me llevo el combo también", "pago el resto", "el completo mejor"), output ONLY "<<UPGRADE_COMBO>>" and NOTHING else — the SYSTEM tells them how much is left to pay. Do NOT output it if they are just asking about it.`;
    if (content2 && currentTurnNeedsProductContent) {
      const name2 = dobleOfertaCfg?.product_name_2?.trim() || product2Name;
      prompt += `\n\nSECOND PRODUCT CONTENT — "${name2}": authoritative content for Producto 2 in Doble Oferta 2 Productos. It is a standalone sellable product in this modality, not a complement and not part of a pack. Describe ONLY what's listed here; never invent:\n\n${applyProductName(content2)}`;
    }
  }

  // ORDER BUMP: si está activo, el bot debe SABER que al ir a pagar el sistema
  // muestra una oferta intermedia de 2 opciones (para no contradecirla y poder
  // recordarla en cualquier etapa, incluidos los seguimientos). 0 tokens si OFF.
  const orderBump = loadWorkflowConfig()?.order_bump;
  const orderBumpOptionPresentationRule =
    cfgPrompt?.order_bump_option_presentation_rule?.trim() ||
    DEFAULT_ORDER_BUMP_OPTION_PRESENTATION_RULE;
  // GATING DE TOKENS (no cambia ninguna regla): el bloque del order bump es
  // PRE-pago (elegir entre las 2 opciones). Después de la compra (correo,
  // regalo, comentario de Facebook) ya no hay nada que elegir → no lo inyectamos
  // en estados post-venta. Las instrucciones de POST-VENTA son OTRAS y NO se
  // tocan; el bloque sigue idéntico durante toda la venta.
  const orderBumpPostSale =
    convo?.state === "payment_approved" ||
    convo?.state === "awaiting_email" ||
    convo?.state === "awaiting_gift_consent" ||
    convo?.state === "awaiting_facebook_comment";
  // Si ignoró el intro y recién reapareció después de un seguimiento,
  // conversamos normalmente sobre el producto principal. La oferta intermedia
  // se inyectará cuando elija un método de pago y el motor cambie de estado.
  const orderBumpDeferredUntilPayment =
    convo?.state === "intro_done" &&
    !convo.order_bump_choice &&
    (convo.last_followup_index >= 0 ||
      // SWITCH offer_on_intro_first_message=false: vendemos SOLO el producto
      // principal hasta que el cliente muestre intención de pago; ahí el motor
      // suelta la oferta y el estado cambia (deja de estar diferido). Así el
      // cliente NO sabe que existe un 2º producto antes de querer pagar.
      orderBump?.offer_on_intro_first_message === false);
  // Mientras el order bump está OCULTO, el bot vende como UN solo producto: no
  // se inyectan las 2 opciones, ni las galerías del 2º producto, ni la guarda de
  // pago de 2 opciones, y se refuerza "single-product".
  const orderBumpHidden =
    !!orderBump?.enabled && !orderBumpPostSale && orderBumpDeferredUntilPayment;
  if (
    orderBump?.enabled &&
    !orderBumpPostSale &&
    !orderBumpDeferredUntilPayment
  ) {
    const comboName = orderBump.combo?.name?.trim() || "Combo";
    const basicoName = orderBump.basico?.name?.trim() || "Básico";
    const comboPrice = getOrderBumpPriceSoles("combo", discountActive);
    const basicoPrice = getOrderBumpPriceSoles("basico", discountActive);
    prompt += `\n\nORDER BUMP ACTIVE — TWO sellable options:
- "${comboName}" — S/.${comboPrice}.
- "${basicoName}" — S/.${basicoPrice}.
These option prices override any single EFFECTIVE PRICE instruction while Order Bump is active.
The second option is the configured sellable product by itself. The combo is that configured product + complement; the complement is NOT a third standalone sale. This overrides "one product" wording only for these configured options.
COMPLEMENT WORDING — the complement/additional product is NOT a gift, freebie or bonus unless the editable content explicitly says so. Do not call it "regalo", "gratis", "de regalo" or "pack extra de regalo"; call it complement/additional product/extra kit.
PRESENTATION ORDER — present the combo/VIP option FIRST and the second configured option SECOND. Treat the second option as a valuable, valid choice in its own right; never belittle it or describe it as an inferior leftover.
Interpret the customer's meaning from the full conversation. Questions, comparisons, unusual wording and topic changes are not choices. Answer first; never select from one matching word.
Be warm, direct and commercial, and ALWAYS include at least one fitting emoji in every reply here — this OVERRIDES any "emojis are optional / keep them minimal / 2-3 total" rule stated elsewhere: in the order bump a dry, emoji-less message is wrong. Usually 2-4 concise lines and at most one soft next step. Stay professional, calm and concise (no chit-chat, no pushiness): do NOT proactively offer to help them choose and do NOT volunteer a recommendation — simply ask, once and gently, which of the two they prefer; only help them decide if THEY ask for it. Avoid flyer-like dumps, repetition, pressure and casual over-chatting.
If they ask the price before choosing, do NOT reveal either price: briefly ask which configured option they mean. Once one option is clear, give its exact price. If they then ask about "the other one", resolve that reference and answer directly without restarting the explanation or changing their saved choice.
CONTENT POLICY — for any semantic intent to understand contents, differences or value, call consultar_contenido_order_bump. When describing the second configured option, use its configured name plus at least one concrete detail from main_product.content; a number/quantity alone does NOT count as enough detail, include an example, category, benefit or use case from the editable content. Never reduce it to "solo", "producto principal" or a generic shorter/minor version. If the editable option-presentation rule quotes bad wording as an example of what NOT to say, never copy that bad wording. Use this editable option-presentation rule from Ajustes:
${orderBumpOptionPresentationRule}
Then, only if useful and not already shown, offer once to show the configured images; when accepted call enviar_info_contenido (objetivo='oferta'). If they explicitly ask to see or deeply inspect the complement itself, use objetivo='complemento'. One option per paragraph separated by a blank line; configured names in bold, no numbered/keycap emojis. After images, do not repeat their text and continue toward a choice.
A payment question or payment method is NEVER a product choice. If no option is selected, ask which configured option they prefer before showing or processing payment methods.
Call seleccionar_opcion only after a clear product decision; never for a question, a PRICE question, uncertainty, payment question or payment-method name. Asking the price (e.g. "precio", "cuánto", "cuánto cuesta") is NEVER choosing an option — do NOT assume the cheaper or any option: present both options and ask which they prefer. A question about HOW MANY products there are — e.g. "son 2", "son dos", "¿son 2?", "cuántos son", "hay 2?" (people often skip the "?") — is NOT choosing the option whose name contains a "2": it's just asking, so confirm warmly that there are two options and ask which they prefer; never register a choice from it. If choice and receipt arrive together, register choice before payment. Do not move to payment without a clear option.
PURCHASE CONFIRMATION — money safety (CRITICAL): NEVER tell the customer their purchase is approved, complete or done. Only the SYSTEM confirms and delivers, and only once a receipt covering the FULL amount of the chosen option has arrived. While any amount is still missing (e.g. they owe the difference to upgrade to the more expensive option), nothing the customer merely SAYS — agreeing, confirming, promising to pay, or stating/asking that an amount is missing, with or without a question mark — counts as that payment or as a confirmation to deliver. Keep waiting for the actual receipt that covers the amount; meanwhile, warmly state how much is left and ask them to pay it and send the new proof.`;

    const productInfoAlreadyShown =
      !!convo &&
      getSentMedia(convo.id).includes("__product_info_sequence__");
    if (productInfoAlreadyShown) {
      prompt += `\n\nCONTENT SEQUENCE ALREADY SHOWN — the customer already received the complete configured images and captions for both sellable options. Normally, orient them warmly that the images are higher up in the chat, answer only their specific doubt, and advance by asking which of the TWO SELLABLE options they want to acquire. Do not offer more information or restart the presentation. EXCEPTION: if they explicitly say they cannot see/find the images or ask you to resend them, call enviar_info_contenido with objetivo='oferta' and force_resend=true; after resending, continue toward choosing an option. Mention or detail the complement only if their CURRENT message explicitly asks about the complement itself.`;
      if (looksLikeReactionToShownContent(latestIntentText)) {
        prompt += `\n\nCURRENT TURN REACTION TO SHOWN CONTENT — the customer is reacting to the images/content already shown (e.g. "entonces trae todo eso?"). Do NOT offer or resend images. Answer the specific doubt in text, confirming what applies and clarifying whether it refers to combo or basic if needed; then continue toward choosing an option.`;
      }
    }
    if (
      convo?.order_bump_choice !== "combo" &&
      convo?.order_bump_choice !== "basico"
    ) {
      prompt += `\n\nUNSELECTED ORDER BUMP INVARIANT — there are always TWO SELLABLE options still available. A greeting, generic message, abrupt topic change, mention of the main product, or question does NOT reduce the sale to one option and does NOT select the basic option. Keep both configured option names mentally active. Only focus on one option when the customer's CURRENT message clearly refers to it; only save a choice after a clear decision.`;
    }
    if (
      isPriceQuestion(ctx.latestUserText ?? "") &&
      convo?.order_bump_choice !== "combo" &&
      convo?.order_bump_choice !== "basico"
    ) {
      prompt += `\n\nCURRENT TURN PRICE PRIORITY — no sellable option is selected. If the customer asks generically for the price, NEVER quote the single/basic EFFECTIVE PRICE: ask naturally which of the two configured options they mean. Only quote a price now if their message clearly identifies one option.`;
    }
    if (looksLikeOptionMeaningQuestion(latestIntentText)) {
      prompt += `\n\nCURRENT TURN OPTION MEANING PRIORITY — the customer is asking what one option is / includes / means, NOT asking for price. Explain the relevant configured option by its content and relation to the other option, using only PRODUCT CONTENT / SECOND PRODUCT CONTENT / consultar_contenido_order_bump data. Do NOT mention any price in this reply unless the customer's current message explicitly asks price with words like "precio", "cuánto", "cuesta", "vale" or "valor".`;
    }
  }

  // MODO LINEAL: order bump y bioferta APAGADOS → un solo producto. Damos un
  // redirect un poco más específico (apoyado en el Product Content, sin nombrar
  // el producto) para no sonar vago, y reforzamos que es UN solo producto.
  const linearMode =
    (!orderBump?.enabled && !bioferta?.enabled) || orderBumpHidden;
  if (linearMode) {
    prompt += `\n\nSINGLE-PRODUCT MODE — there is exactly ONE product on offer. If the customer asks about an unrelated topic, redirect warmly: make clear we only offer this one material and, in ONE short phrase, say what it helps with (drawn ONLY from the Product Content, without stating the product name). Do NOT imply there are other products or complements. Do NOT label it as option 1/2 or use numbered option emojis; just describe the product by its configured name.`;
  }

  const normalizedLatestUserText = latestIntentText;
  if (
    !orderBump?.enabled &&
    /^(tengo )?(una )?duda(s)?$/.test(normalizedLatestUserText)
  ) {
    prompt += `\n\nCURRENT TURN — VAGUE DOUBT: Ask ONE short, warm question about what doubt they have. Do not add a second generic question, recommendation, sales CTA or product-choice prompt in this reply. This overrides the general CTA rule for this turn.`;
  }

  // CONTENIDO DEL CURSO — vive en la caja "Contenido" (separada del Cerebro) y
  // se inyecta aquí para que el bot responda qué incluye / páginas / cómo se
  // estudia / imprimible, sin que ese texto esté dentro del Cerebro.
  const cfgContent = loadWorkflowConfig();
  const courseContent = cfgContent?.course_content?.trim();
  if (courseContent && currentTurnNeedsProductContent) {
    prompt += `\n\nPRODUCT CONTENT — WHAT THE CUSTOMER RECEIVES / HOW IT'S USED (authoritative source; use it for all questions about contents, format, audience, duration, delivery or usage). Describe ONLY what's listed here; never invent features, and never infer a use from the product's NAME — the name does NOT define what it is for:\n\n${applyProductName(courseContent)}`;
  }

  // Doble Oferta conserva su inyección existente. En Order Bump, el contenido
  // secundario se obtiene bajo demanda mediante consultar_contenido_order_bump.
  if (cfgContent?.bioferta_doble?.enabled && currentTurnNeedsProductContent) {
    const content2 = cfgContent.course_content_2?.trim();
    if (content2) {
      const name2 = cfgContent.product_name_2?.trim() || "el segundo producto";
      prompt += `\n\nSECOND PRODUCT CONTENT — "${name2}": this is the COMPLEMENTARY product of the bundle. Use it when the customer asks about the second / other / additional / complementary product, AND ALSO whenever — while the order bump is active — they ask GENERICALLY what the product or course includes, brings or contains: in that case present BOTH products' content (the single one AND this complementary one), so you never describe just one as if it were everything. Answer the information question FIRST instead of insisting that they choose. Describe ONLY what's listed here; never invent:\n\n${applyProductName(content2)}`;
    }
  }

  // GALERÍA DE IMÁGENES/VIDEOS — el bot puede mandar un archivo relevante según
  // lo que pregunte el cliente. Solo se inyecta la LISTA de temas (los archivos
  // son enlaces, no van al prompt). 0 tokens si la galería está vacía.
  const gallery = getImageGallery(orderBumpHidden);
  if (gallery.length > 0 && currentTurnNeedsMedia) {
    const list = gallery
      .map((g) => `- "${g.topic}"${g.when ? ` → cuándo: ${g.when}` : ""}`)
      .join("\n");
    prompt += `\n\nMEDIA GALLERY — you can send the customer a relevant image/video. Available items (topic → when to send it):
${list}

To send ONE, output the marker <<MEDIA: topic>> using the EXACT topic key from the list. Write ONE or TWO short lines with it (concise and precise — never a long list): name the product, say it includes everything shown in the image (for a single product) or be a bit more specific for a bundle but still point them to the image, and end with a soft offer of which one they want. If the gallery item has no preset caption, the sentence YOU write becomes the image's caption (same bubble) — so make it your own and coherent with what you're saying.
RULES so it never feels invasive or abrupt:
- You MAY attach an image when you DESCRIBE that product and seeing it genuinely helps (your judgment, like a good salesperson) — but do NOT dump everything at once: pace it. If there is a lot to show or explain, first OFFER to walk them through it (vary the wording, never a fixed phrase), then deliver the relevant part as they ask.
- NEVER send media unprompted or just to send it, and NEVER more than ONE media per reply.
- You MAY re-send an item if the customer asks to see it AGAIN (e.g. they missed it or ask "muéstramela otra vez") — the system re-sends it, never tell them to scroll up. But do NOT re-send the same item repeatedly on your own; only when they ask.`;
  }

  // FORMATO — negritas con criterio (no gasta casi nada y mejora la lectura).
  prompt += `\n\nFORMATTING: in WhatsApp, *word* makes it bold. Highlight ONLY the most important terms in *bold* — at most 1-3 key words/phrases per message. NEVER bold whole sentences or most of the text; keep it light and tasteful.`;

  // SEGURIDAD DE DATOS DE PAGO (SIEMPRE, en cualquier estado): cierra el hueco de
  // los bloques por-estado. El LLM NUNCA escribe ni inventa números de pago /
  // cuenta / teléfono ni nombres de titular — el SISTEMA siempre los manda. Evita
  // alucinaciones (ej. "999 999 999") y el "búscalo más arriba".
  prompt += `\n\nPAYMENT DATA SAFETY — ALWAYS, IN EVERY STATE (this overrides anything else if in conflict): You must NEVER write, type, repeat or INVENT any payment number, account number, phone number (Yape/Plin), CCI/interbank number or account-holder name — not even as an example or placeholder, and NEVER make one up such as "999 999 999". You do NOT have the real payment data and must not guess it; the SYSTEM always sends the exact configured data. When the customer needs the payment data: if they ALREADY chose a payment method, output ONLY the marker <<REENVIAR_PAGO>> (you MAY add ONE short warm line before it) and the system re-sends that method's exact details; if they have NOT chosen a method yet, follow the payment-methods instructions below. NEVER tell the customer the data is "above" / "más arriba" / "más arribita" / to scroll up — always re-send it via the marker instead.`;

  // MENÚ DE MÉTODOS DE PAGO. Los métodos viven en la caja "Texto de métodos"
  // (pestaña Pago) — un lugar SEGURO, fuera del Cerebro. Aquí los INYECTAMOS al
  // prompt para que el bot los conozca, sin que estén dentro de las cajas del
  // Cerebro (así un trabajador no rompe el Cerebro al cambiar un método).
  //  - Botones ON  → la IA emite <<METODOS_PAGO>> y el sistema manda los botones.
  //  - Botones OFF → la IA presenta ESTOS métodos de forma natural y amable.
  const methodsList = getPaymentText(convo?.phone);
  const buttonsOn = loadWorkflowConfig()?.payment_method_buttons === true;
  if (buttonsOn) {
    prompt += `\n\nPAYMENT METHODS MENU — VIA MARKER: when you would show the list of payment methods (the customer asks "¿cómo pago?", "¿cuáles son los métodos?", "¿qué opciones tengo?", or it's the moment to offer payment), do NOT write the list yourself. Output ONLY this marker, alone, with no other text: <<METODOS_PAGO>>. The system sends the tappable buttons. If the customer already names a specific method, behave normally (no marker).`;
  } else {
    prompt += `\n\nPAYMENT METHODS — OFFICIAL LIST (this SUPERSEDES any other list of methods that may appear above): the ONLY valid payment methods are exactly these:

${methodsList}

When the customer asks how to pay / which methods exist / it's time to offer payment, present THESE methods in your own warm, natural words (you may split into a couple of bubbles if it reads better). Do NOT invent or omit any method. Do NOT write account numbers or holder names (the SYSTEM sends those automatically when the customer picks a method). Do NOT output any marker.`;
  }
  if (
    orderBump?.enabled &&
    !orderBumpPostSale &&
    !orderBumpHidden &&
    convo?.order_bump_choice !== "combo" &&
    convo?.order_bump_choice !== "basico"
  ) {
    prompt += `\n\nORDER BUMP PAYMENT GUARD — this overrides every payment-menu instruction above while no product option is selected. If the customer asks how to pay or names a payment method, do NOT output <<METODOS_PAGO>>, do NOT select a product and do NOT provide payment details. Briefly ask which of the two configured options they prefer first.`;
  }
  if (convo?.state === "payment_done" && convo.selected_payment_method) {
    const selectedMethodLabel =
      convo.selected_payment_method === "bcp_transferencia"
        ? "BCP/transferencia"
        : convo.selected_payment_method === "efectivo"
          ? "efectivo"
          : convo.selected_payment_method === "plin"
            ? "Plin"
            : "Yape";
    prompt += `\n\nSELECTED PAYMENT METHOD — ${selectedMethodLabel} was already chosen and its payment details were sent. This OVERRIDES every payment-menu instruction: never output <<METODOS_PAGO>> and never offer or ask for methods again unless the customer explicitly wants to CHANGE method. CRITICAL: when they ask HOW to pay — "¿cómo pago?", "como pago", "¿cómo es el pago?", "¿cuáles son los métodos?", "recuérdame cómo pagar" — this is NOT a request for the methods menu (they ALREADY chose ${selectedMethodLabel}); it means "remind me how to pay with ${selectedMethodLabel}". Also if they RESUME buying — say they'll pay, ask for the data/account/number, or ask the price. In ALL these cases: do NOT output <<METODOS_PAGO>>, do NOT tell them the details are "above" or to scroll up, and do NOT retype any account number yourself. Output the marker <<REENVIAR_PAGO>> (you MAY add ONE short warm line before it, e.g. "¡Claro! Aquí los tienes 😊"). The SYSTEM re-sends the exact ${selectedMethodLabel} details AND the receipt reminder from the editable template. For unrelated questions, answer only the question; do not ask for a receipt unless they claim to have paid or ask how to complete payment.`;
  }

  if (convo) {
    // Bloque especifico para el estado de "esperando que confirme el comentario
    // de FB" — el LLM NO debe inventar links de regalo; el sistema los manda.
    if (convo?.state === "awaiting_facebook_comment") {
      prompt += `\n\n⚠️ CURRENT STATE: AWAITING_FACEBOOK_COMMENT — The customer was asked to comment on a Facebook post and then type the exact word *COMENTADO* right here. When they type it (or use equivalent confirmations like "ya lo hice", "listo", "hecho", "ya está"), the SYSTEM AUTOMATICALLY sends the configured gift.

HARD RULE: YOU do NOT have the gift link. NEVER promise a link, NEVER invent a URL like "https://drive.google.com/your-gift-link" or any other, NEVER say "te enviaré el enlace" as if you had it yourself.

If the customer asks about the gift or says something that does NOT qualify as a confirmation (e.g. "¿qué enlace?", "no entiendo", "todavía no comenté", "voy a comentar"), reply guiding them toward the keyword WITHOUT inventing anything:
  "¡Genial! Para recibir tu regalo, comenta el post de Facebook y luego escribe aquí mismo la palabra *COMENTADO*. 🎁"
Do NOT attach any link, do NOT tell them it's already sent, do NOT lie.

CONFIRMATION MARKER: If the customer CLEARLY confirms they already commented (any wording, even with typos: "listo comenté", "ya comenté", "hecho", "ahí está mi comentario"), output ONLY the marker "<<REGALO_HECHO>>" and NOTHING else — the SYSTEM then delivers the gift. Do NOT output the marker if they are asking, unsure, or say they have NOT commented yet.`;
    }

    // Instrucción para que el LLM emita un marcador de resumen al final
    // de CADA respuesta. El sistema lo extrae y lo sincroniza a NocoDB
    // como Resumen del lead, sin que el cliente lo vea.
    prompt += `\n\nINTERNAL SUMMARY MARKER — MANDATORY IN EVERY RESPONSE:
At the end of each of your responses, after the CTA (if any), add on a NEW LINE a marker with a brief summary of what happened in this turn with the customer. EXACT format:

<<RESUMEN: descripción de 1 línea>>

Valid examples:
- <<RESUMEN: El usuario preguntó sobre el precio del producto>>
- <<RESUMEN: El usuario quiere saber si se puede pagar por Yape>>
- <<RESUMEN: El usuario pidió ver una muestra del material>>
- <<RESUMEN: El usuario está evaluando si el producto se ajusta a su necesidad>>
- <<RESUMEN: El usuario completó la compra vía Yape por S/.${effectivePrice}>>

Rules:
- A single line, maximum 200 characters.
- Third person, written in Spanish ("El usuario..."), describing what they did or asked in THIS turn.
- This marker is NOT visible to the customer — the system removes it before sending your response to WhatsApp.
- ALWAYS include the marker, in EVERY response — without exception.
- Do NOT use quotes inside the marker or > signs in the middle.`;

    // Reglas COMUNES a los estados post-pago.
    const postPaid =
      convo?.state === "payment_approved" ||
      convo?.state === "awaiting_email" ||
      convo?.state === "awaiting_gift_consent" ||
      convo?.state === "awaiting_facebook_comment";
    if (postPaid && convo) {
      prompt += `\n\n⚠️ THIS CUSTOMER HAS ALREADY COMPLETED PAYMENT. They paid S/.${convo.paid_total_cents / 100} (total credited).
- FORBIDDEN to offer a payment method or sales CTAs like "¿Te animaste a adquirirlo?" — THEY ALREADY BOUGHT. At this stage NO sales CTA goes at the end.
- FORBIDDEN to say "Si tienes alguna duda, aquí estoy", "Cualquier cosa avísame", "Estoy para ayudarte" — the bot is NOT ongoing support.
- If the customer comments something about the amount paid: reply briefly "El pago ya está aprobado, todo en orden — pagaste S/.${convo.paid_total_cents / 100} y queda registrado." Nothing more.
- If the customer clearly asks to receive their purchased product AGAIN, emit the marker <<REENVIAR>> on its own line. The SYSTEM will repeat the configured delivery sequence. NEVER invent delivery data yourself. You may add a short warm line like "¡Claro! Te lo reenvío ahora mismo 😊".
- IMPORTANT: only emit <<REENVIAR>> when the customer is CLEARLY asking for their material/link again. Do NOT confuse it with other questions. For example "¿es necesario el correo?" is asking whether the email is required, NOT asking for the link — answer THAT honestly (no, it's not mandatory, it's a convenience).
- If they report a real unresolved delivery problem: follow the escalation rules.`;
    }

    // AWAITING_EMAIL: bot pidió el correo. Dejamos al LLM conversar
    // naturalmente con el cliente — solo le marcamos qué NO hacer para
    // no empujar el pedido de correo fuera de vista.
    if (convo?.state === "awaiting_email") {
      prompt += `\n\nSTATE: AWAITING_EMAIL — You asked the customer for their email using the configured post-purchase flow. That request is visible just above on the screen.

Talk naturally with the customer. The email is optional unless the editable configuration explicitly says otherwise. Do not invent what will be sent by email.

OMIT THE CTA AT THE END in this state — the general rule says "always close with a question", but here it's an EXCEPTION. Close your response naturally without a question at the end. The customer decides when (and whether) to send their email.

WHAT NOT TO DO:
- Do NOT insist about the email. Do NOT close your message with questions like "¿me lo envías?", "¿cuándo lo mandas?", "¿me das tu correo?" — that feels invasive.
- Do NOT repeat or invent delivery data.
- Do NOT use phrases like "ya tienes acceso a...", "disfruta el material" — those belong in the final closing of the cycle, not here.
- Do NOT celebrate the payment as if it just happened. The configured delivery already confirmed it. If the customer mentions the payment again (e.g. "ok pagué", "ya está", "gracias por la confirmación"), reply VERY briefly without repeating that confirmation — e.g. "¡De nada! 😊" and nothing more.
- Close naturally based on what the customer just said. Do NOT borrow farewell/closing phrases (like "disfruta del material", "éxitos", etc.) — those signal the conversation is OVER, but at this stage the flow is still in progress (you're still waiting for email, and there's still the gift to offer). A simple human close ("perfecto", "entiendo", "claro, sin problema") works better.
- If the customer doesn't send the email, wait calmly. After 5 min the system moves on by itself with the Facebook gift.`;
    }

    // AWAITING_GIFT_CONSENT: el bot mandó la pregunta del regalo extra.
    // Esperamos sí / no del cliente. Si responde ambiguo o pregunta,
    // el LLM acá responde sin presionar.
    if (convo?.state === "awaiting_gift_consent") {
      prompt += `\n\nSTATE: AWAITING_GIFT_CONSENT — You just offered the customer the configured additional gift. The question is visible just above on their screen.

Talk naturally if they ask legitimate things. Describe the gift only from the configured gift messages; do not assume it is a PDF, link or any specific format. Do NOT give detailed instructions yet (that comes ONLY if they accept).

OMIT THE CTA AT THE END in this state — the general rule says "always close with a question", but here it's an EXCEPTION. The customer decides. If they keep asking, respond and leave your message without a final question.

WHAT NOT TO DO:
- Do NOT insist that they accept. Do NOT end with "¿lo querés?", "¿te animás?", "¿decime ya?".
- Do NOT mention the Facebook link or the detail of how to receive the gift — those instructions are sent automatically AFTER the customer clearly says "sí".
- If the customer doesn't reply clearly (sí/no), the system waits indefinitely — don't rush them.
- If the customer says something neutral like "ok" or an ambiguous "está bien", you may ask ONCE "¿Lo quieres entonces? 😊" — but only once in the whole flow.

DECISION MARKER: When the customer CLEARLY accepts the gift ("sí", "claro", "dale", "lo quiero", "obvio"...), output ONLY "<<REGALO_SI>>" and NOTHING else. When they CLEARLY decline ("no", "no gracias", "así estoy bien"...), output ONLY "<<REGALO_NO>>". The SYSTEM then proceeds. Do NOT output any marker if they are only asking a question or are ambiguous — just reply naturally.`;
    }

    // AWAITING_FACEBOOK_COMMENT: ya hay otro bloque arriba sobre "no
    // inventes link". Acá sumamos: no repetir las instrucciones del FB
    // + distinguir explícitamente entre "enlace del curso" y "enlace del
    // regalo" (es un punto de confusión común).
    if (convo?.state === "awaiting_facebook_comment") {
      prompt += `\n\nADDITIONAL for AWAITING_FACEBOOK_COMMENT:
- The gift instructions (FB post + "escribe COMENTADO") are already visible on the customer's screen. Do NOT repeat them literally.
- If they say "gracias", "ok", or a simple acknowledgment: reply VERY short and nothing more.

IMPORTANT — DISTINGUISH PURCHASE FROM GIFT:
If the customer asks whether the Facebook post or gift is what they bought, clarify that it is an EXTRA gift and that the purchased product was sent through the configured delivery sequence after payment. Do not assume either delivery is a link, PDF, video or email unless the editable configuration says so.`;
    }

    // PAYMENT_APPROVED puro (ciclo completo, ya recibió el regalo de FB).
    if (convo?.state === "payment_approved") {
      prompt += `\n\nSTATE: PAYMENT_APPROVED — The customer has already completed the whole cycle. Do not restart the sales flow. Answer product questions only from Product Content and delivery configuration, without assuming format or audience. Close briefly and positively.`;
    }
  }
  // Instrucciones específicas sobre la tool de pago — solo se añaden si la
  // tool está disponible (cuando hay conversationId).
  if (ctx.conversationId) {
    prompt += `

PAYMENT VALIDATION:
- You may ONLY call register_payment_amount when the customer actually sent an IMAGE (photo/screenshot) of the receipt in this turn. If the customer only tells you by TEXT "ya pagué", "listo, ya está hecho", "ahí la ves?", or any claim WITHOUT having attached an image → do NOT call the tool. Reply kindly asking them to send the PHOTO of the receipt to verify it, and wait.
- CHOOSING A METHOD IS NOT A PAYMENT CLAIM: if the customer simply writes the NAME of a payment method, even misspelled, abbreviated or with a typo ("yape", "yapr", "llape", "yapeo", "plin", "plim", "bcp", "transferencia", "deposito"), it means they are CHOOSING how to pay → respond warmly by giving them the payment details for that method. NEVER interpret the bare name of a method as "they already paid", and NEVER tell them you didn't receive the receipt/image just because they typed a method name.
- Si la imagen NO se ve claramente como un comprobante de pago (es borrosa, está recortada, es una captura de algo no relacionado, o no podés leer el monto ni el receptor en ella), NO llames register_payment_amount — pedile amablemente que envíe una foto clara del comprobante completo donde se vea el monto y el nombre del receptor.
- The system has a guardrail that automatically rejects any attempt to approve a payment without a real image. If you call the tool without an image, it returns REJECTED no matter what you said.
- When the customer sends an IMAGE of a payment receipt (Yape, Plin, BCP, bank transfer), you MUST call the register_payment_amount tool with the extracted data.
- For Yape/Plin: include recipient_name (it may be partial, e.g. "Alberto S***" — pass it as-is).
- For BCP/transfer: omit recipient_name.
- The system responds with status "APPROVED", "PARTIAL" or "REJECTED" plus details.
- If the result is "APPROVED": do not add an extra customer-facing message about the access location. The system sends the delivery sequence and its post-delivery confirmation. Never say the material "will be sent automatically"; that sounds like it has not arrived yet and causes complaints.
- If it's "PARTIAL": tell the customer how much was missing and that they'll receive the material once they complete the amount.
- If it's "REJECTED": explain the reason to the customer kindly.
- If the customer sends an image that is NOT a receipt (e.g. something else), do not call the tool — respond normally.

CLIENT DISTRUST / FRAUD ACCUSATIONS:
- If the customer expresses distrust toward our brand or claims to have been defrauded (in whatever wording): ${
      getDistrustMessage()
        ? "output the marker <<TRANQUILIZAR>> (you MAY add ONE short empathic line before it). The SYSTEM then sends our prepared reassurance message and its closing — do NOT write your own reassurance. Use it ONCE when the distrust first arises; if afterwards they merely acknowledge (e.g. 'ok', 'ya', 'gracias'), do NOT emit it again — just continue naturally."
        : convo?.state === "payment_done" || orderBumpPostSale
          ? "use your judgment: empathize briefly, do NOT assume they paid US unless the conversation history clearly shows so, and position our store as a legitimate option. Payment details were already sent, so reassure them and stop naturally: do not repeat methods, ask for a receipt or add a sales CTA."
          : "use your judgment: empathize briefly, do NOT assume they paid US unless the conversation history clearly shows so, and position our store as a legitimate option. After resolving the concern, close with ONE brief, gentle, naturally worded QUESTION inviting them to continue if they feel comfortable. The final sentence must be interrogative and end with a question mark. Do not use a fixed phrase and do not send payment details before they accept."
    }
- ANTI-LOOP (CRITICAL): reassure about a scam/distrust concern AT MOST ONCE. If you ALREADY reassured them and they merely acknowledge (e.g. "ok", "ya", "gracias", "👍") or add nothing new, do NOT reassure again and do NOT repeat the same idea — instead warmly invite them to continue with their purchase with ONE short, varied next step (e.g. "¿Te animas a continuar con tu compra? 😊"). Never keep reassuring turn after turn.
- Never break the bot illusion — do not mention an "asesor humano", "una persona", or anything similar to the customer. You handle the conversation as the brand voice.
- Silently invoke notify_admin_emergency ONLY if aggression / insults / threats persist after your empathic reply — and do not announce that to the customer.

CUSTOMER PROBLEMS / COMPLAINTS (tool notify_admin_emergency) — USE WITH JUDGMENT:

UNIVERSAL PRINCIPLE: for ANY problem the customer reports (payment, download, access, usage, error, whatever), you FIRST try to solve it yourself with the information you have — make at least 2 attempts before even thinking about escalating. You are the one responsible for the course; escalating to an advisor right away looks robotic, takes away your authority, and sounds to the customer like "I'm not talking to you, talk to someone else". The vast majority of problems a customer can have ALREADY have a clear answer in what you know or in the material they received. Some NON-exhaustive examples — the rule applies to ANY problem:

PAYMENT PROBLEMS:
- "No puedo pagar" / "no me sale" → guide them according to the chosen method using only the payment instructions already sent by the SYSTEM. NEVER invent, quote from memory or assume account numbers or recipient names. Suggest checking the configured details, trying again or choosing another method.
- "Yape no funciona / Plin no responde" → suggest updating the app, trying with mobile data, trying again in a few minutes.
- "BCP me da error" → ask whether it's a checking or interbank account, whether the bank is under maintenance, whether they have enough balance. Suggest trying later.
- "Pagué pero no se aprueba" → remind them they need to send the PHOTO of the receipt (not by text), that the amount must match, and that the recipient must match the configured validation name.

ACCESS / DOWNLOAD PROBLEMS:
- "No puedo descargar / acceder al producto" → remind them to review the configured delivery message already sent above. If they gave their email and the product is also delivered there, tell them to check it.
- "El link no abre / no me funciona" → ask whether they tried tapping it, whether they have Wi-Fi, whether they tried it from the email.
- Do not assume the delivery contains a video, PDF, link or Drive folder unless the editable Product Content or delivery messages say so.

USAGE PROBLEMS:
- "No sé cómo descargar / no sé cómo usarlo / no entiendo" → use only the editable Product Content and the configured delivery messages to guide them.

OFFER AN ADVISOR ONLY IF:
- The customer ALREADY tried your suggestions and KEEPS insisting on the same problem without it getting resolved (3+ rounds).
- The customer is visibly and clearly FRUSTRATED/upset and the situation is real.
- The problem is objectively serious and not solvable with the available info (e.g. "el archivo de Drive está corrupto", "el bot del banco rechazó la transferencia con error específico", "necesito factura con RUC").

HOW TO OFFER (important — NEVER automatic):
1) First ASK them if they want an advisor:
   "Entiendo, déjame ayudarte. ¿Deseas que un asesor especializado se comunique directamente contigo para resolverlo? 😊"
2) ONLY IF the customer responds with a clear yes (sí, ok, dale, por favor, claro): ONLY THEN INVOKE notify_admin_emergency with a specific \`reason\` describing the concrete problem.
3) After the tool, send the advisor message (agreed text further below).

FORBIDDEN:
- Invoking notify_admin_emergency on the customer's first message reporting a problem. No matter what problem it is — you first try to solve it yourself.
- Sending the advisor message without having asked and obtained consent.
- Repeating the advisor message more than once in the conversation (the customer already read it).
- Escalating for common questions or problems that have a direct answer in what you know.

SALES ADVISOR (tool notify_admin_advisor_request) — USE ONLY IN EXTREME CASES:
  GENERAL RULE: do NOT offer an advisor. Use the editable Product Content, effective price, configured payment methods and configured delivery to answer the vast majority of questions yourself. Do not assume installments, lifetime access, format, ages or bonuses unless configured.

  NEVER offer an advisor for casual or informational questions, even if they repeat. Examples where YOU must answer:
    - "¿Cuánto dura?" / "¿Qué trae?" / "¿Para qué edad sirve?" → answer only from Product Content.
    - "¿Se puede pagar en cuotas?" → answer only if the editable sales instructions define it; otherwise state that the displayed price is the amount to pay.
    - "¿Es PDF o video?" / "¿Cómo lo recibo?" → answer only from Product Content and delivery configuration.
    - "Dame más información" → give more information yourself; refer to the intro material.
    - "No entendí" → re-explain patiently, simplify.
    - "Tengo dudas" / "déjame pensarlo" → reinforce benefits, do NOT escalate to a human.

  DO offer an advisor ONLY in these two cases:
    (a) The customer EXPLICITLY asks to talk to a human / advisor / person / real salesperson.
    (b) The customer CLEARLY expresses intent to enroll BUT also CLEARLY says something isn't clear to them and that's blocking their decision. BOTH signals must be present in their message. Messages that DO qualify:
        - "La verdad quiero inscribirme pero no me queda clara su información"
        - "Lo necesito urgente pero no me queda claro qué tengo que hacer"
        - "Tu información está clara pero hay cosas que no me quedaron claras como para adquirirlo"
        - "Quiero comprar pero no termino de entender X y necesito que alguien me lo explique mejor"
      Messages that do NOT qualify (the two signals are not both present):
        - "¿Cuánto cuesta?" (just a question, no intent + blocker)
        - "Me interesa, ¿qué trae?" (interest but a normal question — answer it yourself)
        - "No entiendo bien" (no purchase context → re-explain yourself)
        - "Déjame pensarlo" (normal hesitation, not an explicit blocker + explicit intent)

  Other VERY specific questions outside the bot's scope (volume discounts for schools, invoices with company RUC, etc.) → you may also offer an advisor, but first try to answer what you do know.

  If the case applies, OFFER the advisor with this exact text:
    "¿Deseas que un Asesor especializado se contacte contigo a través de una llamada 📲 para que pueda darte la información a detalle 😊?"

  If the customer accepts (sí, ok, claro, dale, por favor, etc.) → INVOKE notify_admin_advisor_request with a \`reason\` that specifically describes WHAT concrete information THIS customer needs (not a generic text).

  If they respond negatively or ambiguously → do NOT call the tool — keep responding normally.

CUSTOMER RESPONSE AFTER USING notify_admin_emergency OR notify_admin_advisor_request:
- After the tool returns status "sent", respond ONCE with the following text (the content and the number must be there; the tone can be adjusted slightly to sound natural in the conversation):
  "Un asesor especializado se contactará contigo en unos momentos. Mantente pendiente de este chat."
- Do not add anything after it in the same message. Wait for the customer to react.
- If the customer keeps writing afterward, do NOT repeat this message — they already read it. Respond naturally to what they say (or stay silent if their message is just "ok", "gracias", etc.) — the human advisor will take over.`;
  }
  const multiCountryOverride =
    cfgPrompt?.country_mode === "auto_phone"
      ? `\n\nMULTI-COUNTRY SALES OVERRIDE: this bot can sell directly to configured enabled countries. Do NOT emit <<PAIS: ecuador>> just because the customer is from Ecuador or pays in dollars. Use the payment methods injected below for this customer's country. If the system has disabled sales for the customer's country, the workflow intercepts before you answer.`
      : "";
  return { cacheable: cacheable + multiCountryOverride, dynamic: prompt };
}

/**
 * Mapea historial de DB al formato de chat de OpenAI.
 * - Los mensajes con role 'human' se exponen como 'assistant'.
 * - Solo el ÚLTIMO mensaje del cliente con imagen viaja al LLM en formato
 *   multimodal (visión). Las imágenes anteriores quedan como texto en el
 *   historial — el bot ya las "vio" cuando llegaron.
 */
function toChatMessages(
  history: MessageRow[],
  ctx: ReplyContext = {}
): ChatCompletionMessageParam[] {
  // Caching explícito (OpenRouter): marcamos el cerebro estático como cacheable
  // con cache_control. El modelo recibe EXACTAMENTE el mismo texto (las 2 partes
  // concatenadas); si el proveedor no soporta caching, ignora cache_control sin
  // romper nada (peor caso: no ahorra, pero el prompt llega completo igual).
  const sys = buildSystemPrompt(ctx);
  const cacheBlock = {
    type: "text",
    text: sys.cacheable,
    cache_control: { type: "ephemeral" },
  };
  const systemContent = (
    sys.dynamic
      ? [cacheBlock, { type: "text", text: sys.dynamic }]
      : [cacheBlock]
  ) as unknown as string;
  const msgs: ChatCompletionMessageParam[] = [
    { role: "system", content: systemContent },
  ];
  const latestUserIdx = history.findLastIndex((m) => m.role === "user");
  const recentVisionImage = getRecentVisionImage(history);
  for (let i = 0; i < history.length; i++) {
    const m = history[i];
    if (m.role === "user") {
      if (
        i === latestUserIdx &&
        recentVisionImage?.media_url &&
        recentVisionImage?.media_mime
      ) {
        const dataUrl = imageToDataUrl(
          recentVisionImage.media_url,
          recentVisionImage.media_mime
        );
        if (dataUrl) {
          const captionText =
            m.content && m.content !== "[imagen]"
              ? m.content
              : "El cliente envió una imagen.";
          msgs.push({
            role: "user",
            content: [
              { type: "text", text: captionText },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          });
          continue;
        }
      }
      msgs.push({ role: "user", content: m.content });
    } else {
      msgs.push({ role: "assistant", content: m.content });
    }
  }
  return msgs;
}

function shouldUseCompactReceiptPrompt(
  convo: ConversationRow | undefined,
  latestUserText: string | undefined,
  turnHasImage: boolean
): boolean {
  if (!convo || !turnHasImage) return false;
  if (
    convo.state === "payment_done" ||
    convo.state === "payment_approved" ||
    convo.state === "awaiting_email" ||
    convo.state === "awaiting_gift_consent" ||
    convo.state === "awaiting_facebook_comment" ||
    !!convo.selected_payment_method
  ) {
    return true;
  }
  return /\b(pague|pagado|pago hecho|ya pague|transferi|deposite|yapee|yapie|comprobante|voucher|constancia|recibo)\b/.test(
    normalizeIntentText(latestUserText)
  );
}

function toCompactReceiptMessages(
  history: MessageRow[],
  convo: ConversationRow
): ChatCompletionMessageParam[] {
  const recentVisionImage = getRecentVisionImage(history);
  const latestUser = [...history].reverse().find((m) => m.role === "user");
  const expectedPrice = getConversationExpectedPrice(convo);
  const selectedMethod = convo.selected_payment_method ?? "no definido";
  const imageText =
    latestUser?.content && latestUser.content !== "[imagen]"
      ? latestUser.content
      : "El cliente envio una imagen de posible comprobante.";
  const messages: ChatCompletionMessageParam[] = [
    {
      role: "system",
      content:
        "Eres un lector de comprobantes de pago. Tu unica tarea es revisar la imagen del cliente. Si la imagen parece un comprobante de pago real, llama register_payment_amount con monto exacto, metodo, fecha/hora visible, numero de operacion visible y nombre del receptor si aplica. Si NO es comprobante o no puedes leer monto/metodo, responde exactamente: NO_COMPROBANTE. No vendas, no converses, no inventes datos y no apruebes pagos por texto.",
    },
    {
      role: "system",
      content:
        `Contexto minimo para validar: conversacion=${convo.id}; estado=${convo.state}; metodo_elegido=${selectedMethod}; monto_esperado=${expectedPrice}; ya_pagado=${convo.paid_total_cents / 100}. ` +
        "El sistema validara monto, opcion elegida, acumulados, duplicados, fecha y receptor. Tu solo extraes lo visible.",
    },
  ];
  if (recentVisionImage?.media_url && recentVisionImage.media_mime) {
    const dataUrl = imageToDataUrl(
      recentVisionImage.media_url,
      recentVisionImage.media_mime
    );
    if (dataUrl) {
      messages.push({
        role: "user",
        content: [
          { type: "text", text: imageText },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      });
      return messages;
    }
  }
  messages.push({ role: "user", content: imageText });
  return messages;
}

function paymentToolResultToDirectReply(result: string): string | undefined {
  try {
    const parsed = JSON.parse(result) as {
      ok?: boolean;
      status?: string;
      paid_total_soles?: number;
      missing_soles?: number;
      reason?: string;
      customer_message?: string;
      option_name?: string;
      instruction?: string;
    };
    if (
      parsed.status === "CHOICE_REQUIRED" &&
      parsed.customer_message?.trim()
    ) {
      return parsed.customer_message.trim();
    }
    if (parsed.status === "APPROVED") {
      return " ";
    }
    if (parsed.status === "PARTIAL") {
      const paid =
        typeof parsed.paid_total_soles === "number"
          ? `S/.${parsed.paid_total_soles}`
          : "tu abono";
      const missing =
        typeof parsed.missing_soles === "number"
          ? `S/.${parsed.missing_soles}`
          : "la diferencia";
      return `Gracias, ya registré ${paid}. Aún falta completar ${missing}; cuando hagas la diferencia, envíame la foto del nuevo comprobante para darte acceso.`;
    }
    if (parsed.status === "REJECTED") {
      const reason = parsed.reason?.trim();
      return reason
        ? `No pude validar ese comprobante: ${reason}. Por favor envíame una foto clara del comprobante completo.`
        : "No pude validar ese comprobante. Por favor envíame una foto clara del comprobante completo.";
    }
    if (
      parsed.ok === true &&
      parsed.instruction?.includes("<<REENVIAR_PAGO>>")
    ) {
      const optionName = parsed.option_name?.trim() || "tu opción";
      return `¡Perfecto! Aquí van los datos para ${optionName} 😊\n<<REENVIAR_PAGO>>`;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/** Máximo de iteraciones del loop tool-calling para evitar bucles infinitos. */
const MAX_TOOL_ITERATIONS = 3;

/** Mismo precio esperado que usa el validador: opción persistida del Order
 *  Bump + estado normal/oferta de la conversación. */
function getConversationExpectedPrice(
  convo: ConversationRow,
  discountActive = isDiscountActiveForConversation(convo)
): number {
  const choice = convo.order_bump_choice;
  if (choice === "combo" || choice === "basico") {
    const optionPrice = getOrderBumpPriceSoles(
      choice,
      discountActive
    );
    if (optionPrice !== null) return optionPrice;
  }
  const bioChoice = convo.bioferta_choice;
  if (bioChoice === "a" || bioChoice === "b" || bioChoice === "pack") {
    const biofertaPrice = getBiofertaPriceSoles(
      bioChoice,
      discountActive,
      convo.phone
    );
    if (biofertaPrice !== null) return biofertaPrice;
  }
  return getEffectivePriceSoles(discountActive, convo.phone);
}

async function runToolCall(
  conversationId: number,
  toolCall: ChatCompletionMessageToolCall
): Promise<string> {
  // El SDK cubre el shape genérico — para function tools tenemos `function`.
  const fnCall =
    "function" in toolCall ? toolCall.function : null;
  const name = fnCall?.name;
  const argsRaw = fnCall?.arguments ?? "{}";
  if (name === "register_payment_amount") {
    // GUARD POST-COMPRA: si el cliente YA pagó (cualquier estado post-compra),
    // NO reprocesar ni rechazar — solo está comentando algo. Evita contradecir
    // la confirmación ya dada (decirle "no se pudo aprobar" tras haber aprobado
    // y entregado el material).
    const paidConvo = getConversationById(conversationId);
    if (
      paidConvo &&
      (paidConvo.state === "payment_approved" ||
        paidConvo.state === "awaiting_email" ||
        paidConvo.state === "awaiting_gift_consent" ||
        paidConvo.state === "awaiting_facebook_comment")
    ) {
      const config = loadWorkflowConfig();
      let incomingAmountSoles: number | null = null;
      try {
        const parsedArgs = JSON.parse(argsRaw) as { amount_soles?: unknown };
        if (
          typeof parsedArgs.amount_soles === "number" &&
          Number.isFinite(parsedArgs.amount_soles)
        ) {
          incomingAmountSoles = parsedArgs.amount_soles;
        }
      } catch {
        incomingAmountSoles = null;
      }
      const comboPriceSoles =
        paidConvo.order_bump_choice === "basico" &&
        config?.doble_oferta_dos?.enabled
          ? getOrderBumpPriceSoles(
              "combo",
              isDiscountActiveForConversation(paidConvo, config)
            )
          : null;
      const incomingCompletesCombo =
        comboPriceSoles !== null &&
        incomingAmountSoles !== null &&
        paidConvo.paid_total_cents + Math.round(incomingAmountSoles * 100) >=
          Math.round(comboPriceSoles * 100);
      const recentUpgradeChoice =
        paidConvo.order_bump_choice === "basico"
          ? getRecentUserMessages(conversationId, 10)
              .map((message) =>
                inferTwoTierChoiceFromContext(
                  message.content,
                  paidConvo.order_bump_choice,
                  config
                )
              )
              .find((choice) => choice === "combo")
          : null;
      if (recentUpgradeChoice === "combo" || incomingCompletesCombo) {
        console.log(
          `[openrouter] convo ${conversationId}: permito comprobante postventa por upgrade a combo`
        );
      } else {
      return JSON.stringify({
        status: "APPROVED",
        paid_total_soles: paidConvo.paid_total_cents / 100,
        course_price_soles: getConversationExpectedPrice(paidConvo),
        missing_soles: 0,
        reason:
          "El cliente YA completó su compra y se le entregó el material. NO reproceses el pago ni pidas comprobante de nuevo. Responde breve y cordial; si menciona su nombre o número, agradécele — su acceso ya está activo.",
      });
      }
    }
    // GUARDARAIL TOLERANTE: el LLM puede alucinar haber visto una imagen
    // cuando el cliente solo dice por texto "ya pagué, ahí la ves?". Acá
    // verificamos en la DB que haya una imagen REAL en los últimos 5
    // mensajes del cliente — no solo el más reciente. Esto cubre casos
    // muy comunes que rompían el guardarail antes:
    //   - Cliente manda imagen y después manda texto ("ya está", "?")
    //   - Cliente manda imagen, espera, y al no recibir respuesta manda
    //     otro mensaje preguntando — el "latest" deja de ser la imagen
    //   - Mensajes que llegan en orden distinto del envío real
    // Sin imagen real en los últimos 5 → REJECTED forzado.
    const recentMsgs = getRecentUserMessages(conversationId, 5);
    const hasRecentImage = recentMsgs.some((m) => m.media_type === "image");
    if (!hasRecentImage) {
      const latestType = recentMsgs[0]?.media_type ?? "text";
      const latestText = (recentMsgs[0]?.content ?? "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{Mn}/gu, "");
      const claimsPayment =
        /\b(pague|pagado|pago hecho|ya pague|transferi|deposite|yapee|yapie|comprobante|voucher|constancia|recibo)\b/.test(
          latestText
        );
      if (!claimsPayment) {
        console.warn(
          `[llm:guardrail] convo ${conversationId} llamó pago ante texto ordinario; tool ignorada`
        );
        return JSON.stringify({
          status: "IGNORED",
          reason:
            "El mensaje actual es texto ordinario y no afirma un pago ni contiene una imagen. Ignora por completo esta herramienta: responde al mensaje real según la conversación. NO menciones comprobantes, fotos ni pagos.",
        });
      }
      console.warn(
        `[llm:guardrail] convo ${conversationId} intento aprobar pago sin imagen en los últimos 5 mensajes (último: ${latestType}). REJECTED forzado.`
      );
      // Contamos el rechazo como intento fallido para que la escalada al
      // asesor humano (>=3) también dispare aunque el problema sea de
      // detección de imagen (no de validación de monto).
      const convo = getConversationById(conversationId);
      const expectedPrice = convo
        ? getConversationExpectedPrice(convo)
        : getEffectivePriceSoles(false);
      const failed_attempts_count = convo
        ? trackFailedPaymentAttempt(
            convo,
            "Guardarail: no hay imagen en los últimos 5 mensajes del cliente — probablemente solo texto sin foto adjunta"
          )
        : undefined;
      return JSON.stringify({
        status: "REJECTED",
        paid_total_soles: 0,
        course_price_soles: expectedPrice,
        missing_soles: expectedPrice,
        reason:
          "No se detectó ninguna imagen de comprobante en los mensajes recientes del cliente. El cliente posiblemente dijo que ya pagó pero no adjuntó la foto. Pedile con calidez que envíe la imagen del comprobante como una foto.",
        failed_attempts_count,
      });
    }
    let args: RegisterPaymentArgs;
    try {
      args = JSON.parse(argsRaw) as RegisterPaymentArgs;
    } catch {
      return JSON.stringify({ error: "argumentos JSON inválidos" });
    }
    const result = await executeRegisterPayment(conversationId, args);
    return JSON.stringify(result);
  }
  if (name === "seleccionar_opcion") {
    const latestMessage = getRecentUserMessages(conversationId, 1)[0];
    if (latestMessage?.media_type === "image") {
      return JSON.stringify({
        ok: false,
        instruction:
          "El ultimo mensaje trae una imagen/comprobante. NO registres ni cambies opcion; valida el pago con register_payment_amount.",
      });
    }
    const latestText = latestMessage?.content ?? "";
    const normalizedLatest = latestText
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Mn}/gu, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
    const mentionsPayment =
      /\b(yape|plin|bcp|transferencia|transferir|deposito|depositar|efectivo|pago|pagar)\b/.test(
        normalizedLatest
      );
    const nonPaymentWords = normalizedLatest
      .replace(
        /\b(yape|plin|bcp|transferencia|transferir|deposito|depositar|efectivo|pago|pagar|metodo|metodos|forma|formas|como|donde|por|con|que|puedo|quiero|prefiero|voy|a|usar|el|la|de|favor|gracias)\b/g,
        ""
      )
      .replace(/\s+/g, " ")
      .trim();
    const paymentOnly = mentionsPayment && nonPaymentWords.length === 0;
    if (paymentOnly || isOrderBumpConversationQuestion(latestText)) {
      return JSON.stringify({
        ok: false,
        instruction:
          paymentOnly
            ? "El cliente solo indico o pregunto por el metodo de pago. NO registres ninguna opcion; pregunta brevemente cual de las dos opciones configuradas prefiere."
            : "El cliente esta preguntando o comparando las opciones. NO registres ninguna opcion todavia; responde la duda y deja que el cliente decida despues.",
      });
    }
    let parsed: { option?: string };
    try {
      parsed = JSON.parse(argsRaw) as { option?: string };
    } catch {
      return JSON.stringify({ ok: false, instruction: "Argumentos inválidos." });
    }
    const option =
      parsed.option === "combo"
        ? "combo"
        : parsed.option === "basico"
          ? "basico"
          : null;
    if (!option) {
      return JSON.stringify({
        ok: false,
        instruction:
          "Opción no reconocida. Pregúntale cuál de las 2 opciones prefiere.",
      });
    }
    const result = await executeSelectOrderBumpOption(conversationId, option);
    return JSON.stringify(result);
  }
  if (name === "enviar_imagenes_extra") {
    // SECCIÓN "INFO DETALLADA": galería PROPIA (imágenes + caption del editor).
    // Se envía SOLO cuando el cliente la pide / re-pregunta (la herramienta se
    // llama por eso) → NO usa el registro anti-repetición, así que NUNCA choca
    // con el order bump y siempre re-envía (sin el bug del "te envié y no llegó").
    const items = getDetailGallery();
    if (items.length === 0) {
      return JSON.stringify({
        ok: false,
        instruction:
          "No hay imágenes de info detallada configuradas. Responde la duda del cliente en texto, breve, sin inventar.",
      });
    }
    const convo = getConversationById(conversationId);
    if (!convo) {
      return JSON.stringify({ ok: false, instruction: "Conversación no encontrada." });
    }
    const sent: string[] = [];
    for (const item of items) {
      try {
        await sendBotMediaFromDrive(
          convo,
          item.media_type,
          item.drive_url,
          item.caption?.trim() || undefined
        );
        sent.push(item.topic);
      } catch (err) {
        console.error(`[llm] envío imagen detallada "${item.topic}" falló:`, err);
      }
    }
    if (sent.length === 0) {
      return JSON.stringify({
        ok: false,
        status: "send_failed",
        instruction:
          "No se pudieron enviar las imágenes por un fallo técnico. NO le digas al cliente que ya se las enviaste; discúlpate brevemente y ofrécele explicarle en texto.",
      });
    }
    return JSON.stringify({
      ok: true,
      status: "sent_now",
      sent,
      instruction:
        "Las imágenes adicionales ya se enviaron y están visibles ARRIBA de tu próxima respuesta. Confirma con UNA sola línea cálida; no las describas de nuevo ni prometas enviarlas después.",
    });
  }
  if (name === "enviar_info_contenido") {
    // ENTREGA DETERMINÍSTICA: el sistema manda las imágenes de la galería con
    // SU caption del editor (texto controlado por el operador, el modelo no lo
    // improvisa). Anti-repetición vía sent_media: cada tema se envía UNA vez.
    // objetivo="complemento" → solo la imagen del complemento (bajo pedido);
    // objetivo="oferta" (default) → el paquete de la oferta (principal + pack).
    let objetivo: "oferta" | "complemento" = "oferta";
    let introduccion = "";
    let forceResend = false;
    try {
      const parsed = JSON.parse(argsRaw) as {
        objetivo?: string;
        introduccion?: string;
        force_resend?: boolean;
      };
      if (parsed.objetivo === "complemento") objetivo = "complemento";
      introduccion = parsed.introduccion?.trim().slice(0, 240) ?? "";
      forceResend = parsed.force_resend === true;
    } catch {
      /* sin args válidos → oferta por defecto */
    }
    if (loadWorkflowConfig()?.doble_oferta_dos?.enabled) {
      objetivo = "oferta";
    }
    const topics =
      objetivo === "complemento"
        ? [getComplementInfoTopic()].filter(Boolean)
        : getProductInfoTopics();
    if (topics.length === 0) {
      return JSON.stringify({
        ok: false,
        instruction:
          objetivo === "complemento"
            ? "No hay imagen del complemento configurada. Responde su duda en texto, breve, recordando que el complemento va incluido en el pack; no inventes."
            : "No hay imágenes de contenido configuradas. Responde la duda en texto, breve y centrado en el producto principal; no inventes.",
      });
    }
    const convo = getConversationById(conversationId);
    if (!convo) {
      return JSON.stringify({ ok: false, instruction: "Conversación no encontrada." });
    }
    const gallery = getImageGallery();
    const already = new Set(getSentMedia(conversationId));
    const sequenceMarker = "__product_info_sequence__";
    const items = topics
      .map((topic) =>
        gallery.find((item) => item.topic.toLowerCase() === topic.toLowerCase())
      )
      .filter((item): item is NonNullable<typeof item> => !!item);

    if (items.length !== topics.length) {
      return JSON.stringify({
        ok: false,
        instruction:
          "La secuencia de contenido está incompleta en el editor. No afirmes que enviaste imágenes; responde brevemente en texto sin inventar.",
      });
    }

    // La secuencia de oferta es atómica: si las dos piezas ya salieron antes,
    // se reconoce como completa; si solo salió una, se reenvían ambas en orden.
    // Solo se considera "ya enviada" si ESTA misma secuencia salió antes (su
    // marcador propio). NO la bloqueamos porque una imagen suelta se haya
    // mostrado por la galería <<MEDIA>> — eso dejaba al bot diciendo "ya las
    // envié" sin que el cliente las recibiera. El pedido explícito manda.
    // Siempre re-enviamos cuando el bot llama a esta herramienta: solo la llama
    // si el cliente PIDE/ACEPTA ver el contenido, así que nunca decimos "ya
    // enviadas, desliza arriba" (eso confundía al cliente). Mantenemos las refs
    // para compatibilidad, pero la condición queda en false.
    const sequenceAlreadySent =
      false && !forceResend && already.has(sequenceMarker);
    if (sequenceAlreadySent) {
      markMediaSent(conversationId, sequenceMarker);
      return JSON.stringify({
        ok: true,
        status: "already_sent",
        instruction:
          "Las imágenes con el contenido del curso YA fueron enviadas antes y están un poco más ARRIBA en esta misma conversación. Con palabras simples y cotidianas (NUNCA digas 'secuencia visual' ni términos técnicos), dile al cliente que suba o deslice un poquito hacia arriba en el chat para verlas. Responde solo su duda puntual si la hay, y luego pregúntale cuál de las dos opciones desea adquirir. No vuelvas a ofrecer más información.",
      });
    }

    if (
      false &&
      objetivo === "complemento" &&
      items.every((item) => already.has(item.topic.toLowerCase()))
    ) {
      return JSON.stringify({
        ok: true,
        status: "already_sent",
        instruction:
          "La imagen del complemento ya fue enviada anteriormente. NO digas que la enviarás ni la repitas; responde brevemente y recuerda que pertenece al pack.",
      });
    }

    if (introduccion) await sendBotText(convo, introduccion);
    const progressive = getProgressiveSamplesConfig();
    const progressiveActive =
      progressive.enabled && objetivo === "oferta" && !forceResend;
    const pendingItems = progressiveActive
      ? items.filter((item) => !already.has(item.topic.toLowerCase()))
      : items;
    const itemsToSend = progressiveActive
      ? pendingItems.slice(0, progressive.maxPerBatch)
      : pendingItems;

    if (progressiveActive && itemsToSend.length === 0) {
      return JSON.stringify({
        ok: true,
        status: "already_sent",
        instruction:
          "Ya se enviaron todas las muestras configuradas para el contenido. Dile al cliente en una frase breve que ya le mostraste todas las disponibles arriba en el chat, responde solo su duda puntual si la hay y avanza suavemente hacia la eleccion de la opcion que desea adquirir.",
      });
    }

    const sent: string[] = [];
    for (const item of itemsToSend) {
      const key = item.topic.toLowerCase();
      try {
        await sendBotMediaFromDrive(
          convo,
          item.media_type,
          item.drive_url,
          item.caption?.trim() || undefined
        );
        markMediaSent(conversationId, key);
        already.add(key);
        sent.push(item.topic);
      } catch (err) {
        console.error(`[llm] envío info contenido "${key}" falló:`, err);
      }
    }
    const remainingAfterBatch =
      progressiveActive && pendingItems.length > sent.length;
    const fullSequenceSent =
      objetivo === "oferta" &&
      (progressiveActive
        ? !remainingAfterBatch && sent.length === itemsToSend.length
        : sent.length === items.length);
    if (fullSequenceSent) {
      markMediaSent(conversationId, sequenceMarker);
    }
    if (sent.length === 0) {
      // Llegamos al loop y NO salió ninguna imagen → el envío FALLÓ de verdad
      // (el caso "ya enviado" se resolvió ANTES, arriba). No mentir al cliente.
      return JSON.stringify({
        ok: false,
        status: "send_failed",
        instruction:
          "No se pudieron enviar las imágenes por un fallo técnico. NO le digas al cliente que ya se las enviaste ni que están en el chat. Discúlpate brevemente y ofrécele explicarle el contenido por texto mientras tanto.",
      });
    }
    if (sent.length !== itemsToSend.length) {
      return JSON.stringify({
        ok: false,
        status: "partial_failure",
        sent,
        instruction:
          "No se pudo completar toda la secuencia. NO afirmes que se enviaron todas las imágenes ni prometas que llegarán después; ofrece explicar la información brevemente en texto.",
      });
    }
    if (remainingAfterBatch) {
      return JSON.stringify({
        ok: true,
        status: "sent_batch",
        sent,
        remaining: pendingItems.length - sent.length,
        introduction_already_sent: introduccion || null,
        instruction: `Las muestras configuradas ya se enviaron arriba, pero SOLO fue una tanda para no saturar. Responde unicamente con este cierre, sin describir de nuevo las imagenes ni ofrecer otras cosas: "${progressive.moreText}" Si el cliente responde que si quiere ver mas, vuelve a llamar enviar_info_contenido con objetivo='oferta' y force_resend=false para mandar la siguiente tanda.`,
      });
    }
    return JSON.stringify({
      ok: true,
      status: "sent_now",
      sent,
      introduction_already_sent: introduccion || null,
      instruction:
        objetivo === "complemento"
          ? "La imagen del complemento ya se envió y está visible ARRIBA de tu próxima respuesta. Habla en pasado/presente, recuerda brevemente que pertenece al pack y NO prometas enviarla después."
          : "La introducción ya fue enviada ANTES de las imágenes, y las imágenes con el contenido del curso ya están visibles justo arriba. NO repitas ni parafrasees esa introducción ni uses términos como 'secuencia visual'. Escribe únicamente una pregunta breve para que elija una de las dos opciones; no ofrezcas más información ni repitas descripciones.",
    });
  }
  if (name === "consultar_contenido_order_bump") {
    const config = loadWorkflowConfig();
    if (!config?.order_bump?.enabled) {
      return JSON.stringify({
        ok: false,
        instruction: "Order Bump inactivo; responde con el flujo normal.",
      });
    }
    const convo = getConversationById(conversationId);
    const basicName = config.order_bump.basico?.name ?? "Opcion basica";
    const comboName = config.order_bump.combo?.name ?? "Combo";
    const basicGifts = config.order_bump.basico?.regalos?.trim() ?? "";
    const comboGifts = config.order_bump.combo?.regalos?.trim() ?? "";
    const mainName = config.product_name ?? basicName;
    const complementName =
      config.product_name_2 ?? "Producto complementario";
    const optionPresentationRule =
      config.order_bump_option_presentation_rule?.trim() ||
      DEFAULT_ORDER_BUMP_OPTION_PRESENTATION_RULE;
    let scope: "options" | "complement" = "options";
    try {
      const parsed = JSON.parse(argsRaw) as { scope?: string };
      if (parsed.scope === "complement") scope = "complement";
    } catch {
      /* alcance seguro por defecto: opciones vendibles */
    }
    return JSON.stringify({
      ok: true,
      scope,
      instruction:
        scope === "complement"
          ? "Pidió explícitamente detalles del complemento. Resume máximo 2-3 datos de complementary_product.content, aclara que únicamente forma parte de combo_option y no se vende aparte. No lo llames regalo, gratis, bonus ni pack extra de regalo salvo que el contenido editable lo diga literalmente; usa complemento/producto adicional/kit adicional. No conviertas la respuesta en inventario."
          : `Da un resumen comercial breve basado en el editor. Para la opción básica usa su nombre y al menos 1 dato concreto de main_product.content; una cantidad/numero sola no alcanza, incluye también un ejemplo, categoría, beneficio o uso real del contenido editable. Nunca la resumas como "solo", "producto principal" ni versión menor genérica. Si la regla editable trae ejemplos de frases prohibidas entre comillas, no copies esas frases. Aplica esta regla editable de Ajustes para presentar las opciones: ${optionPresentationRule} Si sellable_options.combo.gifts o sellable_options.basic.gifts tienen texto, menciona esos regalos de forma breve junto a su opción; si están vacíos, no inventes regalos. Cierra ofreciendo mostrar las imágenes configuradas, no saltando directamente al pago.`,
      option_structure: {
        combo_option: {
          sellable_name: comboName,
          consists_of: [mainName, complementName],
        },
        basic_option: {
          sellable_name: basicName,
          consists_of: [mainName],
        },
        not_sold_separately: complementName,
      },
      sellable_options: {
        combo: {
          name: comboName,
          price_soles: getOrderBumpPriceSoles(
            "combo",
            isDiscountActiveForConversation(convo, config)
          ),
          includes: `${mainName} + ${complementName}`,
          gifts: applyProductName(comboGifts),
        },
        basic: {
          name: basicName,
          price_soles: getOrderBumpPriceSoles(
            "basico",
            isDiscountActiveForConversation(convo, config)
          ),
          includes: mainName,
          gifts: applyProductName(basicGifts),
        },
      },
      main_product: {
        name: mainName,
        content: applyProductName(config.course_content?.trim() ?? ""),
      },
      complementary_product: {
        name: complementName,
        content: applyProductName(config.course_content_2?.trim() ?? ""),
      },
    });
  }
  if (name === "notify_admin_emergency") {
    let args: NotifyEmergencyArgs;
    try {
      args = JSON.parse(argsRaw) as NotifyEmergencyArgs;
    } catch {
      return JSON.stringify({ error: "argumentos JSON inválidos" });
    }
    const result = await executeNotifyEmergency(conversationId, args);
    return JSON.stringify(result);
  }
  if (name === "notify_admin_advisor_request") {
    let args: NotifyAdvisorArgs;
    try {
      args = JSON.parse(argsRaw) as NotifyAdvisorArgs;
    } catch {
      return JSON.stringify({ error: "argumentos JSON inválidos" });
    }
    const result = await executeNotifyAdvisor(conversationId, args);
    return JSON.stringify(result);
  }
  return JSON.stringify({ error: `tool desconocida: ${name}` });
}

function looksLikeIncompleteReply(text: string): boolean {
  const visible = text
    .replace(/<{1,2}\s*RESUMEN\s*:[\s\S]*$/i, "")
    .trim();
  if (!visible || visible.length > 100) return false;
  if (
    /\b(el|la|los|las|lo|un|una|de|del|que|para|por|con|y|o)$/i.test(
      visible
    )
  ) {
    return true;
  }

  // Detecta una cola mínima abandonada después de una oración ya cerrada,
  // por ejemplo "¡Hola! Te". No depende de cuál sea la palabra final.
  const lastTerminal = Math.max(
    visible.lastIndexOf("."),
    visible.lastIndexOf("!"),
    visible.lastIndexOf("?")
  );
  if (lastTerminal < 0 || lastTerminal === visible.length - 1) return false;
  const danglingWords = visible
    .slice(lastTerminal + 1)
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return danglingWords.length > 0 && danglingWords.length <= 2;
}

function withoutCustomerName(text: string, customerName?: string | null): string {
  const name = customerName?.trim();
  if (!name) return text;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text
    .replace(new RegExp(`\\b${escaped}\\b\\s*,?`, "giu"), "")
    .replace(/\s+([,.;!?])/g, "$1")
    .replace(/ {2,}/g, " ")
    .trim();
}

export async function generateReply(
  history: MessageRow[],
  ctx: ReplyContext = {}
): Promise<string> {
  const client = getClient();
  // MODELO HÍBRIDO: el chat normal (texto) usa el modelo barato (OPENROUTER_MODEL,
  // p.ej. DeepSeek). Pero si ESTE turno trae una imagen (comprobante de pago), la
  // lee un modelo de visión más fiable para OCR de montos (OPENROUTER_VISION_MODEL,
  // p.ej. Gemini). Solo aplica cuando el ÚLTIMO mensaje es la imagen — que es el
  // único caso en que toChatMessages la manda en formato multimodal. El resto del
  // flujo queda EXACTAMENTE igual. Si no se define OPENROUTER_VISION_MODEL, cae al
  // modelo de chat normal (comportamiento previo, sin romper nada).
  const recentVisionImage = getRecentVisionImage(history);
  const turnHasImage = !!recentVisionImage;
  const chatModel = process.env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini";
  const visionModel = process.env.OPENROUTER_VISION_MODEL || chatModel;
  const model = turnHasImage ? visionModel : chatModel;
  const convo = ctx.conversationId ? getConversationById(ctx.conversationId) : undefined;
  const workflowConfig = loadWorkflowConfig();

  const latestUserText = [...history]
    .reverse()
    .find((item) => item.role === "user")?.content;
  const latestAssistantText = [...history]
    .reverse()
    .find((item) => item.role !== "user")?.content;
  const genericOrderBumpPriceTurn =
    !!convo &&
    workflowConfig?.order_bump?.enabled === true &&
    // Modo diferido (toggle ON): una pregunta de precio NO debe forzar las 2
    // opciones — el bot vende solo el producto 1 hasta que elija método de pago.
    workflowConfig?.order_bump?.offer_on_intro_first_message !== false &&
    convo.order_bump_choice !== "combo" &&
    convo.order_bump_choice !== "basico" &&
    isPriceQuestion(latestUserText ?? "") &&
    detectOrderBumpChoice(latestUserText ?? "", workflowConfig) === null;
  const orderBumpReplyGuard =
    !!convo && workflowConfig?.order_bump?.enabled === true;

  const orderBumpFlow =
    !!convo &&
    workflowConfig?.order_bump?.enabled === true &&
    (convo.state === "awaiting_order_bump_choice" ||
      convo.order_bump_choice === "combo" ||
      convo.order_bump_choice === "basico");
  const latestUserMessage = [...history]
    .reverse()
    .find((item) => item.role === "user");
  const latestNormalizedText = (latestUserMessage?.content ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "");
  const paymentToolRelevant =
    !!recentVisionImage ||
    /\b(pague|pagado|pago hecho|ya pague|transferi|deposite|yapee|yapie|comprobante|voucher|constancia|recibo)\b/.test(
      latestNormalizedText
    );
  const compactReceiptPrompt = shouldUseCompactReceiptPrompt(
    convo,
    latestUserText,
    turnHasImage
  );
  const messages: ChatCompletionMessageParam[] =
    compactReceiptPrompt && convo
      ? toCompactReceiptMessages(history, convo)
      : toChatMessages(history, {
          ...ctx,
          latestUserText,
          latestAssistantText,
        });
  const paymentTools = paymentToolRelevant ? [REGISTER_PAYMENT_TOOL] : [];
  const tools: ChatCompletionTool[] | undefined = ctx.conversationId
    ? compactReceiptPrompt
      ? [COMPACT_REGISTER_PAYMENT_TOOL]
      : orderBumpFlow
      ? [
          ...paymentTools,
          SELECT_OPTION_TOOL,
          ORDER_BUMP_CONTENT_TOOL,
          SEND_PRODUCT_INFO_TOOL,
        ]
      : [
          ...paymentTools,
          NOTIFY_EMERGENCY_TOOL,
          NOTIFY_ADVISOR_TOOL,
        ]
    : undefined;
  const forcePaymentReview =
    !!convo &&
    convo.state === "payment_done" &&
    !!recentVisionImage;
  const answerOnlyWhileAwaitingPayment =
    convo?.state === "payment_done" && !paymentToolRelevant;
  // El cliente indica que VA A PAGAR ahora (no que ya pagó). En ese momento
  // puntual SÍ corresponde el cierre con el comprobante: no es presión repetida.
  // Permitimos el recordatorio (abajo se exceptúa la guarda anti-presión) y se
  // lo pedimos al bot con calidez + emoji. Solo aplica en payment_done; el resto
  // del flujo queda EXACTAMENTE igual que antes.
  const payingNowText = (latestUserMessage?.content ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "");
  const customerSignalsPaying =
    convo?.state === "payment_done" &&
    /\b(voy a (pagar|yapear|depositar|transferir)|ya voy a pagar|procedo a pagar|paso a pagar|estoy pagando|ahora(?: mismo)? lo pago|ahorita lo pago|hago el (pago|deposito|yape)|en un momento pago)\b/.test(
      payingNowText
    );
  if (customerSignalsPaying) {
    messages.push({
      role: "system",
      content:
        "EL CLIENTE INDICA QUE VA A PAGAR AHORA. Confírmale con un tono AMIGABLE y de CONFIANZA, y en la MISMA respuesta recuérdale en UNA línea cálida que, apenas haga el pago, te envíe AQUÍ la foto/captura de su comprobante para verificar y darle acceso inmediato. Transmite que estás ahí para ayudarle. Incluye SIEMPRE una carita sonriente 😊, y si encaja suma un emoji que evoque enviar la foto del pago desde el celular (📸 o 🤳🏼). Es el momento correcto para este recordatorio; no es presión.",
    });
  }
  let incompleteReplyRetries = 0;
  let genericPriceRetries = 0;
  let paymentPressureRetries = 0;
  let minimizedBasicRetries = 0;
  let paymentAnswerFallback = "";

  for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
    const completion = await client.chat.completions.create({
      model,
      messages,
      temperature: compactReceiptPrompt ? 0 : 0.6,
      // Techo amplio para que una respuesta normal (explicar 2 opciones +
      // precios + pago) NUNCA se corte a media frase. La brevedad la sigue
      // mandando el prompt; esto solo evita el truncado.
      max_tokens: compactReceiptPrompt ? 256 : 1024,
      tools,
      tool_choice:
        iter === 0 && (forcePaymentReview || compactReceiptPrompt)
          ? {
              type: "function",
              function: { name: "register_payment_amount" },
            }
          : undefined,
    });
    // LOG DE TOKENS/COSTO (reversible, solo consola): muestra cuántos tokens
    // usó cada llamada y CUÁNTOS vinieron del caché. Así se verifica con números
    // que el caché automático de DeepSeek está pegando. No cambia nada del bot.
    const usage = completion.usage as
      | {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
          prompt_cache_hit_tokens?: number;
          prompt_tokens_details?: { cached_tokens?: number };
        }
      | undefined;
    if (usage) {
      const promptTk = usage.prompt_tokens ?? 0;
      const cached =
        usage.prompt_cache_hit_tokens ??
        usage.prompt_tokens_details?.cached_tokens ??
        0;
      const pct = promptTk > 0 ? Math.round((cached / promptTk) * 100) : 0;
      console.log(
        `[llm:usage] model=${model} modo=${compactReceiptPrompt ? "comprobante_liviano" : "normal"} prompt=${promptTk} (cacheado=${cached}/${pct}%) salida=${usage.completion_tokens ?? 0} total=${usage.total_tokens ?? 0}`
      );
    }
    const message = completion.choices[0]?.message;
    if (!message) {
      throw new Error("Respuesta vacía del LLM");
    }

    const toolCalls = message.tool_calls;
    if (!toolCalls || toolCalls.length === 0) {
      const text = message.content?.trim();
      if (!text) {
        // Si no hay texto pero tampoco tools, devolvemos algo genérico
        // para no romper. Esto es raro; el prompt debería cubrirlo.
        return "✅";
      }
      if (compactReceiptPrompt) {
        return "No pude validar ese comprobante. Por favor envíame una foto clara del comprobante completo donde se vea el monto, la fecha y la operación.";
      }
      const finishReason = completion.choices[0]?.finish_reason;
      const replyIncomplete =
        finishReason === "length" || looksLikeIncompleteReply(text);
      if (replyIncomplete && incompleteReplyRetries < 2) {
        incompleteReplyRetries += 1;
        console.warn(
          `[llm] respuesta incompleta (${finishReason ?? "texto cortado"}); reintento ${incompleteReplyRetries}`
        );
        continue;
      }
      if (replyIncomplete) {
        // Tras los reintentos SIGUE cortada → NUNCA mandamos un fragmento a
        // medias (queda fatal en una venta, ej. "...para dar"). Cerramos seguro:
        // si es la pregunta de precio del order bump, con la plantilla de
        // aclaración; si no, con una línea breve y completa.
        console.warn(
          `[llm] respuesta sigue incompleta tras reintentos; uso fallback seguro`
        );
        if (genericOrderBumpPriceTurn) {
          const clarification =
            workflowConfig?.order_bump?.choice_clarification?.trim() ||
            "¿Cuál de estas dos opciones prefieres: {{OPCION_1}} o {{OPCION_2}}?";
          return renderOrderBumpTemplate(
            clarification,
            isDiscountActiveForConversation(convo, workflowConfig)
          );
        }
        return "Disculpa, se me cortó el mensaje 😅 ¿en qué te puedo ayudar?";
      }
      if (
        genericOrderBumpPriceTurn &&
        /(?:S\s*\/\s*\.?\s*\d|\b\d+(?:[.,]\d+)?\s*sol(?:es)?\b)/i.test(
          text
        )
      ) {
        if (genericPriceRetries < 1) {
          genericPriceRetries += 1;
          messages.push({
            role: "system",
            content:
              "RETRY REQUIRED: this is a generic price question in an unselected Order Bump. Do not quote any price. Ask naturally which of the two configured sellable options they mean.",
          });
          continue;
        }
        const clarification =
          workflowConfig?.order_bump?.choice_clarification?.trim() ||
          "¿Cuál de estas dos opciones prefieres: {{OPCION_1}} o {{OPCION_2}}?";
        return renderOrderBumpTemplate(
          clarification,
          isDiscountActiveForConversation(convo, workflowConfig)
        );
      }
      if (
        orderBumpReplyGuard &&
        minimizedBasicRetries < 1 &&
        looksLikeMinimizedOrderBumpBasicReply(text)
      ) {
        minimizedBasicRetries += 1;
        messages.push({
          role: "system",
          content:
            "RETRY REQUIRED: you minimized the second Order Bump option. Rewrite briefly using its configured name plus one concrete example/category/benefit/use case from editable content. Do not use 'solo', 'nada mas', 'producto principal', 'version menor/reducida/inferior' or numbered option emojis. If price was not explicitly asked, do not include price.",
        });
        continue;
      }
      if (
        answerOnlyWhileAwaitingPayment &&
        !customerSignalsPaying &&
        /\b(comprobante|voucher|recibo|foto|imagen)\b/i.test(text)
      ) {
        const pressureStart = text.search(
          /(?:^|\n|[.!?]\s*)[^\n.!?]*\b(?:comprobante|voucher|recibo|foto|imagen)\b/i
        );
        if (pressureStart > 0 && !paymentAnswerFallback) {
          paymentAnswerFallback = text.slice(0, pressureStart).trim();
        }
        if (paymentPressureRetries < 1) {
          paymentPressureRetries += 1;
          messages.push({
            role: "system",
            content:
              "RETRY REQUIRED: the payment details and receipt request are already visible. Answer only the customer's current question. Do not mention, request or remind them about payment, receipts, photos or access, and do not add a sales CTA.",
          });
          continue;
        }
        if (pressureStart > 0)
          return withoutCustomerName(
            text.slice(0, pressureStart).trim(),
            ctx.clientName
          );
        if (paymentAnswerFallback)
          return withoutCustomerName(paymentAnswerFallback, ctx.clientName);
      }
      return withoutCustomerName(text, ctx.clientName);
    }

    if (!ctx.conversationId) {
      // No deberíamos llegar aquí (sin conversationId no enviamos tools),
      // pero por seguridad, pedimos respuesta sin tools.
      console.warn("[llm] tool calls sin conversationId, descartando");
      return message.content?.trim() ?? "✅";
    }

    // Añadimos el mensaje del assistant (con sus tool_calls) al historial.
    messages.push({
      role: "assistant",
      content: message.content ?? "",
      tool_calls: toolCalls,
    });

    // Ejecutamos cada tool y añadimos el resultado.
    let directToolReply: string | undefined;
    for (const toolCall of toolCalls) {
      const result = await runToolCall(ctx.conversationId, toolCall);
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: result,
      });
      try {
        const parsed = JSON.parse(result) as {
          ok?: boolean;
          status?: string;
          customer_message?: string;
          option_name?: string;
          instruction?: string;
        };
        if (
          parsed.status === "CHOICE_REQUIRED" &&
          parsed.customer_message?.trim()
        ) {
          directToolReply = parsed.customer_message.trim();
        } else if (parsed.status === "APPROVED") {
          directToolReply = " ";
        } else if (
          parsed.ok === true &&
          parsed.instruction?.includes("<<REENVIAR_PAGO>>")
        ) {
          const optionName = parsed.option_name?.trim() || "tu opción";
          directToolReply = `¡Perfecto! Aquí van los datos para ${optionName} 😊\n<<REENVIAR_PAGO>>`;
        }
      } catch {
        // Las otras tools pueden devolver texto no JSON; siguen el loop normal.
      }
      if (!directToolReply && compactReceiptPrompt) {
        directToolReply = paymentToolResultToDirectReply(result);
      }
    }
    if (directToolReply) return directToolReply;
    // Loop continúa para que el LLM vea los resultados y genere texto.
  }

  console.warn("[llm] max tool iterations alcanzado");
  return "✅ Recibido. Revisa los siguientes mensajes.";
}
