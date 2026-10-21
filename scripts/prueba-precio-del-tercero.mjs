// LOS TRES PRECIOS de "Doble Oferta + Upsell", y su comodin.
//
// La modalidad vende basico, combo y un tercer producto. Los dos primeros ya
// tenian {{precio_1}} y {{precio_2}} y salen del punto unico de las dos
// opciones, asi que funcionan solos. El tercero no tenia nada.
//
// EL FALLO QUE HABIA, Y NO SE VEIA
//
// En la invitacion al tercer producto, {price} valia el precio del CURSO BASE.
// No es un hueco vacio: es un numero equivocado y creible. Se le anunciaba el
// tercero al precio del primero, y nadie lo nota hasta que alguien paga de
// menos.
//
// Lo que se fija aqui:
//
//  1. Que el tercero se anuncie con SU precio, en la invitacion y en la
//     pregunta.
//  2. Que exista {{precio_upsell}} con las mismas cuatro formas que los otros
//     dos, y que la forma escueta se sustituya LA ULTIMA — si no, se comeria
//     el principio de las largas y esas no saldrian nunca.
//  3. Que se vea igual en la previsualizacion que en el chat del cliente.
//  4. Que tenga precio normal y de oferta POR PAIS, como los demas.
//
//   node scripts/prueba-precio-del-tercero.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");

