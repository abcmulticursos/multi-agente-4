import fs from "node:fs";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { parse as parseYaml } from "yaml";
import {
  countryFromPhone,
  resolveCountry,
  type CountryCode,
} from "@/lib/countries";

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

# Limita respuestas del LLM a N burbujas. Si se apaga, mantiene comportamiento anterior.
llm_bubble_limit_enabled: false
llm_max_bubbles: 3

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
  | {
      type: "text";
      body?: string;
      body_variants?: string[];
      /** false = burbuja APAGADA: el bot NO la envía. */
      enabled?: boolean;
    }
  | {
      type: "audio";
      drive_url: string;
      /** false = burbuja APAGADA: el bot NO la envía. */
      enabled?: boolean;
    }
  | {
      type: "image";
      drive_url: string;
      caption?: string;
      caption_variants?: string[];
      /** false = burbuja APAGADA: el bot NO la envía. */
      enabled?: boolean;
    }
  | {
      type: "video";
      drive_url: string;
      caption?: string;
      caption_variants?: string[];
      /** false = burbuja APAGADA: el bot NO la envía. */
      enabled?: boolean;
    }
  | {
      type: "document";
      drive_url: string;
      caption?: string;
      caption_variants?: string[];
      /** false = burbuja APAGADA: el bot NO la envía. */
      enabled?: boolean;
    };

export interface IntroStep {
  type: "audio" | "image" | "video" | "document";
  drive_url: string;
  caption?: string;
  caption_variants?: string[];
  delay_after_sec: number;
  /** false = paso/burbuja APAGADA: el bot NO la envía (pero no se borra, para
   *  poder reactivarla). undefined o true = se envía. */
  enabled?: boolean;
}

