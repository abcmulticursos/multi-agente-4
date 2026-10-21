/**
 * IMPORTAR EL SEGUNDO PRODUCTO DEL UPSELL desde cualquier producto de otra
 * modalidad.
 *
 * Es una COPIA, no un préstamo: el texto se duplica dentro de la sección del
 * upsell y desde ahí se edita. La modalidad de origen no se toca ni se vuelve
 * a leer nunca — eso sería servir contenido de otra modalidad, que es lo
 * prohibido (regla 5-bis del protocolo).
 *
 * Vive aparte del editor, sin React ni JSX, por una razón concreta: así se
 * puede probar que cada producto cae donde debe. Un error aquí es servirle a
 * la clienta el curso equivocado, así que conviene poder comprobarlo.
 */

/** Los campos que se leen del origen. Cualquier configuración del editor que
 *  los tenga sirve — por eso se describen aquí y no se importa el tipo gordo. */
export interface ConfigDeOrigen {
  product_name?: string;
  payment_approved?: unknown[];
  image_gallery?: unknown[];
  image_gallery_2?: unknown[];
  pack_gallery?: unknown[];
  globals: { course_price_soles: number };
  order_bump: {
    combo: OpcionDeDosNiveles;
    basico: OpcionDeDosNiveles;
  };
  doble_oferta_dos: {
    combo: OpcionDeDosNiveles;
    basico: OpcionDeDosNiveles;
  };
  bioferta: {
    pack_price_soles: number;
    pack_discount_price_soles?: number;
    product_a: ProductoDeBioferta;
    product_b: ProductoDeBioferta;
    pack: ProductoDeBioferta;
  };
  modality_templates?: Record<string, PlantillaDeOrigen | undefined>;
}

interface OpcionDeDosNiveles {
  name: string;
  aliases?: string[];
  price_soles: number;
  discount_price_soles?: number;
  delivery?: unknown[];
}

interface ProductoDeBioferta {
  name: string;
  aliases?: string[];
  delivery?: unknown[];
}

/** La plantilla de una modalidad guarda lo suyo con la misma forma. */
interface PlantillaDeOrigen {
  product_name?: string;
  payment_approved?: unknown[];
  image_gallery?: unknown[];
  image_gallery_2?: unknown[];
  pack_gallery?: unknown[];
  globals?: { course_price_soles?: number };
  order_bump?: ConfigDeOrigen["order_bump"];
  doble_oferta_dos?: ConfigDeOrigen["doble_oferta_dos"];
  bioferta?: ConfigDeOrigen["bioferta"];
}

export interface FuenteProducto {
  clave: string;
  /** La modalidad de la que sale, para leer su plantilla. */
  modalidad: string;
  etiqueta: string;
}

/** Un producto por entrada: así se elige EXACTAMENTE cuál copiar. */
export const FUENTES_SEGUNDO_PRODUCTO: FuenteProducto[] = [
  { clave: "lineal:unico", modalidad: "lineal", etiqueta: "Lineal · su producto" },
  { clave: "order_bump:basico", modalidad: "order_bump", etiqueta: "Order Bump · Básico" },
  { clave: "order_bump:combo", modalidad: "order_bump", etiqueta: "Order Bump · Combo" },
  { clave: "bioferta:a", modalidad: "bioferta", etiqueta: "Doble Oferta · Producto 1" },
  { clave: "bioferta:b", modalidad: "bioferta", etiqueta: "Doble Oferta · Producto 2" },
  { clave: "bioferta:pack", modalidad: "bioferta", etiqueta: "Doble Oferta · Pack" },
  { clave: "doble_oferta_dos:combo", modalidad: "doble_oferta_dos", etiqueta: "Doble Oferta 2 · Producto 1" },
  { clave: "doble_oferta_dos:basico", modalidad: "doble_oferta_dos", etiqueta: "Doble Oferta 2 · Producto 2" },
];

/**
 * A DÓNDE puede caer lo copiado, según la modalidad que se esté editando.
 *
 * Solo se listan los huecos que hoy no se pueden llenar de otra forma. El
 * Producto 1 / base de cada modalidad no está aquí porque ya lo cubre el otro
 * importador, el que trae la conversación entera (intro, seguimientos,
 * contenido…) y no solo el producto.
 */
export interface DestinoProducto {
  clave: string;
  /** La modalidad que hay que estar editando para que este destino exista. */
  modalidad: string;
  etiqueta: string;
  /** Qué NO se puede copiar aquí, para decírselo antes y no por sorpresa. */
  advertencia?: string;
}

