import { createHmac } from "node:crypto";
import {
  getMetaRuntimeSetting,
  listMetaWhatsAppConnections,
  permisosDeTodasLasCuentas,
  ponerTokenPermanenteAlNumero,
  type MetaWhatsAppConnectionRow,
} from "@/lib/db";
import { graphVersion } from "@/lib/meta/connect";
import { getMetaOAuthAppSecret, getTokenDeLaConexion } from "@/lib/meta/runtime-config";

/**
 * CADA NÚMERO CON EL TOKEN PERMANENTE DE SU BM (21/10/2026).
 *
 * «Para usar los números del otro usuario… crear el token permanente, que no reemplazará al
 * tuyo sino que servirá para darte acceso a sus activos.» El token permanente es de UN BM y solo
 * alcanza los números de ese BM. Así que no se guarda uno para todo: se le pregunta a Meta, con
 * ese token, por los números de cada cuenta de WhatsApp Business, y se le pone solo a los que
 * alcanza. El de otro BM no pisa el tuyo.
 */
export async function numerosQueAlcanza(token: string): Promise<MetaWhatsAppConnectionRow[]> {
  const secreto = getMetaOAuthAppSecret();
  const conexiones = listMetaWhatsAppConnections();
  const porCuenta = new Map<string, Promise<string[]>>();
  for (const c of conexiones) {
    if (porCuenta.has(c.waba_id)) continue;
    porCuenta.set(c.waba_id, idsDeLaCuenta(c.waba_id, token, secreto));
  }
  const resultado: MetaWhatsAppConnectionRow[] = [];
  for (const c of conexiones) {
    if ((await porCuenta.get(c.waba_id))?.includes(c.phone_number_id)) resultado.push(c);
  }
  return resultado;
}

async function idsDeLaCuenta(wabaId: string, token: string, secreto: string | null): Promise<string[]> {
  try {
    const url = new URL(`https://graph.facebook.com/${graphVersion()}/${wabaId}/phone_numbers`);
    url.searchParams.set("fields", "id");
    url.searchParams.set("limit", "100");
    url.searchParams.set("access_token", token);
    if (secreto) url.searchParams.set("appsecret_proof", createHmac("sha256", secreto).update(token).digest("hex"));
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return [];
    const d = (await r.json()) as { data?: Array<{ id?: string }> };
    return (d.data ?? []).map((n) => String(n.id));
  } catch {
    return [];
  }
}

/** Le pone `token` a los números que alcanza y que todavía no tienen uno permanente. */
export async function repartirTokenPermanente(token: string, tambienLosQueYaTienen = false) {
  const alcanzados = await numerosQueAlcanza(token);
  for (const c of alcanzados) {
    if (tambienLosQueYaTienen || c.token_permanente !== 1) ponerTokenPermanenteAlNumero(c.phone_number_id, token);
  }
  return alcanzados;
}

/**
 * LOS PERMISOS DE INICIO DE SESIÓN QUE HAY: el de la conexión y el de cada cuenta de Facebook
 * anexada. Es lo que usa «📱 Tus números» para ver los BM; el paso del token usaba solo el
 * primero y, cuando ése ya no veía nada, el selector de BM salía vacío (21/10/2026).
 */
export function permisosConocidos(): string[] {
  return [...new Set([getTokenDeLaConexion(), ...permisosDeTodasLasCuentas().map((p) => p.token)].filter((t): t is string => !!t))];
}

/** Todos los tokens permanentes que hay: el general y el de cada número. Sin repetir. */
export function tokensPermanentes(): string[] {
  const todos = [
    getMetaRuntimeSetting("whatsapp_access_token_override"),
    process.env.META_ACCESS_TOKEN?.trim(),
    ...listMetaWhatsAppConnections()
      .filter((c) => c.token_permanente === 1)
      .map((c) => c.access_token),
  ];
  return [...new Set(todos.filter((t): t is string => !!t))];
}
