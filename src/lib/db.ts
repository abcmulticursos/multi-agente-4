import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type Mode = "AI" | "HUMAN";
export type Role = "user" | "assistant" | "human";
export type MediaType = "audio" | "image" | "video" | "document";
export type WaStatus = "sent" | "delivered" | "read" | "failed";
export type ConversationChannel =
  | "whatsapp"
  | "messenger"
  | "instagram"
  | "tiktok"
  | "test";
export type WorkflowState =
  | "new"
  // LAS DOS DE ABAJO YA NO SE PRODUCEN, Y SE QUEDAN SOLO POR LAS FILAS VIEJAS.
  //
  // Eran las esperas del arranque: el bot decía una línea y se callaba hasta que
  // el cliente contestara. Eso se retiró — llega el mensaje y el bot habla.
  //
  // Nadie las escribe ya, pero una conversación de antes del cambio puede
  // tenerlas guardadas. Quitarlas del tipo dejaría el tipo mintiendo sobre lo
  // que hay en la tabla.
  | "awaiting_initial_question"
  | "awaiting_response"
  | "intro_running"
  | "intro_done"
  | "payment_done"
  | "payment_approved"
  | "awaiting_delivery_preference"
  | "awaiting_email"
  | "awaiting_gift_consent"
  | "awaiting_facebook_comment"
  // Bioferta Oferta Doble: pagó el precio UNITARIO pero aún no eligió cuál de
  // los 2 productos quiere → esperamos que escriba el nombre para entregarlo.
  | "awaiting_bioferta_choice"
  // Doble Oferta: terminó la intro y se mostraron las 3 opciones (producto A,
  // producto B, pack) ANTES de pagar → esperamos que elija para darle los datos
  // de pago con el precio de ESA opción. Distinto de awaiting_bioferta_choice,
  // que es después de pagar.
  | "awaiting_bioferta_intro_choice"
  // Bioferta Order Bump: el cliente eligió método de pago y se le mostró la
  // oferta intermedia (combo/básico) → esperamos que elija una opción.
  | "awaiting_order_bump_choice"
  // El pago supero la opcion economica elegida: conservamos el abono hasta
  // confirmar si fue un exceso accidental o un cambio a la opcion superior.
  | "awaiting_order_bump_payment_choice"
  // Ruta comercial B: el cliente pago directo sin elegir combo/basico; se
  // muestra el order bump post-pago antes de entregar o cobrar diferencia.
  | "awaiting_post_payment_order_bump_choice"
  | "country_notice_pending"
  // Doble Oferta 2 Productos: terminó la intro y se mostró la elección
  // (básico/combo) al final → esperamos que elija una opción para ir al pago.
  | "awaiting_doble_oferta_dos_choice";

export interface ConversationRow {
  id: number;
  phone: string;
  channel: ConversationChannel;
  name: string | null;
  mode: Mode;
  last_message_at: number | null;
  created_at: number;
  state: WorkflowState | null;
  client_name: string | null;
  client_email: string | null;
  paid_total_cents: number;
  /** Huellas de los comprobantes YA contados (separadas por coma): número de
   *  operación, fecha+hora+monto y/o id del mensaje-imagen. Evita sumar dos
   *  veces el MISMO comprobante. Se limpia con /restart. NULL = ninguno. */
  counted_receipts: string | null;
  /** unixepoch del momento en que el pago se APROBÓ (cruzó el monto del
   *  curso). NULL si todavía no compró. Solo de lectura para el panel de
   *  ventas — no interviene en el flujo del bot. */
  paid_at: number | null;
  /** Contador de comprobantes rechazados consecutivos. Se incrementa cada
   *  vez que executeRegisterPayment devuelve REJECTED y se resetea cuando
   *  hay APPROVED. Al alcanzar 3, dispara una notificación al admin. */
  payment_attempts_failed: number;
  /** 0 = precio normal; 1 = la convo entró a etapa de oferta (precio
   *  reducido). Se activa cuando arranca el seguimiento configurado en
   *  discount_after_followup. */
  discount_active: number;
  /** Precio prometido a esta conversación, en centavos. NULL = todavía se
   *  calcula desde la configuración actual. Cuando existe, la validación del
   *  comprobante respeta este monto aunque luego cambien los precios globales. */
  locked_price_cents: number | null;
  locked_price_currency: string | null;
  locked_price_source: string | null;
  locked_price_discount_active: number | null;
  locked_price_updated_at: number | null;
  /** Precios ofrecidos al iniciar la conversación. Se guardan separados del
   * bloqueo de pago para que cambios posteriores no alteren lo prometido. */
  frozen_prices: string | null;
  /** ID de la fila en NocoDB que representa este lead. NULL si todavía no
   *  se sincronizó (NocoDB no configurado o creación pendiente). */
  nocodb_row_id: string | null;
  /** Último valor de Label que pusheamos a NocoDB. Sirve para no PATCHear
   *  si no cambió. */
  nocodb_label: string | null;
  /** Último valor de Resumen pusheado. Misma idea que nocodb_label. */
  nocodb_resumen: string | null;
  /** 0 = sin emergencia; 1 = se invocó notify_admin_emergency al menos una
   *  vez. Define el label "reclamo" en NocoDB. */
  had_emergency: number;
  /** Bioferta Oferta Doble: producto elegido por el cliente ('a' | 'b' |
   *  'pack'). NULL = aún no eligió. Solo relevante si la bioferta está activa. */
  bioferta_choice: string | null;
  /** Bioferta Order Bump: opción elegida ('combo' | 'basico'). NULL = aún no.
   *  Solo relevante si el order bump está activo. */
  order_bump_choice: string | null;
  /** Order Bump: 1 = el cliente nombró una opción tras preguntar el precio y el
   *  bot confirmó "cuesta S/N, ¿lo quieres?"; esperamos el sí antes del pago. */
  ob_price_confirm_pending: number;
  /** Order Bump: 1 = disparó un seguimiento tras haber elegido; la elección
   *  quedó vencida (el seguimiento muestra precio básico/oferta). Al elegir método
   *  se recuerdan las 2 opciones en vez de soltar el precio viejo. */
  ob_choice_stale: number;
  /** 1 = a esta conversación ya se le MOSTRÓ la oferta con las 2 opciones. Hasta
   *  que valga 1, el cliente no sabe que existe un segundo producto, así que no
   *  se le puede pedir que elija entre opciones que nunca vio. */
  order_bump_revealed: number;
  /** Avisos acumulados de moderación. Solo suben; al llegar al umbral de su
   *  interruptor, el número se bloquea. Ver moderation.ts. */
  strikes_piropo: number;
  strikes_basura: number;
  /** UPSELL — la segunda venta, después de entregar la primera.
   *  null = no se le ha ofrecido. 'ofrecido' = se le mostró y sigue en pie
   *  (aunque ya haya salido el regalo). 'aceptado' = dijo que sí y espera su
   *  pago. 'pagado' = cerrada. 'rechazado' = dijo que no. */
  upsell_state:
    /** Entregado el primer producto, contando los minutos antes de ofrecer el
     *  extra. Se marca YA al programar la espera: si se dejara sin marcar, una
     *  segunda entrega dentro de esos minutos programaria la oferta dos veces. */
    | "esperando"
    | "ofrecido"
    | "aceptado"
    | "pagado"
    | "rechazado"
    | null;
  /** EL RECORDATORIO DEL EXTRA YA SALIÓ. Va UNA sola vez y nunca más.
   *
   *  Lo pidió el dueño el 15 de septiembre de 2026, con estas palabras: «el
   *  recordatorio del upsell es solo 1 vez luego ya no para no hostigar al
   *  cliente». Por eso es una marca de la conversación y no un contador: en
   *  cuanto vale 1, ninguna de las dos puertas que lo mandan vuelve a entrar. */
  upsell_recordatorio_enviado: number;
  /** Foto de lo pagado al ofrecer el upsell. Lo que entre POR ENCIMA de esto
   *  es lo que cuenta para el segundo producto; así el primer pago queda
   *  intacto y las dos ventas no se mezclan. */
  upsell_base_cents: number;
  upsell_paid_at: number | null;
  /** EL PRECIO QUE SE LE DIJO AL OFRECER EL SEGUNDO PRODUCTO.
   *
   *  Igual que `frozen_prices` hace con el primero: se guarda en el momento de
   *  la oferta y a partir de ahí manda él. Sin esto, tocar el precio en el
   *  panel entre la invitación y el comprobante cambiaba el monto contra el que
   *  se valida — se le pedía uno y se le contaba otro, y eso con dinero de por
   *  medio es de lo peor que puede hacer el bot.
   *
   *  JSON de `UpsellFrozenPrices`. NULL = nunca se le ofreció, o se le ofreció
   *  antes de que esto existiera: ahí se sigue con el precio del momento, como
   *  siempre. */
  upsell_frozen_prices: string | null;
  /** LO ABONADO AL SEGUNDO PRODUCTO. Su propia cuenta, no una resta.
   *
   *  Antes esto se calculaba restando al total acumulado una «foto» de lo
   *  pagado al ofrecerlo. Esa foto hacía de línea divisoria, y funcionaba solo
   *  mientras nada más se moviera por debajo: en cuanto entraba dinero de la
   *  PRIMERA venta después —subir de básico a full—, ese dinero se colaba por
   *  arriba y se contaba para el segundo producto. Se entregaba habiendo
   *  cobrado de menos, exactamente lo que costó el upgrade.
   *
   *  Con su propia cuenta da igual lo que pase con la primera venta: esta ni la
   *  mira. Es un ticket independiente, con su precio.
   *
   *  Se pone a cero al cerrarse una venta del extra, para que la siguiente
   *  empiece limpia — el día que haya un segundo upsell encadenado. */
  upsell_paid_cents: number;
  /** UPSELLS EN FILA — dónde va esta conversación. Ver PLAN-UPSELLS-EN-FILA.md.
   *
   *  · `upsell_fila_id`     — la fila en la que entró (la de su tienda).
   *  · `upsell_producto_id` — el producto de la fila que se le ofrece AHORA. Vacío = el
   *    upsell de siempre (el puesto 1). Se guarda el producto y no el número de puesto
   *    para que reordenar la fila no le cambie la oferta a quien ya la tiene delante.
   *  · `upsell_downsell`    — 1 = la oferta en curso es el downsell. Una sola vez.
   *  · `upsell_fila_parada` — 1 = dijo que no, o calló y salió el regalo: no se le
   *    ofrece nada más de la fila.
   *  · `upsell_comprados`   — JSON con lo que pagó de la fila, para no ofrecérselo otra
   *    vez y para reenviárselo todo.
   *
   *  Con las cinco vacías el bot vende exactamente como antes. */
  upsell_fila_id: string | null;
  upsell_producto_id: string | null;
  upsell_downsell: number;
  upsell_fila_parada: number;
  upsell_comprados: string | null;
  /** LA TIENDA QUE ELIGIÓ SU FRASE DE ENTRADA, para que un número atienda varias tiendas.
   *  Se escribe una sola vez, en el primer mensaje. Vacía = la tienda sale del número, como
   *  siempre. Ver `fijarTiendaPorFraseSiFalta`. */
  tienda_id: string | null;
  /** EL CAMINO DE LA INTRO QUE RECIBIÓ (18/10/2026). Vacío = el principal. Se anota al mandar
   *  la intro y no cambia aunque después se apague o se mueva esa intro. Ver
   *  `etiqueta-de-camino.ts`. */
  camino: string | null;
  /** CUÁNDO FUE LA ÚLTIMA VEZ QUE EL BOT HABLÓ *DE* LA OFERTA DEL EXTRA.
   *
   *  Sirve para saber si la oferta sigue siendo la última pregunta en pantalla.
   *  La oferta queda abierta a propósito —se acepta por su nombre en cualquier
   *  momento—, pero mientras tanto pueden hablar otros: el modelo contestando
   *  una duda, un seguimiento, o una persona desde el panel. Si alguno de ellos
   *  cierra con SU pregunta, un «sí» a secas es de esa pregunta, no de la
   *  oferta.
   *
   *  Se sella al presentar la oferta y cada vez que se responde una duda SOBRE
   *  el extra (esas no cambian de tema: la pregunta sigue siendo la suya).
   *
   *  NULL = ofertas anteriores a esto: se sigue exactamente como antes. */
  upsell_hablado_at: number | null;
  /** CUÁNDO SE ANOTÓ LA OPCIÓN ELEGIDA.
   *
   *  Antes de validar un comprobante, el motor relee los últimos mensajes por si
   *  el cliente eligió en la misma ráfaga que la foto y el debounce se comió la
   *  reacción. Ese repaso es necesario — pero solo sirve para lo que AÚN no se
   *  ha atendido.
   *
   *  Sin esta marca releía TODO, incluido el mensaje que ya había producido la
   *  elección. Y con una frase relativa —«mejor el otro»— eso la da la vuelta:
   *  «el otro» se resuelve contra la elección de ese momento, así que al releerlo
   *  ya con la nueva elección puesta, «el otro» pasa a ser la anterior. El bot
   *  cobraba el producto que el cliente acababa de descartar.
   *
   *  NULL = conversaciones anteriores a esto: se repasa todo, como antes. */
  order_bump_choice_at: number | null;
  /** Lo mismo para la Doble Oferta. Ver `order_bump_choice_at`. */
  bioferta_choice_at: number | null;
  /** LA ÚLTIMA DECISIÓN QUE YA SE CONTESTÓ.
   *
   *  Los cuadritos no tenían memoria: cada vez que el cliente escribía la
   *  palabra, el bot volvía a soltar el bloque entero. Preguntar «¿esa es la
   *  cuenta BCP?» contenía «bcp», así que le llegaban otra vez los datos… y
   *  otra, y otra. Un bucle del que el cliente no puede salir mientras siga
   *  nombrando lo mismo — y del que se va.
   *
   *  Aquí se guarda cuál fue, para no repetirla. Elegir OTRA cosa sí vale: eso
   *  es cambiar de opinión, no repetirse. */
  ultima_decision: string | null;
  /** Método cuyos datos de pago ya se enviaron. Persiste durante dudas y
   *  cambios de producto para no volver a ofrecer el menú innecesariamente. */
  selected_payment_method: string | null;
  /** Nuestro numero de WhatsApp por el que entro esta conversacion.
   *  null = conversacion antigua u otro canal -> se usa el numero activo. */
  wa_phone_number_id: string | null;
  /** NUESTRA PAGINA DE FACEBOOK por la que entro esta conversacion.
   *
   *  El gemelo de `wa_phone_number_id`, para Messenger. Hace falta por lo mismo:
   *  un seguimiento sale HORAS despues, desde el obrero, y ahi ya no esta el
   *  webhook delante para saber de que pagina era. Sin esto saldria por la
   *  pagina activa — y con dos paginas, la mitad de los seguimientos saldrian
   *  por la que no es.
   *
   *  null = conversacion anterior a esta columna u otro canal -> se usa la
   *  pagina activa, que es exactamente lo que se hacia antes. */
  messenger_page_id: string | null;
  intro_variant_sent: number | null;
  /** En qué paso quedó la intro esperando una elección. null = no está en
   *  pausa. Se guarda el paso SIGUIENTE, que es por donde hay que retomar. */
  intro_paused_index: number | null;
  /** Galería: temas de imágenes/videos ya enviados a esta conversación
   *  (lista separada por comas). Evita reenviar la misma media. NULL = ninguna. */
  sent_media: string | null;
  /** 1 = ya se repitió una vez la invitación visual del regalo después de
   *  capturar el correo mientras esperaba consentimiento. */
  gift_reminder_sent: number;
  gift_rewarded: number;
  /** 1 = ya se recordo una vez el correo despues de entregar el regalo. */
  email_reminder_sent: number;
  /** 1 = ya se envio la encuesta post-compra. Evita duplicados. */
  customer_survey_sent: number;
  /** Fuente de entrega pendiente mientras se pregunta WhatsApp/correo. */
  pending_delivery_source:
    | "approved"
    | "bioferta_a"
    | "bioferta_b"
    | "bioferta_pack"
    | "ob_combo"
    | "ob_basico"
    | "upsell"
    | null;
  // Click-To-WhatsApp Ads attribution: capturados del primer mensaje del
  // cliente cuando viene de un anuncio. Permiten que Meta atribuya Contact
  // y Purchase events al anuncio específico que generó el click.
  ctwa_clid: string | null;
  ad_source_id: string | null;
  ad_source_url: string | null;
  ad_headline: string | null;
  /** Último evento que se le intentó mandar a Meta ("LeadSubmitted", etc.). */
  capi_last_event: string | null;
  /** 1 = Meta lo aceptó. 0 = lo rechazó. NULL = nunca se intentó. */
  capi_last_ok: number | null;
  /** El motivo, con las palabras de Meta. Solo cuando falló. */
  capi_last_error: string | null;
  /** El conjunto de datos que recibió el evento. Para que él vea si es el suyo. */
  capi_last_pixel: string | null;
  /** La página que viajó en el evento. Si Meta lo aceptó, coincidía con el anuncio. */
  capi_last_pagina: string | null;
  /** La tienda que atendió la conversación, por su nombre. */
  capi_last_tienda: string | null;
  capi_last_at: number | null;
  /** 1 = conversación pineada al top de la lista. */
  pinned: number;
  /** unixepoch del momento en que se pineó (para ordenar las pineadas). */
  pinned_at: number | null;
  /** unixepoch hasta donde el operador leyó la conversación. */
  last_read_at: number;
  /** 1 = el operador la marcó manualmente como no leída (estilo WhatsApp:
   *  puntito verde sin número aunque no haya mensajes nuevos del cliente).
   *  Se limpia al marcarla como leída. */
  manually_unread: number;
  /** Indice 0-based del ULTIMO seguimiento disparado para esta convo:
   *  -1 = ninguno, 0 = seg 1, 1 = seg 2, 2 = seg 3.
   *  Usado por el sistema de slots: cuando llega un mensaje del cliente,
   *  si este indice es 0 o 1, se programa el seguimiento siguiente. */
  last_followup_index: number;
  /** Timestamp (unix sec) del ultimo seguimiento que arranco. Sirve como
   *  milestone para el check de engagement y para la regla min_gap del
   *  sistema de slots. 0 = ninguno aun. */
  last_followup_started_at: number;
  /** Ruta comercial fija para A/B test. NULL = sin experimento/asignar. */
  commercial_sales_route: "A" | "B" | null;
  /** País confirmado manualmente (Messenger no expone lada). */
  country_code: string | null;
  /** Evita repetir la pregunta editable de país en Messenger. */
  messenger_country_prompted: number;
  /** Canal que reproduce el simulador sin salir a Meta. */
  test_channel: "whatsapp" | "messenger" | null;
  /**
   * MODO TESTEADOR: modalidad que reproduce ESTA prueba, sin tocar la que
   * venden tus clientas. Solo existe en conversaciones del simulador; en una
   * conversación real siempre es null y el bot usa la modalidad de siempre.
   */
  test_modality:
    | "lineal"
    | "order_bump"
    | "bioferta"
    | "doble_oferta_dos"
    | "doble_oferta_upsell"
    | "upsell"
    | null;
  /**
   * LA PRESENTACIÓN CON LA QUE ESTA CONVERSACIÓN EMPEZÓ A VENDER.
   *
   * POR QUÉ EXISTE. El dueño mueve el selector «PRESENTA:» cuando quiere, y con
   * clientes a media conversación. Sin esto, al cambiarlo, un cliente al que se
   * le presentó UN producto y se le dio SU precio de pronto pasaba a una venta de
   * dos opciones: el bot le contradecía lo que acababa de decirle.
   *
   * Es el mismo principio que los precios congelados de al lado —y por el mismo
   * motivo—: lo que ya se le prometió a un cliente no se le cambia por debajo.
   *
   * SE ESCRIBE UNA SOLA VEZ, cuando la conversación nace, y el `WHERE ... IS
   * NULL` del UPDATE lo garantiza desde la propia base: ni llamándolo dos veces
   * se puede sobreescribir.
   *
   * NULL = las conversaciones que ya existían antes de esto. Para ellas se lee el
   * selector de hoy, o sea EXACTAMENTE el comportamiento anterior: nadie que esté
   * hablando ahora mismo nota nada.
   */
  presentacion_de_venta: "ninguna" | "dos_juntas" | "segunda_oculta" | null;
  /**
   * ¿YA SE LE CONTÓ QUE AHORA HAY DOS OPCIONES?
   *
   * 1 = ya se le dijo. Solo se enciende en las conversaciones que nacieron con
   * una forma de vender y hoy ven otra (el modo reenganche). Sin esto se lo
   * repetiría en cada mensaje, que es peor que no decirlo.
   */
  aviso_actualizacion_enviado: number;
  /**
   * QUÉ VARIANTE DEL SEGUIMIENTO SE LE ENVIÓ.
   *
   * Los botones de una burbuja se buscan por su id, y al DUPLICAR una variante
   * el id del botón se copia tal cual. Sin saber qué variante recibió éste
   * cliente, el motor cogía la primera copia que encontraba en el archivo —otra
   * variante, con otra acción—. Ver `runBubbleButtonAction`.
   *
   * NULL en las conversaciones de antes de esto: ahí se lee como hasta hoy.
   */
  followup_variant_sent: number | null;
}

