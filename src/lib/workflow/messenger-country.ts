import { COUNTRIES, resolveCountry, type CountryCode } from "@/lib/countries";
import {
  cancelPendingActionsByTypeForConvo,
  markMessengerCountryPrompted,
  scheduleAction,
  setConversationCountry,
  type ConversationRow,
} from "@/lib/db";
import {
  laTiendaDeLaConversacion,
  loadWorkflowConfig,
  resolveSpintax,
} from "@/lib/workflow/config";
import { sendBotText } from "@/lib/workflow/sender";
import { generateCountryReask } from "@/lib/openrouter";

const DEFAULT_COUNTRY_PROMPT = "Hola, ¿de qué país nos visitas?";
const DEFAULT_COUNTRY_REMINDER =
  "Para poder darte la información correcta, ¿me cuentas de qué país nos visitas? 😊";

/** Acción única, separada de los seguimientos comerciales. */
export const MESSENGER_COUNTRY_REMINDER_ACTION = "messenger_country_reminder";

// Frases por defecto del modo "spintax" (destrabe de país). Editables desde
// el panel en messenger_country_prompt.reask_variants.
const DEFAULT_REASK_VARIANTS = [
  "¡Claro que sí! 😊 Para darte la información correcta, cuéntame primero de qué país nos escribes.",
  "Con gusto te ayudo 🌷 pero antes, ¿de qué país nos visitas? Así te doy los datos exactos.",
  "¡Por supuesto! Para pasarte los datos correctos necesito saber de qué país nos escribes 😊",
  "Encantada de ayudarte 💖 ¿me cuentas de qué país nos visitas para darte la info precisa?",
  "¡Claro! Antes de seguir, ¿desde qué país nos escribes? Así te atiendo con los datos correctos 😊",
];

function pickReaskVariant(variants?: string[]): string {
  const list = (variants ?? []).map((v) => v.trim()).filter(Boolean);
  const pool = list.length > 0 ? list : DEFAULT_REASK_VARIANTS;
  return pool[Math.floor(Math.random() * pool.length)];
}

function normalized(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function distance(left: string, right: string): number {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const current = row[j];
      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        previous + (left[i - 1] === right[j - 1] ? 0 : 1)
      );
      previous = current;
    }
  }
  return row[right.length];
}

const COUNTRY_ALIASES: Array<[CountryCode, string]> = [
  ["PE", "peru"], ["PE", "peruano"],
  ["EC", "ecuador"], ["EC", "ecuatoriano"],
  ["MX", "mexico"], ["MX", "mexicano"],
  ["CO", "colombia"], ["CO", "colombiano"],
  ["AR", "argentina"], ["AR", "argentino"],
  ["BO", "bolivia"], ["BO", "boliviano"],
  ["GT", "guatemala"], ["GT", "guatemalteco"],
  ["CR", "costa rica"], ["CR", "costarica"],
  ["CL", "chile"], ["CL", "chileno"],
  ["SV", "el salvador"], ["SV", "salvador"],
  ["VE", "venezuela"], ["VE", "venezolano"],
];

export function detectWrittenCountry(value: string): CountryCode | null {
  const text = normalized(value);
  if (!text) return null;
  for (const [country, alias] of COUNTRY_ALIASES) {
    if (text === alias || text.includes(alias)) return country;
  }
  for (const word of text.split(" ")) {
    if (word.length < 3) continue;
    for (const [country, alias] of COUNTRY_ALIASES) {
      if (alias.includes(" ")) continue;
      const maxDistance = alias.length <= 4 ? 1 : 2;
      if (distance(word, alias) <= maxDistance) return country;
    }
  }
  return null;
}

/**
 * Messenger no publica el teléfono del visitante. Esta puerta pide el país una
 * sola vez, acepta errores comunes y persiste la elección para todo el flujo.
 */
