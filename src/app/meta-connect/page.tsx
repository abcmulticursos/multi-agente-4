"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import AsistenteDeConexion from "./asistente";

type MetaStatus = {
  configured: boolean;
  appId: string | null;
  appName: string | null;
  credentials: {
    appSecretConfigured: boolean;
    messengerAppSecretOverrideConfigured: boolean;
    messengerEnvSecretConfigured: boolean;
    instagramAppSecretConfigured: boolean;
    whatsAppAccessTokenConfigured: boolean;
  };
  missing: string[];
  webhookUrls: {
    whatsapp: string;
    messenger: string;
    instagram: string;
  };
  webhookTokens: {
    whatsapp: string | null;
    messenger: string | null;
    instagram: string | null;
  };
  notes: string[];
  envExtractor: {
    detected: Array<{
      name: string;
      value: string;
      source: string;
      detected_at: number;
    }>;
    detectedEnvBlock: string;
    manualEnvBlock: string;
    detectedCount: number;
  };
  connections: Array<{
    pageId: string;
    pageName: string;
    pagePictureUrl: string | null;
    instagramBusinessAccountId: string | null;
    instagramUsername: string | null;
    active: boolean;
    instagramActive: boolean;
    connectedAt: number;
    updatedAt: number;
    /** La cuenta dueña. null = sin identificar todavía. */
    businessName?: string | null;
    businessId?: string | null;
    /** Ids de las cuentas que pueden usarla (dueña + compartidas). */
    accesoDe?: string[];
  }>;
  detectedPages: Array<{
    pageId: string;
    pageName: string;
    pagePictureUrl: string | null;
    instagramBusinessAccountId: string | null;
    instagramUsername: string | null;
    active: boolean;
    instagramActive: boolean;
    connectedAt: number;
    updatedAt: number;
    businessName?: string | null;
    businessId?: string | null;
    accesoDe?: string[];
  }>;
  whatsAppConnections: Array<{
    phoneNumberId: string;
    wabaId: string;
    displayPhoneNumber: string | null;
    verifiedName: string | null;
    profilePictureUrl: string | null;
    active: boolean;
    /** Pausado en este proyecto: este bot ignora sus mensajes. */
    pausado?: boolean;
    connectedAt: number;
    updatedAt: number;
    /** La cuenta dueña. null = sin identificar todavía. */
    businessName?: string | null;
    businessId?: string | null;
    accesoDe?: string[];
  }>;
  whatsAppManualMode: boolean;
  whatsAppManualEnvReady: boolean;
  /** ¿Ya se inició sesión con Facebook? Sin eso, Meta Connect solo muestra el asistente. */
  conectadoConFacebook?: boolean;
  /** El nombre de la cuenta de Facebook con la que se inició sesión. */
  cuentaDeFacebook?: string | null;
};

type ConfigureResult = {
  ok: boolean;
  pageName?: string;
  subscription?: {
    ok: boolean;
    fields: string[];
    status: number;
    message: string;
  };
  /** Suscripcion a `feed`, que es la que trae los comentarios de la pagina. */
  commentSubscription?: {
    ok: boolean;
    estado?: "activo" | "no_activo" | "sin_comprobar";
    detail: string;
  };
  nextSteps?: string[];
  error?: string;
};

interface OpcionDeSelector {
  valor: string;
  titulo: string;
  subtitulo?: string | null;
  /** URL de la foto. Si no hay, o si falla, se dibuja el círculo con inicial. */
  foto?: string | null;
  inicial: string;
  colorCirculo: string;
  activa: boolean;
  /**
   * Encabezado bajo el que se agrupa esta opción — el negocio del que viene.
   * Sin grupo la opción va al final, suelta y sin encabezado: es donde va
   * "usar la variable de entorno", que no pertenece a ningún negocio.
   */
  grupo?: string | null;
}

/**
 * Avatar de una opción. Si no hay foto —o si la que hay no carga— se dibuja un
 * círculo con la inicial, para que la fila nunca quede coja.
 */
