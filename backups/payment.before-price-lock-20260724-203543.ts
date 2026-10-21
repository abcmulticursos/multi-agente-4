import {
  addToPaidTotal,
  cancelPendingActionsForConvo,
  getConversationById,
  getRecentUserMessages,
  incrementPaymentAttemptsFailed,
  resetPaymentAttemptsFailed,
  scheduleAction,
  setBiofertaChoice,
  setConversationState,
  setCountedReceipts,
  setOrderBumpChoice,
  setPaidAt,
  setSelectedPaymentMethod,
  type ConversationRow,
} from "@/lib/db";
import {
  detectBiofertaChoice,
  getEffectiveCountryCode,
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
  isOrderBumpConversationQuestion,
  loadWorkflowConfig,
  pickVariant,
  sectionHasPlaceholder,
  inferTwoTierChoiceFromContext,
  type SequenceStep,
} from "@/lib/workflow/config";
import {
  sendBotButtons,
  sendBotMediaFromDrive,
  sendBotText,
} from "@/lib/workflow/sender";
import { buildMessagingUserData, sendPurchaseEvent } from "@/lib/meta/conversions";
import { notifyAdmin } from "@/lib/notifications";
import { syncLeadStatus } from "@/lib/leads-sync";
import { getCountryInfo } from "@/lib/countries";

/** Modalidad de 2 opciones (combo/básico) activa: order bump O doble oferta 2
 *  productos. Comparten toda la lógica de validación y entrega por opción, y son
 *  mutuamente excluyentes, así que aquí se tratan igual. */
function isTwoTierActive(): boolean {
  return isOrderBumpActive() || isDobleOfertaActive();
}

