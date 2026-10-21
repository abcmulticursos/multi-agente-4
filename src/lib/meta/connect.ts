import crypto from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { getMetaWhatsAppConnection } from "@/lib/db";
import { fetchMeta } from "@/lib/meta/freno";
import { MEDIA_HORA, recordar } from "@/lib/meta/recuerdo";
import {
  getMetaAppId as getStoredMetaAppId,
  getMetaOAuthAppSecret,
} from "@/lib/meta/runtime-config";

export const META_CONNECT_COOKIE = "meta_oauth_state";
export const META_CONNECT_INSTAGRAM_COOKIE = "meta_oauth_instagram";
/** «1» = este login es «Conectar nueva cuenta»: no pisa nada de la cuenta de siempre.
 *  Ver `callback/route.ts` y PLAN-VARIAS-CUENTAS-DE-FACEBOOK.md, apartado 5. */
export const META_CONNECT_NUEVA_COOKIE = "meta_oauth_nueva_cuenta";

const CORE_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_metadata",
  "pages_messaging",
  "business_management",
  "whatsapp_business_management",
  "whatsapp_business_messaging",
  "ads_read",
];

const INSTAGRAM_SCOPES = ["instagram_basic", "instagram_manage_messages"];

interface TokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: { message?: string };
}

interface MetaPageAccount {
  id: string;
  name: string;
  access_token: string;
  picture?: { data?: { url?: string } };
  instagram_business_account?: {
    id: string;
    username?: string;
    name?: string;
  };
}

interface AccountsResponse {
  data?: MetaPageAccount[];
  error?: { message?: string };
}

interface MetaBusiness {
  id: string;
  name?: string;
}

interface MetaBusinessResponse {
  data?: MetaBusiness[];
  error?: { message?: string };
}

interface MetaPhoneNumber {
  id: string;
  display_phone_number?: string;
  verified_name?: string;
  code_verification_status?: string;
}

interface MetaWaba {
  id: string;
  name?: string;
  phone_numbers?: { data?: MetaPhoneNumber[] };
}

interface MetaWabaResponse {
  data?: MetaWaba[];
  error?: { message?: string };
}

interface MetaPixel {
  id: string;
  name?: string;
}

interface MetaPixelResponse {
  data?: MetaPixel[];
  error?: { message?: string };
}

export interface MetaConnectPage {
  pageId: string;
  pageName: string;
  pageAccessToken: string;
  instagramBusinessAccountId: string | null;
  instagramUsername: string | null;
  pagePictureUrl: string | null;
}

export function graphVersion(): string {
  return process.env.META_GRAPH_VERSION ?? "v21.0";
}

export function getMetaAppId(): string | null {
  return getStoredMetaAppId();
}

export function getMetaAppSecret(): string | null {
  return getMetaOAuthAppSecret();
}

/** El nombre es solo informativo para que el operador distinga sus Apps. */
export async function fetchMetaAppName(): Promise<string | null> {
  const appId = getMetaAppId();
  const appSecret = getMetaAppSecret();
  if (!appId || !appSecret) return null;

  // RECORDADO MEDIA HORA (21/10/2026): el nombre de la app se pedía en cada apertura de Meta
  // Connect y en cada paso del asistente. No cambia; si cambia la app, cambia la clave.
  return recordar(`app-nombre:${appId}`, MEDIA_HORA, async () => {
    const url = new URL(`https://graph.facebook.com/${graphVersion()}/${appId}`);
    url.searchParams.set("fields", "name");
    url.searchParams.set("access_token", `${appId}|${appSecret}`);
    try {
      const res = await fetch(url, { cache: "no-store" });
      const body = (await res.json()) as { name?: string };
      return res.ok && body.name ? body.name : null;
    } catch {
      return null;
    }
  });
}

function isLocalOrigin(value: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?/i.test(value);
}

export function getPublicOrigin(req: Request): string {
  const configured =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.APP_URL ??
    process.env.PUBLIC_APP_URL;
  if (configured && !isLocalOrigin(configured)) {
    return configured.replace(/\/+$/, "");
  }

  const forwardedHost = req.headers.get("x-forwarded-host");
  const forwardedProto = req.headers.get("x-forwarded-proto") ?? "https";
  if (forwardedHost && !forwardedHost.startsWith("localhost")) {
    return `${forwardedProto}://${forwardedHost}`;
  }

  const host = req.headers.get("host");
  if (host && !host.startsWith("localhost")) return `https://${host}`;

  const referer = req.headers.get("referer");
  if (referer && !isLocalOrigin(referer)) return new URL(referer).origin;

  const origin = req.headers.get("origin");
  if (origin && !isLocalOrigin(origin)) return origin.replace(/\/+$/, "");

  return new URL(req.url).origin;
}

