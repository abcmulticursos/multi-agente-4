import { NextResponse, type NextRequest } from "next/server";
import { activateMetaWhatsAppConnection } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    phoneNumberId?: string;
  } | null;
  const phoneNumberId = body?.phoneNumberId?.trim();
  if (!phoneNumberId) {
    return NextResponse.json({ ok: false, error: "Numero requerido." }, { status: 400 });
  }
  const connection = activateMetaWhatsAppConnection(phoneNumberId);
  if (!connection) {
    return NextResponse.json(
      { ok: false, error: "Ese numero no pertenece a las conexiones detectadas." },
      { status: 404 }
    );
  }
  return NextResponse.json({
    ok: true,
    phoneNumberId: connection.phone_number_id,
    displayPhoneNumber: connection.display_phone_number,
  });
}

