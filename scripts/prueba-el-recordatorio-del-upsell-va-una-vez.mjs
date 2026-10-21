// El recordatorio del upsell: una linea suya, UNA vez, y nunca la intro otra vez.
//
// LO QUE PASO — 15 de septiembre de 2026. Tras la venta, el cliente dijo que no
// le habia llegado el material y el bot se lo reenvio bien. Pero detras del
// reenvio le cayo OTRA VEZ la presentacion completa del segundo producto. Con
// sus palabras:
//
//   «luego de reenviar el enlace, nuevamente se envia la intro del upsell.
//    Eso no deberia pasar»
//
// POR QUE PASABA. `continuarTrasEntrega` corre despues de CUALQUIER entrega, y
// el reenvio es una entrega. Ahi dentro habia un bloque que, si la oferta seguia
// «ofrecida», reprogramaba `upsell_presentar` — o sea la intro entera, con sus
// burbujas y sus botones. Se habia escrito para un caso real (tras un upgrade la
// oferta quedaba enterrada y nadie volvia a nombrarla), pero la herramienta era
// la equivocada.
//
// LO QUE EL HABIA PEDIDO, con sus palabras: «un pequeno recordatorio, quizas un
// mensaje predeterminado sin costo que diga amablemente si le interesa el
// upsell»… «solo 1 vez luego ya no para no hostigar al cliente».
//
// ASI QUE AHORA: un texto suyo, escrito en el editor, que sale una sola vez en
// dos momentos —tras la entrega de un upgrade y tras contestar al regalo— y solo
// si no lo ha comprado. Sin texto escrito, no se manda nada y el bot se comporta
// igual que antes de que esto existiera.
//
//   node scripts/prueba-el-recordatorio-del-upsell-va-una-vez.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");
const engine = leer("src", "lib", "workflow", "engine.ts");
const db = leer("src", "lib", "db.ts");
const api = leer("src", "app", "api", "workflow", "route.ts");
const editor = leer("src", "app", "editor", "page.tsx");
const config = leer("src", "lib", "workflow", "config.ts");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};
/** El cuerpo de una funcion, desde su firma hasta la siguiente declaracion. */
const cuerpoDe = (src, firma) => {
  const i = src.indexOf(firma);
  if (i < 0) return "";
  const f = src.indexOf("\nfunction ", i + 10);
  const g = src.indexOf("\nexport ", i + 10);
  const fin = Math.min(f < 0 ? src.length : f, g < 0 ? src.length : g);
  return src.slice(i, fin);
};

