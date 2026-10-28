/**
 * LA IA DENTRO DEL TABLERO: contesta lo que el cliente escribe fuera del guion y lo devuelve a su
 * ficha. Es la rosca 8 del plan: solo sabe lo que el cliente YA vio (la conversación misma) y
 * los montos de su cobro abierto; nunca otro precio.
 *
 * No usa el cerebro del motor de siempre a propósito: ese lleva las órdenes de cada modalidad
 * (elegir método, datos de pago, marcadores como <<METODOS_PAGO>>) y en el tablero no hay nada
 * de eso. Si las recibiera, mandaría al cliente a una venta que el tablero no está haciendo.
 */
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { ConversationRow } from "@/lib/db";
import { getClient } from "@/lib/openrouter";
import { sendChunkedBotText } from "@/lib/workflow/engine";
import { loadWorkflowConfig } from "@/lib/workflow/config";
import { ultimosMensajes } from "./lector";
import { CEREBRO_DE_FABRICA } from "./datos";
import { SYSTEM_PROMPT } from "@/lib/system-prompt";
import { NOTIFY_ADVISOR_TOOL, NOTIFY_EMERGENCY_TOOL, executeNotifyAdvisor, executeNotifyEmergency } from "@/lib/workflow/emergency";

/** Lo que la IA sabe de un producto YA PRESENTADO al cliente (sale de su ficha en Productos). */
export interface ProductoParaLaIA {
  nombre: string;
  /** Su precio para este cliente, ya escrito con su moneda («S/ 10»). */
  precio?: string;
  /** Su precio anterior/tachado, si lo tiene. */
  antes?: string;
  contenido?: string;
  regalos?: string;
  /** Ya lo compró. */
  comprado?: boolean;
}

export interface ContextoDeLaIA {
  /** Lo que el cliente tiene delante: el texto de la última pregunta del bot, si la hay. */
  preguntaPendiente?: string;
  /** Los únicos montos que la IA puede nombrar (su cobro abierto y los precios de lo presentado). */
  montosPermitidos: number[];
  moneda?: string;
  /** Lo que acaba de pasar y la IA debe decir con sus palabras (p. ej. «pago recibido»). */
  nota?: string;
  /** Si ya se le entregó algo: la IA puede reenviarlo si el cliente dice que no le llegó. */
  reenviar?: () => Promise<void>;
  /**
   * LOS PRODUCTOS QUE YA SE LE PRESENTARON (23/10/2026). La IA habla SOLO de éstos: el que todavía
   * no se presentó no existe para ella, y así el producto oculto sigue oculto hasta su intro.
   */
  productos?: ProductoParaLaIA[];
  /** El dialecto del país del cliente (el mismo que usa el motor de siempre). */
  dialecto?: string;
  /** Con un cobro abierto y el método ya elegido: la IA puede reenviar los datos de pago. */
  reenviarDatos?: () => Promise<void>;
  /**
   * LAS MUESTRAS QUE PUEDE ENVIAR (24/10/2026): las de la galería de los productos ya presentados,
   * que aún no se le enviaron. Cada una con su «cuándo enviarla», que escribe el dueño.
   */
  muestras?: Array<{ id: string; producto: string; tema: string; cuando?: string }>;
  enviarMuestras?: (ids: string[]) => Promise<number>;
  /** EL CEREBRO GENERAL del tablero (vacío = el de fábrica, `CEREBRO_DE_FABRICA`). */
  cerebroGeneral?: string;
  /** EL CEREBRO DE ESTA ETAPA: las instrucciones de la ficha donde está el cliente. */
  instrucciones?: string;
  /**
   * LO QUE SE LE ESTÁ OFRECIENDO AHORA (el producto de la ficha donde está). Para que «¿este es
   * otro?» se entienda por la etapa: el que se ofrece ahora, no el que ya compró.
   */
  ofreciendoAhora?: string;
  /**
   * «ENVÍAMELO A MI CORREO» (24/10/2026): ya recibió algo y lo pide por correo. Devuelve lo que la
   * IA debe decirle después (pedirle la dirección, o que ya se envió).
   */
  pedirCorreo?: () => Promise<string | null>;
  /**
   * «QUIERO COMPLETAR PARA EL OTRO»: ya compró uno y hay en la ruta un cobro con upgrade para el
   * otro. Lo lleva a ese cobro (sus burbujas o los datos le llegan de ahí).
   */
  completar?: { para: string; ir: () => Promise<void> };
  /**
   * LA ETAPA (25/10/2026), para cerrar como la venta de siempre: «venta» (lo que se le ofrece aún no
   * lo compró), «datos» (ya tiene los datos de pago y se espera su comprobante) o «postventa».
   */
  etapa?: "venta" | "datos" | "postventa";
  /** Tus textos de postventa (cómo usar la entrega, acceso de por vida…), solo después de comprar. */
  postventa?: string;
  /** El bot añadirá él mismo la oferta de ver las imágenes tras esta respuesta: la IA no la escribe. */
  noOfrezcasImagenes?: boolean;
  /**
   * Burbujas del BOT que salen DESPUÉS de la última de la IA, en la misma fila y con la misma pausa
   * (la oferta de imágenes). Si salieran aparte, caerían en medio de las burbujas de la IA.
   */
  alFinal?: string[];
  /** Con dos o más productos por elegir donde está: «Nombre (precio)» de cada uno. */
  opcionesDeCompra?: string[];
  /** Los nombres de los métodos de pago de su país (solo nombres: los datos los manda el sistema). */
  metodos?: string[];
  /**
   * LA LISTA CORTA DE LAS OPCIONES («*Opción 1* — nombre · precio»), SOLO SI FALTA (27/10/2026): si la
   * IA ya nombró todas las opciones, no se agrega (era texto fijo repetido). Va antes de `alFinal`.
   */
  /** `siempre`: pregunta de contenido (sale aunque la IA cierre con otra pregunta); si no, solo con la pregunta de elegir. */
  opcionesSiFaltan?: { burbuja: string; nombres: string[]; siempre?: boolean };
  /**
   * ESTÁ COMPARANDO LAS OPCIONES («son 2», «la diferencia»), como el turno de la venta de siempre: en
   * ESTA respuesta, una sola frase de por qué conviene la más completa.
   */
  recomendarLaCompleta?: boolean;
  /** Cuántas opciones tiene delante (para «son N»). */
  cuantasOpciones?: number;
  /** Pregunta vaga con las opciones delante («y esto qué es», «no entiendo»): explicar las N. */
  preguntaVaga?: boolean;
  /** «Son 2» o pregunta vaga: los nombres de TODAS las opciones (la más completa primero), para el seguro. */
  confirmarOpciones?: string[];
  /** Un regalo que se le ofreció y sigue sin responder: lo que es (para que la IA no lo niegue). */
  regaloPendiente?: string;
  /** EL CANDADO DE LA ELECCIÓN: lo que eligió, con su precio («PACK… (US$ 4)»). */
  eligio?: string;
  /** Entró en el precio de oferta (lo activó un seguimiento). */
  enOferta?: boolean;
  /**
   * NO HAY PAGO APROBADO EN ESTE TURNO (un pago a medias, un comprobante rechazado): la IA no puede
   * prometer la entrega. Se quitan las frases que la prometen (27/10/2026: con $1 de $4 dijo «en unos
   * segundos llegará tu enlace del PACK»).
   */
  sinPagoAprobado?: boolean;
  /** Cobro abierto esperando el método: si la IA promete los datos, el bot muestra la lista de métodos. */
  sinMetodo?: () => Promise<void>;
}

/** Los importes con señal de dinero que trae un texto. «3.000 diseños» no es dinero. */
export function importesDelTexto(t: string): number[] {
  const fuera: number[] = [];
  const patron =
    /(?:s\/\.?|\$|usd|us\$|mxn|ars|cop|clp|pen|€)\s*([0-9][0-9.,]*)|([0-9][0-9.,]*)\s*(?:soles|sol|pesos|d[oó]lares|dolares|usd|mxn|ars|cop|clp|pen|euros)\b/gi;
  for (const m of t.matchAll(patron)) {
    const crudo = (m[1] ?? m[2] ?? "").replace(/[.,](?=\d{3}\b)/g, "").replace(",", ".");
    const n = Number(crudo);
    if (Number.isFinite(n) && n > 0) fuera.push(n);
  }
  return fuera;
}

/**
 * LO QUE SABE DE LOS PRODUCTOS. Sale de la ficha de cada producto en Productos (su contenido y sus
 * regalos) y del precio de su país. Las reglas de la casa son las del cerebro de siempre que no
 * dependen de una modalidad: la desconfianza se escucha, el precio se dice de frente, nunca se
 * dice un número de cuenta.
 */
