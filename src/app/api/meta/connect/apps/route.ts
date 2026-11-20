import { NextResponse, type NextRequest } from "next/server";
import { deleteMetaRuntimeSettings, getMetaRuntimeSetting, listMetaWhatsAppConnections, setMetaRuntimeSettings } from "@/lib/db";
import { appsSuscritas, desenchufar, loQueNoSePudo, permisosPorApp, todosLosPermisos } from "@/lib/meta/desenchufar";
import { getPublicOrigin, graphVersion } from "@/lib/meta/connect";
import { getMetaAppId, getTokenDeLaConexion, getWebhookVerifyToken } from "@/lib/meta/runtime-config";
import { guardarOtraApp, otrasApps, quitarOtraApp, secretoDeOtraApp, tokenDeLaApp } from "@/lib/meta/apps-de-meta";
import { fetchMeta } from "@/lib/meta/freno";
import { olvidar } from "@/lib/meta/recuerdo";
import { negocioDeLaPrincipal } from "@/lib/meta/negocio-de-la-app";
import { permisosConocidos } from "@/lib/meta/token-por-numero";

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
  const suNegocio = negocioDeLaPrincipal();
  return NextResponse.json({
    principal: principal
      ? {
          appId: principal,
          negocio: suNegocio?.nombre ?? getMetaRuntimeSetting(`app_negocio_${principal}`) ?? null,
          negocioId: suNegocio?.id ?? null,
        }
      : null,
    // (19/11/2026) `conToken`: si ya tiene su permiso permanente (`tokenDeLaApp`), sin el cual sus números no se pueden
    // conectar a ella.
    otras: otrasApps().map((a) => ({ ...a, conToken: !!tokenDeLaApp(a.appId) })),
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
  // (19/11/2026) Con TODAS las cuentas de Facebook conectadas, no solo la de la conexión: el BM de la app puede estar
  // solo en otra (ver `app/route.ts`, su caso de BM Paginas 2).
  for (const token of [...new Set([getTokenDeLaConexion(), ...permisosConocidos()].filter((t): t is string => !!t))]) {
    if (negocioId) break;
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
  if (appId === getMetaAppId() && !otrasApps().some((a) => secretoDeOtraApp(a.appId))) {
    return NextResponse.json({
      ok: false,
      error: "Es tu única app. Para quitarla, usa «Cerrar sesión de Meta» en el asistente (deja Meta Connect vacío).",
    });
  }
  // (19/11/2026) DESCONECTAR DE VERDAD: primero se quita en Meta de cada cuenta de WhatsApp a la que está suscrita
  // (`desenchufar.ts`); antes solo se olvidaba en el bot y en Meta seguía conectada a sus números. Si Meta no deja, no
  // se olvida a medias: se dice qué falta. `forzar=1` = él decidió olvidarla igual, sabiendo lo que queda en Meta.
  if (req.nextUrl.searchParams.get("forzar") !== "1") {
    const permisos = todosLosPermisos();
    const porApp = await permisosPorApp(permisos);
    const pares: Array<{ wabaId: string; appId: string; nombreApp: string | null }> = [];
    for (const w of [...new Set(listMetaWhatsAppConnections().map((c) => c.waba_id))]) {
      const suscrita = ((await appsSuscritas(w, permisos)) ?? []).find((a) => a.id === appId);
      if (suscrita) pares.push({ wabaId: w, appId, nombreApp: suscrita.nombre });
    }
    const hechos = await desenchufar(pares, porApp);
    if (hechos.some((h) => !h.ok)) {
      return NextResponse.json({
        ok: false,
        enMeta: true,
        error: `No pude desconectarla en Meta de todo:\n${loQueNoSePudo(hechos)}\n\nPara quitarla del todo: developers.facebook.com → esa app → WhatsApp → Configuración, o borra la app.`,
      });
    }
  }
  // LA PRINCIPAL (15/11/2026): otra de las apps pasa a ser la principal. Si es la única, no se puede desde aquí.
  if (appId === getMetaAppId()) {
    const siguiente = otrasApps().find((a) => secretoDeOtraApp(a.appId));
    if (!siguiente) {
      return NextResponse.json({
        ok: false,
        error: "Es tu única app. Para quitarla, usa «Cerrar sesión de Meta» en el asistente (deja Meta Connect vacío).",
      });
    }
    const secreto = secretoDeOtraApp(siguiente.appId) as string;
    setMetaRuntimeSettings({
      meta_app_id: siguiente.appId,
      meta_app_secret: secreto,
      ...(siguiente.negocio ? { [`app_negocio_${siguiente.appId}`]: siguiente.negocio } : {}),
      ...(siguiente.negocioId ? { [`app_negocio_id_${siguiente.appId}`]: siguiente.negocioId } : {}),
    });
    // Las firmas de los canales salen de la principal: una clave guardada a mano de la vieja ya no vale.
    deleteMetaRuntimeSettings(["whatsapp_app_secret", "messenger_app_secret", "instagram_app_secret"]);
    quitarOtraApp(siguiente.appId);
    olvidar("");
    return NextResponse.json({ ok: true, principal: siguiente.appId });
  }
  quitarOtraApp(appId);
  olvidar("suscribir");
  return NextResponse.json({ ok: true });
}