/** Igual que IntroStep pero permite también pasos de tipo "text" (texto plano). */
export type SequenceStep =
  | IntroStep
  | {
      type: "text";
      body?: string;
      body_variants?: string[];
      delay_after_sec: number;
      /** false = burbuja APAGADA (no se envía, pero no se borra). */
      enabled?: boolean;
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
const lastVariantByPool = new Map<string, number>();

export function pickVariant(
  variants: string[] | undefined,
  fallback: string | undefined,
  seed?: number
): string | undefined {
  if (variants && variants.length > 0) {
    const valid = variants.filter(isValidVariant);
    if (valid.length > 0) {
      if (typeof seed === "number" && Number.isFinite(seed)) {
        return valid[Math.abs(Math.floor(seed)) % valid.length];
      }
      const poolKey = valid.join("\u0000");
      const previous = lastVariantByPool.get(poolKey);
      let index = Math.floor(Math.random() * valid.length);
      if (valid.length > 1 && index === previous) {
        // Sigue siendo un sorteo, pero excluye la variante enviada justo antes.
        index =
          (index +
            1 +
            Math.floor(Math.random() * (valid.length - 1))) %
          valid.length;
      }
      lastVariantByPool.set(poolKey, index);
      if (lastVariantByPool.size > 500) lastVariantByPool.clear();
      return valid[index];
    }
  }
  return fallback;
}

export interface FollowupSequence {
  /** Identificador legible para logs (ej. "seguimiento_1"). */
  name: string;
  /** Minutos desde el primer mensaje del cliente cuando arranca esta secuencia.
   *  Solo aplica al seguimiento 1. Los seguimientos 2 y 3 se agendan via
   *  followup_schedule (slots horarios) — para ellos este campo se ignora
   *  si esta presente. */
  delay_minutes_from_first_message?: number;
  /** Pasos de la secuencia (text / audio / image / video) con sus delays. */
  steps: SequenceStep[];
  /** false = seguimiento APAGADO: el motor no lo agenda ni lo envía.
   *  undefined o true = encendido (compatibilidad hacia atrás). */
  enabled?: boolean;
  /** Menú de pago opcional que se envía al FINAL de este seguimiento. Cada
   *  seguimiento puede tener su propia foto/video + texto. Los BOTONES (si se
   *  activan) son los compartidos (payment_buttons). 2 toggles: use_buttons
   *  (mostrar botones) y separate_bubble (botones en burbuja aparte). */
  payment_menu?: {
    enabled?: boolean;
    use_buttons?: boolean;
    separate_bubble?: boolean;
    media_type?: "image" | "video";
    media_url?: string;
    text?: string;
  };
  /** Solo Doble Oferta 2 Productos: muestra la eleccion combo/basico al final. */
  offer_choice_menu_enabled?: boolean;
  variants?: FollowupVariant[];
}

export interface FollowupVariant {
  name?: string;
  steps: SequenceStep[];
  /** false = variante apagada: no participa en el sorteo. */
  enabled?: boolean;
}

/** Configuracion global del sistema de seguimientos 2 y 3. */
export interface FollowupSchedule {
  /** true/undefined = respeta horario silencioso; false = lo ignora para tests. */
  quiet_hours_enabled?: boolean;
  /** Horas (HH:MM, hora Peru) en que pueden dispararse seg 2 y 3. */
  slots_peru: string[];
  /** Minimo de horas entre dos seguimientos consecutivos. */
  min_gap_hours_between: number;
  /** Delays (segundos) ciclicos para la cola anti-rafaga dentro de un slot. */
  burst_delays_seconds: number[];
  /** Ventana horaria silenciosa (informativa; los valores reales viven en
   *  quiet-hours.ts hardcoded — esta config se reserva para futura
   *  parametrizacion sin redeploy si hace falta). */
  quiet_hours: {
    start: string;
    end: string;
    resume_at: string;
  };
  /** SWITCH (default APAGADO): si está ENCENDIDO, el SEGUIMIENTO 1 se envía a su
   *  hora aunque caiga en horario silencioso (no se difiere a las 07:00). Solo
   *  afecta al seguimiento 1. Reversible. */
  followup_1_ignore_quiet_hours?: boolean;
}

/** Un producto dentro de la "Bioferta Oferta Doble". El `name` (y los `aliases`
 *  opcionales) sirven de PALABRA CLAVE: el cliente elige ESCRIBIENDO el nombre
 *  (no un número, para evitar el "se me fue el dedo"). `delivery` es la
 *  secuencia de entrega (su enlace). Para el producto principal se
 *  omite `delivery` → usa la `payment_approved_sequence` existente. */
export interface BiofertaProduct {
  name?: string;
  aliases?: string[];
  delivery?: SequenceStep[];
}

/** "Bioferta Oferta Doble": vende 2 productos individuales (mismo precio
 *  unitario = course_price_soles) + un PACK con los 2 a otro precio. El cliente
 *  elige escribiendo el nombre. TODO gateado por `enabled`: si está APAGADA
 *  (false/undefined) el motor la ignora por completo y el bot vende como hoy. */
export interface BiofertaDoble {
  /** false/undefined = APAGADA: el motor no inyecta prompt, no cambia la
   *  validación de precio ni el ruteo. El bot se comporta idéntico a hoy. */
  enabled?: boolean;
  /** Mostrar la elección de producto con BOTONES de WhatsApp (cuando el bot
   *  pregunta cuál compró). APAGADO por defecto. */
  use_buttons?: boolean;
  /** Precio del PACK (los 2 juntos). El unitario = course_price_soles. */
  pack_price_soles?: number;
  /** Precio promocional del pack cuando la conversación entra en oferta.
   *  0/undefined = conserva pack_price_soles. */
  pack_discount_price_soles?: number;
  /** Producto A = el principal. Se omite `delivery` → usa la
   *  payment_approved_sequence existente. Solo name/aliases para reconocerlo. */
  product_a?: BiofertaProduct;
  /** Producto B = el segundo producto (ligero). `delivery` = su entrega. */
  product_b?: BiofertaProduct;
  /** PACK = los 2 juntos, con su propio enlace de entrega (uno DISTINTO). */
  pack?: BiofertaProduct;
  /** Pregunta cuando el cliente pagó el precio UNITARIO pero aún no eligió
   *  cuál de los 2 productos quiere. Editable. */
  ask_choice_text?: string;
  ask_choice_text_variants?: string[];
}

/** Una opción del Order Bump (ej. "combo" / "básico"). El `name` (+ aliases)
 *  es la palabra clave para elegir y el título del botón. `price_soles` es el
 *  monto que el bot valida; `response` es la respuesta predefinida (método +
 *  precio) que se envía al elegir; `delivery` es lo que recibe al pagar. */
export interface OrderBumpOption {
  name?: string;
  aliases?: string[];
  price_soles?: number;
  /** Precio PROMO de esta opción: se usa cuando la convo entró en etapa de
   *  oferta (discount_active), igual que el descuento del precio individual.
   *  Si no está (0/undefined), se usa price_soles. Editable desde el panel. */
  discount_price_soles?: number;
  /** Regalos/bonos incluidos con esta opción. Es descriptivo para que el bot
   *  explique mejor; no cambia precio, pago ni entrega. */
  regalos?: string;
  response?: ResponseStep[];
  /** Respuestas enviadas DESPUÉS de que el cliente confirma el método de
   *  pago. Si un método no está configurado, usa payment_responses globales,
   *  pero siempre reemplazando {price}/{precio} con el precio de esta opción. */
  payment_responses?: {
    yape?: ResponseStep[];
    bcp_transferencia?: ResponseStep[];
    efectivo?: ResponseStep[];
    /** Métodos DINÁMICOS: cualquier id de método (payment_buttons[].method). */
    [method: string]: ResponseStep[] | undefined;
  };
  delivery?: SequenceStep[];
}

export interface CountryPaymentProfile {
  /** false = no vender a este pais. undefined/true = permitido. */
  enabled?: boolean;
  /** Precio principal para este pais. Si falta, usa course_price_soles global. */
  course_price_soles?: number;
  /** Validacion propia para comprobantes de este pais. */
  payment_validation?: {
    yape_recipient_name_starts_with?: string;
  };
  /** Texto del menu de metodos para este pais. Si falta, usa el global. */
  payment_text?: string;
  /** Botones/metodos disponibles para este pais. Si falta, usa los globales. */
  payment_buttons?: { label: string; method: string; aliases?: string[] }[];
  /** Respuestas de pago por metodo para este pais. Si falta, usa global. */
  payment_responses?: {
    yape?: ResponseStep[];
    bcp_transferencia?: ResponseStep[];
    efectivo?: ResponseStep[];
    [method: string]: ResponseStep[] | undefined;
  };
}

export interface ChannelConfig {
  enabled?: boolean;
  /** true = runtime uses this channel content as an override layer. */
  use_content?: boolean;
  modality_templates?: Partial<Record<"lineal" | "order_bump" | "bioferta" | "doble_oferta_dos", ChannelContent>>;
}

export type SalesbotEngineMode = "ai" | "salesbot_strong" | "salesbot_only";
export type SalesbotModalityKey =
  | "lineal"
  | "order_bump"
  | "bioferta"
  | "doble_oferta_dos";
export type SalesbotChannelKey =
  | "all"
  | "whatsapp"
  | "messenger"
  | "instagram"
  | "tiktok";
export type SalesbotRuleAction =
  | "send_text"
  | "send_steps"
  | "show_order_bump"
  | "choose_combo"
  | "choose_basico"
  | "resend_payment"
  | "send_payment_menu"
  | "resend_material"
  | "accept_gift"
  | "decline_gift"
  | "claim_gift"
  | "human"
  | "fallback_ai";
export type SalesbotRuleMatch = "contains_any" | "contains_all" | "regex";

export interface SalesbotRule {
  id?: string;
  name?: string;
  enabled?: boolean;
  priority?: number;
  channel?: SalesbotChannelKey;
  states?: string[];
  match?: SalesbotRuleMatch;
  keywords?: string[];
  pattern?: string;
  action?: SalesbotRuleAction;
  response?: string;
  steps?: ResponseStep[];
  next_state?: string;
  stop_after_action?: boolean;
}

export interface SalesbotRulesConfig {
  modes?: Partial<Record<SalesbotModalityKey, SalesbotEngineMode>>;
  rules?: Partial<Record<SalesbotModalityKey, SalesbotRule[]>>;
  fallback_text?: string;
}

export interface ChannelIntroGroup {
  name?: string;
  enabled?: boolean;
  weight?: number;
  adName?: string;
  adId?: string;
  steps?: SequenceStep[];
}

export interface ChannelDeliveryGroup {
  key?: string;
  name?: string;
  enabled?: boolean;
  steps?: SequenceStep[];
}

export interface ChannelContent {
  intro_groups?: ChannelIntroGroup[];
  followups?: FollowupSequence[];
  payment?: SequenceStep[];
  delivery?: SequenceStep[];
  delivery_groups?: ChannelDeliveryGroup[];
  post_sale?: {
    whatsappPreference?: string;
    deliveryUsage?: string;
    lifetimeAccess?: string;
    farewells?: string;
  };
}

/** "Bioferta Order Bumps": cuando el cliente va a pagar (elige un método),
 *  el bot intercepta con una oferta intermedia de 2 opciones (combo vs básico)
 *  antes de dar los datos de pago. APAGADA por defecto (enabled). */
export interface OrderBump {
  /** false/undefined = APAGADA: el motor la ignora por completo. */
  enabled?: boolean;
  /** Mostrar la elección con BOTONES de WhatsApp (vs texto escrito). */
  use_buttons?: boolean;
  /** Mensaje intermedio: imagen + texto con las 2 opciones detalladas. */
  intro?: SequenceStep[];
  /** Texto corto que pide elegir (acompaña los botones, o pide escribir). */
  choice_prompt?: string;
  choice_prompt_variants?: string[];
  /** Texto de aclaración cuando el cliente cambia de idea o responde ambiguo.
   *  Soporta placeholders:
   *  - {{OPCION_1}} / {{OPCION_2}} -> nombres de combo / básico
   *  - {{PRECIO_1}} / {{PRECIO_2}} -> precios efectivos de cada opción */
  choice_clarification?: string;
  /** Respuesta a una PREGUNTA DE PRECIO durante el order bump: muestra las 2
   *  opciones con sus precios e invita a elegir. EDITABLE desde el panel.
   *  Soporta {{OPCION_1}}/{{OPCION_2}} y {{precio_1}}/{{precio_2}}/{{precio_extra}}.
   *  Vacío = usa el texto por defecto del sistema. */
  price_question_response?: string;
  /** SWITCH (default ENCENDIDO): soltar la intro de order bump al cliente que
   *  volvió tras un seguimiento y PREGUNTA EL PRECIO (sin haberla visto aún).
   *  false = APAGADO: ese cliente sigue siendo atendido por el LLM con
   *  naturalidad (comportamiento previo). Solo afecta a ese caso puntual. */
  offer_on_reengaged_price?: boolean;
  /** SWITCH (default ENCENDIDO = comportamiento actual): tras la intro, el
   *  PRIMER mensaje del cliente (sea cual sea) suelta la oferta del order bump.
   *  false = APAGADO: tras la intro NO se suelta por cualquier palabra; solo
   *  cuando el cliente pregunta el PRECIO o muestra INTENCIÓN DE PAGAR (igual
   *  que ya ocurre tras el seguimiento 2). Se sigue soltando UNA sola vez (al
   *  soltarla el estado cambia y no puede repetirse). Reversible: encenderlo
   *  vuelve al comportamiento actual. */
  offer_on_intro_first_message?: boolean;
  /** Las 2 opciones. */
  combo?: OrderBumpOption;
  basico?: OrderBumpOption;
}

/** Modalidad "Doble Oferta 2 Productos": al FINAL de la intro data el cliente
 *  elige entre 2 opciones (basico/combo), cada una con su precio; al elegir se
 *  va DIRECTO al pago de esa opción. A diferencia del Order Bump, NO suelta una
 *  segunda intro — la elección se agrega al final de la intro principal, no se
 *  pregunta el nombre. APAGADA por defecto (enabled). Mutuamente excluyente con
 *  order_bump y bioferta_doble (una precedencia clara en el motor evita choques). */
export interface DobleOfertaDos {
  /** false/undefined = APAGADA: el motor la ignora por completo. */
  enabled?: boolean;
  /** Elección con BOTONES de WhatsApp (vs texto escrito). Tú decides. */
  use_buttons?: boolean;
  /** true = manda el texto principal primero y los botones en otra burbuja. */
  separate_bubble?: boolean;
  /** true = botón del BÁSICO arriba y COMBO abajo. Por defecto (false) es al
   *  revés: combo arriba, básico abajo. */
  basico_first?: boolean;
  /** Texto que se agrega al FINAL de la intro pidiendo elegir entre las 2. */
  choice_prompt?: string;
  choice_prompt_variants?: string[];
  /** Texto corto del mensaje que contiene los botones cuando separate_bubble=true. */
  choice_buttons_prompt?: string;
  /** Aclaración si el cliente responde ambiguo. Soporta {{OPCION_1}}/{{OPCION_2}}
   *  y {{precio_1}}/{{precio_2}}. */
  choice_clarification?: string;
  /** Las 2 opciones. Misma forma que el Order Bump (nombre, precio,
   *  payment_responses y delivery propios de cada una). */
  basico?: OrderBumpOption;
  combo?: OrderBumpOption;
}

/** PLANTILLA de una modalidad (perfil de producto). El editor edita la de la
 *  modalidad ACTIVA; al GUARDAR, la API copia sus campos a los top-level que el
 *  motor ya lee (así el MOTOR no cambia y la venta no se puede romper). Cada
 *  plantilla es 1-2 "hojas" según el producto. Campos ausentes = usa top-level. */
export interface ModalidadTemplate {
  /** Título para identificar de qué producto es esta plantilla (referencia). */
  title?: string;
  intro_sequence?: SequenceStep[];
  intro_sequence_2?: SequenceStep[];
  intro_sequence_3?: SequenceStep[];
  intro_extra_sequences?: SequenceStep[][];
  intro_enabled?: boolean[];
  intro_weights?: number[];
  intro_names?: string[];
  campaign_name?: string;
  intro_ad_names?: string[];
  intro_ad_ids?: string[];
  followup_sequences?: FollowupSequence[];
  course_content?: string;
  product_name?: string;
  image_gallery?: WorkflowConfig["image_gallery"];
  email_template?: WorkflowConfig["email_template"];
  email_template_vip?: WorkflowConfig["email_template_vip"];
  system_prompt_sections?: {
    postventa?: string;
  };
  gift_mechanic?: WorkflowConfig["gift_mechanic"];
}

export interface WorkflowConfig {
  /** Runtime only: true when a channel content layer was applied. */
  __channel_content_active?: boolean;
  /** Runtime only: channel whose layer was applied. */
  __channel?: RuntimeChannel;
  greeting: {
    text?: string;
    text_variants?: string[];
    /** SWITCH (default APAGADO = comportamiento actual): si está ENCENDIDO, el
     *  bot NO pregunta el nombre; lanza la intro de inmediato sobre el primer
     *  mensaje entrante. Reversible: apagarlo vuelve al saludo + espera. */
    skip_ask_name?: boolean;
  };
  no_response_delay_seconds: number;
  /** Delay (segundos) entre mensajes consecutivos del bot — pago, intro de
   *  texto, etc. Por defecto 5. Editable desde el YAML. */
  between_messages_delay_seconds?: number;
  llm_bubble_limit_enabled?: boolean;
  llm_max_bubbles?: number;
  /** Delay (segundos) que el bot "espera" antes de responder a cada
   *  mensaje entrante. Mientras espera, muestra el indicador "escribiendo…"
   *  estilo humano. 0 = respuesta instantánea. Por defecto 6. */
  bot_response_delay_seconds?: number;
  /** Tiempo de espera (segundos) tras pedir el correo. Si el cliente no
   *  manda su email en este tiempo, el bot pasa al siguiente paso (gift).
   *  Mientras tanto, si pregunta cosas, el LLM responde sin cambiar de
   *  estado — el cliente puede mandar el email cuando quiera. Por defecto 60. */
  awaiting_email_timeout_seconds?: number;
  /** Minutos de espera antes de pasar la conversación a HUMANO después de
   *  que el cliente confirma el comentario y recibe el reward del regalo. */
  post_gift_comment_auto_human_delay_minutes?: number;
  /** Texto del recordatorio de correo (post-venta): SOLO pide el correo, no
   *  reenvía el enlace del producto. Si se omite, se usa un texto por defecto. */
  email_reminder_text?: string;
  /** SELECTOR DE PAÍS (bot universal). Código ISO o nombre: "PE", "MX", "AR"…
   *  Define de una sola vez la moneda que se envía a Meta, el símbolo {{MONEDA}}
   *  en los textos, el dialecto del LLM y la zona horaria de los seguimientos.
   *  Si se omite → Perú (comportamiento actual). Ver src/lib/countries.ts. */
  country?: string;
  /** "fixed" = usa country global como hasta ahora. "auto_phone" = detecta
   *  pais por prefijo telefonico y usa el perfil de pago de ese pais. */
  country_mode?: "fixed" | "auto_phone";
  /** Interruptores de venta por pais. false = no vender a ese pais. */
  country_sales_enabled?: Partial<Record<CountryCode, boolean>>;
  /** Perfiles de precio/metodos/textos de pago por pais. */
  payment_profiles_by_country?: Partial<Record<CountryCode, CountryPaymentProfile>>;
  /** Canales adicionales. WhatsApp queda como canal base; Messenger/Instagram
   *  deben estar encendidos aqui para responder automaticamente. */
  channels?: {
    whatsapp?: ChannelConfig;
    messenger?: ChannelConfig;
    instagram?: ChannelConfig;
    tiktok?: ChannelConfig;
  };
  /** Capa editable tipo Salesbot. Por defecto no interviene: todas las
   *  modalidades quedan en "ai". */
  salesbot?: SalesbotRulesConfig;
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
  /** Validación de comprobantes de pago. */
  payment_validation?: {
    /** El nombre del receptor del pago debe empezar con esto (case-insensitive).
     *  Solo aplica a Yape/Plin — BCP no incluye nombre fiable. */
    yape_recipient_name_starts_with?: string;
    /** true = el comprobante DEBE mostrar una fecha (cualquiera; no se compara).
     *  Filtra afiches/imágenes reenviadas que muestran un monto pero no son
     *  comprobantes reales. undefined/false = no se exige fecha. */
    require_receipt_date?: boolean;
  };
  intro_sequence: SequenceStep[];
  /** Intros adicionales opcionales para repartir al azar. */
  intro_sequence_2?: SequenceStep[];
  intro_sequence_3?: SequenceStep[];
  /** Intros extra opcionales agregadas desde el editor (Intro 4+). */
  intro_extra_sequences?: SequenceStep[][];
  /** Menú de pago que se envía al FINAL del intro (foto/video + texto + botones),
   *  igual que el de los seguimientos. APAGADO por defecto. 2 toggles:
   *  use_buttons (mostrar botones) y separate_bubble (botones en burbuja aparte). */
  intro_payment_menu?: {
    enabled?: boolean;
    use_buttons?: boolean;
    separate_bubble?: boolean;
    media_type?: "image" | "video";
    media_url?: string;
    text?: string;
  };
  /** Qué intros participan en el reparto al azar (índice 0 = Intro 1, 1 = Intro
   *  2, 2 = Intro 3). El bot elige al azar entre las ACTIVAS y completas. Si
   *  ninguna está activa, usa la Intro 1 como respaldo. */
  intro_enabled?: boolean[];
  /** Peso de reparto por intro (índice 0 = Intro 1). Si falta o es <= 0,
   *  esa intro usa peso 1 para conservar el reparto parejo anterior. */
  intro_weights?: number[];
  /** Nombre visible editable por intro (índice 0 = Intro 1). Solo UI. */
  intro_names?: string[];
  /** Nombre visible de la campaña activa. Solo referencia editable. */
  campaign_name?: string;
  /** Nombre interno del anuncio por intro (índice 0 = Intro 1). Solo visual. */
  intro_ad_names?: string[];
  /** IDs de anuncio por intro (índice 0 = Intro 1). Match contra ad_source_id. */
  intro_ad_ids?: string[];
  /**
   * Secuencias de seguimiento para recuperar leads que vieron el intro
   * pero no compraron. Se cancelan al aprobarse el pago.
   *
   * Indice 0 (seguimiento 1): se programa al recibir el primer mensaje
   * del cliente, usando `delay_minutes_from_first_message`. Se envia a
   * todos, ignora quiet hours.
   *
   * Indices 1+ (seguimientos 2, 3): NO se programan al inicio. Se agendan
   * solo cuando el cliente responde DESPUES del seguimiento anterior,
   * usando los slots de `followup_schedule`.
   *
   * Si una secuencia tiene placeholders en sus steps, no se envía.
   */
  followup_sequences?: FollowupSequence[];
  /** Sistema de slots para seguimientos 2 y 3 (horarios fijos + regla 4h
   *  + cola anti-rafaga + quiet hours). Ver tipo FollowupSchedule. */
  followup_schedule?: FollowupSchedule;
  payment_responses: {
    yape?: ResponseStep[];
    bcp_transferencia?: ResponseStep[];
    /** OPCIONAL: pago en efectivo (depósito en agente, usa datos BCP pero con
     *  su propio texto). Si no está, el motor cae a bcp_transferencia. */
    efectivo?: ResponseStep[];
    /** Métodos DINÁMICOS: cualquier id de método (payment_buttons[].method). */
    [method: string]: ResponseStep[] | undefined;
  };
  /** Mensajes de redirección por país. Cada elemento = una burbuja. Los dispara
   *  el marcador <<PAIS: ...>> de la IA. Editable desde el panel. */
  /** Pago directo editable. false/undefined conserva el flujo actual. */
  direct_payment_enabled?: boolean;
  direct_payment_steps?: ResponseStep[];
  direct_payment_cta?: string;
  direct_payment_without_choice_steps?: ResponseStep[];
  direct_payment_without_choice_cta?: string;
  /** Redireccion por pais. */
  country_redirect?: {
    ecuador?: ResponseStep[];
  };
  /** "Bioferta Oferta Doble": vender 2 productos + un pack. APAGADA por
   *  defecto. Ver tipo BiofertaDoble. */
  bioferta_doble?: BiofertaDoble;
  /** "Bioferta Order Bumps": oferta intermedia (combo/básico) al ir a pagar.
   *  APAGADA por defecto. Ver tipo OrderBump. */
  order_bump?: OrderBump;
  /** Modalidad Doble Oferta 2 Productos. APAGADA por defecto. Ver DobleOfertaDos. */
  doble_oferta_dos?: DobleOfertaDos;
  /** PLANTILLAS por modalidad (perfil de producto propio de cada una). Al
   *  guardar, la plantilla de la modalidad ACTIVA se copia a los campos
   *  top-level (intro_sequence, followup_sequences, gift_mechanic, etc.) que el
   *  motor lee → el MOTOR no cambia. Ver ModalidadTemplate. */
  modality_templates?: {
    lineal?: ModalidadTemplate;
    order_bump?: ModalidadTemplate;
    bioferta?: ModalidadTemplate;
    doble_oferta_dos?: ModalidadTemplate;
  };
  /** MODO SILENCIOSO: el bot NO entabla conversación (no llama al LLM
   *  conversacional), pero SIGUE vendiendo (flujo scripted), leyendo
   *  comprobantes (una imagen sí pasa al LLM para aprobar el pago) y con los
   *  seguimientos (que tienen su propio toggle). APAGADO por defecto. */
  silent_mode?: boolean;
  /** Seguimientos globales. Si es false, NO se agenda ningún seguimiento
   *  (independiente del modo silencioso). Ausente/true = comportamiento actual. */
  followups_enabled?: boolean;
  intro_variant_rotation_enabled?: boolean;
  progressive_samples_enabled?: boolean;
  progressive_samples_max_per_batch?: number;
  progressive_samples_more_text?: string;
  order_bump_option_presentation_rule?: string;
  custom_placeholders?: {
    key?: string;
    value?: string;
    description?: string;
  }[];
  /** RE-OFRECIMIENTO post-compra. ON (ausente/true) = comportamiento actual: si
   *  el cliente da el correo sin aceptar el regalo, el bot re-ofrece el regalo; y
   *  tras el regalo vuelve a pedir el correo (recordatorio único). Si es false, el
   *  bot ofrece el regalo y pide el correo UNA sola vez, sin re-ofrecer. */
  post_sale_reoffer?: boolean;
  /** Auto-apagado post-regalo. ON = tras confirmar "comentado" y entregar el
   *  reward, la conversación pasa a modo HUMANO luego de N minutos. */
  post_gift_comment_auto_human_enabled?: boolean;
  /** Mostrar el menú de métodos de pago (Yape/Plin/BCP) con BOTONES de
   *  WhatsApp en vez de la lista escrita. APAGADO por defecto. Cuando está ON,
   *  la IA emite el marcador <<METODOS_PAGO>> y el sistema manda los botones. */
  payment_method_buttons?: boolean;
  /** Texto que acompaña a los botones de métodos de pago. Opcional. */
  payment_buttons_prompt?: string;
  /** MÉTODOS DE PAGO (bot universal). Lista editable, cantidad libre. Cada uno:
   *  `label` (lo que se ve en el botón / título), `method` (id interno → sus
   *  textos viven en payment_responses[method]) y `aliases` (variantes que el
   *  cliente puede escribir: "pichinca", "mi vecino"… para reconocerlo aunque
   *  escriba raro). El ORDEN de la lista es el orden de los botones. Si está
   *  vacío, se usan Yape/Plin/BCP por defecto (comportamiento clásico). */
  payment_buttons?: { label: string; method: string; aliases?: string[] }[];
  /** Texto del menú de métodos de pago que se envía cuando los botones están
   *  APAGADOS (la "cara de texto"). Si está vacío, usa un texto por defecto. */
  payment_text?: string;
  /** Contenido del curso y cómo se estudia (qué incluye, páginas, imprimible…).
   *  Vive en su propia caja (pestaña "Contenido"), separado del Cerebro, y se
   *  INYECTA en el prompt. Así se edita sin tocar el Cerebro. */
  course_content?: string;
  /** Nombre del producto (comodín). Donde escribas {{PRODUCTO}} en el prompt o
   *  en los mensajes, el sistema lo reemplaza por este valor. Ideal para clonar:
   *  cambias el nombre acá y se actualiza en todos lados. */
  product_name?: string;
  /** Galería de imágenes/videos/PDF/audio que el bot puede enviar según lo que pregunte
   *  el cliente (sumable desde el editor). Cada item: `topic` (clave única),
   *  `when` (cuándo usarlo, para el prompt), `drive_url`, `media_type`,
   *  `caption`. El bot emite <<MEDIA: topic>> y el sistema manda el archivo,
   *  UNA sola vez por conversación. Vacío = el bot no manda nada. */
  image_gallery?: {
    topic?: string;
    keywords?: string[];
    when?: string;
    media_type?: "image" | "video" | "document" | "audio";
    drive_url?: string;
    caption?: string;
    enabled?: boolean;
  }[];
  /** SEGUNDO PRODUCTO (Doble Oferta): su contenido, nombre ({{PRODUCTO2}}) y
   *  galería propia. El contenido se inyecta SOLO cuando la Doble Oferta está
   *  activa; la galería_2 también se gatea por eso. */
  course_content_2?: string;
  product_name_2?: string;
  image_gallery_2?: {
    topic?: string;
    keywords?: string[];
    when?: string;
    media_type?: "image" | "video" | "document" | "audio";
    drive_url?: string;
    caption?: string;
    enabled?: boolean;
  }[];
  /** Galería del PACK 2 EN 1 (su propia sección, separada del complemento para
   *  que no confunda). El bot la usa igual que las otras (la combina en
   *  getImageGallery). */
  pack_gallery?: {
    topic?: string;
    keywords?: string[];
    when?: string;
    media_type?: "image" | "video" | "document" | "audio";
    drive_url?: string;
    caption?: string;
    enabled?: boolean;
  }[];
  /** "Info de contenido": lista de `topic` de la galería que el bot envía
   *  (como imágenes con su caption del editor) cuando el cliente confirma que
   *  quiere VER qué incluye cada opción. Determinístico y editable: la imagen y
   *  el texto se controlan en la Galería; aquí solo se indica QUÉ temas mandar y
   *  en qué orden (normalmente: producto principal + pack). Vacío = función
   *  apagada (el bot responde en texto). No vive en el Cerebro. */
  product_info_topics?: string[];
  /** Imagen del complemento "bajo pedido": el `topic` de la galería que el bot
   *  envía cuando el cliente pregunta ESPECÍFICAMENTE por el complemento. Va
   *  aparte del paquete de la oferta (product_info_topics). Vacío = no blindado
   *  (el bot puede mandarla por la galería normal). No vive en el Cerebro. */
  complement_info_topic?: string;
  /** Mensaje editable que el SISTEMA envía cuando el cliente expresa
   *  desconfianza / miedo a estafa. El operador escribe las frases que
   *  tranquilizan + el cierre (CTA). El bot lo dispara con <<TRANQUILIZAR>>,
   *  así el texto y el CTA son siempre los tuyos (no se los come el modelo).
   *  Soporta saltos dobles \n\n para varias burbujas y el comodín {{PRODUCTO}}.
   *  Vacío = el bot tranquiliza con sus propias palabras (comportamiento actual). */
  distrust_message?: string;
  /** Temas de la galería que se envían como "info adicional con imágenes" cuando
   *  el cliente quiere VER el producto. Tracking propio (sección aparte): se
   *  mandan solo si las piden y no chocan con las del order bump. */
  extra_info_topics?: string[];
  /** "Info detallada para el cliente": galería PROPIA (imágenes + caption
   *  personalizable + on/off). El bot la manda SOLO cuando el cliente pide /
   *  re-pregunta por la info. NO usa la lista anti-repetición → siempre re-envía
   *  (sin el bug del "te envié y no llegó"), y nunca choca con el order bump. */
  detail_gallery?: {
    topic?: string;
    keywords?: string[];
    when?: string;
    media_type?: "image" | "video" | "document" | "audio";
    drive_url?: string;
    caption?: string;
    enabled?: boolean;
  }[];
  /** Prompt base del bot (el "cerebro"), editable desde el panel. Si está
   *  ausente o vacío, se usa el SYSTEM_PROMPT por defecto del código. Las
   *  piezas mecánicas (marcadores <<RESUMEN>>/<<PAIS>>, inyección de {{PRICE}},
   *  bloques de estado/bioferta) se AÑADEN en código aparte — no viven aquí —
   *  así no se pueden romper al editar. Soporta el comodín {{PRICE}}.
   *  LEGACY: se mantiene por compatibilidad; el editor ahora usa
   *  system_prompt_sections (cajas). */
  system_prompt?: string;
  /** Cerebro EN CAJAS (editor "Cerebro"): cada clave es una sección editable
   *  (rol_producto, idioma_pais, pago, precio_cierre, postventa, extra). El bot
   *  las junta en orden. Si está ausente, usa system_prompt o el default. */
  system_prompt_sections?: {
    rol_producto?: string;
    idioma_pais?: string;
    pago?: string;
    precio_cierre?: string;
    postventa?: string;
    extra?: string;
  };
  /** Secuencia que se dispara cuando el cliente completa el pago de S/. course_price.
   *  Puede mezclar video/imagen/audio/texto. */
  payment_approved_sequence?: SequenceStep[];
  customer_survey_enabled?: boolean;
  customer_survey_auto_human_enabled?: boolean;
  customer_survey_message?: string;
  /** Minutos desde la entrega post-pago para enviar la encuesta si el cliente
   *  no completo correo + regalo antes. */
  customer_survey_delay_minutes?: number;
  /** Plantilla del email que se envía al cliente cuando da su correo. */
  email_template?: {
    from_name: string;
    subject: string;
    body: string;
  };
  /** Plantilla independiente para la opción combo/VIP del Order Bump. */
  email_template_vip?: {
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
    /** Opcional: muestra botones Sí/No después de la pregunta de consentimiento. */
    consent_buttons_enabled?: boolean;
    consent_buttons_prompt?: string;
    consent_buttons?: {
      label?: string;
      action?: "accept" | "reject" | "text";
    }[];
    consent_yes_label?: string;
    consent_no_label?: string;
    /** Secuencia visual editable de la pregunta de consentimiento:
     *  texto/imagen/audio/video. Si tiene pasos activos, REEMPLAZA a
     *  consent_question (que queda como fallback retrocompatible). */
    consent_sequence?: SequenceStep[];
    /** Mensaje cordial cuando el cliente rechaza el regalo. */
    decline_message?: string;
    /** Drive URL del audio con la explicación del regalo. */
    ask_audio_drive_url: string;
    /** Texto que se envía después del audio, con el link al post de FB. */
    ask_text: string;
    /** Secuencia visual editable enviada al aceptar: texto/imagen/audio/video. */
    ask_sequence?: SequenceStep[];
    /** Mensaje que se envía cuando el cliente escribe "COMENTADO". */
    reward_message: string;
    /** Etiqueta del editor para el nombre de la primera campaña (grupo de
     *  arriba). Solo visual; el motor no la usa. */
    first_campaign?: string;
    /** OPCIONAL: variantes PONDERADAS del texto/enlace del post a comentar.
     *  Si se define, el bot elige UNA al azar según su `weight` (peso), para
     *  repartir los comentarios entre varios posts. Si NO se define, usa
     *  ask_text. Termina en `_variants` → puede tener placeholders sin romper. */
    ask_text_variants?: {
      text?: string;
      weight?: number;
      /** IDs de anuncio (Click-to-WhatsApp) que deben usar ESTE enlace. Si el
       *  ad_source_id del cliente está en esta lista, el bot le manda esta
       *  variante (en vez de elegir al azar). Vacío = participa solo del azar. */
      ad_ids?: string[];
      /** Etiqueta del editor para reconocer el anuncio (ej. "Advantage AD1").
       *  Solo visual; el motor no la usa. */
      label?: string;
      /** false = variante APAGADA: el motor no la usa (ni por azar ni por
       *  ad_ids). undefined o true = encendida. */
      enabled?: boolean;
      /** Separador visual del editor (rótulo de agrupación). No es un enlace;
       *  el motor lo ignora porque no tiene `text`. */
      separator?: string;
    }[];
  };
  /** AUTOPURGA: borra conversaciones SIN actividad por más de N días.
   *  Los COMPRADORES nunca se borran (su venta queda intacta en el panel).
   *  - Ausente o 0 = autopurga DESACTIVADA.
   *  - Ej. 13 = borra chats inactivos hace más de 13 días.
   *  Editable en caliente desde el YAML (no requiere redeploy una vez que el
   *  código está desplegado). El borrado es permanente. */
  autopurge_inactive_days?: number;
}

/** Default si no se especifica en el YAML. */
export const DEFAULT_BETWEEN_MESSAGES_DELAY = 5;
export const DEFAULT_CUSTOMER_SURVEY_MESSAGE =
  "Antes de irte, ¿nos dejas una sugerencia para mejorar nuestra atención? 😊\nLeemos todo para seguir mejorando.";
export const DEFAULT_ORDER_BUMP_OPTION_PRESENTATION_RULE =
  "Presenta el combo primero porque es la opcion mas completa, pero presenta la segunda opcion como una alternativa valiosa por si misma. No la llames solo, basica, inferior, reducida, incompleta ni producto principal a secas. Usa siempre su nombre configurado y al menos un dato concreto de valor tomado del contenido editable (cantidad, ejemplos, categorias, uso, formato, beneficio, audiencia, etc.), para que se vea atractiva sin igualarla al combo. Si el cliente pregunta que es o que incluye una opcion, explica contenido y diferencia; no menciones precio salvo que pregunte precio, cuanto cuesta, valor o cuanto vale.";

type RuntimeChannel = "whatsapp" | "messenger" | "instagram" | "tiktok";

const workflowChannelContext = new AsyncLocalStorage<RuntimeChannel>();

export function getActiveWorkflowChannel(): RuntimeChannel {
  return workflowChannelContext.getStore() ?? "whatsapp";
}

export function withWorkflowChannel<T>(
  channel: RuntimeChannel,
  fn: () => T
): T {
  return workflowChannelContext.run(channel, fn);
}

let cached: {
  rawConfig: WorkflowConfig;
  byChannel: Partial<Record<RuntimeChannel, WorkflowConfig>>;
  mtime: number;
} | null = null;

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

function activeModalityKey(
  config: WorkflowConfig
): "lineal" | "order_bump" | "bioferta" | "doble_oferta_dos" {
  if (config.doble_oferta_dos?.enabled) return "doble_oferta_dos";
  if (config.order_bump?.enabled) return "order_bump";
  if (config.bioferta_doble?.enabled) return "bioferta";
  return "lineal";
}

function hasSendableSteps(steps: SequenceStep[] | undefined): steps is SequenceStep[] {
  return Array.isArray(steps) && steps.some((step) => {
    if (step.enabled === false) return false;
    if (step.type === "text") {
      return (
        !!step.body?.trim() ||
        (step.body_variants ?? []).some((text) => text.trim())
      );
    }
    return (
      !!step.drive_url?.trim() ||
      !!step.caption?.trim() ||
      (step.caption_variants ?? []).some((text) => text.trim())
    );
  });
}

function deliveryGroupSteps(
  content: ChannelContent,
  key: string
): SequenceStep[] | undefined {
  return content.delivery_groups?.find(
    (group) => group.key === key && group.enabled !== false
  )?.steps;
}

function applyChannelContent(
  config: WorkflowConfig,
  channel: RuntimeChannel
): WorkflowConfig {
  const channelConfig = config.channels?.[channel];
  if (channelConfig?.use_content !== true) return config;
  const mode = activeModalityKey(config);
  const content = channelConfig.modality_templates?.[mode];
  if (!content) return config;

  const next: WorkflowConfig = {
    ...config,
    __channel_content_active: true,
    __channel: channel,
  };
  const introGroups = content.intro_groups ?? [];
  const greetingStep = introGroups[0]?.steps?.find(
    (step) => step.type === "text"
  );
  if (greetingStep?.type === "text") {
    next.greeting = {
      ...next.greeting,
      text: greetingStep.body,
      text_variants: greetingStep.body_variants,
    };
  }

  const introOnlyGroups = introGroups
    .slice(1)
    .filter((group) => group.enabled !== false && hasSendableSteps(group.steps));
  if (introOnlyGroups[0]?.steps) next.intro_sequence = introOnlyGroups[0].steps;
  if (introOnlyGroups[1]?.steps) next.intro_sequence_2 = introOnlyGroups[1].steps;
  if (introOnlyGroups[2]?.steps) next.intro_sequence_3 = introOnlyGroups[2].steps;
  next.intro_extra_sequences = introOnlyGroups.slice(3).map((group) => group.steps ?? []);
  if (introOnlyGroups.length > 0) {
    next.intro_enabled = introOnlyGroups.map((group) => group.enabled !== false);
    next.intro_weights = introOnlyGroups.map((group) =>
      typeof group.weight === "number" && Number.isFinite(group.weight) && group.weight > 0
        ? Math.floor(group.weight)
        : 1
    );
    next.intro_names = introOnlyGroups.map(
      (group, index) => group.name?.trim() || `Intro ${index + 1}`
    );
    next.intro_ad_names = introOnlyGroups.map((group) => group.adName?.trim() ?? "");
    next.intro_ad_ids = introOnlyGroups.map((group) => group.adId?.trim() ?? "");
  }

  if (Array.isArray(content.followups)) {
    next.followup_sequences = content.followups;
  }

  const centralDelivery = deliveryGroupSteps(content, "central") ?? content.delivery;
  if (hasSendableSteps(centralDelivery)) {
    next.payment_approved_sequence = centralDelivery;
  }

  if (mode === "order_bump" && next.order_bump) {
    next.order_bump = {
      ...next.order_bump,
      combo: {
        ...(next.order_bump.combo ?? {}),
        delivery:
          deliveryGroupSteps(content, "order_bump_combo") ??
          next.order_bump.combo?.delivery,
      },
      basico: {
        ...(next.order_bump.basico ?? {}),
        delivery:
          deliveryGroupSteps(content, "order_bump_basico") ??
          next.order_bump.basico?.delivery,
      },
    };
  } else if (mode === "doble_oferta_dos" && next.doble_oferta_dos) {
    next.doble_oferta_dos = {
      ...next.doble_oferta_dos,
      combo: {
        ...(next.doble_oferta_dos.combo ?? {}),
        delivery:
          deliveryGroupSteps(content, "doble_oferta_dos_combo") ??
          next.doble_oferta_dos.combo?.delivery,
      },
      basico: {
        ...(next.doble_oferta_dos.basico ?? {}),
        delivery:
          deliveryGroupSteps(content, "doble_oferta_dos_basico") ??
          next.doble_oferta_dos.basico?.delivery,
      },
    };
  } else if (mode === "bioferta" && next.bioferta_doble) {
    next.payment_approved_sequence =
      deliveryGroupSteps(content, "bioferta_product_a") ??
      next.payment_approved_sequence;
    next.bioferta_doble = {
      ...next.bioferta_doble,
      product_b: {
        ...(next.bioferta_doble.product_b ?? {}),
        delivery:
          deliveryGroupSteps(content, "bioferta_product_b") ??
          next.bioferta_doble.product_b?.delivery,
      },
      pack: {
        ...(next.bioferta_doble.pack ?? {}),
        delivery:
          deliveryGroupSteps(content, "bioferta_pack") ??
          next.bioferta_doble.pack?.delivery,
      },
    };
  }

  return next;
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
  const channel = getActiveWorkflowChannel();

  let mtime = 0;
  try {
    mtime = fs.statSync(filePath).mtimeMs;
  } catch {
    return null;
  }
  if (
    cached &&
    cached.mtime === mtime &&
    Object.prototype.hasOwnProperty.call(cached.byChannel, channel)
  ) {
    return cached.byChannel[channel] ?? null;
  }
  const config =
    cached && cached.mtime === mtime ? cached.rawConfig : readConfigFromDisk().config;
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
  const runtimeConfig = applyChannelContent(config, channel);
  cached =
    cached && cached.mtime === mtime
      ? {
          ...cached,
          byChannel: { ...cached.byChannel, [channel]: runtimeConfig },
        }
      : { rawConfig: config, byChannel: { [channel]: runtimeConfig }, mtime };
  return runtimeConfig;
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

export function isChannelEnabled(
  channel: "whatsapp" | "messenger" | "instagram" | "tiktok",
  config = loadWorkflowConfig()
): boolean {
  if (channel === "whatsapp") return true;
  return config?.channels?.[channel]?.enabled === true;
}

export function getEffectiveCountryCode(
  phone?: string | null,
  config = loadWorkflowConfig()
): CountryCode {
  if (config?.country_mode === "auto_phone") {
    const detected = countryFromPhone(phone);
    if (detected) return detected;
  }
  return resolveCountry(config?.country);
}

export function isCountrySalesEnabled(
  country: CountryCode,
  config = loadWorkflowConfig()
): boolean {
  const profileEnabled = config?.payment_profiles_by_country?.[country]?.enabled;
  if (profileEnabled === false) return false;
  const enabled = config?.country_sales_enabled?.[country];
  return enabled !== false;
}

export function getCountryPaymentProfile(
  country: CountryCode,
  config = loadWorkflowConfig()
): CountryPaymentProfile | undefined {
  return config?.payment_profiles_by_country?.[country];
}

/**
 * Devuelve el precio efectivo en soles para una conversación según su
 * estado de descuento. Single source of truth — la usa tanto la validación
 * de pagos como el system prompt que ve el LLM.
 */
export function getEffectivePriceSoles(
  discountActive: boolean,
  phone?: string | null
): number {
  const config = loadWorkflowConfig();
  const country = getEffectiveCountryCode(phone, config);
  const countryPrice =
    config?.payment_profiles_by_country?.[country]?.course_price_soles;
  const fullPrice =
    typeof countryPrice === "number" && Number.isFinite(countryPrice)
      ? countryPrice
      : config?.course_price_soles ?? 10;
  if (!discountActive) return fullPrice;
  return config?.discount_after_followup?.price_soles ?? fullPrice;
}

export function isDiscountActiveForConversation(
  convo:
    | {
        discount_active?: number | boolean | null;
        last_followup_index?: number | null;
      }
    | null
    | undefined,
  config?: WorkflowConfig | null
): boolean {
  if (!convo) return false;
  if (!!convo.discount_active) return true;
  const cfg = config ?? loadWorkflowConfig();
  const trigger = cfg?.discount_after_followup?.sequence_index;
  if (typeof trigger !== "number" || trigger <= 0) return false;
  const lastSent = convo.last_followup_index ?? -1;
  return lastSent + 1 >= trigger;
}

/** ¿Está activa la Bioferta Oferta Doble? Único punto de verdad para gatear
 *  TODO lo de la bioferta (prompt, validación, ruteo). */
export function isBiofertaActive(): boolean {
  // EXCLUSIVIDAD: solo UNA modalidad de oferta activa a la vez. Precedencia:
  // doble_oferta_dos > order_bump > bioferta_doble. Si una de mayor precedencia
  // está encendida, esta NO cuenta (aunque su flag quede en true por error) → el
  // motor entero (elección, entrega, precios) ve UNA sola modalidad.
  const cfg = loadWorkflowConfig();
  return (
    !!cfg?.bioferta_doble?.enabled &&
    !cfg?.order_bump?.enabled &&
    !cfg?.doble_oferta_dos?.enabled
  );
}

/** Precio del pack (los 2 juntos) en soles, o null si la bioferta está apagada
 *  o el precio no es válido. */
export function getBiofertaPackPriceSoles(
  discountActive = false
): number | null {
  const bf = loadWorkflowConfig()?.bioferta_doble;
  if (!bf?.enabled) return null;
  const promo = bf.pack_discount_price_soles;
  if (discountActive && typeof promo === "number" && promo > 0) return promo;
  const p = bf.pack_price_soles;
  return typeof p === "number" && p > 0 ? p : null;
}

/** Precio efectivo de la opción elegida en Doble Oferta. Los productos A/B
 * comparten el precio individual; el pack tiene precio normal/promocional. */
export function getBiofertaPriceSoles(
  choice: "a" | "b" | "pack",
  discountActive: boolean,
  phone?: string | null
): number | null {
  return choice === "pack"
    ? getBiofertaPackPriceSoles(discountActive)
    : getEffectivePriceSoles(discountActive, phone);
}

/** Reconoce qué producto eligió el cliente escribiendo su NOMBRE (o un alias).
 *  Devuelve 'a' | 'b' | 'pack' | null. Case-insensitive, por inclusión de
 *  palabra. Solo matchea si la bioferta está activa. Ignora claves placeholder
 *  o demasiado cortas (para no dar falsos positivos). */
export function detectBiofertaChoice(
  msg: string,
  config: WorkflowConfig | null
): "a" | "b" | "pack" | null {
  const bf = config?.bioferta_doble;
  if (!bf?.enabled) return null;
  const lower = msg.toLowerCase();
  const matches = (p?: BiofertaProduct): boolean => {
    if (!p) return false;
    const keys = [p.name, ...(p.aliases ?? [])]
      .map((k) => (k ?? "").trim().toLowerCase())
      .filter((k) => k.length >= 3 && !(k.includes("<<") && k.includes(">>")));
    return keys.some((k) => lower.includes(k));
  };
  // Pack PRIMERO: su nombre puede contener el de un producto ("pack producto…").
  if (matches(bf.pack)) return "pack";
  if (matches(bf.product_b)) return "b";
  if (matches(bf.product_a)) return "a";
  // Expresiones universales de la mecánica (independientes del producto).
  const normalized = lower
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "");
  if (/\b(ambos|los\s+dos|los\s+2|dos\s+productos|2\s+productos)\b/.test(normalized))
    return "pack";
  if (/\b(producto|opcion)\s*(?:numero\s*)?2\b/.test(normalized)) return "b";
  if (/\b(producto|opcion)\s*(?:numero\s*)?1\b/.test(normalized)) return "a";
  return null;
}

/** ¿Está activo el Order Bump? Único punto de verdad para gatearlo todo. */
export function isOrderBumpActive(): boolean {
  // EXCLUSIVIDAD: si Doble Oferta 2 Prod está activa, order bump NO cuenta
  // (precedencia doble_oferta_dos > order_bump). Evita que la entrega/elección se
  // mezclen entre modalidades.
  const cfg = loadWorkflowConfig();
  return !!cfg?.order_bump?.enabled && !cfg?.doble_oferta_dos?.enabled;
}

/** Doble Oferta 2 Productos activa. Mutuamente excluyente con order_bump y
 *  bioferta_doble; si varias estuvieran encendidas, order_bump tiene precedencia
 *  (ver getActiveTwoTierOffer). */
export function isDobleOfertaActive(): boolean {
  return !!loadWorkflowConfig()?.doble_oferta_dos?.enabled;
}

/** Devuelve la sección de la modalidad de 2 opciones ACTIVA (order_bump o
 *  doble_oferta_dos) — ambas comparten la forma combo/basico. order_bump tiene
 *  precedencia. null si ninguna está activa. Es la fuente única para precio,
 *  detección y ruteo de pago de las 2 opciones. */
export function getActiveTwoTierOffer(
  config?: WorkflowConfig | null
): OrderBump | DobleOfertaDos | null {
  const cfg = config ?? loadWorkflowConfig();
  // Precedencia doble_oferta_dos > order_bump (consistente con is...Active), para
  // que la ENTREGA use la MISMA modalidad que la ELECCIÓN — antes order_bump tenía
  // precedencia y, si quedaba encendido, entregaba lo suyo (grafismo) en doble oferta.
  if (cfg?.doble_oferta_dos?.enabled) return cfg.doble_oferta_dos;
  if (cfg?.order_bump?.enabled) return cfg.order_bump;
  return null;
}

/** Reconoce qué opción del order bump eligió el cliente (combo/básico) por
 *  nombre/alias (sirve tanto si escribe como si toca un botón, porque el
 *  título del botón ES el nombre). Solo matchea si el order bump está activo. */
export function detectOrderBumpChoice(
  msg: string,
  config: WorkflowConfig | null
): "combo" | "basico" | null {
  // Modalidad de 2 opciones activa (order bump O doble oferta 2 productos).
  const ob = getActiveTwoTierOffer(config);
  if (!ob) return null;
  const normalized = msg
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  if (isOrderBumpConversationQuestion(msg)) return null;
  const normalizeChoiceText = (value: string): string =>
    value
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Mn}/gu, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, " ");
  const optionKeys = (o?: OrderBumpOption): string[] =>
    o
      ? [o.name, ...(o.aliases ?? [])]
          .map((key) => normalizeChoiceText(key ?? ""))
          .filter(
            (key) =>
              key.length >= 1 && !(key.includes("<<") && key.includes(">>"))
          )
      : [];
  const matches = (o?: OrderBumpOption): boolean => {
    const keys = optionKeys(o).filter((key) => key.length >= 3);
    return keys.some((k) => normalized.includes(k));
  };

  const comboKeys = optionKeys(ob.combo);
  const basicoKeys = optionKeys(ob.basico);

  // "1"/"2" siguen los numeros visibles configurados en los nombres. Si el
  // editor no incluye numeros, conservamos el orden mostrado: combo y basico.
  if (/^\d+$/.test(normalized)) {
    const comboHasNumber = comboKeys.some((key) =>
      key.split(" ").includes(normalized)
    );
    const basicoHasNumber = basicoKeys.some((key) =>
      key.split(" ").includes(normalized)
    );
    if (comboHasNumber !== basicoHasNumber)
      return comboHasNumber ? "combo" : "basico";
    if (normalized === "1") return "combo";
    if (normalized === "2") return "basico";
  }

  // Permite responder con una parte distintiva del nombre (p. ej. una sola
  // palabra), sin hardcodear productos. Las palabras comunes no deciden.
  const ignoredTokens = new Set([
    "curso",
    "producto",
    "opcion",
    "quiero",
    "deseo",
    "cuesta",
    "precio",
    "para",
    "este",
    "esta",
    // Palabras COMUNES o COMPARTIDAS que NO deben decidir una elección por sí
    // solas (aparecen en preguntas/comentarios y/o en los nombres de ambas
    // opciones). Evita falsos positivos como "es un solo pago" → básico.
    "solo",
    "sola",
    "pack",
    "kit",
    "kits",
    "pago",
    "pagos",
    "pagar",
    "soles",
    "digital",
    "material",
    "materiales",
    "fisico",
    "fisica",
    "casa",
    "envio",
    "llega",
    "unico",
    "unica",
    "acceso",
    "vida",
  ]);
  const msgTokens = normalized
    .split(" ")
    .filter((token) => token.length >= 4 && !ignoredTokens.has(token));
  const keyTokens = (keys: string[]): Set<string> =>
    new Set(
      keys
        .flatMap((key) => key.split(" "))
        .filter((token) => token.length >= 4 && !ignoredTokens.has(token))
    );
  const comboTokens = keyTokens(comboKeys);
  const basicoTokens = keyTokens(basicoKeys);
  const comboScore = msgTokens.filter(
    (token) => comboTokens.has(token) && !basicoTokens.has(token)
  ).length;
  const basicoScore = msgTokens.filter(
    (token) => basicoTokens.has(token) && !comboTokens.has(token)
  ).length;
  if (comboScore !== basicoScore)
    return comboScore > basicoScore ? "combo" : "basico";

  const comboHints = [
    "vip",
    "premium",
    "completo",
    "los dos",
    "ambos",
    "dos juntos",
    "2 en 1",
    "todo",
    "todos",
    "todo junto",
    "full",
    "super pack",
  ];
  const basicoHints = [
    "basico",
    "basic",
    "individual",
    "simple",
    "uno solo",
    "solo uno",
    "uno de ellos",
    "solo uno de ellos",
    "sin plus",
    "sin extra",
  ];
  const hasPhrase = (phrases: string[]): boolean =>
    phrases.some((phrase) =>
      normalized.includes(
        phrase
          .normalize("NFD")
          .replace(/\p{Mn}/gu, "")
          .replace(/[^a-z0-9]+/g, " ")
          .trim()
          .replace(/\s+/g, " ")
      )
    );
  const hasChoiceIntent =
    /\b(quiero|deseo|dame|deme|me llevo|llevo|elijo|escojo|voy con|me quedo con|quiero pagar|voy a pagar|pago|procedo|mandame|enviame|pasame|paso con|vamos con)\b/.test(
      normalized
    );
  const isShortChoiceReply =
    normalized.split(" ").length <= 4 &&
    /\b(todo|todos|ambos|los dos|los 2|completo|full|vip|premium)\b/.test(
      normalized
    );
  const canUseRelativeChoiceHints = hasChoiceIntent || isShortChoiceReply;
  const choiceByPrice = (which: "cheaper" | "dearer"): "combo" | "basico" => {
    const comboPrice = ob.combo?.price_soles;
    const basicoPrice = ob.basico?.price_soles;
    if (typeof comboPrice === "number" && typeof basicoPrice === "number") {
      const comboIsCheaper = comboPrice < basicoPrice;
      if (which === "cheaper") return comboIsCheaper ? "combo" : "basico";
      return comboIsCheaper ? "basico" : "combo";
    }
    return which === "cheaper" ? "basico" : "combo";
  };

  if (matches(ob.combo)) return "combo";
  if (canUseRelativeChoiceHints && hasPhrase(comboHints))
    return choiceByPrice("dearer");
  if (matches(ob.basico)) return "basico";
  if (canUseRelativeChoiceHints && hasPhrase(basicoHints))
    return choiceByPrice("cheaper");

  // TÉRMINOS RELATIVOS DE PRECIO: el cliente no nombra el producto sino su
  // POSICIÓN de precio ("el barato", "el más económico", "el caro"…). Es el
  // caso típico del downgrade: tras elegir el caro pide "quiero el barato".
  // Se resuelve contra los precios CONFIGURADOS (no se hardcodea nada del
  // producto), así el agente sirve de plantilla para cualquier producto.
  const cheaperHints = ["barato", "economic", "el de menos", "menos plata"];
  const dearerHints = ["mas caro", "el caro", "lo caro", "el costoso", "costoso"];
  const wantsCheaper = canUseRelativeChoiceHints && hasPhrase(cheaperHints);
  const wantsDearer = canUseRelativeChoiceHints && hasPhrase(dearerHints);
  if (wantsCheaper !== wantsDearer) {
    return wantsCheaper ? choiceByPrice("cheaper") : choiceByPrice("dearer");
  }

  // ELECCIÓN POR CIFRA DE PRECIO: el cliente nombra el MONTO en vez del nombre
  // ("el de 15", "quiero el de 10"). Se mapea al producto cuyo precio CONFIGURADO
  // coincide. Prioriza el price_soles (el que se muestra en la oferta); si no
  // calza, prueba el precio promocional. Solo decide si la cifra identifica a
  // UNA sola opción (si es ambigua, no decide y deja que el resto resuelva).
  const priceTokens = normalized.match(/\d+/g) ?? [];
  if (priceTokens.length > 0) {
    const nums = new Set(priceTokens.map((n) => parseInt(n, 10)));
    const matchByPrice = (
      pick: (o?: OrderBumpOption) => number | undefined
    ): "combo" | "basico" | null => {
      const comboHit = nums.has(pick(ob.combo) ?? NaN);
      const basicoHit = nums.has(pick(ob.basico) ?? NaN);
      if (comboHit !== basicoHit) return comboHit ? "combo" : "basico";
      return null;
    };
    const byRegular = matchByPrice((o) => o?.price_soles);
    if (byRegular) return byRegular;
    const byPromo = matchByPrice((o) => o?.discount_price_soles);
    if (byPromo) return byPromo;
  }

  return null;
}

