"use client";
/**
 * ESCAPE CIERRA SOLO LA DE ARRIBA (31/10/2026). Él: «cuando entro a las burbujas, cuadros de decisiones… al
 * presionar escape se sale completamente del editor de la burbuja, necesito que haya un orden de salida».
 *
 * Antes cada ventana escuchaba Escape por su cuenta en `window`, y con varias abiertas se cerraban todas a la
 * vez (o la de abajo primero: el orden lo decidía cuándo se volvió a registrar cada escucha, no cuál estaba
 * encima). Ahora las ventanas se apuntan a una PILA al abrirse; Escape cierra solo la última abierta y no
 * llega a nadie más. Con la pila vacía, Escape sigue como siempre (el lienzo, la pantalla completa…).
 *
 * La escucha va en `window`, en burbujeo, y se pone al cargar este archivo: así va antes que las escuchas
 * viejas de `window` (que se ponen al montar) y después de lo que pasa dentro de un campo (el menú de «{{»,
 * que corta el Escape cuando está abierto).
 */
import { useEffect, useRef } from "react";

type Entrada = { cerrar: (e: KeyboardEvent) => void };
const pila: Entrada[] = [];

function alPulsar(e: KeyboardEvent) {
  if (e.key !== "Escape" || e.isComposing) return;
  const arriba = pila[pila.length - 1];
  if (!arriba) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  arriba.cerrar(e);
}

const MARCA = "__escapeEnPila";
if (typeof window !== "undefined" && !(window as unknown as Record<string, unknown>)[MARCA]) {
  (window as unknown as Record<string, unknown>)[MARCA] = true;
  window.addEventListener("keydown", alPulsar);
}

/** Mientras `activo`, esta ventana está en la pila: Escape la cierra a ella sola si es la de más arriba. */
export function useEscapeEnPila(cerrar: (e: KeyboardEvent) => void, activo = true) {
  const ultimo = useRef(cerrar);
  useEffect(() => {
    ultimo.current = cerrar;
  });
  useEffect(() => {
    if (!activo) return;
    const entrada: Entrada = { cerrar: (e) => ultimo.current(e) };
    pila.push(entrada);
    return () => {
      const i = pila.indexOf(entrada);
      if (i >= 0) pila.splice(i, 1);
    };
  }, [activo]);
}
