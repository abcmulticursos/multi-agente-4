import { createHmac } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import {
  getActiveMetaWhatsAppConnection,
  getMetaRuntimeSetting,
  guardarPermisoPermanenteDeCuenta,
  permisoDeConexionDeLaCuenta,
  setMetaRuntimeSettings,
} from "@/lib/db";
import { permisosConocidos, repartirTokenPermanente } from "@/lib/meta/token-por-numero";
import { graphVersion } from "@/lib/meta/connect";
import {
  getMetaAppId,
  getMetaOAuthAppSecret,
  getTokenDeLaConexion,
} from "@/lib/meta/runtime-config";
import {
  sugerenciaTokenPermanente,
  type IntentoDeToken,
} from "@/lib/meta/errores-token-permanente";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Los permisos que se le piden al token, de MÁS a MENOS.
 *
 * Si se pide un permiso que la app no tiene, Meta rechaza la llamada ENTERA y
 * el token no sale: no devuelve "los que sí puedo". Por eso no se pide todo de
 * golpe ni se pide lo mínimo y ya: se intenta la lista larga y, si la rechaza,
 * se baja un escalón. Así el token se lleva todo lo que la app permita y nunca
 * queda sin generarse.
 *
 * El último escalón son los cuatro que el bot necesita de verdad para funcionar:
 * mandar y recibir WhatsApp, y reportar las compras.
 */
const ESCALERA_DE_PERMISOS = [
  // Todo lo que el bot podría llegar a usar, incluidos página e Instagram.
  [
    "whatsapp_business_messaging",
    "whatsapp_business_management",
    "whatsapp_business_manage_events",
    "ads_read",
    "ads_management",
    "business_management",
    "pages_messaging",
    "pages_show_list",
    "pages_read_engagement",
    "pages_manage_metadata",
    "instagram_basic",
    "instagram_manage_messages",
  ],
  // Sin Instagram, que es lo que menos apps tienen aprobado.
  [
    "whatsapp_business_messaging",
    "whatsapp_business_management",
    "ads_read",
    "business_management",
    "pages_messaging",
    "pages_show_list",
    "pages_read_engagement",
    "pages_manage_metadata",
  ],
  // Lo imprescindible.
  [
    "whatsapp_business_messaging",
    "whatsapp_business_management",
    "ads_read",
    "business_management",
  ],
].map((lista) => lista.join(","));

/** Meta exige firmar la llamada con el secreto de la app. */
function pruebaDeSecreto(token: string, appSecret: string): string {
  return createHmac("sha256", appSecret).update(token).digest("hex");
}

async function graph(
  path: string,
  token: string,
  appSecret: string,
  extra: Record<string, string> = {}
) {
  const url = new URL(`https://graph.facebook.com/${graphVersion()}/${path}`);
  for (const [clave, valor] of Object.entries(extra)) {
    url.searchParams.set(clave, valor);
  }
  url.searchParams.set("access_token", token);
  url.searchParams.set("appsecret_proof", pruebaDeSecreto(token, appSecret));
  const res = await fetch(url, { cache: "no-store" });
  const cuerpo = (await res.json().catch(() => null)) as
    | (Record<string, unknown> & { error?: { message?: string } })
    | null;
  return { ok: res.ok, cuerpo };
}

/**
 * Genera un token PERMANENTE de usuario del sistema, para no tener que pegarlo
 * a mano ni volver a conectar cada dos meses.
 *
 * El token que entrega el "Conectar con Meta" dura unos 60 días. Este no vence.
 *
 * Meta pide tres cosas: que la app esté instalada en el negocio, que exista un
 * usuario del sistema en ese mismo negocio, y que quien llame sea administrador
 * de él. Si algo de eso falta, Meta lo rechaza y se muestra su respuesta tal
 * cual — no se reintenta en bucle, se prueba una vez por usuario del sistema y
 * se para.
 */