const config = leer("src", "lib", "workflow", "config.ts");
const engine = leer("src", "lib", "workflow", "engine.ts");
const editor = leer("src", "app", "editor", "page.tsx");
const api = leer("src", "app", "api", "workflow", "route.ts");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 60)} ${valor}`);
};

// ── 1. El tercero se anuncia con SU precio ──────────────────────────────────
comprobar(
  "la invitación usa el precio del tercero, no el del curso",
  /const precioDelExtra =\s*\r?\n?\s*getUpsellPriceSoles\(/.test(engine) &&
    /sendResponseStep\(convo, step as ResponseStep, precioDelExtra, true\)/.test(
      engine
    ),
  "el suyo"
);
comprobar(
  "y respeta el descuento de la conversación",
  /getUpsellPriceSoles\(\s*\r?\n?\s*isDiscountActiveForConversation\(convo, config\)/.test(
    engine
  ),
  "sí"
);
comprobar(
  "la pregunta también resuelve precios",
  /const pregunta = applyPriceTemplate\(\s*\r?\n?\s*renderOrderBumpTemplate\(/.test(
    engine
  ),
  "sí"
);

// ── 2. El comodín existe, y AHORA TRAE SU MONEDA ────────────────────────────
//
// Antes tenia cuatro formas: la escueta (el numero pelado), la "completa", la
// de mayusculas y la de minusculas. Cuatro entradas de lista para un dato, y
// la escueta obligaba a escribir el "S/." y el "SOLES" a mano al lado — que es
// justo lo que le dice la moneda equivocada a un cliente de otro pais.
//
// Ahora {{precio_upsell}} trae su simbolo y su moneda, y como se escribe la
// palabra lo decide el boton May/Min/Off de su cajon. Las otras tres siguen
// resolviendose en el motor para los textos que ya las tengan escritas.
for (const [forma, patron] of [
  ["con su moneda", /precio_upsell\|precio_upsell_solo\|precio_3\|precio3/],
  ["completa", /precio_upsell_completo\|precio_3_completo/],
  ["MAYÚSCULAS", /precio_upsell_mayusculas\|precio_3_mayusculas/],
  ["minúsculas", /precio_upsell_minusculas\|precio_3_minusculas/],
]) {
  comprobar(`{{precio_upsell}} en su forma ${forma}`, patron.test(config), "sí");
}
comprobar(
  // Ya no hace falta que vaya la ultima: cada expresion exige la llave de
  // cierre justo despues del nombre, asi que la corta no puede comerse el
  // principio de las largas. Lo que si se comprueba es que siga cerrada.
  "ninguna forma se come el principio de otra",
  /precio_upsell\|precio_upsell_solo\|precio_3\|precio3\|price_upsell\|upsell_price\)\\s\*\\\}\\\}/.test(
    config
  ),
  "cada una exige su llave de cierre"
);
comprobar(
  "sale del mismo sitio que los otros dos precios",
  /const upsellPrice = getUpsellPriceSoles\(discountActive, phone \?\? null\);/.test(
    config
  ),
  "un solo sitio"
);

// ── 3. Se ve igual en la pantalla que en el chat ────────────────────────────
comprobar(
  "está en el catálogo de comodines del editor",
  /token: "\{\{PRECIO_UPSELL\}\}"/.test(editor) &&
    /token: "\{\{PRECIO_UPSELL_COMPLETO\}\}"/.test(editor),
  "sí"
);
comprobar(
  "la previsualización lo pinta",
  /const resolvedUpsellPrice = context\?\.upsellPrice;/.test(editor) &&
    /precio_upsell\|precio_3\|precio3\|price_upsell\|upsell_price/.test(editor),
  "sí"
);
comprobar(
  // Igual que en el motor: cada forma exige su llave de cierre, asi que el
  // orden ya no puede hacer que una se coma a otra.
  "y en la preview cada forma exige su llave de cierre",
  /precio_upsell\|precio_upsell_solo\|precio_3\|precio3\)\\s\*\\\}\\\}/.test(
    editor
  ),
  "sí"
);
comprobar(
  // LA FICHA MANDA, y lo que ahi este en blanco lo rellena la capa del pais —
  // que es lo que hace el motor. Cayendo directo al numero guardado en la etapa,
  // la pantalla enseñaba uno y el cliente leia otro.
  //
  // EL ORDEN SE CORRIGIO EL 21/09/2026 Y ESTA AFIRMACION CON EL. Decia «el pais
  // manda», que era al reves de lo que hace `preciosDeLaFichaEnElPais` en el
  // motor: con los dos llenos, la pantalla decia 10 y el bot cobraba 8. Lo que
  // esta comprobacion QUIERE decir no ha cambiado —que los dos digan lo mismo—;
  // lo que cambia es el orden que exige.
  "la preview usa la FICHA y luego el precio por país, como el bot",
  /upsellPrice:\s*\r?\n?\s*precioDeLaFicha\(c, "upsell"\) \?\?\s*\r?\n?\s*numeroUtil\(selectedProfile\?\.upsell\?\.price_soles\)/.test(
    editor
  ),
  "mismo precio"
);

// ── 4. Precio normal y de oferta, por país ──────────────────────────────────
comprobar(
  "el perfil de cada país guarda el precio del tercero",
  /upsell\?: \{\s*\r?\n\s*price_soles\?: number;\s*\r?\n\s*discount_price_soles\?: number;/.test(
    editor
  ),
  "sí"
);
comprobar(
  "hay campo de precio normal Y de descuento",
  /Precio producto upsell \(/.test(editor) &&
    /Precio producto upsell — descuento \(/.test(editor),
  "los dos"
);
// SE MUESTRAN DONDE HAY PRODUCTO QUE COBRAR, NO EN UNA MODALIDAD.
//
// Antes eran de Doble Oferta + Upsell porque era la unica con etapa Upsell. El
// motor nunca lo vio asi: resuelve `modality_payment_profiles[modalidad][pais]`
// para la que este vendiendo, sea cual sea. Con el boton encerrado, en Lineal y
// en Order Bump el upsell se quedaba con un unico precio global para todos los
// paises.
//
// El criterio es el mismo que su cajon de entrega por canal: si la etapa tiene
// nombre, hay producto; si no lo tiene, un boton de precio sin producto detras
// solo confunde.
comprobar(
  "se muestran donde la etapa tiene nombre",
  /\(layerMode === "doble_oferta_upsell" \|\|\s*\r?\n?\s*!!\(cfg\.upsell\?\.name \?\? ""\)\.trim\(\)\) && \(/.test(
    editor
  ),
  "sí"
);
comprobar(
  "y la API los guarda en los dos sentidos",
  // Al menos cuatro: los dos campos de precio (normal y oferta) en los dos
  // sitios, el que lee el yaml y el que lo escribe. Con menos, la capa por país
  // se perdería en el viaje. Pueden ser más — al tercer producto se le sumó
  // despues su precio anterior — pero nunca menos.
  (api.match(/p\?\.upsell as Record<string, unknown>/g) ?? []).length >= 4,
  "ida y vuelta"
);

// ── 5. Los minutos de espera se pueden tocar ────────────────────────────────
//
// Sin campo en la pantalla no solo no se podia cambiar: el editor mandaba el
// valor vacio y el primer guardado lo dejaba en 0, asi que el tercer producto
// salia pegado a la entrega. Y nada avisaba del cambio.
comprobar(
  "los minutos de espera tienen campo propio",
  /value=\{cfg\.upsell\?\.retraso_minutos \?\? 5\}/.test(editor) &&
    /retraso_minutos: value/.test(editor),
  "sí"
);
// YA NO ES DE UNA SOLA MODALIDAD.
//
// Se pedía aquí porque la etapa Upsell existía solo dentro de Doble Oferta +
// Upsell. Ahora es una capa de cada modalidad, y el motor nunca miró la
// modalidad para esto: lee `retraso_minutos` de la etapa que esté vendiendo.
// Dejar el campo encerrado hacía que en Lineal y en Order Bump la espera se
// quedara en 0 y el upsell saliera pegado a la entrega — el mismo fallo que
// esta prueba nació para vigilar, solo que en las otras modalidades.
comprobar(
  "y aparece en todas las modalidades",
  /Minutos desde la entrega hasta ofrecer el Upsell/.test(editor) &&
    !/activeModality\(cfg\) === "doble_oferta_upsell" \? \([\s\S]{0,900}?retraso_minutos/.test(
      editor
    ),
  "sí"
);
comprobar(
  "y viajan a la API en los dos sentidos",
  (api.match(/retraso_minutos/g) ?? []).length >= 4,
  "ida y vuelta"
);

// ── 6. Vender por país no depende de la modalidad ───────────────────────────
//
// "Vender en este pais" es una decision GLOBAL. Si dependiera de la modalidad,
// encender Argentina y cambiar de modalidad la apagaria en silencio — que es
// justo el fallo que se corrigio y no puede volver.
comprobar(
  "la bandera del país manda sobre cualquier modalidad",
  /const flag = config\?\.country_sales_enabled\?\.\[country\];\s*\r?\n\s*if \(typeof flag === "boolean"\) return flag;/.test(
    config
  ),
  "manda ella"
);

// ── 7. Los tres precios, con nombre y a la vista ────────────────────────────
//
// EL FALLO: los campos del Full estaban condicionados a la modalidad Order
// Bump, asi que en "Doble Oferta + Upsell" NO APARECIAN. El Full se quedaba sin
// precio por pais y cobraba el global —en soles— aunque se vendiera en otro
// pais. No se veia venir: el campo no existia, no es que estuviera en cero.
//
// Y las etiquetas repetian el nombre de la modalidad ("Precio — Doble Oferta +
// Upsell") en vez de decir de QUE producto era cada una.
comprobar(
  "el precio del Full existe en esta modalidad",
  /label=\{`Precio producto full \(\$\{country\.currency\}\)`\}/.test(editor),
  "a la vista"
);
comprobar(
  "y tiene su precio de descuento",
  /label=\{`Precio producto full — descuento \(\$\{country\.currency\}\)`\}/.test(
    editor
  ),
  "sí"
);
comprobar(
  "se guarda donde el motor lo lee",
  /combo_price_soles: v > 0 \? v : 0/.test(editor),
  "mismo sitio"
);
for (const [que, patron] of [
  ["producto base", /`Precio producto base \(\$\{country\.currency\}\)`/],
  ["base con descuento", /`Precio producto base — descuento \(\$\{country\.currency\}\)`/],
  ["producto upsell", /`Precio producto upsell \(\$\{country\.currency\}\)`/],
  ["upsell con descuento", /`Precio producto upsell — descuento \(\$\{country\.currency\}\)`/],
]) {
  comprobar(`la etiqueta dice «${que}», no el nombre de la modalidad`, patron.test(editor), "clara");
}

// ── 8. Un solo desplegable de comodines ─────────────────────────────────────
//
// Habia DOS haciendo lo mismo: el que sigue al cursor y otro clavado arriba a
// la izquierda del campo. Al escribir {{ se abrian los dos y el fijo tapaba al
// otro: dos listas iguales superpuestas, ninguna legible.
comprobar(
  "no queda el desplegable de posición fija",
  !/absolute left-2 top-9 z-30 max-h-64/.test(editor),
  "fuera"
);
comprobar(
  "y sigue el que va pegado al cursor",
  /left: state\.x, top: state\.y/.test(editor),
  "sigue la palabra"
);

// ── 9. El NOMBRE del tercer producto ────────────────────────────────────────
//
// Habia comodin para su PRECIO pero no para su NOMBRE: no se podia nombrar el
// producto que se estaba ofreciendo.
comprobar(
  "{{PRODUCTO_UPSELL}} existe",
  /token: "\{\{PRODUCTO_UPSELL\}\}"/.test(editor) &&
    /export function getProductNameUpsell/.test(config),
  "sí"
);
comprobar(
  // "producto_upsell" empieza por "producto": si se sustituyera despues, el de
  // {{PRODUCTO}} ya se habria comido su principio y quedaria "_upsell" suelto.
  "y se sustituye ANTES que {{PRODUCTO}}",
  // El segundo producto se llamaba solo "producto2"; ahora la misma linea
  // acepta ademas "producto_secundario". El orden que se comprueba es el
  // mismo: primero el del tercer producto, luego el segundo, luego el
  // generico.
  config.indexOf("producto_upsell|producto3") <
    config.indexOf("producto_secundario") &&
    editor.indexOf("producto_upsell|producto3") <
      editor.indexOf("(producto|product)"),
  "primero el largo"
);
comprobar(
  "sale de la modalidad activa, no de una fija",
  /return seccionUpsell\(\)\?\.name\?\.trim\(\) \|\| "";/.test(config),
  "sí"
);

// ── 10. Los comodines de Order Bump no se cuelan ────────────────────────────
comprobar(
  "en esta modalidad no salen los de Order Bump",
  /const SOLO_ORDER_BUMP =/.test(editor) &&
    /mode === "doble_oferta_upsell"[\s\S]{0,160}?!SOLO_ORDER_BUMP\.test/.test(
      editor
    ),
  "filtrados"
);
comprobar(
  "y los del upsell no salen donde no hay tercer producto",
  // Se comprueba que la lista EXISTE y que lleva los dos del tercer producto,
  // no su texto exacto: a esa lista se le suman comodines nuevos (el precio
  // anterior del extra, por ejemplo) y fijarse en la letra la volvia fragil.
  /const SOLO_CON_UPSELL =/.test(editor) &&
    /SOLO_CON_UPSELL =[\s\S]{0,160}PRECIO_UPSELL[\s\S]{0,80}PRODUCTO_UPSELL/.test(
      editor
    ),
  "filtrados"
);

// ── 11. La vista previa también escribe la moneda bien ──────────────────────
//
// LA INTENCION DE ESTA COMPROBACION NO CAMBIA: la vista previa tiene que escribir
// la moneda igual que el bot. Lo que cambio es COMO se garantiza.
//
// Antes la pantalla tenia su PROPIA copia del formateador, y esta prueba vigilaba
// que esa copia dijera lo mismo. No alcanzo: el 30/09/2026 se midieron ONCE
// diferencias —el singular ("1 Soles"), la parte pequeña ("S/. 0.90 Soles"), el
// simbolo de Costa Rica y el minimo pagable—. Vigilar que dos copias coincidan es
// perseguirlas; ahora hay UNA.
comprobar(
  "la vista previa le pregunta al bot, no formatea ella",
  /return formatCurrencyAmount\(amount, countryCode, currencyCode, labelCase\);/.test(
    editor
  ),
  "una sola funcion"
);
comprobar(
  "y no le queda una copia de los nombres de moneda",
  !/PEN: "soles"/.test(editor) &&
    !/\["ARS", "MXN", "COP", "CLP"\]\.includes\(currency\)/.test(editor),
  "ni de los cuatro pesos"
);

console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} comprobación(es) mal.`);
process.exit(fallos === 0 ? 0 : 1);
