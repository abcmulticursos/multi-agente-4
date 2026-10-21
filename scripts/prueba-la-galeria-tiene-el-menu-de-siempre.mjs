// La galeria de muestras tiene el mismo menu de clic derecho que las demas.
//
// LO QUE PIDIO EL DUENO el 15 de septiembre de 2026: «en la galeria de muestras
// necesito que se pueda editar la burbuja con click derecho, no solo eso, sino
// tambien agregale las caracteristicas que tienen las demas burbujas, copiar
// pegar, borrar, cortar, etc.».
//
// POR QUE NO PASABA
//
//   El menu no es del editor de la izquierda: vive en el VISOR —`ChatPreview`—
//   y se abre con el boton derecho encima de la burbuja. Sus opciones se pintan
//   SOLO si quien lo usa le pasa la accion correspondiente:
//
//       {onEditStep && (<button …>Editar esta burbuja</button>)}
//
//   y el propio visor no abre el menu si no le han pasado ninguna:
//
//       if (!onEditStep && !onDuplicateStep && !onToggleStep && !onRemoveStep) return;
//
//   La galeria pintaba `<ChatPreview steps={pasos} />` a secas. Sin acciones, el
//   clic derecho no hacia nada. No era un menu roto: era un menu sin manos.
//
// NO SE ESCRIBE UN MENU NUEVO: se le pasan las mismas manos que en el resto de
// la pantalla, para que no acaben comportandose distinto.
//
//   node scripts/prueba-la-galeria-tiene-el-menu-de-siempre.mjs
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
const trozo = (desde, hasta) => {
  const i = editor.indexOf(desde);
  if (i < 0) return "";
  const f = editor.indexOf(hasta, i);
  return f < 0 ? editor.slice(i) : editor.slice(i, f);
};

const galeria = trozo(
  "function GalleryCaptionBubbleEditor(",
  "\nfunction GalleryEditor("
);
comprobar(
  "se encuentra la burbuja de la galería",
  galeria.length > 0,
  "GalleryCaptionBubbleEditor"
);

// ── 1. EL MENÚ SE ABRE ───────────────────────────────────────────────────────
//
// El visor no lo abre si no le pasan ninguna accion. Con estas cuatro, se abre.
console.log("\n— el clic derecho ya abre el menú —\n");
const visor = trozo("function ChatPreview(", "\nfunction ");
comprobar(
  "el visor exige al menos una acción para abrirlo",
  /if \(!onEditStep && !onDuplicateStep && !onToggleStep && !onRemoveStep\) return;/.test(
    visor
  ),
  "por eso antes no salía"
);
for (const accion of [
  "onEditStep",
  "onDuplicateStep",
  "onToggleStep",
  "onRemoveStep",
  "onPasteStep",
  "onMoveStep",
]) {
  comprobar(
    `la galería le pasa «${accion}»`,
    new RegExp(`${accion}=\\{`).test(galeria),
    "la misma mano que las demás"
  );
}

