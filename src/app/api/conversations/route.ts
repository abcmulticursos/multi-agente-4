import { NextResponse, type NextRequest } from "next/server";
import { listConversations, listMetaWhatsAppConnections } from "@/lib/db";
import {
  laTiendaDeLaConversacion,
  loadWorkflowConfig,
} from "@/lib/workflow/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function getConfiguredIntroVariants(): number[] {
  const config = loadWorkflowConfig();
  if (!config) return [1];

  const variants = new Set<number>([1]);
  if (Array.isArray(config.intro_sequence_2)) variants.add(2);
  if (Array.isArray(config.intro_sequence_3)) variants.add(3);
  if (Array.isArray(config.intro_extra_sequences)) {
    for (let i = 0; i < config.intro_extra_sequences.length; i++) {
      variants.add(i + 4);
    }
  }
  if (Array.isArray(config.intro_enabled)) {
    for (let i = 0; i < config.intro_enabled.length; i++) {
      variants.add(i + 1);
    }
  }
  return Array.from(variants).sort((a, b) => a - b);
}

/**
 * LAS BANDEJAS DE LA BARRA DEL CHAT (21/10/2026): «quiero ver los chats de cada tienda… y los
 * números sin tienda también chatean». Una por tienda con número o página, y una por cada número
 * conectado que ninguna tienda usa. Solo lee la configuración y la base: ninguna consulta a Meta.
 */
type BandejaDelChat = {
  clave: string;
  nombre: string;
  color: string | null;
  detalle: string | null;
  /** LA CABECERA SIGUE A LA BANDEJA (21/10/2026): el número y la página que la atienden. */
  numeroId: string | null;
  verificado: string | null;
  telefono: string | null;
  paginaId: string | null;
};

function bandejasDelChat(enUso: Set<string>): BandejaDelChat[] {
  const numeros = listMetaWhatsAppConnections();
  const deTiendas = new Set<string>();
  const bandejas: BandejaDelChat[] = [];
  for (const t of loadWorkflowConfig()?.tiendas ?? []) {
    if (!t || t.enabled === false) continue;
    const numero = String(t.numero ?? "").trim();
    // Una tienda sin número ni página (solo por frase de entrada) sale si ya tiene chats.
    if (!numero && !String(t.pagina ?? "").trim() && !enUso.has(`t:${t.id}`)) continue;
    if (numero) deTiendas.add(numero);
    const n = numeros.find((x) => x.phone_number_id === numero);
    bandejas.push({
      clave: `t:${t.id}`,
      nombre: t.nombre?.trim() || "Tienda sin nombre",
      color: t.color?.trim() || null,
      detalle: n?.display_phone_number ?? null,
      numeroId: n?.phone_number_id ?? null,
      verificado: n?.verified_name ?? null,
      telefono: n?.display_phone_number ?? null,
      paginaId: String(t.pagina ?? "").trim() || null,
    });
  }
  for (const n of numeros) {
    // Un número de una tienda sale aparte solo si tiene chats que no son de ninguna (varias
    // tiendas en el mismo número sin frase que las distinga). Uno pausado, solo si tiene chats.
    const clave = `n:${n.phone_number_id}`;
    if ((deTiendas.has(n.phone_number_id) || n.pausado === 1) && !enUso.has(clave)) continue;
    bandejas.push({
      clave,
      nombre: n.display_phone_number ?? n.phone_number_id,
      color: null,
      detalle: n.verified_name ?? null,
      numeroId: n.phone_number_id,
      verificado: n.verified_name ?? null,
      telefono: n.display_phone_number ?? null,
      paginaId: null,
    });
  }
  return bandejas;
}

export async function GET(req: NextRequest) {
  // `?limite=30` trae solo las primeras, para que el panel pinte al instante.
  // Sin el parametro vienen todas, que es lo que necesitan los contadores de
  // las etiquetas y el Kanban. El panel pide las dos cosas: primero las 30 y
  // despues el resto por detras.
  const crudo = req.nextUrl.searchParams.get("limite");
  const limite = crudo ? Number(crudo) : NaN;
  const rows = listConversations(
    Number.isFinite(limite) && limite > 0 ? limite : undefined
  );
  /**
   * DE QUE TIENDA ES CADA CONVERSACION — lo decide el servidor, no el navegador.
   *
   * LO PIDIO EL 08/10/2026: «necesito que el kanban tambien sea por tienda».
   *
   * SE RESUELVE AQUI Y NO EN EL TABLERO. La tienda sale del numero por el que entro el
   * cliente, y esa correspondencia vive en la configuracion — en el servidor. Copiar esa
   * logica al navegador habria dejado DOS SITIOS decidiendo la tienda, y el dia que cambien
   * el panel diria una cosa y el bot otra. `laTiendaDeLaConversacion` es la misma funcion que
   * usa el bot para vender: una sola puerta.
   *
   * ES UN CAMPO QUE SE AÑADE. La fila sigue llegando entera, con todo lo que ya traia; quien
   * no mire estos dos campos no se entera de que existen.
   *
   * EL NOMBRE Y EL COLOR VIAJAN JUNTOS porque el tablero los necesita a la vez: filtra por el
   * nombre y pinta con el color. Mandar solo el id obligaria al panel a pedir las tiendas
   * aparte para traducirlo, que es una llamada mas para nada.
   */
  const conSuTienda = rows.map((fila) => {
    const suya = laTiendaDeLaConversacion(fila);
    return {
      ...fila,
      tienda_nombre: suya?.nombre?.trim() || null,
      tienda_color: suya?.color?.trim() || null,
      // SU BANDEJA EN LA BARRA DEL CHAT (21/10/2026): su tienda, o su número si no tiene tienda.
      bandeja: suya ? `t:${suya.id}` : fila.wa_phone_number_id ? `n:${fila.wa_phone_number_id}` : null,
    };
  });
  return NextResponse.json(
    {
      conversations: conSuTienda,
      introVariants: getConfiguredIntroVariants(),
      parcial: Number.isFinite(limite) && limite > 0,
      // Solo con la lista entera: con las 30 primeras faltarían las bandejas de chats más viejos.
      bandejas:
        Number.isFinite(limite) && limite > 0
          ? undefined
          : bandejasDelChat(new Set(conSuTienda.map((c) => c.bandeja).filter((b): b is string => !!b))),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
