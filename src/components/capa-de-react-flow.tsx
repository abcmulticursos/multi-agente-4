"use client";

/**
 * LAS CAPAS DE REACT FLOW, BUSCADAS UNA SOLA VEZ (18/11/2026). Él: «el movimiento es lento… cortar un cable tarda más de
 * medio segundo… muevo una ficha y al instante jalo otra y se arrastra el tablero». Medido en FLORES (212 fichas, 25.000
 * elementos): `EdgeLabelRenderer` y `ViewportPortal` de React Flow hacen `querySelector` sobre TODO el lienzo en cada cambio
 * del lienzo (un paso de zoom, un clic, un paso del arrastre), una vez por cada cable con etiqueta. Cientos de búsquedas
 * por movimiento: ~1 s de pantalla trabada por acción. Estos hacen lo mismo —el mismo portal a la misma capa— pero
 * recuerdan la capa y solo la vuelven a buscar si se desmontó.
 */
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useStore } from "@xyflow/react";

const recordadas = new WeakMap<HTMLElement, Map<string, Element>>();

function laCapa(dom: HTMLElement | null | undefined, selector: string): Element | null {
  if (!dom) return null;
  let delLienzo = recordadas.get(dom);
  if (!delLienzo) recordadas.set(dom, (delLienzo = new Map()));
  const ya = delLienzo.get(selector);
  if (ya && ya.isConnected) return ya;
  const nueva = dom.querySelector(selector);
  if (nueva) delLienzo.set(selector, nueva);
  return nueva;
}

const elLienzo = (s: { domNode: HTMLDivElement | null }) => s.domNode;

/** La capa; si en el primer dibujo todavía no está en la página, se vuelve a mirar en el cuadro siguiente. */
function useLaCapa(selector: string): Element | null {
  const capa = laCapa(useStore(elLienzo), selector);
  const [, otraVez] = useState(0);
  useEffect(() => {
    if (capa) return;
    const cuadro = requestAnimationFrame(() => otraVez((n) => n + 1));
    return () => cancelAnimationFrame(cuadro);
  }, [capa]);
  return capa;
}

/** Como `EdgeLabelRenderer`: lo de dentro va a la capa de etiquetas de los cables. */
export function EnLaCapaDeEtiquetas({ children }: { children: ReactNode }) {
  const capa = useLaCapa(".react-flow__edgelabel-renderer");
  return capa ? createPortal(children, capa) : null;
}

/** Como `ViewportPortal`: lo de dentro va a la capa que se mueve y se acerca con el lienzo. */
export function EnLaCapaDelLienzo({ children }: { children: ReactNode }) {
  const capa = useLaCapa(".react-flow__viewport-portal");
  return capa ? createPortal(children, capa) : null;
}
