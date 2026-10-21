/**
 * MODERACIÓN — reconoce dos tipos de mensaje que solo queman tokens:
 *
 *   1. PIROPOS: el que entra a enamorar al bot en vez de a comprar.
 *   2. BASURA DE TECLADO: "xxxxxxx", "qafjasofdu3", teclas al azar.
 *
 * Todo se decide con reglas fijas, SIN llamar al modelo. Usar la IA para
 * detectar a quien no queremos pagarle IA no tendría ningún sentido.
 *
 * El sesgo de este archivo es deliberado: ante la duda, NO acusa. Bloquear a
 * una clienta de verdad cuesta muchísimo más que aguantarle tres mensajes a un
 * pesado. Por eso hay una señal comercial que lo desactiva todo, y por eso
 * hacen falta varios mensajes seguidos y no uno.
 */

/** Minúsculas y sin tildes, para que "estás preciosa" y "estas preciosa"
 *  se traten igual. */
function normalizar(texto: string): string {
  return (texto ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "");
}

/**
 * FRENO MAESTRO. Si el mensaje menciona cualquier cosa del negocio, no se
 * acusa aunque venga acompañado de un piropo. Un "hola preciosa, cuánto
 * cuesta el kit" es una venta, no un acoso.
 */
const SENAL_COMERCIAL =
  /\b(precio|precios|costo|cuesta|cuanto|vale|valor|pagar|pago|pague|pagado|comprar|compra|compre|yape|yapear|plin|bcp|transferencia|transferir|deposito|depositar|comprobante|voucher|recibo|curso|kit|pack|combo|producto|material|clase|clases|enlace|link|acceso|descarga|descargar|entrega|entregar|envio|enviar|pdf|factura|boleta|tarjeta|efectivo|promocion|oferta|descuento|informacion|informes|catalogo|contenido|incluye|sirve|funciona|edad|edades|nino|nina|hijo|hija|peque)\b/;

export function tieneSenalComercial(texto: string): boolean {
  return SENAL_COMERCIAL.test(normalizar(texto));
}

/**
 * PIROPOS. Solo frases dirigidas A UNA PERSONA, nunca adjetivos sueltos:
 * "qué bonito el kit" o "me encanta" son de clienta contenta y no deben
 * caer aquí jamás.
 */
const PATRONES_PIROPO: RegExp[] = [
  // "eres/estás (muy) hermosa" — el pronombre es lo que lo hace personal.
  /\b(eres|sos|estas)\s+(muy\s+|bien\s+|super\s+|tan\s+|re\s+)?(hermosa|hermoso|preciosa|precioso|bella|bello|linda|lindo|guapa|guapo|bonita|bonito|sexy|rica|rico|churra|regia)\b/,
  /\bque\s+(hermosa|preciosa|bella|linda|guapa|bonita)\s+(eres|estas|sos)\b/,
  // Declaraciones. "te quiero" se excluye si sigue un verbo ("te quiero
  // preguntar", "te quiero comprar"), que es lo que dice una clienta.
  /\bte\s+(amo|adoro|amoo+)\b/,
  /\bte\s+quiero\b(?!\s+(preguntar|consultar|comprar|pedir|hacer|decir|saber|ver|mostrar|enviar|mandar|escribir|contar|comentar))/,
  /\bme\s+(gustas|encantas|fascinas)\b/,
  /\b(estoy|ando)\s+enamorad[oa]\b/,
  // Pedir contacto personal.
  /\b(dame|pasame|damelo|regalame)\s+(tu|el)\s+(numero|whatsapp|wasap|wsp|face|facebook|instagram|insta|tiktok)\b/,
  /\bte\s+dejo\s+mi\s+(numero|whatsapp|wasap|wsp)\b/,
  /\b(llamame|marcame|escribeme)\b(?!\s+(cuando|si|para|al respecto))/,
  // Citas y romance.
  /\b(quiero|quisiera|me gustaria)\s+conocerte\b/,
  /\b(salgamos|una cita|ser mi novia|ser mi novio|casarme contigo|mi amor|mi vida|mi reina|mi cielo)\b/,
];

export function esPiropo(texto: string): boolean {
  const t = normalizar(texto);
  if (!t.trim()) return false;
  return PATRONES_PIROPO.some((patron) => patron.test(t));
}

/**
 * BASURA DE TECLADO. Se mira PALABRA por palabra, no el mensaje entero: por
 * eso "hola.como.estas.quiero.saber" pasa limpio — son cinco palabras reales
 * separadas por puntos, y los puntos no se miran.
 */
/** Filas del teclado. Teclear de corrido por una fila —"qwerty", "asdfgh",
 *  "hjkl"— es la firma de quien pasa el dedo por encima. */
const FILAS_TECLADO = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];

function tieneRachaDeTeclado(palabra: string): boolean {
  for (let i = 0; i + 4 <= palabra.length; i++) {
    const trozo = palabra.slice(i, i + 4);
    const alReves = trozo.split("").reverse().join("");
    if (FILAS_TECLADO.some((f) => f.includes(trozo) || f.includes(alReves))) {
      return true;
    }
  }
  return false;
}

/** Sílabas que SÍ se repiten de verdad y no son basura: la risa, sobre todo.
 *  Sin esto, "jajajaja" caería como grupo repetido y sería un desastre. */
