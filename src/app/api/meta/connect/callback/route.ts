import { NextResponse, type NextRequest } from "next/server";
import { olvidar } from "@/lib/meta/recuerdo";
import {
  apuntarCuentaDeLaPagina,
  apuntarCuentaDelNumero,
  getMetaConnectionByPageId,
  getMetaWhatsAppConnection,
  guardarPermisoDeConexionDeCuentas,
  leerListaDeAcceso,
  listPermisosDeCuentas,
  listMetaConnections,
  listMetaWhatsAppConnections,
  saveMetaConnection,
  saveMetaDetectedEnv,
  saveMetaWhatsAppConnection,
  getMetaRuntimeSetting,
  setMetaRuntimeSettings,
} from "@/lib/db";
import {
  META_CONNECT_COOKIE,
  META_CONNECT_INSTAGRAM_COOKIE,
  META_CONNECT_NUEVA_COOKIE,
  accesoDeLasPaginas,
  conMemoriaDeMeta,
  cuentaDeLaPagina,
  cuentaDeLaWaba,
  detectMetaEnvFromUserToken,
  exchangeCodeForUserToken,
  fetchBusinesses,
  fetchConnectedPages,
  fetchCuentaDeFacebook,
  fetchPixelOptions,
  fetchWhatsAppOptions,
  getPublicOrigin,
  type CuentaDeMeta,
  type MetaPixelOption,
} from "@/lib/meta/connect";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * CON QUÉ CUENTAS ESTÁ COMPARTIDO ALGO, DESPUÉS DE ESTE LOGIN.
 *
 * Este login solo sabe de SUS negocios. Así que lo que diga de ellos manda —si dejaron de
 * compartir, se quitan—, y lo que había apuntado de negocios que no ve se conserva: no
 * puede saber si siguen compartiendo. Es la misma regla que `juntarPixeles`.
 */
function juntarAcceso(
  guardado: string | null | undefined,
  vistoAhora: CuentaDeMeta[],
  negociosDelLogin: CuentaDeMeta[]
): CuentaDeMeta[] {
  const delLogin = new Set(negociosDelLogin.map((n) => n.id));
  const queSeQuedan = leerListaDeAcceso(guardado).filter((c) => !delLogin.has(c.id));
  const resultado = [...vistoAhora];
  for (const c of queSeQuedan) {
    if (!resultado.some((r) => r.id === c.id)) resultado.push(c);
  }
  return resultado;
}

/**
 * LA LISTA DE PÍXELES DESPUÉS DE ESTE LOGIN: los suyos se renuevan y los de otras
 * cuentas se quedan.
 *
 * ANTES SE REEMPLAZABA ENTERA, y con una sola cuenta daba igual. Con dos, entrar con la
 * segunda borraba de los selectores los píxeles de la primera.
 *
 *   · Lo que este login ve, entra tal como viene (nombre y dueño al día).
 *   · Lo que tenía antes y este login NO ve, se queda solo si es de una cuenta que este
 *     login no administra Y que entró como «nueva» — o si este login es el de una
 *     cuenta nueva, que nunca borra nada de la principal.
 *
 * CON UNA SOLA CUENTA QUEDA COMO ANTES: no hay cuentas «nuevas», así que un píxel que
 * ya no aparece se va, igual que cuando se reemplazaba.
 */
function juntarPixeles(
  deEsteLogin: MetaPixelOption[],
  negociosDelLogin: CuentaDeMeta[],
  nuevaCuenta: boolean
): MetaPixelOption[] {
  let anteriores: MetaPixelOption[] = [];
  try {
    const crudo = getMetaRuntimeSetting("pixels_detectados");
    const parsed = crudo ? JSON.parse(crudo) : [];
    anteriores = Array.isArray(parsed)
      ? parsed.filter((p): p is MetaPixelOption => typeof p?.pixelId === "string")
      : [];
  } catch {
    anteriores = [];
  }
  const vistos = new Set(deEsteLogin.map((p) => p.pixelId));
  const delLogin = new Set(negociosDelLogin.map((n) => n.id));
  const cuentasNuevas = new Set(
    listPermisosDeCuentas()
      .filter((c) => c.origen === "nueva")
      .map((c) => c.id)
  );
  const queSeQuedan = anteriores.filter(
    (p) =>
      !vistos.has(p.pixelId) &&
      !delLogin.has(p.businessId) &&
      (nuevaCuenta || cuentasNuevas.has(p.businessId))
  );
  // Los que este login SÍ ve conservan las cuentas de acceso que apuntó otro login: este
  // solo puede hablar de sus negocios. Ver `juntarAcceso`.
  const renovados = deEsteLogin.map((p) => {
    const antes = anteriores.find((a) => a.pixelId === p.pixelId);
    if (!antes?.accesoDe?.length) return p;
    return {
      ...p,
      accesoDe: juntarAcceso(
        JSON.stringify(antes.accesoDe),
        p.accesoDe ?? [],
        negociosDelLogin
      ),
    };
  });
  return [...renovados, ...queSeQuedan];
}

