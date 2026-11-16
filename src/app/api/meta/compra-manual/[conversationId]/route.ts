import { NextResponse, type NextRequest } from "next/server";
import { anotarCompraManualEnMeta, getConversationById, type ConversationRow } from "@/lib/db";
import { buildMessagingUserData, sendPurchaseEvent } from "@/lib/meta/conversions";
import { explicarErrorCapi } from "@/lib/meta/errores-capi";
import { getCountryInfo } from "@/lib/countries";
import { getEffectiveCountryCode } from "@/lib/workflow/config";
import { estadoEnElTablero, preciosDelCobro } from "@/lib/tablero/estado";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * «💰 REGISTRAR COMPRA EN META» (16/11/2026). Él: «yo necesito decirle a meta que esta persona compró y lo tome en
 * cuenta, meta ya sabe de qué ad vino». Un pago que el bot rechazó (o que no vio) y él entregó a mano no llegaba a Meta:
 * la compra solo se reporta cuando el bot aprueba el comprobante. Esto manda el MISMO Purchase que manda el bot al
 * aprobar —`sendPurchaseEvent`, con su ctwa_clid, la página y el pixel de su tienda— con el monto que él confirme.
 * No entrega, no cambia el estado y no le escribe al cliente: solo avisa a Meta.
 */

interface Ctx {
  params: Promise<{ conversationId: string }>;
}

function idValido(valor: string): number | null {
  const id = Number(valor);
  return Number.isFinite(id) && id > 0 ? id : null;
}

type CompraManual = { valor: number; moneda: string; at: number };

function laCompraManual(convo: ConversationRow): CompraManual | null {
  try {
    const v = JSON.parse(convo.compra_manual_meta ?? "null");
    return v && typeof v.valor === "number" ? (v as CompraManual) : null;
  } catch {
    return null;
  }
}

/** El monto que se le propone: el del cobro del tablero que eligió, o el precio congelado de la venta de siempre. */
function loSugerido(convo: ConversationRow): { valor: number | null; moneda: string } {
  let moneda = convo.locked_price_currency ?? "";
  try {
    if (!moneda) moneda = getCountryInfo(getEffectiveCountryCode(convo.phone)).currency;
  } catch {
    // sin país conocido: la escribe él
  }
  const e = estadoEnElTablero(convo.id);
  if (e) {
    const precios = preciosDelCobro(e);
    const elegido = e.cobro_elegido ?? e.cobro_propuesta;
    const delElegido = elegido ? precios[elegido] : undefined;
    if (typeof delElegido === "number" && delElegido > 0) return { valor: delElegido, moneda };
    const todos = Object.values(precios).filter((p) => typeof p === "number" && p > 0);
    if (todos.length === 1) return { valor: todos[0], moneda };
  }
  if (convo.locked_price_cents && convo.locked_price_cents > 0) return { valor: convo.locked_price_cents / 100, moneda };
  return { valor: null, moneda };
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { conversationId } = await params;
  const id = idValido(conversationId);
  if (!id) return NextResponse.json({ error: "id inválido" }, { status: 400 });
  const convo = getConversationById(id);
  if (!convo) return NextResponse.json({ error: "no existe" }, { status: 404 });
  return NextResponse.json(
    {
      sugerido: loSugerido(convo),
      yaRegistrada: laCompraManual(convo),
      // Lo que el bot ya cobró y reportó solo. Si hay, registrar otra la contaría dos veces.
      yaPagado: convo.paid_total_cents > 0 ? convo.paid_total_cents / 100 : 0,
      vinoDeUnAnuncio: !!convo.ctwa_clid,
      esDePrueba: convo.channel === "test",
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const { conversationId } = await params;
  const id = idValido(conversationId);
  if (!id) return NextResponse.json({ error: "id inválido" }, { status: 400 });
  const convo = getConversationById(id);
  if (!convo) return NextResponse.json({ error: "no existe" }, { status: 404 });
  if (convo.channel === "test") {
    return NextResponse.json({ ok: false, error: "Es una conversación del simulador: no se le manda nada a Meta." }, { status: 400 });
  }
  const body = (await req.json().catch(() => ({}))) as { valor?: unknown; moneda?: unknown };
  const valor = Number(body.valor);
  const moneda = String(body.moneda ?? "").trim().toUpperCase();
  if (!Number.isFinite(valor) || valor <= 0) {
    return NextResponse.json({ ok: false, error: "Escribe el monto que pagó." }, { status: 400 });
  }
  if (!/^[A-Z]{3}$/.test(moneda)) {
    return NextResponse.json({ ok: false, error: "La moneda va en 3 letras (PEN, ARS, USD, COP…)." }, { status: 400 });
  }
  const resultado = await sendPurchaseEvent({
    conversationId: id,
    userData: buildMessagingUserData({
      channel: (convo.channel ?? "whatsapp") as "whatsapp" | "messenger" | "instagram" | "tiktok" | "test",
      phone: convo.phone,
      firstName: convo.client_name ?? convo.name,
      email: convo.client_email,
      ctwa_clid: convo.ctwa_clid,
    }),
    value: valor,
    currency: moneda,
  });
  if (!resultado) {
    return NextResponse.json({
      ok: false,
      error: "No se pudo mandar: falta el pixel o el permiso de Meta de esta tienda (Meta Connect).",
    });
  }
  if (!resultado.ok) {
    return NextResponse.json({
      ok: false,
      error: resultado.responseText || "Meta no la aceptó.",
      explicacion: explicarErrorCapi(resultado.responseText),
    });
  }
  anotarCompraManualEnMeta(id, valor, moneda);
  console.log(`[capi] convo ${id}: compra registrada A MANO en Meta (${valor} ${moneda})`);
  // `sendPurchaseEvent` deja anotado a dónde fue (pixel y tienda); se relee para enseñarlo.
  const despues = getConversationById(id);
  return NextResponse.json({
    ok: true,
    pixel: despues?.capi_last_pixel ?? null,
    tienda: despues?.capi_last_tienda ?? null,
    vinoDeUnAnuncio: !!convo.ctwa_clid,
  });
}
