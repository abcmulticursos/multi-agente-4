import { NextResponse, type NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { parseDocument, visit, Scalar, isSeq, isMap, type Document } from "yaml";
import { isGithubPublishConfigured, publishFileToGithub } from "@/lib/github";
import {
  PROMPT_SECTION_DEFS,
  defaultPromptSections,
} from "@/lib/system-prompt";
import {
  DEFAULT_CUSTOMER_SURVEY_MESSAGE,
  DEFAULT_ORDER_BUMP_OPTION_PRESENTATION_RULE,
  DEFAULT_PAYMENT_TEXT,
  getPaymentButtons,
} from "@/lib/workflow/config";

// Texto por defecto que acompaña a los botones (lo mismo que usa el motor).
const DEFAULT_BUTTONS_PROMPT = "Puedes elegir tu método de pago 👇";

// API del Editor de Flujo.
// GET  -> devuelve intro + seguimientos + horarios + oferta + ajustes globales.
// POST -> guarda esas secciones en el YAML PRESERVANDO comentarios y resto.
//
// El bot relee el YAML por mtime (config.ts), así que al guardar aplica en
// vivo. Si hay GITHUB_TOKEN, además publica a GitHub para que persista.
// Protegida automáticamente por proxy.ts.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONFIG_PATH = path.join(process.cwd(), "config", "intro-data.yaml");

type StepType = "text" | "image" | "audio" | "video" | "document";
type GalleryMediaType = "image" | "video" | "document" | "audio";

interface EditorStep {
  type: StepType;
  drive_url: string;
  texts: string[];
  delay_after_sec: number;
  /** false = burbuja apagada (el bot no la envía). Por defecto true. */
  enabled?: boolean;
}

interface EditorPaymentMenu {
  enabled?: boolean;
  use_buttons?: boolean;
  separate_bubble?: boolean;
  media_type?: "image" | "video";
  media_url?: string;
  text?: string;
}

interface EditorFollowupVariant {
  name?: string;
  steps: EditorStep[];
  enabled?: boolean;
}

interface EditorFollowup {
  name: string;
  delay_minutes_from_first_message: number;
  steps: EditorStep[];
  enabled?: boolean;
  variants?: EditorFollowupVariant[];
  offer_choice_menu_enabled?: boolean;
  payment_menu?: EditorPaymentMenu;
}

function normalizeType(t: unknown): StepType {
  return t === "image" || t === "audio" || t === "video" || t === "document"
    ? t
    : "text";
}

function normalizeGalleryMediaType(t: unknown): GalleryMediaType {
  return t === "video" || t === "document" || t === "audio" ? t : "image";
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function normalizePlaceholderKey(value: unknown): string {
  return str(value)
    .replace(/[{}]/g, "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function numList(v: unknown): number[] {
  return Array.isArray(v)
    ? v.filter((x): x is number => typeof x === "number" && Number.isFinite(x))
    : [];
}

// YAML payment_menu -> EditorPaymentMenu (UI). Devuelve undefined si no existe.
function readPaymentMenu(v: unknown): EditorPaymentMenu | undefined {
  if (!v || typeof v !== "object") return undefined;
  const m = v as Record<string, unknown>;
  return {
    enabled: m?.enabled === true,
    use_buttons: m?.use_buttons === true,
    separate_bubble: m?.separate_bubble === true,
    media_type: m?.media_type === "video" ? "video" : "image",
    media_url: str(m?.media_url),
    text: str(m?.text),
  };
}

// YAML step -> EditorStep (UI). Unifica body_variants/caption_variants en "texts".
function readStep(s: Record<string, unknown>): EditorStep {
  return {
    type: normalizeType(s?.type),
    drive_url: str(s?.drive_url),
    texts: Array.isArray(s?.body_variants)
      ? strList(s.body_variants)
      : strList(s?.caption_variants),
    delay_after_sec: num(s?.delay_after_sec, 0),
    enabled: s?.enabled !== false,
  };
}

function readChannelContent(v: unknown): Record<string, unknown> {
  const c = (v ?? {}) as Record<string, unknown>;
  const readSteps = (arr: unknown): EditorStep[] =>
    Array.isArray(arr) ? (arr as Record<string, unknown>[]).map(readStep) : [];
  const introGroups = Array.isArray(c?.intro_groups)
    ? (c.intro_groups as Record<string, unknown>[]).map((group) => ({
        name: str(group?.name),
        enabled: group?.enabled !== false,
        weight: Math.max(1, Math.floor(num(group?.weight, 1))),
        adName: str(group?.adName),
        adId: str(group?.adId),
        steps: readSteps(group?.steps),
      }))
    : [];
  const deliveryGroups = Array.isArray(c?.delivery_groups)
    ? (c.delivery_groups as Record<string, unknown>[]).map((group) => ({
        key: str(group?.key),
        name: str(group?.name),
        enabled: group?.enabled !== false,
        steps: readSteps(group?.steps),
      }))
    : [];
  const postSale =
    c?.post_sale && typeof c.post_sale === "object"
      ? (c.post_sale as Record<string, unknown>)
      : {};
  const followups = Array.isArray(c?.followups)
    ? (c.followups as Record<string, unknown>[]).map((f) => ({
        name: str(f?.name),
        delay_minutes_from_first_message: num(
          f?.delay_minutes_from_first_message,
          0
        ),
        enabled: f?.enabled !== false,
        offer_choice_menu_enabled: f?.offer_choice_menu_enabled === true,
        steps: readSteps(f?.steps),
        variants: Array.isArray(f?.variants)
          ? (f.variants as Record<string, unknown>[]).map((variant) => ({
              name: str(variant?.name),
              enabled: variant?.enabled !== false,
              steps: readSteps(variant?.steps),
            }))
          : [],
        payment_menu: readPaymentMenu(f?.payment_menu),
      }))
    : [];
  return {
    intro_groups: introGroups,
    followups,
    payment: readSteps(c?.payment),
    delivery: readSteps(c?.delivery),
    delivery_groups: deliveryGroups,
    post_sale: {
      whatsappPreference: str(postSale?.whatsappPreference),
      deliveryUsage: str(postSale?.deliveryUsage),
      lifetimeAccess: str(postSale?.lifetimeAccess),
      farewells: str(postSale?.farewells),
    },
  };
}

function writeChannelContent(content: Record<string, unknown>): Record<string, unknown> {
  const writeSteps = (value: unknown): Record<string, unknown>[] =>
    Array.isArray(value) ? (value as EditorStep[]).map(writeStep) : [];
  const introGroups = Array.isArray(content?.intro_groups)
    ? (content.intro_groups as Record<string, unknown>[]).map((group) => ({
        name: str(group?.name),
        enabled: group?.enabled !== false,
        weight: Math.max(1, Math.floor(num(group?.weight, 1))),
        adName: str(group?.adName),
        adId: str(group?.adId),
        steps: writeSteps(group?.steps),
      }))
    : [];
  const deliveryGroups = Array.isArray(content?.delivery_groups)
    ? (content.delivery_groups as Record<string, unknown>[]).map((group) => ({
        key: str(group?.key),
        name: str(group?.name),
        enabled: group?.enabled !== false,
        steps: writeSteps(group?.steps),
      }))
    : [];
  const postSale =
    content?.post_sale && typeof content.post_sale === "object"
      ? (content.post_sale as Record<string, unknown>)
      : {};
  const followups = Array.isArray(content?.followups)
    ? (content.followups as Record<string, unknown>[]).map((f) => ({
        name: str(f?.name),
        delay_minutes_from_first_message: num(
          f?.delay_minutes_from_first_message,
          0
        ),
        enabled: f?.enabled !== false,
        offer_choice_menu_enabled: f?.offer_choice_menu_enabled === true,
        steps: writeSteps(f?.steps),
        variants: Array.isArray(f?.variants)
          ? (f.variants as Record<string, unknown>[]).map((variant) => ({
              name: str(variant?.name),
              enabled: variant?.enabled !== false,
              steps: writeSteps(variant?.steps),
            }))
          : [],
        payment_menu: readPaymentMenu(f?.payment_menu),
      }))
    : [];
  return {
    intro_groups: introGroups,
    followups,
    payment: writeSteps(content?.payment),
    delivery: writeSteps(content?.delivery),
    delivery_groups: deliveryGroups,
    post_sale: {
      whatsappPreference: str(postSale?.whatsappPreference).replace(/\r\n/g, "\n"),
      deliveryUsage: str(postSale?.deliveryUsage).replace(/\r\n/g, "\n"),
      lifetimeAccess: str(postSale?.lifetimeAccess).replace(/\r\n/g, "\n"),
      farewells: str(postSale?.farewells).replace(/\r\n/g, "\n"),
    },
  };
}

// EditorStep (UI) -> objeto YAML. text->body_variants, media->drive_url+caption_variants.
function writeStep(s: EditorStep): Record<string, unknown> {
  const type = normalizeType(s?.type);
  const texts = (Array.isArray(s?.texts) ? s.texts : [])
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.replace(/\r\n/g, "\n"));
  const delay = num(s?.delay_after_sec, 0);
  // enabled solo se escribe cuando está apagado → YAML limpio.
  const off = s?.enabled === false ? { enabled: false } : {};
  if (type === "text") {
    return { type, body_variants: texts, delay_after_sec: delay, ...off };
  }
  return {
    type,
    drive_url: str(s?.drive_url),
    caption_variants: texts,
    delay_after_sec: delay,
    ...off,
  };
}

// Crea un nodo YAML forzando bloque literal (|) en textos multilínea.
function blockNode(doc: Document, value: unknown) {
  const node = doc.createNode(value);
  visit(node, {
    Scalar(_key, scalar) {
      if (typeof scalar.value === "string" && scalar.value.includes("\n")) {
        scalar.type = Scalar.BLOCK_LITERAL;
      }
    },
  });
  return node;
}

const SALESBOT_MODES = ["ai", "salesbot_strong", "salesbot_only"] as const;
const SALESBOT_MODALITIES = [
  "lineal",
  "order_bump",
  "bioferta",
  "doble_oferta_dos",
] as const;
const SALESBOT_CHANNELS = [
  "all",
  "whatsapp",
  "messenger",
  "instagram",
  "tiktok",
] as const;
const SALESBOT_MATCHES = ["contains_any", "contains_all", "regex"] as const;
const SALESBOT_ACTIONS = [
  "send_text",
  "send_steps",
  "show_order_bump",
  "choose_combo",
  "choose_basico",
  "resend_payment",
  "send_payment_menu",
  "resend_material",
  "accept_gift",
  "decline_gift",
  "claim_gift",
  "human",
  "fallback_ai",
] as const;

function oneOf<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  fallback: T[number]
): T[number] {
  return typeof value === "string" && allowed.includes(value)
    ? (value as T[number])
    : fallback;
}

function readSalesbot(v: unknown): Record<string, unknown> {
  const raw = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const rawModes =
    raw.modes && typeof raw.modes === "object"
      ? (raw.modes as Record<string, unknown>)
      : {};
  const rawRules =
    raw.rules && typeof raw.rules === "object"
      ? (raw.rules as Record<string, unknown>)
      : {};
  const modes = Object.fromEntries(
    SALESBOT_MODALITIES.map((mode) => [
      mode,
      oneOf(rawModes[mode], SALESBOT_MODES, "ai"),
    ])
  );
  const rules = Object.fromEntries(
    SALESBOT_MODALITIES.map((mode) => {
      const items = Array.isArray(rawRules[mode])
        ? (rawRules[mode] as Record<string, unknown>[])
        : [];
      return [
        mode,
        items.map((rule, index) => ({
          id: str(rule?.id) || `rule_${mode}_${index + 1}`,
          name: str(rule?.name) || `Regla ${index + 1}`,
          enabled: rule?.enabled !== false,
          priority: Math.floor(num(rule?.priority, 100)),
          channel: oneOf(rule?.channel, SALESBOT_CHANNELS, "all"),
          states: strList(rule?.states).map((x) => x.trim()).filter(Boolean),
          match: oneOf(rule?.match, SALESBOT_MATCHES, "contains_any"),
          keywords: strList(rule?.keywords).map((x) => x.trim()).filter(Boolean),
          pattern: str(rule?.pattern),
          action: oneOf(rule?.action, SALESBOT_ACTIONS, "send_text"),
          response: str(rule?.response),
          steps: Array.isArray(rule?.steps)
            ? (rule.steps as Record<string, unknown>[]).map(readStep)
            : [],
          next_state: str(rule?.next_state),
          stop_after_action: rule?.stop_after_action !== false,
        })),
      ];
    })
  );
  return {
    modes,
    rules,
    fallback_text:
      str(raw.fallback_text) ||
      "No te entendi bien. Por favor elige una opcion o escribeme un poco mas claro.",
  };
}

function writeSalesbot(v: unknown): Record<string, unknown> {
  const normalized = readSalesbot(v) as Record<string, unknown>;
  const rulesRaw =
    normalized.rules && typeof normalized.rules === "object"
      ? (normalized.rules as Record<string, unknown>)
      : {};
  const rules = Object.fromEntries(
    SALESBOT_MODALITIES.map((mode) => {
      const items = Array.isArray(rulesRaw[mode])
        ? (rulesRaw[mode] as Record<string, unknown>[])
        : [];
      return [
        mode,
        items.map((rule) => ({
          ...rule,
          steps: Array.isArray(rule.steps)
            ? (rule.steps as EditorStep[]).map(writeStep)
            : [],
        })),
      ];
    })
  );
  return { ...normalized, rules };
}

const TYPE_ES: Record<string, string> = {
  text: "texto",
  image: "imagen",
  audio: "audio",
  video: "video",
  document: "PDF",
};

// Regenera encabezados (comentarios) antes de cada paso: "# Paso N — tipo".
// Así el YAML siempre queda navegable aunque el editor reescriba la sección.
function annotateSteps(node: unknown, steps: { type?: string }[]) {
  if (!isSeq(node)) return;
  node.items.forEach((item, i) => {
    const t = steps[i]?.type ?? "";
    (item as { commentBefore?: string }).commentBefore = ` Paso ${i + 1} — ${
      TYPE_ES[t] ?? t
    }`;
  });
}

export async function GET() {
  let raw: string;
  try {
    raw = fs.readFileSync(CONFIG_PATH, "utf8");
  } catch {
    return NextResponse.json(
      { error: "No se pudo leer config/intro-data.yaml" },
      { status: 500 }
    );
  }

  let config: Record<string, unknown>;
  try {
    config = parseDocument(raw).toJS() as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "El YAML actual no es válido, revísalo antes de editar" },
      { status: 422 }
    );
  }

  const intro_sequence: EditorStep[] = Array.isArray(config?.intro_sequence)
    ? (config.intro_sequence as Record<string, unknown>[]).map(readStep)
    : [];

  const intro_sequence_2: EditorStep[] = Array.isArray(
    config?.intro_sequence_2
  )
    ? (config.intro_sequence_2 as Record<string, unknown>[]).map(readStep)
    : [];
  const intro_sequence_3: EditorStep[] = Array.isArray(
    config?.intro_sequence_3
  )
    ? (config.intro_sequence_3 as Record<string, unknown>[]).map(readStep)
    : [];
  const intro_extra_sequences: EditorStep[][] = Array.isArray(
    config?.intro_extra_sequences
  )
    ? (config.intro_extra_sequences as unknown[])
        .filter((seq): seq is Record<string, unknown>[] => Array.isArray(seq))
        .map((seq) => seq.map(readStep))
    : [];
  const ie = Array.isArray(config?.intro_enabled)
    ? (config.intro_enabled as unknown[])
    : [];
  const introCount = 3 + intro_extra_sequences.length;
  const intro_enabled = Array.from({ length: introCount }, (_, i) =>
    ie.length ? ie[i] === true : i === 0
  );
  const intro_weights = numList(config?.intro_weights);
  const intro_names = strList(config?.intro_names);
  const campaign_name = str(config?.campaign_name);
  const intro_ad_names = strList(config?.intro_ad_names);
  const intro_ad_ids = strList(config?.intro_ad_ids);

  const followups: EditorFollowup[] = Array.isArray(config?.followup_sequences)
    ? (config.followup_sequences as Record<string, unknown>[]).map((f) => ({
        name: str(f?.name),
        delay_minutes_from_first_message: num(
          f?.delay_minutes_from_first_message,
          0
        ),
        enabled: f?.enabled !== false,
        offer_choice_menu_enabled: f?.offer_choice_menu_enabled === true,
        steps: Array.isArray(f?.steps)
          ? (f.steps as Record<string, unknown>[]).map(readStep)
          : [],
        variants: Array.isArray(f?.variants)
          ? (f.variants as Record<string, unknown>[]).map((v) => ({
              name: str(v?.name),
              enabled: v?.enabled !== false,
              steps: Array.isArray(v?.steps)
                ? (v.steps as Record<string, unknown>[]).map(readStep)
                : [],
            }))
          : [],
        payment_menu: readPaymentMenu(f?.payment_menu),
      }))
    : [];

  const sch = (config?.followup_schedule ?? {}) as Record<string, unknown>;
  const qh = (sch?.quiet_hours ?? {}) as Record<string, unknown>;
  const schedule = {
    quiet_hours_enabled: sch?.quiet_hours_enabled !== false,
    slots_peru: strList(sch?.slots_peru),
    min_gap_hours_between: num(sch?.min_gap_hours_between, 4),
    burst_delays_seconds: numList(sch?.burst_delays_seconds),
    quiet_hours: {
      start: str(qh?.start),
      end: str(qh?.end),
      resume_at: str(qh?.resume_at),
    },
    followup_1_ignore_quiet_hours: sch?.followup_1_ignore_quiet_hours === true,
  };

  const disc = config?.discount_after_followup as
    | Record<string, unknown>
    | undefined;
  const offer = disc
    ? {
        sequence_index: num(disc?.sequence_index, 0),
        price_soles: num(disc?.price_soles, 0),
      }
    : null;

  const globals = {
    course_price_soles: num(config?.course_price_soles, 10),
    between_messages_delay_seconds: num(
      config?.between_messages_delay_seconds,
      5
    ),
    llm_bubble_limit_enabled: config?.llm_bubble_limit_enabled === true,
    llm_max_bubbles: num(config?.llm_max_bubbles, 3),
    bot_response_delay_seconds: num(config?.bot_response_delay_seconds, 6),
    awaiting_email_timeout_seconds: num(
      config?.awaiting_email_timeout_seconds,
      300
    ),
    post_gift_comment_auto_human_delay_minutes: num(
      config?.post_gift_comment_auto_human_delay_minutes,
      30
    ),
    customer_survey_delay_minutes: num(
      config?.customer_survey_delay_minutes,
      60
    ),
    no_response_delay_seconds: num(config?.no_response_delay_seconds, 300),
    autopurge_inactive_days: num(config?.autopurge_inactive_days, 0),
  };

  const pvCfg = (config?.payment_validation ?? {}) as Record<string, unknown>;
  const payment_validation = {
    require_receipt_date: pvCfg?.require_receipt_date === true,
    yape_recipient_name_starts_with: str(
      pvCfg?.yape_recipient_name_starts_with
    ),
  };

  // Respuestas de pago por método como PASOS (readStep unifica body/variantes
  // en "texts", igual que los seguimientos → editor con variantes + colapsar).
  const prCfg = (config?.payment_responses ?? {}) as Record<string, unknown>;
  const readSteps = (arr: unknown): EditorStep[] =>
    Array.isArray(arr) ? (arr as Record<string, unknown>[]).map(readStep) : [];
  const payment_methods = {
    yape: readSteps(prCfg?.yape),
    bcp_transferencia: readSteps(prCfg?.bcp_transferencia),
    efectivo: readSteps(prCfg?.efectivo),
  };
  const direct_payment_enabled = config?.direct_payment_enabled === true;
  const direct_payment_steps = readSteps(config?.direct_payment_steps);
  const direct_payment_cta = str(config?.direct_payment_cta);
  const direct_payment_without_choice_steps = readSteps(
    config?.direct_payment_without_choice_steps
  );
  const direct_payment_without_choice_cta = str(
    config?.direct_payment_without_choice_cta
  );

  // Botones en el menú de métodos de pago (Yape/Plin/BCP).
  const payment_method_buttons = config?.payment_method_buttons === true;
  // Modo silencioso (no charla; default OFF) y toggle global de seguimientos
  // (default ON = comportamiento actual).
  const silent_mode = config?.silent_mode === true;
  const followups_enabled = config?.followups_enabled !== false;
  const intro_variant_rotation_enabled =
    config?.intro_variant_rotation_enabled !== false;
  const progressive_samples_enabled =
    config?.progressive_samples_enabled === true;
  const progressive_samples_max_per_batch = Math.max(
    1,
    Math.floor(num(config?.progressive_samples_max_per_batch, 2))
  );
  const progressive_samples_more_text =
    str(config?.progressive_samples_more_text) ||
    "Te muestro algunas para no saturarte 😊 ¿Quieres ver más?";
  const order_bump_option_presentation_rule =
    str(config?.order_bump_option_presentation_rule) ||
    DEFAULT_ORDER_BUMP_OPTION_PRESENTATION_RULE;
  const custom_placeholders = Array.isArray(config?.custom_placeholders)
    ? (config.custom_placeholders as Record<string, unknown>[])
        .map((item) => ({
          key: normalizePlaceholderKey(item?.key),
          value: str(item?.value),
          description: str(item?.description),
        }))
        .filter((item) => item.key && item.value)
    : [];
  const post_sale_reoffer = config?.post_sale_reoffer !== false;
  const post_gift_comment_auto_human_enabled =
    config?.post_gift_comment_auto_human_enabled === true;
  // Pre-llenamos con los DEFAULTS visibles (texto/prompt/botones) cuando el
  // YAML está vacío, para que TODO lo que el bot envía sea visible y editable
  // desde el panel — nada oculto en el código (clave para clonar el bot).
  const payment_buttons_prompt =
    str(config?.payment_buttons_prompt) || DEFAULT_BUTTONS_PROMPT;
  const payment_buttons_raw = Array.isArray(config?.payment_buttons)
    ? (config.payment_buttons as Record<string, unknown>[]).map((b) => ({
        label: str(b?.label),
        method: str(b?.method),
        aliases: strList(b?.aliases),
      }))
    : [];
  const payment_buttons =
    payment_buttons_raw.length > 0 ? payment_buttons_raw : getPaymentButtons();
  const payment_text = str(config?.payment_text) || DEFAULT_PAYMENT_TEXT;
  const country_mode =
    config?.country_mode === "auto_phone" ? "auto_phone" : "fixed";
  const channelsRaw =
    config?.channels && typeof config.channels === "object"
      ? (config.channels as Record<string, unknown>)
      : {};
  const readChannel = (key: string) => {
    const channel = (channelsRaw[key] ?? {}) as Record<string, unknown>;
    const rawTemplates =
      channel?.modality_templates &&
      typeof channel.modality_templates === "object"
        ? (channel.modality_templates as Record<string, unknown>)
        : {};
    const modality_templates = Object.fromEntries(
      ["lineal", "order_bump", "bioferta", "doble_oferta_dos"].map((mode) => [
        mode,
        readChannelContent(rawTemplates[mode]),
      ])
    );
    return {
      enabled: channel?.enabled === true,
      use_content: channel?.use_content === true,
      modality_templates,
    };
  };
  const channels = {
    whatsapp: readChannel("whatsapp"),
    messenger: readChannel("messenger"),
    instagram: readChannel("instagram"),
    tiktok: readChannel("tiktok"),
  };
  const salesbot = readSalesbot(config?.salesbot);
  const country_sales_enabled =
    config?.country_sales_enabled && typeof config.country_sales_enabled === "object"
      ? (config.country_sales_enabled as Record<string, unknown>)
      : {};
  const profilesRaw =
    config?.payment_profiles_by_country &&
    typeof config.payment_profiles_by_country === "object"
      ? (config.payment_profiles_by_country as Record<string, unknown>)
      : {};
  const payment_profiles_by_country = Object.fromEntries(
    Object.entries(profilesRaw).map(([country, rawProfile]) => {
      const p = (rawProfile ?? {}) as Record<string, unknown>;
      const profileButtons = Array.isArray(p?.payment_buttons)
        ? (p.payment_buttons as Record<string, unknown>[]).map((b) => ({
            label: str(b?.label),
            method: str(b?.method),
            aliases: strList(b?.aliases),
          }))
        : [];
      const profileResponses = (p?.payment_responses ?? {}) as Record<
        string,
        unknown
      >;
      const responseEntries = Object.entries(profileResponses).map(
        ([method, steps]) => [method, readSteps(steps)]
      );
      return [
        country,
        {
          enabled: p?.enabled !== false,
          course_price_soles: num(p?.course_price_soles, 0),
          payment_validation: {
            yape_recipient_name_starts_with: str(
              (p?.payment_validation as Record<string, unknown> | undefined)
                ?.yape_recipient_name_starts_with
            ),
          },
          payment_text: str(p?.payment_text),
          payment_buttons: profileButtons,
          payment_responses: Object.fromEntries(responseEntries),
        },
      ];
    })
  );

  // Redirección por país (Ecuador): burbujas editables que el sistema manda
  // cuando la IA marca <<PAIS: ecuador>>.
  const crCfg = (config?.country_redirect ?? {}) as Record<string, unknown>;
  const country_ecuador = readSteps(crCfg?.ecuador);

  // Bioferta Oferta Doble: 2 productos + pack. APAGADA por defecto.
  const bfCfg = (config?.bioferta_doble ?? {}) as Record<string, unknown>;
  const readProduct = (p: unknown, withDelivery: boolean) => {
    const o = (p ?? {}) as Record<string, unknown>;
    return {
      name: str(o?.name),
      aliases: strList(o?.aliases),
      ...(withDelivery ? { delivery: readSteps(o?.delivery) } : {}),
    };
  };
  // Order Bump: oferta intermedia (combo/básico). APAGADA por defecto.
  const obCfg = (config?.order_bump ?? {}) as Record<string, unknown>;
  const inheritedPaymentSteps = (
    value: unknown,
    fallback: EditorStep[]
  ): EditorStep[] => {
    const own = readSteps(value);
    if (own.length > 0) return own;
    // Primera carga: cristaliza visualmente las respuestas actuales de Pago.
    // Clonamos cada paso para que Combo y Básico puedan editarse por separado.
    return fallback.map((step) => ({
      ...step,
      texts: [...step.texts],
    }));
  };
  const readObOption = (o: unknown) => {
    const x = (o ?? {}) as Record<string, unknown>;
    const optionPayments = (x?.payment_responses ?? {}) as Record<
      string,
      unknown
    >;
    return {
      name: str(x?.name),
      aliases: strList(x?.aliases),
      price_soles: num(x?.price_soles, 0),
      discount_price_soles: num(x?.discount_price_soles, 0),
      regalos: str(x?.regalos),
      response: readSteps(x?.response),
      payment_responses: {
        yape: inheritedPaymentSteps(
          optionPayments.yape,
          payment_methods.yape
        ),
        bcp_transferencia: inheritedPaymentSteps(
          optionPayments.bcp_transferencia,
          payment_methods.bcp_transferencia
        ),
        efectivo: inheritedPaymentSteps(
          optionPayments.efectivo,
          payment_methods.efectivo
        ),
      },
      delivery: readSteps(x?.delivery),
    };
  };
  const order_bump = {
    enabled: obCfg?.enabled === true,
    use_buttons: obCfg?.use_buttons === true,
    intro: readSteps(obCfg?.intro),
    choice_prompt: str(obCfg?.choice_prompt),
    choice_clarification: str(obCfg?.choice_clarification),
    offer_on_reengaged_price: obCfg?.offer_on_reengaged_price !== false,
    offer_on_intro_first_message: obCfg?.offer_on_intro_first_message !== false,
    combo: readObOption(obCfg?.combo),
    basico: readObOption(obCfg?.basico),
  };
  // Doble Oferta 2 Productos: elección (combo/básico) al FINAL de la intro, sin
  // 2ª intro. Reusa readObOption (misma forma de opción que el order bump).
  const ddCfg = (config?.doble_oferta_dos ?? {}) as Record<string, unknown>;
  const doble_oferta_dos = {
    enabled: ddCfg?.enabled === true,
    use_buttons: ddCfg?.use_buttons === true,
    separate_bubble: ddCfg?.separate_bubble === true,
    basico_first: ddCfg?.basico_first === true,
    choice_prompt: str(ddCfg?.choice_prompt),
    choice_buttons_prompt: str(ddCfg?.choice_buttons_prompt),
    choice_clarification: str(ddCfg?.choice_clarification),
    combo: readObOption(ddCfg?.combo),
    basico: readObOption(ddCfg?.basico),
  };

  const bioferta = {
    enabled: bfCfg?.enabled === true,
    use_buttons: bfCfg?.use_buttons === true,
    pack_price_soles: num(bfCfg?.pack_price_soles, 0),
    pack_discount_price_soles: num(bfCfg?.pack_discount_price_soles, 0),
    // Producto 1 (principal): solo nombre/alias. Su entrega = payment_approved
    // (pestaña "Entrega"), única fuente de verdad.
    product_a: readProduct(bfCfg?.product_a, false),
    product_b: readProduct(bfCfg?.product_b, true),
    pack: readProduct(bfCfg?.pack, true),
    ask_choice_text: str(bfCfg?.ask_choice_text),
  };

  // Entrega "Pago Aprobado": secuencia post-pago (video + enlace + pedir email).
  // Es la entrega central del bot (y la del Producto 1 de la bioferta).
  const payment_approved = readSteps(config?.payment_approved_sequence);
  const customer_survey_enabled = config?.customer_survey_enabled === true;
  const customer_survey_auto_human_enabled =
    config?.customer_survey_auto_human_enabled === true;
  const customer_survey_message =
    str(config?.customer_survey_message) || DEFAULT_CUSTOMER_SURVEY_MESSAGE;

  // Saludo inicial (greeting): primer mensaje. Variantes de texto.
  const grCfg = (config?.greeting ?? {}) as Record<string, unknown>;
  const greetingTexts = strList(grCfg?.text_variants);
  const greeting = {
    texts: greetingTexts.length
      ? greetingTexts
      : str(grCfg?.text)
        ? [str(grCfg?.text)]
        : [""],
    skip_ask_name: grCfg?.skip_ask_name === true,
  };

  // Plantilla del email post-compra.
  const emCfg = (config?.email_template ?? {}) as Record<string, unknown>;
  const email = {
    from_name: str(emCfg?.from_name),
    subject: str(emCfg?.subject),
    body: str(emCfg?.body),
  };
  const emVipCfg = (config?.email_template_vip ?? {}) as Record<
    string,
    unknown
  >;
  const email_vip = {
    from_name: str(emVipCfg?.from_name),
    subject: str(emVipCfg?.subject),
    body: str(emVipCfg?.body),
  };

  const gm = (config?.gift_mechanic ?? {}) as Record<string, unknown>;
  const gift = {
    has: Boolean(config?.gift_mechanic),
    consent_question: str(gm?.consent_question),
    consent_buttons_enabled: gm?.consent_buttons_enabled === true,
    consent_buttons_prompt: str(gm?.consent_buttons_prompt),
    consent_buttons: Array.isArray(gm?.consent_buttons)
      ? (gm.consent_buttons as Record<string, unknown>[]).map((b) => ({
          label: str(b?.label),
          action:
            b?.action === "reject"
              ? "reject"
              : b?.action === "text"
                ? "text"
                : "accept",
        }))
      : [],
    consent_yes_label: str(gm?.consent_yes_label),
    consent_no_label: str(gm?.consent_no_label),
    consent_sequence: Array.isArray(gm?.consent_sequence)
      ? (gm.consent_sequence as Record<string, unknown>[]).map(readStep)
      : str(gm?.consent_question)
        ? [
            {
              type: "text" as const,
              drive_url: "",
              texts: [str(gm?.consent_question)],
              delay_after_sec: 6,
              enabled: true,
            },
          ]
        : [],
    decline_message: str(gm?.decline_message),
    ask_audio_drive_url: str(gm?.ask_audio_drive_url),
    ask_text: str(gm?.ask_text),
    ask_sequence: Array.isArray(gm?.ask_sequence)
      ? (gm.ask_sequence as Record<string, unknown>[]).map(readStep)
      : [
          {
            type: "audio" as const,
            drive_url: str(gm?.ask_audio_drive_url),
            texts: [],
            delay_after_sec: 6,
            enabled: true,
          },
          {
            type: "text" as const,
            drive_url: "",
            texts: [str(gm?.ask_text)],
            delay_after_sec: 6,
            enabled: true,
          },
        ],
    reward_message: str(gm?.reward_message),
    first_campaign: str(gm?.first_campaign),
    variants: Array.isArray(gm?.ask_text_variants)
      ? (gm.ask_text_variants as Record<string, unknown>[]).map((v) =>
          typeof v?.separator === "string"
            ? { weight: 0, text: "", ad_ids: [], separator: v.separator }
            : {
                weight: num(v?.weight, 0),
                text: str(v?.text),
                label: str(v?.label),
                enabled: v?.enabled !== false,
                ad_ids: Array.isArray(v?.ad_ids)
                  ? (v.ad_ids as unknown[])
                      .map((x) => String(x).trim())
                      .filter(Boolean)
                  : [],
              }
        )
      : [],
  };

  // Cerebro EN CAJAS. Defaults = partición del SYSTEM_PROMPT por defecto.
  // Lo guardado en el YAML (si existe) pisa cada caja; lo no guardado usa el
  // default. `prompt_section_defaults` se usa para el botón "Restaurar".
  const prompt_section_defaults = defaultPromptSections();
  const savedSections = (config?.system_prompt_sections ?? {}) as Record<
    string,
    unknown
  >;
  const prompt_sections: Record<string, string> = {};
  for (const d of PROMPT_SECTION_DEFS) {
    const saved = savedSections[d.key];
    prompt_sections[d.key] =
      typeof saved === "string" ? saved : prompt_section_defaults[d.key];
  }
  const prompt_section_defs = PROMPT_SECTION_DEFS.map((d) => ({
    key: d.key,
    label: d.label,
  }));

  // Galería de imágenes/videos (sumable). Cada item: tema, cuándo, enlace, tipo.
  const readGallery = (arr: unknown) =>
    Array.isArray(arr)
      ? (arr as Record<string, unknown>[]).map((g) => ({
          topic: str(g?.topic),
          keywords: strList(g?.keywords)
            .map((k) => k.trim())
            .filter(Boolean),
          when: str(g?.when),
          media_type: normalizeGalleryMediaType(g?.media_type),
          drive_url: str(g?.drive_url),
          caption: str(g?.caption),
          enabled: g?.enabled !== false,
        }))
      : [];
  const image_gallery = readGallery(config?.image_gallery);
  const image_gallery_2 = readGallery(config?.image_gallery_2);

  return NextResponse.json(
    {
      intro_sequence,
      intro_sequence_2,
      intro_sequence_3,
      intro_extra_sequences,
      intro_enabled,
      intro_weights,
      intro_names,
      campaign_name,
      intro_ad_names,
      intro_ad_ids,
      intro_payment_menu: readPaymentMenu(config?.intro_payment_menu),
      course_content: str(config?.course_content),
      product_name: str(config?.product_name) || "Producto principal",
      image_gallery,
      course_content_2: str(config?.course_content_2),
      product_name_2: str(config?.product_name_2) || "Producto 2",
      image_gallery_2,
      pack_gallery: readGallery(config?.pack_gallery),
      product_info_topics: Array.isArray(config?.product_info_topics)
        ? config.product_info_topics.filter(
            (t): t is string => typeof t === "string"
          )
        : [],
      complement_info_topic: str(config?.complement_info_topic),
      distrust_message: str(config?.distrust_message),
      extra_info_topics: Array.isArray(config?.extra_info_topics)
        ? config.extra_info_topics.filter(
            (t): t is string => typeof t === "string"
          )
        : [],
      detail_gallery: readGallery(config?.detail_gallery),
      gmail_user: process.env.GMAIL_USER ?? "",
      followups,
      schedule,
      offer,
      globals,
      payment_validation,
      payment_methods,
      direct_payment_enabled,
      direct_payment_steps,
      direct_payment_cta,
      direct_payment_without_choice_steps,
      direct_payment_without_choice_cta,
      payment_method_buttons,
      payment_buttons_prompt,
      payment_buttons,
      payment_text,
      country_mode,
      country_sales_enabled,
      payment_profiles_by_country,
      channels,
      salesbot,
      country_ecuador,
      bioferta,
      order_bump,
      doble_oferta_dos,
      silent_mode,
      followups_enabled,
      intro_variant_rotation_enabled,
      progressive_samples_enabled,
      progressive_samples_max_per_batch,
      progressive_samples_more_text,
      order_bump_option_presentation_rule,
      custom_placeholders,
      post_sale_reoffer,
      post_gift_comment_auto_human_enabled,
      modality_templates: config?.modality_templates,
      payment_approved,
      customer_survey_enabled,
      customer_survey_auto_human_enabled,
      customer_survey_message,
      greeting,
      email,
      email_vip,
      prompt_sections,
      prompt_section_defaults,
      prompt_section_defs,
      gift,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  let raw: string;
  try {
    raw = fs.readFileSync(CONFIG_PATH, "utf8");
  } catch {
    return NextResponse.json(
      { error: "No se pudo leer config/intro-data.yaml" },
      { status: 500 }
    );
  }

  const doc = parseDocument(raw);

  // intro_sequence
  if (Array.isArray(body.intro_sequence)) {
    const yamlSteps = (body.intro_sequence as EditorStep[]).map(writeStep);
    const node = blockNode(doc, yamlSteps);
    annotateSteps(node, yamlSteps);
    doc.set("intro_sequence", node);
  }

  // Intros adicionales (2 y 3) + qué intros están activas para el reparto.
  if (Array.isArray(body.intro_sequence_2)) {
    const yamlSteps = (body.intro_sequence_2 as EditorStep[]).map(writeStep);
    const node = blockNode(doc, yamlSteps);
    annotateSteps(node, yamlSteps);
    doc.set("intro_sequence_2", node);
  }
  if (Array.isArray(body.intro_sequence_3)) {
    const yamlSteps = (body.intro_sequence_3 as EditorStep[]).map(writeStep);
    const node = blockNode(doc, yamlSteps);
    annotateSteps(node, yamlSteps);
    doc.set("intro_sequence_3", node);
  }
  if (Array.isArray(body.intro_extra_sequences)) {
    const yamlSequences = (body.intro_extra_sequences as unknown[])
      .filter((seq): seq is EditorStep[] => Array.isArray(seq))
      .map((seq) => seq.map(writeStep));
    doc.set("intro_extra_sequences", blockNode(doc, yamlSequences));
  }
  if (Array.isArray(body.intro_enabled)) {
    doc.set(
      "intro_enabled",
      (body.intro_enabled as unknown[]).map((x) => x === true)
    );
  }
  if (Array.isArray(body.intro_weights)) {
    doc.set(
      "intro_weights",
      (body.intro_weights as unknown[]).map((x) =>
        typeof x === "number" && Number.isFinite(x) && x > 0 ? x : 1
      )
    );
  }
  if (Array.isArray(body.intro_names)) {
    doc.set(
      "intro_names",
      (body.intro_names as unknown[]).map((x) =>
        typeof x === "string" ? x.trim() : ""
      )
    );
  }
  if (typeof body.campaign_name === "string") {
    doc.set("campaign_name", body.campaign_name.trim());
  }
  if (Array.isArray(body.intro_ad_names)) {
    doc.set(
      "intro_ad_names",
      (body.intro_ad_names as unknown[]).map((x) =>
        typeof x === "string" ? x.trim() : ""
      )
    );
  }
  if (Array.isArray(body.intro_ad_ids)) {
    doc.set(
      "intro_ad_ids",
      (body.intro_ad_ids as unknown[]).map((x) =>
        typeof x === "string" ? x.trim() : ""
      )
    );
  }

  // intro_payment_menu (menú de pago al final del intro). Solo se escribe si
  // está activado → YAML limpio.
  {
    const m = body.intro_payment_menu as EditorPaymentMenu | undefined;
    if (m?.enabled) {
      doc.set(
        "intro_payment_menu",
        blockNode(doc, {
          enabled: true,
          use_buttons: m.use_buttons === true,
          separate_bubble: m.separate_bubble === true,
          media_type: m.media_type === "video" ? "video" : "image",
          media_url: str(m.media_url),
          text: str(m.text).replace(/\r\n/g, "\n"),
        })
      );
    } else if (doc.get("intro_payment_menu")) {
      // Si se apagó, lo quitamos del YAML.
      doc.delete("intro_payment_menu");
    }
  }

  // followup_sequences (con encabezado por seguimiento + por paso)
  if (Array.isArray(body.followups)) {
    const yamlFollowups = (body.followups as EditorFollowup[]).map((f) => ({
      name: str(f?.name) || "seguimiento",
      delay_minutes_from_first_message: num(
        f?.delay_minutes_from_first_message,
        0
      ),
      // enabled solo se escribe cuando está apagado → YAML limpio
      ...(f?.enabled === false ? { enabled: false } : {}),
      ...(f?.offer_choice_menu_enabled === true
        ? { offer_choice_menu_enabled: true }
        : {}),
      steps: (Array.isArray(f?.steps) ? f.steps : []).map(writeStep),
      ...(Array.isArray(f?.variants) && f.variants.length > 0
        ? {
            variants: f.variants.map((v, i) => ({
              name: str(v?.name) || `variante_${i + 2}`,
              ...(v?.enabled === false ? { enabled: false } : {}),
              steps: (Array.isArray(v?.steps) ? v.steps : []).map(writeStep),
            })),
          }
        : {}),
      // payment_menu solo se escribe si está activado → YAML limpio
      ...(f?.payment_menu?.enabled
        ? {
            payment_menu: {
              enabled: true,
              use_buttons: f.payment_menu.use_buttons === true,
              separate_bubble: f.payment_menu.separate_bubble === true,
              media_type:
                f.payment_menu.media_type === "video" ? "video" : "image",
              media_url: str(f.payment_menu.media_url),
              text: str(f.payment_menu.text).replace(/\r\n/g, "\n"),
            },
          }
        : {}),
    }));
    const node = blockNode(doc, yamlFollowups);
    if (isSeq(node)) {
      node.items.forEach((fItem, i) => {
        (fItem as { commentBefore?: string }).commentBefore =
          ` ════════════ ${yamlFollowups[i].name.toUpperCase()} ════════════ `;
        if (isMap(fItem)) {
          annotateSteps(fItem.get("steps", true), yamlFollowups[i].steps);
          const variantsNode = fItem.get("variants", true);
          if (isSeq(variantsNode)) {
            variantsNode.items.forEach((vItem, vIndex) => {
              const variant = yamlFollowups[i].variants?.[vIndex];
              (vItem as { commentBefore?: string }).commentBefore =
                ` Variante ${vIndex + 2} - ${variant?.name ?? ""}`;
              if (isMap(vItem)) {
                annotateSteps(vItem.get("steps", true), variant?.steps ?? []);
              }
            });
          }
        }
      });
    }
    doc.set("followup_sequences", node);
  }

  // followup_schedule
  if (body.schedule && typeof body.schedule === "object") {
    const s = body.schedule as Record<string, unknown>;
    const qh = (s?.quiet_hours ?? {}) as Record<string, unknown>;
    doc.set(
      "followup_schedule",
      blockNode(doc, {
        quiet_hours_enabled: s?.quiet_hours_enabled !== false,
        slots_peru: strList(s?.slots_peru),
        min_gap_hours_between: num(s?.min_gap_hours_between, 4),
        burst_delays_seconds: numList(s?.burst_delays_seconds),
        quiet_hours: {
          start: str(qh?.start),
          end: str(qh?.end),
          resume_at: str(qh?.resume_at),
        },
        followup_1_ignore_quiet_hours: s?.followup_1_ignore_quiet_hours === true,
      })
    );
  }

  // discount_after_followup (oferta)
  if (Object.prototype.hasOwnProperty.call(body, "offer") && body.offer === null) {
    doc.delete("discount_after_followup");
  } else if (body.offer && typeof body.offer === "object") {
    const o = body.offer as Record<string, unknown>;
    doc.set(
      "discount_after_followup",
      blockNode(doc, {
        sequence_index: num(o?.sequence_index, 1),
        price_soles: num(o?.price_soles, 0),
      })
    );
  }

  // Ajustes globales (números sueltos)
  if (body.globals && typeof body.globals === "object") {
    const g = body.globals as Record<string, unknown>;
    const keys = [
      "course_price_soles",
      "between_messages_delay_seconds",
      "llm_max_bubbles",
      "bot_response_delay_seconds",
      "awaiting_email_timeout_seconds",
      "post_gift_comment_auto_human_delay_minutes",
      "customer_survey_delay_minutes",
      "no_response_delay_seconds",
      "autopurge_inactive_days",
    ] as const;
    for (const k of keys) {
      if (typeof g[k] === "number" && Number.isFinite(g[k] as number)) {
        doc.set(k, g[k]);
      }
    }
    doc.set("llm_bubble_limit_enabled", g.llm_bubble_limit_enabled === true);
  }

  // Validación de pago: exigir fecha en el comprobante (toggle). setIn preserva
  // otras claves de payment_validation (ej. yape_recipient_name_starts_with).
  if (body.payment_validation && typeof body.payment_validation === "object") {
    const pv = body.payment_validation as Record<string, unknown>;
    doc.setIn(
      ["payment_validation", "require_receipt_date"],
      pv?.require_receipt_date === true
    );
    if (typeof pv?.yape_recipient_name_starts_with === "string") {
      doc.setIn(
        ["payment_validation", "yape_recipient_name_starts_with"],
        pv.yape_recipient_name_starts_with.trim()
      );
    }
  }

  // payment_responses por método (yape / bcp_transferencia / efectivo): cada
  // uno como pasos con variantes (writeStep, igual que los seguimientos).
  // setIn preserva las demás claves de payment_responses.
  if (body.payment_methods && typeof body.payment_methods === "object") {
    const pm = body.payment_methods as Record<string, unknown>;
    for (const key of ["yape", "bcp_transferencia", "efectivo"] as const) {
      if (Array.isArray(pm[key])) {
        const steps = (pm[key] as EditorStep[]).map(writeStep);
        doc.setIn(["payment_responses", key], blockNode(doc, steps));
      }
    }
  }

  // Botones en el menú de métodos de pago (toggle + texto opcional).
  // Pago directo opcional: apagado conserva el flujo actual.
  if (typeof body.direct_payment_enabled === "boolean") {
    doc.set("direct_payment_enabled", body.direct_payment_enabled);
  }
  if (Array.isArray(body.direct_payment_steps)) {
    const steps = (body.direct_payment_steps as EditorStep[]).map(writeStep);
    doc.set("direct_payment_steps", blockNode(doc, steps));
  }
  if (typeof body.direct_payment_cta === "string") {
    doc.set(
      "direct_payment_cta",
      blockNode(doc, body.direct_payment_cta.replace(/\r\n/g, "\n"))
    );
  }
  if (Array.isArray(body.direct_payment_without_choice_steps)) {
    const steps = (body.direct_payment_without_choice_steps as EditorStep[]).map(
      writeStep
    );
    doc.set("direct_payment_without_choice_steps", blockNode(doc, steps));
  }
  if (typeof body.direct_payment_without_choice_cta === "string") {
    doc.set(
      "direct_payment_without_choice_cta",
      blockNode(
        doc,
        body.direct_payment_without_choice_cta.replace(/\r\n/g, "\n")
      )
    );
  }

  if (typeof body.payment_method_buttons === "boolean") {
    doc.set("payment_method_buttons", body.payment_method_buttons);
  }
  if (typeof body.silent_mode === "boolean") {
    doc.set("silent_mode", body.silent_mode);
  }
  if (typeof body.followups_enabled === "boolean") {
    doc.set("followups_enabled", body.followups_enabled);
  }
  if (typeof body.intro_variant_rotation_enabled === "boolean") {
    doc.set(
      "intro_variant_rotation_enabled",
      body.intro_variant_rotation_enabled
    );
  }
  if (typeof body.progressive_samples_enabled === "boolean") {
    doc.set("progressive_samples_enabled", body.progressive_samples_enabled);
  }
  if (
    typeof body.progressive_samples_max_per_batch === "number" &&
    Number.isFinite(body.progressive_samples_max_per_batch)
  ) {
    doc.set(
      "progressive_samples_max_per_batch",
      Math.max(1, Math.floor(body.progressive_samples_max_per_batch))
    );
  }
  if (typeof body.progressive_samples_more_text === "string") {
    doc.set(
      "progressive_samples_more_text",
      blockNode(doc, body.progressive_samples_more_text.replace(/\r\n/g, "\n"))
    );
  }
  if (typeof body.order_bump_option_presentation_rule === "string") {
    doc.set(
      "order_bump_option_presentation_rule",
      blockNode(
        doc,
        body.order_bump_option_presentation_rule.replace(/\r\n/g, "\n")
      )
    );
  }
  if (Array.isArray(body.custom_placeholders)) {
    const placeholders = (body.custom_placeholders as Record<string, unknown>[])
      .map((item) => ({
        key: normalizePlaceholderKey(item?.key),
        value: str(item?.value).replace(/\r\n/g, "\n"),
        description: str(item?.description),
      }))
      .filter((item) => item.key && item.value);
    doc.set("custom_placeholders", blockNode(doc, placeholders));
  }
  if (typeof body.post_sale_reoffer === "boolean") {
    doc.set("post_sale_reoffer", body.post_sale_reoffer);
  }
  if (typeof body.post_gift_comment_auto_human_enabled === "boolean") {
    doc.set(
      "post_gift_comment_auto_human_enabled",
      body.post_gift_comment_auto_human_enabled
    );
  }
  // Plantillas por modalidad (formato del editor; el MOTOR no las lee — solo el
  // editor. Los campos top-level ya llevan la plantilla activa al guardar).
  if (body.modality_templates && typeof body.modality_templates === "object") {
    doc.set("modality_templates", blockNode(doc, body.modality_templates));
  }
  if (typeof body.payment_buttons_prompt === "string") {
    doc.set(
      "payment_buttons_prompt",
      blockNode(doc, body.payment_buttons_prompt.replace(/\r\n/g, "\n"))
    );
  }
  // Métodos de pago editables: label + method (slot de texto) + aliases
  // (variantes de reconocimiento). El orden se respeta. Aliases solo se escribe
  // si tiene algo → YAML limpio.
  if (Array.isArray(body.payment_buttons)) {
    const btns = (body.payment_buttons as Record<string, unknown>[])
      .map((b) => {
        const aliases = strList(b?.aliases)
          .map((a) => a.trim())
          .filter(Boolean);
        const base = {
          label: str(b?.label).trim(),
          method: str(b?.method).trim(),
        };
        return aliases.length > 0 ? { ...base, aliases } : base;
      })
      .filter((b) => b.label && b.method)
      .slice(0, 4);
    doc.set("payment_buttons", blockNode(doc, btns));
  }
  // Texto del menú de métodos (cara de texto, botones OFF).
  if (typeof body.payment_text === "string") {
    doc.set(
      "payment_text",
      blockNode(doc, body.payment_text.replace(/\r\n/g, "\n"))
    );
  }

  // course_content (contenido del curso / cómo se estudia): caja propia,
  // separada del Cerebro, inyectada al prompt.
  if (typeof body.course_content === "string") {
    doc.set(
      "course_content",
      blockNode(doc, body.course_content.replace(/\r\n/g, "\n"))
    );
  }

  // product_name (comodín {{PRODUCTO}}).
  if (typeof body.product_name === "string") {
    doc.set("product_name", body.product_name.trim());
  }

  // country (selector de país): define moneda a Meta, {{MONEDA}}, dialecto y TZ.
  if (typeof body.country === "string" && body.country.trim()) {
    doc.set("country", body.country.trim());
  }
  if (body.country_mode === "auto_phone" || body.country_mode === "fixed") {
    doc.set("country_mode", body.country_mode);
  }
  if (
    body.country_sales_enabled &&
    typeof body.country_sales_enabled === "object"
  ) {
    const enabled = Object.fromEntries(
      Object.entries(body.country_sales_enabled as Record<string, unknown>).map(
        ([country, value]) => [country, value !== false]
      )
    );
    doc.set("country_sales_enabled", blockNode(doc, enabled));
  }
  if (
    body.payment_profiles_by_country &&
    typeof body.payment_profiles_by_country === "object"
  ) {
    const profiles = Object.fromEntries(
      Object.entries(
        body.payment_profiles_by_country as Record<string, unknown>
      ).map(([country, rawProfile]) => {
        const p = (rawProfile ?? {}) as Record<string, unknown>;
        const buttons = Array.isArray(p?.payment_buttons)
          ? (p.payment_buttons as Record<string, unknown>[])
              .map((b) => ({
                label: str(b?.label).trim(),
                method: str(b?.method).trim(),
                aliases: strList(b?.aliases)
                  .map((a) => a.trim())
                  .filter(Boolean),
              }))
              .filter((b) => b.label && b.method)
          : [];
        const responses = (p?.payment_responses ?? {}) as Record<
          string,
          unknown
        >;
        const payment_responses = Object.fromEntries(
          Object.entries(responses).map(([method, steps]) => [
            method,
            Array.isArray(steps)
              ? (steps as EditorStep[]).map(writeStep)
              : [],
          ])
        );
        return [
          country,
          {
            enabled: p?.enabled !== false,
            course_price_soles: num(p?.course_price_soles, 0),
            payment_validation: {
              yape_recipient_name_starts_with: str(
                (p?.payment_validation as Record<string, unknown> | undefined)
                  ?.yape_recipient_name_starts_with
              ).trim(),
            },
            payment_text: str(p?.payment_text).replace(/\r\n/g, "\n"),
            payment_buttons: buttons,
            payment_responses,
          },
        ];
      })
    );
    doc.set("payment_profiles_by_country", blockNode(doc, profiles));
  }
  if (body.channels && typeof body.channels === "object") {
    const raw = body.channels as Record<string, unknown>;
    const writeChannel = (key: string) => {
      const channel = (raw[key] ?? {}) as Record<string, unknown>;
      const rawTemplates =
        channel?.modality_templates &&
        typeof channel.modality_templates === "object"
          ? (channel.modality_templates as Record<string, unknown>)
          : {};
      const modality_templates = Object.fromEntries(
        ["lineal", "order_bump", "bioferta", "doble_oferta_dos"].map((mode) => [
          mode,
          writeChannelContent(
            (rawTemplates[mode] ?? {}) as Record<string, unknown>
          ),
        ])
      );
      return {
        enabled: channel?.enabled === true,
        use_content: channel?.use_content === true,
        modality_templates,
      };
    };
    doc.set(
      "channels",
      blockNode(doc, {
        whatsapp: writeChannel("whatsapp"),
        messenger: writeChannel("messenger"),
        instagram: writeChannel("instagram"),
        tiktok: writeChannel("tiktok"),
      })
    );
  }

  // Galerías de imágenes/videos (producto 1 y producto 2). Helper compartido.
  if (body.salesbot && typeof body.salesbot === "object") {
    doc.set("salesbot", blockNode(doc, writeSalesbot(body.salesbot)));
  }

  const writeGallery = (key: string, arr: unknown) => {
    if (!Array.isArray(arr)) return;
    const items = (arr as Record<string, unknown>[])
      .map((g) => ({
        topic: str(g?.topic),
        keywords: strList(g?.keywords)
          .map((k) => k.trim())
          .filter(Boolean),
        when: str(g?.when).replace(/\r\n/g, "\n"),
        media_type: normalizeGalleryMediaType(g?.media_type),
        drive_url: str(g?.drive_url),
        caption: str(g?.caption).replace(/\r\n/g, "\n"),
        // enabled solo se escribe cuando está apagado → YAML limpio
        ...(g?.enabled === false ? { enabled: false } : {}),
      }))
      // descartamos filas totalmente vacías (sin tema ni enlace)
      .filter((g) => g.topic.trim() || g.drive_url.trim());
    doc.set(key, blockNode(doc, items));
  };
  writeGallery("image_gallery", body.image_gallery);
  writeGallery("image_gallery_2", body.image_gallery_2);
  writeGallery("pack_gallery", body.pack_gallery);
  writeGallery("detail_gallery", body.detail_gallery);

  // Segundo producto (Doble Oferta): contenido + nombre ({{PRODUCTO2}}).
  if (typeof body.course_content_2 === "string") {
    doc.set(
      "course_content_2",
      blockNode(doc, body.course_content_2.replace(/\r\n/g, "\n"))
    );
  }
  if (typeof body.product_name_2 === "string") {
    doc.set("product_name_2", body.product_name_2.trim());
  }

  // Info de contenido: temas de la galería que el bot envía (imágenes) cuando el
  // cliente confirma que quiere ver qué incluye cada opción. Lista de strings.
  if (Array.isArray(body.product_info_topics)) {
    const topics = (body.product_info_topics as unknown[])
      .filter((t): t is string => typeof t === "string")
      .map((t) => t.trim())
      .filter(Boolean);
    doc.set("product_info_topics", blockNode(doc, topics));
  }
  // Imagen del complemento "bajo pedido": un solo topic de la galería.
  if (typeof body.complement_info_topic === "string") {
    doc.set("complement_info_topic", body.complement_info_topic.trim());
  }
  // Mensaje editable de tranquilización ante desconfianza/estafa (+ CTA).
  if (typeof body.distrust_message === "string") {
    doc.set(
      "distrust_message",
      blockNode(doc, body.distrust_message.replace(/\r\n/g, "\n"))
    );
  }
  // Temas de la galería para las "imágenes de info adicional" (sección aparte).
  if (Array.isArray(body.extra_info_topics)) {
    const topics = (body.extra_info_topics as unknown[])
      .filter((t): t is string => typeof t === "string")
      .map((t) => t.trim())
      .filter(Boolean);
    doc.set("extra_info_topics", blockNode(doc, topics));
  }

  // country_redirect.ecuador: mensaje editable de redirección a la línea Ecuador.
  if (Array.isArray(body.country_ecuador)) {
    const steps = (body.country_ecuador as EditorStep[]).map(writeStep);
    doc.setIn(["country_redirect", "ecuador"], blockNode(doc, steps));
  }

  // Bioferta Oferta Doble: 2 productos + pack. Sección cohesiva → doc.set.
  if (body.bioferta && typeof body.bioferta === "object") {
    const b = body.bioferta as Record<string, unknown>;
    const writeProduct = (p: unknown, withDelivery: boolean) => {
      const o = (p ?? {}) as Record<string, unknown>;
      const aliases = strList(o?.aliases)
        .map((s) => s.trim())
        .filter(Boolean);
      const out: Record<string, unknown> = { name: str(o?.name) };
      if (aliases.length) out.aliases = aliases;
      if (withDelivery) {
        out.delivery = (
          Array.isArray(o?.delivery) ? (o.delivery as EditorStep[]) : []
        ).map(writeStep);
      }
      return out;
    };
    doc.set(
      "bioferta_doble",
      blockNode(doc, {
        enabled: b?.enabled === true,
        use_buttons: b?.use_buttons === true,
        pack_price_soles: num(b?.pack_price_soles, 0),
        pack_discount_price_soles: num(b?.pack_discount_price_soles, 0),
        product_a: writeProduct(b?.product_a, false),
        product_b: writeProduct(b?.product_b, true),
        pack: writeProduct(b?.pack, true),
        ask_choice_text: str(b?.ask_choice_text).replace(/\r\n/g, "\n"),
      })
    );
  }

  // Entrega "Pago Aprobado": secuencia post-pago (única fuente de verdad).
  if (Array.isArray(body.payment_approved)) {
    const steps = (body.payment_approved as EditorStep[]).map(writeStep);
    const node = blockNode(doc, steps);
    annotateSteps(node, steps);
    doc.set("payment_approved_sequence", node);
  }
  if (typeof body.customer_survey_enabled === "boolean") {
    doc.set("customer_survey_enabled", body.customer_survey_enabled);
  }
  if (typeof body.customer_survey_auto_human_enabled === "boolean") {
    doc.set(
      "customer_survey_auto_human_enabled",
      body.customer_survey_auto_human_enabled
    );
  }
  if (typeof body.customer_survey_message === "string") {
    doc.set(
      "customer_survey_message",
      blockNode(doc, body.customer_survey_message.replace(/\r\n/g, "\n"))
    );
  }

  // Saludo inicial (greeting): variantes de texto.
  if (body.greeting && typeof body.greeting === "object") {
    const g = body.greeting as Record<string, unknown>;
    const texts = (Array.isArray(g?.texts) ? g.texts : [])
      .filter((t): t is string => typeof t === "string")
      .map((t) => t.replace(/\r\n/g, "\n"));
    doc.setIn(["greeting", "text_variants"], blockNode(doc, texts));
    doc.setIn(["greeting", "skip_ask_name"], g?.skip_ask_name === true);
  }

  // Plantilla del email post-compra.
  if (body.email && typeof body.email === "object") {
    const e = body.email as Record<string, unknown>;
    const setE = (key: string, value: unknown) =>
      doc.setIn(["email_template", key], blockNode(doc, value));
    if (typeof e.from_name === "string") setE("from_name", e.from_name);
    if (typeof e.subject === "string") setE("subject", e.subject);
    if (typeof e.body === "string")
      setE("body", e.body.replace(/\r\n/g, "\n"));
  }
  if (body.email_vip && typeof body.email_vip === "object") {
    const e = body.email_vip as Record<string, unknown>;
    const setE = (key: string, value: unknown) =>
      doc.setIn(["email_template_vip", key], blockNode(doc, value));
    if (typeof e.from_name === "string") setE("from_name", e.from_name);
    if (typeof e.subject === "string") setE("subject", e.subject);
    if (typeof e.body === "string")
      setE("body", e.body.replace(/\r\n/g, "\n"));
  }

  // Order Bump: oferta intermedia (combo/básico). Sección cohesiva → doc.set.
  if (body.order_bump && typeof body.order_bump === "object") {
    const ob = body.order_bump as Record<string, unknown>;
    const writeObOption = (o: unknown) => {
      const x = (o ?? {}) as Record<string, unknown>;
      const aliases = strList(x?.aliases)
        .map((s) => s.trim())
        .filter(Boolean);
      const out: Record<string, unknown> = {
        name: str(x?.name),
        price_soles: num(x?.price_soles, 0),
        discount_price_soles: num(x?.discount_price_soles, 0),
        regalos: str(x?.regalos).replace(/\r\n/g, "\n"),
        response: (Array.isArray(x?.response)
          ? (x.response as EditorStep[])
          : []
        ).map(writeStep),
        payment_responses: Object.fromEntries(
          (["yape", "bcp_transferencia", "efectivo"] as const).map((key) => [
            key,
            (Array.isArray(
              (x?.payment_responses as Record<string, unknown> | undefined)?.[
                key
              ]
            )
              ? ((x.payment_responses as Record<string, unknown>)[
                  key
                ] as EditorStep[])
              : []
            ).map(writeStep),
          ])
        ),
        delivery: (Array.isArray(x?.delivery)
          ? (x.delivery as EditorStep[])
          : []
        ).map(writeStep),
      };
      if (aliases.length) out.aliases = aliases;
      return out;
    };
    doc.set(
      "order_bump",
      blockNode(doc, {
        enabled: ob?.enabled === true,
        use_buttons: ob?.use_buttons === true,
        intro: (Array.isArray(ob?.intro) ? (ob.intro as EditorStep[]) : []).map(
          writeStep
        ),
        choice_prompt: str(ob?.choice_prompt).replace(/\r\n/g, "\n"),
        choice_clarification: str(ob?.choice_clarification).replace(
          /\r\n/g,
          "\n"
        ),
        offer_on_reengaged_price: ob?.offer_on_reengaged_price !== false,
        offer_on_intro_first_message: ob?.offer_on_intro_first_message !== false,
        combo: writeObOption(ob?.combo),
        basico: writeObOption(ob?.basico),
      })
    );
  }

  // Doble Oferta 2 Productos: sección cohesiva → doc.set. Misma forma de opción
  // que el order bump (sin intro ni offer_on_*).
  if (body.doble_oferta_dos && typeof body.doble_oferta_dos === "object") {
    const dd = body.doble_oferta_dos as Record<string, unknown>;
    const writeDdOption = (o: unknown) => {
      const x = (o ?? {}) as Record<string, unknown>;
      const aliases = strList(x?.aliases)
        .map((s) => s.trim())
        .filter(Boolean);
      const out: Record<string, unknown> = {
        name: str(x?.name),
        price_soles: num(x?.price_soles, 0),
        discount_price_soles: num(x?.discount_price_soles, 0),
        response: (Array.isArray(x?.response)
          ? (x.response as EditorStep[])
          : []
        ).map(writeStep),
        payment_responses: Object.fromEntries(
          (["yape", "bcp_transferencia", "efectivo"] as const).map((key) => [
            key,
            (Array.isArray(
              (x?.payment_responses as Record<string, unknown> | undefined)?.[
                key
              ]
            )
              ? ((x.payment_responses as Record<string, unknown>)[
                  key
                ] as EditorStep[])
              : []
            ).map(writeStep),
          ])
        ),
        delivery: (Array.isArray(x?.delivery)
          ? (x.delivery as EditorStep[])
          : []
        ).map(writeStep),
      };
      if (aliases.length) out.aliases = aliases;
      return out;
    };
    doc.set(
      "doble_oferta_dos",
      blockNode(doc, {
        enabled: dd?.enabled === true,
        use_buttons: dd?.use_buttons === true,
        separate_bubble: dd?.separate_bubble === true,
        basico_first: dd?.basico_first === true,
        choice_prompt: str(dd?.choice_prompt).replace(/\r\n/g, "\n"),
        choice_buttons_prompt: str(dd?.choice_buttons_prompt).replace(
          /\r\n/g,
          "\n"
        ),
        choice_clarification: str(dd?.choice_clarification).replace(
          /\r\n/g,
          "\n"
        ),
        combo: writeDdOption(dd?.combo),
        basico: writeDdOption(dd?.basico),
      })
    );
  }

  // Cerebro EN CAJAS: si el editor mandó las secciones, las escribimos como
  // bloques literales (preservan saltos de línea). Cada caja se guarda tal cual
  // (incluso vacía = el usuario la vació a propósito).
  if (body.prompt_sections && typeof body.prompt_sections === "object") {
    const ps = body.prompt_sections as Record<string, unknown>;
    const obj: Record<string, unknown> = {};
    for (const d of PROMPT_SECTION_DEFS) {
      const v = ps[d.key];
      obj[d.key] = (typeof v === "string" ? v : "").replace(/\r\n/g, "\n");
    }
    doc.set("system_prompt_sections", blockNode(doc, obj));
  }

  // gift_mechanic (regalo) — solo si ya existe en el YAML; se actualizan los
  // campos en su lugar (preserva comentarios de la sección).
  if (body.gift && typeof body.gift === "object" && doc.get("gift_mechanic")) {
    const g = body.gift as Record<string, unknown>;
    const setG = (key: string, value: unknown) =>
      doc.setIn(["gift_mechanic", key], blockNode(doc, value));
    if (typeof g.consent_question === "string")
      setG("consent_question", g.consent_question.replace(/\r\n/g, "\n"));
    if (typeof g.consent_buttons_enabled === "boolean")
      setG("consent_buttons_enabled", g.consent_buttons_enabled === true);
    if (typeof g.consent_buttons_prompt === "string")
      setG("consent_buttons_prompt", g.consent_buttons_prompt.trim());
    if (Array.isArray(g.consent_buttons)) {
      const buttons = (g.consent_buttons as Record<string, unknown>[])
        .map((b) => ({
          label: str(b?.label).trim(),
          action:
            b?.action === "reject"
              ? "reject"
              : b?.action === "text"
                ? "text"
                : "accept",
        }))
        .filter((b) => b.label)
        .slice(0, 3);
      setG("consent_buttons", buttons);
    }
    if (typeof g.consent_yes_label === "string")
      setG("consent_yes_label", g.consent_yes_label.trim());
    if (typeof g.consent_no_label === "string")
      setG("consent_no_label", g.consent_no_label.trim());
    if (Array.isArray(g.consent_sequence)) {
      doc.setIn(
        ["gift_mechanic", "consent_sequence"],
        blockNode(doc, (g.consent_sequence as EditorStep[]).map(writeStep))
      );
    }
    if (typeof g.decline_message === "string")
      setG("decline_message", g.decline_message.replace(/\r\n/g, "\n"));
    if (typeof g.ask_audio_drive_url === "string")
      setG("ask_audio_drive_url", g.ask_audio_drive_url);
    if (typeof g.ask_text === "string")
      setG("ask_text", g.ask_text.replace(/\r\n/g, "\n"));
    if (Array.isArray(g.ask_sequence)) {
      doc.setIn(
        ["gift_mechanic", "ask_sequence"],
        blockNode(
          doc,
          (g.ask_sequence as EditorStep[]).map(writeStep)
        )
      );
    }
    if (typeof g.reward_message === "string")
      setG("reward_message", g.reward_message.replace(/\r\n/g, "\n"));
    if (typeof g.first_campaign === "string")
      setG("first_campaign", g.first_campaign);
    if (Array.isArray(g.variants)) {
      const variants = (g.variants as Record<string, unknown>[]).map((v) => {
        // Separador: fila puramente visual, se guarda solo como {separator}
        if (typeof v?.separator === "string") {
          return { separator: v.separator };
        }
        const ids = Array.isArray(v?.ad_ids)
          ? (v.ad_ids as unknown[]).map((x) => String(x).trim()).filter(Boolean)
          : [];
        const label = str(v?.label).trim();
        return {
          weight: num(v?.weight, 0),
          text: str(v?.text).replace(/\r\n/g, "\n"),
          // enabled/label/ad_ids solo se escriben si aportan algo → YAML limpio
          ...(v?.enabled === false ? { enabled: false } : {}),
          ...(label ? { label } : {}),
          ...(ids.length ? { ad_ids: ids } : {}),
        };
      });
      doc.setIn(["gift_mechanic", "ask_text_variants"], blockNode(doc, variants));
    }
  }

  const output = doc.toString({ lineWidth: 0 });
  try {
    parseDocument(output);
  } catch {
    return NextResponse.json(
      { error: "El resultado no sería YAML válido, no se guardó" },
      { status: 500 }
    );
  }

  try {
    fs.writeFileSync(CONFIG_PATH, output, "utf8");
  } catch {
    return NextResponse.json(
      { error: "No se pudo escribir el archivo" },
      { status: 500 }
    );
  }

  let persisted = false;
  let publishError: string | undefined;
  const tokenConfigured = isGithubPublishConfigured();
  if (tokenConfigured) {
    const r = await publishFileToGithub(
      "config/intro-data.yaml",
      output,
      "editor: actualiza flujo"
    );
    persisted = r.ok;
    publishError = r.error;
  }

  return NextResponse.json({ ok: true, tokenConfigured, persisted, publishError });
}
