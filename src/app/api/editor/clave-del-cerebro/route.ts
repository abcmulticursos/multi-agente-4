import { NextResponse, type NextRequest } from "next/server";
import { checkPassword, isAuthConfigured } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * LA CONTRASEÑA PARA CAMBIAR EL CEREBRO.
 *
 * LO PIDIÓ EL DUEÑO el 10/10/2026: «en cerebro ponerle contraseña, la contraseña tiene
 * que ser la misma que se usa para entrar al editor… cuando se va a cambiar algo del
 * cerebro hay que poner contraseña». Es un seguro contra cambios por descuido: el
 * Cerebro es lo que más cambia cómo responde el bot.
 *
 * SOLO COMPRUEBA. No guarda nada ni abre ninguna sesión: el editor se desbloquea en
 * pantalla hasta que se recarga. Y la contraseña no viaja al navegador, solo la respuesta.
 *
 * Si el panel no tiene contraseña configurada, no hay nada que comprobar: se dice así
 * (`sinClave`) y el editor deja cambiar el Cerebro como antes, con un aviso.
 */

// UN FRENO CONTRA PROBAR CONTRASEÑAS A LO LOCO: 10 intentos fallidos cada 5 minutos.
const VENTANA_MS = 5 * 60 * 1000;
const MAX_FALLOS = 10;
let fallos: number[] = [];

export async function POST(req: NextRequest) {
  if (!isAuthConfigured()) {
    return NextResponse.json({ ok: true, sinClave: true });
  }
  const ahora = Date.now();
  fallos = fallos.filter((t) => ahora - t < VENTANA_MS);
  if (fallos.length >= MAX_FALLOS) {
    return NextResponse.json(
      { ok: false, error: "Demasiados intentos. Espera unos minutos y vuelve a probar." },
      { status: 429 }
    );
  }
  const cuerpo = (await req.json().catch(() => null)) as { clave?: unknown } | null;
  const clave = typeof cuerpo?.clave === "string" ? cuerpo.clave.trim() : "";
  if (clave && checkPassword(clave)) {
    return NextResponse.json({ ok: true });
  }
  fallos.push(ahora);
  return NextResponse.json({ ok: false, error: "Esa no es la contraseña del editor." });
}
