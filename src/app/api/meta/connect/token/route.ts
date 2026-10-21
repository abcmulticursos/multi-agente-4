import { NextRequest, NextResponse } from "next/server";
import { getMetaConnectionByPageId } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const pageId = new URL(req.url).searchParams.get("pageId")?.trim();
  if (!pageId) {
    return NextResponse.json({ error: "Pagina invalida." }, { status: 400 });
  }

  const connection = getMetaConnectionByPageId(pageId);
  if (!connection?.page_access_token) {
    return NextResponse.json({ error: "Token no encontrado." }, { status: 404 });
  }

  return NextResponse.json({
    pageId: connection.page_id,
    token: connection.page_access_token,
  });
}
