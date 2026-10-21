// «Solo hay una respuesta universal al elegir el pago».
//
// Y era verdad, pero no porque faltara la funcionalidad: cada opcion YA tenia
// su «respuesta al elegir», editable desde hacia meses. Lo que pasaba es que
// NUNCA SE ENVIABA.
//
// Con el pago directo encendido —que es lo normal— `deliverOrderBumpResponse`
// se iba por su rama y volvia ANTES de llegar a esas burbujas. Lo mismo por la
// rama del metodo ya elegido. Solo se enviaban por el tercer camino, el que
// casi nadie recorre. Habia textos escritos ahi que no habia leido ningun
// cliente: «🔥 Excelente Eleccion! el precio del KIT de {{OPCION_2}}...».
//
// LO QUE VIGILA ESTA PRUEBA
//
//   1. La respuesta del producto sale en LOS TRES caminos, y ANTES de los datos
//      de pago: primero el «genial, elegiste el basico» y despues el numero de
//      cuenta. Al reves, los datos llegarian antes que la frase que los presenta.
//   2. Se salta las que estan SIN LLENAR. Varias modalidades traen aqui el texto
//      de muestra («<<TEXTO_METODO_Y_PRECIO_BASICO...>>»): encender esto sin la
//      guarda le habria mandado ese texto crudo a un cliente el primer dia.
//   3. Se puede tener mas de una y se sortea entre las encendidas.
//   4. El guardado no se las come.
//
//   node scripts/prueba-respuesta-propia-de-cada-producto.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");
const motor = leer("src", "lib", "workflow", "engine.ts");
const tipos = leer("src", "lib", "workflow", "config.ts");
const ruta = leer("src", "app", "api", "workflow", "route.ts");
const editor = leer("src", "app", "editor", "page.tsx");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// ── 1. Sale en los tres caminos, y antes del pago ──────────────────────────
const entrega = (() => {
  const i = motor.indexOf("async function deliverOrderBumpResponse(");
  // La ventana tiene que cubrir la funcion ENTERA. Al meterle una rama nueva
  // —el mensaje propio de cada producto— la respuesta al elegir se salio del
  // recorte, y la prueba dijo "no esta" cuando si estaba: solo que mas abajo.
  return i < 0 ? "" : motor.slice(i, i + 12000);
})();
// ORDER BUMP: UN SOLO ENVIO, Y AL FINAL.
//
// Su respuesta al elegir se manda por el camino de siempre —el que no usa pago
// directo ni tiene metodo ya elegido—, despues de que las otras dos ramas hayan
// vuelto. Es como funcionaba y es lo que su contenido espera.
const envios = (entrega.match(/await enviarRespuestaAlElegir\(/g) ?? []).length;
comprobar(
  "Order Bump la manda una sola vez",
  envios === 1,
  `${envios} envio`
);

// ── 1-bis. LAS DOS ENTREGAS, no solo una ───────────────────────────────────
//
// Hay DOS funciones que entregan una eleccion de dos opciones:
//
//   deliverOrderBumpResponse        -> Order Bump
//   deliverDobleOfertaPaymentDetails -> Doble Oferta y Doble Oferta + Upsell
//
// La respuesta se puso primero solo en la de Order Bump. Como la modalidad que
// vende es Doble Oferta + Upsell, el operador escribia su respuesta, la veia
// guardada, probaba... y no salia nada. Dos caminos para lo mismo y el arreglo
// aplicado a uno solo: el fallo mas facil de repetir de todo este motor.
const entregaDoble = (() => {
  const i = motor.indexOf("export async function deliverDobleOfertaPaymentDetails(");
  return i < 0 ? "" : motor.slice(i, i + 4500);
})();
comprobar(
  "Doble Oferta tambien elige la respuesta del producto",
  /const respuestaDelProducto = respuestaAlElegirProducto\(opcionElegida\);/.test(
    entregaDoble
  ),
  "no solo Order Bump"
);
const enviosDoble = (entregaDoble.match(/await enviarRespuestaAlElegir\(/g) ?? [])
  .length;
comprobar(
  "y tambien una sola vez",
  enviosDoble === 1,
  `${enviosDoble} envio`
);
comprobar(
  "por delante de sus dos caminos de pago",
  entregaDoble.indexOf("await enviarRespuestaAlElegir(") <
    entregaDoble.indexOf("await schedulePaymentResponses("),
  "los cubre a los dos"
);

// ── 1-ter. SUSTITUYE en Doble Oferta, y en Order Bump NO ───────────────────
//
// EL MISMO CAMPO, USADO DE DOS MANERAS. En Doble Oferta la «respuesta al
// elegir» ES la respuesta de pago: el operador escribe ahi las tres burbujas
// completas. Enviando ademas las genericas, el cliente recibia el precio dos
// veces y la cuenta dos veces.
//
// En Order Bump ese mismo campo PRESENTA el pago: su texto va antes del menu de
// metodos y termina pidiendo uno. Se probo a hacerlo sustituir tambien aqui y
// rompio la modalidad — el cliente elegia Yape, luego el combo, y el bot le
// volvia a preguntar el metodo que acababa de darle. Un fallo viejo, ya
// resuelto, de vuelta.
//
// La leccion, y es la que vigila esta prueba: dos modalidades con el mismo
// campo no tienen por que usarlo igual. Antes de generalizar un arreglo, mirar
// QUE HAY ESCRITO en la otra.
comprobar(
  "Doble Oferta: su respuesta sustituye a las burbujas de pago",
  /if \(respuestaDelProducto\) \{[\s\S]{0,700}await enviarRespuestaAlElegir\([\s\S]{0,260}setConversationState\(convo\.id, "payment_done"\);[\s\S]{0,260}return;/.test(
    entregaDoble
  ),
  "sustituye"
);
comprobar(
  // Callar las burbujas no puede callar el apunte: de el dependen el precio
  // contra el que se valida el comprobante y el producto que se entrega.
  "y deja igualmente anotado el metodo y el estado",
  /if \(respuestaDelProducto\) \{[\s\S]{0,1200}setSelectedPaymentMethod\(/.test(
    entregaDoble
  ),
  "no se pierde nada"
);
comprobar(
  "Order Bump conserva su flujo: la respuesta NO sustituye",
  !/if \(respuestaDelProducto\) \{/.test(entrega),
  "como estaba"
);
comprobar(
  // Sus dos ramas de arriba —pago directo y metodo ya elegido— vuelven antes de
  // llegar a la respuesta. Asi funcionaba, y asi se queda.
  "y sus dos ramas de pago vuelven antes de la respuesta",
  entrega.indexOf("await schedulePaymentResponses(") <
    entrega.indexOf("await enviarRespuestaAlElegir("),
  "el pago primero"
);
comprobar(
  // Si esas burbujas no traen los datos, el cliente elige y no recibe ningun
  // numero. No se puede impedir —hay quien cierra por otro camino— pero
  // callarlo seria dejar que se descubra con un cliente esperando.
  "el editor avisa si la respuesta no lleva los datos de pago",
  /no lleva los datos para pagar/.test(editor) &&
    /const llevaLosDatos = /.test(editor),
  "en ambar"
);

// ── 2. Nunca sale un texto sin llenar ──────────────────────────────────────
const elegir = (() => {
  const i = motor.indexOf("function respuestaAlElegirProducto(");
  return i < 0 ? "" : motor.slice(i, i + 3200);
})();
comprobar(
  // LA GUARDA CAMBIO DE SITIO, NO DE INTENCION.
  //
  // Era `sectionHasPlaceholder({ steps: vivos })`, que a proposito NO mira
  // dentro de los arrays «_variants»... y el editor guarda ahi TODO el texto,
  // dejando `body` vacio. Con la respuesta sin llenar veia `body: ""`, concluia
  // «no hay plantilla» y la daba por buena: se cancelaban las burbujas de pago
  // y luego no salia nada. Ahora se pregunta por lo que de verdad se enviara.
  // Ver scripts/prueba-sustituir-el-pago-con-nada.mjs.
  "descarta las respuestas sin llenar",
  /if \(!vivos\.some\(laBurbujaSaleDeVerdad\)\) return null;/.test(elegir),
  "nada de <<TEXTO_...>>"
);
comprobar(
  "y las burbujas apagadas",
  /\.enabled !== false/.test(elegir),
  "respeta el ON/OFF"
);
comprobar(
  // Sin candidatas no se manda nada: el bot sigue con los datos de pago, que es
  // exactamente como se comportaba antes de esto.
  "sin ninguna utilizable no manda nada",
  /if \(candidatas\.length === 0\) \{[\s\S]{0,600}return null;/.test(elegir),
  "como antes"
);

// ── 3. Varias respuestas, sorteadas ────────────────────────────────────────
comprobar(
  "el tipo admite respuestas alternativas",
  /response_variants\?:/.test(tipos),
  "response_variants"
);
comprobar(
  "se sortea entre las encendidas",
  /candidatas\[Math\.floor\(Math\.random\(\) \* candidatas\.length\)\]/.test(elegir),
  "una al azar"
);
comprobar(
  "una alternativa apagada no entra",
  /if \(variante\?\.enabled === false\) continue;/.test(elegir),
  "su interruptor manda"
);

// ── 4. El guardado no se las come ──────────────────────────────────────────
//
// La ruta filtra campo por campo: uno que no este en la lista se descarta y
// pareceria que no se guardo.
comprobar(
  "la ruta las lee",
  /response_variants: Array\.isArray\(x\?\.response_variants\)/.test(ruta),
  "vuelven a la pantalla"
);
comprobar(
  "y las escribe, solo si las hay",
  (ruta.match(/Array\.isArray\(x\?\.response_variants\) && x\.response_variants\.length > 0/g) ?? [])
    .length >= 2,
  "YAML limpio"
);

// ── 4-bis. LO QUE SE ESCRIBE ES LO QUE SE GUARDA ───────────────────────────
//
// En Doble Oferta + Upsell las dos opciones NO se editan en su propia seccion:
// el editor usa `doble_oferta_dos` como copia de trabajo y al guardar
// `armarDobleOfertaUpsell` las copia de ahi a la modalidad. Se ve en sus lineas
// «combo: c.doble_oferta_dos.combo».
//
// La ventana escribia directamente en `doble_oferta_upsell`. En pantalla se
// veia bien, y al guardar quedaba PISADO por la copia de trabajo: el texto
// nunca llegaba al archivo. No habia error, no habia aviso — simplemente no
// estaba. Es el fallo mas dificil de ver de todos: parece que guardaste.
comprobar(
  "el guardado copia las opciones desde la copia de trabajo",
  /combo: c\.doble_oferta_dos\.combo,/.test(editor) &&
    /basico: c\.doble_oferta_dos\.basico,/.test(editor),
  "armarDobleOfertaUpsell"
);
comprobar(
  "y la ventana escribe en ESA misma copia",
  /modo === "doble_oferta_upsell" \|\| modo === "doble_oferta_dos"\s*\r?\n\s*\? "doble_oferta_dos"/.test(
    editor
  ),
  "no en doble_oferta_upsell"
);
comprobar(
  "no queda ninguna escritura a la seccion pisada",
  !/\[modo\]: \{ \.\.\.oferta,/.test(editor),
  "usa claveDeEdicion"
);

// ── 5. La ventana del producto ─────────────────────────────────────────────
comprobar(
  "hay un boton por producto que abre su ventana",
  /function BotonDeProducto\(\{/.test(editor) &&
    /function VentanaDeProducto\(\{/.test(editor),
  "en vez de cajones sueltos"
);
comprobar(
  // Los mismos campos de siempre, no una copia: dos copias acaban discrepando.
  "dentro van los MISMOS campos de precio",
  /const camposDelPrecioBase = \(/.test(editor) &&
    /\{camposDelPrecioBase\}/.test(editor),
  "sin duplicar"
);
comprobar(
  "y su respuesta, junto al precio",
  /function RespuestasDelProducto\(\{/.test(editor) &&
    /Cuando el cliente elige \{etiqueta\}/.test(editor),
  "un producto, una ventana"
);
comprobar(
  // Sin ella el producto se quedaria sin respuesta al apagar las alternativas.
  // El interruptor y el boton de borrar solo se pintan para las alternativas.
  "la principal no se puede borrar ni apagar",
  /no se apaga ni se borra/.test(editor) && /\{!esPrincipal && \(/.test(editor),
  "siempre queda una"
);
comprobar(
  // Lo que faltaba en la primera version: cada respuesta abre SU ventana, y
  // dentro se le pone color. Sin color, con tres respuestas no se distingue
  // cual es cual mas que por el nombre.
  "cada respuesta abre su propia ventana",
  /function VentanaDeRespuesta\(\{/.test(editor) &&
    /onAbrir=\{\(\) => setAbierta\(i \+ 1\)\}/.test(editor),
  "un pop-up por respuesta"
);
comprobar(
  "y dentro se le elige el color",
  /COLORES_DE_DECISION\.map\(\(opcionDeColor\) => \(/.test(editor) &&
    /onClick=\{\(\) => onColor\(opcionDeColor\.valor\)\}/.test(editor),
  "la paleta de la casa"
);
comprobar(
  // Una respuesta sin burbujas no rompe nada —el bot pasa directo a los datos
  // de pago—, asi que sin aviso se queda vacia para siempre sin que nadie lo note.
  "avisa cuando una respuesta esta vacia",
  /VACÍA/.test(editor),
  "en rojo, en su chapa"
);
comprobar(
  // AHORA NO SOLO LO DICE: AHI MISMO SE ESCRIBE.
  //
  // Antes era un cartel que mandaba a otra pestaña. Tenia razon —sin eleccion
  // no hay respuesta a la eleccion— pero dejaba el cajon del producto a medias:
  // el precio aqui y lo que se dice alla. Ahora se edita EL MISMO campo del
  // pago directo sin salir del pop-up.
  "y en modalidades de un solo producto se escribe ahi mismo",
  /Cuando el cliente va a pagar \{etiqueta\}/.test(editor) &&
    /un solo producto<\/strong>, así\s*\r?\n\s*que no hay eleccion que responder/.test(
      editor.replace(/elección/g, "eleccion")
    ),
  "sin eleccion que responder"
);

console.log(
  fallos === 0
    ? "\nTODO OK — cada producto responde lo suyo, y sin mandar textos a medias"
    : `\n${fallos} FALLA(S)`
);
process.exit(fallos === 0 ? 0 : 1);
