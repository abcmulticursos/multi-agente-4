// Una sola burbuja resaltada en todo el editor.
//
// El bug: la sección Canales pinta CINCO bloques de recorrido, y ese bloque se
// había quedado con su propia selección local (useState). Cada bloque recordaba
// su burbuja, así que al elegir una en el segundo, la del primero seguía
// resaltada: parecían dos seleccionadas y la primera no se "despegaba".
//
// La regla es que el dueño de la selección sea el contexto compartido, uno
// solo para todo el editor. Esta prueba falla si alguien vuelve a meter una
// selección local — que es lo que pasa al copiar y pegar un bloque entero.
//
//   node scripts/prueba-seleccion-burbuja.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const editor = readFileSync(join(RAIZ, "src", "app", "editor", "page.tsx"), "utf8");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (nombre, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(nombre, 58)} ${valor}`);
};

// 1. Nadie puede guardarse la burbuja marcada por su cuenta.
const localesSueltas = [
  ...editor.matchAll(
    /const\s*\[\s*activeStepIndex\s*,\s*setActiveStepIndex\s*\]\s*=\s*useState/g
  ),
];
comprobar(
  "ningún bloque se guarda la selección por su cuenta",
  localesSueltas.length === 0,
  localesSueltas.length === 0
    ? "ninguna selección local"
    : `${localesSueltas.length} useState suelto(s) — vuelve el bug de las dos resaltadas`
);

// 2. Todos los que resaltan burbujas piden la selección al contexto.
const usosDelHook = [...editor.matchAll(/useSeleccionDeBurbuja\(\)/g)];
comprobar(
  "las secciones piden la selección al contexto compartido",
  usosDelHook.length >= 3,
  `${usosDelHook.length} sección(es)`
);

// 3. Y hay UN solo dueño para todo el editor.
const proveedores = [
  ...editor.matchAll(/<SeleccionDeBurbujaContext\.Provider/g),
];
comprobar(
  "hay un único proveedor de selección en todo el editor",
  proveedores.length === 1,
  `${proveedores.length} proveedor(es)`
);

// 4. La regla que apaga la de antes: cada sección solo se queda con la
//    selección si es SUYA. Sin esta comparación, todas se creerían dueñas.
comprobar(
  "cada sección solo se queda la selección si es suya",
  /seleccion\.dueño === idPropio \? seleccion\.indice : null/.test(editor),
  "sí"
);

// 5. El bloque del recorrido por canal — el que fallaba — usa el hook.
const bloque = editor.slice(editor.indexOf("function JourneyPreviewBlock"));
comprobar(
  "el bloque de la sección Canales usa la selección compartida",
  bloque.slice(0, 4000).includes("useSeleccionDeBurbuja()"),
  "sí"
);

console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} comprobación(es) mal.`);
process.exit(fallos === 0 ? 0 : 1);
