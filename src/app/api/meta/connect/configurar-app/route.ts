import { NextResponse, type NextRequest } from "next/server";
import { getPublicOrigin, graphVersion } from "@/lib/meta/connect";
import {
  getMetaAppId,
  getMetaOAuthAppSecret,
  getWebhookVerifyToken,
} from "@/lib/meta/runtime-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Qué campos escucha cada canal. Se piden de más a menos: si Meta rechaza la
 * lista larga por un campo que la app no tiene aprobado, se prueba la corta en
 * vez de quedarse sin webhook.
 */
const CAMPOS: Record<string, string[]> = {
  whatsapp_business_account: ["messages"],
  page: [
    "messages,messaging_postbacks,messaging_referrals,feed",
    "messages,messaging_postbacks,feed",
    "messages",
  ],
  instagram: ["messages"],
};

function tokenDeApp(): string | null {
  const appId = getMetaAppId();
  const appSecret = getMetaOAuthAppSecret();
  return appId && appSecret ? `${appId}|${appSecret}` : null;
}

/**
 * A que direccion escucha cada canal.
 *
 * NO es la misma para los tres. Cada canal tiene su propia ruta y su propio
 * verify token, y la ruta solo acepta el token de SU canal: si se le manda a
 * Meta la direccion de WhatsApp para la pagina, la comprobacion de Meta llega
 * con el token de Messenger, /api/webhook no lo reconoce y responde 403.
 * Eso es exactamente el error "(#2200) Callback verification failed ... 403".
 */
const RUTA_POR_OBJETO: Record<string, string> = {
  whatsapp_business_account: "/api/webhook",
  page: "/api/webhooks/messenger",
  instagram: "/api/webhooks/instagram",
};

function urlDelWebhook(req: NextRequest, objeto: string): string {
  return `${getPublicOrigin(req)}${RUTA_POR_OBJETO[objeto] ?? "/api/webhook"}`;
}

/**
 * Lo que la app tiene puesto AHORA. Solo lee: sirve para mirar antes de tocar.
 */
export async function GET(req: NextRequest) {
  const appId = getMetaAppId();
  const token = tokenDeApp();
  if (!appId || !token) {
    return NextResponse.json({
      ok: false,
      error: "Faltan el ID de la app o su clave secreta.",
    });
  }

  try {
    const url = new URL(
      `https://graph.facebook.com/${graphVersion()}/${appId}/subscriptions`
    );
    url.searchParams.set("access_token", token);
    const res = await fetch(url, { cache: "no-store" });
    const cuerpo = (await res.json().catch(() => null)) as {
      data?: Array<{ object?: string; callback_url?: string; active?: boolean }>;
      error?: { message?: string };
    } | null;

    return NextResponse.json({
      ok: res.ok,
      error: res.ok ? null : cuerpo?.error?.message ?? `Meta respondió ${res.status}`,
      // Lo que se le va a poner, para poder compararlo antes de aplicar.
      urlsPropuestas: Object.keys(CAMPOS).map((objeto) => ({
        objeto,
        url: urlDelWebhook(req, objeto),
      })),
      suscripciones: (cuerpo?.data ?? []).map((fila) => ({
        objeto: fila.object ?? "?",
        url: fila.callback_url ?? "",
        activa: fila.active !== false,
      })),
    });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : "No se pudo consultar a Meta.",
    });
  }
}

/**
 * Deja la app lista: su dominio y sus webhooks.
 *
 * Esto REESCRIBE la configuración de webhook de la app, que es por donde entran
 * todos los mensajes. Por eso la pantalla pide confirmación antes de llamar
 * aquí: si queda mal, el bot deja de recibir.
 *
 * La URI de redireccionamiento NO se toca: Meta no la deja escribir por API, y
 * es el único paso que queda a mano. Se devuelve para poder copiarla.
 */
