import { NextResponse, type NextRequest } from "next/server";
import { previewStalePurge } from "@/lib/workflow/purge";
import { loadWorkflowConfig } from "@/lib/workflow/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Previsualización de la autopurga: muestra CUÁNTAS conversaciones se
 * borrarían (y una muestra), SIN borrar nada. Solo lectura.
 *
 * Uso: abrir en el navegador
 *   /api/admin/purge-preview            → usa los días configurados (o 13)
 *   /api/admin/purge-preview?days=20    → prueba otra ventana
 */
export async function GET(req: NextRequest) {
  const cfg = loadWorkflowConfig();
  const configured = cfg?.autopurge_inactive_days ?? 0;
  const daysParam = req.nextUrl.searchParams.get("days");
  const parsed = daysParam ? parseInt(daysParam, 10) : NaN;
  const days = Number.isFinite(parsed) && parsed > 0 ? parsed : configured || 13;

  const stale = previewStalePurge(days);

  return NextResponse.json(
    {
      dias_inactividad: days,
      autopurga_activa: configured > 0 ? configured : false,
      se_borrarian: stale.length,
      nota: "Esto es solo una previsualización — NO se borró nada. Los compradores nunca se incluyen.",
      ejemplos: stale.slice(0, 50).map((c) => ({
        nombre: c.name || c.phone,
        ultima_actividad: new Date(
          (c.last_message_at ?? c.created_at) * 1000
        ).toISOString(),
      })),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
