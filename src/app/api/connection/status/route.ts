import { NextResponse } from "next/server";
import { getActiveMetaWhatsAppConnection, listMetaWhatsAppConnections } from "@/lib/db";
import { getPhoneNumberInfo } from "@/lib/meta/client";
import {
  getWebhookAppSecret,
  getWebhookVerifyToken,
  getWhatsAppRuntimeConfig,
  withOutboundWhatsAppNumber,
} from "@/lib/meta/runtime-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  // CON VARIOS NÚMEROS, CUALQUIERA SIRVE (21/10/2026): tras conectar Facebook con 7 números no
  // quedó ninguno como «activo», y el chat entero se bloqueaba con la pantalla de configuración,
  // aunque las tiendas tuvieran su número. Se revisa el principal si lo hay; si no, uno conectado
  // (primero uno con token permanente, que no caduca). Con un solo número, es el de siempre.
  const conectados = listMetaWhatsAppConnections().filter((c) => c.pausado !== 1);
  const principal =
    getActiveMetaWhatsAppConnection() ?? conectados.find((c) => c.token_permanente === 1) ?? conectados[0] ?? null;
  return withOutboundWhatsAppNumber(principal?.phone_number_id ?? null, revisar);
}

async function revisar() {
  const whatsApp = getWhatsAppRuntimeConfig();
  const missing = [
    ...(!whatsApp.accessToken ? ["WhatsApp Access Token"] : []),
    ...(!whatsApp.phoneNumberId ? ["WhatsApp Phone Number ID"] : []),
    ...(!getWebhookAppSecret("whatsapp") ? ["WhatsApp App Secret"] : []),
    ...(!getWebhookVerifyToken("whatsapp") ? ["WhatsApp Verify Token"] : []),
  ];
  if (missing.length > 0) {
    return NextResponse.json(
      { status: "missing_config", missing },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
  try {
    const info = await getPhoneNumberInfo();
    return NextResponse.json(
      {
        status: "connected",
        phone: info.display_phone_number,
        verified_name: info.verified_name,
        quality: info.quality_rating,
        profile_picture_url: info.profile_picture_url,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { status: "error", message },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
}
