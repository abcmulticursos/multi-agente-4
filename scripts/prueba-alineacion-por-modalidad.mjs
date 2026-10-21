// Cada modalidad dice QUIEN JUEGA CADA PUESTO. El producto no lleva etiqueta.
//
// LO QUE PASABA, PRIMERO
//
//   El papel de un producto ERA el sitio donde estaba guardado: lo del full
//   vivia en la caja del full y lo del basico en la del basico. Para vender
//   caro lo que antes era barato habia que vaciar las dos cajas y volver a
//   llenarlas cruzadas, a mano, con sus entregas y sus galerias.
//
// LO QUE SE PROBO DESPUES, Y POR QUE NO BASTABA
//
//   Se saco el producto de la caja y se le colgo una ETIQUETA: basico, full,
//   upsell. Mejor, pero con dos fallos que solo se ven usandolo:
//
//     1. Un producto lleva UNA etiqueta, asi que el mismo no podia ser el unico
//        de Lineal y el basico de Order Bump a la vez.
//     2. Y sobre todo: la etiqueta es GLOBAL. El momento en que etiquetabas un
//        producto para preparar Order Bump, cambiabas lo que el Lineal estaba
//        vendiendo en ese instante. No se podia preparar sin dejar de vender.
//
// COMO QUEDA
//
//   Los productos viven sueltos en la biblioteca y se llenan una sola vez. Cada
//   MODALIDAD guarda su alineacion: una lista corta de puestos y, en cada uno,
//   el id de un producto. Se llena la de Order Bump con calma mientras Lineal
//   vende, y entra al mover el interruptor de modalidad.
//
// POR QUE EL MOTOR NO SE ENTERA
//
//   El archivo se lee del disco en UN solo punto de todo el proyecto, y ahi ya
//   se le aplicaba la capa del canal. El motor, el cobro, la validacion del
//   comprobante, la entrega y el cerebro leen el RESULTADO de esa linea: son
//   unas 170 llamadas y todas pasan por ahi.
//
// LO QUE NO PUEDE VOLVER A PASAR
//
//   1. Que sin biblioteca, o sin alineacion, el bot se comporte distinto.
//   2. Que el reparto pise la capa del canal, que es la de mas arriba.
//   3. Que al llenar una caja se borre su guion de venta.
//   4. Que llenar la alineacion de una modalidad toque lo que vende otra.
//   5. Que quede un sitio donde editar a mano lo que el reparto reescribe.
//   6. Que la alineacion se caiga al guardar. El archivo se escribe por lista:
//      lo que no esta nombrado se pierde en silencio y sin error.
//
//   node scripts/prueba-alineacion-por-modalidad.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");
const config = leer("src", "lib", "workflow", "config.ts");
const api = leer("src", "app", "api", "workflow", "route.ts");
const editor = leer("src", "app", "editor", "page.tsx");
const pago = leer("src", "lib", "workflow", "payment.ts");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

const reparto = (() => {
  const i = config.indexOf("export function repartirPorEtiqueta(");
  const f = config.indexOf("export function loadWorkflowConfig(", i);
  return i < 0 || f < 0 ? "" : config.slice(i, f);
})();
comprobar("se encuentra el reparto", reparto.length > 0, "repartirPorEtiqueta");

// -- 1. VACIO NO HACE NADA ---------------------------------------------------
//
// Es LA garantia: un bot que no use esto se comporta igual que antes de que
// existiera. Son TRES salidas tempranas y hacen falta las tres, porque hay tres
// maneras distintas de no estar usandolo.
comprobar(
  "sin biblioteca devuelve la configuración tal cual",
  /if \(!Array\.isArray\(biblioteca\) \|\| biblioteca\.length === 0\) return config;/.test(
    reparto
  ),
  "el bot no cambia"
);
// Desde el 30/09/2026 la alineación puede venir de la TIENDA del número que
// atiende, y si no, de la modalidad. La intención de esta comprobación no
// cambia: sin ninguna de las dos, no se toca nada.
comprobar(
  // LA INTENCION NO CAMBIA. El 02/10/2026 la pregunta «que productos juegan» se saco a
  // `laAlineacionQueJuega`, porque estaba escrita en dos sitios y leida a pelo en tres mas
  // — y los tres de a pelo se saltaban la tienda, asi que el bot daba el NOMBRE de un
  // producto con el PRECIO de otro. Lo que se comprueba aqui sigue siendo lo mismo: sin
  // ninguna alineacion, los cajones quedan intactos.
  "sin alineación para esta modalidad, tampoco toca nada",
  /const alineacion = laAlineacionQueJuega\(config, modo\);/.test(reparto) &&
    /if \(!alineacion\) return config;/.test(reparto),
  "cajones intactos"
);
comprobar(
  // Lo mismo: la regla sigue entera, ahora en el ayudante. Se busca ahi, que es donde
  // vive, y asi esta comprobacion protege a los CINCO sitios que la usan en vez de a uno.
  "y la tienda juega la suya si la tiene puesta",
  /const suya = tiendaDelTurno\.getStore\(\)\?\.alineacion;/.test(config) &&
    /if \(suya && Object\.keys\(suya\)\.length > 0\) return suya;/.test(config),
  "vacía = manda la de la modalidad"
);
comprobar(
  "y con todos los puestos en «ninguno», igual",
  /if \(asignados\.length === 0\) return config;/.test(reparto),
  "guardados sin vender"
);