// ── 2. LAS OPCIONES QUE PIDIÓ ────────────────────────────────────────────────
//
// Copiar y cortar no necesitan que nadie les pase nada: el portapapeles de
// burbujas es uno solo para toda la pantalla, y por eso se puede cortar aqui y
// pegar en una intro.
console.log("\n— y están las siete opciones —\n");
for (const [opcion, marca] of [
  ["Editar esta burbuja", "Editar esta burbuja"],
  ["Duplicar burbuja", "Duplicar burbuja"],
  ["Copiar burbuja", "Copiar burbuja"],
  ["Cortar burbuja", "Cortar burbuja"],
  ["Pegar debajo de esta burbuja", "Pegar debajo de esta burbuja"],
  ["Encender/Apagar burbuja", "Apagar burbuja"],
  ["Eliminar burbuja", "Eliminar burbuja"],
]) {
  comprobar(`«${opcion}»`, visor.includes(marca), "en el menú de siempre");
}
comprobar(
  "copiar y cortar usan el portapapeles compartido",
  /copyStep\(/.test(visor) && /bubbleClipboard\.step/.test(visor),
  "se corta aquí y se pega en una intro"
);

// ── 3. LA PRIMERA BURBUJA ES LA MUESTRA, Y SE AVISA ──────────────────────────
//
// Quitarla no es quitar una burbuja: se lleva el archivo, el tema, las palabras
// y el texto. Por eso se pregunta INCLUSO viniendo de cortar, que es el unico
// caso en que el menu pide no preguntar.
console.log("\n— y la primera burbuja no se pierde por descuido —\n");
comprobar(
  "quitar la burbuja de la muestra avisa de lo que se lleva",
  /Ésta es la burbuja de la muestra\. Al quitarla se pierde su archivo, su tema, sus palabras y su texto/.test(
    galeria
  ),
  "no es una burbuja cualquiera"
);
comprobar(
  "y se pregunta aunque venga de cortar",
  /opciones\?\.sinPreguntar !== true \|\| esLaMuestra/.test(galeria),
  "cortar la muestra sí necesita aviso"
);
comprobar(
  "sin ninguna burbuja, la muestra se quita entera",
  /if \(quedan\.length === 0\) \{\s*\r?\n\s*onRemove\(\);/.test(galeria),
  "no queda una ficha sin archivo"
);

// ── 4. Y CADA ACCIÓN HACE LO SUYO ────────────────────────────────────────────
console.log("\n— y cada acción escribe donde debe —\n");
comprobar(
  "duplicar deja la copia justo debajo",
  /aplicarPasos\(\[\s*\r?\n\s*\.\.\.pasos\.slice\(0, indice \+ 1\),\s*\r?\n\s*cloneJson\(pasos\[indice\]\)/.test(
    galeria
  ),
  "no al final"
);
comprobar(
  "pegar también",
  /aplicarPasos\(\[\s*\r?\n\s*\.\.\.pasos\.slice\(0, indice \+ 1\),\s*\r?\n\s*cloneJson\(paso\)/.test(
    galeria
  ),
  "debajo de la señalada"
);
comprobar(
  "apagar no borra nada",
  /j === indice \? \{ \.\.\.paso, enabled: paso\.enabled === false \} : paso/.test(
    galeria
  ),
  "solo cambia el interruptor"
);
comprobar(
  "y mover respeta si se suelta antes o después",
  /const destino = donde === "after" \? hasta \+ 1 : hasta;/.test(galeria) &&
    /const ajustado = desde < destino \? destino - 1 : destino;/.test(galeria),
  "arrastrando en el visor"
);
comprobar(
  "todas pasan por el mismo sitio que guarda",
  (galeria.match(/aplicarPasos\(/g) ?? []).length >= 5,
  "aplicarPasos"
);
comprobar(
  "y las que cambian la lista dejan deshacer",
  (galeria.match(/onSnapshot\(\);/g) ?? []).length >= 4,
  "se puede volver atrás"
);

// ── 5. «EDITAR» SEÑALA LA BURBUJA EN EL EDITOR DE AL LADO ────────────────────
console.log("\n— «editar» lleva a la burbuja de verdad —\n");
comprobar(
  "el visor y el editor comparten cuál está señalada",
  /const \[burbujaActiva, setBurbujaActiva\] = useState<number \| null>\(null\);/.test(
    galeria
  ),
  "una sola verdad"
);
comprobar(
  "el editor de la izquierda la marca",
  /activeStepIndex=\{burbujaActiva\}[\s\S]{0,120}onActiveStepIndexChange=\{setBurbujaActiva\}/.test(
    galeria
  ),
  "StepList"
);
comprobar(
  "y no se abre un modal encima de un editor que ya se ve",
  /onEditStep=\{\(indice\) => setBurbujaActiva\(indice\)\}/.test(galeria),
  "aquí el editor está al lado"
);

console.log(
  fallos === 0
    ? "\nTODO OK — la galería tiene el menú de siempre"
    : `\n${fallos} comprobacion(es) mal.`
);
process.exit(fallos === 0 ? 0 : 1);