export function newOAuthState(): string {
  return crypto.randomBytes(24).toString("hex");
}

export function buildMetaLoginUrl(
  redirectUri: string,
  state: string,
  includeInstagram = false
): string {
  const appId = getMetaAppId();
  if (!appId) throw new Error("META_APP_ID no configurado");

  const url = new URL(`https://www.facebook.com/${graphVersion()}/dialog/oauth`);
  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set(
    "scope",
    [...CORE_SCOPES, ...(includeInstagram ? INSTAGRAM_SCOPES : [])].join(",")
  );
  url.searchParams.set("response_type", "code");
  return url.toString();
}

export async function exchangeCodeForUserToken(
  code: string,
  redirectUri: string
): Promise<string> {
  const appId = getMetaAppId();
  const appSecret = getMetaAppSecret();
  if (!appId) throw new Error("META_APP_ID no configurado");
  if (!appSecret) throw new Error("META_APP_SECRET no configurado");

  const shortUrl = new URL(
    `https://graph.facebook.com/${graphVersion()}/oauth/access_token`
  );
  shortUrl.searchParams.set("client_id", appId);
  shortUrl.searchParams.set("client_secret", appSecret);
  shortUrl.searchParams.set("redirect_uri", redirectUri);
  shortUrl.searchParams.set("code", code);

  const shortRes = await fetch(shortUrl, { cache: "no-store" });
  const shortBody = (await shortRes.json()) as TokenResponse;
  if (!shortRes.ok || !shortBody.access_token) {
    throw new Error(
      shortBody.error?.message ?? "Meta no devolvio access_token inicial"
    );
  }

  const longUrl = new URL(
    `https://graph.facebook.com/${graphVersion()}/oauth/access_token`
  );
  longUrl.searchParams.set("grant_type", "fb_exchange_token");
  longUrl.searchParams.set("client_id", appId);
  longUrl.searchParams.set("client_secret", appSecret);
  longUrl.searchParams.set("fb_exchange_token", shortBody.access_token);

  const longRes = await fetch(longUrl, { cache: "no-store" });
  const longBody = (await longRes.json()) as TokenResponse;
  if (!longRes.ok || !longBody.access_token) {
    throw new Error(
      longBody.error?.message ?? "Meta no devolvio access_token largo"
    );
  }
  return longBody.access_token;
}

export async function fetchConnectedPages(
  userAccessToken: string,
  includeInstagram = false
): Promise<MetaConnectPage[]> {
  const url = new URL(`https://graph.facebook.com/${graphVersion()}/me/accounts`);
  url.searchParams.set(
    "fields",
    includeInstagram
      ? "id,name,picture{url},access_token,instagram_business_account{id,username,name}"
      : "id,name,picture{url},access_token"
  );
  url.searchParams.set("access_token", userAccessToken);

  const res = await fetch(url, { cache: "no-store" });
  const body = (await res.json()) as AccountsResponse;
  if (!res.ok) {
    throw new Error(body.error?.message ?? "No se pudieron leer las paginas");
  }

  return (body.data ?? [])
    .filter((page) => page.id && page.name && page.access_token)
    .map((page) => ({
      pageId: page.id,
      pageName: page.name,
      pageAccessToken: page.access_token,
      instagramBusinessAccountId: page.instagram_business_account?.id ?? null,
      instagramUsername:
        page.instagram_business_account?.username ??
        page.instagram_business_account?.name ??
        null,
      pagePictureUrl: page.picture?.data?.url ?? null,
    }));
}

interface MetaApiError {
  error?: {
    message?: string;
    code?: number;
    error_subcode?: number;
    type?: string;
  };
}

export interface PageSubscriptionResult {
  ok: boolean;
  fields: string[];
  status: number;
  message: string;
}

/**
 * Resultado de suscribir la página a los comentarios.
 *
 * `estado` separa tres cosas que NO son lo mismo: que `feed` quedara activo,
 * que no quedara, y que no se pudiera comprobar. Afirmar cualquiera de las dos
 * primeras sin haberlo leído sería inventar.
 */
