// ─────────────────────────────────────────────────────────────────────────
// LA ETIQUETA DE TIENDA — la regla, en un solo sitio.
//
// POR QUÉ VIVE SUELTA Y NO EN `config.ts`. La pantalla del editor tiene que
// aplicar esta MISMA regla para avisar «esta tienda se quedaría sin ningún
// seguimiento», y `config.ts` arrastra la base de datos: no se puede importar
// desde el navegador.
//
// La alternativa era escribir la regla dos veces. En este proyecto eso ya salió
// caro: el visor de precios tenía su propia copia del formateador de moneda y se
// separó sin que nadie avisara —once diferencias, una de ellas costó una
// devolución—. Una regla que vive en dos archivos es una regla que va a decir dos
// cosas distintas.
//
// Así que la regla está aquí, sin dependencias, y la leen los dos:
//   · el motor, por `config.ts`, que la reexporta
//   · la pantalla, importando este archivo
// ─────────────────────────────────────────────────────────────────────────

/**
 * LAS FRASES DE ENTRADA DE UNA TIENDA, YA COMPARABLES (12/10/2026).
 *
 * Vive aquí por la misma razón que el resto de este archivo: el motor la usa para elegir la
 * tienda por el primer mensaje, y la pantalla para avisar de frases repetidas. Con una sola
 * regla, el aviso no puede decir una cosa y el bot hacer otra.
 *
 * Comparable = sin tildes, en minúsculas y con los signos convertidos en espacios: «Pack
 * Mascotas!» y «pack mascotas» son la misma frase.
 */
export function paraCompararFrase(texto: string | null | undefined): string {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ]+/g, " ")
    .trim();
}

export function frasesDeEntrada(tienda: { frases_de_entrada?: string[] | null } | null | undefined): string[] {
  return (Array.isArray(tienda?.frases_de_entrada) ? tienda!.frases_de_entrada! : [])
    .map((f) => paraCompararFrase(f))
    .filter(Boolean);
}

/** Las tiendas para las que se escribió esta pieza. Vacío = para todas. */
export function tiendasDe(pieza: { tiendas?: string[] | null }): string[] {
  return (pieza?.tiendas ?? [])
    .map((t) => String(t ?? "").trim())
    .filter(Boolean);
}

/**
 * EL FILTRO POR TIENDA — Y ES LA ÚNICA ETIQUETA QUE EXCLUYE.
 *
 * LO PIDIÓ EL DUEÑO el 30/09/2026, para vender con varios números: «en un solo
 * lugar, las intros, seguimientos, entregas etc, pero desde cualquier agente
 * individual o número individual yo poder seleccionarlos». Y con una condición
 * que repitió varias veces: «sin que se filtren cosas de un lado a otro».
 *
 * ── POR QUÉ NO LLEVA LA RED DE LAS OTRAS TRES ────────────────────────────
 *
 * La bandera, el anuncio y la semimodalidad DIRIGEN: prefieren lo etiquetado y,
 * si no hay nada para este cliente, dejan jugar a todos. Ahí la red es correcta
 * —un cliente sin intro es una venta perdida— y un texto general le sirve igual.
 *
 * LA TIENDA NO DIRIGE: AÍSLA. Un texto escrito para la tienda B nombra otros
 * productos, otros precios y otras cuentas de cobro. Mandárselo al cliente de la
 * tienda A no es «un reparto desequilibrado»: es la fuga que él pidió evitar, y
 * de las que cuestan una devolución.
 *
 * Así que aquí la regla es:
 *
 *     las escritas para ESTA tienda   -> si hay alguna, juegan SOLO ésas
 *     las que no llevan ninguna       -> si no, juegan éstas
 *     las de OTRA tienda              -> NUNCA, ni aunque no quede nada más
 *
 * ── QUÉ PASA SI NO QUEDA NINGUNA ─────────────────────────────────────────
 *
 * Se devuelve la lista vacía, y quien llama ya sabe qué hacer con eso: el sorteo
 * de intros cae en la secuencia de siempre y el seguimiento no se agenda. NO se
 * rellena con contenido de otra tienda. Y como el silencio también es un fallo,
 * la pantalla de Tiendas avisa cuando una se quedaría sin nada — el aviso va ahí,
 * donde se etiqueta, no aquí, donde ya es tarde.
 *
 * ── LA GARANTÍA ──────────────────────────────────────────────────────────
 *
 * SIN ETIQUETAS PUESTAS NO CAMBIA NADA: todas las piezas quedan generales, se
 * devuelve la lista entera y quien llama decide igual que siempre.
 */
export function soloDeSuTienda<T>(
  candidatos: T[],
  etiquetasDe: (candidato: T) => string[],
  laDeHoy: string | null
): T[] {
  const generales = candidatos.filter((c) => etiquetasDe(c).length === 0);
  // Sin tienda atendiendo —el número de siempre, o uno sin tienda creada— solo
  // juega lo general. Lo escrito para una tienda es de esa tienda: que no haya
  // ninguna atendiendo no lo convierte en contenido de todos.
  if (!laDeHoy) return generales;
  const suyas = candidatos.filter((c) => etiquetasDe(c).includes(laDeHoy));
  return suyas.length > 0 ? suyas : generales;
}

/**
 * ¿USA EL RESPALDO ENTRE TIENDAS? (17/10/2026)
 *
 * El escalón «las que no llevan ninguna» de `soloDeSuTienda` es un respaldo: a una tienda sin lo
 * suyo le sirve lo «de todas». Él lo pidió apagable, como el de países: «no podemos trabajar
 * "me olvidé la tienda, se agarra de la otra"… ¿y si agarra otro producto? ¿qué le llega al
 * cliente?». AUSENTE O true = COMO SIEMPRE. Solo `false` lo apaga.
 */
export function usaRespaldoEntreTiendas(config: { respaldo_entre_tiendas?: boolean } | null | undefined): boolean {
  return config?.respaldo_entre_tiendas !== false;
}

/**
 * ¿A ESTA TIENDA LE FALTA LO SUYO? Hay candidatos, hay tienda atendiendo, y ninguno la nombra.
 * Con el respaldo entre tiendas apagado, eso significa «aquí no sale nada»: quien llama decide
 * qué hacer (intro → humano, seguimiento → no se agenda, upsell → al regalo).
 */
export function aLaTiendaLeFaltaLoSuyo<T>(
  candidatos: T[],
  etiquetasDe: (candidato: T) => string[],
  laDeHoy: string | null
): boolean {
  return !!laDeHoy && candidatos.length > 0 && !candidatos.some((c) => etiquetasDe(c).includes(laDeHoy));
}

/**
 * ¿LE QUEDA ALGO A ESTA TIENDA? — para el aviso de la pantalla.
 *
 * Es la MISMA pregunta que se hace el motor, hecha con la MISMA función, para que
 * el aviso no pueda decir una cosa y el bot hacer otra. Si esto dijera «tiene
 * seguimientos» y el motor no encontrara ninguno, el aviso sería peor que no
 * tener aviso.
 */
export function leQuedaAlgo<T>(
  candidatos: T[],
  etiquetasDe: (candidato: T) => string[],
  tienda: string | null
): boolean {
  return soloDeSuTienda(candidatos, etiquetasDe, tienda).length > 0;
}
