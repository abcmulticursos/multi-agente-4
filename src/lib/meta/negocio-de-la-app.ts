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

/** ¿Es de uno de los negocios de nuestras apps? Sin saberlo, todo vale (ver arriba). */
export function esDeLaApp(negocios: NegociosDeLasApps | null, businessId: string | null | undefined): boolean {
  if (!negocios) return true;
  return negocios.ids.includes(String(businessId ?? "").trim());
}
