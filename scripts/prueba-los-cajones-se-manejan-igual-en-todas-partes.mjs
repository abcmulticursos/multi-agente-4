// Los cajones se manejan igual en todas partes, y cada seguimiento tiene su
// ventana.
//
// TRES COSAS QUE PIDIO EL DUENO EL 15 DE SEPTIEMBRE DE 2026, mirando la
// pantalla:
//
//   A. En Canales -> Upsell y Canales -> Order Bump se queda el estilo de
//      ventana que tienen ahora —quiere probarlo unos dias antes de decidir—
//      pero con los botones de la fila que ya tiene Intro: subir, bajar, mover
//      y la papelera.
//
//   B. Los seguimientos se abrian hacia abajo y empujaban a los otros dos:
//      «si toco seguimiento 1, solo veo el contenido del seguimiento 1, ya no
//      veo el 2 ni el 3».
//
//   C. Dentro de un seguimiento, «Mensajes principales» y «Variantes» iban
//      pegados, sin aire. Lo marco con una flecha.
//
//   node scripts/prueba-los-cajones-se-manejan-igual-en-todas-partes.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const editor = readFileSync(join(RAIZ, "src", "app", "editor", "page.tsx"), "utf8");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};
const trozo = (desde, hasta) => {
  const i = editor.indexOf(desde);
  if (i < 0) return "";
  const f = editor.indexOf(hasta, i);
  return f < 0 ? editor.slice(i) : editor.slice(i, f);
};

