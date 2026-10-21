import { NextResponse, type NextRequest } from "next/server";
import { deleteConversation, getConversationByNocodbRowId } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Endpoint que NocoDB llama cuando se borra una fila de la tabla "Leads".
 *
 * Configurar en NocoDB:
 *   - Webhook trigger: After Delete
 *   - Método: POST
 *   - URL: https://<tu-dominio>/api/nocodb-webhook?secret=<NOCODB_WEBHOOK_SECRET>
 *
 * El secret se valida contra la env var. Sin secret correcto → 401.
 *
 * Payload esperado de NocoDB (varía un poco entre versiones, soportamos
 * varios formatos comunes): un objeto con la(s) fila(s) eliminada(s)
 * accesible vía body.data.previous_rows, body.previous_rows, o body.rows.
 */

interface NocodbDeletedRecord {
  Id?: string | number;
  // Otros campos no nos importan
}

interface NocodbWebhookBody {
  data?: {
    previous_rows?: NocodbDeletedRecord[];
    rows?: NocodbDeletedRecord[];
  };
  previous_rows?: NocodbDeletedRecord[];
  rows?: NocodbDeletedRecord[];
}

function extractRowIds(body: unknown): string[] {
  const b = body as NocodbWebhookBody | null;
  if (!b || typeof b !== "object") return [];
  const candidates: NocodbDeletedRecord[] = [
    ...(b.data?.previous_rows ?? []),
    ...(b.data?.rows ?? []),
    ...(b.previous_rows ?? []),
    ...(b.rows ?? []),
  ];
  const ids: string[] = [];
  for (const r of candidates) {
    if (r?.Id !== undefined && r.Id !== null) ids.push(String(r.Id));
  }
  return ids;
}

export async function POST(req: NextRequest) {
  const expectedSecret = process.env.NOCODB_WEBHOOK_SECRET?.trim();
  if (!expectedSecret) {
    console.warn(
      "[nocodb-webhook] NOCODB_WEBHOOK_SECRET no configurado, rechazo todo"
    );
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }
  const gotSecret =
    req.nextUrl.searchParams.get("secret") ??
    req.headers.get("x-webhook-secret");
  if (gotSecret !== expectedSecret) {
    console.warn("[nocodb-webhook] secret inválido");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const rowIds = extractRowIds(body);
  if (rowIds.length === 0) {
    console.warn(
      `[nocodb-webhook] payload sin Id reconocibles: ${JSON.stringify(body).slice(0, 200)}`
    );
    return NextResponse.json({ ok: true, deleted: 0 });
  }

  let deleted = 0;
  for (const rowId of rowIds) {
    const convo = getConversationByNocodbRowId(rowId);
    if (!convo) {
      console.log(
        `[nocodb-webhook] rowId=${rowId} sin convo local asociada, ignoro`
      );
      continue;
    }
    try {
      // Local-only delete — la fila en NocoDB YA fue borrada (este webhook
      // se disparó por eso). NO llamamos deleteLead acá.
      deleteConversation(convo.id);
      console.log(
        `[nocodb-webhook] borrada convo ${convo.id} (rowId=${rowId}) por delete en NocoDB`
      );
      deleted++;
    } catch (err) {
      console.error(
        `[nocodb-webhook] error borrando convo ${convo.id}:`,
        err
      );
    }
  }

  return NextResponse.json({ ok: true, deleted });
}
