import {
  cuentaDeFacebookDeCadaNegocio,
  getMetaRuntimeSetting,
  leerListaDeAcceso,
  listMetaConnections,
  listMetaWhatsAppConnections,
} from "@/lib/db";
import type { MetaPixelOption } from "@/lib/meta/connect";
import { getCapiPixelId } from "@/lib/meta/runtime-config";

/**
 * LO QUE YA ESTÁ CONECTADO, PARA ELEGIRLO EN UNA LISTA EN VEZ DE COPIAR IDS.
 *
 * LO PIDIÓ EL DUEÑO el 01/10/2026: «¿por qué en las tiendas configuraste la textarea
 * para yo agregar el id del numero de whatsapp? no es mejor elegir un número de la
 * lista de numeros de whatsapp?». Y tenía razón: las tres listas YA estaban guardadas
 * en la base desde que se conectó cada cosa, y el pop up Tiendas no las leía.
 *
 * Copiar a mano un identificador de dieciséis cifras es el peor campo posible: no se
 * puede comprobar a ojo, y un dígito cambiado no da ningún error — la tienda
 * simplemente no atiende a nadie, y eso se descubre cuando un cliente no recibe
 * respuesta.
 *
 * ── DOS PANTALLAS LO LEEN, Y POR ESO VIVE AQUÍ ──────────────────────────────
 *
 * El pop up Tiendas (`/api/editor/conexiones`) y las tarjetas por cuenta de Meta
 * Connect (`/api/meta/connect/cuentas`). Desde el 09/10/2026 cada cosa lleva además su
 * cuenta dueña, y las dos pantallas tienen que ver LA MISMA: si cada ruta armara su
 * lista, la tarjeta y la tienda podrían no estar de acuerdo.
 *
 * ── POR QUÉ NO LLAMA A META ────────────────────────────────────────────────
 *
 * `/api/meta/connect/status` llama a Meta por el nombre de la app (`fetchMetaAppName`).
 * El editor se abriría más lento y, sin internet o con el token caducado, los
 * selectores aparecerían vacíos y él creería que no hay nada conectado. Esto lee SOLO
 * la base: es inmediato y no puede fallar por red.
 *
 * ── NO SE DEVUELVE NINGÚN SECRETO ──────────────────────────────────────────
 *
 * Las filas guardan además el token de acceso de cada número y de cada página. Aquí
 * se copian a mano los campos que van a la pantalla, uno por uno, en vez de devolver
 * la fila entera: así un campo nuevo en la base no se publica solo.
 */
function pixelsDetectados(): MetaPixelOption[] {
  const crudo = getMetaRuntimeSetting("pixels_detectados");
  if (!crudo) return [];
  try {
    const parsed = JSON.parse(crudo);
    return Array.isArray(parsed)
      ? parsed.filter(
          (pixel): pixel is MetaPixelOption => typeof pixel?.pixelId === "string"
        )
      : [];
  } catch {
    return [];
  }
}

/**
 * EL SEPARADOR DE CADA COSA EN LOS SELECTORES: «Claudio · Aula Virtual Pro».
 *
 * Lo pidió el dueño el 10/10/2026: «no sabré de qué app viene cada activo… no hay un
 * indicador o separador que me diga de qué bm ni cuenta es». Se arma aquí, una vez, y lo
 * usan el selector de las tiendas y Meta Connect: si cada pantalla lo armara a su manera,
 * dirían cosas distintas de lo mismo.
 *
 *   cuenta de Facebook conocida   «Claudio · Aula Virtual Pro»
 *   solo el negocio               «Aula Virtual Pro» — compartido por un negocio que
 *                                 ninguna cuenta anexada administra, o conectado antes de
 *                                 que se apuntara quién entró
 *   nada                          «Sin negocio identificado»
 */
export function separadorDe(
  facebookNombre: string | null | undefined,
  negocioNombre: string | null | undefined
): string {
  const fb = facebookNombre?.trim();
  const negocio = negocioNombre?.trim();
  if (fb && negocio) return `${fb} · ${negocio}`;
  return negocio || "Sin negocio identificado";
}

