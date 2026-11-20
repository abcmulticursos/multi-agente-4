import { getMetaRuntimeSetting, listMetaConnections, listMetaWhatsAppConnections } from "@/lib/db";
import { getMetaAppId } from "@/lib/meta/connect";
import { otrasApps } from "@/lib/meta/apps-de-meta";

/**
 * LOS NEGOCIOS DUEÑOS DE NUESTRAS APPS, Y SOLO LO SUYO (15/11/2026).
 *
 * Lo que pasó: GRAFISMO tenía dos números del negocio «Premium Academy Violeta» y la app del bot era de
 * «Premium Academy Turquesa». Meta los dejaba «suscritos», el mensaje llegaba al celular con dos
 * palomitas… y al bot no le llegaba NADA: con el acceso estándar, Meta solo le pasa a una app los
 * mensajes de los números de SU negocio. Medido ese día con su token: los números de Turquesa entran
 * (FIGURARTE), los de Violeta no. Él: «solo debería mostrarme las páginas y los activos del mismo bm».
 *
 * Con MULTI APP (`apps-de-meta.ts`) son los negocios de TODAS nuestras apps: la principal y las otras.
 * Meta Connect y los selectores de las tiendas enseñan solo lo de esos negocios.
 *
 * Si de alguna app no se sabe el negocio, `null`: no se esconde nada. Esconder a ciegas dejaría vacías
 * las listas de alguien a quien sí le funcionan.
 */
export type NegociosDeLasApps = { ids: string[]; nombres: string[] };

export function negocioDeLaPrincipal(): { id: string; nombre: string } | null {
  const appId = getMetaAppId();
  if (!appId) return null;
  const nombre = getMetaRuntimeSetting(`app_negocio_${appId}`)?.trim();
  const guardado = getMetaRuntimeSetting(`app_negocio_id_${appId}`)?.trim();
  if (guardado) return { id: guardado, nombre: nombre || guardado };
  if (!nombre) return null;
  // Antes de guardar el id solo se guardaba el nombre: se busca entre lo conectado, que lleva los dos.
  const conIds = [...listMetaWhatsAppConnections(), ...listMetaConnections()];
  const ids = [...new Set(conIds.filter((c) => c.business_name?.trim() === nombre && c.business_id).map((c) => String(c.business_id)))];
  // Dos negocios con el mismo nombre: no se puede saber cuál es, y no se esconde nada.
  return ids.length === 1 ? { id: ids[0], nombre } : null;
}

export function negociosDeLasApps(): NegociosDeLasApps | null {
  const principal = negocioDeLaPrincipal();
  if (!principal) return null;
  const otras = otrasApps();
  if (otras.some((a) => !a.negocioId)) return null;
  return {
    ids: [principal.id, ...otras.map((a) => a.negocioId as string)],
    nombres: [principal.nombre, ...otras.map((a) => a.negocio || (a.negocioId as string))],
  };
}

/**
 * LA APP DE UN NEGOCIO (19/11/2026): la nuestra cuyo negocio dueño es ése (la principal o una otra). Con ella se
 * crea el permiso permanente de ese BM y se conectan sus números, sin cruzarlos con la app de otro negocio.
 */
export function appDelNegocio(businessId: string | null | undefined): { appId: string; nombre: string | null; principal: boolean } | null {
  const id = String(businessId ?? "").trim();
  if (!id) return null;
  const principal = negocioDeLaPrincipal();
  const appId = getMetaAppId();
  if (appId && principal?.id === id) return { appId, nombre: null, principal: true };
  const otra = otrasApps().find((a) => a.negocioId === id);
  return otra ? { appId: otra.appId, nombre: otra.nombre, principal: false } : null;
}

/**
 * ¿LO PUEDE USAR UNO DE LOS NEGOCIOS DE NUESTRAS APPS? (19/11/2026) Para páginas y píxeles: los suyos Y los que otro BM
 * les comparte. Su plan: la página y el píxel viven en el BM A y se comparten con B y C, que tienen los números y sus
 * apps. Contando solo al dueño, la página de A no se ofrecía y las tiendas la soltaban solas. Los NÚMEROS no pasan por
 * aquí: un número va solo con la app de su propio negocio (`esDeLaApp`), o se cruzan.
 */
export function loPuedeUsarLaApp(
  negocios: NegociosDeLasApps | null,
  businessId: string | null | undefined,
  accesoDe: Array<{ id?: string | null }> | null | undefined
): boolean {
  if (esDeLaApp(negocios, businessId)) return true;
  return (accesoDe ?? []).some((c) => !!c?.id && negocios!.ids.includes(String(c.id)));
}

/** ¿Es de uno de los negocios de nuestras apps? Sin saberlo, todo vale (ver arriba). */
export function esDeLaApp(negocios: NegociosDeLasApps | null, businessId: string | null | undefined): boolean {
  if (!negocios) return true;
  return negocios.ids.includes(String(businessId ?? "").trim());
}
