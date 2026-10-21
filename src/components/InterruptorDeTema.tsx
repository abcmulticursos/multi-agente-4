"use client";

import { useEffect, useState } from "react";

/**
 * EL BOTÓN DE CLARO / OSCURO, PARA TODO EL BOT.
 *
 * Vivía dentro del editor, así que el tema solo se podía cambiar desde ahí: el
 * chat y el tablero se quedaban con lo último que hubiera elegido uno en otra
 * pantalla, sin forma de cambiarlo desde donde estaba.
 *
 * DÓNDE SE GUARDA. En este navegador, con la misma llave de siempre
 * (`wf:tema`), así que quien ya tenga elegido el oscuro no pierde su elección.
 *
 * QUIÉN LO PINTA PRIMERO. El script del `<head>` en `layout.tsx`, antes de que
 * se dibuje nada. Aquí solo se LEE al montar, para que el botón enseñe el
 * estado correcto; si esto decidiera, habría un fogonazo blanco en cada carga.
 */
export const TEMA_STORAGE_KEY = "wf:tema";
export type Tema = "claro" | "oscuro";

export function useTema(): [Tema, (t: Tema) => void] {
  const [tema, setTemaEnEstado] = useState<Tema>("claro");
  useEffect(() => {
    const puesto = document.documentElement.dataset.tema;
    if (puesto === "oscuro" || puesto === "claro") setTemaEnEstado(puesto);
  }, []);
  const setTema = (siguiente: Tema) => {
    setTemaEnEstado(siguiente);
    document.documentElement.dataset.tema = siguiente;
    try {
      localStorage.setItem(TEMA_STORAGE_KEY, siguiente);
    } catch {}
  };
  return [tema, setTema];
}

export default function InterruptorDeTema({
  className,
}: {
  /** Para que cada barra le dé su forma sin duplicar el botón. */
  className?: string;
}) {
  const [tema, setTema] = useTema();
  return (
    <button
      type="button"
      onClick={() => setTema(tema === "oscuro" ? "claro" : "oscuro")}
      title={tema === "oscuro" ? "Cambiar al tema claro" : "Cambiar al tema oscuro"}
      aria-label="Cambiar el tema"
      className={
        className ??
        "rounded-lg border border-borde bg-tarjeta px-3 py-2 text-xs font-semibold text-tinta-suave hover:bg-relleno"
      }
    >
      {tema === "oscuro" ? "☀️ Claro" : "🌙 Oscuro"}
    </button>
  );
}
