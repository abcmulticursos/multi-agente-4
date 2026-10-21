// MODALIDAD "DOBLE OFERTA + UPSELL".
//
// Vende dos productos en el primer mensaje —basico y completo—, entrega el que
// pague, y pasado un rato ofrece un TERCER producto con su precio en el mismo
// mensaje. Si dice que si, se le mandan los datos de pago; si dice que no, se
// despide; y si paga de frente, se le entrega.
//
// SE HIZO COMO CAPA, NO REESCRIBIENDO NADA
//
// La parte de vender no necesito codigo nuevo: getActiveTwoTierOffer ya era el
// punto unico del que salen las dos opciones, y solo se le agrego un caso. Lo
// unico realmente nuevo es el retraso antes de ofrecer el tercero.
//
// EL RIESGO QUE ESTA PRUEBA VIGILA
//
// Ahora hay DOS modalidades con producto extra. Habia ocho sitios que leian
// `config.upsell` a pelo; cada uno que quede asi serviria el producto de la
// OTRA tienda dentro de esta conversacion. Eso es justo lo que prohibe la
// regla 5-bis: las modalidades son hermeticas, ninguna sirve contenido de otra.
//
//   node scripts/prueba-doble-oferta-upsell.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");

const config = leer("src", "lib", "workflow", "config.ts");
const engine = leer("src", "lib", "workflow", "engine.ts");
const pago = leer("src", "lib", "workflow", "payment.ts");
const db = leer("src", "lib", "db.ts");
const cerebro = leer("src", "lib", "openrouter.ts");
const entrada = leer("src", "lib", "meta", "handler.ts");
const simulador = leer("src", "app", "simulador", "page.tsx");
const editor = leer("src", "app", "editor", "page.tsx");
const apiSimulador = leer(
  "src",
  "app",
  "api",
  "test-simulator",
  "[conversationId]",
  "route.ts"
);

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 60)} ${valor}`);
};

// ── 1. Existe y es su propia modalidad ──────────────────────────────────────
comprobar(
  "la modalidad existe",
  /\| "doble_oferta_upsell"/.test(config) &&
    /doble_oferta_upsell\?: DobleOfertaUpsell;/.test(config),
  "sí"
);
comprobar(
  "tiene su propio tercer producto dentro",
  /interface DobleOfertaUpsell extends DobleOfertaDos \{[\s\S]{0,300}?upsell\?: UpsellConfig;/.test(
    config
  ),
  "suyo"
);
comprobar(
  // La modalidad Upsell pasó a tener su propio interruptor: `upsell.enabled`
  // significa ahora «esta modalidad ofrece un segundo producto», y con los dos
  // significados en un campo, encender esa etapa en Lineal habría cambiado lo
  // que vende el bot. Lo que se vigila sigue siendo lo mismo: que Doble Oferta
  // + Upsell vaya PRIMERA en la escalera.
  "manda sobre las demás cuando está encendida",
  /if \(config\.doble_oferta_upsell\?\.enabled\) return "doble_oferta_upsell";[\s\S]{0,900}?if \(config\.upsell_modalidad_enabled \?\? config\.upsell\?\.enabled\) return "upsell";/.test(
    config
  ),
  "va primera"
);

// ── 2. Nace apagada: el bot de hoy no cambia ────────────────────────────────
//
// Es la garantía de que esto no toca lo que ya vende. Sin la bandera puesta,
// activeModalityKey devuelve exactamente lo que devolvía antes.
comprobar(
  "apagada, la escalera de siempre queda intacta",
  /if \(config\.upsell_modalidad_enabled \?\? config\.upsell\?\.enabled\) return "upsell";\s*\r?\n\s*if \(config\.doble_oferta_dos\?\.enabled\) return "doble_oferta_dos";/.test(
    config
  ),
  "intacta"
);
// Y la compatibilidad, que es la que garantiza que un archivo todavía sin
// guardar con esta versión venda EXACTAMENTE lo mismo que antes.
comprobar(
  "un archivo sin el interruptor nuevo se decide con el viejo",
  /config\.upsell_modalidad_enabled \?\? config\.upsell\?\.enabled/.test(config),
  "nadie cambia de modalidad al deployar"
);

// ── 3. Las dos opciones salen de SU sección ─────────────────────────────────
// Siguen saliendo de SU seccion. Lo unico que se le pasa por encima es el
// relleno del NOMBRE cuando esta en blanco o es un `<<hueco>>` de plantilla:
// entonces se toma el de Contenido, para no tener el mismo dato en dos sitios y
// que un marcador acabe escrito en el chat del cliente. Lo que el operador
// escribio a mano en la opcion sigue mandando.
comprobar(
  "las 2 opciones salen de su propia sección",
  /if \(key === "doble_oferta_upsell" && cfg\.doble_oferta_upsell\) \{\s*\r?\n\s*return conLosNombresDelContenido\(cfg\.doble_oferta_upsell, cfg\);/.test(
    config
  ),
  "sí"
);
comprobar(
  "y vende con el mismo camino de 2 opciones",
  /if \(key === "doble_oferta_upsell"\) return !!cfg\.doble_oferta_upsell\?\.enabled;/.test(
    config
  ),
  "sí"
);

// ── 4. HERMETISMO: nadie lee el upsell de otra modalidad ────────────────────
comprobar(
  "hay un punto único para el producto extra",
  /export function seccionUpsell\(/.test(config) &&
    /if \(key === "doble_oferta_upsell"\) return cfg\.doble_oferta_upsell\?\.upsell \?\? null;/.test(
      config
    ),
  "seccionUpsell"
);
// EL CANDADO CAMBIÓ DE FORMA, NO DE INTENCIÓN.
//
// Antes esto exigía `return null` fuera de las dos modalidades con etapa: era la
// única manera de que ninguna leyera la de otra. Pero también impedía que Lineal
// u Order Bump tuvieran la suya, y no porque faltara tubería —todo lo de después
// ya pasaba por aquí— sino porque la puerta les decía que no.
//
// Ahora cada modalidad guarda SU etapa en su capa y el editor proyecta la de la
// que vende. Lo que hay que seguir vigilando es lo mismo de siempre: que la
// puerta sea el ÚNICO sitio por donde se lee, y que Doble Oferta + Upsell siga
// leyendo la suya y no la de al lado.
comprobar(
  "Doble Oferta + Upsell sigue leyendo la SUYA, no la de al lado",
  /if \(key === "doble_oferta_upsell"\) return cfg\.doble_oferta_upsell\?\.upsell \?\? null;/.test(
    config
  ),
  "hermetismo"
);
comprobar(
  "las demás leen la de la modalidad que vende",
  /return cfg\.upsell \?\? null;/.test(config),
  "cada una la suya"
);
for (const [nombre, texto] of [
  ["el motor", engine],
  ["el cobro", pago],
]) {
  const directas = texto
    .split(/\r?\n/)
    .filter((linea) => /(config|loadWorkflowConfig\(\))\??\.upsell\b/.test(linea))
    .filter((linea) => !/seccionUpsell/.test(linea));
  comprobar(
    `${nombre} no lee el upsell a pelo en ningún sitio`,
    directas.length === 0,
    directas.length === 0 ? "ninguna" : `${directas.length} quedan`
  );
}
comprobar(
  "el cobro rutea las 2 opciones por el punto único",
  /const ob = config \? getActiveTwoTierOffer\(config\) : null;/.test(pago),
  "sí"
);

// ── 5. La espera antes de ofrecer el tercero ────────────────────────────────
comprobar(
  "se puede decir cuántos minutos esperar",
  /retraso_minutos\?: number;/.test(config),
  "sí"
);
comprobar(
  "sin el campo se ofrece enseguida, como siempre",
  /Math\.floor\(seccionUpsell\(config\)\?\.retraso_minutos \?\? 0\)/.test(engine) &&
    /if \(retraso > 0\) \{/.test(engine),
  "0 = como antes"
);
comprobar(
  "esperar no ofrece dos veces si hay otra entrega",
  /setUpsellState\(convo\.id, "esperando"\)/.test(engine) &&
    /"esperando"/.test(db),
  "se marca ya"
);
comprobar(
  "al vencer la espera se ofrece",
  /action\.action_type === ACTION_UPSELL_PRESENTAR/.test(engine) &&
    /await presentarUpsell\(alDia\)/.test(engine),
  "sí"
);
comprobar(
  "si la conversación avanzó por otro lado, no se pisa",
  /alDia\.upsell_state && alDia\.upsell_state !== "esperando"/.test(engine),
  "sí"
);

// ── 5 bis. El resto del bot también la reconoce ─────────────────────────────
//
// Habia cuatro sitios que preguntaban por la SECCION vieja en vez de por la
// modalidad activa, y en esta modalidad quedaban en falso:
//
//  - El cerebro no sabia que estaba vendiendo: ni nombres ni precios de las dos
//    opciones entraban en su prompt.
//  - El marcador <<ELIGE_PRODUCTO_1/2>> se ignoraba. Ese marcador es el que
//    rescata a quien dice cual quiere con una frase rara o un typo: la
//    deteccion literal no la caza, el modelo si, y aun asi no le llegaban los
//    datos de pago. Se quedaba esperando.
comprobar(
  "el cerebro sabe qué está vendiendo",
  /const dobleOfertaDos = getActiveTwoTierOffer\(dobleOfertaCfg\);/.test(
    cerebro
  ) && /if \(isDobleOfertaActive\(\)\) \{/.test(cerebro),
  "sí"
);
comprobar(
  "elegir con una frase rara también funciona",
  /if \(eligeMatch && isDobleOfertaActive\(\)\)/.test(entrada),
  "sí"
);
comprobar(
  "no queda ninguna pregunta por la sección vieja",
  !/doble_oferta_dos\?\.enabled/.test(cerebro) &&
    !/doble_oferta_dos\?\.enabled/.test(entrada),
  "ninguna"
);

// ── 5 ter. Poder decir que SÍ ───────────────────────────────────────────────
//
// La pregunta del final ofrece elegir entre si y no, pero la aceptacion exigia
// el NOMBRE del producto. Ahora el texto real del botón se conserva y el motor
// lo reconoce contra la etiqueta configurada, aunque diga algo distinto a
// «Sí» o WhatsApp la recorte.
comprobar(
  "el botón Sí conserva su texto y el motor reconoce su etiqueta",
  /id === "upsell_si" \|\| id === "upsell_no"[\s\S]{0,900}?text = title\.trim\(\);/.test(
    entrada
  ) && /botonDelUpsell\(msgContent, config\)/.test(engine),
  "etiqueta"
);
comprobar(
  "y un «sí» escrito también vale",
  /detectaSiSimpleAlUpsell/.test(engine) && /detectaSiSimpleAlUpsell/.test(config),
  "sí"
);
// La guarda sigue siendo la misma que la del «no», y ahora cubre a todos los
// que pueden preguntar en medio —el modelo, un seguimiento, una persona desde
// el panel—, no solo al regalo. Ver prueba-el-si-es-de-la-ultima-pregunta.mjs.
comprobar(
  // Misma guarda, con la mitad del regalo acotada a MIENTRAS espera respuesta y
  // no para siempre. Ver prueba-el-si-del-extra-no-muere-con-el-regalo.mjs.
  "pero solo mientras nadie más haya preguntado",
  /const nadieMasPregunto =\s*\r?\n\s*!elRegaloEstaEsperandoRespuesta && esLaUltimaPregunta;/.test(
    engine
  ) && /nadieMasPregunto && detectaSiSimpleAlUpsell\(msgContent\)/.test(engine),
  "misma guarda que el no"
);

// ── 5 quater. Se puede probar sin encenderla ────────────────────────────────
//
// El simulador deja correr UNA conversacion con otra modalidad sin tocar la que
// venden las clientas. Es la unica forma de probar esta modalidad sin ponerla a
// vender, y sin ella la unica manera de verla era encenderla — que es
// exactamente como MULTIAGENTE 3 acabo vendiendo con los textos de muestra.
comprobar(
  "aparece en el simulador",
  /<option value="doble_oferta_upsell">/.test(simulador),
  "sí"
);
comprobar(
  "y la API la acepta",
  /"doble_oferta_dos",\s*\r?\n\s*"doble_oferta_upsell",/.test(apiSimulador),
  "permitida"
);

// ── 5 quinquies. Tres productos, TRES entregas en Canales ───────────────────
//
// Esta modalidad caia en el caso por defecto y mostraba UNA sola caja llamada
// "Entrega pago aprobado". Con tres enlaces distintos que meter, eso era una
// invitacion a equivocarse: no habia forma de saber cual iba donde, y el error
// solo se ve cuando una clienta recibe el producto que no compro.
comprobar(
  // EL TITULO ES FIJO: una palabra, sin el nombre del producto pegado.
  //
  // Antes llevaba el nombre detras y venia de un comodin CRUZADO: el cajon del
  // basico se leia "BASE: KIT EMPRENDEDOR FULL". Quien llena estas cajas se
  // guia por el titulo, asi que se lleno el basico con el enlace del full — y
  // el bot entrego exactamente lo que estaba escrito ahi. El error no estaba
  // en el motor: estaba en el rotulo.
  "las tres entregas tienen un título fijo de una palabra",
  /key: "doble_oferta_dos_basico",\s*\r?\n\s*name: "BÁSICO",/.test(editor) &&
    /key: "doble_oferta_dos_combo",\s*\r?\n\s*name: "FULL",/.test(editor) &&
    /key: "upsell",\s*\r?\n\s*name: "UPSELL",/.test(editor),
  "BÁSICO, FULL, UPSELL"
);
comprobar(
  "el título ya no lleva pegado el nombre del producto",
  !/name: `1 · BASE:/.test(editor) &&
    !/name: `2 · FULL:/.test(editor) &&
    !/name: `3 · UPSELL:/.test(editor),
  "una palabra"
);
comprobar(
  // El nombre se guardaba junto con la entrega, asi que un titulo viejo —o
  // equivocado— se quedaba para siempre.
  "un título guardado no puede sobrevivir al que toca",
  /const nombreEsperado = new Map\(esperadas\.map\(\(e\) => \[e\.key, e\.name\]\)\);/.test(
    editor
  ) && /nombre && nombre !== g\.name \? \{ \.\.\.g, name: nombre \} : g/.test(editor),
  "se reescribe"
);
comprobar(
  "y dentro de cada cajón dice qué producto es",
  /function productoDeLaEntrega\(key: string, cfg: FullConfig\): string \{/.test(
    editor
  ) && /Aquí va lo que recibe quien compra/.test(editor),
  "comprobación"
);
comprobar(
  // Se traduce desde la CLAVE, que es lo que usa el motor para entregar. Desde
  // el rotulo seria repetir el mismo error con otra cara.
  "esa comprobación sale de la clave, no del rótulo",
  /if \(key === "doble_oferta_dos_basico" \|\| key === "order_bump_basico"\)/.test(
    editor
  ),
  "por clave"
);
comprobar(
  // Los grupos se crean UNA sola vez, al estrenar el canal. Sin completarlos,
  // un canal creado cuando la modalidad tenia menos productos se quedaba con
  // los grupos viejos para siempre y las entregas nuevas no aparecian nunca.
  "las entregas que falten se agregan solas",
  /const faltan = esperadas\.filter\(/.test(editor) &&
    /groups = \[\.\.\.groups, \.\.\.faltan\]/.test(editor),
  "sin pisar lo escrito"
);
comprobar(
  // Todo canal nace con una entrega generica ("central"). En una modalidad con
  // entregas propias esa caja se sumaba a las suyas: salian CUATRO para tres
  // productos, y la de mas se parecia al primero.
  "no queda la entrega genérica de más",
  /groups = groups\.filter\(\(g\) => esperada\.has\(g\.key\)\);/.test(editor),
  "solo las de la modalidad"
);
comprobar(
  // Si tenia texto no se tira: se mueve a la primera entrega de la modalidad
  // cuando esa esta vacia. Lo escrito sigue ahi, en la caja que le toca.
  "y si tenía texto, se mueve en vez de perderse",
  /g\.key === primera\.key \? \{ \.\.\.g, steps: sobra\.steps \} : g/.test(editor),
  "se conserva"
);
comprobar(
  // LOS ROTULOS YA NO SE ESCRIBEN A MANO EN CADA MODALIDAD: salen del puesto.
  // Antes cada cajon tenia su propio titulo y en Order Bump el «Producto 1» era
  // el basico mientras en Doble Oferta + Upsell era el full — habia que traducir
  // de cabeza al cambiar de modalidad, y traduciendo mal se llena el equivocado.
  // Cuatro nombres y ni uno mas, iguales en las seis.
  "los tres productos se llaman igual en Contenido",
  /function rotuloDelPuesto\(/.test(editor) &&
    /title=\{rotuloDelPuesto\(puestoDelCajonDeContenido\(contentMode, 1\)\)\}/.test(
      editor
    ) &&
    /title=\{rotuloDelPuesto\(puestoDelCajonDeContenido\(contentMode, 2\)\)\}/.test(
      editor
    ) &&
    !/base \+ complemento/.test(editor) &&
    /PRODUCTO UPSELL/.test(editor),
  "básico, full, upsell"
);
// Y LOS CUATRO NOMBRES VIVEN EN UN SOLO SITIO.
comprobar(
  "los cuatro papeles tienen un nombre y uno solo",
  /nombre: "Producto básico"/.test(editor) &&
    /nombre: "Producto complementario"/.test(editor) &&
    /nombre: "Producto full"/.test(editor) &&
    /nombre: "Producto upsell"/.test(editor) &&
    !/nombre: "Único"/.test(editor),
  "sin «Producto 1» ni «Único»"
);
comprobar(
  "y el Pack desaparece: en esta modalidad no existe",
  /!isLineal && !isDobleOfertaDos && !isDobleOfertaUpsell && \(/.test(editor),
  "sí"
);
comprobar(
  "y el motor lee las tres",
  /mode === "doble_oferta_upsell" && next\.doble_oferta_upsell/.test(config) &&
    /deliveryGroupSteps\(content, "upsell"\) \?\?\s*\r?\n\s*next\.doble_oferta_upsell\.upsell\?\.delivery/.test(
      config
    ),
  "sí"
);

// ── 6. Lo último que debe pasar: perder el regalo ───────────────────────────
comprobar(
  "si falla al ofrecerlo, el regalo NO se pierde",
  /catch \(err\) \{[\s\S]{0,260}?seguirConRegalo\(alDia\.id\);/.test(engine),
  "sigue"
);

console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} comprobación(es) mal.`);
process.exit(fallos === 0 ? 0 : 1);
