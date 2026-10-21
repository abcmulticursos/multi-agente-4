import { NextResponse, type NextRequest } from "next/server";
import { backfillNextFollowups } from "@/lib/workflow/engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Endpoint one-shot para reparar seguimientos huerfanos. Recorre todas las
 * conversaciones cuyo seg N ya disparo pero seg N+1 nunca quedo agendado,
 * y les programa el siguiente seguimiento al proximo slot valido.
 *
 * Idempotente: llamarlo de nuevo no duplica nada.
 *
 * Proteccion: header `Authorization: Bearer ${CRON_SECRET}`.
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
    const result = backfillNextFollowups();
    return NextResponse.json({ ok: true, ...result, at: new Date().toISOString() });
  } catch (err) {
    console.error("[backfill] error:", err);
    return NextResponse.json(
      { ok: false, error: String(err) },
      { status: 500 }
    );
  }
}
