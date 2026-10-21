import { NextRequest, NextResponse } from "next/server";
import { getMetaAdsReaderActivo } from "@/lib/db";
import { graphVersion } from "@/lib/meta/connect";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const reader = getMetaAdsReaderActivo(Number(body?.readerId));
  const adId =
    typeof body?.adId === "string" ? body.adId.replace(/\D/g, "") : "";

  if (!reader || !adId) {
    return NextResponse.json(
      { error: "Cuenta o ID de anuncio invalido." },
      { status: 400 }
    );
  }

  const url = new URL(`https://graph.facebook.com/${graphVersion()}/${adId}`);
  url.searchParams.set("fields", "creative{effective_object_story_id}");
  url.searchParams.set("access_token", reader.token);

  const response = await fetch(url, { cache: "no-store" });
  const data = await response.json();
  if (!response.ok) {
    return NextResponse.json(
      { error: data?.error?.message ?? "Meta no pudo leer el anuncio." },
      { status: 400 }
    );
  }

  const storyId = data?.creative?.effective_object_story_id as string | undefined;
  if (!storyId || !storyId.includes("_")) {
    return NextResponse.json(
      { error: "Este anuncio no tiene un enlace publico de publicacion." },
      { status: 422 }
    );
  }

  const [pageId, postId] = storyId.split("_", 2);
  return NextResponse.json({
    url: `https://www.facebook.com/${pageId}/posts/${postId}`,
    storyId,
  });
}