export function loConectado() {
  // De qué cuenta de Facebook es cada negocio (Claudio, Alberto…). Ver `separadorDe`.
  const deQuienEs = cuentaDeFacebookDeCadaNegocio();
  const conSuCuenta = (negocioId: string | null | undefined, negocioNombre: string | null) => {
    const fb = negocioId ? deQuienEs.get(negocioId)?.facebookNombre ?? null : null;
    return { cuentaFacebook: fb, separador: separadorDe(fb, negocioNombre) };
  };
  // EL NÚMERO SE ENSEÑA COMO ÉL LO RECONOCE —el número de teléfono y el nombre
  // verificado—, no por su id. El id es lo que se guarda; la etiqueta es para que
  // sepa cuál está eligiendo.
  // CADA UNO VIAJA EN TRES PIEZAS, y es lo que pidió el dueño el 02/10/2026: «necesito
  // tener referencia visual… necesito que sea similar o igual en apariencia a los de meta
  // connect, así yo veo qué página, qué pixel y qué dataset elegí».
  //
  //     foto      la cara o el logo, que es lo que se reconoce de un golpe
  //     etiqueta  la línea gorda: el número, el nombre de la página, el del pixel
  //     detalle   la línea pequeña: a quién pertenece o cuál es su id
  //
  // Un id de dieciséis cifras no se reconoce; una cara, sí.
  // LA FOTO SE PIDE FRESCA, NO LA GUARDADA. Meta entrega las fotos como enlaces firmados
  // que caducan a las pocas semanas: con el enlace guardado, unas salían y otras no. Lo vio
  // el dueño el 10/10/2026 en los selectores de Tiendas. `/api/meta/avatar` la sirve
  // siempre al día, y es lo que ya usaba Meta Connect, donde sí se veían.
  const numeros = listMetaWhatsAppConnections().map((c) => ({
    id: c.phone_number_id,
    foto: `/api/meta/avatar?wa=${encodeURIComponent(c.phone_number_id)}`,
    etiqueta: c.display_phone_number || c.phone_number_id,
    detalle: c.verified_name ?? null,
    activa: c.active === 1,
    // Para poder avisar en la pantalla de que un número ya está en otra tienda, y
    // de cuál es la WABA que va a medir con él.
    waba: c.waba_id,
    // LA CUENTA DUEÑA, para que la tienda ofrezca solo página y píxel de la misma.
    // Lo pidió el dueño el 09/10/2026; ver `src/lib/meta/cuentas.ts`.
    cuenta: c.business_id ?? null,
    cuentaNombre: c.business_name ?? null,
    // LAS CUENTAS QUE PUEDEN USARLO: la dueña y las que lo tienen compartido. Lo pidió el
    // dueño el 10/10/2026: «si están compartidos también».
    accesoDe: leerListaDeAcceso(c.compartido_con),
    ...conSuCuenta(c.business_id, c.business_name),
  }));
  const paginas = listMetaConnections().map((c) => ({
    id: c.page_id,
    foto: `/api/meta/avatar?page=${encodeURIComponent(c.page_id)}`,
    etiqueta: c.page_name || c.page_id,
    detalle: `ID ${c.page_id}`,
    activa: c.active === 1,
    // Elegida para este agente, o solo detectada. Las tarjetas de Meta Connect cuentan
    // solo las elegidas: una página que Meta ve y él nunca eligió no es «conectada».
    elegida: c.selected === 1,
    cuenta: c.business_id ?? null,
    cuentaNombre: c.business_name ?? null,
    accesoDe: leerListaDeAcceso(c.compartido_con),
    ...conSuCuenta(c.business_id, c.business_name),
  }));
  const pixels = pixelsDetectados().map((p) => ({
    id: p.pixelId,
    // Un conjunto de datos no tiene foto en Meta: lo dibuja la pantalla.
    foto: null,
    etiqueta: p.name || p.pixelId,
    detalle: [p.pixelId, p.businessName].filter(Boolean).join(" · "),
    activa: false,
    // El píxel ya traía su dueño desde que se conecta (`fetchPixelOptions`).
    cuenta: p.businessId || null,
    cuentaNombre: p.businessName ?? null,
    accesoDe: (p.accesoDe ?? []).filter((c) => typeof c?.id === "string" && c.id),
    ...conSuCuenta(p.businessId || null, p.businessName ?? null),
  }));
  // EL PÍXEL DE META CONNECT, el que usa una tienda con el suyo vacío. Hace falta para
  // avisar de la mezcla: una tienda sin píxel propio mide con éste.
  const pixelGeneral = getCapiPixelId();
  return { numeros, paginas, pixels, pixelGeneral };
}
