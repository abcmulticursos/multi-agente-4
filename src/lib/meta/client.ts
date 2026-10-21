import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getWhatsAppRuntimeConfig } from "@/lib/meta/runtime-config";

function graphBase(): string {
  const version = process.env.META_GRAPH_VERSION ?? "v21.0";
  return `https://graph.facebook.com/${version}`;
}

function getWhatsAppCredentials(): { phoneId: string | null; token: string | null } {
  const config = getWhatsAppRuntimeConfig();
  return { phoneId: config.phoneNumberId, token: config.accessToken };
}

export interface MetaErrorPayload {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
}

export class MetaApiError extends Error {
  status: number;
  code: number | null;
  subcode: number | null;
  raw: string;
  constructor(status: number, raw: string, parsed: MetaErrorPayload | null) {
    const message =
      parsed?.error?.message ?? `Graph API ${status}`;
    super(message);
    this.name = "MetaApiError";
    this.status = status;
    this.code = parsed?.error?.code ?? null;
    this.subcode = parsed?.error?.error_subcode ?? null;
    this.raw = raw;
  }
}

async function throwGraphError(res: Response): Promise<never> {
  const text = await res.text();
  let parsed: MetaErrorPayload | null = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  throw new MetaApiError(res.status, text, parsed);
}

export async function sendTextMessage(
  phone: string,
  body: string,
  /** wamid del mensaje al que se responde. Con esto WhatsApp muestra la
   *  burbuja citada arriba, igual que al responder desde el teléfono. Sin
   *  esto, el mensaje sale suelto como siempre. */
  replyToWamid?: string | null
): Promise<{ wa_message_id: string }> {
  const { phoneId, token } = getWhatsAppCredentials();
  if (!phoneId || !token) {
    throw new Error(
      "META_PHONE_NUMBER_ID o META_ACCESS_TOKEN no configurados"
    );
  }
  const res = await fetch(`${graphBase()}/${phoneId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: phone,
      ...(replyToWamid ? { context: { message_id: replyToWamid } } : {}),
      type: "text",
      text: { preview_url: false, body },
    }),
  });
  if (!res.ok) await throwGraphError(res);
  const json = (await res.json()) as {
    messages?: Array<{ id?: string }>;
  };
  const id = json.messages?.[0]?.id;
  if (!id) {
    throw new Error(`Respuesta de Graph sin id: ${JSON.stringify(json)}`);
  }
  return { wa_message_id: id };
}

/**
 * Envía un mensaje INTERACTIVO con botones de respuesta (reply buttons).
 * Máximo 3 botones; cada título se recorta a 20 caracteres (límite de Meta).
 * Header de texto opcional. Se usa dentro de la ventana de 24h (respuesta a
 * un mensaje del cliente) → no requiere plantilla.
 */
export async function sendInteractiveButtons(
  phone: string,
  bodyText: string,
  buttons: { id: string; title: string }[],
  header?: { mediaType?: "image" | "video"; mediaId?: string; text?: string }
): Promise<{ wa_message_id: string }> {
  const { phoneId, token } = getWhatsAppCredentials();
  if (!phoneId || !token) {
    throw new Error("META_PHONE_NUMBER_ID o META_ACCESS_TOKEN no configurados");
  }
  const replyButtons = buttons.slice(0, 3).map((b) => ({
    type: "reply" as const,
    reply: { id: b.id, title: b.title.slice(0, 20) },
  }));
  const interactive: Record<string, unknown> = {
    type: "button",
    body: { text: bodyText },
    action: { buttons: replyButtons },
  };
  // Cabecera: media (imagen/video) o texto. La media va en la MISMA burbuja
  // que el cuerpo y los botones (header de un mensaje interactivo).
  if (header?.mediaId && header.mediaType) {
    interactive.header = {
      type: header.mediaType,
      [header.mediaType]: { id: header.mediaId },
    };
  } else if (header?.text && header.text.trim()) {
    interactive.header = { type: "text", text: header.text.slice(0, 60) };
  }
  const res = await fetch(`${graphBase()}/${phoneId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: phone,
      type: "interactive",
      interactive,
    }),
  });
  if (!res.ok) await throwGraphError(res);
  const json = (await res.json()) as { messages?: Array<{ id?: string }> };
  const id = json.messages?.[0]?.id;
  if (!id) {
    throw new Error(`Respuesta de Graph sin id: ${JSON.stringify(json)}`);
  }
  return { wa_message_id: id };
}

