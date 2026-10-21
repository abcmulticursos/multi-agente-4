/**
 * Qué le falta a un país para vender de verdad.
 *
 * Encender "Vender en este país" habilita el país, pero no llena sus datos. Y
 * los dos huecos que quedan no se ven en pantalla:
 *
 *  - Sin precio propio, el bot cotiza el precio global (el de Perú).
 *  - Sin métodos de pago propios, el país arranca con un texto SEMBRADO de
 *    muestra, y el cliente recibe literalmente
 *    "[Referencia 🇲🇽 Mexico] Escribe aqui los datos reales para SPEI...".
 *
 * Esto los detecta para que el editor avise mientras configuras, y no te
 * enteres cuando un cliente ya recibió el texto de muestra.
 *
 * Vive fuera del componente a propósito: así se puede probar sin React.
 */

/** Marca con la que se siembran los textos de muestra de cada país. */
export const MARCA_DE_REFERENCIA = "[referencia";

export interface PerfilDePaisRevisable {
  enabled?: boolean;
  course_price_soles?: number;
  payment_text?: string;
  payment_buttons?: Array<{ label?: string; method?: string }>;
  /**
   * Los pasos llegan con dos formas distintas: la del editor (`texts`) y la del
   * motor (`body` / `body_variants`). Se acepta cualquiera y se lee a mano, en
   * vez de atarse a un tipo concreto que dejaría fuera a la otra mitad.
   */
  payment_responses?: Record<string, unknown>;
  /**
   * Los cajones que se insertan con {{METODO_DE_PAGO_1/2/3}} y
   * {{METODO_DE_PAGO_PRINCIPAL}}. Vacíos no dan error: el comodín se sustituye
   * por nada y sale una burbuja en blanco donde iba el número de la cuenta.
   */
  metodo_pago_1?: string;
  metodo_pago_2?: string;
  metodo_pago_3?: string;
  metodo_pago_principal?: string;
}

export interface RevisionDePais {
  faltaElPrecio: boolean;
  /** Etiquetas de los métodos cuyo texto sigue siendo el de muestra. */
  metodosDeReferencia: string[];
  /** El texto que presenta los métodos sigue siendo el de muestra. */
  presentacionDeReferencia: boolean;
  /** Comodines de datos de pago que están vacíos en este país. */
  cajonesDePagoVacios: string[];
  /** Frases listas para mostrar. Vacío = el país está listo para vender. */
  avisos: string[];
}

/** ¿Este texto es todavía el de muestra que se sembró al crear el país? */
export function esTextoDeReferencia(texto: string | null | undefined): boolean {
  return (texto ?? "").trim().toLowerCase().includes(MARCA_DE_REFERENCIA);
}

/** Primer texto de un paso, venga en la forma del editor o en la del motor. */
function primerCuerpo(pasos: unknown): string {
  if (!Array.isArray(pasos)) return "";
  const paso: unknown = pasos[0];
  if (!paso || typeof paso !== "object") return "";
  const campos = paso as {
    texts?: unknown;
    body?: unknown;
    body_variants?: unknown;
  };
  const primeroDeLista = (lista: unknown): string =>
    Array.isArray(lista) && typeof lista[0] === "string" ? lista[0].trim() : "";
  const deEditor = primeroDeLista(campos.texts);
  if (deEditor) return deEditor;
  if (typeof campos.body === "string") return campos.body.trim();
  return primeroDeLista(campos.body_variants);
}

/**
 * Revisa un perfil de país. No mira si el país está encendido — eso lo decide
 * quien llama, porque un país apagado a medio llenar no molesta a nadie.
 */
export function revisarPais(
  perfil: PerfilDePaisRevisable | undefined,
  opciones?: {
    /**
     * ¿Está encendido el "pago directo"? Es el único que usa los cajones
     * {{METODO_DE_PAGO_1}} y {{METODO_DE_PAGO_PRINCIPAL}} de fábrica. Apagado,
     * un país puede tenerlos vacíos toda la vida sin que pase nada, y avisar
     * de ellos sería un aviso que sale siempre — de esos que ya no se leen.
     */
    pagoDirectoEncendido?: boolean;
  }
): RevisionDePais {
  const precio = perfil?.course_price_soles;
  const faltaElPrecio = !(typeof precio === "number" && precio > 0);

  const etiquetaDe = (metodo: string): string =>
    perfil?.payment_buttons?.find((boton) => boton.method === metodo)?.label ??
    metodo;

  const metodosDeReferencia = Object.entries(perfil?.payment_responses ?? {})
    .filter(([, pasos]) => esTextoDeReferencia(primerCuerpo(pasos)))
    .map(([metodo]) => etiquetaDe(metodo));

  const presentacionDeReferencia = esTextoDeReferencia(perfil?.payment_text);

  // CAJONES DE PAGO VACÍOS.
  //
  // Pasó de verdad: una tienda con precio puesto y los cuatro cajones en
  // blanco. El cliente eligió, y en medio de los datos de pago le llegó una
  // burbuja vacía — el comodín se sustituye por nada. No hay error, no hay
  // aviso, y lo que falta es justo el número al que hay que pagar.
  // Solo se revisan estos dos: son los que usa el pago directo que ya viene
  // armado. El 2 y el 3 los pone el operador donde quiere, y vacíos suelen
  // significar "este país no los usa" — avisar de ellos sería ruido en casi
  // todos los países. Si aun así se usara uno vacío, el motor descarta la
  // burbuja y lo deja escrito en el registro.
  const cajonesDePagoVacios = !opciones?.pagoDirectoEncendido
    ? []
    : (
        [
          ["metodo_pago_principal", "{{METODO_DE_PAGO_PRINCIPAL}}"],
          ["metodo_pago_1", "{{METODO_DE_PAGO_1}}"],
        ] as const
      )
        .filter(([campo]) => !(perfil?.[campo] ?? "").trim())
        .map(([, comodin]) => comodin);

  const avisos: string[] = [];
  if (faltaElPrecio) {
    avisos.push(
      "Le falta el precio. Mientras tanto el bot le cobra el precio global."
    );
  }
  if (metodosDeReferencia.length) {
    avisos.push(
      `Sus métodos de pago siguen siendo el texto de muestra (${metodosDeReferencia.join(
        ", "
      )}). El cliente recibiría ese texto tal cual.`
    );
  }
  if (presentacionDeReferencia) {
    avisos.push(
      "El texto que presenta los métodos de pago sigue siendo el de muestra."
    );
  }
  if (cajonesDePagoVacios.length) {
    avisos.push(
      `Le faltan los datos de pago de ${cajonesDePagoVacios.join(
        ", "
      )}. Donde se use ese comodín, al cliente le llega una burbuja vacía en lugar de la cuenta.`
    );
  }

  return {
    faltaElPrecio,
    metodosDeReferencia,
    presentacionDeReferencia,
    cajonesDePagoVacios,
    avisos,
  };
}
