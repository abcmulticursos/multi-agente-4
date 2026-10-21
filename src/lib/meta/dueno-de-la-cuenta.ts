import { graphVersion } from "@/lib/meta/connect";

/**
 * De qué negocio es una cuenta publicitaria.
 *
 * EL FALLO QUE ARREGLA ESTO
 *
 * Antes se recorrían todos los negocios que el token alcanzaba y, de cada uno,
 * se miraban a la vez sus cuentas PROPIAS y las cuentas de CLIENTE — las que
 * ese negocio ve por ser socio, sin ser suyas. Se devolvía el primero que
 * coincidiera, así que si un negocio socio aparecía antes que el dueño, la
 * consulta contestaba con el nombre equivocado. Y no parecía un error: contesta
 * un nombre real, solo que no es el que se preguntó.
 *
 * Ahora se hace en tres escalones, de más fiable a menos:
 *
 *   1. Preguntarle a la propia cuenta quién es su dueño. Es una sola llamada y
 *      es la verdad, no una deducción.
 *   2. Si eso no se puede leer, recorrer los negocios mirando SOLO las cuentas
 *      propias. Aquí ya no puede colarse un socio.
 *   3. Solo si tampoco aparece, mirar las de cliente — y decirlo, marcándolo
 *      como acceso compartido. Ahí no se sabe quién es el dueño; lo único que
 *      se sabe es por dónde se llegó, y callarlo sería volver al fallo de antes.
 */

export interface NegocioDeLaCuenta {
  id: string;
  name: string;
  /** true = no es el dueño; es por donde se llegó a la cuenta. */
  compartido: boolean;
}

async function pedir(
  ruta: string,
  campos: string,
  token: string
): Promise<Record<string, unknown> | null> {
  try {
    const url = new URL(`https://graph.facebook.com/${graphVersion()}/${ruta}`);
    url.searchParams.set("fields", campos);
    url.searchParams.set("access_token", token);
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
  } catch {
    return null;
  }
}

function comoNegocio(valor: unknown): { id: string; name: string } | null {
  const negocio = valor as { id?: unknown; name?: unknown } | undefined;
  if (typeof negocio?.id !== "string") return null;
  return {
    id: negocio.id,
    name: typeof negocio.name === "string" ? negocio.name : "BM sin nombre",
  };
}

function coincide(fila: Record<string, unknown>, accountId: string): boolean {
  return (
    String(fila.id ?? "").replace(/^act_/, "") === accountId ||
    String(fila.account_id ?? "") === accountId
  );
}

async function cuentasDe(
  businessId: string,
  edge: string,
  token: string
): Promise<Record<string, unknown>[]> {
  const datos = await pedir(`${businessId}/${edge}?limit=100`, "id,account_id", token);
  return Array.isArray(datos?.data)
    ? (datos.data as Record<string, unknown>[])
    : [];
}

export async function negocioDeLaCuenta(
  accountId: string,
  token: string
): Promise<NegocioDeLaCuenta | null> {
  // 1. La propia cuenta lo dice.
  const cuenta = await pedir(
    `act_${accountId}`,
    "business{id,name},owner_business{id,name}",
    token
  );
  const directo =
    comoNegocio(cuenta?.owner_business) ?? comoNegocio(cuenta?.business);
  if (directo) return { ...directo, compartido: false };

  // 2. y 3. Recorrer los negocios. Las cuentas PROPIAS de todos primero: si se
  // mezclaran con las de cliente, un socio listado antes que el dueño volvería
  // a ganar, que es exactamente el fallo que esto arregla.
  const negocios = await pedir("me/businesses?limit=100", "id,name", token);
  const filas = Array.isArray(negocios?.data)
    ? (negocios.data as Array<{ id?: unknown; name?: unknown }>)
    : [];

  for (const edge of ["owned_ad_accounts", "client_ad_accounts"]) {
    for (const fila of filas) {
      const negocio = comoNegocio(fila);
      if (!negocio) continue;
      const cuentas = await cuentasDe(negocio.id, edge, token);
      if (cuentas.some((c) => coincide(c, accountId))) {
        return { ...negocio, compartido: edge === "client_ad_accounts" };
      }
    }
  }

  return null;
}

/** El nombre para mostrar, avisando cuando no se sabe si es el dueño. */
export function nombreParaMostrar(negocio: NegocioDeLaCuenta | null): string {
  if (!negocio) return "BM no disponible";
  return negocio.compartido ? `${negocio.name} (acceso compartido)` : negocio.name;
}
