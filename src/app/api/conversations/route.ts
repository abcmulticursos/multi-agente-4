import { NextResponse, type NextRequest } from "next/server";
import { listConversations, listMetaWhatsAppConnections } from "@/lib/db";
import { COUNTRIES, type CountryCode } from "@/lib/countries";
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
  /** Una bandeja de UNO de los números de una tienda que tiene varios (15/11/2026): se pinta el teléfono en grande. */
  deUnNumero?: boolean;
  /** La tienda dentro de la que va este número (15/11/2026): en la barra sale debajo de ella. */
  padre?: string;
};

/** La bandera de un país («AR» → 🇦🇷). */
const bandera = (pais: string) => (/^[A-Z]{2}$/.test(pais) ? String.fromCodePoint(...[...pais].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)) : "");

/**
 * LOS NÚMEROS DE UNA TIENDA, CADA UNO CON SUS PAÍSES (15/11/2026). Él: «una bandeja de entrada para cada número, doy click
 * en un número y veo su chat». El de la tienda primero; un país que repite el de la tienda va con él.
 */
function numerosConSusPaises(t: { numero?: string; por_pais?: Record<string, { numero?: string } | undefined> }): { numero: string; paises: string[]; principal: boolean }[] {
  const principal = String(t.numero ?? "").trim();
  const lista: { numero: string; paises: string[]; principal: boolean }[] = principal ? [{ numero: principal, paises: [], principal: true }] : [];
  for (const [pais, g] of Object.entries(t.por_pais ?? {})) {
    const n = String(g?.numero ?? "").trim();
    if (!n) continue;
    const ya = lista.find((x) => x.numero === n);
    if (ya) ya.paises.push(pais);
    else lista.push({ numero: n, paises: [pais], principal: false });
  }
  return lista;
}

/** La bandeja de una conversación de una tienda: la de su número si la tienda tiene varios; si no, la de la tienda. */
function bandejaDeLaTienda(t: { id: string; numero?: string; por_pais?: Record<string, { numero?: string } | undefined> }, suNumero: string | null | undefined): string {
  const nums = numerosConSusPaises(t);
  if (nums.length < 2) return `t:${t.id}`;
  const n = String(suNumero ?? "").trim();
  // Entró por otro sitio (su página, una frase de entrada en otro número): a la bandeja del número de la tienda.
  return `t:${t.id}#${nums.some((x) => x.numero === n) ? n : nums[0].numero}`;
}