/** Preguntas espontaneas que deben responderse antes de insistir con elegir. */
export function isProductInformationQuestion(msg: string): boolean {
  const normalized = msg
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (
    /\b(cual|cuál)\s+(es|seria|sería|trae|incluye|contiene)\b/.test(
      normalized
    )
  ) {
    return true;
  }
  return (
    // Pregunta por el contenido, incluso con typos en "qué" (qu3, ke, k).
    /\b(que|q|qu3|ke|k)\s+(trae|traes|incluye|contiene|tiene|es)\b/.test(
      normalized
    ) ||
    // El verbo de contenido por sí solo ("...trae el básico?", "incluye todo?")
    // ya indica que preguntan qué contiene — la intención de compra explícita
    // ("quiero") la descarta antes en isOrderBumpConversationQuestion.
    /\b(trae|traes|incluye|incluyen|contiene|contienen)\b/.test(normalized) ||
    /\b(de que trata|como es|informacion|contenido|caracteristicas|diferencia)\b/.test(
      normalized
    ) ||
    /\b(el otro|la otra|producto adicional|producto complementario|segundo producto)\b/.test(
      normalized
    )
  );
}

/** ¿El cliente está preguntando el PRECIO? (precio, cuánto, cuesta, vale…). */
export function isPriceQuestion(msg: string): boolean {
  const normalized = msg
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return (
    /\b(precio|precios|cuesta|cuestan|vale|valen|valor)\b/.test(normalized) ||
    /\bcuanto\b/.test(normalized) ||
    /\ba\s+como\b/.test(normalized)
  );
}