export interface QuickReplyRow {
  id: number;
  shortcut: string | null;
  content: string;
  created_at: number;
  /** Adjunto opcional: se sube UNA vez al crear la respuesta y queda pegado. */
  media_type: "image" | "video" | "document" | "audio" | null;
  media_url: string | null;
  media_mime: string | null;
  media_filename: string | null;
}

/** Adjunto ya guardado en disco y listo para mandarse. */
export interface QuickReplyMedia {
  media_type: "image" | "video" | "document" | "audio";
  media_url: string;
  media_mime: string;
  media_filename: string | null;
}

export interface BlockedNumberRow {
  phone: string;
  reason: string | null;
  blocked_at: number;
}

export interface ScheduledActionRow {
  id: number;
  conversation_id: number;
  action_type: string;
  payload: string;
  run_at: number;
  status: "pending" | "completed" | "cancelled" | "failed";
  created_at: number;
  /** Marca temporal de toma exclusiva por un worker. Evita que dos procesos
   * ejecuten el mismo envío antes de que quede como completed. */
  claimed_at: number | null;
}

export interface MetaConnectionRow {
  id: number;
  page_id: string;
  page_name: string;
  page_access_token: string;
  instagram_business_account_id: string | null;
  instagram_username: string | null;
  page_picture_url: string | null;
  selected: number;
  active: number;
  connected_at: number;
  updated_at: number;
  /** El negocio de Meta dueño de la página. null = sin identificar. */
  business_id: string | null;
  business_name: string | null;
  /** JSON [{id, nombre}]: las cuentas que pueden usarla. null = no se sabe todavía. */
  compartido_con: string | null;
}

export interface MetaDetectedEnvRow {
  name: string;
  value: string;
  source: string;
  detected_at: number;
}

export interface MetaAdsReaderRow {
  id: number;
  name: string;
  token: string;
  updated_at: number;
  /** null = en uso. Con fecha = está en la papelera, con su token intacto. */
  deleted_at?: number | null;
}

export interface AdOriginCacheRow {
  ad_id: string;
  ad_account_id: string;
  ad_account_name: string;
  business_id: string;
  business_name: string;
  campaign_id: string;
  campaign_name: string;
  ad_name: string;
  reader_name: string;
  updated_at: number;
}

export interface MetaWhatsAppConnectionRow {
  id: number;
  phone_number_id: string;
  waba_id: string;
  display_phone_number: string | null;
  verified_name: string | null;
  profile_picture_url: string | null;
  access_token: string;
  active: number;
  connected_at: number;
  updated_at: number;
  /** El negocio de Meta dueño de la cuenta de WhatsApp. null = sin identificar. */
  business_id: string | null;
  business_name: string | null;
  /** JSON [{id, nombre}]: las cuentas que pueden usarlo. null = no se sabe todavía. */
  compartido_con: string | null;
  /** 1 = `access_token` es el token permanente de su BM (no caduca). Ver la migración. */
  token_permanente?: number;
}

export interface ConversationListRow extends ConversationRow {
  last_message_preview: string | null;
  /** Cantidad de mensajes del cliente sin leer (created_at > last_read_at). */
  unread_count: number;
  /** unixepoch del ÚLTIMO mensaje DEL CLIENTE (role='user'). Define la ventana
   *  de 24h de WhatsApp. NULL si el cliente nunca escribió. */
  last_user_message_at: number | null;
  /** Cantidad total de mensajes del cliente (para etiqueta hot/warm). */
  user_msg_count: number;
}

export interface MessageRow {
  id: number;
  conversation_id: number;
  role: Role;
  content: string;
  wa_message_id: string | null;
  created_at: number;
  media_type: MediaType | null;
  media_url: string | null;
  media_mime: string | null;
  media_filename: string | null;
  transcription: string | null;
  duration_sec: number | null;
  /** Estado del mensaje saliente según los webhooks de Meta. Para mensajes
   *  entrantes (role='user') queda NULL — no se renderizan checks. */
  wa_status: WaStatus | null;
}

export interface MediaPayload {
  media_type: MediaType;
  media_url: string;
  media_mime: string;
  media_filename: string | null;
  transcription: string | null;
  duration_sec: number | null;
}

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "messages.db");

