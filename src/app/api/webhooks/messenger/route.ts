import { NextResponse, type NextRequest } from "next/server";
import { verifySignature } from "@/lib/meta/verify";
import { textoDelBotonPulsado } from "@/lib/meta/handler";
import {
  cancelPendingActionsByTypeForConvo,
  getActiveMetaConnection,
  listMetaConnections,
  setConversationMessengerPage,
  getConversationById,
  getLatestUserMessage,
  getOrCreateConversation,
  getRecentHistory,
  insertMessage,
  insertMessageWithMedia,
  markMessageProcessed,
  setConversationSourceReferral,
  type MediaPayload,
  type MediaType,
  wasMessageProcessed,
} from "@/lib/db";
import { generateReply } from "@/lib/openrouter";
import {
  acceptGiftConsent,
  claimGiftReward,
  declineGiftConsent,
  deliverDobleOfertaPaymentDetails,
  offerComboUpgrade,
  resendPaymentDetails,
  sendChunkedBotText,
  sendPaymentOffer,
  tryWorkflowOnIncoming,
} from "@/lib/workflow/engine";
import {
  getDistrustMessage,
  freezePricesForConvo,
  isPriceQuestion,
  isChannelEnabled,
  loadWorkflowConfig,
  withWorkflowChannel,
  conElTurnoDe,
} from "@/lib/workflow/config";
import { resendApprovedMaterial } from "@/lib/workflow/payment";
import { downloadMessengerAttachment } from "@/lib/messenger/media";
import { handleMessengerCountryGate } from "@/lib/workflow/messenger-country";
import { alRecibirMensaje, esDelTablero } from "@/lib/tablero/motor";
import { registrarComentario } from "@/lib/meta/comments";
import {
  getWebhookAppSecret,
  getWebhookVerifyToken,
  getWebhookSecretCandidates,
  withOutboundMessengerPage,
  getOutboundMessengerPage,
} from "@/lib/meta/runtime-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface MessengerPayload {
  object?: string;
  entry?: Array<{
    id?: string;
    messaging?: Array<{
      sender?: { id?: string };
      message?: {
        mid?: string;
        text?: string;
        is_echo?: boolean;
        /** Una respuesta rápida pulsada: su `payload` es el id del botón (22/10/2026). */
        quick_reply?: { payload?: string };
        referral?: MessengerReferral;
        attachments?: Array<{
          type?: string;
          payload?: { url?: string };
        }>;
      };
      postback?: { payload?: string; title?: string; referral?: MessengerReferral };
      referral?: MessengerReferral;
    }>;
    /** Comentarios y demás actividad del muro. Llega aparte de `messaging`. */
    changes?: Array<{
      field?: string;
      value?: {
        item?: string;
        verb?: string;
        comment_id?: string;
        post_id?: string;
        message?: string;
        from?: { id?: string; name?: string };
      };
    }>;
  }>;
}

interface MessengerReferral {
  ref?: string;
  source?: string;
  type?: string;
  ad_id?: string;
  ads_context_data?: {
    ad_id?: string;
    ad_title?: string;
    photo_url?: string;
    video_url?: string;
    post_id?: string;
  };
}

const latestInboundMsgId = new Map<string, string>();

