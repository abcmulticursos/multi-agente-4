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
import { sendBotText } from "@/lib/workflow/sender";
import { ultimosMensajes } from "./lector";
import { CEREBRO_DE_FABRICA } from "./datos";
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
 * EL CEREBRO QUE SE LE DA A LA IA. Lo FIJO va primero (el cerebro general, las reglas del dinero y el
 * dialecto: iguales en todos los turnos de este tablero), para que el proveedor lo cobre más barato
 * como prefijo repetido; lo que cambia en cada turno va detrás.
 */
function cerebro(c: ContextoDeLaIA): string {
  const montos = c.montosPermitidos.length
    ? `Los ÚNICOS montos que puedes mencionar son: ${c.montosPermitidos.join(", ")}${c.moneda ? ` (${c.moneda})` : ""}. Ningún otro número de dinero, ni sumas, ni descuentos.`
    : "NO menciones ningún precio ni monto de dinero: si preguntan cuánto cuesta, di que en un momento le compartes la información, sin inventar cifras.";
  return [
    // ── FIJO ──
    (c.cerebroGeneral ?? "").trim() || CEREBRO_DE_FABRICA,
    "REGLAS QUE NO SE ROMPEN: la conversación sigue una ruta armada por el dueño; contesta y devuélvelo a ella. No des datos de pago, números de cuenta, nombres de titular ni enlaces: eso lo envía el sistema. No inventes contenido, beneficios, plazos ni condiciones. Escribe en español neutro.",
    // El mismo formato que pide la venta de siempre: en WhatsApp la negrita es UN asterisco.
    "FORMATO: en WhatsApp *palabra* va en negrita (UN asterisco a cada lado, nunca dos). Resalta solo 1 a 3 palabras clave por mensaje.",
    c.dialecto ? `DIALECTO (manda sobre todo lo demás): ${c.dialecto}` : "",
    // ── LO DE ESTE TURNO ──
    loQueSabe(c),
    c.ofreciendoAhora
      ? `LO QUE LE ESTÁS OFRECIENDO AHORA: ${c.ofreciendoAhora}. Si pregunta «¿este es otro?», «¿qué es esto?» o algo así, habla de ESTE, y si ya compró otro, dile con claridad que es distinto de lo que compró.`
      : "",
    montos,
    c.instrucciones?.trim() ? `EN ESTA ETAPA, ADEMÁS: ${c.instrucciones.trim().slice(0, 3000)}` : "",
    c.completar ? `Si dice que quiere completar, pagar la diferencia o pasarse a «${c.completar.para}», usa la herramienta completar_al_otro.` : "",
    c.pedirCorreo ? "Si pide que le envíes lo que ya recibió a su correo (email), usa la herramienta enviar_por_correo." : "",
    // LOS AVISOS AL DUEÑO, con la misma regla que la venta de siempre (25/10/2026).
    "PROBLEMAS DEL CLIENTE (pago, descarga, acceso, uso…): primero intenta resolverlo tú, al menos 2 veces, con lo que sabes. Si sigue sin resolverse o está molesto, pregúntale: «¿Deseas que un asesor especializado se comunique contigo?». SOLO si responde que sí, usa notify_admin_emergency con el problema concreto. Nunca en su primer mensaje sobre el problema.",
    "SI PIDE HABLAR CON UNA PERSONA (o quiere comprar pero algo no le queda claro y eso lo frena): ofrécele un asesor con la misma pregunta y, SOLO si dice que sí, usa notify_admin_advisor_request. No lo uses para dudas normales (precio, contenido, formato): esas las contestas tú.",
    c.preguntaPendiente
      ? `Al final, invítalo con naturalidad a responder lo que quedó pendiente: «${c.preguntaPendiente.slice(0, 300)}».`
      : "Cierra con una frase corta que invite a seguir.",
    c.nota ? `LO QUE ACABA DE PASAR (dilo con tus palabras): ${c.nota}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function historial(conversationId: number): ChatCompletionMessageParam[] {
  return ultimosMensajes(conversationId, 24)
    .filter((m) => (m.content ?? "").trim())
    .map((m) => ({
      role: m.role === "user" ? ("user" as const) : ("assistant" as const),
      content: m.content.slice(0, 1500),
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
            "«No quiero X» nunca es elegir X. «El otro», «el primero», «el de 10» se resuelven con lo que el BOT le acaba de ofrecer.",
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
      "Use ONLY when the customer says they did not receive, lost, or wants again the material/links they were ALREADY sent. It resends what was delivered.",
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
      "Use when the customer asks for the payment details again (account, number, where to pay) or says yes to paying now. The system sends the payment details of the method they already chose, with the right price.",
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
      if (r.usage) console.log(`[tablero:ia:tokens] convo ${convo.id}: entrada ${r.usage.prompt_tokens} · salida ${r.usage.completion_tokens}`);
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
  const malos = prohibidos(texto);
  if (malos.length > 0) {
    // Se quitan las frases con montos ajenos: mejor una respuesta más corta que un precio falso.
    texto = texto
      .split(/(?<=[.!?¿¡\n])\s+/)
      .filter((frase) => prohibidos(frase).length === 0)
      .join(" ")
      .trim();
  }
  if (!texto) return salieronMuestras;
  // **ASÍ** (markdown) no es negrita en WhatsApp: se ve con asteriscos de más. Se deja *así*.
  texto = texto.replace(/\*\*([^*\n]+)\*\*/g, "*$1*").replace(/^#{1,6}\s+/gm, "");
  const burbujas = texto
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean)
    .slice(0, 3);
  for (const b of burbujas) await sendBotText(convo, b);
  return burbujas.length > 0;
}