function formatSoles(amount: number): string {
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
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
      "When the customer sends an image of a payment receipt (Yape, Plin, BCP, transfer), USE this tool to register it. Extract the exact amount and the method. If it's Yape or Plin, also extract the recipient's name (it may be partial like 'Alberto S***'). ALSO extract receipt_date: ANY date visible on the receipt, in ANY format and EVEN WITHOUT the word 'Fecha' (e.g. '03/06/21', '14/06/2026 10:32', '14 jun 2026'). Leave it empty ONLY if there is truly no date anywhere (e.g. a promotional flyer). The system validates and adds to previous amounts if they were partial.",
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
            "Name of the payment recipient exactly as it appears on the receipt (may be partial, e.g. 'Alberto S***'). Only applies to Yape/Plin. For BCP/transfer, omit.",
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
  const price = getOrderBumpPriceSoles(option, discountActive) ?? 0;
  const name = getOrderBumpOption(option)?.name?.trim() || option;
  const latestText = getRecentUserMessages(conversationId, 1)[0]?.content ?? "";
  if (isOrderBumpConversationQuestion(latestText)) {
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
      return {
        ok: true,
        option,
        option_name: name,
        price_soles: resolution.priceSoles,
        instruction: `Registrado "${name}" por S/.${resolution.priceSoles}. Ya abonó S/.${resolution.paidTotalSoles}; faltan S/.${resolution.missingSoles}. Pídele completar ese monto y enviar el comprobante.`,
      };
    }
  }

  setOrderBumpChoice(conversationId, option);
  setConversationState(conversationId, "payment_done");
  if (hasDirectPaymentContent()) {
    setSelectedPaymentMethod(conversationId, "yape");
    return {
      ok: true,
      option,
      option_name: name,
      price_soles: price,
      instruction: `Registrado "${name}" por S/.${price}. Responde con UNA sola linea calida y breve confirmando la eleccion y termina con el marcador <<REENVIAR_PAGO>> en una linea aparte. El SISTEMA enviara los datos directos editables con el monto correcto. NO pidas metodo de pago y NUNCA escribas numeros de cuenta tu.`,
    };
  }
  if (convo.selected_payment_method) {
    const methodLabel =
      convo.selected_payment_method === "bcp_transferencia"
        ? "BCP/transferencia"
        : convo.selected_payment_method === "efectivo"
          ? "efectivo"
          : convo.selected_payment_method === "plin"
            ? "Plin"
            : "Yape";
    return {
      ok: true,
      option,
      option_name: name,
      price_soles: price,
      instruction: `Registrado "${name}" por S/.${price}. El cliente ya había elegido ${methodLabel}; AHORA hay que ENVIARLE los datos de ${methodLabel} con el NUEVO monto (S/.${price}). Responde con UNA sola línea cálida y breve (ej. "¡Perfecto! Aquí van los datos para tu ${name} 😊") y termina con el marcador <<REENVIAR_PAGO>> en una línea aparte — el SISTEMA enviará los datos exactos de ${methodLabel} con el monto correcto. NUNCA escribas números de cuenta tú, NUNCA digas "en un momento te comparto", "te paso en un rato" ni "más arriba".`,
    };
  }
  return {
    ok: true,
    option,
    option_name: name,
    price_soles: price,
    instruction: `Registrado "${name}" por S/.${price}. Confirma con calidez la elección y pide el MÉTODO DE PAGO (Yape, Plin o BCP). NO escribas números de cuenta — el sistema los envía cuando el cliente elija el método.`,
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
  if (newCount >= 3) {
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
  if (isTwoTierActive()) {
    const recentChoice = getRecentUserMessages(conversationId, 10)
      .map((message) =>
        inferTwoTierChoiceFromContext(
          message.content,
          convo.order_bump_choice,
          config
        )
      )
      .find((choice) => choice === "combo" || choice === "basico");
    if (recentChoice && recentChoice !== obChoice) {
      console.log(
        `[wf:pago] convo ${conversationId}: sincronizo order bump "${obChoice ?? "ninguno"}" → "${recentChoice}" según intención reciente`
      );
      setOrderBumpChoice(conversationId, recentChoice);
      obChoice = recentChoice;
    }
  }

  // Misma reconciliación para Doble Oferta: la elección explícita más reciente
  // manda sobre un valor anterior, incluso si llegó en ráfaga con la imagen.
  let bioChoice = convo.bioferta_choice;
  if (!isTwoTierActive() && isBiofertaActive()) {
    const recentChoice = getRecentUserMessages(conversationId, 10)
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

  // Order bump: si el cliente eligió una opción (combo/básico), el precio
  // esperado es el de ESA opción.
  if (
    isTwoTierActive() &&
    (obChoice === "combo" || obChoice === "basico")
  ) {
    const optionPrice = getOrderBumpPriceSoles(
      obChoice,
      discountActive
    );
    if (optionPrice !== null) priceSoles = optionPrice;
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
    if (biofertaPrice !== null) priceSoles = biofertaPrice;
  }

  const baseResult = (
    overrides: Partial<RegisterPaymentResult>
  ): RegisterPaymentResult => ({
    status: "REJECTED",
    paid_total_soles: 0,
    course_price_soles: priceSoles,
    missing_soles: priceSoles,
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
    ? getOrderBumpPriceSoles("combo", discountActive)
    : null;
  const isApprovedUpgradeToCombo =
    convo.state === "payment_approved" &&
    isTwoTierActive() &&
    comboPriceForApprovedUpgrade !== null &&
    convo.paid_total_cents < Math.round(comboPriceForApprovedUpgrade * 100);
  if (isApprovedUpgradeToCombo) {
    setOrderBumpChoice(conversationId, "combo");
    obChoice = "combo";
    priceSoles = comboPriceForApprovedUpgrade;
  }
  if (convo.state === "payment_approved" && !isApprovedUpgradeToCombo) {
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
  if (isTwoTierActive() && !obChoice) {
    return baseResult({
      reason:
        "El cliente aún no eligió una de las 2 opciones del order bump. Pídele que toque uno de los 2 botones (o escriba el nombre de la opción) ANTES de validar el pago — el precio depende de la opción elegida.",
    });
  }

  // Validación de FECHA del comprobante (configurable, payment_validation.
  // require_receipt_date). Si está activada, el comprobante debe mostrar una
  // fecha (cualquiera; NO se compara). Filtra afiches/imágenes reenviadas que
  // tienen monto pero no son comprobantes reales.
  if (
    config?.payment_validation?.require_receipt_date &&
    !(args.receipt_date ?? "").trim()
  ) {
    const reason =
      "Para validar tu pago necesito ver la FECHA en el comprobante. Las imágenes sin fecha (como un afiche) no se aceptan — por favor envíame la foto del comprobante real.";
    const failed_attempts_count = trackFailedPaymentAttempt(convo, reason);
    return baseResult({ reason, failed_attempts_count });
  }

  // Validación de receptor para Yape/Plin
  if (args.payment_method === "yape" || args.payment_method === "plin") {
    const countryCode = getEffectiveCountryCode(convo.phone, config);
    const expectedPrefix = (
      config?.payment_profiles_by_country?.[countryCode]?.payment_validation
        ?.yape_recipient_name_starts_with ??
      config?.payment_validation?.yape_recipient_name_starts_with ??
      ""
    )
      .trim()
      .toLowerCase();
    const got = (args.recipient_name ?? "").trim().toLowerCase();
    if (expectedPrefix && !got) {
      const reason = `Para ${args.payment_method} necesito ver el nombre del receptor en el comprobante`;
      const failed_attempts_count = trackFailedPaymentAttempt(convo, reason);
      return baseResult({ reason, failed_attempts_count });
    }
    if (expectedPrefix && !got.startsWith(expectedPrefix)) {
      const expectedDisplay =
        expectedPrefix.charAt(0).toUpperCase() + expectedPrefix.slice(1);
      const reason = `El comprobante muestra que el pago fue a "${
        args.recipient_name
      }", pero debe ser a un nombre que empiece con "${expectedDisplay}"`;
      const failed_attempts_count = trackFailedPaymentAttempt(convo, reason);
      return baseResult({ reason, failed_attempts_count });
    }
  }
  // Para BCP/transferencia: solo el monto se valida (los tickets no traen
  // nombre fiable). El bot debe verificar esto en el prompt.

  // IDEMPOTENCIA — no contar dos veces el MISMO comprobante. Armamos una
  // "huella" en capas con lo disponible (número de operación → fecha+hora+monto
  // → id del mensaje-imagen). Si la huella YA fue contada, NO volvemos a sumar:
  // devolvemos el estado real (p. ej. PARCIAL) sin entregar de más. Una
  // operación/fecha NUEVA sí se cuenta (permite completar un pago parcial). Se
  // limpia con /restart. La capa del id de imagen es la red de seguridad: aunque
  // el voucher sea ilegible, evita que el LLM re-cuente la MISMA imagen.
  const cents = Math.round(args.amount_soles * 100);
  const normalizeFp = (s: string): string =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Mn}/gu, "")
      .replace(/[^a-z0-9]+/g, "");
  const latestImage = getRecentUserMessages(conversationId, 5).find(
    (m) => m.media_type === "image"
  );
  const fingerprints: string[] = [];
  const opFp = normalizeFp(args.operation_number ?? "");
  if (opFp.length >= 4) fingerprints.push(`op:${opFp}`);
  const dateFp = normalizeFp(args.receipt_date ?? "");
  if (dateFp.length >= 4) fingerprints.push(`dt:${dateFp}|amt:${cents}`);
  if (latestImage) fingerprints.push(`img:${latestImage.id}`);
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
      reason:
        "Este comprobante ya estaba registrado y el material de esta compra ya fue entregado. NO vuelvas a enviar el enlace ni el regalo; responde con naturalidad y continúa la conversación.",
    });
  }

  // Un excedente sobre la opcion economica es ambiguo: puede ser un error o
  // un cambio al producto superior. Conservamos el abono, pero no entregamos
  // nada hasta que el cliente confirme. Nombres y precios salen del editor.
  if (
    isTwoTierActive() &&
    (obChoice === "combo" || obChoice === "basico")
  ) {
    const choices = (["combo", "basico"] as const)
      .map((choice) => ({
        choice,
        price: getOrderBumpPriceSoles(choice, discountActive),
      }))
      .filter(
        (item): item is { choice: "combo" | "basico"; price: number } =>
          item.price !== null
      )
      .sort((a, b) => a.price - b.price);
    const current = choices.find((item) => item.choice === obChoice);
    const higher = current
      ? choices.find((item) => item.price > current.price)
      : undefined;
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
      const currentPriceText = formatSoles(current.price);
      const paidTotalText = formatSoles(paidTotalSoles);
      const lowerPriceText = formatSoles(lower.price);
      const missingText = formatSoles(missingSoles);
      console.log(
        `[wf:pago] convo ${conversationId}: eligio "${current.choice}" (S/.${current.price}) pero abono S/.${paidTotalSoles}, que cubre "${lower.choice}" (S/.${lower.price}); espero confirmacion`
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
          `Elegiste la opcion de S/.${currentPriceText}, pero pagaste S/.${paidTotalText}. ` +
          `Fue una confusion y vas a completar S/.${missingText}, o prefieres quedarte con la opcion de S/.${lowerPriceText}?`,
        reason:
          `El cliente habia elegido la opcion de S/.${currentPriceText}, ` +
          `pero su pago acumulado es S/.${paidTotalText}, que cubre "${lowerName}" por S/.${lowerPriceText}. ` +
          `No confirmes ni entregues todavia. Preguntale si fue confusion y completara S/.${missingText}, o si prefiere quedarse con la opcion de S/.${lowerPriceText}.`,
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
      console.log(
        `[wf:pago] convo ${conversationId}: acumulado S/.${
          paidTotalSoles
        } supera "${current.choice}" (S/.${current.price}); espero confirmacion`
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
          `Veo que elegiste ${currentName} por S/.${current.price}, pero abonaste S/.${paidTotalSoles}. ` +
          `¿El monto adicional fue un error o cambiaste de opinión y prefieres ${higherName} por S/.${higher.price}?` +
          (missingSoles > 0
            ? ` Si deseas ${higherName}, faltaría completar S/.${missingSoles}.`
            : ""),
        reason:
          `El cliente habia elegido "${currentName}" por S/.${current.price}, ` +
          `pero su pago acumulado es S/.${paidTotalSoles}. No confirmes ni entregues todavia. ` +
          `Preguntale naturalmente si el excedente fue un error o si cambio de opinion y desea "${higherName}" por S/.${higher.price}.` +
          (missingSoles > 0
            ? ` Si confirma "${higherName}", le faltaran S/.${missingSoles}.`
            : ` Si confirma "${higherName}", el monto ya esta completo.`),
      };
    }
  }

  const priceCents = Math.round(priceSoles * 100);

  if (newTotalCents >= priceCents) {
    // ¡APROBADO! Ruteo de ENTREGA según la Bioferta Oferta Doble.
    //  - Bioferta APAGADA (packPrice === null) → entrega normal de hoy.
    //  - Pagó el monto del PACK → entrega el pack.
    //  - Pagó el UNITARIO → entrega el producto que eligió; si aún no eligió,
    //    pasamos a awaiting_bioferta_choice y le preguntamos cuál quiere.
    const packPrice = getBiofertaPackPriceSoles(discountActive);
    if (
      isTwoTierActive() &&
      (obChoice === "combo" || obChoice === "basico")
    ) {
      // ORDER BUMP: entrega la opción elegida (combo/básico).
      deliverOrderBumpTier(conversationId, obChoice);
    } else if (isBiofertaActive()) {
      if (bioChoice === "pack") {
        deliverBiofertaTier(conversationId, "pack");
      } else if (bioChoice === "a" || bioChoice === "b") {
        deliverBiofertaTier(conversationId, bioChoice);
      } else if (packPrice !== null && newTotalCents / 100 >= packPrice) {
        // Compatibilidad: si no expresó opción pero pagó exactamente el monto
        // suficiente del pack, entregamos ambos.
        deliverBiofertaTier(conversationId, "pack");
      } else {
        setConversationState(conversationId, "awaiting_bioferta_choice");
        void sendBiofertaAskChoice(convo);
      }
    } else if (isTwoTierActive()) {
      // Order bump / doble oferta activo pero SIN elección registrada (caso
      // raro: pago aprobado sin que se guardara combo/básico). Entregamos el
      // BÁSICO (producto base) → la entrega en estas modalidades obedece SIEMPRE
      // la pestaña de la oferta, nunca el cajón "Pago Aprobado". deliverOrderBumpTier
      // ya fija el estado y, si el básico estuviera vacío, cae al respaldo.
      deliverOrderBumpTier(conversationId, "basico");
    } else {
      schedulePaymentApprovedSequence(conversationId);
      setConversationState(conversationId, "payment_approved");
    }
    // Sello de fecha de la venta (solo para el panel de ventas; no afecta
    // el flujo). Se graba en el momento exacto de la aprobación.
    setPaidAt(conversationId, Math.floor(Date.now() / 1000));
    // Reseteamos el contador de fallos por si en intentos previos se
    // habia incrementado pero ahora cerró bien.
    resetPaymentAttemptsFailed(conversationId);
    const paidTotalSoles = newTotalCents / 100;
    console.log(
      `[wf:pago] convo ${conversationId} APROBADO (total: S/.${paidTotalSoles})`
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
      currency: getCountryInfo(getEffectiveCountryCode(convo.phone)).currency,
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
    void notifyAdmin(
      `🛒 *Venta Realizada*: ‼️🫰🏼💵\n\n` +
        `Numero: ${convo.phone}\n` +
        `Nombre: ${customerName}\n` +
        `Asunto: El usuario acaba de adquirir ${purchasedProduct} y ha realizado una transacción a través de ${args.payment_method} por S/.${paidTotalSoles}.`
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
    `[wf:pago] convo ${conversationId} PARCIAL (total: S/.${
      newTotalCents / 100
    } / S/.${priceSoles})`
  );
  return {
    status: "PARTIAL",
    paid_total_soles: newTotalCents / 100,
    course_price_soles: priceSoles,
    missing_soles: (priceCents - newTotalCents) / 100,
  };
}

/**
 * Programa la secuencia "pago aprobado" (video + caption + lo que sea
 * que el operador haya configurado en el YAML) — PRODUCTO PRINCIPAL.
 */
function schedulePaymentApprovedSequence(conversationId: number): void {
  const config = loadWorkflowConfig();
  if (!config?.payment_approved_sequence) {
    console.warn(
      `[wf:pago] payment_approved_sequence no definido en config — pago aprobado pero sin secuencia que disparar`
    );
    return;
  }
  scheduleDeliverySequence(
    conversationId,
    config.payment_approved_sequence,
    "approved"
  );
}

/**
 * REENVÍO de material a un cliente que YA PAGÓ y pide su enlace de nuevo (lo
 * borró, lo perdió, no lo encuentra). Reenvía la MISMA secuencia de pago
 * aprobado (video + enlace REAL + pedido de correo) — el SISTEMA la manda, el
 * LLM nunca inventa el enlace. Devuelve false si la convo NO figura como
 * pagada (no se reenvía material a quien no compró).
 */
export function resendApprovedMaterial(convo: ConversationRow): boolean {
  const paidStates = new Set([
    "payment_approved",
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
    `[wf:pago] convo ${convo.id}: REENVÍO de material (ya pagó) — reenviando secuencia aprobada`
  );
  const config = loadWorkflowConfig();
  if (
    convo.order_bump_choice === "combo" ||
    convo.order_bump_choice === "basico"
  ) {
    const choice = convo.order_bump_choice;
    // Modalidad ACTIVA (order bump O doble oferta), NO order_bump fijo — si no,
    // en doble oferta reenviaba la entrega de order bump (grafismo).
    const sequence = getOrderBumpOption(choice)?.delivery;
    if (sequence?.length && !sectionHasPlaceholder(sequence)) {
      scheduleDeliverySequence(
        convo.id,
        sequence,
        choice === "combo" ? "ob_combo" : "ob_basico"
      );
      return true;
    }
  }
  if (convo.bioferta_choice === "b" || convo.bioferta_choice === "pack") {
    const choice = convo.bioferta_choice;
    const sequence =
      choice === "b"
        ? config?.bioferta_doble?.product_b?.delivery
        : config?.bioferta_doble?.pack?.delivery;
    if (sequence?.length && !sectionHasPlaceholder(sequence)) {
      scheduleDeliverySequence(
        convo.id,
        sequence,
        choice === "b" ? "bioferta_b" : "bioferta_pack"
      );
      return true;
    }
  }
  schedulePaymentApprovedSequence(convo.id);
  return true;
}

async function sendImmediateDeliveryStep(
  conversationId: number,
  step: SequenceStep
): Promise<void> {
  if (step.enabled === false) return;
  const convo = getConversationById(conversationId);
  if (!convo) return;

  if (step.type === "text") {
    const bodyText = pickVariant(step.body_variants, step.body) ?? "";
    if (bodyText.trim()) await sendBotText(convo, bodyText);
    return;
  }

  const captionRaw =
    step.type !== "audio"
      ? pickVariant(
          (step as { caption_variants?: string[] }).caption_variants,
          (step as { caption?: string }).caption
        )
      : undefined;
  const caption = captionRaw ? captionRaw : undefined;
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
  source: "approved" | "bioferta_b" | "bioferta_pack" | "ob_combo" | "ob_basico",
  sendFirstStepImmediately = false
): void {
  if (sectionHasPlaceholder(sequence)) {
    console.warn(
      `[wf:pago] secuencia de entrega "${source}" aún tiene placeholders — falta completarla en el YAML`
    );
    return;
  }
  // Cancelamos cualquier acción pendiente previa antes de programar la
  // nueva secuencia.
  cancelPendingActionsForConvo(conversationId);
  const activeSteps = sequence
    .map((step, index) => ({ step, index }))
    .filter(({ step }) => step.enabled !== false);
  if (activeSteps.length === 0) {
    console.warn(
      `[wf:pago] entrega "${source}" no tiene pasos activos — no programo`
    );
    return;
  }
  const now = Math.floor(Date.now() / 1000);
  let cumulativeDelay = 0;
  let startIndex = 0;
  const canSendFirstStepImmediately =
    sendFirstStepImmediately && activeSteps.length > 1;
  if (canSendFirstStepImmediately) {
    void sendImmediateDeliveryStep(conversationId, activeSteps[0].step).catch((err) => {
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
    const isLast = i === activeSteps.length - 1;
    const payload: Record<string, unknown> = {
      step_index: index,
      is_last: isLast,
      source,
    };
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
}

/**
 * BIOFERTA OFERTA DOBLE — entrega el producto del tier elegido y marca la
 * convo como pagada. "a" = producto principal (usa la
 * payment_approved_sequence); "b" = producto secundario; "pack" = los 2.
 * Si la secuencia de B/pack no está configurada, cae al producto principal
 * para no dejar al cliente sin entrega. Exportada para que el motor la use
 * cuando el cliente elige tras haber pagado el unitario.
 */
export function deliverBiofertaTier(
  conversationId: number,
  tier: "a" | "b" | "pack"
): void {
  const config = loadWorkflowConfig();
  setBiofertaChoice(conversationId, tier);
  setConversationState(conversationId, "payment_approved");
  if (tier === "b") {
    const seq = config?.bioferta_doble?.product_b?.delivery;
    if (seq && seq.length > 0 && !sectionHasPlaceholder(seq)) {
      scheduleDeliverySequence(conversationId, seq, "bioferta_b");
      return;
    }
  } else if (tier === "pack") {
    const seq = config?.bioferta_doble?.pack?.delivery;
    if (seq && seq.length > 0 && !sectionHasPlaceholder(seq)) {
      scheduleDeliverySequence(conversationId, seq, "bioferta_pack");
      return;
    }
  }
  // tier "a", o B/pack sin configurar / con placeholders → producto principal
  // (así el cliente nunca queda sin entrega).
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
  const seq = option?.delivery;
  if (seq && seq.length > 0 && !sectionHasPlaceholder(seq)) {
    scheduleDeliverySequence(
      conversationId,
      seq,
      choice === "combo" ? "ob_combo" : "ob_basico",
      true
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
    discountActive
  );
  if (priceSoles === null) return null;

  const paidTotalSoles = convo.paid_total_cents / 100;
  const missingSoles = Math.max(0, priceSoles - paidTotalSoles);
  setOrderBumpChoice(conversationId, choice);

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
    currency: getCountryInfo(getEffectiveCountryCode(convo.phone)).currency,
  });
  void notifyAdmin(
    `Venta realizada\n\n` +
      `Numero: ${convo.phone}\n` +
      `Nombre: ${customerName}\n` +
      `Asunto: El usuario adquirio ${productName} con un pago acumulado de S/.${paidTotalSoles}.`
  );
  void syncLeadStatus(conversationId);
  console.log(
    `[wf:pago] convo ${conversationId} APROBADO tras confirmar "${choice}" (total: S/.${paidTotalSoles})`
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
    const a = bf.product_a?.name?.trim() || "Producto 1";
    const b = bf.product_b?.name?.trim() || "Producto 2";
    await sendBotButtons(convo, text.trim() || "¿Cuál compraste?", [
      { id: "bf_a", title: a },
      { id: "bf_b", title: b },
    ]);
    return;
  }
  if (text.trim()) await sendBotText(convo, text);
}