export interface CommentSubscriptionResult {
  ok: boolean;
  estado: "activo" | "no_activo" | "sin_comprobar";
  detail: string;
}

export interface DetectedMetaEnv {
  values: Record<string, string>;
  notes: string[];
}

export interface MetaWhatsAppOption {
  wabaId: string;
  wabaName: string | null;
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  profilePictureUrl: string | null;
  /** El negocio DUEÑO de la cuenta de WhatsApp. null = Meta no lo dijo. */
  businessId: string | null;
  businessName: string | null;
  /** Las cuentas que pueden usarlo: la dueña y las que lo tienen compartido. */
  accesoDe: CuentaDeMeta[];
}

/** Una cuenta de Meta: el negocio dueño de un número, una página o un píxel. */
export interface CuentaDeMeta {
  id: string;
  nombre: string | null;
}

/**
 * QUIÉN ENTRÓ: el nombre de la cuenta de Facebook de este login.
 *
 * Lo pidió el dueño el 10/10/2026: en el selector «no hay un indicador o separador que me
 * diga de qué bm ni cuenta es ese activo». Con varias cuentas anexadas (Claudio, Alberto…)
 * hace falta saber de cuál viene cada negocio. Nunca lanza: null = no se supo.
 */
export async function fetchCuentaDeFacebook(
  userAccessToken: string
): Promise<CuentaDeMeta | null> {
  try {
    const cuerpo = await graphGet<{ id?: string; name?: string }>("me", userAccessToken, {
      fields: "id,name",
    });
    return cuerpo?.id ? { id: cuerpo.id, nombre: cuerpo.name ?? null } : null;
  } catch {
    return null;
  }
}

/**
 * LOS NEGOCIOS QUE VE ESTE LOGIN. A cada uno se le guarda el permiso del login, para que
 * sus tiendas midan con el suyo. Nunca lanza: lista vacía = no se supo.
 */
export async function fetchBusinesses(userAccessToken: string): Promise<CuentaDeMeta[]> {
  try {
    const cuerpo = await graphGet<MetaBusinessResponse>("me/businesses", userAccessToken, {
      fields: "id,name",
    });
    return (cuerpo?.data ?? [])
      .filter((b) => typeof b.id === "string" && b.id)
      .map((b) => ({ id: b.id, nombre: b.name ?? null }));
  } catch {
    return [];
  }
}

/**
 * DE QUÉ CUENTA ES ESTA CUENTA DE WHATSAPP.
 *
 * Lo pidió el dueño el 09/10/2026 para trabajar con varias cuentas de Facebook sin
 * mezclarlas. Ver PLAN-VARIAS-CUENTAS-DE-FACEBOOK.md.
 *
 * ES UNA CONSULTA APARTE, A PROPÓSITO. Meter el campo en la petición que lista los
 * números habría sido más corto, pero si Meta rechaza ese campo la lista ENTERA vuelve
 * vacía y él se queda sin números. Así, lo peor que pasa es «cuenta sin identificar».
 *
 * Nunca lanza: null = no se supo.
 */
export async function cuentaDeLaWaba(
  wabaId: string,
  accessToken: string
): Promise<CuentaDeMeta | null> {
  try {
    const cuerpo = await graphGet<{ owner_business_info?: { id?: string; name?: string } }>(
      wabaId,
      accessToken,
      { fields: "owner_business_info" }
    );
    const dueño = cuerpo?.owner_business_info;
    return dueño?.id ? { id: dueño.id, nombre: dueño.name ?? null } : null;
  } catch {
    return null;
  }
}

/**
 * DE QUÉ CUENTA ES ESTA PÁGINA. El gemelo del de arriba, con las mismas reglas: consulta
 * aparte, nunca lanza. Una página que no cuelga de ningún negocio —una página suelta de
 * una persona— devuelve null, y eso es un dato, no un fallo.
 */
export async function cuentaDeLaPagina(
  pageId: string,
  accessToken: string
): Promise<CuentaDeMeta | null> {
  try {
    const cuerpo = await graphGet<{ business?: { id?: string; name?: string } }>(
      pageId,
      accessToken,
      { fields: "business{id,name}" }
    );
    const dueño = cuerpo?.business;
    return dueño?.id ? { id: dueño.id, nombre: dueño.name ?? null } : null;
  } catch {
    return null;
  }
}

