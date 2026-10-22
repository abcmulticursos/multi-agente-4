import type { NextRequest } from "next/server";
import { getConversationById } from "@/lib/db";
import { withOutboundMessengerPage, withOutboundWhatsAppNumber } from "@/lib/meta/runtime-config";

/**
 * LO QUE ÉL ESCRIBE A MANO SALE POR EL NÚMERO DE ESA CONVERSACIÓN (21/10/2026).
 *
 * El bot ya contesta a cada cliente por el número (o la página) al que escribió: lo fija al
 * entrar el mensaje (`withOutboundWhatsAppNumber` en handler.ts). Pero los envíos A MANO desde el
 * chat (texto, foto, audio, video, documento, reenvío, respuesta rápida) no lo fijaban, y salían
 * por el número PRINCIPAL. Con varios números y tiendas, el cliente recibía la respuesta desde
 * otro número, o Meta la rechazaba fuera de su ventana.
 *
 * Esto envuelve la ruta de envío: lee la conversación y corre el envío «dentro» de su número y su
 * página. Cómo se envía no cambia. Sin número guardado (conversaciones de antes), el de siempre.
 */
type Ctx = { params: Promise<{ conversationId: string }> };

export function conElNumeroDeLaConversacion<C extends Ctx>(enviar: (req: NextRequest, ctx: C) => Promise<Response>) {
  return async (req: NextRequest, ctx: C): Promise<Response> => {
    const { conversationId } = await ctx.params;
    const convo = getConversationById(Number(conversationId));
    return withOutboundWhatsAppNumber(convo?.wa_phone_number_id ?? null, () =>
      withOutboundMessengerPage(convo?.messenger_page_id ?? null, () => enviar(req, ctx))
    );
  };
}
