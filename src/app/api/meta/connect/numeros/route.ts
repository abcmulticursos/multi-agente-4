import { NextResponse, type NextRequest } from "next/server";
import {
  getMetaWhatsAppConnection,
  listMetaWhatsAppConnections,
  saveMetaWhatsAppConnection,
} from "@/lib/db";
import { graphVersion, subscribeWhatsAppToWebhooks } from "@/lib/meta/connect";
import { getMetaAppId } from "@/lib/meta/runtime-config";
import { cuandoSeLeyo, MEDIA_HORA, olvidar, recordar } from "@/lib/meta/recuerdo";
import { fetchMeta, MetaFrenada, metaFrenada, minutosDeFreno } from "@/lib/meta/freno";
import { permisosConocidos } from "@/lib/meta/token-por-numero";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * AGREGAR Y ACTIVAR NÚMEROS DESDE META CONNECT, SIN ENTRAR A LA APP (20/10/2026).
 *
 * LO PIDIÓ EL DUEÑO: «entrar a una app a conectarlo, para un principiante, es un dolor de
 * cabeza». Hoy agrega el número en el WhatsApp Manager, sale «no está activo», y tiene que
 * entrar al panel de la app para activarlo. Meta lo permite por su API sin ser proveedor
 * oficial (verificado en su documentación: «Register a business phone number»), en cuatro
 * pasos: darlo de alta en la cuenta de WhatsApp de un negocio → pedir el código (SMS o
 * llamada) → escribir el código → registrarlo con un PIN de 6 dígitos (que además activa
 * la verificación en dos pasos).
 *
 * EL LÍMITE ES DEL NEGOCIO, NO DE LA APP: un negocio sin verificar admite 2 números; uno
 * verificado, hasta 20. Por eso se lista por negocio, con su estado de verificación.
 *
 * NO MIGRA NADA (regla de CLAUDE.md: «nunca automatizar migraciones de números»). Si el
 * número está en uso en otro WhatsApp, Meta lo rechaza y aquí solo se dice; no se fuerza.
 *
 * CON QUÉ PERMISO. Cada negocio se habla con un permiso que lo vea: el de su cuenta de
 * Facebook (las de «Agregar otra cuenta» también) o el de la conexión de siempre. Los
 * permisos nunca salen de aquí.
 *
 * SOLO LO QUE HACE FALTA (21/10/2026). Antes, abrir «Tus números» preguntaba por TODOS los BM,
 * todas sus cuentas de WhatsApp Business, sus números y sus apps (unas 50 llamadas), y cada paso
 * volvía a preguntarlo todo: Meta frenó la app («#4»). Ahora hay tres formas:
 *   · `?vista=bms`  → solo la lista de BM (1 llamada por cuenta de Facebook).
 *   · `?bm=ID`      → solo ese BM, con sus cuentas, números y apps (1 llamada).
 *   · sin nada      → todo, como antes: es «🔍 Revisar todo», solo cuando él lo pide.
 * Todo se recuerda media hora, y cada paso olvida solo su BM.
 */

type Graph = { error?: { message?: string; code?: number; error_subcode?: number; error_user_msg?: string } };

async function graph<T>(ruta: string, token: string, metodo: "GET" | "POST", params: Record<string, string> = {}): Promise<T & Graph> {
  const url = new URL(`https://graph.facebook.com/${graphVersion()}/${ruta}`);
  url.searchParams.set("access_token", token);
  if (metodo === "GET") for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  try {
    const res = await fetchMeta(url, {
      method: metodo,
      ...(metodo === "POST" ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(params) } : {}),
    });
    return ((await res.json().catch(() => ({}))) ?? {}) as T & Graph;
  } catch (e) {
    if (e instanceof MetaFrenada) return { error: { code: 4, message: e.message } } as T & Graph;
    return { error: { message: "No se pudo consultar a Meta." } } as T & Graph;
  }
}

