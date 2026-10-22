import { NextResponse, type NextRequest } from "next/server";
import { anotarFalloDeMeta } from "@/lib/meta/registro";
import {
  META_CONNECT_COOKIE,
  META_CONNECT_INSTAGRAM_COOKIE,
  META_CONNECT_NUEVA_COOKIE,
  buildMetaLoginUrl,
  getPublicOrigin,
  newOAuthState,
} from "@/lib/meta/connect";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const redirectUri = `${getPublicOrigin(req)}/api/meta/connect/callback`;
  const state = newOAuthState();
  const includeInstagram = new URL(req.url).searchParams.get("instagram") === "1";
  try {
    const loginUrl = buildMetaLoginUrl(redirectUri, state, includeInstagram);
    const res = NextResponse.redirect(loginUrl);
    res.cookies.set(META_CONNECT_COOKIE, state, {
      httpOnly: true,
      sameSite: "lax",
      secure: req.nextUrl.protocol === "https:",
      maxAge: 10 * 60,
      path: "/",
    });
    res.cookies.set(META_CONNECT_INSTAGRAM_COOKIE, includeInstagram ? "1" : "0", {
      httpOnly: true,
      sameSite: "lax",
      secure: req.nextUrl.protocol === "https:",
      maxAge: 10 * 60,
      path: "/",
    });
    // «Conectar nueva cuenta». Se marca aquí y lo lee la vuelta del login, que en ese
    // caso no toca nada de la cuenta de siempre. Sin la marca, todo como antes.
    const nuevaCuenta = new URL(req.url).searchParams.get("nueva") === "1";
    res.cookies.set(META_CONNECT_NUEVA_COOKIE, nuevaCuenta ? "1" : "0", {
      httpOnly: true,
      sameSite: "lax",
      secure: req.nextUrl.protocol === "https:",
      maxAge: 10 * 60,
      path: "/",
    });
    return res;
  } catch (err) {
    // DE VUELTA A META CONNECT, CON PALABRAS (21/10/2026): tras «Cerrar sesión de Meta», pulsar
    // «Conectar» mostraba una página en blanco con {"error":"META_APP_ID no configurado"}.
    const message = err instanceof Error ? err.message : String(err);
    anotarFalloDeMeta("Conectar con Facebook", message);
    const texto = /APP_ID|APP_SECRET/i.test(message)
      ? "Primero conecta tu app: Abrir asistente → 🔑 Mi app. Después inicia sesión con Facebook."
      : message;
    return NextResponse.redirect(new URL(`/meta-connect?error=${encodeURIComponent(texto)}`, getPublicOrigin(req)));
  }
}
