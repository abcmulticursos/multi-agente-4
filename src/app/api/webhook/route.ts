import { NextResponse, type NextRequest } from "next/server";
import { verifySignature } from "@/lib/meta/verify";
import { processWebhookPayload } from "@/lib/meta/handler";
import { getWebhookAppSecret, getWebhookVerifyToken } from "@/lib/meta/runtime-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  const expected = getWebhookVerifyToken("whatsapp");
  if (mode === "subscribe" && expected && token === expected) {
    // IMPORTANTE: Meta exige el challenge como text/plain RAW, no JSON.
    return new NextResponse(challenge ?? "", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }
  return new NextResponse("forbidden", { status: 403 });
}

export async function POST(req: NextRequest) {
  // Leer raw primero — el HMAC se calcula sobre el body crudo.
  const raw = await req.text();
  const sig = req.headers.get("x-hub-signature-256");
  const appSecret = getWebhookAppSecret("whatsapp");

  if (!appSecret) {
    console.error("[webhook] META_APP_SECRET no configurado");
    return new NextResponse("server misconfigured", { status: 500 });
  }

  if (!verifySignature(raw, sig, appSecret)) {
    console.warn("[webhook] firma inválida — rechazando");
    return new NextResponse("invalid signature", { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new NextResponse("bad json", { status: 400 });
  }

  // Responder 200 inmediatamente — Meta tiene timeout de ~10s.
  // El procesamiento real corre en background.
  void processWebhookPayload(payload).catch((err) =>
    console.error("[webhook] error procesando:", err)
  );

  return NextResponse.json({ ok: true });
}