/** El error de Meta, dicho simple. */
function errorDeMeta(e: Graph["error"]): string {
  const code = e?.code;
  const texto = e?.error_user_msg || e?.message || "Meta no respondió.";
  if (code === 4 || code === 17 || code === 32 || code === 613)
    return `Meta pidió una pausa por muchas consultas seguidas. No se rompió nada: espera ${Math.max(minutosDeFreno(), 15)} minutos.`;
  if (code === 136024) return "Ese número ya está verificado: pasa directo a activarlo.";
  if (code === 133006) return "Primero hay que verificar el número con el código.";
  if (code === 136025) return "El código no es correcto o ya venció. Pide otro.";
  if (code === 133005) return "El PIN no coincide con el que ya tenía el número.";
  if (code === 133010) return "El número todavía no está registrado.";
  if (/already.*(registered|exists|in use)|en uso/i.test(texto))
    return "Ese número ya está en uso en otro WhatsApp. Bórralo de ahí primero (aquí no se migra ni se fuerza nada).";
  return texto;
}

interface NumeroDeMeta {
  id: string;
  display_phone_number?: string;
  verified_name?: string;
  code_verification_status?: string;
  platform_type?: string;
  status?: string;
  name_status?: string;
}

type NumeroListado = { id: string; numero: string; nombre: string; estado: "activo" | "sin_activar" | "sin_verificar"; suscritoAqui: boolean };
type CuentaListada = {
  id: string;
  nombre: string;
  /** Las OTRAS apps que atienden esta cuenta de WhatsApp (20/10/2026): con dos, contestan dos bots. */
  otrasApps: string[];
  /** ¿La atiende ESTA app? (lo dice Meta, no lo guardado en el CRM). */
  estaApp: boolean;
  numeros: NumeroListado[];
};
type NegocioListado = { id: string; nombre: string; verificado: boolean; cuentas: CuentaListada[] };
type CuentaDeMeta = {
  id: string;
  name?: string;
  phone_numbers?: { data?: NumeroDeMeta[] };
  subscribed_apps?: { data?: Array<{ whatsapp_business_api_data?: { id?: string; name?: string } }> };
};
type BmDeMeta = { id: string; name?: string; verification_status?: string };

/** Qué permiso sirve para cada BM, cuenta de WhatsApp Business y número (se llena al listar). */
const permisoDe = new Map<string, string>();
/** De qué cuenta es cada número, y de qué BM cada cuenta. */
const cuentaDe = new Map<string, string>();
const negocioDeLaCuenta = new Map<string, { id: string; nombre: string }>();

const CAMPOS_NUMERO = "id,display_phone_number,verified_name,code_verification_status,platform_type,status,name_status";
const CAMPOS_CUENTA = `id,name,phone_numbers.limit(100){${CAMPOS_NUMERO}},subscribed_apps{whatsapp_business_api_data}`;

/** Una cuenta de WhatsApp Business de Meta, como la ve la pantalla. */
function comoCuenta(waba: CuentaDeMeta, token: string, negocio: { id: string; nombre: string }): CuentaListada {
  // QUÉ OTRAS APPS ATIENDEN CADA CUENTA DE WHATSAPP (20/10/2026): «no quiero tener problemas
  // con duplicidad». Meta suscribe la cuenta entera; con dos apps, a cada cliente le
  // contestarían dos bots. Solo se lee.
  // «WA DevX Webhook Events 1P App» y parecidas son apps INTERNAS de Meta, puestas en casi
  // todas las cuentas: no son otro bot y no contestan a nadie. No cuentan.
  const nuestraApp = getMetaAppId();
  const guardados = new Set(listMetaWhatsAppConnections().map((n) => n.phone_number_id));
  const apps = (waba.subscribed_apps?.data ?? []).map((a) => a.whatsapp_business_api_data).filter((a) => !!a?.id);
  permisoDe.set(waba.id, token);
  negocioDeLaCuenta.set(waba.id, negocio);
  return {
    id: waba.id,
    nombre: waba.name ?? waba.id,
    otrasApps: apps
      .filter((a) => a?.id !== nuestraApp)
      .map((a) => a?.name || a?.id || "otra app")
      .filter((nombre) => !/WA DevX|1P App|Meta Internal/i.test(nombre)),
    estaApp: apps.some((a) => a?.id === nuestraApp),
    numeros: (waba.phone_numbers?.data ?? [])
      .filter((n) => !/test number/i.test(n.verified_name ?? ""))
      .map((n) => {
        permisoDe.set(n.id, token);
        cuentaDe.set(n.id, waba.id);
        // ACTIVO: registrado en la nube de Meta. «CONNECTED» también lo dice (21/10/2026: un
        // número ya activo salía con «Verificar y activar»).
        const activo = n.platform_type === "CLOUD_API" || n.status === "CONNECTED";
        const verificado = n.code_verification_status === "VERIFIED";
        return {
          id: n.id,
          numero: n.display_phone_number ?? n.id,
          nombre: n.verified_name ?? "",
          estado: activo ? ("activo" as const) : verificado ? ("sin_activar" as const) : ("sin_verificar" as const),
          suscritoAqui: guardados.has(n.id),
        };
      }),
  };
}

