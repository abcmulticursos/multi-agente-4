import { NextRequest, NextResponse } from "next/server";
import { olvidarCopiaDeDrive } from "@/lib/workflow/drive";

/**
 * EL BOTÓN ↻ DEL EDITOR.
 *
 * El bot guarda una copia de cada archivo de Drive en su disco. Normalmente se
 * entera solo de que el archivo cambió —compara peso y fecha antes de usarla—,
 * pero hay dos casos donde eso no basta:
 *
 *   • La foto nueva pesa EXACTAMENTE lo mismo que la vieja.
 *   • Hay prisa y no se quiere esperar al siguiente envío para comprobarlo.
 *
 * Este botón borra la copia sin preguntar nada. La próxima vez que el bot mande
 * ese archivo lo bajará de nuevo.
 *
 * Devuelve también una marca de tiempo: el editor se la pega al enlace de la
 * miniatura para que el navegador —que la guarda 24 horas— la pida otra vez.
 */
export async function POST(req: NextRequest) {
  let url = "";
  try {
    const body = (await req.json()) as { url?: unknown };
    url = typeof body?.url === "string" ? body.url.trim() : "";
  } catch {
    url = "";
  }
  if (!url) {
    return NextResponse.json(
      { ok: false, error: "Falta el enlace." },
      { status: 400 }
    );
  }

  const borrados = olvidarCopiaDeDrive(url);
  // marca: lo que el editor le añade al enlace de la miniatura para saltarse la
  // copia del navegador. Va aunque no se haya borrado nada — puede que el bot
  // todavía no hubiera mandado ese archivo nunca, y la miniatura sí esté vieja.
  return NextResponse.json({ ok: true, borrados, marca: Date.now() });
}
