import { NextResponse } from "next/server";
import { getMetaRuntimeSetting, listMetaWhatsAppConnections } from "@/lib/db";
import { graphVersion } from "@/lib/meta/connect";
import { getMetaAppId, getMetaOAuthAppSecret, getTokenDeLaConexion } from "@/lib/meta/runtime-config";
import { permisosConocidos, repartirTokenPermanente } from "@/lib/meta/token-por-numero";
import { MEDIA_HORA, MINUTOS, olvidar, recordar } from "@/lib/meta/recuerdo";
import { fetchMeta, metaFrenada } from "@/lib/meta/freno";

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
    // Con el freno de seguridad: si Meta está cerca del límite, no se pregunta.
    const r = await fetchMeta(url);
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

/**
 * SOLO LA LISTA DE BM (21/10/2026): 1 llamada por cuenta de Facebook. Antes se revisaban los 10 BM
 * con 3 preguntas cada uno al abrir el paso; ahora solo se revisa el BM que él elige.
 */
async function leerBms(): Promise<Array<{ id: string; nombre: string; token: string }>> {
  const vistos = new Map<string, { id: string; nombre: string; token: string }>();
  const listas = await Promise.all(
    permisosConocidos().map(async (token) => ({
      token,
      r: await graph<{ data?: Array<{ id: string; name?: string }> }>("me/businesses", token, { fields: "id,name", limit: "200" }),
    }))
  );
  for (const { token, r } of listas) for (const b of r?.data ?? []) if (!vistos.has(b.id)) vistos.set(b.id, { id: b.id, nombre: b.name ?? b.id, token });
  return [...vistos.values()];
}

/** UN BM: ¿tiene la app? ¿tiene un usuario del sistema administrador? 3 preguntas, a la vez. */
async function revisarBm(b: { id: string; token: string }): Promise<{ conLaApp: boolean; usuarioAdmin: boolean }> {
  const appId = getMetaAppId();
  const [propias, deClientes, usuarios] = await Promise.all([
    graph<{ data?: Array<{ id?: string }> }>(`${b.id}/owned_apps`, b.token, { fields: "id", limit: "200" }),
    graph<{ data?: Array<{ id?: string }> }>(`${b.id}/client_apps`, b.token, { fields: "id", limit: "200" }),
    graph<{ data?: Array<{ role?: string }> }>(`${b.id}/system_users`, b.token, { fields: "id,role", limit: "100" }),
  ]);
  return {
    conLaApp: !!appId && [...(propias?.data ?? []), ...(deClientes?.data ?? [])].some((x) => x.id === appId),
    usuarioAdmin: (usuarios?.data ?? []).some((u) => String(u.role ?? "").toUpperCase() === "ADMIN"),
  };
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
  // Si Meta dice que ya no vale, se avisa: esos números ya no tienen con qué contestar.
  let vence: number | null = null;
  let loginVencido = false;
  if (faltan && login && appId && secreto) {
    // Recordado 10 minutos: el aviso rojo lo pide en cada paso del asistente.
    const d = await recordar(`token-estado:vence:${login.slice(-12)}`, MINUTOS(10), () =>
      graph<{ data?: { is_valid?: boolean; expires_at?: number; data_access_expires_at?: number } }>("debug_token", `${appId}|${secreto}`, {
        input_token: login,
      })
    );
    loginVencido = d?.data?.is_valid === false;
    const fechas = [d?.data?.expires_at, d?.data?.data_access_expires_at].filter((x): x is number => !!x && x > 0);
    vence = fechas.length ? Math.min(...fechas) * 1000 : null;
  }

  // Por cada BM: ¿tiene la app? ¿tiene un usuario del sistema administrador? Todos a la vez.
  // La lista de BM (recordada media hora) y, solo del BM pedido con «?bm=», sus dos requisitos.
  // «?fresco=1» («Ya lo hice, revisar de nuevo») relee ese BM, porque él acaba de cambiar algo.
  let negocios: Array<{ id: string; nombre: string; conLaApp?: boolean; usuarioAdmin?: boolean }> = [];
  if (!ligero) {
    const p = new URL(req.url).searchParams;
    const bms = await recordar("token-estado:bms", MEDIA_HORA, leerBms);
    const pedido = bms.find((b) => b.id === p.get("bm"));
    let revisado: { conLaApp: boolean; usuarioAdmin: boolean } | null = null;
    if (pedido) {
      if (p.get("fresco") === "1") olvidar(`token-estado:bm:${pedido.id}`);
      revisado = await recordar(`token-estado:bm:${pedido.id}`, MEDIA_HORA, () => revisarBm(pedido));
    }
    negocios = bms.map((b) => ({ id: b.id, nombre: b.nombre, ...(b.id === pedido?.id && revisado ? revisado : {}) }));
  }
  // Primero los que tienen números, luego por nombre.
  const conNumeros = new Set(numeros.map((n) => n.negocioId));
  negocios = [...negocios].sort(
    (a, b) => Number(conNumeros.has(b.id)) - Number(conNumeros.has(a.id)) || a.nombre.localeCompare(b.nombre, "es")
  );

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
      loginVencido,
      frenado: metaFrenada(),
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
  if (!general || !listMetaWhatsAppConnections().some((c) => c.token_permanente !== 1)) {
    return NextResponse.json({ ok: true, numeros: [] });
  }
  // Una vez cada 10 minutos basta: los números no cambian de BM.
  const alcanzados = await recordar(`token-estado:repartir:${general.slice(-12)}`, MINUTOS(10), () => repartirTokenPermanente(general));
  return NextResponse.json({ ok: true, numeros: alcanzados.map((c) => c.display_phone_number ?? c.phone_number_id) });
}
