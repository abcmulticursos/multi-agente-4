/**
 * De quién es un token de lectura de Ads.
 *
 * El campo del nombre existía para que, con varios tokens cargados, se supiera
 * cuál lee qué. Pero escribirlo a mano tiene dos problemas: hay que acordarse
 * del negocio del que salió el token, y nada impide equivocarse — un nombre
 * mal puesto engaña justo el día que algo falla.
 *
 * Meta ya sabe la respuesta, así que se le pregunta a él.
 */

const VERSION = process.env.META_GRAPH_VERSION?.trim() || "v21.0";

async function preguntar(
  ruta: string,
  token: string
): Promise<Record<string, unknown> | null> {
  try {
    const url = new URL(`https://graph.facebook.com/${VERSION}/${ruta}`);
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

function nombresDe(data: Record<string, unknown> | null): string[] {
  const filas = Array.isArray(data?.data)
    ? (data.data as Array<{ name?: unknown }>)
    : [];
  const nombres = filas
    .map((fila) => (typeof fila?.name === "string" ? fila.name.trim() : ""))
    .filter(Boolean);
  return [...new Set(nombres)];
}

/**
 * Devuelve el nombre del negocio dueño del token, o null si no se pudo saber.
 *
 * Se intenta por dos caminos porque no todos los tokens responden igual: el de
 * un usuario del sistema suele contestar por `/me/businesses`, y el de una
 * persona a veces solo deja ver el negocio a través de sus cuentas
 * publicitarias.
 *
 * Un token puede alcanzar VARIOS negocios. En ese caso se devuelven todos
 * separados por coma en vez de elegir uno: quedarse con el primero seria
 * inventar una respuesta más limpia que la realidad, y el dia que un anuncio no
 * apareciera, el nombre estaria señalando al negocio equivocado.
 *
 * Nunca lanza. Si Meta no contesta, el nombre se escribe a mano como siempre.
 */
export async function nombreDelNegocioDelToken(
  token: string
): Promise<string | null> {
  const directos = nombresDe(await preguntar("me/businesses?fields=name", token));
  if (directos.length) return directos.join(", ");

  const cuentas = await preguntar(
    "me/adaccounts?fields=business{name},owner_business{name}&limit=50",
    token
  );
  const filas = Array.isArray(cuentas?.data)
    ? (cuentas.data as Array<Record<string, { name?: unknown } | undefined>>)
    : [];
  const porCuenta = [
    ...new Set(
      filas
        .map((fila) => {
          const negocio = fila.owner_business ?? fila.business;
          return typeof negocio?.name === "string" ? negocio.name.trim() : "";
        })
        .filter(Boolean)
    ),
  ];
  if (porCuenta.length) return porCuenta.join(", ");

  return null;
}
