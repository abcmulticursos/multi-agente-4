import { NextResponse } from "next/server";
import { getMetaRuntimeSetting, listMetaWhatsAppConnections } from "@/lib/db";
import { graphVersion } from "@/lib/meta/connect";
import { getMetaAppId, getMetaOAuthAppSecret, getTokenDeLaConexion } from "@/lib/meta/runtime-config";
import { repartirTokenPermanente } from "@/lib/meta/token-por-numero";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * EL TOKEN PERMANENTE, LO QUE HACE FALTA SABER DE ÉL (20/10/2026). «El token permanente no es un
 * chiste… es una de las bases del proyecto; no generarlo es dejar que el proyecto se caiga.»
 *
 * Desde el 21/10 va POR NÚMERO: cada número contesta con el token de su BM. Esto dice cuáles lo
 * tienen y cuáles no, y por cada BM las dos cosas que Meta exige para crearlo: la app agregada y
 * un usuario del sistema administrador. Y cuándo caduca el inicio de sesión, que es con lo que
 * contestan los que no lo tienen.
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
  // «?ligero=1»: solo los números y cuándo caduca (para el aviso fijo); sin recorrer los BM.
  const ligero = new URL(req.url).searchParams.get("ligero") === "1";
  const appId = getMetaAppId();
  const secreto = getMetaOAuthAppSecret();
  const login = getTokenDeLaConexion();

  const numeros = listMetaWhatsAppConnections().map((c) => ({
    id: c.phone_number_id,
    numero: c.display_phone_number ?? c.phone_number_id,
    nombre: c.verified_name ?? null,
    negocioId: c.business_id ?? null,
    negocio: c.business_name ?? null,
    permanente: c.token_permanente === 1,
    activo: c.active === 1,
  }));
  // Una instalación con el token puesto en las variables de EasyPanel, sin números en Meta
  // Connect, cuenta como que lo tiene (como antes de Meta Connect).
  const delEntorno = !numeros.length && !!process.env.META_ACCESS_TOKEN?.trim();
  const faltan = numeros.filter((n) => !n.permanente).length;

  // Cuándo caduca el inicio de sesión (con el que contestan los números sin token permanente).
  let vence: number | null = null;
  if (faltan && login && appId && secreto) {
    const d = await graph<{ data?: { expires_at?: number; data_access_expires_at?: number } }>("debug_token", `${appId}|${secreto}`, {
      input_token: login,
    });
    const fechas = [d?.data?.expires_at, d?.data?.data_access_expires_at].filter((x): x is number => !!x && x > 0);
    vence = fechas.length ? Math.min(...fechas) * 1000 : null;
  }

  // Por cada BM: ¿tiene la app? ¿tiene un usuario del sistema administrador? Todos a la vez.
  let negocios: Array<{ id: string; nombre: string; conLaApp: boolean; usuarioAdmin: boolean }> = [];
  if (login && !ligero) {
    const r = await graph<{ data?: Array<{ id: string; name?: string }> }>("me/businesses", login, { fields: "id,name", limit: "200" });
    negocios = await Promise.all(
      (r?.data ?? []).map(async (b) => {
        const [propias, deClientes, usuarios] = await Promise.all([
          graph<{ data?: Array<{ id?: string }> }>(`${b.id}/owned_apps`, login, { fields: "id", limit: "200" }),
          graph<{ data?: Array<{ id?: string }> }>(`${b.id}/client_apps`, login, { fields: "id", limit: "200" }),
          graph<{ data?: Array<{ role?: string }> }>(`${b.id}/system_users`, login, { fields: "id,role", limit: "100" }),
        ]);
        const conLaApp = !!appId && [...(propias?.data ?? []), ...(deClientes?.data ?? [])].some((x) => x.id === appId);
        const usuarioAdmin = (usuarios?.data ?? []).some((u) => String(u.role ?? "").toUpperCase() === "ADMIN");
        return { id: b.id, nombre: b.name ?? b.id, conLaApp, usuarioAdmin };
      })
    );
    // Primero los que tienen números, luego por nombre.
    const conNumeros = new Set(numeros.map((n) => n.negocioId));
    negocios.sort((a, b) => Number(conNumeros.has(b.id)) - Number(conNumeros.has(a.id)) || a.nombre.localeCompare(b.nombre, "es"));
  }

  return NextResponse.json(
    {
      // Compatibilidad con el aviso y la revisión: «tiene» = ningún número sin token permanente.
      tiene: delEntorno || (numeros.length > 0 && faltan === 0),
      negocioDelToken: getMetaRuntimeSetting("token_permanente_negocio")
        ? { id: getMetaRuntimeSetting("token_permanente_negocio_id") ?? "", nombre: getMetaRuntimeSetting("token_permanente_negocio")! }
        : null,
      numeros,
      faltan,
      vence,
      appId,
      negocios,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

/**
 * EL TOKEN QUE YA EXISTE, A LOS NÚMEROS QUE ALCANZA. Para los que se crearon antes del 21/10,
 * cuando había uno solo para todo: se le pone a cada número que de verdad alcanza, y a ningún otro.
 */
export async function POST() {
  const general = getMetaRuntimeSetting("whatsapp_access_token_override");
  if (!general) return NextResponse.json({ ok: true, numeros: [] });
  const alcanzados = await repartirTokenPermanente(general);
  return NextResponse.json({ ok: true, numeros: alcanzados.map((c) => c.display_phone_number ?? c.phone_number_id) });
}
