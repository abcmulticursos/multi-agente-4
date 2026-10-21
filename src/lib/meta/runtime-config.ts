import { AsyncLocalStorage } from "node:async_hooks";
import {
  getActiveMetaWhatsAppConnection,
  getMetaRuntimeSetting,
  listMetaWhatsAppConnections,
  getMetaWhatsAppConnection,
} from "@/lib/db";

/**
 * NUMERO DE SALIDA DE ESTE MENSAJE.
 *
 * Un bot puede tener varios numeros de WhatsApp conectados (Meta permite 2 por
 * app). A cada cliente hay que contestarle por el MISMO numero al que escribio:
 * es lo que espera y es lo que Meta exige para responder dentro de la ventana.
 *
 * Pasar el numero como parametro obligaria a tocar las 9 funciones de envio y
 * todas sus llamadas. En vez de eso se usa AsyncLocalStorage: un "contexto" que
 * viaja pegado al procesamiento de ESE mensaje, aunque haya varias
 * conversaciones a la vez. Cada una ve el suyo; no hay variable global que se
 * pisen entre ellas.
 *
 * Sin contexto fijado (o si el numero ya no esta conectado) se cae al numero
 * ACTIVO, que es exactamente el comportamiento anterior. Por eso con un solo
 * numero conectado nada cambia.
 */
const numeroDeSalida = new AsyncLocalStorage<string>();

/** Ejecuta `fn` respondiendo por `phoneNumberId`. */
export function withOutboundWhatsAppNumber<T>(
  phoneNumberId: string | null | undefined,
  fn: () => T
): T {
  if (!phoneNumberId) return fn();
  return numeroDeSalida.run(phoneNumberId, fn);
}

/** Por que numero nuestro se esta respondiendo ahora mismo. null fuera de un
 *  mensaje entrante o de una accion programada. */
export function getOutboundWhatsAppNumber(): string | null {
  return numeroDeSalida.getStore() ?? null;
}

/**
 * LA PAGINA DE FACEBOOK POR LA QUE SE ESTA RESPONDIENDO — el gemelo del de arriba.
 *
 * LO PIDIO EL DUEÑO el 01/10/2026, al montar su segundo numero: «¿como se va a
 * manejar el tema de los webhooks de messenger ya que yo voy a usar 2 paginas y solo
 * hay un webhook?». Y luego: «recuerda que vamos a usar muchos numeros».
 *
 * EL FALLO QUE HABIA: Messenger atendia SOLO la pagina activa. Un mensaje de la
 * segunda pagina se tiraba con un `continue` y el cliente se quedaba sin respuesta —
 * sin error, solo una linea en el registro. Y los envios tomaban el token de la
 * pagina activa, asi que incluso aceptandolo habria contestado por la pagina
 * equivocada.
 *
 * Se copia el mecanismo que ya llevaba WhatsApp: se fija al entrar el mensaje y
 * quien manda lee de aqui. Sin contexto fijado se cae a la pagina ACTIVA, que es
 * exactamente el comportamiento anterior — por eso con una sola pagina no cambia
 * nada.
 */
const paginaDeSalida = new AsyncLocalStorage<string>();

/** Ejecuta `fn` respondiendo por esa pagina. */
export function withOutboundMessengerPage<T>(
  pageId: string | null | undefined,
  fn: () => T
): T {
  if (!pageId) return fn();
  return paginaDeSalida.run(pageId, fn);
}

/** Por que pagina nuestra se esta respondiendo ahora mismo. null = la activa. */
export function getOutboundMessengerPage(): string | null {
  return paginaDeSalida.getStore() ?? null;
}

function configuredValue(setting: string, env: string): string | null {
  return getMetaRuntimeSetting(setting) ?? process.env[env]?.trim() ?? null;
}

export function getMetaAppId(): string | null {
  return configuredValue("meta_app_id", "META_APP_ID") ??
    process.env.NEXT_PUBLIC_META_APP_ID?.trim() ??
    null;
}

