import { NextResponse, type NextRequest } from "next/server";
import { olvidar } from "@/lib/meta/recuerdo";
import { anotarFalloDeMeta } from "@/lib/meta/registro";
import { procesarPermisoDeFacebook } from "@/lib/meta/procesar-permiso";
import {
  META_CONNECT_COOKIE,
  META_CONNECT_INSTAGRAM_COOKIE,
  META_CONNECT_NUEVA_COOKIE,
  conMemoriaDeMeta,
  exchangeCodeForUserToken,
  getPublicOrigin,
} from "@/lib/meta/connect";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/*
 * (13/11/2026) Lo que se hace con el permiso —leer páginas, negocios, números y píxeles, y guardarlos, con
 * `juntarAcceso`, `juntarPixeles` e `identificarLasCuentasQueFaltan`— se movió SIN CAMBIOS a
 * `src/lib/meta/procesar-permiso.ts`, para que «↻ Actualizar» lo haga igual con el permiso ya guardado.
 */

export async function GET(req: NextRequest) {
  // Un inicio de sesión nuevo puede traer otros BM y números: lo recordado deja de valer.
  olvidar();
  // Cada pregunta a Meta, UNA vez en todo el inicio de sesión (ver `conMemoriaDeMeta`).
  return conMemoriaDeMeta(() => iniciarSesion(req));
}

async function iniciarSesion(req: NextRequest) {
  const url = new URL(req.url);
  const publicOrigin = getPublicOrigin(req);
  const redirectToMetaConnect = (query: string) =>
    NextResponse.redirect(new URL(`/meta-connect?${query}`, publicOrigin));
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const metaError =
    url.searchParams.get("error_message") ??
    url.searchParams.get("error_description") ??
    url.searchParams.get("error_reason") ??
    url.searchParams.get("error");
  const metaErrorCode = url.searchParams.get("error_code");
  const cookieState = req.cookies.get(META_CONNECT_COOKIE)?.value;
  const includeInstagram =
    req.cookies.get(META_CONNECT_INSTAGRAM_COOKIE)?.value === "1";
  // «Conectar nueva cuenta»: entra otra cuenta y NO se toca nada de la de siempre —
  // ni su permiso, ni el número activo, ni sus píxeles. Ver PLAN-VARIAS-CUENTAS-DE-
  // FACEBOOK.md, apartado 5.
  const nuevaCuenta = req.cookies.get(META_CONNECT_NUEVA_COOKIE)?.value === "1";

  if (!code) {
    const detail = metaError
      ? `${metaErrorCode ? `${metaErrorCode}: ` : ""}${metaError}`
      : "Meta no devolvio codigo de autorizacion. Reintenta desde el boton Conectar con Meta.";
    // CANCELAR NO ES UN ERROR (21/10/2026): al pulsar «cancelar» o volver atrás en la ventana de
    // Facebook, Meta responde «200: Permissions error» / «user_denied», y salía en rojo como si el
    // CRM hubiera fallado. Se vuelve a Meta Connect sin aviso rojo; queda en el registro.
    const canceló =
      url.searchParams.get("error_reason") === "user_denied" ||
      url.searchParams.get("error") === "access_denied" ||
      (metaErrorCode === "200" && /permission/i.test(metaError ?? ""));
    anotarFalloDeMeta(canceló ? "Iniciar sesión con Facebook (canceló)" : "Iniciar sesión con Facebook", detail);
    if (canceló) return redirectToMetaConnect("cancelado=1");
    return redirectToMetaConnect(`error=${encodeURIComponent(detail)}`);
  }
  if (!state || !cookieState || state !== cookieState) {
    return redirectToMetaConnect("error=bad_state");
  }

  try {
    const redirectUri = `${publicOrigin}/api/meta/connect/callback`;
    const userToken = await exchangeCodeForUserToken(code, redirectUri);
    const { paginas } = await procesarPermisoDeFacebook(userToken, { nuevaCuenta, includeInstagram });
    const res = redirectToMetaConnect(`connected=${paginas}`);
    res.cookies.delete(META_CONNECT_COOKIE);
    res.cookies.delete(META_CONNECT_INSTAGRAM_COOKIE);
    res.cookies.delete(META_CONNECT_NUEVA_COOKIE);
    return res;
  } catch (err) {
    anotarFalloDeMeta("Iniciar sesión con Facebook", err instanceof Error ? err.message : String(err));
    const message = encodeURIComponent(
      err instanceof Error ? err.message : String(err)
    );
    return redirectToMetaConnect(`error=${message}`);
  }
}
