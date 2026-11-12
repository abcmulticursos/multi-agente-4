/**
 * ¿LA IA DEVOLVIÓ BASURA? (12/11/2026) Él: «el bot está empezando a soltar caracteres raros». Tres clientes recibieron
 * `* "to * * *`, `abandona the " " "trademarks,"` y `*Dec 24, _ * 🎓`: GMICloud (una de las empresas que sirven el
 * modelo por OpenRouter) devolvía 3–14 tokens rotos, y el bot los mandaba tal cual. Y él, con razón: «verifica si hay
 * más huevadas… la negligencia de no filtrar esa porquería». Lo usan TODAS las respuestas de IA que llegan al cliente
 * (la IA del tablero, la venta automática y la pregunta del país de Messenger).
 *
 * Una respuesta de verdad tiene al menos 2 palabras y está en español. No mira el sentido —eso no se puede—, solo lo que
 * ninguna respuesta buena tiene: casi sin palabras, o palabras sueltas en inglés.
 */
export function esBasuraDeLaIA(t: string): boolean {
  const palabras = (t.replace(/https?:\/\/\S+/g, " ").match(/[a-záéíóúñü]{2,}/gi) ?? []).map((p) => p.toLowerCase());
  // (Con 2 basta: «Ok, gracias» es una respuesta; «* "to * * *» tiene una sola palabra.)
  if (palabras.length < 2) return true;
  const INGLES = new Set(["the", "to", "and", "of", "is", "in", "for", "with", "that", "this", "it", "on", "are", "be", "trademarks", "abandon"]);
  return palabras.filter((p) => INGLES.has(p)).length / palabras.length >= 0.3;
}

/** El nombre de la empresa que atendió (OpenRouter lo dice en `provider`), como lo pide su `provider.ignore`. */
export function empresaQueRespondio(r: unknown): string {
  return String((r as { provider?: string } | null)?.provider ?? "").toLowerCase().replace(/\s+/g, "");
}
