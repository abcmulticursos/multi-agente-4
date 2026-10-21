import {
  addToPaidTotal,
  cancelPendingActionsForConvo,
  getConversationById,
  getLockedPriceSoles,
  getRecentUserMessages,
  incrementPaymentAttemptsFailed,
  resetPaymentAttemptsFailed,
  scheduleAction,
  setBiofertaChoice,
  setUpsellState,
  setUpsellPaidAt,
  addToUpsellPaid,
  resetUpsellPaid,
  anotarCompraDeLaFila,
  setConversationState,
  setCountedReceipts,
  setLockedPrice,
  setOrderBumpChoice,
  setPaidAt,
  setPendingDeliverySource,
  setSelectedPaymentMethod,
  type ConversationRow,
} from "@/lib/db";
import {
  detectBiofertaChoice,
  getEffectiveCountryCode,
  cuerpoDeBotones,
  titulosDeBotones,
  getUpsellPriceSoles,
  getBiofertaPackPriceSoles,
  getBiofertaPriceSoles,
  getEffectivePriceSoles,
  getOrderBumpOption,
  getOrderBumpPriceSoles,
  getProductName,
  isDiscountActiveForConversation,
  isBiofertaActive,
  isOrderBumpActive,
  isDobleOfertaActive,
  getActiveTwoTierOffer,
  seccionUpsell,
  conLaFilaDe,
  entregasDeLoCompradoEnLaFila,
  detectaIntencionDeSubirAlCombo,
  isOrderBumpConversationQuestion,
  loadWorkflowConfig,
  getPaymentMethodLabel,
  resolveCountryPaymentProfile,
  elCobroDelPais,
  pickVariant,
  sectionHasPlaceholder,
  inferTwoTierChoiceFromContext,
  detectExactOrderBumpChoice,
  renderOrderBumpTemplate,
  aplicarProductoEntregado,
  laEntregaLaLlenaUnProducto,
  type FuenteDeEntrega,
  type ResponseStep,
  type SequenceStep,
} from "@/lib/workflow/config";
import {
  sendBotButtons,
  sendBotMediaFromDrive,
  sendBotText,
} from "@/lib/workflow/sender";
import { buildMessagingUserData, sendPurchaseEvent } from "@/lib/meta/conversions";
import { esComprobantePdf } from "@/lib/meta/media";
import { notifyAdmin } from "@/lib/notifications";
import { syncLeadStatus } from "@/lib/leads-sync";
import { formatCurrencyAmount, getCountryInfo } from "@/lib/countries";
import { literal } from "@/lib/texto-literal";

/** La lista vive en config.ts como `FuenteDeEntrega`, porque ahí es donde se
 *  resuelve el comodín del producto entregado. Aquí se conserva el nombre de
 *  siempre para no tocar los sitios que ya lo importan de este archivo. */
export type DeliverySource = FuenteDeEntrega;

// Las entregas programadas para "ahora" no deben depender de que el intervalo
// del worker haya despertado después de un deploy o una pausa del servidor.
function nudgeDeliveryWorker(): void {
  void import("./worker")
    .then(({ tick }) => tick())
    .catch((error) =>
      console.error("[wf:pago] no pude despertar la cola de entrega:", error)
    );
}

/** Modalidad de 2 opciones (combo/básico) activa: order bump O doble oferta 2
 *  productos. Comparten toda la lógica de validación y entrega por opción, y son
 *  mutuamente excluyentes, así que aquí se tratan igual. */
function isTwoTierActive(): boolean {
  return isOrderBumpActive() || isDobleOfertaActive();
}

function formatSoles(amount: number): string {
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
}

/**
 * Infiere la opción del order bump (combo/básico) a partir del MONTO del
 * comprobante: si coincide EXACTO con el precio de UNA sola opción (normal u
 * oferta), esa es la elección. El monto no tiene margen de error, así que aprueba
 * aunque la palabra de elección no estuviera en la lista de aliases. Devuelve null
 * si es ambiguo (calza con ambas o con ninguna) → ahí se pide elegir.
 */
function inferOrderBumpChoiceFromAmount(
  amountSoles: number,
  phone: string | null,
  /**
   * LA ETAPA DE ESTA CONVERSACIÓN, Y POR QUÉ CAMBIA EL RESULTADO.
   *
   * SUS PRECIOS SE SOLAPAN, y no es un descuido: es lo normal. Medido con su
   * configuración de Perú el 28/09/2026:
   *
   *     sin oferta    la cara 14    la barata 10
   *     con oferta    la cara 10    la barata  8
   *
   * Un pago de 10 es la CARA con la oferta corriendo y la BARATA sin ella. Con
   * los cuatro precios en la misma bolsa calza con las dos y esto se abstiene —
   * justo cuando el cliente acaba de pagar exactamente lo que se le pidió.
   *
   * EL CLIENTE PAGA EL NÚMERO QUE TIENE DELANTE, y eso depende de su etapa. Así
   * que cuando se sabe la etapa se prueba PRIMERO ese par: ahí el 10 solo puede
   * ser una de las dos. Es la misma regla que ya usan
   * `laOpcionPorElPrecioQueCobra` y `elPrecioDeUnaSolaOpcionSinElegir`.
   *
   * OPCIONAL A PROPÓSITO: quien no lo pase se comporta EXACTAMENTE igual que
   * hasta hoy —los cuatro precios juntos—, y ése es el camino que lleva meses
   * aprobando pagos. Y si el par de la etapa tampoco desempata, se cae a ese
   * mismo camino de siempre. Esto solo puede añadir certeza, nunca quitarla.
   */
  conOferta?: boolean
): "combo" | "basico" | null {
  if (typeof amountSoles !== "number" || !Number.isFinite(amountSoles)) return null;
  const near = (p: number | null | undefined): boolean =>
    typeof p === "number" && p > 0 && Math.abs(amountSoles - p) < 0.01;
  if (typeof conOferta === "boolean") {
    const enSuEtapa = near(getOrderBumpPriceSoles("combo", conOferta, phone));
    const laOtraEnSuEtapa = near(
      getOrderBumpPriceSoles("basico", conOferta, phone)
    );
    if (enSuEtapa && !laOtraEnSuEtapa) return "combo";
    if (laOtraEnSuEtapa && !enSuEtapa) return "basico";
  }
  const comboMatch =
    near(getOrderBumpPriceSoles("combo", false, phone)) ||
    near(getOrderBumpPriceSoles("combo", true, phone));
  const basicoMatch =
    near(getOrderBumpPriceSoles("basico", false, phone)) ||
    near(getOrderBumpPriceSoles("basico", true, phone));
  if (comboMatch && !basicoMatch) return "combo";
  if (basicoMatch && !comboMatch) return "basico";
  return null;
}

function lockExpectedPriceForConvo(
  convo: ConversationRow,
  priceSoles: number | null | undefined,
  source: string,
  discountActive: boolean
): void {
  if (typeof priceSoles !== "number" || !Number.isFinite(priceSoles) || priceSoles <= 0)
    return;
  const effectiveSource = `${source}:${discountActive ? "discount" : "regular"}`;
  const existingLockedPrice = getLockedPriceSoles(convo);
  if (existingLockedPrice !== null && convo.locked_price_source === effectiveSource) {
    if (convo.frozen_prices && priceSoles < existingLockedPrice) {
      setLockedPrice(
        convo.id,
        priceSoles,
        getCountryInfo(getEffectiveCountryCode(convo.phone)).currency,
        effectiveSource,
        discountActive
      );
    }
    return;
  }
  setLockedPrice(
    convo.id,
    priceSoles,
    getCountryInfo(getEffectiveCountryCode(convo.phone)).currency,
    effectiveSource,
    discountActive
  );
}

async function sendPostPaymentOrderBumpChoice(convo: ConversationRow): Promise<void> {
  const config = loadWorkflowConfig();
  const routes = config?.commercial_routes;
  const discountActive = isDiscountActiveForConversation(convo, config);
  const steps = Array.isArray(routes?.route_b_post_payment_intro)
    ? routes.route_b_post_payment_intro.filter((step) => step.enabled !== false)
    : [];
  for (const step of steps) {
    await sendPaymentResponseStep(convo, step, discountActive);
    const delay = (step as { delay_after_sec?: number }).delay_after_sec ?? 0;
    if (delay > 0) await new Promise((res) => setTimeout(res, delay * 1000));
  }
  const ob = config ? getActiveTwoTierOffer(config) : null;
  const prompt = renderOrderBumpTemplate(
    routes?.route_b_post_payment_choice_prompt ?? "",
    discountActive,
    convo.phone
  );
  if (routes?.route_b_post_payment_use_buttons !== false) {
    const cuerpo = cuerpoDeBotones(
      prompt,
      "ruta B: pregunta de elección después del pago"
    );
    const titulos = titulosDeBotones(
      [ob?.combo?.name, ob?.basico?.name],
      "ruta B: nombres de las 2 opciones"
    );
    if (cuerpo && titulos) {
      await sendBotButtons(convo, cuerpo, [
        { id: "post_ob_combo", title: titulos[0] },
        { id: "post_ob_basico", title: titulos[1] },
      ]);
      return;
    }
  }
  if (prompt.trim()) await sendBotText(convo, prompt);
}

async function sendPaymentResponseStep(
  convo: ConversationRow,
  step: ResponseStep,
  discountActive: boolean
): Promise<void> {
  const render = (text: string | undefined): string | undefined => {
    if (!text) return text;
    return renderOrderBumpTemplate(text, discountActive, convo.phone);
  };
  if (step.type === "text") {
    const text = render(pickVariant(step.body_variants, step.body)) ?? "";
    if (text.trim()) await sendBotText(convo, text);
    return;
  }
  const caption =
    step.type !== "audio"
      ? render(pickVariant(step.caption_variants, step.caption))
      : undefined;
  await sendBotMediaFromDrive(convo, step.type, step.drive_url, caption);
}

function shouldUseRouteBPostPaymentOrderBump(convo: ConversationRow): boolean {
  const config = loadWorkflowConfig();
  return (
    convo.commercial_sales_route === "B" &&
    config?.commercial_routes?.enabled === true &&
    isTwoTierActive() &&
    !convo.order_bump_choice
  );
}

function formatConvoAmount(
  convo: ConversationRow,
  amount: number,
  config = loadWorkflowConfig()
): string {
  const countryCode = getEffectiveCountryCode(convo.phone, config);
  return formatCurrencyAmount(
    amount,
    countryCode,
    convo.locked_price_currency ?? getCountryInfo(countryCode).currency
  );
}

/** Tipo de método de pago que el LLM puede reportar. */
export type PaymentMethod = "yape" | "plin" | "bcp" | "transferencia";

/**
 * Argumentos que el LLM le pasa a la herramienta cuando ve un comprobante.
 * Los completa leyendo la imagen.
 */
export interface RegisterPaymentArgs {
  amount_soles: number;
  payment_method: PaymentMethod;
  /** Nombre del receptor visible en el comprobante. Puede estar parcial
   *  (Yape oculta apellido). Solo aplica a yape/plin. */
  recipient_name?: string;
  /** Fecha que muestra el comprobante (cualquier formato, con o sin la
   *  palabra "Fecha"), o vacío si no se ve ninguna. Sirve para distinguir un
   *  comprobante real (tiene fecha) de un afiche/imagen reenviada (no tiene).
   *  No se compara: solo importa que exista. */
  receipt_date?: string;
  /** Número/código de operación del comprobante (Yape: "Nro. de operación";
   *  BCP/transferencia: "Número de operación", "Código de operación", "N° de
   *  operación", "Constancia N°"). Vacío si no se ve. Huella única para no
   *  contar dos veces el mismo pago. */
  operation_number?: string;
}

/** Resultado que la herramienta devuelve al LLM. */
export interface RegisterPaymentResult {
  status: "APPROVED" | "PARTIAL" | "REJECTED" | "CHOICE_REQUIRED";
  paid_total_soles: number;
  course_price_soles: number;
  missing_soles: number;
  reason?: string;
  /** Respuesta directa para estados mecanicos que no deben reinterpretarse. */
  customer_message?: string;
  /** Cuántas veces consecutivas se rechazó un comprobante en esta convo.
   *  El LLM usa este número para escalar al asesor humano cuando llega a 3+. */
  failed_attempts_count?: number;
  /**
   * ES EL MISMO COMPROBANTE DE UNA VENTA YA APROBADA.
   *
   * Se aprueba —el pago existe— pero no hay NADA que enviar: el material ya
   * salió y no se vuelve a entregar. Sin este dato ese caso se confundía con una
   * aprobación normal, donde el bot calla a propósito porque el motor manda la
   * entrega detrás. Aquí no manda nada nadie, y el cliente se queda sin
   * respuesta. Ver `paymentToolResultToDirectReply`.
   */
  ya_estaba_registrado?: boolean;
}

/**
 * Definición OpenAI tool calling para que el LLM extraiga datos de un
 * comprobante. Importable y usable en openrouter.ts.
 */
export const REGISTER_PAYMENT_TOOL = {
  type: "function" as const,
  function: {
    name: "register_payment_amount",
    description:
      "When the customer sends an image of a payment receipt (wallet, bank app or transfer), USE this tool to register it. Extract the exact amount and the method. For wallet payments, also extract the recipient's name, which often comes masked by the app (surname shortened or hidden behind asterisks) — copy it exactly as printed, never completed or guessed. ALSO extract receipt_date: ANY date visible on the receipt, in ANY format and EVEN WITHOUT the word 'Fecha' (e.g. '03/06/21', '14/06/2026 10:32', '14 jun 2026'). Leave it empty ONLY if there is truly no date anywhere (e.g. a promotional flyer). The system validates and adds to previous amounts if they were partial.",
    parameters: {
      type: "object",
      properties: {
        amount_soles: {
          type: "number",
          description:
            "Amount in soles from the receipt (e.g. 10, 5.5, 10.00). Just the number.",
        },
        payment_method: {
          type: "string",
          enum: ["yape", "plin", "bcp", "transferencia"],
          description: "Payment method according to the receipt.",
        },
        recipient_name: {
          type: "string",
          description:
            "Name of the payment recipient exactly as it appears on the receipt. It may come masked by the app (surname shortened or hidden behind asterisks): copy what is printed, never complete or guess the hidden part, and never take a name from these instructions. Only applies to wallet payments (yape/plin); for bank transfers, omit.",
        },
        receipt_date: {
          type: "string",
          description:
            "Date AND TIME visible on the receipt, exactly as they appear, in ANY format and EVEN WITHOUT the word 'Fecha' (e.g. '03/06/21', '14/06/2026 10:32', '14 jun 2026 10:21 a. m.'). INCLUDE the time if it is shown. Leave empty only if the image truly shows no date at all. The value is used (together with the amount) as a fingerprint so the SAME receipt is not counted twice.",
        },
        operation_number: {
          type: "string",
          description:
            "Operation/transaction number on the receipt if visible. Yape/Plin show 'Nro. de operación'. BCP/transfer show 'Número de operación', 'Código de operación', 'N° de operación', 'Constancia N°' or similar. Digits are fine. Leave empty if none is visible. Used as a unique fingerprint to avoid counting the same payment twice.",
        },
      },
      required: ["amount_soles", "payment_method"],
    },
  },
} as const;

/**
 * Herramienta para que el LLM REGISTRE la elección del order bump entendiendo
 * el lenguaje natural ("el segundo", "el de oferta", "el barato", "el que me
 * dijiste primero"…). Reemplaza el adivinar por regex en lo escrito.
 */
export const SELECT_OPTION_TOOL = {
  type: "function" as const,
  function: {
    name: "seleccionar_opcion",
    description:
      "Use only when the customer clearly chooses ONE of the two configured order-bump options, interpreted from the full conversation. Do NOT use it for questions, comparisons, recommendations, uncertainty, a payment question, or a payment-method name.",
    parameters: {
      type: "object",
      properties: {
        option: {
          type: "string",
          enum: ["combo", "basico"],
          description:
            "'combo' = the bundle / both products together / the more complete / the more expensive option (shown first). 'basico' = the single main product / the cheaper option (shown second).",
        },
      },
      required: ["option"],
    },
  },
} as const;

export interface SelectOptionResult {
  ok: boolean;
  option?: "combo" | "basico";
  option_name?: string;
  price_soles?: number;
  instruction: string;
}

function hasDirectPaymentContent(): boolean {
  const config = loadWorkflowConfig();
  if (config?.direct_payment_enabled !== true) return false;
  const hasStep =
    Array.isArray(config.direct_payment_steps) &&
    config.direct_payment_steps.some((step) => step.enabled !== false);
  return hasStep || !!config.direct_payment_cta?.trim();
}

