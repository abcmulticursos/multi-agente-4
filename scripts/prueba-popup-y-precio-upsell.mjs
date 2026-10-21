// Tres cosas del editor que hacian dudar de lo que uno acababa de hacer.
//
// 1. EL POP-UP DE LA BURBUJA GUARDABA SIEMPRE. En el modo camino se abre una
//    ventanita para editar la burbuja. Escribia directo en la configuracion,
//    asi que salir con Escape o con un clic fuera dejaba el cambio hecho igual
//    que el boton "Listo". Los tres caminos hacian lo mismo: no habia manera de
//    arrepentirse, y el que se arrepentia creia haberlo deshecho.
//
// 2. EL PRECIO CON DESCUENTO DEL UPSELL ERA UNA CASILLA PELADA. En Precios y
//    pagos ese mismo campo muestra el porcentaje y avisa si el descuento sale
//    mas caro que el precio normal. Aqui no avisaba nada. Dos sitios para lo
//    mismo comportandose distinto hacen dudar de cual manda.
//
// 3. HABIA DOS PRECIOS DEL UPSELL Y DOS GALERIAS DEL UPSELL. La pestana Upsell
//    escribia el precio GLOBAL; Precios y pagos escribia el del PAIS — y el del
//    pais manda. Se corregia uno y el bot seguia cobrando el otro. Un precio
//    equivocado no da error: cobra de menos, y eso no se nota hasta el cierre
//    del mes. Con la galeria pasaba parecido: dos casillas sobre el mismo
//    campo, subir una foto en una la hacia aparecer o desaparecer en la otra.
//
//   node scripts/prueba-popup-y-precio-upsell.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");

const editor = leer("src", "app", "editor", "page.tsx");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// El pop-up de la burbuja: de la primera linea de la funcion al cierre.
const iPopup = editor.indexOf("function JourneyStepEditorModal");
const finPopup = editor.indexOf("function JourneyPreviewSection");
const popup = editor.slice(iPopup, finPopup);

