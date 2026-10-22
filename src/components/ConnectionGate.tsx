"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ConfigScreen from "@/components/ConfigScreen";
import ConversationList, {
  type ConversationListItem,
} from "@/components/ConversationList";
import ConversationPanel from "@/components/ConversationPanel";
import DashboardHeader from "@/components/DashboardHeader";
import KanbanBoard from "@/components/KanbanBoard";
import ResultadosPanel from "@/components/ResultadosPanel";
import {
  BarraDeBandejas,
  FilaDeBandejas,
  TODAS,
  TE_NECESITAN,
  enLaBandeja,
  type Bandeja,
} from "@/components/BandejasDelChat";

type ConnStatus =
  | { status: "loading" }
  | { status: "missing_config"; missing: string[] }
  | { status: "error"; message: string }
  | {
      status: "connected";
      phone: string;
      verified_name: string | null;
      quality: string | null;
      profile_picture_url: string | null;
    };

interface Props {
  initialView?: "chats" | "kanban" | "resultados";
}

/** Cuántas conversaciones se piden en cada refresco rápido. */
const PRIMERAS = 30;

/**
 * Mezcla el grupo recién traído con lo que ya había.
 *
 * El refresco rápido trae solo las primeras: si se reemplazara la lista entera
 * con ellas, desaparecerían las demás y los contadores de las etiquetas —que
 * se calculan con TODAS— mostrarían números falsos. Aquí se actualizan las que
 * vinieron, se conservan las otras y se reordena como en la base: fijadas
 * arriba, y el resto por mensaje más reciente.
 */
function fusionarConversaciones(
  previas: ConversationListItem[],
  frescas: ConversationListItem[]
): ConversationListItem[] {
  if (previas.length === 0) return frescas;
  const porId = new Map(previas.map((c) => [c.id, c]));
  for (const c of frescas) porId.set(c.id, c);
  const momento = (c: ConversationListItem) =>
    c.last_message_at ?? c.created_at ?? 0;
  return [...porId.values()].sort((a, b) => {
    const fijadaA = a.pinned === 1 ? 1 : 0;
    const fijadaB = b.pinned === 1 ? 1 : 0;
    if (fijadaA !== fijadaB) return fijadaB - fijadaA;
    return momento(b) - momento(a);
  });
}

