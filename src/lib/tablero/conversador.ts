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

export interface ContextoDeLaIA {
  /** Lo que el cliente tiene delante: el texto de la última pregunta del bot, si la hay. */
  preguntaPendiente?: string;
  /** Los únicos montos que la IA puede nombrar (los de su cobro abierto, en su país). */
  montosPermitidos: number[];
  moneda?: string;
  /** Lo que acaba de pasar y la IA debe decir con sus palabras (p. ej. «pago recibido»). */
  nota?: string;
  /** Si ya se le entregó algo: la IA puede reenviarlo si el cliente dice que no le llegó. */
  reenviar?: () => Promise<void>;
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

function cerebro(c: ContextoDeLaIA): string {
  const montos = c.montosPermitidos.length
    ? `Los ÚNICOS montos que puedes mencionar son: ${c.montosPermitidos.join(", ")}${c.moneda ? ` (${c.moneda})` : ""}. Ningún otro número de dinero, ni sumas, ni descuentos.`
    : "NO menciones ningún precio ni monto de dinero: si preguntan cuánto cuesta, di que en un momento le compartes la información, sin inventar cifras.";
  return [
    "Eres el asistente de ventas de esta tienda por WhatsApp. La conversación sigue una ruta armada por el dueño; tu papel es contestar con calidez y brevedad lo que el cliente pregunta y devolverlo a la ruta.",
    "Usa SOLO lo que ya se le dijo al cliente en esta conversación. No inventes contenido, beneficios, plazos ni condiciones que no aparezcan arriba.",
    montos,
    "No des datos de pago, números de cuenta ni enlaces: eso lo envía el sistema.",
    c.preguntaPendiente
      ? `Al final, invítalo con naturalidad a responder lo que quedó pendiente: «${c.preguntaPendiente.slice(0, 300)}».`
      : "Cierra con una frase corta que invite a seguir.",
    "Escribe en español neutro, en 1 a 3 párrafos cortos separados por una línea en blanco. Sin listas largas.",
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

const HERRAMIENTA_DE_REENVIO = {
  type: "function" as const,
  function: {
    name: "reenviar_material",
    description:
      "Use ONLY when the customer says they did not receive, lost, or wants again the material/links they were ALREADY sent. It resends what was delivered.",
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
  for (let intento = 0; intento < 2; intento++) {
    try {
      const r = await getClient().chat.completions.create({
        model: modelo,
        messages: [
          { role: "system", content: cerebro(c) + aviso },
          ...historial(convo.id),
        ],
        temperature: 0.6,
        ...(c.reenviar && intento === 0 ? { tools: [HERRAMIENTA_DE_REENVIO] } : {}),
      });
      // «NO ME LLEGÓ»: se reenvía lo entregado, y la IA lo acompaña con una frase suya.
      const pidioReenvio = r.choices[0]?.message?.tool_calls?.some(
        (t) => t.type === "function" && t.function.name === "reenviar_material"
      );
      if (pidioReenvio && c.reenviar) {
        console.log(`[tablero:ia] convo ${convo.id}: pidió que le reenvíen el material`);
        await c.reenviar();
        return true;
      }
      texto = (r.choices[0]?.message?.content ?? "").trim();
    } catch (err) {
      console.error(`[tablero:ia] convo ${convo.id}: la IA no respondió`, err);
      return false;
    }
    const malos = prohibidos(texto);
    if (malos.length === 0) break;
    console.log(`[tablero:ia] convo ${convo.id}: nombró montos que no son suyos (${malos.join(", ")}), se le pide otra vez`);
    aviso = `\n\nIMPORTANTE: tu respuesta anterior nombró montos no permitidos (${malos.join(", ")}). No los repitas.`;
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
  if (!texto) return false;
  const burbujas = texto
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean)
    .slice(0, 3);
  for (const b of burbujas) await sendBotText(convo, b);
  return burbujas.length > 0;
}
