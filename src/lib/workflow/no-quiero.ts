/**
 * «NO QUIERO» (18/11/2026). Pedido de Alberto, el día que Meta le bloqueó dos números: «hay personas que me han
 * mandado a la mierda hoy por ser tan insistentes… quisiera que cuando la persona decida que no quiere nada, el bot
 * le diga…». Contados ese día en FLORES DE PAPEL: 8 clientes dijeron que no y siguieron recibiendo 49 mensajes del
 * bot (intro, ofertas, seguimientos), hasta 13 uno solo.
 *
 * Cómo funciona (el diseño que él aprobó):
 *   1. Un rechazo ESCRITO (o dicho en un audio) → pregunta «Disculpa si hubo un malentendido…» con [Sí quiero] [Ya no].
 *      Mientras no conteste, lo programado (seguimientos, recordatorios) espera: no sale nada.
 *   2. «Ya no» → la despedida, el bot se apaga en ese chat (modo humano), se cancela lo programado y queda la
 *      etiqueta «🚫 no quiere».
 *   3. «Sí quiero» → sigue la venta; lo programado se corre lo que estuvo en pausa (no le llega todo de golpe).
 *   4. Un segundo rechazo después de «Sí quiero» → la despedida directa, sin volver a preguntar.
 *
 * Los frenos, porque «no quiero que me salga mal mis flores»:
 *   - Un BOTÓN nunca cuenta como rechazo (el «No gracias» del regalo, por ejemplo). Y un texto escrito igual a un
 *     botón de lo último que se le mandó sigue al botón.
 *   - Nunca si ya pagó o mandó un comprobante (una foto o un documento) en los últimos dos días.
 *   - NO se decide por palabras: las palabras solo filtran (gratis) qué mensajes se le muestran a la IA, y la IA
 *     decide con la conversación delante. Así «No, quiero aprender» como respuesta a «¿tienes experiencia?» —el
 *     botón de su pregunta de experiencia, escrito— no es un rechazo. Ante la duda, NO es rechazo.
 */
import {
  cancelPendingActionsForConvo,
  compradoresDelTablero,
  correrLoProgramado,
  getConversationById,
  getTestMessageButtons,
  ponerNoQuiero,
  setMode,
  type ConversationRow,
} from "@/lib/db";
import { getClient } from "@/lib/openrouter";
import { ultimosMensajes } from "@/lib/tablero/lector";
import { sendBotButtons, sendBotText } from "@/lib/workflow/sender";

const PREGUNTA =
  "Disculpa si hubo un malentendido. Para no causarte molestias, indícame si deseas seguir recibiendo información:";
const BOTON_SI = { id: "noquiero:si", title: "Sí quiero" };
const BOTON_NO = { id: "noquiero:no", title: "Ya no" };
const DESPEDIDA =
  "No te preocupes 😊 A partir de ahora ya no recibirás más información ni respuestas. Antes de despedirme, recuerda que el chat quedará deshabilitado, así que cualquier mensaje que escribas, incluso un comprobante, no tendrá respuesta. ¡Que tengas un buen día y que te vaya muy bien en todo!";
const SIGUE = "¡Perfecto! 😊 Sigo aquí para ayudarte. Cuéntame, ¿qué te gustaría saber?";

/** Los estados en que ya compró (los mismos de la etiqueta «pago»). */
const ESTADOS_DE_COMPRADOR = new Set([
  "payment_approved",
  "awaiting_delivery_preference",
  "awaiting_email",
  "awaiting_gift_consent",
  "awaiting_facebook_comment",
]);

