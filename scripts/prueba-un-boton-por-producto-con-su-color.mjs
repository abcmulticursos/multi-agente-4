// Un boton por producto en «Precios y pagos», y cada uno con su color.
//
// LO QUE HABIA
//
//   Solo el precio BASE tenia su boton y su ventana. Las cifras del FULL, del
//   UPSELL y del PACK seguian sueltas en la rejilla, en columnas que ocupaban
//   media pantalla: para comparar el precio del base con el del full habia que
//   recorrer la pagina entera. Y el color de los botones estaba escrito a mano
//   en el codigo: no se podia cambiar.
//
// LO QUE VIGILA ESTA PRUEBA
//
//   1. Cada producto tiene su boton, y SOLO en la modalidad donde existe.
//   2. Los campos viven en UNA sola copia (una variable), no duplicados dentro
//      y fuera de la ventana: si se duplicaran, un dia uno se quedaria viejo.
//   3. El color se guarda POR MODALIDAD, y fuera de las secciones de contenido,
//      para que pintar una tienda no toque las otras ni una plantilla se lo
//      lleve por delante.
//   4. El color va y vuelve por la ruta: lo que se guarda se vuelve a ver.
//   5. Es solo aspecto: el motor no lee ese campo en ningun sitio.
//
//   node scripts/prueba-un-boton-por-producto-con-su-color.mjs
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");
const editor = leer("src", "app", "editor", "page.tsx");
const ruta = leer("src", "app", "api", "workflow", "route.ts");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 60)} ${valor}`);
};

// ── 1. Un boton por producto ─────────────────────────────────────────────────
const botones = (editor.match(/<BotonDeProducto/g) ?? []).length;
comprobar("hay un boton por producto y por seccion", botones >= 6, `${botones} botones`);
for (const [que, marca] of [
  ["full", 'setPopupProducto("full")'],
  ["upsell", 'setPopupProducto("upsell")'],
  ["pack", 'setPopupProducto("pack")'],
  ["datos de pago", 'setPopupProducto("datos")'],
  ["metodos con botones", 'setPopupProducto("metodos")'],
]) {
  comprobar(`el boton de ${que} abre su ventana`, editor.includes(marca), marca);
}
const ventanas = (editor.match(/popupProducto === "(base|full|upsell|pack|datos|metodos)"/g) ?? []).length;
comprobar("cada boton tiene su ventana", ventanas === 6, `${ventanas} ventanas`);

// Los botones van en SU PROPIA fila y con medida fija. Sueltos en la rejilla de
// dos columnas de la seccion, uno se iba a lo ancho y otro crecia a lo alto
// para igualar al bloque vecino: tres botones que hacen lo mismo, tres tamaños.
// DOS GRUPOS, CADA UNO CON SU TITULO Y SU MARCO.
//
// Apilados en una fila corrida no se sabia cual era cual: los precios y los
// datos de pago se leian como una sola lista de cinco cosas. Son dos asuntos
// distintos y tienen que verse como dos.
for (const titulo of ["💵 Precios de producto", "🔑 Cómo paga el cliente"]) {
  comprobar(
    `el grupo «${titulo}» tiene su titulo`,
    editor.includes(titulo),
    "se lee de que va"
  );
}
// SE CUENTA DENTRO DE SU ZONA, NO EN TODO EL ARCHIVO.
//
// Antes se contaban los marcos de la pantalla ENTERA y se exigia que fueran
// dos. Es el mismo marco que usa media casa, asi que la prueba se ponia roja
// en cuanto alguien creaba una tarjeta en cualquier otro sitio — y la tarjeta
// nueva no tenia nada que ver con estos dos grupos.
const zonaDeLosGrupos = (() => {
  const i = editor.indexOf("💵 Precios de producto");
  const f = editor.indexOf("🔑 Cómo paga el cliente", i);
  // Desde un poco antes del primer titulo hasta un poco despues del segundo:
  // ahi caben justo los dos marcos y ninguno ajeno.
  return i < 0 || f < 0 ? "" : editor.slice(i - 400, f + 400);
})();
comprobar(
  "cada grupo va en su marco redondeado",
  // `bg-tarjeta` es el blanco de siempre: en el tema claro vale #ffffff. Se
  // escribe asi para que en el tema oscuro el marco se oscurezca con el resto.
  (zonaDeLosGrupos.match(/<div className="rounded-xl border border-neutral-200 bg-tarjeta p-4 shadow-sm">/g) ?? [])
    .length === 2,
  "dos marcos"
);
comprobar(
  "y los botones dentro, en fila",
  (editor.match(/<div className="flex flex-wrap items-start gap-3">/g) ?? [])
    .length === 2,
  "fuera de la rejilla de la seccion"
);
// El nombre tiene que ganarle al precio: lo primero que se busca en una fila de
// botones es CUAL es, no cuanto vale.
const caraDelBoton = editor.slice(
  editor.indexOf("function BotonDeProducto("),
  editor.indexOf("function BotonDeProducto(") + 4200
);
comprobar(
  "el nombre del boton manda sobre el precio",
  /text-\[13px\] font-black uppercase/.test(caraDelBoton) &&
    /precio !== undefined \? "text-base" : "text-sm"/.test(caraDelBoton),
  "13px negrita vs 16px"
);
// Sin las marcas de orden viejas: con ellas, en Order Bump la fila salia
// desordenada (los datos de pago delante de los precios).
comprobar(
  "ningun boton lleva marcas de orden",
  !/onAbrir=\{\(\) => setPopupProducto\("(base|full)"\)\}\s*\n\s*className=\{layerMode === "order_bump" \? "order-/.test(
    editor
  ),
  "el orden es el mismo en todas las modalidades"
);
comprobar(
  "y medida fija, sin estirarse",
  /className=\{`relative flex w-\[230px\] shrink-0 grow-0 flex-col/.test(editor),
  "todos iguales"
);

