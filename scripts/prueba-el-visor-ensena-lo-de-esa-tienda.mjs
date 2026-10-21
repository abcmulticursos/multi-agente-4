// EL VISOR DE RECORRIDO ENSEÑA LO DE ESA TIENDA Y ESE PAIS, Y NADA MAS
//
// LO PIDIO EL DUEÑO el 06/10/2026, con sus palabras:
//
//   «el visor de recorrido esta mostrando cualquier cosa… en el mismo visor veo peru,
//    ecuador argentina, esta hecho un safarrancho»
//
// Y TENIA RAZON: el visor pintaba TODOS los cajones que existen. Recibia el pais, pero solo
// lo usaba para los PRECIOS — nunca para decidir que enseñar. Con dos tiendas y tres paises
// eso son cinco veces mas cajones de los que ese cliente va a recibir.
//
// ── LO QUE MAS SE CUIDA AQUI ─────────────────────────────────────────────
//
// El lo dijo expreso: «muchisimo cuidado que no vaya a salir informacion falsa en el visor».
// Un visor que miente es peor que ninguno, porque se toman decisiones con el. De ahi las dos
// reglas que vigila esta prueba:
//
//   1. SE USAN LAS FUNCIONES DEL MOTOR, no unas propias parecidas. `soloDeSuTienda` vive en
//      su propio archivo justamente para poder leerse desde la pantalla.
//
//   2. SE FILTRA LA LISTA ENTERA, NO PIEZA A PIEZA. La regla es «si hay alguno con la bandera
//      del cliente, juegan SOLO esos». Mirando una pieza sola eso no se puede saber, asi que
//      un cajon SIN bandera pasaria el filtro aunque exista otro de Peru — y el bot usaria el
//      de Peru. El visor enseñaria uno y el cliente recibiria otro.
//
// ── Y LOS INDICES NO SE MUEVEN ───────────────────────────────────────────
//
// Desde este visor se pueden EDITAR burbujas, y el numero de la fila es lo que dice cual se
// edita. Si el filtro corriera los indices, tocar una burbuja editaria otra. Por eso se marca
// el indice ANTES de filtrar, en los dos sitios.
//
//   node scripts/prueba-el-visor-ensena-lo-de-esa-tienda.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const editor = readFileSync(join(RAIZ, "src", "app", "editor", "page.tsx"), "utf8");
const motor = readFileSync(
  join(RAIZ, "src", "lib", "workflow", "etiqueta-de-tienda.ts"),
  "utf8"
);

let fallos = 0;
const comprobar = (titulo, condicion, detalle) => {
  const marca = condicion ? "  ok  " : "> FALLA";
  if (!condicion) fallos++;
  console.log(`${marca} ${String(titulo).padEnd(56)} ${detalle ?? ""}`);
};

// -- 1. LA MISMA REGLA QUE EL MOTOR ----------------------------------------
comprobar(
  "el visor usa la regla del motor, no una propia",
  /import \{[\s\S]{0,120}soloDeSuTienda,[\s\S]{0,80}\} from "@\/lib\/workflow\/etiqueta-de-tienda"/.test(
    editor
  ),
  "no puede desmentir al bot"
);
comprobar(
  "y esa regla sigue viviendo donde los dos la ven",
  /export function soloDeSuTienda/.test(motor),
  "en su propio archivo"
);

// -- 2. SE FILTRA LA LISTA, NO PIEZA A PIEZA -------------------------------
//
// EL CENTINELA DE ESTA PRUEBA. Si alguien lo cambia a pieza a pieza, el visor empieza a
// enseñar cajones que el bot no usa, y no da ningun error.
comprobar(
  "se filtra la lista entera",
  /const losQueJuegan = <T,>\(lista: T\[\], tiendaId: string, semi: string\): T\[\]/.test(editor),
  "pieza a pieza seria mas permisivo que el bot"
);
comprobar(
  "y queda escrito por que",
  /un cajón SIN bandera pasaría el filtro aunque/.test(editor),
  "para que nadie lo «simplifique»"
);