function isMetaTestWhatsAppAsset(waba: MetaWaba, phone: MetaPhoneNumber): boolean {
  const wabaName = waba.name?.trim().toLowerCase() ?? "";
  const verifiedName = phone.verified_name?.trim().toLowerCase() ?? "";
  return (
    wabaName === "test whatsapp business account" ||
    verifiedName === "test number" ||
    verifiedName === "test whatsapp business account"
  );
}

/**
 * LA MISMA PREGUNTA, UNA SOLA VEZ POR INICIO DE SESIÓN (21/10/2026). Al volver de Facebook se
 * preguntaba «¿qué BM tengo?» 4 veces y toda la lista de números 2 veces (unas 150 consultas con
 * 10 BM); Meta frenó la app («#4»). Dentro de `conMemoriaDeMeta`, cada pregunta igual se hace una
 * vez y las demás reciben la misma respuesta. Fuera de ella, todo como siempre.
 */
const memoriaDelLogin = new AsyncLocalStorage<Map<string, Promise<unknown>>>();
export function conMemoriaDeMeta<T>(fn: () => Promise<T>): Promise<T> {
  return memoriaDelLogin.run(new Map(), fn);
}

async function graphGet<T>(
  path: string,
  accessToken: string,
  params: Record<string, string> = {}
): Promise<T | null> {
  const url = new URL(`https://graph.facebook.com/${graphVersion()}/${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("access_token", accessToken);

  const preguntar = async (): Promise<T | null> => {
    try {
      // Con el freno de seguridad: si Meta está cerca del límite, no se pregunta (null).
      const res = await fetchMeta(url);
      const body = (await res.json()) as T & { error?: { message?: string } };
      if (!res.ok) return null;
      return body;
    } catch {
      return null;
    }
  };
  const memoria = memoriaDelLogin.getStore();
  if (!memoria) return preguntar();
  const clave = url.toString();
  if (!memoria.has(clave)) memoria.set(clave, preguntar());
  return memoria.get(clave) as Promise<T | null>;
}

export interface MetaPixelOption {
  pixelId: string;
  name: string | null;
  /** El negocio DUEÑO del pixel, no aquel por el que se llegó a él. */
  businessId: string;
  businessName: string | null;
  /** true = se llegó a él a través de otro negocio, no del dueño. */
  compartido: boolean;
  /**
   * LAS CUENTAS QUE PUEDEN USARLO: la dueña y aquellas con las que está compartido.
   *
   * Lo pidió el dueño el 10/10/2026: «que yo pueda elegir activos de una misma cuenta, y
   * si están compartidos también». Mirando solo al dueño, un píxel que BM Basura 2 le
   * comparte a Aula Virtual Pro se marcaba como mezcla y no se ofrecía en su tienda,
   * aunque Meta lo acepta. Opcional: las listas guardadas antes no lo traen.
   */
  accesoDe?: CuentaDeMeta[];
}

/** Añade una cuenta a la lista de acceso sin repetirla. */
function sumarAcceso(lista: CuentaDeMeta[], cuenta: CuentaDeMeta): void {
  if (!cuenta.id || lista.some((c) => c.id === cuenta.id)) return;
  lista.push(cuenta);
}

/**
 * Todos los pixels a los que llega este login.
 *
 * Se piden los PROPIOS y los COMPARTIDOS, igual que ya se hace con los WABAs.
 * Mirando solo los propios, un pixel que otro negocio te comparte no aparecería
 * — y es un caso normal cuando alguien administra la cuenta de un tercero.
 */
export async function fetchPixelOptions(
  userAccessToken: string
): Promise<MetaPixelOption[]> {
  const businesses = await graphGet<MetaBusinessResponse>(
    "me/businesses",
    userAccessToken,
    { fields: "id,name" }
  );
  const options: MetaPixelOption[] = [];
  const vistos = new Set<string>();

  // Se pide también el DUEÑO de cada pixel. Sin eso, el pixel quedaba
  // etiquetado con el negocio por el que se llegó a él — que puede ser un
  // tercero al que se lo compartieron — y en pantalla parecía que le pertenecía.
  type PixelDeMeta = {
    id?: string;
    name?: string;
    owner_business?: { id?: string; name?: string };
  };

  for (const business of businesses?.data ?? []) {
    const respuestas = await Promise.all([
      graphGet<{ data?: PixelDeMeta[] }>(
        `${business.id}/owned_pixels`,
        userAccessToken,
        { fields: "id,name,owner_business{id,name}" }
      ),
      graphGet<{ data?: PixelDeMeta[] }>(
        `${business.id}/client_pixels`,
        userAccessToken,
        { fields: "id,name,owner_business{id,name}" }
      ),
    ]);
    respuestas.forEach((respuesta, indice) => {
      for (const pixel of respuesta?.data ?? []) {
        if (typeof pixel.id !== "string") continue;
        // YA VISTO POR OTRO NEGOCIO: no se repite, pero este negocio también puede
        // usarlo — es exactamente lo que significa «compartido».
        if (vistos.has(pixel.id)) {
          const yaEsta = options.find((o) => o.pixelId === pixel.id);
          if (yaEsta?.accesoDe) {
            sumarAcceso(yaEsta.accesoDe, { id: business.id, nombre: business.name ?? null });
          }
          continue;
        }
        vistos.add(pixel.id);
        const dueño = pixel.owner_business;
        const accesoDe: CuentaDeMeta[] = [];
        if (dueño?.id) sumarAcceso(accesoDe, { id: dueño.id, nombre: dueño.name ?? null });
        sumarAcceso(accesoDe, { id: business.id, nombre: business.name ?? null });
        options.push({
          accesoDe,
          pixelId: pixel.id,
          name: typeof pixel.name === "string" ? pixel.name : null,
          // Si Meta no da el dueño, se cae al negocio por el que se encontró:
          // es peor dato, pero mejor que dejarlo sin nada.
          businessId: dueño?.id ?? business.id,
          businessName: dueño?.name ?? business.name ?? null,
          // Compartido = el dueño no es el negocio por el que llegamos. Si no
          // sabemos el dueño, vale el borde por el que vino.
          compartido: dueño?.id ? dueño.id !== business.id : indice === 1,
        });
      }
    });
  }
  return options;
}

export async function fetchWhatsAppOptions(
  userAccessToken: string
): Promise<MetaWhatsAppOption[]> {
  const businesses = await graphGet<MetaBusinessResponse>(
    "me/businesses",
    userAccessToken,
    { fields: "id,name" }
  );
  const options: MetaWhatsAppOption[] = [];
  const seen = new Set<string>();

  for (const business of businesses?.data ?? []) {
    const responses = await Promise.all([
      graphGet<MetaWabaResponse>(
        `${business.id}/owned_whatsapp_business_accounts`,
        userAccessToken,
        { fields: "id,name,phone_numbers{id,display_phone_number,verified_name,code_verification_status}" }
      ),
      graphGet<MetaWabaResponse>(
        `${business.id}/client_whatsapp_business_accounts`,
        userAccessToken,
        { fields: "id,name,phone_numbers{id,display_phone_number,verified_name,code_verification_status}" }
      ),
    ]);
    // De quién es cada cuenta de WhatsApp. Las PROPIAS son de este negocio, sin
    // preguntar nada. Las de CLIENTE son de otro, y a ésas se les pregunta el dueño:
    // atribuírselas al negocio por el que se llegó sería decir que son suyas.
    const conSuDueño: Array<{ waba: MetaWaba; propia: boolean }> = responses.flatMap(
      (response, indice) =>
        (response?.data ?? []).map((waba) => ({ waba, propia: indice === 0 }))
    );
    for (const { waba, propia } of conSuDueño) {
      const dueño: CuentaDeMeta | null = propia
        ? { id: business.id, nombre: business.name ?? null }
        : await cuentaDeLaWaba(waba.id, userAccessToken);
      for (const phone of waba.phone_numbers?.data ?? []) {
        if (!phone.id) continue;
        // YA VISTO POR OTRO NEGOCIO: este también puede usarlo (compartido).
        if (seen.has(phone.id)) {
          const yaEsta = options.find((o) => o.phoneNumberId === phone.id);
          if (yaEsta) {
            sumarAcceso(yaEsta.accesoDe, { id: business.id, nombre: business.name ?? null });
          }
          continue;
        }
        if (isMetaTestWhatsAppAsset(waba, phone)) continue;
        seen.add(phone.id);
        const accesoDe: CuentaDeMeta[] = [];
        if (dueño) sumarAcceso(accesoDe, dueño);
        sumarAcceso(accesoDe, { id: business.id, nombre: business.name ?? null });
        // LA FOTO, SOLO SI NO LA TENEMOS (21/10/2026): una consulta por número en cada inicio de
        // sesión. Sin pedirla, se guarda null y la base CONSERVA la que ya tenía (COALESCE).
        const yaTieneFoto = !!getMetaWhatsAppConnection(phone.id)?.profile_picture_url;
        const profile = yaTieneFoto
          ? null
          : await graphGet<{
              profile_picture_url?: string | null;
              data?: Array<{ profile_picture_url?: string | null }>;
            }>(`${phone.id}/whatsapp_business_profile`, userAccessToken, { fields: "profile_picture_url" });
        options.push({
          wabaId: waba.id,
          wabaName: waba.name ?? null,
          phoneNumberId: phone.id,
          displayPhoneNumber: phone.display_phone_number ?? null,
          verifiedName: phone.verified_name ?? null,
          profilePictureUrl:
            profile?.profile_picture_url ??
            profile?.data?.[0]?.profile_picture_url ??
            null,
          businessId: dueño?.id ?? null,
          businessName: dueño?.nombre ?? null,
          accesoDe,
        });
      }
    }
  }
  return options;
}

/**
 * QUÉ CUENTAS PUEDEN USAR CADA PÁGINA: la dueña y aquellas con las que está compartida.
 *
 * Las páginas se listan por el usuario (`me/accounts`), que no dice nada de negocios. Por
 * eso se pregunta aparte a cada negocio por sus páginas propias y las de cliente.
 *
 * Nunca lanza: un negocio que no conteste simplemente no suma acceso.
 */
export async function accesoDeLasPaginas(
  userAccessToken: string,
  negocios: CuentaDeMeta[],
  /** Si se pasa, se llena con el DUEÑO de cada página (la que la tiene en «owned_pages»):
   *  así no hay que preguntarlo página por página (21/10/2026). */
  duenos?: Map<string, CuentaDeMeta>
): Promise<Map<string, CuentaDeMeta[]>> {
  const acceso = new Map<string, CuentaDeMeta[]>();
  for (const negocio of negocios) {
    for (const borde of ["owned_pages", "client_pages"]) {
      try {
        const cuerpo = await graphGet<{ data?: Array<{ id?: string }> }>(
          `${negocio.id}/${borde}`,
          userAccessToken,
          { fields: "id", limit: "200" }
        );
        for (const pagina of cuerpo?.data ?? []) {
          if (!pagina.id) continue;
          const lista = acceso.get(pagina.id) ?? [];
          sumarAcceso(lista, negocio);
          acceso.set(pagina.id, lista);
          if (borde === "owned_pages" && duenos && !duenos.has(pagina.id)) duenos.set(pagina.id, negocio);
        }
      } catch {
        // Sin respuesta de este negocio: no suma acceso, y nada más.
      }
    }
  }
  return acceso;
}

export async function detectMetaEnvFromUserToken(
  userAccessToken: string,
  pages: MetaConnectPage[]
): Promise<DetectedMetaEnv> {
  const values: Record<string, string> = {};
  const notes: string[] = [];
  const firstPage = pages[0];

  if (firstPage) {
    values.META_PAGE_ID = firstPage.pageId;
    values.MESSENGER_PAGE_ID = firstPage.pageId;
    values.MESSENGER_PAGE_ACCESS_TOKEN = firstPage.pageAccessToken;
    values.INSTAGRAM_PAGE_ID = firstPage.pageId;
    values.INSTAGRAM_PAGE_ACCESS_TOKEN = firstPage.pageAccessToken;
    if (firstPage.instagramBusinessAccountId) {
      values.INSTAGRAM_BUSINESS_ACCOUNT_ID =
        firstPage.instagramBusinessAccountId;
      values.META_IG_ACCOUNT_ID = firstPage.instagramBusinessAccountId;
    }
  }

  const whatsAppOptions = await fetchWhatsAppOptions(userAccessToken);
  if (!whatsAppOptions.length) {
    notes.push("No pude listar cuentas o numeros de WhatsApp con este login.");
  } else {
    const firstOption = whatsAppOptions[0];
    values.META_WABA_ID = firstOption.wabaId;
    values.META_PHONE_NUMBER_ID = firstOption.phoneNumberId;
  }

  const businesses = await graphGet<MetaBusinessResponse>(
    "me/businesses",
    userAccessToken,
    { fields: "id,name" }
  );
  for (const business of businesses?.data ?? []) {
    // Los mismos campos que `fetchPixelOptions`: dentro de un inicio de sesión es la MISMA
    // pregunta y no se repite. Aquí solo se usa el id.
    const pixels = await graphGet<MetaPixelResponse>(
      `${business.id}/owned_pixels`,
      userAccessToken,
      { fields: "id,name,owner_business{id,name}" }
    );
    const pixel = pixels?.data?.[0];
    if (pixel && !values.META_PIXEL_ID) {
      values.META_PIXEL_ID = pixel.id;
      values.META_CAPI_PIXEL_ID = pixel.id;
    }
  }

  if (!values.META_WABA_ID || !values.META_PHONE_NUMBER_ID) {
    notes.push("No pude detectar WhatsApp WABA/número con este login.");
  }
  if (!values.META_PIXEL_ID) {
    notes.push("No pude detectar pixel/dataset con este login.");
  }

  return { values, notes };
}

const SUBSCRIPTION_FIELD_SETS = [
  ["messages", "messaging_postbacks", "messaging_referrals"],
  ["messages", "messaging_postbacks", "messaging_referral"],
  ["messages"],
];

/**
 * Suscribe la página al campo `feed`, que es por donde llegan los comentarios.
 *
 * Va en una llamada APARTE, siempre después de la de mensajería y sin poder
 * afectarla: si Meta la rechaza (permisos, versión, lo que sea) se anota en el
 * log y no se propaga el error. Messenger nunca se queda sin suscripción por
 * culpa de esto.
 *
 * Y por si acaso: la petición REPITE los campos de mensajería junto a `feed`.
 * La documentación dice que suscribirse suma campos en vez de reemplazarlos,
 * pero no lo garantiza para páginas. Mandándolos todos juntos da igual cuál de
 * los dos comportamientos aplique — los mensajes siguen suscritos.
 */
export async function subscribePageToCommentWebhooks(input: {
  pageId: string;
  pageAccessToken: string;
  /**
   * Campos que la página tenía ANTES de tocar nada. Se leen al principio del
   * flujo, antes incluso de la suscripción de mensajería, porque esa también
   * reemplaza. Se envían junto a los nuestros para no quitarle nada al usuario.
   */
  preservarCampos?: string[];
}): Promise<CommentSubscriptionResult> {
  try {
    // Facebook REEMPLAZA la lista de campos por la que se le manda: no suma.
    // Por eso se envía la union de lo que ya habia con lo que necesitamos, y
    // nunca solo lo nuestro. Si no se pudo leer lo anterior, se manda lo mínimo.
    const requeridos = [
      "messages",
      "messaging_postbacks",
      "messaging_referrals",
      "feed",
    ];
    const previos =
      input.preservarCampos ?? (await camposSuscritosDeLaPagina(input)) ?? [];
    const union = [...new Set([...previos, ...requeridos])];
    const url = new URL(
      `https://graph.facebook.com/${graphVersion()}/${input.pageId}/subscribed_apps`
    );
    url.searchParams.set("access_token", input.pageAccessToken);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscribed_fields: union }),
      cache: "no-store",
    });
    const text = await res.text();
    if (!res.ok) {
      console.warn(`[comentarios] no pude suscribir la pagina al feed: ${text}`);
      return { ok: false, estado: "no_activo", detail: text };
    }
    // COMPROBACION REAL: que Facebook acepte el POST no significa que `feed`
    // haya quedado. Si el campo esta apagado en el panel de webhooks de la app,
    // responde que si y luego no lo aplica. Por eso se LEE de vuelta y se
    // informa lo que hay de verdad, no lo que se pidio.
    const campos = await camposSuscritosDeLaPagina(input);
    if (campos === null) {
      // Ni se afirma que quedo ni que no: no se pudo mirar. Decir cualquiera de
      // las dos cosas seria inventar, y mandaria a buscar un problema que
      // quiza no existe.
      return {
        ok: false,
        estado: "sin_comprobar",
        detail:
          "Facebook acepto la peticion, pero no se pudo leer que quedo. Comprueba a mano el campo feed en Webhooks > Pagina.",
      };
    }
    if (!campos.includes("feed")) {
      console.warn(
        `[comentarios] la pagina NO quedo suscrita a feed. Campos reales: ${campos.join(", ") || "(ninguno)"}`
      );
      return {
        ok: false,
        estado: "no_activo",
        detail: `Campos reales de la pagina: ${campos.join(", ") || "(ninguno)"}. Falta marcar "feed" en Webhooks > Pagina, en el panel de tu app de Meta.`,
      };
    }
    return { ok: true, estado: "activo", detail: campos.join(", ") };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.warn(`[comentarios] error suscribiendo al feed: ${detail}`);
    return { ok: false, estado: "sin_comprobar", detail };
  }
}

