import fs from "node:fs";
import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionMessageToolCall,
} from "openai/resources/chat/completions";
import {
  getConversationById,
  getLatestUserMessage,
  type MessageRow,
} from "@/lib/db";
import { resolveMediaAbsPath } from "@/lib/meta/media";
import { SYSTEM_PROMPT } from "@/lib/system-prompt";
import { getEffectivePriceSoles } from "@/lib/workflow/config";
import {
  REGISTER_PAYMENT_TOOL,
  executeRegisterPayment,
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
}

function buildSystemPrompt(ctx: ReplyContext): string {
  let prompt = SYSTEM_PROMPT;
  if (ctx.clientName) {
    prompt += `\n\nINFO DEL CLIENTE: el cliente se llama "${ctx.clientName}" (lo dijo él mismo en la conversación). Úsalo solo cuando aporte naturalidad — no lo repitas en cada mensaje.`;
  } else if (ctx.pushName) {
    prompt += `\n\nINFO DEL CLIENTE: en WhatsApp aparece como "${ctx.pushName}", pero NO nos lo dijo explícitamente. Si decides usar su nombre, hazlo con discreción — a algunas personas no les gusta que les digan su nombre sin haberlo compartido.`;
  }

  // Inyectamos el precio efectivo para ESTA conversación. Si el cliente
  // entró en etapa de oferta (discount_active=1) el precio reducido es la
  // referencia para todo: lo que el bot cita al cliente y lo que validamos.
  if (ctx.conversationId) {
    const convo = getConversationById(ctx.conversationId);
    const discountActive = !!convo?.discount_active;
    const effectivePrice = getEffectivePriceSoles(discountActive);
    prompt += `\n\nPRECIO EFECTIVO PARA ESTE CLIENTE: S/.${effectivePrice}. Este es el ÚNICO precio que debes citar cuando te pregunten cuánto cuesta. Cuando te llegue un comprobante, llamá register_payment_amount con el monto exacto del comprobante — el sistema valida internamente contra este precio efectivo.`;
    if (discountActive) {
      prompt += ` (Este cliente entró en etapa de oferta — el precio bajó de S/.10 a S/.${effectivePrice}. Si te pregunta por qué es más barato, podés decirle que es una promoción especial por seguir interesado/a.)`;
    }

    // Bloque especifico para el estado de "esperando que confirme el comentario
    // de FB" — el LLM NO debe inventar links de regalo; el sistema los manda.
    if (convo?.state === "awaiting_facebook_comment") {
      prompt += `\n\n⚠️ ESTADO ACTUAL: AWAITING_FACEBOOK_COMMENT — Al cliente se le pidió que comente un post de Facebook y luego escriba la palabra exacta *COMENTADO* aquí mismo. Cuando lo escriba (o use confirmaciones equivalentes como "ya lo hice", "listo", "hecho", "ya está"), el SISTEMA AUTOMÁTICAMENTE le envía el regalo (un link de Drive con un PDF extra).

REGLA DURA: TÚ NO tienes el link del regalo. NUNCA prometas un enlace, NUNCA inventes una URL tipo "https://drive.google.com/your-gift-link" o cualquier otra, NUNCA digas "te enviaré el enlace" como si lo tuvieras vos.

Si el cliente pregunta por el regalo o dice algo que NO califique como confirmación (ej. "¿qué enlace?", "no entiendo", "todavía no comenté", "voy a comentar"), respondele guiándolo a la palabra clave SIN inventar nada:
  "¡Genial! Para enviarte tu regalito al instante, comentá el post de Facebook y luego escribime aquí mismo la palabra *COMENTADO* — al momento te llega el material. 🎁"
NO le pegues link alguno, NO le digas que ya está enviado, NO mientas.`;
    }

    // Instrucción para que el LLM emita un marcador de resumen al final
    // de CADA respuesta. El sistema lo extrae y lo sincroniza a NocoDB
    // como Resumen del lead, sin que el cliente lo vea.
    prompt += `\n\nMARCADOR DE RESUMEN INTERNO — OBLIGATORIO EN CADA RESPUESTA:
Al final de cada respuesta tuya, después del CTA (si va), agregá en una NUEVA LÍNEA un marcador con un resumen breve de qué pasó en este turno con el cliente. Formato EXACTO:

<<RESUMEN: descripción de 1 línea>>

Ejemplos válidos:
- <<RESUMEN: El usuario preguntó sobre el precio del curso>>
- <<RESUMEN: El usuario quiere saber si se puede pagar por Yape>>
- <<RESUMEN: El usuario pidió ver una muestra del material>>
- <<RESUMEN: El usuario está dudando si el curso sirve para su hija de 5 años>>
- <<RESUMEN: El usuario completó la compra vía Yape por S/.10>>

Reglas:
- 1 sola línea, máximo 200 caracteres.
- Tercera persona ("El usuario..."), describiendo lo que hizo o preguntó en ESTE turno.
- Este marcador NO es visible para el cliente — el sistema lo borra antes de enviar tu respuesta al WhatsApp.
- SIEMPRE incluí el marcador, en TODA respuesta — sin excepción.
- NO usés comillas dentro del marcador ni signos > en medio.`;

    // Reglas COMUNES a los estados post-pago.
    const postPaid =
      convo?.state === "payment_approved" ||
      convo?.state === "awaiting_email" ||
      convo?.state === "awaiting_gift_consent" ||
      convo?.state === "awaiting_facebook_comment";
    if (postPaid && convo) {
      prompt += `\n\n⚠️ ESTE CLIENTE YA COMPLETÓ EL PAGO. Pagó S/.${convo.paid_total_cents / 100} (total acreditado).
- PROHIBIDO ofrecer método de pago o CTAs de venta tipo "¿Te animaste a adquirirlo?" — YA COMPRÓ. En esta etapa NO va CTA de venta al final.
- PROHIBIDO decir "Si tienes alguna duda, aquí estoy", "Cualquier cosa avísame", "Estoy para ayudarte" — el bot NO es soporte continuo.
- Si el cliente comenta algo del monto pagado: respondé breve "El pago ya está aprobado, todo en orden — pagaste S/.${convo.paid_total_cents / 100} y queda registrado." Sin más.
- Si el cliente pregunta por su enlace del curso ("¿dónde está mi enlace?", "¿este es el que compré?", "¿cómo descargo?"): respondé MUY ESPECÍFICA desde la PRIMERA respuesta. NO digas vagamente "más arriba" — decile literalmente: "Tu enlace está en el mensaje del *video instructivo con el ✅ PAGO APROBADO* que recibiste arriba, dentro del texto que acompaña al video. Puedes tocarlo desde allí para descargarlo." Si pidió su correo electrónico, también está en su bandeja de entrada. NO le mandes link nuevo.
- Si reporta un problema TÉCNICO real (no puede descargar, link no abre): invocá notify_admin_emergency.`;
    }

    // AWAITING_EMAIL: bot pidió el correo. Dejamos al LLM conversar
    // naturalmente con el cliente — solo le marcamos qué NO hacer para
    // no empujar el pedido de correo fuera de vista.
    if (convo?.state === "awaiting_email") {
      prompt += `\n\nESTADO: AWAITING_EMAIL — Le pediste el correo electrónico al cliente para enviarle el enlace del material a su bandeja de entrada (además del que ya recibió en el chat hace un momento). Ese pedido está visible justo arriba en la pantalla.

Conversá natural con el cliente — si pregunta cosas legítimas (¿para qué es?, ¿es necesario?, ¿es seguro?, qué incluye, etc.), respondé con tus palabras de forma útil y cálida. Tono honesto: el correo NO es obligatorio, es solo una conveniencia para que el enlace no se pierda con el tiempo. Si el cliente decide no enviarlo, todo bien.

OMITÍ EL CTA AL FINAL en este estado — la regla general dice "siempre cerrar con pregunta", pero acá es EXCEPCIÓN. Cerrá tu respuesta de forma natural sin pregunta al final. El cliente decide cuándo (y si) mandar su correo.

QUÉ NO HACER:
- NO insistas con el correo. NO cierres tu mensaje con preguntas tipo "¿me lo envías?", "¿cuándo lo mandas?", "¿me das tu correo?" — eso se siente invasivo.
- NO repitas el enlace de descarga del curso (el cliente ya lo recibió arriba).
- NO uses frases tipo "ya tienes acceso a...", "disfruta el material" — esas van al cierre final del ciclo, no acá.
- NO celebres el pago como si recién ocurriera. PROHIBIDAS frases tipo "¡Pago confirmado!", "¡Listo, tu pago fue aprobado!", "Ahora recibirás el acceso al Pack PDF", "Tu compra fue procesada con éxito", "¡A disfrutar del material!" o similares. La confirmación del pago YA SE LE DIO al cliente en el video ✅ PAGO APROBADO que está arriba en la conversación. Si el cliente vuelve a mencionar el pago (ej. "ok pagué", "ya está", "gracias por la confirmación"), respondé MUY breve sin repetir esa confirmación — ej. "¡De nada! 😊" y nada más.
- Si el cliente no manda el correo, esperá tranquilo. A los 5 min el sistema avanza solo con el regalo de Facebook.`;
    }

    // AWAITING_GIFT_CONSENT: el bot mandó la pregunta del regalo extra.
    // Esperamos sí / no del cliente. Si responde ambiguo o pregunta,
    // el LLM acá responde sin presionar.
    if (convo?.state === "awaiting_gift_consent") {
      prompt += `\n\nESTADO: AWAITING_GIFT_CONSENT — Le acabás de ofrecer al cliente un regalito ADICIONAL EXTRA (PDFs bonus gratis). La pregunta está visible justo arriba en su pantalla.

Conversá natural si pregunta cosas legítimas ("¿qué es?", "¿qué incluye?", "¿es gratis?", "¿qué tengo que hacer?"). Explicale brevemente que es un PDF bonus gratuito como bonificación adicional al curso que ya tiene. NO des instrucciones detalladas todavía (eso viene SOLO si acepta).

OMITÍ EL CTA AL FINAL en este estado — la regla general dice "siempre cerrar con pregunta", pero acá es EXCEPCIÓN. El cliente decide. Si sigue preguntando, respondé y dejá tu mensaje sin pregunta final.

QUÉ NO HACER:
- NO insistas para que acepte. NO termines con "¿lo querés?", "¿te animás?", "¿decime ya?".
- NO menciones el link de Facebook ni el detalle de cómo recibir el regalo — esas instrucciones se mandan automáticamente DESPUÉS de que el cliente diga "sí" claramente.
- Si el cliente no responde claro (sí/no), el sistema queda esperando indefinidamente — no lo apurés.
- Si el cliente dice algo neutro tipo "ok" o "está bien" ambiguo, puedes preguntar UNA vez "¿Lo quieres entonces? 😊" — pero solo una vez en todo el flujo.`;
    }

    // AWAITING_FACEBOOK_COMMENT: ya hay otro bloque arriba sobre "no
    // inventes link". Acá sumamos: no repetir las instrucciones del FB
    // + distinguir explícitamente entre "enlace del curso" y "enlace del
    // regalo" (es un punto de confusión común).
    if (convo?.state === "awaiting_facebook_comment") {
      prompt += `\n\nADICIONAL para AWAITING_FACEBOOK_COMMENT:
- Las instrucciones del regalo (post de FB + "escribe COMENTADO") ya están visibles en la pantalla del cliente. NO las repitas literalmente.
- Si dice "gracias", "ok", o acknowledgment simple: respondé MUY corto y nada más.

IMPORTANTE — DISTINGUIR LOS DOS ENLACES:
En esta etapa hay DOS enlaces distintos en juego y el cliente puede confundirse. SIEMPRE aclarale cuál es cuál:
  1. El ENLACE DE TU CURSO (lo que compró): está ARRIBA en la conversación, dentro del mensaje del video instructivo con el ✅ PAGO APROBADO. También lo tiene en su correo si lo dio.
  2. El ENLACE DE FACEBOOK (el que recibió hace un momento): es para que comente el post y reciba el REGALO ADICIONAL (un PDF bonus). NO es el material que compró.

Si el cliente pregunta cosas como "¿este es el que compré?", "¿este es mi material?", "¿de qué se trata este enlace?", "¿es lo que pagué?": respondele CLARO que NO, que este enlace es del REGALITO EXTRA (para comentar en Facebook), y que su material comprado está MÁS ARRIBA en la conversación con el video instructivo que recibió al aprobarse el pago.

Ejemplo de respuesta correcta (tuteo peruano):
"¡Tranquila! No, este enlace es del *regalito extra* — es el post de Facebook donde dejas un comentario y te enviamos un PDF bonus 🎁. Tu *material del curso* está arriba en la conversación, en el mensaje con el video instructivo ✅. Puedes tocarlo desde allí para descargarlo."

NO digas frases vagas tipo "el enlace está disponible para ti" o "ya lo tienes" — sé ESPECÍFICA: arriba en la conversación, mensaje del video instructivo, ✅ PAGO APROBADO.`;
    }

    // PAYMENT_APPROVED puro (ciclo completo, ya recibió el regalo de FB).
    if (convo?.state === "payment_approved") {
      prompt += `\n\nESTADO: PAYMENT_APPROVED — El cliente ya completó todo el ciclo. Tu rol cerró.
- Cerrá con frases que mencionen al peque (el estudio es para el niño/a) y NO inviten a más preguntas. Ejemplos válidos:
  - "¡A disfrutar del material junto a tu peque! 🎉"
  - "Que lo disfruten mucho juntos, tu peque lo va a aprovechar 📚"
  - "Éxitos en este nuevo camino con tu peque ✨"
  - "Disfruta cada página junto con tu peque ❤️"
- Si pregunta algo del material → UNA SOLA frase redirigiendo al video instructivo + cerrá con una de las frases que mencionan al peque.`;
    }
  }
  // Instrucciones específicas sobre la tool de pago — solo se añaden si la
  // tool está disponible (cuando hay conversationId).
  if (ctx.conversationId) {
    prompt += `

VALIDACIÓN DE PAGOS:
- SOLO podés llamar register_payment_amount cuando el cliente realmente envió una IMAGEN (foto/captura) del comprobante en este turno. Si el cliente solo te dice por TEXTO "ya pagué", "listo, ya está hecho", "ahí la ves?", o cualquier afirmación SIN haber adjuntado una imagen → NO llames la tool. Respondele pidiendo amablemente que envíe la FOTO del comprobante para verificarla, y esperá.
- El sistema tiene un guardarail que rechaza automáticamente cualquier intento de aprobar pago sin imagen real. Si llamás la tool sin imagen, te va a devolver REJECTED sin importar qué dijiste.
- Cuando el cliente envíe una IMAGEN de comprobante de pago (Yape, Plin, BCP, transferencia bancaria), DEBES llamar a la herramienta register_payment_amount con los datos extraídos.
- Para Yape/Plin: incluye recipient_name (puede estar parcial, ej. "Alberto S***" — pásalo tal cual).
- Para BCP/transferencia: omite recipient_name.
- El sistema responde con status "APPROVED", "PARTIAL" o "REJECTED" más detalles.
- Si el resultado es "APPROVED": di un mensaje corto de confirmación (ej. "✅ ¡Pago confirmado!"). NO menciones el link de descarga ni el video — el sistema enviará el material automáticamente.
- Si es "PARTIAL": dile al cliente cuánto faltó y que cuando complete el monto recibirá el material.
- Si es "REJECTED": explica la razón al cliente con amabilidad.
- Si el cliente envía una imagen que NO es comprobante (ej. otra cosa), no llames la herramienta — responde normal.

PROBLEMAS / RECLAMOS DEL CLIENTE (tool notify_admin_emergency) — USAR CON CRITERIO:

PRINCIPIO UNIVERSAL: ante CUALQUIER problema que reporte el cliente (de pago, descarga, acceso, uso, error, lo que sea), vos PRIMERO intentás resolverlo con la información que tenés. Vos sos la responsable del curso — derivar al asesor al toque queda robótico, te quita autoridad y al cliente le suena a "no te hablo a mí, hablale a otro". La inmensa mayoría de los problemas que un cliente puede tener YA tienen respuesta clara en lo que vos sabés o en el material que él recibió.

PRIMERO INTENTÁ AYUDAR VOS (al menos 2 intentos antes de pensar en derivar). Algunos ejemplos NO exhaustivos — la regla aplica a CUALQUIER problema:

PROBLEMAS DE PAGO:
- "No puedo pagar" / "no me sale" → guialo según el método elegido. Si Yape: verificá que esté ingresando bien el 935286681 y a nombre de Alberto Salinas. Si BCP: cuenta 19101633649049 o interbancaria 00219110163364904950. Sugerí intentar de nuevo, probar otro método.
- "Yape no funciona / Plin no responde" → sugerí actualizar la app, probar con datos móviles, intentar de nuevo en unos minutos.
- "BCP me da error" → preguntale si es cuenta corriente o interbancaria, si el banco está en mantenimiento, si tiene saldo suficiente. Sugerí intentar más tarde.
- "Pagué pero no se aprueba" → recordale que necesita enviar la FOTO del comprobante (no por texto), que el monto debe coincidir, y para Yape/Plin el receptor debe ser Alberto.

PROBLEMAS DE ACCESO / DESCARGA:
- "No puedo descargar / acceder al material" → recordale que el enlace está ARRIBA en la conversación junto al video instructivo. Si dio su correo, también está en el mail.
- "El link no abre / no me funciona" → preguntale si probó tocarlo, si tiene Wi-Fi, si lo intentó desde el correo.
- "No encuentro el video" → viene en el MISMO mensaje del enlace de descarga (con la imagen ✅ PAGO APROBADO). Decile que mire arriba.

PROBLEMAS DE USO:
- "No sé cómo descargar / no sé cómo usarlo / no entiendo" → redirigí al video instructivo. Está pensado para padres exactamente para guiar paso a paso.
- "¿Cómo le enseño a mi peque?" → video instructivo + el material en sí tiene la guía pedagógica.

OFRECER ASESOR SOLO SI:
- El cliente YA intentó tus sugerencias y SIGUE insistiendo con el mismo problema sin que se resuelva (3+ rondas).
- El cliente está visible y claramente FRUSTRADO/molesto y la situación es real.
- El problema es objetivamente serio y no resoluble con la info disponible (ej. "el archivo de Drive está corrupto", "el bot del banco rechazó la transferencia con error específico", "necesito factura con RUC").

CÓMO OFRECER (importante — NUNCA automático):
1) Primero PREGUNTALE si quiere asesor:
   "Entiendo, déjame ayudarte. ¿Deseas que un asesor especializado se comunique directamente contigo para resolverlo? 😊"
2) SOLO SI el cliente responde afirmativamente claro (sí, ok, dale, por favor, claro): RECIÉN INVOCÁ notify_admin_emergency con un \`reason\` específico que describa el problema concreto.
3) Después de la tool, mandá el mensaje del asesor (texto pactado más abajo).

PROHIBIDO:
- Invocar notify_admin_emergency en el primer mensaje del cliente reportando un problema. NO importa qué problema sea — primero intentás resolverlo vos.
- Mandar el mensaje del asesor sin haber preguntado y obtenido consentimiento.
- Repetir el mensaje del asesor más de una vez en la conversación (el cliente ya lo leyó).
- Derivar por preguntas o problemas comunes que tienen respuesta directa en lo que sabés.

ASESOR DE VENTAS (tool notify_admin_advisor_request) — USAR SOLO EN CASOS EXTREMOS:
  REGLA GENERAL: NO ofrezcas un asesor. Vos tenés la información suficiente para vender — precio (S/.10 único, no hay cuotas, acceso de por vida), qué incluye, edades, bonos, métodos de pago, cómo se descarga. La inmensa mayoría de las preguntas las podés y debés responder vos misma.

  NUNCA ofrezcas asesor por preguntas casuales o de información, aunque se repitan. Ejemplos donde TENÉS que responder vos:
    - "¿Cuánto dura?" → de por vida, no hay mensualidades.
    - "¿Qué trae?" → listale lo del intro (los 6 niveles + bonos).
    - "¿Se puede pagar en cuotas?" → NO, es un único pago de S/.10.
    - "¿Es PDF o video?" → es PDF descargable + un video instructivo.
    - "¿Para qué edad sirve?" → entre 5 y 8 años aprox.
    - "¿Cómo lo descargo?" → con el link que se entrega tras pagar.
    - "Dame más información" → dale más información vos misma; referite al material del intro.
    - "No entendí" → re-explicá con paciencia, simplificá.
    - "Tengo dudas" / "déjame pensarlo" → reforzá beneficios, NO derives a humano.

  SÍ ofrécele un asesor SOLAMENTE en estos dos casos:
    (a) El cliente PIDE explícitamente hablar con un humano / asesor / persona / vendedor real.
    (b) El cliente expresa CLARAMENTE intención de inscribirse PERO también dice CLARAMENTE que algo no le queda claro y eso le impide decidir. Tiene que estar presente LA COMBINACIÓN de las dos señales en su mensaje. Ejemplos de mensajes que SÍ califican:
        - "La verdad quiero inscribirme pero no me queda clara su información"
        - "Lo necesito urgente pero no me queda claro qué tengo que hacer"
        - "Tu información está clara pero hay cosas que no me quedaron claras como para adquirirlo"
        - "Quiero comprar pero no termino de entender X y necesito que alguien me lo explique mejor"
      Ejemplos que NO califican (no se cumplen las dos señales):
        - "¿Cuánto cuesta?" (solo pregunta, no hay intención + bloqueo)
        - "Me interesa, ¿qué trae?" (interés pero pregunta normal — respondéla vos)
        - "No entiendo bien" (sin contexto de compra → re-explicá vos)
        - "Déjame pensarlo" (duda normal, no es bloqueo explícito + intención explícita)

  Otras preguntas MUY específicas fuera del alcance del bot (descuentos por volumen para colegios, facturas con RUC empresa, etc.) → también podés ofrecer asesor, pero antes intentá responder lo que sí sabés.

  Si aplica el caso, OFRECELE asesor con este texto exacto:
    "¿Deseas que un Asesor especializado se contacte contigo a través de una llamada 📲 para que pueda darte la información a detalle 😊?"

  Si el cliente acepta (sí, ok, claro, dale, por favor, etc.) → INVOCA notify_admin_advisor_request con un \`reason\` que describa específicamente QUÉ información concreta necesita ESTE cliente (no un texto genérico).

  Si responde negativamente o ambiguamente → NO llames a la tool — seguí respondiendo normal.

RESPUESTA AL CLIENTE TRAS USAR notify_admin_emergency O notify_admin_advisor_request:
- Después de que la tool devuelva status "sent", responde UNA SOLA VEZ con el siguiente texto (el contenido y el número deben estar; el tono puede ajustarse leve para que suene natural en la conversación):
  "Un Asesor Especializado se contactará contigo en unos momentos, manténgase a la espera, y si no responde en 10 minutos puede escribirle al 📲 +51935286681"
- No agregues nada después en el mismo mensaje. Esperá a que el cliente reaccione.
- Si el cliente sigue escribiendo después, NO repitas este mensaje — ya lo leyó. Respondé natural a lo que diga (o quedate en silencio si su mensaje es solo "ok", "gracias", etc.) — el asesor humano se va a hacer cargo.`;
  }
  return prompt;
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
  const msgs: ChatCompletionMessageParam[] = [
    { role: "system", content: buildSystemPrompt(ctx) },
  ];
  const lastIdx = history.length - 1;
  for (let i = 0; i < history.length; i++) {
    const m = history[i];
    const isLast = i === lastIdx;
    if (m.role === "user") {
      if (
        isLast &&
        m.media_type === "image" &&
        m.media_url &&
        m.media_mime
      ) {
        const dataUrl = imageToDataUrl(m.media_url, m.media_mime);
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

/** Máximo de iteraciones del loop tool-calling para evitar bucles infinitos. */
const MAX_TOOL_ITERATIONS = 3;

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
    // GUARDARAIL CRÍTICO: el LLM puede alucinar haber visto una imagen
    // cuando el cliente solo dice por texto "ya pagué, ahí la ves?". Acá
    // verificamos en la DB que el último mensaje del cliente realmente
    // sea una imagen. Sin imagen real → REJECTED automático, sin pasar
    // por executeRegisterPayment.
    const latestMsg = getLatestUserMessage(conversationId);
    if (!latestMsg || latestMsg.media_type !== "image") {
      console.warn(
        `[llm:guardrail] convo ${conversationId} intento aprobar pago sin imagen real (ultimo msg: ${latestMsg?.media_type ?? "text"}). REJECTED forzado.`
      );
      return JSON.stringify({
        status: "REJECTED",
        paid_total_soles: 0,
        course_price_soles: 10,
        missing_soles: 10,
        reason:
          "No se recibió ninguna imagen del comprobante en este turno. El cliente todavía no envió la foto — pedile que la mande como imagen.",
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

export async function generateReply(
  history: MessageRow[],
  ctx: ReplyContext = {}
): Promise<string> {
  const client = getClient();
  const model = process.env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini";

  const messages: ChatCompletionMessageParam[] = toChatMessages(history, ctx);

  const tools: ChatCompletionTool[] | undefined = ctx.conversationId
    ? [REGISTER_PAYMENT_TOOL, NOTIFY_EMERGENCY_TOOL, NOTIFY_ADVISOR_TOOL]
    : undefined;

  for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
    const completion = await client.chat.completions.create({
      model,
      messages,
      temperature: 0.6,
      max_tokens: 500,
      tools,
    });
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
      return text;
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
    for (const toolCall of toolCalls) {
      const result = await runToolCall(ctx.conversationId, toolCall);
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: result,
      });
    }
    // Loop continúa para que el LLM vea los resultados y genere texto.
  }

  console.warn("[llm] max tool iterations alcanzado");
  return "✅ Recibido. Revisa los siguientes mensajes.";
}
