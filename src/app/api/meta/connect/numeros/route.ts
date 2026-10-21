import { NextResponse, type NextRequest } from "next/server";
import {
  getMetaWhatsAppConnection,
  listMetaWhatsAppConnections,
  permisosDeTodasLasCuentas,
  saveMetaWhatsAppConnection,
} from "@/lib/db";
import { graphVersion, subscribeWhatsAppToWebhooks } from "@/lib/meta/connect";
import { getMetaAppId, getTokenDeLaConexion } from "@/lib/meta/runtime-config";
import { MINUTOS, olvidar, recordar } from "@/lib/meta/recuerdo";

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
 */

type Graph = { error?: { message?: string; code?: number; error_subcode?: number; error_user_msg?: string } };

async function graph<T>(ruta: string, token: string, metodo: "GET" | "POST", params: Record<string, string> = {}): Promise<T & Graph> {
  const url = new URL(`https://graph.facebook.com/${graphVersion()}/${ruta}`);
  url.searchParams.set("access_token", token);
  if (metodo === "GET") for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method: metodo,
    cache: "no-store",
    ...(metodo === "POST"
      ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(params) }
      : {}),
  });
  return ((await res.json().catch(() => ({}))) ?? {}) as T & Graph;
}

/** El error de Meta, dicho simple. */
function errorDeMeta(e: Graph["error"]): string {
  const code = e?.code;
  const texto = e?.error_user_msg || e?.message || "Meta no respondió.";
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

/** Qué permiso sirve para cada negocio, cuenta de WhatsApp y número (se llena al listar). */
const permisoDe = new Map<string, string>();

function permisosConocidos(): string[] {
  const lista = [getTokenDeLaConexion(), ...permisosDeTodasLasCuentas().map((p) => p.token)].filter(
    (t): t is string => !!t
  );
  return [...new Set(lista)];
}

async function listar() {
  const negocios = new Map<
    string,
    {
      id: string;
      nombre: string;
      verificado: boolean;
      cuentas: Array<{
        id: string;
        nombre: string;
        /** Las OTRAS apps que atienden esta cuenta de WhatsApp (20/10/2026): con dos, contestan dos bots. */
        otrasApps: string[];
        /** ¿La atiende ESTA app? (lo dice Meta, no lo guardado en el CRM). */
        estaApp: boolean;
        numeros: Array<{ id: string; numero: string; nombre: string; estado: "activo" | "sin_activar" | "sin_verificar"; suscritoAqui: boolean }>;
      }>;
    }
  >();
  const guardados = new Set(listMetaWhatsAppConnections().map((n) => n.phone_number_id));
  for (const token of permisosConocidos()) {
    const r = await graph<{ data?: Array<{ id: string; name?: string; verification_status?: string }> }>("me/businesses", token, "GET", {
      fields: "id,name,verification_status",
      limit: "200",
    });
    for (const b of r.data ?? []) {
      if (negocios.has(b.id)) continue;
      permisoDe.set(b.id, token);
      const w = await graph<{ data?: Array<{ id: string; name?: string; phone_numbers?: { data?: NumeroDeMeta[] } }> }>(
        `${b.id}/owned_whatsapp_business_accounts`,
        token,
        "GET",
        { fields: "id,name,phone_numbers{id,display_phone_number,verified_name,code_verification_status,platform_type,status,name_status}" }
      );
      // QUÉ OTRAS APPS ATIENDEN CADA CUENTA DE WHATSAPP (20/10/2026): «no quiero tener problemas
      // con duplicidad». Meta suscribe la cuenta entera; con dos apps, a cada cliente le
      // contestarían dos bots. Solo se lee.
      // «WA DevX Webhook Events 1P App» y parecidas son apps INTERNAS de Meta, puestas en casi
      // todas las cuentas: no son otro bot y no contestan a nadie. No cuentan.
      const nuestraApp = getMetaAppId();
      const esDeMeta = (nombre: string) => /WA DevX|1P App|Meta Internal/i.test(nombre);
      const otrasAppsDe = new Map<string, string[]>();
      const estaAppEn = new Set<string>();
      await Promise.all(
        (w.data ?? []).map(async (waba) => {
          const s = await graph<{ data?: Array<{ whatsapp_business_api_data?: { id?: string; name?: string } }> }>(
            `${waba.id}/subscribed_apps`,
            token,
            "GET"
          );
          const apps = (s.data ?? []).map((a) => a.whatsapp_business_api_data).filter((a) => !!a?.id);
          if (apps.some((a) => a?.id === nuestraApp)) estaAppEn.add(waba.id);
          otrasAppsDe.set(
            waba.id,
            apps
              .filter((a) => a?.id !== nuestraApp)
              .map((a) => a?.name || a?.id || "otra app")
              .filter((nombre) => !esDeMeta(nombre))
          );
        })
      );
      negocios.set(b.id, {
        id: b.id,
        nombre: b.name ?? b.id,
        verificado: b.verification_status === "verified",
        cuentas: (w.data ?? []).map((waba) => {
          permisoDe.set(waba.id, token);
          return {
            id: waba.id,
            nombre: waba.name ?? waba.id,
            otrasApps: otrasAppsDe.get(waba.id) ?? [],
            estaApp: estaAppEn.has(waba.id),
            numeros: (waba.phone_numbers?.data ?? [])
              .filter((n) => !/test number/i.test(n.verified_name ?? ""))
              .map((n) => {
                permisoDe.set(n.id, token);
                const activo = n.platform_type === "CLOUD_API";
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
        }),
      });
    }
  }
  return [...negocios.values()];
}

export async function GET(req: NextRequest) {
  if (permisosConocidos().length === 0) {
    return NextResponse.json({ ok: false, error: "Primero conecta con Facebook (iniciar sesión)." });
  }
  try {
    // RECORDADO 5 MINUTOS (21/10/2026): listar recorre todos los BM y cuentas de WhatsApp
    // Business, y repetirlo en cada apertura hizo que Meta frenara la app («#4»). «?fresco=1»
    // (el botón de actualizar) lo lee de nuevo. Las acciones de abajo lo olvidan solas.
    if (req.nextUrl.searchParams.get("fresco") === "1") olvidar("numeros");
    const negocios = await recordar("numeros", MINUTOS(5), listar);
    return NextResponse.json({ ok: true, negocios }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, error: "No se pudo consultar a Meta." });
  }
}

export async function POST(req: NextRequest) {
  const c = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const texto = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const accion = texto(c?.accion);
  // Toda acción cambia algo en Meta: lo recordado deja de valer.
  olvidar("numeros");
  olvidar("token-estado");
  // El permiso del negocio, de la cuenta de WhatsApp o del número; si no se listó aún, se lista.
  const permisoPara = async (id: string) => {
    if (!permisoDe.has(id)) await listar();
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
    return NextResponse.json({ ok: true, phoneNumberId: r.id });
  }

  if (accion === "pedirCodigo") {
    const id = texto(c?.phoneNumberId);
    const metodo = texto(c?.metodo) === "VOICE" ? "VOICE" : "SMS";
    const token = id ? await permisoPara(id) : null;
    if (!token) return NextResponse.json({ ok: false, error: "No encuentro ese número en tus negocios." });
    const r = await graph<{ success?: boolean }>(`${id}/request_code`, token, "POST", { code_method: metodo, language: "es" });
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
    if (!r.success) return NextResponse.json({ ok: false, error: errorDeMeta(r.error) });
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
    let wabaId = "";
    const negocios = await listar();
    let negocio: { id: string; nombre: string } | null = null;
    for (const n of negocios)
      for (const cuenta of n.cuentas)
        if (cuenta.numeros.some((x) => x.id === id)) {
          wabaId = cuenta.id;
          negocio = { id: n.id, nombre: n.nombre };
        }
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
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: false, error: "Acción desconocida." }, { status: 400 });
}
