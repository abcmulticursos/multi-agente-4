// Una burbuja tiene UN campo de texto, y siempre esta a la vista.
//
// DOS FALLOS QUE ERAN EL MISMO
//
//   1. UNA BURBUJA PODIA NO TENER NINGUN CAMPO. Si su lista de textos estaba
//      vacia no se dibujaba ninguna casilla: se entraba al cajon y lo unico que
//      habia era un enlace «+ agregar variante de texto». Quien no lo pulsara
//      creia que esa burbuja no se podia escribir.
//
//   2. LAS VARIANTES SOBRABAN. Existian para que el bot eligiera una al azar
//      entre varias cajas. Eso lo hace el spintax dentro del propio texto
//      —{Hola|Buenas}— sin partir el mensaje ni mantener una lista.
//
// COMO QUEDA
//
//   Un campo, siempre dibujado. De las variantes ya escritas se conserva LA
//   PRIMERA; el resto desaparece al guardar. Se pidio asi.
//
// LO QUE HAY QUE CUIDAR
//
//   Escribir en una burbuja SIN campos tiene que crear el primero. Si el
//   guardado recorriera una lista vacia, se teclearia y no se guardaria nada:
//   el peor fallo posible en un editor, porque no da error.
//
//   Y el recorte NO se hace al leer. Leyendo lo que hay, el editor no se
//   declara «con cambios sin guardar» nada mas abrir; el recorte ocurre cuando
//   el operador guarda de verdad.
//
//   node scripts/prueba-una-burbuja-un-texto.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");
const editor = leer("src", "app", "editor", "page.tsx");
const ruta = leer("src", "app", "api", "workflow", "route.ts");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

const burbuja = (() => {
  const i = editor.indexOf("function StepCard({");
  const f = editor.indexOf("function compactSteps(", i);
  return i < 0 || f < 0 ? "" : editor.slice(i, f);
})();
comprobar("se encuentra la burbuja", burbuja.length > 0, "StepCard");

// -- 1. SIEMPRE HAY UN CAMPO -------------------------------------------------
comprobar(
  "el campo se dibuja siempre",
  /value=\{step\.texts\[0\] \?\? ""\}/.test(burbuja),
  "aunque la lista este vacia"
);
comprobar(
  "y ya no se recorre la lista para dibujarlos",
  !/step\.texts\.map\(\(t, ti\) =>/.test(burbuja),
  "uno, no varios"
);

// -- 2. SE VAN LAS VARIANTES -------------------------------------------------
comprobar(
  "no queda el boton de agregar variante",
  !/\+ agregar variante de texto/.test(editor),
  "se fue"
);
comprobar(
  "ni el de duplicar o quitar variante",
  !/title="Duplicar variante"/.test(burbuja) &&
    !/title="Quitar variante"/.test(burbuja),
  "sin botones sueltos"
);
// EL ROTULO TAMBIEN SE VA.
//
// Decia «Texto — variantes» y, al lado, «el bot elige una al azar». Las dos
// frases hablaban de las cajas que ya no existen. Un rotulo que nombra algo que
// no esta es peor que no tener rotulo: manda a buscar una lista que no aparece.
comprobar(
  "el rotulo ya no nombra las variantes",
  !/\{isMedia \? "Texto al pie \(caption\)" : "Texto"\} — variantes/.test(
    burbuja
  ) && !/el bot elige una al azar/.test(burbuja),
  "no manda a buscar lo que no hay"
);
comprobar(
  "y en su sitio nombra lo que SI varia",
  /¿Varias formas de decirlo\? \{Hola\|Buenas\}/.test(burbuja),
  "el spintax"
);

// -- 3. ESCRIBIR EN UNA VACIA CREA EL PRIMERO --------------------------------
//
// Es la parte que no puede fallar: sin esto se teclea y no se guarda nada, y no
// hay ningun aviso de que se esta perdiendo.
comprobar(
  "escribir en una burbuja sin campos crea el texto",
  /texts: s\.texts\.length\s*\r?\n?\s*\? s\.texts\.map\(\(t, k\) => \(k === ti \? v : t\)\)\s*\r?\n?\s*: \[v\],/.test(
    editor
  ),
  "no se pierde lo tecleado"
);

// -- 4. AL GUARDAR SE QUEDA LA PRIMERA ---------------------------------------
comprobar(
  "al guardar se escribe solo el primer texto",
  /\.map\(\(t\) => t\.replace\(\/\\r\\n\/g, "\\n"\)\)\s*\r?\n\s*\.slice\(0, 1\);/.test(
    ruta
  ),
  "una burbuja, un texto"
);
// Y NO al leer: recortando al leer, el editor se declararia «con cambios sin
// guardar» nada mas abrir, y el boton de guardar pediria atencion sin que nadie
// hubiera tocado nada.
comprobar(
  "y NO se recorta al leer",
  !/strList\(s\.body_variants\)[\s\S]{0,80}?slice\(0, 1\)/.test(ruta),
  "abrir no ensucia el borrador"
);

// -- 5. EL SPINTAX SIGUE SIENDO EL QUE VARIA ---------------------------------
//
// Es lo que sustituye a las variantes. Si dejara de reconocerse, se habrian
// quitado las cajas sin dejar nada en su sitio.
comprobar(
  "el visor sigue ofreciendo variar con spintax",
  /rawCaption\.includes\("\|"\)/.test(editor),
  "{Hola|Buenas}"
);

console.log(fallos === 0 ? "\nTODO OK" : `\n${fallos} FALLO(S)`);
process.exit(fallos === 0 ? 0 : 1);
