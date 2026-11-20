import { listMetaWhatsAppConnections } from "@/lib/db";
import { graphVersion } from "@/lib/meta/connect";
import { fetchMeta } from "@/lib/meta/freno";
import { permisosConocidos, tokensPermanentes } from "@/lib/meta/token-por-numero";

/**
 * DESCONECTAR TAMBIÉN EN META (19/11/2026). Él: «si conecto app tienen números, si quito app ya no tiene números…
 * ¿hiciste una desconexión cosmética?». Sí: «Desconectar» (app, cuenta de Facebook, número) solo borraba la lista del
 * bot; en Meta la app seguía SUSCRITA a la cuenta de WhatsApp (`{waba}/subscribed_apps`), le seguían llegando sus
 * mensajes y Meta seguía viendo unidos los negocios. Aquí se deshace en Meta lo que se hizo al conectar.
 *
 * Meta solo deja que una app se quite a sí misma: `DELETE {waba}/subscribed_apps` quita la app DUEÑA del permiso con
 * que se pide. Por eso se busca, entre los permisos que guarda el bot, uno de ESA app (`GET /app`). Sin ninguno, no se
 * puede desde aquí y se dice cuál (se quita en developers.facebook.com).
 */
export type Desenchufe = {
  wabaId: string;
  appId: string;
  nombreApp: string | null;
  ok: boolean;
  error?: string;
};

/** Todos los permisos que guarda el bot, sin repetir. */
export function todosLosPermisos(): string[] {
  return [
    ...new Set(
      [...permisosConocidos(), ...tokensPermanentes(), ...listMetaWhatsAppConnections().map((c) => c.access_token)].filter(
        (t): t is string => !!t
      )
    ),
  ];
}

/** De qué app es cada permiso: { appId → sus permisos }. */
export async function permisosPorApp(permisos = todosLosPermisos()): Promise<Map<string, string[]>> {
  const porApp = new Map<string, string[]>();
  for (const token of permisos) {
    try {
      const url = new URL(`https://graph.facebook.com/${graphVersion()}/app`);
      url.searchParams.set("access_token", token);
      const d = (await (await fetchMeta(url, { method: "GET" })).json().catch(() => ({}))) as { id?: string };
      const id = String(d.id ?? "");
      if (id) porApp.set(id, [...(porApp.get(id) ?? []), token]);
    } catch {
      // un permiso vencido no cuenta
    }
  }
  return porApp;
}

/** Las apps suscritas a una cuenta de WhatsApp. null = ningún permiso pudo leerlo. */
export async function appsSuscritas(wabaId: string, permisos: string[]): Promise<Array<{ id: string; nombre: string | null }> | null> {
  for (const token of permisos) {
    try {
      const url = new URL(`https://graph.facebook.com/${graphVersion()}/${wabaId}/subscribed_apps`);
      url.searchParams.set("access_token", token);
      const d = (await (await fetchMeta(url, { method: "GET" })).json().catch(() => ({}))) as {
        data?: Array<{ whatsapp_business_api_data?: { id?: string; name?: string } }>;
      };
      if (Array.isArray(d.data))
        return d.data
          .map((x) => ({ id: String(x.whatsapp_business_api_data?.id ?? ""), nombre: x.whatsapp_business_api_data?.name ?? null }))
          .filter((x) => x.id);
    } catch {
      // se prueba con el siguiente permiso
    }
  }
  return null;
}

/** El negocio (BM) dueño de una app, buscado con las cuentas de Facebook conectadas. null = no se sabe. */
export async function negocioDeUnaApp(appId: string, permisos = permisosConocidos()): Promise<{ id: string; nombre: string | null } | null> {
  for (const token of permisos) {
    try {
      const url = new URL(`https://graph.facebook.com/${graphVersion()}/me/businesses`);
      url.searchParams.set("fields", "id,name,owned_apps.limit(200){id}");
      url.searchParams.set("limit", "200");
      url.searchParams.set("access_token", token);
      const d = (await (await fetchMeta(url, { method: "GET" })).json().catch(() => ({}))) as {
        data?: Array<{ id?: string; name?: string; owned_apps?: { data?: Array<{ id?: string }> } }>;
      };
      const dueño = (d.data ?? []).find((b) => (b.owned_apps?.data ?? []).some((a) => a.id === appId));
      if (dueño?.id) return { id: dueño.id, nombre: dueño.name ?? null };
    } catch {
      // se prueba con el siguiente permiso
    }
  }
  return null;
}