export async function POST(req: NextRequest) {
  /**
   * EL PERMANENTE DE UNA CUENTA CONCRETA — parte 2 de PLAN-VARIAS-CUENTAS-DE-FACEBOOK.md.
   *
   * Con `cuenta`, se genera con el permiso del login de ESA cuenta, solo en su negocio, y
   * se guarda SOLO en su cuenta: mide las compras de sus tiendas. No toca los permisos
   * globales — ni el de WhatsApp ni el de las compras de siempre —, porque el de una
   * cuenta no sirve para las demás.
   *
   * Sin `cuenta`, exactamente lo de siempre.
   */
  const cuerpoPedido = (await req.json().catch(() => null)) as { cuenta?: unknown; negocio?: unknown } | null;
  const cuenta = typeof cuerpoPedido?.cuenta === "string" ? cuerpoPedido.cuenta.trim() : "";
  // EN UN BM CONCRETO (20/10/2026): el asistente lo pide en el BM de los números, para que el
  // token pueda usarlos. Se guarda igual que el de siempre; solo se elige dónde se crea.
  const negocioPedido = typeof cuerpoPedido?.negocio === "string" ? cuerpoPedido.negocio.trim() : "";
  const appId = getMetaAppId();
  const appSecret = getMetaOAuthAppSecret();
  let token = cuenta ? permisoDeConexionDeLaCuenta(cuenta) : getTokenDeLaConexion();
  // CON UN BM ELEGIDO, EL PERMISO QUE LO VE (21/10/2026): el de la conexión puede ser de otra
  // cuenta de Facebook, o ya no ver nada; se busca entre todos los guardados el que ve ese BM.
  if (!cuenta && negocioPedido && appSecret) {
    for (const candidato of permisosConocidos()) {
      const r = await graph("me/businesses", candidato, appSecret, { fields: "id", limit: "200" });
      if (Array.isArray(r.cuerpo?.data) && (r.cuerpo.data as Array<{ id?: string }>).some((b) => b.id === negocioPedido)) {
        token = candidato;
        break;
      }
    }
  }

  if (!token) {
    return NextResponse.json({
      ok: false,
      error: cuenta
        ? "Esta cuenta no tiene permiso guardado. Conéctala con «Conectar nueva cuenta» o «Actualizar lista de Meta»."
        : "Primero conecta con Meta: el token permanente se genera usando el de la conexión.",
    });
  }
  if (!appId || !appSecret) {
    return NextResponse.json({
      ok: false,
      error: "Faltan el ID de la app o su clave secreta.",
    });
  }

  // Se guardan con estructura, no como texto suelto: así se puede deducir en
  // qué negocio vive la app y decir qué hacer, en vez de volcar rechazos.
  const intentos: IntentoDeToken[] = [];

  const negocios = await graph("me/businesses", token, appSecret, {
    fields: "id,name",
  });
  const todosLosNegocios = Array.isArray(negocios.cuerpo?.data)
    ? (negocios.cuerpo.data as Array<{ id?: string; name?: string }>)
    : [];
  // Con una cuenta pedida, solo su negocio: un usuario del sistema de otro negocio daría
  // un permiso que no puede medir sus compras.
  const listaNegocios = cuenta
    ? todosLosNegocios.filter((n) => n.id === cuenta)
    : negocioPedido
      ? todosLosNegocios.filter((n) => n.id === negocioPedido)
      : todosLosNegocios;
  if (!listaNegocios.length) {
    return NextResponse.json({
      ok: false,
      error:
        negocios.cuerpo?.error?.message ??
        "No pude ver ningún negocio con este login.",
    });
  }

  for (const negocio of listaNegocios) {
    if (!negocio.id) continue;
    const usuarios = await graph(
      `${negocio.id}/system_users`,
      token,
      appSecret,
      { fields: "id,name" }
    );
    const lista = Array.isArray(usuarios.cuerpo?.data)
      ? (usuarios.cuerpo.data as Array<{ id?: string; name?: string }>)
      : [];
    if (!lista.length) {
      intentos.push({
        negocio: negocio.name ?? negocio.id,
        usuario: null,
        mensaje: "no tiene ningún usuario del sistema",
      });
      continue;
    }

    for (const usuario of lista) {
      if (!usuario.id) continue;

      // PRIMERO se instala la app para ese usuario del sistema. Sin esto, pedir
      // el token devuelve "Unsupported request": el id del usuario solo sirve
      // para una app que tenga instalada. Es el mismo paso que hace Meta por
      // detrás cuando pulsas "Generar token" en su pantalla.
      //
      // Si ya estaba instalada, esta llamada falla y da igual: se sigue al
      // token, que es lo que importa.
      let errorAlInstalar: string | null = null;
      try {
        const instalar = new URL(
          `https://graph.facebook.com/${graphVersion()}/${usuario.id}/applications`
        );
        const respuesta = await fetch(instalar, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            business_app: appId,
            access_token: token,
            appsecret_proof: pruebaDeSecreto(token, appSecret),
          }),
        });
        if (!respuesta.ok) {
          const cuerpo = (await respuesta.json().catch(() => null)) as {
            error?: { message?: string };
          } | null;
          errorAlInstalar = cuerpo?.error?.message ?? `instalar: ${respuesta.status}`;
        }
      } catch {
        errorAlInstalar = "no se pudo instalar la app";
      }

      const url = new URL(
        `https://graph.facebook.com/${graphVersion()}/${usuario.id}/access_tokens`
      );

      // Se baja por la escalera hasta que Meta acepte una lista.
      let cuerpo: { access_token?: string; error?: { message?: string } } | null =
        null;
      let res: Response | null = null;
      let permisosLogrados = "";
      for (const permisos of ESCALERA_DE_PERMISOS) {
        res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            business_app: appId,
            scope: permisos,
            // false = sin fecha de caducidad, que es justo lo que se busca.
            set_token_expires_in_60_days: false,
            access_token: token,
            appsecret_proof: pruebaDeSecreto(token, appSecret),
          }),
        });
        cuerpo = (await res.json().catch(() => null)) as {
          access_token?: string;
          error?: { message?: string };
        } | null;
        if (res.ok && typeof cuerpo?.access_token === "string") {
          permisosLogrados = permisos;
          break;
        }
      }

      if (res?.ok && typeof cuerpo?.access_token === "string") {
        if (cuenta) {
          // El de una cuenta va SOLO a su cuenta. Ver el comentario de arriba.
          guardarPermisoPermanenteDeCuenta(cuenta, cuerpo.access_token);
        } else {
          // CADA NÚMERO CON EL TOKEN DE SU BM (21/10/2026): «para usar los números del otro
          // usuario… crear el token permanente, que no reemplazará al tuyo». Se le pregunta a
          // Meta, número por número, si este token lo alcanza; solo a esos se les pone.
          const nuevo = cuerpo.access_token;
          // (Al crearlo de nuevo en el mismo BM, el nuevo reemplaza al viejo en sus números.)
          const alcanzados = await repartirTokenPermanente(nuevo, true);

          // El general (el de los envíos sin número propio y el de las compras) solo se
          // cambia si no había ninguno o si este alcanza el número ACTIVO: un token de otro
          // BM no puede dejar sin permiso al número que ya funcionaba.
          const activo = getActiveMetaWhatsAppConnection();
          const habia = getMetaRuntimeSetting("whatsapp_access_token_override");
          const alcanzaAlActivo = !!activo && alcanzados.some((c) => c.phone_number_id === activo.phone_number_id);
          if (!habia || alcanzaAlActivo) {
            setMetaRuntimeSettings({
              whatsapp_access_token_override: nuevo,
              token_permanente_negocio_id: negocio.id,
              token_permanente_negocio: negocio.name ?? negocio.id,
            });
          }
          if (!getMetaRuntimeSetting("capi_access_token") || alcanzaAlActivo) {
            setMetaRuntimeSettings({ capi_access_token: nuevo, capi_token_origen: "manual" });
          }
          return NextResponse.json({
            ok: true,
            negocio: negocio.name ?? negocio.id,
            usuario: usuario.name ?? usuario.id,
            permisos: permisosLogrados.split(","),
            numeros: alcanzados.map((c) => c.display_phone_number ?? c.phone_number_id),
          });
        }
        return NextResponse.json({
          ok: true,
          negocio: negocio.name ?? negocio.id,
          usuario: usuario.name ?? usuario.id,
          permisos: permisosLogrados.split(","),
        });
      }

      intentos.push({
        negocio: negocio.name ?? negocio.id,
        usuario: usuario.name ?? usuario.id,
        // Si tampoco se pudo instalar, ese error explica el del token: se
        // muestran juntos en vez de dejar el segundo sin contexto.
        mensaje: `${cuerpo?.error?.message ?? `Meta respondió ${res?.status}`}${
          errorAlInstalar ? ` (al instalar la app: ${errorAlInstalar})` : ""
        }`,
      });
    }
  }

  return NextResponse.json({
    ok: false,
    error: "Meta no dejó generar el token permanente.",
    sugerencia: sugerenciaTokenPermanente(intentos),
    intentos: intentos.map(
      (intento) =>
        `${intento.negocio}${intento.usuario ? ` / ${intento.usuario}` : ""}: ${intento.mensaje}`
    ),
  });
}
