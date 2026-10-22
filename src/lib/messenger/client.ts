import fs from "node:fs";
import path from "node:path";
import { getActiveMetaConnection, getMetaConnectionByPageId } from "@/lib/db";
import { getOutboundMessengerPage } from "@/lib/meta/runtime-config";

function graphBase(): string {
  const version = process.env.META_GRAPH_VERSION ?? "v21.0";
  return `https://graph.facebook.com/${version}`;
}

/**
 * EL TOKEN DE LA PAGINA POR LA QUE SE ESTA RESPONDIENDO.
 *
 * Cada pagina tiene SU token. Antes aqui se tomaba siempre el de la pagina ACTIVA,
 * asi que con dos paginas conectadas la segunda contestaba con el token de la
 * primera: Meta lo rechaza, o peor, le contesta al cliente desde la pagina que no
 * es. Lo pidio el dueño el 01/10/2026 al montar su segunda pagina.
 *
 * Sin contexto fijado se cae a la ACTIVA y luego a la variable de entorno, que es
 * exactamente lo que hacia antes: con una sola pagina no cambia nada.
 */
function getMessengerToken(): string {
  const deLaPagina = getOutboundMessengerPage();
  const token =
    (deLaPagina
      ? getMetaConnectionByPageId(deLaPagina)?.page_access_token
      : null) ??
    getActiveMetaConnection()?.page_access_token ??
    process.env.MESSENGER_PAGE_ACCESS_TOKEN;
  if (!token) throw new Error("MESSENGER_PAGE_ACCESS_TOKEN no configurado");
  return token;
}

/**
 * SIN LOS ASTERISCOS DE WHATSAPP (22/10/2026). En WhatsApp `*PRECIO*` es negrita; Messenger no lo
 * dibuja y el cliente veía los asteriscos. Se quitan las marcas de negrita, cursiva y tachado SOLO
 * cuando envuelven texto (pegadas a él por dentro y con un espacio o un signo por fuera): un `*` o
 * un `_` sueltos —un enlace con guion bajo, «2*3»— no se tocan. El texto guardado en el chat no
 * cambia; esto es solo lo que viaja a Messenger.
 */
export function sinFormatoDeWhatsApp(text: string): string {
  let t = text;
  for (const marca of ["\\*", "_", "~"]) {
    const re = new RegExp(
      `(^|[\\s(¡¿"'«])${marca}(?=\\S)([^\\n]*?\\S)${marca}(?=$|[\\s.,;:!?)"'»])`,
      "gm"
    );
    // Dos pasadas: «*hola* *chau*» deja la segunda pegada a la primera tras la primera pasada.
    t = t.replace(re, "$1$2").replace(re, "$1$2");
  }
  return t;
}

export async function sendMessengerText(
  psid: string,
  text: string,
  /** RESPUESTAS RÁPIDAS (22/10/2026): los botones del bot, cada uno con su id. Máximo 13. */
  respuestasRapidas?: { id: string; title: string }[]
): Promise<void> {
  const token = getMessengerToken();

  const url = new URL(`${graphBase()}/me/messages`);
  url.searchParams.set("access_token", token);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      recipient: { id: psid },
      messaging_type: "RESPONSE",
      message: {
        text: sinFormatoDeWhatsApp(text),
        ...(respuestasRapidas?.length
          ? {
              // Messenger corta el título a 20 caracteres; el id viaja entero y es lo que se enruta.
              quick_replies: respuestasRapidas.slice(0, 13).map((b) => ({
                content_type: "text",
                title: sinFormatoDeWhatsApp(b.title).slice(0, 20),
                payload: b.id,
              })),
            }
          : {}),
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Messenger send failed ${res.status}: ${body}`);
  }
  const body = await res.text();
  console.log(`[messenger] -> ${psid}: enviado (${body.slice(0, 160)})`);
}

type MessengerAttachmentType = "image" | "video" | "audio" | "file";

function messengerAttachmentType(
  kind: "audio" | "image" | "video" | "document"
): MessengerAttachmentType {
  if (kind === "document") return "file";
  return kind;
}

async function uploadMessengerAttachment(
  absPath: string,
  mime: string,
  kind: "audio" | "image" | "video" | "document"
): Promise<string> {
  const token = getMessengerToken();

  const url = new URL(`${graphBase()}/me/message_attachments`);
  url.searchParams.set("access_token", token);

  const form = new FormData();
  form.append(
    "message",
    JSON.stringify({
      attachment: {
        type: messengerAttachmentType(kind),
        payload: { is_reusable: true },
      },
    })
  );
  const buffer = fs.readFileSync(absPath);
  form.append("filedata", new Blob([buffer], { type: mime }), path.basename(absPath));

  const res = await fetch(url, {
    method: "POST",
    body: form,
  });

  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Messenger attachment upload failed ${res.status}: ${body}`);
  }
  const parsed = JSON.parse(body) as {
    attachment_id?: string;
    attachment?: { payload?: { attachment_id?: string } };
  };
  const attachmentId =
    parsed.attachment_id ?? parsed.attachment?.payload?.attachment_id;
  if (!attachmentId) {
    throw new Error(`Messenger attachment upload sin attachment_id: ${body}`);
  }
  return attachmentId;
}

export async function sendMessengerMedia(
  psid: string,
  kind: "audio" | "image" | "video" | "document",
  absPath: string,
  mime: string,
  caption?: string
): Promise<void> {
  const token = getMessengerToken();

  const attachmentId = await uploadMessengerAttachment(absPath, mime, kind);
  const url = new URL(`${graphBase()}/me/messages`);
  url.searchParams.set("access_token", token);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      recipient: { id: psid },
      messaging_type: "RESPONSE",
      message: {
        attachment: {
          type: messengerAttachmentType(kind),
          payload: { attachment_id: attachmentId },
        },
      },
    }),
  });

  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Messenger media send failed ${res.status}: ${body}`);
  }
  console.log(`[messenger] -> ${psid}: media ${kind} enviada (${body.slice(0, 160)})`);

  if (caption?.trim()) {
    await sendMessengerText(psid, caption.trim());
  }
}
