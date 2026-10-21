"use client";

/**
 * EL ASISTENTE DE CONEXIÓN (20/10/2026). «Meta Connect es mi Waterloo… necesito una guía con
 * cajones y continuar, continuar». Acordado el 19/10 y afinado el 20/10:
 *
 *  · LA APP ES SOLO LA PUERTA. Va aparte y una sola vez: su ID y su clave. La URI y los
 *    webhooks se llenan solos (botón «Copiar» con la dirección completa).
 *  · Por esa puerta entran las cuentas de Facebook (la suya y las de sus probadoras).
 *  · LOS NÚMEROS VIVEN EN LOS NEGOCIOS, NO EN LA APP. Se agregan y se activan aquí, sin
 *    entrar al panel de la app. Un negocio sin verificar admite 2; verificado, hasta 20.
 *
 * SOLO PANTALLA: usa los mismos servicios que el resto de Meta Connect (guardar la app,
 * «Preparar mi app», iniciar sesión, suscribir) y la ruta nueva de números. No toca el motor,
 * ni cambia el número activo, ni reconecta nada. La pantalla de siempre sigue debajo.
 *
 * Lo que solo puede hacer una persona (crear la app, pegar la URI, ponerla en vivo) va con
 * casillas que BLOQUEAN «Continuar»: Meta no deja comprobarlo desde fuera.
 */

import { useCallback, useEffect, useState } from "react";

type Paso = "inicio" | "app" | "facebook" | "numeros" | "token" | "listo" | "cerrar";
const CAMINO: Paso[] = ["app", "facebook", "numeros", "token", "listo"];
const CLAVE = "meta-asistente";

interface Numero {
  id: string;
  numero: string;
  nombre: string;
  estado: "activo" | "sin_activar" | "sin_verificar";
  suscritoAqui: boolean;
}
interface Negocio {
  id: string;
  nombre: string;
  verificado: boolean;
  cuentas: Array<{ id: string; nombre: string; otrasApps: string[]; estaApp: boolean; numeros: Numero[] }>;
}

function leer(): { paso: Paso; casillas: Record<string, boolean> } | null {
  try {
    const v = JSON.parse(localStorage.getItem(CLAVE) ?? "null");
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}
function guardar(v: { paso: Paso; casillas: Record<string, boolean> } | null) {
  try {
    if (v) localStorage.setItem(CLAVE, JSON.stringify(v));
    else localStorage.removeItem(CLAVE);
  } catch {}
}

function Copiar({ texto }: { texto: string }) {
  const [hecho, setHecho] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-md border border-neutral-300 bg-neutral-50 px-2 py-1.5">
      <code className="min-w-0 flex-1 truncate text-xs">{texto}</code>
      <button
        type="button"
        className="shrink-0 rounded bg-sky-600 px-2 py-1 text-xs font-bold text-white hover:bg-sky-700"
        onClick={() => {
          void navigator.clipboard?.writeText(texto);
          setHecho(true);
          setTimeout(() => setHecho(false), 1500);
        }}
      >
        {hecho ? "✓ Copiado" : "Copiar"}
      </button>
    </div>
  );
}

