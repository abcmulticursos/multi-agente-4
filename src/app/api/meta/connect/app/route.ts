import { NextResponse } from "next/server";
import { graphVersion } from "@/lib/meta/connect";
import {
  getMetaAppId,
  getMetaOAuthAppSecret,
  getTokenDeLaConexion,
} from "@/lib/meta/runtime-config";
import { MINUTOS, recordar } from "@/lib/meta/recuerdo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Qué app está configurada y a qué negocio pertenece.
 *
 * Es la pregunta que hay detrás del error (#3953) "Provided application does
 * not belong to the business": el token permanente solo se puede generar en el
 * negocio DUEÑO de la app. Verlo antes de intentarlo ahorra el paseo por todos
 * los negocios recogiendo rechazos.
 *
 * El nombre se pide con el token de la propia app, que siempre puede verse a sí
 * misma. El negocio se busca con el token de la conexión, y puede no salir: la
 * consulta necesita permisos de anuncios que el login no siempre trae. Cuando
 * no sale, se dice — no se da por hecho que la app no tenga negocio.
 */
export async function GET() {
  const appId = getMetaAppId();
  const appSecret = getMetaOAuthAppSecret();
  if (!appId || !appSecret) {
    return NextResponse.json({
      configurada: false,
      aviso: "Falta el ID de la app o su clave secreta.",
    });
  }
  // RECORDADO 10 MINUTOS (21/10/2026): para el negocio de la app se recorren todos los BM, dos
  // preguntas por cada uno; repetirlo en cada apertura de Meta Connect hizo que Meta frenara la
  // app («#4»). Cambiar de app cambia la clave, así que se lee de nuevo.
  const datos = await recordar(`app:${appId}`, MINUTOS(10), () => leerApp(appId, appSecret));
  return NextResponse.json(datos, { headers: { "Cache-Control": "no-store" } });
}

async function leerApp(appId: string, appSecret: string) {

  // Token de aplicación: se arma con el id y el secreto, sin pedirle nada a nadie.
  const tokenDeApp = `${appId}|${appSecret}`;
  let nombre: string | null = null;
  let avisoNombre: string | null = null;
  try {
    const url = new URL(`https://graph.facebook.com/${graphVersion()}/${appId}`);
    url.searchParams.set("fields", "name");
    url.searchParams.set("access_token", tokenDeApp);
    const res = await fetch(url, { cache: "no-store" });
    const cuerpo = (await res.json().catch(() => null)) as {
      name?: string;
      error?: { message?: string };
    } | null;
    if (res.ok && typeof cuerpo?.name === "string") nombre = cuerpo.name;
    else avisoNombre = cuerpo?.error?.message ?? `Meta respondió ${res.status}`;
  } catch {
    avisoNombre = "No se pudo consultar a Meta.";
  }

  // A qué negocio pertenece. Se recorren los negocios del login buscando la app
  // entre las suyas y entre las que le compartieron.
  const token = getTokenDeLaConexion();
  let negocio: string | null = null;
  let avisoNegocio: string | null = null;

  if (!token) {
    avisoNegocio = "Conecta con Meta para poder comprobar el negocio.";
  } else {
    try {
      const url = new URL(
        `https://graph.facebook.com/${graphVersion()}/me/businesses`
      );
      url.searchParams.set("fields", "id,name");
      url.searchParams.set("access_token", token);
      const res = await fetch(url, { cache: "no-store" });
      const cuerpo = (await res.json().catch(() => null)) as {
        data?: Array<{ id?: string; name?: string }>;
      } | null;
      const negocios = cuerpo?.data ?? [];

      for (const uno of negocios) {
        if (!uno.id || negocio) continue;
        for (const borde of ["owned_apps", "client_apps"]) {
          const consulta = new URL(
            `https://graph.facebook.com/${graphVersion()}/${uno.id}/${borde}`
          );
          consulta.searchParams.set("fields", "id");
          consulta.searchParams.set("limit", "200");
          consulta.searchParams.set("access_token", token);
          const respuesta = await fetch(consulta, { cache: "no-store" });
          if (!respuesta.ok) continue;
          const lista = (await respuesta.json().catch(() => null)) as {
            data?: Array<{ id?: string }>;
          } | null;
          if ((lista?.data ?? []).some((app) => app.id === appId)) {
            negocio = uno.name ?? uno.id;
            break;
          }
        }
      }
      if (!negocio) {
        avisoNegocio =
          "No pude ver a qué negocio pertenece la app. Puede ser que el login no tenga permiso para listar las apps de tus negocios, o que la app no esté en ninguno.";
      }
    } catch {
      avisoNegocio = "No se pudo consultar a Meta.";
    }
  }

  return { configurada: true, appId, nombre, negocio, avisoNombre, avisoNegocio };
}