/**
 * LO YA CONECTADO QUE SIGUE SIN CUENTA, IDENTIFICADO CON SU PROPIO PERMISO.
 *
 * Las conexiones de antes del 09/10/2026 se guardaron sin dueño, y el plan dice que se
 * identifican al pulsar «Actualizar lista de Meta» (PLAN-VARIAS-CUENTAS-DE-FACEBOOK.md).
 *
 * ── POR QUÉ CON EL PERMISO DE CADA UNO Y NO CON EL DEL LOGIN ──────────────────
 *
 * Con el del login solo se identificaría lo de la cuenta con la que él acaba de entrar.
 * Para lo de la OTRA tendría que entrar con la otra — y eso reemplaza el permiso
 * global con el que se miden las compras, que es justo el peligro de la parte 2. Cada
 * número y cada página guardan ya el suyo: con ése se pregunta, y no hace falta
 * entrar con nadie más.
 *
 * Solo escribe la cuenta. No toca permisos ni cuál está activa. Y nunca lanza: un
 * número que Meta no sepa ubicar se queda «sin identificar», como estaba.
 */
async function identificarLasCuentasQueFaltan(): Promise<void> {
  for (const fila of listMetaWhatsAppConnections()) {
    if (fila.business_id || !fila.access_token) continue;
    const dueño = await cuentaDeLaWaba(fila.waba_id, fila.access_token);
    if (dueño) apuntarCuentaDelNumero(fila.phone_number_id, dueño);
  }
  for (const fila of listMetaConnections()) {
    if (fila.business_id || !fila.page_access_token) continue;
    const dueño = await cuentaDeLaPagina(fila.page_id, fila.page_access_token);
    if (dueño) apuntarCuentaDeLaPagina(fila.page_id, dueño);
  }
}

export async function GET(req: NextRequest) {
  // Un inicio de sesión nuevo puede traer otros BM y números: lo recordado deja de valer.
  olvidar();
  // Cada pregunta a Meta, UNA vez en todo el inicio de sesión (ver `conMemoriaDeMeta`).
  return conMemoriaDeMeta(() => iniciarSesion(req));
}

