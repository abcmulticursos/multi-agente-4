/**
 * EL FRENO DE SEGURIDAD CON META (21/10/2026).
 *
 * Meta frenó la app entera («(#4) Application request limit reached») porque Meta Connect le
 * preguntaba demasiado. Él: «necesito poder trabajar sin que pase esto».
 *
 * Meta dice en CADA respuesta cuánto del límite lleva la app (cabecera `x-app-usage`, en %).
 * Este freno lo lee y, al pasar del 80 %, deja de preguntar un rato y las pantallas usan lo que
 * ya recordaban. Si aun así Meta frena, se para una hora: seguir preguntando con el freno puesto
 * solo lo alarga (lo dice la documentación de Meta).
 *
 * Solo lo usan las consultas de Meta Connect. Los mensajes del bot NO pasan por aquí: tienen su
 * propio límite en Meta y no se frenan desde el CRM.
 */
const AVISO_PORCENTAJE = 80;
let frenadoHasta = 0;
let ultimoUso = 0;

export class MetaFrenada extends Error {
  constructor() {
    super("Meta está cerca de su límite de consultas. Espera unos minutos.");
    this.name = "MetaFrenada";
  }
}

/** ¿Está puesto el freno? */
export function metaFrenada(): boolean {
  return Date.now() < frenadoHasta;
}

/** Cuánto falta para soltarlo, en minutos (0 = suelto). */
export function minutosDeFreno(): number {
  return Math.max(0, Math.ceil((frenadoHasta - Date.now()) / 60_000));
}

/** El último porcentaje del límite que dijo Meta. */
export function usoDeMeta(): number {
  return ultimoUso;
}

/** Los códigos con los que Meta dice «frenada por muchas consultas». */
export function esFrenoDeMeta(codigo: unknown): boolean {
  return codigo === 4 || codigo === 17 || codigo === 32 || codigo === 613 || codigo === 80004;
}

/** Pone el freno a mano (p. ej. al ver un #4 en una respuesta ya leída). */
export function frenar(minutos: number): void {
  frenadoHasta = Math.max(frenadoHasta, Date.now() + minutos * 60_000);
}

/**
 * `fetch` a Meta con freno: si está puesto, no pregunta (lanza `MetaFrenada`); si no, pregunta,
 * lee cuánto lleva y frena si hace falta.
 */
export async function fetchMeta(url: URL | string, init?: RequestInit): Promise<Response> {
  if (metaFrenada()) throw new MetaFrenada();
  const res = await fetch(url, { cache: "no-store", ...init });
  try {
    const uso = res.headers.get("x-app-usage");
    if (uso) {
      const u = JSON.parse(uso) as { call_count?: number; total_cputime?: number; total_time?: number };
      ultimoUso = Math.max(u.call_count ?? 0, u.total_cputime ?? 0, u.total_time ?? 0);
      if (ultimoUso >= AVISO_PORCENTAJE) frenar(15);
    }
    if (!res.ok) {
      const cuerpo = (await res.clone().json().catch(() => null)) as { error?: { code?: number } } | null;
      if (esFrenoDeMeta(cuerpo?.error?.code)) frenar(60);
    }
  } catch {
    // Una cabecera rara no puede romper la consulta.
  }
  return res;
}
