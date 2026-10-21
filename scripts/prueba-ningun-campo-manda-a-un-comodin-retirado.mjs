// El editor te mandaba a usar comodines que ya no estaban en la lista.
//
// Paso asi: se limpio la lista de comodines -- se dejaron los seis de precio y
// se retiraron los quince que hacian lo mismo con otro nombre -- pero las
// CHAPITAS de los cajones se quedaron escritas a mano con los nombres viejos.
//
// Resultado: en Precios y pagos, el cajon "Precio producto full" decia
// {{PRECIO_1}}, y ese comodin ya no aparecia al escribir {{. El editor pedia
// una herramienta que el mismo habia guardado.
//
// Y habia una segunda lista de 28 comodines escrita a mano dentro de la ayuda,
// que no leia nadie y que llevaba meses vieja. Una copia dormida de una lista
// es una trampa: el dia que alguien la lea, creera que dice la verdad.
//
// LA REGLA QUE VIGILA ESTA PRUEBA
//
// Ningun sitio de la interfaz puede nombrar un comodin retirado. Si se retira
// uno, hay que arreglar TAMBIEN lo que lo nombraba: la chapita del cajon, su
// aviso de debajo, los textos de ayuda y las vistas previas. Arreglar la pieza
// y dejar su contexto a medias deja las herramientas mochas.
//
//   node scripts/prueba-ningun-campo-manda-a-un-comodin-retirado.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const editor = readFileSync(join(RAIZ, "src", "app", "editor", "page.tsx"), "utf8");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 56)} ${valor}`);
};

// ── El catalogo: cuales se ofrecen y cuales se retiraron ───────────────────
const ofrecidos = new Set();
const retirados = new Set();
for (const m of editor.matchAll(
  /token:\s*"(\{\{[A-Z0-9_]+\}\})",(\s*\r?\n\s*oculto: true,)?/g
)) {
  (m[2] ? retirados : ofrecidos).add(m[1]);
}

comprobar(
  "hay comodines ofrecidos y retirados",
  ofrecidos.size > 10 && retirados.size > 5,
  `${ofrecidos.size} ofrecidos, ${retirados.size} retirados`
);

// ── Ningun sitio de la interfaz nombra uno retirado ────────────────────────
//
// Los comentarios del codigo no cuentan: no los ve nadie desde el editor, y a
// veces tienen que nombrar el comodin viejo justamente para explicar por que
// se retiro. Lo que no puede pasar es que lo diga una etiqueta, un aviso o un
// texto de ayuda.
const senalados = [];
editor.split(/\r?\n/).forEach((linea, i) => {
  if (/token:\s*"\{\{/.test(linea)) return; // el catalogo mismo
  if (/^\s*(\/\/|\*|\/\*)/.test(linea)) return; // comentarios
  // Las listas internas del filtro los nombran a proposito: son las que
  // deciden cual se esconde en cada modalidad. Una linea que solo tiene el
  // comodin entre comillas es un miembro de esas listas, no algo que se vea.
  if (/DE_UN_SOLO_PRODUCTO|NOMBRES_DE_ESTA_MODALIDAD/.test(linea)) return;
  if (/^\s*"\{\{[A-Z0-9_]+\}\}",?\s*$/.test(linea)) return;
  const encontrados = linea.match(/\{\{[A-Z0-9_]{3,}\}\}/g);
  if (!encontrados) return;
  for (const token of new Set(encontrados)) {
    if (retirados.has(token)) senalados.push(`${i + 1}: ${token}`);
  }
});

comprobar(
  "ningun campo, aviso o ayuda manda a un comodin retirado",
  senalados.length === 0,
  senalados.length ? senalados.slice(0, 4).join(" · ") : "todos apuntan a uno vigente"
);

// ── Los cajones de precio, uno por uno ─────────────────────────────────────
//
// Son los que se rompieron: se cambio la lista y se olvidaron las chapitas.
const CAJONES = [
  ["el precio del full", 'comodin="{{PRECIO_FULL}}"'],
  ["el precio del extra", 'comodin="{{PRECIO_UPSELL}}"'],
  ["el precio anterior del full", 'comodin="{{PRECIO_ANTES_FULL}}"'],
  ["el precio anterior del extra", 'comodin="{{PRECIO_ANTES_UPSELL}}"'],
];
for (const [nombre, marca] of CAJONES) {
  comprobar(`${nombre} lleva su comodin vigente`, editor.includes(marca), marca);
}
comprobar(
  // Este va en un ternario: en Lineal es el precio a secas, en las de dos
  // opciones es el del base.
  "el precio base lleva el suyo segun la modalidad",
  /\? "\{\{PRECIO_COMPLETO\}\}"\s*\r?\n?\s*: "\{\{PRECIO_BASE\}\}"/.test(editor),
  "PRECIO_COMPLETO o PRECIO_BASE"
);
comprobar(
  "y su «antes» tambien",
  /\? "\{\{PRECIO_MERCADO\}\}"\s*\r?\n?\s*: "\{\{PRECIO_ANTES_BASE\}\}"/.test(
    editor
  ),
  "PRECIO_MERCADO o PRECIO_ANTES_BASE"
);
comprobar(
  // Estaba al final de la pantalla, despues del bloque entero del full y del
  // extra: quien lo buscaba al lado del precio base creia que no existia.
  "el «antes» del base esta pegado a su precio",
  editor.indexOf("Precio anterior del base") <
    editor.indexOf("Precio producto full ("),
  "antes del bloque del full"
);

// ── Y no queda ninguna lista de comodines escrita a mano ───────────────────
comprobar(
  "no hay una segunda lista de comodines a mano",
  !/const items = \[\s*\r?\n\s*\["\{\{NOMBRE\}\}"/.test(editor),
  "solo la del catalogo"
);

console.log(
  fallos === 0
    ? "\nTODO OK — el editor no te manda a usar nada que haya retirado"
    : `\n${fallos} FALLA(S)`
);
process.exit(fallos === 0 ? 0 : 1);
