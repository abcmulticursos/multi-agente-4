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
  | "humano";

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
}

/** Uno de los seguimientos de la caja «Seguimientos». */
export interface SeguimientoDeLaFicha {
  id: string;
  /** Minutos desde el ÚLTIMO mensaje del cliente (si escribe, el reloj vuelve a empezar). */
  minutos: number;
  variantes: VarianteDeFicha[];
  /** Desde que sale, los cobros «según la etapa» cobran el precio de oferta. */
  activa_oferta?: boolean;
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
  cobro?: CobroDeLaFicha;
  condicion?: CondicionDeLaFicha;
  /** Esperar: cuántos minutos. */
  minutos?: number;
  /** Ficha «Workflow»: a cuál lleva. */
  workflow_id?: string;
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
  fichas: FichaDelTablero[];
  cables: CableDelTablero[];
  /** Los cables que él curvó a mano (como en la pizarra): por id de cable. Solo pantalla. */
  curvas?: Record<string, { x: number; y: number }>;
  /** Las cajas que él dibuja detrás de las fichas, como en la pizarra. Solo pantalla. */
  cajas?: Array<{ id: string; x: number; y: number; ancho: number; alto: number; titulo: string; color?: string }>;
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
