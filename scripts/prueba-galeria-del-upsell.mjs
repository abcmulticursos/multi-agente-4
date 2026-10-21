// El bot ofrecia el segundo producto y ensenaba la foto del primero.
//
// LO QUE PASO
//
// El bot presenta el producto extra. El cliente pregunta "¿que contiene?". Le
// llega la foto del producto que ACABA DE COMPRAR, con una invitacion a
// comprarlo otra vez.
//
// POR QUE
//
// El extra no tenia galeria propia, asi que la respuesta caia al modelo — y la
// unica galeria que el bot conocia era la del producto principal.
//
// Y no es un fallo raro: las palabras clave de esa galeria son "¿que trae?",
// "¿que incluye?" — exactamente lo que uno pregunta cuando le presentan algo
// nuevo. Asi que acierta siempre, y siempre con el producto equivocado.
//
// LAS TRES CORRECCIONES
//
//  1. Mientras el extra esta en oferta, la galeria disponible es LA SUYA. Si no
//     tiene, se devuelve vacia: mejor no mandar nada que mandar lo que ya
//     compro.
//  2. El bloqueo post-venta dejaba mudo al bot con una venta ABIERTA. Se abre
//     una excepcion mientras el extra esta ofrecido — segura, porque en ese
//     momento la galeria ya es la del extra.
//  3. El editor avisa cuando el extra no tiene con que responder. Nada lo decia.
//
//   node scripts/prueba-galeria-del-upsell.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");

const config = leer("src", "lib", "workflow", "config.ts");
const cerebro = leer("src", "lib", "openrouter.ts");
const handler = leer("src", "lib", "meta", "handler.ts");
const engine = leer("src", "lib", "workflow", "engine.ts");
const editor = leer("src", "app", "editor", "page.tsx");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// ── 1. La galería, mientras el extra está en oferta ─────────────────────────
comprobar(
  "la galería sabe si el extra está en oferta",
  /convo\?: \{ upsell_state\?: string \| null \} \| null/.test(config),
  "sí"
);
comprobar(
  // ESTE es el fallo. Sin esto vuelve a salir la foto del producto comprado.
  // Sale con SU nombre pegado a cada muestra —el segundo argumento— para que el
  // modelo sepa de qué producto es. Eso no cambia de qué galería tira.
  "en oferta, la galería es la del extra",
  /if \(enOferta\) \{\s*\r?\n\s*return normalizeGallery\(\s*\r?\n\s*seccionUpsell\(cfg\)\?\.image_gallery,/.test(
    config
  ),
  "la suya"
);
// LA REGLA SE VIGILA DONDE VIVE, no en todo el archivo.
//
// Antes se exigia que la cadena "seccionUpsell(cfg)?.image_gallery ??" no
// apareciera en NINGUNA parte de config.ts. Eso pasa de largo el objetivo: lo
// que no puede haber es un respaldo A OTRA GALERIA justo aqui, en la rama de la
// oferta. Escrito tan ancho, cualquier "?? []" legitimo en otra funcion —una
// lista vacia cuando no hay galeria— daba por rota una regla que seguia intacta.
const ramaEnOferta = (() => {
  const i = config.indexOf("if (enOferta) {");
  return i < 0 ? "" : config.slice(i, i + 320);
})();
comprobar(
  // Callar es correcto: mejor nada que el producto equivocado. Si aquí hubiera
  // un "?? la del principal", el fallo volvería tal cual.
  "sin galería propia, se devuelve vacía — sin caer a la del principal",
  /return normalizeGallery\(\s*\r?\n\s*seccionUpsell\(cfg\)\?\.image_gallery,/.test(
    ramaEnOferta
  ) && !/image_gallery\s*\?\?/.test(ramaEnOferta),
  "nada"
);
comprobar(
  "y fuera de la oferta todo sigue igual",
  /const base = normalizeGallery\(\s*\r?\n\s*cfg\?\.image_gallery,/.test(config),
  "intacto"
);

// ── 2. Todos los caminos que mandan media pasan la conversación ─────────────
//
// Son cuatro sitios distintos. Si uno se queda sin pasarla, por ahí se vuelve a
// colar la foto del producto comprado.
comprobar(
  "el buscador por palabras clave la pasa",
  (handler.match(/getImageGallery\(shouldHideOrderBumpSecondProduct\(fresh\), fresh\)/g) ??
    []).length === 2,
  "los dos sitios"
);
comprobar(
  "las muestras guiadas también",
  /getImageGallery\(shouldHideGuidedSecondProduct\(convo, config\), convo\)/.test(
    engine
  ),
  "sí"
);
comprobar(
  "y el modelo, en su lista de temas",
  /getImageGallery\(orderBumpHidden, convo\)/.test(cerebro),
  "sí"
);
comprobar(
  "y la herramienta que manda la media",
  /getImageGallery\(false, convo\)/.test(cerebro),
  "sí"
);

// ── 3. El bloqueo post-venta, con su excepción ──────────────────────────────
comprobar(
  // El bloqueo existe para que el bot no reinicie la venta tras comprar. Pero
  // con el extra ofrecido hay una venta ABIERTA, y callar deja al cliente
  // preguntando por algo que el propio bot acaba de presentarle.
  "el bloqueo post-venta hace excepción con el extra en oferta",
  /const extraEnOferta =\s*\r?\n\s*convo\.upsell_state === "ofrecido" \|\| convo\.upsell_state === "aceptado";/.test(
    cerebro
  ) && /if \(isPostSaleConversation && !extraEnOferta\) \{/.test(cerebro),
  "sí"
);
comprobar(
  "y sigue bloqueando cuando no hay oferta abierta",
  /post_sale_content_blocked/.test(cerebro),
  "intacto"
);

// ── 4. Que no le invite a comprar lo que ya compró ──────────────────────────
comprobar(
  "se le prohíbe volver a ofrecer el primer producto",
  /NEVER offer, describe or invite them to buy the FIRST product again/.test(
    cerebro
  ),
  "prohibido"
);
comprobar(
  // "¿que contiene?" tras presentar algo nuevo se refiere a lo NUEVO. Sin esto
  // el modelo contesta por el producto que ya tiene.
  "y se le dice a qué producto se refiere la pregunta",
  /they mean "\$\{nombreExtra\}", not what they already bought/.test(cerebro),
  "al nuevo"
);

// ── 5. El editor avisa antes de que pase ────────────────────────────────────
comprobar(
  "avisa si el extra no tiene con qué responder",
  /Este producto no tiene con qué responder\./.test(editor),
  "en amarillo"
);
comprobar(
  "y dice exactamente qué pasaría",
  /termina enseñando\s*\r?\n\s*el producto que ya compró/.test(editor),
  "claro"
);
comprobar(
  "cuenta las tres formas de responder que tiene",
  /const conFoto = \(cfg\.upsell\?\.image_gallery \?\? \[\]\)/.test(editor) &&
    /const burbujas = \(cfg\.upsell\?\.info_steps \?\? \[\]\)/.test(editor) &&
    /const generica = \(cfg\.upsell\?\.respuesta_generica \?\? ""\)\.trim\(\);/.test(
      editor
    ),
  "galería, burbujas, genérica"
);
comprobar(
  // Una foto sin enlace no sirve de nada, y era justo lo que habia.
  "una foto sin enlace no cuenta como galería",
  /g\.enabled !== false && g\.drive_url\?\.trim\(\)/.test(editor),
  "no cuenta"
);

console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} comprobación(es) mal.`);
process.exit(fallos === 0 ? 0 : 1);