/** Selección inequívoca desde botón, nombre, alias, número o una respuesta
 * breve basada en un término distintivo de los nombres configurados. */
export function detectExactOrderBumpChoice(
  msg: string,
  config: WorkflowConfig | null
): "combo" | "basico" | null {
  const ob = getActiveTwoTierOffer(config);
  if (!ob) return null;
  const dobleOfertaDos = !!config?.doble_oferta_dos?.enabled;
  const normalize = (value: string): string =>
    value
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Mn}/gu, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, " ");
  const normalized = normalize(msg);
  const keys = (option?: OrderBumpOption): string[] =>
    option
      ? [option.name, ...(option.aliases ?? [])]
          .map((key) => normalize(key ?? ""))
          .filter(Boolean)
      : [];
  const comboKeys = keys(ob.combo);
  const basicoKeys = keys(ob.basico);
  const comboNumberKeys = ["1", "producto 1", "opcion 1", "opcion uno"];
  const basicoNumberKeys = ["2", "producto 2", "opcion 2", "opcion dos"];
  if (dobleOfertaDos) {
    if (comboNumberKeys.includes(normalized)) return "combo";
    if (basicoNumberKeys.includes(normalized)) return "basico";
  }
  if (comboKeys.includes(normalized) !== basicoKeys.includes(normalized)) {
    return comboKeys.includes(normalized) ? "combo" : "basico";
  }

  // El botón/prompt suele mostrar "Nombre - precio" y el cliente responde eso
  // (p. ej. "El Kit básico - s/.3"). Si el mensaje EMPIEZA con el nombre COMPLETO
  // de UNA sola opción, decide igual (ignora el precio pegado al final).
  const startsWithKey = (optionKeys: string[]): boolean =>
    optionKeys.some((key) => key.length >= 3 && normalized.startsWith(key));
  const comboStarts = startsWithKey(comboKeys);
  const basicoStarts = startsWithKey(basicoKeys);
  if (comboStarts !== basicoStarts) return comboStarts ? "combo" : "basico";

  // Respuestas naturales muy breves como "el pack" o "el individual".
  // Los términos salen de la configuración; no hay nombres de producto fijos.
  // Si quedan palabras de pregunta ("qué trae el pack"), no decide nada.
  const neutralTokens = new Set([
    "el",
    "la",
    "los",
    "las",
    "de",
    "del",
    "me",
    "quedo",
    "con",
    "quiero",
    "prefiero",
    "elijo",
    "escojo",
    "dame",
    "por",
    "favor",
  ]);
  // Palabras GENÉRICAS del español/comercio que pueden estar DENTRO de un alias
  // de varias palabras (ej. "curso individual", "solo el producto") pero que NO
  // deben decidir una elección por sí solas: son demasiado comunes y el cliente
  // las usa en cualquier frase. NO son nombres de producto — el matcher sigue
  // 100% agnóstico (los nombres reales viven en el editor). Las palabras
  // DISTINTIVAS (pack, nombres/aliases configurados, etc.) y las frases completas siguen decidiendo.
  const genericTokens = new Set([
    "solo",
    "sola",
    "curso",
    "cursos",
    "producto",
    "productos",
    "opcion",
    "opciones",
    "material",
    "materiales",
  ]);
  const decisiveTokens = normalized
    .split(" ")
    .filter(
      (token) =>
        token && !neutralTokens.has(token) && !genericTokens.has(token)
    );
  if (decisiveTokens.length === 1) {
    const token = decisiveTokens[0];
    const optionTokens = (keysToScan: string[]): Set<string> =>
      new Set(keysToScan.flatMap((key) => key.split(" ")).filter(Boolean));
    const comboHas = optionTokens(comboKeys).has(token);
    const basicoHas = optionTokens(basicoKeys).has(token);
    if (comboHas !== basicoHas) return comboHas ? "combo" : "basico";
  }
  if (/^\d+$/.test(normalized)) {
    const comboHas = comboKeys.some((key) => key.split(" ").includes(normalized));
    const basicoHas = basicoKeys.some((key) => key.split(" ").includes(normalized));
    if (comboHas !== basicoHas) return comboHas ? "combo" : "basico";
    if (normalized === "1") return "combo";
    if (normalized === "2") return "basico";
  }
  if (dobleOfertaDos) {
    // Elección por ORDINAL, SOLO cuando es indicación CLARA: el ordinal como
    // todo el mensaje ("el segundo", "quiero el primero") o con indicador
    // explícito ("opcion 2", "producto 1"). NUNCA un número suelto dentro de una
    // frase ("a eran 2", "son 2 productos", "tengo 2") — eso disparaba el pago.
    const ordinalPick = (alts: string): boolean =>
      new RegExp(
        `^(el |la |lo |quiero (el|la|lo) |dame (el|la|lo) )?(${alts})$`
      ).test(normalized) ||
      new RegExp(`\\b(opcion|producto|numero)\\s+(${alts})\\b`).test(normalized);
    if (ordinalPick("primero|primera|uno|1")) return "combo";
    if (ordinalPick("segundo|segunda|dos|2")) return "basico";
  }
  return null;
}

