// Un campo del editor y un comodin son la misma cosa vista desde dos lados: lo
// que escribes aqui es lo que sale alli. Pero en la pantalla no se notaba.
//
// Habia que acordarse de memoria de que casilla alimentaba a cual, asi que se
// terminaba escribiendo el dato a mano dentro de la burbuja -- y ese numero se
// queda viejo el dia que cambia el precio, sin avisar a nadie.
//
// Ahora el campo lleva su nombre encima, en una chapita que se copia con un
// clic, y el campo se ve distinto (borde de color) para que se note de un
// vistazo que eso alimenta un comodin.
//
// Y SI ESTA VACIO LO DICE EN ROJO. Un comodin sin dato no rompe nada: sale en
// blanco. La frase le llega al cliente a medias y nadie se entera. Ese aviso es
// justo lo que faltaba en las dos ranuras de opcion de Doble Oferta + Upsell.
//
//   node scripts/prueba-chapa-de-comodin.mjs
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

// ── 1. El componente existe y hace las tres cosas ──────────────────────────
comprobar(
  "hay un componente unico para la chapita",
  /function ChapaDeComodin\(\{/.test(editor),
  "ChapaDeComodin"
);
comprobar(
  "se copia con un clic",
  /navigator\.clipboard\?\.writeText\(comodin\)/.test(editor),
  "al portapapeles"
);
comprobar(
  // ESTO es lo que evita el comodin que sale en blanco sin que nadie lo note.
  "avisa en rojo cuando el campo esta vacio",
  /sin llenar: sale en blanco/.test(editor) &&
    /text-red-600/.test(editor),
  "aviso visible"
);
comprobar(
  "y el campo se ve distinto",
  /border-l-4 border-l-emerald-400/.test(editor),
  "resaltado"
);

// ── 2. Puesta en los campos que alimentan un comodin ───────────────────────
const PUESTA = [
  // Los nombres cambiaron cuando la lista se limpio: un comodin por precio,
  // todos con su moneda. La chapita de cada cajon tiene que decir el vigente,
  // que es de lo que se olvido la vez que esto se rompio.
  ["el precio anterior del full", '{{PRECIO_ANTES_FULL}}'],
  ["el precio anterior del upsell", '{{PRECIO_ANTES_UPSELL}}'],
  ["el precio del full", '{{PRECIO_FULL}}'],
  ["el precio del upsell", '{{PRECIO_UPSELL}}'],
  ["el nombre del receptor", '{{NOMBRE_RECEPTOR}}'],
  // La chapita pasa a decir el comodin EMPATADO —el que se escribe igual en
  // Order Bump y en Doble Oferta + Upsell—. {{OPCION_1}} sigue funcionando y da
  // el mismo campo; lo que cambia es cual se ensena, para no tener que traducir
  // el nombre al pasar de una modalidad a otra.
  ["el nombre del producto full", '{{PRODUCTO_FULL}}'],
  ["el nombre del tercer producto", '{{PRODUCTO_UPSELL}}'],
];
for (const [texto, comodin] of PUESTA) {
  comprobar(
    `${texto} lleva su chapita`,
    new RegExp(`comodin=(\\{)?"${comodin.replace(/[{}]/g, "\\$&")}"`).test(editor),
    comodin
  );
}
comprobar(
  "y los comodines propios llevan el suyo",
  /comodin=\{`\{\{\$\{normalized\}\}\}`\}/.test(editor),
  "el que tu creaste"
);

// ── 3. Lo que NO cambia ────────────────────────────────────────────────────
comprobar(
  // La chapita es un anadido: sin ella el campo se ve como siempre.
  "un campo sin comodin sigue igual que antes",
  /comodin\?: string;/.test(editor) &&
    /comodin\s*\r?\n?\s*\? `\$\{className \?\? ""\} border-l-4/.test(editor),
  "solo cambia si lo lleva"
);
comprobar(
  "el nombre del producto conserva su aviso de siempre",
  /Nombre del producto \(comod/.test(editor),
  "intacto"
);

// ── 4. Los que dependen de la modalidad y los datos de pago ────────────────
comprobar(
  // Va en un condicional igual que el precio: en Lineal es el «antes» a secas
  // y donde hay dos opciones es el del base.
  "el precio anterior del base dice el suyo segun la modalidad",
  /\? "\{\{PRECIO_MERCADO\}\}"\s*\r?\n?\s*: "\{\{PRECIO_ANTES_BASE\}\}"/.test(
    editor
  ),
  "PRECIO_MERCADO o PRECIO_ANTES_BASE"
);
comprobar(
  // En las modalidades de dos opciones este campo ES el precio del básico.
  "el precio base dice el comodín que le toca segun la modalidad",
  /layerMode === "lineal" \|\| layerMode === "upsell"\s*\r?\n?\s*\? "\{\{PRECIO_COMPLETO\}\}"\s*\r?\n?\s*: "\{\{PRECIO_BASE\}\}"/.test(
    editor
  ),
  "PRECIO_COMPLETO o PRECIO_BASE"
);
comprobar(
  "los cuatro datos de pago llevan la suya",
  /<ChapaDeComodin comodin=\{comodin\} vacio=\{!val\.trim\(\)\} \/>/.test(editor),
  "principal y 1, 2, 3"
);
comprobar(
  // Funcionaba desde siempre pero no salia en la lista: existia y era
  // invisible.
  "{{ENLACE_ANUNCIO}} ya se ofrece en el selector",
  /token: "\{\{ENLACE_ANUNCIO\}\}"/.test(editor),
  "visible"
);

console.log(
  fallos === 0
    ? "\nTODO OK — cada campo dice a que comodin alimenta"
    : `\n${fallos} FALLA(S)`
);
process.exit(fallos === 0 ? 0 : 1);
