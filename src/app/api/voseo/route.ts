import { NextResponse, type NextRequest } from "next/server";
import { getClient } from "@/lib/openrouter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * EL VOSEO CON IA (12/11/2026). Él: «tengo que convertir todo el texto en voseo argentino… no quiero cambiar todo el
 * texto, solo voseo y que parezca realmente argentino», y «cuidado con los comodines, no sea que el comodín se vea
 * afectado por la IA».
 *
 * LOS COMODINES NO LLEGAN A LA IA: antes de mandarlos, cada {{…}} y cada enlace se cambia por una marca ⟦n⟧, y al
 * volver se ponen de nuevo. Lo que vuelve se DESCARTA (queda el original) si: falta o sobra una marca, cambió un
 * número, cambió una palabra en MAYÚSCULAS, cambió la forma del spintax ({ | }), cambió la cantidad de emojis o de
 * saltos de línea, o el largo cambió demasiado. Nada se aplica sin que él lo vea en la ventana.
 */
const MARCA = /⟦(\d+)⟧/g;
const numeros = (s: string) => (s.match(/\d+(?:[.,]\d+)*/g) ?? []).sort().join("|");
const mayusculas = (s: string) => (s.match(/\b[A-ZÁÉÍÓÚÑ]{4,}\b/g) ?? []).sort().join("|");
const forma = (s: string) => s.replace(/[^{}|\n]/g, "");
const emojis = (s: string) => (s.match(/\p{Extended_Pictographic}/gu) ?? []).length;

function protegido(texto: string): { conMarcas: string; guardados: string[] } {
  const guardados: string[] = [];
  const conMarcas = texto.replace(/\{\{\s*[^{}]+?\s*\}\}|https?:\/\/\S+/g, (m) => {
    guardados.push(m);
    return `⟦${guardados.length - 1}⟧`;
  });
  return { conMarcas, guardados };
}

function devuelto(original: string, conMarcas: string, guardados: string[], dicho: string): { texto: string | null; motivo?: string } {
  const marcas = [...dicho.matchAll(MARCA)].map((m) => Number(m[1]));
  if (marcas.length !== guardados.length || new Set(marcas).size !== guardados.length || marcas.some((n) => n >= guardados.length))
    return { texto: null, motivo: "la IA tocó un comodín o un enlace" };
  if (numeros(dicho.replace(MARCA, " ")) !== numeros(conMarcas.replace(MARCA, " "))) return { texto: null, motivo: "la IA cambió un número" };
  if (mayusculas(dicho) !== mayusculas(conMarcas)) return { texto: null, motivo: "la IA cambió una palabra en MAYÚSCULAS" };
  if (forma(dicho) !== forma(conMarcas)) return { texto: null, motivo: "la IA cambió el spintax o los saltos de línea" };
  if (emojis(dicho) !== emojis(conMarcas)) return { texto: null, motivo: "la IA cambió los emojis" };
  const largo = dicho.length / Math.max(1, conMarcas.length);
  if (largo < 0.85 || largo > 1.2) return { texto: null, motivo: "la IA cambió demasiado el texto" };
  const texto = dicho.replace(MARCA, (_, n) => guardados[Number(n)]);
  return { texto: texto === original ? original : texto };
}

export async function POST(req: NextRequest) {
  let body: { textos?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 });
  }
  const textos = Array.isArray(body.textos) ? body.textos.map((t) => (typeof t === "string" ? t.slice(0, 4000) : "")).slice(0, 60) : [];
  if (!textos.some((t) => t.trim())) return NextResponse.json({ error: "No hay texto que pasar a voseo." }, { status: 400 });
  const piezas = textos.map(protegido);
  try {
    const r = await getClient().chat.completions.create({
      model: process.env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini",
      temperature: 0,
      ...({ reasoning: { enabled: false }, usage: { include: true } } as object),
      messages: [
        {
          role: "system",
          content:
            "Pasas mensajes de WhatsApp de ventas al VOSEO de Argentina, cambiando LO MÍNIMO. Cambia SOLO la segunda persona del tuteo: " +
            "«tú» → «vos»; los verbos al voseo (tienes → tenés, puedes → podés, quieres → querés, eres → sos, sabes → sabés, necesitas → necesitás, vienes → venís); " +
            "los imperativos (escribe → escribí, mira → mirá, elige → elegí, envía → enviá, cuéntame → contame, dime → decime, hazlo → hacelo, ven → vení, aprovecha → aprovechá); " +
            "«contigo» → «con vos». Los pronombres te/tu/tus/ti se quedan como están salvo «ti» tras preposición → «vos» (para ti → para vos). " +
            "Si un texto usa «usted», déjalo igual. NO cambies ninguna otra palabra, ni el orden, ni la puntuación, ni los signos ¿? ¡!, ni los emojis, " +
            "ni las MAYÚSCULAS, ni el formato (*negrita*, _cursiva_), ni los saltos de línea, ni los caracteres { | } (el spintax: cambia solo las palabras dentro), " +
            "ni las marcas ⟦0⟧, ⟦1⟧… (déjalas exactamente donde están). Si no hay nada que cambiar, devuelve el texto igual. " +
            'Responde SOLO con JSON: {"textos": ["…", "…"]} en el mismo orden y con la misma cantidad.',
        },
        { role: "user", content: JSON.stringify({ textos: piezas.map((p) => p.conMarcas) }) },
      ],
    });
    const crudo = (r.choices[0]?.message?.content ?? "").replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
    let dichos: unknown[] = [];
    try {
      const j = JSON.parse(crudo.slice(crudo.indexOf("{"), crudo.lastIndexOf("}") + 1)) as { textos?: unknown };
      dichos = Array.isArray(j.textos) ? j.textos : [];
    } catch {
      return NextResponse.json({ error: "La IA no respondió bien. Prueba otra vez." }, { status: 502 });
    }
    const resultados = textos.map((t, i) => {
      if (!t.trim()) return { texto: t };
      const d = dichos[i];
      if (typeof d !== "string" || !d.trim()) return { texto: null, motivo: "la IA no devolvió esta burbuja" };
      return devuelto(t, piezas[i].conMarcas, piezas[i].guardados, d);
    });
    const uso = r.usage as { prompt_tokens?: number; completion_tokens?: number; cost?: number } | undefined;
    console.log(`[voseo] ${textos.length} texto(s) → ${resultados.filter((x) => x.texto && x.texto !== textos[resultados.indexOf(x)]).length} cambiados, ${resultados.filter((x) => x.texto === null).length} descartados · ${uso?.prompt_tokens ?? "?"}+${uso?.completion_tokens ?? "?"} tokens${typeof uso?.cost === "number" ? ` · $${uso.cost.toFixed(5)}` : ""}`);
    return NextResponse.json({ resultados, costo: typeof uso?.cost === "number" ? uso.cost : null });
  } catch (err) {
    console.error("[voseo] no se pudo pedir:", err);
    return NextResponse.json({ error: "No se pudo conectar con la IA. Prueba otra vez." }, { status: 502 });
  }
}