// -- 2. SOLO LA MODALIDAD QUE VENDE ------------------------------------------
//
// Esto es lo que resuelve el fallo de la etiqueta. Si se leyeran todas las
// alineaciones, preparar Order Bump volveria a cambiar lo que vende el Lineal
// de ahora mismo, que es justo de lo que veniamos.
comprobar(
  "se lee la alineación de la modalidad activa",
  /const modo = activeModalityKey\(config\);/.test(reparto),
  "las otras esperan"
);
// El 22/09/2026 esta funcion paso a recibir tambien la configuracion, para
// poder contar la presentacion prestada (ver `segundaOpcionPrestada`). Lo que
// se comprueba es lo mismo: que el reparto pregunte por los puestos de ESA
// modalidad en vez de traerse una lista escrita a mano.
comprobar(
  "y los puestos son los que esa modalidad tiene",
  /const puestos = puestosDeLaModalidad\(modo(, config)?\);/.test(reparto),
  "nada que no se use"
);
comprobar(
  "la lista de puestos por modalidad existe",
  /export function puestosDeLaModalidad\(\s*modo: string/.test(config),
  "en el motor"
);

// -- 3. UN PUESTO SEÑALA, NO COPIA -------------------------------------------
//
// Guarda el id, no el producto. Corregir un precio en la ficha queda corregido
// en todas las modalidades donde aparezca. Y si el id apunta a un producto
// borrado se AVISA y la caja se queda como estaba: inventar un producto o
// vaciarla en silencio son las dos formas de entregar lo que nadie eligio.
// El 22/09/2026 la lectura del asiento paso por `idEnElAsiento`, porque `unico`
// y `basico` son el mismo asiento con dos nombres y al cambiar de modalidad el
// producto desaparecia de la pantalla. Lo que se comprueba aqui NO cambia: que
// lo guardado sea un ID que se busca en la biblioteca, y no una copia del
// producto. Se aceptan las dos formas de preguntarlo.
comprobar(
  "el puesto guarda el id del producto",
  /const id = (alineacion\[puesto\]|idEnElAsiento\(alineacion, puesto\));/.test(
    reparto
  ) && /const producto = porId\.get\(id\);/.test(reparto),
  "no una copia"
);
comprobar(
  "un puesto huérfano se avisa y no inventa nada",
  /apunta al producto/.test(reparto) && /console\.warn\(/.test(reparto),
  "la caja se queda igual"
);

// -- 4. EL ORDEN: ALINEACION PRIMERO, CANAL DESPUES --------------------------
//
// Las dos escriben en las mismas cajas. El canal es la capa de mas arriba, asi
// que tiene que poder pisar lo que puso la alineacion. Invertido, escribir una
// entrega propia en WhatsApp no serviria de nada y no habria ni un aviso.
// Y en medio entra la version elegida del cajon, que solo toca las dos intros de
// la oferta. Va DESPUES del reparto —no compiten— y ANTES del canal, que sigue
// siendo la capa de mas arriba.
comprobar(
  "el canal manda sobre la alineación",
  /applyChannelContent\(\s*\r?\n?\s*aplicarVersionActiva\(repartirPorEtiqueta\(config\)\),\s*\r?\n?\s*channel\s*\r?\n?\s*\)/.test(
    config
  ),
  "el canal es la capa de arriba"
);

// -- 5. SE LLENA CAMPO A CAMPO, NO DE UN VOLCADO -----------------------------
//
// La caja tiene ademas el guion de venta: lo que contesta el bot al elegir esa
// opcion, sus variantes y sus respuestas por metodo de pago. Eso es del PUESTO y
// no del producto —«la opcion cara» se presenta igual sea cual sea el producto
// que haga de cara— y ademas ya nombra al producto con comodines. Un volcado
// entero lo borraria.
comprobar(
  "se conserva lo que ya había en la caja",
  /\.\.\.\(caja \?\? \{\}\),/.test(reparto),
  "el guion de venta no se borra"
);
for (const campo of ["name", "aliases", "price_soles"]) {
  comprobar(
    `viaja el ${campo}`,
    new RegExp(`${campo}: producto\\?\\.${campo}`).test(reparto),
    "con el producto"
  );
}
// La entrega pasa ademas por la traduccion al formato del motor: ver
// `prueba-entrega-del-producto-no-sale-muda`.
comprobar(
  "viaja el delivery",
  /delivery: burbujasDelProducto\(producto\?\.delivery\)/.test(reparto),
  "con el producto"
);
// Y SIN PRODUCTO SENTADO, LA CAJA SALE VACIA. Es la regla del dueño: «nada debe
// salir de ahi». El cajon guarda lo del producto que se vendia antes, y una
// modalidad con su reparto hecho no puede volver a hablar por el.
comprobar(
  "un puesto vacío deja la caja vacía, no la de antes",
  /const hayPuesto = \(p: PuestoDeProducto\) => puestos\.includes\(p\);/.test(
    reparto
  ) && /if \(hayPuesto\("basico"\) \|\| hayPuesto\("unico"\)\)/.test(reparto),
  "el cajón no habla"
);
comprobar(
  "y el contenido se recorre por hueco, no por asignado",
  /const puesto = puestoDelHueco\(hueco\);/.test(reparto),
  "los dos siempre"
);
// LOS TIEMPOS DE LA ETAPA NO SON DEL PRODUCTO. Cambiar la alineacion no puede
// reiniciar cuantos minutos espera antes de ofrecerlo ni su texto de rechazo.
comprobar(
  "y los tiempos de la etapa no se tocan",
  !/espera_minutos/.test(reparto) && !/retraso_minutos/.test(reparto),
  "eso es de la etapa"
);

// -- 6. EL CONTENIDO TAMBIEN, Y CRUZADO ---------------------------------------
//
// Aqui estaba el «producto fantasma»: el nombre, el «que incluye» y la galeria
// viven POR MODALIDAD, asi que al cambiar asomaba el que esa modalidad tenia
// guardado de antes, aunque las cajas de las opciones ya vinieran del producto
// elegido.
//
// Y estan CRUZADOS entre modalidades, no por descuido: en Order Bump el
// «producto 1» del archivo es el BASICO, y en Doble Oferta + Upsell es el FULL.
// Leer uno por otro pone el nombre del full en la caja del basico, y quien
// llene esa caja guiandose por el nombre mete el enlace equivocado. Paso.
comprobar(
  "el contenido se llena desde el producto",
  /next\.product_name = nombre;/.test(reparto) &&
    /next\.product_name_2 = nombre;/.test(reparto) &&
    /const nombre = producto\?\.name \?\? "";/.test(reparto),
  "se acabó el fantasma"
);
comprobar(
  "y la tabla de cruces está escrita",
  /doble_oferta_upsell: \{ full: 1, basico: 2 \}/.test(config) &&
    /order_bump: \{ basico: 1, complementario: 2 \}/.test(config),
  "cada cajón su puesto"
);
// DOBLE OFERTA 2 PRODUCTOS VA COMO «+ UPSELL», NO COMO ORDER BUMP. Su
// «Producto 1» es la opcion CARA: lo dice la pestaña —«aqui la 1 es
// sencillamente el producto mas caro»— y lo confirma el motor, donde el combo se
// cae a `product_name` cuando no tiene nombre propio. Estuvo cruzado, y cruzado
// el nombre del full salia en la caja del basico.
comprobar(
  "Doble Oferta 2: el Producto 1 es el full",
  /doble_oferta_dos: \{ full: 1, basico: 2 \}/.test(config) &&
    /doble_oferta_dos: \["full", "basico"\]/.test(editor),
  "no al revés"
);
// LA PANTALLA TIENE LA MISMA TABLA, y tiene que decir lo mismo. Si discreparan,
// el cajon avisaria de un producto y le entraria el de otro.
comprobar(
  "la pantalla usa la misma tabla de cruces",
  /function puestoDelCajonDeContenido\(/.test(editor) &&
    /doble_oferta_upsell: \["full", "basico"\]/.test(editor) &&
    /order_bump: \["basico", "complementario"\]/.test(editor),
  "no discrepan"
);

// -- 7. EL UNICO DE LINEAL LLENA LAS DOS CAJAS -------------------------------
//
// Lineal tiene un solo producto, pero las cajas de dos opciones se llenan
// igual: cual manda lo decide el motor por la modalidad activa. Llenar solo la
// activa dejaria la otra con lo de antes, y al cambiar de modalidad apareceria
// contenido viejo sin que nadie lo hubiera tocado.
comprobar(
  "el único hace de full y de básico si no hay otros",
  /const full = enPuesto\("full"\) \?\? unico;/.test(reparto) &&
    /const basico = enPuesto\("basico"\) \?\? unico;/.test(reparto),
  "Lineal no deja huecos"
);
comprobar(
  "se llenan Order Bump y Doble Oferta 2",
  /next\.order_bump = \{/.test(reparto) &&
    /next\.doble_oferta_dos = \{/.test(reparto),
  "las dos"
);

// -- 7-BIS. LAS MODALIDADES SIN CAJA DE DOS OPCIONES -------------------------
//
// Order Bump y las dos Dobles Ofertas «2 Productos» y «+ Upsell» guardan sus
// opciones en la misma caja, y esa se llena arriba. Las otras tres no, y se
// quedaban a medias: se elegia el producto, cambiaba el NOMBRE y seguia
// entregando el archivo del anterior. La clienta paga, recibe algo, y no es lo
// suyo. Es la peor forma de fallar de todas las que hay aqui.
//
// LINEAL Y UPSELL: no tienen caja de opcion. Cobran el precio base y entregan
// por la secuencia general, asi que el Unico llena esas dos directamente.
comprobar(
  "el Único llena la entrega general",
  /next\.payment_approved_sequence = burbujasDelProducto\(unico\?\.delivery\);/.test(
    reparto
  ),
  "Lineal y Upsell"
);
comprobar(
  "y el precio base, que sigue siendo el respaldo",
  /next\.course_price_soles = unico\.price_soles;/.test(reparto),
  "el del país manda"
);
// EL CAJON NO HABLA NI CUANDO LA FICHA VIENE VACIA. Es una regla del dueño y
// tiene razon: ese cajon guarda la entrega del producto que se vendia ANTES, asi
// que dejarlo hablar es mandarle a la clienta el archivo del producto anterior.
// Vacia tiene su propia red: el aviso al admin.
comprobar(
  "una ficha sin entrega no deja hablar al cajón viejo",
  !/if \(suEntrega\.length > 0\)/.test(reparto),
  "prohibido"
);
// EL PRECIO SI SE PROTEGE: un cero no es «este producto es gratis», es un campo
// sin llenar, y escribirlo dejaria al bot cobrando nada.
comprobar(
  "pero un precio en cero no se escribe",
  /typeof unico\?\.price_soles === "number" && unico\.price_soles > 0/.test(
    reparto
  ),
  "no cobra cero"
);

// DOBLE OFERTA guarda lo suyo en `bioferta_doble`, que no es ninguna de las
// cajas de arriba. El reparto es el que enseña la pantalla: el basico es el
// Producto 1, el complementario el Producto 2 y el full es el Pack.
comprobar(
  "Doble Oferta llena su propia caja",
  /if \(modo === "bioferta"\) \{/.test(reparto) &&
    /next\.bioferta_doble = bio;/.test(reparto),
  "sus tres opciones"
);
for (const [caja, patron] of [
  ["Producto 1", /bio\.product_a = llenarBioferta\(bio\.product_a, basico\)/],
  ["Producto 2", /bio\.product_b = llenarBioferta\(bio\.product_b, complementario\)/],
  ["Pack", /bio\.pack = llenarBioferta\(bio\.pack, full\)/],
]) {
  comprobar(`Doble Oferta · ${caja} sabe quién lo llena`, patron.test(reparto), "su puesto");
}
comprobar(
  "y el precio del Pack sale del full",
  /bio\.pack_price_soles = full\.price_soles;/.test(reparto),
  "con su descuento"
);
// LOS AVISOS EN PANTALLA, o se editaria a mano lo que el reparto reescribe.
for (const [donde, papel] of [
  ["la entrega general", 'papel="unico"'],
  ["Doble Oferta · Producto 2", 'papel="complementario"'],
]) {
  comprobar(
    `${donde} avisa quién lo llena`,
    editor.includes(papel),
    "no en silencio"
  );
}

// -- 7-BIS-2. «INFO DE CONTENIDO» TAMBIEN VIAJA CON EL PRODUCTO --------------
//
// Esa lista guarda NOMBRES de tema, no imagenes. Mientras el producto era el
// sitio donde estaba guardado, los nombres siempre coincidian. Desde que las
// galerias llegan con el producto, la lista se quedaba nombrando las muestras
// del producto ANTERIOR: no coincidia ninguna y el bot no mandaba nada al pedir
// el detalle. Sin error, sin aviso, y solo se ve en el chat.
comprobar(
  "la marca vive en la imagen, no en una lista suelta",
  /info_de_contenido\?: boolean;/.test(config) &&
    /info_de_contenido\?: boolean;/.test(editor),
  "viaja con el producto"
);
comprobar(
  "y la lista se arma con lo que traiga quien juega",
  /if \(!muestra\?\.info_de_contenido \|\| !tema\) continue;/.test(reparto) &&
    /next\.product_info_topics = temasMarcados;/.test(reparto),
  "sola"
);
// Y ESTA LISTA TAMBIEN SE ESCRIBE VACIA SI NO HAY MARCAS. Misma regla: en una
// modalidad con reparto, los cajones no hablan. La lista vieja nombra muestras
// del producto ANTERIOR, asi que dejarla puesta seria mandar las imagenes de
// otro producto cuando el cliente pide ver el detalle.
comprobar(
  "sin marcas, la lista vieja tampoco manda",
  /next\.product_info_topics = temasMarcados;/.test(reparto) &&
    !/if \(temasMarcados\.length > 0\)/.test(reparto),
  "el cajón no habla"
);
// SIN REPETIR, y en el orden de los puestos, que es el orden de la oferta.
//
// PERO «REPETIDO» ES POR FICHA, NO POR NOMBRE — 15 de septiembre de 2026.
//
// Esto exigia descartar cualquier tema cuyo nombre ya estuviera. Y ahi se perdia
// una muestra legitima: el dueno marco tres y salieron dos. Con sus palabras:
// «he puesto check en los 3 productos, me envio solo 2, el basico y el
// complementario, y no envio el full».
//
// Su basico y su full tenian una muestra con el MISMO nombre, y no por
// descuido: el pack se llama como el basico porque lo contiene. Ese choque se
// va a repetir siempre que alguien arme un combo.
//
// Asi que la identidad pasa a ser la ficha MAS el nombre. Lo que esta guarda
// protegia de verdad —que un producto no meta su propio tema dos veces— sigue
// en pie.
comprobar(
  "no repite un tema que ya está, por FICHA",
  /const clave = `\$\{deQuien\}\|\$\{tema\.toLowerCase\(\)\}`;/.test(reparto) &&
    /if \(yaMarcado\.has\(clave\)\) continue;/.test(reparto),
  "una vez cada uno, dentro de su ficha"
);
comprobar(
  "y dos fichas distintas pueden llamarla igual",
  /\$\{deQuien\}\|/.test(reparto),
  "el combo se llama como el basico"
);
// LA CASILLA SOLO EN LA FICHA DE UN PRODUCTO. En las galerias de los cajones la
// lista se sigue marcando donde se marco siempre.
comprobar(
  "la casilla sale solo en la ficha del producto",
  /marcarInfoDeContenido\?: boolean;/.test(editor) &&
    /marcarInfoDeContenido\s*\r?\n\s*\/>/.test(editor),
  "no en los cajones"
);
// Y SIN TEMA NO SE PUEDE MARCAR: la lista guarda el tema, asi que una muestra
// sin nombre no se podria nombrar.
comprobar(
  "sin tema, la casilla no se deja marcar",
  /disabled=\{!it\.topic\?\.trim\(\)\}/.test(editor),
  "y se dice por qué"
);

// -- 7-TER. EL CAJON VIEJO NO PUEDE VOLVER A HABLAR --------------------------
//
// Regla del dueño, y tiene razon: «esas secciones jamas deben enviar contenido,
// quedaron como plantilla». Lo que guardan es la entrega del producto que se
// vendia ANTES, asi que dejarlas hablar es mandarle a la clienta el archivo del
// producto anterior. Recibe algo, cree que ya tiene lo suyo y se va.
//
// PERO HAY ALGO PEOR QUE ESO: que pague y no reciba NADA, y que nadie se entere.
// Antes eso era una linea en el registro del servidor, que no lee nadie.
comprobar(
  "pagar y quedarse sin entrega avisa al admin",
  /function avisarQueNoHayEntrega\(/.test(pago) &&
    /PAGÓ Y SE QUEDÓ SIN ENTREGA/.test(pago),
  "por WhatsApp, al momento"
);
comprobar(
  "y dice de qué entrega se trata",
  /avisarQueNoHayEntrega\(conversationId, `la entrega "\$\{source\}"`\)/.test(
    pago
  ),
  "para saber dónde mirar"
);
// LA RED VIEJA —caer a la entrega general para que el cliente nunca se quede sin
// nada— sigue puesta donde siempre sirvio. Lo que NO puede hacer es taparle el
// hueco a un puesto que llena un producto elegido: ahi la general es la de otro
// producto.
comprobar(
  "se sabe si ese puesto lo llena un producto",
  /export function laEntregaLaLlenaUnProducto\(/.test(config),
  "para no caer a la general"
);
comprobar(
  "sin alineación, la red vieja sigue intacta",
  /if \(!id\) return false;/.test(config),
  "quien no la use, igual que siempre"
);
for (const [donde, patron] of [
  [
    "Order Bump",
    /if \(laEntregaLaLlenaUnProducto\(fuente\)\) \{[\s\S]{0,220}?return;/,
  ],
  [
    "Doble Oferta",
    /if \(laEntregaLaLlenaUnProducto\(fuenteBio\)\) \{[\s\S]{0,260}?return;/,
  ],
]) {
  comprobar(
    `${donde}: no cae a la entrega de otro producto`,
    patron.test(pago),
    "se para y avisa"
  );
}

// -- 7-QUATER. EL PUNTO DE ESTADO, SIN LETREROS ------------------------------
//
// El editor ya tiene avisos de sobra. Uno mas por producto los volveria ruido de
// fondo, que es la forma de que no se lea ninguno. Asi que va un punto, y lo que
// falta se lee al pasar el mouse o al abrir la ficha.
comprobar(
  "hay un punto de estado por producto",
  /function PuntoDeEstado\(/.test(editor) &&
    /function loQueLeFaltaAlProducto\(/.test(editor),
  "sin letrero"
);
comprobar(
  "y al pasar el mouse dice qué falta",
  /title=\{pista\}/.test(editor),
  "el hint"
);
// DOS NIVELES. Sin nombre, entrega o precio la venta se rompe. Sin el «que
// incluye» o la galeria el bot vende igual. Un solo rojo para las dos cosas
// haria que el rojo dejara de significar algo.
comprobar(
  "distingue lo que rompe de lo que solo mejora",
  /rompe\.push\("la entrega"\)/.test(editor) &&
    /mejora\.push\("la galería"\)/.test(editor),
  "el rojo se respeta"
);
// ROJO SOLO SI ESTA JUGANDO. A un producto guardado sin usar le puede faltar lo
// que sea: no se esta vendiendo.
comprobar(
  "el rojo es solo para el que está jugando",
  /jugando\s*\r?\n?\s*\? "bg-red-600"\s*\r?\n?\s*: "bg-neutral-400"/.test(editor),
  "si no, el rojo es ruido"
);

// -- 7-QUINQUIES. LOS CAJONES DE PRODUCTO SE VAN DE LA PANTALLA -------------
//
// «Ya no quiero usar esos cajones externos, no me sirven para trabajar.» Se
// trabaja en «Tus productos» y estos estorban. No se borran —lo que guardan
// sigue en el archivo, y un clon del bot llega con todo— pero dejan de pintarse.
comprobar(
  "los cajones de producto van escondidos",
  /\{verCajonesViejos && \(/.test(editor) &&
    /const \[verCajonesViejos, setVerCajonesViejos\] = useState\(false\);/.test(
      editor
    ),
  "no se borran"
);
comprobar(
  "y hay un botón pequeño para mirarlos",
  /Ver los cajones viejos \(solo para mirar\)/.test(editor),
  "por si hace falta"
);
// EL COMODIN VIVE EN EL ASIENTO, no en el producto: es lo que hace que mover un
// producto de puesto no obligue a reescribir ni un texto.
comprobar(
  "cada puesto dice su comodín",
  /comodin: "\{\{PRODUCTO_BASE\}\}"/.test(editor) &&
    /comodin: "\{\{PRODUCTO_COMPLEMENTARIO\}\}"/.test(editor) &&
    /comodin: "\{\{PRODUCTO_FULL\}\}"/.test(editor) &&
    /comodin: "\{\{PRODUCTO_UPSELL\}\}"/.test(editor),
  "los cuatro"
);
comprobar(
  "y se ve en la fila del reparto",
  /\{puesto\.comodin\}/.test(editor),
  "donde se decide"
);
// Y DENTRO DE LA FICHA, cual le toca HOY. Uno no se acuerda de en que asiento
// sento a cada producto, y lo necesita mientras escribe su entrega.
comprobar(
  "la ficha dice con qué comodín se nombra ese producto",
  /En tus textos, este producto se nombra con/.test(editor),
  "sale del puesto"
);
comprobar(
  "y si no juega ninguno, lo dice",
  /no está jugando ningún puesto/.test(editor),
  "no en blanco"
);
// EL CANDADO TAPA EL NOMBRE, Y SOLO EL NOMBRE.
//
// Tapaba el cajon entero, y con el se fueron dos cosas que NO estan en la ficha
// del producto y salen al cliente igual: el PRECIO POR PAIS de esa opcion y el
// GUION DE VENTA —la respuesta al elegirla y las respuestas por metodo de pago—.
// Un dato que sale al cliente y no se puede tocar desde ningun sitio es peor que
// un dato duplicado.
comprobar(
  "el candado tapa solo el nombre de la opción",
  /<SiLoLlenaLaBiblioteca papel=\{papel\}>\s*\r?\n\s*<NameAliases[\s\S]{0,320}?<\/SiLoLlenaLaBiblioteca>/.test(
    editor
  ),
  "el precio y el guion siguen"
);
// Y LA ENTREGA SI SE TAPA, porque esa si viaja con el producto.
comprobar(
  "y la entrega sigue tapada, que esa sí es del producto",
  /\{!hideDelivery && \(\s*\r?\n\s*<SiLoLlenaLaBiblioteca papel=\{papel\}>/.test(
    editor
  ),
  "cada cosa con su regla"
);

// -- 8. LA API LA GUARDA -----------------------------------------------------
comprobar(
  "la API lee la biblioteca",
  /const biblioteca_de_productos = Array\.isArray\(config\?\.biblioteca_de_productos\)/.test(
    api
  ),
  "al cargar"
);
comprobar(
  "y lee la alineación",
  /const alineacion_por_modalidad = esMapa\(config\?\.alineacion_por_modalidad\)/.test(
    api
  ),
  "al cargar"
);
comprobar(
  "y las escribe las dos en el archivo",
  /doc\.set\(\s*\r?\n?\s*"biblioteca_de_productos",/.test(api) &&
    /doc\.set\(\s*\r?\n?\s*"alineacion_por_modalidad",/.test(api),
  "no se caen al guardar"
);
// UN PUESTO INVENTADO A MANO llenaria una caja que no existe, o ninguna, sin
// decir nada. Se limpia al leer.
comprobar(
  "un puesto desconocido se descarta al leer",
  /PUESTOS_CONOCIDOS\.includes\(puesto\) && str\(id\)\.trim\(\)/.test(api),
  "no inventa puestos"
);
// EL ID NO ES EL NOMBRE: renombrar un producto no puede convertirlo en otro ni
// dejar huerfano al puesto que lo señalaba.
comprobar(
  "cada producto tiene id propio",
  /id: str\(item\?\.id\) \|\| `producto_\$\{i \+ 1\}`/.test(api),
  "renombrar no lo cambia"
);

// -- 9. LA PANTALLA: PRIMERO QUIEN JUEGA, DESPUES LA LISTA -------------------
//
// Es el orden en que se trabaja: se viene a decir quien juega de que, y solo se
// baja a la lista cuando hay que crear o corregir un producto.
comprobar(
  "hay un reparto de puestos en Contenido",
  /function AlineacionDeLaModalidad\(/.test(editor) &&
    /Quién juega cada puesto/.test(editor),
  "arriba del todo"
);
comprobar(
  "y va antes que la lista de productos",
  editor.indexOf("<AlineacionDeLaModalidad") <
    editor.indexOf("<BibliotecaDeProductos"),
  "primero quién juega"
);
comprobar(
  "la lista de productos sigue ahí, con su botón",
  /function BibliotecaDeProductos\(/.test(editor) &&
    /\+ Agregar producto/.test(editor),
  "en Contenido"
);
comprobar(
  "y las dos van antes que los cajones de los papeles",
  editor.indexOf("<BibliotecaDeProductos") <
    editor.indexOf('titleKey="contenido_producto_1"'),
  "primero qué vendes"
);
// SE ELIGE DE UNA LISTA CERRADA de tus productos, con «ninguno» como salida.
comprobar(
  "el puesto se llena eligiendo un producto",
  /<option value="">— ninguno —<\/option>/.test(editor),
  "no es texto libre"
);
// LA ALINEACION ES DE ESTA MODALIDAD Y SE DICE EN PANTALLA. Sin eso uno cree
// que esta repartiendo para todo el bot, que es exactamente lo que ya no hace.
comprobar(
  "la pantalla dice de qué modalidad es",
  /Esta alineación es de/.test(editor) &&
    /otras modalidades guardan la suya y no se tocan/.test(editor),
  "no reparte para todas"
);
comprobar(
  "un puesto huérfano sale en rojo",
  /⚠️ El producto que tenía ya no está en tu lista/.test(editor),
  "no parece sin elegir"
);
comprobar(
  "y el mismo producto en dos puestos se avisa",
  /Hay un producto puesto en dos puestos a la vez/.test(editor),
  "nunca es a propósito"
);

// -- 10. NO SE REPARTE EN DOS SITIOS -----------------------------------------
//
// El desplegable de «Etiqueta» que llevaba cada producto SE RETIRA. Dos sitios
// para la misma decision acaban discrepando, y el dia que discrepen no habria
// forma de saber cual manda. La fila del producto solo ENSEÑA donde juega.
comprobar(
  "el producto ya no lleva su propia etiqueta editable",
  !/ponerPapel/.test(editor) && !/function papelesDeLaModalidad\(/.test(editor),
  "se reparte arriba"
);
comprobar(
  "la fila solo enseña dónde está jugando",
  /const puestoActual = puestoDe\(producto\.id\);/.test(editor),
  "de sólo lectura"
);

// -- 11. NO SE EDITA EN DOS SITIOS -------------------------------------------
//
// Los dos escriben en el mismo sitio, pero al leer manda la alineacion. Si se
// dejara editar el cajon viejo, uno escribiria ahi, guardaria, y el bot seguiria
// enviando lo del producto alineado. Sin error y sin aviso.
comprobar(
  "el cajón viejo del puesto tomado no se edita",
  /function SiLoLlenaLaBiblioteca\(/.test(editor) &&
    /<SiLoLlenaLaBiblioteca papel=\{papel\}>/.test(editor),
  "manda la alineación"
);
for (const [donde, papel] of [
  ["Order Bump · full", 'papel="full"'],
  ["Order Bump · básico", 'papel="basico"'],
]) {
  comprobar(
    `${donde}: dice qué puesto llena`,
    (editor.match(new RegExp(papel, "g")) ?? []).length >= 2,
    "en las dos modalidades"
  );
}
// EL UPSELL NO SE VACIA: lleva ademas los tiempos y la pregunta del final, que
// la biblioteca no toca y siguen haciendo falta. Ahi se avisa y ya.
comprobar(
  "el upsell avisa en vez de vaciarse",
  /function AvisoDeQueLaBibliotecaLlena\(/.test(editor) &&
    /<AvisoDeQueLaBibliotecaLlena papel="upsell" \/>/.test(editor),
  "sus tiempos siguen ahí"
);
// Y LOS CAJONES DE CONTENIDO TAMBIEN AVISAN, desde que el reparto les escribe el
// nombre, el «que incluye» y la galeria.
comprobar(
  "los cajones de Contenido avisan quién los llena",
  (
    editor.match(
      /papel=\{puestoDelCajonDeContenido\(contentMode, [12]\)\}/g
    ) ?? []
  ).length === 2,
  "los dos"
);

// -- 12. EL PRECIO: LA REGLA NO CAMBIA, SE ENSEÑA ----------------------------
//
// El precio no sale de un solo sitio: manda el del pais, en Precios y pagos, y
// si ese pais no lo tiene puesto se cae al del producto. Eso ya era asi antes
// de la biblioteca y esta bien. Lo que estaba mal es que el respaldo era
// INVISIBLE: al cruzar basico y full, en un pais con precio puesto el precio no
// se mueve —correcto— y en uno sin precio se va con el producto y el full se
// abarata solo. El mismo cambio, dos resultados, y nada que lo avise.
// SE DIO LA VUELTA — 17 de septiembre de 2026, y es lo que el dueño pidió:
// «que cada producto tenga su precio fijado y que al activarlo respete ese
// precio como PRIORIDAD sobre el precio de la sección precios y pagos».
//
// Antes mandaba el país y la ficha era el respaldo, y por eso al cambiar quién
// juega de básico el importe se quedaba con el PUESTO: se cobraba el del
// producto anterior. Ahora el precio viaja con el producto.
comprobar(
  "se dice que manda el precio de la ficha",
  /mandan sobre\s*\n?\s*Precios y pagos/.test(editor),
  "el país ya no le gana"
);
// Y NINGÚN PAÍS USA EL PRECIO DE OTRO. Orden suya: «jamás deben tener precios de
// otro país ya que son monedas y montos distintos».
comprobar(
  "y que ningún país hereda del otro",
  /ningún país usa el precio de otro/i.test(editor),
  "monedas distintas"
);
comprobar(
  "y se enseña cuál manda en cada país",
  /function preciosDelPapel\(/.test(editor) &&
    /function PreciosDelProducto\(/.test(editor),
  "país por país"
);
// CADA PUESTO LEE SU PROPIO CAMPO. El full del Order Bump vive en
// `combo_price_soles`, el basico —y el unico de Lineal, que cobra igual— en el
// precio normal del pais, y el upsell en el suyo. Leer uno por otro daria un
// aviso que MIENTE, que es peor que no avisar.
comprobar(
  "cada puesto lee su propio campo de precio",
  /vale\(perfil\?\.order_bump\?\.combo_price_soles\)/.test(editor) &&
    /papel === "basico" \|\| papel === "unico"/.test(editor) &&
    /vale\(perfil\?\.upsell\?\.price_soles\)/.test(editor),
  "no miente"
);
// SOLO LOS PAISES EN LOS QUE SE VENDE. Avisar de un precio que falta en un pais
// apagado es mandar a llenar algo que no se usa.
//
// LA PREGUNTA CAMBIO EL 26/09/2026, y la intencion es la misma. Preguntaba
// `country_sales_enabled?.[code] !== false`, o sea que un pais que el dueno NUNCA
// TOCO —sin interruptor y sin cuenta de pago— contaba como encendido: sus tres
// productos salian «SIN PRECIO» teniendo precio, porque a los tres les faltaba
// Costa Rica. Ahora se pregunta lo mismo que pregunta el motor al ir a cobrar
// (`isCountrySalesEnabled`), copiado en `laVentaEstaAbiertaEnElPais`. Lo prueba
// entero, ejecutandolo, `prueba-el-rojo-dice-que-le-falta`.
comprobar(
  "y solo mira los países encendidos",
  /laVentaEstaAbiertaEnElPais\(cfg, c\.code\)/.test(editor) &&
    /country_sales_whitelist === true/.test(editor),
  "nada que no se venda"
);
// EL ROJO SE VE SIN ABRIR NADA. Un aviso que solo sale dentro de la ventana se
// ve cuando ya fuiste a mirar; este tiene que saltar en la lista.
comprobar(
  // ANTES ESTO EXIGIA EL AVISO VIEJO: «Sin precio en Ecuador, Costa Rica,
  // Chile...». Se retiro el 25/09/2026 por orden del dueno: dos renglones de
  // paises, solo hablaba del precio, y callaba lo unico que deja a un cliente
  // sin su compra —que no hay enlace de entrega—. Ese mismo dia le costo una
  // venta: pago y no recibio nada. La INTENCION no cambia, y por eso la
  // comprobacion sigue aqui: el aviso tiene que verse en la lista sin abrir la
  // ficha. Lo que cambia es que ahora son tres etiquetas cortas.
  "las tres faltas salen en la lista, rojas y en mayusculas",
  /⚠️ Sin precio en/.test(editor) === false &&
    /const FALTA_CONTENIDO = "SIN CONTENIDO";/.test(editor) &&
    /const FALTA_PRECIO = "SIN PRECIO";/.test(editor) &&
    /const FALTA_ENTREGA = "SIN ENLACE DE ENTREGA";/.test(editor) &&
    /faltas\.map\(\(falta\) => \(/.test(editor),
  "sin abrir la ficha"
);

// -- 13. BORRAR UN PRODUCTO QUE ESTA JUGANDO ---------------------------------
//
// El puesto queda señalando a algo que ya no existe. Enterarse ahi mismo evita
// guardar una modalidad a la que le falta una pieza.
comprobar(
  "borrar uno que juega avisa que el puesto quedó vacío",
  /estaba jugando de \$\{nombreDelPuesto\}/.test(editor),
  "no en silencio"
);

// -- 14. EL CAJON DICE QUE PRODUCTO HACE ESE PAPEL ---------------------------
//
// El papel va PRIMERO y en mayusculas. Hay una nota de un incidente real: en
// las cajas de entrega el titulo llevaba pegado el nombre y venia cruzado, asi
// que el cajon del BASICO se leia con el nombre del FULL. Quien lo lleno se
// guio por el titulo y metio el enlace equivocado.
comprobar(
  "el título lleva el papel delante y el nombre detrás",
  /`📦 PRODUCTO FULL\$\{/.test(editor) &&
    /`📚 PRODUCTO BÁSICO\$\{/.test(editor),
  "FULL se lee primero"
);

console.log(
  fallos === 0
    ? "\nTODO OK — el papel lo reparte la modalidad, no lo lleva el producto"
    : `\n${fallos} FALLO(S)`
);
process.exit(fallos === 0 ? 0 : 1);