// ── 1. YA NO SE RELANZA LA INTRO ────────────────────────────────────────────
console.log("\n— lo que ya no puede volver a pasar —\n");
const trasEntrega = cuerpoDe(engine, "export async function continuarTrasEntrega");
comprobar(
  "se encuentra continuarTrasEntrega",
  trasEntrega.length > 500,
  `${trasEntrega.length} car`
);
// La UNICA vez que puede aparecer ACTION_UPSELL_PRESENTAR ahi dentro es la
// primera oferta, la que nunca se hizo. Nunca para repetirla.
const vecesQuePresenta = (
  trasEntrega.match(/scheduleAction\(\s*convo\.id,\s*ACTION_UPSELL_PRESENTAR/g) ?? []
).length;
comprobar(
  "solo programa la presentacion UNA vez: la primera",
  vecesQuePresenta === 1,
  `${vecesQuePresenta} sitio(s)`
);
comprobar(
  "y con la oferta ya hecha NO la reprograma",
  !/fresco\.upsell_state === "ofrecido" &&[\s\S]{0,400}ACTION_UPSELL_PRESENTAR/.test(
    trasEntrega
  ),
  "se acabo la intro repetida"
);
comprobar(
  "con la oferta ya hecha, lo que sale es el recordatorio",
  /fresco\.upsell_state === "ofrecido"[\s\S]{0,200}programarRecordatorioDelUpsell/.test(
    trasEntrega
  ),
  "una linea, no la intro"
);

// ── 2. ES OTRA ACCION, Y TIENE SU MANEJADOR ─────────────────────────────────
console.log("\n— recordar no es presentar —\n");
comprobar(
  "existe el tipo de accion",
  /\|\s*"upsell_recordatorio"/.test(engine),
  "upsell_recordatorio"
);
comprobar(
  "y su constante",
  /const ACTION_UPSELL_RECORDATORIO: ActionType = "upsell_recordatorio";/.test(engine),
  "declarada"
);
comprobar(
  "el worker la atiende",
  /action\.action_type === ACTION_UPSELL_RECORDATORIO/.test(engine),
  "tiene manejador"
);
comprobar(
  "y si falla no arrastra nada",
  /ACTION_UPSELL_RECORDATORIO\)\s*\{[\s\S]{0,400}catch \(err\)/.test(engine),
  "la venta ya esta hecha"
);

// ── 3. LAS DOS PUERTAS QUE LO MANDAN ────────────────────────────────────────
console.log("\n— los dos momentos que pidio —\n");
comprobar(
  "tras la entrega (el caso del upgrade)",
  /programarRecordatorioDelUpsell\(fresco, "tras la entrega"\)/.test(engine),
  "continuarTrasEntrega"
);
const aceptaRegalo = cuerpoDe(engine, "export function acceptGiftConsent");
const rechazaRegalo = cuerpoDe(engine, "export async function declineGiftConsent");
comprobar(
  "cuando dice SI al regalo",
  /programarRecordatorioDelUpsell/.test(aceptaRegalo),
  "acceptGiftConsent"
);
comprobar(
  "cuando dice NO al regalo",
  /programarRecordatorioDelUpsell/.test(rechazaRegalo),
  "declineGiftConsent"
);
for (const [donde, cuerpo] of [
  ["tras la entrega", trasEntrega],
  ["al aceptar el regalo", aceptaRegalo],
  ["al rechazar el regalo", rechazaRegalo],
]) {
  comprobar(
    `y ${donde} solo si sigue «ofrecido»`,
    /upsell_state === "ofrecido"[\s\S]{0,200}programarRecordatorioDelUpsell/.test(cuerpo),
    "ni aceptado, ni rechazado, ni pagado"
  );
}

// ── 4. UNA SOLA VEZ, Y EL CANDADO ESTA EN LA BASE ───────────────────────────
console.log("\n— una vez y no se insiste —\n");
comprobar(
  "hay columna para recordarlo entre reinicios",
  /\["upsell_recordatorio_enviado", "INTEGER NOT NULL DEFAULT 0"\]/.test(db),
  "en conversations"
);
// El AND de la consulta es el candado: comprobar y escribir en dos pasos dejaria
// el hueco por el que se cuelan dos recordatorios si las dos puertas coinciden.
comprobar(
  "el candado va DENTRO del UPDATE, no antes",
  /SET upsell_recordatorio_enviado = 1 WHERE id = \? AND upsell_recordatorio_enviado = 0/.test(
    db
  ),
  "sin hueco entre comprobar y escribir"
);
comprobar(
  "y dice si le tocaba mandarlo a esta llamada",
  /marcarRecordatorioUpsellEnviado[\s\S]{0,300}\.changes > 0/.test(db),
  "devuelve true solo la primera"
);
const recordar = cuerpoDe(engine, "async function recordarElUpsell");
comprobar(
  "el emisor respeta ese candado",
  /if \(!marcarRecordatorioUpsellEnviado\(convo\.id\)\)/.test(recordar),
  "si ya salio, se calla"
);
comprobar(
  "nunca se vuelve a poner a 0",
  !/upsell_recordatorio_enviado = 0 WHERE/.test(
    db.replace(
      /SET upsell_recordatorio_enviado = 1 WHERE id = \? AND upsell_recordatorio_enviado = 0/g,
      ""
    )
  ),
  "no hay marcha atras"
);

// ── 5. LAS GUARDAS DEL EMISOR ───────────────────────────────────────────────
console.log("\n— y lo que le impide salir cuando no toca —\n");
const programar = cuerpoDe(engine, "function programarRecordatorioDelUpsell");
comprobar(
  "sin texto escrito no se manda nada",
  /const texto = up\?\.recordatorio\?\.trim\(\);[\s\S]{0,600}if \(!texto\) return;/.test(
    programar
  ),
  "vacio = como antes"
);
comprobar(
  "sin nombre del extra, tampoco",
  /if \(!\(up\?\.name \?\? ""\)\.trim\(\)\) return;/.test(programar),
  "antes callado que cojo"
);
comprobar(
  "no se encola dos veces a la vez",
  /hasPendingActionType\(convo\.id, ACTION_UPSELL_RECORDATORIO\)/.test(programar),
  "ni con las dos puertas"
);
// Esta guarda venia del bloque que el recordatorio sustituye. No se quita por
// parecer redundante: si el extra no se puede vender, recordarlo es peor que
// callarse — el cliente diria que si y no habria nada que darle.
comprobar(
  "y se conserva la guarda de «se puede vender»",
  /if \(!isUpsellUsable\(config\)\) return;/.test(programar),
  "la de antes, intacta"
);
comprobar(
  "SE VUELVE A MIRAR el estado al salir, no solo al programar",
  /const alDia = getConversationById\(convo\.id\)[\s\S]{0,300}alDia\.upsell_state !== "ofrecido"/.test(
    recordar
  ),
  "en esos minutos pudo comprarlo"
);
comprobar(
  "usa SU ritmo, el mismo de la oferta",
  /Math\.floor\(up\?\.retraso_minutos \?\? 0\)/.test(programar),
  "retraso_minutos"
);

// ── 6. NO PASA POR EL MODELO, Y RESUELVE SUS COMODINES ──────────────────────
console.log("\n— es su texto, no una respuesta inventada —\n");
comprobar(
  "no llama al modelo",
  !/generateReply|openrouter/i.test(recordar),
  "cero tokens"
);
// El CUARTO parametro de sendResponseStep es el que resuelve el precio del
// extra en el texto ({{PRECIO_UPSELL}}).
// Sin el, el comodin del precio saldria crudo en el chat del cliente.
comprobar(
  "sale por el camino de siempre, con los comodines del extra",
  /sendResponseStep\([\s\S]{0,200}precioDelExtra,\s*true\s*\)/.test(recordar),
  "igual que la presentacion"
);
comprobar(
  "y {{PRODUCTO_UPSELL}} se resuelve de verdad",
  /producto_upsell\|producto3\|producto_3/.test(config),
  "applyProductName"
);

// ── 7. EL CAMPO SOBREVIVE AL GUARDADO ───────────────────────────────────────
//
// Esta es la parte que mas veces ha fallado en este proyecto: la API reconstruye
// cada seccion CAMPO A CAMPO, y lo que no se nombra se pierde al guardar sin que
// nadie avise. Es el fallo del cajon que se duplicaba y desaparecia al refrescar.
// Y son CUATRO listas: leer y escribir, por cada una de las dos cajas.
console.log("\n— y no se pierde al guardar (las cuatro listas) —\n");
comprobar(
  "el editor tiene el campo",
  /recordatorio: e\.target\.value/.test(editor),
  "caja de texto"
);
comprobar(
  "y avisa de que va una sola vez",
  /una sola vez/.test(editor),
  "en su ayuda"
);
const cuantasEnLaApi = (api.match(/recordatorio: str\(/g) ?? []).length;
comprobar(
  "la API lo nombra en las cuatro listas",
  cuantasEnLaApi >= 4,
  `${cuantasEnLaApi} de 4`
);
comprobar(
  "leyendo la caja normal",
  /recordatorio: str\(upCfg\?\.recordatorio\)/.test(api),
  "cfg.upsell"
);
comprobar(
  "leyendo la caja de -DOU-",
  /recordatorio: str\(duUp\?\.recordatorio\)/.test(api),
  "doble_oferta_upsell.upsell"
);
comprobar(
  "escribiendo la caja normal",
  /recordatorio: str\(u\?\.recordatorio\)/.test(api),
  "al guardar"
);
comprobar(
  "escribiendo la caja de -DOU-",
  /recordatorio: str\(duU\?\.recordatorio\)/.test(api),
  "al guardar"
);
// -DOU- lee su PROPIA caja. El editor la arma copiando la de «Upsell» con un
// spread, asi que el campo viaja solo — pero si alguien cambiara ese spread por
// una lista campo a campo, el recordatorio dejaria de llegar a la modalidad que
// el usa. Por eso se comprueba.
comprobar(
  "el editor copia la caja entera a -DOU-, no campo a campo",
  /upsell: \{ \.\.\.c\.upsell, enabled: conTercerProducto \}/.test(editor),
  "spread, no lista blanca"
);

console.log(
  fallos === 0
    ? "\nTODO OK — el recordatorio sale una vez, y la intro no se repite\n"
    : `\n${fallos} comprobacion(es) mal.\n`
);
process.exit(fallos === 0 ? 0 : 1);
