import { NextResponse, type NextRequest } from "next/server";
import { getMetaWhatsAppConnection, listMetaWhatsAppConnections } from "@/lib/db";
import { estaSuscritaAEstaApp, getMetaAppId, graphVersion, subscribeWhatsAppToWebhooks } from "@/lib/meta/connect";
import { MEDIA_HORA, olvidar, recordar } from "@/lib/meta/recuerdo";
import { fetchMeta } from "@/lib/meta/freno";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * SUSCRIBIR CADA NÚMERO POR SU CUENTA — sin tener que hacerlo «Activo» antes.
 *
 * LO PIDIÓ EL DUEÑO el 10/10/2026: un botón «Suscribir» al lado de cada número. Antes
 * solo existía «Suscribir WhatsApp» (`whatsapp/configure`), que suscribe el número
 * ACTIVO; para suscribir otro había que cambiar el activo, suscribir y volver a dejarlo.
 *
 * ES LA MISMA SUSCRIPCIÓN DE SIEMPRE (`subscribeWhatsAppToWebhooks`), con el permiso del
 * propio número. Y Meta suscribe la CUENTA DE WHATSAPP entera, no el número: si dos
 * números comparten cuenta, quedan los dos. La pantalla lo refleja releyendo el estado.
 *
 * NO CAMBIA cuál está activo ni nada de lo que usa el bot para contestar.
 */

/** El estado de cada número: true = suscrito, false = no, null = no se pudo saber. */
export async function GET() {
  // RECORDADO 5 MINUTOS (21/10/2026): dos preguntas por cada cuenta de WhatsApp Business en cada
  // apertura de Meta Connect. «Suscribir» (abajo) lo olvida para que se vea el cambio al momento.
  return NextResponse.json(await recordar("suscribir", MEDIA_HORA, leerSuscripciones));
}

async function leerSuscripciones() {
  const porCuenta = new Map<string, boolean | null>();
  const otrasPorCuenta = new Map<string, string[]>();
  const estado: Record<string, boolean | null> = {};
  // LAS OTRAS APPS DE CADA NÚMERO (20/10/2026): «no quiero tener problemas con duplicidad».
  // Con dos apps, a cada cliente le contestan dos bots. Solo se lee.
  const otras: Record<string, string[]> = {};
  for (const fila of listMetaWhatsAppConnections()) {
    // Una consulta por cuenta de WhatsApp, no por número: es lo que Meta suscribe.
    if (!porCuenta.has(fila.waba_id)) {
      porCuenta.set(
        fila.waba_id,
        fila.access_token
          ? await estaSuscritaAEstaApp({ wabaId: fila.waba_id, accessToken: fila.access_token })
          : null
      );
      otrasPorCuenta.set(fila.waba_id, fila.access_token ? await otrasAppsDeLaCuenta(fila.waba_id, fila.access_token) : []);
    }
    estado[fila.phone_number_id] = porCuenta.get(fila.waba_id) ?? null;
    otras[fila.phone_number_id] = otrasPorCuenta.get(fila.waba_id) ?? [];
  }
  return { estado, otras };
}

async function otrasAppsDeLaCuenta(wabaId: string, accessToken: string): Promise<string[]> {
  try {
    const url = new URL(`https://graph.facebook.com/${graphVersion()}/${wabaId}/subscribed_apps`);
    url.searchParams.set("access_token", accessToken);
    const r = (await (await fetchMeta(url)).json()) as {
      data?: Array<{ whatsapp_business_api_data?: { id?: string; name?: string } }>;
    };
    const nuestra = getMetaAppId();
    return (r.data ?? [])
      .map((a) => a.whatsapp_business_api_data)
      .filter((a) => !!a?.id && a.id !== nuestra)
      .map((a) => a?.name || a?.id || "otra app")
      // (Las apps internas de Meta, como «WA DevX Webhook Events 1P App», no son otro bot.)
      .filter((nombre) => !/WA DevX|1P App|Meta Internal/i.test(nombre));
  } catch {
    return [];
  }
}

export async function POST(req: NextRequest) {
  const cuerpo = (await req.json().catch(() => null)) as { phoneNumberId?: unknown } | null;
  const phoneNumberId =
    typeof cuerpo?.phoneNumberId === "string" ? cuerpo.phoneNumberId.trim() : "";
  const fila = phoneNumberId ? getMetaWhatsAppConnection(phoneNumberId) : null;
  if (!fila) {
    return NextResponse.json(
      { ok: false, error: "Ese número no está conectado. Pulsa «Actualizar lista de Meta»." },
      { status: 404 }
    );
  }
  const resultado = await subscribeWhatsAppToWebhooks({
    wabaId: fila.waba_id,
    accessToken: fila.access_token,
  });
  olvidar("suscribir");
  olvidar("numeros");
  return NextResponse.json({ ok: resultado.ok, mensaje: resultado.message });
}
