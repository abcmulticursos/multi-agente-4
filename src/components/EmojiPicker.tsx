"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { TwemojiGlyph } from "@/components/TwemojiText";
import { useEscapeEnPila } from "@/lib/escape-en-pila";

/**
 * Selector de emojis del panel (chat y editor).
 *
 * El catalogo completo (1.914 emojis, nombres y sinonimos en español de Unicode
 * CLDR, en el orden oficial) vive en emoji-catalogo.json y se carga SOLO cuando
 * abres el selector por primera vez. Asi no pesa en la carga de la pagina.
 *
 * Ese JSON ya trae fusionadas las palabras de busqueda que estaban escritas a
 * mano en este archivo ("peru" para la bandera, "pack"/"entrega" para 📦): son
 * mejores que las genericas y por eso se conservaron.
 *
 * Los emojis se dibujan con TwemojiGlyph, igual que antes: mismo estilo (Noto)
 * en el selector y en los mensajes.
 */

type EmojiEntry = {
  /** el emoji */ e: string;
  /** nombre en español */ l: string;
  /** sinonimos, separados por espacio, ya normalizados */ k: string;
  /** indice de categoria */ g: number;
};

type Catalogo = { categorias: string[]; emojis: EmojiEntry[] };

interface Props {
  onPick: (emoji: string) => void;
  disabled?: boolean;
  /** En el chat, el selector vive al pie y debe abrirse hacia arriba. */
  placement?: "above" | "below";
}

function normalizeSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