/** Detección contextual de combo/básico para frases naturales como
 *  "quiero el de precio bajo" o "me paso al completo". */
export function inferTwoTierChoiceFromContext(
  msg: string,
  currentChoice: string | null | undefined,
  config: WorkflowConfig | null
): "combo" | "basico" | null {
  // Una PREGUNTA por el contenido no cambia ni fija la elección (aunque nombre
  // el producto) → la maneja el LLM.
  if (isOrderBumpConversationQuestion(msg)) return null;
  const exactChoice = detectExactOrderBumpChoice(msg, config);
  if (exactChoice) return exactChoice;

  if (currentChoice !== "combo" && currentChoice !== "basico") return null;

  const normalized = msg
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");

  const ob = getActiveTwoTierOffer(config);
  const priceTokens = normalized.match(/\d+/g) ?? [];
  if (ob && priceTokens.length > 0) {
    const nums = new Set(priceTokens.map((n) => parseInt(n, 10)));
    const matchesPrice = (
      option: OrderBumpOption | undefined,
      pick: (o: OrderBumpOption) => number | undefined
    ): boolean => {
      if (!option) return false;
      const price = pick(option);
      return typeof price === "number" && nums.has(Math.trunc(price));
    };
    const regularCombo = matchesPrice(ob.combo, (o) => o.price_soles);
    const regularBasico = matchesPrice(ob.basico, (o) => o.price_soles);
    if (regularCombo !== regularBasico)
      return regularCombo ? "combo" : "basico";
    const promoCombo = matchesPrice(ob.combo, (o) => o.discount_price_soles);
    const promoBasico = matchesPrice(ob.basico, (o) => o.discount_price_soles);
    if (promoCombo !== promoBasico) return promoCombo ? "combo" : "basico";
  }

  const wantsOther = /\b(el\s+)?otro(s)?\b|\bla\s+otra\b/.test(normalized);
  const wantsCheaper =
    /\b(basico|barato|economico|comodo|accesible|menor|menos|simple)\b/.test(
      normalized
    ) ||
    /\b(precio|cuesta|vale|costo|pago)\s+(mas\s+)?(bajo|barato|economico|comodo|accesible|menor)\b/.test(
      normalized
    ) ||
    /\b(mas|el)\s+(barato|economico|comodo|accesible|bajo)\b/.test(
      normalized
    );
  const wantsCombo =
    /\b(combo|completo|pack|premium|vip|mayor)\b/.test(normalized) ||
    /\b(precio|cuesta|vale|costo|pago)\s+(mas\s+)?(alto|caro|completo|mayor)\b/.test(
      normalized
    ) ||
    /\b(mas|el)\s+(caro|completo|alto|mayor)\b/.test(normalized);

  if (wantsCheaper) return "basico";
  if (wantsCombo) return "combo";
  if (wantsOther) return currentChoice === "combo" ? "basico" : "combo";

  return null;
}