function loQueSabe(c: ContextoDeLaIA): string {
  const productos = c.productos ?? [];
  if (productos.length === 0)
    return "Todavía no se le ha presentado ningún producto: no hables de productos, contenidos ni precios que no estén en la conversación.";
  const fichas = productos.map((p) =>
    [
      `• ${p.nombre}${p.comprado ? " (YA LO COMPRÓ)" : ""}`,
      p.precio ? `  Precio para este cliente: ${p.precio}${p.antes ? ` (antes ${p.antes})` : ""}` : "",
      p.contenido?.trim() ? `  Qué incluye: ${p.contenido.trim().slice(0, 2500)}` : "",
      p.regalos?.trim() ? `  Regalos: ${p.regalos.trim().slice(0, 600)}` : "",
    ]
      .filter(Boolean)
      .join("\n")
  );
  const muestras = c.muestras ?? [];
  return [
    "LOS PRODUCTOS QUE YA SE LE PRESENTARON (son los ÚNICOS que existen para ti; no menciones ni insinúes ningún otro):",
    ...fichas,
    "Datos del producto (cantidades, bonos, formatos): SOLO los escritos aquí. Si no está escrito, no lo afirmes.",
    ...(muestras.length && c.enviarMuestras
      ? [
          "MUESTRAS QUE PUEDES ENVIAR con la herramienta enviar_muestras (fotos o videos reales del producto). Envíalas SOLO cuando vengan a cuento: si pide ver, si pregunta qué incluye o cómo es, o si su «cuándo» lo dice. Nunca más de dos a la vez y nunca una que no esté en esta lista:",
          ...muestras.map((m) => `- ${m.id}: ${m.producto} — ${m.tema}${m.cuando ? ` (cuándo: ${m.cuando.slice(0, 200)})` : ""}`),
        ]
      : []),
  ].join("\n");
}

/**
 * EL CEREBRO DEL TABLERO CON SECCIONES (27/10/2026, su encargo «que se comporte como el automático»):
 * el cerebro del tablero puede traer la copia de su cerebro del automático, partida en secciones con
 * «=== NOMBRE ===» (ROL, IDIOMA, PAGO, PRECIO Y CIERRE, POSTVENTA). Como en la venta de siempre
 * (`promptSectionExclusionsForTurn`), se recorta por etapa: vendiendo no va la POSTVENTA; después de
 * comprar no van PAGO ni PRECIO Y CIERRE. Sus comodines se llenan con el producto que se ofrece aquí.
 * Sin secciones, el texto va entero (como antes).
 */
function cerebroDeLaTienda(c: ContextoDeLaIA): { texto: string; conSecciones: boolean } {
  const crudo = (c.cerebroGeneral ?? "").trim() || CEREBRO_DE_FABRICA;
  const partes = crudo.split(/^===\s*(.+?)\s*===\s*$/m);
  const conSecciones = partes.length >= 3;
  let texto = crudo;
  if (conSecciones) {
    const fuera = c.etapa === "postventa" ? /^(pago|precio y cierre)$/i : /^postventa$/i;
    const trozos: string[] = [partes[0].trim()];
    for (let i = 1; i < partes.length; i += 2) {
      if (fuera.test(partes[i].trim())) continue;
      trozos.push(partes[i + 1]?.trim() ?? "");
    }
    texto = trozos.filter(Boolean).join("\n\n");
  }
  // Sus comodines, con lo que se ofrece AQUÍ (lo elegido, o el primero que no compró).
  const principal =
    (c.productos ?? []).find((p) => c.eligio?.startsWith(p.nombre)) ?? (c.productos ?? []).find((p) => !p.comprado) ?? c.productos?.[0];
  const precio = principal?.precio ?? "su precio";
  texto = texto
    .replace(/\{\{\s*PRODUCTO\s*\}\}/g, principal?.nombre ?? "el producto")
    .replace(/\{\{\s*PRECIO_COMPLETO_MAYUSCULAS\s*\}\}/g, precio.toUpperCase())
    .replace(/\{\{\s*PRECIO_COMPLETO_MINUSCULAS\s*\}\}/g, precio.toLowerCase())
    .replace(/\{\{\s*PRECIO_COMPLETO\s*\}\}/g, precio)
    .replace(/\{\{\s*PRICE\s*\}\}/g, (precio.match(/[\d.,]+/)?.[0] ?? precio))
    .replace(/\{\{\s*(MONEDA|SIMBOLO)\s*\}\}/g, (precio.match(/^[^\d\s]+/)?.[0] ?? "").trim());
  return { texto, conSecciones };
}

/**
 * LAS REGLAS FIJAS QUE LA VENTA DE SIEMPRE PONE EN TODOS LOS TURNOS (openrouter.ts, `addFijo`), el
 * mismo texto: sin el nombre del cliente, un emoji, distancia profesional, sin «quisieras», datos solo
 * del contenido, negrita ligera. No nombran productos: son de la casa.
 */
const REGLAS_FIJAS_DEL_AUTOMATICO = [
  `CUSTOMER NAME — DO NOT USE ANY NAME: never address the customer by name — do not greet them by name and do not sprinkle a name into messages. Using their name feels intrusive and overfamiliar ("confianzudo"). Speak naturally, warmly, without any name.`,
  `EMOJI TONE — include 1 context-appropriate emoji in every conversational reply (2 maximum across the full reply). Keep it professional and relevant; never use kisses, romantic hearts, winks or overly familiar emojis.`,
  `PROFESSIONAL DISTANCE — avoid overfamiliar slang or casual reassurance such as "tranqui", "no te preocupes", "amigo/amiga", "bro", "corazon", "lindo/linda", "mi reina", "mi estimado/estimada" or similar. Use respectful, neutral phrases instead: "claro", "con gusto", "te explico", "sí, correcto", "puedes hacerlo así".`,
  `CTA WORDING - do NOT use "quisieras" in sales CTAs. Do NOT close with "Quisieras saber como adquirirlo" or "Quieres saber como adquirirlo". Prefer "Quieres que te indique como adquirirlo?", "Deseas que te indique como adquirirlo?" or another short CTA with adquirirlo/proceder/metodo de pago.`,
  `PRODUCT FACTS: state quantities, bonuses, formats and features only when present in the product content you were given. Never infer, alter or invent facts; if uncertain, omit them or ask.`,
  `FORMATTING: in WhatsApp, *word* makes it bold (ONE asterisk). Highlight ONLY the most important terms in *bold* — at most 1-3 key words/phrases per message. NEVER bold whole sentences or most of the text; keep it light and tasteful.`,
].join("\n");

/**
 * LAS DOS OPCIONES A LA VISTA (27/10/2026): el bloque de la venta de siempre para Order Bump / Doble
 * Oferta (openrouter.ts, «ORDER BUMP ACTIVE»), con las reglas que no dependen de su motor. Va cuando
 * en la ficha hay dos o más productos por elegir. Su regla editable de Ajustes va detrás.
 */