export default function EmojiPicker({
  onPick,
  disabled,
  placement = "below",
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [catalogo, setCatalogo] = useState<Catalogo | null>(null);
  const [catActiva, setCatActiva] = useState(0);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const seccionesRef = useRef<(HTMLDivElement | null)[]>([]);

  // DÓNDE SE DIBUJA EL PANEL, EN COORDENADAS DE PANTALLA.
  //
  // AQUÍ ESTABA EL SELECTOR QUE SE QUEDABA A MEDIAS.
  //
  // El panel colgaba del botón con posición relativa. Dentro del editor de una
  // burbuja, la columna de la izquierda se desplaza a lo ancho, y CUALQUIER
  // antepasado que recorte deja el panel cortado por su borde: se veía media
  // rejilla de emojis y la otra mitad desaparecía.
  //
  // No se arregla ensanchando ni subiendo el z-index: el recorte lo hace el
  // contenedor, y un hijo no puede salirse de su padre. Así que el panel se
  // saca del árbol y se dibuja pegado al `body`, en coordenadas de pantalla.
  // Ahí no hay ningún padre que recorte.
  const [sitio, setSitio] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => {
    if (!open) {
      setSitio(null);
      return;
    }
    const medir = () => {
      const caja = wrapperRef.current?.getBoundingClientRect();
      if (!caja) return;
      const ANCHO = 320;
      const ALTO = 380;
      // Se pega a la izquierda del botón, pero sin salirse por la derecha de la
      // pantalla: en un campo pegado al borde, el panel quedaba medio fuera.
      const left = Math.max(
        8,
        Math.min(caja.left, window.innerWidth - ANCHO - 8)
      );
      // Debajo si cabe; si no, encima. Es lo que hacía `placement`, pero
      // medido de verdad en vez de decidido a mano por quien lo coloca.
      const cabeDebajo = caja.bottom + ALTO + 8 <= window.innerHeight;
      const top =
        placement === "above" || !cabeDebajo
          ? Math.max(8, caja.top - ALTO - 8)
          : caja.bottom + 8;
      setSitio({ left, top });
    };
    medir();
    // Al desplazar o cambiar el tamaño, el botón se mueve y el panel no: se
    // queda flotando en el sitio de antes. Se vuelve a medir.
    window.addEventListener("scroll", medir, true);
    window.addEventListener("resize", medir);
    return () => {
      window.removeEventListener("scroll", medir, true);
      window.removeEventListener("resize", medir);
    };
  }, [open, placement]);

  // Carga diferida: el JSON solo se pide la primera vez que abres el selector.
  useEffect(() => {
    if (!open || catalogo) return;
    let cancelado = false;
    import("@/components/emoji-catalogo.json")
      .then((mod) => {
        if (!cancelado) setCatalogo((mod.default ?? mod) as unknown as Catalogo);
      })
      .catch(() => {
        /* si falla, se queda el mensaje de "cargando" y el chat sigue igual */
      });
    return () => {
      cancelado = true;
    };
  }, [open, catalogo]);

  // ESCAPE CIERRA SOLO LOS EMOJIS (31/10/2026), no la ventana de la burbuja que hay debajo.
  useEscapeEnPila(() => setOpen(false), open);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      const destino = e.target as Node;
      // EL PANEL YA NO CUELGA DEL BOTÓN, así que hay que preguntarle también a
      // él. Mirando solo el envoltorio, elegir un emoji contaba como «clic
      // fuera» y el selector se cerraba antes de insertarlo.
      if (panelRef.current?.contains(destino)) return;
      if (wrapperRef.current && !wrapperRef.current.contains(destino)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  // Resultados de busqueda: lista plana sobre TODAS las categorias.
  const resultados = useMemo(() => {
    const q = normalizeSearch(query);
    if (!q || !catalogo) return null;
    return catalogo.emojis.filter(
      (x) => normalizeSearch(x.l).includes(q) || x.k.includes(q)
    );
  }, [query, catalogo]);

  // Emojis agrupados por categoria, para el scroll continuo.
  const porCategoria = useMemo(() => {
    if (!catalogo) return [];
    return catalogo.categorias.map((nombre, i) => ({
      nombre,
      emojis: catalogo.emojis.filter((x) => x.g === i),
    }));
  }, [catalogo]);

  function irACategoria(i: number) {
    setQuery("");
    setCatActiva(i);
    // El salto se hace tras el render por si venias de una busqueda.
    window.setTimeout(() => {
      const cont = scrollRef.current;
      const sec = seccionesRef.current[i];
      if (cont && sec) cont.scrollTop = sec.offsetTop - cont.offsetTop;
    }, 0);
  }

  // Marca la pestaña de la seccion que estas viendo mientras scrolleas.
  function onScroll() {
    const cont = scrollRef.current;
    if (!cont || query) return;
    let activa = 0;
    seccionesRef.current.forEach((sec, i) => {
      if (sec && sec.offsetTop - cont.offsetTop <= cont.scrollTop + 8) activa = i;
    });
    setCatActiva(activa);
  }

  const boton = (x: EmojiEntry, key: string) => (
    <button
      key={key}
      type="button"
      title={x.l}
      onClick={() => onPick(x.e)}
      className="flex h-9 w-9 items-center justify-center rounded text-lg hover:bg-neutral-100"
    >
      <TwemojiGlyph emoji={x.e} className="h-6 w-6" />
    </button>
  );

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        title={disabled ? "Cambia a modo HUMANO para usar emojis" : "Insertar emoji"}
        className="flex h-10 w-10 items-center justify-center rounded-full text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="h-5 w-5"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M8 14s1.5 2 4 2 4-2 4-2" />
          <line x1="9" y1="9" x2="9.01" y2="9" />
          <line x1="15" y1="9" x2="15.01" y2="9" />
        </svg>
      </button>

      {open && sitio && createPortal(
        <div
          ref={panelRef}
          style={{ left: sitio.left, top: sitio.top }}
          // `fixed` y colgado del `body`: fuera del alcance de cualquier
          // contenedor que recorte. Ver `sitio`.
          className="fixed z-[200] w-80 rounded-lg border border-neutral-200 bg-tarjeta shadow-2xl"
        >
          <div className="border-b border-neutral-100 p-2">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar: graduacion, corazon, peru..."
              className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-xs text-neutral-800 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
            />
          </div>

          {/* Pestañas horizontales: saltan a su seccion, no filtran. */}
          <div className="flex overflow-x-auto border-b border-neutral-100">
            {(catalogo?.categorias ?? []).map((nombre, i) => (
              <button
                key={nombre}
                type="button"
                onClick={() => irACategoria(i)}
                className={`flex-none px-2.5 py-1.5 text-[11px] font-medium transition ${
                  catActiva === i && !query.trim()
                    ? "border-b-2 border-emerald-500 text-emerald-600"
                    : "text-neutral-500 hover:text-neutral-700"
                }`}
              >
                {nombre}
              </button>
            ))}
          </div>

          <div
            ref={scrollRef}
            onScroll={onScroll}
            className="h-56 overflow-y-auto p-2"
          >
            {!catalogo && (
              <p className="py-6 text-center text-xs text-neutral-400">
                Cargando emojis…
              </p>
            )}

            {/* Busqueda: lista plana, sin titulos. */}
            {catalogo && resultados && (
              <div className="grid grid-cols-8 content-start gap-0.5">
                {resultados.map((x, i) => boton(x, `${x.e}-${i}`))}
                {resultados.length === 0 && (
                  <p className="col-span-8 py-6 text-center text-xs text-neutral-400">
                    Sin resultados
                  </p>
                )}
              </div>
            )}

            {/* Sin busqueda: scroll continuo con el titulo de cada categoria
                pegado arriba, como en WhatsApp. */}
            {catalogo &&
              !resultados &&
              porCategoria.map((cat, i) => (
                <div
                  key={cat.nombre}
                  ref={(el) => {
                    seccionesRef.current[i] = el;
                  }}
                >
                  <p className="sticky top-0 z-10 bg-white/95 px-0.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-400 backdrop-blur">
                    {cat.nombre}
                  </p>
                  <div className="grid grid-cols-8 content-start gap-0.5 pb-1">
                    {cat.emojis.map((x, j) => boton(x, `${x.e}-${i}-${j}`))}
                  </div>
                </div>
              ))}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