function normal(texto: string): string {
  return (texto ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .replace(/[^a-z0-9ñ\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * EL FILTRO GRATIS: ¿vale la pena preguntarle a la IA? Ancho a propósito (un «no» suelto pasa): aquí no se decide
 * nada, solo se evita gastar una llamada en los mensajes que no traen ninguna negativa ni queja.
 */
const PUEDE_SER_RECHAZO =
  /\b(no|nada|basta|stop|dej[aeo]n?|dejame|molest\w*|bloque\w*|report\w*|denunci\w*|estaf\w*|insist\w*|pesad\w*|spam|cansad\w*|olvidalo|mierda|carajo|ctm|conchatumadre|hdp|puta|joder|verga|pendej\w*|idiota|imbecil|estupid\w*|maldit\w*|webon\w*|huevon\w*|cabron\w*)\b/;

/** ¿Ya pagó, o mandó algo que puede ser un comprobante? Entonces esto no corre nunca. */
function pagoOComprobante(convo: ConversationRow): boolean {
  if ((convo.paid_total_cents ?? 0) > 0) return true;
  if (convo.state && ESTADOS_DE_COMPRADOR.has(convo.state)) return true;
  if (convo.compra_manual_meta) return true;
  if (compradoresDelTablero().has(convo.id)) return true;
  const hace2dias = Math.floor(Date.now() / 1000) - 2 * 86400;
  return ultimosMensajes(convo.id, 40).some(
    (m) => m.role === "user" && (m.media_type === "image" || m.media_type === "document") && (m.created_at ?? 0) >= hace2dias
  );
}

/** ¿Lo escrito es igual a un botón de lo último que se le mandó con botones? Entonces sigue al botón. */
function esUnBotonEscrito(convo: ConversationRow, texto: string): boolean {
  const t = normal(texto);
  if (!t) return false;
  const recientes = ultimosMensajes(convo.id, 15).reverse();
  for (const m of recientes) {
    if (m.role === "user") continue;
    let botones: Array<{ title: string }> = [];
    try {
      botones = getTestMessageButtons(m.id);
    } catch {
      botones = [];
    }
    if (botones.length === 0) continue;
    return botones.some((b) => normal(b.title) === t);
  }
  return false;
}

/** LA IA DECIDE, con la conversación delante. Ante la duda (o si falla), NO es rechazo. */
async function laIADiceQueNoQuiere(convo: ConversationRow, texto: string): Promise<boolean> {
  const modelo = process.env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini";
  const ultimos = ultimosMensajes(convo.id, 10)
    .filter((m) => (m.content ?? "").trim())
    // El mensaje del bot entero (la pregunta suele ir AL FINAL de una burbuja larga: así se cortaba y «No quiero
    // aprender» —la respuesta a «¿tienes experiencia?» de su intro— se leía como rechazo).
    .map((m) => (m.role === "user" ? `CLIENTE: ${m.content.slice(0, 300)}` : `BOT: ${m.content.slice(-1500)}`))
    .join("\n");
  try {
    const r = await getClient().chat.completions.create({
      model: modelo,
      temperature: 0,
      ...({ reasoning: { enabled: false } } as object),
      messages: [
        {
          role: "system",
          content:
            "Decides si, con su ÚLTIMO mensaje, el cliente dice que NO QUIERE seguir: que no le interesa la oferta, que no la quiere, que lo dejen de escribir, que le molesta la insistencia, que se despide rechazando, o insulta. Responde SOLO «SI» o «NO».\n" +
            "Es SI, por ejemplo: «no gracias», «no me interesa», «por ahora no gracias», «no puedo pagar, gracias», «no quiero hacer flores», «ya no me escriban», «¿vas a seguir?» dicho con fastidio, «ya me estafaron así, no gracias», un insulto.\n" +
            "Es NO: si responde «no» a una pregunta concreta del bot y sigue la charla (por ejemplo «¿tienes experiencia?» → «No, quiero aprender»; «¿te muestro fotos?» → «no»); si después del «no» dice lo que SÍ quiere («no quiero aprender» leído como «no, quiero aprender»; «no, quiero el otro»); si es lo primero que escribe, antes de que el bot le haya ofrecido nada;si rechaza solo una opción, un método o un producto pero sigue interesado («no tengo yape», «no el otro»); si pone una duda o una objeción que espera respuesta («¿y si no me llega?», «no sé si es real»); si dice que comprará después («ahorita no tengo, en la quincena te pago»).\n" +
            "Si no queda claro, responde NO.",
        },
        {
          role: "user",
          content: `CONVERSACIÓN RECIENTE:\n${ultimos}\n\nÚLTIMO MENSAJE DEL CLIENTE: «${texto.slice(0, 500)}»\n\nRespuesta (SI o NO):`,
        },
      ],
    });
    const dicho = normal(r.choices[0]?.message?.content ?? "");
    const rechaza = dicho === "si" || dicho.startsWith("si ");
    console.log(`[no-quiero] convo ${convo.id}: «${texto.slice(0, 60)}» → ${rechaza ? "NO QUIERE" : "sigue la charla"}`);
    return rechaza;
  } catch (err) {
    console.error(`[no-quiero] convo ${convo.id}: la IA no pudo decidir; no se trata como rechazo`, err);
    return false;
  }
}

async function preguntar(convo: ConversationRow): Promise<void> {
  ponerNoQuiero(convo.id, "preguntado");
  await sendBotButtons(convo, PREGUNTA, [BOTON_SI, BOTON_NO]);
  console.log(`[no-quiero] convo ${convo.id}: dijo que no; se le pregunta si quiere seguir recibiendo información (lo programado espera)`);
}

async function despedir(convo: ConversationRow): Promise<void> {
  cancelPendingActionsForConvo(convo.id);
  ponerNoQuiero(convo.id, "fuera");
  setMode(convo.id, "HUMAN");
  await sendBotText(convo, DESPEDIDA);
  console.log(`[no-quiero] convo ${convo.id}: «Ya no» → despedida, bot apagado en este chat y lo programado cancelado`);
}

/** Sigue la venta: lo programado se corre lo que estuvo en pausa, para que no le llegue todo de golpe. */
function seguir(convo: ConversationRow): void {
  ponerNoQuiero(convo.id, "sigue");
  const desde = Number(convo.no_quiero_at ?? 0);
  if (desde > 0) correrLoProgramado(convo.id, Math.floor(Date.now() / 1000) - desde);
}

/**
 * LA PUERTA. Va en cada canal después de «¿le contestamos?» y de la moderación, y antes del tablero y del motor de
 * siempre. Devuelve true si atendió el turno (y entonces nadie más contesta).
 */
export async function atenderNoQuiero(
  convo: ConversationRow,
  texto: string,
  opciones: { esBoton: boolean; idBoton?: string | null; esTextoOAudio: boolean }
): Promise<boolean> {
  let fresh = getConversationById(convo.id) ?? convo;
  // Dijo «Ya no» y aun así llegó aquí: el chat está en modo humano, así que fue el dueño quien volvió a encender el
  // bot en ese chat. Se le respeta: vuelve a empezar como cualquiera (y se va la etiqueta «🚫 no quiere»).
  if (fresh.no_quiero === "fuera") {
    ponerNoQuiero(fresh.id, null);
    fresh = { ...fresh, no_quiero: null };
  }
  const t = normal(texto);

  if (fresh.no_quiero === "preguntado") {
    const enInstagram = fresh.channel === "instagram";
    // Su respuesta es lo ÚLTIMO que escribió (el texto puede traer la ráfaga entera).
    const u = normal(texto.split("\n").pop() ?? "");
    const dijoSi = opciones.idBoton === BOTON_SI.id || u === normal(BOTON_SI.title) || u === "si" || (enInstagram && u === "1");
    const dijoNo = opciones.idBoton === BOTON_NO.id || u === normal(BOTON_NO.title) || (enInstagram && u === "2");
    if (dijoNo) {
      await despedir(fresh);
      return true;
    }
    if (dijoSi) {
      seguir(fresh);
      await sendBotText(fresh, SIGUE);
      console.log(`[no-quiero] convo ${fresh.id}: «Sí quiero» → sigue la venta`);
      return true;
    }
    // Escribió otra cosa: si vuelve a decir que no, la despedida; si no, sigue la venta con su mensaje.
    if (!opciones.esBoton && opciones.esTextoOAudio && PUEDE_SER_RECHAZO.test(t) && (await laIADiceQueNoQuiere(fresh, texto))) {
      await despedir(fresh);
      return true;
    }
    seguir(fresh);
    return false;
  }

  if (opciones.esBoton || !opciones.esTextoOAudio) return false;
  if (!PUEDE_SER_RECHAZO.test(t)) return false;
  if (pagoOComprobante(fresh)) return false;
  if (esUnBotonEscrito(fresh, texto)) return false;
  if (!(await laIADiceQueNoQuiere(fresh, texto))) return false;
  if (fresh.no_quiero === "sigue") await despedir(fresh);
  else await preguntar(fresh);
  return true;
}
