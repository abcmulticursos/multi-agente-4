/**
 * De dónde llegó un lead.
 *
 * Vive aquí y no dentro de cada pantalla a propósito: el chat y el Kanban
 * tienen que contar la misma historia. Dos copias de esta regla acabarían
 * dando dos verdades distintas — y una de ellas, tarde o temprano, es la
 * equivocada.
 *
 * Ojo con el dato, porque es el error fácil: **no alcanza con mirar
 * `ad_source_id`**. Una conversación puede traer el click del anuncio
 * (`ctwa_clid`) sin que se haya resuelto todavía qué anuncio concreto fue.
 * Mirando solo `ad_source_id` la daríamos por orgánica, y no lo es.
 */

export type OrigenDeLead = "anuncio" | "comentario" | "organico";

export interface LeadConOrigen {
  ctwa_clid?: string | null;
  ad_source_id?: string | null;
  lead_origin?: string | null;
}

/** ¿Esta conversación nació de un click en un anuncio? */
export function vinoDeAnuncio(lead: LeadConOrigen): boolean {
  return Boolean(lead.ctwa_clid?.trim() || lead.ad_source_id?.trim());
}

export function origenDeLead(lead: LeadConOrigen): OrigenDeLead {
  // El comentario de Facebook manda: es una vía propia, no un anuncio ni un
  // orgánico suelto.
  if (lead.lead_origin === "comment") return "comentario";
  return vinoDeAnuncio(lead) ? "anuncio" : "organico";
}

/** Cómo se le muestra al operador, en una línea. */
export const ETIQUETA_DE_ORIGEN: Record<OrigenDeLead, string> = {
  anuncio: "📢 Vino de un anuncio",
  comentario: "💬 Vino de un comentario",
  organico: "🌱 Entró orgánico — no vino de ningún anuncio",
};

/** El porqué, para el tooltip. Explica qué implica cada origen. */
export const EXPLICACION_DE_ORIGEN: Record<OrigenDeLead, string> = {
  anuncio:
    "Trae el identificador del click, así que si compra, Meta puede atribuir la venta a este anuncio.",
  comentario:
    "Llegó desde un comentario en Facebook, no desde un click en un anuncio.",
  organico:
    "Escribió por su cuenta, sin click en ningún anuncio. Si compra, la venta se reporta a Meta pero sin colgarse de ninguna campaña.",
};
