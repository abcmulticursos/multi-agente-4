import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

// Config en git (sobrevive deploys, editable desde VS Code + commit + push).
// Antes vivía en data/workflows/, pero data/ es un volumen ignorado por git
// y oculto bajo el mount persistente — por eso lo movimos a config/.
const CONFIG_DIR = path.join(process.cwd(), "config");
const CONFIG_PATH_YAML = path.join(CONFIG_DIR, "intro-data.yaml");
// Fallback al archivo legacy en data/ por si alguien lo dejó ahí.
const CONFIG_PATH_JSON_LEGACY = path.join(
  process.cwd(),
  "data",
  "workflows",
  "intro-data.json"
);

const DEFAULT_CONFIG_CONTENT = `# ─────────────────────────────────────────────────────────────────────────
# Configuración del flujo de bienvenida (saludo + intro data + pago)
# ─────────────────────────────────────────────────────────────────────────
# - Reemplaza los valores que empiezan con << y terminan con >> por tus
#   textos y URLs reales.
# - Para enlaces de Google Drive: pega el link de "compartir" completo.
#   Ejemplo: https://drive.google.com/file/d/ABC123/view?usp=sharing
#   El archivo debe ser PÚBLICO ("cualquier persona con el enlace") y < 25 MB.
# - El símbolo "|" antes de un texto multilínea le dice a YAML que respete
#   los saltos de línea. NO QUITES ese símbolo.
# - Mientras existan placeholders <<...>>, el flujo NO se ejecuta — así
#   puedes desplegar sin romper la conversación normal.
# - Los cambios se aplican SIN redeploy: edita, guarda, listo.
# ─────────────────────────────────────────────────────────────────────────

greeting:
  text: |
    <<TEXTO_DEL_SALUDO_INICIAL_PIDIENDO_NOMBRE>>

no_response_delay_seconds: 300

# Delay (segundos) entre mensajes consecutivos del bot (pago, etc.).
between_messages_delay_seconds: 5

intro_sequence:
  - type: audio
    drive_url: "<<DRIVE_URL_AUDIO_BIENVENIDA>>"
    delay_after_sec: 6

  - type: image
    drive_url: "<<DRIVE_URL_IMAGEN_1>>"
    caption: |
      <<CAPTION_IMAGEN_1>>
    delay_after_sec: 6

  - type: video
    drive_url: "<<DRIVE_URL_VIDEO>>"
    caption: |
      <<CAPTION_VIDEO>>
    delay_after_sec: 6

  - type: image
    drive_url: "<<DRIVE_URL_IMAGEN_METODOS_PAGO>>"
    caption: |
      <<CAPTION_IMAGEN_METODOS_PAGO>>
    delay_after_sec: 7

payment_responses:
  yape:
    - type: text
      body: |
        <<YAPE_TEXTO_1>>
    - type: text
      body: |
        <<YAPE_TEXTO_2>>
    - type: text
      body: |
        <<YAPE_TEXTO_3>>

  bcp_transferencia:
    - type: text
      body: |
        <<BCP_TRANSFERENCIA_TEXTO>>
`;

function ensureConfigFileExists(): void {
  if (fs.existsSync(CONFIG_PATH_YAML)) return;
  // Si solo existe el legacy JSON, no creamos el YAML — preservamos el JSON.
  if (fs.existsSync(CONFIG_PATH_JSON_LEGACY)) return;
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_PATH_YAML, DEFAULT_CONFIG_CONTENT, "utf8");
    console.log(`[wf] creado config por defecto en ${CONFIG_PATH_YAML}`);
  } catch (err) {
    console.error("[wf] no se pudo crear config por defecto:", err);
  }
}

// Variantes de texto: si se define el array (body_variants / caption_variants),
// el bot elige una opcion aleatoria al enviar. Reduce el "fingerprint" de
// contenido idéntico que Meta detecta como patrón de spam.
// Si NO se define, se usa el campo singular (body / caption) como antes.
export type ResponseStep =
  | { type: "text"; body?: string; body_variants?: string[] }
  | { type: "audio"; drive_url: string }
  | {
      type: "image";
      drive_url: string;
      caption?: string;
      caption_variants?: string[];
    }
  | {
      type: "video";
      drive_url: string;
      caption?: string;
      caption_variants?: string[];
    };

export interface IntroStep {
  type: "audio" | "image" | "video";
  drive_url: string;
  caption?: string;
  caption_variants?: string[];
  delay_after_sec: number;
}

/** Igual que IntroStep pero permite también pasos de tipo "text" (texto plano). */
export type SequenceStep =
  | IntroStep
  | {
      type: "text";
      body?: string;
      body_variants?: string[];
      delay_after_sec: number;
    };

