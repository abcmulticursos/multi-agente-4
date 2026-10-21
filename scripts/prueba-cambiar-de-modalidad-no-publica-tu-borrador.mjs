// Cambiar la modalidad que VENDE el bot no publica lo que tengas a medias.
//
// LO QUE PASABA
//
//   Al pulsar «bot activo» salia un aviso que decia «se GUARDA lo que tienes en
//   pantalla». Y era cierto: guardaba la pantalla ENTERA.
//
//   Eso soldaba dos intenciones distintas. Una es cambiar lo que vende el bot.
//   La otra es publicar lo que estabas escribiendo. Quien solo queria la
//   primera publicaba la segunda sin haberlo pedido, y si estaba a medias, a
//   medias llegaba a los clientes.
//
// COMO QUEDA
//
//   Con algo sin guardar no se cambia nada: se avisa y la pantalla se queda
//   intacta. Es la misma regla que el editor ya usaba para crear una copia de
//   producto.
//
//   Sin nada sin guardar no sale ningun aviso.
//
// POR QUE ESTO ES LO QUE HACE INOFENSIVO EL GUARDADO
//
//   El cambio de modalidad vive en memoria y la recarga la borra, asi que hay
//   que escribirlo. Ese guardado sigue estando. Lo que cambia es que para
//   llegar a el la pantalla tiene que ser IDENTICA al archivo, y entonces lo
//   unico nuevo que puede escribir es el interruptor.
//
// LO QUE NO SE TOCO, Y HAY QUE VIGILAR QUE SIGA
//
//   Las cuatro protecciones contra la fuga de contenido entre modalidades.
//   Costaron mucho y no pueden volver a caerse por un arreglo de al lado.
//
//   node scripts/prueba-cambiar-de-modalidad-no-publica-tu-borrador.mjs
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

const activar = (() => {
  const i = editor.indexOf("const activateRuntimeModalidad = (newMode: Modo): void => {");
  const f = editor.indexOf("const selectModalidad = (newMod: Modo): void => {", i);
  return i < 0 || f < 0 ? "" : editor.slice(i, f);
})();
comprobar("se encuentra el activador", activar.length > 0, "activateRuntimeModalidad");

// -- 1. CON ALGO SIN GUARDAR, NO SE CAMBIA -----------------------------------
comprobar(
  "con cambios sin guardar, avisa y no cambia",
  /if \(isDirty\) \{[\s\S]{0,220}?msg: "Guarda tu contenido antes de cambiar de modalidad\.",[\s\S]{0,80}?return;/.test(
    activar
  ),
  "la pantalla se queda intacta"
);
// Va ANTES de tocar nada. Comprobarlo despues de `setCfg` no serviria: para
// entonces el cambio ya esta hecho en memoria.
comprobar(
  "y lo comprueba ANTES de tocar nada",
  activar.indexOf("if (isDirty)") < activar.indexOf("snapshot()") &&
    activar.indexOf("if (isDirty)") < activar.indexOf("setCfg("),
  "primero mira, luego actua"
);

// -- 2. SE FUE EL LETRERO --------------------------------------------------
comprobar(
  "ya no dice que va a guardar tu pantalla",
  !/Se GUARDA lo que tienes en pantalla/.test(editor),
  "sin letrero"
);
comprobar(
  "y no queda ninguna confirmacion al activar",
  !/window\.confirm/.test(activar),
  "sin preguntas"
);

// -- 3. EL SELECTOR DE EDICION VA DELANTE ------------------------------------
comprobar(
  "el selector de edicion se apunta primero",
  activar.indexOf("rememberEditorModality(newMode)") > 0 &&
    activar.indexOf("rememberEditorModality(newMode)") < activar.indexOf("setCfg("),
  "antes de aplicar el cambio"
);
// Si el guardado no llega a completarse —el operador puede pararlo desde el
// candado— el selector tiene que volver a donde estaba. Si no, el editor
// quedaria apuntando a una modalidad que el bot no llego a activar.
comprobar(
  "y se deshace si el guardado no se completa",
  /if \(!guardado\) \{[\s\S]{0,320}?rememberEditorModality\(activeModality\(cfg\)\);/.test(
    editor
  ),
  "no queda a medias"
);

// -- 4. LAS CUATRO PROTECCIONES SIGUEN EN PIE --------------------------------
//
// Es lo que mas caro costo. Ninguna puede caerse por un arreglo de al lado.
comprobar(
  "cambiar de modalidad sigue RECARGANDO, no repintando",
  /const selectModalidad = \(newMod: Modo\): void => \{[\s\S]{0,900}?window\.location\.reload\(\)/.test(
    editor
  ),
  "no hay nada anterior con lo que mezclar"
);
comprobar(
  "una plantilla no se reemplaza por vacio",
  /\[editingMode\]: noPisarConVacio\(/.test(activar),
  "noPisarConVacio"
);
comprobar(
  "el candado de lo que el bot vende sigue en el guardado",
  /iba a cambiar lo que el bot ESTÁ VENDIENDO/.test(editor),
  "sigue parando"
);
comprobar(
  "activar solo mueve el interruptor, no rehace la pantalla",
  !/applyTemplate\(/.test(activar),
  "sin recalcular la pantalla"
);

console.log(fallos === 0 ? "\nTODO OK" : `\n${fallos} FALLO(S)`);
process.exit(fallos === 0 ? 0 : 1);
