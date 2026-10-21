// {{PRODUCTO_ENTREGADO}}: el unico comodin de nombre que apunta a lo que el
// cliente acaba de recibir, y no a un puesto de la modalidad.
//
// LO QUE PASABA
//
//   Los comodines de nombre apuntan a un PUESTO: {{PRODUCTO_BASE}} quiere decir
//   «el basico de la modalidad que esta vendiendo», no «este producto».
//
//   Mientras el papel de un producto ERA el sitio donde estaba guardado eso daba
//   igual. Pero ahora un producto se mueve de puesto: el que hoy es el basico
//   mañana es el full. Y la burbuja de entrega viaja DENTRO del producto, asi
//   que seguiria diciendo «has recibido tu {{PRODUCTO_BASE}}» y nombraria al que
//   ocupo su puesto, que ya es otro.
//
//   Le llega el archivo correcto con el nombre equivocado. Nada falla, nada
//   avisa, y de eso uno se entera cuando el cliente reclama.
//
// COMO QUEDA
//
//   Un comodin nuevo que se resuelve con la FUENTE de la entrega, que es el
//   mismo mecanismo por el que {precio} ya sale bien en la entrega del basico y
//   en la del full. Se escribe una vez y vale para siempre, pase ese producto al
//   puesto que pase.
//
// LO QUE NO PUEDE VOLVER A PASAR
//
//   1. Que los comodines de siempre cambien de significado. Hay cientos de
//      textos escritos con ellos.
//   2. Que salga con las llaves puestas al cliente por haberlo escrito fuera de
//      una entrega.
//   3. Que se quede en blanco en la PRIMERA burbuja, que es la que mas se lee:
//      esa sale sin pasar por la cola y no lleva el mismo dato que las demas.
//   4. Que el visor del editor enseñe un nombre concreto y haga creer que ese
//      sale en todas las entregas.
//
//   node scripts/prueba-comodin-del-producto-entregado.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");
const config = leer("src", "lib", "workflow", "config.ts");
const engine = leer("src", "lib", "workflow", "engine.ts");
const pago = leer("src", "lib", "workflow", "payment.ts");
const editor = leer("src", "app", "editor", "page.tsx");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// -- 1. CADA FUENTE DE ENTREGA DEVUELVE SU PRODUCTO --------------------------
//
// Leer uno por otro daria un nombre creible y equivocado, que es peor que un
// hueco: el cliente lee que recibio otra cosa y reclama.
comprobar(
  "existe el resolutor del producto entregado",
  /export function nombreDelProductoEntregado\(/.test(config),
  "en el motor"
);
const resolutor = (() => {
  const i = config.indexOf("export function nombreDelProductoEntregado(");
  const f = config.indexOf("\n}", i);
  return i < 0 ? "" : config.slice(i, f);
})();
for (const [fuente, campo] of [
  ["upsell", /case "upsell":\s*\r?\n\s*return limpio\(seccionUpsell\(cfg\)\?\.name\)/],
  ["ob_combo", /case "ob_combo":[\s\S]{0,80}combo\?\.name/],
  ["ob_basico", /case "ob_basico":[\s\S]{0,80}basico\?\.name/],
  ["bioferta_b", /case "bioferta_b":[\s\S]{0,80}product_b\?\.name/],
  ["bioferta_pack", /case "bioferta_pack":[\s\S]{0,80}pack\?\.name/],
  ["bioferta_a", /case "bioferta_a":[\s\S]{0,80}product_a\?\.name/],
]) {
  comprobar(`${fuente} lee su propio nombre`, campo.test(resolutor), "no cruza");
}
// SIN NOMBRE PUESTO, EL PRINCIPAL; y si tampoco hay, nada. Un hueco se ve; un
// nombre inventado no.
comprobar(
  "sin nombre cae al principal y nunca inventa",
  /\|\| principal;/.test(resolutor) &&
    /const principal = limpio\(cfg\.product_name\);/.test(resolutor),
  "vacío antes que mentira"
);

// -- 2. UNA SOLA ESCRITURA DEL PATRON ----------------------------------------
//
// El resolutor y el borrado de seguridad tienen que reconocer exactamente lo
// mismo. Separados, uno dejaria pasar lo que el otro cambia.
comprobar(
  "el patrón se escribe una sola vez",
  /const PATRON_PRODUCTO_ENTREGADO =/.test(config) &&
    (config.match(/producto_entregado\|producto_de_la_entrega/g) ?? []).length ===
      1,
  "compartido"
);
// UN PATRON CON `g` SE ACUERDA DE DONDE SE QUEDO. Preguntar con .test() antes de
// reemplazar haria que la segunda llamada empezara a mitad del texto y dijera
// que no hay comodin cuando si lo hay.
comprobar(
  "no se pregunta con .test() antes de reemplazar",
  !/PATRON_PRODUCTO_ENTREGADO\.test\(/.test(config),
  "sin memoria"
);

// -- 3. SE RESUELVE EN LA ENTREGA, CON SU FUENTE -----------------------------
comprobar(
  "la entrega lo resuelve con su fuente",
  /let out = aplicarProductoEntregado\(\s*\r?\n?\s*t,\s*\r?\n?\s*payload\.source \?\? "approved",\s*\r?\n?\s*config\s*\r?\n?\s*\);/.test(
    engine
  ),
  "como el precio"
);
// Y VA PRIMERO, ANTES QUE NADA. AQUI ESTUVO EL FALLO.
//
// `applyPriceTemplate` empieza llamando a `applyProductName`, y esa termina
// BORRANDO el comodin — es su red de seguridad, para que escrito fuera de una
// entrega no le salga al cliente con las llaves puestas.
//
// Resolviendolo despues, la red ya se lo habia llevado: al cliente le llegaba
// «Entrega para **», con el hueco en medio. Resolviendolo antes, cuando la red
// pasa ya no queda nada que borrar.
const cuerpoDeRender = (() => {
  const i = engine.indexOf("const renderDelivery = (t: string): string => {");
  const f = engine.indexOf("return out;", i);
  return i < 0 || f < 0 ? "" : engine.slice(i, f);
})();
// Se comparan las LLAMADAS, no cualquier mencion: el comentario que explica
// esto nombra las dos funciones, y contandolas se compararia con el comentario.
comprobar(
  "y se resuelve ANTES de que el precio lo borre",
  cuerpoDeRender.indexOf("let out = aplicarProductoEntregado(") >= 0 &&
    cuerpoDeRender.indexOf("let out = aplicarProductoEntregado(") <
      cuerpoDeRender.indexOf("out = applyPriceTemplate("),
  "primero el nombre"
);
// LA PRIMERA BURBUJA SALE POR OTRO CAMINO. Se manda directa, sin pasar por la
// cola, asi que no lleva el payload con la fuente. Sin pasarsela a mano se
// quedaria en blanco justo en la burbuja que mas se lee.
comprobar(
  "la primera burbuja también sabe qué se entrega",
  /source: FuenteDeEntrega = "approved"/.test(pago) &&
    /aplicarProductoEntregado\(bodyText, source\)/.test(pago) &&
    /aplicarProductoEntregado\(captionRaw, source\)/.test(pago),
  "no se queda en blanco"
);
comprobar(
  "y se le pasa la fuente al programar la entrega",
  /sendImmediateDeliveryStep\(\s*\r?\n\s*conversationId,\s*\r?\n\s*activeSteps\[0\]\.step,\s*\r?\n\s*source\s*\r?\n\s*\)/.test(
    pago
  ),
  "la de esa entrega"
);
// LA LISTA DE FUENTES, UNA SOLA. Dos listas acaban diciendo cosas distintas y el
// resolutor se quedaria sin un caso sin que nada lo avise.
comprobar(
  "la lista de fuentes no está duplicada",
  /export type FuenteDeEntrega =/.test(config) &&
    /export type DeliverySource = FuenteDeEntrega;/.test(pago),
  "una sola"
);

// -- 4. FUERA DE LA ENTREGA, EN BLANCO ---------------------------------------
//
// Escrito en una intro o en un seguimiento no hay nada que preguntar. Se borra:
// un comodin crudo le sale al cliente con las llaves puestas, y eso si se ve.
comprobar(
  "fuera de la entrega se borra, no sale crudo",
  /\.replace\(PATRON_PRODUCTO_ENTREGADO, ""\)/.test(config),
  "en blanco"
);
// VA EL ULTIMO: antes que el, el camino de la entrega ya lo cambio si tocaba.
comprobar(
  "y el borrado va después del genérico {{PRODUCTO}}",
  config.indexOf('.replace(PATRON_PRODUCTO_ENTREGADO, "")') >
    config.indexOf("literal(getProductName()));"),
  "no le pisa"
);

// -- 5. LOS DE SIEMPRE NO SE TOCAN -------------------------------------------
//
// Hay cientos de textos escritos con ellos. Cambiarles el significado seria
// mover lo que el bot dice hoy sin que nadie lo haya pedido.
for (const [nombre, patron] of [
  ["{{PRODUCTO}}", /\.replace\(\/\\\{\{1,2\}\\s\*producto\\s\*\\\}\{1,2\}\/gi, literal\(getProductName\(\)\)\)/],
  ["{{PRODUCTO_BASE}}", /producto_base\|producto_basico/],
  ["{{PRODUCTO_FULL}}", /producto_full/],
]) {
  comprobar(`${nombre} sigue significando lo mismo`, patron.test(config), "intacto");
}

// -- 6. LA PANTALLA ----------------------------------------------------------
comprobar(
  "el editor lo ofrece",
  /token: "\{\{PRODUCTO_ENTREGADO\}\}"/.test(editor),
  "en la lista"
);
// Y DICE DONDE VALE. Ofrecerlo sin decirlo es invitar a escribirlo en una intro,
// donde sale en blanco y deja la frase a medias.
comprobar(
  "y dice que es solo para las burbujas de entrega",
  /SOLO en las burbujas de entrega/.test(editor),
  "no se usa a ciegas"
);
// EL VISOR SÍ PUEDE, PORQUE EL CAJON SABE DE QUIEN ES ESA ENTREGA.
//
// El bot solo lo sabe en la conversacion real, pero el sitio donde se escribe no
// es ambiguo: en la ficha de un producto la entrega es de ese producto, y en el
// cajon del Full es de quien juegue de Full. Cada cajon de entrega manda el suyo.
comprobar(
  "el visor recibe de quién es esta entrega",
  /function previewContextDeEntrega\(/.test(editor) &&
    /nombreEntregado\?: string;/.test(editor),
  "cajón por cajón"
);
comprobar(
  "y si nadie juega ese puesto, usa el nombre del cajón",
  /nombreEntregado: producto\?\.name\?\.trim\(\) \|\| \(nombreDelCajon \?\? ""\)\.trim\(\)/.test(
    editor
  ),
  "lo que le llega al cliente"
);
// LOS SIETE CAJONES DE ENTREGA, uno por uno. Si alguno se queda sin pasarlo,
// enseña el hueco mientras los demas enseñan el nombre, y nadie entiende por que.
for (const [donde, patron] of [
  ["Pago Aprobado", /previewContextDeEntrega\(\s*\r?\n?\s*cfg,\s*\r?\n?\s*"unico"/],
  ["Doble Oferta · Pack", /previewContextDeEntrega\(\s*\r?\n?\s*cfg,\s*\r?\n?\s*"full",\s*\r?\n?\s*cfg\.bioferta\.pack\.name/],
  ["Doble Oferta · Producto 2", /previewContextDeEntrega\(\s*\r?\n?\s*cfg,\s*\r?\n?\s*"complementario"/],
  ["el Upsell", /previewContextDeEntrega\(\s*\r?\n?\s*cfg,\s*\r?\n?\s*"upsell"/],
]) {
  comprobar(`${donde} le dice al visor quién entrega`, patron.test(editor), "resuelto");
}
comprobar(
  "Order Bump lo saca de quién juega ese puesto",
  /const quienJuegaAqui = useQuienJuega\(papel\);/.test(editor) &&
    /quienJuegaAqui\?\.name\?\.trim\(\) \|\| value\.name\?\.trim\(\)/.test(editor),
  "básico y full"
);
comprobar(
  "y la ficha del producto usa su propio nombre",
  /nombreEntregado: producto\.name\?\.trim\(\) \|\| ""/.test(editor),
  "sin duda posible"
);
// DONDE DE VERDAD NO SE PUEDE SABER —un cajon que no es de entrega— se pinta el
// hueco explicado. Enseñar ahi el nombre de una de las entregas haria creer que
// sale en todas.
comprobar(
  "fuera de una entrega, el hueco explicado",
  /"\[el producto de esta entrega\]"/.test(editor),
  "no miente"
);

console.log(
  fallos === 0
    ? "\nTODO OK — el comodín apunta a lo que se entrega, no a un puesto"
    : `\n${fallos} FALLO(S)`
);
process.exit(fallos === 0 ? 0 : 1);