// Throttle del log de firma inválida: evita inundar los logs (y gastar CPU en el
// diagnóstico) cuando llega un diluvio de POST ajenos. Se registra 1 vez cada 30s
// con el conteo acumulado en la ventana.
let invalidSigCount = 0;
let lastInvalidSigLogAt = 0;
const INVALID_SIG_LOG_INTERVAL_MS = 30_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
      Math.floor(Date.now() / 1000) - item.created_at <= 60 &&
      /\b(s\/\.|soles?|precio|inversion|inversi[oó]n)\b/i.test(item.content)
  );
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  const expected = getWebhookVerifyToken("messenger");
  if (mode === "subscribe" && expected && token === expected) {
    return new NextResponse(challenge ?? "", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }
  return new NextResponse("forbidden", { status: 403 });
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const appSecret = getWebhookAppSecret("messenger");
  const sig = req.headers.get("x-hub-signature-256");

  if (appSecret && sig && !verifySignature(raw, sig, appSecret)) {
    // El evento NO se procesa (la validación sigue bloqueándolo). PERO respondemos
    // 200 en vez de 401: con 401, Meta REINTENTA el evento sin parar y se forma una
    // tormenta de reintentos que satura el contenedor. Con 200, Meta lo marca
    // entregado y deja de reintentar; el evento ajeno se descarta igual aquí.
    invalidSigCount++;
    const now = Date.now();
    if (now - lastInvalidSigLogAt > INVALID_SIG_LOG_INTERVAL_MS) {
      // Log + diagnóstico THROTTLED (máx 1 cada 30s): evita spam y evita gastar
      // CPU corriendo la verificación de claves candidatas en cada POST del diluvio.
      logInvalidSignatureDiag(raw, sig, invalidSigCount);
      lastInvalidSigLogAt = now;
      invalidSigCount = 0;
    }
    return NextResponse.json({ ok: true });
  }

  let payload: MessengerPayload;
  try {
    payload = JSON.parse(raw) as MessengerPayload;
  } catch {
    return new NextResponse("bad json", { status: 400 });
  }

  void processMessengerPayload(payload).catch((err) =>
    console.error("[messenger] error procesando webhook:", err)
  );

  return NextResponse.json({ ok: true });
}

/**
 * DIAGNÓSTICO de firma inválida — NO desactiva la validación (el POST igual se
 * rechaza). Solo registra metadata NO sensible para identificar de dónde vienen
 * esos POST: page id(s), tipo de evento, y qué clave conocida (por NOMBRE) sí
 * validaría la firma. Nunca loguea el secreto ni el contenido del mensaje.
 *   - claveQueValida=ninguna → firma de OTRA App (limpiar suscripción en Meta).
 *   - claveQueValida=<otra fuente> → clave mal priorizada (arreglo en config).
 */
function logInvalidSignatureDiag(
  raw: string,
  sig: string,
  countInWindow: number
): void {
  let matched = "ninguna";
  try {
    for (const candidate of getWebhookSecretCandidates("messenger")) {
      if (verifySignature(raw, sig, candidate.value)) {
        matched = candidate.source;
        break;
      }
    }
  } catch {
    // ignoramos: es solo diagnóstico
  }

  let object = "?";
  const pages: string[] = [];
  const kinds = new Set<string>();
  try {
    const parsed = JSON.parse(raw) as MessengerPayload;
    object = parsed.object ?? "?";
    for (const entry of parsed.entry ?? []) {
      if (entry.id) pages.push(entry.id);
      for (const event of entry.messaging ?? []) {
        if (event.message?.is_echo) kinds.add("echo");
        else if (event.message) kinds.add("message");
        if (event.postback) kinds.add("postback");
        if (event.referral) kinds.add("referral");
      }
      if ((entry.messaging ?? []).length === 0) kinds.add("otro");
    }
  } catch {
    object = "no-json";
  }

  console.warn(
    `[messenger][diag-firma] ~${countInWindow} POST/30s object=${object} ` +
      `pages=${pages.join(",") || "?"} tipos=${[...kinds].join(",") || "otro"} ` +
      `claveQueValida=${matched} bodyLen=${raw.length}`
  );
}

