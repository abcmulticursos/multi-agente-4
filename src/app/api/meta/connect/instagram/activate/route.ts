import { NextResponse, type NextRequest } from "next/server";
import { activateInstagramMetaConnection } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { pageId?: string } | null;
  const pageId = body?.pageId?.trim();
  if (!pageId) {
    return NextResponse.json({ ok: false, error: "Pagina requerida." }, { status: 400 });
  }

  const connection = activateInstagramMetaConnection(pageId);
  if (!connection) {
    return NextResponse.json(
      { ok: false, error: "Esa pagina no tiene una cuenta profesional de Instagram detectada." },
      { status: 404 }
    );
  }

  return NextResponse.json({
    ok: true,
    pageId: connection.page_id,
    pageName: connection.page_name,
    instagramBusinessAccountId: connection.instagram_business_account_id,
    instagramUsername: connection.instagram_username,
  });
}