function Casilla({ id, texto, casillas, marcar }: { id: string; texto: React.ReactNode; casillas: Record<string, boolean>; marcar: (id: string, v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-sm">
      <input type="checkbox" className="mt-0.5 h-4 w-4" checked={!!casillas[id]} onChange={(e) => marcar(id, e.target.checked)} />
      <span>{texto}</span>
    </label>
  );
}

export default function AsistenteDeConexion() {
  const [abierto, setAbierto] = useState(false);
  const [paso, setPaso] = useState<Paso>("inicio");
  const [casillas, setCasillas] = useState<Record<string, boolean>>({});
  const [aviso, setAviso] = useState<string | null>(null);

  // Lo que ya hay: la app y lo conectado.
  const [estado, setEstado] = useState<{ appId: string | null; appName: string | null; paginas: number; numeros: number } | null>(null);
  /** null = hay token (o aún no se sabe); con valor = falta, y cuándo caduca la conexión. */
  const [sinToken, setSinToken] = useState<{ vence: number | null; faltan: number; cuales: string[] } | null>(null);
  useEffect(() => {
    void (async () => {
      try {
        const d = await (await fetch("/api/meta/connect/token-estado?ligero=1", { cache: "no-store" })).json();
        setSinToken(
          d.appId && !d.tiene && d.faltan > 0
            ? {
                vence: d.vence ?? null,
                faltan: d.faltan,
                // «No me indica cuáles son los números ni qué BM» (21/10/2026).
                cuales: (d.numeros ?? [])
                  .filter((n: { permanente: boolean; enUso?: boolean }) => n.enUso !== false && !n.permanente)
                  .map((n: { numero: string; negocio: string | null }) => `${n.numero}${n.negocio ? ` (${n.negocio})` : ""}`),
              }
            : null
        );
      } catch {}
    })();
  }, [paso]);
  const cargarEstado = useCallback(async () => {
    try {
      const r = await fetch("/api/meta/connect/status", { cache: "no-store" });
      const d = await r.json();
      setEstado({
        appId: d.appId ?? null,
        appName: d.appName ?? null,
        paginas: (d.connections ?? []).length + (d.detectedPages ?? []).length,
        numeros: (d.whatsAppConnections ?? []).length,
      });
    } catch {}
  }, []);

  // Al volver de Facebook, sigue donde quedó.
  useEffect(() => {
    const guardado = leer();
    const p = new URLSearchParams(window.location.search);
    if (guardado) {
      setCasillas(guardado.casillas ?? {});
      if (p.get("error")) {
        const error = p.get("error") ?? "";
        // SIN APP, A «MI APP» (21/10/2026): tras cerrar sesión, el aviso decía «primero conecta tu
        // app» pero dejaba la pantalla de Facebook. Se contradecía.
        const sinApp = /Primero conecta tu app/i.test(error);
        setPaso(sinApp || /bloquead|redirect|URL/i.test(error) ? "app" : "facebook");
        setAviso(
          sinApp
            ? "Primero conecta tu app. Después inicias sesión con Facebook."
            : /bloquead|redirect|URL/i.test(error)
            ? "Meta rechazó el inicio de sesión: la URI no está pegada o tiene un error. Cópiala otra vez y pégala en tu app."
            : /\(#(4|17|32|613)\)|request limit/i.test(error)
              ? // (#4) y familia: Meta frenó la app por muchas consultas seguidas (21/10/2026).
                "Meta frenó tu app un rato por hacer muchas consultas seguidas. No se rompió nada: espera 1 hora sin abrir Meta Connect y vuelve a intentarlo."
              : `Meta respondió: ${error}`
        );
        setAbierto(true);
      } else if (p.get("connected") !== null) {
        setPaso("numeros");
        setAbierto(true);
      } else {
        setPaso(guardado.paso);
      }
    }
    void cargarEstado();
  }, [cargarEstado]);

  const ir = (nuevo: Paso) => {
    setAviso(null);
    setPaso(nuevo);
    guardar({ paso: nuevo, casillas });
  };
  const marcar = (id: string, v: boolean) => {
    const c = { ...casillas, [id]: v };
    setCasillas(c);
    guardar({ paso, casillas: c });
  };
  const cerrar = () => {
    setAbierto(false);
    guardar(null);
  };

  return (
    <>
      {/* SIN TOKEN PERMANENTE, AVISO FIJO (20/10/2026): «no generarlo es dejar que el proyecto se
          caiga». No se va hasta que se crea. Con la fecha real en que caduca la conexión. */}
      {sinToken && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border-2 border-red-400 bg-red-50 p-3 text-sm text-red-900">
          <span className="min-w-0 flex-1">
            ⚠ <b>{sinToken.faltan === 1 ? "1 número sin token permanente." : `${sinToken.faltan} números sin token permanente.`}</b>{" "}
            {sinToken.vence ? <>Caducan el <b>{fecha(sinToken.vence)}</b> y el bot dejará de contestar por ellos.</> : "Caducarán y el bot dejará de contestar por ellos."}
            <span className="mt-1 block text-xs text-red-800">{sinToken.cuales.join(" · ")}</span>
          </span>
          <button
            type="button"
            className="rounded-lg bg-red-600 px-3 py-1.5 font-bold text-white hover:bg-red-700"
            onClick={() => {
              setAbierto(true);
              ir("token");
            }}
          >
            Crearlo ahora
          </button>
        </div>
      )}
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border-2 border-sky-400 bg-sky-50 p-4">
        <div className="min-w-0 flex-1">
          <div className="text-base font-bold text-sky-900">🧭 Conectar paso a paso</div>
          <div className="text-xs text-sky-900/80">
            {estado?.appId ? `App: ${estado.appName ?? estado.appId} · ` : "Sin app todavía · "}
            {estado ? `${estado.numeros} número(s) · ${estado.paginas} página(s)` : "…"}
          </div>
        </div>
        <button
          type="button"
          className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-bold text-white hover:bg-sky-700"
          onClick={() => {
            // Siempre empieza por «¿Qué deseas hacer?».
            setAbierto(true);
            ir("inicio");
          }}
        >
          Abrir asistente
        </button>
      </div>

      {abierto && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={(e) => e.target === e.currentTarget && setAbierto(false)}>
          <div className="mt-8 w-full max-w-2xl rounded-xl bg-white p-5 text-neutral-800 shadow-2xl">
            <div className="mb-3 flex items-center gap-3">
              <div className="text-lg font-bold">🧭 Conectar paso a paso</div>
              <div className="ml-auto flex gap-1">
                {CAMINO.map((p, i) => (
                  <span key={p} className={`h-2 w-8 rounded-full ${p === paso ? "bg-sky-600" : CAMINO.indexOf(paso) > i ? "bg-sky-300" : "bg-neutral-200"}`} />
                ))}
              </div>
              <button type="button" className="rounded px-2 text-xl leading-none text-neutral-500 hover:bg-neutral-100" onClick={() => setAbierto(false)} title="Cerrar (sigue donde quedaste)">
                ✕
              </button>
            </div>
            {aviso && <div className="mb-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{aviso}</div>}

            {paso === "inicio" && (
              // «¿QUÉ DESEAS HACER?» (21/10/2026): cada tarea consulta a Meta solo lo suyo. Las que
              // más se usan, grandes y arriba; las de una vez, chicas abajo.
              <div className="space-y-2">
                <p className="text-sm font-semibold text-neutral-700">¿Qué deseas hacer?</p>
                {[
                  ["numeros", "📱 Agregar o activar un número", "Eliges el BM y solo se consulta ese."],
                  ["token", "🔐 Crear token permanente", "Para que tus números no caduquen."],
                  ["pagina", "📘 Elegir página de Facebook", "La que responde Messenger y registra tus compras."],
                  ["pixel", "📈 Elegir píxel", "El que mide tus compras en Meta."],
                ].map(([p, t, d]) => (
                  <button
                    key={p}
                    type="button"
                    className="block w-full rounded-xl border border-neutral-200 bg-white p-3 text-left shadow-sm transition hover:border-sky-400 hover:bg-sky-50"
                    onClick={() => {
                      // Página y píxel ya tienen su ventana abajo: se abre esa, sin consultar nada más.
                      if (p === "pagina" || p === "pixel") {
                        setAbierto(false);
                        window.dispatchEvent(new CustomEvent("meta-connect:abrir", { detail: p === "pagina" ? "Páginas de Facebook" : "Píxel" }));
                        return;
                      }
                      ir(p as Paso);
                    }}
                  >
                    <div className="font-bold">{t}</div>
                    <div className="text-xs text-neutral-600">{d}</div>
                  </button>
                ))}
                <div className="grid gap-2 pt-1 sm:grid-cols-3">
                  {[
                    ["app", "🔑 Mi app"],
                    ["facebook", "👤 Iniciar sesión"],
                    ["listo", "✅ Revisar todo"],
                  ].map(([p, t]) => (
                    <button key={p} type="button" className="rounded-lg border border-neutral-200 px-3 py-2 text-sm font-semibold text-neutral-700 hover:border-sky-400 hover:bg-sky-50" onClick={() => ir(p as Paso)}>
                      {t}
                    </button>
                  ))}
                </div>
                {/* Solo con algo conectado: sin app no hay sesión que cerrar. */}
                {(estado?.appId || (estado?.numeros ?? 0) > 0 || (estado?.paginas ?? 0) > 0) && (
                  <div className="pt-2 text-right">
                    <button type="button" className="text-xs font-semibold text-red-700 hover:underline" onClick={() => ir("cerrar")}>
                      🚪 Cerrar sesión de Meta
                    </button>
                  </div>
                )}
              </div>
            )}

            {paso === "app" && <PasoApp casillas={casillas} marcar={marcar} alListo={() => { void cargarEstado(); ir("facebook"); }} volver={() => ir("inicio")} />}

            {/* SIN APP NO HAY INICIO DE SESIÓN (21/10/2026): el botón de Facebook parpadeaba y volvía
                al mismo sitio. Primero la app. */}
            {paso === "facebook" && estado && !estado.appId && (
              <div className="space-y-3 text-sm">
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
                  Para iniciar sesión con Facebook, <b>primero conecta tu app</b>. Es lo que abre la puerta.
                </div>
                <button type="button" className="rounded-lg bg-sky-600 px-4 py-2 font-semibold text-white hover:bg-sky-700" onClick={() => ir("app")}>
                  🔑 Conectar mi app
                </button>
                <div>
                  <button type="button" className="text-sm text-neutral-500 hover:underline" onClick={() => ir("inicio")}>← Atrás</button>
                </div>
              </div>
            )}

            {paso === "facebook" && !(estado && !estado.appId) && (
              <div className="space-y-3 text-sm">
                <p>Entra con tu Facebook. En la ventana de Meta, marca tus negocios, páginas y números para que tu CRM pueda verlos.</p>
                <a href="/api/meta/connect/start" onClick={() => guardar({ paso: "numeros", casillas })} className="block rounded-lg bg-[#1877f2] px-4 py-3 text-center font-bold text-white hover:opacity-90">
                  Iniciar sesión con Facebook
                </a>
                <a href="/api/meta/connect/start?nueva=1" onClick={() => guardar({ paso: "numeros", casillas })} className="block rounded-lg border border-neutral-300 px-4 py-2 text-center font-semibold hover:bg-neutral-50">
                  ➕ Agregar otra cuenta de Facebook
                </a>
                <p className="text-xs text-neutral-600">
                  Otra persona entra con <b>su</b> Facebook por tu misma app. Mientras tu app no pase la revisión de Meta, esa persona tiene que estar en tu app como <b>probadora</b> (Roles de la app → Probadores). Si ya estás conectado a Facebook en este navegador, usa una ventana de incógnito.
                </p>
                {estado?.appId && (
                  <a href={`https://developers.facebook.com/apps/${estado.appId}/roles/roles/`} target="_blank" rel="noreferrer" className="inline-block text-xs text-sky-700 hover:underline">
                    Abrir «Roles» de mi app para agregar una probadora ↗
                  </a>
                )}
                <div className="flex justify-between">
                  <button type="button" className="text-sm text-neutral-500 hover:underline" onClick={() => ir("app")}>← Atrás</button>
                  <button type="button" className="text-sm text-sky-700 hover:underline" onClick={() => ir("numeros")}>Ya inicié sesión → Continuar</button>
                </div>
              </div>
            )}

            {paso === "numeros" && <PasoNumeros volver={() => ir("facebook")} seguir={() => { void cargarEstado(); ir("token"); }} />}

            {paso === "cerrar" && <PasoCerrarSesion volver={() => ir("inicio")} />}

            {paso === "token" && <PasoToken volver={() => ir("numeros")} seguir={() => ir("listo")} />}

            {paso === "listo" && <PasoListo estado={estado} volver={() => ir("token")} cerrar={cerrar} />}
          </div>
        </div>
      )}
    </>
  );
}

/**
 * LA APP, PASO A PASO DE VERDAD (20/10/2026): «paso a paso debería ser PASO A PASO… tener eso ahí
 * me confunde, es como un bypass». Una cosa por pantalla; la siguiente no aparece hasta terminar
 * la anterior, y «Continuar» solo se activa cuando está hecha.
 */
type SubPaso = "elegir" | "crear" | "claves" | "preparar" | "permiso" | "datos" | "productos" | "uri" | "vivo";

function PasoApp({ casillas, marcar, alListo, volver }: { casillas: Record<string, boolean>; marcar: (id: string, v: boolean) => void; alListo: () => void; volver: () => void }) {
  const [sub, setSub] = useState<SubPaso>("elegir");
  const [historial, setHistorial] = useState<SubPaso[]>([]);
  const [appId, setAppId] = useState("");
  const [clave, setClave] = useState("");
  const [app, setApp] = useState<{ appId?: string; nombre?: string | null } | null>(null);
  const [pasos, setPasos] = useState<string[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const origen = typeof window !== "undefined" ? window.location.origin : "";
  const uri = `${origen}/api/meta/connect/callback`;
  const id = app?.appId ?? "";

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch("/api/meta/connect/app", { cache: "no-store" });
        const d = await r.json();
        if (d.configurada) setApp(d);
      } catch {}
    })();
  }, []);

  const ir = (s: SubPaso) => {
    setError(null);
    setHistorial((h) => [...h, sub]);
    setSub(s);
  };
  const atras = () => {
    setError(null);
    if (historial.length === 0) return volver();
    setSub(historial[historial.length - 1]);
    setHistorial((h) => h.slice(0, -1));
  };

  /**
   * «Preparar mi app»: webhooks, dominio y privacidad, solos. Si la app ya manda sus mensajes a
   * OTRA dirección (otro bot), se pregunta antes. Según lo que conteste Meta, lleva a la pantalla
   * que toca: el permiso de la app, los datos a mano, o la URI.
   */
  /** Por objeto de Meta (whatsapp_business_account / page / instagram): ¿aceptó configurarlo? */
  const [productos, setProductos] = useState<Record<string, { ok: boolean; detalle: string }> | null>(null);
  const [comprobando, setComprobando] = useState(false);
  async function comprobarProductos() {
    setComprobando(true);
    try {
      // COMPROBAR TAMBIÉN CONFIGURA: los mensajes de la app pasan a llegar a ESTE proyecto. Si hoy
      // le llegan a otro, ese otro se quedaría sin mensajes: se avisa antes, como en «preparar».
      const ahora = await (await fetch("/api/meta/connect/configurar-app", { cache: "no-store" })).json();
      const propias = new Set((ahora.urlsPropuestas ?? []).map((p: { url: string }) => p.url));
      const ajenas = (ahora.suscripciones ?? []).filter((s: { url: string }) => s.url && !propias.has(s.url)) as Array<{ url: string }>;
      if (
        ajenas.length &&
        !window.confirm(
          `⛔ Tu app hoy entrega sus mensajes a OTRO proyecto:\n${ajenas.map((a) => a.url).join("\n")}\n\nSi sigues, ese proyecto DEJA DE RECIBIR MENSAJES y sus clientes no tendrán respuesta.\n\n¿Seguir de todos modos?`
        )
      ) {
        setComprobando(false);
        return;
      }
      const d = (await (await fetch("/api/meta/connect/configurar-app", { method: "POST" })).json()) as {
        pasos?: Array<{ paso: string; ok: boolean; detalle: string }>;
        error?: string;
      };
      const r: Record<string, { ok: boolean; detalle: string }> = {};
      for (const p of d.pasos ?? []) {
        const objeto = p.paso.match(/^Webhook de (\S+)/)?.[1];
        if (objeto) r[objeto] = { ok: p.ok, detalle: p.detalle };
      }
      if (!Object.keys(r).length) r.whatsapp_business_account = { ok: false, detalle: d.error ?? "Meta no respondió." };
      setProductos(r);
    } catch {
      setProductos({ whatsapp_business_account: { ok: false, detalle: "No se pudo consultar a Meta." } });
    } finally {
      setComprobando(false);
    }
  }

  async function preparar() {
    setOcupado(true);
    setError(null);
    try {
      const ahora = await (await fetch("/api/meta/connect/configurar-app", { cache: "no-store" })).json();
      const propias = new Set((ahora.urlsPropuestas ?? []).map((p: { url: string }) => p.url));
      const ajenas = (ahora.suscripciones ?? []).filter((s: { url: string }) => s.url && !propias.has(s.url)) as Array<{ url: string }>;
      if (
        ajenas.length > 0 &&
        !window.confirm(
          `⛔ Tu app hoy entrega sus mensajes a OTRO proyecto:\n${ajenas.map((s) => s.url).join("\n")}\n\nSi sigues, ese proyecto DEJA DE RECIBIR MENSAJES y sus clientes no tendrán respuesta.\n\n¿Seguir de todos modos?`
        )
      )
        return;
      const c = await (await fetch("/api/meta/connect/configurar-app", { method: "POST" })).json();
      const lista = (c.pasos ?? []) as Array<{ paso: string; ok: boolean; detalle: string }>;
      // (Con su razón cuando falla: un «❌» solo no dice qué hacer.)
      setPasos(lista.map((p) => `${p.ok ? "✅" : "❌"} ${p.paso}${p.ok ? "" : ` — ${p.detalle}`}`));
      const dominio = lista.find((p) => !p.ok && /Dominio/.test(p.paso));
      const otroFallo = lista.find((p) => !p.ok && !/Dominio/.test(p.paso));
      if (otroFallo) {
        setError(`Meta no dejó preparar la app: ${otroFallo.paso} — ${otroFallo.detalle}`);
        return;
      }
      // (#10): la app tiene apagado «Permitir acceso a la API para la configuración de la app».
      if (dominio && /\(#10\)|app settings through API|advanced settings/i.test(dominio.detalle)) ir("permiso");
      else if (dominio) ir("datos");
      else ir("productos");
    } catch {
      setError("No se pudo consultar a Meta.");
    } finally {
      setOcupado(false);
    }
  }

  async function guardarApp() {
    // CAMBIAR DE PUERTA: los números suscritos a la app anterior dejarían de llegar aquí.
    if (
      app?.appId &&
      app.appId !== appId.trim() &&
      !window.confirm(
        `Ya tienes conectada la app «${app.nombre ?? app.appId}». Si pones otra, los números suscritos a la anterior dejarán de llegar a tu CRM hasta que los suscribas a la nueva. ¿Seguir?`
      )
    )
      return;
    setOcupado(true);
    setError(null);
    try {
      const r = await fetch("/api/meta/connect/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ appId: appId.trim(), appSecret: clave.trim() }) });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error ?? "No se pudo guardar.");
      const a = await (await fetch("/api/meta/connect/app", { cache: "no-store" })).json();
      if (!a.nombre) throw new Error(a.avisoNombre ? `Meta no reconoce esa app: ${a.avisoNombre}. Revisa el ID y la clave.` : "Meta no reconoce esa app. Revisa el ID y la clave.");
      setApp(a);
      setClave("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setOcupado(false);
      return;
    }
    setOcupado(false);
    await preparar();
  }

  const Botones = ({ listo, alSeguir, texto = "Continuar →" }: { listo: boolean; alSeguir: () => void; texto?: string }) => (
    <div className="flex justify-between pt-2">
      <button type="button" className="text-neutral-500 hover:underline" onClick={atras}>← Atrás</button>
      <button type="button" disabled={!listo || ocupado} className="rounded-md bg-sky-600 px-4 py-1.5 font-bold text-white disabled:opacity-40" onClick={alSeguir}>
        {texto}
      </button>
    </div>
  );
  const Abrir = ({ href, texto }: { href: string; texto: string }) => (
    <a href={href} target="_blank" rel="noreferrer" className="inline-block rounded-md bg-[#1877f2] px-3 py-1.5 font-bold text-white">
      {texto} ↗
    </a>
  );

  return (
    <div className="space-y-3 text-sm">
      <div className="font-bold">🔑 Tu app: la puerta de tu CRM en Meta</div>
      {error && <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-red-800">❌ {error}</div>}

      {sub === "elegir" && (
        <>
          {app?.nombre && (
            <div className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2">
              ✅ Ya tienes conectada: <b>{app.nombre}</b> <span className="text-xs text-neutral-500">(ID {app.appId})</span>
            </div>
          )}
          <div className="space-y-2">
            {app?.nombre && (
              <button type="button" className="block w-full rounded-lg border-2 border-sky-500 bg-sky-50 p-3 text-left font-bold" onClick={() => ir("preparar")}>
                Seguir con esta app
              </button>
            )}
            <button type="button" className="block w-full rounded-lg border border-neutral-300 p-3 text-left" onClick={() => ir("crear")}>
              Crear una app nueva
            </button>
            <button type="button" className="block w-full rounded-lg border border-neutral-300 p-3 text-left" onClick={() => ir("claves")}>
              {app?.nombre ? "Usar otra app que ya tengo" : "Usar una app que ya tengo"}
            </button>
          </div>
          <Botones listo={false} alSeguir={() => {}} texto="Elige una opción" />
        </>
      )}

      {sub === "crear" && (
        <>
          <div>Crea tu app en Meta. Al terminar, vuelve aquí.</div>
          <Abrir href="https://developers.facebook.com/apps/creation/" texto="Abrir Meta para crear la app" />
          <Casilla id="tipo" casillas={casillas} marcar={marcar} texto={<>La creé de tipo <b>Empresa</b>.</>} />
          {/* EL BM DE LA APP (21/10/2026): es donde se crea el token permanente, y ese token solo
              alcanza los números de su BM. Elegir el de los números ahorra un token después. */}
          <Casilla id="bm" casillas={casillas} marcar={marcar} texto={<>Al crearla elegí <b>el BM donde están mis números</b>.</>} />
          <Botones listo={!!casillas.tipo && !!casillas.bm} alSeguir={() => ir("claves")} />
        </>
      )}

      {sub === "claves" && (
        <>
          <div>
            Pega el <b>ID de la app</b> y su <b>clave secreta</b>. Están en tu app → <i>Configuración de la app → Básica</i> (la clave, con «Mostrar»).
          </div>
          <input className="w-full rounded border border-neutral-300 px-2 py-1.5" placeholder="ID de la app" value={appId} onChange={(e) => setAppId(e.target.value)} />
          <input className="w-full rounded border border-neutral-300 px-2 py-1.5" placeholder="Clave secreta de la app" type="password" value={clave} onChange={(e) => setClave(e.target.value)} />
          <Botones listo={!!appId.trim() && !!clave.trim()} alSeguir={() => void guardarApp()} texto={ocupado ? "Comprobando…" : "Guardar y preparar mi app →"} />
        </>
      )}

      {sub === "preparar" && (
        <>
          <div>
            Preparo tu app <b>{app?.nombre}</b> para este CRM: sus webhooks, su dominio y su política de privacidad. Es automático.
          </div>
          <Botones listo={true} alSeguir={() => void preparar()} texto={ocupado ? "Preparando…" : "Preparar mi app →"} />
        </>
      )}

      {sub === "permiso" && (
        <>
          {pasos.length > 0 && <pre className="whitespace-pre-wrap rounded bg-neutral-50 p-2 text-xs">{pasos.join("\n")}</pre>}
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
            <b>Enciende un permiso de tu app (una sola vez).</b> Tu app no deja que el CRM complete su configuración. En la página que se abre, pon en <b>«Sí»</b>{" "}
            <i>«Permitir acceso a la API para la configuración de la app»</i> y guarda.
          </div>
          <Abrir href={`https://developers.facebook.com/apps/${id}/settings/advanced/`} texto="Abrir ese permiso de mi app" />
          <Botones listo={true} alSeguir={() => void preparar()} texto={ocupado ? "Reintentando…" : "Ya lo encendí → Reintentar"} />
        </>
      )}

      {sub === "datos" && (
        <>
          {pasos.length > 0 && <pre className="whitespace-pre-wrap rounded bg-neutral-50 p-2 text-xs">{pasos.join("\n")}</pre>}
          <div>
            <b>Falta llenar 3 datos de tu app.</b> Ábrela y pega cada uno en su campo; luego «Guardar cambios».
          </div>
          <Abrir href={`https://developers.facebook.com/apps/${id}/settings/basic/`} texto="Abrir «Configuración básica» de mi app" />
          <div className="text-xs">Dominios de la app:</div>
          <Copiar texto={origen.replace(/^https?:\/\//, "")} />
          <div className="text-xs">URL de la política de privacidad:</div>
          <Copiar texto={`${origen}/privacidad`} />
          <div className="text-xs">Sitio web (abajo del todo: «+ Agregar plataforma» → «Sitio web»):</div>
          <Copiar texto={origen} />
          <Casilla id="datos" casillas={casillas} marcar={marcar} texto="Pegué los 3 datos y guardé." />
          <Botones listo={!!casillas.datos} alSeguir={() => ir("productos")} />
        </>
      )}

      {/* LOS PRODUCTOS DE LA APP, OBLIGATORIO (20/10/2026): «hay que agregar Inicio de sesión de
          Facebook para empresas, ese paso falta; un novato no sabrá que hay que crear eso para
          agregar la URI». Sale siempre: una app vieja puede no tenerlos. Meta no deja agregarlos
          desde fuera, ni comprobarlo: por eso las casillas. */}
      {sub === "productos" && (
        <>
          <div>
            <b>Agrega a tu app lo que necesita.</b> En la página que se abre, busca cada uno y pulsa <b>«Configurar»</b>. Si ya lo tiene, solo márcalo.
          </div>
          <Abrir href={`https://developers.facebook.com/apps/${id}/add/`} texto="Abrir «Agregar productos» de mi app" />
          {/* EN ESTE ORDEN (20/10/2026): «primero WhatsApp, luego Messenger, luego IG, y al final lo
              de URI». El Inicio de sesión va en la pantalla siguiente, junto a su URI. */}
          {/* COMPROBADO CON META, NO CON CASILLAS (21/10/2026): «un checklist a mano no dice
              nada, puede mentir». Meta no tiene una pregunta de «qué productos tiene la app»
              (revisado en su referencia), así que se le pide CONFIGURAR cada uno: lo que
              acepta, está; lo que rechaza, falta, y se muestra su respuesta. */}
          <button type="button" disabled={comprobando} className="inline-flex items-center gap-1 rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-sky-700 disabled:opacity-40" onClick={() => void comprobarProductos()}>
            {comprobando ? (
              <>
                Comprobando con Meta
                <Puntos />
              </>
            ) : (
              "🔍 Comprobar"
            )}
          </button>
          {productos && (
            <div className="space-y-1.5">
              {(
                [
                  ["whatsapp_business_account", "WhatsApp", true],
                  ["page", "Messenger", false],
                  ["instagram", "Instagram", false],
                ] as const
              ).map(([clave, nombre, obligatorio]) => {
                const r = productos[clave];
                return (
                  <div key={clave} className="rounded-lg border border-neutral-200 bg-white px-3 py-2">
                    <span className="font-semibold">{r?.ok ? "✅" : "❌"} {nombre}</span>
                    {!r?.ok && (
                      <span className="block text-xs text-neutral-600">
                        {obligatorio ? "Falta: agrégalo a tu app y vuelve a comprobar." : "No se pudo configurar. Si vas a vender por aquí, agrégalo y vuelve a comprobar."}
                        {r?.detalle ? <span className="block text-neutral-400">Meta: {r.detalle}</span> : null}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <Botones listo={!!productos?.whatsapp_business_account?.ok} alSeguir={() => ir("uri")} />
        </>
      )}

      {sub === "uri" && (
        <>
          {pasos.length > 0 && <pre className="whitespace-pre-wrap rounded bg-neutral-50 p-2 text-xs">{pasos.join("\n")}</pre>}
          <div>
            <b>1.</b> Agrega a tu app <b>Inicio de sesión con Facebook para empresas</b> («Configurar»). Sin él no aparece dónde pegar la URI.
          </div>
          <Abrir href={`https://developers.facebook.com/apps/${id}/add/`} texto="Abrir «Agregar productos» de mi app" />
          <Casilla id="p-login" casillas={casillas} marcar={marcar} texto="Lo agregué." />
          {casillas["p-login"] && (
            <>
              <div className="pt-2">
                <b>2. La URI.</b> Ya está completa: cópiala y pégala en <i>«URI de redireccionamiento de OAuth válidos»</i>; luego «Guardar cambios».
              </div>
              <Copiar texto={uri} />
              <Abrir href={`https://developers.facebook.com/apps/${id}/business-login/settings/`} texto="Abrir donde se pega la URI" />
              <Casilla id="uri" casillas={casillas} marcar={marcar} texto="Pegué la URI y guardé." />
            </>
          )}
          <Botones listo={!!casillas["p-login"] && !!casillas.uri} alSeguir={() => ir("vivo")} />
        </>
      )}

      {sub === "vivo" && (
        <>
          <div>
            <b>En vivo.</b> Arriba de tu app, cambia «Modo de la app» a <i>En vivo</i> (o «Publicar»). Meta pide la política de privacidad: tu CRM ya la tiene publicada.
          </div>
          <Abrir href={`https://developers.facebook.com/apps/${id}/settings/basic/`} texto="Abrir mi app para ponerla en vivo" />
          <Casilla id="vivo" casillas={casillas} marcar={marcar} texto="Puse mi app en vivo." />
          <Botones listo={!!casillas.vivo} alSeguir={alListo} />
        </>
      )}
    </div>
  );
}

/** BOTONES QUE PARECEN BOTONES, TODOS IGUALES (21/10/2026): «ese botón no parece botón, parece un
 *  aviso… muy delgado; uniformizar el diseño para entenderlo». */
const BTN = "inline-flex items-center justify-center gap-1 rounded-lg px-3 py-1.5 text-sm font-semibold shadow-sm transition disabled:cursor-not-allowed disabled:opacity-40";
const BTN_AZUL = `${BTN} bg-sky-600 text-white hover:bg-sky-700`;
const BTN_VERDE = `${BTN} bg-emerald-600 text-white hover:bg-emerald-700`;
const BTN_BLANCO = `${BTN} border border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-50`;

/**
 * CUÁNTOS DÍGITOS TIENE UN CELULAR EN CADA PAÍS (21/10/2026). Se agregó +51 9023437000 —un cero de
 * más— y ni el CRM ni Meta lo frenaron: el SMS nunca llega y el número ocupa uno de los 2 lugares
 * del BM. Solo AVISA y pide confirmar; no bloquea (hay números fijos y casos raros).
 */
const DIGITOS_POR_PAIS: Record<string, { largos: number[]; empieza?: string; pais: string }> = {
  "51": { largos: [9], empieza: "9", pais: "Perú" },
  "52": { largos: [10], pais: "México" },
  "54": { largos: [10, 11], pais: "Argentina" },
  "56": { largos: [9], empieza: "9", pais: "Chile" },
  "57": { largos: [10], empieza: "3", pais: "Colombia" },
  "58": { largos: [10], pais: "Venezuela" },
  "591": { largos: [8], pais: "Bolivia" },
  "593": { largos: [9], empieza: "9", pais: "Ecuador" },
  "595": { largos: [9], pais: "Paraguay" },
  "598": { largos: [8, 9], pais: "Uruguay" },
  "502": { largos: [8], pais: "Guatemala" },
  "503": { largos: [8], pais: "El Salvador" },
  "504": { largos: [8], pais: "Honduras" },
  "505": { largos: [8], pais: "Nicaragua" },
  "506": { largos: [8], pais: "Costa Rica" },
  "507": { largos: [8], pais: "Panamá" },
  "1": { largos: [10], pais: "Estados Unidos" },
  "34": { largos: [9], pais: "España" },
};
function avisoDelNumero(cc: string, numero: string): string | null {
  const regla = DIGITOS_POR_PAIS[cc.replace(/\D/g, "")];
  const n = numero.replace(/\D/g, "");
  if (!regla || !n) return null;
  if (!regla.largos.includes(n.length))
    return `Tiene ${n.length} dígitos; en ${regla.pais} un celular tiene ${regla.largos.join(" u ")}. Revísalo: con un dígito de más o de menos, el código nunca llega.`;
  if (regla.empieza && !n.startsWith(regla.empieza)) return `En ${regla.pais} un celular empieza con ${regla.empieza}. Revísalo.`;
  return null;
}

/** «hace 5 min» */
function hace(ms: number | null | undefined): string {
  if (!ms) return "";
  const min = Math.round((Date.now() - ms) / 60_000);
  return min < 1 ? "recién" : min === 1 ? "hace 1 min" : `hace ${min} min`;
}

type BmLigero = { id: string; nombre: string; verificado: boolean };

/**
 * TUS NÚMEROS, UN BM A LA VEZ (21/10/2026). «¿Cuando iba a agregar un número revisaba todas las
 * consultas? ¿No debería ser así?». Primero la lista de BM (1 llamada); al elegir uno, solo ese BM
 * (1 llamada): sus números, qué app los atiende, y «Agregar un número». Cada paso relee solo ese
 * BM. «🔍 Revisar todo» trae todos los BM juntos, y solo cuando se pide.
 */
function PasoNumeros({ volver, seguir }: { volver: () => void; seguir: () => void }) {
  const [bms, setBms] = useState<BmLigero[] | null>(null);
  const [desde, setDesde] = useState<number | null>(null);
  const [bmElegido, setBmElegido] = useState<string | null>(null);
  const [negocio, setNegocio] = useState<Negocio | null>(null);
  const [todos, setTodos] = useState<Negocio[] | null>(null);
  const [vista, setVista] = useState<"bms" | "bm" | "todo">("bms");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trabajo, setTrabajo] = useState<{ tipo: "codigo" | "pin"; phoneNumberId: string; numero: string } | null>(null);
  /** Las otras apps de la cuenta de WhatsApp con la que se trabaja: se avisa antes de sumar la tuya. */
  const [otras, setOtras] = useState<string[]>([]);
  const aceptaDosBots = (lista: string[]) =>
    lista.length === 0 ||
    window.confirm(
      `Estos números ya los atiende otra app: «${lista.join(", ")}». Si sigues, también los atenderá tu CRM y a cada cliente le contestarían DOS bots.\n\nQuítale primero la suscripción a la otra. ¿Seguir de todos modos?`
    );
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [f, setF] = useState({ cc: "51", numero: "", nombre: "", codigo: "", pin: "" });
  const [nuevo, setNuevo] = useState<{ paso: "datos" | "codigo" | "pin" | "listo"; wabaId: string; phoneNumberId?: string; numero?: string } | null>(null);

  const leerBms = useCallback(async (fresco = false) => {
    setCargando(true);
    setError(null);
    try {
      const d = await (await fetch(`/api/meta/connect/numeros?vista=bms${fresco ? "&fresco=1" : ""}`, { cache: "no-store" })).json();
      if (!d.ok) setError(d.error);
      else {
        setBms(d.bms);
        setDesde(d.desde ?? null);
      }
    } catch {
      setError("No se pudo consultar a Meta.");
    } finally {
      setCargando(false);
    }
  }, []);
  const leerBm = useCallback(async (id: string, fresco = false) => {
    setCargando(true);
    setError(null);
    try {
      const d = await (await fetch(`/api/meta/connect/numeros?bm=${encodeURIComponent(id)}${fresco ? "&fresco=1" : ""}`, { cache: "no-store" })).json();
      if (!d.ok) setError(d.error);
      else {
        setNegocio(d.negocio);
        setDesde(d.desde ?? null);
      }
    } catch {
      setError("No se pudo consultar a Meta.");
    } finally {
      setCargando(false);
    }
  }, []);
  const leerTodo = useCallback(async (fresco = false) => {
    setCargando(true);
    setError(null);
    try {
      const d = await (await fetch(`/api/meta/connect/numeros${fresco ? "?fresco=1" : ""}`, { cache: "no-store" })).json();
      if (!d.ok) setError(d.error);
      else {
        setTodos(d.negocios);
        setDesde(d.desde ?? null);
      }
    } catch {
      setError("No se pudo consultar a Meta.");
    } finally {
      setCargando(false);
    }
  }, []);
  useEffect(() => {
    void leerBms();
  }, [leerBms]);

  async function pedir(cuerpo: Record<string, string>, luego?: (d: { yaVerificado?: boolean; phoneNumberId?: string }) => void) {
    setOcupado(true);
    setMensaje(null);
    try {
      const d = await (await fetch("/api/meta/connect/numeros", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) })).json();
      if (!d.ok) setMensaje(`❌ ${d.error}`);
      else {
        luego?.(d);
        return d;
      }
    } catch {
      setMensaje("❌ No se pudo consultar a Meta.");
    } finally {
      setOcupado(false);
    }
    return null;
  }

  const abrirBm = (id: string) => {
    setBmElegido(id);
    setNegocio(null);
    setTrabajo(null);
    setNuevo(null);
    setMensaje(null);
    setVista("bm");
    void leerBm(id);
  };
  const recargarBm = () => bmElegido && void leerBm(bmElegido);
  const limpiarFormulario = () => setF({ cc: f.cc, numero: "", nombre: "", codigo: "", pin: "" });

  const cabecera = (titulo: React.ReactNode, alActualizar: () => void) => (
    <div className="space-y-1">
      <div className="font-bold">{titulo}</div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
        {desde ? <span>Revisado {hace(desde)}</span> : null}
        <button type="button" disabled={cargando} className="font-semibold text-sky-700 hover:underline disabled:text-neutral-400" onClick={alActualizar}>
          ↻ Actualizar
        </button>
      </div>
    </div>
  );
  const espera = (texto: string) => (
    <div className="text-neutral-600">
      {texto}
      <Puntos />
    </div>
  );

  // ── AGREGAR UN NÚMERO NUEVO EN EL BM ELEGIDO ─────────────────────────────────────────────
  if (nuevo && negocio) {
    const pasoN = { datos: 1, codigo: 2, pin: 3, listo: 3 }[nuevo.paso];
    const cerrarNuevo = () => {
      setNuevo(null);
      setMensaje(null);
      limpiarFormulario();
      recargarBm();
    };
    const aviso = avisoDelNumero(f.cc, f.numero);
    return (
      <div className="space-y-3 text-sm">
        <div className="flex items-center gap-2">
          <div className="font-bold">➕ Agregar un número a {negocio.nombre}</div>
          <span className="ml-auto text-xs text-neutral-500">Paso {pasoN} de 3</span>
        </div>
        {mensaje && <div className="text-sm">{mensaje}</div>}

        {nuevo.paso === "datos" && (
          <>
            <div>No puede estar usándose en el WhatsApp normal o Business de un celular: si lo está, bórralo de ahí primero.</div>
            <div className="flex gap-2">
              <input className="w-20 rounded-lg border px-2 py-1.5" placeholder="País" value={f.cc} onChange={(e) => setF({ ...f, cc: e.target.value })} title="Código de país sin +, por ejemplo 51" />
              <input className="flex-1 rounded-lg border px-2 py-1.5" placeholder="Número, sin el código de país" inputMode="numeric" value={f.numero} onChange={(e) => setF({ ...f, numero: e.target.value })} />
            </div>
            {aviso && <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">⚠ {aviso}</div>}
            <input className="w-full rounded-lg border px-2 py-1.5" placeholder="Nombre visible para tus clientes (lo revisa Meta)" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} />
            <div className="flex justify-between pt-2">
              <button type="button" className="text-neutral-500 hover:underline" onClick={cerrarNuevo}>← Atrás</button>
              <button
                type="button"
                disabled={ocupado || !f.cc.trim() || !f.numero.trim() || !f.nombre.trim()}
                className={BTN_AZUL}
                onClick={async () => {
                  const completo = `+${f.cc.replace(/\D/g, "")} ${f.numero.replace(/\D/g, "")}`;
                  // Confirmarlo grande antes de mandarlo: un número mal escrito ocupa un lugar del BM.
                  if (!window.confirm(`¿Agregar ${completo} a «${negocio.nombre}»?${aviso ? `\n\n⚠ ${aviso}` : ""}`)) return;
                  const d = await pedir({ accion: "agregar", wabaId: nuevo.wabaId, cc: f.cc, numero: f.numero, nombre: f.nombre });
                  if (d?.phoneNumberId) setNuevo({ ...nuevo, paso: "codigo", phoneNumberId: d.phoneNumberId, numero: completo });
                }}
              >
                {ocupado ? (
                  <>
                    Agregando
                    <Puntos />
                  </>
                ) : (
                  "Agregar →"
                )}
              </button>
            </div>
          </>
        )}

        {nuevo.paso === "codigo" && (
          <>
            <div>
              Meta te manda un código a <b>{nuevo.numero}</b>. ¿Cómo lo quieres?
            </div>
            <div className="flex gap-2">
              {(["SMS", "VOICE"] as const).map((metodo) => (
                <button
                  key={metodo}
                  type="button"
                  disabled={ocupado}
                  className={BTN_BLANCO}
                  onClick={() =>
                    void pedir({ accion: "pedirCodigo", phoneNumberId: nuevo.phoneNumberId!, metodo }, (d) =>
                      // «Ya está verificado»: directo al PIN, sin cerrar nada.
                      d.yaVerificado ? setNuevo({ ...nuevo, paso: "pin" }) : setMensaje(metodo === "SMS" ? "📩 Te mandé el código por SMS." : "📞 Te llamarán con el código.")
                    )
                  }
                >
                  {metodo === "SMS" ? "✉️ Por SMS" : "📞 Por llamada"}
                </button>
              ))}
            </div>
            <input className="w-full rounded-lg border px-2 py-1.5" placeholder="Escribe el código que te llegó" inputMode="numeric" value={f.codigo} onChange={(e) => setF({ ...f, codigo: e.target.value })} />
            <div className="flex justify-end pt-2">
              <button
                type="button"
                disabled={ocupado || !f.codigo.trim()}
                className={BTN_AZUL}
                onClick={() => void pedir({ accion: "verificar", phoneNumberId: nuevo.phoneNumberId!, codigo: f.codigo }, () => setNuevo({ ...nuevo, paso: "pin" }))}
              >
                {ocupado ? "Verificando…" : "Verificar →"}
              </button>
            </div>
          </>
        )}

        {nuevo.paso === "pin" && (
          <>
            <div>
              🔒 Elige un <b>PIN de 6 números</b> y <b>guárdalo</b>: activa la verificación en dos pasos y Meta puede pedírtelo después.
            </div>
            <input className="w-full rounded-lg border px-2 py-1.5" placeholder="PIN de 6 números" inputMode="numeric" maxLength={6} value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value })} />
            <div className="flex justify-end pt-2">
              <button
                type="button"
                disabled={ocupado || f.pin.replace(/\D/g, "").length !== 6}
                className={BTN_VERDE}
                onClick={() =>
                  aceptaDosBots(otras) &&
                  void pedir({ accion: "activar", phoneNumberId: nuevo.phoneNumberId!, pin: f.pin }, () => {
                    setMensaje(null);
                    setNuevo({ ...nuevo, paso: "listo" });
                  })
                }
              >
                {ocupado ? "Activando…" : "Activar"}
              </button>
            </div>
          </>
        )}

        {nuevo.paso === "listo" && (
          <>
            <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3">
              ✅ <b>{nuevo.numero}</b> está activo y lo atiende este CRM. Ya puedes elegirlo en tu tienda.
            </div>
            <div className="flex justify-end pt-2">
              <button type="button" className={BTN_AZUL} onClick={cerrarNuevo}>
                Volver a {negocio.nombre}
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  // Los pasos de un número ya existente, justo debajo de su fila (no al fondo de la lista).
  const pasosDelNumero = (x: Numero) =>
    trabajo?.phoneNumberId === x.id && (
      <div className="mt-2 space-y-2 rounded-lg border-2 border-sky-400 bg-sky-50 p-3">
        {trabajo.tipo === "codigo" && (
          <>
            <div className="font-semibold">Verificar {trabajo.numero}</div>
            <div className="flex flex-wrap gap-2">
              {(["SMS", "VOICE"] as const).map((metodo) => (
                <button
                  key={metodo}
                  type="button"
                  disabled={ocupado}
                  className={BTN_BLANCO}
                  onClick={() =>
                    void pedir({ accion: "pedirCodigo", phoneNumberId: trabajo.phoneNumberId, metodo }, (d) =>
                      d.yaVerificado ? setTrabajo({ ...trabajo, tipo: "pin" }) : setMensaje(metodo === "SMS" ? "📩 Te mandé el código por SMS." : "📞 Te llamarán con el código.")
                    )
                  }
                >
                  {metodo === "SMS" ? "✉️ Por SMS" : "📞 Por llamada"}
                </button>
              ))}
            </div>
            <input className="w-full rounded-lg border px-2 py-1.5" placeholder="Código que te llegó" inputMode="numeric" value={f.codigo} onChange={(e) => setF({ ...f, codigo: e.target.value })} />
            <button
              type="button"
              disabled={ocupado || !f.codigo.trim()}
              className={BTN_AZUL}
              onClick={() => void pedir({ accion: "verificar", phoneNumberId: trabajo.phoneNumberId, codigo: f.codigo }, () => setTrabajo({ ...trabajo, tipo: "pin" }))}
            >
              Verificar →
            </button>
          </>
        )}
        {trabajo.tipo === "pin" && (
          <>
            <div className="font-semibold">Activar {trabajo.numero}</div>
            <div className="text-[13px]">Elige un PIN de 6 números y <b>guárdalo</b>: activa la verificación en dos pasos y Meta puede pedírtelo después.</div>
            <input className="w-full rounded-lg border px-2 py-1.5" placeholder="PIN de 6 números" inputMode="numeric" maxLength={6} value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value })} />
            <button
              type="button"
              disabled={ocupado || f.pin.replace(/\D/g, "").length !== 6}
              className={BTN_VERDE}
              onClick={() =>
                aceptaDosBots(otras) &&
                void pedir({ accion: "activar", phoneNumberId: trabajo.phoneNumberId, pin: f.pin }, () => {
                  setTrabajo(null);
                  setMensaje("✅ Número activo y en tu CRM. Ya puedes elegirlo en tu tienda.");
                  limpiarFormulario();
                  recargarBm();
                })
              }
            >
              Activar
            </button>
          </>
        )}
        <button type="button" className="ml-1 text-xs text-neutral-500 hover:underline" onClick={() => setTrabajo(null)}>
          Cancelar
        </button>
      </div>
    );

  /** Los números de un BM, con lo que se puede hacer con cada uno. */
  const numerosDe = (n: Negocio, conAcciones: boolean) => {
    const conNumeros = n.cuentas.filter((c) => c.numeros.length > 0);
    if (!conNumeros.length) return <div className="text-xs text-neutral-500">Sin números todavía.</div>;
    return conNumeros.map((c) =>
      c.numeros.map((x) => (
        <div key={x.id} className="rounded-lg border border-neutral-200 bg-white px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{x.numero}</span>
            <span className="text-xs text-neutral-500">{x.nombre}</span>
            <span className="ml-auto" />
            {x.estado === "activo" && c.estaApp && <span className="text-xs font-semibold text-emerald-700">✅ Lo atiende este CRM</span>}
            {conAcciones && x.estado === "activo" && !c.estaApp && (
              <button type="button" disabled={ocupado} className={BTN_AZUL} onClick={() => aceptaDosBots(c.otrasApps) && void pedir({ accion: "traer", phoneNumberId: x.id }, () => recargarBm())}>
                Traer a este CRM
              </button>
            )}
            {conAcciones && x.estado === "sin_activar" && (
              <button type="button" className={BTN_AZUL} onClick={() => { setOtras(c.otrasApps); setMensaje(null); setTrabajo({ tipo: "pin", phoneNumberId: x.id, numero: x.numero }); }}>
                Activar
              </button>
            )}
            {conAcciones && x.estado === "sin_verificar" && (
              <button type="button" className={BTN_AZUL} onClick={() => { setOtras(c.otrasApps); setMensaje(null); setTrabajo({ tipo: "codigo", phoneNumberId: x.id, numero: x.numero }); }}>
                Verificar y activar
              </button>
            )}
            {!conAcciones && x.estado !== "activo" && <span className="text-xs text-amber-700">Sin activar</span>}
          </div>
          {/* QUITARLO DE META (21/10/2026): «quitar el número de WhatsApp Manager desde el CRM».
              Meta no deja borrarlo por programa: el botón abre su página de números, ya en su BM
              y su cuenta. «Dar de baja» sí se hace desde aquí: deja de funcionar en todas las
              apps hasta volver a activarlo con su PIN. */}
          {conAcciones && (
            <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs">
              <a
                href={`https://business.facebook.com/wa/manage/phone-numbers/?business_id=${n.id}&waba_id=${c.id}`}
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-neutral-500 hover:text-red-700 hover:underline"
              >
                🗑 Borrar en WhatsApp Manager ↗
              </a>
              {x.estado === "activo" && (
                <button
                  type="button"
                  disabled={ocupado}
                  className="font-semibold text-neutral-500 hover:text-red-700 hover:underline disabled:opacity-40"
                  onClick={() =>
                    window.confirm(
                      `¿Dar de baja ${x.numero} en Meta?\n\nDeja de funcionar en TODAS las apps y bots (también en otros proyectos) hasta que lo vuelvas a activar con su PIN de 6 números.`
                    ) && void pedir({ accion: "darDeBaja", phoneNumberId: x.id }, () => { setMensaje(`✅ ${x.numero} quedó dado de baja en Meta.`); recargarBm(); })
                  }
                >
                  ⏻ Dar de baja
                </button>
              )}
            </div>
          )}
          {/* Quién más lo atiende: en gris si es solo información; en rojo si ESTE CRM también
              (ahí contestan dos bots). */}
          {c.otrasApps.length > 0 &&
            (c.estaApp ? (
              <div className="mt-1 text-xs font-semibold text-red-700">
                ⚠ También lo atiende «{c.otrasApps.join(", ")}»: a cada cliente le contestan dos bots. Quítale la suscripción a la otra desde el proyecto que la usa.
              </div>
            ) : (
              <div className="mt-1 text-xs text-neutral-500">Lo atiende: {c.otrasApps.join(", ")}</div>
            ))}
          {conAcciones && pasosDelNumero(x)}
        </div>
      ))
    );
  };

  const pie = (
    <div className="flex justify-between pt-2">
      <button type="button" className="text-neutral-500 hover:underline" onClick={volver}>← Atrás</button>
      <button type="button" className={BTN_AZUL} onClick={seguir}>
        Continuar →
      </button>
    </div>
  );

  // ── UN BM ────────────────────────────────────────────────────────────────────────────────
  if (vista === "bm") {
    const n = negocio;
    const cantidad = n ? n.cuentas.reduce((s, c) => s + c.numeros.length, 0) : 0;
    const lleno = !!n && !n.verificado && cantidad >= 2;
    // Donde va el número nuevo: la cuenta de WhatsApp Business que ya tiene números, o la primera.
    const donde = n ? n.cuentas.find((c) => c.numeros.length > 0) ?? n.cuentas[0] : undefined;
    return (
      <div className="space-y-3 text-sm">
        <button type="button" className="text-xs text-neutral-500 hover:underline" onClick={() => { setVista("bms"); setNegocio(null); setTrabajo(null); setMensaje(null); }}>
          ← Todos mis BM
        </button>
        {cabecera(<>🏢 {bms?.find((b) => b.id === bmElegido)?.nombre ?? "Tu BM"}</>, () => bmElegido && void leerBm(bmElegido, true))}
        {error && <div className="text-red-700">❌ {error}</div>}
        {!n && !error && espera("Consultando a Meta")}
        {n && (
          <>
            {!n.verificado && <div className="text-xs text-amber-800">Sin verificar · Meta admite 2 números en este BM.</div>}
            <div className="space-y-1.5">{numerosDe(n, true)}</div>
            {mensaje && <div className="text-sm">{mensaje}</div>}
            {donde ? (
              <button
                type="button"
                disabled={lleno}
                title={lleno ? "Este BM no está verificado: Meta admite 2 números. Verifícalo para tener hasta 20, o usa otro BM." : ""}
                className={`${BTN_AZUL} w-full`}
                onClick={() => {
                  setOtras(donde.otrasApps);
                  setMensaje(null);
                  setNuevo({ paso: "datos", wabaId: donde.id });
                }}
              >
                ➕ Agregar un número nuevo aquí
              </button>
            ) : (
              <div className="text-xs text-neutral-600">Este BM no tiene cuenta de WhatsApp Business todavía. Créala una vez en el WhatsApp Manager de Meta.</div>
            )}
            {lleno && <div className="text-xs text-neutral-500">Lleno: para agregar otro, verifica este BM en Meta o usa otro BM.</div>}
          </>
        )}
        {pie}
      </div>
    );
  }

  // ── TODOS LOS BM CON TODO (solo cuando se pide) ──────────────────────────────────────────
  if (vista === "todo") {
    return (
      <div className="space-y-3 text-sm">
        <button type="button" className="text-xs text-neutral-500 hover:underline" onClick={() => setVista("bms")}>
          ← Todos mis BM
        </button>
        {cabecera("🔍 Todo lo de tus BM", () => void leerTodo(true))}
        {error && <div className="text-red-700">❌ {error}</div>}
        {!todos && !error && espera("Revisando todos tus BM. Tarda un poco")}
        {todos?.map((n) => (
          <div key={n.id} className="space-y-1.5 rounded-xl border border-neutral-200 p-3">
            <button type="button" className="font-bold hover:underline" onClick={() => abrirBm(n.id)}>
              🏢 {n.nombre} →
            </button>
            {numerosDe(n, false)}
          </div>
        ))}
        {pie}
      </div>
    );
  }

  // ── LA LISTA DE BM ───────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-3 text-sm">
      {cabecera("📱 Tus números: ¿en qué BM?", () => void leerBms(true))}
      <p className="text-xs text-neutral-600">Elige el BM. Ahí ves sus números, los activas o agregas uno nuevo.</p>
      {error && <div className="text-red-700">❌ {error}</div>}
      {!bms && !error && espera("Consultando a Meta")}
      {bms?.length === 0 && <div className="text-neutral-600">No veo BM. Inicia sesión con Facebook y marca tus negocios en la ventana de Meta.</div>}
      <div className="space-y-2">
        {bms?.map((b) => (
          <button
            key={b.id}
            type="button"
            className="flex w-full items-center gap-2 rounded-xl border border-neutral-200 bg-white px-4 py-3 text-left shadow-sm transition hover:border-sky-400 hover:bg-sky-50"
            onClick={() => abrirBm(b.id)}
          >
            <span className="font-semibold">🏢 {b.nombre}</span>
            {!b.verificado && <span className="rounded bg-amber-100 px-1.5 text-xs text-amber-900">Sin verificar</span>}
            <span className="ml-auto text-sky-700">→</span>
          </button>
        ))}
      </div>
      {bms && bms.length > 0 && (
        <button
          type="button"
          className="text-xs font-semibold text-sky-700 hover:underline"
          onClick={() => {
            setVista("todo");
            if (!todos) void leerTodo();
          }}
        >
          🔍 Revisar todo (todos los BM con sus números; tarda un poco)
        </button>
      )}
      {pie}
    </div>
  );
}


interface EstadoDelToken {
  tiene: boolean;
  /** `enUso`: el activo o el de alguna tienda. Los demás los atiende otra app y no cuentan. */
  numeros: Array<{ id: string; numero: string; nombre: string | null; negocioId: string | null; negocio: string | null; permanente: boolean; activo: boolean; enUso: boolean }>;
  faltan: number;
  vence: number | null;
  loginVencido?: boolean;
  appId: string | null;
  /** `conLaApp` y `usuarioAdmin` vienen solo en el BM pedido; en los demás, sin revisar. */
  negocios: Array<{ id: string; nombre: string; conLaApp?: boolean; usuarioAdmin?: boolean }>;
  frenado?: boolean;
}

const fecha = (ms: number) => new Date(ms).toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric" });

/** TRES PUNTOS QUE SALTAN (21/10/2026): «que diga Consultando a Meta y algo al lado… para saber
 *  que tengo que esperar». */
export function Puntos() {
  return (
    <span className="ml-1 inline-flex items-end gap-0.5 align-middle" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-sky-500" style={{ animationDelay: `${i * 150}ms` }} />
      ))}
    </span>
  );
}

/** Un paso de la lista: ✓ verde si ya está; si no, su número y lo que hay que hacer. */
function PasoDeLista({ ok, n, titulo, children }: { ok: boolean; n: number; titulo: string; children?: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
          ok ? "bg-emerald-500 text-white" : "bg-white text-sky-700 ring-1 ring-sky-300"
        }`}
      >
        {ok ? "✓" : n}
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className={`font-semibold ${ok ? "text-emerald-800" : "text-neutral-900"}`}>{titulo}</div>
        {!ok && children && <div className="mt-1.5 space-y-2 text-[13px] leading-relaxed text-neutral-700">{children}</div>}
      </div>
    </div>
  );
}

/**
 * EL TOKEN PERMANENTE, PASO A PASO (21/10/2026). «Esto también debería tener un asistente… ¿ya
 * compartiste la app? ¿ya le diste privilegios?». Cada número necesita el token de SU BM (ver
 * `token-por-numero.ts`): se elige el BM y se marcan con ✓ las dos cosas que Meta exige —la app
 * agregada y un usuario del sistema administrador—, que se comprueban solas. Al crearlo, se le
 * pone solo a los números que alcanza: el de otro BM no pisa el tuyo.
 */
function PasoToken({ volver, seguir }: { volver: () => void; seguir: () => void }) {
  const [e, setE] = useState<EstadoDelToken | null>(null);
  const [elegido, setElegido] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [revisando, setRevisando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [hecho, setHecho] = useState<string | null>(null);

  // SOLO EL BM ELEGIDO (21/10/2026): la lista de BM sale sin revisar; los dos requisitos (app y
  // usuario del sistema) se piden solo del BM que está en el selector.
  const cargar = useCallback(async (fresco = false, bm = "") => {
    setRevisando(true);
    try {
      // El token que ya existía (de antes del 21/10) se pone en los números que alcanza.
      await fetch("/api/meta/connect/token-estado", { method: "POST" }).catch(() => null);
      const q = new URLSearchParams();
      if (bm) q.set("bm", bm);
      if (fresco) q.set("fresco", "1");
      const d = (await (await fetch(`/api/meta/connect/token-estado?${q}`, { cache: "no-store" })).json()) as EstadoDelToken;
      setE(d);
      setElegido((actual) => actual || d.numeros.find((n) => n.enUso && !n.permanente)?.negocioId || d.negocios[0]?.id || "");
    } catch {
      setAviso("No se pudo consultar a Meta.");
    } finally {
      setRevisando(false);
    }
  }, []);
  useEffect(() => {
    void cargar();
  }, [cargar]);
  useEffect(() => {
    if (elegido) void cargar(false, elegido);
  }, [elegido, cargar]);

  const [pegado, setPegado] = useState("");
  async function guardarPegado() {
    setOcupado(true);
    setAviso(null);
    setHecho(null);
    try {
      const d = await (
        await fetch("/api/meta/connect/token-permanente", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pegado: pegado.trim() }),
        })
      ).json();
      if (d.ok) {
        setPegado("");
        setHecho(`Listo. Ya no caducan: ${d.numeros.join(", ")}.${d.aviso ? ` ⚠ ${d.aviso}` : ""}`);
      } else setAvisoPegado(d.error ?? "No se pudo guardar.");
      await cargar(false, elegido);
    } catch {
      setAvisoPegado("No se pudo consultar a Meta.");
    } finally {
      setOcupado(false);
    }
  }
  const [avisoPegado, setAvisoPegado] = useState<string | null>(null);

  async function crear() {
    setOcupado(true);
    setAviso(null);
    setHecho(null);
    try {
      const d = await (
        await fetch("/api/meta/connect/token-permanente", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ negocio: elegido }),
        })
      ).json();
      if (d.ok) setHecho(d.numeros?.length ? `Listo. Ya no caducan: ${d.numeros.join(", ")}.` : "Listo. Este BM no tiene números conectados todavía.");
      else setAviso(d.sugerencia ? `${d.sugerencia.quePasa} 👉 ${d.sugerencia.queHacer}` : d.error ?? "Meta no dejó crearlo.");
      await cargar(false, elegido);
    } catch {
      setAviso("No se pudo consultar a Meta.");
    } finally {
      setOcupado(false);
    }
  }

  if (!e)
    return (
      <div className="text-sm text-neutral-600">
        Revisando tus números
        <Puntos />
      </div>
    );

  const bm = e.negocios.find((n) => n.id === elegido);
  const sinToken = new Set(e.numeros.filter((n) => n.enUso && !n.permanente).map((n) => n.negocioId));
  const listo = e.numeros.length > 0 && e.faltan === 0;
  const boton = "inline-flex items-center rounded-lg px-3 py-1.5 text-sm font-semibold shadow-sm transition";

  return (
    <div className="space-y-4 text-sm">
      <div>
        <div className="font-bold">🔐 Token permanente</div>
        <p className="mt-0.5 text-xs text-neutral-600">Cada número necesita el token de su BM. Con él, la conexión no caduca.</p>
      </div>

      <div className="space-y-1.5">
        {e.numeros.map((n) => (
          <div key={n.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2">
            <span className="min-w-0">
              <span className="font-mono">{n.numero}</span>
              <span className="ml-2 text-xs text-neutral-500">{n.negocio ?? "BM sin identificar"}</span>
            </span>
            {n.permanente ? (
              <span className="text-xs font-semibold text-emerald-700">🔐 No caduca</span>
            ) : !n.enUso ? (
              <span className="text-xs text-neutral-400" title="No es el activo ni lo tiene ninguna tienda: no hace falta su token">
                No lo usa este proyecto
              </span>
            ) : (
              <span className={`text-xs font-semibold ${e.loginVencido ? "text-red-700" : "text-amber-700"}`}>
                {e.loginVencido ? "⛔ Sin permiso: inicia sesión de nuevo" : e.vence ? `⚠ Caduca el ${fecha(e.vence)}` : "⚠ Sin token permanente"}
              </span>
            )}
          </div>
        ))}
        {!e.numeros.length && <div className="text-xs text-neutral-500">Todavía no hay números conectados. Conecta uno en «📱 Tus números».</div>}
      </div>

      {!listo && e.numeros.length > 0 && (
        <div className="space-y-4 rounded-xl border border-sky-200 bg-sky-50/60 p-4">
          {!e.negocios.length && (
            <div className="space-y-2 text-[13px] text-neutral-700">
              <div>No pude ver tus BM: tu inicio de sesión con Facebook ya no tiene permiso. Vuelve a entrar y regresa a este paso.</div>
              <a href="/api/meta/connect/start" className={`${boton} bg-[#1877f2] text-white hover:bg-[#166fe0]`}>
                Iniciar sesión con Facebook
              </a>
            </div>
          )}
          <label className={`${e.negocios.length ? "flex" : "hidden"} flex-wrap items-center gap-2 text-[13px] font-semibold text-neutral-800`}>
            BM donde crearlo
            <select
              className="rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-sm font-normal"
              value={elegido}
              onChange={(ev) => {
                setElegido(ev.target.value);
                setAviso(null);
                setHecho(null);
              }}
            >
              {e.negocios.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.nombre}
                  {sinToken.has(n.id) ? " · tiene números sin token" : ""}
                </option>
              ))}
            </select>
          </label>

          {bm && bm.conLaApp === undefined && (
            <div className="text-[13px] text-neutral-600">
              {e.frenado ? "Meta pidió una pausa por muchas consultas. Espera unos minutos y pulsa «Ya lo hice, revisar de nuevo»." : <>Revisando {bm.nombre}<Puntos /></>}
            </div>
          )}
          {bm && bm.conLaApp !== undefined && (
            <>
              <PasoDeLista ok={!!bm.conLaApp} n={1} titulo={`¿Agregaste tu app al BM «${bm.nombre}»?`}>
                <div>
                  En la página que se abre: <b>Agregar → Conectar un identificador de app</b>, pega este ID y confirma.
                </div>
                {e.appId && <Copiar texto={e.appId} />}
                <a href={`https://business.facebook.com/settings/apps?business_id=${bm.id}`} target="_blank" rel="noreferrer" className={`${boton} bg-[#1877f2] text-white hover:bg-[#166fe0]`}>
                  Abrir «Apps» de {bm.nombre} ↗
                </a>
              </PasoDeLista>

              <PasoDeLista ok={!!bm.usuarioAdmin} n={2} titulo="¿Tu BM tiene un usuario del sistema administrador?">
                <div>
                  Créalo con rol <b>Administrador</b>. Luego, en ese usuario, <b>Asignar activos → Apps → tu app → Control total</b>.
                </div>
                <a href={`https://business.facebook.com/settings/system-users?business_id=${bm.id}`} target="_blank" rel="noreferrer" className={`${boton} bg-[#1877f2] text-white hover:bg-[#166fe0]`}>
                  Abrir «Usuarios del sistema» ↗
                </a>
              </PasoDeLista>

              <PasoDeLista ok={false} n={3} titulo="Crea el token">
                <button
                  type="button"
                  disabled={ocupado || !bm.conLaApp || !bm.usuarioAdmin}
                  title={bm.conLaApp && bm.usuarioAdmin ? "" : "Primero los pasos 1 y 2"}
                  className={`${boton} bg-sky-600 text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-40`}
                  onClick={() => void crear()}
                >
                  {ocupado ? (
                    <>
                      Creando
                      <Puntos />
                    </>
                  ) : (
                    "Crear token permanente"
                  )}
                </button>
                {!aviso && <div className="text-xs text-neutral-500">La primera vez, Meta suele pedir un código que te manda por correo. Si pasa, aquí te decimos qué hacer.</div>}
              </PasoDeLista>
            </>
          )}

          {/* META PIDE UNA PERSONA (20/10/2026, lo vivió él): el primer intento casi nunca crea el
              token. Meta deja una solicitud en el BM («Se ha solicitado…»): al aceptarla manda un
              código al correo, y con el código puesto el segundo intento sí lo crea. */}
          {/* LO QUE META PIDE DE VERDAD (21/10/2026): el código por correo sale UNA vez; las demás,
              Meta dice otra cosa (casi siempre: la app sin asignar al usuario del sistema). Se
              muestra su instrucción, no siempre la del correo. */}
          {aviso && bm && !/correo|c[oó]digo|email|verif/i.test(aviso) && (
            <div className="space-y-2 rounded-lg border-2 border-amber-400 bg-amber-50 p-3">
              <div className="font-bold">👉 Falta un paso en Meta</div>
              <div className="text-[13px]">{aviso}</div>
              <a href={`https://business.facebook.com/settings/system-users?business_id=${bm.id}`} target="_blank" rel="noreferrer" className={`${boton} bg-[#1877f2] text-white hover:bg-[#166fe0]`}>
                Ir a {bm.nombre} ↗
              </a>
              <div className="text-[13px]">
                Luego vuelve y pulsa <b>«Crear token permanente»</b> otra vez. O, más fácil: créalo en esa página de Meta y pégalo abajo.
              </div>
            </div>
          )}
          {aviso && bm && /correo|c[oó]digo|email|verif/i.test(aviso) && (
            <div className="space-y-2 rounded-lg border-2 border-amber-400 bg-amber-50 p-3">
              <div className="font-bold">👉 Meta te pide confirmarlo. Es normal la primera vez.</div>
              <div>
                Ve a tu BM <b>{bm.nombre}</b>, confirma el aviso que pide <b>enviar un código a tu correo</b> y escribe el código que te llegue.
              </div>
              <a href={`https://business.facebook.com/settings/system-users?business_id=${bm.id}`} target="_blank" rel="noreferrer" className={`${boton} bg-[#1877f2] text-white hover:bg-[#166fe0]`}>
                Ir a {bm.nombre} ↗
              </a>
              <div>
                Luego vuelve y pulsa <b>«Crear token permanente»</b> otra vez.
              </div>
              <div className="text-xs text-neutral-500">Lo que respondió Meta: {aviso}</div>
            </div>
          )}
          {aviso && !bm && <div className="text-xs text-red-700">❌ {aviso}</div>}

          {/* PEGAR UN TOKEN YA CREADO (21/10/2026): crearlo en la página de Meta es lo más seguro
              («Meta es raro»). Aquí se comprueba y se pone en los números que alcanza. */}
          <div className="space-y-2 border-t border-sky-200 pt-3">
            <div className="text-[13px] font-semibold text-neutral-800">¿Ya creaste el token en la página de Meta? Pégalo aquí:</div>
            <div className="flex gap-2">
              <input
                type="password"
                autoComplete="off"
                className="min-w-0 flex-1 rounded-lg border border-neutral-300 px-2 py-1.5 font-mono text-xs"
                placeholder="EAA…"
                value={pegado}
                onChange={(ev) => setPegado(ev.target.value)}
              />
              <button type="button" disabled={ocupado || pegado.trim().length < 20} className={`${boton} bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-40`} onClick={() => void guardarPegado()}>
                Guardar
              </button>
            </div>
            {avisoPegado && <div className="text-[13px] text-red-700">❌ {avisoPegado}</div>}
            <div className="text-xs text-neutral-500">Al crearlo en Meta: elige tu app, caducidad «Nunca», y los permisos que empiezan con whatsapp_, más business_management y ads_read.</div>
          </div>

          <button type="button" disabled={revisando} className="text-xs font-semibold text-sky-700 hover:underline disabled:text-neutral-400" onClick={() => void cargar(true, elegido)}>
            {revisando ? (
              <>
                Revisando
                <Puntos />
              </>
            ) : (
              "↻ Ya lo hice, revisar de nuevo"
            )}
          </button>
        </div>
      )}

      {hecho && <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 font-semibold text-emerald-800">✅ {hecho}</div>}

      <div className="flex items-center justify-between gap-2 pt-1">
        <button type="button" className="text-neutral-500 hover:underline" onClick={volver}>
          ← Atrás
        </button>
        <div className="flex items-center gap-3">
          {!listo && e.numeros.some((n) => n.permanente) && (
            <button type="button" className="text-xs text-neutral-500 hover:underline" onClick={seguir}>
              Seguir sin token en {e.faltan} número(s)
            </button>
          )}
          <button type="button" disabled={!listo} title={listo ? "" : "Falta el token permanente"} className={`${boton} bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-40`} onClick={seguir}>
            Continuar →
          </button>
        </div>
      </div>
    </div>
  );
}


