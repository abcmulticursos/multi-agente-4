/**
 * LOS CAMINOS (18/10/2026): «cada camino tiene su propia ruta pero el final es el mismo… yo fijo
 * el camino y dónde tiene que conectar cada uno, es como si se duplicara y se abre otro camino».
 *
 * QUÉ ES: una etiqueta en las intros, los seguimientos y las intros de order bump —el resto (pago,
 * entrega, upsell, regalo) es el final compartido y no lleva camino—. Cada ficha es de UN camino
 * (`camino`; vacío = el principal) y puede ser TAMBIÉN de otros (`tambien_en_caminos`): así un
 * camino se une a una ficha de otro donde él conecta.
 *
 * QUÉ CAMBIA EN EL BOT: hasta hoy cada paso se sorteaba por su cuenta, así que un cliente podía
 * recibir la intro B y el seguimiento 1 A. Ahora, cuando recibe su intro, la conversación anota
 * el camino de esa intro (`conversations.camino`), y en los pasos siguientes juegan SOLO las
 * fichas de su camino.
 *
 * SIN REEMPLAZOS (18/10/2026): «yo no necesito reemplazos, si no hay conexión yo lo veo… no se
 * conecta y punto, es como si se trabara». Si su camino no tiene ficha en un paso, ese cliente no
 * recibe nada en ese paso. Lo decide él con sus cables, y la pizarra marca dónde termina cada uno.
 *
 * SIN NINGUNA FICHA CON CAMINO NO CAMBIA NADA: se devuelve LA MISMA lista, sin copiarla, y el
 * sorteo de siempre decide igual que antes. Es la garantía de que esto no toca ningún bot que no
 * lo use.
 */

/** El camino escrito, limpio: letras, números y espacios, en mayúsculas. Vacío = principal. */
export function leeCamino(valor: unknown): string {
  return String(valor ?? "")
    .normalize("NFC")
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase()
    .slice(0, 24);
}

/** Así se escribe el principal dentro de `tambien_en_caminos` (vacío no se puede listar). */
export const PRINCIPAL = "PRINCIPAL";

/** Los «también» limpios: cada uno un camino, o PRINCIPAL. Sin repetidos. */
export function leeTambienEnCaminos(valor: unknown): string[] {
  if (!Array.isArray(valor)) return [];
  return [...new Set(valor.map((x) => leeCamino(x)).filter(Boolean))];
}

/** El camino propio de una ficha. Vacío = el principal. */
export function caminoDe(pieza: { camino?: unknown } | null | undefined): string {
  return leeCamino(pieza?.camino);
}

/** TODOS los caminos de una ficha: el suyo y los «también». "" = el principal. */
export function caminosDe(pieza: { camino?: unknown; tambien_en_caminos?: unknown } | null | undefined): string[] {
  const suyos = [caminoDe(pieza), ...leeTambienEnCaminos(pieza?.tambien_en_caminos).map((c) => (c === PRINCIPAL ? "" : c))];
  return [...new Set(suyos)];
}

/**
 * LOS QUE JUEGAN PARA ESTE CLIENTE: los de su camino, y nada más (sin reemplazos).
 *
 * Un cliente del PRINCIPAL en un paso donde todas son del principal recibe LA MISMA lista: así es
 * todo bot sin caminos, y no cambia nada. Un cliente de un CAMINO solo recibe las de su camino,
 * aunque en ese paso no haya ninguna con camino —ahí su camino termina—. (18/10/2026: con el
 * atajo mirando solo el paso, el cliente B recibía el seguimiento 2 del principal.)
 */
export function porCamino<T>(candidatos: T[], susCaminos: (candidato: T) => string[], delCliente: string | null | undefined): T[] {
  const elSuyo = leeCamino(delCliente);
  if (!elSuyo && candidatos.every((c) => { const cs = susCaminos(c); return cs.length === 1 && cs[0] === ""; })) return candidatos;
  return candidatos.filter((c) => susCaminos(c).includes(elSuyo));
}
