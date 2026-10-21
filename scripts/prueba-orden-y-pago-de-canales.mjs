// Cuatro arreglos del editor, pedidos juntos.
//
//  1. FUERA EL CAJÓN «PAGO» DE CANALES. Se leía del archivo, se veía en el
//     editor y se guardaba de vuelta — pero el motor NUNCA lo leyó, desde el
//     primer commit. Era la peor clase de trampa: un cajón que se llama «Pago»,
//     parece el sitio donde van los datos de pago, y acepta lo que escribas sin
//     decirte que no sirve. Alberto tenía un número de cuenta escrito ahí.
//     Los datos de pago salen de Precios y pagos → país, que es lo que permite
//     que cada cliente reciba los suyos.
//     Lo escrito en el YAML NO se borra: el guardado lo sigue leyendo y
//     escribiendo. Solo deja de estar a la vista.
//
//  2. «Cierre después de las muestras» AL FINAL de la pestaña Contenido.
//  3. «Campos dinámicos» TAMBIÉN AL FINAL, y cerrado.
//     Los dos partían la fila de productos por la mitad.
//
//  4. EL PRODUCTO UPSELL NO SE PODÍA NOMBRAR EN SU CAJÓN. Los otros dos
//     productos tienen su nombre editable ahí mismo; el upsell solo lo enseñaba
//     y te mandaba a otra pestaña. Y es por ese nombre que el bot reconoce
//     cuando el cliente pide el segundo producto.
//
//   node scripts/prueba-orden-y-pago-de-canales.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");

const editor = leer("src", "app", "editor", "page.tsx");
const api = leer("src", "app", "api", "workflow", "route.ts");
const config = leer("src", "lib", "workflow", "config.ts");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 60)} ${valor}`);
};

// ── 1. El cajón de pago de Canales ──────────────────────────────────────────
comprobar(
  "el cajón «Pago» ya no está en Canales",
  !/<Collapsible title="Pago" titleKey=/.test(editor),
  "quitado"
);
comprobar(
  // EL AVISO SE RETIRA A PETICION DEL OPERADOR.
  //
  // Estaba para que quien buscara los datos de pago en Canales supiera a donde
  // habian ido. Con las secciones en ventana, quedaba suelto en medio de la
  // pantalla sin nada a lo que referirse.
  //
  // Lo que esta prueba sigue vigilando es lo que de verdad importa: que el
  // cajon no vuelva, y que nadie vuelva a escribir esas burbujas desde aqui.
  // El motor nunca las leyo.
  "y el motivo por el que se quito sigue escrito en el codigo",
  /motor NUNCA lo leyó/.test(editor),
  "para que nadie lo devuelva"
);
comprobar(
  "no queda editor de esas burbujas",
  !/updateContent\(\{ payment: steps \}\)/.test(editor),
  "ninguno"
);
comprobar(
  // Un canal que solo tenga pago escrito NO tiene contenido: decir que sí
  // hacía que al clonar pidiera confirmación para reemplazar algo que no se
  // envía nunca.
  "un canal con solo pago ya no cuenta como «con contenido»",
  !/hasSteps\(content\.payment\)/.test(editor),
  "no cuenta"
);
comprobar(
  // ESTO ES LO QUE PROTEGE LO ESCRITO. Si el guardado dejara de leerlo, el
  // primer guardado desde el editor lo borraría del archivo para siempre.
  "pero el guardado lo sigue leyendo y escribiendo",
  /payment: readSteps\(c\?\.payment\)/.test(api) &&
    /payment: writeSteps\(content\?\.payment\)/.test(api),
  "nada se pierde"
);
comprobar(
  // Si alguien lo "arregla" conectándolo, sería una QUINTA fuente de textos de
  // pago encima de las cuatro que ya hay — y en Canales es por canal, no por
  // país: se perderían los datos por país.
  "y el motor sigue sin leerlo",
  !/content\.payment/.test(config),
  "sigue muerto"
);

// ── 2 y 3. El orden de la pestaña Contenido ─────────────────────────────────
const pos = (aguja) => editor.indexOf(aguja);
// Los cuatro se abren ahora en ventana (`enVentana`), pero siguen siendo los
// mismos cajones y en el mismo orden: la barra se queda donde estaba.
const productoUpsell = pos('<Collapsible title="🛒 PRODUCTO UPSELL" enVentana>');
const infoDeContenido = pos(
  'title="🖼️ Info de contenido (imágenes al pedir el detalle)"'
);
const cierre = pos(
  '<Collapsible title="🏁 Cierre después de las muestras" enVentana>'
);
const campos = pos("<DynamicFieldsEditor");

comprobar(
  "los cuatro cajones están donde se los busca",
  [productoUpsell, infoDeContenido, cierre, campos].every((p) => p > 0),
  "sí"
);
comprobar(
  // Antes se metía entre el PRODUCTO FULL y el PRODUCTO BÁSICO.
  "«Cierre después de las muestras» va después de los productos",
  cierre > productoUpsell && cierre > infoDeContenido,
  "al final"
);
comprobar(
  "«Campos dinámicos» va el último de todos",
  campos > cierre,
  "el último"
);
comprobar(
  // Estaba arriba del todo Y abierto. Al final y abierto sería una pared.
  "y ya no se abre solo",
  !/<Collapsible title="Campos dinamicos de esta modalidad" defaultOpen>/.test(
    editor
  ),
  "cerrado"
);

// ── 4. El nombre del producto UPSELL ────────────────────────────────────────
comprobar(
  "el cajón del UPSELL tiene su nombre editable",
  // Entre la etiqueta y el campo puede ir la chapita del comodin, que dice a
  // cual alimenta y avisa si esta vacio. Lo que se comprueba es que el campo
  // siga siendo editable y escriba en cfg.upsell.name.
  /Nombre del producto[\s\S]{0,220}<input\s*\r?\n\s*value=\{cfg\.upsell\?\.name \?\? ""\}/.test(
    editor
  ),
  "se escribe"
);
comprobar(
  "y escribe en el mismo sitio que la pestaña Upsell",
  (editor.match(/upsell: \{ \.\.\.cfg\.upsell, name: e\.target\.value \}/g) ?? [])
    .length === 2,
  "un solo valor"
);
comprobar(
  "ya no es un texto de solo lectura que manda a otra pestaña",
  !/Ahora mismo:\{" "\}/.test(editor),
  "quitado"
);
comprobar(
  // Se llama «PRODUCTO UPSELL» de fábrica, y con un nombre de relleno el bot
  // no reconoce cuando se lo piden.
  // El texto se parte en varias lineas al indentarlo, asi que los espacios
  // entre palabras no se pueden dar por sencillos.
  "y avisa de para qué sirve ese nombre",
  /reconoce\s+cuando el cliente pide el segundo\s+producto/.test(editor),
  "lo dice"
);

console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} comprobación(es) mal.`);
process.exit(fallos === 0 ? 0 : 1);
