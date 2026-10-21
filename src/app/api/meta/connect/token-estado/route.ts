import { NextResponse } from "next/server";
import { getActiveMetaWhatsAppConnection, getMetaRuntimeSetting } from "@/lib/db";
import { graphVersion } from "@/lib/meta/connect";
import { getMetaAppId, getMetaOAuthAppSecret, getTokenDeLaConexion } from "@/lib/meta/runtime-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * EL TOKEN PERMANENTE, LO QUE HACE FALTA SABER DE ÉL (20/10/2026). «El token permanente no es un
 * chiste… es una de las bases del proyecto; no generarlo es dejar que el proyecto se caiga.»
 *
 * Solo lee. Dice: si hay token permanente y en qué BM quedó; en qué BM está el número que atiende
 * (el token tiene que poder usarlo); en qué BM está agregada la app (sin eso Meta no deja crear el
 * token); y CUÁNDO CADUCA la conexión sin él (lo dice Meta). Ningún permiso sale de aquí.
 */
async function graph<T>(ruta: string, token: string, params: Record<string, string> = {}): Promise<T | null> {
  try {
    const url = new URL(`https://graph.facebook.com/${graphVersion()}/${ruta}`);
    url.searchParams.set("access_token", token);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const r = await fetch(url, { cache: "no-store" });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  // «?ligero=1»: solo si hay token y cuándo caduca (para el aviso fijo); sin recorrer los BM.
  const ligero = new URL(req.url).searchParams.get("ligero") === "1";
  // (También cuenta el que se puso en las variables de EasyPanel, como antes de Meta Connect.)
  const tiene = Boolean(getMetaRuntimeSetting("whatsapp_access_token_override") || process.env.META_ACCESS_TOKEN?.trim());
  const negocioDelTokenId = getMetaRuntimeSetting("token_permanente_negocio_id");
  const numero = getActiveMetaWhatsAppConnection();
  const appId = getMetaAppId();
  const secreto = getMetaOAuthAppSecret();
  const login = getTokenDeLaConexion();

  // Cuándo caduca el permiso del inicio de sesión (con el que se trabaja sin token permanente).
  let vence: number | null = null;
  if (!tiene && login && appId && secreto) {
    const d = await graph<{ data?: { expires_at?: number; data_access_expires_at?: number } }>("debug_token", `${appId}|${secreto}`, {
      input_token: login,
    });
    const fechas = [d?.data?.expires_at, d?.data?.data_access_expires_at].filter((x): x is number => !!x && x > 0);
    vence = fechas.length ? Math.min(...fechas) * 1000 : null;
  }

  // Los BM del inicio de sesión y en cuáles está agregada la app.
  const negocios: Array<{ id: string; nombre: string; conLaApp: boolean }> = [];
  if (login && !ligero) {
    const r = await graph<{ data?: Array<{ id: string; name?: string }> }>("me/businesses", login, { fields: "id,name", limit: "200" });
    for (const b of r?.data ?? []) {
      let conLaApp = false;
      for (const borde of ["owned_apps", "client_apps"]) {
        if (conLaApp || !appId) break;
        const a = await graph<{ data?: Array<{ id?: string }> }>(`${b.id}/${borde}`, login, { fields: "id", limit: "200" });
        conLaApp = (a?.data ?? []).some((x) => x.id === appId);
      }
      negocios.push({ id: b.id, nombre: b.name ?? b.id, conLaApp });
    }
  }

  return NextResponse.json(
    {
      tiene,
      negocioDelToken: negocioDelTokenId ? { id: negocioDelTokenId, nombre: getMetaRuntimeSetting("token_permanente_negocio") ?? negocioDelTokenId } : null,
      numero: numero
        ? { numero: numero.display_phone_number ?? numero.phone_number_id, negocioId: numero.business_id ?? null, negocio: numero.business_name ?? null }
        : null,
      vence,
      appId,
      negocios,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
