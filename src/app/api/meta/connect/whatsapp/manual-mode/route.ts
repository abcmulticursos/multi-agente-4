import { NextResponse, type NextRequest } from "next/server";
import { setMetaRuntimeSettings } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { enabled?: unknown } | null;
  if (typeof body?.enabled !== "boolean") {
    return NextResponse.json({ ok: false, error: "Valor invalido." }, { status: 400 });
  }
  if (
    body.enabled &&
    (!process.env.META_ACCESS_TOKEN?.trim() ||
      !process.env.META_PHONE_NUMBER_ID?.trim() ||
      !process.env.META_WABA_ID?.trim())
  ) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Completa META_ACCESS_TOKEN, META_PHONE_NUMBER_ID y META_WABA_ID en EasyPanel antes de activar el modo manual.",
      },
      { status: 400 }
    );
  }
  setMetaRuntimeSettings({
    use_env_whatsapp_credentials: body.enabled ? "true" : "false",
  });
  return NextResponse.json({ ok: true, enabled: body.enabled });
}