export function getMetaOAuthAppSecret(): string | null {
  return (
    configuredValue("meta_app_secret", "META_OAUTH_APP_SECRET") ??
    process.env.META_APP_SECRET?.trim() ??
    null
  );
}

/**
 * El token que dejó el "Conectar con Meta".
 *
 * Se busca en tres sitios, de más fiable a menos: el que se guardó al conectar,
 * el del número activo, y el de cualquier número guardado. Los dos últimos son
 * para las instalaciones que conectaron antes de que esto se guardara aparte.
 */
export function getTokenDeLaConexion(): string | null {
  return (
    getMetaRuntimeSetting("meta_user_token") ??
    getActiveMetaWhatsAppConnection()?.access_token ??
    listMetaWhatsAppConnections()[0]?.access_token ??
    null
  );
}

/**
 * El dataset (pixel) al que se le mandan los eventos de conversión.
 *
 * Primero el elegido en la pantalla, después las variables de siempre. Así se
 * puede configurar sin tocar EasyPanel, y a quien ya lo tenía en una variable
 * no se le mueve nada.
 */
export function getCapiPixelId(): string | null {
  return (
    getMetaRuntimeSetting("capi_pixel_id") ??
    process.env.META_PIXEL_ID?.trim() ??
    process.env.META_CAPI_PIXEL_ID?.trim() ??
    null
  );
}

/**
 * El token con el que se le mandan los eventos de conversión a Meta.
 *
 * Tres orígenes posibles, y el ORDEN importa para no romper lo que ya funciona:
 *
 *  1. Uno pegado a mano en la pantalla. Es una decisión explícita, manda.
 *  2. La variable de entorno de siempre. Quien ya la tenía puesta no nota nada.
 *  3. El token de la conexión con Meta. Solo entra si no hay ninguno de los dos
 *     anteriores, o si se eligió a propósito.
 *
 * El tercero es el que evita tener que pedirle el token a nadie: al conectar,
 * Meta ya entrega uno con `ads_read` y `business_management`, que es la
 * combinación que la API de conversiones exige para un dataset.
 */
export function getCapiAccessToken(): string | null {
  const origen = getMetaRuntimeSetting("capi_token_origen");
  const manual = getMetaRuntimeSetting("capi_access_token");
  const variable = process.env.META_CAPI_ACCESS_TOKEN?.trim() || null;
  const deLaConexion = getTokenDeLaConexion();

  if (origen === "manual") return manual ?? variable ?? deLaConexion;
  if (origen === "variable") return variable ?? manual ?? deLaConexion;
  if (origen === "conexion") return deLaConexion ?? manual ?? variable;
  // Sin elección: exactamente el comportamiento de siempre, y la conexión solo
  // como último recurso para quien no tiene nada configurado.
  return manual ?? variable ?? deLaConexion;
}

/** De dónde sale el token que se está usando, para poder decirlo en pantalla. */
export function getCapiTokenOrigen(): "manual" | "variable" | "conexion" | null {
  const token = getCapiAccessToken();
  if (!token) return null;
  if (token === getMetaRuntimeSetting("capi_access_token")) return "manual";
  if (token === process.env.META_CAPI_ACCESS_TOKEN?.trim()) return "variable";
  return "conexion";
}

export function getWebhookVerifyToken(
  channel: "whatsapp" | "messenger" | "instagram"
): string | null {
  const names = {
    whatsapp: ["whatsapp_verify_token", "META_VERIFY_TOKEN"],
    messenger: ["messenger_verify_token", "MESSENGER_VERIFY_TOKEN"],
    instagram: ["instagram_verify_token", "INSTAGRAM_VERIFY_TOKEN"],
  } as const;
  const [setting, env] = names[channel];
  return configuredValue(setting, env);
}

