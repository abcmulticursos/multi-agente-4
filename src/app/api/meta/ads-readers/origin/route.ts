import { NextRequest, NextResponse } from "next/server";
import {
  getAdOriginCache,
  listMetaAdsReaders,
  permisosDeTodasLasCuentas,
  saveAdOriginCache,
} from "@/lib/db";
import { getTokenDeLaConexion } from "@/lib/meta/runtime-config";
import { negocioDeLaCuenta, nombreParaMostrar } from "@/lib/meta/dueno-de-la-cuenta";
import { graphVersion } from "@/lib/meta/connect";

export const runtime = "nodejs";

type GraphError = { error?: { message?: string } };

async function graphGet(path: string, fields: string, accessToken: string) {
  const url = new URL(`https://graph.facebook.com/${graphVersion()}/${path}`);
  url.searchParams.set("fields", fields);
  url.searchParams.set("access_token", accessToken);
  const response = await fetch(url, { cache: "no-store" });
  const data = (await response.json().catch(() => null)) as GraphError & Record<
    string,
    unknown
  >;
  return { response, data };
}

function responseFromOrigin(origin: {
  ad_id: string;
  ad_account_id: string;
  ad_account_name: string;
  business_id: string;
  business_name: string;
  campaign_id: string;
  campaign_name: string;
  ad_name: string;
  reader_name: string;
}) {
  return {
    adId: origin.ad_id,
    adName: origin.ad_name,
    campaignId: origin.campaign_id,
    campaignName: origin.campaign_name,
    adAccountId: origin.ad_account_id,
    adAccountName: origin.ad_account_name,
    businessId: origin.business_id,
    businessName: origin.business_name,
    readerName: origin.reader_name,
  };
}

type MetaBusiness = { id?: unknown; name?: unknown };
type MetaAdAccount = { id?: unknown; account_id?: unknown };

function accountMatches(account: MetaAdAccount, accountId: string): boolean {
  const id = typeof account.id === "string" ? account.id.replace(/^act_/, "") : "";
  const numericId = typeof account.account_id === "string" ? account.account_id : "";
  return id === accountId || numericId === accountId;
}

async function findBusinessByAccount(
  accountId: string,
  accessToken: string
): Promise<{ id: string; name: string } | null> {
  const negocio = await negocioDeLaCuenta(accountId, accessToken);
  return negocio ? { id: negocio.id, name: nombreParaMostrar(negocio) } : null;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const adId = typeof body?.adId === "string" ? body.adId.replace(/\D/g, "") : "";
  const refresh = body?.refresh === true;
  if (!adId) {
    return NextResponse.json({ error: "ID de anuncio invalido." }, { status: 400 });
  }

  if (!refresh) {
    const cached = getAdOriginCache(adId);
    if (cached) return NextResponse.json({ ...responseFromOrigin(cached), cached: true });
  }

  // Los tokens que se van a probar, en orden.
  //
  // El permanente va SIEMPRE, y el ÚLTIMO. Va porque ya trae ads_read: para
  // los anuncios del propio negocio no hace falta generar ni pegar nada, y
  // antes se exigía igual — sin ningún lector cargado esto ni lo intentaba.
  // Y va el último porque solo alcanza al negocio dueño de la app; los
  // lectores son los que llegan a los negocios ajenos, así que se prueban
  // primero, que es donde está la respuesta que el permanente no puede dar.
  const permanente = getTokenDeLaConexion();
  const candidatos: Array<{ name: string; token: string }> = [
    ...listMetaAdsReaders().map((lector) => ({
      name: lector.name,
      token: lector.token,
    })),
    ...(permanente ? [{ name: "token permanente", token: permanente }] : []),
    // LOS PERMISOS DE CADA CUENTA DE META, AL FINAL. Con varias cuentas, el anuncio de
    // la otra solo lo ve su permiso. Van detrás para que lo que ya funcionaba se pruebe
    // primero y responda igual que antes. Parte 2 de PLAN-VARIAS-CUENTAS-DE-FACEBOOK.md.
    ...permisosDeTodasLasCuentas()
      .filter((c) => c.token !== permanente)
      .map((c) => ({ name: c.nombre, token: c.token })),
  ];
  if (!candidatos.length) {
    return NextResponse.json(
      { error: "No hay ningún token con el que consultar anuncios." },
      { status: 404 }
    );
  }

  for (const reader of candidatos) {
    const ad = await graphGet(adId, "account_id,name,campaign{id,name}", reader.token);
    if (!ad.response.ok || typeof ad.data.account_id !== "string") continue;

    const accountPath = `act_${ad.data.account_id}`;
    let account = await graphGet(
      accountPath,
      "name,account_id,business{id,name},owner_business{id,name}",
      reader.token
    );

    // Algunos permisos permiten leer la cuenta, pero no todos los campos de BM.
    // En ese caso conservamos la cuenta publicitaria, que sigue siendo el origen real.
    if (!account.response.ok) {
      account = await graphGet(accountPath, "name,account_id", reader.token);
    }
    if (!account.response.ok) continue;

    let business =
      (account.data.owner_business as { id?: string; name?: string } | undefined) ??
      (account.data.business as { id?: string; name?: string } | undefined);
    if (!business?.id) {
      business = (await findBusinessByAccount(ad.data.account_id, reader.token)) ??
        undefined;
    }
    // Último intento con el token de la conexión con Meta. El de lectura de Ads
    // trae el anuncio y la campaña, pero casi nunca el nombre del BM: para eso
    // hace falta business_management, y el de la conexión sí lo tiene. Así el BM
    // aparece sin que nadie genere un token nuevo.
    if (!business?.id) {
      const tokenDeConexion = getTokenDeLaConexion();
      if (tokenDeConexion) {
        business =
          (await findBusinessByAccount(ad.data.account_id, tokenDeConexion)) ??
          undefined;
      }
    }

    const origin = {
      ad_id: adId,
      ad_name: typeof ad.data.name === "string" ? ad.data.name : "",
      campaign_id:
        typeof (ad.data.campaign as { id?: unknown } | undefined)?.id === "string"
          ? (ad.data.campaign as { id: string }).id
          : "",
      campaign_name:
        typeof (ad.data.campaign as { name?: unknown } | undefined)?.name === "string"
          ? (ad.data.campaign as { name: string }).name
          : "",
      ad_account_id: String(account.data.account_id ?? ad.data.account_id),
      ad_account_name: typeof account.data.name === "string" ? account.data.name : "",
      business_id: business?.id ?? "",
      business_name: business?.name ?? "",
      reader_name: reader.name,
    };
    saveAdOriginCache(origin);
    return NextResponse.json({ ...responseFromOrigin(origin), cached: false });
  }

  // Se dice CUÁLES se probaron. Sin eso, "ninguno tiene acceso" no distingue
  // entre no haber cargado el token de ese negocio y haberlo cargado mal.
  return NextResponse.json(
    {
      error: `Ningún token tiene acceso a este anuncio. Se probaron: ${candidatos
        .map((candidato) => candidato.name)
        .join(", ")}.`,
    },
    { status: 404 }
  );
}