function AvatarDeOpcion({
  foto,
  inicial,
  colorCirculo,
}: {
  foto?: string | null;
  inicial: string;
  colorCirculo: string;
}) {
  const [fallo, setFallo] = useState(false);
  if (foto && !fallo) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={foto}
        alt=""
        onError={() => setFallo(true)}
        className="h-9 w-9 shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <span
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${colorCirculo}`}
    >
      {inicial}
    </span>
  );
}

/**
 * Desplegable con foto.
 *
 * Se construye a mano y no con un <select> porque un <option> del navegador
 * solo admite texto: no hay forma de meterle una imagen.
 *
 * Elegir una opción distinta a la activa CAMBIA lo que usa el bot, así que
 * siempre pide confirmación antes. Elegir la que ya está activa no hace nada.
 */
/**
 * Una fila del desplegable. Está aparte porque ahora se pinta desde dos sitios:
 * dentro de un grupo y suelta al final.
 */
function FilaDeOpcion({
  opcion,
  onElegir,
}: {
  opcion: OpcionDeSelector;
  onElegir: (opcion: OpcionDeSelector) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onElegir(opcion)}
      className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-neutral-50"
    >
      <AvatarDeOpcion
        foto={opcion.foto}
        inicial={opcion.inicial}
        colorCirculo={opcion.colorCirculo}
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm text-neutral-950">
            {opcion.titulo}
          </span>
          {opcion.activa ? (
            <span className="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700">
              Activa
            </span>
          ) : null}
        </span>
        {opcion.subtitulo ? (
          <span className="block truncate text-xs text-neutral-500">
            {opcion.subtitulo}
          </span>
        ) : null}
      </span>
    </button>
  );
}

function SelectorDeCuenta({
  etiqueta,
  opciones,
  ocupado,
  vacio,
  confirmar,
  onElegir,
}: {
  etiqueta: string;
  opciones: OpcionDeSelector[];
  ocupado: boolean;
  vacio: string;
  confirmar: (opcion: OpcionDeSelector) => string;
  onElegir: (valor: string) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  // La caja de búsqueda NO es un campo de formulario.
  //
  // Siendo un campo de formulario, el navegador la trataba como el usuario de un formulario de
  // login —en esta pantalla hay campos de contraseña— y le metía contraseñas
  // guardadas. Se probó con type=search, autocomplete=off, un nombre distinto
  // cada vez y descartando lo que no se teclea: el texto dejaba de entrar,
  // pero el cuadro de "contraseñas guardadas" seguía apareciendo encima y
  // tapando la lista. El problema no era cómo se marcaba el campo, era SER un
  // campo de formulario.
  //
  // Un div editable no lo es. Los navegadores no autorrellenan contenido
  // editable ni le ofrecen nada, así que no hay ni relleno ni cuadro.
  const cajaDeBusqueda = useRef<HTMLDivElement | null>(null);
  // La confirmación se pinta DENTRO de la página y no con window.confirm: el
  // navegador bloquea esos cuadros cuando aparecen varias veces seguidas, y
  // entonces devuelven "no" al instante. El desplegable se cerraba y no pasaba
  // nada — parecía que estuviera roto.
  const [porConfirmar, setPorConfirmar] = useState<OpcionDeSelector | null>(
    null
  );
  const activa = opciones.find((opcion) => opcion.activa) ?? null;

  // Buscar sin tildes ni mayúsculas: escribir "peru" tiene que encontrar
  // "Perú", y media palabra tiene que encontrar el nombre completo.
  const sinAdornos = (texto: string) =>
    texto
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Mn}/gu, "");
  const aguja = sinAdornos(busqueda.trim());
  const visibles = aguja
    ? opciones.filter((opcion) =>
        sinAdornos(`${opcion.titulo} ${opcion.subtitulo ?? ""}`).includes(aguja)
      )
    : opciones;

  // Agrupadas por negocio y alfabéticas dentro de cada grupo. Una lista larga
  // de pixels llegaba en el orden en que Meta los devolvió, que no es ninguno:
  // dos del mismo negocio podían quedar separados por cinco de otro, y sin
  // mirar el subtítulo no había forma de saber de dónde venía cada uno.
  //
  // localeCompare para que la eñe y las tildes queden donde uno las busca.
  const porNombre = (a: OpcionDeSelector, b: OpcionDeSelector) =>
    a.titulo.localeCompare(b.titulo, "es", { sensitivity: "base" });

  const grupos: Array<{ nombre: string; opciones: OpcionDeSelector[] }> = [];
  for (const opcion of visibles) {
    if (!opcion.grupo) continue;
    const yaEsta = grupos.find((grupo) => grupo.nombre === opcion.grupo);
    if (yaEsta) yaEsta.opciones.push(opcion);
    else grupos.push({ nombre: opcion.grupo, opciones: [opcion] });
  }
  grupos.sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" }));
  for (const grupo of grupos) grupo.opciones.sort(porNombre);
  const sueltas = visibles.filter((opcion) => !opcion.grupo);

  // Al abrir o cerrar se limpia lo buscado: si no, al volver a abrir aparece
  // media lista escondida por una búsqueda de hace rato.
  //
  // Los dos cambios van SEPARADOS. Antes el setBusqueda estaba dentro de la
  // función que calcula el abierto, y esa función tiene que ser pura: React
  // puede ejecutarla más de una vez, y cada vez invertía el valor. El
  // desplegable se abría y se cerraba solo. Se notaba únicamente en el selector
  // de pixel porque es el que tiene más cosas cargando alrededor, y cada
  // respuesta que llegaba provocaba otro recálculo.
  const alternar = () => {
    setBusqueda("");
    setAbierto((valor) => !valor);
  };

  // El div editable no tiene autoFocus, así que se enfoca a mano al abrir.
  useEffect(() => {
    if (abierto) cajaDeBusqueda.current?.focus();
  }, [abierto]);

  if (!opciones.length) {
    return (
      <div className="px-4 py-3 text-sm text-neutral-500">{vacio}</div>
    );
  }

  const elegir = (opcion: OpcionDeSelector) => {
    setAbierto(false);
    setBusqueda("");
    if (opcion.activa) return;
    setPorConfirmar(opcion);
  };

  return (
    <div className="relative px-4 py-3">
      {porConfirmar ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-tarjeta p-5 shadow-xl">
            <p className="whitespace-pre-line text-sm text-neutral-900">
              {confirmar(porConfirmar)}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPorConfirmar(null)}
                className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  const elegida = porConfirmar;
                  setPorConfirmar(null);
                  onElegir(elegida.valor);
                }}
                className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700"
              >
                Sí, cambiar
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <p className="mb-1 text-xs font-semibold text-neutral-700">{etiqueta}</p>
      <button
        type="button"
        disabled={ocupado}
        onClick={alternar}
        className="flex w-full items-center gap-3 rounded-lg border border-neutral-300 bg-tarjeta px-3 py-2 text-left hover:border-neutral-400 disabled:opacity-60"
      >
        {activa ? (
          <>
            <AvatarDeOpcion
              foto={activa.foto}
              inicial={activa.inicial}
              colorCirculo={activa.colorCirculo}
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-neutral-950">
                  {activa.titulo}
                </span>
                <span className="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700">
                  Activa
                </span>
              </span>
              {activa.subtitulo ? (
                <span className="block truncate text-xs text-neutral-500">
                  {activa.subtitulo}
                </span>
              ) : null}
            </span>
          </>
        ) : (
          <span className="flex-1 text-sm text-neutral-500">
            Ninguna activa — elige una
          </span>
        )}
        <span className="shrink-0 text-neutral-400">{ocupado ? "…" : "▾"}</span>
      </button>

      {abierto ? (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => {
              setAbierto(false);
              setBusqueda("");
            }}
          />
          <div className="absolute left-4 right-4 z-20 mt-1 rounded-lg border border-neutral-200 bg-tarjeta shadow-lg">
            {/* El buscador solo aparece cuando la lista es larga: con dos o tres
                cuentas estorba más de lo que ayuda. */}
            {opciones.length > 5 ? (
              <div className="border-b border-neutral-100 p-2">
                <div className="relative">
                  {/* El marcador de texto va aparte: un div editable no tiene
                      placeholder propio. */}
                  {busqueda ? null : (
                    <span className="pointer-events-none absolute left-2 top-1.5 text-sm text-neutral-400">
                      Buscar por nombre o número…
                    </span>
                  )}
                  {/* Editable, no un campo de formulario: así el navegador no lo
                      confunde con el usuario de un login ni le ofrece claves.
                      El contenido lo lleva el DOM y aquí solo se LEE — fijarlo
                      desde React en cada pulsación mandaría el cursor al
                      principio y no se podría escribir. */}
                  <div
                    ref={cajaDeBusqueda}
                    role="searchbox"
                    aria-label="Buscar"
                    contentEditable
                    suppressContentEditableWarning
                    spellCheck={false}
                    onInput={(event) =>
                      setBusqueda(event.currentTarget.textContent ?? "")
                    }
                    className="min-h-[32px] w-full rounded border border-neutral-300 px-2 py-1.5 text-sm outline-none focus:border-neutral-400"
                  />
                </div>
              </div>
            ) : null}
            <div className="max-h-80 overflow-y-auto py-1">
            {visibles.length === 0 ? (
              <p className="px-3 py-4 text-center text-sm text-neutral-500">
                Nada coincide con «{busqueda}»
              </p>
            ) : null}
            {grupos.map((grupo) => (
              <div key={grupo.nombre}>
                <p className="sticky top-0 z-10 border-y border-neutral-200 bg-neutral-100 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-neutral-700">
                  {grupo.nombre}
                </p>
                {grupo.opciones.map((opcion) => (
                  <FilaDeOpcion
                    key={opcion.valor}
                    opcion={opcion}
                    onElegir={elegir}
                  />
                ))}
              </div>
            ))}
            {sueltas.map((opcion) => (
              <button
                key={opcion.valor}
                type="button"
                onClick={() => elegir(opcion)}
                className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-neutral-50"
              >
                <AvatarDeOpcion
                  foto={opcion.foto}
                  inicial={opcion.inicial}
                  colorCirculo={opcion.colorCirculo}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm text-neutral-950">
                      {opcion.titulo}
                    </span>
                    {opcion.activa ? (
                      <span className="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700">
                        Activa
                      </span>
                    ) : null}
                  </span>
                  {opcion.subtitulo ? (
                    <span className="block truncate text-xs text-neutral-500">
                      {opcion.subtitulo}
                    </span>
                  ) : null}
                </span>
              </button>
            ))}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

/** Lo que devuelve `/api/meta/connect/cuentas`. */
type EstadoDePieza = "ok" | "compartido" | "falta" | "otra" | "?" | "general";
type TiendaEnTarjeta = {
  id: string;
  nombre: string;
  color: string | null;
  numero: string;
  pagina: EstadoDePieza;
  pixel: EstadoDePieza;
  /** El píxel con el que mide de verdad: con ése se prueba. */
  pixelId: string | null;
  mezcla: string | null;
};
type CuentasDeMeta = {
  /** Cuántas cuentas de Facebook trajeron algún negocio. 0 = aún sin apuntar. */
  cuentasDeFacebook: number;
  /** Cuántos NEGOCIOS hay. */
  total: number;
  cuentas: Array<{
    id: string;
    nombre: string;
    /** La cuenta de Facebook que trajo este negocio. null = no apuntada. */
    facebookNombre: string | null;
    numeros: string[];
    numerosConId: Array<{ id: string; etiqueta: string; detalle: string | null }>;
    paginas: string[];
    paginasConId: Array<{ id: string; etiqueta: string; detectada: boolean }>;
    pixels: string[];
    /** Lo que otras cuentas le compartieron. `id` solo en los números. */
    compartidos: Array<{ que: "número" | "página" | "píxel"; nombre: string; de: string; id?: string }>;
    medicion: "permanente" | "login" | "general";
    origen: "principal" | "nueva";
    puedeGenerarPermanente: boolean;
    pixelParaProbar: string | null;
    tiendas: TiendaEnTarjeta[];
  }>;
  sinIdentificar: {
    numeros: string[];
    numerosConId: Array<{ id: string; etiqueta: string; detalle: string | null }>;
    paginas: string[];
    tiendas: TiendaEnTarjeta[];
  };
  pixelsDeOtras: string[];
  /** Toda cuenta de Facebook que inició sesión, con los BM que trajo (21/10/2026). */
  conectadas?: Array<{ nombre: string | null; origen: "principal" | "nueva"; negocios: string[] }>;
};

/** Cómo se lee cada pieza en la fila de una tienda: icono y qué quiere decir. */
const LECTURA_DE_PIEZA: Record<EstadoDePieza, { icono: string; dice: string }> = {
  ok: { icono: "✓", dice: "de esta cuenta" },
  compartido: { icono: "✓", dice: "compartido con esta cuenta" },
  falta: { icono: "⚠️", dice: "sin elegir" },
  otra: { icono: "⚠️", dice: "de otra cuenta y NO compartido con ésta" },
  "?": { icono: "?", dice: "sin identificar" },
  general: { icono: "✓", dice: "usa el de Meta Connect" },
};

function FilaDeTienda({ tienda }: { tienda: TiendaEnTarjeta }) {
  const pieza = (que: string, estado: EstadoDePieza) => (
    <span
      title={`${que}: ${LECTURA_DE_PIEZA[estado].dice}`}
      className={`shrink-0 text-xs ${
        estado === "otra" || estado === "falta" ? "font-bold text-amber-700" : "text-tinta-suave"
      }`}
    >
      {que} {LECTURA_DE_PIEZA[estado].icono}
    </span>
  );
  return (
    <div className="px-4 py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span
          aria-hidden
          className="h-3.5 w-3.5 shrink-0 rounded-full border border-black/20"
          style={{ backgroundColor: tienda.color ?? "#99f6e4" }}
        />
        <span className="min-w-0 flex-1 truncate text-sm font-bold text-tinta">
          {tienda.nombre}
        </span>
        <span className="shrink-0 text-xs text-tinta-suave">{tienda.numero}</span>
        {pieza("Pág.", tienda.pagina)}
        {pieza("Px", tienda.pixel)}
      </div>
      {tienda.mezcla ? (
        <p className="mt-1 text-xs font-bold text-amber-700">⚠️ {tienda.mezcla}</p>
      ) : null}
    </div>
  );
}

/**
 * TUS CUENTAS DE META: CUÁNTAS HAY Y QUÉ TIENDAS CUELGAN DE CADA UNA.
 *
 * LO PIDIÓ EL DUEÑO el 09/10/2026: «necesito yo saber cuántas cuentas de facebook están
 * conectadas, en este momento no lo veo, es incierto». Y: «es como si fuese un meta
 * connect único donde todo está combinado». El dibujo está en
 * PLAN-VARIAS-CUENTAS-DE-FACEBOOK.md, apartado 2.
 *
 * VA ARRIBA DEL TODO porque el contador es lo primero que él quiere ver al abrir. Y no
 * está en una ventana como las demás secciones: algo que hay que abrir para enterarse no
 * quita la incertidumbre.
 *
 * MIRAR NO CAMBIA NADA de lo que el bot usa; para elegir siguen estando las secciones de
 * abajo, que no se tocaron.
 *
 * ── LA PARTE 2: CADA CUENTA MIDE CON LO SUYO ──────────────────────────────
 *
 * Aprobada el 10/10/2026. Cada tarjeta dice con qué permiso se avisan a Meta sus compras,
 * deja generarle su permiso permanente y probar la medición con un píxel suyo. Y abajo
 * está «Conectar nueva cuenta», que entra con otra cuenta SIN tocar nada de la de siempre
 * — ni su permiso, ni el número activo, ni sus píxeles. Ver `callback/route.ts`.
 */
const MEDICION_DICE: Record<CuentasDeMeta["cuentas"][number]["medicion"], string> = {
  permanente: "✓ con su permiso permanente (no caduca)",
  login: "⚠️ con el permiso de su login — caduca a los 60 días; genera el permanente",
  general: "con el permiso general de Meta Connect",
};

/**
 * LA MEDICIÓN DE COMPRAS, CUENTA POR CUENTA — vive en la sección «7. Píxel».
 *
 * Hasta el 10/10/2026 iba dentro de las tarjetas de arriba, junto con todo lo demás, y él
 * lo encontró «bien enredado, no está nada intuitivo». Arriba quedó solo la diferenciación
 * (`DiferenciacionPorNegocio`), y esto se vino aquí, que es donde se habla de medir.
 */
function MedicionPorCuenta() {
  const [datos, setDatos] = useState<CuentasDeMeta | null>(null);
  const [fallo, setFallo] = useState(false);
  const [codigoDePrueba, setCodigoDePrueba] = useState("");
  /** El resultado de la última acción de cada cuenta, por su id. */
  const [resultados, setResultados] = useState<Record<string, string>>({});
  const [ocupada, setOcupada] = useState<string | null>(null);
  const cargar = () =>
    fetch("/api/meta/connect/cuentas", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: CuentasDeMeta) => setDatos(d))
      .catch(() => setFallo(true));
  useEffect(() => {
    void cargar();
  }, []);

  const anotar = (cuenta: string, texto: string) =>
    setResultados((r) => ({ ...r, [cuenta]: texto }));

  /** Su permiso permanente, generado con el de su login y guardado SOLO en ella. */
  async function generarPermanente(cuenta: string) {
    setOcupada(cuenta);
    try {
      const res = await fetch("/api/meta/connect/token-permanente", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cuenta }),
      });
      const d = await res.json().catch(() => null);
      anotar(
        cuenta,
        d?.ok
          ? `✅ Permiso permanente generado (usuario del sistema: ${d.usuario}). Sus compras ya miden con él.`
          : `❌ ${d?.error ?? "Meta no dejó generarlo."}${
              d?.sugerencia ? `\n${d.sugerencia.quePasa}\n${d.sugerencia.queHacer}` : ""
            }`
      );
      await cargar();
    } catch {
      anotar(cuenta, "❌ No se pudo hablar con el servidor.");
    } finally {
      setOcupada(null);
    }
  }

  /** La misma prueba de la sección Píxel, con el permiso de ESTA cuenta y ESE píxel. */
  async function probarUnPixel(cuenta: string, pixelId: string): Promise<string> {
    try {
      const res = await fetch("/api/meta/connect/capi", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cuenta, pixelId, codigoDePrueba }),
      });
      const d = await res.json().catch(() => null);
      if (!d?.ok) {
        return `❌ Meta no deja usar el píxel con este permiso: ${d?.error ?? "sin detalle"}`;
      }
      const conQue = d.conPermisoDeLaCuenta ? "su propio permiso" : "el permiso general";
      const envio = !d.envio
        ? " Para la prueba definitiva, escribe tu código de prueba abajo y vuelve a probar."
        : d.envio.ok
          ? " ✅ Y Meta ACEPTÓ una compra de prueba (mírala en Administrador de eventos → Probar eventos)."
          : ` ❌ Pero Meta RECHAZÓ la compra de prueba: ${d.envio.detalle}`;
      return `✅ Con ${conQue}, Meta deja usar «${d.pixelNombre ?? pixelId}».${envio}`;
    } catch {
      return "❌ No se pudo hablar con el servidor.";
    }
  }

  /**
   * PROBAR CADA TIENDA CON EL PÍXEL QUE DE VERDAD USA.
   *
   * La primera versión probaba un píxel cualquiera de la cuenta, y eso no decía si las
   * compras de SUS tiendas se iban a contar — que es lo único que él quiere saber. Ahora
   * cada tienda se prueba con su píxel (o el de Meta Connect si lo dejó vacío) y con el
   * permiso con el que mide de verdad. Una cuenta sin tiendas se prueba con un píxel suyo.
   */
  async function probarCuenta(cuenta: CuentasDeMeta["cuentas"][number]) {
    setOcupada(cuenta.id);
    try {
      const conPixel = cuenta.tiendas.filter((t) => t.pixelId);
      if (!conPixel.length) {
        if (cuenta.pixelParaProbar) {
          anotar(cuenta.id, await probarUnPixel(cuenta.id, cuenta.pixelParaProbar));
        }
        return;
      }
      const lineas: string[] = [];
      for (const t of conPixel) {
        lineas.push(`${t.nombre}: ${await probarUnPixel(cuenta.id, t.pixelId!)}`);
      }
      anotar(cuenta.id, lineas.join("\n"));
    } finally {
      setOcupada(null);
    }
  }

  if (fallo) {
    return (
      <p className="rounded-lg border border-borde bg-tarjeta px-4 py-3 text-sm text-tinta-suave">
        No se pudo leer cuántas cuentas hay conectadas. Recarga la página.
      </p>
    );
  }
  if (!datos) {
    return (
      <p className="rounded-lg border border-borde bg-tarjeta px-4 py-3 text-sm text-tinta-suave">
        Contando las cuentas conectadas…
      </p>
    );
  }

  if (!datos.cuentas.length) return null;

  return (
    <div className="mt-4 space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-neutral-950">Medición por negocio</h3>
        <p className="mt-1 text-xs text-neutral-600">
          Con qué permiso se le avisa a Meta de las compras de cada negocio, y una prueba
          con el píxel que usa de verdad cada tienda.
        </p>
      </div>

      {datos.cuentas.map((cuenta) => (
        <section
          key={cuenta.id}
          className="rounded-xl border border-borde bg-tarjeta shadow-sm"
        >
          <div className="border-b border-borde px-4 py-2.5">
            <h3 className="text-sm font-extrabold uppercase tracking-wide text-tinta">
              {cuenta.nombre}
            </h3>
          </div>
          {cuenta.tiendas.length ? (
            <div className="divide-y divide-borde">
              {cuenta.tiendas.map((t) => (
                <FilaDeTienda key={t.id} tienda={t} />
              ))}
            </div>
          ) : (
            <p className="px-4 py-2 text-xs text-tinta-suave">
              Ninguna tienda usa todavía un número de esta cuenta.
            </p>
          )}
          {/* CON QUÉ SE MIDEN SUS COMPRAS, y los dos botones para dejarlo bien. */}
          <div className="border-t border-borde px-4 py-2">
            <p
              className={`text-xs ${
                cuenta.medicion === "login" ? "font-bold text-amber-700" : "text-tinta"
              }`}
            >
              <strong>Sus compras se miden</strong> {MEDICION_DICE[cuenta.medicion]}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {cuenta.puedeGenerarPermanente && cuenta.medicion !== "permanente" ? (
                <button
                  type="button"
                  disabled={ocupada !== null}
                  onClick={() => void generarPermanente(cuenta.id)}
                  className="rounded-md border border-borde bg-tarjeta px-3 py-1.5 text-xs font-bold text-tinta hover:bg-relleno disabled:opacity-60"
                >
                  {ocupada === cuenta.id ? "Generando…" : "Generar permiso permanente"}
                </button>
              ) : null}
              {cuenta.tiendas.some((t) => t.pixelId) || cuenta.pixelParaProbar ? (
                <button
                  type="button"
                  disabled={ocupada !== null}
                  onClick={() => void probarCuenta(cuenta)}
                  className="rounded-md border border-borde bg-tarjeta px-3 py-1.5 text-xs font-bold text-tinta hover:bg-relleno disabled:opacity-60"
                >
                  {ocupada === cuenta.id
                    ? "Probando…"
                    : cuenta.tiendas.some((t) => t.pixelId)
                      ? "Probar cada tienda"
                      : "Probar medición"}
                </button>
              ) : null}
            </div>
            {resultados[cuenta.id] ? (
              <p className="mt-2 whitespace-pre-line text-xs text-tinta">
                {resultados[cuenta.id]}
              </p>
            ) : null}
          </div>
        </section>
      ))}

      {datos.cuentas.some((c) => c.pixelParaProbar || c.tiendas.some((t) => t.pixelId)) ? (
        <label className="block text-[11px] text-tinta-suave">
          Código de prueba de Meta (opcional, para «Probar cada tienda»). Lo sacas de
          Administrador de eventos → Probar eventos.
          <input
            value={codigoDePrueba}
            onChange={(e) => setCodigoDePrueba(e.target.value.trim())}
            placeholder="TEST12345"
            className="mt-1 block w-full max-w-xs rounded-md border border-borde bg-tarjeta px-2 py-1.5 font-mono text-xs text-tinta"
          />
        </label>
      ) : null}

    </div>
  );
}

/**
 * LA DIFERENCIACIÓN: DE QUÉ NEGOCIO ES CADA NÚMERO, PÁGINA Y PÍXEL, Y SUSCRIBIR NÚMEROS.
 *
 * LO PIDIÓ EL DUEÑO el 10/10/2026, y lo aprobó sobre un dibujo con sus datos reales antes
 * de construirlo: «ok me gusta». Él lo llama «la diferenciación».
 *
 * HACE DOS COSAS Y NADA MÁS: enseñar lo de cada negocio junto, con un icono por tipo, y
 * dejar suscribir cada número para que sus mensajes lleguen al bot. Elegir qué usa cada
 * tienda sigue en el editor, en Tiendas; medir compras, en la sección «7. Píxel».
 *
 * POR QUÉ ASÍ Y NO COMO ANTES. La versión anterior metía en cada tarjeta tiendas, «suyos»,
 * «compartidos», medición, botones y un selector «Ver cuenta». Él lo encontró «bien
 * enredado, no está nada intuitivo». Un bloque por negocio y una fila por cosa se entiende
 * sin leer instrucciones.
 *
 * «SUSCRIBIR» ES POR CUENTA DE WHATSAPP, no por número: Meta suscribe la cuenta entera.
 * Por eso, tras suscribir, se relee el estado de todos — dos números de la misma cuenta
 * pasan a «✓ Suscrito» a la vez, y así lo ve.
 */
function DiferenciacionPorNegocio() {
  const [datos, setDatos] = useState<CuentasDeMeta | null>(null);
  const [fallo, setFallo] = useState(false);
  /** true = suscrito, false = no, null = no se pudo saber. Sin clave = leyendo. */
  const [suscrito, setSuscrito] = useState<Record<string, boolean | null>>({});
  /** Ya se preguntó a Meta (bien o mal). Hasta entonces los botones esperan. */
  const [estadoLeido, setEstadoLeido] = useState(false);
  const [suscribiendo, setSuscribiendo] = useState<string | null>(null);
  /** Las OTRAS apps que atienden cada número (20/10/2026): con dos, contestan dos bots. */
  const [otrasApps, setOtrasApps] = useState<Record<string, string[]>>({});
  const [errores, setErrores] = useState<Record<string, string>>({});
  /** El negocio cuyo pop up está abierto. null = ninguno. */
  const [negocioAbierto, setNegocioAbierto] = useState<string | null>(null);
  /** La cuenta de Facebook cuyo pop up está abierto (su nombre, o «sin-cuenta»). */
  const [cuentaFbAbierta, setCuentaFbAbierta] = useState<string | null>(null);
  /** EL TOKEN DE CADA NÚMERO, a la vista (21/10/2026): «pensé que se vería en la sección
   *  "1 cuenta de Facebook · 4 negocios"… ahí se podría agregar los que no tienen token».
   *  Por id de número: true = token permanente; false = el del inicio de sesión. */
  const [tokenDe, setTokenDe] = useState<Record<string, boolean>>({});
  useEffect(() => {
    void fetch("/api/meta/connect/token-estado?ligero=1", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { numeros?: Array<{ id: string; permanente: boolean; enUso?: boolean }> } | null) =>
        // Solo los que usa este proyecto: de los que atiende otra app no hace falta el token.
        setTokenDe(Object.fromEntries((d?.numeros ?? []).filter((n) => n.permanente || n.enUso !== false).map((n) => [n.id, n.permanente])))
      )
      .catch(() => {});
  }, []);
  const etiquetaDeToken = (id: string) =>
    id in tokenDe ? (
      tokenDe[id] ? (
        <span className="ml-1.5 whitespace-nowrap text-xs font-semibold text-emerald-700">🔐 No caduca</span>
      ) : (
        <span className="ml-1.5 whitespace-nowrap text-xs font-semibold text-amber-700">⚠ Sin token permanente</span>
      )
    ) : null;
  // Escape cierra el pop up, y solo mientras está abierto: cerrado, la tecla sigue siendo
  // de quien la tenía. Es el mismo trato que las ventanas de las secciones numeradas.
  useEffect(() => {
    if (!negocioAbierto) return;
    const alPulsar = (evento: KeyboardEvent) => {
      if (evento.key !== "Escape") return;
      evento.preventDefault();
      setNegocioAbierto(null);
    };
    window.addEventListener("keydown", alPulsar);
    return () => window.removeEventListener("keydown", alPulsar);
  }, [negocioAbierto]);

  const leerSuscripciones = () =>
    fetch("/api/meta/connect/whatsapp/suscribir", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        setSuscrito(d?.estado ?? {});
        setOtrasApps(d?.otras ?? {});
      })
      .catch(() => setSuscrito({}))
      .finally(() => setEstadoLeido(true));

  useEffect(() => {
    void fetch("/api/meta/connect/cuentas", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: CuentasDeMeta) => setDatos(d))
      .catch(() => setFallo(true));
    void leerSuscripciones();
  }, []);

  async function suscribir(phoneNumberId: string) {
    const otras = otrasApps[phoneNumberId] ?? [];
    if (
      otras.length > 0 &&
      !window.confirm(
        `Este número ya lo atiende otra app: «${otras.join(", ")}». Si lo suscribes aquí, a cada cliente le contestarían DOS bots.\n\nQuítale primero la suscripción a la otra. ¿Seguir de todos modos?`
      )
    )
      return;
    setSuscribiendo(phoneNumberId);
    setErrores((e) => ({ ...e, [phoneNumberId]: "" }));
    try {
      const res = await fetch("/api/meta/connect/whatsapp/suscribir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumberId }),
      });
      const d = await res.json().catch(() => null);
      if (!d?.ok) {
        setErrores((e) => ({
          ...e,
          [phoneNumberId]: d?.mensaje ?? d?.error ?? "Meta no dejó suscribirlo.",
        }));
      }
      await leerSuscripciones();
    } catch {
      setErrores((e) => ({ ...e, [phoneNumberId]: "No se pudo hablar con el servidor." }));
    } finally {
      setSuscribiendo(null);
    }
  }

  if (fallo) {
    return (
      <p className="rounded-lg border border-borde bg-tarjeta px-4 py-3 text-sm text-tinta-suave">
        No se pudo leer lo que tienes conectado. Recarga la página.
      </p>
    );
  }
  if (!datos) {
    return (
      <p className="rounded-lg border border-borde bg-tarjeta px-4 py-3 text-sm text-tinta-suave">
        Leyendo lo que tienes conectado…
      </p>
    );
  }

  /**
   * LAS CARAS DE CADA COSA, como en las secciones de Páginas, WhatsApp y Píxel.
   *
   * Lo pidió el dueño el 10/10/2026: «que se presenten como se presentan en la sección
   * páginas, números, píxeles… que se vea la imagen de la página, del número y que el
   * píxel se represente como debe ser». El píxel es el CÍRCULO MORADO CON «◎» —el mismo de
   * la sección «7. Píxel» y de BOT FRANKO—, no el del tridente, que no le gusta.
   *
   * MÁS PEQUEÑAS QUE EN LAS SECCIONES, a propósito: él pidió que se distinga que esto es
   * otra cosa, las cuentas conectadas. Aquí van a h-9; en las secciones, a h-11 y h-12.
   *
   * La foto se pide fresca a `/api/meta/avatar` (los enlaces guardados caducan), y si no
   * carga, queda el círculo con la inicial: la fila nunca se queda coja.
   */
  const inicial = (texto: string) => (texto.replace(/[^\p{L}\p{N}]/gu, "")[0] ?? "?").toUpperCase();
  const caraDeNumero = (id: string, etiqueta: string) => (
    <AvatarDeOpcion
      foto={`/api/meta/avatar?wa=${encodeURIComponent(id)}`}
      inicial={inicial(etiqueta)}
      colorCirculo="bg-emerald-500"
    />
  );
  const caraDePagina = (id: string | undefined, etiqueta: string) => (
    <AvatarDeOpcion
      foto={id ? `/api/meta/avatar?page=${encodeURIComponent(id)}` : null}
      inicial={inicial(etiqueta)}
      colorCirculo="bg-sky-500"
    />
  );
  const caraDePixel = <AvatarDeOpcion inicial="◎" colorCirculo="bg-violet-500" />;

  /** Una fila: su cara, el nombre, y a la derecha lo que toque. */
  const fila = (clave: string, cara: ReactNode, nombre: ReactNode, derecha?: ReactNode) => (
    <div key={clave} className="flex min-h-11 items-center gap-3 px-4 py-1.5">
      {cara}
      <span className="min-w-0 flex-1 break-words text-sm text-tinta">{nombre}</span>
      {derecha}
    </div>
  );
  const vacio = (texto: string) => (
    <p className="px-4 py-2 text-sm text-tinta-suave">{texto}</p>
  );
  const compartido = (de: string) => (
    <span className="text-xs text-tinta-suave"> · compartido por {de}</span>
  );
  /** Lo de la derecha de un número: su estado de suscripción o el botón. */
  const estadoDelNumero = (id: string) => {
    const estado = suscrito[id];
    const otras = otrasApps[id] ?? [];
    const dosBots =
      otras.length > 0 ? (
        <span
          className="shrink-0 rounded-full bg-red-100 px-2 py-1 text-xs font-semibold text-red-800"
          title={`También lo atiende: ${otras.join(", ")}. Si además lo atiende este CRM, contestan dos bots.`}
        >
          ⚠ también otra app
        </span>
      ) : null;
    if (estado === true) {
      return (
        <span className="flex shrink-0 items-center gap-2">
          {dosBots}
          <span className="shrink-0 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800 oscuro:bg-emerald-500/20 oscuro:text-emerald-200">
            ✓ Suscrito
          </span>
        </span>
      );
    }
    return (
      <span className="flex shrink-0 items-center gap-2">
        {dosBots}
        {estado === null ? (
          <span className="text-xs text-tinta-suave" title="Meta no contestó al preguntar">
            estado desconocido
          </span>
        ) : null}
        <button
          type="button"
          disabled={suscribiendo !== null || !estadoLeido}
          onClick={() => void suscribir(id)}
          className="rounded-lg border border-blue-600 bg-tarjeta px-3 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-60 oscuro:text-blue-300"
        >
          {suscribiendo === id ? "Suscribiendo…" : "Suscribir"}
        </button>
      </span>
    );
  };
  const numero = (n: { id: string; etiqueta: string; detalle: string | null }, extra?: ReactNode) => (
    <div key={`n-${n.id}`}>
      {fila(
        n.id,
        caraDeNumero(n.id, n.detalle || n.etiqueta),
        <>
          {n.etiqueta}
          {n.detalle ? <span className="text-xs text-tinta-suave"> · {n.detalle}</span> : null}
          {extra}
          {etiquetaDeToken(n.id)}
        </>,
        estadoDelNumero(n.id)
      )}
      {errores[n.id] ? (
        <p className="pb-1.5 pl-16 pr-4 text-xs font-semibold text-red-700">
          ❌ {errores[n.id]}
        </p>
      ) : null}
    </div>
  );

  /** Los píxeles: los 4 primeros a la vista y el resto al pulsar. */
  const listaDePixeles = (cosas: Array<{ clave: string; nombre: ReactNode }>) => {
    if (!cosas.length) return vacio("Sin píxeles en este negocio");
    const primeros = cosas.slice(0, 4);
    const resto = cosas.slice(4);
    return (
      <>
        {primeros.map((c) => fila(c.clave, caraDePixel, c.nombre))}
        {resto.length ? (
          <details className="group">
            <summary className="cursor-pointer list-none py-1.5 pl-16 pr-4 text-sm text-blue-700 group-open:hidden oscuro:text-blue-300">
              Ver los otros {resto.length} píxeles ▾
            </summary>
            {resto.map((c) => fila(c.clave, caraDePixel, c.nombre))}
          </details>
        ) : null}
      </>
    );
  };

  const { sinIdentificar } = datos;
  const haySinIdentificar =
    sinIdentificar.numerosConId.length + sinIdentificar.paginas.length > 0;

  /**
   * LOS NEGOCIOS, BAJO SU CUENTA DE FACEBOOK.
   *
   * Lo pidió el dueño el 10/10/2026: «eso no se llaman cuentas entonces, realmente están
   * conectadas 2 cuentas de facebook… lo malo es que no indica a qué cuenta pertenece cada
   * negocio». Arriba va cuántas cuentas y cuántos negocios, cada uno con su palabra; y cada
   * negocio bajo la cuenta que lo trajo. La principal primero.
   */
  const grupos: Array<{ facebook: string | null; principal: boolean; cuentas: CuentasDeMeta["cuentas"] }> = [];
  for (const cuenta of datos.cuentas) {
    let grupo = grupos.find((g) => g.facebook === cuenta.facebookNombre);
    if (!grupo) {
      grupo = { facebook: cuenta.facebookNombre, principal: false, cuentas: [] };
      grupos.push(grupo);
    }
    grupo.cuentas.push(cuenta);
    if (cuenta.origen === "principal" && cuenta.facebookNombre) grupo.principal = true;
  }
  grupos.sort((a, b) =>
    a.principal !== b.principal
      ? a.principal
        ? -1
        : 1
      : !a.facebook !== !b.facebook
        ? a.facebook
          ? -1
          : 1
        : (a.facebook ?? "").localeCompare(b.facebook ?? "", "es", { sensitivity: "base" })
  );
  const plural = (n: number, uno: string, varios: string) => (n === 1 ? `1 ${uno}` : `${n} ${varios}`);

  /** La fila de un negocio, que abre su pop up. */
  const filaDeNegocio = (cuenta: CuentasDeMeta["cuentas"][number]) => {
            const cuantos = [
              plural(
                cuenta.numerosConId.length +
                  cuenta.compartidos.filter((c) => c.que === "número").length,
                "número",
                "números"
              ),
              plural(
                cuenta.paginasConId.length +
                  cuenta.compartidos.filter((c) => c.que === "página").length,
                "página",
                "páginas"
              ),
              plural(
                cuenta.pixels.length + cuenta.compartidos.filter((c) => c.que === "píxel").length,
                "píxel",
                "píxeles"
              ),
            ].join(" · ");
            // Cuántos de SUS números siguen sin token permanente: se ve sin abrir el negocio.
            const sinToken = cuenta.numerosConId.filter((n) => tokenDe[n.id] === false).length;
            const conToken = cuenta.numerosConId.filter((n) => tokenDe[n.id] === true).length;
            return (
              <button
                key={cuenta.id}
                type="button"
                onClick={() => setNegocioAbierto(cuenta.id)}
                className="flex w-full items-center gap-3 rounded-xl border border-borde bg-tarjeta px-4 py-2.5 text-left shadow-sm hover:bg-relleno"
              >
                <AvatarDeOpcion
                  inicial={inicial(cuenta.nombre)}
                  colorCirculo="bg-slate-600"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold text-tinta">
                    {cuenta.nombre}
                  </span>
                  <span className="block truncate text-xs text-tinta-suave">{cuantos}</span>
                </span>
                {sinToken > 0 ? (
                  <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800">
                    ⚠ {sinToken === 1 ? "1 sin token" : `${sinToken} sin token`}
                  </span>
                ) : conToken > 0 ? (
                  <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">🔐 Con token</span>
                ) : null}
                <span className="shrink-0 rounded-full bg-relleno px-3 py-1 text-xs font-bold text-tinta-suave">
                  Abrir
                </span>
              </button>
            );
  };

  return (
    <div className="space-y-3">
      {/* TUS CUENTAS DE FACEBOOK, UNA FILA POR CUENTA (21/10/2026): «dice 1 cuenta · 4 negocios pero
          no dice qué cuenta; si agrego otra se apilarían de manera rara». Y: «acabo de conectar una
          segunda cuenta pero no aparece». Cada cuenta que inició sesión tiene SIEMPRE su fila:
          con sus negocios; o «comparte N negocios con…» si sus BM ya están bajo otra; o, si no
          tiene páginas ni números, qué hacer. Cada fila abre su pop up. */}
      {(() => {
        const conectadas = datos.conectadas ?? [];
        type FilaDeCuenta = {
          clave: string;
          nombre: string | null;
          principal: boolean;
          negocios: CuentasDeMeta["cuentas"];
          comparteCon: string[];
        };
        const filas: FilaDeCuenta[] = grupos.map((g) => ({
          clave: g.facebook ?? "sin-cuenta",
          nombre: g.facebook,
          principal: g.principal,
          negocios: g.cuentas,
          comparteCon: [],
        }));
        for (const c of conectadas) {
          if (!c.nombre || filas.some((f) => f.nombre === c.nombre)) continue;
          const compartidos = datos.cuentas.filter((n) => c.negocios.includes(n.id));
          filas.push({
            clave: `conectada:${c.nombre}`,
            nombre: c.nombre,
            principal: c.origen === "principal",
            negocios: compartidos,
            comparteCon: [...new Set(compartidos.map((n) => n.facebookNombre).filter((x): x is string => !!x && x !== c.nombre))],
          });
        }
        const abierta = filas.find((f) => f.clave === cuentaFbAbierta);
        return (
          <>
            <p className="text-center font-titulo text-xl font-extrabold text-tinta">
              {filas.length ? "Tus cuentas de Facebook" : "Ningún negocio identificado todavía"}
            </p>
            {filas.map((f) => {
              const sinToken = f.negocios.reduce((s, c) => s + c.numerosConId.filter((n) => tokenDe[n.id] === false).length, 0);
              const vacia = f.negocios.length === 0;
              return (
                <div key={f.clave} className="rounded-xl border border-borde bg-tarjeta shadow-sm">
                  <button
                    type="button"
                    disabled={vacia}
                    onClick={() => setCuentaFbAbierta(f.clave)}
                    className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left hover:bg-relleno disabled:cursor-default disabled:hover:bg-transparent"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-black/5">
                      <img src="/facebook-logo.png" alt="" className="h-7 w-7" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold text-tinta">{f.nombre ?? "Cuenta de Facebook sin apuntar"}</span>
                      <span className="block truncate text-xs text-tinta-suave">
                        {f.nombre ? (f.principal ? "Cuenta principal · " : "Anexada · ") : ""}
                        {vacia
                          ? "sin páginas ni números"
                          : f.comparteCon.length
                            ? `comparte ${plural(f.negocios.length, "negocio", "negocios")} con ${f.comparteCon.join(", ")}`
                            : plural(f.negocios.length, "negocio", "negocios")}
                      </span>
                    </span>
                    {sinToken > 0 ? (
                      <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800">
                        ⚠ {sinToken === 1 ? "1 sin token" : `${sinToken} sin token`}
                      </span>
                    ) : null}
                    {!vacia && <span className="shrink-0 rounded-full bg-relleno px-3 py-1 text-xs font-bold text-tinta-suave">Abrir</span>}
                  </button>
                  {/* SIN PÁGINAS NI NÚMEROS (21/10/2026): «Regresa a tu cuenta de Facebook "nombre" y
                      agrega páginas a tu negocio para empezar a usarlas». Los BM vacíos no se listan. */}
                  {vacia && (
                    <div className="space-y-2 border-t border-borde px-4 py-3 text-[13px] text-tinta">
                      <p className="font-semibold">Todavía no tienes páginas ni números.</p>
                      <p className="text-tinta-suave">
                        Entra a tu cuenta de Facebook <b>«{f.nombre ?? "tu cuenta"}»</b> y agrega una página a tu negocio para empezar a usarla.
                      </p>
                      <button
                        type="button"
                        onClick={() => window.dispatchEvent(new CustomEvent("meta-connect:asistente", { detail: "numeros" }))}
                        className="inline-flex items-center rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-sky-700"
                      >
                        📱 Agregar un número
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

            {/* EL POP UP DE UNA CUENTA DE FACEBOOK: sus negocios, cada uno una fila que abre el suyo. */}
            {abierta ? (
              <div
                className="fixed inset-0 z-50 overflow-y-auto bg-black/45 p-4"
                role="dialog"
                aria-modal="true"
                aria-label={abierta.nombre ?? "Cuenta de Facebook"}
                onClick={(e) => {
                  if (e.target === e.currentTarget) setCuentaFbAbierta(null);
                }}
              >
                <div className="flex min-h-full items-start justify-center">
                  <div className="my-8 w-full max-w-2xl overflow-hidden rounded-xl border border-borde bg-tarjeta shadow-2xl">
                    <div className="flex items-center justify-between gap-3 border-b border-borde px-5 py-3">
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-extrabold uppercase tracking-wide text-tinta">
                          {abierta.nombre ?? "Cuenta de Facebook sin apuntar"}
                        </h3>
                        <p className="text-xs text-tinta-suave">
                          {abierta.principal ? "Cuenta principal" : abierta.nombre ? "Cuenta anexada" : ""} · {plural(abierta.negocios.length, "negocio", "negocios")}
                          {abierta.comparteCon.length ? ` · compartidos con ${abierta.comparteCon.join(", ")}` : ""}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setCuentaFbAbierta(null)}
                        className="shrink-0 rounded-md border border-borde bg-tarjeta px-4 py-1.5 text-xs font-bold text-tinta hover:bg-relleno"
                      >
                        Cerrar
                      </button>
                    </div>
                    <div className="space-y-1.5 p-4">{abierta.negocios.map((cuenta) => filaDeNegocio(cuenta))}</div>
                  </div>
                </div>
              </div>
            ) : null}
          </>
        );
      })()}


      {/* EL POP UP DEL NEGOCIO ABIERTO: sus números (con «Suscribir»), sus páginas y sus
          píxeles, cada uno con su cara. Se cierra con Cerrar, con Escape o al pulsar el
          fondo. */}
      {(() => {
        const cuenta = datos.cuentas.find((c) => c.id === negocioAbierto);
        if (!cuenta) return null;
        const compartidos = (que: "número" | "página" | "píxel") =>
          cuenta.compartidos.filter((c) => c.que === que);
        const numerosCompartidos = compartidos("número");
        const paginas = [
          ...cuenta.paginasConId.map((p) => ({
            clave: `p-${p.id}`,
            id: p.id as string | undefined,
            etiqueta: p.etiqueta,
            nombre: (
              <>
                {p.etiqueta}
                {p.detectada ? (
                  <span className="text-xs text-tinta-suave"> · detectada, sin elegir</span>
                ) : null}
              </>
            ) as ReactNode,
          })),
          ...compartidos("página").map((c, i) => ({
            clave: `pc-${c.id ?? i}`,
            id: c.id,
            etiqueta: c.nombre,
            nombre: (
              <>
                {c.nombre}
                {compartido(c.de)}
              </>
            ) as ReactNode,
          })),
        ];
        const pixeles = [
          ...cuenta.pixels.map((p, i) => ({ clave: `x-${i}`, nombre: p as ReactNode })),
          ...compartidos("píxel").map((c, i) => ({
            clave: `xc-${i}`,
            nombre: (
              <>
                {c.nombre}
                {compartido(c.de)}
              </>
            ) as ReactNode,
          })),
        ];
        const titulo = (texto: string) => (
          <p className="px-4 pb-1 pt-3 text-[11px] font-bold uppercase tracking-wide text-tinta-suave">
            {texto}
          </p>
        );
        return (
          <div
            className="fixed inset-0 z-50 overflow-y-auto bg-black/45 p-4"
            role="dialog"
            aria-modal="true"
            aria-label={cuenta.nombre}
            onClick={(e) => {
              if (e.target === e.currentTarget) setNegocioAbierto(null);
            }}
          >
            <div className="flex min-h-full items-start justify-center">
              <div className="my-8 w-full max-w-2xl overflow-hidden rounded-xl border border-borde bg-tarjeta shadow-2xl">
                <div className="flex items-center justify-between gap-3 border-b border-borde px-5 py-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-extrabold uppercase tracking-wide text-tinta">
                      {cuenta.nombre}
                    </h3>
                    {(() => {
                      // QUIÉN LO ADMINISTRA (21/10/2026): con dos cuentas en los mismos BM, se dice.
                      const admins = [
                        ...new Set(
                          [cuenta.facebookNombre, ...(datos.conectadas ?? []).filter((c) => c.negocios.includes(cuenta.id)).map((c) => c.nombre)].filter(
                            (x): x is string => !!x
                          )
                        ),
                      ];
                      return admins.length ? (
                        <p className="text-xs text-tinta-suave">
                          {admins.length > 1 ? `Lo administran: ${admins.join(", ")}` : `Cuenta de Facebook: ${admins[0]}`}
                        </p>
                      ) : null;
                    })()}
                  </div>
                  {/* EL TOKEN, DONDE ESTÁ EL PROBLEMA (21/10/2026): el token es del BM, así que se crea
                      desde aquí, con el asistente ya en este BM. */}
                  {cuenta.numerosConId.some((n) => tokenDe[n.id] === false) ? (
                    <button
                      type="button"
                      onClick={() => {
                        setNegocioAbierto(null);
                        setCuentaFbAbierta(null);
                        window.dispatchEvent(new CustomEvent("meta-connect:asistente", { detail: { paso: "token", bm: cuenta.id } }));
                      }}
                      className="shrink-0 rounded-md bg-sky-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-sky-700"
                    >
                      🔐 Crear token de este BM
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setNegocioAbierto(null)}
                    className="shrink-0 rounded-md border border-borde bg-tarjeta px-4 py-1.5 text-xs font-bold text-tinta hover:bg-relleno"
                  >
                    Cerrar
                  </button>
                </div>
                <div className="pb-3">
                  {titulo("Números de WhatsApp")}
                  {cuenta.numerosConId.length || numerosCompartidos.length ? (
                    <>
                      {cuenta.numerosConId.map((n) => numero(n))}
                      {numerosCompartidos.map((c) =>
                        c.id
                          ? numero({ id: c.id, etiqueta: c.nombre, detalle: null }, compartido(c.de))
                          : null
                      )}
                    </>
                  ) : (
                    vacio("Sin números en este negocio")
                  )}
                  {titulo("Páginas de Facebook")}
                  {paginas.length
                    ? paginas.map((p) => fila(p.clave, caraDePagina(p.id, p.etiqueta), p.nombre))
                    : vacio("Sin páginas en este negocio")}
                  {titulo("Píxeles")}
                  {listaDePixeles(pixeles)}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* LO QUE AÚN NO SE SABE DE QUÉ NEGOCIO ES, con el botón al lado: no dejarlo como un
          misterio. */}
      {haySinIdentificar ? (
        <section className="overflow-hidden rounded-xl border border-dashed border-amber-400 bg-amber-50 oscuro:bg-amber-500/10">
          <h3 className="border-b border-amber-300 px-4 py-2.5 text-sm font-extrabold uppercase tracking-wide text-tinta">
            Sin negocio identificado
          </h3>
          <div className="space-y-2 px-4 py-2.5 text-xs text-tinta">
            <p>
              Todavía no se sabe de qué negocio es esto. Pulsa una vez{" "}
              <strong>«Actualizar lista de Meta»</strong> con tu cuenta de siempre y se
              ordenará solo.
            </p>
            <a
              href="/api/meta/connect/start"
              className="inline-block rounded-md border border-amber-400 bg-tarjeta px-3 py-1.5 font-bold hover:bg-relleno"
            >
              Actualizar lista de Meta
            </a>
          </div>
          <div className="border-t border-amber-300 bg-tarjeta py-1.5">
            {sinIdentificar.numerosConId.map((n) => numero(n))}
            {sinIdentificar.paginas.map((p, i) => fila(`sp-${i}`, caraDePagina(undefined, p), p))}
          </div>
        </section>
      ) : null}

      {/* CONECTAR OTRA CUENTA DE FACEBOOK, por la misma app. Solo hace falta si los
          números de esa cuenta no salen ya aquí arriba. Y solo con una ya conectada: «otra» sin
          ninguna no tiene sentido (21/10/2026). */}
      {datos.total > 0 || (datos.conectadas ?? []).length > 0 ? (
      <div className="rounded-xl border border-borde bg-tarjeta p-4 text-center">
        <a
          href="/api/meta/connect/start?nueva=1"
          className="inline-block rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700"
        >
          {/* «Parece cuenta de app; me confundí» (21/10/2026): dice qué cuenta es. */}
          + Conectar otra cuenta de Facebook
        </a>
        <p className="mx-auto mt-2 max-w-xl text-xs text-tinta-suave">
          Para agregar otra cuenta de Facebook usando tu misma app. Solo hace falta si sus
          números no salen ya aquí arriba. Antes, cierra sesión de Facebook en este navegador
          (o usa una ventana privada) y entra con esa cuenta. No cambia nada de lo que ya
          tienes.
        </p>
      </div>
      ) : null}
    </div>
  );
}

const NOMBRE_DEL_ORIGEN: Record<string, string> = {
  conexion: "el token de la conexión con Meta",
  variable: "la variable de entorno",
  manual: "un token pegado a mano",
};

/**
 * UNA SECCIÓN DE META CONNECT, COMO FILA QUE ABRE UNA VENTANA.
 *
 * EL PROBLEMA QUE RESUELVE. Esta pantalla tenía once secciones abiertas, una
 * debajo de otra, con listas de páginas y bloques de variables dentro. Para
 * llegar a la última había que pasar por las diez anteriores, y ninguna se
 * toca más de una vez al mes.
 *
 * Ahora son once filas numeradas en el orden en que se hacen las cosas, y cada
 * una se abre en su ventana.
 *
 * EL NÚMERO NO ES ADORNO: esta pantalla se recorre UNA vez, de arriba abajo, el
 * día que se conecta. Sin el número, once filas parecen once opciones sueltas.
 *
 * NO SE CIERRA AL TOCAR FUERA, por lo mismo que en el editor: dentro se pegan
 * tokens largos y se seleccionan textos, y soltar el ratón un píxel fuera
 * cerraba la ventana. Se sale con Escape o con Cerrar.
 */
function SeccionEnVentana({
  paso,
  titulo,
  detalle,
  icono,
  tono,
  children,
  oculta = false,
  orden,
}: {
  /** Modo esencial: esta sección no se dibuja. Su contenido no se toca. */
  oculta?: boolean;
  /** Modo esencial: su lugar en la columna. Sin orden, el de siempre. */
  orden?: number;
  paso: number;
  titulo: string;
  detalle: string;
  icono: string;
  /** El color del cuadrado. Uno por sección, para que se reconozcan de lejos —
   *  con el mismo color en las diez, el cuadrado deja de distinguir nada. */
  tono: string;
  children: ReactNode;
}) {
  const [abierto, setAbierto] = useState(false);
  // EL ASISTENTE LA ABRE (21/10/2026): «¿Qué deseas hacer? → Elegir página o píxel» abre esta
  // ventana directamente, por su título.
  useEffect(() => {
    const alPedir = (e: Event) => {
      if ((e as CustomEvent<string>).detail === titulo) setAbierto(true);
    };
    window.addEventListener("meta-connect:abrir", alPedir);
    return () => window.removeEventListener("meta-connect:abrir", alPedir);
  }, [titulo]);
  useEffect(() => {
    if (!abierto) return;
    const alPulsar = (evento: KeyboardEvent) => {
      if (evento.key !== "Escape") return;
      evento.preventDefault();
      setAbierto(false);
    };
    window.addEventListener("keydown", alPulsar);
    return () => window.removeEventListener("keydown", alPulsar);
  }, [abierto]);
  // Oculta en el modo esencial. Es lo mismo que una sección cerrada: lo de dentro solo se
  // dibuja con la ventana abierta, así que no se pierde ni se deja de cargar nada.
  if (oculta) return null;
  return (
    <>
      {/* LA MISMA FILA QUE EN EL EDITOR: cuadrado de color con su dibujo,
          título con la letra de titular, frase debajo y la chapa de Abrir. El
          cuadrado va primero y grande a propósito — es la guía que el ojo busca
          antes de leer nada, así que dos filas se distinguen sin leerlas. */}
      <button
        type="button"
        onClick={() => setAbierto(true)}
        style={orden === undefined ? undefined : { order: orden }}
        className="group flex w-full items-center gap-4 rounded-2xl border border-borde bg-tarjeta px-5 py-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
      >
        <span
          aria-hidden
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-xl shadow-sm ${tono}`}
        >
          {icono}
        </span>
        <span className="min-w-0 flex-1">
          <span className="font-titulo block text-base font-extrabold tracking-tight text-tinta">
            {paso}. {titulo}
          </span>
          <span className="mt-0.5 block text-xs leading-snug text-tinta-suave">
            {detalle}
          </span>
        </span>
        <span className="shrink-0 rounded-full bg-relleno px-3 py-1.5 text-xs font-bold text-tinta-suave">
          Abrir
        </span>
      </button>
      {abierto ? (
        <div
          className="fixed inset-0 z-50 overflow-y-auto bg-black/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={titulo}
        >
          <div className="flex min-h-full items-start justify-center">
            <div className="my-8 w-full max-w-3xl rounded-xl border border-neutral-300 bg-tarjeta shadow-2xl">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 px-5 py-3">
                <h3 className="text-sm font-bold uppercase tracking-wide text-neutral-900">
                  {paso}. {titulo}
                </h3>
                <div className="flex items-center gap-2">
                  <span className="hidden text-[11px] text-neutral-500 sm:inline">
                    Escape = cerrar
                  </span>
                  <button
                    type="button"
                    onClick={() => setAbierto(false)}
                    className="rounded-md border border-neutral-300 bg-tarjeta px-4 py-1.5 text-xs font-bold text-neutral-700 hover:bg-neutral-100"
                  >
                    Cerrar
                  </button>
                </div>
              </div>
              {/* Lo de dentro es la sección tal cual estaba. No se reescribe:
                  solo cambia dónde se dibuja. */}
              <div className="p-4">{children}</div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

/**
 * EL SET DE VENTA: LOS TRES QUE HACEN FALTA PARA REGISTRAR UNA COMPRA.
 *
 * EL PROBLEMA QUE RESUELVE. Esta pantalla tiene ocho secciones y cada una dice
 * si LO SUYO está bien: la página por su lado, el número por el suyo, el píxel
 * por el suyo. Ninguna decía si el CONJUNTO sirve.
 *
 * Y hay un caso que ninguna de las tres puede ver sola: el píxel elegido está
 * bien, el número está bien, y aun así las compras no se registran porque ese
 * píxel no está vinculado a esa cuenta de WhatsApp. Meta acepta la elección sin
 * quejarse y rechaza los eventos después. El fallo aparece tarde y no se parece
 * a su causa.
 *
 * DOS COLORES, Y YA NO MIRAN LA WABA — reescrito el 3 de octubre de 2026.
 *
 *   ROJO      falta alguno de los tres. Ni siquiera se puede empezar.
 *   VERDE     están los tres. Las compras se registran.
 *
 * QUÉ DECÍA ANTES, Y POR QUÉ DEJÓ DE SER VERDAD. Había un tercer color, NARANJA:
 * están los tres pero el píxel no es el que esta cuenta de WhatsApp tiene
 * asociado. Era verdad mientras el bot mandaba el identificador de la WABA en el
 * evento, porque entonces Meta validaba ese vínculo y RECHAZABA la venta si no
 * existía (subcode 2804132).
 *
 * El bot dejó de mandar ese dato ese mismo día —ver `src/lib/meta/conversions.ts`,
 * donde está escrito el porqué con la documentación de Meta— así que Meta ya no
 * tiene nada que validar por ese lado y el vínculo dejó de hacer falta.
 *
 * LO QUE EL AVISO NARANJA LE HACÍA HACER, Y ES LO GRAVE. No solo asustaba: le
 * decía «elige un píxel vinculado a la WABA o crea uno». Siguiendo ese consejo
 * habría abandonado un píxel que funciona perfectamente, por un requisito que ya
 * no existe. Un aviso obsoleto que manda actuar es peor que no tener aviso.
 *
 * EL DATO SE QUEDA, PERO COMO NOTA. Cuando esta cuenta de WhatsApp tiene asociado
 * otro conjunto de datos, se dice en el verde —y se dice que ya no hace falta que
 * coincidan—. Él lo va a ver en Meta y la pregunta le va a venir sola.
 *
 * Y SE QUEDAN LA CONSULTA A META Y EL BOTÓN «Ver el de esta cuenta»: funcionan y
 * sirven para mirarlo. Lo único que se les quitó es decidir el color.
 */
/** Agrupa una lista por su BM, en orden alfabético; lo que no tiene BM, al final. */
function porNegocio<T>(lista: T[], negocioDe: (x: T) => string | null | undefined): Array<{ nombre: string; items: T[] }> {
  const SIN = "BM sin identificar";
  const grupos = new Map<string, T[]>();
  for (const x of lista) {
    const nombre = negocioDe(x)?.trim() || SIN;
    grupos.set(nombre, [...(grupos.get(nombre) ?? []), x]);
  }
  return [...grupos.entries()]
    .sort(([a], [b]) => (a === SIN ? 1 : b === SIN ? -1 : a.localeCompare(b, "es", { sensitivity: "base" })))
    .map(([nombre, items]) => ({ nombre, items }));
}

/**
 * EL SET DE VENTA, UNA FILA POR TIENDA (21/10/2026). Cada tienda vende con su número, su página y
 * su píxel; la campaña de cada una tiene que usar esos mismos. Con IDs, para compararlos. Sin
 * tiendas se muestra el general (`general`). Ver `/api/meta/connect/set-de-venta`.
 */
type PiezaDelSet = { id: string; nombre: string | null; general?: boolean } | null;
function SetsDeVentaPorTienda({ general }: { general: ReactNode }) {
  const [tiendas, setTiendas] = useState<Array<{
    id: string;
    nombre: string;
    color: string | null;
    numero: PiezaDelSet;
    pagina: PiezaDelSet;
    pixel: PiezaDelSet;
  }> | null>(null);
  /** La tienda cuyo pop up está abierto. */
  const [abierta, setAbierta] = useState<string | null>(null);
  useEffect(() => {
    void fetch("/api/meta/connect/set-de-venta", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setTiendas(d.tiendas ?? []))
      .catch(() => setTiendas([]));
  }, []);
  if (!tiendas) return null;
  if (!tiendas.length) return <>{general}</>;
  // (`abierta` se declara arriba: los hooks no pueden ir después de un return.)

  const pieza = (titulo: string, p: PiezaDelSet) => (
    <div className="min-w-0 rounded-md border border-neutral-200 bg-tarjeta px-3 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
        {p ? "✔" : "✖"} {titulo}
        {p?.general ? <span className="ml-1 normal-case text-neutral-400">(el general)</span> : null}
      </p>
      <p className={`mt-0.5 break-words text-xs ${p ? "text-neutral-800" : "font-semibold text-red-700"}`}>
        {p ? `${p.nombre ?? "Sin nombre"} · ${p.id}` : "Sin elegir"}
      </p>
    </div>
  );

  return (
    <section className="rounded-lg border-2 border-neutral-200 bg-tarjeta p-4 shadow-sm">
      <p className="text-xs font-bold uppercase tracking-wide text-neutral-500">Set de venta por tienda</p>
      <p className="mt-1 text-sm text-neutral-700">
        Cada compra se registra con la página y el píxel de su tienda. Tu campaña tiene que usar <b>estos mismos</b>.
      </p>
      {/* UNA FILA POR TIENDA (21/10/2026): «en Meta Connect necesito una forma ordenada… y los sets
          también otro pop up». La fila dice si está completa; el detalle, en su pop up, con el
          enlace a la tienda en el editor. */}
      <div className="mt-3 space-y-1.5">
        {tiendas.map((t) => {
          const completa = !!(t.numero && t.pagina && t.pixel);
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setAbierta(t.id)}
              className="flex w-full items-center gap-3 rounded-xl border border-borde bg-tarjeta px-4 py-2.5 text-left shadow-sm hover:bg-relleno"
            >
              <span className="inline-block h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: t.color || "#14b8a6" }} />
              <span className="min-w-0 flex-1 truncate text-sm font-bold text-neutral-900">{t.nombre}</span>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${completa ? "bg-emerald-50 text-emerald-700" : "bg-amber-100 text-amber-800"}`}>
                {completa ? "✅ Completo" : `⚠ Falta ${[!t.pagina && "la página", !t.numero && "el número", !t.pixel && "el píxel"].filter(Boolean).join(", ")}`}
              </span>
              <span className="shrink-0 rounded-full bg-relleno px-3 py-1 text-xs font-bold text-tinta-suave">Ver</span>
            </button>
          );
        })}
      </div>

      {(() => {
        const t = tiendas.find((x) => x.id === abierta);
        if (!t) return null;
        return (
          <div
            className="fixed inset-0 z-50 overflow-y-auto bg-black/45 p-4"
            role="dialog"
            aria-modal="true"
            aria-label={t.nombre}
            onClick={(e) => {
              if (e.target === e.currentTarget) setAbierta(null);
            }}
          >
            <div className="flex min-h-full items-start justify-center">
              <div className="my-8 w-full max-w-2xl overflow-hidden rounded-xl border border-borde bg-tarjeta shadow-2xl">
                <div className="flex items-center justify-between gap-3 border-b border-borde px-5 py-3">
                  <h3 className="flex min-w-0 items-center gap-2 truncate text-sm font-extrabold uppercase tracking-wide text-tinta">
                    <span className="inline-block h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: t.color || "#14b8a6" }} />
                    {t.nombre}
                  </h3>
                  <button
                    type="button"
                    onClick={() => setAbierta(null)}
                    className="shrink-0 rounded-md border border-borde bg-tarjeta px-4 py-1.5 text-xs font-bold text-tinta hover:bg-relleno"
                  >
                    Cerrar
                  </button>
                </div>
                <div className="space-y-3 p-5">
                  <p className="text-sm text-neutral-700">
                    La campaña de esta tienda tiene que usar <b>esta misma página</b> y <b>este mismo píxel</b>, y anunciar <b>este número</b>.
                  </p>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {pieza("Página de Facebook", t.pagina)}
                    {pieza("Número de WhatsApp", t.numero)}
                    {pieza("Píxel", t.pixel)}
                  </div>
                  <a
                    href="/editor?tab=ajustes"
                    className="inline-flex items-center rounded-lg border border-borde bg-tarjeta px-4 py-2 text-sm font-semibold text-tinta hover:bg-relleno"
                  >
                    Ir a la tienda en el editor ↗
                  </a>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </section>
  );
}

/**
 * EL REGISTRO DE META CONNECT (21/10/2026): los últimos fallos de Meta con su texto exacto, para
 * copiarlos y pasárselos a soporte sin entrar a EasyPanel. Plegado y discreto: la pantalla no
 * asusta a nadie. Ver `lib/meta/registro.ts`.
 */
function RegistroDeMeta() {
  const [fallos, setFallos] = useState<Array<{ cuando: number; donde: string; texto: string }> | null>(null);
  const [copiado, setCopiado] = useState(false);
  const leer = () =>
    void fetch("/api/meta/connect/registro", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setFallos(d.fallos ?? []))
      .catch(() => setFallos([]));
  useEffect(() => {
    leer();
  }, []);
  if (!fallos?.length) return null;
  const texto = fallos
    .map((f) => `${new Date(f.cuando).toLocaleString("es")} — ${f.donde}: ${f.texto}`)
    .join("\n");
  return (
    <details className="mt-6 rounded-lg border border-neutral-200 bg-tarjeta px-4 py-2 text-xs text-neutral-600">
      <summary className="cursor-pointer select-none font-semibold text-neutral-500">
        📋 Registro de Meta Connect ({fallos.length})
      </summary>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          className="rounded-md border border-neutral-300 px-3 py-1 font-semibold text-neutral-700 hover:bg-neutral-50"
          onClick={() => {
            void navigator.clipboard?.writeText(texto);
            setCopiado(true);
            window.setTimeout(() => setCopiado(false), 1800);
          }}
        >
          {copiado ? "✓ Copiado" : "Copiar todo"}
        </button>
        <button type="button" className="rounded-md border border-neutral-300 px-3 py-1 text-neutral-600 hover:bg-neutral-50" onClick={leer}>
          ↻ Actualizar
        </button>
      </div>
      <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-neutral-50 p-2 font-mono text-[11px] leading-5">{texto}</pre>
    </details>
  );
}

/**
 * EL ESTADO DE LA CONEXIÓN, COMO TITULAR (21/10/2026). «¿Cómo sé si ya se conectó una app?… y cómo
 * lo desconecto?». Su ejemplo: arriba, «APP CONECTADA» y el nombre en grande, con el logo a la
 * derecha en un cuadro blanco con sombra. Debajo, igual pero más chico, Facebook. Cada uno con
 * su botón del momento; los botones abren el paso del asistente que toca.
 */
function EstadoDeConexion({ status }: { status: MetaStatus | null }) {
  if (!status) return null;
  const app = Boolean(status.appId);
  const fb = Boolean(status.appId && status.conectadoConFacebook);
  const abrir = (paso: string) => window.dispatchEvent(new CustomEvent("meta-connect:asistente", { detail: paso }));
  // Botones de tamaño normal, no chicos (21/10/2026: «los botones están un poco pequeños»).
  const boton = "inline-flex items-center rounded-lg px-4 py-2 text-sm font-semibold shadow-sm transition";
  const fila = (o: {
    logo: string;
    grande: boolean;
    apagado: boolean;
    rotulo: string;
    titulo: string;
    detalle?: string | null;
    acciones: ReactNode;
  }) => (
    <div className="flex items-center justify-center gap-5">
      <div className="min-w-0 text-center">
        <p className={`font-extrabold uppercase tracking-[0.12em] ${o.grande ? "text-sm" : "text-xs"} ${o.apagado ? "text-tinta-suave" : "text-tinta"}`}>
          {o.rotulo}
        </p>
        <p className={`font-titulo font-extrabold leading-tight tracking-tight ${o.grande ? "text-3xl sm:text-4xl" : "text-xl sm:text-2xl"} ${o.apagado ? "text-tinta-suave" : "text-tinta"}`}>
          {o.titulo}
        </p>
        {o.detalle ? <p className="mt-0.5 text-xs text-tinta-suave">{o.detalle}</p> : null}
        <div className="mt-2 flex flex-wrap justify-center gap-2">{o.acciones}</div>
      </div>
      <span
        className={`flex shrink-0 items-center justify-center rounded-2xl bg-white shadow-md ring-1 ring-black/5 ${o.grande ? "h-20 w-20 p-2" : "h-14 w-14 p-2"} ${o.apagado ? "opacity-60 grayscale" : ""}`}
      >
        <img src={o.logo} alt="" className="h-full w-full object-contain" />
      </span>
    </div>
  );

  // DOS RECUADROS SEPARADOS (21/10/2026): «Facebook aparece amarrado en el mismo cajón; debería
  // ser independiente: app conectada arriba y Facebook separado más abajo».
  const recuadro = "rounded-2xl border border-borde bg-tarjeta px-4 py-5 shadow-sm";
  return (
    <div className="mt-6 space-y-4">
      <div className={recuadro}>
      {fila({
        logo: "/meta-app-logo.png",
        grande: true,
        apagado: !app,
        rotulo: app ? "App conectada" : "Sin app conectada",
        titulo: app ? status.appName ?? status.appId ?? "" : "Conecta tu app para empezar",
        detalle: app ? `ID ${status.appId}` : null,
        acciones: app ? (
          <>
            <button type="button" onClick={() => abrir("app")} className={`${boton} border border-borde bg-tarjeta text-tinta-suave hover:bg-relleno`}>
              Cambiar app
            </button>
            <button type="button" onClick={() => abrir("cerrar")} className={`${boton} border border-red-200 bg-tarjeta text-red-700 hover:bg-red-50`}>
              Desconectar
            </button>
          </>
        ) : (
          <button type="button" onClick={() => abrir("app")} className={`${boton} bg-sky-600 text-white hover:bg-sky-700`}>
            🔑 Conectar mi app
          </button>
        ),
      })}
      </div>
      <div className={recuadro}>
      {fila({
        logo: "/facebook-logo.png",
        grande: false,
        apagado: !fb,
        rotulo: fb ? "Facebook conectado" : "Facebook sin conectar",
        titulo: fb ? status.cuentaDeFacebook ?? "Tu cuenta de Facebook" : app ? "Inicia sesión para ver tus números y páginas" : "Primero conecta tu app",
        detalle: fb ? `${status.whatsAppConnections.length} número(s) · ${status.connections.length + status.detectedPages.length} página(s)` : null,
        acciones: fb ? (
          <button type="button" onClick={() => abrir("inicio")} className={`${boton} bg-sky-600 text-white hover:bg-sky-700`}>
            Abrir asistente
          </button>
        ) : app ? (
          <a href="/api/meta/connect/start" className={`${boton} bg-[#1877f2] text-white hover:opacity-90`}>
            Conectar con Facebook
          </a>
        ) : null,
      })}
      </div>
    </div>
  );
}

function SetDeVenta({
  pagina,
  whatsapp,
  pixelId,
  pixels,
  datasetDeLaWaba,
}: {
  pagina: { pageName: string; pageId: string } | null;
  whatsapp: {
    verifiedName: string | null;
    displayPhoneNumber: string | null;
    wabaId: string;
  } | null;
  pixelId: string;
  pixels: Array<{ pixelId: string; name: string | null }>;
  /** null = todavía no se ha podido preguntar a Meta. Ver su declaración. */
  datasetDeLaWaba: { id: string | null } | null;
}) {
  const faltan: string[] = [];
  if (!pagina) faltan.push("la página de Facebook");
  if (!whatsapp) faltan.push("el número de WhatsApp");
  if (!pixelId) faltan.push("el píxel");

  // EL VÍNCULO CON LA WABA YA NO DECIDE NADA. Se sigue calculando porque el verde
  // lo enseña como nota —él lo va a ver en Meta y va a preguntar—, pero no puede
  // volver a pintar un aviso: ver la explicación de arriba.
  const sinComprobar = datasetDeLaWaba === null;
  const vinculado = Boolean(
    datasetDeLaWaba?.id && pixelId && datasetDeLaWaba.id === pixelId
  );
  /** La cuenta tiene asociado OTRO conjunto de datos. Ya no es un problema. */
  const laWabaTieneOtro = Boolean(
    !sinComprobar && datasetDeLaWaba?.id && !vinculado
  );

  const estado: "rojo" | "verde" = faltan.length > 0 ? "rojo" : "verde";

  const MARCO = {
    verde: "border-emerald-400 bg-emerald-50",
    rojo: "border-red-400 bg-red-50",
  }[estado];
  const TINTA = {
    verde: "text-emerald-900",
    rojo: "text-red-900",
  }[estado];
  // NO PROMETE LO QUE NO SABE (20/10/2026): «¿cómo sabe que no estoy eligiendo el píxel
  // equivocado? No he creado ninguna campaña». Con los tres elegidos solo se sabe que el bot
  // mandará la compra; que haga match depende de que la CAMPAÑA use estos mismos. Se le muestran,
  // con sus IDs, para que los compare.
  const TITULAR = {
    verde: "✅ Los tres elegidos — ¿tu campaña usa estos mismos?",
    rojo: "⛔ Todavía no se pueden registrar ventas",
  }[estado];

  const nombreDelPixel =
    pixels.find((p) => p.pixelId === pixelId)?.name ?? null;

  const filas: [string, string, boolean][] = [
    [
      "Página de Facebook",
      pagina ? `${pagina.pageName} · ${pagina.pageId}` : "Sin elegir",
      Boolean(pagina),
    ],
    [
      "Número de WhatsApp",
      whatsapp
        ? [whatsapp.displayPhoneNumber, whatsapp.verifiedName].filter(Boolean).join(" · ") || whatsapp.wabaId
        : "Sin elegir",
      Boolean(whatsapp),
    ],
    [
      "Píxel",
      pixelId ? `${nombreDelPixel ?? "Sin nombre"} · ${pixelId}` : "Sin elegir",
      Boolean(pixelId),
    ],
  ];

  return (
    <section className={`rounded-lg border-2 p-4 shadow-sm ${MARCO}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {/* EL NOMBRE CORTO. Es el juego de tres piezas con el que trabaja el
              bot; «set» porque van juntas o no sirve ninguna. */}
          <p className="text-xs font-bold uppercase tracking-wide text-neutral-500">
            Set de venta
          </p>
          <p className={`mt-1 text-base font-bold ${TINTA}`}>{TITULAR}</p>
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {filas.map(([titulo, valor, ok]) => (
          <div
            key={titulo}
            className="rounded-md border border-neutral-200 bg-tarjeta px-3 py-2"
          >
            <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
              {ok ? "✔" : "✖"} {titulo}
            </p>
            <p
              className={`mt-0.5 break-words text-xs ${
                ok ? "text-neutral-800" : "font-semibold text-red-700"
              }`}
            >
              {valor}
            </p>
          </div>
        ))}
      </div>

      {/* EL AVISO, CON LO QUE HAY QUE HACER DENTRO. Un aviso que dice qué está
          mal y no dice qué hacer obliga a buscar dónde se arregla. */}
      {estado === "rojo" ? (
        <p className="mt-3 rounded border border-red-300 bg-tarjeta px-3 py-2 text-xs font-semibold text-red-800">
          Falta {faltan.join(", ")}. Sin los tres, el bot vende pero la compra no
          le llega a Meta y los anuncios no aprenden de ella.
        </p>
      ) : null}
      {estado === "verde" ? (
        <p className="mt-3 rounded border border-emerald-300 bg-tarjeta px-3 py-2 text-xs text-emerald-900">
          El bot mandará cada compra a Meta con estos tres. Para que <b>hagan match</b>, tu campaña tiene que usar
          <b> esta misma página</b> y <b>este mismo píxel</b>, y anunciar <b>este número</b>: compáralos con tu
          administrador de anuncios. Si la campaña usa otros, las compras no se registrarán en ella.
          {/* LA NOTA, Y NO ES UNA ALARMA. Él va a ver en Meta que su cuenta de
              WhatsApp tiene asociado otro conjunto de datos y va a preguntar si
              eso le rompe algo. Se le contesta aquí, antes de que lo busque. */}
          {laWabaTieneOtro ? (
            <>
              {" "}
              Esta cuenta de WhatsApp tiene asociado otro conjunto de datos (
              <strong>{datasetDeLaWaba?.id}</strong>), y da igual: ya no hace
              falta que coincidan.
            </>
          ) : null}
        </p>
      ) : null}
    </section>
  );
}

/**
 * LOS TOKENS GUARDADOS, EN CLARO Y A PETICIÓN.
 *
 * EL PROBLEMA QUE RESUELVE. La pantalla solo recibía un sí o un no: «hay un
 * token guardado». El valor no salía del servidor por ningún sitio, así que el
 * token que hace falta en otras herramientas no había forma de sacarlo del
 * panel. Tocaba ir a Meta a generar otro, y cada token nuevo es uno más que
 * caduca por su cuenta y que hay que acordarse de renovar.
 *
 * NO VIAJA AL CARGAR. Se pide al servidor solo al tocar «Ver», y se olvida al
 * ocultar. Es el mismo trato que ya tenían el token de la página y los de
 * lectura de Ads: el estado de la pantalla no lleva secretos dentro.
 *
 * CADA UNO CON SU COPIAR, que es lo que de verdad se hace con un token: nadie
 * lo teclea a mano.
 */
function CredencialesGuardadas() {
  const [abierto, setAbierto] = useState(false);
  const [datos, setDatos] = useState<Record<string, string | null> | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiado, setCopiado] = useState<string | null>(null);

  const ver = async () => {
    setCargando(true);
    setError(null);
    try {
      const res = await fetch("/api/meta/connect/credenciales", {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("No se pudieron leer las credenciales.");
      setDatos(await res.json());
      setAbierto(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron leer.");
    } finally {
      setCargando(false);
    }
  };

  const copiar = async (clave: string, valor: string) => {
    await navigator.clipboard.writeText(valor);
    setCopiado(clave);
    window.setTimeout(() => setCopiado(null), 1800);
  };

  // EL ORDEN ES EL DE LA FALTA QUE HACEN, no el del archivo: el de WhatsApp
  // primero, que es el que se pide en todas partes.
  const FILAS: [string, string, string][] = [
    ["whatsAppAccessToken", "Token de WhatsApp", "Con este se envían los mensajes"],
    [
      "whatsAppTokenPermanente",
      "Token permanente pegado a mano",
      "Si está puesto, manda sobre el de arriba",
    ],
    ["phoneNumberId", "Phone Number ID", "El número por el que sale el bot"],
    ["wabaId", "WABA ID", "La cuenta de WhatsApp Business"],
    ["appId", "App ID", "Identifica tu app de Meta"],
    ["appSecret", "Clave de la app", "Con ella se firman los webhooks"],
    [
      "tokenDeLaConexion",
      "Token de la conexión",
      "El del «Conectar con Meta». Es tuyo, no del número",
    ],
    ["capiAccessToken", "Token de CAPI", "Para los eventos de conversión"],
  ];

  return (
    <div className="mt-4 border-t border-neutral-200 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-neutral-900">
            Tokens guardados
          </p>
          <p className="text-xs text-neutral-500">
            Lo que hay guardado ahora mismo, para copiarlo donde haga falta.
          </p>
        </div>
        <button
          type="button"
          onClick={() => (abierto ? (setAbierto(false), setDatos(null)) : void ver())}
          disabled={cargando}
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-60"
        >
          {cargando ? "Leyendo..." : abierto ? "Ocultar tokens" : "Ver tokens"}
        </button>
      </div>
      {error ? (
        <p className="mt-2 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800">
          {error}
        </p>
      ) : null}
      {abierto && datos ? (
        <div className="mt-3 space-y-2">
          {/* SE AVISA DE LO QUE SON. No es un cartel de miedo: es que con el de
              WhatsApp cualquiera puede escribir a tus clientes en tu nombre, y
              eso hay que saberlo antes de pegarlo en un chat o una captura. */}
          <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Con el token de WhatsApp se pueden enviar mensajes a tu nombre y leer
            tus conversaciones. No lo pegues en capturas ni en chats.
          </p>
          {FILAS.map(([clave, titulo, detalle]) => {
            const valor = datos[clave];
            return (
              <div
                key={clave}
                className="rounded border border-neutral-200 px-3 py-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-neutral-800">
                      {titulo}
                    </p>
                    <p className="text-[11px] text-neutral-500">{detalle}</p>
                  </div>
                  {valor ? (
                    <button
                      type="button"
                      onClick={() => void copiar(clave, valor)}
                      className="rounded border border-neutral-300 px-2 py-1 text-[11px] font-medium text-neutral-700 hover:bg-neutral-50"
                    >
                      {copiado === clave ? "Copiado" : "Copiar"}
                    </button>
                  ) : null}
                </div>
                {/* EN UN CAMPO, NO EN UN PÁRRAFO: un token largo hay que poder
                    seleccionarlo entero, y en un párrafo se parte en renglones
                    y al copiar a mano se cuelan espacios. */}
                <input
                  readOnly
                  value={valor ?? ""}
                  placeholder="No hay ninguno guardado"
                  onFocus={(e) => e.currentTarget.select()}
                  className="mt-1 w-full rounded border border-neutral-200 bg-neutral-50 px-2 py-1 font-mono text-[11px] text-neutral-800"
                />
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/** El mismo recuerdo que el editor: si se elige el modo esencial en uno, el otro también
 *  lo está. Ver `modoEsencial` en `editor/page.tsx`. */
const MODO_STORAGE_KEY = "wf:editor-modo";

export default function MetaConnectPage() {
  /**
   * MODO ESENCIAL Y MODO PROFESIONAL, TAMBIÉN AQUÍ.
   *
   * LO PIDIÓ EL DUEÑO el 10/10/2026: «en meta connect también debe haber su modo usuario y
   * modo experto… a los novatos no les importa las variables manuales, ni las variables
   * detectadas». Y que «Configuración automática» vaya DESPUÉS de elegir la página: «al
   * estar 2 no tiene sentido, no se puede presionar ahí nada sin seleccionar página».
   *
   * SOLO CAMBIA LO QUE SE VE: oculta cuatro secciones y reordena las demás. El contenido de
   * cada sección y todo lo que hace quedan iguales. En el profesional, todo como siempre.
   */
  const [modoEsencial, setModoEsencial] = useState(false);
  useEffect(() => {
    try {
      setModoEsencial(localStorage.getItem(MODO_STORAGE_KEY) === "esencial");
    } catch {
      // Sin localStorage se entra al profesional, que es el de siempre.
    }
  }, []);
  /**
   * LO DE LA ÉPOCA MANUAL, SOLO SI FALLA (21/10/2026): «Datos exactos para Meta», «Variables
   * detectadas» y «Variables manuales» eran para pegar direcciones, IDs y tokens a mano. Con el
   * asistente no hacen falta, así que no se muestran. Él: «si falla, que diga activar ocultos, pero
   * solo cuando falle la conexión». Falla = los mensajes de WhatsApp de la app no le llegan a este
   * proyecto (lo dice Meta). Entonces sale un aviso con el botón que los muestra.
   */
  const [conexionFallo, setConexionFallo] = useState(false);
  const [verAvanzado, setVerAvanzado] = useState(false);
  /**
   * EL LUGAR DE CADA SECCIÓN EN EL MODO ESENCIAL: su número y su orden en la columna.
   * null = oculta. En el profesional no se usa: cada una lleva su número de siempre.
   *
   *   1 Conexión lista para iniciar        → 1
   *   2 Configuración automática           → 3  (después de la página)
   *   3 Cuentas de lectura de Ads          → oculta
   *   4 Páginas de Facebook                → 2
   *   5 Instagram                          → oculta
   *   6 Cuentas de WhatsApp                → 4
   *   7 Píxel                              → 5
   *   8 Datos exactos para Meta            → 6  (el webhook: hace falta)
   *   9 Variables detectadas               → oculta
   *  10 Variables manuales                 → oculta
   */
  const LUGAR_EN_EL_ESENCIAL: Record<number, number | null> = {
    1: 1, 2: 3, 3: null, 4: 2, 5: null, 6: 4, 7: 5, 8: 6, 9: null, 10: null,
  };
  /** Lo que recibe cada `SeccionEnVentana` según el modo. */
  const lugar = (pasoDeSiempre: number) => {
    if (!modoEsencial) return { paso: pasoDeSiempre };
    const nuevo = LUGAR_EN_EL_ESENCIAL[pasoDeSiempre];
    return nuevo === null || nuevo === undefined
      ? { paso: pasoDeSiempre, oculta: true }
      : { paso: nuevo, orden: nuevo };
  };
  const [status, setStatus] = useState<MetaStatus | null>(null);
  const [busyPageId, setBusyPageId] = useState<string | null>(null);
  const [configuring, setConfiguring] = useState(false);
  const [configuringWhatsApp, setConfiguringWhatsApp] = useState(false);
  const [configuringInstagram, setConfiguringInstagram] = useState(false);
  const [configureResult, setConfigureResult] =
    useState<ConfigureResult | null>(null);
  const [whatsAppConfigureResult, setWhatsAppConfigureResult] =
    useState<ConfigureResult | null>(null);
  const [instagramConfigureResult, setInstagramConfigureResult] =
    useState<ConfigureResult | null>(null);
  const [pageMessage, setPageMessage] = useState<string | null>(null);
  // Pinta el aviso en ROJO cuando algo falló al activar la página.
  const [pageMessageError, setPageMessageError] = useState(false);
  const [showTokens, setShowTokens] = useState(false);
  // Cuál se está MIRANDO, que no es lo mismo que cuál está activa. El
  // desplegable navega; activar sigue siendo el botón de la tarjeta. Si elegir
  // aquí activara, un clic distraído cambiaría la página del bot en producción.
  // Se muestra la tarjeta de la ACTIVA. "Ver todas" despliega el resto, que es
  // desde donde se quitan cuentas o se miran sus tokens.
  const [verTodasPaginas, setVerTodasPaginas] = useState(false);
  const [verTodosNumeros, setVerTodosNumeros] = useState(false);
  // La foto de perfil de cada número de WhatsApp. La página expone la suya en
  // una URL pública, pero el número no: hay que pedirla a la API.
  const [avataresWhatsApp, setAvataresWhatsApp] = useState<
    Record<string, string>
  >({});

  useEffect(() => {
    let cancelado = false;
    void (async () => {
      try {
        const res = await fetch("/api/meta/connect/whatsapp/avatares", {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelado) setAvataresWhatsApp(data.avatares ?? {});
      } catch {
        // Sin fotos el selector se ve igual, con el círculo de la inicial.
      }
    })();
    return () => {
      cancelado = true;
    };
  }, []);
  const [pixels, setPixels] = useState<
    Array<{
      pixelId: string;
      name: string | null;
      businessName: string | null;
      compartido: boolean;
      businessId?: string;
      /** Las cuentas que pueden usarlo (dueña + compartidas). */
      accesoDe?: Array<{ id: string; nombre: string | null }>;
    }>
  >([]);
  const [pixelElegido, setPixelElegido] = useState("");
  const [pixelEnUso, setPixelEnUso] = useState<string | null>(null);
  const [pixelDesdeVariable, setPixelDesdeVariable] = useState(false);
  const [guardandoPixel, setGuardandoPixel] = useState(false);
  const [capi, setCapi] = useState<{
    origenElegido: string | null;
    origenEnUso: string | null;
    hayToken: boolean;
    hayManual: boolean;
    hayVariable: boolean;
  } | null>(null);
  const [capiTokenManual, setCapiTokenManual] = useState("");
  const [guardandoCapi, setGuardandoCapi] = useState(false);
  const [probandoCapi, setProbandoCapi] = useState(false);
  const [resultadoCapi, setResultadoCapi] = useState<string | null>(null);
  const [codigoDePrueba, setCodigoDePrueba] = useState("");
  const [appInfo, setAppInfo] = useState<{
    appId?: string;
    nombre?: string | null;
    negocio?: string | null;
    avisoNegocio?: string | null;
  } | null>(null);

  useEffect(() => {
    let cancelado = false;
    void (async () => {
      try {
        const res = await fetch("/api/meta/connect/app", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelado && data.configurada) setAppInfo(data);
      } catch {
        // Sin este dato el botón sigue funcionando igual.
      }
    })();
    return () => {
      cancelado = true;
    };
  }, []);

  const [configurandoApp, setConfigurandoApp] = useState(false);
  const [resultadoConfig, setResultadoConfig] = useState<string | null>(null);
  const [uriDeRedireccion, setUriDeRedireccion] = useState<string | null>(null);
  const [datosBasicos, setDatosBasicos] = useState<{
    dominio: string;
    sitioWeb: string;
    politicaDePrivacidad: string;
  } | null>(null);
  const [confirmarConfig, setConfirmarConfig] = useState(false);

  async function verConfigDeApp() {
    setResultadoConfig(null);
    try {
      const res = await fetch("/api/meta/connect/configurar-app", {
        cache: "no-store",
      });
      const data = await res.json();
      if (!data.ok) {
        setResultadoConfig(`❌ ${data.error}`);
        return;
      }
      const filas = (data.suscripciones ?? []).map(
        (s: { objeto: string; url: string; activa: boolean }) =>
          `· ${s.objeto}: ${s.url || "(sin URL)"}${s.activa ? "" : " (inactiva)"}`
      );
      const propuestas = (data.urlsPropuestas ?? [])
        .map((p: { objeto: string; url: string }) => `\n- ${p.objeto}: ${p.url}`)
        .join("");
      setResultadoConfig(
        `Webhooks que tiene la app ahora:\n${
          filas.length ? filas.join("\n") : "· ninguno"
        }\n\nSe le pondría: ${propuestas}`
      );
    } catch {
      setResultadoConfig("❌ No se pudo consultar a Meta.");
    }
  }

  async function configurarApp() {
    setConfirmarConfig(false);
    setConfigurandoApp(true);
    setResultadoConfig(null);
    try {
      const res = await fetch("/api/meta/connect/configurar-app", {
        method: "POST",
      });
      const data = await res.json();
      if (data.error) {
        setResultadoConfig(`❌ ${data.error}`);
        return;
      }
      const filas = (data.pasos ?? []).map(
        (p: { paso: string; ok: boolean; detalle: string }) =>
          `${p.ok ? "✅" : "❌"} ${p.paso}: ${p.detalle}`
      );
      setUriDeRedireccion(data.uriDeRedireccion ?? null);
      setDatosBasicos(data.datosBasicos ?? null);
      setResultadoConfig(filas.join("\n"));
    } catch {
      setResultadoConfig("❌ No se pudo consultar a Meta.");
    } finally {
      setConfigurandoApp(false);
    }
  }

  const [generandoPermanente, setGenerandoPermanente] = useState(false);
  const [resultadoPermanente, setResultadoPermanente] = useState<string | null>(
    null
  );

  async function generarTokenPermanente() {
    setGenerandoPermanente(true);
    setResultadoPermanente(null);
    try {
      const res = await fetch("/api/meta/connect/token-permanente", {
        method: "POST",
      });
      const data = await res.json();
      if (data.ok) {
        setResultadoPermanente(
          `✅ Listo. Se generó un token permanente en «${data.negocio}» y ya quedó guardado, tanto para WhatsApp como para el reporte de compras. No vence.` +
            (data.permisos?.length
              ? `\n\nCon estos ${data.permisos.length} permisos:\n· ${data.permisos.join("\n· ")}`
              : "")
        );
        await cargarCapi();
        return;
      }
      // Primero QUÉ HACER, y el volcado de Meta después: leer veinte rechazos
      // no le dice a nadie qué le falta.
      const sugerencia = data.sugerencia
        ? `⚠ ${data.sugerencia.quePasa}\n\n👉 ${data.sugerencia.queHacer}\n\n`
        : "";
      setResultadoPermanente(
        `❌ ${data.error}\n\n${sugerencia}${
          data.intentos?.length
            ? `Lo que respondió Meta, uno por uno:\n· ${data.intentos.join("\n· ")}`
            : ""
        }`
      );
    } catch {
      setResultadoPermanente("❌ No se pudo consultar a Meta.");
    } finally {
      setGenerandoPermanente(false);
    }
  }

  const cargarCapi = async () => {
    try {
      const res = await fetch("/api/meta/connect/capi", { cache: "no-store" });
      if (res.ok) setCapi(await res.json());
    } catch {
      // Si no se puede leer, la sección se oculta y no estorba.
    }
  };

  useEffect(() => {
    void cargarCapi();
  }, []);

  async function guardarOrigenCapi(origen: string) {
    setGuardandoCapi(true);
    setResultadoCapi(null);
    try {
      const res = await fetch("/api/meta/connect/capi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ origen, token: capiTokenManual }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        alert(data.error ?? "No se pudo guardar.");
        return;
      }
      setCapiTokenManual("");
      setCapi(data);
    } finally {
      setGuardandoCapi(false);
    }
  }

  async function probarCapi() {
    setProbandoCapi(true);
    setResultadoCapi(null);
    try {
      const res = await fetch("/api/meta/connect/capi", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codigoDePrueba }),
      });
      const data = await res.json();
      if (!data.ok) {
        setResultadoCapi(`❌ No funciona: ${data.error}`);
        return;
      }
      const verDataset = `✅ Ve tu dataset «${data.pixelNombre ?? data.pixelId}»${
        data.negocio ? ` del negocio ${data.negocio}` : ""
      }, usando ${NOMBRE_DEL_ORIGEN[data.origen] ?? "el token disponible"}.`;
      const mandarEvento = !data.envio
        ? " Para la prueba definitiva, pega tu código de prueba y vuelve a darle."
        : data.envio.ok
          ? " ✅ Y la prueba definitiva pasó: Meta ACEPTÓ una compra de prueba. Míralo en Administrador de eventos → Probar eventos."
          : ` ❌ Pero Meta RECHAZÓ la compra de prueba: ${data.envio.detalle}`;
      setResultadoCapi(verDataset + mandarEvento);
    } catch {
      setResultadoCapi("❌ No se pudo consultar a Meta.");
    } finally {
      setProbandoCapi(false);
    }
  }

  useEffect(() => {
    let cancelado = false;
    void (async () => {
      try {
        const res = await fetch("/api/meta/connect/pixel", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelado) return;
        setPixels(data.pixels ?? []);
        setPixelElegido(data.elegido ?? "");
        setPixelEnUso(data.enUso ?? null);
        setPixelDesdeVariable(data.desdeVariable === true);
      } catch {
        // Si no se puede leer, la sección queda vacía y no estorba.
      }
    })();
    return () => {
      cancelado = true;
    };
  }, []);

  async function guardarPixel(pixelId: string) {
    setGuardandoPixel(true);
    try {
      const res = await fetch("/api/meta/connect/pixel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pixelId }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        alert(data.error ?? "No se pudo guardar el pixel.");
        return;
      }
      setPixelElegido(data.elegido ?? "");
      setPixelEnUso(data.enUso ?? null);
      setPixelDesdeVariable(false);
    } finally {
      setGuardandoPixel(false);
    }
  }

  // El conjunto de datos de la propia WABA. Elegir un pixel cualquiera del
  // desplegable puede dejar las compras sin registrar: si ese pixel no esta
  // vinculado a la cuenta de WhatsApp, Meta acepta la eleccion pero rechaza
  // los eventos. Este lo pide a Meta, que lo devuelve ya vinculado.
  const [datasetWaba, setDatasetWaba] = useState<{
    datasetId: string | null;
    nombreWaba: string | null;
  } | null>(null);
  /**
   * EL VÍNCULO ENTRE EL PÍXEL ELEGIDO Y LA CUENTA DE WHATSAPP.
   *
   * Se pregunta SOLO al abrir la pantalla y sin tocar nada: es el mismo GET
   * que usa el botón de abajo, que solo mira y no crea.
   *
   * Hace falta aquí porque es lo único que no se puede deducir de lo guardado:
   * si el píxel elegido es el de esta WABA lo sabe Meta, no el panel.
   *
   * `null` no es «no hay»: es «todavía no se ha podido preguntar». Se
   * distinguen a propósito — dar por roto algo que no se ha comprobado manda a
   * arreglar lo que no está mal.
   */
  const [datasetDeLaWaba, setDatasetDeLaWaba] = useState<
    { id: string | null } | null
  >(null);
  const [mirandoDataset, setMirandoDataset] = useState(false);
  const [creandoDataset, setCreandoDataset] = useState(false);
  const [confirmarDataset, setConfirmarDataset] = useState(false);
  const [resultadoDataset, setResultadoDataset] = useState<string | null>(null);

  // Se pregunta al abrir, en silencio y sin crear nada. Si Meta no contesta se
  // deja en `null`, que la tarjeta lee como «no se pudo comprobar» — y eso no
  // es lo mismo que «está mal».
  useEffect(() => {
    let cancelado = false;
    void (async () => {
      try {
        const res = await fetch("/api/meta/connect/dataset-waba", {
          cache: "no-store",
        });
        const data = await res.json();
        if (cancelado || data?.ok === false) return;
        setDatasetDeLaWaba({ id: data.datasetId ?? null });
      } catch {
        /* sin conexión con Meta: la tarjeta lo dice, no lo inventa */
      }
    })();
    return () => {
      cancelado = true;
    };
  }, []);

  async function verDatasetWaba() {
    setMirandoDataset(true);
    setResultadoDataset(null);
    setConfirmarDataset(false);
    try {
      const res = await fetch("/api/meta/connect/dataset-waba", {
        cache: "no-store",
      });
      const data = await res.json();
      if (data.ok === false) {
        setResultadoDataset(`❌ ${data.error}`);
        return;
      }
      setDatasetWaba({
        datasetId: data.datasetId ?? null,
        nombreWaba: data.nombreWaba ?? null,
      });
      // La tarjeta de arriba lee de aquí: mirar sin actualizarla la dejaría
      // diciendo lo de hace un minuto.
      setDatasetDeLaWaba({ id: data.datasetId ?? null });
      setResultadoDataset(
        data.datasetId
          ? `Esta cuenta de WhatsApp YA tiene conjunto de datos: ${data.datasetId}. Al continuar no se crea nada nuevo, solo queda elegido.`
          : "Esta cuenta de WhatsApp todavía no tiene conjunto de datos. Al continuar se creará uno, ya vinculado."
      );
      setConfirmarDataset(true);
    } catch {
      setResultadoDataset("❌ No se pudo consultar a Meta.");
    } finally {
      setMirandoDataset(false);
    }
  }

  async function crearDatasetWaba() {
    setConfirmarDataset(false);
    setCreandoDataset(true);
    try {
      const res = await fetch("/api/meta/connect/dataset-waba", {
        method: "POST",
      });
      const data = await res.json();
      if (data.ok === false) {
        setResultadoDataset(`❌ ${data.error}`);
        return;
      }
      setResultadoDataset(
        data.yaExistia
          ? `✅ Ya existía y quedó elegido: ${data.datasetId}. No se creó ninguno nuevo.`
          : `✅ Creado y elegido: ${data.datasetId}. Nace vinculado a tu cuenta de WhatsApp.`
      );
      // Acaba de quedar vinculado: la tarjeta de arriba tiene que ponerse verde
      // ahora, no en la próxima recarga.
      setDatasetDeLaWaba({ id: data.datasetId ?? null });
      // Se relee la lista: el nuevo se acaba de sumar al desplegable.
      try {
        const rp = await fetch("/api/meta/connect/pixel", { cache: "no-store" });
        const dp = await rp.json();
        setPixels(dp.pixels ?? []);
        setPixelElegido(dp.elegido ?? "");
        setPixelEnUso(dp.enUso ?? null);
        setPixelDesdeVariable(dp.desdeVariable === true);
      } catch {
        // La elección ya quedó guardada en el servidor; esto es solo refresco.
      }
    } catch {
      setResultadoDataset("❌ No se pudo consultar a Meta.");
    } finally {
      setCreandoDataset(false);
    }
  }
  const [copied, setCopied] = useState<string | null>(null);
  const [readers, setReaders] = useState<
    Array<{ id: number; name: string; updated_at: number }>
  >([]);
  // La papelera: las cuentas quitadas, con su token todavía guardado.
  const [papelera, setPapelera] = useState<
    Array<{ id: number; name: string; updated_at: number; deleted_at?: number | null }>
  >([]);
  // La última que se quitó, para ofrecer "Deshacer" ahí mismo sin buscarla.
  const [ultimaQuitada, setUltimaQuitada] = useState<{
    id: number;
    name: string;
  } | null>(null);
  const [readerName, setReaderName] = useState("");
  const [readerToken, setReaderToken] = useState("");
  const [editingReaderId, setEditingReaderId] = useState<number | null>(null);
  const [editingReaderName, setEditingReaderName] = useState("");
  const [editingReaderToken, setEditingReaderToken] = useState("");
  const [revealedReaderToken, setRevealedReaderToken] = useState<{
    id: number;
    token: string;
  } | null>(null);
  const [revealedPageToken, setRevealedPageToken] = useState<{
    pageId: string;
    token: string;
  } | null>(null);
  const [savingApp, setSavingApp] = useState(false);
  const [editingAppCredentials, setEditingAppCredentials] = useState(false);
  const [appConfig, setAppConfig] = useState({
    appId: "",
    appSecret: "",
    instagramAppSecret: "",
    whatsAppAccessToken: "",
  });
  const [busyWhatsAppId, setBusyWhatsAppId] = useState<string | null>(null);
  const [changingWhatsAppMode, setChangingWhatsAppMode] = useState(false);
  const [busyInstagramPageId, setBusyInstagramPageId] = useState<string | null>(null);
  const [removingConnectionId, setRemovingConnectionId] = useState<string | null>(null);
  const [resettingMessengerSecret, setResettingMessengerSecret] = useState(false);

  // ¿Quedó lista la conexión? Solo con una app puesta; sin app no hay nada que haya fallado.
  useEffect(() => {
    if (!status?.appId) {
      setConexionFallo(false);
      return;
    }
    void fetch("/api/meta/connect/configurar-app?revisar=1", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { ok?: boolean; lista?: boolean | null }) => setConexionFallo(d.ok === true && d.lista === false))
      .catch(() => {});
  }, [status?.appId]);

  async function loadStatus() {
    const res = await fetch("/api/meta/connect/status", { cache: "no-store" });
    setStatus(await res.json());
  }
  // Al cerrar el asistente (conectó la app, agregó un número…), el encabezado se pone al día.
  useEffect(() => {
    const alCambiar = () => void loadStatus().catch(() => {});
    window.addEventListener("meta-connect:cambio", alCambiar);
    return () => window.removeEventListener("meta-connect:cambio", alCambiar);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pausarNumeroDelProyecto(phoneNumberId: string, pausado: boolean, nombre: string) {
    if (
      pausado &&
      !window.confirm(
        `¿Pausar ${nombre} en este proyecto?\n\nEste bot dejará de contestar por ese número. Úsalo cuando OTRO proyecto lo atiende, para que no contesten dos bots.\n\nNo cambia nada en Meta y lo reanudas con un clic.`
      )
    )
      return;
    setBusyWhatsAppId(phoneNumberId);
    try {
      const res = await fetch("/api/meta/connect/whatsapp/pausar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumberId, pausado }),
      });
      if (!res.ok) alert("No se pudo cambiar.");
      await loadStatus();
    } finally {
      setBusyWhatsAppId(null);
    }
  }

  async function loadReaders() {
    const res = await fetch("/api/meta/ads-readers", { cache: "no-store" });
    const data = await res.json();
    aplicarListas(data);
  }

  /** Las dos listas llegan juntas en cada respuesta: se aplican juntas. */
  function aplicarListas(data: unknown): void {
    const d = (data ?? {}) as {
      readers?: typeof readers;
      papelera?: typeof papelera;
    };
    setReaders(d.readers ?? []);
    setPapelera(d.papelera ?? []);
  }

  /** Quitar = mandar a la papelera. Pregunta antes, y deja el "Deshacer". */
  async function quitarReader(reader: { id: number; name: string }) {
    const confirmado = window.confirm(
      `Vas a quitar «${reader.name}».\n\n` +
        "Va a la papelera con su token: podrás restaurarla desde ahí mismo. " +
        "Mientras tanto deja de aparecer en los selectores de cuenta.\n\n" +
        "¿Continuar?"
    );
    if (!confirmado) return;
    const res = await fetch(`/api/meta/ads-readers?id=${reader.id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      alert("No se pudo quitar la cuenta.");
      return;
    }
    if (revealedReaderToken?.id === reader.id) setRevealedReaderToken(null);
    if (editingReaderId === reader.id) setEditingReaderId(null);
    aplicarListas(await res.json());
    setUltimaQuitada({ id: reader.id, name: reader.name });
  }

  async function restaurarReader(id: number) {
    const res = await fetch("/api/meta/ads-readers/trash", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error ?? "No se pudo restaurar la cuenta.");
      return;
    }
    aplicarListas(data);
    if (ultimaQuitada?.id === id) setUltimaQuitada(null);
  }

  /** El borrado de verdad. Se avisa que el token no vuelve. */
  async function borrarReaderDefinitivo(reader: { id: number; name: string }) {
    const confirmado = window.confirm(
      `Vas a borrar «${reader.name}» DEFINITIVAMENTE, con su token.\n\n` +
        "Esto no se puede deshacer: para volver a usarla habría que pedirle " +
        "un token nuevo a Meta.\n\n" +
        "¿Seguro?"
    );
    if (!confirmado) return;
    const res = await fetch(`/api/meta/ads-readers/trash?id=${reader.id}`, {
      method: "DELETE",
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error ?? "No se pudo borrar la cuenta.");
      return;
    }
    aplicarListas(data);
    if (ultimaQuitada?.id === reader.id) setUltimaQuitada(null);
    if (revealedReaderToken?.id === reader.id) setRevealedReaderToken(null);
  }

  async function saveReader() {
    const res = await fetch("/api/meta/ads-readers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: readerName, token: readerToken }),
    });
    if (!res.ok) {
      // El motivo lo pone el servidor: el nombre ya no es obligatorio, así que
      // "completa nombre y token" seria mentira la mayoria de las veces.
      const data = await res.json().catch(() => null);
      alert(data?.error ?? "No se pudo guardar el token.");
      return;
    }
    setReaderName("");
    setReaderToken("");
    await loadReaders();
  }

  function startEditingReader(reader: { id: number; name: string }) {
    setEditingReaderId(reader.id);
    setEditingReaderName(reader.name);
    setEditingReaderToken("");
    setRevealedReaderToken(null);
  }

  async function updateReader() {
    if (editingReaderId === null) return;
    const res = await fetch("/api/meta/ads-readers", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: editingReaderId,
        name: editingReaderName,
        token: editingReaderToken,
      }),
    });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) {
      alert(data.error ?? "No se pudo actualizar la cuenta de lectura.");
      return;
    }
    setEditingReaderId(null);
    setEditingReaderName("");
    setEditingReaderToken("");
    await loadReaders();
  }

  // La que se muestra: la elegida a mano si sigue existiendo, si no la activa,
  // y si no la primera. Así no hace falta un efecto que sincronice al cargar.
  const paginasConectadas = status?.connections ?? [];
  const paginaElegida =
    paginasConectadas.find((c) => c.active)?.pageId ??
    paginasConectadas[0]?.pageId ??
    null;
  const numerosConectados = status?.whatsAppConnections ?? [];
  const numeroElegido =
    numerosConectados.find((c) => c.active)?.phoneNumberId ??
    numerosConectados[0]?.phoneNumberId ??
    null;

  const inicialDe = (texto: string) =>
    (texto.trim()[0] ?? "?").toUpperCase();

  async function revealReaderToken(id: number) {
    const res = await fetch(`/api/meta/ads-readers?id=${id}`, {
      cache: "no-store",
    });
    const data = await res.json();
    if (!res.ok || !data.reader?.token) {
      alert(data.error ?? "No se pudo recuperar el token.");
      return;
    }
    setRevealedReaderToken({ id, token: data.reader.token });
  }

  async function revealPageToken(pageId: string) {
    const res = await fetch(`/api/meta/connect/token?pageId=${encodeURIComponent(pageId)}`, {
      cache: "no-store",
    });
    const data = await res.json();
    if (!res.ok || !data.token) {
      alert(data.error ?? "No se pudo recuperar el token.");
      return;
    }
    setRevealedPageToken({ pageId, token: data.token });
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    const error = params.get("error");
    if (connected) {
      setPageMessageError(false);
      setPageMessage(`Meta conecto ${connected} pagina(s).`);
    } else if (error) {
      setPageMessageError(true);
      setPageMessage(`Meta no completo la conexion: ${error}`);
    }
    loadStatus().catch((err) => console.error("[meta-connect]", err));
    loadReaders().catch((err) => console.error("[meta-connect]", err));
  }, []);

  async function activate(pageId: string) {
    setBusyPageId(pageId);
    try {
      const res = await fetch("/api/meta/connect/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageId }),
      });
      // Al activar, la página se suscribe sola a mensajes y comentarios. Si
      // alguna de las dos falla se avisa en rojo: antes había que acordarse de
      // pulsar "Configurar Messenger activo" y no había forma de darse cuenta.
      const data = (await res.json().catch(() => null)) as {
        subscription?: { ok?: boolean; detail?: string } | null;
        commentSubscription?: {
          ok?: boolean;
          estado?: string;
          detail?: string;
        } | null;
      } | null;
      const fallos: string[] = [];
      if (data?.subscription && data.subscription.ok !== true) {
        fallos.push(`mensajes (${data.subscription.detail ?? "sin detalle"})`);
      }
      // "sin_comprobar" NO es un fallo: no se pudo mirar, y decir que fallo
      // mandaria a buscar un problema que quiza no existe.
      if (data?.commentSubscription?.estado === "no_activo") {
        fallos.push(
          `comentarios (${data.commentSubscription.detail ?? "sin detalle"})`
        );
      }
      if (fallos.length > 0) {
        setPageMessageError(true);
        setPageMessage(
          `Pagina activada, pero Facebook NO acepto la suscripcion de ${fallos.join(" y ")}. Reintenta con "Configurar Messenger activo"; si sigue igual, revisa los permisos de la app.`
        );
      } else {
        setPageMessageError(false);
        setPageMessage(
          "Pagina activada y suscrita a mensajes y comentarios. No hace falta configurar nada mas."
        );
      }
      await loadStatus();
    } finally {
      setBusyPageId(null);
    }
  }

  async function configureActivePage() {
    setConfiguring(true);
    setConfigureResult(null);
    try {
      const res = await fetch("/api/meta/connect/configure", { method: "POST" });
      setConfigureResult(await res.json());
    } finally {
      setConfiguring(false);
    }
  }

  async function configureWhatsApp() {
    // DOS BOTS (21/10/2026): este botón suscribe el número ACTIVO y no avisaba si otra app ya lo
    // atiende (así se suscribió por accidente el +51 904 325 080). Mismo aviso que «Suscribir».
    const activo = (status?.whatsAppConnections ?? []).find((c) => c.active);
    if (activo) {
      try {
        const d = (await (await fetch("/api/meta/connect/whatsapp/suscribir", { cache: "no-store" })).json()) as {
          otras?: Record<string, string[]>;
        };
        const otras = d.otras?.[activo.phoneNumberId] ?? [];
        if (
          otras.length &&
          !window.confirm(
            `${activo.displayPhoneNumber ?? "Este número"} ya lo atiende otra app: «${otras.join(", ")}». Si sigues, también lo atenderá este CRM y a cada cliente le contestarían DOS bots.\n\nQuítale primero la suscripción a la otra. ¿Seguir de todos modos?`
          )
        )
          return;
      } catch {
        // Sin poder saberlo, se sigue como antes.
      }
    }
    setConfiguringWhatsApp(true);
    setWhatsAppConfigureResult(null);
    try {
      const res = await fetch("/api/meta/connect/whatsapp/configure", {
        method: "POST",
      });
      setWhatsAppConfigureResult(await res.json());
    } finally {
      setConfiguringWhatsApp(false);
    }
  }

  async function setWhatsAppManualMode(enabled: boolean) {
    if (
      enabled &&
      !window.confirm(
        "Usar las variables de EasyPanel para WhatsApp? Meta Connect quedara guardado, pero el bot usara META_ACCESS_TOKEN, META_PHONE_NUMBER_ID y META_WABA_ID."
      )
    ) return;
    setChangingWhatsAppMode(true);
    try {
      const response = await fetch("/api/meta/connect/whatsapp/manual-mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const result = (await response.json()) as { ok?: boolean; error?: string };
      setPageMessage(
        result.ok
          ? enabled
            ? "WhatsApp usara las variables de EasyPanel."
            : "WhatsApp volvio a usar Meta Connect."
          : result.error ?? "No se pudo cambiar el modo de WhatsApp."
      );
      if (result.ok) await loadStatus();
    } finally {
      setChangingWhatsAppMode(false);
    }
  }

  async function removeConnection(type: "page" | "whatsapp", id: string, label: string) {
    if (!window.confirm(`Deseas desconectar ${label} de este agente? No se eliminara ni desconectara en Meta.`)) {
      return;
    }
    setRemovingConnectionId(`${type}:${id}`);
    try {
      const res = await fetch("/api/meta/connect/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, id }),
      });
      const result = (await res.json()) as { ok?: boolean; error?: string };
      setPageMessage(result.ok ? `${label} fue desconectado de este agente.` : result.error ?? "No se pudo desconectar la conexion.");
      await loadStatus();
    } finally {
      setRemovingConnectionId(null);
    }
  }

  async function activateInstagram(connection: MetaStatus["connections"][number]) {
    const instagramName = connection.instagramUsername ?? "esta cuenta de Instagram";
    const confirmed = window.confirm(
      `Activar ${instagramName} para Instagram. Esta cuenta esta vinculada a la pagina de Facebook \"${connection.pageName}\".\n\nNo se modificara Messenger. Confirma que ${instagramName} no esta atendido por otro bot.`
    );
    if (!confirmed) return;

    setBusyInstagramPageId(connection.pageId);
    try {
      const res = await fetch("/api/meta/connect/instagram/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageId: connection.pageId }),
      });
      const result = (await res.json()) as { ok?: boolean; error?: string; instagramUsername?: string };
      setPageMessage(
        result.ok
          ? `${result.instagramUsername ?? "Instagram"} quedo activo sin cambiar Messenger.`
          : result.error ?? "No se pudo activar Instagram."
      );
      await loadStatus();
    } finally {
      setBusyInstagramPageId(null);
    }
  }

  async function configureInstagram() {
    setConfiguringInstagram(true);
    setInstagramConfigureResult(null);
    try {
      const res = await fetch("/api/meta/connect/instagram/configure", {
        method: "POST",
      });
      setInstagramConfigureResult(await res.json());
    } finally {
      setConfiguringInstagram(false);
    }
  }

  async function saveAppConfig() {
    setSavingApp(true);
    try {
      const res = await fetch("/api/meta/connect/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(appConfig),
      });
      const result = (await res.json()) as { ok?: boolean; error?: string };
      setPageMessage(
        result.ok
          ? editingAppCredentials
            ? "Credenciales actualizadas. Si cambiaste de App de Meta, vuelve a conectar y suscribe sus canales."
            : "Datos base guardados. Ahora puedes conectar con Meta."
          : result.error ?? "No se pudo guardar la configuracion base."
      );
      if (result.ok) {
        setEditingAppCredentials(false);
        setAppConfig({
          appId: "",
          appSecret: "",
          instagramAppSecret: "",
          whatsAppAccessToken: "",
        });
      }
      if (result.ok) await loadStatus();
    } finally {
      setSavingApp(false);
    }
  }

  async function resetMessengerWebhookSecret() {
    if (!confirm("Messenger usara la clave de la App guardada en Meta Connect. No desconecta la pagina ni cambia conversaciones. Continuar?")) return;
    setResettingMessengerSecret(true);
    try {
      const res = await fetch("/api/meta/connect/messenger/reset-webhook-secret", { method: "POST" });
      const result = (await res.json()) as { ok?: boolean; error?: string };
      setPageMessage(result.ok ? "Messenger usara la clave actual de Meta Connect." : result.error ?? "No se pudo restablecer Messenger.");
      if (result.ok) await loadStatus();
    } finally {
      setResettingMessengerSecret(false);
    }
  }

  async function activateWhatsApp(phoneNumberId: string) {
    setBusyWhatsAppId(phoneNumberId);
    try {
      const res = await fetch("/api/meta/connect/whatsapp/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumberId }),
      });
      const result = (await res.json()) as { ok?: boolean; error?: string };
      setPageMessage(
        result.ok
          ? "Numero de WhatsApp activado para este agente."
          : result.error ?? "No se pudo activar el numero."
      );
      await loadStatus();
    } finally {
      setBusyWhatsAppId(null);
    }
  }

  const activeConnection = status?.connections.find((conn) => conn.active) ?? null;
  const activeWhatsApp =
    status?.whatsAppConnections.find((connection) => connection.active) ?? null;
  const hiddenDetectedEnvBlock =
    status?.envExtractor.detectedEnvBlock.replace(
      /TOKEN=.+|SECRET=.+|PASSWORD=.+|KEY=.+/g,
      (line) => `${line.split("=")[0]}=********`
    ) ?? "";

  async function copyText(label: string, text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    window.setTimeout(() => setCopied(null), 1800);
  }

  return (
    // EL MISMO SUELO Y EL MISMO PANEL QUE EL EDITOR.
    //
    // Esta pantalla iba sobre blanco, con secciones blancas encima: una sábana
    // clara sin nada que separara una cosa de otra. El editor ya resolvió eso
    // con tres alturas —suelo gris, panel gris claro, tarjetas blancas— y los
    // colores viven en `globals.css` con nombres de función, así que aquí se
    // usan los MISMOS. No se copia una paleta: se lee la que ya hay.
    <main className="mx-auto min-h-screen max-w-4xl px-4 pb-56 pt-8">
      {/* LA CABECERA, COMO LA DE CADA PESTAÑA DEL EDITOR: el rótulo pequeño en
          mayúsculas, el título grande con la letra de titular, y la frase que
          dice qué se hace aquí. */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-sky-200 text-xl text-sky-900 shadow-sm"
          >
            🔗
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-acento">
              Conexión con Meta
            </p>
            <h1 className="font-titulo text-[28px] font-extrabold leading-tight tracking-tight text-tinta">
              Meta Connect
            </h1>
            <p className="mt-0.5 max-w-2xl text-sm text-tinta-suave">
              Aquí eliges tu número, tu página y tu píxel sin copiar IDs largos a
              EasyPanel. Se recorre una vez, de arriba abajo.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href="/" className="rounded-lg border border-borde bg-tarjeta px-3 py-2 text-xs font-semibold text-tinta-suave hover:bg-relleno">Volver al chat</a>
          <a href="/editor" className="rounded-lg border border-borde bg-tarjeta px-3 py-2 text-xs font-semibold text-tinta-suave hover:bg-relleno">Ir al editor</a>
          {/* MODO ESENCIAL · MODO PROFESIONAL, el mismo interruptor que el editor. Ver
              `modoEsencial` aquí arriba. */}
          <span
            className="inline-flex items-center overflow-hidden rounded-lg border border-borde text-xs"
            role="group"
            aria-label="Modo de Meta Connect"
          >
            {([
              [true, "Modo esencial"],
              [false, "Modo profesional"],
            ] as const).map(([esencial, nombre]) => (
              <button
                key={nombre}
                type="button"
                aria-pressed={modoEsencial === esencial}
                onClick={() => {
                  setModoEsencial(esencial);
                  try {
                    localStorage.setItem(MODO_STORAGE_KEY, esencial ? "esencial" : "profesional");
                  } catch {
                    // Que no se recuerde no es motivo para no cambiarlo ahora.
                  }
                }}
                className={`px-3 py-2 font-semibold ${
                  modoEsencial === esencial
                    ? "bg-carbon-fuerte text-white"
                    : "bg-tarjeta text-tinta-suave hover:bg-relleno"
                }`}
              >
                {nombre}
              </button>
            ))}
          </span>
        </div>
      </div>

      <EstadoDeConexion status={status} />

      {/* EL ASISTENTE «CONTINUAR» (20/10/2026): la forma simple de conectar. Lo de abajo
          sigue igual, como siempre. Ver `asistente.tsx`. */}
      <div className="mt-5">
        <AsistenteDeConexion />
      </div>

      {/* UNA COLUMNA CON ORDEN, y no `space-y`, para que el modo esencial pueda poner
          «Configuración automática» después de la página sin mover código. Sin orden
          puesto —el profesional— cada sección sale donde siempre. */}
      {/* LAS SECCIONES SIEMPRE SE VEN, APAGADAS SIN FACEBOOK (21/10/2026): «a mí me gusta como está
          Meta Connect… sirven para enseñar». Como Kommo: se ven, pero no se tocan hasta conectar. */}
      {status && !(status.appId && status.conectadoConFacebook) ? (
        <p className="mt-5 text-center text-sm font-semibold text-tinta-suave">
          {status.appId ? "Conecta tu Facebook arriba para usar todo esto." : "Conecta tu app arriba para empezar."}
        </p>
      ) : null}
      {status ? (
      <div
        className={`mt-5 flex flex-col gap-4 rounded-2xl border border-borde bg-panel p-5 shadow-sm ${
          status.appId && status.conectadoConFacebook ? "" : "pointer-events-none select-none opacity-50"
        }`}
        aria-disabled={!(status.appId && status.conectadoConFacebook)}
      >

      {/* LA DIFERENCIACIÓN, antes que nada: cuántas cuentas, de qué negocio es cada cosa,
          y suscribir cada número. Ver `DiferenciacionPorNegocio`. */}
      <DiferenciacionPorNegocio />

      {/* LO PRIMERO QUE SE VE, ARRIBA DEL TODO.
          Es el resumen de si el bot puede registrar una venta. Debajo hay ocho
          secciones y cada una dice si LO SUYO está bien; ninguna decía si el
          conjunto sirve. Ver `SetDeVenta`. */}
      {/* POR TIENDA (21/10/2026): «recuerda que es un set de ventas por tienda». Sin tiendas, el
          general de siempre. */}
      {status?.appId && status.conectadoConFacebook ? (
      <SetsDeVentaPorTienda
        general={
          <SetDeVenta
            pagina={status?.connections?.[0] ?? null}
            whatsapp={
              status?.whatsAppConnections?.find((c) => c.active) ??
              status?.whatsAppConnections?.[0] ??
              null
            }
            pixelId={pixelElegido || pixelEnUso || ""}
            pixels={pixels}
            datasetDeLaWaba={datasetDeLaWaba}
          />
        }
      />
      ) : null}

      <SeccionEnVentana
        {...lugar(1)}
        titulo="Conexión lista para iniciar"
        tono="bg-emerald-200 text-emerald-900"
        detalle="Las credenciales de tu app de Meta y los tokens guardados"
        icono="🔌"
      >
      <section className="rounded-lg border border-neutral-200 bg-tarjeta p-4 shadow-sm">
        {pageMessage ? (
          <div
            className={`mb-4 rounded-md border p-3 text-sm ${
              pageMessageError
                ? "border-red-300 bg-red-50 text-red-800"
                : "border-blue-200 bg-blue-50 text-blue-800"
            }`}
          >
            {pageMessage}
          </div>
        ) : null}
        {!status ? (
          <p className="text-sm text-neutral-500">Cargando conexion...</p>
        ) : !status.configured || editingAppCredentials ? (
          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium text-neutral-900">
                {status.configured
                  ? "Editar credenciales de Meta"
                  : "Paso 1: datos base de tu app de Meta"}
              </p>
              <p className="mt-1 text-sm text-neutral-600">
                {status.configured
                  ? "Escribe solo lo que deseas reemplazar. Los campos vacios conservan la credencial actual. Para VER lo que hay guardado, usa «Ver tokens» aqui abajo. Si cambias el App ID, pega tambien el secreto de esa nueva App."
                  : "Pegalos una vez aqui. Quedan cifrados dentro de este agente; no necesitas agregarlos a EasyPanel para futuras conexiones."}
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <input
                value={appConfig.appId}
                onChange={(event) =>
                  setAppConfig((value) => ({ ...value, appId: event.target.value }))
                }
                placeholder={
                  status.configured && status.appId
                    ? `Actual: ${status.appName ? `${status.appName} · ` : ""}${status.appId}`
                    : "Meta App ID"
                }
                className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
              />
              <input
                type="password"
                value={appConfig.appSecret}
                onChange={(event) =>
                  setAppConfig((value) => ({ ...value, appSecret: event.target.value }))
                }
                placeholder="Clave secreta de la app de Meta"
                className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
              />
              <input
                type="password"
                value={appConfig.instagramAppSecret}
                onChange={(event) =>
                  setAppConfig((value) => ({
                    ...value,
                    instagramAppSecret: event.target.value,
                  }))
                }
                placeholder="Clave de Instagram (solo si es distinta)"
                className="rounded-md border border-neutral-300 px-3 py-2 text-sm md:col-span-2"
              />
              <div className="md:col-span-2">
                <input
                  type="password"
                  value={appConfig.whatsAppAccessToken}
                  onChange={(event) =>
                    setAppConfig((value) => ({
                      ...value,
                      whatsAppAccessToken: event.target.value,
                    }))
                  }
                  placeholder="Token permanente de WhatsApp (recomendado, opcional)"
                  className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                />
                <p className="mt-1 text-xs text-neutral-500">
                  Se genera una vez en Meta con un System User. Sin este token, el
                  numero usa el token de tu inicio de sesion hasta que Meta lo venza.
                </p>
              </div>
            </div>
            <button
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
              disabled={savingApp || !appConfig.appId.trim() || !appConfig.appSecret.trim()}
              onClick={saveAppConfig}
              type="button"
            >
              {savingApp
                ? "Guardando..."
                : status.configured
                  ? "Guardar credenciales"
                  : "Guardar y continuar"}
            </button>
            {status.configured ? (
              <button
                className="ml-2 rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
                onClick={() => setEditingAppCredentials(false)}
                type="button"
              >
                Cancelar
              </button>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-neutral-900">
                Conexion lista para iniciar
              </p>
              <p className="text-sm text-neutral-500">
                Meta te pedira elegir las paginas que autorizas.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <a
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                href="/api/meta/connect/start"
              >
                Conectar WhatsApp y Messenger
              </a>
              <a
                className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
                href="/api/meta/connect/start"
              >
                Actualizar lista de Meta
              </a>
              <a
                className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
                href="/api/meta/connect/start?instagram=1"
              >
                Incluir Instagram
              </a>
            </div>
            <button
              className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
              onClick={() => setEditingAppCredentials(true)}
              type="button"
            >
              Editar credenciales
            </button>
            <button
              className="rounded-md border border-amber-300 px-3 py-2 text-sm font-medium text-amber-800 hover:bg-amber-50 disabled:opacity-60"
              onClick={resetMessengerWebhookSecret}
              disabled={resettingMessengerSecret}
              type="button"
              title={status.credentials.messengerEnvSecretConfigured ? "Hay una variable MESSENGER_APP_SECRET en EasyPanel; debes vaciarla tambien." : "Quita una clave especifica antigua de Messenger para usar Meta Connect."}
            >
              {resettingMessengerSecret ? "Restableciendo..." : "Usar clave de Meta Connect en Messenger"}
            </button>
          </div>
        )}
        {/* LOS TOKENS GUARDADOS, A LA VISTA CUANDO SE PIDEN.
            Va DENTRO de esta misma sección y fuera del formulario, porque hace
            falta tanto al configurar como después: el formulario solo aparece
            mientras se editan las credenciales.
            Ver `CredencialesGuardadas` para por qué no viajan al cargar. */}
        {status ? <CredencialesGuardadas /> : null}
      </section>
      </SeccionEnVentana>

      <SeccionEnVentana
        {...lugar(2)}
        titulo="Configuración automática"
        tono="bg-lime-200 text-lime-900"
        detalle="Deja la app de Meta lista sin entrar a su panel"
        icono="⚙️"
      >
      <section className="rounded-lg border border-neutral-200 bg-tarjeta p-4 shadow-sm">
        {/* SOLO COMO REPARACIÓN (21/10/2026): al elegir una página con «Agregar y usar», ya se
            suscribe sola a mensajes y comentarios. Este botón solo aparece si algo falló: la
            conexión automática no quedó lista, o la activación de la página avisó de un fallo. */}
        {(conexionFallo || pageMessageError) && (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-neutral-950">
              Configuracion automatica
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-neutral-600">
              Esto suscribe la pagina activa de Messenger a sus eventos minimos
              de mensajes. Si Meta lo rechaza, aqui veras exactamente que falta.
            </p>
          </div>
          <button
            className="rounded-md bg-carbon-fuerte px-4 py-2 text-sm font-medium text-white hover:bg-carbon-suave disabled:opacity-60"
            disabled={!activeConnection || configuring}
            onClick={configureActivePage}
            type="button"
          >
            {configuring ? "Configurando..." : "Configurar Messenger activo"}
          </button>
        </div>
        )}

        {configureResult ? (
          <div
            className={`mt-4 rounded-md border p-3 text-sm ${
              configureResult.ok
                ? "border-green-200 bg-green-50 text-green-800"
                : "border-red-200 bg-red-50 text-red-800"
            }`}
          >
            <p className="font-medium">
              {configureResult.ok ? "Configuracion aplicada" : "Falta revisar Meta"}
            </p>
            <p className="mt-1">
              {configureResult.subscription?.message ?? configureResult.error}
            </p>
            {configureResult.subscription?.fields.length ? (
              <p className="mt-1 text-xs">
                Campos usados: {configureResult.subscription.fields.join(", ")}
              </p>
            ) : null}
            {/* Los comentarios se suscriben en una llamada aparte. Antes no se
                mostraba y no habia forma de saber si `feed` habia quedado. */}
            {configureResult.commentSubscription ? (
              <p
                className={`mt-1 text-xs font-medium ${
                  configureResult.commentSubscription.estado === "activo"
                    ? "text-green-700"
                    : configureResult.commentSubscription.estado ===
                        "sin_comprobar"
                      ? "text-amber-700"
                      : "text-red-700"
                }`}
              >
                {configureResult.commentSubscription.estado === "activo"
                  ? `Comentarios (feed): ACTIVO. Campos reales de la pagina: ${configureResult.commentSubscription.detail}`
                  : configureResult.commentSubscription.estado ===
                      "sin_comprobar"
                    ? `Comentarios (feed): SIN COMPROBAR — ${configureResult.commentSubscription.detail}`
                    : `Comentarios (feed): NO quedo activo — ${configureResult.commentSubscription.detail}`}
              </p>
            ) : null}
            {configureResult.nextSteps?.length ? (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
                {configureResult.nextSteps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </section>
      </SeccionEnVentana>

      <SeccionEnVentana
        {...lugar(3)}
        titulo="Cuentas de lectura de Ads"
        tono="bg-amber-200 text-amber-900"
        detalle="Tokens para leer anuncios de negocios ajenos"
        icono="📈"
      >
      <section className="rounded-lg border border-neutral-200 bg-tarjeta p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-neutral-950">
          Cuentas de lectura de Ads
        </h2>
        <p className="mt-1 text-sm text-neutral-600">
          Tokens privados para buscar enlaces desde IDs de anuncios. No se
          exportan ni se suben a Git. Solo hacen falta para negocios AJENOS:
          los anuncios de tu propio negocio los lee ya el token permanente. Si
          dejas el nombre vacio, se le pregunta a Meta de quien es el token.
        </p>
        <div className="mt-3 grid gap-2 md:grid-cols-[180px_1fr_auto]">
          <input
            value={readerName}
            onChange={(event) => setReaderName(event.target.value)}
            placeholder="Nombre (opcional)"
            className="rounded border border-neutral-300 px-3 py-2 text-sm"
          />
          <textarea
            value={readerToken}
            onChange={(event) => setReaderToken(event.target.value)}
            placeholder="Pega el token de lectura"
            rows={2}
            className="rounded border border-neutral-300 px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={saveReader}
            className="rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Guardar
          </button>
        </div>
        {ultimaQuitada ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm">
            <span className="text-amber-900">
              «{ultimaQuitada.name}» está en la papelera. Su token sigue
              guardado.
            </span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => void restaurarReader(ultimaQuitada.id)}
                className="font-medium text-amber-900 underline hover:text-amber-950"
              >
                Deshacer
              </button>
              <button
                type="button"
                onClick={() => setUltimaQuitada(null)}
                className="text-amber-700 hover:text-amber-900"
              >
                Cerrar
              </button>
            </div>
          </div>
        ) : null}
        <div className="mt-3 space-y-2">
          {readers.map((reader) => (
            <div
              key={reader.id}
              className="rounded border border-neutral-200 px-3 py-2 text-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {reader.name} <span className="text-neutral-400">Token guardado</span>
                </span>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => startEditingReader(reader)}
                    className="text-neutral-700 hover:text-neutral-950"
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      revealedReaderToken?.id === reader.id
                        ? setRevealedReaderToken(null)
                        : revealReaderToken(reader.id)
                    }
                    className="text-blue-700 hover:text-blue-800"
                  >
                    {revealedReaderToken?.id === reader.id ? "Ocultar token" : "Ver token"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void quitarReader(reader)}
                    className="text-red-600 hover:text-red-700"
                  >
                    Quitar
                  </button>
                </div>
              </div>
              {revealedReaderToken?.id === reader.id ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    readOnly
                    value={revealedReaderToken.token}
                    className="min-w-0 flex-1 rounded border border-blue-200 bg-blue-50 px-2 py-1.5 font-mono text-xs text-neutral-800"
                  />
                  <button
                    type="button"
                    onClick={() => copyText(`reader-${reader.id}`, revealedReaderToken.token)}
                    className="rounded border border-blue-200 px-2 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50"
                  >
                    {copied === `reader-${reader.id}` ? "Copiado" : "Copiar"}
                  </button>
                </div>
              ) : null}
              {editingReaderId === reader.id ? (
                <div className="mt-3 grid gap-2 border-t border-neutral-100 pt-3 md:grid-cols-[180px_1fr_auto_auto]">
                  <input
                    value={editingReaderName}
                    onChange={(event) => setEditingReaderName(event.target.value)}
                    placeholder="Nombre de la cuenta"
                    className="rounded border border-neutral-300 px-2 py-1.5 text-sm"
                  />
                  <input
                    type="password"
                    value={editingReaderToken}
                    onChange={(event) => setEditingReaderToken(event.target.value)}
                    placeholder="Nuevo token (vacio = conservar actual)"
                    className="rounded border border-neutral-300 px-2 py-1.5 text-sm"
                  />
                  <button
                    type="button"
                    onClick={updateReader}
                    className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
                  >
                    Guardar
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingReaderId(null)}
                    className="rounded border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
                  >
                    Cancelar
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
        {papelera.length > 0 ? (
          <div className="mt-4 border-t border-neutral-200 pt-3">
            <h3 className="text-sm font-semibold text-neutral-800">
              Papelera ({papelera.length})
            </h3>
            <p className="mt-1 text-xs text-neutral-500">
              Quitadas, pero con su token guardado. Restaurar las devuelve tal
              como estaban. Borrarlas de verdad es definitivo: el token no se
              recupera y habría que pedirle uno nuevo a Meta.
            </p>
            <div className="mt-2 space-y-2">
              {papelera.map((reader) => (
                <div
                  key={reader.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded border border-dashed border-neutral-300 bg-neutral-50 px-3 py-2 text-sm"
                >
                  <span className="text-neutral-600">
                    {reader.name}{" "}
                    <span className="text-neutral-400">
                      {reader.deleted_at
                        ? `quitada el ${new Date(
                            reader.deleted_at * 1000
                          ).toLocaleDateString()}`
                        : "quitada"}
                    </span>
                  </span>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => void restaurarReader(reader.id)}
                      className="font-medium text-blue-700 hover:text-blue-800"
                    >
                      Restaurar
                    </button>
                    <button
                      type="button"
                      onClick={() => void borrarReaderDefinitivo(reader)}
                      className="text-red-600 hover:text-red-700"
                    >
                      Borrar definitivo
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </section>
      </SeccionEnVentana>

      <SeccionEnVentana
        {...lugar(4)}
        titulo="Páginas de Facebook"
        tono="bg-sky-200 text-sky-900"
        detalle="Las que ya trabaja este agente y las que Meta ve sin usar"
        icono="📘"
      >
      <section className="rounded-lg border border-neutral-200 bg-tarjeta shadow-sm">
        <div className="border-b border-neutral-200 px-4 py-3">
          <h2 className="text-base font-semibold text-neutral-950">
            Páginas de Facebook
          </h2>
        </div>
        <div className="border-b border-neutral-100 bg-neutral-50">
          <SelectorDeCuenta
            etiqueta="Página que responde"
            ocupado={busyPageId !== null}
            vacio="Aún no hay páginas conectadas."
            opciones={paginasConectadas.map((conn) => ({
              valor: conn.pageId,
              // Agrupadas por su cuenta, igual que los píxeles. Ver «Tus cuentas de
              // Meta», arriba del todo.
              grupo: conn.businessName ?? "Cuenta sin identificar",
              titulo: conn.pageName,
              subtitulo: `ID ${conn.pageId}`,
              // Su foto de perfil, pedida con el token de la página. La URL
              // "pública" no siempre responde, y entonces el selector se quedaba
              // con el círculo de la inicial y no se parecía al de los números.
              // Si tampoco viene por ahí, se intenta la pública antes de rendirse.
              foto:
                avataresWhatsApp[conn.pageId] ??
                `https://graph.facebook.com/${conn.pageId}/picture?type=square`,
              inicial: inicialDe(conn.pageName),
              colorCirculo: "bg-sky-500",
              activa: conn.active,
            }))}
            // SIN NINGUNA ACTIVA NO HAY NADA QUE REEMPLAZAR (21/10/2026): el texto decía «reemplazar»
            // aunque no hubiera ninguna, y confundía.
            confirmar={(opcion) =>
              (status?.connections ?? []).some((c) => c.active)
                ? `¿Reemplazar la página activa por «${opcion.titulo}»?\n\nEl bot pasará a responder por esta página.`
                : `¿Usar «${opcion.titulo}» como la página que responde?\n\nEl bot pasará a responder por esta página.`
            }
            onElegir={(pageId) => void activate(pageId)}
          />
          {paginasConectadas.length > 1 ? (
            <button
              type="button"
              onClick={() => setVerTodasPaginas((valor) => !valor)}
              className="px-4 pb-3 text-xs font-medium text-blue-700 hover:text-blue-800"
            >
              {verTodasPaginas
                ? "Ocultar las demás"
                : `Ver todas (${paginasConectadas.length})`}
            </button>
          ) : null}
        </div>
        <div className="divide-y divide-neutral-100">
          {paginasConectadas.length ? (
            paginasConectadas
              .filter((conn) => verTodasPaginas || conn.pageId === paginaElegida)
              .map((conn) => (
              <div
                key={conn.pageId}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  {conn.pageId ? (
                    <img
                      src={`/api/meta/avatar?page=${conn.pageId}`}
                      alt=""
                      className="h-11 w-11 shrink-0 rounded-full border border-neutral-200 object-cover"
                    />
                  ) : (
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">
                      f
                    </div>
                  )}
                  <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-neutral-950">
                      {conn.pageName}
                    </p>
                    {conn.active ? (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                        Activa
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-neutral-500">
                    Page ID: {conn.pageId}
                  </p>
                  <p className="mt-1 text-xs text-neutral-500">
                    Instagram:{" "}
                    {conn.instagramBusinessAccountId
                      ? `${conn.instagramUsername ?? "cuenta"} (${conn.instagramBusinessAccountId})`
                      : "sin Instagram vinculado"}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        revealedPageToken?.pageId === conn.pageId
                          ? setRevealedPageToken(null)
                          : revealPageToken(conn.pageId)
                      }
                      className="text-xs font-medium text-blue-700 hover:text-blue-800"
                    >
                      {revealedPageToken?.pageId === conn.pageId
                        ? "Ocultar token"
                        : "Ver token"}
                    </button>
                    {revealedPageToken?.pageId === conn.pageId ? (
                      <>
                        <input
                          readOnly
                          value={revealedPageToken.token}
                          className="min-w-0 max-w-full flex-1 rounded border border-blue-200 bg-blue-50 px-2 py-1 font-mono text-xs text-neutral-800"
                        />
                        <button
                          type="button"
                          onClick={() => copyText(`page-${conn.pageId}`, revealedPageToken.token)}
                          className="rounded border border-blue-200 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50"
                        >
                          {copied === `page-${conn.pageId}` ? "Copiado" : "Copiar"}
                        </button>
                      </>
                    ) : null}
                  </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {conn.active ? (
                    <button
                      className="rounded-md border border-red-200 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
                      disabled={removingConnectionId === `page:${conn.pageId}`}
                      onClick={() => removeConnection("page", conn.pageId, conn.pageName)}
                      type="button"
                    >
                      {removingConnectionId === `page:${conn.pageId}`
                        ? "Desconectando..."
                        : "Desconectar"}
                    </button>
                  ) : (
                    <button
                    className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-60"
                    disabled={busyPageId === conn.pageId}
                    onClick={() => activate(conn.pageId)}
                    type="button"
                  >
                    {busyPageId === conn.pageId ? "Activando..." : "Usar esta"}
                  </button>
                  )}
                </div>
              </div>
            ))
          ) : (
            <p className="px-4 py-6 text-sm text-neutral-500">
              Todavia no hay paginas guardadas.
            </p>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-amber-200 bg-amber-50/40 shadow-sm">
        <div className="border-b border-amber-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-neutral-950">
            Páginas de Facebook detectadas: elige las que trabajará este agente
          </h2>
          <p className="mt-1 text-xs text-neutral-600">
            Meta puede mostrar páginas de prueba o páginas que no atenderá este bot. No se usarán hasta que pulses “Agregar y usar”.
          </p>
        </div>
        <div className="divide-y divide-amber-100">
          {status?.detectedPages.length ? (
            // SEPARADAS POR BM (20/10/2026): «aparecen en lista pero no hay un separador que
            // indique de qué BM sale».
            porNegocio(status.detectedPages, (p) => p.businessName).map((grupo) => (
              <div key={grupo.nombre}>
              <p className="border-y border-amber-200 bg-amber-100/70 px-4 py-1.5 text-[11px] font-bold uppercase tracking-wide text-amber-900">
                🏢 {grupo.nombre}
              </p>
              {grupo.items.map((page) => (
              <div key={page.pageId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  {page.pageId ? (
                    <img src={`/api/meta/avatar?page=${page.pageId}`} alt="" className="h-11 w-11 shrink-0 rounded-full border border-neutral-200 object-cover" />
                  ) : (
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">f</div>
                  )}
                  <div>
                    <p className="text-sm font-medium text-neutral-950">{page.pageName}</p>
                    <p className="mt-1 text-xs text-neutral-500">Page ID: {page.pageId}</p>
                  </div>
                </div>
                <button
                  className="rounded-md border border-amber-300 bg-tarjeta px-3 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-60"
                  disabled={busyPageId === page.pageId}
                  onClick={() => activate(page.pageId)}
                  type="button"
                >
                  {busyPageId === page.pageId ? "Agregando..." : "Agregar y usar"}
                </button>
              </div>
              ))}
              </div>
            ))
          ) : (
            <p className="px-4 py-5 text-sm text-neutral-500">No hay páginas pendientes de seleccionar.</p>
          )}
        </div>

        {/* Instagram, aparte.
            En Meta una cuenta de Instagram profesional no existe suelta: cuelga
            SIEMPRE de una página de Facebook. Por eso llegan mezcladas en la
            misma lista y cuesta distinguirlas. Aquí se muestran por separado y
            diciendo de qué página cuelga cada una — no son filas duplicadas,
            son las dos caras de lo mismo. */}
        {status?.detectedPages.some((page) => page.instagramBusinessAccountId) ? (
          <>
            <div className="border-y border-amber-200 bg-amber-50 px-4 py-3">
              <h2 className="text-sm font-semibold text-neutral-950">
                Cuentas de Instagram detectadas
              </h2>
              <p className="mt-1 text-xs text-neutral-600">
                Cada una cuelga de la página de arriba que se indica. Al agregar
                la página se agrega también su Instagram.
              </p>
            </div>
            <div className="divide-y divide-amber-100">
              {status.detectedPages
                .filter((page) => page.instagramBusinessAccountId)
                .map((page) => (
                  <div
                    key={`ig:${page.instagramBusinessAccountId}`}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-fuchsia-500 to-amber-400 text-sm font-bold text-white">
                        ig
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-neutral-950">
                          @{page.instagramUsername ?? "cuenta de Instagram"}
                        </p>
                        <p className="mt-1 truncate text-xs text-neutral-500">
                          Cuelga de «{page.pageName}» · ID:{" "}
                          {page.instagramBusinessAccountId}
                        </p>
                      </div>
                    </div>
                    <button
                      className="rounded-md border border-amber-300 bg-tarjeta px-3 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-60"
                      disabled={busyPageId === page.pageId}
                      onClick={() => activate(page.pageId)}
                      type="button"
                    >
                      {busyPageId === page.pageId
                        ? "Agregando..."
                        : "Agregar su página"}
                    </button>
                  </div>
                ))}
            </div>
          </>
        ) : null}
      </section>
      </SeccionEnVentana>

      <SeccionEnVentana
        {...lugar(5)}
        titulo="Instagram para este agente"
        tono="bg-fuchsia-200 text-fuchsia-900"
        detalle="La cuenta que atiende los mensajes de Instagram"
        icono="📸"
      >
      <section className="rounded-lg border border-neutral-200 bg-tarjeta shadow-sm">
        <div className="border-b border-neutral-200 px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-neutral-950">
                Instagram para este agente
              </h2>
              <p className="mt-1 max-w-2xl text-xs text-neutral-500">
                Instagram puede usar una pagina de Facebook distinta a Messenger. Antes de activar,
                verifica que la cuenta no este atendida por otro bot.
              </p>
            </div>
            <button
              className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-60"
              disabled={
                !status?.connections.some((connection) => connection.instagramActive) ||
                configuringInstagram
              }
              onClick={configureInstagram}
              type="button"
            >
              {configuringInstagram ? "Configurando..." : "Configurar Instagram activo"}
            </button>
          </div>
          {instagramConfigureResult ? (
            <div
              className={`mt-3 rounded-md border p-3 text-sm ${
                instagramConfigureResult.ok
                  ? "border-green-200 bg-green-50 text-green-800"
                  : "border-red-200 bg-red-50 text-red-800"
              }`}
            >
              <p className="font-medium">
                {instagramConfigureResult.ok
                  ? "Instagram suscrito correctamente"
                  : "Instagram no se pudo suscribir"}
              </p>
              <p className="mt-1">
                {instagramConfigureResult.subscription?.message ??
                  instagramConfigureResult.error}
              </p>
              {instagramConfigureResult.nextSteps?.length ? (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
                  {instagramConfigureResult.nextSteps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="divide-y divide-neutral-100">
          {status?.connections.filter((connection) => connection.instagramBusinessAccountId)
            .length ? (
            status.connections
              .filter((connection) => connection.instagramBusinessAccountId)
              .map((connection) => (
                <div
                  key={`instagram-${connection.pageId}`}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-neutral-950">
                        @{connection.instagramUsername ?? "cuenta de Instagram"}
                      </p>
                      {connection.instagramActive ? (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                          Activa en Instagram
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-neutral-500">
                      Vinculada a la pagina de Facebook: {connection.pageName}
                    </p>
                  </div>
                  {!connection.instagramActive ? (
                    <button
                      className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-60"
                      disabled={busyInstagramPageId === connection.pageId}
                      onClick={() => activateInstagram(connection)}
                      type="button"
                    >
                      {busyInstagramPageId === connection.pageId
                        ? "Activando..."
                        : "Activar Instagram"}
                    </button>
                  ) : null}
                </div>
              ))
          ) : (
            <p className="px-4 py-6 text-sm text-neutral-500">
              Aun no hay cuentas de Instagram detectadas. Pulsa “Incluir Instagram”
              arriba y autoriza la pagina a la que esta vinculada la cuenta.
            </p>
          )}
        </div>
      </section>
      </SeccionEnVentana>

      <SeccionEnVentana
        {...lugar(6)}
        titulo="Cuentas de WhatsApp"
        tono="bg-teal-200 text-teal-900"
        detalle="El número por el que sale el bot"
        icono="💬"
      >
      <section className="rounded-lg border border-neutral-200 bg-tarjeta shadow-sm">
        <div className="border-b border-neutral-200 px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-neutral-950">
                Números de WhatsApp
              </h2>
              <p className="mt-1 text-xs text-neutral-500">
                {/* DICE LA VERDAD (21/10/2026): «le da acceso a un solo número pero yo uso varios
                    para vender». El bot atiende todos; el principal solo es el de reserva. */}
                El bot atiende <b>todos</b> tus números conectados: a cada cliente le contesta por el
                número al que escribió. El <b>número principal</b> solo es el que se usa cuando un
                mensaje no sale de ninguna conversación. Cambiarlo no toca nada en Meta.
              </p>
            </div>
            {/* SOLO COMO REPARACIÓN (21/10/2026): activar o traer un número desde el asistente ya
                lo suscribe. Este botón solo aparece si la conexión automática no quedó lista. */}
            {conexionFallo && (
            <button
              className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-60"
              disabled={!activeWhatsApp || configuringWhatsApp}
              onClick={configureWhatsApp}
              type="button"
            >
              {configuringWhatsApp ? "Suscribiendo..." : "Suscribir WhatsApp"}
            </button>
            )}
          </div>
          <div className={`mt-3 flex flex-wrap items-center justify-between gap-4 rounded-md border p-3 ${status?.whatsAppManualMode ? "border-blue-200 bg-blue-50" : "border-green-200 bg-green-50"}`}>
            <div>
              <p className={`text-sm font-semibold ${status?.whatsAppManualMode ? "text-blue-950" : "text-green-950"}`}>
                {status?.whatsAppManualMode
                  ? "ESTA USANDO VARIABLES DE EASYPANEL"
                  : "ESTA USANDO META CONNECT"}
              </p>
              <p className={`mt-1 text-xs ${status?.whatsAppManualMode ? "text-blue-800" : "text-green-800"}`}>
                {status?.whatsAppManualMode
                  ? "Fuente activa: META_ACCESS_TOKEN, META_PHONE_NUMBER_ID y META_WABA_ID de EasyPanel."
                  : "Fuente activa: las credenciales guardadas al conectar este numero mediante Meta Connect."}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={status?.whatsAppManualMode === true}
              aria-label="Usar variables de EasyPanel para WhatsApp"
              disabled={!status || changingWhatsAppMode || (status.whatsAppManualMode !== true && !status.whatsAppManualEnvReady)}
              onClick={() => setWhatsAppManualMode(!status?.whatsAppManualMode)}
              className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${status?.whatsAppManualMode ? "border-blue-300 bg-tarjeta text-blue-900" : "border-neutral-300 bg-tarjeta text-neutral-800"}`}
            >
              <span>Usar variables de EasyPanel</span>
              <span className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors ${status?.whatsAppManualMode ? "bg-blue-600" : "bg-neutral-300"}`}>
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-tarjeta shadow transition-transform ${status?.whatsAppManualMode ? "translate-x-4" : "translate-x-0.5"}`} />
              </span>
              <span className="min-w-7 text-xs">{changingWhatsAppMode ? "..." : status?.whatsAppManualMode ? "ON" : "OFF"}</span>
            </button>
          </div>
          {!status?.whatsAppManualMode && !status?.whatsAppManualEnvReady ? (
            <p className="mt-2 text-xs text-amber-700">
              Para activar el modo manual, completa las tres variables de WhatsApp en EasyPanel y despliega primero.
            </p>
          ) : null}
          {whatsAppConfigureResult ? (
            <div
              className={`mt-3 rounded-md border p-3 text-sm ${
                whatsAppConfigureResult.ok
                  ? "border-green-200 bg-green-50 text-green-800"
                  : "border-red-200 bg-red-50 text-red-800"
              }`}
            >
              <p className="font-medium">
                {whatsAppConfigureResult.ok
                  ? "WhatsApp suscrito correctamente"
                  : "WhatsApp no se pudo suscribir"}
              </p>
              <p className="mt-1">
                {whatsAppConfigureResult.subscription?.message ??
                  whatsAppConfigureResult.error}
              </p>
              {whatsAppConfigureResult.nextSteps?.length ? (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
                  {whatsAppConfigureResult.nextSteps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="border-b border-neutral-100 bg-neutral-50">
          <SelectorDeCuenta
            etiqueta="Número principal"
            ocupado={busyWhatsAppId !== null}
            vacio="Aún no hay números conectados."
            opciones={numerosConectados.map((connection) => ({
              valor: connection.phoneNumberId,
              grupo: connection.businessName ?? "Cuenta sin identificar",
              titulo:
                connection.displayPhoneNumber ?? connection.phoneNumberId,
              subtitulo:
                connection.verifiedName ?? `WABA ${connection.wabaId}`,
              // Su foto de perfil, pedida a la API. Si no hay, queda el
              // círculo con la inicial.
              foto: avataresWhatsApp[connection.phoneNumberId] ?? null,
              inicial: inicialDe(
                connection.verifiedName ??
                  connection.displayPhoneNumber ??
                  "W"
              ),
              colorCirculo: "bg-emerald-500",
              activa: connection.active,
            }))}
            confirmar={(opcion) =>
              numerosConectados.some((c) => c.active)
                ? `¿Usar «${opcion.titulo}» como número principal?\n\nEl bot sigue atendiendo todos tus números; este pasa a ser el de reserva.`
                : `¿Usar «${opcion.titulo}» como número principal?\n\nEl bot sigue atendiendo todos tus números; este será el de reserva.`
            }
            onElegir={(phoneNumberId) => void activateWhatsApp(phoneNumberId)}
          />
          {numerosConectados.length > 1 ? (
            <button
              type="button"
              onClick={() => setVerTodosNumeros((valor) => !valor)}
              className="px-4 pb-3 text-xs font-medium text-blue-700 hover:text-blue-800"
            >
              {verTodosNumeros
                ? "Ocultar los demás"
                : `Ver todos (${numerosConectados.length})`}
            </button>
          ) : null}
        </div>
        <div className="divide-y divide-neutral-100">
          {numerosConectados.length ? (
            // SEPARADOS POR BM (20/10/2026), como las páginas detectadas.
            porNegocio(
              numerosConectados.filter(
                (connection) =>
                  verTodosNumeros ||
                  connection.phoneNumberId === numeroElegido
              ),
              (c) => c.businessName
            ).map((grupo) => (
              <div key={grupo.nombre}>
              {verTodosNumeros ? (
                <p className="border-y border-neutral-200 bg-neutral-100 px-4 py-1.5 text-[11px] font-bold uppercase tracking-wide text-neutral-700">
                  🏢 {grupo.nombre}
                </p>
              ) : null}
              {grupo.items.map((connection) => (
              <div
                key={connection.phoneNumberId}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  {connection.phoneNumberId ? (
                    <img
                      src={`/api/meta/avatar?wa=${connection.phoneNumberId}`}
                      alt=""
                      className="h-12 w-12 shrink-0 rounded-full border border-neutral-200 object-cover"
                    />
                  ) : (
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#25D366] text-sm font-bold text-white">
                      W
                    </div>
                  )}
                  <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-neutral-950">
                      {connection.displayPhoneNumber ?? connection.phoneNumberId}
                    </p>
                    {connection.active ? (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                        Principal
                      </span>
                    ) : null}
                    {connection.pausado ? (
                      <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-xs font-medium text-neutral-700">
                        ⏸ Pausado en este proyecto
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-neutral-500">
                    {connection.verifiedName ?? "Sin nombre verificado"} · Phone Number ID: {connection.phoneNumberId}
                    <br />
                    WABA ID: {connection.wabaId}
                  </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {/* PAUSAR EN ESTE PROYECTO (21/10/2026): «en vez de quitarlo, deshabilitarlo».
                      Este bot deja de contestar por él (otro proyecto lo atiende), sigue en la
                      lista y se reanuda con un clic. Iniciar sesión no lo reactiva. */}
                  <button
                    className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-60"
                    disabled={busyWhatsAppId === connection.phoneNumberId}
                    title={connection.pausado ? "Este bot vuelve a contestar por este número" : "Este bot deja de contestar por este número (otro proyecto lo atiende). No cambia nada en Meta."}
                    onClick={() => void pausarNumeroDelProyecto(connection.phoneNumberId, !connection.pausado, connection.displayPhoneNumber ?? "este número")}
                    type="button"
                  >
                    {connection.pausado ? "▶ Reanudar" : "⏸ Pausar"}
                  </button>
                  {connection.active ? (
                    <button
                      className="rounded-md border border-red-200 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
                      disabled={removingConnectionId === `whatsapp:${connection.phoneNumberId}`}
                      onClick={() => removeConnection("whatsapp", connection.phoneNumberId, connection.displayPhoneNumber ?? "este numero")}
                      type="button"
                    >
                      {removingConnectionId === `whatsapp:${connection.phoneNumberId}`
                        ? "Desconectando..."
                        : "Desconectar"}
                    </button>
                  ) : (
                    <>
                    <button
                    className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-60"
                    disabled={busyWhatsAppId === connection.phoneNumberId}
                    onClick={() => activateWhatsApp(connection.phoneNumberId)}
                    type="button"
                  >
                    {busyWhatsAppId === connection.phoneNumberId ? "Cambiando..." : "Hacerlo principal"}
                  </button>
                  {/* QUITAR UN NUMERO QUE NO ESTA ACTIVO.
                      LO PIDIO EL DUEÑO el 01/10/2026: habia borrado numeros en
                      Meta, seguian en la lista del bot, y «en el pop up no
                      aparece la lista ni quitar, esta oculto creo yo».
                      No estaba oculto: NO EXISTIA. El boton de desconectar solo
                      se dibujaba para el numero ACTIVO, asi que los viejos —que
                      por definicion no lo son— solo ofrecian «Usar este numero».
                      La unica forma de quitar uno era activarlo primero.
                      Y dejarlos ahi no es inofensivo: un numero muerto puede
                      acabar siendo el activo, y el activo es el que usa el bot
                      cuando manda algo sin conversacion detras.
                      Pidio clic derecho; va una papelera VISIBLE, como las de
                      Tiendas y Usuarios: el clic derecho no se descubre y en el
                      movil no existe. */}
                  <button
                    className="rounded-md border border-red-200 px-2 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-60"
                    disabled={removingConnectionId === `whatsapp:${connection.phoneNumberId}`}
                    onClick={() => removeConnection("whatsapp", connection.phoneNumberId, connection.displayPhoneNumber ?? "este numero")}
                    title="Quitar este numero de este agente (no se toca nada en Meta)"
                    aria-label="Quitar este numero de este agente"
                    type="button"
                  >
                    {removingConnectionId === `whatsapp:${connection.phoneNumberId}`
                      ? "Quitando..."
                      : "🗑️"}
                  </button>
                  </>
                  )}
                </div>
              </div>
              ))}
              </div>
            ))
          ) : (
            <p className="px-4 py-6 text-sm text-neutral-500">
              Conecta con Meta para detectar los numeros de WhatsApp autorizados.
            </p>
          )}
        </div>
      </section>
      </SeccionEnVentana>

      <SeccionEnVentana
        {...lugar(7)}
        titulo="Píxel"
        tono="bg-violet-200 text-violet-900"
        detalle="El conjunto de datos al que se le reportan las compras"
        icono="🎯"
      >
      <section className="rounded-lg border border-neutral-200 bg-tarjeta p-4 shadow-sm">
        <h2 className="text-base font-semibold text-neutral-950">
          Píxel
        </h2>
        <p className="mt-1 text-sm text-neutral-600">
          El dataset al que el bot le reporta las compras. Se detecta solo al
          conectar con Meta; aquí eliges cuál usar y ya no hace falta ponerlo en
          las variables de entorno.
        </p>
        {pixels.length ? (
          <div className="-mx-4">
            <SelectorDeCuenta
              etiqueta="Dataset que recibe las compras"
              ocupado={guardandoPixel}
              vacio="Aún no se detectó ningún pixel."
              opciones={[
                ...pixels.map((pixel) => ({
                  valor: pixel.pixelId,
                  // El negocio manda el encabezado. Los que no lo traen se
                  // juntan bajo uno solo en vez de quedar cada uno por su lado.
                  grupo: pixel.businessName ?? "Sin negocio identificado",
                  titulo: pixel.name ?? "Sin nombre",
                  subtitulo: `${pixel.pixelId}${
                    pixel.businessName ? ` · ${pixel.businessName}` : ""
                  }${pixel.compartido ? " · compartido" : ""}${
                    !pixelElegido && pixel.pixelId === pixelEnUso
                      ? " · en uso por la variable de entorno"
                      : ""
                  }`,
                  foto: null,
                  inicial: "◎",
                  colorCirculo: "bg-violet-500",
                  // "Activa" SOLO si se eligió aquí. Antes se marcaba también el
                  // que coincidía con la variable de entorno, y como elegir la
                  // activa no hace nada, el clic no guardaba nada: al apagar la
                  // variable te quedabas sin pixel.
                  activa: Boolean(pixelElegido) && pixel.pixelId === pixelElegido,
                })),
                {
                  valor: "",
                  titulo: "Usar la variable de entorno",
                  subtitulo: pixelEnUso
                    ? `Ahora mismo es lo que manda: ${pixelEnUso}`
                    : "Vuelve a lo que diga EasyPanel",
                  foto: null,
                  inicial: "·",
                  colorCirculo: "bg-neutral-400",
                  activa: !pixelElegido,
                },
              ]}
              confirmar={(opcion) =>
                opcion.valor
                  ? `¿Reemplazar el pixel activo por «${opcion.titulo}»?\n\nLas compras se reportarán a este dataset.`
                  : "¿Dejar de usar el pixel elegido y volver a la variable de entorno?"
              }
              onElegir={(pixelId) => void guardarPixel(pixelId)}
            />
          </div>
        ) : (
          <p className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Todavía no se detectó ningún pixel. Conecta con Meta para que se
            listen.
          </p>
        )}
        <p className="mt-2 text-xs text-neutral-500">
          En uso ahora: {pixelEnUso ?? "ninguno"}
          {pixelDesdeVariable
            ? " — sale de la variable de entorno, no de una elección hecha aquí."
            : ""}
        </p>

        {/* Crear el conjunto de datos de la propia cuenta de WhatsApp. Va
            APARTE del desplegable: no se fusiona con un pixel que ya exista —
            Meta no deja vincular a posteriori— sino que devuelve el de esta
            WABA o crea uno nuevo ya vinculado. */}
        <div className="mt-3 rounded-md border border-violet-200 bg-violet-50 p-3">
          <p className="text-sm font-semibold text-violet-900">
            El conjunto de datos de esta cuenta de WhatsApp
          </p>
          <p className="mt-1 text-xs text-violet-800">
            Un pixel elegido de la lista puede no estar vinculado a tu cuenta de
            WhatsApp, y entonces Meta rechaza las compras de las conversaciones
            aunque todo parezca bien. Este pide a Meta el de esta cuenta: si ya
            hay uno lo usa, y si no, crea uno que nace vinculado.
          </p>
          <button
            type="button"
            onClick={() => void verDatasetWaba()}
            disabled={mirandoDataset || creandoDataset}
            className="mt-2 rounded-md border border-violet-300 bg-tarjeta px-3 py-2 text-sm font-medium text-violet-800 hover:bg-violet-100 disabled:opacity-60"
          >
            {mirandoDataset ? "Consultando..." : "Ver el de esta cuenta"}
          </button>

          {resultadoDataset ? (
            <p className="mt-2 whitespace-pre-wrap rounded border border-violet-200 bg-tarjeta px-3 py-2 text-xs text-neutral-800">
              {resultadoDataset}
            </p>
          ) : null}

          {confirmarDataset ? (
            <div className="mt-2 rounded border border-amber-300 bg-amber-50 p-3 text-xs">
              <p className="font-medium text-amber-900">
                {datasetWaba?.datasetId
                  ? "No se crea nada: solo pasa a ser el conjunto de datos elegido."
                  : "Se creará un conjunto de datos nuevo en tu negocio. Los eventos ya enviados se quedan en el anterior, no se mudan."}
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmarDataset(false)}
                  className="rounded border border-neutral-300 bg-tarjeta px-3 py-1.5 font-medium text-neutral-700"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => void crearDatasetWaba()}
                  disabled={creandoDataset}
                  className="rounded bg-amber-600 px-3 py-1.5 font-medium text-white hover:bg-amber-700 disabled:opacity-60"
                >
                  {creandoDataset ? "Trabajando..." : "Sí, continuar"}
                </button>
              </div>
            </div>
          ) : null}
        </div>

        {capi ? (
          <div className="mt-4 border-t border-neutral-100 pt-4">
            <h3 className="text-sm font-semibold text-neutral-950">
              Token que reporta las compras
            </h3>
            <p className="mt-1 text-sm text-neutral-600">
              Al conectar con Meta ya se obtiene un token con permiso sobre los
              datasets. Si sirve, no hace falta pegar ninguno ni ponerlo en
              EasyPanel.
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
              {(
                [
                  ["conexion", "El de la conexión con Meta", true],
                  ["variable", "La variable de entorno", capi.hayVariable],
                  ["manual", "Uno pegado a mano", true],
                ] as const
              ).map(([origen, texto, disponible]) => (
                <button
                  key={origen}
                  type="button"
                  disabled={guardandoCapi || !disponible}
                  onClick={() => void guardarOrigenCapi(origen)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium disabled:opacity-40 ${
                    capi.origenElegido === origen
                      ? "border-blue-500 bg-blue-50 text-blue-800"
                      : "border-neutral-300 bg-tarjeta text-neutral-700 hover:bg-neutral-50"
                  }`}
                >
                  {texto}
                  {capi.origenEnUso === origen && !capi.origenElegido
                    ? " · en uso"
                    : ""}
                </button>
              ))}
            </div>

            <div className="mt-2 grid gap-2 md:grid-cols-[1fr_auto]">
              <input
                type="password"
                value={capiTokenManual}
                onChange={(event) => setCapiTokenManual(event.target.value)}
                placeholder={
                  capi.hayManual
                    ? "Hay un token guardado — pega otro para reemplazarlo"
                    : "Pega aquí un token, solo si eliges esa opción"
                }
                className="rounded border border-neutral-300 px-3 py-2 text-sm"
              />
              <button
                type="button"
                onClick={() => void probarCapi()}
                disabled={probandoCapi || !capi.hayToken}
                className="rounded border border-neutral-300 bg-tarjeta px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-40"
              >
                {probandoCapi ? "Probando..." : "Probar acceso"}
              </button>
            </div>

            <div className="mt-2 grid gap-2 md:grid-cols-[1fr_auto]">
              <input
                value={codigoDePrueba}
                onChange={(event) => setCodigoDePrueba(event.target.value)}
                placeholder="Código de prueba (Administrador de eventos → Probar eventos)"
                className="rounded border border-neutral-300 px-3 py-2 text-sm"
              />
            </div>

            <p className="mt-1 text-[11px] text-neutral-500">
              Sin código, la prueba solo LEE: pregunta si el token ve tu
              dataset. Con código hace la prueba definitiva — manda una compra
              de prueba — y Meta la deja en «Probar eventos»: no cuenta como
              venta ni ensucia tus datos.
            </p>

            {resultadoCapi ? (
              <p className="mt-2 rounded border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-800">
                {resultadoCapi}
              </p>
            ) : null}

            <div className="mt-4 rounded-md border border-sky-200 bg-sky-50 p-3">
              <p className="text-sm font-semibold text-sky-900">
                Dejar la app configurada
              </p>
              <p className="mt-1 text-xs text-sky-800">
                Le pone a tu app de Meta el dominio de este bot y sus webhooks,
                sin entrar al panel de desarrolladores. Lo único que Meta no
                deja tocar desde fuera es la URI de redireccionamiento.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void verConfigDeApp()}
                  className="rounded-md border border-sky-300 bg-tarjeta px-3 py-2 text-sm font-medium text-sky-800 hover:bg-sky-100"
                >
                  Ver lo que tiene ahora
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmarConfig(true)}
                  disabled={configurandoApp}
                  className="rounded-md bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-60"
                >
                  {configurandoApp ? "Configurando..." : "Configurar la app"}
                </button>
              </div>

              {confirmarConfig ? (
                <div className="mt-2 rounded border border-amber-300 bg-amber-50 p-3 text-xs">
                  <p className="font-medium text-amber-900">
                    Esto REESCRIBE el webhook de tu app, que es por donde entran
                    todos los mensajes. Si la dirección de este bot no está
                    respondiendo en este momento, Meta lo va a rechazar y el
                    webhook puede quedar sin configurar.
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirmarConfig(false)}
                      className="rounded border border-neutral-300 bg-tarjeta px-3 py-1.5 font-medium text-neutral-700"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={() => void configurarApp()}
                      className="rounded bg-amber-600 px-3 py-1.5 font-medium text-white hover:bg-amber-700"
                    >
                      Sí, configurar
                    </button>
                  </div>
                </div>
              ) : null}

              {resultadoConfig ? (
                <p className="mt-2 whitespace-pre-wrap rounded border border-neutral-200 bg-tarjeta px-3 py-2 text-xs text-neutral-800">
                  {resultadoConfig}
                </p>
              ) : null}

              {uriDeRedireccion ? (
                <div className="mt-2 rounded border border-neutral-200 bg-tarjeta px-3 py-2 text-xs">
                  <p className="font-medium text-neutral-800">
                    Lo único que queda a mano:
                  </p>
                  <p className="mt-1 text-neutral-600">
                    Pega esta URI en tu app, en Inicio de sesión con Facebook →
                    Configuración → URI de redireccionamiento válidos.
                  </p>
                  <code className="mt-1 block break-all rounded bg-neutral-50 p-2 text-[11px] text-neutral-800">
                    {uriDeRedireccion}
                  </code>
                </div>
              ) : null}

              {/* Si Meta no dejó escribir los datos básicos, al menos que no
                  haya que adivinar qué poner: van los tres valores exactos. */}
              {datosBasicos ? (
                <div className="mt-2 rounded border border-neutral-200 bg-tarjeta px-3 py-2 text-xs">
                  <p className="font-medium text-neutral-800">
                    Meta no dejó escribir los datos básicos
                  </p>
                  <p className="mt-1 text-neutral-600">
                    No afecta a los mensajes ni al registro de ventas: son
                    campos de papeleo para el App Review. Pégalos a mano en tu
                    app, en Configuración → Básica.
                  </p>
                  <p className="mt-2 text-neutral-500">Dominio de la app</p>
                  <code className="block break-all rounded bg-neutral-50 p-2 text-[11px] text-neutral-800">
                    {datosBasicos.dominio}
                  </code>
                  <p className="mt-2 text-neutral-500">URL del sitio web</p>
                  <code className="block break-all rounded bg-neutral-50 p-2 text-[11px] text-neutral-800">
                    {datosBasicos.sitioWeb}
                  </code>
                  <p className="mt-2 text-neutral-500">
                    URL de la política de privacidad
                  </p>
                  <code className="block break-all rounded bg-neutral-50 p-2 text-[11px] text-neutral-800">
                    {datosBasicos.politicaDePrivacidad}
                  </code>
                </div>
              ) : null}
            </div>

            <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-3">
              <p className="text-sm font-semibold text-emerald-900">
                Que no venza nunca
              </p>

              {/* Qué app está configurada y en qué negocio vive. Es lo que
                  decide si se puede generar el token: Meta solo deja hacerlo en
                  el negocio DUEÑO de la app. */}
              {appInfo ? (
                <div className="mt-2 rounded border border-emerald-200 bg-tarjeta px-3 py-2 text-xs">
                  <p className="text-neutral-800">
                    <span className="font-medium">App configurada:</span>{" "}
                    {appInfo.nombre ?? "(sin nombre)"}{" "}
                    <span className="text-neutral-500">({appInfo.appId})</span>
                  </p>
                  {appInfo.negocio ? (
                    <p className="mt-0.5 text-emerald-800">
                      Pertenece al negocio <b>{appInfo.negocio}</b> — el token se
                      va a generar ahí.
                    </p>
                  ) : (
                    <p className="mt-0.5 text-amber-800">
                      {appInfo.avisoNegocio ??
                        "No pude comprobar a qué negocio pertenece."}
                    </p>
                  )}
                </div>
              ) : null}
              <p className="mt-1 text-xs text-emerald-800">
                El token que trae la conexión dura unos 60 días. Este botón
                intenta generar uno permanente en tu negocio y lo guarda solo,
                para WhatsApp y para el reporte de compras. No tienes que pegar
                nada ni elegir permisos: pide todos los que el bot puede usar y,
                si tu app no tiene alguno aprobado, baja solo hasta la lista que
                sí acepte. Al final te dice cuáles consiguió.
              </p>
              <button
                type="button"
                onClick={() => void generarTokenPermanente()}
                disabled={generandoPermanente}
                className="mt-2 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {generandoPermanente
                  ? "Generando..."
                  : "Generar token permanente"}
              </button>
              {resultadoPermanente ? (
                <p className="mt-2 whitespace-pre-wrap rounded border border-neutral-200 bg-tarjeta px-3 py-2 text-xs text-neutral-800">
                  {resultadoPermanente}
                </p>
              ) : null}
            </div>

            <p className="mt-2 text-xs text-neutral-500">
              En uso ahora:{" "}
              {capi.origenEnUso
                ? NOMBRE_DEL_ORIGEN[capi.origenEnUso]
                : "ninguno — el bot no puede reportar compras"}
            </p>
          </div>
        ) : null}
        {/* LA MEDICIÓN DE CADA NEGOCIO. Vino de las tarjetas de arriba el 10/10/2026: ahí
            estorbaba a la diferenciación, y este es su sitio. Ver `MedicionPorCuenta`. */}
        <MedicionPorCuenta />
      </section>
      </SeccionEnVentana>

      {conexionFallo && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border-2 border-amber-400 bg-amber-50 p-3 text-sm text-amber-900">
          <span className="min-w-0 flex-1">
            ⚠ <b>La conexión automática no quedó lista:</b> los mensajes de WhatsApp de tu app no le llegan a este proyecto. Prueba
            otra vez con el asistente («🔑 Mi app»), o conéctalo a mano con los datos.
          </span>
          <button
            type="button"
            onClick={() => setVerAvanzado((v) => !v)}
            className="rounded-lg border border-amber-500 bg-white px-3 py-1.5 font-semibold hover:bg-amber-100"
          >
            {verAvanzado ? "Ocultar los datos" : "Mostrar datos para conectar a mano"}
          </button>
        </div>
      )}

      <SeccionEnVentana
        {...lugar(8)}
        oculta={lugar(8).oculta || !verAvanzado}
        titulo="Datos exactos para Meta"
        tono="bg-orange-200 text-orange-900"
        detalle="Las URLs y los verify tokens que pide Meta"
        icono="📋"
      >
      <section className="rounded-lg border border-neutral-200 bg-tarjeta p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-neutral-950">
          Datos exactos para Meta
        </h2>
        <div className="mt-3 grid gap-3 text-sm md:grid-cols-3">
          <div className="rounded-md bg-neutral-50 p-3">
            <p className="text-xs font-medium text-neutral-500">
              Webhook WhatsApp
            </p>
            <p className="mt-1 break-all font-mono text-xs text-neutral-800">
              {status?.webhookUrls.whatsapp ?? "Cargando..."}
            </p>
            {status?.webhookUrls.whatsapp ? (
              <button type="button" onClick={() => copyText("webhook-whatsapp", status.webhookUrls.whatsapp)} className="mt-2 rounded border border-neutral-300 px-2 py-1 text-[11px] font-medium text-neutral-700 hover:bg-tarjeta">
                {copied === "webhook-whatsapp" ? "Copiado" : "Copiar"}
              </button>
            ) : null}
          </div>
          <div className="rounded-md bg-neutral-50 p-3">
            <p className="text-xs font-medium text-neutral-500">
              Webhook Messenger
            </p>
            <p className="mt-1 break-all font-mono text-xs text-neutral-800">
              {status?.webhookUrls.messenger ?? "Cargando..."}
            </p>
            {status?.webhookUrls.messenger ? (
              <button type="button" onClick={() => copyText("webhook-messenger", status.webhookUrls.messenger)} className="mt-2 rounded border border-neutral-300 px-2 py-1 text-[11px] font-medium text-neutral-700 hover:bg-tarjeta">
                {copied === "webhook-messenger" ? "Copiado" : "Copiar"}
              </button>
            ) : null}
          </div>
          <div className="rounded-md bg-neutral-50 p-3">
            <p className="text-xs font-medium text-neutral-500">
              Webhook Instagram
            </p>
            <p className="mt-1 break-all font-mono text-xs text-neutral-800">
              {status?.webhookUrls.instagram ?? "Cargando..."}
            </p>
            {status?.webhookUrls.instagram ? (
              <button type="button" onClick={() => copyText("webhook-instagram", status.webhookUrls.instagram)} className="mt-2 rounded border border-neutral-300 px-2 py-1 text-[11px] font-medium text-neutral-700 hover:bg-tarjeta">
                {copied === "webhook-instagram" ? "Copiado" : "Copiar"}
              </button>
            ) : null}
          </div>
        </div>
        <div className="mt-3 grid gap-3 text-sm md:grid-cols-3">
          {([
            ["WhatsApp", status?.webhookTokens.whatsapp],
            ["Messenger", status?.webhookTokens.messenger],
            ["Instagram", status?.webhookTokens.instagram],
          ] as const).map(([channel, token]) => (
            <div key={channel} className="rounded-md border border-neutral-200 p-3">
              <p className="text-xs font-medium text-neutral-500">Verify Token {channel}</p>
              <div className="mt-1 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate text-xs text-neutral-800">
                  {showTokens ? token ?? "Aun no generado" : token ? "********" : "Aun no generado"}
                </code>
                {token ? (
                  <button
                    type="button"
                    onClick={() => copyText(`verify-${channel}`, token)}
                    className="rounded border border-neutral-300 px-2 py-1 text-[11px] font-medium text-neutral-700 hover:bg-neutral-50"
                  >
                    {copied === `verify-${channel}` ? "Copiado" : "Copiar"}
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs leading-5 text-neutral-500">
          Copia la URL y el Verify Token del canal en la configuracion de webhook
          de Meta. Esta confirmacion es manual porque Meta debe autorizar este dominio.
        </p>
      </section>
      </SeccionEnVentana>

      <SeccionEnVentana
        {...lugar(9)}
        oculta={lugar(9).oculta || !verAvanzado}
        titulo="Variables detectadas"
        tono="bg-cyan-200 text-cyan-900"
        detalle="El bloque listo para pegar en EasyPanel"
        icono="📥"
      >
      <section className="rounded-lg border border-emerald-200 bg-tarjeta p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-neutral-950">
              Variables detectadas
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-neutral-600">
              Este bloque es para copiar y pegar en EasyPanel si quieres dejar
              las variables escritas. Sale de lo que Meta permitio detectar.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
              onClick={() => setShowTokens((value) => !value)}
              type="button"
            >
              {showTokens ? "Ocultar tokens" : "Mostrar tokens"}
            </button>
            <button
              className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
              disabled={!status?.envExtractor.detectedEnvBlock.trim()}
              onClick={() =>
                status
                  ? copyText(
                      "detectadas",
                      status.envExtractor.detectedEnvBlock
                    )
                  : undefined
              }
              type="button"
            >
              {copied === "detectadas" ? "Copiado" : "Copiar detectadas"}
            </button>
          </div>
        </div>
        {/* Caja de código: fondo carbón en los dos temas, así que la letra
            tiene que ser blanca fija. Con un gris de la escala se volvería
            oscura en el tema oscuro y quedaría negro sobre negro. */}
        <textarea
          className="mt-3 h-64 w-full resize-y rounded-md border border-neutral-200 bg-carbon-fuerte p-3 font-mono text-xs leading-5 text-white outline-none"
          readOnly
          value={
            showTokens
              ? status?.envExtractor.detectedEnvBlock ?? ""
              : hiddenDetectedEnvBlock
          }
        />
        <p className="mt-2 text-xs text-neutral-500">
          Detectadas: {status?.envExtractor.detectedCount ?? 0}. Si WhatsApp o
          pixel salen vacios, Meta no los entrego con este login/permisos.
        </p>
      </section>
      </SeccionEnVentana>

      <SeccionEnVentana
        {...lugar(10)}
        oculta={lugar(10).oculta || !verAvanzado}
        titulo="Variables manuales"
        tono="bg-rose-200 text-rose-900"
        detalle="Las que el panel no puede sacar de Meta: las pones tú"
        icono="✍️"
      >
      <section className="rounded-lg border border-neutral-200 bg-tarjeta p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-neutral-950">
              Variables manuales
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-neutral-600">
              Estas siguen siendo claves privadas o servicios externos. Aqui te
              dejo el bloque armado para completar lo que falte.
            </p>
          </div>
          <button
            className="rounded-md bg-carbon-fuerte px-3 py-2 text-sm font-medium text-white hover:bg-carbon-suave disabled:opacity-60"
            disabled={!status?.envExtractor.manualEnvBlock.trim()}
            onClick={() =>
              status
                ? copyText("manuales", status.envExtractor.manualEnvBlock)
                : undefined
            }
            type="button"
          >
            {copied === "manuales" ? "Copiado" : "Copiar manuales"}
          </button>
        </div>
        <textarea
          className="mt-3 h-64 w-full resize-y rounded-md border border-neutral-200 bg-neutral-50 p-3 font-mono text-xs leading-5 text-neutral-800 outline-none"
          readOnly
          value={status?.envExtractor.manualEnvBlock ?? ""}
        />
      </section>
      </SeccionEnVentana>
      </div>
      ) : null}

      <RegistroDeMeta />

      {/* AQUÍ HABÍA UNA SEGUNDA PAREJA DE «Volver al chat / Ir al editor».
          Los mismos dos enlaces que ya están arriba, repetidos al final porque
          la pantalla era larguísima y había que desplazarse hasta abajo para
          salir. Con las once secciones plegadas, el final está a un palmo del
          principio y decirlo dos veces solo hace ruido. */}
    </main>
  );
}
