"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import MessageBubble, { type MessageDTO } from "@/components/MessageBubble";

type CountryCode = "PE" | "EC" | "MX" | "CO" | "AR" | "BO" | "GT" | "CR" | "CL" | "SV" | "VE";
type TestChannel = "whatsapp" | "messenger";

const COUNTRIES: Array<{ code: CountryCode; label: string }> = ([
  { code: "PE", label: "Perú (+51)" }, { code: "EC", label: "Ecuador (+593)" },
  { code: "MX", label: "México (+52)" }, { code: "CO", label: "Colombia (+57)" },
  { code: "AR", label: "Argentina (+54)" }, { code: "BO", label: "Bolivia (+591)" },
  { code: "GT", label: "Guatemala (+502)" }, { code: "CR", label: "Costa Rica (+506)" },
  { code: "CL", label: "Chile (+56)" }, { code: "SV", label: "El Salvador (+503)" },
  { code: "VE", label: "Venezuela (+58)" },
] as Array<{ code: CountryCode; label: string }>).map((c) => ({
  ...c,
  // LA BANDERA delante del nombre (28/10/2026, lo pidió él): la de su código de país.
  label: `${String.fromCodePoint(...[...c.code].map((l) => 0x1f1e6 + l.charCodeAt(0) - 65))} ${c.label}`,
}));

/** Sin tildes ni mayúsculas, para el buscador de tiendas. */
const paraBuscar = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{Mn}/gu, "");

/**
 * EL BUSCADOR DE TIENDAS (28/10/2026, él: «cuando escribo no aparece para seleccionar, hay un cuadro y el
 * selector colapsado»). Una sola caja: muestra la tienda elegida; al tocarla o escribir se despliega la lista
 * de las que coinciden y un clic la elige. Esc o clic fuera la cierra sin cambiar nada.
 */
