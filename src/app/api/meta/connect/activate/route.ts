import { NextResponse, type NextRequest } from "next/server";
import { activateMetaConnection, getActiveMetaConnection } from "@/lib/db";
import {
  camposSuscritosDeLaPagina,
  subscribePageToCommentWebhooks,
  subscribePageToMessagingWebhooks,
} from "@/lib/meta/connect";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { pageId?: string } | null;
  const pageId = body?.pageId?.trim();
  if (!pageId) {
    return NextResponse.json({ error: "pageId requerido" }, { status: 400 });
  }

  const row = activateMetaConnection(pageId);
  if (!row) {
    return NextResponse.json({ error: "Pagina no encontrada" }, { status: 404 });
  }

  // Al activar una pagina se la suscribe SOLA a los webhooks, mensajes y
  // comentarios. Antes habia que acordarse de pulsar "Configurar Messenger
  // activo": quien no lo hacia se quedaba sin recibir comentarios y no habia
  // forma de notarlo. Las dos llamadas son tolerantes al fallo: la activacion
  // se da por buena igual y el resultado se devuelve para pintarlo en pantalla.
  const active = getActiveMetaConnection();
  let subscription: { ok: boolean; detail: string } | null = null;
  let commentSubscription: {
    ok: boolean;
    estado?: string;
    detail: string;
  } | null = null;
  if (active?.page_access_token) {
    // Los campos que ya tenia la pagina, leidos ANTES de tocar nada: las dos
    // suscripciones reemplazan la lista, asi que hay que saber que devolverle.
    const camposPrevios = await camposSuscritosDeLaPagina({
      pageId: active.page_id,
      pageAccessToken: active.page_access_token,
    });
    // La suscripcion de mensajes devuelve `message`; la de comentarios,
    // `detail`. Se normalizan las dos para que la pantalla lea siempre igual.
    subscription = await subscribePageToMessagingWebhooks({
      pageId: active.page_id,
      pageAccessToken: active.page_access_token,
    })
      .then((r) => ({ ok: r.ok, detail: r.message }))
      .catch((err) => ({
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
      }));
    commentSubscription = await subscribePageToCommentWebhooks({
      pageId: active.page_id,
      pageAccessToken: active.page_access_token,
      preservarCampos: camposPrevios ?? undefined,
    }).catch((err) => ({
      ok: false,
      // Se cayo la llamada: no se pudo mirar, no se afirma que fallara.
      estado: "sin_comprobar",
      detail: err instanceof Error ? err.message : String(err),
    }));
  }

  return NextResponse.json({
    ok: true,
    pageId: row.page_id,
    pageName: row.page_name,
    subscription,
    commentSubscription,
  });
}
