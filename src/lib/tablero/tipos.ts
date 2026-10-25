/**
 * EL TABLERO — el segundo motor, la ruta que arma el dueño con fichas y cables.
 *
 * Lo pidió Alberto el 22/10/2026 («no quiero que mi bot sea una tubería soldada… sino ser
 * armable, en base a decisiones, botones, elecciones»). Vive SOLO en ALBERTO 4. Ver
 * PLAN-TABLERO.md.
 *
 * A diferencia de la pizarra (que solo DIBUJA lo que ya está en el editor), aquí los cables SON
 * las órdenes: el bot lee este tablero y sigue el cable de la salida que toca.
 *
 * Se guarda en el contenido como `tableros: { <tiendaId>: Tablero }` y, los que no son de
 * ninguna tienda, como `workflows: { <id>: Tablero }` (arrancan solo cuando algo los activa).
 */
import type { SequenceStep } from "@/lib/workflow/config";

export type TipoDeFicha =
  | "inicio"
  | "mensaje"
  | "seguimientos"
  | "intro_ob"
  | "entregar"
  | "cobro"
  | "condicion"
  | "reparto"
  | "esperar"
  | "workflow"
  | "regalo"
  | "humano"
  | "correo";

/** Un tramo de monto del cobro abierto: «pagó entre `desde` y `hasta`». Montos de UN país. */
export interface TramoDeCobro {
  id: string;
  desde: number;
  /** Sin tope = de `desde` en adelante. */
  hasta?: number;
}

export interface CobroDeLaFicha {
  /**
   * «producto»: cobra el precio de un producto de la biblioteca, por país.
   * «abierto»: acepta cualquier monto desde un mínimo, y cada tramo tiene su salida.
   */
  modo: "producto" | "abierto";
  producto_id?: string;
  /**
   * EL CLIENTE PUEDE PAGAR OTRO DE ESTOS (como en la venta de siempre): si paga el precio de uno
   * más caro se le entrega ese; si paga el de uno más barato se le pregunta si fue un error o si
   * prefiere ese. Cada uno sale por su propio cable («prod:<id>»).
   */
  acepta?: string[];
  /**
   * Qué precio: «normal», «oferta» o «etapa» (el de oferta solo si un seguimiento con «activa
   * el precio de oferta» ya salió). Ausente = «etapa», como la venta de siempre.
   */
  precio?: "normal" | "oferta" | "etapa";
  /** Por país (PE, MX…): el mínimo del pago abierto. Montos y monedas distintos por país. */
  minimo_por_pais?: Record<string, number>;
  /** Por país: los tramos del pago abierto. */
  tramos_por_pais?: Record<string, TramoDeCobro[]>;
  /**
   * PREGUNTAR EL MÉTODO Y MANDAR SUS DATOS SOLO (23/10/2026), como la venta de siempre: sus
   * burbujas preguntan el método; si el cliente ya lo eligió antes, no se le pregunta y le llegan
   * los datos de ese método (los de «Métodos de pago» de su país) con el precio de lo que eligió.
   * Si cambia de método o de producto mientras el cobro sigue abierto, le llegan los nuevos.
   */
  metodos?: boolean;
  /**
   * NO VOLVER A PREGUNTAR EL MÉTODO AL LLEGAR (25/10/2026): el mensaje de antes ya lo preguntó (como
   * las intros de la pizarra que terminan en «¿con qué método pagas?»). El cobro se abre en silencio
   * y espera: al nombrar el método le llegan sus datos, igual que con `metodos`.
   */
  sin_preguntar?: boolean;
  /**
   * EL UPGRADE: si ya compró uno más barato de los de este cobro, se cobra solo la diferencia.
   */
  diferencia?: boolean;
}

