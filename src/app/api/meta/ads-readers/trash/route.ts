import { NextRequest, NextResponse } from "next/server";
import {
  listMetaAdsReaders,
  listMetaAdsReadersEnPapelera,
  purgeMetaAdsReader,
  restoreMetaAdsReader,
} from "@/lib/db";

export const runtime = "nodejs";

/**
 * LA PAPELERA de cuentas de lectura de Ads.
 *
 * "Quitar" (el DELETE de la ruta de al lado) ya no borra: manda aquí. Desde
 * aquí se restaura con su token, o se borra de verdad — que es un segundo paso
 * y deliberado, porque el token no se puede recuperar despues.
 *
 * El token NUNCA sale en las listas, ni en la papelera: para verlo está la
 * ruta de al lado, que lo pide de una en una.
 */
function respuesta() {
  const sinToken = ({ token: _token, ...resto }: { token: string }) => resto;
  return NextResponse.json({
    readers: listMetaAdsReaders().map(sinToken),
    papelera: listMetaAdsReadersEnPapelera().map(sinToken),
  });
}

export async function GET() {
  return respuesta();
}

/** Restaura una cuenta de la papelera. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const id = Number(body?.id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "Cuenta invalida." }, { status: 400 });
  }
  if (!restoreMetaAdsReader(id)) {
    return NextResponse.json(
      { error: "Esa cuenta no está en la papelera." },
      { status: 404 }
    );
  }
  return respuesta();
}

/** Borrado definitivo. Solo alcanza a lo que ya está en la papelera. */
export async function DELETE(req: NextRequest) {
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "Cuenta invalida." }, { status: 400 });
  }
  if (!purgeMetaAdsReader(id)) {
    return NextResponse.json(
      { error: "Esa cuenta no está en la papelera." },
      { status: 404 }
    );
  }
  return respuesta();
}
