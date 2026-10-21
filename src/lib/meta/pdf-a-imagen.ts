/**
 * LA FOTO QUE VIENE DENTRO DE UN PDF.
 *
 * LO QUE PASÓ — 22 de septiembre de 2026
 *
 *   Una clienta pagó y mandó su comprobante como PDF. El bot lo rechazó:
 *
 *       comprobante REJECTED. Razón: el pago fue a "FLAVIO M.", pero debe
 *       coincidir con "Franco robles"
 *
 *   El comprobante decía FRANCO NICOLAS ROBLES. El dueño tuvo que cerrar esa
 *   venta a mano, y solo se arregló cuando él capturó la pantalla del PDF y se
 *   la mandó al bot como foto: aprobada al instante.
 *
 * POR QUÉ, CON LOS NÚMEROS DELANTE
 *
 *   En el registro, las dos lecturas del MISMO comprobante:
 *
 *       PDF   ->  prompt=501    -> rechazado
 *       foto  ->  prompt=2707   -> aprobado
 *
 *   Google lo documenta: «Each document page is equivalent to 258 tokens». Una
 *   página de PDF vale 258 tokens —un solo cuadro— mientras que una foto se
 *   trocea en varios, cada uno de 258. O sea: el lector ve el PDF con MUCHO
 *   menos detalle. Y con poco detalle, en un comprobante de fondo oscuro y letra
 *   fina, «FRANCO» se lee «FLAVIO».
 *
 *   Y ese techo no se levanta: la misma documentación dice que no hay «
 *   performance improvement for pages at higher resolution».
 *
 * POR QUÉ ESTE PDF NO TENÍA TEXTO QUE LEER
 *
 *   Se miró por dentro: 0 fuentes, 1 imagen, ni una letra seleccionable. No era
 *   un PDF de banco: era la captura del teléfono de la clienta guardada como
 *   PDF. Por eso no había texto que extraer y todo dependía de mirarlo.
 *
 * QUÉ HACE ESTO
 *
 *   Lo mismo que hizo el dueño a mano: saca la foto de dentro del PDF para que
 *   el lector la mire como una foto normal, con todo su detalle.
 *
 *   SIN NINGUNA LIBRERÍA. Un PDF guarda cada imagen como un flujo de bytes; si
 *   viene en JPEG ya es una foto tal cual, y si viene comprimida con zlib —el
 *   que trae Node— al descomprimirla quedan los píxeles, que se envuelven en un
 *   PNG a mano. Son cuatro trozos y un CRC.
 *
 * LAS SALIDAS, que son lo que impide que esto rompa nada
 *
 *   Devuelve `null` en cuanto algo no encaja: si el PDF no trae imágenes, si el
 *   filtro no es de los dos contemplados, si los bytes no cuadran con el tamaño
 *   declarado o si revienta al descomprimir. Quien llama sigue entonces por el
 *   camino de siempre —el PDF como archivo— exactamente igual que hasta hoy.
 *
 *   Y un PDF de banco CON texto dentro no pasa por aquí: para ésos el camino de
 *   hoy es el bueno, porque su texto se extrae exacto.
 */
import fs from "node:fs";
import zlib from "node:zlib";

/** La imagen más grande que se saca. Más allá no es un comprobante: es otra
 *  cosa, y no conviene metérsela al lector. */
const MAXIMO_PIXELES = 40_000_000;

const tablaCrc = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = tablaCrc[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function trozoPng(tipo: string, datos: Buffer): Buffer {
  const largo = Buffer.alloc(4);
  largo.writeUInt32BE(datos.length);
  const cuerpo = Buffer.concat([Buffer.from(tipo, "latin1"), datos]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(cuerpo));
  return Buffer.concat([largo, cuerpo, crc]);
}

/**
 * Píxeles en crudo → PNG.
 *
 * Cada fila del PNG lleva delante un byte que dice cómo está filtrada. Se manda
 * 0 —sin filtrar—, que es lo más simple: el archivo pesa algo más y no hay nada
 * que pueda salir mal al reconstruirlo.
 */
function envolverEnPng(
  pixeles: Buffer,
  ancho: number,
  alto: number,
  canales: 1 | 3
): Buffer {
  const porFila = ancho * canales;
  const conFiltro = Buffer.alloc((porFila + 1) * alto);
  for (let y = 0; y < alto; y++) {
    conFiltro[y * (porFila + 1)] = 0;
    pixeles.copy(
      conFiltro,
      y * (porFila + 1) + 1,
      y * porFila,
      (y + 1) * porFila
    );
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0);
  ihdr.writeUInt32BE(alto, 4);
  ihdr[8] = 8; // bits por canal
  ihdr[9] = canales === 3 ? 2 : 0; // 2 = color, 0 = gris
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    trozoPng("IHDR", ihdr),
    trozoPng("IDAT", zlib.deflateSync(conFiltro, { level: 6 })),
    trozoPng("IEND", Buffer.alloc(0)),
  ]);
}

