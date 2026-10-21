// EL «GUARDAR» DE UN POP UP NO HACE GUARDADO GENERAL, Y ALGUIEN AVISA.
//
// LO PIDIO EL DUEÑO el 28 de septiembre de 2026, con estas palabras:
//
//   «Cuando yo entro a los pop up de seguimientos, y hago una edicion, puede ser
//    seguimiento 1, seguimiento 2, o las intros de order bump, cuando se despliega
//    el pop up y yo guardo presionando ese "guardar" en el pop up, hace un
//    "guardado general". Yo no deseo eso: yo quiero que el guardar de los pop ups
//    guarden los cambios del contenido de sus ventanas respectivas, pero que no
//    hagan guardado general. Pero, cuando yo haga algun cambio en el editor que
//    aparezca al lado de "guardar" AUN NO HAS GUARDADO TUS CAMBIOS, como aviso
//    extra. Entonces con eso puedo hacer ediciones y el boton de guardar "general"
//    que esta en el menu o cerca de el o control +S es el que define el guardado
//    general en cuanto a cambios de este tipo.»
//
// ESTA PRUEBA SUSTITUYE A `prueba-el-popup-del-recorrido-sube-lo-suyo.mjs`, que
// fijaba lo CONTRARIO, y hay que leer las dos fechas antes de tocar nada:
//
//   21/09/2026 — «le di al boton GUARDAR de ese pop up, y no hubo cambios… luego
//                 guarde la intro y entonces el del seguimiento tambien se
//                 guardo». Se conecto el pop up al guardado general.
//   28/09/2026 — pide lo de arriba.
//
// NO SE CONTRADICE: lo que le costaba trabajo en septiembre no era que el pop up
// no subiera, era que NADIE LE AVISABA de que quedaba algo sin subir. Un boton
// que dice «Guardar» y no sube manda a casa con el trabajo perdido.
//
// POR ESO LAS DOS MITADES VAN JUNTAS EN ESTA PRUEBA. Quitar el cartel deja otra
// vez la trampa de septiembre, asi que si alguien lo borra, esto se pone rojo.
//
//   node scripts/prueba-el-guardar-de-los-popups-no-es-general.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const editor = readFileSync(
  join(RAIZ, "src", "app", "editor", "page.tsx"),
  "utf8"
).replace(/\r\n/g, "\n");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// ── 1. EL POP UP DE UNA BURBUJA: APLICA, NO SUBE ───────────────────────────
//
// Es el de «click derecho → editar» sobre una burbuja del recorrido, que es por
// donde el dueño entra a seguimiento 1, seguimiento 2 y las intros.
console.log("— el pop up de una burbuja —\n");