/** Detección de elección para los estados donde el bot ACABA de preguntar
 *  "¿cuál prefieres?" (order bump / doble oferta 2 productos). Reconoce la
 *  elección aunque venga dentro de una frase con las palabras que el bot mostró
 *  ("ok quiero el de 9 el completo", "el combo", "el básico", "el barato"),
 *  combinando tres señales: (1) el nombre/tokens exactos de la opción, (2) el
 *  NÚMERO del precio ("el de 9" → 9 == 9.9), y (3) la palabra semántica
 *  (combo/completo/pack = opción mayor; básico/barato = opción menor). Devuelve
 *  null en PREGUNTAS o mensajes ambiguos → lo lleva el LLM. 100% agnóstico al
 *  producto: los precios y nombres salen de la config, no hay texto fijo. */
export function detectTwoTierPick(
  msg: string,
  config: WorkflowConfig | null
): "combo" | "basico" | null {
  // 0) Una PREGUNTA por el contenido ("¿qué trae el básico?", "qu3 trae el
  //    basico") NO es una elección aunque nombre el producto → la maneja el LLM.
  //    Va PRIMERO: si corre después, el nombre dentro de la pregunta disparaba
  //    el pago.
  if (isOrderBumpConversationQuestion(msg)) return null;
  // 1) Nombre/alias/tokens exactos de la opción.
  const exact = detectExactOrderBumpChoice(msg, config);
  if (exact) return exact;
  const ob = getActiveTwoTierOffer(config);
  if (!ob) return null;
  const normalized = msg
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  // 2) Coincidencia por PRECIO ("el de 9" → 9 == trunc(9.9)). Acepta el número
  //    en DÍGITO ("el de 3") y ESCRITO ("el de tres"), y cubre precio normal y
  //    de promoción; los precios salen de la config de cada opción.
  const numberWords: Record<string, number> = {
    uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7,
    ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, trece: 13,
    catorce: 14, quince: 15, dieciseis: 16, veinte: 20,
  };
  const digitNums = (normalized.match(/\d+/g) ?? []).map((n) => parseInt(n, 10));
  const wordNums = normalized
    .split(" ")
    .map((w) => numberWords[w])
    .filter((n): n is number => typeof n === "number");
  const nums = new Set<number>([...digitNums, ...wordNums]);
  // El número solo cuenta como ELECCIÓN por precio si NO es un número de
  // cantidad/existencia ("son 3 soles?", "a eran 2", "tengo 2", "hay 2"): ahí el
  // número describe otra cosa, no la opción elegida → habría disparado el pago.
  const numberIsQuantity =
    /\b(son|eran|hay|habia|habian|tengo|tienes|cuantos|cuantas)\b/.test(
      normalized
    );
  if (nums.size > 0 && !numberIsQuantity) {
    const hitsPrice = (option?: OrderBumpOption): boolean => {
      if (!option) return false;
      for (const price of [option.price_soles, option.discount_price_soles])
        if (typeof price === "number" && nums.has(Math.trunc(price)))
          return true;
      return false;
    };
    const comboPrice = hitsPrice(ob.combo);
    const basicoPrice = hitsPrice(ob.basico);
    if (comboPrice !== basicoPrice) return comboPrice ? "combo" : "basico";
  }
  // 3) Palabras SEMÁNTICAS que el bot usa al ofrecer las 2 opciones: la mayor
  //    (combo/completo/pack/premium) vs la menor (básico/barato/económico), CON
  //    TOLERANCIA A 1 ERROR DE TIPEO en las palabras largas y distintivas, para
  //    que un comprador humano que escribe "compelto", "basiko", "complet"...
  //    igual elija y reciba sus datos de pago, en vez de caer al LLM y trabarse.
  //    OJO: el fuzzy NO se aplica a palabras cortas ni al par "mayor"/"menor"
  //    (están a 1 edición entre sí → un typo apuntaría a ambos y se anularía).
  const words = normalized.split(" ").filter(Boolean);
  // Simetría COMPLETA: la opción MAYOR (más cara) y la MENOR (más barata), con
  // sus antónimos, para que "el más caro" y "el más barato" (y variantes) SIEMPRE
  // decidan. Las palabras cortas van solo en exacto; las largas también en fuzzy.
  const comboExact = ["combo", "completo", "pack", "premium", "vip", "mayor", "todo", "caro", "costoso", "alto", "grande", "full"];
  const basicoExact = ["basico", "barato", "economico", "comodo", "accesible", "menor", "simple", "bajo", "sencillo", "chico"];
  const comboFuzzy = ["completo", "premium", "costoso"];
  const basicoFuzzy = ["basico", "barato", "economico", "accesible", "comodo", "simple", "sencillo"];
  const hasExact = (list: string[]): boolean =>
    words.some((w) => list.includes(w));
  const hasFuzzy = (list: string[]): boolean =>
    words.some((w) => w.length >= 5 && list.some((k) => withinOneTypo(w, k)));
  const wantsCombo = hasExact(comboExact) || hasFuzzy(comboFuzzy);
  const wantsBasico = hasExact(basicoExact) || hasFuzzy(basicoFuzzy);
  if (wantsCombo !== wantsBasico) return wantsCombo ? "combo" : "basico";
  return null;
}

