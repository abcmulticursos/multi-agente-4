import {
  cancelPendingActionsByTypeForConvo,
  getConversationById,
  getLatestUserMessage,
  getOrCreateConversation,
  getRecentHistory,
  insertMessage,
  insertMessageWithMedia,
  isNumberBlocked,
  markMessageProcessed,
  setConversationAdReferral,
  updateMessageStatus,
  wasMessageProcessed,
  getSentMedia,
  markMediaSent,
  type MediaPayload,
  type WaStatus,
} from "@/lib/db";
import { generateReply } from "@/lib/openrouter";
import { markMessageRead } from "@/lib/meta/client";
import { downloadMediaFromMeta } from "@/lib/meta/media";
import { transcribeAudio } from "@/lib/transcription";
import {
  acceptGiftConsent,
  claimGiftReward,
  declineGiftConsent,
  deliverDobleOfertaPaymentDetails,
  offerComboUpgrade,
  resendPaymentDetails,
  sendChunkedBotText,
  sendCountryRedirect,
  sendPaymentOffer,
  tryWorkflowOnIncoming,
} from "@/lib/workflow/engine";
import { sendBotMediaFromDrive } from "@/lib/workflow/sender";
import {
  getDistrustMessage,
  getActiveTwoTierOffer,
  getImageGallery,
  isPriceQuestion,
  loadWorkflowConfig,
} from "@/lib/workflow/config";
import { resendApprovedMaterial } from "@/lib/workflow/payment";
import { overrideResumenInNocodb, syncLeadStatus } from "@/lib/leads-sync";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeGalleryKey(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function shouldPreferVideoForGallery(
  inboundText: string,
  replyText: string
): boolean {
  const haystack = `${inboundText} ${replyText}`.toLowerCase();
  return (
    /\bvideo\b/.test(haystack) ||
    /\b(verlo|verlo\?|verlo\.|quiero verlo|quiero ver|muestrame|mu[eé]strame)\b/.test(
      haystack
    )
  );
}

function resolveGalleryItem(
  gallery: ReturnType<typeof getImageGallery>,
  topic: string,
  inboundText: string,
  replyText: string
): (typeof gallery)[number] | undefined {
  const normalizedTopic = normalizeGalleryKey(topic);
  const exact = gallery.find(
    (item) => normalizeGalleryKey(item.topic) === normalizedTopic
  );
  if (!shouldPreferVideoForGallery(inboundText, replyText)) return exact;

  const videoCandidate = gallery.find((item) => {
    if (item.media_type !== "video") return false;
    const normalizedItemTopic = normalizeGalleryKey(item.topic);
    return (
      normalizedItemTopic === normalizedTopic ||
      normalizedItemTopic.startsWith(`${normalizedTopic} video`) ||
      normalizedItemTopic.startsWith(normalizedTopic) ||
      normalizedTopic.startsWith(normalizedItemTopic)
    );
  });
  return videoCandidate ?? exact;
}

function isCommerceOrPriceQuestion(text: string): boolean {
  const normalized = normalizeGalleryKey(text);
  return (
    isPriceQuestion(text) ||
    /\b(caro|cara|barato|barata|economico|economica|precio|precios|pago|pagar|yape|plin|bcp|transferencia|tarjeta|cuenta|metodo|metodos|opcion|opciones|combo|basico)\b/.test(
      normalized
    )
  );
}

function isShortVisualConsent(text: string): boolean {
  const normalized = normalizeGalleryKey(text).replace(/\s+/g, " ");
  if (!normalized || normalized.length > 40) return false;
  return (
    /^(s|si|si por favor|si claro|claro|claro que si|dale|ok|okay|ya|ya dale|ya pues|bueno|listo|perfecto|manda|mandala|enviala|pasala|muestrame|quiero verla|quiero verlo)$/.test(
      normalized
    ) ||
    /^si\b/.test(normalized) ||
    /^(manda|mandame|envia|enviame|pasa|pasame|muestra|muestrame)\b/.test(
      normalized
    )
  );
}

function offeredVisualSample(text: string): boolean {
  const normalized = normalizeGalleryKey(text).replace(/\s+/g, " ");
  if (!normalized) return false;
  const visual = /\b(foto|imagen|imagenes|muestra|muestras|captura|visual|verla|verlo|mostrarte|mostrartelo)\b/.test(
    normalized
  );
  const offer = /\b(quieres|quieres que|te muestro|te puedo mostrar|puedo mostrarte|te envio|te puedo enviar|puedo enviarte|te mando|te paso|te comparto|te enseno|te puedo ensenar|mando|envio|paso|comparto)\b/.test(
    normalized
  );
  return visual && offer && !isCommerceOrPriceQuestion(text);
}

function pickGalleryAfterVisualConsent(
  inboundText: string,
  lastAssistantText: string,
  gallery: ReturnType<typeof getImageGallery>,
  alreadySent: string[]
): (typeof gallery)[number] | null {
  if (!isShortVisualConsent(inboundText) || !offeredVisualSample(lastAssistantText)) {
    return null;
  }
  const byLastOffer = findLocalGalleryKeywordMatch(
    lastAssistantText,
    gallery,
    alreadySent
  );
  if (byLastOffer) return byLastOffer;
  const sent = new Set(alreadySent.map((item) => item.toLowerCase()));
  return gallery.find((item) => !sent.has(item.topic.toLowerCase())) ?? null;
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 2) return 3;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] =
        a[i - 1] === b[j - 1]
          ? prev[j - 1]
          : Math.min(prev[j - 1], prev[j], cur[j - 1]) + 1;
    }
    prev = cur;
  }
  return prev[b.length] ?? 3;
}

