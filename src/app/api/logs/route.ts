/**
 * DESCARGAR EL LOG (27/10/2026). GET /api/logs → los días guardados (JSON).
 * GET /api/logs?dia=AAAA-MM-DD[&convo=N] → el log de ese día (solo esa conversación, si se da),
 * como archivo de texto. Protegido por el login del panel (proxy.ts protege todo /api).
 */
import { NextResponse } from "next/server";
import { getConversationById } from "@/lib/db";
import { diaDeHoy, diasGuardados, leerElLog } from "@/lib/registro-a-disco";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const pedido = url.searchParams.get("dia");
  if (!pedido) return NextResponse.json({ dias: diasGuardados(), hoy: diaDeHoy() });
  const convo = Number(url.searchParams.get("convo") || 0) || null;
  const telefono = convo ? getConversationById(convo)?.phone ?? null : null;
  // «hoy»: el día de hoy; con una conversación, también ayer (una prueba puede cruzar la medianoche).
  const dia = pedido === "hoy" ? diaDeHoy() : pedido;
  const dias = pedido === "hoy" && convo ? [diaDeHoy(new Date(Date.now() - 86400 * 1000)), dia] : [dia];
  const texto = dias.map((d) => leerElLog(d, convo, telefono)).filter(Boolean).join("\n");
  const nombre = `log-${dia}${convo ? `-convo-${convo}` : ""}.txt`;
  return new NextResponse(texto || "(no hay líneas para ese día o esa conversación)", {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nombre}"`,
    },
  });
}