/**
 * Campos a los que la pagina esta suscrita REALMENTE, leidos de Facebook.
 * Devuelve null si no se pudo consultar (ahi no se afirma nada).
 */
export async function camposSuscritosDeLaPagina(input: {
  pageId: string;
  pageAccessToken: string;
}): Promise<string[] | null> {
  try {
    const url = new URL(
      `https://graph.facebook.com/${graphVersion()}/${input.pageId}/subscribed_apps`
    );
    url.searchParams.set("access_token", input.pageAccessToken);
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      data?: Array<{ subscribed_fields?: string[] }>;
    };
    const campos = new Set<string>();
    for (const app of data.data ?? []) {
      for (const campo of app.subscribed_fields ?? []) campos.add(campo);
    }
    return [...campos];
  } catch {
    return null;
  }
}

export async function subscribePageToMessagingWebhooks(input: {
  pageId: string;
  pageAccessToken: string;
}): Promise<PageSubscriptionResult> {
  let lastResult: PageSubscriptionResult | null = null;

  for (const fields of SUBSCRIPTION_FIELD_SETS) {
    const url = new URL(
      `https://graph.facebook.com/${graphVersion()}/${input.pageId}/subscribed_apps`
    );
    url.searchParams.set("access_token", input.pageAccessToken);

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscribed_fields: fields }),
      cache: "no-store",
    });
    const text = await res.text();

    if (res.ok) {
      return {
        ok: true,
        fields,
        status: res.status,
        message: "Pagina suscrita correctamente a webhooks de mensajes.",
      };
    }

    let parsed: MetaApiError | null = null;
    try {
      parsed = JSON.parse(text) as MetaApiError;
    } catch {
      parsed = null;
    }
    lastResult = {
      ok: false,
      fields,
      status: res.status,
      message:
        parsed?.error?.message ??
        text.slice(0, 400) ??
        "Meta rechazo la suscripcion.",
    };
  }

  return (
    lastResult ?? {
      ok: false,
      fields: [],
      status: 0,
      message: "No se pudo intentar la suscripcion.",
    }
  );
}

