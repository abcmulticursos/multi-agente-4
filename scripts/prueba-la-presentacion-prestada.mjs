// CAMBIAR DE MODALIDAD SIN CAMBIAR DE CONTENIDO.
//
// LO QUE PIDIO, el 22 de septiembre de 2026:
//
//   «Al cambiar de modalidad en BOT ACTIVO, el texto de lineal se cambia por el
//   que esta en la otra modalidad, por ende no puedo encontrar un cambio de
//   modalidad que me permita continuar vendiendo.»
//
//   Lo que necesita es lo contrario: seguir vendiendo LO MISMO y cambiar solo la
//   forma de presentarlo. Un producto mas, un interruptor, y la misma venta
//   sigue — sin trasvasar un solo texto.
//
// COMO FUNCIONA
//
//   La modalidad activa no se mueve. Solo toma PRESTADA la presentacion:
//
//     · «dos_juntas»      las dos opciones en la intro, el cliente elige (-DOU-)
//     · «segunda_oculta»  una, y la segunda se revela al querer pagar (-OB-)
//
//   Los nombres salen de SUS cajas y los precios de la ficha de cada producto.
//   No se copia nada de la otra modalidad: las modalidades siguen hermeticas.
//
// LO QUE NO PUEDE VOLVER A PASAR
//
//   1. Que el interruptor vacio cambie algo. Vacio = exactamente como hoy.
//   2. Que se le preste a -OB- o a -DOU-, que ya venden dos por su cuenta.
//   3. Que con el interruptor encendido y SIN el segundo producto sentado el bot
//      presente una opcion en blanco. Sin los dos nombres no hay oferta: sigue
//      vendiendo uno, como hoy.
//   4. Que los huecos se escriban a mano. Se reutiliza la tabla de la modalidad
//      que presta, para que el 1 y el 2 queden en su orden — en -DOU- el 1 es el
//      CARO; en -OB-, el basico. Cruzarlos ya costo caro una vez.
//
//   node scripts/prueba-la-presentacion-prestada.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";

const RAIZ = process.cwd();

// Para probar las funciones DE VERDAD, no su texto. `@/lib/db` se sustituye por
// un doble vacio: una prueba no debe tocar `data/`.
const DOBLE = "stub:db";
registerHooks({
  resolve(esp, ctx, next) {
    if (esp === "@/lib/db")
      return { url: DOBLE, format: "module", shortCircuit: true };
    if (esp.startsWith("@/")) {
      const rel = esp.slice(2);
      const conExt = /\.[a-z]+$/.test(rel) ? rel : `${rel}.ts`;
      return {
        url: pathToFileURL(join(RAIZ, "src", conExt)).href,
        shortCircuit: true,
      };
    }
    return next(esp, ctx);
  },
  load(url, ctx, next) {
    if (url === DOBLE)
      return {
        format: "module",
        shortCircuit: true,
        source:
          "export const getConversationByPhone = () => null;\n" +
          "export const getFrozenPrices = () => null;\n" +
          "export const getUpsellFrozenPrices = () => null; export const getPuestoEnLaFila = () => null; export const leerCompradosDeLaFila = () => []; export const moverLaFila = () => {};\n" +
          "export const setFrozenPrices = () => {};\n",
      };
    return next(url, ctx);
  },
});

