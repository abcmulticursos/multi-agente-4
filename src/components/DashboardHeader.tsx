"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import WhatsAppIdentityAvatar from "@/components/WhatsAppIdentityAvatar";
import QualityBadge from "@/components/QualityBadge";
import { letraSobre } from "@/components/BandejasDelChat";

interface Props {
  phone: string;
  verifiedName: string | null;
  quality: string | null;
  profilePictureUrl?: string | null;
  productName?: string | null;
  /**
   * LA CABECERA SIGUE A LA TIENDA ELEGIDA (21/10/2026): «arriba dice Aula Maestra… al cambiar de
   * tienda sigue el mismo, eso es incoherencia». Con una tienda o un número elegido en la barra,
   * se muestra su número; en «Todas», el resumen. Sin barra no llega y queda el principal.
   */
  identidad?: {
    nombre: string;
    telefono: string | null;
    foto: string | null;
    linea: string | null;
    color?: string | null;
    /** El número de la tienda elegida: su calidad se lee aparte (la del principal no sirve). */
    numeroId?: string | null;
  } | null;
  onRefresh: () => Promise<void> | void;
  view?: "chats" | "kanban" | "resultados";
  onView?: (v: "chats" | "kanban" | "resultados") => void;
}

export default function DashboardHeader({
  phone,
  verifiedName,
  quality,
  profilePictureUrl,
  productName,
  identidad = null,
  onRefresh,
  view = "chats",
  onView,
}: Props) {
  // La calidad del número de la tienda elegida. Se pide al cambiar de tienda (el servidor la
  // recuerda media hora); mientras llega, no se muestra nada en vez de la del principal.
  const numeroDeLaTienda = identidad?.numeroId ?? null;
  const [calidadDeLaTienda, setCalidadDeLaTienda] = useState<string | null>(null);
  useEffect(() => {
    setCalidadDeLaTienda(null);
    if (!numeroDeLaTienda) return;
    let vigente = true;
    fetch(`/api/meta/calidad?wa=${encodeURIComponent(numeroDeLaTienda)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { quality?: string | null } | null) => {
        if (vigente) setCalidadDeLaTienda(d?.quality ?? null);
      })
      .catch(() => undefined);
    return () => {
      vigente = false;
    };
  }, [numeroDeLaTienda]);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"ok" | "err" | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  /** Menú de los tres puntos. Solo existe en el celular. */
  const [menuAbierto, setMenuAbierto] = useState(false);

  // TAMAÑO DEL TEXTO. Cambia la medida base de la página, así que crece todo a
  // la vez y nada se descuadra. Queda guardado en ESE dispositivo: puedes
  // tenerlo grande en el celular y normal en la computadora.
  const [tamanoTexto, setTamanoTexto] = useState<"pequeno" | "normal" | "grande">(
    "normal"
  );
  useEffect(() => {
    const guardado = window.localStorage.getItem("tamano_texto");
    if (guardado === "pequeno" || guardado === "normal" || guardado === "grande") {
      setTamanoTexto(guardado);
    }
  }, []);
  useEffect(() => {
    const medidas = { pequeno: "15px", normal: "17px", grande: "19px" };
    document.documentElement.style.fontSize = medidas[tamanoTexto];
    window.localStorage.setItem("tamano_texto", tamanoTexto);
  }, [tamanoTexto]);

  async function handleTest() {
    if (testing) return;
    setTesting(true);
    setTestResult(null);
    try {
      await onRefresh();
      setTestResult("ok");
      setTimeout(() => setTestResult(null), 2500);
    } catch {
      setTestResult("err");
    } finally {
      setTesting(false);
    }
  }

  async function handleLogout() {
    if (loggingOut) return;
    if (!confirm("¿Cerrar sesión del dashboard?")) return;
    setLoggingOut(true);
    try {
      await fetch("/api/logout", { method: "POST" });
    } catch {
      // ignore — la cookie expirará igual
    }
    window.location.assign("/login");
  }

  return (
    <header className="flex items-center justify-between gap-4 border-b border-neutral-200 bg-tarjeta px-4 py-2 md:py-3">
      <div className="flex items-center gap-3 min-w-0">
        {/* La foto se esconde en el celular: ocupa altura y no aporta nada
            estando siempre a la vista. WhatsApp tampoco la muestra ahí. */}
        <span className="hidden md:inline-flex">
          {identidad && !identidad.foto ? (
            <span
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-base font-bold"
              style={{ backgroundColor: identidad.color || "#10b981", color: letraSobre(identidad.color || "#10b981") }}
            >
              {identidad.nombre.slice(0, 1).toUpperCase()}
            </span>
          ) : (
            <WhatsAppIdentityAvatar
              key={identidad?.foto ?? "principal"}
              phone={identidad?.telefono ?? phone}
              verifiedName={identidad ? identidad.nombre : verifiedName}
              productName={productName}
              foto={identidad?.foto ?? undefined}
              etiqueta={identidad ? identidad.linea ?? "" : undefined}
            />
          )}
        </span>
        {identidad ? (
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-neutral-900">{identidad.nombre}</div>
            {identidad.telefono && (
              <div className="flex flex-wrap items-center gap-x-2 text-sm text-neutral-500">
                {/* El número nunca se parte en dos líneas; si no cabe, la calidad baja a la siguiente. */}
                <span className="whitespace-nowrap">
                  {identidad.telefono.startsWith("+") ? identidad.telefono : `+${identidad.telefono}`}
                </span>
                {/* SU CALIDAD, la de ESTE número (22/10/2026): «falta el indicador de calidad». */}
                <QualityBadge quality={calidadDeLaTienda} />
              </div>
            )}
            {identidad.linea && (
              // El color va en el punto, no en la letra: un color claro de tienda no se leería.
              <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs font-semibold text-neutral-700">
                {identidad.color && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: identidad.color }} />}
                <span className="truncate">{identidad.linea}</span>
              </div>
            )}
          </div>
        ) : (
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-neutral-900">
            {verifiedName?.trim() || "Agente WhatsApp"}
          </div>
          <div className="inline-flex items-center gap-2 text-xs text-neutral-500">
            <span className="text-sm">{phone.startsWith("+") ? phone : `+${phone}`}</span>
            {quality && false && (
              <>
                <span>·</span>
                <span className="capitalize">{quality?.toLowerCase()}</span>
              </>
            )}
          </div>
            <span className="ml-2 inline-flex"><QualityBadge quality={quality} /></span>
          {productName ? (
            <div className="mt-0.5 truncate text-xs font-medium text-violet-700">
              Producto: {productName}
            </div>
          ) : null}
        </div>
        )}
      </div>
      {/* En el celular, todo lo que no es Chats/Kanban se guarda tras el menú
          de los tres puntos: eran cinco botones ocupando dos filas. */}
      <div className="relative flex items-center gap-2 md:hidden">
        {onView && (
          <div className="inline-flex shrink-0 rounded-md border border-neutral-200 bg-tarjeta text-xs">
            <button
              type="button"
              onClick={() => onView("chats")}
              className={`px-3 py-2 ${
                view === "chats"
                  ? "bg-emerald-600 text-white"
                  : "text-neutral-700"
              }`}
            >
              Chats
            </button>
            <button
              type="button"
              onClick={() => onView("resultados")}
              className={`px-3 py-2 ${
                view === "resultados"
                  ? "bg-emerald-600 text-white"
                  : "text-neutral-700"
              }`}
            >
              Resultados
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={() => setMenuAbierto((v) => !v)}
          aria-label="Más opciones"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xl leading-none text-neutral-600 hover:bg-neutral-100"
        >
          ⋮
        </button>
        {menuAbierto && (
          <>
            <div
              className="fixed inset-0 z-20"
              onClick={() => setMenuAbierto(false)}
            />
            <div className="absolute right-0 top-full z-30 mt-1 w-56 overflow-hidden rounded-lg border border-neutral-200 bg-tarjeta shadow-lg">
              <div className="border-b border-neutral-100 px-4 py-3">
                <div className="mb-2 text-xs font-medium text-neutral-500">
                  Tamaño del texto
                </div>
                <div className="flex gap-1.5">
                  {(
                    [
                      ["pequeno", "A", "Pequeño"],
                      ["normal", "A", "Normal"],
                      ["grande", "A", "Grande"],
                    ] as const
                  ).map(([valor, letra, etiqueta], i) => (
                    <button
                      key={valor}
                      type="button"
                      onClick={() => setTamanoTexto(valor)}
                      title={etiqueta}
                      className={`flex-1 rounded-md border py-1.5 ${
                        tamanoTexto === valor
                          ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                          : "border-neutral-200 text-neutral-600 hover:bg-neutral-50"
                      } ${["text-xs", "text-sm", "text-base"][i]}`}
                    >
                      {letra}
                    </button>
                  ))}
                </div>
              </div>
              <Link
                href="/editor"
                className="block px-4 py-3 text-sm text-neutral-700 hover:bg-neutral-50"
              >
                🧩 Editor
              </Link>
              <Link
                href="/editor?vista=pizarra"
                className="block border-t border-neutral-100 px-4 py-3 text-sm text-neutral-700 hover:bg-neutral-50"
              >
                🧭 Pizarra
              </Link>
              <Link
                href="/meta-connect"
                className="block border-t border-neutral-100 px-4 py-3 text-sm text-blue-700 hover:bg-neutral-50"
              >
                Conectar Meta
              </Link>
              <button
                type="button"
                onClick={() => {
                  setMenuAbierto(false);
                  void handleTest();
                }}
                disabled={testing}
                className="block w-full border-t border-neutral-100 px-4 py-3 text-left text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-60"
              >
                {testing ? "Probando…" : "Probar conexión"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuAbierto(false);
                  void handleLogout();
                }}
                disabled={loggingOut}
                className="block w-full border-t border-neutral-100 px-4 py-3 text-left text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-60"
              >
                {loggingOut ? "Saliendo…" : "Cerrar sesión"}
              </button>
            </div>
          </>
        )}
      </div>
      <div className="hidden items-center gap-2 md:flex">
        {onView && (
          <div className="inline-flex rounded-md border border-neutral-200 bg-tarjeta text-xs">
            <button
              type="button"
              onClick={() => onView("chats")}
              className={`px-3 py-1.5 ${
                view === "chats"
                  ? "bg-emerald-600 text-white"
                  : "text-neutral-700 hover:bg-neutral-50"
              }`}
            >
              Chats
            </button>
            <button
              type="button"
              onClick={() => onView("kanban")}
              className={`px-3 py-1.5 ${
                view === "kanban"
                  ? "bg-emerald-600 text-white"
                  : "text-neutral-700 hover:bg-neutral-50"
              }`}
            >
              Kanban
            </button>
            <button
              type="button"
              onClick={() => onView("resultados")}
              className={`px-3 py-1.5 ${
                view === "resultados"
                  ? "bg-emerald-600 text-white"
                  : "text-neutral-700 hover:bg-neutral-50"
              }`}
            >
              Resultados
            </button>
          </div>
        )}
        {testResult === "ok" && (
          <span className="text-xs text-emerald-600">Conexión OK</span>
        )}
        {testResult === "err" && (
          <span className="text-xs text-red-600">Sin conexión</span>
        )}
        {/* AQUÍ IBA EL BOTÓN DE CLARO / OSCURO. Retirado mientras se termina el
            tema claro; el oscuro estaba a medias y no se leía en los paneles de
            color. No se borró nada: ver `layout.tsx`. */}
        <Link
          href="/editor"
          className="rounded-md border border-neutral-200 bg-tarjeta px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50"
          title="Editor de flujo"
        >
          🧩 Editor
        </Link>
        {/* DIRECTO A LA PIZARRA (25/10/2026): «que la pizarra se abra sin pasar por el menú». */}
        <Link
          href="/editor?vista=pizarra"
          className="rounded-md border border-neutral-200 bg-tarjeta px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50"
          title="Abrir la pizarra (y desde ahí, el tablero de cada tienda)"
        >
          🧭 Pizarra
        </Link>
        <Link
          href="/meta-connect"
          className="flex items-center rounded-md border border-neutral-200 bg-white px-2.5 py-1 shadow-sm hover:bg-neutral-50"
          title="Meta Connect"
          aria-label="Meta Connect"
        >
          {/* SU LOGO DE META CONNECT, COMO BOTÓN (21/10/2026): «creo que el logo de Meta Connect
              más bien sería un botón para entrar». Fondo blanco para que no se pierda. */}
          <img src="/meta-connect-logo.png" alt="Meta Connect" className="h-5 w-auto" />
        </Link>
        <button
          type="button"
          onClick={handleTest}
          disabled={testing}
          className="rounded-md border border-neutral-200 bg-tarjeta px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-60"
        >
          {testing ? "Probando…" : "Probar conexión"}
        </button>
        <button
          type="button"
          onClick={handleLogout}
          disabled={loggingOut}
          className="rounded-md border border-neutral-200 bg-tarjeta px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-60"
          title="Cerrar sesión del dashboard"
        >
          {loggingOut ? "Saliendo…" : "Cerrar sesión"}
        </button>
      </div>
    </header>
  );
}
