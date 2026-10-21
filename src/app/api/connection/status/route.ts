import { NextResponse } from "next/server";
import { getPhoneNumberInfo } from "@/lib/meta/client";
import {
  getWebhookAppSecret,
  getWebhookVerifyToken,
  getWhatsAppRuntimeConfig,
} from "@/lib/meta/runtime-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
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
