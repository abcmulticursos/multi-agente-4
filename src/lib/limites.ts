/**
 * NINGUNA ESPERA ES ETERNA (05/11/2026). Su caso: «a veces cuando grabo un cambio… se traba… los seguimientos
 * que correspondían en ese tiempo no salen» y en el simulador el aviso rojo «not valid JSON».
 *
 * Ninguna llamada del bot hacia afuera (Meta, Messenger, Instagram, Drive, GitHub, Telegram, NocoDB, Groq) tenía
 * tiempo máximo: si el otro lado no contestaba, el bot esperaba minutos, y el obrero —que atendía lo programado de
 * uno en uno— dejaba a TODOS los clientes sin sus seguimientos. Ahora cada `fetch` lleva su límite; al pasarlo
 * falla como cualquier error de red, y lo que ya manejaba ese error sigue igual.
 *
 * NO envolver el `fetch` global: el 28/10 envolverlo dejó al bot mudo. Se pone llamada por llamada.
 */

/** Una consulta o un mensaje: Meta contesta en 1–2 s; 30 s ya es una caída. */
export const LIMITE_CONSULTA_MS = 30_000;

/** Subir o bajar un archivo (videos, PDF, audios, el contenido a GitHub). */
export const LIMITE_ARCHIVO_MS = 180_000;

/** La IA (OpenRouter): una respuesta larga tarda ~20 s; el SDK reintenta solo si se pasa. */
export const LIMITE_IA_MS = 60_000;
