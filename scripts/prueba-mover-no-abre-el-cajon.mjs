// Mover un cajon no lo abre ni lo cierra: se lleva su estado tal cual.
//
// LO QUE PASABA
//
//   Canales → WhatsApp → Intro. Con un cajon PLEGADO, tocar subir o bajar lo
//   desplegaba entero. Uno esta ordenando una lista de catorce y en cada toque
//   se le abre uno por delante, asi que hay que cerrarlo a mano para seguir
//   viendo la lista.
//
//   El estado se escribia a pelo: «0» en el sitio del que sale y «1» en el
//   sitio al que llega. O sea ABIERTO, viniera de donde viniera.
//
// DE DONDE SALIA ESE «1»
//
//   De un arreglo anterior y bueno: al mover, el estado se guarda por POSICION,
//   asi que el cajon que estabas editando bajaba de sitio y el que seguia
//   abierto era el de la posicion de antes, con otro contenido dentro. Se
//   forzaba abierto el destino para «seguir» al cajon movido.
//
//   Eso acierta cuando el cajon iba abierto, que es el caso de quien esta
//   editando. Y se equivoca siempre en el otro: el de quien tiene la lista
//   plegada y solo esta ordenando.
//
// Y LOS DE EN MEDIO
//
//   Mover no es intercambiar: el cajon se saca y se mete en otro sitio, y todos
//   los que hay entre medias corren un puesto. Se apuntaban solo los DOS
//   extremos, asi que el estado de los de en medio se quedaba en la posicion
//   vieja, ya con otro cajon dentro. Con dos posiciones de distancia se nota.
//
// COMO QUEDA
//
//   Se leen TODOS los estados, se mueven exactamente igual que se movio el
//   cajon, y se vuelven a escribir. Cada uno llega a su sitio nuevo como estaba:
//   el abierto sigue abierto —que era lo que se queria— y el cerrado sigue
//   cerrado.
//
//   node scripts/prueba-mover-no-abre-el-cajon.mjs
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

const mover = (() => {
  const i = editor.indexOf("function keepMovedCollapsibleOpen(");
  const f = editor.indexOf("function abrirCajonDuplicado(", i);
  return i < 0 || f < 0 ? "" : editor.slice(i, f);
})();
comprobar("se encuentra el que mueve", mover.length > 0, "keepMovedCollapsibleOpen");

// -- 1. NO SE FUERZA NINGUN ESTADO -------------------------------------------
//
// ESTA ES LA LINEA. Un «1» escrito a pelo aqui es exactamente el error.
comprobar(
  "no escribe «abierto» a pelo",
  !/setItem\(`wf:collapsible:\$\{keyPrefix\}_\$\{to\}`, "1"\)/.test(mover),
  "ni «cerrado» tampoco"
);
comprobar(
  "el cajón se lleva el estado que tenía",
  /const movidos = moveItem\(estados, from, to\);/.test(mover),
  "abierto sigue abierto"
);

// -- 2. TODOS, NO SOLO LOS DOS EXTREMOS --------------------------------------
comprobar(
  "recorre la lista entera",
  /for \(let i = 0; i < total; i \+= 1\)/.test(mover) &&
    /total: number/.test(mover),
  "los de en medio también"
);
// SIN ESTADO GUARDADO SE BORRA LA LLAVE, no se escribe «0»: un cajon sin llave
// usa su valor por defecto, y escribir «0» le quitaria el suyo — los que nacen
// abiertos nacerian cerrados en cuanto alguien moviera uno.
comprobar(
  "y sin estado guardado borra la llave",
  /if \(valor === null \|\| valor === undefined\) localStorage\.removeItem\(llave\);/.test(
    mover
  ),
  "no inventa un «cerrado»"
);

// -- 3. LOS CUATRO SITIOS QUE MUEVEN PASAN EL TOTAL --------------------------
//
// Subir/bajar y arrastrar, en intro y en seguimientos. Sin el total, la funcion
// no sabe hasta donde llegar y deja fuera la mitad de la lista.
for (const [nombre, llamada] of [
  ["intro: subir y bajar", "`channel_${channel}_own_intro`, index, target, groups.length"],
  ["intro: arrastrar", "`channel_${channel}_own_intro`, from, index, groups.length"],
  [
    "seguimientos: subir y bajar",
    "`channel_${channel}_own_followup`, index, target, followups.length",
  ],
  [
    "seguimientos: arrastrar",
    "`channel_${channel}_own_followup`, from, index, followups.length",
  ],
]) {
  comprobar(
    nombre,
    editor.includes(`keepMovedCollapsibleOpen(${llamada})`),
    "pasa el total"
  );
}

// -- 4. EL DE LAS ENTREGAS, IGUAL --------------------------------------------
//
// Mismo error, otra funcion: la de los cajones cuya llave no es solo la
// posicion. Se arregla a la vez o el dia que alguien mueva una entrega plegada
// se le abre igual.
const exacto = (() => {
  const i = editor.indexOf("function keepMovedCollapsibleOpenExact(");
  const f = editor.indexOf("\n}", i);
  return i < 0 ? "" : editor.slice(i, f);
})();
comprobar(
  "el de las entregas tampoco fuerza abierto",
  exacto.length > 0 && !/setItem\(`wf:collapsible:\$\{newKey\}`, "1"\)/.test(exacto),
  "se lleva el suyo"
);

// -- 5. DUPLICAR SI ABRE, Y ESTA BIEN ----------------------------------------
//
// No es lo mismo. Al duplicar acabas de crear un cajon y quieres caer dentro;
// si no se abriera, el boton no pareceria haber hecho nada.
comprobar(
  "duplicar sigue abriendo la copia",
  /localStorage\.setItem\(`wf:collapsible:\$\{keyPrefix\}_\$\{nuevoIndice\}`, "1"\)/.test(
    editor
  ),
  "eso sí se quiere"
);

console.log(
  fallos === 0 ? "\nTODO OK — mover ordena, no abre" : `\n${fallos} FALLO(S)`
);
process.exit(fallos === 0 ? 0 : 1);
