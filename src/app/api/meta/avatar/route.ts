import { NextResponse, type NextRequest } from "next/server";
import { getActiveMetaWhatsAppConnection, getMetaWhatsAppConnection } from "@/lib/db";
import { graphVersion } from "@/lib/meta/connect";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * FOTOS DE PERFIL QUE NO CADUCAN.
 *
 * Meta entrega las fotos como enlaces firmados que vencen a las pocas
 * semanas. Guardarlos servía el primer día y dejaba fotos rotas después. Este
 * endpoint las sirve siempre frescas:
 *
 *   /api/meta/avatar?page=<ID de la página>   → foto de la página
 *   /api/meta/avatar?wa=<ID del número>       → foto del número de WhatsApp
 *
 * La de la página se resuelve con la dirección pública de Meta, que redirige
 * siempre a la imagen actual. La de WhatsApp vive detrás del token, así que
 * se pide y se reenvía desde aquí.
 */

const CACHE = "public, max-age=3600, stale-while-revalidate=86400";

export async function GET(req: NextRequest) {
  const pageId = req.nextUrl.searchParams.get("page");
  const waId = req.nextUrl.searchParams.get("wa");

  if (pageId && /^\d+$/.test(pageId)) {
    // Pública y permanente: no necesita token ni guardarse en la base.
    return NextResponse.redirect(
      `https://graph.facebook.com/${graphVersion()}/${pageId}/picture?type=square`,
      { status: 307 }
    );
  }

  // "active" evita que quien pinta la foto tenga que conocer el ID: usa el
  // número que esté activo en ese momento.
  if (waId && (/^\d+$/.test(waId) || waId === "active")) {
    // CON EL PERMISO DEL PROPIO NÚMERO. Antes se pedía siempre con el del número activo,
    // y el de otra cuenta de Facebook no siempre llega a los números de otra: su foto no
    // salía. Si el número no está guardado, se cae al activo, como antes.
    const activo = getActiveMetaWhatsAppConnection();
    const conexion =
      waId === "active" ? activo : getMetaWhatsAppConnection(waId) ?? activo;
    const token = conexion?.access_token;
    const numeroId = waId === "active" ? conexion?.phone_number_id : waId;
    if (!token || !numeroId) return new NextResponse(null, { status: 404 });
    try {
      const perfil = await fetch(
        `https://graph.facebook.com/${graphVersion()}/${numeroId}/whatsapp_business_profile?fields=profile_picture_url&access_token=${encodeURIComponent(token)}`,
        { cache: "no-store" }
      );
      const datos = (await perfil.json()) as {
        data?: Array<{ profile_picture_url?: string }>;
      };
      const url = datos?.data?.[0]?.profile_picture_url;
      if (!url) return new NextResponse(null, { status: 404 });
      const imagen = await fetch(url, { cache: "no-store" });
      if (!imagen.ok || !imagen.body) return new NextResponse(null, { status: 404 });
      return new NextResponse(imagen.body, {
        headers: {
          "Content-Type": imagen.headers.get("content-type") ?? "image/jpeg",
          "Cache-Control": CACHE,
        },
      });
    } catch {
      return new NextResponse(null, { status: 404 });
    }
  }

  return new NextResponse(null, { status: 400 });
}