/**
 * CERRAR SESIÓN DE META (21/10/2026): «al cerrar sesión que se vacíe, como un CRM». Deja Meta
 * Connect vacío para conectar otra app. Pide la contraseña del CRM y la palabra CERRAR, porque
 * mientras no se vuelva a conectar el bot no contesta por ningún número.
 */
function PasoCerrarSesion({ volver }: { volver: () => void }) {
  const [clave, setClave] = useState("");
  const [palabra, setPalabra] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function cerrarSesion() {
    setOcupado(true);
    setError(null);
    try {
      const d = await (
        await fetch("/api/meta/connect/cerrar-sesion", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clave, palabra }) })
      ).json();
      if (!d.ok) setError(d.error ?? "No se pudo cerrar la sesión.");
      else {
        try {
          localStorage.removeItem(CLAVE);
        } catch {}
        window.location.href = "/meta-connect";
      }
    } catch {
      setError("No se pudo cerrar la sesión.");
    } finally {
      setOcupado(false);
    }
  }
  return (
    <div className="space-y-3 text-sm">
      <div className="font-bold text-red-800">🚪 Cerrar sesión de Meta</div>
      <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-[13px] text-red-900">
        <div>
          Meta Connect queda <b>vacío</b>: se borran tu app, tus inicios de sesión, tus tokens, tus números, tus páginas y tus
          píxeles <b>de este proyecto</b>.
        </div>
        <div className="mt-1">
          <b>El bot deja de contestar por todos los números</b> hasta que conectes otra vez.
        </div>
        <div className="mt-1 text-red-800">En Meta no se borra nada. Tu contenido, tus tiendas y tus chats quedan igual.</div>
      </div>
      <input type="password" autoComplete="current-password" className="w-full rounded-lg border px-2 py-1.5" placeholder="Contraseña del CRM" value={clave} onChange={(e) => setClave(e.target.value)} />
      <input className="w-full rounded-lg border px-2 py-1.5" placeholder="Escribe CERRAR" value={palabra} onChange={(e) => setPalabra(e.target.value)} />
      {error && <div className="text-red-700">❌ {error}</div>}
      <div className="flex justify-between pt-1">
        <button type="button" className="text-neutral-500 hover:underline" onClick={volver}>
          ← Atrás
        </button>
        <button
          type="button"
          disabled={ocupado || !clave || palabra.trim().toUpperCase() !== "CERRAR"}
          className="inline-flex items-center rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-red-700 disabled:opacity-40"
          onClick={() => void cerrarSesion()}
        >
          {ocupado ? "Cerrando…" : "Cerrar sesión de Meta"}
        </button>
      </div>
    </div>
  );
}