function bloqueDeLasOpciones(c: ContextoDeLaIA): string {
  const ops = c.opcionesDeCompra ?? [];
  if (ops.length < 2) return "";
  const regla = loadWorkflowConfig()?.order_bump_option_presentation_rule?.trim();
  return [
    `TWO OR MORE SELLABLE OPTIONS ARE ON THE TABLE: ${ops.join(" · ")}. This OVERRIDES any "you only sell ONE product" wording above: these are all products of this store.`,
    `PRESENTATION ORDER — present the most complete option FIRST and the other SECOND. Treat each option as a valuable, valid choice in its own right; never belittle one or describe it as an inferior leftover.`,
    `COMPLEMENT WORDING — an additional product inside a bundle is NOT a gift, freebie or bonus unless its content explicitly says so.`,
    `Interpret the customer's meaning from the full conversation. Questions, comparisons, unusual wording and topic changes are not choices. Answer first; never treat one matching word as a choice.`,
    `Be warm, direct and commercial, with at least one fitting emoji. Stay professional, calm and concise (no chit-chat, no pushiness): do NOT volunteer a recommendation unless a turn rule below asks for it — simply ask, once and gently, which one they prefer; only help them decide if THEY ask for it. Avoid flyer-like dumps, repetition and pressure.`,
    `If they ask what one option is / includes, explain it by its content and its relation to the other, WITHOUT any price unless they asked for the price.`,
    `When you present the options: one option per paragraph separated by a blank line; names in bold; no numbered/keycap emojis.`,
    `A payment question or a payment-method name is NEVER a product choice: if no option is chosen yet, ask which one they prefer first.`,
    `PURCHASE CONFIRMATION — money safety: NEVER tell the customer their purchase is approved, complete or done. Only the system confirms and delivers, after a receipt covering the full amount arrives.`,
    regla ? `OPTION PRESENTATION RULE (from the owner's settings):\n${regla}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** UN SOLO PRODUCTO (openrouter.ts, «SINGLE-PRODUCT MODE»): vendiendo, sin opciones por elegir. */
function bloqueDeUnProducto(c: ContextoDeLaIA): string {
  if (c.etapa !== "venta" || (c.opcionesDeCompra?.length ?? 0) > 1) return "";
  const enVenta = (c.productos ?? []).filter((p) => !p.comprado);
  if (enVenta.length !== 1) return "";
  return `SINGLE-PRODUCT MODE — there is exactly ONE product on offer here. If the customer asks about an unrelated topic, redirect warmly: make clear we only offer this one material and, in ONE short phrase, say what it helps with (drawn ONLY from its content). Do NOT imply there are other products. Do NOT label it as option 1/2 or use numbered option emojis. Answer the customer's concern first, write in clear WhatsApp paragraphs/bubbles instead of one dense block, stay warm and professional, and close with a soft next step.`;
}

/**
 * EL CEREBRO QUE SE LE DA A LA IA. Lo FIJO va primero (el cerebro general, las reglas del dinero y el
 * dialecto: iguales en todos los turnos de este tablero), para que el proveedor lo cobre más barato
 * como prefijo repetido; lo que cambia en cada turno va detrás.
 */
function cerebro(c: ContextoDeLaIA): string {
  const montos = c.montosPermitidos.length
    ? `Los ÚNICOS montos que puedes mencionar son: ${c.montosPermitidos.join(", ")}${c.moneda ? ` (${c.moneda})` : ""}. Ningún otro número de dinero, ni sumas, ni descuentos.`
    : "NO menciones ningún precio ni monto de dinero: si preguntan cuánto cuesta, di que en un momento le compartes la información, sin inventar cifras.";
  const suCerebro = cerebroDeLaTienda(c);
  return [
    // ── FIJO ──
    suCerebro.texto,
    "REGLAS QUE NO SE ROMPEN: la conversación sigue una ruta armada por el dueño; contesta y devuélvelo a ella. No des datos de pago, números de cuenta, nombres de titular ni enlaces: eso lo envía el sistema. No inventes contenido, beneficios, plazos ni condiciones. Escribe en español neutro.",
    // LAS REGLAS DE CONVERSACIÓN DE LA VENTA DE SIEMPRE (27/10/2026): si el cerebro del tablero ya trae su
    // cerebro del automático (con secciones), sus reglas ya van ahí; si no, el texto de fábrica del código.
    suCerebro.conSecciones ? "" : reglasDelAutomatico(c),
    REGLAS_FIJAS_DEL_AUTOMATICO,
    "IMÁGENES: no ofrezcas ni prometas fotos, imágenes ni videos por tu cuenta: de eso se encarga el sistema.",
    bloqueDeLasOpciones(c),
    bloqueDeUnProducto(c),
    excepcionesDelTablero(c),
    c.dialecto ? `DIALECTO (manda sobre todo lo demás): ${c.dialecto}` : "",
    // ── LO DE ESTE TURNO ──
    loQueSabe(c),
    c.eligio
      ? `EL CLIENTE YA ELIGIÓ: ${c.eligio}. Todo lo que digas de precio, pago o datos es de ESE producto. Si pregunta por el otro, contéstale, pero no cambies su elección ni le digas otro precio a pagar: solo cambia si él lo dice claramente.`
      : "",
    // Solo sin nota del sistema: con nota («recibimos su pago, pero no alcanza…») el sistema ya dijo qué
    // pasó con su comprobante, y esta línea la contradecía (HEA1: pidió la foto que acababa de llegar).
    c.sinPagoAprobado && !c.nota
      ? "NINGÚN COMPROBANTE ESTÁ RECIBIDO NI EN REVISIÓN: si dice que ya pagó o que va a pagar, no digas que lo recibiste ni que lo estás verificando; pídele que envíe la FOTO o captura del comprobante por aquí."
      : "",
    c.ofreciendoAhora
      ? `LO QUE LE ESTÁS OFRECIENDO AHORA: ${c.ofreciendoAhora}. Si pregunta «¿este es otro?», «¿qué es esto?» o algo así, habla de ESTE, y si ya compró otro, dile con claridad que es distinto de lo que compró.`
      : "",
    montos,
    // La venta de siempre (openrouter.ts, `discountActive`): por qué está más barato.
    c.enOferta
      ? "Este cliente entró en el precio de oferta. Si pregunta por qué está más barato, dile que es una promoción especial por seguir interesado."
      : "",
    c.instrucciones?.trim() ? `EN ESTA ETAPA, ADEMÁS: ${c.instrucciones.trim().slice(0, 3000)}` : "",
    c.completar ? `Si dice que quiere completar, pagar la diferencia o pasarse a «${c.completar.para}», usa la herramienta completar_al_otro.` : "",
    c.pedirCorreo ? "Si pide que le envíes lo que ya recibió a su correo (email), usa la herramienta enviar_por_correo." : "",
    // LOS AVISOS AL DUEÑO, con la misma regla que la venta de siempre (25/10/2026).
    "PROBLEMAS DEL CLIENTE (pago, descarga, acceso, uso…): primero intenta resolverlo tú, al menos 2 veces, con lo que sabes. Si sigue sin resolverse o está molesto, pregúntale: «¿Deseas que un asesor especializado se comunique contigo?». SOLO si responde que sí, usa notify_admin_emergency con el problema concreto. Nunca en su primer mensaje sobre el problema.",
    "SI PIDE HABLAR CON UNA PERSONA (o quiere comprar pero algo no le queda claro y eso lo frena): ofrécele un asesor con la misma pregunta y, SOLO si dice que sí, usa notify_admin_advisor_request. No lo uses para dudas normales (precio, contenido, formato): esas las contestas tú.",
    c.postventa?.trim()
      ? `DESPUÉS DE LA COMPRA, lo que sabes de su material (úsalo si pregunta cómo usarlo, descargarlo o hasta cuándo lo tiene):\n${c.postventa.trim().slice(0, 1500)}`
      : "",
    c.noOfrezcasImagenes
      ? "EN ESTE TURNO: contesta por escrito lo que pregunta sobre el contenido y termina ahí. No menciones imágenes, fotos ni muestras: el sistema añade él mismo la oferta de verlas justo después de tu respuesta."
      : "",
    // LA MISMA ORDEN DEL TURNO QUE USA LA VENTA DE SIEMPRE cuando preguntan cuántas opciones hay
    // (openrouter.ts, «CURRENT TURN — THEY ARE ASKING HOW MANY OPTIONS»), solo en este turno.
    // (28/10/2026, su HHH2: a «que son 2» contestó «El PACK incluye todo esto», sin decir que eran dos ni
    // nombrar la otra. La orden del automático empieza por CONFIRMAR que son N y NOMBRARLAS TODAS.)
    c.recomendarLaCompleta
      ? `EN ESTE TURNO ESTÁ PREGUNTANDO CUÁNTAS SON O COMPARANDO LAS OPCIONES: empieza confirmando con calidez que son ${c.cuantasOpciones && c.cuantasOpciones > 2 ? c.cuantasOpciones : "dos"} opciones y NÓMBRALAS TODAS por su nombre, en negrita, una por párrafo, con lo que trae cada una (la más completa primero; si una incluye a la otra, dilo: «trae todo lo de X y además…»). Luego UNA sola frase de por qué conviene la más completa —lo que suma, con un detalle concreto de su contenido—, sin menospreciar la otra y sin presión. Sin precios salvo que los haya pedido. NO elijas por él. Esto vale SOLO para esta respuesta: no vuelvas a recomendar en las siguientes.`
      : "",
    // (28/10/2026, su HHH1: a «y esto qué es» tras la oferta de dos opciones habló solo del pack.)
    // (28/10/2026, su hay3: salió del regalo para pagar 100 CITAS, preguntó «qué es ese regalo» y la IA le
    // dijo «no hay un regalo extra»: no sabía que seguía pendiente.)
    c.regaloPendiente
      ? `TIENE UN REGALO PENDIENTE, GRATIS, que se le ofreció y aún no respondió: «${c.regaloPendiente}». Es aparte de lo que compra y NO depende de pagar nada. Si pregunta por el regalo, explícaselo con eso y dile que, si lo quiere, te escriba «quiero el regalo». NUNCA digas que no hay regalo.`
      : "",
    c.preguntaVaga
      ? "EN ESTE TURNO NO SABE QUÉ ES LO QUE VE (pregunta algo vago como «y esto qué es» o «no entiendo»): explícale con sencillez que tiene opciones para elegir y NÓMBRALAS TODAS por su nombre, en negrita, una por párrafo, con lo que trae cada una (la más completa primero; si una incluye a la otra, dilo: «trae todo lo de X y además…»). No hables de una sola. Sin precios salvo que los pida. NO elijas por él y no recomiendes."
      : "",
    cierre(c),
    c.nota ? `LO QUE ACABA DE PASAR (dilo con tus palabras): ${c.nota}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * CÓMO TERMINA LA RESPUESTA, POR ETAPA (25/10/2026, punto 6): las reglas de cierre de la venta de
 * siempre («close with a soft next step», CTA sin «quisieras», no repetir datos ya enviados, no
 * presionar; en la postventa, sin pregunta de venta). Son reglas, no frases: la IA redacta. Y nunca
 * copia el texto de los botones del dueño (un «ELIGE UNA OPCIÓN…» dicho por la IA suena a presión).
 */
/**
 * LAS REGLAS DE CONVERSACIÓN DE LA VENTA DE SIEMPRE, tomadas de su propio texto (`SYSTEM_PROMPT`): desde
 * «DISTRUST OR FEAR» hasta antes de «EMAIL CAPTURE» (desconfianza, preguntas de precio, formato y tono,
 * cierre con sus variantes, la excepción del comprobante y la gramática). Lo que se cambie allí vale
 * aquí. Lo demás de ese texto (aprobar pagos, pedir el correo, la postventa) el tablero lo hace a su modo.
 */
function reglasDelAutomatico(c: ContextoDeLaIA): string {
  const desde = SYSTEM_PROMPT.indexOf("DISTRUST OR FEAR");
  const hasta = SYSTEM_PROMPT.indexOf("EMAIL CAPTURE");
  if (desde < 0 || hasta <= desde) return "";
  const principal = (c.productos ?? []).find((p) => !p.comprado) ?? c.productos?.[0];
  const texto = SYSTEM_PROMPT.slice(desde, hasta)
    .replace(/\{\{\s*PRODUCTO\s*\}\}/g, principal?.nombre ?? "el producto")
    .replace(/\{\{\s*PRECIO_COMPLETO\s*\}\}/g, principal?.precio ?? "su precio")
    .trim();
  return `REGLAS DE CONVERSACIÓN DE LA VENTA DE SIEMPRE (síguelas; las EXCEPCIONES DEL TABLERO de abajo mandan sobre ellas):\n${texto}`;
}

/** Lo que en el tablero es distinto de la venta de siempre, y manda sobre sus reglas. */
function excepcionesDelTablero(c: ContextoDeLaIA): string {
  return [
    "EXCEPCIONES DEL TABLERO (mandan sobre todo lo anterior):",
    "- No apruebas pagos ni revisas comprobantes: eso lo hace el sistema.",
    `- NUNCA preguntes por el método de pago por tu cuenta (nada de «¿con qué método te sientes más cómodo?»): el sistema lo pregunta cuando el cliente elige. Solo si el cliente PREGUNTA cómo pagar o cuáles son los métodos, nómbralos en lista vertical, solo sus nombres${c.metodos?.length ? ` (${c.metodos.join(", ")}; NINGÚN otro: si pide uno que no está, dile con amabilidad que por ahora se paga con ${c.metodos.length > 1 ? "esos" : "ese"})` : " (no tienes la lista: no nombres ninguno, dile que le pasas los datos)"}, y cierra con «¿Cuál prefieres?».`,
    c.opcionesDeCompra?.length
      ? `- AQUÍ EL CLIENTE TIENE QUE ELEGIR ENTRE ${c.opcionesDeCompra.length} OPCIONES: ${c.opcionesDeCompra.join(" · ")}. Si pregunta el precio sin haber elegido, nómbralas TODAS con su precio (no hay un solo precio); si pregunta qué trae una, contesta sin precio. Cierra con «¿Cuál de las ${c.opcionesDeCompra.length === 2 ? "dos" : c.opcionesDeCompra.length} prefieres?».`
      : "",
    "- Si ya compró (postventa) o tiene un problema, no cierres con pregunta de venta.",
    "- Lo que ya compró no se le vuelve a ofrecer ni a cobrar.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Las preguntas de cierre de la venta de siempre (`system-prompt.ts`), para cuando la IA no cerró. */
const PREGUNTAS_DE_CIERRE = [
  "¿Te gustaría que te indique cómo adquirirlo?",
  "¿Deseas saber los métodos de pago?",
  "¿Te muestro los pasos para tenerlo?",
  "¿Te gustaría que te indique cómo obtenerlo ya?",
  "¿Quieres que te explique cómo obtenerlo?",
  "¿Te gustaría asegurar tu acceso hoy?",
];

/** Para elegir entre las opciones: rotan, sin repetir la que acaba de salir (28/10/2026). */
const CIERRES_DE_DOS = ["¿Por cuál te animas? 😊", "¿Por cuál de las dos te animas?", "¿Cuál de las dos opciones te gusta más?"];
const CIERRES_DE_VARIAS = ["¿Por cuál te animas? 😊", "¿Cuál de estas opciones te gusta más?", "¿Con cuál te quedas?"];

function cierre(c: ContextoDeLaIA): string {
  if (c.nota) return "";
  if (c.etapa === "postventa")
    return "CIERRE: ya compró. Contesta breve y positivo. No le vuelvas a vender lo que ya compró ni termines con una pregunta de venta.";
  // ESPERANDO EL COMPROBANTE, COMO LA VENTA DE SIEMPRE (27/10/2026): sin pregunta de venta. «¿Todo bien?
  // Si ya realizaste el pago, envíame la foto…» sonaba a desesperado por cobrar.
  if (c.etapa === "datos")
    return "CIERRE: ya tiene los datos de pago y esperamos su comprobante. Contesta breve lo que escribió. NO le preguntes si ya pagó ni le pidas la foto con una pregunta; si cierras, que sea con una línea natural como «Quedo pendiente de tu comprobante para darte acceso 😊». No repitas los datos ni el precio.";
  // VENDIENDO: el cierre es el de la venta de siempre (sus reglas van arriba, con sus variantes).
  return [
    "CIERRE: el de las reglas de la venta de siempre de arriba (una pregunta suave en su propia línea, rotando). Si el cliente tiene un problema o está molesto, tu pregunta final es sobre su problema (o el asesor), nunca de venta. Nada de «solo dime…» ni «¿lo quieres ya?».",
    c.preguntaPendiente
      ? `Lo que quedó pendiente en la conversación es esto (NO copies este texto ni el de sus botones; invítalo con tus palabras): «${c.preguntaPendiente.slice(0, 300)}».`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * LA CONVERSACIÓN QUE LEE LA IA (25/10/2026, ahorro de tokens acordado: «leer menos historial»): los
 * 12 mensajes más recientes, los del bot recortados (sus burbujas de venta son largas y ya están
 * resumidas en «lo que sabe»); los del cliente casi enteros. Antes: 24 mensajes de hasta 1.500 letras.
 */
function historial(conversationId: number): ChatCompletionMessageParam[] {
  return ultimosMensajes(conversationId, 12)
    .filter((m) => (m.content ?? "").trim())
    .map((m) => ({
      role: m.role === "user" ? ("user" as const) : ("assistant" as const),
      content: m.content.slice(0, m.role === "user" ? 600 : 500),
    }));
}

export interface OpcionParaLaIA {
  id: string;
  /** Lo que el cliente ve o lo que significa: el texto del botón, el título del cuadrito. */
  etiqueta: string;
  /** Las palabras del cuadrito, si las tiene: ayudan a entender de qué habla. */
  palabras?: string[];
}

/**
 * ¿CUÁL ELIGIÓ? Cuando ningún botón ni cuadrito acertó por sus palabras («el de 10», «el otro»,
 * «quiero el primero que me dijiste»), la IA decide cuál de las opciones de ESA ficha eligió el
 * cliente, mirando lo que el bot le acaba de decir. NO escribe nada al cliente: devuelve el id
 * de la opción, o null si no eligió ninguna (pregunta, duda, dice que no). Un «no quiero X» nunca
 * es elegir X.
 */
export async function elegirOpcionConIA(
  conversationId: number,
  mensaje: string,
  opciones: OpcionParaLaIA[]
): Promise<string | null> {
  if (opciones.length === 0 || !mensaje.trim()) return null;
  const modelo = process.env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini";
  const lista = opciones
    .map((o) => `- ${o.id}: «${o.etiqueta}»${o.palabras?.length ? ` (palabras: ${o.palabras.join(", ")})` : ""}`)
    .join("\n");
  const ultimos = ultimosMensajes(conversationId, 8)
    .filter((m) => (m.content ?? "").trim())
    .map((m) => `${m.role === "user" ? "CLIENTE" : "BOT"}: ${m.content.slice(0, 400)}`)
    .join("\n");
  try {
    const r = await getClient().chat.completions.create({
      model: modelo,
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "Decides cuál de las opciones ELIGIÓ el cliente con su último mensaje. Responde SOLO con el id de la opción, o con NINGUNA. " +
            "Es NINGUNA si pregunta, duda, compara, pide más información, dice que no quiere algo, o no queda claro. " +
            "«No quiero X» nunca es elegir X. «El otro», «el primero», «el de 10» se resuelven con lo que el BOT le acaba de ofrecer. " +
            // COMO LA VENTA DE SIEMPRE (25/10/2026, punto 8): elegir método o decir que quiere pagar ES
            // decidir comprar (en COMO OB eso suelta el order bump); preguntar el precio no lo es.
            "Si una opción es la de PAGAR o COMPRAR (por ejemplo «Quiero pagar», «Lo quiero», «Sí»), el cliente la ELIGE cuando dice claramente que quiere pagar o comprarlo, nombra un método de pago, o pregunta a dónde o cómo pagar. Preguntar el precio, qué trae o cómo funciona NO es elegirla. " +
            "Pero si las opciones son PRODUCTOS distintos (el básico, el pack…), nombrar un método de pago o decir «quiero pagar» NO elige ninguno: es NINGUNA.",
        },
        {
          role: "user",
          content: `CONVERSACIÓN RECIENTE:\n${ultimos}\n\nOPCIONES:\n${lista}\n\nÚLTIMO MENSAJE DEL CLIENTE: «${mensaje.slice(0, 500)}»\n\nRespuesta (solo el id o NINGUNA):`,
        },
      ],
    });
    const dicho = (r.choices[0]?.message?.content ?? "").trim().replace(/[«»"'`.]/g, "");
    const elegida = opciones.find((o) => o.id === dicho) ?? null;
    console.log(`[tablero:ia] convo ${conversationId}: «${mensaje.slice(0, 60)}» → ${elegida ? elegida.id : "ninguna"}`);
    return elegida?.id ?? null;
  } catch (err) {
    console.error(`[tablero:ia] convo ${conversationId}: no se pudo decidir la elección`, err);
    return null;
  }
}

