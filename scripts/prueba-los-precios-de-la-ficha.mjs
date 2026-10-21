// LA FICHA MANDA CUANDO PRECIOS Y PAGOS ESTA EN BLANCO.
//
// LO QUE PASABA
//
//   En modalidad LINEAL, con el precio del pais en cero —que es lo normal cuando
//   se llena la ficha del producto y no Precios y pagos— al cliente le llegaba la
//   burbuja de la intro asi:
//
//     ❌(antes) ~~        ✅ HOY: ‼️        Realiza un unico pago de **
//
//   Sin una sola cifra. Y no era que el precio fuera cero: la ficha tenia 10
//   puesto, y su precio anterior 45.
//
//   DOS AGUJEROS DISTINTOS EN LA MISMA BURBUJA:
//
//   1. `{{PRECIO_BASE}}` pregunta por el precio del «basico» de la oferta de dos
//      opciones. En Lineal no hay oferta de dos opciones, asi que se quedaba sin
//      producto del que sacarlo y lo unico que le restaba era el precio del pais.
//      Nunca miraba la ficha, ni el precio general.
//
//   2. `{{PRECIO_MERCADO}}`, el «antes» tachado, solo miraba el del pais. El de la
//      ficha no lo leia nadie, en ninguna modalidad. No habia ni sitio donde
//      dejarlo.
//
// COMO SE ARREGLO, Y POR QUE ASI
//
//   NO SE CAMBIA LA PRIORIDAD. Precios y pagos sigue mandando: es lo que permite
//   cobrar distinto en cada pais. Lo que cambia es que la ficha pasa a ser el
//   respaldo DE VERDAD en vez de un cero.
//
//   Y se compara contra cero a mano, sin `??`. Un cero contaria como respuesta y
//   el respaldo no entraria nunca — que es exactamente el fallo que esto arregla.
//
// LO QUE NO PUEDE VOLVER A PASAR
//
//   1. Que un comodin de precio salga vacio teniendo la ficha llena.
//   2. Que `{{PRECIO_FULL}}` enseñe un numero en una modalidad que no tiene Full.
//      El perfil del pais guarda ese precio aunque la modalidad no lo use, y ahi
//      se quedaba el de la ultima vez que si lo tuvo. Una cifra que no es de
//      ningun producto de esta modalidad es peor que ninguna cifra.
//   3. Que los dos renderizadores de comodines discrepen. Son dos y no siempre
//      corren los dos: un precio resuelto por un camino y vacio por el otro es de
//      los fallos que no se ven hasta que un cliente lo lee.
//
//   node scripts/prueba-los-precios-de-la-ficha.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");
const config = leer("src", "lib", "workflow", "config.ts");
const motor = leer("src", "lib", "workflow", "engine.ts");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// -- 1. EL «ANTES» DE LA FICHA TIENE DONDE VIVIR -----------------------------
comprobar(
  "el precio anterior del base tiene su respaldo",
  /^  market_price\?: number;$/m.test(config),
  "gemelo de course_price_soles"
);
// LA CAPA LO RELLENA, como ya hacía con el precio. Del producto del puesto base:
// el Único en Lineal, el Básico en las de dos opciones.
comprobar(
  "y lo rellena la capa desde la ficha",
  /if \(typeof basico\?\.market_price === "number" && basico\.market_price > 0\) \{\s*\r?\n?\s*next\.market_price = basico\.market_price;/.test(
    config
  ),
  "del puesto base"
);

// -- 2. UN SOLO SITIO PARA LA REGLA ------------------------------------------
//
// Hay DOS renderizadores de comodines y no siempre corren los dos. Escrita dos
// veces, la regla se separa: un precio resuelto por un camino y vacío por el otro.
comprobar(
  "la regla del respaldo se escribe una vez",
  /export function mercadoConRespaldo\(/.test(config),
  "la usan los dos"
);
comprobar(
  "y la usan los dos renderizadores",
  /mercadoConRespaldo\(\s*\n?\s*perfilPais\?\.market_price/.test(config) &&
    /mercadoConRespaldo\(perfilDelPais\?\.market_price, config\?\.market_price\)/.test(
      motor
    ),
  "no pueden discrepar"
);
// Y LA FICHA MANDA EN LOS DOS, EN EL MISMO ORDEN — 17/09/2026.
//
// Al dar prioridad a la ficha se puso solo en UNO de los dos renderizadores, y
// esta prueba lo destapó en la primera pasada: el tachado habría salido de la
// ficha por un camino y del país por el otro. Es exactamente el fallo que esta
// sección protege, con un dato nuevo.
comprobar(
  "y en los dos manda la ficha, primero",
  /const tachadoDeLaFicha = \(\(\) => \{/.test(config) &&
    /const precioMercado =\s*\n\s*preciosDeLaFichaEnElPais\("unico", countryCode, config\)\.tachado \?\?/.test(
      motor
    ),
  "misma prioridad en los dos"
);
// SIN `??`: un cero es un campo sin llenar, no una respuesta. Con `??` el
// respaldo no entraría nunca, que es el fallo original.
comprobar(
  "un cero no cuenta como respuesta",
  /if \(typeof delPais === "number" && Number\.isFinite\(delPais\) && delPais > 0\)/.test(
    config
  ),
  "por eso no hay ??"
);

// -- 3. EL PRECIO DEL BASE FUERA DE LAS DOS OPCIONES -------------------------
//
// En Lineal y en la modalidad Upsell hay UN producto, y su precio ya está
// resuelto: es el mismo que da {{PRECIO}}, con el país mandando y la ficha
// detrás. `{{PRECIO_BASE}}` tiene que dar ése.
comprobar(
  "sin oferta de dos opciones, el base es el único",
  /if \(!getActiveTwoTierOffer\(config\)\) \{[\s\S]{0,120}?const delUnico = getEffectivePriceSoles\(discountActive, phone\);/.test(
    config
  ),
  "el mismo que {{PRECIO}}"
);
// Y EL FULL, VACÍO. No existe en esas modalidades, y el perfil del país guarda
// su precio igual: salía el de la última vez que sí lo tuvo.
comprobar(
  "y el full se queda vacío, no con el número viejo",
  /if \(!getActiveTwoTierOffer\(config\)\) \{\s*\r?\n?\s*if \(key === "combo"\) return null;/.test(
    config
  ),
  "sin producto no hay precio"
);

// -- 4. LA PRIORIDAD NO CAMBIA -----------------------------------------------
//
// Precios y pagos sigue mandando: es lo que permite cobrar distinto en cada
// país. La ficha es el respaldo. Invertirlo dejaría a los países que sí tienen
// su precio propio cobrando el de la ficha.
comprobar(
  "el precio del país sigue mandando sobre la ficha",
  /typeof profile\?\.course_price_soles === "number" &&\s*\r?\n?\s*profile\.course_price_soles > 0/.test(
    config
  ),
  "la ficha solo rellena el hueco"
);

// -- 5. Y EL VISOR DEL EDITOR ENSEÑA LO MISMO --------------------------------
//
// El editor lee la configuracion CRUDA; el reparto de los puestos lo hace el
// motor al arrancar. Con la ficha en 10 y Precios y pagos en blanco, el bot
// cobraba 10 y la pantalla enseñaba 7, el numero viejo del archivo.
//
// Un visor que enseña una cifra y manda otra es peor que no tener visor: no
// parece roto, parece que el reparto fallo. Es el mismo arreglo que ya se hizo
// con los NOMBRES, al que le faltaban los precios.
const editor = leer("src", "app", "editor", "page.tsx");
comprobar(
  "el visor sabe qué ficha juega cada puesto",
  /function fichaEnPuesto\(/.test(editor) &&
    /function precioDeLaFicha\(/.test(editor) &&
    /function mercadoDeLaFicha\(/.test(editor),
  "como el motor"
);
// EL ORDEN CAMBIO EL 21/09/2026, Y LA INTENCION DE ESTAS DOS NO.
//
// Seguian diciendo lo mismo que hoy —que el visor no puede mentir— pero fijaban
// el orden VIEJO: primero la capa del pais y despues la ficha. El MOTOR pregunta
// al reves, y mientras uno de los dos estuviera vacio daba igual; en cuanto los
// dos tenian numero, la pantalla enseñaba uno y el cliente pagaba otro.
//
// Medido en el contenido del dueño, cuatro casos discrepaban: order_bump EC
// (10 contra 5.70), doble oferta PE full (10 contra 14), PE upsell (10 contra 8)
// y EC basico (2 contra 3). El lo pidio con estas palabras: «que se respeten los
// precios de las fichas y que ese precio sea el correcto para el cobro, nada de
// falsedades ni errores».
//
// Asi que se conserva lo que querian decir y se actualiza el orden que exigen.
comprobar(
  "el precio del base pregunta a la FICHA antes que a la capa",
  /precioDeLaFicha\(c, "unico"\) \?\?\s*\r?\n?\s*numeroUtil\(profile\?\.course_price_soles\)/.test(
    editor
  ),
  "ficha, país, y al final el viejo — el orden del motor"
);
comprobar(
  "el «antes» del visor también",
  /marketPrice:\s*\r?\n?\s*mercadoDeLaFicha\(c, "basico", "unico"\) \?\?\s*\r?\n?\s*numeroUtil\(selectedProfile\?\.market_price\)/.test(
    editor
  ),
  "sin ??, por el cero"
);
comprobar(
  "y NINGUNA vista pregunta a la capa antes que a la ficha",
  [
    ...editor.matchAll(
      /numeroUtil\([^)]*\)\s*\?\?\s*\r?\n?\s*(precioDeLaFicha|mercadoDeLaFicha)\(/g
    ),
  ].length === 0,
  "es lo que hacía que el visor y el cobro se separaran"
);
comprobar(
  "y el del producto upsell, en toda su pestaña",
  /function precioDelUpsellEnElVisor\(/.test(editor) &&
    !/priceSoles=\{cfg\.upsell\?\.price_soles \?\? 0\}/.test(editor),
  "ni uno a pelo"
);
// EL FULL, VACIO FUERA DE SUS MODALIDADES, igual que en el motor. Si el visor lo
// enseñara y el bot no, se corregiria un problema que no existe.
comprobar(
  "el full del visor se calla donde no hay full",
  /if \(!modalidadDeDosOpciones\(c\)\) return 0;/.test(editor),
  "como el motor"
);
// LOS DOS SITIOS DEL VISOR, UNO SOLO. El contexto y las funciones sueltas daban
// el precio por su cuenta, y el prop pisa al contexto: arreglando uno, el otro
// seguia mintiendo por la mitad de las pantallas.
comprobar(
  "el contexto y las funciones dan el mismo número",
  /comboPrice: previewComboPriceFromConfig\(c, countryCode\)/.test(editor) &&
    /basicoPrice: previewBasicoPriceFromConfig\(c, countryCode\)/.test(editor),
  "no pueden discrepar"
);

console.log(
  fallos === 0
    ? "\nTODO OK — la ficha rellena lo que Precios y pagos deja en blanco"
    : `\n${fallos} FALLO(S)`
);
process.exit(fallos === 0 ? 0 : 1);
