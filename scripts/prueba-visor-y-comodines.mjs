// Tres fallos del visor de comodines, pedidos juntos.
//
// ── 1. «PRECIO_MERCADO8.000 ARS» ────────────────────────────────────────────
//
// El comodin {{PRECIO_MERCADO}} salia en el visor como «PRECIO_MERCADO8.000
// ARS»: faltaba un digito y aparecia el nombre del comodin.
//
// En un reemplazo de texto, «$1» significa «lo que capturo el grupo 1». El
// precio argentino se escribe «$18.000 ARS», o sea «$1» + «8.000 ARS»: el «$1»
// se cambiaba por el nombre del comodin encontrado y el «1» del precio
// desaparecia.
//
// Es el MISMO fallo que ya se arreglo en el motor. El visor tiene su propia
// copia de los reemplazos y se quedo sin arreglar, asi que en vivo salia bien y
// en la pantalla salia roto. Se barrio el archivo entero: 46 sitios.
//
// Solo se veia en Doble Oferta + Upsell porque es la unica capa donde Argentina
// tiene precio de mercado; en la raiz vale 0 y el comodin no llega a pintar.
//
// ── 2. El resaltado pintaba texto escrito a mano ────────────────────────────
//
// Al «ver comodines» se pintaba buscando el VALOR dentro del texto ya resuelto.
// Con el precio en 7.000, un «7.000» tecleado a mano se pintaba igual: parecia
// un comodin y no lo era. Bajando el precio a 6.999 dejaba de pintarse, y ahi
// se veia que el resaltado mentia.
//
// Ahora se marca donde ESTABA cada comodin antes de resolverlo.
//
// ── 3. El desplegable tapaba lo que se escribia ─────────────────────────────
//
// El menu se coloca debajo del renglon del cursor, y ese renglon se mide con un
// clon invisible del campo. El clon copiaba el `width` del CSS, que incluye
// bordes y el hueco de la barra de desplazamiento: salia mas ancho que el texto
// real, cabian mas palabras por renglon, contaba menos renglones y el menu
// aparecia por encima del cursor. Solo en cajones largos, que son los que
// tienen barra.
//
//   node scripts/prueba-visor-y-comodines.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");

const editor = leer("src", "app", "editor", "page.tsx");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 60)} ${valor}`);
};

// ── 1. Ningún reemplazo del visor puede leer un "$" como grupo ──────────────
//
// Se recorre el archivo entero contando paréntesis: cualquier .replace() cuyo
// segundo argumento NO sea una función ni un texto sin "$" es un sitio donde el
// fallo puede volver.
const sospechosos = [];
{
  const marca = ".replace(";
  let i = 0;
  while ((i = editor.indexOf(marca, i)) !== -1) {
    let j = i + marca.length;
    let prof = 1;
    const comas = [];
    let comilla = null;
    while (j < editor.length && prof > 0) {
      const c = editor[j];
      if (comilla) {
        if (c === "\\") j++;
        else if (c === comilla) comilla = null;
      } else if (c === '"' || c === "'" || c === "`") comilla = c;
      else if (c === "(" || c === "[" || c === "{") prof++;
      else if (c === ")" || c === "]" || c === "}") prof--;
      else if (c === "," && prof === 1) comas.push(j);
      j++;
    }
    if (comas.length >= 1) {
      const arg = editor.slice(comas[comas.length - 1] + 1, j - 1).trim();
      const esFuncion = /^\(|^function\b|=>/.test(arg);
      const esTextoSeguro =
        /^(["'`])(?:(?!\1)[^\\$])*\1$/.test(arg) && !arg.includes("$");
      const usaLiteral = /^literal\(/.test(arg);
      if (!esFuncion && !esTextoSeguro && !usaLiteral) {
        sospechosos.push(editor.slice(0, i).split("\n").length);
      }
    }
    i = j;
  }
}
comprobar(
  "ningún reemplazo del editor puede comerse un dígito",
  sospechosos.length === 0,
  sospechosos.length === 0 ? "0 sitios" : `líneas ${sospechosos.join(", ")}`
);
comprobar(
  "el precio de mercado se entrega como texto literal",
  /previous_price\)\\s\*\\\}\\\}\/gi, literal\(/.test(editor),
  "literal()"
);
comprobar(
  "y se dice por qué, donde se importa",
  /En un reemplazo de texto, "\$1" significa/.test(editor),
  "explicado"
);

// ── 2. El resaltado, por posición y no por valor ────────────────────────────
comprobar(
  // Si esto volviera, un precio escrito a mano se volveria a pintar como si
  // fuese un comodin.
  "ya no se resalta buscando el valor en el texto",
  !/function previewPlaceholderValues\(/.test(editor),
  "quitado"
);
comprobar(
  "se marca dónde estaba cada comodín",
  /const marcado = rawText\.replace\(PATRON_DE_COMODIN, \(token\) => \{/.test(
    editor
  ),
  "en su sitio"
);
comprobar(
  // Caracteres de control: nadie los puede teclear, asi que ninguna marca puede
  // salir del texto del usuario.
  "con marcas que nadie puede escribir",
  /const MARCA_ABRE = String\.fromCharCode\(1\);/.test(editor) &&
    /const MARCA_CIERRA = String\.fromCharCode\(2\);/.test(editor),
  "de control"
);
comprobar(
  // Con el texto ya resuelto no se sabe cual cifra vino de un comodin.
  "el resaltador recibe el texto CRUDO",
  /renderPreviewTextWithHighlights\(\s*\r?\n\s*\/\/[\s\S]{0,200}?rawCaption,/.test(
    editor
  ),
  "sin resolver"
);
comprobar(
  "y el valor pasa por el spintax antes de entrar",
  /valores\.push\(\s*\r?\n\s*resolvePreviewSpintax\(/.test(editor),
  "sí"
);
comprobar(
  "sin comodines el texto se pinta entero, sin trocear",
  /if \(valores\.length === 0\) return renderWa\(resuelto\);/.test(editor),
  "intacto"
);

// ── 3. El desplegable, debajo del renglón de verdad ─────────────────────────
comprobar(
  // ESTE era el fallo: el width del CSS incluye bordes y barra.
  "el clon ya no copia el ancho del CSS",
  !/for \(const prop of \[\s*\r?\n\s*"boxSizing",\s*\r?\n\s*"width",/.test(editor),
  "lo mide"
);
comprobar(
  "lo mide por dentro, sin bordes ni barra",
  /clon\.style\.width = `\$\{Math\.max\(0, campo\.clientWidth - relleno\)\}px`;/.test(
    editor
  ),
  "clientWidth"
);
comprobar(
  "y descuenta los rellenos",
  /clon\.style\.boxSizing = "content-box";/.test(editor),
  "content-box"
);
comprobar(
  // La regla que no se puede romper: nunca por encima de lo que se escribe.
  "el menú sigue yendo SIEMPRE debajo del renglón",
  /SIEMPRE debajo del renglón, nunca encima/.test(editor) &&
    /const y = baseRenglon \+ 14;/.test(editor),
  "debajo"
);

console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} comprobación(es) mal.`);
process.exit(fallos === 0 ? 0 : 1);
