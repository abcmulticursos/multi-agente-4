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
 * Se guarda en el contenido como `tableros: { <tiendaId>: Tablero }`.
 */
import type { SequenceStep } from "@/lib/workflow/config";

export type TipoDeFicha =
  | "inicio"
  | "mensaje"
  | "entregar"
  | "cobro"
  | "condicion"
  | "esperar"
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
  /** Por país (PE, MX…): el mínimo del pago abierto. Montos y monedas distintos por país. */
  minimo_por_pais?: Record<string, number>;
  /** Por país: los tramos del pago abierto. */
  tramos_por_pais?: Record<string, TramoDeCobro[]>;
}

export interface CondicionDeLaFicha {
  /** compro: ya compró ese producto en esta conversación · pais: es de alguno de esos países ·
   *  anuncio: vino de un anuncio. */
  tipo: "compro" | "pais" | "anuncio";
  producto_id?: string;
  paises?: string[];
}

export interface FichaDelTablero {
  id: string;
  tipo: TipoDeFicha;
  titulo?: string;
  x: number;
  y: number;
  /** Mensaje y cobro: sus burbujas, con sus botones y cuadritos (mismo cajón que la intro). */
  steps?: SequenceStep[];
  /** Mensaje: «no respondió en X minutos» → su salida `sin_respuesta`. 0/ausente = no espera. */
  sin_respuesta_min?: number;
  /** Cobro: «no pagó en X minutos» → su salida `sin_pago`. 0/ausente = no espera. */
  sin_pago_min?: number;
  /** Entregar: qué producto de la biblioteca. */
  producto_id?: string;
  cobro?: CobroDeLaFicha;
  condicion?: CondicionDeLaFicha;
  /** Esperar: cuántos minutos. */
  minutos?: number;
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
  /** Apagado = la tienda vende con el motor de siempre aunque tenga fichas. */
  encendido: boolean;
  fichas: FichaDelTablero[];
  cables: CableDelTablero[];
}

/** Una salida de una ficha: su clave y cómo se le llama en pantalla. */
export interface SalidaDeFicha {
  clave: string;
  etiqueta: string;
}