function findLocalGalleryKeywordMatch(
  text: string,
  gallery: ReturnType<typeof getImageGallery>,
  alreadySent: string[]
): (typeof gallery)[number] | null {
  const normalized = normalizeGalleryKey(text).replace(/\s+/g, " ");
  if (!normalized || isCommerceOrPriceQuestion(text)) return null;

  const haystack = ` ${normalized} `;
  const tokens = normalized.split(" ").filter(Boolean);
  const sent = new Set(alreadySent.map((item) => item.toLowerCase()));

  for (const item of gallery) {
    if (sent.has(item.topic.toLowerCase())) continue;
    const keys = (item.keywords ?? [])
      .map((key) => normalizeGalleryKey(key).replace(/\s+/g, " "))
      .filter((key) => key.length >= 3);
    if (keys.length === 0) continue;

    for (const key of keys) {
      if (haystack.includes(` ${key} `)) return item;
      if (!key.includes(" ") && tokens.includes(key)) return item;
    }
  }

  for (const item of gallery) {
    if (sent.has(item.topic.toLowerCase())) continue;
    const keys = (item.keywords ?? [])
      .map((key) => normalizeGalleryKey(key).replace(/\s+/g, " "))
      .filter((key) => key.length >= 5 && !key.includes(" "));
    for (const key of keys) {
      const threshold = key.length >= 8 ? 2 : 1;
      if (tokens.some((token) => editDistance(token, key) <= threshold)) {
        return item;
      }
    }
  }

  return null;
}

function shouldHideOrderBumpSecondProduct(
  convo: NonNullable<ReturnType<typeof getConversationById>>
): boolean {
  const cfg = loadWorkflowConfig();
  const orderBump = cfg?.order_bump;
  const postSaleStates = new Set([
    "payment_approved",
    "awaiting_email",
    "awaiting_gift_consent",
    "awaiting_facebook_comment",
  ]);
  const orderBumpPostSale = postSaleStates.has(convo.state ?? "");
  const deferredUntilPayment =
    convo.state === "intro_done" &&
    !convo.order_bump_choice &&
    (convo.last_followup_index >= 0 ||
      orderBump?.offer_on_intro_first_message === false);
  return !!orderBump?.enabled && !orderBumpPostSale && deferredUntilPayment;
}

// Mutex en memoria por numero de telefono: serializa el procesamiento de
// mensajes de un mismo cliente. Sin esto, dos mensajes que llegan en
// paralelo pueden pasar ambos por el branch state === "new" antes de que
// el primero alcance a actualizar el estado, causando saludos / intros
// duplicados. Indexado por phone porque esta disponible antes de
// getOrCreateConversation (y un mismo phone siempre mapea a una misma
// convo). Vive solo en memoria — si el proceso reinicia el lock se
// pierde, pero a esa altura no hay mensajes en vuelo.
const phoneLocks = new Map<string, Promise<unknown>>();

// Debounce anti-ráfaga: guarda el ID del ÚLTIMO mensaje recibido por número.
// Cuando un cliente escribe varios mensajitos seguidos, solo el último genera
// respuesta (los anteriores se descartan tras la espera). Ver FASE 2 en
// handleIncomingMessage. Vive en memoria; si el proceso reinicia, se pierde
// (sin consecuencias: a esa altura no hay ráfagas en vuelo).
const latestInboundMsgId = new Map<string, string>();

function withPhoneLock<T>(
  phone: string,
  fn: () => Promise<T>
): Promise<T> {
  const prev = phoneLocks.get(phone) ?? Promise.resolve();
  // Encadenamos sobre la promesa previa. Pasamos `fn` como handler de
  // ambos lados (resuelto y rechazado) para que un error previo no
  // bloquee a los siguientes.
  const next = prev.then(fn, fn) as Promise<T>;
  // Trackeamos una version que no rechaza para no contaminar la cadena
  // siguiente con errores ajenos.
  const tracked = next.catch(() => {});
  phoneLocks.set(phone, tracked);
  return next.finally(() => {
    if (phoneLocks.get(phone) === tracked) {
      phoneLocks.delete(phone);
    }
  });
}

interface IncomingContact {
  wa_id?: string;
  profile?: { name?: string | null };
}

interface IncomingAudio {
  id?: string;
  mime_type?: string;
  voice?: boolean;
}

interface IncomingImage {
  id?: string;
  mime_type?: string;
  caption?: string;
  sha256?: string;
}

interface IncomingVideo {
  id?: string;
  mime_type?: string;
  caption?: string;
  sha256?: string;
}

interface IncomingDocument {
  id?: string;
  mime_type?: string;
  filename?: string;
  caption?: string;
  sha256?: string;
}

interface IncomingReferral {
  source_url?: string;
  source_id?: string;
  source_type?: string;
  headline?: string;
  body?: string;
  ctwa_clid?: string;
}

interface IncomingMessage {
  from?: string;
  id?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  audio?: IncomingAudio;
  image?: IncomingImage;
  video?: IncomingVideo;
  document?: IncomingDocument;
  referral?: IncomingReferral;
  // Respuesta a botones interactivos (reply buttons). Cuando el cliente toca
  // un botón, WhatsApp envía el id + el título elegido.
  interactive?: {
    type?: string;
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string };
  };
  // Botones de plantilla (formato legacy).
  button?: { text?: string; payload?: string };
}

interface IncomingStatus {
  id?: string;
  status?: string;
  recipient_id?: string;
}

interface ChangeValue {
  messaging_product?: string;
  metadata?: Record<string, unknown>;
  contacts?: IncomingContact[];
  messages?: IncomingMessage[];
  statuses?: IncomingStatus[];
}

interface Change {
  field?: string;
  value?: ChangeValue;
}

interface Entry {
  id?: string;
  changes?: Change[];
}

interface WebhookPayload {
  object?: string;
  entry?: Entry[];
}

