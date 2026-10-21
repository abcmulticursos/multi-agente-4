import { NextResponse } from "next/server";
import { getActiveMetaConnection } from "@/lib/db";
import {
  camposSuscritosDeLaPagina,
  subscribePageToCommentWebhooks,
  subscribePageToMessagingWebhooks,
} from "@/lib/meta/connect";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  const active = getActiveMetaConnection();
  if (!active) {
    return NextResponse.json(
      { ok: false, error: "Primero conecta y activa una pagina." },
      { status: 400 }
    );
  }

  // Se leen los campos ANTES de suscribir nada: las dos llamadas de abajo
  // reemplazan la lista de la página, así que hay que saber qué había para
  // devolverlo. Sin esto, suscribirse podía quitarle campos al usuario.
  const camposPrevios = await camposSuscritosDeLaPagina({
    pageId: active.page_id,
    pageAccessToken: active.page_access_token,
  });

  const subscription = await subscribePageToMessagingWebhooks({
    pageId: active.page_id,
    pageAccessToken: active.page_access_token,
  });

  // Comentarios: llamada aparte y tolerante al fallo. Nunca puede tumbar la
  // suscripción de mensajería, que es la que hace funcionar Messenger. Va la
  // ÚLTIMA a propósito: manda la unión y deja la lista completa.
  const commentSubscription = await subscribePageToCommentWebhooks({
    pageId: active.page_id,
    pageAccessToken: active.page_access_token,
    preservarCampos: camposPrevios ?? undefined,
  });

  return NextResponse.json({
    ok: subscription.ok,
    pageId: active.page_id,
    pageName: active.page_name,
    instagramBusinessAccountId: active.instagram_business_account_id,
    subscription,
    commentSubscription,
    nextSteps: subscription.ok
      ? [
          "Prueba Messenger enviando un mensaje a la pagina.",
          "Si solo responde a admins/testers, falta App Review o pasar la app a modo vivo.",
        ]
      : [
          "Revisa que la app tenga pages_manage_metadata.",
          "Revisa que la pagina haya sido autorizada con permisos de mensajes.",
          "Si Meta dice permiso pendiente, debes completar App Review.",
        ],
  });
}
