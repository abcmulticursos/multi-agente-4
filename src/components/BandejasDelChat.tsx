"use client";

import { useEffect, useState } from "react";

/**
 * LA BARRA DE TIENDAS DEL CHAT (21/10/2026).
 *
 * Su idea: «una barra a la izquierda con las tiendas; toco una y veo sus chats». Y lo que sumamos al
 * salir de su burbuja: «⚡ Te necesitan» (de TODAS las tiendas, solo los chats donde él tiene que
 * hacer algo: modo humano, reclamo, pago-reclamo) y «📥 Todas» (todos juntos, como siempre).
 * Debajo, cada tienda con su color, y cada número conectado que no tiene tienda, porque «una
 * tienda no es requisito para chatear». Cada una con la cantidad de chats sin leer.
 *
 * Solo aparece con 2 bandejas o más: con una sola tienda el chat se ve como siempre.
 * En el celular no cabe al costado: es una fila de botones que se desliza, arriba de la lista.
 */
export interface Bandeja {
  clave: string;
  nombre: string;
  color: string | null;
  detalle: string | null;
}

export interface ChatDeBandeja {
  bandeja?: string | null;
  mode?: string | null;
  nocodb_label?: string | null;
  unread_count?: number | null;
  manually_unread?: number | null;
}

export const TODAS = "todas";
export const TE_NECESITAN = "atencion";

export function teNecesita(c: ChatDeBandeja): boolean {
  return c.mode === "HUMAN" || c.nocodb_label === "reclamo" || c.nocodb_label === "pago-reclamo";
}

export function enLaBandeja(c: ChatDeBandeja, elegida: string): boolean {
  if (elegida === TODAS) return true;
  if (elegida === TE_NECESITAN) return teNecesita(c);
  return c.bandeja === elegida;
}

const sinLeer = (c: ChatDeBandeja) => (c.unread_count ?? 0) > 0 || c.manually_unread === 1;

interface Opcion {
  clave: string;
  nombre: string;
  detalle: string | null;
  color: string | null;
  icono?: string;
  cuenta: number;
  /** El contador de «Te necesitan» es de chats, no de no leídos: se pinta distinto. */
  urgente?: boolean;
}

function opciones(bandejas: Bandeja[], chats: ChatDeBandeja[]): Opcion[] {
  return [
    { clave: TE_NECESITAN, nombre: "Te necesitan", detalle: "Humano y reclamos", color: null, icono: "⚡", cuenta: chats.filter(teNecesita).length, urgente: true },
    { clave: TODAS, nombre: "Todas", detalle: "Todos los chats", color: null, icono: "📥", cuenta: chats.filter(sinLeer).length },
    ...bandejas.map((b) => ({
      clave: b.clave,
      nombre: b.nombre,
      detalle: b.detalle,
      color: b.color,
      icono: b.clave.startsWith("n:") ? "📱" : undefined,
      cuenta: chats.filter((c) => c.bandeja === b.clave && sinLeer(c)).length,
    })),
  ];
}

function Contador({ n, urgente }: { n: number; urgente?: boolean }) {
  if (!n) return null;
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold leading-none text-white ${urgente ? "bg-amber-500" : "bg-emerald-500"}`}
    >
      {n}
    </span>
  );
}

function Punto({ o }: { o: Opcion }) {
  return o.icono ? (
    <span className="w-4 shrink-0 text-center text-sm">{o.icono}</span>
  ) : (
    <span className="inline-block h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: o.color || "#14b8a6" }} />
  );
}

/** La barra de la computadora, a la izquierda de la lista. Plegada: solo círculos. */
export function BarraDeBandejas({
  bandejas,
  chats,
  elegida,
  onElegir,
  plegada,
  onPlegar,
}: {
  bandejas: Bandeja[];
  chats: ChatDeBandeja[];
  elegida: string;
  onElegir: (clave: string) => void;
  plegada: boolean;
  onPlegar: () => void;
}) {
  const lista = opciones(bandejas, chats);
  return (
    <nav
      className={`hidden shrink-0 flex-col border-r border-neutral-200 bg-neutral-50 md:flex ${plegada ? "w-16" : "w-56"}`}
      aria-label="Tiendas"
    >
      <div className={`flex items-center px-3 pb-2 pt-3 ${plegada ? "justify-center" : "justify-between"}`}>
        {!plegada && <span className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-neutral-500">Tiendas</span>}
        <button
          type="button"
          onClick={onPlegar}
          title={plegada ? "Abrir la barra" : "Plegar la barra"}
          className="rounded-md px-1.5 py-1 text-neutral-500 hover:bg-neutral-200"
        >
          {plegada ? "»" : "«"}
        </button>
      </div>
      <div className="flex-1 space-y-1 overflow-y-auto px-2 pb-3">
        {lista.map((o, i) => {
          const activa = o.clave === elegida;
          return (
            <div key={o.clave}>
              {i === 2 && <div className="mx-2 my-2 h-px bg-neutral-200" />}
              <button
                type="button"
                onClick={() => onElegir(o.clave)}
                title={plegada ? `${o.nombre}${o.detalle ? ` · ${o.detalle}` : ""}` : undefined}
                className={`relative flex w-full items-center gap-2 rounded-lg py-2 text-left transition ${plegada ? "justify-center px-0" : "px-2.5"} ${
                  activa ? "bg-white shadow-sm ring-1 ring-black/5" : "hover:bg-white/70"
                }`}
              >
                {activa && <span className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r" style={{ backgroundColor: o.color || "#10b981" }} />}
                {plegada ? (
                  <span className="relative">
                    {o.icono ? (
                      <span className="text-base">{o.icono}</span>
                    ) : (
                      <span
                        className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white"
                        style={{ backgroundColor: o.color || "#14b8a6" }}
                      >
                        {o.nombre.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    {o.cuenta > 0 && (
                      <span
                        className={`absolute -right-2 -top-1.5 rounded-full px-1.5 text-[10px] font-bold text-white ${o.urgente ? "bg-amber-500" : "bg-emerald-500"}`}
                      >
                        {o.cuenta}
                      </span>
                    )}
                  </span>
                ) : (
                  <>
                    <Punto o={o} />
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-sm ${activa ? "font-bold text-neutral-900" : "font-semibold text-neutral-700"}`}>{o.nombre}</span>
                      {o.detalle && <span className="block truncate text-[11px] text-neutral-500">{o.detalle}</span>}
                    </span>
                    <Contador n={o.cuenta} urgente={o.urgente} />
                  </>
                )}
              </button>
            </div>
          );
        })}
      </div>
      <PieDelNegocio plegada={plegada} />
    </nav>
  );
}