/** SOLO LA LISTA DE BM, sin nada de dentro: 1 llamada por cuenta de Facebook. */
async function listarBms(): Promise<Array<{ id: string; nombre: string; verificado: boolean }>> {
  const vistos = new Map<string, { id: string; nombre: string; verificado: boolean }>();
  for (const token of permisosConocidos()) {
    const r = await graph<{ data?: BmDeMeta[] }>("me/businesses", token, "GET", { fields: "id,name,verification_status", limit: "200" });
    // Con Meta frenada no se finge una lista vacía («No veo BM» confundiría): se dice que espere.
    if (r.error && [4, 17, 32, 613].includes(r.error.code ?? 0)) throw new Error(errorDeMeta(r.error));
    for (const b of r.data ?? []) {
      if (vistos.has(b.id)) continue;
      permisoDe.set(b.id, token);
      vistos.set(b.id, { id: b.id, nombre: b.name ?? b.id, verificado: b.verification_status === "verified" });
    }
  }
  return [...vistos.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" }));
}

/** SOLO UN BM, con sus cuentas de WhatsApp Business, números y apps: 1 llamada. */
async function listarUnBm(bm: { id: string; nombre: string; verificado: boolean }): Promise<NegocioListado> {
  const token = permisoDe.get(bm.id);
  if (!token) return { ...bm, cuentas: [] };
  const w = await graph<{ data?: CuentaDeMeta[] }>(`${bm.id}/owned_whatsapp_business_accounts`, token, "GET", {
    fields: CAMPOS_CUENTA,
    limit: "100",
  });
  if (w.error) throw new Error(errorDeMeta(w.error));
  return { ...bm, cuentas: (w.data ?? []).map((waba) => comoCuenta(waba, token, { id: bm.id, nombre: bm.nombre })) };
}

/** «🔍 REVISAR TODO»: todos los BM con todo lo de dentro. Solo cuando él lo pide. */
async function listarTodo(): Promise<NegocioListado[]> {
  const bms = await recordar("numeros:bms", MEDIA_HORA, listarBms);
  return Promise.all(bms.map((b) => recordar(`numeros:bm:${b.id}`, MEDIA_HORA, () => listarUnBm(b))));
}

/** Lo que cambió un paso: se olvida SOLO su BM (y la lista entera, que lo incluye). */
function olvidarElBmDe(id: string) {
  const waba = cuentaDe.get(id) ?? id;
  const bm = negocioDeLaCuenta.get(waba)?.id ?? id;
  olvidar(`numeros:bm:${bm}`);
}

export async function GET(req: NextRequest) {
  if (permisosConocidos().length === 0) {
    return NextResponse.json({ ok: false, error: "Primero conecta con Facebook (iniciar sesión)." });
  }
  const p = req.nextUrl.searchParams;
  const fresco = p.get("fresco") === "1";
  if (metaFrenada() && fresco) {
    return NextResponse.json({ ok: false, frenado: true, error: errorDeMeta({ code: 4 }) });
  }
  try {
    if (p.get("vista") === "bms") {
      if (fresco) olvidar("numeros:bms");
      const bms = await recordar("numeros:bms", MEDIA_HORA, listarBms);
      return NextResponse.json({ ok: true, bms, desde: cuandoSeLeyo("numeros:bms") }, { headers: { "Cache-Control": "no-store" } });
    }
    const idBm = p.get("bm");
    if (idBm) {
      if (fresco) olvidar(`numeros:bm:${idBm}`);
      const bms = await recordar("numeros:bms", MEDIA_HORA, listarBms);
      const bm = bms.find((b) => b.id === idBm);
      if (!bm) return NextResponse.json({ ok: false, error: "No veo ese BM con tus permisos. Inicia sesión con la cuenta de Facebook que lo administra." });
      const negocio = await recordar(`numeros:bm:${idBm}`, MEDIA_HORA, () => listarUnBm(bm));
      return NextResponse.json({ ok: true, negocio, desde: cuandoSeLeyo(`numeros:bm:${idBm}`) }, { headers: { "Cache-Control": "no-store" } });
    }
    if (fresco) olvidar("numeros");
    const negocios = await listarTodo();
    return NextResponse.json({ ok: true, negocios, desde: cuandoSeLeyo("numeros:bms") }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ ok: false, frenado: metaFrenada(), error: e instanceof Error ? e.message : "No se pudo consultar a Meta." });
  }
}