function isValidVariant(s: string): boolean {
  // Una variante es valida si NO tiene placeholders <<...>>. Esto permite
  // que el operador rellene variantes una por una sin interrumpir el bot.
  return !(s.includes("<<") && s.includes(">>"));
}

/**
 * Elige al azar entre los variants si el array tiene al menos UNA variante
 * SIN placeholders. Filtra automaticamente las variantes que tengan <<...>>
 * sin completar (para que el cliente nunca vea un placeholder).
 *
 * Si no hay variants o todas tienen placeholders, devuelve el fallback
 * (campo singular original: body o caption). YAML retrocompatible.
 */
export function pickVariant(
  variants: string[] | undefined,
  fallback: string | undefined
): string | undefined {
  if (variants && variants.length > 0) {
    const valid = variants.filter(isValidVariant);
    if (valid.length > 0) {
      return valid[Math.floor(Math.random() * valid.length)];
    }
  }
  return fallback;
}

export interface FollowupSequence {
  /** Identificador legible para logs (ej. "seguimiento_1"). */
  name: string;
  /** Minutos desde el primer mensaje del cliente cuando arranca esta secuencia. */
  delay_minutes_from_first_message: number;
  /** Pasos de la secuencia (text / audio / image / video) con sus delays. */
  steps: SequenceStep[];
}

export interface WorkflowConfig {
  greeting: { text?: string; text_variants?: string[] };
  no_response_delay_seconds: number;
  /** Delay (segundos) entre mensajes consecutivos del bot — pago, intro de
   *  texto, etc. Por defecto 5. Editable desde el YAML. */
  between_messages_delay_seconds?: number;
  /** Delay (segundos) que el bot "espera" antes de responder a cada
   *  mensaje entrante. Mientras espera, muestra el indicador "escribiendo…"
   *  estilo humano. 0 = respuesta instantánea. Por defecto 6. */
  bot_response_delay_seconds?: number;
  /** Tiempo de espera (segundos) tras pedir el correo. Si el cliente no
   *  manda su email en este tiempo, el bot pasa al siguiente paso (gift).
   *  Mientras tanto, si pregunta cosas, el LLM responde sin cambiar de
   *  estado — el cliente puede mandar el email cuando quiera. Por defecto 60. */
  awaiting_email_timeout_seconds?: number;
  /** Precio del curso en soles (entero o decimal). El bot suma comprobantes
   *  hasta llegar a este monto para aprobar la compra. */
  course_price_soles: number;
  /** Descuento progresivo: cuando arranca el seguimiento indicado (1-based,
   *  ej. 3 = seguimiento_3), el precio del curso baja a `price_soles` para
   *  esa conversación en particular. Sigue así para esa convo hasta que
   *  paga o le hacen /restart. Dejar sin definir → no hay descuento. */
  discount_after_followup?: {
    /** Indice 1-based del seguimiento que dispara la oferta. */
    sequence_index: number;
    /** Nuevo precio que aplica desde ese momento. */
    price_soles: number;
  };
  /** Validación de comprobantes Yape/Plin. */
  payment_validation?: {
    /** El nombre del receptor del pago debe empezar con esto (case-insensitive).
     *  Solo aplica a Yape/Plin — BCP no incluye nombre fiable. */
    yape_recipient_name_starts_with?: string;
  };
  intro_sequence: IntroStep[];
  /**
   * Hasta 4 secuencias de seguimiento que se disparan en tiempos fijos
   * desde el PRIMER mensaje del cliente. Pensado para recuperar leads
   * que vieron el intro pero no compraron. Se cancelan al aprobarse el
   * pago. Si una secuencia tiene placeholders en sus steps, no se envía.
   */
  followup_sequences?: FollowupSequence[];
  payment_responses: {
    yape: ResponseStep[];
    bcp_transferencia: ResponseStep[];
  };
  /** Secuencia que se dispara cuando el cliente completa el pago de S/. course_price.
   *  Puede mezclar video/imagen/audio/texto. */
  payment_approved_sequence?: SequenceStep[];
  /** Plantilla del email que se envía al cliente cuando da su correo. */
  email_template?: {
    from_name: string;
    subject: string;
    body: string;
  };
  /** Mecánica de regalo por comentar en Facebook.
   *  Tras la captura del email (o no captura, vía timeout), el bot pregunta
   *  primero si el cliente quiere el regalo adicional. Solo si acepta,
   *  envía el audio + instrucciones FB. Si rechaza, cierra cordial.
   *  Cuando el cliente escribe "COMENTADO" (en awaiting_facebook_comment),
   *  recibe el reward_message. */
  gift_mechanic?: {
    /** Pregunta de consentimiento — se envía PRIMERO. Si el cliente
     *  responde afirmativamente, recién se manda el audio + ask_text. */
    consent_question: string;
    /** Mensaje cordial cuando el cliente rechaza el regalo. */
    decline_message?: string;
    /** Drive URL del audio con la explicación del regalo. */
    ask_audio_drive_url: string;
    /** Texto que se envía después del audio, con el link al post de FB. */
    ask_text: string;
    /** Mensaje que se envía cuando el cliente escribe "COMENTADO". */
    reward_message: string;
  };
}

