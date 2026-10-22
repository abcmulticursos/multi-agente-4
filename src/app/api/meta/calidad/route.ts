import { NextResponse, type NextRequest } from "next/server";
import { getMetaWhatsAppConnection } from "@/lib/db";
import { graphVersion } from "@/lib/meta/connect";
import { fetchMeta } from "@/lib/meta/freno";
import { MEDIA_HORA, recordar } from "@/lib/meta/recuerdo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * LA CALIDAD DE CADA NÚMERO (22/10/2026): «falta el indicador de calidad, se ha perdido». La
 * cabecera del chat sigue a la tienda elegida, y la calidad que traía era solo la del principal.
 *
 *   /api/meta/calidad?wa=<ID del número>  →  { quality: "GREEN" | "YELLOW" | "RED" | "UNKNOWN" | null }
 *
 * Con el permiso del PROPIO número, y recordada media hora: la calidad no cambia de un minuto a otro
 * y así cambiar de tienda no le pregunta nada a Meta. Si no se puede leer, `null`: sin indicador, nunca
 * una calificación inventada.
 */
export async function GET(req: NextRequest) {
  const wa = req.nextUrl.searchParams.get("wa") ?? "";
  const conexion = /^\d+$/.test(wa) ? getMetaWhatsAppConnection(wa) : null;
  if (!conexion?.access_token) return NextResponse.json({ quality: null });
  try {
    const quality = await recordar(`calidad:${wa}`, MEDIA_HORA, async () => {
      const res = await fetchMeta(
        `https://graph.facebook.com/${graphVersion()}/${wa}?fields=quality_rating&access_token=${encodeURIComponent(conexion.access_token)}`
      );
      if (!res.ok) throw new Error(`calidad ${res.status}`);
      const datos = (await res.json()) as { quality_rating?: string | null };
      return datos.quality_rating ?? null;
    });
    return NextResponse.json({ quality }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ quality: null });
  }
}