/**
 * Abajo de la barra: el nombre de su negocio (un clic para escribirlo) y cuántos números atienden,
 * que lleva a Meta Connect.
 */
function PieDelNegocio({ plegada }: { plegada: boolean }) {
  const [datos, setDatos] = useState<{ nombre: string | null; numeros: number; pausados: number } | null>(null);
  const [editando, setEditando] = useState(false);
  const [borrador, setBorrador] = useState("");
  useEffect(() => {
    fetch("/api/negocio", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setDatos(d))
      .catch(() => undefined);
  }, []);
  async function guardar() {
    setEditando(false);
    const nombre = borrador.trim();
    if (!nombre || nombre === datos?.nombre) return;
    setDatos((d) => (d ? { ...d, nombre } : d));
    try {
      const r = await fetch("/api/negocio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nombre }) });
      if (r.ok) setDatos(await r.json());
    } catch {
      // se queda el que se ve; al recargar sale el guardado
    }
  }
  if (!datos) return null;
  const nombre = datos.nombre || "Mi negocio";
  const inicial = (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold text-white">
      {nombre.slice(0, 1).toUpperCase()}
    </span>
  );
  if (plegada) {
    return (
      <div className="flex justify-center border-t border-neutral-200 py-3" title={`${nombre} · ${datos.numeros} números conectados`}>
        {inicial}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 border-t border-neutral-200 px-3 py-3">
      {inicial}
      <div className="min-w-0 flex-1">
        {editando ? (
          <input
            autoFocus
            value={borrador}
            maxLength={60}
            onChange={(e) => setBorrador(e.target.value)}
            onBlur={guardar}
            onKeyDown={(e) => {
              if (e.key === "Enter") void guardar();
              if (e.key === "Escape") setEditando(false);
            }}
            placeholder="Nombre de tu negocio"
            className="w-full rounded border border-emerald-400 px-1.5 py-0.5 text-sm font-semibold text-neutral-900 focus:outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setBorrador(datos.nombre ?? "");
              setEditando(true);
            }}
            title="Cambiar el nombre de tu negocio"
            className={`block w-full truncate text-left text-sm font-semibold hover:underline ${datos.nombre ? "text-neutral-900" : "text-neutral-400"}`}
          >
            {nombre} <span className="text-xs font-normal text-neutral-400">✎</span>
          </button>
        )}
        <a href="/meta-connect" className="block truncate text-[11px] text-neutral-500 hover:underline">
          {datos.numeros > 0 ? `🟢 ${datos.numeros} ${datos.numeros === 1 ? "número conectado" : "números conectados"}` : "⚠ Sin números conectados"}
          {datos.pausados > 0 ? ` · ${datos.pausados} pausado${datos.pausados === 1 ? "" : "s"}` : ""}
        </a>
      </div>
    </div>
  );
}

/** En el celular: una fila de botones que se desliza, arriba de la lista. */
export function FilaDeBandejas({
  bandejas,
  chats,
  elegida,
  onElegir,
}: {
  bandejas: Bandeja[];
  chats: ChatDeBandeja[];
  elegida: string;
  onElegir: (clave: string) => void;
}) {
  return (
    <div className="flex gap-2 overflow-x-auto border-b border-neutral-200 bg-neutral-50 px-3 py-2 md:hidden">
      {opciones(bandejas, chats).map((o) => {
        const activa = o.clave === elegida;
        return (
          <button
            key={o.clave}
            type="button"
            onClick={() => onElegir(o.clave)}
            className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition ${
              activa ? "border-transparent bg-white font-bold text-neutral-900 shadow-sm ring-2" : "border-neutral-200 bg-white font-semibold text-neutral-600"
            }`}
            style={activa ? { ["--tw-ring-color" as string]: o.color || "#10b981" } : undefined}
          >
            <Punto o={o} />
            <span className="max-w-[9rem] truncate">{o.nombre}</span>
            <Contador n={o.cuenta} urgente={o.urgente} />
          </button>
        );
      })}
    </div>
  );
}
