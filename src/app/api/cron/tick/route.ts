import { NextResponse, type NextRequest } from "next/server";
import { tick } from "@/lib/workflow/worker";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Endpoint que dispara un tick manual del worker. Pensado para ser
 * invocado por un cron externo (cron-job.org, UptimeRobot, etc.) cada
 * 1-5 minutos como salvaguarda: si EasyPanel pone el container a dormir
 * durante la noche, el setInterval del worker queda congelado y los
 * seguimientos no salen a su hora. Este endpoint reanima el proceso y
 * fuerza el procesamiento de acciones vencidas.
 *
 * Proteccion: header `Authorization: Bearer ${CRON_SECRET}`. El secreto
 * vive en variable de entorno — sin coincidencia, devuelve 401.
 */
export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET no configurado en el servidor" },
      { status: 500 }
    );
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  try {
    await tick();
  } catch (err) {
    console.error("[cron] tick fallo:", err);
    return NextResponse.json({ ok: false, error: "tick failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, at: new Date().toISOString() });
}