/** Ejecuta la elección del order bump pedida por el LLM. Fija la opción de forma
 *  DETERMINÍSTICA (precio/entrega correctos) sin enviar mensajes — el LLM redacta
 *  la confirmación según `instruction`. Si ya abonó algo, resuelve contra lo
 *  pagado (entrega si alcanza, o pide completar). */
export async function executeSelectOrderBumpOption(
  conversationId: number,
  option: "combo" | "basico"
): Promise<SelectOptionResult> {
  const convo = getConversationById(conversationId);
  if (!convo) return { ok: false, instruction: "Conversación no encontrada." };
  if (!isTwoTierActive()) {
    return {
      ok: false,
      instruction:
        "El order bump no está activo. No registres ninguna opción; responde normal.",
    };
  }
  const discountActive = isDiscountActiveForConversation(convo);
  const price = getOrderBumpPriceSoles(option, discountActive, convo.phone) ?? 0;
  const name = getOrderBumpOption(option)?.name?.trim() || option;
  // ESTE VETO SE ACOTA: AHORA SOLO CON UN SIGNO DE PREGUNTA DE VERDAD.
  //
  // PARA QUÉ ESTÁ. Para que el modelo no registre una elección cuando el cliente
  // solo estaba preguntando o comparando. Eso sigue haciendo falta y por eso NO
  // se quita: se acota.
  //
  // LO QUE COSTABA. `isOrderBumpConversationQuestion` decide por palabras, y al
  // comparar quita las tildes — así que «que» (el de relleno) se vuelve idéntico
  // a «qué» (el de pregunta). Con eso, esto vetaba decisiones clarísimas:
  //
  //   «mejor las tintas por que no tengo mucha plata»
  //
  // El modelo leyó la conversación entera, entendió perfectamente que cambiaba
  // al básico, llamó a esta herramienta — y el motor le contestó que el cliente
  // «está preguntando». Por una tilde que nadie escribe en WhatsApp. La elección
  // se quedó en la opción cara y el cliente recibió el precio que no era.
  //
  // Y no es una frase suelta: cualquier «por que», «ya que», «así que» o «creo
  // que» hacía lo mismo. Perseguirlas una a una no termina nunca.
  //
  // LA REGLA NUEVA, Y SOLO SE AFLOJA DONDE ES SEGURO. Quien decide si eso era
  // una pregunta o una decisión es el MODELO, que tiene la conversación delante
  // — no una lista de palabras. Pero eso vale solo en UNA situación:
  //
  //   · SIN ELEGIR TODAVÍA → el veto se queda COMPLETO, como hoy. Ahí está el
  //     candado del Order Bump: una pregunta no puede fijar la primera elección
  //     ni destapar antes de tiempo el producto que aún no se ha revelado.
  //   · CON DINERO YA PAGADO → COMPLETO también. Más abajo esto resuelve contra
  //     lo abonado y puede entregar o pedir una diferencia; con dinero de por
  //     medio no se afloja nada por una frase ambigua.
  //   · YA ELIGIÓ Y AÚN NO PAGA → aquí sí decide el modelo, y solo se veta la
  //     señal que NO admite duda: un signo de interrogación escrito por el
  //     cliente. Es el caso de cambiar de opción, que es el que estaba roto.
  //
  // LO QUE SIGUE PROTEGIENDO:
  //  · La propia herramienta se lo prohíbe en su descripción: «no la uses para
  //    preguntas, comparaciones, recomendaciones, dudas, una pregunta de pago o
  //    el nombre de un método».
  //  · El motor sigue ejecutando TODO de forma determinística — precio, entrega,
  //    comprobante. Lo único que cambia es quién dice QUÉ eligió el cliente.
  //  · Y si se equivoca, el cliente lo dice y el bot ya sabe cambiar de opción.
  //
  // NO CUESTA UNA LLAMADA MÁS: cuando esta herramienta acierta devuelve la
  // instrucción con <<REENVIAR_PAGO>>, y el bucle de openrouter corta ahí mismo
  // sin volver a llamar al modelo. Un turno, igual que hoy.
  const latestText = getRecentUserMessages(conversationId, 1)[0]?.content ?? "";
  const yaEligioYNoHaPagado =
    (convo.order_bump_choice === "combo" ||
      convo.order_bump_choice === "basico") &&
    convo.paid_total_cents === 0;
  const pareceUnaPregunta = yaEligioYNoHaPagado
    ? /[?¿]/.test(latestText)
    : isOrderBumpConversationQuestion(latestText);
  if (pareceUnaPregunta) {
    return {
      ok: false,
      instruction:
        "El cliente esta preguntando o comparando las opciones, no decidiendo. Responde su duda y no registres ninguna opcion todavia.",
    };
  }

  // Ya abonó: resolvemos contra lo pagado reutilizando la lógica existente.
  if (convo.paid_total_cents > 0) {
    const resolution = resolveAccumulatedOrderBumpChoice(conversationId, option);
    if (resolution?.approved) {
      return {
        ok: true,
        option,
        option_name: name,
        price_soles: price,
        instruction: `Registrado "${name}". El pago acumulado ya cubre esta opción y el SISTEMA está entregando el material automáticamente. Confirma con calidez, sin inventar enlaces.`,
      };
    }
    if (resolution) {
      const resolutionPriceLabel = formatConvoAmount(convo, resolution.priceSoles);
      const paidLabel = formatConvoAmount(convo, resolution.paidTotalSoles);
      const missingLabel = formatConvoAmount(convo, resolution.missingSoles);
      return {
        ok: true,
        option,
        option_name: name,
        price_soles: resolution.priceSoles,
        instruction: `Registrado "${name}" por ${resolutionPriceLabel}. Ya abonó ${paidLabel}; faltan ${missingLabel}. Pídele completar ese monto y enviar el comprobante.`,
      };
    }
  }

  setOrderBumpChoice(conversationId, option);
  lockExpectedPriceForConvo(convo, price, `two_tier:${option}`, discountActive);
  const priceLabel = formatConvoAmount(convo, price);
  setConversationState(conversationId, "payment_done");
  if (hasDirectPaymentContent()) {
    setSelectedPaymentMethod(conversationId, "yape");
    return {
      ok: true,
      option,
      option_name: name,
      price_soles: price,
      instruction: `Registrado "${name}" por ${priceLabel}. Responde con UNA sola linea calida y breve confirmando la eleccion y termina con el marcador <<REENVIAR_PAGO>> en una linea aparte. El SISTEMA enviara los datos directos editables con el monto correcto. NO pidas metodo de pago y NUNCA escribas numeros de cuenta tu.`,
    };
  }
  if (convo.selected_payment_method) {
    // Mismo criterio que en el prompt: el nombre lo pone la configuracion.
    const methodLabel = getPaymentMethodLabel(
      convo.selected_payment_method,
      convo.phone
    );
    return {
      ok: true,
      option,
      option_name: name,
      price_soles: price,
      instruction: `Registrado "${name}" por ${priceLabel}. El cliente ya había elegido ${methodLabel}; AHORA hay que ENVIARLE los datos de ${methodLabel} con el NUEVO monto (${priceLabel}). Responde con UNA sola línea cálida y breve (ej. "¡Perfecto! Aquí van los datos para tu ${name} 😊") y termina con el marcador <<REENVIAR_PAGO>> en una línea aparte — el SISTEMA enviará los datos exactos de ${methodLabel} con el monto correcto. NUNCA escribas números de cuenta tú, NUNCA digas "en un momento te comparto", "te paso en un rato" ni "más arriba".`,
    };
  }
  return {
    ok: true,
    option,
    option_name: name,
    price_soles: price,
    instruction: `Registrado "${name}" por ${priceLabel}. Confirma con calidez la elección y pide el MÉTODO DE PAGO (Yape, Plin o BCP). NO escribas números de cuenta — el sistema los envía cuando el cliente elija el método.`,
  };
}

/**
 * Incrementa el contador de intentos fallidos de pago para esta convo.
 * Si alcanza 3, dispara una notificación al admin (formato ⚠️).
 * Devuelve el nuevo conteo para que el caller lo pase al LLM si quiere.
 */
export function trackFailedPaymentAttempt(
  convo: ConversationRow,
  reason: string
): number {
  const newCount = incrementPaymentAttemptsFailed(convo.id);
  console.log(
    `[wf:pago] convo ${convo.id} comprobante REJECTED (intentos fallidos: ${newCount}). Razón: ${reason}`
  );
  if (newCount >= 3 && convo.channel !== "test") {
    const customerName = convo.client_name ?? convo.name ?? "Sin nombre";
    void notifyAdmin(
      `⚠️ *Un usuario quiere comunicarse contigo*: ⚠️\n\n` +
        `Numero: ${convo.phone}\n` +
        `Nombre: ${customerName}\n` +
        `Asunto: El usuario tiene problemas para realizar su pago, ha fallado ${newCount} intentos consecutivos. Última razón: ${reason}.`
    );
  }
  return newCount;
}

/**
 * Ejecuta la herramienta cuando el LLM la llama. Valida, suma al total
 * acumulado, decide aprobación, y si aprueba dispara la secuencia de
 * pago aprobado.
 */
export async function executeRegisterPayment(
  conversationId: number,
  args: RegisterPaymentArgs
): Promise<RegisterPaymentResult> {
  // UPSELLS EN FILA: el comprobante se valida contra la oferta en curso de ESTA
  // conversación, también si entró por Messenger o Instagram. Ver `conLaFilaDe`.
  return conLaFilaDe(conversationId, () =>
    executeRegisterPaymentConSuFila(conversationId, args)
  );
}

