// Una muestra es UNA burbuja, y el segundo producto sale en «Info de contenido».
//
// DOS FALLOS QUE IMPEDIAN PROBAR
//
// 1. «AGREGAR PASO» DENTRO DE UNA MUESTRA CREABA OTRA MUESTRA
//
//    El editor de burbujas es el mismo en todo el panel, y trae su boton de
//    agregar. Pero una muestra de la galeria no es una secuencia: es UN archivo
//    con SU pie, y asi la manda el bot (`getImageGallery` devuelve un
//    media_type + un drive_url + un caption, sin pasos).
//
//    Sin sitio donde meter la segunda burbuja, el codigo hacia lo unico que
//    podia: crear OTRA MUESTRA, en blanco. Sin tema. Y una muestra sin tema no
//    aparece en «Info de contenido» y el bot no la envia nunca — asi que cada
//    clic dejaba basura invisible y empujaba la galeria hacia abajo.
//
//    Para otra muestra ya esta su boton, abajo del todo. Duplicar SI crea otra
//    muestra, con su contenido, que es lo que uno espera al duplicar.
//
// 2. EN LINEAL EL SEGUNDO PRODUCTO NO TENIA DONDE MARCARSE
//
//    «Info de contenido» decidia si enseñar la galeria del extra con una lista
//    de NOMBRES de modalidad: solo «Upsell» y «Doble Oferta + Upsell». Esa lista
//    se escribio cuando la etapa Upsell era de esas dos modalidades.
//
//    Desde que vive en la capa de CADA modalidad, en Lineal y en Order Bump el
//    bot ofrece el extra igual — pero sus muestras no se podian marcar, asi que
//    no salian nunca. El producto se vendia y no se podia enseñar.
//
//   node scripts/prueba-muestras-e-info-de-contenido.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");
const editor = leer("src", "app", "editor", "page.tsx");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 60)} ${valor}`);
};

// ── 1. El editor de burbujas sabe callarse el boton ──────────────────────────
comprobar(
  "el editor de burbujas admite «aqui solo cabe una»",
  /sinAgregar\?: boolean;/.test(editor) &&
    /\{!sinAgregar && \(\s*\r?\n\s*<button/.test(editor),
  "sinAgregar"
);
// Por defecto NADIE cambia: el resto del panel sigue con su boton.
comprobar(
  "y por defecto sigue estando en todas partes",
  /sinAgregar = false,/.test(editor),
  "solo se apaga donde se pide"
);

// ── 2. La muestra lo usa ─────────────────────────────────────────────────────
// LA VENTANA ES LA FUNCION ENTERA, NO UN TROZO DE LARGO FIJO. Era `i + 3000`, y
// al crecer la funcion —el 15 de septiembre de 2026 se le anadieron las acciones
// del clic derecho— el visor se quedo fuera de la ventana y «fallaba» sin que
// nada se hubiera roto.
const muestra = (() => {
  const i = editor.indexOf("function GalleryCaptionBubbleEditor(");
  if (i < 0) return "";
  const f = editor.indexOf("\nfunction GalleryEditor(", i);
  return f < 0 ? editor.slice(i) : editor.slice(i, f);
})();
// UNA MUESTRA YA PUEDE LLEVAR MAS DE UNA BURBUJA, y aqui esto cambia de sentido.
//
// Era UNA sola: un archivo con su pie. Para decir dos cosas habia que crear otra
// muestra, y las muestras se reparten por TEMA — la segunda salia en otro
// momento, o no salia. Y duplicar la burbuja creaba otra MUESTRA, que es lo que
// el operador veia como «se duplica toda la galeria».
//
// La PRIMERA sigue siendo el archivo de la muestra, que es lo que la identifica.
// Las de detras son suyas y salen pegadas a ella.
comprobar(
  "la muestra admite burbujas detrás del archivo",
  /const pasos = \[primera, \.\.\.\(item\.pasos_extra \?\? \[\]\)\];/.test(
    muestra
  ) && !/sinAgregar/.test(muestra),
  "y el botón de agregar paso vuelve"
);
comprobar(
  "la primera sigue siendo el archivo, y el resto van detrás",
  /const \[cabeza, \.\.\.resto\] = siguientes;/.test(muestra) &&
    /pasos_extra: resto,/.test(muestra),
  "duplicar ya no crea otra muestra"
);
// Y EL VISOR ENSEÑA LAS DOS. Enseñando solo la primera pareceria que la segunda
// no se manda.
// El visor dejo de ser una etiqueta suelta: desde el 15 de septiembre de 2026
// lleva ademas las acciones del clic derecho —ver
// `prueba-la-galeria-tiene-el-menu-de-siempre`—. Lo que esta comprobacion
// protege no cambia: que le pase TODAS las burbujas de la muestra, no solo la
// primera.
comprobar(
  "el visor de la muestra las enseña todas",
  /<ChatPreview\s*\r?\n?\s*steps=\{pasos\}/.test(muestra),
  "lo que va a salir"
);
// Y LAS BURBUJAS DE DETRAS TIENEN QUE SALIR DE VERDAD. Escrito en la pantalla y
// no enviado seria peor que no poder escribirlas: el operador las da por
// mandadas. Hay SEIS sitios que envian una muestra, asi que el envio vive en uno.
comprobar(
  "hay un solo sitio que envía una muestra entera",
  /export async function enviarMuestraDeGaleria\(/.test(
    leer("src", "lib", "workflow", "sender.ts")
  ),
  "no seis copias"
);
comprobar(
  "y los seis lo usan",
  (leer("src", "lib", "meta", "handler.ts").match(/enviarMuestraDeGaleria\(/g) ?? [])
    .length === 3 &&
    (leer("src", "lib", "openrouter.ts").match(/enviarMuestraDeGaleria\(/g) ?? [])
      .length === 2 &&
    (leer("src", "lib", "workflow", "engine.ts").match(/enviarMuestraDeGaleria\(/g) ?? [])
      .length === 2,
  "ninguno se queda atrás"
);
// SIN BURBUJAS EXTRA HACE LO DE ANTES. Es la garantia de que esto no cambia una
// sola venta por el hecho de existir.
comprobar(
  "sin burbujas extra manda el archivo y se acabó",
  /for \(const paso of muestra\.pasos_extra \?\? \[\]\) \{/.test(
    leer("src", "lib", "workflow", "sender.ts")
  ),
  "el bot no cambia"
);
// Y el boton de verdad para otra muestra sigue donde estaba.
comprobar(
  "y el boton de agregar muestra sigue abajo",
  /➕ Agregar muestra/.test(editor),
  "ahi si se agrega"
);

// ── 3. «Info de contenido» pregunta por lo que decide ────────────────────────
comprobar(
  "hay quien responda si esta modalidad vende el extra",
  /function modalidadVendeElExtra\(c: FullConfig\): boolean \{/.test(editor),
  "modalidadVendeElExtra"
);
// La capa manda: encendida en Lineal, el extra existe en Lineal.
comprobar(
  "y lo decide la capa de la modalidad, no una lista de nombres",
  /return c\.upsell\?\.enabled === true;/.test(editor),
  "la etapa vive en cada capa"
);
// Las dos modalidades que lo tienen de nacimiento siguen igual, y la de dos
// pestañas tambien.
comprobar(
  "las modalidades que ya lo tenian no cambian",
  /if \(mode === "upsell" \|\| mode === "doble_oferta_upsell"\) return true;/.test(
    editor
  ) &&
    /if \(mode === "doble_oferta_dos" && runtimeModality\(c\) === "doble_oferta_upsell"\)/.test(
      editor
    ),
  "nada se pierde"
);

// ── 4. Los DOS sitios usan la misma respuesta ────────────────────────────────
//
// Uno decide QUE TEMAS se pueden marcar y el otro COMO SE PINTAN agrupados. Si
// discreparan, saldria un grupo con casillas que no se pueden marcar, o al
// reves: temas marcables que no aparecen en ningun grupo.
comprobar(
  "los temas marcables miran esa misma respuesta",
  /const temasDelExtra = modalidadVendeElExtra\(c\)/.test(editor),
  "productInfoOptions"
);
comprobar(
  "y el grupo del producto tambien",
  /if \(modalidadVendeElExtra\(c\)\) \{\s*\r?\n\s*grupos\.push\(\{/.test(editor),
  "productInfoGroups"
);
comprobar(
  "y el tercero de Doble Oferta, igual",
  /const tercero = modalidadVendeElExtra\(c\)/.test(editor),
  "una sola regla para los tres"
);
// Ya no queda ninguna copia de la lista vieja decidiendo esto por su cuenta.
comprobar(
  "no queda ninguna lista de nombres suelta decidiendolo",
  (editor.match(/mode === "upsell" \|\| mode === "doble_oferta_upsell"/g) ?? [])
    .length === 1,
  "solo dentro de modalidadVendeElExtra"
);
// El cajon donde se escriben nombre y galeria del extra ya salia en todas las
// modalidades. Si se perdiera, habria temas marcables sin sitio donde crearlos.
comprobar(
  "el cajon del producto upsell sigue en todas las modalidades",
  /<Collapsible title="🛒 PRODUCTO UPSELL" enVentana>/.test(editor),
  "donde se le pone nombre y muestras"
);

console.log(
  fallos === 0
    ? "\nTODO OK — una muestra lleva sus burbujas, y el extra se puede marcar"
    : `\n${fallos} comprobacion(es) mal.`
);
process.exit(fallos === 0 ? 0 : 1);
