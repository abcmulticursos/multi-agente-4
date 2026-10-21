// Cambiar la modalidad del bot lleva la pantalla consigo.
//
// DE DONDE SALE
//
//   «Al cambiar de modalidad BOT ACTIVO, que primero cambie la modalidad de
//   edición a la elegida, y luego cambie la modalidad del bot y refresque.»
//
//   Antes se quedaba a medias: el interruptor cambiaba, la pantalla no. Te
//   quedabas editando una modalidad mientras el bot vendía otra, con los avisos
//   de «editas X, vende Y» saliendo por todas partes. Se podía hacer a mano en
//   dos pasos, pero había que acordarse del segundo — y no acordarse es
//   exactamente como se editan doce campos en la modalidad equivocada.
//
// EL ORDEN IMPORTA, Y ES POR ALGO
//
//   1. se apunta el cambio en la configuración,
//   2. se GUARDA — sin esto el paso 3 se lo lleva por delante, porque el cambio
//      vive en memoria hasta que alguien lo escribe,
//   3. se recarga ya editando esa modalidad.
//
//   El paso 3 recarga en vez de repintar, igual que el selector de edición:
//   repintando es donde el contenido de una modalidad se metía en la otra.
//
//   node scripts/prueba-cambiar-el-bot-lleva-la-pantalla.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const editor = readFileSync(join(RAIZ, "src", "app", "editor", "page.tsx"), "utf8");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 62)} ${valor}`);
};

// ── 1. El guardado dice si salió bien ────────────────────────────────────────
//
// Sin esto, encadenar una recarga detrás seria a ciegas: este guardado tiene
// TRES sitios donde el propio operador puede decir que no.
comprobar(
  "el guardado informa de si llegó a completarse",
  /async function save\(\): Promise<boolean> \{/.test(editor) &&
    /if \(!cfg\) return false;/.test(editor),
  "no se encadena a ciegas"
);
comprobar(
  "y cancelar un aviso de seguridad cuenta como NO guardado",
  (editor.match(/msg: "No se guardó nada\. Tu contenido sigue intacto\.",\s*\r?\n\s*\}\);\s*\r?\n\s*return false;/g) ?? [])
    .length === 2,
  "los dos avisos"
);
// Guardado en vivo pero SIN publicar: ese cuadro se tiene que leer, y una
// recarga se lo llevaria de la pantalla.
comprobar(
  "y si no se pudo publicar, tampoco se recarga",
  /setPublishBlocked\([\s\S]{0,120}?\);[\s\S]{0,320}?return false;/.test(editor),
  "el aviso se tiene que leer"
);

// ── 2. Los tres pasos, en orden ──────────────────────────────────────────────
comprobar(
  "activar el bot deja el cambio pendiente, no recarga a lo loco",
  /setPendienteDeActivar\(newMode\);/.test(editor),
  "primero hay que guardarlo"
);
comprobar(
  "y se espera a que la configuración YA lleve el cambio",
  /if \(runtimeModality\(cfg\) !== pendienteDeActivar\) return;/.test(editor),
  "setCfg no es inmediato"
);
// EL SELECTOR DE EDICION SE APUNTA AHORA AL PRINCIPIO, no aqui: al elegir una
// modalidad arriba, la de abajo ya es esa antes de que pase nada mas. Lo que
// esta prueba fija sigue siendo lo mismo: que solo se recargue si el guardado
// salio bien.
comprobar(
  "guarda, y solo si sale bien recarga en la modalidad nueva",
  /const guardado = await save\(\);\s*\r?\n\s*if \(!guardado\) \{/.test(editor) &&
    /setCortina\(MODALIDAD_LABEL\[destino\]\);[\s\S]{0,200}?window\.location\.reload\(\)/.test(
      editor
    ),
  "el orden que pidió"
);
comprobar(
  // Y ahora deshace tambien lo unico que se habia adelantado, el selector de
  // edicion: si no, quedaria apuntando a una modalidad que el bot no activo.
  "y si el guardado falla, se queda donde estaba",
  /if \(!guardado\) \{[\s\S]{0,320}?rememberEditorModality\(activeModality\(cfg\)\);\s*\r?\n\s*activandoRef\.current = false;\s*\r?\n\s*setPendienteDeActivar\(null\);\s*\r?\n\s*return;/.test(
    editor
  ),
  "sin perder nada"
);
// El propio guardado vuelve a tocar la configuracion al terminar; sin un pestillo
// el efecto se dispararia otra vez.
comprobar(
  "y no se dispara dos veces",
  /const activandoRef = useRef\(false\);/.test(editor) &&
    /activandoRef\.current = true;/.test(editor),
  "un solo intento"
);

// ── 3. Lo que NO cambia ──────────────────────────────────────────────────────
//
// La recarga es la MISMA puerta que ya usaba el selector de edicion. Y el
// guardado sigue proyectando la pantalla en la capa que se estaba editando: si
// aqui se cambiara `editor_mode` antes de guardar, lo de una modalidad acabaria
// escrito en la capa de la otra — que es el fallo que este editor ya sufrio.
comprobar(
  "\nsigue guardando en la capa que estabas editando",
  /const _editingMode = activeModality\(cfg\);/.test(editor) &&
    /editor_mode: editingMode,/.test(editor),
  "sin mezclar capas"
);
comprobar(
  "y el selector de edición sigue funcionando igual",
  /const selectModalidad = \(newMod: Modo\): void => \{/.test(editor) &&
    /rememberEditorModality\(newMod\);[\s\S]{0,420}?window\.location\.reload\(\)/.test(
      editor
    ),
  "intacto"
);
comprobar(
  "y el seguro de no pisar con vacío sigue en pie",
  (editor.match(/noPisarConVacio\(/g) ?? []).length >= 3,
  "los tres sitios"
);

console.log(
  fallos === 0
    ? "\nTODO OK — cambiar el bot te deja editando esa misma modalidad"
    : `\n${fallos} comprobacion(es) mal.`
);
process.exit(fallos === 0 ? 0 : 1);