export async function uploadMediaToMeta(
  absFilePath: string,
  mime: string
): Promise<{ media_id: string }> {
  const { phoneId, token } = getWhatsAppCredentials();
  if (!phoneId || !token) {
    throw new Error(
      "META_PHONE_NUMBER_ID o META_ACCESS_TOKEN no configurados"
    );
  }
  const buffer = fs.readFileSync(absFilePath);
  const filename = path.basename(absFilePath);

  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", mime);
  form.append("file", new Blob([new Uint8Array(buffer)], { type: mime }), filename);

  // Queda registrado EXACTAMENTE que se le manda a Meta. Si el archivo esta
  // bien y aun asi Meta dice que no reconoce el contenido, el problema esta
  // aqui — en el nombre, el tipo o el tamano — y no en la conversion.
  console.log(
    `[media] subiendo a Meta: nombre="${filename}" tipo="${mime}" ${buffer.length} bytes`
  );

  const res = await fetch(`${graphBase()}/${phoneId}/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) await throwGraphError(res);
  const json = (await res.json()) as { id?: string };
  if (!json.id) {
    throw new Error(`Upload media sin id: ${JSON.stringify(json)}`);
  }

  // COMPROBACION: se le pregunta a Meta QUE guardo. Meta devuelve el tamano, el
  // tipo y el sha256 de lo que tiene. Comparando el sha con el del archivo que
  // mandamos se sabe, sin lugar a dudas, si llegaron los mismos bytes.
  //
  // Existe porque Meta acepto un audio OGG/Opus valido y luego, al entregarlo,
  // dijo que "on processing it is of type application/octet-stream". O guardo
  // otra cosa, o el problema es suyo. Esto lo distingue.
  //
  // Nunca puede tumbar la subida: va en su propio try y solo escribe en el log.
  try {
    const shaLocal = crypto.createHash("sha256").update(buffer).digest("hex");
    const infoRes = await fetch(
      `${graphBase()}/${json.id}?fields=file_size,mime_type,sha256`,
      { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
    );
    if (infoRes.ok) {
      const info = (await infoRes.json()) as {
        file_size?: number;
        mime_type?: string;
        sha256?: string;
      };
      const iguales = info.sha256 === shaLocal;
      console.log(
        `[media] Meta guardo: tipo="${info.mime_type ?? "?"}" ${info.file_size ?? "?"} bytes ` +
          `| nosotros mandamos ${buffer.length} bytes | bytes identicos=${iguales}`
      );
      if (!iguales) {
        console.warn(
          `[media] LOS BYTES NO COINCIDEN. sha nuestro=${shaLocal.slice(0, 16)}… sha de Meta=${(info.sha256 ?? "?").slice(0, 16)}…`
        );
      }
    } else {
      console.warn(
        `[media] no pude consultar que guardo Meta (${infoRes.status})`
      );
    }
  } catch (err) {
    console.warn("[media] fallo la comprobacion de lo guardado:", err);
  }

  return { media_id: json.id };
}

export async function sendAudioMessage(
  phone: string,
  mediaId: string
): Promise<{ wa_message_id: string }> {
  const { phoneId, token } = getWhatsAppCredentials();
  if (!phoneId || !token) {
    throw new Error(
      "META_PHONE_NUMBER_ID o META_ACCESS_TOKEN no configurados"
    );
  }
  const res = await fetch(`${graphBase()}/${phoneId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: phone,
      type: "audio",
      audio: { id: mediaId },
    }),
  });
  if (!res.ok) await throwGraphError(res);
  const json = (await res.json()) as {
    messages?: Array<{ id?: string }>;
  };
  const id = json.messages?.[0]?.id;
  if (!id) {
    throw new Error(`Respuesta de Graph sin id: ${JSON.stringify(json)}`);
  }
  return { wa_message_id: id };
}

