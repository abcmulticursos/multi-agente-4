export const DEFAULT_SAMPLES_AFTER_TEXT =
  "¿Deseas que te indique cómo adquirirlo?";

/**
 * Textos de ARRANQUE de las burbujas que llevan botones.
 *
 * Se usan SOLO al abrir el editor y SOLO cuando el campo todavía no existe en
 * la configuración, para que llegue relleno y editable en vez de en blanco.
 *
 * El motor NO los usa nunca. Si un campo está vacío, el bot no manda esa
 * burbuja: vacío significa APAGADO. Así ningún texto de aquí puede llegarle a
 * un cliente sin que alguien lo haya escrito antes en el editor.
 */
export const DEFAULT_PAYMENT_BUTTONS_PROMPT =
  "Puedes elegir tu método de pago 👇";
export const DEFAULT_CHOICE_PROMPT = "Elige tu opción 👇";
export const DEFAULT_CHOICE_BUTTONS_PROMPT = "¿Qué opción prefieres?";
export const DEFAULT_BIOFERTA_ASK_CHOICE_TEXT = "¿Cuál compraste?";
export const DEFAULT_BIOFERTA_INTRO_CHOICE_PROMPT = "¿Cuál te llevas? 👇";
export const DEFAULT_DELIVERY_PREFERENCE_PROMPT =
  "Pago aprobado 😊\n\n¿Deseas recibir tu producto solo por WhatsApp o también por correo?";
export const DEFAULT_DELIVERY_PREFERENCE_BUTTONS_PROMPT = "Elige una opción:";
export const DEFAULT_DELIVERY_WHATSAPP_LABEL = "Solo WhatsApp";
export const DEFAULT_DELIVERY_EMAIL_LABEL = "WhatsApp + correo";
export const DEFAULT_ROUTE_B_POST_PAYMENT_PROMPT =
  "Elige una opción para continuar:";
/** Lo que se le dice a quien se va a bloquear por moderación. Vaciarlo hace
 *  que el bloqueo sea silencioso. */
export const DEFAULT_MODERACION_DESPEDIDA =
  "Lo siento mucho, la gerencia ha decidido no atenderlo. Ya no envíe más mensajes ni pagos. Que tenga un excelente día.";