// Cada uno SOLO donde ese producto existe: el upsell no puede aparecer en
// Order Bump, ni el pack fuera de Doble Oferta.
const trozo = (desde, largo) => {
  const i = editor.indexOf(desde);
  return i < 0 ? "" : editor.slice(i, i + largo);
};
const filaDeBotones = trozo("EL PRODUCTO ENTERO EN UNA VENTANA", 6000);
//
// ACTUALIZADA el 23/09/2026, conservando su intencion. Antes exigia
// EXACTAMENTE las dos modalidades que tienen full de nacimiento. Con
// «PRESENTA:» lineal y -OB- tambien venden dos opciones sin cambiar de nombre,
// y sin el boton no habia donde ponerle precio al full: {{PRECIO_FULL}} salia
// vacio. Lo que protege esta comprobacion no cambia —el boton NO sale en una
// capa que no vende full— solo que ahora se pregunta por el DATO.
comprobar(
  "el full solo donde de verdad hay full",
  /\(layerMode === "order_bump" \|\|\s*layerMode === "doble_oferta_upsell" \|\|\s*vendeDosPorPrestada\) && \(\s*<BotonDeProducto\s*nombre="FULL"/.test(
    filaDeBotones
  ),
  "las dos modalidades, mas la presentacion prestada"
);
comprobar(
  "y la prestada mira la capa que vende, no cualquiera",
  /const vendeDosPorPrestada =\s*!!cfg && layerMode === runtimeModality\(cfg\) && !!segundaOpcionPrestada\(cfg\)/.test(
    editor
  ),
  "sin esto saldria en capas que no lo usan"
);
// El upsell ya no es de una modalidad: cualquiera puede tener su etapa. El
// boton sale donde HAY producto que cobrar —la etapa tiene nombre—, que es el
// mismo criterio que usa su cajon de entrega por canal. Encerrado en Doble
// Oferta + Upsell, en Lineal y en Order Bump el upsell se quedaba con un unico
// precio global para todos los paises.
comprobar(
  "el upsell donde la etapa tiene nombre",
  /\(layerMode === "doble_oferta_upsell" \|\|\s*!!\(cfg\.upsell\?\.name \?\? ""\)\.trim\(\)\) && \(\s*<BotonDeProducto\s*nombre="UPSELL"/.test(
    filaDeBotones
  ),
  "cualquiera con etapa"
);
comprobar(
  "el pack solo en doble oferta",
  /layerMode === "bioferta" && \(\s*<BotonDeProducto\s*nombre="PACK/.test(
    filaDeBotones
  ),
  "bioferta"
);

// ── 2. Una sola copia de cada campo ──────────────────────────────────────────
//
// Los campos se sacaron a una variable y se pintan DENTRO de la ventana. Si
// alguien los volviera a poner sueltos en la rejilla habria dos copias del
// mismo campo, y editar una no cambiaria la otra.
for (const [que, comodin] of [
  ["full", "{{PRECIO_FULL}}"],
  ["upsell", "{{PRECIO_UPSELL}}"],
]) {
  const veces = (editor.match(new RegExp(`comodin="\\{\\{PRECIO_${que.toUpperCase()}\\}\\}"`, "g")) ?? []).length;
  comprobar(`el precio del ${que} se escribe en un solo sitio`, veces === 1, `${veces} campo(s) ${comodin}`);
}
for (const variable of [
  "camposDelFull",
  "camposDelUpsell",
  "camposDelPack",
  "datosDePagoDelPais",
]) {
  const veces = (editor.match(new RegExp(variable, "g")) ?? []).length;
  comprobar(`${variable}: se define una vez y se usa una vez`, veces === 2, `${veces} apariciones`);
}
// El bloque de los metodos vive en el componente de ARRIBA y se entrega hecho:
// se define alli (1), se pasa como prop (1), se recibe (2: nombre y tipo) y se
// pinta dentro de la ventana (2: la guarda del boton y la ventana).
comprobar(
  "el bloque de metodos se entrega, no se copia",
  (editor.match(/bloqueDeMetodosConBotones/g) ?? []).length === 2,
  "una definicion y una entrega"
);
comprobar(
  "y el hijo solo lo pinta",
  /bloqueDeMetodos\?: ReactNode;/.test(editor) &&
    (editor.match(/\{bloqueDeMetodos\}/g) ?? []).length === 1,
  "sin recablear nada suyo"
);

// ── 3. El color, por modalidad y fuera del contenido ─────────────────────────
comprobar(
  "la clave del color lleva la modalidad delante",
  /\$\{layerMode\}:\$\{boton\}/.test(editor),
  "«doble_oferta_upsell:full»"
);
comprobar(
  "el color vive en su propio campo, no dentro de una modalidad",
  /editor_colores_de_botones\?: Record<string, string>/.test(editor),
  "editor_colores_de_botones"
);
comprobar(
  "los seis colores son los mismos de los cuadritos",
  ["esmeralda", "rojo", "azul", "violeta", "ambar", "gris"].every((c) =>
    new RegExp(`^\\s{2}${c}: \\{`, "m").test(editor)
  ),
  "una sola paleta que aprenderse"
);
// Un boton dentro de otro boton no es HTML valido: el navegador lo desarma y el
// clic acaba donde no toca. La tarjeta tiene que ser un div.
const boton = trozo("function BotonDeProducto(", 3600);
comprobar(
  "la tarjeta es un div, no un boton",
  /<div\s*className=\{`relative flex w-\[230px\]/.test(boton),
  "el punto de color va dentro"
);
comprobar(
  "el punto de color no abre la ventana",
  /evento\.stopPropagation\(\);\s*setEligiendoColor/.test(boton),
  "stopPropagation"
);

// ── 4. Va y vuelve por la ruta ───────────────────────────────────────────────
//
// La ruta filtra campo por campo en LAS DOS direcciones. Un campo que solo este
// en una se guarda y no vuelve — o vuelve y no se guarda — y desde la pantalla
// parece que no se guardo nada.
comprobar(
  "la ruta lo devuelve al editor",
  /editor_colores_de_botones,/.test(ruta),
  "de vuelta"
);
comprobar(
  "y lo escribe en el archivo",
  /doc\.set\("editor_colores_de_botones"/.test(ruta),
  "de ida"
);
comprobar(
  "solo lo escribe si el panel lo manda",
  /hasOwnProperty\.call\(body, "editor_colores_de_botones"\)/.test(ruta),
  "un guardado antiguo no lo borra"
);

// ── 5. El motor no lo mira ───────────────────────────────────────────────────
//
// Es aspecto del editor. Si algun dia el motor leyera esto, un color estaria
// decidiendo algo de una venta.
const mirarEnMotor = (dir) => {
  let encontrado = [];
  for (const nombre of readdirSync(dir)) {
    const ruta2 = join(dir, nombre);
    if (statSync(ruta2).isDirectory()) {
      encontrado = encontrado.concat(mirarEnMotor(ruta2));
    } else if (/\.tsx?$/.test(nombre) && leerSeguro(ruta2).includes("editor_colores_de_botones")) {
      encontrado.push(ruta2);
    }
  }
  return encontrado;
};
const leerSeguro = (p) => {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return "";
  }
};
const enElMotor = mirarEnMotor(join(RAIZ, "src", "lib"));
comprobar(
  "el motor no lee el color en ningun sitio",
  enElMotor.length === 0,
  enElMotor.length === 0 ? "solo aspecto" : enElMotor.join(", ")
);

console.log(
  `\n${fallos === 0 ? "TODO OK — un boton por producto, y el color es tuyo" : `${fallos} FALLOS`}`
);
process.exit(fallos === 0 ? 0 : 1);