/**
 * ¿ESTA CUENTA DE WHATSAPP YA LE MANDA SUS MENSAJES A NUESTRA APP?
 *
 * Lo pidió el dueño el 10/10/2026: ver al lado de cada número si está «✓ Suscrito» o
 * hay que pulsar «Suscribir». Se lee de Meta (`subscribed_apps`) y se compara con el id
 * de la app de la sección 1, que es la que tiene el webhook del bot.
 *
 * SOLO LEE. Nunca lanza: null = no se pudo saber, y la pantalla lo dice así en vez de
 * inventarse un estado.
 */
export async function estaSuscritaAEstaApp(input: {
  wabaId: string;
  accessToken: string;
}): Promise<boolean | null> {
  const nuestraApp = getMetaAppId();
  if (!nuestraApp) return null;
  try {
    const cuerpo = await graphGet<{
      data?: Array<{ whatsapp_business_api_data?: { id?: string }; id?: string }>;
    }>(`${input.wabaId}/subscribed_apps`, input.accessToken);
    if (!cuerpo) return null;
    return (cuerpo.data ?? []).some(
      (app) => (app.whatsapp_business_api_data?.id ?? app.id) === nuestraApp
    );
  } catch {
    return null;
  }
}

export async function subscribeWhatsAppToWebhooks(input: {
  wabaId: string;
  accessToken: string;
}): Promise<PageSubscriptionResult> {
  const url = new URL(
    `https://graph.facebook.com/${graphVersion()}/${input.wabaId}/subscribed_apps`
  );
  url.searchParams.set("access_token", input.accessToken);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
  });
  const text = await res.text();
  if (res.ok) {
    return {
      ok: true,
      fields: ["messages"],
      status: res.status,
      message: "WhatsApp quedo suscrito a los webhooks de esta app.",
    };
  }
  let parsed: MetaApiError | null = null;
  try {
    parsed = JSON.parse(text) as MetaApiError;
  } catch {
    parsed = null;
  }
  return {
    ok: false,
    fields: ["messages"],
    status: res.status,
    message: parsed?.error?.message ?? text.slice(0, 400) ?? "Meta rechazo la suscripcion de WhatsApp.",
  };
}