// -- 3. LA BANDERA VA POR EL MISMO MOLDE QUE LA TIENDA ---------------------
//
// No es «los que son de Peru»: si hay alguno con la bandera del cliente juegan SOLO esos, y
// si no hay ninguno juegan los que no llevan bandera. Por eso pasa por la MISMA funcion.
comprobar(
  "el pais se filtra con el mismo molde",
  /soloDeSuTienda\(\s*\r?\n\s*deSuSemimodalidad,\s*\r?\n\s*\(x\) => banderasDe\(x as ConEtiquetas\)/.test(
    editor
  ),
  "no es «los que son de Peru»"
);
// LA TERCERA ETIQUETA, Y FALTABA. El la encontro el 06/10/2026 por sus consecuencias: «todas
// las semimodalidades estan dentro del mismo y causa confusion, y esa confusion ocasiona que
// aparezcan el mismo producto en los 2 comodines». Con COMOHOY, COMO -DOU- y COMO -OB-
// apilados, el visor no enseñaba un recorrido: enseñaba tres montados.
comprobar(
  "y tambien por semimodalidad, con la del motor",
  /porSemimodalidad\(\s*\r?\n\s*deSuTienda,/.test(editor) &&
    /from "@\/lib\/workflow\/etiqueta-de-semimodalidad"/.test(editor),
  "si no, salen las tres mezcladas"
);
comprobar(
  "y esa semimodalidad sale de la tienda",
  /laSemimodalidadDeLaTienda\(/.test(editor),
  "de donde la saca el bot"
);
comprobar(
  "y «sin enrutado por pais» deja la pieza sin bandera",
  /g\?\.pais_routing_enabled === false\s*\r?\n\s*\? \[\]/.test(editor),
  "es su forma de probar sin borrar etiquetas"
);

// -- 4. LOS INDICES NO SE MUEVEN -------------------------------------------
//
// Desde el visor se editan burbujas. Un indice corrido edita la burbuja equivocada, y eso no
// da error: guarda en el sitio de al lado.
comprobar(
  "las intros se filtran DESPUES de marcar su indice",
  editor.indexOf(".map((group, sourceIndex) => ({ ...group, sourceIndex }))") > 0 &&
    // (17/10/2026: lleva además el país de la columna, una por país desde la pizarra)
    editor.indexOf("const introsQueJuegan = soloLoEtiquetado(intros, tiendaId, semi") >
      editor.indexOf(".map((group, sourceIndex) => ({ ...group, sourceIndex }))"),
  "si no, se editaria otra burbuja"
);
comprobar(
  "y los seguimientos tambien",
  /sourceFollowups\.map\(\(f, followupIndex\) => \(\{\s*\r?\n?\s*\.\.\.f,\s*\r?\n?\s*followupIndex,/.test(
    editor
  ),
  "el indice se marca antes de filtrar"
);

// -- 5. EL SELECTOR DE TIENDA ----------------------------------------------
comprobar(
  "hay selector de tienda",
  /De qué tienda es este recorrido/.test(editor),
  "al lado del canal"
);
comprobar(
  "solo aparece si tiene tiendas",
  /\{tiendasDelProyecto\.length > 0 && \(/.test(editor),
  "quien no las usa no lo ve"
);
comprobar(
  "y arranca en una tienda, no en el general",
  /tiendasDelProyecto\.find\(\(t\) => String\(t\?\.numero \?\? ""\)\.trim\(\)\)\?\.id/.test(
    editor
  ),
  "el general no es el recorrido de nadie"
);

// -- 6. UN HUECO SE DICE ----------------------------------------------------
//
// Antes un hueco se confundia con el desorden. Ahora, si a esta tienda no le queda ninguna
// presentacion en este pais, ESO es la noticia.
comprobar(
  "si no le queda ninguna intro, lo dice",
  /Esta tienda no tiene ninguna presentación para este país/.test(editor),
  "el cliente saluda y no recibe nada"
);

// -- 7. LAS COLUMNAS EN PARALELO -------------------------------------------
//
// EL SEGUNDO PASO, y lo decidio el a mitad de frase: pensaba en que crecieran del centro
// hacia los lados y se corrigio solo — «mejor sabes que? que se alineen como el testeador,
// ese tiene de izquierda a derecha bien bonito y cuando agrego mas ventanas puedo correr la
// barrita». Tenia razon: creciendo desde el centro, añadir una columna mueve las demas y
// pierdes de vista la que estabas leyendo.
comprobar(
  "se pueden ver todas las tiendas a la vez",
  /const \[verTodasLasTiendas, setVerTodasLasTiendas\] = useState\(false\)/.test(editor),
  "una columna por tienda"
);
comprobar(
  "cada columna calcula LO SUYO",
  /const losQueJuegan = <T,>\(lista: T\[\], tiendaId: string, semi: string\)/.test(editor),
  "si no, las dos enseñarian lo mismo"
);
// SIEMPRE PEGADO A LA IZQUIERDA, con una tienda o con cuatro. El lo vio y lo corrigio: «en
// el modo testeo no aparece en el centro… el chat alineado a la izquierda y el siguiente a su
// derecha». Centrar deja el chat bailando segun cuantas tiendas tengas.
// CENTRADO Y CRECIENDO HACIA LOS LADOS — lo volvio a pedir asi el 06/10/2026 tras verlo: «que
// mejor esten al centro y que cuando aumenten, se pongan uno al lado del otro aumentando desde
// el centro hacia los lados».
//
// EL CENTINELA ES `w-max`, Y NO ES CAPRICHO: con `justify-center` y desbordamiento el
// navegador recorta por la IZQUIERDA y esa parte NO SE PUEDE ALCANZAR con la barra — la
// primera columna queda inaccesible para siempre, sin dar ningun error.
comprobar(
  "centrado, y al no caber se recorre entero",
  /<div className="mx-auto flex w-max items-start gap-5">/.test(editor),
  "con justify-center la primera columna seria inalcanzable"
);
// Y EL ANCHO DE «celular» ES EL DEL CHAT, NO EL DE LA VENTANA. Antes era al reves: la ventana
// media 390px, asi que no cabia una segunda columna al lado.
comprobar(
  "la ventana ocupa la pantalla",
  /w-full max-w-\[98vw\] flex-col overflow-hidden rounded-lg bg-tarjeta/.test(editor),
  "antes media 390px entera"
);
// 350px Y NO 390: es EXACTAMENTE lo que medía el recorrido antes de sacarlo a pantalla
// completa —ventana de 390 menos el `p-5` de cada lado—. Se puso 390 y el lo noto en seguida:
// «los visores estan ligeramente mas anchos que cuando se veia 1 solo».
comprobar(
  "y el celular mide lo mismo que antes",
  /const anchoDelChat =[\s\S]{0,160}"w-\[350px\]"/.test(editor),
  "390 menos el margen de los dos lados"
);

// -- 8. LA ENTREGA SALE DE LA FICHA, Y «PAGO» YA NO SE PINTA --------------
//
// Lo pidio el 06/10/2026: «necesito que no este ninguno de esos 2, hay que reemplazar la
// entrega con el texto de entrega que se encuentra en la ficha de producto que este activa».
//
// Y es lo correcto: cada producto entrega SU material, y con dos tiendas vendiendo cosas
// distintas la entrega general no es la de nadie — enseñarla era prometer un enlace que ese
// comprador no va a recibir.
comprobar(
  "la entrega sale de la ficha del producto",
  // EL 07/10/2026 esto paso de UNA entrega a una POR PRODUCTO, asi que el molde cambio de
  // `entregaDeLaFicha` a `entregasDeLasFichas`. Lo que comprueba es lo mismo: que los pasos
  // salgan de `delivery` de la ficha y no de la entrega general del proyecto.
  /pasos: \(ficha\?\.delivery \?\? \[\]\)/.test(editor),
  "no de la entrega general"
);
comprobar(
  "y es la del producto que juega ESA tienda",
  // Antes se miraba `unico ?? basico` a mano. Ahora se pregunta por los PUESTOS que juega la
  // columna, que ademas es lo que hace que en -DOU- y -OB- salgan las dos. Misma intencion,
  // mejor fuente: la alineacion de la tienda tapa a la general.
  /\.\.\.Object\.fromEntries\(\s*Object\.entries\(suTienda\?\.alineacion \?\? \{\}\)/.test(editor),
  "cada columna con lo suyo"
);
comprobar(
  "la seccion «Pago» ya no se pinta",
  !/<JourneyPreviewSection title="Pago">/.test(editor),
  "eran los datos de TODOS los metodos seguidos"
);
comprobar(
  "con barra para los que se salen",
  /flex-1 overflow-auto bg-neutral-100/.test(editor),
  "antes solo tenia barra vertical"
);
comprobar(
  "cada columna lleva su chapa con su color",
  /\{columna\.rotulo\}/.test(editor),
  "dos recorridos parecidos sin nombre son indistinguibles"
);
// CON UNA SOLA TIENDA NO CAMBIA NADA, que es la garantia de siempre.
comprobar(
  "el boton solo sale con dos o mas tiendas",
  /\{tiendasDelProyecto\.length > 1 && \(/.test(editor),
  "con una, ponerlas «en paralelo» no enseña nada"
);
comprobar(
  "y sin tiendas se dibuja la columna de siempre",
  /tiendasDelProyecto\.length === 0\s*\r?\n?\s*\? \[\{ id: "", nombre: "", color: "" \}\]/.test(
    editor
  ),
  "quien no las usa no nota nada"
);

// -- 9. Y DICE CUANDO SALE CADA SEGUIMIENTO -------------------------------
//
// Sin el tiempo, el visor enseña el ORDEN de los seguimientos pero no el RECORRIDO: no se
// sabe si el segundo llega tres minutos despues del primero o tres dias. Y es justo lo que se
// mira cuando se ajusta una venta.
comprobar(
  "cada seguimiento dice cuando sale",
  /detail=\{cuandoSale\(followup\.minutos\)\}/.test(editor),
  "antes ponia «Variante activa»"
);
comprobar(
  "y se dice DESDE EL PRIMER MENSAJE",
  /del primer mensaje/.test(editor),
  "no desde el seguimiento anterior: confundirse ahi sale caro"
);
comprobar(
  "las variantes heredan la hora de su seguimiento",
  (editor.match(/minutos: followup\.delay_minutes_from_first_message/g) ?? []).length === 2,
  "es la misma cita, dicha de otra forma"
);

// -- 10. UNA COLUMNA POR SEMIMODALIDAD, Y CADA UNA CON SUS COMODINES ------
//
// LO PIDIO ASI el 06/10/2026 tras ver la primera version: «en un visor aparezcan solo lo
// lineal, en otro solo lo comodou, en otro lo comoob… Y QUE muestre por tienda cuando yo
// ponga "ver todas"».
//
// ANTES ERA UNA COLUMNA POR TIENDA, con la semimodalidad que esa tienda tuviera puesta: se
// veia uno de los tres recorridos y los otros dos quedaban invisibles — justo los que el
// quiere comparar antes de decidir cual vende mejor.
comprobar(
  "hay una columna por cada semimodalidad",
  /\{ semi: "", nombre: "COMO HOY" \}/.test(editor) &&
    /\{ semi: "dos_juntas", nombre: "COMO -DOU-" \}/.test(editor) &&
    /\{ semi: "segunda_oculta", nombre: "COMO -OB-" \}/.test(editor),
  "las tres, siempre"
);
comprobar(
  "y por tienda tambien al pedir «ver todas»",
  /tiendasAVer\s*\r?\n?\s*\.flatMap\(\(t\) =>/.test(editor),
  "tienda x semimodalidad"
);

// EL COMODIN REPETIDO, Y ESTE ES EL CENTINELA QUE MAS IMPORTA.
//
// El lo describio exacto: «en las intros y seguimientos donde hay 2 productos esta mostrando
// el nombre de 1 repetido en los 2». La causa: el visor armaba UN SOLO contexto con `cfg` a
// secas —alineacion general, selector general— y lo compartian todas las columnas. Sin
// `segunda_opcion_prestada`, el reparto de «lineal» dice «caja 1 = el unico, caja 2 = no
// existe», asi que la segunda se caia al campo viejo y acababa enseñando el primero.
comprobar(
  "cada columna resuelve SUS comodines",
  /const suCfg = configDeLaColumna\(col\.id, col\.semi\)/.test(editor) &&
    // (17/10/2026: con el país de SU columna, que sin pizarra es el del visor)
    /previewContextFromConfig\(suCfg, (country|col\.pais as CountryCode)\)/.test(editor),
  "compartir uno solo es lo que repetia el producto"
);
comprobar(
  "y SUS precios",
  /suPrecio: previewFullPriceFromConfig\(suCfg, (country|col\.pais as CountryCode)\)/.test(editor),
  "el precio tambien cambia por semimodalidad"
);
comprobar(
  "la copia lleva el selector de ESA columna",
  /segunda_opcion_prestada: semi as "" \| "dos_juntas" \| "segunda_oculta"/.test(editor),
  "es lo que decide que puesto llena cada caja"
);
comprobar(
  "y la alineacion de ESA tienda",
  /alineacion_por_modalidad: \{/.test(editor) &&
    /\.\.\.Object\.fromEntries\(suya\)/.test(editor),
  "sus productos, no los generales"
);
comprobar(
  "y es una copia para la pantalla, no se guarda",
  /ES UNA COPIA PARA LA PANTALLA, NO SE GUARDA/.test(editor),
  "mismo truco que la seccion de Tiendas"
);

// -- 11. LA CABECERA DICE QUE VENDE, Y «SIN TIENDA» YA NO ESTA -----------
//
// EL 06/10/2026 el dueño reporto que GRAFISMO le enseñaba LECTOESCRITURA en las tres
// columnas. Se midio la logica contra su configuracion real y era CORRECTA —da GRAFISMO
// FONETICO y SUPER PACK 2 EN 1—, asi que el fallo no estaba en el filtro.
//
// LA CANDIDATA ERA EL SELECTOR: tenia una opcion «Sin tienda (general)» que enseña la
// alineacion GENERAL, y la suya apunta al producto de la OTRA tienda. Elegirla sin querer
// daba un nombre equivocado que parecia un fallo del visor. Un sitio donde solo se puede uno
// equivocar no deberia existir.
comprobar(
  "no se puede elegir «sin tienda» teniendo tiendas",
  !/<option value="">Sin tienda \(general\)<\/option>/.test(editor),
  "ensañaba un recorrido que no es de nadie"
);
// Y PARA NO VOLVER A ADIVINAR: la cabecera dice que productos juega esa columna, asi que si
// el comodin se resuelve mal se ve ANTES de leer una sola burbuja.
comprobar(
  "la cabecera dice que vende esa columna",
  /vende \{columna\.vende \|\|/.test(editor),
  "se caza de un vistazo, sin buscar en el texto"
);
comprobar(
  "y avisa si esa tienda no tiene producto",
  /a esta tienda le falta su producto/.test(editor),
  "un hueco se dice"
);

// -- 12. EL CONTEXTO GLOBAL YA NO PISA LOS NOMBRES DE LA COLUMNA ----------
//
// LA CAUSA DE VERDAD, encontrada el 07/10/2026 con una foto suya: la cabecera decia «vende
// GRAFISMO FONETICO» y las burbujas de esa misma columna decian LECTOESCRITURA.
//
// `ChatPreview` mezcla el contexto que le pasan con el HEREDADO del proveedor, y el heredado
// va AL FINAL — o sea que gana. Esta puesto a proposito para que el selector de pais gobierne
// todas las vistas previas, pero de paso pisaba los nombres de producto. La cabecera acertaba
// porque no pasa por ahi.
//
// SE ARREGLO PIDIENDOLO, NO DANDOLE LA VUELTA AL ORDEN: invertir la mezcla habria devuelto el
// fallo que ese orden evita —«los paneles antiguos todavia mandan su contexto base»— y habria
// roto pantallas que hoy funcionan.
comprobar(
  "el visor pide que SUS nombres manden",
  /nombresDelLlamanteMandan: true/.test(editor),
  "si no, el global los pisa"
);
comprobar(
  "y ChatPreview lo respeta solo si se lo piden",
  /\.\.\.\(previewContext\?\.nombresDelLlamanteMandan/.test(editor),
  "los paneles antiguos no se enteran"
);
comprobar(
  "solo vuelven los NOMBRES, no el pais ni la moneda",
  /"productName",[\s\S]{0,200}"productoUpsellName",/.test(editor) &&
    !/"countryCode"/.test(
      editor.slice(
        editor.indexOf("nombresDelLlamanteMandan\n"),
        editor.indexOf("nombresDelLlamanteMandan\n") + 900
      )
    ),
  "el selector de pais sigue gobernando"
);

// -- 13. LAS ETIQUETAS ESTAN EN LAS VARIANTES, Y SIN RED DE SEGURIDAD ----
//
// LO REPORTO EL 07/10/2026: «en el visor de como lineal hay seguimientos de comodou y como
// ob». Medido contra su configuracion, dos causas a la vez:
//
//  1. SUS SEGUIMIENTOS NO LLEVAN ETIQUETA. Solo hay tres —seguimiento_1, _2 y _3— y ninguno
//     tiene semimodalidad. Las etiquetas viven una capa mas adentro, en las VARIANTES:
//     «SEGUIMIENTO LINEAL PERU» y «SEGUIMIENTO PRUEBA DOU PERU» no son seguimientos distintos,
//     son variantes del mismo. Es tambien donde decide el motor — su registro dice «arranca
//     SEGUIMIENTO LINEAL PERU», que es el nombre de una variante.
//
//  2. LA RED DE SEGURIDAD. `porSemimodalidad` acaba con «si no hay ninguna etiquetada ni
//     ninguna general, devuelve TODAS». En el motor es sagrado —un cliente sin cajon es una
//     venta perdida— pero en el visor llena las tres columnas con lo mismo.
comprobar(
  "se filtran tambien las VARIANTES",
  /variants: soloLoEtiquetado\(/.test(editor),
  "es donde viven sus etiquetas"
);
comprobar(
  "el visor filtra SIN la red de seguridad",
  /const soloLoEtiquetado = <T,>/.test(editor) &&
    /AQUI SE PREFIERE EL HUECO/.test(editor),
  "la red mezclaba las tres columnas"
);
comprobar(
  "pero si nadie etiqueta, salen las generales",
  /deSuTienda\.filter\(\(x\) => semimodalidadDe\(x as ConEtiquetas\) === null\)/.test(
    editor
  ),
  "quien no etiqueta ve lo de siempre"
);
// EL CENTINELA QUE MAS IMPORTA DE ESTE CAMBIO.
//
// Al filtrar las variantes, numerarlas despues daria la posicion de LO QUE SE VE y no la de
// verdad — y guardar por ese numero escribe en la variante de al lado. Es exactamente el
// fallo que el reporto el 21/09/2026 y que ya esta contado en el codigo.
// EL `?? i` NO ES UN DETALLE: respeta el indice que ya trae la variante —el REAL, puesto al
// filtrarla— y si algun dia llegara sin el, la numera AQUI, antes de quitar las apagadas. Lo
// cazo `prueba-la-variante-apagada-no-corre-el-numero`, que no lee el codigo: lo EJECUTA.
comprobar(
  "el indice de la variante NO se vuelve a contar",
  /\(variant as \{ variantIndex\?: number \}\)\.variantIndex \?\? i/.test(editor) &&
    !/\.map\(\(variant, variantIndex\) => \(\{ variant, variantIndex \}\)\)/.test(editor),
  "renumerar editaria la variante equivocada"
);

// -- 14. LAS DOS ENTREGAS, Y EL PRECIO CON DESCUENTO DE CADA COLUMNA -----
//
// DOS REPORTES DEL 07/10/2026, con dos causas distintas:
//
//  A. «en comolineal hay 1 sola entrega, pero en comodou y como ob son 2 entregas y esta
//     mostrando solo 1». Cierto, y era la mitad que mas cuesta revisar: la que llega DESPUES
//     de cobrar. Se preguntan los PUESTOS que juega la columna, nunca el nombre de la
//     modalidad — una condicion escrita a mano con esos nombres es el fallo que este proyecto
//     ya pago tres veces.
//
//  B. «en el seguimiento 2 de comodou el precio dice "[precio full sin configurar]", y acabo
//     de revisar y si estan los precios basico y full». Los tenia. Los tres `…Override` de los
//     seguimientos recibian `cfg` —la GENERAL—, donde su modalidad activa es lineal: una sola
//     opcion. `previewComboPriceFromConfig` corta con «si no vende dos, devuelve 0», asi que
//     el precio ni se buscaba. Solo fallaba en el seguimiento 2 porque esos tres son los
//     precios CON DESCUENTO y el descuento empieza ahi.
comprobar(
  "la entrega sale por PUESTO, no por nombre de modalidad",
  /puestoDelCajonDeContenido\(activeModality\(suCfg\), cajon, suCfg\)/.test(editor),
  "asi sigue al producto si el lo mueve"
);
comprobar(
  "se dibuja una entrega por producto",
  /entregasDeLasFichas[\s\S]{0,120}\.map\(\(entrega\) => \(/.test(editor),
  "en -DOU- y -OB- son dos"
);
comprobar(
  "y sin repetir si un producto ocupa dos puestos",
  /\[\s*\.\.\.new Set\(\s*puestosQueJuegan\.map/.test(editor),
  "su entrega es una"
);
comprobar(
  "los precios con descuento usan la config de SU columna",
  /previewComboPriceOverride=\{previewOrderBumpPriceForFollowup\(columna\.suCfg/.test(editor) &&
    !/previewComboPriceOverride=\{previewOrderBumpPriceForFollowup\(cfg,/.test(editor),
  "con la general daba «sin configurar»"
);

console.log("");
if (fallos > 0) {
  console.log(`> ${fallos} FALLA(S)`);
  process.exit(1);
}
console.log("TODO OK — el visor enseña lo de esa tienda y ese pais, con la regla del bot");