/** ¿`a` y `b` están a lo sumo a UN error de tipeo entre sí? Cuenta una
 *  sustitución, una inserción/omisión o una transposición de adyacentes
 *  ("compelto" ↔ "completo"). Acotada y barata; evita falsos positivos porque
 *  solo tolera UN error. */
function withinOneTypo(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  if (la === lb) {
    const diff: number[] = [];
    for (let i = 0; i < la; i++) {
      if (a[i] !== b[i]) {
        diff.push(i);
        if (diff.length > 2) return false;
      }
    }
    if (diff.length <= 1) return true; // una sustitución (o iguales)
    // dos diferencias adyacentes e intercambiadas = una transposición
    return (
      diff[1] === diff[0] + 1 &&
      a[diff[0]] === b[diff[1]] &&
      a[diff[1]] === b[diff[0]]
    );
  }
  // longitudes que difieren en 1 → una sola inserción/omisión
  const short = la < lb ? a : b;
  const long = la < lb ? b : a;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < short.length && j < long.length) {
    if (short[i] === long[j]) {
      i++;
      j++;
    } else if (++edits > 1) {
      return false;
    } else {
      j++;
    }
  }
  return true;
}

/** Preguntas o dudas que no deben confundirse con una eleccion de producto. */
export function isOrderBumpConversationQuestion(msg: string): boolean {
  const normalized = msg
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  // La intención EXPLÍCITA de compra gana SIEMPRE → no es pregunta (aunque use
  // verbos como "trae": "quiero el que trae todo" es una elección).
  const explicitDecision =
    /\b(quiero|elijo|escojo|prefiero|me quedo|llevare|llevo|decidi|dame|comprar|compro)\b/.test(
      normalized
    );
  if (explicitDecision) return false;
  if (isProductInformationQuestion(msg)) return true;
  return (
    /\b(misma cuenta|mismo metodo|igual metodo|donde pago|como pago|como se paga)\b/.test(
      normalized
    ) ||
    /\b(cual me recomiendas|que me recomiendas|cual recomiendas|cual me recomienda|que me recomienda|recomendacion|tengo una duda|tengo duda|una duda)\b/.test(
      normalized
    ) ||
    /\b(por que|para que|puedo pagar|se puede pagar)\b/.test(normalized)
  );
}

/** ¿Mostrar el menú de métodos de pago con botones de WhatsApp? */
export function isPaymentMethodButtonsActive(): boolean {
  return !!loadWorkflowConfig()?.payment_method_buttons;
}

/** Texto por defecto del menú de métodos (cara de texto, botones OFF). */
export const DEFAULT_PAYMENT_TEXT =
  "Puedes elegir tu método de pago entre las siguientes opciones:\n\n• *YAPE* 🤳🏼\n• *PLIN* 📲\n• *BCP* (transferencia bancaria) 🤗\n\n¿Cuál prefieres?";

/** Texto del menú de métodos (cara de texto). El configurado o el por defecto. */
export function getPaymentText(phone?: string | null): string {
  const config = loadWorkflowConfig();
  const country = getEffectiveCountryCode(phone, config);
  const t =
    config?.payment_profiles_by_country?.[country]?.payment_text?.trim() ||
    config?.payment_text?.trim();
  return t || DEFAULT_PAYMENT_TEXT;
}

/** Botones del menú de pago: los configurados (1-3) o, si no hay, los de
 *  defecto (Yape/Plin/BCP). `method` es la palabra clave que el bot enruta. */
export function getPaymentButtons(
  phone?: string | null
): { label: string; method: string }[] {
  const config = loadWorkflowConfig();
  const country = getEffectiveCountryCode(phone, config);
  const cfg =
    config?.payment_profiles_by_country?.[country]?.payment_buttons ??
    config?.payment_buttons;
  const valid = (cfg ?? []).filter(
    (b) => b && typeof b.label === "string" && b.label.trim() && b.method
  );
  if (valid.length > 0) return valid.slice(0, 3);
  return [
    { label: "Yape", method: "yape" },
    { label: "Plin", method: "plin" },
    { label: "BCP", method: "bcp" },
  ];
}

/** MÉTODOS DE PAGO (bot universal): la lista COMPLETA con sus aliases, en ORDEN,
 *  para la detección y el menú. Cantidad libre. Devuelve la lista CRUDA del
 *  config: si está vacía, la detección cae al reconocimiento clásico
 *  (yape/plin/bcp/efectivo hardcodeado) → Mundial no se ve afectado. */
export function getPaymentMethods(phone?: string | null): {
  label: string;
  method: string;
  aliases: string[];
}[] {
  const config = loadWorkflowConfig();
  const country = getEffectiveCountryCode(phone, config);
  const cfg =
    config?.payment_profiles_by_country?.[country]?.payment_buttons ??
    config?.payment_buttons;
  return (cfg ?? [])
    .filter(
      (b) => b && typeof b.label === "string" && b.label.trim() && b.method
    )
    .map((b) => ({
      label: b.label.trim(),
      method: b.method,
      aliases: (b.aliases ?? []).filter(
        (a): a is string => typeof a === "string" && a.trim().length > 0
      ),
    }));
}

/** Id del método de pago por DEFECTO: el PRIMERO de tu lista (bot universal) o
 *  "yape" si no hay lista (clásico/Mundial). Se usa cuando el flujo manda datos
 *  de pago sin que el cliente haya elegido método aún (ej. doble oferta directo). */
export function getDefaultPaymentMethodId(phone?: string | null): string {
  return getPaymentMethods(phone)[0]?.method ?? "yape";
}