function PasoListo({ estado, volver, cerrar }: { estado: { appId: string | null; appName: string | null; paginas: number; numeros: number } | null; volver: () => void; cerrar: () => void }) {
  // EL TOKEN, EN LA REVISIÓN: solo se mira. Se crea en su paso («🔐 Token permanente»), que sabe
  // en qué BM hacerlo.
  const [token, setToken] = useState<{ tiene: boolean; negocio?: string } | null>(null);
  useEffect(() => {
    void (async () => {
      try {
        const d = await (await fetch("/api/meta/connect/token-estado", { cache: "no-store" })).json();
        setToken({ tiene: !!d.tiene, negocio: d.negocioDelToken?.nombre });
      } catch {
        setToken(null);
      }
    })();
  }, []);
  const fila = (ok: boolean, texto: string, falta?: string) => (
    <div className="flex items-start gap-2">
      <span>{ok ? "✅" : "⬜"}</span>
      <span>
        {texto}
        {!ok && falta && <span className="block text-xs text-amber-800">{falta}</span>}
      </span>
    </div>
  );
  return (
    <div className="space-y-2 text-sm">
      <div className="font-bold">✅ Revisión</div>
      {fila(!!estado?.appId, `Tu app${estado?.appName ? `: ${estado.appName}` : ""}`, "Falta conectar tu app (paso 🔑).")}
      {fila((estado?.numeros ?? 0) > 0, `${estado?.numeros ?? 0} número(s) en tu CRM`, "Inicia sesión con Facebook y trae o activa un número.")}
      {fila((estado?.paginas ?? 0) > 0, `${estado?.paginas ?? 0} página(s) detectada(s)`, "Para Messenger e Instagram: inicia sesión y marca tu página.")}
      {fila(
        !!token?.tiene,
        token?.tiene ? `Token permanente${token.negocio ? ` (BM ${token.negocio})` : ""}` : "Token permanente",
        "Falta: vuelve al paso «🔐 Token permanente». Sin él, la conexión caduca."
      )}
      <p className="pt-2 text-xs text-neutral-600">
        Página, Instagram y píxel se eligen abajo, en esta misma pantalla (secciones «Páginas de Facebook» y «Píxel»), como siempre.
      </p>
      <p className="text-xs text-neutral-600">
        <b>Prueba final:</b> escríbele a tu número desde otro WhatsApp. Si contesta, ya está.
      </p>
      <div className="flex justify-between pt-2">
        <button type="button" className="text-neutral-500 hover:underline" onClick={volver}>← Atrás</button>
        <button type="button" className="rounded-md bg-emerald-600 px-4 py-1.5 font-bold text-white" onClick={cerrar}>
          Terminar
        </button>
      </div>
    </div>
  );
}
