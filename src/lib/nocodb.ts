/**
 * Cliente REST para NocoDB v2.
 *
 * Todas las operaciones son fire-and-forget desde el caller — si NocoDB
 * está caído o devuelve error, el bot loguea y sigue funcionando. La
 * sincronización es best-effort.
 *
 * Variables de entorno requeridas:
 *   - NOCODB_BASE_URL: URL de la instancia (ej. https://nocodb.example.com)
 *   - NOCODB_TOKEN: API token generado en NocoDB
 *   - NOCODB_TABLE_ID: ID de la tabla "Leads" (ej. m5vb6uew4ebmloy)
 */

export interface LeadRowData {
  /** ISO 8601 datetime — se mapea a la columna Fecha (DateTime). */
  Fecha?: string;
  Numero?: string;
  ConversationID?: number;
  Nombre?: string | null;
  Canal?: string;
  Resumen?: string;
  Label?: string;
  "Enviado 1"?: string;
  "Enviado 2"?: string;
  "Enviado 3"?: string;
  "Enviado 4"?: string;
}

function nocodbBase(): string | null {
  const raw = process.env.NOCODB_BASE_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

function nocodbToken(): string | null {
  return process.env.NOCODB_TOKEN?.trim() || null;
}

function nocodbTableId(): string | null {
  return process.env.NOCODB_TABLE_ID?.trim() || null;
}

function isConfigured(): boolean {
  return !!(nocodbBase() && nocodbToken() && nocodbTableId());
}

function recordsEndpoint(): string {
  return `${nocodbBase()}/api/v2/tables/${nocodbTableId()}/records`;
}

function authHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "xc-token": nocodbToken()!,
  };
}

/**
 * Crea una nueva fila en la tabla de leads. Devuelve el Id de la fila
 * creada, o null si falla / NocoDB no está configurado.
 */
export async function createLead(data: LeadRowData): Promise<string | null> {
  if (!isConfigured()) {
    console.log("[nocodb] no configurado, salteando createLead");
    return null;
  }
  try {
    const res = await fetch(recordsEndpoint(), {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error(`[nocodb] createLead falló (${res.status}): ${text}`);
      return null;
    }
    const json = (await res.json()) as { Id?: string | number };
    if (json.Id === undefined || json.Id === null) {
      console.warn(
        `[nocodb] createLead OK pero sin Id en respuesta: ${JSON.stringify(json)}`
      );
      return null;
    }
    const rowId = String(json.Id);
    console.log(`[nocodb] lead creado con rowId=${rowId}`);
    return rowId;
  } catch (err) {
    console.error("[nocodb] error en createLead:", err);
    return null;
  }
}

/**
 * Actualiza campos de una fila existente. Devuelve true si la operación
 * fue exitosa (200/201), false si falló.
 */
export async function updateLead(
  rowId: string,
  data: Partial<LeadRowData>
): Promise<boolean> {
  if (!isConfigured()) return false;
  if (Object.keys(data).length === 0) return true;
  try {
    const body = { Id: rowId, ...data };
    const res = await fetch(recordsEndpoint(), {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error(
        `[nocodb] updateLead rowId=${rowId} falló (${res.status}): ${text}`
      );
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[nocodb] error en updateLead rowId=${rowId}:`, err);
    return false;
  }
}

/**
 * Borra una fila en NocoDB. Devuelve true si OK o si la fila ya no existía,
 * false si hubo error de red u otra cosa.
 */
export async function deleteLead(rowId: string): Promise<boolean> {
  if (!isConfigured()) return false;
  try {
    const body = { Id: rowId };
    const res = await fetch(recordsEndpoint(), {
      method: "DELETE",
      headers: authHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok && res.status !== 404) {
      const text = await res.text();
      console.error(
        `[nocodb] deleteLead rowId=${rowId} falló (${res.status}): ${text}`
      );
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[nocodb] error en deleteLead rowId=${rowId}:`, err);
    return false;
  }
}