// ── 1. El pop-up solo guarda con "Listo" ────────────────────────────────────
comprobar(
  "el pop-up existe y se pudo leer entero",
  iPopup > 0 && finPopup > iPopup,
  `${finPopup - iPopup} letras`
);
comprobar(
  "se edita un borrador, no la configuración",
  /const \[borrador, setBorrador\] = useState<EditorStep\[\]>\(steps\);/.test(
    popup
  ) && /const step = borrador\[stepIndex\];/.test(popup),
  "copia aparte"
);
comprobar(
  "cada cambio va al borrador",
  /const update = \(patch: Partial<EditorStep>\) => \{\s*\r?\n\s*setBorrador\(/.test(
    popup
  ),
  "sí"
);
comprobar(
  // La prueba de verdad: onChange NO puede aparecer dentro de update ni en
  // ningun sitio que no sea el boton. Si vuelve a colarse ahi, Escape volveria
  // a guardar y nadie lo notaria hasta perder un texto.
  "solo hay UNA llamada a onChange en todo el pop-up",
  (popup.match(/onChange\(/g) ?? []).length === 1,
  "una"
);
comprobar(
  // El boton se llama ahora «Guardar». Decia «Listo», que no distingue entre
  // guardar y salir: es lo mismo que dicen las ventanas que solo cierran.
  "y esa llamada es la del botón Guardar",
  /const aplicarYCerrar = \(\) => \{\s*\r?\n\s*onChange\(borrador\);\s*\r?\n\s*onClose\(\);/.test(
    popup
  ) && /onClick=\{aplicarYCerrar\}[\s\S]{0,140}?>Guardar</.test(popup),
  "sí"
);
comprobar(
  "Escape cierra sin guardar",
  /if \(event\.key !== "Escape"\) return;[\s\S]{0,220}?onClose\(\);/.test(popup) &&
    !/if \(event\.key !== "Escape"\) return;[\s\S]{0,220}?onChange\(/.test(popup),
  "descarta"
);
comprobar(
  "hay botón de Cancelar, para salir a propósito",
  /onClick=\{onClose\}[\s\S]{0,160}?>Cancelar</.test(popup),
  "sí"
);
comprobar(
  "al cambiar de burbuja el borrador se recarga",
  /setBorrador\(steps\);[\s\S]{0,120}?\}, \[stepIndex\]\);/.test(popup),
  "sí"
);
comprobar(
  "la vista previa del pop-up muestra el borrador",
  /<ChatPreview steps=\{\[step\]\}/.test(popup),
  "en vivo"
);

// ── 2. El descuento del upsell, igual que en Precios y pagos ────────────────
comprobar(
  "el descuento del upsell usa el campo de Precios y pagos",
  /<OfferPriceField\s*\r?\n\s*label="Precio de descuento \(0 = sin descuento\)"/.test(
    editor
  ),
  "OfferPriceField"
);
comprobar(
  "y ya no queda la casilla pelada de antes",
  !/value=\{cfg\.upsell\?\.discount_price_soles \?\? 0\}\s*\r?\n\s*onValueChange=/.test(
    editor
  ),
  "fuera"
);

// ── 3. Un solo precio del upsell ────────────────────────────────────────────
comprobar(
  "la pestaña Upsell lee el precio del país que está elegido",
  /const delPais = capa\[cc\]\?\.upsell;/.test(editor) &&
    /delPais\?\.price_soles \?\? cfg\.upsell\?\.price_soles \?\? 0/.test(editor),
  "el del país"
);
comprobar(
  "y lo escribe en la MISMA capa que Precios y pagos",
  /\[modoDeLaCapa\]: \{\s*\r?\n\s*\.\.\.capa,\s*\r?\n\s*\[cc\]: \{\s*\r?\n\s*\.\.\.sembrado,\s*\r?\n\s*upsell: \{ \.\.\.sembrado\.upsell, \.\.\.parche \},/.test(
    editor
  ),
  "misma capa"
);
comprobar(
  "si el país aún no tiene capa, se siembra de la suya",
  /mergeCountryPaymentProfileForEditor\(\s*\r?\n\s*cc,\s*\r?\n\s*cfg,\s*\r?\n\s*cfg\.payment_profiles_by_country\?\.\[cc\]\s*\r?\n\s*\)/.test(
    editor
  ),
  "sí"
);
// LA EXCEPCION SE CAYO, Y ERA UNA PREMISA EQUIVOCADA.
//
// Aqui se exigia que fuera de Doble Oferta + Upsell la casilla escribiera el
// precio GLOBAL, «porque escribir una capa que nadie lee seria perder el precio
// en silencio». Pero si la lee: `resolveCountryPaymentProfile` resuelve
// `modality_payment_profiles[modalidad][pais]` para la modalidad que vende, sea
// cual sea — nunca hubo excepcion en el motor. La que faltaba era la casilla en
// «Precios y pagos», y ya esta.
//
// Lo que queda por vigilar es lo de siempre: UN precio, UN sitio. Que las dos
// casillas escriban la misma capa, y que ninguna se quede escribiendo la global
// mientras la otra escribe la del pais — la del pais manda, y el numero que se
// corrige no seria el que se cobra.
comprobar(
  "ninguna casilla se queda escribiendo la global por su cuenta",
  !/if \(!porPais\) \{\s*\r?\n\s*setCfg\(\{\s*\r?\n\s*\.\.\.cfg,\s*\r?\n\s*upsell: \{ \.\.\.cfg\.upsell, \.\.\.parche \},/.test(
    editor
  ),
  "un precio, un sitio"
);
comprobar(
  "y la capa que se escribe es la de la modalidad que se edita",
  /const modoDeLaCapa = activeModality\(cfg\);/.test(editor) &&
    /cfg\.modality_payment_profiles\?\.\[modoDeLaCapa\] \?\? \{\}/.test(editor),
  "cada modalidad, la suya"
);

// ── 4. Una sola galería del tercer producto ─────────────────────────────────
// AHORA HAY UNA SOLA, Y PARA TODAS.
//
// Antes eran dos editores excluyentes del MISMO campo: el cajon de Contenido
// —solo en Doble Oferta + Upsell— y una galeria propia en la pestaña Upsell
// para las demas. Al abrir ese cajon a todas las modalidades, mantener las dos
// las habria dejado pintadas a la vez sobre `cfg.upsell.image_gallery`: parecen
// dos galerias distintas, y la de al lado «desaparece» en cuanto se toca una.
comprobar(
  "la galería del upsell está en Contenido, en todas las modalidades",
  /<Collapsible title="🛒 PRODUCTO UPSELL" enVentana>/.test(editor) &&
    !/\{isDobleOfertaUpsell && \(\s*\r?\n\s*<Collapsible title="🛒 PRODUCTO UPSELL"/.test(
      editor
    ),
  "en Contenido"
);
comprobar(
  "y la pestaña Upsell manda allí en vez de repetirla",
  /📸 Sus imágenes se suben en la pestaña/.test(editor) &&
    !/activeModality\(cfg\) === "doble_oferta_upsell" \? \([\s\S]{0,420}?PRODUCTO UPSELL<\/strong>/.test(
      editor
    ),
  "un aviso, sin condición"
);
comprobar(
  // Este es el candado de verdad: UN editor para ese campo en todo el archivo.
  "hay un solo editor de esa galería",
  (editor.match(/items=\{cfg\.upsell\?\.image_gallery \?\? \[\]\}/g) ?? [])
    .length === 1,
  "uno"
);

console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} comprobación(es) mal.`);
process.exit(fallos === 0 ? 0 : 1);
