/**
 * LA ETIQUETA DE SEMIMODALIDAD, EN UN SITIO QUE TAMBIÉN VE LA PANTALLA.
 *
 * Esta regla vivía dentro de `config.ts` y el editor no podía leerla: ese archivo arrastra la
 * base de datos, y la pantalla corre en el navegador. Así que el visor de recorrido enseñaba
 * las intros y los seguimientos de LAS TRES semimodalidades a la vez.
 *
 * LO QUE ESO PROVOCABA, Y LO VIO EL DUEÑO el 06/10/2026: «todas las semimodalidades están
 * dentro del mismo y causa confusión, y esa confusión ocasiona que aparezcan el mismo
 * producto en los 2 comodines». Con tres recorridos apilados, los comodines de la vista previa
 * se resolvían contra un montón que no es el de nadie.
 *
 * Se saca aquí por el MISMO motivo y con el mismo molde que `etiqueta-de-tienda.ts`: para que
 * el motor y la pantalla usen LA MISMA regla y el visor no pueda desmentir al bot. `config.ts`
 * la reexporta, así que quien ya leía de allí sigue leyendo de un solo sitio.
 *
 * NO IMPORTA NADA: es la condición para que el navegador la pueda cargar.
 */

/** LAS TRES FORMAS DE VENDER DENTRO DE LINEAL, con las palabras del dueño: COMOHOY, COMO DOU
 *  y COMO OB. Él las llama SEMIMODALIDADES, para no confundirlas con las MODALIDADES. */
export type Semimodalidad = "lineal" | "dou" | "ob";

/** La etiqueta escrita en una pieza, o null si no tiene. Se acepta lo que el editor guarde en
 *  cualquier mayúscula y con espacios de sobra. */
export function semimodalidadDe(pieza: {
  semimodalidad?: string | null;
}): Semimodalidad | null {
  const v = String(pieza?.semimodalidad ?? "").trim().toLowerCase();
  return v === "lineal" || v === "dou" || v === "ob" ? v : null;
}

/**
 * CÓMO SE LLAMA LA SEMIMODALIDAD DE UNA TIENDA.
 *
 * La tienda guarda el selector con los nombres del motor —`dos_juntas`, `segunda_oculta`— y
 * las etiquetas de los cajones usan los cortos. Traducir aquí evita que cada pantalla se
 * invente su propia tabla, que es como se acaba teniendo dos que no coinciden.
 *
 * VACÍO ES UNA RESPUESTA, no un hueco: esta tienda vende «como hoy».
 */
export function laSemimodalidadDeLaTienda(tienda: {
  semimodalidad?: string | null;
}): Semimodalidad {
  const v = String(tienda?.semimodalidad ?? "").trim().toLowerCase();
  if (v === "dos_juntas") return "dou";
  if (v === "segunda_oculta") return "ob";
  return "lineal";
}

/**
 * EL FILTRO POR SEMIMODALIDAD, CON RED DE SEGURIDAD.
 *
 * LO PIDIÓ EL DUEÑO el 30/09/2026: «si todas las burbujas están encendidas y etiquetadas de
 * diferente manera, debe lanzarse solo la que tiene la etiqueta; así las otras estén
 * encendidas pero la modalidad no corresponde, no debería salir».
 *
 * Y ELIGIÓ LA RED (su «opción B») sabiendo lo que evita. Es el MISMO molde que la bandera del
 * país y el del anuncio:
 *
 *     las etiquetadas con la semimodalidad de hoy  -> si hay alguna, juegan SOLO ésas
 *     las que no llevan etiqueta                   -> si no hay ninguna, juegan éstas
 *
 * POR QUÉ NO «solo lo etiquetado, y punto». Ya costó una vez, con la bandera: con TODOS los
 * cajones etiquetados y un cliente sin cajón para él, el sorteo devolvía null — y un cliente
 * sin intro es una venta perdida segura. La etiqueta dirige; nunca deja a nadie fuera.
 *
 * SIN ETIQUETAS PUESTAS NO CAMBIA NADA: todas quedan generales, se devuelve la lista entera y
 * quien llame sigue decidiendo como hasta hoy.
 */
export function porSemimodalidad<T>(
  candidatos: T[],
  etiquetaDe: (candidato: T) => Semimodalidad | null,
  activa: Semimodalidad
): T[] {
  const suyas = candidatos.filter((c) => etiquetaDe(c) === activa);
  if (suyas.length > 0) return suyas;
  const generales = candidatos.filter((c) => etiquetaDe(c) === null);
  return generales.length > 0 ? generales : candidatos;
}
