// TRAS GUARDAR, LA VENTANA DE ARRIBA VUELVE A DECIR «CERRAR».
//
// LO QUE CONTÓ EL DUEÑO — 18 de septiembre de 2026, con sus palabras:
//
//   «Entro al pop up de seguimientos, con título SEGUIMIENTOS · WHATSAPP, y si no
//    hay ningún cambio dice CERRAR. Entonces entro a su sub pestaña Seguimiento_1,
//    hago un cambio, le doy guardar y esa sub pestaña se cierra. Pero a pesar de
//    que he guardado, en la pestaña de arriba sigue activo el botón guardar, y
//    creo que eso ya no debería estar activo puesto que ya guardé.»
//
// Y CONFIRMÓ LO QUE DEBE PASAR: «al darle click en guardar se cierra y ya queda en
// la pestaña seguimientos whatsapp CERRAR, eso es todo».
//
// POR QUÉ PASABA. Cada ventana se hace una FOTO del borrador al abrirse y la
// compara con el borrador de ahora: si son distintas, es que se tocó algo dentro.
// La de arriba se fotografió ANTES del cambio, así que después de guardar su foto
// y el borrador siguen siendo distintos — y nadie le avisó de que esa diferencia
// YA SE SUBIÓ.
//
// LO QUE NO SE VE Y ERA PEOR. Con «Guardar» encendido también lo estaba
// «Cancelar», y Cancelar DESHACE: devuelve el borrador a la foto de antes. Pulsarlo
// creyendo que ahí no se había tocado nada deshacía lo que se acababa de guardar.
// Lo mismo con Escape, que es el Cancelar del teclado.
//
//   node scripts/prueba-tras-guardar-la-ventana-dice-cerrar.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const editor = readFileSync(join(RAIZ, "src", "app", "editor", "page.tsx"), "utf8").replace(/\r\n/g, "\n");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// ── 1. LA REGLA, EJECUTADA ─────────────────────────────────────────────────
//
// Se saca la condición REAL del archivo y se corre con los cuatro casos que se
// dan de verdad. Comprobar que el texto está escrito no dice nada sobre lo que
// hace; esto sí.
const condicion = (editor.match(
  /const sucio = guardado\?\.sucio \?\? false;\s*\n\s*const cambioAqui = ([^;]+);/
) ?? [])[1];
comprobar("se encuentra la condición del botón", !!condicion, condicion ?? "—");

const decide = new Function(
  "sucio",
  "huellaAhora",
  "huellaAlAbrir",
  `const guardado = { sucio, huella: huellaAhora };
   const cambioAqui = ${condicion ?? "false"};
   return cambioAqui ? "Cancelar+Guardar" : "Cerrar";`
);

// LOS CUATRO CASOS. El tercero es EL SUYO.
for (const [caso, sucio, ahora, alAbrir, esperado] of [
  ["recién abierta, nada tocado", false, "H0", "H0", "Cerrar"],
  ["se tocó algo aquí y sigue sin guardar", true, "H1", "H0", "Cancelar+Guardar"],
  ["se guardó en la sub-ventana ← SU CASO", false, "H1", "H0", "Cerrar"],
  ["se tocó en otra pestaña, no aquí", true, "H0", "H0", "Cerrar"],
]) {
  const salio = decide(sucio, ahora, alAbrir);
  comprobar(`  ${caso}`, salio === esperado, `${salio}`);
}

// ── 2. Y ESCAPE NO DESHACE LO YA GUARDADO ──────────────────────────────────
//
// Escape es el Cancelar del teclado y tenía el mismo fallo. Sin cambios
// pendientes no hay nada que deshacer: solo cierra.
console.log("\n— y Escape no deshace lo que ya se guardó —\n");
const salida = (editor.match(/const salir = \(\) => \{[\s\S]{0,900}?\n  \};/) ?? [""])[0];
comprobar("se encuentra la salida de la ventana", salida.length > 100);
comprobar(
  "solo deshace si queda algo sin guardar",
  /if \(huellaAlAbrirLaVentana && guardadoDelEditor\?\.sucio\) \{/.test(salida),
  "si no, deshacía lo guardado"
);

// ── 3. LO QUE NO SE PUEDE HABER ROTO ───────────────────────────────────────
//
// La primera mitad de la condición existe por un motivo propio y se queda: sin
// ella, una ventana recién abierta ofrecía guardar por algo escrito media hora
// antes en OTRA pestaña.
console.log("\n— y lo que ya protegía sigue en pie —\n");
comprobar(
  "la ventana sigue mirando su propia foto",
  /\(guardado\?\.huella \?\? ""\) !== huellaAlAbrir/.test(editor),
  "no solo el «hay cambios» global"
);
comprobar(
  "la foto se toma UNA vez, al abrir",
  /const \[huellaAlAbrir\] = useState\(\(\) => guardado\?\.huella \?\? ""\);/.test(
    editor
  ),
  "no en cada pintada"
);
comprobar(
  "y Cancelar sigue deshaciendo cuando SÍ toca",
  /guardado\?\.restaurar\(huellaAlAbrir\);/.test(editor),
  "no se quedó en solo cerrar"
);

console.log(`\n${fallos === 0 ? "TODO EN VERDE" : `${fallos} EN ROJO`}\n`);
process.exit(fallos === 0 ? 0 : 1);
