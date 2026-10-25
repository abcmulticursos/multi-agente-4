/**
 * LAS ENTREGAS DE UN PRODUCTO (25/10/2026). Un producto tiene su entrega principal (`delivery`) y puede
 * tener ENTREGAS EXTRA (`entregas_extra`): otras partes suyas que se mandan en otro momento (muestras
 * gratis, un nivel de contribución…). Alberto: «no es producto… se llenaría muy rápido y habría
 * confusión»; antes cada una era un producto más en la biblioteca.
 *
 * Una entrega se nombra con una CLAVE: «producto» = la principal, «producto#entrega» = una extra. Es
 * lo que guarda la ficha Entregar y lo que se anota al entregar (`tablero_entregas.producto_id`), así
 * el reenvío y el correo mandan exactamente lo que salió. Las anotadas antes eran solo «producto»: se
 * leen igual.
 */
import type { SequenceStep, WorkflowConfig, ProductoDeLaBiblioteca } from "@/lib/workflow/config";

export function claveDeEntrega(productoId: string, entregaId?: string | null): string {
  return entregaId ? `${productoId}#${entregaId}` : productoId;
}

export function partirClave(clave: string): { productoId: string; entregaId: string | null } {
  const i = clave.indexOf("#");
  return i < 0 ? { productoId: clave, entregaId: null } : { productoId: clave.slice(0, i), entregaId: clave.slice(i + 1) };
}

export interface EntregaResuelta {
  clave: string;
  producto: ProductoDeLaBiblioteca;
  /** «FIGURARTE» o «FIGURARTE · Muestras gratuitas»: para el asunto del correo y el registro. */
  nombre: string;
  pasos: SequenceStep[];
}

/** Las burbujas de una entrega por su clave, o null si el producto o la entrega ya no existen. */
export function laEntrega(config: WorkflowConfig | null, clave: string): EntregaResuelta | null {
  const { productoId, entregaId } = partirClave(clave);
  const p = config?.biblioteca_de_productos?.find((x) => x.id === productoId);
  if (!p) return null;
  if (!entregaId) return { clave, producto: p, nombre: p.name ?? productoId, pasos: p.delivery ?? [] };
  const e = (p.entregas_extra ?? []).find((x) => x.id === entregaId);
  if (!e) return null;
  return { clave, producto: p, nombre: `${p.name ?? productoId} · ${e.nombre?.trim() || entregaId}`, pasos: e.steps ?? [] };
}