export async function handleMessengerCountryGate(
  convo: ConversationRow,
  content: string
): Promise<boolean> {
  // /restart debe llegar siempre al motor principal. Si esta puerta lo
  // intercepta, Messenger se queda pidiendo el pais y no borra la charla.
  const command = content.trim().toLowerCase();
  if (command === "/restart" || command === "/reset" || command === "/reiniciar") {
    return false;
  }
  const config = loadWorkflowConfig();
  const setting = config?.messenger_country_prompt;
  const isMessenger =
    convo.channel === "messenger" ||
    convo.channel === "instagram" ||
    (convo.channel === "test" && convo.test_channel === "messenger");
  // LA CABECERA DEL TURNO.
  //
  // Esta línea sale UNA vez por mensaje del cliente, y es por donde se empieza a
  // leer un log: en qué etapa estaba y qué escribió. Lo demás del turno —qué
  // cuadrito eligió, qué se le mandó— cuelga de aquí con el prefijo
  // `[wf:decision]`.
  //
  // Los datos de Messenger y país solo con DIAG_PAIS=1: no hacen falta para
  // seguir una venta y alargaban la línea hasta que dejaba de leerse.
  const detectedForLog = detectWrittenCountry(content);
  // Y CON QUÉ TIENDA SE ESTÁ ATENDIENDO, QUE ES LO QUE DECIDE QUÉ SE VENDE.
  //
  // LO QUE PASÓ — 2 de octubre de 2026. El dueño probó una de sus tiendas en el simulador
  // y recibió el precio de OTRO producto. Medido: con la tienda puesta el motor da el
  // producto que ella juega, y sin ella se cae a la alineación GENERAL —que tiene sentado
  // otro—. O sea, a esa conversación no le llegó la tienda.
  //
  // Y NO HABÍA FORMA DE SABERLO MIRANDO EL LOG. Se revisaron el simulador, los dos
  // selectores de tienda y el camino del obrero, y los tres estaban bien. La pregunta
  // «¿esta conversación tiene tienda?» no la contestaba nadie, así que solo quedaba
  // adivinar — y adivinar es lo que este proyecto tiene prohibido.
  //
  // VA AQUÍ, en la línea que ya se lee la primera: una línea más por turno, y la que
  // convierte «el precio salió raro» en «esta conversación entró sin tienda».
  //
  // SIN TIENDAS CREADAS NO SE ESCRIBE NADA: quien no las use no ve una palabra nueva en
  // su registro.
  const laSuya = laTiendaDeLaConversacion(convo);
  const tiendaParaElLog =
    (config?.tiendas ?? []).length === 0
      ? ""
      : ` tienda=${laSuya?.nombre?.trim() || laSuya?.id || "NINGUNA"}`;
  console.log(
    process.env.DIAG_PAIS === "1"
      ? `[wf:turno] convo=${convo.id} estado=${convo.state} «${content.slice(0, 60)}»${tiendaParaElLog} · canal=${convo.channel}/${convo.test_channel} messenger=${isMessenger} pregunta_pais=${setting?.enabled} pais=${convo.country_code ?? "null"} detectado=${detectedForLog ?? "null"}`
      : `[wf:turno] convo=${convo.id} estado=${convo.state} «${content.slice(0, 60)}»${tiendaParaElLog}`
  );
  if (!isMessenger || setting?.enabled !== true) return false;
  if (convo.country_code && resolveCountry(convo.country_code) in COUNTRIES) return false;
  // No interrumpir conversaciones que ya pasaron la bienvenida antes de que
  // esta función se activara en el editor.
  if (convo.state && convo.state !== "new" && convo.state !== "awaiting_response") {
    return false;
  }

  const country = detectWrittenCountry(content);
  if (country) {
    setConversationCountry(convo.id, country);
    cancelPendingActionsByTypeForConvo(
      convo.id,
      MESSENGER_COUNTRY_REMINDER_ACTION
    );
    console.log(`[messenger] convo ${convo.id}: país confirmado ${country}`);
    return false;
  }

  // Primer contacto: saludo/pregunta configurada (consistente, tu voz).
  const firstAsk = convo.messenger_country_prompted !== 1;
  if (firstAsk) {
    const prompt = resolveSpintax(
      setting.message?.trim() || DEFAULT_COUNTRY_PROMPT
    );
    await sendBotText(convo, prompt);
    markMessengerCountryPrompted(convo.id);
    if (setting.reminder_enabled === true) {
      const rawDelay = setting.reminder_delay_minutes;
      const delayMinutes =
        typeof rawDelay === "number" && Number.isFinite(rawDelay)
          ? Math.max(1, Math.round(rawDelay))
          : 5;
      cancelPendingActionsByTypeForConvo(
        convo.id,
        MESSENGER_COUNTRY_REMINDER_ACTION
      );
      scheduleAction(
        convo.id,
        MESSENGER_COUNTRY_REMINDER_ACTION,
        {},
        Math.floor(Date.now() / 1000) + delayMinutes * 60
      );
      console.log(
        `[messenger] convo ${convo.id}: recordatorio de país en ${delayMinutes}m`
      );
    }
    console.log(`[messenger] convo ${convo.id}: esperando país`);
    return true;
  }

  // Re-pregunta: el cliente escribió otra cosa sin dar su país. Según el modo
  // elegido en el panel (spintax gratis / microcall / llm), SIN dar precio.
  const mode = setting.reask_mode ?? "spintax";
  let reply: string;
  if (mode === "microcall" || mode === "llm") {
    try {
      reply = await generateCountryReask(content, {
        rich: mode === "llm",
        instruction: setting.reask_instruction,
      });
    } catch (err) {
      console.error(`[messenger] reask IA (${mode}) falló, uso spintax:`, err);
      reply = pickReaskVariant(setting.reask_variants);
    }
  } else {
    reply = pickReaskVariant(setting.reask_variants);
  }
  await sendBotText(convo, reply);
  console.log(`[messenger] convo ${convo.id}: re-pregunta país (modo ${mode})`);
  return true;
}

export function getMessengerCountryReminderMessage(): string {
  return resolveSpintax(
    loadWorkflowConfig()?.messenger_country_prompt?.reminder_message?.trim() ||
      DEFAULT_COUNTRY_REMINDER
  );
}