async function executeRegisterPaymentConSuFila(
  conversationId: number,
  args: RegisterPaymentArgs
): Promise<RegisterPaymentResult> {
  const config = loadWorkflowConfig();

  const convo = getConversationById(conversationId);
  if (!convo) {
    return {
      status: "REJECTED",
      paid_total_soles: 0,
      course_price_soles: config?.course_price_soles ?? 10,
      missing_soles: config?.course_price_soles ?? 10,
      reason: "Conversación no encontrada",
    };
  }

  // Antes de fijar el precio, reconciliamos la opción persistida con la
  // intención explícita más reciente del cliente. Esto cubre ráfagas donde
  // escribió "quiero el pack completo" y enseguida mandó el comprobante: el
  // debounce puede omitir la reacción al primer mensaje, pero no su historial.
  const originalObChoice = convo.order_bump_choice;
  let obChoice = convo.order_bump_choice;
  const discountActive = isDiscountActiveForConversation(convo, config);
  /**
   * SOLO LO QUE AÚN NO SE HA ATENDIDO.
   *
   * Este repaso existe para las ráfagas: el cliente escribe su elección y manda
   * la foto pegada, el debounce se come la reacción al primer mensaje, y sin
   * esto se cobraría la opción anterior. Eso sigue igual.
   *
   * Lo que cambia es que ya no relee mensajes ANTERIORES a la elección que hay
   * anotada. Releerlos la daba la vuelta, y con una frase relativa el resultado
   * era el contrario del que pidió el cliente:
   *
   *   «mejor el otro» dicho con el full elegido  → básico. Correcto, se anota.
   *   el mismo mensaje releído ya con básico     → «el otro» = full. Al revés.
   *
   * Pasó de verdad: eligió el básico, pagó el básico, y el bot le reclamó el
   * saldo del full. Y en el mismo pago volvió a darse la vuelta.
   *
   * Sin marca —conversaciones de antes de esta columna— se repasa todo, igual
   * que siempre: nadie pierde la red por haber empezado antes.
   */
  const desdeLaEleccion = (marca: number | null | undefined) =>
    typeof marca === "number" && marca > 0
      ? (mensaje: { created_at: number }) => mensaje.created_at > marca
      : () => true;
  /**
   * CON LA PRIMERA VENTA COBRADA Y EL EXTRA EN JUEGO, ESTA RELECTURA SE APAGA.
   *
   * LO QUE PASÓ — 16 de septiembre de 2026, convo 122 del dueño, en -DOU-.
   * Compró el básico, se le entregó, se le ofreció el producto extra, lo aceptó,
   * y pagó exactamente el precio del extra. Hablando de ESE producto escribió
   *
   *     «es completo»
   *
   * y su registro cuenta el resto en tres líneas:
   *
   *     [wf:pago] sincronizo order bump "basico" → "combo" según intención reciente
   *     [wf:pago] pidió subir al combo con el extra ofrecido → este comprobante
   *               es del UPGRADE, no del extra
   *     [wf:pago] convo 122 APROBADO (total: S/. 18 Soles)
   *
   * Le entregaron la opción cara y su segunda venta no llegó a existir.
   *
   * LO QUE LO PRUEBA, y es la medida que más dice: `detectaIntencionDeSubirAlCombo`
   * —la función cuyo único trabajo es reconocer un upgrade— devuelve FALSO en los
   * siete mensajes posteriores a la compra, «es completo» incluido. Nadie pidió
   * subir. El upgrade salió entero de esta relectura, que contesta otra pregunta:
   * «¿cuál de las dos está eligiendo?».
   *
   * POR QUÉ AQUÍ Y NO EN EL DETECTOR. «completo» es palabra legítima de la opción
   * mayor y tiene que seguir eligiéndola mientras el cliente ELIGE. Lo que no
   * puede es seguir eligiendo cuando ya no hay nada que elegir: la primera venta
   * está cobrada y entregada, y lo que está en pantalla es el extra. Ahí «completo»,
   * «el otro» o «todo» son palabras del extra, no de una oferta ya cerrada.
   *
   * ES LA GARANTÍA QUE EL UPGRADE YA DABA POR ESCRITA. Su propio comentario, más
   * abajo: «quien compró el básico y NUNCA pidió subir tiene su elección en
   * "basico" → su pago del extra sigue yendo al extra». Esta relectura se la
   * llevaba por delante antes de que a nadie le diera tiempo a comprobarla.
   *
   * Y EL UPGRADE DE VERDAD NO SE TOCA, porque no depende de esto:
   *   · si el bot se lo cotizó, manda el precio anotado (`cotizadoElUpgrade`);
   *   · si lo pidió por escrito tras comprar, lo reconoce el detector dedicado.
   *
   * LA RÁFAGA PARA LA QUE EXISTE ESTA RELECTURA TAMPOCO SE TOCA: escribir la
   * elección y pegar la foto pasa ANTES de pagar, y esto solo calla después.
   *
   * Y VALE PARA TODA LA ETAPA DEL EXTRA, NO SOLO PARA LA OFERTA EN PANTALLA.
   *
   * La primera versión de esta guarda miraba solo «ofrecido» y «aceptado», y el
   * dueño preguntó lo que había que preguntar: «¿consideraste la etapa de
   * upsell?». No entera. Los estados son CINCO —ver la columna en `db.ts`— y el
   * que faltaba es el peligroso:
   *
   *   · `esperando`  el primer producto YA está entregado y se cuentan los
   *                  minutos antes de ofrecer el extra. El cliente está hablando
   *                  de lo que acaba de recibir, y ahí caben igual «es completo»
   *                  o «el otro». Un cambio de elección hecho en esos minutos se
   *                  queda puesto y envenena el comprobante que llegue después.
   *   · `pagado` y `rechazado`  la segunda venta se cerró o se descartó, pero la
   *                  conversación sigue y las palabras siguen siendo del extra.
   *
   * Así que la condición es la etapa entera: en cuanto el extra entra en la vida
   * de esta conversación —cualquiera de los cinco estados— y la primera venta
   * está cobrada, aquí no hay nada que resincronizar.
   *
   * DONDE NO HAY EXTRA, NO SE TOCA NADA. Con `upsell_state` en nulo esto se
   * comporta exactamente igual que siempre, y no es una asimetría caprichosa:
   * sin extra, `esPagoDeUpsell` es falso siempre y el fallo que esto evita no
   * puede existir. La guarda vive justo donde vive el peligro.
   */
  const elExtraEntroEnLaConversacion = convo.upsell_state != null;
  const laPrimeraVentaYaSeCobro = convo.paid_at != null;
  if (
    isTwoTierActive() &&
    !(laPrimeraVentaYaSeCobro && elExtraEntroEnLaConversacion)
  ) {
    /**
     * EL MISMO GANADOR QUE SIEMPRE, Y ADEMÁS SI FUE UNA ELECCIÓN DE VERDAD.
     *
     * El recorrido y el criterio no cambian: gana el primero de los mensajes que
     * devuelve una opción, exactamente como el `.find` de antes. Lo único que se
     * añade es un dato sobre ESE mensaje — si nombró la opción de forma explícita
     * (el nombre, su alias, el número o el ordinal) o si solo la dedujo una
     * palabra suelta dentro de una frase. Abajo se usa, y solo para un caso.
     */
    let recentChoice: "combo" | "basico" | null = null;
    let laEleccionFueExplicita = false;
    for (const message of getRecentUserMessages(conversationId, 10).filter(
      desdeLaEleccion(convo.order_bump_choice_at)
    )) {
      const elegida = inferTwoTierChoiceFromContext(
        message.content,
        convo.order_bump_choice,
        config
      );
      if (elegida === "combo" || elegida === "basico") {
        recentChoice = elegida;
        laEleccionFueExplicita =
          detectExactOrderBumpChoice(message.content, config) === elegida;
        break;
      }
    }
    if (recentChoice && recentChoice !== obChoice) {
      /**
       * SI EL CLIENTE NUNCA ELIGIÓ, EL IMPORTE MANDA SOBRE LA RELECTURA.
       *
       * LO QUE PASÓ — 28 de septiembre de 2026, sus pruebas HOLARG1 y HOLAPER1.
       * Las dos venían de vender UN SOLO producto, así que no había ninguna
       * elección anotada. Esta relectura les puso la opción CARA por una
       * preposición del nombre («<algo> 2 EN 1» donaba la palabra «en»), y su
       * propio registro lo cuenta en dos líneas:
       *
       *     sincronizo order bump "ninguno" → "combo" según intención reciente
       *     PARCIAL (total: S/. 10 Soles / S/. 14 Soles)
       *
       * El bot le pidió 10, pagó 10, y le reclamó 4 más. Una de las dos no
       * recibió nunca el material.
       *
       * LA PREPOSICIÓN YA ESTÁ ARREGLADA en `tokensPropiosDeCadaOpcion`. Esto es
       * la otra mitad, y es la que importa: cualquier palabra del nombre puede
       * volver a coincidir por casualidad el día que cambie de producto, y
       * entonces vuelve el mismo cobro de más. Aquí se cierra la familia entera.
       *
       * LA REGLA: un importe que coincide EXACTO con el precio de una sola opción
       * no tiene margen de error — lo dice el bloque de inferencia por monto que
       * está más abajo, y lleva meses funcionando. Una palabra dentro de una frase
       * sí tiene margen. Cuando el cliente no había elegido nada, entre las dos
       * manda la que no puede equivocarse.
       *
       * TRES CANDADOS, PARA NO TOCAR NADA DE LO QUE FUNCIONA:
       *
       *   · SOLO SIN ELECCIÓN PREVIA (`!obChoice`). Quien ya tenía una opción
       *     anotada sigue igual que hoy: si pagó menos, se le pide la diferencia.
       *   · SOLO SI NO FUE EXPLÍCITA. La ráfaga para la que existe esta relectura
       *     —escribir «quiero el <nombre>» y pegar la foto— nombra la opción, así
       *     que gana ella, como hasta hoy. Aquí solo pierde la palabra suelta.
       *   · SOLO SI EL IMPORTE SEÑALA A UNA SOLA opción. Si no calza con ninguna,
       *     o calza con las dos, no hay certeza que oponer y manda la relectura.
       *
       * Y NO SE APRUEBA NADA AQUÍ: esto solo anota la opción correcta. La
       * validación, el saldo y la entrega siguen su camino de siempre.
       */
      const elImporteSenala =
        !obChoice && !laEleccionFueExplicita
          ? inferOrderBumpChoiceFromAmount(
              args.amount_soles,
              convo.phone,
              discountActive
            )
          : null;
      if (elImporteSenala && elImporteSenala !== recentChoice) {
        console.log(
          `[wf:pago] convo ${conversationId}: la relectura decía "${recentChoice}" sin que el cliente hubiera elegido nada, pero el importe (${args.amount_soles}) es exactamente el precio de "${elImporteSenala}" → manda el importe`
        );
        setOrderBumpChoice(conversationId, elImporteSenala);
        obChoice = elImporteSenala;
      } else {
        console.log(
          `[wf:pago] convo ${conversationId}: sincronizo order bump "${obChoice ?? "ninguno"}" → "${recentChoice}" según intención reciente`
        );
        setOrderBumpChoice(conversationId, recentChoice);
        obChoice = recentChoice;
      }
    }
  }

  // Misma reconciliación para Doble Oferta: la elección explícita más reciente
  // manda sobre un valor anterior, incluso si llegó en ráfaga con la imagen.
  let bioChoice = convo.bioferta_choice;
  if (!isTwoTierActive() && isBiofertaActive()) {
    const recentChoice = getRecentUserMessages(conversationId, 10)
      // La misma regla, por lo mismo: el repaso es para lo que aún no se
      // atendió. Ver `desdeLaEleccion`.
      .filter(desdeLaEleccion(convo.bioferta_choice_at))
      .map((message) => detectBiofertaChoice(message.content, config))
      .find(
        (choice) => choice === "a" || choice === "b" || choice === "pack"
      );
    if (recentChoice && recentChoice !== bioChoice) {
      console.log(
        `[wf:pago] convo ${conversationId}: sincronizo doble oferta "${bioChoice ?? "ninguna"}" → "${recentChoice}" según intención reciente`
      );
      setBiofertaChoice(conversationId, recentChoice);
      bioChoice = recentChoice;
    }
  }

  // Precio efectivo para ESTA convo: si entró en etapa de oferta, es el
  // descuento; sino, el precio normal del curso.
  let priceSoles = getEffectivePriceSoles(
    discountActive,
    convo.phone
  );
  let priceSource = "base";
  let selectionChangedForThisReceipt =
    obChoice !== originalObChoice || bioChoice !== convo.bioferta_choice;

  // Order bump: si el cliente eligió una opción (combo/básico), el precio
  // esperado es el de ESA opción.
  if (
    isTwoTierActive() &&
    (obChoice === "combo" || obChoice === "basico")
  ) {
    const optionPrice = getOrderBumpPriceSoles(
      obChoice,
      discountActive,
      convo.phone
    );
    if (optionPrice !== null) {
      priceSoles = optionPrice;
      priceSource = `two_tier:${obChoice}`;
    }
  }
  if (
    !isTwoTierActive() &&
    isBiofertaActive() &&
    (bioChoice === "a" || bioChoice === "b" || bioChoice === "pack")
  ) {
    const biofertaPrice = getBiofertaPriceSoles(
      bioChoice,
      discountActive,
      convo.phone
    );
    if (biofertaPrice !== null) {
      priceSoles = biofertaPrice;
      priceSource = `bioferta:${bioChoice}`;
    }
  }

  // ── UPSELL: este comprobante es de la SEGUNDA venta ──────────────────────
  // El cliente ya compró y aceptó el segundo producto. A partir de aquí manda
  // el precio del upsell, y lo que cuenta es lo que entra POR ENCIMA de la
  // foto que se guardó al ofrecerlo: así el primer pago no se recicla para
  // dar por pagado el segundo.
  // Un comprobante enviado mientras la oferta sigue visible también expresa
  // aceptación: no obligamos al cliente a pulsar un botón antes de pagar.
  // El precio del upsell se valida por separado, así no se recicla el primer
  // pago ni se toca ninguna otra modalidad.
  //
  // PERO SUBIR DE BÁSICO A COMBO NO ES PAGAR EL UPSELL.
  //
  // Pasó de verdad, con estos números: el cliente paga el básico (6.000), se le
  // ofrece el segundo producto, y entonces pide subir al combo (6.999). El motor
  // calcula bien y le dice "faltan 999". Paga los 999 — y aquí se rompía: como
  // la oferta del extra seguía ABIERTA, su comprobante se contaba contra el
  // precio del extra (7.500) en vez de contra el combo. Le respondía que le
  // faltaban 6.500, después de haberle pedido 999.
  //
  // El bot le da un monto y luego no lo reconoce. Es de las peores cosas que
  // puede hacer con dinero de por medio.
  //
  // Si el cliente acaba de pedir el upgrade —lo mismo que ya detecta el motor
  // para poder darle el monto— este pago es del upgrade. La oferta del segundo
  // producto no se cierra: sigue abierta para después.
  // LA SEÑAL BUENA ES QUE EL MOTOR YA LE COTIZÓ EL UPGRADE.
  //
  // El primer intento miraba si la elección seguía en "basico", y eso falla
  // justo en el caso real: al decirle "faltan 1.000" el motor YA cambia la
  // elección a "combo". Cuando llegaba el comprobante, la elección ya no era
  // "basico", la guarda no entraba, y el pago se contaba otra vez contra el
  // segundo producto. Con sus números: registró 1.000 y pidió 6.500 más,
  // después de haberle pedido 1.000.
  //
  // El precio COTIZADO sí queda anotado, y dice de qué era: al cotizar el
  // upgrade se guarda "two_tier:combo". Eso no se confunde con el segundo
  // producto, y como se sobrescribe en cada cotización, siempre gana la
  // intención más reciente del cliente — que es lo correcto.
  //
  // Y en los dos casos hace falta que el combo NO esté cubierto todavía: si ya
  // lo pagó entero, no hay nada que subir y el comprobante es de otra cosa.
  const precioComboUpgrade = isTwoTierActive()
    ? getOrderBumpPriceSoles("combo", discountActive, convo.phone)
    : null;
  const comboSinCubrir =
    precioComboUpgrade !== null &&
    convo.paid_total_cents < Math.round(precioComboUpgrade * 100);
  const cotizadoElUpgrade = (convo.locked_price_source ?? "").startsWith(
    "two_tier:combo"
  );
  /**
   * LA COTIZACIÓN DEL UPGRADE, DICHA POR ALGO QUE NO SE PUEDA PISAR.
   *
   * `cotizadoElUpgrade` mira el precio anotado, y ese apunte lo reescribe
   * CUALQUIER pregunta de precio: el cerebro vuelve a anotar el precio citado
   * en cada una, y con un extra ofrecido anota el del extra.
   *
   * Pasó de verdad, con estos números: compró el básico (6.000), pidió subir al
   * full (7.000) y el bot le dijo «faltan 1.000». Antes de pagar preguntó
   * «¿puedo completar el otro que CUESTA 7000?» — una pregunta de precio— y ese
   * turno pisó el apunte con el del extra. Al llegar su comprobante de 1.000,
   * el validador ya no veía un upgrade: lo contó contra el extra y le contestó
   * «ya registré 0, faltan 7.500». Pagó, el dinero se contabilizó, no recibió
   * nada y encima se le dijo que no había pagado.
   *
   * La elección, en cambio, NO la pisa una pregunta: la escribe el motor al
   * cotizar el upgrade y ahí se queda. Con la entrega ya hecha —`paid_at`— y la
   * elección puesta en el combo sin cubrir, lo que este cliente debe es el
   * upgrade. No hay otra lectura posible.
   *
   * Va como ALTERNATIVA, no en lugar de nada: solo puede reconocer MÁS casos de
   * upgrade, nunca menos. Y no toca a quien no está en ese caso:
   *
   *   · Lineal y Upsell no tienen dos opciones → `comboSinCubrir` es falso y
   *     esto no llega a mirarse siquiera.
   *   · Quien compró el básico y NUNCA pidió subir tiene su elección en
   *     «basico» → su pago del extra sigue yendo al extra, como hasta ahora.
   *   · Quien ya cubrió el combo tampoco entra: no hay nada que subir.
   */
  const yaComproYQuiereElCombo = convo.paid_at != null && obChoice === "combo";
  const pidioSubirAlCombo =
    comboSinCubrir &&
    // O se lo cotizamos —el caso normal—, o su elección ya es el combo con la
    // entrega hecha, o lo pidió y el motor todavía no había cambiado la
    // elección.
    (cotizadoElUpgrade ||
      yaComproYQuiereElCombo ||
      (obChoice === "basico" &&
        // SOLO LO DICHO DESPUÉS DE LA COMPRA. Un upgrade es, por definición,
        // querer subir de lo que YA se compró: nada dicho antes de la entrega
        // puede serlo.
        //
        // LO QUE COSTÓ — 15 de septiembre de 2026, convo 108 del dueño. Eligió
        // el combo, se arrepintió, compró el básico, aceptó el producto extra y
        // pagó su precio. Ese comprobante se contó como UPGRADE al combo: se le
        // entregó la opción cara y su segunda venta no llegó a existir.
        //
        //     «combo»                        <- eligiendo, antes de comprar
        //     «no tengo plata mejor el otro» <- BAJANDO de precio
        //     ...compra el básico, acepta el extra, paga
        //     [wf:pago] pidió subir al combo → este comprobante es del UPGRADE
        //
        // Los dos primeros seguían dentro de la ventana de mensajes recientes, y
        // los dos disparan el detector: «combo» es palabra del nombre de la
        // opción cara, y «el otro» está en su lista fija. Uno era una elección y
        // el otro era justo lo contrario de un upgrade.
        //
        // No se toca el detector —esa lista vale para lo suyo—: se acota a la
        // parte de la conversación donde un upgrade puede existir. Quien pide
        // subir DESPUÉS de comprar sigue reconociéndose igual, que es para lo
        // que está esta rama.
        getRecentUserMessages(conversationId, 6)
          .filter(
            (message) =>
              convo.paid_at != null && message.created_at > convo.paid_at
          )
          .some((message) =>
            detectaIntencionDeSubirAlCombo(message.content, config)
          )));
  const esPagoDeUpsell =
    !pidioSubirAlCombo &&
    (convo.upsell_state === "aceptado" || convo.upsell_state === "ofrecido");
  if (pidioSubirAlCombo && convo.upsell_state) {
    console.log(
      `[wf:pago] convo ${conversationId}: pidió subir al combo con el extra ofrecido → este comprobante es del UPGRADE, no del extra`
    );
  }
  const precioUpsell = esPagoDeUpsell
    ? getUpsellPriceSoles(discountActive, convo.phone)
    : null;
  // EL PRECIO DE LA PRIMERA VENTA, ANTES DE QUE LO TAPE EL DEL EXTRA.
  //
  // Hace falta para repartir un comprobante entre las dos: primero se termina
  // de pagar lo que el cliente ya se llevó, y lo que sobra es del segundo
  // producto. Se guarda aquí porque dos líneas más abajo `priceSoles` deja de
  // ser el de la primera venta.
  const precioPrimeraVenta = priceSoles;
  if (esPagoDeUpsell && precioUpsell !== null) {
    priceSoles = precioUpsell;
    priceSource = "upsell";
  }

  const lockedPriceSoles = getLockedPriceSoles(convo);
  const effectivePriceSource = `${priceSource}:${
    discountActive ? "discount" : "regular"
  }`;
  if (selectionChangedForThisReceipt) {
    lockExpectedPriceForConvo(convo, priceSoles, priceSource, discountActive);
  } else if (
    lockedPriceSoles !== null &&
    convo.locked_price_source === effectivePriceSource
  ) {
    priceSoles = convo.frozen_prices
      ? Math.min(lockedPriceSoles, priceSoles)
      : lockedPriceSoles;
    priceSource = convo.locked_price_source ?? "locked";
  }

  // DECIA QUE NO HABIA PAGADO NADA, Y NO ERA VERDAD.
  //
  // Al rechazar un comprobante esto informaba `paid_total_soles: 0`. El modelo
  // lee ese cero y concluye que los pagos ANTERIORES se perdieron. Pasó de
  // verdad: alguien pagó 6.000, pidió subir al combo, mandó el comprobante del
  // saldo, se rechazó por monto ilegible — y el bot le contestó:
  //
  //   «Parece que hubo un problema con el registro del pago anterior de
  //    $6.000 ARS, no quedó registrado en el sistema. ¿Podrías enviarme ambos
  //    comprobantes…?»
  //
  // Su dinero estaba registrado. Un cliente real abandona ahí, y con razón.
  //
  // Rechazar UN comprobante no borra lo ya cobrado: se informa el total real
  // acumulado y lo que falta de verdad.
  const yaPagado = Math.max(0, (convo.paid_total_cents ?? 0) / 100);
  const baseResult = (
    overrides: Partial<RegisterPaymentResult>
  ): RegisterPaymentResult => ({
    status: "REJECTED",
    paid_total_soles: yaPagado,
    course_price_soles: priceSoles,
    missing_soles: Math.max(0, priceSoles - yaPagado),
    ...overrides,
  });

  if (
    !isTwoTierActive() &&
    isBiofertaActive() &&
    bioChoice === "pack" &&
    getBiofertaPriceSoles("pack", discountActive, convo.phone) === null
  ) {
    return baseResult({
      reason:
        "El pack de la Doble Oferta no tiene un precio válido configurado. No apruebes ni entregues hasta corregirlo.",
    });
  }

  // Si ya estaba aprobado, no procesamos el pago de nuevo.
  // UPGRADE tras aprobación: el cliente ya compró (típicamente el básico) y ahora
  // manda OTRO comprobante para subir al COMBO. Mientras el combo NO esté cubierto
  // por el total ACUMULADO, tratamos cada pago como parte del upgrade: fijamos
  // combo y la acumulación de abajo entrega el combo cuando el total alcanza (o
  // devuelve PARCIAL pidiendo el saldo). Antes solo se reconocía si el pago
  // completaba EXACTO → si no (o en upgrades de varios pagos), caía en "ya
  // aprobado" y el bot quedaba MUDO sin entregar.
  const comboPriceForApprovedUpgrade = isDobleOfertaActive()
    ? getOrderBumpPriceSoles("combo", discountActive, convo.phone)
    : null;
  const isApprovedUpgradeToCombo =
    convo.state === "payment_approved" &&
    !esPagoDeUpsell &&
    isTwoTierActive() &&
    comboPriceForApprovedUpgrade !== null &&
    convo.paid_total_cents < Math.round(comboPriceForApprovedUpgrade * 100);
  if (isApprovedUpgradeToCombo) {
    setOrderBumpChoice(conversationId, "combo");
    obChoice = "combo";
    priceSoles = comboPriceForApprovedUpgrade;
  }
  // La aprobación de la primera venta no bloquea el comprobante NUEVO del
  // upsell. `upsell_state === "aceptado"` es justamente la señal de que este
  // pago corresponde al tercer producto, no a un reenvío del primero.
  if (
    convo.state === "payment_approved" &&
    !isApprovedUpgradeToCombo &&
    !esPagoDeUpsell
  ) {
    return baseResult({
      status: "APPROVED",
      paid_total_soles: convo.paid_total_cents / 100,
      missing_soles: 0,
      reason: "Pago ya estaba aprobado",
    });
  }

  if (
    typeof args.amount_soles !== "number" ||
    !Number.isFinite(args.amount_soles) ||
    args.amount_soles <= 0
  ) {
    const reason = "Monto inválido";
    const failed_attempts_count = trackFailedPaymentAttempt(convo, reason);
    return baseResult({ reason, failed_attempts_count });
  }

  // SEGURIDAD ORDER BUMP: si el order bump está ACTIVO y el cliente todavía NO
  // eligió una de las 2 opciones (combo/básico), NO aprobamos — el precio
  // depende de la opción. Aprobar aquí validaría contra el precio individual y
  // dejaría pasar montos bajos por una bioferta (bug crítico).
  const routeBPostPaymentOrderBump = shouldUseRouteBPostPaymentOrderBump(convo);
  // EXCEPCIÓN: al cliente que NUNCA vio la oferta no se le puede pedir que elija.
  //
  // Pasó de verdad: una clienta hablaba con los dos bots a la vez. En uno se le
  // revelaron las 2 opciones y le dieron los datos de pago; pagó, y mandó el
  // comprobante al OTRO bot, donde su conversación seguía sin haber visto nunca
  // la segunda opción. El bot le pidió elegir "entre las opciones que te envié
  // antes" — opciones que ese bot jamás le envió. Se quedó en bucle, pagada y
  // sin curso.
  //
  // Antes de revelar, el pago manda: se valida como siempre contra el precio
  // base y, si alcanza, se entrega el COMBO (ver más abajo). Es deliberado
  // regalar de más en este caso rarísimo antes que discutir con alguien que ya
  // pagó. Si no alcanza, sigue el "te faltan X" de siempre.
  const ofertaNuncaRevelada = convo.order_bump_revealed !== 1;
  if (
    isTwoTierActive() &&
    !obChoice &&
    !routeBPostPaymentOrderBump &&
    !ofertaNuncaRevelada &&
    // El pago del upsell no tiene nada que ver con elegir combo o básico: eso
    // ya se resolvió en la primera venta.
    !esPagoDeUpsell
  ) {
    // INFERENCIA POR MONTO: si el comprobante coincide EXACTO con el precio de UNA
    // de las 2 opciones (normal u oferta), esa es la elección — el monto no tiene
    // margen de error. Así aprobamos aunque la palabra de elección no estuviera en
    // la lista (typos, "elsuper kit", etc.). Solo si el match es ÚNICO.
    //
    // Y SE LE PASA LA ETAPA, QUE ES LO QUE LO HACE SERVIR CON PRECIOS SOLAPADOS.
    //
    // LO QUE PASÓ — 28 de septiembre de 2026, su prueba HOLAPER1. Sin etapa se
    // comparaban los CUATRO precios a la vez, y medido con su configuración:
    //
    //     sin oferta    la cara 14    la barata 10
    //     con oferta    la cara 10    la barata  8
    //
    // Su pago de 10 calzaba con las DOS —la cara con oferta y la barata sin ella—
    // así que esto se abstenía justo cuando el cliente acababa de pagar exactamente
    // lo que se le había pedido, y en su lugar se le pedía elegir. Él ya había
    // pagado: preguntarle otra vez es lo que acabó en «ya te pague 10, me quieres
    // cobrar de mas» y en una venta sin entregar.
    //
    // CON LA ETAPA no hay empate posible: el cliente paga el número que tiene
    // DELANTE, y en su etapa ese número solo puede ser de una de las dos.
    //
    // SOLO PUEDE AÑADIR CERTEZA. Si el par de su etapa tampoco desempata, se cae
    // al camino de siempre —los cuatro precios— y si ése tampoco, se le pide
    // elegir igual que hoy. Y sigue detrás del `!obChoice` de arriba: a quien ya
    // tenía una opción anotada esto no lo toca.
    const amountChoice = inferOrderBumpChoiceFromAmount(
      args.amount_soles,
      convo.phone,
      discountActive
    );
    if (amountChoice) {
      setOrderBumpChoice(conversationId, amountChoice);
      obChoice = amountChoice;
      selectionChangedForThisReceipt = true;
      console.log(
        `[wf:pago] convo ${conversationId}: elección inferida por MONTO (${args.amount_soles}) → "${amountChoice}"`
      );
    } else {
      // Sin elección y el monto no calza claro con ninguna opción → pedimos elegir,
      // con un mensaje AL CLIENTE (nada de texto interno).
      const reason =
        "Para validar tu pago, primero dime cuál de las 2 opciones quieres (toca un botón o escribe el nombre) 😊 — el precio depende de tu elección. Luego envíame la foto del comprobante.";
      const failed_attempts_count = trackFailedPaymentAttempt(convo, reason);
      return baseResult({ reason, failed_attempts_count });
    }
  }

  // Validación de FECHA del comprobante (configurable, payment_validation.
  // require_receipt_date). Si está activada, el comprobante debe mostrar una
  // fecha (cualquiera; NO se compara). Filtra afiches/imágenes reenviadas que
  // tienen monto pero no son comprobantes reales.
  const countryCode = getEffectiveCountryCode(convo.phone, config);
  const requireReceiptDate =
    resolveCountryPaymentProfile(countryCode, config)?.payment_validation
      ?.require_receipt_date ??
    config?.payment_validation?.require_receipt_date ??
    false;
  if (requireReceiptDate && !(args.receipt_date ?? "").trim()) {
    // EL MOTIVO TÉCNICO VA AL REGISTRO; AL CLIENTE NO SE LE DAN PISTAS.
    //
    // LO QUE PASÓ — 30/09/2026, en su prueba. El bot le contestaba al cliente
    // «necesito ver la FECHA en el comprobante; las imágenes sin fecha (como un
    // afiche) no se aceptan». Con sus palabras: «no puedes darle tips de cómo
    // darme un comprobante, eso hace que puedan falsificar».
    //
    // Y ESTE TEXTO LLEGA AL CLIENTE POR DOS CAMINOS —el respaldo determinista y
    // la IA, a la que el prompt le pide «explícale el motivo»—, así que la única
    // forma de cerrar los dos es que el motivo YA no tenga la pista. Por eso se
    // cambia aquí y no en el prompt: un cambio de prompt no es quirúrgico.
    console.warn(
      `[wf:pago] convo ${conversationId}: comprobante SIN FECHA y el país la exige → rechazado`
    );
    const reason =
      "No pude validar ese comprobante. Por favor envíeme una foto más clara, donde se vea el comprobante completo.";
    const failed_attempts_count = trackFailedPaymentAttempt(convo, reason);
    return baseResult({ reason, failed_attempts_count });
  }

  // Validación de receptor para Yape/Plin
  if (args.payment_method === "yape" || args.payment_method === "plin") {
    // EL NOMBRE TAL COMO ÉL LO ESCRIBIÓ, para poder enseñárselo al cliente
    // ENTERO. Ver el rechazo de más abajo: se valida por la primera palabra,
    // pero se le pide el nombre completo a propósito.
    //
    // SALE DE LA MISMA PUERTA QUE EL NOMBRE QUE SE LE ENSEÑÓ AL CLIENTE.
    //
    // `elCobroDelPais` devuelve el titular, el nombre que se nombra en el mensaje
    // y el número de cuenta a la vez, y por eso no pueden desalinearse. Antes esto
    // leía el perfil del país por su cuenta; con el almacén de usuarios —donde una
    // tienda puede cobrar a otra persona— leerlo por separado significaría mandar
    // a pagar a un titular y validar contra otro: el cliente paga bien y el bot le
    // rechaza el comprobante.
    const expectedComoLoEscribio = elCobroDelPais(countryCode, config).titular;
    const expectedPrefix = expectedComoLoEscribio.toLowerCase();
    const got = (args.recipient_name ?? "").trim().toLowerCase();
    if (expectedPrefix && !got) {
      // SIN PISTAS: decir «necesito ver el nombre del receptor» le enseña al
      // cliente qué mirar para falsificarlo. El detalle va al registro.
      console.warn(
        `[wf:pago] convo ${conversationId}: comprobante de ${args.payment_method} SIN nombre de receptor visible → rechazado`
      );
      const reason =
        "No pude validar ese comprobante. Por favor envíeme una foto más clara, donde se vea el comprobante completo.";
      const failed_attempts_count = trackFailedPaymentAttempt(convo, reason);
      return baseResult({ reason, failed_attempts_count });
    }
    // Coincidencia por el PRIMER NOMBRE del titular. Los comprobantes suelen
    // truncar el apellido por seguridad ("Nombre Ape.", "Nombre A***"), así que
    // comparamos con prefijo en cualquier dirección y un mínimo de 3 caracteres
    // (evita falsos positivos por iniciales sueltas).
    //
    // SOLO LA PRIMERA PALABRA DE LO CONFIGURADO. Lo pidió el dueño el 29 de
    // septiembre de 2026, con estas palabras: «si pongo 1 nombre y un apellido,
    // o 2 nombres o más cosas, que reconozca para aprobación solo el primer
    // nombre, punto».
    //
    // ANTES valía CUALQUIER parte —nombre o apellido—, y eso aprobaba pagos a
    // otra persona: con "Alberto Salinas" configurado, un comprobante a nombre
    // de "Jose Salinas" pasaba, porque bastaba el apellido. Medido sobre 17
    // casos reales: cambian 5, y los 5 son pagos a alguien distinto.
    //
    // SOLO ALCANZA A YAPE/PLIN — es la rama en la que vive. BCP y transferencia
    // no miran el nombre y siguen igual.
    //
    // EL FILTRO VA ANTES DEL RECORTE, y no es un detalle de estilo: si se
    // recortara primero, un nombre que empiece por una palabra corta ("De
    // Alberto") se quedaría con "de", el filtro la tiraría, la lista quedaría
    // VACÍA — y unas líneas más abajo una lista vacía aprueba a CUALQUIERA.
    const normalizeName = (s: string): string =>
      s
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{Mn}/gu, "")
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    const expectedTokens = normalizeName(expectedPrefix)
      .split(" ")
      .filter((t) => t.length >= 3)
      .slice(0, 1);
    const gotTokens = normalizeName(got)
      .split(" ")
      .filter((t) => t.length >= 2);
    const nameMatches =
      expectedTokens.length === 0 ||
      expectedTokens.some((et) =>
        gotTokens.some((gt) => {
          const [shorter, longer] =
            et.length <= gt.length ? [et, gt] : [gt, et];
          return shorter.length >= 3 && longer.startsWith(shorter);
        })
      );
    if (expectedPrefix && !nameMatches) {
      // SE PIDE EL NOMBRE COMPLETO AUNQUE SE VALIDE LA PRIMERA PALABRA.
      //
      // LO PIDIÓ EL DUEÑO el 30/09/2026, y el motivo es suyo: «para que el
      // cliente no se pase de listo y mande un solo nombre, sino que vea que el
      // comprobante debe corresponder realmente al receptor».
      //
      // Así que aquí sale ENTERO lo que él escribió en Precios y pagos, mientras
      // la comprobación de arriba sigue mirando solo la primera palabra. La
      // diferencia es a propósito y no es un descuido: exigir de boca más de lo
      // que se valida es lo que desanima al que lo intenta.
      //
      // Y SE QUITA «(al menos el nombre o el apellido)»: esa coletilla le decía
      // justo lo contrario —que con una parte bastaba—, que es la pista que él
      // no quiere dar.
      console.warn(
        `[wf:pago] convo ${conversationId}: el comprobante es a nombre de "${args.recipient_name}" y se esperaba "${expectedComoLoEscribio}" → rechazado`
      );
      const reason =
        `El comprobante está a nombre de "${args.recipient_name}", ` +
        `y para poder validarlo debe estar a nombre de "${expectedComoLoEscribio}". ` +
        `Por favor envíeme el comprobante correcto.`;
      const failed_attempts_count = trackFailedPaymentAttempt(convo, reason);
      return baseResult({ reason, failed_attempts_count });
    }
  }
  // Para BCP/transferencia: solo el monto se valida (los tickets no traen
  // nombre fiable). El bot debe verificar esto en el prompt.

  // IDEMPOTENCIA — no contar dos veces el MISMO comprobante. Armamos una
  // "huella" EN CAPAS, y la palabra importa: se usa la mejor que haya, no todas a
  // la vez. Primero el número de operación, que es el que identifica de verdad; si
  // no lo hay, fecha+monto; y en cualquier caso el id del mensaje-imagen como red.
  // Si la huella YA fue contada, NO volvemos a sumar: devolvemos el estado real
  // (p. ej. PARCIAL) sin entregar de más. Una operación NUEVA sí se cuenta (permite
  // completar un pago parcial). Se limpia con /restart. La capa del id de imagen es
  // la red de seguridad: aunque el voucher sea ilegible, evita que el LLM re-cuente
  // la MISMA imagen.
  //
  // LO DE «EN CAPAS» ESTABA ESCRITO AQUÍ DESDE EL PRINCIPIO Y EL CÓDIGO NO LO HACÍA:
  // añadía la de fecha incluso teniendo número de operación. Ver el porqué completo
  // en el comentario de abajo, con las palabras del dueño.
  const cents = Math.round(args.amount_soles * 100);
  const normalizeFp = (s: string): string =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Mn}/gu, "")
      .replace(/[^a-z0-9]+/g, "");
  const latestImage = getRecentUserMessages(conversationId, 5).find(
    (m) => m.media_type === "image" || esComprobantePdf(m)
  );
  const fingerprints: string[] = [];
  const opFp = normalizeFp(args.operation_number ?? "");
  if (opFp.length >= 4) fingerprints.push(`op:${opFp}`);
  const dateFp = normalizeFp(args.receipt_date ?? "");
  /**
   * LA FECHA SOLO DECIDE CUANDO NO HAY NÚMERO DE OPERACIÓN.
   *
   * ── EL FALLO, Y LO ENCONTRÓ ÉL ────────────────────────────────────────
   *
   * Antes esta huella se añadía SIEMPRE, y como basta que UNA coincida para marcar
   * duplicado, `dt:fecha|amt:monto` condenaba comprobantes con número de operación
   * DISTINTO. Él lo vio testeando Ecuador el 05/10/2026: había variado el «N de
   * comprobante» en todos sus comprobantes y el bot los rechazaba igual.
   *
   * ── Y NO ERA UN PROBLEMA DE PRUEBAS, que fue mi primera lectura y era falsa ──
   *
   * Él la corrigió con el caso real: «el cliente me va a mandar el comprobante el
   * mismo día, POR ESO LA FECHA NO TIENE QUE SER UN FACTOR que impida la compra».
   * Tenía razón: dos pagos del MISMO importe el MISMO día son dos pagos —un pago
   * partido en dos, o el extra que cuesta igual que el básico— y el segundo no se
   * sumaba. Eso es dinero cobrado que el bot no contaba.
   *
   * ── POR QUÉ `else` Y NO QUITARLA ──────────────────────────────────────
   *
   * El número de operación identifica un comprobante; la fecha y el monto solo lo
   * describen. Cuando hay número, él manda: si ese número ya se contó, lo caza la
   * huella `op:`. La fecha se queda para los comprobantes que NO traen número, que
   * es para lo que se puso.
   *
   * LO QUE ESTO CUESTA, Y QUEDA DICHO: si el lector leyera el MISMO número de dos
   * formas distintas en dos envíos de la misma foto, ese comprobante podría contarse
   * dos veces. Es más raro que el caso de arriba —son cifras limpias— y la red de
   * `img:` sigue tapando el reenvío de la misma imagen. Entre bloquear un pago de
   * verdad y contar dos veces una lectura torcida, él eligió lo primero.
   */
  if (opFp.length < 4 && dateFp.length >= 4) {
    fingerprints.push(`dt:${dateFp}|amt:${cents}`);
  }
  if (latestImage) fingerprints.push(`img:${latestImage.id}`);
  // LAS HUELLAS, EN EL REGISTRO. Esto se diagnosticó leyendo el código porque el log
  // solo decía «DUPLICADO» sin enseñar por qué. Una línea aquí convierte la próxima
  // vez en un segundo de lectura.
  console.log(
    `[wf:pago] convo ${conversationId}: huellas [${fingerprints.join(" ")}]`
  );
  const countedSet = new Set(
    (convo.counted_receipts ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
  const isDuplicateReceipt = fingerprints.some((f) => countedSet.has(f));

  let newTotalCents: number;
  if (isDuplicateReceipt) {
    console.log(
      `[wf:pago] convo ${conversationId}: comprobante DUPLICADO (huella ya contada) — no se vuelve a sumar`
    );
    newTotalCents = convo.paid_total_cents;
  } else {
    newTotalCents = addToPaidTotal(conversationId, cents);
    for (const f of fingerprints) countedSet.add(f);
    setCountedReceipts(conversationId, Array.from(countedSet).join(","));
  }

  // IDEMPOTENCIA POST-VENTA: un comprobante DUPLICADO no suma nada, así que no
  // puede habilitar ninguna entrega nueva. Si la venta YA fue aprobada (paid_at
  // sellado), cortamos aquí SIN re-entregar el enlace ni re-ofrecer el regalo.
  // Esto evita que, tras la compra, un mensaje del cliente que hace re-analizar
  // el mismo comprobante (p. ej. en pleno diálogo de upgrade) reenvíe el material
  // y el regalo. El upgrade REAL llega con un comprobante NUEVO (no duplicado) y
  // sí procede por el flujo de acumulación de abajo.
  if (isDuplicateReceipt && convo.paid_at != null) {
    console.log(
      `[wf:pago] convo ${conversationId}: duplicado sobre venta ya aprobada — no re-entrego material ni re-ofrezco regalo`
    );
    return baseResult({
      status: "APPROVED",
      paid_total_soles: newTotalCents / 100,
      missing_soles: 0,
      // QUEDA DICHO QUE ES UN DUPLICADO, Y NO SOLO EN LA FRASE.
      //
      // LO QUE PASÓ — 24/09/2026. El dueño mandó el mismo comprobante otra vez y
      // el bot se quedó MUDO: «el cliente puede creer que lo están ignorando».
      // Y mandarlo dos veces no es un error suyo — es el cliente asegurándose de
      // que se dio cuenta de que pagó.
      //
      // El motivo del silencio: una aprobación normal calla a propósito, porque
      // detrás va la entrega que manda el motor. Aquí no va nada, así que callar
      // deja el turno vacío. Con esta bandera las dos cosas se distinguen sin
      // tener que leer la frase de abajo.
      ya_estaba_registrado: true,
      // QUÉ TIENE QUE DECIR, Y CÓMO. Lo pidió el dueño el 30/09/2026 al ver que
      // a su cliente le llegaba «envíame una foto clara donde se vea el monto, la
      // fecha y la operación» con un comprobante que estaba perfecto —solo
      // repetido—: «no tiene sentido; puede decirle: este comprobante ya se usó,
      // reenvíeme un comprobante válido».
      //
      // Y DE USTED, NO DE TÚ: «con solo decir "envíeme" es suficiente para que se
      // vea respetuoso». Vale para todos los países.
      //
      // Se le dice al modelo QUÉ decir, no se le pone el texto: la frase exacta la
      // redacta él y así encaja con lo que venía hablando.
      reason:
        "Ese comprobante ya estaba registrado antes, así que no se puede contar otra vez. " +
        "NO vuelvas a enviar el enlace ni el regalo. " +
        "Dile en UNA línea corta que ese comprobante ya se usó, y que si acaba de hacer un pago nuevo le envíe ESE comprobante. " +
        "Trátalo de USTED, nunca de tú: «envíeme», no «envíame».",
    });
  }

  // Regla comercial: si la opcion elegida ya queda cubierta, se entrega.
  // Solo se pide saldo cuando el monto no cubre la opcion elegida.
  //
  // PERO ESTE COMPROBANTE PUEDE SER DEL SEGUNDO PRODUCTO, Y ENTONCES AQUÍ NO
  // PINTA NADA. Era el fallo más caro de todos, y hacía dos cosas a la vez:
  //
  //  · Pisaba el precio esperado. Más arriba ya se había fijado el del extra, y
  //    estas líneas lo cambiaban por el de la opción de la PRIMERA venta. El
  //    cliente pagaba los 8 que el bot acababa de pedirle y recibía «ya registré
  //    8, faltan 4.90» — la diferencia hasta el combo. Solo se salvaba de
  //    casualidad cuando el extra costaba MÁS que la opción, porque entonces el
  //    abono cubría igual: el mismo bot aprobaba o reclamaba según cuál de los
  //    dos precios fuera mayor.
  //
  //  · Y contaba el dinero del extra para subir de opción en la primera venta:
  //    «abono 19500 cubre combo — subo básico → combo y entrego sin preguntar».
  //    El cliente se llevaba el ascenso pagado con el dinero del segundo
  //    producto, y se entregaban dos cosas habiendo cobrado una y media.
  //
  // El extra lleva su propia cuenta más abajo, con su precio y su reparto. Aquí
  // solo se decide sobre la primera venta, así que cuando el comprobante es del
  // extra este bloque entero se aparta.
  if (
    isTwoTierActive() &&
    !esPagoDeUpsell &&
    (obChoice === "combo" || obChoice === "basico")
  ) {
    const choices = (["combo", "basico"] as const)
      .map((choice) => ({
        choice,
        price: getOrderBumpPriceSoles(choice, discountActive, convo.phone),
      }))
      .filter(
        (item): item is { choice: "combo" | "basico"; price: number } =>
          item.price !== null
      )
      .sort((a, b) => a.price - b.price);
    const current = choices.find((item) => item.choice === obChoice);
    /**
     * SUBIR ES SUBIR AL COMBO. NO «A LA MÁS CARA».
     *
     * LO QUE PASÓ — 16 de septiembre de 2026. En la etapa de descuento, el
     * registro del dueño decía esto, y la palabra «subo» no es una errata:
     *
     *     [wf:pago] abono 10500 cubre "basico" (6000) — subo "combo" → "basico"
     *
     * Había elegido el combo, pagó de más, y el motor lo pasó al BÁSICO.
     *
     * POR QUÉ. Esta línea buscaba «la opción con precio mayor» y la trataba como
     * la superior. Eso vale mientras el combo sea el caro — que es lo normal—,
     * pero el descuento no tiene por qué respetar esa escalera. Medido con su
     * contenido, ejecutando `getOrderBumpPriceSoles`:
     *
     *     sin descuento    basico 10   combo 14     escalera correcta
     *     con descuento    combo  7    basico 8     CRUZADA
     *
     * Con los precios cruzados, «la más cara» es la pequeña, y ascender lleva
     * hacia abajo. Pasó igual en los dos bots: no es una rareza de un contenido.
     *
     * LA REGLA BUENA NO ES DE PRECIO, ES DE QUÉ CONTIENE QUÉ. El combo ES el
     * básico más algo, así que subir solo puede ir de básico a combo, nunca al
     * revés. Y se exige ADEMÁS que el combo cueste más: si el descuento lo ha
     * dejado por debajo, pagar el precio del básico no demuestra que quisiera el
     * combo — y regalarlo sería entregar de más.
     *
     * SOLO PUEDE FRENAR, NUNCA MOVER. Todo lo que esta línea permite hoy lo
     * permitía antes; lo que hace es quitar los dos casos en que movía mal.
     * Sin descuento, con la escalera de siempre, se comporta exactamente igual.
     */
    const elCombo = choices.find((item) => item.choice === "combo");
    const higher =
      current && obChoice === "basico" && elCombo && elCombo.price > current.price
        ? elCombo
        : undefined;
    // Y SI LA ESCALERA ESTÁ CRUZADA, QUE SE VEA. Es contenido, no código: puede
    // ser a propósito o un descuento mal puesto, y solo el dueño lo sabe. Callarlo
    // es lo que costó encontrar esto en un registro de madrugada.
    if (elCombo && current && obChoice === "basico" && elCombo.price <= current.price) {
      console.warn(
        `[wf:pago] convo ${conversationId}: la opción mayor (${elCombo.price}) NO cuesta más que la menor (${current.price})${
          discountActive ? " en la etapa de descuento" : ""
        } — no subo de opción; revisa los precios en el editor`
      );
    }
    const lower = current
      ? choices
          .filter((item) => item.price < current.price)
          .sort((a, b) => b.price - a.price)[0]
      : undefined;

    // Si el abono ya cubre la opción superior (combo), el cliente pagó por ella:
    // subimos su elección a esa opción y dejamos que el flujo normal de
    // aprobación de abajo la entregue, SIN preguntar. Así nunca se entrega el
    // básico cuando se pagó el combo completo (la entrega usa obChoice, que aquí
    // ya quedó en el combo). El "¿fue error o cambio?" queda solo para el
    // excedente intermedio: pagó más que el básico pero no alcanza el combo.
    if (higher && newTotalCents >= Math.round(higher.price * 100)) {
      console.log(
        `[wf:pago] convo ${conversationId}: abono ${
          newTotalCents / 100
        } cubre "${higher.choice}" (${higher.price}) — subo "${obChoice}" → "${higher.choice}" y entrego sin preguntar`
      );
      setOrderBumpChoice(conversationId, higher.choice);
      obChoice = higher.choice;
      priceSoles = higher.price;
    } else if (current) {
      priceSoles = current.price;
    }
    /*
    } else if (
      isDobleOfertaActive() &&
      current &&
      lower &&
      newTotalCents >= Math.round(lower.price * 100) &&
      newTotalCents < Math.round(current.price * 100)
    ) {
      const paidTotalSoles = newTotalCents / 100;
      const missingSoles = Math.max(0, current.price - paidTotalSoles);
      const lowerName =
        getOrderBumpOption(lower.choice)?.name?.trim() || lower.choice;
      const currentPriceText = formatConvoAmount(convo, current.price, config);
      const paidTotalText = formatConvoAmount(convo, paidTotalSoles, config);
      const lowerPriceText = formatConvoAmount(convo, lower.price, config);
      const missingText = formatConvoAmount(convo, missingSoles, config);
      console.log(
        `[wf:pago] convo ${conversationId}: eligio "${current.choice}" (${currentPriceText}) pero abono ${paidTotalText}, que cubre "${lower.choice}" (${lowerPriceText}); espero confirmacion`
      );
      setConversationState(
        conversationId,
        "awaiting_order_bump_payment_choice"
      );
      return {
        status: "CHOICE_REQUIRED",
        paid_total_soles: paidTotalSoles,
        course_price_soles: current.price,
        missing_soles: missingSoles,
        customer_message:
          `Elegiste la opcion de ${currentPriceText}, pero pagaste ${paidTotalText}. ` +
          `Fue una confusion y vas a completar ${missingText}, o prefieres quedarte con la opcion de ${lowerPriceText}?`,
        reason:
          `El cliente habia elegido la opcion de ${currentPriceText}, ` +
          `pero su pago acumulado es ${paidTotalText}, que cubre "${lowerName}" por ${lowerPriceText}. ` +
          `No confirmes ni entregues todavia. Preguntale si fue confusion y completara ${missingText}, o si prefiere quedarse con la opcion de ${lowerPriceText}.`,
      };
    } else if (
      current &&
      higher &&
      newTotalCents > Math.round(current.price * 100)
    ) {
      const paidTotalSoles = newTotalCents / 100;
      const missingSoles = Math.max(0, higher.price - paidTotalSoles);
      const currentName =
        getOrderBumpOption(current.choice)?.name?.trim() || current.choice;
      const higherName =
        getOrderBumpOption(higher.choice)?.name?.trim() || higher.choice;
      const currentPriceLabel = formatConvoAmount(convo, current.price, config);
      const higherPriceLabel = formatConvoAmount(convo, higher.price, config);
      const paidTotalLabel = formatConvoAmount(convo, paidTotalSoles, config);
      const missingLabel = formatConvoAmount(convo, missingSoles, config);
      console.log(
        `[wf:pago] convo ${conversationId}: acumulado ${paidTotalLabel} supera "${current.choice}" (${currentPriceLabel}); espero confirmacion`
      );
      setConversationState(
        conversationId,
        "awaiting_order_bump_payment_choice"
      );
      return {
        status: "CHOICE_REQUIRED",
        paid_total_soles: paidTotalSoles,
        course_price_soles: higher.price,
        missing_soles: missingSoles,
        customer_message:
          `Veo que elegiste ${currentName} por ${currentPriceLabel}, pero abonaste ${paidTotalLabel}. ` +
          `¿El monto adicional fue un error o cambiaste de opinión y prefieres ${higherName} por ${higherPriceLabel}?` +
          (missingSoles > 0
            ? ` Si deseas ${higherName}, faltaría completar ${missingLabel}.`
            : ""),
        reason:
          `El cliente habia elegido "${currentName}" por ${currentPriceLabel}, ` +
          `pero su pago acumulado es ${paidTotalLabel}. No confirmes ni entregues todavia. ` +
          `Preguntale naturalmente si el excedente fue un error o si cambio de opinion y desea "${higherName}" por ${higherPriceLabel}.` +
          (missingSoles > 0
            ? ` Si confirma "${higherName}", le faltaran ${missingLabel}.`
            : ` Si confirma "${higherName}", el monto ya esta completo.`),
      };
    }
    */
  }

  const priceCents = Math.round(priceSoles * 100);

  // ── UPSELL: aprobación de la SEGUNDA venta ───────────────────────────────
  //
  // UN TICKET INDEPENDIENTE, CON SU PRECIO Y SU PROPIA CUENTA.
  //
  // Antes esto era una RESTA: el total acumulado menos una «foto» de lo pagado
  // al ofrecerlo. La foto hacía de línea divisoria y funcionaba solo mientras
  // nada se moviera por debajo. Pero se sacaba UNA vez y no se volvía a sacar:
  // si después el cliente subía de básico a full, ese dinero entraba por encima
  // de una línea vieja y se contaba para el segundo producto. Se entregaba
  // habiendo cobrado de menos — exactamente lo que costó el upgrade.
  //
  // Ahora el extra lleva su propia cuenta. Da igual lo que pase con la primera
  // venta: esta ni la mira.
  //
  // Y el reparto de un comprobante que cubre las dos cosas es el natural:
  // PRIMERO se termina de pagar lo que el cliente ya se llevó, y lo que sobra es
  // del extra. Al revés se entregarían dos cosas habiendo cobrado una y media.
  if (esPagoDeUpsell) {
    if (precioUpsell === null) {
      return baseResult({
        reason:
          "El segundo producto no tiene un precio válido configurado. No apruebes ni entregues hasta corregirlo.",
      });
    }
    // LO QUE YA HABÍA ABONADO AL EXTRA, INCLUIDAS LAS CONVERSACIONES VIEJAS.
    //
    // Las que estaban a medias cuando esto se deployó tienen la cuenta en cero y
    // su abono metido en la resta de la foto. Sin recuperarlo se les pediría
    // otra vez un dinero que ya pagaron, y eso no se le hace a un cliente.
    const abonadoAntes =
      convo.upsell_paid_cents > 0
        ? convo.upsell_paid_cents
        : Math.max(0, convo.paid_total_cents - convo.upsell_base_cents);
    const debidoDeLaPrimera = Math.max(
      0,
      Math.round(precioPrimeraVenta * 100) - convo.paid_total_cents
    );
    // Un comprobante duplicado no sumó nada al total; tampoco puede sumar aquí.
    const alExtra = isDuplicateReceipt
      ? 0
      : Math.max(0, cents - debidoDeLaPrimera);
    if (alExtra > 0) addToUpsellPaid(conversationId, alExtra);
    if (debidoDeLaPrimera > 0) {
      console.log(
        `[wf:upsell] convo ${conversationId}: de este comprobante, ${
          debidoDeLaPrimera / 100
        } completan la primera venta y ${alExtra / 100} van al extra`
      );
    }
    const abonadoAlUpsell = abonadoAntes + alExtra;
    const faltante = (priceCents - abonadoAlUpsell) / 100;
    if (abonadoAlUpsell < priceCents) {
      return {
        status: "PARTIAL",
        paid_total_soles: abonadoAlUpsell / 100,
        course_price_soles: precioUpsell,
        missing_soles: Math.max(0, faltante),
        reason:
          `Pago parcial del segundo producto: faltan ${formatConvoAmount(
            convo,
            Math.max(0, faltante),
            config
          )}. Díselo exactamente así, sin convertirlo a otra unidad ni escribirlo como decimal. Pídele completar la diferencia.`,
      };
    }
    // UPSELLS EN FILA: se anota QUÉ pagó, para no volver a ofrecérselo nunca y para
    // reenviárselo todo si pide «no me llegó». Solo con fila puesta: sin ella esto no
    // escribe nada y la venta queda exactamente como siempre.
    const ofertaPagada = seccionUpsell(config)?.de_la_fila;
    if (config?.filas_de_upsell?.length) {
      anotarCompraDeLaFila(conversationId, {
        producto_id: ofertaPagada?.producto_id ?? null,
        downsell: !!ofertaPagada?.downsell,
        cents: abonadoAlUpsell,
        at: Math.floor(Date.now() / 1000),
      });
    }
    // El total ya quedó guardado por addToPaidTotal más arriba.
    setUpsellState(conversationId, "pagado");
    setUpsellPaidAt(conversationId, Math.floor(Date.now() / 1000));
    // El ticket se cierra: la cuenta vuelve a cero. Hoy no cambia nada —esta
    // conversación ya no vuelve a pasar por aquí—, pero el día que haya un
    // segundo extra encadenado, empieza limpio en vez de heredar lo del
    // anterior y darse por pagado solo.
    resetUpsellPaid(conversationId);
    resetPaymentAttemptsFailed(conversationId);
    // Al terminar la entrega del segundo producto, continuarTrasEntrega vuelve
    // a pasar por aquí: como el upsell ya está 'pagado', cae al regalo. Por eso
    // no se pierde aunque scheduleDeliverySequence cancele lo pendiente.
    entregarUpsell(conversationId);
    const montoUpsell = abonadoAlUpsell / 100;
    const paisUpsell = getEffectiveCountryCode(convo.phone, config);
    const monedaUpsell =
      convo.locked_price_currency ?? getCountryInfo(paisUpsell).currency;
    console.log(
      `[wf:upsell] convo ${conversationId}: SEGUNDA VENTA aprobada (${montoUpsell})`
    );
    // La segunda venta también se le reporta a Meta: si no, la campaña
    // optimiza con la mitad del dinero que realmente entra.
    void sendPurchaseEvent({
      conversationId,
      userData: buildMessagingUserData({
        channel: convo.channel,
        phone: convo.phone,
        firstName: convo.client_name ?? convo.name,
        email: convo.client_email,
        ctwa_clid: convo.ctwa_clid,
      }),
      value: montoUpsell,
      currency: monedaUpsell,
    });
    if (convo.channel !== "test") {
      // Cada venta de la fila con su nombre: el aviso del downsell dice que lo es, y el
      // de un producto de la fila también. El del upsell de siempre, igual que antes.
      const titulo = ofertaPagada?.downsell
        ? "⬇️ *DOWNSELL*"
        : ofertaPagada
          ? "🛒 *VENTA EN FILA (upsell)*"
          : "🛒 *SEGUNDA VENTA (upsell)*";
      void notifyAdmin(
        `${titulo}: ‼️🫰🏼💵\n\n` +
          `Numero: ${convo.phone}\n` +
          `Cliente: ${convo.client_name ?? convo.name ?? "Sin nombre"}\n` +
          `Producto: ${seccionUpsell(config)?.name ?? "Segundo producto"}\n` +
          `Monto: ${formatCurrencyAmount(montoUpsell, paisUpsell, monedaUpsell)}`
      );
    }
    void syncLeadStatus(conversationId);
    return {
      status: "APPROVED",
      paid_total_soles: montoUpsell,
      course_price_soles: precioUpsell,
      missing_soles: 0,
      reason:
        "Segunda venta aprobada. El sistema ya está entregando el segundo producto — NO escribas ni prometas enlaces.",
    };
  }

  if (newTotalCents >= priceCents) {
    // ¡APROBADO! Ruteo de ENTREGA según la Bioferta Oferta Doble.
    //  - Bioferta APAGADA (packPrice === null) → entrega normal de hoy.
    //  - Pagó el monto del PACK → entrega el pack.
    //  - Pagó el UNITARIO → entrega el producto que eligió; si aún no eligió,
    //    pasamos a awaiting_bioferta_choice y le preguntamos cuál quiere.
    // Con el teléfono, para que el umbral del pack sea el de SU país (el mismo
    // que se le mostró al pedirle el pago) y no el global.
    const packPrice = getBiofertaPackPriceSoles(discountActive, convo.phone);
    if (
      isTwoTierActive() &&
      (obChoice === "combo" || obChoice === "basico")
    ) {
      // ORDER BUMP: entrega la opción elegida (combo/básico).
      deliverOrderBumpTier(conversationId, obChoice);
    } else if (isBiofertaActive()) {
      // DOBLE OFERTA — manda el MONTO PAGADO, no el botón que tocó.
      //
      // Pagar el precio del pack es la señal más clara que puede dar: aunque
      // antes hubiera tocado "Perritos", si paga los 4.50 quiere los dos. Se
      // le entrega el pack sin preguntarle nada.
      //
      // Y si pagó el precio de UNO solo, se le pregunta SIEMPRE cuál quiere,
      // aunque ya hubiera tocado un botón: entre elegir y pagar puede haber
      // cambiado de opinión, y entregarle el equivocado es peor que preguntar.
      const alcanzaElPack =
        packPrice !== null && newTotalCents >= Math.round(packPrice * 100);
      if (alcanzaElPack) {
        if (bioChoice !== "pack") {
          console.log(
            `[wf:pago] convo ${conversationId}: pagó el monto del pack (elección previa: ${bioChoice ?? "ninguna"}) → entrego el pack`
          );
          setBiofertaChoice(conversationId, "pack");
        }
        deliverBiofertaTier(conversationId, "pack");
      } else {
        setConversationState(conversationId, "awaiting_bioferta_choice");
        void sendBiofertaAskChoice(convo);
      }
    } else if (isTwoTierActive()) {
      if (routeBPostPaymentOrderBump) {
        const basicPrice = getOrderBumpPriceSoles("basico", discountActive, convo.phone);
        if (basicPrice !== null && newTotalCents >= Math.round(basicPrice * 100)) {
          setConversationState(
            conversationId,
            "awaiting_post_payment_order_bump_choice"
          );
          void sendPostPaymentOrderBumpChoice(convo);
          const comboPrice = getOrderBumpPriceSoles("combo", discountActive, convo.phone);
          const missingCombo =
            comboPrice === null ? 0 : Math.max(0, comboPrice - newTotalCents / 100);
          return {
            status: "CHOICE_REQUIRED",
            paid_total_soles: newTotalCents / 100,
            course_price_soles: comboPrice ?? basicPrice,
            missing_soles: missingCombo,
            customer_message:
              "Pago recibido. Antes de entregar, el cliente debe elegir si se queda con el basico o completa la diferencia para el combo.",
            reason:
              "Ruta B: pago directo recibido sin elección previa. No entregues todavía; espera que el cliente elija basico o combo post-pago.",
          };
        }
        const missingBasic =
          basicPrice === null ? priceSoles : Math.max(0, basicPrice - newTotalCents / 100);
        setConversationState(conversationId, "payment_done");
        return {
          status: "PARTIAL",
          paid_total_soles: newTotalCents / 100,
          course_price_soles: basicPrice ?? priceSoles,
          missing_soles: missingBasic,
          reason:
            `Ruta B: el pago directo aun no cubre el basico; faltan ${formatConvoAmount(
              convo,
              missingBasic,
              config
            )}. Díselo exactamente así, sin convertirlo a otra unidad ni escribirlo como decimal. Pide completar antes de mostrar el order bump post-pago.`,
        };
      }
      // Order bump activo pero SIN elección registrada. Dos casos distintos:
      //
      // 1) Nunca se le mostró la oferta (el del comprobante cruzado entre bots):
      //    pagó y no sabe que existían 2 opciones. Le entregamos el COMBO. Es
      //    una decisión comercial: preferimos regalar de más en un caso entre
      //    mil antes que un reclamo de alguien que ya pagó.
      // 2) Sí la vio pero no eligió (caso raro): se conserva el BÁSICO de
      //    siempre.
      //
      // La entrega en esta modalidad obedece SIEMPRE la pestaña de la oferta,
      // nunca el cajón "Pago Aprobado". deliverOrderBumpTier fija el estado y,
      // si esa entrega estuviera vacía, cae al respaldo.
      // Y LO DECIDE EL IMPORTE, NO SOLO «NO VIO LA OFERTA».
      //
      // LO QUE PASÓ — 25 de septiembre de 2026. El dueño vende en lineal y cambia
      // la presentación con el selector cuando quiere, también con clientes a
      // media conversación. Ese cliente recibió la información y los datos de
      // pago de UN producto, pagó ESE precio, y al cambiar el selector a «como
      // -OB-» esta línea le entregaba el COMBO: el full regalado, con el precio
      // del básico. Con sus palabras: «si recibió información y datos en lineal y
      // paga, se le entregaría el producto» — el que le mostraron.
      //
      // LA EXCEPCIÓN SIGUE EN PIE, Y CON SU MOTIVO INTACTO. La escribió el caso
      // de la clienta que hablaba con dos bots a la vez: vio las dos opciones en
      // uno, pagó, y mandó el comprobante al otro, donde nunca se le había
      // revelado nada. Ahí SÍ hay que darle el combo, y se sigue dando — porque
      // su pago lo cubre. Lo que se quita es regalarlo a quien pagó el básico.
      //
      // «NO DISCUTIR CON QUIEN YA PAGÓ» SE RESPETA IGUAL: quien pagó el combo
      // recibe el combo, y quien pagó el básico recibe el básico. Nadie recibe
      // menos de lo que pagó, y nadie recibe de más.
      //
      // ES LA MISMA DOCTRINA QUE YA USA LA BIOFERTA unas líneas más abajo: «pagar
      // el precio del pack es la señal más clara que puede dar». Aquí se aplica al
      // único caso que le faltaba.
      //
      // Y LA OTRA RAMA NO SE TOCA: si vio la oferta y no eligió, sigue siendo el
      // BÁSICO de siempre, exactamente como antes.
      const elPrecioDelCombo = getOrderBumpPriceSoles(
        "combo",
        discountActive,
        convo.phone
      );
      const suPagoCubreElCombo =
        elPrecioDelCombo !== null &&
        newTotalCents >= Math.round(elPrecioDelCombo * 100);
      const aEntregar =
        ofertaNuncaRevelada && suPagoCubreElCombo ? "combo" : "basico";
      if (aEntregar === "combo") {
        console.log(
          `[wf:pago] convo ${conversationId}: pagó sin haber visto nunca la oferta y su abono cubre el combo → entrego el COMBO`
        );
      }
      /* SE ANOTA LO QUE SE LE ENTREGÓ, LAS DOS VECES. ANTES SOLO EL COMBO.
       *
       * LO QUE PASÓ — 29 de septiembre de 2026, sus pruebas ARG1 (convo 311) y
       * PEROU1 (convo 314). Las dos pagaron, las dos recibieron su material, y las
       * dos reclamaron despues que no les habia llegado. El bot contesto «claro, te
       * lo reenvio ahora mismo»… y no salio nada:
       *
       *     [wf:pago] convo 311: REENVÍO de material (ya pagó)
       *     [wf:pago] convo 311: PAGÓ y no hay entrega que mandar (la entrega "approved")
       *
       * LAS OTRAS CUATRO SÍ LO RECIBIERON, y la diferencia es exacta: las cuatro
       * tenían una opción ANOTADA —la eligieron ellas, o el importe la registró— y
       * las dos que fallaron no tenían ninguna.
       *
       * POR QUÉ. Estas líneas deciden qué entregar cuando el cliente nunca eligió,
       * y lo entregan bien. Pero solo ANOTABAN la elección en la rama del combo. En
       * la del básico se entregaba y no quedaba constancia, así que más tarde nadie
       * sabía qué se le había mandado: el reenvío preguntaba por la opción, no había
       * ninguna, y caía al cajón «Pago Aprobado».
       *
       * Y AHÍ SE ACABABA, POR SU CONTENIDO: medido con su configuración, ese cajón
       * tiene DOS burbujas y las dos están APAGADAS. La opción sí tiene su entrega.
       * O sea: había material que mandar y el bot no sabía que era el suyo.
       *
       * EL MOTIVO PARA ANOTARLO ES EL QUE YA ESTABA ESCRITO AQUÍ para el combo —
       * «es lo que realmente se le entregó»—; lo único raro era que valiera para una
       * opción y no para la otra.
       *
       * Y ARREGLA DE PASO EL UPGRADE de estos clientes: subir del básico al combo
       * exige tener «basico» anotado, así que sin la anota tampoco podían subir.
       *
       * NO CAMBIA NADA DE ESTE TURNO: se entrega exactamente lo mismo que antes,
       * `deliverOrderBumpTier` recibe el mismo valor. Lo único que cambia es que
       * queda constancia para después.
       */
      setOrderBumpChoice(conversationId, aEntregar);
      obChoice = aEntregar;
      deliverOrderBumpTier(conversationId, aEntregar);
    } else {
      setConversationState(conversationId, "payment_approved");
      // La preferencia de entrega cambia el estado a
      // `awaiting_delivery_preference`. Debe programarse después de este
      // estado base; de otro modo lo sobrescribimos y el worker descarta los
      // botones antes de enviarlos.
      schedulePaymentApprovedSequence(conversationId);
    }
    // Sello de fecha de la venta (solo para el panel de ventas; no afecta
    // el flujo). Se graba en el momento exacto de la aprobación.
    setPaidAt(conversationId, Math.floor(Date.now() / 1000));
    // Reseteamos el contador de fallos por si en intentos previos se
    // habia incrementado pero ahora cerró bien.
    resetPaymentAttemptsFailed(conversationId);
    const paidTotalSoles = newTotalCents / 100;
    const countryCode = getEffectiveCountryCode(convo.phone, config);
    const purchaseCurrency =
      convo.locked_price_currency ?? getCountryInfo(countryCode).currency;
    const paidTotalLabel = formatCurrencyAmount(
      paidTotalSoles,
      countryCode,
      purchaseCurrency
    );
    console.log(
      `[wf:pago] convo ${conversationId} APROBADO (total: ${paidTotalLabel})`
    );
    // Meta CAPI: reportamos la compra a Meta para optimización de ads.
    // Fire-and-forget — si falla, no rompe el flujo del cliente.
    void sendPurchaseEvent({
      conversationId,
      userData: buildMessagingUserData({
        channel: convo.channel,
        phone: convo.phone,
        firstName: convo.client_name ?? convo.name,
        email: convo.client_email,
        ctwa_clid: convo.ctwa_clid,
      }),
      value: paidTotalSoles,
      currency: purchaseCurrency,
    });
    // Notifica al admin por WhatsApp que llegó una compra nueva.
    const customerName = convo.client_name ?? convo.name ?? "Sin nombre";
    const purchasedProduct = (() => {
      if (obChoice === "combo" || obChoice === "basico")
        return getOrderBumpOption(obChoice)?.name?.trim() || getProductName();
      if (bioChoice === "b")
        return config?.bioferta_doble?.product_b?.name?.trim() || "Producto 2";
      if (bioChoice === "pack")
        return config?.bioferta_doble?.pack?.name?.trim() || "Pack";
      return getProductName();
    })();
    if (convo.channel !== "test") void notifyAdmin(
      `🛒 *Venta Realizada*: ‼️🫰🏼💵\n\n` +
        `Numero: ${convo.phone}\n` +
        `Nombre: ${customerName}\n` +
        `Monto: ${paidTotalLabel}\n` +
        `Moneda Meta: ${purchaseCurrency}\n` +
        `Asunto: El usuario acaba de adquirir ${purchasedProduct} y ha realizado una transacción a través de ${args.payment_method} por ${paidTotalLabel}.`
    );
    // NocoDB: el state ya cambió a payment_approved → la próxima sync
    // pondrá Label = "pago" y Resumen actualizado.
    void syncLeadStatus(conversationId);
    return {
      status: "APPROVED",
      paid_total_soles: paidTotalSoles,
      course_price_soles: priceSoles,
      missing_soles: 0,
    };
  }

  console.log(
    `[wf:pago] convo ${conversationId} PARCIAL (total: ${formatConvoAmount(
      convo,
      newTotalCents / 100,
      config
    )} / ${formatConvoAmount(convo, priceSoles, config)})`
  );
  const faltanteSoles = (priceCents - newTotalCents) / 100;
  const faltanteTexto = formatConvoAmount(convo, faltanteSoles, config);
  return {
    status: "PARTIAL",
    paid_total_soles: newTotalCents / 100,
    course_price_soles: priceSoles,
    missing_soles: faltanteSoles,
    // Sin esto el LLM solo veía el número suelto (0.9) y se lo decía al cliente
    // como "0.90 soles". Un cliente lo leyó como soles, mandó 9 y hubo que
    // devolverle la diferencia. Se le entrega la frase ya escrita y se le pide
    // que no la reconstruya desde el número.
    reason:
      `Pago parcial: faltan ${faltanteTexto}. Díselo exactamente así, ` +
      `"${faltanteTexto}". No lo conviertas a otra unidad ni lo escribas como decimal.`,
  };
}

/**
 * Programa la secuencia "pago aprobado" (video + caption + lo que sea
 * que el operador haya configurado en el YAML) — PRODUCTO PRINCIPAL.
 */
/**
 * PAGÓ Y NO HAY NADA QUE ENTREGARLE. SE AVISA EN EL ACTO.
 *
 * Antes esto era una línea en el registro del servidor, que no lee nadie. Y es
 * la peor de las averías: la clienta pagó, está esperando su material y el bot
 * se queda callado.
 *
 * Pasa a doler desde que los cajones viejos ya no pueden hablar: si el producto
 * elegido no tiene su entrega escrita, no hay de dónde sacar nada. Antes se caía
 * a la entrega general, que es justo lo prohibido —le llegaba el archivo del
 * producto anterior—. Así que ahora se para, y se avisa para arreglarlo a mano
 * en el minuto siguiente.
 *
 * Es el mismo camino que ya usa el aviso de «entrega media rota» y el del
 * upsell sin entrega.
 */
function avisarQueNoHayEntrega(
  conversationId: number,
  deQue: string
): void {
  console.error(
    `[wf:pago] convo ${conversationId}: PAGÓ y no hay entrega que mandar (${deQue})`
  );
  const convo = getConversationById(conversationId);
  if (convo?.channel === "test") return;
  void notifyAdmin(
    `⚠️ PAGÓ Y SE QUEDÓ SIN ENTREGA: convo ${conversationId} (${convo?.phone ?? "sin número"}). ` +
      `La entrega de ${deQue} está vacía. Revisa la ficha del producto y mándasela a mano YA.`
  );
}

function schedulePaymentApprovedSequence(conversationId: number): void {
  const config = loadWorkflowConfig();
  if (!config?.payment_approved_sequence) {
    avisarQueNoHayEntrega(conversationId, "«Pago Aprobado»");
    return;
  }
  if (maybeStartDeliveryPreference(conversationId, "approved")) return;
  scheduleDeliverySequence(
    conversationId,
    config.payment_approved_sequence,
    "approved",
    true
  );
}

function maybeStartDeliveryPreference(
  conversationId: number,
  source: DeliverySource
): boolean {
  const config = loadWorkflowConfig();
  const pref = config?.post_sale_delivery_preference;
  if (pref?.enabled !== true) return false;
  const delay = Math.max(0, Math.floor(pref.delay_seconds ?? 15));
  const now = Math.floor(Date.now() / 1000);
  cancelPendingActionsForConvo(conversationId);
  setPendingDeliverySource(conversationId, source);
  setConversationState(conversationId, "awaiting_delivery_preference");
  // Si el editor tiene pasos de espera pero todos están apagados, no debemos
  // volver a enviar `wait_text`: es un respaldo legacy para configuraciones
  // antiguas que todavía no tenían `wait_steps`.
  const configuredWaitSteps = Array.isArray(pref.wait_steps)
    ? pref.wait_steps
    : null;
  const hasConfiguredWaitSteps = configuredWaitSteps !== null;
  const waitSteps = configuredWaitSteps?.filter(
    (step) => step.enabled !== false
  ) ?? [];
  let preferenceRunAt = now + delay;
  if (waitSteps.length > 0) {
    let runAt = now;
    for (const step of waitSteps) {
      scheduleAction(
        conversationId,
        "send_post_sale_delivery_step",
        { step },
        runAt
      );
      runAt += Math.max(
        0,
        Math.floor((step as { delay_after_sec?: number }).delay_after_sec ?? 0)
      );
    }
    preferenceRunAt = Math.max(preferenceRunAt, runAt);
  } else if (!hasConfiguredWaitSteps) {
    const waitText = pref.wait_text?.trim();
    if (waitText) {
      scheduleAction(
        conversationId,
        "send_text_chunk",
        { body: waitText },
        now
      );
    }
  }
  scheduleAction(
    conversationId,
    "send_delivery_preference",
    { source },
    preferenceRunAt
  );
  console.log(
    `[wf:pago] preferencia de entrega programada para convo ${conversationId} (${source})`
  );
  nudgeDeliveryWorker();
  return true;
}

/**
 * REENVÍO de material a un cliente que YA PAGÓ y pide su enlace de nuevo (lo
 * borró, lo perdió, no lo encuentra). Reenvía la MISMA secuencia de pago
 * aprobado (video + enlace REAL + pedido de correo) — el SISTEMA la manda, el
 * LLM nunca inventa el enlace. Devuelve false si la convo NO figura como
 * pagada (no se reenvía material a quien no compró).
 */
export function resendApprovedMaterial(convo: ConversationRow): boolean {
  // UPSELLS EN FILA: también desde Messenger e Instagram. Ver `conLaFilaDe`.
  return conLaFilaDe(convo.id, () => resendApprovedMaterialConSuFila(convo));
}

function resendApprovedMaterialConSuFila(convo: ConversationRow): boolean {
  const paidStates = new Set([
    "payment_approved",
    "awaiting_delivery_preference",
    "awaiting_email",
    "awaiting_gift_consent",
    "awaiting_facebook_comment",
  ]);
  const paid = convo.paid_at != null || paidStates.has(convo.state ?? "");
  if (!paid) {
    console.warn(
      `[wf:pago] convo ${convo.id}: pidieron reenvío pero NO figura pago — no reenvío`
    );
    return false;
  }
  console.log(
    `[wf:pago] convo ${convo.id}: REENVÍO de material (ya pagó) — reenviando lo que compró`
  );
  const config = loadWorkflowConfig();
  const skipEmailRequest = !!convo.client_email;

  // LO QUE COMPRÓ SON HASTA DOS COSAS, Y ANTES SOLO SE MANDABA UNA.
  //
  // LO QUE COSTÓ — 14 de septiembre de 2026. Con sus palabras: «tenemos un
  // agente que no sabe cuál enlace enviarle […] si un cliente hizo upgrade no
  // recibe, o si compró el full no sabe». Un cliente que compró el combo Y el
  // extra pidió su enlace y le llegó SOLO el del extra:
  //
  //     [wf:pago] convo 83: REENVÍO de material (ya pagó)
  //     [wf:pago] entrega "upsell" programada para convo 83
  //
  // Esto era una escalera de `return`: la primera rama que casaba se llevaba el
  // reenvío entero y las demás no llegaban a mirarse. Y la primera era la del
  // extra, así que a quien había comprado las dos cosas le faltaba siempre su
  // producto principal — el caro.
  //
  // LAS REGLAS, DICTADAS POR ÉL:
  //
  //     compró el básico              → el básico
  //     compró el full                → el full
  //     básico + extra                → los dos
  //     full + extra                  → los dos
  //     hizo upgrade                  → el full, y NO el básico: el full ya lo
  //                                     lleva dentro
  //
  // El upgrade sale solo: al subir de opción, `order_bump_choice` pasa a
  // "combo", así que preguntar por la elección de HOY ya contesta «el full».
  //
  // Y VALE PARA LAS TRES MODALIDADES. En lineal y en Doble Oferta no hay dos
  // opciones que elegir, así que lo principal es la entrega de siempre; el
  // extra se suma igual si lo compró. Es la misma regla, no una por modalidad.
  const loPrincipal = ((): { pasos: SequenceStep[]; fuente: DeliverySource } | null => {
    if (
      convo.order_bump_choice === "combo" ||
      convo.order_bump_choice === "basico"
    ) {
      const choice = convo.order_bump_choice;
      // Modalidad ACTIVA (order bump O doble oferta), NO order_bump fijo — si no,
      // en doble oferta reenviaba la entrega de order bump, que es otro producto.
      const pasos = getOrderBumpOption(choice)?.delivery;
      if (pasos?.length && !sectionHasPlaceholder(pasos))
        return {
          pasos,
          fuente: choice === "combo" ? "ob_combo" : "ob_basico",
        };
    }
    if (convo.bioferta_choice === "b" || convo.bioferta_choice === "pack") {
      const choice = convo.bioferta_choice;
      const pasos =
        choice === "b"
          ? config?.bioferta_doble?.product_b?.delivery
          : config?.bioferta_doble?.pack?.delivery;
      if (pasos?.length && !sectionHasPlaceholder(pasos))
        return {
          pasos,
          fuente: choice === "b" ? "bioferta_b" : "bioferta_pack",
        };
    }
    const pasos = config?.payment_approved_sequence;
    if (pasos?.length && !sectionHasPlaceholder(pasos))
      return { pasos, fuente: "approved" };
    return null;
  })();

  // El extra SOLO si lo pagó. Ofrecido o aceptado-sin-pagar no es comprado, y
  // mandarle su enlace sería regalárselo.
  const elExtra =
    convo.upsell_state === "pagado" ? seccionUpsell(config)?.delivery : null;
  // UPSELLS EN FILA: «se reenvía TODO lo que compró, no solo lo último». Cada compra de
  // la fila con SU entrega, en el orden en que la pagó. Sin fila en juego es null, y el
  // extra es el de siempre: la línea de arriba, tal cual.
  const deLaFila = entregasDeLoCompradoEnLaFila(convo, config);
  const hayExtra = deLaFila
    ? deLaFila.length > 0
    : !!elExtra?.length && !sectionHasPlaceholder(elExtra);

  if (!loPrincipal && !hayExtra) {
    // Ni lo uno ni lo otro: se avisa por el camino de siempre.
    scheduleDeliveryBySource(convo.id, "approved", {
      skipLastStep: skipEmailRequest,
      sendFirstStepImmediately: true,
    });
    return true;
  }

  // EL PEDIDO DEL CORREO VA UNA SOLA VEZ, AL FINAL DE TODO. Es el último paso de
  // la secuencia, y con dos entregas encadenadas saldría dos veces.
  let corrido = 0;
  if (loPrincipal) {
    corrido = scheduleDeliverySequence(
      convo.id,
      loPrincipal.pasos,
      loPrincipal.fuente,
      true,
      hayExtra ? true : skipEmailRequest,
      { noEsLaUltima: hayExtra }
    );
  }
  if (hayExtra && elExtra && !deLaFila) {
    scheduleDeliverySequence(
      convo.id,
      elExtra,
      "upsell",
      false,
      skipEmailRequest,
      { sinCancelar: !!loPrincipal, retrasoInicialSeg: corrido }
    );
    console.log(
      `[wf:pago] convo ${convo.id}: también compró el extra → se lo reenvío detrás`
    );
  }
  // LO DE LA FILA, uno detrás de otro y sin pisarse: cada uno empieza donde acabó el
  // anterior, y solo el último marca el cierre de la postventa. Cada burbuja lleva de qué
  // producto es, para que el obrero mande la de ESE y no la de la oferta en curso.
  if (deLaFila) {
    deLaFila.forEach((compra, i) => {
      const esLaUltima = i === deLaFila.length - 1;
      const hasta = scheduleDeliverySequence(
        convo.id,
        compra.pasos,
        "upsell",
        false,
        skipEmailRequest,
        {
          sinCancelar: !!loPrincipal || i > 0,
          retrasoInicialSeg: corrido,
          noEsLaUltima: !esLaUltima,
        },
        compra.producto_id
      );
      corrido = Math.max(corrido, hasta);
    });
    if (deLaFila.length > 0) {
      console.log(
        `[wf:pago] convo ${convo.id}: también compró ${deLaFila.length} de la fila → se lo reenvío detrás`
      );
    }
  }
  return true;
}

async function sendImmediateDeliveryStep(
  conversationId: number,
  step: SequenceStep,
  // DE QUÉ ENTREGA ES ESTE PASO. Esta es la primera burbuja, la que sale sin
  // pasar por la cola, así que aquí no llega el `source` del payload como en
  // las demás. Sin él, `{{PRODUCTO_ENTREGADO}}` se quedaría en blanco justo en
  // la burbuja que más se lee: la primera.
  source: FuenteDeEntrega = "approved"
): Promise<void> {
  if (step.enabled === false) return;
  const convo = getConversationById(conversationId);
  if (!convo) return;

  if (step.type === "text") {
    const bodyText = pickVariant(step.body_variants, step.body) ?? "";
    if (bodyText.trim())
      await sendBotText(convo, aplicarProductoEntregado(bodyText, source));
    return;
  }

  const captionRaw =
    step.type !== "audio"
      ? pickVariant(
          (step as { caption_variants?: string[] }).caption_variants,
          (step as { caption?: string }).caption
        )
      : undefined;
  const caption = captionRaw
    ? aplicarProductoEntregado(captionRaw, source)
    : undefined;
  await sendBotMediaFromDrive(convo, step.type, step.drive_url, caption);
}

/**
 * Programa una secuencia de ENTREGA (pasos con sus delays) usando la acción
 * send_payment_approved_step. `source` indica de qué secuencia leer al
 * ejecutar cada paso: "approved" (producto principal), "bioferta_b" o
 * "bioferta_pack". Si la secuencia aún tiene placeholders, no entrega.
 */
function scheduleDeliverySequence(
  conversationId: number,
  sequence: SequenceStep[],
  source: DeliverySource,
  sendFirstStepImmediately = false,
  skipLastStep = false,
  /**
   * PARA ENCADENAR DOS ENTREGAS EN LA MISMA TANDA.
   *
   * Un cliente puede tener DOS cosas compradas —su producto y el extra— y al
   * pedir «no me llegó» hay que mandarle las dos. Sin esto no se podía: la
   * segunda llamada empezaba cancelando lo pendiente y se comía a la primera.
   *
   * Los tres valores por defecto dejan el comportamiento EXACTAMENTE como
   * estaba, así que las llamadas de siempre no cambian ni una coma.
   *
   *  · `sinCancelar`  — no cancela lo pendiente: esta entrega va DETRÁS de otra.
   *  · `retrasoInicialSeg` — desde cuándo empieza a contar, para que no se
   *    solapen las burbujas de las dos.
   *  · `noEsLaUltima` — no marca `is_last`, que es lo que dispara el cierre de
   *    la postventa. Solo la última de la tanda lo marca; si lo marcaran las
   *    dos, el cierre correría dos veces.
   */
  opciones: {
    sinCancelar?: boolean;
    retrasoInicialSeg?: number;
    noEsLaUltima?: boolean;
  } = {},
  /** UPSELLS EN FILA, solo en el reenvío: de qué compra de la fila es esta entrega (un
   *  id, o "" para el upsell de siempre). Viaja en cada burbuja para que el obrero mande
   *  la de ESE producto y no la de la oferta en curso. Sin él, todo como siempre. */
  filaProducto?: string
): number {
  if (sectionHasPlaceholder(sequence)) {
    console.warn(
      `[wf:pago] secuencia de entrega "${source}" aún tiene placeholders — falta completarla en el YAML`
    );
    return 0;
  }
  // Cancelamos cualquier acción pendiente previa antes de programar la
  // nueva secuencia.
  if (opciones.sinCancelar !== true) {
    cancelPendingActionsForConvo(conversationId);
    setPendingDeliverySource(conversationId, null);
  }
  let activeSteps = sequence
    .map((step, index) => ({ step, index }))
    .filter(({ step }) => step.enabled !== false);
  if (skipLastStep && activeSteps.length > 1) {
    activeSteps = activeSteps.slice(0, -1);
  }
  if (activeSteps.length === 0) {
    /**
     * EL RESPALDO: SI LA ENTREGA DE «PAGO APROBADO» NO TIENE NINGUNA BURBUJA ENCENDIDA,
     * SE MANDA LA DEL PRODUCTO BASE.
     *
     * LO QUE PASÓ — 3 de octubre de 2026, midiendo las dos submodalidades del dueño. Con la
     * tienda vendiendo DOS opciones, la caja global de entrega NO se rellena: se queda la del
     * archivo, que él tiene con sus dos burbujas apagadas (un vídeo y el aviso del correo).
     *
     * El camino que lo destapa es una transición suya, y es real: un cliente compra con la
     * tienda en «un producto», él la cambia a dos opciones, y ese cliente PIDE OTRA VEZ su
     * material. El reenvío busca la caja global, la encuentra sin ninguna burbuja viva, y el
     * cliente se queda sin su enlace.
     *
     * ES LA TRAMPA QUE ESTE PROYECTO YA TIENE ESCRITA: «una caja que una modalidad llena y
     * otra no abre se ve igual que una caja vacía». Y la guarda de más arriba la deja pasar
     * porque pregunta si la secuencia EXISTE, no si va a salir algo — que es justo lo que
     * CLAUDE.md prohíbe: «toda guarda que decida "esto está lleno" debe preguntar por lo que
     * de verdad se va a enviar».
     *
     * POR QUÉ ES SEGURO, y es lo único que importa aquí:
     *
     *   · Solo entra con CERO burbujas que salgan. Donde hoy sale algo, esta rama no se pisa.
     *   · Y donde hoy entra, lo único que hace el bot es AVISAR. No hay envío que estropear.
     *   · Solo para «approved». El extra y las dos opciones NO caen aquí a propósito: si la
     *     entrega del extra estuviera vacía, mandar el producto base sería mandar el material
     *     equivocado, no un respaldo. Ésos siguen con la alarma de siempre.
     *   · Y LA ALARMA SE QUEDA: si el respaldo tampoco tiene nada, suena igual que hoy.
     *
     * EL MATERIAL ES EL CORRECTO, y está medido: en la tienda del dueño que vende dos
     * opciones, la entrega del producto base y la de «un producto» son EL MISMO enlace. Es lo
     * que él describe cuando dice que su producto base no cambia nunca — cambiar de
     * submodalidad solo AÑADE.
     */
    const laDelProductoBase =
      source === "approved"
        ? getActiveTwoTierOffer(loadWorkflowConfig())?.basico?.delivery
        : undefined;
    const vivas = (
      Array.isArray(laDelProductoBase) ? laDelProductoBase : []
    ).filter((step) => step.enabled !== false);
    if (vivas.length > 0 && !sectionHasPlaceholder(laDelProductoBase)) {
      console.log(
        `[wf:pago] convo ${conversationId}: la entrega "approved" no tiene ninguna burbuja encendida → mando la del producto base`
      );
      // Sin cancelar: si había algo que cancelar, lo canceló esta misma llamada más arriba.
      return scheduleDeliverySequence(
        conversationId,
        laDelProductoBase as SequenceStep[],
        source,
        sendFirstStepImmediately,
        skipLastStep,
        { ...opciones, sinCancelar: true }
      );
    }
    avisarQueNoHayEntrega(conversationId, `la entrega "${source}"`);
    return 0;
  }
  const now = Math.floor(Date.now() / 1000);
  let cumulativeDelay = Math.max(0, opciones.retrasoInicialSeg ?? 0);
  let startIndex = 0;
  // La que va encadenada detrás NUNCA manda su primera burbuja al instante: se
  // colaría por delante de la entrega anterior.
  const canSendFirstStepImmediately =
    sendFirstStepImmediately &&
    activeSteps.length > 1 &&
    opciones.sinCancelar !== true;
  if (canSendFirstStepImmediately) {
    void sendImmediateDeliveryStep(
      conversationId,
      activeSteps[0].step,
      source
    ).catch((err) => {
      console.error(
        `[wf:pago] error enviando primer paso inmediato de "${source}" a convo ${conversationId}:`,
        err
      );
    });
    cumulativeDelay = activeSteps[0].step.delay_after_sec ?? 0;
    startIndex = 1;
  }
  for (let i = startIndex; i < activeSteps.length; i++) {
    const { step, index } = activeSteps[i];
    const isLast =
      i === activeSteps.length - 1 && opciones.noEsLaUltima !== true;
    const payload: Record<string, unknown> = {
      step_index: index,
      is_last: isLast,
      source,
    };
    if (typeof filaProducto === "string") payload.fila_producto = filaProducto;
    scheduleAction(
      conversationId,
      "send_payment_approved_step",
      payload,
      now + cumulativeDelay
    );
    cumulativeDelay += step.delay_after_sec ?? 0;
  }
  console.log(
    `[wf:pago] entrega "${source}" programada para convo ${conversationId} (${activeSteps.length} pasos activos)`
  );
  nudgeDeliveryWorker();
  return cumulativeDelay;
}

export function scheduleDeliveryBySource(
  conversationId: number,
  source: DeliverySource,
  options: { skipLastStep?: boolean; sendFirstStepImmediately?: boolean } = {}
): boolean {
  const config = loadWorkflowConfig();
  const sequence =
    source === "upsell"
      ? seccionUpsell(config)?.delivery
      : source === "bioferta_b"
      ? config?.bioferta_doble?.product_b?.delivery
      : source === "bioferta_pack"
        ? config?.bioferta_doble?.pack?.delivery
        : source === "ob_combo"
          ? getOrderBumpOption("combo")?.delivery
          : source === "ob_basico"
            ? getOrderBumpOption("basico")?.delivery
            : config?.payment_approved_sequence;
  if (!sequence?.length || sectionHasPlaceholder(sequence)) {
    avisarQueNoHayEntrega(conversationId, `la entrega "${source}"`);
    return false;
  }
  scheduleDeliverySequence(
    conversationId,
    sequence,
    source,
    options.sendFirstStepImmediately === true,
    options.skipLastStep === true
  );
  setPendingDeliverySource(conversationId, null);
  return true;
}

/**
 * BIOFERTA OFERTA DOBLE — entrega el producto del tier elegido y marca la
 * convo como pagada. "a" = producto principal (usa la
 * payment_approved_sequence); "b" = producto secundario; "pack" = los 2.
 * Si la secuencia de B/pack no está configurada, cae al producto principal
 * para no dejar al cliente sin entrega. Exportada para que el motor la use
 * cuando el cliente elige tras haber pagado el unitario.
 */
/**
 * DOBLE OFERTA — le confirma en voz alta lo que eligió antes de seguir con la
 * entrega ("¡Genial! Elegiste Perritos 🎉"), para que no se quede con la duda
 * de si el bot entendió bien. {{OPCION_ELEGIDA}} es el nombre del producto o
 * del pack.
 *
 * Va como envío inmediato y no como acción programada a propósito: lo que viene
 * detrás (la pregunta de entrega o la secuencia) empieza cancelando las
 * acciones pendientes de la conversación, así que una acción programada aquí se
 * cancelaría a sí misma. Es el mismo camino que ya usa sendBiofertaAskChoice.
 *
 * Sin texto configurado no manda nada: las configuraciones de hoy no cambian.
 */
function sendBiofertaChoiceConfirmation(
  conversationId: number,
  tier: "a" | "b" | "pack"
): void {
  const bf = loadWorkflowConfig()?.bioferta_doble;
  if (!bf || bf.choice_confirmation_enabled === false) return;
  const plantilla = pickVariant(
    bf.choice_confirmation_text_variants,
    bf.choice_confirmation_text
  );
  if (!plantilla?.trim()) return;
  const producto =
    tier === "a" ? bf.product_a : tier === "b" ? bf.product_b : bf.pack;
  const nombre = (producto?.name ?? "").trim();
  // Sin nombre de verdad no lo mandamos: "¡Genial! Elegiste Producto 1" es peor
  // que no decir nada.
  if (!nombre || (nombre.includes("<<") && nombre.includes(">>"))) return;
  const convo = getConversationById(conversationId);
  if (!convo) return;
  const texto = plantilla.replace(
    /\{\{\s*OPCION_ELEGIDA\s*\}\}/gi,
    literal(nombre)
  );
  if (!texto.trim()) return;
  void sendBotText(convo, texto);
}

/**
 * UPSELL — entrega el segundo producto. Tiene su propia secuencia; si faltara,
 * no se entrega nada y se avisa al admin: NUNCA se cae a la entrega del primer
 * producto, porque eso le mandaría dos veces lo mismo a quien acaba de pagar
 * algo distinto.
 */
export function entregarUpsell(conversationId: number): void {
  // UPSELLS EN FILA: se entrega lo que acaba de pagar ESTA conversación.
  conLaFilaDe(conversationId, () => entregarUpsellConSuFila(conversationId));
}

function entregarUpsellConSuFila(conversationId: number): void {
  const seq = seccionUpsell()?.delivery;
  setConversationState(conversationId, "payment_approved");
  if (!seq || seq.length === 0 || sectionHasPlaceholder(seq)) {
    console.error(
      `[wf:upsell] convo ${conversationId}: PAGÓ el segundo producto y su entrega no está configurada`
    );
    void notifyAdmin(
      `⚠️ UPSELL SIN ENTREGA: convo ${conversationId} pagó el segundo producto pero su entrega está vacía o con comodines. Revísalo YA.`
    );
    return;
  }
  if (maybeStartDeliveryPreference(conversationId, "upsell")) return;
  scheduleDeliverySequence(conversationId, seq, "upsell");
}

export function deliverBiofertaTier(
  conversationId: number,
  tier: "a" | "b" | "pack"
): void {
  const config = loadWorkflowConfig();
  setBiofertaChoice(conversationId, tier);
  setConversationState(conversationId, "payment_approved");
  sendBiofertaChoiceConfirmation(conversationId, tier);
  if (tier === "a") {
    // El producto A ahora puede tener SU PROPIA entrega, como el B y el pack.
    // Antes siempre caía a la entrega principal, que comparte con Lineal y
    // Order Bump: cambiarla ahí le cambiaba la entrega a las otras tiendas.
    // Si no está configurada, sigue cayendo a la principal como hasta hoy.
    const seq = config?.bioferta_doble?.product_a?.delivery;
    if (seq && seq.length > 0 && !sectionHasPlaceholder(seq)) {
      if (maybeStartDeliveryPreference(conversationId, "bioferta_a")) return;
      scheduleDeliverySequence(conversationId, seq, "bioferta_a");
      return;
    }
  } else if (tier === "b") {
    const seq = config?.bioferta_doble?.product_b?.delivery;
    if (seq && seq.length > 0 && !sectionHasPlaceholder(seq)) {
      if (maybeStartDeliveryPreference(conversationId, "bioferta_b")) return;
      scheduleDeliverySequence(conversationId, seq, "bioferta_b");
      return;
    }
  } else if (tier === "pack") {
    const seq = config?.bioferta_doble?.pack?.delivery;
    if (seq && seq.length > 0 && !sectionHasPlaceholder(seq)) {
      if (maybeStartDeliveryPreference(conversationId, "bioferta_pack")) return;
      scheduleDeliverySequence(conversationId, seq, "bioferta_pack");
      return;
    }
  }
  // LO MISMO QUE EN ORDER BUMP: si ese puesto lo llena un producto elegido, la
  // entrega general no vale como red, porque guarda la de otro producto.
  const fuenteBio =
    tier === "a" ? "bioferta_a" : tier === "b" ? "bioferta_b" : "bioferta_pack";
  if (laEntregaLaLlenaUnProducto(fuenteBio)) {
    avisarQueNoHayEntrega(
      conversationId,
      tier === "a"
        ? "el Producto 1"
        : tier === "b"
          ? "el Producto 2"
          : "el Pack"
    );
    return;
  }
  // Sin entrega propia configurada (o con comodines sin rellenar) → producto
  // principal, así el cliente nunca queda sin nada.
  schedulePaymentApprovedSequence(conversationId);
}

/**
 * ORDER BUMP — entrega la opción elegida (combo/básico) y marca la convo como
 * pagada. Si la entrega de esa opción no está lista (vacía o con placeholders),
 * cae al producto principal para no dejar al cliente sin nada.
 */
export function deliverOrderBumpTier(
  conversationId: number,
  choice: "combo" | "basico"
): void {
  const option = getOrderBumpOption(choice);
  setConversationState(conversationId, "payment_approved");
  const fuente = choice === "combo" ? "ob_combo" : "ob_basico";
  const seq = option?.delivery;
  if (seq && seq.length > 0 && !sectionHasPlaceholder(seq)) {
    if (maybeStartDeliveryPreference(conversationId, fuente)) return;
    scheduleDeliverySequence(conversationId, seq, fuente, true);
    return;
  }
  // SI ESTA OPCIÓN LA LLENA UN PRODUCTO ELEGIDO, NO SE CAE A LA GENERAL.
  //
  // La entrega general guarda lo del producto que se vendía antes. Caer ahí
  // sería mandarle a la clienta el archivo de otro producto, que es peor que no
  // mandar nada: cree que ya tiene lo suyo y se va. Se avisa y se para.
  if (laEntregaLaLlenaUnProducto(fuente)) {
    avisarQueNoHayEntrega(
      conversationId,
      `la opción ${choice === "combo" ? "Full" : "Básico"}`
    );
    return;
  }
  schedulePaymentApprovedSequence(conversationId);
}

export interface AccumulatedOrderBumpResolution {
  approved: boolean;
  paidTotalSoles: number;
  priceSoles: number;
  missingSoles: number;
}

/** Confirma una opcion usando dinero que ya fue registrado. */
export function resolveAccumulatedOrderBumpChoice(
  conversationId: number,
  choice: "combo" | "basico"
): AccumulatedOrderBumpResolution | null {
  const convo = getConversationById(conversationId);
  if (!convo) return null;
  const discountActive = isDiscountActiveForConversation(convo);
  const priceSoles = getOrderBumpPriceSoles(
    choice,
    discountActive,
    convo.phone
  );
  if (priceSoles === null) return null;

  const paidTotalSoles = convo.paid_total_cents / 100;
  const missingSoles = Math.max(0, priceSoles - paidTotalSoles);
  setOrderBumpChoice(conversationId, choice);
  lockExpectedPriceForConvo(convo, priceSoles, `two_tier:${choice}`, discountActive);

  if (missingSoles > 0) {
    setConversationState(conversationId, "payment_done");
    return { approved: false, paidTotalSoles, priceSoles, missingSoles };
  }

  deliverOrderBumpTier(conversationId, choice);
  setPaidAt(conversationId, Math.floor(Date.now() / 1000));
  resetPaymentAttemptsFailed(conversationId);

  const productName =
    getOrderBumpOption(choice)?.name?.trim() || getProductName();
  const customerName = convo.client_name ?? convo.name ?? "Sin nombre";
  const countryCode = getEffectiveCountryCode(convo.phone);
  const purchaseCurrency =
    convo.locked_price_currency ?? getCountryInfo(countryCode).currency;
  const paidTotalLabel = formatCurrencyAmount(
    paidTotalSoles,
    countryCode,
    purchaseCurrency
  );
  void sendPurchaseEvent({
    conversationId,
    userData: buildMessagingUserData({
      channel: convo.channel,
      phone: convo.phone,
      firstName: convo.client_name ?? convo.name,
      email: convo.client_email,
      ctwa_clid: convo.ctwa_clid,
    }),
    value: paidTotalSoles,
    currency: purchaseCurrency,
  });
  if (convo.channel !== "test") void notifyAdmin(
    `Venta realizada\n\n` +
      `Numero: ${convo.phone}\n` +
      `Nombre: ${customerName}\n` +
      `Monto: ${paidTotalLabel}\n` +
      `Moneda Meta: ${purchaseCurrency}\n` +
      `Asunto: El usuario adquirio ${productName} con un pago acumulado de ${paidTotalLabel}.`
  );
  void syncLeadStatus(conversationId);
  console.log(
    `[wf:pago] convo ${conversationId} APROBADO tras confirmar "${choice}" (total: ${paidTotalLabel})`
  );
  return { approved: true, paidTotalSoles, priceSoles, missingSoles: 0 };
}

/** Pregunta editable cuando el cliente pago el unitario y aun no eligio. Si
 *  use_buttons esta activo, la pregunta va con botones (Producto 1 / 2). */
async function sendBiofertaAskChoice(convo: ConversationRow): Promise<void> {
  const bf = loadWorkflowConfig()?.bioferta_doble;
  const text =
    pickVariant(bf?.ask_choice_text_variants, bf?.ask_choice_text) ?? "";
  if (bf?.use_buttons) {
    const cuerpo = cuerpoDeBotones(
      text,
      "doble oferta: pregunta de cuál producto compró"
    );
    const titulos = titulosDeBotones(
      [bf.product_a?.name, bf.product_b?.name],
      "doble oferta: nombres de los 2 productos"
    );
    // Sin texto o sin nombres no mandamos botones rotos: cae a la pregunta en
    // texto plano, que el cliente puede responder escribiendo el nombre.
    if (cuerpo && titulos) {
      await sendBotButtons(convo, cuerpo, [
        { id: "bf_a", title: titulos[0] },
        { id: "bf_b", title: titulos[1] },
      ]);
      return;
    }
  }
  if (text.trim()) await sendBotText(convo, text);
}
