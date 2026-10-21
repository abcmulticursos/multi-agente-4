import { NextResponse } from "next/server";
import {
  getCapiAccessToken,
  getMetaAppId,
  getMetaOAuthAppSecret,
  getTokenDeLaConexion,
  getWhatsAppRuntimeConfig,
} from "@/lib/meta/runtime-config";
import { getMetaRuntimeSetting } from "@/lib/db";

export const runtime = "nodejs";

/**
 * LAS CREDENCIALES GUARDADAS, EN CLARO Y A PETICIÓN.
 *
 * EL PROBLEMA QUE RESUELVE. La pantalla solo recibía un sí o un no: «hay un
 * token guardado». El valor no salía del servidor por ningún sitio, así que el
 * token que hace falta en otras herramientas —n8n, Make, una prueba a mano— no
 * había forma de sacarlo del panel. Había que ir a Meta a generar otro, y cada
 * token nuevo es uno más que caduca por su cuenta.
 *
 * NO VIAJA AL CARGAR LA PÁGINA. Se pide aquí, solo cuando alguien toca «Ver».
 * Es el mismo trato que ya tienen el token de la página y los de lectura de
 * Ads: el estado de la pantalla no lleva secretos dentro.
 *
 * QUIÉN PUEDE. Quien pueda abrir el panel. Esta ruta no añade una puerta
 * propia: va detrás de la misma autenticación que el resto del panel, igual que
 * las otras dos rutas que revelan tokens. Si el panel está abierto sin clave,
 * esto está abierto sin clave — y entonces el problema no es esta ruta.
 */
export async function GET() {
  const whatsapp = getWhatsAppRuntimeConfig();
  return NextResponse.json({
    // El de la app: identifica la aplicación de Meta, no es un secreto fuerte.
    appId: getMetaAppId(),
    // La clave de la app. Con ella se firman los webhooks.
    appSecret: getMetaOAuthAppSecret(),
    // EL MÁS PEDIDO: con este se envían mensajes de WhatsApp.
    whatsAppAccessToken: whatsapp.accessToken,
    // Sale aparte del de arriba porque no siempre son el mismo: el de arriba
    // puede venir del número activo o del entorno, y este es el que se pegó a
    // mano en «Token permanente». Verlos juntos es la única forma de saber
    // cuál está mandando de verdad.
    whatsAppTokenPermanente: getMetaRuntimeSetting(
      "whatsapp_access_token_override"
    ),
    // El que dejó el «Conectar con Meta». Es el del usuario, no el del número.
    tokenDeLaConexion: getTokenDeLaConexion(),
    // El de los eventos de conversión.
    capiAccessToken: getCapiAccessToken(),
    // Los identificadores no son secretos, pero se piden en los mismos sitios
    // que el token, así que se devuelven juntos para no ir a buscarlos aparte.
    phoneNumberId: whatsapp.phoneNumberId,
    wabaId: whatsapp.wabaId,
  });
}
