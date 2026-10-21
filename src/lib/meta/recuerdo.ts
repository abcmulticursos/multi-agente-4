/**
 * RECORDAR LO QUE CONTESTÓ META (21/10/2026).
 *
 * Meta Connect le preguntaba TODO a Meta cada vez que se abría: los BM, sus apps, sus usuarios del
 * sistema, sus números, qué app atiende cada uno. Con varios BM y unas cuantas recargas, Meta frenó
 * la app entera: «(#4) Application request limit reached». Y además tardaba.
 *
 * Esto guarda la respuesta en memoria del servidor por un rato y, si dos pantallas preguntan lo
 * mismo a la vez, hace UNA sola consulta. Lo que cambia algo en Meta (agregar, activar, suscribir,
 * crear el token) llama a `olvidar` para que lo siguiente se lea fresco.
 */
const guardado = new Map<string, { hasta: number; desde: number; valor: Promise<unknown> }>();

export function recordar<T>(clave: string, ms: number, leer: () => Promise<T>): Promise<T> {
  const ahora = Date.now();
  const hay = guardado.get(clave);
  if (hay && hay.hasta > ahora) return hay.valor as Promise<T>;
  const valor = leer();
  guardado.set(clave, { hasta: ahora + ms, desde: ahora, valor });
  // Un fallo no se recuerda: la próxima vez se vuelve a intentar.
  valor.catch(() => guardado.delete(clave));
  return valor;
}

/** Olvida todo lo que empiece por `prefijo` (sin prefijo, todo). */
export function olvidar(prefijo = ""): void {
  for (const clave of guardado.keys()) if (clave.startsWith(prefijo)) guardado.delete(clave);
}

/** Cuándo se leyó de Meta lo recordado con esa clave (ms), o null si no hay nada. */
export function cuandoSeLeyo(clave: string): number | null {
  const hay = guardado.get(clave);
  return hay && hay.hasta > Date.now() ? hay.desde : null;
}

export const MINUTOS = (n: number) => n * 60_000;

/** Lo que se recuerda de Meta Connect: media hora. Lo hecho desde Meta Connect se ve al instante. */
export const MEDIA_HORA = MINUTOS(30);