export async function processWebhookPayload(payload: unknown): Promise<void> {
  const root = payload as WebhookPayload | null | undefined;
  if (!root || root.object !== "whatsapp_business_account") return;

  for (const entry of root.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages") continue;
      const value = change.value ?? {};

      // Filtro multi-tenant: si la misma Meta App tiene acceso a OTRA
      // WABA/numero, Meta nos manda esos webhooks tambien. Los ignoramos
      // comparando phone_number_id con el nuestro.
      const incomingPhoneId = (
        value.metadata as { phone_number_id?: string } | undefined
      )?.phone_number_id;
      const ownPhoneId = process.env.META_PHONE_NUMBER_ID;
      if (
        incomingPhoneId &&
        ownPhoneId &&
        incomingPhoneId !== ownPhoneId
      ) {
        console.log(
          `[wh] webhook para phone_number_id ${incomingPhoneId}, no es nuestro (${ownPhoneId}), ignoro`
        );
        continue;
      }

      for (const status of value.statuses ?? []) {
        const waId = status.id;
        const raw = status.status;
        if (!waId || !raw) continue;
        // Meta manda: sent / delivered / read / failed. Cualquier otro
        // (ej. 'deleted') lo ignoramos por ahora.
        const mapped: WaStatus | null =
          raw === "sent" || raw === "delivered" || raw === "read" || raw === "failed"
            ? (raw as WaStatus)
            : null;
        if (!mapped) {
          console.log(`[wh] status desconocido "${raw}" para ${waId}, ignorando`);
          continue;
        }
        try {
          updateMessageStatus(waId, mapped);
          console.log(`[wh] status ${mapped} para ${waId.slice(-12)}`);
        } catch (err) {
          console.error(`[wh] error actualizando status ${mapped} de ${waId}:`, err);
        }
      }

      const contacts = value.contacts ?? [];
      const nameByPhone = new Map<string, string | null>();
      for (const c of contacts) {
        if (c.wa_id) nameByPhone.set(c.wa_id, c.profile?.name ?? null);
      }

      for (const msg of value.messages ?? []) {
        try {
          await handleIncomingMessage(
            msg,
            (msg.from && nameByPhone.get(msg.from)) ?? null
          );
        } catch (err) {
          console.error("[wh] error en handleIncomingMessage:", err);
        }
      }
    }
  }
}