/** Quita cada app de cada cuenta de WhatsApp indicada, con un permiso de esa misma app. */
export async function desenchufar(
  pares: Array<{ wabaId: string; appId: string; nombreApp?: string | null }>,
  porApp?: Map<string, string[]>
): Promise<Desenchufe[]> {
  const permisos = porApp ?? (await permisosPorApp());
  const hechos: Desenchufe[] = [];
  for (const p of pares) {
    const suyos = permisos.get(p.appId) ?? [];
    const base = { wabaId: p.wabaId, appId: p.appId, nombreApp: p.nombreApp ?? null };
    if (suyos.length === 0) {
      hechos.push({ ...base, ok: false, error: "el bot no tiene un permiso de esa app" });
      continue;
    }
    let error = "Meta no la quitó";
    let ok = false;
    for (const token of suyos) {
      try {
        const url = new URL(`https://graph.facebook.com/${graphVersion()}/${p.wabaId}/subscribed_apps`);
        url.searchParams.set("access_token", token);
        const r = (await (await fetchMeta(url, { method: "DELETE" })).json().catch(() => ({}))) as {
          success?: boolean;
          error?: { message?: string };
        };
        if (r.success) {
          ok = true;
          break;
        }
        error = r.error?.message ?? error;
      } catch (e) {
        error = e instanceof Error ? e.message : error;
      }
    }
    if (ok) console.log(`[meta-connect] cuenta de WhatsApp ${p.wabaId}: se desconectó en Meta la app ${p.nombreApp ?? p.appId}`);
    hechos.push(ok ? { ...base, ok } : { ...base, ok, error });
  }
  return hechos;
}

/**
 * Desconecta en Meta las apps indicadas de las cuentas de WhatsApp que se dejan de usar. Una cuenta de WhatsApp que
 * todavía tiene OTRO número guardado en el bot no se toca (ese número seguiría recibiendo por ahí).
 */
export async function desenchufarCuentasQueSeDejan(
  numerosQueSeQuitan: string[],
  apps: string[]
): Promise<Desenchufe[]> {
  const quitar = new Set(numerosQueSeQuitan);
  const todas = listMetaWhatsAppConnections();
  const wabas = [...new Set(todas.filter((c) => quitar.has(c.phone_number_id)).map((c) => c.waba_id))].filter(
    (w) => !todas.some((c) => c.waba_id === w && !quitar.has(c.phone_number_id))
  );
  if (wabas.length === 0 || apps.length === 0) return [];
  const permisos = todosLosPermisos();
  const porApp = await permisosPorApp(permisos);
  const pares: Array<{ wabaId: string; appId: string; nombreApp: string | null }> = [];
  for (const w of wabas) {
    const suscritas = (await appsSuscritas(w, permisos)) ?? [];
    for (const a of suscritas) if (apps.includes(a.id)) pares.push({ wabaId: w, appId: a.id, nombreApp: a.nombre });
  }
  return desenchufar(pares, porApp);
}

/** El texto de lo que no se pudo, con el número de cada cuenta de WhatsApp. */
export function loQueNoSePudo(hechos: Desenchufe[]): string {
  const todas = listMetaWhatsAppConnections();
  return hechos
    .filter((h) => !h.ok)
    .map((h) => {
      const nums = todas.filter((c) => c.waba_id === h.wabaId).map((c) => c.display_phone_number ?? c.phone_number_id);
      return `• ${h.nombreApp ?? h.appId} en ${nums.join(", ") || `la cuenta de WhatsApp ${h.wabaId}`}: ${h.error ?? "no se pudo"}`;
    })
    .join("\n");
}