// SE CORTA HACIA ATRAS DESDE EL CIERRE, no hacia delante desde la apertura: hay
// mas de un `onChange={(steps) => {` en el archivo.
const cierre = editor.indexOf("onClose={() => setEditingStep(null)}");
const aperturas = [
  ...editor.slice(0, cierre).matchAll(/onChange=\{\(steps\) => \{/g),
];
const desde = aperturas.length
  ? aperturas[aperturas.length - 1].index + aperturas[aperturas.length - 1][0].length
  : -1;
const manejador = desde >= 0 ? editor.slice(desde, cierre) : "";
comprobar("se encuentra el manejador del pop up", manejador.length > 0);

comprobar(
  "aplica el cambio al borrador ← SU CASO",
  /editingStep\.onChange\(steps\);/.test(manejador),
  "lo escrito se queda puesto"
);
comprobar(
  "pero NO hace guardado general",
  !/onSave\(\)/.test(manejador) && !/setGuardarTrasAplicar/.test(manejador),
  "ni ahi ni con bandera"
);
comprobar(
  "y no queda ni rastro de la bandera que subia",
  !/guardarTrasAplicar/.test(editor),
  "se retiro con su efecto"
);
comprobar(
  "sigue actualizando su propio borrador",
  /setEditingStep\(\(current\) => current \? \{ \.\.\.current, steps \} : current\);/.test(
    manejador
  ),
  "sin esto el cursor saltaba al final"
);

// ── 2. EL VERDE DE LAS DEMAS VENTANAS, IGUAL ───────────────────────────────
//
// `BotonesDeLaVentana` es el de arriba a la derecha de todas las ventanas del
// editor —las de producto, las de seguimientos, las de las intros—.
console.log("\n— el verde de las demas ventanas —\n");

const botones = (() => {
  const i = editor.indexOf("function BotonesDeLaVentana(");
  const f = editor.indexOf("function VentanaDeProducto(", i);
  return i < 0 || f < 0 ? "" : editor.slice(i, f);
})();
comprobar("se encuentra `BotonesDeLaVentana`", botones.length > 0);
comprobar(
  "Guardar deja lo escrito y cierra, sin subir",
  !/guardado\.guardar\(\)/.test(botones) && /onCerrar\(\);/.test(botones),
  "sube el de la barra, o Ctrl+S"
);
comprobar(
  "y Cancelar sigue DESHACIENDO lo de esta ventana",
  /guardado\?\.restaurar\(huellaAlAbrir\);/.test(botones),
  "es lo que distingue los dos botones"
);
comprobar(
  "sin tocar nada sigue siendo un solo «Cerrar»",
  /if \(!cambioAqui\) \{/.test(botones),
  "la palabra no miente"
);

// ── 3. EL CARTEL: LA OTRA MITAD, Y NO ES OPCIONAL ──────────────────────────
console.log("\n— «Aún no has guardado tus cambios» —\n");

comprobar(
  "existe el cartel, con su texto exacto",
  /function AvisoDeSinGuardar\(/.test(editor) &&
    /Aún no has guardado tus cambios/.test(editor),
  "sus palabras"
);
comprobar(
  "solo sale cuando queda algo sin guardar",
  /if \(!sucio \|\| guardando\) return null;/.test(editor),
  "y se calla mientras sube"
);
comprobar(
  "va pegado a los DOS botones de guardado general",
  (editor.match(/<AvisoDeSinGuardar sucio=\{isDirty\} guardando=\{saving\} \/>/g) ?? [])
    .length === 2,
  "la cabecera y el modo concentracion"
);

// EL CARTEL SE ALIMENTA DEL MISMO SITIO QUE EL BOTON. Si tuviera su propia idea
// de «hay cambios», diria una cosa y el boton otra.
comprobar(
  "mira el mismo «hay cambios» que el boton",
  /const isDirty = cfg !== null && huellaDelBorrador !== baseline;/.test(editor),
  "una sola fuente"
);

// ── 4. EL GUARDADO GENERAL SIGUE DONDE ESTABA ──────────────────────────────
//
// Es lo unico que sube, asi que si esto se cae el editor se queda sin forma de
// guardar y el cartel no se apaga nunca.
console.log("\n— y el guardado general sigue en pie —\n");

comprobar(
  "el boton de la barra guarda",
  /onClick=\{save\}\n\s*disabled=\{saving \|\| !cfg \|\| !isDirty\}/.test(editor),
  "el de «Guardar» de arriba"
);
comprobar(
  "Ctrl+S guarda",
  /if \(key === "s"\) \{[\s\S]{0,300}?if \(!saving\) void save\(\);/.test(editor),
  "desde dentro de un campo tambien"
);
comprobar(
  "y el recorrido conserva su «Guardar cambios»",
  /onClick=\{onSave\}/.test(editor) &&
    /disabled=\{saving \|\| !hayCambios\}/.test(editor),
  "es el unico a mano con el recorrido abierto"
);

// ── 5. LO QUE NO SE PUEDE HABER ROTO ───────────────────────────────────────
console.log("\n— lo que ya estaba sigue en pie —\n");

comprobar(
  "Escape sigue cerrando de dentro hacia fuera",
  /if \(editingStep\) return;\s*\n\s*onClose\(\);/.test(editor),
  "no se van dos ventanas de un golpe"
);
comprobar(
  "el contexto sigue dando el estado a las ventanas",
  /const GuardadoDelEditor = createContext</.test(editor) &&
    /sucio: isDirty,\n\s*guardando: saving,\n\s*guardar: save,\n\s*huella: huellaDelBorrador,/.test(
      editor
    ),
  "el mismo que la barra"
);

console.log(`\n${fallos === 0 ? "TODO EN VERDE" : `${fallos} EN ROJO`}\n`);
process.exit(fallos === 0 ? 0 : 1);
