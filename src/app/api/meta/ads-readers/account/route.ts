import { NextRequest, NextResponse } from "next/server";
import { getMetaAdsReaderActivo } from "@/lib/db";
import { getTokenDeLaConexion } from "@/lib/meta/runtime-config";
import { graphVersion } from "@/lib/meta/connect";
import { tokensPermanentes } from "@/lib/meta/token-por-numero";
import { negocioDeLaCuenta, nombreParaMostrar } from "@/lib/meta/dueno-de-la-cuenta";

export const runtime = "nodejs";

async function graph(path: string, token: string) {
  const url = new URL(`https://graph.facebook.com/${graphVersion()}/${path}`);
  url.searchParams.set("access_token", token);
  const response = await fetch(url, { cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message ?? "Meta no pudo leer la cuenta.");
  return data;
}

async function buscarConUnToken(
  accountId: string,
  token: string
): Promise<string | null> {
  const negocio = await negocioDeLaCuenta(accountId, token);
  return negocio ? nombreParaMostrar(negocio) : null;
}

/**
 * El nombre del BM, probando con los dos tokens que hay.
 *
 * El de lectura de Ads trae el anuncio y la campaña, pero casi nunca el nombre
 * del BM: para eso hace falta business_management, que el de la conexión con
 * Meta sí tiene. Se intenta con el primero y, si no da, con el segundo.
 */
async function findBusinessName(accountId: string, token: string): Promise<string> {
  const tokenDeConexion = getTokenDeLaConexion();
  for (const candidato of [token, tokenDeConexion]) {
    if (!candidato) continue;
    try {
      const nombre = await buscarConUnToken(accountId, candidato);
      if (nombre) return nombre;
    } catch {
      // Un token sin permiso no debe cortar la consulta: se prueba el siguiente.
    }
  }
  return "BM no disponible";
}

async function findAdLink(adId: string, token: string): Promise<string | undefined> {
  try {
    const ad = await graph(`${adId}?fields=creative{effective_object_story_id}`, token);
    const storyId = typeof ad?.creative?.effective_object_story_id === "string"
      ? ad.creative.effective_object_story_id
      : "";
    if (!storyId.includes("_")) return undefined;
    const [pageId, postId] = storyId.split("_", 2);
    return pageId && postId ? `https://www.facebook.com/${pageId}/posts/${postId}` : undefined;
  } catch {
    return undefined;
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const accountId = typeof body?.accountId === "string" ? body.accountId.replace(/\D/g, "") : "";
  // Sin lector elegido se usa el permanente, que ya trae ads_read. Antes esto
  // exigía un token cargado a mano incluso para las cuentas del propio
  // negocio, que es justo donde no hace falta ninguno.
  const lector = getMetaAdsReaderActivo(Number(body?.readerId));
  // SIN LECTOR: EL INICIO DE SESIÓN Y LUEGO LOS TOKENS PERMANENTES (21/10/2026). Lo que aquí se
  // llamaba «permanente» era el inicio de sesión, que caduca a los ~60 días: ese día la
  // importación de los anuncios propios dejaba de funcionar. Ahora, si él no puede leer la
  // cuenta, se prueba con los permanentes de verdad, que no caducan.
  const login = getTokenDeLaConexion();
  const candidatos: Array<{ name: string; token: string }> = lector
    ? [lector]
    : [
        ...(login ? [{ name: "inicio de sesión", token: login }] : []),
        ...tokensPermanentes()
          .filter((t) => t !== login)
          .map((token) => ({ name: "token permanente", token })),
      ];
  let reader: { name: string; token: string } | null = candidatos[0] ?? null;
  for (const c of candidatos) {
    try {
      await graph(`act_${accountId}?fields=id`, c.token);
      reader = c;
      break;
    } catch {
      // Este no alcanza la cuenta: se prueba el siguiente.
    }
  }
  if (!reader || !accountId) {
    return NextResponse.json(
      { error: "Falta la cuenta publicitaria, o no hay ningún token con el que consultar." },
      { status: 400 }
    );
  }
  try {
    const account = await graph(`act_${accountId}?fields=id,account_id,name`, reader.token);
    const campaigns = await graph(`act_${accountId}/campaigns?fields=id,name,effective_status&effective_status=[%22ACTIVE%22]&limit=100`, reader.token);
    const result = [] as Array<Record<string, unknown>>;
    for (const campaign of campaigns.data ?? []) {
      const ads = await graph(`${campaign.id}/ads?fields=id,name,effective_status&limit=100`, reader.token);
      const rows = await Promise.all((ads.data ?? []).map(async (ad: Record<string, unknown>) => ({
        id: ad.id,
        name: ad.name,
        active: ad.effective_status === "ACTIVE",
        url: typeof ad.id === "string" ? await findAdLink(ad.id, reader.token) : undefined,
      })));
      result.push({ id: campaign.id, name: campaign.name, ads: rows });
    }
    return NextResponse.json({ businessName: await findBusinessName(accountId, reader.token), accountName: account.name ?? account.account_id ?? accountId, campaigns: result, leidoCon: reader.name });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo consultar Meta." }, { status: 400 });
  }
}