export function getWebhookAppSecret(
  channel: "whatsapp" | "messenger" | "instagram"
): string | null {
  const names = {
    whatsapp: ["whatsapp_app_secret", "META_APP_SECRET"],
    messenger: ["messenger_app_secret", "MESSENGER_APP_SECRET"],
    instagram: ["instagram_app_secret", "INSTAGRAM_APP_SECRET"],
  } as const;
  const [setting, env] = names[channel];
  return (
    configuredValue(setting, env) ??
    getMetaRuntimeSetting("meta_app_secret") ??
    process.env.META_APP_SECRET?.trim() ??
    null
  );
}

/**
 * DIAGNÓSTICO (no sensible): devuelve TODAS las claves candidatas para verificar
 * la firma de un webhook, con el NOMBRE de su fuente. Sirve para, ante una firma
 * inválida, saber si alguna otra clave conocida la validaría (config mal
 * priorizada) o ninguna (evento de otra App). Nunca se debe loguear el `value`.
 */
export function getWebhookSecretCandidates(
  channel: "whatsapp" | "messenger" | "instagram"
): { source: string; value: string }[] {
  const names = {
    whatsapp: ["whatsapp_app_secret", "META_APP_SECRET"],
    messenger: ["messenger_app_secret", "MESSENGER_APP_SECRET"],
    instagram: ["instagram_app_secret", "INSTAGRAM_APP_SECRET"],
  } as const;
  const [setting, env] = names[channel];
  const out: { source: string; value: string }[] = [];
  const seen = new Set<string>();
  const push = (source: string, value: string | null | undefined) => {
    const v = value?.trim();
    if (v && !seen.has(v)) {
      seen.add(v);
      out.push({ source, value: v });
    }
  };
  push(setting, getMetaRuntimeSetting(setting));
  push(env, process.env[env]);
  push("meta_app_secret", getMetaRuntimeSetting("meta_app_secret"));
  push("META_APP_SECRET", process.env.META_APP_SECRET);
  return out;
}

export function getWhatsAppRuntimeConfig(): {
  accessToken: string | null;
  phoneNumberId: string | null;
  wabaId: string | null;
} {
  // Si este mensaje entro por uno de nuestros numeros, se contesta por ESE.
  // Si no hay contexto, o ese numero ya no esta conectado, se usa el ACTIVO —
  // que es lo que hacia siempre.
  const delContexto = numeroDeSalida.getStore();
  const permanentToken = getMetaRuntimeSetting("whatsapp_access_token_override");
  const useEnvironmentCredentials =
    getMetaRuntimeSetting("use_env_whatsapp_credentials") === "true";
  // Las credenciales del entorno describen UN solo numero. Si este mensaje
  // entro por otro numero conectado, responderle con el del entorno lo mandaria
  // por el numero equivocado, asi que el contexto manda tambien aqui.
  const conexionDelContexto = delContexto
    ? getMetaWhatsAppConnection(delContexto)
    : null;
  if (useEnvironmentCredentials && !conexionDelContexto) {
    return {
      accessToken: process.env.META_ACCESS_TOKEN?.trim() ?? null,
      phoneNumberId: process.env.META_PHONE_NUMBER_ID?.trim() ?? null,
      wabaId: process.env.META_WABA_ID?.trim() ?? null,
    };
  }
  const active = conexionDelContexto ?? getActiveMetaWhatsAppConnection();
  return {
    accessToken:
      // Con varios numeros, el token override global no puede mandar sobre el
      // token propio del numero: cada uno tiene el suyo.
      (conexionDelContexto ? conexionDelContexto.access_token : null) ??
      permanentToken ??
      active?.access_token ??
      process.env.META_ACCESS_TOKEN?.trim() ??
      null,
    phoneNumberId:
      active?.phone_number_id ?? process.env.META_PHONE_NUMBER_ID?.trim() ?? null,
    wabaId: active?.waba_id ?? process.env.META_WABA_ID?.trim() ?? null,
  };
}