export interface CondicionDeLaFicha {
  /** compro: ya compró ese producto · pais: es de alguno de esos países · anuncio: vino de un
   *  anuncio (de cualquiera, o de alguno de `anuncios`). */
  tipo: "compro" | "pais" | "anuncio";
  producto_id?: string;
  paises?: string[];
  /** Las claves del registro de anuncios (Ajustes → anuncios). Vacío = cualquier anuncio. */
  anuncios?: string[];
}

/** Una versión de un mensaje, con su peso en el sorteo (como las intros y seguimientos de hoy). */
export interface VarianteDeFicha {
  id: string;
  nombre?: string;
  /** Ausente = 1. 0 = apagada. */
  peso?: number;
  steps?: SequenceStep[];
  /**
   * SUS ANUNCIOS (24/10/2026), como las etiquetas de AD de la pizarra: claves del registro de
   * anuncios. Con la misma regla que la venta de siempre: en la intro de order bump, quien llega por
   * uno de esos anuncios recibe ésta y el resto se sortea entre todas; en un seguimiento, la del
   * anuncio es solo para él y el resto se sortea entre las que no tienen anuncio.
   */
  anuncios?: string[];
  /** false = las etiquetas están pero no dirigen (el interruptor «Etiquetas de AD» apagado). */
  dirigir?: boolean;
}

/** Uno de los seguimientos de la caja «Seguimientos». */
export interface SeguimientoDeLaFicha {
  id: string;
  /** Minutos desde el ÚLTIMO mensaje del cliente (si escribe, el reloj vuelve a empezar). */
  minutos: number;
  variantes: VarianteDeFicha[];
  /** Desde que sale, los cobros «según la etapa» cobran el precio de oferta. */
  activa_oferta?: boolean;
  /** Sale aunque caiga en las horas de silencio (como «ignorar horario de silencio» de siempre). */
  ignora_silencio?: boolean;
  /** No se aplaza al día siguiente aunque el cliente haya llegado tarde («lead tardío»). */
  ignora_tardio?: boolean;
}

/** Una salida del reparto por peso. */
export interface OpcionDeReparto {
  id: string;
  nombre?: string;
  peso: number;
}

export interface FichaDelTablero {
  id: string;
  tipo: TipoDeFicha;
  titulo?: string;
  x: number;
  y: number;
  /**
   * INICIO: su país (PE, MX…), como los carriles de la pizarra. Sin país = «Otros países»: el
   * que reciben los clientes de un país que no tiene su propio Inicio.
   */
  pais?: string;
  /** INICIO: «Vender en este país» apagado. Sus clientes no entran al tablero. */
  sin_venta?: boolean;
  /** INICIO: «En revisión»: no recibe clientes, pero se ve normal. Solo para él. */
  en_revision?: boolean;
  /** Apagada: no manda nada y el cliente sigue por su «→». Se ve tenue, en su sitio. */
  apagada?: boolean;
  /** Guardada en «Fichas guardadas»: fuera del lienzo. El bot no lo mira. */
  guardada?: boolean;
  /** Mensaje y cobro: sus burbujas, con sus botones y cuadritos (mismo cajón que la intro). */
  steps?: SequenceStep[];
  /** Intro de order bump: sus versiones con peso. */
  variantes?: VarianteDeFicha[];
  /** La caja «Seguimientos». */
  seguimientos?: SeguimientoDeLaFicha[];
  /** Reparto por peso. */
  reparto?: OpcionDeReparto[];
  /** Mensaje e intro de order bump: «no respondió en X minutos» → su salida `sin_respuesta`. */
  sin_respuesta_min?: number;
  /** Cobro: «no pagó en X minutos» → su salida `sin_pago`. Se cuenta desde su último mensaje. */
  sin_pago_min?: number;
  /** Entregar: qué producto de la biblioteca. */
  producto_id?: string;
  /**
   * Entregar: QUÉ ENTREGAS manda, en orden (25/10/2026). Cada una es «producto» (su entrega principal)
   * o «producto#entrega» (una de sus entregas extra); se pueden mezclar de varios productos. Sin esta
   * lista vale `producto_id` (su entrega principal), como antes.
   */
  entregas?: string[];
  cobro?: CobroDeLaFicha;
  condicion?: CondicionDeLaFicha;
  /** Esperar: cuántos minutos. */
  minutos?: number;
  /** Ficha «Workflow»: a cuál lleva. */
  workflow_id?: string;
  /**
   * LOS PRODUCTOS QUE PRESENTA (mensaje, intro de order bump, seguimientos). La IA del tablero solo
   * habla de un producto cuando ya se le presentó al cliente: así el oculto sigue oculto hasta su
   * intro. El cobro presenta los suyos y «Entregar» el que entrega.
   */
  presenta?: string[];
  /** Ficha «Pedir correo y enviar»: el asunto y el texto del correo. {{MATERIAL}} = lo que recibió. */
  correo_asunto?: string;
  correo_texto?: string;
  /**
   * EL CEREBRO DE ESTA ETAPA (24/10/2026): lo que la IA debe tener en cuenta SOLO mientras el
   * cliente está en esta ficha. Opcional: vacía, la IA usa el cerebro general del tablero.
   */
  instrucciones?: string;
  /**
   * ENTREGAR: «📧 Ofrecer también por correo». Tras entregar pregunta con botones si lo quiere por
   * correo; si dice que sí, pide su dirección (si no la dio antes) y le manda los enlaces. La ruta
   * sigue sin esperar. Los textos son suyos; vacíos, los de fábrica.
   */
  por_correo?: boolean;
  correo_pregunta?: string;
  correo_si?: string;
  correo_no?: string;
  correo_pide?: string;
}