// Durante `next build`, cada worker importa este módulo y abre/escribe el
// mismo SQLite a la vez (y el bot en producción puede tenerlo bloqueado) →
// el build falla con SQLITE_BUSY. Solo durante el build usamos una base EN
// MEMORIA (temporal por worker) para evitar el bloqueo. En runtime
// (next start / next dev) se usa SIEMPRE la base real.
const IS_NEXT_BUILD = process.env.NEXT_PHASE === "phase-production-build";

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(IS_NEXT_BUILD ? ":memory:" : DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS meta_ads_readers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    token TEXT NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS ad_origin_cache (
    ad_id TEXT PRIMARY KEY,
    ad_account_id TEXT NOT NULL DEFAULT '',
    ad_account_name TEXT NOT NULL DEFAULT '',
    business_id TEXT NOT NULL DEFAULT '',
    business_name TEXT NOT NULL DEFAULT '',
    campaign_id TEXT NOT NULL DEFAULT '',
    campaign_name TEXT NOT NULL DEFAULT '',
    ad_name TEXT NOT NULL DEFAULT '',
    reader_name TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
`);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT UNIQUE NOT NULL,
    name TEXT,
    mode TEXT CHECK(mode IN ('AI','HUMAN')) NOT NULL DEFAULT 'AI',
    last_message_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id),
    role TEXT CHECK(role IN ('user','assistant','human')) NOT NULL,
    content TEXT NOT NULL,
    wa_message_id TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE INDEX IF NOT EXISTS idx_messages_conv
    ON messages(conversation_id, created_at);

  -- La lista del panel pregunta, por CADA conversacion: cuantos mensajes sin
  -- leer hay, cuando escribio el cliente por ultima vez y cuantos escribio en
  -- total. Las tres filtran por role='user', y el indice de arriba no incluye
  -- ese dato: habia que recorrer todos los mensajes de la conversacion para
  -- responder cada una. Con role dentro, se responden directamente.
  CREATE INDEX IF NOT EXISTS idx_messages_conv_role
    ON messages(conversation_id, role, created_at);

  CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_wa_id
    ON messages(wa_message_id) WHERE wa_message_id IS NOT NULL;

  CREATE TABLE IF NOT EXISTS processed_webhook_messages (
    wa_message_id TEXT PRIMARY KEY,
    processed_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
`);

// Migración idempotente: añadir columnas de media si no existen.
// SQLite lanza error si la columna ya existe — lo ignoramos.
const mediaColumns: Array<[string, string]> = [
  ["media_type", "TEXT"],
  ["media_url", "TEXT"],
  ["media_mime", "TEXT"],
  ["media_filename", "TEXT"],
  ["transcription", "TEXT"],
  ["duration_sec", "INTEGER"],
  // Estado WhatsApp del mensaje saliente: sent / delivered / read / failed.
  // NULL para mensajes entrantes.
  ["wa_status", "TEXT"],
];
for (const [name, type] of mediaColumns) {
  try {
    db.exec(`ALTER TABLE messages ADD COLUMN ${name} ${type}`);
  } catch {
    // ya existe, no pasa nada
  }
}

const conversationColumns: Array<[string, string]> = [
  ["state", "TEXT"],
  ["client_name", "TEXT"],
  ["client_email", "TEXT"],
  ["paid_total_cents", "INTEGER NOT NULL DEFAULT 0"],
  // Fecha (unixepoch) en que el pago se aprobó. Para el panel de ventas
  // (filtro por fechas + sumas de dinero). NULL = aún no compró.
  ["paid_at", "INTEGER"],
  ["ctwa_clid", "TEXT"],
  ["ad_source_id", "TEXT"],
  // De donde nacio el lead cuando no basta con el canal: "comment" = respondio
  // al privado de un comentario de Facebook. NULL = entro por el camino normal
  // del canal (asi quedan todas las conversaciones anteriores, sin cambiar).
  ["lead_origin", "TEXT"],
  ["ad_source_url", "TEXT"],
  ["ad_headline", "TEXT"],
  ["payment_attempts_failed", "INTEGER NOT NULL DEFAULT 0"],
  ["discount_active", "INTEGER NOT NULL DEFAULT 0"],
  ["locked_price_cents", "INTEGER"],
  ["locked_price_currency", "TEXT"],
  ["locked_price_source", "TEXT"],
  ["locked_price_discount_active", "INTEGER"],
  ["locked_price_updated_at", "INTEGER"],
  ["frozen_prices", "TEXT"],
  ["nocodb_row_id", "TEXT"],
  ["nocodb_label", "TEXT"],
  ["nocodb_resumen", "TEXT"],
  ["had_emergency", "INTEGER NOT NULL DEFAULT 0"],
  // Bioferta Oferta Doble: qué producto eligió el cliente ('a' | 'b' | 'pack').
  // NULL = aún no eligió. Solo se usa si la bioferta está activa.
  ["bioferta_choice", "TEXT"],
  ["sent_media", "TEXT"],
  ["gift_reminder_sent", "INTEGER NOT NULL DEFAULT 0"],
  ["gift_rewarded", "INTEGER NOT NULL DEFAULT 0"],
  ["email_reminder_sent", "INTEGER NOT NULL DEFAULT 0"],
  ["customer_survey_sent", "INTEGER NOT NULL DEFAULT 0"],
  ["pending_delivery_source", "TEXT"],
  // Bioferta Order Bump: qué opción eligió ('combo' | 'basico'). NULL = aún no.
  ["order_bump_choice", "TEXT"],
  // Order Bump: 1 cuando el cliente nombró una opción JUSTO tras preguntar el
  // precio y el bot respondió "cuesta S/N, ¿lo quieres?" — esperamos el sí antes
  // de enviar los datos de pago. Se limpia al confirmar o al cambiar de tema.
  ["ob_price_confirm_pending", "INTEGER NOT NULL DEFAULT 0"],
  // Order Bump: 1 cuando disparó un seguimiento DESPUÉS de que el cliente ya
  // había elegido una opción. El seguimiento muestra el precio del básico/oferta,
  // así que la elección previa quedó "vencida": si el cliente elige método de
  // pago tras el seguimiento, en vez de soltar el precio viejo le recordamos las
  // 2 opciones. Se limpia cuando vuelve a elegir un producto.
  ["ob_choice_stale", "INTEGER NOT NULL DEFAULT 0"],
  ["order_bump_revealed", "INTEGER NOT NULL DEFAULT 0"],
  ["strikes_piropo", "INTEGER NOT NULL DEFAULT 0"],
  ["strikes_basura", "INTEGER NOT NULL DEFAULT 0"],
  ["upsell_state", "TEXT"],
  ["upsell_recordatorio_enviado", "INTEGER NOT NULL DEFAULT 0"],
  ["upsell_base_cents", "INTEGER NOT NULL DEFAULT 0"],
  ["upsell_paid_at", "INTEGER"],
  ["upsell_frozen_prices", "TEXT"],
  ["upsell_paid_cents", "INTEGER NOT NULL DEFAULT 0"],
  // UPSELLS EN FILA (PLAN-UPSELLS-EN-FILA.md). Vacías = el upsell de siempre, letra por
  // letra: así arrancan todas las conversaciones de antes de esto.
  ["upsell_fila_id", "TEXT"],
  ["upsell_producto_id", "TEXT"],
  ["upsell_downsell", "INTEGER NOT NULL DEFAULT 0"],
  ["upsell_fila_parada", "INTEGER NOT NULL DEFAULT 0"],
  ["upsell_comprados", "TEXT"],
  // LA TIENDA ELEGIDA POR LA FRASE DE ENTRADA (12/10/2026). Vacía = se elige por el número,
  // como siempre. Ver `tiendaPorFraseDeEntrada` en config.ts.
  ["tienda_id", "TEXT"],
  // EL CAMINO DE LA INTRO QUE RECIBIÓ (18/10/2026). Vacío = el principal, que es como arrancan
  // todas las de antes de esto. Ver `etiqueta-de-camino.ts`.
  ["camino", "TEXT"],
  // Última vez que el bot habló DE la oferta del extra. Con esto se sabe si la
  // oferta sigue siendo la última pregunta o si alguien preguntó otra cosa
  // después. Ver la columna en ConversationRow.
  ["upsell_hablado_at", "INTEGER"],
  // Cuándo se anotó la opción elegida. La reconciliación previa a validar un
  // comprobante solo puede mirar mensajes POSTERIORES a esto: releer el que ya
  // produjo la elección la daba la vuelta. Ver la columna.
  ["order_bump_choice_at", "INTEGER"],
  ["bioferta_choice_at", "INTEGER"],
  // La última decisión ya contestada, para no repetirla. Ver ConversationRow.
  ["ultima_decision", "TEXT"],
  ["selected_payment_method", "TEXT"],
  ["intro_variant_sent", "INTEGER"],
  // Paso por el que hay que RETOMAR la intro cuando quedó esperando una
  // elección. NULL = no está en pausa, que es lo que vale para todas las
  // conversaciones anteriores a esta columna.
  ["intro_paused_index", "INTEGER"],
  // Idempotencia anti doble-conteo: huellas de comprobantes ya contados
  // (op / fecha+hora+monto / id de la imagen), separadas por coma.
  ["counted_receipts", "TEXT"],
  // Por CUAL de NUESTROS numeros de WhatsApp entro esta conversacion. Un bot
  // puede tener varios numeros conectados (Meta permite 2 por app), y hay que
  // responderle a cada cliente por el mismo numero al que escribio.
  // NULL = conversaciones anteriores a esta columna, o canales que no son
  // WhatsApp: se responden por el numero activo, que es exactamente lo que
  // hacian antes. Por eso la columna es opcional y no rompe nada existente.
  ["wa_phone_number_id", "TEXT"],
  // LA PAGINA DE FACEBOOK por la que entro, el gemelo de la de arriba para
  // Messenger. Mismo motivo: con varias paginas conectadas hay que contestarle a
  // cada cliente por la misma pagina a la que escribio, y el seguimiento que sale
  // horas despues ya no tiene el webhook delante para saberlo.
  // NULL = conversaciones anteriores a esta columna, o canales que no son
  // Messenger: se responden por la pagina activa, como hacian antes.
  ["messenger_page_id", "TEXT"],
  // Pinear conversaciones al top de la lista.
  ["pinned", "INTEGER NOT NULL DEFAULT 0"],
  ["pinned_at", "INTEGER"],
  // Indicador de no leídos: unixepoch hasta el cual el operador "leyó"
  // la conversación. Un mensaje del cliente con created_at > last_read_at
  // cuenta como no leído.
  ["last_read_at", "INTEGER NOT NULL DEFAULT 0"],
  // Flag de "marcado manual como no leído" estilo WhatsApp: cuando el
  // operador clickea el botón "marcar como no leído" sin que haya
  // mensajes nuevos del cliente, esto vale 1 y la UI muestra un puntito
  // verde sin número. Se limpia al marcar como leído.
  ["manually_unread", "INTEGER NOT NULL DEFAULT 0"],
  // Timestamp (unix sec) del ULTIMO seguimiento que disparo para esta
  // convo. Sirve como "milestone" para el check de engagement: antes de
  // disparar un seguimiento, verificamos si el cliente respondio DESDE
  // el ultimo milestone. Si esta silencioso, cancelamos el seguimiento
  // para no insistir y reducir bloqueos.
  // Si es 0, usamos conversations.created_at (T0) como referencia.
  ["last_followup_started_at", "INTEGER NOT NULL DEFAULT 0"],
  // Indice 0-based del ultimo seguimiento disparado (-1 = ninguno aun).
  // Sirve para que cuando llegue un mensaje del cliente, sepamos si toca
  // programar seg 2 o seg 3.
  ["last_followup_index", "INTEGER NOT NULL DEFAULT -1"],
  ["commercial_sales_route", "TEXT"],
  ["channel", "TEXT NOT NULL DEFAULT 'whatsapp'"],
  ["country_code", "TEXT"],
  ["messenger_country_prompted", "INTEGER NOT NULL DEFAULT 0"],
  ["test_channel", "TEXT"],
  // Modalidad del simulador. NULL en toda conversación real: el modo testeador
  // no puede alcanzarlas ni por error.
  ["test_modality", "TEXT"],
  // Cómo le fue al último evento que se le mandó a Meta por esta conversación.
  // Antes ese resultado solo vivía en el log, o sea que un evento que no llegó
  // no se notaba hasta mirar los números días después.
  ["capi_last_event", "TEXT"],
  ["capi_last_ok", "INTEGER"],
  ["capi_last_error", "TEXT"],
  ["capi_last_at", "INTEGER"],
  // A DÓNDE fue ese evento. Añadido el 5 de octubre de 2026 porque el dueño no
  // tenía forma de ver si el pixel elegido era el suyo: un pixel equivocado NO
  // da error —Meta lo acepta y guarda la compra en el conjunto de datos de al
  // lado—, así que el panel decía «enviado» y la venta no aparecía en sus
  // informes. El destino no se puede juzgar desde el código (Meta no publica
  // qué pixel usa una campaña de clic a WhatsApp), pero sí se puede ENSEÑAR
  // para que lo juzgue él.
  ["capi_last_pixel", "TEXT"],
  ["capi_last_pagina", "TEXT"],
  ["capi_last_tienda", "TEXT"],
  // La presentación con la que la conversación empezó a vender. NULL en las que
  // ya existían: para ellas se lee el selector de hoy, igual que antes.
  ["presentacion_de_venta", "TEXT"],
  // Si ya se le contó que ahora hay dos opciones. 0 en todas las que existían:
  // a ninguna se le debe nada mientras el reenganche esté apagado.
  ["aviso_actualizacion_enviado", "INTEGER NOT NULL DEFAULT 0"],
  // La variante del seguimiento que se le envió, para poder resolver los
  // botones de SU burbuja y no los de otra variante. Ver `ConversationRow`.
  ["followup_variant_sent", "INTEGER"],
];
for (const [name, type] of conversationColumns) {
  try {
    db.exec(`ALTER TABLE conversations ADD COLUMN ${name} ${type}`);
  } catch {
    // ya existe
  }
}

db.exec(`
  CREATE TABLE IF NOT EXISTS scheduled_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    action_type TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}',
    run_at INTEGER NOT NULL,
    status TEXT CHECK(status IN ('pending','completed','cancelled','failed')) NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_scheduled_due
    ON scheduled_actions(status, run_at);
  CREATE INDEX IF NOT EXISTS idx_scheduled_convo
    ON scheduled_actions(conversation_id, status);

  CREATE TABLE IF NOT EXISTS quick_replies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shortcut TEXT,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS blocked_numbers (
    phone TEXT PRIMARY KEY,
    reason TEXT,
    blocked_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  -- Inversión diaria en anuncios (ingresada manualmente desde el panel) para
  -- calcular el ROAS. date = 'YYYY-MM-DD' (fecha Perú). Solo lectura/escritura
  -- desde el panel; no interviene en el flujo del bot.
  CREATE TABLE IF NOT EXISTS ad_spend (
    date TEXT PRIMARY KEY,
    amount_cents INTEGER NOT NULL DEFAULT 0
  );

  -- Comentarios de Facebook pendientes de respuesta privada. Un comentario que
  -- coincide con las palabras clave sale de inmediato; el que no, espera las
  -- horas configuradas. Meta solo permite UNA respuesta privada por comentario,
  -- así que comment_id es la clave: nunca se responde dos veces al mismo.
  CREATE TABLE IF NOT EXISTS pending_comments (
    comment_id TEXT PRIMARY KEY,
    page_id TEXT NOT NULL,
    commenter_id TEXT,
    commenter_name TEXT,
    text TEXT,
    matched INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    send_at INTEGER NOT NULL,
    sent_at INTEGER,
    -- pending | sent | replied | lost | skipped | failed
    status TEXT NOT NULL DEFAULT 'pending',
    error TEXT
  );

  -- Igual que ad_spend pero separada POR PAÍS, para poder calcular la ganancia
  -- real de cada país (ventas de Perú menos lo gastado en Perú). El importe va
  -- en la moneda de ese país. La tabla anterior se conserva intacta como
  -- respaldo; esta es la que usa el panel.
  CREATE TABLE IF NOT EXISTS ad_spend_country (
    date TEXT NOT NULL,
    country TEXT NOT NULL,
    amount_cents INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (date, country)
  );

  CREATE TABLE IF NOT EXISTS meta_connections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    page_id TEXT UNIQUE NOT NULL,
    page_name TEXT NOT NULL,
    page_access_token TEXT NOT NULL,
    instagram_business_account_id TEXT,
    instagram_username TEXT,
    page_picture_url TEXT,
    selected INTEGER NOT NULL DEFAULT 1,
    active INTEGER NOT NULL DEFAULT 0,
    connected_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS meta_detected_env (
    name TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    source TEXT NOT NULL,
    detected_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS meta_runtime_settings (
    name TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS meta_whatsapp_connections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone_number_id TEXT UNIQUE NOT NULL,
    waba_id TEXT NOT NULL,
    display_phone_number TEXT,
    verified_name TEXT,
    profile_picture_url TEXT,
    access_token TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 0,
    connected_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  -- Botones exclusivos del simulador: conservan el historial comercial como
  -- texto normal, pero permiten reproducir los controles del cliente.
  CREATE TABLE IF NOT EXISTS test_message_buttons (
    message_id INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
    buttons_json TEXT NOT NULL
  );
`);

// Una acción puede ser leída por más de un proceso durante un deploy. La marca
// se añade sin cambiar los estados existentes para conservar compatibilidad con
// las bases ya instaladas.
try {
  db.exec("ALTER TABLE scheduled_actions ADD COLUMN claimed_at INTEGER");
} catch {
  // La columna ya existe.
}

// Estas columnas conservan la identidad visual y distinguen paginas apenas
// detectadas de las que el operador eligio para este agente. Deben existir
// antes de preparar las consultas SQL que las usan.
for (const statement of [
  "ALTER TABLE meta_connections ADD COLUMN page_picture_url TEXT",
  "ALTER TABLE meta_connections ADD COLUMN selected INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE meta_whatsapp_connections ADD COLUMN profile_picture_url TEXT",
  // PAPELERA de cuentas de lectura: "Quitar" ya no borra, marca la fecha. El
  // token sigue guardado hasta que se borre a proposito, asi un clic suelto no
  // cuesta un token que despues hay que volver a pedirle a Meta.
  "ALTER TABLE meta_ads_readers ADD COLUMN deleted_at INTEGER",
  // LA CUENTA DUEÑA de cada número y cada página: el negocio de Meta al que
  // pertenece. Lo pidió el dueño el 09/10/2026 para trabajar con varias cuentas de
  // Facebook sin mezclar en una tienda el número de una con el píxel de otra. NULL
  // = todavía sin identificar, que es como quedan las conexiones de antes.
  "ALTER TABLE meta_whatsapp_connections ADD COLUMN business_id TEXT",
  "ALTER TABLE meta_whatsapp_connections ADD COLUMN business_name TEXT",
  "ALTER TABLE meta_connections ADD COLUMN business_id TEXT",
  "ALTER TABLE meta_connections ADD COLUMN business_name TEXT",
  // LAS CUENTAS QUE PUEDEN USARLO: la dueña y las que lo tienen compartido, como JSON
  // [{id, nombre}]. Lo pidió el dueño el 10/10/2026: «si están compartidos también».
  // NULL = todavía no se sabe; se rellena al pulsar «Actualizar lista de Meta».
  "ALTER TABLE meta_whatsapp_connections ADD COLUMN compartido_con TEXT",
  "ALTER TABLE meta_connections ADD COLUMN compartido_con TEXT",
  // EL TOKEN PERMANENTE DE CADA NÚMERO (21/10/2026). 1 = su `access_token` es el token
  // permanente del BM dueño del número, que no caduca; 0 = el del inicio de sesión (~60 días).
  // Con 1, un inicio de sesión nuevo ya no lo pisa. Ver `ponerTokenPermanenteAlNumero`.
  "ALTER TABLE meta_whatsapp_connections ADD COLUMN token_permanente INTEGER NOT NULL DEFAULT 0",
]) {
  try {
    db.exec(statement);
  } catch {
    // La columna ya existe.
  }
}

// Limpieza one-shot del bug de SQL en stmtUpdateMsgStatus: por falta de
// parentesis, un solo webhook 'failed' marcaba TODA la tabla messages como
// failed. user_version garantiza que esto corre una sola vez aunque se
// reinicie el proceso.
{
  const currentVersion = db.pragma("user_version", { simple: true }) as number;
  if (currentVersion < 1) {
    const cleared = db
      .prepare("UPDATE messages SET wa_status = NULL WHERE wa_status = 'failed'")
      .run();
    console.log(
      `[db] limpieza wa_status corrupto: ${cleared.changes} mensajes reseteados`
    );
    db.pragma("user_version = 1");
  }
}

const stmtGetConvoByPhone = db.prepare<[string], ConversationRow>(
  "SELECT * FROM conversations WHERE phone = ?"
);
const stmtSetConversationCountry = db.prepare<[string, number]>(
  "UPDATE conversations SET country_code = ?, messenger_country_prompted = 0 WHERE id = ?"
);
const stmtSetMessengerCountryPrompted = db.prepare<[number]>(
  "UPDATE conversations SET messenger_country_prompted = 1 WHERE id = ?"
);
const stmtSetTestChannel = db.prepare<["whatsapp" | "messenger", number]>(
  "UPDATE conversations SET test_channel = ? WHERE id = ?"
);
// Solo para conversaciones del simulador: el WHERE exige channel='test', asi
// que aunque llegara un id equivocado NO puede tocar una conversacion real.
const stmtSetTestModality = db.prepare<[string | null, number]>(
  "UPDATE conversations SET test_modality = ? WHERE id = ? AND channel = 'test'"
);
// SE ESCRIBE UNA SOLA VEZ, Y LO GARANTIZA LA PROPIA BASE.
//
// El `IS NULL` del WHERE es la contención: ni llamando a esto en cada mensaje se
// puede pisar la presentación con la que la conversación empezó. Lo que ya se le
// prometió a un cliente no se le cambia por debajo.
const stmtFijarPresentacionDeVenta = db.prepare<[string, number]>(
  "UPDATE conversations SET presentacion_de_venta = ? WHERE id = ? AND presentacion_de_venta IS NULL"
);
/**
 * ANOTA LA TIENDA QUE ELIGIÓ LA FRASE DE ENTRADA — una sola vez, y solo mientras la
 * conversación es nueva.
 *
 * Las dos condiciones viven en el WHERE, igual que la presentación: `tienda_id IS NULL`
 * (no se pisa nunca) y `state = 'new'` (solo antes de la intro). Así una frase escrita a
 * mitad de una venta no puede cambiarle la tienda —ni los precios, ni quién cobra— a un
 * cliente que ya está comprando. Devuelve true si la anotó esta llamada.
 */
const stmtFijarTiendaPorFrase = db.prepare<[string, number]>(
  "UPDATE conversations SET tienda_id = ? WHERE id = ? AND tienda_id IS NULL AND state = 'new'"
);
export function fijarTiendaPorFraseSiFalta(
  conversationId: number,
  tiendaId: string
): boolean {
  return stmtFijarTiendaPorFrase.run(tiendaId, conversationId).changes > 0;
}

export function fijarPresentacionDeVentaSiFalta(
  conversationId: number,
  valor: "ninguna" | "dos_juntas" | "segunda_oculta"
): void {
  stmtFijarPresentacionDeVenta.run(valor, conversationId);
}
const stmtMarcarAvisoDeActualizacion = db.prepare<[number]>(
  "UPDATE conversations SET aviso_actualizacion_enviado = 1 WHERE id = ?"
);
/** Queda dicho que ahora hay dos opciones. Ver `hayQueAvisarDeLaActualizacion`. */
export function marcarAvisoDeActualizacionEnviado(conversationId: number): void {
  stmtMarcarAvisoDeActualizacion.run(conversationId);
}
const stmtFijarVarianteDeSeguimiento = db.prepare<[number | null, number]>(
  "UPDATE conversations SET followup_variant_sent = ? WHERE id = ?"
);
/** Anota la variante del seguimiento que se le envió. Ver `ConversationRow`. */
export function fijarVarianteDeSeguimientoEnviada(
  conversationId: number,
  variante: number | null
): void {
  stmtFijarVarianteDeSeguimiento.run(variante, conversationId);
}
const stmtInsertConvo = db.prepare<[string, string | null, ConversationChannel]>(
  "INSERT INTO conversations (phone, name, channel, state) VALUES (?, ?, ?, 'new')"
);
const stmtUpdateConvoName = db.prepare<[string, number]>(
  "UPDATE conversations SET name = ? WHERE id = ?"
);
const stmtUpdateConvoChannel = db.prepare<[ConversationChannel, number]>(
  "UPDATE conversations SET channel = ? WHERE id = ?"
);
const stmtGetConvoById = db.prepare<[number], ConversationRow>(
  "SELECT * FROM conversations WHERE id = ?"
);
const stmtInsertMessage = db.prepare<[number, Role, string, string | null]>(
  "INSERT INTO messages (conversation_id, role, content, wa_message_id) VALUES (?, ?, ?, ?)"
);
const stmtInsertMessageWithMedia = db.prepare<
  [
    number,
    Role,
    string,
    string | null,
    MediaType,
    string,
    string,
    string | null,
    string | null,
    number | null
  ]
>(
  `INSERT INTO messages
    (conversation_id, role, content, wa_message_id,
     media_type, media_url, media_mime, media_filename, transcription, duration_sec)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
const stmtTouchConvo = db.prepare<[number, number]>(
  "UPDATE conversations SET last_message_at = ? WHERE id = ?"
);
const stmtUpdateMsgWaId = db.prepare<[string, number]>(
  "UPDATE messages SET wa_message_id = ?, wa_status = 'sent' WHERE id = ?"
);
// Actualiza el estado de un mensaje saliente de forma monotónica:
// failed > read > delivered > sent > null. Así un 'delivered' tardío
// nunca pisa un 'read' que ya llegó. 'failed' siempre gana porque es
// terminal y accionable.
const stmtUpdateMsgStatus = db.prepare<[WaStatus, string, WaStatus, WaStatus]>(
  `UPDATE messages
      SET wa_status = ?
    WHERE wa_message_id = ?
      AND (
        COALESCE(
          CASE wa_status
            WHEN 'failed' THEN 99
            WHEN 'read' THEN 3
            WHEN 'delivered' THEN 2
            WHEN 'sent' THEN 1
            ELSE 0
          END, 0
        ) < CASE ?
          WHEN 'failed' THEN 99
          WHEN 'read' THEN 3
          WHEN 'delivered' THEN 2
          WHEN 'sent' THEN 1
          ELSE 0
        END
        OR ? = 'failed'
      )`
);
const stmtGetMessages = db.prepare<[number, number], MessageRow>(
  "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, id ASC LIMIT ?"
);
const stmtGetMessageById = db.prepare<[number], MessageRow>(
  "SELECT * FROM messages WHERE id = ?"
);
const stmtUpsertTestMessageButtons = db.prepare<[number, string]>(
  `INSERT INTO test_message_buttons (message_id, buttons_json)
   VALUES (?, ?)
   ON CONFLICT(message_id) DO UPDATE SET buttons_json = excluded.buttons_json`
);
const stmtGetTestMessageButtons = db.prepare<
  [number],
  { message_id: number; buttons_json: string }
>("SELECT message_id, buttons_json FROM test_message_buttons WHERE message_id = ?");
const stmtGetRecentDesc = db.prepare<[number, number], MessageRow>(
  "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC, id DESC LIMIT ?"
);
const stmtSetMode = db.prepare<[Mode, number]>(
  "UPDATE conversations SET mode = ? WHERE id = ?"
);
const stmtListConvos = db.prepare<[], ConversationListRow>(`
  SELECT c.*,
    (SELECT m.content FROM messages m
       WHERE m.conversation_id = c.id
       ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_message_preview,
    (SELECT COUNT(*) FROM messages m
       WHERE m.conversation_id = c.id
         AND m.role = 'user'
         AND m.created_at > c.last_read_at) AS unread_count,
    (SELECT MAX(m.created_at) FROM messages m
       WHERE m.conversation_id = c.id
         AND m.role = 'user') AS last_user_message_at,
    (SELECT COUNT(*) FROM messages m
       WHERE m.conversation_id = c.id
         AND m.role = 'user') AS user_msg_count
  FROM conversations c
  WHERE c.channel != 'test'
  ORDER BY
    c.pinned DESC,
    CASE WHEN c.pinned = 1 THEN c.pinned_at ELSE COALESCE(c.last_message_at, c.created_at) END DESC
`);
// La misma consulta pero acotada a las primeras N. Se escribe aparte, y no con
// un LIMIT opcional, para que SQLite pueda preparar y reutilizar las dos.
const stmtListConvosLimit = db.prepare<[number], ConversationListRow>(`
  SELECT c.*,
    (SELECT m.content FROM messages m
       WHERE m.conversation_id = c.id
       ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_message_preview,
    (SELECT COUNT(*) FROM messages m
       WHERE m.conversation_id = c.id
         AND m.role = 'user'
         AND m.created_at > c.last_read_at) AS unread_count,
    (SELECT MAX(m.created_at) FROM messages m
       WHERE m.conversation_id = c.id
         AND m.role = 'user') AS last_user_message_at,
    (SELECT COUNT(*) FROM messages m
       WHERE m.conversation_id = c.id
         AND m.role = 'user') AS user_msg_count
  FROM conversations c
  WHERE c.channel != 'test'
  ORDER BY
    c.pinned DESC,
    CASE WHEN c.pinned = 1 THEN c.pinned_at ELSE COALESCE(c.last_message_at, c.created_at) END DESC
  LIMIT ?
`);
const stmtDeleteMessages = db.prepare<[number]>(
  "DELETE FROM messages WHERE conversation_id = ?"
);
const stmtDeleteConvo = db.prepare<[number]>(
  "DELETE FROM conversations WHERE id = ?"
);
const stmtIsProcessed = db.prepare<[string], { wa_message_id: string }>(
  "SELECT wa_message_id FROM processed_webhook_messages WHERE wa_message_id = ?"
);
const stmtMarkProcessed = db.prepare<[string]>(
  "INSERT OR IGNORE INTO processed_webhook_messages (wa_message_id) VALUES (?)"
);

export function getOrCreateConversation(
  phone: string,
  name?: string | null,
  channel: ConversationChannel = "whatsapp"
): ConversationRow {
  const existing = stmtGetConvoByPhone.get(phone);
  if (existing) {
    if (name && existing.name !== name) {
      stmtUpdateConvoName.run(name, existing.id);
      existing.name = name;
    }
    if (existing.channel !== channel) {
      stmtUpdateConvoChannel.run(channel, existing.id);
      existing.channel = channel;
    }
    return existing;
  }
  const info = stmtInsertConvo.run(phone, name ?? null, channel);
  const created = stmtGetConvoById.get(Number(info.lastInsertRowid));
  if (!created) throw new Error("No se pudo crear la conversación");
  return created;
}

export function getConversationById(id: number): ConversationRow | undefined {
  return stmtGetConvoById.get(id);
}

export function getConversationByPhone(phone: string): ConversationRow | undefined {
  return stmtGetConvoByPhone.get(phone);
}

export function setConversationCountry(
  conversationId: number,
  country: string
): void {
  stmtSetConversationCountry.run(country, conversationId);
}

export function markMessengerCountryPrompted(conversationId: number): void {
  stmtSetMessengerCountryPrompted.run(conversationId);
}

export function setTestConversationChannel(
  conversationId: number,
  channel: "whatsapp" | "messenger"
): void {
  stmtSetTestChannel.run(channel, conversationId);
}

/**
 * Modalidad que reproduce una prueba del simulador. `null` = la que esté
 * vendiendo de verdad.
 *
 * La consulta exige `channel = 'test'`, así que ni con un id equivocado podría
 * marcar una conversación real.
 */
export function setTestConversationModality(
  conversationId: number,
  modality: string | null
): void {
  stmtSetTestModality.run(modality, conversationId);
}

const insertMessageTx = db.transaction(
  (
    conversationId: number,
    role: Role,
    content: string,
    waMessageId: string | null
  ): number => {
    const info = stmtInsertMessage.run(conversationId, role, content, waMessageId);
    stmtTouchConvo.run(Math.floor(Date.now() / 1000), conversationId);
    return Number(info.lastInsertRowid);
  }
);

const insertMessageWithMediaTx = db.transaction(
  (
    conversationId: number,
    role: Role,
    content: string,
    waMessageId: string | null,
    media: MediaPayload
  ): number => {
    const info = stmtInsertMessageWithMedia.run(
      conversationId,
      role,
      content,
      waMessageId,
      media.media_type,
      media.media_url,
      media.media_mime,
      media.media_filename,
      media.transcription,
      media.duration_sec
    );
    stmtTouchConvo.run(Math.floor(Date.now() / 1000), conversationId);
    return Number(info.lastInsertRowid);
  }
);

export function insertMessage(
  conversationId: number,
  role: Role,
  content: string,
  waMessageId?: string | null
): number {
  return insertMessageTx(conversationId, role, content, waMessageId ?? null);
}

export function insertMessageWithMedia(
  conversationId: number,
  role: Role,
  content: string,
  waMessageId: string | null,
  media: MediaPayload
): number {
  return insertMessageWithMediaTx(
    conversationId,
    role,
    content,
    waMessageId,
    media
  );
}

export function updateMessageWaId(messageId: number, waMessageId: string): void {
  stmtUpdateMsgWaId.run(waMessageId, messageId);
}

/**
 * Actualiza el estado de entrega de un mensaje saliente a partir del
 * wa_message_id que viene en el webhook de status de Meta. La query es
 * monotónica — no pisa estados más avanzados con estados más viejos.
 */
export function updateMessageStatus(
  waMessageId: string,
  status: WaStatus
): void {
  stmtUpdateMsgStatus.run(status, waMessageId, status, status);
}

export function getMessages(conversationId: number, limit = 50): MessageRow[] {
  return stmtGetMessages.all(conversationId, limit);
}

export function getMessageById(id: number): MessageRow | undefined {
  return stmtGetMessageById.get(id);
}

const stmtRegistrarEventoCapi = db.prepare<
  [string, number, string | null, string | null, string | null, string | null, number]
>(
  `UPDATE conversations
      SET capi_last_event = ?, capi_last_ok = ?, capi_last_error = ?,
          capi_last_pixel = ?, capi_last_pagina = ?, capi_last_tienda = ?,
          capi_last_at = unixepoch()
    WHERE id = ?`
);

/** A dónde se mandó el evento. Se enseña en el panel; no se juzga aquí. */
export interface DestinoDelEventoCapi {
  /** El conjunto de datos que recibió la compra. */
  pixel?: string | null;
  /** La página que viajó en el evento. Meta SÍ la valida contra el anuncio. */
  pagina?: string | null;
  /** Qué tienda atendió la conversación, por su nombre. */
  tienda?: string | null;
}

/**
 * Deja anotado cómo le fue al último evento mandado a Meta, Y A DÓNDE FUE.
 *
 * Es informativo: sirve para poder avisar en el panel cuando un evento no
 * llegó. Nunca debe interrumpir un envío, así que quien llama lo hace sin
 * esperar nada y los errores se tragan aquí.
 *
 * EL DESTINO SE GUARDA TAMBIÉN CUANDO SALE BIEN, y es el motivo de que exista.
 * Un pixel equivocado no falla: Meta lo acepta y guarda la compra en el conjunto
 * de datos de al lado. El panel decía «enviado» y la venta no aparecía en los
 * informes del dueño, sin una sola señal de que algo iba mal. Guardando el
 * destino, el panel puede enseñárselo y él reconoce si es el suyo.
 *
 * POR QUÉ NO SE JUZGA AQUÍ: «el correcto» es el que él eligió en la campaña, y
 * Meta no publica ese dato para campañas de clic a WhatsApp —medido el 4/10/2026
 * contra su documentación—. Así que el código no puede poner un check sin
 * inventárselo. Enseña el número; el veredicto es suyo.
 */
export function registrarEventoCapi(
  conversationId: number,
  evento: string,
  ok: boolean,
  error?: string | null,
  destino?: DestinoDelEventoCapi
): void {
  try {
    stmtRegistrarEventoCapi.run(
      evento,
      ok ? 1 : 0,
      ok ? null : error ?? null,
      destino?.pixel ?? null,
      destino?.pagina ?? null,
      destino?.tienda ?? null,
      conversationId
    );
  } catch (err) {
    console.error("[capi] no se pudo anotar el resultado del evento:", err);
  }
}

export type TestMessageButton = { id: string; title: string };

export function setTestMessageButtons(
  messageId: number,
  buttons: TestMessageButton[]
): void {
  stmtUpsertTestMessageButtons.run(messageId, JSON.stringify(buttons));
}

export function getTestMessageButtons(messageId: number): TestMessageButton[] {
  const row = stmtGetTestMessageButtons.get(messageId);
  if (!row) return [];
  try {
    const parsed = JSON.parse(row.buttons_json);
    return Array.isArray(parsed)
      ? parsed.filter(
          (button): button is TestMessageButton =>
            typeof button?.id === "string" && typeof button?.title === "string"
        )
      : [];
  } catch {
    return [];
  }
}

export function getRecentHistory(
  conversationId: number,
  limit = 20
): MessageRow[] {
  const desc = stmtGetRecentDesc.all(conversationId, limit);
  return desc.reverse();
}

export function setMode(conversationId: number, mode: Mode): void {
  stmtSetMode.run(mode, conversationId);
}

// Etiqueta del lead calculada LOCALMENTE (no depende de NocoDB). Misma lógica
// que computeLabel de leads-sync: pago-reclamo > pago > reclamo > hot > warm.
const HOT_MSG_THRESHOLD = 5;
const LABEL_BUYER_STATES = new Set<string>([
  "payment_approved",
  "awaiting_delivery_preference",
  "awaiting_email",
  "awaiting_gift_consent",
  "awaiting_facebook_comment",
]);
function deriveLeadLabel(row: ConversationListRow): string {
  const isPaid =
    (row.state != null && LABEL_BUYER_STATES.has(row.state)) ||
    (row.paid_total_cents ?? 0) > 0;
  if (isPaid && row.had_emergency) return "pago-reclamo";
  if (isPaid) return "pago";
  if (row.had_emergency) return "reclamo";
  if ((row.user_msg_count ?? 0) >= HOT_MSG_THRESHOLD) return "hot";
  return "warm";
}

/**
 * Lista de conversaciones para el panel.
 *
 * `limite` trae solo las primeras, que es lo que se ve al abrir. Como el orden
 * es por mensaje más reciente, quien escribe sube al tope y siempre entra en
 * ese primer grupo: no se pierde a nadie. Sin `limite` vienen todas, que es lo
 * que necesitan los contadores y el Kanban.
 */
export function listConversations(limite?: number): ConversationListRow[] {
  const rows =
    typeof limite === "number" && limite > 0
      ? stmtListConvosLimit.all(limite)
      : stmtListConvos.all();
  for (const r of rows) {
    // Solo rellena si NocoDB no proporcionó etiqueta — así no pisamos la
    // sincronizada y las etiquetas funcionan también SIN NocoDB.
    if (!r.nocodb_label) r.nocodb_label = deriveLeadLabel(r);
  }
  return rows;
}

const stmtGetMessageMediaUrlsForConvo = db.prepare<
  [number],
  { media_url: string }
>(
  "SELECT media_url FROM messages WHERE conversation_id = ? AND media_url IS NOT NULL"
);

/**
 * Resuelve un rel_path (relativo a data/) a ruta absoluta. Igual que
 * resolveMediaAbsPath en meta/media.ts pero inlineado para evitar import
 * circular hacia ese módulo.
 */
function resolveMediaPathLocal(relPath: string): string | null {
  const normalized = path.normalize(relPath).replace(/^([/\\])+/, "");
  if (normalized.startsWith("..")) return null;
  return path.join(DATA_DIR, normalized);
}

/**
 * Borra de disco los archivos referenciados en una lista de media_urls.
 * SALTA los que están en `cache/...` porque esos son templates compartidos
 * (videos/audios de Drive) que sirven a TODAS las conversaciones.
 */
function deleteFilesForMediaUrls(urls: string[]): void {
  let deleted = 0;
  let skipped = 0;
  for (const relPath of urls) {
    if (!relPath) continue;
    if (relPath.startsWith("cache/") || relPath.startsWith("cache\\")) {
      skipped++;
      continue;
    }
    const absPath = resolveMediaPathLocal(relPath);
    if (!absPath) continue;
    try {
      if (fs.existsSync(absPath)) {
        fs.unlinkSync(absPath);
        deleted++;
      }
    } catch (err) {
      console.error(`[db] no se pudo borrar ${absPath}:`, err);
    }
  }
  if (deleted + skipped > 0) {
    console.log(
      `[db] limpieza media: ${deleted} archivos eliminados, ${skipped} templates preservados`
    );
  }
}

const deleteConversationDbTx = db.transaction((id: number) => {
  stmtDeleteMessages.run(id);
  stmtDeleteConvo.run(id);
});

export function deleteConversation(id: number): void {
  // Leer URLs ANTES de borrar las filas, sino se pierden.
  const urls = stmtGetMessageMediaUrlsForConvo
    .all(id)
    .map((r) => r.media_url);
  deleteConversationDbTx(id);
  deleteFilesForMediaUrls(urls);
}

// ─── Autopurga de conversaciones inactivas ───────────────────────────────
// Selecciona conversaciones SIN actividad desde antes del cutoff, EXCLUYENDO
// a cualquiera que haya comprado. La exclusión es doble (cinturón + tirantes):
//   1) paid_total_cents = 0  → nunca registró un pago.
//   2) state NO está en los estados post-compra.
// Así un comprador JAMÁS entra en la purga, pase lo que pase.
export interface StaleConversation {
  id: number;
  name: string | null;
  phone: string;
  last_message_at: number | null;
  created_at: number;
}

const stmtStaleConversations = db.prepare<[number], StaleConversation>(
  `SELECT id, name, phone, last_message_at, created_at
     FROM conversations
    WHERE COALESCE(last_message_at, created_at) < ?
      AND paid_total_cents = 0
      AND (
        state IS NULL
        OR state NOT IN (
          'payment_approved',
          'awaiting_delivery_preference',
          'awaiting_email',
          'awaiting_gift_consent',
          'awaiting_facebook_comment'
        )
      )
    ORDER BY COALESCE(last_message_at, created_at) ASC`
);

/** Conversaciones candidatas a purga: inactivas desde antes de cutoffUnix y
 *  que NO son compradores. NO borra nada — solo las lista. */
export function getStaleConversations(cutoffUnix: number): StaleConversation[] {
  return stmtStaleConversations.all(cutoffUnix);
}

// ─── Inversión en anuncios (para ROAS) ───────────────────────────────────
const stmtSetAdSpend = db.prepare<[string, number]>(
  `INSERT INTO ad_spend (date, amount_cents) VALUES (?, ?)
     ON CONFLICT(date) DO UPDATE SET amount_cents = excluded.amount_cents`
);
const stmtGetAdSpendRange = db.prepare<[string, string], { total: number | null }>(
  "SELECT SUM(amount_cents) AS total FROM ad_spend WHERE date >= ? AND date <= ?"
);
const stmtGetAdSpendAll = db.prepare<[], { total: number | null }>(
  "SELECT SUM(amount_cents) AS total FROM ad_spend"
);
const stmtGetAdSpendDays = db.prepare<
  [string, string],
  { date: string; amount_cents: number }
>(
  "SELECT date, amount_cents FROM ad_spend WHERE date >= ? AND date <= ? ORDER BY date"
);

/** Guarda (upsert) la inversión de un día (date = 'YYYY-MM-DD', en céntimos). */
export function setAdSpend(date: string, amountCents: number): void {
  stmtSetAdSpend.run(date, amountCents);
}
/** Suma de la inversión entre dos fechas (inclusive). */
export function getAdSpendRange(fromDate: string, toDate: string): number {
  return stmtGetAdSpendRange.get(fromDate, toDate)?.total ?? 0;
}
/** Suma total de toda la inversión registrada. */
export function getAdSpendAll(): number {
  return stmtGetAdSpendAll.get()?.total ?? 0;
}
/** Inversión día a día dentro del rango — para editarla sin ir uno por uno. */
export function getAdSpendDays(
  fromDate: string,
  toDate: string
): Array<{ date: string; amount_cents: number }> {
  return stmtGetAdSpendDays.all(fromDate, toDate);
}

// ── COMENTARIOS DE FACEBOOK PENDIENTES ──────────────────────────────────────
// Cola de comentarios a los que hay que responder en privado. Vive aparte de
// las conversaciones porque cuando llega el comentario todavía no existe
// ninguna: la conversación nace cuando la persona contesta el privado.

export interface PendingCommentRow {
  comment_id: string;
  page_id: string;
  post_id: string | null;
  commenter_id: string | null;
  commenter_name: string | null;
  text: string | null;
  matched: number;
  created_at: number;
  send_at: number;
  sent_at: number | null;
  status: string;
  error: string | null;
}

// La publicacion del comentario se guarda para poder atribuir la venta al
// anuncio del que salio. Va ANTES de preparar las consultas: si no, las que
// nombran post_id fallarian en una base que ya tuviera la tabla sin esa
// columna. Se anade aparte porque CREATE TABLE IF NOT EXISTS no la agrega.
try {
  db.exec("ALTER TABLE pending_comments ADD COLUMN post_id TEXT");
} catch {
  // ya existe, no pasa nada
}

const stmtInsertPendingComment = db.prepare<
  [
    string,
    string,
    string | null,
    string | null,
    string | null,
    string | null,
    number,
    number,
    number
  ]
>(
  `INSERT OR IGNORE INTO pending_comments
     (comment_id, page_id, post_id, commenter_id, commenter_name, text, matched, created_at, send_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
const stmtDuePendingComments = db.prepare<[number], PendingCommentRow>(
  `SELECT * FROM pending_comments
    WHERE status = 'pending' AND send_at <= ? ORDER BY send_at LIMIT 20`
);
const stmtMarkPendingComment = db.prepare<[string, number | null, string | null, string]>(
  "UPDATE pending_comments SET status = ?, sent_at = ?, error = ? WHERE comment_id = ?"
);
const stmtSentPendingComments = db.prepare<[], PendingCommentRow>(
  "SELECT * FROM pending_comments WHERE status = 'sent'"
);
const stmtUltimoEnvioAPersona = db.prepare<[string], { sent_at: number | null }>(
  `SELECT MAX(sent_at) AS sent_at FROM pending_comments
    WHERE commenter_id = ? AND sent_at IS NOT NULL`
);
const stmtIgnoradosPorPersona = db.prepare<[string], { n: number }>(
  `SELECT COUNT(*) AS n FROM pending_comments
    WHERE commenter_id = ? AND status IN ('lost', 'sent')`
);
const stmtCountByCommenter = db.prepare<[string], { n: number }>(
  "SELECT COUNT(*) AS n FROM pending_comments WHERE commenter_id = ?"
);
const stmtOldestSkipped = db.prepare<[string], PendingCommentRow>(
  `SELECT * FROM pending_comments
    WHERE commenter_id = ? AND status = 'skipped'
    ORDER BY created_at LIMIT 1`
);
const stmtWakeUpComment = db.prepare<[number, string]>(
  "UPDATE pending_comments SET status = 'pending', send_at = ?, error = NULL WHERE comment_id = ?"
);

/** Encola un comentario. Si ya estaba, no hace nada (una respuesta por comentario). */
export function addPendingComment(input: {
  commentId: string;
  pageId: string;
  postId?: string | null;
  commenterId: string | null;
  commenterName: string | null;
  text: string | null;
  matched: boolean;
  sendAt: number;
}): void {
  stmtInsertPendingComment.run(
    input.commentId,
    input.pageId,
    input.postId ?? null,
    input.commenterId,
    input.commenterName,
    input.text,
    input.matched ? 1 : 0,
    Math.floor(Date.now() / 1000),
    input.sendAt
  );
}

const stmtSetLeadOrigin = db.prepare<[string, string | null, number]>(
  `UPDATE conversations
      SET lead_origin = COALESCE(lead_origin, ?),
          ad_source_id = COALESCE(ad_source_id, ?)
    WHERE id = ?`
);

/**
 * Marca de dónde nació un lead. Usa COALESCE: si la conversación ya traía
 * origen o anuncio (por ejemplo un clic en un anuncio), no se pisa.
 */
export function setLeadOrigin(
  conversationId: number,
  origin: string,
  sourceId?: string | null
): void {
  stmtSetLeadOrigin.run(origin, sourceId ?? null, conversationId);
}

/** Comentarios cuya hora de envío ya llegó. */
export function getDuePendingComments(nowSec: number): PendingCommentRow[] {
  return stmtDuePendingComments.all(nowSec);
}

/** Comentarios ya respondidos, para vigilar si contestaron. */
export function getSentPendingComments(): PendingCommentRow[] {
  return stmtSentPendingComments.all();
}

/** Cuándo se le escribió por última vez a esa persona (0 = nunca). */
export function lastCommentReplyTo(commenterId: string): number {
  return stmtUltimoEnvioAPersona.get(commenterId)?.sent_at ?? 0;
}

/**
 * Cuántos privados ha ignorado esa persona: los enviados que siguen sin
 * respuesta ('sent') más los ya dados por perdidos ('lost'). Cuando contesta,
 * su registro pasa a 'replied' y deja de contar.
 */
export function ignoredRepliesBy(commenterId: string): number {
  return stmtIgnoradosPorPersona.get(commenterId)?.n ?? 0;
}

/** Cuántos comentarios lleva esa persona (para la regla de insistencia). */
export function countCommentsByCommenter(commenterId: string): number {
  return stmtCountByCommenter.get(commenterId)?.n ?? 0;
}

/**
 * Despierta el comentario más antiguo que quedó en espera de esa persona y le
 * pone hora de envío. Se usa cuando alcanza el número de comentarios exigido.
 */
export function reactivateOldestSkipped(
  commenterId: string,
  sendAt: number
): void {
  const fila = stmtOldestSkipped.get(commenterId);
  if (fila) stmtWakeUpComment.run(sendAt, fila.comment_id);
}

export function markPendingComment(
  commentId: string,
  status: "sent" | "replied" | "lost" | "skipped" | "failed",
  options?: { sentAt?: number | null; error?: string | null }
): void {
  stmtMarkPendingComment.run(
    status,
    options?.sentAt ?? null,
    options?.error ?? null,
    commentId
  );
}

// ── INVERSIÓN POR PAÍS ──────────────────────────────────────────────────────
// La inversión pasa a registrarse por país para poder ver la ganancia real de
// cada uno. Lo ya registrado sin país se arrastra una sola vez como Perú, que
// es lo que era (el campo pedía soles). La tabla vieja no se toca.

const stmtSetAdSpendCountry = db.prepare<[string, string, number]>(
  `INSERT INTO ad_spend_country (date, country, amount_cents) VALUES (?, ?, ?)
     ON CONFLICT(date, country) DO UPDATE SET amount_cents = excluded.amount_cents`
);
const stmtGetAdSpendCountryRange = db.prepare<
  [string, string],
  { country: string; total: number }
>(
  `SELECT country, SUM(amount_cents) AS total FROM ad_spend_country
    WHERE date >= ? AND date <= ? GROUP BY country`
);
const stmtGetAdSpendCountryAll = db.prepare<[], { country: string; total: number }>(
  "SELECT country, SUM(amount_cents) AS total FROM ad_spend_country GROUP BY country"
);
const stmtGetAdSpendCountryDays = db.prepare<
  [string, string, string],
  { date: string; amount_cents: number }
>(
  `SELECT date, amount_cents FROM ad_spend_country
    WHERE date >= ? AND date <= ? AND country = ? ORDER BY date`
);
const stmtCountAdSpendCountry = db.prepare<[], { n: number }>(
  "SELECT COUNT(*) AS n FROM ad_spend_country"
);
const stmtAllAdSpendLegacy = db.prepare<[], { date: string; amount_cents: number }>(
  "SELECT date, amount_cents FROM ad_spend"
);

// Arrastre único: si la tabla por país está vacía, se copia lo que hubiera en
// la anterior como inversión de Perú. Idempotente — en el segundo arranque ya
// no está vacía y no vuelve a entrar.
try {
  if ((stmtCountAdSpendCountry.get()?.n ?? 0) === 0) {
    const previas = stmtAllAdSpendLegacy.all();
    for (const fila of previas) {
      if (fila.amount_cents > 0) {
        stmtSetAdSpendCountry.run(fila.date, "PE", fila.amount_cents);
      }
    }
  }
} catch {
  // Si algo falla aquí, el panel simplemente arranca sin inversión previa.
}

/** Guarda (upsert) la inversión de un día para un país concreto. */
export function setAdSpendCountry(
  date: string,
  country: string,
  amountCents: number
): void {
  stmtSetAdSpendCountry.run(date, country.toUpperCase(), amountCents);
}

/** Inversión del rango agrupada por país: { PE: 42000, EC: 1500 }. */
export function getAdSpendByCountry(
  fromDate?: string | null,
  toDate?: string | null
): Record<string, number> {
  const filas =
    fromDate && toDate
      ? stmtGetAdSpendCountryRange.all(fromDate, toDate)
      : stmtGetAdSpendCountryAll.all();
  const total: Record<string, number> = {};
  for (const fila of filas) total[fila.country] = fila.total;
  return total;
}

/** Inversión día a día de UN país, para editar el rango completo. */
export function getAdSpendCountryDays(
  fromDate: string,
  toDate: string,
  country: string
): Array<{ date: string; amount_cents: number }> {
  return stmtGetAdSpendCountryDays.all(fromDate, toDate, country.toUpperCase());
}

export function wasMessageProcessed(waMessageId: string): boolean {
  return stmtIsProcessed.get(waMessageId) !== undefined;
}

export function markMessageProcessed(waMessageId: string): void {
  stmtMarkProcessed.run(waMessageId);
}

// ─── Workflow / scheduled actions ────────────────────────────────────────────

const stmtSetState = db.prepare<[string, number]>(
  "UPDATE conversations SET state = ? WHERE id = ?"
);
const stmtClaimDeliveryPreference = db.prepare<[number]>(
  `UPDATE conversations
   SET state = 'payment_approved', pending_delivery_source = NULL
   WHERE id = ? AND state = 'awaiting_delivery_preference'`
);
const stmtSetClientName = db.prepare<[string, number]>(
  "UPDATE conversations SET client_name = ? WHERE id = ?"
);
const stmtCountMessages = db.prepare<[number], { c: number }>(
  "SELECT COUNT(*) AS c FROM messages WHERE conversation_id = ?"
);
const stmtInsertScheduled = db.prepare<
  [number, string, string, number]
>(
  "INSERT INTO scheduled_actions (conversation_id, action_type, payload, run_at) VALUES (?, ?, ?, ?)"
);
const stmtGetDueActions = db.prepare<[number, number, number], ScheduledActionRow>(
  `SELECT * FROM scheduled_actions
   WHERE status = 'pending'
     AND run_at <= ?
     AND (claimed_at IS NULL OR claimed_at <= ?)
   ORDER BY run_at ASC
   LIMIT ?`
);
const stmtClaimScheduledAction = db.prepare<[number, number, number]>(
  `UPDATE scheduled_actions
   SET claimed_at = ?
   WHERE id = ?
     AND status = 'pending'
     AND (claimed_at IS NULL OR claimed_at <= ?)`
);
const stmtMarkActionStatus = db.prepare<[string, number]>(
  "UPDATE scheduled_actions SET status = ? WHERE id = ?"
);
const stmtCancelPendingForConvo = db.prepare<[number]>(
  "UPDATE scheduled_actions SET status = 'cancelled' WHERE conversation_id = ? AND status = 'pending'"
);
const stmtCancelPendingByTypeForConvo = db.prepare<[number, string]>(
  "UPDATE scheduled_actions SET status = 'cancelled' WHERE conversation_id = ? AND action_type = ? AND status = 'pending'"
);
const stmtGetUnpaidConversationIds = db.prepare<[], { id: number }>(
  "SELECT id FROM conversations WHERE paid_total_cents = 0"
);
const stmtResetUnpaidConversationForProductSwitch = db.prepare<[number]>(
  `UPDATE conversations
      SET mode = 'AI',
          state = 'new',
          client_name = NULL,
          client_email = NULL,
          counted_receipts = NULL,
          payment_attempts_failed = 0,
          discount_active = 0,
          locked_price_cents = NULL,
          locked_price_currency = NULL,
          locked_price_source = NULL,
          locked_price_discount_active = NULL,
          locked_price_updated_at = NULL,
          frozen_prices = NULL,
          bioferta_choice = NULL,
          order_bump_choice = NULL,
          ob_price_confirm_pending = 0,
          ob_choice_stale = 0,
          selected_payment_method = NULL,
          intro_variant_sent = NULL,
          camino = NULL,
          intro_paused_index = NULL,
          sent_media = NULL,
          gift_reminder_sent = 0,
          gift_rewarded = 0,
          email_reminder_sent = 0,
          customer_survey_sent = 0,
          pending_delivery_source = NULL,
          last_followup_index = -1,
          last_followup_started_at = 0,
          commercial_sales_route = NULL,
          messenger_country_prompted = 0
    WHERE id = ? AND paid_total_cents = 0`
);
const stmtCountPendingActionTypeForConvo = db.prepare<
  [number, string],
  { c: number }
>(
  "SELECT COUNT(*) AS c FROM scheduled_actions WHERE conversation_id = ? AND action_type = ? AND status = 'pending'"
);
const stmtCountFuturePendingActionTypeForConvo = db.prepare<
  [number, string, number],
  { c: number }
>(
  "SELECT COUNT(*) AS c FROM scheduled_actions WHERE conversation_id = ? AND action_type = ? AND status = 'pending' AND run_at > ?"
);
// Para backfill: convos que ya dispararon algun seguimiento (index >= 0) y
// aun no completaron toda la cadena (index < total - 1). El estado lo filtra
// el caller — aqui solo damos el universo de candidatos.
const stmtConvosForFollowupBackfill = db.prepare<[number], ConversationRow>(
  "SELECT * FROM conversations WHERE last_followup_index >= 0 AND last_followup_index < ?"
);
export function getConversationsForFollowupBackfill(
  maxIndexExclusive: number
): ConversationRow[] {
  return stmtConvosForFollowupBackfill.all(maxIndexExclusive);
}

export function setConversationState(
  conversationId: number,
  state: WorkflowState
): void {
  stmtSetState.run(state, conversationId);
}

/**
 * Toma de forma atómica la elección WhatsApp/correo. Evita que el mismo texto
 * recibido dos veces programe dos entregas antes de que el worker ejecute la
 * primera.
 */
export function claimDeliveryPreference(conversationId: number): boolean {
  return stmtClaimDeliveryPreference.run(conversationId).changes > 0;
}

export function setClientName(conversationId: number, name: string): void {
  stmtSetClientName.run(name, conversationId);
}

// La marca de CUÁNDO se anotó viaja pegada a la elección, en el mismo UPDATE.
// Separarlas dejaría la puerta abierta a guardar una sin la otra, y entonces el
// repaso volvería a mirar mensajes ya atendidos sin que nadie lo notara.
const stmtSetBiofertaChoice = db.prepare<[string | null, number, number]>(
  "UPDATE conversations SET bioferta_choice = ?, bioferta_choice_at = ? WHERE id = ?"
);
/** Guarda (o limpia con null) el producto elegido en la Bioferta Oferta Doble. */
export function setBiofertaChoice(
  conversationId: number,
  choice: "a" | "b" | "pack" | null
): void {
  stmtSetBiofertaChoice.run(
    choice,
    Math.floor(Date.now() / 1000),
    conversationId
  );
}

const stmtSetOrderBumpChoice = db.prepare<[string | null, number, number]>(
  "UPDATE conversations SET order_bump_choice = ?, order_bump_choice_at = ? WHERE id = ?"
);
/** Guarda (o limpia con null) la opción elegida en el Order Bump. */
export function setOrderBumpChoice(
  conversationId: number,
  choice: "combo" | "basico" | null
): void {
  stmtSetOrderBumpChoice.run(
    choice,
    Math.floor(Date.now() / 1000),
    conversationId
  );
}

const stmtSetObPriceConfirmPending = db.prepare<[number, number]>(
  "UPDATE conversations SET ob_price_confirm_pending = ? WHERE id = ?"
);
/** Marca (1) o limpia (0) la espera de confirmación de compra tras dar el precio. */
export function setOrderBumpPriceConfirmPending(
  conversationId: number,
  pending: boolean
): void {
  stmtSetObPriceConfirmPending.run(pending ? 1 : 0, conversationId);
}

const stmtSetUpsellState = db.prepare<[string | null, number]>(
  "UPDATE conversations SET upsell_state = ? WHERE id = ?"
);
/** Mueve el upsell de estado. Ver la columna en ConversationRow. */
export function setUpsellState(
  conversationId: number,
  state: "esperando" | "ofrecido" | "aceptado" | "pagado" | "rechazado" | null
): void {
  stmtSetUpsellState.run(state, conversationId);
}

const stmtMarcarRecordatorioUpsell = db.prepare<[number]>(
  "UPDATE conversations SET upsell_recordatorio_enviado = 1 WHERE id = ? AND upsell_recordatorio_enviado = 0"
);
/**
 * Marca que el recordatorio del extra ya salió, y dice si le tocaba a ESTA
 * llamada mandarlo.
 *
 * El `AND ... = 0` de la consulta no es adorno: es el candado. Las dos puertas
 * que pueden mandarlo —la entrega de un upgrade y la respuesta al regalo—
 * pueden coincidir en la misma conversación, y comprobar primero y escribir
 * después dejaría el hueco por el que se cuelan dos recordatorios. Así el que
 * llega segundo recibe `false` y se calla.
 *
 * Devuelve true SOLO la primera vez. Nunca se vuelve a poner a 0.
 */
export function marcarRecordatorioUpsellEnviado(conversationId: number): boolean {
  return stmtMarcarRecordatorioUpsell.run(conversationId).changes > 0;
}

const stmtSetUltimaDecision = db.prepare<[string | null, number]>(
  "UPDATE conversations SET ultima_decision = ? WHERE id = ?"
);
/** Anota qué decisión se acaba de contestar, para no repetirla. Ver la columna. */
export function setUltimaDecision(
  conversationId: number,
  clave: string | null
): void {
  stmtSetUltimaDecision.run(clave, conversationId);
}

const stmtSetUpsellHabladoAt = db.prepare<[number, number]>(
  "UPDATE conversations SET upsell_hablado_at = ? WHERE id = ?"
);
/** Sella que el bot ACABA de hablar de la oferta del extra. Ver la columna. */
export function setUpsellHabladoAt(conversationId: number): void {
  stmtSetUpsellHabladoAt.run(Math.floor(Date.now() / 1000), conversationId);
}

const stmtContarDelBotDespuesDe = db.prepare<[number, number], { c: number }>(
  `SELECT COUNT(*) AS c FROM messages
    WHERE conversation_id = ? AND role != 'user' AND created_at > ?`
);
/**
 * ¿Cuántas veces habló el bot —o una persona desde el panel— DESPUÉS de ese
 * momento? Cero significa que lo último en pantalla sigue siendo lo que se
 * selló; cualquier otra cosa quiere decir que alguien más tomó la palabra.
 *
 * Cuenta 'assistant' y 'human' por igual: al cliente le da lo mismo quién
 * escribió, lo que ve es que le hablaron de otra cosa.
 */
export function contarMensajesDelBotDespuesDe(
  conversationId: number,
  desde: number
): number {
  try {
    return stmtContarDelBotDespuesDe.get(conversationId, desde)?.c ?? 0;
  } catch {
    // Ante la duda, que no cambie nada: 0 = todo sigue como siempre.
    return 0;
  }
}

const stmtSetUpsellBase = db.prepare<[number, number]>(
  "UPDATE conversations SET upsell_base_cents = ? WHERE id = ?"
);
/** Guarda la foto de lo pagado al arrancar el upsell. */
export function setUpsellBaseCents(
  conversationId: number,
  cents: number
): void {
  stmtSetUpsellBase.run(Math.max(0, Math.floor(cents)), conversationId);
}

/**
 * EL PRECIO DEL SEGUNDO PRODUCTO, CONGELADO AL OFRECERLO.
 *
 * Mismo trato que `FrozenPriceMap` le da al primero, y por el mismo motivo: lo
 * que se le dijo al cliente es lo que se le cobra. Se guardan los DOS importes
 * —normal y de oferta— porque cuál de los dos toca depende del estado de
 * descuento de la conversación, que se resuelve al validar y no al ofrecer.
 *
 * `modalidad` es la guarda hermética de siempre: si el editor cambia lo que
 * vende el bot, este precio deja de aplicarse en vez de arrastrarse a una
 * modalidad que no lo cotizó.
 */
export interface UpsellFrozenPrices {
  modalidad: string;
  regular: number | null;
  discount: number | null;
  at: number;
}

const stmtSetUpsellFrozenPrices = db.prepare<[string, number]>(
  "UPDATE conversations SET upsell_frozen_prices = ? WHERE id = ?"
);
/** Guarda el precio cotizado. El llamador decide si conserva el primero. */
export function setUpsellFrozenPrices(
  conversationId: number,
  map: UpsellFrozenPrices
): void {
  stmtSetUpsellFrozenPrices.run(JSON.stringify(map), conversationId);
}
export function getUpsellFrozenPrices(
  convo: { upsell_frozen_prices?: string | null } | null | undefined
): UpsellFrozenPrices | null {
  if (!convo?.upsell_frozen_prices) return null;
  try {
    const parsed = JSON.parse(convo.upsell_frozen_prices) as UpsellFrozenPrices;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    // Un JSON roto no puede tumbar una venta: se sigue con el precio del
    // momento, que es exactamente lo que se hacía antes de que esto existiera.
    return null;
  }
}

const stmtAddToUpsellPaid = db.prepare<[number, number]>(
  "UPDATE conversations SET upsell_paid_cents = upsell_paid_cents + ? WHERE id = ?"
);
/** Suma a la cuenta del segundo producto. Solo lo que es SUYO: quien llama ya
 *  descontó lo que este comprobante tapaba de la primera venta. */
export function addToUpsellPaid(conversationId: number, cents: number): void {
  if (!Number.isFinite(cents) || cents <= 0) return;
  stmtAddToUpsellPaid.run(Math.floor(cents), conversationId);
}

const stmtResetUpsellPaid = db.prepare<[number]>(
  "UPDATE conversations SET upsell_paid_cents = 0 WHERE id = ?"
);
/** Cierra el ticket: la cuenta vuelve a cero para el siguiente extra. */
export function resetUpsellPaid(conversationId: number): void {
  stmtResetUpsellPaid.run(conversationId);
}

const stmtSetUpsellPaidAt = db.prepare<[number, number]>(
  "UPDATE conversations SET upsell_paid_at = ? WHERE id = ?"
);
/** Sella la fecha de la SEGUNDA venta, sin tocar la de la primera. */
export function setUpsellPaidAt(conversationId: number, ts: number): void {
  stmtSetUpsellPaidAt.run(ts, conversationId);
}

// ── UPSELLS EN FILA ─────────────────────────────────────────────────────────
//
// Ver PLAN-UPSELLS-EN-FILA.md y las columnas en ConversationRow.

export interface PuestoEnLaFila {
  upsell_fila_id: string | null;
  upsell_producto_id: string | null;
  upsell_downsell: number;
  upsell_fila_parada: number;
  upsell_comprados: string | null;
  phone: string;
}
const stmtPuestoEnLaFila = db.prepare<[number], PuestoEnLaFila>(
  `SELECT upsell_fila_id, upsell_producto_id, upsell_downsell, upsell_fila_parada,
          upsell_comprados, phone
     FROM conversations WHERE id = ?`
);
/** Dónde va esta conversación en la fila. Solo esas columnas: se pregunta a menudo. */
export function getPuestoEnLaFila(conversationId: number): PuestoEnLaFila | null {
  try {
    return stmtPuestoEnLaFila.get(conversationId) ?? null;
  } catch {
    // Ante la duda, el upsell de siempre.
    return null;
  }
}

/**
 * PASA A LA SIGUIENTE OFERTA DE LA FILA, CON LA MÁQUINA DEL UPSELL A CERO.
 *
 * Todo en UNA consulta, porque es una sola cosa: la oferta nueva empieza limpia. Sin
 * estado, sin recordatorio gastado, sin el precio congelado del anterior —que se le
 * cobraría al siguiente— y con su propia cuenta en cero. La foto de lo pagado la vuelve
 * a sacar `presentarUpsell`, como siempre.
 */
const stmtMoverLaFila = db.prepare<[string | null, string | null, number, number]>(
  `UPDATE conversations
      SET upsell_fila_id = ?, upsell_producto_id = ?, upsell_downsell = ?,
          upsell_state = NULL, upsell_recordatorio_enviado = 0,
          upsell_frozen_prices = NULL, upsell_paid_cents = 0
    WHERE id = ?`
);
export function moverLaFila(
  conversationId: number,
  filaId: string | null,
  productoId: string | null,
  downsell: boolean
): void {
  stmtMoverLaFila.run(filaId, productoId, downsell ? 1 : 0, conversationId);
}

const stmtPararLaFila = db.prepare<[number]>(
  "UPDATE conversations SET upsell_fila_parada = 1 WHERE id = ?"
);
/** «Si no quiere el primero o el segundo, no se insiste más.» Ya no se ofrece nada. */
export function pararLaFila(conversationId: number): void {
  stmtPararLaFila.run(conversationId);
}

export interface CompraDeLaFila {
  /** null = el upsell de siempre. */
  producto_id: string | null;
  downsell: boolean;
  cents: number;
  at: number;
}
export function leerCompradosDeLaFila(
  convo: { upsell_comprados?: string | null } | null | undefined
): CompraDeLaFila[] {
  if (!convo?.upsell_comprados) return [];
  try {
    const lista = JSON.parse(convo.upsell_comprados);
    return Array.isArray(lista) ? (lista as CompraDeLaFila[]) : [];
  } catch {
    return [];
  }
}
const stmtSetComprados = db.prepare<[string, number]>(
  "UPDATE conversations SET upsell_comprados = ? WHERE id = ?"
);
/** Anota lo que acaba de pagar de la fila. */
export function anotarCompraDeLaFila(
  conversationId: number,
  compra: CompraDeLaFila
): void {
  const lista = leerCompradosDeLaFila(getPuestoEnLaFila(conversationId));
  lista.push(compra);
  stmtSetComprados.run(JSON.stringify(lista), conversationId);
}

const stmtSumarStrikePiropo = db.prepare<[number], { n: number }>(
  "UPDATE conversations SET strikes_piropo = strikes_piropo + 1 WHERE id = ? RETURNING strikes_piropo AS n"
);
const stmtSumarStrikeBasura = db.prepare<[number], { n: number }>(
  "UPDATE conversations SET strikes_basura = strikes_basura + 1 WHERE id = ? RETURNING strikes_basura AS n"
);
/** Suma un aviso de moderación y devuelve el total acumulado. */
export function sumarStrike(
  conversationId: number,
  tipo: "piropo" | "basura"
): number {
  const fila =
    tipo === "piropo"
      ? stmtSumarStrikePiropo.get(conversationId)
      : stmtSumarStrikeBasura.get(conversationId);
  return fila?.n ?? 0;
}

const stmtMarkOrderBumpRevealed = db.prepare<[number]>(
  "UPDATE conversations SET order_bump_revealed = 1 WHERE id = ?"
);
/** Deja constancia de que a esta conversación ya se le mostró la oferta con las
 *  2 opciones. No se limpia nunca: lo que el cliente ya vio, lo vio. */
export function markOrderBumpRevealed(conversationId: number): void {
  stmtMarkOrderBumpRevealed.run(conversationId);
}

const stmtSetObChoiceStale = db.prepare<[number, number]>(
  "UPDATE conversations SET ob_choice_stale = ? WHERE id = ?"
);
/** Marca (1) o limpia (0) la "elección vencida" tras un seguimiento. */
export function setOrderBumpChoiceStale(
  conversationId: number,
  stale: boolean
): void {
  stmtSetObChoiceStale.run(stale ? 1 : 0, conversationId);
}

const stmtGetSentMedia = db.prepare<[number], { sent_media: string | null }>(
  "SELECT sent_media FROM conversations WHERE id = ?"
);
const stmtSetSentMedia = db.prepare<[string, number]>(
  "UPDATE conversations SET sent_media = ? WHERE id = ?"
);
/** Temas de la galería ya enviados a esta conversación. */
export function getSentMedia(conversationId: number): string[] {
  const row = stmtGetSentMedia.get(conversationId);
  return (row?.sent_media ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}
/** Marca un tema de la galería como ya enviado (no se reenvía). */
export function markMediaSent(conversationId: number, topic: string): void {
  const cur = getSentMedia(conversationId);
  const t = topic.trim().toLowerCase();
  if (!t || cur.includes(t)) return;
  cur.push(t);
  stmtSetSentMedia.run(cur.join(","), conversationId);
}

/** Limpia las muestras enviadas; se usa al reiniciar una conversación de prueba. */
export function clearSentMedia(conversationId: number): void {
  stmtSetSentMedia.run("", conversationId);
}

const stmtSetSelectedPaymentMethod = db.prepare<[string | null, number]>(
  "UPDATE conversations SET selected_payment_method = ? WHERE id = ?"
);
const stmtSetConvoWaPhoneNumberId = db.prepare<[string, number]>(
  "UPDATE conversations SET wa_phone_number_id = ? WHERE id = ?"
);
const stmtSetConvoMessengerPage = db.prepare<[string, number]>(
  "UPDATE conversations SET messenger_page_id = ? WHERE id = ?"
);

/**
 * Deja anotado por cual de NUESTROS numeros entro la conversacion, para poder
 * responderle por el mismo. Se llama en cada mensaje entrante de WhatsApp.
 *
 * Si el cliente escribe a un segundo numero nuestro, la conversacion pasa a
 * responderse por ese: es lo correcto cuando los dos numeros venden lo mismo,
 * porque Meta exige contestar por el numero al que te escribieron.
 */
export function setConversationWaPhoneNumberId(
  conversationId: number,
  phoneNumberId: string | null
): void {
  if (!phoneNumberId) return;
  stmtSetConvoWaPhoneNumberId.run(phoneNumberId, conversationId);
}

/**
 * Deja anotado por cual de NUESTRAS paginas entro la conversacion. El gemelo de la
 * de arriba, para Messenger, y por el mismo motivo: el seguimiento sale horas
 * despues desde el obrero y ahi ya no esta el webhook para saber de que pagina era.
 */
export function setConversationMessengerPage(
  conversationId: number,
  pageId: string | null
): void {
  if (!pageId) return;
  stmtSetConvoMessengerPage.run(pageId, conversationId);
}

export function setSelectedPaymentMethod(
  conversationId: number,
  // Método de pago: dinámico (cualquier id de payment_buttons) o clásico.
  method: string | null
): void {
  stmtSetSelectedPaymentMethod.run(method, conversationId);
}

const stmtSetIntroVariantSent = db.prepare<[number | null, number]>(
  "UPDATE conversations SET intro_variant_sent = ? WHERE id = ?"
);
const stmtSetIntroPausedIndex = db.prepare<[number | null, number]>(
  "UPDATE conversations SET intro_paused_index = ? WHERE id = ?"
);
/** Marca (o desmarca) que la intro quedó esperando una elección. */
export function setIntroPausedIndex(
  conversationId: number,
  index: number | null
): void {
  stmtSetIntroPausedIndex.run(index, conversationId);
}

export function setIntroVariantSent(
  conversationId: number,
  variant: number | null
): void {
  stmtSetIntroVariantSent.run(variant, conversationId);
}

const stmtSetCamino = db.prepare<[string | null, number]>(
  "UPDATE conversations SET camino = ? WHERE id = ?"
);
/** Anota el camino de la intro que recibió (vacío = el principal). Ver `etiqueta-de-camino.ts`. */
export function setCaminoDeLaConversacion(conversationId: number, camino: string | null): void {
  stmtSetCamino.run(camino && camino.trim() ? camino.trim() : null, conversationId);
}

const stmtSetCommercialSalesRoute = db.prepare<[string | null, number]>(
  "UPDATE conversations SET commercial_sales_route = ? WHERE id = ?"
);
export function setCommercialSalesRoute(
  conversationId: number,
  route: "A" | "B" | null
): void {
  stmtSetCommercialSalesRoute.run(route, conversationId);
}

const stmtSetGiftReminderSent = db.prepare<[number, number]>(
  "UPDATE conversations SET gift_reminder_sent = ? WHERE id = ?"
);
export function setGiftReminderSent(
  conversationId: number,
  sent: boolean
): void {
  stmtSetGiftReminderSent.run(sent ? 1 : 0, conversationId);
}

const stmtSetGiftRewarded = db.prepare<[number, number]>(
  "UPDATE conversations SET gift_rewarded = ? WHERE id = ?"
);
export function setGiftRewarded(
  conversationId: number,
  rewarded: boolean
): void {
  stmtSetGiftRewarded.run(rewarded ? 1 : 0, conversationId);
}

const stmtSetEmailReminderSent = db.prepare<[number, number]>(
  "UPDATE conversations SET email_reminder_sent = ? WHERE id = ?"
);
export function setEmailReminderSent(
  conversationId: number,
  sent: boolean
): void {
  stmtSetEmailReminderSent.run(sent ? 1 : 0, conversationId);
}

const stmtSetCustomerSurveySent = db.prepare<[number, number]>(
  "UPDATE conversations SET customer_survey_sent = ? WHERE id = ?"
);
export function setCustomerSurveySent(
  conversationId: number,
  sent: boolean
): void {
  stmtSetCustomerSurveySent.run(sent ? 1 : 0, conversationId);
}

const stmtSetPendingDeliverySource = db.prepare<[string | null, number]>(
  "UPDATE conversations SET pending_delivery_source = ? WHERE id = ?"
);
export function setPendingDeliverySource(
  conversationId: number,
  source:
    | "approved"
    | "bioferta_a"
    | "bioferta_b"
    | "bioferta_pack"
    | "ob_combo"
    | "ob_basico"
    | "upsell"
    | null
): void {
  stmtSetPendingDeliverySource.run(source, conversationId);
}

const stmtClearClientName = db.prepare<[number]>(
  "UPDATE conversations SET client_name = NULL WHERE id = ?"
);
export function clearClientName(conversationId: number): void {
  stmtClearClientName.run(conversationId);
}

const stmtSetClientEmail = db.prepare<[string, number]>(
  "UPDATE conversations SET client_email = ? WHERE id = ?"
);
export function setClientEmail(conversationId: number, email: string): void {
  stmtSetClientEmail.run(email, conversationId);
}

const stmtClearClientEmail = db.prepare<[number]>(
  "UPDATE conversations SET client_email = NULL WHERE id = ?"
);
export function clearClientEmail(conversationId: number): void {
  stmtClearClientEmail.run(conversationId);
}

const stmtSetAdReferral = db.prepare<
  [string, string | null, string | null, string | null, number]
>(
  `UPDATE conversations
     SET ctwa_clid = ?, ad_source_id = ?, ad_source_url = ?, ad_headline = ?
   WHERE id = ? AND ctwa_clid IS NULL`
);

/**
 * Guarda la atribución del anuncio que generó este chat. Solo escribe si
 * todavía no hay ctwa_clid — así un cliente recurrente no pierde la
 * atribución original si vuelve a darle click a otro anuncio.
 */
export function setConversationAdReferral(
  conversationId: number,
  ctwaClid: string,
  sourceId: string | null,
  sourceUrl: string | null,
  headline: string | null
): void {
  stmtSetAdReferral.run(
    ctwaClid,
    sourceId,
    sourceUrl,
    headline,
    conversationId
  );
}

const stmtSetConversationSourceReferral = db.prepare<
  [string | null, string | null, string | null, number]
>(
  `UPDATE conversations
     SET ad_source_id = COALESCE(ad_source_id, ?),
         ad_source_url = COALESCE(ad_source_url, ?),
         ad_headline = COALESCE(ad_headline, ?)
   WHERE id = ?`
);

export function setConversationSourceReferral(
  conversationId: number,
  sourceId: string | null,
  sourceUrl: string | null,
  headline: string | null
): void {
  if (!sourceId && !sourceUrl && !headline) return;
  stmtSetConversationSourceReferral.run(
    sourceId,
    sourceUrl,
    headline,
    conversationId
  );
}

const stmtDeleteAllMessages = db.prepare<[number]>(
  "DELETE FROM messages WHERE conversation_id = ?"
);
export function deleteAllMessages(conversationId: number): void {
  // Leer URLs antes de borrar para luego limpiar de disco.
  const urls = stmtGetMessageMediaUrlsForConvo
    .all(conversationId)
    .map((r) => r.media_url);
  stmtDeleteAllMessages.run(conversationId);
  deleteFilesForMediaUrls(urls);
}

const stmtAddToPaidTotal = db.prepare<[number, number]>(
  "UPDATE conversations SET paid_total_cents = paid_total_cents + ? WHERE id = ?"
);
const stmtResetPaidTotal = db.prepare<[number]>(
  "UPDATE conversations SET paid_total_cents = 0, counted_receipts = NULL, locked_price_cents = NULL, locked_price_currency = NULL, locked_price_source = NULL, locked_price_discount_active = NULL, locked_price_updated_at = NULL, frozen_prices = NULL WHERE id = ?"
);
const stmtSetCountedReceipts = db.prepare<[string | null, number]>(
  "UPDATE conversations SET counted_receipts = ? WHERE id = ?"
);
const stmtGetPaidTotal = db.prepare<[number], { paid_total_cents: number }>(
  "SELECT paid_total_cents FROM conversations WHERE id = ?"
);
const stmtSetLockedPrice = db.prepare<
  [number, string, string, number, number, number]
>(
  "UPDATE conversations SET locked_price_cents = ?, locked_price_currency = ?, locked_price_source = ?, locked_price_discount_active = ?, locked_price_updated_at = ? WHERE id = ?"
);
const stmtClearLockedPrice = db.prepare<[number]>(
  "UPDATE conversations SET locked_price_cents = NULL, locked_price_currency = NULL, locked_price_source = NULL, locked_price_discount_active = NULL, locked_price_updated_at = NULL WHERE id = ?"
);

export function addToPaidTotal(conversationId: number, cents: number): number {
  stmtAddToPaidTotal.run(cents, conversationId);
  return stmtGetPaidTotal.get(conversationId)?.paid_total_cents ?? 0;
}

export function getPaidTotal(conversationId: number): number {
  return stmtGetPaidTotal.get(conversationId)?.paid_total_cents ?? 0;
}

export function resetPaidTotal(conversationId: number): void {
  stmtResetPaidTotal.run(conversationId);
}

export function setLockedPrice(
  conversationId: number,
  priceSoles: number,
  currency: string,
  source: string,
  discountActive: boolean
): void {
  if (!Number.isFinite(priceSoles) || priceSoles <= 0) return;
  stmtSetLockedPrice.run(
    Math.round(priceSoles * 100),
    currency,
    source,
    discountActive ? 1 : 0,
    Math.floor(Date.now() / 1000),
    conversationId
  );
}

export function clearLockedPrice(conversationId: number): void {
  stmtClearLockedPrice.run(conversationId);
}

export function getLockedPriceSoles(
  convo:
    | {
        locked_price_cents?: number | null;
      }
    | null
    | undefined
): number | null {
  const cents = convo?.locked_price_cents;
  return typeof cents === "number" && cents > 0 ? cents / 100 : null;
}

export interface FrozenPriceMap {
  /** "upsell" vende su primer producto igual que Lineal, y congela igual. */
  modality: "lineal" | "order_bump" | "upsell";
  country: string;
  base: { regular: number | null; discount: number | null };
  combo: { regular: number | null; discount: number | null };
  basico: { regular: number | null; discount: number | null };
  at: number;
}

const stmtSetFrozenPrices = db.prepare<[string, number]>(
  "UPDATE conversations SET frozen_prices = ? WHERE id = ?"
);

/** Idempotente: conserva siempre la primera oferta registrada al cliente. */
export function setFrozenPrices(conversationId: number, map: FrozenPriceMap): void {
  stmtSetFrozenPrices.run(JSON.stringify(map), conversationId);
}

export function getFrozenPrices(
  convo: { frozen_prices?: string | null } | null | undefined
): FrozenPriceMap | null {
  if (!convo?.frozen_prices) return null;
  try {
    const parsed = JSON.parse(convo.frozen_prices) as FrozenPriceMap;
    if (
      parsed &&
      (parsed.modality === "lineal" || parsed.modality === "order_bump") &&
      parsed.base &&
      parsed.combo &&
      parsed.basico
    ) return parsed;
  } catch {
    // Un dato antiguo o incompleto cae al comportamiento previo sin romper el flujo.
  }
  return null;
}

/** Guarda (o limpia con null) la lista de huellas de comprobantes ya contados. */
export function setCountedReceipts(
  conversationId: number,
  value: string | null
): void {
  stmtSetCountedReceipts.run(value, conversationId);
}

// Sello de fecha del pago aprobado (solo lectura para el panel de ventas).
// Aditivo: no interviene en ninguna lógica del bot.
const stmtSetPaidAt = db.prepare<[number, number]>(
  "UPDATE conversations SET paid_at = ? WHERE id = ?"
);

/** Graba el unixepoch en que se aprobó el pago. Idempotente en la práctica
 *  porque solo se llama una vez, al cruzar el monto del curso. */
export function setPaidAt(conversationId: number, unixSec: number): void {
  stmtSetPaidAt.run(unixSec, conversationId);
}

const stmtIncrPaymentAttemptsFailed = db.prepare<[number]>(
  "UPDATE conversations SET payment_attempts_failed = payment_attempts_failed + 1 WHERE id = ?"
);
const stmtGetPaymentAttemptsFailed = db.prepare<
  [number],
  { payment_attempts_failed: number }
>("SELECT payment_attempts_failed FROM conversations WHERE id = ?");
const stmtResetPaymentAttemptsFailed = db.prepare<[number]>(
  "UPDATE conversations SET payment_attempts_failed = 0 WHERE id = ?"
);

export function incrementPaymentAttemptsFailed(
  conversationId: number
): number {
  stmtIncrPaymentAttemptsFailed.run(conversationId);
  return (
    stmtGetPaymentAttemptsFailed.get(conversationId)?.payment_attempts_failed ??
    0
  );
}

export function resetPaymentAttemptsFailed(conversationId: number): void {
  stmtResetPaymentAttemptsFailed.run(conversationId);
}

const stmtActivateDiscount = db.prepare<[number]>(
  "UPDATE conversations SET discount_active = 1 WHERE id = ?"
);
const stmtDeactivateDiscount = db.prepare<[number]>(
  "UPDATE conversations SET discount_active = 0 WHERE id = ?"
);

export function activateDiscount(conversationId: number): void {
  stmtActivateDiscount.run(conversationId);
}

/** Solo se usa en /restart para limpiar la oferta. */
export function deactivateDiscount(conversationId: number): void {
  stmtDeactivateDiscount.run(conversationId);
}

// ─── NocoDB sync helpers ─────────────────────────────────────────────────

const stmtSetNocodbRowId = db.prepare<[string | null, number]>(
  "UPDATE conversations SET nocodb_row_id = ? WHERE id = ?"
);
const stmtSetNocodbLabel = db.prepare<[string, number]>(
  "UPDATE conversations SET nocodb_label = ? WHERE id = ?"
);
const stmtSetNocodbResumen = db.prepare<[string, number]>(
  "UPDATE conversations SET nocodb_resumen = ? WHERE id = ?"
);
const stmtMarkHadEmergency = db.prepare<[number]>(
  "UPDATE conversations SET had_emergency = 1 WHERE id = ?"
);
const stmtGetConvoByNocodbRowId = db.prepare<[string], ConversationRow>(
  "SELECT * FROM conversations WHERE nocodb_row_id = ?"
);
const stmtCountUserMessages = db.prepare<[number], { c: number }>(
  "SELECT COUNT(*) AS c FROM messages WHERE conversation_id = ? AND role = 'user'"
);

export function setNocodbRowId(
  conversationId: number,
  rowId: string | null
): void {
  stmtSetNocodbRowId.run(rowId, conversationId);
}

export function setNocodbLabel(conversationId: number, label: string): void {
  stmtSetNocodbLabel.run(label, conversationId);
}

export function setNocodbResumen(conversationId: number, resumen: string): void {
  stmtSetNocodbResumen.run(resumen, conversationId);
}

export function markHadEmergency(conversationId: number): void {
  stmtMarkHadEmergency.run(conversationId);
}

export function getConversationByNocodbRowId(
  rowId: string
): ConversationRow | undefined {
  return stmtGetConvoByNocodbRowId.get(rowId);
}

export function countUserMessages(conversationId: number): number {
  return stmtCountUserMessages.get(conversationId)?.c ?? 0;
}

const stmtGetLatestUserMessage = db.prepare<[number], MessageRow>(
  "SELECT * FROM messages WHERE conversation_id = ? AND role = 'user' ORDER BY created_at DESC, id DESC LIMIT 1"
);

/**
 * Devuelve el último mensaje del cliente (rol 'user') en la convo, o
 * undefined si no hay ninguno. Lo usa el guardarail anti-alucinación
 * de pago: solo permitimos register_payment_amount si el último mensaje
 * trae media_type === 'image'.
 */
export function getLatestUserMessage(
  conversationId: number
): MessageRow | undefined {
  return stmtGetLatestUserMessage.get(conversationId);
}

const stmtGetRecentUserMessages = db.prepare<[number, number], MessageRow>(
  "SELECT * FROM messages WHERE conversation_id = ? AND role = 'user' ORDER BY created_at DESC, id DESC LIMIT ?"
);

/**
 * Devuelve los últimos N mensajes del cliente (rol 'user'), del más
 * reciente al más viejo. Lo usa el guardarail tolerante de pago:
 * si la imagen está en cualquiera de los últimos N mensajes (no solo
 * el más reciente), se considera válida — esto cubre el caso de cliente
 * que manda imagen + texto, o que manda "?" tras esperar respuesta.
 */
export function getRecentUserMessages(
  conversationId: number,
  limit: number
): MessageRow[] {
  return stmtGetRecentUserMessages.all(conversationId, limit);
}

const stmtClearNocodbSync = db.prepare<[number]>(
  `UPDATE conversations
     SET nocodb_row_id = NULL,
         nocodb_label = NULL,
         nocodb_resumen = NULL,
         had_emergency = 0
   WHERE id = ?`
);

/**
 * Limpia toda la metadata de sync con NocoDB para esta convo. Lo llama
 * /restart después de eliminar la fila remota — así el próximo mensaje
 * crea una fila fresca en NocoDB en vez de actualizar la vieja.
 */
export function clearNocodbSync(conversationId: number): void {
  stmtClearNocodbSync.run(conversationId);
}

export function countMessages(conversationId: number): number {
  const r = stmtCountMessages.get(conversationId);
  return r?.c ?? 0;
}

export function scheduleAction(
  conversationId: number,
  actionType: string,
  payload: Record<string, unknown>,
  runAtUnix: number
): number {
  const info = stmtInsertScheduled.run(
    conversationId,
    actionType,
    JSON.stringify(payload),
    runAtUnix
  );
  return Number(info.lastInsertRowid);
}

export function getDueActions(
  nowUnix: number,
  limit = 50
): ScheduledActionRow[] {
  // Si un proceso cae después de tomar una acción, otro worker la recupera.
  const staleClaimBefore = nowUnix - 5 * 60;
  return stmtGetDueActions.all(nowUnix, staleClaimBefore, limit);
}

/** Reclama una acción de forma atómica. Solo un worker puede obtener `true`. */
export function claimScheduledAction(id: number, nowUnix: number): boolean {
  const staleClaimBefore = nowUnix - 5 * 60;
  return stmtClaimScheduledAction.run(nowUnix, id, staleClaimBefore).changes > 0;
}

export function markActionCompleted(id: number): void {
  stmtMarkActionStatus.run("completed", id);
}

export function markActionFailed(id: number): void {
  stmtMarkActionStatus.run("failed", id);
}

export function cancelPendingActionsForConvo(conversationId: number): void {
  stmtCancelPendingForConvo.run(conversationId);
}

export function cancelPendingActionsByTypeForConvo(
  conversationId: number,
  actionType: string
): void {
  stmtCancelPendingByTypeForConvo.run(conversationId, actionType);
}

/**
 * Al cambiar de producto, los clientes sin compra vuelven a entrar como un
 * lead nuevo. Conserva compradores y atribucion, pero borra memoria comercial
 * y acciones pendientes para que no se mezclen productos.
 */
export function resetUnpaidConversationsForProductSwitch(): number {
  const ids = stmtGetUnpaidConversationIds.all().map((row) => row.id);
  for (const id of ids) {
    cancelPendingActionsForConvo(id);
    deleteAllMessages(id);
    stmtResetUnpaidConversationForProductSwitch.run(id);
  }
  return ids.length;
}

export function hasPendingActionType(
  conversationId: number,
  actionType: string
): boolean {
  const r = stmtCountPendingActionTypeForConvo.get(conversationId, actionType);
  return (r?.c ?? 0) > 0;
}

/**
 * Igual que hasPendingActionType pero solo cuenta acciones cuya `run_at`
 * es ESTRICTAMENTE futura. Util para idempotencia desde DENTRO del handler
 * de una accion que se esta ejecutando: la accion en curso todavia esta
 * en status='pending' hasta que el worker llame markActionCompleted, asi
 * que hasPendingActionType la encontraria a si misma y devolveria true.
 * Filtrando por run_at > now la excluimos (la accion en curso tiene
 * run_at <= now porque ya estaba vencida).
 */
export function hasFuturePendingActionType(
  conversationId: number,
  actionType: string,
  nowSec: number
): boolean {
  const r = stmtCountFuturePendingActionTypeForConvo.get(
    conversationId,
    actionType,
    nowSec
  );
  return (r?.c ?? 0) > 0;
}

const stmtShiftPendingActionsByType = db.prepare<[number, number, string, number]>(
  `UPDATE scheduled_actions
      SET run_at = run_at + ?
    WHERE conversation_id = ?
      AND status = 'pending'
      AND action_type = ?
      AND run_at > ?`
);

/**
 * Desplaza hacia adelante (en deltaSec segundos) todas las acciones pendientes
 * de un tipo dado para una conversacion que esten programadas despues de
 * afterUnixSec. Usado por el sistema de horario silencioso: cuando un
 * seguimiento se pospone por caer en madrugada, los siguientes seguimientos
 * de la misma convo deben desplazarse el mismo delta para preservar los gaps.
 */
export function shiftPendingActionsByType(
  conversationId: number,
  actionType: string,
  deltaSec: number,
  afterUnixSec: number
): number {
  const info = stmtShiftPendingActionsByType.run(
    deltaSec,
    conversationId,
    actionType,
    afterUnixSec
  );
  return info.changes;
}

const stmtMaxPendingActionRunAt = db.prepare<
  [string, number],
  { max_run_at: number | null }
>(
  `SELECT MAX(run_at) AS max_run_at
     FROM scheduled_actions
    WHERE status = 'pending'
      AND action_type = ?
      AND run_at >= ?`
);

/**
 * Devuelve el ultimo run_at programado para un tipo de accion en la cola
 * de despertar (acciones pendientes con run_at >= baseUnixSec). Usado por
 * el spacing aleatorio de la cola del amanecer: cuando un seguimiento se
 * difiere a la mañana siguiente, ocupa el siguiente slot disponible (last
 * slot + random 45-75s). Devuelve null si la cola esta vacia.
 */
export function getLatestPendingActionSlot(
  actionType: string,
  baseUnixSec: number
): number | null {
  const r = stmtMaxPendingActionRunAt.get(actionType, baseUnixSec);
  return r?.max_run_at ?? null;
}

const stmtLastUserMessageTime = db.prepare<
  [number],
  { last_at: number | null }
>(
  `SELECT MAX(created_at) AS last_at
     FROM messages
    WHERE conversation_id = ? AND role = 'user'`
);

/**
 * Devuelve el unix timestamp del mensaje mas reciente del cliente para
 * esta convo, o null si no hay mensajes del cliente. Usado por el check
 * proactivo de ventana 24h de Meta: si pasaron mas de 23h53m desde el
 * ultimo mensaje del cliente, cancelamos el seguimiento sin llamar a la
 * Meta API (porque sabemos que va a fallar con error 131047).
 */
export function getLastUserMessageTime(conversationId: number): number | null {
  const r = stmtLastUserMessageTime.get(conversationId);
  return r?.last_at ?? null;
}

const stmtSetLastFollowupStarted = db.prepare<[number, number]>(
  "UPDATE conversations SET last_followup_started_at = ? WHERE id = ?"
);

/**
 * Marca el timestamp en que se dispara un seguimiento. Usado como
 * milestone para el check de engagement en seguimientos posteriores.
 */
export function setLastFollowupStartedAt(
  conversationId: number,
  unixSec: number
): void {
  stmtSetLastFollowupStarted.run(unixSec, conversationId);
}

const stmtSetLastFollowupIndex = db.prepare<[number, number]>(
  "UPDATE conversations SET last_followup_index = ? WHERE id = ?"
);

/**
 * Marca el indice 0-based del ultimo seguimiento disparado. -1 reset.
 * Llamado al ejecutar el ultimo step de cada secuencia de seguimiento.
 */
export function setLastFollowupIndex(
  conversationId: number,
  index: number
): void {
  stmtSetLastFollowupIndex.run(index, conversationId);
}

const stmtResetFollowupTracking = db.prepare<[number]>(
  `UPDATE conversations
     SET last_followup_index = -1,
         last_followup_started_at = 0
   WHERE id = ?`
);

/** Resetea el tracking de seguimientos (indice + milestone). Lo usa
 *  /restart. */
export function resetFollowupTracking(conversationId: number): void {
  stmtResetFollowupTracking.run(conversationId);
}

const stmtCountPendingActionsInWindow = db.prepare<
  [string, number, number],
  { c: number }
>(
  `SELECT COUNT(*) AS c
     FROM scheduled_actions
    WHERE status = 'pending'
      AND action_type = ?
      AND run_at >= ?
      AND run_at < ?`
);

/**
 * Cuenta cuantas acciones pendientes de un tipo existen con run_at
 * dentro de [fromUnixSec, toUnixSec). Usado por la cola anti-rafaga de
 * seguimientos: cuando programamos un nuevo start_followup para un slot,
 * miramos cuantos ya estan agendados en la ventana de ese slot para
 * elegir la siguiente posicion en la cola.
 */
export function countPendingActionsInWindow(
  actionType: string,
  fromUnixSec: number,
  toUnixSec: number
): number {
  const r = stmtCountPendingActionsInWindow.get(
    actionType,
    fromUnixSec,
    toUnixSec
  );
  return r?.c ?? 0;
}

const stmtHasUserMessageSinceFollowupStart = db.prepare<
  [number, number],
  { c: number }
>(
  `SELECT COUNT(*) AS c
     FROM messages
    WHERE conversation_id = ?
      AND role = 'user'
      AND created_at > (
        SELECT MAX(created_at, COALESCE(last_followup_started_at, 0))
        FROM conversations
        WHERE id = ?
      )`
);

/**
 * Check de engagement: devuelve true si el cliente envio algun mensaje
 * DESPUES del ultimo milestone (intro_data si no hay seguimientos, o
 * el ultimo seguimiento que disparo).
 *
 * Usado para cancelar seguimientos cuando el cliente esta silencioso —
 * si no respondio desde la ultima vez que el bot le envio una secuencia
 * scripted, no insistimos (evita bloqueos y baja calidad).
 *
 * Compara contra MAX(conversations.created_at, last_followup_started_at)
 * para que la T0 (primer mensaje del cliente) NO cuente como engagement
 * — se requiere un segundo mensaje del cliente para activar el seguimiento.
 */
export function hasUserMessageSinceFollowupStart(
  conversationId: number
): boolean {
  const r = stmtHasUserMessageSinceFollowupStart.get(
    conversationId,
    conversationId
  );
  return (r?.c ?? 0) > 0;
}

// ─── Respuestas rápidas (quick replies) ──────────────────────────────────

// Adjunto de la respuesta rápida. Va como migración para que las bases que ya
// existen sigan funcionando: sin estas columnas, la respuesta es solo texto,
// que es como nacieron.
const quickReplyColumns: Array<[string, string]> = [
  ["media_type", "TEXT"],
  ["media_url", "TEXT"],
  ["media_mime", "TEXT"],
  ["media_filename", "TEXT"],
];
for (const [name, type] of quickReplyColumns) {
  try {
    db.exec(`ALTER TABLE quick_replies ADD COLUMN ${name} ${type}`);
  } catch {
    // ya existe
  }
}

const stmtListQuickReplies = db.prepare<[], QuickReplyRow>(
  "SELECT * FROM quick_replies ORDER BY created_at ASC"
);
const stmtGetQuickReplyById = db.prepare<[number], QuickReplyRow>(
  "SELECT * FROM quick_replies WHERE id = ?"
);
const stmtInsertQuickReply = db.prepare<
  [string | null, string, string | null, string | null, string | null, string | null]
>(
  `INSERT INTO quick_replies
     (shortcut, content, media_type, media_url, media_mime, media_filename)
   VALUES (?, ?, ?, ?, ?, ?)`
);
const stmtUpdateQuickReply = db.prepare<
  [
    string | null,
    string,
    string | null,
    string | null,
    string | null,
    string | null,
    number,
  ]
>(
  `UPDATE quick_replies
      SET shortcut = ?, content = ?, media_type = ?, media_url = ?,
          media_mime = ?, media_filename = ?
    WHERE id = ?`
);
const stmtDeleteQuickReply = db.prepare<[number]>(
  "DELETE FROM quick_replies WHERE id = ?"
);

export function listQuickReplies(): QuickReplyRow[] {
  return stmtListQuickReplies.all();
}

export function getQuickReplyById(id: number): QuickReplyRow | undefined {
  return stmtGetQuickReplyById.get(id);
}

export function createQuickReply(
  shortcut: string | null,
  content: string,
  media: QuickReplyMedia | null = null
): QuickReplyRow {
  const info = stmtInsertQuickReply.run(
    shortcut,
    content,
    media?.media_type ?? null,
    media?.media_url ?? null,
    media?.media_mime ?? null,
    media?.media_filename ?? null
  );
  const row = stmtGetQuickReplyById.get(Number(info.lastInsertRowid));
  if (!row) throw new Error("No se pudo crear la respuesta rápida");
  return row;
}

export function updateQuickReply(
  id: number,
  shortcut: string | null,
  content: string,
  media: QuickReplyMedia | null = null
): boolean {
  const info = stmtUpdateQuickReply.run(
    shortcut,
    content,
    media?.media_type ?? null,
    media?.media_url ?? null,
    media?.media_mime ?? null,
    media?.media_filename ?? null,
    id
  );
  return info.changes > 0;
}

export function deleteQuickReply(id: number): boolean {
  const info = stmtDeleteQuickReply.run(id);
  return info.changes > 0;
}

// ─── Números bloqueados (blacklist) ──────────────────────────────────────

const stmtListBlockedNumbers = db.prepare<[], BlockedNumberRow>(
  "SELECT * FROM blocked_numbers ORDER BY blocked_at DESC"
);
const stmtIsBlocked = db.prepare<[string], { phone: string }>(
  "SELECT phone FROM blocked_numbers WHERE phone = ?"
);
const stmtBlockNumber = db.prepare<[string, string | null]>(
  "INSERT OR REPLACE INTO blocked_numbers (phone, reason) VALUES (?, ?)"
);
const stmtUnblockNumber = db.prepare<[string]>(
  "DELETE FROM blocked_numbers WHERE phone = ?"
);

export function listBlockedNumbers(): BlockedNumberRow[] {
  return stmtListBlockedNumbers.all();
}

export function isNumberBlocked(phone: string): boolean {
  return stmtIsBlocked.get(phone) !== undefined;
}

export function blockNumber(phone: string, reason: string | null): void {
  stmtBlockNumber.run(phone, reason);
}

export function unblockNumber(phone: string): boolean {
  const info = stmtUnblockNumber.run(phone);
  return info.changes > 0;
}

// ─── Pinear conversaciones ───────────────────────────────────────────────

const stmtSetPinned = db.prepare<[number, number | null, number]>(
  "UPDATE conversations SET pinned = ?, pinned_at = ? WHERE id = ?"
);

export function setConversationPinned(
  conversationId: number,
  pinned: boolean
): void {
  stmtSetPinned.run(
    pinned ? 1 : 0,
    pinned ? Math.floor(Date.now() / 1000) : null,
    conversationId
  );
}

// ─── Indicador de no leídos ──────────────────────────────────────────────

// Al marcar como LEÍDO: avanzamos last_read_at al ahora (los mensajes
// previos del cliente dejan de contar como no leídos) y limpiamos el
// flag de "marcado manual como no leído" si estaba activo.
// Meta OAuth connections. These are runtime settings for copied bots:
// each deployment can connect its own Facebook Page without changing code.
// Los secretos se cifran usando una clave derivada de la contraseña del panel.
// Una instalación puede definir META_CONNECT_ENCRYPTION_KEY para independizar
// esa clave de una futura rotación de contraseña.
const META_SECRET_PREFIX = "enc:v1:";

function metaStorageKey(): Buffer | null {
  const source =
    process.env.META_CONNECT_ENCRYPTION_KEY?.trim() ||
    process.env.DASHBOARD_PASSWORD?.trim();
  if (!source) return null;
  return crypto
    .createHash("sha256")
    .update(`meta-connect-storage:${source}`)
    .digest();
}

function encryptMetaValue(value: string): string {
  const key = metaStorageKey();
  if (!key || !value) return value;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${META_SECRET_PREFIX}${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

function decryptMetaValue(value: string): string {
  if (!value.startsWith(META_SECRET_PREFIX)) return value;
  const key = metaStorageKey();
  if (!key) return "";
  const parts = value.slice(META_SECRET_PREFIX.length).split(".");
  if (parts.length !== 3) return "";
  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(parts[0], "base64url")
    );
    decipher.setAuthTag(Buffer.from(parts[1], "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(parts[2], "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return "";
  }
}

function hydrateMetaConnection(row: MetaConnectionRow): MetaConnectionRow {
  return { ...row, page_access_token: decryptMetaValue(row.page_access_token) };
}

function hydrateWhatsAppConnection(
  row: MetaWhatsAppConnectionRow
): MetaWhatsAppConnectionRow {
  return { ...row, access_token: decryptMetaValue(row.access_token) };
}
const stmtListMetaConnections = db.prepare<[], MetaConnectionRow>(
  `SELECT *
     FROM meta_connections
    ORDER BY active DESC, updated_at DESC, page_name ASC`
);
const stmtGetActiveMetaConnection = db.prepare<[], MetaConnectionRow>(
  "SELECT * FROM meta_connections WHERE active = 1 ORDER BY updated_at DESC LIMIT 1"
);
const stmtGetMetaConnectionByPageId = db.prepare<[string], MetaConnectionRow>(
  "SELECT * FROM meta_connections WHERE page_id = ?"
);
const stmtClearActiveMetaConnections = db.prepare(
  "UPDATE meta_connections SET active = 0"
);
const stmtActivateMetaConnection = db.prepare<[string]>(
  "UPDATE meta_connections SET active = 1, selected = 1, updated_at = unixepoch() WHERE page_id = ?"
);
const stmtDeleteMetaConnection = db.prepare<[string]>(
  "DELETE FROM meta_connections WHERE page_id = ?"
);
const stmtListMetaDetectedEnv = db.prepare<[], MetaDetectedEnvRow>(
  "SELECT * FROM meta_detected_env ORDER BY name ASC"
);
const stmtListMetaAdsReaders = db.prepare<[], MetaAdsReaderRow>(
  "SELECT * FROM meta_ads_readers WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE"
);
/** Las de la papelera, la más reciente primero: es la que se suele restaurar. */
const stmtListMetaAdsReadersEnPapelera = db.prepare<[], MetaAdsReaderRow>(
  "SELECT * FROM meta_ads_readers WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC"
);
const stmtGetMetaAdsReader = db.prepare<[number], MetaAdsReaderRow>(
  "SELECT * FROM meta_ads_readers WHERE id = ?"
);
const stmtUpsertMetaAdsReader = db.prepare<[string, string]>(
  // `deleted_at = NULL` importa: el nombre es único, así que volver a crear una
  // cuenta con el nombre de otra que está en la papelera cae en este UPDATE. Sin
  // esa línea la nueva nacería dentro de la papelera y no aparecería por ningún
  // lado.
  `INSERT INTO meta_ads_readers (name, token, updated_at) VALUES (?, ?, unixepoch())
   ON CONFLICT(name) DO UPDATE
     SET token = excluded.token, deleted_at = NULL, updated_at = unixepoch()`
);
const stmtDeleteMetaAdsReader = db.prepare<[number]>(
  "UPDATE meta_ads_readers SET deleted_at = unixepoch() WHERE id = ?"
);
const stmtRestoreMetaAdsReader = db.prepare<[number]>(
  "UPDATE meta_ads_readers SET deleted_at = NULL WHERE id = ?"
);
/** El borrado de verdad. Solo se llega aquí desde la papelera, a propósito. */
const stmtPurgeMetaAdsReader = db.prepare<[number]>(
  "DELETE FROM meta_ads_readers WHERE id = ? AND deleted_at IS NOT NULL"
);
const stmtUpdateMetaAdsReader = db.prepare<[string, string, number]>(
  `UPDATE meta_ads_readers
      SET name = ?, token = ?, updated_at = unixepoch()
    WHERE id = ?`
);
const stmtGetAdOriginCache = db.prepare<[string], AdOriginCacheRow>(
  "SELECT * FROM ad_origin_cache WHERE ad_id = ?"
);
const stmtUpsertAdOriginCache = db.prepare<[
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
]>(
  `INSERT INTO ad_origin_cache (
      ad_id, ad_account_id, ad_account_name, business_id, business_name,
      campaign_id, campaign_name, ad_name, reader_name, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
   ON CONFLICT(ad_id) DO UPDATE SET
      ad_account_id = excluded.ad_account_id,
      ad_account_name = excluded.ad_account_name,
      business_id = excluded.business_id,
      business_name = excluded.business_name,
      campaign_id = excluded.campaign_id,
      campaign_name = excluded.campaign_name,
      ad_name = excluded.ad_name,
      reader_name = excluded.reader_name,
      updated_at = unixepoch()`
);
const stmtUpsertMetaDetectedEnv = db.prepare<[string, string, string]>(
  `INSERT INTO meta_detected_env (name, value, source, detected_at)
   VALUES (?, ?, ?, unixepoch())
   ON CONFLICT(name) DO UPDATE SET
     value = excluded.value,
     source = excluded.source,
     detected_at = unixepoch()`
);
const stmtGetMetaRuntimeSetting = db.prepare<[string], { value: string }>(
  "SELECT value FROM meta_runtime_settings WHERE name = ?"
);
const stmtUpsertMetaRuntimeSetting = db.prepare<[string, string]>(
  `INSERT INTO meta_runtime_settings (name, value, updated_at)
   VALUES (?, ?, unixepoch())
   ON CONFLICT(name) DO UPDATE SET
     value = excluded.value,
     updated_at = unixepoch()`
);
const stmtDeleteMetaRuntimeSetting = db.prepare<[string]>(
  "DELETE FROM meta_runtime_settings WHERE name = ?"
);
const stmtListMetaWhatsAppConnections = db.prepare<[], MetaWhatsAppConnectionRow>(
  `SELECT * FROM meta_whatsapp_connections
   ORDER BY active DESC, updated_at DESC, display_phone_number ASC`
);
const stmtGetActiveMetaWhatsAppConnection = db.prepare<
  [],
  MetaWhatsAppConnectionRow
>(
  "SELECT * FROM meta_whatsapp_connections WHERE active = 1 ORDER BY updated_at DESC LIMIT 1"
);
const stmtGetMetaWhatsAppByPhoneId = db.prepare<
  [string],
  MetaWhatsAppConnectionRow
>("SELECT * FROM meta_whatsapp_connections WHERE phone_number_id = ?");
const stmtClearActiveMetaWhatsAppConnections = db.prepare(
  "UPDATE meta_whatsapp_connections SET active = 0"
);
const stmtActivateMetaWhatsAppConnection = db.prepare<[string]>(
  "UPDATE meta_whatsapp_connections SET active = 1, updated_at = unixepoch() WHERE phone_number_id = ?"
);
const stmtDeleteMetaWhatsAppConnection = db.prepare<[string]>(
  "DELETE FROM meta_whatsapp_connections WHERE phone_number_id = ?"
);
const stmtUpsertMetaWhatsAppConnection = db.prepare<
  [
    string,
    string,
    string | null,
    string | null,
    string | null,
    string,
    number,
    string | null,
    string | null,
    string | null,
  ]
>(
  `INSERT INTO meta_whatsapp_connections
     (phone_number_id, waba_id, display_phone_number, verified_name, profile_picture_url, access_token,
      active, business_id, business_name, compartido_con, connected_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())
   ON CONFLICT(phone_number_id) DO UPDATE SET
     waba_id = excluded.waba_id,
     display_phone_number = excluded.display_phone_number,
     verified_name = excluded.verified_name,
     profile_picture_url = COALESCE(excluded.profile_picture_url, meta_whatsapp_connections.profile_picture_url),
     -- Un número con token permanente lo conserva: volver a iniciar sesión (o «Traer»,
     -- «Activar») traería el de 60 días y lo cambiaría por uno que caduca.
     access_token = CASE
       WHEN meta_whatsapp_connections.token_permanente = 1 THEN meta_whatsapp_connections.access_token
       ELSE excluded.access_token
     END,
     -- Si Meta no contestó quién es el dueño, se conserva el que ya estaba: un fallo
     -- de red no puede dejar un número sin cuenta.
     business_id = COALESCE(excluded.business_id, meta_whatsapp_connections.business_id),
     business_name = COALESCE(excluded.business_name, meta_whatsapp_connections.business_name),
     compartido_con = COALESCE(excluded.compartido_con, meta_whatsapp_connections.compartido_con),
     active = CASE
       WHEN meta_whatsapp_connections.active = 1 OR excluded.active = 1 THEN 1
       ELSE meta_whatsapp_connections.active
     END,
     updated_at = unixepoch()`
);
const stmtUpsertMetaConnection = db.prepare<
  [
    string,
    string,
    string,
    string | null,
    string | null,
    string | null,
    number,
    number,
    string | null,
    string | null,
    string | null,
  ]
>(
  `INSERT INTO meta_connections
     (page_id, page_name, page_access_token, instagram_business_account_id,
      instagram_username, page_picture_url, selected, active, business_id, business_name,
      compartido_con, connected_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())
   ON CONFLICT(page_id) DO UPDATE SET
     page_name = excluded.page_name,
     page_access_token = excluded.page_access_token,
     business_id = COALESCE(excluded.business_id, meta_connections.business_id),
     business_name = COALESCE(excluded.business_name, meta_connections.business_name),
     compartido_con = COALESCE(excluded.compartido_con, meta_connections.compartido_con),
     instagram_business_account_id = COALESCE(
       excluded.instagram_business_account_id,
       meta_connections.instagram_business_account_id
     ),
     instagram_username = COALESCE(
       excluded.instagram_username,
       meta_connections.instagram_username
     ),
     page_picture_url = COALESCE(excluded.page_picture_url, meta_connections.page_picture_url),
     selected = CASE
       WHEN meta_connections.selected = 1 OR excluded.selected = 1 THEN 1
       ELSE 0
     END,
     active = CASE
       WHEN meta_connections.active = 1 OR excluded.active = 1 THEN 1
       ELSE meta_connections.active
     END,
     updated_at = unixepoch()`
);

export interface SaveMetaConnectionInput {
  pageId: string;
  pageName: string;
  pageAccessToken: string;
  instagramBusinessAccountId?: string | null;
  instagramUsername?: string | null;
  pagePictureUrl?: string | null;
  selected?: boolean;
  active?: boolean;
  /** El negocio dueño. Vacío = se conserva el que ya estaba guardado. */
  businessId?: string | null;
  businessName?: string | null;
  /** Las cuentas que pueden usarla. Vacío = se conserva lo que ya estaba guardado. */
  compartidoCon?: Array<{ id: string; nombre: string | null }> | null;
}

/** La lista de cuentas que pueden usar algo, tal como se guarda: JSON o NULL. */
function comoListaDeAcceso(
  lista: Array<{ id: string; nombre: string | null }> | null | undefined
): string | null {
  const limpia = (lista ?? []).filter((c) => typeof c?.id === "string" && c.id);
  return limpia.length ? JSON.stringify(limpia) : null;
}

/** Leer la lista guardada. Cualquier cosa rara = lista vacía, nunca un fallo. */
export function leerListaDeAcceso(
  guardado: string | null | undefined
): Array<{ id: string; nombre: string | null }> {
  if (!guardado) return [];
  try {
    const parsed = JSON.parse(guardado);
    return Array.isArray(parsed)
      ? parsed
          .filter((c) => typeof c?.id === "string" && c.id)
          .map((c) => ({ id: c.id as string, nombre: typeof c.nombre === "string" ? c.nombre : null }))
      : [];
  } catch {
    return [];
  }
}

export function listMetaConnections(): MetaConnectionRow[] {
  return stmtListMetaConnections.all().map(hydrateMetaConnection);
}

export function getActiveMetaConnection(): MetaConnectionRow | null {
  const row = stmtGetActiveMetaConnection.get();
  if (row) return hydrateMetaConnection(row);

  // Recuperacion segura despues de un reinicio: solo hay una pagina elegida,
  // asi que no existe ambiguedad ni se cambia una seleccion entre varias.
  const selected = stmtListMetaConnections.all().filter((item) => item.selected === 1);
  if (selected.length !== 1) return null;
  stmtActivateMetaConnection.run(selected[0].page_id);
  const recovered = stmtGetMetaConnectionByPageId.get(selected[0].page_id);
  return recovered ? hydrateMetaConnection(recovered) : null;
}

/**
 * Instagram puede usar una página distinta a Messenger. Si todavía no se eligió
 * una explícitamente, conserva el comportamiento anterior usando la página
 * activa de Messenger solo cuando ya tiene Instagram vinculado.
 */
export function getActiveInstagramMetaConnection(): MetaConnectionRow | null {
  const selectedPageId = getMetaRuntimeSetting("active_instagram_page_id");
  if (selectedPageId) {
    const selected = stmtGetMetaConnectionByPageId.get(selectedPageId);
    if (selected?.instagram_business_account_id) {
      return hydrateMetaConnection(selected);
    }
  }

  const messengerConnection = getActiveMetaConnection();
  return messengerConnection?.instagram_business_account_id
    ? messengerConnection
    : null;
}

export function getMetaConnectionByPageId(
  pageId: string
): MetaConnectionRow | null {
  const row = stmtGetMetaConnectionByPageId.get(pageId);
  return row ? hydrateMetaConnection(row) : null;
}

export function saveMetaConnection(input: SaveMetaConnectionInput): MetaConnectionRow {
  const shouldActivate = input.active === true;
  if (shouldActivate) stmtClearActiveMetaConnections.run();
  stmtUpsertMetaConnection.run(
    input.pageId,
    input.pageName,
    encryptMetaValue(input.pageAccessToken),
    input.instagramBusinessAccountId ?? null,
    input.instagramUsername ?? null,
    input.pagePictureUrl ?? null,
    input.selected === false ? 0 : 1,
    shouldActivate ? 1 : 0,
    input.businessId?.trim() || null,
    input.businessName?.trim() || null,
    comoListaDeAcceso(input.compartidoCon)
  );
  const row = stmtGetMetaConnectionByPageId.get(input.pageId);
  if (!row) throw new Error("No se pudo guardar la conexion Meta");
  return hydrateMetaConnection(row);
}

export function activateMetaConnection(pageId: string): MetaConnectionRow | null {
  const existing = stmtGetMetaConnectionByPageId.get(pageId);
  if (!existing) return null;
  stmtClearActiveMetaConnections.run();
  stmtActivateMetaConnection.run(pageId);
  const row = stmtGetMetaConnectionByPageId.get(pageId);
  return row ? hydrateMetaConnection(row) : null;
}

export function activateInstagramMetaConnection(
  pageId: string
): MetaConnectionRow | null {
  const existing = stmtGetMetaConnectionByPageId.get(pageId);
  if (!existing?.instagram_business_account_id) return null;
  setMetaRuntimeSettings({ active_instagram_page_id: pageId });
  return hydrateMetaConnection(existing);
}

export function removeMetaConnection(pageId: string): boolean {
  const existing = stmtGetMetaConnectionByPageId.get(pageId);
  if (!existing) return false;
  const tx = db.transaction(() => {
    if (getMetaRuntimeSetting("active_instagram_page_id") === pageId) {
      stmtDeleteMetaRuntimeSetting.run("active_instagram_page_id");
    }
    stmtDeleteMetaConnection.run(pageId);
  });
  tx();
  return true;
}

export function listMetaDetectedEnv(): MetaDetectedEnvRow[] {
  return stmtListMetaDetectedEnv
    .all()
    .map((row) => ({ ...row, value: decryptMetaValue(row.value) }));
}

export function listMetaAdsReaders(): MetaAdsReaderRow[] {
  return stmtListMetaAdsReaders.all();
}

/** Cualquiera, esté o no en la papelera. Para ver su token y para restaurarla. */
export function getMetaAdsReader(id: number): MetaAdsReaderRow | null {
  return stmtGetMetaAdsReader.get(id) ?? null;
}

/**
 * Solo si está EN USO. Es la que deben usar las rutas que leen anuncios: una
 * cuenta quitada deja de servir aunque alguien conserve su id en una pantalla
 * vieja. Sin esto, "quitada" seria solo dejar de verla en la lista.
 */
export function getMetaAdsReaderActivo(id: number): MetaAdsReaderRow | null {
  const fila = stmtGetMetaAdsReader.get(id);
  return fila && fila.deleted_at == null ? fila : null;
}

export function saveMetaAdsReader(name: string, token: string): void {
  stmtUpsertMetaAdsReader.run(name.trim(), token.trim());
}

/** Manda la cuenta a la papelera. El token se conserva. */
export function deleteMetaAdsReader(id: number): void {
  stmtDeleteMetaAdsReader.run(id);
}

export function listMetaAdsReadersEnPapelera(): MetaAdsReaderRow[] {
  return stmtListMetaAdsReadersEnPapelera.all();
}

/** La saca de la papelera con su token. false = ese id no estaba ahí. */
export function restoreMetaAdsReader(id: number): boolean {
  const actual = stmtGetMetaAdsReader.get(id);
  if (!actual || actual.deleted_at == null) return false;
  return stmtRestoreMetaAdsReader.run(id).changes > 0;
}

/**
 * Borra la cuenta de verdad, token incluido. La consulta exige que ya esté en
 * la papelera: así este borrado nunca puede alcanzar a una cuenta en uso,
 * aunque llegue un id equivocado.
 */
export function purgeMetaAdsReader(id: number): boolean {
  return stmtPurgeMetaAdsReader.run(id).changes > 0;
}

export function updateMetaAdsReader(input: {
  id: number;
  name: string;
  token?: string;
}): boolean {
  const current = stmtGetMetaAdsReader.get(input.id);
  const name = input.name.trim();
  // Una cuenta en la papelera no se edita: primero se restaura.
  if (!current || current.deleted_at != null || !name) return false;
  const token = input.token?.trim() || current.token;
  return stmtUpdateMetaAdsReader.run(name, token, input.id).changes > 0;
}

export function getAdOriginCache(adId: string): AdOriginCacheRow | null {
  return stmtGetAdOriginCache.get(adId) ?? null;
}

export function saveAdOriginCache(
  origin: Omit<AdOriginCacheRow, "updated_at">
): void {
  stmtUpsertAdOriginCache.run(
    origin.ad_id,
    origin.ad_account_id,
    origin.ad_account_name,
    origin.business_id,
    origin.business_name,
    origin.campaign_id,
    origin.campaign_name,
    origin.ad_name,
    origin.reader_name
  );
}

export function saveMetaDetectedEnv(values: Record<string, string>, source: string): void {
  const entries = Object.entries(values).filter(([, value]) => value.trim());
  const tx = db.transaction(() => {
    for (const [name, value] of entries) {
      const isSecret = /(?:TOKEN|SECRET|PASSWORD|KEY)$/i.test(name);
      stmtUpsertMetaDetectedEnv.run(
        name,
        isSecret ? encryptMetaValue(value) : value,
        source
      );
    }
  });
  tx();
}

export function getMetaRuntimeSetting(name: string): string | null {
  const value = stmtGetMetaRuntimeSetting.get(name)?.value;
  if (value == null) return null;
  return decryptMetaValue(value) || null;
}

export function setMetaRuntimeSettings(values: Record<string, string>): void {
  const entries = Object.entries(values).filter(([, value]) => value.trim());
  const tx = db.transaction(() => {
    for (const [name, value] of entries) {
      stmtUpsertMetaRuntimeSetting.run(name, encryptMetaValue(value));
    }
  });
  tx();
}

/**
 * CERRAR SESIÓN DE META: DEJAR META CONNECT VACÍO (21/10/2026). «Necesito poder desconectar la
 * app y volver a conectar otra… al cerrar sesión que se vacíe, como un CRM».
 *
 * Borra SOLO lo de Meta de ESTE proyecto: la app y su clave, los inicios de sesión, los tokens
 * permanentes, los números, las páginas, los píxeles detectados, las cuentas de Facebook anexadas
 * y las cuentas de lectura de anuncios. NO toca nada en Meta (la app, los números y los tokens
 * siguen existiendo allá), ni el contenido, ni las tiendas, ni los chats.
 *
 * Se conservan los «verify token» de los webhooks: son palabras al azar de este proyecto, no de
 * una app, y la app nueva se configura con ellas.
 */
export function vaciarMetaConnect(): void {
  db.transaction(() => {
    db.prepare("DELETE FROM meta_whatsapp_connections").run();
    db.prepare("DELETE FROM meta_connections").run();
    db.prepare("DELETE FROM meta_detected_env").run();
    db.prepare("DELETE FROM meta_ads_readers").run();
    db.prepare("DELETE FROM meta_cuentas").run();
    db.prepare("DELETE FROM meta_runtime_settings WHERE name NOT LIKE '%verify_token'").run();
  })();
}

export function deleteMetaRuntimeSettings(names: string[]): void {
  const tx = db.transaction(() => {
    for (const name of names) stmtDeleteMetaRuntimeSetting.run(name);
  });
  tx();
}

export interface SaveMetaWhatsAppConnectionInput {
  phoneNumberId: string;
  wabaId: string;
  displayPhoneNumber?: string | null;
  verifiedName?: string | null;
  profilePictureUrl?: string | null;
  accessToken: string;
  active?: boolean;
  /** El negocio dueño. Vacío = se conserva el que ya estaba guardado. */
  businessId?: string | null;
  businessName?: string | null;
  /** Las cuentas que pueden usarlo. Vacío = se conserva lo que ya estaba guardado. */
  compartidoCon?: Array<{ id: string; nombre: string | null }> | null;
}

export function listMetaWhatsAppConnections(): MetaWhatsAppConnectionRow[] {
  return stmtListMetaWhatsAppConnections.all().map(hydrateWhatsAppConnection);
}

export function getActiveMetaWhatsAppConnection(): MetaWhatsAppConnectionRow | null {
  const row = stmtGetActiveMetaWhatsAppConnection.get();
  if (row) return hydrateWhatsAppConnection(row);

  // Nunca elegimos entre dos numeros. Con uno solo guardado, restaurarlo evita
  // que un flag activo perdido bloquee Chat despues de un reinicio.
  const connections = stmtListMetaWhatsAppConnections.all();
  if (connections.length !== 1) return null;
  stmtActivateMetaWhatsAppConnection.run(connections[0].phone_number_id);
  const recovered = stmtGetMetaWhatsAppByPhoneId.get(connections[0].phone_number_id);
  return recovered ? hydrateWhatsAppConnection(recovered) : null;
}

/**
 * Busca una conexion CONCRETA por su numero. Se usa para responderle a cada
 * cliente por el mismo numero nuestro al que escribio, cuando hay varios
 * conectados. null si ese numero ya no esta conectado -> el caller cae al
 * activo, que es el comportamiento de siempre.
 */
export function getMetaWhatsAppConnection(
  phoneNumberId: string
): MetaWhatsAppConnectionRow | null {
  const row = stmtGetMetaWhatsAppByPhoneId.get(phoneNumberId);
  return row ? hydrateWhatsAppConnection(row) : null;
}

export function saveMetaWhatsAppConnection(
  input: SaveMetaWhatsAppConnectionInput
): MetaWhatsAppConnectionRow {
  const shouldActivate = input.active === true;
  if (shouldActivate) stmtClearActiveMetaWhatsAppConnections.run();
  stmtUpsertMetaWhatsAppConnection.run(
    input.phoneNumberId,
    input.wabaId,
    input.displayPhoneNumber ?? null,
    input.verifiedName ?? null,
    input.profilePictureUrl ?? null,
    encryptMetaValue(input.accessToken),
    shouldActivate ? 1 : 0,
    input.businessId?.trim() || null,
    input.businessName?.trim() || null,
    comoListaDeAcceso(input.compartidoCon)
  );
  const row = stmtGetMetaWhatsAppByPhoneId.get(input.phoneNumberId);
  if (!row) throw new Error("No se pudo guardar la conexion de WhatsApp");
  return hydrateWhatsAppConnection(row);
}

/**
 * EL TOKEN PERMANENTE DE SU BM, A UN NÚMERO (21/10/2026). Cada número contesta con el token
 * de su propio BM: así el de otro BM (otra cuenta de Facebook) no pisa el tuyo. Solo se llama
 * después de comprobar con Meta que ese token alcanza ese número.
 */
const stmtPonerTokenPermanente = db.prepare<[string, string]>(
  "UPDATE meta_whatsapp_connections SET access_token = ?, token_permanente = 1, updated_at = unixepoch() WHERE phone_number_id = ?"
);
export function ponerTokenPermanenteAlNumero(phoneNumberId: string, token: string): boolean {
  return stmtPonerTokenPermanente.run(encryptMetaValue(token), phoneNumberId).changes > 0;
}

export function activateMetaWhatsAppConnection(
  phoneNumberId: string
): MetaWhatsAppConnectionRow | null {
  const existing = stmtGetMetaWhatsAppByPhoneId.get(phoneNumberId);
  if (!existing) return null;
  stmtClearActiveMetaWhatsAppConnections.run();
  stmtActivateMetaWhatsAppConnection.run(phoneNumberId);
  const row = stmtGetMetaWhatsAppByPhoneId.get(phoneNumberId);
  return row ? hydrateWhatsAppConnection(row) : null;
}

export function removeMetaWhatsAppConnection(phoneNumberId: string): boolean {
  return stmtDeleteMetaWhatsAppConnection.run(phoneNumberId).changes > 0;
}

/**
 * APUNTA DE QUÉ CUENTA ES UN NÚMERO O UNA PÁGINA YA CONECTADOS, y nada más.
 *
 * Es para las conexiones de antes del 09/10/2026, que se guardaron sin dueño. Escribe
 * SOLO las dos columnas de la cuenta: ni el permiso, ni cuál está activa, ni la fecha.
 * Rellenar un dato que faltaba no puede mover nada de lo que el bot usa para contestar.
 */
const stmtApuntarCuentaDelNumero = db.prepare<[string, string | null, string]>(
  "UPDATE meta_whatsapp_connections SET business_id = ?, business_name = ? WHERE phone_number_id = ?"
);
const stmtApuntarCuentaDeLaPagina = db.prepare<[string, string | null, string]>(
  "UPDATE meta_connections SET business_id = ?, business_name = ? WHERE page_id = ?"
);

export function apuntarCuentaDelNumero(
  phoneNumberId: string,
  cuenta: { id: string; nombre: string | null }
): void {
  stmtApuntarCuentaDelNumero.run(cuenta.id, cuenta.nombre, phoneNumberId);
}

export function apuntarCuentaDeLaPagina(
  pageId: string,
  cuenta: { id: string; nombre: string | null }
): void {
  stmtApuntarCuentaDeLaPagina.run(cuenta.id, cuenta.nombre, pageId);
}

/**
 * UN PERMISO DE MEDICIÓN POR CUENTA DE META — la parte 2 del plan.
 *
 * LO APROBÓ EL DUEÑO el 10/10/2026. Ver PLAN-VARIAS-CUENTAS-DE-FACEBOOK.md, apartado 5.
 *
 * EL PROBLEMA: las compras se avisaban a Meta con UN solo permiso para todas las tiendas.
 * Al entrar con una segunda cuenta ese permiso cambiaba, y las compras de la primera
 * dejaban de contarse — sin ningún error, porque la venta salía bien igual.
 *
 * ── LAS DOS COLUMNAS DE PERMISO ─────────────────────────────────────────────
 *
 *   token_conexion    el del login con el que se vio esta cuenta. Caduca a los ~60 días.
 *   token_permanente  el de un usuario del sistema de ESE negocio. No caduca.
 *
 * ── `origen`, Y POR QUÉ DECIDE ─────────────────────────────────────────────
 *
 *   principal  se vio entrando por «Conectar con Meta» / «Actualizar lista de Meta».
 *   nueva      se vio SOLO entrando por «Conectar nueva cuenta».
 *
 * Una cuenta principal mide con el permiso de siempre salvo que tenga permanente propio:
 * así, con una sola cuenta, cada compra sale con el mismo permiso que antes de esto. Una
 * cuenta nueva mide con el suyo, porque el de siempre es de otra cuenta y Meta lo
 * rechazaría. Si una cuenta se ve por los dos caminos, gana `principal`.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS meta_cuentas (
    business_id TEXT PRIMARY KEY,
    business_name TEXT,
    origen TEXT NOT NULL DEFAULT 'principal',
    token_conexion TEXT,
    token_permanente TEXT,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
`);
// LA CUENTA DE FACEBOOK QUE TRAJO ESTE NEGOCIO (Claudio, Alberto…). Lo pidió el dueño el
// 10/10/2026: en el selector «no hay un indicador o separador que me diga de qué bm ni
// cuenta es ese activo». NULL = se conectó antes de esto; se rellena al volver a entrar.
for (const statement of [
  "ALTER TABLE meta_cuentas ADD COLUMN facebook_id TEXT",
  "ALTER TABLE meta_cuentas ADD COLUMN facebook_nombre TEXT",
]) {
  try {
    db.exec(statement);
  } catch {
    // La columna ya existe.
  }
}

interface MetaCuentaRow {
  business_id: string;
  business_name: string | null;
  origen: string;
  token_conexion: string | null;
  token_permanente: string | null;
  updated_at: number;
  facebook_id: string | null;
  facebook_nombre: string | null;
}

const stmtGuardarPermisoDeConexion = db.prepare<
  [string, string | null, string, string, string | null, string | null]
>(
  `INSERT INTO meta_cuentas
     (business_id, business_name, origen, token_conexion, facebook_id, facebook_nombre, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, unixepoch())
   ON CONFLICT(business_id) DO UPDATE SET
     -- La cuenta de Facebook, con la misma regla que el permiso: una anexada no le quita
     -- un negocio a la principal. Y si Meta no dijo quién entró, se conserva la de antes.
     facebook_id = CASE
       WHEN meta_cuentas.origen = 'principal' AND excluded.origen = 'nueva'
         THEN meta_cuentas.facebook_id
       ELSE COALESCE(excluded.facebook_id, meta_cuentas.facebook_id)
     END,
     facebook_nombre = CASE
       WHEN meta_cuentas.origen = 'principal' AND excluded.origen = 'nueva'
         THEN meta_cuentas.facebook_nombre
       ELSE COALESCE(excluded.facebook_nombre, meta_cuentas.facebook_nombre)
     END,
     business_name = COALESCE(excluded.business_name, meta_cuentas.business_name),
     origen = CASE
       WHEN meta_cuentas.origen = 'principal' OR excluded.origen = 'principal' THEN 'principal'
       ELSE 'nueva'
     END,
     -- Un login de «cuenta nueva» no pisa el permiso de una cuenta principal, aunque la
     -- vea: «Conectar nueva cuenta» no toca nada de la de siempre.
     token_conexion = CASE
       WHEN meta_cuentas.origen = 'principal' AND excluded.origen = 'nueva'
         THEN meta_cuentas.token_conexion
       ELSE excluded.token_conexion
     END,
     updated_at = unixepoch()`
);
const stmtGuardarPermisoPermanente = db.prepare<[string, string]>(
  `INSERT INTO meta_cuentas (business_id, token_permanente, updated_at)
   VALUES (?, ?, unixepoch())
   ON CONFLICT(business_id) DO UPDATE SET
     token_permanente = excluded.token_permanente,
     updated_at = unixepoch()`
);
const stmtGetMetaCuenta = db.prepare<[string], MetaCuentaRow>(
  "SELECT * FROM meta_cuentas WHERE business_id = ?"
);
const stmtListMetaCuentas = db.prepare<[], MetaCuentaRow>("SELECT * FROM meta_cuentas");

/** Guarda el permiso del login para cada cuenta que ese login ve. */
export function guardarPermisoDeConexionDeCuentas(
  cuentas: Array<{ id: string; nombre: string | null }>,
  token: string,
  origen: "principal" | "nueva",
  /** Quién entró. null = Meta no lo dijo; se conserva lo que hubiera. */
  facebook?: { id: string; nombre: string | null } | null
): void {
  const cifrado = encryptMetaValue(token);
  const tx = db.transaction(() => {
    for (const c of cuentas) {
      if (!c.id) continue;
      stmtGuardarPermisoDeConexion.run(
        c.id,
        c.nombre?.trim() || null,
        origen,
        cifrado,
        facebook?.id ?? null,
        facebook?.nombre?.trim() || null
      );
    }
  });
  tx();
}

/**
 * DE QUÉ CUENTA DE FACEBOOK ES CADA NEGOCIO, por su id. Para los separadores de los
 * selectores y para Meta Connect. Sin secretos: solo nombres.
 */
export function cuentaDeFacebookDeCadaNegocio(): Map<
  string,
  { facebookId: string | null; facebookNombre: string | null; origen: "principal" | "nueva" }
> {
  const mapa = new Map<
    string,
    { facebookId: string | null; facebookNombre: string | null; origen: "principal" | "nueva" }
  >();
  for (const f of stmtListMetaCuentas.all()) {
    mapa.set(f.business_id, {
      facebookId: f.facebook_id ?? null,
      facebookNombre: f.facebook_nombre ?? null,
      origen: f.origen === "nueva" ? "nueva" : "principal",
    });
  }
  return mapa;
}

export function guardarPermisoPermanenteDeCuenta(businessId: string, token: string): void {
  stmtGuardarPermisoPermanente.run(businessId, encryptMetaValue(token));
}

/** El permiso del login de esa cuenta. Sirve para generarle su permanente. */
export function permisoDeConexionDeLaCuenta(businessId: string): string | null {
  const fila = stmtGetMetaCuenta.get(businessId);
  return fila?.token_conexion ? decryptMetaValue(fila.token_conexion) || null : null;
}

/**
 * CON QUÉ PERMISO SE MIDEN LAS COMPRAS DE ESTA CUENTA. null = con el de siempre.
 *
 * Primero su permanente, que no caduca. Si no tiene: una cuenta `nueva` usa el de su
 * login; una `principal` devuelve null y mide como antes de que esto existiera.
 */
export function permisoDeMedicionDeLaCuenta(businessId: string): string | null {
  const fila = stmtGetMetaCuenta.get(businessId);
  if (!fila) return null;
  if (fila.token_permanente) return decryptMetaValue(fila.token_permanente) || null;
  if (fila.origen === "nueva" && fila.token_conexion) {
    return decryptMetaValue(fila.token_conexion) || null;
  }
  return null;
}

/** Para la pantalla: qué permiso tiene cada cuenta, SIN devolver ninguno. */
export function listPermisosDeCuentas(): Array<{
  id: string;
  origen: "principal" | "nueva";
  tienePermanente: boolean;
  tieneConexion: boolean;
}> {
  return stmtListMetaCuentas.all().map((f) => ({
    id: f.business_id,
    origen: f.origen === "nueva" ? "nueva" : "principal",
    tienePermanente: Boolean(f.token_permanente),
    tieneConexion: Boolean(f.token_conexion),
  }));
}

/** Todos los permisos guardados, para la lectura de anuncios (ROAS). */
export function permisosDeTodasLasCuentas(): Array<{ nombre: string; token: string }> {
  const lista: Array<{ nombre: string; token: string }> = [];
  for (const f of stmtListMetaCuentas.all()) {
    const nombre = f.business_name || f.business_id;
    for (const cifrado of [f.token_permanente, f.token_conexion]) {
      const token = cifrado ? decryptMetaValue(cifrado) : "";
      if (token) lista.push({ nombre: `cuenta ${nombre}`, token });
    }
  }
  return lista;
}

/** Keeps the editor list aligned with what the latest Meta authorization returned. */
export function reconcileMetaConnectSnapshot(input: {
  pageIds: string[];
  phoneNumberIds: string[];
}): void {
  const pageIds = new Set(input.pageIds);
  const phoneNumberIds = new Set(input.phoneNumberIds);
  const tx = db.transaction(() => {
    for (const connection of stmtListMetaConnections.all()) {
      if (pageIds.has(connection.page_id)) continue;
      if (getMetaRuntimeSetting("active_instagram_page_id") === connection.page_id) {
        stmtDeleteMetaRuntimeSetting.run("active_instagram_page_id");
      }
      stmtDeleteMetaConnection.run(connection.page_id);
    }
    for (const connection of stmtListMetaWhatsAppConnections.all()) {
      if (!phoneNumberIds.has(connection.phone_number_id)) {
        stmtDeleteMetaWhatsAppConnection.run(connection.phone_number_id);
      }
    }
  });
  tx();
}

const stmtMarkConvoRead = db.prepare<[number, number]>(
  "UPDATE conversations SET last_read_at = ?, manually_unread = 0 WHERE id = ?"
);
// Al marcar como NO LEÍDO manualmente (estilo WhatsApp): activamos el
// flag manually_unread = 1. NO tocamos last_read_at — los mensajes ya
// leídos siguen contados como leídos. Esto produce el "puntito sin
// número" en la UI cuando unread_count = 0.
const stmtMarkConvoUnread = db.prepare<[number]>(
  "UPDATE conversations SET manually_unread = 1 WHERE id = ?"
);

export function markConversationRead(conversationId: number): void {
  stmtMarkConvoRead.run(Math.floor(Date.now() / 1000), conversationId);
}

export function markConversationUnread(conversationId: number): void {
  stmtMarkConvoUnread.run(conversationId);
}

export default db;