export async function POST(req: NextRequest) {
  const appId = getMetaAppId();
  const token = tokenDeApp();
  if (!appId || !token) {
    return NextResponse.json({
      ok: false,
      error: "Faltan el ID de la app o su clave secreta.",
    });
  }

  const origen = getPublicOrigin(req);
  if (!origen) {
    return NextResponse.json({
      ok: false,
      error: "No sé con qué dirección pública responde este bot.",
    });
  }
  const dominio = new URL(origen).hostname;
  const pasos: Array<{ paso: string; ok: boolean; detalle: string }> = [];

  // 1. Los datos básicos de la app: dominio, sitio web y política de privacidad.
  //
  // Los tres van en la MISMA llamada a propósito. Meta los acepta juntos, y así
  // no queda la app a medio configurar si una de tres llamadas falla.
  //
  // La política de privacidad apunta a /privacidad, que este mismo bot sirve.
  // Es además uno de los requisitos del App Review, así que dejarla puesta
  // desde el principio ahorra volver luego.
  const politicaDePrivacidad = `${origen}/privacidad`;
  try {
    const url = new URL(`https://graph.facebook.com/${graphVersion()}/${appId}`);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        app_domains: [dominio],
        website_url: origen,
        privacy_policy_url: politicaDePrivacidad,
        access_token: token,
      }),
    });
    const cuerpo = (await res.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    pasos.push({
      paso: `Dominio, sitio web y política de privacidad`,
      ok: res.ok,
      detalle: res.ok
        ? `${dominio} · ${origen} · ${politicaDePrivacidad}`
        : cuerpo?.error?.message ?? `Meta respondió ${res.status}`,
    });
  } catch {
    pasos.push({
      paso: "Dominio, sitio web y política de privacidad",
      ok: false,
      detalle: "no se pudo llamar a Meta",
    });
  }

  // 2. Los webhooks, uno por canal.
  for (const [objeto, listas] of Object.entries(CAMPOS)) {
    const verifyToken = getWebhookVerifyToken(
      objeto === "page"
        ? "messenger"
        : objeto === "instagram"
          ? "instagram"
          : "whatsapp"
    );
    if (!verifyToken) {
      pasos.push({
        paso: `Webhook de ${objeto}`,
        ok: false,
        detalle: "no hay verify token generado todavía",
      });
      continue;
    }

    let logrado = false;
    let ultimoDetalle = "";
    for (const campos of listas) {
      try {
        const url = new URL(
          `https://graph.facebook.com/${graphVersion()}/${appId}/subscriptions`
        );
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            object: objeto,
            callback_url: urlDelWebhook(req, objeto),
            fields: campos,
            verify_token: verifyToken,
            access_token: token,
          }),
        });
        const cuerpo = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        if (res.ok) {
          logrado = true;
          ultimoDetalle = `escuchando ${campos}`;
          break;
        }
        ultimoDetalle = cuerpo?.error?.message ?? `Meta respondió ${res.status}`;
      } catch {
        ultimoDetalle = "no se pudo llamar a Meta";
      }
    }
    pasos.push({ paso: `Webhook de ${objeto}`, ok: logrado, detalle: ultimoDetalle });
  }

  return NextResponse.json({
    ok: pasos.some((paso) => paso.ok),
    pasos,
    // Lo único que queda a mano.
    uriDeRedireccion: `${origen}/api/meta/connect/callback`,
    // Meta puede negarse a escribir los datos básicos: hay un candado en
    // Configuración → Avanzado ("Permitir acceso de API a configuración de la
    // app") y en algunas apps no se puede levantar. No rompe nada — son tres
    // campos de papeleo, no tocan mensajes ni ventas — pero para llenarlos a
    // mano hay que saber QUÉ poner. Así que cuando el paso falla se devuelven
    // los tres valores ya calculados, listos para copiar.
    datosBasicos: pasos[0]?.ok
      ? null
      : { dominio, sitioWeb: origen, politicaDePrivacidad },
  });
}
