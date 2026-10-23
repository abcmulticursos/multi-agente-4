/**
 * EL LECTOR DE COMPROBANTES DEL TABLERO. Lee el monto de la foto (o el PDF) y nada más: no
 * aprueba ni cobra; eso lo decide el motor del tablero con los montos de su ficha de cobro.
 *
 * No usa `register_payment_amount` a propósito: ese valida contra el precio de la venta de
 * siempre (opción elegida, saldo, upgrade…), que en el tablero no existe. La lectura sí es la
 * misma: el mismo modelo de visión y el mismo armado de la imagen (`bloqueDeMedia`).
 */
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import db, { type MessageRow } from "@/lib/db";
import { bloqueDeMedia, getClient, getRecentVisionImage } from "@/lib/openrouter";

export interface LecturaDelComprobante {
  monto: number;
  fecha?: string;
  operacion?: string;
  titular?: string;
  metodo?: string;
}

/**
 * ¿EL COMPROBANTE ES A NOMBRE DE QUIEN COBRA? La MISMA regla que el validador de siempre
 * (payment.ts, «Validación de receptor para Yape/Plin»), copiada porque allí vive dentro de la
 * validación de la venta de siempre: SOLO la primera palabra de lo configurado (de 3+ letras),
 * comparada por prefijo con cualquier palabra del comprobante (que suele venir recortado).
 * Sin titular configurado, vale cualquiera.
 */
export function titularCoincide(esperado: string, recibido: string): boolean {
  const normal = (s: string) =>
    s.toLowerCase().normalize("NFD").replace(/\p{Mn}/gu, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  const esperadas = normal(esperado).split(" ").filter((t) => t.length >= 3).slice(0, 1);
  if (esperadas.length === 0) return true;
  const recibidas = normal(recibido).split(" ").filter((t) => t.length >= 2);
  return esperadas.some((et) =>
    recibidas.some((gt) => {
      const [corta, larga] = et.length <= gt.length ? [et, gt] : [gt, et];
      return corta.length >= 3 && larga.startsWith(corta);
    })
  );
}

const HERRAMIENTA = {
  type: "function" as const,
  function: {
    name: "leer_comprobante",
    description:
      "Call it ONLY if the attachment is a real payment receipt (wallet, bank app or transfer) where the paid amount can be read.",
    parameters: {
      type: "object",
      properties: {
        monto: { type: "number", description: "The exact amount paid, just the number (e.g. 80, 12.5)." },
        fecha: { type: "string", description: "Date and time visible on the receipt, exactly as printed. Empty if none." },
        operacion: { type: "string", description: "Operation/transaction number if visible. Empty if none." },
        titular: { type: "string", description: "Recipient name exactly as printed (may be masked). Empty if none." },
        metodo: {
          type: "string",
          description: "Payment app or bank as printed on the receipt, in lowercase (e.g. yape, plin, bcp, interbank, transferencia, nequi, mercadopago). Empty if unknown.",
        },
      },
      required: ["monto"],
    },
  },
};

/** Los últimos mensajes de la conversación, en orden. */
export function ultimosMensajes(conversationId: number, cuantos = 20): MessageRow[] {
  return (
    db
      .prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC, id DESC LIMIT ?")
      .all(conversationId, cuantos) as MessageRow[]
  ).reverse();
}

/**
 * ¿El turno trae una foto o PDF que el bot aún no atendió? `yaLeido` = el último que el tablero ya
 * leyó: ese no vuelve a contar aunque el bot no haya contestado nada después (no se lee dos veces).
 */
export function hayComprobantePendiente(conversationId: number, yaLeido?: number | null): boolean {
  const m = getRecentVisionImage(ultimosMensajes(conversationId, 12));
  return !!m && m.id !== yaLeido;
}

/** El id del mensaje con la foto o PDF pendiente, para anotarlo como leído. */
export function idDelComprobantePendiente(conversationId: number): number | null {
  return getRecentVisionImage(ultimosMensajes(conversationId, 12))?.id ?? null;
}

/** Lee el comprobante pendiente. null = no hay, o no se ve como un comprobante con monto. */
export async function leerComprobante(conversationId: number): Promise<LecturaDelComprobante | null> {
  const adjunto = getRecentVisionImage(ultimosMensajes(conversationId, 12));
  if (!adjunto) return null;
  const bloque = bloqueDeMedia(adjunto);
  if (!bloque) return null;
  const modelo =
    process.env.OPENROUTER_VISION_MODEL || process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";
  const mensajes: ChatCompletionMessageParam[] = [
    {
      role: "system",
      content:
        "Eres un lector de comprobantes de pago. Si el adjunto es un comprobante real y se lee el monto, llama leer_comprobante con lo visible. Si no lo es, o no se lee el monto, responde exactamente: NO_COMPROBANTE. No converses ni inventes datos.",
    },
    {
      role: "user",
      content: [{ type: "text", text: "Adjunto del cliente." }, bloque],
    } as unknown as ChatCompletionMessageParam,
  ];
  try {
    const r = await getClient().chat.completions.create({
      model: modelo,
      messages: mensajes,
      tools: [HERRAMIENTA],
      temperature: 0,
    });
    const llamada = r.choices[0]?.message?.tool_calls?.find(
      (t) => t.type === "function" && t.function.name === "leer_comprobante"
    );
    if (!llamada || llamada.type !== "function") {
      console.log(`[tablero:lector] convo ${conversationId}: no es un comprobante legible`);
      return null;
    }
    const args = JSON.parse(llamada.function.arguments || "{}") as Record<string, unknown>;
    const monto = typeof args.monto === "number" ? args.monto : Number(String(args.monto ?? "").replace(",", "."));
    if (!Number.isFinite(monto) || monto <= 0) return null;
    const limpio = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 120) : undefined);
    const lectura: LecturaDelComprobante = {
      monto,
      fecha: limpio(args.fecha),
      operacion: limpio(args.operacion),
      titular: limpio(args.titular),
      metodo: limpio(args.metodo)?.toLowerCase(),
    };
    console.log(
      `[tablero:lector] convo ${conversationId}: monto=${lectura.monto} operación=${lectura.operacion ?? "-"} fecha=${lectura.fecha ?? "-"}`
    );
    return lectura;
  } catch (err) {
    console.error(`[tablero:lector] convo ${conversationId}: falló la lectura`, err);
    return null;
  }
}

/**
 * La huella del pago, para no contarlo dos veces: su número de operación, o su fecha y monto.
 * Sin ninguno de los dos no hay huella (null): dos pagos distintos del mismo monto y sin fecha
 * se confundirían, y rechazar uno bueno es peor que no poder comparar.
 */
export function huellaDelPago(l: LecturaDelComprobante): string | null {
  const op = (l.operacion ?? "").replace(/\s+/g, "");
  if (op.length >= 4) return `op:${op}`;
  const fecha = (l.fecha ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!fecha) return null;
  return `fm:${fecha}|${l.monto}`;
}
