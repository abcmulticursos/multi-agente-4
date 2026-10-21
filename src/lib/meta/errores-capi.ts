/**
 * Qué significa, en cristiano, el error que devolvió Meta al mandar un evento.
 *
 * Meta contesta con un mensaje técnico y a veces con un subcódigo. Ese texto
 * dice QUÉ pasó pero casi nunca QUÉ HACER, y es justo lo que hace falta cuando
 * ves el aviso rojo en un chat.
 *
 * Vive fuera de los componentes para poder probarlo sin React.
 */

export interface ExplicacionDeError {
  /** Una línea: qué está mal. */
  quePasa: string;
  /** Qué hacer para arreglarlo. */
  queHacer: string;
}

/**
 * Subcódigos que Meta documenta o que ya vimos en este bot. El texto crudo se
 * muestra siempre igual: esto es un añadido, no un reemplazo.
 */
const POR_SUBCODIGO: Record<string, ExplicacionDeError> = {
  "2804071": {
    quePasa:
      "El evento salió sin el identificador del click del anuncio (ctwa_clid), y Meta lo exige para eventos de mensajería.",
    queHacer:
      "Suele pasar cuando la conversación no vino de un anuncio. Si esta sí venía de uno, revisa que el anuncio sea de clic a WhatsApp y que el webhook esté recibiendo el bloque de referencia.",
  },
  "2804132": {
    quePasa:
      "El dataset no tiene asociada la cuenta de WhatsApp (WABA). Meta no sabe a qué negocio pertenece la conversación.",
    queHacer:
      "En el Administrador de eventos, abre el dataset y vincúlale tu cuenta de WhatsApp. Es la conexión que falta más a menudo.",
  },
  "2804069": {
    quePasa:
      "Falta el identificador de la página de Facebook vinculada a la WABA.",
    queHacer:
      "Comprueba en Meta Connect que hay una página activa y que esa página es la que está vinculada a tu cuenta de WhatsApp.",
  },
  "2804066": {
    quePasa:
      "Meta no admite ese tipo de evento para conversaciones de mensajería.",
    queHacer:
      "Es un fallo de configuración del bot, no tuyo. Avísalo para revisarlo.",
  },
};

/** Errores que no traen subcódigo pero se reconocen por el texto. */
const POR_TEXTO: Array<[RegExp, ExplicacionDeError]> = [
  [
    /missing permission|\(#100\)/i,
    {
      quePasa:
        "El token que se usó no tiene permiso sobre ese dataset.",
      queHacer:
        "En Meta Connect, en «Token que reporta las compras», prueba con «El de la conexión con Meta» y pulsa «Probar acceso».",
    },
  ],
  [
    /invalid oauth|expired|session has expired|token/i,
    {
      quePasa: "El token caducó o dejó de ser válido.",
      queHacer:
        "Vuelve a conectar con Meta en Meta Connect. Al reconectar se guarda un token nuevo.",
    },
  ],
  [
    /unsupported (get|post) request|does not exist/i,
    {
      quePasa:
        "Meta dice que ese dataset no existe o que este token no lo alcanza.",
      queHacer:
        "Comprueba en Meta Connect que el pixel elegido es el correcto y que pertenece a un negocio al que llegas.",
    },
  ],
];

/** Saca el subcódigo del cuerpo que devolvió Meta, si lo trae. */
export function subcodigoDe(textoDeMeta: string | null | undefined): string | null {
  if (!textoDeMeta) return null;
  const porJson = /"error_subcode"\s*:\s*(\d+)/.exec(textoDeMeta);
  if (porJson) return porJson[1];
  const porTexto = /subcode\D{0,4}(\d{6,})/i.exec(textoDeMeta);
  return porTexto ? porTexto[1] : null;
}

/**
 * La explicación de un error, o null si no lo reconocemos. Devolver null es a
 * propósito: preferimos no explicar antes que inventar una causa.
 */
export function explicarErrorCapi(
  textoDeMeta: string | null | undefined
): ExplicacionDeError | null {
  if (!textoDeMeta) return null;
  const subcodigo = subcodigoDe(textoDeMeta);
  if (subcodigo && POR_SUBCODIGO[subcodigo]) return POR_SUBCODIGO[subcodigo];
  for (const [patron, explicacion] of POR_TEXTO) {
    if (patron.test(textoDeMeta)) return explicacion;
  }
  return null;
}
