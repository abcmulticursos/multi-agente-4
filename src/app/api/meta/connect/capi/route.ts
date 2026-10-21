import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import {
  deleteMetaRuntimeSettings,
  getMetaRuntimeSetting,
  permisoDeMedicionDeLaCuenta,
  setMetaRuntimeSettings,
} from "@/lib/db";
import { graphVersion } from "@/lib/meta/connect";
import {
  getCapiAccessToken,
  getCapiPixelId,
  getCapiTokenOrigen,
} from "@/lib/meta/runtime-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ORIGENES = ["conexion", "variable", "manual"] as const;
type Origen = (typeof ORIGENES)[number];

function estado() {
  return {
    origenElegido: getMetaRuntimeSetting("capi_token_origen"),
    origenEnUso: getCapiTokenOrigen(),
    hayToken: Boolean(getCapiAccessToken()),
    hayManual: Boolean(getMetaRuntimeSetting("capi_access_token")),
    hayVariable: Boolean(process.env.META_CAPI_ACCESS_TOKEN?.trim()),
    pixelId: getCapiPixelId(),
  };
}

export async function GET() {
  return NextResponse.json(estado(), {
    headers: { "Cache-Control": "no-store" },
  });
}

/**
 * Guarda de dónde sale el token, y opcionalmente uno pegado a mano.
 *
 * El token nunca se devuelve: se guarda cifrado y desde aquí solo se dice si
 * existe. Mostrarlo de vuelta no aporta nada y lo pasea de más.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    origen?: unknown;
    token?: unknown;
  };
  const origen = ORIGENES.includes(body?.origen as Origen)
    ? (body?.origen as Origen)
    : null;
  if (!origen) {
    return NextResponse.json(
      { ok: false, error: "Origen no válido." },
      { status: 400 }
    );
  }

  if (origen === "manual") {
    const token = typeof body?.token === "string" ? body.token.trim() : "";
    // Si eligió "manual" y no pegó nada, se le dice: guardar un origen sin
    // token dejaría el CAPI apuntando a la nada sin avisar.
    if (!token && !getMetaRuntimeSetting("capi_access_token")) {
      return NextResponse.json(
        { ok: false, error: "Pega el token antes de guardar esta opción." },
        { status: 400 }
      );
    }
    if (token) setMetaRuntimeSettings({ capi_access_token: token });
  }

  setMetaRuntimeSettings({ capi_token_origen: origen });
  return NextResponse.json({ ok: true, ...estado() });
}

/** Vuelve al comportamiento por defecto y borra el token pegado a mano. */
export async function DELETE() {
  deleteMetaRuntimeSettings(["capi_token_origen", "capi_access_token"]);
  return NextResponse.json({ ok: true, ...estado() });
}

/**
 * Le pregunta a Meta si este token puede ver el dataset.
 *
 * Es una LECTURA a propósito: no escribe ningún evento, así que probar no
 * ensucia tus datos ni cuenta como una venta. Si Meta devuelve el nombre del
 * pixel, el token tiene acceso.
 */
export async function PUT(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    codigoDePrueba?: unknown;
    cuenta?: unknown;
    pixelId?: unknown;
  };
  const codigoDePrueba =
    typeof body?.codigoDePrueba === "string" ? body.codigoDePrueba.trim() : "";
  // PROBAR UNA CUENTA CONCRETA — la parte 2 de PLAN-VARIAS-CUENTAS-DE-FACEBOOK.md.
  //
  // Con `cuenta`, se prueba con el permiso con el que se miden las compras de ESA cuenta:
  // la misma regla que usa el envío real (`elPermisoDeLaTienda` en conversions.ts) — su
  // permiso si lo tiene, y si no, el de siempre. Sin `cuenta`, la prueba de siempre.
  const cuenta = typeof body?.cuenta === "string" ? body.cuenta.trim() : "";
  const pixelPedido = typeof body?.pixelId === "string" ? body.pixelId.trim() : "";
  const delaCuenta = cuenta ? permisoDeMedicionDeLaCuenta(cuenta) : null;
  const conPermisoDeLaCuenta = Boolean(delaCuenta);
  const token = delaCuenta ?? getCapiAccessToken();
  const pixelId = pixelPedido || getCapiPixelId();
  if (!token) {
    return NextResponse.json({
      ok: false,
      error: "No hay ningún token disponible todavía.",
    });
  }
  if (!pixelId) {
    return NextResponse.json({
      ok: false,
      error: "Elige primero el pixel al que se le reportan las compras.",
    });
  }

  // Se pregunta lo MÍNIMO primero. Pedir de más hace fallar la prueba por un
  // permiso que el envío de eventos no necesita: preguntar por el negocio dueño
  // devolvía "Missing Permission" aunque el token pudiera ver el dataset.
  const preguntar = async (campos: string) => {
    const url = new URL(
      `https://graph.facebook.com/${graphVersion()}/${pixelId}`
    );
    url.searchParams.set("fields", campos);
    const res = await fetch(url, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}` },
    });
    const cuerpo = (await res.json().catch(() => null)) as {
      name?: string;
      owner_business?: { name?: string };
      error?: { message?: string };
    } | null;
    return { ok: res.ok, status: res.status, cuerpo };
  };

  try {
    const minimo = await preguntar("name");
    if (!minimo.ok) {
      return NextResponse.json({
        ok: false,
        origen: getCapiTokenOrigen(),
        conPermisoDeLaCuenta,
        error:
          minimo.cuerpo?.error?.message ??
          `Meta respondió ${minimo.status} y no dio detalle.`,
      });
    }

    // El dueño es un extra para el mensaje. Si no se puede leer, no importa:
    // no hace falta para mandar eventos.
    const conDueno = await preguntar("name,owner_business");

    // Ver el dataset es buena señal, pero no es lo mismo que poder mandarle
    // eventos: son permisos distintos. Con un código de prueba se hace la
    // comprobación de verdad — mandar una compra — y Meta la deja en la pestaña
    // "Probar eventos", sin contarla como venta ni ensuciar los datos.
    let envio: { ok: boolean; detalle: string } | null = null;
    if (codigoDePrueba) {
      const ahora = Math.floor(Date.now() / 1000);
      const respuesta = await fetch(
        `https://graph.facebook.com/${graphVersion()}/${pixelId}/events`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            access_token: token,
            test_event_code: codigoDePrueba,
            data: [
              {
                event_name: "Purchase",
                event_time: ahora,
                event_id: `prueba_capi_${ahora}`,
                action_source: "system_generated",
                user_data: {
                  // Un teléfono de ejemplo, hasheado como exige Meta. No es de
                  // ningún cliente real.
                  ph: [
                    createHash("sha256").update("51999888777").digest("hex"),
                  ],
                },
                custom_data: { value: 1, currency: "PEN" },
              },
            ],
          }),
        }
      );
      const texto = await respuesta.text();
      envio = { ok: respuesta.ok, detalle: texto };
    }

    return NextResponse.json({
      ok: true,
      origen: getCapiTokenOrigen(),
      conPermisoDeLaCuenta,
      pixelId,
      pixelNombre: minimo.cuerpo?.name ?? null,
      negocio: conDueno.ok
        ? conDueno.cuerpo?.owner_business?.name ?? null
        : null,
      envio,
    });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : "No se pudo consultar a Meta.",
    });
  }
}
