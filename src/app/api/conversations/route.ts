import { NextResponse, type NextRequest } from "next/server";
import { listConversations } from "@/lib/db";
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
    };
  });
  return NextResponse.json(
    {
      conversations: conSuTienda,
      introVariants: getConfiguredIntroVariants(),
      parcial: Number.isFinite(limite) && limite > 0,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
