import { NextResponse, type NextRequest } from "next/server";
import { blockNumber, listBlockedNumbers } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(
    { blocked: listBlockedNumbers() },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(req: NextRequest) {
  let body: { phone?: string; reason?: string };
  try {
    body = (await req.json()) as { phone?: string; reason?: string };
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  // Normalizamos a solo dígitos — así matchea el `from` del webhook de Meta.
  const phone = (body.phone ?? "").replace(/\D/g, "");
  if (!phone) {
    return NextResponse.json(
      { error: "Número inválido" },
      { status: 400 }
    );
  }
  const reason = body.reason?.trim() || null;

  blockNumber(phone, reason);
  return NextResponse.json({ ok: true });
}