export interface CableDelTablero {
  id: string;
  /** Ficha de la que sale. */
  de: string;
  /** Qué salida de esa ficha (ver `salidasDeLaFicha`). */
  salida: string;
  /** Ficha a la que llega. */
  a: string;
}

export interface Tablero {
  /** Apagado = la tienda vende con el motor de siempre aunque tenga fichas. (Un workflow no
   *  necesita encenderse: arranca cuando algo lo activa.) */
  encendido: boolean;
  /** Solo los workflows: su nombre. */
  nombre?: string;
  /**
   * EL CEREBRO GENERAL (24/10/2026): quién es y cómo habla la IA en todo este tablero. Vacío = el de
   * fábrica. Las reglas que protegen el dinero (nunca números de cuenta ni montos ajenos) no viven
   * aquí: van siempre, en el código, y no se pueden borrar sin querer.
   */
  cerebro?: string;
  fichas: FichaDelTablero[];
  cables: CableDelTablero[];
  /** Los cables que él curvó a mano (como en la pizarra): por id de cable. Solo pantalla. */
  curvas?: Record<string, { x: number; y: number }>;
  /** Las cajas que él dibuja detrás de las fichas, como en la pizarra. Solo pantalla. */
  cajas?: Array<{
    id: string;
    x: number;
    y: number;
    ancho: number;
    alto: number;
    titulo: string;
    color?: string;
    /**
     * LA MANTA DE UN PAÍS (24/10/2026): esta caja es el fondo del Inicio con este id. «La manta no
     * debe ser automatizada, la controlo yo desde las esquinas», como en la pizarra. Lleva su
     * bandera y «▶ Ver recorrido». Solo pantalla: el bot no la lee.
     */
    inicio?: string;
  }>;
}

/** Los canales: un tablero por canal, como la sección Canales. */
export type CanalDelTablero = "whatsapp" | "messenger" | "instagram";
export const CANALES_DEL_TABLERO: CanalDelTablero[] = ["whatsapp", "messenger", "instagram"];

/** Los tableros de UNA tienda, uno por canal. */
export type TablerosDeLaTienda = Partial<Record<CanalDelTablero, Tablero>>;

/** Una salida de una ficha: su clave y cómo se le llama en pantalla. */
export interface SalidaDeFicha {
  clave: string;
  etiqueta: string;
}
