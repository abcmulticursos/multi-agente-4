import { NextRequest, NextResponse } from "next/server";
import {
  deleteMetaAdsReader,
  getMetaAdsReader,
  listMetaAdsReaders,
  listMetaAdsReadersEnPapelera,
  saveMetaAdsReader,
  updateMetaAdsReader,
} from "@/lib/db";
import { nombreDelNegocioDelToken } from "@/lib/meta/nombre-del-lector";

export const runtime = "nodejs";

/** Las dos listas viajan juntas: así la pantalla no puede quedar con una al
 *  día y la otra vieja tras quitar o restaurar una cuenta. El token no sale
 *  en ninguna de las dos — para eso está el GET por id. */
function listReadersResponse() {
  const sinToken = ({ token: _token, ...reader }: { token: string }) => reader;
  return NextResponse.json({
    readers: listMetaAdsReaders().map(sinToken),
    papelera: listMetaAdsReadersEnPapelera().map(sinToken),
  });
}

export async function GET(req: NextRequest) {
  const idParam = new URL(req.url).searchParams.get("id");
  if (idParam !== null) {
    const id = Number(idParam);
    if (!Number.isInteger(id)) {
      return NextResponse.json({ error: "Cuenta invalida." }, { status: 400 });
    }
    const reader = getMetaAdsReader(id);
    if (!reader) {
      return NextResponse.json({ error: "Cuenta no encontrada." }, { status: 404 });
    }
    return NextResponse.json({ reader });
  }

  return listReadersResponse();
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const token = typeof body?.token === "string" ? body.token.trim() : "";

  if (!token) {
    return NextResponse.json({ error: "Falta el token." }, { status: 400 });
  }

  // Sin nombre no se rechaza: se le pregunta a Meta de quién es el token. Es
  // un dato que Meta ya tiene, y escribirlo a mano solo agrega una ocasión de
  // equivocarse — un nombre mal puesto engaña justo el día que algo falla.
  //
  // Si Meta no contesta se pide a mano, que es como funcionaba antes. Nunca se
  // inventa un nombre ni se guarda con uno vacío: sin nombre, con varios
  // tokens cargados no se sabría cuál es cuál.
  let nombreFinal = name;
  if (!nombreFinal) {
    nombreFinal = (await nombreDelNegocioDelToken(token)) ?? "";
  }
  if (!nombreFinal) {
    return NextResponse.json(
      {
        error:
          "Meta no dijo de qué negocio es este token. Escribe tú el nombre.",
      },
      { status: 400 }
    );
  }

  saveMetaAdsReader(nombreFinal, token);
  return listReadersResponse();
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const id = Number(body?.id);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const token = typeof body?.token === "string" ? body.token : undefined;
  if (!Number.isInteger(id) || !name) {
    return NextResponse.json(
      { error: "Nombre de cuenta invalido." },
      { status: 400 }
    );
  }

  try {
    const updated = updateMetaAdsReader({ id, name, token });
    if (!updated) {
      return NextResponse.json({ error: "Cuenta no encontrada." }, { status: 404 });
    }
    return listReadersResponse();
  } catch {
    return NextResponse.json(
      {
        error:
          "Ya existe otra cuenta de lectura con ese nombre. Puede estar en la papelera.",
      },
      { status: 409 }
    );
  }
}

/**
 * Quitar = mandar a la papelera. No borra: la cuenta deja de aparecer en la
 * lista y en los selectores, pero conserva su token para poder restaurarla.
 * El borrado de verdad vive en /trash, y es un segundo paso a propósito.
 */
export async function DELETE(req: NextRequest) {
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "Cuenta invalida." }, { status: 400 });
  }

  deleteMetaAdsReader(id);
  return listReadersResponse();
}
