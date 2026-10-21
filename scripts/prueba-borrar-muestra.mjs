// Las muestras se agregaban y no se podian borrar.
//
// La galeria tenia un boton grande «➕ Agregar muestra» abajo, y ningun boton
// para quitar una. Se podia borrar —pero por un camino escondido: borrando la
// BURBUJA de dentro, que al quedarse sin pasos se llevaba la muestra entera.
// Nada lo decia. Asi que las muestras se quedaban ahi para siempre.
//
// Ahora cada muestra lleva su cabecera con el numero, su tema, y una papelera.
// Con confirmacion: se pierde la imagen, el tema, las palabras clave y el texto
// de una sola vez.
//
//   node scripts/prueba-borrar-muestra.mjs
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
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 60)} ${valor}`);
};

// La galería es la única de su clase: lo que se compruebe aquí vale para las
// galerías de los tres productos, que usan este mismo editor.
const galeria =
  editor.match(/function GalleryEditor\(\{[\s\S]*?\r?\n\}\r?\n/)?.[0] ?? "";

comprobar(
  "el editor de galería está donde se le busca",
  galeria.length > 0,
  "sí"
);
comprobar(
  "cada muestra tiene su papelera",
  /title="Borrar esta muestra"/.test(galeria),
  "🗑️"
);
comprobar(
  // Aquí se pierde la imagen, el tema, las palabras y el texto de una vez.
  // Alberto ya había pedido protección anti-basurero en los cuadritos.
  "y pide confirmación antes de borrar",
  /if \(!confirm\(`¿Borrar \$\{nombre\}\?/.test(galeria),
  "sí"
);
comprobar(
  // Sin decir CUÁL se borra, la confirmación no protege de nada.
  "la confirmación dice cuál se va a borrar",
  /const nombre = it\.topic\.trim\(\) \|\| `la muestra \$\{i \+ 1\}`;/.test(
    galeria
  ),
  "por su tema"
);
comprobar(
  "se puede deshacer",
  /onSnapshot\(\);\s*\r?\n\s*onChange\(items\.filter\(\(_, index\) => index !== i\)\);/.test(
    galeria
  ),
  "guarda foto antes"
);
comprobar(
  "y la cabecera dice cuál es cada muestra",
  /Muestra \{i \+ 1\}/.test(galeria) &&
    /\{it\.topic\.trim\(\) \? ` · \$\{it\.topic\.trim\(\)\}` : ""\}/.test(galeria),
  "número y tema"
);
comprobar(
  // El camino de antes sigue existiendo: quien borre la burbuja de dentro sigue
  // quitando la muestra. No se rompe nada de lo que ya funcionaba.
  "el camino viejo sigue funcionando",
  /if \(next\.length === 0\) \{\s*\r?\n\s*onRemove\(\);/.test(editor),
  "intacto"
);
comprobar(
  "y agregar sigue igual",
  /➕ Agregar muestra/.test(galeria),
  "intacto"
);

console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} comprobación(es) mal.`);
process.exit(fallos === 0 ? 0 : 1);
