import { NextResponse, type NextRequest } from "next/server";
import { removeMetaConnection, removeMetaWhatsAppConnection } from "@/lib/db";
import { idsDeNuestrasApps } from "@/lib/meta/apps-de-meta";
import { desenchufarCuentasQueSeDejan, loQueNoSePudo } from "@/lib/meta/desenchufar";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    type?: string;
    id?: string;
  } | null;
  const id = body?.id?.trim();
  if (!id || (body?.type !== "page" && body?.type !== "whatsapp")) {
    return NextResponse.json({ ok: false, error: "Conexion invalida." }, { status: 400 });
  }
  // (19/11/2026) Un número: las apps del bot se desconectan EN META de su cuenta de WhatsApp si ya no queda otro
  // número guardado en ella (`desenchufar.ts`). Antes solo se borraba del bot y en Meta seguía conectado.
  if (body.type === "whatsapp" && (body as { forzar?: unknown }).forzar !== true) {
    const hechos = await desenchufarCuentasQueSeDejan([id], idsDeNuestrasApps());
    if (hechos.some((h) => !h.ok)) {
      return NextResponse.json({ ok: false, enMeta: true, error: `No pude desconectarlo en Meta:\n${loQueNoSePudo(hechos)}` });
    }
  }
  const removed =
    body.type === "page"
      ? removeMetaConnection(id)
      : removeMetaWhatsAppConnection(id);
  return NextResponse.json({ ok: removed, error: removed ? undefined : "Conexion no encontrada." });
}
