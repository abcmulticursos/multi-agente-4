import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * UNA SOLA VENTANA EDITANDO (12/11/2026), como WhatsApp Web. Él: «abro otra ventana en otro navegador y a veces me
 * confundo y grabo en la otra». Cada ventana del editor tiene su id; manda la última que se abrió (o la que tocó «Usar
 * aquí»), y las demás se ponen en gris sin poder guardar. Solo en memoria: tras un deploy, la primera que da señal manda.
 *
 * - «tomar»: esta ventana pasa a mandar (al abrir el editor y con «Usar aquí»).
 * - «latido»: sigo abierta. Si nadie manda, o la que mandaba lleva 2 min sin señal (una pestaña cerrada de golpe o
 *   dormida por el navegador), manda ésta.
 * - «soltar»: me cierro (al salir de la página).
 * Devuelve quién manda: la ventana compara con su id.
 */
const SIN_SENAL_MS = 120_000;
type Activa = { id: string; visto: number };
const G = globalThis as unknown as { __editorActivo?: Activa | null };

export async function POST(req: NextRequest) {
  let body: { id?: unknown; accion?: unknown };
  try {
    body = JSON.parse(await req.text()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id.slice(0, 80) : "";
  if (!id) return NextResponse.json({ error: "Falta el id." }, { status: 400 });
  const ahora = Date.now();
  const actual = G.__editorActivo ?? null;
  if (body.accion === "tomar") G.__editorActivo = { id, visto: ahora };
  else if (body.accion === "soltar") {
    if (actual?.id === id) G.__editorActivo = null;
  } else if (!actual || actual.id === id || ahora - actual.visto > SIN_SENAL_MS) G.__editorActivo = { id, visto: ahora };
  return NextResponse.json({ activo: G.__editorActivo?.id ?? null }, { headers: { "Cache-Control": "no-store" } });
}