const cfgMod = await import(
  pathToFileURL(join(RAIZ, "src", "lib", "workflow", "config.ts")).href
);
const {
  getActiveTwoTierOffer,
  puestosDeLaModalidad,
  segundaOpcionPrestada,
  repartirPorEtiqueta,
} = cfgMod;

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 60)} ${valor}`);
};

// NOMBRES INVENTADOS A PROPOSITO. Una prueba escrita con los productos reales
// tapa justo el fallo que la regla de la plantilla evita.
const PRIMERO = { id: "p1", name: "ALFA", course_content: "lo de alfa", image_gallery: [] };
const SEGUNDO = { id: "p2", name: "BETA", course_content: "lo de beta", image_gallery: [] };

const base = (extra = {}) => ({
  biblioteca_de_productos: [PRIMERO, SEGUNDO],
  alineacion_por_modalidad: { lineal: { unico: "p1" } },
  ...extra,
});

const conDos = (prestada, alineacion) =>
  repartirPorEtiqueta(
    base({
      segunda_opcion_prestada: prestada,
      alineacion_por_modalidad: { lineal: alineacion },
    })
  );

// -- 1. VACIO = COMO HOY ------------------------------------------------------
const hoy = repartirPorEtiqueta(base());
comprobar(
  "sin interruptor, lineal no tiene dos opciones",
  getActiveTwoTierOffer(hoy) === null,
  "como siempre"
);
comprobar(
  "y sus puestos son los de siempre",
  JSON.stringify(puestosDeLaModalidad("lineal", hoy)) ===
    JSON.stringify(["unico", "upsell"]),
  "unico + upsell"
);
comprobar(
  "el interruptor vacio no presta nada",
  segundaOpcionPrestada(hoy) === null,
  "null"
);

// -- 2. ENCENDIDO Y CON LOS DOS SENTADOS --------------------------------------
const juntas = conDos("dos_juntas", { basico: "p1", full: "p2" });
const ofertaJuntas = getActiveTwoTierOffer(juntas);
comprobar(
  "«dos juntas»: lineal pasa a tener dos opciones",
  !!ofertaJuntas,
  "hay oferta"
);
// EN -DOU- EL HUECO 1 ES EL CARO. Se hereda su tabla justamente para no cruzarlo.
comprobar(
  "y el hueco 1 es el CARO, como en la que presta",
  ofertaJuntas?.combo?.name === "BETA" && ofertaJuntas?.basico?.name === "ALFA",
  "full=1, basico=2"
);
comprobar(
  "sus puestos crecen",
  JSON.stringify(puestosDeLaModalidad("lineal", juntas)) ===
    JSON.stringify(["basico", "full", "upsell"]),
  "basico + full + upsell"
);

// LAS DOS FORMAS COLOCAN IGUAL — 22 de septiembre de 2026.
//
// «Segunda oculta» tomaba prestada la tabla de order bump, que coloca «basico +
// complementario», y los nombres salian CRUZADOS: presentaba el BASICO como la
// opcion cara y el COMPLEMENTARIO como la barata. El complementario no se vende
// suelto —es lo que se le suma al basico para formar el full—, asi que
// ofrecerlo como opcion no es una venta.
//
// Lo que separa a las dos formas es CUANDO se revela la segunda, con las
// palabras del propio selector: «las dos desde el principio» contra «la segunda
// se revela al pagar». No QUE productos son. Ese momento lo decide el
// comportamiento, no el reparto.
const oculta = conDos("segunda_oculta", { basico: "p1", full: "p2" });
const ofertaOculta = getActiveTwoTierOffer(oculta);
comprobar(
  "«segunda oculta»: tambien tiene dos opciones",
  !!ofertaOculta,
  "hay oferta"
);
comprobar(
  "y NO cruza los nombres: el hueco 1 sigue siendo el CARO",
  ofertaOculta?.combo?.name === "BETA" && ofertaOculta?.basico?.name === "ALFA",
  "igual que «dos juntas»"
);
comprobar(
  "y juega los mismos puestos que la otra forma",
  JSON.stringify(puestosDeLaModalidad("lineal", oculta)) ===
    JSON.stringify(["basico", "full", "upsell"]),
  "sin el complementario, que no se vende suelto"
);

// -- 3. SIN EL SEGUNDO SENTADO, NO HAY OFERTA ---------------------------------
//
// El minuto que el tarda en elegir sus productos, el bot sigue vendiendo uno.
const aMedias = conDos("dos_juntas", { basico: "p1" });
comprobar(
  "encendido pero sin segundo producto: sigue vendiendo uno",
  getActiveTwoTierOffer(aMedias) === null,
  "nada en blanco"
);

// -- 4. A QUIEN YA VENDE DOS NO SE LE PRESTA NADA -----------------------------
const ob = repartirPorEtiqueta(
  base({
    order_bump: { enabled: true, combo: {}, basico: {} },
    segunda_opcion_prestada: "dos_juntas",
    alineacion_por_modalidad: { order_bump: { basico: "p1", complementario: "p2" } },
  })
);
comprobar(
  "-OB- no toma prestado nada",
  segundaOpcionPrestada(ob) === null,
  "ya vende dos"
);
// Y SUS PUESTOS SIGUEN SIENDO LOS SUYOS, con el interruptor encendido o no. Si
// el prestamo se le colara, perderia el complementario y ganaria otra forma.
comprobar(
  "y sus puestos siguen siendo los suyos",
  JSON.stringify(puestosDeLaModalidad("order_bump", ob)) ===
    JSON.stringify(["basico", "complementario", "full", "upsell"]),
  "el interruptor no le toca nada"
);

// -- 5. LA FORMA SE PRESTA, EL CONTENIDO NO -----------------------------------
//
// Si se copiara la seccion de la otra modalidad, aqui saldrian SUS nombres.
const conVecina = conDos("dos_juntas", { basico: "p1", full: "p2" });
conVecina.doble_oferta_dos = {
  enabled: false,
  combo: { name: "NO_ES_MIO" },
  basico: { name: "TAMPOCO" },
};
const ofertaLimpia = getActiveTwoTierOffer(conVecina);
comprobar(
  "no se trae el contenido de la modalidad que presta",
  ofertaLimpia?.combo?.name !== "NO_ES_MIO" &&
    ofertaLimpia?.basico?.name !== "TAMPOCO",
  "modalidades hermeticas"
);

// -- 6. LAS DOS COPIAS NO PUEDEN SEPARARSE -----------------------------------
//
// La lista de puestos esta escrita DOS veces —motor y editor— y el propio
// codigo avisa: «si discrepan, la pantalla ofrece un puesto que nadie reparte».
// Aqui se comprueba que la del editor tambien cuenta lo prestado.
const editor = readFileSync(
  join(RAIZ, "src", "app", "editor", "page.tsx"),
  "utf8"
);
comprobar(
  "el editor tambien sabe de la presentacion prestada",
  /function segundaOpcionPrestada\(/.test(editor),
  "su copia de la regla"
);
// Desde que las dos formas juegan los mismos puestos, la pantalla pregunta una
// vez sola — igual que el motor. Lo que se comprueba sigue siendo lo mismo: que
// las dos copias no se separen.
comprobar(
  "y sus puestos crecen igual que los del motor",
  /if \(segundaOpcionPrestada\(c\)\) return \["basico", "full", "upsell"\];/.test(
    editor
  ),
  "mismas listas"
);
// LA INTRO DE LA OFERTA, EN CANALES — 22 de septiembre de 2026.
//
// El dueño cambio a «como -OB-» y en el menu de Canales no le aparecia la fila
// de la intro de la oferta: no habia donde escribirla para ese canal. La fila
// preguntaba por el NOMBRE —«¿soy order_bump?»— y con la presentacion prestada
// lineal sigue llamandose lineal.
//
// Es el mismo fallo que ya costo tres veces en este proyecto: la caja que una
// modalidad llena y otra no abre.
//
// Y SOLO EN «COMO -OB-». «Como -DOU-» presenta las dos opciones en la intro
// principal, que ya tiene su fila; la que revela la segunda al ir a pagar es
// la otra, y esa si necesita su propio cajon.
comprobar(
  "en canales, la intro de la oferta pregunta por el DATO",
  /segundaOpcionPrestada\(cfg\) === "segunda_oculta"/.test(editor),
  "no por el nombre de la modalidad"
);
comprobar(
  "y sigue apareciendo en el Order Bump de verdad",
  /activeModality\(cfg\) === "order_bump" \|\|/.test(editor),
  "no se le quito a quien ya la tenia"
);
// LOS TRES CANDADOS, TAMBIEN EN LA PANTALLA.
comprobar(
  "el editor no se lo presta a quien ya vende dos",
  /yaVendeDos\.includes\(runtimeModality\(c\)\)/.test(editor),
  "-OB- y -DOU- intactas"
);
// Y EL SELECTOR SOLO ESCRIBE LO SUYO: ni modalidades, ni plantillas, ni
// alineaciones. Eso es lo que lo separa del de «Bot activo» de al lado.
//
// DESDE EL 28/09/2026 ESCRIBE DOS CAMPOS, no uno, y los dos son de presentacion:
// se lleva consigo el interruptor de reenganche —«al cambiar a como lineal quede
// como lineal extendida y cuando cambie a como dou, o como ob automaticamente
// cambie a reenganche»—. Lo que esta prueba protege no es el numero de campos: es
// que no se toque el contenido de nadie.
const cuerpoDelSelector = (() => {
  const i = editor.indexOf("const pedirPresentacionPrestada = (");
  // Se corta en el aviso de «pendiente», que es lo ultimo que hace la funcion
  // desde que dejo de guardar por su cuenta (28/09/2026).
  const f = editor.indexOf("Se aplicará al pulsar Guardar", i);
  return i < 0 || f < 0 ? "" : editor.slice(i, f);
})();
comprobar(
  "el selector escribe la presentacion",
  /segunda_opcion_prestada: valor,?/.test(cuerpoDelSelector),
  "su campo de siempre"
);
comprobar(
  "y se lleva el interruptor de reenganche",
  /modo_reenganche: valor !== "",/.test(cuerpoDelSelector),
  "un producto apaga, dos opciones encienden"
);
comprobar(
  "y NADA mas: ni modalidades, ni plantillas",
  cuerpoDelSelector.length > 0 &&
    !/modality_templates|alineacion_por_modalidad|modalidades|rememberEditorModality/.test(
      cuerpoDelSelector
    ),
  "el contenido no se mueve"
);
// CON ALGO SIN GUARDAR, GUARDA Y CAMBIA — NO DICE «NO».
//
// LO QUE PASO, y le costo DOS tandas de pruebas el 28/09/2026: con cambios sin
// guardar este selector se NEGABA a moverse —un aviso pequeño y se quedaba donde
// estaba—. El edita los seguimientos para dos productos y DESPUES cambia el
// selector, asi que tenia cambios pendientes SIEMPRE. Tocaba el selector, no
// pasaba nada, no veia el aviso, y seguia probando creyendo que ya habia
// cambiado. Sus guardados lo delatan dos veces: uno suelto y, ocho o diez
// segundos despues, el cambio bueno.
//
// Y EL 28/09, UNAS HORAS DESPUES, PIDIO LA FORMA BUENA — que este selector no
// actue solo en absoluto:
//
//   «Necesito que cuando yo cambie a como dou, como lineal etc, no se active
//    hasta usar el boton de guardar. Yo activaria y desactivaria el contenido de
//    lineal sin guardar aun para que no arranque, luego activaria las intros de
//    como dou... y recien guardar.»
//
// Y TENIA RAZON POR UN MOTIVO QUE NO NOMBRO: este era el UNICO campo del editor
// que actuaba solo, y por eso obligaba a guardar el contenido antes. Entre ese
// guardado y el siguiente habia unos segundos en los que el bot servia las intros
// nuevas con la presentacion vieja. Con 80 o 100 personas conversando, esa ventana
// es real. Ahora es una sola escritura: o todo, o nada.
//
// SU DOBLE GUARDADO NUNCA FUE NECESARIO. Nacio del obstaculo, no del bot: el bot
// mira la fecha del archivo y lo relee en el mensaje siguiente, no hay nada que
// «asimilar». Se propuso automatizar el retraso y se descarto por eso: el retraso
// solo alarga la ventana de incoherencia que esto elimina.
comprobar(
  "el selector NO publica nada: solo escribe el borrador",
  /const pedirPresentacionPrestada = \(/.test(editor) &&
    !/const pedirPresentacionPrestada = async/.test(editor) &&
    !/if \(isDirty\) \{\s*\n\s*const guardado = await save\(\);/.test(editor),
  "sale con el Guardar general, junto a los textos"
);
comprobar(
  "  y avisa de que queda pendiente",
  /Se aplicará al pulsar Guardar/.test(editor),
  "un selector que se mueve y no dice nada seria el «no» silencioso otra vez"
);
// LA RECARGA SE CONSERVA —la pidio el— pero se muda al guardado, que es el unico
// momento en que el archivo cambia de verdad. Y asi vale para las TRES formas de
// guardar, no solo para el selector.
comprobar(
  "la recarga la hace el GUARDADO, comparando con lo que habia cargado",
  /const laPresentacionCambio = \(\(\) => \{[\s\S]{0,500}?JSON\.parse\(baseline\)[\s\S]{0,300}?segunda_opcion_prestada/.test(
    editor
  ),
  "no el selector"
);
comprobar(
  "  y solo cuando el guardado llego hasta el final",
  /if \(laPresentacionCambio\) \{\s*\n\s*setCortina\("PRESENTACIÓN"\);[\s\S]{0,300}?\n\s*return true;/.test(
    editor
  ),
  "un guardado a medias no recarga: decir «no» deja la pantalla como estaba"
);
comprobar(
  "  y si la foto no se puede leer, NO recarga",
  /\} catch \{\s*\n\s*return false;\s*\n\s*\}\s*\n\s*\}\)\(\);\s*\n\s*setCfg\(_editorView\);/.test(
    editor
  ),
  "recargar por error se lleva lo que este en pantalla"
);

// -- LA PESTANA DE LA FORMA PRESTADA SE PUEDE ABRIR --------------------------
//
// LO QUE PASO — 25 de septiembre de 2026. El dueno quiso editar el texto del
// recordatorio de las dos opciones —«Respuesta a "precio"», que vive en la
// pestana Order Bump— y el editor lo echaba a Intro en cuanto la pulsaba: su
// modalidad se llama LINEAL porque usa el selector, y el guardian la trataba como
// una pestana que no le toca.
//
// Y NO ES UNA PESTANA QUE NO LE TOQUE: ahi vive el contenido que su bot usa de
// verdad. `sendTwoOptionsReminder` lee `order_bump.price_question_response` tal
// cual, con selector o sin el. El motor usaba ese cajon y la pantalla no dejaba
// abrirlo.
//
// Es la averia de siempre, ahora en el editor: preguntar por el NOMBRE de la
// modalidad en vez de por el dato. Y cada presentacion abre la SUYA: «como ob»
// abre Order Bump y «como dou» abre Doble Oferta 2 Productos.
console.log("\n- y su pestana se puede abrir -\n");
comprobar(
  "«como ob» abre la pestana Order Bump",
  /tab === "orderbump" &&\s*\r?\n?\s*modo !== "order_bump" &&\s*\r?\n?\s*prestada !== "segunda_oculta"/.test(
    editor
  ),
  "ahi vive el texto que el bot usa"
);
comprobar(
  "«como dou» abre la de Doble Oferta 2 Productos",
  /!dobleConUpsell &&\s*\r?\n?\s*prestada !== "dos_juntas"/.test(editor),
  "cada una la que toma prestada"
);
comprobar(
  "y se pregunta por el dato, con la copia del motor",
  /const prestada = segundaOpcionPrestada\(cfg\);/.test(editor),
  "no por el nombre de la modalidad"
);
comprobar(
  "las otras expulsiones no se tocaron",
  /\(tab === "bioferta" && modo !== "bioferta"\) \|\|/.test(editor),
  "bioferta sigue igual"
);

console.log(
  fallos === 0
    ? "\nTODO OK — la forma se presta, el contenido se queda"
    : `\n${fallos} FALLO(S)`
);
process.exit(fallos === 0 ? 0 : 1);
