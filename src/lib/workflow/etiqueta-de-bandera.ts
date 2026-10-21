/**
 * LA ETIQUETA DE BANDERA — el escalón del país, en un solo sitio.
 *
 * Vivía copiado en tres lugares del motor —la intro, los seguimientos y los cajones de la
 * intro de order bump y del upsell— con un comentario en cada uno que decía «los tres tienen
 * que decidir IGUAL». Y la pizarra necesitaba un cuarto. Una regla en cuatro sitios es una
 * regla que va a decir cuatro cosas, así que vive aquí y la leen todos. NO IMPORTA NADA: la
 * carga también el navegador.
 *
 * ── LA REGLA, COMO HASTA EL 16/10/2026 ───────────────────────────────────
 *
 *     si NADIE lleva bandera             -> juegan todas (una instalación nueva no nace muda)
 *     si hay alguna con la del cliente   -> juegan SOLO ésas
 *     si no                              -> juegan las que llevan ALGUNA, aunque sea de otro
 *                                           país  ← EL RESPALDO
 *
 * El respaldo lo puso una prueba suya del 02/10: «un cliente sin intro es una venta perdida
 * segura, mucho peor que una intro que no era para él».
 *
 * ── EL INTERRUPTOR, DESDE EL 16/10/2026 ──────────────────────────────────
 *
 * Ese día decidió que, para él, ya no es así, y explicó por qué con su caso: «si yo tengo una
 * intro de Perú y tiene unas condiciones al final de la intro, esa no me serviría para
 * Argentina, por lo tanto respaldar en Argentina lo de Perú… sería ilógico». Y pidió que no se
 * quitara a ciegas: «hazlo mejor con un switch… usar respaldo, y si está apagado que funcione
 * como tú dices».
 *
 * Así que el respaldo es ahora `respaldo_entre_paises`:
 *   · AUSENTE O true — exactamente lo de antes. Ninguna instalación cambia sin que la toquen.
 *   · false          — el tercer escalón devuelve NADA, y `faltaLaSuya` lo dice. Qué hace cada
 *                      sitio con eso lo decide él mismo (pasar a humano, no agendar, seguir con
 *                      el regalo), porque la consecuencia no es la misma en una intro que en un
 *                      seguimiento.
 */

/** ¿Este bot respalda con piezas de otro país? Ausente = sí, como siempre. */
export function usaRespaldoEntrePaises(
  config: { respaldo_entre_paises?: boolean | null } | null | undefined
): boolean {
  return config?.respaldo_entre_paises !== false;
}

export interface PorBandera<T> {
  /** Las que juegan para este cliente. */
  jugadas: T[];
  /** Hay banderas puestas y NINGUNA es la del cliente. Con respaldo, `jugadas` trae las de
   *  otro país; sin respaldo, viene vacía. */
  faltaLaSuya: boolean;
}

export function porBanderaDelCliente<T>(
  candidatos: T[],
  banderasDe: (candidato: T) => string[],
  paisDelCliente: string | null | undefined,
  conRespaldo: boolean
): PorBandera<T> {
  const pais = String(paisDelCliente ?? "").trim().toUpperCase();
  const conBandera = candidatos.filter((c) => banderasDe(c).length > 0);
  if (conBandera.length === 0) return { jugadas: candidatos, faltaLaSuya: false };
  const suyas = candidatos.filter((c) => !!pais && banderasDe(c).includes(pais));
  if (suyas.length > 0) return { jugadas: suyas, faltaLaSuya: false };
  return { jugadas: conRespaldo ? conBandera : [], faltaLaSuya: true };
}
