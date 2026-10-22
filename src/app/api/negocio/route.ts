import { NextResponse, type NextRequest } from "next/server";
import { getMetaRuntimeSetting, listMetaWhatsAppConnections, setMetaRuntimeSettings } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * EL PIE DE LA BARRA DE TIENDAS (21/10/2026): el nombre de su negocio y cuántos números atienden.
 * El nombre lo escribe él con un clic en el pie; «Cerrar sesión de Meta» no lo borra.
 * Solo lee la base: ninguna llamada a Meta.
 */
const CLAVE = "nombre_del_negocio";

function respuesta() {
  const numeros = listMetaWhatsAppConnections();
  return NextResponse.json(
    {
      nombre: getMetaRuntimeSetting(CLAVE)?.trim() || null,
      numeros: numeros.filter((n) => n.pausado !== 1).length,
      pausados: numeros.filter((n) => n.pausado === 1).length,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function GET() {
  return respuesta();
}

export async function POST(req: NextRequest) {
  let body: { nombre?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const nombre = typeof body.nombre === "string" ? body.nombre.trim().slice(0, 60) : "";
  setMetaRuntimeSettings({ [CLAVE]: nombre });
  return respuesta();
}
