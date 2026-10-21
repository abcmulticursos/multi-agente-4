// La modalidad "Doble Oferta + Upsell" DESDE LA PANTALLA.
//
// El motor ya sabia venderla, pero solo se podia configurar tocando el yaml a
// mano. Esta prueba cubre el viaje completo: elegirla en el editor, guardarla,
// y que el motor lea exactamente eso.
//
// POR QUE NO TIENE PESTAÑA PROPIA
//
// Se edita con las que ya existen —"Doble Oferta 2 Prod" para las dos opciones,
// "Upsell" para el tercer producto— y al guardar se juntan las dos mitades en
// la seccion que el motor consulta. Duplicar una pestaña de 36 campos habria
// creado dos formularios que editan lo mismo, que es donde de verdad se rompen
// las cosas: divergen y nadie sabe cual manda.
//
// EL FALLO QUE ESTA PRUEBA IMPIDE
//
// La API no guarda lo que le llega: sanea y RECONSTRUYE el yaml campo por
// campo. Una seccion que no este contemplada se descarta en silencio — se
// guarda, no da error, y al recargar no esta. Si eso pasara aqui, encender la
// modalidad no haria nada y no habria ni una pista de por que.
//
//   node scripts/prueba-editor-doble-oferta-upsell.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");

const editor = leer("src", "app", "editor", "page.tsx");
const api = leer("src", "app", "api", "workflow", "route.ts");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 60)} ${valor}`);
};

// ── 1. Se puede elegir ──────────────────────────────────────────────────────
comprobar(
  "aparece en el desplegable de modalidades",
  /<option value="doble_oferta_upsell">DOBLE OFERTA \+ UPSELL<\/option>/.test(
    editor
  ),
  "sí"
);
comprobar(
  "tiene nombre para mostrar",
  /doble_oferta_upsell: "Doble Oferta \+ Upsell",/.test(editor),
  "sí"
);
comprobar(
  "la pantalla sabe cuál vende, en el mismo orden que el motor",
  // El segundo renglón lleva el interruptor NUEVO (`upsell_modalidad_enabled`),
  // con el viejo detrás del `??` para los archivos que aún no se han guardado
  // con esta versión. Es el mismo cambio que se hizo en el motor: `upsell.enabled`
  // pasó a significar «esta modalidad ofrece un segundo producto», y si la
  // pantalla siguiera mirándolo, encender la etapa en Lineal se vería —y se
  // guardaría— como un cambio de modalidad.
  /if \(c\.doble_oferta_upsell\?\.enabled\) return "doble_oferta_upsell";[\s\S]{0,900}?if \(c\.upsell_modalidad_enabled \?\? c\.upsell\?\.enabled\) return "upsell";/.test(
    editor
  ),
  "va primera"
);
comprobar(
  "y se recuerda al recargar el editor",
  /value === "doble_oferta_upsell" \|\|/.test(editor),
  "sí"
);

// ── 1 bis. Y se puede LLENAR ────────────────────────────────────────────────
//
// Las pestañas de oferta se ocultan segun la modalidad que se edita. Sin
// abrirle estas dos, la modalidad se podia elegir y no configurar: ninguna
// pestaña a la vista y ningun sitio donde poner el tercer producto ni su
// precio. Se elige, se guarda, y no pasa nada.
comprobar(
  "la pestaña de las 2 opciones se ve en esta modalidad",
  /if \(key === "dobleoferta2"\)[\s\S]{0,160}?dobleConUpsell/.test(editor),
  "sí"
);
// La pestaña del tercer producto YA NO ES DE DOS MODALIDADES.
//
// Antes se abría solo para Upsell y para Doble Oferta + Upsell, y por eso había
// que nombrarla aquí. Ahora la etapa vive como capa de CADA modalidad, así que
// la pestaña se ve siempre: en las que no la usan sale vacía y apagada, que es
// donde se enciende. Lo que hay que vigilar es que nadie vuelva a cerrarla.
comprobar(
  "y la del tercer producto se ve en TODAS",
  /"dobleoferta2",\s*\r?\n\s*"upsell",/.test(editor) &&
    !/if \(key === "upsell"\)\s*\r?\n?\s*return activeModality/.test(editor),
  "sí"
);

// ── 1 ter. Y se puede ENTRAR a ellas ────────────────────────────────────────
//
// Habia un guardian que devuelve a "Intro" cuando estas en la pestaña de una
// modalidad que no es la activa, y no contemplaba esta. Las dos pestañas se
// veian en el menu, se podian pulsar, y el editor te devolvia al instante.
//
// Desde fuera parecia que las dos "apuntaran a lo mismo" —a Intro— y que la
// modalidad no tuviera contenido propio: se veia el saludo y el menu de pago,
// que son de Intro. Nunca se llegaba a ver lo suyo.
comprobar(
  "no te echa de la pestaña de las 2 opciones",
  /tab === "dobleoferta2" &&\s*\r?\n\s*modo !== "doble_oferta_dos" &&\s*\r?\n\s*!dobleConUpsell/.test(
    editor
  ),
  "se queda"
);
comprobar(
  "ni de la del tercer producto, en ninguna modalidad",
  // El guardián compara la pestaña con la modalidad; si ya no nombra a
  // «upsell», no puede echar de ella a nadie. (`tab === "upsell" &&` a secas
  // sigue apareciendo: es la condición que DIBUJA la pestaña.)
  !/tab === "upsell" && modo !==/.test(editor),
  "se queda"
);

// ── 2. La sección se arma al guardar, no solo al activar ────────────────────
//
// Si se copiara solo al activar, editar despues y guardar dejaria al motor con
// la version vieja sin avisar de nada.
comprobar(
  "hay un sitio único que arma la sección",
  /function armarDobleOfertaUpsell\(/.test(editor),
  "sí"
);
comprobar(
  "se arma también AL GUARDAR",
  /doble_oferta_upsell: armarDobleOfertaUpsell\(\s*_runtimeApplied,\s*_runtimeMode\s*\)/.test(
    editor
  ),
  "sí"
);
comprobar(
  "junta las dos opciones y el tercer producto",
  /combo: c\.doble_oferta_dos\.combo,/.test(editor) &&
    /upsell: \{ \.\.\.c\.upsell, enabled: conTercerProducto \}/.test(editor),
  "las dos mitades"
);
comprobar(
  "apagada, no borra lo que ya estaba escrito",
  /\.\.\.\(c\.doble_oferta_upsell \?\? \{\}\)/.test(editor),
  "se conserva"
);

// ── 2 bis. El tercer producto se puede APAGAR ───────────────────────────────
//
// Se puede querer esta modalidad sin tercer producto: vender los dos del
// principio y cerrar con la postventa de siempre. Al principio se forzaba
// encendido y no habia forma de apagarlo.
comprobar(
  "el tercer producto tiene su propio interruptor",
  /const conTercerProducto = c\.upsell\?\.enabled === true;/.test(editor),
  "aparte"
);
comprobar(
  "y se respeta en vez de forzarlo",
  /upsell: \{ \.\.\.c\.upsell, enabled: conTercerProducto \}/.test(editor) &&
    !/upsell: \{ \.\.\.c\.upsell, enabled: true \}/.test(editor),
  "se respeta"
);
// Y NO SE ENCIENDE NI SE APAGA SOLO.
//
// El interruptor pasó a ser explícito (`=== true`), así que lo que estaba
// encendido tiene que llegar encendido a la capa. La siembra copia lo que ya
// había dentro de la sección de Doble Oferta + Upsell; sin ella, la primera
// vez que se abriera el editor esta modalidad se quedaría sin tercer producto
// al guardar.
comprobar(
  "lo que ya estaba encendido llega encendido a su capa",
  /modo === "doble_oferta_upsell"\s*\r?\n?\s*\? loaded\.doble_oferta_upsell\?\.upsell/.test(
    editor
  ),
  "se siembra"
);
// EL INTERRUPTOR DE LA PESTAÑA ENCIENDE LA ETAPA, NO LA MODALIDAD.
//
// Antes, fuera de Doble Oferta + Upsell, esa casilla llamaba a
// `setModalidad("upsell", …)`: en Lineal, marcarla cambiaba LO QUE VENDE EL BOT.
// Ahora es siempre la misma —encender la segunda venta de la modalidad que se
// está editando— y escribe en `cfg.upsell.enabled`, nada más.
// Ya no es una casilla con una frase al lado: es un boton que dice lo que va a
// hacer —«Activar upsell» / «Desactivar upsell»—. Lo que se comprueba sigue
// siendo lo mismo: que escriba en `cfg.upsell.enabled` y NADA mas.
comprobar(
  "el interruptor de la pestaña no cambia de modalidad",
  /"Desactivar upsell" : "Activar upsell"/.test(editor) &&
    /editSnapshot\("upsell_enabled"\);\s*\r?\n\s*setCfg\(\{/.test(editor) &&
    !/setModalidad\("upsell"/.test(editor),
  "no la cambia"
);

// ── 3. La API la deja pasar en los DOS sentidos ─────────────────────────────
comprobar(
  "la API la lee del yaml",
  /const doble_oferta_upsell = \{/.test(api),
  "sí"
);
comprobar(
  "y la devuelve al editor",
  /\r?\n\s+doble_oferta_upsell,\r?\n/.test(api),
  "sí"
);
comprobar(
  "y la escribe de vuelta en el yaml",
  /doc\.set\(\s*"doble_oferta_upsell",/.test(api),
  "sí"
);
comprobar(
  "los minutos de espera sobreviven el viaje",
  (api.match(/retraso_minutos/g) ?? []).length >= 4,
  "ida y vuelta"
);
comprobar(
  "la plantilla de canal la contempla al leer Y al escribir",
  (api.match(/"doble_oferta_dos", "doble_oferta_upsell", "upsell"/g) ?? [])
    .length === 2,
  "las dos"
);

// ── 4. Sin duplicar el escritor de opciones ─────────────────────────────────
comprobar(
  "las dos secciones comparten el mismo escritor",
  (api.match(/const writeDdOption = /g) ?? []).length === 1 &&
    /writeDdOption\(du\?\.combo\)/.test(api),
  "uno solo"
);

console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} comprobación(es) mal.`);
process.exit(fallos === 0 ? 0 : 1);
