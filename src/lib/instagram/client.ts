import fs from "node:fs";
import path from "node:path";
import { getActiveInstagramMetaConnection } from "@/lib/db";

function graphBase(): string {
  const version = process.env.META_GRAPH_VERSION ?? "v21.0";
  return `https://graph.facebook.com/${version}`;
}

function getToken(): string {
  const token =
    getActiveInstagramMetaConnection()?.page_access_token ??
    process.env.INSTAGRAM_PAGE_ACCESS_TOKEN;
  if (!token) throw new Error("INSTAGRAM_PAGE_ACCESS_TOKEN no configurado");
  return token;
}

export async function sendInstagramText(
  igsid: string,
  text: string
): Promise<void> {
  const url = new URL(`${graphBase()}/me/messages`);
  url.searchParams.set("access_token", getToken());

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: { id: igsid },
      messaging_type: "RESPONSE",
      message: { text },
    }),
  });

  const body = await res.text();
  if (!res.ok) throw new Error(`Instagram send failed ${res.status}: ${body}`);
  console.log(`[instagram] -> ${igsid}: enviado (${body.slice(0, 160)})`);
}

type InstagramAttachmentType = "image" | "video" | "audio" | "file";

function instagramAttachmentType(
  kind: "audio" | "image" | "video" | "document"
): InstagramAttachmentType {
  if (kind === "document") return "file";
  return kind;
}

async function uploadInstagramAttachment(
  absPath: string,
  mime: string,
  kind: "audio" | "image" | "video" | "document"
): Promise<string> {
  const url = new URL(`${graphBase()}/me/message_attachments`);
  url.searchParams.set("access_token", getToken());

  const form = new FormData();
  form.append(
    "message",
    JSON.stringify({
      attachment: {
        type: instagramAttachmentType(kind),
        payload: { is_reusable: true },
      },
    })
  );
  const buffer = fs.readFileSync(absPath);
  form.append("filedata", new Blob([buffer], { type: mime }), path.basename(absPath));

  const res = await fetch(url, { method: "POST", body: form });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Instagram attachment upload failed ${res.status}: ${body}`);
  }
  const parsed = JSON.parse(body) as {
    attachment_id?: string;
    attachment?: { payload?: { attachment_id?: string } };
  };
  const attachmentId =
    parsed.attachment_id ?? parsed.attachment?.payload?.attachment_id;
  if (!attachmentId) {
    throw new Error(`Instagram attachment upload sin attachment_id: ${body}`);
  }
  return attachmentId;
}

export async function sendInstagramMedia(
  igsid: string,
  kind: "audio" | "image" | "video" | "document",
  absPath: string,
  mime: string,
  caption?: string
): Promise<void> {
  const attachmentId = await uploadInstagramAttachment(absPath, mime, kind);
  const url = new URL(`${graphBase()}/me/messages`);
  url.searchParams.set("access_token", getToken());

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: { id: igsid },
      messaging_type: "RESPONSE",
      message: {
        attachment: {
          type: instagramAttachmentType(kind),
          payload: { attachment_id: attachmentId },
        },
      },
    }),
  });

  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Instagram media send failed ${res.status}: ${body}`);
  }
  console.log(`[instagram] -> ${igsid}: media ${kind} enviada (${body.slice(0, 160)})`);

  if (caption?.trim()) await sendInstagramText(igsid, caption.trim());
}