async function processMessengerPayload(payload: MessengerPayload): Promise<void> {
  if (payload.object !== "page") return;
  // CUALQUIERA DE NUESTRAS PAGINAS, NO SOLO LA ACTIVA.
  //
  // LO PIDIO EL DUEÑO el 01/10/2026: «voy a usar 2 paginas y solo hay un webhook»,
  // y «recuerda que vamos a usar muchos numeros».
  //
  // ANTES SE COMPARABA CONTRA LA PAGINA ACTIVA, y una sola. Un mensaje de la
  // segunda pagina se tiraba con un `continue`: el cliente escribia y NADIE le
  // contestaba. Sin error, sin aviso — solo esta linea en el registro.
  //
  // Ahora vale cualquier pagina CONECTADA, igual que WhatsApp hace con sus numeros
  // desde el 21/09. El filtro NO se quita: sigue descartando lo que no es nuestro,
  // que es lo que impide contestar a eventos ajenos. Lo que cambia es contra que se
  // compara: contra la lista, no contra una.
  //
  // Sin ninguna pagina guardada —instalacion por variables de entorno— se compara
  // contra la activa, como antes.
  const conectadas = listMetaConnections().map((c) => c.page_id).filter(Boolean);
  const activeMessenger = getActiveMetaConnection();
  const propias =
    conectadas.length > 0
      ? conectadas
      : [activeMessenger?.page_id].filter((x): x is string => !!x);
  for (const entry of payload.entry ?? []) {
    if (entry.id && propias.length > 0 && !propias.includes(entry.id)) {
      console.log(
        `[messenger] evento de pagina ${entry.id}, no es nuestra (${propias.join(", ")}), ignoro`
      );
      continue;
    }

    // RAMA NUEVA — comentarios. Va antes que los mensajes pero no los toca:
    // los comentarios llegan en `changes`, los mensajes en `messaging`, y son
    // listas distintas. Si la automatización está apagada, no hace nada.
    for (const change of entry.changes ?? []) {
      if (change.field !== "feed") continue;
      const v = change.value;
      if (!v || v.item !== "comment" || v.verb !== "add") continue;
      // No responder a los comentarios de la propia página.
      if (v.from?.id && entry.id && v.from.id === entry.id) continue;
      if (!v.comment_id) continue;
      // DIAG: deja a la vista los identificadores reales que manda Meta. Es lo
      // que hace falta si el privado se rechaza y hay que averiguar por que.
      console.log(
        `[comentarios][diag] pagina=${entry.id} comment_id=${v.comment_id} ` +
          `post_id=${v.post_id ?? "?"} de=${v.from?.id ?? "?"} (${v.from?.name ?? "?"})`
      );
      try {
        registrarComentario({
          commentId: v.comment_id,
          pageId: entry.id ?? "",
          postId: v.post_id ?? null,
          commenterId: v.from?.id ?? null,
          commenterName: v.from?.name ?? null,
          text: v.message ?? null,
        });
      } catch (error) {
        // Nunca dejar que un comentario tumbe el procesado de los mensajes.
        console.warn(`[comentarios] error registrando comentario: ${String(error)}`);
      }
    }

    for (const event of entry.messaging ?? []) {
      const psid = event.sender?.id;
      if (!psid || event.message?.is_echo) continue;

      const text = event.message?.text?.trim();
      const postback = event.postback?.payload ?? event.postback?.title;
      const attachment = event.message?.attachments?.find((item) =>
        isSupportedAttachmentType(item.type)
      );
      if (!text && !postback && !attachment) continue;
      // UNA RESPUESTA RÁPIDA = UN BOTÓN PULSADO (22/10/2026). Se traduce con la MISMA regla que
      // WhatsApp: al motor va lo que encuentra la acción (el id de un botón del editor, el método
      // de pago, el nombre completo de la opción…) y en el chat queda la etiqueta que vio el cliente.
      const pulsado = event.message?.quick_reply?.payload?.trim();
      const traducido = pulsado ? textoDelBotonPulsado(pulsado, text ?? "") : null;
      const content =
        traducido?.texto ||
        (text ?? postback)?.trim() ||
        attachmentContentLabel(attachment?.type) ||
        "";
      const visible = traducido?.visible ?? null;
      const referral =
        event.message?.referral ?? event.postback?.referral ?? event.referral;
      const messageId =
        event.message?.mid ?? `messenger:${psid}:${Date.now()}:${content}`;

      console.log(
        `[messenger] <- ${psid}: ${content.slice(0, 80)}`
      );

      // TODO EL TURNO CORRE «DENTRO» DE LA PAGINA POR LA QUE ENTRO, para que la
      // respuesta salga por la misma y con SU token. Con una sola pagina conectada
      // no cambia nada: el contexto apunta a la unica que hay, que es la activa.
      //
      // Y CON LA TIENDA DE ESA PAGINA, por la MISMA puerta que usa WhatsApp.
      //
      // LO PIDIO EL DUEÑO el 01/10/2026, con un ejemplo de tres paginas vendiendo
      // cada una un producto distinto, las tres por WhatsApp Y por Messenger. (Sus
      // nombres de producto no se escriben aqui: esto es una plantilla y el
      // siguiente que lo lea creeria que el bot los conoce.)
      // Sin esto, un cliente de Messenger no encontraba NINGUNA tienda
      // —se buscaba solo por el numero de WhatsApp, y aqui no hay numero— asi que
      // las paginas contestaban cada una por la suya pero TODAS vendian el
      // contenido general.
      //
      // Se pasa solo la pagina: la conversacion todavia no existe en este punto, y
      // lo unico que hace falta para elegir la tienda es la llave. Sin tienda que
      // lleve esta pagina no envuelve nada, y el camino queda como estaba.
      await withOutboundMessengerPage(entry.id, () =>
        conElTurnoDe({ messenger_page_id: entry.id ?? null }, () =>
          withWorkflowChannel("messenger", () =>
            handleMessengerMessage(psid, messageId, content, attachment, referral, visible)
          )
        )
      );
    }
  }
}

