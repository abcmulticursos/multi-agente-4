import { NextResponse, type NextRequest } from "next/server";
import { getMetaRuntimeSetting } from "@/lib/db";
import { getPublicOrigin, graphVersion } from "@/lib/meta/connect";
import { getMetaAppId, getTokenDeLaConexion, getWebhookVerifyToken } from "@/lib/meta/runtime-config";
import { guardarOtraApp, otrasApps, quitarOtraApp } from "@/lib/meta/apps-de-meta";
import { fetchMeta } from "@/lib/meta/freno";
import { olvidar } from "@/lib/meta/recuerdo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * LAS APPS DEL BOT (15/11/2026, multi app). GET: la principal y las otras (sin secretos). POST {appId, appSecret}:
 * agrega otra app — comprueba con Meta que el id y la clave son de verdad, busca su negocio y le pone los avisos de
 * mensajes (webhooks) apuntando a ESTE bot, como «Preparar» hace con la principal. DELETE ?appId=: la quita.
 * Ver `src/lib/meta/apps-de-meta.ts`.
 */
export async function GET() {
  const principal = getMetaAppId();
  return NextResponse.json({
    principal: principal
      ? {
          appId: principal,
          negocio: getMetaRuntimeSetting(`app_negocio_${principal}`) ?? null,
        }
      : null,
    otras: otrasApps(),
  });
}

const CAMPOS: Record<string, string[]> = {
  whatsapp_business_account: ["messages"],
  page: ["messages,messaging_postbacks,messaging_referrals,feed", "messages,messaging_postbacks,feed", "messages"],
  instagram: ["messages"],
};
const RUTA: Record<string, string> = {
  whatsapp_business_account: "/api/webhook",
  page: "/api/webhooks/messenger",
  instagram: "/api/webhooks/instagram",
};
const CANAL: Record<string, "whatsapp" | "messenger" | "instagram"> = {
  whatsapp_business_account: "whatsapp",
  page: "messenger",
  instagram: "instagram",
};

export async function POST(req: NextRequest) {
  const cuerpo = (await req.json().catch(() => null)) as { appId?: unknown; appSecret?: unknown } | null;
  const appId = typeof cuerpo?.appId === "string" ? cuerpo.appId.trim() : "";
  const appSecret = typeof cuerpo?.appSecret === "string" ? cuerpo.appSecret.trim() : "";
  if (!/^\d{6,}$/.test(appId) || !appSecret) {
    return NextResponse.json({ ok: false, error: "Pon el ID de la app (solo números) y su clave secreta." }, { status: 400 });
  }
  if (appId === getMetaAppId()) {
    return NextResponse.json({ ok: false, error: "Esa ya es la app principal de este bot." }, { status: 400 });
  }
  const tokenDeApp = `${appId}|${appSecret}`;

  // 1. ¿El id y la clave son de verdad? Meta solo contesta su nombre con la clave correcta.
  const datos = await fetchMeta(new URL(`https://graph.facebook.com/${graphVersion()}/${appId}?fields=name&access_token=${encodeURIComponent(tokenDeApp)}`))
    .then((r) => r.json().catch(() => null))
    .catch(() => null) as { name?: string; error?: { message?: string } } | null;
  if (!datos?.name) {
    return NextResponse.json({ ok: false, error: `Meta no reconoce ese ID con esa clave secreta. ${datos?.error?.message ?? ""}`.trim() });
  }

  // 2. Su negocio (para enseñar sus números, páginas y pixeles). Se busca con la sesión de Meta conectada; si esa
  //    cuenta no ve el negocio de la app, queda sin identificar (y no se esconde nada).
  let negocio: string | null = null;
  let negocioId: string | null = null;
  const token = getTokenDeLaConexion();
  if (token) {
    const r = (await fetchMeta(
      new URL(`https://graph.facebook.com/${graphVersion()}/me/businesses?fields=id,name,owned_apps.limit(200){id}&limit=200&access_token=${encodeURIComponent(token)}`)
    )
      .then((x) => x.json().catch(() => null))
      .catch(() => null)) as { data?: Array<{ id?: string; name?: string; owned_apps?: { data?: Array<{ id?: string }> } }> } | null;
    const dueño = (r?.data ?? []).find((b) => (b.owned_apps?.data ?? []).some((a) => a.id === appId));
    if (dueño?.id) {
      negocioId = dueño.id;
      negocio = dueño.name ?? null;
    }
  }

  // 3. Sus avisos de mensajes, a ESTE bot.
  const origen = getPublicOrigin(req);
  const pasos: Array<{ paso: string; ok: boolean; detalle: string }> = [];
  for (const [objeto, listas] of Object.entries(CAMPOS)) {
    const verify = getWebhookVerifyToken(CANAL[objeto]);
    if (!origen || !verify) {
      pasos.push({ paso: `Webhook de ${objeto}`, ok: false, detalle: "falta la dirección del bot o su verify token" });
      continue;
    }
    let ok = false;
    let detalle = "";
    for (const campos of listas) {
      const r = await fetch(`https://graph.facebook.com/${graphVersion()}/${appId}/subscriptions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ object: objeto, callback_url: `${origen}${RUTA[objeto]}`, fields: campos, verify_token: verify, access_token: tokenDeApp }),
      }).catch(() => null);
      const c = (await r?.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (r?.ok) {
        ok = true;
        detalle = `escuchando ${campos}`;
        break;
      }
      detalle = c?.error?.message ?? `Meta respondió ${r?.status ?? "sin respuesta"}`;
    }
    pasos.push({ paso: `Webhook de ${objeto}`, ok, detalle });
  }

  guardarOtraApp({ appId, nombre: datos.name, negocio, negocioId }, appSecret);
  olvidar("suscribir");
  return NextResponse.json({ ok: true, app: { appId, nombre: datos.name, negocio, negocioId }, pasos });
}

export async function DELETE(req: NextRequest) {
  const appId = req.nextUrl.searchParams.get("appId")?.trim() ?? "";
  if (!appId) return NextResponse.json({ ok: false, error: "Falta el ID de la app." }, { status: 400 });
  quitarOtraApp(appId);
  olvidar("suscribir");
  return NextResponse.json({ ok: true });
}
