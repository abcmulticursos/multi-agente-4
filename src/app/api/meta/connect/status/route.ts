import { NextResponse, type NextRequest } from "next/server";
import {
  getActiveInstagramMetaConnection,
  getMetaRuntimeSetting,
  leerListaDeAcceso,
  listMetaConnections,
  listMetaDetectedEnv,
  listMetaWhatsAppConnections,
} from "@/lib/db";
import {
  getMetaAppId,
  getMetaAppSecret,
  fetchMetaAppName,
  getPublicOrigin,
} from "@/lib/meta/connect";
import { getWebhookVerifyToken } from "@/lib/meta/runtime-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const origin = getPublicOrigin(req);
  const appName = await fetchMetaAppName();
  const detectedRows = listMetaDetectedEnv();
  const detectedValues = Object.fromEntries(
    detectedRows.map((row) => [row.name, row.value])
  );
  const activeInstagramPageId = getActiveInstagramMetaConnection()?.page_id;
  const pageRows = listMetaConnections();
  const serializePage = (row: (typeof pageRows)[number]) => ({
    pageId: row.page_id,
    pageName: row.page_name,
    pagePictureUrl: row.page_picture_url,
    instagramBusinessAccountId: row.instagram_business_account_id,
    instagramUsername: row.instagram_username,
    active: row.active === 1,
    instagramActive: row.page_id === activeInstagramPageId,
    connectedAt: row.connected_at,
    updatedAt: row.updated_at,
    // La cuenta dueña, para agrupar el selector por cuenta. null = sin identificar.
    businessName: row.business_name ?? null,
    businessId: row.business_id ?? null,
    // Las cuentas que pueden usarla (dueña + compartidas): para el filtro «Ver cuenta».
    accesoDe: leerListaDeAcceso(row.compartido_con).map((c) => c.id),
  });
  const connections = pageRows.filter((row) => row.selected === 1).map(serializePage);
  const detectedPages = pageRows.filter((row) => row.selected !== 1).map(serializePage);
  const whatsAppConnections = listMetaWhatsAppConnections()
    .filter((row) => {
      const name = row.verified_name?.trim().toLowerCase() ?? "";
      return name !== "test number" && name !== "test whatsapp business account";
    })
    .map((row) => ({
    phoneNumberId: row.phone_number_id,
    wabaId: row.waba_id,
    displayPhoneNumber: row.display_phone_number,
    verifiedName: row.verified_name,
    profilePictureUrl: row.profile_picture_url,
    active: row.active === 1,
    connectedAt: row.connected_at,
    updatedAt: row.updated_at,
    businessName: row.business_name ?? null,
    businessId: row.business_id ?? null,
    accesoDe: leerListaDeAcceso(row.compartido_con).map((c) => c.id),
  }));
  const detectedEnvNames = [
    "META_PAGE_ID",
    "MESSENGER_PAGE_ID",
    "MESSENGER_PAGE_ACCESS_TOKEN",
    "INSTAGRAM_PAGE_ACCESS_TOKEN",
    "INSTAGRAM_PAGE_ID",
    "INSTAGRAM_BUSINESS_ACCOUNT_ID",
    "META_IG_ACCOUNT_ID",
    "META_WABA_ID",
    "META_PHONE_NUMBER_ID",
    "META_PIXEL_ID",
    "META_CAPI_PIXEL_ID",
  ];
  const manualEnvNames = [
    "META_ACCESS_TOKEN",
    "META_CAPI_ACCESS_TOKEN",
    "META_APP_SECRET",
    "META_VERIFY_TOKEN",
    "MESSENGER_VERIFY_TOKEN",
    "INSTAGRAM_VERIFY_TOKEN",
    "OPENROUTER_API_KEY",
    "OPENROUTER_MODEL",
    "OPENROUTER_VISION_MODEL",
    "GROQ_API_KEY",
    "GMAIL_USER",
    "GMAIL_APP_PASSWORD",
    "DASHBOARD_PASSWORD",
    "CRON_SECRET",
    "ADMIN_NOTIFY_PHONE",
  ];
  const detectedEnvBlock = detectedEnvNames
    .map((name) => `${name}=${detectedValues[name] ?? ""}`)
    .join("\n");
  const manualEnvBlock = manualEnvNames
    .map((name) => `${name}=${process.env[name] ?? ""}`)
    .join("\n");

  return NextResponse.json(
    {
      configured: Boolean(getMetaAppId() && getMetaAppSecret()),
      appId: getMetaAppId(),
      appName,
      credentials: {
        appSecretConfigured: Boolean(getMetaAppSecret()),
        messengerAppSecretOverrideConfigured: Boolean(
          getMetaRuntimeSetting("messenger_app_secret")
        ),
        messengerEnvSecretConfigured: Boolean(
          process.env.MESSENGER_APP_SECRET?.trim()
        ),
        instagramAppSecretConfigured: Boolean(
          getMetaRuntimeSetting("instagram_app_secret")
        ),
        whatsAppAccessTokenConfigured: Boolean(
          getMetaRuntimeSetting("whatsapp_access_token_override")
        ),
      },
      whatsAppManualMode:
        getMetaRuntimeSetting("use_env_whatsapp_credentials") === "true",
      whatsAppManualEnvReady: Boolean(
        process.env.META_ACCESS_TOKEN?.trim() &&
          process.env.META_PHONE_NUMBER_ID?.trim() &&
          process.env.META_WABA_ID?.trim()
      ),
      missing: [
        ...(!getMetaAppId() ? ["META_APP_ID"] : []),
        ...(!getMetaAppSecret() ? ["META_APP_SECRET"] : []),
      ],
      webhookUrls: {
        whatsapp: `${origin}/api/webhook`,
        messenger: `${origin}/api/webhooks/messenger`,
        instagram: `${origin}/api/webhooks/instagram`,
      },
      webhookTokens: {
        whatsapp: getWebhookVerifyToken("whatsapp"),
        messenger: getWebhookVerifyToken("messenger"),
        instagram: getWebhookVerifyToken("instagram"),
      },
      notes: [
        "El conector guarda tokens e IDs para no copiarlos a mano.",
        "La revision de permisos de Meta no se puede saltar por codigo.",
        "Las URLs se calculan desde el dominio publico donde abriste este panel.",
      ],
      envExtractor: {
        detected: detectedRows,
        detectedEnvBlock,
        manualEnvBlock,
        detectedCount: detectedRows.length,
      },
      connections,
      detectedPages,
      whatsAppConnections,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