/** DETECCIÓN DINÁMICA de método de pago: matchea el mensaje contra el TÍTULO y
 *  los ALIASES de cada método definido (con tolerancia a 1 typo en palabras
 *  largas). Devuelve el `method` (id) si UNO solo calza; null si ninguno o si es
 *  ambiguo (calzan varios → lo maneja el menú/LLM). Si no hay métodos definidos,
 *  devuelve null → el caller usa el reconocimiento clásico (yape/bcp/efectivo). */
export function detectDynamicPaymentMethod(
  msg: string,
  phone?: string | null
): string | null {
  const methods = getPaymentMethods(phone);
  if (methods.length === 0) return null;
  const norm = (s: string): string =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Mn}/gu, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const m = norm(msg);
  if (!m) return null;
  const words = m.split(" ").filter(Boolean);
  const matched = new Set<string>();
  for (const method of methods) {
    const keywords = [method.label, ...method.aliases]
      .map(norm)
      .filter(Boolean);
    for (const kw of keywords) {
      if (kw.includes(" ")) {
        // Frase ("banco del barrio"): la buscamos como substring del mensaje.
        if (m.includes(kw)) {
          matched.add(method.method);
          break;
        }
      } else {
        // Palabra: match exacto o a 1 typo (para palabras >=5, evita falsos).
        if (
          words.some(
            (w) =>
              w === kw ||
              (kw.length >= 5 && w.length >= 4 && withinOneTypo(w, kw))
          )
        ) {
          matched.add(method.method);
          break;
        }
      }
    }
  }
  const ids = Array.from(matched);
  return ids.length === 1 ? ids[0] : null;
}

/** Devuelve la opción (combo/básico) del order bump, o undefined si está
 *  apagado. */
export function getOrderBumpOption(
  key: "combo" | "basico"
): OrderBumpOption | undefined {
  const ob = getActiveTwoTierOffer();
  if (!ob) return undefined;
  return key === "combo" ? ob.combo : ob.basico;
}

/** Precio efectivo de una opción del Order Bump. Es la única fuente de verdad
 *  para conversación, mensajes de pago y validación del comprobante. */
export function getOrderBumpPriceSoles(
  key: "combo" | "basico",
  discountActive: boolean
): number | null {
  const option = getOrderBumpOption(key);
  const promo = option?.discount_price_soles ?? 0;
  if (discountActive && promo > 0) return promo;
  const regular = option?.price_soles ?? 0;
  return regular > 0 ? regular : null;
}

export function renderOrderBumpTemplate(
  text: string,
  discountActive: boolean
): string {
  const ob = getActiveTwoTierOffer();
  const comboName = ob?.combo?.name?.trim() || "Opción 1";
  const basicoName = ob?.basico?.name?.trim() || "Opción 2";
  const comboPrice = getOrderBumpPriceSoles("combo", discountActive);
  const basicoPrice = getOrderBumpPriceSoles("basico", discountActive);
  // Precio ADICIONAL del combo sobre el básico (lo que se "agrega"). Se calcula
  // solo, así en etapa de oferta también baja correctamente (ej. 15-10=5 normal,
  // 10-7=3 en oferta). Redondeo a 2 decimales por si hay precios con centavos.
  const extraPrice =
    comboPrice != null && basicoPrice != null
      ? Math.round((comboPrice - basicoPrice) * 100) / 100
      : null;
  // Formato: 2 decimales si los tiene (9.9 → "9.90"), entero si no (3 → "3").
  const fmt = (n: number | null | undefined): string =>
    n == null ? "" : Number.isInteger(n) ? String(n) : n.toFixed(2);
  const rendered = text
    .replace(/\{\{\s*(opcion_1|opcion1|option_1|option1|combo_name|producto_1|producto1|product_1|product1)\s*\}\}/gi, comboName)
    .replace(/\{\{\s*(opcion_2|opcion2|option_2|option2|basico_name|producto_2|producto2|product_2|product2)\s*\}\}/gi, basicoName)
    .replace(/\{\{\s*(precio_1|precio1|price_1|price1|combo_price)\s*\}\}/gi, fmt(comboPrice))
    .replace(/\{\{\s*(precio_2|precio2|price_2|price2|basico_price)\s*\}\}/gi, fmt(basicoPrice))
    .replace(
      /\{\{\s*(precio_extra|precio_adicional|precio_diferencia|diferencia|extra)\s*\}\}/gi,
      fmt(extraPrice)
    );
  return applyCustomPlaceholders(rendered);
}

/** Nombre del producto para el comodín {{PRODUCTO}}. Si está vacío, usa un
 *  término neutro seguro. */
export function getProductName(): string {
  return loadWorkflowConfig()?.product_name?.trim() || "Producto principal";
}

/** Nombre del SEGUNDO producto (comodín {{PRODUCTO2}}). */
export function getProductName2(): string {
  return loadWorkflowConfig()?.product_name_2?.trim() || "Producto 2";
}

/** Temas (`topic`) de la galería que componen la "info de contenido" que el bot
 *  envía cuando el cliente confirma que quiere ver qué incluye cada opción.
 *  Devuelve la lista limpia (sin vacíos), respetando el orden del editor. */
export function getProductInfoTopics(): string[] {
  const list = loadWorkflowConfig()?.product_info_topics;
  if (!Array.isArray(list)) return [];
  return list
    .map((t) => (typeof t === "string" ? t.trim() : ""))
    .filter(Boolean);
}

export function getProgressiveSamplesConfig(): {
  enabled: boolean;
  maxPerBatch: number;
  moreText: string;
} {
  const cfg = loadWorkflowConfig();
  return {
    enabled: cfg?.progressive_samples_enabled === true,
    maxPerBatch: Math.max(
      1,
      Math.floor(
        typeof cfg?.progressive_samples_max_per_batch === "number"
          ? cfg.progressive_samples_max_per_batch
          : 2
      )
    ),
    moreText:
      cfg?.progressive_samples_more_text?.trim() ||
      "Te muestro algunas para no saturarte 😊 ¿Quieres ver más?",
  };
}

/** Tema (`topic`) de la galería con la imagen del complemento, que el bot manda
 *  cuando el cliente pregunta específicamente por él. "" si no se configuró. */
export function getComplementInfoTopic(): string {
  return loadWorkflowConfig()?.complement_info_topic?.trim() || "";
}

/** Mensaje editable de tranquilización ante desconfianza/estafa (con su CTA),
 *  con el comodín {{PRODUCTO}} resuelto. "" si no se configuró. */
export function getDistrustMessage(): string {
  const raw = loadWorkflowConfig()?.distrust_message?.trim();
  return raw ? applyProductName(raw) : "";
}

/** Temas (`topic`) de la galería que el bot envía como "info adicional con
 *  imágenes" cuando el cliente quiere VER cómo es el producto. Tracking propio
 *  (las manda solo si las piden) → no choca con las del order bump. */
export function getExtraInfoTopics(): string[] {
  const list = loadWorkflowConfig()?.extra_info_topics;
  if (!Array.isArray(list)) return [];
  return list
    .map((t) => (typeof t === "string" ? t.trim() : ""))
    .filter(Boolean);
}

/** Galería "Info detallada para el cliente" (imágenes + caption propios). El bot
 *  la manda a pedido; no usa anti-repetición. [] si no hay ninguna válida. */
export function getDetailGallery(): GalleryItemOut[] {
  return normalizeGallery(loadWorkflowConfig()?.detail_gallery);
}

/** Reemplaza los comodines de nombre: {{PRODUCTO2}} y {{PRODUCTO}} (1-2 llaves,
 *  mayúsc/minúsc) por los nombres configurados. */
export function applyProductName(text: string): string {
  if (!text) return text;
  const rendered = text
    .replace(/\{{1,2}\s*producto2\s*\}{1,2}/gi, getProductName2())
    .replace(/\{{1,2}\s*producto\s*\}{1,2}/gi, getProductName());
  return applyCustomPlaceholders(rendered);
}

function normalizeCustomPlaceholderKey(value: unknown): string {
  return typeof value === "string"
    ? value
        .replace(/[{}]/g, "")
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9_]+/g, "_")
        .replace(/^_+|_+$/g, "")
    : "";
}

export function applyCustomPlaceholders(text: string): string {
  if (!text) return text;
  const placeholders = loadWorkflowConfig()?.custom_placeholders;
  if (!Array.isArray(placeholders) || placeholders.length === 0) return text;
  let out = text;
  for (const item of placeholders) {
    const key = normalizeCustomPlaceholderKey(item?.key);
    const value = typeof item?.value === "string" ? item.value : "";
    if (!key || !value) continue;
    out = out.replace(
      new RegExp(`\\{\\{\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\}\\}`, "gi"),
      value
    );
  }
  return out;
}

export function resolveSpintax(
  text: string,
  chooseIndex?: (options: string[], groupIndex: number) => number
): string {
  if (!text || !text.includes("|")) return text;
  let groupIndex = 0;
  return text.replace(/\{([^{}\n]*\|[^{}\n]*)\}/g, (match, body: string) => {
    const options = body.split("|");
    if (options.length < 2) return match;
    const rawIndex =
      chooseIndex?.(options, groupIndex) ??
      Math.floor(Math.random() * options.length);
    groupIndex += 1;
    const index = ((rawIndex % options.length) + options.length) % options.length;
    return options[index] ?? "";
  });
}

type GalleryItemOut = {
  topic: string;
  keywords: string[];
  when: string;
  media_type: "image" | "video" | "document" | "audio";
  drive_url: string;
  caption: string;
};

function normalizeGallery(
  g:
    | {
        topic?: string;
        keywords?: string[];
        when?: string;
        media_type?: "image" | "video" | "document" | "audio";
        drive_url?: string;
        caption?: string;
        enabled?: boolean;
      }[]
    | undefined
): GalleryItemOut[] {
  if (!Array.isArray(g)) return [];
  return g
    .filter(
      (x) =>
        x &&
        x.enabled !== false &&
        (x.topic ?? "").trim() &&
        (x.drive_url ?? "").trim()
    )
    .map((x) => ({
      topic: (x.topic ?? "").trim(),
      keywords: Array.isArray(x.keywords)
        ? x.keywords
            .filter((k): k is string => typeof k === "string")
            .map((k) => k.trim())
            .filter(Boolean)
        : [],
      when: (x.when ?? "").trim(),
      media_type:
        x.media_type === "video"
          ? "video"
          : x.media_type === "document"
            ? "document"
            : x.media_type === "audio"
              ? "audio"
              : "image",
      drive_url: (x.drive_url ?? "").trim(),
      caption: (x.caption ?? "").trim(),
    }));
}

/** Items VÁLIDOS de la galería. El bot manda por `topic`.
 *  Doble Oferta 2 Productos: producto 1 + producto 2, sin pack.
 *  Order Bump / Bioferta: conserva la mecánica de complemento + pack. */
export function getImageGallery(excludeSecondProduct = false): GalleryItemOut[] {
  const cfg = loadWorkflowConfig();
  const base = normalizeGallery(cfg?.image_gallery);
  // Order bump DIFERIDO: el bot aún no debe conocer el 2º producto → solo la
  // galería del producto principal (sin complemento ni pack).
  if (excludeSecondProduct) return base;
  // La galería del 2º producto aplica en doble oferta 2 productos y también
  // en las mecánicas antiguas donde funciona como complemento.
  const second =
    cfg?.doble_oferta_dos?.enabled ||
    cfg?.bioferta_doble?.enabled ||
    cfg?.order_bump?.enabled
      ? normalizeGallery(cfg?.image_gallery_2)
      : [];
  // Galería de pack: NO aplica en Doble Oferta 2 Productos.
  const pack =
    cfg?.bioferta_doble?.enabled || cfg?.order_bump?.enabled
      ? normalizeGallery(cfg?.pack_gallery)
      : [];
  return [...base, ...second, ...pack];
}
