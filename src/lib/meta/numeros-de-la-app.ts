import { listMetaWhatsAppConnections, type MetaWhatsAppConnectionRow } from "@/lib/db";
import { esDeLaApp, negociosDeLasApps } from "@/lib/meta/negocio-de-la-app";

/**
 * SOLO LOS NÚMEROS DE LA APP (19/11/2026). Él: «si la app tiene 2 números, ¿para qué mostrar otros números? es
 * innecesario… en Meta Connect debe mostrar solo los de la app, y en el chat la tienda con su número (o sus 2)».
 * Es la MISMA regla que Meta Connect ya usaba desde el 15/11 para su lista de números (`esDeLaApp`): aquí solo se le
 * da un nombre para usarla también en «Calidad de la cuenta» y en el chat. Sin saber el negocio de alguna app, no se
 * esconde nada (ver `negocio-de-la-app.ts`).
 */
export function numerosDeLaApp(): MetaWhatsAppConnectionRow[] {
  const negocios = negociosDeLasApps();
  return listMetaWhatsAppConnections().filter((c) => esDeLaApp(negocios, c.business_id));
}