async function handleIncomingMessage(
  msg: IncomingMessage,
  pushName: string | null
): Promise<void> {
  const waMsgId = msg.id;
  const phone = msg.from;
  if (!waMsgId || !phone) {
    console.warn("[wh] mensaje sin id o from, ignorando");
    return;
  }

  if (wasMessageProcessed(waMsgId)) {
    console.log(`[wh] mensaje ${waMsgId} ya procesado, ignorando`);
    return;
  }
  markMessageProcessed(waMsgId);

  // Blacklist: si el número está bloqueado, ignoramos el mensaje por
  // completo — no lo guardamos, no respondemos, no disparamos workflow.
  if (isNumberBlocked(phone)) {
    console.log(`[wh] número ${phone} bloqueado, ignorando mensaje ${waMsgId}`);
    return;
  }

  let content: string;
  let media: MediaPayload | null = null;

  if (msg.type === "text") {
    const text = msg.text?.body?.trim();
    if (!text) {
      console.log(`[wh] mensaje ${waMsgId} sin texto, ignorando`);
      return;
    }
    content = text;
  } else if (msg.type === "interactive" || msg.type === "button") {
    // El cliente tocó un BOTÓN. Para los botones de MÉTODO DE PAGO, el id lleva
    // "pmethod:<keyword>" → enrutamos por ese método (así la etiqueta puede tener
    // emoji/mayúsculas sin afectar el ruteo). Para los demás (order bump / doble
    // oferta) usamos el TÍTULO, que el motor reconoce por nombre.
    const id =
      msg.interactive?.button_reply?.id ??
      msg.interactive?.list_reply?.id ??
      "";
    const title =
      msg.interactive?.button_reply?.title ??
      msg.interactive?.list_reply?.title ??
      msg.button?.text ??
      "";
    // El id de pago viene como "pmethod:<método>:<índice>" (el índice solo da
    // unicidad). Tomamos el método = lo que va entre "pmethod:" y el siguiente
    // ":". Compatible con el formato viejo "pmethod:<método>" (sin índice).
    // Botones del ORDER BUMP (id "ob_combo"/"ob_basico"): usamos el NOMBRE
    // COMPLETO de la opción desde la config — NO el título, que WhatsApp trunca
    // a 20 caracteres y haría fallar el reconocimiento de la elección (entonces
    // el pago se validaría contra el precio individual = bug crítico).
    let text: string;
    if (id.startsWith("pmethod:")) {
      text = id.slice("pmethod:".length).split(":")[0].trim();
    } else if (id === "ob_combo" || id === "ob_basico") {
      // Resuelve el nombre desde la modalidad ACTIVA (order bump O doble oferta 2
      // productos), NO desde order_bump fijo. Si no, el botón de doble oferta
      // jalaba el nombre de order bump (p. ej. "GRAFISMO FONETICO") y rompía la
      // elección → caía al LLM y hablaba de grafismo.
      const ob = getActiveTwoTierOffer(loadWorkflowConfig());
      const opt = id === "ob_combo" ? ob?.combo : ob?.basico;
      text = opt?.name?.trim() || title.trim();
    } else if (id.startsWith("gift_accept:")) {
      text = "Si quiero";
    } else if (id.startsWith("gift_reject:")) {
      text = "Por ahora no";
    } else {
      text = title.trim();
    }
    if (!text) {
      console.log(`[wh] interactivo ${waMsgId} sin título, ignorando`);
      return;
    }
    content = text;
    console.log(`[wh] botón tocado en ${waMsgId}: "${text}" (id: ${id})`);
  } else if (msg.type === "document") {
    const docId = msg.document?.id;
    if (!docId) {
      console.warn(`[wh] documento ${waMsgId} sin id, ignorando`);
      return;
    }
    try {
      const downloaded = await downloadMediaFromMeta(docId, "document");
      const caption = msg.document?.caption?.trim() ?? "";
      const filename = msg.document?.filename?.trim() ?? null;
      content = caption || filename || "[documento]";
      media = {
        media_type: "document",
        media_url: downloaded.rel_path,
        media_mime: downloaded.mime,
        media_filename: filename,
        transcription: null,
        duration_sec: null,
      };
      console.log(
        `[wh] documento ${waMsgId} recibido (${downloaded.mime}, ${downloaded.size_bytes}B), filename: "${filename}", caption: "${caption.slice(0, 80)}"`
      );
    } catch (err) {
      console.error(`[wh] fallo descargando documento ${waMsgId}:`, err);
      return;
    }
  } else if (msg.type === "video") {
    const videoId = msg.video?.id;
    if (!videoId) {
      console.warn(`[wh] video ${waMsgId} sin id, ignorando`);
      return;
    }
    try {
      const downloaded = await downloadMediaFromMeta(videoId, "video");
      const caption = msg.video?.caption?.trim() ?? "";
      content = caption || "[video]";
      media = {
        media_type: "video",
        media_url: downloaded.rel_path,
        media_mime: downloaded.mime,
        media_filename: null,
        transcription: null,
        duration_sec: null,
      };
      console.log(
        `[wh] video ${waMsgId} recibido (${downloaded.mime}, ${downloaded.size_bytes}B), caption: "${caption.slice(0, 80)}"`
      );
    } catch (err) {
      console.error(`[wh] fallo descargando video ${waMsgId}:`, err);
      return;
    }
  } else if (msg.type === "image") {
    const imageId = msg.image?.id;
    if (!imageId) {
      console.warn(`[wh] imagen ${waMsgId} sin id, ignorando`);
      return;
    }
    try {
      const downloaded = await downloadMediaFromMeta(imageId, "image");
      const caption = msg.image?.caption?.trim() ?? "";
      content = caption || "[imagen]";
      media = {
        media_type: "image",
        media_url: downloaded.rel_path,
        media_mime: downloaded.mime,
        media_filename: null,
        transcription: null,
        duration_sec: null,
      };
      console.log(
        `[wh] imagen ${waMsgId} recibida (${downloaded.mime}, ${downloaded.size_bytes}B), caption: "${caption.slice(0, 80)}"`
      );
    } catch (err) {
      console.error(`[wh] fallo descargando imagen ${waMsgId}:`, err);
      return;
    }
  } else if (msg.type === "audio") {
    const audioId = msg.audio?.id;
    if (!audioId) {
      console.warn(`[wh] audio ${waMsgId} sin id, ignorando`);
      return;
    }
    try {
      const downloaded = await downloadMediaFromMeta(audioId, "audio");
      let transcription = "";
      let durationSec: number | null = null;
      try {
        const result = await transcribeAudio(downloaded.abs_path, downloaded.mime);
        transcription = result.text;
        durationSec = result.duration_sec;
        console.log(
          `[wh] audio ${waMsgId} transcrito (${durationSec ?? "?"}s): "${transcription.slice(0, 80)}"`
        );
      } catch (err) {
        console.error(`[wh] fallo transcribiendo ${waMsgId}:`, err);
      }
      content = transcription || "[audio sin transcripción]";
      media = {
        media_type: "audio",
        media_url: downloaded.rel_path,
        media_mime: downloaded.mime,
        media_filename: null,
        transcription: transcription || null,
        duration_sec: durationSec,
      };
    } catch (err) {
      console.error(`[wh] fallo descargando audio ${waMsgId}:`, err);
      return;
    }
  } else {
    console.log(
      `[wh] tipo ${msg.type ?? "?"} no soportado todavía, ignorando ${waMsgId}`
    );
    return;
  }

  // FASE 1 — INGESTA: guardamos el mensaje del cliente. Serializado por phone
  // para no duplicar la conversación/saludo si llegan dos casi juntos. Esto
  // SIEMPRE corre (todos los mensajes se guardan); la RESPUESTA se decide
  // después, en la FASE 2, tras el debounce.
  let convoId = 0;
  await withPhoneLock(phone, async () => {
  const convo = getOrCreateConversation(phone, pushName);
  convoId = convo.id;

  // Si este mensaje vino de un click en un anuncio de "Enviar mensaje por
  // WhatsApp", Meta adjunta el bloque `referral` con el ctwa_clid. Lo
  // guardamos para luego mandarlo a CAPI y que la atribución funcione en
  // Ads Manager. setConversationAdReferral solo escribe si la convo aún
  // no tenía un ctwa_clid (preserva la primera atribución).
  if (msg.referral?.ctwa_clid) {
    setConversationAdReferral(
      convo.id,
      msg.referral.ctwa_clid,
      msg.referral.source_id ?? null,
      msg.referral.source_url ?? null,
      msg.referral.headline ?? null
    );
    console.log(
      `[wh] convo ${convo.id} viene de ad ${msg.referral.source_id ?? "?"} (clid=${msg.referral.ctwa_clid.slice(0, 16)}…)`
    );
  }

  if (media) {
    insertMessageWithMedia(convo.id, "user", content, waMsgId, media);
  } else {
    insertMessage(convo.id, "user", content, waMsgId);
  }
  // Si el cliente responde mientras una contestacion del LLM aun tiene
  // burbujas demoradas, esas burbujas ya no consideran el mensaje nuevo.
  // Cancelamos solo esos fragmentos; no toca intros, pagos ni entregas.
  cancelPendingActionsByTypeForConvo(convo.id, "send_text_chunk");
  console.log(
    `[wh] <- mensaje de ${phone} (${pushName ?? "?"}): "${content.slice(0, 80)}"`
  );

  // Sincronizar lead a NocoDB tras cada mensaje del cliente (fire-and-forget).
  // La función solo PATCHea si cambió algo (label/resumen/nombre), así que es
  // barata si nada cambió.
  void syncLeadStatus(convo.id);
  }); // fin FASE 1 (ingesta)

  // DEBOUNCE anti-fragmentación: la gente escribe en RÁFAGAS de mensajitos.
  // En vez de responder a cada uno (lo que produce respuestas incoherentes),
  // esperamos unos segundos; si llega OTRO mensaje del mismo número, este se
  // descarta y solo el ÚLTIMO genera la respuesta, viendo TODO el bloque en
  // contexto. Como el webhook ya respondió 200 y procesa en background, esta
  // espera no afecta a Meta. Configurable con BOT_DEBOUNCE_SECONDS (env);
  // 0 lo desactiva. Bonus: menos llamadas al LLM = menos costo.
  const debounceSec = Number(process.env.BOT_DEBOUNCE_SECONDS ?? 8);
  if (debounceSec > 0 && convoId > 0) {
    latestInboundMsgId.set(phone, waMsgId);
    await sleep(debounceSec * 1000);
    if (latestInboundMsgId.get(phone) !== waMsgId) {
      console.log(
        `[wh] ${phone}: "${content.slice(0, 40)}" superado por otro mensaje más nuevo → no respondo (debounce, espero el bloque completo)`
      );
      return;
    }
  }

  // FASE 2 — REACCIÓN: workflow + respuesta del LLM. Serializada por phone.
  await withPhoneLock(phone, async () => {
  const convo = getConversationById(convoId);
  if (!convo) return;
  // Estado al entrar al lock de reacción: si ya estaba "payment_approved",
  // el guard de más abajo suprime la respuesta celebratoria del LLM fuera
  // de contexto (race con el worker que pasa a "awaiting_email").
  const stateAtLockStart = convo.state;

  const fresh = getConversationById(convo.id);
  if (!fresh || fresh.mode !== "AI") {
    console.log(`[wh] convo ${convo.id} en modo HUMAN, no respondo`);
    return;
  }

  // Delay humano: marcar como leído + mostrar "escribiendo…" + esperar.
  // Con esto el bot no parece un robot que responde al instante.
  const responseDelaySec =
    loadWorkflowConfig()?.bot_response_delay_seconds ?? 0;
  if (responseDelaySec > 0) {
    try {
      await markMessageRead(waMsgId, true);
    } catch (err) {
      console.error(
        `[wh] no se pudo marcar leído + typing para ${waMsgId}:`,
        err
      );
    }
    await sleep(responseDelaySec * 1000);
  }

  // Workflow engine: si el cliente está en algún paso scripted (saludo /
  // intro / pago), el engine maneja la respuesta y devolvemos sin llamar al
  // LLM. Si devuelve false, seguimos con la lógica IA normal.
  try {
    const handled = await tryWorkflowOnIncoming(fresh, content);
    if (handled) return;
  } catch (err) {
    console.error("[wh] workflow engine falló, fallback a IA:", err);
  }

  // MODO SILENCIOSO: el bot NO charla con el LLM. Pero una IMAGEN (posible
  // comprobante) SÍ debe pasar al LLM — leerla con visión es lo que aprueba el
  // pago; si la suprimiéramos, se caerían las ventas. Vender/seguir es del
  // engine (ya corrió arriba); los seguimientos tienen su propio toggle.
  if (loadWorkflowConfig()?.silent_mode === true) {
    const latestIsImage =
      getLatestUserMessage(convo.id)?.media_type === "image";
    if (!latestIsImage) {
      console.log(
        `[wh] convo ${convo.id} modo silencioso: no respondo (texto, sin LLM)`
      );
      return;
    }
    // Imagen → seguimos al LLM para leer el comprobante y aprobar el pago.
  }

  // Confirmación corta tras oferta visual: si el bot acaba de ofrecer una foto,
  // imagen o muestra, "si/s/ya/dale" manda la galería sin gastar tokens.
  if (msg.type === "text" || msg.type === "interactive" || msg.type === "button") {
    const gallery = getImageGallery(shouldHideOrderBumpSecondProduct(fresh));
    const historyForConsent = getRecentHistory(fresh.id, 8);
    const lastAssistant = [...historyForConsent]
      .reverse()
      .find((message) => message.role === "assistant");
    const item = lastAssistant
      ? pickGalleryAfterVisualConsent(
          content,
          lastAssistant.content,
          gallery,
          getSentMedia(fresh.id)
        )
      : null;
    if (item) {
      let consentGallerySent = false;
      try {
        await sendBotMediaFromDrive(
          fresh,
          item.media_type,
          item.drive_url,
          item.caption?.trim() || undefined
        );
        markMediaSent(fresh.id, item.topic);
        console.log(
          `[wh] convo ${fresh.id} -> media galeria por confirmacion "${item.topic}"`
        );
        consentGallerySent = true;
      } catch (err) {
        console.error(
          `[wh] envio de media galeria por confirmacion "${item.topic}" fallo:`,
          err
        );
      }
      if (consentGallerySent) return;
    }
  }

  // Palabras clave locales de la galeria: si el operador configuro keywords
  // para una muestra, podemos mandarla sin gastar tokens ni tocar el prompt.
  // Se ejecuta despues del workflow y respeta el ocultamiento del 2do producto
  // en Order Bump para no filtrar otra modalidad/etapa.
  if (msg.type === "text" || msg.type === "interactive" || msg.type === "button") {
    const gallery = getImageGallery(shouldHideOrderBumpSecondProduct(fresh));
    const item = findLocalGalleryKeywordMatch(
      content,
      gallery,
      getSentMedia(fresh.id)
    );
    if (item) {
      let localGallerySent = false;
      try {
        await sendBotMediaFromDrive(
          fresh,
          item.media_type,
          item.drive_url,
          item.caption?.trim() || undefined
        );
        markMediaSent(fresh.id, item.topic);
        console.log(
          `[wh] convo ${fresh.id} -> media galeria local "${item.topic}"`
        );
        localGallerySent = true;
      } catch (err) {
        console.error(
          `[wh] envio de media galeria local "${item.topic}" fallo:`,
          err
        );
      }
      if (localGallerySent) return;
    }
  }

  const history = getRecentHistory(convo.id, 20);
  // Releer convo por si workflow guardó nombre del cliente.
  const ctx = getConversationById(convo.id);
  const startedAt = Date.now();
  let reply: string;
  try {
    reply = await generateReply(history, {
      clientName: ctx?.client_name ?? null,
      pushName: ctx?.name ?? pushName ?? null,
      conversationId: convo.id,
    });
  } catch (err) {
    console.error("[wh] error generando respuesta LLM:", err);
    return;
  }
  console.log(`[wh] LLM en ${Date.now() - startedAt}ms`);

  // Extraer el marcador <<RESUMEN: ...>> que el LLM agrega al final de su
  // respuesta. Lo usamos para sincronizar a NocoDB con un resumen
  // específico de esta conversación (más rico que la heurística basada
  // en state). Se quita del texto antes de mandar al cliente.
  const resumenMatch = reply.match(/<<\s*RESUMEN\s*:\s*([^>]+)>>/i);
  if (resumenMatch) {
    const llmResumen = resumenMatch[1].trim();
    reply = reply.replace(/<<\s*RESUMEN\s*:\s*[^>]+>>\s*/gi, "").trim();
    if (llmResumen) {
      void overrideResumenInNocodb(convo.id, llmResumen);
    }
  }
  // Defensa ante marcadores truncados o mal formados (p. ej. un solo "<" o
  // sin cierre por límite del proveedor). Nunca deben llegar al cliente.
  reply = reply.replace(/<{1,2}\s*RESUMEN\s*:[\s\S]*$/i, "").trim();

  // Marcador <<PAIS: ecuador>>: el cliente es de Ecuador. En vez del texto del
  // LLM, mandamos el mensaje de redirección configurable (con el número de la
  // línea de Ecuador), que el operador edita en el panel. Otros países los
  // maneja el LLM con naturalidad (sin marcador).
  if (/<<\s*PAIS\s*:\s*ecuador\s*>>/i.test(reply)) {
    try {
      await sendCountryRedirect(fresh, "ecuador");
      console.log(`[wh] convo ${convo.id} redirigido a línea Ecuador`);
    } catch (err) {
      console.error("[wh] country redirect (ecuador) falló:", err);
    }
    return;
  }

  // Marcador <<ELIGE_PRODUCTO_1/2>>: en Doble Oferta 2 Productos, el LLM confirma
  // que el cliente eligió UNA de las 2 opciones (para lo que la detección
  // determinística NO cazó: frases raras, typos, tras un diálogo). El sistema
  // entrega los datos de pago de ESA opción (Producto 1 = combo, Producto 2 =
  // básico, mismo orden que el prompt). Solo actúa con la modalidad activa.
  const eligeMatch = /<<\s*ELIGE_PRODUCTO_([12])\s*>>/i.exec(reply);
  if (eligeMatch && loadWorkflowConfig()?.doble_oferta_dos?.enabled) {
    const choice = eligeMatch[1] === "1" ? "combo" : "basico";
    const leftover = reply
      .replace(/<<\s*ELIGE_PRODUCTO_[12]\s*>>\s*/gi, "")
      .trim();
    try {
      if (leftover) await sendChunkedBotText(fresh, leftover);
      await deliverDobleOfertaPaymentDetails(fresh, choice);
      console.log(
        `[wh] convo ${convo.id} → LLM confirmó elección "${choice}" (<<ELIGE_PRODUCTO_${eligeMatch[1]}>>), entrego datos de pago`
      );
    } catch (err) {
      console.error("[wh] entrega por marcador ELIGE_PRODUCTO falló:", err);
    }
    return;
  }

  // Marcadores del REGALO y el UPGRADE (misma idea que ELIGE_PRODUCTO): el LLM
  // confirma la intención cuando la detección determinística no la cazó, y el
  // SISTEMA ejecuta la acción. Cada uno con guard de ESTADO para que un marcador
  // suelto no dispare nada fuera de lugar. El texto del marcador nunca se envía.
  const stripMarkers = (r: string): string =>
    r
      .replace(
        /<<\s*(REGALO_SI|REGALO_NO|REGALO_HECHO|UPGRADE_COMBO)\s*>>\s*/gi,
        ""
      )
      .trim();
  // <<REGALO_SI>> / <<REGALO_NO>>: aceptar/rechazar el regalo (solo en su estado).
  if (
    /<<\s*REGALO_(SI|NO)\s*>>/i.test(reply) &&
    fresh.state === "awaiting_gift_consent"
  ) {
    const accepts = /<<\s*REGALO_SI\s*>>/i.test(reply);
    const leftover = stripMarkers(reply);
    try {
      if (leftover) await sendChunkedBotText(fresh, leftover);
      if (accepts) acceptGiftConsent(fresh);
      else await declineGiftConsent(fresh);
      console.log(
        `[wh] convo ${convo.id} → LLM confirmó regalo ${accepts ? "SÍ" : "NO"}`
      );
    } catch (err) {
      console.error("[wh] marcador REGALO_SI/NO falló:", err);
    }
    return;
  }
  // <<REGALO_HECHO>>: el cliente confirmó que comentó (solo en su estado).
  if (
    /<<\s*REGALO_HECHO\s*>>/i.test(reply) &&
    fresh.state === "awaiting_facebook_comment"
  ) {
    const leftover = stripMarkers(reply);
    try {
      if (leftover) await sendChunkedBotText(fresh, leftover);
      await claimGiftReward(fresh);
      console.log(`[wh] convo ${convo.id} → LLM confirmó comentario, entrego regalo`);
    } catch (err) {
      console.error("[wh] marcador REGALO_HECHO falló:", err);
    }
    return;
  }
  // <<UPGRADE_COMBO>>: el cliente (que ya compró) quiere subir al combo. El helper
  // valida internamente que haya saldo pendiente; si ya lo cubrió, no hace nada.
  if (/<<\s*UPGRADE_COMBO\s*>>/i.test(reply)) {
    try {
      const applied = await offerComboUpgrade(fresh);
      if (applied) {
        console.log(
          `[wh] convo ${convo.id} → LLM confirmó upgrade a combo, ofrecí saldo`
        );
        return;
      }
    } catch (err) {
      console.error("[wh] marcador UPGRADE_COMBO falló:", err);
    }
    // No aplicó (ya cubrió el combo o no había compra): quitamos el marcador y
    // dejamos que el reply del LLM siga su curso normal (se envía una sola vez).
    reply = stripMarkers(reply);
  }

  // Marcador <<METODOS_PAGO>>: el LLM pide mostrar el menú de pago con BOTONES
  // (solo cuando el toggle está activo). Quitamos el marcador; si quedó texto
  // del LLM lo mandamos antes, y luego enviamos los botones (Yape/Plin/BCP).
  if (/<<\s*METODOS_PAGO\s*>>/i.test(reply)) {
    const leftover = reply.replace(/<<\s*METODOS_PAGO\s*>>\s*/gi, "").trim();
    const paymentConvo = getConversationById(convo.id);
    const wantsPaymentMethodChange =
      /\b(cambiar|cambio|cambia|otro|otra)\b[\s\S]*\b(metodo|pago|yape|plin|bcp|transferencia)\b/i.test(
        content
      );
    if (
      paymentConvo?.state === "payment_done" &&
      paymentConvo.selected_payment_method &&
      !wantsPaymentMethodChange
    ) {
      // El cliente YA eligió método y vuelve a preguntar por el pago. En vez de
      // mandarlo a "buscar más arriba", RE-ENVIAMOS los datos del método que
      // eligió (mismo flujo determinístico que <<REENVIAR_PAGO>>). El LLM nunca
      // escribe los números de cuenta.
      const leftover = reply.replace(/<<\s*METODOS_PAGO\s*>>\s*/gi, "").trim();
      try {
        if (leftover) await sendChunkedBotText(fresh, leftover);
        const latestPaymentConvo = getConversationById(convo.id) ?? fresh;
        const ok = await resendPaymentDetails(latestPaymentConvo);
        if (!ok) await sendPaymentOffer(latestPaymentConvo);
        console.log(
          `[wh] convo ${convo.id} → reenvío de datos de pago (METODOS_PAGO, ok=${ok})`
        );
      } catch (err) {
        console.error(
          "[wh] reenvío de datos de pago (METODOS_PAGO) falló:",
          err
        );
      }
      return;
    }
    try {
      if (leftover) await sendChunkedBotText(fresh, leftover);
      // Envía el menú de pago configurado: texto (toggle OFF) o botones (ON).
      await sendPaymentOffer(fresh);
      console.log(`[wh] convo ${convo.id} → menú de métodos de pago`);
    } catch (err) {
      console.error("[wh] envío del menú de pago falló:", err);
    }
    return;
  }

  // Marcador <<TRANQUILIZAR>>: el cliente expresó desconfianza / miedo a estafa.
  // El SISTEMA manda el mensaje editable de tranquilización + su CTA (texto del
  // operador, no improvisado por el LLM). Si NO hay texto configurado, quitamos
  // el marcador y dejamos que la respuesta del LLM siga su curso normal.
  if (/<<\s*TRANQUILIZAR\s*>>/i.test(reply)) {
    const distrust = getDistrustMessage();
    if (distrust) {
      const leftover = reply.replace(/<<\s*TRANQUILIZAR\s*>>\s*/gi, "").trim();
      try {
        if (leftover) await sendChunkedBotText(fresh, leftover);
        await sendChunkedBotText(fresh, distrust);
        console.log(`[wh] convo ${convo.id} → mensaje de tranquilización enviado`);
      } catch (err) {
        console.error("[wh] envío de tranquilización falló:", err);
      }
      return;
    }
    reply = reply.replace(/<<\s*TRANQUILIZAR\s*>>\s*/gi, "").trim();
  }

  // Marcador <<REENVIAR_PAGO>>: el cliente, tras un desvío, vuelve a querer
  // pagar / pide los datos del método de nuevo. El SISTEMA re-envía la plantilla
  // del método que YA eligió (datos correctos + el CTA editable), en vez de
  // decirle "búscalo arriba". El LLM NUNCA escribe los números. Va ANTES del
  // <<REENVIAR>> para evitar solape de regex.
  if (/<<\s*REENVIAR_PAGO\s*>>/i.test(reply)) {
    const leftover = reply.replace(/<<\s*REENVIAR_PAGO\s*>>\s*/gi, "").trim();
    try {
      if (leftover) await sendChunkedBotText(fresh, leftover);
      const latestPaymentConvo = getConversationById(convo.id) ?? fresh;
      const ok = await resendPaymentDetails(latestPaymentConvo);
      // Si no hay método guardado, no dejamos al cliente sin nada (ni que el LLM
      // improvise): mostramos el menú de métodos como fallback seguro.
      if (!ok) await sendPaymentOffer(latestPaymentConvo);
      console.log(
        `[wh] convo ${convo.id} → reenvío de datos de pago (método guardado=${ok})`
      );
    } catch (err) {
      console.error("[wh] reenvío de datos de pago falló:", err);
    }
    return;
  }

  // Marcador <<REENVIAR>>: un cliente que YA PAGÓ pide su material/enlace de
  // nuevo (lo borró, lo perdió, no lo encuentra, "me lo reenvías?"). El SISTEMA
  // reenvía la secuencia de pago aprobado REAL (video + enlace + pedido de
  // correo); el LLM NUNCA escribe el enlace. Solo reenvía si la convo figura
  // pagada (resendApprovedMaterial lo verifica).
  if (/<<\s*REENVIAR\s*>>/i.test(reply)) {
    const leftover = reply.replace(/<<\s*REENVIAR\s*>>\s*/gi, "").trim();
    try {
      if (leftover) await sendChunkedBotText(fresh, leftover);
      const ok = resendApprovedMaterial(fresh);
      console.log(
        `[wh] convo ${convo.id} → reenvío de material solicitado (pagado=${ok})`
      );
    } catch (err) {
      console.error("[wh] reenvío de material falló:", err);
    }
    return;
  }

  // Marcador <<MEDIA: tema>>: el LLM decide mandar una imagen/video de la
  // galería (configurable). El bot lo emite SOLO cuando es relevante (el prompt
  // lo controla), así que lo enviamos SIEMPRE que lo pida — incluso si el cliente
  // RE-pregunta (se re-envía, sin el bug del "te envié y no llegó"). Cap del
  // sistema: UNA media por respuesta.
  const mediaMatches = [...reply.matchAll(/<<\s*MEDIA\s*:\s*([^>]+)>>/gi)];
  if (mediaMatches.length > 0) {
    reply = reply.replace(/<<\s*MEDIA\s*:\s*[^>]+>>\s*/gi, "").trim();
    const gallery = getImageGallery();
    // Si el item NO tiene caption fijo, usamos el texto que el BOT escribió como
    // caption (misma burbuja). Guard de longitud: WhatsApp limita el caption
    // (~1024); si es muy largo, va aparte.
    let captionFromBotUsed = false;
    for (const m of mediaMatches) {
      const topic = m[1].trim().toLowerCase();
      if (!topic) continue;
      const item = resolveGalleryItem(gallery, topic, content, reply);
      if (!item) continue;
      let caption = item.caption?.trim() || undefined;
      if (!caption && reply.trim() && reply.trim().length <= 1000) {
        caption = reply.trim();
        captionFromBotUsed = true;
      }
      try {
        await sendBotMediaFromDrive(
          fresh,
          item.media_type,
          item.drive_url,
          caption
        );
        console.log(`[wh] convo ${convo.id} → media galería "${topic}"`);
      } catch (err) {
        console.error(`[wh] envío de media galería "${topic}" falló:`, err);
      }
      break; // solo la PRIMERA media válida — una por respuesta
    }
    // Si el texto del bot ya fue como caption de la foto, no lo repetimos abajo.
    if (captionFromBotUsed) reply = "";
  }

  const refreshed = getConversationById(convo.id);
  // Suprimimos la respuesta del LLM si el state era payment_approved al
  // ENTRAR al lock (mientras la secuencia scripted estaba entregando
  // video + link + pedido de email) o si SIGUE siendo payment_approved.
  // El check del estado inicial cubre el race: el worker puede cambiar
  // state a "awaiting_email" mientras el LLM genera, lo que dejaba pasar
  // la respuesta celebratoria fuera de contexto (mensajes tipo
  // "¡Pago confirmado!", "A disfrutar del material" que venian del
  // prompt de payment_approved pero se enviaban cuando ya estabamos en
  // awaiting_email). Si fue payment_approved en algun momento de este
  // turno, el cliente ya recibio la confirmacion scripted — no necesita
  // otra del LLM.
  // ENTREGA / POST-COMPRA: cuando un COMPROBANTE (imagen) fue aprobado, el
  // sistema YA entrega el material con su mensaje de cierre. NO dejamos que el
  // LLM agregue otra respuesta — era la que re-mandaba enlaces y decía "tu pago
  // fue confirmado, en breve recibirás el acceso..." (confunde: el cliente cree
  // que el enlace ya enviado NO es el suyo y espera otro). Suprimimos si el
  // comprobante dejó la convo en CUALQUIER estado post-compra, sin depender del
  // timing exacto del worker. Un comprobante RECHAZADO NO pasa a estos estados,
  // así que ahí el LLM SÍ responde para explicar el rechazo.
  const latestUserIsImage =
    getLatestUserMessage(convo.id)?.media_type === "image";
  const postPurchaseStates = new Set([
    "payment_approved",
    "awaiting_email",
    "awaiting_gift_consent",
    "awaiting_facebook_comment",
  ]);
  if (
    latestUserIsImage &&
    (stateAtLockStart === "payment_approved" ||
      postPurchaseStates.has(refreshed?.state ?? ""))
  ) {
    console.log(
      `[wh] convo ${convo.id} entrega/post-compra (initial=${stateAtLockStart}, now=${refreshed?.state}, img=${latestUserIsImage}), suprimo respuesta LLM`
    );
    return;
  }

  // Si la respuesta del LLM tiene doble salto de línea (\n\n) la partimos
  // en mensajes separados con delay configurable. El LLM controla esto
  // desde el system prompt (instrucción de separar "ideas" con \n\n).
  try {
    if (reply.trim()) {
      await sendChunkedBotText(fresh, reply);
      console.log(`[wh] -> reply enviado a ${phone}`);
    }
  } catch (err) {
    console.error(`[wh] fallo al enviar a ${phone}:`, err);
  }
  }); // fin withPhoneLock
}