export const DESTINOS_PRODUCTO: DestinoProducto[] = [
  {
    clave: "order_bump:combo",
    modalidad: "order_bump",
    etiqueta: "Combo / Mega Pack",
  },
  {
    clave: "bioferta:b",
    modalidad: "bioferta",
    etiqueta: "Producto 2",
    // En Doble Oferta los dos productos valen lo mismo: el precio individual es
    // uno solo y vive en Precios y pagos, no en cada producto.
    advertencia:
      "el precio no se copia: en Doble Oferta los dos productos comparten el precio individual",
  },
  {
    clave: "bioferta:pack",
    modalidad: "bioferta",
    etiqueta: "Pack (los 2 juntos)",
  },
  {
    clave: "doble_oferta_dos:basico",
    modalidad: "doble_oferta_dos",
    etiqueta: "Producto 2",
  },
  {
    clave: "upsell:segundo",
    modalidad: "upsell",
    etiqueta: "Segundo producto (el que se ofrece tras entregar)",
  },
];

export function destinosDeModalidad(modalidad: string): DestinoProducto[] {
  return DESTINOS_PRODUCTO.filter((d) => d.modalidad === modalidad);
}

/** Lo que se copia de un producto. Vacío = el origen no lo tenía. */
export interface ProductoImportado {
  name: string;
  aliases: string[];
  price_soles: number;
  discount_price_soles: number;
  delivery: unknown[];
  image_gallery: unknown[];
}

export function leerProductoDeOrigen(
  cfg: ConfigDeOrigen,
  clave: string
): ProductoImportado | null {
  const fuente = FUENTES_SEGUNDO_PRODUCTO.find((f) => f.clave === clave);
  if (!fuente) return null;

  // La modalidad de origen guarda lo suyo en su plantilla; si todavía no tiene
  // una, se cae al top-level. Es el mismo patrón que usa el resto del editor.
  const tpl = cfg.modality_templates?.[fuente.modalidad] ?? {};
  const galeria1 = tpl.image_gallery ?? cfg.image_gallery ?? [];
  const galeria2 = tpl.image_gallery_2 ?? cfg.image_gallery_2 ?? [];
  const galeriaPack = tpl.pack_gallery ?? cfg.pack_gallery ?? [];
  const precioBase =
    tpl.globals?.course_price_soles ?? cfg.globals.course_price_soles;
  const ob = tpl.order_bump ?? cfg.order_bump;
  const dd = tpl.doble_oferta_dos ?? cfg.doble_oferta_dos;
  const bf = tpl.bioferta ?? cfg.bioferta;

  const deDosNiveles = (
    opcion: OpcionDeDosNiveles,
    galeria: unknown[]
  ): ProductoImportado => ({
    name: opcion.name ?? "",
    aliases: opcion.aliases ?? [],
    price_soles: opcion.price_soles ?? 0,
    discount_price_soles: opcion.discount_price_soles ?? 0,
    delivery: opcion.delivery ?? [],
    image_gallery: galeria,
  });

  switch (clave) {
    case "lineal:unico":
      return {
        name: tpl.product_name ?? cfg.product_name ?? "",
        aliases: [],
        price_soles: precioBase,
        discount_price_soles: 0,
        delivery: tpl.payment_approved ?? cfg.payment_approved ?? [],
        image_gallery: galeria1,
      };
    case "order_bump:basico":
      return deDosNiveles(ob.basico, galeria1);
    case "order_bump:combo":
      return deDosNiveles(ob.combo, galeria2);
    // En Doble Oferta 2, "combo" es el Producto 1 y "basico" el Producto 2.
    case "doble_oferta_dos:combo":
      return deDosNiveles(dd.combo, galeria1);
    case "doble_oferta_dos:basico":
      return deDosNiveles(dd.basico, galeria2);
    case "bioferta:a":
      return {
        name: bf.product_a.name ?? "",
        aliases: bf.product_a.aliases ?? [],
        price_soles: precioBase,
        discount_price_soles: 0,
        // El Producto 1 de la Doble Oferta entrega por el camino central si no
        // definió el suyo — la misma regla que aplica el motor.
        delivery: bf.product_a.delivery?.length
          ? bf.product_a.delivery
          : tpl.payment_approved ?? cfg.payment_approved ?? [],
        image_gallery: galeria1,
      };
    case "bioferta:b":
      return {
        name: bf.product_b.name ?? "",
        aliases: bf.product_b.aliases ?? [],
        price_soles: precioBase,
        discount_price_soles: 0,
        delivery: bf.product_b.delivery ?? [],
        image_gallery: galeria2,
      };
    case "bioferta:pack":
      return {
        name: bf.pack.name ?? "",
        aliases: bf.pack.aliases ?? [],
        price_soles: bf.pack_price_soles ?? 0,
        discount_price_soles: bf.pack_discount_price_soles ?? 0,
        delivery: bf.pack.delivery ?? [],
        image_gallery: galeriaPack,
      };
    default:
      return null;
  }
}

