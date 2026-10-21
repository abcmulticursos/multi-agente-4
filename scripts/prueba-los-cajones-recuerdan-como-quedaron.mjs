// Un cajon se queda como lo dejaste.
//
// COMO FUNCIONA
//
//   Cada cajon guarda «abierto» o «cerrado» en el navegador, bajo una LLAVE.
//   Si no se le da una llave propia (`titleKey`), se usa su ROTULO.
//
// LOS DOS FALLOS QUE ESO PRODUCE
//
//   1. ROTULO QUE NO ES TEXTO. Un rotulo hecho de etiquetas —no una cadena—
//      se convierte en la misma llave para TODOS: "[object Object]". Entonces
//      los cajones se abren y se cierran juntos, y el ultimo en dibujarse pisa
//      lo que habia guardado el otro. No da error: parece que el cajon se abre
//      solo.
//
//   2. ROTULO QUE CAMBIA. El cajon del producto se llama «FULL» en una
//      modalidad y «Producto 1» en otra. Con el rotulo de llave, cambiar de
//      modalidad estrena llave y el cajon se olvida de que estaba cerrado.
//
// LA REGLA
//
//   Si el rotulo no es una cadena escrita a mano ahi mismo, el cajon lleva
//   `titleKey`. Un rotulo se reescribe cuando se quiere; una llave, nunca.
//
//   node scripts/prueba-los-cajones-recuerdan-como-quedaron.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const editor = readFileSync(join(RAIZ, "src", "app", "editor", "page.tsx"), "utf8");
const lineas = editor.split(/\r?\n/);

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// -- 1. EL CAJON GUARDA LAS DOS COSAS ----------------------------------------
//
// Un cajon que solo anotara cuando se ABRE no se podria cerrar nunca: se
// cierra, se vuelve, y sigue abierto porque lo unico guardado era el "1".
const cajon = (() => {
  const i = editor.indexOf("function Collapsible(");
  const f = editor.indexOf("function ChapaDeComodin(", i);
  return i < 0 ? "" : editor.slice(i, f > i ? f : i + 9000);
})();
comprobar("se encuentra el cajon", cajon.length > 0, "Collapsible");
// La anotacion pasa por `apuntar`, que escribe el "1" o el "0" y calla cuando el
// cajon manda su contenido a una ventana: una ventana no se recuerda, o se
// entraria a la pestaña con una ventana encima que nadie acaba de abrir.
comprobar(
  "al abrirlo y al cerrarlo se anota",
  /apuntar\(next \? "1" : "0"\)/.test(cajon) &&
    /localStorage\.setItem\(storageKey, valor\)/.test(cajon),
  "las dos, no solo abrir"
);
comprobar(
  "y en ventana no se anota nada",
  /const recuerda = !enVentana;/.test(cajon) &&
    /if \(!recuerda\) return;/.test(cajon),
  "no reaparece sola"
);
comprobar(
  "y al volver se lee lo guardado",
  /const saved = localStorage\.getItem\(storageKey\);\s*\r?\n\s*if \(saved !== null\) setOpen\(saved === "1"\);/.test(
    cajon
  ),
  "manda lo guardado, no el defecto"
);