// ── A. LA FILA DE LOS CAJONES DE LA OFERTA Y DEL UPSELL ──────────────────────
console.log("\n— A. subir, bajar, mover y papelera en Upsell y Order Bump —\n");
// Hasta el final del componente: el marcador de cierre que se usaba vive ANTES
// de esta lista, asi que `indexOf` no lo encontraba por delante y el trozo se
// llevaba medio archivo — con el «Borrar» del archivador dentro.
const cajones = trozo("      {grupos.map((grupo, i) => (", "\nfunction ");
comprobar("se encuentra la lista", cajones.length > 0, "CajonesDeIntro");
// LOS BOTONES PERDIERON SU PALABRA EL 30/09/2026, y la afirmación se actualiza
// conservando su intención: lo que importa no es el texto, es que la fila tenga
// los MISMOS controles en todas partes. Ahora se reconocen por su `aria-label`,
// que además es lo que lee quien no ve la pantalla.
//
// Por qué se fue la palabra: la etiqueta de semimodalidad entra en esta misma
// fila y no cabía todo. Él lo pidió así: «hay que minimizar espacio... quitar el
// texto y que solo queden las flechas».
for (const [boton, marca] of [
  ["subir", 'aria-label="Subir este cajón"'],
  ["bajar", 'aria-label="Bajar este cajón"'],
  ["mover", 'aria-label="Arrastrar para moverlo de sitio"'],
  // DUPLICAR BAJO A LA FILA el 30/09/2026. Lo pidio el dueño: «para duplicarlo
  // como esta hoy tengo que entrar dentro de la pestaña; mejor que lo tenga en
  // la fachada como sus demas botones».
  ["duplicar", 'aria-label="Duplicar este cajón"'],
  ["la papelera", "🗑️"],
]) {
  comprobar(`la fila tiene «${boton}»`, cajones.includes(marca), "como en Intro");
}
// Y LA ACCION ESTA ESCRITA UNA SOLA VEZ. Los dos botones —el de la fila y el de
// dentro— llaman a la MISMA funcion. Escribirla dos veces es como se acaba
// teniendo dos duplicados que se portan distinto.
comprobar(
  "y el duplicado no esta escrito dos veces",
  (editor.match(/const duplicarCajon = \(i: number\) => \{/g) ?? []).length === 1 &&
    (cajones.match(/duplicarCajon\(i\)/g) ?? []).length >= 2,
  "los dos botones llaman a lo mismo"
);
comprobar(
  "y son los MISMOS controles que los de Intro",
  /aria-label="Subir este cajón"[\s\S]{0,4000}aria-label="Bajar este cajón"[\s\S]{0,4000}aria-label="Arrastrar para moverlo de sitio"/.test(
    trozo("function ChannelIntroEditor({", "\nfunction ChannelFollowupsEditor(")
  ),
  "nada que reaprender"
);
// Y LA ETIQUETA VIVE EN ESA MISMA FILA, que es para lo que se hizo el sitio.
comprobar(
  "la fila lleva la etiqueta de semimodalidad",
  cajones.includes("PastillaDeSemimodalidad"),
  "en la fachada, sin abrir el cajón"
);
comprobar(
  "subir y bajar se apagan en los extremos",
  /disabled=\{i === 0\}/.test(cajones) &&
    /disabled=\{i === grupos\.length - 1\}/.test(cajones),
  "no se sale de la lista"
);
comprobar(
  "arrastrar solo acepta cajones de ESTA lista",
  /if \(clase !== "cajon" \|\| deDonde !== idPrefix\) return;/.test(cajones),
  "no se cruzan las secciones"
);
comprobar(
  "y la persiana del que se mueve sigue abierta",
  /keepMovedCollapsibleOpen\(`\$\{idPrefix\}_cajon`/.test(cajones),
  "no se cierra sola al moverla"
);
comprobar(
  "quitar pregunta antes",
  /¿Quitar «\$\{grupo\.name\?\.trim\(\) \|\| "este cajón"\}»\? Se pierden sus burbujas\./.test(
    cajones
  ),
  "no se borra de un clic"
);
comprobar(
  "y ya no hay DOS sitios para quitar",
  (cajones.match(/Se pierden sus burbujas/g) ?? []).length === 1,
  "solo la papelera de la cabecera"
);
comprobar(
  "Duplicar y Peso siguen dentro, como en Intro",
  /⧉ Duplicar/.test(cajones) && /Peso/.test(cajones),
  "donde estaban"
);
comprobar(
  "y el estilo de ventana se conserva",
  /enVentana/.test(cajones),
  "el dueño quiere probarlo unos dias"
);

// ── B. CADA SEGUIMIENTO, EN SU VENTANA ───────────────────────────────────────
console.log("\n— B. cada seguimiento se abre solo —\n");
const seguimientos = trozo(
  "function ChannelFollowupsEditor(",
  "\n      <button\n        type=\"button\"\n        onClick={addFollowup}"
);
comprobar(
  "se encuentra la lista de seguimientos",
  seguimientos.length > 0,
  "ChannelFollowupsEditor"
);
comprobar(
  "el cajón del seguimiento abre en ventana",
  /titleKey=\{`channel_\$\{channel\}_own_followup_\$\{index\}`\}[\s\S]{0,1400}enVentana/.test(
    seguimientos
  ),
  "ya no empuja a los otros dos"
);
comprobar(
  "y es el MISMO interruptor que usan la oferta y el upsell",
  /enVentana \?\?/.test(editor) || /enVentana = false,/.test(editor),
  "no es una pantalla nueva"
);
comprobar(
  "la barra de arriba no cambia: sigue con copiar, subir y bajar",
  /Copiar/.test(seguimientos) && /Mover/.test(seguimientos),
  "lo de fuera se queda igual"
);

// ── C. LOS DOS CAJONES DE DENTRO, SEPARADOS ──────────────────────────────────
// C. LOS DOS CAJONES PEGADOS: EL PROBLEMA SE FUE CON LAS DOS PESTANAS.
//
// Esto medía que «Mensajes principales» y «Variantes» —dos pestanas, una debajo
// de la otra y sin aire— fueran agrupadas con separacion. El 15 de septiembre
// de 2026 el dueno pidio que dejaran de ser dos pestanas: ahora es UNA lista de
// cajones hermanos con su propio respiro, asi que no hay nada que separar. Ver
// `prueba-el-seguimiento-es-una-sola-lista`.
//
// La intencion —que no se vean pegados— se mide ahora sobre la lista.
console.log("\n— C. una sola lista, con su respiro —\n");
comprobar(
  "ya no hay dos pestañas que separar",
  !/title="💬 Mensajes principales"/.test(seguimientos) &&
    !/title="🎲 Variantes"/.test(seguimientos),
  "se fueron las dos"
);
comprobar(
  "y la lista de cajones lleva su separación",
  /UNA SOLA LISTA DE CAJONES[\s\S]{0,1200}<div className="space-y-3">/.test(
    seguimientos
  ),
  "el mismo respiro que las demás"
);

// ── Y LO QUE NO SE TOCA ──────────────────────────────────────────────────────
console.log("\n— y lo que ya funcionaba, intacto —\n");
comprobar(
  "la lista de Intro sigue con su propia clave de persiana",
  /titleKey=\{`channel_\$\{channel\}_own_intro_\$\{index\}`\}/.test(editor),
  "no se le cierran los cajones abiertos"
);
comprobar(
  "y el guardado sigue enviando los tres campos",
  /order_bump_intro_groups: content\.order_bump_intro_groups \?\? \[\]/.test(
    editor
  ) &&
    /upsell_intro_groups: content\.upsell_intro_groups \?\? \[\]/.test(editor) &&
    /intro_groups: \(content\.intro_groups \?\? \[\]\)\.map/.test(editor),
  "el arreglo del cajón fantasma"
);

console.log(
  fallos === 0
    ? "\nTODO OK — se manejan igual, y cada seguimiento tiene su ventana"
    : `\n${fallos} comprobacion(es) mal.`
);
process.exit(fallos === 0 ? 0 : 1);
