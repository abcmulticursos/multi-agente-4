import { NextResponse } from "next/server";
import { notifyAdmin } from "@/lib/notifications";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  const now = new Date().toLocaleString("es-PE", {
    timeZone: "America/Lima",
  });
  const result = await notifyAdmin(
    `Prueba de notificacion administrativa\n\nFecha: ${now}\nOrigen: Centro de Notificaciones`
  );

  return NextResponse.json(
    {
      ok: result.sent > 0 && result.errors.length === 0,
      attempted: result.attempted,
      sent: result.sent,
      errors: result.errors,
      message:
        result.sent > 0
          ? "Prueba enviada. Revisa Telegram o WhatsApp admin."
          : "No se pudo enviar la prueba.",
    },
    { status: result.sent > 0 ? 200 : 400 }
  );
}
