import { NextResponse } from "next/server";
import {
  getActiveMetaWhatsAppConnection,
  getMetaRuntimeSetting,
  setMetaRuntimeSettings,
} from "@/lib/db";
import { graphVersion, type MetaPixelOption } from "@/lib/meta/connect";
import { getTokenDeLaConexion } from "@/lib/meta/runtime-config";
import { MEDIA_HORA, olvidar, recordar } from "@/lib/meta/recuerdo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * El conjunto de datos de ESTA cuenta de WhatsApp.
 *
 * Elegir un pixel del desplegable tiene una trampa: puede ser uno que no esté
 * vinculado a la WABA. Meta entonces acepta la elección pero rechaza los
 * eventos de conversaciones con el subcódigo 2804132, y las compras no se
 * registran. El fallo aparece tarde y no se parece a su causa.
 *
 * Meta tiene una llamada que evita eso: `/{waba-id}/dataset` devuelve el
 * conjunto de datos de esa WABA y, si todavía no hay ninguno, lo CREA ya
 * vinculado. No fusiona ni toca los pixels que ya existan — no se puede
 * vincular a posteriori uno que ya estaba.
 *
 * Por eso van separados el mirar y el crear:
 *   GET  → pregunta si ya hay uno. No crea nada.
 *   POST → crea. Solo se llama tras confirmar en la pantalla, porque un
 *          conjunto de datos creado en el negocio no se deshace con un botón.
 */

function wabaActiva(): { wabaId: string; nombre: string | null } | null {
  const conexion = getActiveMetaWhatsAppConnection();
  if (!conexion?.waba_id) return null;
  return {
    wabaId: conexion.waba_id,
    nombre: conexion.verified_name ?? conexion.display_phone_number ?? null,
  };
}

/** Llama a `/{waba-id}/dataset`. Con POST crea; con GET solo mira. */
async function pedirDataset(
  wabaId: string,
  token: string,
  crear: boolean
): Promise<{ id: string | null; error: string | null }> {
  try {
    const url = new URL(
      `https://graph.facebook.com/${graphVersion()}/${wabaId}/dataset`
    );
    url.searchParams.set("access_token", token);
    const res = await fetch(url, {
      method: crear ? "POST" : "GET",
      cache: "no-store",
    });
    const cuerpo = (await res.json().catch(() => null)) as {
      id?: string;
      // Cuando solo se mira, Meta puede responder con la lista en vez del nodo.
      data?: Array<{ id?: string }>;
      error?: { message?: string };
    } | null;

    if (!res.ok) {
      return {
        id: null,
        error: cuerpo?.error?.message ?? `Meta respondió ${res.status}`,
      };
    }
    const id = cuerpo?.id ?? cuerpo?.data?.[0]?.id ?? null;
    return { id: id ?? null, error: null };
  } catch (err) {
    return {
      id: null,
      error: err instanceof Error ? err.message : "No se pudo llamar a Meta.",
    };
  }
}

/**
 * Deja el conjunto de datos elegido y, además, lo suma a la lista del
 * desplegable. Sin esto el desplegable no lo mostraría —solo lista lo que se
 * detectó al conectar— y parecería que la elección no se guardó.
 */
function guardarComoElegido(datasetId: string, nombreWaba: string | null) {
  const crudo = getMetaRuntimeSetting("pixels_detectados");
  let lista: MetaPixelOption[] = [];
  try {
    const parsed = crudo ? JSON.parse(crudo) : [];
    if (Array.isArray(parsed)) {
      lista = parsed.filter(
        (pixel): pixel is MetaPixelOption => typeof pixel?.pixelId === "string"
      );
    }
  } catch {
    lista = [];
  }

  if (!lista.some((pixel) => pixel.pixelId === datasetId)) {
    lista = [
      ...lista,
      {
        pixelId: datasetId,
        name: nombreWaba ? `${nombreWaba} - WhatsApp` : "Conjunto de datos de WhatsApp",
        businessId: "",
        businessName: null,
        compartido: false,
      },
    ];
  }

  setMetaRuntimeSettings({
    capi_pixel_id: datasetId,
    pixels_detectados: JSON.stringify(lista),
  });
}

/** Solo mira: ¿esta WABA ya tiene conjunto de datos? */
export async function GET() {
  const waba = wabaActiva();
  if (!waba) {
    return NextResponse.json({
      ok: false,
      error:
        "Primero elige el número de WhatsApp: el conjunto de datos se crea en su cuenta.",
    });
  }
  const token = getTokenDeLaConexion();
  if (!token) {
    return NextResponse.json({
      ok: false,
      error: "No hay token. Conéctate con Meta primero.",
    });
  }

  // RECORDADO MEDIA HORA (21/10/2026): se pedía en cada apertura de Meta Connect. Crearlo
  // (POST, abajo) lo olvida.
  const { id, error } = await recordar(`dataset:${waba.wabaId}`, MEDIA_HORA, async () => {
    const r = await pedirDataset(waba.wabaId, token, false);
    if (r.error) throw new Error(r.error);
    return r;
  }).catch((e: Error) => ({ id: null, error: e.message }));
  return NextResponse.json({
    ok: !error,
    error,
    wabaId: waba.wabaId,
    nombreWaba: waba.nombre,
    // null = todavía no hay ninguno, habría que crearlo.
    datasetId: id,
    elegido: getMetaRuntimeSetting("capi_pixel_id"),
  });
}

/** Crea el conjunto de datos —o recupera el que ya hubiera— y lo deja elegido. */
export async function POST() {
  olvidar("dataset");
  const waba = wabaActiva();
  if (!waba) {
    return NextResponse.json({
      ok: false,
      error:
        "Primero elige el número de WhatsApp: el conjunto de datos se crea en su cuenta.",
    });
  }
  const token = getTokenDeLaConexion();
  if (!token) {
    return NextResponse.json({
      ok: false,
      error: "No hay token. Conéctate con Meta primero.",
    });
  }

  // Se mira ANTES de crear. Meta ya devuelve el existente en vez de duplicar,
  // pero así se puede decir cuál de las dos cosas pasó — que no es lo mismo
  // para quien lo lee.
  const previo = await pedirDataset(waba.wabaId, token, false);

  const { id, error } = await pedirDataset(waba.wabaId, token, true);
  if (!id) {
    return NextResponse.json({
      ok: false,
      error: error ?? "Meta no devolvió ningún conjunto de datos.",
    });
  }

  guardarComoElegido(id, waba.nombre);
  return NextResponse.json({
    ok: true,
    datasetId: id,
    // true = ya existía, no se creó nada nuevo.
    yaExistia: previo.id === id,
    nombreWaba: waba.nombre,
  });
}
