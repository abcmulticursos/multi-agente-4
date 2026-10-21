import { NextResponse } from "next/server";
import { listMetaConnections, listMetaWhatsAppConnections } from "@/lib/db";
import { graphVersion } from "@/lib/meta/connect";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Las fotos de perfil para los selectores: la de cada número de WhatsApp y la
 * de cada página de Facebook.
 *
 * La de la página tiene una URL "pública", pero no siempre responde sin token:
 * cuando no responde, el selector se quedaba con el círculo de la inicial y no
 * se parecía al de los números. Aquí se pide con el token de esa página, que es
 * lo que sí funciona siempre.
 *
 * No se guarda nada en la base a propósito: las URLs que devuelve Meta van
 * firmadas y caducan, así que guardarlas dejaría fotos rotas al poco tiempo. Se
 * piden al abrir la pantalla, que es un sitio que se visita de tanto en tanto.
 */
export async function GET() {
  const avatares: Record<string, string> = {};

  const numeros = listMetaWhatsAppConnections().map(async (conexion) => {
    if (!conexion.access_token) return;
    try {
      const url = new URL(
        `https://graph.facebook.com/${graphVersion()}/${conexion.phone_number_id}/whatsapp_business_profile`
      );
      url.searchParams.set("fields", "profile_picture_url");
      const res = await fetch(url, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${conexion.access_token}` },
      });
      if (!res.ok) return;
      const cuerpo = (await res.json()) as {
        data?: Array<{ profile_picture_url?: unknown }>;
      };
      const foto = cuerpo.data?.[0]?.profile_picture_url;
      if (typeof foto === "string" && foto) {
        avatares[conexion.phone_number_id] = foto;
      }
    } catch {
      // Un número sin foto, o un token vencido, no debe dejar sin fotos a los
      // demás ni romper la pantalla: se omite y ya.
    }
  });

  const paginas = listMetaConnections().map(async (conexion) => {
    if (!conexion.page_access_token) return;
    try {
      const url = new URL(
        `https://graph.facebook.com/${graphVersion()}/${conexion.page_id}/picture`
      );
      // redirect=false pide el JSON con la URL, en vez de la imagen en sí.
      url.searchParams.set("redirect", "false");
      url.searchParams.set("type", "square");
      const res = await fetch(url, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${conexion.page_access_token}` },
      });
      if (!res.ok) return;
      const cuerpo = (await res.json()) as { data?: { url?: unknown } };
      const foto = cuerpo.data?.url;
      if (typeof foto === "string" && foto) {
        avatares[conexion.page_id] = foto;
      }
    } catch {
      // Igual que arriba: una página sin foto no arruina el resto.
    }
  });

  await Promise.all([...numeros, ...paginas]);

  return NextResponse.json(
    { avatares },
    { headers: { "Cache-Control": "no-store" } }
  );
}
