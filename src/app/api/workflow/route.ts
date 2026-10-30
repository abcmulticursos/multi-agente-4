import { NextResponse, type NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
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
  topeDeOrganicos,
} from "@/lib/workflow/config";
import { writeTextFileAtomically } from "@/lib/product-profiles";
// LA PIZARRA: se lee y se escribe con la MISMA función. Ver `lee-pizarra.ts`.
import { leePizarra } from "@/lib/editor/lee-pizarra";
import { leeTableros, leeTablerosPorTienda } from "@/lib/tablero/datos";
import { leeCamino, leeTambienEnCaminos } from "@/lib/workflow/etiqueta-de-camino";
import {
  DEFAULT_PAYMENT_BUTTONS_PROMPT,
  DEFAULT_CHOICE_PROMPT,
  DEFAULT_CHOICE_BUTTONS_PROMPT,
  DEFAULT_BIOFERTA_ASK_CHOICE_TEXT,
  DEFAULT_BIOFERTA_INTRO_CHOICE_PROMPT,
  DEFAULT_DELIVERY_PREFERENCE_PROMPT,
  DEFAULT_DELIVERY_PREFERENCE_BUTTONS_PROMPT,
  DEFAULT_DELIVERY_WHATSAPP_LABEL,
  DEFAULT_DELIVERY_EMAIL_LABEL,
  DEFAULT_ROUTE_B_POST_PAYMENT_PROMPT,
  DEFAULT_MODERACION_DESPEDIDA,
} from "@/lib/workflow/defaults";

// Texto por defecto que acompaña a los botones (lo mismo que usa el motor).
/**
 * SEMILLA de un texto del editor: si la clave NO EXISTE todavía, el campo llega
 * relleno con el texto de arranque para que se pueda leer y editar. Si existe
 * —aunque esté vacía— se respeta tal cual: vaciar un campo a propósito es la
 * forma de APAGAR esa burbuja, y la semilla no debe resucitarla.
 */
const semilla = (valor: unknown, arranque: string): string =>
  valor === undefined || valor === null ? arranque : str(valor);

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

/**
 * EL SEGURO: UN GUARDADO NO PUEDE VACIAR EN SILENCIO LO QUE TENÍA CONTENIDO.
 *
 * PASÓ DE VERDAD, Y FUE FEO. Un guardado del editor dejó en blanco, de una vez:
 * el contenido del producto, su galería, las marcas de «Info de contenido», las
 * dos intros, los tres seguimientos, la entrega de pago aprobado y las muestras
 * tras la intro. Y encima la plantilla de esa modalidad. Sin un aviso, sin un
 * error: el editor dijo «guardado» y el trabajo de semanas ya no estaba.
 *
 * La causa fue el sistema de plantillas por modalidad: al encender otra
 * modalidad se carga SU plantilla encima de la pantalla, y al guardar, esa
 * plantilla —vacía— se escribió sobre lo vivo.
 *
 * Arreglar esa causa concreta no basta. Cualquier camino que deje la pantalla a
 * medias —una carga a medio terminar, un navegador con la sesión vieja, un
 * cambio futuro— produce el mismo desastre y nadie se entera hasta que el bot
 * deja de responder.
 *
 * POR ESO EL SEGURO VA AQUÍ, en el servidor, y no en la pantalla: aquí pasan
 * TODOS los guardados, vengan de donde vengan, y no se puede saltar con un
 * navegador viejo.
 *
 * Cómo funciona: se compara lo que hay guardado con lo que se pretende
 * escribir. Si una sección que TENÍA contenido va a quedar VACÍA, no se guarda
 * nada: se devuelve la lista de lo que se perdería y se pide confirmación
 * expresa. Nunca decide por su cuenta — solo obliga a que sea a propósito.
 */
const SECCIONES_VIGILADAS: Array<[clave: string, nombre: string]> = [
  ["product_name", "Nombre del producto 1"],
  ["course_content", "Contenido del producto 1"],
  ["image_gallery", "Galería del producto 1"],
  ["product_name_2", "Nombre del producto 2"],
  ["course_content_2", "Contenido del producto 2"],
  ["image_gallery_2", "Galería del producto 2"],
  ["pack_gallery", "Galería del pack"],
  ["product_info_topics", "Info de contenido (lo marcado)"],
  ["samples_after_sequence", "Muestras después de la intro"],
  ["intro_sequence", "Intro"],
  ["intro_sequence_2", "Intro 2"],
  ["intro_sequence_3", "Intro 3"],
  ["followup_sequences", "Seguimientos"],
  ["payment_approved_sequence", "Entrega «Pago aprobado»"],
  ["payment_responses", "Respuestas de los métodos de pago"],
  ["payment_profiles_by_country", "Datos de pago por país"],
  ["modality_payment_profiles", "Datos de pago por modalidad"],
  ["gift_mechanic", "Regalo"],
  ["order_bump", "Order Bump"],
  ["bioferta_doble", "Doble Oferta"],
  ["doble_oferta_dos", "Doble Oferta 2 Productos"],
  ["doble_oferta_upsell", "Doble Oferta + Upsell"],
  ["upsell", "Upsell"],
  ["greeting", "Saludo"],
];

/**
 * Cuánto contenido de verdad hay dentro. No vale con "existe": un arreglo de
 * cinco pasos VACÍOS pesa cero, y quedarse con eso también es perderlo todo.
 * Cuenta solo hojas con algo escrito, y se para a 6 niveles para no perderse en
 * una estructura profunda.
 */
function pesoDeContenido(valor: unknown, nivel = 0): number {
  if (valor == null || nivel > 6) return 0;
  if (typeof valor === "string") return valor.trim() ? 1 : 0;
  if (typeof valor === "number") return valor !== 0 ? 1 : 0;
  if (typeof valor === "boolean") return 0; // un interruptor no es contenido
  if (Array.isArray(valor)) {
    return valor.reduce<number>((s, v) => s + pesoDeContenido(v, nivel + 1), 0);
  }
  if (typeof valor === "object") {
    return Object.values(valor as Record<string, unknown>).reduce<number>(
      (s, v) => s + pesoDeContenido(v, nivel + 1),
      0
    );
  }
  return 0;
}

/**
 * VACIARSE ARRIBA NO ES PERDERSE.
 *
 * Los campos de arriba son la PROYECCIÓN de la modalidad que vende: el bot lee
 * de ahí. El contenido de verdad vive en `modality_templates`, una capa por
 * modalidad.
 *
 * Así que al pasar a vender una modalidad que no tiene cierto campo —Lineal no
 * tiene «Producto 2», por ejemplo— ese campo se vacía ARRIBA a propósito, y su
 * contenido sigue entero en la capa de la modalidad que lo tenía. Avisar ahí es
 * una falsa alarma, y una que sale cada vez que se cambia de modalidad: el aviso
 * que siempre es mentira acaba ignorándose, y el día que sea verdad también.
 *
 * Y se mira UNA capa concreta: la de la modalidad que estaba vendiendo antes,
 * que es de quien era ese contenido. Buscar en «alguna» capa sería demasiado
 * flojo: cualquier modalidad con un nombre puesto en ese campo callaría la
 * pérdida del de otra, que no tiene nada que ver.
 *
 * Se pide además que pese IGUAL O MÁS, para que un resto no calle una pérdida.
 *
 * Las claves de arriba y las de la capa no siempre se llaman igual; las que no,
 * van en la tabla. Una sección sin equivalente en la capa nunca se calla — se
 * comporta exactamente como antes.
 */
const CLAVE_EN_LA_CAPA: Record<string, string> = {
  followup_sequences: "followups",
  payment_approved_sequence: "payment_approved",
  gift_mechanic: "gift",
  bioferta_doble: "bioferta",
};

/**
 * Qué modalidad vende, leyendo el documento. Es la misma escalera del motor
 * (`activeModalityKey`), con las claves tal y como se llaman en el yaml.
 */
function modalidadQueVende(doc: Record<string, unknown>): string {
  const encendida = (clave: string): boolean => {
    const seccion = doc[clave] as { enabled?: unknown } | undefined;
    return !!seccion && typeof seccion === "object" && seccion.enabled === true;
  };
  if (encendida("doble_oferta_upsell")) return "doble_oferta_upsell";
  const modalidadUpsell = doc.upsell_modalidad_enabled;
  if (
    typeof modalidadUpsell === "boolean" ? modalidadUpsell : encendida("upsell")
  ) {
    return "upsell";
  }
  if (encendida("doble_oferta_dos")) return "doble_oferta_dos";
  if (encendida("order_bump")) return "order_bump";
  if (encendida("bioferta_doble")) return "bioferta";
  return "lineal";
}

function sigueGuardadoEnSuCapa(
  clave: string,
  peso: number,
  antes: Record<string, unknown>,
  despues: Record<string, unknown>
): string | null {
  // SOLO CUANDO EL GUARDADO CAMBIA LA MODALIDAD QUE VENDE.
  //
  // Si sigue vendiendo la misma y su campo se vacía arriba, NO hay proyección
  // que lo explique: la proyección copia hacia arriba lo que tiene la capa, así
  // que «arriba vacío y capa llena» no puede salir del camino normal. Eso es una
  // anomalía y hay que avisar — es justo la forma del desastre que este seguro
  // existe para atrapar.
  const duenna = modalidadQueVende(antes);
  if (duenna === modalidadQueVende(despues)) return null;
  const capas = (despues.modality_templates ?? {}) as Record<string, unknown>;
  const capa = capas[duenna];
  if (!capa || typeof capa !== "object") return null;
  const guardado = (capa as Record<string, unknown>)[
    CLAVE_EN_LA_CAPA[clave] ?? clave
  ];
  return pesoDeContenido(guardado) >= peso ? duenna : null;
}

/** Las secciones que TENÍAN contenido y quedarían VACÍAS. Vacío = nada que avisar. */
function seccionesQueSeVaciarian(
  antes: Record<string, unknown>,
  despues: Record<string, unknown>
): string[] {
  const perdidas: string[] = [];
  for (const [clave, nombre] of SECCIONES_VIGILADAS) {
    const peso = pesoDeContenido(antes[clave]);
    if (peso > 0 && pesoDeContenido(despues[clave]) === 0) {
      const capa = sigueGuardadoEnSuCapa(clave, peso, antes, despues);
      if (capa) {
        console.log(
          `[wf:guardar] "${nombre}" se vacía arriba pero sigue guardado en la capa «${capa}» — no es una pérdida, no aviso`
        );
        continue;
      }
      perdidas.push(nombre);
    }
  }
  // Las plantillas, una por una. El desastre borró SOLO una de las cinco: si se
  // mirara el bloque entero seguiría pesando mucho y no saltaría ninguna alarma.
  const plantillasAntes = (antes.modality_templates ?? {}) as Record<string, unknown>;
  const plantillasDespues = (despues.modality_templates ?? {}) as Record<string, unknown>;
  for (const modalidad of Object.keys(plantillasAntes)) {
    if (
      pesoDeContenido(plantillasAntes[modalidad]) > 0 &&
      pesoDeContenido(plantillasDespues[modalidad]) === 0
    ) {
      perdidas.push(`Todo el contenido guardado de la modalidad «${modalidad}»`);
    }
  }
  return perdidas;
}

type StepType = "text" | "image" | "audio" | "video" | "document";
type GalleryMediaType = "image" | "video" | "document" | "audio";
type BubbleButtonAction =
  | "send_steps"
  | "send_payment_method"
  | "show_payment"
  | "choose_combo"
  | "choose_basico"
  | "choose_upsell"
  | "decline_upsell"
  | "show_order_bump"
  | "accept_gift"
  | "decline_gift"
  | "claim_gift"
  | "human"
  | "start_workflow";

/** Las acciones de botón que se leen tal cual del archivo. Las mismas que ofrece el editor. */
const ACCIONES_DE_BOTON: BubbleButtonAction[] = [
  "send_payment_method",
  "show_payment",
  "choose_combo",
  "choose_basico",
  "choose_upsell",
  "decline_upsell",
  "show_order_bump",
  "accept_gift",
  "decline_gift",
  "claim_gift",
  "human",
  "start_workflow",
];

type DecisionAction =
  | "choose_combo"
  | "choose_basico"
  /** El segundo producto, el de después de la venta. */
  | "choose_upsell"
  | "send_payment_method"
  | "show_payment"
  /** La intro de la oferta de 2 opciones. */
  | "show_order_bump"
  /** El regalo: aceptarlo, rechazarlo, entregarlo. */
  | "accept_gift"
  | "decline_gift"
  | "claim_gift"
  | "human"
  | "start_workflow";

// ESTA LISTA ES EL FILTRO: lo que no esté aquí se descarta al guardar y el
// cuadrito aparece sin link la próxima vez que se abra el editor.
const LINKS_DE_DECISION: DecisionAction[] = [
  "choose_combo",
  "choose_basico",
  "choose_upsell",
  "send_payment_method",
  "show_payment",
  "show_order_bump",
  "accept_gift",
  "decline_gift",
  "claim_gift",
  "human",
  "start_workflow",
];

interface EditorBubbleDecision {
  id: string;
  /** false = apagada. Con todas apagadas, la burbuja no espera respuesta. */
  enabled?: boolean;
  title?: string;
  keywords?: string[];
  steps?: EditorStep[];
  color?: string;
  /** A qué está linkeado. Se ejecuta DESPUÉS de sus burbujas. */
  action?: DecisionAction;
  /** Para "send_payment_method": qué método manda, nunca sus datos. */
  payment_method?: string;
  /** Para "start_workflow": cuál. */
  workflow_id?: string;
}

interface EditorBubbleButton {
  id: string;
  label: string;
  action: BubbleButtonAction;
  steps?: EditorStep[];
  /** Para "send_payment_method": QUÉ método manda, no una copia de sus datos.
   *  Sus datos viven en Precios y pagos, por país. */
  payment_method?: string;
  /** Para "start_workflow": cuál. */
  workflow_id?: string;
}

interface EditorStep {
  type: StepType;
  drive_url: string;
  texts: string[];
  delay_after_sec: number;
  /** false = burbuja apagada (el bot no la envía). Por defecto true. */
  enabled?: boolean;
  buttons?: EditorBubbleButton[];
  decisions?: EditorBubbleDecision[];
  /** Minutos que ESTA burbuja espera una elección. Vacío = 3. Ver config.ts. */
  espera_eleccion_minutos?: number;
  /** true = lo que conteste a esta burbuja se guarda como su nombre. */
  capturar_nombre?: boolean;
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
  ad_keys?: string[];
  /** El interruptor de la etiqueta: deja los ads escritos y apaga el dirigir. */
  ad_routing_enabled?: boolean;
  /** La bandera viaja igual que la etiqueta de ads, y por el mismo carril. */
  paises?: string[];
  pais_routing_enabled?: boolean;
  /** La semimodalidad: «lineal», «dou» u «ob». Vacío = general. */
  semimodalidad?: string;
  /** Las tiendas que reciben este cajón, por id. Vacío = todas. */
  tiendas?: string[];
  /** Su peso en el sorteo del seguimiento (17/10/2026). Ausente = 1. */
  weight?: number;
  /** Su camino (18/10/2026). Vacío = el principal. Ver `etiqueta-de-camino.ts`. */
  camino?: string;
  /** Los otros caminos que también pasan por esta ficha (PRINCIPAL = el principal). */
  tambien_en_caminos?: string[];
}

interface EditorFollowup {
  name: string;
  delay_minutes_from_first_message: number;
  steps: EditorStep[];
  enabled?: boolean;
  /** Toggles de horario propios de este seguimiento (default apagados). */
  ignore_quiet_hours?: boolean;
  ignore_late_lead_defer?: boolean;
  /** Apaga solo los «Mensajes principales»; las variantes siguen vivas. */
  steps_enabled?: boolean;
  /** El peso de los «Mensajes principales» en el sorteo (17/10/2026). Ausente = 1. */
  steps_weight?: number;
  ad_keys?: string[];
  /** El interruptor de la etiqueta: deja los ads escritos y apaga el dirigir. */
  ad_routing_enabled?: boolean;
  paises?: string[];
  pais_routing_enabled?: boolean;
  /** La semimodalidad: «lineal», «dou» u «ob». Vacío = general. */
  semimodalidad?: string;
  /** Las tiendas de este seguimiento, por id. Vacío = todas. Sus cajones la
   *  heredan si no traen la suya, igual que la bandera. */
  tiendas?: string[];
  variants?: EditorFollowupVariant[];
  offer_choice_menu_enabled?: boolean;
  payment_menu?: EditorPaymentMenu;
}

function normalizeType(t: unknown): StepType {
  return t === "image" || t === "audio" || t === "video" || t === "document"
    ? t
    : "text";
}

/**
 * Los items de una galería, sin decidir dónde se guardan. La galería del
 * upsell vive DENTRO de su sección, no en la raíz, así que necesita esto
 * suelto — `writeGallery` escribe siempre en una clave de primer nivel.
 */
function galleryItems(arr: unknown) {
  if (!Array.isArray(arr)) return [];
  return (arr as Record<string, unknown>[])
    .map((g) => ({
      topic: str(g?.topic),
      keywords: strList(g?.keywords)
        .map((k) => k.trim())
        .filter(Boolean),
      when: str(g?.when).replace(/\r\n/g, "\n"),
      media_type: normalizeGalleryMediaType(g?.media_type),
      drive_url: str(g?.drive_url),
      caption: str(g?.caption).replace(/\r\n/g, "\n"),
      caption_variants: strList(g?.caption_variants).map((value) =>
        value.replace(/\r\n/g, "\n")
      ),
      pasos_extra: Array.isArray(g?.pasos_extra)
        ? (g.pasos_extra as EditorStep[]).map(writeStep)
        : [],
      ...(g?.enabled === false ? { enabled: false } : {}),
    }))
    .filter((g) => g.topic.trim() || g.drive_url.trim());
}