/** Default si no se especifica en el YAML. */
export const DEFAULT_BETWEEN_MESSAGES_DELAY = 5;

let cached: { config: WorkflowConfig; mtime: number } | null = null;

function hasPlaceholder(value: unknown): boolean {
  if (typeof value === "string") {
    return value.includes("<<") && value.includes(">>");
  }
  if (Array.isArray(value)) return value.some(hasPlaceholder);
  if (value && typeof value === "object") {
    // Los arrays "_variants" pueden tener placeholders sin invalidar la
    // seccion — pickVariant los filtra al elegir. Solo chequeamos los
    // campos NO-variants (body, caption, drive_url, etc).
    return Object.entries(value)
      .filter(([key]) => !key.endsWith("_variants"))
      .some(([, v]) => hasPlaceholder(v));
  }
  return false;
}

function readConfigFromDisk(): { config: WorkflowConfig | null; path: string } {
  // Preferir YAML. Si no existe, intentar JSON legacy.
  const useYaml = fs.existsSync(CONFIG_PATH_YAML);
  const filePath = useYaml ? CONFIG_PATH_YAML : CONFIG_PATH_JSON_LEGACY;

  if (!fs.existsSync(filePath)) {
    console.warn(`[wf] no existe config (${filePath})`);
    return { config: null, path: filePath };
  }
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    console.error(`[wf] error leyendo ${filePath}:`, err);
    return { config: null, path: filePath };
  }
  let parsed: unknown;
  try {
    parsed = useYaml ? parseYaml(raw) : JSON.parse(raw);
  } catch (err) {
    console.error(`[wf] ${filePath} no es válido:`, err);
    return { config: null, path: filePath };
  }
  // Remover claves que empiezan con _ (legacy "_INSTRUCCIONES").
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      if (key.startsWith("_")) delete obj[key];
    }
  }
  return { config: parsed as WorkflowConfig, path: filePath };
}

/**
 * Carga config con caché basada en mtime — relee el archivo solo si cambió en
 * disco. Devuelve null si:
 *  - El archivo no existe
 *  - No es JSON válido
 *  - Aún tiene placeholders <<...>> sin rellenar (workflow desactivado)
 */
export function loadWorkflowConfig(): WorkflowConfig | null {
  ensureConfigFileExists();
  const yamlExists = fs.existsSync(CONFIG_PATH_YAML);
  const filePath = yamlExists ? CONFIG_PATH_YAML : CONFIG_PATH_JSON_LEGACY;

  let mtime = 0;
  try {
    mtime = fs.statSync(filePath).mtimeMs;
  } catch {
    return null;
  }
  if (cached && cached.mtime === mtime) {
    return cached.config;
  }
  const { config } = readConfigFromDisk();
  if (!config) return null;
  // Solo desactivamos el workflow si las secciones REQUERIDAS aún tienen
  // placeholders. Secciones opcionales (payment_approved_sequence) se
  // saltan en runtime si no están listas.
  const required = {
    greeting: config.greeting,
    intro_sequence: config.intro_sequence,
    payment_responses: config.payment_responses,
  };
  if (hasPlaceholder(required)) {
    console.warn(
      `[wf] ${path.basename(filePath)} tiene placeholders <<...>> en secciones requeridas, workflow desactivado`
    );
    cached = null;
    return null;
  }
  cached = { config, mtime };
  return config;
}

/**
 * Verifica si una sección concreta del config tiene placeholders. Útil
 * para saber si una secuencia opcional (payment_approved_sequence) está
 * lista para ejecutarse.
 */
export function sectionHasPlaceholder(section: unknown): boolean {
  return hasPlaceholder(section);
}

export function isWorkflowActive(): boolean {
  return loadWorkflowConfig() !== null;
}

/**
 * Devuelve el precio efectivo en soles para una conversación según su
 * estado de descuento. Single source of truth — la usa tanto la validación
 * de pagos como el system prompt que ve el LLM.
 */
export function getEffectivePriceSoles(discountActive: boolean): number {
  const config = loadWorkflowConfig();
  const fullPrice = config?.course_price_soles ?? 10;
  if (!discountActive) return fullPrice;
  return config?.discount_after_followup?.price_soles ?? fullPrice;
}
