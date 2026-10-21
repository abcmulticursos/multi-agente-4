import { NextResponse, type NextRequest } from "next/server";
import { unblockNumber } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface Ctx {
  params: Promise<{ phone: string }>;
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { phone: phoneRaw } = await params;
  const phone = (phoneRaw ?? "").replace(/\D/g, "");
  if (!phone) {
    return NextResponse.json({ error: "Número inválido" }, { status: 400 });
  }
  const ok = unblockNumber(phone);
  if (!ok) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
