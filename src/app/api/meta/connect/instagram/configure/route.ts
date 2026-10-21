import { NextResponse } from "next/server";
import { getActiveInstagramMetaConnection } from "@/lib/db";
import { subscribePageToMessagingWebhooks } from "@/lib/meta/connect";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  const active = getActiveInstagramMetaConnection();
  if (!active) {
    return NextResponse.json(
      { ok: false, error: "Primero elige una cuenta de Instagram." },
      { status: 400 }
    );
  }

  const subscription = await subscribePageToMessagingWebhooks({
    pageId: active.page_id,
    pageAccessToken: active.page_access_token,
  });

  return NextResponse.json({
    ok: subscription.ok,
    pageId: active.page_id,
    pageName: active.page_name,
    instagramUsername: active.instagram_username,
    subscription,
    nextSteps: subscription.ok
      ? [
          "Configura el Webhook Instagram mostrado por el panel en Meta Developers si aun no lo hiciste.",
          "Prueba un DM desde una cuenta externa antes de atender clientes.",
        ]
      : [
          "Revisa que autorizaste permisos de Instagram y que la pagina esta vinculada a esa cuenta profesional.",
          "No actives la misma cuenta de Instagram en dos bots a la vez.",
        ],
  });
}
