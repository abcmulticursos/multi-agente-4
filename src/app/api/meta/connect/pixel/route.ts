import { NextResponse, type NextRequest } from "next/server";
import {
  deleteMetaRuntimeSettings,
  getMetaRuntimeSetting,
  setMetaRuntimeSettings,
} from "@/lib/db";
import { getCapiPixelId } from "@/lib/meta/runtime-config";
import type { MetaPixelOption } from "@/lib/meta/connect";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Los pixels que se detectaron al conectar. Si no hay, se devuelve vacío. */
function pixelsDetectados(): MetaPixelOption[] {
  const crudo = getMetaRuntimeSetting("pixels_detectados");
  if (!crudo) return [];
  try {
    const parsed = JSON.parse(crudo);
    return Array.isArray(parsed)
      ? parsed.filter(
          (pixel): pixel is MetaPixelOption => typeof pixel?.pixelId === "string"
        )
      : [];
  } catch {
    return [];
  }
}

export async function GET() {
  const elegido = getMetaRuntimeSetting("capi_pixel_id");
  return NextResponse.json(
    {
      pixels: pixelsDetectados(),
      // El elegido a mano, y el que de verdad va a usar el motor — que puede
      // venir de una variable de entorno si nadie eligió nada.
      elegido,
      enUso: getCapiPixelId(),
      // Para que la pantalla pueda avisar de dónde sale cuando no se eligió.
      desdeVariable: !elegido && Boolean(getCapiPixelId()),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { pixelId?: unknown };
  const pixelId = typeof body?.pixelId === "string" ? body.pixelId.trim() : "";

  // Vacío = volver a lo que diga la variable de entorno. Se permite a
  // propósito: es la forma de deshacer una elección sin borrar nada a mano.
  //
  // Hay que BORRAR el ajuste, no guardarlo vacío: setMetaRuntimeSettings
  // descarta los valores en blanco, así que guardar "" no haría nada y la
  // elección anterior seguiría mandando.
  if (!pixelId) {
    deleteMetaRuntimeSettings(["capi_pixel_id"]);
    return NextResponse.json({ ok: true, elegido: null, enUso: getCapiPixelId() });
  }

  // Solo se acepta un pixel de los detectados: así no se guarda un id inventado
  // que dejaría los eventos yendo a un dataset que no existe.
  const conocido = pixelsDetectados().some((pixel) => pixel.pixelId === pixelId);
  if (!conocido) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Ese pixel no está entre los detectados. Vuelve a conectar con Meta para actualizar la lista.",
      },
      { status: 400 }
    );
  }

  setMetaRuntimeSettings({ capi_pixel_id: pixelId });
  return NextResponse.json({ ok: true, elegido: pixelId, enUso: getCapiPixelId() });
}
