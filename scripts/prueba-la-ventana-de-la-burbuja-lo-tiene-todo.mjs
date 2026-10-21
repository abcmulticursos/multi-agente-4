// La ventana de «Editar esta burbuja» tiene lo MISMO que el cajon de la lista.
//
// COMO ESTABA
//
//   Clic derecho en una burbuja → «Editar esta burbuja» abria una ventana con
//   un editor hecho a mano: tipo, enlace, variantes de texto y encendido.
//   Cuatro campos.
//
//   El cajon de esa misma burbuja, en la lista, tiene ademas el retardo, los
//   botones, los cuadritos de decision con su plazo y la pregunta del nombre.
//
//   O sea: quien abria la ventana para editar «todo» editaba MENOS que sin
//   abrirla. Y nada lo decia.
//
// COMO QUEDA
//
//   La ventana dibuja EL MISMO cajon, no una copia. Dos editores para lo mismo
//   acaban divergiendo, y el que se quede corto lo hace en silencio: no falta
//   nada visible, simplemente no esta.
//
// LO QUE CAMBIA DENTRO DE LA VENTANA, Y SOLO ESO
//
//   Sale desplegado, porque para eso se abrio. Y se quitan mover, subir, bajar,
//   duplicar y borrar: son de la LISTA, no de la burbuja, y en la ventana no
//   hay lista. Siguen estando en el clic derecho.
//
// EL VISOR NO SE ESTIRA
//
//   La ventana crece porque ahora lleva el cajon entero, pero la columna del
//   visor se queda en ancho de telefono. Un WhatsApp ancho enseña unos
//   renglones que al cliente no le van a llegar asi.
//
//   node scripts/prueba-la-ventana-de-la-burbuja-lo-tiene-todo.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const editor = readFileSync(join(RAIZ, "src", "app", "editor", "page.tsx"), "utf8");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

const ventana = (() => {
  const i = editor.indexOf("MÁS ANCHA, PERO EL WHATSAPP NO SE ESTIRA");
  const f = editor.indexOf("function JourneyPreviewSection(", i);
  return i < 0 || f < 0 ? "" : editor.slice(i, f);
})();
comprobar("se encuentra la ventana", ventana.length > 0, "Editar esta burbuja");

// -- 1. ES EL MISMO CAJON ----------------------------------------------------
comprobar(
  "la ventana dibuja el cajon de verdad",
  /<StepCard\b/.test(ventana) && /enVentana\b/.test(ventana),
  "no una copia"
);
// El editor a mano que tenia dentro. Si vuelve, vuelve el problema entero.
comprobar(
  "y ya no tiene su propio editor a mano",
  !/\+ Agregar variante/.test(ventana),
  "un solo editor"
);
comprobar(
  "el cajon lo pinta todo, tambien los botones",
  /allowButtons\b/.test(ventana),
  "botones y cuadritos"
);
// EL MEZCLADOR DEL CAJON TIENE QUE MOVER EL VISOR.
//
// El boton «∞» pide otra combinacion del spintax. Aqui recibia una funcion
// VACIA: se podia pulsar las veces que fuera y el texto de al lado no se movia.
// No daba error, simplemente no pasaba nada.
//
// El visor de la ventana enseña UNA burbuja, asi que la tirada va en el sitio 0.
comprobar(
  "el mezclador del cajon mueve el visor",
  /onVaryPreview=\{\(\) => setTirada\(\(n\) => n \+ 1\)\}/.test(ventana) &&
    /previewRolls=\{\{ 0: tirada \}\}/.test(ventana),
  "∞ ya no es un boton muerto"
);
// Y al pasar a otra burbuja se empieza limpio: la tirada de la anterior no
// tiene por que seguir mandando sobre un texto que ya no es el suyo.
//
// Esto vive unas lineas ARRIBA del comentario que abre el recorte, junto al
// borrador, asi que se busca en el archivo entero.
comprobar(
  "y al cambiar de burbuja vuelve a cero",
  /setBorrador\(steps\);\s*\r?\n\s*setTirada\(0\);/.test(editor),
  "cada burbuja su tirada"
);

