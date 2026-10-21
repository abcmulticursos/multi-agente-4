// El segundo producto puede explicarse solo.
//
// DE DONDE SALE
//
//   Vendió, entregó, y el bot ofreció el extra con sus botones. El cliente
//   escribió «este es otro, no entiendo» y el bot contestó que es «un material
//   adicional... totalmente opcional. No tiene que ver con lo que ya compraste»,
//   y cerró preguntando por el producto que YA le había vendido.
//
//   No fue torpeza del modelo. De FLORCITAS AMARILLAS solo tenía el NOMBRE y el
//   PRECIO. Nada más. No podía decir qué es, así que explicó lo que no es.
//
// LA CAUSA
//
//   El campo «Contenido del curso y cómo se estudia» del extra lo escribe el
//   editor y NO LO LEE NADIE. Ni el motor, ni el cerebro, ni ninguna
//   herramienta — en NINGUNA de las seis modalidades. Su propio rótulo promete
//   «el bot lo usa cuando preguntan», y era falso.
//
//   El extra era el ÚNICO producto del bot sin manera de explicarse:
//
//     Producto 1 (cualquier modalidad) → course_content ....... sí llegaba
//     Producto 2 (Doble Oferta)        → course_content_2 ..... sí llegaba
//     Producto 2 (Doble Oferta 2 Prod) → course_content_2 ..... sí llegaba
//     Order Bump (sus dos opciones)    → herramienta .......... sí llegaba
//     EL EXTRA DEL UPSELL              → course_content ....... NUNCA
//
//   Y de paso: `isPostSale` cierra los candados de contenido y muestras porque
//   el cliente ya compró. Pero el extra se ofrece justo ahí, así que el bot
//   tampoco sabía que el extra TIENE muestras configuradas.
//
//   node scripts/prueba-el-extra-puede-explicarse.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const cerebro = readFileSync(join(RAIZ, "src", "lib", "openrouter.ts"), "utf8");
const config = readFileSync(
  join(RAIZ, "src", "lib", "workflow", "config.ts"),
  "utf8"
);

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 62)} ${valor}`);
};

// ── 1. El contenido del extra llega al cerebro ───────────────────────────────
comprobar(
  "el contenido del extra se lee de su propia sección",
  /const contenidoExtra = extra\?\.course_content\?\.trim\(\);/.test(cerebro),
  "ya no es letra muerta"
);
comprobar(
  "y se le entrega como fuente autoritativa",
  /SECOND-SALE PRODUCT CONTENT — "\$\{nombreExtra\}"/.test(cerebro),
  "para decir qué ES"
);
// NO PUEDE MEZCLARSE CON EL PRODUCTO YA COMPRADO. Es la regla 5-bis aplicada al
// texto: describir el extra con el contenido del primero seria venderle otra vez
// lo que ya tiene.
comprobar(
  "sin mezclarlo nunca con lo que el cliente ya compró",
  /never mix it with the product they already bought/.test(cerebro),
  "cada producto, lo suyo"
);
// VA SIEMPRE MIENTRAS SE OFRECE, SIN CANDADO DE PALABRAS CLAVE.
//
// El candado es justo lo que fallo: «este es otro, no entiendo» no se parece a
// ninguna palabra de contenido, y era EL turno donde hacia falta.
comprobar(
  "va siempre mientras el extra está en oferta",
  /\$\{\s*\r?\n\s*contenidoExtra\s*\r?\n\s*\? `\\n\\nSECOND-SALE PRODUCT CONTENT/.test(
    cerebro
  ) &&
    !/currentTurnNeeds\w+[\s\S]{0,150}?contenidoExtra/.test(cerebro) &&
    !/contenidoExtra[\s\S]{0,150}?currentTurnNeeds/.test(cerebro),
  "sin palabras clave"
);
// Y SIN CONTENIDO, LO DICE — no lo inventa. Un extra a medio configurar tiene
// que sonar honesto, no imaginativo.
comprobar(
  "y sin contenido configurado, no inventa: lo dice",
  /NO CONTENT CONFIGURED for "\$\{nombreExtra\}"/.test(cerebro),
  "mejor honesto que inventado"
);

// ── 2. Las muestras del extra también existen para el bot ────────────────────
comprobar(
  "durante la oferta del extra, la postventa no cierra las muestras",
  /const elExtraSeEstaOfreciendo =\s*\r?\n\s*convo\?\.upsell_state === "ofrecido" \|\| convo\?\.upsell_state === "aceptado";/.test(
    cerebro
  ) &&
    /const currentTurnNeedsMedia =\s*\r?\n\s*\(!isPostSale \|\| elExtraSeEstaOfreciendo\) &&/.test(
      cerebro
    ),
  "sabe que tiene muestras"
);
// ES SEGURO POR CONSTRUCCION: con el extra en oferta la galeria disponible es
// SOLO la suya. Sin esto, un «¿que trae?» mandaria la foto del producto que
// acaba de comprar, con una invitacion a comprarlo otra vez.
comprobar(
  "y la galería de ese momento es SOLO la del extra",
  /const enOferta =\s*\r?\n\s*convo\?\.upsell_state === "ofrecido" \|\| convo\?\.upsell_state === "aceptado";/.test(
    config
  ) &&
    /if \(enOferta\) \{\s*\r?\n\s*return normalizeGallery\(\s*\r?\n\s*seccionUpsell\(cfg\)\?\.image_gallery,/.test(
      config
    ),
  "nunca la del ya comprado"
);

// ── 3. LO QUE NO SE ABRE, que es lo que protege la venta ya hecha ────────────
//
// El contenido del PRODUCTO PRINCIPAL sigue cerrado en postventa. Abrirlo aqui
// habria dejado al bot describiendo —y revendiendo— lo que el cliente ya tiene.
comprobar(
  "el contenido del producto ya comprado sigue cerrado",
  /const currentTurnNeedsProductContent =\s*\r?\n\s*!isPostSale &&/.test(cerebro),
  "no se revende lo entregado"
);
comprobar(
  "y la regla de no reofrecer el primero sigue en pie",
  /NEVER offer, describe or invite them to buy the FIRST product again/.test(
    cerebro
  ),
  "como estaba"
);

console.log(
  fallos === 0
    ? "\nTODO OK — el extra ya puede decir qué es"
    : `\n${fallos} comprobacion(es) mal.`
);
process.exit(fallos === 0 ? 0 : 1);
