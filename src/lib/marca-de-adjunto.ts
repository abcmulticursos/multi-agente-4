/**
 * LA MARCA INTERNA DE UN ADJUNTO, Y CÓMO NO CONFUNDIRLA CON UN PIE DE FOTO.
 *
 * Cada mensaje guarda un texto. Cuando lo que se manda es una imagen, un audio
 * o un video SIN texto que lo acompañe, ese campo no puede quedar vacío, así
 * que se le escribe una marca: "[imagen]", "[video]"…
 *
 * Es de uso interno. Nunca se le manda a nadie —a WhatsApp se le pasa el pie de
 * foto de verdad, o ninguno— y en pantalla no debería verse.
 *
 * PERO SE VEÍA. Y por un motivo tonto: había DOS marcas para lo mismo. Lo que
 * manda el cliente se guardaba en español ("[imagen]") y lo que manda el bot en
 * inglés, porque se armaba pegando el tipo interno —`[${kind}]`— que está en
 * inglés. La pantalla solo conocía la española, así que una imagen del bot sin
 * pie de foto llegaba con "[image]" y la pantalla concluía que ESO era un pie
 * de foto de verdad y lo pintaba debajo.
 *
 * El video se salvaba por casualidad: se escribe igual en los dos idiomas.
 *
 * Aquí viven las dos formas juntas, para que ningún lado tenga que acordarse de
 * la otra. Y se reconocen las dos aunque solo se escriba una: las filas ya
 * guardadas con la marca vieja siguen existiendo, y arreglar solo el que
 * escribe no las limpiaría.
 */

/** Todo lo que alguna vez se ha escrito como marca de adjunto sin texto. */
const MARCAS = new Set([
  "[imagen]",
  "[image]",
  "[video]",
  "[audio]",
  "[documento]",
  "[document]",
  "[archivo]",
  "[file]",
  "[mensaje]",
]);

/**
 * ¿Este texto es solo la marca interna del adjunto?
 *
 * Se compara la cadena ENTERA, no un trozo: un pie de foto que empiece con algo
 * entre corchetes ("[OFERTA] mira esto") es texto escrito por una persona y
 * tiene que seguir viéndose.
 */
export function esMarcaDeAdjunto(texto: string | null | undefined): boolean {
  return MARCAS.has((texto ?? "").trim().toLowerCase());
}

/**
 * El pie de foto de verdad, o "" si lo que hay es solo la marca interna.
 * Quien pinta la burbuja pregunta por aquí en vez de comparar a mano.
 */
export function pieDeFotoReal(texto: string | null | undefined): string {
  const limpio = (texto ?? "").trim();
  return esMarcaDeAdjunto(limpio) ? "" : limpio;
}

/**
 * La marca que se escribe al guardar un adjunto sin texto. Siempre en español,
 * que es la forma que ya tenían las filas del cliente.
 */
export function marcaDeAdjunto(tipo: string): string {
  const enEspanol: Record<string, string> = {
    image: "imagen",
    document: "documento",
    file: "archivo",
  };
  return `[${enEspanol[tipo] ?? tipo}]`;
}