// -- 1 quater. MOVER UN CAJON NO TE DEJA EN OTRO -----------------------------
//
// El abierto o cerrado se guarda por POSICION. Al mover se apuntaban bien las
// nuevas posiciones, pero los cajones YA DIBUJADOS no volvian a leerlas: cada
// uno se quedaba con lo que tenia en memoria, porque su llave no habia
// cambiado.
//
// Asi que el que estabas editando bajaba de sitio y el que seguia abierto era
// el de la posicion de antes, con otro contenido dentro. No te movias tu: se
// movia el contenido debajo de ti.
comprobar(
  "al mover se les pide releer",
  /function avisarQueRelean\(\): void \{[\s\S]{0,200}?new CustomEvent\("wf:releer-cajones"\)/.test(
    editor
  ),
  "wf:releer-cajones"
);
comprobar(
  "y el cajon vuelve a leer su llave",
  /window\.addEventListener\("wf:releer-cajones", leer\);/.test(cajon) &&
    /window\.removeEventListener\("wf:releer-cajones", leer\);/.test(cajon),
  "sin quedarse con lo de antes"
);
// Los TRES sitios que reordenan tienen que avisar. Con uno que se olvide, el
// fallo vuelve solo por ese camino y cuesta el doble encontrarlo.
comprobar(
  "avisan los tres sitios que reordenan",
  (editor.match(/avisarQueRelean\(\);/g) ?? []).length === 3,
  "mover, mover exacto e insertar"
);

// -- 1 bis. NADIE LO REABRE AL VOLVER ----------------------------------------
//
// AQUI ESTABA EL CAJON QUE SE ABRIA SOLO.
//
// El cajon acepta dos señales, «abrete» y «cierrate», para que al mover uno se
// quede abierto donde cayo. Los efectos miraban solo si la señal EXISTE, y
// quien la manda la deja puesta: se apunta al mover y no se borra nunca.
//
// Cambiar de pestaña y volver es un REMONTAJE —la pestaña entera se desmonta—,
// asi que la señal volvia a dispararse. Movias un cajon una vez y a partir de
// ahi ese cajon se abria solo cada vez que volvias. No hay error ni aviso:
// parece que el editor no recuerda nada.
comprobar(
  "una señal solo actua cuando es NUEVA",
  /const ultimaSenalDeAbrir = useRef\(openSignal\);/.test(cajon) &&
    /openSignal === undefined \|\| openSignal === ultimaSenalDeAbrir\.current/.test(
      cajon
    ),
  "al montar no se dispara"
);
comprobar(
  "y la de cerrar, igual",
  /const ultimaSenalDeCerrar = useRef\(closeSignal\);/.test(cajon) &&
    /closeSignal === ultimaSenalDeCerrar\.current/.test(cajon),
  "las dos, o la mitad del fallo se queda"
);
// Se apunta la señal ATENDIDA. Sin esto la comparacion nunca cambiaria y la
// señal dejaria de funcionar del todo, que es el error contrario.
comprobar(
  "la señal atendida se apunta",
  /ultimaSenalDeAbrir\.current = openSignal;/.test(cajon) &&
    /ultimaSenalDeCerrar\.current = closeSignal;/.test(cajon),
  "sigue funcionando al mover"
);

// -- 1 ter. EL DESPLEGABLE DE UNA BURBUJA TAMBIEN SE RECUERDA ----------------
//
// ERA EL «CAJON 8 QUE SEGUIA ABIERTO», Y NO ERA UN CAJON DE ESTOS.
//
// Cada burbuja tiene su propio abrir y cerrar, con su triangulito. Ese vivia
// SOLO en memoria. Al cambiar de pestaña la lista se desmonta, y al volver se
// calculaba de nuevo con la regla de siempre: «arranca cerrada si tiene texto».
//
// Asi que una burbuja SIN texto —una imagen, un audio, una recien creada—
// arrancaba abierta SIEMPRE. Se cerraba, se iba uno a otra pestaña, y al volver
// estaba abierta otra vez. No es que no recordara: es que no guardaba nada.
const burbuja = (() => {
  const i = editor.indexOf("function StepCard({");
  const f = editor.indexOf("function compactSteps(", i);
  return i < 0 || f < 0 ? "" : editor.slice(i, f);
})();
comprobar("se encuentra la burbuja", burbuja.length > 0, "StepCard");
comprobar(
  "su desplegable tiene llave propia",
  /const llaveDelDesplegable = `wf:collapsible:burbuja:\$\{draggableId\}`;/.test(
    burbuja
  ),
  "una por burbuja"
);
comprobar(
  "se lee lo guardado al volver",
  /const guardado = localStorage\.getItem\(llaveDelDesplegable\);\s*\r?\n\s*if \(guardado !== null\) setCollapsed\(guardado === "1"\);/.test(
    burbuja
  ),
  "manda lo guardado"
);
comprobar(
  "y se anota al abrir Y al cerrar",
  /localStorage\.setItem\(llaveDelDesplegable, siguiente \? "1" : "0"\)/.test(
    burbuja
  ),
  "las dos"
);
// Los DOS sitios que lo abren y lo cierran tienen que pasar por el mismo sitio:
// el triangulito y el texto resumido. Si uno se quedara con el setCollapsed a
// secas, ese no guardaria y el fallo volveria por la mitad.
comprobar(
  "los dos sitios que lo tocan lo guardan",
  (burbuja.match(/alternarDesplegable/g) ?? []).length === 3 &&
    !/setCollapsed\(\(c\) => !c\)/.test(burbuja) &&
    !/onClick=\{\(\) => setCollapsed\(false\)\}/.test(burbuja),
  "el triangulo y el resumen"
);

// -- 2. NINGUNA LLAVE SALE DE UN ROTULO QUE NO ES TEXTO ----------------------
const sospechosos = [];
for (let i = 0; i < lineas.length; i++) {
  if (!/<Collapsible\b/.test(lineas[i])) continue;
  let bloque = "";
  let prof = 0;
  let visto = false;
  for (let k = i; k < Math.min(i + 60, lineas.length); k++) {
    bloque += lineas[k] + "\n";
    for (const c of lineas[k]) {
      if (c === "{") prof++;
      else if (c === "}") prof--;
      else if (c === "<") visto = true;
    }
    if (visto && prof <= 0 && />\s*$/.test(lineas[k].trim())) break;
  }
  if (/titleKey=/.test(bloque)) continue;
  const m = /title=(\{[\s\S]*?\n|"[^"]*")/.exec(bloque);
  const valor = (m?.[1] ?? "").trim();
  if (!valor.startsWith('"')) {
    sospechosos.push(`${i + 1}: ${valor.replace(/\s+/g, " ").slice(0, 46)}`);
  }
}
comprobar(
  "todo rotulo que no es texto lleva su llave",
  sospechosos.length === 0,
  sospechosos.length === 0 ? "ninguno suelto" : sospechosos.join(" | ")
);

// -- 3. NINGUNA LLAVE REPETIDA -----------------------------------------------
//
// Dos cajones con la misma llave se abren y se cierran juntos aunque esten en
// pantallas distintas.
const llaves = new Map();
for (const patron of [
  /titleKey=\{(`[^`]*`)\}/g,
  /titleKey="([^"]*)"/g,
  /titleKey=\{("[^"]*")\}/g,
]) {
  for (const m of editor.matchAll(patron)) {
    const k = m[1].replace(/[`"]/g, "");
    const linea = editor.slice(0, m.index).split(/\r?\n/).length;
    if (!llaves.has(k)) llaves.set(k, []);
    llaves.get(k).push(linea);
  }
}
const repes = [...llaves.entries()].filter(([, ls]) => ls.length > 1);
comprobar(
  "ninguna llave esta repetida",
  repes.length === 0,
  repes.length === 0
    ? `${llaves.size} llaves distintas`
    : repes.map(([k, ls]) => `${k} (${ls.join(",")})`).join(" | ")
);

// -- 4. LOS QUE SE ARREGLARON ------------------------------------------------
//
// Se nombran uno a uno: si alguien les quita la llave, se pone roja aqui y no
// dentro de la regla general, que dice menos.
for (const [que, llave] of [
  ["las cajas del cerebro", "cerebro_\\$\\{key\\}"],
  ["las opciones de la oferta", "ob_option_\\$\\{idPrefix\\}"],
  ["el contenido del producto 1", "contenido_producto_1"],
  ["el contenido del producto 2", "contenido_producto_2"],
  ["el menu de pago del intro", "menu_pago_intro"],
  ["el menu de pago del seguimiento", "menu_pago_seguimiento_\\$\\{fi\\}"],
]) {
  comprobar(
    `${que} tienen llave propia`,
    new RegExp(`titleKey=\\{?["\`]?${llave}["\`]?\\}?`).test(editor),
    "estable"
  );
}

console.log(fallos === 0 ? "\nTODO OK" : `\n${fallos} FALLO(S)`);
process.exit(fallos === 0 ? 0 : 1);
