import { NextResponse, type NextRequest } from "next/server";
import { getClient } from "@/lib/openrouter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * EL SPINTAX CON IA, SOLO DE LO QUE ÉL ELIGE (31/10/2026). Él: «agarro el texto completo, me lo llevo a ChatGPT y
 * le digo: spintaxea solo la primera frase y la última, sin romper la riqueza de lo que se quiere decir… a veces
 * en la segunda, o en la última». Aquí: el editor manda las FRASES (o el trozo) que él marcó y el texto entero
 * de contexto; vuelven 3 variantes por frase. Una llamada por pulsación; el bot que atiende clientes no cambia
 * (ya entiende `{a|b|c}`).
 *
 * LOS CANDADOS (en el código, no solo en la instrucción): una variante que cambie un comodín {{…}}, un número
 * (precios, montos), un enlace o una palabra en MAYÚSCULAS (nombres de producto), que traiga { } |, que esté vacía,
 * que sea igual a la original o que cambie mucho de largo, se DESCARTA. Nada se aplica sin que él lo apruebe en
 * la ventana.
 */
const comodines = (s: string) => (s.match(/\{\{\s*[A-Za-z0-9_]+\s*\}\}/g) ?? []).map((x) => x.replace(/\s+/g, "")).sort().join("|");
const numeros = (s: string) => (s.replace(/\{\{[^}]*\}\}/g, " ").match(/\d+(?:[.,]\d+)*/g) ?? []).sort().join("|");
const enlaces = (s: string) => (s.match(/https?:\/\/\S+/g) ?? []).sort().join("|");
const emojis = (s: string) => (s.match(/\p{Extended_Pictographic}/gu) ?? []).length;
const mayusculas = (s: string) =>
  [...new Set((s.replace(/\{\{[^}]*\}\}/g, " ").match(/\b[A-ZÁÉÍÓÚÑ]{4,}\b/g) ?? []))].sort().join("|");

function sirve(original: string, variante: string): boolean {
  const v = variante.trim();
  if (!v || v === original.trim()) return false;
  // El bot lee `{a|b}` dentro de UNA línea (`resolveSpintax`): una variante con saltos de línea saldría tal cual.
  if (/\n/.test(v)) return false;
  if (/[{}|]/.test(v.replace(/\{\{\s*[A-Za-z0-9_]+\s*\}\}/g, ""))) return false;
  if (comodines(v) !== comodines(original)) return false;
  if (numeros(v) !== numeros(original)) return false;
  if (enlaces(v) !== enlaces(original)) return false;
  if (mayusculas(v) !== mayusculas(original)) return false;
  // Los mismos emojis en número (pueden cambiar por otros): si la frase no tenía, la variante tampoco. Si no, al
  // juntarse con lo que sigue salían repetidos («¡A disfrutar! 🎉» + « 🎉 Éxitos…»).
  if (emojis(v) !== emojis(original)) return false;
  const largo = v.length / Math.max(1, original.trim().length);
  return largo >= 0.4 && largo <= 2.2;
}

export async function POST(req: NextRequest) {
  let body: { texto?: unknown; partes?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 });
  }
  const texto = typeof body.texto === "string" ? body.texto.slice(0, 6000) : "";
  const partes = Array.isArray(body.partes) ? body.partes.filter((p): p is string => typeof p === "string" && !!p.trim()).slice(0, 12) : [];
  if (partes.length === 0) return NextResponse.json({ error: "Marca al menos una frase." }, { status: 400 });
  const modelo = process.env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini";
  try {
    const r = await getClient().chat.completions.create({
      model: modelo,
      temperature: 0.8,
      ...({ reasoning: { enabled: false }, usage: { include: true } } as object),
      messages: [
        {
          role: "system",
          content:
            "Eres redactor de mensajes de WhatsApp para ventas, en español latino natural. Te paso el MENSAJE completo (solo de contexto) y unas FRASES de él. " +
            "Para CADA frase escribe 3 variantes que digan exactamente lo mismo con otras palabras, sin perder la riqueza ni la intención del mensaje: mismo tono, " +
            "largo parecido, el mismo formato de WhatsApp (*negrita*, _cursiva_) en UNA sola línea, y la MISMA cantidad de emojis (iguales o equivalentes; si la frase no tiene, ninguno). " +
            "NO cambies nunca: los comodines {{…}}, los números, precios y montos, los enlaces, ni las palabras en MAYÚSCULAS (son nombres de productos). " +
            "No uses los caracteres { } |. " +
            'Responde SOLO con JSON, sin nada más: {"frases": [["variante 1","variante 2","variante 3"], ...]} en el mismo orden que las frases.',
        },
        {
          role: "user",
          content: `MENSAJE COMPLETO (contexto, no lo cambies):\n${texto}\n\nFRASES A VARIAR:\n${partes.map((p, i) => `${i + 1}. ${p}`).join("\n")}`,
        },
      ],
    });
    const crudo = (r.choices[0]?.message?.content ?? "").replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
    let dichas: unknown;
    try {
      dichas = JSON.parse(crudo.slice(crudo.indexOf("{"), crudo.lastIndexOf("}") + 1));
    } catch {
      return NextResponse.json({ error: "La IA no respondió bien. Prueba otra vez." }, { status: 502 });
    }
    const listas = Array.isArray((dichas as { frases?: unknown })?.frases) ? ((dichas as { frases: unknown[] }).frases as unknown[]) : [];
    const variantes = partes.map((p, i) => {
      const suyas = Array.isArray(listas[i]) ? (listas[i] as unknown[]).filter((x): x is string => typeof x === "string") : [];
      return [...new Set(suyas.map((x) => x.trim()))].filter((v) => sirve(p, v)).slice(0, 4);
    });
    const uso = r.usage as { prompt_tokens?: number; completion_tokens?: number; cost?: number } | undefined;
    console.log(`[spintax] ${partes.length} frase(s) → ${variantes.map((v) => v.length).join("/")} variantes · ${uso?.prompt_tokens ?? "?"}+${uso?.completion_tokens ?? "?"} tokens${typeof uso?.cost === "number" ? ` · $${uso.cost.toFixed(5)}` : ""}`);
    return NextResponse.json({ variantes, tokens: (uso?.prompt_tokens ?? 0) + (uso?.completion_tokens ?? 0), costo: typeof uso?.cost === "number" ? uso.cost : null });
  } catch (err) {
    console.error("[spintax] no se pudo pedir las variantes:", err);
    return NextResponse.json({ error: "No se pudo conectar con la IA. Prueba otra vez." }, { status: 502 });
  }
}
