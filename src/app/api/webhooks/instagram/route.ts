import { NextResponse, type NextRequest } from "next/server";
import { verifySignature } from "@/lib/meta/verify";
import {
  cancelPendingActionsByTypeForConvo,
  getActiveInstagramMetaConnection,
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
} from "@/lib/workflow/config";
import { resendApprovedMaterial } from "@/lib/workflow/payment";
import { handleMessengerCountryGate } from "@/lib/workflow/messenger-country";
import { alRecibirMensaje, esDelTablero } from "@/lib/tablero/motor";
import { tiendaDeLaPagina } from "@/lib/workflow/config";
import { downloadMessengerAttachment } from "@/lib/messenger/media";
import { getWebhookAppSecret, getWebhookVerifyToken } from "@/lib/meta/runtime-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface InstagramPayload {
  object?: string;
  entry?: Array<{
    id?: string;
    messaging?: Array<{
      sender?: { id?: string };
      message?: {
        mid?: string;
        text?: string;
        is_echo?: boolean;
        referral?: InstagramReferral;
        attachments?: Array<{
          type?: string;
          payload?: { url?: string };
        }>;
      };
      postback?: { payload?: string; title?: string; referral?: InstagramReferral };
      referral?: InstagramReferral;
    }>;
  }>;
}

interface InstagramReferral {
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

  const expected = getWebhookVerifyToken("instagram");
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
  const appSecret = getWebhookAppSecret("instagram");
  const sig = req.headers.get("x-hub-signature-256");

  if (appSecret && sig && !verifySignature(raw, sig, appSecret)) {
    console.warn("[instagram] firma invalida, rechazando webhook");
    return new NextResponse("invalid signature", { status: 401 });
  }

  let payload: InstagramPayload;
  try {
    payload = JSON.parse(raw) as InstagramPayload;
  } catch {
    return new NextResponse("bad json", { status: 400 });
  }

  void processInstagramPayload(payload).catch((err) =>
    console.error("[instagram] error procesando webhook:", err)
  );

  return NextResponse.json({ ok: true });
}

async function processInstagramPayload(payload: InstagramPayload): Promise<void> {
  if (payload.object !== "instagram" && payload.object !== "page") return;
  const activeInstagram = getActiveInstagramMetaConnection();
  for (const entry of payload.entry ?? []) {
    if (
      activeInstagram?.instagram_business_account_id &&
      entry.id &&
      entry.id !== activeInstagram.instagram_business_account_id &&
      entry.id !== activeInstagram.page_id
    ) {
      console.log(`[instagram] evento de cuenta no activa (${entry.id}), ignoro`);
      continue;
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
      const content =
        (text ?? postback)?.trim() ||
        attachmentContentLabel(attachment?.type) ||
        "";
      const referral =
        event.message?.referral ?? event.postback?.referral ?? event.referral;
      const messageId =
        event.message?.mid ?? `instagram:${psid}:${Date.now()}:${content}`;

      console.log(
        `[instagram] <- ${psid}: ${content.slice(0, 80)}`
      );

      await withWorkflowChannel("instagram", () =>
        handleInstagramMessage(psid, messageId, content, attachment, referral)
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

function isInstagramPermissionError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    message.includes("Instagram send failed 403") ||
    message.includes("instagram_manage_messages") ||
    message.includes("usuario destinatario no tiene")
  );
}

async function handleInstagramMessage(
  psid: string,
  messageId: string,
  content: string,
  attachment?: { type?: string; payload?: { url?: string } },
  referral?: InstagramReferral
): Promise<void> {
  if (wasMessageProcessed(messageId)) {
    console.log(`[instagram] mensaje ${messageId} ya procesado, ignoro`);
    return;
  }
  markMessageProcessed(messageId);

  const cfg = loadWorkflowConfig();
  if (!isChannelEnabled("instagram", cfg)) {
    console.log("[instagram] canal apagado en editor, no respondo");
    return;
  }

  const phone = `instagram:${psid}`;
  const convo = getOrCreateConversation(phone, "instagram", "instagram");
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
      `[instagram] convo ${convo.id} referral guardado (${sourceId ?? "sin id"})`
    );
  }
  let media: MediaPayload | null = null;
  const kind = attachmentKind(attachment?.type);
  const attachmentUrl = attachment?.payload?.url;
  if (kind && attachmentUrl) {
    try {
      media = await downloadMessengerAttachment(attachmentUrl, kind);
      console.log(`[instagram] adjunto ${kind} descargado para convo ${convo.id}`);
    } catch (err) {
      console.error("[instagram] no se pudo descargar adjunto:", err);
    }
  }
  if (media) {
    insertMessageWithMedia(convo.id, "user", content, messageId, media);
  } else {
    insertMessage(convo.id, "user", content, messageId);
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
        `[instagram] ${psid}: superado por otro mensaje mas nuevo, no respondo`
      );
      return;
    }
  }

  const fresh = getConversationById(convo.id);
  if (!fresh || fresh.mode !== "AI") {
    console.log(`[instagram] convo ${convo.id} en modo HUMAN, no respondo`);
    return;
  }

  // Puerta de país (igual que Messenger): Instagram tampoco entrega la lada.
  const gateContent = buildDebouncedWorkflowContent(fresh.id, content, debounceSec);
  const gateHandled = await handleMessengerCountryGate(fresh, gateContent);
  const countryReady = getConversationById(convo.id) ?? fresh;
  freezePricesForConvo(countryReady);
  if (gateHandled) return;

  // EL TABLERO, también en Instagram (22/10/2026, solo ALBERTO 4). Igual que en Messenger:
  // después de la pregunta del país y antes del motor de siempre. Su tienda es la de la página
  // de Facebook unida a esta cuenta de Instagram (la conversación no la trae, y el motor de
  // siempre sigue atendiéndola sin tienda, como hasta hoy). Los botones salen como lista
  // numerada y el tablero entiende «1», «2» o el texto del botón.
  try {
    const tiendaDeInstagram = tiendaDeLaPagina(getActiveInstagramMetaConnection()?.page_id ?? null);
    if (await alRecibirMensaje(countryReady, content, tiendaDeInstagram)) return;
  } catch (err) {
    console.error("[tablero] falló el turno del tablero (instagram):", err);
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
    if (isInstagramPermissionError(err)) {
      console.error(
        "[instagram] Meta rechazo el envio por permisos; no llamo IA para evitar gasto:",
        err
      );
      return;
    }
    console.error("[instagram] workflow fallo, sigo con IA:", err);
  }

  if (loadWorkflowConfig()?.silent_mode === true) {
    console.log("[instagram] modo silencioso: no respondo texto");
    return;
  }

  if (shouldSuppressDuplicatePriceReply(fresh.id, content)) {
    console.log(
      `[instagram] convo ${fresh.id}: suprimo pregunta de precio repetida reciente`
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
        `[instagram] convo ${current.id}: descarto el texto del modelo (${leftover.length} car.) — los datos de pago los manda el sistema`
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
