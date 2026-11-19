import { NextResponse } from "next/server";
import { listMetaWhatsAppConnections } from "@/lib/db";
import { getMetaAppId, graphVersion } from "@/lib/meta/connect";
import { fetchMeta } from "@/lib/meta/freno";
import { otrasApps } from "@/lib/meta/apps-de-meta";
import { negocioDeLaPrincipal } from "@/lib/meta/negocio-de-la-app";
import { permisosConocidos } from "@/lib/meta/token-por-numero";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 🩺 ¿POR QUÉ ESTÁ BLOQUEADO? (19/11/2026). Él, con 4 números bloqueados en dos días: «lo que quiero saber es por qué
 * se me ha bloqueado». El bot solo veía el código 131031 («Business Account locked»), que no dice el motivo.
 *
 * Meta tiene una consulta oficial, `health_status`, que dice por cada número si puede enviar y, si no, QUÉ lo bloquea
 * (el número, la cuenta de WhatsApp, el negocio o la app) con su código, su descripción y la solución que sugiere.
 * SOLO LEE: no cambia nada en Meta. Prueba con el permiso guardado del número y, si ése no alcanza, con los de
 * inicio de sesión de las cuentas de Facebook conectadas.
 */
interface Entidad {
  entity_type?: string;
  id?: string;
  can_send_message?: string;
  errors?: Array<{ error_code?: number; error_description?: string; possible_solution?: string }>;
  additional_info?: string[];
}
interface Respuesta {
  display_phone_number?: string;
  verified_name?: string;
  quality_rating?: string;
  status?: string;
  health_status?: { can_send_message?: string; entities?: Entidad[] };
  error?: { message?: string; code?: number };
}

async function leer(phoneNumberId: string, token: string): Promise<Respuesta> {
  const url = new URL(`https://graph.facebook.com/${graphVersion()}/${phoneNumberId}`);
  url.searchParams.set("fields", "display_phone_number,verified_name,quality_rating,status,health_status");
  url.searchParams.set("access_token", token);
  try {
    const res = await fetchMeta(url, { method: "GET" });
    return ((await res.json().catch(() => ({}))) ?? {}) as Respuesta;
  } catch (e) {
    return { error: { message: e instanceof Error ? e.message : "No se pudo consultar a Meta." } };
  }
}

/**
 * POR QUÉ PUERTA ENTRA CADA NÚMERO (19/11/2026). Él: «arréglalo» — que cada número entre por la app de su propio negocio.
 * Antes de mover nada hay que verlo: la cuenta de WhatsApp de un número está SUSCRITA a una o varias apps (por ahí le
 * llegan los mensajes al bot). Una app de OTRO negocio une los dos negocios ante Meta. Solo lee: `{waba}/subscribed_apps`.
 */
async function appsSuscritas(wabaId: string, tokens: string[]): Promise<Array<{ id: string; nombre: string | null }> | null> {
  for (const token of tokens) {
    try {
      const url = new URL(`https://graph.facebook.com/${graphVersion()}/${wabaId}/subscribed_apps`);
      url.searchParams.set("access_token", token);
      const res = await fetchMeta(url, { method: "GET" });
      const d = (await res.json().catch(() => ({}))) as { data?: Array<{ whatsapp_business_api_data?: { id?: string; name?: string } }>; error?: unknown };
      if (Array.isArray(d.data))
        return d.data.map((x) => ({ id: String(x.whatsapp_business_api_data?.id ?? ""), nombre: x.whatsapp_business_api_data?.name ?? null })).filter((x) => x.id);
    } catch {
      // se prueba con el siguiente permiso
    }
  }
  return null;
}

export async function GET() {
  const conexiones = listMetaWhatsAppConnections();
  const otros = permisosConocidos();
  // De qué negocio es cada app que conoce el bot (la principal y las otras de Meta Connect).
  const negocioDeApp = new Map<string, { id: string | null; nombre: string | null }>();
  const principal = getMetaAppId();
  const suNegocio = negocioDeLaPrincipal();
  if (principal) negocioDeApp.set(principal, { id: suNegocio?.id ?? null, nombre: suNegocio?.nombre ?? null });
  for (const a of otrasApps()) negocioDeApp.set(a.appId, { id: a.negocioId ?? null, nombre: a.negocio ?? null });
  const numeros = [];
  for (const c of conexiones) {
    let r: Respuesta = {};
    const tokens = [c.access_token, ...otros.filter((t) => t !== c.access_token)].filter((t): t is string => !!t);
    for (const token of tokens) {
      r = await leer(c.phone_number_id, token);
      if (r.health_status || !r.error) break;
    }
    const suscritas = await appsSuscritas(c.waba_id, tokens);
    const puertas = (suscritas ?? []).map((a) => {
      const dueño = negocioDeApp.get(a.id);
      return {
        appId: a.id,
        nombre: a.nombre,
        negocio: dueño?.nombre ?? null,
        // true = la app es del mismo negocio que el número; false = de otro; null = no se sabe (app que el bot no conoce).
        deSuNegocio: dueño?.id && c.business_id ? dueño.id === c.business_id : null,
      };
    });
    numeros.push({
      phoneNumberId: c.phone_number_id,
      wabaId: c.waba_id,
      negocio: c.business_name,
      numero: r.display_phone_number ?? c.display_phone_number,
      nombre: r.verified_name ?? c.verified_name,
      calidad: r.quality_rating ?? null,
      estado: r.status ?? null,
      puedeEnviar: r.health_status?.can_send_message ?? null,
      entidades: (r.health_status?.entities ?? []).map((e) => ({
        tipo: e.entity_type ?? "?",
        id: e.id ?? null,
        puedeEnviar: e.can_send_message ?? null,
        errores: (e.errors ?? []).map((x) => ({ codigo: x.error_code ?? null, descripcion: x.error_description ?? "", solucion: x.possible_solution ?? "" })),
        info: e.additional_info ?? [],
      })),
      error: r.health_status ? null : r.error?.message ?? null,
      puertas: suscritas ? puertas : null,
    });
  }
  return NextResponse.json({ numeros });
}
