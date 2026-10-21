// Ajustes: lo que se toca una vez va en ventana; lo que se vigila, a la vista.
//
// COMO ESTABA
//
//   Una columna de nueve bloques abiertos, uno detras de otro, todos a la vez.
//   Media pantalla de cartel rojo de moderacion con dos casillas dentro, media
//   pantalla de explicacion de spintax, la lista entera de comodines... y al
//   final de todo, debajo de esa pila, los tres mandos que de verdad se miran:
//   los tiempos, el ahorro del cerebro y los organicos.
//
//   Un cartel encendido todo el rato se deja de leer al segundo dia. Y lo que
//   sobra no molesta solo por sobrar: empuja hacia abajo lo que si hace falta.
//
// COMO QUEDA
//
//   En ventana, lo que se configura UNA VEZ y se deja puesto:
//
//     moderacion · comportamiento del bot · identidad del proyecto ·
//     horarios y rafagas · variantes del intro · muestras progresivas ·
//     spintax · comodines (con los de crear dentro) · flujo experimental
//
//   A LA VISTA, sin ventana, lo que se mira y se cambia a menudo:
//
//     tiempos y delays · ahorro del cerebro · no contestar a organicos
//
//   Esos tres NO pueden esconderse. Son los que cuestan dinero cuando estan
//   mal: el delay se toca al probar, el ahorro cambia lo que se paga por cada
//   conversacion, y el de organicos decide si se contesta o no a quien escribe
//   sin venir del anuncio. Un mando de esos detras de un clic es un mando que
//   nadie revisa.
//
//   node scripts/prueba-ajustes-en-ventanas.mjs
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

// -- 1. LO QUE SE CONFIGURA UNA VEZ, EN VENTANA ------------------------------
//
// Se exige `enVentana` explicito. Sin el, el cajon crece hacia abajo y vuelve a
// empujar lo de debajo: la pila seria la misma, solo que plegada.
const enVentana = [
  ["moderación", "ajustes_moderacion"],
  ["comportamiento del bot", "ajustes_comportamiento"],
  ["identidad del proyecto", "ajustes_identidad"],
  ["horarios y ráfagas", "ajustes_horarios"],
  ["variantes del intro", "ajustes_variantes_intro"],
  ["muestras progresivas", "ajustes_muestras_progresivas"],
  ["spintax", "ajustes_spintax"],
  ["comodines", "ajustes_comodines"],
];
for (const [nombre, llave] of enVentana) {
  comprobar(
    `${nombre}: en ventana`,
    new RegExp(`titleKey="${llave}"[\\s\\S]{0,300}?\\benVentana\\b`).test(editor),
    llave
  );
}

// LOS COMODINES VAN JUNTOS, en una sola ventana: los del sistema, los propios y
// el formulario de crear. Separados obligan a cerrar una para abrir la otra
// mientras se copia un nombre de una a la otra.
comprobar(
  "y los de crear van dentro de esa misma ventana",
  (() => {
    const i = editor.indexOf('titleKey="ajustes_comodines"');
    if (i < 0) return false;
    const f = editor.indexOf("</Collapsible>", i);
    const dentro = editor.slice(i, f);
    return (
      /Comodines ya creados por el sistema/.test(dentro) &&
      /Crear comodines rápidos para futuros productos/.test(dentro) &&
      /Mis comodines personalizados/.test(dentro)
    );
  })(),
  "una sola ventana"
);

// EL TITULO NO SE DICE DOS VECES. La barra ya lo lleva; dejar tambien el <h2>
// de dentro hace que la ventana se abra repitiendo su propio nombre.
comprobar(
  "y el título no se repite dentro",
  !/<h2 className="mb-2 text-base font-bold text-neutral-900">\s*\r?\n\s*(Variantes del intro|Muestras progresivas|Comodines)\s*\r?\n\s*<\/h2>/.test(
    editor
  ),
  "una sola vez"
);

// -- 2. LOS TRES QUE NO PUEDEN ESCONDERSE ------------------------------------
//
// Son los que cuestan dinero cuando estan mal. Si alguien los mete en una
// ventana «para ordenar», dejan de revisarse.
const aLaVista = [
  ["tiempos y delays", "Tiempos generales (delays y limpieza)"],
  ["ahorro del cerebro", "💰 Ahorro del cerebro"],
  ["no contestar a orgánicos", "El bot NO contesta a los orgánicos"],
];
for (const [nombre, texto] of aLaVista) {
  const i = editor.indexOf(texto);
  comprobar(`${nombre}: se encuentra`, i > 0, "está");
  if (i < 0) continue;
  // Se mira hacia atras desde el bloque: si la etiqueta mas cercana por encima
  // es un `enVentana`, es que quedo dentro de una.
  const antes = editor.slice(Math.max(0, i - 2500), i);
  const ultimaVentana = antes.lastIndexOf("enVentana");
  const ultimoCierre = antes.lastIndexOf("</Collapsible>");
  comprobar(
    `${nombre}: no está en una ventana`,
    ultimaVentana < 0 || ultimoCierre > ultimaVentana,
    "a la vista"
  );
}

console.log(
  fallos === 0
    ? "\nTODO OK — lo de una vez en ventana, lo que cuesta dinero a la vista"
    : `\n${fallos} FALLO(S)`
);
process.exit(fallos === 0 ? 0 : 1);
