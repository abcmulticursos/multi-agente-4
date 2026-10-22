"use client";

import { useEffect, useState } from "react";

/**
 * CUÁNTOS MENSAJES LLEVA CADA NÚMERO ESTE MES (22/10/2026), dentro de Ajustes, junto al tope
 * de los orgánicos. Solo lee: `/api/mensajes-del-mes`.
 */
export function MensajesDelMes({ tope, encendido }: { tope: number; encendido: boolean }) {
  const [numeros, setNumeros] = useState<Array<{ telefono: string; pausado: boolean; usados: number }> | null>(null);
  useEffect(() => {
    let vivo = true;
    fetch("/api/mensajes-del-mes", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => vivo && setNumeros(Array.isArray(d?.numeros) ? d.numeros : []))
      .catch(() => vivo && setNumeros([]));
    return () => {
      vivo = false;
    };
  }, []);
  if (numeros === null) return <p className="mt-2 text-[11px] text-neutral-500">Contando los mensajes de este mes…</p>;
  if (numeros.length === 0) return <p className="mt-2 text-[11px] text-neutral-500">No hay números conectados.</p>;
  return (
    <ul className="mt-2 space-y-1">
      {numeros.map((n) => {
        // Apagado el interruptor, el bot contesta a todos: llegar al tope no cambia nada.
        const lleno = encendido && tope > 0 && n.usados >= tope;
        return (
          <li key={n.telefono} className="flex flex-wrap items-center gap-2 text-[12px] text-neutral-700">
            <span className="font-semibold">{n.telefono}</span>
            {n.pausado && <span className="text-neutral-500">(pausado)</span>}
            <span className={lleno ? "font-bold text-rose-600" : "text-neutral-600"}>
              {n.usados} de {tope > 0 ? tope : "—"} mensajes este mes
              {lleno ? " · ya no contesta a orgánicos nuevos" : ""}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
