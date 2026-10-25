import fs from "node:fs";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { parse as parseYaml } from "yaml";
import {
  countryFromPhone,
  formatCurrencyAmount,
  resolveCountry,
  type CountryCode,
} from "@/lib/countries";
import {
  getConversationByPhone,
  getFrozenPrices,
  getPuestoEnLaFila,
  getUpsellFrozenPrices,
  leerCompradosDeLaFila,
  moverLaFila,
  setFrozenPrices,
  type FrozenPriceMap,
  type PuestoEnLaFila,
} from "@/lib/db";
import { literal } from "@/lib/texto-literal";
// LA MISMA PREGUNTA QUE HACE EL PANEL, NO UNA COPIA.
//
// `revisarPais` ya sabe reconocer un texto de muestra y por eso te avisa de que
// al país le falta configurarse. El motor lo ignoraba y mandaba la muestra al
// cliente. Se reutiliza esa función —es pura, sin React ni base de datos— para
// que las dos no puedan decir cosas distintas.
import { esTextoDeReferencia } from "@/lib/editor/revisar-pais";
// Con `@/` como todo lo demás de este archivo: las pruebas resuelven `@/` a mano
// y un import relativo sin extensión deja la batería entera sin poder cargarlo.
import {
  tiendasDe,
  soloDeSuTienda,
  leQuedaAlgo,
  frasesDeEntrada,
  paraCompararFrase,
  usaRespaldoEntreTiendas,
  aLaTiendaLeFaltaLoSuyo,
} from "@/lib/workflow/etiqueta-de-tienda";
// EL RESPALDO ENTRE TIENDAS, CON SU INTERRUPTOR (17/10/2026). Se reexporta para el motor.
export { usaRespaldoEntreTiendas, aLaTiendaLeFaltaLoSuyo };
import {
  laSemimodalidadDeLaTienda,
  porSemimodalidad,
  semimodalidadDe,
  type Semimodalidad,
} from "@/lib/workflow/etiqueta-de-semimodalidad";
// LOS CAMINOS (18/10/2026). Ver `etiqueta-de-camino.ts`.
import { caminoDe, caminosDe, porCamino } from "@/lib/workflow/etiqueta-de-camino";
// EL RESPALDO ENTRE PAÍSES, CON SU INTERRUPTOR (16/10/2026). Se reexporta para que el motor lo
// lea de aquí, como las otras etiquetas.
import { usaRespaldoEntrePaises } from "@/lib/workflow/etiqueta-de-bandera";
export { usaRespaldoEntrePaises };

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
/**
 * LO QUE PUEDE HACER UN BOTÓN DE BURBUJA.
 *
 * ES LA MISMA LISTA QUE LA DE LOS CUADRITOS, Y NO POR CASUALIDAD: las dos
 * acciones las ejecuta `ejecutarAccion`, una sola función compartida. Su propio
 * comentario lo explica: «teniendo cada uno su copia, Elegir Básico acabaría
 * haciendo una cosa desde el botón y otra desde el cuadrito».
 *
 * AQUÍ FALTABAN CINCO, y el motor ya sabía hacerlas. El dueño lo encontró el 15
 * de septiembre de 2026 buscando el segundo producto en el selector del botón:
 * el cuadrito lo ofrecía y el botón no, aunque `ejecutarAccion` tiene su `case`
 * desde siempre. No era una limitación: era una lista corta.
 */
export type BubbleButtonAction =
  | "send_steps"
  | "send_payment_method"
  | "show_payment"
  | "choose_combo"
  | "choose_basico"
  /** El SEGUNDO producto, el de después de la venta. Ver `DecisionAction`. */
  | "choose_upsell"
  /** El «No» al segundo producto: lo mismo que el botón nativo, sigue con el regalo. */
  | "decline_upsell"
  /** Abre la oferta de dos opciones, para armar el recorrido a mano. */
  | "show_order_bump"
  /** El regalo: aceptarlo, rechazarlo, entregarlo. */
  | "accept_gift"
  | "decline_gift"
  | "claim_gift"
  | "human"
  /** ARRANCA UN WORKFLOW del tablero (22/10/2026, ALBERTO 4). Ver `workflow_id`. */
  | "start_workflow";

export interface BubbleButton {
  /** Id interno estable: el cliente nunca lo ve. */
  id: string;
  /** Texto visible en WhatsApp/Messenger. */
  label: string;
  action: BubbleButtonAction;
  /** Secuencia que se envía para la acción "send_steps". */
  steps?: ResponseStep[];
  /**
   * Para "send_payment_method": QUÉ método manda este botón (yape, plin,
   * bcp_transferencia…).
   *
   * Se guarda el nombre del método, NO una copia de sus datos. Los datos viven
   * en Precios y pagos, por país, y de ahí salen al enviarse.
   *
   * Copiarlos aquí sería tener el número de cuenta en dos sitios: el día que
   * cambie, uno de los dos se queda viejo y el cliente paga a la cuenta que no
   * era. Eso no da error y no avisa a nadie.
   */
  payment_method?: string;
  /** Para "start_workflow": QUÉ workflow arranca (su id en `workflows`). */
  workflow_id?: string;
}

/**
 * UNA DECISIÓN: una respuesta posible a la pregunta de su burbuja.
 *
 * No es un botón. El cliente no ve nada de esto: recibe la pregunta como texto
 * y CONTESTA ESCRIBIENDO. El bot compara lo que escribió con las palabras clave
 * de cada decisión, y manda las burbujas de la que acierte.
 *
 * Por eso no hay tope de tres —ese límite es de los botones de WhatsApp— y por
 * eso el título no interviene en el reconocimiento: es la etiqueta para saber
 * cuál es cuál al editar. Lo que activa son las palabras, así se puede llamar
 * "SI" al cuadrito y aceptar "claro que sí" sin que el nombre ate nada.
 */
export interface BubbleDecision {
  /** Id interno estable: el cliente nunca lo ve. */
  id: string;
  /**
   * false = apagada: ni reconoce ni cuenta.
   *
   * Y si NINGUNA queda encendida, la burbuja deja de esperar respuesta y suelta
   * la intro de corrido, igual que si no tuviera cuadritos. No hay un
   * interruptor aparte a propósito: un dato guardado que dijera "decisiones
   * encendidas" podría contradecir a la lista —encendido sin cuadritos,
   * apagado con cuadritos— y entonces habría dos verdades para lo mismo.
   */
  enabled?: boolean;
  /** Etiqueta del cuadrito en el editor. No se usa para reconocer nada. */
  title?: string;
  /** Lo que el cliente puede escribir para activar esta decisión. */
  keywords?: string[];
  /** Las burbujas que salen cuando acierta. */
  steps?: ResponseStep[];
  /**
   * A QUÉ ESTÁ LINKEADO el cuadrito. Se ejecuta DESPUÉS de sus burbujas.
   *
   * Un comodín dentro del texto pega un dato; una acción, además, DEJA ALGO
   * ANOTADO. Es la diferencia que importa: escribir {{PRECIO_2}} en el cuadrito
   * del básico enseña el precio correcto, pero el bot sigue sin saber qué
   * eligió el cliente — y ese apunte es el que hace que el comprobante se
   * valide contra el precio correcto y que se entregue el producto correcto.
   *
   * "send_steps" no está en la lista a propósito: las burbujas del cuadrito YA
   * son su contenido, y ofrecerlo sería mandarlas dos veces.
   */
  action?: DecisionAction;
  /** Para "send_payment_method": qué método manda. Sus datos salen de Precios
   *  y pagos, nunca de una copia guardada aquí. */
  payment_method?: string;
  /** Para "start_workflow": qué workflow arranca. */
  workflow_id?: string;
}

/** Lo que puede hacer un cuadrito además de mandar sus burbujas. */
export type DecisionAction =
  | "choose_combo"
  | "choose_basico"
  /**
   * El SEGUNDO producto, el que se ofrece después de la venta. Va aparte de los
   * otros dos porque no es una opción de la misma oferta: no se apunta en
   * order_bump_choice sino en upsell_state, cobra su propio precio y entrega lo
   * suyo. Solo existe en las modalidades que lo tienen (regla 5-bis); en las
   * demás el cuadrito no hace nada y queda escrito en el registro.
   */
  | "choose_upsell"
  /** El «No» al segundo producto (17/10/2026). Ver `ejecutarAccion`. */
  | "decline_upsell"
  | "send_payment_method"
  | "show_payment"
  /**
   * LA INTRO DE LA OFERTA DE DOS OPCIONES.
   *
   * Presenta el producto complementario y deja la conversación esperando la
   * elección. Ya existía como acción de una regla del Cerebro; aquí se abre
   * también a los cuadritos, para poder armar el recorrido a mano: la burbuja
   * final de la intro pregunta, y su cuadrito lleva a la oferta.
   */
  | "show_order_bump"
  /**
   * EL REGALO. Las tres cosas que se le pueden hacer.
   *
   * También venían de las reglas del Cerebro. Sin ellas, la única forma de
   * contestar al regalo era que el detector de "sí/no" acertara — y ese
   * detector no puede saber qué palabras usa cada negocio.
   */
  | "accept_gift"
  | "decline_gift"
  | "claim_gift"
  | "human"
  /** Arranca un workflow del tablero (22/10/2026). Ver `BubbleButtonAction`. */
  | "start_workflow";

type ButtonsOnBubble = {
  buttons?: BubbleButton[];
  /** Respuestas posibles a la pregunta de esta burbuja. Vacío = no pregunta. */
  decisions?: BubbleDecision[];
  /**
   * Minutos que ESTA burbuja espera una elección antes de soltar el resto.
   *
   * Es de la burbuja, no del bot: una pregunta de «sí o no» se contesta en
   * segundos y otra que obliga a pensar merece más. Un número global tenía que
   * servir a las dos, y acababa siendo corto para una y eterno para la otra.
   *
   * Solo cuenta si la burbuja tiene algún cuadrito ENCENDIDO: sin cuadritos no
   * hay pausa que medir. Vacío = los 3 minutos de siempre.
   */
  espera_eleccion_minutos?: number;
  /**
   * ESTA BURBUJA PREGUNTA EL NOMBRE.
   *
   * Lo que el cliente conteste se guarda como su nombre, igual que hacía el
   * saludo. Era lo ÚNICO que el saludo sabía hacer y una burbuja no: esperar
   * una respuesta ya lo hacen los cuadritos, y con plazo propio.
   *
   * No hace falta ningún cuadrito: un nombre es texto libre y no hay palabra
   * clave que lo reconozca. Por eso esto detiene la intro por su cuenta.
   *
   * El nombre va al CRM, a los avisos de pago, a las alertas al asesor y al
   * nombre que se manda a Meta para atribuir la venta al anuncio.
   */
  capturar_nombre?: boolean;
};

export type ResponseStep = ButtonsOnBubble & (
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
    }
);

export interface IntroStep extends ButtonsOnBubble {
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
  | (ButtonsOnBubble & {
      type: "text";
      body?: string;
      body_variants?: string[];
      delay_after_sec: number;
      /** false = burbuja APAGADA (no se envía, pero no se borra). */
      enabled?: boolean;
    });

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

/**
 * Cuerpo de una burbuja con BOTONES.
 *
 * WhatsApp exige un cuerpo con texto: mandar botones con la burbuja en blanco
 * hace fallar el envío ENTERO, y el cliente se queda sin los botones y sin el
 * mensaje. Por eso un campo vacío significa APAGADO — no se mandan los botones
 * — y queda escrito en el log para que se vea por qué.
 *
 * El motor no tiene textos de reserva: lo que no está escrito en el editor no
 * se manda.
 */
export function cuerpoDeBotones(
  texto: string | null | undefined,
  donde: string
): string | null {
  const limpio = (texto ?? "").trim();
  if (limpio) return limpio;
  console.warn(
    `[wf] ${donde}: el texto está vacío en el editor → no mando los botones (WhatsApp los rechaza sin texto)`
  );
  return null;
}

/**
 * Títulos de los botones. Un botón sin título también hace fallar el envío, así
 * que si falta alguno no se manda ninguno. Devuelve los títulos ya limpios, en
 * el mismo orden.
 */
export function titulosDeBotones(
  titulos: (string | null | undefined)[],
  donde: string
): string[] | null {
  const limpios = titulos.map((t) => (t ?? "").trim());
  if (limpios.some((t) => !t)) {
    console.warn(
      `[wf] ${donde}: falta el nombre de alguna opción en el editor → no mando los botones`
    );
    return null;
  }
  return limpios;
}

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
  /** APAGA SOLO LOS «MENSAJES PRINCIPALES», dejando vivas las variantes.
   *
   *  Cada variante tenía su interruptor y el original no: el único apagador que
   *  había —`enabled`— apaga el seguimiento ENTERO, variantes incluidas. Así que
   *  para probar una variante sola no quedaba más remedio que vaciar el
   *  original a mano y volver a escribirlo después.
   *
   *  undefined o true = el original entra al sorteo, como siempre. */
  steps_enabled?: boolean;
  /** EL PESO DE LOS «MENSAJES PRINCIPALES» en el sorteo de este seguimiento (17/10/2026).
   *  Ausente = 1: el reparto parejo de siempre. Ver `chooseFollowupVariant`. */
  steps_weight?: number;
  /** TOGGLE POR SEGUIMIENTO (default APAGADO): si está ENCENDIDO, ESTE
   *  seguimiento se envía a su hora aunque caiga en horario silencioso.
   *  Solo afecta a esta secuencia; las demás siguen respetando la regla. */
  ignore_quiet_hours?: boolean;
  /** TOGGLE POR SEGUIMIENTO (default APAGADO): si está ENCENDIDO, ESTE
   *  seguimiento cuenta sus minutos desde el mensaje del cliente aunque
   *  escriba pasada la hora límite de leads tardíos (defer_late_leads).
   *  Solo afecta a esta secuencia; las demás siguen aplazándose. */
  ignore_late_lead_defer?: boolean;
  /** Anuncios que pueden recibir la variante principal. Vacío = general. */
  ad_keys?: string[];
  /** false = conserva etiquetas, pero esta secuencia entra al sorteo general. */
  ad_routing_enabled?: boolean;
  /** LA BANDERA, QUE ES UNA ETIQUETA MÁS — la gemela de `ad_keys`.
   *
   *  Lo pidió el dueño el 24/09/2026 con estas palabras: «la bandera no es solo
   *  una etiqueta como la de los ads? agrégalo igual». Y tenía razón: es el
   *  mismo mecanismo con otro dato, así que se escribe al lado y se lee igual.
   *
   *  Países que pueden recibir esto. VACÍO = general, para todos. */
  paises?: string[];
  /** false = conserva las banderas, pero entra al sorteo general. El gemelo de
   *  `ad_routing_enabled`: sirve para probar sin borrar el etiquetado. */
  pais_routing_enabled?: boolean;
  /** LA SEMIMODALIDAD — «lineal», «dou» u «ob». La TERCERA etiqueta, con el
   *  mismo molde que las otras dos. Vacío = general. Ver `porSemimodalidad`. */
  semimodalidad?: string;
  /** PARA QUÉ TIENDAS ES ESTE SEGUIMIENTO, por id. VACÍO = para todas.
   *
   *  LA CUARTA ETIQUETA, y la única que EXCLUYE: un seguimiento escrito para la
   *  tienda B no se le manda al cliente de la A ni aunque A no tenga ninguno.
   *  Así es como un seguimiento queda «encendido en un número y apagado en los
   *  otros» sin duplicarlo. Ver `soloDeSuTienda`.
   *
   *  Vale para sus cajones: el que no traiga las suyas hereda éstas, igual que
   *  con la bandera y la semimodalidad. */
  tiendas?: string[];
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
  /** Su PESO en el sorteo (17/10/2026). Ausente = 1, el reparto parejo de siempre. */
  weight?: number;
  /** Anuncios que pueden recibir esta variante. Vacío = variante general. */
  ad_keys?: string[];
  /** false = conserva etiquetas, pero esta variante entra al sorteo general. */
  ad_routing_enabled?: boolean;
  /** Países que pueden recibir esta variante. Vacío = general. Ver `paises` en
   *  `FollowupSequence`: es la etiqueta gemela de la de anuncios. */
  paises?: string[];
  /** false = conserva las banderas, pero entra al sorteo general. */
  pais_routing_enabled?: boolean;
  /** LA SEMIMODALIDAD — «lineal», «dou» u «ob». Vacío = general. Si el cajón no
   *  tiene la suya, HEREDA la del seguimiento entero, igual que la bandera. */
  semimodalidad?: string;
  /** LAS TIENDAS de este cajón, por id. VACÍO = hereda las del seguimiento
   *  entero, igual que la bandera y la semimodalidad. Ver `soloDeSuTienda`. */
  tiendas?: string[];
  /** SU CAMINO (18/10/2026). Vacío = el principal. Ver `etiqueta-de-camino.ts`. */
  camino?: string;
}

export interface AdRegistryEntry {
  key: string;
  name: string;
  ids: string[];
  color?: string;
  enabled?: boolean;
  ads_reader_id?: number;
  reference?: string;
  meta?: {
    business_name?: string;
    ad_account_name?: string;
    campaign_name?: string;
    ad_name?: string;
    active?: boolean;
  };
}

export interface AdColorPaletteEntry {
  label: string;
  value: string;
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
  /** Si está activo, los contactos nuevos que escriben desde esta hora no
   *  reciben seguimientos hasta la hora de reanudación configurada. */
  defer_late_leads_enabled?: boolean;
  /** Hora local HH:MM desde la que se aplazan los seguimientos de contactos nuevos. */
  defer_late_leads_after?: string;
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
  /** Producto A = el principal. Si se omite `delivery` usa la
   *  payment_approved_sequence existente (la que comparte con Lineal y Order
   *  Bump); si la define, entrega la suya sin tocar a las otras modalidades. */
  product_a?: BiofertaProduct;
  /** Producto B = el segundo producto (ligero). `delivery` = su entrega. */
  product_b?: BiofertaProduct;
  /** PACK = los 2 juntos, con su propio enlace de entrega (uno DISTINTO). */
  pack?: BiofertaProduct;
  /** Pregunta cuando el cliente pagó el precio UNITARIO pero aún no eligió
   *  cuál de los 2 productos quiere. Editable. */
  ask_choice_text?: string;
  ask_choice_text_variants?: string[];
  /** Al TERMINAR la intro, soltar las 3 opciones (producto A / producto B /
   *  pack) para que el cliente elija ANTES de pagar, igual que hace el order
   *  bump con sus 2. `false` = como antes: la intro termina en `intro_done` y
   *  la elección llega por texto o después del pago. Solo se dispara si los 3
   *  nombres están configurados de verdad (sin placeholders): con nombres a
   *  medias no mandamos "Producto 1 / Producto 2 / Pack". */
  choice_on_intro_enabled?: boolean;
  /** Texto de la pregunta al final de la intro. Acepta spintax y comodines. */
  intro_choice_prompt?: string;
  intro_choice_prompt_variants?: string[];
  /** Confirmación en voz alta de lo que eligió, antes de seguir con la entrega
   *  ("¡Genial! Elegiste Perritos 🎉"). Usa {{OPCION_ELEGIDA}} para el nombre
   *  del producto o del pack. El propio texto es el interruptor: si está vacío
   *  no se manda nada, así que las configuraciones de hoy no cambian.
   *  `choice_confirmation_enabled: false` lo apaga aunque haya texto. */
  choice_confirmation_enabled?: boolean;
  choice_confirmation_text?: string;
  choice_confirmation_text_variants?: string[];
}

/** Una opción del Order Bump (ej. "combo" / "básico"). El `name` (+ aliases)
 *  es la palabra clave para elegir y el título del botón. `price_soles` es el
 *  monto que el bot valida; `response` es la respuesta predefinida (método +
 *  precio) que se envía al elegir; `delivery` es lo que recibe al pagar. */
/**
 * QUÉ PAPEL JUEGA UN PRODUCTO. Es una lista cerrada a propósito: la etiqueta es
 * lo que lee el motor para saber qué caja llenar, así que un texto libre sería
 * un producto que no se vende y nadie sabe por qué.
 *
 * Vacío —o ausente— significa GUARDADO SIN VENDER: el producto se queda en la
 * biblioteca y no llena ninguna caja.
 */
export type EtiquetaDeProducto =
  | ""
  | "basico"
  | "full"
  | "upsell"
  | "upsell_2";

/**
 * LOS PUESTOS QUE PUEDE JUGAR UN PRODUCTO.
 *
 *   unico           el producto de Lineal, el único que se vende.
 *   basico          la opción barata de las modalidades de dos opciones.
 *   complementario  lo que se SUMA al básico para formar la opción conjunta.
 *                   No se vende suelto: se enseña.
 *   full            la opción cara.
 *   upsell          la segunda venta, DESPUÉS de entregar la primera.
 */
export type PuestoDeProducto =
  | "unico"
  | "basico"
  | "complementario"
  | "full"
  | "upsell";

/**
 * LA ALINEACIÓN DE CADA MODALIDAD: qué producto juega cada puesto.
 *
 * QUÉ ES. Por cada modalidad, una lista corta de puestos, y en cada puesto el
 * `id` de un producto de la biblioteca. No una copia del producto: solo su id.
 *
 * POR QUÉ AQUÍ Y NO UNA ETIQUETA EN EL PRODUCTO. Se probó al revés —el producto
 * llevaba una etiqueta que decía qué papel juega— y tiene dos fallos:
 *
 *   1. Un producto solo puede llevar UNA etiqueta, así que el mismo no podía
 *      ser el único de Lineal y el básico de Order Bump a la vez. Había que
 *      reetiquetar en cada cambio de modalidad.
 *   2. Y sobre todo: la etiqueta es global. El momento en que etiquetas un
 *      producto para preparar Order Bump, estás cambiando lo que vende el
 *      Lineal de ahora mismo. No se podía preparar sin dejar de vender.
 *
 * Con la alineación, cada modalidad recuerda la suya. Se llena la de Order Bump
 * con calma mientras Lineal sigue vendiendo, y entra cuando se mueve el
 * interruptor de modalidad. La otra se queda escrita por si se vuelve.
 *
 * VACÍA NO HACE NADA. Una modalidad sin alineación deja sus cajas como están,
 * así que el bot se comporta igual que antes de que esto existiera.
 */
export type AlineacionDeModalidad = Partial<Record<PuestoDeProducto, string>>;

/**
 * UN PRODUCTO DE LA BIBLIOTECA.
 *
 * LLEVA LO QUE SE ENTREGA, NO LO QUE SE DICE PARA VENDERLO.
 *
 * Es la línea que separa esto de la caja donde cae. El producto son su nombre,
 * sus alias, su precio, sus imágenes y sus burbujas de entrega: cosas que
 * viajan con él vaya al papel que vaya.
 *
 * Lo que se QUEDA en la caja es el guion de venta —lo que contesta el bot al
 * elegir esa opción, sus variantes, sus respuestas por método de pago— porque
 * eso es del papel y no del producto: «la opción cara» se presenta igual sea
 * cual sea el producto que esté haciendo de cara. Y encima esos textos ya
 * nombran al producto con comodines, así que siguen siendo correctos solos.
 */
export interface ProductoDeLaBiblioteca {
  /** Identificador estable. NO es el nombre: renombrar un producto no puede
   *  convertirlo en otro ni perderle el sitio. */
  id: string;
  name?: string;
  aliases?: string[];
  price_soles?: number;
  discount_price_soles?: number;
  /** Su precio anterior/tachado. */
  market_price?: number;
  /**
   * SUS PRECIOS PAÍS POR PAÍS, Y MANDAN SOBRE PRECIOS Y PAGOS.
   *
   * LO QUE PIDIÓ EL DUEÑO — 17 de septiembre de 2026: «que cada producto tenga
   * su precio fijado y que al activarlo respete ese precio como PRIORIDAD sobre
   * el precio de la sección precios y pagos», y «los precios iguales para cada
   * modalidad de acuerdo al país».
   *
   * POR QUÉ HACÍA FALTA. Los tres campos de arriba son UN número para los siete
   * países, y él vende en monedas distintas. Y el precio del puesto vivía en la
   * capa del país de CADA modalidad, así que al cambiar qué producto juega de
   * básico el precio se quedaba con el puesto, no con el producto: se cobraba lo
   * del anterior.
   *
   * NO HAY RESPALDO ENTRE PAÍSES, y es orden suya: «jamás deben tener precios de
   * otro país, son monedas y montos distintos». Un país sin su precio aquí cae a
   * Precios y pagos como siempre; si tampoco lo tiene, no hay precio y se avisa.
   *
   * La clave es el código de país en mayúsculas (PE, AR, MX…), igual que en
   * `payment_profiles_by_country`.
   */
  precios_por_pais?: Record<
    string,
    {
      price_soles?: number;
      discount_price_soles?: number;
      market_price?: number;
    }
  >;
  /** Regalos/bonos incluidos. Descriptivo: no cambia precio ni entrega. */
  regalos?: string;
  /** Lo que recibe quien lo compra. */
  delivery?: SequenceStep[];
  /**
   * ENTREGAS EXTRA (25/10/2026): otras partes de ESTE producto que se mandan en otro momento (muestras
   * gratis, un nivel de contribución…). Solo las usa la ficha «Entregar» del tablero; la venta de
   * siempre no las lee.
   */
  entregas_extra?: Array<{ id: string; nombre?: string; steps?: SequenceStep[] }>;
  /** Su galería, con la misma forma que las demás. */
  image_gallery?: UpsellConfig["image_gallery"];
  /** Qué incluye / cómo se estudia, para que el bot sepa responder. */
  course_content?: string;
  /**
   * SU PRESENTACIÓN CUANDO SE OFRECE COMO UPSELL EN FILA. Ver `PresentacionComoUpsell` y
   * PLAN-UPSELLS-EN-FILA.md. Se guarda aunque el producto no esté en ninguna fila.
   */
  presentacion_upsell?: PresentacionComoUpsell;
  /** EL PAPEL VIEJO, QUE YA NO SE LEE. Ver `EtiquetaDeProducto`.
   *
   *  Quien reparte los puestos ahora es `alineacion_por_modalidad`. Este campo
   *  se queda porque está escrito en las configuraciones ya guardadas y
   *  quitarlo del tipo haría que se perdiera al primer guardado, sin manera de
   *  volver atrás si algún día hay que mirarlo. */
  etiqueta?: EtiquetaDeProducto;
}

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
  /** Si true, al elegir esta opción se omite la respuesta clásica y se manda
   *  este mensaje editable antes de mostrar el menú de métodos de pago. */
  direct_payment_prompt_enabled?: boolean;
  direct_payment_prompt?: ResponseStep[];
  response?: ResponseStep[];
  /** MÁS RESPUESTAS PARA EL MISMO PRODUCTO, para probar cuál convierte mejor.
   *
   *  La de arriba (`response`) es la principal. Estas son alternativas con su
   *  nombre y su color, cada una con su interruptor. Cuando el cliente elige
   *  este producto se manda UNA al azar entre la principal y las encendidas
   *  —igual que las variantes de los seguimientos—, así que apagarlas todas
   *  deja la principal sola: la forma de volver al comportamiento de siempre. */
  response_variants?: {
    id?: string;
    name?: string;
    color?: string;
    enabled?: boolean;
    steps: ResponseStep[];
  }[];
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
  /** Overrides POR PAÍS de los textos de ESTA opción: respuesta al elegir
   *  (`response`), mensaje directo (`direct_payment_prompt`) y respuestas por
   *  método (`payment_responses`). La ENTREGA (`delivery`) NO se individualiza:
   *  es común a todos los países. Un campo vacío usa el texto base (fallback),
   *  igual que payment_profiles_by_country. */
  by_country?: Partial<
    Record<
      CountryCode,
      {
        direct_payment_prompt?: ResponseStep[];
        response?: ResponseStep[];
        payment_responses?: {
          yape?: ResponseStep[];
          bcp_transferencia?: ResponseStep[];
          efectivo?: ResponseStep[];
          [method: string]: ResponseStep[] | undefined;
        };
      }
    >
  >;
}

export interface CountryPaymentProfile {
  /** false = no vender a este pais. undefined/true = permitido. */
  enabled?: boolean;
  /** Precio principal para este pais. Si falta, usa course_price_soles global. */
  course_price_soles?: number;
  /** Precio de oferta para este pais cuando la conversación ya entró en una
   * etapa de descuento. Si falta, conserva el precio principal del mismo país;
   * nunca debe heredar la oferta de otro país. */
  discount_price_soles?: number;
  /** Precio referencial/anterior mostrado solo en textos comerciales. */
  market_price?: number;
  /** CÓMO SE ESCRIBE LA MONEDA DE ESTE PRODUCTO.
   *
   *  Antes esto se elegía escogiendo entre cuatro comodines que se parecían
   *  —el pelado, el "completo", el de mayúsculas y el de minúsculas—, y había
   *  que acordarse de cuál se había usado tres semanas atrás en otra burbuja.
   *  Ahora se elige aquí, al lado del precio, y el comodín corto obedece.
   *
   *  "upper" = S/. 10 SOLES · "lower" = S/. 10 soles · "off" = S/. 10
   *  El símbolo va siempre. Ausente = "upper", que es como salía hasta hoy. */
  price_label_case?: "upper" | "lower" | "off";
  /** Validacion propia para comprobantes de este pais. */
  payment_validation?: {
    yape_recipient_name_starts_with?: string;
    require_receipt_date?: boolean;
  };
  /** Texto del menu de metodos para este pais. Si falta, usa el global. */
  payment_text?: string;
  /**
   * LO QUE DICE AL MANDAR LOS DATOS DE PAGO, PROPIO DE ESTA MODALIDAD Y PAÍS.
   *
   * `direct_payment_steps` vive arriba, fuera de las capas: es UN texto para
   * todo el bot. En las modalidades de dos opciones eso no se nota, porque cada
   * opción tiene el suyo. En Lineal sí: era el único texto que el cliente
   * recibía al ir a pagar, y estaba compartido con las demás modalidades — así
   * que personalizarlo en una se lo cambiaba a todas.
   *
   * Aquí es de la capa `modality_payment_profiles[modalidad][pais]`, como el
   * precio y los datos de pago. Vacío = usa el global de siempre, así que quien
   * no escriba el suyo no nota ningún cambio.
   */
  direct_payment_steps?: ResponseStep[];
  /** El cierre del mismo mensaje. Misma regla: vacío = el global. */
  direct_payment_cta?: string;
  /** Botones/metodos disponibles para este pais. Si falta, usa los globales. */
  payment_buttons?: {
    label: string;
    method: string;
    aliases?: string[];
    /** Marcado desde el panel: es el metodo que el bot manda cuando tiene que
     *  enviar datos de pago sin que el cliente haya elegido. Uno por pais. Si
     *  ninguno esta marcado, se usa el PRIMERO de la lista (comportamiento
     *  anterior, por eso el campo es opcional y no rompe configs existentes). */
    principal?: boolean;
    /** false = metodo APAGADO: no sale como boton ni se reconoce si el cliente
     *  lo escribe, pero se conserva con todos sus datos para volver a
     *  encenderlo. Ausente o true = encendido. */
    enabled?: boolean;
  }[];
  /** Respuestas de pago por metodo para este pais. Si falta, usa global. */
  payment_responses?: {
    yape?: ResponseStep[];
    bcp_transferencia?: ResponseStep[];
    efectivo?: ResponseStep[];
    [method: string]: ResponseStep[] | undefined;
  };
  /** Precios de Order Bump (combo/basico) propios de este pais. Cada campo es
   *  opcional; si falta, usa el precio global de order_bump (fallback). Asi el
   *  operador puede tener combo/basico distintos por pais sin romper lo actual. */
  order_bump?: {
    combo_price_soles?: number;
    combo_discount_price_soles?: number;
    basico_price_soles?: number;
    basico_discount_price_soles?: number;
    /** Precio anterior/tachado de la opcion CARA. El del basico es el
     *  `market_price` de arriba, que vive junto a su precio.
     *
     *  Antes habia UN solo precio anterior por pais, asi que en una modalidad
     *  con dos o tres productos el mismo numero salia para todos: al full se le
     *  ponia el "antes" del basico y el descuento parecia mas chico de lo que
     *  era. Cada producto necesita el suyo. */
    combo_market_price?: number;
    /** Cómo se escribe la moneda de la opción cara. Ver `price_label_case`. */
    combo_price_label_case?: "upper" | "lower" | "off";
  };
  /** Precio del PACK de Doble Oferta propio de este pais. Los productos A y B
   *  comparten el precio unitario, que ya es por pais (course_price_soles), asi
   *  que aqui solo hace falta el pack. Si falta, usa el precio global del pack
   *  (bioferta_doble.pack_price_soles) igual que hasta hoy. */
  bioferta?: {
    pack_price_soles?: number;
    pack_discount_price_soles?: number;
  };
  /** Precio del UPSELL (la segunda venta) propio de este pais. Si falta, usa
   *  el precio global de la seccion upsell. */
  upsell?: {
    price_soles?: number;
    discount_price_soles?: number;
    /** Precio anterior/tachado del tercer producto, para que su oferta se
     *  compare contra lo suyo y no contra el "antes" de otro producto. */
    market_price?: number;
    /** Cómo se escribe su moneda. Ver `price_label_case`. */
    price_label_case?: "upper" | "lower" | "off";
  };
  /** Respuesta editable que el bot envía cuando el cliente pregunta el precio
   *  ANTES de conocer el producto 2 (pre-elección). Se inserta con el comodín
   *  {{PRECIO_PRE_ELECCION}}. Soporta comodines DENTRO ({{NOMBRE_RECEPTOR}},
   *  {{PRECIO_COMPLETO_MAYUSCULAS}}, {precio}…) que se resuelven al enviarse.
   *  Es por país: cada país puede tener su propia respuesta. */
  pre_choice_price_response?: string;
  /** Textos editables POR PAÍS de los métodos de pago (el 1 es el principal /
   *  más usado). Se insertan con {{METODO_DE_PAGO_1/2/3}}. El operador escribe el
   *  texto completo ("Puedes pagar por Yape/Plin al 935…, a nombre de …, Monto
   *  {{PRECIO_SEGUN_ELECCION}}"). Soportan comodines DENTRO. Vacío = no sale nada.
   *  Así el "Pago directo" deja de tener datos escritos a mano de un solo país. */
  metodo_pago_1?: string;
  metodo_pago_2?: string;
  metodo_pago_3?: string;
  /** Método de pago PRINCIPAL del país: campo PROPIO e independiente (no es
   *  alias de metodo_pago_1). Se inserta con {{METODO_DE_PAGO_PRINCIPAL}}. Útil
   *  para el pago SIN elección del order bump. Soporta comodines/spintax. */
  metodo_pago_principal?: string;
  /** NÚMERO DE CUENTA del país → {{NUMERO_DE_CUENTA}}.
   *
   *  Es un DATO suelto, no un texto de método. El número vivía escrito dentro
   *  de cada cajón de pago, así que cambiar de cuenta obligaba a editar los
   *  cuatro cajones de cada país, uno por uno, y bastaba olvidar uno para
   *  cobrar en una cuenta que ya no es tuya. Aquí se escribe una vez y los
   *  cajones lo insertan con el comodín.
   *
   *  Es SOLO texto: no valida nada. El comprobante se sigue validando por
   *  monto y por el nombre del receptor. */
  numero_de_cuenta?: string;
  /**
   * UNA CUENTA POR MÉTODO → el mismo {{NUMERO_DE_CUENTA}}, resuelto por el
   * método que el cliente eligió.
   *
   * POR QUÉ HIZO FALTA, medido en la configuración del dueño el 30/09/2026: en
   * Perú tiene DOS cuentas —un número de billetera y una cuenta de banco— y este
   * perfil solo tenía sitio para UNA. Así que la casilla se quedó VACÍA y los dos
   * números siguieron escritos a mano dentro de las burbujas, que es exactamente
   * lo que `numero_de_cuenta` vino a evitar. En Argentina, donde le bastaba con
   * uno, sí la llenó.
   *
   * O sea: la casilla no se usaba porque no podía representar su caso.
   *
   * LA CLAVE ES EL MÉTODO, el mismo que ya guarda la conversación
   * (`selected_payment_method`) y el mismo que él escribe en sus botones de pago.
   * Nunca una lista de métodos escrita en el código: cada negocio tiene los suyos
   * y con otros nombres.
   *
   * VACÍO O SIN EL MÉTODO se cae a `numero_de_cuenta`, así que quien tenga una
   * sola cuenta no nota nada y nada cambia sin que se pida.
   */
  cuentas_por_metodo?: Record<string, string>;
  /** TU NOMBRE COMPLETO → {{NOMBRE_COMPLETO}}. Es SOLO para leer.
   *
   *  EL PROBLEMA QUE RESUELVE. Había un solo nombre y hacía dos trabajos a la
   *  vez: se enseñaba en los mensajes Y validaba el comprobante. Quien quería
   *  firmar con su nombre completo lo escribía ahí, y a partir de ese momento
   *  el comprobante —que trae un nombre más corto, el de la cuenta— dejaba de
   *  coincidir y el bot rechazaba pagos buenos.
   *
   *  Ahora son dos campos. El de la validación no se toca nunca. Éste es libre:
   *  escribe lo que quieras, que no entra en ninguna comprobación.
   *
   *  VACÍO USA EL DEL RECEPTOR, así que quien no lo llene ve exactamente lo de
   *  siempre y nada cambia sin que nadie lo pida. */
  nombre_completo?: string;
}

/**
 * UPSELL — la SEGUNDA venta, después de haber entregado la primera.
 *
 * No es un order bump: el order bump ocurre ANTES de pagar y hace elegir. El
 * upsell ocurre DESPUÉS de entregar, y su intro se suelta sin preguntar.
 *
 * Va POR ENCIMA de la modalidad que esté vendiendo (Lineal, Order Bump o Doble
 * Oferta): es una fase, no una modalidad más.
 *
 * La oferta NO caduca. Pasados `espera_minutos` sin respuesta sale el regalo
 * igual, pero el upsell sigue aceptándose si más tarde lo pide por su nombre.
 */
export interface UpsellConfig {
  /** APAGADO por defecto. Sin esto, tras entregar sigue el regalo de siempre.
   *  Este interruptor ES la modalidad Upsell: al encenderlo, esa pasa a ser la
   *  modalidad activa (vende un producto como Lineal y, tras entregarlo, ofrece
   *  el segundo). Las demás quedan apagadas mientras esté encendido. */
  enabled?: boolean;
  /** El nombre del segundo producto. Sirve de título de botón y, sobre todo,
   *  de PALABRA CLAVE para reconocer que lo quiere. */
  name?: string;
  /** Otras formas de pedirlo: "el complemento", "el segundo", "el otro". */
  aliases?: string[];
  /** La segunda intro. Se suelta entera y sin preguntar, justo tras entregar
   *  el primer producto.
   *
   *  ES EL RESPALDO: lo que se edita hoy son los cajones de `intro_groups`. */
  intro?: SequenceStep[];
  /** LOS CAJONES DE LA INTRO DEL UPSELL. Ver `GrupoDeIntro`. */
  intro_groups?: GrupoDeIntro[];
  /**
   * La pregunta del final, "¿deseas llevarlo?", EN BURBUJAS.
   *
   * La ÚLTIMA burbuja encendida es la pregunta: la que lleva los botones sí/no.
   * Las de antes salen tal cual, en orden — sirven para rematar con una foto o
   * un audio antes de preguntar.
   *
   * Vacío = se usa el campo `pregunta` de abajo, que es como funcionaba antes.
   */
  pregunta_steps?: SequenceStep[];
  /** La pregunta del final en texto suelto. Respaldo de `pregunta_steps`. */
  pregunta?: string;
  pregunta_variants?: string[];
  use_buttons?: boolean;
  boton_si?: string;
  boton_no?: string;
  /** Precio del segundo producto. Admite capa por país igual que los demás. */
  price_soles?: number;
  discount_price_soles?: number;
  /** Su precio anterior/tachado, para que su oferta se compare contra lo suyo
   *  y no contra el "antes" de otro producto. El del país manda sobre este. */
  market_price?: number;
  /** Respuestas propias al confirmar el método de pago del tercer producto.
   *  Vacío = conserva el respaldo global por país. */
  payment_responses?: { [method: string]: ResponseStep[] | undefined };
  /** SUS PROPIAS burbujas de "qué trae". Se envían TAL CUAL cuando la clienta
   *  pregunta por el contenido durante la oferta, sin pasar por el modelo —
   *  mismo patrón que `order_bump.choice_helper`. Son texto que lee ella, no
   *  alimento para el modelo: por eso son pasos y no un bloque de contenido.
   *  NO se lee el de ninguna otra modalidad — ver regla 5-bis del protocolo. */
  info_steps?: SequenceStep[];
  /** SU PROPIA galería, con la misma forma que las demás. El bot manda un item
   *  cuando la clienta pregunta por eso durante la oferta. */
  image_gallery?: {
    topic?: string;
    keywords?: string[];
    when?: string;
    media_type?: "image" | "video" | "document" | "audio";
    drive_url?: string;
    caption?: string;
    caption_variants?: string[];
    enabled?: boolean;
    /** BURBUJAS EXTRA DE ESTA MISMA MUESTRA. Salen JUSTO DETRÁS del archivo y
     *  antes de la siguiente muestra: son parte de ella, no otra. Vacío = la
     *  muestra es solo su archivo con su pie, como fue siempre. */
    pasos_extra?: SequenceStep[];
    /** ESTA MUESTRA SALE CUANDO PIDEN VER EL DETALLE.
     *
     *  «Info de contenido» guardaba una lista de NOMBRES de tema, suelta, en la
     *  configuración de la modalidad. Desde que las imágenes llegan con el
     *  producto, esa lista se quedaba nombrando las del producto anterior: no
     *  coincidía ninguna y el bot no mandaba nada, sin error y sin aviso.
     *
     *  Marcándolo en la propia imagen, la lista se arma sola con lo que traiga
     *  el producto que esté jugando. Se elige una vez, al cargar el producto. */
    info_de_contenido?: boolean;
  }[];
  /** Lo que responde si pregunta algo del segundo producto que no encaja con
   *  su contenido ni su galería. Sin esto no dice nada y lo lleva el modelo. */
  course_content?: string;
  respuesta_generica?: string;
  /** Su propia entrega. Si falta, no se puede vender: no se ofrece. */
  delivery?: SequenceStep[];
  /** Minutos antes de soltar el regalo si no contesta. Por defecto 30. */
  espera_minutos?: number;
  /** Minutos que se espera DESPUÉS de entregar antes de ofrecer este producto.
   *  0 o ausente = se ofrece enseguida, como se hacía siempre.
   *
   *  Existe porque encadenar la segunda oferta al mismo segundo en que llega la
   *  entrega se lee como prisa. Dejar un rato hace que sea otro mensaje, no la
   *  coleta del anterior. */
  retraso_minutos?: number;
  /** Lo que se le dice si dice que NO, antes de pasar al regalo. */
  respuesta_rechazo?: string;
  /** EL RECORDATORIO: una línea corta, escrita por él, que se manda UNA vez si
   *  la oferta se quedó sin contestar.
   *
   *  POR QUÉ EXISTE. Antes, cuando la oferta quedaba colgada —tras un upgrade, o
   *  tras el regalo—, se volvía a encolar la PRESENTACIÓN entera. Con sus
   *  palabras: «luego de reenviar el enlace, nuevamente se envía la intro del
   *  upsell. Eso no debería pasar». Lo que pidió no era repetir la intro sino
   *  «un pequeño recordatorio, quizás un mensaje predeterminado sin costo».
   *
   *  No pasa por el modelo: es este texto tal cual, con sus comodines resueltos
   *  ({{PRODUCTO_UPSELL}}, {{PRECIO_UPSELL}}…). Vacío = no se manda nada y el
   *  bot se comporta como antes de que esto existiera. */
  recordatorio?: string;
  /** SOLO DEL MOTOR, NUNCA SE GUARDA. Lo pone `seccionUpsell` cuando la oferta en curso
   *  es un producto de la fila o el downsell: de aquí sale su precio por país, en vez del
   *  puesto «upsell» de la alineación. Ver PLAN-UPSELLS-EN-FILA.md. */
  de_la_fila?: OfertaDeLaFila;
}

/** Lo que distingue a una oferta de la fila del upsell de siempre. Ver arriba. */
export interface OfertaDeLaFila {
  /** null = el upsell de siempre (solo pasa con su downsell). */
  producto_id: string | null;
  downsell: boolean;
  /** Sus precios por país: los de la ficha del producto, o los del downsell. */
  precios: Record<
    string,
    { price_soles?: number; discount_price_soles?: number; market_price?: number }
  >;
  /** El teléfono del cliente, para que «¿se puede ofrecer?» mire SU país. */
  phone: string | null;
}

/**
 * LA PRESENTACIÓN DE UN PRODUCTO CUANDO SE OFRECE COMO UPSELL EN FILA.
 *
 * LO PIDIÓ EL DUEÑO el 10/10/2026. Ver PLAN-UPSELLS-EN-FILA.md. Vive DENTRO de la ficha del
 * producto: «ya que esos productos van a llevar la intro propia dentro de sus fichas».
 *
 * LLEVA LOS MISMOS NOMBRES QUE `UpsellConfig`, A PROPÓSITO. En la fase 3 cada producto de
 * la fila se «viste» de upsell —ficha + esta presentación— y la máquina del upsell de hoy
 * lo procesa sin saber que es otro. Con los mismos nombres, vestirlo es copiar campos, no
 * traducirlos.
 *
 * Lo demás que necesita un upsell (precio por país, entrega, galería, contenido) YA está en
 * la ficha del producto: no se repite aquí.
 *
 * FASE 2: SOLO SE GUARDA. El motor no lo lee todavía.
 */
export interface PresentacionComoUpsell {
  /** Su intro en una lista suelta. ES EL RESPALDO: lo que se edita hoy son los cajones de
   *  `intro_groups`, igual que la intro del upsell de siempre. */
  intro?: SequenceStep[];
  /** LOS CAJONES DE SU INTRO, con su peso y sus etiquetas, como los del upsell de siempre
   *  (Canales → UPSELL). Pedido el 10/10/2026: «que funcione igual». Ver `GrupoDeIntro`. */
  intro_groups?: GrupoDeIntro[];
  /** La pregunta del final, en burbujas. La última encendida lleva los botones. */
  pregunta_steps?: SequenceStep[];
  /** «Preguntar con botones», la MISMA casilla que el upsell de siempre: los botones son
   *  opcionales y los decide él. Sin marcar nunca (presentaciones de antes de la casilla),
   *  sale con botones si escribió los dos textos. */
  use_buttons?: boolean;
  boton_si?: string;
  boton_no?: string;
  /** Lo que se manda si pregunta qué trae, tal cual. */
  info_steps?: SequenceStep[];
  /** Lo que se le contesta si dice que no, antes del regalo. */
  respuesta_rechazo?: string;
  /** Una línea, una sola vez, si la oferta se queda sin contestar. */
  recordatorio?: string;
  /** LO DE MESSENGER E INSTAGRAM, si quiere decirles otra cosa. La misma regla que Canales:
   *  cada campo en blanco deja mandar al de arriba, que es el de WhatsApp. */
  por_canal?: {
    messenger?: PresentacionDelCanal;
    instagram?: PresentacionDelCanal;
  };
}

/** La presentación de un canal: los mismos campos, sin la lista vieja ni más canales. */
export type PresentacionDelCanal = Omit<PresentacionComoUpsell, "intro" | "por_canal">;

/** Un producto dentro de una fila: cuál, a los cuántos minutos y si juega. */
export interface PuestoDeLaFila {
  /** El id del producto en `biblioteca_de_productos`. */
  producto_id: string;
  /** Minutos después de la entrega anterior. Cada producto con los suyos (su orden). */
  minutos?: number;
  /** false = se salta, sin borrarlo. */
  enabled?: boolean;
}

/**
 * EL DOWNSELL: el último upsell activo, otra vez, a un precio menor.
 *
 * «El downsell no invade la lista de upsells, sino se aplica solo en el último upsell
 * cuando el cliente no desea comprarlo o se activa luego de un tiempo de inactividad.»
 */
export interface DownsellConfig {
  enabled?: boolean;
  /** Su precio, FIJO POR PAÍS, puesto por él. El % de descuento solo se muestra. */
  precios_por_pais?: Record<string, { price_soles?: number }>;
  /** Minutos sin contestar al último upsell antes de ofrecerlo. */
  espera_minutos?: number;
  /** Su mensaje, en burbujas. La última encendida lleva los botones. */
  steps?: SequenceStep[];
  boton_si?: string;
  boton_no?: string;
}

/**
 * UNA FILA DE UPSELLS — por tienda, con la tienda elegida en su fachada.
 *
 * Detrás del upsell de hoy (que queda como el 1, sin tocarlo) van los productos de la
 * lista, en orden. «Si el cliente no quiere el primero o el segundo, no se insiste más»:
 * al primer «no», sale el regalo.
 *
 * La tienda se lee con `tiendasDe` y se elige con `soloDeSuTienda`, como los cajones de
 * intro: sin tienda marcada, la fila vale para todas.
 *
 * FASE 2: SOLO SE GUARDA. El motor no lo lee todavía.
 */
export interface FilaDeUpsell {
  id: string;
  /** false = la fila entera apagada. */
  enabled?: boolean;
  /** Para qué tiendas es. Vacío = para todas. Ver `tiendasDe`. */
  tiendas?: string[];
  puestos?: PuestoDeLaFila[];
  downsell?: DownsellConfig;
}

/**
 * MODERACIÓN. Dos interruptores independientes, los dos APAGADOS mientras no
 * se enciendan a mano. Cada uno cuenta sus propios avisos y solo bloquea al
 * llegar a su umbral: nunca al primer mensaje.
 *
 * Ninguno actúa si el mensaje menciona algo del negocio, ni después de una
 * compra, ni sobre quien ya mostró intención de comprar. La detección vive en
 * moderation.ts y no usa el modelo.
 */
export interface ModeracionConfig {
  /** Bloquear a quien insiste en piropear/acosar. Apagado por defecto. */
  piropos_enabled?: boolean;
  /** Cuántos mensajes de ese tipo hacen falta. Por defecto 3. */
  piropos_umbral?: number;
  /** Bloquear a quien manda texto sin sentido ("xxxxx", "asdasd"). */
  basura_enabled?: boolean;
  /** Por defecto 2: la basura de teclado es inconfundible. */
  basura_umbral?: number;
  /** Lo que se le dice antes de bloquear. VACÍO = se bloquea en silencio. */
  mensaje_despedida?: string;
}

/**
 * DOBLE OFERTA + UPSELL — vender dos productos y, tras entregar, ofrecer un
 * tercero.
 *
 * Es la Doble Oferta de 2 productos con una fase más pegada al final. La parte
 * de vender es idéntica: dos opciones en el primer mensaje, paga una, se le
 * entrega esa. Lo que cambia es que después no se pasa directo al regalo, sino
 * que se espera un rato y se ofrece un producto ADICIONAL, con su precio en el
 * mismo mensaje.
 *
 * POR QUÉ ES UNA MODALIDAD PROPIA Y NO LAS OTRAS DOS JUNTAS
 *
 * Porque las modalidades son herméticas: ninguna sirve contenido de otra. Si
 * esto encendiera a la vez "doble_oferta_dos" y "upsell", el contenido de dos
 * tiendas distintas acabaría mezclado en la misma conversación, y bastaría con
 * tocar una para romper la otra. Aquí todo —las dos opciones Y el tercer
 * producto— vive dentro de esta sección y no se lee de ninguna otra.
 *
 * LOS TRES PRECIOS
 *
 *   basico.price_soles   → producto 1
 *   combo.price_soles    → producto 2 (el completo)
 *   upsell.price_soles   → producto 3, el adicional de después
 */
export interface DobleOfertaUpsell extends DobleOfertaDos {
  /** El tercer producto y su oferta. Es SUYO: no se lee el de la modalidad
   *  Upsell, ni al revés. */
  upsell?: UpsellConfig;
}

export interface ChannelConfig {
  enabled?: boolean;
  /** true = runtime uses this channel content as an override layer. */
  use_content?: boolean;
  modality_templates?: Partial<Record<"lineal" | "order_bump" | "bioferta" | "doble_oferta_dos" | "doble_oferta_upsell" | "upsell", ChannelContent>>;
}

export type SalesbotEngineMode =
  | "ai"
  | "salesbot_strong"
  | "salesbot_stage_guided"
  | "salesbot_only";
export type SalesbotModalityKey =
  | "lineal"
  | "order_bump"
  | "bioferta"
  | "doble_oferta_dos"
  | "doble_oferta_upsell"
  | "upsell";
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
  /** Si está activo, esta intro se envía con el primer mensaje del cliente,
   *  sin pasar antes por el saludo que pide el nombre. */
  skipAskName?: boolean;
  adKeys?: string[];
  /** false = conserva etiquetas, pero no las usa para dirigir esta intro. */
  adRoutingEnabled?: boolean;
  /** LA BANDERA, QUE ES UNA ETIQUETA MÁS — la gemela de `adKeys`.
   *
   *  Países que pueden recibir esta intro. VACÍO = general, para todos. */
  paises?: string[];
  /** false = conserva las banderas, pero no las usa para dirigir. */
  paisRoutingEnabled?: boolean;
  /** LA SEMIMODALIDAD — «lineal», «dou» u «ob». Vacío = general. Se aplana a
   *  `intro_semimodalidades`, que es de donde el motor la lee. */
  semimodalidad?: string;
  /** LAS TIENDAS que reciben esta intro, por id. VACÍO = todas. Se aplana a
   *  `intro_tiendas`, igual que la semimodalidad. Ver `soloDeSuTienda`. */
  tiendas?: string[];
  /** SU CAMINO (18/10/2026). Vacío = el principal. Se aplana a `intro_caminos`, y la
   *  conversación anota el de la intro que recibe. Ver `etiqueta-de-camino.ts`. */
  camino?: string;
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
  /** Los cajones de la intro de la oferta y del upsell, propios de este canal.
   *  Vacíos = manda lo de la modalidad. Ver `GrupoDeIntro`. */
  order_bump_intro_groups?: GrupoDeIntro[];
  upsell_intro_groups?: GrupoDeIntro[];
  /**
   * LA ELECCIÓN CON BOTONES, PROPIA DE ESTE CANAL.
   *
   * Es la burbuja que remata la oferta: el texto que pide elegir y, en el
   * upsell, la pregunta del final con sus dos etiquetas. Va con los cajones y
   * no en la modalidad porque es lo que el cliente LEE, y eso sí cambia según
   * por dónde entró.
   *
   * MISMA REGLA QUE LOS CAJONES: sin escribir aquí, manda la modalidad. Un
   * campo ausente no es «apágalo», es «no opino» — por eso los interruptores
   * son opcionales y no un `false` por defecto.
   */
  order_bump_use_buttons?: boolean;
  order_bump_choice_prompt?: string;
  upsell_pregunta_steps?: SequenceStep[];
  upsell_use_buttons?: boolean;
  upsell_boton_si?: string;
  upsell_boton_no?: string;
  upsell_respuesta_rechazo?: string;
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
/**
 * UN CAJÓN DE INTRO, CON SU NOMBRE Y SU PESO.
 *
 * QUÉ RESUELVE. La intro de Order Bump y la del Upsell eran UNA secuencia y
 * nada más: para probar otra versión había que borrar la que había, y la
 * anterior se perdía. Las intros de la modalidad hace tiempo que son varios
 * cajones con su nombre, su interruptor y su peso; esto es lo mismo para las
 * otras dos.
 *
 * EL PESO ES UN REPARTO, no una prioridad. Con dos cajones encendidos a 1 y 3,
 * de cada cuatro clientes uno ve el primero y tres el segundo.
 *
 * CON UNO SOLO ENCENDIDO, EL BOT SE COMPORTA EXACTAMENTE COMO ANTES. Es la
 * garantía que hace que esto se pueda poner sin cambiar ninguna venta.
 */
export interface GrupoDeIntro {
  /** Para reconocerlo en la pantalla. No sale nunca al cliente. */
  name?: string;
  /** false = no entra al sorteo. Ausente o true = entra. */
  enabled?: boolean;
  /** Cuántas partes del reparto se lleva. Ausente o 0 = 1. */
  weight?: number;
  /** LA BANDERA, QUE ES UNA ETIQUETA MÁS — la gemela de la de anuncios.
   *
   *  Países que pueden recibir este cajón. VACÍO = general, para todos. Ver
   *  `paises` en `FollowupSequence`: mismo mecanismo, mismo molde. */
  paises?: string[];
  /** false = conserva las banderas, pero entra al sorteo general. Sirve para
   *  probar sin borrar el etiquetado. */
  pais_routing_enabled?: boolean;
  /** LA SEMIMODALIDAD — «lineal», «dou» u «ob». La TERCERA etiqueta, junto a la
   *  bandera y el anuncio, y con el mismo molde: si hay cajones con la
   *  semimodalidad de hoy juegan SOLO ésos, y si no, los que no llevan ninguna.
   *  Vacío = general. Ver `porSemimodalidad`. */
  semimodalidad?: string;
  /** PARA QUÉ TIENDAS SE ESCRIBIÓ ESTE CAJÓN, por id. VACÍO = para todas.
   *
   *  Es la CUARTA etiqueta, y la única que EXCLUYE: lo escrito para otra tienda
   *  no sale aquí ni aunque no quede nada más. Ver `soloDeSuTienda`. */
  tiendas?: string[];
  /** SU CAMINO (18/10/2026): en la intro de order bump, el cliente recibe la de su camino.
   *  Vacío = el principal. Ver `etiqueta-de-camino.ts`. */
  camino?: string;
  steps?: SequenceStep[];
}

export interface OrderBump {
  /** false/undefined = APAGADA: el motor la ignora por completo. */
  enabled?: boolean;
  /** Mostrar la elección con BOTONES de WhatsApp (vs texto escrito). */
  use_buttons?: boolean;
  /** Mensaje intermedio: imagen + texto con las 2 opciones detalladas.
   *
   *  ES EL RESPALDO, NO LA LISTA. Lo que se edita hoy son los cajones de
   *  `intro_groups`; éste se sigue leyendo para los archivos que aún no tengan
   *  cajones, y para que un bot que nunca los toque se comporte igual. */
  intro?: SequenceStep[];
  /** LOS CAJONES DE LA INTRO DE ORDER BUMP. Ver `GrupoDeIntro`. */
  intro_groups?: GrupoDeIntro[];
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
  /** Burbujas editables del recordatorio de las dos opciones al preguntar precio. */
  price_question_response_steps?: ResponseStep[];
  /** EL MISMO RECORDATORIO, PERO PARA QUIEN VENÍA DE UN SOLO PRODUCTO.
   *
   *  Solo lo ve el cliente que empezó cuando el bot vendía uno y hoy, con el
   *  modo reenganche, ve dos: a ése hay que contárselo antes de pedirle que
   *  elija. Va al lado del de arriba y no lo sustituye — el de siempre es para
   *  quien siempre vio dos. Ver `hayQueAvisarDeLaActualizacion`. */
  aviso_actualizacion?: string;
  /** Burbujas editables del aviso de actualización. */
  aviso_actualizacion_steps?: ResponseStep[];
  /** Confirmacion despues de que el cliente identifica una de las dos opciones.
   * Soporta {{OPCION_ELEGIDA}} y {{PRECIO_OPCION_ELEGIDA}}. */
  price_choice_confirmation?: string;
  /** Burbujas editables de la confirmación. Si existe, reemplaza el texto
   * legacy de arriba y permite texto, media, orden y varias burbujas. */
  price_choice_confirmation_steps?: ResponseStep[];
  /** Mensaje postventa para completar el saldo y pasar de Basico a Combo.
   * Soporta {{MONTO_FALTANTE}}. Solo aplica a Order Bump, no a Doble Oferta. */
  combo_upgrade_message?: string;
  /** Burbujas editables para ofrecer completar el Combo tras comprar Básico. */
  combo_upgrade_steps?: ResponseStep[];
  /** Mensaje cuando ya abonó una opción y elige otra que requiere saldo adicional. */
  partial_payment_choice_message?: string;
  /** Burbujas editables para el cambio de opción con saldo pendiente. */
  partial_payment_choice_steps?: ResponseStep[];
  /** Burbuja(s) de AYUDA que el bot AGREGA tras responder una pregunta de INFO/
   *  contenido en la etapa de elección del order bump (NO en precio/pago): un
   *  recordatorio corto de las 2 opciones para que el cliente elija sin releer
   *  todo. Editor de burbujas (como intro/response), soporta spintax {a|b|c} y
   *  comodines {{OPCION_1}}/{{OPCION_2}} y {{PRECIO_1}}/{{PRECIO_2}}. */
  choice_helper?: ResponseStep[];
  /** Interruptor de la burbuja de ayuda de elección (default APAGADO). */
  choice_helper_enabled?: boolean;
  /** SWITCH (default APAGADO): mostrar las dos opciones al cliente que volvió
   *  tras un seguimiento y pregunta el precio. Apagado conserva primero la
   *  respuesta normal del producto base; pedir método de pago sí revela la oferta. */
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
  /** false = al terminar la intro NO se manda nada: ni el texto ni los botones.
   *  El bot igual queda esperando la elección, así que la pregunta tiene que
   *  estar dentro de las burbujas de la intro.
   *
   *  Vaciar el texto no servía para apagarlo: al releer la configuración se le
   *  volvía a sembrar el texto por defecto y salía otra vez. Hacía falta un
   *  interruptor de verdad, que ningún valor por defecto pueda revivir. */
  choice_prompt_enabled?: boolean;
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
export type DynamicFieldSource =
  | "manual"
  | "product_name"
  | "product_name_2"
  | "course_content"
  | "course_content_2"
  | "payment_text"
  | "payment_buttons_prompt";

/** Campo reutilizable del producto activo. El motor solo recibe la capa de la
 * modalidad seleccionada, para que no se mezclen productos entre modalidades. */
export interface DynamicField {
  key?: string;
  label?: string;
  source?: DynamicFieldSource;
  manual_value?: string;
}

export interface ModalidadTemplate {
  /** Título para identificar de qué producto es esta plantilla (referencia). */
  title?: string;
  intro_sequence?: SequenceStep[];
  intro_sequence_2?: SequenceStep[];
  intro_sequence_3?: SequenceStep[];
  intro_extra_sequences?: SequenceStep[][];
  intro_enabled?: boolean[];
  intro_weights?: number[];
  /** Por intro: true omite el saludo y envía esa intro en el primer mensaje. */
  intro_skip_ask_name?: boolean[];
  intro_names?: string[];
  campaign_name?: string;
  intro_ad_names?: string[];
  intro_ad_ids?: string[];
  /** Etiquetas del gestor de anuncios por intro (índice 0 = Intro 1). */
  intro_ad_keys?: string[][];
  /** Por intro: false = ignora sus etiquetas y participa en el sorteo. */
  intro_ad_routing_enabled?: boolean[];
  /** LA BANDERA POR INTRO — la gemela de `intro_ad_keys`. Vacío = general. */
  intro_paises?: string[][];
  /** Por intro: false = ignora sus banderas y participa en el sorteo. */
  intro_pais_routing_enabled?: boolean[];
  /** LA SEMIMODALIDAD POR INTRO — «lineal», «dou» u «ob». Vacío = general.
   *  Sube al top-level igual que la bandera: es de ahí de donde el motor la lee. */
  intro_semimodalidades?: string[];
  /** LAS TIENDAS POR INTRO, por id. Vacío = para todas. La CUARTA etiqueta, y la
   *  única que excluye. Sube al top-level igual que las otras. */
  intro_tiendas?: string[][];
  /** EL CAMINO POR INTRO (18/10/2026). Vacío = el principal. La conversación anota el de la
   *  intro que recibe. Ver `etiqueta-de-camino.ts`. */
  intro_caminos?: string[];
  followup_sequences?: FollowupSequence[];
  course_content?: string;
  product_name?: string;
  image_gallery?: WorkflowConfig["image_gallery"];
  /** Burbujas enviadas al terminar de mostrar las muestras del producto. */
  samples_after_sequence?: SequenceStep[];
  /** Burbuja con la que el bot OFRECE enseñar las muestras, al cerrar su
   *  explicación del contenido. Admite variantes `{a|b|c}`. */
  samples_offer_bubble?: string;
  email_template?: WorkflowConfig["email_template"];
  email_template_vip?: WorkflowConfig["email_template_vip"];
  system_prompt_sections?: {
    postventa?: string;
  };
  gift_mechanic?: WorkflowConfig["gift_mechanic"];
  dynamic_fields?: DynamicField[];
}

export interface CommercialRoutesConfig {
  /** OFF conserva el comportamiento actual: todos siguen ruta A. */
  enabled?: boolean;
  /** Porcentaje de conversaciones nuevas que entran por ruta B. 0-100. */
  route_b_percentage?: number;
  /** Cuantas burbujas finales del intro se reemplazan en ruta B. */
  replace_last_intro_steps?: number;
  /** Cierre editable de ruta B: precio + datos de pago directos. */
  route_b_closing_steps?: ResponseStep[];
  /** Order bump editable despues de pago directo y antes de entregar. */
  route_b_post_payment_intro?: ResponseStep[];
  /** Texto del mensaje con botones post-pago, si los botones estan activos. */
  route_b_post_payment_choice_prompt?: string;
  /** Si true, muestra botones combo/basico en el post-pago. */
  route_b_post_payment_use_buttons?: boolean;
}

export interface PostSaleDeliveryPreferenceConfig {
  enabled?: boolean;
  use_buttons?: boolean;
  /** Si true, envia el texto principal y luego botones en burbuja aparte. */
  separate_bubble?: boolean;
  /** Mensaje con botones tras aprobar el pago. */
  prompt_text?: string;
  /** Secuencia editable equivalente a prompt_text. */
  prompt_steps?: ResponseStep[];
  /** Texto corto para la burbuja de botones cuando separate_bubble esta activo. */
  buttons_prompt?: string;
  whatsapp_button_label?: string;
  email_button_label?: string;
  /** Texto que se envia si elige WhatsApp + correo. */
  email_request_text?: string;
  /** Secuencia editable equivalente a email_request_text. */
  email_request_steps?: ResponseStep[];
  /** Texto si no elige claro y se entrega por WhatsApp. */
  fallback_whatsapp_text?: string;
  /** Secuencia editable equivalente a fallback_whatsapp_text. */
  fallback_whatsapp_steps?: ResponseStep[];
  /** Mensaje corto mientras se programa la pregunta. */
  wait_text?: string;
  /** Secuencia editable equivalente a wait_text. */
  wait_steps?: ResponseStep[];
  /** Demora antes de mostrar los botones de preferencia. */
  delay_seconds?: number;
}

export interface NotificationRecipient {
  name?: string;
  enabled?: boolean;
  phone?: string;
  telegram_chat_id?: string;
}

export interface NotificationSettingsConfig {
  enabled?: boolean;
  whatsapp_enabled?: boolean;
  telegram_enabled?: boolean;
  recipients?: NotificationRecipient[];
}

export interface WorkflowConfig {
  /** Runtime only: true when a channel content layer was applied. */
  __channel_content_active?: boolean;
  /** Runtime only: channel whose layer was applied. */
  __channel?: RuntimeChannel;
  greeting: {
    text?: string;
    text_variants?: string[];
    /**
     * EL SALUDO CON ELECCIÓN.
     *
     * Sin botones, el saludo es lo que siempre fue: un texto, el cliente
     * contesta cualquier cosa y arranca la intro. Con botones, la misma burbuja
     * ofrece una elección y cada botón manda sus propias burbujas antes de
     * seguir por el camino de siempre.
     *
     * No hay un interruptor aparte a propósito: "tiene botones" ES el
     * interruptor. Un interruptor y una lista que pueden contradecirse —
     * encendido sin botones, apagado con botones— son dos fuentes de verdad
     * para lo mismo, y tarde o temprano dicen cosas distintas.
     *
     * Son los MISMOS botones que puede llevar cualquier otra burbuja, con las
     * mismas acciones. Aquí no se estrena nada.
     */
    buttons?: BubbleButton[];
    initial_question_flow?: {
      enabled?: boolean;
      question?: string;
      yes_response?: string;
      no_response?: string;
    };
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
  /**
   * AHORRO: pone delante del prompt lo que nunca cambia.
   *
   * El proveedor cobra la décima parte por lo que reconoce desde el principio
   * de la petición, y a precio lleno todo lo que venga tras la primera
   * diferencia. Hoy va primero el cerebro, que cambia según el estado y según
   * las palabras del cliente, así que casi nada se reconoce.
   *
   * Encendido, los trozos fijos van delante. No se quita ni se añade una sola
   * palabra: solo cambia el ORDEN en que el modelo las lee.
   *
   * APAGADO POR DEFECTO, y apagado el prompt es idéntico al de siempre. Se
   * enciende y se apaga desde Ajustes, sin deployar.
   */
  prompt_cache_enabled?: boolean;
  /** Ver `segundaOpcionPrestada`: la modalidad activa sigue vendiendo lo suyo y
   *  solo toma prestada la FORMA de presentar dos opciones. Vacío = como hoy. */
  segunda_opcion_prestada?: "dos_juntas" | "segunda_oculta";
  /** LAS TIENDAS: una venta propia por cada número de WhatsApp. Ver `Tienda`.
   *  Vacío o sin ninguna que lleve el número que atiende = TODO COMO HOY. */
  tiendas?: Tienda[];
  /** EL ALMACÉN DE USUARIOS QUE COBRAN. Ver `Cobrador`.
   *
   *  Se escriben una vez y cada tienda elige el suyo — el mismo puede cobrar en
   *  varias. Vacío, o una tienda sin cobrador elegido, = cobra la cuenta del
   *  país, que es exactamente lo de hoy. */
  cobradores?: Cobrador[];
  /** MODO REENGANCHE. Apagado (por defecto) cada conversación se queda con la
   *  forma con la que nació —«lineal extendida»—; encendido, todas pasan a la
   *  del selector de hoy en su siguiente mensaje. Ver `segundaOpcionPrestada`. */
  modo_reenganche?: boolean;
  /** USAR RESPALDO ENTRE PAÍSES (16/10/2026). Ausente o true = como siempre: a un país sin
   *  pieza propia le llega una con bandera de otro. false = no le llega nada de otro país:
   *  sin intro o sin intro de order bump pasa a humano con aviso, sin seguimiento no se
   *  agenda, sin upsell se sigue con el regalo. Ver `etiqueta-de-bandera.ts`. */
  respaldo_entre_paises?: boolean;
  /** USAR RESPALDO ENTRE TIENDAS (17/10/2026). Ausente o true = como siempre: a una tienda sin
   *  lo suyo le sirve lo «de todas las tiendas». false = no: sin intro o sin intro de order bump
   *  pasa a humano con aviso, sin seguimiento no se agenda, sin upsell se sigue con el regalo.
   *  Ver `etiqueta-de-tienda.ts`. */
  respaldo_entre_tiendas?: boolean;
  /**
   * EL BOT NO LE CONTESTA A QUIEN NO VINO DE UN ANUNCIO.
   *
   * POR QUÉ EXISTE ESTO.
   *
   * Desde el 1 de octubre de 2026, Meta cobra POR MENSAJE todo lo que el bot
   * envía dentro de la ventana de 24 horas. Recibir sigue siendo gratis; se
   * paga lo que sale. Una conversación de venta son decenas de burbujas, y el
   * que no compra cuesta casi lo mismo que el que compra.
   *
   * La excepción es quien llegó por un anuncio de clic a WhatsApp o por el
   * botón de una página de Facebook: ahí Meta abre una ventana de 72 horas y
   * todo lo de dentro es gratis.
   *
   * Encendido, el bot CALLA con los que no traen ese origen. No responde, no
   * arranca la intro y no llama al modelo. El mensaje del cliente se guarda
   * igual, así que sigue estando en la bandeja para atenderlo a mano.
   *
   * APAGADO POR DEFECTO. Es una decisión comercial —dejar de atender a una
   * parte de la gente que escribe— y nadie debería encontrársela puesta.
   *
   * NUNCA CALLA A UN CLIENTE QUE YA PAGÓ. Ver el guardia en el manejador: una
   * conversación con `paid_at` se atiende siempre, venga de donde venga. Si no,
   * el que compró ayer por un anuncio y hoy escribe para pedir su material se
   * quedaría hablando solo, y eso no es ahorrar: es perder al cliente que ya
   * pagó y romper el modo de entregar.
   */
  no_responder_organicos?: boolean;
  /**
   * EL TOPE DE MENSAJES DEL MES, por número (22/10/2026).
   *
   * Lo pidió el dueño al saber que desde el 01/10/2026 Meta regala 1000 mensajes de servicio
   * al mes por número y cobra desde el 1001 (y sin tarjeta, deja de entregarlos). Con el
   * interruptor de arriba encendido, el bot contesta a los orgánicos NUEVOS mientras el número
   * lleve menos de este tope en el mes; al llegar, calla con ellos. Ausente = 950, para dejar
   * margen. 0 = no contestar nunca a un orgánico nuevo: lo de antes de este campo.
   */
  organicos_tope_mensajes?: number;
  /** Delay (segundos) que el bot "espera" antes de responder a cada
   *  mensaje entrante. Mientras espera, muestra el indicador "escribiendo…"
   *  estilo humano. 0 = respuesta instantánea. Por defecto 6. */
  bot_response_delay_seconds?: number;
  /**
   * Segundos que el bot espera POR SI EL CLIENTE SIGUE ESCRIBIENDO.
   *
   * La gente escribe en ráfagas de mensajitos. En vez de contestar a cada
   * trozo, el bot aguarda; si llega otro mensaje descarta el anterior y
   * responde UNA vez viendo el bloque entero.
   *
   * No confundir con `bot_response_delay_seconds`: ese ocurre DESPUÉS, cuando
   * la ráfaga ya se cerró, y no junta nada — es solo el «escribiendo…».
   *
   * Bajarlo recorta la unión, no solo la espera: con 4, una segunda frase
   * escrita a los 6 segundos ya no entra, porque la respuesta salió antes.
   * 0 lo desactiva. Vacío = se usa BOT_DEBOUNCE_SECONDS del entorno, y si
   * tampoco está, 8.
   */
  bot_debounce_seconds?: number;
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
  /** El recordatorio de correo EN BURBUJAS. Si tiene pasos, se mandan estos y
   *  `email_reminder_text` queda de respaldo. */
  email_reminder_steps?: ResponseStep[];
  /**
   * INTERRUPTOR PROPIO del recordatorio de correo tras el regalo.
   *
   * Antes iba pegado a `post_sale_reoffer`: apagar el re-ofrecimiento del
   * regalo apagaba también la petición del correo, y no había forma de
   * quedarse solo con una de las dos.
   *
   * Ausente = hereda `post_sale_reoffer`, o sea exactamente lo de siempre.
   */
  post_sale_email_reminder_enabled?: boolean;
  /** SELECTOR DE PAÍS (bot universal). Código ISO o nombre: "PE", "MX", "AR"…
   *  Define de una sola vez la moneda que se envía a Meta, el símbolo {{MONEDA}}
   *  en los textos, el dialecto del LLM y la zona horaria de los seguimientos.
   *  Si se omite → Perú (comportamiento actual). Ver src/lib/countries.ts. */
  country?: string;
  /** "fixed" = usa country global como hasta ahora. "auto_phone" = detecta
   *  pais por prefijo telefonico y usa el perfil de pago de ese pais. */
  country_mode?: "fixed" | "auto_phone";
  /** Messenger no entrega lada: pregunta y guarda el país antes de vender. */
  messenger_country_prompt?: {
    enabled?: boolean;
    message?: string;
    /** Recordatorio único si el cliente aún no indicó su país. */
    reminder_enabled?: boolean;
    /** Minutos desde la pregunta inicial hasta el recordatorio único. */
    reminder_delay_minutes?: number;
    reminder_message?: string;
    /** Cómo insistir cuando el cliente escribe sin dar el país todavía:
     *  "spintax" = frases variadas fijas (gratis), "microcall" = IA breve
     *  aislada (barata), "llm" = IA con más contexto del producto. */
    reask_mode?: "spintax" | "microcall" | "llm";
    /** Modo spintax: frases editables; el bot elige una al azar cada vez. */
    reask_variants?: string[];
    /** Modo microcall/llm: instrucción editable de estilo para la IA. */
    reask_instruction?: string;
  };
  /** Interruptores de venta por pais. false = no vender a ese pais. */
  country_sales_enabled?: Partial<Record<CountryCode, boolean>>;
  /** Lista blanca (opt-in): si es true, SOLO venden los paises activados
   *  explicitamente; el resto recibe country_disabled_message y pasa a humano. */
  country_sales_whitelist?: boolean;
  /** Mensaje editable cuando el pais del cliente no esta habilitado para venta. */
  country_disabled_message?: string;
  /** Camino B "4 bots en 1": producto y precio base POR MODALIDAD. Cada
   *  modalidad puede tener su propio nombre de producto y su precio base por
   *  pais (normal + oferta). Si un campo falta, usa el GLOBAL (fallback) → no
   *  rompe lo actual. Los metodos de pago siguen globales (por ahora). */
  modality_pricing?: Partial<
    Record<
      "lineal" | "order_bump" | "bioferta" | "doble_oferta_dos" | "doble_oferta_upsell" | "upsell",
      {
        prices_by_country?: Partial<
          Record<
            CountryCode,
            { course_price_soles?: number; discount_price_soles?: number }
          >
        >;
      }
    >
  >;
  /** Bloqueo opcional y controlado para consultas que mencionan Venezuela. */
  venezuela_redirect_enabled?: boolean;
  venezuela_redirect_message?: string;
  venezuela_redirect_human_delay_minutes?: number;
  /** Perfiles de precio/metodos/textos de pago por pais. Es la CAPA BASE. */
  payment_profiles_by_country?: Partial<Record<CountryCode, CountryPaymentProfile>>;
  /** CAPAS por modalidad: cada modalidad puede tener su PROPIO perfil completo
   *  (precio, metodos, receptor, textos) por pais, desenchufado de las demas.
   *  Si una modalidad no tiene capa para un pais, se usa la BASE
   *  (payment_profiles_by_country) como respaldo. Se siembra desde la BASE al
   *  editarla por primera vez en el editor. */
  modality_payment_profiles?: Partial<
    Record<
      SalesbotModalityKey,
      Partial<Record<CountryCode, CountryPaymentProfile>>
    >
  >;
  /** Canales adicionales. WhatsApp queda como canal base; Messenger/Instagram
   *  deben estar encendidos aqui para responder automaticamente. */
  channels?: {
    whatsapp?: ChannelConfig;
    messenger?: ChannelConfig;
    instagram?: ChannelConfig;
    tiktok?: ChannelConfig;
  };
  /** Registro reutilizable de anuncios Meta para asociar intros y seguimientos. */
  ad_registry?: AdRegistryEntry[];
  /** Colores personalizados reutilizables del Gestor de Ads. */
  ad_color_palette?: AdColorPaletteEntry[];
  /** Capa editable tipo Salesbot. Por defecto no interviene: todas las
   *  modalidades quedan en "ai". */
  salesbot?: SalesbotRulesConfig;
  /** A/B test de cierre de venta. Ruta A = comportamiento actual. Ruta B =
   *  pago directo primero + order bump despues del comprobante. */
  commercial_routes?: CommercialRoutesConfig;
  /** Postventa opcional: pregunta si desea entrega solo WhatsApp o WhatsApp +
   *  correo antes de soltar el enlace. OFF conserva la entrega actual. */
  post_sale_delivery_preference?: PostSaleDeliveryPreferenceConfig;
  /** Centro interno de notificaciones administrativas. No usa LLM. */
  notification_settings?: NotificationSettingsConfig;
  /** Precio del curso en soles (entero o decimal). El bot suma comprobantes
   *  hasta llegar a este monto para aprobar la compra. */
  course_price_soles: number;
  /**
   * EL «ANTES» TACHADO DEL PRODUCTO BASE. LO LLENA LA FICHA, NO SE ESCRIBE A MANO.
   *
   * El de Precios y pagos es por país y sigue mandando encima. Éste es el
   * respaldo, y hasta hoy no existía: con el del país en blanco,
   * `{{PRECIO_MERCADO}}` salía vacío aunque la ficha del producto tuviera su
   * precio anterior puesto. La clienta leía «(antes) ~~» sin ninguna cifra.
   *
   * Es el gemelo de `course_price_soles`: los dos los rellena la capa desde el
   * producto que esté sentado en el puesto base — ver `repartirPorEtiqueta`. Y
   * es el mismo trato que ya tenía el upsell, que sí caía a su sección cuando el
   * país no traía el suyo.
   */
  market_price?: number;
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
  /** Por intro: true omite el saludo y envía esa intro en el primer mensaje. */
  intro_skip_ask_name?: boolean[];
  /** Nombre visible editable por intro (índice 0 = Intro 1). Solo UI. */
  intro_names?: string[];
  /** Nombre visible de la campaña activa. Solo referencia editable. */
  campaign_name?: string;
  /** Nombre interno del anuncio por intro (índice 0 = Intro 1). Solo visual. */
  intro_ad_names?: string[];
  /** IDs de anuncio por intro (índice 0 = Intro 1). Match contra ad_source_id. */
  intro_ad_ids?: string[];
  /** Etiquetas del gestor de anuncios por intro (índice 0 = Intro 1). */
  intro_ad_keys?: string[][];
  /** Por intro: false = ignora sus etiquetas y participa en el sorteo. */
  intro_ad_routing_enabled?: boolean[];
  /** LA BANDERA POR INTRO — la gemela de `intro_ad_keys`. Vacío = general. */
  intro_paises?: string[][];
  /** Por intro: false = ignora sus banderas y participa en el sorteo. */
  intro_pais_routing_enabled?: boolean[];
  /** LA SEMIMODALIDAD POR INTRO — «lineal», «dou» u «ob». Vacío = general.
   *  La TERCERA etiqueta, con el mismo molde que la bandera y el anuncio. */
  intro_semimodalidades?: string[];
  /** EL CAMINO POR INTRO (18/10/2026). Vacío = el principal. Ver `etiqueta-de-camino.ts`. */
  intro_caminos?: string[];
  /** LAS TIENDAS POR INTRO, por id. Vacío = para todas.
   *
   *  LA CUARTA ETIQUETA, y la única que EXCLUYE: una intro escrita para la tienda
   *  B no se le enseña al cliente de la A. Así una intro queda encendida en un
   *  número y apagada en los otros sin duplicarla. Ver `soloDeSuTienda`. */
  intro_tiendas?: string[][];
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
  /** Modalidad "Doble Oferta + Upsell". APAGADA por defecto. Ver
   *  DobleOfertaUpsell: dos opciones al principio y un tercer producto
   *  después de entregar. */
  doble_oferta_upsell?: DobleOfertaUpsell;
  /** PLANTILLAS por modalidad (perfil de producto propio de cada una). Al
   *  guardar, la plantilla de la modalidad ACTIVA se copia a los campos
   *  top-level (intro_sequence, followup_sequences, gift_mechanic, etc.) que el
   *  motor lee → el MOTOR no cambia. Ver ModalidadTemplate. */
  modality_templates?: {
    lineal?: ModalidadTemplate;
    order_bump?: ModalidadTemplate;
    bioferta?: ModalidadTemplate;
    doble_oferta_dos?: ModalidadTemplate;
    doble_oferta_upsell?: ModalidadTemplate;
    upsell?: ModalidadTemplate;
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
  dynamic_fields?: DynamicField[];
  /** RE-OFRECIMIENTO post-compra. ON (ausente/true) = comportamiento actual: si
   *  el cliente da el correo sin aceptar el regalo, el bot re-ofrece el regalo; y
   *  tras el regalo vuelve a pedir el correo (recordatorio único). Si es false, el
   *  bot ofrece el regalo y pide el correo UNA sola vez, sin re-ofrecer. */
  post_sale_reoffer?: boolean;
  /** MODERACIÓN: corta a quien solo quema tokens. Ver ModeracionConfig.
   *  Ausente = todo apagado, el bot se comporta igual que siempre. */
  moderacion?: ModeracionConfig;
  /**
   * LA ETAPA UPSELL DE LA MODALIDAD QUE VENDE: segunda venta tras entregar la
   * primera. Ver UpsellConfig. Ausente o apagada = tras entregar sigue el
   * regalo, como siempre.
   *
   * Su `enabled` dice si ESA modalidad ofrece un segundo producto — no si la
   * modalidad Upsell está activa. Eso lo dice `upsell_modalidad_enabled`.
   */
  upsell?: UpsellConfig;
  /**
   * LA BIBLIOTECA DE PRODUCTOS. UNA SOLA, PARA TODAS LAS MODALIDADES.
   *
   * EL PROBLEMA QUE RESUELVE. Hasta ahora el papel de un producto ERA el sitio
   * donde estaba guardado: lo del full vivía en la caja del full y lo del
   * básico en la del básico. Para vender caro lo que antes era barato había que
   * vaciar las dos cajas y volver a llenarlas cruzadas, a mano, con sus
   * entregas y sus galerías. Un trabajo largo y con una forma obvia de
   * equivocarse.
   *
   * Aquí los productos viven sueltos y se llenan una sola vez. Qué papel juega
   * cada uno no está dentro del producto: lo dice la alineación de cada
   * modalidad — ver `alineacion_por_modalidad` aquí abajo.
   *
   * VIVE EN LA RAÍZ, NO EN LAS CAPAS DE MODALIDAD, a propósito: los productos
   * son los mismos se venda como se venda, y así cambiar de modalidad no los
   * toca. Se corrige un precio en la ficha y queda corregido en todas.
   *
   * VACÍA NO HACE NADA. Sin biblioteca —o sin alineación— las cajas se quedan
   * exactamente con lo que tienen hoy, así que el bot se comporta igual que
   * antes de que esto existiera. Ver `repartirPorEtiqueta`.
   */
  biblioteca_de_productos?: ProductoDeLaBiblioteca[];
  /** LAS FILAS DE UPSELLS, una por tienda. Ver `FilaDeUpsell`. Fase 2: solo se guarda. */
  filas_de_upsell?: FilaDeUpsell[];
  /**
   * LAS VERSIONES GUARDADAS DE LA INTRO DE LA OFERTA Y DE LA DEL UPSELL.
   *
   * ES UNA LIBRETA, NO UNA PIEZA DEL EMBUDO: el motor no la lee nunca, ni aquí ni
   * en ningún otro sitio. Sirve para que probar otra versión no obligue a borrar
   * la que había: se guarda, se escribe otra, y se vuelve eligiéndola.
   *
   * VIVE EN LA RAÍZ Y ESO NO ES UN DETALLE. Dentro del bloque de la oferta se
   * perdería al guardar, igual que se pierde hoy el duplicado de un cajón. Aquí
   * usa el mismo camino que la biblioteca de productos, que sí guarda.
   */
  biblioteca_de_intros?: {
    id: string;
    name?: string;
    /** De cuál de las dos es esta versión. */
    lugar?: "order_bump" | "upsell";
    /** LA QUE MANDA. Una por sitio. Ver `aplicarVersionActiva`: con una activa,
     *  es ella la que se envía, no lo que quede escrito en el cajón. */
    activa?: boolean;
    steps?: SequenceStep[];
  }[];
  /**
   * QUÉ PRODUCTO JUEGA CADA PUESTO, EN CADA MODALIDAD.
   *
   * Una alineación por modalidad. Ver `AlineacionDeModalidad` para el porqué de
   * que esto viva aquí y no como etiqueta dentro del producto.
   *
   * La clave es el nombre de la modalidad —`lineal`, `order_bump`…— y solo se
   * lee la de la que está vendiendo. Las demás se quedan escritas, esperando.
   */
  alineacion_por_modalidad?: Record<string, AlineacionDeModalidad>;
  /**
   * ¿Es la modalidad Upsell la que vende?
   *
   * Antes esto se leía de `upsell.enabled`, pero ese campo pasó a significar
   * «esta modalidad ofrece un segundo producto», y con los dos significados en
   * un mismo campo encender la etapa en Lineal cambiaba lo que vende el bot.
   *
   * Ausente = se decide con el campo antiguo, para que un archivo que todavía
   * no se ha guardado con esta versión venda exactamente lo mismo.
   */
  upsell_modalidad_enabled?: boolean;
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
  payment_buttons?: {
    label: string;
    method: string;
    aliases?: string[];
    /** Marcado desde el panel: es el metodo que el bot manda cuando tiene que
     *  enviar datos de pago sin que el cliente haya elegido. Uno por pais. Si
     *  ninguno esta marcado, se usa el PRIMERO de la lista (comportamiento
     *  anterior, por eso el campo es opcional y no rompe configs existentes). */
    principal?: boolean;
    /** false = metodo APAGADO: no sale como boton ni se reconoce si el cliente
     *  lo escribe, pero se conserva con todos sus datos para volver a
     *  encenderlo. Ausente o true = encendido. */
    enabled?: boolean;
  }[];
  /** Texto del menú de métodos de pago que se envía cuando los botones están
   *  APAGADOS (la "cara de texto"). Si está vacío, usa un texto por defecto. */
  payment_text?: string;
  /**
   * LA FRASE QUE ENMARCA UN REENVÍO DE LOS DATOS DE PAGO.
   *
   * Cuando el cliente vuelve a nombrar su método —«yape», «bcp»— ya tiene la
   * cuenta delante. Los datos se le reenvían igual, pero sin la presentación de
   * primera vez y con esta frase por delante: «aquí te los reenvío 😊». Sin
   * ella los datos vuelven a caer a secas y parecen un error del bot; con ella
   * se lee como servicio.
   *
   * Vacía = no sale nada y los datos llegan igual. Nadie se queda sin saber
   * dónde pagar por no haber rellenado una caja.
   */
  payment_resend_steps?: SequenceStep[];
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
    caption_variants?: string[];
    enabled?: boolean;
    /** BURBUJAS EXTRA DE ESTA MISMA MUESTRA. Salen JUSTO DETRÁS del archivo y
     *  antes de la siguiente muestra: son parte de ella, no otra. Vacío = la
     *  muestra es solo su archivo con su pie, como fue siempre. */
    pasos_extra?: SequenceStep[];
    /** ESTA MUESTRA SALE CUANDO PIDEN VER EL DETALLE.
     *
     *  «Info de contenido» guardaba una lista de NOMBRES de tema, suelta, en la
     *  configuración de la modalidad. Desde que las imágenes llegan con el
     *  producto, esa lista se quedaba nombrando las del producto anterior: no
     *  coincidía ninguna y el bot no mandaba nada, sin error y sin aviso.
     *
     *  Marcándolo en la propia imagen, la lista se arma sola con lo que traiga
     *  el producto que esté jugando. Se elige una vez, al cargar el producto. */
    info_de_contenido?: boolean;
  }[];
  /** Cierre editable enviado tras completar las muestras solicitadas. */
  samples_after_sequence?: SequenceStep[];
  /** Burbuja con la que el bot OFRECE enseñar las muestras, al cerrar su
   *  explicación del contenido. Admite variantes `{a|b|c}`. */
  samples_offer_bubble?: string;
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
    caption_variants?: string[];
    enabled?: boolean;
    /** BURBUJAS EXTRA DE ESTA MISMA MUESTRA. Salen JUSTO DETRÁS del archivo y
     *  antes de la siguiente muestra: son parte de ella, no otra. Vacío = la
     *  muestra es solo su archivo con su pie, como fue siempre. */
    pasos_extra?: SequenceStep[];
  }[];
  /** Galería de la opción CONJUNTA (su propia sección, separada del complemento para
   *  que no confunda). El bot la usa igual que las otras (la combina en
   *  getImageGallery). */
  pack_gallery?: {
    topic?: string;
    keywords?: string[];
    when?: string;
    media_type?: "image" | "video" | "document" | "audio";
    drive_url?: string;
    caption?: string;
    caption_variants?: string[];
    enabled?: boolean;
    /** BURBUJAS EXTRA DE ESTA MISMA MUESTRA. Salen JUSTO DETRÁS del archivo y
     *  antes de la siguiente muestra: son parte de ella, no otra. Vacío = la
     *  muestra es solo su archivo con su pie, como fue siempre. */
    pasos_extra?: SequenceStep[];
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
  /**
   * LAS RESPUESTAS DE EMERGENCIA, AHORA EDITABLES DESDE EL PANEL.
   *
   * LO PIDIÓ EL DUEÑO — 29 de septiembre de 2026. Vio una en su prueba, preguntó
   * «¿dónde está esta frase en el editor?» y no estaba: vivían escritas en el
   * código y no había forma de cambiarlas sin tocar un archivo.
   *
   * Son las cuatro frases que el cliente lee cuando el modelo falla. No son
   * comerciales, pero las lee un cliente, así que su sitio es el contenido — es lo
   * que manda CLAUDE.md.
   *
   * VACÍO = LA DE SIEMPRE. Cada una tiene su texto por defecto en el código, y si
   * el campo está vacío sale ése. Son las frases que aparecen justo cuando algo va
   * mal: quedarse mudo aquí sería cambiar un fallo por otro peor.
   */
  emergencia_no_entendi?: string;
  emergencia_respuesta_cortada?: string;
  emergencia_sin_respuesta?: string;
  emergencia_sin_respuesta_con_pago?: string;
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
    caption_variants?: string[];
    enabled?: boolean;
    /** BURBUJAS EXTRA DE ESTA MISMA MUESTRA. Salen JUSTO DETRÁS del archivo y
     *  antes de la siguiente muestra: son parte de ella, no otra. Vacío = la
     *  muestra es solo su archivo con su pie, como fue siempre. */
    pasos_extra?: SequenceStep[];
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
  /**
   * Plantilla del SEGUNDO producto, el que se vende después de entregar.
   *
   * Va aparte por lo mismo que la entrega va aparte: quien compró el extra
   * necesita SU acceso, no otra copia del que ya tiene. Sin esta plantilla, el
   * correo salía con la del primer producto — el enlace equivocado, y encima
   * uno que el cliente ya recibió.
   */
  email_template_upsell?: {
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
    /** false = ignora los bloques sincronizados del Gestor de Ads. */
    registry_sync_enabled?: boolean;
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
      /** URL propia de esta variante. Reemplaza {{ENLACE_ANUNCIO}} al enviar. */
      ad_link?: string;
      /** false = variante APAGADA: el motor no la usa (ni por azar ni por
       *  ad_ids). undefined o true = encendida. */
      enabled?: boolean;
      registry_ad_id?: string;
      registry_ad_key?: string;
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
  /** RESPUESTA A COMENTARIOS DE FACEBOOK (default APAGADA).
   *
   *  Cuando alguien comenta en una publicación de la página, el bot le
   *  responde EN PRIVADO. Ese privado abre el chat de Messenger y a partir de
   *  ahí la conversación sigue el flujo normal del bot.
   *
   *  - Si el comentario coincide con `keywords`, el privado sale al momento.
   *  - Si NO coincide, sale pasadas `delay_no_match_hours` horas (0 = nunca).
   *  - Si tras `abandon_hours` no contestó, la conversación se da por perdida.
   *
   *  Meta solo permite UNA respuesta privada por comentario y dentro de los
   *  7 días, así que el motor nunca reintenta sobre el mismo comentario. */
  comment_automation?: {
    enabled?: boolean;
    /** SWITCH (default APAGADO): responder a CUALQUIER comentario, sin mirar
     *  las palabras clave. Ojo: sin tope por persona esto parece spam, por eso
     *  va de la mano de `one_per_person_hours` y de `skip_after_ignored`. */
    accept_any?: boolean;
    /** Horas durante las que NO se vuelve a escribir a la misma persona,
     *  aunque comente otra vez. 0 = sin tope (un privado por comentario). */
    one_per_person_hours?: number;
    /** SWITCH (default APAGADO): dejar de escribir a quien ya ignoró tantos
     *  privados. Meta no avisa si alguien borra el chat, pero el silencio
     *  sirve igual de señal. */
    skip_after_ignored_enabled?: boolean;
    skip_after_ignored?: number;
    /** Patrón (expresión regular) o lista de palabras separadas por coma. */
    keywords?: string;
    /** Burbujas del privado. Solo viaja la primera de texto (Meta permite una). */
    message_steps?: SequenceStep[];
    /** Texto plano antiguo; se conserva por compatibilidad. */
    message?: string;
    /** Espera para los que NO coinciden, en segundos. 0 = no enviar. */
    delay_no_match_seconds?: number;
    /** Formato antiguo en horas; solo se usa si no hay segundos. */
    delay_no_match_hours?: number;
    /** SWITCH (default APAGADO): a quien no coincide solo se le escribe si ha
     *  comentado `repeat_count` veces. Comentar dos veces ya es interés. */
    repeat_enabled?: boolean;
    repeat_count?: number;
    /** Horas sin respuesta tras las que se da el lead por perdido. */
    abandon_hours?: number;
    /** SWITCH (default APAGADO): pasar la conversación a modo HUMANO si la
     *  persona no responde el privado en `to_human_hours`. Lo decide el
     *  usuario desde el editor; el motor no lo hace por su cuenta. */
    to_human_enabled?: boolean;
    /** Horas sin respuesta antes de pasar a humano. */
    to_human_hours?: number;
  };
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
  /**
   * La llave es CANAL + PRESENTACIÓN, y la presentación no es un adorno.
   *
   * LO QUE PASÓ — 25 de septiembre de 2026. Se hizo que cada conversación
   * recordara con qué presentación empezó, y la primera prueba salió a medias: un
   * cliente que nació con la oferta de dos, con el selector ya apagado, se
   * quedaba sin ella. La causa es que el REPARTO de las cajas —quién ocupa el
   * hueco 1, quién el 2, qué galería se llena— se hace AQUÍ, al cargar, y se
   * guardaba una sola versión para todos. O sea que la presentación no solo se
   * lee: también decide cómo se arma el contenido.
   *
   * Con la presentación en la llave, cada una tiene su versión armada y el
   * cliente ve la suya. Son tres como mucho, y se rehacen solas cuando él guarda.
   */
  byChannel: Partial<Record<string, WorkflowConfig>>;
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

export type ModalidadKey =
  | "lineal"
  | "order_bump"
  | "bioferta"
  | "doble_oferta_dos"
  | "doble_oferta_upsell"
  | "upsell";

/**
 * MODO TESTEADOR — modalidad de UNA conversación del simulador.
 *
 * Sirve para preparar la siguiente tienda mientras el bot sigue vendiendo con
 * la de siempre: en el simulador eliges Doble Oferta y la pruebas, y tus
 * clientas siguen en Order Bump sin enterarse.
 *
 * Va con AsyncLocalStorage, el mismo mecanismo que ya usa el bot para
 * responder por varios números: el valor viaja pegado al procesamiento de ESE
 * mensaje y muere con él. NO es una variable global ni una marca guardada, así
 * que dos conversaciones a la vez —una real y una de prueba— ven cada una la
 * suya y no pueden contaminarse.
 *
 * Fuera del simulador el almacén está vacío y `activeModalityKey` responde
 * exactamente lo que respondía antes, línea por línea.
 */
const modalidadDePrueba = new AsyncLocalStorage<ModalidadKey>();

/** Ejecuta `fn` como si la modalidad activa fuera `modalidad`. Solo simulador. */
export function withModalidadDePrueba<T>(
  modalidad: ModalidadKey | null | undefined,
  fn: () => T
): T {
  if (!modalidad) return fn();
  return modalidadDePrueba.run(modalidad, fn);
}

/** Modalidad forzada por el simulador, o null en una conversación real. */
export function getModalidadDePrueba(): ModalidadKey | null {
  return modalidadDePrueba.getStore() ?? null;
}

function activeModalityKey(config: WorkflowConfig): ModalidadKey {
  // Solo dentro del simulador. Una conversación real nunca entra aquí.
  const delSimulador = modalidadDePrueba.getStore();
  if (delSimulador) return delSimulador;
  // La modalidad Upsell va primero: es la única que vende con el camino de
  // Lineal (un producto, sin elección previa) y luego ofrece el segundo. Si
  // está encendida manda ella, y las demás quedan apagadas por la escalera.
  // Doble Oferta + Upsell va la PRIMERA: es la más específica —vende como la
  // Doble Oferta y además ofrece un tercero— así que si está encendida no hay
  // ninguna otra que pueda describir mejor lo que hace el bot.
  if (config.doble_oferta_upsell?.enabled) return "doble_oferta_upsell";
  // LA MODALIDAD UPSELL TIENE AHORA SU PROPIO INTERRUPTOR.
  //
  // Antes se decidía con `upsell.enabled`, y ese campo ha pasado a significar
  // otra cosa: que la modalidad que se está editando ofrece un segundo producto
  // tras entregar. Con el significado antiguo, encender esa etapa en Lineal
  // habría cambiado la modalidad que vende el bot — dejabas de vender Lineal
  // sin tocar nada más.
  //
  // El `??` es la compatibilidad: un archivo que todavía no tiene el
  // interruptor nuevo sigue decidiéndose con el viejo, así que una instalación
  // que aún no ha guardado vende exactamente lo mismo que antes. En cuanto se
  // guarda una vez, el campo nuevo existe y manda él.
  if (config.upsell_modalidad_enabled ?? config.upsell?.enabled) return "upsell";
  if (config.doble_oferta_dos?.enabled) return "doble_oferta_dos";
  if (config.order_bump?.enabled) return "order_bump";
  if (config.bioferta_doble?.enabled) return "bioferta";
  return "lineal";
}

/**
 * Modalidad ACTIVA — punto único de verdad. Úsalo en vez de repetir la escalera
 * de banderas: así el simulador puede manejar una modalidad mientras las
 * clientas siguen en la de siempre, y la precedencia vive en un solo sitio.
 */
export function getActiveModalityKey(config: WorkflowConfig): ModalidadKey {
  return activeModalityKey(config);
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
  // EL CANAL NO TIENE SALUDO. TIENE CAJONES DE INTRO.
  //
  // AQUÍ SE PERDÍAN NUEVE DE CADA DIEZ BURBUJAS.
  //
  // Esto metía el PRIMER cajón del canal en la casilla de saludo, que por dentro
  // es una caja de UN texto. Entraba su primera burbuja y el resto —el
  // contenido, las fotos, el video, el precio, el cierre— no tenía dónde ir y se
  // descartaba en silencio. Sin error, sin aviso.
  //
  // Y la casilla se vacía a propósito: si quedara con algo, saldría como un
  // mensaje suelto por delante de la intro, que es justo el comportamiento que
  // se está quitando.
  next.greeting = { ...next.greeting, text: "", text_variants: [] };

  // TODOS LOS CAJONES SON INTRO, EMPEZANDO POR EL PRIMERO.
  //
  // Antes la lista empezaba en el SEGUNDO, porque el primero se gastaba en la
  // casilla de saludo. Ahora no hay casilla que alimentar: el cliente escribe y
  // el bot contesta con la intro, entera, desde su primera burbuja.
  const introOnlyGroups = introGroups.filter(
    (group) => group.enabled !== false && hasSendableSteps(group.steps)
  );
  if (introOnlyGroups[0]?.steps) next.intro_sequence = introOnlyGroups[0].steps;
  if (introOnlyGroups[1]?.steps) next.intro_sequence_2 = introOnlyGroups[1].steps;
  if (introOnlyGroups[2]?.steps) next.intro_sequence_3 = introOnlyGroups[2].steps;
  next.intro_extra_sequences = introOnlyGroups.slice(3).map((group) => group.steps ?? []);
  // EL CANAL NO PIDE PRESTADA LA INTRO DE NADIE.
  //
  // Si el canal tiene cajones pero ninguno queda para enviar, antes no se tocaba
  // nada y el motor se iba a buscar la intro a la modalidad. Ahí seguía guardada
  // la de OTRO producto, y salía en su lugar: el cliente recibía el saludo de lo
  // que vendes y la intro de lo que vendías antes.
  //
  // Callar es correcto; hablar del producto equivocado no lo es nunca.
  if (introOnlyGroups.length === 0 && introGroups.length > 0) {
    next.intro_sequence = [];
    next.intro_sequence_2 = [];
    next.intro_sequence_3 = [];
    next.intro_extra_sequences = [];
    next.intro_enabled = [];
    console.warn(
      `[wf] canal ${channel}: no hay ninguna intro encendida con contenido. No se envía intro (no se toma la de la modalidad).`
    );
  }
  if (introOnlyGroups.length > 0) {
    next.intro_enabled = introOnlyGroups.map((group) => group.enabled !== false);
    next.intro_weights = introOnlyGroups.map((group) =>
      typeof group.weight === "number" && Number.isFinite(group.weight) && group.weight > 0
        ? Math.floor(group.weight)
        : 1
    );
    next.intro_skip_ask_name = introOnlyGroups.map(
      (group) => group.skipAskName === true
    );
    next.intro_names = introOnlyGroups.map(
      (group, index) => group.name?.trim() || `Intro ${index + 1}`
    );
    next.intro_ad_names = introOnlyGroups.map((group) => group.adName?.trim() ?? "");
    next.intro_ad_routing_enabled = introOnlyGroups.map(
      (group) => group.adRoutingEnabled !== false
    );
    next.intro_ad_ids = introOnlyGroups.map((group) => [
      group.adId?.trim() ?? "",
      ...(config.ad_registry ?? [])
        .filter((ad) => group.adKeys?.includes(ad.key))
        .flatMap((ad) => ad.ids ?? []),
    ].filter(Boolean).join(" "));
    // LA BANDERA VIAJA POR EL MISMO SITIO QUE LA ETIQUETA DE ANUNCIO.
    //
    // Los cajones del canal se aplanan aquí en listas paralelas, una por dato, y
    // el motor lee esas listas. La bandera se aplana igual: ni un camino nuevo
    // ni una excepción.
    next.intro_paises = introOnlyGroups.map((group) =>
      (group.paises ?? [])
        .map((p) => String(p ?? "").trim().toUpperCase())
        .filter(Boolean)
    );
    // Y LA SEMIMODALIDAD, POR ESE MISMO SITIO. Si no se aplanara aquí, la
    // etiqueta se vería en la pantalla del canal y el motor no la leería nunca:
    // es el fallo de la caja que una parte llena y otra no abre.
    next.intro_semimodalidades = introOnlyGroups.map((group) =>
      String(group.semimodalidad ?? "").trim().toLowerCase()
    );
    // Y LA TIENDA, POR EL MISMO SITIO Y POR EL MISMO MOTIVO. Una etiqueta que se
    // ve en la pantalla y no se aplana aquí es una caja llena que nadie abre.
    next.intro_tiendas = introOnlyGroups.map((group) => tiendasDe(group));
    // Y EL CAMINO, por el mismo carril (18/10/2026). Ver `etiqueta-de-camino.ts`.
    next.intro_caminos = introOnlyGroups.map((group) => caminoDe(group));
    next.intro_pais_routing_enabled = introOnlyGroups.map(
      (group) => group.paisRoutingEnabled !== false
    );
  }

  // LOS SEGUIMIENTOS, POR LA MISMA REGLA.
  //
  // Si el canal tiene su lista de seguimientos, esa manda — aunque esté vacía o
  // con todos apagados. Antes solo se reemplazaba cuando la lista existía, y una
  // lista vacía dejaba pasar los de la modalidad: seguimientos de otro producto
  // persiguiendo a un cliente que nunca los pidió.
  if (Array.isArray(content.followups)) {
    next.followup_sequences = content.followups;
    if (!content.followups.some((seq) => seq?.enabled !== false)) {
      console.warn(
        `[wf] canal ${channel}: ningún seguimiento encendido. No se envía ninguno (no se toman los de la modalidad).`
      );
    }
  }

  // APAGAR EL GRUPO TIENE QUE APAGARLO DE VERDAD.
  //
  // `content.delivery` es el campo de antes de que existieran los grupos. Se
  // dejó como respaldo, y por eso apagar «Entrega pago aprobado» no apagaba
  // nada: caía a ese campo viejo, que sigue guardando la entrega del producto
  // que se vendía entonces. El cliente pagaba su producto nuevo y recibía el
  // enlace del anterior, con el interruptor en OFF.
  //
  // Si este canal ya usa grupos, los grupos son la única verdad. El respaldo se
  // queda solo para los canales que nunca los tuvieron.
  // LA INTRO DE LA OFERTA Y LA DEL UPSELL, SI ESTE CANAL TIENE LAS SUYAS.
  //
  // Mismo trato que la intro y los seguimientos del canal: con cajones escritos
  // aquí mandan éstos, y vacío deja mandar a la modalidad. Solo el CONTENIDO —el
  // interruptor de la oferta y los minutos no son por canal: son la misma venta
  // se entre por donde se entre.
  if ((content.order_bump_intro_groups ?? []).length > 0) {
    next.order_bump = {
      ...next.order_bump,
      intro_groups: content.order_bump_intro_groups,
    } as WorkflowConfig["order_bump"];
  }
  if ((content.upsell_intro_groups ?? []).length > 0 && next.upsell) {
    next.upsell = {
      ...next.upsell,
      intro_groups: content.upsell_intro_groups,
    };
  }

  // Y LA ELECCIÓN CON BOTONES, CAMPO A CAMPO.
  //
  // Campo a campo y no en bloque: escribir solo el texto de la oferta en un
  // canal no puede llevarse por delante las etiquetas de los botones que ese
  // canal no tocó. Cada uno manda por su cuenta, y el que está en blanco deja
  // mandar a la modalidad.
  if (
    typeof content.order_bump_use_buttons === "boolean" ||
    (content.order_bump_choice_prompt ?? "").trim()
  ) {
    next.order_bump = {
      ...next.order_bump,
      ...(typeof content.order_bump_use_buttons === "boolean"
        ? { use_buttons: content.order_bump_use_buttons }
        : {}),
      ...((content.order_bump_choice_prompt ?? "").trim()
        ? { choice_prompt: content.order_bump_choice_prompt }
        : {}),
    } as WorkflowConfig["order_bump"];
  }
  if (next.upsell) {
    next.upsell = {
      ...next.upsell,
      ...((content.upsell_pregunta_steps ?? []).length > 0
        ? { pregunta_steps: content.upsell_pregunta_steps }
        : {}),
      ...(typeof content.upsell_use_buttons === "boolean"
        ? { use_buttons: content.upsell_use_buttons }
        : {}),
      ...((content.upsell_boton_si ?? "").trim()
        ? { boton_si: content.upsell_boton_si }
        : {}),
      ...((content.upsell_boton_no ?? "").trim()
        ? { boton_no: content.upsell_boton_no }
        : {}),
      ...((content.upsell_respuesta_rechazo ?? "").trim()
        ? { respuesta_rechazo: content.upsell_respuesta_rechazo }
        : {}),
    };
  }

  // Y TODO ESO, TAMBIÉN EN LA CAJA QUE LEE DOBLE OFERTA + UPSELL.
  //
  // LO QUE COSTÓ — 15 de septiembre de 2026. El dueño duplicó el cajón del
  // upsell en Canales, editó la copia, apagó el original… y a sus tres clientes
  // de prueba les llegó el texto del APAGADO. Con sus palabras: «lo que llegó en
  // las pruebas fue el contenido del cajón apagado».
  //
  // No lo eligió el sorteo: NINGUNO de los dos cajones se miró. Todo lo de
  // arriba se escribe en `next.upsell`, y esa modalidad lee su PROPIA caja
  // —`seccionUpsell` tiene una línea que se sale del camino común—. Al no
  // encontrar cajones, el motor caía al respaldo `intro`, que es de donde el
  // cajón apagado se había sembrado al abrir la pantalla por primera vez. Padre
  // e hijo dicen lo mismo, y por eso parecía que salía el apagado.
  //
  //     canal whatsapp / DOU  upsell_intro_groups     = 2 cajones
  //     doble_oferta_upsell.upsell.intro_groups       = 0
  //     doble_oferta_upsell.upsell.intro              = 5 burbujas  ← salía esto
  //
  // Es la misma familia que el nombre y el precio del upsell de esta madrugada:
  // se arregló el reparto de productos y la capa del CANAL se quedó fuera. Por
  // eso va aquí pegado, para que no se vuelvan a separar.
  //
  // Se copia lo que ya se calculó arriba, campo a campo y solo si el canal
  // opinó: una clave ausente sigue significando «manda la modalidad».
  // Y LA OFERTA DE ESA MISMA MODALIDAD, QUE TIENE EL HUECO IDÉNTICO.
  //
  // `getActiveTwoTierOffer` devuelve `cfg.doble_oferta_upsell` cuando es la que
  // vende, así que sus cajones y su pregunta con botones se leen de ahí — no de
  // `cfg.order_bump`, que es donde los escribe la rama de arriba. Mismo fallo,
  // misma cura, y en el mismo sitio para que se vean juntos.
  if (next.doble_oferta_upsell && next.order_bump) {
    const deLaOferta = next.order_bump as NonNullable<
      WorkflowConfig["order_bump"]
    >;
    next.doble_oferta_upsell = {
      ...next.doble_oferta_upsell,
      ...((content.order_bump_intro_groups ?? []).length > 0
        ? { intro_groups: deLaOferta.intro_groups }
        : {}),
      ...(typeof content.order_bump_use_buttons === "boolean"
        ? { use_buttons: deLaOferta.use_buttons }
        : {}),
      ...((content.order_bump_choice_prompt ?? "").trim()
        ? { choice_prompt: deLaOferta.choice_prompt }
        : {}),
    };
  }
  if (next.doble_oferta_upsell?.upsell && next.upsell) {
    const suyo = next.upsell;
    next.doble_oferta_upsell = {
      ...next.doble_oferta_upsell,
      upsell: {
        ...next.doble_oferta_upsell.upsell,
        ...((content.upsell_intro_groups ?? []).length > 0
          ? { intro_groups: suyo.intro_groups }
          : {}),
        ...((content.upsell_pregunta_steps ?? []).length > 0
          ? { pregunta_steps: suyo.pregunta_steps }
          : {}),
        ...(typeof content.upsell_use_buttons === "boolean"
          ? { use_buttons: suyo.use_buttons }
          : {}),
        ...((content.upsell_boton_si ?? "").trim()
          ? { boton_si: suyo.boton_si }
          : {}),
        ...((content.upsell_boton_no ?? "").trim()
          ? { boton_no: suyo.boton_no }
          : {}),
        ...((content.upsell_respuesta_rechazo ?? "").trim()
          ? { respuesta_rechazo: suyo.respuesta_rechazo }
          : {}),
      },
    };
  }

  const usaGrupos =
    Array.isArray(content.delivery_groups) && content.delivery_groups.length > 0;
  const centralDelivery =
    deliveryGroupSteps(content, "central") ??
    (usaGrupos ? undefined : content.delivery);
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
  } else if (mode === "doble_oferta_upsell" && next.doble_oferta_upsell) {
    // Las TRES entregas de esta modalidad, por canal.
    //
    // Sin esta rama, las tres cajas se veían en Canales y no servían de nada:
    // lo que se escribiera ahí no llegaba al motor y se entregaba lo de
    // siempre. Peor que no tenerlas, porque parecían configuradas.
    //
    // Las dos primeras usan las MISMAS claves que la Doble Oferta de 2
    // productos porque comparten el editor; la tercera usa "upsell", igual que
    // la modalidad Upsell. Ninguna se pisa: cada modalidad lee su propio canal.
    next.doble_oferta_upsell = {
      ...next.doble_oferta_upsell,
      combo: {
        ...(next.doble_oferta_upsell.combo ?? {}),
        delivery:
          deliveryGroupSteps(content, "doble_oferta_dos_combo") ??
          next.doble_oferta_upsell.combo?.delivery,
      },
      basico: {
        ...(next.doble_oferta_upsell.basico ?? {}),
        delivery:
          deliveryGroupSteps(content, "doble_oferta_dos_basico") ??
          next.doble_oferta_upsell.basico?.delivery,
      },
      upsell: {
        ...(next.doble_oferta_upsell.upsell ?? {}),
        delivery:
          deliveryGroupSteps(content, "upsell") ??
          next.doble_oferta_upsell.upsell?.delivery,
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
  } else if (mode === "upsell" && next.upsell) {
    // El primer producto se entrega por el camino central (arriba). Aquí solo
    // la entrega del SEGUNDO, que es lo propio de esta modalidad.
    next.upsell = {
      ...next.upsell,
      delivery: deliveryGroupSteps(content, "upsell") ?? next.upsell.delivery,
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

  // LA ENTREGA DEL SEGUNDO PRODUCTO, EN TODAS LAS MODALIDADES.
  //
  // El grupo «upsell» de cada canal solo se aplicaba dentro de las ramas de
  // Doble Oferta + Upsell y de la modalidad Upsell — las dos únicas que podían
  // tener etapa. Ahora la puede tener cualquiera, y sin esto el canal se
  // quedaría a medias: el bot ofrecería el extra y lo cobraría, pero al
  // entregarlo ignoraría lo que el operador escribió en ese canal.
  //
  // Va FUERA de la escalera de arriba a propósito. Metido dentro habría que
  // repetirlo en cada rama, y el día que se añada una modalidad se olvidaría en
  // la nueva — que es exactamente cómo se rompen las tuberías por un lado.
  // Y SOLO SI EL CANAL TIENE ALGO QUE MANDAR.
  //
  // `deliveryGroupSteps` devuelve los pasos del grupo, y un grupo recién
  // aparecido los tiene VACÍOS. Un array vacío es "verdadero" en JavaScript, así
  // que pisaba la entrega escrita en la pestaña Upsell con nada — y sin entrega
  // el segundo producto deja de ofrecerse (isUpsellUsable la exige). Se apagaba
  // solo, sin que nada avisara.
  //
  // Y pasa justo aquí porque esta caja es NUEVA: en las modalidades que antes no
  // podían tener etapa, la caja aparece sola la primera vez que se abre Canales
  // —vacía, porque nunca se llenó—. Vacía significa "este canal no aporta nada
  // propio", no "no entregues nada".
  const entregaDelUpsellDelCanal = deliveryGroupSteps(content, "upsell");
  if (hasSendableSteps(entregaDelUpsellDelCanal) && next.upsell) {
    next.upsell = { ...next.upsell, delivery: entregaDelUpsellDelCanal };
  }

  return next;
}

/**
 * DÓNDE VA EL CONTENIDO DE CADA PUESTO, SEGÚN LA MODALIDAD.
 *
 * Los campos del contenido —nombre, qué incluye, galería— están CRUZADOS entre
 * modalidades, y no por descuido: en Order Bump el «producto 1» del archivo es
 * el BÁSICO, y en Doble Oferta + Upsell es el FULL. Leer uno por otro pone el
 * nombre del full en la caja del básico, y quien llene esa caja guiándose por
 * el nombre mete el enlace equivocado. Eso pasó de verdad.
 *
 * `1` = el trío `product_name` / `course_content` / `image_gallery`.
 * `2` = el trío `product_name_2` / `course_content_2` / `image_gallery_2`.
 */
const CONTENIDO_DEL_PUESTO: Record<
  string,
  Partial<Record<PuestoDeProducto, 1 | 2>>
> = {
  lineal: { unico: 1 },
  upsell: { unico: 1 },
  order_bump: { basico: 1, complementario: 2 },
  // DOBLE OFERTA 2 PRODUCTOS VA COMO «+ UPSELL», NO COMO ORDER BUMP.
  //
  // Estaba al revés y es de los errores que no avisan. Su «Producto 1» es la
  // opción CARA: la pestaña lo dice —«aquí la 1 es sencillamente el producto más
  // caro»— y el motor lo confirma en `conLosNombresDelContenido`, donde el combo
  // se cae a `product_name` cuando no tiene nombre propio.
  //
  // Cruzado, el nombre del full salía en la caja del básico. Quien llenara esa
  // caja guiándose por el nombre metía el enlace equivocado.
  doble_oferta_dos: { full: 1, basico: 2 },
  doble_oferta_upsell: { full: 1, basico: 2 },
  bioferta: { basico: 1, complementario: 2 },
};

/**
 * CAMBIAR DE MODALIDAD SIN CAMBIAR DE CONTENIDO.
 *
 * QUÉ PROBLEMA RESUELVE, con las palabras del dueño (22/09/2026):
 *
 *   «Al cambiar de modalidad en BOT ACTIVO, el texto de lineal se cambia por el
 *   que está en la otra modalidad, por ende no puedo encontrar un cambio de
 *   modalidad que me permita continuar vendiendo.»
 *
 * El selector de BOT ACTIVO cambia QUÉ CONTENIDO vende el bot: cada modalidad
 * tiene sus cajas, su alineación y sus textos de pago, así que moverlo es
 * empezar una venta distinta. Lo que él necesita es lo contrario: seguir
 * vendiendo LO MISMO y cambiar solo la FORMA de presentarlo.
 *
 * Eso es esto. La modalidad activa no se mueve —sigue siendo la suya, con sus
 * cajas y sus textos— y solo toma PRESTADA la presentación de dos opciones:
 *
 *   · «dos_juntas»      las dos se presentan en la intro y el cliente elige
 *                       (es lo que hace Doble Oferta)
 *   · «segunda_oculta»  se presenta una y la segunda se revela al querer pagar
 *                       (es lo que hace Order Bump)
 *
 * TRES COSAS QUE LA MANTIENEN QUIETA, y son las que hacen que no rompa nada:
 *
 *   1. VACÍO = COMO HOY. Sin el campo, o con cualquier otro valor, esto
 *      devuelve null y no se mira en ninguna parte.
 *   2. NO SE PRESTA A QUIEN YA TIENE. Una modalidad cuya tabla ya reparte un
 *      hueco 2 vende dos opciones por su cuenta: ahí esto no entra, para que
 *      -OB- y -DOU- sigan comportándose exactamente igual que siempre.
 *   3. SOLO A LA QUE VENDE. Las demás modalidades se quedan escritas y calladas,
 *      igual que con la alineación.
 *
 * Y NO TRAE CONTENIDO DE OTRA MODALIDAD: lo prestado es la FORMA —cuántos
 * puestos hay y qué hueco ocupa cada uno—, nunca los textos ni los productos de
 * la otra. Las modalidades siguen siendo herméticas.
 */
export type SegundaOpcionPrestada = "dos_juntas" | "segunda_oculta";

/**
 * LA PRESENTACIÓN DE **ESTA** CONVERSACIÓN, MIENTRAS SE ATIENDE SU TURNO.
 *
 * POR QUÉ EXISTE. El dueño mueve el selector «PRESENTA:» cuando quiere, también
 * con clientes a media conversación. Sin esto, al cambiarlo, alguien a quien se
 * le presentó UN producto y se le dio SU precio pasaba de golpe a una venta de
 * dos opciones: el bot le contradecía lo que acababa de decirle. Con sus
 * palabras: «debe estar preparado para el cambio sin romperse».
 *
 * ES EL MISMO MECANISMO DEL SIMULADOR —`modalidadDePrueba`, unas líneas más
 * arriba— y por la misma razón: hay varias conversaciones a la vez y cada una
 * tiene que ver la suya sin contaminar a las demás. No se inventa una tubería
 * nueva; se copia la que ya lleva semanas funcionando.
 *
 * VACÍO = SE LEE EL SELECTOR DE HOY, que es el comportamiento anterior letra por
 * letra. Eso hace que el peor fallo posible de este cambio sea «se comporta como
 * antes», nunca «se rompe»: si un camino se olvidara de abrir el almacén, esa
 * conversación seguiría vendiendo como hasta hoy.
 */
const presentacionDeLaConversacion = new AsyncLocalStorage<
  SegundaOpcionPrestada | "ninguna"
>();

/** Atiende `fn` como si la presentación fuera la de ESA conversación. */
export function conLaPresentacionDeLaConversacion<T>(
  presentacion: SegundaOpcionPrestada | "ninguna" | null | undefined,
  fn: () => T
): T {
  if (!presentacion) return fn();
  return presentacionDeLaConversacion.run(presentacion, fn);
}

/**
 * LA TIENDA QUE ATIENDE ESTE TURNO.
 *
 * SE RESUELVE UNA SOLA VEZ, al empezar el turno, y el resto del motor sigue
 * leyendo como hoy. Es a propósito y es lo que evita el fallo que este proyecto
 * ya pagó tres veces: meter «¿de qué tienda es?» en los cien sitios que leen la
 * configuración habría multiplicado las cajas que uno llena y otro no abre.
 *
 * Es el MISMO mecanismo que ya llevan la modalidad del simulador y la
 * presentación de la conversación. Copiado, no inventado.
 */
const tiendaDelTurno = new AsyncLocalStorage<Tienda>();

/** Atiende `fn` como si mandara ESA tienda. Sin tienda no envuelve nada, así que
 *  el camino queda idéntico al de hoy. */
export function conLaTiendaDelTurno<T>(
  tienda: Tienda | null | undefined,
  fn: () => T
): T {
  if (!tienda) return fn();
  return tiendaDelTurno.run(tienda, fn);
}

/** La tienda de este turno, o null si no hay ninguna (todo como hoy). */
export function laTiendaDelTurno(): Tienda | null {
  return tiendaDelTurno.getStore() ?? null;
}

/**
 * DE QUÉ CONVERSACIÓN ES ESTE TURNO — para los upsells en fila.
 *
 * `seccionUpsell` es la puerta por la que el motor pregunta «¿cuál es el upsell?» en unos
 * setenta sitios, casi todos sin la conversación a mano. Con esto, la puerta sabe de quién
 * es el turno y contesta con el producto de la fila que le toca a ESE cliente. El mismo
 * mecanismo que la tienda y la presentación.
 *
 * Solo guarda el número de la conversación, no su puesto: el puesto se lee de la base de
 * datos cada vez, porque cambia a mitad de turno (al terminar una entrega se pasa al
 * siguiente) y una copia guardada al empezar contestaría con el de antes.
 *
 * SIN ALMACÉN, O CON EL PUESTO VACÍO, la puerta contesta lo de siempre, letra por letra.
 */
const conversacionDeLaFila = new AsyncLocalStorage<number>();

export function conLaFilaDe<T>(
  conversationId: number | null | undefined,
  fn: () => T
): T {
  if (!conversationId || conversacionDeLaFila.getStore() === conversationId) {
    return fn();
  }
  return conversacionDeLaFila.run(conversationId, fn);
}

/** De qué conversación es el turno, para la fila; null si nadie lo anotó. */
export function laConversacionDeLaFila(): number | null {
  return conversacionDeLaFila.getStore() ?? null;
}

/**
 * EL SELECTOR QUE MANDA EN ESTE TURNO: el de la tienda, o el global.
 *
 * Es la ÚNICA puerta por la que se lee la semimodalidad, y por eso la tienda no
 * puede filtrarse a otra: quien pregunta no sabe si la respuesta vino de una
 * tienda o del selector de siempre.
 *
 * SIN TIENDA DEVUELVE EL GLOBAL, letra por letra. El peor fallo posible de esto
 * es «se comporta como antes», nunca «se rompe».
 */
function elSelectorQueManda(
  config: WorkflowConfig | null | undefined
): "dos_juntas" | "segunda_oculta" | undefined {
  const suya = tiendaDelTurno.getStore();
  if (suya) {
    // «» es una respuesta, no un hueco: esta tienda vende «como hoy».
    const v = suya.semimodalidad;
    return v === "dos_juntas" || v === "segunda_oculta" ? v : undefined;
  }
  return config?.segunda_opcion_prestada;
}

/**
 * EL TURNO DE ESTA CONVERSACIÓN, CON TODO LO QUE LE PERTENECE.
 *
 * Abre de una vez las dos cosas que ya se abrían por separado —su tienda y su
 * presentación— para que quien atiende un mensaje llame a UNA función y no tenga
 * que acordarse de anidarlas en el orden correcto.
 *
 * EL ORDEN IMPORTA Y ESTÁ FIJADO AQUÍ: primero la tienda, porque de ella sale el
 * selector; dentro, la presentación de la conversación, que es la que manda
 * sobre el selector para quien ya empezó a comprar. Al revés, un cliente que
 * empezó viendo un producto vería dos al cambiar la tienda de semimodalidad.
 *
 * SIN TIENDA Y SIN PRESENTACIÓN no envuelve nada: el camino queda idéntico al de
 * hoy, que es la garantía de todo este trabajo.
 */
export function conElTurnoDe<T>(
  convo:
    | {
        id?: number | null;
        wa_phone_number_id?: string | null;
        messenger_page_id?: string | null;
        presentacion_de_venta?: string | null;
        tienda_id?: string | null;
      }
    | null
    | undefined,
  fn: () => T
): T {
  // Y SU PUESTO EN LA FILA DE UPSELLS. Por fuera de las otras dos y sin tocarlas: solo
  // anota de qué conversación es el turno. Sin fila puesta no cambia nada.
  if (convo?.id) return conLaFilaDe(convo.id, () => conElTurnoDeSinFila(convo, fn));
  return conElTurnoDeSinFila(convo, fn);
}

function conElTurnoDeSinFila<T>(
  convo:
    | {
        wa_phone_number_id?: string | null;
        messenger_page_id?: string | null;
        presentacion_de_venta?: string | null;
        tienda_id?: string | null;
      }
    | null
    | undefined,
  fn: () => T
): T {
  // LA TIENDA SE BUSCA POR EL NÚMERO Y, SI NO, POR LA PÁGINA.
  //
  // En WhatsApp hay número; en Messenger hay página. Una conversación tiene uno de
  // los dos, nunca los dos, así que no compiten — pero el orden está escrito a
  // propósito: el número primero, porque es el camino que ya estaba probado.
  //
  // SIN NINGUNO DE LOS DOS no hay tienda, y el camino queda idéntico al de hoy.
  // PRIMERO LA ANOTADA POR SU FRASE DE ENTRADA, si la hay y sigue valiendo. Sin frases
  // puestas no hay ninguna anotada y esta línea es la de siempre. Ver `tiendaAnotada`.
  const suya =
    tiendaAnotada(convo) ??
    tiendaDelNumero(convo?.wa_phone_number_id) ??
    tiendaDeLaPagina(convo?.messenger_page_id);
  return conLaTiendaDelTurno(suya, () =>
    conLaPresentacionDeLaConversacion(
      (convo?.presentacion_de_venta as SegundaOpcionPrestada | "ninguna") ?? null,
      fn
    )
  );
}

/**
 * QUÉ TIENDA ATIENDE ESE NÚMERO.
 *
 * Sin número, sin tiendas, o sin ninguna que lo lleve, devuelve null — y quien
 * llama sigue con la configuración de siempre.
 *
 * UNA TIENDA APAGADA NO ATIENDE, aunque tenga el número puesto: es el interruptor
 * para dejarla preparada sin que entre a vender.
 */
export function tiendaDelNumero(
  numero: string | null | undefined,
  config?: WorkflowConfig | null
): Tienda | null {
  const suyo = String(numero ?? "").trim();
  if (!suyo) return null;
  const cfg = config ?? loadWorkflowConfig();
  const tiendas = cfg?.tiendas;
  if (!Array.isArray(tiendas)) return null;
  const delNumero = tiendas.filter(
    (t) => t?.enabled !== false && String(t?.numero ?? "").trim() === suyo
  );
  // UN NÚMERO, UNA TIENDA: la de siempre, tal cual.
  if (delNumero.length <= 1) return delNumero[0] ?? null;
  // VARIAS TIENDAS EN EL MISMO NÚMERO (frases de entrada, 12/10/2026): sin frase que la
  // elija, atiende la que NO tiene frases —la de por defecto—. Sin frases en ninguna, es la
  // primera, que es lo que devolvía esto antes.
  return delNumero.find((t) => frasesDeEntrada(t).length === 0) ?? delNumero[0];
}

/**
 * ¿EL MENSAJE ELIGE UNA TIENDA DE ESTE NÚMERO POR SU FRASE DE ENTRADA?
 *
 * Lo pidió el dueño el 12/10/2026 para que un número atienda varias tiendas, una por campaña.
 * Ver `Tienda.frases_de_entrada`.
 *
 * SOLO ENTRE LAS TIENDAS DE ESTE NÚMERO: la frase de una tienda de otro número no puede
 * llevarse a este cliente. La frase va entera y como palabras completas, en cualquier parte
 * del mensaje («super pack mascotas» contiene «pack mascotas»). Si coinciden dos tiendas,
 * gana la frase más larga, que es la más precisa; si empatan, la primera de la lista.
 *
 * Sin frases puestas en ninguna tienda de ese número, devuelve null: nada cambia.
 */
export function tiendaPorFraseDeEntrada(
  mensaje: string | null | undefined,
  numero: string | null | undefined,
  config?: WorkflowConfig | null
): Tienda | null {
  const suyo = String(numero ?? "").trim();
  const texto = paraCompararFrase(mensaje ?? "");
  if (!suyo || !texto) return null;
  const cfg = config ?? loadWorkflowConfig();
  const tiendas = Array.isArray(cfg?.tiendas) ? cfg!.tiendas : [];
  let mejor: { tienda: Tienda; largo: number } | null = null;
  for (const t of tiendas) {
    if (!t || t.enabled === false || String(t.numero ?? "").trim() !== suyo) continue;
    for (const frase of frasesDeEntrada(t)) {
      if (!` ${texto} `.includes(` ${frase} `)) continue;
      if (!mejor || frase.length > mejor.largo) mejor = { tienda: t, largo: frase.length };
    }
  }
  return mejor?.tienda ?? null;
}

/**
 * LA TIENDA ANOTADA EN LA CONVERSACIÓN POR SU FRASE DE ENTRADA, si sigue valiendo.
 *
 * Deja de valer —y la tienda vuelve a elegirse por el número, como siempre— si la tienda
 * ya no existe, está apagada, o el cliente escribe ahora por OTRO número nuestro: una
 * tienda nunca atiende un número que no es el suyo.
 */
function tiendaAnotada(
  convo:
    | { tienda_id?: string | null; wa_phone_number_id?: string | null }
    | null
    | undefined,
  config?: WorkflowConfig | null
): Tienda | null {
  const id = String(convo?.tienda_id ?? "").trim();
  if (!id) return null;
  const cfg = config ?? loadWorkflowConfig();
  const tienda = (cfg?.tiendas ?? []).find(
    (t) => t?.enabled !== false && String(t?.id ?? "").trim() === id
  );
  if (!tienda) return null;
  const numero = String(convo?.wa_phone_number_id ?? "").trim();
  if (numero && String(tienda.numero ?? "").trim() !== numero) return null;
  return tienda;
}

/**
 * QUÉ TIENDA ATIENDE ESA PÁGINA DE FACEBOOK.
 *
 * El gemelo del de arriba, para Messenger. Mismas reglas: sin página, sin tiendas,
 * o sin ninguna que la lleve, devuelve null y quien llama sigue con la configuración
 * de siempre. Y una tienda apagada no atiende aunque tenga la página puesta.
 *
 * SE BUSCA POR SEPARADO Y NO SE MEZCLAN LAS LLAVES: un `phone_number_id` y un
 * `page_id` son dos números largos de Meta y nada impide que coincidan. Comparar
 * contra las dos a la vez sería dejar que una página abra la tienda de un número.
 */
export function tiendaDeLaPagina(
  pagina: string | null | undefined,
  config?: WorkflowConfig | null
): Tienda | null {
  const suya = String(pagina ?? "").trim();
  if (!suya) return null;
  const cfg = config ?? loadWorkflowConfig();
  const tiendas = cfg?.tiendas;
  if (!Array.isArray(tiendas)) return null;
  return (
    tiendas.find(
      (t) => t?.enabled !== false && String(t?.pagina ?? "").trim() === suya
    ) ?? null
  );
}

/**
 * LA PRESENTACIÓN QUE DICE EL SELECTOR HOY, sin mirar ninguna conversación.
 *
 * Es lo que hacía `segundaOpcionPrestada` antes de que las conversaciones
 * tuvieran la suya, y se usa para DOS cosas: anotarla cuando una conversación
 * nace, y responder a las que nacieron antes de que esto existiera.
 */
export function laPresentacionQueDiceElSelector(
  config: WorkflowConfig | null | undefined
): SegundaOpcionPrestada | null {
  if (!config) return null;
  const valor = elSelectorQueManda(config);
  if (valor !== "dos_juntas" && valor !== "segunda_oculta") return null;
  // La que ya vende dos por su cuenta no toma nada prestado.
  const propia = CONTENIDO_DEL_PUESTO[activeModalityKey(config)] ?? {};
  if (Object.values(propia).includes(2)) return null;
  return valor;
}

/**
 * LAS TRES FORMAS DE VENDER DENTRO DE LINEAL. Él las llama SEMIMODALIDADES,
 * para no confundirlas con las MODALIDADES (Lineal, Doble Oferta + Upsell,
 * Order Bump…). Con sus palabras, del 30/09/2026:
 *
 *   «le digo semimodalidad a las que funcionan en el modo lineal, como son
 *    COMOHOY, COMO DOU, COMO OB».
 */
// El tipo tambien sale del archivo suelto, para que no haya dos definiciones que puedan
// separarse. Se reexporta igual que las funciones.
export type { Semimodalidad };

/**
 * UNA TIENDA: la venta propia de un número de WhatsApp.
 *
 * LO PIDIÓ EL DUEÑO el 30/09/2026: vender con varios números —«no solo con 1 o
 * 2, sino con los 20 que permite Meta»— sin duplicar el proyecto y «sin que se
 * filtren cosas de un lado a otro».
 *
 * SE IDENTIFICA POR NOMBRE, NO POR NÚMERO, y lo eligió él: quiere poder llamarla
 * como al producto que esté vendiendo ese día. El número se le asigna dentro.
 * Así una tienda sobrevive a que Meta le cambie o le tumbe un número, y se puede
 * dejar preparada SIN número hasta el día que se active.
 *
 * NO ES UNA CAPA QUE HEREDA. La tienda no «tapa» la configuración global campo a
 * campo —eso es justo lo que en este proyecto ha dejado cajas a medio llenar tres
 * veces—: SUSTITUYE dos cosas concretas, el selector de semimodalidad y la
 * alineación de productos, y el resto del motor no sabe que existe.
 *
 * SIN TIENDA QUE LLEVE ESE NÚMERO, TODO COMO HOY. Es la garantía de que subir
 * esto no mueve el bot que ya vende: hasta que no haya una tienda con su número
 * escrito, no hay nada que repartir.
 */
/**
 * UN USUARIO QUE COBRA — el almacén de cobradores.
 *
 * LO PIDIÓ EL DUEÑO el 30/09/2026, con sus palabras: «la segunda cuenta es para
 * que cobre otra persona, en vez de Alberto pongo otra persona… voy a usar quizás
 * un nombre de receptor en un número de whatsapp y otro en otro número». Y: «sería
 * genial que el usuario también pueda ser elegido en los demás».
 *
 * ── POR QUÉ UN ALMACÉN Y NO UNA CAPA MÁS ─────────────────────────────────
 *
 * Él lo preguntó directamente —«¿será mejor en capas o no?»— y la respuesta es
 * almacén, por tres motivos:
 *
 *   1. LAS CAPAS YA COSTARON TRES VECES aquí. Es el fallo número uno de este
 *      proyecto: «la caja que una modalidad llena y otra no abre se ve igual que
 *      una caja vacía, y nadie avisa». Ya hay capa de país y de modalidad; una
 *      cuarta multiplica las cajas que nadie abre.
 *   2. UN COBRADOR NO ES UNA VARIANTE DE UN PAÍS: es una cosa que existe sola. La
 *      misma persona cobra en Perú y en Argentina. En capas habría que escribirla
 *      dos veces y el día que cambie su cuenta se arregla una y se olvida la otra
 *      — exactamente lo que ya pasó con los cajones de pago, y por lo que el
 *      número se sacó a un comodín (ver `numero_de_cuenta`).
 *   3. EL ALMACÉN YA FUNCIONA DOS VECES en este proyecto: la biblioteca de
 *      productos y la etiqueta de tienda. Es un patrón que él sabe usar.
 *
 * ── EL PAÍS VIVE DENTRO, Y ESO NO ES UNA CAPA ────────────────────────────
 *
 * Un cobrador tiene una cuenta por cada país donde cobra: su Yape en Perú, lo suyo
 * en Argentina. Eso no es herencia, es la forma de la cosa. Y un país que no esté
 * escrito NO es un hueco que se rellene con el del vecino: cae al del país, que es
 * lo de siempre, y la pantalla lo avisa.
 */
export interface Cobrador {
  /** Identificador estable. NO es el nombre: renombrarlo no lo convierte en otro. */
  id: string;
  /** Como lo llama él. Sale en la pantalla, nunca al cliente. */
  nombre?: string;
  /**
   * SU FOTO, SOLO PARA LA PANTALLA. Nunca viaja al cliente.
   *
   * LO PIDIÓ EL DUEÑO el 02/10/2026: «necesito que haya un lugar donde yo pueda poner
   * una foto imagen y que aparezca ahí, y si no hay foto que aparezca la silueta».
   *
   * PARA QUÉ SIRVE DE VERDAD: con varias tiendas y varios cobradores, el selector de
   * «quién cobra» es una lista de nombres parecidos. Una cara se reconoce de un golpe y
   * un nombre hay que leerlo — y elegir al cobrador equivocado manda al cliente a pagar
   * a otra persona. Esta semana ya confundió a dos.
   *
   * Es una URL, igual que el resto de las imágenes del proyecto. Vacío = la silueta.
   */
  foto?: string;
  /** Sus datos de cobro, por país. Un país ausente cae al perfil del país. */
  por_pais?: Partial<
    Record<
      CountryCode,
      {
        /** EL QUE APRUEBA EL COMPROBANTE. Mismo dato que
         *  `yape_recipient_name_starts_with`, y por eso el que se nombra en los
         *  mensajes sale de aquí también: el bot no puede mandar a pagar a un
         *  nombre y esperar otro. */
        titular?: string;
        /** El que sale con {{NUMERO_DE_CUENTA}}. Solo texto, no valida nada.
         *  Es el respaldo: si este usuario tiene varias cuentas, van en
         *  `cuentas_por_metodo` y ésta se usa cuando el método no está. */
        numero_de_cuenta?: string;
        /** SUS CUENTAS, UNA POR MÉTODO. Misma idea que en el perfil del país:
         *  en un país se cobra por billetera Y por banco, y son cuentas
         *  distintas. La clave es el método, el que él escribe en sus botones. */
        cuentas_por_metodo?: Record<string, string>;
        /**
         * LOS MÉTODOS POR LOS QUE ESTA PERSONA NO COBRA.
         *
         * LO PIDIÓ EL DUEÑO el 01/10/2026, y vio un fallo de diseño real: «habrá
         * veces que Melissa no tenga todos los métodos de pago, si se va a
         * reemplazar con mis datos es un error, necesito que los métodos de pago
         * de otro usuario que cobra pueda apagarse».
         *
         * TENÍA RAZÓN. Sin esto, un método que ella no tiene heredaba la cuenta
         * DEL DUEÑO: el cliente pagaba a la cuenta de él, el comprobante salía a
         * nombre de él, y el bot —que esperaba el de ella— lo RECHAZABA. Pago
         * bueno, comprobante rechazado, y el dinero en la cuenta equivocada. Es
         * exactamente el fallo que la puerta única existe para impedir.
         *
         * APAGADO HACE DOS COSAS, y las dos hacen falta:
         *   1. el método NO SE LE OFRECE al cliente en la tienda de esa persona
         *      —ni como botón ni reconociéndolo si lo escribe—
         *   2. y si por algún camino se eligiera, NO se hereda la cuenta del
         *      dueño: antes un número visiblemente vacío que un cobro invisible
         *      en la cuenta de otro
         *
         * Vacío = cobra por todos, que es como estaba antes de existir esto.
         */
        metodos_apagados?: string[];
        /** El de {{NOMBRE_COMPLETO}}, libre. Vacío usa el del titular. */
        nombre_completo?: string;
      }
    >
  >;
}

export interface Tienda {
  /** Identificador estable. NO es el nombre: renombrarla no la convierte en otra. */
  id: string;
  /** Como la llama él. Sale en la pantalla, nunca al cliente. */
  nombre?: string;
  /**
   * SU COLOR EN LA PANTALLA. Vacío = el turquesa de siempre.
   *
   * NUNCA VIAJA AL CLIENTE, igual que `nombre` y que el retrato del cobrador: el
   * motor no lo lee, solo lo transporta para que el editor lo pinte en las
   * fachadas. Lo pidió el dueño el 05/10/2026, porque con varias tiendas todas
   * las etiquetas se veían del mismo color y no distinguía cuál era cuál.
   */
  color?: string;
  /** El `phone_number_id` de Meta que atiende esta tienda. VACÍO = preparada
   *  pero sin vender todavía: no la elige nadie. */
  numero?: string;
  /**
   * LAS FRASES DE ENTRADA — para que UN número atienda VARIAS tiendas. Opcional.
   *
   * LO PIDIÓ EL DUEÑO el 12/10/2026: «necesito que un solo número pueda atender a más de 2
   * tiendas… crearía 3 campañas con el mismo número, pero en cada campaña a WhatsApp
   * cambiaría la frase de entrada», y que «la palabra clave es opcional».
   *
   * Si el PRIMER mensaje del cliente —mientras la conversación es nueva— contiene una de
   * estas frases, la conversación queda anotada en esta tienda para siempre. Da igual
   * mayúsculas, tildes y signos, y la frase puede ir en cualquier parte del mensaje. Ver
   * `tiendaPorFraseDeEntrada`.
   *
   * VACÍO = como siempre: la tienda se elige por el número. Entre varias tiendas del mismo
   * número, la que NO tiene frases es la de por defecto (`tiendaDelNumero`).
   */
  frases_de_entrada?: string[];
  /**
   * SU PÁGINA DE FACEBOOK, para que Messenger venda lo mismo que su WhatsApp.
   *
   * LO PIDIÓ EL DUEÑO el 01/10/2026, con un ejemplo de tres páginas vendiendo cada
   * una un producto distinto, las tres por WhatsApp Y por Messenger. (Sus nombres de
   * producto no se escriben aquí: es una plantilla, y el que lea esto mañana creería
   * que el bot los conoce.)
   *
   * SIN ESTO, un cliente de Messenger no encontraba NINGUNA tienda —la tienda se
   * buscaba solo por el número de WhatsApp, y en Messenger no hay número— así que
   * las tres páginas vendían el contenido general. Contestaban cada una por la
   * suya, pero las tres lo mismo.
   *
   * Es el mismo campo con otra llave: una tienda puede tener número, página, o las
   * dos.
   *
   * ── Y HACE UNA SEGUNDA COSA, QUE NO ES OPCIONAL ────────────────────────────
   *
   * ES LA PÁGINA CON LA QUE META REGISTRA LA COMPRA. Lo preguntó el dueño el
   * 02/10/2026: «yo no quiero la página tan solo para que atienda messenger, quiero
   * trabajar y que registre compras». Y tenía razón: Meta EXIGE `page_id` en los
   * eventos de mensajería y sin él los rechaza con el subcódigo 2804069.
   *
   * ASÍ QUE «VACÍO» NO ES UNA OPCIÓN NEUTRA. Con un solo número no se notaba, porque
   * el respaldo es la página ACTIVA y resultaba ser la suya: acertaba de casualidad.
   * Con dos números esa casualidad se rompe y las ventas del segundo se miden con la
   * página del primero — sin ningún error en la venta.
   *
   * Por eso la pantalla avisa cuando está en blanco, en vez de llamarlo «no atiende
   * Messenger» como decía antes. Ver `Tienda.pixel` para la medición completa.
   */
  pagina?: string;
  /** false = apagada. Ni con su número puesto atiende. */
  enabled?: boolean;
  /**
   * SU REGALO (17/10/2026): «no todos los regalos van a ser iguales, por tienda es
   * diferente… son productos diferentes y regalos diferentes». Lo que traiga pisa al del
   * bot (`gift_mechanic`) para las conversaciones de esta tienda; lo que no traiga sale del
   * general, como siempre. Sin nada = el regalo de siempre. Ver `conElRegaloDeLaTienda`.
   */
  regalo?: {
    consent_sequence?: SequenceStep[];
    ask_sequence?: SequenceStep[];
    reward_message?: string;
    decline_message?: string;
  };
  /** SU SELECTOR. Sustituye a `segunda_opcion_prestada` para las conversaciones
   *  de este número: así el MISMO producto se vende lineal en un número y COMO
   *  OB en otro. Vacío = «como hoy». */
  semimodalidad?: "" | "dos_juntas" | "segunda_oculta";
  /** QUÉ PRODUCTOS JUEGA, por puesto. Mismo formato que una entrada de
   *  `alineacion_por_modalidad`: los ids salen del almacén, no se copian fichas.
   *  Vacío = juega la alineación general. */
  alineacion?: Record<string, string>;
  /** QUIÉN COBRA en esta tienda, por id del almacén de usuarios.
   *
   *  Vacío = cobra la cuenta del país, que es lo de siempre. Ver `Cobrador` y
   *  `elCobroDelPais`. Varias tiendas pueden apuntar al MISMO cobrador: se
   *  escribe una vez y se elige donde haga falta. */
  cobrador?: string;
  /**
   * SU CONJUNTO DE DATOS DE META —él lo llama «el pixel»—, al que se le reportan
   * las compras de esta tienda.
   *
   * LO PIDIÓ EL DUEÑO el 01/10/2026: «para marcar la compra se necesita waba,
   * numero, pagina y pixel (asi le digo pixel al dataset)». Y es exacto: Meta
   * comprueba que esos cuatro encajen entre sí.
   *
   * DE LOS CUATRO, DOS YA SALÍAN BIEN y dos no. Medido antes de tocar nada:
   *
   *     número   el de la conversación            ✓
   *     WABA     la conexión de ESE número        ✓
   *     página   la ACTIVA, no la de la tienda    ✗
   *     pixel    uno solo para todo el bot        ✗
   *
   * Con un número eso daba igual. Con varios, una venta del número 2 se reportaba
   * con la página del número 1: Meta la rechaza con el subcódigo 2804069 y la venta
   * no se mide. SIN ERROR EN LA VENTA — el cliente recibe su producto igual, así
   * que el fallo solo se ve en el Administrador de eventos.
   *
   * Estaba previsto desde el 24/09 en `PLAN-MEDICION-META-CAPI.md`, mejora 2,
   * medido y aparcado por él: «un solo bot no puede medir varias páginas a la vez».
   * Esto es esa mejora, con el pixel añadido.
   *
   * VACÍO = el pixel elegido en Meta Connect, que es lo de siempre. Así una
   * instalación de un solo número no cambia en nada.
   */
  pixel?: string;
}

/**
 * LA TIENDA DE UNA CONVERSACIÓN, BUSCADA POR SU NÚMERO O SU PÁGINA.
 *
 * SE PREGUNTA AL DATO GUARDADO, NO A LA MEMORIA DEL TURNO. `tiendaDelTurno` solo
 * existe mientras se atiende un mensaje, y la medición de una compra NO siempre
 * sale de ahí: puede salir del obrero al aprobar un comprobante programado, o de
 * una aprobación a mano desde el panel. En esos dos casos la memoria del turno
 * está vacía y la medición volvería a la página activa sin que nadie avise — el
 * mismo fallo silencioso que esto viene a arreglar.
 *
 * La conversación guarda las dos llaves desde el 01/10/2026, así que se resuelve
 * igual en los tres caminos.
 *
 * RECIBE LA CONVERSACIÓN, NO SU NÚMERO DE FILA. Es el mismo trato que `conElTurnoDe`,
 * y por el mismo motivo: así esta función no necesita leer la base, y este archivo no
 * añade una dependencia más. Leer la fila es trabajo de quien ya la tiene a mano.
 *
 * EL ORDEN ES EL DE `conElTurnoDe`, a propósito: primero el número y luego la
 * página. Tenerlos en órdenes distintos haría que una tienda con los dos campos
 * puestos se resolviera de una forma al vender y de otra al medir.
 */
export function laTiendaDeLaConversacion(
  convo:
    | {
        wa_phone_number_id?: string | null;
        messenger_page_id?: string | null;
        tienda_id?: string | null;
      }
    | null
    | undefined
): Tienda | null {
  if (!convo) return null;
  // EL MISMO ORDEN QUE `conElTurnoDe`: la anotada por su frase, el número y la página.
  return (
    tiendaAnotada(convo) ??
    tiendaDelNumero(convo.wa_phone_number_id) ??
    tiendaDeLaPagina(convo.messenger_page_id)
  );
}

/** En cuál está el bot AHORA MISMO para esta conversación. Sale del mismo sitio
 *  que todo lo demás —la presentación prestada—, así que respeta el congelado de
 *  cada conversación y el modo reenganche sin saber nada de ellos. */
export function semimodalidadActiva(
  config: WorkflowConfig | null | undefined
): Semimodalidad {
  const prestada = segundaOpcionPrestada(config);
  if (prestada === "dos_juntas") return "dou";
  if (prestada === "segunda_oculta") return "ob";
  return "lineal";
}

// LA ETIQUETA DE SEMIMODALIDAD VIVE SUELTA, y se reexporta desde aquí para que quien ya lee
// de `config.ts` siga leyendo de un solo sitio.
//
// Está en su propio archivo por el mismo motivo que la de tienda: la PANTALLA del editor
// necesita la misma regla —el visor de recorrido enseñaba las tres semimodalidades juntas— y
// este archivo arrastra la base de datos, que en el navegador no existe.
export { semimodalidadDe, laSemimodalidadDeLaTienda };

/**
 * EL FILTRO POR SEMIMODALIDAD, CON RED DE SEGURIDAD.
 *
 * LO PIDIÓ EL DUEÑO el 30/09/2026: «si todas las burbujas están encendidas y
 * etiquetadas de diferente manera, debe lanzarse solo la que tiene la etiqueta;
 * así las otras estén encendidas pero la modalidad no corresponde, no debería
 * salir».
 *
 * Y ELIGIÓ LA RED (su «opción B») sabiendo lo que evita. Es el MISMO molde que
 * la bandera del país y el del anuncio:
 *
 *     las etiquetadas con la semimodalidad de hoy  -> si hay alguna, juegan SOLO ésas
 *     las que no llevan etiqueta                   -> si no hay ninguna, juegan éstas
 *
 * POR QUÉ NO «solo lo etiquetado, y punto». Ya costó una vez, con la bandera:
 * con TODOS los cajones etiquetados y un cliente sin cajón para él, el sorteo
 * devolvía null — y un cliente sin intro es una venta perdida segura. La
 * etiqueta dirige; nunca deja a nadie fuera.
 *
 * SIN ETIQUETAS PUESTAS NO CAMBIA NADA: todas quedan generales, se devuelve la
 * lista entera y quien llame sigue decidiendo como hasta hoy.
 */
export { porSemimodalidad };

// LA REGLA DE LA ETIQUETA DE TIENDA VIVE SUELTA, y se reexporta desde aquí para
// que quien ya lee de `config.ts` siga leyendo de un solo sitio.
//
// Está en su propio archivo porque la PANTALLA del editor necesita la misma regla
// —para avisar «esta tienda se quedaría sin ningún seguimiento»— y este archivo
// arrastra la base de datos, así que no se puede importar desde el navegador.
// Escribirla dos veces era la otra opción, y en esta casa eso ya costó once
// diferencias entre el visor de precios y el bot. Ver `etiqueta-de-tienda.ts`.
// OJO: se IMPORTAN arriba además de reexportarse aquí. Un `export ... from`
// reexporta pero NO crea el enlace local, y este archivo las usa por dentro —al
// aplanar los cajones del canal y al sortear la intro—.
export { tiendasDe, soloDeSuTienda, leQuedaAlgo };

/** El id de la tienda que atiende este turno, normalizado. null = ninguna.
 *  Lee por `laTiendaDelTurno` a propósito: el almacén se lee por UNA puerta. */
export function laTiendaQueAtiende(): string | null {
  const id = String(laTiendaDelTurno()?.id ?? "").trim();
  return id ? id : null;
}

export function segundaOpcionPrestada(
  config: WorkflowConfig | null | undefined
): SegundaOpcionPrestada | null {
  if (!config) return null;
  // MODO REENGANCHE: LA CONVERSACIÓN NO MANDA, MANDA EL SELECTOR DE HOY.
  //
  // Apagado (lo de siempre) la conversación se queda con la forma con la que
  // nació — lo que el dueño llama «lineal extendida»: quien ya recibió
  // información la sigue recibiendo igual aunque él cambie el selector.
  //
  // POR QUÉ HIZO FALTA EL OTRO MODO, con sus palabras del 26/09/2026: al cambiar
  // a COMO DOU él también reescribe los textos de los seguimientos para dos
  // productos, y esos textos NO se congelan —salen siempre del panel de hoy—.
  // Así que la conversación congelada en un producto recibía un seguimiento que
  // nombra dos, y los dos comodines devolvían EL MISMO NOMBRE (ver el respaldo
  // «elQueHaya» en `nombresDeLosProductos`). El congelado protege mientras el
  // contenido no cambia; en cuanto cambia, es el que miente.
  //
  // LO QUE NO SE TOCA: la presentación se sigue anotando al nacer, encendido o
  // apagado. Así apagar el reenganche devuelve a cada conversación a la forma
  // con la que empezó, en vez de dejarlas sin nada.
  if (config.modo_reenganche === true) {
    const valor = elSelectorQueManda(config);
    if (valor !== "dos_juntas" && valor !== "segunda_oculta") return null;
    const suya = CONTENIDO_DEL_PUESTO[activeModalityKey(config)] ?? {};
    if (Object.values(suya).includes(2)) return null;
    return valor;
  }
  // LO QUE MANDA ES LO DE ESTA CONVERSACIÓN, si se está atendiendo una.
  //
  // «ninguna» es una respuesta, no un hueco: significa «esta conversación
  // empezó vendiendo un solo producto», y entonces no hay presentación prestada
  // aunque el selector de hoy diga otra cosa.
  const deLaConversacion = presentacionDeLaConversacion.getStore();
  if (deLaConversacion) {
    if (deLaConversacion === "ninguna") return null;
    // LA COMPROBACIÓN DEL DATO NO SE SALTA. Aunque la conversación naciera con
    // la presentación puesta, si hoy no hay dos productos sentados no hay dos
    // que vender: presentar dos cuando solo hay una es peor que no presentar
    // ninguna, y eso ya lo decide `vendeConPresentacionPrestada`.
    const propia = CONTENIDO_DEL_PUESTO[activeModalityKey(config)] ?? {};
    if (Object.values(propia).includes(2)) return null;
    return deLaConversacion;
  }
  const valor = elSelectorQueManda(config);
  if (valor !== "dos_juntas" && valor !== "segunda_oculta") return null;
  // La que ya vende dos por su cuenta no toma nada prestado.
  const propia = CONTENIDO_DEL_PUESTO[activeModalityKey(config)] ?? {};
  if (Object.values(propia).includes(2)) return null;
  return valor;
}

/**
 * ¿EL SEGUNDO PRODUCTO SIGUE TAPADO?
 *
 * Es la regla dura de Order Bump, con las palabras del dueño: «del producto full
 * no se dice NI EL PRECIO NI EL CONTENIDO» hasta que el cliente decide pagar o
 * elige método. Ahí el motor manda la segunda intro y marca
 * `order_bump_revealed`.
 *
 * VIVE EN UN SOLO SITIO A PROPÓSITO. Hay varias puertas que deciden lo mismo —el
 * aviso de la actualización, la respuesta rápida de precio, los guardarrailes del
 * precio y el precio que viaja al prompt— y con una copia en cada una, un día una
 * diría que sí y otra que no. Eso, en esta regla, significa destapar el producto
 * oculto por un despiste.
 *
 * FUERA DE ORDER BUMP NO HAY NADA TAPADO: en «como DOU» y en Doble Oferta las dos
 * opciones se presentan desde el primer mensaje, así que devuelve false y quien
 * pregunta se comporta como siempre.
 */
export function elSegundoProductoSigueTapado(
  convo: { order_bump_revealed?: number | null } | null | undefined
): boolean {
  return isOrderBumpActive() && (convo?.order_bump_revealed ?? 0) !== 1;
}

/**
 * LAS ETAPAS EN LAS QUE LA VENTA YA ESTÁ HECHA.
 *
 * A partir de aquí la conversación va del material entregado, del correo, del
 * regalo o del producto de la etapa upsell — nunca de elegir entre las dos
 * opciones del principio. Se escriben una vez y se usan desde donde haga falta,
 * para que dos sitios no puedan tener ideas distintas de qué es «postventa».
 */
const ESTADOS_DE_POSTVENTA = new Set([
  "payment_approved",
  "awaiting_email",
  "awaiting_gift_consent",
  "awaiting_facebook_comment",
]);

/**
 * ¿HAY QUE CONTARLE QUE AHORA HAY DOS OPCIONES?
 *
 * LO PIDIÓ EL DUEÑO el 26/09/2026, y con el sitio incluido: «el "hemos
 * actualizado" es por si el cliente vuelve a retomar la conversación... y si
 * dijese quiero pagar, le diga hola quiero contarte que hemos actualizado a 2
 * productos». Y con lo que NO es: «los seguimientos deberían dispararse de
 * manera normal, sin avisos de actualización».
 *
 * QUIÉN LO OYE, y son cinco condiciones que tienen que darse todas:
 *
 *   1. EL REENGANCHE ESTÁ ENCENDIDO. Apagado, esa conversación sigue vendiendo
 *      lo que le prometieron y no hay ninguna novedad que contar.
 *   2. NACIÓ VENDIENDO UNO. Se pregunta por «ninguna», no por «una forma
 *      distinta»: a quien ya vio dos y hoy las ve de otra manera, decirle que
 *      «ahora hay dos» sería mentirle.
 *   3. YA RECIBIÓ ALGO. Sin intro enviada no ha visto ningún producto, así que
 *      no hay nada que actualizar: para él esto es simplemente lo que hay.
 *   4. TODAVÍA NO SE LE HA DICHO. Se marca al decirlo y no vuelve.
 *   5. Y HOY HAY DOS DE VERDAD. El dato manda, como siempre: sin los dos
 *      productos sentados no se anuncia una segunda que no existe.
 *
 * SE PREGUNTA AQUÍ PARA LOS DOS SITIOS QUE CONTESTAN —el motor cuando manda el
 * recordatorio y el cerebro cuando habla el modelo—, porque dos lecturas de lo
 * mismo acaban discrepando y el cliente lo oiría dos veces o ninguna.
 *
 * NO TOCA LA BASE DE DATOS a propósito: recibe la conversación y contesta. Los
 * ~20 bancos de pruebas importan este archivo con un doble que exporta cinco
 * funciones, y una sexta los rompe todos a la vez.
 */
export function hayQueAvisarDeLaActualizacion(
  convo:
    | {
        presentacion_de_venta?: string | null;
        aviso_actualizacion_enviado?: number | null;
        intro_variant_sent?: number | null;
        state?: string | null;
        paid_total_cents?: number | null;
      }
    | null
    | undefined,
  config: WorkflowConfig | null | undefined
): boolean {
  if (!convo || !config) return false;
  if (config.modo_reenganche !== true) return false;
  if (convo.aviso_actualizacion_enviado === 1) return false;
  if (convo.intro_variant_sent == null) return false;
  // NULL son las conversaciones de antes de que esto existiera: no se sabe con
  // qué nacieron, así que no se les inventa una novedad.
  if (convo.presentacion_de_venta !== "ninguna") return false;
  // 6. Y NO DESPUÉS DE LA COMPRA.
  //
  // LO QUE PASÓ — 28 de septiembre de 2026, su prueba HPRU3. El cliente pagó, se
  // le entregó, el bot le presentó el producto de la etapa upsell y él contestó
  // «ese es otro no». Respuesta del bot: «te cuento que hemos actualizado
  // nuestro contenido y ahora tenemos 2 opciones disponibles para ti». Con sus
  // palabras: «esto no puede pasar, por que luego de la venta ¿cómo va a
  // presentar 2 productos si ya vendió? yo pregunté por el upsell, no por lo
  // anterior».
  //
  // Y TIENE RAZÓN DOS VECES. Esas dos opciones son la venta que YA se hizo, así
  // que anunciarlas como novedad es contarle algo viejo; y en esa etapa la
  // conversación va del producto de la etapa upsell, que tiene precio y
  // contenido propios. El aviso se metía en medio de otra venta.
  //
  // SE PREGUNTA POR EL DINERO Y POR LA ETAPA, no por la modalidad: en cuanto hay
  // un pago registrado, o la conversación está en la postventa, esta novedad ya
  // no es novedad de nada.
  if ((convo.paid_total_cents ?? 0) > 0) return false;
  if (ESTADOS_DE_POSTVENTA.has((convo.state ?? "").trim())) return false;
  /**
   * Y NUNCA AL PASAR A COMO -OB-.
   *
   * LO PIDIÓ EL DUEÑO el 05/10/2026: «no debería ir en la transición de comolineal a
   * comoob, es innecesario ya que cuando la persona elige pagar aparecen los 2
   * productos, así haya venido desde como lineal».
   *
   * Y TIENE UNA SEGUNDA RAZÓN MÁS GRAVE QUE LA QUE ÉL DIO: ese aviso NOMBRA LOS DOS
   * PRODUCTOS. En -OB- el segundo está oculto a propósito —de él no se dice ni el
   * precio ni el contenido hasta que el cliente decide pagar o elige método, y eso
   * está en lo intocable de `CLAUDE.md`—. El aviso lo revelaba de entrada, así que no
   * solo era innecesario: se saltaba la regla de la modalidad.
   *
   * EN -DOU- SE QUEDA, y por eso esto pregunta por la presentación en vez de borrar el
   * aviso: ahí los dos productos se presentan desde el primer mensaje, así que al
   * cliente que venía de uno hay que contarle que ahora hay dos. Es el puente que ya
   * funcionaba.
   *
   * SE PREGUNTA AL SELECTOR QUE MANDA, que dentro del turno es el de la tienda. Así una
   * tienda en -OB- no avisa y otra en -DOU- sí, cada una con lo suyo.
   */
  if (laPresentacionQueDiceElSelector(config) === "segunda_oculta") return false;
  return getActiveTwoTierOffer(config) !== null;
}

/**
 * ¿LA RESPUESTA QUE VA A SALIR CUENTA DE VERDAD LA NOVEDAD?
 *
 * LO QUE PASÓ — 26 de septiembre de 2026, sus seis conversaciones en paralelo.
 * La novedad salió en TRES y en las otras tres no. El motivo era una decisión
 * escrita el día antes: el aviso se daba por dicho en cuanto se le PEDÍA al
 * modelo, así que si el modelo pasaba de él —y pasó— nadie se enteraba y ya no
 * había segunda oportunidad. Justo en las tres donde el cliente preguntó el
 * precio, que es cuando más falta hace.
 *
 * SE PREGUNTA POR EL DATO, NO POR LA REDACCIÓN. La frase la escribe el modelo y
 * cambia cada vez, así que buscarla por palabras no tiene ninguna posibilidad —
 * es el parche palabra por palabra, que en este proyecto ya costó caro. Lo
 * ESTABLE de esa frase son los dos nombres, que salen de la configuración: si
 * están los dos, le contó que hay dos. Es el mismo patrón que
 * `looksLikeDirectPriceAnswer`, que lleva meses sin dar problemas.
 *
 * Y SI NO LOS NOMBRA, NO SE MARCA: el aviso vuelve a viajar en el turno
 * siguiente. Cuesta unos 45 tokens y se apaga solo en cuanto se dice.
 */
export function laRespuestaCuentaLaNovedad(
  texto: string,
  config?: WorkflowConfig | null
): boolean {
  const limpia = (s: string): string =>
    (s ?? "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Mn}/gu, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, " ");
  const { base, full } = nombresDeLosProductos(config);
  const elBase = limpia(base);
  const elFull = limpia(full);
  // Sin los dos nombres no hay nada que comprobar: que lo vuelva a intentar.
  if (elBase.length < 3 || elFull.length < 3) return false;
  const dicho = limpia(texto);
  return dicho.includes(elBase) && dicho.includes(elFull);
}

/**
 * QUÉ PUESTO OCUPA CADA HUECO, CONTANDO LO PRESTADO.
 *
 * Los cuatro sitios que leían `CONTENIDO_DEL_PUESTO` a pelo pasan por aquí, que
 * es la misma razón por la que esa tabla existía: quien LLENA las cajas y quien
 * decide cuáles se LEEN tienen que ser el mismo. Tenerlos separados ya costó
 * tres fallos invisibles —`course_price_soles`, `image_gallery_2` y
 * `pack_gallery`—, y con una presentación prestada volvería a pasar.
 *
 * Se reutiliza la tabla de la modalidad que presta, no se escribe otra: así el
 * hueco 1 y el 2 quedan en el mismo orden que en la modalidad de verdad. En
 * -DOU- el hueco 1 es el CARO; en -OB-, el básico. Copiarlo a mano sería
 * repetir ese cruce que ya salió caro una vez.
 */
function tablaDeHuecos(
  modo: string,
  config: WorkflowConfig | null | undefined
): Partial<Record<PuestoDeProducto, 1 | 2>> {
  const propia = CONTENIDO_DEL_PUESTO[modo] ?? {};
  if (!config || modo !== activeModalityKey(config)) return propia;
  const prestada = segundaOpcionPrestada(config);
  if (!prestada) return propia;
  // Y SI LA SEGUNDA NO ESTÁ SENTADA, SE REPARTE COMO LO QUE ES: UN PRODUCTO.
  //
  // LO QUE PASÓ — 24/09/2026. Con el selector encendido y el asiento FULL vacío,
  // el dueño vio que el bot llamaba a su curso «Producto principal». Medido:
  //
  //     product_name   (hueco 1): ""                    <- el FULL, vacío
  //     product_name_2 (hueco 2): "QUIMICA EN ACCION"
  //     getProductName()        : "Producto principal"  <- el respaldo de fábrica
  //
  // Con la tabla de dos opciones, el hueco 1 lo llena el FULL. Sin nadie ahí, el
  // hueco 1 sale vacío, y el nombre que recibe el modelo cae al texto de fábrica
  // — que acaba en el chat de un cliente.
  //
  // El resto del motor YA se comportaba como un producto en ese caso: la venta
  // (`getActiveTwoTierOffer` exige los dos nombres) y el reparto de puestos
  // (`haySegundaOpcionSentada`). Faltaba esta tabla, y por eso los nombres iban
  // por un lado y la venta por otro.
  //
  // Ahora las tres preguntan lo mismo. Con el selector encendido y un solo
  // producto, el bot se comporta EXACTAMENTE como con el selector apagado —que
  // es lo que el dueño pidió: «quiero que todo sea coherente».
  if (!haySegundaOpcionSentada(config)) return propia;
  // LOS MISMOS DOS PRODUCTOS, EN ORDEN DISTINTO: MANDA CUÁL SE VE.
  //
  // LO QUE PASÓ — 24 de septiembre de 2026, probando «como -OB-». La intro
  // presentaba el básico, como debe. Pero al preguntar «precio» o «qué
  // contiene», el bot describía el FULL con el precio del BÁSICO. Medido con su
  // contenido:
  //
  //     hueco 1 (del que el bot habla) : «QUIMICA EN ACCION + PAPEL»  <- el FULL
  //     hueco 2                        : «QUIMICA EN ACCION»
  //     precio que cotizaba            : 20                           <- el BÁSICO
  //
  // Sus palabras: «al producto base lo está considerando con el nombre del
  // producto full... hay una combinación rara de producto full y precio base».
  //
  // POR QUÉ. El hueco 1 no es un cajón neutro: es LO QUE EL BOT CREE QUE VENDE
  // mientras conversa —`product_name`, `course_content`, `image_gallery`—, y eso
  // viaja al modelo desde el primer mensaje. En -DOU- el hueco 1 es el CARO y
  // está bien: las dos opciones se presentan desde el principio, así que no hay
  // nada que esconder. En «como -OB-» no: ahí el full es el producto OCULTO, y
  // ponerlo en el hueco 1 lo destapa en la primera pregunta. Es la regla dura de
  // -OB- —«del full no se dice ni el precio ni el contenido»— rota por el
  // reparto, no por el modelo.
  //
  // ANTES ESTO ERA UNA SOLA TABLA, y el comentario que había aquí razonaba que
  // lo único que separa a las dos formas es CUÁNDO se revela la segunda, no qué
  // productos son. Eso sigue siendo verdad de los PRODUCTOS —son el full y el
  // básico en las dos— y es falso de los HUECOS, porque el hueco 1 es justo el
  // que no se puede esconder.
  //
  // Y NO SE VUELVE A LA TABLA DE ORDER BUMP, que es lo que falló el 22/09: esa
  // coloca «básico + complementario» y el complementario no se vende suelto.
  // Esta reparte los mismos dos productos de -DOU-, con el visible delante.
  //
  // QUÉ SE MIDIÓ ANTES DE TOCARLO, caja por caja:
  //
  //   · `product_name` / `course_content` / `image_gallery` (hueco 1) y sus
  //     gemelas del hueco 2 — es lo que se quería mover, y lo único que se mueve.
  //   · `pack_gallery`: se escribe solo si el full NO tiene hueco. Tenía el 1 y
  //     ahora tiene el 2: sigue sin escribirse, igual que antes.
  //   · `cajasDeMuestraDeLaModalidad`: la tabla sigue teniendo un hueco 2 y el
  //     full sigue definido → devuelve lo mismo que hoy.
  //   · El ORDEN de las muestras: se ordena por el RANGO del puesto, no por el
  //     número de hueco, así que el básico sigue saliendo antes que el full.
  //   · Las cajas de la venta (`combo`/`basico`) se llenan preguntando por el
  //     PUESTO, no por el hueco: los precios y la entrega no se enteran.
  //   · Y el contenido del full no viaja mientras está oculto: la sección
  //     SECOND PRODUCT CONTENT solo se inyecta con `isDobleOfertaActive()`, que
  //     en «como -OB-» es false —medido—. Con el full en el hueco 2 queda fuera
  //     del prompt hasta que se revela.
  if (prestada === "segunda_oculta") return { basico: 1, full: 2 };
  return CONTENIDO_DEL_PUESTO.doble_oferta_dos;
}

/**
 * QUÉ PUESTOS TIENE CADA MODALIDAD.
 *
 * Ofrecer un puesto que esa modalidad no usa deja llenar algo que no va a salir
 * por ningún lado, y sin nada que lo explique. `upsell` está en todas: la
 * segunda venta tras entregar es de cualquier modalidad.
 */
/**
 * `unico` Y `basico` SON EL MISMO ASIENTO CON DOS NOMBRES.
 *
 * LO QUE PASÓ — 22 de septiembre de 2026. El dueño encendió la presentación de
 * dos opciones en lineal y su producto DESAPARECIÓ de la pantalla: el asiento
 * decía «— ninguno —». No se había perdido. Lineal guarda su asiento con la
 * clave `unico`, y al presentar dos la pantalla pregunta por `basico`.
 *
 * Con sus palabras: «al cambiar ya no aparecen seleccionados los productos; eso
 * no tiene coherencia de trabajar como un solo equipo, sino que más se parece a
 * que al cambiar entraría una configuración nueva». Y lo que quiere es lo
 * contrario: que cambiar de modalidad NO mueva nada, solo despierte lo dormido.
 *
 * Los dos nombres son para el mismo papel —el editor ya llama «Producto básico»
 * a los dos— así que aquí se preguntan como uno solo.
 *
 * EL DIRECTO MANDA, y el gemelo es solo respaldo: así una configuración vieja
 * (solo `unico`) sigue valiendo, y en cuanto la pantalla escribe las dos claves
 * no puede quedar una rancia decidiendo.
 *
 * NO SE RENOMBRA LA CLAVE GUARDADA. Cambiar `unico` por `basico` en los
 * archivos dejaría huérfano el reparto ya escrito; el puente se cruza al LEER.
 */
export function idEnElAsiento(
  alineacion: Partial<Record<PuestoDeProducto, string>> | null | undefined,
  puesto: PuestoDeProducto
): string | undefined {
  if (!alineacion) return undefined;
  const directo = alineacion[puesto]?.trim();
  if (directo) return directo;
  const gemelo =
    puesto === "basico" ? "unico" : puesto === "unico" ? "basico" : null;
  if (!gemelo) return undefined;
  return alineacion[gemelo as PuestoDeProducto]?.trim() || undefined;
}

/**
 * ¿ESTA MODALIDAD ESTÁ VENDIENDO CON LA PRESENTACIÓN PRESTADA DE `forma`?
 *
 * Es la pregunta que abren `isOrderBumpActive` y `isDobleOfertaActive` para que
 * las 62 puertas del motor se enteren de que hay dos opciones. Vive aquí, suelta
 * y recibiendo la configuración, por dos motivos:
 *
 *   · una sola verdad para las dos funciones, y
 *   · se puede PROBAR con una configuración inventada, que es lo único que
 *     demuestra que decide bien. Las dos funciones de arriba leen el archivo de
 *     verdad y no se les puede dar otro.
 *
 * SE PREGUNTA POR EL DATO. No basta con que el interruptor esté puesto: tiene
 * que haber una oferta de dos opciones DE VERDAD, con sus dos nombres
 * resueltos. Sin el segundo producto sentado esto dice «no» — presentar dos
 * cuando solo hay una es peor que no presentar ninguna.
 */
export function vendeConPresentacionPrestada(
  config: WorkflowConfig | null | undefined,
  forma: SegundaOpcionPrestada
): boolean {
  if (!config) return false;
  return (
    segundaOpcionPrestada(config) === forma &&
    getActiveTwoTierOffer(config) !== null
  );
}

/**
 * ¿ESTÁ SENTADA DE VERDAD LA SEGUNDA OPCIÓN?
 *
 * SE PREGUNTA POR LOS DOS PUESTOS QUE LLENAN LOS DOS HUECOS, que es exactamente
 * lo que `getActiveTwoTierOffer` exige para dar por buena la oferta: sin los dos
 * nombres no hay oferta, y los nombres salen del producto sentado en `full`
 * (hueco 1) y en `basico` (hueco 2). Ninguno de los dos cae al Único: se
 * comprobó en el reparto de huecos, y por eso aquí tampoco se cae.
 *
 * SE MIRA LA ALINEACIÓN, NO LAS CAJAS YA LLENAS. Esta función la llama el propio
 * reparto, antes de llenar nada: preguntar por `product_name` aquí sería leer el
 * valor de la vuelta anterior.
 *
 * Y EL PRODUCTO TIENE QUE EXISTIR EN LA BIBLIOTECA. Un puesto que apunta a un
 * producto borrado es un puesto vacío, y el reparto ya lo trata así.
 */
/**
 * QUÉ PRODUCTOS JUEGAN ESTE TURNO: los de la tienda, o los de la modalidad.
 *
 * No hereda ni tapa campo a campo: o la tienda dice qué juega, o manda la alineación de
 * siempre. Sin tienda —o con su alineación vacía— esto devuelve exactamente lo de antes.
 *
 * Los ids salen del MISMO almacén: una tienda no copia fichas, las elige. Por eso cambiar
 * un enlace de entrega se ve en los veinte números a la vez.
 *
 * ── POR QUÉ ESTÁ EN UNA SOLA FUNCIÓN ───────────────────────────────────────
 *
 * LO QUE PASÓ — 2 de octubre de 2026. El dueño probó su tienda y el bot le dijo el NOMBRE
 * de su producto con el PRECIO de otro. Medido con su configuración:
 *
 *     el nombre decía   el producto de la tienda     ✓
 *     el precio salía   del producto de la general   ✗
 *
 * La causa: esta regla estaba escrita en DOS sitios y leída a pelo en TRES más. El reparto
 * preguntaba por la tienda —y por eso el nombre salía bien— y el precio y la entrega leían
 * `alineacion_por_modalidad` directamente, sin enterarse de que había una tienda.
 *
 * Es el fallo número uno de esta casa, otra vez: «la caja que una modalidad llena y otra
 * no abre». Ha costado `course_price_soles`, `image_gallery_2` y `pack_gallery`, y ahora
 * el precio de una tienda.
 *
 * ASÍ QUE LA PREGUNTA SE HACE EN UN SOLO SITIO. Quien quiera saber qué producto juega un
 * puesto llama aquí; nadie vuelve a leer la alineación a pelo. Lo vigila
 * `prueba-el-precio-es-el-del-producto-de-la-tienda`.
 */
export function laAlineacionQueJuega(
  config: WorkflowConfig | null | undefined,
  modo?: string
): Record<string, string> | undefined {
  if (!config) return undefined;
  const suya = tiendaDelTurno.getStore()?.alineacion;
  if (suya && Object.keys(suya).length > 0) return suya;
  return config.alineacion_por_modalidad?.[modo ?? activeModalityKey(config)];
}

function haySegundaOpcionSentada(config: WorkflowConfig): boolean {
  const alineacion = laAlineacionQueJuega(config) ?? {};
  const sentado = (puesto: PuestoDeProducto): boolean => {
    const id = alineacion[puesto];
    return (
      !!id && (config.biblioteca_de_productos ?? []).some((p) => p?.id === id)
    );
  };
  // EL «ÚNICO» VALE COMO GEMELO DEL «BÁSICO», y esto no es un detalle: es la
  // misma silla con dos nombres, y el reparto ya la trata así —ver
  // `idEnElAsiento`, «el gemelo es solo respaldo»—.
  //
  // Lo pilló `prueba-los-asientos-no-se-vacian-al-cambiar` en el primer intento:
  // su alineación es `{ unico, upsell, full }`, sin `basico`, y con la condición
  // pidiendo el `basico` literal la oferta de dos no se abría. Una configuración
  // perfectamente válida se comportaba como si le faltara un producto.
  return sentado("full") && (sentado("basico") || sentado("unico"));
}

export function puestosDeLaModalidad(
  modo: string,
  // Sin config se comporta exactamente como siempre. Lo piden solo los sitios
  // que necesitan contar la presentación prestada; los demás no se enteran.
  config?: WorkflowConfig | null
): PuestoDeProducto[] {
  if (modo === "order_bump") {
    return ["basico", "complementario", "full", "upsell"];
  }
  if (modo === "doble_oferta_dos" || modo === "doble_oferta_upsell") {
    return ["basico", "full", "upsell"];
  }
  if (modo === "bioferta") return ["basico", "complementario", "full", "upsell"];
  // LA QUE VENDE UNO, CUANDO TOMA PRESTADA LA PRESENTACIÓN DE DOS.
  //
  // Los puestos son los de la modalidad que presta, no una lista nueva: si
  // mañana -DOU- gana un puesto, éste lo gana también y no se separan.
  if (config && modo === activeModalityKey(config)) {
    // LAS DOS FORMAS JUEGAN LOS MISMOS PUESTOS, igual que reparten igual. Ver
    // `tablaDeHuecos`: lo que las separa es CUÁNDO se revela la segunda, no qué
    // productos son. «Como -OB-» pedía además el complementario, y eso salía
    // cruzado: el complementario no se vende suelto.
    //
    // Y SOLO SI LA SEGUNDA ESTÁ SENTADA DE VERDAD. Ver `haySegundaOpcionSentada`.
    //
    // LO QUE PASABA — 23/09/2026, destapado por una pregunta del dueño: «¿puedo
    // imitar lineal dejando el selector y sentando un solo producto?». Medido con
    // un producto de 55 que tenía su entrega escrita:
    //
    //     selector apagado    cobra 55    entrega la suya
    //     selector encendido  cobra 999   entrega la de la plantilla vieja
    //
    // Porque había DOS VERDADES. La venta miraba los productos, veía uno y vendía
    // uno por el camino del Único. Esta función miraba el INTERRUPTOR, decía que
    // aquí se juega con básico y full, y entonces el Único no entraba en el
    // reparto: su precio y su entrega no se copiaban nunca. La venta iba por unas
    // cajas que nadie había refrescado, y al cliente le llegaba el material de
    // otro producto — el peor fallo que tiene este proyecto.
    //
    // Ahora las dos preguntan lo mismo: ¿hay dos productos sentados? Si no los
    // hay, el Único vuelve a existir y todo se comporta como con el selector
    // apagado, que es justo lo que el dueño esperaba.
    if (segundaOpcionPrestada(config) && haySegundaOpcionSentada(config)) {
      return ["basico", "full", "upsell"];
    }
  }
  return ["unico", "upsell"];
}

/**
 * QUÉ CAJAS DE MUESTRA ESTÁN A LA VISTA EN LA MODALIDAD QUE VENDE.
 *
 * LO QUE PASÓ — 15 de septiembre de 2026. En Doble Oferta + Upsell el dueño
 * marcaba el check «sale al pedir el detalle» en las tres fichas y el cliente
 * recibía UNA. Su registro lo decía con todas las letras, tres veces seguidas:
 *
 *     [wf:muestras] convo 118: mando 1 de 3 — el resto es de otra etapa
 *
 * Y no era de otra etapa: era del producto básico, que se está vendiendo en esa
 * misma pantalla.
 *
 * POR QUÉ. Quien LLENA las cajas es la tabla de arriba —`CONTENIDO_DEL_PUESTO`,
 * que dice qué puesto ocupa el hueco 1 y cuál el 2—. Pero quien decidía cuáles
 * se LEEN era otra lista, escrita a mano, con los nombres de tres modalidades:
 * Doble Oferta 2 Productos, Bioferta y Order Bump. Doble Oferta + Upsell nació
 * después y nadie la añadió ahí. Su caja 2 se llenaba y no la miraba nadie.
 *
 * Es el mismo fallo de siempre en este proyecto: una caja que alguien llena y
 * otro no lee, sin error y sin aviso — solo se ve en el chat.
 *
 * ASÍ QUE SE PREGUNTA A LA TABLA QUE LAS LLENA, y se acabó la lista paralela:
 *
 *   · la caja 2 se lee si la modalidad TIENE un hueco 2;
 *   · la del pack se lee si la modalidad tiene puesto de full y ese full NO
 *     ocupa un hueco — que es, letra por letra, la condición con la que se
 *     escribe esa caja más abajo.
 *
 * Una modalidad nueva queda bien sola, sin que nadie se acuerde de venir aquí.
 *
 * NO QUITA NADA. En `getImageGallery` esto se SUMA a las tres banderas de antes;
 * no las sustituye. Así ninguna instalación que hoy vea una caja deja de verla,
 * que es lo único que no puede pasar.
 */
export function cajasDeMuestraDeLaModalidad(
  config: WorkflowConfig | null | undefined
): { segunda: boolean; pack: boolean } {
  if (!config) return { segunda: false, pack: false };
  const modo = activeModalityKey(config);
  const tabla = tablaDeHuecos(modo, config);
  return {
    segunda: Object.values(tabla).includes(2),
    pack:
      puestosDeLaModalidad(modo, config).includes("full") &&
      tabla.full === undefined,
  };
}

/**
 * REPARTE LA BIBLIOTECA EN LAS CAJAS DE SIEMPRE.
 *
 * QUÉ HACE. Lee la alineación de la modalidad que está vendiendo —quién juega
 * de único, de básico, de complementario, de full, de upsell— y copia lo del
 * producto señalado —nombre, alias, precio, entrega, galería y contenido—
 * dentro de la caja que le toca.
 *
 * POR QUÉ APUNTA Y NO ETIQUETA. Antes el papel era una etiqueta dentro del
 * producto, y la etiqueta es una sola y la misma para todas las modalidades.
 * Preparar Order Bump cambiaba lo que el Lineal estaba vendiendo en ese
 * momento. Ahora cada modalidad guarda su propia alineación: se llena la que
 * viene con calma, y entra al mover el interruptor de modalidad.
 *
 * POR QUÉ AQUÍ Y NO EN CADA SITIO. El archivo se lee del disco en UN solo punto
 * de todo el proyecto, y justo ahí ya se le aplica la capa del canal. El motor,
 * el cobro, la validación del comprobante, la entrega y el cerebro no leen el
 * archivo: leen el resultado de esta línea. Son unas ciento setenta llamadas y
 * todas pasan por aquí.
 *
 * Así que después de esto, TODO el bot ve exactamente la forma de siempre. No
 * hay un solo sitio que tenga que enterarse de que existe la alineación.
 *
 * NO HACE NADA POR OMISIÓN. Sin biblioteca, sin alineación para la modalidad
 * que vende, o con todos los puestos en «ninguno», devuelve la configuración
 * tal cual llegó. Ésa es la garantía de que un bot que no use esto se comporta
 * igual que antes de que existiera.
 *
 * UN PUESTO SEÑALA A UN SOLO PRODUCTO, así que aquí no hay empates que
 * desempatar. Si señala a uno borrado, se avisa por consola y esa caja se queda
 * como estaba: inventar un producto o vaciarla en silencio son las dos formas
 * de que el cliente reciba algo que nadie eligió.
 *
 * EL PRECIO NO VIAJA SOLO. Se copia el del producto, pero el precio POR PAÍS de
 * Precios y pagos sigue mandando sobre él, exactamente igual que antes. Así, en
 * un país con precio puesto, cambiar la alineación no mueve lo que se cobra.
 */
/**
 * LA VERSIÓN ELEGIDA DE LA INTRO DE LA OFERTA Y DE LA DEL UPSELL.
 *
 * QUÉ RESUELVE, Y ES GORDO. El cajón de esas dos intros NO GUARDA: se escribe,
 * se pulsa Guardar, y al volver está el texto anterior. Se comprobó contra el
 * archivo real — el texto nuevo no aparecía en ningún sitio.
 *
 * La libreta de versiones sí guarda, porque vive en la raíz y usa el mismo camino
 * que la biblioteca de productos. Así que se le da la vuelta al problema: la
 * versión marcada como activa ES la que manda, y el cajón pasa a ser su reflejo.
 *
 * ES UNA CAPA, no un cambio en el motor: el motor sigue leyendo `intro_groups`
 * como siempre y no se entera de nada. Es el mismo truco de la biblioteca de
 * productos.
 *
 * SIN NINGUNA ACTIVA NO HACE NADA. Quien no use el selector se comporta
 * exactamente igual que antes, incluido el reparto por peso entre varios
 * cajones. Con una activa hay UNA, que es lo que el selector significa: estás
 * mirando esa.
 */
export function aplicarVersionActiva(config: WorkflowConfig): WorkflowConfig {
  const libreta = config.biblioteca_de_intros;
  if (!Array.isArray(libreta) || libreta.length === 0) return config;
  const activaDe = (lugar: "order_bump" | "upsell") =>
    libreta.find(
      (v) => (v.lugar ?? "order_bump") === lugar && v.activa === true
    );
  // Una versión sin burbujas no puede mandar: dejaría la oferta muda y el cajón
  // que sí tiene texto callado. Con ella vacía manda el cajón, como siempre.
  const comoCajon = (v: { name?: string; steps?: SequenceStep[] } | undefined) =>
    v && (v.steps ?? []).length > 0
      ? [{ name: v.name ?? "", enabled: true, weight: 1, steps: v.steps }]
      : null;
  const next: WorkflowConfig = { ...config };
  const deLaOferta = comoCajon(activaDe("order_bump"));
  if (deLaOferta && next.order_bump) {
    next.order_bump = {
      ...next.order_bump,
      intro_groups: deLaOferta,
    } as WorkflowConfig["order_bump"];
  }
  const delUpsell = comoCajon(activaDe("upsell"));
  if (delUpsell && next.upsell) {
    next.upsell = { ...next.upsell, intro_groups: delUpsell };
  }
  return next;
}

/** LAS BURBUJAS DE LA FICHA, EN EL FORMATO QUE LEE EL MOTOR. Ver el comentario de
 *  `burbujasDelProducto` dentro de `repartirPorEtiqueta`, que es quien la estrenó. */
export function burbujasDeLaFicha(
  pasos: SequenceStep[] | undefined
): SequenceStep[] {
  return (pasos ?? []).map((paso) => {
    const suelto = paso as SequenceStep & { texts?: unknown };
    const textos = Array.isArray(suelto.texts)
      ? suelto.texts.filter((t): t is string => typeof t === "string")
      : [];
    if (textos.length === 0) return paso;
    // Ya traducido: no se toca. Solo se rellena lo que falta.
    const yaTiene =
      (paso.type === "text" ? paso.body_variants : paso.caption_variants) ??
      [];
    if (yaTiene.length > 0) return paso;
    return paso.type === "text"
      ? { ...paso, body_variants: textos }
      : { ...paso, caption_variants: textos };
  });
}

export function repartirPorEtiqueta(config: WorkflowConfig): WorkflowConfig {
  const biblioteca = config.biblioteca_de_productos;
  if (!Array.isArray(biblioteca) || biblioteca.length === 0) return config;

  // LA ALINEACIÓN DE LA MODALIDAD QUE VENDE, Y SOLO ÉSA.
  //
  // Las demás se quedan escritas y calladas: en eso consiste poder preparar una
  // modalidad mientras otra sigue vendiendo.
  const modo = activeModalityKey(config);
  const alineacion = laAlineacionQueJuega(config, modo);
  if (!alineacion) return config;

  const porId = new Map(
    biblioteca.filter((p) => p?.id).map((p) => [p.id, p] as const)
  );
  const enElPuesto = (puesto: PuestoDeProducto): ProductoDeLaBiblioteca | null => {
    const id = idEnElAsiento(alineacion, puesto);
    if (!id) return null;
    const producto = porId.get(id);
    if (!producto) {
      // UN PUESTO QUE APUNTA A UN PRODUCTO BORRADO. Se avisa y se deja la caja
      // como estaba: inventar un producto o vaciarla en silencio son las dos
      // formas de que el cliente reciba algo que nadie eligió.
      console.warn(
        `[wf] ${modo}: el puesto «${puesto}» apunta al producto «${id}», que ya no está en la biblioteca`
      );
      return null;
    }
    return producto;
  };

  const puestos = puestosDeLaModalidad(modo, config);
  const asignados = puestos
    .map((puesto) => [puesto, enElPuesto(puesto)] as const)
    .filter((par): par is readonly [PuestoDeProducto, ProductoDeLaBiblioteca] =>
      par[1] !== null
    );
  if (asignados.length === 0) return config;

  const next: WorkflowConfig = { ...config };

  // EL CONTENIDO DEL PRODUCTO: nombre, qué incluye y galería.
  //
  // REGLA DEL DUEÑO, Y ES TERMINANTE: de los cajones de producto NO SALE NADA.
  // «Nada debe salir de ahí.» Lo que guardan es lo del producto que se vendía
  // antes, y una modalidad que ya tiene su reparto hecho no puede volver a
  // hablar por ellos.
  //
  // Así que no se recorren los ASIGNADOS: se recorren los dos huecos. El que
  // tiene a alguien sentado sale con lo suyo, y el que no, sale VACÍO. Un hueco
  // vacío se ve en el chat y se arregla; el nombre del producto anterior no se
  // ve, y se descubre cuando la clienta reclama.
  //
  // Aquí estaba además el «producto fantasma»: estos tres campos viven por
  // modalidad, así que al cambiar asomaba el que esa modalidad tenía guardado de
  // antes, aunque las cajas de las opciones ya vinieran del producto elegido.
  /**
   * LAS BURBUJAS DE LA FICHA, EN EL FORMATO QUE LEE EL MOTOR.
   *
   * La biblioteca se guardó un tiempo TAL CUAL venía de la pantalla, y la
   * pantalla escribe el texto en `texts` mientras el motor lo lee en
   * `body_variants`. El motor encontraba la burbuja y no encontraba el texto:
   * mandaba un mensaje VACÍO. En el registro se ve «entrega programada (1 pasos
   * activos)» y «enviando step 0», y al cliente no le llega nada.
   *
   * Al guardar ya se traduce, pero eso solo arregla los archivos que se vuelvan
   * a guardar. El motor lee el archivo tal como está, así que la traducción
   * tiene que estar TAMBIÉN aquí — si no, la entrega sigue muda hasta que a
   * alguien se le ocurra abrir cada producto y guardarlo.
   *
   * Vive fuera, en `burbujasDeLaFicha`, porque la fila de upsells lee las mismas fichas y
   * tiene que traducirlas igual. Una sola regla, en un solo sitio.
   */
  const burbujasDelProducto = (
    pasos: SequenceStep[] | undefined
  ): SequenceStep[] => burbujasDeLaFicha(pasos);

  const puestoDelHueco = (hueco: 1 | 2): PuestoDeProducto | undefined => {
    const tabla = tablaDeHuecos(modo, config);
    return (Object.keys(tabla) as PuestoDeProducto[]).find(
      (p) => tabla[p] === hueco
    );
  };
  for (const hueco of [1, 2] as const) {
    const puesto = puestoDelHueco(hueco);
    if (!puesto) continue;
    const producto = enElPuesto(puesto);
    const nombre = producto?.name ?? "";
    const contenido = producto?.course_content ?? "";
    const galeria = producto?.image_gallery ?? [];
    if (hueco === 1) {
      next.product_name = nombre;
      next.course_content = contenido;
      next.image_gallery = galeria;
    } else {
      next.product_name_2 = nombre;
      next.course_content_2 = contenido;
      next.image_gallery_2 = galeria;
    }
  }

  // LO QUE SE COPIA A UNA CAJA DE DOS OPCIONES.
  //
  // Se escribe campo a campo y NO con un volcado entero: la caja tiene además
  // el guion de venta —la respuesta al elegirla, sus variantes, sus respuestas
  // por método— y eso es del papel, no del producto. Un volcado lo borraría.
  //
  // SIN PRODUCTO SENTADO, LA CAJA SALE VACÍA. No se deja lo de antes: esa es la
  // regla de arriba. El guion sigue, el producto no.
  const llenarOpcion = (
    caja: OrderBumpOption | undefined,
    producto: ProductoDeLaBiblioteca | null
  ): OrderBumpOption => ({
    ...(caja ?? {}),
    name: producto?.name ?? "",
    aliases: producto?.aliases ?? [],
    price_soles: producto?.price_soles ?? 0,
    discount_price_soles: producto?.discount_price_soles ?? 0,
    ...(producto?.regalos === undefined ? {} : { regalos: producto.regalos }),
    delivery: burbujasDelProducto(producto?.delivery),
  });

  const enPuesto = (puesto: PuestoDeProducto) =>
    asignados.find(([p]) => p === puesto)?.[1] ?? null;
  const unico = enPuesto("unico");
  const full = enPuesto("full") ?? unico;
  const basico = enPuesto("basico") ?? unico;
  // LAS DOS MODALIDADES DE DOS OPCIONES SE LLENAN A LA VEZ.
  //
  // Cuál manda lo decide el motor como siempre, por la modalidad activa. Llenar
  // solo la activa dejaría la otra con lo de antes, y al cambiar de modalidad
  // aparecería contenido viejo sin que nadie lo hubiera tocado.
  //
  // SE ESCRIBEN AUNQUE EL PUESTO ESTÉ VACÍO, y por la misma regla: si esta
  // modalidad ya tiene su reparto, el cajón no vuelve a hablar. Solo se saltan
  // las modalidades que ni siquiera ofrecen ese puesto, donde escribir sería
  // vaciar una caja que no es de aquí.
  // Y LA TERCERA MODALIDAD DE DOS OPCIONES SE QUEDABA FUERA.
  //
  // Aquí se llenaban `order_bump` y `doble_oferta_dos`, pero NO
  // `doble_oferta_upsell` — que es una modalidad de dos opciones exactamente
  // igual, con sus mismas cajas `combo` y `basico`. Al encenderla, sus cajas
  // seguían con lo de fábrica:
  //
  //     combo:  name="<<NOMBRE_OPCION_COMBO>>"   price=0
  //     basico: name="<<NOMBRE_OPCION_BASICO>>"  price=0
  //
  // Y de ahí salía todo lo demás: los comodines de precio llegaban VACÍOS al
  // cliente aunque el visor del editor los enseñara bien —el visor mira la
  // ficha, el motor miraba la caja—, y los detectores de elección no tenían
  // nombre ni precio con que reconocer nada. Lo destapó el recorrido de venta
  // el 2026-09-14, y el dueño lo vio a la vez en su simulador.
  //
  // Se llena por la misma puerta y con las mismas fichas que las otras dos: no
  // hay una regla nueva, faltaba el renglón.
  const hayPuesto = (p: PuestoDeProducto) => puestos.includes(p);
  if (hayPuesto("full") || hayPuesto("unico")) {
    next.order_bump = {
      ...next.order_bump,
      combo: llenarOpcion(next.order_bump?.combo, full),
    } as WorkflowConfig["order_bump"];
    next.doble_oferta_dos = {
      ...next.doble_oferta_dos,
      combo: llenarOpcion(next.doble_oferta_dos?.combo, full),
    } as WorkflowConfig["doble_oferta_dos"];
    next.doble_oferta_upsell = {
      ...next.doble_oferta_upsell,
      combo: llenarOpcion(next.doble_oferta_upsell?.combo, full),
    } as WorkflowConfig["doble_oferta_upsell"];
  }
  if (hayPuesto("basico") || hayPuesto("unico")) {
    next.order_bump = {
      ...next.order_bump,
      basico: llenarOpcion(next.order_bump?.basico, basico),
    } as WorkflowConfig["order_bump"];
    next.doble_oferta_dos = {
      ...next.doble_oferta_dos,
      basico: llenarOpcion(next.doble_oferta_dos?.basico, basico),
    } as WorkflowConfig["doble_oferta_dos"];
    next.doble_oferta_upsell = {
      ...next.doble_oferta_upsell,
      basico: llenarOpcion(next.doble_oferta_upsell?.basico, basico),
    } as WorkflowConfig["doble_oferta_upsell"];
  }

  // EL ÚNICO DE LINEAL: SU ENTREGA Y SU PRECIO.
  //
  // Lineal no tiene cajas de dos opciones. Cobra el precio base y entrega por la
  // secuencia general, y a ninguna de las dos llegaba nada: al puesto Único se
  // le llenaba el nombre, el contenido y la galería, y se quedaba ahí.
  //
  // O sea que cambiar de producto en Lineal le cambiaba el NOMBRE al cliente y
  // le mandaba el archivo del producto anterior. Es la peor forma de fallar de
  // todas las que hay aquí: la clienta pagó, recibió algo, y no es lo suyo.
  //
  // Vale igual para la modalidad Upsell, cuya PRIMERA venta funciona como
  // Lineal. Su segunda venta ya se llenaba, más abajo.
  if (hayPuesto("unico")) {
    // LA ENTREGA DEL CAJÓN NO SE RESPETA, NI SIQUIERA VACÍA.
    //
    // Es una regla del dueño y tiene razón: esos cajones se quedaron como
    // plantilla, y lo que guardan es la entrega del producto que se vendía
    // ANTES. Dejarlos hablar es mandarle a la clienta el archivo del producto
    // anterior, que es exactamente lo que no puede pasar.
    //
    // Que se quede vacía tiene su propia red: el bot avisa al admin en el
    // momento —ver `avisarQueNoHayEntrega` en payment.ts—, porque un cliente que
    // pagó y no recibe nada es peor todavía.
    next.payment_approved_sequence = burbujasDelProducto(unico?.delivery);
    // Y EL PRECIO ES EL RESPALDO, NO LA ÚLTIMA PALABRA. El de Precios y pagos
    // del país del cliente sigue mandando encima, exactamente igual que antes.
    // Éste es el que se usa en los países que no tengan el suyo puesto.
    //
    // El precio SÍ se protege del vacío: un cero no es «esto es gratis», es un
    // campo sin llenar, y escribirlo dejaría al bot cobrando nada.
    if (typeof unico?.price_soles === "number" && unico.price_soles > 0) {
      next.course_price_soles = unico.price_soles;
    }
  }

  // Y EL «ANTES» TACHADO DEL BASE, POR EL MISMO CAMINO.
  //
  // Faltaba, y se notaba: la ficha traía su precio anterior y `{{PRECIO_MERCADO}}`
  // salía vacío en cuanto el país no tenía el suyo puesto. La burbuja llegaba al
  // cliente con «(antes) ~~» y nada dentro.
  //
  // Se toma del producto del puesto base — el Único en Lineal, el Básico en las
  // de dos opciones — que es el mismo que da `course_price_soles`. El del país
  // sigue mandando encima; esto solo rellena el hueco.
  if (hayPuesto("basico") || hayPuesto("unico")) {
    if (typeof basico?.market_price === "number" && basico.market_price > 0) {
      next.market_price = basico.market_price;
    }
  }

  // LA ETAPA DEL SEGUNDO PRODUCTO.
  //
  // Aquí se copia ADEMÁS la galería y el contenido, que la etapa sí tiene los
  // suyos. Lo que NO se toca son sus tiempos, su pregunta del final, sus
  // botones ni su texto de rechazo: eso es la etapa, no el producto. Cambiar la
  // etiqueta no puede reiniciar cuántos minutos espera antes de ofrecerlo.
  const upsell = enPuesto("upsell");
  if (hayPuesto("upsell")) {
    // LO DEL PRODUCTO, Y SOLO LO DEL PRODUCTO. El guion —las burbujas con las
    // que se ofrece, los botones, la pregunta del final, el texto de rechazo y
    // los minutos de espera— es de la etapa y se conserva entero.
    const loDelProducto = {
      name: upsell?.name ?? "",
      aliases: upsell?.aliases ?? [],
      price_soles: upsell?.price_soles ?? 0,
      discount_price_soles: upsell?.discount_price_soles ?? 0,
      market_price: upsell?.market_price ?? 0,
      image_gallery: upsell?.image_gallery ?? [],
      course_content: upsell?.course_content ?? "",
      delivery: burbujasDelProducto(upsell?.delivery),
    };
    next.upsell = { ...(next.upsell ?? {}), ...loDelProducto };
    // Y TAMBIÉN EN LA CAJA QUE LEE DOBLE OFERTA + UPSELL.
    //
    // LO QUE COSTÓ — 15 de septiembre de 2026. El dueño eligió un producto como
    // upsell y en -DOU- le llegaba el contenido y el precio de OTRO, el que
    // había ahí de una configuración anterior. Con sus palabras: «¿por qué no
    // está llegando el contenido […] y de dónde está llegando el contenido
    // equivocado?».
    //
    // POR QUÉ. Hay DOS cajas de upsell y `seccionUpsell` tiene UNA línea que se
    // sale del camino común:
    //
    //     if (key === "doble_oferta_upsell") return cfg.doble_oferta_upsell?.upsell;
    //     ...
    //     return cfg.upsell;
    //
    // Las otras cinco modalidades caen en el `return` de abajo y leen la caja
    // que esto acaba de llenar. -DOU- lee la SUYA, y a ésa no la llenaba nadie:
    // se quedaba con el producto de antes, callada, y el motor la creía.
    //
    // Es el mismo fallo que dejó vacíos sus comodines y que dejó fuera la
    // muestra del full: una caja que el reparto no llena, y el motor leyéndola.
    // Por eso aquí, al lado de su hermana, para que no se vuelvan a separar.
    //
    // Se escribe SIEMPRE que la modalidad tenga puesto de upsell, aunque nadie
    // lo ocupe: es la regla de las demás cajas. Dejar lo de antes sería vender
    // el producto anterior.
    if (next.doble_oferta_upsell) {
      next.doble_oferta_upsell = {
        ...next.doble_oferta_upsell,
        upsell: {
          ...(next.doble_oferta_upsell.upsell ?? {}),
          ...loDelProducto,
        },
      };
    }
  }
  // DOBLE OFERTA GUARDA LO SUYO EN SU PROPIA CAJA, Y NADIE LA TOCABA.
  //
  // Sus tres opciones —Producto 1, Producto 2 y el Pack— no son las cajas de dos
  // opciones que se llenan más arriba: viven en `bioferta_doble`. Así que se
  // elegían los productos en la alineación y esta modalidad seguía vendiendo y
  // entregando lo de antes, sin un aviso y sin nada que lo explicara.
  //
  // EL REPARTO ES EL QUE ENSEÑA LA PANTALLA: el básico es el Producto 1, el
  // complementario el Producto 2 y el full es el Pack, que son los dos juntos.
  if (modo === "bioferta") {
    const llenarBioferta = (
      caja: BiofertaProduct | undefined,
      producto: ProductoDeLaBiblioteca | null
    ): BiofertaProduct => ({
      ...(caja ?? {}),
      name: producto?.name ?? "",
      aliases: producto?.aliases ?? [],
      // Vacía también manda: ver el comentario del Único, más arriba. El cajón
      // guarda la entrega del producto anterior y no puede volver a hablar.
      delivery: burbujasDelProducto(producto?.delivery),
    });
    const complementario = enPuesto("complementario");
    const bio: BiofertaDoble = { ...(next.bioferta_doble ?? {}) };
    bio.product_a = llenarBioferta(bio.product_a, basico);
    bio.product_b = llenarBioferta(bio.product_b, complementario);
    bio.pack = llenarBioferta(bio.pack, full);
    // LOS PRECIOS DE ESTA MODALIDAD SON DOS, NO TRES: los dos productos sueltos
    // valen lo mismo —el precio unitario, que es el general— y el Pack tiene el
    // suyo. Los dos siguen por debajo del precio por país, como todo lo demás.
    if (typeof basico?.price_soles === "number" && basico.price_soles > 0) {
      next.course_price_soles = basico.price_soles;
    }
    if (typeof full?.price_soles === "number" && full.price_soles > 0) {
      bio.pack_price_soles = full.price_soles;
    }
    if (
      typeof full?.discount_price_soles === "number" &&
      full.discount_price_soles > 0
    ) {
      bio.pack_discount_price_soles = full.discount_price_soles;
    }
    next.bioferta_doble = bio;
  }
  // LA GALERÍA DEL FULL NO TENÍA DÓNDE CAER, Y POR ESO NO SALÍA NUNCA.
  //
  // LO QUE PASÓ — 14 de septiembre de 2026, con sus palabras: «el producto full
  // no se enviaba, solo se enviaban las muestras del básico y complementario».
  // Marcaba «Sale cuando piden ver el detalle» en las imágenes de la ficha del
  // full, y al pedir el detalle llegaban las otras dos. Sin error y sin aviso.
  //
  // POR QUÉ. El reparto copia las galerías en los DOS huecos del contenido, y
  // en Order Bump esos huecos son el básico (1) y el complementario (2) — el
  // full no tiene hueco. Su galería se quedaba en la ficha sin copiarse a
  // ninguna caja. Mientras tanto, la lista de temas marcados de más abajo SÍ
  // recorre a los asignados, o sea que apuntaba a unas imágenes que el lector
  // de galerías no podía encontrar: `getImageGallery` busca en `image_gallery`,
  // `image_gallery_2` y `pack_gallery`, y esta última no la llenaba nadie. Los
  // temas del full resolvían a nada y se caían del envío en silencio.
  //
  // Es el mismo fallo que dejó los comodines de Doble Oferta + Upsell vacíos:
  // una caja que el reparto no llenaba, y el motor leyendo la caja.
  //
  // DÓNDE APLICA, Y POR QUÉ ASÍ. Solo donde el full existe como puesto y NO
  // ocupa uno de los dos huecos — hoy Order Bump y Bioferta, que son las que
  // tienen pack —. En Doble Oferta (las dos) el full ES el hueco 1, así que su
  // galería ya salía por `image_gallery` y aquí no se toca nada. En Lineal y en
  // la modalidad Upsell no hay puesto de full. Se pregunta por la tabla en vez
  // de escribir los nombres de las modalidades: así no se inventa una
  // diferencia entre modalidades que no existe.
  //
  // Y SE ESCRIBE VACÍA SI NADIE JUEGA DE FULL. Misma regla que las demás cajas:
  // dejar lo de antes sería mandar las muestras del producto anterior.
  if (puestos.includes("full") && tablaDeHuecos(modo, config).full === undefined) {
    next.pack_gallery = enPuesto("full")?.image_gallery ?? [];
  }

  // «INFO DE CONTENIDO»: LAS IMÁGENES QUE SALEN AL PEDIR EL DETALLE.
  //
  // Esta lista guarda NOMBRES de tema, no imágenes. Mientras el producto era el
  // sitio donde estaba guardado, los nombres siempre coincidían. Desde que las
  // galerías llegan con el producto, la lista se quedaba nombrando las muestras
  // del producto ANTERIOR: no coincidía ninguna y el bot no mandaba nada al
  // pedir el detalle. Sin error, sin aviso, y solo se ve en el chat.
  //
  // Ahora la marca vive en la propia imagen, dentro de la ficha, así que la
  // lista se arma sola con lo que traiga quien esté jugando. Se respeta el orden
  // de los puestos, que es el orden en que se presenta la oferta.
  // DOS FICHAS PUEDEN LLAMAR IGUAL A SU MUESTRA, Y LAS DOS TIENEN QUE SALIR.
  //
  // LO QUE PASABA — 15 de septiembre de 2026, con palabras del dueño: «he puesto
  // check en los 3 productos, me envió solo 2, el básico y el complementario, y
  // no envió el full». Su reparto de Order Bump tenía esta forma:
  //
  //     BASICO   <un producto>              muestra: «<mismo nombre>»
  //     FULL     <ese producto + otro>      muestra: «<mismo nombre>»   <- igual
  //
  // Aquí se descartaba por nombre repetido, así que la muestra del full NO
  // ENTRABA EN LA LISTA. Él marcaba tres y salían dos, sin un aviso en ninguna
  // parte. Y no es un descuido suyo: el combo se llama como el básico porque LO
  // CONTIENE, así que ese choque de nombres va a repetirse siempre.
  //
  // La marca ya no es el nombre: es la ficha MÁS el nombre. Así el mismo texto
  // en dos productos distintos son dos muestras distintas, que es lo que son. Un
  // producto que repita su propio tema se sigue descartando, que era lo que esta
  // guarda protegía de verdad.
  //
  // Quien las busca luego tiene que gastar cada imagen UNA vez, o las dos
  // entradas caerían en la misma foto: ver `enviar_info_contenido`.
  const temasMarcados: string[] = [];
  const yaMarcado = new Set<string>();
  for (const [, producto] of asignados) {
    const deQuien = String(
      (producto as { id?: string }).id ?? producto.name ?? ""
    ).toLowerCase();
    for (const muestra of producto.image_gallery ?? []) {
      const tema = (muestra?.topic ?? "").trim();
      if (!muestra?.info_de_contenido || !tema) continue;
      const clave = `${deQuien}|${tema.toLowerCase()}`;
      if (yaMarcado.has(clave)) continue;
      yaMarcado.add(clave);
      temasMarcados.push(tema);
    }
  }
  // Y ESTA LISTA TAMBIÉN SE ESCRIBE VACÍA SI NO HAY MARCAS. Es la misma regla:
  // en una modalidad con reparto, los cajones no hablan. La lista vieja nombra
  // muestras del producto anterior; dejarla sería mandar las imágenes de otro
  // producto cuando el cliente pide ver el detalle.
  //
  // Sin marcas el bot responde en texto, que es lo que hace cuando esta lista
  // está vacía. Se ve en el chat y se arregla marcando las imágenes en la ficha.
  next.product_info_topics = temasMarcados;

  // EL COMPLEMENTARIO NO TIENE CAJA DE OPCIÓN FUERA DE DOBLE OFERTA, Y NO ES UN
  // OLVIDO.
  //
  // En Order Bump no se vende suelto: se enseña. Lo que aporta es su NOMBRE y su
  // CONTENIDO —para que el bot sepa explicar qué trae la opción conjunta— y eso
  // ya se llenó arriba, en el trío del contenido.

  return next;
}

/**
 * Carga config con caché basada en mtime — relee el archivo solo si cambió en
 * disco. Devuelve null si:
 *  - El archivo no existe
 *  - No es JSON válido
 *  - Aún tiene placeholders <<...>> sin rellenar (workflow desactivado)
 */
/**
 * EL REGALO DE LA TIENDA QUE ATIENDE, ENCIMA DEL DE SIEMPRE (17/10/2026).
 *
 * Cada campo que la tienda trae escrito pisa al general; los demás (botones, enlaces por anuncio,
 * audio, interruptores) siguen siendo los del bot. Una secuencia vacía o un texto en blanco NO
 * pisa: vacío quiere decir «no lo he escrito», nunca «que no salga nada».
 *
 * SIN TIENDA, SIN REGALO PROPIO O SIN REGALO EN EL BOT: devuelve EL MISMO objeto, tal cual. Por
 * eso ninguna instalación cambia hasta que alguien escribe el regalo de una tienda.
 */
export function conElRegaloDeLaTienda(
  config: WorkflowConfig,
  tienda: Pick<Tienda, "regalo"> | null
): WorkflowConfig {
  const suyo = tienda?.regalo;
  const general = config.gift_mechanic;
  if (!suyo || !general) return config;
  const conPasos = (pasos: SequenceStep[] | undefined) => Array.isArray(pasos) && pasos.length > 0;
  const conTexto = (t: string | undefined) => typeof t === "string" && t.trim().length > 0;
  const pisa = {
    ...(conPasos(suyo.consent_sequence) ? { consent_sequence: suyo.consent_sequence } : {}),
    ...(conPasos(suyo.ask_sequence) ? { ask_sequence: suyo.ask_sequence } : {}),
    ...(conTexto(suyo.reward_message) ? { reward_message: suyo.reward_message } : {}),
    ...(conTexto(suyo.decline_message) ? { decline_message: suyo.decline_message } : {}),
  };
  if (Object.keys(pisa).length === 0) return config;
  return { ...config, gift_mechanic: { ...general, ...pisa } };
}

export function loadWorkflowConfig(): WorkflowConfig | null {
  ensureConfigFileExists();
  const yamlExists = fs.existsSync(CONFIG_PATH_YAML);
  const filePath = yamlExists ? CONFIG_PATH_YAML : CONFIG_PATH_JSON_LEGACY;
  const channel = getActiveWorkflowChannel();
  // LA PRESENTACIÓN DE LA CONVERSACIÓN FORMA PARTE DE LA LLAVE. Ver el comentario
  // de `cached`: el reparto de las cajas se hace aquí abajo, así que cada
  // presentación necesita su propia versión armada. Sin conversación delante la
  // llave es la de siempre y se reusa exactamente el mismo objeto que hoy.
  const laSuya = presentacionDeLaConversacion.getStore();
  // Y LA TIENDA FORMA PARTE DE LA LLAVE, por el mismo motivo que la
  // presentación: el reparto de las cajas se hace aquí abajo, y cada tienda
  // juega sus productos. Sin tienda la llave es la de siempre y se reusa
  // exactamente el mismo objeto que hoy.
  const suTienda = tiendaDelTurno.getStore();
  const clave = [channel, laSuya ?? "", suTienda?.id ?? ""]
    .filter(Boolean)
    .join("|");

  let mtime = 0;
  try {
    mtime = fs.statSync(filePath).mtimeMs;
  } catch {
    return null;
  }
  if (
    cached &&
    cached.mtime === mtime &&
    Object.prototype.hasOwnProperty.call(cached.byChannel, clave)
  ) {
    return cached.byChannel[clave] ?? null;
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
  // EL ORDEN IMPORTA: PRIMERO LAS ETIQUETAS, DESPUÉS EL CANAL.
  //
  // Las dos escriben en las mismas cajas. El canal es la capa de más arriba —es
  // lo que ese canal concreto manda— así que tiene que poder pisar lo que puso
  // la etiqueta, y no al revés. Invertido, escribir una entrega propia en
  // WhatsApp no serviría de nada: la etiqueta la volvería a tapar.
  // Y EL REGALO DE SU TIENDA, al final: es lo más concreto (17/10/2026). Sin tienda, o con una
  // sin regalo propio, devuelve el mismo objeto y nada cambia.
  const runtimeConfig = conElRegaloDeLaTienda(
    applyChannelContent(aplicarVersionActiva(repartirPorEtiqueta(config)), channel),
    suTienda ?? null
  );
  cached =
    cached && cached.mtime === mtime
      ? {
          ...cached,
          byChannel: { ...cached.byChannel, [clave]: runtimeConfig },
        }
      : { rawConfig: config, byChannel: { [clave]: runtimeConfig }, mtime };
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
  const conversation = phone ? getConversationByPhone(phone) : undefined;
  const savedCountry = conversation?.country_code;
  // Messenger y el simulador reciben una selección explícita de país. En
  // WhatsApp, cuando se eligió detectar por lada, una selección antigua no
  // puede convertir un 593 (Ecuador) en Perú: la lada real tiene prioridad.
  const keepsExplicitCountry =
    conversation?.channel === "messenger" || conversation?.channel === "test";
  let result: CountryCode;
  if (savedCountry && keepsExplicitCountry) {
    result = resolveCountry(savedCountry);
  } else {
    const detected =
      config?.country_mode === "auto_phone" ? countryFromPhone(phone) : null;
    if (detected) result = detected;
    else if (savedCountry) result = resolveCountry(savedCountry);
    else result = resolveCountry(config?.country);
  }
  // DIAG TEMPORAL: rastrea la resolución de país en Messenger/simulador.
  //
  // APAGADO SALVO QUE SE PIDA (DIAG_PAIS=1). Esta línea se imprime en CADA
  // resolución de país, y hay decenas por mensaje: el log de una prueba salía
  // con una línea útil por cada cincuenta de ruido, y encontrar qué hizo el bot
  // costaba más que la prueba. Sigue entera para el día que haga falta.
  if (
    process.env.DIAG_PAIS === "1" &&
    conversation &&
    (conversation.channel === "messenger" || conversation.channel === "test")
  ) {
    console.log(
      `[DIAG-PAIS] getEffectiveCountryCode phone=${phone} channel=${conversation.channel} country_code=${savedCountry ?? "null"} mode=${config?.country_mode} -> ${result}`
    );
  }
  return result;
}

export function isCountrySalesEnabled(
  country: CountryCode,
  config = loadWorkflowConfig()
): boolean {
  // "Vender en este país" es una decisión GLOBAL del país: vale para TODAS las
  // modalidades. Si la bandera está puesta, manda ella y no se mira nada más.
  //
  // Antes podía vetarla el perfil de pago, y como el perfil se guarda por
  // modalidad, un país encendido dejaba de vender en las modalidades donde
  // todavía no tenía perfil propio: ahí la capa caía a la raíz, y en la raíz
  // seguía un "no vender" viejo. Se encendía Argentina y vendía en lineal pero
  // no en bioferta, doble oferta ni upsell.
  const flag = config?.country_sales_enabled?.[country];
  if (typeof flag === "boolean") return flag;

  // Sin bandera (configuraciones viejas, de antes de que existiera ese botón)
  // decide el perfil de pago: el de la modalidad activa, o la raíz de respaldo.
  // Es el mismo camino que usa el resto del runtime de pago.
  const profileEnabled = resolveCountryPaymentProfile(country, config)?.enabled;
  if (profileEnabled === false) return false;
  // Modo lista blanca (opt-in): sin bandera, solo vende si el perfil lo activa.
  if (config?.country_sales_whitelist === true) return profileEnabled === true;
  return true;
}

/**
 * Resolver CENTRAL modality-aware de perfiles de pago. Devuelve la CAPA de la
 * modalidad activa para el país; si esa capa no existe, cae a la BASE
 * (payment_profiles_by_country). Todo el runtime de pago pasa por aquí para que
 * cada modalidad sea una "tienda" independiente sin amarres.
 */
export function resolveCountryPaymentProfile(
  country: CountryCode,
  config = loadWorkflowConfig()
): CountryPaymentProfile | undefined {
  if (!config) return undefined;
  const mode = activeModalityKey(config);
  return (
    config.modality_payment_profiles?.[mode]?.[country] ??
    config.payment_profiles_by_country?.[country]
  );
}

export function getCountryPaymentProfile(
  country: CountryCode,
  config = loadWorkflowConfig()
): CountryPaymentProfile | undefined {
  return resolveCountryPaymentProfile(country, config);
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
  const frozen = getFrozenPrices(phone ? getConversationByPhone(phone) : null);
  const activeMode = config ? activeModalityKey(config) : "lineal";
  // Solo se usa el mapa de la misma modalidad. Así una conversación no puede
  // arrastrar precios entre tiendas al cambiar el modo activo del editor.
  const country = getEffectiveCountryCode(phone, config);
  // CAPA por modalidad: el perfil resuelto (capa de la modalidad activa ?? BASE)
  // ya trae el precio propio de esa "tienda". modality_pricing (legado) gana si
  // está seteado; si no, se usa el perfil resuelto.
  const profile = config
    ? resolveCountryPaymentProfile(country, config)
    : undefined;
  const modePrices = config
    ? config.modality_pricing?.[activeModalityKey(config)]?.prices_by_country?.[
        country
      ]
    : undefined;
  // LA FICHA MANDA. Ver `preciosDeLaFichaEnElPais`: si el producto que juega
  // este puesto tiene precio escrito para este país, ése es el que vale. Si no,
  // todo sigue exactamente como antes.
  //
  // EL PUESTO: en Lineal y en Upsell es el producto ÚNICO; en las modalidades de
  // dos opciones, este precio es el del BÁSICO —es lo mismo que hace el reparto
  // cuando llena `course_price_soles`—. Se pregunta por los dos, en ese orden.
  const deLaFicha = (() => {
    const unico = preciosDeLaFichaEnElPais("unico", country, config);
    if (unico.precio !== undefined || unico.descuento !== undefined) return unico;
    return preciosDeLaFichaEnElPais("basico", country, config);
  })();
  // 0 o ausente en la modalidad = "sin definir" -> cae al precio del país.
  // (No usamos ?? porque 0 no dispara el fallback y dejaría el precio en 0.)
  const countryPrice =
    deLaFicha.precio ??
    (typeof profile?.course_price_soles === "number" &&
    profile.course_price_soles > 0
      ? profile.course_price_soles
      : typeof modePrices?.course_price_soles === "number" &&
          modePrices.course_price_soles > 0
        ? modePrices.course_price_soles
        : undefined);
  const countryDiscountPrice =
    deLaFicha.descuento ??
    (typeof profile?.discount_price_soles === "number" &&
    profile.discount_price_soles > 0
      ? profile.discount_price_soles
      : typeof modePrices?.discount_price_soles === "number" &&
          modePrices.discount_price_soles > 0
        ? modePrices.discount_price_soles
        : undefined);
  const fullPrice =
    typeof countryPrice === "number" && Number.isFinite(countryPrice)
      ? countryPrice
      : config?.course_price_soles ?? 10;
  if (!discountActive) {
    const frozenPrice = frozen && frozen.modality === activeMode
      ? (frozen.modality === "order_bump" ? frozen.basico : frozen.base).regular
      : null;
    return typeof frozenPrice === "number" && frozenPrice > 0
      ? Math.min(frozenPrice, fullPrice)
      : fullPrice;
  }
  if (
    typeof countryDiscountPrice === "number" &&
    Number.isFinite(countryDiscountPrice) &&
    countryDiscountPrice > 0 &&
    countryDiscountPrice <= fullPrice
  ) {
    const frozenPrice = frozen && frozen.modality === activeMode
      ? (frozen.modality === "order_bump" ? frozen.basico : frozen.base).discount
      : null;
    return typeof frozenPrice === "number" && frozenPrice > 0
      ? Math.min(frozenPrice, countryDiscountPrice)
      : countryDiscountPrice;
  }
  // Un perfil propio ya delimita el país. Sin oferta propia debe quedarse en
  // su precio base, no tomar el descuento global configurado para otro país.
  const currentPrice = profile
    ? fullPrice
    : config?.discount_after_followup?.price_soles ?? fullPrice;
  const frozenPrice = frozen && frozen.modality === activeMode
    ? (frozen.modality === "order_bump" ? frozen.basico : frozen.base).discount
    : null;
  return typeof frozenPrice === "number" && frozenPrice > 0
    ? Math.min(frozenPrice, currentPrice)
    : currentPrice;
}

/**
 * Guarda al entrar los importes normal y de oferta de la modalidad aplicable.
 * No programa, cancela ni modifica acciones: los seguimientos conservan su
 * calendario actual y solamente consultan estos importes al enviar/validar.
 */
export function freezePricesForConvo(
  convo:
    | {
        id?: number;
        phone?: string | null;
        frozen_prices?: string | null;
        channel?: string | null;
        country_code?: string | null;
      }
    | null
    | undefined
): void {
  if (!convo?.phone || typeof convo.id !== "number" || getFrozenPrices(convo)) return;

  const config = loadWorkflowConfig();
  if (!config) return;
  const modality = activeModalityKey(config);
  // Esta mejora se limita a las modalidades que tienen regla comercial propia.
  // Las demás siguen intactas hasta que se diseñe la suya. "upsell" entra
  // porque vende su primer producto exactamente como Lineal.
  if (
    modality !== "lineal" &&
    modality !== "order_bump" &&
    modality !== "upsell"
  ) {
    return;
  }

  const requiresSelectedCountry =
    convo.channel === "messenger" ||
    convo.channel === "instagram" ||
    convo.channel === "test";
  if (requiresSelectedCountry && !convo.country_code) return;

  const empty = { regular: null, discount: null };
  const map: FrozenPriceMap = {
    modality,
    country: getEffectiveCountryCode(convo.phone, config),
    base: { ...empty },
    combo: { ...empty },
    basico: { ...empty },
    at: Math.floor(Date.now() / 1000),
  };

  // "upsell" congela como Lineal: vende UN producto por el camino de siempre.
  // Sin esto caería en el `else` y guardaría los precios de combo/básico, que
  // son de otra modalidad. El precio del SEGUNDO producto no se congela aquí:
  // se resuelve en el momento de ofrecerlo, con su propia capa por país.
  if (modality === "lineal" || modality === "upsell") {
    map.base.regular = getEffectivePriceSoles(false, convo.phone);
    map.base.discount = getEffectivePriceSoles(true, convo.phone);
  }
  // Y LOS DOS PRECIOS DE LA OFERTA SE CONGELAN SI HAY OFERTA DE DOS.
  //
  // LO QUE PASÓ — 25 de septiembre de 2026. El dueño vende en lineal con el
  // selector «PRESENTA: COMO -OB-», así que la modalidad se llama lineal y aquí
  // solo se guardaba UN precio. Sus dos opciones quedaban sin congelar: al
  // abrirse o cerrarse la ventana de descuento a media conversación, el importe
  // que el cliente tenía delante podía cambiar, y su comprobante volver como «te
  // faltan X». Él lo daba por hecho: «su precio estaba congelado y su
  // comprobante tendrá validez».
  //
  // SE PREGUNTA POR EL DATO —¿hay oferta de dos opciones?— y no por el nombre.
  // Es el mismo `if` que usa el resto del motor para saber si hay dos.
  //
  // NO SUSTITUYE, SUMA. En -OB- de verdad se guarda lo mismo que antes, letra por
  // letra: allí el `if` de arriba no entra y este sí. En Lineal puro este no
  // entra —no hay oferta— y se guarda solo el base, como siempre. Lo único nuevo
  // es la presentación prestada, que ahora guarda los dos.
  if (getActiveTwoTierOffer(config)) {
    map.combo.regular = getOrderBumpPriceSoles("combo", false, convo.phone);
    map.combo.discount = getOrderBumpPriceSoles("combo", true, convo.phone);
    map.basico.regular = getOrderBumpPriceSoles("basico", false, convo.phone);
    map.basico.discount = getOrderBumpPriceSoles("basico", true, convo.phone);
  }

  setFrozenPrices(convo.id, map);
}

/**
 * CON QUÉ PRESENTACIÓN NACE ESTA CONVERSACIÓN — o vacío si ya tiene la suya.
 *
 * Es la misma idea que `freezePricesForConvo`, justo arriba, y se llama en el
 * mismo sitio: lo que ya se le prometió a un cliente no se le cambia por debajo.
 * Ahí se congela el precio; aquí, si le hablamos de un producto o de dos.
 *
 * DEVUELVE EL VALOR, NO ESCRIBE. Y no es un detalle de estilo: `config.ts` no
 * puede ganar dependencias nuevas de la base de datos. Los ~20 bancos de pruebas
 * la importan con un doble que exporta exactamente cinco funciones, así que
 * añadir una sexta los rompe todos a la vez — pasó en el primer intento de esto,
 * 26 pruebas en rojo por un import. Quien escribe es el handler, que ya habla con
 * la base.
 *
 * «ninguna» ES UNA RESPUESTA, no lo mismo que vacío: significa «esta conversación
 * empezó vendiendo un solo producto». Sin guardarlo, al encender el selector la
 * conversación de ayer se leería como si hubiera nacido con dos.
 */
export function laPresentacionConLaQueNace(
  convo:
    | {
        id?: number;
        presentacion_de_venta?: string | null;
      }
    | null
    | undefined
): SegundaOpcionPrestada | "ninguna" | null {
  if (typeof convo?.id !== "number") return null;
  if (convo.presentacion_de_venta) return null;
  const config = loadWorkflowConfig();
  if (!config) return null;
  return laPresentacionQueDiceElSelector(config) ?? "ninguna";
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
  //
  // Como las otras dos, va por activeModalityKey para que el simulador pueda
  // probarla mientras las clientas siguen en la de siempre. En real:
  // key === "bioferta" ⟺ bioferta.enabled && !order_bump.enabled &&
  // !doble_oferta_dos.enabled — la misma condición de antes.
  const cfg = loadWorkflowConfig();
  if (!cfg) return false;
  return !!cfg.bioferta_doble?.enabled && activeModalityKey(cfg) === "bioferta";
}

/** Precio del pack (los 2 juntos) en soles, o null si la bioferta está apagada
 *  o el precio no es válido. */
export function getBiofertaPackPriceSoles(
  discountActive = false,
  phone?: string | null
): number | null {
  const bf = loadWorkflowConfig()?.bioferta_doble;
  if (!bf?.enabled) return null;
  // Capa POR PAÍS encima del precio global, igual que el combo del order bump.
  const delPais = resolveCountryPaymentProfile(
    getEffectiveCountryCode(phone)
  )?.bioferta;
  const valido = (n?: number): number | undefined =>
    typeof n === "number" && n > 0 ? n : undefined;
  const paisRegular = valido(delPais?.pack_price_soles);
  const paisPromo = valido(delPais?.pack_discount_price_soles);
  // La OFERTA nunca se hereda de otro país: si este país pone su propio precio
  // de pack, su oferta tiene que salir también de aquí. Si no lo pone, se usan
  // los dos globales, que es exactamente lo de antes.
  const regular = paisRegular ?? valido(bf.pack_price_soles);
  const promo = paisRegular
    ? paisPromo
    : valido(bf.pack_discount_price_soles);
  if (discountActive && promo !== undefined) return promo;
  return regular ?? null;
}

/** Precio efectivo de la opción elegida en Doble Oferta. Los productos A/B
 * comparten el precio individual; el pack tiene precio normal/promocional. */
export function getBiofertaPriceSoles(
  choice: "a" | "b" | "pack",
  discountActive: boolean,
  phone?: string | null
): number | null {
  return choice === "pack"
    ? getBiofertaPackPriceSoles(discountActive, phone)
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
      .filter((k) => k.length >= 3 && !(k.includes("<<") && k.includes(">>")))
      // WhatsApp corta el título de un botón a 20 caracteres, así que la
      // respuesta que llega de un nombre largo viene cortada y no contendría el
      // nombre completo. Aceptamos también ese recorte.
      .flatMap((k) => (k.length > 20 ? [k, k.slice(0, 20).trim()] : [k]));
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

/**
 * ¿Se puede ofrecer el upsell? Además del interruptor, exige que esté
 * COMPLETO: sin nombre no hay cómo reconocer que lo quiere, sin precio no hay
 * qué cobrar, y sin entrega no hay qué mandar cuando pague. Antes que ofrecer
 * algo que no se puede cerrar, no se ofrece.
 */
/**
 * QUÉ LE FALTA A LA ETAPA PARA PODER OFRECERSE.
 *
 * Las mismas cuatro condiciones de `isUpsellUsable`, pero dichas en voz alta.
 *
 * Sin esto, «no se ofrece» era indistinguible de «está roto»: el bot entregaba,
 * seguía con el regalo y no dejaba ni una línea explicando por qué se saltó la
 * segunda venta. Se pierde una tarde probando a ciegas para descubrir que
 * faltaba una casilla — pasó, con la etapa de Lineal.
 *
 * Devuelve la lista vacía cuando está lista. Se usa SOLO para explicar; quien
 * decide sigue siendo `isUpsellUsable`, y las dos leen lo mismo para que no
 * puedan decir cosas distintas.
 */
export function queLeFaltaAlUpsell(config?: WorkflowConfig | null): string[] {
  const cfg = config ?? loadWorkflowConfig();
  const up = seccionUpsell(cfg);
  if (!up) return ["la etapa entera (esta modalidad no tiene ninguna guardada)"];
  const falta: string[] = [];
  if (up.enabled !== true) falta.push("el INTERRUPTOR (está apagado)");
  const nombre = (up.name ?? "").trim();
  if (nombre.length < 2) falta.push("el NOMBRE del producto");
  else if (nombre.includes("<<") && nombre.includes(">>")) {
    falta.push(`el NOMBRE (sigue siendo texto de muestra: ${nombre})`);
  }
  const entrega = up.delivery;
  if (!Array.isArray(entrega) || entrega.length === 0) {
    falta.push("la ENTREGA (vacía aquí y en el grupo UPSELL de este canal)");
  } else if (sectionHasPlaceholder(entrega)) {
    falta.push("la ENTREGA (tiene comodines <<...>> sin rellenar)");
  }
  // POR EL PRECIO ESCRITO, NO POR `getUpsellPriceSoles`.
  //
  // Esa devuelve null cuando la etapa está APAGADA, así que con el interruptor
  // en off este aviso decía además «falta el PRECIO» con el precio
  // perfectamente puesto — y mandaba a buscar un problema que no existía.
  if (precioEscritoDeLaEtapa(up, false, null, cfg) === null) {
    falta.push("el PRECIO (0 o sin poner)");
  }
  return falta;
}

export function isUpsellUsable(config?: WorkflowConfig | null): boolean {
  const cfg = config ?? loadWorkflowConfig();
  // CANDADO DE MODALIDAD: el producto extra solo existe en las modalidades que
  // lo tienen —Upsell y Doble Oferta + Upsell— y cada una lee EL SUYO. Con
  // Lineal, Order Bump o la Doble Oferta de siempre no se ofrece nunca: cada
  // modalidad se sirve de lo suyo (regla 5-bis). seccionUpsell devuelve null
  // fuera de esas dos, así que el candado sigue puesto. En el simulador esto
  // sigue a la modalidad de prueba.
  const up = seccionUpsell(cfg);
  if (up?.enabled !== true) return false;
  const nombre = (up.name ?? "").trim();
  if (nombre.length < 2 || (nombre.includes("<<") && nombre.includes(">>"))) {
    return false;
  }
  const entrega = up.delivery;
  if (!Array.isArray(entrega) || entrega.length === 0) return false;
  if (sectionHasPlaceholder(entrega)) return false;
  return getUpsellPriceSoles(false, null, cfg) !== null;
}

/** Precio del upsell, con capa por país igual que el resto. */
export function getUpsellPriceSoles(
  discountActive = false,
  phone?: string | null,
  config?: WorkflowConfig | null
): number | null {
  // Acepta la configuración por parámetro igual que el resto: sin esto,
  // `isUpsellUsable(config)` decidía con una configuración y consultaba el
  // precio en otra — el archivo del disco. Ver la prueba de la tabla.
  const up = seccionUpsell(config);
  if (!up?.enabled) return null;
  return precioEscritoDeLaEtapa(up, discountActive, phone, config);
}

/**
 * EL PRECIO ESCRITO, SIN MIRAR EL INTERRUPTOR.
 *
 * Lo mismo que `getUpsellPriceSoles`, pero contestando solo a «¿hay un precio
 * puesto?». Existe porque el aviso de lo que falta preguntaba por el precio a
 * la función de arriba, y esa devuelve null cuando la etapa está APAGADA — así
 * que con el interruptor en off el aviso decía además «falta el PRECIO» con el
 * precio perfectamente puesto. Mandaba a buscar un problema que no existía.
 *
 * No se exporta: quien decide si se cobra sigue siendo `getUpsellPriceSoles`,
 * con su interruptor y su precio congelado. Esto solo explica.
 */
function precioEscritoDeLaEtapa(
  up: UpsellConfig,
  discountActive: boolean,
  phone?: string | null,
  config?: WorkflowConfig | null
): number | null {
  // LA CAPA POR PAÍS, DE LA MISMA CONFIGURACIÓN.
  //
  // `seccionUpsell` ya respetaba el parámetro, pero estas dos seguían cayendo
  // al archivo del disco por su valor por defecto. O sea: se decidía con una
  // configuración y se consultaba el precio en otra. En producción coinciden
  // —siempre se pasa la que se acaba de cargar—, pero es una trampa puesta, y
  // basta con que alguien pregunte por una configuración de prueba para que
  // conteste con el precio del archivo real.
  const cfg = config ?? loadWorkflowConfig();
  const delPais = resolveCountryPaymentProfile(
    getEffectiveCountryCode(phone, cfg),
    cfg
  )?.upsell;
  const valido = (n?: number): number | undefined =>
    typeof n === "number" && n > 0 ? n : undefined;
  // UNA OFERTA DE LA FILA TRAE SUS PROPIOS PRECIOS POR PAÍS —los de su ficha, o los del
  // downsell— y NO HEREDA NINGUNO del upsell de siempre: ni su capa de país ni su precio
  // suelto. Heredarlo sería cobrarle al producto 3 lo que vale el 1. Ver la salida de
  // justo debajo de `deLaFicha`.
  const deLaFila = up.de_la_fila;
  // LA FICHA DEL PRODUCTO UPSELL MANDA. Ver `preciosDeLaFichaEnElPais`.
  //
  // Y aquí se nota doble: sin precio, este producto NO SE OFRECE —lo exige
  // `isUpsellUsable`—, así que el dueño veía «NO lo ofrezco, le falta el PRECIO»
  // con el precio escrito en la ficha del producto. Ahora se lee de donde él lo
  // escribe.
  const deLaFicha = preciosDeLaFichaEnElPais(
    "upsell",
    getEffectiveCountryCode(phone ?? deLaFila?.phone, cfg),
    cfg,
    deLaFila
  );
  // Sin su precio en ese país, no hay precio —el del upsell de siempre no le sirve—, y un
  // producto sin precio no se ofrece ni se cobra (`isUpsellUsable`). Con precio, la capa
  // del país de abajo ya no pinta nada: la ficha manda, como siempre.
  if (deLaFila && deLaFicha.precio === undefined) return null;
  const paisRegular = deLaFicha.precio ?? valido(delPais?.price_soles);
  const paisPromo = deLaFicha.precio
    ? deLaFicha.descuento
    : valido(delPais?.discount_price_soles);
  // La oferta no se hereda entre países: si este pone su precio, su promoción
  // sale también de aquí. Misma regla que el pack de la Doble Oferta.
  const regular = paisRegular ?? valido(up.price_soles);
  const promo = paisRegular ? paisPromo : valido(up.discount_price_soles);
  const vivo = discountActive && promo !== undefined ? promo : regular ?? null;
  // ── EL PRECIO QUE SE LE DIJO MANDA ──────────────────────────────────────
  //
  // Igual que el primer producto con `frozen_prices`. Sin esto, tocar el precio
  // en el panel entre la invitación y el comprobante cambiaba el monto contra
  // el que se valida: se le pedía uno y se le contaba otro. No da error — le
  // dice que le falta dinero a quien pagó lo que se le pidió.
  //
  // La misma regla que el resto de la casa, y en la misma dirección: NUNCA se
  // le cobra más de lo cotizado, pero si el precio de hoy es MENOR, gana el
  // menor. Bajar un precio beneficia al cliente; subirlo no le puede alcanzar.
  //
  // Sin teléfono no hay conversación que consultar —el editor, el simulador,
  // `isUpsellUsable`— y ahí se contesta con el precio de hoy, como siempre.
  if (!phone) return vivo;
  const congelado = getUpsellFrozenPrices(getConversationByPhone(phone));
  // GUARDA HERMÉTICA: si el bot cambió de modalidad después de cotizar, ese
  // precio era de otra tienda y no se arrastra a esta.
  if (!congelado || (cfg && congelado.modalidad !== activeModalityKey(cfg))) {
    return vivo;
  }
  const cotizado = discountActive ? congelado.discount : congelado.regular;
  if (typeof cotizado !== "number" || !(cotizado > 0)) return vivo;
  return vivo !== null ? Math.min(cotizado, vivo) : cotizado;
}

/**
 * ¿Está pidiendo el segundo producto? Exige una señal INEQUÍVOCA — su nombre
 * o un alias — nunca un "sí" pelado: cuando ya salió el regalo hay dos
 * preguntas abiertas y el "sí" es del regalo, que es la más reciente.
 */
export function detectaAceptacionDeUpsell(
  msg: string,
  config?: WorkflowConfig | null
): boolean {
  const up = seccionUpsell(config);
  if (!up?.enabled) return false;
  const lower = (msg ?? "").toLowerCase();
  if (!lower.trim()) return false;
  // NOMBRARLO NO ES QUERERLO SI SE ESTÁ PREGUNTANDO POR ÉL.
  //
  // LO QUE PASÓ — 26 de septiembre de 2026, su prueba HOLAPER1. Tras entregarle
  // su compra, el bot le ofreció el producto extra y él escribió:
  //
  //     «las tintas pepito cuanto cuestan»
  //
  // Esto lo leyó como un «sí, lo quiero» —porque nombra el producto— y le soltó
  // los datos de pago con el importe. Con sus palabras: «no puede ser que al
  // decir las tintas pepito cuanto cuestan enviar los datos, cualquier persona
  // abandona la conversación porque le están diciendo que pague».
  //
  // Y NO ES UN FALLO DEL CRITERIO ENTERO: en la misma tanda, «como es lo de las
  // tintas» SÍ se contestó explicando. Lo que faltaba era distinguir la pregunta
  // de la aceptación, que es una diferencia de ESTRUCTURA y no de palabras: se
  // reutilizan las dos funciones que ya deciden eso en todo el motor.
  //
  // PEDIRLO POR SU NOMBRE SIGUE VALIENDO: «quiero las tintas», «dale, las
  // tintas», «me llevo las tintas» no son preguntas y entran igual que ayer.
  if (isPriceQuestion(msg) || isProductInformationQuestion(msg)) return false;
  const claves = [up.name, ...(up.aliases ?? [])]
    .map((k) => (k ?? "").trim().toLowerCase())
    .filter((k) => k.length >= 3 && !(k.includes("<<") && k.includes(">>")))
    .flatMap((k) => (k.length > 20 ? [k, k.slice(0, 20).trim()] : [k]));
  return claves.some((k) => lower.includes(k));
}

/**
 * ¿Está diciendo que SÍ, a secas?
 *
 * Solo debe usarse MIENTRAS el regalo no haya salido. Hasta entonces la única
 * pregunta abierta es la del producto extra y un "sí" es inequívoco. Después
 * hay dos preguntas y el "sí" es del regalo, que es la más reciente — por eso
 * quien llama a esto lo hace bajo la misma guarda que el "no".
 *
 * Aparte de esto sigue valiendo pedirlo por su NOMBRE en cualquier momento, que
 * es lo que mantiene viva la oferta cuando ya pasó el plazo.
 */
/**
 * ¿ESTE TEXTO ES LA ETIQUETA DE UNO DE LOS BOTONES DEL UPSELL?
 *
 * WhatsApp no manda el botón: manda su TEXTO. Antes el bot lo cambiaba por el
 * nombre del producto para poder reconocerlo, y en la conversación quedaba
 * escrito algo que el cliente nunca escribió ("PRODUCTO UPSELL" donde él tocó
 * "Sí, lo quiero"). Al leer un chat para entender qué pasó, eso engaña.
 *
 * Ahora llega el texto del botón tal cual y se compara contra las etiquetas que
 * están configuradas. Es exacto: no adivina, no depende de cómo se escribieron.
 *
 * Se acepta también la etiqueta CORTADA a 20 caracteres, que es el tope de
 * WhatsApp: con una etiqueta más larga vuelve recortada y una comparación
 * literal fallaría justo en el "sí".
 */
export function botonDelUpsell(
  msg: string,
  config?: WorkflowConfig | null
): "si" | "no" | null {
  const up = seccionUpsell(config);
  if (!up?.enabled) return null;
  // Fuera acentos, emojis y signos: la etiqueta lleva "✅" y una coma, y eso no
  // debe decidir si se reconoce o no.
  const limpiar = (t: string): string =>
    (t ?? "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Mn}/gu, "")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  const recibido = limpiar(msg);
  if (!recibido) return null;
  const coincide = (etiqueta?: string): boolean => {
    const cruda = (etiqueta ?? "").trim();
    if (!cruda) return false;
    const formas = [limpiar(cruda), limpiar(cruda.slice(0, 20))];
    return formas.some((f) => f.length > 0 && f === recibido);
  };
  if (coincide(up.boton_si)) return "si";
  if (coincide(up.boton_no)) return "no";
  return null;
}

/**
 * ¿ESTE TEXTO ES LA ETIQUETA DE UNO DE LOS BOTONES DEL REGALO?
 *
 * El hermano del de arriba, y por la misma razón: WhatsApp no manda el botón,
 * manda su TEXTO. Comparado contra las etiquetas configuradas es EXACTO — no
 * adivina, no depende de cómo se escribieron.
 *
 * Y aquí hacía falta el doble. El regalo y la oferta del segundo producto
 * pueden estar abiertos A LA VEZ, así que un «sí» suelto lo puede reclamar
 * cualquiera de los dos. Una etiqueta tocada, no: nadie escribe por casualidad
 * el texto exacto de un botón. Es la única señal que no admite discusión, y por
 * eso se mira ANTES que ninguna palabra clave.
 *
 * Se acepta también la etiqueta CORTADA a 20 caracteres, que es el tope de
 * WhatsApp: con una etiqueta más larga vuelve recortada y una comparación
 * literal fallaría justo en el "sí".
 */
export function botonDelRegalo(
  msg: string,
  config?: WorkflowConfig | null
): "si" | "no" | null {
  const gift = (config ?? loadWorkflowConfig())?.gift_mechanic;
  if (!gift?.consent_buttons_enabled) return null;
  const limpiar = (t: string): string =>
    (t ?? "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Mn}/gu, "")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  const recibido = limpiar(msg);
  if (!recibido) return null;
  const coincide = (etiqueta?: string): boolean => {
    const cruda = (etiqueta ?? "").trim();
    if (!cruda) return false;
    const formas = [limpiar(cruda), limpiar(cruda.slice(0, 20))];
    return formas.some((f) => f.length > 0 && f === recibido);
  };
  // Los botones escritos a mano mandan sobre los de fábrica: son los que el
  // cliente tiene delante. Se miran en el mismo orden en que se le enviaron.
  const configurados = Array.isArray(gift.consent_buttons)
    ? gift.consent_buttons
    : [];
  for (const boton of configurados) {
    if (!coincide(boton.label)) continue;
    if (boton.action === "accept") return "si";
    if (boton.action === "reject") return "no";
    // action "text" no decide nada: es un botón que solo abre conversación.
    return null;
  }
  // Y si no hay botones escritos, los dos de siempre con sus etiquetas.
  if (configurados.length === 0) {
    if (coincide(gift.consent_yes_label?.trim() || "Si quiero")) return "si";
    if (coincide(gift.consent_no_label?.trim() || "Por ahora no")) return "no";
  }
  return null;
}

/**
 * Las decisiones que cuentan: las encendidas.
 *
 * Lo usan los DOS sitios que preguntan por ellas —el que decide si la burbuja
 * espera respuesta y el que reconoce lo que escribió el cliente—. Teniendo cada
 * uno su propio filtro, la burbuja podría quedarse esperando una respuesta que
 * ningún cuadrito encendido va a reconocer: detenida para siempre y sin que
 * nada lo explique.
 */
export function decisionesEncendidas(
  decisiones: BubbleDecision[] | undefined
): BubbleDecision[] {
  return Array.isArray(decisiones)
    ? decisiones.filter((decision) => decision.enabled !== false)
    : [];
}

/**
 * ¿CUÁL DE LAS DECISIONES DE ESTA BURBUJA ELIGIÓ EL CLIENTE?
 *
 * Compara lo que escribió con las palabras clave de cada cuadrito. Devuelve la
 * primera que acierte, o null si ninguna — y entonces la conversación sigue su
 * camino normal, que es lo correcto: la pregunta era opcional.
 *
 * Se compara sin tildes ni mayúsculas, y por PALABRAS COMPLETAS. Buscar el
 * trozo suelto haría que "no" acertara dentro de "nota" o de "no sé cuánto
 * cuesta", y ahí el cliente estaría preguntando, no eligiendo.
 *
 * Si dos cuadritos comparten una palabra, gana el primero: el orden en pantalla
 * es el orden de prioridad, que es lo que uno espera al verlos en fila.
 */
export function decisionQueCoincide(
  msg: string,
  todas: BubbleDecision[] | undefined
): BubbleDecision | null {
  const decisiones = decisionesEncendidas(todas);
  if (decisiones.length === 0) return null;
  const limpiar = (t: string): string =>
    (t ?? "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Mn}/gu, "")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  const dicho = ` ${limpiar(msg)} `;
  if (dicho.trim().length === 0) return null;
  const palabrasDe = (decision: BubbleDecision): string[] =>
    (decision.keywords ?? []).map(limpiar).filter(Boolean);
  for (const decision of decisiones) {
    for (const clave of palabrasDe(decision)) {
      if (dicho.includes(` ${clave} `)) return decision;
    }
  }
  // EL COMODÍN: un cuadrito SIN palabras es el de "cualquier otra respuesta".
  //
  // Sin él, quien no contesta con las palabras previstas no recibe ninguna
  // rama. Dejarlo vacío es la forma natural de pedirlo —no hay nada que
  // escribir— y así no hace falta inventar un interruptor aparte.
  //
  // Va DESPUÉS de todas las demás: si se mirara antes, se comería los "sí" y
  // los "no" que sí estaban previstos.
  return decisiones.find((decision) => palabrasDe(decision).length === 0) ?? null;
}

/**
 * EL «SÍ» A SECAS. A SECAS DE VERDAD.
 *
 * Miraba solo CÓMO EMPIEZA el mensaje, y con eso una frase entera se convertía
 * en una venta por su primera palabra:
 *
 *   «ya pagué 7000 si pago 500 me entregan»  →  empieza por «ya»  →  aceptado
 *
 * Ese cliente estaba PREGUNTANDO —y encima con una idea equivocada, porque el
 * extra es un producto aparte, no la diferencia—. El bot le dio por aceptada la
 * compra y le mandó los datos de pago en vez de contestarle.
 *
 * Sin tildes «sí» y «si» son la misma palabra, y la gente no escribe signos de
 * interrogación. Así que perseguir la diferencia con más palabras es perseguir
 * algo que la lista no puede saber: hace falta ENTENDER la frase.
 *
 * La lista se queda con lo que sí puede afirmar sin entender nada: que el
 * mensaje ES esa respuesta y nada más. El vocabulario no cambia ni una palabra
 * —son exactamente los mismos de antes—; lo que cambia es que ahora tienen que
 * cubrir el mensaje ENTERO en vez de solo su principio.
 *
 * Y no se pierde ninguna venta: lo que ya no decide aquí lo lee el modelo, que
 * tiene el marcador <<QUIERE_EXTRA>> y la instrucción de emitirlo solo cuando la
 * intención es clara. El sistema sigue siendo quien entrega los datos.
 */
export function detectaSiSimpleAlUpsell(msg: string): boolean {
  const t = (msg ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .replace(/[!¡.,¿?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return false;
  return /^(si|sii+|claro|dale|ya|obvio|dame|lo quiero|la quiero|me lo llevo|me la llevo|quiero|dalee+|dale pues|dale si|dsp no|dale ok|ok|okey|dale gracias|si porfa|si por favor|si quiero|sip|dale vamos)$/.test(
    t
  );
}

/**
 * LO QUE DE VERDAD ES UN «NO» A LA OFERTA DEL EXTRA.
 *
 * La lista es CERRADA y se compara ENTERA, igual que la del «sí». Antes el
 * patrón era `^(no|…)\b`: bastaba con EMPEZAR por «no» para darlo por
 * rechazado, y detrás podía ir cualquier cosa.
 *
 * Así que «no entiendo» era un no. Y «no sé», «no me llegó», «no puedo pagar
 * ahora», «no tengo yape». El cliente preguntaba qué era el segundo producto y
 * el bot le pedía perdón por habérselo ofrecido. La duda de alguien interesado,
 * leída como un portazo.
 *
 * El detector del «sí» siempre comparó la frase entera. Este no, y esa
 * asimetría es la que costaba la venta: equivocarse hacia el «sí» se nota y se
 * corrige; equivocarse hacia el «no» cierra la conversación y nadie se entera.
 *
 * Lo que no esté aquí lo atiende el modelo, que para eso está.
 */
const RECHAZOS_DEL_EXTRA = new Set([
  "no",
  "no gracias",
  "no grax",
  "no gracias por ahora",
  "nel",
  "nop",
  "nope",
  "paso",
  "paso gracias",
  "no quiero",
  "no lo quiero",
  "no me interesa",
  "asi esta bien",
  "asi estoy bien",
  "solo eso",
  "eso es todo",
  "nada mas",
  "no por ahora",
  "por ahora no",
  "ahorita no",
  "ahora no",
  "hoy no",
  "despues",
  "mas adelante",
  "luego",
  "otro dia",
]);

export function detectaRechazoDeUpsell(msg: string): boolean {
  const t = (msg ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    // La misma limpieza que el «sí»: «no, gracias.» y «no gracias» son lo
    // mismo, y antes la coma bastaba para que no coincidiera.
    .replace(/[!¡.,¿?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return false;
  return RECHAZOS_DEL_EXTRA.has(t);
}

/** Nombres de las 3 opciones de Doble Oferta para los BOTONES del final de la
 *  intro. Devuelve null si alguno falta o sigue siendo un placeholder: con
 *  nombres a medias es mejor no mandar los botones que mandar "Producto 1". */
export function getBiofertaIntroChoiceOptions(
  config: WorkflowConfig | null
): { a: string; b: string; pack: string } | null {
  const bf = config?.bioferta_doble;
  if (!bf) return null;
  const usable = (p?: BiofertaProduct): string | null => {
    const name = (p?.name ?? "").trim();
    if (name.length < 2) return null;
    if (name.includes("<<") && name.includes(">>")) return null;
    return name;
  };
  const a = usable(bf.product_a);
  const b = usable(bf.product_b);
  const pack = usable(bf.pack);
  return a && b && pack ? { a, b, pack } : null;
}

/** ¿La intro de Doble Oferta debe terminar mostrando las 3 opciones? Solo si la
 *  modalidad está activa, el interruptor no está apagado a mano y los 3 nombres
 *  están configurados. */
export function shouldOfferBiofertaChoiceOnIntro(
  config: WorkflowConfig | null
): boolean {
  if (!isBiofertaActive()) return false;
  if (config?.bioferta_doble?.choice_on_intro_enabled === false) return false;
  return getBiofertaIntroChoiceOptions(config) !== null;
}

/** ¿Está activo el Order Bump? Único punto de verdad para gatearlo todo. */
export function isOrderBumpActive(): boolean {
  // EXCLUSIVIDAD: si Doble Oferta 2 Prod está activa, order bump NO cuenta
  // (precedencia doble_oferta_dos > order_bump). Evita que la entrega/elección se
  // mezclen entre modalidades.
  //
  // Va por activeModalityKey para que el SIMULADOR pueda manejar otra modalidad
  // sin tocar la que están viendo las clientas. En una conversación real el
  // almacén está vacío y esto vale exactamente lo mismo que antes:
  // key === "order_bump" ⟺ order_bump.enabled && !doble_oferta_dos.enabled.
  const cfg = loadWorkflowConfig();
  if (!cfg) return false;
  if (!!cfg.order_bump?.enabled && activeModalityKey(cfg) === "order_bump") {
    return true;
  }
  // LA PRESENTACIÓN PRESTADA TAMBIÉN CUENTA. Ver `segundaOpcionPrestada`.
  //
  // El dueño lo pidió así y tiene razón: «quiero tener todas las ranuras en
  // lineal, y con el selector solo cambiar y que cambie el comportamiento como
  // si hubieses cambiado a -OB-».
  //
  // POR QUÉ SE ARREGLA AQUÍ Y NO EN CADA SITIO. Hay 62 puertas que preguntan
  // «¿soy esta modalidad?», y las 62 pasan por estas dos funciones. Cambiar las
  // llamadas una a una sería tocar 62 trozos de código que hoy funcionan; se
  // contesta en el único sitio donde se decide.
  //
  // Y SE PREGUNTA POR EL DATO, no por el nombre: hace falta que exista de
  // verdad una oferta de dos opciones —con sus dos nombres resueltos—. Sin el
  // segundo producto sentado esto sigue diciendo «no», que es lo que debe
  // decir: presentar dos cuando solo hay una es peor que no presentar nada.
  return vendeConPresentacionPrestada(cfg, "segunda_oculta");
}

/** Doble Oferta 2 Productos activa. Mutuamente excluyente con order_bump y
 *  bioferta_doble; si varias estuvieran encendidas, order_bump tiene precedencia
 *  (ver getActiveTwoTierOffer). */
export function isDobleOfertaActive(): boolean {
  // Real: key === "doble_oferta_dos" ⟺ doble_oferta_dos.enabled (es la de mayor
  // precedencia), o sea el mismo valor de siempre. Ver isOrderBumpActive.
  const cfg = loadWorkflowConfig();
  if (!cfg) return false;
  const key = activeModalityKey(cfg);
  // Doble Oferta + Upsell vende EXACTAMENTE igual en esta parte: dos opciones,
  // se elige una y se entrega esa. Todo lo que gatea por aquí —la elección, el
  // ruteo del pago, la entrega— vale para las dos sin cambiar una línea.
  if (key === "doble_oferta_upsell") return !!cfg.doble_oferta_upsell?.enabled;
  if (!!cfg.doble_oferta_dos?.enabled && key === "doble_oferta_dos") return true;
  // LA PRESENTACIÓN PRESTADA. El mismo motivo que en `isOrderBumpActive`: aquí
  // pasan las 26 puertas que preguntan por este nombre, así que se contesta una
  // vez. Y por el DATO: sin los dos nombres resueltos sigue diciendo «no».
  return vendeConPresentacionPrestada(cfg, "dos_juntas");
}

/**
 * La sección del segundo/tercer producto de la modalidad ACTIVA.
 *
 * Punto único: cada modalidad lee la SUYA y ninguna la de otra. Antes se leía
 * `config.upsell` a pelo en ocho sitios, y con dos modalidades que tienen
 * upsell eso serviría el producto equivocado.
 */
export function seccionUpsell(
  config?: WorkflowConfig | null
): UpsellConfig | null {
  const cfg = config ?? loadWorkflowConfig();
  if (!cfg) return null;
  const deSiempre = seccionUpsellDeSiempre(cfg);
  // UPSELLS EN FILA. Si la conversación del turno va por un producto de la fila —o por su
  // downsell— se contesta con ESE, vestido de upsell. Si no, lo de siempre, tal cual: sin
  // conversación en el turno, o con su puesto vacío, esta línea no cambia nada.
  const id = conversacionDeLaFila.getStore();
  if (!id) return deSiempre;
  const puesto = getPuestoEnLaFila(id);
  if (!puesto || (!puesto.upsell_producto_id && !puesto.upsell_downsell)) {
    return deSiempre;
  }
  return vestirLaOfertaDeLaFila(deSiempre, puesto, cfg);
}

/** El upsell de la modalidad activa, sin mirar la fila. Es lo que era `seccionUpsell`. */
function seccionUpsellDeSiempre(cfg: WorkflowConfig): UpsellConfig | null {
  const key = activeModalityKey(cfg);
  if (key === "doble_oferta_upsell") return cfg.doble_oferta_upsell?.upsell ?? null;
  // LA ETAPA UPSELL YA NO ES DE DOS MODALIDADES: ES DE LA QUE LA TENGA LLENA.
  //
  // Antes esto devolvía `null` en Lineal, Order Bump y Doble Oferta, y ese null
  // era LO ÚNICO que les impedía ofrecer un segundo producto. Todo lo de
  // después —el precio, el cobro, la validación del comprobante, la entrega, el
  // cerebro y la espera del regalo— ya pasa por aquí y nunca pregunta por la
  // modalidad. Era una puerta cerrada, no una tubería que faltara.
  //
  // Ahora cada modalidad guarda SU etapa en su capa, y el editor proyecta la de
  // la que vende a `cfg.upsell` — igual que hace con la intro o el regalo. Así
  // que leer de ahí es leer la de la modalidad activa, sin prestarle nada a
  // nadie: la regla 5-bis se mantiene.
  //
  // Y sigue siendo seguro por omisión: una etapa vacía no pasa `isUpsellUsable`
  // —exige encendida, con nombre, con entrega y con precio—, así que hasta que
  // el operador la llene y la encienda, su modalidad se comporta igual que hoy.
  return cfg.upsell ?? null;
}

// ═══════════════════════════════════════════════════════════════════════════
// UPSELLS EN FILA Y DOWNSELL — FASE 3, EL MOTOR. Ver PLAN-UPSELLS-EN-FILA.md.
//
// LA IDEA, Y ES LO QUE PROTEGE EL RELOJ: el motor sigue viendo UN SOLO upsell a la vez.
// Cuando a una conversación le toca un producto de la fila, `seccionUpsell` se lo da
// «vestido» de upsell —su ficha + su presentación— y todo lo de siempre (ofrecer, cobrar,
// validar el comprobante, entregar, el Cerebro, el recordatorio) pasa por donde pasaba.
//
// Las reglas que dictó el dueño, y dónde vive cada una:
//   · el upsell de hoy es el 1 y no se toca                → `seccionUpsellDeSiempre`
//   · cada producto con sus minutos                       → `retraso_minutos` del vestido
//   · al primer «no» o silencio, nada más                 → `upsell_fila_parada`
//   · nunca se ofrece lo que ya compró, ni el principal   → `siguienteDeLaFila`
//   · el downsell, solo en el último y una vez            → `debeOfrecerseElDownsell`
//   · un producto a medias se salta, nunca se ofrece así  → `sePuedeOfrecerDeLaFila`
// ═══════════════════════════════════════════════════════════════════════════

/** Sus precios en un país, con la misma forma que `preciosDeLaFichaEnElPais`. */
export function preciosDeLaOfertaDeLaFila(
  oferta: OfertaDeLaFila,
  country: string | null | undefined
): { precio?: number; descuento?: number; tachado?: number } {
  if (!country) return {};
  const suyos = oferta.precios?.[String(country).toUpperCase()];
  if (!suyos) return {};
  const positivo = (n: unknown): number | undefined =>
    typeof n === "number" && Number.isFinite(n) && n > 0 ? n : undefined;
  return {
    precio: positivo(suyos.price_soles),
    descuento: oferta.downsell ? undefined : positivo(suyos.discount_price_soles),
    tachado: positivo(suyos.market_price),
  };
}

/**
 * LA FILA DE ESTA CONVERSACIÓN: la que ya empezó, o la de su tienda.
 *
 * La de su tienda se elige con `soloDeSuTienda`, la misma regla que los cajones de intro:
 * la escrita para ESTA tienda; si no hay, la general; la de otra tienda, nunca.
 */
export function filaDeLaConversacion(
  cfg: WorkflowConfig,
  puesto: Pick<PuestoEnLaFila, "upsell_fila_id"> | null
): FilaDeUpsell | null {
  const filas = Array.isArray(cfg.filas_de_upsell) ? cfg.filas_de_upsell : [];
  if (filas.length === 0) return null;
  // La que ya empezó manda, aunque luego la apaguen: a quien tiene una oferta delante no
  // se le cambia a mitad. Para AVANZAR sí se exige encendida (ver `siguienteDeLaFila`).
  if (puesto?.upsell_fila_id) {
    return filas.find((f) => f?.id === puesto.upsell_fila_id) ?? null;
  }
  const encendidas = filas.filter((f) => f && f.enabled !== false);
  // SIN RESPALDO ENTRE TIENDAS: una tienda sin fila propia no toma la general (17/10/2026).
  if (
    !usaRespaldoEntreTiendas(cfg) &&
    aLaTiendaLeFaltaLoSuyo(encendidas, tiendasDe, laTiendaDelTurno()?.id ?? null)
  ) {
    return null;
  }
  return (
    soloDeSuTienda(encendidas, tiendasDe, laTiendaDelTurno()?.id ?? null)[0] ??
    null
  );
}

/** Los cajones de la ficha, con sus burbujas en el formato que lee el motor. */
function cajonesDeLaFicha(grupos: GrupoDeIntro[] | undefined): GrupoDeIntro[] {
  return (Array.isArray(grupos) ? grupos : []).map((g) => ({
    ...g,
    steps: burbujasDeLaFicha(g?.steps),
  }));
}

/**
 * LA PRESENTACIÓN QUE TOCA EN EL CANAL DE ESTE TURNO.
 *
 * La regla de Canales, campo a campo: lo escrito para Messenger o Instagram manda, y cada
 * campo en blanco deja mandar al de arriba, que es el de WhatsApp. En WhatsApp —y sin canal
 * en el turno— es la de arriba, tal cual.
 */
export function presentacionEnEsteCanal(
  pres: PresentacionComoUpsell | undefined
): PresentacionComoUpsell {
  const base = pres ?? {};
  const canal = getActiveWorkflowChannel();
  const suya =
    canal === "messenger"
      ? base.por_canal?.messenger
      : canal === "instagram"
        ? base.por_canal?.instagram
        : undefined;
  if (!suya) return base;
  const lista = <T,>(propia: T[] | undefined, deArriba: T[] | undefined) =>
    Array.isArray(propia) && propia.length > 0 ? propia : deArriba;
  const texto = (propio: string | undefined, deArriba: string | undefined) =>
    (propio ?? "").trim() ? propio : deArriba;
  return {
    ...base,
    // Con cajones propios, la lista suelta de arriba no se mezcla con ellos.
    intro: lista(suya.intro_groups, undefined) ? [] : base.intro,
    intro_groups: lista(suya.intro_groups, base.intro_groups),
    pregunta_steps: lista(suya.pregunta_steps, base.pregunta_steps),
    info_steps: lista(suya.info_steps, base.info_steps),
    use_buttons:
      typeof suya.use_buttons === "boolean" ? suya.use_buttons : base.use_buttons,
    boton_si: texto(suya.boton_si, base.boton_si),
    boton_no: texto(suya.boton_no, base.boton_no),
    respuesta_rechazo: texto(suya.respuesta_rechazo, base.respuesta_rechazo),
    recordatorio: texto(suya.recordatorio, base.recordatorio),
  };
}

function productoDeLaBiblioteca(
  cfg: WorkflowConfig,
  id: string | null | undefined
): ProductoDeLaBiblioteca | null {
  if (!id) return null;
  return (cfg.biblioteca_de_productos ?? []).find((p) => p?.id === id) ?? null;
}

/**
 * EL PRODUCTO DE LA FILA, VESTIDO DE UPSELL.
 *
 * Lo de la etapa que no es de ningún producto —cómo se cobra, si usa botones— se queda
 * del upsell de siempre. Todo lo que NOMBRA un producto sale de la ficha y de su
 * presentación, y lo que no tenga se deja VACÍO a propósito: heredar la intro o la
 * respuesta del upsell de siempre sería hablarle del producto 1 mientras se le vende el 3.
 *
 * Si el producto ya no existe, se devuelve APAGADO: sin precio no se cobra nada y no se
 * entrega lo que no es. Mejor una venta perdida que un enlace equivocado.
 */
function vestirLaOfertaDeLaFila(
  deSiempre: UpsellConfig | null,
  puesto: PuestoEnLaFila,
  cfg: WorkflowConfig
): UpsellConfig {
  const base: UpsellConfig = deSiempre ?? {};
  const fila = filaDeLaConversacion(cfg, puesto);
  let oferta: UpsellConfig = base;
  if (puesto.upsell_producto_id) {
    const producto = productoDeLaBiblioteca(cfg, puesto.upsell_producto_id);
    if (!producto) {
      console.warn(
        `[wf:fila] el producto «${puesto.upsell_producto_id}» de la fila ya no está en la biblioteca: no se cobra ni se entrega`
      );
      return { ...base, enabled: false };
    }
    const pres = presentacionEnEsteCanal(producto.presentacion_upsell);
    const suPuesto = (fila?.puestos ?? []).find(
      (p) => p?.producto_id === producto.id
    );
    const botonSi = (pres.boton_si ?? "").trim();
    const botonNo = (pres.boton_no ?? "").trim();
    oferta = {
      ...base,
      enabled: true,
      name: producto.name ?? "",
      aliases: producto.aliases ?? [],
      // Sus precios van por `de_la_fila`. Estos en cero para que no se cuele ninguno.
      price_soles: 0,
      discount_price_soles: 0,
      market_price: 0,
      image_gallery: producto.image_gallery ?? [],
      course_content: producto.course_content ?? "",
      delivery: burbujasDeLaFicha(producto.delivery),
      intro: burbujasDeLaFicha(pres.intro),
      // SUS cajones, nunca los del upsell de siempre. `presentarUpsell` los sortea igual
      // que los de siempre, y sin ninguno cae a la lista suelta de arriba.
      intro_groups: cajonesDeLaFicha(pres.intro_groups),
      pregunta_steps: burbujasDeLaFicha(pres.pregunta_steps),
      pregunta: "",
      pregunta_variants: [],
      // La casilla manda. Sin marcarla nunca, la regla de antes de que existiera.
      use_buttons:
        typeof pres.use_buttons === "boolean"
          ? pres.use_buttons
          : botonSi && botonNo
            ? true
            : base.use_buttons,
      boton_si: botonSi || base.boton_si,
      boton_no: botonNo || base.boton_no,
      info_steps: burbujasDeLaFicha(pres.info_steps),
      respuesta_rechazo: pres.respuesta_rechazo ?? "",
      respuesta_generica: "",
      recordatorio: pres.recordatorio ?? "",
      retraso_minutos: Math.max(0, Math.floor(suPuesto?.minutos ?? 0)),
      de_la_fila: {
        producto_id: producto.id,
        downsell: false,
        precios: producto.precios_por_pais ?? {},
        phone: puesto.phone ?? null,
      },
    };
  }
  if (!puesto.upsell_downsell) return oferta;
  // EL DOWNSELL: la MISMA oferta —mismo producto, misma entrega, mismo «qué trae»—,
  // con su mensaje y su precio fijo por país. Una sola vez, sin recordatorio.
  const ds = fila?.downsell;
  if (!ds) return { ...oferta, enabled: false };
  const normal = oferta.de_la_fila
    ? preciosDeLaOfertaDeLaFila(
        oferta.de_la_fila,
        getEffectiveCountryCode(puesto.phone, cfg)
      ).precio
    : precioEscritoDeLaEtapa(oferta, false, puesto.phone, cfg) ?? undefined;
  const pais = String(getEffectiveCountryCode(puesto.phone, cfg)).toUpperCase();
  const precioDs = ds.precios_por_pais?.[pais]?.price_soles;
  const dsSi = (ds.boton_si ?? "").trim();
  const dsNo = (ds.boton_no ?? "").trim();
  return {
    ...oferta,
    enabled: true,
    price_soles: 0,
    discount_price_soles: 0,
    market_price: 0,
    intro: [],
    intro_groups: [],
    pregunta_steps: burbujasDeLaFicha(ds.steps),
    pregunta: "",
    pregunta_variants: [],
    use_buttons: dsSi && dsNo ? true : oferta.use_buttons,
    boton_si: dsSi || oferta.boton_si,
    boton_no: dsNo || oferta.boton_no,
    recordatorio: "",
    retraso_minutos: 0,
    de_la_fila: {
      producto_id: puesto.upsell_producto_id ?? null,
      downsell: true,
      // Su precio, y como «precio de antes» el normal: el downsell se compara contra él.
      precios: {
        [pais]: {
          price_soles: typeof precioDs === "number" ? precioDs : undefined,
          market_price: normal,
        },
      },
      phone: puesto.phone ?? null,
    },
  };
}

/**
 * ¿SE PUEDE OFRECER ESTE PRODUCTO DE LA FILA A ESTE CLIENTE?
 *
 * Las cuatro condiciones de `isUpsellUsable` —nombre, entrega, precio— más las dos de la
 * fila: su presentación, y su precio en el país DE ESTE CLIENTE (no hay respaldo entre
 * países: «jamás deben tener precios de otro país»). Un producto a medias se salta.
 */
function sePuedeOfrecerDeLaFila(
  producto: ProductoDeLaBiblioteca,
  phone: string | null,
  cfg: WorkflowConfig
): boolean {
  const nombre = (producto.name ?? "").trim();
  if (nombre.length < 2 || (nombre.includes("<<") && nombre.includes(">>"))) {
    return false;
  }
  const entrega = burbujasDeLaFicha(producto.delivery);
  if (!hasSendableSteps(entrega) || sectionHasPlaceholder(entrega)) return false;
  const pres = presentacionEnEsteCanal(producto.presentacion_upsell);
  if (
    !hasSendableSteps(burbujasDeLaFicha(pres.intro)) &&
    !cajonesDeLaFicha(pres.intro_groups).some(
      (g) => g.enabled !== false && hasSendableSteps(g.steps)
    ) &&
    !hasSendableSteps(burbujasDeLaFicha(pres.pregunta_steps))
  ) {
    return false;
  }
  const precio = preciosDeLaOfertaDeLaFila(
    {
      producto_id: producto.id,
      downsell: false,
      precios: producto.precios_por_pais ?? {},
      phone,
    },
    getEffectiveCountryCode(phone, cfg)
  ).precio;
  return typeof precio === "number" && precio > 0;
}

/**
 * EL SIGUIENTE PRODUCTO DE LA FILA PARA ESTE CLIENTE, o null si ya no queda ninguno.
 *
 * «No debe haber manera de equivocarse, no sea que el bot recuerde un producto que ya
 * vendió.» Se salta:
 *   · lo que ya pagó (su lista de compras de la fila);
 *   · lo que juega en su compra principal o como upsell de siempre —por si alguien pone
 *     en la fila el mismo producto—;
 *   · los repetidos;
 *   · los apagados y los que no se pueden ofrecer (ver `sePuedeOfrecerDeLaFila`).
 *
 * `despuesDe`: el producto de la fila en curso, o null si va por el upsell de siempre.
 */
export function siguienteDeLaFila(
  cfg: WorkflowConfig,
  puesto: PuestoEnLaFila,
  despuesDe: string | null
): { fila: FilaDeUpsell; producto_id: string } | null {
  const fila = filaDeLaConversacion(cfg, puesto);
  if (!fila || fila.enabled === false) return null;
  const puestos = (fila.puestos ?? []).filter((p) => p?.producto_id);
  const desde = despuesDe
    ? puestos.findIndex((p) => p.producto_id === despuesDe) + 1
    : 0;
  // Si el producto en curso ya no está en la fila, no se adivina por dónde seguir.
  if (despuesDe && desde === 0) return null;
  const yaJuegan = new Set<string>(
    Object.values(laAlineacionQueJuega(cfg) ?? {}).filter(Boolean)
  );
  for (const c of leerCompradosDeLaFila(puesto)) {
    if (c?.producto_id) yaJuegan.add(c.producto_id);
  }
  if (despuesDe) yaJuegan.add(despuesDe);
  // Lo que ya quedó atrás en la fila —ofrecido, comprado o saltado— no vuelve: un producto
  // repetido más abajo no se le ofrece otra vez.
  for (const p of puestos.slice(0, desde)) yaJuegan.add(p.producto_id);
  for (const p of puestos.slice(desde)) {
    if (p.enabled === false || yaJuegan.has(p.producto_id)) continue;
    yaJuegan.add(p.producto_id);
    const producto = productoDeLaBiblioteca(cfg, p.producto_id);
    if (!producto) continue;
    if (!sePuedeOfrecerDeLaFila(producto, puesto.phone ?? null, cfg)) {
      console.log(
        `[wf:fila] salto «${producto.name ?? producto.id}»: le falta la presentación, la entrega o el precio en este país`
      );
      continue;
    }
    return { fila, producto_id: p.producto_id };
  }
  return null;
}

/**
 * PASA A LA SIGUIENTE OFERTA DE LA FILA, SI TOCA. Lo llama el motor al terminar una
 * entrega. Devuelve true si movió la conversación; entonces el motor sigue su camino de
 * siempre («se le debe la oferta») y ofrece el nuevo con sus minutos.
 *
 * Toca en dos casos, y solo en dos:
 *   1. Acaba de PAGAR la oferta en curso (estado «pagado»), la fila no se paró y queda
 *      un producto.
 *   2. Es la primera entrega, el upsell de siempre NO se puede ofrecer, y hay fila: la
 *      fila empieza por su primer producto.
 *
 * Sin fila, devuelve false sin tocar nada: el motor hace lo de siempre.
 */
export function prepararElSiguienteDeLaFila(
  convo: {
    id: number;
    upsell_state?: string | null;
    state?: string | null;
    gift_rewarded?: number | boolean | null;
  },
  cfg: WorkflowConfig | null
): boolean {
  if (!cfg) return false;
  if (!Array.isArray(cfg.filas_de_upsell) || cfg.filas_de_upsell.length === 0) {
    return false;
  }
  // QUIEN YA LLEGÓ AL REGALO TERMINÓ SU COMPRA. Si pide «no me llegó» se le reenvía lo
  // suyo y punto: abrirle la fila ahí —días después, o con la pregunta del regalo en
  // pantalla— sería dejarle dos preguntas abiertas. Pasa sobre todo con las
  // conversaciones de antes de la fila, que no tienen la parada anotada.
  if (
    convo.gift_rewarded ||
    convo.state === "awaiting_gift_consent" ||
    convo.state === "awaiting_facebook_comment"
  ) {
    return false;
  }
  const puesto = getPuestoEnLaFila(convo.id);
  if (!puesto || puesto.upsell_fila_parada) return false;
  // Tras el downsell no hay nada más: era la última oferta.
  if (puesto.upsell_downsell) return false;
  const pago = convo.upsell_state === "pagado";
  const empieza =
    !convo.upsell_state && !puesto.upsell_producto_id && !isUpsellUsable(cfg);
  if (!pago && !empieza) return false;
  const siguiente = siguienteDeLaFila(cfg, puesto, puesto.upsell_producto_id);
  if (!siguiente) return false;
  moverLaFila(convo.id, siguiente.fila.id, siguiente.producto_id, false);
  console.log(
    `[wf:fila] convo ${convo.id}: ${pago ? "pagó" : "el upsell de siempre no se ofrece"} → sigue «${siguiente.producto_id}»`
  );
  return true;
}

/**
 * ¿TOCA EL DOWNSELL? Solo si se cumplen todas:
 *   · la fila tiene el downsell encendido y con precio en el país de este cliente;
 *   · tiene mensaje que mandar;
 *   · la oferta en curso es la ÚLTIMA que se le puede hacer —«no invade la lista»—;
 *   · no se le ofreció ya —una sola vez—;
 *   · y su precio es MENOR que el normal. Un «downsell» más caro no se manda nunca.
 */
export function elDownsellQueToca(
  convo: { id: number },
  cfg: WorkflowConfig | null
): FilaDeUpsell | null {
  if (!cfg) return null;
  if (!Array.isArray(cfg.filas_de_upsell) || cfg.filas_de_upsell.length === 0) {
    return null;
  }
  const puesto = getPuestoEnLaFila(convo.id);
  if (!puesto || puesto.upsell_downsell || puesto.upsell_fila_parada) return null;
  const fila = filaDeLaConversacion(cfg, puesto);
  const ds = fila?.downsell;
  if (!fila || fila.enabled === false || ds?.enabled !== true) return null;
  if (!hasSendableSteps(burbujasDeLaFicha(ds.steps))) return null;
  if (siguienteDeLaFila(cfg, puesto, puesto.upsell_producto_id)) return null;
  const pais = String(getEffectiveCountryCode(puesto.phone, cfg)).toUpperCase();
  const precioDs = ds.precios_por_pais?.[pais]?.price_soles;
  if (typeof precioDs !== "number" || !(precioDs > 0)) return null;
  const normal = getUpsellPriceSoles(false, puesto.phone, cfg);
  if (normal === null || !(precioDs < normal)) {
    console.log(
      `[wf:fila] convo ${convo.id}: el downsell no es más barato que el normal (${precioDs} contra ${normal}) — no lo ofrezco`
    );
    return null;
  }
  return fila;
}

/**
 * EL PLAZO DE SILENCIO DE LA OFERTA EN CURSO, EN SEGUNDOS.
 *
 * Es el del regalo, como siempre —`regalo` es ese número—, salvo en un caso: la oferta es
 * la última y detrás espera su downsell con sus propios minutos. Ahí el silencio que
 * cuenta es el del downsell, que es lo que él configuró para «no contesta en X minutos».
 */
export function segundosDelPlazoDeLaOferta(
  convo: { id: number },
  cfg: WorkflowConfig | null,
  regalo: number
): number {
  const fila = elDownsellQueToca(convo, cfg);
  const minutos = Math.floor(fila?.downsell?.espera_minutos ?? 0);
  return fila && minutos > 0 ? minutos * 60 : regalo;
}

/**
 * LAS ENTREGAS DE LO QUE COMPRÓ EN LA FILA, para el reenvío de «no me llegó».
 *
 * Devuelve null cuando no hay fila en juego —ni compras de la fila ni oferta de la fila
 * en curso—, y entonces el reenvío hace lo de siempre. Si no, una entrega por cada cosa
 * pagada, en el orden en que la compró. `producto_id` vacío = el upsell de siempre.
 */
export function entregasDeLoCompradoEnLaFila(
  convo: { id: number; upsell_state?: string | null },
  cfg: WorkflowConfig | null
): { producto_id: string; pasos: SequenceStep[] }[] | null {
  if (!cfg) return null;
  const puesto = getPuestoEnLaFila(convo.id);
  if (!puesto) return null;
  const comprados = leerCompradosDeLaFila(puesto);
  const enJuego =
    comprados.length > 0 || !!puesto.upsell_producto_id || !!puesto.upsell_downsell;
  if (!enJuego) return null;
  const lista: { producto_id: string; pasos: SequenceStep[] }[] = [];
  const vistos = new Set<string>();
  for (const c of comprados) {
    const clave = c?.producto_id ?? "";
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    const pasos = entregaDeLaFila(clave, cfg);
    if (pasos) lista.push({ producto_id: clave, pasos });
  }
  return lista;
}

/** La entrega de un producto de la fila, o la del upsell de siempre con `""`. */
export function entregaDeLaFila(
  productoId: string,
  cfg: WorkflowConfig | null
): SequenceStep[] | null {
  if (!cfg) return null;
  const pasos = productoId
    ? burbujasDeLaFicha(productoDeLaBiblioteca(cfg, productoId)?.delivery)
    : seccionUpsellDeSiempre(cfg)?.delivery;
  if (!pasos?.length || sectionHasPlaceholder(pasos)) return null;
  return pasos;
}

/**
 * EL PRECIO SOLO VIAJA AL MODELO SI QUEDA ALGO QUE VENDER.
 *
 * LO QUE PASÓ — 24 de septiembre de 2026. El dueño compró, el bot le ofreció el
 * regalo, él preguntó «cuanto cuesta» y el bot le contestó el precio del
 * producto que ACABABA DE PAGAR. Y con su «ok» —que contestaba a la pregunta de
 * venta que el modelo acababa de inventarse— aceptó el regalo sin querer.
 *
 * LA CAUSA, medida en el propio prompt: al modelo le llegaban DOS órdenes
 * contrarias en la misma petición.
 *
 *     POST-SALE SUPPORT MODE: ...already paid... Do NOT ... quote prices...
 *     EFFECTIVE PRICE FOR THIS CUSTOMER: S/. 20. This is the ONLY price you
 *     must quote WHEN THEY ASK HOW MUCH IT COSTS.
 *
 * Él escribió exactamente «cuanto cuesta». La segunda es más concreta y coincide
 * palabra por palabra, así que ganó. No es que el modelo desobedeciera: se le
 * dio el dato Y la orden de usarlo.
 *
 * Y LA OTRA CONVERSACIÓN ACERTÓ POR CASUALIDAD: allí preguntó antes «y esto»,
 * el modelo explicó que era el regalo, y «precio» ya no disparó esa orden. Mismo
 * estado, mismo guion, distinto orden de preguntas.
 *
 * NO MIRA LA MODALIDAD, Y ES LA CONDICIÓN QUE PUSO EL DUEÑO: «yo en cualquier
 * momento cambio de como lineal a como ob o a como dou, no quiero que haya esto
 * ni se bloquee algo, quiero que todo sea coherente». Así que se pregunta por el
 * DATO —¿queda algo con precio esperando?— y la respuesta sale sola con
 * cualquier posición del selector.
 *
 * SE CAMBIA UNA SOLA COSA. Donde el precio viajaba, sigue viajando IGUAL y con
 * la misma etiqueta: antes de comprar, con la etapa upsell viva, y cuando se
 * puede subir de la opción barata a la cara. Lo único nuevo es el último caso —
 * ya compró y no queda nada en venta— y ahí no viaja ninguno.
 *
 * QUITARLE EL DATO, NO PEDIRLE QUE LO IGNORE. Pedírselo ya está escrito en el
 * bloque de postventa y no ganó. En el prompt todo compite a la vez; lo que no
 * está, no compite.
 *
 * VIVE AQUÍ Y NO EN EL CEREBRO por dos motivos: es una pregunta sobre el estado
 * de la venta, como sus vecinas, y así se puede EJECUTAR en las pruebas —
 * `openrouter.ts` arrastra medio proyecto y sus pruebas lo leen como texto.
 */
export function precioDeLoQueQuedaEnVenta(params: {
  isPostSale: boolean;
  quedaElUpsell: boolean;
  yaEligioLaBarata: boolean;
  hayOfertaDeDos: boolean;
  etiqueta: string;
}): string | null {
  const { isPostSale, quedaElUpsell, yaEligioLaBarata, hayOfertaDeDos, etiqueta } =
    params;
  // Antes de comprar hay venta abierta, siempre. Como toda la vida.
  if (!isPostSale) return etiqueta;
  // Ya compró. ¿Queda el segundo producto por ofrecer? Lo decide el mismo sitio
  // que decide si se ofrece —`isUpsellUsable`—: sin nombre, sin precio o sin
  // entrega no hay etapa upsell que valga.
  if (quedaElUpsell) return etiqueta;
  // ¿O puede subir de la opción barata a la cara? Eso también es venta abierta.
  if (hayOfertaDeDos && yaEligioLaBarata) return etiqueta;
  // No queda nada con precio. El modelo no recibe ninguno.
  return null;
}

/**
 * UN AVISO QUE SE DICE UNA VEZ, NO CINCUENTA.
 *
 * LO QUE PIDIÓ EL DUEÑO — 24 de septiembre de 2026, viendo su registro con el
 * mismo renglón quince veces seguidas: «me refiero a la cantidad de texto que
 * bota, es muchísimo, creo que eso estaba antes quitado el texto innecesario».
 *
 * Y TENÍA RAZÓN: la cura ya existía en esta casa. Está escrita en el diagnóstico
 * de país, que se apagó por lo mismo — «se imprime en CADA resolución, y hay
 * decenas por mensaje: el log salía con una línea útil por cada cincuenta de
 * ruido, y encontrar qué hizo el bot costaba más que la prueba». Este aviso
 * nació después y no heredó ese freno.
 *
 * POR QUÉ NO SE APAGA DEL TODO. Porque es el que le dice POR QUÉ el bot sigue
 * vendiendo uno con el selector encendido — sin él se prueba a ciegas. Lo que
 * sobra no es el aviso: es repetirlo.
 *
 * SE REPITE SI CAMBIA. La memoria guarda el texto exacto, así que sentar el
 * producto que faltaba, o cambiar de modalidad, vuelve a decirlo. Un aviso que
 * se calla para siempre es tan malo como uno que grita.
 */
let ultimoAvisoDelMotor = "";
function avisarUnaVez(mensaje: string): void {
  if (mensaje === ultimoAvisoDelMotor) return;
  ultimoAvisoDelMotor = mensaje;
  console.warn(mensaje);
}

/**
 * DE UNA CAJA DE OFERTA, SOLO LO QUE ES DEL PRODUCTO.
 *
 * PARA QUÉ. La presentación prestada arma su oferta a partir de la caja que el
 * reparto acaba de llenar con SUS productos. Esa caja guarda dos cosas mezcladas:
 * lo que sale de la ficha del producto —y viaja con él cuando se cambia de
 * producto— y el GUION DE VENTA de la modalidad a la que pertenece la caja.
 *
 * Aquí se copia solo lo primero, y se nombra campo a campo a propósito: lo que
 * no está escrito, no se copia. Así un campo nuevo en la caja no se cuela solo.
 *
 * LO QUE NO SE COPIA, Y NO ES UN OLVIDO: `response`, `response_variants`,
 * `direct_payment_prompt`, `payment_responses` y `by_country`. Eso es el guion de
 * otra modalidad y traerlo sería prestarle contenido, que es justo lo que esta
 * casa no hace: importar sí, prestar no. Se quedan vacíos, exactamente como
 * estaban hasta hoy, y el camino general los cubre igual que ahora.
 *
 * Y EL `name` TAMPOCO SE COPIA, aunque salga de la ficha. Lo pilló
 * `prueba-la-presentacion-prestada` en el primer intento de este arreglo, y tenía
 * razón: `conLosNombresDelContenido` deja ganar al nombre escrito A MANO en la
 * caja —hay quien le mete el precio dentro para los botones y eso no se le puede
 * pisar—. Así que copiar el `name` de la caja vecina era la única vía por la que
 * un texto de otra modalidad podía llegarle al cliente. Los nombres ya vienen por
 * su camino, de `product_name` y `product_name_2`, que el reparto llena con la
 * alineación de ESTA modalidad.
 *
 * LO QUE PASÓ — 23 de septiembre de 2026. La oferta prestada se armaba VACÍA y
 * solo se le ponía el nombre encima. Medido con la configuración del dueño:
 *
 *     getOrderBumpOption("combo")   entrega=(nada)   campos=[name]
 *     getOrderBumpOption("basico")  entrega=(nada)   campos=[name]
 *         <- la opción SOLO llevaba el nombre del producto
 *
 * mientras la ficha de los dos productos tenía su entrega escrita y el reparto la
 * había copiado bien a su caja. Como la entrega salía vacía y ese puesto lo llena
 * un producto elegido, el motor hacía lo correcto —pararse en vez de mandar el
 * material de otro producto— y el cliente se quedaba sin nada después de pagar:
 *
 *     [wf:pago] convo 43 APROBADO (total: S/. 10 Soles)
 *     [wf:pago] convo 43: PAGÓ y no hay entrega que mandar (la opción Full)
 *
 * Los precios y los nombres no lo notaban porque van por su propio camino —la
 * ficha por país y `conLosNombresDelContenido`—, así que el fallo solo aparecía
 * en el último escalón de la venta.
 */
function soloLoQueEsDelProducto(
  caja: OrderBumpOption | undefined
): OrderBumpOption {
  const { aliases, price_soles, discount_price_soles, regalos, delivery } =
    caja ?? {};
  return { aliases, price_soles, discount_price_soles, regalos, delivery };
}

/** Devuelve la sección de la modalidad de 2 opciones ACTIVA (order_bump o
 *  doble_oferta_dos) — ambas comparten la forma combo/basico. order_bump tiene
 *  precedencia. null si ninguna está activa. Es la fuente única para precio,
 *  detección y ruteo de pago de las 2 opciones. */
export function getActiveTwoTierOffer(
  config?: WorkflowConfig | null
): OrderBump | DobleOfertaDos | null {
  const cfg = config ?? loadWorkflowConfig();
  if (!cfg) return null;
  // Se pregunta por la MISMA escalera que el resto, para que la ENTREGA use la
  // MISMA modalidad que la ELECCIÓN — antes order_bump tenía precedencia y, si
  // quedaba encendido, entregaba SU producto en doble oferta. En una
  // conversación real esto vale exactamente lo que valía antes; además, en la
  // modalidad Upsell —que no tiene dos opciones— devuelve null como debe.
  const key = activeModalityKey(cfg);
  if (key === "doble_oferta_upsell" && cfg.doble_oferta_upsell) {
    return conLosNombresDelContenido(cfg.doble_oferta_upsell, cfg);
  }
  if (key === "doble_oferta_dos" && cfg.doble_oferta_dos)
    return conLosNombresDelContenido(cfg.doble_oferta_dos, cfg);
  if (key === "order_bump" && cfg.order_bump)
    return conLosNombresDelContenido(cfg.order_bump, cfg);
  // LA PRESENTACIÓN PRESTADA. Ver `segundaOpcionPrestada`.
  //
  // La modalidad sigue siendo la suya: lo prestado es la FORMA, nunca el
  // contenido. Por eso la oferta se arma con lo que ya hay en SUS cajas:
  //
  //   · los NOMBRES salen de `product_name` y `product_name_2`, que el reparto
  //     acaba de llenar con los productos de SU alineación — es lo que hace
  //     `conLosNombresDelContenido`;
  //   · los PRECIOS salen de la ficha de cada producto en su país, por
  //     `getOrderBumpPriceSoles` → `preciosDeLaFichaEnElPais`, que también lee
  //     la alineación de la modalidad activa;
  //   · y LA ENTREGA, LOS APODOS Y LOS REGALOS salen de la caja que el reparto
  //     acaba de llenar con las fichas de SUS productos, por
  //     `soloLoQueEsDelProducto`.
  //
  // ESE TERCER PUNTO FALTABA, y costó una venta entera: la oferta se armaba del
  // todo vacía, la opción llegaba al motor con el nombre y nada más, y quien
  // pagaba se quedaba sin material. Ver `soloLoQueEsDelProducto`, que cuenta la
  // medición.
  //
  // COPIAR LA SECCIÓN DE LA OTRA MODALIDAD SERÍA EL ERROR: traería su guion de
  // venta —la respuesta al elegir, el mensaje directo, las respuestas por método
  // y los textos por país—. Por eso NO se copia la caja: se copian, nombrados uno
  // a uno, los campos que salen de la ficha del producto y que viajan con él.
  // Las modalidades son herméticas y siguen siéndolo.
  //
  // Y SIN LOS DOS NOMBRES, NO HAY OFERTA.
  //
  // Es la regla de esta casa: un campo con texto no es un campo utilizable. Si
  // él enciende el interruptor y todavía no ha sentado al segundo producto, una
  // oferta con una opción en blanco sería peor que no tenerla — el bot
  // presentaría dos y una no tiene ni nombre ni precio. Devolviendo null se
  // comporta exactamente como hoy hasta que la alineación esté completa, que es
  // justo el minuto que él dijo que tardaría en elegirlos.
  if (segundaOpcionPrestada(cfg)) {
    const armada = conLosNombresDelContenido(
      {
        enabled: true,
        combo: soloLoQueEsDelProducto(cfg.doble_oferta_dos?.combo),
        basico: soloLoQueEsDelProducto(cfg.doble_oferta_dos?.basico),
      } as unknown as OrderBump,
      cfg
    );
    if (armada.combo?.name?.trim() && armada.basico?.name?.trim()) return armada;
    avisarUnaVez(
      `[wf] ${key}: presentación de dos opciones encendida, pero falta sentar un producto (1: «${armada.combo?.name ?? ""}», 2: «${armada.basico?.name ?? ""}») → sigue vendiendo uno`
    );
    return null;
  }
  return null;
}

/**
 * EL NOMBRE DEL PRODUCTO SE ESCRIBE UNA VEZ, EN CONTENIDO.
 *
 * Había dos sitios para el mismo dato: el nombre en «Contenido» y el nombre de
 * cada opción de la oferta. Y el bot leía el segundo — justo el que se queda
 * sin llenar, porque nace con un `<<hueco>>` de plantilla.
 *
 * Resultado: el operador tenía los dos productos con su nombre puesto en
 * Contenido, y al cliente le llegaba escrito `<<NOMBRE_OPCION_COMBO>>` en el
 * chat. Un marcador de plantilla, tal cual, en una conversación de venta.
 *
 * Ahora el hueco se rellena solo desde Contenido. Y lo que el operador haya
 * escrito A MANO en la opción manda: hay quien le pone el precio dentro del
 * nombre para los botones, y eso no se le puede pisar.
 *
 * De paso, un `<<hueco>>` deja de poder llegarle a un cliente: o hay nombre de
 * verdad, o no hay nada que imprimir.
 */
function conLosNombresDelContenido<T extends OrderBump | DobleOfertaDos>(
  oferta: T,
  cfg: WorkflowConfig
): T {
  const suyo = (valor?: string): string => {
    const t = (valor ?? "").trim();
    // Un `<<…>>` no es un nombre: es el hueco que dejó la plantilla.
    return t && !(t.includes("<<") && t.includes(">>")) ? t : "";
  };
  // EL RESPALDO SALE DEL HUECO QUE OCUPA CADA PUESTO, NO DE UNA POSICIÓN FIJA.
  //
  // LO QUE PASÓ — 24 de septiembre de 2026, al arreglar «como -OB-». Allí el
  // hueco 1 pasó a ser el BÁSICO (el visible) y el 2 el FULL (el oculto). Estas
  // dos líneas daban por hecho lo contrario —«el 1 es el combo»— y los nombres
  // salieron cruzados en el banco, antes de llegar a ninguna conversación:
  //
  //     combo  «QUIMICA EN ACCION»          precio 30
  //     basico «QUIMICA EN ACCION + PAPEL»  precio 20
  //
  // El nombre de la opción cara con el precio de la barata. Es el mismo cruce
  // que el comentario de `CONTENIDO_DEL_PUESTO` cuenta que ya salió caro una vez,
  // y aquí estaba esperando: quien LLENA los huecos y quien los LEE tienen que
  // preguntar a la misma tabla.
  //
  // NO CAMBIA NINGÚN CASO DE HOY, y por eso se acota: solo se usa la tabla cuando
  // ella misma dice dónde están los dos puestos. En -DOU- dice «full en el 1,
  // básico en el 2» y sale exactamente lo de siempre; en el -OB- de verdad no hay
  // puesto de full en la tabla, así que se queda el respaldo de antes, letra por
  // letra.
  const tabla = tablaDeHuecos(activeModalityKey(cfg), cfg);
  const cajaDelHueco = (hueco: 1 | 2 | undefined): string | undefined =>
    hueco === 1 ? cfg.product_name : hueco === 2 ? cfg.product_name_2 : undefined;
  const laTablaSabeDeLosDos =
    tabla.full !== undefined && tabla.basico !== undefined;
  const respaldoDelCombo = laTablaSabeDeLosDos
    ? cajaDelHueco(tabla.full)
    : cfg.product_name;
  const respaldoDelBasico = laTablaSabeDeLosDos
    ? cajaDelHueco(tabla.basico)
    : cfg.product_name_2;
  const combo = suyo(oferta.combo?.name) || suyo(respaldoDelCombo);
  const basico = suyo(oferta.basico?.name) || suyo(respaldoDelBasico);
  if (combo === (oferta.combo?.name ?? "") && basico === (oferta.basico?.name ?? "")) {
    return oferta;
  }
  return {
    ...oferta,
    combo: oferta.combo ? { ...oferta.combo, name: combo } : oferta.combo,
    basico: oferta.basico ? { ...oferta.basico, name: basico } : oferta.basico,
  };
}

/**
 * ¿ESTÁ PIDIENDO SUBIR DE LA OPCIÓN BARATA A LA CARA?
 *
 * Vivía suelta dentro del motor, y por eso la lista no conocía el nombre de los
 * productos de nadie: tenía "completo", "combo" y "pack" escritos a mano. Con
 * una oferta llamada "<NOMBRE> FULL", la frase natural del cliente —"me
 * llevo el full"— no la reconocía nadie y se la tenía que llevar el modelo.
 *
 * Ahora la lista fija se completa con LO QUE DISTINGUE a la opción cara de la
 * barata: de "<NOMBRE> FULL" contra "<NOMBRE> BASICO" sale "full",
 * que es justo la palabra que usa el cliente. Se saca sola de los nombres
 * configurados, así que funciona con cualquier producto sin tocar código.
 *
 * Solo las palabras PROPIAS de la cara: las que comparten las dos —"kit",
 * compartidas— no distinguen nada y meterlas haría que pedir el básico se
 * leyera como pedir el combo.
 */
export function detectaIntencionDeSubirAlCombo(
  msg: string,
  config?: WorkflowConfig | null
): boolean {
  const texto = (msg ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "");
  if (!texto.trim()) return false;
  // La lista de siempre, palabra por palabra igual que antes — con UNA cuenta
  // cuadrada: los mismos cuatro sustantivos detrás de todos los verbos.
  //
  // LO QUE PASÓ — 25 de septiembre de 2026, midiendo el recorrido que el dueño
  // iba a probar. «quiero subir al pack» NO se leía como upgrade, y «quiero el
  // pack» sí. La causa no era una palabra que faltara: era que cada verbo
  // llevaba su propia lista de sustantivos, unas con `pack` y otras sin él, así
  // que la misma intención contaba o no según el verbo que el cliente eligiera.
  //
  // Se escriben una sola vez y valen para todos. No entra ningún término nuevo:
  // los cuatro ya estaban en esta misma expresión.
  const LA_OPCION_MAYOR = "(completo|combo|pack|otro)";
  const fija = new RegExp(
    `\\b(completar|completarlo|completar\\s+todo|completar\\s+el\\s+resto|completar\\s+la\\s+diferencia|resto|diferencia|saldo|llevarme\\s+el\\s+${LA_OPCION_MAYOR}|quiero\\s+el\\s+${LA_OPCION_MAYOR}|pasarme\\s+al\\s+${LA_OPCION_MAYOR}|upgrade|subir\\s+al\\s+${LA_OPCION_MAYOR}|el\\s+${LA_OPCION_MAYOR}|el\\s+mas\\s+(caro|completo))\\b`
  );
  if (fija.test(texto)) return true;
  const oferta = getActiveTwoTierOffer(config);
  for (const palabra of palabrasPropiasDeLaOpcionCara(oferta)) {
    // Palabras completas: "full" no debe acertar dentro de "fullbright".
    if (new RegExp(`\\b${palabra}\\b`).test(texto)) return true;
  }
  return false;
}

/**
 * Palabras del NOMBRE de la opción cara que la barata no tiene.
 *
 * SOLO DEL NOMBRE, nunca de los alias. Los alias son "otras formas de pedir
 * esta opción" y se escriben sueltos: en un bot real había un alias que era
 * literalmente "quiero". Aprendiendo de ahí, un cliente que ya compró el básico
 * y escribiera "quiero mi enlace" se leía como que quiere subir al combo — y
 * eso le cambia el precio que se espera de su siguiente pago.
 *
 * El nombre es el identificador del producto. Los alias son lenguaje suelto.
 */
function palabrasPropiasDeLaOpcionCara(
  oferta: OrderBump | DobleOfertaDos | null
): string[] {
  if (!oferta) return [];
  const limpiar = (t?: string): string[] =>
    (t ?? "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Mn}/gu, "")
      .split(/[^a-z0-9]+/)
      .filter((p) => p.length >= 3 && !/^\d+$/.test(p));
  const deLaCara = new Set(limpiar(oferta.combo?.name));
  // La barata sí aporta sus alias: aquí solo sirven para DESCARTAR palabras, y
  // cuantas más descarte, menos posibilidades de confundir una con otra.
  const deLaBarata = new Set([
    ...limpiar(oferta.basico?.name),
    ...(oferta.basico?.aliases ?? []).flatMap(limpiar),
  ]);
  // Palabras de relleno: aparecen en cualquier nombre y no distinguen nada.
  const relleno = new Set([
    "producto",
    "plan",
    "curso",
    "pack",
    "kit",
    "opcion",
    "para",
    "con",
    "los",
    "las",
    "del",
    "por",
  ]);
  return [...deLaCara].filter((p) => !deLaBarata.has(p) && !relleno.has(p));
}

/**
 * La sección de la modalidad de DOBLE OFERTA activa — la de dos productos o la
 * de dos productos más upsell. null en cualquier otra modalidad.
 *
 * Es la hermana estrecha de getActiveTwoTierOffer: aquella también devuelve el
 * Order Bump, que no tiene texto de elección al final de la intro ni orden de
 * los botones. Quien necesita esos campos pregunta por aquí y no tiene que
 * adivinar con cuál de las dos formas le tocó.
 */
export function seccionDobleOferta(
  config?: WorkflowConfig | null
): DobleOfertaDos | null {
  const cfg = config ?? loadWorkflowConfig();
  if (!cfg) return null;
  const key = activeModalityKey(cfg);
  if (key === "doble_oferta_upsell") return cfg.doble_oferta_upsell ?? null;
  if (key === "doble_oferta_dos") return cfg.doble_oferta_dos ?? null;
  return null;
}

/** Reconoce qué opción del order bump eligió el cliente (combo/básico) por
 *  nombre/alias (sirve tanto si escribe como si toca un botón, porque el
 *  título del botón ES el nombre). Solo matchea si el order bump está activo. */
/**
 * LAS PALABRAS QUE EL CLIENTE NOMBRÓ PARA DECIR QUE NO.
 *
 * Gemela de `methodMentionIsNegated` (en `engine.ts`), que hace lo mismo con los
 * métodos de pago desde que «no tengo yape» mandaba los datos de Yape. Se
 * conservan sus dos medidas, que allí costaron dos ventas encontrar:
 *
 *   · Ventana de 4 palabras ANTES. Con 3 se escapaba «no puedo pagar por yape»;
 *     con 5 daba falso positivo en «no sé cómo pagar por yape».
 *   · La puntuación CORTA: en «no hay problema, escobilla» el «no» es de otra
 *     idea y no niega la palabra que viene después.
 *
 * Aquí no se pregunta por un método: se devuelven TODAS las palabras negadas del
 * mensaje, y quien llama decide cuáles le importan. Así no hay que saber de
 * antemano qué palabra distingue a los productos de hoy.
 *
 * NO NOMBRA NINGÚN PRODUCTO: «no», «ni», «sin», «tampoco», «nunca» y «jamás» son
 * gramática, y valen igual con los 100 productos que venda mañana.
 */
const NEGACIONES_DEL_CLIENTE = new Set([
  "no",
  "ni",
  "sin",
  "tampoco",
  "nunca",
  "jamas",
]);

function tokensNegados(msg: string): Set<string> {
  const VENTANA = 4;
  const CORTE = "|";
  const negados = new Set<string>();
  const marcado = (msg ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    // La puntuación se conserva como barrera antes de limpiar el resto.
    .replace(/[,.;:!?]+/g, ` ${CORTE} `)
    .replace(/[^a-z0-9|]+/g, " ")
    .trim();
  if (!marcado) return negados;
  const palabras = marcado.split(" ").filter(Boolean);
  for (let i = 0; i < palabras.length; i++) {
    const palabra = palabras[i];
    if (palabra === CORTE || NEGACIONES_DEL_CLIENTE.has(palabra)) continue;
    let negado = false;
    for (let j = i - 1; j >= Math.max(0, i - VENTANA); j--) {
      if (palabras[j] === CORTE) break; // idea distinta: no niega esta palabra
      if (NEGACIONES_DEL_CLIENTE.has(palabras[j])) {
        negado = true;
        break;
      }
    }
    // Y LA NEGACIÓN QUE VA DETRÁS, QUE AQUÍ SÍ PASA.
    //
    // En los métodos de pago basta con mirar hacia atrás —«no tengo yape»—. Con
    // un producto no: el cliente pone el añadido delante y lo rechaza después.
    // Medido el 25/09 con tres pares de nombres distintos, estas dos formas se
    // escapaban y acababan cobrando la opción CARA:
    //
    //     «la escobilla no la necesito»
    //     «el papel no lo uso»
    //
    // LA VENTANA DE ATRÁS ES MÁS CORTA A PROPÓSITO: dos palabras. Con cuatro,
    // «quiero la escobilla no la otra» —que es una elección clara— se leería
    // como un rechazo. La puntuación sigue cortando, así que «escobilla, no hay
    // problema» no se niega.
    if (!negado) {
      for (let j = i + 1; j <= Math.min(palabras.length - 1, i + 2); j++) {
        if (palabras[j] === CORTE) break;
        if (NEGACIONES_DEL_CLIENTE.has(palabras[j])) {
          // «NO EL OTRO» NIEGA AL OTRO, NO A ESTE.
          //
          // Sin esto, «quiero la escobilla no la otra» —que es una elección
          // clarísima— se leía como un rechazo de la escobilla y el turno se iba
          // al modelo. La misma forma que ya reconoce esta función unas líneas
          // más abajo para saber que el cliente pide «el otro».
          const siguiente = palabras[j + 1] ?? "";
          const despues = palabras[j + 2] ?? "";
          if (/^otr[oa]s?$/.test(siguiente) || /^otr[oa]s?$/.test(despues))
            break;
          negado = true;
          break;
        }
      }
    }
    if (negado) negados.add(palabra);
  }
  return negados;
}

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
  // UNA PALABRA NEGADA NO ELIGE ESA OPCIÓN.
  //
  // LO QUE PASÓ — 25 de septiembre de 2026, medido con tres pares de nombres
  // inventados distintos. El cliente rechazaba el añadido y el bot le registraba
  // justo la opción CARA:
  //
  //     «sin escobilla»                -> la opción con escobilla
  //     «no quiero la escobilla»       -> la opción con escobilla
  //     «la escobilla no la necesito»  -> la opción con escobilla
  //     «sin camote»                   -> la opción con camote
  //     «no me mandes lapices»         -> la opción con lápices
  //
  // Siete de siete, y siempre al mismo lado: cobrando el caro a quien dijo que
  // NO quería el plus. Con sus palabras: «yo voy a vender 100 productos
  // diferentes», así que no es de un producto — es de cualquier añadido.
  //
  // POR QUÉ. Esto compara los dos nombres y se queda con la palabra que los
  // DISTINGUE, que es lo correcto y lo que hace que sirva para 100 productos.
  // Pero miraba solo si la palabra aparecía, no CÓMO venía. Y «escobilla» está
  // igual de presente en «con escobilla» que en «sin escobilla».
  //
  // LA REGLA SE REUTILIZA, NO SE INVENTA. Es la misma que ya protege los métodos
  // de pago desde que «no tengo yape» mandaba los datos de Yape —
  // `methodMentionIsNegated`, en `engine.ts`— con sus dos medidas, que allí
  // costaron dos ventas encontrar:
  //
  //   · La ventana es de 4 palabras ANTES. Con 3 se escapaba «no puedo pagar por
  //     yape»; con 5 daba falso positivo en «no sé cómo pagar por yape».
  //   · La puntuación CORTA la negación: en «no hay problema, escobilla» el «no»
  //     es de otra idea.
  //
  // Y NO SE INVENTA LA OPCIÓN CONTRARIA. Con la palabra negada esto deja de
  // sumar, así que el motor se APARTA y contesta el modelo, que sí entiende «no
  // quiero la escobilla». Es lo que pidió el dueño: que cuando haya matiz decida
  // quien lee la frase entera, no una comparación.
  //
  // Nada de esto nombra un producto: «no» y «sin» son gramática.
  const negados = tokensNegados(msg);
  const msgTokens = normalized
    .split(" ")
    .filter(
      (token) =>
        token.length >= 4 && !ignoredTokens.has(token) && !negados.has(token)
    );
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
  // CON UNA CASILLA VACÍA, ESTO DECÍA QUE EL CARO ERA EL BARATO.
  //
  // LO QUE PASÓ — 25 de septiembre de 2026. Medido con la configuración del
  // dueño, que vende en lineal con la presentación prestada:
  //
  //     ob.combo.price_soles   = 0     <- la casilla de la opción
  //     ob.basico.price_soles  = 10
  //     lo que COBRA de verdad = 14 y 10
  //
  // El precio bueno vive en el perfil del país y sale por su camino —el bot
  // cobraba 14 correctamente—, pero esta comparación miraba la casilla de la
  // oferta, que el reparto deja en cero cuando el importe es por país. Con el
  // combo en cero, «el completo» o «el más caro» devolvían EL BÁSICO: el
  // producto equivocado, con su precio, sin que nada avisara.
  //
  // SE PREGUNTA AL QUE COBRA, y solo cuando las casillas no sirven. Si las dos
  // traen un importe de verdad manda lo de siempre, letra por letra — hay
  // pruebas que componen una oferta a mano y siguen decidiendo igual. Y si
  // tampoco el que cobra sabe, se conserva el reparto de antes: sin datos, el
  // caro es el combo, que es como se presentan.
  const choiceByPrice = (which: "cheaper" | "dearer"): "combo" | "basico" => {
    const sirve = (n: unknown): n is number =>
      typeof n === "number" && Number.isFinite(n) && n > 0;
    let comboPrice: number | null = sirve(ob.combo?.price_soles)
      ? ob.combo!.price_soles!
      : null;
    let basicoPrice: number | null = sirve(ob.basico?.price_soles)
      ? ob.basico!.price_soles!
      : null;
    if (comboPrice === null || basicoPrice === null) {
      const delQueCobra = (cual: "combo" | "basico"): number | null => {
        const n = getOrderBumpPriceSoles(cual, false, null);
        return sirve(n) ? n : null;
      };
      comboPrice = comboPrice ?? delQueCobra("combo");
      basicoPrice = basicoPrice ?? delQueCobra("basico");
    }
    if (comboPrice !== null && basicoPrice !== null) {
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

/**
 * ¿EL MENSAJE NO DICE NADA MÁS QUE ESTAR DE ACUERDO?
 *
 * LO QUE PASÓ — 24 de septiembre de 2026, vendiendo en Argentina. En tres
 * conversaciones en paralelo el cliente aceptó comprar. Dos recibieron los datos
 * de pago al instante; la tercera no, y el bot le preguntó el método:
 *
 *     «OKA»        -> «afirma la compra en lineal, no le pregunto el metodo»
 *     «si»         -> lo mismo
 *     «esta bien»  -> nada. Se fue al modelo, 7.701 tokens, y no vendió.
 *                     Lo repitió, otros 7.765, y tampoco.
 *
 * LA CAUSA: la aceptación se decidía con una lista de frases —«ok», «si»,
 * «listo», «vale», «dale»…— y «esta bien» no estaba en ella. Con sus palabras:
 * «el bot estaba corregido para leer el contexto y ya no regirse por palabritas».
 * Tenía razón, y en este punto no se había cumplido.
 *
 * POR QUÉ NO SE AÑADE «ESTA BIEN» A LA LISTA. Es el parche que este proyecto ya
 * pagó tres veces: el cliente no escribe la palabra del ejemplo, escribe la
 * suya. Mañana llega «me parece», «bueno ya» o «hagámoslo» y volvemos aquí.
 *
 * LA VUELTA, Y ES LO CONTRARIO DE UNA LISTA DE CAPTURA: en vez de buscar las
 * frases que SÍ aceptan, se comprueba que el mensaje no lleve NADA MÁS que
 * acuerdo. Cualquier palabra que aporte contenido propio —un tema, una duda, una
 * marca, un producto— hace que esto diga NO. La lista es de gramática (partículas
 * de acuerdo y relleno), está CERRADA POR DEFECTO, y lo que no reconoce lo
 * rechaza. El fallo, si llega, es dejar pasar una venta, nunca mandar datos de
 * pago a quien preguntaba otra cosa.
 *
 * Así se leen igual «esta bien», «bueno ya», «me parece», «dale pues» o «ok
 * gracias», y NO se leen «contenido», «precio», «como me envia» ni «quiero saber
 * que trae» — que en su misma prueba llegaron mezcladas con las aceptaciones.
 *
 * NO DECIDE SOLA. Es el desempate dentro de una regla estructural, como manda
 * `CLAUDE.md`: quien la llama ya comprobó la etapa de la venta, que no haya
 * método elegido, que no sea pregunta de precio y que no haya objeción de pago.
 */
const ACUERDO = new Set([
  "si", "sip", "sipi", "sii", "siii", "claro", "dale", "dalee", "dele", "va",
  "vale", "ok", "oka", "okas", "okey", "okay", "oki", "okis", "listo", "lista",
  "correcto", "exacto", "cierto", "bueno", "buena", "bien", "perfecto", "hecho",
  "obvio", "acuerdo", "acepto", "quiero", "llevo", "compro", "comprar",
  "adquirir", "adquiero", "hagamoslo", "procede", "procedamos", "adelante",
  "confirmo", "genial", "excelente", "buenisimo", "afirmativo", "positivo",
  "enterado", "entendido", "conforme",
]);

/** Relleno: no aporta contenido, así que no cambia la respuesta. */
const RELLENO = new Set([
  "ya", "pues", "pe", "pue", "ps", "entonces", "esta", "estaa", "ta", "tas",
  "me", "parece", "de", "una", "uno", "lo", "la", "el", "los", "las", "todo",
  "todos", "gracias", "grax", "muy", "super", "porfa", "por", "favor", "asi",
  "es", "y", "tambien", "igual", "amigo", "amiga", "senor", "senora", "hermano",
  "bro", "causa", "mano", "eso", "esto", "va", "vamos", "vaya", "ahi", "aca",
  "aqui", "nomas", "no mas", "mismo", "seguro",
]);

export function soloEstaDeAcuerdo(msg: string): boolean {
  const palabras = (msg ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    // Sin signos ni emojis: la gente escribe «ok!!» y «esta bien 😊».
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  // Un mensaje largo está explicando algo, no aceptando. El corte es generoso a
  // propósito: «ya esta bien amigo gracias» son cinco.
  if (palabras.length === 0 || palabras.length > 6) return false;
  // Tiene que haber acuerdo de verdad: solo relleno («ya pues») no es un sí.
  if (!palabras.some((palabra) => ACUERDO.has(palabra))) return false;
  // Y NADA MÁS que acuerdo y relleno. Aquí es donde se cae «esta bien pero que
  // trae», «listo y cuanto cuesta» o «bueno, contenido».
  return palabras.every(
    (palabra) => ACUERDO.has(palabra) || RELLENO.has(palabra)
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
  // EL MISMO VERBO EN OTRO TIEMPO SIGUE SIENDO UNA PREGUNTA DE PRECIO.
  //
  // Estaban `cuesta` y `cuestan`, pero no `costaba`, `costó` ni `costaría`. Y
  // eso costó una compra desviada el 14 de septiembre de 2026, en -OB-: con las
  // dos opciones en pantalla, el cliente escribió
  //
  //     «no entiendo — no costaba 10»
  //
  // preguntando por el precio que le habían dicho. Como nadie lo reconoció como
  // pregunta, el «10» cayó en el buscador de precios de `detectTwoTierPick`,
  // coincidió con el importe del básico, y el bot le dio ese producto por
  // elegido y le mandó sus datos de pago.
  //
  // No es perseguir sinónimos: es cerrar una conjugación que estaba a medias.
  //
  // Y LA «S» QUE SUENA IGUAL QUE LA «C» NO ES OTRA PALABRA.
  //
  // LO QUE PASÓ — 25 de septiembre de 2026. El dueño avisó de que iba a probar
  // escribiendo mal y a propósito, y nombró «presio». Medido: «presio» y «cual
  // es el presio» NO se leían como pregunta de precio, mientras «cuanto vle» o
  // «qanto cuesta» sí. El riesgo no es que no conteste: es que el número que
  // venga detrás caiga en el buscador de importes y le dé un producto por
  // elegido — el mismo fallo del 14 de septiembre que está contado aquí arriba.
  //
  // NO ES AÑADIR UNA PALABRA A UNA LISTA: es la MISMA palabra. En toda América
  // Latina la c, la s y la z suenan igual, así que quien escribe rápido elige
  // cualquiera de las tres. `pre[csz]io` cubre las tres de una vez, hoy y con
  // cualquier cliente, sin que nadie tenga que adivinar la siguiente.
  return (
    /\b(pre[csz]ios?|cuesta|cuestan|costaba|costaban|costo|costaria|vale|valen|valia|valian|valor)\b/.test(
      normalized
    ) ||
    /\bcuanto\b/.test(normalized) ||
    /\ba\s+como\b/.test(normalized)
  );
}

/**
 * Distingue una pregunta de precio que ya apunta a una de las dos opciones
 * (o las compara) de un simple "precio?". En Order Bump esa diferencia evita
 * repetir la invitación a elegir cuando el cliente realmente pide el importe.
 */
export function isSpecificOrderBumpPriceQuestion(
  msg: string,
  config: WorkflowConfig | null = loadWorkflowConfig()
): boolean {
  if (!isPriceQuestion(msg)) return false;
  const ob = getActiveTwoTierOffer(config);
  if (!ob) return false;

  const normalize = (value: string): string =>
    value
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Mn}/gu, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, " ");
  const normalized = normalize(msg);
  const priceWords = new Set([
    "precio", "precios", "cuanto", "cuesta", "cuestan", "vale", "valen",
    "valor", "a", "como", "que", "cual", "es", "son", "el", "la", "los",
    "las", "de", "del", "por", "favor", "y", "otro", "otra",
  ]);
  const optionTokens = (option?: OrderBumpOption): Set<string> =>
    new Set(
      [option?.name, ...(option?.aliases ?? [])]
        .map((value) => normalize(value ?? ""))
        .flatMap((value) => value.split(" "))
        .filter((token) => token.length >= 3 && !priceWords.has(token))
    );
  const comboTokens = optionTokens(ob.combo);
  const basicoTokens = optionTokens(ob.basico);
  const words = new Set(normalized.split(" "));
  const mentions = (tokens: Set<string>): boolean =>
    [...tokens].some((token) => words.has(token));
  const comboMentioned = mentions(comboTokens) || /\b(combo|pack|completo|premium)\b/.test(normalized);
  const basicoMentioned =
    mentions(basicoTokens) ||
    /\b(basico|basica|individual|economico|economica|barato|barata)\b/.test(
      normalized
    );
  if (comboMentioned !== basicoMentioned) return true;

  // "¿Cuál vale menos?" y "¿y el otro qué vale?" necesitan una respuesta,
  // no el recordatorio fijo. El modelo conserva el contexto para resolverlas.
  return /\b(el otro|la otra|cual|que)\b.*\b(otro|otra|menos|mas|barato|barata|economico|economica|caro|cara)\b/.test(
    normalized
  );
}

/** Selección inequívoca desde botón, nombre, alias, número o una respuesta
 * breve basada en un término distintivo de los nombres configurados. */
/**
 * EL NOMBRE CON EL QUE EL BOT HABLA DE ESTA OPCIÓN.
 *
 * Un producto tiene su nombre escrito UNA vez, en Contenido. Pero las opciones
 * de la oferta tienen ADEMÁS su propio campo de nombre, que es lo mismo escrito
 * dos veces. Cuando ese segundo campo se queda vacío —o con el texto de muestra
 * «<<NOMBRE_OPCION_COMBO>>»— el bot se queda literalmente sin nada que comparar:
 *
 *   · no reconoce la elección aunque el cliente diga el nombre exacto,
 *   · y no puede notar que dos productos se llaman casi igual.
 *
 * El turno acaba entonces en el modelo, que sí adivina — y adivina mal. Es lo
 * que hacía que decir solo la parte común, con un FULL y un BÁSICO que empiezan
 * igual, devolviera siempre el básico sin preguntar.
 *
 * Así que si el campo de la oferta no dice nada, se usa el nombre del producto
 * que le toca por su papel: el full para la opción cara, la base para la barata.
 * No hay ningún nombre escrito aquí — salen de lo que ya se escribió una vez.
 */
export function nombreDeLaOpcion(
  cual: "combo" | "basico",
  config?: WorkflowConfig | null
): string {
  const cfg = config ?? loadWorkflowConfig();
  const ob = getActiveTwoTierOffer(cfg);
  const propio = (cual === "combo" ? ob?.combo?.name : ob?.basico?.name)?.trim();
  // Un texto de muestra «<<ASÍ>>» no es un nombre: cuenta como vacío.
  const sirve = (valor?: string): boolean =>
    !!valor && valor.length > 1 && !(valor.includes("<<") && valor.includes(">>"));
  if (sirve(propio)) return propio as string;
  const porPapel = nombresDeLosProductos(cfg);
  const respaldo = cual === "combo" ? porPapel.full : porPapel.base;
  return sirve(respaldo) ? respaldo : "";
}

export function detectExactOrderBumpChoice(
  msg: string,
  config: WorkflowConfig | null
): "combo" | "basico" | null {
  const ob = getActiveTwoTierOffer(config);
  if (!ob) return null;
  // ELEGIR POR EL NÚMERO Y POR EL ORDINAL TAMBIÉN EN «COMO -DOU-».
  //
  // LO QUE PASÓ — 25 de septiembre de 2026. El dueño preguntó si a «como dou» le
  // pasaba lo mismo que a «como ob». Le pasaba, y en las dos conductas que gatea
  // esta bandera: elegir diciendo «1» o «2» —«producto 1», «opcion 2»— y elegir
  // por ordinal —«el primero», «quiero el segundo»—. Con el selector, la
  // modalidad sigue llamándose lineal, así que el interruptor de -DOU- está
  // apagado y las dos quedaban muertas.
  //
  // Y ES JUSTO LA MODALIDAD DONDE MÁS SE USAN: en -DOU- las dos opciones se
  // presentan desde el primer mensaje, normalmente en una lista numerada, así
  // que «el primero» o «2» es la respuesta más natural del cliente. En su prueba
  // del 24/09 se vio: «el primero» no decidía y el turno se iba al modelo.
  //
  // SE PREGUNTA POR EL DATO, pero SIN salir a buscar la configuración global:
  // esta función recibe la suya y hay pruebas que le pasan una inventada, así
  // que se compone con lo que ya tiene. En -DOU- de verdad manda el interruptor,
  // igual que antes; en -OB- esto sigue en falso porque su forma es la otra.
  const dobleOfertaDos =
    !!config?.doble_oferta_dos?.enabled ||
    vendeConPresentacionPrestada(config, "dos_juntas");
  const normalize = (value: string): string =>
    value
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Mn}/gu, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, " ");
  const normalized = normalize(msg);
  // El nombre sale de `nombreDeLaOpcion`: si el campo de la oferta está vacío,
  // usa el del producto que le toca por su papel. Sin esto, con ese campo sin
  // llenar el bot no reconocía la elección ni diciendo el nombre exacto.
  const keys = (
    option: OrderBumpOption | undefined,
    cual: "combo" | "basico"
  ): string[] =>
    [nombreDeLaOpcion(cual, config), ...(option?.aliases ?? [])]
      .map((key) => normalize(key ?? ""))
      .filter(Boolean);
  const comboKeys = keys(ob.combo, "combo");
  const basicoKeys = keys(ob.basico, "basico");
  /**
   * ¿ESTE NÚMERO SEÑALA A UNA SOLA OPCIÓN, O ES PARTE DE UN NOMBRE?
   *
   * LO QUE PASÓ — 25 de septiembre de 2026, midiendo antes de que él probara. Su
   * opción cara se llamaba «<algo> 2 EN 1», así que los dígitos 1 y 2 estaban los
   * DOS dentro de ese nombre. Resultado, medido con sus nombres:
   *
   *     el bot escribe   1) <la barata> S/.10    2) <la cara> S/.14
   *     el cliente dice  «el 1»
   *     el bot registra  LA CARA        <- el producto equivocado, y más caro
   *
   * Y con las dos ordenaciones igual: la numeración que el propio bot acababa de
   * escribir no llegaba a mandar, porque el nombre decidía antes. Es el fallo más
   * caro que puede tener esto: registra otro producto, y el comprobante se valida
   * contra otro precio.
   *
   * LA REGLA ES DE AMBIGÜEDAD, NO DE NOMBRES. Un nombre que lleva DOS números no
   * puede señalar ni a uno ni a otro, así que sus dígitos dejan de identificar y
   * se abstiene. El dueño vende «100 productos o más» y los renombra cuando
   * quiere; esto pregunta por lo que haya puesto hoy:
   *
   *   · «PACK 1» y «PACK 2»      -> cada número señala a uno  -> decide, como hoy
   *   · «<algo> 2 EN 1» y otro   -> los dos números en uno    -> se abstiene
   *   · nombres sin números      -> no hay nada que mirar     -> igual que hoy
   *
   * Y ABSTENERSE NO ES QUEDARSE MUDO: más abajo está la numeración que el bot
   * escribió de verdad (`opcionEnLaPosicion`), que es quien debe decidir esto. Si
   * tampoco numeró, contesta el modelo — que sí puede preguntar cuál quiere.
   */
  const digitosDe = (llaves: string[]): Set<string> =>
    new Set(
      llaves.flatMap((k) => k.split(" ")).filter((t) => /^\d+$/.test(t))
    );
  const elNumeroSenalaUnaOpcion = (numero: string): boolean => {
    const enCombo = digitosDe(comboKeys);
    const enBasico = digitosDe(basicoKeys);
    const dueno = enCombo.has(numero)
      ? enCombo
      : enBasico.has(numero)
        ? enBasico
        : null;
    // El número no está en ningún nombre, o está en uno que lleva más: no señala.
    return dueno !== null && dueno.size === 1;
  };
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

  // EL NOMBRE COMPLETO DENTRO DE LA FRASE TAMBIÉN ELIGE.
  //
  // LO QUE PASÓ — 25 de septiembre de 2026, midiendo el recorrido que el dueño
  // iba a probar. Con un nombre de DOS palabras:
  //
  //     «quiero el <nombre>»        -> no elegía
  //     «creo que el <nombre>»      -> no elegía
  //     «ok que sea el <nombre>»    -> no elegía
  //     «quiero el <una palabra>»   -> SÍ elegía
  //
  // O sea: decir el nombre ENTERO funcionaba peor que decir media palabra. La
  // regla de más abajo solo decide cuando, quitadas las de relleno, queda UNA
  // palabra suelta, así que un nombre de dos palabras metido en una frase no
  // tenía por dónde entrar. Y es la forma más natural de pedirlo.
  //
  // SOLO EL NOMBRE, NUNCA LOS ALIAS, y esa distinción ya está tomada en esta
  // casa: «el nombre es el identificador del producto; los alias son lenguaje
  // suelto». En un bot real había un alias que era literalmente «quiero», y con
  // los alias aquí dentro cualquier «quiero» elegiría esa opción.
  //
  // Y NO SE METE DONDE UN NOMBRE ESTÁ ENTERO DENTRO DEL OTRO —«<X>» y «COMBO <X>
  // + <Y>»—. Ahí «aparece el nombre» daría SIEMPRE la de dentro, y ese caso ya
  // tiene su lectura propia (`opcionNombradaPorLoCompartido`), que además sabe
  // si el cliente solo está repitiendo la que ya tenía elegida. Lo pilló
  // `prueba-lo-decidido-no-se-repregunta` en el primer intento de esto.
  const nombreNormalizado = (cual: "combo" | "basico"): string =>
    normalize(nombreDeLaOpcion(cual, config) ?? "");
  const nombreCombo = nombreNormalizado("combo");
  const nombreBasico = nombreNormalizado("basico");
  const unNombreDentroDelOtro =
    nombreCombo.length >= 3 &&
    nombreBasico.length >= 3 &&
    (nombreCombo.includes(nombreBasico) || nombreBasico.includes(nombreCombo));
  if (!unNombreDentroDelOtro) {
    const dentroDeLaFrase = (nombre: string): boolean =>
      nombre.length >= 3 && normalized.includes(nombre);
    const comboDentro = dentroDeLaFrase(nombreCombo);
    const basicoDentro = dentroDeLaFrase(nombreBasico);
    if (comboDentro !== basicoDentro) return comboDentro ? "combo" : "basico";
  }

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
    // Si esa única palabra es un NÚMERO, tiene que señalar de verdad. Ver
    // `elNumeroSenalaUnaOpcion`: «el 1» con un nombre que lleva el 1 y el 2 no
    // señala nada, y decidía el producto equivocado.
    const esNumero = /^\d+$/.test(token);
    if (
      (!esNumero || elNumeroSenalaUnaOpcion(token)) &&
      comboHas !== basicoHas
    ) {
      return comboHas ? "combo" : "basico";
    }
  }
  if (/^\d+$/.test(normalized)) {
    const comboHas = comboKeys.some((key) => key.split(" ").includes(normalized));
    const basicoHas = basicoKeys.some((key) => key.split(" ").includes(normalized));
    // El número tiene que SEÑALAR. Ver `elNumeroSenalaUnaOpcion`.
    if (elNumeroSenalaUnaOpcion(normalized) && comboHas !== basicoHas) {
      return comboHas ? "combo" : "basico";
    }
    // Y EL ORDEN DE RESPALDO SOLO CUANDO NADIE MEJOR PUEDE CONTESTAR.
    //
    // Estas dos líneas son de cuando el número no tenía otro sitio donde
    // resolverse: «si el editor no incluye números, conservamos el orden
    // mostrado». Siguen valiendo ahí, palabra por palabra.
    //
    // Pero donde la lectura fina está encendida hay algo MEJOR unas líneas más
    // abajo: `opcionEnLaPosicion`, que lee la numeración que el bot escribió de
    // verdad en su último mensaje. Contestar aquí con el orden de respaldo le
    // quitaba el turno — y con un nombre como «<algo> 2 EN 1» eso mandaba «el 1»
    // a la opción cara, que es el producto equivocado.
    //
    // Abstenerse aquí no pierde nada: si el bot numeró, manda su numeración; y si
    // no numeró, `opcionEnLaPosicion` cae al MISMO orden de respaldo que estas
    // dos líneas. El resultado solo puede ser igual o mejor.
    if (!laLecturaFinaDeLaEleccionEstaActiva()) {
      if (normalized === "1") return "combo";
      if (normalized === "2") return "basico";
    }
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

/**
 * ¿A QUÉ PRODUCTO SE REFIERE, CUANDO HAY DOS EN LA MESA?
 *
 * Después de comprar y con el extra ya ofrecido, «puedo completar», «pago el
 * resto» o «la diferencia» sirven para LOS DOS: subir a la opción cara, o
 * llevarse el extra. Ninguna lista de palabras resuelve eso, porque la frase es
 * ambigua de verdad — lo que la desambigua es si NOMBRA un producto.
 *
 * Así que aquí no se adivina la intención: solo se mira si dijo un nombre.
 *
 *   "combo"  → nombró la opción cara
 *   "upsell" → nombró el producto del extra
 *   null     → no dijo cuál, y entonces hay que PREGUNTARLE
 *
 * Los nombres salen de la configuración, nunca escritos aquí: esto es una
 * plantilla. Y del extra solo cuentan las palabras que NO comparte con las dos
 * opciones — las compartidas no distinguen nada.
 */
export function queProductoNombra(
  msg: string,
  config?: WorkflowConfig | null
): "combo" | "upsell" | null {
  const palabras = new Set(palabrasSueltas(msg ?? ""));
  if (palabras.size === 0) return null;
  const cfg = config ?? loadWorkflowConfig();
  const oferta = getActiveTwoTierOffer(cfg);
  const deLasOpciones = new Set([
    ...palabrasSueltas(oferta?.combo?.name ?? ""),
    ...palabrasSueltas(oferta?.basico?.name ?? ""),
  ]);
  const delExtra = palabrasSueltas(seccionUpsell(cfg)?.name ?? "").filter(
    (p) => p.length >= 4 && !deLasOpciones.has(p)
  );
  if (delExtra.some((p) => palabras.has(p))) return "upsell";
  if (palabrasPropiasDeLaOpcionCara(oferta).some((p) => palabras.has(p)))
    return "combo";
  return null;
}

/**
 * PALABRAS QUE NO DISTINGUEN UN PRODUCTO DE OTRO.
 *
 * Artículos, verbos de decisión y palabras de comercio tan comunes que el
 * cliente las usa en cualquier frase. No son nombres de producto: el motor sigue
 * siendo agnóstico, y lo que se vende se escribe en el contenido.
 *
 * Vive en un solo sitio a propósito — la usan la detección de elección ambigua y
 * la regla de los nombres solapados, y las dos tienen que entender lo mismo por
 * «esta palabra no dice cuál».
 */
const PALABRAS_QUE_NO_DISTINGUEN = new Set([
  "el", "la", "los", "las", "de", "del", "un", "una", "y", "o",
  "quiero", "prefiero", "elijo", "escojo", "dame", "con",
  "solo", "curso", "cursos", "kit", "producto", "productos",
  "opcion", "opciones",
]);

function palabrasSueltas(value: string): string[] {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .filter(Boolean);
}

/**
 * GRAMÁTICA, NO PRODUCTOS. Las palabras que no pueden identificar nada.
 *
 * Preposiciones, artículos, contracciones y conjunciones del español. Se filtran
 * de los NOMBRES que escribe el dueño —no de lo que escribe el cliente— para que
 * un nombre como «<algo> 2 EN 1» no done la palabra «en» como si fuera suya. Ver
 * la nota larga dentro de `tokensPropiosDeCadaOpcion`, con la medición.
 *
 * NO HAY NINGÚN PRODUCTO AQUÍ, y no puede haberlo: son palabras de función. Vale
 * igual si mañana vende otra cosa, y es lo que pide CLAUDE.md.
 */
const PALABRAS_QUE_NO_NOMBRAN_UN_PRODUCTO = new Set([
  // Preposiciones.
  "a", "ante", "bajo", "cabe", "con", "contra", "de", "desde", "durante", "en",
  "entre", "hacia", "hasta", "mediante", "para", "por", "segun", "sin", "so",
  "sobre", "tras", "versus", "via",
  // Artículos y contracciones.
  "el", "la", "los", "las", "lo", "un", "una", "unos", "unas", "al", "del",
  // Conjunciones y enlaces.
  "y", "e", "o", "u", "ni", "que", "mas", "pero", "sino", "si", "tambien",
  "ademas", "aunque", "porque", "pues",
]);

/**
 * QUÉ PALABRA DISTINGUE A CADA OPCIÓN DE LA OTRA.
 *
 * Con «<NOMBRE> FULL» y «<NOMBRE> BASICO», las palabras de «<NOMBRE>» son
 * COMPARTIDAS —no distinguen nada— y «full» / «basico» son las PROPIAS de cada
 * una. Sale de los nombres configurados: no hay ningún nombre de producto
 * escrito en el código, y vale igual si mañana se llaman «PRO» y «LITE».
 *
 * Vive en un solo sitio a propósito. Estaba calculado dentro de
 * `isAmbiguousTwoTierChoice`, y quien decidía el CAMBIO de opción usaba en su
 * lugar una lista de palabras escrita a mano que no incluía «full»: cambiar al
 * básico se detectaba y cambiar al full no. Dos respuestas distintas a la misma
 * pregunta es como se separan con el tiempo.
 */
function tokensPropiosDeCadaOpcion(
  config: WorkflowConfig | null
): { compartidos: Set<string>; comboSolo: Set<string>; basicoSolo: Set<string> } | null {
  const ob = getActiveTwoTierOffer(config);
  if (!ob) return null;
  // UN NÚMERO NUNCA ES UNA PALABRA PROPIA DE UN PRODUCTO.
  //
  // LO QUE PASÓ — 25 de septiembre de 2026, en su prueba, tres conversaciones en
  // paralelo. Su opción cara se llamaba «<algo> 2 EN 1», así que el dígito «2»
  // quedó como palabra EXCLUSIVA de esa opción. Y esto lo usa la puerta que
  // decide si el cliente nombró un producto dentro de una frase, así que:
  //
  //     «son 2»                  -> registraba la opción cara
  //     «pregunte si son 2»      -> la registraba otra vez
  //     «quiero saber si son 2»  -> igual
  //     «tengo 2 hijos»          -> igual
  //
  // Él lo vio dos veces seguidas: preguntó «son 2» y recibió los datos de pago
  // del combo. Y con el básico elegido, ese mismo «son 2» se lo CAMBIABA al
  // caro — eso es cobrarle de más por una pregunta.
  //
  // Con sus palabras: «¿acaso el bot es tan bobo que no se da cuenta que eso no
  // es una petición?». El modelo no era el bobo: nunca vio el mensaje. El motor
  // decidía antes y le quitaba el turno. Quitando el número, el motor se aparta
  // y contesta quien sí sabe leer la frase entera.
  //
  // LOS NÚMEROS TIENEN SU PROPIO CAMINO, y es mejor que éste: el que mira la
  // numeración que el bot escribió en su último mensaje. Aquí solo estorbaban.
  //
  // Y NO SE PIERDE NADA de nombrar el producto: las palabras siguen contando.
  // Un nombre que fuera SOLO un número —«2»— se queda sin palabras propias, que
  // es lo correcto: nombrarlo así es indistinguible de decir una cantidad.
  // Y UNA PREPOSICIÓN TAMPOCO NOMBRA UN PRODUCTO. ES EL MISMO FALLO, TRES DÍAS
  // DESPUÉS.
  //
  // LO QUE PASÓ — 28 de septiembre de 2026, sus pruebas HOLARG1 y HOLAPER1. El
  // arreglo de arriba, del 25/09, quitó los NÚMEROS de «<algo> 2 EN 1» y dejó la
  // preposición. En ese nombre «EN» quedó como palabra EXCLUSIVA de la opción
  // cara, y «en» es la preposición más común del español.
  //
  // MEDIDO ejecutando esto con su configuración, doce de diecisiete frases
  // normales de un cliente que NO está eligiendo nada registraban la opción CARA:
  //
  //     «pago en yape»              -> la cara
  //     «estoy en casa»             -> la cara
  //     «lo vi en facebook»         -> la cara
  //     «mi hija esta en primaria»  -> la cara
  //     «en que momento me envian»  -> la cara
  //
  // LO QUE LE COSTÓ: sus dos conversaciones que venían de un solo producto, sin
  // elección anotada. El bot les anotó la opción cara por una preposición, les
  // pidió el precio de la barata, ellos pagaron ese, y el validador midió el pago
  // contra la cara: «ya registré 10, falta completar 4». Una nunca recibió el
  // material.
  //
  // POR QUÉ ESTA LISTA NO ES «EL PARCHE PALABRA POR PALABRA». Aquella lista
  // perseguía las palabras del CLIENTE, que son infinitas y cambian con cada
  // prueba. Esta dice otra cosa, y es cerrada: qué palabras NO PUEDEN identificar
  // un producto en ningún catálogo, porque son gramática. Es exactamente la misma
  // clase de regla que «un número no es el nombre de un producto», que está justo
  // arriba. Y se aplica a lo que el DUEÑO escribió en el nombre, no a lo que
  // escribe el cliente.
  //
  // NO SE PIERDE NINGUNA FORMA DE ELEGIR:
  //   · el nombre entero y los alias los casa `detectExactOrderBumpChoice`, que
  //     compara la frase completa y no pasa por aquí;
  //   · «quiero el pack 2 en 1» sigue eligiendo por «pack» y «super»;
  //   · un nombre que fuera SOLO gramática se queda sin palabras propias, igual
  //     que el que es solo un número, y entonces deciden la numeración del bot,
  //     el ordinal o el precio. Ninguno de esos caminos se toca.
  //
  // LA ÚNICA RENUNCIA, dicha para que quede escrita: si algún día llama a dos
  // productos «PACK A» y «PACK B», esa letra sola deja de distinguirlos dentro de
  // una frase. Se acepta a propósito: «a» aparece en «voy a pagar» y en «a cuanto
  // esta», así que conservarla es el mismo fallo de arriba. El nombre exacto, el
  // número y el ordinal siguen eligiéndolos.
  const tokens = (
    option: OrderBumpOption | undefined,
    cual: "combo" | "basico"
  ): Set<string> =>
    new Set(
      [nombreDeLaOpcion(cual, config), ...(option?.aliases ?? [])]
        .flatMap((value) => palabrasSueltas(value ?? ""))
        .filter((token) => !/^\d+$/.test(token))
        .filter((token) => !PALABRAS_QUE_NO_NOMBRAN_UN_PRODUCTO.has(token))
    );
  const combo = tokens(ob.combo, "combo");
  const basico = tokens(ob.basico, "basico");
  return {
    compartidos: new Set([...combo].filter((token) => basico.has(token))),
    comboSolo: new Set([...combo].filter((token) => !basico.has(token))),
    basicoSolo: new Set([...basico].filter((token) => !combo.has(token))),
  };
}

/**
 * UN NOMBRE DENTRO DEL OTRO: «<X>» y «COMBO <X> + <Y>», la forma normal de
 * nombrar un order bump.
 *
 * Cuando el nombre de una opción está ENTERO dentro del de la otra, la de dentro
 * se queda SIN NINGUNA palabra propia: «tintas» y «pepito» las tienen las dos.
 * Toda regla que pida una palabra exclusiva es ciega con ella, y nombrarla no
 * cuenta como elegirla.
 *
 * LO QUE DICE LA REGLA: la de fuera es la de dentro MÁS algo. Si el cliente
 * nombra lo compartido y NO nombra ese algo, está nombrando la de dentro — pidió
 * el producto sin los extras.
 *
 * SOLO MIRA CUANDO HAY SOLAPAMIENTO DE VERDAD: una de las dos sin palabras
 * propias. Con nombres que no se solapan —lo habitual— devuelve null sin tocar
 * nada, y deciden las reglas de siempre.
 *
 * VIVE EN UN SOLO SITIO A PROPÓSITO. La usan la primera elección
 * (`detectTwoTierPick`) y el cambio de opción (`inferTwoTierChoiceFromContext`).
 * Estuvo solo en la segunda, y el resultado fue que con estos nombres el cliente
 * no podía elegir el básico de ninguna manera: «quiero las tintas» no lo cazaba
 * nadie, contestaba el modelo re-explicando el producto y preguntando si lo
 * quería — con la elección ya hecha. Dos respuestas distintas a la misma
 * pregunta es como se separan con el tiempo.
 */
function opcionNombradaPorLoCompartido(
  msg: string,
  config: WorkflowConfig | null
): "combo" | "basico" | null {
  const propios = tokensPropiosDeCadaOpcion(config);
  if (!propios) return null;
  const sinPalabrasPropias =
    propios.basicoSolo.size === 0 && propios.comboSolo.size > 0
      ? "basico"
      : propios.comboSolo.size === 0 && propios.basicoSolo.size > 0
        ? "combo"
        : null;
  if (!sinPalabrasPropias) return null;
  // LO COMPARTIDO TIENE QUE DISTINGUIR DE VERDAD.
  //
  // Si los dos se llaman «EL CURSO» y «EL CURSO + BONO», lo compartido es «el»
  // y «curso»: palabras que el cliente escribe en cualquier frase. Sin este
  // filtro, un «quiero el combo» nombraría «el», no nombraría «bono», y la
  // regla entregaría el BARATO — justo al revés de lo que pidió. Cuando lo
  // compartido no distingue, la regla se aparta y deciden las de siempre.
  const compartidasQueDistinguen = [...propios.compartidos].filter(
    (palabra) => !PALABRAS_QUE_NO_DISTINGUEN.has(palabra)
  );
  if (compartidasQueDistinguen.length === 0) return null;
  const distintivas = new Set(compartidasQueDistinguen);
  const propiasDeLaOtra =
    sinPalabrasPropias === "basico" ? propios.comboSolo : propios.basicoSolo;
  const palabras = palabrasSueltas(msg);
  const nombraLoCompartido = palabras.some((palabra) =>
    distintivas.has(palabra)
  );
  const nombraLoDeLaOtra = palabras.some((palabra) =>
    propiasDeLaOtra.has(palabra)
  );
  return nombraLoCompartido && !nombraLoDeLaOtra ? sinPalabrasPropias : null;
}

/**
 * «MEJOR EL OTRO» — CAMBIAR DE OPCIÓN SIN NOMBRAR EL PRODUCTO.
 *
 * LO QUE PASABA. Con la opción ya elegida y los datos de pago delante, el
 * cliente escribió «creo que mejor el otro, no tengo mucho dinero». El motor no
 * lo registró: contestó el modelo y la elección guardada siguió siendo la cara.
 *
 * POR QUÉ. «el otro» está en `isProductInformationQuestion`, que corre antes y
 * devuelve «esto es una pregunta». Y esa línea NO SOBRA: es el candado del Order
 * Bump. «el otro», «el producto adicional», «el segundo producto» son como el
 * cliente pregunta por el producto que todavía no se le ha revelado, y ahí no se
 * puede decidir nada — del full no se dice ni precio ni contenido hasta que elija
 * método. Quitarla destaparía el producto oculto antes de tiempo.
 *
 * ASÍ QUE NO SE QUITA NADA: SE ACOTA. Esta excepción vive aquí, donde SÍ se sabe
 * qué eligió el cliente, y no en aquella función, que no sabe nada de él. Con la
 * elección sin hacer, esto ni se mira y el candado queda intacto.
 *
 * LAS CONDICIONES, Y DE DÓNDE SALE CADA UNA:
 *
 *  · YA ELIGIÓ. Sin elección previa no hay «el otro» que valga.
 *  · EL EXTRA NO ESTÁ EN JUEGO. Lo decide quien llama. Después de comprar, con
 *    el producto extra ofrecido, «quiero comprar el otro» puede ser el extra o
 *    la opción cara — y eso ya lo resuelve `queProductoNombra`, preguntándole
 *    cuál. Esa parte funciona bien y no se toca.
 *  · HAY PALABRA DE DECISIÓN en la misma frase: mejor, prefiero, quiero, dame,
 *    llevo, me quedo. Sin ella, «y el otro» es una pregunta.
 *  · NO PIDE INFORMACIÓN. «quiero saber qué trae el otro» lleva «quiero» y no es
 *    una decisión.
 *  · SIN NEGACIÓN EN ESA FRASE. «no quiero el otro» y «el otro no lo quiero» se
 *    quedan fuera. La coma corta: en «mejor el otro, no tengo dinero» el «no» es
 *    de otra idea — es el motivo del cambio, no una negación del producto.
 *  · NO NOMBRA NINGUNA DE LAS DOS. Si dice «el combo o el otro» está comparando;
 *    y si nombra una, deciden las reglas de siempre, que son más precisas.
 *  · NO ES «EL OTRO DÍA». Literal, y frecuentísimo: «el otro día lo vi más
 *    barato» no habla de productos y encima lleva «barato».
 *
 * El método de pago lo descarta quien llama: las dos puertas exigen ya que el
 * mensaje no nombre ninguno, así que «mejor con el otro método» no llega aquí.
 */
const DECIDE_CAMBIO =
  /\b(mejor|prefiero|quiero|dame|llevo|llevare|elijo|escojo|me quedo)\b/;
const PIDE_INFORMACION =
  /\b(saber|ver|conocer|explicar|explicame|entender|entiendo|diferencia|comparar|trae|traes|incluye|contiene|tiene)\b/;
const NIEGA = /\b(no|ni|tampoco|nunca|jamas)\b/;

/** Los verbos con los que se DECIDE. `mejor` no está: es un adverbio, y «no
 *  mejor el otro» es una decisión («no, mejor el otro»), no una negación. */
const VERBOS_DE_DECIDIR = new Set([
  "quiero", "quisiera", "prefiero", "elijo", "escojo", "llevo", "llevare",
  "llevaria", "dame", "quedo", "deseo", "compro", "comprare",
]);

/**
 * ¿EL «NO» DE ESTA FRASE NIEGA EL CAMBIO, O ABRE OTRA IDEA?
 *
 * EL «NO» QUE IMPORTA VA PEGADO AL VERBO DE DECIDIR. El otro —el que explica un
 * motivo— va suelto y no dice nada sobre lo que el cliente quiere:
 *
 *     «no quiero el otro»                          → niega el cambio
 *     «ya no quiero el otro»                       → niega el cambio
 *     «mejor el otro, no tengo mucho dinero»       → DECIDE, y explica por qué
 *     «no me alcanza, mejor el que viene solo»     → DECIDE, y explica por qué
 *     «no, mejor el otro»                          → DECIDE
 *
 * POR QUÉ NO BASTABA CON MIRAR SI HAY UN «no». Porque la frase entera se miraba
 * de una pieza. `cambioDeOpcionPorElOtro` parte el mensaje POR LA PUNTUACIÓN
 * para separar ideas — y el dueño lo dijo con todas las letras el 2026-09-14:
 * «las personas nunca ponen signos, ni comas». Sin la coma, «mejor el otro por
 * favor no tengo mucho dinero» es UNA sola frase, el «no» de «no tengo dinero»
 * cae dentro, y el cambio de opción se perdía. Pasó en la prueba de venta real
 * (`recorrido-completo.mjs`) y en las conversaciones del dueño.
 *
 * Así que la separación deja de depender de un signo que nadie escribe y pasa a
 * depender de la posición, que siempre está.
 */
function laNegacionEsDelCambio(frase: string): boolean {
  const palabras = frase.split(" ").filter(Boolean);
  for (let i = 0; i < palabras.length; i++) {
    if (!/^(no|ni|tampoco|nunca|jamas)$/.test(palabras[i])) continue;
    const siguiente = palabras[i + 1] ?? "";
    if (VERBOS_DE_DECIDIR.has(siguiente)) return true;
    // El pronombre no rompe la unión: «no me quedo con el otro».
    if (
      (siguiente === "me" || siguiente === "lo" || siguiente === "la") &&
      VERBOS_DE_DECIDIR.has(palabras[i + 2] ?? "")
    )
      return true;
  }
  return false;
}

function cambioDeOpcionPorElOtro(
  msg: string,
  currentChoice: string | null | undefined,
  config: WorkflowConfig | null
): "combo" | "basico" | null {
  if (currentChoice !== "combo" && currentChoice !== "basico") return null;
  // La puntuación separa ideas, igual que en la negación del método de pago.
  const frases = (msg ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .split(/[,.;:!?¿¡]+/)
    .map((frase) => frase.replace(/[^a-z0-9]+/g, " ").trim())
    .filter(Boolean);
  const laDelOtro = frases.find((frase) =>
    /\b(el otro|la otra|los otros|las otras)\b/.test(frase)
  );
  if (!laDelOtro) return null;
  if (/\bel otro dia\b/.test(laDelOtro)) return null;
  // EL «NO» SE MIRA POR POSICIÓN, EN TODAS LAS MODALIDADES.
  //
  // Se probó primero acotado a -OB-, como manda el dueño. Funcionó y él pidió
  // llevarlo al resto el 2026-09-14. Lo destapó el recorrido de venta: -DOU-
  // seguía con el fallo original y `recorrido-completo --todas` lo cantaba,
  //
  //     FALLA  y al decir «mejor el otro» cambia de verdad   combo → combo
  //
  // que es exactamente la venta que se perdía en -OB-. Dejarlo acotado habría
  // escrito en el código una diferencia entre modalidades que no existe.
  //
  // Ver `laNegacionEsDelCambio`: sin comas, el «no» de «no tengo dinero» caía
  // dentro de la misma frase y mataba un cambio de opción clarísimo.
  if (laNegacionEsDelCambio(laDelOtro)) return null;
  if (!DECIDE_CAMBIO.test(laDelOtro)) return null;
  if (PIDE_INFORMACION.test(laDelOtro)) return null;
  const propios = tokensPropiosDeCadaOpcion(config);
  if (propios) {
    const palabras = palabrasSueltas(msg);
    const nombraUnaDeLasDos = palabras.some(
      (palabra) => propios.comboSolo.has(palabra) || propios.basicoSolo.has(palabra)
    );
    if (nombraUnaDeLasDos) return null;
  }
  return currentChoice === "combo" ? "basico" : "combo";
}

/** Detección contextual de combo/básico para frases naturales como
 *  "quiero el de precio bajo" o "me paso al completo". */
/** Rejects a partial product name made only of tokens shared by both options. */
export function isAmbiguousTwoTierChoice(
  msg: string,
  config: WorkflowConfig | null
): boolean {
  if (isOrderBumpConversationQuestion(msg)) return false;
  // AQUÍ ES DONDE SE NOTA QUE DOS PRODUCTOS SE LLAMAN CASI IGUAL: si el cliente
  // dice solo lo COMPARTIDO, no eligió — hay que preguntarle cuál.
  const propios = tokensPropiosDeCadaOpcion(config);
  if (!propios) return false;
  if (propios.compartidos.size === 0) return false;
  const words = palabrasSueltas(msg).filter(
    (word) => !PALABRAS_QUE_NO_DISTINGUEN.has(word)
  );
  if (words.length === 0 || !words.some((word) => propios.compartidos.has(word)))
    return false;
  return !words.some(
    (word) => propios.comboSolo.has(word) || propios.basicoSolo.has(word)
  );
}

/**
 * ¿A QUÉ OPCIÓN SEÑALA ESE IMPORTE? SE LE PREGUNTA A QUIEN COBRA.
 *
 * LO QUE PASÓ — 28 de septiembre de 2026, su prueba HOL3. El cliente tenía la
 * opción CARA elegida, escribió «ESTA A 10 soles» —repitiendo el precio que
 * tenía delante— y el bot lo cambió a la BARATA y le cobró 8.
 *
 * MEDIDO con su configuración, y es lo que lo explica todo:
 *
 *     CAJAS de la oferta          QUIEN COBRA (ficha + país)
 *       cara    0  /  0             cara    14 / 10 en oferta
 *       barata 10  /  8             barata  10 /  8 en oferta
 *
 * Las dos funciones que leen un número miraban LAS CAJAS. Ahí el precio de la
 * opción cara vale CERO —sus precios viven en la ficha, por país, que es como
 * debe ser— así que:
 *
 *   · ningún importe podía señalar a la cara: «quiero el de 14» no era nada;
 *   · y cualquier importe que coincidiera con la barata la elegía a ella.
 *
 * No es el caso raro del cambio de modalidad: pasa en «como DOU» y en «como OB»
 * todos los días, con cualquier lista de precios.
 *
 * Y EL ORDEN IMPORTA MÁS QUE LA FUENTE. Preguntar a quien cobra no basta: con la
 * oferta corriendo, «10» es la CARA con descuento y también la BARATA a precio
 * normal. El cliente repite el número que tiene DELANTE, y lo que tiene delante
 * depende de la etapa. Así que se prueban primero los precios de SU etapa y sólo
 * después los otros.
 *
 * TRES CANDADOS, y son los de siempre:
 *
 *   · LA AMBIGÜEDAD SE RESPETA. Si el importe vale para las dos, no decide
 *     ninguna — en cada pasada por separado.
 *   · SIN DOS OPCIONES no hay nada que elegir.
 *   · Y SIN PRECIO RESOLUBLE se devuelve null, para que quien llama siga con las
 *     comparaciones de siempre. Esto AÑADE una lectura, no quita ninguna.
 */
function laOpcionPorElPrecioQueCobra(
  nums: Set<number>,
  phone: string | null | undefined,
  conOferta: boolean
): "combo" | "basico" | null {
  if (nums.size === 0) return null;
  const enEsaEtapa = (oferta: boolean): "combo" | "basico" | null => {
    const delCombo = getOrderBumpPriceSoles("combo", oferta, phone ?? null);
    const delBasico = getOrderBumpPriceSoles("basico", oferta, phone ?? null);
    const comboHit =
      typeof delCombo === "number" && delCombo > 0 && nums.has(Math.trunc(delCombo));
    const basicoHit =
      typeof delBasico === "number" && delBasico > 0 && nums.has(Math.trunc(delBasico));
    if (comboHit !== basicoHit) return comboHit ? "combo" : "basico";
    return null;
  };
  // EL PRECIO DE SU ETAPA PRIMERO: es el que el cliente tiene delante.
  return enEsaEtapa(conOferta) ?? enEsaEtapa(!conOferta);
}

export function inferTwoTierChoiceFromContext(
  msg: string,
  currentChoice: string | null | undefined,
  config: WorkflowConfig | null,
  /**
   * SOLO LO PASAN LAS DOS PUERTAS QUE PUEDEN SABERLO.
   *
   * `elExtraNoEstaEnJuego` habilita la excepción de «mejor el otro». Se queda
   * apagado por defecto A PROPÓSITO: quien no lo pase —la reconciliación del
   * comprobante, la detección de upgrade, el pago parcial— sigue comportándose
   * exactamente igual que hasta hoy. Ahí hay dinero contado, y «el otro» puede
   * referirse al producto extra.
   */
  opciones?: {
    elExtraNoEstaEnJuego?: boolean;
    /**
     * EL TELÉFONO DE QUIEN ESCRIBE, PARA LEER SU PRECIO Y NO EL DE OTRO PAÍS.
     *
     * Opcional a propósito: quien no lo pase se comporta exactamente igual que
     * hasta hoy. Lo pasan las puertas que tienen la conversación delante; las
     * que no —pruebas y llamadas sueltas— siguen decidiendo por las cajas.
     */
    phone?: string | null;
    /**
     * ¿ESTA CONVERSACIÓN ESTÁ EN LA ETAPA DE OFERTA?
     *
     * Decide qué precios se prueban PRIMERO, porque el cliente repite el número
     * que tiene delante. Ver `laOpcionPorElPrecioQueCobra`. Apagado por defecto:
     * quien no lo pase prueba los normales primero, como hasta hoy.
     */
    conOferta?: boolean;
  }
): "combo" | "basico" | null {
  const elTelefono = opciones?.phone ?? null;
  // «MEJOR EL OTRO» VA ANTES QUE EL FILTRO DE PREGUNTAS, y tiene que ir ahí:
  // el filtro trata «el otro» como pregunta —es el candado del Order Bump— así
  // que después de él no se llega nunca. Ver `cambioDeOpcionPorElOtro`, que
  // exige siete condiciones para no romper ese candado.
  if (opciones?.elExtraNoEstaEnJuego === true) {
    const porElOtro = cambioDeOpcionPorElOtro(msg, currentChoice, config);
    if (porElOtro && porElOtro !== currentChoice) return porElOtro;
  }
  // Una PREGUNTA por el contenido no cambia ni fija la elección (aunque nombre
  // el producto) → la maneja el LLM.
  if (isOrderBumpConversationQuestion(msg)) return null;
  // Una PREGUNTA DE PRECIO ("cuál cuesta 7 soles", "cuánto vale el de 10") tampoco
  // fija elección: el número es el SUJETO de la pregunta, no una decisión. Sin
  // esto, el match por precio de abajo tomaba el "7" como si eligiera esa opción.
  // OJO: elegir por precio ("el de 7", "el de 7 soles") NO trae palabras de
  // pregunta (precio/cuesta/vale/cuánto), así que sigue funcionando.
  if (isPriceQuestion(msg)) return null;
  const exactChoice = detectExactOrderBumpChoice(msg, config);
  if (exactChoice) return exactChoice;

  // EL CLIENTE NOMBRA EL PRODUCTO DENTRO DE UNA FRASE.
  //
  // «ah perdon maestro quiero el full» no lo cazaba nadie: el nombre completo no
  // está entero, y la regla de palabra única de `detectExactOrderBumpChoice`
  // solo decide cuando el mensaje ES prácticamente esa palabra. Resultado: ya
  // había elegido, cambiaba de opción, y el bot le volvía a preguntar si quería
  // los datos de pago — una pregunta que sobra, porque acababa de decidir.
  //
  // Basta con que aparezca una palabra que sea SOLO de una de las dos opciones y
  // ninguna de la otra. Sale de los nombres configurados, así que no hay ningún
  // nombre de producto escrito aquí. Si nombra las dos, no decide: eso es una
  // comparación y la lleva el modelo.
  const propios = tokensPropiosDeCadaOpcion(config);
  if (propios) {
    const palabras = palabrasSueltas(msg);
    const nombraLaMayor = palabras.some((p) => propios.comboSolo.has(p));
    const nombraLaMenor = palabras.some((p) => propios.basicoSolo.has(p));
    if (nombraLaMayor !== nombraLaMenor)
      return nombraLaMayor ? "combo" : "basico";
  }

  if (currentChoice !== "combo" && currentChoice !== "basico") return null;

  // UN NOMBRE DENTRO DEL OTRO: «<X>» y «COMBO <X> + <Y>».
  //
  // AQUÍ ESTABA EL FALLO — y no era que nadie estuviera escuchando.
  //
  // Cuando el nombre de la opción barata está ENTERO dentro del de la cara, la
  // barata se queda SIN NINGUNA palabra propia: las del nombre compartido las
  // tienen las dos. La regla de arriba pide una palabra exclusiva, así que
  // nombrar la barata era invisible. Y las de más abajo tampoco la salvan:
  // esperan un adjetivo («barato», «el otro»), no el nombre del producto.
  //
  // PASÓ DE VERDAD, en una prueba del 13 de septiembre de 2026. La clienta
  // eligió el combo, recibió los datos de pago y escribió «mejor <el barato> no
  // tengo mucho dinero». No lo cazó nadie, contestó el modelo —bien, hablando
  // del básico— y la elección guardada siguió siendo «combo». Dos mensajes
  // después nombró su método de pago y el registro lo dijo con todas las letras:
  // «order bump "combo" confirmado». Leyó un precio y le cobraron otro.
  //
  // LO QUE DICE LA REGLA vive en `opcionNombradaPorLoCompartido`, que es la
  // MISMA que usa la primera elección. Aquí se le añade la única condición que
  // es propia del cambio: SOLO SI CAMBIA lo que ya tenía elegido. Repetir la
  // suya no dice nada nuevo y no vuelve a mandar el pago.
  const porSolapamiento = opcionNombradaPorLoCompartido(msg, config);
  if (porSolapamiento && porSolapamiento !== currentChoice)
    return porSolapamiento;

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
    // QUIEN COBRA DECIDE, Y VA PRIMERO.
    //
    // ESTABA EL ÚLTIMO, Y ASÍ NO LLEGABA NUNCA. Se puso ahí el 26/09/2026 para
    // no cambiar nada de lo de antes, y ese cuidado es justo lo que rompió su
    // prueba HOL3 del 28/09: las comparaciones de las cajas de aquí abajo
    // contestan ANTES, y en las cajas el precio de la opción cara vale CERO.
    // Así que el importe que el cliente repetía solo podía señalar a la barata.
    //
    // Medido: con la opción cara elegida, «ESTA A 10 soles» —el precio de la
    // cara con la oferta corriendo— lo cambiaba a la barata y le cobraba 8.
    //
    // Las comparaciones de abajo NO se quitan: siguen contestando cuando el
    // precio de verdad no se puede resolver. Ver `laOpcionPorElPrecioQueCobra`.
    const porElQueCobra = laOpcionPorElPrecioQueCobra(
      nums,
      elTelefono,
      opciones?.conOferta === true
    );
    if (porElQueCobra) return porElQueCobra;
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
    // Y POR ÚLTIMO, EL PRECIO QUE EL BOT LE ENSEÑÓ A ESTE CLIENTE.
    //
    // LO QUE PASÓ — 26 de septiembre de 2026, su prueba HOLAARG3. El bot le
    // escribió la opción barata con su importe, él contestó «quiero el de
    // <ese importe>» y NO se reconoció. Soltó el turno, lo cogió el modelo, y
    // el modelo se inventó que el enlace ya se había enviado y que «no se me
    // permite reenviarlo» — nada de eso existe en el código. Acabó escribiendo
    // «estafador» a un bot que tenía su pago cobrado y su producto sin entregar.
    //
    // POR QUÉ NO CALZABA. Las dos comparaciones de arriba miran las cajas de la
    // oferta, donde viven los precios GLOBALES. Los suyos viven en la ficha, POR
    // PAÍS, y además estaba en etapa de descuento: 5000 era el promocional de
    // Argentina y no está en ninguna de esas dos cajas. Medido ejecutando esta
    // función: «el de 8000» —el normal— sí se reconocía; «el de 5000» —el que
    // tenía delante— no. Es la caja que un camino llena y otro no leer, otra vez.
    //
    // SE LE PREGUNTA A QUIEN COBRA, que es el único que sabe el precio de
    // verdad: ficha, país y congelado incluidos. Con los DOS, normal y de
    // oferta, porque el cliente repite el número que tiene delante y ése cambia
    // según la etapa en la que esté.
    //
    // VA EL ÚLTIMO A PROPÓSITO: las dos comparaciones de arriba deciden igual
    // que ayer, letra por letra. Esto solo contesta donde antes no contestaba
    // nadie. Y CONSERVA LA REGLA DE LA AMBIGÜEDAD: si la cifra vale para las
    // dos opciones, no elige ninguna.
    //
    // SIN TELÉFONO SE COMPORTA COMO ANTES. Quien no lo pase —las pruebas, la
    // reconciliación del comprobante— lee el país por defecto, que es justo lo
    // que hacía hasta hoy.
    // AQUÍ VIVÍA ESTA LECTURA, Y SE MUDÓ ARRIBA — es el arreglo del 28/09/2026.
    //
    // Puesta al final nunca llegaba: las comparaciones de las cajas contestaban
    // primero, y en las cajas el precio de la opción cara vale cero. Ahora es lo
    // PRIMERO que se pregunta y además ordena las dos pasadas por la etapa de la
    // conversación. Vive en `laOpcionPorElPrecioQueCobra`, que la comparten las
    // dos funciones que leen un número, para que no puedan discrepar.
  }

  const wantsOther = /\b(el\s+)?otro(s)?\b|\bla\s+otra\b/.test(normalized);
  // «MENOS» A SECAS NO NOMBRA NINGÚN PRODUCTO — Y CANCELÓ UN UPGRADE.
  //
  // LO QUE PASÓ, EL 14 DE SEPTIEMBRE DE 2026, EN -OB-. El cliente ya había
  // pagado la opción barata, ya tenía su enlace, y estaba completando el saldo
  // para subir a la cara: el motor le había anotado «saldo pendiente S/.4».
  // Entonces escribió, preguntando por una rebaja:
  //
  //     «NADA MENOS»
  //
  // Aquí se leyó la palabra `menos` como «quiero el barato», y
  // `resolveAccumulatedOrderBumpChoice` hizo tres cosas seguidas: le canceló la
  // elección cara, congeló el precio esperado en lo que ya había pagado, y le
  // REENVIÓ el enlace que ya tenía. Cuando mandó el comprobante del saldo no
  // quedaba nada que resolver: pagó y no recibió nada.
  //
  // Y NO SALTABA SIEMPRE, que es lo que despistaba: esta puerta solo corre en
  // ciertas etapas. En otra conversación el mismo día, «algo menos» en una etapa
  // posterior lo atendió el modelo y lo entendió como regateo, que es lo
  // correcto. Misma palabra, resultado opuesto según dónde caiga.
  //
  // `menos` es de las palabras más comunes del idioma y casi nunca habla de
  // productos: «nada menos», «algo menos», «más o menos», «por lo menos»,
  // «menos mal». Solo señala la opción barata cuando COMPARA — «el de menos»,
  // «menos caro» —, y a esas dos formas se acota. La regla no se quita.
  //
  // Solo en -OB- por orden del dueño. Fuera de ahí, la lista de siempre.
  const enOB = laModalidadActivaEsOrderBump();
  const loBarato = enOB
    ? /\b(basico|barato|economico|comodo|accesible|menor|simple)\b/
    : /\b(basico|barato|economico|comodo|accesible|menor|menos|simple)\b/;
  const menosQueCompara =
    enOB &&
    (/\b(el|lo)\s+de\s+menos\b/.test(normalized) ||
      /\bmenos\s+(caro|costoso|precio)\b/.test(normalized));
  const wantsCheaper =
    loBarato.test(normalized) ||
    menosQueCompara ||
    /\b(precio|cuesta|vale|costo|pago)\s+(mas\s+)?(bajo|barato|economico|comodo|accesible|menor)\b/.test(
      normalized
    ) ||
    /\b(mas|el)\s+(barato|economico|comodo|accesible|bajo)\b/.test(
      normalized
    );
  // «full» se suma a la lista que ya usa el detector de la elección. No se traen
  // las demás palabras de allí —«todo», «caro», «alto», «grande»— a propósito:
  // aquí el cliente YA eligió y habla de todo, y un «está caro» o un «gracias
  // por todo» se leería como que cambia de producto.
  const wantsCombo =
    /\b(combo|completo|pack|premium|vip|mayor|full)\b/.test(normalized) ||
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
/** ¿El cliente contestó con el NÚMERO de la lista? Devuelve la posición.
 *
 *  Se exige el mensaje ENTERO —«el 2», «segundo», «quiero la 1»—, nunca un
 *  número suelto dentro de una frase. Esa ancla es toda la seguridad: hay
 *  productos que se llaman «2 EN 1», y «que trae el 2 en 1» no puede elegir
 *  nada. */
function elOrdinalQueEligio(normalized: string): 1 | 2 | null {
  const t = normalized.trim();
  const PRIMERA = "(1|uno|primero|primera|primer)";
  const SEGUNDA = "(2|dos|segundo|segunda)";
  const PIDE = "(quiero|elijo|escojo|prefiero|dame|llevo|llevare|me quedo con)";
  if (new RegExp(`^(el|la|lo)?\\s*${PRIMERA}$`).test(t)) return 1;
  if (new RegExp(`^(el|la|lo)?\\s*${SEGUNDA}$`).test(t)) return 2;
  if (new RegExp(`^${PIDE}\\s+(el|la|lo)?\\s*${PRIMERA}$`).test(t)) return 1;
  if (new RegExp(`^${PIDE}\\s+(el|la|lo)?\\s*${SEGUNDA}$`).test(t)) return 2;
  return null;
}

/**
 * EL SUBJUNTIVO DE ENCARGO: «que sea el 1», «que quede en el 2».
 *
 * No pregunta nada: encarga. Es un grupo CERRADO de formas verbales, no una
 * lista de sinónimos que crezca con cada prueba.
 *
 * VIVE AQUÍ, EN UN SOLO SITIO, porque lo usan las DOS reglas que leen la
 * elección —la de la posición del «que» y la del número de la lista—. Con una
 * copia en cada una, el día que alguien añada una forma a la primera, «que sea
 * el 1» dejaría de elegir mientras «que sea el combo» seguiría eligiendo.
 */
const SUBJUNTIVO_DE_ENCARGO = new Set(["sea", "sean", "quede", "queden"]);

/**
 * «CREO QUE EL 1» — LA DUDA DELANTE DEL NÚMERO.
 *
 * LO QUE PASÓ — 16 de septiembre de 2026, -DOU-, convo 125 del dueño. Escribió
 * «creo que el 1» para elegir el full. No se registró nada. Dos mensajes después
 * dijo «con yape», y como seguía sin elección anotada el turno cayó por el
 * camino de «pago sin elegir»: recibió unos datos de pago con un importe que no
 * era ninguna de sus dos opciones, y debajo el recordatorio con las dos.
 *
 * POR QUÉ NO ENTRABA. `elOrdinalQueEligio` exige que el mensaje sea ENTERO el
 * número —«el 1», «quiero la 2»— y ese ancla es toda su seguridad: hay productos
 * que se llaman «2 EN 1», y «que trae el 2 en 1» no puede elegir nada. Pero la
 * gente no contesta con el número pelado: le pone la duda delante.
 *
 * Medido antes de tocar nada, esto fallaba también en -OB-, donde el número
 * lleva funcionando desde el 13: cuatro frases de veintitrés.
 *
 * LA REGLA, Y NO AFLOJA EL ANCLA. Se le quita a la frase lo que va hasta el
 * «que» y se le aplica el MISMO ancla al resto. El «que» tiene que ser de
 * relleno, no de pregunta, y eso NO lo decide una lista de palabras: lo decide
 * `elQueEsElDePreguntar`, la regla de posición que ya está medida y en uso.
 *
 * Así «creo que el 1» elige, y «que trae el 1» sigue sin elegir — ese ni llega
 * aquí, lo corta el filtro de preguntas de más arriba.
 */
function elOrdinalTrasLaDuda(normalized: string): 1 | 2 | null {
  if (elQueEsElDePreguntar(normalized)) return null;
  const i = normalized.lastIndexOf(" que ");
  if (i < 0) return null;
  const resto = normalized.slice(i + " que ".length).trim();
  // «ok entonces que SEA el 1» — el mismo subjuntivo de encargo que reconoce la
  // regla del «que». Se le quita y queda «el 1», que es lo que el ancla espera.
  const palabras = resto.split(" ").filter(Boolean);
  const sinEncargo = SUBJUNTIVO_DE_ENCARGO.has(palabras[0] ?? "")
    ? palabras.slice(1).join(" ")
    : resto;
  return elOrdinalQueEligio(sinEncargo);
}

/** QUÉ NUMERÓ EL BOT EN SU ÚLTIMO MENSAJE.
 *
 *  El orden NO se escribe aquí: se lee del texto que el propio bot acaba de
 *  mandar. Si escribió «1. <opción> … 2. <opción>», esta función dice cuál es
 *  cuál mirando qué nombre de la configuración aparece detrás de cada número.
 *
 *  Con dos opciones basta reconocer UNA: la otra es la que queda. Hace falta,
 *  porque cuando el nombre de la barata está entero dentro del de la cara
 *  («\<barata\>» dentro de «COMBO \<barata\> + \<extra\>») la barata no tiene
 *  ninguna palabra propia. */
function laNumeracionQueEscribioElBot(
  ultimaDelBot: string,
  config: WorkflowConfig | null
): { primera: "combo" | "basico"; segunda: "combo" | "basico" } | null {
  const propios = tokensPropiosDeCadaOpcion(config);
  if (!propios) return null;
  const t = (ultimaDelBot ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "");
  const trasElNumero = (numero: string): string => {
    const m = new RegExp(`(?:^|[^a-z0-9])${numero}\\s*[.)\\-:]`).exec(t);
    if (!m) return "";
    // SE LEE LO QUE VA DETRÁS DEL NÚMERO, SIN EL NÚMERO.
    //
    // El marcador «1)» entraba en el trozo, y con un nombre que lleva dígitos
    // —«<algo> 2 EN 1»— ese «1» es una palabra PROPIA de esa opción. O sea que el
    // número de la lista se reconocía a sí mismo como si fuera el nombre, y el
    // «1» devolvía la opción cara pasara lo que pasara. Lo que identifica a una
    // opción es lo que el bot escribió DESPUÉS del número.
    const inicio = m.index + m[0].length;
    const trozo = t.slice(inicio, inicio + 140);
    // Y SE CORTA DONDE EMPIEZA EL SIGUIENTE NÚMERO DE LA LISTA.
    //
    // LO QUE PASÓ — 25 de septiembre de 2026. Los 140 caracteres se llevaban por
    // delante la otra opción: con una lista corta —«1) <la barata> S/.10  2) <la
    // cara> S/.14»— el trozo del 1 contenía también el nombre de la cara, y el
    // reconocedor de abajo devolvía la CARA para el número 1. Así, un cliente que
    // contestaba «el 1» se llevaba el producto equivocado, y más caro.
    //
    // Un elemento de una lista numerada termina donde empieza el siguiente. No es
    // una longitud adivinada: es dónde acaba de verdad. Los 140 se quedan como
    // tope para cuando no hay siguiente.
    const siguiente = /[^a-z0-9]\d+\s*[.)\-:]/.exec(trozo);
    return siguiente ? trozo.slice(0, siguiente.index) : trozo;
  };
  const deQuienEs = (trozo: string): "combo" | "basico" | null => {
    const palabras = trozo.replace(/[^a-z0-9]+/g, " ").split(" ").filter(Boolean);
    if (palabras.some((p) => propios.comboSolo.has(p))) return "combo";
    if (palabras.some((p) => propios.basicoSolo.has(p))) return "basico";
    return null;
  };
  const laOtra = (o: "combo" | "basico") => (o === "combo" ? "basico" : "combo");
  const uno = deQuienEs(trasElNumero("1"));
  const dos = deQuienEs(trasElNumero("2"));
  if (uno && dos) return uno === dos ? null : { primera: uno, segunda: dos };
  if (uno) return { primera: uno, segunda: laOtra(uno) };
  if (dos) return { primera: laOtra(dos), segunda: dos };
  return null;
}

/**
 * LA OPCIÓN QUE EL BOT ACABA DE PROPONER, SI PROPUSO UNA SOLA.
 *
 * LO QUE PASÓ — 16 de septiembre de 2026, -DOU-, convo 127 del dueño. Le
 * preguntó cuál le recomendaba, y el bot contestó:
 *
 *     «¡Te recomiendo el <opción mayor>! … ¿Te animas con el combo completo?»
 *
 * Él dijo «si». Y el bot entendió perfectamente —contestó «¡Excelente decisión!»
 * y le puso el precio CORRECTO de esa opción—, pero la elección NO se registró
 * en ningún sitio. Dos mensajes después escribió su método de pago y, al no
 * haber opción anotada, el turno cayó por el camino de «pago sin elegir»: le
 * llegaron unos datos con un importe que no era de ninguna de las dos, y debajo
 * el recordatorio con las dos.
 *
 * LAS DOS PUERTAS CERRADAS A LA VEZ, que es lo que lo hacía invisible:
 *
 *   · El MODELO no lo registra porque se lo prohibimos: su instrucción dice
 *     «call seleccionar_opcion only after a clear product decision; never for
 *     uncertainty». Un «sí» pelado no nombra ningún producto.
 *   · El MOTOR no lo registra porque solo mira las palabras del CLIENTE, y ahí
 *     no hay ninguna opción nombrada.
 *
 * Y sin embargo la decisión existe, entera: la propuso el bot y el cliente la
 * afirmó. Está en las DOS mitades de la conversación, no en una.
 *
 * ESTO NO ES UNA REGLA NUEVA, ES UNA QUE FALTABA. El dueño la tiene escrita como
 * requisito: «si el bot pregunta "¿deseas adquirirlo?" y el cliente afirma —"ok",
 * "sí", "está bien", lo que sea— se reenvían los datos EN EL ACTO». Existía para
 * una sola opción y no para dos.
 *
 * SI EL BOT NOMBRÓ LAS DOS, AQUÍ NO SE DECIDE NADA. «Tenemos <A> y <B>, ¿cuál
 * prefieres?» seguido de «sí» no elige: eso es justo lo que no se puede adivinar,
 * y se queda como hoy.
 *
 * Y SE MIRA EL NOMBRE COMPLETO DE LA MENOR cuando está entero dentro de la
 * mayor —el caso del combo que se llama como el básico más algo—, porque
 * entonces la menor no tiene ninguna palabra propia y proponerla sería
 * invisible. Es la misma trampa que ya resuelve `opcionNombradaPorLoCompartido`.
 */
export function laOpcionQueElBotPropuso(
  ultimaDelBot: string,
  config: WorkflowConfig | null,
  opciones?: {
    /**
     * EL CLIENTE YA TIENE UNA OPCIÓN ELEGIDA, así que lo único que puede pasar
     * aquí es que la CAMBIE. Ver el freno de abajo: con esto no hace falta que
     * el bot cierre con una frase conocida ni que escriba un precio.
     */
    elClienteYaTieneUnaElegida?: boolean;
  }
): "combo" | "basico" | null {
  const oferta = getActiveTwoTierOffer(config);
  const propios = tokensPropiosDeCadaOpcion(config);
  if (!oferta || !propios) return null;
  const limpio = (t: string | undefined | null): string =>
    (t ?? "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Mn}/gu, "")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  const texto = limpio(ultimaDelBot);
  if (!texto) return null;
  // Y TIENE QUE ESTAR PROPONIENDO LA COMPRA, NO PREGUNTANDO CUALQUIER COSA.
  //
  // LO QUE ESTO EVITA, y lo destapó el recorrido de venta antes de que llegara a
  // nadie: una burbuja de la intro que pregunte «¿ya trabajaste con <opción>?»
  // nombra UNA opción y termina en «?». Sin este freno, un «sí» a esa pregunta
  // —que es de experiencia, no de compra— cerraba la venta de esa opción.
  //
  // ESTA LISTA NO BASTA, Y SE ESCRIBIÓ CREYENDO QUE SÍ.
  //
  // Decía aquí: «es una lista y aquí sí vale, son las formas en que cierra EL
  // BOT, y el bot escribe siempre igual». ES FALSO, y costó un día: el bot no
  // escribe sus burbujas de conversación — LAS REDACTA EL MODELO, que improvisa
  // el cierre cada vez. La regla del dueño sobre no perseguir palabras vale
  // igual aquí.
  //
  // LO QUE COSTÓ — 16 de septiembre de 2026, -DOU-, conversación HELLO1. El
  // modelo cerró con «¿Te gustaría llevarte el <opción mayor>? Solo son <su
  // precio> — dime y te indico cómo adquirirlo», el cliente dijo «si», y NINGUNA
  // de estas diecisiete frases la cazaba. La función se salía por aquí sin mirar
  // el precio ni el nombre, la elección no se registró, el turno se le soltó al
  // modelo, y dos mensajes después el cliente tuvo que volver a elegir.
  //
  // LA LISTA SE QUEDA, no se quita: lo que caza hoy lo sigue cazando, y hay
  // cierres suyos que no llevan precio («¿te animas con el completo?»). Lo que
  // se añade debajo es un SEGUNDO camino que no depende de cómo redacte nadie.
  const proponeComprar =
    /\b(te animas|lo quieres|la quieres|lo queres|la queres|lo llevamos|lo confirmamos|te lo preparo|deseas adquirirlo|quieres adquirirlo|queres adquirirlo|lo adquieres|te lo dejo|vamos con|nos quedamos con|te lo aparto|confirmamos)\b/.test(
      texto
    );
  // SI ENSEÑA LOS DOS PRECIOS, ESTÁ PRESENTANDO LAS DOS. No hay nada que
  // proponer: está preguntando. Los importes salen de la configuración, así que
  // aquí no hay ningún número escrito a mano.
  const importesDe = (o: OrderBumpOption | undefined): number[] =>
    [o?.price_soles, o?.discount_price_soles]
      .filter((n): n is number => typeof n === "number" && n > 0)
      .map((n) => Math.trunc(n));
  const numerosEnOrden = (texto.match(/\d+/g) ?? []).map((n) => parseInt(n, 10));
  const numeros = new Set(numerosEnOrden);
  const conElPrecioMayor = importesDe(oferta.combo).some((p) => numeros.has(p));
  const conElPrecioMenor = importesDe(oferta.basico).some((p) => numeros.has(p));
  if (conElPrecioMayor && conElPrecioMenor) return null;
  // EL SEGUNDO CAMINO: PONERLE PRECIO A UNA SOLA ES PROPONERLA.
  //
  // El importe no lo redacta el modelo: sale de la configuración del dueño. Si
  // en la burbuja aparece el precio de UNA de las dos y no el de la otra, esa
  // burbuja está ofreciendo esa opción, lo diga con las palabras que lo diga.
  // Cambie el dueño de producto o de precio en el editor, esto sigue igual.
  //
  // NO ES UN INVENTO: es el patrón que ya usa `looksLikeDirectPriceAnswer` en
  // handler.ts desde hace meses para saber si el bot ya dio el precio —importe
  // con moneda ADEMÁS de la frase— y no ha dado un solo problema.
  //
  // Y SUMA, NO SUSTITUYE. Lo que cazaba la lista se sigue cazando por la lista:
  // un cierre sin precio («¿te animas con el completo?») entra por arriba. Aquí
  // solo se abre camino donde antes no había ninguno.
  //
  // EL FRENO QUE SE CONSERVA sigue entero: si nombra las DOS opciones, o si no
  // se puede decidir cuál nombra, más abajo devuelve vacío igual que siempre.
  // Un «¿ya trabajaste con <opción>?» sin precio tampoco entra por aquí.
  //
  // MEDIDO CONTRA EL CONTENIDO DEL DUEÑO, no supuesto: de sus 1.785 burbujas de
  // texto, las que este camino registraría con un «sí» son TRES, y las tres son
  // el mensaje del regalo de la postventa — un estado en el que esta función ni
  // se llama. En las burbujas de elección: ninguna.
  // DOS IMPORTES EN LA MISMA BURBUJA SON UNA LISTA DE PRECIOS, NO UNA OFERTA.
  //
  // Y NO BASTA CON MIRAR SI SON DE LAS DOS OPCIONES DISTINTAS. Lo destapó la
  // medición contra las conversaciones reales del dueño: su recordatorio de las
  // dos opciones estaba saliendo con el MISMO nombre repetido —una vez con un
  // precio y otra vez con el otro—, y en otros casos con el mismo precio dos
  // veces. Con el mismo importe repetido, «¿enseña los dos precios?» dice que no
  // y la burbuja pasaba por propuesta de una sola opción. Es el menú: la
  // pregunta que MENOS puede elegir sola, porque es justo la que se manda cuando
  // el cliente todavía no ha elegido.
  //
  // Contando importes en vez de compararlos, el menú queda fuera salga como
  // salga: dos importes escritos, dos opciones sobre la mesa.
  const cuantosImportesDice = numerosEnOrden.filter((n) =>
    [...importesDe(oferta.combo), ...importesDe(oferta.basico)].includes(n)
  ).length;
  if (cuantosImportesDice >= 2) return null;
  const conElPrecioDeUnaSola = conElPrecioMayor !== conElPrecioMenor;
  // Y SI YA TIENE UNA ELEGIDA, NOMBRAR LA OTRA YA ES PROPONER EL CAMBIO.
  //
  // LO QUE PASÓ — 25 de septiembre de 2026, su conversación 136. Tenía la opción
  // cara elegida y los datos de pago ya enviados. Escribió «no me alcanzamejor
  // el otro» —con el «mejor» pegado a la palabra anterior, así que el detector
  // que lee al CLIENTE no lo resolvió— y contestó el modelo, nombrando UNA sola
  // opción y preguntando:
  //
  //     «La otra opción es <la barata>, que incluye …»
  //     «¿Te gustaría ir por esa opción?»
  //
  // Él dijo «si» y le llegaron otra vez los datos de la CARA. Medido con su
  // texto real contra esta función: devolvía vacío, y se salía justo aquí. «¿Te
  // gustaría ir por esa opción?» no está entre las diecisiete frases de arriba,
  // y el turno no llevaba ningún importe, así que ni la lista ni el precio la
  // dejaban pasar. Es la dieciochoava forma de cerrar — y detrás viene la
  // diecinueve, porque estas burbujas las REDACTA EL MODELO.
  //
  // POR QUÉ AQUÍ SE PUEDE DECIDIR SIN LA FRASE Y SIN EL PRECIO. Con una opción
  // ya elegida, lo único que puede ocurrir es un CAMBIO: las dos puertas que
  // atienden exigen `otra !== la que tiene`. Y para cambiar, el turno del bot
  // tiene que nombrar la OTRA y no la suya — eso ya es proponer el cambio, con
  // las palabras que sean. No se adivina nada: el nombre sale de su editor.
  //
  // LOS FRENOS SIGUEN ENTEROS. Si nombra las dos, si escribe dos importes, o si
  // no se puede decidir cuál nombra, esto devuelve vacío igual que siempre. Y la
  // PRIMERA elección —cuando todavía no hay ninguna— sigue exigiendo la frase o
  // el precio, porque ahí sí se estrenaría una opción que nadie pidió: es el
  // «¿ya trabajaste con <opción>?» del freno de aquí arriba.
  if (
    !proponeComprar &&
    !conElPrecioDeUnaSola &&
    !opciones?.elClienteYaTieneUnaElegida
  ) {
    return null;
  }

  const palabras = new Set(texto.split(" ").filter(Boolean));
  const nombraLaMayor = [...propios.comboSolo].some((p) => palabras.has(p));
  const nombreDeLaMenor = limpio(oferta.basico?.name);
  const nombreDeLaMayor = limpio(oferta.combo?.name);
  // CUÁNTAS VECES APARECE CADA NOMBRE, y no si aparece.
  //
  // Con el nombre de la menor ENTERO dentro del de la mayor, preguntar «¿aparece
  // la menor?» da que sí siempre que aparezca la mayor. Así que
  // «Tenemos <mayor> y <menor>, ¿cuál prefieres?» se leía como proponer la
  // mayor — y ese es el mensaje MÁS FRECUENTE de esta etapa: habría elegido
  // sola en cada «¿cuál prefieres?».
  //
  // Contando, la cuenta sale: el nombre de la menor aparece una vez de más
  // cuando está además por su cuenta.
  const vecesQueAparece = (aguja: string): number =>
    aguja.length === 0 ? 0 : texto.split(aguja).length - 1;
  const nombraLaMenor =
    [...propios.basicoSolo].some((p) => palabras.has(p)) ||
    vecesQueAparece(nombreDeLaMenor) > vecesQueAparece(nombreDeLaMayor);
  if (nombraLaMayor === nombraLaMenor) return null;
  return nombraLaMayor ? "combo" : "basico";
}

/** LA OPCIÓN QUE OCUPA ESA POSICIÓN.
 *
 *  Primero manda lo que el bot numeró en su último mensaje — el cliente
 *  contesta a lo que acaba de leer. Si no numeró nada (por ejemplo, contesta
 *  justo después de la intro, que no lleva números), se usa el orden en que la
 *  oferta presenta las opciones: la de arriba es la 1.
 *
 *  NO HAY NINGÚN ORDEN ESCRITO EN EL CÓDIGO. Hoy la oferta enseña primero la
 *  conjunta y después la suelta, así que 1=conjunta y 2=suelta; el día que el
 *  operador le dé la vuelta en su editor, esto le sigue sin tocar una línea. */
function opcionEnLaPosicion(
  posicion: 1 | 2,
  ultimaDelBot: string | undefined,
  config: WorkflowConfig | null
): "combo" | "basico" | null {
  if (!getActiveTwoTierOffer(config)) return null;
  const numerado = laNumeracionQueEscribioElBot(ultimaDelBot ?? "", config);
  if (numerado) return posicion === 1 ? numerado.primera : numerado.segunda;
  return posicion === 1 ? "combo" : "basico";
}

export function detectTwoTierPick(
  msg: string,
  config: WorkflowConfig | null,
  opciones?: {
    /** El último mensaje del bot, para resolver «el 2» contra lo que él numeró. */
    ultimaDelBot?: string;
    /**
     * EL TELÉFONO DE QUIEN ESCRIBE Y SU ETAPA, para leer SU precio.
     *
     * Los dos son opcionales a propósito: quien no los pase decide por las cajas
     * de la oferta, exactamente como hasta hoy. Ver
     * `laOpcionPorElPrecioQueCobra`.
     */
    phone?: string | null;
    conOferta?: boolean;
  }
): "combo" | "basico" | null {
  // 0) Una PREGUNTA por el contenido ("¿qué trae el básico?", "qu3 trae el
  //    basico") NO es una elección aunque nombre el producto → la maneja el LLM.
  //    Va PRIMERO: si corre después, el nombre dentro de la pregunta disparaba
  //    el pago.
  if (isOrderBumpConversationQuestion(msg)) return null;
  // 0.b) Una PREGUNTA DE PRECIO ("cuánto cuesta el mega", "cuánto vale el
  //    superkit") tampoco es elección: el nombre del producto es el SUJETO de la
  //    pregunta, no una decisión. La responde el LLM (igual que "cuál es el precio
  //    del mega"). Sin esto, "mega/superkit" dentro de la pregunta disparaba el
  //    pago. OJO: una elección por precio ("el de 9", "el de 9 soles") NO trae
  //    palabras de pregunta (precio/cuesta/cuánto/vale), así que sigue funcionando.
  if (isPriceQuestion(msg)) return null;
  // 1) Nombre/alias/tokens exactos de la opción.
  const exact = detectExactOrderBumpChoice(msg, config);
  if (exact) return exact;
  // 1.b) UN NOMBRE DENTRO DEL OTRO. Cuando una opción se llama como la otra MÁS
  //    algo, la de dentro no tiene ninguna palabra propia y nombrarla no la
  //    elegía: el turno se lo quedaba el modelo, que re-explica y repregunta lo
  //    que el cliente acababa de decidir, y el motor seguía con la otra opción
  //    guardada — y con SU precio. Es la MISMA regla que usa el cambio de
  //    opción; ver `opcionNombradaPorLoCompartido`. Va después de los nombres
  //    exactos, para que nombrar la de fuera entera siga siendo la de fuera, y
  //    solo mira cuando hay solapamiento de verdad.
  const porSolapamiento = opcionNombradaPorLoCompartido(msg, config);
  if (porSolapamiento) return porSolapamiento;
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
  // NI CUANDO EL NÚMERO ES EL QUE LE DIJERON.
  //
  // La lista ya descartaba el número de cantidad («son 3 soles», «a eran 2»,
  // «tengo 2»). Faltaba el otro caso en que el número describe algo y no elige:
  // cuando el cliente REPITE un precio que le dieron, para preguntarlo o para
  // quejarse — «no costaba 10», «no era 10», «no me dijiste 10», «no estaba a
  // 10». Ahí el número es el sujeto de la duda, no la opción elegida.
  //
  // Pasó el 14 de septiembre de 2026: «no entiendo / no costaba 10» eligió el
  // básico y le mandó sus datos de pago.
  const numberIsQuantity =
    /\b(son|eran|hay|habia|habian|tengo|tienes|cuantos|cuantas)\b/.test(
      normalized
    ) ||
    /\b(costaba|costaban|costo|costaria|era|estaba|dijiste|dijo|decia|dicho|valia)\b/.test(
      normalized
    );
  if (nums.size > 0 && !numberIsQuantity) {
    // QUIEN COBRA DECIDE, Y VA PRIMERO. Ver `laOpcionPorElPrecioQueCobra`.
    //
    // Sin esto, la comparación de abajo mira las CAJAS de la oferta, donde el
    // precio de la opción cara vale cero cuando los precios viven en la ficha
    // por país —que es como el dueño los tiene—. Resultado medido el 28/09/2026:
    // «quiero el de 14» no elegía nada, y cualquier importe que coincidiera con
    // la barata la elegía a ella. La opción cara no se podía elegir por su
    // precio, en «como DOU» y en «como OB», todos los días.
    //
    // Y ADEMÁS DESAMBIGUA POR ETAPA, que la de abajo no puede: ésta mira los dos
    // precios de cada opción JUNTOS, así que con la oferta corriendo un importe
    // que es el de la cara con descuento y el de la barata sin él salía empatado
    // y no decidía nada.
    //
    // La comparación de abajo NO se quita: contesta cuando el precio de verdad
    // no se puede resolver, y ahí decide igual que siempre.
    const porElQueCobra = laOpcionPorElPrecioQueCobra(
      nums,
      opciones?.phone,
      opciones?.conOferta === true
    );
    if (porElQueCobra) return porElQueCobra;
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
  // 2.b) POR LA POSICIÓN EN LA LISTA: «el 2», «el segundo».
  //
  // El bot enumera las dos opciones él mismo —«1. <una> … 2. <otra>»— y después
  // no sabía leer su propio número: aquí solo se entendía un número como
  // PRECIO. El cliente contestaba «el 2» y no se registraba nada; el turno caía
  // al modelo, que mandó la galería de imágenes en vez de cerrar la venta. Pasó
  // el 14 de septiembre de 2026 en dos conversaciones seguidas, y en las dos
  // costó el recorrido entero: sin elección anotada, el bot volvía a pedir el
  // método de pago que el cliente ya había elegido.
  //
  // VA DESPUÉS DEL PRECIO a propósito: si el número coincide con el importe de
  // una sola opción, eso es más específico y gana.
  //
  // SE PROBÓ EN -OB- Y SE LLEVÓ, que era el trato. Ver la puerta compartida en
  // `laLecturaFinaDeLaEleccionEstaActiva`: el «que» y el número van juntos
  // porque «creo que el 1» necesita a los dos.
  //
  // LINEAL NO SE ENTERA aunque la puerta se abriera: `opcionEnLaPosicion` exige
  // una oferta de dos opciones y sin ella devuelve vacío. Donde hay un solo
  // producto no hay posición que elegir.
  if (laLecturaFinaDeLaEleccionEstaActiva()) {
    const posicion =
      elOrdinalQueEligio(normalized) ?? elOrdinalTrasLaDuda(normalized);
    if (posicion) {
      const porPosicion = opcionEnLaPosicion(
        posicion,
        opciones?.ultimaDelBot,
        config
      );
      if (porPosicion) return porPosicion;
    }
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
  // UNA PALABRA CORRIENTE SOLO DECIDE SI CONTESTÓ CORTO.
  //
  // LO QUE PASÓ — 22 de septiembre de 2026, en el bot hermano y dos veces en el
  // mismo registro:
  //
  //     «E gusta todas esas cosas TODO emprendimiento es bueno»
  //         → el bot leyó «todo», dio por elegida la opción cara y le soltó los
  //           datos de pago. La clienta no había elegido nada.
  //
  //     «No Queria saber si tienen COMBO … o algo haci»
  //         → preguntaba SI TIENEN, y empezaba diciendo «no». Misma venta.
  //
  // POR QUÉ FALLA. Esta tercera señal —la lista de abajo— existe por una razón
  // buena: el bot acaba de preguntar «¿cuál?» y el cliente puede contestar «el
  // caro» sin decir el nombre. El problema es que buscaba esas palabras en
  // CUALQUIER sitio, sin mirar si el mensaje contestaba algo. «Todo» y «combo»
  // son de las más corrientes del español.
  //
  // NO SE TOCA LA LISTA, y a propósito: quitar «todo» taparía un caso y dejaría
  // vivos «grande», «alto» y «caro». Lo que se añade es la pregunta que faltaba
  // —¿esto es una respuesta?—, que es la regla estructural que pide el dueño.
  //
  // EL LÍMITE NO ES INVENTADO. Los cuadritos de este mismo bot ya lo usan, con
  // esta justificación escrita: «quien contesta un cuadrito contesta CORTO; una
  // palabra clave de UNA sola palabra solo decide en respuestas cortas». Se midió
  // con los mensajes REALES del dueño: sus elecciones tenían 2 y 3 palabras, y
  // los dos fallos 9 y 10. Seis —el número lo eligió él— deja sitio para «creo
  // que me llevo el completo» sin acercarse a una frase de conversación.
  //
  // Y EL NOMBRE DE SU PRODUCTO SE SALTA ESTO. Si el cliente dice una palabra que
  // solo tiene una de las dos opciones —la que las distingue en los nombres
  // configurados— eso decide en la frase que sea: nadie escribe el nombre de un
  // producto por casualidad. Sale de la configuración, así que al cambiar de
  // producto se rehace solo, y las palabras que comparten las dos no cuentan
  // porque no distinguen nada.
  const propiosDeLaOferta = tokensPropiosDeCadaOpcion(config);
  const nombraAlgoSuyo = propiosDeLaOferta
    ? words.some(
        (w) =>
          propiosDeLaOferta.comboSolo.has(w) ||
          propiosDeLaOferta.basicoSolo.has(w)
      )
    : false;
  const CONTESTA_CORTO = 6;
  if (!nombraAlgoSuyo && words.length > CONTESTA_CORTO) return null;
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
/** ¿La modalidad que está vendiendo AHORA es Order Bump?
 *
 *  Los arreglos de esta zona se prueban primero en **-OB-** por orden del dueño:
 *  se prueban ahí y, si funcionan, se llevan a las demás — no antes. Fuera de
 *  -OB- se conserva EXACTO el comportamiento anterior.
 *
 *  Respeta el simulador, porque `getActiveModalityKey` lo respeta.
 *
 *  Y CUENTA LA PRESENTACIÓN PRESTADA, que es el fallo del 25 de septiembre de
 *  2026. Ver `laLecturaFinaDeLaEleccionEstaActiva`, justo debajo: es el mismo
 *  tornillo y se aprietan juntos. Se delega en `isOrderBumpActive`, que es el
 *  único punto de verdad de «¿esto es un Order Bump?» y ya pregunta por el DATO
 *  —oferta de dos opciones sentada de verdad—, no por el nombre. */
export function laModalidadActivaEsOrderBump(): boolean {
  return isOrderBumpActive();
}

/**
 * DÓNDE MANDAN LAS REGLAS FINAS DE LECTURA DE LA ELECCIÓN.
 *
 * SON DOS, Y VAN JUNTAS PORQUE SE NECESITAN. Las dos leen lo mismo —lo que el
 * cliente acaba de decidir— y ninguna sirve sin la otra en la frase que las
 * destapó, «creo que el 1»:
 *
 *   · LA POSICIÓN DEL «QUE» (`elQueEsElDePreguntar`): un «que» cuenta como
 *     pregunta según DÓNDE cae, no por estar. Así «creo que el combo» decide y
 *     «que trae el combo» pregunta, aunque las dos lleven la palabra.
 *   · EL NÚMERO DE LA LISTA (`elOrdinalQueEligio`): el bot enumera «1. … 2. …»
 *     y el cliente contesta «el 1». Sin esto, el bot no sabe leer su propio
 *     número.
 *
 * Con una sola, «creo que el 1» sigue sin elegir: la primera lo salva de contar
 * como pregunta y la segunda lo convierte en una opción. Por eso comparten
 * puerta — si un día se separan, vuelve el fallo a medias.
 *
 * POR QUÉ NACIÓ EN -OB- Y SOLA. Se estrenó el 13 de septiembre de 2026 acotada
 * a Order Bump por orden del dueño: «se prueba ahí y, si funciona, se lleva».
 * Ese era el trato, no una diferencia real entre modalidades.
 *
 * Y SE LLEVÓ EL 15 DE SEPTIEMBRE, con su permiso y con la medida delante. En
 * -DOU-, ejecutando el detector real, «creo que el combo» seguía contando como
 * pregunta: la elección no se anotaba, el turno se lo quedaba el modelo y el
 * cliente tenía que decidir dos veces. En -OB- eso ya estaba resuelto desde
 * hacía dos días y aguantó el corpus ancho de la prueba —unas setenta frases
 * escritas como escribe la gente, sin tildes ni signos—.
 *
 * LO QUE CUESTA, MEDIDO Y DICHO: «si pero que viene en el curso» deja de
 * marcarse como pregunta. No cambia quién contesta —sigue yendo al modelo, que
 * no encuentra ninguna opción nombrada ahí—; lo único que cambia es que al
 * prompt de ese turno no se le adjunta el contenido del producto.
 *
 * Y EL NÚMERO SE LLEVÓ EL 16, por el mismo camino y con la misma medida. El
 * dueño escribió «creo que el 1» en -DOU-, no se registró, y al no quedar
 * elección anotada su «con yape» de dos mensajes después cayó por el camino de
 * «pago sin elegir». Medido con su contenido, antes de tocar nada:
 *
 *     order_bump             4 frases mal de 23
 *     doble_oferta_upsell   12 frases mal de 23
 *
 * LINEAL NO ENTRA, y no por prudencia: no tiene dos opciones. «el 1» no puede
 * elegir nada donde solo hay un producto, y `opcionEnLaPosicion` ya devuelve
 * vacío sin oferta de dos. Aquí no hay nada que proteger.
 *
 * LAS DEMÁS NO SE TOCAN. Doble Oferta 2 Productos, Bioferta y la modalidad
 * Upsell siguen EXACTAMENTE con el comportamiento de antes, hasta que él lo
 * pida. Es la misma escalera de siempre: una modalidad cada vez.
 */
export function laLecturaFinaDeLaEleccionEstaActiva(): boolean {
  const cfg = loadWorkflowConfig();
  if (!cfg) return false;
  // LA PRESENTACIÓN PRESTADA SE QUEDABA FUERA, Y ESO COSTÓ UNA VENTA ENTERA.
  //
  // LO QUE PASÓ — 25 de septiembre de 2026, su conversación 138, vendiendo en
  // lineal con la presentación prestada de -OB-. Con las dos opciones en
  // pantalla escribió:
  //
  //     «el que viene completo»
  //
  // y recibió «✅ Recibido. Revisa los siguientes mensajes», el mensaje de
  // cuando se agotan los intentos del modelo.
  //
  // LA CAUSA, medida con esta misma función y las mismas frases, cambiando solo
  // el interruptor: aquí se preguntaba por el NOMBRE de la modalidad, y con el
  // selector la modalidad sigue llamándose lineal. Apagado, el «que» vuelve a
  // la regla tosca —cualquier «que» en cualquier sitio es una pregunta— y el
  // motor se aparta de «el que viene completo», «el que trae todo», «creo que
  // el combo» o «mejor el básico por que no tengo plata».
  //
  // Y CIERRA LAS DOS PUERTAS A LA VEZ, que es lo que lo volvió un mensaje de
  // emergencia: la herramienta con la que el MODELO registra la elección
  // pregunta por esta misma lectura (ver `openrouter.ts`), así que le dijo que
  // no tres veces seguidas hasta agotar el techo de vueltas. No fue un fallo
  // del modelo: fue este tornillo visto desde el otro lado.
  //
  // Y «COMO -DOU-» TAMBIÉN, porque él mueve el selector cuando quiere.
  //
  // Se dejó fuera en el primer arreglo de ese día, con este razonamiento: esa
  // presentación toma la forma de Doble Oferta 2 Productos, que no tiene la
  // lectura fina, así que cada presentación se comporta como la modalidad cuya
  // forma toma prestada. El dueño lo corrigió en el acto, y tiene razón: «yo uso
  // como lineal, y cambio a como dou y cambio a como ob cuando yo desee, debe
  // estar preparado para el cambio sin romperse». Un selector que deja una de
  // las tres cojas no es un selector.
  //
  // POR QUÉ SE PUEDE HACER SIN MEDIR DE NUEVO LA MODALIDAD ENTERA. Esta lectura
  // solo puede AFLOJAR el veto, nunca apretarlo: `elQueEsElDePreguntar` dice «es
  // pregunta» en un subconjunto de los casos en que la regla tosca lo decía. Así
  // que ninguna frase que hoy decide puede pasar a ser pregunta. Lo fija
  // `prueba-el-que-de-relleno-no-es-una-pregunta` con su corpus de 71 frases, y
  // esa propiedad se comprueba ahora también para las dos presentaciones.
  //
  // LA DOBLE OFERTA 2 PRODUCTOS DE VERDAD SIGUE COMO ESTABA, y es a propósito:
  // él no la usa, y su corpus nunca se midió ahí. Es la escalera de siempre —
  // una modalidad cada vez— aplicada a lo que de verdad vende.
  const modo = getActiveModalityKey(cfg);
  return (
    isOrderBumpActive() ||
    vendeConPresentacionPrestada(cfg, "dos_juntas") ||
    modo === "order_bump" ||
    modo === "doble_oferta_upsell"
  );
}

/** Palabras que pueden ir DELANTE de un «que» sin quitarle el valor de pregunta:
 *  conectores, saludos, vocativos y verbos de pedir. Es una clase CERRADA del
 *  idioma —no una lista de sinónimos que crece con cada prueba—: hace de
 *  desempate DENTRO de la regla de posición de abajo, nunca de regla entera. */
const ANTESALA_QUE_NO_QUITA_LA_PREGUNTA = new Set([
  // «ya» NO está a propósito: «ya que» es causal casi siempre («ya que el combo
  // esta mejor, dame ese»), y la forma de preguntar con él —«ya que trae»— la
  // caza igual `isProductInformationQuestion` por el verbo.
  "y", "o", "pero", "entonces", "pues", "bueno", "ok", "oka", "okey", "okay",
  "ah", "ahh", "mmm", "este", "oye", "oiga", "hola", "buenas", "buenos",
  "dias", "tardes", "noches", "disculpa", "disculpe", "perdon", "perdona",
  "amiga", "amigo", "senora", "senor", "hey", "a", "ver", "una", "pregunta",
  "consulta", "dime", "digame", "dinos", "por", "para", "porfa", "favor",
]);

/** ¿El «que» de este mensaje es el de PREGUNTAR o el de RELLENO?
 *
 *  NO SE DECIDE POR LA TILDE, NI POR EL SIGNO, NI POR EL ESPACIO.
 *
 *  Aquí arriba se normaliza quitando tildes, así que «qué» (pregunta) y «que»
 *  (relleno) llegan como la MISMA palabra. Y el cliente no escribe ninguna de
 *  las tres señales. Dicho por el dueño el 2026-09-14: «las personas nunca
 *  ponen signos, ni comas; y con "por que" o "porque" no saben ni por qué lo
 *  mandan separado o junto».
 *
 *  LO QUE COSTÓ. El 13 de septiembre de 2026, dos pruebas de -OB- corridas a la
 *  vez. «el combo esta bien» registró la elección y cobró el precio del combo.
 *  «creo que el combo» NO la registró —ese ` que ` se leyó como pregunta— y eso
 *  cerró las DOS puertas capaces de registrarla: este detector y la herramienta
 *  `seleccionar_opcion` del modelo, que pregunta por esta misma función. El
 *  modelo respondió «¡Perfecta elección! El COMBO está a S/. 14» y pidió
 *  reenviar el pago; el motor, sin elección guardada, mandó los datos con el
 *  precio del BÁSICO y además lo congeló como «base». Dos precios en la misma
 *  ráfaga, los dos reales. La única diferencia entre las dos pruebas era esa
 *  palabra.
 *
 *  Y la misma asimetría vivía en «por que»: «mejor el basico por que no tengo
 *  plata» quedaba vetado, y «mejor el basico porque no tengo plata» pasaba. La
 *  venta dependía de la barra espaciadora.
 *
 *  LA REGLA ES DE POSICIÓN. El «que» de preguntar ABRE la frase; el de relleno
 *  va SIEMPRE detrás de contenido:
 *
 *      «que trae el combo»                → abre   → pregunta
 *      «y que incluye»                    → abre   → pregunta
 *      «creo que el combo»                → detrás → decisión
 *      «mejor el basico por que no tengo» → detrás → decisión
 *
 *  Así cae la familia entera de una vez —«pienso que», «supongo que», «me
 *  parece que», «así que», «ya que»— sin perseguir sinónimos uno a uno.
 *
 *  LO QUE NO SE TOCA. El «que» que ABRE sigue siendo pregunta, igual que hoy. Y
 *  «porque» junto se queda como está —hoy no cuenta como pregunta en ninguna
 *  posición— porque volverlo pregunta rompería «porque no tengo plata mejor el
 *  basico», que hoy funciona bien. */
function elQueEsElDePreguntar(normalized: string): boolean {
  const palabras = normalized.split(" ").filter(Boolean);
  const i = palabras.findIndex((p) => p === "que" || p === "qu3" || p === "ke");
  if (i < 0) return false;
  // «QUE SEA EL COMBO» ES UNA DECISIÓN, AUNQUE ABRA LA FRASE.
  //
  // El subjuntivo de encargo —«que sea», «que quede»— no pregunta nada: elige.
  // Y se dice mucho detrás de un conector: «ok que sea el combo», «entonces que
  // sea el basico», «bueno que quede en el combo». Sin esta salida, el conector
  // dejaba el «que» en pie y la elección se perdía igual que con «creo que».
  // Es un grupo CERRADO de formas verbales, no una lista de sinónimos.
  // Vive en `SUBJUNTIVO_DE_ENCARGO` para que la regla del NÚMERO use el mismo
  // grupo: «ok entonces que sea el 1» tiene que elegir igual que «que sea el
  // combo». Dos copias del mismo grupo acaban separándose.
  if (SUBJUNTIVO_DE_ENCARGO.has(palabras[i + 1] ?? "")) return false;
  return palabras
    .slice(0, i)
    .every((p) => ANTESALA_QUE_NO_QUITA_LA_PREGUNTA.has(p));
}

export function isOrderBumpConversationQuestion(msg: string): boolean {
  const normalized = msg
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  // QUERER SABER NO ES QUERER COMPRAR.
  //
  // LO QUE PASÓ — 15 de septiembre de 2026, en -DOU-, dos pantallas en paralelo
  // con las dos opciones en pantalla. El cliente escribió:
  //
  //     «si pero quiero saber que contiene el combo y el otro»
  //     «si pero quiero saber que trae el combo y el otro»
  //
  // y el bot registró que había elegido la opción cara y le mandó sus datos de
  // pago. Está preguntando por LAS DOS y pidiendo que le cuenten qué traen: es
  // lo contrario de una decisión.
  //
  // EL ESCALÓN EXACTO. La frase lleva «quiero», y aquí un «quiero» suelto
  // significaba compra y cortaba el análisis en seco. Nunca se llegaba a mirar
  // el resto, que ya lo tenía resuelto: `isProductInformationQuestion` reconoce
  // «que contiene» Y reconoce «el otro» —las dos señales, por separado—. El
  // detector no fallaba; no le dejábamos llegar.
  //
  // LA REGLA, Y ES DE ESTRUCTURA, NO DE VOCABULARIO. «Querer» pide un objeto, y
  // ese objeto es lo que decide la frase: si es un PRODUCTO, elige; si es un
  // INFINITIVO DE INFORMARSE, pregunta. «Quiero el combo» elige. «Quiero saber»,
  // «quiero ver», «quiero comparar» preguntan — sea cual sea el producto y lo
  // escriba como lo escriba.
  //
  // POR QUÉ LA LISTA ES DE INFINITIVOS Y NO «CUALQUIER VERBO». Se probó la regla
  // ancha —«quiero» + cualquier palabra terminada en -ar/-er/-ir— y se
  // descartó: esto es una plantilla y los productos los nombra el dueño. Un
  // producto cuyo nombre termine en -ar o en -er parecería un infinitivo, y
  // «quiero <ese producto>» dejaría de comprar — que es la frase que más veces
  // se escribe en toda la venta. La forma de informarse, en cambio, es un
  // puñado de verbos que ningún producto va a llevar de nombre.
  //
  // Y SI ALGUNO SE ESCAPA, NO SE PIERDE LA VENTA: cae al modelo, que lee la
  // conversación entera y tiene su marcador para registrar la elección. Este
  // cambio solo puede mover un turno de «decido yo» a «que conteste él»; nunca
  // al revés. Lo caro era lo otro: cobrar la opción que el cliente no eligió.
  const VERBOS_DE_INFORMARSE =
    "saber|conocer|ver|entender|comprender|averiguar|preguntar|consultar|comparar|revisar|mirar|chequear|verificar|corroborar|enterarme|informarme|aclarar|asegurarme";
  const VERBOS_DE_QUERER =
    "quiero|elijo|escojo|prefiero|me quedo|llevare|llevo|decidi|dame|comprar|compro";
  // El clítico pegado —«quiero saberlo», «quiero verlas»— es la misma frase.
  const quiereInformarse = new RegExp(
    `\\b(${VERBOS_DE_QUERER})\\s+(${VERBOS_DE_INFORMARSE})(lo|la|los|las|me|te|se|nos)?\\b`
  ).test(normalized);
  // La intención EXPLÍCITA de compra gana SIEMPRE → no es pregunta (aunque use
  // verbos como "trae": "quiero el que trae todo" es una elección).
  const explicitDecision =
    !quiereInformarse &&
    new RegExp(`\\b(${VERBOS_DE_QUERER})\\b`).test(normalized);
  if (explicitDecision) return false;
  if (isProductInformationQuestion(msg)) return true;

  // PREGUNTA POR GRAMÁTICA, NO POR FRASES HECHAS.
  //
  // Antes esto era una lista de frases exactas: reconocía "de que trata" pero
  // no "de que SE trata", y por esa palabra una pregunta se tomó como una
  // compra. Perseguir todas las formas de preguntar es imposible — siempre
  // aparece una nueva.
  //
  // Ahora se mira lo que sí es cerrado: los signos y las palabras
  // interrogativas del español. Si el mensaje pregunta, NO se decide aquí:
  // pasa a la IA, que lo lee con toda la conversación delante y tiene su
  // herramienta para registrar la elección si de verdad la hubo.
  //
  // La compra directa —"quiero el combo", "el combo 2 en 1", tocar el botón—
  // ni llega hasta aquí: la corta `explicitDecision` o el nombre exacto.
  const traeSignoDePregunta = /[?¿]/.test(msg);
  // Los interrogativos que NO tienen gemelo de relleno deciden solos, como
  // siempre: nadie escribe «cual» o «cuanto» de adorno.
  const otrosInterrogativos =
    /\b(cual|cuales|como|cuanto|cuanta|cuantos|cuantas|cuando|donde|quien|quienes|para que|acaso)\b/.test(
      normalized
    );
  // EL «QUE» SE MIRA POR POSICIÓN, EN -OB- Y AHORA TAMBIÉN EN -DOU-.
  //
  // Este detector lo comparten Order Bump y las Dobles Ofertas
  // (`getActiveTwoTierOffer` sirve a todas). El arreglo se estrenó SOLO en -OB-
  // el 13 de septiembre de 2026, por orden del dueño: «se prueba ahí y, si
  // funciona, se lleva». Aguantó dos días y el corpus ancho de su prueba, y el
  // 15 lo llevó a -DOU- — con estas palabras: «dale».
  //
  // Dónde manda exactamente, y qué cuesta llevarlo, está en
  // `laReglaDelQueEstaActiva`. Las demás modalidades siguen con la rama de
  // abajo, que es, palabra por palabra, la de siempre («por que» ya lo cazaba
  // «que» a secas).
  const elQueCuentaComoPregunta = laLecturaFinaDeLaEleccionEstaActiva()
    ? elQueEsElDePreguntar(normalized)
    : /\b(que|qu3|ke)\b/.test(normalized);
  const traeInterrogativo = otrosInterrogativos || elQueCuentaComoPregunta;
  // Verbos con los que se pide explicación aunque no haya interrogativo:
  // "me explicas el combo", "cuentame del basico", "no entiendo el 2 en 1".
  const pideExplicacion =
    /\b(trata|consiste|sirve|funciona|explicame|explica|explicas|cuentame|cuenta|detalles|dudas|duda|entiendo|entender|sabes)\b/.test(
      normalized
    );
  if (traeSignoDePregunta || traeInterrogativo || pideExplicacion) return true;

  return (
    /\b(misma cuenta|mismo metodo|igual metodo|donde pago|como pago|como se paga)\b/.test(
      normalized
    ) ||
    /\b(recomendacion|recomiendas|recomienda)\b/.test(normalized) ||
    /\b(puedo pagar|se puede pagar)\b/.test(normalized)
  );
}

/** ¿Mostrar el menú de métodos de pago con botones de WhatsApp? */
export function isPaymentMethodButtonsActive(): boolean {
  return !!loadWorkflowConfig()?.payment_method_buttons;
}

/** Texto del menú de métodos cuando NO hay ninguno configurado.
 *
 * Antes aquí venían YAPE / PLIN / BCP escritos a mano. Eso convertía cualquier
 * instalación recién hecha en un bot peruano: sin tocar nada, le ofrecía a sus
 * clientes tres billeteras de un país que puede no ser el suyo. En una
 * plantilla que se instala para otros negocios eso es una fuga, no un atajo.
 *
 * El motor no conoce ninguna marca de pago: las pone el operador en el editor.
 * Si no puso ninguna, se avisa igual que con el receptor sin configurar — es
 * un error de configuración visible, no un silencio ni una marca inventada. */
export const DEFAULT_PAYMENT_TEXT = "[Métodos de pago sin configurar]";

/** Texto del menú de métodos (cara de texto). El configurado o el por defecto. */
export function getPaymentText(phone?: string | null): string {
  const config = loadWorkflowConfig();
  const country = getEffectiveCountryCode(phone, config);
  const escrito =
    resolveCountryPaymentProfile(country, config)?.payment_text?.trim() ||
    config?.payment_text?.trim();
  // EL TEXTO DE MUESTRA NO VIAJA, NI AL MODELO NI AL CLIENTE.
  //
  // LO QUE PASÓ — 24 de septiembre de 2026, vendiendo en Argentina. El dueño
  // tenía UN método encendido (transferencia) y el bot ofreció tres:
  //
  //     - Transferencia bancaria
  //     - Mercado Pago
  //     - Ualá
  //
  // No se los inventó el modelo: se los dijo este texto. Al encender un país se
  // le siembra una muestra —«[Referencia Argentina] Puedes pagar por
  // transferencia bancaria, Mercado Pago o Uala. Cambia este texto por tus
  // datos reales»— y esa muestra es la que se le entrega al modelo COMO LA
  // LISTA OFICIAL de métodos. Mientras nadie la reescriba, el bot ofrece lo que
  // diga la muestra y no lo que hay configurado. El cliente eligió Ualá y
  // recibió el «[Referencia Argentina]» tal cual.
  //
  // Apagar métodos no lo curaba, y él lo intentó: los nombres no viven en los
  // métodos, viven en esta frase. Su lista ya tenía uno solo.
  //
  // Así que la muestra se descarta y se arma la lista con los métodos
  // ENCENDIDOS de ese país. El aviso del panel —`revisarPais`— ya señalaba este
  // texto; lo que faltaba era que el motor le hiciera caso.
  //
  // Y SOLO LA MUESTRA. Un texto escrito por el dueño se manda intacto aunque
  // nombre tres métodos: eso es su decisión, no un descuido.
  if (escrito && esTextoDeReferencia(escrito)) {
    return getPaymentMethodsList(phone) || DEFAULT_PAYMENT_TEXT;
  }
  return escrito || DEFAULT_PAYMENT_TEXT;
}

/** Botones del menú de pago: los configurados (1-3) o, si no hay, los de
 *  defecto (Yape/Plin/BCP). `method` es la palabra clave que el bot enruta. */
/** Nombre visible del receptor configurado para el país del cliente.
 * Reutiliza exactamente el mismo dato que valida Yape/Plin, para que los
 * textos comerciales nunca apunten a un receptor distinto al comprobante. */
/**
 * QUIÉN COBRA EN ESTE TURNO, Y CON QUÉ DATOS — LA PUERTA ÚNICA.
 *
 * Devuelve los tres datos del cobro juntos a propósito. Son tres campos que TIENEN
 * que salir del mismo sitio:
 *
 *   · `titular`          es el que APRUEBA el comprobante
 *   · `nombre_completo`  es el que se NOMBRA en el mensaje
 *   · `numero_de_cuenta` es a dónde se le manda a pagar
 *
 * Si se leyeran por separado, el día que uno venga de la tienda y otro del país el
 * bot le diría al cliente un nombre y esperaría otro: el cliente paga bien y el bot
 * le rechaza el comprobante. Por eso hay UNA puerta y no tres.
 *
 * ── EL ORDEN ─────────────────────────────────────────────────────────────
 *
 *   1. EL COBRADOR DE LA TIENDA que atiende, si tiene datos de ESTE país.
 *   2. EL PERFIL DEL PAÍS, que es lo de siempre.
 *
 * Campo por campo, no en bloque: un cobrador que solo escribió su número hereda el
 * titular del país en vez de quedarse sin titular y aprobar a cualquiera.
 *
 * ── UN COBRADOR SIN ESTE PAÍS NO DEJA AL CLIENTE SIN CUENTA ──────────────
 *
 * Cae al del país. Se decidió así con el dueño el 30/09/2026, sabiendo lo que
 * cuesta: el dinero de ese cliente le entra a ÉL y no a la otra persona. La
 * alternativa era no mandar número, y una venta rota es peor que un cobro mal
 * repartido. La pantalla del cobrador lo avisa, para que se vea antes y no después.
 *
 * ── LA GARANTÍA ──────────────────────────────────────────────────────────
 *
 * SIN TIENDA ATENDIENDO, O SIN COBRADOR ELEGIDO, devuelve exactamente lo que
 * devolvía cada lectura por su cuenta: el perfil del país, con el respaldo global
 * del titular y sin respaldo global para el número —que era y sigue siendo
 * deliberado, porque una cuenta es de un país concreto—.
 */
export function elCobroDelPais(
  country: CountryCode,
  config?: WorkflowConfig | null,
  /** EL MÉTODO QUE ELIGIÓ EL CLIENTE, para dar la cuenta de ESE método.
   *
   *  Sin él se devuelve la cuenta suelta, que es el camino de siempre. Sale de
   *  `selected_payment_method`, que la conversación ya guardaba: por eso esto no
   *  cambió la firma de nadie más arriba en la cadena. */
  metodo?: string | null
): { titular: string; nombre_completo: string; numero_de_cuenta: string } {
  const cfg = config ?? loadWorkflowConfig();
  const perfil = resolveCountryPaymentProfile(country, cfg);
  // EL COBRADOR DE LA TIENDA QUE ATIENDE. Se resuelve por el mismo almacén que
  // todo lo demás: la tienda del turno ya está puesta desde que entró el mensaje.
  const idDelCobrador = String(laTiendaDelTurno()?.cobrador ?? "").trim();
  const suyo = idDelCobrador
    ? (cfg?.cobradores ?? []).find(
        (c) => String(c?.id ?? "").trim() === idDelCobrador
      )
    : null;
  const delCobrador = suyo?.por_pais?.[country];
  const limpio = (v: unknown): string => String(v ?? "").trim();

  // DE QUIÉN ES EL TITULAR, porque de eso depende el nombre que se le enseña.
  const titularDelCobrador = limpio(delCobrador?.titular);
  const titular =
    titularDelCobrador ||
    limpio(perfil?.payment_validation?.yape_recipient_name_starts_with) ||
    limpio(cfg?.payment_validation?.yape_recipient_name_starts_with);
  return {
    titular,
    // EL NOMBRE QUE SE LE ENSEÑA NO PUEDE SER DE OTRA PERSONA QUE EL QUE VALIDA.
    //
    // EL FALLO QUE HUBO AQUÍ, y lo destapó el dueño el 01/10/2026 al crear dos
    // usuarios de prueba y preguntar para qué servía este campo: los dos lo
    // dejaron vacío, así que esto caía al `nombre_completo` DEL PAÍS —el del
    // dueño— mientras el titular que validaba era el del usuario. O sea el bot
    // iba a decir «a nombre de <el dueño>» y a esperar un comprobante a nombre
    // de <el usuario>: pago bueno, comprobante rechazado. Justo lo que esta
    // puerta única existe para impedir, entrando por el respaldo.
    //
    // No le mordió porque {{NOMBRE_COMPLETO}} no está escrito en ninguna de sus
    // burbujas —medido: 0 usos, contra 233 de {{NOMBRE_RECEPTOR}}—. Pero el día
    // que lo usara, con un usuario puesto, cobraba mal.
    //
    // AHORA EL RESPALDO NO CRUZA DE PERSONA: si el titular salió del usuario, el
    // nombre para leer es el suyo o su propio titular, nunca el del país.
    nombre_completo: titularDelCobrador
      ? limpio(delCobrador?.nombre_completo) || titularDelCobrador
      : limpio(delCobrador?.nombre_completo) ||
        limpio(perfil?.nombre_completo) ||
        titular,
    // SIN RESPALDO GLOBAL, a propósito y como siempre: una cuenta es de un país
    // concreto, y un respaldo global serviría el número de otro país.
    //
    // EL ORDEN, de lo más concreto a lo más general:
    //   1. la cuenta del cobrador PARA ESE MÉTODO
    //   2. su cuenta suelta
    //   3. la del país PARA ESE MÉTODO
    //   4. la cuenta suelta del país  <- el camino de siempre
    //
    // Así quien tenga una sola cuenta no nota nada, y quien tenga una por método
    // deja de escribirlas a mano dentro de las burbujas.
    //
    // Y UN MÉTODO APAGADO PARA ESTA PERSONA NO HEREDA LA CUENTA DEL DUEÑO.
    //
    // Normalmente no llega aquí: apagado, el método ni se le ofrece al cliente.
    // Esto es el cinturón por si algún camino lo eligiera igual —el cliente que
    // escribe el nombre del método, un texto viejo que lo nombra—. Devuelve lo
    // que tenga esa persona, y si no tiene nada, VACÍO.
    //
    // Vacío se ve: sale «[Número de cuenta sin configurar]» y se arregla. La
    // cuenta del dueño NO se ve: el cliente paga bien, el comprobante sale a
    // nombre de otro, el bot lo rechaza, y el dinero entró donde no debía.
    numero_de_cuenta: elMetodoEstaApagadoParaElCobro(country, cfg, metodo)
      ? laCuentaDelMetodo(delCobrador, metodo) ||
        limpio(delCobrador?.numero_de_cuenta)
      : laCuentaDelMetodo(delCobrador, metodo) ||
        limpio(delCobrador?.numero_de_cuenta) ||
        laCuentaDelMetodo(perfil, metodo) ||
        limpio(perfil?.numero_de_cuenta),
  };
}

/**
 * LOS MÉTODOS QUE EL USUARIO QUE COBRA EN ESTE TURNO NO ATIENDE.
 *
 * Sin usuario puesto devuelve lista vacía, así que el bot ofrece lo de siempre.
 * Ver `metodos_apagados` en `Cobrador` para el fallo que esto evita.
 */
export function metodosApagadosDelCobro(
  country: CountryCode,
  config?: WorkflowConfig | null
): string[] {
  const cfg = config ?? loadWorkflowConfig();
  const idDelCobrador = String(laTiendaDelTurno()?.cobrador ?? "").trim();
  if (!idDelCobrador) return [];
  const suyo = (cfg?.cobradores ?? []).find(
    (c) => String(c?.id ?? "").trim() === idDelCobrador
  );
  return (suyo?.por_pais?.[country]?.metodos_apagados ?? [])
    .map((m) => String(m ?? "").trim().toLowerCase())
    .filter(Boolean);
}

/** ¿Este método está apagado para quien cobra en este turno? */
function elMetodoEstaApagadoParaElCobro(
  country: CountryCode,
  config: WorkflowConfig | null | undefined,
  metodo?: string | null
): boolean {
  const suyo = String(metodo ?? "").trim().toLowerCase();
  if (!suyo) return false;
  return metodosApagadosDelCobro(country, config).includes(suyo);
}

/** La cuenta escrita para ESE método, si la hay. Se compara en minúsculas y sin
 *  espacios de sobra: la clave la escribe él en sus botones y el motor la guarda
 *  como venga, así que «Yape» y «yape» tienen que ser lo mismo. */
function laCuentaDelMetodo(
  donde: { cuentas_por_metodo?: Record<string, string> } | null | undefined,
  metodo?: string | null
): string {
  const suyo = String(metodo ?? "").trim().toLowerCase();
  if (!suyo) return "";
  const tabla = donde?.cuentas_por_metodo;
  if (!tabla) return "";
  for (const [clave, valor] of Object.entries(tabla)) {
    if (String(clave ?? "").trim().toLowerCase() === suyo) {
      return String(valor ?? "").trim();
    }
  }
  return "";
}

export function getPaymentRecipientName(phone?: string | null): string {
  const config = loadWorkflowConfig();
  const country = getEffectiveCountryCode(phone, config);
  return elCobroDelPais(country, config).titular;
}

/** Número de cuenta configurado para el país del cliente → {{NUMERO_DE_CUENTA}}.
 *
 *  Vive en el perfil del país, como los cuatro cajones de pago y no como el
 *  nombre del receptor: una cuenta es de un país concreto, y un respaldo global
 *  serviría el número de otro país al cliente equivocado.
 *
 *  Vacío devuelve cadena vacía: el comodín no imprime nada y se ve el hueco,
 *  que es preferible a inventar un número de cuenta. */
/**
 * TU NOMBRE COMPLETO → {{NOMBRE_COMPLETO}}. Solo para leer.
 *
 * SEPARADO DEL RECEPTOR A PROPÓSITO. El del receptor valida el comprobante:
 * escribir ahí el nombre completo hacía que dejara de coincidir con el nombre
 * más corto que trae la constancia, y el bot rechazaba pagos buenos.
 *
 * VACÍO CAE EN EL DEL RECEPTOR. Quien no lo llene ve exactamente lo de siempre,
 * y ningún texto que ya use este comodín se queda en blanco de golpe.
 */
export function getNombreCompleto(phone?: string | null): string {
  const config = loadWorkflowConfig();
  const country = getEffectiveCountryCode(phone, config);
  return elCobroDelPais(country, config).nombre_completo;
}

/** El número de cuenta para {{NUMERO_DE_CUENTA}}.
 *
 *  `metodo` es el que eligió el cliente: con él se devuelve la cuenta DE ESE
 *  método, y sin él la cuenta suelta, que es el comportamiento de siempre. */
export function getNumeroDeCuenta(
  phone?: string | null,
  metodo?: string | null
): string {
  const config = loadWorkflowConfig();
  const country = getEffectiveCountryCode(phone, config);
  return elCobroDelPais(country, config, metodo).numero_de_cuenta;
}

export function getPaymentButtons(
  phone?: string | null
): { label: string; method: string }[] {
  const config = loadWorkflowConfig();
  const country = getEffectiveCountryCode(phone, config);
  const cfg =
    resolveCountryPaymentProfile(country, config)?.payment_buttons ??
    config?.payment_buttons;
  // `enabled: false` APAGA el metodo sin borrarlo: ni sale como boton ni se
  // reconoce si el cliente lo escribe. Ausente o true = encendido, para que
  // las configuraciones anteriores sigan igual.
  const bienFormados = (cfg ?? []).filter(
    (b) => b && typeof b.label === "string" && b.label.trim() && b.method
  );
  // Y LOS QUE EL USUARIO QUE COBRA AQUÍ NO ATIENDE, TAMPOCO SE OFRECEN.
  //
  // Es el mismo trato que `enabled: false`, pero por persona en vez de por país.
  // Ofrecer un método que esa persona no tiene acaba en que el cliente pague a
  // la cuenta del dueño y el bot le rechace el comprobante. Ver
  // `metodos_apagados` en `Cobrador`. Sin usuario puesto no descarta nada.
  const apagadosDelCobro = metodosApagadosDelCobro(country, config);
  const valid = bienFormados.filter(
    (b) =>
      b.enabled !== false &&
      !apagadosDelCobro.includes(String(b.method ?? "").trim().toLowerCase())
  );
  if (valid.length > 0) return valid.slice(0, 3);
  // Si hay metodos configurados pero TODOS estan apagados, se devuelve la lista
  // vacia. Caer al trio por defecto seria peor: el bot ofreceria Yape/Plin/BCP
  // justo despues de que el operador los apagara a proposito.
  //
  // Y sin NINGUNO configurado, tampoco. Ese trio por defecto le ponia a toda
  // instalacion nueva las billeteras de un pais concreto; en una plantilla que
  // se instala para otros negocios, el motor no debe conocer ninguna marca.
  // Quien llama a esta funcion ya sabe caer al menu de texto cuando la lista
  // viene vacia, asi que el cliente nunca se queda sin saber como pagar.
  return [];
}

/** MÉTODOS DE PAGO (bot universal): la lista COMPLETA con sus aliases, en ORDEN,
 *  para la detección y el menú. Cantidad libre. Devuelve la lista CRUDA del
 *  config: si está vacía, la detección cae al reconocimiento clásico
 *  (yape/plin/bcp/efectivo hardcodeado) → Mundial no se ve afectado. */
export function getPaymentMethods(phone?: string | null): {
  label: string;
  method: string;
  aliases: string[];
  principal: boolean;
}[] {
  const config = loadWorkflowConfig();
  const country = getEffectiveCountryCode(phone, config);
  const cfg =
    resolveCountryPaymentProfile(country, config)?.payment_buttons ??
    config?.payment_buttons;
  // Los que el usuario que cobra aquí no atiende salen de la lista entera: no se
  // ofrecen Y no se reconocen si el cliente los escribe. Ver `metodos_apagados`.
  const apagadosDelCobro = metodosApagadosDelCobro(country, config);
  return (cfg ?? [])
    .filter(
      (b) =>
        b &&
        typeof b.label === "string" &&
        b.label.trim() &&
        b.method &&
        // Apagado: tampoco se reconoce si el cliente escribe su nombre, para
        // que el bot no mande los datos de un metodo que ya no ofreces.
        b.enabled !== false &&
        !apagadosDelCobro.includes(String(b.method ?? "").trim().toLowerCase())
    )
    .map((b) => ({
      label: b.label.trim(),
      method: b.method,
      aliases: (b.aliases ?? []).filter(
        (a): a is string => typeof a === "string" && a.trim().length > 0
      ),
      principal: b.principal === true,
    }));
}

/** Lista corta de metodos para insertar dentro de cierres ya redactados.
 * Conserva el orden del pais y no reutiliza el texto completo del menu. */
export function getPaymentMethodsList(phone?: string | null): string {
  // SIN MÉTODOS NO SE NOMBRA NINGUNO.
  //
  // Aquí venían «Yape, Plin, BCP» como respaldo, y eso convertía a un país sin
  // configurar en un bot peruano: en Argentina le ofrecía tres billeteras que
  // no existen ahí. Es el mismo respaldo que ya se quitó de
  // `DEFAULT_PAYMENT_TEXT` por este motivo, y que aquí se había quedado.
  //
  // Lo pidió el dueño el 24/09/2026 con estas palabras: «que no nombre ninguno
  // que no exista». Vacío es la respuesta correcta: el bot pide los datos sin
  // listar marcas, y el panel ya avisa de que al país le faltan métodos.
  return getPaymentMethods(phone)
    .map((method) => `• *${method.label}*`)
    .join("\n");
}

/**
 * Texto de métodos PARA INYECTAR EN EL PROMPT. Igual que `getPaymentText`, pero
 * con los comodines y el spintax ya resueltos.
 *
 * Sin esto la IA recibía literalmente `{{LISTA_METODOS_POR_PAIS}}` como "lista
 * oficial de métodos": al no ver ningún método, se los inventaba (llegó a
 * ofrecer Interbank y un CCI que no existen en la configuración).
 *
 * El envío real del mensaje NO pasa por aquí — ese lo resuelve el sender con
 * los mismos comodines. Esta función solo alimenta el prompt.
 */
export function getPaymentTextForPrompt(phone?: string | null): string {
  const lista = getPaymentMethodsList(phone);
  const texto = getPaymentText(phone)
    .replace(
      /\{\{\s*(metodos_de_pago_por_pais|metodos_pago_pais|payment_methods_by_country)\s*\}\}/gi,
      literal(lista)
    )
    .replace(
      /\{\{\s*(lista_metodos_por_pais|lista_metodos_pago_por_pais|payment_methods_list_by_country)\s*\}\}/gi,
      literal(lista)
    );
  return resolveSpintax(texto);
}

/**
 * Marcas de pago que el bot NO debe OFRECER si no están configuradas. Es una
 * lista cerrada a propósito: solo bancos y billeteras conocidos de los países
 * donde se vende. Todo lo demás se ignora, para no marcar frases normales.
 */
const MARCAS_DE_PAGO = [
  "yape",
  "plin",
  "tunki",
  "lukita",
  "bim",
  "bcp",
  "interbank",
  "interbancaria",
  "bbva",
  "scotiabank",
  "banbif",
  "pichincha",
  "produbanco",
  "guayaquil",
  "bolivariano",
  "diners",
  "cci",
  "paypal",
  "payoneer",
  "izipay",
  "niubiz",
  "culqi",
  "binance",
  "zelle",
];

function normalizaMarca(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "");
}

/**
 * Marcas de pago nombradas en `texto` que NO están configuradas para el país de
 * este cliente. Sirve para que el bot no ofrezca un banco que no existe en la
 * configuración (p. ej. anunciar INTERBANK o un CCI cuando solo hay Yape y BCP).
 *
 * Los métodos APAGADOS cuentan como no configurados: `getPaymentMethods` ya
 * los excluye, que es justo lo que se quiere al apagar uno.
 */
export function marcasDePagoNoConfiguradas(
  texto: string,
  phone?: string | null
): string[] {
  if (!texto.trim()) return [];
  const permitidas = new Set<string>();
  for (const metodo of getPaymentMethods(phone)) {
    permitidas.add(normalizaMarca(metodo.method));
    // La etiqueta puede traer emojis o varias palabras ("BCP (transferencia)"):
    // cada palabra cuenta como permitida para no marcar lo que el usuario puso.
    for (const parte of normalizaMarca(metodo.label).split(/[^a-z0-9]+/)) {
      if (parte) permitidas.add(parte);
    }
    for (const alias of metodo.aliases) permitidas.add(normalizaMarca(alias));
  }
  const normalizado = normalizaMarca(texto);
  const marcado = new Set<string>();
  for (const marca of MARCAS_DE_PAGO) {
    if (permitidas.has(marca)) continue;
    if (new RegExp(`\\b${marca}\\b`).test(normalizado)) marcado.add(marca);
  }
  // Y LOS MÉTODOS QUE ÉL RETIRÓ, QUE NO ESTÁN EN NINGUNA LISTA DE ESTA CASA.
  //
  // LO QUE PASÓ — 24/09/2026, Argentina. El modelo ofreció «Mercado Pago» y
  // «Ualá» y este guardarraíl no dijo nada: su catálogo es de Perú y Ecuador
  // —yape, plin, bcp, interbank…— y no conoce ninguna marca argentina. Fuera de
  // Perú el freno estaba apagado sin que nada lo avisara.
  //
  // La cura NO es escribir más marcas aquí: eso es lo que prohíbe la regla de
  // no meter marcas de pago en el código, y con once países la lista no
  // terminaría nunca. Los nombres ya están en SU configuración: un método que
  // tuvo y ya no ofrece deja su cajón de datos escrito, con su clave. Eso es un
  // dato, cambia solo con su panel, y vale para cualquier país sin tocar código.
  //
  // Un método APAGADO cuenta igual que uno retirado: `getPaymentMethods` ya lo
  // excluye, que es justo lo que se quiere al apagarlo.
  for (const retirado of metodosRetirados(phone)) {
    if (permitidas.has(retirado)) continue;
    if (new RegExp(`\\b${retirado}\\b`).test(normalizado)) marcado.add(retirado);
  }
  return [...marcado];
}

/**
 * LOS MÉTODOS QUE ESTE PAÍS TUVO Y YA NO OFRECE.
 *
 * Salen de sus propios datos: las claves de los cajones de pago escritos que no
 * están en la lista de métodos encendidos, más las etiquetas y alias de los
 * métodos apagados. Nada de esto se escribe en el código.
 *
 * Se piden al menos cuatro letras: una clave corta como «ob» dentro de un texto
 * normal marcaría cualquier frase, y el freno tiene que poder confiarse.
 */
function metodosRetirados(phone?: string | null): string[] {
  const config = loadWorkflowConfig();
  const country = getEffectiveCountryCode(phone, config);
  const perfil = resolveCountryPaymentProfile(country, config);
  const encendidos = new Set(
    getPaymentMethods(phone).map((metodo) => normalizaMarca(metodo.method))
  );
  const nombres = new Set<string>();
  const anotar = (crudo: string | undefined) => {
    const nombre = normalizaMarca(crudo ?? "").replace(/[_-]+/g, " ").trim();
    if (nombre.length >= 4) nombres.add(nombre);
  };
  for (const clave of Object.keys(perfil?.payment_responses ?? {})) {
    if (encendidos.has(normalizaMarca(clave))) continue;
    anotar(clave);
  }
  for (const boton of perfil?.payment_buttons ?? []) {
    if (boton?.enabled !== false) continue;
    anotar(boton?.method);
    anotar(boton?.label);
    for (const alias of boton?.aliases ?? []) anotar(alias);
  }
  return [...nombres];
}

/**
 * ¿ESTE TEXTO ESTÁ DANDO DATOS DE PAGO?
 *
 * Dos formas, y solo dos: una CUENTA —una tirada larga de dígitos— o un
 * TITULAR («a nombre de X»). Son las que no aparecen hablando de otra cosa.
 *
 * SIN LA BANDERA /g A PROPÓSITO. Un regex global recuerda dónde se quedó entre
 * llamadas, y con `.test()` dentro de un bucle empieza a decir que no a lo que
 * sí. Se descubrió midiendo: el titular inventado se escapaba a partir de la
 * segunda burbuja revisada.
 */
const FORMA_DE_CUENTA = /(?:\d[\s.-]?){6,}/;
const FORMA_DE_TITULAR =
  /\b(?:a\s+nombre\s+de|titular(?:\s+de\s+la\s+cuenta)?)\b\s*:?\s*\*?[^\n*,.;(]{3,60}/i;
export function pareceDatosDePago(texto: string): boolean {
  if (!texto?.trim()) return false;
  return FORMA_DE_CUENTA.test(texto) || FORMA_DE_TITULAR.test(texto);
}

/**
 * LOS IMPORTES QUE EL OPERADOR CONFIGURÓ PARA ESTE CLIENTE.
 *
 * Solo los de SU país: un precio de otro país no puede legitimar una cifra rara
 * en esta conversación. Entran los de las dos opciones, el del producto base,
 * el del segundo producto y los tachados («precio anterior»), con y sin etapa
 * de descuento — todos son cifras que el bot dice a propósito.
 */
function importesConfigurados(phone?: string | null): Set<number> {
  const suyos = new Set<number>();
  const apunta = (v: unknown): void => {
    if (typeof v === "number" && Number.isFinite(v) && v > 0)
      suyos.add(Math.trunc(v));
  };
  for (const conDescuento of [false, true]) {
    apunta(getEffectivePriceSoles(conDescuento, phone ?? null));
    for (const lado of ["combo", "basico"] as const)
      apunta(getOrderBumpPriceSoles(lado, conDescuento, phone ?? null));
    apunta(getUpsellPriceSoles(conDescuento, phone ?? null));
  }
  // LOS TACHADOS TAMBIÉN SON SUYOS. Lo destapó la medición en el otro bot: sin
  // ellos, siete burbujas buenas —«Precio anterior: ~$15.000~»— salían marcadas.
  const config = loadWorkflowConfig();
  const perfil = config
    ? resolveCountryPaymentProfile(getEffectiveCountryCode(phone, config), config)
    : undefined;
  apunta(perfil?.market_price);
  apunta(perfil?.order_bump?.combo_market_price);
  return suyos;
}

/**
 * IMPORTES QUE EL BOT ESCRIBIÓ Y EL OPERADOR NUNCA PUSO.
 *
 * LO QUE PASÓ — 22 de septiembre de 2026, en el bot que vende. Una clienta
 * pidió «los dos kit» y el modelo SUMÓ los dos precios y le dio el total.
 * Nadie suma en este motor: cuando se entregan datos de pago se usa el precio
 * de UNA opción. La suma se la inventó, ella la pagó, y cobró de más.
 *
 * Y el full NO es un producto nuevo: es el mismo producto más un complemento,
 * así que «llevarse los dos» no existe.
 *
 * Una suma es, por definición, una cifra que el operador nunca escribió. Por
 * eso se caza sin listas de palabras y sin adivinar cómo lo pidió el cliente:
 * se mira lo que el bot IBA A MANDAR.
 *
 * SOLO CUENTA SI ES DINERO. Un número con señal de moneda al lado. «3.000
 * diseños» no lo es, ni una fecha, ni un número de operación.
 *
 * Es la misma forma que `marcasDePagoNoConfiguradas`, que lleva tiempo
 * funcionando: allí se comprueba que no nombre un banco que no existe; aquí,
 * que no diga un precio que no existe.
 */
// LAS MARCAS DE MONEDA VAN CON FRONTERA DE PALABRA, Y LOS ENLACES SE QUITAN.
//
// LO QUE PASÓ — 24/09/2026, en la prueba del dueño. El guardarraíl salió con
// «dijo importes que no están configurados (122107740843423600)». Ese número no
// es un precio: es el identificador del post de Facebook del REGALO.
//
//     https://www.facebook.com/1265196766679188/posts/122107740795423600
//                                            ^^^^^^^^
//
// El «s/» de la moneda peruana —S/.— estaba sin frontera, así que casaba con la
// barra de CUALQUIER enlace: «post s/ 1221077…». Y lo mismo podía pasarle a
// `ars`, `pesos` y `soles` dentro de otras palabras.
//
// DOS CURAS, y las dos quitan la señal falsa en vez de añadir excepciones:
// primero se sacan los enlaces del texto —dentro de una URL no hay precios— y
// después se exige frontera de palabra antes de cada marca de moneda.
const ENLACES = /\bhttps?:\/\/\S+|\bwww\.\S+/gi;
const IMPORTE_CON_MONEDA =
  /(?:\$|\bars\b|\bpesos\b|\bs\/\.?|\bsoles\b)\s*(\d[\d.,]*)|(\d[\d.,]*)\s*(?:\bars\b|\bpesos\b|\bsoles\b)/gi;
export function importesQueNoSonSuyos(
  texto: string,
  phone?: string | null,
  /**
   * LO QUE ESTE CLIENTE YA ABONÓ, PARA QUE EL SALDO NO PAREZCA INVENTADO.
   *
   * LO QUE PASÓ — 24 de septiembre de 2026. El cliente había pagado la opción
   * barata (S/.15 con descuento) y pidió subir a la cara (S/.26). El motor
   * calculó bien el saldo y se lo dijo: «te falta completar S/.11». Y este
   * guardarraíl marcó ese 11 como precio inventado —cuatro veces en la misma
   * conversación—, así que cada respuesta se rehizo y costó el doble:
   *
   *     [wf] convo 116 pidio upgrade a combo en postventa; saldo pendiente S/.11
   *     [llm:guardarail] convo 116: dijo importes que no están configurados (11)
   *
   * POR QUÉ. La lista de importes suyos se arma con los precios CONFIGURADOS, y
   * un saldo no está configurado en ninguna parte: es una RESTA entre el precio
   * de la opción y lo que ya pagó. Depende de la conversación, así que no puede
   * vivir en el panel.
   *
   * No es inventado: lo calcula el motor con SUS precios. Así que lo que faltaba
   * no era permitir cifras nuevas, era darle el dato que le falta para
   * reconocerlas — el mismo arreglo que el de las marcas de pago.
   *
   * SIN ESTE DATO SE COMPORTA IGUAL QUE ANTES, letra por letra: quien no lo pase
   * sigue comparando solo contra los precios configurados.
   */
  yaPagadoSoles?: number | null,
  /**
   * LA CONVERSACIÓN ESTÁ EN LA ETAPA DE OFERTA.
   *
   * Con la oferta corriendo, el precio de ANTES ya no es un precio de esta casa:
   * es un número que el bot no puede cobrar. Ver el bloque de abajo.
   */
  laOfertaEstaActiva?: boolean
): number[] {
  if (!texto?.trim()) return [];
  const suyos = importesConfigurados(phone);
  if (suyos.size === 0) return []; // sin precios configurados no hay con qué comparar
  // EL SALDO DE CADA OPCIÓN, QUE ES UNA RESTA DE LOS SUYOS.
  //
  // Se añade lo que falta para llegar a CUALQUIER importe suyo, no solo al de la
  // opción cara: el mismo cliente puede estar completando el combo, el segundo
  // producto o la opción que cambió. Todos salen de la misma cuenta.
  //
  // Solo diferencias POSITIVAS, y solo si de verdad abonó algo. Un saldo de cero
  // o negativo no es un saldo, y dejaría pasar cifras que no vienen de aquí.
  const abonado =
    typeof yaPagadoSoles === "number" && Number.isFinite(yaPagadoSoles)
      ? yaPagadoSoles
      : 0;
  if (abonado > 0) {
    for (const suyo of Array.from(suyos)) {
      const falta = Math.trunc(suyo - abonado);
      if (falta > 0) suyos.add(falta);
    }
  }
  // Y EL AHORRO TAMBIÉN ES UNA RESTA DE LOS SUYOS.
  //
  // LO QUE PASÓ — 25 de septiembre de 2026, en su prueba. El cliente preguntó
  // «que son 2 noentiendo» y el turno acabó en el mensaje de emergencia. Uno de
  // los dos guardarraíles que se lo comieron fue éste:
  //
  //     [llm:guardarail] dijo importes que no están configurados (4); reintento
  //
  // Su combo cuesta 30 y con descuento 26. El «4» era EL AHORRO, que es justo lo
  // que hay que decirle a un cliente en etapa de oferta. Medido, los tres que
  // salen de su configuración salían marcados: 4 (del caro), 5 (del barato) y 11
  // (la diferencia entre opciones).
  //
  // La resta del upgrade ya se permitía, pero solo con algo ABONADO — y aquí el
  // cliente no había pagado nada. El ahorro no necesita pago: existe desde que
  // hay un precio tachado y uno de oferta.
  //
  // SE ACOTA A LAS RESTAS ENTRE DOS IMPORTES SUYOS, y nada más. No se abre la
  // puerta a cifras nuevas: una suma —el fallo que puso aquí este guardarraíl—
  // sigue cazada, porque sumar no es restar.
  const configurados = Array.from(suyos);
  for (const mayor of configurados) {
    for (const menor of configurados) {
      const resta = Math.trunc(mayor - menor);
      if (resta > 0) suyos.add(resta);
    }
  }
  // CON LA OFERTA ACTIVA, EL PRECIO DE ANTES YA NO SE PUEDE DECIR.
  //
  // LO QUE PASÓ — 25 de septiembre de 2026, en su prueba. La conversación entró
  // en la etapa de oferta, el cliente escribió «precio», y el bot contestó con
  // los precios de ANTES —14 y 10— cuando los de ahora eran 10 y 8. No se los
  // inventó: los copió de un mensaje suyo anterior, de esa misma conversación.
  // El motor cobró bien —le pidió 8— pero el cliente leyó otra cosa.
  //
  // POR QUÉ NO SE ARREGLA EN EL PROMPT, que fue lo primero que se pensó: en el
  // prompt todo compite a la vez y la conversación entera está llena de los
  // precios viejos. Se arregla aquí, donde ya se mira lo que el bot IBA a
  // mandar: si el importe no es uno de los que puede cobrar HOY, la respuesta se
  // rehace. Es el mismo mecanismo que impide inventar precios, con el dato que
  // le faltaba.
  //
  // SOLO SE QUITA EL QUE TIENE SUSTITUTO. Si una opción no tiene precio de
  // oferta configurado, su precio normal SIGUE siendo el suyo y no se toca.
  //
  // Y EL TACHADO SE RESPETA. El «antes» de una oferta es un campo propio —el
  // precio de mercado— y ése sigue valiendo: sin esto, un bot que enseña «antes
  // 45, hoy 8» se quedaría sin poder decir el 45.
  //
  // EL AHORRO TAMBIÉN SOBREVIVE, porque las restas se calcularon ARRIBA con el
  // precio viejo todavía dentro: «te ahorras 4» sigue siendo un importe suyo.
  if (laOfertaEstaActiva) {
    const tachados = new Set<number>();
    const config = loadWorkflowConfig();
    const perfil = config
      ? resolveCountryPaymentProfile(getEffectiveCountryCode(phone, config), config)
      : undefined;
    for (const t of [perfil?.market_price, perfil?.order_bump?.combo_market_price]) {
      if (typeof t === "number" && t > 0) tachados.add(Math.trunc(t));
    }
    // LOS QUE SÍ SE COBRAN HOY SE JUNTAN PRIMERO, Y NO SE BORRA NINGUNO.
    //
    // Lo pilló la medición antes de subirlo: el precio de oferta de la opción
    // cara era 10, y 10 es TAMBIÉN el precio normal de la barata. Borrando por
    // «es un precio normal» se quitaba un importe que el bot sí cobra hoy, y
    // decir «hoy el combo está 10» se marcaba como inventado.
    const losDeAhora = new Set<number>(tachados);
    const apunta = (n: number | null): void => {
      if (typeof n === "number" && n > 0) losDeAhora.add(Math.trunc(n));
    };
    apunta(getEffectivePriceSoles(true, phone ?? null));
    apunta(getUpsellPriceSoles(true, phone ?? null));
    apunta(getUpsellPriceSoles(false, phone ?? null));
    for (const lado of ["combo", "basico"] as const) {
      apunta(getOrderBumpPriceSoles(lado, true, phone ?? null));
    }
    const yaNoSeCobra = (normal: number | null, oferta: number | null): void => {
      if (
        typeof normal !== "number" ||
        typeof oferta !== "number" ||
        !(normal > 0) ||
        !(oferta > 0)
      ) {
        return;
      }
      const viejo = Math.trunc(normal);
      // Ni el que sigue siendo el precio de hoy de otra cosa, ni un tachado.
      if (viejo === Math.trunc(oferta) || losDeAhora.has(viejo)) return;
      suyos.delete(viejo);
    };
    yaNoSeCobra(
      getEffectivePriceSoles(false, phone ?? null),
      getEffectivePriceSoles(true, phone ?? null)
    );
    for (const lado of ["combo", "basico"] as const) {
      yaNoSeCobra(
        getOrderBumpPriceSoles(lado, false, phone ?? null),
        getOrderBumpPriceSoles(lado, true, phone ?? null)
      );
    }
  }
  const fuera: number[] = [];
  const sinEnlaces = texto.replace(ENLACES, " ");
  for (const m of sinEnlaces.matchAll(IMPORTE_CON_MONEDA)) {
    // «13.500» y «13,500» son miles; «7.5» es un decimal. El punto separa miles
    // solo cuando le siguen exactamente tres dígitos.
    const crudo = (m[1] ?? m[2] ?? "").replace(/[.,](?=\d{3}\b)/g, "");
    const n = Math.trunc(parseFloat(crudo.replace(",", ".")));
    if (!Number.isFinite(n) || n <= 0) continue;
    if (!suyos.has(n)) fuera.push(n);
  }
  return fuera;
}

/** Los importes CON MONEDA que hay escritos en un texto. Misma lectura que el
 *  guardarraíl de arriba, para que no puedan contar cosas distintas. */
function importesQueDiceElTexto(texto: string): number[] {
  const dichos: number[] = [];
  const sinEnlaces = (texto ?? "").replace(ENLACES, " ");
  for (const m of sinEnlaces.matchAll(IMPORTE_CON_MONEDA)) {
    const crudo = (m[1] ?? m[2] ?? "").replace(/[.,](?=\d{3}\b)/g, "");
    const n = Math.trunc(parseFloat(crudo.replace(",", ".")));
    if (Number.isFinite(n) && n > 0) dichos.push(n);
  }
  return dichos;
}

/**
 * ¿NOMBRA UNA OPCIÓN Y LE PONE EL PRECIO DE LA OTRA?
 *
 * LO QUE PASÓ — 27 de septiembre de 2026, su prueba HOLARG2. La oferta ya había
 * salido anunciando la opción cara a su precio de oferta. Él escribió «PRECIO» y
 * el bot le contestó con el nombre de LA CARA y el importe de LA BARATA. Medido
 * en el momento: el motor tenía los dos pares bien emparejados, así que el cruce
 * lo hizo el modelo al redactar.
 *
 * Y EL GUARDARRAÍL DE AL LADO NO PODÍA VERLO: ese importe SÍ está configurado
 * —es el precio de la otra opción—, así que pasaba limpio. Éste mira lo que
 * aquél no puede: que el precio dicho sea el DE ESE producto.
 *
 * Es de la familia más cara que tiene este bot: el cliente paga lo que leyó, el
 * validador reconoce la opción POR EL MONTO, y se entrega el producto que no era.
 *
 * SE PREGUNTA POR EL DATO, no por la redacción: los nombres y los precios salen
 * de la configuración, que es lo único estable del texto que escribe el modelo.
 * Es el mismo patrón de `looksLikeDirectPriceAnswer`.
 *
 * CUATRO CANDADOS, y cada uno tapa un falso positivo medido:
 *
 *   · SOLO SI NOMBRA UNA. Con las dos en el texto está comparándolas, que es lo
 *     correcto; con ninguna no hay a qué atribuir el importe.
 *   · SI TAMBIÉN DICE EL SUYO, NO. «el pack sale 9.000; el otro, 5.000» nombra
 *     una y dice los dos precios: eso es correcto y no se toca.
 *   · UN PRECIO COMPARTIDO NO DISTINGUE. Si las dos opciones valen lo mismo en
 *     ese país, ese importe no señala a ninguna.
 *   · Y SI UN NOMBRE CONTIENE AL OTRO no se puede decidir leyendo, así que no se
 *     decide. Ver `unNombreDentroDelOtro`.
 */
export function nombraUnaOpcionConElPrecioDeLaOtra(
  texto: string,
  phone: string | null | undefined,
  config?: WorkflowConfig | null
): { opcion: string; ajeno: number } | null {
  if (!texto?.trim()) return null;
  const cfg = config ?? loadWorkflowConfig();
  const ob = getActiveTwoTierOffer(cfg);
  if (!ob) return null;
  const limpia = (s: string): string =>
    (s ?? "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Mn}/gu, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, " ");
  const nombreCombo = limpia(nombreDeLaOpcion("combo") || ob.combo?.name || "");
  const nombreBasico = limpia(nombreDeLaOpcion("basico") || ob.basico?.name || "");
  if (nombreCombo.length < 3 || nombreBasico.length < 3) return null;
  if (
    nombreCombo.includes(nombreBasico) ||
    nombreBasico.includes(nombreCombo)
  ) {
    return null;
  }
  const dicho = limpia(texto);
  const nombraCombo = dicho.includes(nombreCombo);
  const nombraBasico = dicho.includes(nombreBasico);
  if (nombraCombo === nombraBasico) return null;
  const precios = (key: "combo" | "basico"): Set<number> => {
    const s = new Set<number>();
    for (const conOferta of [false, true]) {
      const n = getOrderBumpPriceSoles(key, conOferta, phone ?? null);
      if (typeof n === "number" && n > 0) s.add(Math.trunc(n));
    }
    return s;
  };
  const suyos = precios(nombraCombo ? "combo" : "basico");
  const ajenos = precios(nombraCombo ? "basico" : "combo");
  for (const n of Array.from(ajenos)) if (suyos.has(n)) ajenos.delete(n);
  if (ajenos.size === 0) return null;
  const dichos = importesQueDiceElTexto(texto);
  if (dichos.some((n) => suyos.has(n))) return null;
  const cruzado = dichos.find((n) => ajenos.has(n));
  if (cruzado === undefined) return null;
  return {
    opcion: (nombraCombo ? ob.combo?.name : ob.basico?.name) ?? "",
    ajeno: cruzado,
  };
}

/**
 * ¿DICE EL PRECIO DE UNA SOLA DE LAS DOS OPCIONES, SIN QUE HAYA ELEGIDO?
 *
 * LO QUE PASÓ — 28 de septiembre de 2026, su prueba HPRU1. La conversación había
 * nacido vendiendo un producto y el selector se cambió a dos en medio. El cliente
 * escribió «precio», el motor le contó la novedad —«ahora tenemos 2 opciones»— y
 * justo detrás el modelo le dio UN precio: el del producto base. Con sus
 * palabras: «cuando hay 2 productos se le entrega el precio de los 2, primero la
 * presentación y luego se le dice cuánto, o se le presentan los 2, pero no
 * entregarle el precio del básico».
 *
 * Y TIENE RAZÓN: anunciarle dos y contestarle el precio de una es peor que no
 * decir ninguno. El cliente se queda creyendo que ese importe es EL precio, y
 * cuando pague por él el validador reconocerá la opción por el monto.
 *
 * ESTO NO ES EL CRUCE DE AL LADO. Allí el nombre y el precio eran de productos
 * distintos; aquí pueden estar bien emparejados. Lo que falta es la otra mitad de
 * la respuesta, y eso el otro guardarraíl no lo puede ver.
 *
 * ES EL CONTRATO DE LA CASA, aplicado al precio: «nadie recibe datos de pago sin
 * haber elegido, cuando hay dos opciones». El precio es el dato con el que el
 * cliente decide, así que va por la misma regla.
 *
 * CUATRO CANDADOS, y cada uno tapa un falso positivo:
 *
 *   · LOS DOS PRECIOS, BIEN. Decir los dos es comparar, que es justo lo que se
 *     quiere. Solo salta cuando dice uno y calla el otro.
 *   · NINGÚN PRECIO, TAMBIÉN BIEN. Una respuesta sin importes no tiene nada que
 *     corregir.
 *   · UN PRECIO COMPARTIDO NO SEÑALA A NADIE. Si las dos valen lo mismo en ese
 *     país, ese importe es de las dos y la respuesta está completa.
 *   · Y SIN DOS OPCIONES NO EXISTE EL CASO. Con un solo producto «el precio» es
 *     el suyo y no hay nada que elegir.
 *
 * Quien llama decide además que la venta no esté ya hecha: después de pagar, el
 * precio que se habla es el del producto de la etapa upsell, que es otro asunto.
 */
export function elPrecioDeUnaSolaOpcionSinElegir(
  texto: string,
  phone: string | null | undefined,
  config?: WorkflowConfig | null,
  /**
   * ¿ESTA CONVERSACIÓN ESTÁ EN LA ETAPA DE OFERTA?
   *
   * Decide CONTRA QUÉ PAR de precios se compara. Sin esto la función daba falsos
   * positivos — ver el comentario de abajo. Apagado por defecto: quien no lo pase
   * compara contra los precios normales.
   */
  conOferta = false
): { dicho: number; laOtra: string } | null {
  if (!texto?.trim()) return null;
  const cfg = config ?? loadWorkflowConfig();
  const ob = getActiveTwoTierOffer(cfg);
  if (!ob) return null;
  // SE COMPARA CONTRA EL PAR DE SU ETAPA, NO CONTRA LOS CUATRO PRECIOS.
  //
  // LO QUE SE MIDIÓ EN VIVO el 28/09/2026, corriendo una conversación de verdad
  // contra el servidor. El cliente preguntó «precio», el modelo contestó
  // nombrando las DOS opciones con sus dos importes correctos —14 y 10, que es
  // exactamente lo que se le pedía— y esta función dijo que faltaba uno.
  //
  // COSTABA DOS COSAS EN CADA PREGUNTA DE PRECIO: un reintento al modelo, y el
  // texto de elegir pegado detrás de una respuesta que ya estaba completa. Al
  // cliente le llegaba la misma pregunta dos veces seguidas.
  //
  // POR QUÉ PASABA. Antes se juntaban los CUATRO precios —normal y de oferta de
  // cada opción— en dos bolsas, y lo compartido se quitaba de las dos. Con sus
  // precios el 10 es el de la cara CON descuento y el de la barata SIN él, así que
  // el 10 se iba de las dos bolsas: a la barata solo le quedaba su precio de
  // oferta, y como la oferta no estaba corriendo el modelo no lo había dicho ni
  // debía decirlo.
  //
  // El cliente solo ve UN par de precios: el de la etapa en la que está. Contra
  // ése se compara, y el falso positivo desaparece sin perder ningún candado.
  const delCombo = getOrderBumpPriceSoles("combo", conOferta, phone ?? null);
  const delBasico = getOrderBumpPriceSoles("basico", conOferta, phone ?? null);
  if (!(typeof delCombo === "number" && delCombo > 0)) return null;
  if (!(typeof delBasico === "number" && delBasico > 0)) return null;
  const elDelCombo = Math.trunc(delCombo);
  const elDelBasico = Math.trunc(delBasico);
  // UN PRECIO COMPARTIDO NO SEÑALA A NADIE: si en esa etapa las dos valen lo
  // mismo, decir ese importe ya las nombra a las dos.
  if (elDelCombo === elDelBasico) return null;
  const dichos = importesQueDiceElTexto(texto);
  const diceElDelCombo = dichos.includes(elDelCombo);
  const diceElDelBasico = dichos.includes(elDelBasico);
  // Los dos, o ninguno: nada que corregir.
  if (diceElDelCombo === diceElDelBasico) return null;
  return {
    dicho: diceElDelCombo ? elDelCombo : elDelBasico,
    laOtra: (diceElDelCombo ? ob.basico?.name : ob.combo?.name) ?? "",
  };
}

/**
 * NOMBRE VISIBLE de un método de pago, tomado de la etiqueta que configuró el
 * usuario para el país de ESE cliente.
 *
 * Sin listas fijas de métodos en el código: cualquier método que se agregue,
 * en cualquier país, se nombra solo. Antes había una lista de cuatro nombres
 * (Yape / Plin / BCP / efectivo) y todo lo demás caía en "Yape", así que en
 * Ecuador el bot llamaba "Yape" a Pichincha y a Mi Vecino.
 *
 * Los nombres clásicos quedan SOLO como respaldo para cuando no hay lista
 * configurada (bot clásico peruano), para no cambiar ese comportamiento.
 */
export function getPaymentMethodLabel(
  method: string | null | undefined,
  phone?: string | null
): string {
  const id = (method ?? "").trim().toLowerCase();
  if (!id) return "";
  // Los CUATRO nombres clásicos mandan primero, con el texto exacto de siempre.
  // Así Perú queda IDÉNTICO a como estaba: este arreglo solo alcanza a los
  // métodos que no existían cuando el bot era de un solo país.
  const CLASICOS: Record<string, string> = {
    bcp_transferencia: "BCP/transferencia",
    efectivo: "efectivo",
    plin: "Plin",
    yape: "Yape",
  };
  if (CLASICOS[id]) return CLASICOS[id];
  const limpia = (etiqueta: string): string =>
    etiqueta
      .replace(/[\p{Extended_Pictographic}\p{Emoji_Component}]/gu, "")
      .replace(/\s+/g, " ")
      .trim() || etiqueta.trim();
  const configurado = getPaymentMethods(phone).find(
    (m) => m.method.trim().toLowerCase() === id
  );
  if (configurado) return limpia(configurado.label);
  // Sin etiqueta configurada se devuelve la palabra clave tal cual: nunca se
  // inventa un nombre de otro método.
  return method ?? "";
}

/** Id del método de pago por DEFECTO. Se usa cuando el flujo manda datos de pago
 *  sin que el cliente haya elegido método aún (ej. doble oferta directo, o el
 *  cliente que pide los datos sin elegir).
 *
 *  Orden de preferencia:
 *   1. El método marcado como PRINCIPAL en el panel para ese país.
 *   2. Si ninguno esta marcado, el PRIMERO de la lista (comportamiento previo).
 *   3. Si no hay lista (clásico/Mundial), "yape".
 *
 *  Si por un error de edición quedara mas de uno marcado, gana el primero: el
 *  panel lo impide, pero el YAML se puede tocar a mano y no debe romperse. */
export function getDefaultPaymentMethodId(phone?: string | null): string {
  const methods = getPaymentMethods(phone);
  return (
    methods.find((m) => m.principal)?.method ?? methods[0]?.method ?? "yape"
  );
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
  // “Cuenta” es un alias genérico útil si el cliente lo escribe literalmente,
  // pero NO admite typo: “cuesta” (pregunta de precio) está a una letra y no
  // puede convertirse en una elección de BCP. Los demás aliases mantienen la
  // tolerancia existente a un error para nombres distintivos de métodos.
  const exactOnlyAliases = new Set(["cuenta"]);
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
              (!exactOnlyAliases.has(kw) &&
                kw.length >= 5 &&
                w.length >= 4 &&
                withinOneTypo(w, kw))
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

/** Igual que getOrderBumpOption pero con los textos POR PAÍS aplicados encima
 *  del base (respuesta al elegir, mensaje directo y respuestas por método).
 *  La ENTREGA queda intacta (común). Un campo por país vacío usa el base. */
export function getOrderBumpOptionForCountry(
  key: "combo" | "basico",
  phone: string | null | undefined,
  config = loadWorkflowConfig()
): OrderBumpOption | undefined {
  const ob = getActiveTwoTierOffer(config);
  const base = ob ? (key === "combo" ? ob.combo : ob.basico) : undefined;
  if (!base) return base;
  const country = getEffectiveCountryCode(phone, config);
  const ov = base.by_country?.[country];
  if (!ov) return base;
  const nonEmpty = (a?: ResponseStep[]): ResponseStep[] | undefined =>
    Array.isArray(a) && a.length > 0 ? a : undefined;
  // Mezcla por método: cada método del país pisa al base solo si tiene pasos.
  let paymentResponses = base.payment_responses;
  if (ov.payment_responses) {
    paymentResponses = { ...base.payment_responses };
    for (const [method, steps] of Object.entries(ov.payment_responses)) {
      const s = nonEmpty(steps);
      if (s) paymentResponses[method] = s;
    }
  }
  return {
    ...base,
    direct_payment_prompt:
      nonEmpty(ov.direct_payment_prompt) ?? base.direct_payment_prompt,
    response: nonEmpty(ov.response) ?? base.response,
    payment_responses: paymentResponses,
  };
}

/** Precio efectivo de una opción del Order Bump. Es la única fuente de verdad
 *  para conversación, mensajes de pago y validación del comprobante. */
export function getOrderBumpPriceSoles(
  key: "combo" | "basico",
  discountActive: boolean,
  phone: string | null
): number | null {
  const config = loadWorkflowConfig();
  const frozen = getFrozenPrices(phone ? getConversationByPhone(phone) : null);
  const applyFrozenPrice = (currentPrice: number | null): number | null => {
    if (currentPrice === null) return null;
    // EL PRECIO CONGELADO SE LEE CUANDO LA CONVERSACIÓN SIGUE EN LO MISMO.
    //
    // Antes decía `frozen.modality !== "order_bump" || activeModalityKey(...) !==
    // "order_bump"`, que es la misma pregunta escrita con el NOMBRE. Con el
    // selector «PRESENTA: COMO -OB-» la modalidad sigue llamándose lineal, así
    // que el congelado se ignoraba entero: la conversación vendía dos opciones y
    // sus dos precios podían moverse bajo el cliente al abrirse o cerrarse la
    // ventana de descuento.
    //
    // La comparación que importa es que el congelado sea DE ESTA MISMA
    // modalidad, que es lo que ya hace `getEffectivePriceSoles` unas líneas
    // arriba. Las dos condiciones de antes decían exactamente eso para -OB-, así
    // que ahí no cambia nada. Y donde no haya oferta de dos, las casillas del
    // combo y del básico están vacías y esto devuelve el precio de hoy, igual
    // que siempre.
    if (!config || !frozen || frozen.modality !== activeModalityKey(config)) {
      return currentPrice;
    }
    const slot = key === "combo" ? frozen.combo : frozen.basico;
    let frozenPrice = discountActive ? slot.discount : slot.regular;
    // EL QUE VINO DE UN SOLO PRODUCTO PAGA LO QUE SE LE DIJO.
    //
    // MODO REENGANCHE, 26/09/2026. Una conversación que empezó cuando el bot
    // vendía UNO congeló solo `base`: las casillas del combo y del básico están
    // vacías porque entonces no había dos opciones. Al reenganchar aparecen las
    // dos, y sin esto el básico saldría al precio de HOY — que es justo lo que
    // el dueño quiere evitar: «el bot debe respetar el precio que se le dijo en
    // lineal para que no haya rechazos, ya que yo hago cambios de precios en
    // cualquier momento».
    //
    // SOLO PARA EL BÁSICO, con sus palabras: «jamás pagará desde como lineal a
    // como dou o como ob el producto full». Del full nunca se le habló, así que
    // ahí no hay nada que respetar y sale el precio de hoy.
    //
    // Y NO PUEDE COBRAR DE MÁS: el `Math.min` de abajo se queda siempre con el
    // menor de los dos, igual que hace el congelado de siempre.
    //
    // Y SE ACOTA AL CASO EXACTO: solo si AHORA hay dos opciones de verdad. En
    // Lineal puro esta función también contesta —el «base» es el producto
    // único— y ahí no se toca nada: sigue devolviendo lo de siempre, letra por
    // letra. El único que entra aquí es el que empezó con uno y hoy ve dos.
    if (
      key === "basico" &&
      getActiveTwoTierOffer(config) !== null &&
      !(typeof frozenPrice === "number" && frozenPrice > 0)
    ) {
      const delUnico = discountActive
        ? frozen.base.discount
        : frozen.base.regular;
      if (typeof delUnico === "number" && delUnico > 0) frozenPrice = delUnico;
    }
    return typeof frozenPrice === "number" && frozenPrice > 0
      ? Math.min(frozenPrice, currentPrice)
      : currentPrice;
  };
  // FUERA DE LAS MODALIDADES DE DOS OPCIONES, EL «BASE» ES EL PRODUCTO ÚNICO.
  //
  // Aquí estaba el fallo que dejaba `{{PRECIO_BASE}}` en blanco en Lineal. Esta
  // función pregunta por la oferta de dos opciones, y en Lineal no hay ninguna:
  // se quedaba sin producto del que sacar el precio, y lo único que le restaba
  // era el precio del país. Con ese en cero —que es lo normal cuando se llena la
  // ficha y no Precios y pagos— devolvía nada, y al cliente le llegaba «HOY: »
  // sin cifra.
  //
  // En Lineal y en la modalidad Upsell hay UN producto y su precio ya está
  // resuelto: es el mismo que da `{{PRECIO}}`, con el país mandando y la ficha
  // de respaldo. Se devuelve ése, que es lo que el comodín quiere decir ahí.
  //
  // El FULL no entra en esto a propósito: en esas modalidades no existe, y darle
  // el precio del único haría que la burbuja dijera «Full» enseñando el precio de
  // otra cosa.
  //
  // Y VACÍO DE VERDAD, NO LO QUE QUEDARA EN EL PERFIL DEL PAÍS. Ese perfil guarda
  // un precio de full por país aunque la modalidad no tenga full, y ahí se queda
  // el de la última vez que sí lo tuvo. En Lineal salía ese número viejo: una
  // cifra que no es de ningún producto de esta modalidad, y no hay forma de que
  // el operador sepa de dónde salió. Sin producto no hay precio.
  if (!getActiveTwoTierOffer(config)) {
    if (key === "combo") return null;
    const delUnico = getEffectivePriceSoles(discountActive, phone);
    return applyFrozenPrice(
      typeof delUnico === "number" && Number.isFinite(delUnico) && delUnico > 0
        ? delUnico
        : null
    );
  }
  const option = getOrderBumpOption(key);
  const country = getEffectiveCountryCode(phone);
  const profile = resolveCountryPaymentProfile(country);
  // COMBO (oferta 2-en-1): precio POR PAÍS en la capa (order_bump.combo_price),
  // editable en la pestaña Order Bump → Opción 1. Fallback al global. Su storage
  // es distinto del básico (course), así no se pisan.
  if (key === "combo") {
    // LA FICHA DEL PRODUCTO FULL MANDA. Ver `preciosDeLaFichaEnElPais`.
    const deLaFicha = preciosDeLaFichaEnElPais("full", country, config);
    const kReg = profile?.order_bump?.combo_price_soles;
    const kDisc = profile?.order_bump?.combo_discount_price_soles;
    const regular =
      deLaFicha.precio ??
      (typeof kReg === "number" && kReg > 0 ? kReg : undefined) ??
      option?.price_soles ??
      0;
    const promo =
      deLaFicha.descuento ??
      (typeof kDisc === "number" && kDisc > 0 ? kDisc : undefined) ??
      option?.discount_price_soles ??
      0;
    return applyFrozenPrice(
      discountActive && promo > 0 && promo <= regular
        ? promo
        : regular > 0 ? regular : null
    );
  }
  // BÁSICO = producto BASE: su precio es POR PAÍS, el mismo que "Precio Order Bump"
  // / "Precio de oferta Order Bump" de Precios y pagos (course/discount de la capa
  // de la modalidad order bump para el país). Fallback al precio global del básico.
  // LA FICHA DEL PRODUCTO BÁSICO MANDA. Ver `preciosDeLaFichaEnElPais`.
  const deLaFichaBasico = preciosDeLaFichaEnElPais("basico", country, config);
  const cReg = profile?.course_price_soles;
  const cDisc = profile?.discount_price_soles;
  const regular =
    deLaFichaBasico.precio ??
    (typeof cReg === "number" && cReg > 0 ? cReg : undefined) ??
    option?.price_soles ??
    0;
  const promo =
    deLaFichaBasico.descuento ??
    (typeof cDisc === "number" && cDisc > 0 ? cDisc : undefined) ??
    option?.discount_price_soles ??
    0;
  return applyFrozenPrice(
    discountActive && promo > 0 && promo <= regular
      ? promo
      : regular > 0 ? regular : null
  );
}

/**
 * EL PRECIO ANTERIOR DEL PAÍS Y, SI NO LO TIENE, EL DE LA FICHA.
 *
 * Vive aparte porque lo usan los DOS renderizadores de comodines, y separados ya
 * se separaron una vez: uno resolvía un precio y el otro lo dejaba en blanco
 * según por qué camino saliera el mensaje.
 *
 * Se compara contra cero a mano. Con `??` un cero contaría como respuesta y el
 * respaldo no entraría nunca — y un cero aquí no es «no tiene precio anterior»,
 * es un campo que nadie llenó.
 */
export function mercadoConRespaldo(
  delPais: number | undefined,
  deLaFicha: number | undefined
): number | undefined {
  if (typeof delPais === "number" && Number.isFinite(delPais) && delPais > 0) {
    return delPais;
  }
  return typeof deLaFicha === "number" && Number.isFinite(deLaFicha) && deLaFicha > 0
    ? deLaFicha
    : undefined;
}

export function renderOrderBumpTemplate(
  text: string,
  discountActive: boolean,
  phone?: string | null
): string {
  const ob = getActiveTwoTierOffer();
  const country = getEffectiveCountryCode(phone);
  // Mismo nombre que usa la detección: si el campo de la oferta está vacío, el
  // del producto por su papel. Antes salía «Opción 1» en el mensaje al cliente.
  const comboName = nombreDeLaOpcion("combo") || "Opción 1";
  const basicoName = nombreDeLaOpcion("basico") || "Opción 2";
  const comboPrice = getOrderBumpPriceSoles("combo", discountActive, phone ?? null);
  const basicoPrice = getOrderBumpPriceSoles("basico", discountActive, phone ?? null);
  // Precio ADICIONAL del combo sobre el básico (lo que se "agrega"). Se calcula
  // solo, así en etapa de oferta también baja correctamente (ej. 15-10=5 normal,
  // 10-7=3 en oferta). Redondeo a 2 decimales por si hay precios con centavos.
  const extraPrice =
    comboPrice != null && basicoPrice != null
      ? Math.round((comboPrice - basicoPrice) * 100) / 100
      : null;
  // El TERCER producto, el de la modalidad "Doble Oferta + Upsell".
  //
  // Se calcula aquí, junto a los otros dos, para que los tres comodines de
  // precio salgan del mismo sitio y no puedan discrepar. Fuera de esa
  // modalidad getUpsellPriceSoles devuelve null y el comodín queda vacío, que
  // es lo correcto: ahí no hay tercer producto que anunciar.
  const upsellPrice = getUpsellPriceSoles(discountActive, phone ?? null);
  // UN COMODÍN POR PRECIO, Y EL ESTILO SE ELIGE EN EL CAJÓN.
  //
  // Había cuatro formas del mismo precio —pelado, "completo", mayúsculas y
  // minúsculas— y elegir entre ellas era adivinar: "completo" no quiere decir
  // "el producto completo" sino "con la moneda", justo en una modalidad que
  // tiene un producto llamado FULL.
  //
  // Ahora hay uno por precio, siempre con su símbolo, y cómo sale la palabra
  // de la moneda se decide con el botón que está al lado del monto. Los
  // comodines viejos siguen mandando ellos: uno que dice "en mayúsculas" no
  // puede depender de un botón.
  const perfilPais = resolveCountryPaymentProfile(country);
  const conEstilo = (
    valor: number | null | undefined,
    estilo: "upper" | "lower" | "off" | undefined
  ): string =>
    typeof valor === "number" && Number.isFinite(valor) && valor > 0
      ? formatCurrencyAmount(valor, country, undefined, estilo ?? "upper")
      : "";
  const estiloBase = perfilPais?.price_label_case;
  const estiloFull = perfilPais?.order_bump?.combo_price_label_case;
  const estiloUpsell = perfilPais?.upsell?.price_label_case;
  // EL «ANTES» DEL BASE: EL DEL PAÍS Y, SI ESTÁ EN BLANCO, EL DE LA FICHA.
  //
  // Se compara contra cero en vez de usar `??`: un cero es un campo sin llenar,
  // y con `??` no dispararía el respaldo — el comodín seguiría saliendo vacío,
  // que es justo el fallo que esto arregla. Ver `market_price` en la capa.
  // Y DELANTE DE LOS DOS, LA FICHA — la misma prioridad que su precio, o el
  // tachado diría una cosa y el precio otra. Ver `preciosDeLaFichaEnElPais`.
  const tachadoDeLaFicha = (() => {
    const unico = preciosDeLaFichaEnElPais("unico", country);
    return unico.tachado ?? preciosDeLaFichaEnElPais("basico", country).tachado;
  })();
  const mercadoDelBase =
    tachadoDeLaFicha ??
    mercadoConRespaldo(
      perfilPais?.market_price,
      loadWorkflowConfig()?.market_price
    );
  // Formato: 2 decimales si los tiene (9.9 → "9.90"), entero si no (3 → "3").
  const fmt = (n: number | null | undefined): string =>
    n == null ? "" : Number.isInteger(n) ? String(n) : n.toFixed(2);
  const rendered = text
    // Los seis nuevos van PRIMEROS: "precio_full" empieza igual que "precio_1"
    // no, pero sí que "precio_base" contiene "precio"; y el genérico de más
    // abajo se comería su principio dejando "_base" suelto en el mensaje.
    .replace(
      /\{\{\s*(precio_full|precio_combo)\s*\}\}/gi,
      literal(conEstilo(comboPrice, estiloFull))
    )
    .replace(
      /\{\{\s*(precio_base|precio_basico)\s*\}\}/gi,
      literal(conEstilo(basicoPrice, estiloBase))
    )
    // El del tercer producto pasa a llevar su moneda como los otros dos. Antes
    // devolvía el número pelado, y un número sin moneda no se puede usar: hay
    // que escribirle el "S/." y el "SOLES" al lado, y entonces un cliente de
    // otro país lee la moneda equivocada. En el contenido no lo usaba nadie.
    .replace(
      /\{\{\s*(precio_upsell|precio_upsell_solo|precio_3|precio3|price_upsell|upsell_price)\s*\}\}/gi,
      literal(conEstilo(upsellPrice, estiloUpsell))
    )
    // EL PRECIO DEL COMPLEMENTARIO, con su moneda.
    //
    // Es lo que cuesta subir del básico al full, o sea lo que vale el producto
    // que se suma: el precio del COMPLEMENTARIO. Se llamaba solo "diferencia",
    // así que el producto tenía un nombre y su precio otro — al escribir había
    // que acordarse de que no se emparejaban. `precio_complementario` los empata;
    // los nombres viejos siguen dando lo mismo.
    //
    // Sigue el estilo del full, que es lo que se está comprando.
    .replace(
      /\{\{\s*(precio_complementario|precio_diferencia|precio_extra_completo)\s*\}\}/gi,
      literal(conEstilo(extraPrice, estiloFull))
    )
    .replace(
      /\{\{\s*(precio_antes_full|precio_anterior_full|precio_mercado_full)\s*\}\}/gi,
      literal(
        conEstilo(
          // La ficha del full manda, igual que con su precio.
          preciosDeLaFichaEnElPais("full", country).tachado ??
            perfilPais?.order_bump?.combo_market_price,
          estiloFull
        )
      )
    )
    .replace(
      /\{\{\s*(precio_antes_base|precio_anterior_base|precio_mercado_basico)\s*\}\}/gi,
      literal(conEstilo(mercadoDelBase, estiloBase))
    )
    .replace(
      /\{\{\s*(precio_antes_upsell|precio_anterior_upsell|precio_mercado_upsell)\s*\}\}/gi,
      literal(
        conEstilo(
          // UNA OFERTA DE LA FILA, CON LO SUYO Y NADA MÁS: el «antes» del upsell de
          // siempre no es el de este producto. En el downsell, su «antes» es el normal.
          ((): number | undefined => {
            const deLaFila = seccionUpsell()?.de_la_fila;
            if (deLaFila) {
              return preciosDeLaOfertaDeLaFila(deLaFila, country).tachado;
            }
            // La ficha del upsell manda, igual que con su precio.
            return (
              preciosDeLaFichaEnElPais("upsell", country).tachado ??
              perfilPais?.upsell?.market_price ??
              seccionUpsell()?.market_price
            );
          })(),
          estiloUpsell
        )
      )
    )
    .replace(/\{\{\s*(opcion_1|opcion1|option_1|option1|combo_name|producto_1|producto1|product_1|product1)\s*\}\}/gi, literal(comboName))
    .replace(/\{\{\s*(opcion_2|opcion2|option_2|option2|basico_name|producto_2|product_2)\s*\}\}/gi, literal(basicoName))
    .replace(/\{\{\s*(precio_1_completo|precio1_completo|price_1_label|combo_price_label)\s*\}\}/gi, literal(comboPrice == null ? "" : formatCurrencyAmount(comboPrice, country)))
    .replace(/\{\{\s*(precio_2_completo|precio2_completo|price_2_label|basico_price_label)\s*\}\}/gi, literal(basicoPrice == null ? "" : formatCurrencyAmount(basicoPrice, country)))
    .replace(/\{\{\s*(precio_extra_completo|precio_adicional_completo|precio_diferencia_completo|diferencia_completa|extra_label)\s*\}\}/gi, literal(extraPrice == null ? "" : formatCurrencyAmount(extraPrice, country)))
    .replace(/\{\{\s*(precio_upsell_completo|precio_3_completo|precio3_completo|upsell_price_label)\s*\}\}/gi, literal(upsellPrice == null ? "" : formatCurrencyAmount(upsellPrice, country)))
    .replace(/\{\{\s*(precio_1_mayusculas|precio1_mayusculas)\s*\}\}/gi, literal(comboPrice == null ? "" : formatCurrencyAmount(comboPrice, country, undefined, "upper")))
    .replace(/\{\{\s*(precio_2_mayusculas|precio2_mayusculas)\s*\}\}/gi, literal(basicoPrice == null ? "" : formatCurrencyAmount(basicoPrice, country, undefined, "upper")))
    .replace(/\{\{\s*(precio_extra_mayusculas|precio_adicional_mayusculas|precio_diferencia_mayusculas)\s*\}\}/gi, literal(extraPrice == null ? "" : formatCurrencyAmount(extraPrice, country, undefined, "upper")))
    .replace(/\{\{\s*(precio_upsell_mayusculas|precio_3_mayusculas|precio3_mayusculas)\s*\}\}/gi, literal(upsellPrice == null ? "" : formatCurrencyAmount(upsellPrice, country, undefined, "upper")))
    .replace(/\{\{\s*(precio_1_minusculas|precio1_minusculas)\s*\}\}/gi, literal(comboPrice == null ? "" : formatCurrencyAmount(comboPrice, country, undefined, "lower")))
    .replace(/\{\{\s*(precio_2_minusculas|precio2_minusculas)\s*\}\}/gi, literal(basicoPrice == null ? "" : formatCurrencyAmount(basicoPrice, country, undefined, "lower")))
    .replace(/\{\{\s*(precio_extra_minusculas|precio_adicional_minusculas|precio_diferencia_minusculas)\s*\}\}/gi, literal(extraPrice == null ? "" : formatCurrencyAmount(extraPrice, country, undefined, "lower")))
    .replace(/\{\{\s*(precio_upsell_minusculas|precio_3_minusculas|precio3_minusculas)\s*\}\}/gi, literal(upsellPrice == null ? "" : formatCurrencyAmount(upsellPrice, country, undefined, "lower")))
    .replace(/\{\{\s*(precio_1|precio1|price_1|price1|combo_price)\s*\}\}/gi, literal(fmt(comboPrice)))
    .replace(/\{\{\s*(precio_2|precio2|price_2|price2|basico_price)\s*\}\}/gi, literal(fmt(basicoPrice)))
    .replace(
      /\{\{\s*(precio_extra|precio_adicional|precio_diferencia|diferencia|extra)\s*\}\}/gi,
      literal(fmt(extraPrice))
    )
    // Los nombres del tercer producto ya se resolvieron arriba, CON su moneda.
    // Aquí solo queda el que pide el número pelado a propósito.
    .replace(
      /\{\{\s*(precio_upsell_numero|precio_3_numero)\s*\}\}/gi,
      literal(fmt(upsellPrice))
    );
  return applyProductName(rendered);
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

/**
 * LOS PRODUCTOS DE CADA MODALIDAD, CON EL MISMO NOMBRE EN TODAS.
 *
 * Order Bump y Doble Oferta + Upsell venden cosas parecidas —las dos tienen un
 * BÁSICO y un FULL— pero las guardaban en campos cruzados:
 *
 *              Order Bump                    Doble Oferta + Upsell
 *   básico     product_name                  product_name_2
 *   full       order_bump.combo.name         product_name
 *
 * O sea que `product_name` es el BÁSICO en una y el FULL en la otra. Por eso
 * cada modalidad enseñaba comodines distintos: con un solo nombre, el comodín
 * mentía en una de las dos.
 *
 * Aquí se empatan: un comodín por papel —base, full, complementario— y cada
 * modalidad lo resuelve con SU campo. El nombre que se escribe es el mismo en
 * todas; el dato que sale es el de la modalidad que esté vendiendo.
 *
 * COMPLEMENTARIO es el tercero de Order Bump: lo que se SUMA al básico para
 * llegar al full. Solo existe ahí. En las demás devuelve vacío a propósito
 * (regla 5-bis): mejor un hueco que nombrar un producto que no se vende.
 */
/** Se exporta SOLO para poder probarla con una configuración inventada. Las
 *  llamadas de dentro siguen igual: sin argumento leen la de verdad. */
export function nombresDeLosProductos(config?: WorkflowConfig | null): {
  base: string;
  full: string;
  complementario: string;
} {
  const cfg = config ?? loadWorkflowConfig();
  const principal = cfg?.product_name?.trim() ?? "";
  const segundo = cfg?.product_name_2?.trim() ?? "";
  const modo = cfg ? activeModalityKey(cfg) : "";
  if (cfg && modo === "order_bump") {
    return {
      base: principal,
      full: cfg.order_bump?.combo?.name?.trim() ?? "",
      complementario: segundo,
    };
  }
  // EL COMPLEMENTO QUE EL DUEÑO SENTÓ, AUNQUE ESTA MODALIDAD NO LO VENDA APARTE.
  //
  // LO PIDIÓ EL DUEÑO el 01/10/2026: «tengo un problema con el comodín del
  // complementario, yo sé que no se vende, pero tiene que representarse en el visor
  // y en la entrega del cliente… eso no es motivo para que no se muestre».
  //
  // Y TENÍA RAZÓN, porque la regla de antes se escribió cuando el complemento solo
  // podía existir en Order Bump: vivía en una CAJA de contenido, y fuera de esa
  // modalidad la caja guardaba el producto de otra venta. Devolver vacío era lo
  // correcto — «mejor un hueco que nombrar un producto que no se vende».
  //
  // CON EL ALMACÉN ESO CAMBIÓ. Ahora hay un ASIENTO de complementario en la
  // alineación de cualquier modalidad, y lo que hay sentado ahí lo puso él a mano,
  // hoy, para esta venta. Ya no es un resto de otra configuración: es una elección.
  //
  // Así que la regla se conserva y se acota: no se nombra lo que quedó en una caja
  // vieja, pero sí lo que está SENTADO. Se lee del mismo sitio que el reparto —el
  // asiento más el almacén— así que respeta la alineación de la TIENDA igual que
  // todo lo demás.
  //
  // MEDIDO ANTES DE TOCARLO, en su configuración: solo lineal tiene un complemento
  // sentado. Order Bump y Doble Oferta + Upsell no tienen ninguno, así que no se
  // mueven — y ahí es donde él pidió no tocar nada.
  const elComplementoSentado = (): string => {
    if (!cfg) return "";
    const biblioteca = cfg.biblioteca_de_productos;
    if (!Array.isArray(biblioteca)) return "";
    const id = String(laAlineacionQueJuega(cfg, modo)?.complementario ?? "").trim();
    if (!id) return "";
    return biblioteca.find((p) => p?.id === id)?.name?.trim() ?? "";
  };
  // LINEAL Y UPSELL: UN SOLO PRODUCTO, ASÍ QUE LOS DOS NOMBRES SON ÉL.
  //
  // No se juntan dos productos distintos: es que ahí no hay dos. En Lineal se
  // vende uno, y «el barato» y «el caro» solo pueden ser ese mismo.
  //
  // POR QUÉ HACE FALTA. Antes `{{PRODUCTO_BASE}}` devolvía el SEGUNDO producto,
  // que en Lineal no se vende: salía en blanco y la frase se quedaba a medias
  // sin que nada lo dijera. Y obligaba a escribir los textos dos veces, unos
  // con `{{PRODUCTO}}` para Lineal y otros con `{{PRODUCTO_BASE}}` para las de
  // dos opciones, cuando dicen lo mismo.
  //
  // Fuera de estas dos no cambia nada: donde hay un barato y un caro de verdad
  // —Order Bump, las dos Dobles Ofertas— cada comodín sigue dando el suyo.
  if (modo === "lineal" || modo === "upsell") {
    // …SALVO CUANDO ESTÁ VENDIENDO DOS CON LA PRESENTACIÓN PRESTADA.
    //
    // LO QUE PASÓ — 23 de septiembre de 2026. El dueño sentó un producto en el
    // básico y otro en el full, encendió el selector, y los DOS comodines le
    // salían con el nombre del básico. Con sus palabras: «al yo poner los
    // comodines, basico y full, ambos salían representados con el nombre del
    // producto base».
    //
    // La razón es la de arriba, que era cierta hasta ayer: en Lineal se vende
    // uno, así que «el barato» y «el caro» son el mismo. Con el selector
    // encendido ya no: vende dos, y cada comodín tiene que dar el suyo.
    //
    // SE PREGUNTA POR EL DATO, no por el nombre de la modalidad — la misma
    // regla que este proyecto ya pagó tres veces. Hace falta el interruptor Y
    // los dos nombres puestos: sin el segundo producto sentado no hay dos, y
    // entonces esto se comporta exactamente como antes.
    //
    // Y CUÁL ES CUÁL SE LO PREGUNTA A LA TABLA, NO A UNA POSICIÓN FIJA.
    //
    // Aquí decía «las dos formas reparten igual: el caro en el hueco 1». Era
    // cierto hasta el 24/09, cuando «como -OB-» pasó a poner delante el producto
    // VISIBLE para no destapar el full en la primera pregunta. Con la suposición
    // vieja, los dos comodines salían CRUZADOS: `{{PRODUCTO_BASE}}` daba el full
    // y `{{PRODUCTO_FULL}}` el básico. Lo cazó la batería —
    // `prueba-cada-comodin-da-su-producto`— antes de llegar a una conversación.
    //
    // Es el tercer sitio de la misma familia, y el motivo de que la tabla exista:
    // quien LLENA los huecos y quien los LEE tienen que preguntar a la misma.
    if (cfg && segundaOpcionPrestada(cfg) && principal && segundo) {
      const tabla = tablaDeHuecos(modo, cfg);
      const cajaDelHueco = (hueco: 1 | 2 | undefined): string =>
        hueco === 1 ? principal : hueco === 2 ? segundo : "";
      return {
        base: cajaDelHueco(tabla.basico) || segundo,
        full: cajaDelHueco(tabla.full) || principal,
        complementario: elComplementoSentado(),
      };
    }
    // Y SI SOLO HAY UNO, EL QUE HAYA — ESTÉ EN EL HUECO QUE ESTÉ.
    //
    // Con el selector encendido y el segundo producto SIN sentar, el reparto ya
    // ha movido el único al hueco 2, así que `product_name` se queda vacío. Sin
    // esto los comodines salían EN BLANCO y el cliente leía una frase con un
    // agujero donde va el nombre — sin error, sin aviso y sin nada que lo
    // explique. Es el minuto que tarda en elegir el segundo producto, y en ese
    // minuto el bot sigue vendiendo: tiene que saber nombrar lo que vende.
    const elQueHaya = principal || segundo;
    return {
      base: elQueHaya,
      full: elQueHaya,
      complementario: elComplementoSentado(),
    };
  }
  // El resto se queda EXACTAMENTE como estaba: el full es el principal y la
  // base el segundo. Es lo que hoy leen los textos de Doble Oferta + Upsell,
  // que es la modalidad que está vendiendo y no se puede tocar.
  return {
    base: segundo,
    full: principal,
    complementario: elComplementoSentado(),
  };
}

/**
 * DE DÓNDE SALE LA ENTREGA QUE SE ESTÁ ENVIANDO.
 *
 * Vive aquí y no en payment.ts para que el resolutor del comodín de abajo no
 * tenga que cruzar los dos archivos. `DeliverySource` es esto mismo: payment.ts
 * lo reexporta con su nombre de siempre, así que los ciento y pico sitios que
 * ya lo importan de ahí siguen funcionando igual.
 */
export type FuenteDeEntrega =
  | "approved"
  | "upsell"
  | "bioferta_a"
  | "bioferta_b"
  | "bioferta_pack"
  | "ob_combo"
  | "ob_basico";

/**
 * EL NOMBRE DEL PRODUCTO QUE SE ESTÁ ENTREGANDO EN ESTE MOMENTO.
 *
 * EL PROBLEMA QUE RESUELVE. Los demás comodines de nombre apuntan a un PUESTO:
 * `{{PRODUCTO_BASE}}` quiere decir «el básico de la modalidad que vende», no
 * «este producto». Mientras el producto era el sitio donde estaba guardado eso
 * daba igual, pero ahora un producto se mueve de puesto: el que hoy es el
 * básico mañana es el full. Y entonces la burbuja de entrega —que viaja DENTRO
 * del producto— nombraría al que ocupó su puesto, que ya es otro. Le llega el
 * archivo correcto con el nombre equivocado, y nada lo avisa.
 *
 * Éste no apunta a un puesto: apunta a lo que el bot está entregando ahora. Se
 * escribe una vez en la entrega del producto y vale para siempre.
 *
 * ES EL MISMO MECANISMO QUE EL PRECIO. `{precio}` ya sale bien en la entrega
 * del básico y en la del full porque se resuelve con la FUENTE de esa entrega.
 * Aquí se hace igual, con el nombre en vez del importe.
 *
 * VACÍO ANTES QUE MENTIRA. Si esa fuente no tiene nombre puesto, devuelve el
 * del producto principal, y si tampoco lo hay, nada. Un hueco se ve; un nombre
 * inventado no.
 */
export function nombreDelProductoEntregado(
  fuente: FuenteDeEntrega | null | undefined,
  config?: WorkflowConfig | null
): string {
  const cfg = config ?? loadWorkflowConfig();
  if (!cfg) return "";
  const limpio = (v: unknown): string =>
    typeof v === "string" ? v.trim() : "";
  const principal = limpio(cfg.product_name);
  switch (fuente) {
    case "upsell":
      return limpio(seccionUpsell(cfg)?.name) || principal;
    case "ob_combo":
      return limpio(getActiveTwoTierOffer(cfg)?.combo?.name) || principal;
    case "ob_basico":
      return limpio(getActiveTwoTierOffer(cfg)?.basico?.name) || principal;
    case "bioferta_b":
      return limpio(cfg.bioferta_doble?.product_b?.name) || principal;
    case "bioferta_pack":
      return limpio(cfg.bioferta_doble?.pack?.name) || principal;
    case "bioferta_a":
      return limpio(cfg.bioferta_doble?.product_a?.name) || principal;
    // "approved" es la entrega del producto principal: Lineal, y el full de
    // Doble Oferta + Upsell, que es donde vive `product_name`.
    default:
      return principal;
  }
}

/**
 * EL SORTEO DE UN CAJÓN DE INTRO, POR PESO.
 *
 * POR QUÉ EL DADO SE TIRA AQUÍ Y NO AL LEER EL ARCHIVO. Si el sorteo ocurriera
 * al cargar la configuración, a TODOS los clientes les tocaría el mismo cajón
 * hasta que el archivo cambiara: no sería un reparto, sería una elección. Se
 * tira por conversación, en el momento de mandarla.
 *
 * Y SE TIRA CON LA SEMILLA DE LA CONVERSACIÓN, no al azar puro: si el envío se
 * reintenta, al mismo cliente le vuelve a tocar el mismo cajón. Un cliente que
 * recibe media oferta de una versión y media de otra es peor que cualquier
 * reparto desequilibrado.
 *
 * VACÍO O SIN NINGUNO ENCENDIDO devuelve null, y quien llama se queda con la
 * secuencia de siempre. Ésa es la garantía de que esto no cambia ningún bot por
 * el hecho de existir.
 */
export function sorteaCajonDeIntro(
  grupos: GrupoDeIntro[] | undefined,
  semilla: number,
  /** El país del cliente. Sin él, se sortea entre todos como toda la vida. */
  pais?: string | null,
  /**
   * SI SE PASA, AQUÍ SE APUNTA SI AL CLIENTE LE FALTA EL CAJÓN DE SU PAÍS (16/10/2026).
   *
   * Con el respaldo entre países apagado, esto devuelve null en ese caso — igual que «no hay
   * cajones» —, y quien llama necesita distinguirlos: sin cajones se usa la secuencia de
   * siempre, pero sin el de su país NO, porque la de siempre también puede ser de otro país.
   * Ver `usaRespaldoEntrePaises`. Quien no lo pasa no nota nada.
   */
  apunte?: { faltaLaSuya?: boolean; faltaLaDeSuTienda?: boolean; faltaLaDeSuCamino?: boolean },
  /**
   * false = sin la guarda del respaldo entre tiendas. Para la presentación de un upsell EN FILA:
   * vive en la ficha del producto, que no lleva tienda, y la tienda ya la eligió la fila
   * (`filaDeLaConversacion`). Con la guarda, apagar el respaldo saltaba los upsells 2, 3, 4…
   */
  conRespaldoDeTienda = true,
  /** EL CAMINO DEL CLIENTE (18/10/2026), para la intro de order bump. Sin pasarlo (o sin
   *  cajones con camino) se sortea como siempre. Ver `etiqueta-de-camino.ts`. */
  caminoDelCliente?: string | null
): SequenceStep[] | null {
  const todosLosEncendidos = (grupos ?? []).filter(
    (g) => g?.enabled !== false && (g?.steps ?? []).length > 0
  );
  // SIN RESPALDO ENTRE TIENDAS Y SIN CAJÓN DE ESTA TIENDA: no sale ninguno (17/10/2026). Se
  // apunta aparte del país, porque quien llama debe pasar a humano (oferta) o seguir con el
  // regalo (upsell), y NO caer en la secuencia de siempre, que tampoco es de esta tienda.
  // Encendido no se dispara nunca: todo sigue como hasta hoy, por las líneas de abajo.
  if (
    conRespaldoDeTienda &&
    !usaRespaldoEntreTiendas(loadWorkflowConfig()) &&
    aLaTiendaLeFaltaLoSuyo(todosLosEncendidos, (g) => tiendasDe(g), laTiendaQueAtiende())
  ) {
    if (apunte) apunte.faltaLaDeSuTienda = true;
    return null;
  }
  // LA TIENDA VA ANTES QUE TODO LO DEMÁS, porque es la que más manda: decide
  // POR QUÉ NÚMERO se está vendiendo, y dentro de eso deciden la forma, el país
  // y el anuncio.
  //
  // Y es la única que EXCLUYE. Si todos los cajones son de otra tienda, aquí se
  // queda la lista vacía y se devuelve null unas líneas más abajo — que es el
  // camino de siempre para «no hay cajones»: quien llama se queda con la
  // secuencia de intro clásica. Nadie se queda sin intro, y a nadie le llega la
  // intro de otra tienda. Ver `soloDeSuTienda`.
  const deSuTienda = soloDeSuTienda(
    todosLosEncendidos,
    (g) => tiendasDe(g),
    laTiendaQueAtiende()
  );
  // LA SEMIMODALIDAD VA DESPUÉS, Y POR ESO SE FILTRA ANTES QUE LA BANDERA.
  //
  // Lo pidió el dueño el 30/09/2026: con el selector en «como hoy», de los
  // cajones encendidos solo deben salir los etiquetados como Lineal — «así las
  // otras estén encendidas, pero la modalidad no corresponde, no debería salir».
  //
  // VA ANTES porque es la más general de las tres: primero se decide con QUÉ
  // forma se está vendiendo, y dentro de eso deciden el país y el anuncio.
  //
  // Y LLEVA LA MISMA RED que la bandera —ver `porSemimodalidad`—: si ninguna
  // etiquetada corresponde, juegan las que no llevan etiqueta, y si tampoco hay,
  // juegan todas. Nadie se queda sin intro por una etiqueta.
  const encendidos = porSemimodalidad(
    deSuTienda,
    (g) => semimodalidadDe(g),
    semimodalidadActiva(loadWorkflowConfig())
  );
  // LA BANDERA ES UNA ETIQUETA, Y SE APLICA COMO LA DEL ANUNCIO.
  //
  // Lo pidió el dueño el 24/09/2026: «la bandera no es solo una etiqueta como la
  // de los ads? mira cómo agregarlo igual». Mismo molde:
  //
  //     los que llevan la bandera del cliente  -> si hay alguno, juegan SOLO ésos
  //     los que no llevan ninguna              -> si no, juegan éstos
  //
  // SIN BANDERAS PUESTAS NO CAMBIA NADA: todos quedan generales y el sorteo por
  // peso decide igual que hasta hoy. Y sin país conocido, tampoco.
  const delCliente = String(pais ?? "").trim().toUpperCase();
  const banderasDe = (g: GrupoDeIntro): string[] =>
    g.pais_routing_enabled === false
      ? []
      : (g.paises ?? [])
          .map((p) => String(p ?? "").trim().toUpperCase())
          .filter(Boolean);
  const deSuPais = encendidos.filter(
    (g) => !!delCliente && banderasDe(g).includes(delCliente)
  );
  // SIN BANDERA NO SE DISPARA.
  //
  // LO PIDIÓ EL DUEÑO el 02/10/2026, y lo repitió cuatro veces: «ahí necesito que se
  // pueda seleccionar banderas en los selectores, SINO NO SE DISPARAN», «con tan solo
  // elegir la bandera ya queda habilitada para lanzarse, si no tiene bandera elegida, no
  // sale».
  //
  // ── QUÉ CAMBIA, Y QUÉ NO ───────────────────────────────────────────────
  //
  // ANTES había tres escalones: los de su país, los GENERALES, y como último respaldo
  // todos los encendidos. Ahora el escalón de los generales DESAPARECE: una pieza sin
  // bandera no entra en el sorteo de nadie.
  //
  // PERO EL ÚLTIMO RESPALDO SE QUEDA, y no es contradecirle. Lo puso una prueba SUYA:
  // con todos los cajones etiquetados y un cliente de un país sin cajón, esto devolvía
  // null — «y un cliente sin intro es una venta perdida segura, mucho peor que una intro
  // que no era para él». Eso sigue siendo verdad. Lo que cambia es de dónde sale ese
  // respaldo: antes podía ser una pieza SIN bandera —justo lo que él no quiere— y ahora
  // solo puede ser una CON bandera, aunque sea de otro país.
  //
  // O sea: lo que no tiene bandera no sale nunca; lo que la tiene puede salvar a un
  // cliente de un país que él todavía no cubrió.
  //
  // ── LO QUE SE MIDIÓ ANTES DE TOCARLO ───────────────────────────────────
  //
  // En lineal —su cancha— tenía 49 pestañas encendidas: 30 con bandera y 19 sin. Las 30
  // cubren Perú, Ecuador y Argentina en lineal, -DOU- y -OB-. Las 19 son restos de otro
  // producto. Se le dijo con los nombres delante antes de encenderlo.
  //
  // ── Y SIN NINGUNA BANDERA PUESTA, NADA CAMBIA ──────────────────────────
  //
  // Es la regla de la casa, la misma que llevan las otras tres etiquetas. Y aquí es
  // obligatoria: esto es una PLANTILLA. Una instalación nueva no tiene ninguna bandera
  // escrita, y sin esta línea el bot nacería mudo — ni una intro, sin ningún error que
  // lo explicara.
  //
  // Lo cazaron sus propias pruebas al primer intento: `prueba-la-bandera-dirige-como-la-
  // etiqueta-de-ads` comprueba desde hace semanas que «el sorteo sale igual con país y
  // sin país». Seguía teniendo razón.
  //
  // O sea: la regla nueva se aplica EN CUANTO ÉL EMPIEZA A ETIQUETAR, que es cuando él
  // la pidió y cuando sirve de algo.
  const conBandera = encendidos.filter((g) => banderasDe(g).length > 0);
  // EL RESPALDO ENTRE PAÍSES SE PUEDE APAGAR (16/10/2026). Lo de abajo no se toca: con el
  // respaldo encendido —o sin el campo— decide exactamente como siempre. Apagado, al cliente
  // de un país sin cajón propio no le llega el de otro. Ver `etiqueta-de-bandera.ts`.
  const faltaLaSuya = conBandera.length > 0 && deSuPais.length === 0;
  if (apunte) apunte.faltaLaSuya = faltaLaSuya;
  if (faltaLaSuya && !usaRespaldoEntrePaises(loadWorkflowConfig())) return null;
  const vivosDeTodosLosCaminos =
    conBandera.length === 0
      ? encendidos
      : deSuPais.length > 0
        ? deSuPais
        : conBandera;
  // Y EL CAMINO, al final (18/10/2026): dentro de lo que quedó, SOLO los de su camino. Sin
  // pasarlo, o sin cajones con camino, es la misma lista. Si su camino no llega aquí, se apunta
  // (quien llama lo deja TRABADO: «mejor se quede trabado… luego reconecto»). Ver
  // `etiqueta-de-camino.ts`.
  const vivos =
    caminoDelCliente === undefined
      ? vivosDeTodosLosCaminos
      : porCamino(vivosDeTodosLosCaminos, (g) => caminosDe(g), caminoDelCliente);
  if (vivos.length === 0 && vivosDeTodosLosCaminos.length > 0 && caminoDelCliente !== undefined) {
    if (apunte) apunte.faltaLaDeSuCamino = true;
    return null;
  }
  if (vivos.length === 0) return null;
  if (vivos.length === 1) return vivos[0].steps ?? null;
  const pesoDe = (g: GrupoDeIntro): number => {
    const p = typeof g.weight === "number" && g.weight > 0 ? g.weight : 1;
    return Math.floor(p);
  };
  const total = vivos.reduce((suma, g) => suma + pesoDe(g), 0);
  if (total <= 0) return vivos[0].steps ?? null;
  // El resto de la semilla reparte igual de bien que un aleatorio y además es
  // estable: la misma conversación cae siempre en el mismo sitio.
  let tirada = Math.abs(Math.floor(semilla)) % total;
  for (const g of vivos) {
    tirada -= pesoDe(g);
    if (tirada < 0) return g.steps ?? null;
  }
  return vivos[vivos.length - 1].steps ?? null;
}

/**
 * QUÉ PUESTO ENTREGA CADA FUENTE.
 *
 * La fuente dice de qué caja salió la entrega; el puesto dice quién la llena.
 * Es la misma tabla que ya usa el reparto, leída al revés.
 */
function puestoDeLaFuente(
  fuente: FuenteDeEntrega | null | undefined
): PuestoDeProducto {
  switch (fuente) {
    case "upsell":
      return "upsell";
    // El combo es la opción cara en las tres modalidades que lo tienen, y el
    // pack de Doble Oferta es lo mismo: los dos productos juntos.
    case "ob_combo":
    case "bioferta_pack":
      return "full";
    case "ob_basico":
    case "bioferta_a":
      return "basico";
    case "bioferta_b":
      return "complementario";
    // La entrega general es la del Único, en Lineal y en Upsell.
    default:
      return "unico";
  }
}

/**
 * ¿ESTA ENTREGA LA LLENA UN PRODUCTO DE LA BIBLIOTECA?
 *
 * PARA QUÉ SIRVE. Cuando una entrega se queda vacía, el bot tiene una red vieja:
 * cae a la entrega general para que el cliente nunca se quede sin nada. Esa red
 * es buena cuando la entrega vacía es un descuido de configuración.
 *
 * Pero si ese puesto lo llena un producto elegido a mano, caer a la general es
 * mandarle a la clienta la entrega de OTRO producto —la que quedó escrita ahí de
 * cuando se vendía otra cosa—. Eso está prohibido: el dueño lo dijo con todas
 * las letras, y tiene razón. Entonces no se cae: se avisa y se para.
 *
 * SIN ALINEACIÓN DEVUELVE FALSE, así que un bot que no use la biblioteca
 * conserva su red intacta y se comporta igual que siempre.
 */
/**
 * LOS PRECIOS QUE LA FICHA DEL PRODUCTO FIJA PARA UN PAÍS.
 *
 * ES LA PRIMERA PALABRA EN TODOS LOS SITIOS DONDE SE RESUELVE UN PRECIO, y por
 * eso vive en UNA sola función: si cada sitio preguntara a su manera, un día uno
 * cobraría distinto que otro y eso no da error — cobra de menos y entrega lo que
 * no es.
 *
 * QUÉ CONTESTA: lo que el dueño escribió en la ficha del producto que juega ese
 * puesto en la modalidad activa, para ESE país. Nada más. Si no hay número, no
 * contesta nada y el que llama sigue con lo de siempre (la capa del país, y
 * detrás el respaldo) — así quien no use las fichas no nota absolutamente nada.
 *
 * POR EL PUESTO, NUNCA POR EL NOMBRE DE LA MODALIDAD. Quién juega cada puesto lo
 * dice `alineacion_por_modalidad`, que es lo que el dueño cambia con su selector.
 * Preguntando así, el precio viaja con el producto: cambia el básico por otro y
 * el importe le sigue, que es justo lo que faltaba.
 *
 * UN NÚMERO QUE NO SEA POSITIVO ES «SIN PONER». Un 0 en la ficha no puede
 * significar «gratis»: significa que ahí no hay precio escrito. Es la misma
 * lectura que hace el resto del archivo con las capas de país.
 */
export function preciosDeLaFichaEnElPais(
  puesto: PuestoDeProducto,
  country: string | null | undefined,
  config?: WorkflowConfig | null,
  /** UPSELLS EN FILA: la oferta de la fila en curso, si la hay. Su ficha es la que juega
   *  de «upsell» para esta conversación, así que sus precios son los que contestan. Sin
   *  ella, todo como siempre. */
  ofertaDeLaFila?: OfertaDeLaFila | null
): { precio?: number; descuento?: number; tachado?: number } {
  if (ofertaDeLaFila && puesto === "upsell") {
    return preciosDeLaOfertaDeLaFila(ofertaDeLaFila, country);
  }
  const cfg = config ?? loadWorkflowConfig();
  if (!cfg || !country) return {};
  // LA TIENDA MANDA AQUÍ TAMBIÉN. Antes leía la alineación general a pelo, así que con
  // una tienda puesta el bot decía el NOMBRE de su producto y el PRECIO de otro. Ver
  // `laAlineacionQueJuega`.
  const id = laAlineacionQueJuega(cfg)?.[puesto];
  if (!id) return {};
  const producto = (cfg.biblioteca_de_productos ?? []).find((p) => p?.id === id);
  const suyos = producto?.precios_por_pais?.[String(country).toUpperCase()];
  if (!suyos) return {};
  const positivo = (n: unknown): number | undefined =>
    typeof n === "number" && Number.isFinite(n) && n > 0 ? n : undefined;
  return {
    precio: positivo(suyos.price_soles),
    descuento: positivo(suyos.discount_price_soles),
    tachado: positivo(suyos.market_price),
  };
}

export function laEntregaLaLlenaUnProducto(
  fuente: FuenteDeEntrega | null | undefined,
  config?: WorkflowConfig | null
): boolean {
  const cfg = config ?? loadWorkflowConfig();
  if (!cfg) return false;
  // Y LA ENTREGA, POR EL MISMO SITIO. Si ésta mirara la alineación general y el reparto la
  // de la tienda, el bot entregaría el material de un producto distinto del que vendió.
  const id = laAlineacionQueJuega(cfg)?.[puestoDeLaFuente(fuente)];
  if (!id) return false;
  return (cfg.biblioteca_de_productos ?? []).some((p) => p?.id === id);
}

/**
 * RESUELVE {{PRODUCTO_ENTREGADO}} EN UN TEXTO DE ENTREGA.
 *
 * Se llama SOLO desde el camino de la entrega, que es el único sitio donde se
 * sabe qué se está entregando. Escrito en cualquier otro campo se queda en
 * blanco —ver el final de `applyProductName`— en vez de salir con las llaves a
 * la vista o, peor, nombrando un producto que no es el que recibió.
 */
export function aplicarProductoEntregado(
  text: string,
  fuente: FuenteDeEntrega | null | undefined,
  config?: WorkflowConfig | null
): string {
  if (!text) return text;
  // NO SE PREGUNTA ANTES CON `.test()`. Un patrón con la bandera `g` se acuerda
  // de dónde se quedó la última vez, así que la segunda llamada empezaría a
  // mitad del texto y diría que no hay comodín cuando sí lo hay. Se reemplaza
  // y ya: si no hay nada que cambiar, devuelve el mismo texto.
  return text.replace(
    PATRON_PRODUCTO_ENTREGADO,
    literal(nombreDelProductoEntregado(fuente, config))
  );
}

/** Una sola escritura del patrón: la usan el resolutor y el borrado del final
 *  de `applyProductName`, y si se separaran una podría dejar pasar lo que la
 *  otra cambia. */
const PATRON_PRODUCTO_ENTREGADO =
  /\{{1,2}\s*(producto_entregado|producto_de_la_entrega|lo_que_compro)\s*\}{1,2}/gi;

/**
 * Nombre del TERCER producto, el del upsell (comodín {{PRODUCTO_UPSELL}}).
 *
 * Sale de la sección del producto extra de la modalidad activa, que es donde se
 * escribe. Fuera de las modalidades que lo tienen no hay tercer producto, así
 * que devuelve vacío: es preferible un hueco a nombrar algo que no se vende.
 */
export function getProductNameUpsell(): string {
  return seccionUpsell()?.name?.trim() || "";
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
  // El del TERCER producto va primero: "producto_upsell" empieza por
  // "producto", así que si se sustituyera después ya no quedaría nada que
  // reemplazar — el de abajo se habría comido su principio.
  const rendered = text
    .replace(
      /\{{1,2}\s*(producto_upsell|producto3|producto_3)\s*\}{1,2}/gi,
      literal(getProductNameUpsell())
    )
    // EL SEGUNDO PRODUCTO, CON UN NOMBRE QUE NO SE CONFUNDE.
    //
    // Se llamaba solo `producto2`, y a un guion bajo de distancia vive
    // `producto_2`, que es OTRA cosa: el nombre de la opción 2 de las
    // modalidades de dos opciones. Dos datos distintos con nombres casi
    // iguales, y el que se equivocaba no rompía nada — el bot nombraba el
    // producto que no era y seguía tan tranquilo.
    //
    // SE LLAMA "SECUNDARIO" Y NO "COMPLEMENTARIO" a propósito: este campo es
    // uno solo para todo el bot, pero su papel cambia según la modalidad. En
    // Order Bump es el complemento que se suma al básico; en Doble Oferta +
    // Upsell es el producto BASE, y el principal es el full. Un nombre que
    // describa el papel miente en alguna modalidad; "segundo producto" es lo
    // único cierto en todas — y es como ya lo llama el editor.
    //
    // EL COMPLEMENTO, QUE SOLO EXISTE EN ORDER BUMP.
    //
    // Va SEPARADO del grupo de abajo. Antes compartía significado con
    // `producto_secundario`, así que en Doble Oferta + Upsell escribir
    // "complementario" devolvía la BASE: un nombre que miente, y encima creíble.
    // Ahora, donde no hay complemento, no devuelve nada.
    .replace(
      /\{{1,2}\s*(producto_complementario|producto_complemento|complemento)\s*\}{1,2}/gi,
      literal(nombresDeLosProductos().complementario)
    )
    // LA BASE Y EL FULL, EMPATADOS ENTRE MODALIDADES.
    //
    // Mismo comodín en Order Bump y en Doble Oferta + Upsell; cada una lo
    // resuelve con SU campo (ver `nombresDeLosProductos`). Van antes que el
    // genérico `producto` porque empiezan igual y se lo comería.
    .replace(
      /\{{1,2}\s*(producto_base|producto_basico)\s*\}{1,2}/gi,
      literal(nombresDeLosProductos().base)
    )
    .replace(
      /\{{1,2}\s*producto_full\s*\}{1,2}/gi,
      literal(nombresDeLosProductos().full)
    )
    // `producto_secundario` y `producto2` NO se tocan: son el campo de siempre,
    // y hay 125 textos escritos con ellos. Sirven igual que ayer.
    .replace(
      /\{{1,2}\s*(producto_secundario|producto2)\s*\}{1,2}/gi,
      literal(getProductName2())
    )
    .replace(/\{{1,2}\s*producto\s*\}{1,2}/gi, literal(getProductName()))
    // EL DE LA ENTREGA, SI LLEGÓ HASTA AQUÍ SIN RESOLVER.
    //
    // `{{PRODUCTO_ENTREGADO}}` lo resuelve el camino de la entrega, que es el
    // único que sabe qué se está entregando. Escrito en cualquier otro campo
    // —una intro, un seguimiento— no hay nada que preguntar, así que se borra.
    //
    // Se borra y no se deja pasar: un comodín crudo le sale al cliente con las
    // llaves puestas, y eso sí que se ve. Va el ÚLTIMO para no pisar al de la
    // entrega, que ya lo cambió antes si tocaba.
    .replace(PATRON_PRODUCTO_ENTREGADO, "");
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
  const config = loadWorkflowConfig();
  const dynamicFields = config?.dynamic_fields;
  const placeholders = config?.custom_placeholders;
  let out = text;
  if (Array.isArray(dynamicFields)) {
    for (const field of dynamicFields) {
      const key = normalizeCustomPlaceholderKey(field?.key);
      const value = dynamicFieldValue(field, config);
      if (!key || !value) continue;
      out = out.replace(
        new RegExp(`\\{\\{\\s*${key.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\s*\\}\\}`, "gi"),
        literal(value)
      );
    }
  }
  if (!Array.isArray(placeholders) || placeholders.length === 0) return out;
  for (const item of placeholders) {
    const key = normalizeCustomPlaceholderKey(item?.key);
    const value = typeof item?.value === "string" ? item.value : "";
    if (!key || !value) continue;
    out = out.replace(
      new RegExp(`\\{\\{\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\}\\}`, "gi"),
      literal(value)
    );
  }
  return out;
}

function dynamicFieldValue(
  field: DynamicField | undefined,
  config: WorkflowConfig | null
): string {
  if (!field || !config) return "";
  switch (field.source) {
    case "product_name": return config.product_name ?? "";
    case "product_name_2": return config.product_name_2 ?? "";
    case "course_content": return config.course_content ?? "";
    case "course_content_2": return config.course_content_2 ?? "";
    case "payment_text": return config.payment_text ?? "";
    case "payment_buttons_prompt": return config.payment_buttons_prompt ?? "";
    default: return field.manual_value ?? "";
  }
}

export function resolveSpintax(
  text: string,
  chooseIndex?: (options: string[], groupIndex: number) => number
): string {
  if (!text || !text.includes("|")) return text;
  const protectedPlaceholders: string[] = [];
  const protectedText = text.replace(/\{\{[^{}\n]+\}\}/g, (match) => {
    const token = `__WF_PLACEHOLDER_${protectedPlaceholders.length}__`;
    protectedPlaceholders.push(match);
    return token;
  });
  let groupIndex = 0;
  const resolved = protectedText.replace(
    /\{([^{}\n]*\|[^{}\n]*)\}/g,
    (match, body: string) => {
      const options = body.split("|");
      if (options.length < 2) return match;
      const rawIndex =
        chooseIndex?.(options, groupIndex) ??
        Math.floor(Math.random() * options.length);
      groupIndex += 1;
      const index = ((rawIndex % options.length) + options.length) % options.length;
      return options[index] ?? "";
    }
  );
  return resolved.replace(
    /__WF_PLACEHOLDER_(\d+)__/g,
    (match, index: string) => protectedPlaceholders[Number(index)] ?? match
  );
}

type GalleryItemOut = {
  topic: string;
  keywords: string[];
  when: string;
  media_type: "image" | "video" | "document" | "audio";
  drive_url: string;
  caption: string;
  /** DE QUÉ PRODUCTO ES ESTA MUESTRA.
   *
   *  Al modelo se le enseñaba la lista de temas a secas. Con un solo producto
   *  daba igual; con dos, un «¿qué contiene?» genérico le dejaba elegir a
   *  ciegas y mandaba la muestra del producto equivocado — el fallo se ve en el
   *  chat y no en ningún log.
   *
   *  Vacío cuando la galería no es de un producto concreto. */
  product: string;
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
        caption_variants?: string[];
        enabled?: boolean;
        /** BURBUJAS EXTRA DE ESTA MISMA MUESTRA. Salen JUSTO DETRÁS del archivo y
         *  antes de la siguiente muestra: son parte de ella, no otra. Vacío = la
         *  muestra es solo su archivo con su pie, como fue siempre. */
        pasos_extra?: SequenceStep[];
      }[]
    | undefined,
  /** El producto dueño de esta galería. Se pega a cada muestra para que quien
   *  la lea sepa de cuál es sin tener que adivinarlo por el tema. */
  producto = ""
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
      caption:
        pickVariant(
          Array.isArray(x.caption_variants) ? x.caption_variants : undefined,
          (x.caption ?? "").trim()
        )?.trim() ?? "",
      product: producto.trim(),
    }));
}

/** Items VÁLIDOS de la galería. El bot manda por `topic`.
 *  Doble Oferta 2 Productos: producto 1 + producto 2, sin pack.
 *  Order Bump / Bioferta: conserva la mecánica de complemento + pack. */
export function getImageGallery(
  excludeSecondProduct = false,
  /**
   * MIENTRAS EL SEGUNDO PRODUCTO ESTÁ EN OFERTA, LA GALERÍA ES LA SUYA.
   *
   * Sin esto pasó lo siguiente: el bot ofrece el producto extra, el cliente
   * pregunta «¿qué contiene?», y le llega la foto del producto que ACABA DE
   * COMPRAR — con una invitación a comprarlo otra vez.
   *
   * Y no es un fallo raro: la galería del principal tiene como palabras clave
   * «¿qué trae?», «¿qué incluye?», que es exactamente lo que uno pregunta
   * cuando le presentan algo nuevo. Así que acierta siempre, y siempre con el
   * producto equivocado.
   *
   * Si el extra no tiene galería propia, se devuelve VACÍA. Callar es correcto
   * aquí: mejor no mandar nada que mandar lo que ya compró.
   */
  convo?: { upsell_state?: string | null } | null
): GalleryItemOut[] {
  const cfg = loadWorkflowConfig();
  const enOferta =
    convo?.upsell_state === "ofrecido" || convo?.upsell_state === "aceptado";
  // CADA MUESTRA SALE CON EL NOMBRE DE SU PRODUCTO.
  //
  // Los nombres salen SIEMPRE del contenido, nunca escritos aquí: esto es una
  // plantilla y el código no conoce ningún producto. Vacío = la muestra sale
  // sin dueño, igual que antes.
  const nombreDelPack =
    cfg?.order_bump?.combo?.name?.trim() ||
    cfg?.bioferta_doble?.pack?.name?.trim() ||
    "";
  if (enOferta) {
    return normalizeGallery(
      seccionUpsell(cfg)?.image_gallery,
      seccionUpsell(cfg)?.name?.trim() ?? ""
    );
  }
  const base = normalizeGallery(
    cfg?.image_gallery,
    cfg?.product_name?.trim() ?? ""
  );
  // Order bump DIFERIDO: el bot aún no debe conocer el 2º producto → solo la
  // galería del producto principal (sin complemento ni pack).
  if (excludeSecondProduct) return base;
  // QUÉ CAJAS MIRA ESTA MODALIDAD — se lo pregunta a la tabla que las llena.
  // Ver `cajasDeMuestraDeLaModalidad`: ahí está el fallo que lo puso aquí.
  //
  // SE SUMA A LAS BANDERAS DE ANTES, no las sustituye. Las tres seguían siendo
  // ciertas donde lo eran, y quitarlas podría dejar sin muestras a una
  // instalación que no use el reparto por fichas y tenga esas cajas llenas a
  // mano. Con el `||`, esto solo puede AÑADIR una caja, nunca esconder una.
  const cajasDeLaModalidad = cajasDeMuestraDeLaModalidad(cfg);
  // La galería del 2º producto aplica en doble oferta 2 productos y también
  // en las mecánicas antiguas donde funciona como complemento.
  const second =
    cajasDeLaModalidad.segunda ||
    cfg?.doble_oferta_dos?.enabled ||
    cfg?.bioferta_doble?.enabled ||
    cfg?.order_bump?.enabled
      ? normalizeGallery(cfg?.image_gallery_2, cfg?.product_name_2?.trim() ?? "")
      : [];
  // Galería de pack: NO aplica en Doble Oferta 2 Productos.
  const pack =
    cajasDeLaModalidad.pack ||
    cfg?.bioferta_doble?.enabled ||
    cfg?.order_bump?.enabled
      ? normalizeGallery(cfg?.pack_gallery, nombreDelPack)
      : [];
  // EL ORDEN LO MANDA EL PUESTO, NO LA CAJA EN QUE ESTÉ GUARDADO.
  //
  // LO QUE PIDIÓ EL DUEÑO — 17 de septiembre de 2026, con sus palabras: «el bot
  // debe enviar en orden las imágenes siempre arrancando desde el BÁSICO, si hay
  // un COMPLEMENTARIO sigue ese, y si hay un FULL que complemente esto —como en
  // el caso de OB— que aparezca AL ÚLTIMO».
  //
  // POR QUÉ HACÍA FALTA. Las tres cajas salían siempre en el mismo orden —la del
  // hueco 1, la del hueco 2, la del pack— y QUIÉN ocupa cada hueco cambia con la
  // modalidad. En Order Bump y en Bioferta el hueco 1 es el básico, así que ya
  // salía como él quiere. Pero en las dos Doble Oferta el hueco 1 es el FULL —lo
  // dice `CONTENIDO_DEL_PUESTO` y la pestaña del editor: ahí el «Producto 1» es
  // el más caro— y las muestras salían al revés: primero el combo y después el
  // básico. Enseñar primero lo caro es empezar la presentación por el final.
  //
  // NO SE ORDENA POR MODALIDAD, y es a propósito. Una lista de modalidades
  // escrita a mano es el fallo que ya costó tres veces esta semana: siempre se
  // olvida una. Aquí se pregunta por el DATO —qué puesto ocupa cada caja— y el
  // orden sale solo en las seis, hoy y cuando el dueño cambie la alineación.
  //
  // EL PACK ES DEL FULL por definición: esa caja se llena con la galería del
  // producto que juega de full cuando el full no tiene hueco propio. Por eso
  // comparte su rango y cierra.
  //
  // EMPATE = COMO ESTABA. El orden de JavaScript es estable, así que dos cajas
  // del mismo rango conservan el orden de siempre y nada se mueve por azar.
  const RANGO_DEL_PUESTO: Partial<Record<PuestoDeProducto, number>> = {
    basico: 1,
    unico: 1,
    complementario: 2,
    full: 3,
  };
  const huecos = cfg ? tablaDeHuecos(activeModalityKey(cfg), cfg) : {};
  const puestoDelHueco = (hueco: 1 | 2): PuestoDeProducto | undefined =>
    (Object.keys(huecos) as PuestoDeProducto[]).find(
      (puesto) => huecos[puesto] === hueco
    );
  // Un puesto que no esté en la tabla va al final y no se cuela delante de nadie.
  const rango = (puesto: PuestoDeProducto | undefined): number =>
    (puesto ? RANGO_DEL_PUESTO[puesto] : undefined) ?? 9;
  return [
    { orden: rango(puestoDelHueco(1)), muestras: base },
    { orden: rango(puestoDelHueco(2)), muestras: second },
    { orden: RANGO_DEL_PUESTO.full ?? 3, muestras: pack },
  ]
    .sort((una, otra) => una.orden - otra.orden)
    .flatMap((caja) => caja.muestras);
}

/**
 * TODOS LOS TEMAS DE MUESTRA QUE EXISTEN, DE CUALQUIER ETAPA.
 *
 * `getImageGallery` devuelve solo los de LA ETAPA en la que va la conversación,
 * y eso está bien: mientras el cliente elige, la muestra del segundo producto
 * todavía no le corresponde. Pero entonces «no está en la galería de ahora» y
 * «no existe en ninguna parte» se ven igual, y son cosas muy distintas:
 *
 *   · la primera es normal —le toca en otra etapa— y no debe romper nada;
 *   · la segunda es un error de configuración y sí hay que avisarlo.
 *
 * Esto permite distinguirlas. Nombres en minúsculas, que es como se comparan.
 */
export function temasDeMuestraDeCualquierEtapa(): Set<string> {
  const cfg = loadWorkflowConfig();
  const temas = [
    ...(cfg?.image_gallery ?? []),
    ...(cfg?.image_gallery_2 ?? []),
    ...(cfg?.pack_gallery ?? []),
    ...(seccionUpsell(cfg)?.image_gallery ?? []),
  ].map((item) => String(item?.topic ?? "").trim().toLowerCase());
  return new Set(temas.filter(Boolean));
}

/**
 * LA BURBUJA CON LA QUE EL BOT OFRECE ENSEÑAR LAS MUESTRAS.
 *
 * LA PONE EL MOTOR, Y ESO ES EL ARREGLO. Se le pidió al modelo que la escribiera
 * él y salió 4 veces de 11 —él las contó—; y antes, con un marcador, 1 de 6. En
 * un prompt de 8.500 tokens una orden compite con todo lo demás. Puesta aquí
 * sale SIEMPRE.
 *
 * NO ES UN TEXTO FIJO DISFRAZADO: admite variantes `{a|b|c}`, igual que el resto
 * del contenido, así que suena distinto cada vez y lo escribe él. El dueño lo
 * aprobó expresamente —es la excepción que su propia regla de «no taparlo con
 * textos fijos» contempla— después de ver los números.
 *
 * SE BUSCA EN TRES SITIOS Y GANA EL PRIMERO CON TEXTO DE VERDAD: la plantilla de
 * la modalidad, la raíz, y por último uno por defecto para que funcione desde el
 * primer minuto. Lo de «con texto de verdad» no es un detalle: en este proyecto
 * un campo vacío por modalidad ha tapado el de la raíz más de una vez.
 */
const OFERTA_DE_MUESTRAS_POR_DEFECTO =
  "{¿Deseas ver unas imágenes del contenido?|¿Te muestro unas imágenes de lo que incluye?|¿Quieres que te enseñe unas fotos del material?}";

export function getSamplesOfferBubble(): string {
  const config = loadWorkflowConfig();
  const mode = config ? activeModalityKey(config) : null;
  const candidatos = [
    mode ? config?.modality_templates?.[mode]?.samples_offer_bubble : undefined,
    config?.samples_offer_bubble,
    OFERTA_DE_MUESTRAS_POR_DEFECTO,
  ];
  const elegida = candidatos.find(
    (texto) => typeof texto === "string" && texto.trim().length > 0
  );
  return resolveSpintax((elegida ?? "").trim());
}

/** Cierre editable al terminar las muestras del producto de la modalidad activa. */
export function getSamplesAfterSequence(): SequenceStep[] {
  const config = loadWorkflowConfig();
  if (!config) return [];
  const mode = activeModalityKey(config);
  return (
    config.modality_templates?.[mode]?.samples_after_sequence ??
    config.samples_after_sequence ??
    []
  );
}


/**
 * EL TOPE DE MENSAJES DEL MES PARA LOS ORGÁNICOS. Ver `organicos_tope_mensajes`.
 * Sin escribir = 950. Un número entero de 0 en adelante; 0 = no contestar nunca.
 */
export function topeDeOrganicos(
  config: { organicos_tope_mensajes?: unknown } | null | undefined
): number {
  const v = config?.organicos_tope_mensajes;
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 950;
}