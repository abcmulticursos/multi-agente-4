import { NextResponse, type NextRequest } from "next/server";
import { getConversationById } from "@/lib/db";
import { buildMessagingUserData, sendContactEvent } from "@/lib/meta/conversions";
import { explicarErrorCapi } from "@/lib/meta/errores-capi";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface Ctx {
  params: Promise<{ conversationId: string }>;
}

function idValido(valor: string): number | null {
  const id = Number(valor);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/** El detalle del último evento: qué pasó y qué hacer. */
export async function GET(_req: NextRequest, { params }: Ctx) {
  const { conversationId } = await params;
  const id = idValido(conversationId);
  if (!id) return NextResponse.json({ error: "id inválido" }, { status: 400 });

  const convo = getConversationById(id);
  if (!convo) return NextResponse.json({ error: "no existe" }, { status: 404 });

  return NextResponse.json(
    {
      evento: convo.capi_last_event,
      ok: convo.capi_last_ok,
      error: convo.capi_last_error,
      cuando: convo.capi_last_at,
      explicacion: explicarErrorCapi(convo.capi_last_error),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

/**
 * Vuelve a intentar el evento que falló.
 *
 * Solo se permite si el último intento FALLÓ. Esa condición no es un adorno:
 * un evento que fracasó nunca llegó a Meta, así que reintentarlo no puede
 * duplicar nada. Reintentar uno que sí llegó sí lo duplicaría.
 */
export async function POST(_req: NextRequest, { params }: Ctx) {
  const { conversationId } = await params;
  const id = idValido(conversationId);
  if (!id) return NextResponse.json({ error: "id inválido" }, { status: 400 });

  const convo = getConversationById(id);
  if (!convo) return NextResponse.json({ error: "no existe" }, { status: 404 });

  if (convo.capi_last_ok !== 0) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Solo se puede reintentar un evento que falló. Este no falló, así que reintentarlo lo contaría dos veces.",
      },
      { status: 400 }
    );
  }

  await sendContactEvent({
    conversationId: id,
    userData: buildMessagingUserData({
      channel: (convo.channel ?? "whatsapp") as
        | "whatsapp"
        | "messenger"
        | "instagram"
        | "tiktok"
        | "test",
      phone: convo.phone,
      firstName: convo.client_name,
      email: convo.client_email,
      ctwa_clid: convo.ctwa_clid,
    }),
  });

  // Se relee: sendContactEvent deja anotado el resultado del nuevo intento.
  const despues = getConversationById(id);
  return NextResponse.json({
    ok: despues?.capi_last_ok === 1,
    evento: despues?.capi_last_event ?? null,
    error: despues?.capi_last_error ?? null,
    explicacion: explicarErrorCapi(despues?.capi_last_error),
  });
}