function bandejasDelChat(enUso: Set<string>): BandejaDelChat[] {
  const numeros = listMetaWhatsAppConnections();
  const deTiendas = new Set<string>();
  const bandejas: BandejaDelChat[] = [];
  for (const t of loadWorkflowConfig()?.tiendas ?? []) {
    if (!t || t.enabled === false) continue;
    // (15/11/2026) Su número: el de la tienda o, si lo dejó vacío, el primero de sus países. Él vació la «Configuración
    // general» de GRAFISMO (sus números solo en las tarjetas de Colombia y Argentina) y la tienda desapareció del chat.
    const numero = String(t.numero ?? "").trim() || numerosConSusPaises(t)[0]?.numero || "";
    const tienePagina = !!String(t.pagina ?? "").trim() || Object.values(t.por_pais ?? {}).some((g) => String(g?.pagina ?? "").trim());
    // Una tienda sin número ni página (solo por frase de entrada) sale si ya tiene chats.
    if (!numero && !tienePagina && ![...enUso].some((b) => b === `t:${t.id}` || b.startsWith(`t:${t.id}#`))) continue;
    if (numero) deTiendas.add(numero);
    // (14/11/2026) Y los números de sus países (`Tienda.por_pais`): sus chats van en la bandeja de la tienda.
    for (const g of Object.values(t.por_pais ?? {})) if (String(g?.numero ?? "").trim()) deTiendas.add(String(g.numero).trim());
    const n = numeros.find((x) => x.phone_number_id === numero);
    // (15/11/2026) UNA BANDEJA POR NÚMERO cuando la tienda tiene varios (los de sus países): cada una solo con sus chats.
    const susNumeros = numerosConSusPaises(t);
    if (susNumeros.length >= 2) {
      // (15/11/2026) UN SOLO CHAT CON SUS NÚMEROS DENTRO. Él: «se está mostrando como 2 tiendas… debe ser un chat con el
      // nombre de la tienda y ahí los 2 números». Tocar la tienda enseña los chats de todos sus números; cada número, los suyos.
      bandejas.push({
        clave: `t:${t.id}`,
        nombre: t.nombre?.trim() || "Tienda sin nombre",
        color: t.color?.trim() || null,
        detalle: `${susNumeros.length} números`,
        numeroId: null,
        verificado: null,
        telefono: null,
        paginaId: String(t.pagina ?? "").trim() || null,
      });
      for (const sn of susNumeros) {
        const c = numeros.find((x) => x.phone_number_id === sn.numero);
        const paises = sn.paises.map((p) => `${bandera(p)} ${COUNTRIES[p as CountryCode]?.label ?? p}`).join(" · ");
        bandejas.push({
          clave: `t:${t.id}#${sn.numero}`,
          nombre: t.nombre?.trim() || "Tienda sin nombre",
          color: t.color?.trim() || null,
          detalle: [sn.principal ? "Número de la tienda" : "", paises].filter(Boolean).join(" · ") || null,
          numeroId: sn.numero,
          verificado: c?.verified_name ?? null,
          telefono: c?.display_phone_number ?? sn.numero,
          paginaId: String(t.pagina ?? "").trim() || null,
          deUnNumero: true,
          padre: `t:${t.id}`,
        });
      }
      continue;
    }
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
    // UN NÚMERO PAUSADO NUNCA SALE (22/10/2026): «números personales míos que están en Facebook
    // pero no los quiero usar aparecen en el chat». Sus chats viejos siguen en «Todas».
    if (n.pausado === 1) continue;
    // Un número de una tienda sale aparte solo si tiene chats que no son de ninguna tienda.
    const clave = `n:${n.phone_number_id}`;
    if (deTiendas.has(n.phone_number_id) && !enUso.has(clave)) continue;
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
      // (15/11/2026) Con varios números en la tienda, la bandeja de SU número (`bandejaDeLaTienda`).
      bandeja: suya ? bandejaDeLaTienda(suya, fila.wa_phone_number_id) : fila.wa_phone_number_id ? `n:${fila.wa_phone_number_id}` : null,
    };
  });
  return jsonComprimido(req, {
    conversations: conSuTienda,
    introVariants: getConfiguredIntroVariants(),
    parcial: Number.isFinite(limite) && limite > 0,
    // Solo con la lista entera: con las 30 primeras faltarían las bandejas de chats más viejos.
    bandejas:
      Number.isFinite(limite) && limite > 0
        ? undefined
        : bandejasDelChat(new Set(conSuTienda.map((c) => c.bandeja).filter((b): b is string => !!b))),
  });
}

/**
 * LA LISTA COMPRIMIDA (18/11/2026). Él: «el chat se está poniendo súper lento». Medido en su bot: la lista entera
 * (cada 20 s) pesaba 1,2 MB y las 30 primeras (cada 2 s) 84 KB, las dos SIN comprimir. Es el mismo JSON de siempre
 * en gzip (como `/api/workflow` desde el 11/11); el navegador lo descomprime solo. Sin «gzip» en la petición, tal cual.
 */
async function jsonComprimido(req: NextRequest, data: unknown): Promise<NextResponse> {
  const texto = JSON.stringify(data);
  const cabeceras: Record<string, string> = { "Content-Type": "application/json", "Cache-Control": "no-store", Vary: "Accept-Encoding" };
  if (texto.length < 8_000 || !/\bgzip\b/.test(req.headers.get("accept-encoding") ?? "")) {
    return new NextResponse(texto, { headers: cabeceras });
  }
  const { gzipSync } = await import("node:zlib");
  return new NextResponse(new Uint8Array(gzipSync(texto)), { headers: { ...cabeceras, "Content-Encoding": "gzip" } });
}
