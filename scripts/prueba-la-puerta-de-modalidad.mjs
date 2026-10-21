// Cambiar de modalidad ya no mezcla: se entra por una puerta y se recarga.
//
// LO QUE HABIA
//
//   Un desplegable «Editar modalidad» en la barra. Al tocarlo, `switchModalidad`
//   rehacia la pantalla EN MEMORIA: guardaba en su plantilla lo de la modalidad
//   que dejabas y cargaba encima lo de la nueva. El problema era el «encima»:
//   los campos que la nueva no tuviera guardados se quedaban con los de la
//   anterior, y bastaba dar a Guardar para que quedaran escritos como suyos.
//
// LO QUE HAY
//
//   Un boton que abre «¿Que modalidad deseas editar?», y al elegir se RECARGA la
//   pagina. Al cargar, el editor lee la capa de esa modalidad del archivo. No es
//   que la mezcla se evite: es que no hay nada anterior con lo que mezclar.
//
// LO QUE VIGILA ESTA PRUEBA
//
//   1. El desplegable ya no existe (se tocaba sin pensar).
//   2. Cambiar de modalidad recarga; no se rehace nada en memoria.
//   3. La funcion que mezclaba esta retirada, no aparcada: nadie puede volver a
//      llamarla sin darse cuenta.
//   4. Avisa antes de perder cambios sin guardar.
//   5. La cortina tapa la pantalla mientras cambia.
//   6. Sale un cartel cuando lo que editas NO es lo que vende.
//
//   node scripts/prueba-la-puerta-de-modalidad.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const editor = readFileSync(
  join(RAIZ, "src", "app", "editor", "page.tsx"),
  "utf8"
);

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// ── 1. Fuera el desplegable ──────────────────────────────────────────────────
comprobar(
  "ya no hay desplegable de modalidad",
  !/Editar modalidad:/.test(editor) &&
    !/onChange=\{\(e\) => selectModalidad\(e\.target\.value as Modo\)\}/.test(editor),
  "ahora es una puerta"
);
comprobar(
  "hay un boton que abre la puerta",
  /setPuertaDeModalidad\(true\)/.test(editor) &&
    /¿Qué modalidad deseas editar\?/.test(editor),
  "se entra a proposito"
);
comprobar(
  "la puerta dice que el bot NO cambia",
  /El bot seguirá vendiendo/.test(editor),
  "lo que mas asusta, dicho"
);

// ── 2. Se cambia recargando ──────────────────────────────────────────────────
const cambio = (() => {
  const i = editor.indexOf("const selectModalidad = (newMod: Modo): void => {");
  return i < 0 ? "" : editor.slice(i, i + 1600);
})();
comprobar("se encuentra el cambio de modalidad", cambio.length > 0, "selectModalidad");
comprobar(
  "recarga la pagina",
  /window\.location\.reload\(\)/.test(cambio),
  "lee la capa del archivo"
);
comprobar(
  "y no rehace nada en memoria",
  !/setCfg\(/.test(cambio),
  "no hay donde mezclar"
);
comprobar(
  "deja la modalidad elegida apuntada antes de recargar",
  cambio.indexOf("rememberEditorModality(newMod)") > 0 &&
    cambio.indexOf("rememberEditorModality(newMod)") <
      cambio.indexOf("window.location.reload()"),
  "si no, volveria a la de antes"
);

// ── 3. La funcion que mezclaba, retirada de verdad ───────────────────────────
//
// Dejarla «por si acaso» es lo que hace que alguien la vuelva a llamar sin
// saber lo que arrastra. Solo puede quedar su explicacion.
comprobar(
  "la funcion que mezclaba ya no existe",
  !/function switchModalidad\(/.test(editor),
  "retirada, no aparcada"
);
comprobar(
  "pero queda escrito por que se fue",
  /AQUÍ VIVÍA `switchModalidad`, Y ESTÁ RETIRADA A PROPÓSITO/.test(editor),
  "para que nadie la reponga"
);

// ── 4. Avisa antes de perder trabajo ─────────────────────────────────────────
comprobar(
  "avisa si hay cambios sin guardar",
  /isDirty &&\s*!window\.confirm\(/.test(cambio),
  "cancelar = me quedo y guardo"
);

// ── 5. La cortina ────────────────────────────────────────────────────────────
comprobar(
  "tapa la pantalla mientras cambia",
  /setCortina\(MODALIDAD_LABEL\[newMod\]\)/.test(cambio) &&
    /Cambiando a \{cortina\}…/.test(editor),
  "no se puede tocar a medio camino"
);

// ── 6. Donde estas, sin cartel ───────────────────────────────────────────────
//
// Esto llevaba una franja ambar avisando de que editabas una modalidad distinta
// de la que vende. El operador pidio quitarla, y con razon: sale mientras
// trabajas, siempre, y lo que avisaba ya no puede pasar. La informacion se
// queda —en el propio boton, en gris— y el aviso que si importa lo da el
// cerrojo, en el momento de guardar.
comprobar(
  "ya no hay franja de aviso mientras editas",
  !/⚠️ Estás editando una modalidad distinta/.test(editor) &&
    !/← Volver a la que vende/.test(editor),
  "sin ruido"
);
comprobar(
  "pero el boton dice cual vende cuando no es la que editas",
  /activeModality\(cfg\) !== runtimeModality\(cfg\) && \(/.test(editor) &&
    /· vende \{MODALIDAD_LABEL\[runtimeModality\(cfg\)\]\}/.test(editor),
  "la informacion no se pierde"
);
comprobar(
  "y volver es un clic: la puerta marca cual vende",
  /vendiendo\s*<\/span>/.test(editor),
  "se elige de la lista"
);

console.log(
  `\n${fallos === 0 ? "TODO OK — se entra por la puerta, y no se mezcla nada" : `${fallos} FALLOS`}`
);
process.exit(fallos === 0 ? 0 : 1);
