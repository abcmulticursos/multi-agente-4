import { NextResponse, type NextRequest } from "next/server";
import {
  SESSION_COOKIE_NAME,
  isAuthConfigured,
  isValidSessionCookie,
} from "@/lib/auth";

// Rutas que NO requieren auth del dashboard:
// - /login y sus APIs (sino no podrías loguearte)
// - /api/webhook: Meta lo invoca, tiene su propia firma HMAC
// - /api/nocodb-webhook: NocoDB lo invoca, tiene su propio secret
// - /api/media: las imágenes/audios se cargan via <img>/<audio>, esos
//   tags no envían cookies en algunos casos. Las URLs ya son no-guessable
//   (id de mensaje en el path) y los archivos viven en disco local.
//   Si querés cerrar esto, lo charlamos aparte.
const PUBLIC_PATHS = new Set<string>([
  "/login",
  "/privacidad",
  "/api/login",
  "/api/logout",
  "/api/webhook",
  "/api/webhooks/messenger",
  "/api/webhooks/instagram",
  "/api/meta/connect/callback",
  "/api/nocodb-webhook",
  "/api/admin/test-capi",
]);

function isPublicMediaPath(pathname: string): boolean {
  return pathname.startsWith("/api/media/");
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.has(pathname) || isPublicMediaPath(pathname)) {
    return NextResponse.next();
  }

  // Si DASHBOARD_PASSWORD no está configurado, bloqueamos todo el
  // dashboard con un mensaje claro — fuerza al admin a setearlo. NO
  // hacemos fail-open porque eso dejaría el panel expuesto.
  if (!isAuthConfigured()) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        {
          error:
            "DASHBOARD_PASSWORD no configurado en el servidor. Setealo en .env.local y redeployá.",
        },
        { status: 503 }
      );
    }
    return new NextResponse(
      `<!doctype html><html><body style="font-family:sans-serif;padding:2rem;max-width:600px;margin:auto">
<h1>Dashboard no configurado</h1>
<p>Falta configurar la variable de entorno <code>DASHBOARD_PASSWORD</code>.</p>
<p>Agregala a tu <code>.env.local</code> (o al panel de tu deploy) y reiniciá la app.</p>
</body></html>`,
      { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }

  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const ok = await isValidSessionCookie(cookie);
  if (ok) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  }

  const loginUrl = new URL("/login", req.url);
  if (pathname && pathname !== "/" && pathname !== "/login") {
    loginUrl.searchParams.set("from", pathname);
  }
  return NextResponse.redirect(loginUrl);
}

// Aplica el proxy a todas las rutas EXCEPTO assets estáticos
// (Next los sirve solo y no necesitan auth).
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