const SILABAS_REALES = new Set([
  "ja", "je", "ji", "jo", "ju", "ha", "he", "hi", "ho",
  "aj", "eh", "ah", "oh", "mm", "hm", "si", "no", "xd", "ay",
  "jaja", "jeje", "jiji", "haha", "hehe",
]);

/** ¿La palabra es solo una sílaba real repetida? "jajaja", "xdxdxd". */
function esSilabaRepetida(palabra: string): boolean {
  for (const s of SILABAS_REALES) {
    if (
      s.length >= 2 &&
      palabra.length % s.length === 0 &&
      palabra === s.repeat(palabra.length / s.length)
    ) {
      return true;
    }
  }
  return false;
}

function esPalabraImposible(palabra: string): boolean {
  // UNA sola letra repetida seis veces o más: "xxxxxx", "zzzzzzz".
  if (/^(.)\1{5,}$/.test(palabra)) return true;
  // Una sílaba real repetida no es basura, por larga que sea.
  if (esSilabaRepetida(palabra)) return false;

  // ESTIRAR LETRAS ES NORMAL AL ESCRIBIR: "siiii", "holaaa", "graciasss",
  // "noooo", "aaaah". Antes de juzgar nada, las rachas se recortan a dos.
  // Sin este paso el detector confundía énfasis con basura, que es
  // exactamente el error que no nos podemos permitir.
  const p = palabra.replace(/(.)\1+/g, "$1$1");
  if (p.length < 4) return false;

  // Sin una sola vocal: "qwrtp", "xkcdf", "hjkl".
  if (!/[aeiou]/.test(p)) return true;
  // Cinco consonantes seguidas: no existe en español.
  if (/[bcdfghjklmnpqrstvwxyz]{5,}/.test(p)) return true;
  // "q" que no va seguida de "u". En español no existe: qa, qe, qi, qo.
  if (/q(?!u)/.test(p)) return true;
  // Cuatro teclas seguidas de una fila del teclado.
  if (tieneRachaDeTeclado(p)) return true;
  // Un grupo de 2 a 4 letras repetido tres veces o más: "asdasdasd".
  const repetido = p.match(/^(.{2,4})\1{2,}$/);
  if (repetido && !SILABAS_REALES.has(repetido[1])) return true;
  return false;
}

export function esBasuraDeTeclado(texto: string): boolean {
  // Fuera emojis y signos: un mensaje de puros emojis no es basura.
  const limpio = normalizar(texto).replace(/[^a-z0-9\s]/g, " ");
  const palabras = limpio.split(/\s+/).filter((p) => p.length > 0);
  if (palabras.length === 0) return false;
  // Con menos de 4 letras en total no hay nada que juzgar ("ok", "si", "1").
  const letras = palabras.join("").replace(/[0-9]/g, "").length;
  if (letras < 4) return false;
  const imposibles = palabras.filter(esPalabraImposible).length;
  // Más de la mitad de las palabras tienen que ser imposibles. Una sola
  // palabra rara en una frase normal no cuenta: puede ser una marca, un
  // nombre propio o un dedazo.
  return imposibles / palabras.length > 0.5;
}

export type TipoDeAbuso = "piropo" | "basura";

/**
 * Clasifica un mensaje entrante. Devuelve null —lo normal— si no hay nada que
 * reprochar, o si el mensaje menciona algo del negocio.
 */
export function clasificarAbuso(texto: string): TipoDeAbuso | null {
  if (!texto?.trim()) return null;
  if (tieneSenalComercial(texto)) return null;
  if (esBasuraDeTeclado(texto)) return "basura";
  if (esPiropo(texto)) return "piropo";
  return null;
}

/** Estados en los que la venta ya ocurrió o está ocurriendo. Aquí NO se
 *  modera nunca: una clienta contenta escribe "te amo, gracias" al recibir su
 *  material, y bloquearla sería el peor error posible. */
const ESTADOS_INTOCABLES = new Set([
  "payment_done",
  "payment_approved",
  "awaiting_delivery_preference",
  "awaiting_email",
  "awaiting_gift_consent",
  "awaiting_facebook_comment",
  "awaiting_order_bump_choice",
  "awaiting_order_bump_payment_choice",
  "awaiting_post_payment_order_bump_choice",
  "awaiting_bioferta_choice",
  "awaiting_bioferta_intro_choice",
  "awaiting_doble_oferta_dos_choice",
]);

/**
 * Decide qué hacer con un mensaje entrante. Devuelve el tipo de abuso SOLO si
 * pasa todos los frenos; en cualquier otro caso, null y el bot sigue su curso
 * normal.
 */
export function evaluarModeracion(params: {
  texto: string;
  estado: string | null;
  yaPago: boolean;
  piroposActivo: boolean;
  basuraActivo: boolean;
}): TipoDeAbuso | null {
  const { texto, estado, yaPago, piroposActivo, basuraActivo } = params;
  // Con los dos interruptores apagados esto no hace absolutamente nada.
  if (!piroposActivo && !basuraActivo) return null;
  // Quien ya pagó no se modera jamás.
  if (yaPago) return null;
  if (estado && ESTADOS_INTOCABLES.has(estado)) return null;
  const tipo = clasificarAbuso(texto);
  if (!tipo) return null;
  if (tipo === "piropo" && !piroposActivo) return null;
  if (tipo === "basura" && !basuraActivo) return null;
  return tipo;
}
