import { NextResponse, type NextRequest } from "next/server";
import {
  SESSION_COOKIE_MAX_AGE,
  SESSION_COOKIE_NAME,
  buildSessionCookieValue,
  checkPassword,
  isAuthConfigured,
} from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!isAuthConfigured()) {
    return NextResponse.json(
      {
        error:
          "DASHBOARD_PASSWORD no configurado en el servidor. Setealo en .env.local y redeployá.",
      },
      { status: 503 }
    );
  }

  let body: { password?: string };
  try {
    body = (await req.json()) as { password?: string };
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const password = body.password?.trim() ?? "";
  if (!password) {
    return NextResponse.json(
      { error: "Contraseña requerida" },
      { status: 400 }
    );
  }

  if (!checkPassword(password)) {
    // Pequeño delay para no facilitar brute-force por timing
    await new Promise((r) => setTimeout(r, 250));
    return NextResponse.json(
      { error: "Contraseña incorrecta" },
      { status: 401 }
    );
  }

  const value = await buildSessionCookieValue();
  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: SESSION_COOKIE_NAME,
    value,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_COOKIE_MAX_AGE,
    path: "/",
  });
  return res;
}
