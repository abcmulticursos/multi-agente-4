import { getMetaRuntimeSetting, permisoDeLaCuentaDeFacebook } from "@/lib/db";
import { conMemoriaDeMeta } from "@/lib/meta/connect";
import { cuentasDeFacebookConectadas } from "@/lib/meta/cuentas-de-facebook";
import { procesarPermisoDeFacebook, type PaginaSinAcceso } from "@/lib/meta/procesar-permiso";
import { olvidar } from "@/lib/meta/recuerdo";
import { anotarFalloDeMeta } from "@/lib/meta/registro";

/**
 * «↻ ACTUALIZAR» SIN VOLVER A FACEBOOK (13/11/2026). Él: «¿hay alguna manera de actualizar el contenido sin
 * reloguear?». Con el permiso que ya guardó el último inicio de sesión de cada cuenta, se hace lo MISMO que al
 * iniciar sesión (`procesarPermisoDeFacebook`): las anexadas primero y la principal al final, para que en lo que
 * comparten quede el permiso de la principal, como cuando él entra con ella.
 *
 * Lo que no puede: ver una página que la cuenta no tiene asignada, o que no marcó al iniciar sesión («Editar
 * acceso»): eso lo decide Meta y hay que volver a entrar. Y si el permiso venció (unos 60 días), lo dice.
 */
export type ResultadoDeCuenta = {
  clave: string;
  nombre: string | null;
  principal: boolean;
  ok: boolean;
  error?: string;
  paginas?: number;
  numeros?: number;
  sinAcceso?: PaginaSinAcceso[];
  numerosVistos?: string[];
  paginasVistas?: string[];
};

/** Meta no acepta el permiso (vencido, retirado o inválido). */
const PERMISO_RECHAZADO = /session has expired|validating access token|session has been invalidated|invalid oauth access token|code.?190/i;
const enPalabras = (err: unknown): string => {
  const m = err instanceof Error ? err.message : String(err);
  if (PERMISO_RECHAZADO.test(m)) return "Su permiso venció o fue retirado: vuelve a entrar con esta cuenta en «Iniciar sesión con Facebook».";
  return m || "Meta no respondió.";
};

export async function actualizarCuentas(excepto?: { id: string | null; nombre: string | null }): Promise<ResultadoDeCuenta[]> {
  const lista = cuentasDeFacebookConectadas();
  const esLaExcluida = (c: { id: string | null; nombre: string | null }) =>
    !!excepto && (excepto.id ? c.id === excepto.id : !c.id && c.nombre === excepto.nombre);
  type Turno = { clave: string; id: string | null; nombre: string | null; principal: boolean };
  const turnos: Turno[] = lista
    .filter((c) => !esLaExcluida(c))
    .map((c) => ({ clave: c.id ?? c.nombre ?? "?", id: c.id, nombre: c.nombre, principal: c.origen === "principal" }));
  // Instalaciones de antes de la lista: solo está el permiso de siempre.
  if (!turnos.some((t) => t.principal) && getMetaRuntimeSetting("meta_user_token") && !excepto)
    turnos.push({ clave: "principal", id: null, nombre: getMetaRuntimeSetting("meta_user_nombre"), principal: true });
  // Las anexadas primero; la principal, al final.
  turnos.sort((a, b) => Number(a.principal) - Number(b.principal));

  const resultados: ResultadoDeCuenta[] = [];
  for (const t of turnos) {
    const token = t.principal ? getMetaRuntimeSetting("meta_user_token") ?? permisoDeLaCuentaDeFacebook(t.id, t.nombre) : permisoDeLaCuentaDeFacebook(t.id, t.nombre);
    if (!token) {
      resultados.push({ clave: t.clave, nombre: t.nombre, principal: t.principal, ok: false, error: "No tengo su permiso guardado: vuelve a entrar con esta cuenta." });
      continue;
    }
    olvidar();
    try {
      const r = await conMemoriaDeMeta(async () => {
        const opciones = { nuevaCuenta: !t.principal, conservarInstagram: true, etiqueta: "Actualizar desde Meta Connect (bien)" };
        try {
          return await procesarPermisoDeFacebook(token, { ...opciones, includeInstagram: true });
        } catch (err) {
          // Sin permiso de Instagram, Meta rechaza la pregunta con Instagram: se repite sin él (y su Instagram se conserva).
          if (PERMISO_RECHAZADO.test(err instanceof Error ? err.message : String(err))) throw err;
          return await procesarPermisoDeFacebook(token, { ...opciones, includeInstagram: false });
        }
      });
      resultados.push({
        clave: t.clave,
        nombre: r.quien?.nombre ?? t.nombre,
        principal: t.principal,
        ok: true,
        paginas: r.paginas,
        numeros: r.numeros,
        sinAcceso: r.sinAcceso,
        numerosVistos: r.numerosVistos,
        paginasVistas: r.paginasVistas,
      });
    } catch (err) {
      const error = enPalabras(err);
      anotarFalloDeMeta("Actualizar desde Meta Connect", `${t.nombre ?? "Cuenta sin nombre"}: ${error}`);
      resultados.push({ clave: t.clave, nombre: t.nombre, principal: t.principal, ok: false, error });
    }
  }
  olvidar();
  return resultados;
}