export interface ImagenDelPdf {
  /** Los bytes de la foto, listos para enseñársela al lector. */
  bytes: Buffer;
  /** `image/jpeg` o `image/png`, según cómo viniera dentro. */
  mime: string;
  ancho: number;
  alto: number;
}

/**
 * Saca la imagen más grande que haya dentro de un PDF. `null` si no hay ninguna
 * que se pueda sacar con seguridad — y entonces el que llama sigue como hoy.
 */
export function imagenDentroDelPdf(rutaAbsoluta: string): ImagenDelPdf | null {
  let crudo: string;
  try {
    crudo = fs.readFileSync(rutaAbsoluta).toString("latin1");
  } catch {
    return null;
  }
  // SI TRAE TEXTO DE VERDAD, NO SE TOCA.
  //
  // Un PDF con fuentes es un comprobante de banco: su texto se extrae exacto y
  // gratis por el camino de siempre, que para ésos es mejor que mirarlo. Aquí
  // solo entran los que son una foto metida dentro.
  if (/\/Font\b/.test(crudo)) return null;

  let mejor: ImagenDelPdf | null = null;
  for (const [, cuerpo] of crudo.matchAll(/\d+ \d+ obj([\s\S]*?)endobj/g)) {
    if (!/\/Subtype\s*\/Image/.test(cuerpo)) continue;
    const ancho = Number((cuerpo.match(/\/Width\s+(\d+)/) ?? [])[1]);
    const alto = Number((cuerpo.match(/\/Height\s+(\d+)/) ?? [])[1]);
    if (!Number.isFinite(ancho) || !Number.isFinite(alto)) continue;
    if (ancho <= 0 || alto <= 0) continue;
    if (ancho * alto > MAXIMO_PIXELES) continue;
    const flujo = /stream\r?\n?([\s\S]*?)\r?\n?endstream/.exec(cuerpo);
    if (!flujo) continue;
    const datos = Buffer.from(flujo[1], "latin1");
    const filtro = (cuerpo.match(/\/Filter\s*\/(\w+)/) ?? [])[1];

    let candidata: ImagenDelPdf | null = null;
    if (filtro === "DCTDecode") {
      // Ya es un JPEG: se copia tal cual, sin recomprimir ni perder nada.
      candidata = { bytes: datos, mime: "image/jpeg", ancho, alto };
    } else if (filtro === "FlateDecode") {
      const bits = Number((cuerpo.match(/\/BitsPerComponent\s+(\d+)/) ?? [])[1]);
      const color = (cuerpo.match(/\/ColorSpace\s*\/?(\w+)/) ?? [])[1];
      // Solo lo que se sabe reconstruir sin inventar: 8 bits, color o gris.
      if (bits !== 8) continue;
      const canales: 1 | 3 | null =
        color === "DeviceRGB" ? 3 : color === "DeviceGray" ? 1 : null;
      if (!canales) continue;
      let pixeles: Buffer;
      try {
        pixeles = zlib.inflateSync(datos);
      } catch {
        continue;
      }
      // LOS BYTES TIENEN QUE CUADRAR CON EL TAMAÑO DECLARADO. Si no cuadran, el
      // flujo lleva algo más (otro filtro encadenado, predictores) y dibujarlo
      // daría una imagen rota. Mejor no tocarlo y seguir por el camino de hoy.
      if (pixeles.length !== ancho * alto * canales) continue;
      try {
        candidata = {
          bytes: envolverEnPng(pixeles, ancho, alto, canales),
          mime: "image/png",
          ancho,
          alto,
        };
      } catch {
        continue;
      }
    }
    if (!candidata) continue;
    // LA MÁS GRANDE GANA. Un comprobante puede traer el logo del banco como
    // segunda imagen; la que importa es la de más píxeles.
    if (!mejor || candidata.ancho * candidata.alto > mejor.ancho * mejor.alto) {
      mejor = candidata;
    }
  }
  return mejor;
}
