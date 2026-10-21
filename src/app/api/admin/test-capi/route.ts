import { NextResponse, type NextRequest } from "next/server";
import { sendTestPurchaseEvent } from "@/lib/meta/conversions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function assertAuthorized(req: NextRequest): NextResponse | null {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET no configurado en el servidor" },
      { status: 500 }
    );
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }
  return null;
}

export async function POST(req: NextRequest) {
  const denied = assertAuthorized(req);
  if (denied) return denied;

  try {
    const body = (await req.json().catch(() => ({}))) as {
      value?: unknown;
      currency?: unknown;
    };
    const value =
      typeof body.value === "number" && Number.isFinite(body.value)
        ? body.value
        : 1;
    const currency =
      typeof body.currency === "string" && body.currency.trim()
        ? body.currency.trim().toUpperCase()
        : "PEN";

    const meta = await sendTestPurchaseEvent({ value, currency });
    return NextResponse.json({
      ok: true,
      event: "Purchase",
      value,
      currency,
      meta_status: meta.status,
      meta_response: meta.responseText,
      note: "Evento de prueba enviado a Meta CAPI. Revisa Events Manager -> Test Events.",
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Error enviando prueba CAPI",
      },
      { status: 500 }
    );
  }
}