export default function ConnectionGate({ initialView }: Props) {
  const [conn, setConn] = useState<ConnStatus>({ status: "loading" });
  const [activeProductName, setActiveProductName] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [introVariants, setIntroVariants] = useState<number[]>([]);
  // LA BARRA DE TIENDAS (21/10/2026). Lo elegido y si está plegada se recuerdan en este navegador.
  const [bandejas, setBandejas] = useState<Bandeja[]>([]);
  const [bandejaElegida, setBandejaElegida] = useState<string>(() => {
    try {
      return (typeof window !== "undefined" && window.localStorage.getItem("chat:bandeja")) || TODAS;
    } catch {
      return TODAS;
    }
  });
  const [barraPlegada, setBarraPlegada] = useState<boolean>(() => {
    try {
      return typeof window !== "undefined" && window.localStorage.getItem("chat:barra-plegada") === "1";
    } catch {
      return false;
    }
  });
  const elegirBandeja = useCallback((clave: string) => {
    setBandejaElegida(clave);
    try {
      window.localStorage.setItem("chat:bandeja", clave);
    } catch {
      // sin memoria del navegador, igual funciona
    }
  }, []);
  const plegarBarra = useCallback(() => {
    setBarraPlegada((antes) => {
      try {
        window.localStorage.setItem("chat:barra-plegada", antes ? "0" : "1");
      } catch {
        // igual funciona
      }
      return !antes;
    });
  }, []);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [view, setView] = useState<"chats" | "kanban" | "resultados">(() => {
    if (initialView) return initialView;
    if (typeof window === "undefined") return "chats";
    return new URLSearchParams(window.location.search).get("view") === "kanban"
      ? "kanban"
      : "chats";
  });

  const handleView = useCallback((nextView: "chats" | "kanban" | "resultados") => {
    setView(nextView);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (nextView === "kanban") {
      url.pathname = "/kanban";
      url.searchParams.delete("view");
    } else {
      url.pathname = "/";
      url.searchParams.delete("view");
    }
    window.history.replaceState(
      null,
      "",
      `${url.pathname}${url.search}${url.hash}`
    );
  }, []);

  const fetchStatus = useCallback(async () => {
    const res = await fetch("/api/connection/status", { cache: "no-store" });
    const data = await res.json();
    if (data.status === "connected") {
      setConn({
        status: "connected",
        phone: data.phone,
        verified_name: data.verified_name ?? null,
        quality: data.quality ?? null,
        profile_picture_url: data.profile_picture_url ?? null,
      });
    } else if (data.status === "missing_config") {
      setConn({ status: "missing_config", missing: data.missing ?? [] });
    } else {
      setConn({ status: "error", message: data.message ?? "Error desconocido" });
    }
  }, []);

  const fetchActiveProduct = useCallback(async () => {
    const res = await fetch("/api/products", { cache: "no-store" });
    const data = (await res.json()) as {
      active_product_id?: string;
      products?: Array<{ id: string; name: string }>;
    };
    const product = data.products?.find((item) => item.id === data.active_product_id);
    setActiveProductName(product?.name ?? null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    void fetchActiveProduct().catch(() => undefined);
    async function tick() {
      try {
        await fetchStatus();
      } finally {
        if (!cancelled) {
          // Mientras no estemos conectados, reintenta cada 3s.
          // Cuando estamos conectados, ya no hace falta — el header tiene botón manual.
          setConn((prev) => {
            if (prev.status !== "connected") {
              timer = setTimeout(tick, 3000);
            }
            return prev;
          });
        }
      }
    }

    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [fetchActiveProduct, fetchStatus]);

  // Polling de conversaciones solo cuando estamos conectados.
  // Se lee dentro del refresco sin reiniciarlo cada vez que cambias de chat.
  const selectedIdRef = useRef<number | null>(null);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    if (conn.status !== "connected") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    /**
     * ¿Hace falta pedir la lista ahora mismo?
     *
     * Armar esta lista le cuesta bastante al servidor —el mismo que atiende a
     * las clientas—, así que no se pide cuando nadie la está mirando:
     *
     *  - Con la pestaña oculta (cambiaste de app, bloqueaste el celular).
     *  - Dentro de una conversación EN EL CELULAR: ahí la lista no está en
     *    pantalla. En el escritorio sí se ve al lado, así que ahí se sigue
     *    pidiendo igual que siempre.
     *
     * El reloj no se detiene: se sigue comprobando cada 2 segundos, así que en
     * cuanto vuelves la lista se refresca sola.
     */
    function hayQuePedirla(): boolean {
      if (typeof document !== "undefined" && document.hidden) return false;
      const enMovil =
        typeof window !== "undefined" && window.innerWidth < 768;
      if (enMovil && selectedIdRef.current !== null) return false;
      return true;
    }

    /**
     * Cada 2 segundos se piden solo las PRIMERAS, que es donde cae todo lo
     * nuevo: quien escribe sube al tope. Cada 20 segundos se piden todas, para
     * que los contadores de las etiquetas y el Kanban sigan exactos.
     *
     * La primera vez tambien se piden las 30: asi la lista aparece al instante
     * y el resto llega por detras sin que lo notes.
     */
    let ultimaCompleta = 0;

    async function tick() {
      try {
        if (!hayQuePedirla()) return;
        const ahora = Date.now();
        const tocaCompleta = ahora - ultimaCompleta >= 20000;
        const url = tocaCompleta
          ? "/api/conversations"
          : `/api/conversations?limite=${PRIMERAS}`;
        const res = await fetch(url, { cache: "no-store" });
        if (res.ok) {
          const data = (await res.json()) as {
            conversations: ConversationListItem[];
            introVariants?: number[];
            parcial?: boolean;
            bandejas?: Bandeja[];
          };
          if (!cancelled) {
            if (tocaCompleta) ultimaCompleta = ahora;
            setConversations((previas) =>
              data.parcial
                ? fusionarConversaciones(previas, data.conversations)
                : data.conversations
            );
            setIntroVariants(data.introVariants ?? []);
            if (data.bandejas) setBandejas(data.bandejas);
          }
        }
      } catch (err) {
        console.error("[gate] error refrescando conversaciones", err);
      } finally {
        if (!cancelled) timer = setTimeout(tick, 2000);
      }
    }

    // Arranque: las 30 primeras para pintar ya, y las demas justo despues.
    void (async () => {
      try {
        const res = await fetch(`/api/conversations?limite=${PRIMERAS}`, {
          cache: "no-store",
        });
        if (res.ok && !cancelled) {
          const data = (await res.json()) as {
            conversations: ConversationListItem[];
            introVariants?: number[];
            bandejas?: Bandeja[];
          };
          setConversations(data.conversations);
          setIntroVariants(data.introVariants ?? []);
          if (data.bandejas) setBandejas(data.bandejas);
        }
      } catch {
        // da igual: el refresco de abajo lo intenta enseguida
      }
    })();

    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [conn.status]);

  // Si la convo seleccionada desaparece (borrada en otro tab), deselecciona.
  useEffect(() => {
    if (selectedId === null) return;
    if (!conversations.some((c) => c.id === selectedId)) {
      setSelectedId(null);
    }
  }, [conversations, selectedId]);

  const handleTogglePin = useCallback(
    async (id: number, pinned: boolean) => {
      // Optimista: el ícono cambia ya; el polling de 2s reordena la lista.
      setConversations((prev) =>
        prev.map((c) => (c.id === id ? { ...c, pinned: pinned ? 1 : 0 } : c))
      );
      try {
        await fetch(`/api/conversations/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pinned }),
        });
      } catch {
        // el polling corrige si falló
      }
    },
    []
  );

  const handleToggleRead = useCallback(
    async (id: number, read: boolean) => {
      // Optimista: el indicador cambia ya; el polling de 2s confirma.
      // - Al marcar como LEÍDO: limpiamos unread_count y manually_unread.
      // - Al marcar como NO LEÍDO: solo activamos manually_unread = 1
      //   (el badge con número sigue siendo del unread_count real del
      //   cliente; si es 0, se muestra el puntito sin número).
      setConversations((prev) =>
        prev.map((c) =>
          c.id === id
            ? {
                ...c,
                unread_count: read ? 0 : c.unread_count ?? 0,
                manually_unread: read ? 0 : 1,
              }
            : c
        )
      );
      try {
        await fetch(`/api/conversations/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ read }),
        });
      } catch {
        // el polling corrige si falló
      }
    },
    []
  );

  // La conversación abierta no muestra badge de no leídos automáticos
  // (la estás viendo). PERO si la marcaste manualmente como no leída,
  // respetamos esa marca y mostramos el puntito verde — el operador
  // intencionalmente quiere recordar atenderla.
  const displayConversations = useMemo(
    () =>
      selectedId === null
        ? conversations
        : conversations.map((c) =>
            c.id === selectedId && c.manually_unread !== 1
              ? { ...c, unread_count: 0 }
              : c
          ),
    [conversations, selectedId]
  );

  // Con 2 bandejas o más aparece la barra; con una sola, el chat es el de siempre.
  const conBarra = bandejas.length >= 2;
  const bandejaVigente =
    conBarra && (bandejaElegida === TE_NECESITAN || bandejas.some((b) => b.clave === bandejaElegida))
      ? bandejaElegida
      : TODAS;
  const chatsDeLaBandeja = useMemo(
    () => (bandejaVigente === TODAS ? displayConversations : displayConversations.filter((c) => enLaBandeja(c, bandejaVigente))),
    [displayConversations, bandejaVigente]
  );

  // ── Navegación en pantalla angosta ──────────────────────────────────────
  // En el celular la lista y el chat se turnan. Además, el botón ATRÁS del
  // teléfono vuelve a la lista en vez de sacarte de la aplicación: al abrir un
  // chat se apila un estado en el historial, y al retroceder se deselecciona.
  const enConversacion = selectedId !== null;

  const abrirConversacion = useCallback((id: number) => {
    setSelectedId(id);
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      window.history.pushState({ chatAbierto: id }, "");
    }
  }, []);

  const volverALaLista = useCallback(() => {
    const estado = typeof window !== "undefined" ? window.history.state : null;
    if (estado && (estado as { chatAbierto?: number }).chatAbierto != null) {
      // Retroceder dispara popstate y ahí se deselecciona: así el historial
      // no se llena de entradas muertas.
      window.history.back();
    } else {
      setSelectedId(null);
    }
  }, []);

  useEffect(() => {
    function alRetroceder() {
      setSelectedId(null);
    }
    window.addEventListener("popstate", alRetroceder);
    return () => window.removeEventListener("popstate", alRetroceder);
  }, []);

  if (conn.status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-neutral-500">
        Cargando…
      </div>
    );
  }

  if (conn.status === "missing_config") {
    return (
      <ConfigScreen
        status="missing_config"
        missing={conn.missing}
        onRetry={fetchStatus}
      />
    );
  }

  if (conn.status === "error") {
    return (
      <ConfigScreen
        status="error"
        message={conn.message}
        onRetry={fetchStatus}
      />
    );
  }

  return (
    // 100dvh, no 100vh: en el celular la altura de la ventana cambia cuando
    // aparecen las barras del navegador o el teclado. Con vh el pie del chat
    // quedaba fuera de la pantalla.
    <div className="flex h-[100dvh] flex-col">
      {/* Dentro de una conversación, en el celular la cabecera del panel se
          esconde: el chat ocupa toda la pantalla, como en WhatsApp. La
          conversación ya trae su propia cabecera con el nombre y el volver. */}
      <div className={enConversacion ? "hidden md:block" : "block"}>
      <DashboardHeader
        phone={conn.phone}
        verifiedName={conn.verified_name}
        quality={conn.quality}
        // Servida por el bot: el enlace que da Meta caduca a las semanas y
        // dejaba la foto rota. Este siempre trae la actual.
        profilePictureUrl="/api/meta/avatar?wa=active"
        productName={activeProductName}
        onRefresh={fetchStatus}
        view={view}
        onView={handleView}
      />
      </div>
      {view === "chats" ? (
        // EN EL CELULAR SE TURNAN: o la lista, o la conversación — nunca las
        // dos, que no caben. En el escritorio (md hacia arriba) todo queda
        // exactamente como estaba: lista a la izquierda, chat a la derecha.
        <div className="flex flex-1 min-h-0">
          {conBarra && (
            <BarraDeBandejas
              bandejas={bandejas}
              chats={displayConversations}
              elegida={bandejaVigente}
              onElegir={elegirBandeja}
              plegada={barraPlegada}
              onPlegar={plegarBarra}
            />
          )}
          <aside
            className={`w-full shrink-0 overflow-y-auto border-r border-neutral-200 bg-tarjeta md:block md:w-96 ${
              enConversacion ? "hidden" : "block"
            }`}
          >
            <ConversationList
              conversations={chatsDeLaBandeja}
              introVariants={introVariants}
              selectedId={selectedId}
              onSelect={abrirConversacion}
              onTogglePin={handleTogglePin}
              onToggleRead={handleToggleRead}
              mostrarTienda={conBarra && !bandejaVigente.startsWith("t:")}
              encabezado={
                conBarra ? (
                  <FilaDeBandejas
                    bandejas={bandejas}
                    chats={displayConversations}
                    elegida={bandejaVigente}
                    onElegir={elegirBandeja}
                  />
                ) : null
              }
            />
          </aside>
          <main
            className={`flex-1 min-w-0 md:block ${
              enConversacion ? "block" : "hidden"
            }`}
          >
            {selectedId === null ? (
              <div className="flex h-full items-center justify-center text-sm text-neutral-500">
                Selecciona una conversación de la lista.
              </div>
            ) : (
              <ConversationPanel
                key={selectedId}
                conversationId={selectedId}
                onDeleted={() => setSelectedId(null)}
                onBack={volverALaLista}
              />
            )}
          </main>
        </div>
      ) : view === "resultados" ? (
        <main className="flex-1 min-h-0 overflow-hidden">
          <ResultadosPanel conversations={displayConversations} />
        </main>
      ) : (
        <main className="flex-1 min-h-0 overflow-hidden">
          <KanbanBoard
            conversations={displayConversations as Parameters<typeof KanbanBoard>[0]["conversations"]}
            onSelect={(id) => {
              abrirConversacion(id);
              handleView("chats");
            }}
            onStateChanged={() => {
              // El polling de /api/conversations refrescara la lista.
              // No hace falta hacer nada extra aqui.
            }}
          />
        </main>
      )}
    </div>
  );
}
