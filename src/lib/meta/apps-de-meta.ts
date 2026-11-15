import { deleteMetaRuntimeSettings, getMetaRuntimeSetting, setMetaRuntimeSettings } from "@/lib/db";
import { getMetaAppId, getWebhookSecretCandidates } from "@/lib/meta/runtime-config";

/**
 * MULTI APP (15/11/2026). Él: «hazlo multi app y que funcione en el mismo chat que ya existe».
 *
 * Por qué: con el acceso estándar de Meta, una app solo recibe los mensajes de los números de SU negocio
 * (medido ese día: los números de Violeta no entraban por la app de Turquesa). Con una app por negocio,
 * cada número entra por la suya, y todos caen en el mismo bot y el mismo chat.
 *
 * Cómo: la app «principal» sigue siendo la de siempre (`meta_app_id` / `meta_app_secret`: la del inicio de
 * sesión y del asistente). Las OTRAS se guardan aquí: su id, nombre y negocio en `meta_otras_apps` (sin
 * secretos) y la clave secreta de cada una en `meta_app_secret__<id>` (cifrada como las demás). Sirven para:
 *   · reconocer la firma de sus mensajes (WhatsApp, Messenger e Instagram),
 *   · contarlas como NUESTRAS al mirar las suscripciones de una cuenta de WhatsApp,
 *   · enseñar en Meta Connect y en las tiendas los activos de su negocio.
 * Enviar no cambia: cada número ya guarda SU token, el que le dio su app al conectarlo.
 *
 * Al cambiar la app principal por otra (asistente o «Mi app»), la anterior pasa sola a esta lista: así
 * conectar una app nueva ya no deja mudos los números de la vieja (le pasó el 15/11 con Turquesa).
 */
export type OtraApp = { appId: string; nombre: string | null; negocio: string | null; negocioId: string | null };

const LISTA = "meta_otras_apps";
const secretoDe = (appId: string) => `meta_app_secret__${appId}`;

export function otrasApps(): OtraApp[] {
  try {
    const crudo = getMetaRuntimeSetting(LISTA);
    const lista = crudo ? (JSON.parse(crudo) as unknown) : [];
    return Array.isArray(lista)
      ? lista
          .filter((a): a is OtraApp => !!a && typeof (a as OtraApp).appId === "string" && !!(a as OtraApp).appId)
          // La principal no se repite aquí.
          .filter((a) => a.appId !== getMetaAppId())
      : [];
  } catch {
    return [];
  }
}

export function secretoDeOtraApp(appId: string): string | null {
  return getMetaRuntimeSetting(secretoDe(appId))?.trim() || null;
}

/** Guarda (o actualiza) otra app con su clave. */
export function guardarOtraApp(app: OtraApp, secreto: string): void {
  const resto = otrasApps().filter((a) => a.appId !== app.appId);
  setMetaRuntimeSettings({ [LISTA]: JSON.stringify([...resto, app]), [secretoDe(app.appId)]: secreto });
}

export function quitarOtraApp(appId: string): void {
  setMetaRuntimeSettings({ [LISTA]: JSON.stringify(otrasApps().filter((a) => a.appId !== appId)) || "[]" });
  deleteMetaRuntimeSettings([secretoDe(appId)]);
}

/** Los ids de TODAS nuestras apps: la principal y las otras. */
export function idsDeNuestrasApps(): string[] {
  return [getMetaAppId(), ...otrasApps().map((a) => a.appId)].filter((x): x is string => !!x);
}

/**
 * LAS CLAVES CON QUE PUEDE VENIR FIRMADO UN MENSAJE: las de siempre del canal (`getWebhookSecretCandidates`)
 * y las de las otras apps. Basta con que UNA valide la firma.
 */
export function clavesDeFirma(canal: "whatsapp" | "messenger" | "instagram"): string[] {
  const todas = [...getWebhookSecretCandidates(canal).map((c) => c.value), ...otrasApps().map((a) => secretoDeOtraApp(a.appId))];
  return [...new Set(todas.filter((x): x is string => !!x && !!x.trim()))];
}
