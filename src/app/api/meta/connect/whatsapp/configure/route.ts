import { NextResponse } from "next/server";
import { getActiveMetaWhatsAppConnection } from "@/lib/db";
import { subscribeWhatsAppToWebhooks } from "@/lib/meta/connect";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  const active = getActiveMetaWhatsAppConnection();
  if (!active) {
    return NextResponse.json(
      { ok: false, error: "Primero detecta y elige un numero de WhatsApp." },
      { status: 400 }
    );
  }
  const subscription = await subscribeWhatsAppToWebhooks({
    wabaId: active.waba_id,
    accessToken: active.access_token,
  });
  return NextResponse.json({
    ok: subscription.ok,
    subscription,
    nextSteps: subscription.ok
      ? [
          "Copia el webhook y Verify Token de WhatsApp en Meta si aun no lo hiciste.",
          "Envia un mensaje de prueba al numero para comprobar la recepcion.",
        ]
      : [
          "Revisa que autorizaste whatsapp_business_management y whatsapp_business_messaging.",
          "Confirma que el numero pertenece al Business Manager elegido.",
        ],
  });
}

