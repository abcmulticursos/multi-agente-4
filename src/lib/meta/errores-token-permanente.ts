/**
 * Qué hacer cuando Meta no deja generar el token permanente.
 *
 * Meta contesta un mensaje por cada negocio y usuario del sistema que se
 * intenta. Leídos en bruto no dicen qué hacer; pero juntos sí, porque el que
 * NO falla por "la app no pertenece a este negocio" delata cuál es el negocio
 * dueño de la app — que es el único donde se puede generar.
 *
 * Vive fuera de la ruta para poder probarlo sin llamar a Meta.
 */

export interface IntentoDeToken {
  negocio: string;
  usuario: string | null;
  mensaje: string;
}

export interface SugerenciaDeToken {
  quePasa: string;
  queHacer: string;
  /** El negocio al que hay que ir, cuando se puede deducir. */
  negocio?: string;
}

/** "La app no está en este negocio" — el rechazo más común. */
function esAppFueraDelNegocio(mensaje: string): boolean {
  return /3953|does not belong to the business/i.test(mensaje);
}

function esSinUsuarios(mensaje: string): boolean {
  return /no tiene ning[úu]n usuario del sistema/i.test(mensaje);
}

export function sugerenciaTokenPermanente(
  intentos: IntentoDeToken[]
): SugerenciaDeToken | null {
  if (!intentos.length) return null;

  // El negocio dueño de la app es aquel cuyo fallo NO es "la app no pertenece
  // aquí": ahí la app sí pasó esa comprobación y se atascó más adelante.
  const prometedor = intentos.find(
    (intento) =>
      intento.usuario &&
      !esAppFueraDelNegocio(intento.mensaje) &&
      !esSinUsuarios(intento.mensaje)
  );

  if (prometedor) {
    return {
      negocio: prometedor.negocio,
      quePasa: `La app sí pertenece a «${prometedor.negocio}», pero Meta no completó la generación. Lo que falta casi siempre es que la app no esté asignada al usuario del sistema.`,
      queHacer: `Entra a «${prometedor.negocio}» → Configuración del negocio → Usuarios → Usuarios del sistema → elige «${prometedor.usuario}» → «Agregar activos» → Apps → marca tu app con control total. Después vuelve a pulsar el botón.`,
    };
  }

  if (intentos.every((intento) => esAppFueraDelNegocio(intento.mensaje) || esSinUsuarios(intento.mensaje))) {
    const sinUsuarios = intentos.filter((intento) => esSinUsuarios(intento.mensaje));
    if (sinUsuarios.length === intentos.length) {
      return {
        quePasa:
          "Ninguno de tus negocios tiene un usuario del sistema, y el token permanente se genera con uno.",
        queHacer:
          "En el negocio dueño de la app: Configuración del negocio → Usuarios → Usuarios del sistema → «Agregar». Dale rol de administrador, asígnale la app, y vuelve a pulsar el botón.",
      };
    }
    return {
      quePasa:
        "Tu app no pertenece a ninguno de los negocios que este login puede ver. El token permanente solo se puede generar en el negocio DUEÑO de la app.",
      queHacer:
        "Averigua en qué negocio está tu app (aparece arriba, en «App configurada»). Si no está en ninguno, agrégala: Configuración del negocio → Cuentas → Apps → «Agregar». Y comprueba que estés conectado con una cuenta que sea administradora de ese negocio.",
    };
  }

  return null;
}
