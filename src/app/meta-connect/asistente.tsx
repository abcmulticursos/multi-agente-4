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

type Paso = "inicio" | "app" | "facebook" | "numeros" | "token" | "listo";
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
  const [sinToken, setSinToken] = useState<{ vence: number | null } | null>(null);
  useEffect(() => {
    void (async () => {
      try {
        const d = await (await fetch("/api/meta/connect/token-estado?ligero=1", { cache: "no-store" })).json();
        setSinToken(d.appId && !d.tiene ? { vence: d.vence ?? null } : null);
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
        setPaso(/bloquead|redirect|URL/i.test(error) ? "app" : "facebook");
        setAviso(
          /bloquead|redirect|URL/i.test(error)
            ? "Meta rechazó el inicio de sesión: la URI no está pegada o tiene un error. Cópiala otra vez y pégala en tu app."
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
            ⚠ <b>Sin token permanente.</b> {sinToken.vence ? <>Tu conexión <b>caduca el {fecha(sinToken.vence)}</b> y el bot dejará de contestar.</> : "Tu conexión caducará y el bot dejará de contestar."}
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
            setAbierto(true);
            setPaso(leer()?.paso ?? "inicio");
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
              <div className="space-y-2">
                <p className="text-sm text-neutral-600">¿Qué quieres hacer?</p>
                {[
                  ["app", "🔑 Conectar mi app (la puerta)", "Una sola vez: su ID y su clave. Lo demás se llena solo."],
                  ["facebook", "👤 Iniciar sesión con Facebook, o agregar otra cuenta", "Para ver tus negocios, números, páginas y píxeles."],
                  ["numeros", "📱 Agregar o activar un número", "Sin entrar a la app ni al WhatsApp Manager."],
                  ["token", "🔐 Token permanente", "La base para que la conexión no caduque. Obligatorio."],
                  ["listo", "✅ Revisar que todo esté bien", "Lo que falta, en palabras simples."],
                ].map(([p, t, d]) => (
                  <button key={p} type="button" className="block w-full rounded-lg border border-neutral-300 p-3 text-left hover:border-sky-400 hover:bg-sky-50" onClick={() => ir(p as Paso)}>
                    <div className="font-bold">{t}</div>
                    <div className="text-xs text-neutral-600">{d}</div>
                  </button>
                ))}
              </div>
            )}

            {paso === "app" && <PasoApp casillas={casillas} marcar={marcar} alListo={() => { void cargarEstado(); ir("facebook"); }} volver={() => ir("inicio")} />}

            {paso === "facebook" && (
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
          `Esta app ya manda sus mensajes a otra dirección:\n${ajenas.map((s) => `· ${s.url}`).join("\n")}\n\nSi la preparo para este CRM, esa otra dirección (otro bot) dejará de recibirlos. ¿Seguir?`
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
          <Botones listo={!!casillas.tipo} alSeguir={() => ir("claves")} />
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
          <Casilla id="p-whatsapp" casillas={casillas} marcar={marcar} texto={<><b>WhatsApp</b></>} />
          <Casilla id="p-messenger" casillas={casillas} marcar={marcar} texto={<><b>Messenger</b></>} />
          <Casilla id="p-instagram" casillas={casillas} marcar={marcar} texto={<><b>Instagram</b> (o márcalo si no vas a vender por Instagram)</>} />
          <Botones listo={!!casillas["p-whatsapp"] && !!casillas["p-messenger"] && !!casillas["p-instagram"]} alSeguir={() => ir("uri")} />
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

function PasoNumeros({ volver, seguir }: { volver: () => void; seguir: () => void }) {
  const [negocios, setNegocios] = useState<Negocio[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trabajo, setTrabajo] = useState<{ tipo: "agregar"; wabaId: string } | { tipo: "codigo" | "pin"; phoneNumberId: string; numero: string } | null>(null);
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
  const [nuevo, setNuevo] = useState<{ paso: "negocio" | "datos" | "codigo" | "pin" | "listo"; wabaId?: string; negocio?: string; phoneNumberId?: string; numero?: string } | null>(null);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const d = await (await fetch("/api/meta/connect/numeros", { cache: "no-store" })).json();
      if (!d.ok) setError(d.error);
      else setNegocios(d.negocios);
    } catch {
      setError("No se pudo consultar a Meta.");
    }
  }, []);
  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function pedir(cuerpo: Record<string, string>, luego?: () => void) {
    setOcupado(true);
    setMensaje(null);
    try {
      const d = await (await fetch("/api/meta/connect/numeros", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) })).json();
      if (!d.ok) setMensaje(`❌ ${d.error}`);
      else {
        luego?.();
        return d;
      }
    } catch {
      setMensaje("❌ No se pudo consultar a Meta.");
    } finally {
      setOcupado(false);
    }
    return null;
  }

  // AGREGAR UN NÚMERO NUEVO, PASO A PASO (20/10/2026): «he visto asistentes que dicen agregar
  // nuevo número, se elige el BM…». Un solo botón arriba y una pregunta por pantalla, en vez de un
  // «+» en cada negocio de una lista larga.
  if (nuevo) {
    const pasoN = { negocio: 1, datos: 2, codigo: 3, pin: 4, listo: 4 }[nuevo.paso];
    const cerrarNuevo = () => {
      setNuevo(null);
      setMensaje(null);
      setF({ cc: f.cc, numero: "", nombre: "", codigo: "", pin: "" });
    };
    return (
      <div className="space-y-3 text-sm">
        <div className="flex items-center gap-2">
          <div className="font-bold">➕ Agregar número nuevo</div>
          <span className="ml-auto text-xs text-neutral-500">Paso {pasoN} de 4</span>
        </div>
        {mensaje && <div className="text-sm">{mensaje}</div>}

        {nuevo.paso === "negocio" && (
          <>
            <div>¿En qué <b>negocio</b> va este número?</div>
            <div className="space-y-2">
              {(negocios ?? []).map((n) => {
                const conNumeros = n.cuentas.filter((c) => c.numeros.length > 0);
                const cantidad = conNumeros.reduce((s, c) => s + c.numeros.length, 0);
                const lleno = !n.verificado && cantidad >= 2;
                const donde = conNumeros[0] ?? n.cuentas[0];
                const motivo = !donde ? "No tiene cuenta de WhatsApp: créala una vez en el WhatsApp Manager." : lleno ? "Ya tiene 2 números y no está verificado." : null;
                return (
                  <button
                    key={n.id}
                    type="button"
                    disabled={!!motivo}
                    className="block w-full rounded-lg border border-neutral-300 p-3 text-left hover:border-sky-400 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
                    onClick={() => {
                      setOtras(donde!.otrasApps);
                      setNuevo({ paso: "datos", wabaId: donde!.id, negocio: n.nombre });
                    }}
                  >
                    <div className="font-bold">🏢 {n.nombre}</div>
                    <div className="text-xs text-neutral-600">
                      {cantidad} número(s){!n.verificado ? " · sin verificar (Meta admite 2)" : ""}
                      {motivo ? ` — ${motivo}` : ""}
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="flex justify-between pt-2">
              <button type="button" className="text-neutral-500 hover:underline" onClick={cerrarNuevo}>← Volver a mis números</button>
            </div>
          </>
        )}

        {nuevo.paso === "datos" && (
          <>
            <div>
              El número para <b>{nuevo.negocio}</b>. No puede estar usándose en el WhatsApp normal o Business de un celular: si lo está, bórralo de ahí primero.
            </div>
            <div className="flex gap-2">
              <input className="w-20 rounded border px-2 py-1.5" placeholder="País" value={f.cc} onChange={(e) => setF({ ...f, cc: e.target.value })} title="Código de país sin +, por ejemplo 51" />
              <input className="flex-1 rounded border px-2 py-1.5" placeholder="Número, sin el código de país" value={f.numero} onChange={(e) => setF({ ...f, numero: e.target.value })} />
            </div>
            <input className="w-full rounded border px-2 py-1.5" placeholder="Nombre visible para tus clientes (lo revisa Meta)" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} />
            <div className="flex justify-between pt-2">
              <button type="button" className="text-neutral-500 hover:underline" onClick={() => setNuevo({ ...nuevo, paso: "negocio" })}>← Atrás</button>
              <button
                type="button"
                disabled={ocupado || !f.cc.trim() || !f.numero.trim() || !f.nombre.trim()}
                className="rounded-md bg-sky-600 px-4 py-1.5 font-bold text-white disabled:opacity-40"
                onClick={async () => {
                  const d = await pedir({ accion: "agregar", wabaId: nuevo.wabaId!, cc: f.cc, numero: f.numero, nombre: f.nombre });
                  if (d?.phoneNumberId) setNuevo({ ...nuevo, paso: "codigo", phoneNumberId: d.phoneNumberId, numero: `+${f.cc} ${f.numero}` });
                }}
              >
                {ocupado ? "Agregando…" : "Agregar →"}
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
              <button type="button" disabled={ocupado} className="rounded border bg-white px-3 py-1.5 hover:bg-neutral-50" onClick={() => void pedir({ accion: "pedirCodigo", phoneNumberId: nuevo.phoneNumberId!, metodo: "SMS" }, () => setMensaje("📩 Te mandé el código por SMS."))}>
                ✉️ Por SMS
              </button>
              <button type="button" disabled={ocupado} className="rounded border bg-white px-3 py-1.5 hover:bg-neutral-50" onClick={() => void pedir({ accion: "pedirCodigo", phoneNumberId: nuevo.phoneNumberId!, metodo: "VOICE" }, () => setMensaje("📞 Te llamarán con el código."))}>
                📞 Por llamada
              </button>
            </div>
            <input className="w-full rounded border px-2 py-1.5" placeholder="Escribe el código que te llegó" value={f.codigo} onChange={(e) => setF({ ...f, codigo: e.target.value })} />
            <div className="flex justify-end pt-2">
              <button
                type="button"
                disabled={ocupado || !f.codigo.trim()}
                className="rounded-md bg-sky-600 px-4 py-1.5 font-bold text-white disabled:opacity-40"
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
            <input className="w-full rounded border px-2 py-1.5" placeholder="PIN de 6 números" inputMode="numeric" maxLength={6} value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value })} />
            <div className="flex justify-end pt-2">
              <button
                type="button"
                disabled={ocupado || f.pin.replace(/\D/g, "").length !== 6}
                className="rounded-md bg-emerald-600 px-4 py-1.5 font-bold text-white disabled:opacity-40"
                onClick={() =>
                  aceptaDosBots(otras) &&
                  void pedir({ accion: "activar", phoneNumberId: nuevo.phoneNumberId!, pin: f.pin }, () => {
                    setMensaje(null);
                    setNuevo({ ...nuevo, paso: "listo" });
                    void cargar();
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
              <button type="button" className="rounded-md bg-sky-600 px-4 py-1.5 font-bold text-white" onClick={cerrarNuevo}>
                Volver a mis números
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3 text-sm">
      <div className="font-bold">📱 Tus números, por negocio</div>
      <p className="text-xs text-neutral-600">Los números viven en tus negocios, no en la app. Tu app los atiende a todos.</p>
      {negocios && negocios.length > 0 && (
        <button type="button" className="w-full rounded-lg border-2 border-sky-500 bg-sky-50 p-3 text-left font-bold text-sky-900 hover:bg-sky-100" onClick={() => { setMensaje(null); setNuevo({ paso: "negocio" }); }}>
          ➕ Agregar número nuevo
        </button>
      )}
      {error && <div className="text-red-700">❌ {error}</div>}
      {!negocios && !error && <div className="text-neutral-500">Consultando a Meta…</div>}
      {negocios?.length === 0 && <div className="text-neutral-600">No veo negocios. Inicia sesión con Facebook y marca tus negocios en la ventana de Meta.</div>}
      {/* POR NEGOCIO, SOLO LO QUE TIENE NÚMEROS (20/10/2026): cada negocio trae varias cuentas de
          WhatsApp vacías y salía un «Agregar número» por cada una. Ahora: sus números (de todas
          sus cuentas) y UN solo «Agregar número». Qué app atiende cada número lo dice Meta. */}
      {negocios?.map((n) => {
        const conNumeros = n.cuentas.filter((c) => c.numeros.length > 0);
        const cantidad = conNumeros.reduce((s, c) => s + c.numeros.length, 0);
        const lleno = !n.verificado && cantidad >= 2;
        const dondeAgregar = conNumeros[0] ?? n.cuentas[0];
        return (
          <div key={n.id} className="rounded-lg border border-neutral-200 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <b>🏢 {n.nombre}</b>
              {!n.verificado && <span className="rounded bg-amber-100 px-1.5 text-xs text-amber-900">Sin verificar · Meta admite 2 números</span>}
              <span className="text-xs text-neutral-500">{cantidad} número(s)</span>
            </div>
            {conNumeros.map((c) =>
              c.numeros.map((x) => (
                <div key={x.id} className="mt-1 rounded bg-neutral-50 px-2 py-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono">{x.numero}</span>
                    <span className="text-xs text-neutral-500">{x.nombre}</span>
                    <span className="ml-auto" />
                    {x.estado === "activo" && c.estaApp && <span className="text-xs font-semibold text-emerald-700">✅ Lo atiende este CRM</span>}
                    {x.estado === "activo" && !c.estaApp && (
                      <button type="button" disabled={ocupado} className="rounded bg-sky-600 px-2 py-0.5 text-xs font-bold text-white" onClick={() => aceptaDosBots(c.otrasApps) && void pedir({ accion: "traer", phoneNumberId: x.id }, () => void cargar())}>
                        Traer a este CRM
                      </button>
                    )}
                    {x.estado === "sin_activar" && (
                      <button type="button" className="rounded bg-sky-600 px-2 py-0.5 text-xs font-bold text-white" onClick={() => { setOtras(c.otrasApps); setTrabajo({ tipo: "pin", phoneNumberId: x.id, numero: x.numero }); }}>
                        Activar
                      </button>
                    )}
                    {x.estado === "sin_verificar" && (
                      <button type="button" className="rounded bg-sky-600 px-2 py-0.5 text-xs font-bold text-white" onClick={() => { setOtras(c.otrasApps); setTrabajo({ tipo: "codigo", phoneNumberId: x.id, numero: x.numero }); }}>
                        Verificar y activar
                      </button>
                    )}
                  </div>
                  {/* Quién más lo atiende: en gris si es solo información; en rojo si ESTE CRM también
                      (ahí contestan dos bots). */}
                  {c.otrasApps.length > 0 &&
                    (c.estaApp ? (
                      <div className="mt-0.5 text-xs font-semibold text-red-700">
                        ⚠ También lo atiende «{c.otrasApps.join(", ")}»: a cada cliente le contestan dos bots. Quítale la suscripción a la otra desde el proyecto que la usa.
                      </div>
                    ) : (
                      <div className="mt-0.5 text-xs text-neutral-500">Lo atiende: {c.otrasApps.join(", ")}</div>
                    ))}
                </div>
              ))
            )}
            {/* (Agregar va arriba, en «➕ Agregar número nuevo», con su paso a paso.) */}
            {!dondeAgregar && (
              <div className="mt-1 text-xs text-neutral-600">Este negocio no tiene cuenta de WhatsApp todavía. Créala una vez en el WhatsApp Manager de Meta.</div>
            )}
            {lleno && <div className="mt-1 text-xs text-neutral-500">Lleno: para agregar otro, verifica este negocio en Meta o usa otro negocio.</div>}
          </div>
        );
      })}

      {trabajo && (
        <div className="space-y-2 rounded-lg border-2 border-sky-400 bg-sky-50 p-3">
          {trabajo.tipo === "agregar" && (
            <>
              <b>➕ Agregar número</b>
              <div className="text-xs">El número no debe estar en uso en otro WhatsApp (app normal o Business). Si lo está, bórralo de ahí primero.</div>
              <div className="flex gap-2">
                <input className="w-20 rounded border px-2 py-1" placeholder="País" value={f.cc} onChange={(e) => setF({ ...f, cc: e.target.value })} title="Código de país sin +, por ejemplo 51" />
                <input className="flex-1 rounded border px-2 py-1" placeholder="Número, sin el código de país" value={f.numero} onChange={(e) => setF({ ...f, numero: e.target.value })} />
              </div>
              <input className="w-full rounded border px-2 py-1" placeholder="Nombre visible (lo revisa Meta)" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} />
              <button
                type="button"
                disabled={ocupado}
                className="rounded bg-sky-600 px-3 py-1 font-bold text-white disabled:opacity-50"
                onClick={async () => {
                  const d = await pedir({ accion: "agregar", wabaId: trabajo.wabaId, cc: f.cc, numero: f.numero, nombre: f.nombre });
                  if (d?.phoneNumberId) setTrabajo({ tipo: "codigo", phoneNumberId: d.phoneNumberId, numero: `+${f.cc} ${f.numero}` });
                }}
              >
                Agregar
              </button>
            </>
          )}
          {trabajo.tipo === "codigo" && (
            <>
              <b>Verificar {trabajo.numero}</b>
              <div className="flex gap-2">
                <button type="button" disabled={ocupado} className="rounded border bg-white px-2 py-1" onClick={() => void pedir({ accion: "pedirCodigo", phoneNumberId: trabajo.phoneNumberId, metodo: "SMS" }, () => setMensaje("📩 Te mandé el código por SMS."))}>
                  Enviarme el código por SMS
                </button>
                <button type="button" disabled={ocupado} className="rounded border bg-white px-2 py-1" onClick={() => void pedir({ accion: "pedirCodigo", phoneNumberId: trabajo.phoneNumberId, metodo: "VOICE" }, () => setMensaje("📞 Te llamarán con el código."))}>
                  Por llamada
                </button>
              </div>
              <input className="w-full rounded border px-2 py-1" placeholder="Código que te llegó" value={f.codigo} onChange={(e) => setF({ ...f, codigo: e.target.value })} />
              <button
                type="button"
                disabled={ocupado}
                className="rounded bg-sky-600 px-3 py-1 font-bold text-white disabled:opacity-50"
                onClick={() => void pedir({ accion: "verificar", phoneNumberId: trabajo.phoneNumberId, codigo: f.codigo }, () => setTrabajo({ tipo: "pin", phoneNumberId: trabajo.phoneNumberId, numero: trabajo.numero }))}
              >
                Verificar
              </button>
            </>
          )}
          {trabajo.tipo === "pin" && (
            <>
              <b>Activar {trabajo.numero}</b>
              <div className="text-xs">Elige un PIN de 6 números y <b>guárdalo</b>: activa la verificación en dos pasos y Meta puede pedírtelo después.</div>
              <input className="w-full rounded border px-2 py-1" placeholder="PIN de 6 números" inputMode="numeric" maxLength={6} value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value })} />
              <button
                type="button"
                disabled={ocupado}
                className="rounded bg-emerald-600 px-3 py-1 font-bold text-white disabled:opacity-50"
                onClick={() =>
                  aceptaDosBots(otras) &&
                  void pedir({ accion: "activar", phoneNumberId: trabajo.phoneNumberId, pin: f.pin }, () => {
                    setTrabajo(null);
                    setMensaje("✅ Número activo y en tu CRM. Ya puedes elegirlo en tu tienda.");
                    setF({ cc: f.cc, numero: "", nombre: "", codigo: "", pin: "" });
                    void cargar();
                  })
                }
              >
                Activar
              </button>
            </>
          )}
          <button type="button" className="ml-2 text-xs text-neutral-500 hover:underline" onClick={() => setTrabajo(null)}>
            Cancelar
          </button>
        </div>
      )}
      {mensaje && <div className="text-sm">{mensaje}</div>}

      <div className="flex justify-between">
        <button type="button" className="text-neutral-500 hover:underline" onClick={volver}>← Atrás</button>
        <button type="button" className="rounded-md bg-sky-600 px-4 py-1.5 font-bold text-white" onClick={seguir}>
          Continuar →
        </button>
      </div>
    </div>
  );
}

interface EstadoDelToken {
  tiene: boolean;
  negocioDelToken: { id: string; nombre: string } | null;
  numero: { numero: string; negocioId: string | null; negocio: string | null } | null;
  vence: number | null;
  appId: string | null;
  negocios: Array<{ id: string; nombre: string; conLaApp: boolean }>;
}

const fecha = (ms: number) => new Date(ms).toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric" });

/**
 * EL TOKEN PERMANENTE, PASO OBLIGATORIO (20/10/2026): «no es un chiste… es una de las bases del
 * proyecto». Se crea en el BM del NÚMERO que atiende (si no, el bot puede no poder contestar por
 * él), y Meta solo deja crearlo donde la app está agregada: si no lo está, primero se agrega, con
 * un botón directo a ese BM y el ID de la app para copiar. «Continuar» solo con el token creado.
 */
function PasoToken({ volver, seguir }: { volver: () => void; seguir: () => void }) {
  const [e, setE] = useState<EstadoDelToken | null>(null);
  const [elegido, setElegido] = useState<string>("");
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const cargar = useCallback(async () => {
    try {
      const d = (await (await fetch("/api/meta/connect/token-estado", { cache: "no-store" })).json()) as EstadoDelToken;
      setE(d);
      setElegido((actual) => actual || d.numero?.negocioId || d.negocios.find((n) => n.conLaApp)?.id || d.negocios[0]?.id || "");
    } catch {
      setAviso("No se pudo consultar a Meta.");
    }
  }, []);
  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function crear() {
    // REEMPLAZAR UN TOKEN QUE YA FUNCIONA: vale para todo el proyecto. Los números de otro BM que
    // el nuevo no pueda usar dejarían de contestar.
    if (
      e?.tiene &&
      !window.confirm(
        `Ya tienes un token permanente${e.negocioDelToken ? ` en «${e.negocioDelToken.nombre}»` : ""}. El nuevo lo REEMPLAZA para todo este proyecto: si tienes números de otros BM, esos podrían dejar de contestar.\n\n¿Seguir?`
      )
    )
      return;
    setOcupado(true);
    setAviso(null);
    try {
      const d = await (await fetch("/api/meta/connect/token-permanente", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ negocio: elegido }) })).json();
      if (!d.ok) setAviso(d.sugerencia ? `${d.sugerencia.quePasa} 👉 ${d.sugerencia.queHacer}` : d.error ?? "Meta no dejó crearlo.");
      await cargar();
    } catch {
      setAviso("No se pudo consultar a Meta.");
    } finally {
      setOcupado(false);
    }
  }

  if (!e) return <div className="text-sm text-neutral-500">Revisando tu token…</div>;
  const destino = e.negocios.find((n) => n.id === elegido);
  const distintos = e.tiene && !!e.negocioDelToken && !!e.numero?.negocioId && e.negocioDelToken.id !== e.numero.negocioId;

  return (
    <div className="space-y-3 text-sm">
      <div className="font-bold">🔐 Token permanente</div>
      <p className="text-xs text-neutral-600">
        Con él el bot contesta por WhatsApp, reporta tus compras y lee tus anuncios. <b>No caduca.</b>
      </p>

      {e.tiene ? (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2">
          ✅ Ya tienes token permanente{e.negocioDelToken ? <> en el BM <b>{e.negocioDelToken.nombre}</b></> : null}.
        </div>
      ) : (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-red-800">
          ⚠ Todavía no tienes token permanente.{e.vence ? <> Tu conexión <b>caduca el {fecha(e.vence)}</b>.</> : null}
        </div>
      )}

      {distintos && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-red-800">
          ⚠ Tu número {e.numero?.numero} está en el BM <b>{e.numero?.negocio}</b>, pero el token está en <b>{e.negocioDelToken?.nombre}</b>. El bot podría no poder contestar por ese número. Créalo en el BM de tu número.
        </div>
      )}

      {(!e.tiene || distintos) && (
        <div className="space-y-2 rounded-lg border border-neutral-200 p-3">
          {e.numero && (
            <div>
              Tu número <b>{e.numero.numero}</b> está en el BM <b>{e.numero.negocio ?? "sin identificar"}</b>. El token se crea ahí.
            </div>
          )}
          <label className="block text-xs text-neutral-600">
            BM donde crearlo:
            <select className="ml-2 rounded border px-1 py-0.5" value={elegido} onChange={(ev) => setElegido(ev.target.value)}>
              {e.negocios.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.nombre}
                  {n.conLaApp ? " · tiene la app" : ""}
                  {n.id === e.numero?.negocioId ? " · el de tu número" : ""}
                </option>
              ))}
            </select>
          </label>

          {destino && !destino.conLaApp && (
            <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-2">
              <div>
                <b>1. Agrega tu app a «{destino.nombre}».</b> Meta no deja crear el token en un BM que no tiene la app. En la página que se abre: <i>Agregar → Conectar un identificador de app</i>, pega el ID y confirma.
              </div>
              {e.appId && <Copiar texto={e.appId} />}
              <a href={`https://business.facebook.com/settings/apps?business_id=${destino.id}`} target="_blank" rel="noreferrer" className="inline-block rounded-md bg-[#1877f2] px-3 py-1.5 font-bold text-white">
                Abrir «Apps» de {destino.nombre} ↗
              </a>
              <div>
                <button type="button" className="text-xs font-bold text-sky-700 hover:underline" onClick={() => void cargar()}>
                  Ya la agregué → Revisar
                </button>
              </div>
            </div>
          )}

          <button
            type="button"
            disabled={ocupado || !destino?.conLaApp}
            title={destino?.conLaApp ? "" : "Primero agrega tu app a este BM"}
            className="rounded-md bg-sky-600 px-4 py-1.5 font-bold text-white disabled:opacity-40"
            onClick={() => void crear()}
          >
            {ocupado ? "Creando…" : `${destino && !destino.conLaApp ? "2. " : ""}Crear token permanente${destino ? ` en «${destino.nombre}»` : ""}`}
          </button>
          {!aviso && (
            <div className="text-xs text-neutral-600">
              La primera vez, Meta suele pedir un código que te manda por correo. Si pasa, aquí te decimos qué hacer.
            </div>
          )}
          {/* META PIDE UNA PERSONA (20/10/2026, lo vivió él): el primer intento casi nunca crea el
              token. Meta deja una SOLICITUD en el BM que solo se ve entrando allí («Se ha solicitado…
              verifica antes de generar»): al aceptarla manda un código de 6 dígitos al correo; con
              el código puesto, el segundo intento sí lo crea. Eso no se puede hacer desde aquí. */}
          {aviso && destino && (
            <div className="space-y-2 rounded-md border-2 border-amber-400 bg-amber-50 p-3 text-sm">
              <div className="font-bold">👉 Meta te pide confirmarlo. Es normal la primera vez.</div>
              <div>
                Ve a tu BM <b>{destino.nombre}</b>, confirma el aviso que pide <b>enviar un código a tu correo</b> y escribe el código que te llegue.
              </div>
              <div className="text-xs text-neutral-600">
                Si Meta te pide dar privilegios a la app, dáselos (control total).
              </div>
              <a href={`https://business.facebook.com/settings/system-users?business_id=${destino.id}`} target="_blank" rel="noreferrer" className="inline-block rounded-md bg-[#1877f2] px-3 py-1.5 font-bold text-white">
                Ir a {destino.nombre} ↗
              </a>
              <div>
                Luego vuelve aquí y pulsa <b>«Crear token permanente»</b> otra vez.
              </div>
              <div className="text-xs text-neutral-500">Lo que respondió Meta: {aviso}</div>
            </div>
          )}
          {aviso && !destino && <div className="text-xs text-red-700">❌ {aviso}</div>}
        </div>
      )}

      <div className="flex justify-between pt-2">
        <button type="button" className="text-neutral-500 hover:underline" onClick={volver}>← Atrás</button>
        <button type="button" disabled={!e.tiene} title={e.tiene ? "" : "Crea el token permanente para seguir"} className="rounded-md bg-sky-600 px-4 py-1.5 font-bold text-white disabled:opacity-40" onClick={seguir}>
          Continuar →
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