function isSupportedAttachmentType(type: string | undefined): boolean {
  return type === "image" || type === "audio" || type === "video" || type === "file";
}

function attachmentKind(type: string | undefined): MediaType | null {
  if (type === "image") return "image";
  if (type === "audio") return "audio";
  if (type === "video") return "video";
  if (type === "file") return "document";
  return null;
}

function attachmentContentLabel(type: string | undefined): string | null {
  const kind = attachmentKind(type);
  if (kind === "image") return "[imagen]";
  if (kind === "audio") return "[audio]";
  if (kind === "video") return "[video]";
  if (kind === "document") return "[documento]";
  return null;
}

async function handleMessengerMessage(
  psid: string,
  messageId: string,
  content: string,
  attachment?: { type?: string; payload?: { url?: string } },
  referral?: MessengerReferral,
  /** Lo que queda escrito en el chat cuando no es lo que se enruta (un botón del editor). */
  visible: string | null = null
): Promise<void> {
  if (wasMessageProcessed(messageId)) {
    console.log(`[messenger] mensaje ${messageId} ya procesado, ignoro`);
    return;
  }
  markMessageProcessed(messageId);

  const cfg = loadWorkflowConfig();
  if (!isChannelEnabled("messenger", cfg)) {
    console.log("[messenger] canal apagado en editor, no respondo");
    return;
  }

  const phone = `messenger:${psid}`;
  const convo = getOrCreateConversation(phone, "Messenger", "messenger");
  // Deja anotado por cual de NUESTRAS paginas entro, para responderle por la misma
  // tambien en los seguimientos, que salen del obrero horas despues y ya no tienen
  // el webhook delante. Mismo motivo y mismo sitio que el numero en WhatsApp.
  setConversationMessengerPage(convo.id, getOutboundMessengerPage());
  if (referral) {
    const sourceId =
      referral.ad_id ??
      referral.ads_context_data?.ad_id ??
      referral.ads_context_data?.post_id ??
      referral.ref ??
      null;
    const sourceUrl =
      referral.ads_context_data?.photo_url ??
      referral.ads_context_data?.video_url ??
      referral.ref ??
      null;
    const headline =
      referral.ads_context_data?.ad_title ??
      referral.source ??
      referral.type ??
      null;
    setConversationSourceReferral(convo.id, sourceId, sourceUrl, headline);
    console.log(
      `[messenger] convo ${convo.id} referral guardado (${sourceId ?? "sin id"})`
    );
  }
  let media: MediaPayload | null = null;
  const kind = attachmentKind(attachment?.type);
  const attachmentUrl = attachment?.payload?.url;
  if (kind && attachmentUrl) {
    try {
      media = await downloadMessengerAttachment(attachmentUrl, kind);
      console.log(`[messenger] adjunto ${kind} descargado para convo ${convo.id}`);
    } catch (err) {
      console.error("[messenger] no se pudo descargar adjunto:", err);
    }
  }
  if (media) {
    insertMessageWithMedia(convo.id, "user", content, messageId, media);
  } else {
    insertMessage(convo.id, "user", visible ?? content, messageId);
  }
  cancelPendingActionsByTypeForConvo(convo.id, "send_text_chunk");

  // EL MISMO TIEMPO QUE WHATSAPP (22/10/2026): el del panel (Ajustes), y si no está, la variable
  // de EasyPanel. Antes este canal leía SOLO la variable: cambiarlo en el panel movía WhatsApp y
  // aquí no pasaba nada. Misma regla que handler.ts.
  const debounceDelPanel = loadWorkflowConfig()?.bot_debounce_seconds;
  const debounceSec =
    typeof debounceDelPanel === "number" && debounceDelPanel >= 0
      ? debounceDelPanel
      : Number(process.env.BOT_DEBOUNCE_SECONDS ?? 8);
  if (debounceSec > 0) {
    latestInboundMsgId.set(phone, messageId);
    await sleep(debounceSec * 1000);
    if (latestInboundMsgId.get(phone) !== messageId) {
      console.log(
        `[messenger] ${psid}: superado por otro mensaje mas nuevo, no respondo`
      );
      return;
    }
  }

  const fresh = getConversationById(convo.id);
  if (!fresh || fresh.mode !== "AI") {
    console.log(`[messenger] convo ${convo.id} en modo HUMAN, no respondo`);
    return;
  }

  // El cliente puede responder su país y mandar otro mensaje enseguida (ej.
  // "Ecuador" y luego "precio"); el debounce descartaría el "Ecuador". Pasamos
  // el bloque combinado de mensajes recientes para no perder la respuesta.
  const gateContent = buildDebouncedWorkflowContent(fresh.id, content, debounceSec);
  const gateHandled = await handleMessengerCountryGate(fresh, gateContent);
  const countryReady = getConversationById(convo.id) ?? fresh;
  freezePricesForConvo(countryReady);
  if (gateHandled) return;

  // EL TABLERO, también en Messenger (22/10/2026, solo ALBERTO 4). Va DESPUÉS de la pregunta del
  // país —aquí el país se pregunta primero— y antes del motor de siempre, igual que en WhatsApp
  // (handler.ts). Solo atiende conversaciones nuevas de una tienda con tablero encendido; las
  // demás siguen exactamente igual. Los botones llegan como respuestas rápidas con el mismo id.
  try {
    if (await alRecibirMensaje(countryReady, content)) return;
  } catch (err) {
    console.error("[tablero] falló el turno del tablero (messenger):", err);
    if (esDelTablero(countryReady.id)) return;
  }

  try {
    const handled = await tryWorkflowOnIncoming(countryReady, content);
    if (!handled && !attachment) {
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
    console.error("[messenger] workflow fallo, sigo con IA:", err);
  }

  if (loadWorkflowConfig()?.silent_mode === true) {
    console.log("[messenger] modo silencioso: no respondo texto");
    return;
  }

  if (shouldSuppressDuplicatePriceReply(fresh.id, content)) {
    console.log(
      `[messenger] convo ${fresh.id}: suprimo pregunta de precio repetida reciente`
    );
    return;
  }

  const history = getRecentHistory(fresh.id, 20);
  let reply = await generateReply(history, {
    conversationId: fresh.id,
    clientName: fresh.client_name ?? fresh.name ?? undefined,
  });

  const resumenMatch = reply.match(/<<\s*RESUMEN\s*:\s*([^>]+)>>/i);
  if (resumenMatch) {
    reply = reply.replace(/<<\s*RESUMEN\s*:\s*[^>]+>>\s*/gi, "").trim();
  }
  reply = reply.replace(/<{1,2}\s*RESUMEN\s*:[\s\S]*$/i, "").trim();

  const current = getConversationById(fresh.id) ?? fresh;
  const eligeMatch = /<<\s*ELIGE_PRODUCTO_([12])\s*>>/i.exec(reply);
  if (eligeMatch && loadWorkflowConfig()?.doble_oferta_dos?.enabled) {
    const choice = eligeMatch[1] === "1" ? "combo" : "basico";
    const leftover = reply
      .replace(/<<\s*ELIGE_PRODUCTO_[12]\s*>>\s*/gi, "")
      .trim();
    // Aqui habla el SISTEMA, no el modelo: el texto del modelo se descarta.
    // Se entrelazaba con las burbujas de pago y ademas decia lo mismo que
    // ellas. Ver el comentario largo en meta/handler.ts.
    if (leftover) {
      console.log(
        `[messenger] convo ${current.id}: descarto el texto del modelo (${leftover.length} car.) — los datos de pago los manda el sistema`
      );
    }
    await deliverDobleOfertaPaymentDetails(current, choice);
    return;
  }

  const stripGiftMarkers = (value: string): string =>
    value
      .replace(
        /<<\s*(REGALO_SI|REGALO_NO|REGALO_HECHO|UPGRADE_COMBO)\s*>>\s*/gi,
        ""
      )
      .trim();

  if (
    /<<\s*REGALO_(SI|NO)\s*>>/i.test(reply) &&
    current.state === "awaiting_gift_consent"
  ) {
    const accepts = /<<\s*REGALO_SI\s*>>/i.test(reply);
    const leftover = stripGiftMarkers(reply);
    if (leftover) await sendChunkedBotText(current, leftover);
    if (accepts) acceptGiftConsent(current);
    else await declineGiftConsent(current);
    return;
  }

  if (
    /<<\s*REGALO_HECHO\s*>>/i.test(reply) &&
    current.state === "awaiting_facebook_comment"
  ) {
    const leftover = stripGiftMarkers(reply);
    if (leftover) await sendChunkedBotText(current, leftover);
    await claimGiftReward(current);
    return;
  }

  if (/<<\s*UPGRADE_COMBO\s*>>/i.test(reply)) {
    const applied = await offerComboUpgrade(current);
    if (applied) return;
    reply = stripGiftMarkers(reply);
  }

  if (/<<\s*METODOS_PAGO\s*>>/i.test(reply)) {
    const leftover = reply.replace(/<<\s*METODOS_PAGO\s*>>\s*/gi, "").trim();
    if (leftover) await sendChunkedBotText(current, leftover);
    await sendPaymentOffer(getConversationById(current.id) ?? current);
    return;
  }

  if (/<<\s*TRANQUILIZAR\s*>>/i.test(reply)) {
    const distrust = getDistrustMessage();
    const leftover = reply.replace(/<<\s*TRANQUILIZAR\s*>>\s*/gi, "").trim();
    if (leftover) await sendChunkedBotText(current, leftover);
    if (distrust) {
      await sendChunkedBotText(current, distrust);
      return;
    }
    reply = leftover;
  }

  if (/<<\s*REENVIAR_PAGO\s*>>/i.test(reply)) {
    const leftover = reply.replace(/<<\s*REENVIAR_PAGO\s*>>\s*/gi, "").trim();
    if (leftover) await sendChunkedBotText(current, leftover);
    const ok = await resendPaymentDetails(getConversationById(current.id) ?? current);
    if (!ok) await sendPaymentOffer(getConversationById(current.id) ?? current);
    return;
  }

  if (/<<\s*REENVIAR\s*>>/i.test(reply)) {
    const leftover = reply.replace(/<<\s*REENVIAR\s*>>\s*/gi, "").trim();
    if (leftover) await sendChunkedBotText(current, leftover);
    resendApprovedMaterial(getConversationById(current.id) ?? current);
    return;
  }

  if (/<<\s*MEDIA\s*:/i.test(reply)) {
    reply = reply.replace(/<<\s*MEDIA\s*:\s*[^>]+>>\s*/gi, "").trim();
  }

  const refreshed = getConversationById(current.id);
  const latestUserIsImage = getLatestUserMessage(current.id)?.media_type === "image";
  const postPurchaseStates = new Set([
    "payment_approved",
    "awaiting_email",
    "awaiting_gift_consent",
    "awaiting_facebook_comment",
  ]);
  if (
    latestUserIsImage &&
    postPurchaseStates.has(refreshed?.state ?? "")
  ) {
    return;
  }

  if (reply.trim()) {
    await sendChunkedBotText(getConversationById(current.id) ?? current, reply);
  }
}
