// La pestaña Upsell deja de ser una pared de avisos.
//
// COMO ESTABA
//
//   Cinco avisos fijos apilados, diciendo siempre lo mismo pasara lo que
//   pasara, y DOS cajas de estado una debajo de otra: el chequeo de cuatro
//   puntos y una caja roja sobre los cuadritos que no aceptan la oferta.
//
//   Un aviso que no cambia nunca deja de leerse a la segunda visita. Y lo que
//   empujaban hacia abajo era justo lo unico que si cambia: el chequeo.
//
// COMO QUEDA
//
//   Una sola caja de estado, con cinco lineas. Todo lo fijo se muda a una
//   ventana que se abre con un «?» al lado del titulo. No se borra: quien ya
//   sabe como funciona no lo ve, y quien compra la plantilla lo tiene a un clic.
//
// DOS DE LOS CINCO NO SE MUDARON, Y A PROPOSITO
//
//   · «No es el Order Bump…» ya estaba escrito en el primer parrafo de la
//     pestaña, tres lineas mas arriba. Ademas decia «solo funciona en esta
//     modalidad», que hoy es FALSO: la etapa vive en la capa de cada modalidad
//     y el motor lee la que este vendiendo.
//
//   · «El upsell esta ENCENDIDO» repetia lo que ya dice el boton de al lado,
//     que se lee «Desactivar upsell» justo cuando esta encendido.
//
// LA QUINTA LINEA NO MIENTE SOBRE LO QUE ESTA ROTO
//
//   Las cuatro de siempre deciden si el producto se OFRECE. La nueva decide si
//   el «si» se puede COBRAR. Sumarla a las otras haria que la cabecera dijera
//   «asi no se ofrece» cuando si se ofrece, y mandaria a buscar el fallo donde
//   no esta.
//
//   node scripts/prueba-el-upsell-sin-pared-de-avisos.mjs
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

const pestana = (() => {
  const i = editor.indexOf('tab === "upsell"');
  const f = editor.indexOf('tab === "contenido"', i);
  return i < 0 || f < 0 ? "" : editor.slice(i, f);
})();
comprobar("se encuentra la pestaña", pestana.length > 0, "Upsell");

// -- 1. LOS AVISOS FIJOS YA NO ESTAN EN LA PANTALLA --------------------------
const fuera = [
  ["el del regalo y los minutos", "Si no contesta, pasados los minutos"],
  ["el de apagado y encendido", "Apagado, la venta termina al entregar"],
  ["el de la modalidad", "Lo que\n                escribas aquí no toca"],
  ["el del Order Bump repetido", "No es el Order Bump. El Order Bump hace elegir"],
  ["el que repetia el boton", "El upsell está ENCENDIDO"],
];
for (const [nombre, aguja] of fuera) {
  comprobar(
    `fuera de la pantalla: ${nombre}`,
    !pestana.includes(aguja.replace(/\n\s+/g, " ")) && !pestana.includes(aguja),
    "no se lee dos veces"
  );
}

// -- 2. PERO NO SE PIERDEN ---------------------------------------------------
const ayuda = (() => {
  const i = editor.indexOf("function AyudaDelUpsell(");
  const f = editor.indexOf("function cuadritosQueNoAceptan(", i);
  return i < 0 || f < 0 ? "" : editor.slice(i, f);
})();
comprobar("hay una ventana de ayuda", ayuda.length > 0, "AyudaDelUpsell");
comprobar(
  "se abre desde la barra de la sección",
  /headerActions=\{<AyudaDelUpsell \/>\}/.test(pestana),
  "un «?» al lado del título"
);
// La barra ENTERA es un boton. Sin cortar el clic, tocar el «?» abria ademas la
// seccion: se leia la ayuda con la ventana de la etapa detras.
comprobar(
  "y tocarlo no abre además la sección",
  /evento\.stopPropagation\(\);\s*\r?\n\s*setAbierta\(true\);/.test(ayuda),
  "leer no es querer editar"
);
comprobar(
  "y es una ventana de la casa",
  /<VentanaDeProducto/.test(ayuda),
  "no una caja más"
);
// LOS TRES QUE SI SE MUDARON. Si alguno se cayera por el camino, la pantalla lo
// habria perdido sin dejar rastro: no da error, simplemente ya no esta escrito.
const dentro = [
  ["apagado y encendido", "Apagado, la venta termina al entregar"],
  ["el regalo y los minutos", "sale el regalo igual"],
  ["cada modalidad la suya", "Lo que\n                escribas aquí no toca"],
  ["el cuadrito que no acepta", "La venta se\n                cae en el cobro"],
];
for (const [nombre, aguja] of dentro) {
  const limpio = aguja.replace(/\n\s+/g, " ");
  comprobar(
    `en la ventana: ${nombre}`,
    ayuda.includes(aguja) || ayuda.replace(/\s+/g, " ").includes(limpio),
    "sigue escrito"
  );
}

// -- 3. UNA SOLA CAJA DE ESTADO ----------------------------------------------
comprobar(
  "la caja roja aparte ya no existe",
  !/AvisoDeCuadritosQueNoAceptan/.test(editor),
  "una sola caja"
);
comprobar(
  "su detector sigue vivo, como función",
  /function cuadritosQueNoAceptan\(cfg: FullConfig\): string\[\]/.test(editor),
  "lo que detectaba no se pierde"
);
const chequeo = (() => {
  const i = editor.indexOf("function ChequeoDelUpsell(");
  const f = editor.indexOf("function AyudaDelUpsell(", i);
  return i < 0 || f < 0 ? "" : editor.slice(i, f);
})();
comprobar("se encuentra el chequeo", chequeo.length > 0, "ChequeoDelUpsell");
comprobar(
  "y lleva la quinta línea",
  /const flojos = cuadritosQueNoAceptan\(cfg\);/.test(chequeo) &&
    /Los cuadritos que dicen «sí» aceptan/.test(chequeo),
  "dentro del chequeo"
);
// Nombra a los flojos y dice como arreglarlos: una linea que solo dijera «mal»
// obliga a adivinar cual de los cuadritos es.
comprobar(
  "que nombra al cuadrito y dice cómo se arregla",
  /\{flojos\.join\(", "\)\}: clic derecho → Enlazar a → UPSELL/.test(chequeo),
  "sin adivinar"
);

// -- 4. LA CABECERA DICE QUE ESTA ROTO DE VERDAD -----------------------------
comprobar(
  "el visto bueno exige las cinco",
  /const todoBien = faltan\.length === 0 && flojos\.length === 0;/.test(chequeo),
  "verde solo si todo está"
);
// Las cuatro de siempre deciden si se OFRECE; la quinta, si se COBRA. Con un
// cuadrito flojo el producto SI se ofrece: decir «asi no se ofrece» mandaria a
// buscar el fallo donde no esta.
comprobar(
  "pero distingue ofrecer de cobrar",
  /"⚠️ Se ofrece, pero el «sí» no se cobra"/.test(chequeo) &&
    /faltan\.length > 0\s*\r?\n?\s*\? `⚠️ Así no se ofrece/.test(chequeo),
  "dos averías, dos avisos"
);

console.log(fallos === 0 ? "\nTODO OK" : `\n${fallos} FALLO(S)`);
process.exit(fallos === 0 ? 0 : 1);
