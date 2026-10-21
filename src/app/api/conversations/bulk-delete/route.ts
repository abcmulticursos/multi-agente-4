import { NextResponse, type NextRequest } from "next/server";
import { deleteConversation, getConversationById } from "@/lib/db";
import { deleteLeadForConversation } from "@/lib/leads-sync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: { ids?: unknown };
  try {
    body = (await req.json()) as { ids?: unknown };
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  if (!Array.isArray(body.ids)) {
    return NextResponse.json(
      { error: "ids debe ser un array" },
      { status: 400 }
    );
  }

  const ids = body.ids
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n) && n > 0);

  if (ids.length === 0) {
    return NextResponse.json({ error: "sin ids válidos" }, { status: 400 });
  }

  let deleted = 0;
  for (const id of ids) {
    const convo = getConversationById(id);
    if (!convo) continue;
    // Cascade a NocoDB mientras la convo todavía existe localmente.
    await deleteLeadForConversation(id);
    deleteConversation(id);
    deleted++;
  }

  return NextResponse.json({ ok: true, deleted });
}