export async function sendImageMessage(
  phone: string,
  mediaId: string,
  caption?: string
): Promise<{ wa_message_id: string }> {
  const { phoneId, token } = getWhatsAppCredentials();
  if (!phoneId || !token) {
    throw new Error(
      "META_PHONE_NUMBER_ID o META_ACCESS_TOKEN no configurados"
    );
  }
  const imagePayload: { id: string; caption?: string } = { id: mediaId };
  if (caption && caption.trim()) imagePayload.caption = caption.trim();

  const res = await fetch(`${graphBase()}/${phoneId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: phone,
      type: "image",
      image: imagePayload,
    }),
  });
  if (!res.ok) await throwGraphError(res);
  const json = (await res.json()) as {
    messages?: Array<{ id?: string }>;
  };
  const id = json.messages?.[0]?.id;
  if (!id) {
    throw new Error(`Respuesta de Graph sin id: ${JSON.stringify(json)}`);
  }
  return { wa_message_id: id };
}

export async function sendDocumentMessage(
  phone: string,
  mediaId: string,
  filename?: string,
  caption?: string
): Promise<{ wa_message_id: string }> {
  const { phoneId, token } = getWhatsAppCredentials();
  if (!phoneId || !token) {
    throw new Error(
      "META_PHONE_NUMBER_ID o META_ACCESS_TOKEN no configurados"
    );
  }
  const docPayload: { id: string; filename?: string; caption?: string } = {
    id: mediaId,
  };
  if (filename && filename.trim()) docPayload.filename = filename.trim();
  if (caption && caption.trim()) docPayload.caption = caption.trim();

  const res = await fetch(`${graphBase()}/${phoneId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: phone,
      type: "document",
      document: docPayload,
    }),
  });
  if (!res.ok) await throwGraphError(res);
  const json = (await res.json()) as {
    messages?: Array<{ id?: string }>;
  };
  const id = json.messages?.[0]?.id;
  if (!id) {
    throw new Error(`Respuesta de Graph sin id: ${JSON.stringify(json)}`);
  }
  return { wa_message_id: id };
}

export async function sendVideoMessage(
  phone: string,
  mediaId: string,
  caption?: string
): Promise<{ wa_message_id: string }> {
  const { phoneId, token } = getWhatsAppCredentials();
  if (!phoneId || !token) {
    throw new Error(
      "META_PHONE_NUMBER_ID o META_ACCESS_TOKEN no configurados"
    );
  }
  const videoPayload: { id: string; caption?: string } = { id: mediaId };
  if (caption && caption.trim()) videoPayload.caption = caption.trim();

  const res = await fetch(`${graphBase()}/${phoneId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: phone,
      type: "video",
      video: videoPayload,
    }),
  });
  if (!res.ok) await throwGraphError(res);
  const json = (await res.json()) as {
    messages?: Array<{ id?: string }>;
  };
  const id = json.messages?.[0]?.id;
  if (!id) {
    throw new Error(`Respuesta de Graph sin id: ${JSON.stringify(json)}`);
  }
  return { wa_message_id: id };
}

/**
 * Marca un mensaje entrante como leído. Si `withTyping = true`, también
 * muestra el indicador "escribiendo…" en el chat del cliente. El indicador
 * se mantiene hasta que enviamos un mensaje real o pasen ~25s (lo que
 * ocurra primero — Meta lo gestiona).
 */
export async function markMessageRead(
  waMessageId: string,
  withTyping = false
): Promise<void> {
  const { phoneId, token } = getWhatsAppCredentials();
  if (!phoneId || !token) {
    throw new Error(
      "META_PHONE_NUMBER_ID o META_ACCESS_TOKEN no configurados"
    );
  }
  const body: {
    messaging_product: string;
    status: string;
    message_id: string;
    typing_indicator?: { type: string };
  } = {
    messaging_product: "whatsapp",
    status: "read",
    message_id: waMessageId,
  };
  if (withTyping) body.typing_indicator = { type: "text" };
  const res = await fetch(`${graphBase()}/${phoneId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) await throwGraphError(res);
}

export interface PhoneNumberInfo {
  display_phone_number: string;
  verified_name: string;
  quality_rating: string;
  profile_picture_url: string | null;
}

export async function getPhoneNumberInfo(): Promise<PhoneNumberInfo> {
  const { phoneId, token } = getWhatsAppCredentials();
  if (!phoneId || !token) {
    throw new Error(
      "META_PHONE_NUMBER_ID o META_ACCESS_TOKEN no configurados"
    );
  }
  const url = `${graphBase()}/${phoneId}?fields=display_phone_number,verified_name,quality_rating`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) await throwGraphError(res);
  const info = (await res.json()) as Omit<PhoneNumberInfo, "profile_picture_url">;
  const profileUrl = `${graphBase()}/${phoneId}/whatsapp_business_profile?fields=profile_picture_url`;
  try {
    const profileRes = await fetch(profileUrl, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!profileRes.ok) return { ...info, profile_picture_url: null };
    const profile = (await profileRes.json()) as {
      profile_picture_url?: string | null;
      data?: Array<{ profile_picture_url?: string | null }>;
    };
    return {
      ...info,
      profile_picture_url:
        profile.profile_picture_url ??
        profile.data?.[0]?.profile_picture_url ??
        null,
    };
  } catch {
    return { ...info, profile_picture_url: null };
  }
}
