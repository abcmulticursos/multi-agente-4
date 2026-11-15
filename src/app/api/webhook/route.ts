import { NextResponse, type NextRequest } from "next/server";
import { verifySignature } from "@/lib/meta/verify";
import { processWebhookPayload } from "@/lib/meta/handler";
import { getWebhookAppSecret, getWebhookVerifyToken } from "@/lib/meta/runtime-config";
import { clavesDeFirma } from "@/lib/meta/apps-de-meta";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Para avisar de las firmas que no son nuestras sin llenar el registro (ver el POST).
let firmasInvalidas = 0;
let ultimoAvisoDeFirma = 0;

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

  // MULTI APP (15/11/2026): vale la firma de cualquiera de nuestras apps (`clavesDeFirma`), no solo la principal.
  if (!verifySignature(raw, sig, appSecret) && !clavesDeFirma("whatsapp").some((clave) => verifySignature(raw, sig, clave))) {
    // (15/11/2026) COMO MESSENGER: NO se procesa, pero se contesta 200. Con 401 Meta reintenta sin parar (él vio
    // cientos de líneas al cambiar de app y temió que Meta lo tomara por un webhook roto). Se dice de qué número
    // viene, sin datos del cliente, y una vez cada 30 s como mucho.
    firmasInvalidas++;
    if (Date.now() - ultimoAvisoDeFirma > 30_000) {
      let numeros = "?";
      try {
        const p = JSON.parse(raw) as { entry?: Array<{ changes?: Array<{ value?: { metadata?: { phone_number_id?: string; display_phone_number?: string } } }> }> };
        numeros = [...new Set((p.entry ?? []).flatMap((e) => (e.changes ?? []).map((c) => c.value?.metadata?.display_phone_number ?? c.value?.metadata?.phone_number_id ?? "?")))].join(", ") || "?";
      } catch {
        // solo es el aviso
      }
      console.warn(`[webhook] firma de una app que no es nuestra — ignoro ${firmasInvalidas} aviso(s) · número(s): ${numeros}. Si es tuyo, agrega su app en Meta Connect.`);
      ultimoAvisoDeFirma = Date.now();
      firmasInvalidas = 0;
    }
    return NextResponse.json({ ok: true });
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
