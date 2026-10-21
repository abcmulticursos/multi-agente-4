"use client";

import Link from "next/link";
import EmojiPicker from "@/components/EmojiPicker";
import { TwemojiText } from "@/components/TwemojiText";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

type StepType = "text" | "image" | "audio" | "video" | "document";
type GalleryMediaType = "image" | "video" | "document" | "audio";
type CountryCode =
  | "PE"
  | "MX"
  | "CO"
  | "AR"
  | "BO"
  | "GT"
  | "CR"
  | "CL"
  | "EC"
  | "SV"
  | "VE";

const COUNTRY_OPTIONS: Array<{
  code: CountryCode;
  label: string;
  currency: string;
  symbol: string;
}> = [
  { code: "PE", label: "🇵🇪 Peru", currency: "PEN", symbol: "S/" },
  { code: "EC", label: "🇪🇨 Ecuador", currency: "USD", symbol: "$" },
  { code: "CO", label: "🇨🇴 Colombia", currency: "COP", symbol: "$" },
  { code: "MX", label: "🇲🇽 Mexico", currency: "MXN", symbol: "$" },
  { code: "AR", label: "🇦🇷 Argentina", currency: "ARS", symbol: "$" },
  { code: "BO", label: "🇧🇴 Bolivia", currency: "BOB", symbol: "Bs" },
  { code: "GT", label: "🇬🇹 Guatemala", currency: "GTQ", symbol: "Q" },
  { code: "CR", label: "🇨🇷 Costa Rica", currency: "CRC", symbol: "CRC" },
  { code: "CL", label: "🇨🇱 Chile", currency: "CLP", symbol: "$" },
  { code: "SV", label: "🇸🇻 El Salvador", currency: "USD", symbol: "$" },
  { code: "VE", label: "🇻🇪 Venezuela", currency: "VES", symbol: "Bs" },
];

interface PreviewContext {
  option1Name?: string;
  option2Name?: string;
  productName?: string;
  product2Name?: string;
  currencySymbol?: string;
  customerName?: string;
  customPlaceholders?: CustomPlaceholder[];
}

interface CustomPlaceholder {
  key: string;
  value: string;
  description?: string;
}

type PlaceholderOption = {
  token: string;
  label: string;
  description?: string;
};

const BASE_PLACEHOLDER_OPTIONS: PlaceholderOption[] = [
  {
    token: "{{NOMBRE}}",
    label: "Nombre del cliente",
    description: "Nombre capturado en la conversación.",
  },
  {
    token: "{{PRODUCTO}}",
    label: "Producto principal",
    description: "Nombre del producto configurado.",
  },
  {
    token: "{{PRODUCTO2}}",
    label: "Producto 2 / complemento",
    description: "Segundo producto o complemento configurado.",
  },
  {
    token: "{{PRECIO_1}}",
    label: "Precio opción 1",
    description: "Precio del combo/opción 1 en Order Bump.",
  },
  {
    token: "{{PRECIO_2}}",
    label: "Precio opción 2",
    description: "Precio de la opción 2 en Order Bump.",
  },
  {
    token: "{{PRECIO_EXTRA}}",
    label: "Diferencia de precio",
    description: "Diferencia entre combo y opción 2.",
  },
  {
    token: "{{MONEDA}}",
    label: "Símbolo de moneda",
    description: "S/, $, Bs, etc. según país.",
  },
];

const SUGGESTED_CUSTOM_PLACEHOLDERS: CustomPlaceholder[] = [
  {
    key: "PRODUCTO_3",
    value: "",
    description: "Producto adicional opcional",
  },
  {
    key: "PRECIO_3",
    value: "",
    description: "Precio de producto adicional opcional",
  },
  {
    key: "PRODUCTO_4",
    value: "",
    description: "Otro producto adicional opcional",
  },
  {
    key: "PRECIO_4",
    value: "",
    description: "Precio de otro producto adicional opcional",
  },
  {
    key: "PRODUCTO_EXTRA",
    value: "",
    description: "Complemento o adicional especial",
  },
  {
    key: "PRECIO_EXTRA_2",
    value: "",
    description: "Precio de complemento extra",
  },
  {
    key: "REGALO_1",
    value: "",
    description: "Regalo o bono principal",
  },
  {
    key: "REGALO_2",
    value: "",
    description: "Regalo o bono adicional",
  },
  {
    key: "LINK_EXTRA",
    value: "",
    description: "Link adicional reutilizable",
  },
];

const PlaceholderOptionsContext = createContext<PlaceholderOption[]>(
  BASE_PLACEHOLDER_OPTIONS
);
const EditorPreviewContext = createContext<PreviewContext>({
  option1Name: "Opcion 1",
  option2Name: "Opcion 2",
  productName: "Producto principal",
  product2Name: "Producto 2",
  currencySymbol: "S/.",
  customerName: "Cliente",
  customPlaceholders: [],
});

function normalizePlaceholderKey(value: string): string {
  return value
    .replace(/[{}]/g, "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function placeholderOptionsFromConfig(cfg: FullConfig | null): PlaceholderOption[] {
  const custom = (cfg?.custom_placeholders ?? [])
    .map((item) => {
      const key = normalizePlaceholderKey(item.key ?? "");
      if (!key) return null;
      return {
        token: `{{${key}}}`,
        label: key,
        description: item.description || item.value,
      } satisfies PlaceholderOption;
    })
    .filter(Boolean) as PlaceholderOption[];
  return [...BASE_PLACEHOLDER_OPTIONS, ...custom];
}

interface EditorStep {
  type: StepType;
  drive_url: string;
  texts: string[];
  delay_after_sec: number;
  /** false = burbuja apagada (el bot no la envía). Por defecto true. */
  enabled?: boolean;
}

interface EditorPaymentMenu {
  /** true = se envía al final del seguimiento. */
  enabled?: boolean;
  /** true = muestra los botones de método de pago. */
  use_buttons?: boolean;
  /** true = botones en burbuja aparte; false = en la misma burbuja de la foto/video. */
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
  /** false = apagado: el bot NO lo agenda ni lo envía. undefined/true = on. */
  enabled?: boolean;
  variants?: EditorFollowupVariant[];
  /** Menú de pago propio del seguimiento (foto/video + texto + botones). */
  offer_choice_menu_enabled?: boolean;
  payment_menu?: EditorPaymentMenu;
}

interface Schedule {
  quiet_hours_enabled?: boolean;
  slots_peru: string[];
  min_gap_hours_between: number;
  burst_delays_seconds: number[];
  quiet_hours: { start: string; end: string; resume_at: string };
  followup_1_ignore_quiet_hours?: boolean;
}

interface Offer {
  sequence_index: number;
  price_soles: number;
}

interface Globals {
  course_price_soles: number;
  between_messages_delay_seconds: number;
  llm_bubble_limit_enabled: boolean;
  llm_max_bubbles: number;
  bot_response_delay_seconds: number;
  awaiting_email_timeout_seconds: number;
  post_gift_comment_auto_human_delay_minutes: number;
  customer_survey_delay_minutes: number;
  no_response_delay_seconds: number;
  autopurge_inactive_days: number;
}

interface GiftVariant {
  weight: number;
  text: string;
  ad_ids: string[];
  /** Etiqueta tuya para reconocer el anuncio (ej. "Advantage AD1"). Solo
   *  visual; el bot no la usa. */
  label?: string;
  /** false = apagada: el bot NO la usa (pero conservas texto/ID/nombre).
   *  undefined o true = encendida. */
  enabled?: boolean;
  /** Si está definido, esta fila NO es un enlace: es un separador visual
   *  (un rótulo tuyo para agrupar, ej. "Campaña 2"). El bot no lo usa. */
  separator?: string;
}

interface Gift {
  has: boolean;
  consent_question: string;
  consent_buttons_enabled?: boolean;
  consent_buttons_prompt?: string;
  consent_buttons?: { label: string; action: "accept" | "reject" | "text" }[];
  consent_yes_label?: string;
  consent_no_label?: string;
  consent_sequence: EditorStep[];
  decline_message: string;
  ask_audio_drive_url: string;
  ask_text: string;
  ask_sequence: EditorStep[];
  reward_message: string;
  /** Nombre de la PRIMERA campaña (el grupo de arriba, antes del primer
   *  separador). Solo etiqueta visual; el bot no la usa. */
  first_campaign: string;
  variants: GiftVariant[];
}

interface PaymentValidation {
  require_receipt_date: boolean;
  yape_recipient_name_starts_with: string;
}

interface CountryPaymentProfileEditor {
  enabled?: boolean;
  course_price_soles: number;
  payment_validation?: {
    yape_recipient_name_starts_with?: string;
  };
  payment_text: string;
  payment_buttons: { label: string; method: string; aliases?: string[] }[];
  payment_responses: Record<string, EditorStep[]>;
}

type PaymentButtonEditor = {
  label: string;
  method: string;
  aliases?: string[];
};

const COUNTRY_PAYMENT_REFERENCES: Record<
  CountryCode,
  {
    payment_text: string;
    payment_buttons: PaymentButtonEditor[];
  }
> = {
  PE: {
    payment_text:
      "Puedes elegir tu metodo de pago entre las siguientes opciones:\n\n- *YAPE*\n- *PLIN*\n- *BCP* (transferencia bancaria)\n\nCual prefieres?",
    payment_buttons: [
      { label: "YAPE", method: "yape", aliases: ["yape"] },
      { label: "PLIN", method: "plin", aliases: ["plin"] },
      { label: "BCP", method: "bcp_transferencia", aliases: ["bcp"] },
    ],
  },
  EC: {
    payment_text:
      "[Referencia Ecuador] Puedes pagar por transferencia bancaria, deposito o PayPal. Cambia este texto por tus datos reales de Ecuador.",
    payment_buttons: [
      {
        label: "Transferencia",
        method: "transferencia_bancaria",
        aliases: ["transferencia", "banco", "transferir"],
      },
      {
        label: "Deposito",
        method: "deposito_bancario",
        aliases: ["deposito", "depositar"],
      },
      { label: "PayPal", method: "paypal", aliases: ["paypal"] },
    ],
  },
  CO: {
    payment_text:
      "[Referencia Colombia] Puedes pagar por Nequi, Bancolombia o Daviplata. Cambia este texto por tus datos reales de Colombia.",
    payment_buttons: [
      { label: "Nequi", method: "nequi", aliases: ["nequi"] },
      {
        label: "Bancolombia",
        method: "bancolombia",
        aliases: ["bancolombia", "transferencia"],
      },
      { label: "Daviplata", method: "daviplata", aliases: ["daviplata"] },
    ],
  },
  MX: {
    payment_text:
      "[Referencia Mexico] Puedes pagar por transferencia SPEI, OXXO o Mercado Pago. Cambia este texto por tus datos reales de Mexico.",
    payment_buttons: [
      { label: "SPEI", method: "spei", aliases: ["spei", "transferencia"] },
      { label: "OXXO", method: "oxxo", aliases: ["oxxo"] },
      {
        label: "Mercado Pago",
        method: "mercado_pago",
        aliases: ["mercado pago", "mercadopago"],
      },
    ],
  },
  AR: {
    payment_text:
      "[Referencia Argentina] Puedes pagar por transferencia bancaria, Mercado Pago o Uala. Cambia este texto por tus datos reales de Argentina.",
    payment_buttons: [
      {
        label: "Transferencia",
        method: "transferencia_bancaria",
        aliases: ["transferencia", "cbu", "alias"],
      },
      {
        label: "Mercado Pago",
        method: "mercado_pago",
        aliases: ["mercado pago", "mercadopago"],
      },
      { label: "Uala", method: "uala", aliases: ["uala"] },
    ],
  },
  BO: {
    payment_text:
      "[Referencia Bolivia] Puedes pagar por Tigo Money, transferencia bancaria o deposito. Cambia este texto por tus datos reales de Bolivia.",
    payment_buttons: [
      {
        label: "Tigo Money",
        method: "tigo_money",
        aliases: ["tigo money", "tigo"],
      },
      {
        label: "Transferencia",
        method: "transferencia_bancaria",
        aliases: ["transferencia", "banco"],
      },
      {
        label: "Deposito",
        method: "deposito_bancario",
        aliases: ["deposito", "depositar"],
      },
    ],
  },
  GT: {
    payment_text:
      "[Referencia Guatemala] Puedes pagar por transferencia bancaria, deposito o PayPal. Cambia este texto por tus datos reales de Guatemala.",
    payment_buttons: [
      {
        label: "Transferencia",
        method: "transferencia_bancaria",
        aliases: ["transferencia", "banco"],
      },
      {
        label: "Deposito",
        method: "deposito_bancario",
        aliases: ["deposito", "depositar"],
      },
      { label: "PayPal", method: "paypal", aliases: ["paypal"] },
    ],
  },
  CR: {
    payment_text:
      "[Referencia Costa Rica] Puedes pagar por SINPE Movil, transferencia bancaria o deposito. Cambia este texto por tus datos reales de Costa Rica.",
    payment_buttons: [
      {
        label: "SINPE Movil",
        method: "sinpe_movil",
        aliases: ["sinpe", "sinpe movil"],
      },
      {
        label: "Transferencia",
        method: "transferencia_bancaria",
        aliases: ["transferencia", "banco"],
      },
      {
        label: "Deposito",
        method: "deposito_bancario",
        aliases: ["deposito", "depositar"],
      },
    ],
  },
  CL: {
    payment_text:
      "[Referencia Chile] Puedes pagar por transferencia bancaria, Mercado Pago o CuentaRUT. Cambia este texto por tus datos reales de Chile.",
    payment_buttons: [
      {
        label: "Transferencia",
        method: "transferencia_bancaria",
        aliases: ["transferencia", "banco"],
      },
      {
        label: "Mercado Pago",
        method: "mercado_pago",
        aliases: ["mercado pago", "mercadopago"],
      },
      { label: "CuentaRUT", method: "cuentarut", aliases: ["cuentarut"] },
    ],
  },
  SV: {
    payment_text:
      "[Referencia El Salvador] Puedes pagar por transferencia bancaria, deposito o PayPal. Cambia este texto por tus datos reales de El Salvador.",
    payment_buttons: [
      {
        label: "Transferencia",
        method: "transferencia_bancaria",
        aliases: ["transferencia", "banco"],
      },
      {
        label: "Deposito",
        method: "deposito_bancario",
        aliases: ["deposito", "depositar"],
      },
      { label: "PayPal", method: "paypal", aliases: ["paypal"] },
    ],
  },
  VE: {
    payment_text:
      "[Referencia Venezuela] Puedes pagar por Pago Movil, transferencia bancaria o Binance. Cambia este texto por tus datos reales de Venezuela.",
    payment_buttons: [
      {
        label: "Pago Movil",
        method: "pago_movil",
        aliases: ["pago movil", "pagomovil"],
      },
      {
        label: "Transferencia",
        method: "transferencia_bancaria",
        aliases: ["transferencia", "banco"],
      },
      { label: "Binance", method: "binance", aliases: ["binance"] },
    ],
  },
};

function textStep(body: string): EditorStep {
  return {
    type: "text",
    drive_url: "",
    texts: [body],
    delay_after_sec: 0,
    enabled: true,
  };
}

function createCountryPaymentResponses(
  country: CountryCode,
  buttons: PaymentButtonEditor[]
): Record<string, EditorStep[]> {
  const countryName =
    COUNTRY_OPTIONS.find((item) => item.code === country)?.label ?? country;
  return Object.fromEntries(
    buttons.map((button) => [
      button.method,
      [
        textStep(
          `[Referencia ${countryName}] Escribe aqui los datos reales para ${button.label}. Incluye titular, banco/cuenta/enlace y el monto {{precio}}.`
        ),
      ],
    ])
  );
}

function createReferenceCountryPaymentProfile(
  country: CountryCode,
  cfg: FullConfig
): CountryPaymentProfileEditor {
  const reference = COUNTRY_PAYMENT_REFERENCES[country];
  return {
    enabled: country === "PE",
    course_price_soles:
      country === "PE" ? cfg.globals.course_price_soles : 0,
    payment_validation: {
      yape_recipient_name_starts_with:
        country === "PE"
          ? cfg.payment_validation.yape_recipient_name_starts_with
          : "",
    },
    payment_text: reference.payment_text,
    payment_buttons: reference.payment_buttons,
    payment_responses: createCountryPaymentResponses(
      country,
      reference.payment_buttons
    ),
  };
}

function mergeCountryPaymentProfileForEditor(
  country: CountryCode,
  cfg: FullConfig,
  saved?: CountryPaymentProfileEditor
): CountryPaymentProfileEditor {
  const reference = createReferenceCountryPaymentProfile(country, cfg);
  if (!saved) return reference;
  const buttons =
    saved.payment_buttons && saved.payment_buttons.length > 0
      ? saved.payment_buttons
      : reference.payment_buttons;
  return {
    ...reference,
    ...saved,
    payment_validation: {
      ...reference.payment_validation,
      ...(saved.payment_validation ?? {}),
    },
    payment_text: saved.payment_text?.trim()
      ? saved.payment_text
      : reference.payment_text,
    payment_buttons: buttons,
    payment_responses: {
      ...createCountryPaymentResponses(country, buttons),
      ...(saved.payment_responses ?? {}),
    },
  };
}

interface ObOption {
  name: string;
  aliases: string[];
  price_soles: number;
  /** Precio promo (etapa de oferta). 0 = sin promo, usa price_soles. */
  discount_price_soles: number;
  regalos?: string;
  response: EditorStep[];
  payment_responses: {
    yape: EditorStep[];
    bcp_transferencia: EditorStep[];
    efectivo: EditorStep[];
  };
  delivery: EditorStep[];
}

/** Plantilla (perfil de producto) de una modalidad, en formato del editor. El
 *  INTRO se edita DIRECTO aquí (cada modalidad su propia página, sin swap). Al
 *  guardar, la API copia el intro de la modalidad ACTIVA a los campos que lee el
 *  motor. Todo opcional: una plantilla puede tener solo lo que se llenó. */
interface ModalidadTemplateEditor {
  title?: string;
  intro_sequence?: EditorStep[];
  intro_sequence_2?: EditorStep[];
  intro_sequence_3?: EditorStep[];
  intro_extra_sequences?: EditorStep[][];
  intro_enabled?: boolean[];
  intro_weights?: number[];
  intro_names?: string[];
  campaign_name?: string;
  intro_ad_names?: string[];
  intro_ad_ids?: string[];
  greeting?: FullConfig["greeting"];
  followups?: EditorFollowup[];
  globals?: Globals;
  post_gift_comment_auto_human_enabled?: boolean;
  offer?: Offer | null;
  course_content?: string;
  product_name?: string;
  image_gallery?: FullConfig["image_gallery"];
  course_content_2?: string;
  product_name_2?: string;
  image_gallery_2?: FullConfig["image_gallery_2"];
  pack_gallery?: FullConfig["pack_gallery"];
  product_info_topics?: string[];
  complement_info_topic?: string;
  extra_info_topics?: string[];
  detail_gallery?: FullConfig["detail_gallery"];
  payment_approved?: EditorStep[];
  email?: FullConfig["email"];
  email_vip?: FullConfig["email_vip"];
  postventa?: string;
  gift?: Gift;
  bioferta?: FullConfig["bioferta"];
  order_bump?: FullConfig["order_bump"];
  doble_oferta_dos?: FullConfig["doble_oferta_dos"];
}

interface ChannelIntroGroupEditor {
  name: string;
  steps: EditorStep[];
  enabled?: boolean;
  weight?: number;
  adName?: string;
  adId?: string;
}

interface ChannelDeliveryGroupEditor {
  key: string;
  name: string;
  steps: EditorStep[];
  enabled?: boolean;
}

interface ChannelPostSaleEditor {
  whatsappPreference: string;
  deliveryUsage: string;
  lifetimeAccess: string;
  farewells: string;
}

interface ChannelContentEditor {
  intro_groups: ChannelIntroGroupEditor[];
  followups: EditorFollowup[];
  payment: EditorStep[];
  delivery: EditorStep[];
  delivery_groups?: ChannelDeliveryGroupEditor[];
  post_sale?: ChannelPostSaleEditor;
}

interface ChannelEditorConfig {
  enabled?: boolean;
  use_content?: boolean;
  modality_templates?: Partial<Record<Modo, ChannelContentEditor>>;
}

type SalesbotEngineMode = "ai" | "salesbot_strong" | "salesbot_only";
type SalesbotChannel = "all" | "whatsapp" | "messenger" | "instagram" | "tiktok";
type SalesbotRuleMatch = "contains_any" | "contains_all" | "regex";
type SalesbotRuleAction =
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

interface SalesbotRuleEditor {
  id: string;
  name: string;
  enabled?: boolean;
  priority: number;
  channel: SalesbotChannel;
  states: string[];
  match: SalesbotRuleMatch;
  keywords: string[];
  pattern: string;
  action: SalesbotRuleAction;
  response: string;
  steps: EditorStep[];
  next_state: string;
  stop_after_action?: boolean;
}

interface SalesbotConfigEditor {
  modes: Partial<Record<Modo, SalesbotEngineMode>>;
  rules: Partial<Record<Modo, SalesbotRuleEditor[]>>;
  fallback_text: string;
}

interface FullConfig {
  intro_sequence: EditorStep[];
  intro_sequence_2: EditorStep[];
  intro_sequence_3: EditorStep[];
  intro_extra_sequences?: EditorStep[][];
  intro_enabled: boolean[];
  intro_weights: number[];
  intro_names?: string[];
  campaign_name?: string;
  intro_ad_names?: string[];
  intro_ad_ids?: string[];
  /** Plantillas por modalidad (perfil propio de cada una). El editor edita la de
   *  la modalidad activa vía swap con los campos de arriba. */
  modality_templates?: {
    lineal?: ModalidadTemplateEditor;
    order_bump?: ModalidadTemplateEditor;
    bioferta?: ModalidadTemplateEditor;
    doble_oferta_dos?: ModalidadTemplateEditor;
  };
  /** Menú de pago al final del intro (foto/video + texto + botones). */
  intro_payment_menu?: EditorPaymentMenu;
  followups: EditorFollowup[];
  /** Contenido del curso y cómo se estudia (caja editable, inyectada al cerebro). */
  course_content?: string;
  /** Nombre del producto (comodín {{PRODUCTO}}). */
  product_name?: string;
  /** Selector de país (bot universal): "PE", "MX", "AR"… define moneda a Meta,
   *  {{MONEDA}}, dialecto y zona horaria. */
  country?: string;
  country_mode?: "fixed" | "auto_phone";
  country_sales_enabled?: Partial<Record<CountryCode, boolean>>;
  payment_profiles_by_country?: Partial<
    Record<CountryCode, CountryPaymentProfileEditor>
  >;
  channels?: {
    whatsapp?: ChannelEditorConfig;
    messenger?: ChannelEditorConfig;
    instagram?: ChannelEditorConfig;
    tiktok?: ChannelEditorConfig;
  };
  salesbot?: SalesbotConfigEditor;
  /** Correo remitente (GMAIL_USER del env). Solo lectura — viene del servidor. */
  gmail_user?: string;
  /** Galería de imágenes/videos que el bot manda según la pregunta (sumable). */
  image_gallery?: {
    topic: string;
    keywords?: string[];
    when: string;
    media_type: GalleryMediaType;
    drive_url: string;
    caption: string;
    enabled?: boolean;
  }[];
  /** SEGUNDO producto (Doble Oferta): contenido, nombre ({{PRODUCTO2}}) y galería. */
  course_content_2?: string;
  product_name_2?: string;
  image_gallery_2?: {
    topic: string;
    keywords?: string[];
    when: string;
    media_type: GalleryMediaType;
    drive_url: string;
    caption: string;
    enabled?: boolean;
  }[];
  /** Galería del PACK 2 EN 1 (sección propia, separada del complemento). */
  pack_gallery?: GalleryItem[];
  /** Info de contenido: temas de la galería que el bot envía como imágenes
   *  (con su caption) cuando el cliente confirma que quiere ver qué incluye. */
  product_info_topics?: string[];
  /** Imagen del complemento "bajo pedido": el topic de galería que el bot manda
   *  cuando el cliente pregunta específicamente por el complemento. */
  complement_info_topic?: string;
  /** Imágenes de "info adicional": temas de galería que el bot envía cuando el
   *  cliente quiere ver más del producto. Sección aparte, sin colisión. */
  extra_info_topics?: string[];
  /** "Info detallada para el cliente": galería propia (imágenes + caption +
   *  on/off). El bot la manda a pedido, sin conflicto. */
  detail_gallery?: GalleryItem[];
  schedule: Schedule;
  offer: Offer | null;
  globals: Globals;
  payment_validation: PaymentValidation;
  gift: Gift;
  /** Respuestas de pago por método (cada una = pasos con variantes, como los
   *  seguimientos). Yape y Plin comparten "yape". */
  payment_methods: {
    yape: EditorStep[];
    bcp_transferencia: EditorStep[];
    efectivo: EditorStep[];
  };
  /** Mostrar el menú de métodos de pago con botones de WhatsApp. */
  /** Pago directo opcional; apagado conserva el flujo actual. */
  direct_payment_enabled?: boolean;
  direct_payment_steps?: EditorStep[];
  direct_payment_cta?: string;
  direct_payment_without_choice_steps?: EditorStep[];
  direct_payment_without_choice_cta?: string;
  /** Mostrar el menÃº de mÃ©todos de pago con botones de WhatsApp. */
  payment_method_buttons: boolean;
  /** Modo silencioso (no charla) + toggle global de seguimientos. */
  silent_mode: boolean;
  followups_enabled: boolean;
  intro_variant_rotation_enabled?: boolean;
  progressive_samples_enabled?: boolean;
  progressive_samples_max_per_batch?: number;
  progressive_samples_more_text?: string;
  order_bump_option_presentation_rule?: string;
  custom_placeholders?: CustomPlaceholder[];
  /** Re-ofrecer regalo + volver a pedir correo tras la compra. Default true. */
  post_sale_reoffer: boolean;
  /** Auto-pasar a HUMANO después de completar el regalo. */
  post_gift_comment_auto_human_enabled: boolean;
  payment_buttons_prompt: string;
  /** Métodos de pago editables: etiqueta + método (slot de texto) + aliases
   *  (variantes que el cliente puede escribir para reconocerlo). El ORDEN es el
   *  orden de los botones. */
  payment_buttons: { label: string; method: string; aliases?: string[] }[];
  /** Texto del menú de métodos (cara de texto, cuando los botones están OFF). */
  payment_text: string;
  /** Mensaje editable de tranquilización ante desconfianza/estafa (+ CTA). */
  distrust_message?: string;
  /** Saludo inicial (primer mensaje): variantes de texto. */
  greeting: { texts: string[]; skip_ask_name?: boolean };
  /** Entrega "Pago Aprobado": secuencia post-pago (video + enlace + email). */
  payment_approved: EditorStep[];
  customer_survey_enabled?: boolean;
  customer_survey_auto_human_enabled?: boolean;
  customer_survey_message?: string;
  /** Plantilla del email post-compra. */
  email: { from_name: string; subject: string; body: string };
  /** Plantilla completa para compras de la opción combo/VIP. */
  email_vip: { from_name: string; subject: string; body: string };
  /** Mensaje de redirección para clientes de Ecuador (burbujas editables). */
  country_ecuador: EditorStep[];
  /** "Doble Oferta": 2 productos + pack. APAGADA por defecto. */
  bioferta: {
    enabled: boolean;
    use_buttons: boolean;
    pack_price_soles: number;
    pack_discount_price_soles: number;
    product_a: { name: string; aliases: string[] };
    product_b: { name: string; aliases: string[]; delivery: EditorStep[] };
    pack: { name: string; aliases: string[]; delivery: EditorStep[] };
    ask_choice_text: string;
  };
  /** Bioferta Order Bump: oferta intermedia (combo/básico). APAGADA por defecto. */
  order_bump: {
    enabled: boolean;
    use_buttons: boolean;
    intro: EditorStep[];
    choice_prompt: string;
    choice_clarification: string;
    price_question_response?: string;
    offer_on_reengaged_price?: boolean;
    offer_on_intro_first_message?: boolean;
    combo: ObOption;
    basico: ObOption;
  };
  /** Doble Oferta 2 Productos: elección (combo/básico) al FINAL de la intro,
   *  sin 2ª intro ni pedir nombre. APAGADA por defecto. */
  doble_oferta_dos: {
    enabled: boolean;
    use_buttons: boolean;
    separate_bubble?: boolean;
    basico_first?: boolean;
    choice_prompt: string;
    choice_buttons_prompt?: string;
    choice_clarification: string;
    combo: ObOption;
    basico: ObOption;
  };
  /** Cerebro EN CAJAS: valores actuales por sección (clave→texto). */
  prompt_sections: Record<string, string>;
  /** Defaults por sección (solo lectura, para "Restaurar" por caja). */
  prompt_section_defaults: Record<string, string>;
  /** Orden + etiqueta de las cajas (del servidor). */
  prompt_section_defs: { key: string; label: string }[];
}

const TYPE_LABEL: Record<StepType, string> = {
  text: "📝 Texto",
  image: "🖼️ Imagen",
  audio: "🎵 Audio",
  video: "🎥 Video",
  document: "📄 PDF",
};

type PostSaleEditorValues = {
  whatsappPreference: string;
  deliveryUsage: string;
  lifetimeAccess: string;
  farewells: string[];
};

const POST_SALE_FALLBACKS: PostSaleEditorValues = {
  whatsappPreference:
    "No te preocupes. Tu enlace ya esta en el mensaje de *PAGO APROBADO* de arriba: solo tocalo desde ahi para descargar el material. Guardalo o enviatelo a tu correo cuando puedas, para tenerlo siempre seguro.",
  deliveryUsage:
    "Todo esta en las carpetas de Drive que te envie: abres el enlace, descargas tu material y lo imprimes las veces que quieras.",
  lifetimeAccess:
    "Si, el acceso es de por vida y el material queda siempre disponible para ti.",
  farewells: [
    "Que disfrutes mucho tu material.",
    "Que lo disfrutes mucho aprendiendo y practicando.",
    "Muchos exitos con el material.",
  ],
};

function extractPostSaleValues(source: string): PostSaleEditorValues {
  const whatsappPreference =
    source.match(/Example response[\s\S]*?\n\s*"([\s\S]*?)"/)?.[1] ??
    POST_SALE_FALLBACKS.whatsappPreference;
  const deliveryUsage =
    source.match(/Phrases like:\s*\n\s*"([\s\S]*?)"/)?.[1] ??
    POST_SALE_FALLBACKS.deliveryUsage;
  const lifetimeAccess =
    source.match(/Phrases like:[\s\S]*?"[\s\S]*?"\s*\n\s*\n\s*"([\s\S]*?)"/)?.[1] ??
    POST_SALE_FALLBACKS.lifetimeAccess;
  const farewellMatch = source.match(
    /Instead, close with a warm farewell[\s\S]*?-\s*"([\s\S]*?)"\s*\n\s*-\s*"([\s\S]*?)"\s*\n\s*-\s*"([\s\S]*?)"/
  );
  const farewells = farewellMatch
    ? [farewellMatch[1], farewellMatch[2], farewellMatch[3]]
    : POST_SALE_FALLBACKS.farewells;
  return { whatsappPreference, deliveryUsage, lifetimeAccess, farewells };
}

function sanitizePostSaleInstruction(source: string): string {
  return source.replace(
    /in the PAGO APROBADO message \(the .*?\)\. Speak as if you know the content, WITHOUT inventing specific steps\./,
    "in the PAGO APROBADO message (the material you already received). Speak as if you know the content, WITHOUT inventing specific steps."
  );
}

function updatePostSaleSingle(
  source: string,
  current: string,
  next: string,
  pattern: RegExp
): string {
  if (current && source.includes(current)) return source.replace(current, next);
  if (pattern.test(source)) return source.replace(pattern, `$1${next}$2`);
  return source;
}

function updatePostSaleFarewells(
  source: string,
  farewellsText: string
): string {
  const lines = farewellsText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const next = [
    lines[0] ?? POST_SALE_FALLBACKS.farewells[0],
    lines[1] ?? POST_SALE_FALLBACKS.farewells[1],
    lines[2] ?? POST_SALE_FALLBACKS.farewells[2],
  ];
  return source.replace(
    /(Instead, close with a warm farewell that does NOT invite continuation:\s*\n\s*-\s*")[\s\S]*?("\s*\n\s*-\s*")[\s\S]*?("\s*\n\s*-\s*")[\s\S]*?(")/,
    `$1${next[0]}$2${next[1]}$3${next[2]}$4`
  );
}

function adaptTextForChannel(text: string, channel: ChannelKey): string {
  if (channel === "whatsapp") return text;
  const chatName =
    channel === "messenger"
      ? "Messenger"
      : channel === "instagram"
        ? "Instagram"
        : "este chat";
  return text
    .replace(/\bpor whatsapp\b/gi, "por aqui")
    .replace(/\bpor WhatsApp\b/g, "por aqui")
    .replace(/\bWhatsApp\b/gi, chatName)
    .replace(/\bmensaje de \*PAGO APROBADO\* de arriba\b/gi, "mensaje de *PAGO APROBADO* de arriba")
    .replace(/\bte envi(?:e|\u00e9)\b/gi, "te envie por aqui");
}

function adaptPostSaleForChannel(
  postSale: PostSaleEditorValues,
  channel: ChannelKey
): ChannelPostSaleEditor {
  return {
    whatsappPreference: adaptTextForChannel(postSale.whatsappPreference, channel),
    deliveryUsage: adaptTextForChannel(postSale.deliveryUsage, channel),
    lifetimeAccess: adaptTextForChannel(postSale.lifetimeAccess, channel),
    farewells: postSale.farewells
      .map((line) => adaptTextForChannel(line, channel))
      .join("\n"),
  };
}

function emptyStep(type: StepType = "text"): EditorStep {
  return { type, drive_url: "", texts: [""], delay_after_sec: 6 };
}

type Modo = "lineal" | "order_bump" | "bioferta" | "doble_oferta_dos";
const MODALIDAD_LABEL: Record<Modo, string> = {
  lineal: "Lineal",
  order_bump: "Order Bump",
  bioferta: "Doble Oferta",
  doble_oferta_dos: "Doble Oferta 2 Productos",
};

function uniqNonEmpty(values: Array<string | undefined>): string[] {
  return values
    .map((value) => value?.trim() ?? "")
    .filter((value, index, arr): value is string => !!value && arr.indexOf(value) === index);
}

function productInfoOptions(c: FullConfig): Array<{ topic: string; label: string }> {
  const isDobleOfertaDos = activeModality(c) === "doble_oferta_dos";
  if (isDobleOfertaDos) {
    const product1 = c.product_name?.trim() || "Producto 1";
    const product2 = c.product_name_2?.trim() || "Producto 2";
    const topics1 = uniqNonEmpty((c.image_gallery ?? []).map((g) => g.topic));
    const topics2 = uniqNonEmpty((c.image_gallery_2 ?? []).map((g) => g.topic));
    return [
      ...topics1.map((topic) => ({ topic, label: product1 })),
      ...topics2.map((topic) => ({ topic, label: product2 })),
    ].filter(
      (option, index, arr) =>
        arr.findIndex((item) => item.topic.toLowerCase() === option.topic.toLowerCase()) === index
    );
  }

  return uniqNonEmpty([
    ...(c.image_gallery ?? []).map((g) => g.topic),
    ...(c.image_gallery_2 ?? []).map((g) => g.topic),
    ...(c.pack_gallery ?? []).map((g) => g.topic),
  ]).map((topic) => ({ topic, label: topic }));
}

/** Modalidad activa según los toggles (lineal si ninguna oferta está encendida). */
function activeModality(c: FullConfig): Modo {
  if (c.order_bump.enabled) return "order_bump";
  if (c.bioferta.enabled) return "bioferta";
  if (c.doble_oferta_dos.enabled) return "doble_oferta_dos";
  return "lineal";
}

function emptySalesbotRule(): SalesbotRuleEditor {
  return {
    id: `rule_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name: "Nueva regla",
    enabled: true,
    priority: 100,
    channel: "all",
    states: [],
    match: "contains_any",
    keywords: [],
    pattern: "",
    action: "send_text",
    response: "",
    steps: [emptyStep()],
    next_state: "",
    stop_after_action: true,
  };
}

function normalizeSalesbotConfig(
  salesbot?: SalesbotConfigEditor
): SalesbotConfigEditor {
  const normalizeRules = (
    rules: Partial<Record<Modo, SalesbotRuleEditor[]>> | undefined
  ): Partial<Record<Modo, SalesbotRuleEditor[]>> =>
    Object.fromEntries(
      (["lineal", "order_bump", "bioferta", "doble_oferta_dos"] as Modo[]).map(
        (mode) => [
          mode,
          (rules?.[mode] ?? []).map((rule) => ({
            ...emptySalesbotRule(),
            ...rule,
            steps: rule.steps?.length ? rule.steps : [emptyStep()],
          })),
        ]
      )
    ) as Partial<Record<Modo, SalesbotRuleEditor[]>>;
  return {
    modes: {
      lineal: "ai",
      order_bump: "ai",
      bioferta: "ai",
      doble_oferta_dos: "ai",
      ...(salesbot?.modes ?? {}),
    },
    rules: normalizeRules(salesbot?.rules),
    fallback_text:
      salesbot?.fallback_text ??
      "No te entendi bien. Por favor elige una opcion o escribeme un poco mas claro.",
  };
}

function previewContextFromConfig(c: FullConfig): PreviewContext {
  const twoTier = c.doble_oferta_dos.enabled
    ? c.doble_oferta_dos
    : c.order_bump;
  return {
    option1Name: twoTier.combo.name,
    option2Name: twoTier.basico.name,
    productName: c.product_name,
    product2Name: c.product_name_2,
    currencySymbol: "S/.",
    customerName: "Cliente",
    customPlaceholders: c.custom_placeholders ?? [],
  };
}

function previewComboPriceFromConfig(c: FullConfig): number {
  return c.doble_oferta_dos.enabled
    ? c.doble_oferta_dos.combo.price_soles
    : c.order_bump.combo.price_soles;
}

function previewBasicoPriceFromConfig(c: FullConfig): number {
  return c.doble_oferta_dos.enabled
    ? c.doble_oferta_dos.basico.price_soles
    : c.order_bump.basico.price_soles;
}

/** Extrae los campos "de plantilla" (intro/seguimientos/regalo/contenido) del cfg. */
function templateFromCfg(c: FullConfig): ModalidadTemplateEditor {
  // El INTRO NO va aquí: se edita DIRECTO en modality_templates[modalidad]. Esto
  // solo sincroniza los campos que todavía viven en el top-level.
  return {
    followups: c.followups,
    greeting: c.greeting,
    globals: c.globals,
    post_gift_comment_auto_human_enabled:
      c.post_gift_comment_auto_human_enabled,
    offer: c.offer,
    course_content: c.course_content,
    product_name: c.product_name,
    image_gallery: c.image_gallery,
    course_content_2: c.course_content_2,
    product_name_2: c.product_name_2,
    image_gallery_2: c.image_gallery_2,
    pack_gallery: c.pack_gallery,
    product_info_topics: c.product_info_topics,
    complement_info_topic: c.complement_info_topic,
    extra_info_topics: c.extra_info_topics,
    detail_gallery: c.detail_gallery,
    payment_approved: c.payment_approved,
    email: c.email,
    email_vip: c.email_vip,
    postventa: c.prompt_sections.postventa,
    gift: c.gift,
    bioferta: c.bioferta,
    order_bump: c.order_bump,
    doble_oferta_dos: c.doble_oferta_dos,
  };
}

/** Aplica una plantilla a los campos top-level (lo que edita/lee el editor). */
function applyTemplate(c: FullConfig, t: ModalidadTemplateEditor): FullConfig {
  // El INTRO no se toca aquí (es directo por modalidad). Solo lo demás.
  return {
    ...c,
    followups: t.followups ?? c.followups,
    greeting: t.greeting ?? c.greeting,
    globals: t.globals ?? c.globals,
    post_gift_comment_auto_human_enabled:
      t.post_gift_comment_auto_human_enabled ??
      c.post_gift_comment_auto_human_enabled,
    offer: t.offer === undefined ? c.offer : t.offer,
    course_content: t.course_content ?? c.course_content,
    product_name: t.product_name ?? c.product_name,
    image_gallery: t.image_gallery ?? c.image_gallery,
    course_content_2: t.course_content_2 ?? c.course_content_2,
    product_name_2: t.product_name_2 ?? c.product_name_2,
    image_gallery_2: t.image_gallery_2 ?? c.image_gallery_2,
    pack_gallery: t.pack_gallery ?? c.pack_gallery,
    product_info_topics: t.product_info_topics ?? c.product_info_topics,
    complement_info_topic: t.complement_info_topic ?? c.complement_info_topic,
    extra_info_topics: t.extra_info_topics ?? c.extra_info_topics,
    detail_gallery: t.detail_gallery ?? c.detail_gallery,
    payment_approved: t.payment_approved ?? c.payment_approved,
    email: t.email ?? c.email,
    email_vip: t.email_vip ?? c.email_vip,
    prompt_sections: {
      ...c.prompt_sections,
      postventa: t.postventa ?? c.prompt_sections.postventa,
    },
    gift: t.gift ?? c.gift,
    bioferta: t.bioferta ?? c.bioferta,
    order_bump: t.order_bump ?? c.order_bump,
    doble_oferta_dos: t.doble_oferta_dos ?? c.doble_oferta_dos,
  };
}

interface IntroEditorItem {
  steps: EditorStep[];
  enabled: boolean;
  weight: number;
  name: string;
  adName: string;
  adId: string;
}

function introItemsFromTemplate(
  t: ModalidadTemplateEditor | undefined
): IntroEditorItem[] {
  const extra = t?.intro_extra_sequences ?? [];
  const count = 3 + extra.length;
  const items: IntroEditorItem[] = [];
  for (let idx = 0; idx < count; idx++) {
    const exists =
      idx === 0 ||
      idx >= 3 ||
      Object.prototype.hasOwnProperty.call(
        t ?? {},
        idx === 1 ? "intro_sequence_2" : "intro_sequence_3"
      );
    if (!exists) continue;
    const steps =
      idx === 0
        ? t?.intro_sequence ?? []
        : idx === 1
          ? t?.intro_sequence_2 ?? []
          : idx === 2
            ? t?.intro_sequence_3 ?? []
            : extra[idx - 3] ?? [];
    const weight =
      typeof t?.intro_weights?.[idx] === "number" &&
      Number.isFinite(t.intro_weights[idx]) &&
      t.intro_weights[idx] > 0
        ? t.intro_weights[idx]
        : 1;
    items.push({
      steps,
      enabled: (t?.intro_enabled?.[idx] ?? false) === true,
      weight,
      name: t?.intro_names?.[idx] ?? "",
      adName: t?.intro_ad_names?.[idx] ?? "",
      adId: t?.intro_ad_ids?.[idx] ?? "",
    });
  }
  return items;
}

function templateWithIntroItems(
  t: ModalidadTemplateEditor,
  items: IntroEditorItem[]
): ModalidadTemplateEditor {
  const next: ModalidadTemplateEditor = {
    ...t,
    intro_sequence: items[0]?.steps ?? [],
    intro_enabled: items.map((item) => item.enabled),
    intro_weights: items.map((item) => item.weight),
    intro_names: items.map((item) => item.name),
    intro_ad_names: items.map((item) => item.adName),
    intro_ad_ids: items.map((item) => item.adId),
  };
  if (items.length > 1) next.intro_sequence_2 = items[1].steps;
  else delete next.intro_sequence_2;
  if (items.length > 2) next.intro_sequence_3 = items[2].steps;
  else delete next.intro_sequence_3;
  if (items.length > 3) {
    next.intro_extra_sequences = items.slice(3).map((item) => item.steps);
  } else {
    next.intro_extra_sequences = [];
  }
  return next;
}

function moveIntroItem(
  t: ModalidadTemplateEditor | undefined,
  from: number,
  to: number
): ModalidadTemplateEditor | null {
  const items = introItemsFromTemplate(t);
  if (
    from < 0 ||
    to < 0 ||
    from >= items.length ||
    to >= items.length ||
    from === to
  ) {
    return null;
  }
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return templateWithIntroItems(t ?? {}, next);
}

function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (
    from < 0 ||
    to < 0 ||
    from >= items.length ||
    to >= items.length ||
    from === to
  ) {
    return items;
  }
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function keepMovedCollapsibleOpen(keyPrefix: string, from: number, to: number) {
  try {
    localStorage.setItem(`wf:collapsible:${keyPrefix}_${from}`, "0");
    localStorage.setItem(`wf:collapsible:${keyPrefix}_${to}`, "1");
  } catch {}
}

function keepMovedCollapsibleOpenExact(oldKey: string, newKey: string) {
  try {
    localStorage.setItem(`wf:collapsible:${oldKey}`, "0");
    localStorage.setItem(`wf:collapsible:${newKey}`, "1");
  } catch {}
}

/** SWAP: guarda lo editado en la plantilla de la modalidad vieja, carga la nueva
 *  como activa y ajusta los toggles (exclusión mutua). El motor no se entera:
 *  al guardar, la API copia la plantilla activa a los campos top-level. */
function switchModalidad(c: FullConfig, newMod: Modo): FullConfig {
  const old = activeModality(c);
  const templates = { ...(c.modality_templates ?? {}) };
  templates[old] = {
    ...(templates[old] ?? {}), // preserva el INTRO (editado directo por modalidad)
    ...templateFromCfg(c), // sincroniza followups/contenido/regalo del top-level
    title: templates[old]?.title ?? MODALIDAD_LABEL[old],
  };
  const newTpl: ModalidadTemplateEditor = templates[newMod] ?? {
    ...templateFromCfg(c),
    offer: newMod === "doble_oferta_dos" ? null : c.offer,
    title: MODALIDAD_LABEL[newMod],
  };
  templates[newMod] = {
    ...newTpl,
    title: newTpl.title ?? MODALIDAD_LABEL[newMod],
  };
  const applied = applyTemplate(c, newTpl);
  return {
    ...applied,
    modality_templates: templates,
    order_bump: { ...applied.order_bump, enabled: newMod === "order_bump" },
    bioferta: { ...applied.bioferta, enabled: newMod === "bioferta" },
    doble_oferta_dos: {
      ...applied.doble_oferta_dos,
      enabled: newMod === "doble_oferta_dos",
    },
  };
}

type Tab =
  | "intro"
  | "seguimientos"
  | "salesbot"
  | "canales"
  | "ajustes"
  | "regalo"
  | "pago"
  | "entrega"
  | "bioferta"
  | "orderbump"
  | "dobleoferta2"
  | "contenido"
  | "cerebro";

export default function EditorPage() {
  const [cfg, setCfg] = useState<FullConfig | null>(null);
  const [history, setHistory] = useState<FullConfig[]>([]);
  const [baseline, setBaseline] = useState<string>("");
  const [postventaFarewellsDraft, setPostventaFarewellsDraft] = useState("");
  const [dragIntroIndex, setDragIntroIndex] = useState<number | null>(null);
  const [introOpenMove, setIntroOpenMove] = useState<{
    from: number;
    to: number;
    nonce: number;
  } | null>(null);

  // Exclusión mutua entre modalidades (order bump / doble oferta 2 productos /
  // bioferta): solo UNA activa a la vez. Al desactivar la activa, el bot vuelve
  // al modo LINEAL (venta normal, sin ninguna oferta).
  const setModalidad = (
    modo: "order_bump" | "doble_oferta_dos" | "bioferta",
    turnOn: boolean
  ): void => {
    if (!cfg) return;
    if (turnOn) {
      setCfg(switchModalidad(cfg, modo));
    } else {
      setCfg(switchModalidad(cfg, "lineal"));
    }
  };

  // Selector de modalidad (desplegable siempre visible): cambia a la modalidad
  // elegida — incluye "Lineal" (que no tiene pestaña propia).
  const selectModalidad = (newMod: Modo): void => {
    if (!cfg) return;
    const current = activeModality(cfg);
    if (newMod === current) return;
    setCfg(switchModalidad(cfg, newMod));
  };
  const [tab, setTab] = useState<Tab>("canales");

  // Si estás viendo la pestaña de una modalidad que quedó desactivada, vuelve a
  // "Intro" (esa pestaña ya no aparece en el menú).
  useEffect(() => {
    if (!cfg) return;
    if (
      (tab === "orderbump" && !cfg.order_bump.enabled) ||
      (tab === "bioferta" && !cfg.bioferta.enabled) ||
      (tab === "dobleoferta2" && !cfg.doble_oferta_dos.enabled)
    ) {
      setTab("intro");
    }
  }, [tab, cfg]);

  // Desactiva el ARRASTRE nativo de texto en los campos del editor: cuando
  // sombreas texto y vuelves a hacer click-arrastre sobre la selección, el
  // navegador intenta "mover" el texto (drag & drop) en vez de re-seleccionar.
  // Cancelamos ese arrastre SOLO en inputs/textareas → el sombreado/selección
  // sigue funcionando, pero ya no arrastra el texto por error.
  useEffect(() => {
    const handler = (e: DragEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      ) {
        e.preventDefault();
      }
    };
    document.addEventListener("dragstart", handler);
    return () => document.removeEventListener("dragstart", handler);
  }, []);

  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);
  const [showPlaceholders, setShowPlaceholders] = useState(false);
  const [selectedPaymentCountry, setSelectedPaymentCountry] =
    useState<CountryCode>("PE");
  // Cuadro modal (con botón "Entendido") cuando el guardado NO se pudo publicar
  // a GitHub → así el aviso no se te pasa (no desaparece solo como el toast).
  const [publishBlocked, setPublishBlocked] = useState<string | null>(null);

  // El aviso flotante se oculta solo: el éxito rápido (lo ves sin subir y se va),
  // los errores se quedan más tiempo para que no pasen desapercibidos.
  useEffect(() => {
    if (!toast) return;
    if (!toast.ok) return;
    const ms = toast.ok ? 1500 : 9000;
    const t = setTimeout(() => setToast(null), ms);
    return () => clearTimeout(t);
  }, [toast]);

  // Ref para leer el cfg actual sin closures rancios al tomar snapshots.
  const cfgRef = useRef<FullConfig | null>(null);
  const postventaFarewellsFocusedRef = useRef(false);
  useEffect(() => {
    cfgRef.current = cfg;
  }, [cfg]);

  useEffect(() => {
    if (!cfg || postventaFarewellsFocusedRef.current) return;
    const source = cfg.prompt_sections.postventa ?? "";
    setPostventaFarewellsDraft(extractPostSaleValues(source).farewells.join("\n"));
  }, [cfg]);

  // ¿Hay cambios sin guardar? Compara TODO el estado (incluye textos).
  const isDirty = cfg !== null && JSON.stringify(cfg) !== baseline;

  // Clave del último campo editado: agrupa el tecleo en un mismo campo en
  // una sola "foto" de deshacer, en vez de una por cada tecla.
  const lastEditKey = useRef<string | null>(null);

  // Foto para cambios estructurales (agregar/quitar/mover). Resetea la
  // agrupación para que el siguiente tecleo abra una foto nueva.
  function snapshot() {
    const cur = cfgRef.current;
    if (cur) setHistory((h) => [...h.slice(-99), cur]);
    lastEditKey.current = null;
  }
  // Foto para edición de campos/textos, agrupada por campo.
  function editSnapshot(key: string) {
    if (lastEditKey.current === key) return;
    const cur = cfgRef.current;
    if (cur) setHistory((h) => [...h.slice(-99), cur]);
    lastEditKey.current = key;
  }
  function undo() {
    setHistory((h) => {
      if (h.length === 0) return h;
      setCfg(h[h.length - 1]);
      return h.slice(0, -1);
    });
  }

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoadError(null);
    try {
      const res = await fetch("/api/workflow", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Error al cargar");
      const loaded = data as FullConfig;
      loaded.intro_weights = Array.isArray(loaded.intro_weights)
        ? loaded.intro_weights
        : [];
      loaded.intro_names = Array.isArray(loaded.intro_names)
        ? loaded.intro_names
        : [];
      loaded.intro_ad_names = Array.isArray(loaded.intro_ad_names)
        ? loaded.intro_ad_names
        : [];
      loaded.intro_ad_ids = Array.isArray(loaded.intro_ad_ids)
        ? loaded.intro_ad_ids
        : [];
      // Migración/REPARACIÓN: asegura que EXISTAN las 4 plantillas. Rellena solo
      // las que FALTEN con copia PROFUNDA de lo actual (sin pisar las existentes).
      // Clave: si faltaba una clave (p.ej. order_bump), al cambiar de modalidad el
      // swap caía en el fallback y cargaba el top-level actual → "la caja no
      // cambiaba". Rellenando siempre las 4, el swap funciona.
      {
        const mk = (title: string, mode: Modo): ModalidadTemplateEditor => ({
          title,
          intro_sequence: JSON.parse(JSON.stringify(loaded.intro_sequence ?? [])),
          intro_sequence_2: JSON.parse(
            JSON.stringify(loaded.intro_sequence_2 ?? [])
          ),
          intro_sequence_3: JSON.parse(
            JSON.stringify(loaded.intro_sequence_3 ?? [])
          ),
          intro_extra_sequences: JSON.parse(
            JSON.stringify(loaded.intro_extra_sequences ?? [])
          ),
          intro_enabled: JSON.parse(JSON.stringify(loaded.intro_enabled ?? [])),
          intro_weights: JSON.parse(JSON.stringify(loaded.intro_weights ?? [])),
          intro_names: JSON.parse(JSON.stringify(loaded.intro_names ?? [])),
          campaign_name: loaded.campaign_name ?? "",
          intro_ad_names: JSON.parse(
            JSON.stringify(loaded.intro_ad_names ?? [])
          ),
          intro_ad_ids: JSON.parse(JSON.stringify(loaded.intro_ad_ids ?? [])),
          ...JSON.parse(JSON.stringify(templateFromCfg(loaded))),
          offer:
            mode === "doble_oferta_dos"
              ? null
              : JSON.parse(JSON.stringify(loaded.offer ?? null)),
        });
        const mt = loaded.modality_templates ?? {};
        loaded.modality_templates = {
          lineal: mt.lineal ?? mk("Lineal", "lineal"),
          order_bump: mt.order_bump ?? mk("Order Bump", "order_bump"),
          bioferta: mt.bioferta ?? mk("Doble Oferta", "bioferta"),
          doble_oferta_dos:
            mt.doble_oferta_dos ??
            mk("Doble Oferta 2 Prod", "doble_oferta_dos"),
        };
      }
      const active = activeModality(loaded);
      const activeTpl = loaded.modality_templates?.[active];
      const hydrated = activeTpl ? applyTemplate(loaded, activeTpl) : loaded;
      setCfg(hydrated);
      setBaseline(JSON.stringify(hydrated));
      setHistory([]);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Error al cargar");
    }
  }

  async function save() {
    if (!cfg) return;
    setSaving(true);
    setToast(null);
    try {
      // Sincroniza la plantilla de la modalidad ACTIVA con lo que estás editando
      // (campos top-level) antes de guardar. La API luego copia esa plantilla a
      // los campos que lee el motor.
      const _active = activeModality(cfg);
      const _syncedTemplates = {
        ...(cfg.modality_templates ?? {}),
        [_active]: {
          ...(cfg.modality_templates?.[_active] ?? {}), // preserva el INTRO directo
          ...templateFromCfg(cfg), // sincroniza followups/contenido/regalo del top-level
          title:
            cfg.modality_templates?.[_active]?.title ?? MODALIDAD_LABEL[_active],
        },
      };
      const _activeTpl = _syncedTemplates[_active] ?? {};
      const _bioferta = _activeTpl.bioferta ?? cfg.bioferta;
      const _orderBump = _activeTpl.order_bump ?? cfg.order_bump;
      const _dobleOfertaDos =
        _activeTpl.doble_oferta_dos ?? cfg.doble_oferta_dos;
      const _productInfoTopics =
        _active === "doble_oferta_dos"
          ? uniqNonEmpty([
              ...(_activeTpl.image_gallery ?? cfg.image_gallery ?? []).map(
                (g) => g.topic
              ),
              ...(_activeTpl.image_gallery_2 ?? cfg.image_gallery_2 ?? []).map(
                (g) => g.topic
              ),
            ]).filter((topic) =>
              (_activeTpl.product_info_topics ?? cfg.product_info_topics ?? []).includes(
                topic
              )
            )
          : _activeTpl.product_info_topics ?? cfg.product_info_topics;
      const clean: FullConfig = {
        ...cfg,
        modality_templates: _syncedTemplates,
        // El motor lee el top-level: copia el INTRO de la modalidad ACTIVA.
        intro_sequence: (_activeTpl.intro_sequence ?? cfg.intro_sequence).map(cleanStep),
        intro_sequence_2: (_activeTpl.intro_sequence_2 ?? cfg.intro_sequence_2).map(
          cleanStep
        ),
        intro_sequence_3: (_activeTpl.intro_sequence_3 ?? cfg.intro_sequence_3).map(
          cleanStep
        ),
        intro_extra_sequences: (
          _activeTpl.intro_extra_sequences ??
          cfg.intro_extra_sequences ??
          []
        ).map((steps) => steps.map(cleanStep)),
        intro_enabled: _activeTpl.intro_enabled ?? cfg.intro_enabled,
        intro_weights: _activeTpl.intro_weights ?? cfg.intro_weights,
        intro_names: _activeTpl.intro_names ?? cfg.intro_names ?? [],
        campaign_name: _activeTpl.campaign_name ?? cfg.campaign_name ?? "",
        intro_ad_names: _activeTpl.intro_ad_names ?? cfg.intro_ad_names ?? [],
        intro_ad_ids: _activeTpl.intro_ad_ids ?? cfg.intro_ad_ids ?? [],
        followups: (_activeTpl.followups ?? cfg.followups).map((f) => ({
          ...f,
          steps: f.steps.map(cleanStep),
        })),
        greeting: _activeTpl.greeting ?? cfg.greeting,
        globals: _activeTpl.globals ?? cfg.globals,
        post_gift_comment_auto_human_enabled:
          _activeTpl.post_gift_comment_auto_human_enabled ??
          cfg.post_gift_comment_auto_human_enabled,
        offer: _activeTpl.offer === undefined ? cfg.offer : _activeTpl.offer,
        course_content: _activeTpl.course_content ?? cfg.course_content,
        product_name: _activeTpl.product_name ?? cfg.product_name,
        image_gallery: _activeTpl.image_gallery ?? cfg.image_gallery,
        course_content_2: _activeTpl.course_content_2 ?? cfg.course_content_2,
        product_name_2: _activeTpl.product_name_2 ?? cfg.product_name_2,
        image_gallery_2: _activeTpl.image_gallery_2 ?? cfg.image_gallery_2,
        pack_gallery: _activeTpl.pack_gallery ?? cfg.pack_gallery,
        product_info_topics: _productInfoTopics,
        complement_info_topic:
          _activeTpl.complement_info_topic ?? cfg.complement_info_topic,
        extra_info_topics: _activeTpl.extra_info_topics ?? cfg.extra_info_topics,
        detail_gallery: _activeTpl.detail_gallery ?? cfg.detail_gallery,
        payment_approved: (
          _activeTpl.payment_approved ?? cfg.payment_approved
        ).map(cleanStep),
        customer_survey_enabled: cfg.customer_survey_enabled === true,
        customer_survey_auto_human_enabled:
          cfg.customer_survey_auto_human_enabled === true,
        customer_survey_message: cfg.customer_survey_message ?? "",
        gift: _activeTpl.gift ?? cfg.gift,
        payment_methods: {
          yape: cfg.payment_methods.yape.map(cleanStep),
          bcp_transferencia:
            cfg.payment_methods.bcp_transferencia.map(cleanStep),
          efectivo: cfg.payment_methods.efectivo.map(cleanStep),
        },
        direct_payment_enabled: cfg.direct_payment_enabled === true,
        direct_payment_steps: (cfg.direct_payment_steps ?? []).map(cleanStep),
        direct_payment_cta: cfg.direct_payment_cta ?? "",
        direct_payment_without_choice_steps: (
          cfg.direct_payment_without_choice_steps ?? []
        ).map(cleanStep),
        direct_payment_without_choice_cta:
          cfg.direct_payment_without_choice_cta ?? "",
        country_mode: cfg.country_mode ?? "fixed",
        country_sales_enabled: cfg.country_sales_enabled ?? {},
        payment_profiles_by_country: cfg.payment_profiles_by_country ?? {},
        channels: {
          whatsapp: {
            enabled: cfg.channels?.whatsapp?.enabled === true,
            use_content: cfg.channels?.whatsapp?.use_content === true,
            modality_templates: cleanChannelModalities(
              cfg.channels?.whatsapp?.modality_templates
            ),
          },
          messenger: {
            enabled: cfg.channels?.messenger?.enabled === true,
            use_content: cfg.channels?.messenger?.use_content === true,
            modality_templates: cleanChannelModalities(
              cfg.channels?.messenger?.modality_templates
            ),
          },
          instagram: {
            enabled: cfg.channels?.instagram?.enabled === true,
            use_content: cfg.channels?.instagram?.use_content === true,
            modality_templates: cleanChannelModalities(
              cfg.channels?.instagram?.modality_templates
            ),
          },
          tiktok: {
            enabled: cfg.channels?.tiktok?.enabled === true,
            use_content: cfg.channels?.tiktok?.use_content === true,
            modality_templates: cleanChannelModalities(
              cfg.channels?.tiktok?.modality_templates
            ),
          },
        },
        country_ecuador: cfg.country_ecuador.map(cleanStep),
        bioferta: {
          ..._bioferta,
          enabled: _active === "bioferta",
          product_b: {
            ..._bioferta.product_b,
            delivery: _bioferta.product_b.delivery.map(cleanStep),
          },
          pack: {
            ..._bioferta.pack,
            delivery: _bioferta.pack.delivery.map(cleanStep),
          },
        },
        order_bump: {
          ..._orderBump,
          enabled: _active === "order_bump",
          intro: _orderBump.intro.map(cleanStep),
          combo: {
            ..._orderBump.combo,
            response: _orderBump.combo.response.map(cleanStep),
            payment_responses: {
              yape:
                _orderBump.combo.payment_responses.yape.map(cleanStep),
              bcp_transferencia:
                _orderBump.combo.payment_responses.bcp_transferencia.map(
                  cleanStep
                ),
              efectivo:
                _orderBump.combo.payment_responses.efectivo.map(cleanStep),
            },
            delivery: _orderBump.combo.delivery.map(cleanStep),
          },
          basico: {
            ..._orderBump.basico,
            response: _orderBump.basico.response.map(cleanStep),
            payment_responses: {
              yape:
                _orderBump.basico.payment_responses.yape.map(cleanStep),
              bcp_transferencia:
                _orderBump.basico.payment_responses.bcp_transferencia.map(
                  cleanStep
                ),
              efectivo:
                _orderBump.basico.payment_responses.efectivo.map(cleanStep),
            },
            delivery: _orderBump.basico.delivery.map(cleanStep),
          },
        },
        doble_oferta_dos: {
          ..._dobleOfertaDos,
          enabled: _active === "doble_oferta_dos",
          combo: {
            ..._dobleOfertaDos.combo,
            response: _dobleOfertaDos.combo.response.map(cleanStep),
            payment_responses: {
              yape: _dobleOfertaDos.combo.payment_responses.yape.map(
                cleanStep
              ),
              bcp_transferencia:
                _dobleOfertaDos.combo.payment_responses.bcp_transferencia.map(
                  cleanStep
                ),
              efectivo:
                _dobleOfertaDos.combo.payment_responses.efectivo.map(
                  cleanStep
                ),
            },
            delivery: _dobleOfertaDos.combo.delivery.map(cleanStep),
          },
          basico: {
            ..._dobleOfertaDos.basico,
            response: _dobleOfertaDos.basico.response.map(cleanStep),
            payment_responses: {
              yape: _dobleOfertaDos.basico.payment_responses.yape.map(
                cleanStep
              ),
              bcp_transferencia:
                _dobleOfertaDos.basico.payment_responses.bcp_transferencia.map(
                  cleanStep
                ),
              efectivo:
                _dobleOfertaDos.basico.payment_responses.efectivo.map(
                  cleanStep
                ),
            },
            delivery: _dobleOfertaDos.basico.delivery.map(cleanStep),
          },
        },
      };
      const res = await fetch("/api/workflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(clean),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Error al guardar");
      // Ya no hay cambios pendientes: el estado actual pasa a ser el "guardado".
      setCfg(clean);
      setBaseline(JSON.stringify(clean));
      if (data.persisted) {
        setToast({
          ok: true,
          msg: "✅ Guardado y publicado (permanente). El bot ya usa los cambios.",
        });
      } else if (data.tokenConfigured) {
        // La publicación a GitHub FALLÓ (repo equivocado, token sin permiso…).
        // En vez de un toast que se va, mostramos un CUADRO que se queda hasta
        // que le des "Entendido" → imposible que se te pase.
        setPublishBlocked(
          data.publishError ?? "No se pudo publicar tu cambio en GitHub."
        );
      } else {
        setToast({
          ok: true,
          msg: "Guardado en vivo (temporal). Falta el token de GitHub para que sea permanente.",
        });
      }
    } catch (err) {
      setToast({
        ok: false,
        msg: err instanceof Error ? err.message : "Error al guardar",
      });
    } finally {
      setSaving(false);
    }
  }

  function cleanStep(s: EditorStep): EditorStep {
    return { ...s, texts: s.texts.filter((t) => t.trim().length > 0) };
  }

  function cleanChannelContent(
    content: ChannelContentEditor | undefined
  ): ChannelContentEditor | undefined {
    if (!content) return undefined;
    return {
      intro_groups: (content.intro_groups ?? []).map((group) => ({
        name: group.name ?? "",
        enabled: group.enabled !== false,
        weight:
          typeof group.weight === "number" && Number.isFinite(group.weight)
            ? Math.max(1, Math.floor(group.weight))
            : 1,
        adName: group.adName ?? "",
        adId: group.adId ?? "",
        steps: (group.steps ?? []).map(cleanStep),
      })),
      followups: (content.followups ?? []).map((followup) => ({
        ...followup,
        steps: (followup.steps ?? []).map(cleanStep),
        variants: (followup.variants ?? []).map((variant) => ({
          ...variant,
          steps: (variant.steps ?? []).map(cleanStep),
        })),
      })),
      payment: (content.payment ?? []).map(cleanStep),
      delivery: (content.delivery ?? []).map(cleanStep),
      delivery_groups: (content.delivery_groups ?? []).map((group) => ({
        key: group.key ?? "",
        name: group.name ?? "",
        enabled: group.enabled !== false,
        steps: (group.steps ?? []).map(cleanStep),
      })),
      post_sale: content.post_sale
        ? {
            whatsappPreference: content.post_sale.whatsappPreference ?? "",
            deliveryUsage: content.post_sale.deliveryUsage ?? "",
            lifetimeAccess: content.post_sale.lifetimeAccess ?? "",
            farewells: content.post_sale.farewells ?? "",
          }
        : undefined,
    };
  }

  function cleanChannelModalities(
    templates: Partial<Record<Modo, ChannelContentEditor>> | undefined
  ): Partial<Record<Modo, ChannelContentEditor>> {
    const out: Partial<Record<Modo, ChannelContentEditor>> = {};
    for (const mode of Object.keys(MODALIDAD_LABEL) as Modo[]) {
      const cleaned = cleanChannelContent(templates?.[mode]);
      if (cleaned) out[mode] = cleaned;
    }
    return out;
  }

  function selectedCountryProfile(c: FullConfig): CountryPaymentProfileEditor {
    const saved = c.payment_profiles_by_country?.[selectedPaymentCountry];
    return mergeCountryPaymentProfileForEditor(
      selectedPaymentCountry,
      c,
      saved
    );
  }

  function setCountryProfile(
    country: CountryCode,
    profile: CountryPaymentProfileEditor
  ) {
    if (!cfg) return;
    setCfg({
      ...cfg,
      country_sales_enabled: {
        ...(cfg.country_sales_enabled ?? {}),
        [country]: profile.enabled !== false,
      },
      payment_profiles_by_country: {
        ...(cfg.payment_profiles_by_country ?? {}),
        [country]: profile,
      },
    });
  }

  function setBasePaymentCountry(country: CountryCode) {
    if (!cfg) return;
    editSnapshot("pais_base_pago");
    setSelectedPaymentCountry(country);
    const profile =
      country !== "PE" && !cfg.payment_profiles_by_country?.[country]
        ? createReferenceCountryPaymentProfile(country, cfg)
        : null;
    setCfg({
      ...cfg,
      country,
      ...(profile
        ? {
            country_sales_enabled: {
              ...(cfg.country_sales_enabled ?? {}),
              [country]: profile.enabled !== false,
            },
            payment_profiles_by_country: {
              ...(cfg.payment_profiles_by_country ?? {}),
              [country]: profile,
            },
          }
        : {}),
    });
  }

  function setSelectedCountryProfile(
    updater: (profile: CountryPaymentProfileEditor) => CountryPaymentProfileEditor
  ) {
    if (!cfg) return;
    const next = updater(selectedCountryProfile(cfg));
    setCountryProfile(selectedPaymentCountry, next);
  }

  function setSelectedPaymentButtons(next: PaymentButtonEditor[]) {
    if (!cfg) return;
    if (selectedPaymentCountry === "PE") {
      setCfg({ ...cfg, payment_buttons: next });
      return;
    }
    setSelectedCountryProfile((profile) => ({
      ...profile,
      payment_buttons: next,
    }));
  }

  function setSelectedNormalPrice(value: number) {
    if (!cfg) return;
    if (selectedPaymentCountry === "PE") {
      const existingPeruProfile = cfg.payment_profiles_by_country?.PE;
      setCfg({
        ...cfg,
        globals: { ...cfg.globals, course_price_soles: value },
        order_bump: {
          ...cfg.order_bump,
          basico: { ...cfg.order_bump.basico, price_soles: value },
        },
        payment_profiles_by_country: existingPeruProfile
          ? {
              ...(cfg.payment_profiles_by_country ?? {}),
              PE: { ...existingPeruProfile, course_price_soles: value },
            }
          : cfg.payment_profiles_by_country,
      });
      return;
    }
    setSelectedCountryProfile((profile) => ({
      ...profile,
      course_price_soles: value,
    }));
  }

  const paymentEditorCountry = cfg
    ? COUNTRY_OPTIONS.find((item) => item.code === selectedPaymentCountry) ??
      COUNTRY_OPTIONS[0]
    : COUNTRY_OPTIONS[0];
  const editingPeruPayments = selectedPaymentCountry === "PE";
  const countryProfileForPaymentEditor = cfg
    ? selectedCountryProfile(cfg)
    : null;
  const paymentTextForSelectedCountry =
    cfg && editingPeruPayments
      ? cfg.payment_text
      : countryProfileForPaymentEditor?.payment_text ?? "";
  const paymentButtonsForSelectedCountry =
    cfg && editingPeruPayments
      ? cfg.payment_buttons
      : countryProfileForPaymentEditor?.payment_buttons ?? [];
  const paymentPriceForSelectedCountry =
    cfg && editingPeruPayments
      ? cfg.globals.course_price_soles
      : countryProfileForPaymentEditor?.course_price_soles || 0;
  const paymentResponseBlocks =
    cfg && editingPeruPayments
      ? ([
          ["yape", "Yape / Plin", cfg.payment_methods.yape],
          [
            "bcp_transferencia",
            "BCP / Transferencia",
            cfg.payment_methods.bcp_transferencia,
          ],
          ["efectivo", "Efectivo", cfg.payment_methods.efectivo],
        ] as [string, string, EditorStep[]][])
      : paymentButtonsForSelectedCountry.map((button, index) => {
          const method = button.method || `metodo_${index + 1}`;
          return [
            method,
            button.label || method,
            countryProfileForPaymentEditor?.payment_responses?.[method] ?? [],
          ] as [string, string, EditorStep[]];
        });
  const placeholderOptions = useMemo(
    () => placeholderOptionsFromConfig(cfg),
    [cfg?.custom_placeholders]
  );
  const editorPreviewContext = useMemo(
    () => (cfg ? previewContextFromConfig(cfg) : {}),
    [cfg]
  );

  return (
    <PlaceholderOptionsContext.Provider value={placeholderOptions}>
    <EditorPreviewContext.Provider value={editorPreviewContext}>
    <div className="min-h-screen bg-neutral-200">
      <GlobalPlaceholderAutocomplete />
      <header className="sticky top-0 z-10 border-b border-neutral-300 bg-white">
        <div className="flex items-center justify-between px-4 py-3">
          <div>
            <h1 className="text-lg font-bold text-neutral-900">
              Editor de Flujo
            </h1>
            <p className="text-xs text-neutral-500">
              Edita el recorrido del bot
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="mr-4 inline-flex rounded-md border border-neutral-200 bg-white text-xs">
              <Link
                href="/"
                className="px-3 py-1.5 text-neutral-700 hover:bg-neutral-50"
              >
                Chats
              </Link>
              <Link
                href="/kanban"
                className="px-3 py-1.5 text-neutral-700 hover:bg-neutral-50"
              >
                Kanban
              </Link>
            </div>
            <button
              type="button"
              onClick={undo}
              disabled={history.length === 0}
              title="Deshacer el último cambio"
              className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-40"
            >
              ↶ Deshacer{history.length ? ` (${history.length})` : ""}
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving || !cfg || !isDirty}
              title={
                isDirty ? "Hay cambios sin guardar" : "No hay cambios por guardar"
              }
              className="rounded-md bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? "Guardando…" : isDirty ? "💾 Guardar *" : "💾 Guardar"}
            </button>
          </div>
        </div>
        <nav className="flex gap-1 px-4">
          <Link
            href="/"
            className="border-b-2 border-transparent px-3 py-2 text-sm text-neutral-500 hover:text-neutral-800"
          >
            Chat
          </Link>
          {(
            [
              ["intro", "Intro"],
              ["seguimientos", "Seguimientos"],
              ["salesbot", "Salesbot"],
              ["canales", "Canales"],
              ["regalo", "Regalo"],
              ["pago", "Precios y pagos"],
              ["entrega", "Entrega"],
              ["bioferta", "Doble Oferta"],
              ["orderbump", "Order Bump"],
              ["dobleoferta2", "Doble Oferta 2 Prod"],
              ["contenido", "📚 Contenido"],
              ["cerebro", "Cerebro"],
              ["ajustes", "Ajustes"],
            ] as [Tab, string][]
          )
            .filter(([key]) => {
              // Pestañas de OFERTA: solo visibles si su modalidad está activa.
              // Las demás se ocultan, pero su contenido se conserva.
              if (!cfg) return true;
              if (key === "orderbump") return cfg.order_bump.enabled;
              if (key === "bioferta") return cfg.bioferta.enabled;
              if (key === "dobleoferta2") return cfg.doble_oferta_dos.enabled;
              return true;
            })
            .map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`border-b-2 px-3 py-2 text-sm ${
                tab === key
                  ? "border-emerald-600 font-medium text-emerald-700"
                  : "border-transparent text-neutral-500 hover:text-neutral-800"
              }`}
            >
              {label}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2 self-center pr-3">
            <span className="text-xs font-medium text-neutral-500">
              Modalidad:
            </span>
            <select
              value={cfg ? activeModality(cfg) : "lineal"}
              onChange={(e) => selectModalidad(e.target.value as Modo)}
              className="rounded-md border border-emerald-400 bg-white px-2 py-1 text-sm font-semibold text-emerald-700"
              title="Modalidad de venta activa — elige aquí"
            >
              <option value="lineal">Lineal</option>
              <option value="order_bump">Order Bump</option>
              <option value="bioferta">Doble Oferta</option>
              <option value="doble_oferta_dos">Doble Oferta 2 Prod</option>
            </select>
            <button
              type="button"
              onClick={() => setShowPlaceholders((v) => !v)}
              className={`rounded-md border px-3 py-1 text-sm font-semibold ${
                showPlaceholders
                  ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                  : "border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50"
              }`}
            >
              Comodines {showPlaceholders ? "▲" : "▼"}
            </button>
          </div>
        </nav>
        {showPlaceholders && <PlaceholderHelp />}
      </header>

      {toast && (
        <div
          role="status"
          aria-live="polite"
          onClick={toast.ok ? () => setToast(null) : undefined}
          title={toast.ok ? "Clic para cerrar" : undefined}
          className={`fixed left-1/2 top-32 z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 rounded-xl border px-5 py-4 text-center text-base font-semibold shadow-2xl ${
            toast.ok
              ? "cursor-pointer border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          <div>{toast.msg}</div>
          {!toast.ok && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setToast(null);
              }}
              className="mt-3 rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800"
            >
              Aceptar
            </button>
          )}
        </div>
      )}

      {/* CUADRO (modal) cuando el guardado NO se pudo publicar a GitHub. Se
          queda hasta que le des "Entendido" → no se te pasa como el toast. */}
      {publishBlocked && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
            <div className="mb-2 text-3xl">🚫</div>
            <h3 className="mb-2 text-lg font-semibold text-neutral-900">
              Tus cambios NO se guardaron de forma permanente
            </h3>
            <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {publishBlocked}
            </p>
            <p className="mb-4 text-xs text-neutral-500">
              Se guardó en vivo, pero <strong>NO se subió a GitHub</strong> → se
              perderá al redeployar. Corrige el repo/token en tu hosting, vuelve
              a guardar, y cuando veas el aviso <strong>verde</strong> sabrás que
              quedó bien.
            </p>
            <button
              type="button"
              onClick={() => setPublishBlocked(null)}
              className="w-full rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-neutral-800"
            >
              Entendido
            </button>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-3xl px-4 py-6">
        {loadError && (
          <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
            {loadError}
          </div>
        )}
        {!cfg && !loadError && (
          <p className="text-sm text-neutral-500">Cargando…</p>
        )}

        {cfg && tab === "intro" && (
          <section key={activeModality(cfg)} className="space-y-6">
            <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
              ✏️ Editando el intro de:{" "}
              <span className="underline">
                {MODALIDAD_LABEL[activeModality(cfg)]}
              </span>
              . Cada modalidad tiene su propio intro — cambia la modalidad en el
              selector de arriba a la derecha para editar el de otra.
            </div>
            <p className="text-sm text-neutral-600">
              Mensaje de bienvenida tras el saludo. Cada intro tiene su{" "}
              <strong>interruptor</strong>: el bot reparte al azar entre las que
              estén <strong>ON</strong> (y completas). Si ninguna está ON, usa la
              Intro 1.
            </p>

            {(() => {
              const _active = activeModality(cfg);
              const _tpl = cfg.modality_templates?.[_active] ?? {};
              const campaignName = _tpl.campaign_name ?? cfg.campaign_name ?? "";
              return (
                <label className="block">
                  <span className="mb-2 block text-lg font-semibold text-neutral-900">
                    Nombre de la campaña
                  </span>
                  <input
                    type="text"
                    value={campaignName}
                    onChange={(e) => {
                      editSnapshot("campaign_name");
                      setCfg({
                        ...cfg,
                        modality_templates: {
                          ...cfg.modality_templates,
                          [_active]: {
                            ...(cfg.modality_templates?.[_active] ?? {}),
                            campaign_name: e.target.value,
                          },
                        },
                      });
                    }}
                    className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-semibold text-neutral-900 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    placeholder="Ej: Campaña 1"
                  />
                </label>
              );
            })()}

            <Collapsible title="Saludo inicial">
              <p className="mb-3 text-xs text-neutral-500">
                El PRIMER mensaje que recibe el cliente (normalmente pide su
                nombre). Si pones varias variantes, el bot elige una al azar.
              </p>
              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  {cfg.greeting.texts.map((t, i) => (
                    <div key={i} className="mb-2 flex items-start gap-2">
                      <textarea
                        rows={2}
                        value={t}
                        onChange={(e) => {
                          const next = [...cfg.greeting.texts];
                          next[i] = e.target.value;
                          setCfg({
                            ...cfg,
                            greeting: { ...cfg.greeting, texts: next },
                          });
                        }}
                        onFocus={() => editSnapshot(`greeting_${i}`)}
                        className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
                        placeholder="Ej: ¡Hola! 😊 ¿Con quién tengo el gusto?"
                      />
                      {cfg.greeting.texts.length > 1 && (
                        <button
                          type="button"
                          onClick={() => {
                            snapshot();
                            setCfg({
                              ...cfg,
                              greeting: {
                                ...cfg.greeting,
                                texts: cfg.greeting.texts.filter(
                                  (_, j) => j !== i
                                ),
                              },
                            });
                          }}
                          className="rounded border border-neutral-300 px-2 py-2 text-sm text-neutral-500 hover:bg-neutral-100"
                        >
                          🗑️
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <div className="lg:sticky lg:top-4 lg:self-start">
                  <ChatPreview
                    steps={[
                      {
                        type: "text",
                        drive_url: "",
                        texts: cfg.greeting.texts,
                        delay_after_sec: 0,
                      },
                    ]}
                    priceSoles={cfg.globals.course_price_soles}
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  snapshot();
                  setCfg({
                    ...cfg,
                    greeting: {
                      ...cfg.greeting,
                      texts: [...cfg.greeting.texts, ""],
                    },
                  });
                }}
                className="mt-1 rounded border border-neutral-300 px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-100"
              >
                + Agregar variación
              </button>
              <label className="mt-4 flex items-center gap-3 border-t border-neutral-200 pt-3">
                <input
                  type="checkbox"
                  checked={cfg.greeting.skip_ask_name === true}
                  onChange={(e) =>
                    setCfg({
                      ...cfg,
                      greeting: {
                        ...cfg.greeting,
                        skip_ask_name: e.target.checked,
                      },
                    })
                  }
                  className="h-5 w-5"
                />
                <span className="text-sm font-medium text-neutral-900">
                  No preguntar el nombre: lanzar la intro de inmediato con el
                  primer mensaje del cliente
                </span>
              </label>
            </Collapsible>

            {Array.from(
              {
                length:
                  3 +
                  (cfg.modality_templates?.[activeModality(cfg)]
                    ?.intro_extra_sequences?.length ?? 0),
              },
              (_, idx) => idx
            ).map((idx) => {
              // PÁGINA DIRECTA: el intro se lee/escribe en la plantilla de la
              // modalidad ACTIVA (sin swap). Cambiar de modalidad = ver otra página.
              const _active = activeModality(cfg);
              const _tpl = cfg.modality_templates?.[_active];
              const _extraIntros = _tpl?.intro_extra_sequences ?? [];
              const visibleIntroIndices = Array.from(
                { length: 3 + _extraIntros.length },
                (_, j) => j
              ).filter(
                (j) =>
                  j === 0 ||
                  j >= 3 ||
                  Object.prototype.hasOwnProperty.call(
                    _tpl ?? {},
                    j === 1 ? "intro_sequence_2" : "intro_sequence_3"
                  )
              );
              const visibleIntroIndex = visibleIntroIndices.indexOf(idx);
              const applyIntroMove = (to: number) => {
                const nextTpl = moveIntroItem(_tpl, visibleIntroIndex, to);
                if (!nextTpl) return;
                snapshot();
                try {
                  localStorage.setItem(
                    `wf:collapsible:Intro ${visibleIntroIndex + 1}`,
                    "0"
                  );
                  localStorage.setItem(`wf:collapsible:Intro ${to + 1}`, "1");
                } catch {}
                setIntroOpenMove({
                  from: visibleIntroIndex,
                  to,
                  nonce: Date.now(),
                });
                setCfg({
                  ...cfg,
                  modality_templates: {
                    ...cfg.modality_templates,
                    [_active]: nextTpl,
                  },
                });
              };
              const sectionExists =
                idx === 0 ||
                idx >= 3 ||
                Object.prototype.hasOwnProperty.call(
                  _tpl ?? {},
                  idx === 1 ? "intro_sequence_2" : "intro_sequence_3"
                );
              if (!sectionExists) return null;
              const steps =
                idx === 0
                  ? _tpl?.intro_sequence ?? []
                  : idx === 1
                    ? _tpl?.intro_sequence_2 ?? []
                    : idx === 2
                      ? _tpl?.intro_sequence_3 ?? []
                      : _extraIntros[idx - 3] ?? [];
              const setSteps = (s: EditorStep[]) => {
                const patch =
                  idx === 0
                    ? { intro_sequence: s }
                    : idx === 1
                      ? { intro_sequence_2: s }
                      : idx === 2
                        ? { intro_sequence_3: s }
                        : {
                            intro_extra_sequences: _extraIntros.map((steps, i) =>
                              i === idx - 3 ? s : steps
                            ),
                          };
                setCfg({
                  ...cfg,
                  modality_templates: {
                    ...cfg.modality_templates,
                    [_active]: {
                      ...(cfg.modality_templates?.[_active] ?? {}),
                      ...patch,
                    },
                  },
                });
              };
              const enabled = (_tpl?.intro_enabled?.[idx] ?? false) === true;
              const introWeight =
                typeof _tpl?.intro_weights?.[idx] === "number" &&
                Number.isFinite(_tpl.intro_weights[idx]) &&
                _tpl.intro_weights[idx] > 0
                  ? _tpl.intro_weights[idx]
                  : 1;
              const campaignName = _tpl?.campaign_name ?? cfg.campaign_name ?? "";
              const customIntroName = _tpl?.intro_names?.[idx] ?? "";
              const adName = _tpl?.intro_ad_names?.[idx] ?? "";
              const adId = _tpl?.intro_ad_ids?.[idx] ?? "";
              const introTitle = (
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <input
                    type="text"
                    value={customIntroName}
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      editSnapshot(`introname${idx}`);
                      const next = [...(_tpl?.intro_names ?? [])];
                      next[idx] = e.target.value;
                      setCfg({
                        ...cfg,
                        modality_templates: {
                          ...cfg.modality_templates,
                          [_active]: {
                            ...(cfg.modality_templates?.[_active] ?? {}),
                            intro_names: next,
                          },
                        },
                      });
                    }}
                    className="min-w-0 flex-1 rounded-md border border-transparent bg-white/70 px-2 py-1 text-base font-bold text-neutral-900 placeholder:text-neutral-500 focus:border-emerald-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    placeholder="Nombre de la intro"
                    aria-label={`Nombre de Intro ${idx + 1}`}
                  />
                  <span className="shrink-0 text-xs font-semibold text-neutral-500">
                    (Intro {idx + 1})
                  </span>
                  {!enabled && (
                    <span className="rounded border border-neutral-600 bg-neutral-400 px-2 py-0.5 text-[10px] font-bold tracking-wide text-neutral-900">
                      DESHABILITADO
                    </span>
                  )}
                </span>
              );
              return (
                <div
                  key={idx}
                  onDragOver={(e) => {
                    if (
                      dragIntroIndex !== null &&
                      dragIntroIndex !== visibleIntroIndex
                    ) {
                      e.preventDefault();
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (
                      dragIntroIndex === null ||
                      dragIntroIndex === visibleIntroIndex
                    ) {
                      return;
                    }
                    applyIntroMove(visibleIntroIndex);
                    setDragIntroIndex(null);
                  }}
                  className={
                    dragIntroIndex !== null &&
                    dragIntroIndex !== visibleIntroIndex
                      ? "rounded-lg outline outline-2 outline-dashed outline-sky-300"
                      : undefined
                  }
                >
                  <Collapsible
                    title={introTitle}
                    titleKey={`Intro ${idx + 1}`}
                    titleClassName={
                      enabled
                        ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                        : "border-neutral-500 bg-neutral-300 text-neutral-900"
                    }
                    bodyClassName={enabled ? undefined : "bg-neutral-300"}
                    defaultOpen={idx === 0}
                    openSignal={
                      introOpenMove?.to === visibleIntroIndex
                        ? introOpenMove.nonce
                        : undefined
                    }
                    closeSignal={
                      introOpenMove?.from === visibleIntroIndex
                        ? introOpenMove.nonce
                        : undefined
                    }
                  >
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = "move";
                          setDragIntroIndex(visibleIntroIndex);
                        }}
                        onDragEnd={() => setDragIntroIndex(null)}
                        title="Arrastrar para reordenar intros"
                        className="cursor-grab rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50 active:cursor-grabbing"
                      >
                        ⋮⋮
                      </button>
                      <button
                        type="button"
                        onClick={() => applyIntroMove(visibleIntroIndex - 1)}
                        disabled={visibleIntroIndex <= 0}
                        title="Subir intro"
                        className="rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50 disabled:opacity-30"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => applyIntroMove(visibleIntroIndex + 1)}
                        disabled={visibleIntroIndex >= visibleIntroIndices.length - 1}
                        title="Bajar intro"
                        className="rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50 disabled:opacity-30"
                      >
                        ↓
                      </button>
                      {/* Duplicar desde CUALQUIER otra intro con contenido (no solo
                        la 1): un botón por cada intro fuente disponible. */}
                      {Array.from(
                        { length: 3 + _extraIntros.length },
                        (_, j) => j
                      )
                        .filter((j) => j !== idx)
                        .map((j) => {
                          const srcSteps =
                            j === 0
                              ? _tpl?.intro_sequence ?? []
                              : j === 1
                                ? _tpl?.intro_sequence_2 ?? []
                                : j === 2
                                  ? _tpl?.intro_sequence_3 ?? []
                                  : _extraIntros[j - 3] ?? [];
                          if (srcSteps.length === 0) return null;
                          return (
                            <button
                              key={j}
                              type="button"
                              onClick={() => {
                                if (
                                  steps.length > 0 &&
                                  !confirm(
                                    `Esto reemplaza la Intro ${idx + 1} con una copia de la Intro ${j + 1}. ¿Continuar?`
                                  )
                                )
                                  return;
                                snapshot();
                                const copy = srcSteps.map((s) => ({
                                  ...s,
                                  texts: [...s.texts],
                                }));
                                setSteps(copy);
                              }}
                              className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50"
                            >
                              ⧉ Duplicar de Intro {j + 1}
                            </button>
                          );
                        })}
                      {idx > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            if (
                              !confirm(
                                `Esto eliminará la sección Intro ${idx + 1}. ¿Continuar?`
                              )
                            )
                              return;
                            snapshot();
                            const ne = [...(_tpl?.intro_enabled ?? [])];
                            ne[idx] = false;
                            const nextTpl = {
                              ...(cfg.modality_templates?.[_active] ?? {}),
                              intro_enabled: ne,
                            };
                            if (idx === 1) {
                              delete nextTpl.intro_sequence_2;
                            } else if (idx === 2) {
                              delete nextTpl.intro_sequence_3;
                            } else {
                              const nextExtra = [
                                ...(nextTpl.intro_extra_sequences ?? []),
                              ];
                              const nextWeights = [
                                ...(nextTpl.intro_weights ?? []),
                              ];
                              const nextNames = [
                                ...(nextTpl.intro_names ?? []),
                              ];
                              const nextAdNames = [
                                ...(nextTpl.intro_ad_names ?? []),
                              ];
                              const nextAdIds = [
                                ...(nextTpl.intro_ad_ids ?? []),
                              ];
                              nextExtra.splice(idx - 3, 1);
                              ne.splice(idx, 1);
                              nextWeights.splice(idx, 1);
                              nextNames.splice(idx, 1);
                              nextAdNames.splice(idx, 1);
                              nextAdIds.splice(idx, 1);
                              nextTpl.intro_extra_sequences = nextExtra;
                              nextTpl.intro_weights = nextWeights;
                              nextTpl.intro_names = nextNames;
                              nextTpl.intro_ad_names = nextAdNames;
                              nextTpl.intro_ad_ids = nextAdIds;
                            }
                            setCfg({
                              ...cfg,
                              modality_templates: {
                                ...cfg.modality_templates,
                                [_active]: nextTpl,
                              },
                            });
                          }}
                          className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700 hover:bg-red-100"
                        >
                          Eliminar Intro {idx + 1}
                        </button>
                      )}
                      <div className="basis-full flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            editSnapshot(`introtoggle${idx}`);
                            const ne = [...(_tpl?.intro_enabled ?? [])];
                            ne[idx] = !enabled;
                            setCfg({
                              ...cfg,
                              modality_templates: {
                                ...cfg.modality_templates,
                                [_active]: {
                                  ...(cfg.modality_templates?.[_active] ?? {}),
                                  intro_enabled: ne,
                                },
                              },
                            });
                          }}
                          title={
                            enabled
                              ? "Activa (entra al reparto)"
                              : "Apagada (no se envía)"
                          }
                          className={`rounded-full px-4 py-1.5 text-xs font-semibold ${
                            enabled
                              ? "bg-emerald-600 text-white"
                              : "bg-neutral-200 text-neutral-600"
                          }`}
                        >
                          {enabled ? "ON" : "OFF"}
                        </button>
                        <label className="flex items-center gap-2 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs text-neutral-700">
                          <span className="font-medium">Peso</span>
                          <input
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            value={introWeight}
                            onChange={(e) => {
                              editSnapshot(`introweight${idx}`);
                              const digits = e.target.value.replace(/\D/g, "");
                              const nextWeight = Math.max(
                                1,
                                Math.floor(Number(digits) || 1)
                              );
                              const nw = [...(_tpl?.intro_weights ?? [])];
                              nw[idx] = nextWeight;
                              setCfg({
                                ...cfg,
                                modality_templates: {
                                  ...cfg.modality_templates,
                                  [_active]: {
                                    ...(cfg.modality_templates?.[_active] ?? {}),
                                    intro_weights: nw,
                                  },
                                },
                              });
                            }}
                            className="w-14 rounded border border-neutral-300 px-2 py-1 text-right text-xs font-semibold text-neutral-900 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                            title="Peso de reparto de esta intro"
                          />
                          <span className="font-semibold text-neutral-500">%</span>
                        </label>
                        {campaignName.trim() && (
                          <span className="ml-auto rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm font-semibold text-neutral-800">
                            {campaignName.trim()}
                          </span>
                        )}
                      </div>
                      <div className="basis-full grid gap-2 md:grid-cols-2">
                        <label className="block">
                          <span className="mb-1 block text-[11px] font-medium text-neutral-500">
                            Nombre del AD
                          </span>
                          <input
                            type="text"
                            value={adName}
                            onChange={(e) => {
                              editSnapshot(`introadname${idx}`);
                              const next = [...(_tpl?.intro_ad_names ?? [])];
                              next[idx] = e.target.value;
                              setCfg({
                                ...cfg,
                                modality_templates: {
                                  ...cfg.modality_templates,
                                  [_active]: {
                                    ...(cfg.modality_templates?.[_active] ?? {}),
                                    intro_ad_names: next,
                                  },
                                },
                              });
                            }}
                            className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-xs text-neutral-700 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                            placeholder="Ej: AD 1"
                          />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-[11px] font-medium text-neutral-500">
                            ID del anuncio
                          </span>
                          <input
                            type="text"
                            value={adId}
                            onChange={(e) => {
                              editSnapshot(`introadid${idx}`);
                              const next = [...(_tpl?.intro_ad_ids ?? [])];
                              next[idx] = e.target.value;
                              setCfg({
                                ...cfg,
                                modality_templates: {
                                  ...cfg.modality_templates,
                                  [_active]: {
                                    ...(cfg.modality_templates?.[_active] ?? {}),
                                    intro_ad_ids: next,
                                  },
                                },
                              });
                            }}
                            className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-xs text-neutral-700 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                            placeholder="ID de Meta"
                          />
                        </label>
                      </div>
                  </div>
                  {idx > 0 && steps.length === 0 && (
                    <p className="mb-2 text-xs text-neutral-500">
                      Vacía. Duplica de otra Intro (botones arriba) o agrega pasos
                      abajo.
                    </p>
                  )}
                  <StepEditorPreviewPair
                    steps={steps}
                    onChange={setSteps}
                    onSnapshot={snapshot}
                    onEdit={editSnapshot}
                    idPrefix={`intro${idx + 1}`}
                    priceSoles={cfg.globals.course_price_soles}
                    className={enabled ? undefined : "rounded-md bg-neutral-300 p-3"}
                  />
                </Collapsible>
                </div>
              );
            })}
            {(() => {
              const _active = activeModality(cfg);
              const _tpl = cfg.modality_templates?.[_active];
              const missing = [1, 2].filter(
                (idx) =>
                  !Object.prototype.hasOwnProperty.call(
                    _tpl ?? {},
                    idx === 1 ? "intro_sequence_2" : "intro_sequence_3"
                  )
              );
              if (missing.length === 0) return null;
              return (
                <div className="flex flex-wrap gap-2 rounded-lg border border-dashed border-neutral-300 bg-neutral-50 p-3">
                  {missing.map((idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        snapshot();
                        const ne = [...(_tpl?.intro_enabled ?? [])];
                        const nw = [...(_tpl?.intro_weights ?? [])];
                        const nn = [...(_tpl?.intro_names ?? [])];
                        const nan = [...(_tpl?.intro_ad_names ?? [])];
                        const nai = [...(_tpl?.intro_ad_ids ?? [])];
                        ne[idx] = false;
                        nw[idx] = nw[idx] ?? 1;
                        nn[idx] = nn[idx] ?? "";
                        nan[idx] = nan[idx] ?? "";
                        nai[idx] = nai[idx] ?? "";
                        setCfg({
                          ...cfg,
                          modality_templates: {
                            ...cfg.modality_templates,
                            [_active]: {
                              ...(cfg.modality_templates?.[_active] ?? {}),
                              ...(idx === 1
                                ? { intro_sequence_2: [] }
                                : { intro_sequence_3: [] }),
                              intro_enabled: ne,
                              intro_weights: nw,
                              intro_names: nn,
                              intro_ad_names: nan,
                              intro_ad_ids: nai,
                            },
                          },
                        });
                      }}
                      className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-100"
                    >
                      + Agregar Intro {idx + 1}
                    </button>
                  ))}
                </div>
              );
            })()}
            {(() => {
              const _active = activeModality(cfg);
              const _tpl = cfg.modality_templates?.[_active];
              const extra = _tpl?.intro_extra_sequences ?? [];
              const nextIdx = 3 + extra.length;
              return (
                <div className="flex flex-wrap gap-2 rounded-lg border border-dashed border-neutral-300 bg-neutral-50 p-3">
                  <button
                    type="button"
                    onClick={() => {
                      snapshot();
                      const ne = [...(_tpl?.intro_enabled ?? [])];
                      const nw = [...(_tpl?.intro_weights ?? [])];
                      const nn = [...(_tpl?.intro_names ?? [])];
                      const nan = [...(_tpl?.intro_ad_names ?? [])];
                      const nai = [...(_tpl?.intro_ad_ids ?? [])];
                      ne[nextIdx] = false;
                      nw[nextIdx] = 1;
                      nn[nextIdx] = "";
                      nan[nextIdx] = "";
                      nai[nextIdx] = "";
                      setCfg({
                        ...cfg,
                        modality_templates: {
                          ...cfg.modality_templates,
                          [_active]: {
                            ...(cfg.modality_templates?.[_active] ?? {}),
                            intro_extra_sequences: [...extra, []],
                            intro_enabled: ne,
                            intro_weights: nw,
                            intro_names: nn,
                            intro_ad_names: nan,
                            intro_ad_ids: nai,
                          },
                        },
                      });
                    }}
                    className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-100"
                  >
                    + Agregar Intro {nextIdx + 1}
                  </button>
                </div>
              );
            })()}
            {activeModality(cfg) === "doble_oferta_dos" && (
              <DobleOfertaChoiceMenu
                value={cfg.doble_oferta_dos}
                onChange={(dobleOferta) =>
                  setCfg({ ...cfg, doble_oferta_dos: dobleOferta })
                }
                onEdit={() => editSnapshot("intro:doble_choice")}
              />
            )}
            <FollowupPaymentMenu
              menu={cfg.intro_payment_menu}
              buttonsPrompt={cfg.payment_buttons_prompt}
              buttons={cfg.payment_buttons}
              onChange={(menu) =>
                setCfg({ ...cfg, intro_payment_menu: menu })
              }
              onEdit={() => editSnapshot("intro:paymenu")}
              title="💳 Menú de pago al final del intro"
              where="el intro"
            />
          </section>
        )}

        {cfg && tab === "seguimientos" && (
          <section className="space-y-6">
            <p className="text-sm text-neutral-600">
              Mensajes de recuperación para quien no compra. El{" "}
              <strong>delay (min)</strong> solo aplica al primer seguimiento;
              los demás se agendan por los horarios de la pestaña Ajustes.
            </p>
            {cfg.followups.map((f, fi) => {
              const followupDisabled = f.enabled === false;
              const followupVariants = f.variants ?? [];
              return (
              <div
                key={fi}
                className={`rounded-lg border p-4 ${
                  followupDisabled
                    ? "border-neutral-500 bg-neutral-300"
                    : "border-neutral-400 bg-white"
                }`}
              >
                <div
                  className={`mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 ${
                    followupDisabled
                      ? "border-neutral-500 bg-neutral-300 text-neutral-900"
                      : "border-emerald-300 bg-emerald-50 text-emerald-800"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={f.name}
                    onChange={(e) => {
                      editSnapshot(`fu${fi}:name`);
                      setCfg({
                        ...cfg,
                        followups: cfg.followups.map((x, i) =>
                          i === fi ? { ...x, name: e.target.value } : x
                        ),
                      });
                    }}
                    className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm font-semibold text-neutral-800"
                  />
                    {followupDisabled && (
                      <span className="rounded border border-neutral-600 bg-neutral-400 px-2 py-0.5 text-[10px] font-bold tracking-wide text-neutral-900">
                        DESHABILITADO
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-neutral-500">
                      Delay (min):
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={f.delay_minutes_from_first_message}
                      onChange={(e) => {
                        editSnapshot(`fu${fi}:delay`);
                        setCfg({
                          ...cfg,
                          followups: cfg.followups.map((x, i) =>
                            i === fi
                              ? {
                                  ...x,
                                  delay_minutes_from_first_message:
                                    Number(e.target.value) || 0,
                                }
                              : x
                          ),
                        });
                      }}
                      className="w-20 rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        editSnapshot(`fu${fi}:enabled`);
                        setCfg({
                          ...cfg,
                          followups: cfg.followups.map((x, i) =>
                            i === fi
                              ? { ...x, enabled: x.enabled === false }
                              : x
                          ),
                        });
                      }}
                      title={
                        followupDisabled
                          ? "Apagado: el bot no lo envía"
                          : "Encendido: el bot lo envía"
                      }
                      className={`rounded border px-2 py-1 text-xs font-semibold ${
                        followupDisabled
                          ? "border-neutral-300 bg-neutral-100 text-neutral-400"
                          : "border-emerald-300 bg-emerald-50 text-emerald-700"
                      }`}
                    >
                      {followupDisabled ? "OFF" : "ON"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (
                          !confirm(
                            `¿Quitar "${f.name}" completo? Puedes deshacerlo con ↶ Deshacer.`
                          )
                        )
                          return;
                        snapshot();
                        setCfg({
                          ...cfg,
                          followups: cfg.followups.filter((_, i) => i !== fi),
                        });
                      }}
                      className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                    >
                      🗑️ Quitar seguimiento
                    </button>
                  </div>
                </div>
                <div className="space-y-3">
                  <Collapsible
                    title={
                      <span className="flex flex-wrap items-center gap-2">
                        <span>Variante principal</span>
                        <span className="text-xs font-semibold text-neutral-500">
                          ({f.name || `seguimiento_${fi + 1}`})
                        </span>
                      </span>
                    }
                    titleKey={`followup:${fi}:variant:base`}
                    titleClassName={
                      followupDisabled
                        ? "border-neutral-500 bg-neutral-300 text-neutral-900"
                        : "border-emerald-300 bg-emerald-50 text-emerald-800"
                    }
                    bodyClassName={followupDisabled ? "bg-neutral-300" : undefined}
                    defaultOpen
                  >
                    <StepEditorPreviewPair
                      steps={f.steps}
                      onChange={(steps) =>
                        setCfg({
                          ...cfg,
                          followups: cfg.followups.map((x, i) =>
                            i === fi ? { ...x, steps } : x
                          ),
                        })
                      }
                      onSnapshot={snapshot}
                      onEdit={editSnapshot}
                      idPrefix={`fu${fi}`}
                      priceSoles={cfg.globals.course_price_soles}
                      className={
                        followupDisabled ? "rounded-md bg-neutral-300 p-3" : undefined
                      }
                    />
                  </Collapsible>
                  {followupVariants.map((variant, vi) => {
                    const variantDisabled = variant.enabled === false;
                    const variantVisuallyDisabled =
                      followupDisabled || variantDisabled;
                    const variantTitle = (
                      <span className="flex min-w-0 flex-1 items-center gap-2">
                        <input
                          type="text"
                          value={variant.name ?? ""}
                          onClick={(e) => e.stopPropagation()}
                          onMouseDown={(e) => e.stopPropagation()}
                          onKeyDown={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            editSnapshot(`fu${fi}:variant${vi}:name`);
                            const nextVariants = [...followupVariants];
                            nextVariants[vi] = {
                              ...nextVariants[vi],
                              name: e.target.value,
                            };
                            setCfg({
                              ...cfg,
                              followups: cfg.followups.map((x, i) =>
                                i === fi ? { ...x, variants: nextVariants } : x
                              ),
                            });
                          }}
                          className="min-w-0 flex-1 rounded-md border border-transparent bg-white/70 px-2 py-1 text-sm font-bold text-neutral-900 placeholder:text-neutral-500 focus:border-emerald-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
                          placeholder={`Nombre de variante ${vi + 2}`}
                          aria-label={`Nombre de variante ${vi + 2} de ${f.name}`}
                        />
                        <span className="shrink-0 text-xs font-semibold text-neutral-500">
                          (Variante {vi + 2})
                        </span>
                        {variantDisabled && (
                          <span className="rounded border border-neutral-600 bg-neutral-400 px-2 py-0.5 text-[10px] font-bold tracking-wide text-neutral-900">
                            DESHABILITADA
                          </span>
                        )}
                      </span>
                    );
                    return (
                      <Collapsible
                        key={vi}
                        title={variantTitle}
                        titleKey={`followup:${fi}:variant:${vi + 1}`}
                        titleClassName={
                          variantVisuallyDisabled
                            ? "border-neutral-500 bg-neutral-300 text-neutral-900"
                            : "border-sky-300 bg-sky-50 text-sky-800"
                        }
                        bodyClassName={
                          variantVisuallyDisabled ? "bg-neutral-300" : undefined
                        }
                      >
                        <div className="mb-3 flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              editSnapshot(`fu${fi}:variant${vi}:enabled`);
                              const nextVariants = [...followupVariants];
                              nextVariants[vi] = {
                                ...nextVariants[vi],
                                enabled: nextVariants[vi]?.enabled === false,
                              };
                              setCfg({
                                ...cfg,
                                followups: cfg.followups.map((x, i) =>
                                  i === fi ? { ...x, variants: nextVariants } : x
                                ),
                              });
                            }}
                            className={`rounded border px-2 py-1 text-xs font-semibold ${
                              variantDisabled
                                ? "border-neutral-300 bg-neutral-100 text-neutral-400"
                                : "border-emerald-300 bg-emerald-50 text-emerald-700"
                            }`}
                          >
                            {variantDisabled ? "OFF" : "ON"}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (
                                !confirm(
                                  `¿Quitar esta variante de "${f.name}"? Puedes deshacerlo con ↶ Deshacer.`
                                )
                              )
                                return;
                              snapshot();
                              setCfg({
                                ...cfg,
                                followups: cfg.followups.map((x, i) =>
                                  i === fi
                                    ? {
                                        ...x,
                                        variants: followupVariants.filter(
                                          (_, index) => index !== vi
                                        ),
                                      }
                                    : x
                                ),
                              });
                            }}
                            className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                          >
                            Quitar variante
                          </button>
                        </div>
                        <StepEditorPreviewPair
                          steps={variant.steps}
                          onChange={(steps) => {
                            const nextVariants = [...followupVariants];
                            nextVariants[vi] = { ...nextVariants[vi], steps };
                            setCfg({
                              ...cfg,
                              followups: cfg.followups.map((x, i) =>
                                i === fi ? { ...x, variants: nextVariants } : x
                              ),
                            });
                          }}
                          onSnapshot={snapshot}
                          onEdit={editSnapshot}
                          idPrefix={`fu${fi}:variant${vi}`}
                          priceSoles={cfg.globals.course_price_soles}
                          className={
                            variantVisuallyDisabled
                              ? "rounded-md bg-neutral-300 p-3"
                              : undefined
                          }
                        />
                      </Collapsible>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => {
                      snapshot();
                      setCfg({
                        ...cfg,
                        followups: cfg.followups.map((x, i) =>
                          i === fi
                            ? {
                                ...x,
                                variants: [
                                  ...(x.variants ?? []),
                                  {
                                    name: `variante_${(x.variants?.length ?? 0) + 2}`,
                                    enabled: true,
                                    steps: x.steps.map((step) => ({
                                      ...step,
                                      texts: [...step.texts],
                                    })),
                                  },
                                ],
                              }
                            : x
                        ),
                      });
                    }}
                    className="w-full rounded-md border-2 border-dashed border-sky-300 py-2 text-sm text-sky-700 hover:border-sky-500 hover:bg-sky-50"
                  >
                    + Agregar variante de este seguimiento
                  </button>
                </div>
                {fi < 2 && activeModality(cfg) === "doble_oferta_dos" && (
                  <div className="mt-4 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
                    <label className="mb-3 flex cursor-pointer items-center gap-2 text-sm text-neutral-700">
                      <input
                        type="checkbox"
                        checked={!!f.offer_choice_menu_enabled}
                        onChange={(e) => {
                          editSnapshot(`fu${fi}:offerchoice`);
                          setCfg({
                            ...cfg,
                            followups: cfg.followups.map((x, i) =>
                              i === fi
                                ? {
                                    ...x,
                                    offer_choice_menu_enabled: e.target.checked,
                                  }
                                : x
                            ),
                          });
                        }}
                      />
                      Enviar botones de eleccion de oferta al final de este seguimiento
                    </label>
                    {f.offer_choice_menu_enabled && (
                      <DobleOfertaChoiceMenu
                        value={cfg.doble_oferta_dos}
                        onChange={(dobleOferta) =>
                          setCfg({ ...cfg, doble_oferta_dos: dobleOferta })
                        }
                        onEdit={() => editSnapshot(`fu${fi}:doble_choice`)}
                      />
                    )}
                  </div>
                )}
                <FollowupPaymentMenu
                  menu={f.payment_menu}
                  buttonsPrompt={cfg.payment_buttons_prompt}
                  buttons={cfg.payment_buttons}
                  onChange={(menu) => {
                    setCfg({
                      ...cfg,
                      followups: cfg.followups.map((x, i) =>
                        i === fi ? { ...x, payment_menu: menu } : x
                      ),
                    });
                  }}
                  onEdit={() => editSnapshot(`fu${fi}:paymenu`)}
                />
              </div>
              );
            })}
            <button
              type="button"
              onClick={() => {
                snapshot();
                setCfg({
                  ...cfg,
                  followups: [
                    ...cfg.followups,
                    {
                      name: `seguimiento_${cfg.followups.length + 1}`,
                      delay_minutes_from_first_message: 0,
                      steps: [emptyStep()],
                    },
                  ],
                });
              }}
              className="w-full rounded-md border-2 border-dashed border-neutral-300 py-3 text-sm text-neutral-500 hover:border-emerald-400 hover:text-emerald-600"
            >
              ➕ Agregar seguimiento
            </button>
          </section>
        )}

        {cfg && tab === "salesbot" && (
          <section className="space-y-6">
            <div className="rounded-lg border border-sky-300 bg-sky-50 px-4 py-3 text-sm text-sky-900">
              <strong>Salesbot economico:</strong> reglas y burbujas sin IA para
              cubrir preguntas repetidas. El comprobante, el cobro y la entrega
              aprobada siguen protegidos por el motor actual.
            </div>
            <SalesbotRulesSection
              cfg={cfg}
              setCfg={setCfg}
              onSnapshot={snapshot}
              onEdit={editSnapshot}
            />
          </section>
        )}

        {cfg && tab === "ajustes" && (
          <AjustesTab
            cfg={cfg}
            setCfg={(c) => {
              editSnapshot("ajustes");
              setCfg(c);
            }}
          />
        )}

        {cfg && tab === "regalo" && (
          <GiftTab
            cfg={cfg}
            onSnapshot={snapshot}
            onEdit={editSnapshot}
            setCfg={(c) => {
              editSnapshot("regalo");
              setCfg(c);
            }}
          />
        )}

        {cfg && tab === "canales" && (
          <ChannelsPrototypeTab
            cfg={cfg}
            setCfg={setCfg}
            onSnapshot={snapshot}
            onEdit={editSnapshot}
          />
        )}

        {cfg && tab === "pago" && (
          <section className="space-y-6">
            <p className="text-sm text-neutral-600">
              Centro de control para precio, moneda, metodos, validacion de
              comprobantes y perfiles por pais. Lo editable aqui define cuanto
              cobra el bot y que datos de pago envia; no cambia la estructura de
              venta.
            </p>

            <Collapsible title="Pais, moneda y metodos por pais (ROAS / multipais)">
              <p className="mb-3 text-xs text-neutral-500">
                Aqui eliges el pais base y, si activas multipais, los perfiles de
                precio/metodos por numero entrante. La moneda se usa tambien para
                Meta CAPI/ROAS.
              </p>
              <label className="mb-3 block text-xs font-semibold text-neutral-700">
                Pais base (cuando multipais esta apagado)
                <select
                  className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
                  value={cfg.country ?? "PE"}
                  onChange={(e) => {
                    setBasePaymentCountry(e.target.value as CountryCode);
                  }}
                >
                  <option value="PE">🇵🇪 Peru - PEN (S/)</option>
                  <option value="EC">🇪🇨 Ecuador - USD ($)</option>
                  <option value="MX">🇲🇽 Mexico - MXN ($)</option>
                  <option value="CO">🇨🇴 Colombia - COP ($)</option>
                  <option value="AR">🇦🇷 Argentina - ARS ($) - voseo</option>
                  <option value="BO">🇧🇴 Bolivia - BOB (Bs)</option>
                  <option value="GT">🇬🇹 Guatemala - GTQ (Q)</option>
                  <option value="CR">🇨🇷 Costa Rica - CRC</option>
                  <option value="CL">🇨🇱 Chile - CLP ($)</option>
                  <option value="SV">🇸🇻 El Salvador - USD ($)</option>
                  <option value="VE">🇻🇪 Venezuela - VES (Bs)</option>
                </select>
              </label>
              <CountryPaymentProfilesEditor
                cfg={cfg}
                selectedCountry={selectedPaymentCountry}
                onChange={(next) => setCfg(next)}
                onSnapshot={snapshot}
                onEdit={(label) => editSnapshot(label ?? "pais_pago")}
              />
            </Collapsible>

            <PricingPaymentRulesSection
              cfg={cfg}
              normalPrice={paymentPriceForSelectedCountry}
              normalPriceLabel={`Precio normal (${paymentEditorCountry.currency})`}
              normalPriceHint={`Sincronizado con el precio del perfil de ${paymentEditorCountry.label}.`}
              onNormalPriceChange={(value) => {
                editSnapshot(`precio_normal_${selectedPaymentCountry}`);
                setSelectedNormalPrice(value);
              }}
              setCfg={(c) => {
                editSnapshot("precios_pago");
                setCfg(c);
              }}
            />

            <Collapsible title="🛡️ Texto ante desconfianza / estafa (+ CTA)">
              <p className="mb-2 text-xs text-neutral-500">
                Cuando el cliente expresa <strong>miedo a estafa o
                desconfianza</strong>, el bot envía ESTE texto (con tu cierre /
                CTA) en vez de improvisar — así nunca pierde el llamado a la
                acción. Usa <strong>doble salto de línea</strong> para separarlo
                en varias burbujas. Déjalo <strong>vacío</strong> para que el bot
                tranquilice con sus propias palabras (comportamiento actual).
              </p>
              <div className="grid items-start gap-4 lg:grid-cols-2">
                <textarea
                  value={cfg.distrust_message ?? ""}
                  onChange={(e) => {
                    editSnapshot("distrust_message");
                    setCfg({ ...cfg, distrust_message: e.target.value });
                  }}
                  rows={7}
                  placeholder={
                    "Ej:\nEntiendo tu preocupación 🙏 Somos una empresa seria y muchos clientes ya recibieron su material.\n\n😊 Cuando hagas tu pago, envíame la foto de tu comprobante 🤳🏼 y te doy acceso al instante."
                  }
                  className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                />
                <div className="lg:sticky lg:top-4">
                  <ChatPreview
                    steps={(cfg.distrust_message ?? "")
                      .split(/\n\n+/)
                      .filter((s) => s.trim())
                      .map((s) => ({
                        type: "text" as const,
                        drive_url: "",
                        texts: [s],
                        delay_after_sec: 0,
                      }))}
                  />
                </div>
              </div>
            </Collapsible>

            <div className="rounded-lg border border-neutral-300 bg-neutral-50 p-4">
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={cfg.payment_method_buttons}
                  onChange={(e) =>
                    setCfg({
                      ...cfg,
                      payment_method_buttons: e.target.checked,
                    })
                  }
                  className="h-5 w-5"
                />
                <span className="text-sm font-medium text-neutral-900">
                  Mostrar los métodos de pago con botones
                </span>
              </label>
              <p className="mb-2 mt-2 text-xs text-neutral-500">
                El toggle decide la “cara”: APAGADO → el bot manda el TEXTO de
                abajo; ENCENDIDO → manda los BOTONES. Ambos editables aquí.
              </p>

              <div className="mb-3 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                Editando pagos de: <strong>{paymentEditorCountry.label}</strong>.
                Al elegir otro pais arriba, este bloque cambia a los textos,
                botones y datos de pago de ese pais.
              </div>

              <div className="mt-2 rounded-md border border-neutral-200 bg-white p-3">
                <label className="block text-xs font-semibold text-neutral-800">
                  📝 Texto de métodos (cuando los botones están APAGADOS)
                </label>
                <p className="mb-2 text-xs text-neutral-500">
                  Lo que el bot escribe para ofrecer los métodos si el toggle
                  está OFF. Si lo dejas vacío, usa un texto por defecto.
                </p>
                <div className="grid gap-3 lg:grid-cols-2">
                  <textarea
                    rows={7}
                    value={paymentTextForSelectedCountry}
                    onChange={(e) => {
                      if (editingPeruPayments) {
                        setCfg({ ...cfg, payment_text: e.target.value });
                      } else {
                        setSelectedCountryProfile((profile) => ({
                          ...profile,
                          payment_text: e.target.value,
                        }));
                      }
                    }}
                    onFocus={() => editSnapshot(`payment_text_${selectedPaymentCountry}`)}
                    className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
                    placeholder={
                      "Ej:\n🛒 ¿Cómo compro? Responde con un método 👇\n1.- *Yape*\n2.- *Plin*\n3.- *BCP*"
                    }
                  />
                  <ChatPreview
                    steps={[
                      {
                        type: "text",
                        drive_url: "",
                        texts: [
                          paymentTextForSelectedCountry.trim() ||
                            "Puedes elegir tu método de pago 👇",
                        ],
                        delay_after_sec: 0,
                      },
                    ]}
                    priceSoles={cfg.globals.course_price_soles}
                  />
                </div>
              </div>

              <label className="mt-4 block text-xs font-semibold text-neutral-800">
                🔘 Botones (cuando están ENCENDIDOS)
              </label>
              <label className="mt-2 block text-xs font-medium text-neutral-700">
                Texto que acompaña los botones
              </label>
              <input
                value={cfg.payment_buttons_prompt}
                onChange={(e) =>
                  setCfg({ ...cfg, payment_buttons_prompt: e.target.value })
                }
                className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
                placeholder="Ej: Puedes elegir tu método de pago 👇"
              />

              <label className="mt-4 block text-xs font-medium text-neutral-700">
                Botones (1 a 3) — etiqueta + a qué método manda
              </label>
              <p className="mb-2 text-xs text-neutral-500">
                La etiqueta es lo que ve el cliente (admite emoji, máx ~20
                caracteres). El “método” es a dónde manda el bot al tocarlo. Si
                lo dejas vacío, usa <strong>Yape / Plin / BCP</strong> por
                defecto.
              </p>
              {paymentButtonsForSelectedCountry.map((b, i) => (
                <div
                  key={i}
                  className="mb-2 rounded-lg border border-neutral-200 p-2"
                >
                  <div className="flex items-center gap-2">
                    {/* Reordenar: las flechas mueven el método; los botones y el
                        menú siguen ESTE orden. */}
                    <div className="flex flex-col">
                      <button
                        type="button"
                        disabled={i === 0}
                        title="Subir"
                        onClick={() => {
                          snapshot();
                          const next = [...paymentButtonsForSelectedCountry];
                          [next[i - 1], next[i]] = [next[i], next[i - 1]];
                          setSelectedPaymentButtons(next);
                        }}
                        className="px-1 text-xs text-neutral-500 disabled:opacity-25 hover:text-neutral-800"
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        disabled={i === paymentButtonsForSelectedCountry.length - 1}
                        title="Bajar"
                        onClick={() => {
                          snapshot();
                          const next = [...paymentButtonsForSelectedCountry];
                          [next[i + 1], next[i]] = [next[i], next[i + 1]];
                          setSelectedPaymentButtons(next);
                        }}
                        className="px-1 text-xs text-neutral-500 disabled:opacity-25 hover:text-neutral-800"
                      >
                        ▼
                      </button>
                    </div>
                    <input
                      value={b.label}
                      maxLength={24}
                      onChange={(e) => {
                        const next = [...paymentButtonsForSelectedCountry];
                        next[i] = { ...next[i], label: e.target.value };
                        setSelectedPaymentButtons(next);
                      }}
                      onFocus={() => editSnapshot(`pmbtn_${i}`)}
                      placeholder="Ej: Banco del Barrio"
                      className="flex-1 rounded border border-neutral-300 px-3 py-2 text-sm"
                    />
                    {editingPeruPayments ? (
                    <select
                      value={b.method}
                      onChange={(e) => {
                        snapshot();
                        const next = [...paymentButtonsForSelectedCountry];
                        next[i] = { ...next[i], method: e.target.value };
                        setSelectedPaymentButtons(next);
                      }}
                      title="A qué textos manda (dónde están los datos de pago)"
                      className="rounded border border-neutral-300 px-2 py-2 text-sm"
                    >
                      <option value="yape">Textos: Yape</option>
                      <option value="plin">Textos: Plin (=Yape)</option>
                      <option value="bcp_transferencia">
                        Textos: BCP / Transferencia
                      </option>
                      <option value="efectivo">Textos: Efectivo</option>
                    </select>
                    ) : (
                      <input
                        value={b.method}
                        onChange={(e) => {
                          const oldMethod = b.method;
                          const nextMethod = e.target.value
                            .trim()
                            .toLowerCase()
                            .replace(/[^a-z0-9_]+/g, "_");
                          const next = [...paymentButtonsForSelectedCountry];
                          next[i] = { ...next[i], method: nextMethod };
                          setSelectedCountryProfile((profile) => {
                            const responses = {
                              ...(profile.payment_responses ?? {}),
                            };
                            if (
                              oldMethod &&
                              oldMethod !== nextMethod &&
                              responses[oldMethod] &&
                              !responses[nextMethod]
                            ) {
                              responses[nextMethod] = responses[oldMethod];
                              delete responses[oldMethod];
                            }
                            return {
                              ...profile,
                              payment_buttons: next,
                              payment_responses: responses,
                            };
                          });
                        }}
                        className="w-44 rounded border border-neutral-300 px-2 py-2 text-sm"
                        placeholder="id_metodo"
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        snapshot();
                        setSelectedPaymentButtons(
                          paymentButtonsForSelectedCountry.filter(
                            (_, j) => j !== i
                          )
                        );
                      }}
                      className="rounded border border-neutral-300 px-2 py-2 text-sm text-neutral-500 hover:bg-neutral-100"
                    >
                      🗑️
                    </button>
                  </div>
                  {/* Variantes (aliases): lo que el cliente puede escribir para
                      elegir este método aunque no toque el botón. */}
                  <input
                    value={(b.aliases ?? []).join(",")}
                    onChange={(e) => {
                      const next = [...paymentButtonsForSelectedCountry];
                      // NO recortamos ni filtramos aquí: si lo hiciéramos, la coma
                      // recién tecleada (que deja un elemento vacío) desaparecería
                      // al instante y no podrías escribirla. La limpieza (trim +
                      // quitar vacíos) la hace la API al guardar.
                      next[i] = { ...next[i], aliases: e.target.value.split(",") };
                      setSelectedPaymentButtons(next);
                    }}
                    onFocus={() => editSnapshot(`pmalias_${i}`)}
                    placeholder="Variantes: banco del barrio, barrio, depósito…"
                    className="mt-2 w-full rounded border border-neutral-300 px-3 py-1.5 text-xs"
                  />
                  <p className="mt-1 text-[11px] text-neutral-400">
                    Palabras que el cliente puede escribir para elegir este
                    método (separadas por coma). Sirve para reconocerlo aunque
                    escriba raro.
                  </p>
                </div>
              ))}
              {paymentButtonsForSelectedCountry.length < 4 && (
                <button
                  type="button"
                  onClick={() => {
                    snapshot();
                    setSelectedPaymentButtons([
                      ...paymentButtonsForSelectedCountry,
                      {
                        label: "",
                        method: editingPeruPayments ? "yape" : "",
                        aliases: [],
                      },
                    ]);
                  }}
                  className="mt-1 rounded border border-neutral-300 px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-100"
                >
                  + Agregar método
                </button>
              )}

              <p className="mb-1 mt-4 text-xs font-medium text-neutral-700">
                Vista previa (así los verá el cliente):
              </p>
              <ButtonsPreview
                prompt={cfg.payment_buttons_prompt}
                buttons={paymentButtonsForSelectedCountry}
              />
            </div>

            <div className="rounded-lg border border-neutral-300 bg-neutral-50 p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold text-neutral-900">
                    Pago directo al elegir opcion
                  </h2>
                  <p className="mt-1 text-xs text-neutral-500">
                    Apagado conserva el flujo actual. Encendido envia estos
                    datos despues de elegir una opcion; en venta lineal se usa
                    cuando el cliente pide Yape/Plin.
                  </p>
                </div>
                <label className="inline-flex items-center gap-2 rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700">
                  <input
                    type="checkbox"
                    checked={cfg.direct_payment_enabled === true}
                    onChange={(e) => {
                      snapshot();
                      setCfg({
                        ...cfg,
                        direct_payment_enabled: e.target.checked,
                      });
                    }}
                    className="h-4 w-4 accent-emerald-700"
                  />
                  Activar
                </label>
              </div>
              <StepEditorPreviewPair
                steps={cfg.direct_payment_steps ?? []}
                onChange={(steps) =>
                  setCfg({ ...cfg, direct_payment_steps: steps })
                }
                onSnapshot={snapshot}
                onEdit={editSnapshot}
                idPrefix="direct_payment"
                priceSoles={cfg.globals.course_price_soles}
                comboPrice={previewComboPriceFromConfig(cfg)}
                basicoPrice={previewBasicoPriceFromConfig(cfg)}
                previewContext={previewContextFromConfig(cfg)}
              />
              <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_340px]">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-neutral-700">
                    CTA final
                  </label>
                  <EditorEmojiTextarea
                    value={cfg.direct_payment_cta ?? ""}
                    onChange={(value) =>
                      setCfg({ ...cfg, direct_payment_cta: value })
                    }
                    rows={4}
                    placeholder="Ej: Apenas realices el pago, enviame tu comprobante por aqui."
                    className="w-full rounded border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/20"
                  />
                </div>
                <ChatPreview
                  steps={
                    (cfg.direct_payment_cta ?? "").trim()
                      ? [
                          {
                            type: "text",
                            texts: [cfg.direct_payment_cta ?? ""],
                            drive_url: "",
                            delay_after_sec: 0,
                            enabled: true,
                          },
                        ]
                      : []
                  }
                  priceSoles={cfg.globals.course_price_soles}
                  comboPrice={previewComboPriceFromConfig(cfg)}
                  basicoPrice={previewBasicoPriceFromConfig(cfg)}
                  previewContext={previewContextFromConfig(cfg)}
                />
              </div>
            </div>

            <div className="rounded-lg border border-neutral-300 bg-neutral-50 p-4">
              <div className="mb-3">
                <h2 className="text-base font-bold text-neutral-900">
                  Pago directo sin opcion elegida
                </h2>
                <p className="mt-1 text-xs text-neutral-500">
                  Se usa si el cliente pide Yape/Plin despues de ver las
                  opciones, pero todavia no eligio. No pongas precio de una
                  opcion aqui.
                </p>
              </div>
              <StepEditorPreviewPair
                steps={cfg.direct_payment_without_choice_steps ?? []}
                onChange={(steps) =>
                  setCfg({
                    ...cfg,
                    direct_payment_without_choice_steps: steps,
                  })
                }
                onSnapshot={snapshot}
                onEdit={editSnapshot}
                idPrefix="direct_payment_without_choice"
                priceSoles={cfg.globals.course_price_soles}
                comboPrice={previewComboPriceFromConfig(cfg)}
                basicoPrice={previewBasicoPriceFromConfig(cfg)}
                previewContext={previewContextFromConfig(cfg)}
              />
              <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_340px]">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-neutral-700">
                    CTA final sin opcion
                  </label>
                  <EditorEmojiTextarea
                    value={cfg.direct_payment_without_choice_cta ?? ""}
                    onChange={(value) =>
                      setCfg({
                        ...cfg,
                        direct_payment_without_choice_cta: value,
                      })
                    }
                    rows={4}
                    placeholder="Ej: Estos son los datos. Recuerda elegir entre las 2 opciones para confirmar el monto correcto."
                    className="w-full rounded border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/20"
                  />
                </div>
                <ChatPreview
                  steps={
                    (cfg.direct_payment_without_choice_cta ?? "").trim()
                      ? [
                          {
                            type: "text",
                            texts: [
                              cfg.direct_payment_without_choice_cta ?? "",
                            ],
                            drive_url: "",
                            delay_after_sec: 0,
                            enabled: true,
                          },
                        ]
                      : []
                  }
                  priceSoles={cfg.globals.course_price_soles}
                  comboPrice={previewComboPriceFromConfig(cfg)}
                  basicoPrice={previewBasicoPriceFromConfig(cfg)}
                  previewContext={previewContextFromConfig(cfg)}
                />
              </div>
            </div>

            {paymentResponseBlocks.map(([key, label, steps]) => (
              <div
                key={key}
                className="rounded-lg border border-neutral-300 bg-neutral-50 p-4"
              >
                <h2 className="mb-3 text-base font-bold text-neutral-900">
                  {label}
                </h2>
                <StepEditorPreviewPair
                  steps={steps}
                  onChange={(nextSteps) => {
                    if (editingPeruPayments) {
                      setCfg({
                        ...cfg,
                        payment_methods: {
                          ...cfg.payment_methods,
                          [key as keyof FullConfig["payment_methods"]]: nextSteps,
                        },
                      });
                    } else {
                      setSelectedCountryProfile((profile) => ({
                        ...profile,
                        payment_responses: {
                          ...(profile.payment_responses ?? {}),
                          [key]: nextSteps,
                        },
                      }));
                    }
                  }}
                  onSnapshot={snapshot}
                  onEdit={editSnapshot}
                  idPrefix={`pm_${selectedPaymentCountry}_${key}`}
                  priceSoles={paymentPriceForSelectedCountry}
                />
              </div>
            ))}
          </section>
        )}

        {cfg && tab === "entrega" && (
          <section className="space-y-4">
            <p className="text-sm text-neutral-600">
              Lo que pasa <strong>después de que el cliente paga</strong>: la
              entrega del material y el correo. Esta es la entrega CENTRAL del
              bot (también es la del Producto 1 de la bioferta).
            </p>

            {!cfg.doble_oferta_dos.enabled && !cfg.order_bump.enabled && (
            <Collapsible title="Entrega “Pago Aprobado”">
              <p className="mb-3 text-xs text-neutral-500">
                La secuencia que el bot envía al confirmar el pago (video +
                enlace de descarga). El <strong>último mensaje pide el correo</strong>{" "}
                — no lo quites, dispara el envío del email y el regalo.
              </p>
              <StepEditorPreviewPair
                steps={cfg.payment_approved}
                onChange={(steps) =>
                  setCfg({ ...cfg, payment_approved: steps })
                }
                onSnapshot={snapshot}
                onEdit={editSnapshot}
                idPrefix="pago_aprobado"
                priceSoles={cfg.globals.course_price_soles}
              />
            </Collapsible>
            )}

            {cfg.order_bump.enabled && (
              <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-500">
                En <strong>Order Bump</strong>, la entrega de cada opción (Combo /
                Básico) se edita en la pestaña <strong>Order Bump</strong>. Por eso
                aquí no aparece el cajón “Pago Aprobado”: no se usa en esta
                modalidad (la entrega obedece solo la pestaña Order Bump).
              </div>
            )}

            {cfg.doble_oferta_dos.enabled && (
              <>
                <Collapsible title="📦 Entrega — Producto 1 (Combo)">
                  <p className="mb-3 text-xs text-neutral-500">
                    Lo que recibe el cliente al pagar la <strong>Opción 1</strong>{" "}
                    de Doble Oferta 2 Productos (su enlace/material propio). Solo
                    aplica a esta modalidad.
                  </p>
                  <StepEditorPreviewPair
                    steps={cfg.doble_oferta_dos.combo.delivery}
                    onChange={(steps) =>
                      setCfg({
                        ...cfg,
                        doble_oferta_dos: {
                          ...cfg.doble_oferta_dos,
                          combo: {
                            ...cfg.doble_oferta_dos.combo,
                            delivery: steps,
                          },
                        },
                      })
                    }
                    onSnapshot={snapshot}
                    onEdit={editSnapshot}
                    idPrefix="dd_combo_del"
                    priceSoles={cfg.doble_oferta_dos.combo.price_soles}
                  />
                </Collapsible>

                <Collapsible title="📦 Entrega — Producto 2 (Básico)">
                  <p className="mb-3 text-xs text-neutral-500">
                    Lo que recibe el cliente al pagar la <strong>Opción 2</strong>{" "}
                    de Doble Oferta 2 Productos. Solo aplica a esta modalidad.
                  </p>
                  <StepEditorPreviewPair
                    steps={cfg.doble_oferta_dos.basico.delivery}
                    onChange={(steps) =>
                      setCfg({
                        ...cfg,
                        doble_oferta_dos: {
                          ...cfg.doble_oferta_dos,
                          basico: {
                            ...cfg.doble_oferta_dos.basico,
                            delivery: steps,
                          },
                        },
                      })
                    }
                    onSnapshot={snapshot}
                    onEdit={editSnapshot}
                    idPrefix="dd_basico_del"
                    priceSoles={cfg.doble_oferta_dos.basico.price_soles}
                  />
                </Collapsible>
              </>
            )}

            <Collapsible title="Encuesta a cliente">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-neutral-500">
                  Mensaje opcional post-compra: sale al completar correo + regalo,
                  o al vencer el tiempo configurado.
                </p>
                <label className="inline-flex items-center gap-2 rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700">
                  <input
                    type="checkbox"
                    checked={cfg.customer_survey_enabled === true}
                    onChange={(e) => {
                      snapshot();
                      setCfg({
                        ...cfg,
                        customer_survey_enabled: e.target.checked,
                      });
                    }}
                    className="h-4 w-4 accent-emerald-700"
                  />
                  Activar
                </label>
                <label className="inline-flex items-center gap-2 rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700">
                  <input
                    type="checkbox"
                    checked={cfg.customer_survey_auto_human_enabled === true}
                    onChange={(e) => {
                      snapshot();
                      setCfg({
                        ...cfg,
                        customer_survey_auto_human_enabled: e.target.checked,
                      });
                    }}
                    className="h-4 w-4 accent-emerald-700"
                  />
                  Pasar a HUMANO luego de enviarla
                </label>
              </div>
              <div className="mb-3 max-w-xs">
                <NumberField
                  label="Enviar si no completa (min)"
                  value={cfg.globals.customer_survey_delay_minutes}
                  onChange={(v) =>
                    setCfg({
                      ...cfg,
                      globals: {
                        ...cfg.globals,
                        customer_survey_delay_minutes: v,
                      },
                    })
                  }
                />
              </div>
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_340px]">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-neutral-700">
                    Mensaje de encuesta
                  </label>
                  <EditorEmojiTextarea
                    value={cfg.customer_survey_message ?? ""}
                    onChange={(value) =>
                      setCfg({ ...cfg, customer_survey_message: value })
                    }
                    rows={4}
                    placeholder="Antes de irte, ¿nos dejas una sugerencia para mejorar nuestra atención? 😊"
                    className="w-full rounded border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/20"
                  />
                </div>
                <ChatPreview
                  steps={
                    (cfg.customer_survey_message ?? "").trim()
                      ? [
                          {
                            type: "text",
                            texts: [cfg.customer_survey_message ?? ""],
                            drive_url: "",
                            delay_after_sec: 0,
                            enabled: true,
                          },
                        ]
                      : []
                  }
                  priceSoles={cfg.globals.course_price_soles}
                />
              </div>
            </Collapsible>

            <Collapsible title="Email post-compra">
              <p className="mb-3 text-xs text-neutral-500">
                El correo que se le envía al cliente cuando da su email (con el
                enlace de descarga permanente).
              </p>
              <label className="block text-xs font-medium text-neutral-700">
                Remitente (nombre que aparece)
              </label>
              <input
                value={cfg.email.from_name}
                onChange={(e) =>
                  setCfg({
                    ...cfg,
                    email: { ...cfg.email, from_name: e.target.value },
                    modality_templates: {
                      ...cfg.modality_templates,
                      [activeModality(cfg)]: {
                        ...(cfg.modality_templates?.[activeModality(cfg)] ?? {}),
                        email: { ...cfg.email, from_name: e.target.value },
                      },
                    },
                  })
                }
                className="mb-3 mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
                placeholder="Ej: Abcmulticlases"
              />
              <label className="block text-xs font-medium text-neutral-700">
                Correo remitente (solo lectura)
              </label>
              <input
                value={cfg.gmail_user || "(no configurado en el servidor)"}
                readOnly
                className="mt-1 w-full cursor-not-allowed rounded border border-neutral-200 bg-neutral-100 px-3 py-2 text-sm text-neutral-500"
              />
              <p className="mb-3 mt-1 text-[11px] text-neutral-500">
                Es la cuenta de Gmail que envía (variable <code>GMAIL_USER</code>).
                Para cambiarla, edita <code>GMAIL_USER</code> y{" "}
                <code>GMAIL_APP_PASSWORD</code> en EasyPanel — no se cambia aquí.
              </p>
              <label className="block text-xs font-medium text-neutral-700">
                Asunto
              </label>
              <input
                value={cfg.email.subject}
                onChange={(e) =>
                  setCfg({
                    ...cfg,
                    email: { ...cfg.email, subject: e.target.value },
                    modality_templates: {
                      ...cfg.modality_templates,
                      [activeModality(cfg)]: {
                        ...(cfg.modality_templates?.[activeModality(cfg)] ?? {}),
                        email: { ...cfg.email, subject: e.target.value },
                      },
                    },
                  })
                }
                className="mb-3 mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
                placeholder="Ej: 📚 Ya puedes descargar tu material"
              />
              <label className="block text-xs font-medium text-neutral-700">
                Cuerpo del correo
              </label>
              <EditorEmojiTextarea
                rows={10}
                value={cfg.email.body}
                onChange={(value) =>
                  setCfg({
                    ...cfg,
                    email: { ...cfg.email, body: value },
                    modality_templates: {
                      ...cfg.modality_templates,
                      [activeModality(cfg)]: {
                        ...(cfg.modality_templates?.[activeModality(cfg)] ?? {}),
                        email: { ...cfg.email, body: value },
                      },
                    },
                  })
                }
                onFocus={() => editSnapshot("email_body")}
                className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
                placeholder="¡Hola! Aquí tienes tu enlace de descarga: ..."
              />
            </Collapsible>

            <Collapsible title="Email post-compra VIP">
              <p className="mb-3 text-xs text-neutral-500">
                Correo independiente para quienes compran la opción combo/VIP
                del Order Bump. Puedes personalizar remitente, asunto, contenido
                y enlace sin afectar el correo original.
              </p>
              <label className="block text-xs font-medium text-neutral-700">
                Remitente (nombre que aparece)
              </label>
              <input
                value={cfg.email_vip.from_name}
                onChange={(e) =>
                  setCfg({
                    ...cfg,
                    email_vip: { ...cfg.email_vip, from_name: e.target.value },
                    modality_templates: {
                      ...cfg.modality_templates,
                      [activeModality(cfg)]: {
                        ...(cfg.modality_templates?.[activeModality(cfg)] ?? {}),
                        email_vip: { ...cfg.email_vip, from_name: e.target.value },
                      },
                    },
                  })
                }
                className="mb-3 mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
                placeholder="Ej: Abcmulticlases"
              />
              <label className="block text-xs font-medium text-neutral-700">
                Correo remitente (solo lectura)
              </label>
              <input
                value={cfg.gmail_user || "(no configurado en el servidor)"}
                readOnly
                className="mt-1 w-full cursor-not-allowed rounded border border-neutral-200 bg-neutral-100 px-3 py-2 text-sm text-neutral-500"
              />
              <p className="mb-3 mt-1 text-[11px] text-neutral-500">
                Es la misma cuenta Gmail configurada en el servidor mediante{" "}
                <code>GMAIL_USER</code>.
              </p>
              <label className="block text-xs font-medium text-neutral-700">
                Asunto
              </label>
              <input
                value={cfg.email_vip.subject}
                onChange={(e) =>
                  setCfg({
                    ...cfg,
                    email_vip: { ...cfg.email_vip, subject: e.target.value },
                    modality_templates: {
                      ...cfg.modality_templates,
                      [activeModality(cfg)]: {
                        ...(cfg.modality_templates?.[activeModality(cfg)] ?? {}),
                        email_vip: { ...cfg.email_vip, subject: e.target.value },
                      },
                    },
                  })
                }
                className="mb-3 mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
                placeholder="Ej: Ya puedes descargar tu producto VIP"
              />
              <label className="block text-xs font-medium text-neutral-700">
                Cuerpo del correo
              </label>
              <EditorEmojiTextarea
                rows={10}
                value={cfg.email_vip.body}
                onChange={(value) =>
                  setCfg({
                    ...cfg,
                    email_vip: { ...cfg.email_vip, body: value },
                    modality_templates: {
                      ...cfg.modality_templates,
                      [activeModality(cfg)]: {
                        ...(cfg.modality_templates?.[activeModality(cfg)] ?? {}),
                        email_vip: { ...cfg.email_vip, body: value },
                      },
                    },
                  })
                }
                onFocus={() => editSnapshot("email_vip_body")}
                className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
                placeholder="¡Hola! Aquí tienes el enlace de tu producto VIP: ..."
              />
            </Collapsible>
            <Collapsible title="Mensaje postventa">
              {(() => {
                const postventaSource = cfg.prompt_sections.postventa ?? "";
                const postventa = extractPostSaleValues(postventaSource);
                return (
                  <div className="space-y-4">
                    <p className="text-xs text-neutral-500">
                      Aqui editas solo las respuestas visibles para el cliente despues de la compra.
                    </p>
                    <div>
                      <label className="block text-xs font-medium text-neutral-700">
                        Si no quiere dar correo
                      </label>
                      <p className="mb-1 mt-1 text-[11px] text-neutral-500">
                        Respuesta cuando prefiere recibir todo por WhatsApp y no quiere compartir email.
                      </p>
                      <EditorEmojiTextarea
                        rows={3}
                        value={postventa.whatsappPreference}
                        onChange={(value) =>
                          setCfg({
                            ...cfg,
                            prompt_sections: {
                              ...cfg.prompt_sections,
                              postventa: updatePostSaleSingle(
                                sanitizePostSaleInstruction(postventaSource),
                                postventa.whatsappPreference,
                                value,
                                /(Example response[\s\S]*?\n\s*")([\s\S]*?)(")/
                              ),
                            },
                          })
                        }
                        onFocus={() => editSnapshot("postventa_whatsapp_preference")}
                        className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-neutral-700">
                        Si pregunta como descargar o usar el material
                      </label>
                      <p className="mb-1 mt-1 text-[11px] text-neutral-500">
                        Respuesta base cuando el cliente pregunta por el material que ya recibio.
                      </p>
                      <EditorEmojiTextarea
                        rows={3}
                        value={postventa.deliveryUsage}
                        onChange={(value) =>
                          setCfg({
                            ...cfg,
                            prompt_sections: {
                              ...cfg.prompt_sections,
                              postventa: updatePostSaleSingle(
                                sanitizePostSaleInstruction(postventaSource),
                                postventa.deliveryUsage,
                                value,
                                /(Phrases like:\s*\n\s*")([\s\S]*?)(")/
                              ),
                            },
                          })
                        }
                        onFocus={() => editSnapshot("postventa_delivery_usage")}
                        className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-neutral-700">
                        Si pregunta si el acceso es de por vida
                      </label>
                      <p className="mb-1 mt-1 text-[11px] text-neutral-500">
                        Respuesta breve para confirmar que el acceso queda disponible despues de la compra.
                      </p>
                      <EditorEmojiTextarea
                        rows={2}
                        value={postventa.lifetimeAccess}
                        onChange={(value) =>
                          setCfg({
                            ...cfg,
                            prompt_sections: {
                              ...cfg.prompt_sections,
                              postventa: updatePostSaleSingle(
                                sanitizePostSaleInstruction(postventaSource),
                                postventa.lifetimeAccess,
                                value,
                                /(Phrases like:[\s\S]*?"[\s\S]*?"\s*\n\s*\n\s*")([\s\S]*?)(")/
                              ),
                            },
                          })
                        }
                        onFocus={() => editSnapshot("postventa_lifetime_access")}
                        className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-neutral-700">
                        Despedidas postventa
                      </label>
                      <p className="mb-1 mt-1 text-[11px] text-neutral-500">
                        Escribe una despedida por linea. El bot podra cerrar con cualquiera de estas variantes.
                      </p>
                      <EditorEmojiTextarea
                        rows={4}
                        value={postventaFarewellsDraft}
                        onChange={(value) => {
                          const nextDraft = value;
                          setPostventaFarewellsDraft(nextDraft);
                          setCfg((prev) => {
                            if (!prev) return prev;
                            const source = prev.prompt_sections.postventa ?? "";
                            return {
                              ...prev,
                              prompt_sections: {
                                ...prev.prompt_sections,
                                postventa: updatePostSaleFarewells(
                                  sanitizePostSaleInstruction(source),
                                  nextDraft
                                ),
                              },
                            };
                          });
                        }}
                        onFocus={() => {
                          postventaFarewellsFocusedRef.current = true;
                          setPostventaFarewellsDraft(postventa.farewells.join("\n"));
                          editSnapshot("postventa_farewells");
                        }}
                        onBlur={() => {
                          postventaFarewellsFocusedRef.current = false;
                        }}
                        className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
                      />
                    </div>
                  </div>
                );
              })()}
            </Collapsible>
          </section>
        )}

        {cfg && tab === "bioferta" && (
          <section className="space-y-4">
            <p className="text-sm text-neutral-600">
              <strong>Doble Oferta:</strong> vende 2 productos al mismo precio +
              un <strong>pack</strong> con los dos a otro precio. El cliente
              elige <strong>escribiendo el nombre</strong> (o tocando un botón).
              Apagada, el bot vende como siempre (sin cambios).
            </p>

            <div className="flex flex-wrap items-center gap-4 rounded-lg border border-neutral-300 bg-neutral-50 p-4">
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={cfg.bioferta.enabled}
                  onChange={(e) => setModalidad("bioferta", e.target.checked)}
                  className="h-5 w-5"
                />
                <span className="text-sm font-medium text-neutral-900">
                  Activar Doble Oferta
                </span>
              </label>
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={cfg.bioferta.use_buttons}
                  onChange={(e) =>
                    setCfg({
                      ...cfg,
                      bioferta: {
                        ...cfg.bioferta,
                        use_buttons: e.target.checked,
                      },
                    })
                  }
                  className="h-5 w-5"
                />
                <span className="text-sm font-medium text-neutral-900">
                  Elegir producto con botones
                </span>
              </label>
            </div>

            <div className="rounded-lg border border-neutral-300 bg-neutral-50 p-4">
              <p className="text-sm font-medium text-neutral-900">
                Precios del pack (los 2 juntos), en soles
              </p>
              <p className="mb-2 text-xs text-neutral-500">
                Cada producto separado usa el “Precio del producto” de Ajustes.
                El precio promocional se activa junto con Seguimiento 2; 0
                conserva el precio normal del pack.
              </p>
              <div className="flex flex-wrap gap-4">
                <label className="text-xs font-medium text-neutral-700">
                  Precio normal
                  <input
                    type="number"
                    value={cfg.bioferta.pack_price_soles}
                    onChange={(e) =>
                      setCfg({
                        ...cfg,
                        bioferta: {
                          ...cfg.bioferta,
                          pack_price_soles: Number(e.target.value) || 0,
                        },
                      })
                    }
                    className="mt-1 block w-32 rounded border border-neutral-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="text-xs font-medium text-neutral-700">
                  Precio oferta
                  <input
                    type="number"
                    value={cfg.bioferta.pack_discount_price_soles}
                    onChange={(e) =>
                      setCfg({
                        ...cfg,
                        bioferta: {
                          ...cfg.bioferta,
                          pack_discount_price_soles:
                            Number(e.target.value) || 0,
                        },
                      })
                    }
                    className="mt-1 block w-32 rounded border border-neutral-300 px-3 py-2 text-sm"
                  />
                </label>
              </div>
            </div>

            <Collapsible title="Producto 1 — principal">
              <p className="mb-3 text-xs text-neutral-500">
                Es el producto principal que ya vendes. Aquí solo defines cómo
                lo reconoce el bot (nombre). Su <strong>entrega</strong> es la de{" "}
                <em>“Pago Aprobado”</em> → la editas en la pestaña{" "}
                <strong>Entrega</strong>.
              </p>
              <NameAliases
                value={cfg.bioferta.product_a}
                onChange={(v) =>
                  setCfg({
                    ...cfg,
                    bioferta: {
                      ...cfg.bioferta,
                      product_a: { ...cfg.bioferta.product_a, ...v },
                    },
                  })
                }
              />
            </Collapsible>

            <Collapsible title="Producto 2">
              <p className="mb-3 text-xs text-neutral-500">
                El segundo producto. Define su nombre + cómo se entrega (su
                enlace).
              </p>
              <NameAliases
                value={cfg.bioferta.product_b}
                onChange={(v) =>
                  setCfg({
                    ...cfg,
                    bioferta: {
                      ...cfg.bioferta,
                      product_b: { ...cfg.bioferta.product_b, ...v },
                    },
                  })
                }
              />
              <h3 className="mb-2 mt-4 text-sm font-semibold text-neutral-800">
                Entrega del Producto 2
              </h3>
              <StepEditorPreviewPair
                steps={cfg.bioferta.product_b.delivery}
                onChange={(steps) =>
                  setCfg({
                    ...cfg,
                    bioferta: {
                      ...cfg.bioferta,
                      product_b: { ...cfg.bioferta.product_b, delivery: steps },
                    },
                  })
                }
                onSnapshot={snapshot}
                onEdit={editSnapshot}
                idPrefix="bf_b"
                priceSoles={cfg.globals.course_price_soles}
              />
            </Collapsible>

            <Collapsible title="Pack (los 2 juntos)">
              <p className="mb-3 text-xs text-neutral-500">
                El pack premium. Define su nombre + su entrega (un enlace
                distinto, no los dos productos por separado).
              </p>
              <NameAliases
                value={cfg.bioferta.pack}
                onChange={(v) =>
                  setCfg({
                    ...cfg,
                    bioferta: {
                      ...cfg.bioferta,
                      pack: { ...cfg.bioferta.pack, ...v },
                    },
                  })
                }
              />
              <h3 className="mb-2 mt-4 text-sm font-semibold text-neutral-800">
                Entrega del Pack
              </h3>
              <StepEditorPreviewPair
                steps={cfg.bioferta.pack.delivery}
                onChange={(steps) =>
                  setCfg({
                    ...cfg,
                    bioferta: {
                      ...cfg.bioferta,
                      pack: { ...cfg.bioferta.pack, delivery: steps },
                    },
                  })
                }
                onSnapshot={snapshot}
                onEdit={editSnapshot}
                idPrefix="bf_pack"
                priceSoles={cfg.bioferta.pack_price_soles}
              />
            </Collapsible>

            <div className="rounded-lg border border-neutral-300 bg-neutral-50 p-4">
              <label className="block text-sm font-medium text-neutral-900">
                Pregunta cuando el cliente paga el precio de 1 producto pero no
                dijo cuál
              </label>
              <textarea
                rows={3}
                value={cfg.bioferta.ask_choice_text}
                onChange={(e) =>
                  setCfg({
                    ...cfg,
                    bioferta: {
                      ...cfg.bioferta,
                      ask_choice_text: e.target.value,
                    },
                  })
                }
                className="mt-2 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
                placeholder="Ej: ¡Listo! ¿Cuál de los dos compraste? Escríbeme el nombre, por favor 😊"
              />
            </div>
          </section>
        )}

        {cfg && tab === "orderbump" && (
          <section className="space-y-4">
            <p className="text-sm text-neutral-600">
              <strong>Order Bump:</strong> cuando el cliente va a pagar, el bot
              le muestra primero una oferta intermedia de 2 opciones (un{" "}
              <em>combo</em> con un plus y una <em>básica</em>). Apagada, el bot
              vende como siempre. Normalmente usas <strong>esta o la Doble
              Oferta</strong>, no las dos a la vez.
            </p>

            <div className="flex flex-wrap items-center gap-4 rounded-lg border border-neutral-300 bg-neutral-50 p-4">
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={cfg.order_bump.enabled}
                  onChange={(e) => setModalidad("order_bump", e.target.checked)}
                  className="h-5 w-5"
                />
                <span className="text-sm font-medium text-neutral-900">
                  Activar Order Bump
                </span>
              </label>
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={cfg.order_bump.use_buttons}
                  onChange={(e) =>
                    setCfg({
                      ...cfg,
                      order_bump: {
                        ...cfg.order_bump,
                        use_buttons: e.target.checked,
                      },
                    })
                  }
                  className="h-5 w-5"
                />
                <span className="text-sm font-medium text-neutral-900">
                  Mostrar la elección con botones
                </span>
              </label>
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={cfg.order_bump.offer_on_reengaged_price !== false}
                  onChange={(e) =>
                    setCfg({
                      ...cfg,
                      order_bump: {
                        ...cfg.order_bump,
                        offer_on_reengaged_price: e.target.checked,
                      },
                    })
                  }
                  className="h-5 w-5"
                />
                <span className="text-sm font-medium text-neutral-900">
                  Soltar la oferta a quien vuelve tras un seguimiento y pregunta
                  el precio
                </span>
              </label>
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={cfg.order_bump.offer_on_intro_first_message === false}
                  onChange={(e) =>
                    setCfg({
                      ...cfg,
                      order_bump: {
                        ...cfg.order_bump,
                        offer_on_intro_first_message: !e.target.checked,
                      },
                    })
                  }
                  className="h-5 w-5"
                />
                <span className="text-sm font-medium text-neutral-900">
                  Tras la intro, soltar la oferta SOLO cuando pregunten el precio
                  o quieran pagar (no por cualquier mensaje)
                </span>
              </label>
            </div>

            <Collapsible title="Mensaje de la oferta (imagen + descripción)">
              <p className="mb-3 text-xs text-neutral-500">
                Lo que el cliente ve ANTES de elegir: la imagen y el texto que
                describe el combo y la básica.
              </p>
              <StepEditorPreviewPair
                steps={cfg.order_bump.intro}
                onChange={(steps) =>
                  setCfg({
                    ...cfg,
                    order_bump: { ...cfg.order_bump, intro: steps },
                  })
                }
                onSnapshot={snapshot}
                onEdit={editSnapshot}
                idPrefix="ob_intro"
                comboPrice={cfg.order_bump.combo.price_soles}
                basicoPrice={cfg.order_bump.basico.price_soles}
                previewContext={previewContextFromConfig(cfg)}
              />
            </Collapsible>

            <div className="rounded-lg border border-neutral-300 bg-neutral-50 p-4">
              <label className="block text-sm font-medium text-neutral-900">
                Texto que pide elegir
              </label>
              <p className="mb-2 text-xs text-neutral-500">
                Este texto solo se envía cuando activas la elección con botones.
              </p>
              <textarea
                rows={2}
                value={cfg.order_bump.choice_prompt}
                disabled={!cfg.order_bump.use_buttons}
                onChange={(e) =>
                  setCfg({
                    ...cfg,
                    order_bump: {
                      ...cfg.order_bump,
                      choice_prompt: e.target.value,
                    },
                  })
                }
                className="w-full rounded border border-neutral-300 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-500"
                placeholder="Ej: 👇 Elige tu opción para pasarte los datos de pago"
              />
              <label className="mt-3 block text-sm font-medium text-neutral-900">
                Texto de aclaración suave
              </label>
              <p className="mb-2 text-xs text-neutral-500">
                Se usa cuando el cliente cambia de idea o responde ambiguo.
                Puedes usar <strong>{"{{OPCION_1}}"}</strong>,{" "}
                <strong>{"{{OPCION_2}}"}</strong>, <strong>{"{{PRECIO_1}}"}</strong>{" "}
                y <strong>{"{{PRECIO_2}}"}</strong> para clonar este flujo a
                otros productos sin tocar código.
              </p>
              <textarea
                rows={3}
                value={cfg.order_bump.choice_clarification}
                onChange={(e) =>
                  setCfg({
                    ...cfg,
                    order_bump: {
                      ...cfg.order_bump,
                      choice_clarification: e.target.value,
                    },
                  })
                }
                className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
                placeholder="Ej: Perfecto, te ayudo a dejarlo claro. ¿Cuál de estas opciones prefieres: {{OPCION_1}} o {{OPCION_2}}?"
              />
              <label className="mt-3 block text-sm font-medium text-neutral-900">
                Respuesta a “precio” (recordatorio de las 2 opciones)
              </label>
              <p className="mb-2 text-xs text-neutral-500">
                Lo que responde el bot cuando el cliente pregunta el precio
                durante el order bump (siempre recuerda las 2 opciones). Usa{" "}
                <strong>{"{{OPCION_1}}"}</strong>,{" "}
                <strong>{"{{OPCION_2}}"}</strong>,{" "}
                <strong>{"{{precio_1}}"}</strong>,{" "}
                <strong>{"{{precio_2}}"}</strong> y{" "}
                <strong>{"{{precio_extra}}"}</strong>. Vacío = usa el texto por
                defecto del sistema.
              </p>
              <textarea
                rows={4}
                value={cfg.order_bump.price_question_response ?? ""}
                onChange={(e) =>
                  setCfg({
                    ...cfg,
                    order_bump: {
                      ...cfg.order_bump,
                      price_question_response: e.target.value,
                    },
                  })
                }
                className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
                placeholder={
                  "Ej: Tenemos 2 opciones 😊:\n• {{OPCION_1}} → S/. {{precio_1}}\n• {{OPCION_2}} → S/. {{precio_2}}\n¿Cuál prefieres?"
                }
              />
              {cfg.order_bump.use_buttons && (
                <div className="mt-3">
                  <p className="mb-1 text-xs font-medium text-neutral-700">
                    Vista previa (así le llegan los 2 botones al cliente):
                  </p>
                  <ButtonsPreview
                    prompt={cfg.order_bump.choice_prompt}
                    buttons={[
                      {
                        label: cfg.order_bump.combo.name || "Opción 1",
                        method: "ob_combo",
                      },
                      {
                        label: cfg.order_bump.basico.name || "Opción 2",
                        method: "ob_basico",
                      },
                    ]}
                  />
                </div>
              )}
            </div>

            <ObOptionEditor
              title="Opción 1 — Combo (con el plus)"
              value={cfg.order_bump.combo}
              onChange={(v) =>
                setCfg({
                  ...cfg,
                  order_bump: { ...cfg.order_bump, combo: v },
                })
              }
              idPrefix="ob_combo"
              snapshot={snapshot}
              editSnapshot={editSnapshot}
              comboPrice={cfg.order_bump.combo.price_soles}
              basicoPrice={cfg.order_bump.basico.price_soles}
              previewContext={previewContextFromConfig(cfg)}
            />
            <ObOptionEditor
              title="Opción 2 — Básico"
              value={cfg.order_bump.basico}
              onChange={(v) =>
                setCfg({
                  ...cfg,
                  order_bump: { ...cfg.order_bump, basico: v },
                  // El Básico es el MISMO curso de precio bajo: sincronizamos su
                  // precio con Ajustes (normal ↔ "Precio del producto"; promo ↔
                  // "Precio con descuento") para que nunca queden en conflicto.
                  ...(v.price_soles !== cfg.order_bump.basico.price_soles
                    ? {
                        globals: {
                          ...cfg.globals,
                          course_price_soles: v.price_soles,
                        },
                      }
                    : {}),
                  ...(cfg.offer &&
                  v.discount_price_soles !==
                    cfg.order_bump.basico.discount_price_soles
                    ? {
                        offer: {
                          ...cfg.offer,
                          price_soles: v.discount_price_soles,
                        },
                      }
                    : {}),
                })
              }
              idPrefix="ob_basico"
              snapshot={snapshot}
              editSnapshot={editSnapshot}
              comboPrice={cfg.order_bump.combo.price_soles}
              basicoPrice={cfg.order_bump.basico.price_soles}
              previewContext={previewContextFromConfig(cfg)}
            />
          </section>
        )}

        {cfg && tab === "dobleoferta2" && (
          <section className="space-y-4">
            <p className="text-sm text-neutral-600">
              <strong>Doble Oferta 2 Productos:</strong> al terminar la intro, el
              bot muestra <strong>al final</strong> las 2 opciones (combo y
              básico); el cliente elige una y va directo al pago —{" "}
              <strong>sin una 2ª intro</strong> y sin pedir el nombre. Apagada,
              el bot vende como siempre. Normalmente usas{" "}
              <strong>esta o el Order Bump</strong>, no las dos a la vez.
            </p>

            <div className="flex flex-wrap items-center gap-4 rounded-lg border border-neutral-300 bg-neutral-50 p-4">
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={cfg.doble_oferta_dos.enabled}
                  onChange={(e) =>
                    setModalidad("doble_oferta_dos", e.target.checked)
                  }
                  className="h-5 w-5"
                />
                <span className="text-sm font-medium text-neutral-800">
                  Activar Doble Oferta 2 Productos
                </span>
              </label>
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={cfg.doble_oferta_dos.use_buttons}
                  onChange={(e) =>
                    setCfg({
                      ...cfg,
                      doble_oferta_dos: {
                        ...cfg.doble_oferta_dos,
                        use_buttons: e.target.checked,
                      },
                    })
                  }
                  className="h-5 w-5"
                />
                <span className="text-sm font-medium text-neutral-800">
                  Elección con botones (vs texto escrito)
                </span>
              </label>
              {cfg.doble_oferta_dos.use_buttons && (
                <label className="flex items-center gap-3 pl-8">
                  <input
                    type="checkbox"
                    checked={!!cfg.doble_oferta_dos.basico_first}
                    onChange={(e) =>
                      setCfg({
                        ...cfg,
                        doble_oferta_dos: {
                          ...cfg.doble_oferta_dos,
                          basico_first: e.target.checked,
                        },
                      })
                    }
                    className="h-5 w-5"
                  />
                  <span className="text-sm font-medium text-neutral-800">
                    Mostrar el BÁSICO arriba y el COMBO abajo (por defecto es al
                    revés)
                  </span>
                </label>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-4 rounded-lg border border-amber-300 bg-amber-50 p-4">
              <p className="w-full text-xs font-medium text-amber-800">
                ⚙️ Comportamiento del bot (global — aplica a todo el bot)
              </p>
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={cfg.silent_mode}
                  onChange={(e) =>
                    setCfg({ ...cfg, silent_mode: e.target.checked })
                  }
                  className="h-5 w-5"
                />
                <span className="text-sm font-medium text-neutral-800">
                  Modo silencioso: el bot NO charla (pero sí vende, lee
                  comprobantes y hace seguimientos)
                </span>
              </label>
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={cfg.followups_enabled}
                  onChange={(e) =>
                    setCfg({ ...cfg, followups_enabled: e.target.checked })
                  }
                  className="h-5 w-5"
                />
                <span className="text-sm font-medium text-neutral-800">
                  Seguimientos activados (desmarcar = apagar todos)
                </span>
              </label>
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={cfg.post_sale_reoffer}
                  onChange={(e) =>
                    setCfg({ ...cfg, post_sale_reoffer: e.target.checked })
                  }
                  className="h-5 w-5"
                />
                <span className="text-sm font-medium text-neutral-800">
                  Re-ofrecer regalo y volver a pedir correo tras la compra
                  (desmarcar = ofrecer regalo y pedir correo UNA sola vez, sin
                  re-ofrecer)
                </span>
              </label>
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={cfg.post_gift_comment_auto_human_enabled}
                  onChange={(e) =>
                    setCfg({
                      ...cfg,
                      post_gift_comment_auto_human_enabled: e.target.checked,
                    })
                  }
                  className="h-5 w-5"
                />
                <span className="text-sm font-medium text-neutral-800">
                  Pasar a HUMANO tras completar el regalo en esta modalidad
                </span>
              </label>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-neutral-700">
                Texto que pide elegir (al final de la intro)
              </label>
              <textarea
                className="w-full rounded-md border border-neutral-300 p-2 text-sm"
                rows={2}
                value={cfg.doble_oferta_dos.choice_prompt}
                onChange={(e) =>
                  setCfg({
                    ...cfg,
                    doble_oferta_dos: {
                      ...cfg.doble_oferta_dos,
                      choice_prompt: e.target.value,
                    },
                  })
                }
              />
              <p className="mt-1 text-xs text-neutral-500">
                Comodines: {"{{OPCION_1}}"} / {"{{OPCION_2}}"} (nombres) y{" "}
                {"{{precio_1}}"} / {"{{precio_2}}"} (precios).
              </p>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-neutral-700">
                Aclaración si responde ambiguo
              </label>
              <textarea
                className="w-full rounded-md border border-neutral-300 p-2 text-sm"
                rows={2}
                value={cfg.doble_oferta_dos.choice_clarification}
                onChange={(e) =>
                  setCfg({
                    ...cfg,
                    doble_oferta_dos: {
                      ...cfg.doble_oferta_dos,
                      choice_clarification: e.target.value,
                    },
                  })
                }
              />
            </div>

            <ObOptionEditor
              title="Opción 1 — Combo"
              value={cfg.doble_oferta_dos.combo}
              onChange={(v) =>
                setCfg({
                  ...cfg,
                  doble_oferta_dos: { ...cfg.doble_oferta_dos, combo: v },
                })
              }
              idPrefix="dd_combo"
              snapshot={snapshot}
              editSnapshot={editSnapshot}
              comboPrice={cfg.doble_oferta_dos.combo.price_soles}
              basicoPrice={cfg.doble_oferta_dos.basico.price_soles}
              previewContext={previewContextFromConfig(cfg)}
              hideDelivery
            />
            <ObOptionEditor
              title="Opción 2 — Básico"
              value={cfg.doble_oferta_dos.basico}
              onChange={(v) =>
                setCfg({
                  ...cfg,
                  doble_oferta_dos: { ...cfg.doble_oferta_dos, basico: v },
                })
              }
              idPrefix="dd_basico"
              snapshot={snapshot}
              editSnapshot={editSnapshot}
              comboPrice={cfg.doble_oferta_dos.combo.price_soles}
              basicoPrice={cfg.doble_oferta_dos.basico.price_soles}
              previewContext={previewContextFromConfig(cfg)}
              hideDelivery
            />
          </section>
        )}

        {cfg && tab === "contenido" && (
          <section className="space-y-4">
            {(() => {
              const isDobleOfertaDos = activeModality(cfg) === "doble_oferta_dos";
              return (
                <>
            <p className="text-sm text-neutral-600">
              {isDobleOfertaDos ? (
                <>
                  Esta modalidad usa solo <strong>Producto 1</strong> y{" "}
                  <strong>Producto 2</strong>. Cada uno tiene su nombre, contenido
                  y galería. No hay producto complementario ni pack en esta
                  modalidad.
                </>
              ) : (
                <>
                  Cada producto tiene su <strong>nombre</strong>, su{" "}
                  <strong>contenido</strong> (qué incluye / cómo se estudia) y su{" "}
                  <strong>galería de imágenes</strong>. El bot los usa para
                  responder y mandar archivos. <strong>El Cerebro no se toca.</strong>
                </>
              )}
            </p>

            <Collapsible title={isDobleOfertaDos ? "📚 Producto 1" : "📚 Producto 1 (principal)"}>
              <ContenidoProducto
                comodin="{{PRODUCTO}}"
                productName={cfg.product_name ?? ""}
                onProductName={(v) => {
                  editSnapshot("product_name");
                  setCfg({ ...cfg, product_name: v });
                }}
                content={cfg.course_content ?? ""}
                onContent={(v) => {
                  editSnapshot("contenido");
                  setCfg({ ...cfg, course_content: v });
                }}
                gallery={cfg.image_gallery ?? []}
                onGallery={(items) => setCfg({ ...cfg, image_gallery: items })}
                onSnapshot={snapshot}
                onEdit={editSnapshot}
              />
            </Collapsible>

            <Collapsible title={isDobleOfertaDos ? "📦 Producto 2" : "📦 Producto 2"}>
              {!isDobleOfertaDos && (
                <p className="mb-3 text-xs text-neutral-500">
                  Segundo producto configurado para modalidades con más de una
                  opción. Su <strong>nombre y contenido</strong> los usa el bot
                  cuando preguntan por ese producto. La <strong>galería</strong>{" "}
                  de aquí corresponde a ese producto.
                </p>
              )}
              <ContenidoProducto
                comodin="{{PRODUCTO2}}"
                productName={cfg.product_name_2 ?? ""}
                onProductName={(v) => {
                  editSnapshot("product_name_2");
                  setCfg({ ...cfg, product_name_2: v });
                }}
                content={cfg.course_content_2 ?? ""}
                onContent={(v) => {
                  editSnapshot("contenido_2");
                  setCfg({ ...cfg, course_content_2: v });
                }}
                gallery={cfg.image_gallery_2 ?? []}
                onGallery={(items) => setCfg({ ...cfg, image_gallery_2: items })}
                onSnapshot={snapshot}
                onEdit={editSnapshot}
              />
            </Collapsible>

            {!isDobleOfertaDos && (
              <Collapsible title="📦 Pack / opción conjunta">
              <p className="mb-3 text-xs text-neutral-500">
                Imagen/caption de una opción conjunta cuando la modalidad la
                usa. En Doble Oferta 2 Productos esta sección no aplica.
              </p>
              <GalleryEditor
                items={cfg.pack_gallery ?? []}
                onChange={(items) => setCfg({ ...cfg, pack_gallery: items })}
                onSnapshot={snapshot}
                onEdit={editSnapshot}
              />
            </Collapsible>
            )}

            <Collapsible title="🖼️ Info de contenido (imágenes al pedir el detalle)">
              <p className="mb-3 text-xs text-neutral-500">
                Cuando el cliente confirma que quiere{" "}
                <strong>ver qué incluye cada opción</strong>, el bot envía estas
                imágenes (cada una con su <strong>texto/caption</strong> de las
                galerías de arriba), en el orden en que aparecen.{" "}
                {isDobleOfertaDos
                  ? "En esta modalidad solo se usan Producto 1 y Producto 2."
                  : "Marca las que componen la oferta."}{" "}
                Si no marcas ninguna, el bot responde en texto.
              </p>
              {(() => {
                const options = productInfoOptions(cfg);
                if (options.length === 0) {
                  return (
                    <p className="text-xs text-neutral-400">
                      Agrega primero imágenes (con su <em>tema</em>) en las
                      galerías de los productos de arriba.
                    </p>
                  );
                }
                const allowedTopics = options.map((option) => option.topic);
                const selected = (cfg.product_info_topics ?? []).filter((topic) =>
                  allowedTopics.includes(topic)
                );
                const toggle = (topic: string, on: boolean) => {
                  const set = new Set(selected);
                  if (on) set.add(topic);
                  else set.delete(topic);
                  const next = allowedTopics.filter((t) => set.has(t));
                  editSnapshot("product_info_topics");
                  setCfg({ ...cfg, product_info_topics: next });
                };
                const labelByTopic = new Map(
                  options.map((option) => [option.topic, option.label])
                );
                const selectedLabels = selected
                  .map((topic) => labelByTopic.get(topic))
                  .filter(Boolean);
                return (
                  <div className="space-y-2">
                    {options.map((option) => (
                      <label
                        key={option.topic}
                        className="flex items-center gap-2 text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={selected.includes(option.topic)}
                          onChange={(e) =>
                            toggle(option.topic, e.target.checked)
                          }
                        />
                        <span>{option.label}</span>
                      </label>
                    ))}
                    {selected.length > 0 && (
                      <p className="pt-1 text-xs text-neutral-500">
                        Se enviarán en este orden:{" "}
                        <strong>{selectedLabels.join(" → ")}</strong>
                      </p>
                    )}
                  </div>
                );
              })()}
              {activeModality(cfg) !== "doble_oferta_dos" &&
                (() => {
                const topics = productInfoOptions(cfg).map(
                  (option) => option.topic
                );
                return (
                  <div className="mt-4 border-t border-neutral-200 pt-3">
                    <p className="mb-1 text-sm font-medium">
                      Imagen del complemento (bajo pedido)
                    </p>
                    <p className="mb-2 text-xs text-neutral-500">
                      Si el cliente pregunta <strong>específicamente</strong> por
                      el complemento, el bot manda SOLO esta imagen (con su
                      caption de la galería). Va aparte del paquete de arriba.
                      Déjalo en “(ninguna)” para no blindarlo.
                    </p>
                    <select
                      className="w-full rounded border border-neutral-300 px-2 py-1 text-sm"
                      value={cfg.complement_info_topic ?? ""}
                      onChange={(e) => {
                        editSnapshot("complement_info_topic");
                        setCfg({
                          ...cfg,
                          complement_info_topic: e.target.value,
                        });
                      }}
                    >
                      <option value="">(ninguna)</option>
                      {topics.map((topic) => (
                        <option key={topic} value={topic}>
                          {topic}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })()}
            </Collapsible>
                </>
              );
            })()}

          </section>
        )}

        {cfg && tab === "cerebro" && (
          <section className="space-y-4">
            <p className="text-sm text-neutral-600">
              El <strong>cerebro</strong> del bot, partido en cajas por tema —
              esto es lo que cambias al{" "}
              <strong>clonar el bot para otro producto</strong> (sobre todo la
              caja <em>Rol y producto</em>). El precio se inyecta solo donde
              escribas{" "}
              <code className="rounded bg-neutral-200 px-1">{"{{PRICE}}"}</code>.
              Los marcadores internos, la inyección de precio y la lectura de
              comprobantes van por dentro y <strong>no se pueden romper</strong>.
              La caja <em>Extra</em> es libre: agrega ahí lo que quieras.
            </p>
            {cfg.prompt_section_defs.map(({ key, label }) => {
              const value = cfg.prompt_sections[key] ?? "";
              const def = cfg.prompt_section_defaults[key] ?? "";
              const changed = value !== def;
              return (
                <Collapsible key={key} title={label}>
                  <div className="mb-2 flex items-center justify-end gap-3">
                    <span className="text-xs text-neutral-400">
                      {value.length.toLocaleString()} caract.
                    </span>
                    <button
                      type="button"
                      disabled={!changed}
                      onClick={() => {
                        editSnapshot(`prompt_restore_${key}`);
                        setCfg({
                          ...cfg,
                          prompt_sections: {
                            ...cfg.prompt_sections,
                            [key]: def,
                          },
                        });
                      }}
                      className={`rounded border px-2 py-1 text-xs ${
                        changed
                          ? "border-neutral-300 text-neutral-700 hover:bg-neutral-100"
                          : "cursor-not-allowed border-neutral-200 text-neutral-300"
                      }`}
                    >
                      ↩️ Restaurar
                    </button>
                  </div>
                  <textarea
                    value={value}
                    onChange={(e) =>
                      setCfg({
                        ...cfg,
                        prompt_sections: {
                          ...cfg.prompt_sections,
                          [key]: e.target.value,
                        },
                      })
                    }
                    onFocus={() => editSnapshot(`prompt_${key}`)}
                    rows={key === "extra" ? 6 : 14}
                    spellCheck={false}
                    placeholder={
                      key === "extra"
                        ? "Instrucciones adicionales libres (opcional)…"
                        : ""
                    }
                    className="w-full rounded border border-neutral-300 bg-white p-3 font-mono text-xs leading-relaxed text-neutral-900"
                  />
                </Collapsible>
              );
            })}
          </section>
        )}
      </main>
    </div>
    </EditorPreviewContext.Provider>
    </PlaceholderOptionsContext.Provider>
  );
}

// ── Nombre + alias de un producto de la Bioferta ────────────────────────────
// El `name` es lo que el cliente escribe para elegir; `aliases` son palabras
// extra que también cuentan (separadas por coma en el input).
function NameAliases({
  value,
  onChange,
}: {
  value: { name: string; aliases: string[] };
  onChange: (v: { name: string; aliases: string[] }) => void;
}) {
  const [aliasesDraft, setAliasesDraft] = useState(value.aliases.join(", "));
  const aliasesEditing = useRef(false);
  const parseAliases = (text: string): string[] =>
    text
      .split(/[,\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
  useEffect(() => {
    if (!aliasesEditing.current) setAliasesDraft(value.aliases.join(", "));
  }, [value.aliases]);
  return (
    <div className="space-y-2">
      <div>
        <label className="block text-xs font-medium text-neutral-700">
          Nombre (lo que el cliente escribe para elegir)
        </label>
        <input
          value={value.name}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
          className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
          placeholder="Ej: nombre corto"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-neutral-700">
          Otras palabras que también cuentan (separadas por coma) — opcional
        </label>
        <textarea
          rows={3}
          value={aliasesDraft}
          onFocus={() => {
            aliasesEditing.current = true;
          }}
          onInput={(e) => {
            setAliasesDraft(e.currentTarget.value);
          }}
          onBlur={(e) => {
            aliasesEditing.current = false;
            const cleaned = parseAliases(e.currentTarget.value);
            setAliasesDraft(cleaned.join(", "));
            onChange({ ...value, aliases: cleaned });
          }}
          onChange={(e) =>
            onChange({
              ...value,
              // No recortamos/filtramos aquí: si no, la coma recién tecleada
              // desaparecería y no podrías escribirla. Se limpia al guardar.
              aliases: parseAliases(e.target.value),
            })
          }
          className="mt-1 w-full resize-y rounded border border-neutral-300 px-3 py-2 text-sm leading-5"
          placeholder={"Ej:\nsuper\nsuper kit\nel de las chicas"}
        />
      </div>
    </div>
  );
}

// ── Vista previa de botones de pago (mini WhatsApp) ─────────────────────────
// ── Menú de pago de un seguimiento (foto/video + texto + botones) ───────────
// ── Bloque de contenido de UN producto (nombre + descripción + galería) ─────
function ContenidoProducto({
  comodin,
  productName,
  onProductName,
  content,
  onContent,
  gallery,
  onGallery,
  onSnapshot,
  onEdit,
}: {
  comodin: string;
  productName: string;
  onProductName: (v: string) => void;
  content: string;
  onContent: (v: string) => void;
  gallery: GalleryItem[];
  onGallery: (items: GalleryItem[]) => void;
  onSnapshot: () => void;
  onEdit: (key: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
        <label className="text-sm font-semibold text-neutral-800">
          🏷️ Nombre del producto (comodín{" "}
          <code className="rounded bg-neutral-200 px-1">{comodin}</code>)
        </label>
        <p className="mt-1 text-xs text-neutral-600">
          Donde escribas{" "}
          <code className="rounded bg-neutral-200 px-1">{comodin}</code> en el
          prompt o los mensajes, el bot pone este nombre.
        </p>
        <input
          type="text"
          value={productName}
          onChange={(e) => onProductName(e.target.value)}
          placeholder="Ej: Nombre del producto"
          className="mt-2 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm"
        />
      </div>

      <div>
        <p className="mb-1 text-sm text-neutral-600">
          <strong>Contenido del curso</strong> y{" "}
          <strong>cómo se estudia</strong> (qué incluye, páginas, imprimible…).
          El bot lo usa cuando preguntan.
        </p>
        <EditorEmojiTextarea
          value={content}
          onChange={onContent}
          rows={14}
          className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm leading-relaxed text-neutral-800"
        />
      </div>

      <GalleryEditor
        items={gallery}
        onChange={onGallery}
        onSnapshot={onSnapshot}
        onEdit={onEdit}
      />
    </div>
  );
}

// ── Galería de muestras que el bot manda según la pregunta ───────────
type GalleryItem = {
  topic: string;
  keywords?: string[];
  when: string;
  media_type: GalleryMediaType;
  drive_url: string;
  caption: string;
  enabled?: boolean;
};

function parseGalleryKeywords(value: string): string[] {
  return value
    .split(/[\n,;]+/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatGalleryKeywords(value: string[] | undefined): string {
  return (value ?? []).join("\n");
}

function GalleryEditor({
  items,
  onChange,
  onSnapshot,
  onEdit,
}: {
  items: GalleryItem[];
  onChange: (items: GalleryItem[]) => void;
  onSnapshot: () => void;
  onEdit: (key: string) => void;
}) {
  const [keywordDrafts, setKeywordDrafts] = useState<Record<number, string>>({});
  const update = (i: number, patch: Partial<GalleryItem>) =>
    onChange(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  return (
    <div className="space-y-3 rounded-lg border border-neutral-300 bg-neutral-50 p-4">
      <div>
        <h3 className="text-sm font-semibold text-neutral-800">
          🖼️ Galería de muestras
        </h3>
        <p className="mt-1 text-xs text-neutral-600">
          El bot manda una de estas <strong>según lo que pregunte</strong> el
          cliente (ej: "¿cuántas páginas?" → la imagen del contenido). Solo cuando
          hay una necesidad clara, y nunca la misma dos veces. El <em>tema</em> es
          la palabra clave; <em>cuándo usarla</em> le dice al bot en qué caso
          enviarla.
        </p>
      </div>
      {items.map((it, i) => (
        <div
          key={i}
          className={`rounded-md border border-neutral-300 bg-white p-3 ${
            it.enabled === false ? "opacity-60" : ""
          }`}
        >
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="space-y-2">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={it.topic}
              onChange={(e) => {
                onEdit(`gal${i}:topic`);
                update(i, { topic: e.target.value });
              }}
              placeholder="Tema (ej: contenido)"
              className="flex-1 rounded border border-neutral-300 px-2 py-1 text-xs"
            />
            <select
              value={it.media_type}
              onChange={(e) => {
                onEdit(`gal${i}:type`);
                update(i, { media_type: e.target.value as GalleryMediaType });
              }}
              className="rounded border border-neutral-300 px-1 py-1 text-xs"
            >
              <option value="image">📷 Foto</option>
              <option value="video">🎥 Video</option>
              <option value="document">📄 PDF</option>
              <option value="audio">🎵 Audio</option>
            </select>
            <button
              type="button"
              onClick={() => {
                onEdit(`gal${i}:enabled`);
                update(i, { enabled: it.enabled === false });
              }}
              className={`rounded border px-2 py-1 text-xs font-semibold ${
                it.enabled === false
                  ? "border-neutral-300 bg-neutral-100 text-neutral-400"
                  : "border-emerald-300 bg-emerald-50 text-emerald-700"
              }`}
            >
              {it.enabled === false ? "OFF" : "ON"}
            </button>
            <button
              type="button"
              onClick={() => {
                onSnapshot();
                onChange(items.filter((_, idx) => idx !== i));
              }}
              className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
            >
              🗑️
            </button>
          </div>
          <input
            type="text"
            value={it.drive_url}
            onChange={(e) => {
              onEdit(`gal${i}:url`);
              update(i, { drive_url: e.target.value });
            }}
            placeholder="Enlace de Google Drive (imagen, video, PDF o audio)"
            className="w-full rounded border border-neutral-300 px-2 py-1 text-xs"
          />
          <input
            type="text"
            value={it.when}
            onChange={(e) => {
              onEdit(`gal${i}:when`);
              update(i, { when: e.target.value });
            }}
            placeholder="¿Cuándo enviarla? (ej: cuando preguntan cuántas páginas o qué incluye)"
            className="w-full rounded border border-neutral-300 px-2 py-1 text-xs"
          />
          <textarea
            rows={2}
            value={keywordDrafts[i] ?? formatGalleryKeywords(it.keywords)}
            onChange={(e) => {
              const value = e.target.value;
              onEdit(`gal${i}:keywords`);
              setKeywordDrafts((prev) => ({ ...prev, [i]: value }));
              update(i, { keywords: parseGalleryKeywords(value) });
            }}
            placeholder="Palabras clave locales (no van al prompt): separa con coma, punto y coma o Enter"
            className="w-full rounded border border-neutral-300 px-2 py-1 text-xs"
          />
          <p className="-mt-1 text-[10px] leading-snug text-neutral-500">
            Se usan para detectar pedidos de esta muestra sin gastar tokens.
          </p>
          <EditorEmojiTextarea
            rows={3}
            value={it.caption}
            onChange={(value) => {
              onEdit(`gal${i}:cap`);
              update(i, { caption: value });
            }}
            placeholder="Texto que acompaña el archivo (opcional). Usa Enter para saltos de línea."
            className="w-full rounded border border-neutral-300 px-2 py-1 text-xs"
          />
            </div>
            <div className="lg:sticky lg:top-4 lg:self-start">
              {it.drive_url.trim() || it.caption.trim() ? (
                <ChatPreview
                  steps={[
                    {
                      type: it.media_type,
                      drive_url: it.drive_url,
                      texts: [it.caption],
                      delay_after_sec: 0,
                    },
                  ]}
                />
              ) : (
                <p className="py-6 text-center text-[11px] text-neutral-400">
                  Agrega un enlace o texto para ver la vista previa.
                </p>
              )}
            </div>
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={() => {
          onSnapshot();
          onChange([
            ...items,
            {
              topic: "",
              when: "",
              media_type: "image",
              drive_url: "",
              caption: "",
              keywords: [],
              enabled: true,
            },
          ]);
        }}
        className="w-full rounded-md border-2 border-dashed border-neutral-300 py-2 text-sm text-neutral-500 hover:border-emerald-400 hover:text-emerald-600"
      >
        ➕ Agregar muestra
      </button>
    </div>
  );
}

function DobleOfertaChoiceMenu({
  value,
  onChange,
  onEdit,
}: {
  value: FullConfig["doble_oferta_dos"];
  onChange: (v: FullConfig["doble_oferta_dos"]) => void;
  onEdit: () => void;
}) {
  const set = (patch: Partial<FullConfig["doble_oferta_dos"]>) => {
    onEdit();
    onChange({ ...value, ...patch });
  };
  const buttons = [
    { label: value.combo?.name?.trim() || "Combo", method: "ob_combo" },
    { label: value.basico?.name?.trim() || "BÃ¡sico", method: "ob_basico" },
  ];
  const text = value.choice_prompt?.trim();
  const buttonPrompt =
    value.choice_buttons_prompt?.trim() || "Â¿QuÃ© opciÃ³n prefieres?";

  return (
    <div className="mt-4">
      <Collapsible
        title="ðŸ”˜ Botones de elecciÃ³n de oferta"
        defaultOpen={false}
      >
        <div className="grid gap-4 p-4 lg:grid-cols-2">
          <div className="space-y-3">
            <p className="text-xs text-neutral-600">
              Solo aplica en <strong>Doble Oferta 2 Productos</strong>. Se envÃ­a
              al final de la intro, antes de cualquier menÃº de pago.
            </p>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-neutral-700">
              <input
                type="checkbox"
                checked={!!value.use_buttons}
                onChange={(e) => set({ use_buttons: e.target.checked })}
              />
              Mostrar botones para elegir oferta
            </label>
            {value.use_buttons && (
              <label className="flex cursor-pointer items-center gap-2 pl-6 text-sm text-neutral-700">
                <input
                  type="checkbox"
                  checked={!!value.separate_bubble}
                  onChange={(e) => set({ separate_bubble: e.target.checked })}
                />
                Texto y botones en burbujas separadas
              </label>
            )}
            <div>
              <label className="text-xs font-medium text-neutral-600">
                Texto principal de elecciÃ³n
              </label>
              <textarea
                value={value.choice_prompt ?? ""}
                onChange={(e) => set({ choice_prompt: e.target.value })}
                rows={4}
                className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm"
              />
              <p className="mt-1 text-[11px] text-neutral-500">
                Comodines: <code>{"{{OPCION_1}}"}</code>,{" "}
                <code>{"{{OPCION_2}}"}</code>, <code>{"{{precio_1}}"}</code>,{" "}
                <code>{"{{precio_2}}"}</code>.
              </p>
            </div>
            {value.use_buttons && value.separate_bubble && (
              <div>
                <label className="text-xs font-medium text-neutral-600">
                  Texto corto de la burbuja de botones
                </label>
                <input
                  type="text"
                  value={value.choice_buttons_prompt ?? ""}
                  onChange={(e) =>
                    set({ choice_buttons_prompt: e.target.value })
                  }
                  placeholder="Â¿QuÃ© opciÃ³n prefieres?"
                  className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm"
                />
              </div>
            )}
          </div>

          <div className="lg:sticky lg:top-4 lg:self-start">
            <p className="mb-1 text-[11px] font-medium text-neutral-500">
              Vista previa
            </p>
            <div className="space-y-2 rounded-lg bg-[#e5ddd5] p-3">
              {(!value.use_buttons || value.separate_bubble) && (
                <div className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-white px-3 py-2 text-sm text-neutral-800 shadow-sm">
                  {text || "(texto principal)"}
                </div>
              )}
              {value.use_buttons && value.separate_bubble && (
                <ButtonsPreview prompt={buttonPrompt} buttons={buttons} />
              )}
              {value.use_buttons && !value.separate_bubble && (
                <ButtonsPreview
                  prompt={text || "Elige tu opciÃ³n ðŸ‘‡"}
                  buttons={buttons}
                />
              )}
            </div>
          </div>
        </div>
      </Collapsible>
    </div>
  );
}

function FollowupPaymentMenu({
  menu,
  buttonsPrompt,
  buttons,
  onChange,
  onEdit,
  title = "💳 Menú de pago de este seguimiento",
  where = "este seguimiento",
}: {
  menu?: EditorPaymentMenu;
  buttonsPrompt: string;
  buttons: { label: string; method: string }[];
  onChange: (m: EditorPaymentMenu) => void;
  onEdit: () => void;
  title?: string;
  where?: string;
}) {
  const m: EditorPaymentMenu = menu ?? {};
  const set = (patch: Partial<EditorPaymentMenu>) => {
    onEdit();
    onChange({ ...m, ...patch });
  };
  const kind = m.media_type === "video" ? "video" : "image";
  const url = (m.media_url ?? "").trim();
  const text = (m.text ?? "").trim();

  return (
    <div className="mt-4">
      <Collapsible title={title} defaultOpen={false}>
        <div className="space-y-4 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-neutral-600">
              Se envía al <strong>final</strong> de {where}: una foto/video con
              su texto y, si quieres, los botones de pago.
            </p>
            <button
              type="button"
              onClick={() => set({ enabled: !m.enabled })}
              className={`shrink-0 rounded border px-2 py-1 text-xs font-semibold ${
                m.enabled
                  ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                  : "border-neutral-300 bg-neutral-100 text-neutral-400"
              }`}
            >
              {m.enabled ? "ON" : "OFF"}
            </button>
          </div>

          {m.enabled && (
            <div className="grid gap-4 lg:grid-cols-2">
              {/* Editor */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <label className="text-xs font-medium text-neutral-600">
                    Tipo de archivo:
                  </label>
                  <select
                    value={kind}
                    onChange={(e) =>
                      set({ media_type: e.target.value as "image" | "video" })
                    }
                    className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs"
                  >
                    <option value="image">📷 Foto</option>
                    <option value="video">🎥 Video</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-neutral-600">
                    Enlace de Google Drive (opcional)
                  </label>
                  <input
                    type="text"
                    value={m.media_url ?? ""}
                    onChange={(e) => set({ media_url: e.target.value })}
                    placeholder="https://drive.google.com/…"
                    className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-neutral-600">
                    Texto de este menú
                  </label>
                  <textarea
                    value={m.text ?? ""}
                    onChange={(e) => set({ text: e.target.value })}
                    rows={3}
                    placeholder="Ej: ¿Te ayudo a completar tu pago? Elige tu método 👇"
                    className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm"
                  />
                  <p className="mt-1 text-[11px] text-neutral-500">
                    Puedes usar <code>{"{{PRICE}}"}</code> para el precio.
                  </p>
                </div>
                <label className="flex cursor-pointer items-center gap-2 text-sm text-neutral-700">
                  <input
                    type="checkbox"
                    checked={!!m.use_buttons}
                    onChange={(e) => set({ use_buttons: e.target.checked })}
                  />
                  Mostrar botones de método de pago
                </label>
                {m.use_buttons && (
                  <label className="flex cursor-pointer items-center gap-2 pl-6 text-sm text-neutral-700">
                    <input
                      type="checkbox"
                      checked={!!m.separate_bubble}
                      onChange={(e) =>
                        set({ separate_bubble: e.target.checked })
                      }
                    />
                    Botones en burbuja aparte
                  </label>
                )}
              </div>

              {/* Preview */}
              <div className="lg:sticky lg:top-4 lg:self-start">
                <p className="mb-1 text-[11px] font-medium text-neutral-500">
                  Vista previa
                </p>
                <div className="space-y-2 rounded-lg bg-[#e5ddd5] p-3">
                  {/* Burbuja media + texto (siempre que NO sea botones-misma-burbuja) */}
                  {(!m.use_buttons || m.separate_bubble) && (
                    <div className="max-w-[85%] overflow-hidden rounded-lg bg-white shadow-sm">
                      {url && (
                        <div className="flex h-24 items-center justify-center bg-neutral-200 text-3xl">
                          {kind === "video" ? "🎥" : "🖼️"}
                        </div>
                      )}
                      {text && (
                        <div className="whitespace-pre-wrap px-3 py-2 text-sm text-neutral-800">
                          {text}
                        </div>
                      )}
                      {!url && !text && (
                        <div className="px-3 py-2 text-xs italic text-neutral-400">
                          (sin contenido)
                        </div>
                      )}
                    </div>
                  )}
                  {/* Botones misma burbuja: media arriba + texto + botones */}
                  {m.use_buttons && !m.separate_bubble && (
                    <div className="max-w-[85%] overflow-hidden rounded-lg bg-white shadow-sm">
                      {url && (
                        <div className="flex h-24 items-center justify-center bg-neutral-200 text-3xl">
                          {kind === "video" ? "🎥" : "🖼️"}
                        </div>
                      )}
                      <div className="whitespace-pre-wrap px-3 py-2 text-sm text-neutral-800">
                        {text || buttonsPrompt.trim() || "Elige tu método 👇"}
                      </div>
                      {(buttons.filter((b) => b.label.trim()).length
                        ? buttons.filter((b) => b.label.trim())
                        : [
                            { label: "Yape", method: "yape" },
                            { label: "Plin", method: "plin" },
                            { label: "BCP", method: "bcp" },
                          ]
                      )
                        .slice(0, 3)
                        .map((b, i) => (
                          <div
                            key={i}
                            className="flex items-center justify-center gap-1 border-t border-neutral-200 px-3 py-2 text-sm font-medium text-[#1ba7e0]"
                          >
                            <span className="text-base leading-none">↩</span>
                            {b.label.trim() || "(sin etiqueta)"}
                          </div>
                        ))}
                    </div>
                  )}
                  {/* Botones en burbuja aparte */}
                  {m.use_buttons && m.separate_bubble && (
                    <ButtonsPreview prompt={buttonsPrompt} buttons={buttons} />
                  )}
                </div>
                {m.use_buttons && (
                  <p className="mt-1 text-[11px] text-neutral-500">
                    Los botones son los mismos de la pestaña <strong>Pago</strong>{" "}
                    (compartidos por todos los seguimientos).
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </Collapsible>
    </div>
  );
}

function ButtonsPreview({
  prompt,
  buttons,
}: {
  prompt: string;
  buttons: { label: string; method: string }[];
}) {
  const filled = buttons.filter((b) => b.label.trim());
  const shown =
    filled.length > 0
      ? filled
      : [
          { label: "Yape", method: "yape" },
          { label: "Plin", method: "plin" },
          { label: "BCP", method: "bcp" },
        ];
  return (
    <div className="rounded-lg bg-[#e5ddd5] p-3">
      <div className="max-w-[85%] overflow-hidden rounded-lg bg-white shadow-sm">
        <div className="whitespace-pre-wrap px-3 py-2 text-sm text-neutral-800">
          {prompt.trim() || "Puedes elegir tu método de pago 👇"}
        </div>
        {shown.slice(0, 3).map((b, i) => (
          <div
            key={i}
            className="flex items-center justify-center gap-1 border-t border-neutral-200 px-3 py-2 text-sm font-medium text-[#1ba7e0]"
          >
            <span className="text-base leading-none">↩</span>
            {b.label.trim() || "(sin etiqueta)"}
          </div>
        ))}
      </div>
      {filled.length === 0 && (
        <p className="mt-1 text-[11px] text-neutral-500">
          (Ejemplo por defecto. Agrega tus botones arriba para verlos aquí.)
        </p>
      )}
    </div>
  );
}

// ── Tarjeta colapsable (mostrar/ocultar para organizar el editor) ───────────
function Collapsible({
  title,
  titleKey,
  titleClassName,
  bodyClassName,
  headerActions,
  onDragOver,
  onDrop,
  defaultOpen = false,
  openSignal,
  closeSignal,
  children,
}: {
  title: ReactNode;
  titleKey?: string;
  titleClassName?: string;
  bodyClassName?: string;
  headerActions?: ReactNode;
  onDragOver?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop?: (e: React.DragEvent<HTMLDivElement>) => void;
  defaultOpen?: boolean;
  openSignal?: number;
  closeSignal?: number;
  children: ReactNode | (() => ReactNode);
}) {
  const storageKey = `wf:collapsible:${titleKey ?? String(title)}`;
  const [open, setOpen] = useState(defaultOpen);
  // Recupera el estado (abierto/cerrado) guardado para que PERSISTA al cambiar
  // de pestaña o recargar — antes se reiniciaba a cerrado.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved !== null) setOpen(saved === "1");
    } catch {}
  }, [storageKey]);
  useEffect(() => {
    if (openSignal === undefined) return;
    setOpen(true);
    try {
      localStorage.setItem(storageKey, "1");
    } catch {}
  }, [openSignal, storageKey]);
  useEffect(() => {
    if (closeSignal === undefined) return;
    setOpen(false);
    try {
      localStorage.setItem(storageKey, "0");
    } catch {}
  }, [closeSignal, storageKey]);
  useEffect(() => {
    const onCollapseAll = (event: Event) => {
      const prefix =
        event instanceof CustomEvent && typeof event.detail?.prefix === "string"
          ? event.detail.prefix
          : "";
      if (prefix && titleKey && !titleKey.startsWith(prefix)) return;
      setOpen(false);
      try {
        localStorage.setItem(storageKey, "0");
      } catch {}
    };
    window.addEventListener("wf:collapse-all", onCollapseAll);
    return () => window.removeEventListener("wf:collapse-all", onCollapseAll);
  }, [storageKey, titleKey]);
  const toggle = () =>
    setOpen((o) => {
      const next = !o;
      try {
        localStorage.setItem(storageKey, next ? "1" : "0");
      } catch {}
      return next;
    });
  const body = open
    ? typeof children === "function"
      ? children()
      : children
    : null;
  return (
    <div
      onDragOver={onDragOver}
      onDrop={onDrop}
      className="rounded-lg border border-neutral-300 bg-neutral-50"
    >
      <div
        role="button"
        tabIndex={0}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggle();
          }
        }}
        className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-neutral-200/70 ${
          titleClassName ?? "bg-neutral-100"
        } ${
          open ? "rounded-t-lg border-b border-neutral-200" : "rounded-lg"
        }`}
      >
        <span className="flex items-center gap-2 text-base font-bold">
          <span className="text-emerald-600">{open ? "▼" : "▶"}</span>
          {title}
        </span>
        <span className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {headerActions}
          <span
            className={`rounded-md border px-3 py-1 text-xs font-semibold ${
              open
                ? "border-neutral-300 bg-white text-neutral-700"
                : "border-emerald-400 bg-emerald-50 text-emerald-700"
            }`}
          >
            {open ? "▲ Ocultar" : "▼ Mostrar"}
          </span>
        </span>
      </div>
      {open && <div className={`px-4 pb-4 pt-3 ${bodyClassName ?? ""}`}>{body}</div>}
    </div>
  );
}

// ── Editor de una opción del Order Bump (combo / básico) ────────────────────
function PlaceholderHelp() {
  const items = [
    ["{{NOMBRE}}", "Nombre del cliente si WhatsApp lo tiene."],
    ["{{NOMBRE_WHATSAPP}}", "Nombre registrado en WhatsApp."],
    ["{{PRODUCTO}}", "Nombre del producto principal."],
    ["{{PRODUCTO2}}", "Nombre del segundo producto."],
    ["{precio} / {price}", "Precio único del producto u opción ya elegida."],
    ["{{MONEDA}}", "Símbolo de moneda configurado."],
    ["{{OPCION_1}}", "Nombre de la opción 1."],
    ["{{PRECIO_1}}", "Precio de la opción 1."],
    ["{{OPCION_2}}", "Nombre de la opción 2."],
    ["{{PRECIO_2}}", "Precio de la opción 2."],
    ["{{PRECIO_EXTRA}}", "Diferencia entre opción 1 y opción 2."],
  ] as const;
  return (
    <div className="border-t border-neutral-200 bg-neutral-50 px-4 py-3">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {items.map(([token, meaning]) => (
          <div
            key={token}
            className="rounded-md border border-neutral-200 bg-white px-3 py-2"
          >
            <code className="block text-xs font-semibold text-emerald-700">
              {token}
            </code>
            <p className="mt-1 text-[11px] leading-snug text-neutral-600">
              {meaning}
            </p>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-neutral-500">
        En mensajes sin opción elegida usa {"{{PRECIO_1}}"} y {"{{PRECIO_2}}"},
        no {"{precio}"}.
      </p>
    </div>
  );
}

function ObOptionEditor({
  title,
  value,
  onChange,
  idPrefix,
  snapshot,
  editSnapshot,
  comboPrice,
  basicoPrice,
  previewContext,
  hideDelivery,
}: {
  title: string;
  value: ObOption;
  onChange: (v: ObOption) => void;
  idPrefix: string;
  snapshot: () => void;
  editSnapshot: (key: string) => void;
  comboPrice?: number;
  basicoPrice?: number;
  previewContext?: PreviewContext;
  hideDelivery?: boolean;
}) {
  return (
    <Collapsible title={title}>
      <NameAliases
        value={{ name: value.name, aliases: value.aliases }}
        onChange={(v) => onChange({ ...value, ...v })}
      />
      <div className="mt-3 flex flex-wrap gap-4">
        <div>
          <label className="block text-xs font-medium text-neutral-700">
            Precio normal
          </label>
          <input
            type="number"
            value={value.price_soles}
            onChange={(e) =>
              onChange({ ...value, price_soles: Number(e.target.value) || 0 })
            }
            className="mt-1 w-32 rounded border border-neutral-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-neutral-700">
            Precio promo (oferta)
          </label>
          <input
            type="number"
            value={value.discount_price_soles ?? 0}
            onChange={(e) =>
              onChange({
                ...value,
                discount_price_soles: Number(e.target.value) || 0,
              })
            }
            className="mt-1 w-32 rounded border border-neutral-300 px-3 py-2 text-sm"
          />
          <p className="mt-1 text-[11px] text-neutral-500">
            Se usa cuando el cliente ya entró en etapa de oferta. 0 = sin promo.
          </p>
        </div>
      </div>
      <div className="mt-4">
        <label className="block text-xs font-medium text-neutral-700">
          Regalos incluidos
        </label>
        <textarea
          value={value.regalos ?? ""}
          onChange={(e) => onChange({ ...value, regalos: e.target.value })}
          rows={3}
          className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
          placeholder="Ej.: incluye bonos, plantillas extra, guía rápida, regalo por comentar..."
        />
        <p className="mt-1 text-[11px] text-neutral-500">
          Solo ayuda al bot a explicar qué regalos vienen con esta opción. No
          cambia precios, comprobantes ni entrega.
        </p>
      </div>
      <h3 className="mb-2 mt-4 text-sm font-semibold text-neutral-800">
        Respuesta al elegir (método de pago + precio)
      </h3>
      <StepEditorPreviewPair
        steps={value.response}
        onChange={(steps) => onChange({ ...value, response: steps })}
        onSnapshot={snapshot}
        onEdit={editSnapshot}
        idPrefix={`${idPrefix}_resp`}
        priceSoles={value.price_soles}
        comboPrice={comboPrice}
        basicoPrice={basicoPrice}
        previewContext={previewContext}
      />
      <h3 className="mb-1 mt-5 text-sm font-semibold text-neutral-800">
        Respuestas al confirmar el método de pago
      </h3>
      <p className="mb-3 text-xs text-neutral-500">
        Estos textos se copian inicialmente desde la pestaña Pago y luego puedes
        personalizarlos de forma independiente. Usa <code>{"{price}"}</code> o{" "}
        <code>{"{precio}"}</code> para insertar automáticamente el precio normal
        o promocional de esta opción. El preview muestra el precio normal.
      </p>
      <div className="space-y-4">
        {(
          [
            ["yape", "Yape / Plin"],
            ["bcp_transferencia", "BCP / Transferencia"],
            ["efectivo", "Efectivo"],
          ] as [keyof ObOption["payment_responses"], string][]
        ).map(([key, label]) => (
          <div
            key={key}
            className="rounded-lg border border-neutral-300 bg-neutral-50 p-4"
          >
            <h4 className="mb-3 text-sm font-semibold text-neutral-800">
              {label}
            </h4>
            <StepEditorPreviewPair
              steps={value.payment_responses[key]}
              onChange={(steps) =>
                onChange({
                  ...value,
                  payment_responses: {
                    ...value.payment_responses,
                    [key]: steps,
                  },
                })
              }
              onSnapshot={snapshot}
              onEdit={editSnapshot}
              idPrefix={`${idPrefix}_pay_${key}`}
              priceSoles={value.price_soles}
              comboPrice={comboPrice}
              basicoPrice={basicoPrice}
              previewContext={previewContext}
            />
          </div>
        ))}
      </div>
      {!hideDelivery && (
        <>
          <h3 className="mb-2 mt-4 text-sm font-semibold text-neutral-800">
            Entrega (lo que recibe al pagar)
          </h3>
          <StepEditorPreviewPair
            steps={value.delivery}
            onChange={(steps) => onChange({ ...value, delivery: steps })}
            onSnapshot={snapshot}
            onEdit={editSnapshot}
            idPrefix={`${idPrefix}_del`}
            comboPrice={comboPrice}
            basicoPrice={basicoPrice}
            previewContext={previewContext}
          />
        </>
      )}
    </Collapsible>
  );
}

// ── Simulador de chat de WhatsApp ───────────────────────────────────────────
// Muestra cómo le llega al cliente la secuencia de pasos: negritas (*..*),
// cursivas (_.._), tachado (~..~), emojis e imágenes. Como el bot elige UNA
// variante al azar por paso, muestra una corrida; el botón "Variar" re-arma
// otra combinación al azar (igual que el bot real con un cliente).

function driveThumb(url: string): string | null {
  if (!url) return null;
  const m = url.match(/\/d\/([-\w]{10,})/) || url.match(/[?&]id=([-\w]{10,})/);
  return m ? `https://drive.google.com/thumbnail?id=${m[1]}&sz=w600` : null;
}

// Convierte el formato de WhatsApp de UNA línea a nodos (negrita/cursiva/etc.).
function parseWaInline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const re = /(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~|```[^`]+```)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last)
      parts.push(<TwemojiText key={key++} text={text.slice(last, m.index)} />);
    const tok = m[0];
    if (tok.startsWith("```"))
      parts.push(
        <code key={key++} className="font-mono text-[0.92em]">
          {tok.slice(3, -3)}
        </code>
      );
    else if (tok[0] === "*")
      parts.push(
        <strong key={key++}>
          <TwemojiText text={tok.slice(1, -1)} />
        </strong>
      );
    else if (tok[0] === "_")
      parts.push(
        <em key={key++}>
          <TwemojiText text={tok.slice(1, -1)} />
        </em>
      );
    else
      parts.push(
        <s key={key++}>
          <TwemojiText text={tok.slice(1, -1)} />
        </s>
      );
    last = m.index + tok.length;
  }
  if (last < text.length)
    parts.push(<TwemojiText key={key++} text={text.slice(last)} />);
  return parts;
}

function renderWa(text: string): ReactNode {
  return text.split("\n").map((line, i, arr) => (
    <span key={i}>
      {parseWaInline(line)}
      {i < arr.length - 1 ? <br /> : null}
    </span>
  ));
}

function placeholderMatchAtCursor(text: string, cursor: number) {
  const before = text.slice(0, cursor);
  return before.match(/\{\{\s*([A-Za-z0-9_]*)$/);
}

function GlobalPlaceholderAutocomplete() {
  const placeholderOptions = useContext(PlaceholderOptionsContext);
  const [state, setState] = useState<{
    target: HTMLInputElement | HTMLTextAreaElement;
    query: string;
    x: number;
    y: number;
  } | null>(null);

  const filtered =
    state === null
      ? []
      : placeholderOptions
          .filter((option) =>
            option.token
              .replace(/[{}]/g, "")
              .toLowerCase()
              .includes(state.query.toLowerCase())
          )
          .slice(0, 8);

  useEffect(() => {
    const isTextTarget = (
      target: EventTarget | null
    ): target is HTMLInputElement | HTMLTextAreaElement => {
      if (
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLInputElement
      ) {
        if (target instanceof HTMLInputElement) {
          const type = (target.type || "text").toLowerCase();
          if (!["text", "search", "email", "url", "tel"].includes(type)) {
            return false;
          }
        }
        return !target.readOnly && !target.disabled;
      }
      return false;
    };

    const update = (target: EventTarget | null) => {
      if (!isTextTarget(target)) {
        setState(null);
        return;
      }
      const cursor = target.selectionStart ?? target.value.length;
      const match = placeholderMatchAtCursor(target.value, cursor);
      if (!match) {
        setState(null);
        return;
      }
      const rect = target.getBoundingClientRect();
      setState({
        target,
        query: match[1] ?? "",
        x: rect.left + window.scrollX + 8,
        y: rect.top + window.scrollY + 34,
      });
    };

    const onInput = (event: Event) => update(event.target);
    const onClick = (event: MouseEvent) => update(event.target);
    const onKeyUp = (event: KeyboardEvent) => update(event.target);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setState(null);
      if (event.key === "Enter" && state && filtered.length > 0) {
        event.preventDefault();
        insertToken(filtered[0].token);
      }
    };
    const onFocusOut = () => {
      window.setTimeout(() => setState(null), 120);
    };

    document.addEventListener("input", onInput, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keyup", onKeyUp, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("focusout", onFocusOut, true);
    return () => {
      document.removeEventListener("input", onInput, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keyup", onKeyUp, true);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("focusout", onFocusOut, true);
    };
  }, [filtered, state]);

  function insertToken(token: string) {
    if (!state) return;
    const target = state.target;
    const cursor = target.selectionStart ?? target.value.length;
    const match = placeholderMatchAtCursor(target.value, cursor);
    const start = match ? cursor - match[0].length : cursor;
    target.setRangeText(token, start, cursor, "end");
    target.dispatchEvent(new InputEvent("input", { bubbles: true }));
    target.focus();
    setState(null);
  }

  if (filtered.length === 0 || !state) return null;
  return (
    <div
      className="absolute z-[9999] max-h-64 w-[min(420px,calc(100vw-2rem))] overflow-auto rounded-md border border-emerald-200 bg-white p-1 text-xs shadow-xl"
      style={{ left: state.x, top: state.y }}
    >
      {filtered.map((option) => (
        <button
          key={option.token}
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            insertToken(option.token);
          }}
          className="block w-full rounded px-2 py-1.5 text-left hover:bg-emerald-50"
        >
          <span className="font-mono font-semibold text-emerald-700">
            {option.token}
          </span>
          <span className="ml-2 font-medium text-neutral-700">
            {option.label}
          </span>
          {option.description && (
            <span className="block truncate text-neutral-500">
              {option.description}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

function TextVariantToolbar({
  children,
  onEmoji,
}: {
  children?: ReactNode;
  onEmoji: (emoji: string) => void;
}) {
  return (
    <div className="mb-1 flex flex-wrap items-center justify-end gap-2">
      {children}
      <EmojiPicker onPick={onEmoji} />
    </div>
  );
}

// Elige una variante válida (ignora vacías y placeholders <<...>>). roll=0 usa
// la primera; roll>0 elige una pseudo-aleatoria estable según roll + posición.
function pickVariantText(texts: string[], roll: number, stepIdx: number): string {
  const valid = texts.filter(
    (t) => t && t.trim() && !(t.includes("<<") && t.includes(">>"))
  );
  if (valid.length === 0) return "";
  if (roll === 0) return valid[0];
  const r = Math.abs(Math.sin(roll * 9301 + stepIdx * 49297));
  return valid[Math.floor(r * valid.length) % valid.length];
}

function resolvePreviewSpintax(text: string, roll: number, stepIdx: number): string {
  if (!text || !text.includes("|")) return text;
  let groupIndex = 0;
  return text.replace(/\{([^{}\n]*\|[^{}\n]*)\}/g, (match, body: string) => {
    const options = body.split("|");
    if (options.length < 2) return match;
    if (roll === 0) {
      groupIndex += 1;
      return options[0] ?? "";
    }
    const r = Math.abs(Math.sin(roll * 15485863 + stepIdx * 32452843 + groupIndex * 49979687));
    groupIndex += 1;
    return options[Math.floor(r * options.length) % options.length] ?? "";
  });
}

/** Resuelve los comodines de precio para la vista previa, igual que el bot en
 *  runtime: {price}/{precio} (precio de ESTA opción) y, en el order bump,
 *  {{precio_1}} (combo), {{precio_2}} (básico) y {{precio_extra}} (diferencia).
 *  Muestra el precio NORMAL, como el resto del preview. */
function applyPreviewPrices(
  text: string,
  priceSoles?: number,
  comboPrice?: number,
  basicoPrice?: number,
  context?: PreviewContext
): string {
  let out = text;
  const currency = context?.currencySymbol ?? "S/.";
  const option1Name = context?.option1Name?.trim() || "Opcion 1";
  const option2Name = context?.option2Name?.trim() || "Opcion 2";
  const productName = context?.productName?.trim() || "Producto principal";
  const product2Name = context?.product2Name?.trim() || "Producto 2";
  const customerName = context?.customerName?.trim() || "Cliente";
  if (typeof priceSoles === "number") {
    out = out
      .replace(/\{price\}/gi, String(priceSoles))
      .replace(/\{precio\}/gi, String(priceSoles));
  }
  out = out
    .replace(/\{\{\s*(moneda|simbolo|sÃ­mbolo|símbolo|currency)\s*\}\}/gi, currency)
    .replace(/\{\{\s*(nombre|nombre_whatsapp|name|customer_name)\s*\}\}/gi, customerName)
    .replace(/\{\{\s*(producto|product)\s*\}\}/gi, productName)
    .replace(
      /\{\{\s*(producto2|producto_2|product2|product_2)\s*\}\}/gi,
      product2Name
    )
    .replace(
      /\{\{\s*(opcion_1|opcion1|option_1|option1|combo_name|producto_1|producto1|product_1|product1)\s*\}\}/gi,
      option1Name
    )
    .replace(
      /\{\{\s*(opcion_2|opcion2|option_2|option2|basico_name|producto_2|producto2|product_2|product2)\s*\}\}/gi,
      option2Name
    );
  if (typeof comboPrice === "number") {
    out = out.replace(
      /\{\{\s*(precio_1|precio1|price_1|price1|combo_price)\s*\}\}/gi,
      String(comboPrice)
    );
  }
  if (typeof basicoPrice === "number") {
    out = out.replace(
      /\{\{\s*(precio_2|precio2|price_2|price2|basico_price)\s*\}\}/gi,
      String(basicoPrice)
    );
  }
  if (typeof comboPrice === "number" && typeof basicoPrice === "number") {
    const extra = Math.round((comboPrice - basicoPrice) * 100) / 100;
    out = out.replace(
      /\{\{\s*(precio_extra|precio_adicional|precio_diferencia|diferencia|extra)\s*\}\}/gi,
      String(extra)
    );
  }
  for (const item of context?.customPlaceholders ?? []) {
    const key = normalizePlaceholderKey(item.key ?? "");
    const value = item.value ?? "";
    if (!key || !value) continue;
    out = out.replace(
      new RegExp(`\\{\\{\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\}\\}`, "gi"),
      value
    );
  }
  return out;
}

function ChatPreview({
  steps,
  priceSoles,
  comboPrice,
  basicoPrice,
  previewContext,
  activeStepIndex,
  useScrollContainer,
  onSelectStep,
}: {
  steps: EditorStep[];
  priceSoles?: number;
  comboPrice?: number;
  basicoPrice?: number;
  previewContext?: PreviewContext;
  activeStepIndex?: number | null;
  useScrollContainer?: boolean;
  onSelectStep?: (index: number) => void;
}) {
  const [roll, setRoll] = useState(0);
  const previewScrollRef = useRef<HTMLDivElement | null>(null);
  const inheritedPreviewContext = useContext(EditorPreviewContext);
  const effectivePreviewContext: PreviewContext = {
    ...inheritedPreviewContext,
    ...previewContext,
    customPlaceholders:
      previewContext?.customPlaceholders ??
      inheritedPreviewContext.customPlaceholders ??
      [],
  };
  const visibles = steps
    .map((s, originalIndex) => ({ step: s, originalIndex }))
    .filter(
      ({ step }) =>
        step.enabled !== false &&
        (step.texts.some((t) => t && t.trim()) || step.drive_url.trim())
    );
  useEffect(() => {
    if (!useScrollContainer || activeStepIndex == null) return;
    const container = previewScrollRef.current;
    const node = container?.querySelector<HTMLDivElement>(
      `[data-preview-step="${activeStepIndex}"]`
    );
    if (!container || !node) return;
    const top = node.offsetTop - container.offsetTop;
    container.scrollTo({ top, behavior: "smooth" });
  }, [activeStepIndex, useScrollContainer, visibles.length]);
  return (
    <div className="rounded-xl border border-neutral-300 bg-[#efeae2] p-2">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold text-neutral-500">
          📱 Vista previa (WhatsApp)
        </span>
        <button
          type="button"
          onClick={() => setRoll((r) => r + 1)}
          title="Mostrar otra combinación de variantes al azar (como hace el bot)"
          className="rounded border border-neutral-300 bg-white px-2 py-0.5 text-[11px] text-neutral-600 hover:bg-neutral-50"
        >
          🔀 Variar
        </button>
      </div>
      <div
        ref={previewScrollRef}
        className={`${useScrollContainer ? "max-h-[70vh] overflow-y-auto pr-1" : ""} space-y-2`}
      >
        {visibles.length === 0 && (
          <p className="py-6 text-center text-[11px] text-neutral-400">
            Agrega texto o una imagen para ver la vista previa.
          </p>
        )}
        {visibles.map(({ step: s, originalIndex }, i) => {
          const rawCaption = pickVariantText(s.texts, roll, i);
          const caption = resolvePreviewSpintax(
            applyPreviewPrices(
              rawCaption,
              priceSoles,
              comboPrice,
              basicoPrice,
              effectivePreviewContext
            ),
            roll,
            i
          );
          const thumb =
            s.type === "image" || s.type === "video" || s.type === "document"
              ? driveThumb(s.drive_url)
              : null;
          return (
            <div key={i} className="flex justify-end">
              <div
                data-preview-step={originalIndex}
                onClick={() => onSelectStep?.(originalIndex)}
                className={`max-w-[88%] rounded-lg rounded-tr-none bg-[#d9fdd3] px-2.5 py-1.5 shadow-sm transition ${
                  activeStepIndex === originalIndex
                    ? "border-2 border-emerald-700 shadow-md ring-2 ring-emerald-700 ring-offset-2 ring-offset-[#efeae2]"
                    : ""
                } ${onSelectStep ? "cursor-pointer" : ""}`}
              >
                {thumb && (
                  <div className="relative mb-1 overflow-hidden rounded-md">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={thumb}
                      alt="imagen"
                      className="max-h-48 w-full object-cover"
                      onError={(e) => {
                        const box = e.currentTarget
                          .parentElement as HTMLElement | null;
                        if (box) box.style.display = "none";
                      }}
                    />
                    {s.type === "video" && (
                      <span className="absolute inset-0 flex items-center justify-center text-3xl text-white drop-shadow">
                        ▶
                      </span>
                    )}
                    {s.type === "document" && (
                      <span className="absolute bottom-2 right-2 rounded bg-black/70 px-2 py-0.5 text-[10px] font-semibold text-white">
                        PDF
                      </span>
                    )}
                  </div>
                )}
                {s.type === "audio" && s.drive_url.trim() && (
                  <div className="mb-1 flex items-center gap-2 rounded-md bg-neutral-100 px-3 py-2 text-xs text-neutral-600">
                    <span className="text-lg">▶</span>
                    <div className="h-1.5 flex-1 rounded-full bg-neutral-300" />
                    <span>Audio</span>
                  </div>
                )}
                {s.type === "document" && s.drive_url.trim() && (
                  <div className="mb-1 flex items-center gap-2 rounded-md bg-neutral-100 px-3 py-2 text-xs text-neutral-600">
                    <span className="text-lg">📄</span>
                    <span>PDF</span>
                  </div>
                )}
                {(s.type === "image" || s.type === "video") &&
                  !thumb &&
                  s.drive_url.trim() && (
                  <div className="mb-1 rounded-md bg-neutral-200 px-2 py-3 text-center text-[10px] text-neutral-500">
                    [media del enlace]
                  </div>
                )}
                {caption && (
                  <div className="whitespace-pre-wrap break-words text-[13px] leading-snug text-neutral-800">
                    {renderWa(caption)}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StepEditorPreviewPair({
  steps,
  onChange,
  onSnapshot,
  onEdit,
  idPrefix,
  priceSoles,
  comboPrice,
  basicoPrice,
  previewContext,
  className,
}: {
  steps: EditorStep[];
  onChange: (steps: EditorStep[]) => void;
  onSnapshot: () => void;
  onEdit: (key: string) => void;
  idPrefix: string;
  priceSoles?: number;
  comboPrice?: number;
  basicoPrice?: number;
  previewContext?: PreviewContext;
  className?: string;
}) {
  const [activeStepIndex, setActiveStepIndex] = useState<number | null>(null);
  const [useScrollContainer, setUseScrollContainer] = useState(false);

  return (
    <div className={`grid gap-4 lg:grid-cols-2 ${className ?? ""}`}>
      <StepList
        steps={steps}
        onChange={onChange}
        onSnapshot={onSnapshot}
        onEdit={onEdit}
        idPrefix={idPrefix}
        activeStepIndex={activeStepIndex}
        onActiveStepIndexChange={setActiveStepIndex}
      />
      <div className="lg:sticky lg:top-4 lg:self-start">
        <label className="mb-2 flex cursor-pointer items-center gap-2 text-xs text-neutral-600">
          <input
            type="checkbox"
            checked={useScrollContainer}
            onChange={(e) => setUseScrollContainer(e.target.checked)}
            className="h-4 w-4 accent-emerald-600"
          />
          Activar contenedor de edición
        </label>
        <ChatPreview
          steps={steps}
          priceSoles={priceSoles}
          comboPrice={comboPrice}
          basicoPrice={basicoPrice}
          previewContext={previewContext}
          activeStepIndex={activeStepIndex}
          useScrollContainer={useScrollContainer}
          onSelectStep={setActiveStepIndex}
        />
      </div>
    </div>
  );
}

function EditorEmojiTextarea({
  value,
  onChange,
  sideActions,
  rows,
  placeholder,
  className,
  onFocus,
  onBlur,
}: {
  value: string;
  onChange: (value: string) => void;
  sideActions?: ReactNode;
  rows: number;
  placeholder?: string;
  className: string;
  onFocus?: () => void;
  onBlur?: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const highlightRef = useRef<HTMLDivElement | null>(null);
  const placeholderOptions = useContext(PlaceholderOptionsContext);
  const [placeholderQuery, setPlaceholderQuery] = useState<string | null>(null);
  const hasPlaceholders = /\{\{\s*[A-Za-z0-9_]+\s*\}\}/.test(value);

  function getPlaceholderMatch(text: string, cursor: number) {
    const before = text.slice(0, cursor);
    return before.match(/\{\{\s*([A-Za-z0-9_]*)$/);
  }

  const filteredPlaceholders =
    placeholderQuery === null
      ? []
      : placeholderOptions
          .filter((option) =>
            option.token
              .replace(/[{}]/g, "")
              .toLowerCase()
              .includes(placeholderQuery.toLowerCase())
          )
          .slice(0, 8);

  function insertAtCursor(text: string) {
    const ta = textareaRef.current;
    if (!ta) {
      onChange(value + text);
      return;
    }
    const start = ta.selectionStart ?? value.length;
    const end = ta.selectionEnd ?? value.length;
    const next = value.slice(0, start) + text + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + text.length;
      ta.setSelectionRange(pos, pos);
    });
  }

  function insertPlaceholder(token: string) {
    const ta = textareaRef.current;
    const cursor = ta?.selectionStart ?? value.length;
    const match = getPlaceholderMatch(value, cursor);
    const start = match ? cursor - match[0].length : cursor;
    const next = value.slice(0, start) + token + value.slice(cursor);
    onChange(next);
    setPlaceholderQuery(null);
    requestAnimationFrame(() => {
      ta?.focus();
      const pos = start + token.length;
      ta?.setSelectionRange(pos, pos);
    });
  }

  return (
    <div className="block w-full min-w-0">
      <TextVariantToolbar onEmoji={insertAtCursor}>
        {sideActions}
      </TextVariantToolbar>
      <div className="relative block w-full min-w-0">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => {
            const next = e.target.value;
            onChange(next);
            const match = getPlaceholderMatch(next, e.target.selectionStart ?? next.length);
            setPlaceholderQuery(match ? match[1] ?? "" : null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setPlaceholderQuery(null);
            if (false && e.key === "Enter" && filteredPlaceholders.length > 0) {
              e.preventDefault();
              insertPlaceholder(filteredPlaceholders[0].token);
            }
          }}
          onClick={(e) => {
            const ta = e.currentTarget;
            const match = getPlaceholderMatch(value, ta.selectionStart ?? value.length);
            setPlaceholderQuery(match ? match[1] ?? "" : null);
          }}
          onFocus={onFocus}
          onBlur={() => {
            onBlur?.();
            window.setTimeout(() => setPlaceholderQuery(null), 120);
          }}
          rows={rows}
          placeholder={placeholder}
          className={`relative block w-full max-w-none min-w-0 ${className}`}
        />
        {hasPlaceholders && (
          <div className="mt-1 rounded border border-sky-100 bg-sky-50/60 px-2 py-1 text-[11px] leading-5 text-neutral-700">
            <HighlightedPlaceholders text={value} />
          </div>
        )}
        {false && filteredPlaceholders.length > 0 && (
          <div className="absolute left-2 top-9 z-30 max-h-64 w-[min(420px,calc(100%-1rem))] overflow-auto rounded-md border border-emerald-200 bg-white p-1 text-xs shadow-lg">
            {filteredPlaceholders.map((option) => (
              <button
                key={option.token}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => insertPlaceholder(option.token)}
                className="block w-full rounded px-2 py-1.5 text-left hover:bg-emerald-50"
              >
                <span className="font-mono font-semibold text-emerald-700">
                  {option.token}
                </span>
                <span className="ml-2 font-medium text-neutral-700">
                  {option.label}
                </span>
                {option.description && (
                  <span className="block truncate text-neutral-500">
                    {option.description}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function HighlightedPlaceholders({ text }: { text: string }) {
  const nodes: ReactNode[] = [];
  const re = /(\{\{\s*[A-Za-z0-9_]+\s*\}\})/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    nodes.push(
      <span
        key={key++}
        className="rounded bg-sky-100 px-0.5 font-mono font-semibold text-sky-700 ring-1 ring-sky-200"
      >
        {match[0]}
      </span>
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return <>{nodes.length ? nodes : text}</>;
}

function StepList({
  steps,
  onChange,
  onSnapshot,
  onEdit,
  idPrefix,
  activeStepIndex,
  onActiveStepIndexChange,
}: {
  steps: EditorStep[];
  onChange: (steps: EditorStep[]) => void;
  onSnapshot: () => void;
  onEdit: (key: string) => void;
  idPrefix: string;
  activeStepIndex?: number | null;
  onActiveStepIndexChange?: (index: number | null) => void;
}) {
  const update = (i: number, patch: Partial<EditorStep>) => {
    onEdit(`${idPrefix}:${i}:meta`);
    onChange(steps.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  };
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= steps.length) return;
    onSnapshot();
    const copy = [...steps];
    [copy[i], copy[j]] = [copy[j], copy[i]];
    onChange(copy);
  };
  const reorder = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= steps.length || to >= steps.length)
      return;
    onSnapshot();
    const copy = [...steps];
    const [moved] = copy.splice(from, 1);
    copy.splice(to, 0, moved);
    onChange(copy);
  };
  const dropAt = (to: number) => {
    if (dragIndex === null) return;
    reorder(dragIndex, to);
    setDragIndex(null);
  };
  const duplicateStep = (i: number) => {
    onSnapshot();
    const copy = [...steps];
    const step = copy[i];
    copy.splice(i + 1, 0, {
      ...step,
      texts: [...step.texts],
    });
    onChange(copy);
  };
  const removeStep = (i: number) => {
    if (!confirm("¿Quitar este paso? Puedes deshacerlo con ↶ Deshacer.")) return;
    onSnapshot();
    onChange(steps.filter((_, idx) => idx !== i));
  };
  const addStep = () => {
    onSnapshot();
    onChange([...steps, emptyStep()]);
  };
  const updateText = (i: number, ti: number, v: string) => {
    onEdit(`${idPrefix}:${i}:t${ti}`);
    onChange(
      steps.map((s, idx) =>
        idx === i
          ? { ...s, texts: s.texts.map((t, k) => (k === ti ? v : t)) }
          : s
      )
    );
  };
  const addText = (i: number) => {
    onSnapshot();
    onChange(
      steps.map((s, idx) => (idx === i ? { ...s, texts: [...s.texts, ""] } : s))
    );
  };
  const duplicateText = (i: number, ti: number) => {
    onSnapshot();
    onChange(
      steps.map((s, idx) => {
        if (idx !== i) return s;
        const texts = [...s.texts];
        texts.splice(ti + 1, 0, s.texts[ti] ?? "");
        return { ...s, texts };
      })
    );
  };
  const removeText = (i: number, ti: number) => {
    onSnapshot();
    onChange(
      steps.map((s, idx) =>
        idx === i ? { ...s, texts: s.texts.filter((_, k) => k !== ti) } : s
      )
    );
  };

  return (
    <div className="space-y-4">
      {steps.map((step, i) => (
        <div key={i} className="space-y-2">
          {dragIndex !== null && dragIndex !== i && (
            <button
              type="button"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                dropAt(i);
              }}
              onClick={() => dropAt(i)}
              className="w-full rounded-md border-2 border-dashed border-sky-300 bg-sky-50 py-1 text-xs font-semibold text-sky-700"
            >
              Soltar aquí
            </button>
          )}
          <StepCard
            index={i}
            total={steps.length}
            step={step}
            isDragging={dragIndex === i}
            isDragTarget={dragIndex !== null && dragIndex !== i}
            isActive={activeStepIndex === i}
            onUpdate={(patch) => update(i, patch)}
            onMove={(dir) => move(i, dir)}
            onDragStart={() => setDragIndex(i)}
            onDragEnd={() => setDragIndex(null)}
            onDropHere={() => dropAt(i)}
            onActivate={() => onActiveStepIndexChange?.(i)}
            onDuplicate={() => duplicateStep(i)}
            onRemove={() => removeStep(i)}
            onUpdateText={(ti, v) => updateText(i, ti, v)}
            onAddText={() => addText(i)}
            onDuplicateText={(ti) => duplicateText(i, ti)}
            onRemoveText={(ti) => removeText(i, ti)}
          />
        </div>
      ))}
      {dragIndex !== null && dragIndex !== steps.length - 1 && (
        <button
          type="button"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            dropAt(steps.length - 1);
          }}
          onClick={() => dropAt(steps.length - 1)}
          className="w-full rounded-md border-2 border-dashed border-sky-300 bg-sky-50 py-1 text-xs font-semibold text-sky-700"
        >
          Soltar al final
        </button>
      )}
      <button
        type="button"
        onClick={addStep}
        className="w-full rounded-md border-2 border-dashed border-neutral-300 py-2 text-sm text-neutral-500 hover:border-emerald-400 hover:text-emerald-600"
      >
        ➕ Agregar paso
      </button>
    </div>
  );
}

function StepCard({
  index,
  total,
  step,
  isDragging,
  isDragTarget,
  isActive,
  onUpdate,
  onMove,
  onDragStart,
  onDragEnd,
  onDropHere,
  onActivate,
  onDuplicate,
  onRemove,
  onUpdateText,
  onAddText,
  onDuplicateText,
  onRemoveText,
}: {
  index: number;
  total: number;
  step: EditorStep;
  isDragging: boolean;
  isDragTarget: boolean;
  isActive: boolean;
  onUpdate: (patch: Partial<EditorStep>) => void;
  onMove: (dir: -1 | 1) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDropHere: () => void;
  onActivate: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onUpdateText: (ti: number, value: string) => void;
  onAddText: () => void;
  onDuplicateText: (ti: number) => void;
  onRemoveText: (ti: number) => void;
}) {
  const isMedia = step.type !== "text";
  const [collapsed, setCollapsed] = useState(
    () => step.texts.some((t) => t.trim().length > 0)
  );
  const previewText = (() => {
    const first = step.texts.find((t) => t.trim().length > 0) ?? "";
    const oneLine = first.replace(/\s+/g, " ").trim();
    if (oneLine) return oneLine.length > 70 ? oneLine.slice(0, 70) + "…" : oneLine;
    if (isMedia) return step.drive_url ? "(media sin texto)" : "(vacío)";
    return "(sin texto)";
  })();
  return (
    <div
      onClick={onActivate}
      onDragOver={(e) => {
        if (isDragTarget) e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        if (isDragTarget) onDropHere();
      }}
      className={`rounded-lg border bg-neutral-100 p-3 shadow transition ${
        step.enabled === false ? "opacity-60" : ""
      } ${
        isActive
          ? "border-2 border-emerald-700 bg-emerald-50 shadow-md ring-2 ring-emerald-700 ring-offset-2"
          : isDragging
            ? "border-emerald-500 opacity-75"
            : "border-neutral-400"
      } ${
        isDragTarget ? "border-dashed border-sky-400" : ""
      }`}
    >
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-800 text-xs font-medium text-white">
            {index + 1}
          </span>
          <button
            type="button"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "move";
              onDragStart();
            }}
            onDragEnd={onDragEnd}
            title="Arrastrar para reordenar"
            className="shrink-0 cursor-grab rounded border border-sky-300 bg-white px-2 py-1 text-xs font-bold text-sky-700 active:cursor-grabbing"
          >
            ⋮⋮ Mover
          </button>
          <button
            type="button"
            onClick={() => onMove(-1)}
            disabled={index === 0}
            title="Subir cajón"
            className="rounded border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-bold text-sky-700 hover:bg-sky-100 disabled:opacity-30"
          >
            ↑ Subir
          </button>
          <button
            type="button"
            onClick={() => onMove(1)}
            disabled={index === total - 1}
            title="Bajar cajón"
            className="rounded border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-bold text-sky-700 hover:bg-sky-100 disabled:opacity-30"
          >
            ↓ Bajar
          </button>
          <select
            value={step.type}
            onChange={(e) => onUpdate({ type: e.target.value as StepType })}
            className="min-w-0 max-w-full rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-800"
          >
            <option value="text">{TYPE_LABEL.text}</option>
            <option value="image">{TYPE_LABEL.image}</option>
            <option value="audio">{TYPE_LABEL.audio}</option>
            <option value="video">{TYPE_LABEL.video}</option>
            <option value="document">{TYPE_LABEL.document}</option>
          </select>
        </div>
        <div className="flex max-w-full flex-wrap items-center justify-end gap-1">
          <button
            type="button"
            onClick={() => onUpdate({ enabled: step.enabled === false })}
            title={
              step.enabled === false
                ? "Apagada: el bot NO la envía"
                : "Encendida: el bot la envía"
            }
            className={`rounded border px-2 py-1 text-xs font-semibold ${
              step.enabled === false
                ? "border-neutral-300 bg-neutral-100 text-neutral-400"
                : "border-emerald-300 bg-emerald-50 text-emerald-700"
            }`}
          >
            {step.enabled === false ? "OFF" : "ON"}
          </button>
          {/* separador: aísla el trash para evitar borrados accidentales */}
          <button
            type="button"
            onClick={onDuplicate}
            title="Duplicar paso"
            className="rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-50"
          >
            ⧉
          </button>
          <span className="mx-1 h-6 w-px bg-neutral-300" aria-hidden="true" />
          <button
            type="button"
            onClick={onRemove}
            title="Eliminar paso"
            className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
          >
            🗑️
          </button>
          {/* separador antes del triángulo (extremo derecho) */}
          <span className="mx-1 h-6 w-px bg-neutral-300" aria-hidden="true" />
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? "Desplegar" : "Ocultar"}
            className="flex h-9 w-9 items-center justify-center rounded-md border border-neutral-300 bg-white text-2xl leading-none text-neutral-700 hover:bg-neutral-200"
          >
            {collapsed ? "◂" : "▾"}
          </button>
        </div>
      </div>

      {collapsed && (
        <p
          onClick={() => setCollapsed(false)}
          className="cursor-pointer truncate text-xs text-neutral-500"
          title="Desplegar"
        >
          {previewText}
        </p>
      )}

      {!collapsed && (
        <>
          {isMedia && (
        <div className="mb-3">
          <label className="mb-1 block text-sm font-semibold text-neutral-700">
            Enlace de Google Drive (
            {step.type === "image"
              ? "imagen"
              : step.type === "audio"
                ? "audio"
                : step.type === "video"
                  ? "video"
                  : "PDF"})
          </label>
          <input
            type="text"
            value={step.drive_url}
            onChange={(e) => onUpdate({ drive_url: e.target.value })}
            placeholder="https://drive.google.com/file/d/.../view?usp=sharing"
            className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs text-neutral-800"
          />
        </div>
      )}

      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold text-neutral-700">
          {isMedia ? "Texto al pie (caption)" : "Texto"} — variantes
        </span>
        <span className="text-[11px] text-neutral-400">
          el bot elige una al azar
        </span>
      </div>

      <div className="space-y-2">
        {step.texts.map((t, ti) => (
          <div key={ti} className="block w-full min-w-0">
            <EditorEmojiTextarea
              value={t}
              onChange={(next) => onUpdateText(ti, next)}
              sideActions={
                <>
                  <button
                    type="button"
                    onClick={() => onDuplicateText(ti)}
                    title="Duplicar variante"
                    className="rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-50"
                  >
                    ⧉
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemoveText(ti)}
                    disabled={step.texts.length === 1}
                    title="Quitar variante"
                    className="rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-50 disabled:opacity-30"
                  >
                    ✕
                  </button>
                </>
              }
              rows={4}
              placeholder="Escribe el mensaje tal como llegará por WhatsApp…"
              className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-800"
            />
          </div>
        ))}
        <button
          type="button"
          onClick={onAddText}
          className="text-xs text-emerald-600 hover:underline"
        >
          + agregar variante de texto
        </button>
      </div>

      <div className="mt-3 flex items-center gap-2 border-t border-neutral-100 pt-3">
        <label className="text-xs text-neutral-500">
          Espera después de este paso:
        </label>
        <input
          type="number"
          min={0}
          value={step.delay_after_sec}
          onChange={(e) =>
            onUpdate({ delay_after_sec: Number(e.target.value) || 0 })
          }
          className="w-20 rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-800"
        />
        <span className="text-xs text-neutral-500">segundos</span>
      </div>
        </>
      )}
    </div>
  );
}

type ChannelKey = "whatsapp" | "messenger" | "instagram" | "tiktok";

const CHANNEL_PROTOTYPE_META: Record<
  ChannelKey,
  {
    name: string;
    short: string;
    badgeClass: string;
    panelClass: string;
    status: string;
    setupHint: string;
  }
> = {
  whatsapp: {
    name: "WhatsApp",
    short: "WA",
    badgeClass: "bg-emerald-500 text-white",
    panelClass: "border-2 border-emerald-400 bg-emerald-100/70",
    status: "Editor rapido seguro",
    setupHint:
      "Capa editable importable desde Base. Aun no reemplaza el motor real de WhatsApp.",
  },
  messenger: {
    name: "Messenger",
    short: "M",
    badgeClass: "bg-sky-500 text-white",
    panelClass: "border-2 border-sky-400 bg-sky-100/70",
    status: "Prototipo independiente",
    setupHint: "Preparado para Page Access Token, webhook y textos propios.",
  },
  instagram: {
    name: "Instagram DM",
    short: "IG",
    badgeClass:
      "bg-gradient-to-br from-fuchsia-500 via-rose-500 to-amber-400 text-white",
    panelClass: "border-2 border-fuchsia-400 bg-fuchsia-100/70",
    status: "Prototipo independiente",
    setupHint: "Preparado para cuenta profesional, Page Access Token y webhook.",
  },
  tiktok: {
    name: "TikTok",
    short: "TT",
    badgeClass: "bg-neutral-950 text-white",
    panelClass: "border-2 border-neutral-700 bg-neutral-200",
    status: "Apagado / listo para configurar",
    setupHint:
      "Primera etapa: TikTok Ads hacia WhatsApp/Messenger. Segunda etapa: TikTok DM si la cuenta/API lo permite.",
  },
};

const CHANNEL_KEYS: ChannelKey[] = [
  "whatsapp",
  "messenger",
  "instagram",
  "tiktok",
];

function compactSteps(steps: EditorStep[]): EditorStep[] {
  return steps.filter(
    (step) =>
      step.enabled !== false &&
      (step.drive_url.trim() || step.texts.some((text) => text.trim()))
  );
}

function activeIntroGroups(cfg: FullConfig): Array<{ label: string; steps: EditorStep[] }> {
  const mode = activeModality(cfg);
  const tpl = cfg.modality_templates?.[mode] ?? {};
  const groups: Array<{ label: string; steps: EditorStep[] }> = [
    {
      label: "Saludo inicial",
      steps: [
        {
          type: "text" as const,
          drive_url: "",
          texts: cfg.greeting.texts,
          delay_after_sec: 0,
        },
      ],
    },
    { label: tpl.intro_names?.[0] || "Intro 1", steps: tpl.intro_sequence ?? [] },
    { label: tpl.intro_names?.[1] || "Intro 2", steps: tpl.intro_sequence_2 ?? [] },
    { label: tpl.intro_names?.[2] || "Intro 3", steps: tpl.intro_sequence_3 ?? [] },
    ...((tpl.intro_extra_sequences ?? []).map((steps, index) => ({
      label: tpl.intro_names?.[index + 3] || `Intro ${index + 4}`,
      steps,
    }))),
  ];
  return groups
    .map((group) => ({ ...group, steps: compactSteps(group.steps) }))
    .filter((group) => group.steps.length > 0);
}

function followupTimeLabel(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "sin espera";
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  if (Number.isInteger(hours) && hours < 24) return `${hours} h`;
  const days = hours / 24;
  if (Number.isInteger(days)) return `${days} dias`;
  return `${Math.round(hours * 10) / 10} h`;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function cloneFollowupsForChannel(followups: EditorFollowup[]): EditorFollowup[] {
  return followups.map((followup) => ({
    ...cloneJson(followup),
    steps: cloneJson(followup.steps ?? []),
    variants: (followup.variants ?? []).map((variant) => ({
      ...cloneJson(variant),
      steps: cloneJson(variant.steps ?? []),
    })),
  }));
}

function channelDeliveryGroupsFromBase(
  cfg: FullConfig,
  mode: Modo
): ChannelDeliveryGroupEditor[] {
  const tpl = cfg.modality_templates?.[mode] ?? {};
  const centralDelivery = tpl.payment_approved ?? cfg.payment_approved ?? [];
  if (mode === "order_bump") {
    const source = tpl.order_bump ?? cfg.order_bump;
    return [
      {
        key: "order_bump_combo",
        name: `Order Bump - Combo: ${source.combo.name || "Combo"}`,
        enabled: true,
        steps: cloneJson(source.combo.delivery ?? []),
      },
      {
        key: "order_bump_basico",
        name: `Order Bump - Basico: ${source.basico.name || "Basico"}`,
        enabled: true,
        steps: cloneJson(source.basico.delivery ?? []),
      },
    ];
  }
  if (mode === "doble_oferta_dos") {
    const source = tpl.doble_oferta_dos ?? cfg.doble_oferta_dos;
    return [
      {
        key: "doble_oferta_dos_combo",
        name: `Doble Oferta 2 - Producto 1 / Combo: ${source.combo.name || "Producto 1"}`,
        enabled: true,
        steps: cloneJson(source.combo.delivery ?? []),
      },
      {
        key: "doble_oferta_dos_basico",
        name: `Doble Oferta 2 - Producto 2 / Basico: ${source.basico.name || "Producto 2"}`,
        enabled: true,
        steps: cloneJson(source.basico.delivery ?? []),
      },
    ];
  }
  if (mode === "bioferta") {
    const source = tpl.bioferta ?? cfg.bioferta;
    return [
      {
        key: "bioferta_product_a",
        name: `Doble Oferta - Producto 1: ${source.product_a.name || "Producto 1"}`,
        enabled: true,
        steps: cloneJson(centralDelivery),
      },
      {
        key: "bioferta_product_b",
        name: `Doble Oferta - Producto 2: ${source.product_b.name || "Producto 2"}`,
        enabled: true,
        steps: cloneJson(source.product_b.delivery ?? []),
      },
      {
        key: "bioferta_pack",
        name: `Doble Oferta - Pack: ${source.pack.name || "Pack"}`,
        enabled: true,
        steps: cloneJson(source.pack.delivery ?? []),
      },
    ];
  }
  return [
    {
      key: "central",
      name: "Entrega pago aprobado",
      enabled: true,
      steps: cloneJson(centralDelivery),
    },
  ];
}

function buildChannelContentFromBase(
  cfg: FullConfig,
  channel: ChannelKey
): ChannelContentEditor {
  const mode = activeModality(cfg);
  const tpl = cfg.modality_templates?.[mode] ?? {};
  const sourceFollowups = tpl.followups ?? cfg.followups ?? [];
  const sourcePaymentApproved = tpl.payment_approved ?? cfg.payment_approved ?? [];
  const postSaleValues = extractPostSaleValues(cfg.prompt_sections.postventa ?? "");
  const postSale = adaptPostSaleForChannel(postSaleValues, channel);
  const introGroups = activeIntroGroupsForEditor(cfg).map((group) => ({
    name: group.label,
    enabled: group.enabled,
    weight: group.weight,
    adName: group.adName,
    adId: group.adId,
    steps: cloneJson(group.steps),
  }));
  return {
    intro_groups: introGroups,
    followups: cloneFollowupsForChannel(sourceFollowups),
    payment: compactSteps([
      {
        type: "text",
        drive_url: "",
        texts: [cfg.payment_text || cfg.payment_buttons_prompt || ""],
        delay_after_sec: 0,
      },
      ...(cfg.direct_payment_enabled ? cfg.direct_payment_steps ?? [] : []),
    ]),
    delivery: cloneJson(sourcePaymentApproved),
    delivery_groups: channelDeliveryGroupsFromBase(cfg, mode),
    post_sale: postSale,
  };
}

function activeIntroGroupsForEditor(
  cfg: FullConfig
): Array<{
  label: string;
  steps: EditorStep[];
  enabled: boolean;
  weight: number;
  adName: string;
  adId: string;
}> {
  const mode = activeModality(cfg);
  const tpl = cfg.modality_templates?.[mode] ?? {};
  const greetingTexts = tpl.greeting?.texts ?? cfg.greeting.texts;
  return [
    {
      label: "Saludo inicial",
      enabled: true,
      weight: 1,
      adName: "",
      adId: "",
      steps: [
        {
          type: "text" as const,
          drive_url: "",
          texts: greetingTexts,
          delay_after_sec: 0,
        },
      ],
    },
    {
      label: tpl.intro_names?.[0] || "Intro 1",
      enabled: (tpl.intro_enabled?.[0] ?? false) === true,
      weight:
        typeof tpl.intro_weights?.[0] === "number" && tpl.intro_weights[0] > 0
          ? tpl.intro_weights[0]
          : 1,
      steps: tpl.intro_sequence ?? [],
      adName: tpl.intro_ad_names?.[0] ?? "",
      adId: tpl.intro_ad_ids?.[0] ?? "",
    },
    {
      label: tpl.intro_names?.[1] || "Intro 2",
      enabled: (tpl.intro_enabled?.[1] ?? false) === true,
      weight:
        typeof tpl.intro_weights?.[1] === "number" && tpl.intro_weights[1] > 0
          ? tpl.intro_weights[1]
          : 1,
      steps: tpl.intro_sequence_2 ?? [],
      adName: tpl.intro_ad_names?.[1] ?? "",
      adId: tpl.intro_ad_ids?.[1] ?? "",
    },
    {
      label: tpl.intro_names?.[2] || "Intro 3",
      enabled: (tpl.intro_enabled?.[2] ?? false) === true,
      weight:
        typeof tpl.intro_weights?.[2] === "number" && tpl.intro_weights[2] > 0
          ? tpl.intro_weights[2]
          : 1,
      steps: tpl.intro_sequence_3 ?? [],
      adName: tpl.intro_ad_names?.[2] ?? "",
      adId: tpl.intro_ad_ids?.[2] ?? "",
    },
    ...((tpl.intro_extra_sequences ?? []).map((steps, index) => ({
      label: tpl.intro_names?.[index + 3] || `Intro ${index + 4}`,
      enabled: (tpl.intro_enabled?.[index + 3] ?? false) === true,
      weight:
        typeof tpl.intro_weights?.[index + 3] === "number" &&
        tpl.intro_weights[index + 3] > 0
          ? tpl.intro_weights[index + 3]
          : 1,
      steps,
      adName: tpl.intro_ad_names?.[index + 3] ?? "",
      adId: tpl.intro_ad_ids?.[index + 3] ?? "",
    }))),
  ].filter((group) => group.steps.length > 0);
}

function emptyChannelContent(): ChannelContentEditor {
  return {
    intro_groups: [
      {
        name: "Intro Messenger/Instagram",
        enabled: true,
        steps: [emptyStep()],
      },
    ],
    followups: [],
    payment: [emptyStep()],
    delivery: [emptyStep()],
    delivery_groups: [
      {
        key: "central",
        name: "Entrega pago aprobado",
        enabled: true,
        steps: [emptyStep()],
      },
    ],
    post_sale: {
      whatsappPreference: "",
      deliveryUsage: "",
      lifetimeAccess: "",
      farewells: "",
    },
  };
}

function channelContentForMode(
  cfg: FullConfig,
  channel: ChannelKey,
  mode: Modo
): ChannelContentEditor {
  return cfg.channels?.[channel]?.modality_templates?.[mode] ?? emptyChannelContent();
}

function hasChannelContent(content: ChannelContentEditor): boolean {
  const hasSteps = (steps: EditorStep[] | undefined) =>
    (steps ?? []).some(
      (step) =>
        step.drive_url.trim() ||
        step.texts.some((text) => text.trim().length > 0)
    );
  return (
    content.intro_groups.some((group) => hasSteps(group.steps)) ||
    content.followups.some(
      (followup) =>
        hasSteps(followup.steps) ||
        (followup.variants ?? []).some((variant) => hasSteps(variant.steps))
    ) ||
    hasSteps(content.payment) ||
    hasSteps(content.delivery) ||
    (content.delivery_groups ?? []).some((group) => hasSteps(group.steps)) ||
    Object.values(content.post_sale ?? {}).some(
      (value) => typeof value === "string" && value.trim().length > 0
    )
  );
}

function ChannelBadge({ channel }: { channel: ChannelKey }) {
  const meta = CHANNEL_PROTOTYPE_META[channel];
  const size =
    channel === "messenger" || channel === "instagram"
      ? "h-10 w-10 text-[12px]"
      : "h-9 w-9 text-[11px]";
  return (
    <span
      className={`flex ${size} shrink-0 items-center justify-center rounded-full font-black shadow-sm ${meta.badgeClass}`}
      title={meta.name}
    >
      {meta.short}
    </span>
  );
}

function ChannelsPrototypeTab({
  cfg,
  setCfg,
  onSnapshot,
  onEdit,
}: {
  cfg: FullConfig;
  setCfg: (cfg: FullConfig) => void;
  onSnapshot: () => void;
  onEdit: (key: string) => void;
}) {
  const introGroups = activeIntroGroups(cfg);
  const mode = activeModality(cfg);
  const enabledFollowups = cfg.followups.filter((followup) => followup.enabled !== false);
  const paymentPreviewSteps: EditorStep[] = compactSteps([
    {
      type: "text",
      drive_url: "",
      texts: [cfg.payment_text || cfg.payment_buttons_prompt || ""],
      delay_after_sec: 0,
    },
    ...(cfg.direct_payment_enabled ? cfg.direct_payment_steps ?? [] : []),
    ...(cfg.payment_approved ?? []),
  ]);
  const deliveryPreviewSteps = compactSteps([
    ...(cfg.payment_approved ?? []),
    ...(cfg.customer_survey_enabled && cfg.customer_survey_message
      ? [
          {
            type: "text" as const,
            drive_url: "",
            texts: [cfg.customer_survey_message],
            delay_after_sec: 0,
          },
        ]
      : []),
  ]);
  const setChannelEnabled = (
    channel: Exclude<ChannelKey, "whatsapp">,
    enabled: boolean
  ) => {
    onEdit(`channel_${channel}_enabled`);
    setCfg({
      ...cfg,
      channels: {
        ...(cfg.channels ?? {}),
        [channel]: {
          ...(cfg.channels?.[channel] ?? {}),
          enabled,
        },
      },
    });
  };
  const setChannelUseContent = (channel: ChannelKey, enabled: boolean) => {
    onEdit(`channel_${channel}_use_content`);
    setCfg({
      ...cfg,
      channels: {
        ...(cfg.channels ?? {}),
        [channel]: {
          ...(cfg.channels?.[channel] ?? {}),
          enabled: channel === "whatsapp" ? true : cfg.channels?.[channel]?.enabled === true,
          use_content: enabled,
        },
      },
    });
  };
  const setChannelContent = (
    channel: ChannelKey,
    content: ChannelContentEditor
  ) => {
    setCfg({
      ...cfg,
      channels: {
        ...(cfg.channels ?? {}),
        [channel]: {
          ...(cfg.channels?.[channel] ?? {}),
          modality_templates: {
            ...(cfg.channels?.[channel]?.modality_templates ?? {}),
            [mode]: content,
          },
        },
      },
    });
  };
  const cloneChannelFromBase = (channel: ChannelKey) => {
    const current = channelContentForMode(cfg, channel, mode);
    if (
      hasChannelContent(current) &&
      !confirm(
        "Al clonar desde Base reemplazaras todo lo que esta escrito en este canal y modalidad. ¿Continuar?"
      )
    ) {
      return;
    }
    onSnapshot();
    setChannelContent(channel, buildChannelContentFromBase(cfg, channel));
  };

  return (
    <section className="space-y-5">
      <div className="rounded-lg border border-neutral-300 bg-white p-4">
        <h2 className="text-base font-bold text-neutral-900">
          Canales de venta
        </h2>
        <p className="mt-1 text-sm text-neutral-600">
          La Base sigue siendo la fuente importable. Aqui puedes preparar textos
          rapidos por canal; por ahora WhatsApp en esta seccion es una capa segura
          de edicion y no reemplaza el motor real.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {CHANNEL_KEYS.map((channel) => (
          <ChannelSummaryCard key={channel} channel={channel} />
        ))}
      </div>

      <ChannelWorkspace
        channel="whatsapp"
        mode={mode}
        content={channelContentForMode(cfg, "whatsapp", mode)}
        onContentChange={(content) => setChannelContent("whatsapp", content)}
        onCloneFromWhatsapp={() => cloneChannelFromBase("whatsapp")}
        cfg={cfg}
        enabled
        runtimeEnabled={cfg.channels?.whatsapp?.use_content === true}
        onToggleRuntimeEnabled={(enabled) => setChannelUseContent("whatsapp", enabled)}
        onSnapshot={onSnapshot}
        onEdit={onEdit}
      />
      <ChannelWorkspace
        channel="messenger"
        mode={mode}
        content={channelContentForMode(cfg, "messenger", mode)}
        onContentChange={(content) => setChannelContent("messenger", content)}
        onCloneFromWhatsapp={() => cloneChannelFromBase("messenger")}
        cfg={cfg}
        enabled={cfg.channels?.messenger?.enabled === true}
        onToggleEnabled={(enabled) => setChannelEnabled("messenger", enabled)}
        runtimeEnabled={cfg.channels?.messenger?.use_content === true}
        onToggleRuntimeEnabled={(enabled) => setChannelUseContent("messenger", enabled)}
        onSnapshot={onSnapshot}
        onEdit={onEdit}
      />
      <ChannelWorkspace
        channel="instagram"
        mode={mode}
        content={channelContentForMode(cfg, "instagram", mode)}
        onContentChange={(content) => setChannelContent("instagram", content)}
        onCloneFromWhatsapp={() => cloneChannelFromBase("instagram")}
        cfg={cfg}
        enabled={cfg.channels?.instagram?.enabled === true}
        onToggleEnabled={(enabled) => setChannelEnabled("instagram", enabled)}
        runtimeEnabled={cfg.channels?.instagram?.use_content === true}
        onToggleRuntimeEnabled={(enabled) => setChannelUseContent("instagram", enabled)}
        onSnapshot={onSnapshot}
        onEdit={onEdit}
      />
      <ChannelWorkspace
        channel="tiktok"
        mode={mode}
        content={channelContentForMode(cfg, "tiktok", mode)}
        onContentChange={(content) => setChannelContent("tiktok", content)}
        onCloneFromWhatsapp={() => cloneChannelFromBase("tiktok")}
        cfg={cfg}
        enabled={cfg.channels?.tiktok?.enabled === true}
        onToggleEnabled={(enabled) => setChannelEnabled("tiktok", enabled)}
        runtimeEnabled={cfg.channels?.tiktok?.use_content === true}
        onToggleRuntimeEnabled={(enabled) => setChannelUseContent("tiktok", enabled)}
        disabled
        onSnapshot={onSnapshot}
        onEdit={onEdit}
      />
    </section>
  );
}

function ChannelSummaryCard({ channel }: { channel: ChannelKey }) {
  const meta = CHANNEL_PROTOTYPE_META[channel];
  return (
    <div className={`rounded-lg border p-4 ${meta.panelClass}`}>
      <div className="flex items-center gap-3">
        <ChannelBadge channel={channel} />
        <div className="min-w-0">
          <div className="truncate text-sm font-bold text-neutral-900">
            {meta.name}
          </div>
          <div className="text-xs font-medium text-neutral-600">{meta.status}</div>
          <div className="mt-1 text-[11px] leading-snug text-neutral-500">
            {meta.setupHint}
          </div>
        </div>
      </div>
    </div>
  );
}

function ChannelWorkspace({
  channel,
  mode,
  introGroups,
  followups,
  paymentPreviewSteps,
  deliveryPreviewSteps,
  content,
  onContentChange,
  onCloneFromWhatsapp,
  cfg,
  connected = false,
  enabled = false,
  runtimeEnabled = false,
  onToggleEnabled,
  onToggleRuntimeEnabled,
  disabled = false,
  onSnapshot,
  onEdit,
}: {
  channel: ChannelKey;
  mode: Modo;
  introGroups?: Array<{ label: string; steps: EditorStep[] }>;
  followups?: EditorFollowup[];
  paymentPreviewSteps?: EditorStep[];
  deliveryPreviewSteps?: EditorStep[];
  content?: ChannelContentEditor;
  onContentChange?: (content: ChannelContentEditor) => void;
  onCloneFromWhatsapp?: () => void;
  cfg: FullConfig;
  connected?: boolean;
  enabled?: boolean;
  runtimeEnabled?: boolean;
  onToggleEnabled?: (enabled: boolean) => void;
  onToggleRuntimeEnabled?: (enabled: boolean) => void;
  disabled?: boolean;
  onSnapshot: () => void;
  onEdit: (key: string) => void;
}) {
  const meta = CHANNEL_PROTOTYPE_META[channel];
  const price = cfg.globals.course_price_soles;
  const editableContent = content ?? emptyChannelContent();
  const updateContent = (patch: Partial<ChannelContentEditor>) => {
    onContentChange?.({ ...editableContent, ...patch });
  };
  const previewContext = previewContextFromConfig(cfg);
  const collapseChannel = () => {
    window.dispatchEvent(
      new CustomEvent("wf:collapse-all", { detail: { prefix: `channel_${channel}_` } })
    );
  };

  return (
    <div className={`rounded-lg border bg-white p-4 ${meta.panelClass}`}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <ChannelBadge channel={channel} />
          <div>
            <h3 className="text-base font-bold text-neutral-900">{meta.name}</h3>
            <p className="text-xs text-neutral-600">
              {meta.status} - Modalidad: {MODALIDAD_LABEL[mode]}
            </p>
            <p className="mt-1 max-w-xl text-[11px] leading-snug text-neutral-500">
              {meta.setupHint}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={collapseChannel}
          className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
        >
          Collapse all
        </button>
        {(channel === "whatsapp" || onToggleRuntimeEnabled) && (
          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
            <input
              type="checkbox"
              checked={runtimeEnabled}
              onChange={(e) => onToggleRuntimeEnabled?.(e.target.checked)}
              disabled={disabled || (channel !== "whatsapp" && !enabled)}
              className="h-4 w-4 accent-amber-600"
            />
            Usar textos del canal
          </label>
        )}
        {channel !== "whatsapp" && (
          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs font-bold text-neutral-700">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => onToggleEnabled?.(e.target.checked)}
              disabled={disabled}
              className="h-4 w-4 accent-emerald-600"
            />
            {enabled ? "ON" : "OFF"}
          </label>
        )}
        {!connected && !disabled && (
          <button
            type="button"
            onClick={onCloneFromWhatsapp}
            title="Copia una vez el contenido base de la modalidad activa para este canal"
            className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
          >
            Clonar desde Base
          </button>
        )}
      </div>

      <div className="space-y-3">
        <Collapsible
          title="Intro"
          titleKey={`channel_${channel}_intro`}
          defaultOpen={channel === "whatsapp"}
        >
          {() => connected ? (
            <div className="space-y-3">
              {(introGroups ?? []).map((group, index) => (
                <Collapsible
                  key={group.label}
                  title={group.label}
                  titleKey={`channel_${channel}_intro_${index}`}
                >
                  <ChatPreview
                    steps={group.steps}
                    priceSoles={price}
                    previewContext={previewContext}
                  />
                </Collapsible>
              ))}
            </div>
          ) : (
            <ChannelIntroEditor
              channel={channel}
              content={editableContent}
              onChange={updateContent}
              price={price}
              previewContext={previewContext}
              onSnapshot={onSnapshot}
              onEdit={onEdit}
            />
          )}
        </Collapsible>

        <Collapsible title="Seguimientos" titleKey={`channel_${channel}_followups`}>
          {() => connected ? (
            <div className="space-y-3">
              {(followups ?? []).length === 0 && (
                <p className="text-sm text-neutral-500">
                  No hay seguimientos activos para mostrar.
                </p>
              )}
              {(followups ?? []).map((followup, index) => (
                <Collapsible
                  key={`${followup.name}_${index}`}
                  title={followup.name || `Seguimiento ${index + 1}`}
                  titleKey={`channel_${channel}_followup_${index}`}
                >
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1 text-[11px] font-semibold text-neutral-600">
                      {followupTimeLabel(followup.delay_minutes_from_first_message)}
                    </span>
                  </div>
                  <ChatPreview
                    steps={compactSteps(followup.steps)}
                    priceSoles={price}
                    previewContext={previewContext}
                  />
                  {(followup.variants ?? []).length > 0 && (
                    <div className="mt-2 text-[11px] font-semibold text-sky-700">
                      Variantes: {(followup.variants ?? []).length}
                    </div>
                  )}
                </Collapsible>
              ))}
            </div>
          ) : (
            <ChannelFollowupsEditor
              channel={channel}
              content={editableContent}
              onChange={updateContent}
              price={price}
              previewContext={previewContext}
              onSnapshot={onSnapshot}
              onEdit={onEdit}
            />
          )}
        </Collapsible>

        <Collapsible title="Pago" titleKey={`channel_${channel}_payment`}>
          {() => connected ? (
            <ChatPreview
              steps={paymentPreviewSteps ?? []}
              priceSoles={price}
              previewContext={previewContext}
            />
          ) : (
            <StepEditorPreviewPair
              steps={editableContent.payment}
              onChange={(steps) => updateContent({ payment: steps })}
              onSnapshot={onSnapshot}
              onEdit={onEdit}
              idPrefix={`channel_${channel}_${mode}_payment`}
              priceSoles={price}
              previewContext={previewContext}
              className="lg:grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(220px,280px)]"
            />
          )}
        </Collapsible>

        <Collapsible title="Entregas por modalidad" titleKey={`channel_${channel}_delivery`}>
          {() => connected ? (
            <ChatPreview
              steps={deliveryPreviewSteps ?? []}
              priceSoles={price}
              previewContext={previewContext}
            />
          ) : (
            <ChannelDeliveryEditor
              channel={channel}
              mode={mode}
              content={editableContent}
              onChange={updateContent}
              price={price}
              previewContext={previewContext}
              onSnapshot={onSnapshot}
              onEdit={onEdit}
            />
          )}
        </Collapsible>

        <Collapsible title="Postventa extra" titleKey={`channel_${channel}_post_sale`}>
          {() => connected ? (
            <p className="text-sm text-neutral-500">
              WhatsApp usa la postventa central actual del bot.
            </p>
          ) : (
            <ChannelPostSaleEditorPanel
              channel={channel}
              value={editableContent.post_sale}
              onChange={(postSale) => updateContent({ post_sale: postSale })}
              onEdit={onEdit}
            />
          )}
        </Collapsible>
      </div>
    </div>
  );
}

function ChannelIntroEditor({
  channel,
  content,
  onChange,
  price,
  previewContext,
  onSnapshot,
  onEdit,
}: {
  channel: ChannelKey;
  content: ChannelContentEditor;
  onChange: (patch: Partial<ChannelContentEditor>) => void;
  price: number;
  previewContext: PreviewContext;
  onSnapshot: () => void;
  onEdit: (key: string) => void;
}) {
  const groups = content.intro_groups ?? [];
  const updateGroup = (index: number, patch: Partial<ChannelIntroGroupEditor>) => {
    onChange({
      intro_groups: groups.map((group, i) =>
        i === index ? { ...group, ...patch } : group
      ),
    });
  };
  const duplicateGroup = (index: number) => {
    onSnapshot();
    const copy = cloneJson(groups[index]);
    onChange({
      intro_groups: [
        ...groups.slice(0, index + 1),
        { ...copy, name: `${copy.name || "Intro"} copia` },
        ...groups.slice(index + 1),
      ],
    });
  };
  const moveGroup = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= groups.length) return;
    onSnapshot();
    keepMovedCollapsibleOpen(`channel_${channel}_own_intro`, index, target);
    onChange({ intro_groups: moveItem(groups, index, target) });
  };
  const removeGroup = (index: number) => {
    if (!confirm("Quitar este cajon de intro?")) return;
    onSnapshot();
    onChange({ intro_groups: groups.filter((_, i) => i !== index) });
  };
  const addGroup = () => {
    onSnapshot();
    onChange({
      intro_groups: [
        ...groups,
        {
          name: `Intro ${groups.length + 1}`,
          enabled: true,
          weight: 1,
          adName: "",
          adId: "",
          steps: [emptyStep()],
        },
      ],
    });
  };

  return (
    <div className="space-y-3">
      {groups.map((group, index) => (
        <Collapsible
          key={`channel-${channel}-intro-${index}`}
          title={`${group.enabled === false ? "OFF - " : ""}${group.name || `Intro ${index + 1}`}`}
          titleKey={`channel_${channel}_own_intro_${index}`}
          headerActions={
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  moveGroup(index, -1);
                }}
                disabled={index === 0}
                className="rounded border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-bold text-sky-700 hover:bg-sky-100 disabled:opacity-30"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  moveGroup(index, 1);
                }}
                disabled={index === groups.length - 1}
                className="rounded border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-bold text-sky-700 hover:bg-sky-100 disabled:opacity-30"
              >
                ↓
              </button>
              <button
                type="button"
                draggable
                onClick={(e) => e.stopPropagation()}
                onDragStart={(e) => {
                  e.stopPropagation();
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData(
                    "text/plain",
                    `channel-intro:${channel}:${index}`
                  );
                }}
                title="Mover cajón"
                className="cursor-grab rounded border border-sky-300 bg-white px-2 py-1 text-xs font-bold text-sky-700 active:cursor-grabbing"
              >
                ⋮⋮ Mover
              </button>
            </>
          }
          onDragOver={(e) => {
            e.preventDefault();
          }}
          onDrop={(e) => {
            e.preventDefault();
            const raw = e.dataTransfer.getData("text/plain");
            const [kind, dragChannel, rawIndex] = raw.split(":");
            if (kind !== "channel-intro" || dragChannel !== channel) return;
            const from = Number(rawIndex);
            if (!Number.isFinite(from)) return;
            if (from === index) return;
            onSnapshot();
            keepMovedCollapsibleOpen(`channel_${channel}_own_intro`, from, index);
            onChange({ intro_groups: moveItem(groups, from, index) });
          }}
          titleClassName={
            group.enabled === false
              ? "border-neutral-500 bg-neutral-300 text-neutral-900"
              : undefined
          }
          bodyClassName={group.enabled === false ? "bg-neutral-300" : undefined}
          defaultOpen={index === 0}
        >
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input
              value={group.name}
              onChange={(e) => {
                onEdit(`channel_${channel}_intro_${index}_name`);
                updateGroup(index, { name: e.target.value });
              }}
              className="min-w-48 rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm"
            />
            <button
              type="button"
              onClick={() => {
                onEdit(`channel_${channel}_intro_${index}_enabled`);
                updateGroup(index, { enabled: group.enabled === false });
              }}
              className={`rounded border px-2 py-1 text-xs font-semibold ${
                group.enabled === false
                  ? "border-neutral-300 bg-neutral-100 text-neutral-400"
                  : "border-emerald-300 bg-emerald-50 text-emerald-700"
              }`}
            >
              {group.enabled === false ? "OFF" : "ON"}
            </button>
            <label className="flex items-center gap-2 rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-700">
              <span className="font-medium">Peso</span>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={group.weight ?? 1}
                onChange={(e) => {
                  onEdit(`channel_${channel}_intro_${index}_weight`);
                  const digits = e.target.value.replace(/\D/g, "");
                  updateGroup(index, {
                    weight: Math.max(1, Math.floor(Number(digits) || 1)),
                  });
                }}
                className="w-14 rounded border border-neutral-300 px-2 py-1 text-right text-xs font-semibold text-neutral-900 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                title="Peso de prioridad para elegir esta intro"
              />
              <span className="font-semibold text-neutral-500">%</span>
            </label>
            <button
              type="button"
              onClick={() => moveGroup(index, -1)}
              disabled={index === 0}
              className="rounded border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-bold text-sky-700 hover:bg-sky-100 disabled:opacity-30"
            >
              ↑ Subir cajón
            </button>
            <button
              type="button"
              onClick={() => moveGroup(index, 1)}
              disabled={index === groups.length - 1}
              className="rounded border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-bold text-sky-700 hover:bg-sky-100 disabled:opacity-30"
            >
              ↓ Bajar cajón
            </button>
            <button
              type="button"
              onClick={() => duplicateGroup(index)}
              className="rounded border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-600"
            >
              Duplicar cajon
            </button>
            <button
              type="button"
              onClick={() => removeGroup(index)}
              className="rounded border border-red-200 bg-white px-2 py-1 text-xs text-red-600"
            >
              Quitar
            </button>
          </div>
          <div className="mb-3 grid gap-2 md:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-neutral-500">
                Nombre del AD
              </span>
              <input
                type="text"
                value={group.adName ?? ""}
                onChange={(e) => {
                  onEdit(`channel_${channel}_intro_${index}_ad_name`);
                  updateGroup(index, { adName: e.target.value });
                }}
                className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-neutral-500">
                ID del AD
              </span>
              <input
                type="text"
                value={group.adId ?? ""}
                onChange={(e) => {
                  onEdit(`channel_${channel}_intro_${index}_ad_id`);
                  updateGroup(index, { adId: e.target.value });
                }}
                className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm"
              />
            </label>
          </div>
          <StepEditorPreviewPair
            steps={group.steps}
            onChange={(steps) => updateGroup(index, { steps })}
            onSnapshot={onSnapshot}
            onEdit={onEdit}
            idPrefix={`channel_${channel}_intro_${index}`}
            priceSoles={price}
            previewContext={previewContext}
            className="lg:grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(220px,280px)]"
          />
        </Collapsible>
      ))}
      <button
        type="button"
        onClick={addGroup}
        className="w-full rounded-md border-2 border-dashed border-neutral-300 py-2 text-sm text-neutral-500 hover:border-emerald-400 hover:text-emerald-600"
      >
        Agregar cajon de intro
      </button>
    </div>
  );
}

function ChannelFollowupsEditor({
  channel,
  content,
  onChange,
  price,
  previewContext,
  onSnapshot,
  onEdit,
}: {
  channel: ChannelKey;
  content: ChannelContentEditor;
  onChange: (patch: Partial<ChannelContentEditor>) => void;
  price: number;
  previewContext: PreviewContext;
  onSnapshot: () => void;
  onEdit: (key: string) => void;
}) {
  const followups = content.followups ?? [];
  const updateFollowup = (index: number, patch: Partial<EditorFollowup>) => {
    onChange({
      followups: followups.map((followup, i) =>
        i === index ? { ...followup, ...patch } : followup
      ),
    });
  };
  const duplicateFollowup = (index: number) => {
    onSnapshot();
    const copy = cloneJson(followups[index]);
    onChange({
      followups: [
        ...followups.slice(0, index + 1),
        { ...copy, name: `${copy.name || "Seguimiento"} copia` },
        ...followups.slice(index + 1),
      ],
    });
  };
  const moveFollowup = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= followups.length) return;
    onSnapshot();
    keepMovedCollapsibleOpen(`channel_${channel}_own_followup`, index, target);
    onChange({ followups: moveItem(followups, index, target) });
  };
  const removeFollowup = (index: number) => {
    if (!confirm("Quitar este seguimiento?")) return;
    onSnapshot();
    onChange({ followups: followups.filter((_, i) => i !== index) });
  };
  const addFollowup = () => {
    onSnapshot();
    onChange({
      followups: [
        ...followups,
        {
          name: `Seguimiento ${followups.length + 1}`,
          delay_minutes_from_first_message: 0,
          enabled: true,
          steps: [emptyStep()],
          variants: [],
        },
      ],
    });
  };
  const updateVariant = (
    followupIndex: number,
    variantIndex: number,
    patch: Partial<EditorFollowupVariant>
  ) => {
    const followup = followups[followupIndex];
    const variants = followup.variants ?? [];
    updateFollowup(followupIndex, {
      variants: variants.map((variant, i) =>
        i === variantIndex ? { ...variant, ...patch } : variant
      ),
    });
  };
  const addVariant = (followupIndex: number) => {
    onSnapshot();
    const followup = followups[followupIndex];
    const variants = followup.variants ?? [];
    updateFollowup(followupIndex, {
      variants: [
        ...variants,
        {
          name: `Variante ${variants.length + 1}`,
          enabled: true,
          steps: cloneJson(followup.steps ?? [emptyStep()]),
        },
      ],
    });
  };
  const duplicateVariant = (followupIndex: number, variantIndex: number) => {
    onSnapshot();
    const followup = followups[followupIndex];
    const variants = followup.variants ?? [];
    const copy = cloneJson(variants[variantIndex]);
    updateFollowup(followupIndex, {
      variants: [
        ...variants.slice(0, variantIndex + 1),
        { ...copy, name: `${copy.name || "Variante"} copia` },
        ...variants.slice(variantIndex + 1),
      ],
    });
  };
  const removeVariant = (followupIndex: number, variantIndex: number) => {
    if (!confirm("Quitar esta variante de seguimiento?")) return;
    onSnapshot();
    const variants = followups[followupIndex]?.variants ?? [];
    updateFollowup(followupIndex, {
      variants: variants.filter((_, i) => i !== variantIndex),
    });
  };
  const cloneMainIntoVariant = (followupIndex: number, variantIndex: number) => {
    const followup = followups[followupIndex];
    const variant = followup?.variants?.[variantIndex];
    const hasText = (variant?.steps ?? []).some(
      (step) =>
        step.drive_url.trim() ||
        step.texts.some((text) => text.trim().length > 0)
    );
    if (
      hasText &&
      !confirm(
        "Al clonar desde principal reemplazaras el texto de esta variante. ¿Continuar?"
      )
    ) {
      return;
    }
    onSnapshot();
    updateVariant(followupIndex, variantIndex, {
      steps: cloneJson(followup.steps ?? [emptyStep()]),
    });
  };
  const cloneVariantIntoVariant = (
    followupIndex: number,
    sourceVariantIndex: number,
    targetVariantIndex: number
  ) => {
    const variants = followups[followupIndex]?.variants ?? [];
    const source = variants[sourceVariantIndex];
    const target = variants[targetVariantIndex];
    const hasText = (target?.steps ?? []).some(
      (step) =>
        step.drive_url.trim() ||
        step.texts.some((text) => text.trim().length > 0)
    );
    if (
      hasText &&
      !confirm(
        `Al clonar desde variante ${sourceVariantIndex + 1} reemplazaras el texto de esta variante. ¿Continuar?`
      )
    ) {
      return;
    }
    onSnapshot();
    updateVariant(followupIndex, targetVariantIndex, {
      steps: cloneJson(source?.steps ?? [emptyStep()]),
    });
  };

  return (
    <div className="space-y-3">
      {followups.map((followup, index) => (
        <Collapsible
          key={`${followup.name}_${index}`}
          title={`${followup.enabled === false ? "OFF - " : ""}${followup.name || `Seguimiento ${index + 1}`}`}
          titleKey={`channel_${channel}_own_followup_${index}`}
          headerActions={
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  moveFollowup(index, -1);
                }}
                disabled={index === 0}
                className="rounded border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-bold text-sky-700 hover:bg-sky-100 disabled:opacity-30"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  moveFollowup(index, 1);
                }}
                disabled={index === followups.length - 1}
                className="rounded border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-bold text-sky-700 hover:bg-sky-100 disabled:opacity-30"
              >
                ↓
              </button>
              <button
                type="button"
                draggable
                onClick={(e) => e.stopPropagation()}
                onDragStart={(e) => {
                  e.stopPropagation();
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData(
                    "text/plain",
                    `channel-followup:${channel}:${index}`
                  );
                }}
                title="Mover cajón"
                className="cursor-grab rounded border border-sky-300 bg-white px-2 py-1 text-xs font-bold text-sky-700 active:cursor-grabbing"
              >
                ⋮⋮ Mover
              </button>
            </>
          }
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const raw = e.dataTransfer.getData("text/plain");
            const [kind, dragChannel, rawIndex] = raw.split(":");
            if (kind !== "channel-followup" || dragChannel !== channel) return;
            const from = Number(rawIndex);
            if (!Number.isFinite(from) || from === index) return;
            onSnapshot();
            keepMovedCollapsibleOpen(`channel_${channel}_own_followup`, from, index);
            onChange({ followups: moveItem(followups, from, index) });
          }}
          titleClassName={
            followup.enabled === false
              ? "border-neutral-500 bg-neutral-300 text-neutral-900"
              : undefined
          }
          bodyClassName={followup.enabled === false ? "bg-neutral-300" : undefined}
        >
          <div className="mb-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={followup.name}
                onChange={(e) => {
                  onEdit(`channel_${channel}_followup_${index}_name`);
                  updateFollowup(index, { name: e.target.value });
                }}
                className="min-w-48 flex-1 rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm"
              />
              <button
                type="button"
                onClick={() => {
                  onEdit(`channel_${channel}_followup_${index}_enabled`);
                  updateFollowup(index, { enabled: followup.enabled === false });
                }}
                className={`rounded border px-2 py-1 text-xs font-semibold ${
                  followup.enabled === false
                    ? "border-neutral-300 bg-neutral-100 text-neutral-400"
                    : "border-emerald-300 bg-emerald-50 text-emerald-700"
                }`}
              >
                {followup.enabled === false ? "OFF" : "ON"}
              </button>
            </div>
            <div className="flex flex-wrap items-end gap-2">
            <label className="grid gap-1">
              <span className="text-[10px] font-semibold uppercase text-neutral-500">
                Delay (min)
              </span>
              <input
                type="number"
                value={followup.delay_minutes_from_first_message}
                onChange={(e) => {
                  onEdit(`channel_${channel}_followup_${index}_delay`);
                  updateFollowup(index, {
                    delay_minutes_from_first_message: Number(e.target.value) || 0,
                  });
                }}
                title="Delay en minutos desde el primer mensaje"
                aria-label="Delay en minutos"
                className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm"
              />
            </label>
            <button
              type="button"
              onClick={() => moveFollowup(index, -1)}
              disabled={index === 0}
              className="rounded border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-bold text-sky-700 hover:bg-sky-100 disabled:opacity-30"
            >
              ↑ Subir cajón
            </button>
            <button
              type="button"
              onClick={() => moveFollowup(index, 1)}
              disabled={index === followups.length - 1}
              className="rounded border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-bold text-sky-700 hover:bg-sky-100 disabled:opacity-30"
            >
              ↓ Bajar cajón
            </button>
            <button
              type="button"
              onClick={() => duplicateFollowup(index)}
              className="rounded border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-600"
            >
              Duplicar
            </button>
            <button
              type="button"
              onClick={() => removeFollowup(index)}
              className="rounded border border-red-200 bg-white px-2 py-1 text-xs text-red-600"
            >
              Quitar
            </button>
            </div>
          </div>
          <Collapsible
            title="Mensajes principales"
            titleKey={`channel_${channel}_own_followup_${index}_steps`}
            defaultOpen
          >
            <StepEditorPreviewPair
              steps={followup.steps}
              onChange={(steps) => updateFollowup(index, { steps })}
              onSnapshot={onSnapshot}
              onEdit={onEdit}
              idPrefix={`channel_${channel}_followup_${index}`}
              priceSoles={price}
              previewContext={previewContext}
              className="lg:grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(220px,280px)]"
            />
          </Collapsible>
          <Collapsible
            title="Variantes"
            titleKey={`channel_${channel}_own_followup_${index}_variants`}
          >
            <div className="space-y-3">
              {(followup.variants ?? []).map((variant, variantIndex) => (
                <Collapsible
                  key={`${variant.name}_${variantIndex}`}
                  title={`${variant.enabled === false ? "OFF - " : ""}${variant.name || `Variante ${variantIndex + 1}`}`}
                  titleKey={`channel_${channel}_followup_${index}_variant_${variantIndex}`}
                  titleClassName={
                    followup.enabled === false || variant.enabled === false
                      ? "border-neutral-500 bg-neutral-300 text-neutral-900"
                      : undefined
                  }
                  bodyClassName={
                    followup.enabled === false || variant.enabled === false
                      ? "bg-neutral-300"
                      : undefined
                  }
                >
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <input
                      value={variant.name ?? ""}
                      onChange={(e) => {
                        onEdit(
                          `channel_${channel}_followup_${index}_variant_${variantIndex}_name`
                        );
                        updateVariant(index, variantIndex, {
                          name: e.target.value,
                        });
                      }}
                      className="min-w-48 rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        onEdit(
                          `channel_${channel}_followup_${index}_variant_${variantIndex}_enabled`
                        );
                        updateVariant(index, variantIndex, {
                          enabled: variant.enabled === false,
                        });
                      }}
                      className={`rounded border px-2 py-1 text-xs font-semibold ${
                        variant.enabled === false
                          ? "border-neutral-300 bg-neutral-100 text-neutral-400"
                          : "border-emerald-300 bg-emerald-50 text-emerald-700"
                      }`}
                    >
                      {variant.enabled === false ? "OFF" : "ON"}
                    </button>
                    <button
                      type="button"
                      onClick={() => cloneMainIntoVariant(index, variantIndex)}
                      className="rounded border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-600"
                    >
                      Clonar principal
                    </button>
                    {(followup.variants ?? []).map((sourceVariant, sourceIndex) =>
                      sourceIndex === variantIndex ? null : (
                        <button
                          key={`${sourceVariant.name}_${sourceIndex}`}
                          type="button"
                          onClick={() =>
                            cloneVariantIntoVariant(index, sourceIndex, variantIndex)
                          }
                          className="rounded border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-600"
                        >
                          Clonar variante {sourceIndex + 1}
                        </button>
                      )
                    )}
                    <button
                      type="button"
                      onClick={() => duplicateVariant(index, variantIndex)}
                      className="rounded border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-600"
                    >
                      Duplicar
                    </button>
                    <button
                      type="button"
                      onClick={() => removeVariant(index, variantIndex)}
                      className="rounded border border-red-200 bg-white px-2 py-1 text-xs text-red-600"
                    >
                      Quitar
                    </button>
                  </div>
                  <StepEditorPreviewPair
                    steps={variant.steps}
                    onChange={(steps) =>
                      updateVariant(index, variantIndex, { steps })
                    }
                    onSnapshot={onSnapshot}
                    onEdit={onEdit}
                    idPrefix={`channel_${channel}_followup_${index}_variant_${variantIndex}`}
                    priceSoles={price}
                    previewContext={previewContext}
                    className="lg:grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(220px,280px)]"
                  />
                </Collapsible>
              ))}
              <button
                type="button"
                onClick={() => addVariant(index)}
                className="w-full rounded-md border-2 border-dashed border-neutral-300 py-2 text-sm text-neutral-500 hover:border-sky-400 hover:text-sky-600"
              >
                Agregar variante
              </button>
            </div>
          </Collapsible>
        </Collapsible>
      ))}
      <button
        type="button"
        onClick={addFollowup}
        className="w-full rounded-md border-2 border-dashed border-neutral-300 py-2 text-sm text-neutral-500 hover:border-emerald-400 hover:text-emerald-600"
      >
        Agregar seguimiento
      </button>
    </div>
  );
}

function deliveryGroupsForChannelContent(
  content: ChannelContentEditor
): ChannelDeliveryGroupEditor[] {
  const groups = content.delivery_groups ?? [];
  if (groups.length > 0) return groups;
  return [
    {
      key: "central",
      name: "Entrega pago aprobado",
      enabled: true,
      steps: content.delivery?.length ? content.delivery : [emptyStep()],
    },
  ];
}

function ChannelDeliveryEditor({
  channel,
  mode,
  content,
  onChange,
  price,
  previewContext,
  onSnapshot,
  onEdit,
}: {
  channel: ChannelKey;
  mode: Modo;
  content: ChannelContentEditor;
  onChange: (patch: Partial<ChannelContentEditor>) => void;
  price: number;
  previewContext: PreviewContext;
  onSnapshot: () => void;
  onEdit: (key: string) => void;
}) {
  const groups = deliveryGroupsForChannelContent(content);
  const hasFixedDeliveries = mode !== "lineal";
  const isFixedDeliveryGroup = (key: string) =>
    hasFixedDeliveries &&
    (key.startsWith("order_bump_") ||
      key.startsWith("doble_oferta_dos_") ||
      key.startsWith("bioferta_"));
  const updateGroup = (
    index: number,
    patch: Partial<ChannelDeliveryGroupEditor>
  ) => {
    const nextGroups = groups.map((group, i) =>
      i === index ? { ...group, ...patch } : group
    );
    onChange({
      delivery_groups: nextGroups,
      delivery: nextGroups[0]?.steps ?? content.delivery,
    });
  };
  const addGroup = () => {
    onSnapshot();
    onChange({
      delivery_groups: [
        ...groups,
        {
          key: `extra_${groups.length + 1}`,
          name: `Entrega extra ${groups.length + 1}`,
          enabled: true,
          steps: [emptyStep()],
        },
      ],
    });
  };
  const duplicateGroup = (index: number) => {
    onSnapshot();
    const copy = cloneJson(groups[index]);
    onChange({
      delivery_groups: [
        ...groups.slice(0, index + 1),
        {
          ...copy,
          key: `${copy.key}_copy_${Date.now()}`,
          name: `${copy.name} copia`,
        },
        ...groups.slice(index + 1),
      ],
    });
  };
  const moveGroup = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= groups.length) return;
    if (
      isFixedDeliveryGroup(groups[index]?.key ?? "") ||
      isFixedDeliveryGroup(groups[target]?.key ?? "")
    ) {
      return;
    }
    onSnapshot();
    keepMovedCollapsibleOpenExact(
      `channel_${channel}_${mode}_delivery_${groups[index]?.key}_${index}`,
      `channel_${channel}_${mode}_delivery_${groups[index]?.key}_${target}`
    );
    const nextGroups = moveItem(groups, index, target);
    onChange({
      delivery_groups: nextGroups,
      delivery: nextGroups[0]?.steps ?? content.delivery,
    });
  };
  const removeGroup = (index: number) => {
    if (!confirm("Quitar este cajon de entrega?")) return;
    onSnapshot();
    const nextGroups = groups.filter((_, i) => i !== index);
    onChange({
      delivery_groups: nextGroups,
      delivery: nextGroups[0]?.steps ?? [emptyStep()],
    });
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-neutral-500">
        Estos cajones separan la entrega segun la modalidad activa:{" "}
        {MODALIDAD_LABEL[mode]}. Sirven para no mezclar enlaces o materiales de
        productos distintos.
      </p>
      {hasFixedDeliveries && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
          En esta modalidad las entregas son fijas y se crean al usar Clonar desde
          Base. No necesitas agregarlas manualmente.
        </p>
      )}
      {groups.map((group, index) => (
        <Collapsible
          key={`${group.key}_${index}`}
          title={`${group.enabled === false ? "OFF - " : ""}${group.name || `Entrega ${index + 1}`}`}
          titleKey={`channel_${channel}_${mode}_delivery_${group.key}_${index}`}
          headerActions={
            !isFixedDeliveryGroup(group.key) ? (
              <>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    moveGroup(index, -1);
                  }}
                  disabled={
                    index === 0 ||
                    isFixedDeliveryGroup(groups[index - 1]?.key ?? "")
                  }
                  className="rounded border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-bold text-sky-700 hover:bg-sky-100 disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    moveGroup(index, 1);
                  }}
                  disabled={
                    index === groups.length - 1 ||
                    isFixedDeliveryGroup(groups[index + 1]?.key ?? "")
                  }
                  className="rounded border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-bold text-sky-700 hover:bg-sky-100 disabled:opacity-30"
                >
                  ↓
                </button>
                <button
                  type="button"
                  draggable
                  onClick={(e) => e.stopPropagation()}
                  onDragStart={(e) => {
                    e.stopPropagation();
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData(
                      "text/plain",
                      `channel-delivery:${channel}:${mode}:${index}`
                    );
                  }}
                  title="Mover cajón"
                  className="cursor-grab rounded border border-sky-300 bg-white px-2 py-1 text-xs font-bold text-sky-700 active:cursor-grabbing"
                >
                  ⋮⋮ Mover
                </button>
              </>
            ) : undefined
          }
          onDragOver={(e) => {
            if (!isFixedDeliveryGroup(group.key)) e.preventDefault();
          }}
          onDrop={(e) => {
            if (isFixedDeliveryGroup(group.key)) return;
            e.preventDefault();
            const raw = e.dataTransfer.getData("text/plain");
            const [kind, dragChannel, dragMode, rawIndex] = raw.split(":");
            if (
              kind !== "channel-delivery" ||
              dragChannel !== channel ||
              dragMode !== mode
            ) {
              return;
            }
            const from = Number(rawIndex);
            if (
              !Number.isFinite(from) ||
              from === index ||
              isFixedDeliveryGroup(groups[from]?.key ?? "")
            ) {
              return;
            }
            onSnapshot();
            keepMovedCollapsibleOpenExact(
              `channel_${channel}_${mode}_delivery_${groups[from]?.key}_${from}`,
              `channel_${channel}_${mode}_delivery_${groups[from]?.key}_${index}`
            );
            const nextGroups = moveItem(groups, from, index);
            onChange({
              delivery_groups: nextGroups,
              delivery: nextGroups[0]?.steps ?? content.delivery,
            });
          }}
          titleClassName={
            group.enabled === false
              ? "border-neutral-500 bg-neutral-300 text-neutral-900"
              : undefined
          }
          bodyClassName={group.enabled === false ? "bg-neutral-300" : undefined}
          defaultOpen={index === 0}
        >
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input
              value={group.name}
              onChange={(e) => {
                onEdit(`channel_${channel}_${mode}_delivery_${index}_name`);
                updateGroup(index, { name: e.target.value });
              }}
              className="min-w-48 rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm"
            />
            <button
              type="button"
              onClick={() => {
                onEdit(`channel_${channel}_${mode}_delivery_${index}_enabled`);
                updateGroup(index, { enabled: group.enabled === false });
              }}
              className={`rounded border px-2 py-1 text-xs font-semibold ${
                group.enabled === false
                  ? "border-neutral-300 bg-neutral-100 text-neutral-400"
                  : "border-emerald-300 bg-emerald-50 text-emerald-700"
              }`}
            >
              {group.enabled === false ? "OFF" : "ON"}
            </button>
            {!isFixedDeliveryGroup(group.key) && (
              <>
                <button
                  type="button"
                  onClick={() => moveGroup(index, -1)}
                  disabled={index === 0 || isFixedDeliveryGroup(groups[index - 1]?.key ?? "")}
                  className="rounded border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-bold text-sky-700 hover:bg-sky-100 disabled:opacity-30"
                >
                  ↑ Subir cajón
                </button>
                <button
                  type="button"
                  onClick={() => moveGroup(index, 1)}
                  disabled={
                    index === groups.length - 1 ||
                    isFixedDeliveryGroup(groups[index + 1]?.key ?? "")
                  }
                  className="rounded border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-bold text-sky-700 hover:bg-sky-100 disabled:opacity-30"
                >
                  ↓ Bajar cajón
                </button>
                <button
                  type="button"
                  onClick={() => duplicateGroup(index)}
                  className="rounded border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-600"
                >
                  Duplicar cajon
                </button>
                <button
                  type="button"
                  onClick={() => removeGroup(index)}
                  className="rounded border border-red-200 bg-white px-2 py-1 text-xs text-red-600"
                >
                  Quitar
                </button>
              </>
            )}
          </div>
          <StepEditorPreviewPair
            steps={group.steps}
            onChange={(steps) => updateGroup(index, { steps })}
            onSnapshot={onSnapshot}
            onEdit={onEdit}
            idPrefix={`channel_${channel}_${mode}_delivery_${index}`}
            priceSoles={price}
            previewContext={previewContext}
            className="lg:grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(220px,280px)]"
          />
        </Collapsible>
      ))}
      {!hasFixedDeliveries && (
        <button
          type="button"
          onClick={addGroup}
          className="w-full rounded-md border-2 border-dashed border-neutral-300 py-2 text-sm text-neutral-500 hover:border-emerald-400 hover:text-emerald-600"
        >
          Agregar cajon de entrega
        </button>
      )}
    </div>
  );
}

function ChannelPostSaleEditorPanel({
  channel,
  value,
  onChange,
  onEdit,
}: {
  channel: ChannelKey;
  value?: ChannelPostSaleEditor;
  onChange: (value: ChannelPostSaleEditor) => void;
  onEdit: (key: string) => void;
}) {
  const postSale: ChannelPostSaleEditor = value ?? {
    whatsappPreference: "",
    deliveryUsage: "",
    lifetimeAccess: "",
    farewells: "",
  };
  const update = (key: keyof ChannelPostSaleEditor, nextValue: string) => {
    onEdit(`channel_${channel}_post_sale_${key}`);
    onChange({ ...postSale, [key]: nextValue });
  };
  return (
    <div className="space-y-4">
      <p className="text-xs text-neutral-500">
        Respuestas postventa propias de este canal. No reemplazan las entregas
        de producto; sirven para dudas despues de la compra.
      </p>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-neutral-700">
          Si no quiere dar correo
        </span>
        <EditorEmojiTextarea
          rows={3}
          value={postSale.whatsappPreference}
          onChange={(value) => update("whatsappPreference", value)}
          className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-neutral-700">
          Si pregunta como descargar o usar el material
        </span>
        <EditorEmojiTextarea
          rows={3}
          value={postSale.deliveryUsage}
          onChange={(value) => update("deliveryUsage", value)}
          className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-neutral-700">
          Si pregunta si el acceso es de por vida
        </span>
        <EditorEmojiTextarea
          rows={2}
          value={postSale.lifetimeAccess}
          onChange={(value) => update("lifetimeAccess", value)}
          className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-neutral-700">
          Despedidas postventa
        </span>
        <EditorEmojiTextarea
          rows={3}
          value={postSale.farewells}
          onChange={(value) => update("farewells", value)}
          className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
        />
      </label>
    </div>
  );
}

function ChannelEmptyPrototype({
  channel,
  step,
}: {
  channel: ChannelKey;
  step: EditorStep;
}) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <div className="rounded-md border border-dashed border-neutral-300 bg-white p-3">
        <div className="mb-2 flex items-center gap-2">
          <ChannelBadge channel={channel} />
          <span className="text-sm font-bold text-neutral-800">
            Campos propios pendientes
          </span>
        </div>
        <div className="space-y-2 text-xs text-neutral-600">
          <div className="rounded border border-neutral-200 bg-neutral-50 px-3 py-2">
            ON/OFF propio
          </div>
          <div className="rounded border border-neutral-200 bg-neutral-50 px-3 py-2">
            Texto, variantes, media y botones propios
          </div>
          <div className="rounded border border-neutral-200 bg-neutral-50 px-3 py-2">
            Tiempo de envio propio
          </div>
        </div>
      </div>
      <ChatPreview steps={[step]} />
    </div>
  );
}

function GiftText({
  label,
  value,
  onChange,
  hint,
  rows = 4,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  rows?: number;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-semibold text-neutral-700">
        {label}
      </label>
      <EditorEmojiTextarea
        value={value}
        onChange={onChange}
        rows={rows}
        className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-800"
      />
      {hint && <p className="mt-1 text-[11px] text-neutral-400">{hint}</p>}
    </div>
  );
}

type GiftConsentButton = {
  label: string;
  action: "accept" | "reject" | "text";
};

function normalizeGiftConsentButtons(g: Gift): GiftConsentButton[] {
  const saved = Array.isArray(g.consent_buttons) ? g.consent_buttons : [];
  if (saved.length > 0) {
    return saved.slice(0, 3).map((button) => ({
      label: button.label ?? "",
      action:
        button.action === "reject" || button.action === "text"
          ? button.action
          : "accept",
    }));
  }
  return [
    { label: g.consent_yes_label?.trim() || "Si quiero", action: "accept" },
    { label: g.consent_no_label?.trim() || "Por ahora no", action: "reject" },
  ];
}

function GiftConsentButtonsEditor({
  gift,
  onChange,
}: {
  gift: Gift;
  onChange: (patch: Partial<Gift>) => void;
}) {
  const buttons = normalizeGiftConsentButtons(gift);
  const updateButton = (index: number, patch: Partial<GiftConsentButton>) => {
    onChange({
      consent_buttons: buttons.map((button, i) =>
        i === index ? { ...button, ...patch } : button
      ),
    });
  };
  const removeButton = (index: number) => {
    onChange({ consent_buttons: buttons.filter((_, i) => i !== index) });
  };
  const addButton = () => {
    if (buttons.length >= 3) return;
    onChange({
      consent_buttons: [...buttons, { label: "", action: "text" }],
    });
  };

  return (
    <div className="mb-3 rounded-md border border-neutral-200 bg-neutral-50 p-3">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-neutral-700">
            <input
              type="checkbox"
              checked={!!gift.consent_buttons_enabled}
              onChange={(e) =>
                onChange({ consent_buttons_enabled: e.target.checked })
              }
            />
            Mostrar eleccion con botones
          </label>
          {gift.consent_buttons_enabled && (
            <>
              <div>
                <label className="text-xs font-medium text-neutral-600">
                  Texto de la burbuja de botones
                </label>
                <input
                  type="text"
                  value={gift.consent_buttons_prompt ?? ""}
                  onChange={(e) =>
                    onChange({ consent_buttons_prompt: e.target.value })
                  }
                  placeholder="Elige una opcion:"
                  className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm"
                />
              </div>
              <div className="space-y-2">
                {buttons.map((button, index) => (
                  <div
                    key={index}
                    className="grid gap-2 rounded-md border border-neutral-200 bg-white p-2 sm:grid-cols-[1fr_140px_auto]"
                  >
                    <input
                      type="text"
                      value={button.label}
                      onChange={(e) =>
                        updateButton(index, { label: e.target.value })
                      }
                      placeholder={
                        index === 0
                          ? "Si quiero"
                          : index === 1
                            ? "Por ahora no"
                            : "Otro boton"
                      }
                      className="rounded-md border border-neutral-300 px-2 py-1 text-sm"
                    />
                    <select
                      value={button.action}
                      onChange={(e) =>
                        updateButton(index, {
                          action: e.target.value as GiftConsentButton["action"],
                        })
                      }
                      className="rounded-md border border-neutral-300 px-2 py-1 text-xs"
                    >
                      <option value="accept">Aceptar regalo</option>
                      <option value="reject">Rechazar regalo</option>
                      <option value="text">Texto normal</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => removeButton(index)}
                      disabled={buttons.length <= 1}
                      className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 disabled:opacity-30"
                    >
                      Quitar
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addButton}
                  disabled={buttons.length >= 3}
                  className="rounded border border-neutral-300 bg-white px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-100 disabled:opacity-40"
                >
                  + Agregar boton
                </button>
              </div>
            </>
          )}
        </div>
        <div className="lg:sticky lg:top-4 lg:self-start">
          <p className="mb-1 text-[11px] font-medium text-neutral-500">
            Vista previa
          </p>
          {gift.consent_buttons_enabled ? (
            <ButtonsPreview
              prompt={gift.consent_buttons_prompt?.trim() || "Elige una opcion:"}
              buttons={buttons.map((button) => ({
                label: button.label,
                method: button.action,
              }))}
            />
          ) : (
            <p className="rounded-md bg-white px-3 py-4 text-center text-xs text-neutral-400">
              Botones apagados
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function GiftTab({
  cfg,
  setCfg,
  onSnapshot,
  onEdit,
}: {
  cfg: FullConfig;
  setCfg: (c: FullConfig) => void;
  onSnapshot: () => void;
  onEdit: (key: string) => void;
}) {
  const g = cfg.gift;
  const setGift = (patch: Partial<Gift>) =>
    setCfg({ ...cfg, gift: { ...g, ...patch } });
  const setGiftSequence = (steps: EditorStep[]) => {
    const lastText = [...steps]
      .reverse()
      .find((step) => step.type === "text" && step.enabled !== false);
    setGift({
      ask_sequence: steps,
      // Conserva el fallback usado por Variaciones del enlace.
      ask_text: lastText?.texts.find((text) => text.trim()) ?? g.ask_text,
    });
  };
  const setConsentSequence = (steps: EditorStep[]) => {
    const lastText = [...steps]
      .reverse()
      .find((step) => step.type === "text" && step.enabled !== false);
    setGift({
      consent_sequence: steps,
      // Mantiene el fallback retrocompatible (texto único) con el último texto.
      consent_question:
        lastText?.texts.find((text) => text.trim()) ?? g.consent_question,
    });
  };
  const total = g.variants.reduce((s, v) => s + (v.weight || 0), 0) || 1;

  if (!g.has) {
    return (
      <p className="text-sm text-neutral-500">
        Este proyecto no tiene configurada la sección de regalo.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-neutral-600">
        Regalo extra: tras la compra, el bot pregunta si lo quiere; si acepta,
        envía el audio y el texto con el enlace para comentar; al escribir
        “COMENTADO”, manda el PDF de regalo.
      </p>

      {/* Tiempo */}
      <section className="rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="mb-3 text-base font-bold text-neutral-900">Tiempo</h2>
        <NumberField
          label="Espera antes de ofrecer el regalo (seg)"
          value={cfg.globals.awaiting_email_timeout_seconds}
          onChange={(v) =>
            setCfg({
              ...cfg,
              globals: { ...cfg.globals, awaiting_email_timeout_seconds: v },
            })
          }
          hint="Cuánto espera tras pedir el correo antes de mandar el regalo. (Es el mismo valor que en Ajustes.)"
        />
      </section>

      {/* Textos */}
      <section className="space-y-4 rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="text-base font-bold text-neutral-900">Mensajes</h2>
        <div>
          <h3 className="mb-1 text-sm font-semibold text-neutral-800">
            Pregunta de consentimiento
          </h3>
          <p className="mb-3 text-xs text-neutral-500">
            Lo PRIMERO que recibe el cliente (antes de decidir si quiere el
            regalo). Agrega y ordena texto, imagen, audio o video. Si dejas un
            solo texto, se comporta igual que antes.
          </p>
          <GiftConsentButtonsEditor gift={g} onChange={setGift} />
          <StepEditorPreviewPair
            steps={g.consent_sequence}
            onChange={setConsentSequence}
            onSnapshot={onSnapshot}
            onEdit={onEdit}
            idPrefix="gift_consent"
          />
        </div>
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <GiftText
            label="Mensaje si RECHAZA el regalo"
            value={g.decline_message}
            onChange={(v) => setGift({ decline_message: v })}
          />
          <div className="lg:sticky lg:top-4">
            <ChatPreview
              steps={[
                {
                  type: "text",
                  drive_url: "",
                  texts: [g.decline_message],
                  delay_after_sec: 0,
                },
              ]}
            />
          </div>
        </div>
        <div>
          <h3 className="mb-1 text-sm font-semibold text-neutral-800">
            Secuencia al aceptar el regalo
          </h3>
          <p className="mb-3 text-xs text-neutral-500">
            Agrega y ordena texto, imagen, audio o video. El último paso de
            texto funciona como enlace por defecto; las Variaciones del enlace
            de prioridad pueden reemplazarlo según el anuncio.
          </p>
          <StepEditorPreviewPair
            steps={g.ask_sequence}
            onChange={setGiftSequence}
            onSnapshot={onSnapshot}
            onEdit={onEdit}
            idPrefix="gift_sequence"
          />
        </div>
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <GiftText
            label="Mensaje de recompensa (con el enlace del PDF de regalo)"
            value={g.reward_message}
            onChange={(v) => setGift({ reward_message: v })}
            rows={6}
          />
          <div className="lg:sticky lg:top-4">
            <ChatPreview
              steps={[
                {
                  type: "text",
                  drive_url: "",
                  texts: [g.reward_message],
                  delay_after_sec: 0,
                },
              ]}
            />
          </div>
        </div>
      </section>

      {/* Variaciones de enlace con prioridad */}
      <section className="rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="mb-1 text-base font-bold text-neutral-900">
          Variaciones del enlace (prioridad)
        </h2>
        <p className="mb-3 text-xs text-neutral-500">
          Si pones <strong>IDs de anuncio</strong> en una variación, el bot le
          manda ESE enlace al cliente que vino de ese anuncio (así comenta en el
          post correcto). Si el cliente no coincide con ningún ID, el bot elige
          UNA al azar según su <strong>peso</strong> (a mayor peso, más
          probabilidad; el % es relativo al total). (Las variaciones con
          <code> &lt;&lt;...&gt;&gt; </code> se ignoran hasta que las completes.)
        </p>
        <div className="space-y-3">
          {/* Nombre de la primera campaña (grupo de arriba). Siempre visible. */}
          <div className="flex items-center gap-2 py-1">
            <div className="h-px flex-1 bg-amber-300" />
            <input
              type="text"
              value={g.first_campaign ?? ""}
              onChange={(e) => setGift({ first_campaign: e.target.value })}
              placeholder="Nombre de la campaña"
              className="w-96 max-w-full rounded-md border border-dashed border-amber-400 bg-amber-50 px-2 py-1 text-center text-sm font-semibold text-amber-800"
            />
            <div className="h-px flex-1 bg-amber-300" />
          </div>
          {g.variants.map((v, i) =>
            v.separator !== undefined ? (
              <div key={i} className="flex items-center gap-2 py-1">
                <div className="h-px flex-1 bg-amber-300" />
                <input
                  type="text"
                  value={v.separator}
                  onChange={(e) =>
                    setGift({
                      variants: g.variants.map((x, k) =>
                        k === i ? { ...x, separator: e.target.value } : x
                      ),
                    })
                  }
                  placeholder="Nombre de la campaña"
                  className="w-96 max-w-full rounded-md border border-dashed border-amber-400 bg-amber-50 px-2 py-1 text-center text-sm font-semibold text-amber-800"
                />
                <div className="h-px flex-1 bg-amber-300" />
                <button
                  type="button"
                  onClick={() =>
                    setGift({
                      variants: [
                        ...g.variants.slice(0, i),
                        { weight: 10, text: "", ad_ids: [] },
                        ...g.variants.slice(i),
                      ],
                    })
                  }
                  title="Agregar una variación de enlace ARRIBA de este separador"
                  className="rounded border border-emerald-200 px-2 py-1 text-xs text-emerald-600 hover:bg-emerald-50"
                >
                  ➕ arriba
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!confirm("¿Quitar este separador?")) return;
                    setGift({
                      variants: g.variants.filter((_, k) => k !== i),
                    });
                  }}
                  className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                >
                  🗑️
                </button>
              </div>
            ) : (
            <div
              key={i}
              className={`rounded-lg border border-neutral-300 bg-neutral-100 p-3 ${
                v.enabled === false ? "opacity-60" : ""
              }`}
            >
              <div className="mb-2 flex items-center gap-2">
                <span className="text-xs font-semibold text-neutral-700">
                  Peso:
                </span>
                <input
                  type="number"
                  min={0}
                  value={v.weight}
                  onChange={(e) =>
                    setGift({
                      variants: g.variants.map((x, k) =>
                        k === i
                          ? { ...x, weight: Number(e.target.value) || 0 }
                          : x
                      ),
                    })
                  }
                  className="w-20 rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs"
                />
                <span className="rounded bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                  {Math.round(((v.weight || 0) / total) * 100)}%
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setGift({
                      variants: g.variants.map((x, k) =>
                        k === i ? { ...x, enabled: x.enabled === false } : x
                      ),
                    })
                  }
                  title={
                    v.enabled === false
                      ? "Apagada: el bot no la usa"
                      : "Encendida: el bot la usa"
                  }
                  className={`rounded border px-2 py-1 text-xs font-semibold ${
                    v.enabled === false
                      ? "border-neutral-300 bg-neutral-100 text-neutral-400"
                      : "border-emerald-300 bg-emerald-50 text-emerald-700"
                  }`}
                >
                  {v.enabled === false ? "OFF" : "ON"}
                </button>
                <input
                  type="text"
                  value={v.label ?? ""}
                  onChange={(e) =>
                    setGift({
                      variants: g.variants.map((x, k) =>
                        k === i ? { ...x, label: e.target.value } : x
                      ),
                    })
                  }
                  placeholder="Nombre del ad (ej. Advantage AD1)"
                  className="ml-auto w-48 rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (!confirm("¿Quitar esta variación de enlace?")) return;
                    setGift({
                      variants: g.variants.filter((_, k) => k !== i),
                    });
                  }}
                  className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                >
                  🗑️
                </button>
              </div>
              <div className="mb-2">
                <label className="mb-1 block text-xs font-semibold text-neutral-700">
                  ID de anuncio (normalmente uno)
                </label>
                <input
                  type="text"
                  value={(v.ad_ids ?? []).join(", ")}
                  onChange={(e) =>
                    setGift({
                      variants: g.variants.map((x, k) =>
                        k === i
                          ? {
                              ...x,
                              ad_ids: e.target.value
                                .split(",")
                                .map((s) => s.trim())
                                .filter(Boolean),
                            }
                          : x
                      ),
                    })
                  }
                  placeholder="Ej: 120210000000123456"
                  className="w-full rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs text-neutral-800"
                />
                <p className="mt-1 text-[11px] text-neutral-400">
                  Pon el ID del anuncio que debe usar ESTE enlace. Si varios
                  anuncios apuntan al mismo post, sepáralos con coma. Vacío =
                  esta variación solo participa del azar por peso.
                </p>
              </div>
              <textarea
                value={v.text}
                onChange={(e) =>
                  setGift({
                    variants: g.variants.map((x, k) =>
                      k === i ? { ...x, text: e.target.value } : x
                    ),
                  })
                }
                rows={6}
                placeholder="Texto con el enlace del post a comentar…"
                className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-800"
              />
            </div>
            )
          )}
        </div>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() =>
              setGift({
                variants: [...g.variants, { weight: 10, text: "", ad_ids: [] }],
              })
            }
            className="flex-1 rounded-md border-2 border-dashed border-neutral-300 py-2 text-sm text-neutral-500 hover:border-emerald-400 hover:text-emerald-600"
          >
            ➕ Agregar variación de enlace
          </button>
          <button
            type="button"
            onClick={() =>
              setGift({
                variants: [...g.variants, { weight: 0, text: "", ad_ids: [], separator: "" }],
              })
            }
            className="rounded-md border-2 border-dashed border-amber-300 px-4 py-2 text-sm text-amber-600 hover:border-amber-400 hover:bg-amber-50"
          >
            ➕ Agregar separador
          </button>
        </div>
      </section>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  hint?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-semibold text-neutral-700">
        {label}
      </label>
      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-800"
      />
      {hint && <p className="mt-1 text-[11px] text-neutral-400">{hint}</p>}
    </div>
  );
}

function PricingPaymentRulesSection({
  cfg,
  normalPrice,
  normalPriceLabel,
  normalPriceHint,
  onNormalPriceChange,
  setCfg,
}: {
  cfg: FullConfig;
  normalPrice: number;
  normalPriceLabel: string;
  normalPriceHint: string;
  onNormalPriceChange: (value: number) => void;
  setCfg: (c: FullConfig) => void;
}) {
  const g = cfg.globals;
  const isDobleOfertaDos = activeModality(cfg) === "doble_oferta_dos";

  return (
    <section className="space-y-4 rounded-lg border border-neutral-300 bg-white p-4">
      <div>
        <h2 className="text-base font-bold text-neutral-900">
          Reglas de precio y comprobante (lo que el bot cobra y valida)
        </h2>
        <p className="mt-1 text-xs text-neutral-500">
          Precio normal, precio de oferta y controles para aprobar comprobantes.
          Si un precio aparece sincronizado con una modalidad, se actualiza en
          ambos lados para evitar montos cruzados.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <NumberField
          label={normalPriceLabel}
          value={normalPrice}
          hint={normalPriceHint}
          onChange={onNormalPriceChange}
        />
        <NumberField
          label="Se activa oferta en seguimiento N"
          value={cfg.offer?.sequence_index ?? 0}
          onChange={(v) =>
            setCfg({
              ...cfg,
              offer: {
                sequence_index: v,
                price_soles: cfg.offer?.price_soles ?? g.course_price_soles,
              },
            })
          }
          hint="0 solo guarda el campo; 1 = seguimiento_1, 2 = seguimiento_2, etc."
        />
        <NumberField
          label="Precio de oferta / descuento"
          value={cfg.offer?.price_soles ?? 0}
          hint="Sincronizado con el descuento de Opcion 2 - Basico (Order Bump)."
          onChange={(v) =>
            setCfg({
              ...cfg,
              offer: {
                sequence_index: cfg.offer?.sequence_index ?? 2,
                price_soles: v,
              },
              order_bump: {
                ...cfg.order_bump,
                basico: {
                  ...cfg.order_bump.basico,
                  discount_price_soles: v,
                },
              },
            })
          }
        />
        {isDobleOfertaDos && (
          <div className="flex items-end">
            <button
              type="button"
              onClick={() =>
                setCfg({
                  ...cfg,
                  offer: cfg.offer
                    ? null
                    : { sequence_index: 2, price_soles: g.course_price_soles },
                })
              }
              className={`rounded border px-3 py-2 text-xs font-semibold ${
                cfg.offer
                  ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                  : "border-neutral-300 bg-neutral-100 text-neutral-500"
              }`}
            >
              {cfg.offer ? "Descuento ON" : "Descuento OFF"}
            </button>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
        <h3 className="mb-1 text-sm font-bold text-neutral-900">
          Validacion de comprobante (seguridad antes de aprobar)
        </h3>
        <p className="mb-3 text-xs text-neutral-500">
          Estas reglas ayudan a que una imagen cualquiera no sea tomada como
          pago. El monto esperado sale del precio que el bot ofrecio. El nombre
          receptor se configura arriba, dentro de cada perfil de pais.
        </p>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={cfg.payment_validation.require_receipt_date}
            onChange={(e) =>
              setCfg({
                ...cfg,
                payment_validation: {
                  ...cfg.payment_validation,
                  require_receipt_date: e.target.checked,
                },
              })
            }
            className="h-4 w-4"
          />
          <span className="text-sm font-semibold text-neutral-700">
            Exigir fecha en el comprobante
          </span>
        </label>
      </div>
    </section>
  );
}

function CountryPaymentProfilesEditor({
  cfg,
  selectedCountry,
  onChange,
  onSnapshot,
  onEdit,
}: {
  cfg: FullConfig;
  selectedCountry: CountryCode;
  onChange: (cfg: FullConfig) => void;
  onSnapshot: () => void;
  onEdit: (label?: string) => void;
}) {
  const country =
    COUNTRY_OPTIONS.find((item) => item.code === selectedCountry) ??
    COUNTRY_OPTIONS[0];
  const profiles = cfg.payment_profiles_by_country ?? {};
  const activeGlobalCountry = (cfg.country ?? "PE") as CountryCode;
  const savedProfile = profiles[country.code];
  const profile =
    savedProfile
      ? ({
          ...savedProfile,
          course_price_soles:
            country.code === "PE"
              ? cfg.globals.course_price_soles
              : savedProfile.course_price_soles,
        } satisfies CountryPaymentProfileEditor)
      :
    ({
      enabled: cfg.country_sales_enabled?.[country.code] !== false,
      course_price_soles:
        country.code === activeGlobalCountry ? cfg.globals.course_price_soles : 0,
      payment_text: "",
      payment_buttons:
        country.code === activeGlobalCountry ? cfg.payment_buttons : [],
      payment_validation: {
        yape_recipient_name_starts_with:
          country.code === activeGlobalCountry
            ? cfg.payment_validation.yape_recipient_name_starts_with
            : "",
      },
      payment_responses: {},
    } satisfies CountryPaymentProfileEditor);
  const setProfile = (next: CountryPaymentProfileEditor) => {
    const nextCfg: FullConfig = {
      ...cfg,
      country_sales_enabled: {
        ...(cfg.country_sales_enabled ?? {}),
        [country.code]: next.enabled !== false,
      },
      payment_profiles_by_country: {
        ...(cfg.payment_profiles_by_country ?? {}),
        [country.code]: next,
      },
    };
    onChange(
      country.code === "PE"
        ? {
            ...nextCfg,
            globals: {
              ...nextCfg.globals,
              course_price_soles: next.course_price_soles,
            },
            order_bump: {
              ...nextCfg.order_bump,
              basico: {
                ...nextCfg.order_bump.basico,
                price_soles: next.course_price_soles,
              },
            },
          }
        : nextCfg
    );
  };
  const setMode = (mode: "fixed" | "auto_phone") =>
    onChange({ ...cfg, country_mode: mode });

  return (
    <div className="mt-4 space-y-3 rounded-lg border border-neutral-300 bg-white p-3">
      <div className="grid gap-3 md:grid-cols-[240px_minmax(0,1fr)]">
        <label className="block text-xs font-semibold text-neutral-700">
          Modo de pais
          <select
            className="mt-1 w-full rounded border border-neutral-300 bg-white px-3 py-2 text-sm"
            value={cfg.country_mode ?? "fixed"}
            onChange={(e) =>
              setMode(e.target.value === "auto_phone" ? "auto_phone" : "fixed")
            }
          >
            <option value="fixed">Pais fijo (actual)</option>
            <option value="auto_phone">Multipais por telefono</option>
          </select>
        </label>
        <div className="rounded border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-600">
          En multipais, el bot detecta +51, +593, +57, +52, etc. y usa el
          perfil de precio/metodos de ese pais. Pais fijo conserva el
          comportamiento actual.
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-bold text-neutral-900">
            Perfil de pago: {country.label}
          </div>
          <div className="text-xs text-neutral-500">
            {country.currency} ({country.symbol})
          </div>
        </div>
        <label className="inline-flex items-center gap-2 rounded-full border border-neutral-300 px-3 py-1.5 text-xs font-semibold">
          <input
            type="checkbox"
            checked={profile.enabled !== false}
            onChange={(e) => setProfile({ ...profile, enabled: e.target.checked })}
            className="h-4 w-4 accent-emerald-700"
          />
          Vender en este pais
        </label>
      </div>

      <div className="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)]">
        <NumberField
          label={`Precio (${country.currency})`}
          value={profile.course_price_soles}
          onChange={(v) => setProfile({ ...profile, course_price_soles: v })}
        />
        <label className="block text-xs font-semibold text-neutral-700">
          Nombre receptor para validar Yape/Plin
          <input
            value={
              profile.payment_validation?.yape_recipient_name_starts_with ?? ""
            }
            onChange={(e) =>
              setProfile({
                ...profile,
                payment_validation: {
                  ...(profile.payment_validation ?? {}),
                  yape_recipient_name_starts_with: e.target.value,
                },
              })
            }
            className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
            placeholder="Ej: Alberto"
          />
          <span className="mt-1 block text-[11px] font-normal text-neutral-500">
            Si lo llenas, el comprobante de este pais debe mostrar un receptor
            que empiece con ese nombre. Si queda vacio, no se valida por nombre.
          </span>
        </label>
      </div>

      <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
        Los textos, botones, aliases y datos de pago de {country.label} se editan
        abajo, en el bloque "Mostrar los metodos de pago con botones". Ese bloque
        cambia automaticamente segun el pais elegido aqui.
      </div>
    </div>
  );
}

const SALESBOT_MODE_LABELS: Record<SalesbotEngineMode, string> = {
  ai: "IA actual",
  salesbot_strong: "Salesbot fuerte",
  salesbot_only: "Salesbot solo",
};

const SALESBOT_ACTION_LABELS: Record<SalesbotRuleAction, string> = {
  send_text: "Enviar texto",
  send_steps: "Enviar burbujas",
  show_order_bump: "Mostrar oferta Order Bump",
  choose_combo: "Elegir combo",
  choose_basico: "Elegir basico",
  resend_payment: "Reenviar pago elegido",
  send_payment_menu: "Mostrar metodos de pago",
  resend_material: "Reenviar material",
  accept_gift: "Aceptar regalo",
  decline_gift: "Rechazar regalo",
  claim_gift: "Entregar regalo",
  human: "Pasar a humano",
  fallback_ai: "Usar IA",
};

function csvToList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function SalesbotRulesSection({
  cfg,
  setCfg,
  onSnapshot,
  onEdit,
}: {
  cfg: FullConfig;
  setCfg: (c: FullConfig) => void;
  onSnapshot: () => void;
  onEdit: (key: string) => void;
}) {
  const modality = activeModality(cfg);
  const salesbot = normalizeSalesbotConfig(cfg.salesbot);
  const rules = salesbot.rules[modality] ?? [];
  const mode = salesbot.modes[modality] ?? "ai";
  const setSalesbot = (next: SalesbotConfigEditor) =>
    setCfg({ ...cfg, salesbot: next });
  const updateRule = (index: number, patch: Partial<SalesbotRuleEditor>) => {
    const nextRules = rules.map((rule, i) =>
      i === index ? { ...rule, ...patch } : rule
    );
    setSalesbot({
      ...salesbot,
      rules: { ...salesbot.rules, [modality]: nextRules },
    });
  };
  const removeRule = (index: number) => {
    setSalesbot({
      ...salesbot,
      rules: { ...salesbot.rules, [modality]: rules.filter((_, i) => i !== index) },
    });
  };
  const addRule = () => {
    setSalesbot({
      ...salesbot,
      rules: { ...salesbot.rules, [modality]: [...rules, emptySalesbotRule()] },
    });
  };

  return (
    <section className="rounded-lg border border-sky-300 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-neutral-900">
            Motor tipo Salesbot
          </h2>
          <p className="mt-1 text-xs text-neutral-500">
            Se configura por modalidad. Si queda en IA actual, el bot no cambia.
          </p>
        </div>
        <span className="rounded border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-800">
          {MODALIDAD_LABEL[modality]}
        </span>
      </div>

      <div className="grid gap-3 md:grid-cols-[220px_1fr]">
        <label className="block text-sm font-semibold text-neutral-700">
          Modo de esta modalidad
          <select
            value={mode}
            onChange={(e) =>
              setSalesbot({
                ...salesbot,
                modes: {
                  ...salesbot.modes,
                  [modality]: e.target.value as SalesbotEngineMode,
                },
              })
            }
            className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm"
          >
            {(["ai", "salesbot_strong", "salesbot_only"] as const).map((value) => (
              <option key={value} value={value}>
                {SALESBOT_MODE_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-semibold text-neutral-700">
          Respuesta si Salesbot solo no encuentra regla
          <input
            value={salesbot.fallback_text}
            onChange={(e) =>
              setSalesbot({ ...salesbot, fallback_text: e.target.value })
            }
            className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm"
          />
        </label>
      </div>

      <div className="mt-4 space-y-3">
        {rules.length === 0 ? (
          <div className="rounded border border-dashed border-neutral-300 bg-neutral-50 px-3 py-4 text-sm text-neutral-500">
            No hay reglas para esta modalidad.
          </div>
        ) : (
          rules
            .map((rule, index) => ({ rule, index }))
            .sort((a, b) => (a.rule.priority ?? 100) - (b.rule.priority ?? 100))
            .map(({ rule, index }) => (
              <div
                key={rule.id || index}
                className={`rounded-md border p-3 ${
                  rule.enabled === false
                    ? "border-neutral-200 bg-neutral-100 opacity-70"
                    : "border-neutral-300 bg-neutral-50"
                }`}
              >
                <div className="grid gap-2 md:grid-cols-[1fr_90px_120px_130px_120px]">
                  <label className="text-xs font-semibold text-neutral-700">
                    Nombre
                    <input
                      value={rule.name}
                      onChange={(e) => updateRule(index, { name: e.target.value })}
                      className="mt-1 w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm"
                    />
                  </label>
                  <NumberField
                    label="Prioridad"
                    value={rule.priority}
                    onChange={(v) => updateRule(index, { priority: v })}
                  />
                  <label className="text-xs font-semibold text-neutral-700">
                    Canal
                    <select
                      value={rule.channel}
                      onChange={(e) =>
                        updateRule(index, { channel: e.target.value as SalesbotChannel })
                      }
                      className="mt-1 w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm"
                    >
                      {(["all", "whatsapp", "messenger", "instagram", "tiktok"] as const).map(
                        (value) => (
                          <option key={value} value={value}>
                            {value === "all" ? "Todos" : value}
                          </option>
                        )
                      )}
                    </select>
                  </label>
                  <label className="text-xs font-semibold text-neutral-700">
                    Coincidencia
                    <select
                      value={rule.match}
                      onChange={(e) =>
                        updateRule(index, { match: e.target.value as SalesbotRuleMatch })
                      }
                      className="mt-1 w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm"
                    >
                      <option value="contains_any">Cualquiera</option>
                      <option value="contains_all">Todas</option>
                      <option value="regex">Regex</option>
                    </select>
                  </label>
                  <label className="flex items-center justify-end gap-2 pt-5 text-xs font-semibold text-neutral-700">
                    <input
                      type="checkbox"
                      checked={rule.enabled !== false}
                      onChange={(e) =>
                        updateRule(index, { enabled: e.target.checked })
                      }
                      className="h-4 w-4"
                    />
                    ON
                  </label>
                </div>

                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <label className="block text-xs font-semibold text-neutral-700">
                    Palabras o frases que activan (coma)
                    <textarea
                      rows={2}
                      value={(rule.keywords ?? []).join(", ")}
                      onChange={(e) =>
                        updateRule(index, { keywords: csvToList(e.target.value) })
                      }
                      placeholder="comentado, no veo mi enlace, reenviar material"
                      className="mt-1 w-full rounded border border-neutral-300 bg-white px-2 py-2 text-sm"
                    />
                  </label>
                  <label className="block text-xs font-semibold text-neutral-700">
                    Estados donde aplica (coma, opcional)
                    <textarea
                      rows={2}
                      value={(rule.states ?? []).join(", ")}
                      onChange={(e) =>
                        updateRule(index, { states: csvToList(e.target.value) })
                      }
                      placeholder="awaiting_email, payment_approved"
                      className="mt-1 w-full rounded border border-neutral-300 bg-white px-2 py-2 text-sm"
                    />
                  </label>
                </div>

                <div className="mt-3 grid gap-3 md:grid-cols-[180px_1fr_180px]">
                  <label className="block text-xs font-semibold text-neutral-700">
                    Accion
                    <select
                      value={rule.action}
                      onChange={(e) =>
                        updateRule(index, { action: e.target.value as SalesbotRuleAction })
                      }
                      className="mt-1 w-full rounded border border-neutral-300 bg-white px-2 py-2 text-sm"
                    >
                      {Object.entries(SALESBOT_ACTION_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-xs font-semibold text-neutral-700">
                    Respuesta editable
                    <textarea
                      rows={3}
                      value={rule.response}
                      onChange={(e) => updateRule(index, { response: e.target.value })}
                      placeholder="Texto que enviara esta regla. Puedes usar comodines."
                      className="mt-1 w-full rounded border border-neutral-300 bg-white px-2 py-2 text-sm"
                    />
                  </label>
                  <label className="block text-xs font-semibold text-neutral-700">
                    Cambiar estado a
                    <input
                      value={rule.next_state}
                      onChange={(e) =>
                        updateRule(index, { next_state: e.target.value })
                      }
                      placeholder="Opcional"
                      className="mt-1 w-full rounded border border-neutral-300 bg-white px-2 py-2 text-sm"
                    />
                  </label>
                </div>

                <div className="mt-3 rounded-md border border-sky-200 bg-white p-3">
                  <div className="mb-2">
                    <h3 className="text-sm font-bold text-neutral-900">
                      Burbujas internas
                    </h3>
                    <p className="text-[11px] text-neutral-500">
                      Para ahorro fuerte usa la accion "Enviar burbujas": el bot manda estas burbujas sin IA.
                    </p>
                  </div>
                  <StepEditorPreviewPair
                    steps={rule.steps?.length ? rule.steps : [emptyStep()]}
                    onChange={(steps) => updateRule(index, { steps })}
                    onSnapshot={onSnapshot}
                    onEdit={(key) => onEdit(`salesbot:${rule.id || index}:${key}`)}
                    idPrefix={`salesbot_${rule.id || index}`}
                    priceSoles={cfg.globals.course_price_soles}
                    comboPrice={previewComboPriceFromConfig(cfg)}
                    basicoPrice={previewBasicoPriceFromConfig(cfg)}
                    previewContext={previewContextFromConfig(cfg)}
                  />
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <label className="flex items-center gap-2 text-xs font-semibold text-neutral-700">
                    <input
                      type="checkbox"
                      checked={rule.stop_after_action !== false}
                      onChange={(e) =>
                        updateRule(index, {
                          stop_after_action: e.target.checked,
                        })
                      }
                      className="h-4 w-4"
                    />
                    Cortar aqui despues de la accion
                  </label>
                  <button
                    type="button"
                    onClick={() => removeRule(index)}
                    className="rounded border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50"
                  >
                    Eliminar regla
                  </button>
                </div>

                {rule.match === "regex" && (
                  <label className="mt-3 block text-xs font-semibold text-neutral-700">
                    Patron regex
                    <input
                      value={rule.pattern}
                      onChange={(e) =>
                        updateRule(index, { pattern: e.target.value })
                      }
                      className="mt-1 w-full rounded border border-neutral-300 bg-white px-2 py-2 font-mono text-xs"
                    />
                  </label>
                )}
              </div>
            ))
        )}
      </div>

      <button
        type="button"
        onClick={addRule}
        className="mt-3 rounded-md border-2 border-dashed border-sky-300 px-4 py-2 text-sm font-semibold text-sky-700 hover:bg-sky-50"
      >
        + Agregar regla
      </button>
    </section>
  );
}

function AjustesTab({
  cfg,
  setCfg,
}: {
  cfg: FullConfig;
  setCfg: (c: FullConfig) => void;
}) {
  const s = cfg.schedule;
  const g = cfg.globals;
  const [copiedPlaceholder, setCopiedPlaceholder] = useState<string | null>(null);
  const customPlaceholders = cfg.custom_placeholders ?? [];
  const copyPlaceholder = async (token: string) => {
    try {
      await navigator.clipboard.writeText(token);
      setCopiedPlaceholder(token);
      window.setTimeout(() => setCopiedPlaceholder(null), 1200);
    } catch {
      setCopiedPlaceholder(null);
    }
  };
  const updateCustomPlaceholder = (
    index: number,
    patch: Partial<CustomPlaceholder>
  ) => {
    setCfg({
      ...cfg,
      custom_placeholders: customPlaceholders.map((item, i) =>
        i === index ? { ...item, ...patch } : item
      ),
    });
  };
  const addCustomPlaceholder = () => {
    setCfg({
      ...cfg,
      custom_placeholders: [
        ...customPlaceholders,
        { key: "", value: "", description: "" },
      ],
    });
  };
  const addSuggestedPlaceholder = (placeholder: CustomPlaceholder) => {
    const key = normalizePlaceholderKey(placeholder.key);
    if (!key) return;
    if (
      customPlaceholders.some(
        (item) => normalizePlaceholderKey(item.key ?? "") === key
      )
    ) {
      return;
    }
    setCfg({
      ...cfg,
      custom_placeholders: [
        ...customPlaceholders,
        { ...placeholder, key },
      ],
    });
  };
  const removeCustomPlaceholder = (index: number) => {
    setCfg({
      ...cfg,
      custom_placeholders: customPlaceholders.filter((_, i) => i !== index),
    });
  };
  return (
    <div className="space-y-8">
      {/* Horarios y ráfagas */}
      <section className="rounded-lg border border-neutral-300 bg-white p-4">
        <h2 className="mb-3 text-base font-bold text-neutral-900">
          Horarios, ráfagas y silencios (seguimientos 2 y 3)
        </h2>
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-semibold text-neutral-700">
              Horarios permitidos (hora Perú, separados por coma)
            </label>
            <input
              type="text"
              value={s.slots_peru.join(", ")}
              onChange={(e) =>
                setCfg({
                  ...cfg,
                  schedule: {
                    ...s,
                    slots_peru: e.target.value
                      .split(",")
                      .map((x) => x.trim())
                      .filter(Boolean),
                  },
                })
              }
              placeholder="12:00, 18:00, 22:00"
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
            />
          </div>
          <NumberField
            label="Horas mínimas entre seguimientos"
            value={s.min_gap_hours_between}
            onChange={(v) =>
              setCfg({ ...cfg, schedule: { ...s, min_gap_hours_between: v } })
            }
          />
          <div>
            <label className="mb-1 block text-sm font-semibold text-neutral-700">
              Ráfaga: delays escalonados en segundos (separados por coma)
            </label>
            <input
              type="text"
              value={s.burst_delays_seconds.join(", ")}
              onChange={(e) =>
                setCfg({
                  ...cfg,
                  schedule: {
                    ...s,
                    burst_delays_seconds: e.target.value
                      .split(",")
                      .map((x) => Number(x.trim()))
                      .filter((n) => Number.isFinite(n)),
                  },
                })
              }
              placeholder="15, 21, 27, 32"
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <TimeField
              label="Silencio: inicio"
              value={s.quiet_hours.start}
              onChange={(v) =>
                setCfg({
                  ...cfg,
                  schedule: { ...s, quiet_hours: { ...s.quiet_hours, start: v } },
                })
              }
            />
            <TimeField
              label="Silencio: fin"
              value={s.quiet_hours.end}
              onChange={(v) =>
                setCfg({
                  ...cfg,
                  schedule: { ...s, quiet_hours: { ...s.quiet_hours, end: v } },
                })
              }
            />
            <TimeField
              label="Reanudar a las"
              value={s.quiet_hours.resume_at}
              onChange={(v) =>
                setCfg({
                  ...cfg,
                  schedule: {
                    ...s,
                    quiet_hours: { ...s.quiet_hours, resume_at: v },
                  },
                })
              }
            />
          </div>
          <label className="mt-3 flex items-center gap-3 border-t border-neutral-200 pt-3">
            <input
              type="checkbox"
              checked={s.quiet_hours_enabled !== false}
              onChange={(e) =>
                setCfg({
                  ...cfg,
                  schedule: {
                    ...s,
                    quiet_hours_enabled: e.target.checked,
                  },
                })
              }
              className="h-5 w-5"
            />
            <span className="text-sm font-medium text-neutral-900">
              Respetar horario de silencio en seguimientos
            </span>
          </label>
          <label className="mt-3 flex items-center gap-3 border-t border-neutral-200 pt-3">
            <input
              type="checkbox"
              checked={s.followup_1_ignore_quiet_hours === true}
              onChange={(e) =>
                setCfg({
                  ...cfg,
                  schedule: {
                    ...s,
                    followup_1_ignore_quiet_hours: e.target.checked,
                  },
                })
              }
              className="h-5 w-5"
            />
            <span className="text-sm font-medium text-neutral-900">
              Enviar el seguimiento 1 aunque sea horario de silencio (no esperar a
              las 7am)
            </span>
          </label>
        </div>
      </section>

      <section className="rounded-lg border border-neutral-300 bg-white p-4">
        <h2 className="mb-2 text-base font-bold text-neutral-900">
          Variantes del intro
        </h2>
        <p className="mb-3 text-xs text-neutral-500">
          Controla si los textos alternativos del intro se reparten de forma
          ordenada entre conversaciones o si vuelven al sorteo anterior.
        </p>
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={cfg.intro_variant_rotation_enabled !== false}
            onChange={(e) =>
              setCfg({
                ...cfg,
                intro_variant_rotation_enabled: e.target.checked,
              })
            }
            className="h-5 w-5"
          />
          <span className="text-sm font-semibold text-neutral-700">
            Repartir variantes del intro de forma ordenada
          </span>
        </label>
        <p className="mt-2 text-xs text-neutral-500">
          Apagado = vuelve al sorteo anterior.
        </p>
      </section>

      <section className="rounded-lg border border-neutral-300 bg-white p-4">
        <h2 className="mb-2 text-base font-bold text-neutral-900">
          Muestras progresivas
        </h2>
        <p className="mb-3 text-xs text-neutral-500">
          Dosifica las imÃ¡genes de <strong>Info de contenido</strong> para no
          saturar al cliente. Apagado = comportamiento actual.
        </p>
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={cfg.progressive_samples_enabled === true}
            onChange={(e) =>
              setCfg({
                ...cfg,
                progressive_samples_enabled: e.target.checked,
              })
            }
            className="h-5 w-5"
          />
          <span className="text-sm font-semibold text-neutral-700">
            Activar muestras progresivas
          </span>
        </label>
        <div className="mt-3 grid gap-3 lg:grid-cols-[180px_minmax(0,1fr)]">
          <NumberField
            label="MÃ¡ximo por tanda"
            value={cfg.progressive_samples_max_per_batch ?? 2}
            onChange={(v) =>
              setCfg({
                ...cfg,
                progressive_samples_max_per_batch: Math.max(1, Math.floor(v)),
              })
            }
          />
          <label className="block text-sm font-semibold text-neutral-700">
            Texto para ofrecer mÃ¡s
            <textarea
              rows={3}
              value={
                cfg.progressive_samples_more_text ??
                "Te muestro algunas para no saturarte 😊 ¿Quieres ver más?"
              }
              onChange={(e) =>
                setCfg({
                  ...cfg,
                  progressive_samples_more_text: e.target.value,
                })
              }
              className="mt-1 block w-full rounded border border-neutral-300 px-3 py-2 text-sm"
            />
            <span className="mt-1 block text-xs font-normal text-neutral-500">
              Se usa despuÃ©s de enviar una tanda cuando aÃºn quedan muestras
              pendientes.
            </span>
          </label>
        </div>
      </section>

      <section className="rounded-lg border border-amber-200 bg-amber-50 p-4">
        <h2 className="mb-2 text-base font-bold text-amber-950">
          Spintax: variación sin IA
        </h2>
        <p className="mb-3 text-sm text-amber-950">
          Escribe varias opciones dentro del mismo texto. El bot elige una al
          enviar y la miniatura cambia con el botón <strong>Variar</strong>.
        </p>
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="rounded border border-amber-200 bg-white p-3">
            <p className="mb-1 text-xs font-bold text-neutral-700">
              Ejemplo seguro
            </p>
            <code className="block whitespace-pre-wrap rounded bg-neutral-100 p-2 text-xs text-neutral-800">
              {"{Hola|Buenas|Qué tal} {{NOMBRE}} 😊\n{Te paso|Te comparto|Aquí tienes} la información de {{PRODUCTO}}."}
            </code>
          </div>
          <div className="rounded border border-amber-200 bg-white p-3 text-xs text-neutral-700">
            <p className="mb-1 font-bold">Usa spintax en:</p>
            <p>saludos, transiciones, cierres y frases suaves.</p>
            <p className="mb-1 mt-3 font-bold">Evítalo en:</p>
            <p>precios, links, datos de pago, comprobantes y entregas.</p>
            <p className="mt-3">
              Los comodines como <code>{"{{PRODUCTO}}"}</code> y{" "}
              <code>{"{precio}"}</code> no se rompen porque no usan{" "}
              <code>|</code>.
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-neutral-300 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-neutral-900">
              Comodines
            </h2>
            <p className="mt-1 text-xs text-neutral-500">
              Estos son los comodines disponibles. Luego escribe{" "}
              <code>{"{{"}</code> en una burbuja y elige uno de la lista.
            </p>
          </div>
          <button
            type="button"
            onClick={addCustomPlaceholder}
            className="rounded-md bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
          >
            + Agregar comodín
          </button>
        </div>
        <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 p-3">
          <h3 className="mb-2 text-sm font-bold text-emerald-950">
            Comodines ya creados por el sistema
          </h3>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {BASE_PLACEHOLDER_OPTIONS.map((option) => (
              <div
                key={option.token}
                className="rounded border border-emerald-100 bg-white px-3 py-2"
              >
                <button
                  type="button"
                  onClick={() => copyPlaceholder(option.token)}
                  title="Copiar comodín"
                  className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 font-mono text-xs font-bold text-emerald-700 hover:bg-emerald-100"
                >
                  {option.token}
                </button>
                {copiedPlaceholder === option.token && (
                  <span className="ml-2 text-[11px] font-semibold text-emerald-700">
                    Copiado
                  </span>
                )}
                <p className="mt-1 text-xs font-semibold text-neutral-800">
                  {option.label}
                </p>
                {option.description && (
                  <p className="mt-1 text-[11px] text-neutral-500">
                    {option.description}
                  </p>
                )}
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-emerald-900">
            Estos comodines no se eliminan desde aquí porque forman parte del
            motor del bot.
          </p>
        </div>
        <div className="mb-4 rounded-md border border-sky-200 bg-sky-50 p-3">
          <h3 className="mb-2 text-sm font-bold text-sky-950">
            Crear comodines rápidos para futuros productos
          </h3>
          <p className="mb-3 text-xs text-sky-900">
            Son opcionales. Al crearlos aparecen abajo para que llenes su valor y
            luego puedas usarlos como cualquier comodín.
          </p>
          <div className="flex flex-wrap gap-2">
            {SUGGESTED_CUSTOM_PLACEHOLDERS.map((placeholder) => {
              const key = normalizePlaceholderKey(placeholder.key);
              const exists = customPlaceholders.some(
                (item) => normalizePlaceholderKey(item.key ?? "") === key
              );
              return (
                <button
                  key={key}
                  type="button"
                  disabled={exists}
                  onClick={() => addSuggestedPlaceholder(placeholder)}
                  className={`rounded border px-2.5 py-1.5 text-xs font-semibold ${
                    exists
                      ? "cursor-not-allowed border-sky-100 bg-white/60 text-sky-300"
                      : "border-sky-200 bg-white text-sky-700 hover:bg-sky-100"
                  }`}
                >
                  {exists ? "Creado " : "+ "}
                  <code>{`{{${key}}}`}</code>
                </button>
              );
            })}
          </div>
        </div>
        <h3 className="mb-2 text-sm font-bold text-neutral-900">
          Mis comodines personalizados
        </h3>
        {customPlaceholders.length === 0 ? (
          <div className="rounded border border-dashed border-neutral-300 bg-neutral-50 px-3 py-4 text-sm text-neutral-500">
            Aún no hay comodines propios. Ejemplo: nombre <strong>BONO</strong> y
            valor <strong>Video extra de armado</strong>. Se usará como{" "}
            <code>{"{{BONO}}"}</code>.
          </div>
        ) : (
          <div className="space-y-3">
            {customPlaceholders.map((item, index) => {
              const normalized = normalizePlaceholderKey(item.key ?? "");
              return (
                <div
                  key={index}
                  className="rounded-md border border-neutral-200 bg-neutral-50 p-3"
                >
                  <div className="grid gap-3 lg:grid-cols-[180px_minmax(0,1fr)_160px_auto]">
                    <label className="block text-xs font-semibold text-neutral-700">
                      Nombre
                      <input
                        value={item.key ?? ""}
                        onChange={(e) =>
                          updateCustomPlaceholder(index, { key: e.target.value })
                        }
                        onBlur={() =>
                          updateCustomPlaceholder(index, { key: normalized })
                        }
                        placeholder="BONO"
                        className="mt-1 w-full rounded border border-neutral-300 bg-white px-2 py-2 text-sm"
                      />
                    </label>
                    <label className="block text-xs font-semibold text-neutral-700">
                      Valor que reemplaza
                      <textarea
                        rows={2}
                        value={item.value ?? ""}
                        onChange={(e) =>
                          updateCustomPlaceholder(index, {
                            value: e.target.value,
                          })
                        }
                        placeholder="Texto que debe aparecer cuando uses el comodín"
                        className="mt-1 w-full rounded border border-neutral-300 bg-white px-2 py-2 text-sm"
                      />
                    </label>
                    <label className="block text-xs font-semibold text-neutral-700">
                      Nota interna
                      <input
                        value={item.description ?? ""}
                        onChange={(e) =>
                          updateCustomPlaceholder(index, {
                            description: e.target.value,
                          })
                        }
                        placeholder="Opcional"
                        className="mt-1 w-full rounded border border-neutral-300 bg-white px-2 py-2 text-sm"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => removeCustomPlaceholder(index)}
                      className="self-end rounded border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50"
                    >
                      Eliminar
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-neutral-500">
                    Se insertará como{" "}
                    <button
                      type="button"
                      disabled={!normalized}
                      onClick={() => copyPlaceholder(`{{${normalized}}}`)}
                      title="Copiar comodín"
                      className="rounded border border-neutral-200 bg-white px-2 py-1 font-mono text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:text-neutral-300"
                    >
                      {normalized ? `{{${normalized}}}` : "{{NOMBRE}}"}
                    </button>
                    {normalized && copiedPlaceholder === `{{${normalized}}}` && (
                      <span className="ml-2 text-[11px] font-semibold text-emerald-700">
                        Copiado
                      </span>
                    )}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-neutral-300 bg-white p-4">
        <h2 className="mb-2 text-base font-bold text-neutral-900">
          Order Bump: presentacion de opciones
        </h2>
        <p className="mb-3 text-xs text-neutral-500">
          Regla editable para que el combo suene mas completo, pero la segunda
          opcion no quede minimizada.
        </p>
        <textarea
          rows={6}
          value={cfg.order_bump_option_presentation_rule ?? ""}
          onChange={(e) =>
            setCfg({
              ...cfg,
              order_bump_option_presentation_rule: e.target.value,
            })
          }
          placeholder="Presenta el combo primero porque es la opcion mas completa, pero presenta la segunda opcion como una alternativa valiosa por si misma..."
          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
        />
        <p className="mt-2 text-xs text-neutral-500">
          Si lo dejas vacio, el bot usa la regla por defecto del sistema.
        </p>
      </section>

      {/* Globales */}
      <section className="rounded-lg border border-neutral-300 bg-white p-4">
        <h2 className="mb-3 text-base font-bold text-neutral-900">
          Tiempos generales (delays y limpieza)
        </h2>
        <div className="grid grid-cols-2 gap-4">
          <NumberField
            label="Delay entre mensajes (seg)"
            value={g.between_messages_delay_seconds}
            onChange={(v) =>
              setCfg({
                ...cfg,
                globals: { ...g, between_messages_delay_seconds: v },
              })
            }
          />
          <NumberField
            label="Delay antes de responder (seg)"
            value={g.bot_response_delay_seconds}
            onChange={(v) =>
              setCfg({
                ...cfg,
                globals: { ...g, bot_response_delay_seconds: v },
              })
            }
          />
          <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
            <label className="inline-flex items-center gap-2 text-sm font-semibold text-neutral-700">
              <input
                type="checkbox"
                checked={g.llm_bubble_limit_enabled === true}
                onChange={(e) =>
                  setCfg({
                    ...cfg,
                    globals: {
                      ...g,
                      llm_bubble_limit_enabled: e.target.checked,
                    },
                  })
                }
                className="h-4 w-4 accent-emerald-700"
              />
              Limitar burbujas del LLM
            </label>
            <p className="mt-1 text-[11px] leading-4 text-neutral-500">
              Compacta respuestas libres del bot sin cortar el texto a medias.
            </p>
          </div>
          <NumberField
            label="Máximo de burbujas del LLM"
            value={g.llm_max_bubbles}
            onChange={(v) =>
              setCfg({
                ...cfg,
                globals: { ...g, llm_max_bubbles: Math.max(1, v) },
              })
            }
            hint="Ejemplo: 2 o 3. Solo aplica si el toggle está activo."
          />
          <NumberField
            label="Espera del correo / regalo (seg)"
            value={g.awaiting_email_timeout_seconds}
            onChange={(v) =>
              setCfg({
                ...cfg,
                globals: { ...g, awaiting_email_timeout_seconds: v },
              })
            }
          />
          <NumberField
            label="Auto-HUMANO tras regalo de esta modalidad (min)"
            value={g.post_gift_comment_auto_human_delay_minutes}
            onChange={(v) =>
              setCfg({
                ...cfg,
                globals: {
                  ...g,
                  post_gift_comment_auto_human_delay_minutes: v,
                },
              })
            }
          />
          <NumberField
            label="Fallback intro si no responde (seg)"
            value={g.no_response_delay_seconds}
            onChange={(v) =>
              setCfg({
                ...cfg,
                globals: { ...g, no_response_delay_seconds: v },
              })
            }
          />
          <NumberField
            label="Autopurga de inactivos (días, 0 = off)"
            value={g.autopurge_inactive_days}
            onChange={(v) =>
              setCfg({
                ...cfg,
                globals: { ...g, autopurge_inactive_days: v },
              })
            }
          />
        </div>
      </section>
    </div>
  );
}

function TimeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-semibold text-neutral-700">
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="HH:MM"
        className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
      />
    </div>
  );
}
