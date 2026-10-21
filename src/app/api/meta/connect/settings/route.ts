import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getMetaRuntimeSetting, setMetaRuntimeSettings } from "@/lib/db";
import { getMetaAppId, getMetaOAuthAppSecret } from "@/lib/meta/runtime-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function verifyToken(): string {
  return `agent_${crypto.randomBytes(18).toString("hex")}`;
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ ok: false, error: "Datos invalidos." }, { status: 400 });
  }

  const appId = text(body.appId);
  const appSecret = text(body.appSecret);
  const currentAppId = getMetaAppId();
  const currentAppSecret = getMetaOAuthAppSecret();

  if (!appId && !currentAppId) {
    return NextResponse.json({ ok: false, error: "Falta Meta App ID." }, { status: 400 });
  }
  if (!appSecret && !currentAppSecret) {
    return NextResponse.json(
      { ok: false, error: "Falta la clave secreta de la App de Meta." },
      { status: 400 }
    );
  }
  if (appId && appId !== currentAppId && !appSecret) {
    return NextResponse.json(
      {
        ok: false,
        error: "Al cambiar Meta App ID, pega tambien la clave secreta de esa nueva App.",
      },
      { status: 400 }
    );
  }

  const values: Record<string, string> = {};
  if (appId) values.meta_app_id = appId;
  if (appSecret) values.meta_app_secret = appSecret;
  const instagramAppSecret = text(body.instagramAppSecret);
  const whatsAppAccessToken = text(body.whatsAppAccessToken);
  if (instagramAppSecret) values.instagram_app_secret = instagramAppSecret;
  if (whatsAppAccessToken) {
    values.whatsapp_access_token_override = whatsAppAccessToken;
  }
  if (!getMetaRuntimeSetting("whatsapp_verify_token")) {
    values.whatsapp_verify_token = verifyToken();
  }
  if (!getMetaRuntimeSetting("messenger_verify_token")) {
    values.messenger_verify_token = verifyToken();
  }
  if (!getMetaRuntimeSetting("instagram_verify_token")) {
    values.instagram_verify_token = verifyToken();
  }
  setMetaRuntimeSettings(values);

  return NextResponse.json({ ok: true });
}