function normalizeGalleryMediaType(t: unknown): GalleryMediaType {
  return t === "video" || t === "document" || t === "audio" ? t : "image";
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** ¿Es un objeto con llaves, y no un array ni null? Lo usa la alineación. */
function esMapa(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** El botón May / Min / Off de cada precio. Cualquier otra cosa se descarta:
 *  un valor raro aquí saldría en el mensaje de un cliente. */
function estiloDeMoneda(v: unknown): "upper" | "lower" | "off" | undefined {
  return v === "upper" || v === "lower" || v === "off" ? v : undefined;
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/**
 * Lista de textos LIMPIA: sin espacios de sobra y sin huecos.
 *
 * Los campos de "separadas por coma" no pueden limpiarse mientras se escribe:
 * al teclear la coma queda un hueco vacío, y si se tirara ahí mismo la coma
 * desaparecería y no se podría separar nada. Así que se escribe sucio y se
 * limpia aquí, al guardar.
 */
function strListLimpia(v: unknown): string[] {
  return strList(v)
    .map((x) => x.trim())
    .filter(Boolean);
}

/**
 * LA ETIQUETA DE SEMIMODALIDAD, ACOTADA A LAS TRES QUE EXISTEN.
 *
 * Solo «lineal», «dou» u «ob»; cualquier otra cosa se lee como SIN ETIQUETA.
 * Es a propósito: una etiqueta mal escrita que se guardara tal cual no la
 * reconocería nadie —ni el motor ni la pantalla— y el cajón desaparecería del
 * sorteo sin que nada lo dijera. Vacío significa general, que es lo seguro.
 */
function leeSemimodalidad(v: unknown): string {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "lineal" || s === "dou" || s === "ob" ? s : "";
}

/**
 * LAS TIENDAS, CAMPO A CAMPO.
 *
 * Como todo en este archivo: lo que no se nombre aquí se pierde en silencio al
 * guardar. Por eso la lista está escrita y no se copia el objeto entero.
 *
 * SIN `id` NO HAY TIENDA: es lo que la identifica cuando se le cambia el nombre,
 * y sin él la configuración de una podría acabar en otra al reordenar.
 */
function leeTiendas(
  v: unknown,
  /** «leer» = del archivo a la pantalla; «escribir» = de la pantalla al archivo. Solo cambia
   *  cómo se pasan las burbujas de su regalo (las demás piezas de la tienda son texto). */
  sentido: "leer" | "escribir" = "leer"
): Record<string, unknown>[] {
  if (!Array.isArray(v)) return [];
  // SU REGALO (17/10/2026): «son productos diferentes y regalos diferentes». Solo se escribe lo
  // que la tienda tenga escrito; lo que falte sale del regalo general. Ver
  // `conElRegaloDeLaTienda` en config.ts.
  const susPasos = (x: unknown) =>
    Array.isArray(x) && x.length > 0
      ? sentido === "leer"
        ? (x as Record<string, unknown>[]).map(readStep)
        : (x as EditorStep[]).map(writeStep)
      : null;
  const suRegalo = (r: unknown) => {
    if (!r || typeof r !== "object") return null;
    const g = r as Record<string, unknown>;
    const consent = susPasos(g.consent_sequence);
    const ask = susPasos(g.ask_sequence);
    const premio = str(g.reward_message).replace(/\r\n/g, "\n");
    const despedida = str(g.decline_message).replace(/\r\n/g, "\n");
    const regalo = {
      ...(consent ? { consent_sequence: consent } : {}),
      ...(ask ? { ask_sequence: ask } : {}),
      ...(premio.trim() ? { reward_message: premio } : {}),
      ...(despedida.trim() ? { decline_message: despedida } : {}),
    };
    return Object.keys(regalo).length > 0 ? regalo : null;
  };
  return (v as Record<string, unknown>[])
    .filter((t) => String(t?.id ?? "").trim())
    .map((t) => {
      const semi = String(t?.semimodalidad ?? "").trim();
      const alineacion =
        t?.alineacion && typeof t.alineacion === "object"
          ? Object.fromEntries(
              Object.entries(t.alineacion as Record<string, unknown>)
                .map(([puesto, id]) => [String(puesto), str(id).trim()])
                .filter(([, id]) => id)
            )
          : {};
      return {
        id: String(t.id).trim(),
        nombre: str(t?.nombre),
        // Vacío = tienda preparada pero sin número: no la elige nadie.
        numero: str(t?.numero).trim(),
        // SU PÁGINA DE FACEBOOK, para que Messenger venda lo mismo que su WhatsApp.
        // Vacío = esta tienda no atiende Messenger.
        pagina: str(t?.pagina).trim(),
        // SUS FRASES DE ENTRADA (12/10/2026), para que un número atienda varias tiendas.
        // Solo se escriben si hay alguna: vacío = la tienda sale del número, como siempre.
        ...(strListLimpia(t?.frases_de_entrada).length > 0
          ? { frases_de_entrada: strListLimpia(t?.frases_de_entrada) }
          : {}),
        // Solo se escribe lo apagado, como en el resto del archivo.
        ...(t?.enabled === false ? { enabled: false } : {}),
        ...(semi === "dos_juntas" || semi === "segunda_oculta"
          ? { semimodalidad: semi }
          : {}),
        ...(Object.keys(alineacion).length > 0 ? { alineacion } : {}),
        // EL UPSELL 1 APAGADO (19/10/2026): su producto guardado mientras está apagado. Solo la
        // pizarra lo lee; el bot no. Lo que no se nombra aquí se pierde al guardar.
        ...(str(t?.upsell_apagado).trim() ? { upsell_apagado: str(t.upsell_apagado).trim() } : {}),
        // QUIÉN COBRA en esta tienda, por id del almacén de usuarios. Vacío =
        // cobra la cuenta del país, que es lo de siempre.
        ...(str(t?.cobrador).trim() ? { cobrador: str(t.cobrador).trim() } : {}),
        // SU CONJUNTO DE DATOS de Meta —él lo llama «el pixel»—, donde se marcan las
        // compras de esta tienda. Vacío = el elegido en Meta Connect, que es lo de
        // siempre. Lo pidió el 01/10/2026: «para marcar la compra se necesita waba,
        // numero, pagina y pixel». Ver `Tienda.pixel` en `config.ts`.
        ...(str(t?.pixel).trim() ? { pixel: str(t.pixel).trim() } : {}),
        // SU COLOR, para reconocerla en las fachadas. Lo pidió el 05/10/2026:
        // «si yo les pongo un color en la sección tiendas, ese color debería
        // aparecer en la fachada». Solo se escribe si es un color de verdad:
        // cualquier otra cosa se descarta y la fachada vuelve al turquesa.
        ...(/^#[0-9a-fA-F]{6}$/.test(str(t?.color).trim())
          ? { color: str(t.color).trim().toLowerCase() }
          : {}),
        // LOS AVISOS QUE EL YA MIRO Y DECIDIO IGNORAR, por su clave. Lo pidió el 06/10/2026:
        // «que esas advertencias se puedan volver verde si yo lo deseo». Se guardan solo si
        // hay alguno, como el resto del archivo.
        ...(strList(t?.avisos_ignorados).length > 0
          ? { avisos_ignorados: strList(t?.avisos_ignorados) }
          : {}),
        ...(suRegalo(t?.regalo) ? { regalo: suRegalo(t?.regalo) } : {}),
        // «¿QUÉ REGALO?» (25/10/2026): de cuál de los regalos guardados salió el suyo. El bot no lo
        // lee (lee `regalo`, que es la copia); el editor lo usa para mantenerlos iguales.
        ...(str(t?.regalo_origen).trim() ? { regalo_origen: str(t.regalo_origen).trim() } : {}),
      };
    });
}

/**
 * LOS REGALOS GUARDADOS (25/10/2026): «un selector ¿Qué regalo?… los regalos guardados en un solo
 * sitio». Cada uno con su nombre y las mismas cuatro piezas que el regalo de una tienda. El bot no
 * los lee: al elegir uno, el editor lo copia en `tiendas[].regalo` (lo de siempre).
 */
function leeRegalosGuardados(v: unknown, sentido: "leer" | "escribir"): Record<string, unknown>[] {
  if (!Array.isArray(v)) return [];
  const pasos = (x: unknown) =>
    Array.isArray(x) && x.length > 0
      ? sentido === "leer"
        ? (x as Record<string, unknown>[]).map(readStep)
        : (x as EditorStep[]).map(writeStep)
      : null;
  return (v as Record<string, unknown>[])
    .filter((r) => String(r?.id ?? "").trim())
    .map((r) => {
      const consent = pasos(r.consent_sequence);
      const ask = pasos(r.ask_sequence);
      const premio = str(r.reward_message).replace(/\r\n/g, "\n");
      const despedida = str(r.decline_message).replace(/\r\n/g, "\n");
      return {
        id: String(r.id).trim(),
        nombre: str(r.nombre),
        ...(consent ? { consent_sequence: consent } : {}),
        ...(ask ? { ask_sequence: ask } : {}),
        ...(premio.trim() ? { reward_message: premio } : {}),
        ...(despedida.trim() ? { decline_message: despedida } : {}),
      };
    });
}

/**
 * LA PRESENTACIÓN COMO UPSELL Y LAS FILAS DE UPSELLS — campo a campo, como todo aquí.
 *
 * Ver PLAN-UPSELLS-EN-FILA.md. Desde la fase 3 el motor lo usa al vender.
 *
 * UNA SOLA LISTA DE CAMPOS PARA LEER Y PARA ESCRIBIR. La única diferencia entre las dos
 * direcciones es cómo se traducen las burbujas (`readStep` al leer, `writeStep` al escribir:
 * la pantalla usa `texts` y el motor `body_variants`). Por eso la traducción se pasa como
 * parámetro: con dos copias de la lista, un campo nuevo acabaría escrito en una sola, y el
 * otro lado lo borraría en silencio al guardar.
 *
 * NO TRADUCIR LAS BURBUJAS ES EL FALLO QUE YA PASÓ CON LA ENTREGA: «el motor encontraba la
 * burbuja pero sin texto, y mandaba un mensaje vacío. El cliente pagaba y el bot se quedaba
 * mudo».
 */
function limpiaPresentacionUpsell(
  v: unknown,
  traducir: (pasos: unknown) => unknown[],
  // Los cajones de la intro van por SU traductor, el mismo de los cajones del upsell de
  // siempre: `readGruposDeIntro` al leer, `writeGruposDeIntro` al escribir. Así llevan sus
  // etiquetas (tienda, bandera, semimodalidad) y su peso por el mismo carril.
  traducirCajones: (grupos: unknown) => unknown[],
  // Messenger e Instagram usan esta misma lista de campos, sin la lista vieja ni más canales.
  esDeUnCanal = false
): Record<string, unknown> | undefined {
  if (!v || typeof v !== "object") return undefined;
  const p = v as Record<string, unknown>;
  const fuera: Record<string, unknown> = {};
  const intro = esDeUnCanal ? [] : traducir(p.intro);
  const cajones = traducirCajones(p.intro_groups);
  const pregunta = traducir(p.pregunta_steps);
  const info = traducir(p.info_steps);
  if (intro.length) fuera.intro = intro;
  if (cajones.length) fuera.intro_groups = cajones;
  if (pregunta.length) fuera.pregunta_steps = pregunta;
  if (info.length) fuera.info_steps = info;
  // La casilla «Preguntar con botones»: se escribe solo si alguien la tocó, marcada o no.
  if (typeof p.use_buttons === "boolean") fuera.use_buttons = p.use_buttons;
  for (const campo of ["boton_si", "boton_no", "respuesta_rechazo", "recordatorio"]) {
    const texto = str(p[campo]);
    if (texto.trim()) fuera[campo] = texto;
  }
  if (!esDeUnCanal && p.por_canal && typeof p.por_canal === "object") {
    const canales = p.por_canal as Record<string, unknown>;
    const porCanal: Record<string, unknown> = {};
    for (const canal of ["messenger", "instagram"]) {
      const suya = limpiaPresentacionUpsell(canales[canal], traducir, traducirCajones, true);
      if (suya) porCanal[canal] = suya;
    }
    if (Object.keys(porCanal).length) fuera.por_canal = porCanal;
  }
  return Object.keys(fuera).length ? fuera : undefined;
}

function limpiaFilasDeUpsell(
  v: unknown,
  traducir: (pasos: unknown) => unknown[]
): Record<string, unknown>[] {
  if (!Array.isArray(v)) return [];
  const numero = (x: unknown) => {
    const n = Number(x);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };
  return (v as Record<string, unknown>[]).map((f, i) => {
    const puestos = (Array.isArray(f?.puestos) ? (f.puestos as Record<string, unknown>[]) : [])
      .filter((p) => str(p?.producto_id).trim())
      .map((p) => ({
        producto_id: str(p.producto_id).trim(),
        minutos: numero(p?.minutos),
        // Solo se escribe lo apagado, como en el resto del archivo.
        ...(p?.enabled === false ? { enabled: false } : {}),
      }));
    const d = f?.downsell && typeof f.downsell === "object"
      ? (f.downsell as Record<string, unknown>)
      : null;
    const precios: Record<string, { price_soles: number }> = {};
    if (d?.precios_por_pais && typeof d.precios_por_pais === "object") {
      for (const [pais, valor] of Object.entries(d.precios_por_pais as Record<string, unknown>)) {
        const precio = numero((valor as Record<string, unknown>)?.price_soles);
        if (precio > 0) precios[String(pais).toUpperCase()] = { price_soles: precio };
      }
    }
    const pasosDownsell = d ? traducir(d.steps) : [];
    const downsell = d
      ? {
          ...(d.enabled === true ? { enabled: true } : {}),
          ...(Object.keys(precios).length ? { precios_por_pais: precios } : {}),
          espera_minutos: numero(d.espera_minutos),
          ...(pasosDownsell.length ? { steps: pasosDownsell } : {}),
          ...(str(d.boton_si).trim() ? { boton_si: str(d.boton_si) } : {}),
          ...(str(d.boton_no).trim() ? { boton_no: str(d.boton_no) } : {}),
        }
      : undefined;
    return {
      id: str(f?.id).trim() || `fila_${i + 1}`,
      ...(f?.enabled === false ? { enabled: false } : {}),
      // La tienda, la cuarta etiqueta, por el mismo carril que los cajones de intro.
      ...(strList(f?.tiendas).length > 0 ? { tiendas: strList(f?.tiendas) } : {}),
      puestos,
      ...(downsell ? { downsell } : {}),
    };
  });
}

/** Traductores de burbujas para las dos funciones de arriba. */
const pasosParaLaPantalla = (pasos: unknown): unknown[] =>
  Array.isArray(pasos) ? (pasos as Record<string, unknown>[]).map(readStep) : [];
const pasosParaElArchivo = (pasos: unknown): unknown[] =>
  Array.isArray(pasos) ? (pasos as EditorStep[]).map(writeStep) : [];

/**
 * EL ALMACÉN DE USUARIOS QUE COBRAN.
 *
 * Se guardan solo los países ESCRITOS: un país con los tres campos en blanco no se
 * escribe, porque un país presente y vacío no se distingue de uno que sí tiene
 * datos hasta que se le mira dentro — y el que lo mira es el que cobra. Ausente
 * significa «este usuario no cobra aquí», y eso el motor sí lo sabe leer.
 */
/**
 * LAS CUENTAS POR MÉTODO: {método: cuenta}.
 *
 * Se tiran las vacías. Una clave presente con la cuenta en blanco se ve igual que
 * una cuenta escrita hasta que se le mira dentro, y el que mira es el cliente que
 * va a pagar: mejor que no esté y se caiga a la cuenta suelta de siempre.
 *
 * Las claves NO se validan contra una lista: los métodos los escribe él en sus
 * botones y cada negocio tiene los suyos, con sus nombres. Se normalizan a
 * minúsculas para que «Yape» y «yape» sean la misma cuenta.
 */
function leeCuentasPorMetodo(v: unknown): Record<string, string> {
  if (!v || typeof v !== "object") return {};
  const out: Record<string, string> = {};
  for (const [metodo, cuenta] of Object.entries(v as Record<string, unknown>)) {
    const clave = String(metodo ?? "").trim().toLowerCase();
    const valor = str(cuenta).trim();
    if (clave && valor) out[clave] = valor;
  }
  return out;
}

function leeCobradores(v: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(v)) return [];
  return (v as Record<string, unknown>[])
    .filter((c) => String(c?.id ?? "").trim())
    .map((c) => {
      const crudo =
        c?.por_pais && typeof c.por_pais === "object"
          ? (c.por_pais as Record<string, unknown>)
          : {};
      // El valor lleva textos Y la tabla de cuentas por método, así que no puede
      // ser `Record<string, string>`.
      const por_pais: Record<string, Record<string, unknown>> = {};
      for (const [pais, datos] of Object.entries(crudo)) {
        if (!datos || typeof datos !== "object") continue;
        const d = datos as Record<string, unknown>;
        const titular = str(d?.titular).trim();
        const numero_de_cuenta = str(d?.numero_de_cuenta).trim();
        const nombre_completo = str(d?.nombre_completo).trim();
        const cuentas_por_metodo = leeCuentasPorMetodo(d?.cuentas_por_metodo);
        const tieneCuentas = Object.keys(cuentas_por_metodo).length > 0;
        // LOS MÉTODOS QUE ESTA PERSONA NO COBRA. Se normalizan igual que las
        // claves de las cuentas, o una mayúscula dejaría el método encendido.
        const metodos_apagados = [
          ...new Set(
            strList(d?.metodos_apagados).map((m) => m.trim().toLowerCase())
          ),
        ].filter(Boolean);
        if (
          !titular &&
          !numero_de_cuenta &&
          !nombre_completo &&
          !tieneCuentas &&
          metodos_apagados.length === 0
        )
          continue;
        por_pais[String(pais).trim().toUpperCase()] = {
          ...(titular ? { titular } : {}),
          ...(numero_de_cuenta ? { numero_de_cuenta } : {}),
          ...(tieneCuentas ? { cuentas_por_metodo } : {}),
          ...(metodos_apagados.length > 0 ? { metodos_apagados } : {}),
          ...(nombre_completo ? { nombre_completo } : {}),
        };
      }
      return {
        id: String(c.id).trim(),
        nombre: str(c?.nombre),
        // SU FOTO, solo para la pantalla; nunca viaja al cliente. Lo pidió el
        // 02/10/2026: «un lugar donde yo pueda poner una foto». Solo se escribe si
        // tiene algo, como el resto del archivo — y si no se nombrara aquí, se
        // perdería en silencio al guardar.
        ...(str(c?.foto).trim() ? { foto: str(c.foto).trim() } : {}),
        ...(Object.keys(por_pais).length > 0 ? { por_pais } : {}),
      };
    });
}

function readAdRegistry(v: unknown): Array<Record<string, unknown>> {
  return Array.isArray(v)
    ? (v as Record<string, unknown>[])
        .map((ad) => {
          const meta = ad.meta && typeof ad.meta === "object" ? ad.meta as Record<string, unknown> : {};
          return {
            key: str(ad.key), name: str(ad.name), ids: strList(ad.ids), color: str(ad.color),
            ...(ad.enabled === false ? { enabled: false } : {}),
            ...(num(ad.ads_reader_id, 0) ? { ads_reader_id: num(ad.ads_reader_id, 0) } : {}),
            ...(str(ad.ad_link).trim() ? { ad_link: str(ad.ad_link).trim() } : {}),
            ...(str(ad.reference).trim() ? { reference: str(ad.reference).trim() } : {}),
            ...(str(meta.business_name) || str(meta.ad_account_name) || str(meta.campaign_name) || str(meta.ad_name)
              ? { meta: { business_name: str(meta.business_name), ad_account_name: str(meta.ad_account_name), campaign_name: str(meta.campaign_name), ad_name: str(meta.ad_name), ...(meta.active === false ? { active: false } : {}) } }
              : {}),
          };
        })
        .filter((ad) => ad.key && ad.name)
    : [];
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
/**
 * Botones de una burbuja, del YAML a la pantalla.
 *
 * Vive fuera de readStep porque el SALUDO también los lleva y no es un paso:
 * teniéndolo dentro habría que copiar la lectura, y una copia que se olvide de
 * las burbujas anidadas del botón las borra en el primer guardado.
 */
function readBubbleButtons(value: unknown): EditorBubbleButton[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
        .map((item) => ({
          id: str(item.id),
          label: str(item.label),
          // TODAS LAS ACCIONES QUE OFRECE EL EDITOR (23/10/2026). Esta lista tenía solo cinco: un
          // botón con «Elegir UPSELL», «Rechazar UPSELL», «Abrir la oferta de 2 opciones» o los del
          // regalo se guardaba bien, pero al reabrir el editor volvía a «Enviar burbujas» y el
          // siguiente guardado lo dejaba así: el botón dejaba de hacer lo que decía.
          action: ACCIONES_DE_BOTON.includes(str(item.action) as BubbleButtonAction)
            ? str(item.action) as BubbleButtonAction
            : "send_steps",
          steps: Array.isArray(item.steps)
            ? (item.steps as Record<string, unknown>[]).map(readStep)
            : [],
          payment_method: str(item.payment_method),
          workflow_id: str(item.workflow_id),
        }))
        .filter((item) => item.id && item.label)
    : [];
}

/**
 * Las decisiones de una burbuja, del YAML a la pantalla.
 *
 * Suelta y no dentro de readStep porque llama a readStep para sus propias
 * burbujas: una copia dentro se olvidaria de las anidadas y las borraria en el
 * primer guardado.
 */
function readBubbleDecisions(value: unknown): EditorBubbleDecision[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
        .map((item) => ({
          id: str(item.id),
          // Solo un false explícito apaga. Ausente = encendida, que es como se
          // comportan las decisiones guardadas antes de que existiera esto.
          enabled: item.enabled !== false,
          title: str(item.title),
          keywords: strList(item.keywords),
          steps: Array.isArray(item.steps)
            ? (item.steps as Record<string, unknown>[]).map(readStep)
            : [],
          color: str(item.color),
          // Una acción que no esté en la lista se descarta: un cuadrito que
          // parece linkeado y no ejecuta nada es peor que uno sin link.
          action: LINKS_DE_DECISION.includes(str(item.action) as DecisionAction)
            ? (str(item.action) as DecisionAction)
            : undefined,
          payment_method: str(item.payment_method),
          workflow_id: str(item.workflow_id),
        }))
        .filter((item) => item.id)
    : [];
}

/**
 * LOS CAJONES DE UNA INTRO, DEL ARCHIVO A LA PANTALLA.
 *
 * Es la misma forma que ya tienen los cajones de intro de un canal: nombre,
 * interruptor, peso y burbujas. Se lee aparte y no dentro de `readSteps` porque
 * lo de dentro son PASOS y esto es una lista de listas.
 */
/**
 * AQUÍ SE PERDÍAN LAS BANDERAS.
 *
 * LO QUE PASÓ — 24/09/2026, con sus palabras: «elegí las banderas, luego guardé,
 * y al refrescar la página aparecía como si no las hubiese seleccionado».
 *
 * Este lado del guardado NO copia lo que le llega: lo RECONSTRUYE campo por
 * campo. Es a propósito —así nada raro entra al archivo— pero tiene un precio:
 * un campo nuevo que no se escriba aquí se tira sin decir nada. La pantalla lo
 * deja poner, el bot nunca lo ve, y no hay ningún error por ningún lado.
 *
 * Es el mismo fallo que este proyecto ya pagó con otros campos. La regla que
 * sale de aquí: **un campo nuevo en el editor no está terminado hasta que se
 * escribe también en este archivo.**
 */
function readGruposDeIntro(value: unknown): {
  name: string;
  enabled: boolean;
  weight: number;
  paises: string[];
  pais_routing_enabled: boolean;
  semimodalidad: string;
  tiendas: string[];
  camino: string;
  tambien_en_caminos: string[];
  steps: EditorStep[];
}[] {
  if (!Array.isArray(value)) return [];
  return (value as Record<string, unknown>[]).map((g) => ({
    name: str(g?.name),
    enabled: g?.enabled !== false,
    weight: Math.max(1, Math.floor(num(g?.weight, 1))),
    paises: strList(g?.paises),
    pais_routing_enabled: g?.pais_routing_enabled !== false,
    semimodalidad: leeSemimodalidad(g?.semimodalidad),
    tiendas: strList(g?.tiendas),
    // EL CAMINO (18/10/2026), por el mismo carril. Ver `etiqueta-de-camino.ts`.
    camino: leeCamino(g?.camino),
    tambien_en_caminos: leeTambienEnCaminos(g?.tambien_en_caminos),
    steps: Array.isArray(g?.steps)
      ? (g.steps as Record<string, unknown>[]).map(readStep)
      : [],
  }));
}

function writeGruposDeIntro(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return (value as Record<string, unknown>[]).map((g) => ({
    name: str(g?.name),
    // Como en el resto del archivo: solo se escribe lo apagado, para que un
    // YAML abierto a mano diga lo que hace falta y no una lista de «true».
    ...(g?.enabled === false ? { enabled: false } : {}),
    // LA BANDERA SE ESCRIBE, O NO SOBREVIVE AL GUARDADO.
    //
    // Este archivo no copia el contenido: lo vuelve a construir campo por
    // campo. Un campo que no esté nombrado aquí se pierde en silencio al
    // guardar, y en pantalla parece que nunca se eligió. Pasó con las
    // banderas el 24/09.
    ...(Array.isArray(g?.paises) && strList(g.paises).length > 0
      ? { paises: strList(g.paises) }
      : {}),
    ...(g?.pais_routing_enabled === false
      ? { pais_routing_enabled: false }
      : {}),
    // LA SEMIMODALIDAD, POR EL MISMO CARRIL Y POR EL MISMO MOTIVO.
    ...(leeSemimodalidad(g?.semimodalidad)
      ? { semimodalidad: leeSemimodalidad(g?.semimodalidad) }
      : {}),
    // Y LAS TIENDAS, POR EL MISMO CARRIL. Es la cuarta etiqueta y se pierde
    // igual de callada que las otras tres si no se nombra aquí.
    ...(strList(g?.tiendas).length > 0 ? { tiendas: strList(g?.tiendas) } : {}),
    // Y EL CAMINO (18/10/2026): solo si tiene uno; vacío = el principal.
    ...(leeCamino(g?.camino) ? { camino: leeCamino(g?.camino) } : {}),
    ...(leeTambienEnCaminos(g?.tambien_en_caminos).length > 0 ? { tambien_en_caminos: leeTambienEnCaminos(g?.tambien_en_caminos) } : {}),
    weight: Math.max(1, Math.floor(num(g?.weight, 1))),
    steps: Array.isArray(g?.steps)
      ? (g.steps as EditorStep[]).map(writeStep)
      : [],
  }));
}

function readStep(s: Record<string, unknown>): EditorStep {
  const readButtons = readBubbleButtons;
  return {
    type: normalizeType(s?.type),
    drive_url: str(s?.drive_url),
    // EL RESCATE DE LAS BURBUJAS GUARDADAS EN EL FORMATO DE LA PANTALLA.
    //
    // La biblioteca de productos se guardó un tiempo TAL CUAL venía del editor,
    // así que sus entregas quedaron con `texts` en vez de `body_variants`. El
    // motor lee `body_variants`, no encontraba nada y mandaba una burbuja vacía:
    // el cliente pagaba y el bot se quedaba mudo, sin error en ningún sitio.
    //
    // Ya se guardan bien, pero las que están escritas así hay que poder leerlas
    // o se perderían al abrir el editor y guardar.
    texts: Array.isArray(s?.body_variants)
      ? strList(s.body_variants)
      : Array.isArray(s?.caption_variants)
        ? strList(s.caption_variants)
        : strList(s?.texts),
    delay_after_sec: num(s?.delay_after_sec, 0),
    enabled: s?.enabled !== false,
    buttons: readButtons(s?.buttons),
    decisions: readBubbleDecisions(s?.decisions),
    // Sin valor se queda SIN valor, no en 3. La casilla tiene que poder estar
    // vacía y significar «el plazo de siempre»; poniéndole un 3 al leer, el
    // primer guardado lo congelaría en todas las burbujas del bot.
    espera_eleccion_minutos:
      typeof s?.espera_eleccion_minutos === "number" &&
      Number.isFinite(s.espera_eleccion_minutos)
        ? (s.espera_eleccion_minutos as number)
        : undefined,
    capturar_nombre: s?.capturar_nombre === true,
  };
}

/**
 * La pregunta del final del upsell, en burbujas.
 *
 * Cuando todavía no hay burbujas se SIEMBRA una con el texto de siempre. Sin
 * esto, el cajón se abriría vacío y parecería que la pregunta se perdió — y al
 * guardar se habría perdido de verdad.
 */
function readPreguntaSteps(u: Record<string, unknown>): EditorStep[] {
  const guardados = Array.isArray(u?.pregunta_steps)
    ? (u.pregunta_steps as Record<string, unknown>[]).map(readStep)
    : [];
  if (guardados.length > 0) return guardados;
  const texto = str(u?.pregunta);
  if (!texto.trim()) return [];
  // Las variantes viejas del campo suelto entran como variantes de la burbuja,
  // que es donde se editan ahora.
  const variantes = strList(u?.pregunta_variants).filter((v) => v.trim());
  return [
    {
      type: "text",
      drive_url: "",
      texts: variantes.length > 0 ? variantes : [texto],
      delay_after_sec: 0,
      enabled: true,
      buttons: [],
      decisions: [],
    },
  ];
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
        skipAskName: group?.skipAskName === true,
        adKeys: strList(group?.adKeys),
        // EL INTERRUPTOR DE LA ETIQUETA, QUE TAMPOCO SE LEÍA.
        //
        // El botón ON/OFF vive en la pantalla y el motor lo obedece, pero no
        // hacía el viaje: se apagaba, se guardaba, y al refrescar volvía a ON.
        adRoutingEnabled: group?.adRoutingEnabled !== false,
        // LA BANDERA, QUE SE PERDÍA AQUÍ. Ver `readGruposDeIntro`.
        paises: strList(group?.paises),
        paisRoutingEnabled: group?.paisRoutingEnabled !== false,
        // Y LA SEMIMODALIDAD, por el mismo carril y por el mismo motivo.
        semimodalidad: leeSemimodalidad(group?.semimodalidad),
        // Y LAS TIENDAS, la cuarta etiqueta, por ese mismo carril.
        tiendas: strList(group?.tiendas),
        // Y EL CAMINO (18/10/2026). Ver `etiqueta-de-camino.ts`.
        camino: leeCamino(group?.camino),
        tambien_en_caminos: leeTambienEnCaminos(group?.tambien_en_caminos),
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
        ignore_quiet_hours: f?.ignore_quiet_hours === true,
        ignore_late_lead_defer: f?.ignore_late_lead_defer === true,
        steps_enabled: f?.steps_enabled !== false,
        ad_keys: strList(f?.ad_keys),
        ad_routing_enabled: f?.ad_routing_enabled !== false,
        // LA BANDERA, QUE SE PERDÍA AQUÍ. Ver `readGruposDeIntro`.
        paises: strList(f?.paises),
        pais_routing_enabled: f?.pais_routing_enabled !== false,
        // Y LA SEMIMODALIDAD, por el mismo carril.
        semimodalidad: leeSemimodalidad(f?.semimodalidad),
        // Y LAS TIENDAS, la cuarta etiqueta.
        tiendas: strList(f?.tiendas),
        offer_choice_menu_enabled: f?.offer_choice_menu_enabled === true,
        // EL PESO DE LOS «MENSAJES PRINCIPALES» Y DE CADA VARIANTE (17/10/2026). Ausente = 1, el
        // reparto parejo de siempre. Ver `chooseFollowupVariant`.
        steps_weight: Math.max(1, Math.floor(num(f?.steps_weight, 1))),
        steps: readSteps(f?.steps),
        variants: Array.isArray(f?.variants)
          ? (f.variants as Record<string, unknown>[]).map((variant) => ({
              name: str(variant?.name),
              enabled: variant?.enabled !== false,
              weight: Math.max(1, Math.floor(num(variant?.weight, 1))),
              // LA ETIQUETA DE LA SUB PESTAÑA: SE ESCRIBÍA Y NO SE LEÍA.
              //
              // El guardado sí la ponía en el archivo, pero al abrir el editor
              // no volvía a la pantalla; y el guardado siguiente la borraba.
              ad_keys: strList(variant?.ad_keys),
              ad_routing_enabled: variant?.ad_routing_enabled !== false,
              paises: strList(variant?.paises),
              pais_routing_enabled: variant?.pais_routing_enabled !== false,
              semimodalidad: leeSemimodalidad(variant?.semimodalidad),
              tiendas: strList(variant?.tiendas),
              // Y EL CAMINO (18/10/2026). Ver `etiqueta-de-camino.ts`.
              camino: leeCamino(variant?.camino),
              tambien_en_caminos: leeTambienEnCaminos(variant?.tambien_en_caminos),
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
    order_bump_intro_groups: readGruposDeIntro(c?.order_bump_intro_groups),
    upsell_intro_groups: readGruposDeIntro(c?.upsell_intro_groups),
    // LA ELECCIÓN CON BOTONES DE ESTE CANAL.
    //
    // Los interruptores entran como `undefined` cuando el canal no los tiene:
    // ausente significa «manda la modalidad», y un `false` de relleno los
    // apagaría en todos los canales que nunca los tocaron.
    order_bump_use_buttons:
      typeof c?.order_bump_use_buttons === "boolean"
        ? c.order_bump_use_buttons
        : undefined,
    order_bump_choice_prompt: str(c?.order_bump_choice_prompt),
    upsell_pregunta_steps: readSteps(c?.upsell_pregunta_steps),
    upsell_use_buttons:
      typeof c?.upsell_use_buttons === "boolean"
        ? c.upsell_use_buttons
        : undefined,
    upsell_boton_si: str(c?.upsell_boton_si),
    upsell_boton_no: str(c?.upsell_boton_no),
    upsell_respuesta_rechazo: str(c?.upsell_respuesta_rechazo),
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
        skipAskName: group?.skipAskName === true,
        adKeys: strList(group?.adKeys),
        // El interruptor de la etiqueta. Ver el aviso de `writeGruposDeIntro`:
        // lo que no se nombra aquí no se guarda.
        adRoutingEnabled: group?.adRoutingEnabled !== false,
        // La bandera, por el mismo carril que la etiqueta de ads.
        paises: strList(group?.paises),
        paisRoutingEnabled: group?.paisRoutingEnabled !== false,
        // Y la semimodalidad, por ese mismo carril.
        semimodalidad: leeSemimodalidad(group?.semimodalidad),
        // Y las tiendas, la cuarta etiqueta.
        tiendas: strList(group?.tiendas),
        // Y el camino (18/10/2026): solo si tiene uno; vacío = el principal.
        ...(leeCamino(group?.camino) ? { camino: leeCamino(group?.camino) } : {}),
        ...(leeTambienEnCaminos(group?.tambien_en_caminos).length > 0 ? { tambien_en_caminos: leeTambienEnCaminos(group?.tambien_en_caminos) } : {}),
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
        ignore_quiet_hours: f?.ignore_quiet_hours === true,
        ignore_late_lead_defer: f?.ignore_late_lead_defer === true,
        ...(f?.steps_enabled === false ? { steps_enabled: false } : {}),
        offer_choice_menu_enabled: f?.offer_choice_menu_enabled === true,
        // La etiqueta del seguimiento y su interruptor. Hoy no hay selector
        // para ellos en Canales —solo en las sub pestañas—, pero la lectura sí
        // los devuelve: nombrarlos aquí evita que un valor escrito a mano
        // desaparezca en el primer guardado.
        ad_keys: strList(f?.ad_keys),
        ad_routing_enabled: f?.ad_routing_enabled !== false,
        // La bandera del seguimiento del canal. Ver `writeGruposDeIntro`.
        paises: strList(f?.paises),
        pais_routing_enabled: f?.pais_routing_enabled !== false,
        // Y la semimodalidad, por el mismo carril.
        semimodalidad: leeSemimodalidad(f?.semimodalidad),
        // Y las tiendas, la cuarta etiqueta.
        tiendas: strList(f?.tiendas),
        // El peso solo se escribe si no es 1: YAML limpio, y ausente = 1.
        ...(Math.floor(num(f?.steps_weight, 1)) > 1 ? { steps_weight: Math.floor(num(f?.steps_weight, 1)) } : {}),
        steps: writeSteps(f?.steps),
        variants: Array.isArray(f?.variants)
          ? (f.variants as Record<string, unknown>[]).map((variant) => ({
              name: str(variant?.name),
              enabled: variant?.enabled !== false,
              ...(Math.floor(num(variant?.weight, 1)) > 1 ? { weight: Math.floor(num(variant?.weight, 1)) } : {}),
              ad_keys: strList(variant?.ad_keys),
              ad_routing_enabled: variant?.ad_routing_enabled !== false,
              paises: strList(variant?.paises),
              pais_routing_enabled: variant?.pais_routing_enabled !== false,
              semimodalidad: leeSemimodalidad(variant?.semimodalidad),
              tiendas: strList(variant?.tiendas),
              // Y el camino (18/10/2026): solo si tiene uno.
              ...(leeCamino(variant?.camino) ? { camino: leeCamino(variant?.camino) } : {}),
              ...(leeTambienEnCaminos(variant?.tambien_en_caminos).length > 0 ? { tambien_en_caminos: leeTambienEnCaminos(variant?.tambien_en_caminos) } : {}),
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
    order_bump_intro_groups: writeGruposDeIntro(
      content?.order_bump_intro_groups
    ),
    upsell_intro_groups: writeGruposDeIntro(content?.upsell_intro_groups),
    // Los interruptores SOLO se escriben si el canal los tiene decididos: la
    // clave ausente es lo que hace que mande la modalidad.
    ...(typeof content?.order_bump_use_buttons === "boolean"
      ? { order_bump_use_buttons: content.order_bump_use_buttons }
      : {}),
    order_bump_choice_prompt: str(content?.order_bump_choice_prompt).replace(
      /\r\n/g,
      "\n"
    ),
    upsell_pregunta_steps: writeSteps(content?.upsell_pregunta_steps),
    ...(typeof content?.upsell_use_buttons === "boolean"
      ? { upsell_use_buttons: content.upsell_use_buttons }
      : {}),
    upsell_boton_si: str(content?.upsell_boton_si),
    upsell_boton_no: str(content?.upsell_boton_no),
    upsell_respuesta_rechazo: str(content?.upsell_respuesta_rechazo).replace(
      /\r\n/g,
      "\n"
    ),
    post_sale: {
      whatsappPreference: str(postSale?.whatsappPreference).replace(/\r\n/g, "\n"),
      deliveryUsage: str(postSale?.deliveryUsage).replace(/\r\n/g, "\n"),
      lifetimeAccess: str(postSale?.lifetimeAccess).replace(/\r\n/g, "\n"),
      farewells: str(postSale?.farewells).replace(/\r\n/g, "\n"),
    },
  };
}

// EditorStep (UI) -> objeto YAML. text->body_variants, media->drive_url+caption_variants.
/**
 * Botones de una burbuja, de la pantalla al YAML. Fuera de writeStep por el
 * mismo motivo que su gemela de lectura: el saludo los lleva y no es un paso.
 */
function writeBubbleButtons(
  buttons: EditorBubbleButton[] | undefined
): Record<string, unknown>[] {
  return (buttons ?? [])
    .filter((button) => button.id.trim() && button.label.trim())
    .slice(0, 3)
    .map((button) => ({
      id: button.id.trim(),
      label: button.label.trim(),
      action: button.action,
      ...(button.action === "send_steps"
        ? { steps: (button.steps ?? []).map(writeStep) }
        : {}),
      // Se guarda QUÉ método manda, nunca sus datos: el número de cuenta vive
      // en Precios y pagos y solo ahí. Copiarlo aquí sería tenerlo en dos
      // sitios, y el día que cambie uno se queda viejo sin avisar a nadie.
      ...(button.action === "send_payment_method" &&
      button.payment_method?.trim()
        ? { payment_method: button.payment_method.trim() }
        : {}),
      ...(button.action === "start_workflow" && button.workflow_id?.trim()
        ? { workflow_id: button.workflow_id.trim() }
        : {}),
    }));
}

/**
 * Las decisiones de una burbuja, de la pantalla al YAML.
 *
 * Sin esto la pantalla las mostraria y al guardar desapareceria todo sin un
 * solo aviso: esta funcion reconstruye el archivo campo por campo, y lo que no
 * se escriba aqui no existe.
 */
function writeBubbleDecisions(
  decisions: EditorBubbleDecision[] | undefined
): Record<string, unknown>[] {
  return (decisions ?? [])
    .filter((decision) => decision.id.trim())
    .map((decision) => ({
      id: decision.id.trim(),
      // Solo se anota cuando está APAGADA: un "enabled: true" en cada cuadrito
      // ensuciaría el archivo sin decir nada nuevo.
      ...(decision.enabled === false ? { enabled: false } : {}),
      title: (decision.title ?? "").trim(),
      keywords: (decision.keywords ?? [])
        .map((palabra) => palabra.trim())
        .filter(Boolean),
      color: (decision.color ?? "").trim(),
      // El link se guarda solo si lo tiene, y el método solo si el link es el
      // que lo usa. Escribir siempre los dos dejaría un método colgando de un
      // cuadrito que ya no lo manda: al volver a linkearlo reaparecería uno
      // que nadie eligió esta vez.
      ...(decision.action ? { action: decision.action } : {}),
      ...(decision.action === "send_payment_method" &&
      decision.payment_method?.trim()
        ? { payment_method: decision.payment_method.trim() }
        : {}),
      ...(decision.action === "start_workflow" && decision.workflow_id?.trim()
        ? { workflow_id: decision.workflow_id.trim() }
        : {}),
      steps: (decision.steps ?? []).map(writeStep),
    }));
}

function writeStep(s: EditorStep): Record<string, unknown> {
  const type = normalizeType(s?.type);
  // UNA BURBUJA, UN TEXTO.
  //
  // Las variantes existían para que el bot eligiera una al azar entre varias.
  // Eso lo hace el spintax dentro del propio texto —{Hola|Buenas}—, sin partir
  // el mensaje en cajas y sin una lista que mantener.
  //
  // Se guarda SOLO la primera. Las que hubiera escritas se pierden en el primer
  // guardado; es lo que se pidió. No se recortan al LEER a propósito: leyendo
  // lo que hay, el editor no se declara «con cambios sin guardar» nada más
  // abrir, y el recorte ocurre cuando el operador guarda de verdad.
  const texts = (Array.isArray(s?.texts) ? s.texts : [])
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.replace(/\r\n/g, "\n"))
    .slice(0, 1);
  const delay = num(s?.delay_after_sec, 0);
  // enabled solo se escribe cuando está apagado → YAML limpio.
  const off = s?.enabled === false ? { enabled: false } : {};
  const buttons = writeBubbleButtons(s?.buttons);
  const buttonField = buttons.length ? { buttons } : {};
  const decisions = writeBubbleDecisions(s?.decisions);
  const decisionField = decisions.length ? { decisions } : {};
  // EL PLAZO SE GUARDA SOLO SI HAY CUADRITOS Y SI SE ESCRIBIÓ UNO.
  //
  // Sin cuadritos no hay pausa, así que el número no significa nada y no tiene
  // por qué quedar escrito: sería un dato muerto que confunde a quien abra el
  // archivo. Y vacío se queda fuera, para que siga valiendo el plazo de
  // siempre en vez de congelar un 3 en cada burbuja del bot.
  // Pedir el nombre TAMBIÉN detiene la burbuja, así que el plazo tiene sentido
  // aunque no haya ningún cuadrito.
  const pideNombre = s?.capturar_nombre === true;
  const nombreField = pideNombre ? { capturar_nombre: true } : {};
  const plazo = s?.espera_eleccion_minutos;
  const esperaField =
    (decisions.length || pideNombre) &&
    typeof plazo === "number" &&
    Number.isFinite(plazo) &&
    plazo > 0
      ? { espera_eleccion_minutos: plazo }
      : {};
  if (type === "text") {
    return { type, body_variants: texts, delay_after_sec: delay, ...buttonField, ...decisionField, ...nombreField, ...esperaField, ...off };
  }
  return {
    type,
    drive_url: str(s?.drive_url),
    caption_variants: texts,
    delay_after_sec: delay,
    ...buttonField,
    ...decisionField,
    ...nombreField,
    ...esperaField,
    ...off,
  };
}

/**
 * La pregunta del final del upsell, en sus dos formas.
 *
 * Las burbujas son lo que manda. El campo suelto se deja AL DÍA con el texto de
 * la última burbuja encendida, porque es el respaldo que usa el motor cuando esa
 * última no es texto: si se quedara viejo, el bot mandaría una pregunta que ya
 * no está en ningún sitio del editor.
 *
 * Sin burbujas no se toca nada: así una petición que no traiga el campo —una
 * versión vieja del editor, por ejemplo— no borra la pregunta de siempre.
 */
function writePregunta(u: Record<string, unknown>): {
  pregunta_steps: Record<string, unknown>[];
  pregunta: string;
} {
  const pasos = Array.isArray(u?.pregunta_steps)
    ? (u.pregunta_steps as EditorStep[])
    : [];
  const encendidas = pasos.filter((p) => p?.enabled !== false);
  const ultima = encendidas[encendidas.length - 1];
  const ultimaEsTexto = Boolean(ultima) && normalizeType(ultima.type) === "text";
  const textos = ultimaEsTexto && Array.isArray(ultima.texts) ? ultima.texts : [];
  return {
    pregunta_steps: pasos.map(writeStep),
    pregunta: (ultimaEsTexto
      ? str(textos.find((t) => typeof t === "string" && t.trim()) ?? "")
      : str(u?.pregunta)
    ).replace(/\r\n/g, "\n"),
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

const SALESBOT_MODES = [
  "ai",
  "salesbot_strong",
  "salesbot_stage_guided",
  "salesbot_only",
] as const;
const SALESBOT_MODALITIES = [
  "lineal",
  "order_bump",
  "bioferta",
  "doble_oferta_dos",
  "doble_oferta_upsell",
  "upsell",
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

/**
 * EL CONTENIDO YA LEÍDO, MIENTRAS EL ARCHIVO NO CAMBIE (25/10/2026): «¿por qué se demora mucho en
 * cargar la página?». Leer el YAML de 5,5 MB tarda segundos; abrir el editor lo leía cada vez. Se
 * guarda como JSON (liviano en memoria) junto a la fecha y el tamaño del archivo: si el archivo
 * cambió (un guardado, un despliegue, una edición a mano), se vuelve a leer.
 */
let contenidoYaLeido: { mtimeMs: number; size: number; json: string } | null = null;
/**
 * Y EL DOCUMENTO YA LEÍDO, PARA GUARDAR (25/10/2026): leer el YAML cuesta ~3,5 s; clonar el ya leído,
 * ~0,6 s (y ocupa ~40 MB). Solo vale mientras el archivo sea el mismo (fecha y tamaño). Nunca se
 * cambia el guardado: cada guardado trabaja sobre un CLON.
 */
let documentoYaLeido: { mtimeMs: number; size: number; doc: ReturnType<typeof parseDocument> } | null = null;
function documentoDelArchivo(raw: string): ReturnType<typeof parseDocument> {
  try {
    const st = fs.statSync(CONFIG_PATH);
    if (documentoYaLeido && documentoYaLeido.mtimeMs === st.mtimeMs && documentoYaLeido.size === st.size) return documentoYaLeido.doc.clone();
    const doc = parseDocument(raw);
    documentoYaLeido = { mtimeMs: st.mtimeMs, size: st.size, doc };
    return doc.clone();
  } catch {
    return parseDocument(raw);
  }
}
function recordarDocumento(doc: ReturnType<typeof parseDocument>): void {
  try {
    const st = fs.statSync(CONFIG_PATH);
    documentoYaLeido = { mtimeMs: st.mtimeMs, size: st.size, doc };
  } catch {
    documentoYaLeido = null;
  }
}
function recordarContenido(js: unknown): void {
  try {
    const st = fs.statSync(CONFIG_PATH);
    contenidoYaLeido = { mtimeMs: st.mtimeMs, size: st.size, json: JSON.stringify(js) };
  } catch {
    contenidoYaLeido = null;
  }
}
function contenidoRecordado(): Record<string, unknown> | null {
  if (!contenidoYaLeido) return null;
  try {
    const st = fs.statSync(CONFIG_PATH);
    if (st.mtimeMs !== contenidoYaLeido.mtimeMs || st.size !== contenidoYaLeido.size) return null;
    return JSON.parse(contenidoYaLeido.json) as Record<string, unknown>;
  } catch {
    return null;
  }
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
    const recordado = contenidoRecordado();
    if (recordado) config = recordado;
    else {
      config = parseDocument(raw).toJS() as Record<string, unknown>;
      recordarContenido(config);
    }
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
  const intro_ad_keys = Array.isArray(config?.intro_ad_keys)
    ? (config.intro_ad_keys as unknown[]).map(strList)
    : [];
  const intro_ad_routing_enabled = Array.isArray(config?.intro_ad_routing_enabled)
    ? (config.intro_ad_routing_enabled as unknown[]).map((value) => value !== false)
    : [];
  // La bandera de cada cajón de intro, gemela de la etiqueta de ads de arriba.
  const intro_paises = Array.isArray(config?.intro_paises)
    ? (config.intro_paises as unknown[]).map(strList)
    : [];
  const intro_pais_routing_enabled = Array.isArray(config?.intro_pais_routing_enabled)
    ? (config.intro_pais_routing_enabled as unknown[]).map((value) => value !== false)
    : [];
  /** La semimodalidad por intro, en el mismo carril que la bandera. */
  const intro_semimodalidades = Array.isArray(config?.intro_semimodalidades)
    ? (config.intro_semimodalidades as unknown[]).map(leeSemimodalidad)
    : [];
  /** Las tiendas por intro, en ese mismo carril. Vacío = para todas. */
  const intro_tiendas = Array.isArray(config?.intro_tiendas)
    ? (config.intro_tiendas as unknown[]).map(strList)
    : [];
  /** Las tiendas: una venta por número. Vacío = todo como hoy. */
  const tiendas = leeTiendas(config?.tiendas);
  /** El almacén de usuarios que cobran. Vacío = cobra la cuenta del país. */
  const cobradores = leeCobradores(config?.cobradores);
  const ad_registry = readAdRegistry(config?.ad_registry);
  const ad_color_palette = Array.isArray(config?.ad_color_palette)
    ? config.ad_color_palette
        .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
        .map((entry) => ({ label: str(entry.label), value: str(entry.value) }))
        .filter((entry) => /^#[0-9a-fA-F]{6}$/.test(entry.value))
    : [];

  const followups: EditorFollowup[] = Array.isArray(config?.followup_sequences)
    ? (config.followup_sequences as Record<string, unknown>[]).map((f) => ({
        name: str(f?.name),
        delay_minutes_from_first_message: num(
          f?.delay_minutes_from_first_message,
          0
        ),
        enabled: f?.enabled !== false,
        ignore_quiet_hours: f?.ignore_quiet_hours === true,
        ignore_late_lead_defer: f?.ignore_late_lead_defer === true,
        steps_enabled: f?.steps_enabled !== false,
        ad_keys: strList(f?.ad_keys),
        // El interruptor de la etiqueta: sin esta línea se apagaba, se
        // guardaba, y al refrescar aparecía encendido otra vez.
        ad_routing_enabled: f?.ad_routing_enabled !== false,
        paises: strList(f?.paises),
        pais_routing_enabled: f?.pais_routing_enabled !== false,
        semimodalidad: leeSemimodalidad(f?.semimodalidad),
        tiendas: strList(f?.tiendas),
        offer_choice_menu_enabled: f?.offer_choice_menu_enabled === true,
        steps_weight: Math.max(1, Math.floor(num(f?.steps_weight, 1))),
        steps: Array.isArray(f?.steps)
          ? (f.steps as Record<string, unknown>[]).map(readStep)
          : [],
        variants: Array.isArray(f?.variants)
          ? (f.variants as Record<string, unknown>[]).map((v) => ({
              name: str(v?.name),
              enabled: v?.enabled !== false,
              weight: Math.max(1, Math.floor(num(v?.weight, 1))),
              ad_keys: strList(v?.ad_keys),
              ad_routing_enabled: v?.ad_routing_enabled !== false,
              paises: strList(v?.paises),
              pais_routing_enabled: v?.pais_routing_enabled !== false,
              semimodalidad: leeSemimodalidad(v?.semimodalidad),
              tiendas: strList(v?.tiendas),
              // Y el camino (18/10/2026). Ver `etiqueta-de-camino.ts`.
              camino: leeCamino(v?.camino),
              tambien_en_caminos: leeTambienEnCaminos(v?.tambien_en_caminos),
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
    defer_late_leads_enabled: sch?.defer_late_leads_enabled === true,
    defer_late_leads_after: str(sch?.defer_late_leads_after),
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
    prompt_cache_enabled: config?.prompt_cache_enabled === true,
    // Ver `segundaOpcionPrestada` en el motor: la modalidad activa sigue
    // vendiendo lo suyo y solo toma prestada la FORMA de presentar dos
    // opciones. Vacío = como siempre, así que cualquier otro valor se lee como
    // vacío en vez de viajar tal cual.
    segunda_opcion_prestada:
      config?.segunda_opcion_prestada === "dos_juntas" ||
      config?.segunda_opcion_prestada === "segunda_oculta"
        ? config.segunda_opcion_prestada
        : "",
    // Apagado por defecto: apagado es «lineal extendida», que es como el bot
    // viene funcionando. Encenderlo mueve a las conversaciones que ya están a
    // medias, así que nadie debería encontrárselo puesto sin haberlo pedido.
    modo_reenganche: config?.modo_reenganche === true,
    // ENCENDIDO SALVO QUE ESTÉ ESCRITO false (16/10/2026): encendido es como el bot vino
    // funcionando siempre. Ver `etiqueta-de-bandera.ts`.
    respaldo_entre_paises: config?.respaldo_entre_paises !== false,
    // Y el de tiendas igual (17/10/2026). Ver `etiqueta-de-tienda.ts`.
    respaldo_entre_tiendas: config?.respaldo_entre_tiendas !== false,
    // Apagado salvo que esté escrito. Es una decisión comercial: dejar de
    // atender a parte de la gente que escribe. Nadie debería encontrárselo
    // puesto por defecto.
    no_responder_organicos: config?.no_responder_organicos === true,
    organicos_tope_mensajes: topeDeOrganicos(config),
    bot_response_delay_seconds: num(config?.bot_response_delay_seconds, 6),
    // El respaldo es la variable de entorno de siempre, para que un despliegue
    // que aún no ha guardado desde el panel vea en la casilla el número que de
    // verdad está usando, y no un 8 inventado.
    bot_debounce_seconds: num(
      config?.bot_debounce_seconds,
      Number(process.env.BOT_DEBOUNCE_SECONDS ?? 8)
    ),
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

  // EL COLOR DE LOS BOTONES DE «PRECIOS Y PAGOS».
  //
  // Es SOLO aspecto del editor: el motor no lo mira nunca y ningún cliente lo
  // ve. Vive aquí, y no en cada modalidad, por dos razones: la clave ya lleva la
  // modalidad dentro («doble_oferta_upsell:full»), así que pintar una tienda no
  // puede tocar las otras; y al estar fuera de las secciones de contenido, una
  // plantilla que rehaga una modalidad no se lleva los colores por delante.
  const editor_colores_de_botones: Record<string, string> = {};
  const coloresGuardados = config?.editor_colores_de_botones;
  if (coloresGuardados && typeof coloresGuardados === "object") {
    for (const [clave, valor] of Object.entries(
      coloresGuardados as Record<string, unknown>
    )) {
      if (typeof valor === "string" && valor.trim()) {
        editor_colores_de_botones[clave] = valor.trim();
      }
    }
  }

  // Respuesta a comentarios de Facebook (apagada por defecto).
  const ca = (config?.comment_automation ?? {}) as Record<string, unknown>;
  const comment_automation = {
    enabled: ca?.enabled === true,
    accept_any: ca?.accept_any === true,
    one_per_person_hours: num(ca?.one_per_person_hours, 0),
    skip_after_ignored_enabled: ca?.skip_after_ignored_enabled === true,
    skip_after_ignored: num(ca?.skip_after_ignored, 1),
    keywords: str(ca?.keywords),
    message: str(ca?.message),
    // readStep es funcion declarada (hoisted); el readSteps de mas abajo aun
    // no existe en este punto del archivo.
    message_steps: Array.isArray(ca?.message_steps)
      ? (ca.message_steps as Record<string, unknown>[]).map(readStep)
      : [],
    delay_no_match_seconds: num(
      ca?.delay_no_match_seconds,
      Math.round(num(ca?.delay_no_match_hours, 24) * 3600)
    ),
    abandon_hours: num(ca?.abandon_hours, 24),
    to_human_enabled: ca?.to_human_enabled === true,
    to_human_hours: num(ca?.to_human_hours, 24),
    repeat_enabled: ca?.repeat_enabled === true,
    repeat_count: num(ca?.repeat_count, 2),
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
  const commercialCfg = (config?.commercial_routes ?? {}) as Record<
    string,
    unknown
  >;
  const commercial_routes = {
    enabled: commercialCfg?.enabled === true,
    route_b_percentage: num(commercialCfg?.route_b_percentage, 50),
    replace_last_intro_steps: num(commercialCfg?.replace_last_intro_steps, 1),
    route_b_closing_steps: readSteps(commercialCfg?.route_b_closing_steps),
    route_b_post_payment_intro: readSteps(
      commercialCfg?.route_b_post_payment_intro
    ),
    route_b_post_payment_choice_prompt: semilla(
      commercialCfg?.route_b_post_payment_choice_prompt,
      DEFAULT_ROUTE_B_POST_PAYMENT_PROMPT
    ),
    route_b_post_payment_use_buttons:
      commercialCfg?.route_b_post_payment_use_buttons !== false,
  };
  const deliveryPrefCfg = (config?.post_sale_delivery_preference ?? {}) as Record<
    string,
    unknown
  >;
  const post_sale_delivery_preference = {
    enabled: deliveryPrefCfg?.enabled === true,
    use_buttons: deliveryPrefCfg?.use_buttons !== false,
    separate_bubble: deliveryPrefCfg?.separate_bubble === true,
    prompt_text: semilla(
      deliveryPrefCfg?.prompt_text,
      DEFAULT_DELIVERY_PREFERENCE_PROMPT
    ),
    prompt_steps: Array.isArray(deliveryPrefCfg?.prompt_steps)
      ? (deliveryPrefCfg.prompt_steps as Record<string, unknown>[]).map(readStep)
      : [],
    buttons_prompt: semilla(
      deliveryPrefCfg?.buttons_prompt,
      DEFAULT_DELIVERY_PREFERENCE_BUTTONS_PROMPT
    ),
    whatsapp_button_label: semilla(
      deliveryPrefCfg?.whatsapp_button_label,
      DEFAULT_DELIVERY_WHATSAPP_LABEL
    ),
    email_button_label: semilla(
      deliveryPrefCfg?.email_button_label,
      DEFAULT_DELIVERY_EMAIL_LABEL
    ),
    email_request_text: str(deliveryPrefCfg?.email_request_text),
    email_request_steps: Array.isArray(deliveryPrefCfg?.email_request_steps)
      ? (deliveryPrefCfg.email_request_steps as Record<string, unknown>[]).map(readStep)
      : [],
    fallback_whatsapp_text: str(deliveryPrefCfg?.fallback_whatsapp_text),
    fallback_whatsapp_steps: Array.isArray(deliveryPrefCfg?.fallback_whatsapp_steps)
      ? (deliveryPrefCfg.fallback_whatsapp_steps as Record<string, unknown>[]).map(readStep)
      : [],
    wait_text: str(deliveryPrefCfg?.wait_text),
    wait_steps: Array.isArray(deliveryPrefCfg?.wait_steps)
      ? (deliveryPrefCfg.wait_steps as Record<string, unknown>[]).map(readStep)
      : [],
    delay_seconds: num(deliveryPrefCfg?.delay_seconds, 15),
  };
  const notifyCfg = (config?.notification_settings ?? {}) as Record<
    string,
    unknown
  >;
  const notification_settings = {
    enabled: notifyCfg?.enabled === true,
    whatsapp_enabled: notifyCfg?.whatsapp_enabled !== false,
    telegram_enabled: notifyCfg?.telegram_enabled === true,
    recipients: Array.isArray(notifyCfg?.recipients)
      ? (notifyCfg.recipients as Record<string, unknown>[]).map((item) => ({
          name: str(item?.name),
          enabled: item?.enabled !== false,
          phone: str(item?.phone),
          telegram_chat_id: str(item?.telegram_chat_id),
        }))
      : [],
  };

  // Botones en el menú de métodos de pago (Yape/Plin/BCP).
  const payment_method_buttons = config?.payment_method_buttons === true;
  // Modo silencioso (no charla; default OFF) y toggle global de seguimientos
  // (default ON = comportamiento actual).
  // MODERACIÓN. Los dos interruptores APAGADOS salvo que se enciendan a mano;
  // los umbrales y el texto llegan con su arranque para que se puedan leer.
  const modCfg = (config?.moderacion ?? {}) as Record<string, unknown>;
  const moderacion = {
    piropos_enabled: modCfg?.piropos_enabled === true,
    piropos_umbral: num(modCfg?.piropos_umbral, 3) || 3,
    basura_enabled: modCfg?.basura_enabled === true,
    basura_umbral: num(modCfg?.basura_umbral, 2) || 2,
    mensaje_despedida: semilla(
      modCfg?.mensaje_despedida,
      DEFAULT_MODERACION_DESPEDIDA
    ),
  };
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
  // LA BIBLIOTECA DE PRODUCTOS.
  //
  // Se lee tal cual, sin recortar campo por campo: dentro lleva burbujas de
  // entrega y galerías, que son estructuras grandes y ya vienen limpias de su
  // propio editor. Lo que sí se asegura es que cada producto tenga un id y que
  // la etiqueta sea una de las conocidas — una etiqueta inventada a mano en el
  // archivo llenaría una caja que no existe, o ninguna, sin decir nada.
  const ETIQUETAS_CONOCIDAS = ["", "basico", "full", "upsell", "upsell_2"];
  const biblioteca_de_productos = Array.isArray(config?.biblioteca_de_productos)
    ? (config.biblioteca_de_productos as Record<string, unknown>[]).map(
        (item, i) => ({
          ...item,
          id: str(item?.id) || `producto_${i + 1}`,
          etiqueta: ETIQUETAS_CONOCIDAS.includes(str(item?.etiqueta))
            ? str(item?.etiqueta)
            : "",
          // LA ENTREGA SÍ SE TRADUCE, COMO LA DE CUALQUIER OTRA SECUENCIA.
          //
          // El archivo guarda las burbujas como las lee el motor y la pantalla
          // las quiere de otra forma. Se leía en crudo, así que el editor no
          // veía el texto y al guardar lo habría borrado.
          delivery: Array.isArray(item?.delivery)
            ? (item.delivery as Record<string, unknown>[]).map(readStep)
            : [],
          // LAS ENTREGAS EXTRA (25/10/2026): partes de ESTE producto que se mandan en otro momento
          // (muestras gratis, un nivel de contribución…). Sus burbujas, traducidas como la entrega.
          ...(Array.isArray(item?.entregas_extra)
            ? {
                entregas_extra: (item.entregas_extra as Record<string, unknown>[]).map((e, j) => ({
                  id: str(e?.id) || `entrega_${j + 1}`,
                  nombre: str(e?.nombre),
                  steps: Array.isArray(e?.steps) ? (e.steps as Record<string, unknown>[]).map(readStep) : [],
                })),
              }
            : {}),
          // SU PRESENTACIÓN COMO UPSELL, con sus burbujas traducidas igual que la
          // entrega. Ver `limpiaPresentacionUpsell`.
          presentacion_upsell: limpiaPresentacionUpsell(
            item?.presentacion_upsell,
            pasosParaLaPantalla,
            readGruposDeIntro
          ),
        })
      )
    : [];
  /** Las filas de upsells, una por tienda. Ver `limpiaFilasDeUpsell`. */
  const filas_de_upsell = limpiaFilasDeUpsell(config?.filas_de_upsell, pasosParaLaPantalla);
  // LAS VERSIONES GUARDADAS DE UN CAJÓN.
  //
  // Es una libreta, no una pieza del embudo: el motor no la lee nunca. Guarda
  // copias del contenido de la intro de la oferta y de la del upsell para poder
  // volver a una anterior sin haberla perdido.
  //
  // VIVE ARRIBA, EN SU PROPIA LISTA, y eso no es un detalle. Dentro del bloque de
  // la oferta se perdería igual que se pierde hoy el duplicado de un cajón; aquí
  // se guarda por el mismo camino que la biblioteca de productos, que sí guarda.
  //
  // Las burbujas se traducen como las de cualquier otra secuencia: la pantalla
  // usa `texts` y el motor `body_variants`. Aunque el motor no las lea, guardar
  // en el otro formato haría que al cargar una versión salieran vacías.
  const biblioteca_de_intros = Array.isArray(config?.biblioteca_de_intros)
    ? (config.biblioteca_de_intros as Record<string, unknown>[]).map(
        (item, i) => ({
          id: str(item?.id) || `intro_${i + 1}`,
          name: str(item?.name),
          lugar: str(item?.lugar) === "upsell" ? "upsell" : "order_bump",
          activa: item?.activa === true,
          steps: Array.isArray(item?.steps)
            ? (item.steps as Record<string, unknown>[]).map(readStep)
            : [],
        })
      )
    : [];
  // LA ALINEACIÓN: qué producto juega cada puesto, en cada modalidad.
  //
  // Se limpia lo único que puede venir roto de un archivo tocado a mano: que el
  // puesto sea uno de los conocidos y que apunte a un id. Un puesto inventado
  // llenaría una caja que no existe, o ninguna, sin decir nada.
  const PUESTOS_CONOCIDOS = [
    "unico",
    "basico",
    "complementario",
    "full",
    "upsell",
  ];
  const alineacion_por_modalidad = esMapa(config?.alineacion_por_modalidad)
    ? Object.fromEntries(
        Object.entries(config.alineacion_por_modalidad).map(
          ([modo, puestos]) => [
            modo,
            esMapa(puestos)
              ? Object.fromEntries(
                  Object.entries(puestos)
                    .filter(
                      ([puesto, id]) =>
                        PUESTOS_CONOCIDOS.includes(puesto) && str(id).trim()
                    )
                    .map(([puesto, id]) => [puesto, str(id).trim()])
                )
              : {},
          ]
        )
      )
    : {};
  const post_sale_reoffer = config?.post_sale_reoffer !== false;
  // El recordatorio de correo tras el regalo tiene su propio interruptor. Sin
  // valor guardado hereda el del re-ofrecimiento, que es con quien iba pegado:
  // así la pantalla enseña exactamente lo que el bot hace hoy.
  const post_sale_email_reminder_enabled =
    typeof config?.post_sale_email_reminder_enabled === "boolean"
      ? config.post_sale_email_reminder_enabled
      : post_sale_reoffer;
  const email_reminder_text = str(config?.email_reminder_text);
  const email_reminder_steps = Array.isArray(config?.email_reminder_steps)
    ? (config.email_reminder_steps as Record<string, unknown>[]).map(readStep)
    : [];
  // La frase que enmarca un REENVÍO de los datos de pago. Se lee y se escribe
  // aquí: un campo que el editor guarda y la API no conoce es un campo muerto,
  // que es justo lo que este bot ya tenía y estamos quitando.
  const payment_resend_steps = Array.isArray(config?.payment_resend_steps)
    ? (config.payment_resend_steps as Record<string, unknown>[]).map(readStep)
    : [];
  const post_gift_comment_auto_human_enabled =
    config?.post_gift_comment_auto_human_enabled === true;
  // Pre-llenamos con los DEFAULTS visibles (texto/prompt/botones) cuando el
  // YAML está vacío, para que TODO lo que el bot envía sea visible y editable
  // desde el panel — nada oculto en el código (clave para clonar el bot).
  const payment_buttons_prompt = semilla(
    config?.payment_buttons_prompt,
    DEFAULT_PAYMENT_BUTTONS_PROMPT
  );
  const payment_buttons_raw = Array.isArray(config?.payment_buttons)
    ? (config.payment_buttons as Record<string, unknown>[]).map((b) => ({
        label: str(b?.label),
        method: str(b?.method),
        aliases: strList(b?.aliases),
        principal: b?.principal === true,
        // Ausente = encendido, para no apagar nada de lo ya configurado.
        enabled: b?.enabled !== false,
      }))
    : [];
  const payment_buttons =
    payment_buttons_raw.length > 0 ? payment_buttons_raw : getPaymentButtons();
  const payment_text = str(config?.payment_text) || DEFAULT_PAYMENT_TEXT;
  const country_mode =
    config?.country_mode === "auto_phone" ? "auto_phone" : "fixed";
  const messengerCountryPromptRaw = (config?.messenger_country_prompt ?? {}) as Record<
    string,
    unknown
  >;
  const reaskModeRaw = messengerCountryPromptRaw.reask_mode;
  const messenger_country_prompt = {
    enabled: messengerCountryPromptRaw.enabled === true,
    message: str(messengerCountryPromptRaw.message),
    reminder_enabled: messengerCountryPromptRaw.reminder_enabled === true,
    reminder_delay_minutes:
      typeof messengerCountryPromptRaw.reminder_delay_minutes === "number" &&
      Number.isFinite(messengerCountryPromptRaw.reminder_delay_minutes)
        ? Math.max(1, Math.round(messengerCountryPromptRaw.reminder_delay_minutes))
        : 5,
    reminder_message: str(messengerCountryPromptRaw.reminder_message),
    reask_mode:
      reaskModeRaw === "microcall" || reaskModeRaw === "llm"
        ? reaskModeRaw
        : "spintax",
    reask_variants: Array.isArray(messengerCountryPromptRaw.reask_variants)
      ? (messengerCountryPromptRaw.reask_variants as unknown[])
          .map((v) => str(v))
          .filter(Boolean)
      : [],
    reask_instruction: str(messengerCountryPromptRaw.reask_instruction),
  };
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
      ["lineal", "order_bump", "bioferta", "doble_oferta_dos", "doble_oferta_upsell", "upsell"].map((mode) => [
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
  const country_sales_whitelist = config?.country_sales_whitelist === true;
  const country_disabled_message = str(config?.country_disabled_message);
  const modality_pricing =
    config?.modality_pricing && typeof config.modality_pricing === "object"
      ? (config.modality_pricing as Record<string, unknown>)
      : {};
  const venezuela_redirect_enabled = config?.venezuela_redirect_enabled === true;
  const venezuela_redirect_message = str(config?.venezuela_redirect_message);
  const venezuela_redirect_human_delay_minutes = num(
    config?.venezuela_redirect_human_delay_minutes,
    5
  );
  const profilesRaw =
    config?.payment_profiles_by_country &&
    typeof config.payment_profiles_by_country === "object"
      ? (config.payment_profiles_by_country as Record<string, unknown>)
      : {};
  // Lee un perfil de pago por país (BASE o capa de modalidad) con la MISMA forma.
  const readCountryProfile = (rawProfile: unknown) => {
    const p = (rawProfile ?? {}) as Record<string, unknown>;
    const profileButtons = Array.isArray(p?.payment_buttons)
      ? (p.payment_buttons as Record<string, unknown>[]).map((b) => ({
          label: str(b?.label),
          method: str(b?.method),
          aliases: strList(b?.aliases),
          principal: b?.principal === true,
          enabled: b?.enabled !== false,
        }))
      : [];
    const profileResponses = (p?.payment_responses ?? {}) as Record<
      string,
      unknown
    >;
    const responseEntries = Object.entries(profileResponses).map(
      ([method, steps]) => [method, readSteps(steps)]
    );
    return {
      enabled: p?.enabled !== false,
      course_price_soles: num(p?.course_price_soles, 0),
      discount_price_soles: num(p?.discount_price_soles, 0),
      market_price: num(p?.market_price, 0),
      price_label_case: estiloDeMoneda(p?.price_label_case),
      payment_validation: {
        yape_recipient_name_starts_with: str(
          (p?.payment_validation as Record<string, unknown> | undefined)
            ?.yape_recipient_name_starts_with
        ),
        require_receipt_date:
          (p?.payment_validation as Record<string, unknown> | undefined)
            ?.require_receipt_date === true,
      },
      payment_text: str(p?.payment_text),
      // LO QUE DICE AL MANDAR LOS DATOS DE PAGO, PROPIO DE ESTA MODALIDAD Y PAÍS.
      //
      // El global vive arriba y es UNO para todo el bot. En Lineal ese era el
      // único texto que el cliente recibía al ir a pagar, así que
      // personalizarlo se lo cambiaba a las demás modalidades. Aquí puede ser
      // suyo; vacío = el global de siempre.
      direct_payment_steps: (Array.isArray(p?.direct_payment_steps)
        ? (p.direct_payment_steps as Record<string, unknown>[])
        : []
      ).map(readStep),
      direct_payment_cta: str(p?.direct_payment_cta),
      payment_buttons: profileButtons,
      payment_responses: Object.fromEntries(responseEntries),
      order_bump: {
        combo_price_soles: num((p?.order_bump as Record<string, unknown> | undefined)?.combo_price_soles, 0),
        combo_discount_price_soles: num((p?.order_bump as Record<string, unknown> | undefined)?.combo_discount_price_soles, 0),
        basico_price_soles: num((p?.order_bump as Record<string, unknown> | undefined)?.basico_price_soles, 0),
        basico_discount_price_soles: num((p?.order_bump as Record<string, unknown> | undefined)?.basico_discount_price_soles, 0),
        // El «antes» tachado de la opción cara. Sin esta línea el campo se
        // descartaría al guardar y el comodín saldría vacío para siempre, sin
        // que nadie entienda por qué: la casilla del editor se veía llena.
        combo_market_price: num((p?.order_bump as Record<string, unknown> | undefined)?.combo_market_price, 0),
        // Cómo sale la moneda de la opción cara: May, Min o solo el símbolo.
        // Sin esta línea el botón se veria puesto y al guardar volveria atras.
        combo_price_label_case: estiloDeMoneda(
          (p?.order_bump as Record<string, unknown> | undefined)?.combo_price_label_case
        ),
      },
      bioferta: {
        pack_price_soles: num((p?.bioferta as Record<string, unknown> | undefined)?.pack_price_soles, 0),
        pack_discount_price_soles: num((p?.bioferta as Record<string, unknown> | undefined)?.pack_discount_price_soles, 0),
      },
      // El TERCER producto de "Doble Oferta + Upsell", por país. Sin esto la
      // capa se descartaba al guardar y el precio volvía al global sin avisar.
      upsell: {
        price_soles: num((p?.upsell as Record<string, unknown> | undefined)?.price_soles, 0),
        discount_price_soles: num((p?.upsell as Record<string, unknown> | undefined)?.discount_price_soles, 0),
        // Y el «antes» del tercer producto, por el mismo motivo.
        market_price: num((p?.upsell as Record<string, unknown> | undefined)?.market_price, 0),
        price_label_case: estiloDeMoneda(
          (p?.upsell as Record<string, unknown> | undefined)?.price_label_case
        ),
      },
      metodo_pago_1: str(p?.metodo_pago_1),
      metodo_pago_2: str(p?.metodo_pago_2),
      metodo_pago_3: str(p?.metodo_pago_3),
      metodo_pago_principal: str(p?.metodo_pago_principal),
      numero_de_cuenta: str(p?.numero_de_cuenta),
      // UNA CUENTA POR MÉTODO. En un país se cobra por billetera Y por banco, y
      // son cuentas distintas: con una sola casilla los números se quedaban
      // escritos a mano dentro de las burbujas.
      cuentas_por_metodo: leeCuentasPorMetodo(p?.cuentas_por_metodo),
      // TU NOMBRE COMPLETO, el de leer. Va en esta lista o no se guarda: lo que
      // no está nombrado aquí se cae al guardar, en silencio y sin error.
      nombre_completo: str(p?.nombre_completo),
      // EL AVATAR DEL TITULAR DEL PAÍS (29/10/2026), solo para la pantalla: el Inicio de cada país muestra quién
      // cobra ahí. Nunca viaja al cliente. Solo si tiene algo.
      ...(str(p?.foto).trim() ? { foto: str(p?.foto).trim() } : {}),
    };
  };
  const payment_profiles_by_country = Object.fromEntries(
    Object.entries(profilesRaw).map(([country, rawProfile]) => [
      country,
      readCountryProfile(rawProfile),
    ])
  );
  // CAPAS por modalidad: mismo perfil por país, una capa por modalidad.
  const mppRaw =
    config?.modality_payment_profiles &&
    typeof config.modality_payment_profiles === "object"
      ? (config.modality_payment_profiles as Record<string, unknown>)
      : {};
  const modality_payment_profiles = Object.fromEntries(
    Object.entries(mppRaw).map(([mode, byCountry]) => [
      mode,
      Object.fromEntries(
        Object.entries((byCountry ?? {}) as Record<string, unknown>).map(
          ([cc, rp]) => [cc, readCountryProfile(rp)]
        )
      ),
    ])
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
  // Overrides POR PAÍS de una opción: textos crudos (vacío = hereda del base en
  // runtime; NO se rellenan con inheritedPaymentSteps).
  const readObCountryOverrides = (raw: unknown) => {
    const src = (raw ?? {}) as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [cc, v] of Object.entries(src)) {
      const o = (v ?? {}) as Record<string, unknown>;
      const entry: Record<string, unknown> = {};
      const resp = readSteps(o?.response);
      const dpp = readSteps(o?.direct_payment_prompt);
      if (resp.length) entry.response = resp;
      if (dpp.length) entry.direct_payment_prompt = dpp;
      const prSrc = (o?.payment_responses ?? {}) as Record<string, unknown>;
      const prOut: Record<string, unknown> = {};
      for (const m of ["yape", "bcp_transferencia", "efectivo"] as const) {
        const s = readSteps(prSrc?.[m]);
        if (s.length) prOut[m] = s;
      }
      if (Object.keys(prOut).length) entry.payment_responses = prOut;
      if (Object.keys(entry).length) out[cc] = entry;
    }
    return out;
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
      direct_payment_prompt_enabled: x?.direct_payment_prompt_enabled === true,
      direct_payment_prompt: readSteps(x?.direct_payment_prompt),
      response: readSteps(x?.response),
      // Las respuestas alternativas del producto. Sin esta linea se
      // descartarian al recargar y pareceria que no se guardaron.
      response_variants: Array.isArray(x?.response_variants)
        ? (x.response_variants as Record<string, unknown>[]).map((v) => ({
            id: str(v?.id),
            name: str(v?.name),
            color: str(v?.color),
            enabled: v?.enabled !== false,
            steps: readSteps(v?.steps),
          }))
        : [],
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
      by_country: readObCountryOverrides(x?.by_country),
    };
  };
  const order_bump = {
    enabled: obCfg?.enabled === true,
    use_buttons: obCfg?.use_buttons === true,
    intro: readSteps(obCfg?.intro),
    intro_groups: readGruposDeIntro(obCfg?.intro_groups),
    choice_prompt: semilla(obCfg?.choice_prompt, DEFAULT_CHOICE_PROMPT),
    choice_clarification: str(obCfg?.choice_clarification),
    price_question_response: str(obCfg?.price_question_response),
    price_question_response_steps: Array.isArray(obCfg?.price_question_response_steps)
      ? readSteps(obCfg?.price_question_response_steps)
      : undefined,
    // El mismo recordatorio para quien venía de un solo producto. Vacío = usa el
    // texto del dueño que trae el motor. Ver `hayQueAvisarDeLaActualizacion`.
    aviso_actualizacion: str(obCfg?.aviso_actualizacion),
    aviso_actualizacion_steps: Array.isArray(obCfg?.aviso_actualizacion_steps)
      ? readSteps(obCfg?.aviso_actualizacion_steps)
      : undefined,
    price_choice_confirmation: str(obCfg?.price_choice_confirmation),
    price_choice_confirmation_steps: Array.isArray(obCfg?.price_choice_confirmation_steps)
      ? readSteps(obCfg?.price_choice_confirmation_steps)
      : undefined,
    combo_upgrade_message: str(obCfg?.combo_upgrade_message),
    combo_upgrade_steps: Array.isArray(obCfg?.combo_upgrade_steps)
      ? readSteps(obCfg?.combo_upgrade_steps)
      : undefined,
    partial_payment_choice_message: str(obCfg?.partial_payment_choice_message),
    partial_payment_choice_steps: Array.isArray(obCfg?.partial_payment_choice_steps)
      ? readSteps(obCfg?.partial_payment_choice_steps)
      : undefined,
    choice_helper: readSteps(obCfg?.choice_helper),
    choice_helper_enabled: obCfg?.choice_helper_enabled === true,
    offer_on_reengaged_price: obCfg?.offer_on_reengaged_price === true,
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
    choice_prompt: semilla(ddCfg?.choice_prompt, DEFAULT_CHOICE_PROMPT),
    // Solo un false explícito apaga. Ausente = encendido, que es como se
    // comportaba antes de que existiera el interruptor.
    choice_prompt_enabled: ddCfg?.choice_prompt_enabled !== false,
    choice_buttons_prompt: semilla(
      ddCfg?.choice_buttons_prompt,
      DEFAULT_CHOICE_BUTTONS_PROMPT
    ),
    choice_clarification: str(ddCfg?.choice_clarification),
    combo: readObOption(ddCfg?.combo),
    basico: readObOption(ddCfg?.basico),
  };

  const bioferta = {
    enabled: bfCfg?.enabled === true,
    use_buttons: bfCfg?.use_buttons === true,
    pack_price_soles: num(bfCfg?.pack_price_soles, 0),
    pack_discount_price_soles: num(bfCfg?.pack_discount_price_soles, 0),
    // Producto 1: puede tener SU PROPIA entrega, como el 2 y el pack. Si la
    // deja vacía cae a payment_approved (pestaña "Entrega"), como hasta hoy.
    product_a: readProduct(bfCfg?.product_a, true),
    product_b: readProduct(bfCfg?.product_b, true),
    pack: readProduct(bfCfg?.pack, true),
    ask_choice_text: semilla(
      bfCfg?.ask_choice_text,
      DEFAULT_BIOFERTA_ASK_CHOICE_TEXT
    ),
    // Los dos interruptores van con "!== false": una config que nunca los tocó
    // los tiene encendidos, así que leerlos como `=== true` los apagaría solo.
    choice_on_intro_enabled: bfCfg?.choice_on_intro_enabled !== false,
    intro_choice_prompt: semilla(
      bfCfg?.intro_choice_prompt,
      DEFAULT_BIOFERTA_INTRO_CHOICE_PROMPT
    ),
    choice_confirmation_enabled: bfCfg?.choice_confirmation_enabled !== false,
    choice_confirmation_text: str(bfCfg?.choice_confirmation_text),
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
    // Los botones del saludo con elección. Sin ellos, el saludo es el texto
    // cosmético de siempre: la lista vacía ES el interruptor apagado.
    buttons: readBubbleButtons(grCfg?.buttons),
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
  // El correo del SEGUNDO producto. Va aparte por lo mismo que su entrega:
  // quien compró el extra necesita SU acceso, no otra copia del que ya tiene.
  const emUpsellCfg = (config?.email_template_upsell ?? {}) as Record<
    string,
    unknown
  >;
  const email_upsell = {
    from_name: str(emUpsellCfg?.from_name),
    subject: str(emUpsellCfg?.subject),
    body: str(emUpsellCfg?.body),
  };

  const gm = (config?.gift_mechanic ?? {}) as Record<string, unknown>;
  const gift = {
    has: Boolean(config?.gift_mechanic),
    registry_sync_enabled: gm?.registry_sync_enabled !== false,
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
    registry_sync_backup: Array.isArray(gm?.registry_sync_backup)
      ? (gm.registry_sync_backup as Record<string, unknown>[]).map((v) => ({
          weight: num(v?.weight, 0),
          text: str(v?.text),
          label: str(v?.label),
          ads_reader_id: num(v?.ads_reader_id, 0) || undefined,
          ad_link: str(v?.ad_link),
          registry_ad_id: str(v?.registry_ad_id),
          registry_ad_key: str(v?.registry_ad_key),
          registry_color: str(v?.registry_color),
          registry_template: v?.registry_template === true,
          enabled: v?.enabled !== false,
          ad_ids: strList(v?.ad_ids),
          separator: typeof v?.separator === "string" ? v.separator : undefined,
        }))
      : undefined,
    variants: Array.isArray(gm?.ask_text_variants)
      ? (gm.ask_text_variants as Record<string, unknown>[]).map((v) =>
          typeof v?.separator === "string"
            ? { weight: 0, text: "", ad_ids: [], separator: v.separator }
            : {
                weight: num(v?.weight, 0),
                text: str(v?.text),
                label: str(v?.label),
                ads_reader_id: num(v?.ads_reader_id, 0) || undefined,
                ad_link: str(v?.ad_link),
                registry_ad_id: str(v?.registry_ad_id),
                registry_ad_key: str(v?.registry_ad_key),
                registry_color: str(v?.registry_color),
                registry_template: v?.registry_template === true,
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
          caption_variants: strList(g?.caption_variants),
          // Las burbujas que acompañan a esta muestra. Se traducen como las de
          // cualquier otra secuencia, o la pantalla las vería vacías.
          pasos_extra: Array.isArray(g?.pasos_extra)
            ? (g.pasos_extra as Record<string, unknown>[]).map(readStep)
            : [],
          enabled: g?.enabled !== false,
        }))
      : [];
  const image_gallery = readGallery(config?.image_gallery);
  const samples_after_sequence = readSteps(config?.samples_after_sequence);
  const image_gallery_2 = readGallery(config?.image_gallery_2);

  // UPSELL: la segunda venta, después de entregar la primera. APAGADO por
  // defecto; sin encenderlo, tras entregar sigue el regalo de siempre.
  // Va aquí abajo porque necesita readGallery, que se declara justo arriba.
  const upCfg = (config?.upsell ?? {}) as Record<string, unknown>;
  const upsell = {
    enabled: upCfg?.enabled === true,
    name: str(upCfg?.name),
    aliases: strList(upCfg?.aliases),
    intro: readSteps(upCfg?.intro),
    intro_groups: readGruposDeIntro(upCfg?.intro_groups),
    pregunta_steps: readPreguntaSteps(upCfg),
    pregunta: str(upCfg?.pregunta),
    use_buttons: upCfg?.use_buttons === true,
    boton_si: str(upCfg?.boton_si),
    boton_no: str(upCfg?.boton_no),
    price_soles: num(upCfg?.price_soles, 0),
    discount_price_soles: num(upCfg?.discount_price_soles, 0),
    info_steps: readSteps(upCfg?.info_steps),
    course_content: str(upCfg?.course_content),
    image_gallery: readGallery(upCfg?.image_gallery),
    respuesta_generica: str(upCfg?.respuesta_generica),
    delivery: readSteps(upCfg?.delivery),
    espera_minutos: num(upCfg?.espera_minutos, 30) || 30,
    retraso_minutos: num(upCfg?.retraso_minutos, 0),
    respuesta_rechazo: str(upCfg?.respuesta_rechazo),
    // EL RECORDATORIO. No olvidar ningún campo aquí: esta lista es un
    // ALLOWLIST, no una copia. Lo que no se nombre se pierde al guardar sin
    // decir nada —es el mismo fallo del cajón que se duplicaba y desaparecía al
    // refrescar, que costó tres arreglos en tres sitios equivocados—.
    recordatorio: str(upCfg?.recordatorio),
  };

  // DOBLE OFERTA + UPSELL: las dos opciones con la misma forma que las otras
  // secciones de dos opciones, y su propio tercer producto DENTRO. Se lee con
  // los mismos ayudantes para no estrenar otra manera de leer lo mismo.
  const duCfg = (config?.doble_oferta_upsell ?? {}) as Record<string, unknown>;
  const duUp = (duCfg?.upsell ?? {}) as Record<string, unknown>;
  const doble_oferta_upsell = {
    enabled: duCfg?.enabled === true,
    use_buttons: duCfg?.use_buttons === true,
    separate_bubble: duCfg?.separate_bubble === true,
    basico_first: duCfg?.basico_first === true,
    choice_prompt: semilla(duCfg?.choice_prompt, DEFAULT_CHOICE_PROMPT),
    choice_prompt_enabled: duCfg?.choice_prompt_enabled !== false,
    choice_buttons_prompt: semilla(
      duCfg?.choice_buttons_prompt,
      DEFAULT_CHOICE_BUTTONS_PROMPT
    ),
    choice_clarification: str(duCfg?.choice_clarification),
    combo: readObOption(duCfg?.combo),
    basico: readObOption(duCfg?.basico),
    upsell: {
      enabled: duUp?.enabled === true,
      name: str(duUp?.name),
      aliases: strList(duUp?.aliases),
      intro: readSteps(duUp?.intro),
      intro_groups: readGruposDeIntro(duUp?.intro_groups),
      pregunta_steps: readPreguntaSteps(duUp),
      pregunta: str(duUp?.pregunta),
      use_buttons: duUp?.use_buttons === true,
      boton_si: str(duUp?.boton_si),
      boton_no: str(duUp?.boton_no),
      price_soles: num(duUp?.price_soles, 0),
      discount_price_soles: num(duUp?.discount_price_soles, 0),
      info_steps: readSteps(duUp?.info_steps),
      course_content: str(duUp?.course_content),
      image_gallery: readGallery(duUp?.image_gallery),
      respuesta_generica: str(duUp?.respuesta_generica),
      delivery: readSteps(duUp?.delivery),
      espera_minutos: num(duUp?.espera_minutos, 30) || 30,
      retraso_minutos: num(duUp?.retraso_minutos, 0),
      respuesta_rechazo: str(duUp?.respuesta_rechazo),
      // El recordatorio, también aquí: -DOU- lee SU PROPIA caja de upsell, no
      // la de arriba. Si solo se nombrara en una, el campo existiría en el
      // editor y no llegaría al motor en la modalidad que él usa.
      recordatorio: str(duUp?.recordatorio),
    },
  };

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
      intro_ad_keys,
      intro_ad_routing_enabled,
      intro_paises,
      intro_pais_routing_enabled,
      intro_semimodalidades,
      intro_tiendas,
      tiendas,
      filas_de_upsell,
      cobradores,
      regalos_guardados: leeRegalosGuardados(config?.regalos_guardados, "leer"),
      // LA PIZARRA (16/10/2026): dónde dejó cada ficha y sus cajas. El bot no la lee nunca.
      pizarra: leePizarra(config?.pizarra),
      // EL TABLERO (22/10/2026): a diferencia de la pizarra, el bot SÍ lo lee. Las burbujas van
      // en el formato del editor, como las demás.
      // Uno por tienda Y POR CANAL (23/10/2026); los guardados antes, como el de WhatsApp.
      tableros: leeTablerosPorTienda(config?.tableros, (pasos) =>
        pasos.map((p) => readStep(p as Record<string, unknown>))
      ),
      // Los WORKFLOWS: tableros sin tienda que arrancan cuando algo los activa.
      workflows: leeTableros(config?.workflows, (pasos) =>
        pasos.map((p) => readStep(p as Record<string, unknown>))
      ),
      ad_registry,
      ad_color_palette,
      intro_payment_menu: readPaymentMenu(config?.intro_payment_menu),
      course_content: str(config?.course_content),
      product_name: str(config?.product_name) || "Producto principal",
      image_gallery,
      samples_after_sequence,
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
      // Las cuatro respuestas de emergencia. Vacías = sale la de siempre, que
      // vive en `openrouter.ts`; el editor las muestra como referencia.
      emergencia_no_entendi: str(config?.emergencia_no_entendi),
      emergencia_respuesta_cortada: str(config?.emergencia_respuesta_cortada),
      emergencia_sin_respuesta: str(config?.emergencia_sin_respuesta),
      emergencia_sin_respuesta_con_pago: str(
        config?.emergencia_sin_respuesta_con_pago
      ),
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
      editor_colores_de_botones,
      payment_validation,
      payment_methods,
      direct_payment_enabled,
      direct_payment_steps,
      direct_payment_cta,
      direct_payment_without_choice_steps,
      direct_payment_without_choice_cta,
      commercial_routes,
      post_sale_delivery_preference,
      notification_settings,
      payment_method_buttons,
      payment_buttons_prompt,
      payment_buttons,
      payment_text,
      country_mode,
      messenger_country_prompt,
      country_sales_enabled,
      country_sales_whitelist,
      country_disabled_message,
      modality_pricing,
      venezuela_redirect_enabled,
      venezuela_redirect_message,
      venezuela_redirect_human_delay_minutes,
      payment_profiles_by_country,
      modality_payment_profiles,
      channels,
      salesbot,
      country_ecuador,
      bioferta,
      order_bump,
      doble_oferta_dos,
      doble_oferta_upsell,
      upsell,
      // El interruptor de la MODALIDAD Upsell, separado del de su etapa. Sin
      // esto no volvería al editor y la modalidad se vería apagada aunque
      // estuviera vendiendo. Se manda tal cual está —incluido «no está»— para
      // que el editor pueda distinguir un archivo aún sin migrar.
      upsell_modalidad_enabled:
        typeof config?.upsell_modalidad_enabled === "boolean"
          ? config.upsell_modalidad_enabled
          : undefined,
      moderacion,
      silent_mode,
      followups_enabled,
      intro_variant_rotation_enabled,
      progressive_samples_enabled,
      progressive_samples_max_per_batch,
      progressive_samples_more_text,
      order_bump_option_presentation_rule,
      custom_placeholders,
      biblioteca_de_productos,
      biblioteca_de_intros,
      alineacion_por_modalidad,
      post_sale_reoffer,
      post_sale_email_reminder_enabled,
      email_reminder_text,
      email_reminder_steps,
      payment_resend_steps,
      post_gift_comment_auto_human_enabled,
      modality_templates: config?.modality_templates,
      comment_automation,
      payment_approved,
      customer_survey_enabled,
      customer_survey_auto_human_enabled,
      customer_survey_message,
      greeting,
      email,
      email_vip,
      email_upsell,
      prompt_sections,
      prompt_section_defaults,
      prompt_section_defs,
      gift,
      // LA HUELLA DEL ARCHIVO QUE SE ABRIÓ (18/10/2026). Ver `huellaDelArchivo`.
      version_del_archivo: huellaDelArchivo(raw),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

/**
 * LA HUELLA DEL ARCHIVO (18/10/2026): «no quiero pasar esta vergüenza». Una pestaña abierta antes
 * de otro guardado —otra pestaña, o un arreglo subido mientras tanto— tiene la versión VIEJA, y
 * al guardar la escribía encima: así se habría vuelto a perder la ruta COMO OB que se devolvió.
 * El editor manda la huella con la que abrió; si el archivo ya es otro, no se guarda sin preguntar.
 */
function huellaDelArchivo(raw: string): string {
  return createHash("sha256").update(raw.replace(/\r\n/g, "\n")).digest("hex").slice(0, 16);
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

  // EL CANDADO DE LA PESTAÑA VIEJA (18/10/2026). Solo si el editor manda su huella (uno viejo,
  // sin ella, guarda como siempre) y no pidió guardar encima a sabiendas.
  const suHuella = typeof body.version_del_archivo === "string" ? body.version_del_archivo : "";
  if (suHuella && body.guardar_encima !== true && suHuella !== huellaDelArchivo(raw)) {
    return NextResponse.json(
      {
        error: "El archivo cambió desde que abriste el editor.",
        otraVersion: true,
      },
      { status: 409 }
    );
  }

  const doc = documentoDelArchivo(raw);
  // LO QUE HABÍA, para el seguro contra el vaciado (más abajo). Se toma AQUÍ, del documento ya leído
  // y antes de cambiarlo, en vez de volver a leer el archivo entero (25/10/2026: cada lectura de 5 MB
  // son segundos de espera al guardar).
  const loQueHabia = doc.toJS() as Record<string, unknown>;

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
  if (Array.isArray(body.intro_ad_keys)) {
    doc.set(
      "intro_ad_keys",
      (body.intro_ad_keys as unknown[]).map((keys) => strList(keys))
    );
  }
  if (Array.isArray(body.intro_ad_routing_enabled)) {
    doc.set(
      "intro_ad_routing_enabled",
      (body.intro_ad_routing_enabled as unknown[]).map((value) => value !== false)
    );
  }
  // La bandera de los cajones de intro, por el mismo carril que la etiqueta de
  // ads. Sin estas dos líneas se elige en pantalla y desaparece al refrescar.
  if (Array.isArray(body.intro_paises)) {
    doc.set(
      "intro_paises",
      (body.intro_paises as unknown[]).map((keys) => strList(keys))
    );
  }
  if (Array.isArray(body.intro_pais_routing_enabled)) {
    doc.set(
      "intro_pais_routing_enabled",
      (body.intro_pais_routing_enabled as unknown[]).map((value) => value !== false)
    );
  }
  // LA SEMIMODALIDAD POR INTRO, o no sobrevive al guardado. Es el mismo carril
  // que la bandera y el mismo motivo: este archivo reconstruye campo por campo.
  if (Array.isArray(body.intro_semimodalidades)) {
    doc.set(
      "intro_semimodalidades",
      (body.intro_semimodalidades as unknown[]).map(leeSemimodalidad)
    );
  }
  // LAS TIENDAS POR INTRO, por el mismo carril. La cuarta etiqueta se perdería
  // igual de callada que las otras tres.
  if (Array.isArray(body.intro_tiendas)) {
    doc.set(
      "intro_tiendas",
      (body.intro_tiendas as unknown[]).map((ids) => strList(ids))
    );
  }
  // LAS TIENDAS. Mismo carril y mismo motivo: este archivo reconstruye campo por
  // campo y lo que no se nombre no llega al bot.
  if (Array.isArray(body.tiendas)) {
    doc.set("tiendas", leeTiendas(body.tiendas, "escribir"));
  }
  // LOS REGALOS GUARDADOS, por el mismo carril. Solo si el panel los manda.
  if (Array.isArray(body.regalos_guardados)) {
    const lista = leeRegalosGuardados(body.regalos_guardados, "escribir");
    if (lista.length > 0 || doc.has("regalos_guardados")) doc.set("regalos_guardados", lista);
  }
  // EL TABLERO, por el mismo carril. Solo si el panel lo manda: un editor viejo no lo borra.
  if (body.tableros && typeof body.tableros === "object") {
    doc.set(
      "tableros",
      leeTablerosPorTienda(body.tableros, (pasos) => pasos.map((p) => writeStep(p as EditorStep)))
    );
  }
  if (body.workflows && typeof body.workflows === "object") {
    doc.set(
      "workflows",
      leeTableros(body.workflows, (pasos) => pasos.map((p) => writeStep(p as EditorStep)))
    );
  }
  // LA PIZARRA, por el mismo carril: lo que no se nombra aquí no llega al archivo. Solo se
  // escribe si el panel la manda, así que un editor viejo no la borra.
  if (body.pizarra && typeof body.pizarra === "object") {
    doc.set("pizarra", leePizarra(body.pizarra));
  }
  // EL ALMACÉN DE USUARIOS QUE COBRAN, por el mismo carril.
  if (Array.isArray(body.cobradores)) {
    doc.set("cobradores", leeCobradores(body.cobradores));
  }
  if (Array.isArray(body.ad_registry)) {
    doc.set("ad_registry", blockNode(doc, readAdRegistry(body.ad_registry)));
  }
  if (Array.isArray(body.ad_color_palette)) {
    const palette = (body.ad_color_palette as unknown[])
      .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
      .map((entry) => ({ label: str(entry.label).trim(), value: str(entry.value).trim() }))
      .filter((entry) => /^#[0-9a-fA-F]{6}$/.test(entry.value));
    doc.set("ad_color_palette", blockNode(doc, palette));
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
      // EL NOMBRE PUEDE QUEDARSE VACÍO, Y ANTES NO PODÍA.
      //
      // Al borrarlo entero se guardaba «seguimiento» y reaparecía al recargar:
      // parecía que el campo no dejaba borrar. El nombre es un rótulo para el
      // operador —el motor solo lo escribe en el registro, y ahí ya tiene su
      // propio respaldo—, así que vacío es una respuesta válida.
      name: str(f?.name),
      delay_minutes_from_first_message: num(
        f?.delay_minutes_from_first_message,
        0
      ),
      // enabled solo se escribe cuando está apagado → YAML limpio
      ...(f?.enabled === false ? { enabled: false } : {}),
      // Toggles de horario: solo se escriben cuando están encendidos
      ...(f?.ignore_quiet_hours === true ? { ignore_quiet_hours: true } : {}),
      ...(f?.ignore_late_lead_defer === true
        ? { ignore_late_lead_defer: true }
        : {}),
      ...(f?.steps_enabled === false ? { steps_enabled: false } : {}),
      ...(Array.isArray(f?.ad_keys) && f.ad_keys.length > 0
        ? { ad_keys: strList(f.ad_keys) }
        : {}),
      // EL INTERRUPTOR DE LA ETIQUETA, QUE NO SE GUARDABA EN NINGÚN SITIO.
      //
      // El botón ON/OFF existe en la pantalla desde que existen las etiquetas,
      // y el motor lo obedece (`engine.ts`), pero nadie lo escribía: se
      // apagaba, se guardaba, y al refrescar estaba encendido otra vez. Como
      // el resto del archivo, solo se escribe lo apagado.
      ...(f?.ad_routing_enabled === false
        ? { ad_routing_enabled: false }
        : {}),
      ...(Array.isArray(f?.paises) && f.paises.length > 0
        ? { paises: strList(f.paises) }
        : {}),
      ...(f?.pais_routing_enabled === false
        ? { pais_routing_enabled: false }
        : {}),
      // La semimodalidad, o no sobrevive al guardado. Ver `writeGruposDeIntro`.
      ...(leeSemimodalidad(f?.semimodalidad)
        ? { semimodalidad: leeSemimodalidad(f?.semimodalidad) }
        : {}),
      // Y las tiendas, la cuarta etiqueta, por ese mismo carril.
      ...(strList(f?.tiendas).length > 0 ? { tiendas: strList(f?.tiendas) } : {}),
      ...(f?.offer_choice_menu_enabled === true
        ? { offer_choice_menu_enabled: true }
        : {}),
      ...(Math.floor(num(f?.steps_weight, 1)) > 1 ? { steps_weight: Math.floor(num(f?.steps_weight, 1)) } : {}),
      steps: (Array.isArray(f?.steps) ? f.steps : []).map(writeStep),
      ...(Array.isArray(f?.variants) && f.variants.length > 0
        ? {
            variants: f.variants.map((v, i) => ({
              name: str(v?.name) || `variante_${i + 2}`,
              ...(v?.enabled === false ? { enabled: false } : {}),
              ...(Math.floor(num(v?.weight, 1)) > 1 ? { weight: Math.floor(num(v?.weight, 1)) } : {}),
              ...(Array.isArray(v?.ad_keys) && v.ad_keys.length > 0
                ? { ad_keys: strList(v.ad_keys) }
                : {}),
              ...(v?.ad_routing_enabled === false
                ? { ad_routing_enabled: false }
                : {}),
              ...(Array.isArray(v?.paises) && v.paises.length > 0
                ? { paises: strList(v.paises) }
                : {}),
              ...(v?.pais_routing_enabled === false
                ? { pais_routing_enabled: false }
                : {}),
              ...(leeSemimodalidad(v?.semimodalidad)
                ? { semimodalidad: leeSemimodalidad(v?.semimodalidad) }
                : {}),
              ...(strList(v?.tiendas).length > 0
                ? { tiendas: strList(v?.tiendas) }
                : {}),
              // Y el camino (18/10/2026): solo si tiene uno.
              ...(leeCamino(v?.camino) ? { camino: leeCamino(v?.camino) } : {}),
              ...(leeTambienEnCaminos(v?.tambien_en_caminos).length > 0 ? { tambien_en_caminos: leeTambienEnCaminos(v?.tambien_en_caminos) } : {}),
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
        defer_late_leads_enabled: s?.defer_late_leads_enabled === true,
        defer_late_leads_after: str(s?.defer_late_leads_after),
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
      // Se guarda aunque valga 0: 0 significa «no esperes nada», y dejarlo
      // fuera lo confundiría con «sin configurar», que cae al respaldo de 8.
      "bot_debounce_seconds",
      "awaiting_email_timeout_seconds",
      "post_gift_comment_auto_human_delay_minutes",
      "customer_survey_delay_minutes",
      "no_response_delay_seconds",
      "autopurge_inactive_days",
      // Se guarda aunque valga 0: 0 es «no contestar nunca a los orgánicos».
      "organicos_tope_mensajes",
    ] as const;
    for (const k of keys) {
      if (typeof g[k] === "number" && Number.isFinite(g[k] as number)) {
        doc.set(k, g[k]);
      }
    }
    doc.set("llm_bubble_limit_enabled", g.llm_bubble_limit_enabled === true);
    // Se escribe SIEMPRE, encendido o apagado. Un booleano que solo se guarda
    // cuando es `true` no se puede apagar nunca desde el panel: la casilla se
    // desmarca, se guarda, y al recargar vuelve marcada.
    doc.set("prompt_cache_enabled", g.prompt_cache_enabled === true);
    // Por lo mismo: se escribe SIEMPRE, incluido el vacío, o no habría forma de
    // volver a «un producto» desde el panel. Y solo se aceptan los dos valores
    // buenos: cualquier otra cosa se guarda como vacío, que es «como siempre».
    doc.set(
      "segunda_opcion_prestada",
      g.segunda_opcion_prestada === "dos_juntas" ||
        g.segunda_opcion_prestada === "segunda_oculta"
        ? g.segunda_opcion_prestada
        : ""
    );
    // Por lo mismo que el de arriba: se escribe encendido Y apagado, o no
    // habría forma de volver a apagarlo desde el panel.
    doc.set("no_responder_organicos", g.no_responder_organicos === true);
    // Y el reenganche igual: escrito siempre, o el interruptor no se podría
    // volver a poner en «lineal extendida».
    doc.set("modo_reenganche", g.modo_reenganche === true);
    // Y el respaldo entre países también, escrito siempre. Al revés que los dos de arriba,
    // lo que se escribe por defecto es ENCENDIDO: es el comportamiento de siempre.
    doc.set("respaldo_entre_paises", g.respaldo_entre_paises !== false);
    doc.set("respaldo_entre_tiendas", g.respaldo_entre_tiendas !== false);
  }

  // Los colores de los botones de «Precios y pagos». Solo se escriben si el
  // panel los manda: así un guardado de una versión antigua del editor no los
  // borra. Se escriben tal cual llegan, filtrando lo que no sea texto.
  if (
    Object.prototype.hasOwnProperty.call(body, "editor_colores_de_botones") &&
    body.editor_colores_de_botones &&
    typeof body.editor_colores_de_botones === "object"
  ) {
    const limpios: Record<string, string> = {};
    for (const [clave, valor] of Object.entries(
      body.editor_colores_de_botones as Record<string, unknown>
    )) {
      if (typeof valor === "string" && valor.trim()) {
        limpios[clave] = valor.trim();
      }
    }
    doc.set("editor_colores_de_botones", blockNode(doc, limpios));
  }

  // Respuesta a comentarios de Facebook. Solo se escribe si el panel la manda,
  // así ningún guardado antiguo puede borrarla ni activarla por accidente.
  if (
    Object.prototype.hasOwnProperty.call(body, "comment_automation") &&
    body.comment_automation &&
    typeof body.comment_automation === "object"
  ) {
    const c = body.comment_automation as Record<string, unknown>;
    doc.set(
      "comment_automation",
      blockNode(doc, {
        enabled: c.enabled === true,
        accept_any: c.accept_any === true,
        one_per_person_hours: num(c.one_per_person_hours, 0),
        skip_after_ignored_enabled: c.skip_after_ignored_enabled === true,
        skip_after_ignored: num(c.skip_after_ignored, 1),
        keywords: str(c.keywords),
        message: str(c.message),
        message_steps: (Array.isArray(c.message_steps)
          ? (c.message_steps as EditorStep[])
          : []
        ).map(writeStep),
        delay_no_match_seconds: num(c.delay_no_match_seconds, 86400),
        abandon_hours: num(c.abandon_hours, 24),
        to_human_enabled: c.to_human_enabled === true,
        to_human_hours: num(c.to_human_hours, 24),
        repeat_enabled: c.repeat_enabled === true,
        repeat_count: num(c.repeat_count, 2),
      })
    );
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
  if (body.commercial_routes && typeof body.commercial_routes === "object") {
    const cr = body.commercial_routes as Record<string, unknown>;
    doc.set(
      "commercial_routes",
      blockNode(doc, {
        enabled: cr?.enabled === true,
        route_b_percentage: Math.min(
          100,
          Math.max(0, num(cr?.route_b_percentage, 50))
        ),
        replace_last_intro_steps: Math.max(
          0,
          Math.floor(num(cr?.replace_last_intro_steps, 1))
        ),
        route_b_closing_steps: Array.isArray(cr?.route_b_closing_steps)
          ? (cr.route_b_closing_steps as EditorStep[]).map(writeStep)
          : [],
        route_b_post_payment_intro: Array.isArray(
          cr?.route_b_post_payment_intro
        )
          ? (cr.route_b_post_payment_intro as EditorStep[]).map(writeStep)
          : [],
        route_b_post_payment_choice_prompt:
          typeof cr?.route_b_post_payment_choice_prompt === "string"
            ? cr.route_b_post_payment_choice_prompt.replace(/\r\n/g, "\n")
            : "",
        route_b_post_payment_use_buttons:
          cr?.route_b_post_payment_use_buttons !== false,
      })
    );
  }
  if (
    body.post_sale_delivery_preference &&
    typeof body.post_sale_delivery_preference === "object"
  ) {
    const pref = body.post_sale_delivery_preference as Record<string, unknown>;
    doc.set(
      "post_sale_delivery_preference",
      blockNode(doc, {
        enabled: pref?.enabled === true,
        use_buttons: pref?.use_buttons !== false,
        separate_bubble: pref?.separate_bubble === true,
        prompt_text:
          typeof pref?.prompt_text === "string"
            ? pref.prompt_text.replace(/\r\n/g, "\n")
            : "",
        prompt_steps: Array.isArray(pref?.prompt_steps)
          ? (pref.prompt_steps as EditorStep[]).map(writeStep)
          : [],
        buttons_prompt:
          typeof pref?.buttons_prompt === "string"
            ? pref.buttons_prompt.replace(/\r\n/g, "\n")
            : "",
        whatsapp_button_label:
          typeof pref?.whatsapp_button_label === "string"
            ? pref.whatsapp_button_label.trim()
            : "",
        email_button_label:
          typeof pref?.email_button_label === "string"
            ? pref.email_button_label.trim()
            : "",
        email_request_text:
          typeof pref?.email_request_text === "string"
            ? pref.email_request_text.replace(/\r\n/g, "\n")
            : "",
        email_request_steps: Array.isArray(pref?.email_request_steps)
          ? (pref.email_request_steps as EditorStep[]).map(writeStep)
          : [],
        fallback_whatsapp_text:
          typeof pref?.fallback_whatsapp_text === "string"
            ? pref.fallback_whatsapp_text.replace(/\r\n/g, "\n")
            : "",
        fallback_whatsapp_steps: Array.isArray(pref?.fallback_whatsapp_steps)
          ? (pref.fallback_whatsapp_steps as EditorStep[]).map(writeStep)
          : [],
        wait_text:
          typeof pref?.wait_text === "string"
            ? pref.wait_text.replace(/\r\n/g, "\n")
            : "",
        wait_steps: Array.isArray(pref?.wait_steps)
          ? (pref.wait_steps as EditorStep[]).map(writeStep)
          : [],
        delay_seconds: Math.max(0, Math.floor(num(pref?.delay_seconds, 15))),
      })
    );
  }
  if (
    body.notification_settings &&
    typeof body.notification_settings === "object"
  ) {
    const n = body.notification_settings as Record<string, unknown>;
    const recipients = Array.isArray(n?.recipients)
      ? (n.recipients as Record<string, unknown>[])
          .map((item) => ({
            name:
              typeof item?.name === "string" ? item.name.trim() : "",
            enabled: item?.enabled !== false,
            phone:
              typeof item?.phone === "string"
                ? item.phone.replace(/[^\d]/g, "")
                : "",
            telegram_chat_id:
              typeof item?.telegram_chat_id === "string"
                ? item.telegram_chat_id.trim()
                : "",
          }))
          .filter((item) => item.phone || item.telegram_chat_id)
      : [];
    doc.set(
      "notification_settings",
      blockNode(doc, {
        enabled: n?.enabled === true,
        whatsapp_enabled: n?.whatsapp_enabled !== false,
        telegram_enabled: n?.telegram_enabled === true,
        recipients,
      })
    );
  }

  if (typeof body.payment_method_buttons === "boolean") {
    doc.set("payment_method_buttons", body.payment_method_buttons);
  }
  // Escribe una opción (combo/básico) de las secciones de DOS opciones.
  //
  // Vive aquí fuera y no dentro de un solo bloque porque ahora la usan dos
  // secciones: la Doble Oferta de 2 productos y la Doble Oferta + Upsell.
  // Duplicarla habría sido copiar setenta líneas con precios, pagos por país y
  // mensajes directos — el sitio perfecto para que las dos copias diverjan y
  // una modalidad guarde algo que la otra no.
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
      // Solo se escriben si las hay: asi el YAML no se llena de listas vacias.
      ...(Array.isArray(x?.response_variants) && x.response_variants.length > 0
        ? {
            response_variants: (
              x.response_variants as Record<string, unknown>[]
            ).map((v) => ({
              id: str(v?.id),
              name: str(v?.name),
              color: str(v?.color),
              ...(v?.enabled === false ? { enabled: false } : {}),
              steps: (Array.isArray(v?.steps) ? (v.steps as EditorStep[]) : []).map(
                writeStep
              ),
            })),
          }
        : {}),
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
    // Mensaje directo antes de métodos de pago (antes NO se persistía).
    if (x?.direct_payment_prompt_enabled === true)
      out.direct_payment_prompt_enabled = true;
    const dpp = (Array.isArray(x?.direct_payment_prompt)
      ? (x.direct_payment_prompt as EditorStep[])
      : []
    ).map(writeStep);
    if (dpp.length) out.direct_payment_prompt = dpp;
    // Overrides POR PAÍS: solo se escriben los países/campos con texto propio.
    const byCountrySrc = (x?.by_country ?? {}) as Record<string, unknown>;
    const byCountryOut: Record<string, unknown> = {};
    for (const [cc, v] of Object.entries(byCountrySrc)) {
      const o = (v ?? {}) as Record<string, unknown>;
      const entry: Record<string, unknown> = {};
      const resp = (Array.isArray(o?.response)
        ? (o.response as EditorStep[])
        : []
      ).map(writeStep);
      const dppC = (Array.isArray(o?.direct_payment_prompt)
        ? (o.direct_payment_prompt as EditorStep[])
        : []
      ).map(writeStep);
      if (resp.length) entry.response = resp;
      if (dppC.length) entry.direct_payment_prompt = dppC;
      const prSrc = (o?.payment_responses ?? {}) as Record<string, unknown>;
      const prOut: Record<string, unknown> = {};
      for (const m of ["yape", "bcp_transferencia", "efectivo"] as const) {
        const s = (Array.isArray(prSrc?.[m])
          ? (prSrc[m] as EditorStep[])
          : []
        ).map(writeStep);
        if (s.length) prOut[m] = s;
      }
      if (Object.keys(prOut).length) entry.payment_responses = prOut;
      if (Object.keys(entry).length) byCountryOut[cc] = entry;
    }
    if (Object.keys(byCountryOut).length) out.by_country = byCountryOut;
    return out;
  };
  // El interruptor de la MODALIDAD Upsell. Va aparte del de su etapa a
  // propósito: con los dos en `upsell.enabled`, encender la etapa en Lineal
  // cambiaba la modalidad que vende el bot. Solo se escribe si el panel lo
  // manda, para que un guardado de una versión anterior no lo invente.
  if (typeof body.upsell_modalidad_enabled === "boolean") {
    doc.set("upsell_modalidad_enabled", body.upsell_modalidad_enabled);
  }
  if (body.upsell && typeof body.upsell === "object") {
    const u = body.upsell as Record<string, unknown>;
    doc.set(
      "upsell",
      blockNode(doc, {
        info_steps: (
          Array.isArray(u?.info_steps) ? (u.info_steps as EditorStep[]) : []
        ).map(writeStep),
        image_gallery: galleryItems(u?.image_gallery),
        course_content: str(u?.course_content).replace(/\r\n/g, "\n"),
        respuesta_generica: str(u?.respuesta_generica).replace(/\r\n/g, "\n"),
        enabled: u?.enabled === true,
        name: str(u?.name),
        aliases: strListLimpia(u?.aliases),
        intro: (Array.isArray(u?.intro) ? (u.intro as EditorStep[]) : []).map(
          writeStep
        ),
        intro_groups: writeGruposDeIntro(u?.intro_groups),
        ...writePregunta(u),
        use_buttons: u?.use_buttons === true,
        boton_si: str(u?.boton_si),
        boton_no: str(u?.boton_no),
        price_soles: num(u?.price_soles, 0),
        discount_price_soles: num(u?.discount_price_soles, 0),
        delivery: (
          Array.isArray(u?.delivery) ? (u.delivery as EditorStep[]) : []
        ).map(writeStep),
        espera_minutos: num(u?.espera_minutos, 30) || 30,
        retraso_minutos: num(u?.retraso_minutos, 0),
        respuesta_rechazo: str(u?.respuesta_rechazo).replace(/\r\n/g, "\n"),
        recordatorio: str(u?.recordatorio).replace(/\r\n/g, "\n"),
      })
    );
  }

  // DOBLE OFERTA + UPSELL. Seccion cohesiva → doc.set, igual que las otras.
  //
  // La ARMA la pantalla juntando lo que se edita en "Doble Oferta 2 Prod" y en
  // "Upsell"; aqui solo se escribe tal cual llega. El motor lee SOLO de aqui,
  // asi que si esto no se guardara, encender la modalidad no haria nada y no
  // habria forma de saber por que.
  if (body.doble_oferta_upsell && typeof body.doble_oferta_upsell === "object") {
    const du = body.doble_oferta_upsell as Record<string, unknown>;
    const duU = (du?.upsell ?? {}) as Record<string, unknown>;
    doc.set(
      "doble_oferta_upsell",
      blockNode(doc, {
        enabled: du?.enabled === true,
        use_buttons: du?.use_buttons === true,
        separate_bubble: du?.separate_bubble === true,
        basico_first: du?.basico_first === true,
        choice_prompt: str(du?.choice_prompt).replace(/\r\n/g, "\n"),
        choice_prompt_enabled: du?.choice_prompt_enabled !== false,
        choice_buttons_prompt: str(du?.choice_buttons_prompt).replace(
          /\r\n/g,
          "\n"
        ),
        choice_clarification: str(du?.choice_clarification).replace(
          /\r\n/g,
          "\n"
        ),
        combo: writeDdOption(du?.combo),
        basico: writeDdOption(du?.basico),
        upsell: {
          enabled: duU?.enabled === true,
          name: str(duU?.name),
          aliases: strListLimpia(duU?.aliases),
          intro: (
            Array.isArray(duU?.intro) ? (duU.intro as EditorStep[]) : []
          ).map(writeStep),
          ...writePregunta(duU),
          use_buttons: duU?.use_buttons === true,
          boton_si: str(duU?.boton_si),
          boton_no: str(duU?.boton_no),
          price_soles: num(duU?.price_soles, 0),
          discount_price_soles: num(duU?.discount_price_soles, 0),
          info_steps: (
            Array.isArray(duU?.info_steps) ? (duU.info_steps as EditorStep[]) : []
          ).map(writeStep),
          image_gallery: galleryItems(duU?.image_gallery),
          course_content: str(duU?.course_content).replace(/\r\n/g, "\n"),
          respuesta_generica: str(duU?.respuesta_generica).replace(
            /\r\n/g,
            "\n"
          ),
          delivery: (
            Array.isArray(duU?.delivery) ? (duU.delivery as EditorStep[]) : []
          ).map(writeStep),
          espera_minutos: num(duU?.espera_minutos, 30) || 30,
          retraso_minutos: num(duU?.retraso_minutos, 0),
          respuesta_rechazo: str(duU?.respuesta_rechazo).replace(/\r\n/g, "\n"),
          recordatorio: str(duU?.recordatorio).replace(/\r\n/g, "\n"),
        },
      })
    );
  }
  if (body.moderacion && typeof body.moderacion === "object") {
    const m = body.moderacion as Record<string, unknown>;
    doc.set(
      "moderacion",
      blockNode(doc, {
        piropos_enabled: m?.piropos_enabled === true,
        piropos_umbral: num(m?.piropos_umbral, 3) || 3,
        basura_enabled: m?.basura_enabled === true,
        basura_umbral: num(m?.basura_umbral, 2) || 2,
        mensaje_despedida: str(m?.mensaje_despedida).replace(/\r\n/g, "\n"),
      })
    );
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
  // LA BIBLIOTECA DE PRODUCTOS SE ESCRIBE ENTERA.
  //
  // Va aquí o no se guarda: este archivo escribe por lista, y lo que no está
  // nombrado se cae al guardar en silencio y sin error. La casilla aceptaría el
  // texto y al recargar estaría vacía.
  //
  // Se escribe tal cual llega, sin recortar campo por campo: dentro hay
  // burbujas de entrega y galerías enteras, que ya vienen limpias de su propio
  // editor. La limpieza que sí hace falta —id y etiqueta conocida— se hace al
  // LEER, unas líneas más arriba, que es donde protege de un archivo editado a
  // mano.
  // LA ALINEACIÓN SE ESCRIBE ENTERA, por lo mismo que la biblioteca: este
  // archivo escribe por lista y lo que no está nombrado se cae al guardar, en
  // silencio y sin error. La limpieza se hace al LEER, más arriba.
  if (esMapa(body.alineacion_por_modalidad)) {
    doc.set(
      "alineacion_por_modalidad",
      blockNode(doc, body.alineacion_por_modalidad as Record<string, unknown>)
    );
  }
  if (Array.isArray(body.biblioteca_de_productos)) {
    // LA ENTREGA SE TRADUCE AL FORMATO DEL MOTOR, como la de cualquier otra
    // secuencia del archivo.
    //
    // Se guardaba en crudo, tal cual venía de la pantalla, y la pantalla usa
    // `texts` mientras el motor lee `body_variants`. Resultado: el motor
    // encontraba la burbuja pero sin texto, y mandaba un mensaje vacío. El
    // cliente pagaba y el bot se quedaba mudo, sin error en ningún registro.
    //
    // Es exactamente el mismo `writeStep` que usan la intro, los seguimientos y
    // las demás entregas: una sola traducción para todo el archivo.
    const conEntregaTraducida = (
      body.biblioteca_de_productos as Record<string, unknown>[]
    ).map((producto) => {
      // Su presentación como upsell, con las burbujas traducidas como la entrega. Si queda
      // vacía no se escribe: una clave presente y vacía no dice nada que no diga su ausencia.
      const presentacion = limpiaPresentacionUpsell(
        producto?.presentacion_upsell,
        pasosParaElArchivo,
        writeGruposDeIntro
      );
      const { presentacion_upsell: _descartada, entregas_extra: _extras, ...resto } = producto;
      void _descartada;
      void _extras;
      // Las entregas extra, con sus burbujas al formato del motor. Sin ninguna, no se escribe la clave.
      const extras = Array.isArray(producto?.entregas_extra)
        ? (producto.entregas_extra as Record<string, unknown>[])
            .map((e, j) => ({
              id: str(e?.id) || `entrega_${j + 1}`,
              nombre: str(e?.nombre),
              steps: Array.isArray(e?.steps) ? (e.steps as EditorStep[]).map(writeStep) : [],
            }))
        : [];
      return {
        ...resto,
        delivery: Array.isArray(producto?.delivery)
          ? (producto.delivery as EditorStep[]).map(writeStep)
          : [],
        ...(extras.length ? { entregas_extra: extras } : {}),
        ...(presentacion ? { presentacion_upsell: presentacion } : {}),
      };
    });
    doc.set("biblioteca_de_productos", blockNode(doc, conEntregaTraducida));
  }
  // LAS FILAS DE UPSELLS, por el mismo carril que las tiendas: campo a campo. Ver
  // `limpiaFilasDeUpsell`. Fase 2: se guardan, el motor no las lee todavía.
  if (Array.isArray(body.filas_de_upsell)) {
    doc.set(
      "filas_de_upsell",
      blockNode(doc, limpiaFilasDeUpsell(body.filas_de_upsell, pasosParaElArchivo))
    );
  }
  // LA LIBRETA DE VERSIONES DEL CAJÓN. Mismo trato: sus burbujas se traducen al
  // formato del archivo, o al cargar una versión saldría vacía.
  if (Array.isArray(body.biblioteca_de_intros)) {
    const versiones = (
      body.biblioteca_de_intros as Record<string, unknown>[]
    ).map((v, i) => ({
      id: str(v?.id) || `intro_${i + 1}`,
      name: str(v?.name),
      lugar: str(v?.lugar) === "upsell" ? "upsell" : "order_bump",
      // Solo se escribe la que manda: una lista de «activa: false» no dice nada
      // que no diga su ausencia.
      ...(v?.activa === true ? { activa: true } : {}),
      steps: Array.isArray(v?.steps)
        ? (v.steps as EditorStep[]).map(writeStep)
        : [],
    }));
    doc.set("biblioteca_de_intros", blockNode(doc, versiones));
  }
  if (typeof body.post_sale_reoffer === "boolean") {
    doc.set("post_sale_reoffer", body.post_sale_reoffer);
  }
  if (typeof body.post_sale_email_reminder_enabled === "boolean") {
    doc.set(
      "post_sale_email_reminder_enabled",
      body.post_sale_email_reminder_enabled
    );
  }
  if (typeof body.email_reminder_text === "string") {
    doc.set(
      "email_reminder_text",
      blockNode(doc, body.email_reminder_text.replace(/\r\n/g, "\n"))
    );
  }
  if (Array.isArray(body.email_reminder_steps)) {
    doc.set(
      "email_reminder_steps",
      blockNode(doc, (body.email_reminder_steps as EditorStep[]).map(writeStep))
    );
  }
  if (Array.isArray(body.payment_resend_steps)) {
    doc.set(
      "payment_resend_steps",
      blockNode(doc, (body.payment_resend_steps as EditorStep[]).map(writeStep))
    );
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
        const base: {
          label: string;
          method: string;
          aliases?: string[];
          principal?: true;
          enabled?: false;
        } = {
          label: str(b?.label).trim(),
          method: str(b?.method).trim(),
        };
        if (aliases.length > 0) base.aliases = aliases;
        // Igual que "principal": solo se escribe cuando esta APAGADO, para no
        // ensuciar el YAML con "enabled: true" en todos los metodos.
        if (b?.enabled === false) base.enabled = false;
        // "principal" solo se escribe cuando esta marcado: asi el YAML no se
        // llena de "principal: false" y las configs que nunca lo tocaron
        // conservan exactamente la forma que tenian.
        if (b?.principal === true) base.principal = true;
        return base;
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
    body.messenger_country_prompt &&
    typeof body.messenger_country_prompt === "object"
  ) {
    const prompt = body.messenger_country_prompt as Record<string, unknown>;
    doc.set(
      "messenger_country_prompt",
      blockNode(doc, {
        enabled: prompt.enabled === true,
        message: str(prompt.message).replace(/\r\n/g, "\n"),
        reminder_enabled: prompt.reminder_enabled === true,
        reminder_delay_minutes:
          typeof prompt.reminder_delay_minutes === "number" &&
          Number.isFinite(prompt.reminder_delay_minutes)
            ? Math.max(1, Math.round(prompt.reminder_delay_minutes))
            : 5,
        reminder_message: str(prompt.reminder_message).replace(/\r\n/g, "\n"),
        reask_mode:
          prompt.reask_mode === "microcall" || prompt.reask_mode === "llm"
            ? prompt.reask_mode
            : "spintax",
        reask_variants: Array.isArray(prompt.reask_variants)
          ? (prompt.reask_variants as unknown[])
              .map((v) => str(v))
              .filter(Boolean)
          : [],
        reask_instruction: str(prompt.reask_instruction).replace(/\r\n/g, "\n"),
      })
    );
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
  if (typeof body.country_sales_whitelist === "boolean") {
    doc.set("country_sales_whitelist", body.country_sales_whitelist);
  }
  if (typeof body.country_disabled_message === "string") {
    doc.set(
      "country_disabled_message",
      blockNode(doc, body.country_disabled_message.replace(/\r\n/g, "\n"))
    );
  }
  if (body.modality_pricing && typeof body.modality_pricing === "object") {
    const mp = body.modality_pricing as Record<string, unknown>;
    const clean = Object.fromEntries(
      Object.entries(mp).map(([mode, v]) => {
        const o = (v ?? {}) as Record<string, unknown>;
        const pbc = (o.prices_by_country ?? {}) as Record<string, unknown>;
        const prices = Object.fromEntries(
          Object.entries(pbc).map(([cc, pv]) => {
            const p = (pv ?? {}) as Record<string, unknown>;
            return [
              cc,
              {
                course_price_soles: num(p.course_price_soles, 0),
                discount_price_soles: num(p.discount_price_soles, 0),
              },
            ];
          })
        );
        return [mode, { prices_by_country: prices }];
      })
    );
    doc.set("modality_pricing", blockNode(doc, clean));
  }
  if (typeof body.venezuela_redirect_enabled === "boolean") {
    doc.set("venezuela_redirect_enabled", body.venezuela_redirect_enabled);
  }
  if (typeof body.venezuela_redirect_message === "string") {
    doc.set(
      "venezuela_redirect_message",
      blockNode(doc, body.venezuela_redirect_message.replace(/\r\n/g, "\n"))
    );
  }
  if (
    typeof body.venezuela_redirect_human_delay_minutes === "number" &&
    Number.isFinite(body.venezuela_redirect_human_delay_minutes)
  ) {
    doc.set(
      "venezuela_redirect_human_delay_minutes",
      Math.max(0, body.venezuela_redirect_human_delay_minutes)
    );
  }
  // Limpia y normaliza UN perfil de pago por país (BASE o capa de modalidad).
  const writeCountryProfile = (rawProfile: unknown) => {
    const p = (rawProfile ?? {}) as Record<string, unknown>;
    const buttons = Array.isArray(p?.payment_buttons)
      ? (p.payment_buttons as Record<string, unknown>[])
          .map((b) => {
            const btn: {
              label: string;
              method: string;
              aliases: string[];
              principal?: true;
              enabled?: false;
            } = {
              label: str(b?.label).trim(),
              method: str(b?.method).trim(),
              aliases: strList(b?.aliases)
                .map((a) => a.trim())
                .filter(Boolean),
            };
            if (b?.principal === true) btn.principal = true;
            if (b?.enabled === false) btn.enabled = false;
            return btn;
          })
          .filter((b) => b.label && b.method)
      : [];
    const responses = (p?.payment_responses ?? {}) as Record<string, unknown>;
    const payment_responses = Object.fromEntries(
      Object.entries(responses).map(([method, steps]) => [
        method,
        Array.isArray(steps) ? (steps as EditorStep[]).map(writeStep) : [],
      ])
    );
    return {
      enabled: p?.enabled !== false,
      course_price_soles: num(p?.course_price_soles, 0),
      discount_price_soles: num(p?.discount_price_soles, 0),
      market_price: num(p?.market_price, 0),
      price_label_case: estiloDeMoneda(p?.price_label_case),
      payment_validation: {
        yape_recipient_name_starts_with: str(
          (p?.payment_validation as Record<string, unknown> | undefined)
            ?.yape_recipient_name_starts_with
        ).trim(),
        require_receipt_date:
          (p?.payment_validation as Record<string, unknown> | undefined)
            ?.require_receipt_date === true,
      },
      payment_text: str(p?.payment_text).replace(/\r\n/g, "\n"),
      // La vuelta del texto propio de esta modalidad y país. Sin esta línea se
      // escribiría en el editor y se descartaría al guardar: otra casilla que
      // acepta trabajo y lo tira.
      direct_payment_steps: (Array.isArray(p?.direct_payment_steps)
        ? (p.direct_payment_steps as EditorStep[])
        : []
      ).map(writeStep),
      direct_payment_cta: str(p?.direct_payment_cta).replace(/\r\n/g, "\n"),
      payment_buttons: buttons,
      payment_responses,
      order_bump: {
        combo_price_soles: num((p?.order_bump as Record<string, unknown> | undefined)?.combo_price_soles, 0),
        combo_discount_price_soles: num((p?.order_bump as Record<string, unknown> | undefined)?.combo_discount_price_soles, 0),
        basico_price_soles: num((p?.order_bump as Record<string, unknown> | undefined)?.basico_price_soles, 0),
        basico_discount_price_soles: num((p?.order_bump as Record<string, unknown> | undefined)?.basico_discount_price_soles, 0),
        // El «antes» tachado de la opción cara. Sin esta línea el campo se
        // descartaría al guardar y el comodín saldría vacío para siempre, sin
        // que nadie entienda por qué: la casilla del editor se veía llena.
        combo_market_price: num((p?.order_bump as Record<string, unknown> | undefined)?.combo_market_price, 0),
        // Cómo sale la moneda de la opción cara: May, Min o solo el símbolo.
        // Sin esta línea el botón se veria puesto y al guardar volveria atras.
        combo_price_label_case: estiloDeMoneda(
          (p?.order_bump as Record<string, unknown> | undefined)?.combo_price_label_case
        ),
      },
      bioferta: {
        pack_price_soles: num((p?.bioferta as Record<string, unknown> | undefined)?.pack_price_soles, 0),
        pack_discount_price_soles: num((p?.bioferta as Record<string, unknown> | undefined)?.pack_discount_price_soles, 0),
      },
      // El TERCER producto de "Doble Oferta + Upsell", por país. Sin esto la
      // capa se descartaba al guardar y el precio volvía al global sin avisar.
      upsell: {
        price_soles: num((p?.upsell as Record<string, unknown> | undefined)?.price_soles, 0),
        discount_price_soles: num((p?.upsell as Record<string, unknown> | undefined)?.discount_price_soles, 0),
        // Y el «antes» del tercer producto, por el mismo motivo.
        market_price: num((p?.upsell as Record<string, unknown> | undefined)?.market_price, 0),
        price_label_case: estiloDeMoneda(
          (p?.upsell as Record<string, unknown> | undefined)?.price_label_case
        ),
      },
      metodo_pago_1: str(p?.metodo_pago_1).replace(/\r\n/g, "\n"),
      metodo_pago_2: str(p?.metodo_pago_2).replace(/\r\n/g, "\n"),
      metodo_pago_3: str(p?.metodo_pago_3).replace(/\r\n/g, "\n"),
      metodo_pago_principal: str(p?.metodo_pago_principal).replace(/\r\n/g, "\n"),
      // El número de cuenta viaja recortado: un espacio de sobra pegado al
      // número se ve igual en la casilla y feo en el mensaje del cliente.
      numero_de_cuenta: str(p?.numero_de_cuenta).trim(),
      // Las cuentas por método, por el mismo carril. Cada una ya viene recortada.
      cuentas_por_metodo: leeCuentasPorMetodo(p?.cuentas_por_metodo),
      // Recortado por lo mismo: un espacio de sobra no se ve en la casilla y sí
      // en el mensaje. Por dentro va entero, con sus espacios entre apellidos.
      nombre_completo: str(p?.nombre_completo).trim(),
      // El avatar del titular del país (solo pantalla). Si no se nombra aquí, se pierde al guardar.
      ...(str(p?.foto).trim() ? { foto: str(p?.foto).trim() } : {}),
    };
  };
  if (
    body.payment_profiles_by_country &&
    typeof body.payment_profiles_by_country === "object"
  ) {
    const profiles = Object.fromEntries(
      Object.entries(
        body.payment_profiles_by_country as Record<string, unknown>
      ).map(([country, rawProfile]) => [
        country,
        writeCountryProfile(rawProfile),
      ])
    );
    doc.set("payment_profiles_by_country", blockNode(doc, profiles));
  }
  // CAPAS por modalidad: mismo perfil por país, una capa por modalidad.
  if (
    body.modality_payment_profiles &&
    typeof body.modality_payment_profiles === "object"
  ) {
    const layers = Object.fromEntries(
      Object.entries(
        body.modality_payment_profiles as Record<string, unknown>
      ).map(([mode, byCountry]) => [
        mode,
        Object.fromEntries(
          Object.entries((byCountry ?? {}) as Record<string, unknown>).map(
            ([cc, rp]) => [cc, writeCountryProfile(rp)]
          )
        ),
      ])
    );
    doc.set("modality_payment_profiles", blockNode(doc, layers));
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
        ["lineal", "order_bump", "bioferta", "doble_oferta_dos", "doble_oferta_upsell", "upsell"].map((mode) => [
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
        caption_variants: strList(g?.caption_variants).map((value) =>
          value.replace(/\r\n/g, "\n")
        ),
        pasos_extra: Array.isArray(g?.pasos_extra)
          ? (g.pasos_extra as EditorStep[]).map(writeStep)
          : [],
        // enabled solo se escribe cuando está apagado → YAML limpio
        ...(g?.enabled === false ? { enabled: false } : {}),
      }))
      // descartamos filas totalmente vacías (sin tema ni enlace)
      .filter((g) => g.topic.trim() || g.drive_url.trim());
    doc.set(key, blockNode(doc, items));
  };
  writeGallery("image_gallery", body.image_gallery);
  if (Array.isArray(body.samples_after_sequence)) {
    const steps = (body.samples_after_sequence as EditorStep[]).map(writeStep);
    const node = blockNode(doc, steps);
    annotateSteps(node, steps);
    doc.set("samples_after_sequence", node);
  }
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
  // LAS CUATRO RESPUESTAS DE EMERGENCIA.
  //
  // Se guardan igual que el mensaje de desconfianza, que es el patrón probado
  // para un texto suelto de varias líneas. Vacío se guarda vacío a propósito: el
  // motor lo lee como «usa la de siempre», así que borrar el campo es la forma de
  // volver a la frase original sin tener que copiarla.
  for (const clave of [
    "emergencia_no_entendi",
    "emergencia_respuesta_cortada",
    "emergencia_sin_respuesta",
    "emergencia_sin_respuesta_con_pago",
  ] as const) {
    const valor = (body as Record<string, unknown>)[clave];
    if (typeof valor === "string") {
      doc.set(clave, blockNode(doc, valor.replace(/\r\n/g, "\n")));
    }
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
        product_a: writeProduct(b?.product_a, true),
        product_b: writeProduct(b?.product_b, true),
        pack: writeProduct(b?.pack, true),
        ask_choice_text: str(b?.ask_choice_text).replace(/\r\n/g, "\n"),
        choice_on_intro_enabled: b?.choice_on_intro_enabled !== false,
        intro_choice_prompt: str(b?.intro_choice_prompt).replace(/\r\n/g, "\n"),
        choice_confirmation_enabled: b?.choice_confirmation_enabled !== false,
        choice_confirmation_text: str(b?.choice_confirmation_text).replace(
          /\r\n/g,
          "\n"
        ),
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
    // Las variantes VACIAS no se guardan. El motor elige el saludo al azar y
    // solo descarta las que tienen marcadores sin rellenar, no las vacias: una
    // variante en blanco haria que el primer mensaje al cliente saliera vacio.
    const texts = (Array.isArray(g?.texts) ? g.texts : [])
      .filter((t): t is string => typeof t === "string")
      .map((t) => t.replace(/\r\n/g, "\n"))
      .filter((t) => t.trim().length > 0);
    doc.setIn(["greeting", "text_variants"], blockNode(doc, texts));
    doc.setIn(["greeting", "skip_ask_name"], g?.skip_ask_name === true);
    // LOS BOTONES DEL SALUDO SE GUARDAN AQUÍ, O NO EXISTEN.
    //
    // Esta función reconstruye el YAML campo por campo: lo que no se escriba
    // se descarta sin avisar. Ya pasó con la pregunta inicial — la pantalla
    // tenía sus casillas, se llenaban, se guardaba, y al motor no le llegaba
    // nada. No hay error ni aviso: la función simplemente no existe.
    doc.setIn(
      ["greeting", "buttons"],
      blockNode(doc, writeBubbleButtons(g?.buttons as EditorBubbleButton[] | undefined))
    );
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
  if (body.email_upsell && typeof body.email_upsell === "object") {
    const e = body.email_upsell as Record<string, unknown>;
    const setE = (key: string, value: unknown) =>
      doc.setIn(["email_template_upsell", key], blockNode(doc, value));
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
        ...(Array.isArray(x?.response_variants) && x.response_variants.length > 0
          ? {
              response_variants: (
                x.response_variants as Record<string, unknown>[]
              ).map((v) => ({
                id: str(v?.id),
                name: str(v?.name),
                color: str(v?.color),
                ...(v?.enabled === false ? { enabled: false } : {}),
                steps: (
                  Array.isArray(v?.steps) ? (v.steps as EditorStep[]) : []
                ).map(writeStep),
              })),
            }
          : {}),
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
      // Mensaje directo antes de métodos de pago (antes NO se persistía).
      if (x?.direct_payment_prompt_enabled === true)
        out.direct_payment_prompt_enabled = true;
      const dpp = (Array.isArray(x?.direct_payment_prompt)
        ? (x.direct_payment_prompt as EditorStep[])
        : []
      ).map(writeStep);
      if (dpp.length) out.direct_payment_prompt = dpp;
      // Overrides POR PAÍS: solo se escriben los países/campos con texto propio.
      const byCountrySrc = (x?.by_country ?? {}) as Record<string, unknown>;
      const byCountryOut: Record<string, unknown> = {};
      for (const [cc, v] of Object.entries(byCountrySrc)) {
        const o = (v ?? {}) as Record<string, unknown>;
        const entry: Record<string, unknown> = {};
        const resp = (Array.isArray(o?.response)
          ? (o.response as EditorStep[])
          : []
        ).map(writeStep);
        const dppC = (Array.isArray(o?.direct_payment_prompt)
          ? (o.direct_payment_prompt as EditorStep[])
          : []
        ).map(writeStep);
        if (resp.length) entry.response = resp;
        if (dppC.length) entry.direct_payment_prompt = dppC;
        const prSrc = (o?.payment_responses ?? {}) as Record<string, unknown>;
        const prOut: Record<string, unknown> = {};
        for (const m of ["yape", "bcp_transferencia", "efectivo"] as const) {
          const s = (Array.isArray(prSrc?.[m])
            ? (prSrc[m] as EditorStep[])
            : []
          ).map(writeStep);
          if (s.length) prOut[m] = s;
        }
        if (Object.keys(prOut).length) entry.payment_responses = prOut;
        if (Object.keys(entry).length) byCountryOut[cc] = entry;
      }
      if (Object.keys(byCountryOut).length) out.by_country = byCountryOut;
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
        intro_groups: writeGruposDeIntro(ob?.intro_groups),
        choice_prompt: str(ob?.choice_prompt).replace(/\r\n/g, "\n"),
        choice_clarification: str(ob?.choice_clarification).replace(
          /\r\n/g,
          "\n"
        ),
        price_question_response: str(ob?.price_question_response).replace(/\r\n/g, "\n"),
        price_question_response_steps: Array.isArray(ob?.price_question_response_steps)
          ? (ob.price_question_response_steps as EditorStep[]).map(writeStep)
          : undefined,
        aviso_actualizacion: str(ob?.aviso_actualizacion).replace(/\r\n/g, "\n"),
        aviso_actualizacion_steps: Array.isArray(ob?.aviso_actualizacion_steps)
          ? (ob.aviso_actualizacion_steps as EditorStep[]).map(writeStep)
          : undefined,
        price_choice_confirmation: str(ob?.price_choice_confirmation).replace(/\r\n/g, "\n"),
        price_choice_confirmation_steps: Array.isArray(ob?.price_choice_confirmation_steps)
          ? (ob.price_choice_confirmation_steps as EditorStep[]).map(writeStep)
          : undefined,
        combo_upgrade_message: str(ob?.combo_upgrade_message).replace(/\r\n/g, "\n"),
        combo_upgrade_steps: Array.isArray(ob?.combo_upgrade_steps)
          ? (ob.combo_upgrade_steps as EditorStep[]).map(writeStep)
          : undefined,
        partial_payment_choice_message: str(ob?.partial_payment_choice_message).replace(/\r\n/g, "\n"),
        partial_payment_choice_steps: Array.isArray(ob?.partial_payment_choice_steps)
          ? (ob.partial_payment_choice_steps as EditorStep[]).map(writeStep)
          : undefined,
        choice_helper: (Array.isArray(ob?.choice_helper)
          ? (ob.choice_helper as EditorStep[])
          : []
        ).map(writeStep),
        choice_helper_enabled: ob?.choice_helper_enabled === true,
        offer_on_reengaged_price: ob?.offer_on_reengaged_price === true,
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
    doc.set(
      "doble_oferta_dos",
      blockNode(doc, {
        enabled: dd?.enabled === true,
        use_buttons: dd?.use_buttons === true,
        separate_bubble: dd?.separate_bubble === true,
        basico_first: dd?.basico_first === true,
        choice_prompt: str(dd?.choice_prompt).replace(/\r\n/g, "\n"),
        choice_prompt_enabled: dd?.choice_prompt_enabled !== false,
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
    if (typeof g.registry_sync_enabled === "boolean")
      setG("registry_sync_enabled", g.registry_sync_enabled);
    if (Array.isArray(g.registry_sync_backup)) {
      setG("registry_sync_backup", g.registry_sync_backup);
    } else if (g.registry_sync_backup === undefined) {
      doc.deleteIn(["gift_mechanic", "registry_sync_backup"]);
    }
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
        const adLink = str(v?.ad_link).trim();
        const readerId = num(v?.ads_reader_id, 0);
        return {
          weight: num(v?.weight, 0),
          text: str(v?.text).replace(/\r\n/g, "\n"),
          // enabled/label/ad_ids solo se escriben si aportan algo → YAML limpio
          ...(v?.enabled === false ? { enabled: false } : {}),
          ...(label ? { label } : {}),
          ...(ids.length ? { ad_ids: ids } : {}),
          ...(readerId ? { ads_reader_id: readerId } : {}),
          ...(adLink ? { ad_link: adLink } : {}),
          ...(str(v?.registry_ad_id).trim() ? { registry_ad_id: str(v?.registry_ad_id).trim() } : {}),
          ...(str(v?.registry_ad_key).trim() ? { registry_ad_key: str(v?.registry_ad_key).trim() } : {}),
          ...(str(v?.registry_color).trim() ? { registry_color: str(v?.registry_color).trim() } : {}),
          ...(v?.registry_template === true ? { registry_template: true } : {}),
        };
      });
      doc.setIn(["gift_mechanic", "ask_text_variants"], blockNode(doc, variants));
    }
  }

  const output = doc.toString({ lineWidth: 0 });
  // UNA SOLA RELECTURA del resultado: comprueba que es YAML válido y sirve también al seguro y a la
  // carga siguiente (antes se releía tres veces: aquí, y dos en el seguro).
  let loQueQueda: Record<string, unknown>;
  try {
    loQueQueda = parseDocument(output).toJS() as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "El resultado no sería YAML válido, no se guardó" },
      { status: 500 }
    );
  }

  // EL SEGURO. Antes de publicar nada, se mira si este guardado dejaría vacía
  // alguna sección que hoy tiene contenido. Si es así NO SE ESCRIBE: se
  // devuelve la lista y se pide confirmación expresa. Ver el comentario largo
  // de SECCIONES_VIGILADAS, arriba, con el desastre que lo motivó.
  if (body.confirmar_vaciado !== true) {
    let seVaciarian: string[] = [];
    try {
      // Los mismos dos lados de siempre (lo que había y lo que queda), ya leídos una vez.
      seVaciarian = seccionesQueSeVaciarian(loQueHabia, loQueQueda);
    } catch {
      // Si la comparación falla, NO se bloquea el guardado: el seguro no puede
      // convertirse en un motivo para no poder guardar.
      seVaciarian = [];
    }
    if (seVaciarian.length > 0) {
      return NextResponse.json(
        {
          error: "Este guardado dejaría vacías secciones que hoy tienen contenido.",
          requiereConfirmacion: true,
          vaciaria: seVaciarian,
        },
        { status: 409 }
      );
    }
  }

  const tokenConfigured = isGithubPublishConfigured();
  if (!tokenConfigured) {
    return NextResponse.json(
      {
        error:
          "GITHUB_TOKEN no configurado. No se guardo para evitar cambios temporales que se pierdan al redeployar.",
      },
      { status: 500 }
    );
  }

  const publish = await publishFileToGithub(
    "config/intro-data.yaml",
    output,
    "editor: actualiza flujo"
  );
  if (!publish.ok) {
    return NextResponse.json(
      { error: publish.error ?? "No se pudo publicar el cambio en GitHub." },
      { status: 500 }
    );
  }

  try {
    writeTextFileAtomically(CONFIG_PATH, output);
  } catch {
    return NextResponse.json(
      { error: "Publicado en GitHub, pero no se pudo actualizar el archivo local" },
      { status: 500 }
    );
  }
  // La próxima vez que se abra el editor (o se guarde), el contenido nuevo ya está leído.
  recordarContenido(loQueQueda);
  recordarDocumento(doc);

  // La huella nueva: el siguiente guardado de ESTA pestaña compara contra lo que ella escribió.
  return NextResponse.json({ ok: true, tokenConfigured, persisted: true, version_del_archivo: huellaDelArchivo(output) });
}