/** La configuración vista desde el lado de ESCRIBIR: los huecos que se llenan. */
export interface ConfigDestino {
  image_gallery_2?: unknown[];
  pack_gallery?: unknown[];
  order_bump: { combo: OpcionDeDosNiveles; basico: OpcionDeDosNiveles };
  doble_oferta_dos: { combo: OpcionDeDosNiveles; basico: OpcionDeDosNiveles };
  bioferta: {
    pack_price_soles: number;
    pack_discount_price_soles?: number;
    product_a: ProductoDeBioferta;
    product_b: ProductoDeBioferta;
    pack: ProductoDeBioferta;
  };
  upsell?: {
    name?: string;
    aliases?: string[];
    price_soles?: number;
    discount_price_soles?: number;
    delivery?: unknown[];
    image_gallery?: unknown[];
  };
}

/**
 * Deja el producto copiado en el hueco elegido y devuelve la configuración
 * nueva. No modifica la que recibe.
 *
 * Cada destino escribe en SU caja y en ninguna otra: ese es el punto entero de
 * esta función y lo que comprueban las pruebas. Equivocar la caja significa
 * entregarle a la clienta el curso que no compró.
 *
 * Devuelve null si el destino no existe.
 */
export function aplicarProductoEnDestino<C extends ConfigDestino>(
  cfg: C,
  destinoClave: string,
  traido: ProductoImportado
): C | null {
  if (!DESTINOS_PRODUCTO.some((d) => d.clave === destinoClave)) return null;

  // Los tipos de los pasos y de las imágenes viven en el editor, no aquí: se
  // construye el objeto y se devuelve con la forma que entró.
  const comoEntro = (valor: unknown) => valor as never;

  const dosNiveles = () => ({
    name: traido.name,
    aliases: traido.aliases,
    price_soles: traido.price_soles,
    discount_price_soles: traido.discount_price_soles,
    delivery: comoEntro(traido.delivery),
  });

  switch (destinoClave) {
    case "order_bump:combo":
      return {
        ...cfg,
        order_bump: {
          ...cfg.order_bump,
          combo: { ...cfg.order_bump.combo, ...dosNiveles() },
        },
        image_gallery_2: comoEntro(traido.image_gallery),
      };
    case "doble_oferta_dos:basico":
      return {
        ...cfg,
        doble_oferta_dos: {
          ...cfg.doble_oferta_dos,
          basico: { ...cfg.doble_oferta_dos.basico, ...dosNiveles() },
        },
        image_gallery_2: comoEntro(traido.image_gallery),
      };
    case "bioferta:b":
      // Sin precio a propósito: en Doble Oferta el precio individual es uno
      // solo para los dos productos y vive en Precios y pagos.
      return {
        ...cfg,
        bioferta: {
          ...cfg.bioferta,
          product_b: {
            ...cfg.bioferta.product_b,
            name: traido.name,
            aliases: traido.aliases,
            delivery: comoEntro(traido.delivery),
          },
        },
        image_gallery_2: comoEntro(traido.image_gallery),
      };
    case "bioferta:pack":
      return {
        ...cfg,
        bioferta: {
          ...cfg.bioferta,
          pack_price_soles: traido.price_soles,
          pack_discount_price_soles: traido.discount_price_soles,
          pack: {
            ...cfg.bioferta.pack,
            name: traido.name,
            aliases: traido.aliases,
            delivery: comoEntro(traido.delivery),
          },
        },
        pack_gallery: comoEntro(traido.image_gallery),
      };
    case "upsell:segundo":
      return {
        ...cfg,
        upsell: {
          ...cfg.upsell,
          name: traido.name,
          aliases: traido.aliases,
          price_soles: traido.price_soles,
          discount_price_soles: traido.discount_price_soles,
          delivery: traido.delivery,
          image_gallery: traido.image_gallery,
        },
      };
    default:
      return null;
  }
}