export async function POST(req: NextRequest) {
  const c = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const texto = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const accion = texto(c?.accion);
  // El permiso del BM, de la cuenta de WhatsApp Business o del número. Si el servidor se
  // reinició y no lo tiene, se relee solo lo necesario.
  const permisoPara = async (id: string) => {
    if (!permisoDe.has(id)) {
      const bms = await recordar("numeros:bms", MEDIA_HORA, listarBms);
      if (!permisoDe.has(id)) await Promise.all(bms.map((b) => recordar(`numeros:bm:${b.id}`, MEDIA_HORA, () => listarUnBm(b))));
    }
    return permisoDe.get(id) ?? null;
  };

  if (accion === "agregar") {
    const wabaId = texto(c?.wabaId);
    const cc = texto(c?.cc).replace(/\D/g, "");
    const numero = texto(c?.numero).replace(/\D/g, "");
    const nombre = texto(c?.nombre);
    if (!wabaId || !cc || !numero || !nombre)
      return NextResponse.json({ ok: false, error: "Falta el negocio, el código de país, el número o el nombre visible." });
    const token = await permisoPara(wabaId);
    if (!token) return NextResponse.json({ ok: false, error: "No tengo permiso sobre ese negocio. Inicia sesión con la cuenta de Facebook que lo administra." });
    const r = await graph<{ id?: string }>(`${wabaId}/phone_numbers`, token, "POST", { cc, phone_number: numero, verified_name: nombre });
    if (!r.id) return NextResponse.json({ ok: false, error: errorDeMeta(r.error) });
    permisoDe.set(r.id, token);
    cuentaDe.set(r.id, wabaId);
    olvidarElBmDe(wabaId);
    return NextResponse.json({ ok: true, phoneNumberId: r.id });
  }

  if (accion === "pedirCodigo") {
    const id = texto(c?.phoneNumberId);
    const metodo = texto(c?.metodo) === "VOICE" ? "VOICE" : "SMS";
    const token = id ? await permisoPara(id) : null;
    if (!token) return NextResponse.json({ ok: false, error: "No encuentro ese número en tus negocios." });
    const r = await graph<{ success?: boolean }>(`${id}/request_code`, token, "POST", { code_method: metodo, language: "es" });
    // «YA ESTÁ VERIFICADO» NO ES UN ERROR (21/10/2026): Meta a veces lista el número como sin
    // verificar y, al pedir el código, dice que ya lo está. Se le dice a la pantalla que pase al
    // PIN; antes se quedaba en un mensaje sin salida, o se cerraba.
    if (r.error?.code === 136024) return NextResponse.json({ ok: true, yaVerificado: true });
    if (!r.success) return NextResponse.json({ ok: false, error: errorDeMeta(r.error) });
    return NextResponse.json({ ok: true });
  }

  if (accion === "verificar") {
    const id = texto(c?.phoneNumberId);
    const codigo = texto(c?.codigo).replace(/\D/g, "");
    const token = id ? await permisoPara(id) : null;
    if (!token) return NextResponse.json({ ok: false, error: "No encuentro ese número en tus negocios." });
    if (!codigo) return NextResponse.json({ ok: false, error: "Escribe el código que te llegó." });
    const r = await graph<{ success?: boolean }>(`${id}/verify_code`, token, "POST", { code: codigo });
    if (r.error?.code === 136024) return NextResponse.json({ ok: true, yaVerificado: true });
    if (!r.success) return NextResponse.json({ ok: false, error: errorDeMeta(r.error) });
    olvidarElBmDe(id);
    return NextResponse.json({ ok: true });
  }

  if (accion === "activar" || accion === "traer") {
    const id = texto(c?.phoneNumberId);
    const token = id ? await permisoPara(id) : null;
    if (!token) return NextResponse.json({ ok: false, error: "No encuentro ese número en tus negocios." });
    // «traer»: un número que YA está activo en Meta y todavía no está en Meta Connect.
    if (accion === "activar") {
      const pin = texto(c?.pin).replace(/\D/g, "");
      if (pin.length !== 6) return NextResponse.json({ ok: false, error: "El PIN tiene que tener 6 números." });
      const r = await graph<{ success?: boolean }>(`${id}/register`, token, "POST", { messaging_product: "whatsapp", pin });
      if (!r.success) return NextResponse.json({ ok: false, error: errorDeMeta(r.error) });
    }
    // Y queda en Meta Connect, suscrito a esta app, listo para usarse (sin hacerlo el activo).
    const datos = await graph<{ display_phone_number?: string; verified_name?: string }>(id, token, "GET", {
      fields: "display_phone_number,verified_name",
    });
    const wabaId = cuentaDe.get(id) ?? "";
    const negocio = wabaId ? negocioDeLaCuenta.get(wabaId) ?? null : null;
    if (wabaId) {
      await subscribeWhatsAppToWebhooks({ wabaId, accessToken: token });
      saveMetaWhatsAppConnection({
        phoneNumberId: id,
        wabaId,
        displayPhoneNumber: datos.display_phone_number ?? null,
        verifiedName: datos.verified_name ?? null,
        profilePictureUrl: null,
        accessToken: token,
        active: false,
        businessId: negocio?.id ?? null,
        businessName: negocio?.nombre ?? null,
        // (Uno que ya estaba guardado conserva con quién está compartido.)
        compartidoCon: getMetaWhatsAppConnection(id) ? null : negocio ? [negocio] : null,
      });
      olvidarElBmDe(id);
      // Un número nuevo en el CRM: el paso del token y «qué app lo atiende» deben verlo.
      olvidar("token-estado");
      olvidar("suscribir");
    }
    return NextResponse.json({ ok: true });
  }

  // DAR DE BAJA EN META (21/10/2026): el número deja de funcionar en TODAS las apps hasta
  // volver a activarlo con su PIN. No lo borra de la lista de Meta: eso solo se puede en el
  // WhatsApp Manager (Meta no ofrece borrarlo por programa).
  if (accion === "darDeBaja") {
    const id = texto(c?.phoneNumberId);
    const token = id ? await permisoPara(id) : null;
    if (!token) return NextResponse.json({ ok: false, error: "No encuentro ese número en tus negocios." });
    const r = await graph<{ success?: boolean }>(`${id}/deregister`, token, "POST", {});
    if (!r.success) return NextResponse.json({ ok: false, error: errorDeMeta(r.error) });
    olvidarElBmDe(id);
    olvidar("suscribir");
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: false, error: "Acción desconocida." }, { status: 400 });
}
