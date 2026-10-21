// El buscador del desplegable de cuentas.
//
// Se le metia solo una contrasena guardada del navegador. Pasa porque en esa
// misma pantalla hay campos de clave (App Secret, tokens): el navegador ve uno
// de contrasena y trata a los de texto de al lado como si fueran el usuario.
// La lista se filtraba a cero y parecia que el desplegable se cerrara solo.
//
// Se intento por las buenas —type=search, autocomplete=off, un nombre distinto
// cada vez, descartar lo que no se teclea— y el texto dejo de entrar, pero el
// cuadro de "contrasenas guardadas" seguia apareciendo encima y tapando la
// lista. El problema no era como se marcaba el campo: era SER un campo de
// formulario.
//
// Por eso ahora es un div editable. Los navegadores no autorrellenan contenido
// editable ni le ofrecen nada.
//
// Lo que se fija aqui:
//
//  1. Que el buscador NO vuelva a ser un <input>. Es lo unico que de verdad
//     evita las dos cosas a la vez, el relleno y el cuadro.
//  2. Que se pueda escribir: el contenido lo lleva el DOM y aqui solo se LEE.
//     Fijarlo desde React en cada pulsacion mandaria el cursor al principio.
//  3. Que siga enfocandose solo al abrir, que es lo que hacia autoFocus.
//
//   node scripts/prueba-buscador-del-selector.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const pagina = readFileSync(
  join(RAIZ, "src", "app", "meta-connect", "page.tsx"),
  "utf8"
);

// Solo el componente del selector, no la pantalla entera: en la pantalla hay
// muchos <input> legitimos y no tienen nada que ver con esto.
const desde = pagina.indexOf("function SelectorDeCuenta");
// HASTA DONDE ACABA ESTE COMPONENTE, no hasta el final del archivo.
//
// Cortaba en «export default function», asi que se tragaba TODO lo que hubiera
// entre medias. El dia que se metio otro componente ahi —uno con sus propios
// campos— la comprobacion de «aqui no hay ningun <input>» se puso roja por un
// input que no es de este selector.
const siguiente = pagina.indexOf("\nfunction ", desde + 1);
const hasta =
  siguiente > 0 ? siguiente : pagina.indexOf("export default function");
const selector = pagina.slice(desde, hasta);

// Sin los comentarios: uno de ellos EXPLICA que ya no es un <input>, y sin
// quitarlos la comprobacion de abajo se encontraria a si misma.
const soloCodigo = selector
  .split(/\r?\n/)
  .filter((linea) => !/^\s*(\/\/|\*|\/\*)/.test(linea))
  .join("\n");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

comprobar(
  "el buscador NO es un campo de formulario",
  !/<input/.test(soloCodigo),
  "div editable"
);
comprobar(
  "es un div editable",
  /contentEditable/.test(selector) && /role="searchbox"/.test(selector),
  "sí"
);
comprobar(
  "lo escrito se LEE del DOM, no se le impone",
  /onInput=\{\(event\) =>[\s\S]{0,80}?event\.currentTarget\.textContent/.test(
    selector
  ),
  "se lee"
);
comprobar(
  "se enfoca solo al abrir",
  /if \(abierto\) cajaDeBusqueda\.current\?\.focus\(\)/.test(selector),
  "sí"
);
comprobar(
  "tiene marcador de texto propio",
  /Buscar por nombre o número/.test(selector),
  "sí"
);
comprobar(
  "al abrir o cerrar se limpia lo buscado",
  /const alternar = \(\) => \{\s*setBusqueda\(""\);/.test(selector),
  "sí"
);

console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} comprobación(es) mal.`);
process.exit(fallos === 0 ? 0 : 1);