/**
 * ¿DE QUÉ HABLA? (24/10/2026). A diferencia de `elegirOpcionConIA`, aquí una pregunta también cuenta:
 * se usa durante el regalo para saber si el mensaje es del regalo (lo atiende el motor de siempre) o
 * de otra cosa —el upsell, lo que compró, completar, el correo— (lo contesta la IA del tablero, que
 * sabe todo eso). Ante la duda, null.
 */
export async function deQueHablaConIA(conversationId: number, mensaje: string, opciones: OpcionParaLaIA[]): Promise<string | null> {
  if (opciones.length === 0 || !mensaje.trim()) return null;
  const modelo = process.env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini";
  const ultimos = ultimosMensajes(conversationId, 8)
    .filter((m) => (m.content ?? "").trim())
    .map((m) => `${m.role === "user" ? "CLIENTE" : "BOT"}: ${m.content.slice(0, 400)}`)
    .join("\n");
  try {
    const r = await getClient().chat.completions.create({
      model: modelo,
      temperature: 0,
      messages: [
        { role: "system", content: "Decides de qué trata el último mensaje del cliente, entre las opciones. Responde SOLO con el id de la opción, o NINGUNA si no queda claro." },
        {
          role: "user",
          content: `CONVERSACIÓN RECIENTE:\n${ultimos}\n\nOPCIONES:\n${opciones.map((o) => `- ${o.id}: ${o.etiqueta}`).join("\n")}\n\nÚLTIMO MENSAJE DEL CLIENTE: «${mensaje.slice(0, 500)}»\n\nRespuesta (solo el id o NINGUNA):`,
        },
      ],
    });
    const dicho = (r.choices[0]?.message?.content ?? "").trim().replace(/[«»"'`.]/g, "");
    const cual = opciones.find((o) => o.id === dicho)?.id ?? null;
    console.log(`[tablero:ia] convo ${conversationId}: «${mensaje.slice(0, 60)}» habla de → ${cual ?? "no se sabe"}`);
    return cual;
  } catch (err) {
    console.error(`[tablero:ia] convo ${conversationId}: no se pudo saber de qué habla`, err);
    return null;
  }
}

const HERRAMIENTA_DE_REENVIO = {
  type: "function" as const,
  function: {
    name: "reenviar_material",
    description:
      "Use ONLY when the customer says they did not receive, could not open, lost, or wants again the material/links/free samples they were ALREADY sent. It resends what was delivered.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
};

const herramientaDeMuestras = (ids: string[]) => ({
  type: "function" as const,
  function: {
    name: "enviar_muestras",
    description:
      "Send real sample images/videos of the products already presented, from the allowed list. Use when the customer wants to see the product, asks what it includes or how it looks, or when a sample's 'cuándo' says so. At most 2.",
    parameters: {
      type: "object",
      properties: { ids: { type: "array", items: { type: "string", enum: ids }, maxItems: 2 } },
      required: ["ids"],
      additionalProperties: false,
    },
  },
});

const HERRAMIENTA_DE_CORREO = {
  type: "function" as const,
  function: {
    name: "enviar_por_correo",
    description:
      "Use when the customer asks to receive by email (correo) the material/links they ALREADY received. The system asks for their address if needed and sends the links.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
};

const HERRAMIENTA_DE_COMPLETAR = {
  type: "function" as const,
  function: {
    name: "completar_al_otro",
    description:
      "Use when the customer, who already bought one product, says they want to upgrade: pay the difference / complete / switch to the other (more complete) product. The system takes them to that payment.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
};

const HERRAMIENTA_DE_DATOS = {
  type: "function" as const,
  function: {
    name: "reenviar_datos_de_pago",
    description:
      "Use when the customer asks for the payment details again (account, number, where to pay) or says yes to paying now. The system sends the payment details again, with the right price. Do NOT use it when the customer only has a doubt or asks a question (what they receive, how it works): answer the doubt with words instead.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
};

/**
 * Contesta con la IA y lo envía en burbujas. Si la IA nombra un monto que no está permitido, se le
 * pide otra vez; si insiste, se quitan las frases con ese monto. Nunca sale un precio inventado.
 */
export async function responderConIA(convo: ConversationRow, c: ContextoDeLaIA): Promise<boolean> {
  const modelo = process.env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini";
  const permitidos = new Set(c.montosPermitidos.map((n) => Math.round(n * 100)));
  const prohibidos = (t: string) => importesDelTexto(t).filter((n) => !permitidos.has(Math.round(n * 100)));
  let texto = "";
  let aviso = "";
  let conMuestras = !!(c.enviarMuestras && c.muestras?.length);
  let salieronMuestras = false;
  for (let intento = 0; intento < 3; intento++) {
    try {
      const herramientas =
        intento === 0
          ? [
              ...(c.reenviar ? [HERRAMIENTA_DE_REENVIO] : []),
              ...(c.reenviarDatos ? [HERRAMIENTA_DE_DATOS] : []),
              ...(conMuestras ? [herramientaDeMuestras(c.muestras!.map((m) => m.id))] : []),
              ...(c.pedirCorreo ? [HERRAMIENTA_DE_CORREO] : []),
              ...(c.completar ? [HERRAMIENTA_DE_COMPLETAR] : []),
              // Los avisos al dueño, las MISMAS herramientas de la venta de siempre (emergency.ts).
              NOTIFY_EMERGENCY_TOOL,
              NOTIFY_ADVISOR_TOOL,
            ]
          : [];
      const r = await getClient().chat.completions.create({
        model: modelo,
        messages: [
          { role: "system", content: cerebro(c) + aviso },
          ...historial(convo.id),
        ],
        temperature: 0.6,
        ...(herramientas.length ? { tools: herramientas } : {}),
      });
      // LO QUE CUESTA CADA TURNO, para medirlo contra la venta de siempre.
      if (r.usage) {
      // Cuántos se cachearon (28/10/2026): para ver en el log si el proveedor fijo está ahorrando.
      const cacheados = (r.usage as { prompt_tokens_details?: { cached_tokens?: number } }).prompt_tokens_details?.cached_tokens ?? 0;
      console.log(`[tablero:ia:tokens] convo ${convo.id}: entrada ${r.usage.prompt_tokens} (cacheados ${cacheados}) · salida ${r.usage.completion_tokens}`);
    }
      const pidio = (nombre: string) =>
        r.choices[0]?.message?.tool_calls?.some((t) => t.type === "function" && t.function.name === nombre) ?? false;
      // EL AVISO AL DUEÑO (emergencia o pedido de asesor), como la venta de siempre: se te avisa por
      // WhatsApp y la IA le dice al cliente el texto acordado.
      const aviso1 = r.choices[0]?.message?.tool_calls?.find(
        (x) => x.type === "function" && (x.function.name === "notify_admin_emergency" || x.function.name === "notify_admin_advisor_request")
      );
      if (aviso1 && aviso1.type === "function") {
        let razon = "";
        try {
          razon = String(JSON.parse(aviso1.function.arguments || "{}").reason ?? "");
        } catch {}
        const res =
          aviso1.function.name === "notify_admin_emergency"
            ? await executeNotifyEmergency(convo.id, { reason: razon })
            : await executeNotifyAdvisor(convo.id, { reason: razon });
        console.log(`[tablero:ia] convo ${convo.id}: ${aviso1.function.name} → ${res.status} (${razon.slice(0, 80)})`);
        aviso +=
          res.status === "sent"
            ? "\n\nACABAS DE AVISAR AL EQUIPO. Respóndele UNA vez, con naturalidad: «Un asesor especializado se contactará contigo en unos momentos. Mantente pendiente de este chat.»"
            : "";
        continue;
      }
      // «QUIERO COMPLETAR PARA EL OTRO»: lo lleva al cobro con upgrade; de ahí sale lo que toca.
      if (pidio("completar_al_otro") && c.completar) {
        console.log(`[tablero:ia] convo ${convo.id}: quiere completar para «${c.completar.para}»`);
        await c.completar.ir();
        return true;
      }
      // «ENVÍAMELO A MI CORREO»: el sistema pide la dirección (o lo envía) y la IA lo dice.
      if (pidio("enviar_por_correo") && c.pedirCorreo) {
        const nota = await c.pedirCorreo();
        console.log(`[tablero:ia] convo ${convo.id}: lo pide por correo → ${nota?.slice(0, 60) ?? "se le pidió la dirección"}`);
        // Sin nota: ya se le pidió su dirección con el texto de la ficha; no hace falta más.
        if (!nota) return true;
        aviso += `\n\nLO QUE ACABA DE PASAR (dilo con tus palabras): ${nota}`;
        continue;
      }
      // «NO ME LLEGÓ»: se reenvía lo entregado, y la IA lo acompaña con una frase suya.
      if (pidio("reenviar_material") && c.reenviar) {
        console.log(`[tablero:ia] convo ${convo.id}: pidió que le reenvíen el material`);
        await c.reenviar();
        return true;
      }
      // «PÁSAME LA CUENTA» / «SÍ, YA PAGO»: los datos del método que eligió, con su precio. Los
      // manda el sistema, no la IA (como la guarda de `payment_done` del motor de siempre).
      if (pidio("reenviar_datos_de_pago") && c.reenviarDatos) {
        console.log(`[tablero:ia] convo ${convo.id}: pidió los datos de pago otra vez`);
        await c.reenviarDatos();
        return true;
      }
      // LAS MUESTRAS: salen las elegidas (de la lista permitida) y después la IA las acompaña con
      // una frase, ya sin herramientas.
      const llamada = r.choices[0]?.message?.tool_calls?.find((t) => t.type === "function" && t.function.name === "enviar_muestras");
      if (llamada && llamada.type === "function" && c.enviarMuestras && conMuestras) {
        let ids: string[] = [];
        try {
          ids = (JSON.parse(llamada.function.arguments || "{}").ids ?? []).map(String);
        } catch {}
        const validas = ids.filter((id) => c.muestras!.some((m) => m.id === id)).slice(0, 2);
        const enviadas = validas.length ? await c.enviarMuestras(validas) : 0;
        salieronMuestras = enviadas > 0;
        conMuestras = false;
        console.log(`[tablero:ia] convo ${convo.id}: envió ${enviadas} muestra(s): ${validas.join(", ")}`);
        const cuales = c.muestras!.filter((m) => validas.includes(m.id)).map((m) => `${m.producto} — ${m.tema}`);
        aviso += enviadas
          ? `\n\nACABAS DE ENVIARLE estas muestras: ${cuales.join("; ")}. Acompáñalas con una o dos frases cortas (sin describirlas de más) y sigue la conversación.`
          : "";
        // La vuelta siguiente ya no ofrece herramientas (solo la primera las lleva): solo el texto.
        continue;
      }
      texto = (r.choices[0]?.message?.content ?? "").trim();
    } catch (err) {
      console.error(`[tablero:ia] convo ${convo.id}: la IA no respondió`, err);
      return false;
    }
    const malos = prohibidos(texto);
    if (malos.length === 0) break;
    console.log(`[tablero:ia] convo ${convo.id}: nombró montos que no son suyos (${malos.join(", ")}), se le pide otra vez`);
    aviso += `\n\nIMPORTANTE: tu respuesta anterior nombró montos no permitidos (${malos.join(", ")}). No los repitas.`;
  }
  // EL CIERRE LO PONE EL BOT SI FALTA (27/10/2026): vendiendo, la respuesta termina con una pregunta
  // suave, como la venta de siempre. Antes se le pedía otra respuesta a la IA (se pagaba dos veces);
  // ahora se agrega una de sus preguntas de siempre, distinta de las 2 últimas, sin gastar tokens.
  // EL TOPE DE BURBUJAS ES EL DE TUS AJUSTES (27/10/2026), el mismo de la venta de siempre
  // («Limitar burbujas» y su máximo; apagado = sin tope). Antes el tablero tenía un 3 fijo y juntaba lo
  // que sobraba en la última burbuja (se veía apretado). Con tope, lo que sobra se junta en la última
  // para que no se pierda (`sendChunkedBotText` cortaría).
  const cfg = loadWorkflowConfig();
  /** Los datos verdaderos del cobro ya salieron (la IA había escrito una cuenta): eso ya es respuesta. */
  let reenvioPorCuenta = false;
  /** La pregunta de elegir entre las opciones: va sola, al final, después de la lista de opciones. */
  let preguntaDeElegir = "";
  const tope = cfg?.llm_bubble_limit_enabled === true ? Math.max(1, Math.floor(cfg.llm_max_bubbles ?? 3)) : null;
  const alTope = (partes: string[], n: number | null) => (n && partes.length > n ? [...partes.slice(0, n - 1), partes.slice(n - 1).join("\n")] : partes);
  {
    const ultimos = ultimosMensajes(convo.id, 8);
    const delCliente = ([...ultimos].reverse().find((m) => m.role === "user")?.content ?? "").toLowerCase().normalize("NFD").replace(/\p{Mn}/gu, "");
    // LA IA NUNCA ESCRIBE DATOS DE CUENTA (27/10/2026, su prueba HOLA2): copió del historial la cuenta y
    // la cédula con otro monto. Los datos de pago los manda SOLO el sistema. Toda burbuja con una cifra
    // de 7 o más dígitos (cuenta, cédula, teléfono; sin contar enlaces) se quita junto con las que vienen
    // detrás («luego que lo realices, me envías…») y la línea «…de la siguiente forma:» que la presentaba.
    // Si hay un cobro abierto con su método, los datos verdaderos los manda el sistema.
    {
      const conCuenta = (b: string) => /\d{7,}/.test(b.replace(/https?:\/\/\S+/g, "").replace(/(?<=\d)[ \t-](?=\d)/g, ""));
      const partes = texto.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
      const desde = partes.findIndex(conCuenta);
      if (desde >= 0) {
        const quedan = partes.slice(0, desde);
        if (quedan.length && /:\s*$/.test(quedan[quedan.length - 1])) quedan[quedan.length - 1] = quedan[quedan.length - 1].replace(/(^|\n)[^\n]*:\s*$/, "").trim();
        console.log(`[tablero:ia] convo ${convo.id}: escribió datos de cuenta → se quitan (los manda solo el sistema)${c.reenviarDatos ? "; reenvío los de su cobro" : ""}`);
        texto = quedan.filter(Boolean).join("\n\n");
        if (c.reenviarDatos) {
          await c.reenviarDatos();
          reenvioPorCuenta = true;
        }
      }
    }
    // UNA FRASE CORTADA AL FINAL («Los métodos que tenemos para ti son:» y nada más) no sale (27/10/2026).
    texto = texto.replace(/(^|\n)[^\n]*:\s*$/, "").trim();
    // NUNCA PREGUNTA EL MÉTODO POR SU CUENTA, vendiendo: «¿con qué método te sientes más cómodo?» sonaba a
    // desesperado. Esa pregunta se quita (solo vale si el cliente preguntó cómo pagar).
    if (c.etapa === "venta" && !/(metodo|como (te )?pago|formas? de pago|medios? de pago|como se paga|donde pago)/.test(delCliente)) {
      const burbujas = texto.split(/\n\s*\n/);
      const ult = burbujas[burbujas.length - 1] ?? "";
      // Solo la pregunta de CUÁL método («¿con qué método te sientes más cómodo?»), no la invitación de la
      // venta de siempre («¿Deseas que te indique los métodos de pago…?»), que el automático sí hace.
      const preguntaCualMetodo = /(con qu[eé] m[eé]todo|qu[eé] m[eé]todo|cu[aá]l (es tu )?m[eé]todo|c[oó]mo (prefieres|deseas|quieres) pagar|con qu[eé] (pagas|pagar|te sientes))/i;
      if (/\?/.test(ult) && preguntaCualMetodo.test(ult)) {
        // SOLO LA FRASE DE LA PREGUNTA, no la burbuja entera (27/10/2026, su prueba H2: «¡Hola! Qué gusto…
        // ¿ya decidiste con qué método…?» venía en UNA burbuja y quitarla dejó al cliente sin respuesta).
        const frases = ult.split(/(?<=[.!?¡¿\n])\s+/);
        const sinLaPregunta = frases.filter((f) => !(/\?/.test(f) && preguntaCualMetodo.test(f))).join(" ").trim();
        console.log(`[tablero:ia] convo ${convo.id}: preguntó el método por su cuenta → se quita esa pregunta`);
        texto = [...burbujas.slice(0, -1), sinLaPregunta].filter((b) => b.trim()).join("\n\n").trim();
      }
    }
    // CON TOPE, la última burbuja es la que se mira (antes la pregunta agregada se perdía).
    texto = alTope(texto.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean), tope).join("\n\n");
    const ultimaBurbuja = texto.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean).pop() ?? "";
    // Con un PROBLEMA o una queja no va pregunta de venta («el yape me sale error» → «¿te indico cómo
    // adquirirlo?» era absurdo): ahí la IA ya habla de su problema o del asesor.
    // («No entiendo» con las opciones delante —`preguntaVaga`— no es un problema: no entiende qué elegir, y
    // su cierre es la pregunta de elegir, sola. Sin esto quedaba metida al final del párrafo, su HHH3.)
    const conProblema =
      !c.preguntaVaga && /\b(no (funciona|puedo|me deja|me llega|llega|abre|carga|sale|entiendo)|error|falla|problema|reclamo|molest|cansad|harto)\b/.test(delCliente);
    const n = c.opcionesDeCompra?.length ?? 0;
    const recientes = ultimos.filter((m) => m.role !== "user").map((m) => m.content ?? "").join("\n");
    // LA PREGUNTA DE ELEGIR, SOLA Y SIN REPETIRSE (28/10/2026, su prueba HU1/HU2): la IA la escribía
    // siempre igual («¿Cuál de las dos prefieres?») y a veces al final de un párrafo largo, donde no se
    // ve. Como el automático, va en su PROPIA burbuja, después de la lista de opciones; su frase se quita
    // de donde la haya puesto la IA y el bot pone una que rota.
    if (!c.nota && c.etapa === "venta" && n > 1 && !conProblema && !c.noOfrezcasImagenes && !c.sinPagoAprobado && !!texto) {
      const deElegir =
        /(cu[aá]l (de (las|los|estas|estos|ellas|ellos) |opci[oó]n |prefieres|eliges|escoges|te (gusta|llama|animas|quedas|convence|interesa|late))|por cu[aá]l|qu[eé] opci[oó]n)/i;
      const antes = texto;
      texto = texto
        .split(/\n\s*\n/)
        .map((b) =>
          b
            .split(/(?<=[.!?])[ \t]+/)
            .filter((f) => !(/[?¿]/.test(f) && deElegir.test(f)))
            .join(" ")
            .trim()
        )
        .filter(Boolean)
        .join("\n\n");
      if (texto !== antes) console.log(`[tablero:ia] convo ${convo.id}: su pregunta de elegir se quita del texto → va sola al final`);
      const ultima = texto.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean).pop() ?? "";
      // Si la IA cerró con OTRA pregunta (la de una duda), no se le suma otra encima.
      if (!/[?¿]/.test(ultima) || texto !== antes) {
        const opciones = n === 2 ? CIERRES_DE_DOS : CIERRES_DE_VARIAS;
        preguntaDeElegir = opciones.find((p) => !recientes.includes(p)) ?? opciones[0];
      }
    }
    // Ni cuando el bot cierra con la oferta de las imágenes (ésa ES la pregunta), ni con el cobro ya
    // abierto: ahí ya decidió y «¿te indico cómo adquirirlo?» no tiene sentido (H3, 27/10/2026).
    if (!preguntaDeElegir && n < 2 && !c.nota && c.etapa === "venta" && !conProblema && !c.noOfrezcasImagenes && !c.sinPagoAprobado && !!texto && !/[?¿]/.test(ultimaBurbuja)) {
      const pregunta = PREGUNTAS_DE_CIERRE.find((p) => !recientes.includes(p)) ?? PREGUNTAS_DE_CIERRE[0];
      console.log(`[tablero:ia] convo ${convo.id}: su respuesta no cerró con una pregunta → se agrega «${pregunta}»`);
      // La pregunta va en su propia burbuja; con tope, las de antes se juntan para que quepa.
      const partes = texto.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
      texto = [...alTope(partes, tope ? tope - 1 : null), pregunta].join("\n\n");
    }
  }
  // LA OFERTA DE LAS IMÁGENES ES LA ÚNICA PREGUNTA DEL CIERRE (H1/H2, 27/10/2026): la IA cerraba con
  // «¿te ayudo con los métodos de pago?» y debajo salía «¿te muestro unas imágenes?». Como la venta de
  // siempre, la oferta reemplaza su pregunta: se quita la frase con «?» de su última burbuja.
  if (c.noOfrezcasImagenes && texto) {
    const partes = texto.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
    const ult = partes.pop() ?? "";
    const sinPregunta = ult
      .split(/(?<=[.!?])\s+/)
      .filter((f) => !/[?¿]/.test(f))
      .join(" ")
      .trim();
    texto = [...partes, sinPregunta].filter(Boolean).join("\n\n");
  }
  // «(EL SISTEMA ENVÍA LOS DATOS)» (H3, 27/10/2026): la IA escribió eso sin que saliera nada. Lo que
  // haga el sistema lo hace el sistema; una frase que habla de él no es para el cliente.
  if (texto && /\bel sistema\b/i.test(texto)) {
    texto = texto
      .split(/\n\s*\n/)
      .map((b) =>
        b
          .split(/(?<=[.!?)])\s+/)
          .filter((f) => !/\bel sistema\b/i.test(f))
          .join(" ")
          .trim()
      )
      .filter(Boolean)
      .join("\n\n");
    console.log(`[tablero:ia] convo ${convo.id}: habló de «el sistema» → se quita esa frase`);
  }
  // «POR GUAYAQUIL, EN UN MOMENTO TE LLEGAN LOS DATOS» SIN MÉTODO ELEGIDO (H3, 27/10/2026): la IA no manda
  // datos, así que esa promesa es falsa. Como la venta de siempre (<<METODOS_PAGO>>), sale la lista de
  // métodos para que elija, en vez de su respuesta.
  if (
    c.sinMetodo &&
    texto &&
    /(te llega(n|r[aá]n)? los datos|te (paso|env[ií]o|mando|comparto) los datos|aqu[ií] (van|tienes|te dejo) los datos|ya (te )?(envi[eé]|mand[eé]|pas[eé]) los datos|los datos (ya )?(quedaron|fueron) enviados|datos de pago por aqu[ií])/i.test(texto)
  ) {
    console.log(`[tablero:ia] convo ${convo.id}: prometió los datos sin método elegido → sale la lista de métodos`);
    await c.sinMetodo();
    return true;
  }
  // «ESTOY REVISANDO TU COMPROBANTE» SIN NINGÚN COMPROBANTE (C1 en la copia, 27/10/2026): sin cobro abierto
  // también. Si en este turno no se leyó ninguno (no hay nota del sistema), la IA no puede decir que lo
  // recibió ni que lo está revisando; esas frases se quitan.
  if (!c.nota && !c.sinPagoAprobado && texto) {
    // (Y «enseguida te envío los datos» sin cobro abierto: no sale ninguno — T3 en la copia.)
    // (28/10/2026, su hay4: este filtro también borraba «apenas se confirme tu pago, te llega…», que solo
    // explica cómo se compra —y era la frase de «son dos opciones»—. Ahora solo caza el que dice que YA
    // recibió o está revisando un comprobante; y deja escrito qué quitó.)
    const revisa =
      /(recib[ií] tu (comprobante|pago|captura)|(estoy|est[aá]) (verificando|revisando|procesando|validando)|en un momento (lo )?(verifico|reviso|valido)|revisando tu comprobante|(enseguida|ahora|ya) te (env[ií]o|paso|mando) los datos|te llegan los datos|aqu[ií] (van|tienes) los datos)/i;
    const quitadas: string[] = [];
    texto = texto
      .split(/\n\s*\n/)
      .map((b) =>
        b
          .split(/(?<=[.!?¡¿])\s+/)
          .filter((f) => (revisa.test(f) ? (quitadas.push(f), false) : true))
          .join(" ")
          .trim()
      )
      .filter(Boolean)
      .join("\n\n");
    if (quitadas.length)
      console.log(`[tablero:ia] convo ${convo.id}: decía que revisaba un comprobante que no llegó → se quita «${quitadas.join(" ").slice(0, 120)}»`);
  }
  // SIN PAGO APROBADO, NADA DE «YA TE LLEGA»: esas frases se quitan, frase por frase.
  if (c.sinPagoAprobado && texto) {
    // Y tampoco «recibí tu comprobante / lo estoy verificando» (27/10/2026: el cliente escribió «ok,
    // mandaré 20 soles» SIN foto y la IA le dijo tres veces que lo estaba verificando) — salvo con nota
    // del sistema: ahí sí llegó un comprobante (a medias, o de otro monto) y puede decir que lo recibió.
    const promete = c.nota
      ? /(llegar[aá] tu|te llegar[aá]|te llega (el|tu)|recibir[aá]s tu|ya tienes (acceso|tu)|pago (confirmado|aprobado|validado)|en unos segundos|tu enlace (de descarga )?(llegar|est[aá])|ya (est[aá]|qued[oó]) (listo|aprobado|confirmado)|te (lo )?env[ií]o (ya|enseguida|ahora)|te comparto tu (material|acceso|enlace)|aqu[ií] (est[aá]|tienes|va) tu (material|enlace|acceso)|disfruta tu material)/i
      : /(llegar[aá] tu|te llegar[aá]|te llega (el|tu)|recibir[aá]s tu|ya tienes (acceso|tu)|pago (confirmado|aprobado|validado|recibido)|recibido correctamente|en unos segundos|tu enlace (de descarga )?(llegar|est[aá])|ya (est[aá]|qued[oó]) (listo|aprobado|confirmado)|te (lo )?env[ií]o (ya|enseguida|ahora)|recib[ií] tu (comprobante|pago|captura)|(estoy|est[aá]) (verificando|revisando|procesando|validando)|en un momento (lo )?(verifico|reviso|valido)|(sigue|est[aá]) en proceso|apenas (est[eé]|se) confirm|te comparto tu (material|acceso|enlace)|aqu[ií] (est[aá]|tienes|va) tu (material|enlace|acceso)|disfruta tu material)/i;
    const antes = texto;
    texto = texto
      .split(/\n\s*\n/)
      .map((b) =>
        b
          .split(/(?<=[.!?¡¿])\s+/)
          .filter((f) => !promete.test(f))
          .join(" ")
          .trim()
      )
      .filter(Boolean)
      .join("\n\n");
    if (texto !== antes) console.log(`[tablero:ia] convo ${convo.id}: prometía la entrega sin pago aprobado → se quita esa frase`);
    // NI UN ENLACE (27/10/2026, D1 en la copia): con «ya pagué» escrito y sin foto, la IA mandó «Pago recibido
    // correctamente» con un enlace INVENTADO del pack. Los enlaces del material los manda solo la entrega.
    const sinEnlaces = texto
      .split(/\n\s*\n/)
      .map((b) => b.split("\n").filter((l) => !/https?:\/\/|www\./i.test(l)).join("\n").trim())
      .filter(Boolean)
      .join("\n\n");
    if (sinEnlaces !== texto) {
      console.log(`[tablero:ia] convo ${convo.id}: escribió un enlace sin pago aprobado → se quita`);
      texto = sinEnlaces;
    }
  }
  const malos = prohibidos(texto);
  if (malos.length > 0) {
    // Se quitan las frases con montos ajenos: mejor una respuesta más corta que un precio falso.
    // (Burbuja por burbuja: antes se unía todo con espacios y las burbujas quedaban en una sola.)
    texto = texto
      .split(/\n\s*\n/)
      .map((b) =>
        b
          .split("\n")
          .map((linea) =>
            linea
              .split(/(?<=[.!?¿¡])[ \t]+/)
              .filter((frase) => prohibidos(frase).length === 0)
              .join(" ")
              .trim()
          )
          .filter(Boolean)
          .join("\n")
          .trim()
      )
      .filter(Boolean)
      .join("\n\n")
      .trim();
  }
  // NUNCA MUDO (27/10/2026): si los frenos dejaron la respuesta vacía y no salió nada más (ni muestras ni
  // los datos del cobro), sale una pregunta corta: un cliente sin respuesta es una venta perdida.
  if (!texto && preguntaDeElegir) {
    // La IA solo había escrito la pregunta de elegir: sale la del bot.
    texto = preguntaDeElegir;
    preguntaDeElegir = "";
  }
  if (!texto && !salieronMuestras && !reenvioPorCuenta) {
    const recientes = ultimosMensajes(convo.id, 8).filter((m) => m.role !== "user").map((m) => m.content ?? "").join("\n");
    texto =
      c.etapa === "venta" && !c.nota
        ? PREGUNTAS_DE_CIERRE.find((p) => !recientes.includes(p)) ?? PREGUNTAS_DE_CIERRE[0]
        : "¿En qué más te puedo ayudar? 😊";
    console.log(`[tablero:ia] convo ${convo.id}: la respuesta quedó vacía → sale «${texto}» (nunca mudo)`);
  }
  if (!texto) return salieronMuestras || reenvioPorCuenta;
  // **ASÍ** (markdown) no es negrita en WhatsApp: se ve con asteriscos de más. Se deja *así*.
  texto = texto.replace(/\*\*([^*\n]+)\*\*/g, "*$1*").replace(/^#{1,6}\s+/gm, "");
  // «PROCEDER» NO (28/10/2026, él lo pidió: «adquirirlo» suena mejor). La IA lo copia de las preguntas de
  // cierre del automático; aquí se cambia por «adquirirlo».
  texto = texto
    .replace(/(para )?revisar c[oó]mo proceder/gi, "para adquirirlo")
    .replace(/c[oó]mo proceder/gi, "cómo adquirirlo")
    .replace(/\bproceder\b/gi, "avanzar");
  // Negrita doble con otra negrita dentro («**Opción 1 – *COMIDA* · $3**»): una sola, sin las de dentro.
  texto = texto.replace(/\*\*([^\n]+?)\*\*/g, (_, x: string) => `*${x.replace(/\*/g, "")}*`).replace(/\*\*/g, "*");
  const burbujas = alTope(
    texto
      .split(/\n\s*\n/)
      .map((b) => b.trim())
      .filter(Boolean),
    tope
  );
  const plano = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{Mn}/gu, "").replace(/\*/g, "");
  // EL SEGURO DE «SON 2» Y DE LA PREGUNTA VAGA (28/10/2026, su hay4: a «que son 2» habló de una sola). Si su
  // respuesta no nombra TODAS las opciones, empieza diciendo cuáles son. Con su tope de burbujas, va en la
  // primera, para no pasarlo.
  if (c.confirmarOpciones && c.confirmarOpciones.length > 1 && burbujas.length > 0) {
    // Nombrada = alguna palabra que SOLO tiene ella aparece («el pack», «la de ropa», aunque no use el
    // nombre completo); así no se repite lo que la IA ya dijo con sus palabras.
    const palabras = (s: string) => plano(s).replace(/[^a-z0-9ñ\s]/g, " ").split(/\s+/).filter((w) => w.length >= 4);
    const dichas = new Set(palabras(burbujas.join(" ")));
    const suyas = c.confirmarOpciones.map((x) => palabras(x));
    const unicas = suyas.map((ws, i) => ws.filter((w) => suyas.every((o, j) => j === i || !o.includes(w))));
    // Y que DIGA que son varias opciones para elegir (28/10/2026, su MM3: nombró las dos —«el PACK trae todo
    // lo de COMIDA CASERA»— pero no dijo que eran dos opciones, y el cliente no lo entendió).
    const diceCuantas = /\b(dos|2|tres|3|cuatro|4)\s+(opciones|productos|alternativas|materiales)\b|\b(ambas|las dos|los dos) (opciones|productos)\b/.test(
      plano(burbujas.join(" "))
    );
    if (!diceCuantas || unicas.some((ws) => ws.length > 0 && !ws.some((w) => dichas.has(w)))) {
      const n = c.confirmarOpciones.length;
      const nombres = c.confirmarOpciones.map((x) => `*${x}*`);
      const linea = `Son ${n === 2 ? "dos" : n} opciones 😊: ${nombres.slice(0, -1).join(", ")} y ${nombres[n - 1]}.`;
      if (tope && burbujas.length >= tope) burbujas[0] = `${linea}\n${burbujas[0]}`;
      else burbujas.unshift(linea);
      console.log(`[tablero:ia] convo ${convo.id}: no nombró todas las opciones → empieza con «${linea}»`);
    }
  }
  // LA MISMA PREGUNTA DOS VECES (28/10/2026, su hay2: «Ahora sí, ¿con cuál método prefieres pagar?» + la lista
  // + «¿Cuál te queda más cómodo?»). Si la última burbuja es SOLO una pregunta y una burbuja anterior de esta
  // misma respuesta ya terminó preguntando, y las dos son del método o de elegir, la última sobra.
  if (burbujas.length >= 2) {
    const sobreElegir = /(m[eé]todo|pagar|pago|prefieres|c[oó]mod|eliges|cu[aá]l)/i;
    const ult = burbujas[burbujas.length - 1];
    const soloPregunta = /^¿[^¿]*\?[^\p{L}\p{N}¿?]*$/u.test(ult.trim());
    const antes = burbujas.slice(0, -1).find((b) => /\?[^\p{L}\p{N}¿?]*$/u.test(b.trim()) && sobreElegir.test(b.slice(b.lastIndexOf("¿"))));
    if (soloPregunta && antes && sobreElegir.test(ult)) {
      burbujas.pop();
      console.log(`[tablero:ia] convo ${convo.id}: repetía la pregunta («${ult.slice(0, 40)}») → sale una sola`);
    }
  }
  // LA PREGUNTA FINAL, EN SU PROPIA BURBUJA (28/10/2026, su hay2: el saludo y «¿ya te decidiste…?» iban en un
  // solo bloque y la pregunta no se veía). Como el automático: si la última burbuja termina en una pregunta
  // con texto antes, la pregunta sale aparte. Solo la última frase, solo si va al final, y sin pasar su tope.
  if (!(tope && burbujas.length >= tope) && burbujas.length > 0) {
    const ult = burbujas[burbujas.length - 1];
    const i = ult.lastIndexOf("¿");
    const pregunta = i > 0 ? ult.slice(i).trim() : "";
    const antes = i > 0 ? ult.slice(0, i).trim() : "";
    if (
      pregunta &&
      !pregunta.includes("\n") &&
      /\?[^\p{L}\p{N}¿?]*$/u.test(pregunta) &&
      antes.length >= 25 &&
      !/[:¿]$/.test(antes)
    ) {
      burbujas.splice(burbujas.length - 1, 1, antes, pregunta);
    }
  }
  // LA LISTA CORTA DE LAS OPCIONES, SOLO SI LA IA NO LAS NOMBRÓ TODAS (27/10/2026): si ya las explicó, no
  // se repite un texto fijo debajo.
  let alFinal = c.alFinal ?? [];
  if (c.opcionesSiFaltan && burbujas.length > 0 && (c.opcionesSiFaltan.siempre || preguntaDeElegir)) {
    const dicho = plano(burbujas.join(" "));
    if (c.opcionesSiFaltan.nombres.some((n) => !dicho.includes(plano(n)))) {
      alFinal = [c.opcionesSiFaltan.burbuja, ...alFinal];
      console.log(`[tablero] convo ${convo.id}: la IA no nombró todas las opciones → burbuja con las ${c.opcionesSiFaltan.nombres.length} opciones`);
    }
  }
  // La pregunta de elegir, sola y después de la lista (si salió la lista, va justo debajo).
  if (preguntaDeElegir && burbujas.length > 0) {
    const conLista = c.opcionesSiFaltan && alFinal[0] === c.opcionesSiFaltan.burbuja;
    alFinal = conLista ? [alFinal[0], preguntaDeElegir, ...alFinal.slice(1)] : [preguntaDeElegir, ...alFinal];
    console.log(`[tablero:ia] convo ${convo.id}: cierra con «${preguntaDeElegir}» en su propia burbuja`);
  }
  // CON LAS PAUSAS DE TUS AJUSTES (25/10/2026, punto 17), como la venta de siempre: la primera enseguida
  // y las demás separadas por «Delay entre mensajes» (Menús → Ajustes → Tiempos generales).
  if (burbujas.length > 0) await sendChunkedBotText(convo, burbujas.join("\n\n"), alFinal);
  return burbujas.length > 0;
}