function BuscadorDeTiendas({
  tiendas,
  valor,
  alElegir,
  compacto,
}: {
  tiendas: Array<{ id: string; nombre: string; apagada?: boolean }>;
  valor: string;
  alElegir: (id: string) => void;
  compacto?: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState("");
  const elegida = tiendas.find((t) => t.id === valor);
  const lista = [{ id: "", nombre: "Sin tienda · el bot de siempre" }, ...tiendas].filter(
    (t) => !texto.trim() || paraBuscar(t.nombre ?? "").includes(paraBuscar(texto.trim()))
  );
  const elegir = (id: string) => {
    setAbierto(false);
    setTexto("");
    if (id !== valor) alElegir(id);
  };
  return (
    <div className={`relative ${compacto ? "w-48" : "mt-1 w-full"}`}>
      <input
        value={abierto ? texto : `🏪 ${elegida?.nombre ?? "Sin tienda"}`}
        onFocus={() => {
          setAbierto(true);
          setTexto("");
        }}
        onChange={(e) => {
          setTexto(e.target.value);
          setAbierto(true);
        }}
        onBlur={() => window.setTimeout(() => setAbierto(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "Escape") (e.target as HTMLInputElement).blur();
          if (e.key === "Enter" && lista[0]) {
            e.preventDefault();
            elegir(lista[0].id);
            (e.target as HTMLInputElement).blur();
          }
        }}
        placeholder="🔎 Escribe para buscar la tienda…"
        title="Escribe parte del nombre y elige la tienda de la lista."
        className={
          compacto
            ? "w-full rounded-md border border-sky-300 bg-sky-50 px-2 py-1 text-xs text-sky-900"
            : "w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
        }
      />
      {abierto && (
        <ul
          className={`absolute z-50 mt-1 max-h-64 w-full min-w-[14rem] overflow-y-auto rounded-md border border-neutral-300 bg-white shadow-lg ${
            compacto ? "bottom-full mb-1 text-xs" : "text-sm"
          }`}
        >
          {lista.length === 0 && <li className="px-3 py-2 text-neutral-500">Ninguna tienda con ese nombre</li>}
          {lista.map((t) => (
            <li key={t.id || "-"}>
              <button
                type="button"
                // onMouseDown (no onClick): elige antes de que el cuadro pierda el foco y cierre la lista.
                onMouseDown={(e) => {
                  e.preventDefault();
                  elegir(t.id);
                }}
                className={`block w-full px-3 py-2 text-left text-neutral-800 hover:bg-sky-50 ${t.id === valor ? "bg-sky-100 font-semibold" : ""}`}
              >
                {t.id ? `🏪 ${t.nombre}` : t.nombre}
                {"apagada" in t && t.apagada ? " (apagada)" : ""}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type Session = { id: number; phone: string; name: string | null; state: string | null };
type Snapshot = { conversation: Session; messages: MessageDTO[]; buttons: Record<string, { id: string; title: string }[]> };
type SessionMap = Partial<Record<string, number>>;
const STORAGE_KEY = "multiagente:test-simulator:sessions:v1";

/** Una tienda, como la lista el simulador para poder probar con ella. */
type TiendaDePrueba = {
  id: string;
  nombre: string;
  tieneNumero: boolean;
  tienePagina: boolean;
  apagada: boolean;
};

// LA TIENDA ENTRA EN LA LLAVE DE LA SESION.
//
// Cada combinacion de canal, pais y tienda es una prueba DISTINTA y tiene que tener su
// propia conversacion. Si no estuviera aqui, al cambiar de tienda se reusaria la
// conversacion anterior —que ya tiene su numero escrito— y se estaria probando la
// tienda de antes creyendo que es la nueva.
function keyFor(
  channel: TestChannel,
  country: CountryCode | "ASK",
  tienda: string,
  ruta = ""
) {
  // La ruta del Ruteador (10/11/2026) también: se fija al nacer la prueba, así que cada ruta es su propia conversación.
  return `${channel}:${country}:${tienda || "sin-tienda"}${ruta ? `:${ruta}` : ""}`;
}

/** Un Ruteador de la tienda probada, con sus rutas (lo da `/api/test-simulator?rutas=1`). */
interface RuteadorDePrueba {
  id: string;
  titulo: string;
  rutas: { id: string; nombre: string; apagada: boolean; conectada: boolean }[];
}
/**
 * EL ADJUNTO ELEGIDO, ANTES DE ENVIARLO (10/11/2026). Él: «la palabra "quitar"… esté más grande, o que al menos indique
 * que hay un attach como en WhatsApp», y sin pantalla completa: «taparía las demás ventanas de chat». Una tarjeta pequeña
 * dentro de la ventana: miniatura (si es imagen), nombre y un «✕ Quitar» visible.
 */
function AdjuntoElegido({ file, alQuitar }: { file: File; alQuitar: () => void }) {
  const [vista, setVista] = useState<string | null>(null);
  useEffect(() => {
    if (!file.type.startsWith("image/")) { setVista(null); return; }
    const url = URL.createObjectURL(file);
    setVista(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const icono = file.type.startsWith("audio/") ? "🎤" : file.type.startsWith("video/") ? "🎬" : file.type === "application/pdf" ? "📄" : "📎";
  const peso = file.size >= 1024 * 1024 ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(file.size / 1024))} KB`;
  return (
    <div className="mb-2 flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 p-1.5">
      {vista
        ? <img src={vista} alt="" className="h-12 w-12 shrink-0 rounded object-cover" />
        : <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded bg-tarjeta text-2xl">{icono}</span>}
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-semibold text-emerald-800">📎 Adjunto listo para enviar</div>
        <div className="truncate text-xs text-neutral-700" title={file.name}>{file.name} · {peso}</div>
      </div>
      <button type="button" onClick={alQuitar} className="shrink-0 rounded-md border border-red-300 bg-tarjeta px-3 py-1.5 text-sm font-semibold text-red-600 hover:bg-red-50">✕ Quitar</button>
    </div>
  );
}

/** El desplegable de rutas: «al azar» o una ruta de un Ruteador (agrupadas si la tienda tiene varios en ese país). */
function SelectorDeRuta({ ruteadores, valor, alElegir, className }: { ruteadores: RuteadorDePrueba[]; valor: string; alElegir: (r: string) => void; className: string }) {
  const opciones = (r: RuteadorDePrueba) => r.rutas.map((x) => (
    <option key={x.id} value={`${r.id}|${x.id}`} disabled={!x.conectada}>
      🔀 Ruta: {x.nombre}{x.apagada ? " (apagada)" : ""}{!x.conectada ? " — sin cable" : ""}
    </option>
  ));
  return (
    <select value={valor} onChange={(e) => alElegir(e.target.value)} title="Por qué ruta del Ruteador entra este cliente de prueba. Tus clientes reales no se ven afectados." className={className}>
      <option value="">🔀 Ruta: al azar (como en vivo)</option>
      {ruteadores.length === 1
        ? opciones(ruteadores[0])
        : ruteadores.map((r) => <optgroup key={r.id} label={r.titulo}>{opciones(r)}</optgroup>)}
    </select>
  );
}
function formatPhone(phone: string) { return `+${phone.replace(/^test:/, "").split("-")[0]} · número simulado`; }

/**
 * Una ventana de prueba independiente (su propia sesión, país, chat e input).
 * Se puede renderizar varias en paralelo para comparar respuestas/comodines.
 * Persiste sus sesiones en localStorage bajo `${STORAGE_KEY}:${storageKey}`.
 */
function TestWindow({ storageKey, onClose, closable }: { storageKey: string; onClose: () => void; closable: boolean }) {
  const [country, setCountry] = useState<CountryCode | "ASK">("PE");
  const [channel, setChannel] = useState<TestChannel>("whatsapp");
  /** Modalidad SOLO de esta prueba. "" = la que esté vendiendo de verdad. */
  const [modalidad, setModalidad] = useState<string>("");
  /** CON QUÉ TIENDA SE PRUEBA. "" = sin tienda, el bot de siempre.
   *
   *  Lo pidió el dueño el 01/10/2026: «no puedo probar en celular, me van a cobrar
   *  por conversación». La prueba entra con el MISMO dato que un cliente real —el
   *  número de la tienda, o su página en Messenger— así que el motor se comporta
   *  igual que en vivo. */
  const [tienda, setTienda] = useState<string>("");
  const [tiendas, setTiendas] = useState<TiendaDePrueba[]>([]);
  /** LA RUTA DEL RUTEADOR de esta prueba (10/11/2026): «ruteador|ruta». "" = al azar, como en vivo.
   *  Él: «en el simulador solo se puede elegir tienda y país, necesito que se pueda elegir el camino del ruteador». */
  const [ruta, setRuta] = useState<string>("");
  const [ruteadores, setRuteadores] = useState<RuteadorDePrueba[]>([]);
  const [name, setName] = useState("Cliente de prueba");
  const [sessions, setSessions] = useState<SessionMap>({});
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [draft, setDraft] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pendingSends, setPendingSends] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const chatPanelRef = useRef<HTMLDivElement | null>(null);
  const pinnedToBottomRef = useRef(true);
  const previousUnstartedChannelRef = useRef<TestChannel>("whatsapp");
  const lsKey = `${STORAGE_KEY}:${storageKey}`;

  // LENTO CON VARIAS VENTANAS (29/10/2026): cada ventana pide su chat cada segundo y se redibujaba entera
  // aunque no hubiera nada nuevo. Ahora solo se redibuja si la respuesta cambió.
  const ultimaRespuestaRef = useRef<string>("");
  const load = useCallback(async (id = sessionId) => {
    if (!id) return;
    const res = await fetch(`/api/test-simulator/${id}`, { cache: "no-store" });
    if (!res.ok) return;
    const texto = await res.text();
    if (texto === ultimaRespuestaRef.current) return;
    ultimaRespuestaRef.current = texto;
    setSnapshot(JSON.parse(texto) as Snapshot);
  }, [sessionId]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(lsKey) ?? "{}") as {
        sessions?: SessionMap;
        activeKey?: string | null;
      };
      const restoredSessions = saved.sessions ?? {};
      setSessions(restoredSessions);
      if (saved.activeKey && restoredSessions[saved.activeKey]) {
        const [savedChannel, savedCountry] = saved.activeKey.split(":");
        if (savedChannel === "whatsapp" || savedChannel === "messenger") {
          setChannel(savedChannel);
          if (savedCountry === "ASK" || COUNTRIES.some((item) => item.code === savedCountry)) {
            setCountry(savedCountry as CountryCode | "ASK");
          }
          setSessionId(restoredSessions[saved.activeKey] ?? null);
        }
      }
    } catch {
      localStorage.removeItem(lsKey);
    } finally {
      setRestoring(false);
    }
  }, [lsKey]);

  useEffect(() => {
    if (restoring) return;
    localStorage.setItem(
      lsKey,
      JSON.stringify({
        sessions,
        activeKey: sessionId ? keyFor(channel, country, tienda, ruta) : null,
      })
    );
  }, [channel, country, tienda, ruta, restoring, sessionId, sessions, lsKey]);

  // LAS RUTAS DE LOS RUTEADORES de la tienda, el canal y el país elegidos (las del Inicio de ese país).
  useEffect(() => {
    if (!tienda) { setRuteadores([]); return; }
    let vivo = true;
    const pais = country === "ASK" ? "PE" : country;
    void fetch(`/api/test-simulator?rutas=1&tienda=${encodeURIComponent(tienda)}&canal=${channel}&pais=${pais}`)
      .then((r) => (r.ok ? r.json() : { ruteadores: [] }))
      .then((d) => {
        if (!vivo) return;
        const lista: RuteadorDePrueba[] = Array.isArray(d?.ruteadores) ? d.ruteadores : [];
        setRuteadores(lista);
        // Una ruta que no es de estos Ruteadores (cambió la tienda, el canal o el país) vuelve a «al azar».
        setRuta((r) => (lista.some((x) => x.rutas.some((y) => `${x.id}|${y.id}` === r)) ? r : ""));
      })
      .catch(() => { if (vivo) setRuteadores([]); });
    return () => { vivo = false; };
  }, [tienda, channel, country]);

  // LAS TIENDAS, para poder elegir con cual se prueba. Se piden una sola vez y solo
  // traen el id y el nombre: traerse la configuracion entera por dos campos seria
  // cargar megas para pintar un desplegable.
  useEffect(() => {
    let vivo = true;
    void fetch("/api/test-simulator?tiendas=1")
      .then((r) => (r.ok ? r.json() : { tiendas: [] }))
      .then((d) => {
        if (vivo) setTiendas(Array.isArray(d?.tiendas) ? d.tiendas : []);
      })
      .catch(() => {
        // Sin lista no se puede elegir tienda, pero el simulador sigue sirviendo
        // para todo lo demas: no se le corta la prueba por esto.
      });
    return () => {
      vivo = false;
    };
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (restoring || sessionId) return;
    const previous = previousUnstartedChannelRef.current;
    previousUnstartedChannelRef.current = channel;
    if (previous !== channel && channel === "messenger") setCountry("ASK");
    if (previous !== channel && channel === "whatsapp" && country === "ASK") {
      setCountry("PE");
    }
  }, [channel, country, restoring, sessionId]);
  useEffect(() => {
    if (!sessionId) return;
    const timer = setInterval(() => void load(), 1000);
    return () => clearInterval(timer);
  }, [load, sessionId]);
  useEffect(() => {
    if (pinnedToBottomRef.current) requestAnimationFrame(() => {
      if (chatPanelRef.current) chatPanelRef.current.scrollTop = chatPanelRef.current.scrollHeight;
    });
  }, [snapshot?.messages.length]);

  async function createSession(
    nextChannel = channel,
    nextCountry = country,
    nextTienda = tienda,
    nextRuta = ruta
  ): Promise<number | null> {
    setCreating(true); setError(null);
    try {
      const res = await fetch("/api/test-simulator", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: nextChannel, country: nextCountry === "ASK" ? "" : nextCountry, name, tienda: nextTienda, ruta: nextRuta }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo abrir la prueba");
      const id = Number(data.id);
      setSessions((current) => ({ ...current, [keyFor(nextChannel, nextCountry, nextTienda, nextRuta)]: id }));
      setSessionId(id); setSnapshot(null); setDraft(""); setFile(null); pinnedToBottomRef.current = true;
      return id;
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo abrir la prueba");
      return null;
    } finally { setCreating(false); }
  }

  async function switchTest(nextChannel: TestChannel, nextCountry: CountryCode | "ASK") {
    const resolvedCountry =
      nextChannel === "messenger" && channel !== "messenger"
        ? "ASK"
        : nextChannel === "whatsapp" && nextCountry === "ASK"
          ? "PE"
          : nextCountry;
    // Otro canal u otro país = otros Ruteadores: la ruta vuelve a «al azar».
    setChannel(nextChannel); setCountry(resolvedCountry); setRuta(""); setError(null);
    const known = sessions[keyFor(nextChannel, resolvedCountry, tienda)];
    if (known) { setSessionId(known); setSnapshot(null); pinnedToBottomRef.current = true; return; }
    await createSession(nextChannel, resolvedCountry, tienda, "");
  }

  /**
   * CAMBIA LA TIENDA CON LA QUE SE PRUEBA.
   *
   * Abre una conversación NUEVA, siempre. La tienda se escribe en la conversación al
   * crearla —igual que le llega a un cliente real por su número— así que reusar la de
   * antes sería seguir probando la tienda anterior sin que nada lo dijera.
   */
  async function cambiarTienda(siguiente: string) {
    setTienda(siguiente); setRuta(""); setError(null);
    const known = sessions[keyFor(channel, country, siguiente)];
    if (known) { setSessionId(known); setSnapshot(null); pinnedToBottomRef.current = true; return; }
    await createSession(channel, country, siguiente, "");
  }

  /**
   * CAMBIA LA RUTA DEL RUTEADOR (10/11/2026). Como la tienda, abre una conversación NUEVA: el Ruteador decide
   * al llegar el cliente, así que en la de antes ya decidió.
   */
  async function cambiarRuta(siguiente: string) {
    setRuta(siguiente); setError(null);
    const known = sessions[keyFor(channel, country, tienda, siguiente)];
    if (known) { setSessionId(known); setSnapshot(null); pinnedToBottomRef.current = true; return; }
    await createSession(channel, country, tienda, siguiente);
  }

  /**
   * Fija la modalidad de ESTA prueba. Se guarda en la conversación del
   * simulador, no en la configuración: la modalidad que venden tus clientas
   * queda intacta.
   */
  async function cambiarModalidad(valor: string) {
    if (!sessionId) return;
    setModalidad(valor);
    setError(null);
    try {
      await fetch(`/api/test-simulator/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modality: valor || null }),
      });
    } catch {
      setError("No se pudo cambiar la modalidad de la prueba.");
    }
  }

  async function send(button?: { id: string; title: string }) {
    if (!sessionId || deleting || (!draft.trim() && !file && !button)) return;
    const content = button ? button.title : draft;
    const attachment = file;
    setDraft(""); setFile(null); if (fileInputRef.current) fileInputRef.current.value = "";
    setPendingSends((count) => count + 1); setError(null);
    try {
      const form = new FormData(); form.set("content", content);
      if (attachment) form.set("file", attachment);
      if (button) { form.set("button_id", button.id); form.set("button_title", button.title); }
      const res = await fetch(`/api/test-simulator/${sessionId}/message`, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo enviar el mensaje de prueba");
      await load(sessionId);
    } catch (err) { setError(err instanceof Error ? err.message : "No se pudo enviar el mensaje de prueba"); }
    finally { setPendingSends((count) => Math.max(0, count - 1)); }
  }

  async function deleteCurrent() {
    if (!sessionId || !confirm("¿Eliminar esta conversación de prueba y sus archivos adjuntos?")) return;
    const id = sessionId; setDeleting(true);
    try {
      await fetch(`/api/test-simulator/${id}`, { method: "DELETE" });
      setSessions((current) => {
        const next = { ...current };
        delete next[keyFor(channel, country, tienda, ruta)];
        return next;
      });
      setSessionId(null); setSnapshot(null);
    } finally { setDeleting(false); }
  }

  // Al cerrar la ventana (✕) borramos TODAS las conversaciones que creó (una por
  // país probado) + sus archivos, y limpiamos su localStorage, para NO dejar
  // huérfanos. Luego avisamos al padre para quitar la ventana.
  async function closeWindow() {
    const ids = Object.values(sessions).filter(
      (id): id is number => typeof id === "number"
    );
    const extra = sessionId && !ids.includes(sessionId) ? [sessionId] : [];
    for (const id of [...ids, ...extra]) {
      try { await fetch(`/api/test-simulator/${id}`, { method: "DELETE" }); } catch {}
    }
    try { localStorage.removeItem(lsKey); } catch {}
    onClose();
  }

  const scrollToBottom = () => {
    if (pinnedToBottomRef.current && chatPanelRef.current) {
      chatPanelRef.current.scrollTop = chatPanelRef.current.scrollHeight;
    }
  };
  const messengerCountryUnanswered = channel === "messenger" && country === "ASK";
  const title = channel === "messenger" ? "Messenger de prueba" : "WhatsApp de prueba";

  return (
    <section className="flex h-[calc(100vh-150px)] min-h-[560px] w-full flex-col overflow-hidden rounded-lg border border-neutral-300 bg-[#efeae2] shadow-sm">
      <div className="flex items-center justify-between border-b border-neutral-300 bg-[#075e54] px-3 py-2 text-white">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{title}</div>
          <div className="truncate text-[11px] text-emerald-100">{snapshot ? formatPhone(snapshot.conversation.phone) : sessionId ? "Cargando..." : "Sin abrir"} · sin envío a Meta</div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {snapshot && <a href={`/api/logs?dia=hoy&convo=${snapshot.conversation.id}`} download title="Descargar la conversación completa (cliente y bot) con su log técnico, en un solo archivo" className="rounded border border-white/30 bg-white/10 px-2 py-1 text-[11px] font-medium text-white hover:bg-white/20">📄 Log</a>}
          {sessionId && <button onClick={() => void deleteCurrent()} disabled={deleting} title="Eliminar esta prueba" className="rounded border border-red-200/40 bg-red-500/20 px-2 py-1 text-[11px] font-medium text-white hover:bg-red-500/40">🗑</button>}
          {closable && <button onClick={() => { if (confirm("¿Cerrar esta ventana? Se borra su conversación de prueba y sus archivos.")) void closeWindow(); }} title="Cerrar ventana (borra la prueba y sus archivos)" className="rounded border border-white/30 bg-white/10 px-2 py-1 text-[11px] font-medium text-white hover:bg-white/20">✕</button>}
        </div>
      </div>
      {restoring ? (
        <p className="flex-1 py-16 text-center text-sm text-neutral-500">Recuperando...</p>
      ) : !sessionId ? (
        <div className="flex-1 overflow-y-auto p-4">
          <h2 className="text-sm font-semibold text-neutral-800">Abrir prueba</h2>
          <label className="mt-3 block text-xs font-medium text-neutral-700">Canal
            <select value={channel} onChange={(event) => setChannel(event.target.value as TestChannel)} className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm">
              <option value="whatsapp">WhatsApp</option>
              <option value="messenger">Messenger</option>
            </select>
          </label>
          <label className="mt-3 block text-xs font-medium text-neutral-700">País{channel === "messenger" && <span className="ml-1 font-normal text-neutral-500">(puedes dejarlo sin responder)</span>}
            <select value={country} onChange={(event) => setCountry(event.target.value as CountryCode | "ASK")} className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm">
              {channel === "messenger" && <option value="ASK">El cliente aún no indicó país</option>}
              {COUNTRIES.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
            </select>
          </label>
          {/* CON QUÉ TIENDA SE PRUEBA.
              Lo pidió el dueño el 01/10/2026: «no puedo probar en celular, me van a
              cobrar por conversación». Solo aparece si hay tiendas creadas: sin
              ellas, un desplegable vacío sobra en la pantalla. */}
          {tiendas.length > 0 && (
            <label className="mt-3 block text-xs font-medium text-neutral-700">Tienda
              <BuscadorDeTiendas tiendas={tiendas} valor={tienda} alElegir={setTienda} />
              {/* SI ESA TIENDA NO ATIENDE ESTE CANAL, SE DICE ANTES DE PROBAR.
                  Sin esto la prueba sale sin tienda y parece que el bot la ignora. */}
              {(() => {
                const elegida = tiendas.find((t) => t.id === tienda);
                if (!elegida) return null;
                const falta =
                  channel === "whatsapp" ? !elegida.tieneNumero : !elegida.tienePagina;
                if (!falta) return null;
                return (
                  <span className="mt-1 block text-[11px] font-semibold text-amber-700">
                    ⚠ Esta tienda no tiene{" "}
                    {channel === "whatsapp" ? "número de WhatsApp" : "página de Facebook"}
                    , así que en este canal la prueba saldrá sin tienda.
                  </span>
                );
              })()}
            </label>
          )}
          {ruteadores.length > 0 && (
            <label className="mt-3 block text-xs font-medium text-neutral-700">Ruta del Ruteador
              <SelectorDeRuta ruteadores={ruteadores} valor={ruta} alElegir={setRuta} className="mt-1 w-full rounded-md border border-sky-300 bg-sky-50 px-3 py-2 text-sm text-sky-900" />
            </label>
          )}
          <label className="mt-3 block text-xs font-medium text-neutral-700">Nombre
            <input value={name} onChange={(event) => setName(event.target.value)} className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm" />
          </label>
          <button onClick={() => void createSession()} disabled={creating} className="mt-4 w-full rounded-md bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white">{creating ? "Abriendo..." : "Abrir chat de prueba"}</button>
          {error && <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
        </div>
      ) : (
        <>
          <div ref={chatPanelRef} onScroll={(event) => { const el = event.currentTarget; pinnedToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 72; }} className="flex-1 space-y-3 overflow-y-auto p-3">
            {(snapshot?.messages ?? []).length === 0 ? <p className="pt-12 text-center text-sm text-neutral-500">Escribe como cliente para iniciar la prueba.</p> : snapshot?.messages.map((message) => <div key={message.id} className="space-y-2"><MessageBubble message={message} channel={channel} customerView onMediaLoad={scrollToBottom} />{message.role === "assistant" && (snapshot.buttons[String(message.id)] ?? []).length > 0 && (
  // Apilados, como los pinta WhatsApp. Antes salían en fila y no se parecía a
  // lo que ve el cliente.
  <div className="flex max-w-[75%] flex-col gap-1">
    {(snapshot.buttons[String(message.id)] ?? []).map((button) => <button key={button.id} onClick={() => void send(button)} disabled={deleting || pendingSends > 0} className="w-full rounded-lg border border-sky-300 bg-tarjeta px-3 py-2 text-center text-sm font-medium text-sky-800">{button.title}</button>)}
  </div>
)}</div>)}
          </div>
          <div className="border-t border-neutral-300 bg-tarjeta p-2">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <select value={channel} onChange={(event) => void switchTest(event.target.value as TestChannel, event.target.value === "whatsapp" && country === "ASK" ? "PE" : country)} className="rounded-md border border-neutral-300 px-2 py-1 text-xs"><option value="whatsapp">WhatsApp</option><option value="messenger">Messenger</option></select>
              <select value={country} onChange={(event) => void switchTest(channel, event.target.value as CountryCode | "ASK")} className="rounded-md border border-neutral-300 px-2 py-1 text-xs">{channel === "messenger" && <option value="ASK">País: sin responder</option>}{COUNTRIES.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select>
              {/* LA TIENDA DE ESTA PRUEBA, al lado del canal y el país.
                  Cambiarla abre una conversación nueva: la tienda se escribe al
                  crearla, igual que le llega a un cliente por su número. */}
              {tiendas.length > 0 && (
                <BuscadorDeTiendas compacto tiendas={tiendas} valor={tienda} alElegir={(id) => void cambiarTienda(id)} />
              )}
              {/* LA RUTA DEL RUTEADOR de esta prueba. Cambiarla abre una conversación nueva. */}
              {ruteadores.length > 0 && (
                <SelectorDeRuta ruteadores={ruteadores} valor={ruta} alElegir={(r) => void cambiarRuta(r)} className="rounded-md border border-sky-300 bg-sky-50 px-2 py-1 text-xs text-sky-900" />
              )}
              {/* MODO TESTEADOR: la modalidad de ESTA prueba. No toca la que
                  venden tus clientas — esa vive en la configuración. */}
              <select
                value={modalidad}
                onChange={(event) => void cambiarModalidad(event.target.value)}
                title="Modalidad SOLO para esta prueba. Tus clientas siguen con la que esté vendiendo."
                className="rounded-md border border-violet-300 bg-violet-50 px-2 py-1 text-xs text-violet-800"
              >
                <option value="">Modalidad: la que vende</option>
                <option value="lineal">Probar Lineal</option>
                <option value="order_bump">Probar Order Bump</option>
                <option value="bioferta">Probar Doble Oferta</option>
                <option value="doble_oferta_dos">Probar Doble Oferta 2 Prod</option>
                <option value="doble_oferta_upsell">
                  Probar Doble Oferta + Upsell
                </option>
              <option value="upsell">Probar Upsell</option>
              </select>
            </div>
            {modalidad && (
              <p className="mb-2 rounded-md border border-violet-200 bg-violet-50 px-2 py-1 text-[11px] text-violet-800">
                Esta prueba corre en otra modalidad. Tus clientas no se ven afectadas.
              </p>
            )}
            {file
              ? <AdjuntoElegido file={file} alQuitar={() => { setFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }} />
              : <div className="mb-2 text-[11px] text-neutral-500">{messengerCountryUnanswered ? "Escribe el país (con o sin error)." : "Imagen, audio, video o PDF."}</div>}
            <div className="flex gap-2">
              <input ref={fileInputRef} type="file" accept="image/*,audio/*,video/*,application/pdf" className="hidden" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
              <button type="button" onClick={() => fileInputRef.current?.click()} title={file ? `Adjunto listo: ${file.name}` : "Adjuntar imagen, audio, video o PDF"} className={`relative rounded-md border px-2 text-sm ${file ? "border-emerald-500 bg-emerald-50" : "border-neutral-300"}`}>📎{file && <span className="absolute -right-1.5 -top-1.5 rounded-full bg-emerald-600 px-1.5 text-[10px] font-bold leading-4 text-white">1</span>}</button>
              <textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} rows={2} placeholder="Escribe como cliente..." className="min-h-10 flex-1 resize-y rounded-md border border-neutral-300 px-2 py-1.5 text-sm" />
              <button onClick={() => void send()} disabled={deleting} className="rounded-md bg-emerald-600 px-3 text-sm font-medium text-white">➤</button>
            </div>
            <div className="mt-1 text-[11px] text-neutral-500">{pendingSends > 0 ? "Procesando..." : snapshot?.conversation.state ? `Estado: ${snapshot.conversation.state}` : "Listo"}</div>
            {error && <p className="mt-1 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-700">{error}</p>}
          </div>
        </>
      )}
    </section>
  );
}

const WINDOWS_KEY = "multiagente:test-simulator:windows:v1";

export default function SimulatorPage() {
  const [windows, setWindows] = useState<string[]>(["win-1"]);
  // Restaura las ventanas abiertas al recargar (para no perder referencia a sus
  // conversaciones/archivos y no dejar huérfanos).
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(WINDOWS_KEY) ?? "null");
      if (Array.isArray(saved) && saved.length > 0) {
        setWindows(saved.filter((k) => typeof k === "string"));
      }
    } catch { /* ignora */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem(WINDOWS_KEY, JSON.stringify(windows)); } catch { /* ignora */ }
  }, [windows]);
  const addWindow = () => setWindows((current) => [...current, `win-${Date.now()}`]);
  const removeWindow = (key: string) => setWindows((current) => (current.length > 1 ? current.filter((k) => k !== key) : current));

  return (
    <div className="min-h-screen bg-neutral-100 text-neutral-900">
      <header className="border-b border-neutral-200 bg-tarjeta px-4 py-3">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold">Simulador de ventas</h1>
            <p className="text-xs text-neutral-500">Prueba aislada: no envía mensajes, eventos ni archivos a Meta. Agrega ventanas para comparar en paralelo.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={addWindow} className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">➕ Agregar ventana</button>
            <a href="/api/logs?dia=hoy" download title="Descargar el log completo de hoy (todas las conversaciones)" className="rounded-md border border-neutral-300 px-3 py-2 text-xs font-medium">📄 Log de hoy</a>
            <Link href="/editor" className="rounded-md border border-neutral-300 px-3 py-2 text-xs font-medium">Volver al editor</Link>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1600px] p-4">
        <div className="flex gap-4 overflow-x-auto pb-2">
          {windows.map((key) => (
            <div key={key} className="shrink-0 resize-x overflow-hidden rounded-lg" style={{ width: 390, minWidth: 300, maxWidth: 720 }}>
              <TestWindow storageKey={key} onClose={() => removeWindow(key)} closable={windows.length > 1} />
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
