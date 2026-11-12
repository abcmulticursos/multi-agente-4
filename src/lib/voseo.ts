/**
 * «🇦🇷 VOSEO» DESDE EL NAVEGADOR (12/11/2026). Él: «me gustaría que le cambie a todo lo que yo seleccione, por ejemplo
 * 20 fichas». Los textos van a `/api/voseo` (que esconde comodines y enlaces de la IA y descarta lo que vuelva tocado)
 * en tandas de 20, tres a la vez; un texto repetido se pide una sola vez y sale igual en todos sus sitios.
 */
export type ResultadoDeVoseo = { texto: string | null; motivo?: string };

export async function pasarAVoseo(textos: string[]): Promise<{ porTexto: Map<string, ResultadoDeVoseo>; costo: number }> {
  const unicos = [...new Set(textos.filter((t) => t.trim()))];
  const porTexto = new Map<string, ResultadoDeVoseo>();
  let costo = 0;
  const tandas: string[][] = [];
  for (let i = 0; i < unicos.length; i += 20) tandas.push(unicos.slice(i, i + 20));
  let siguiente = 0;
  const obrero = async () => {
    while (siguiente < tandas.length) {
      const tanda = tandas[siguiente++];
      try {
        const r = await fetch("/api/voseo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ textos: tanda }) });
        const d = (await r.json()) as { resultados?: ResultadoDeVoseo[]; error?: string; costo?: number | null };
        if (!r.ok || !d.resultados) throw new Error(d.error ?? "la IA no respondió");
        tanda.forEach((t, k) => porTexto.set(t, d.resultados![k] ?? { texto: null, motivo: "la IA no devolvió esta burbuja" }));
        if (typeof d.costo === "number") costo += d.costo;
      } catch (e) {
        const motivo = e instanceof Error ? e.message : "la IA no respondió";
        tanda.forEach((t) => porTexto.set(t, { texto: null, motivo }));
      }
    }
  };
  await Promise.all([obrero(), obrero(), obrero()]);
  return { porTexto, costo };
}

/** Los campos de texto de una burbuja: como la tiene el editor (`texts`) o como se guarda (texto o pie de foto, con sus variantes). */
const CAMPOS = ["body", "caption"] as const;
const VARIANTES = ["texts", "body_variants", "caption_variants"] as const;
type PasoConTexto = Record<string, unknown> & { spintax_ia?: string[] };

/** Todos los textos de unas burbujas guardadas (las del tablero), también los grupos del spintax de la IA. */
export function textosDeLosPasos(pasos: unknown[] | undefined): string[] {
  const l: string[] = [];
  for (const p of (pasos ?? []) as PasoConTexto[]) {
    if (!p || typeof p !== "object") continue;
    for (const c of CAMPOS) if (typeof p[c] === "string") l.push(p[c] as string);
    for (const c of VARIANTES) if (Array.isArray(p[c])) for (const t of p[c] as unknown[]) if (typeof t === "string") l.push(t);
    for (const g of p.spintax_ia ?? []) if (typeof g === "string") l.push(g);
  }
  return l;
}

/** Las mismas burbujas con cada texto cambiado por su voseo (los descartados quedan igual). Sin cambios, el MISMO arreglo. */
export function pasosConVoseo<T>(pasos: T[] | undefined, porTexto: Map<string, ResultadoDeVoseo>): T[] | undefined {
  if (!pasos) return pasos;
  let tocado = false;
  const nuevo = (t: unknown) => {
    if (typeof t !== "string") return t;
    const r = porTexto.get(t)?.texto;
    if (r && r !== t) {
      tocado = true;
      return r;
    }
    return t;
  };
  const fuera = pasos.map((p0) => {
    const p = p0 as unknown as PasoConTexto;
    if (!p || typeof p !== "object") return p0;
    const q: PasoConTexto = { ...p };
    for (const c of CAMPOS) if (typeof q[c] === "string") q[c] = nuevo(q[c]);
    for (const c of VARIANTES) if (Array.isArray(q[c])) q[c] = (q[c] as unknown[]).map(nuevo);
    // El grupo del spintax de la IA sigue a su burbuja si ahora va así escrito (para «↩ Quitar spintax de la IA»).
    if (Array.isArray(p.spintax_ia)) {
      const principal = [q.texts, q.body_variants, q.caption_variants].flatMap((v) => (Array.isArray(v) ? v : [])).concat([q.body, q.caption]).filter((t) => typeof t === "string").join("\n");
      q.spintax_ia = p.spintax_ia.map((g) => {
        const r = porTexto.get(g)?.texto;
        return r && r !== g && principal.includes(r) ? r : g;
      });
    }
    return q as unknown as T;
  });
  return tocado ? fuera : pasos;
}
