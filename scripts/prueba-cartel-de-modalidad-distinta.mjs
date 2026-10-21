// «Llene el Producto 2, guarde, y al refrescar estaba vacio».
//
// LO QUE PASO
//
// Se lleno el Producto 2 entero —nombre, contenido, enlace de Drive y su
// caption—, se guardo, y al refrescar salia vacio.
//
// NO SE HABIA PERDIDO. Estaba guardado en la plantilla de su modalidad. Lo que
// pasaba es que la pantalla se rehacia desde la modalidad que VENDE, y esa no
// tenia Producto 2: el campo salia vacio cada vez. Dos sustos en un dia por lo
// mismo: parecia contenido borrado y no lo era.
//
// LO QUE SE HIZO ENTONCES: un cartel ambar que lo explicaba.
//
// LO QUE SE HACE AHORA: que no pase.
//
// El cartel tapaba el sintoma. La causa era que la pantalla se armaba desde la
// modalidad equivocada. Al cargar, el editor lee la capa de la modalidad que
// SE EDITA —no la que vende— asi que lo que ves es lo suyo, y sus huecos son
// huecos de verdad, no cosas perdidas.
//
// El cartel se retiro a peticion del operador: un aviso permanente mientras
// trabajas se deja de leer al segundo dia, y este ya no informaba de nada.
//
// LO QUE VIGILA ESTA PRUEBA
//
//   1. La pantalla se arma desde la modalidad que SE EDITA.
//   2. Esa eleccion sobrevive a la recarga (se recuerda en el navegador).
//   3. No queda ningun cartel permanente avisando de esto.
//   4. La informacion sigue estando, sin gritar: en el boton de la barra.
//
//   node scripts/prueba-cartel-de-modalidad-distinta.mjs
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

// ── 1. La pantalla se arma desde la que SE EDITA ─────────────────────────────
//
// Aqui estaba la causa. Si esto volviera a armarse desde la que vende, el
// Producto 2 volveria a verse vacio y el susto volveria con el.
const carga = (() => {
  const i = editor.indexOf("const runtime = runtimeModality(loaded);");
  const f = editor.indexOf("setBaseline(JSON.stringify(hydrated));", i);
  return i < 0 || f < 0 ? "" : editor.slice(i, f);
})();
comprobar("se encuentra la carga", carga.length > 0, `${carga.length} car.`);
comprobar(
  "la pantalla se arma desde la modalidad que SE EDITA",
  /const active = savedEditorModality\(\) \?\? runtime;/.test(carga) &&
    /applyTemplate\(loaded, activeTpl, active\)/.test(carga),
  "no desde la que vende"
);
comprobar(
  "y su capa se lee del archivo",
  /const activeTpl = loaded\.modality_templates\?\.\[active\];/.test(carga),
  "lo que ves es lo suyo"
);

// ── 2. La eleccion sobrevive a la recarga ────────────────────────────────────
//
// Cambiar de modalidad recarga la pagina. Si la eleccion no se recordara,
// volverias siempre a la que vende y no podrias editar ninguna otra.
comprobar(
  "la modalidad que editas se recuerda",
  /function savedEditorModality\(\): Modo \| null \{/.test(editor) &&
    /function rememberEditorModality\(mode: Modo\): void \{/.test(editor),
  "sobrevive a la recarga"
);

// ── 3. Sin carteles permanentes ──────────────────────────────────────────────
//
// Habia DOS: una franja en la barra y un bloque grande dentro de la zona de
// edicion. Los dos salian todo el rato mientras trabajabas.
comprobar(
  "no queda ningun cartel ambar de modalidad distinta",
  !/⚠️ Estás editando una modalidad distinta/.test(editor) &&
    !/← Volver a la que vende/.test(editor),
  "sin ruido mientras trabajas"
);
comprobar(
  "y queda escrito por que se fueron",
  /AQUÍ HABÍA UN CARTEL ÁMBAR, Y SE RETIRA A PROPÓSITO/.test(editor),
  "para que nadie los reponga"
);

// ── 4. La informacion no se pierde ───────────────────────────────────────────
comprobar(
  "el boton dice cual editas",
  /✏️ Editando:/.test(editor),
  "siempre visible"
);
comprobar(
  "y cual vende, cuando no coinciden",
  /· vende \{MODALIDAD_LABEL\[runtimeModality\(cfg\)\]\}/.test(editor),
  "en gris, sin gritar"
);
// El aviso que SI importa no es un cartel: es el cerrojo, y llega en el momento
// en que puede haber daño — al guardar.
comprobar(
  "y el aviso de verdad llega al guardar",
  /CUIDADO: esto iba a cambiar lo que el bot ESTÁ VENDIENDO/.test(editor),
  "cuando puede haber daño"
);

console.log(
  `\n${fallos === 0 ? "TODO OK — se ve lo de la modalidad que editas, sin carteles" : `${fallos} FALLOS`}`
);
process.exit(fallos === 0 ? 0 : 1);
