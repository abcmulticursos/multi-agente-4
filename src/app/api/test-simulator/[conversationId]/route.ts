import { NextResponse, type NextRequest } from "next/server";
import {
  deleteConversation,
  getConversationById,
  getMessages,
  getTestMessageButtons,
  setTestConversationModality,
} from "@/lib/db";
import { tick } from "@/lib/workflow/worker";
import { salirDelTablero } from "@/lib/tablero/estado";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface Ctx { params: Promise<{ conversationId: string }> }

function testConversation(id: number) {
  const convo = getConversationById(id);
  return convo?.channel === "test" ? convo : null;
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  const id = Number((await params).conversationId);
  const convo = testConversation(id);
  if (!convo) return NextResponse.json({ error: "Prueba no encontrada" }, { status: 404 });
  // El panel consulta esta ruta cada segundo: procesa únicamente acciones ya
  // vencidas para que la prueba refleje intros y seguimientos reales.
  try {
    await tick();
  } catch (err) {
    console.error("[test-sim] tick falló:", err);
  }
  const messages = getMessages(id, 300);
  const buttons: Record<number, { id: string; title: string }[]> = {};
  for (const message of messages) {
    const value = getTestMessageButtons(message.id);
    if (value.length) buttons[message.id] = value;
  }
  return NextResponse.json(
    { conversation: convo, messages, buttons },
    { headers: { "Cache-Control": "no-store" } }
  );
}

/**
 * MODO TESTEADOR: fija la modalidad que reproduce ESTA prueba.
 *
 * Solo acepta conversaciones del simulador, y la propia consulta a la base
 * vuelve a exigirlo. La modalidad que venden tus clientas no se toca: vive en
 * la configuración, y aquí no se escribe nada de eso.
 */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const id = Number((await params).conversationId);
  const convo = testConversation(id);
  if (!convo) return NextResponse.json({ error: "Prueba no encontrada" }, { status: 404 });

  let body: { modality?: unknown };
  try {
    body = (await req.json()) as { modality?: unknown };
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const valor = typeof body.modality === "string" ? body.modality : null;
  const permitidas = [
    "lineal",
    "order_bump",
    "bioferta",
    "doble_oferta_dos",
    "doble_oferta_upsell",
    "upsell",
  ];
  // "" o null = usar la modalidad real. Cualquier otro valor raro se rechaza.
  if (valor && !permitidas.includes(valor)) {
    return NextResponse.json({ error: "modalidad no valida" }, { status: 400 });
  }
  setTestConversationModality(id, valor || null);
  return NextResponse.json({ ok: true, modality: valor || null });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const id = Number((await params).conversationId);
  const convo = testConversation(id);
  if (!convo) return NextResponse.json({ error: "Prueba no encontrada" }, { status: 404 });
  // Y lo suyo en el tablero (23/10/2026): sus compras y la huella de sus comprobantes, para poder
  // volver a probar con la misma foto en otra conversación de prueba.
  salirDelTablero(id);
  deleteConversation(id);
  return NextResponse.json({ ok: true });
}