async function iniciarSesion(req: NextRequest) {
  const url = new URL(req.url);
  const publicOrigin = getPublicOrigin(req);
  const redirectToMetaConnect = (query: string) =>
    NextResponse.redirect(new URL(`/meta-connect?${query}`, publicOrigin));
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const metaError =
    url.searchParams.get("error_message") ??
    url.searchParams.get("error_description") ??
    url.searchParams.get("error_reason") ??
    url.searchParams.get("error");
  const metaErrorCode = url.searchParams.get("error_code");
  const cookieState = req.cookies.get(META_CONNECT_COOKIE)?.value;
  const includeInstagram =
    req.cookies.get(META_CONNECT_INSTAGRAM_COOKIE)?.value === "1";
  // «Conectar nueva cuenta»: entra otra cuenta y NO se toca nada de la de siempre —
  // ni su permiso, ni el número activo, ni sus píxeles. Ver PLAN-VARIAS-CUENTAS-DE-
  // FACEBOOK.md, apartado 5.
  const nuevaCuenta = req.cookies.get(META_CONNECT_NUEVA_COOKIE)?.value === "1";

  if (!code) {
    const detail = metaError
      ? `${metaErrorCode ? `${metaErrorCode}: ` : ""}${metaError}`
      : "Meta no devolvio codigo de autorizacion. Reintenta desde el boton Conectar con Meta.";
    return redirectToMetaConnect(`error=${encodeURIComponent(detail)}`);
  }
  if (!state || !cookieState || state !== cookieState) {
    return redirectToMetaConnect("error=bad_state");
  }

  try {
    const redirectUri = `${publicOrigin}/api/meta/connect/callback`;
    const userToken = await exchangeCodeForUserToken(code, redirectUri);
    const pages = await fetchConnectedPages(userToken, includeInstagram);
    // Los negocios que ve este login: a cada uno se le guarda su permiso más abajo.
    const negociosDelLogin = await fetchBusinesses(userToken);
    // Y quién entró (Claudio, Alberto…), para decir de qué cuenta es cada negocio.
    const quienEntro = await fetchCuentaDeFacebook(userToken);
    if (!nuevaCuenta) {
      // El token del login se guarda aparte. Antes solo quedaba pegado a cada
      // número de WhatsApp, así que quien conectaba sin tener un número todavía
      // se quedaba sin token guardado — y sin poder generar el permanente.
      //
      // CON «Conectar nueva cuenta» NO SE GUARDA AQUÍ: este es el permiso de siempre,
      // el que mide las compras de la cuenta principal, y reemplazarlo por el de otra
      // cuenta es justo lo que apagaba su medición. El de la nueva va a su cuenta.
      setMetaRuntimeSettings({ meta_user_token: userToken });
    }

    const whatsAppOptions = await fetchWhatsAppOptions(userToken);

    // Los pixels se guardan para poder elegirlos después en la pantalla. Si hay
    // uno solo y todavía no se eligió ninguno, queda preseleccionado: con un
    // único pixel no hay nada que decidir. Con varios NO se elige por ti —
    // quedarse con el primero que devuelva Meta sería adivinar.
    try {
      const pixelOptions = await fetchPixelOptions(userToken);
      const ajustes: Record<string, string> = {
        pixels_detectados: JSON.stringify(
          juntarPixeles(pixelOptions, negociosDelLogin, nuevaCuenta)
        ),
      };
      // Con una cuenta nueva no se preselecciona nada: el píxel de Meta Connect es el
      // de la cuenta principal.
      if (
        !nuevaCuenta &&
        pixelOptions.length === 1 &&
        !getMetaRuntimeSetting("capi_pixel_id")
      ) {
        ajustes.capi_pixel_id = pixelOptions[0].pixelId;
      }
      setMetaRuntimeSettings(ajustes);
    } catch (err) {
      console.error("[meta-connect] no pude listar los pixels:", err);
    }

    // Con qué cuentas está compartida cada página. Consulta aparte y tolerante.
    // De paso se anota el DUEÑO de cada una (el BM que la tiene como propia).
    const duenosDePaginas = new Map<string, { id: string; nombre: string | null }>();
    const accesoPaginas = await accesoDeLasPaginas(userToken, negociosDelLogin, duenosDePaginas);
    for (const page of pages) {
      // De qué cuenta es: si ya se supo arriba, sin preguntar (21/10/2026: una consulta por
      // página en cada inicio de sesión). Si no, consulta aparte; si falla, se guarda igual.
      const dueño = duenosDePaginas.get(page.pageId) ?? (await cuentaDeLaPagina(page.pageId, page.pageAccessToken));
      const vistoAhora = [...(accesoPaginas.get(page.pageId) ?? [])];
      if (dueño && !vistoAhora.some((c) => c.id === dueño.id)) vistoAhora.unshift(dueño);
      saveMetaConnection({
        ...page,
        businessId: dueño?.id ?? null,
        businessName: dueño?.nombre ?? null,
        compartidoCon: juntarAcceso(
          getMetaConnectionByPageId(page.pageId)?.compartido_con,
          vistoAhora,
          negociosDelLogin
        ),
        // Detectar no equivale a conectar: el operador decide que pagina
        // trabajara este agente desde el panel.
        // Si Meta devolvio una unica pagina, mostrarla como elegida conserva
        // la conexion visual sin activar ningun webhook ni Messenger.
        selected: pages.length === 1,
      });
    }
    for (const option of whatsAppOptions) {
      saveMetaWhatsAppConnection({
        ...option,
        compartidoCon: juntarAcceso(
          getMetaWhatsAppConnection(option.phoneNumberId)?.compartido_con,
          option.accesoDe,
          negociosDelLogin
        ),
        accessToken: userToken,
        // Con un unico numero no hay riesgo de cruzar productos o canales.
        // Con varios, el operador sigue eligiendo expresamente uno.
        //
        // CON «Conectar nueva cuenta», NUNCA. El activo es el número que usa el bot
        // cuando un mensaje no viene de ninguna conversación; la cuenta nueva solo ve
        // los suyos, y con uno solo se lo quitaba a la cuenta principal sin preguntar.
        active: !nuevaCuenta && whatsAppOptions.length === 1,
      });
    }
    // Las variables detectadas describen la cuenta principal; una nueva no las pisa.
    if (!nuevaCuenta) {
      const detected = await detectMetaEnvFromUserToken(userToken, pages);
      saveMetaDetectedEnv(detected.values, "Meta Connect");
    }
    // EL PERMISO DE ESTE LOGIN, GUARDADO EN CADA CUENTA QUE VE. Es lo que deja que cada
    // tienda mida con el de la suya. Ver `permisoDeMedicionDeLaCuenta` en db.ts.
    try {
      guardarPermisoDeConexionDeCuentas(
        negociosDelLogin,
        userToken,
        nuevaCuenta ? "nueva" : "principal",
        quienEntro
      );
    } catch (err) {
      console.error("[meta-connect] no pude guardar el permiso de las cuentas:", err);
    }
    // Nada de esto puede tumbar la conexión: lo de arriba ya quedó guardado.
    try {
      await identificarLasCuentasQueFaltan();
    } catch (err) {
      console.error("[meta-connect] no pude identificar las cuentas:", err);
    }

    const res = redirectToMetaConnect(`connected=${pages.length}`);
    res.cookies.delete(META_CONNECT_COOKIE);
    res.cookies.delete(META_CONNECT_INSTAGRAM_COOKIE);
    res.cookies.delete(META_CONNECT_NUEVA_COOKIE);
    return res;
  } catch (err) {
    const message = encodeURIComponent(
      err instanceof Error ? err.message : String(err)
    );
    return redirectToMetaConnect(`error=${message}`);
  }
}
