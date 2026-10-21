// Un cajon se puede abrir con la pantalla entera para el.
//
// DE DONDE SALE
//
//   Comparando con otro panel del mercado: el suyo se ve ordenado y el nuestro
//   apretado. Y la diferencia NO era el estilo. Era que ellos abren la
//   secuencia en una ventana grande y aqui el editor vive incrustado en la
//   pagina, compitiendo por el ancho con todo lo demas: los pasos a la
//   izquierda, el visor a la derecha, y las dos mitades estrechas.
//
//   Los campos son los mismos. Lo que faltaba era sitio.
//
// COMO SE HIZO
//
//   Un boton «⛶ Pantalla completa» en cada cajon abre EL MISMO editor -- no una
//   copia -- en una ventana ancha. Reversible por construccion: si no se pulsa,
//   no cambia absolutamente nada. Nada se mueve de sitio en la pagina.
//
//   Y dentro, la fila de comodines: se ven todos y se copian de un clic. Era la
//   queja de fondo -- no saber cual trae cual y tener que acordarse de si BCP es
//   el 1 o el 2.
//
//   node scripts/prueba-el-cajon-a-pantalla-completa.mjs
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

const pareja = (() => {
  const i = editor.indexOf("function StepEditorPreviewPair(");
  return i < 0 ? "" : editor.slice(i, i + 9000);
})();

// ── 1. El botón, y que no cambie nada por sí solo ────────────────────────────
comprobar(
  "cada cajón se puede abrir a pantalla completa",
  /⛶ Pantalla completa/.test(pareja) &&
    /setAPantallaCompleta\(true\)/.test(pareja),
  "un botón"
);
// REVERSIBLE POR CONSTRUCCION: es un boton mas. Sin pulsarlo, el editor de la
// pagina se queda exactamente como estaba.
comprobar(
  "y si no se pulsa, todo sigue igual",
  /\{aPantallaCompleta && \(/.test(pareja) &&
    /const \[aPantallaCompleta, setAPantallaCompleta\] = useState\(false\);/.test(
      pareja
    ),
  "nada se mueve de sitio"
);

// ── 2. Es EL MISMO editor, no una copia ──────────────────────────────────────
//
// Con una copia, el dia que se arregle algo en uno el otro se queda viejo — y
// se editaria el mismo cajon de dos formas distintas.
comprobar(
  "dentro va el mismo editor, no una copia",
  /<StepEditorPreviewPair\s*\r?\n\s*steps=\{steps\}/.test(pareja) &&
    /sinExpandir\s*\r?\n\s*\/>/.test(pareja),
  "una sola implementación"
);
// Y no se ofrece abrir otra ventana desde dentro de la que ya esta abierta.
comprobar(
  "y no se puede abrir otra desde dentro",
  /\{!sinExpandir && \(/.test(pareja) &&
    /sinExpandir\?: boolean;/.test(pareja),
  "sin muñecas rusas"
);
// Los mismos datos: cambia el ancho, no lo que se guarda.
comprobar(
  "con los mismos precios y el mismo contexto del visor",
  /previewContext=\{previewContext\}\s*\r?\n\s*sinExpandir/.test(pareja),
  "cambia el ancho, no el dato"
);

// ── 3. Los comodines, a un clic ──────────────────────────────────────────────
comprobar(
  "se ven todos los comodines de esta modalidad",
  /const comodinesDisponibles = useContext\(PlaceholderOptionsContext\);/.test(
    pareja
  ),
  "los suyos, no una lista fija"
);
// SE COPIAN, NO SE INSERTAN. La burbuja que se esta escribiendo puede ser
// cualquiera de la lista; adivinar cual seria meter texto donde no toca.
comprobar(
  "se copian al portapapeles en vez de insertarse a ciegas",
  /navigator\.clipboard\?\.writeText\(opcion\.token\)/.test(pareja),
  "no escribe donde no toca"
);
comprobar(
  "y avisa de que se copió",
  /\? "✓ copiado" : opcion\.token/.test(pareja),
  "el portapapeles no se ve"
);

// ── 4. Se cierra como todas las ventanas del panel ───────────────────────────
comprobar(
  "se cierra con «Listo» o con un clic fuera",
  /onClick=\{\(\) => setAPantallaCompleta\(false\)\}/.test(pareja) &&
    /onClick=\{\(evento\) => evento\.stopPropagation\(\)\}/.test(pareja),
  "como las demás"
);

console.log(
  fallos === 0
    ? "\nTODO OK — el cajón se puede editar con sitio"
    : `\n${fallos} comprobacion(es) mal.`
);
process.exit(fallos === 0 ? 0 : 1);