// -- 2. LO QUE CAMBIA DENTRO DE LA VENTANA -----------------------------------
const cajon = (() => {
  const i = editor.indexOf("function StepCard({");
  // La siguiente funcion suelta del archivo. `BubbleDecisionsEditor` no sirve
  // de tope: esta declarada ANTES que el cajon.
  const f = editor.indexOf("function compactSteps(", i);
  return i < 0 || f < 0 ? "" : editor.slice(i, f);
})();
comprobar("se encuentra el cajon", cajon.length > 0, "StepCard");
comprobar(
  "en la ventana sale desplegado",
  /useState\(\s*\r?\n?\s*\(\) => !enVentana && step\.texts\.some/.test(cajon),
  "para eso se abrio"
);
// Mover, subir, bajar, duplicar y borrar son de la LISTA. En la ventana no hay
// lista: dejarlos ahi seria ofrecer botones que no pueden hacer nada.
comprobar(
  "sin mover, subir ni bajar",
  /\{!enVentana && \(\s*\r?\n\s*<>\s*\r?\n\s*<button[\s\S]{0,800}?⋮⋮ Mover/.test(
    cajon
  ),
  "son de la lista"
);
comprobar(
  "sin duplicar ni borrar",
  /\{!enVentana && \(\s*\r?\n\s*<>[\s\S]{0,600}?Duplicar paso/.test(cajon),
  "estan en el clic derecho"
);
// Y fuera de la ventana NADA cambia: la lista sigue con sus cinco controles.
comprobar(
  "en la lista todo sigue igual",
  /enVentana = false,/.test(cajon),
  "apagado por defecto"
);

// -- 3. EL VISOR SIGUE SIENDO UN TELEFONO ------------------------------------
// EL MISMO ANCHO QUE EN EL RESTO DEL EDITOR.
//
// Aqui su columna era mas ancha que en Seguimientos, asi que el mismo telefono
// se veia de dos tamaños segun se editara dentro o fuera de la ventana. Es un
// telefono: mide lo que mide en todas partes.
comprobar(
  "el visor no se estira con la ventana",
  /lg:grid-cols-\[minmax\(0,1fr\)_minmax\(260px,340px\)\]/.test(ventana),
  "ancho de telefono"
);
// Y CADA COLUMNA CON SU PROPIO DESPLAZAMIENTO. Antes se desplazaba la ventana
// entera: para llegar al final del editor habia que arrastrar tambien el visor,
// y el visor se iba de la pantalla justo cuando hacia falta mirarlo.
comprobar(
  "cada columna se desplaza sola",
  (ventana.match(/min-h-0 overflow-y-auto/g) ?? []).length === 2,
  "el visor se queda quieto"
);
// EN LA PESTAÑA, LA LINEA SEPARADORA SI, LA BARRA NO.
//
// Se probo a dar a cada columna de la pestaña su propia barra, con el tope de
// altura en la REJILLA. En una rejilla la fila se estira a lo que mide su
// contenido: el tope recortaba la caja sin encoger la fila, asi que ninguna
// columna sacaba barra y el visor se pintaba encima de las pestañas de abajo.
//
// Quedo deshecho. Esto vigila que no vuelva por descuido, y que al deshacerlo
// no se perdiera el `sticky`, que es lo que mantiene el visor a la vista.
comprobar(
  "en la pestaña la rejilla no lleva tope de altura",
  !/grid gap-4 lg:max-h-\[72vh\] lg:grid-cols-2/.test(editor),
  "recortaba la caja, no la fila"
);
comprobar(
  "y el visor de la pestaña sigue clavado",
  /lg:sticky lg:top-4 lg:self-start lg:border-l/.test(editor),
  "sticky, como siempre"
);
comprobar(
  "la linea separadora si se queda",
  (editor.match(/lg:border-l lg:border-neutral-200 lg:pl-4/g) ?? []).length === 2,
  "en la pestaña y en la ventana"
);
comprobar(
  // 1050 px. Empezo en 1400 y se recorto un 25%: cabia el cajon entero, pero
  // a ese ancho el texto se estiraba en renglones larguisimos.
  "y la ventana si crece",
  /max-w-\[1050px\]/.test(ventana),
  "cabe el cajon entero"
);

// -- 4. EL BOTON DICE LO QUE HACE --------------------------------------------
//
// Decia «Listo», que es lo que dicen tambien las ventanas que solo cierran. En
// esta, ese boton es el UNICO que guarda: Escape y el clic fuera descartan.
comprobar(
  "el boton dice Guardar",
  />Guardar</.test(ventana) && !/>Listo</.test(ventana),
  "y no Listo"
);
comprobar(
  "y sigue siendo el unico que guarda",
  (ventana.match(/onChange\(/g) ?? []).length === 0 ||
    /onClick=\{aplicarYCerrar\}/.test(ventana),
  "Escape descarta"
);

console.log(fallos === 0 ? "\nTODO OK" : `\n${fallos} FALLO(S)`);
process.exit(fallos === 0 ? 0 : 1);
