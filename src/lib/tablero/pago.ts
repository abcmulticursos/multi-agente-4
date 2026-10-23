/**
 * EL MÉTODO DE PAGO EN EL TABLERO (23/10/2026, solo ALBERTO 4) — como la venta de siempre.
 *
 * Lo pidió el dueño con su regla de siempre: «con el método ya elegido NO se le vuelve a preguntar
 * cuál es; pero SÍ puede cambiarlo cuando quiera y la compra debe seguir», y al cambiar de método
 * o de producto «los datos del nuevo con el precio del producto que tenga elegido».
 *
 * Aquí no se escribe ningún texto de pago: se usan los suyos —los botones y las respuestas de
 * «Métodos de pago» de su país (las de la modalidad de la tienda, como el motor de siempre)— y los
 * métodos que atiende el usuario que cobra en esa tienda (`getPaymentMethods`). Ningún nombre de
 * método ni de banco vive en este archivo.
 */
import { getConversationById, setSelectedPaymentMethod, type ConversationRow } from "@/lib/db";
import {
  detectDynamicPaymentMethod,
  getEffectiveCountryCode,
  getPaymentButtons,
  getPaymentMethods,
  loadWorkflowConfig,
  resolveCountryPaymentProfile,
  type ResponseStep,
} from "@/lib/workflow/config";
import { sendConfiguredSteps } from "@/lib/workflow/engine";
import { sendBotButtons } from "@/lib/workflow/sender";

/** El método que nombra el cliente: el id que trae un botón de método, o su nombre/alias escrito. */
export function metodoQueNombra(contenido: string, phone: string | null | undefined): string | null {
  const limpio = contenido.trim().toLowerCase();
  if (!limpio) return null;
  const metodos = getPaymentMethods(phone);
  // El botón de método llega como su id («pmethod:<id>:n» → «<id>», ver `textoDelBotonPulsado`).
  const porId = metodos.find((m) => m.method.trim().toLowerCase() === limpio);
  if (porId) return porId.method;
  return detectDynamicPaymentMethod(contenido, phone);
}

/** El método que ya eligió, si sigue siendo uno de los de su país (y de quien cobra). */
export function metodoVigente(convo: ConversationRow): string | null {
  const elegido = (convo.selected_payment_method ?? "").trim().toLowerCase();
  if (!elegido) return null;
  return getPaymentMethods(convo.phone).find((m) => m.method.trim().toLowerCase() === elegido)?.method ?? null;
}

/**
 * SUS DATOS PARA ESE MÉTODO: las respuestas por método de su país (capa de la modalidad de la
 * tienda, o el país) y, si no hay, las generales. Misma lectura que `getPaymentResponses` del motor
 * de siempre para la venta de un producto (sin las de la oferta de dos opciones, que el tablero no
 * usa). «efectivo» cae en las de transferencia, igual que allí.
 */
export function pasosDelMetodo(phone: string | null | undefined, metodo: string): ResponseStep[] {
  const config = loadWorkflowConfig();
  if (!config) return [];
  const porMetodo = (r?: { [m: string]: ResponseStep[] | undefined }): ResponseStep[] | undefined => {
    if (!r) return undefined;
    const directo = r[metodo];
    if (Array.isArray(directo) && directo.length > 0) return directo;
    if (metodo === "efectivo") return r.bcp_transferencia;
    return undefined;
  };
  const pais = getEffectiveCountryCode(phone, config);
  const pasos = porMetodo(resolveCountryPaymentProfile(pais, config)?.payment_responses) ?? porMetodo(config.payment_responses) ?? [];
  return pasos.filter((p) => p.enabled !== false);
}

/**
 * {{PRODUCTO}} ES EL PRODUCTO DE ESTE COBRO. En la venta de siempre ese comodín es «el producto de
 * la tienda»; en un cobro del tablero tiene que ser el que se está cobrando, o el cliente leería un
 * nombre y pagaría otro. Solo se cambia ese comodín exacto: los que dicen de cuál hablan
 * ({{PRODUCTO_FULL}}…) siguen como siempre.
 */
export function conElNombreDelProducto(pasos: ResponseStep[], nombre: string | undefined): ResponseStep[] {
  if (!nombre) return pasos;
  const cambiar = (t: string | undefined) => (typeof t === "string" ? t.replace(/\{\{\s*producto\s*\}\}/gi, nombre) : t);
  return pasos.map((p) => {
    const x = { ...(p as Record<string, unknown>) };
    for (const k of ["body", "caption"]) if (typeof x[k] === "string") x[k] = cambiar(x[k] as string);
    for (const k of ["body_variants", "caption_variants", "texts"])
      if (Array.isArray(x[k])) x[k] = (x[k] as unknown[]).map((t) => (typeof t === "string" ? cambiar(t) : t));
    return x as unknown as ResponseStep;
  });
}

/**
 * MANDA LOS DATOS DE ESE MÉTODO con el precio de lo que eligió. Deja el método anotado en la
 * conversación: así {{NUMERO_DE_CUENTA}} sale con la cuenta de ESE método (como en la venta de
 * siempre) y la próxima vez no se le pregunta. Devuelve false si ese método no tiene datos escritos.
 */
export async function mandarDatosDelMetodo(convo: ConversationRow, metodo: string, precio: number | undefined, nombre?: string): Promise<boolean> {
  const pasos = pasosDelMetodo(convo.phone, metodo);
  setSelectedPaymentMethod(convo.id, metodo);
  if (pasos.length === 0) {
    console.warn(`[tablero:pago] convo ${convo.id}: el método «${metodo}» no tiene datos escritos en «Métodos de pago»`);
    return false;
  }
  const fresca = getConversationById(convo.id) ?? convo;
  console.log(`[tablero:pago] convo ${convo.id}: datos de «${metodo}» por ${precio ?? "?"}${nombre ? ` (${nombre})` : ""}`);
  return sendConfiguredSteps(fresca, conElNombreDelProducto(pasos, nombre) as never, precio);
}

/**
 * PREGUNTA EL MÉTODO: sus burbujas de la ficha y, si él usa botones de métodos (Ajustes), la burbuja
 * con los botones de los métodos de su país. Sin burbujas en la ficha y sin botones, el texto del
 * menú de pago de su país.
 */
export async function preguntarElMetodo(convo: ConversationRow, pasosDeLaFicha: ResponseStep[], precio: number | undefined, nombre?: string): Promise<void> {
  const config = loadWorkflowConfig();
  const conBotones = config?.payment_method_buttons === true;
  const salieron = pasosDeLaFicha.length > 0 && (await sendConfiguredSteps(convo, conElNombreDelProducto(pasosDeLaFicha, nombre) as never, precio));
  const botones = getPaymentButtons(convo.phone).map((b, i) => ({ id: `pmethod:${b.method}:${i}`, title: b.label }));
  if (conBotones && botones.length > 0) {
    const cuerpo = (config?.payment_buttons_prompt ?? "").trim();
    if (cuerpo) await sendBotButtons(convo, cuerpo, botones.slice(0, 3));
    return;
  }
  if (!salieron) {
    const pais = getEffectiveCountryCode(convo.phone, config);
    const menu = (resolveCountryPaymentProfile(pais, config)?.payment_text ?? "").trim();
    if (menu) await sendConfiguredSteps(convo, [{ type: "text", body: menu } as ResponseStep] as never, precio);
  }
}
