// Precios y pagos: el pais y cada metodo de pago se editan en ventana.
//
// COMO ESTABA
//
//   Un cajon desplegable con TODO lo del pais dentro —precio, moneda, botones
//   de producto, datos de pago— y, debajo, una tarjeta por metodo de pago, cada
//   una con su editor de burbujas y su visor de WhatsApp. Con cuatro o cinco
//   metodos la pestaña se iba a varias pantallas y habia que recorrerla entera
//   para llegar al ultimo.
//
// COMO QUEDA
//
//   Barras, como los cajones plegados de siempre. Al tocarlas se abre su
//   ventana. Es el mismo interruptor `enVentana` que usa la pestaña Contenido.
//
// LO QUE HUBO QUE MOVER, Y POR QUE
//
//   El conmutador «Configurar un pais / Ajustes comunes» vivia DENTRO del
//   primer cajon. Mientras el cajon crecia hacia abajo daba igual. Con ventana,
//   no: habria que abrir la ventana para cambiar de vista, y al pasar a
//   «Ajustes comunes» la ventana se queda EN BLANCO, porque todo lo que lleva
//   dentro es de la vista de pais.
//
//   Esos dos botones mandan sobre la pestaña ENTERA, asi que su sitio es la
//   pestaña. Y el cajon solo existe en la vista de pais: en la otra no le queda
//   nada dentro.
//
// EL EDITOR DE BURBUJAS DENTRO DE UNA VENTANA
//
//   No caben dos columnas iguales. Las llamadas de dentro de una ventana piden
//   su propio reparto —una columna, y el visor estrecho al lado en pantallas
//   muy anchas—, que es lo que ya hacen las ventanas de Canales.
//
//   Y eso se pedia a medias: los dos repartos se escribian juntos en la misma
//   clase, y cual manda no lo decide el orden en que se escriben sino el del
//   CSS generado, donde el de la casa va despues y ganaba siempre.
//
//   node scripts/prueba-precios-y-pagos-en-ventanas.mjs
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
  const i = editor.indexOf('tab === "pago"');
  const f = editor.indexOf('tab === "entrega"', i);
  return i < 0 || f < 0 ? "" : editor.slice(i, f);
})();
comprobar("se encuentra la pestaña", pestana.length > 0, "Precios y pagos");

// -- 1. EL CAJON DEL PAIS, EN VENTANA ----------------------------------------
comprobar(
  "el cajón del país abre ventana",
  /<Collapsible\s*\r?\n\s*title="💰 Pais, moneda y metodos por pais \(ROAS \/ multipais\)"\s*\r?\n\s*titleKey="pago_pais_y_metodos"\s*\r?\n\s*enVentana\s*\r?\n\s*>/.test(
    pestana
  ),
  "barra, no desplegable"
);
// En «Ajustes comunes» no le queda nada dentro: seria una barra que abre una
// ventana vacia.
comprobar(
  "y solo existe en la vista de país",
  /\{paymentEditorView === "country" && \(\s*\r?\n\s*<Collapsible\s*\r?\n\s*title="💰 Pais, moneda/.test(
    pestana
  ),
  "no abre una ventana vacía"
);

// -- 2. EL CONMUTADOR SE QUEDA EN LA PESTAÑA ---------------------------------
const cajonDelPais = (() => {
  const i = pestana.indexOf('title="💰 Pais, moneda y metodos por pais');
  const f = pestana.indexOf("</Collapsible>", i);
  return i < 0 || f < 0 ? "" : pestana.slice(i, f);
})();
comprobar("se encuentra el cajón del país", cajonDelPais.length > 0, "dentro");
comprobar(
  "el conmutador de vista NO está dentro del cajón",
  !/setPaymentEditorView/.test(cajonDelPais),
  "manda sobre la pestaña entera"
);
comprobar(
  "y sí está en la pestaña, antes del cajón",
  pestana.indexOf('onClick={() => setPaymentEditorView("country")}') > 0 &&
    pestana.indexOf('onClick={() => setPaymentEditorView("country")}') <
      pestana.indexOf('title="💰 Pais, moneda y metodos por pais'),
  "a la vista siempre"
);
// Sus dos botones siguen estando los dos: perder uno dejaria media pestaña
// inalcanzable.
comprobar(
  "con sus dos botones",
  /setPaymentEditorView\("country"\)/.test(pestana) &&
    /setPaymentEditorView\("common"\)/.test(pestana),
  "país y comunes"
);

// -- 3. CADA METODO DE PAGO, SU BARRA ----------------------------------------
comprobar(
  "cada método de pago abre su ventana",
  /paymentResponseBlocks\.map\(\(\[key, label, steps\]\) => \(\s*\r?\n\s*<Collapsible\s*\r?\n\s*key=\{key\}\s*\r?\n\s*title=\{label\}\s*\r?\n\s*titleKey=\{`pago_metodo_\$\{selectedPaymentCountry\}_\$\{key\}`\}\s*\r?\n\s*enVentana/.test(
    pestana
  ),
  "uno por método"
);
// La llave lleva el pais: al cambiar de pais cambia la lista de metodos, y sin
// el pais dos metodos distintos compartirian la misma marca de «estoy aqui».
comprobar(
  "y la llave lleva el país",
  /titleKey=\{`pago_metodo_\$\{selectedPaymentCountry\}_\$\{key\}`\}/.test(
    pestana
  ),
  "no se pisan entre países"
);
// La tarjeta de antes no puede quedarse ademas de la barra: serian dos sitios
// para editar lo mismo.
comprobar(
  "y ya no queda la tarjeta suelta de antes",
  !/<h2 className="mb-3 text-base font-bold text-neutral-900">\s*\r?\n\s*\{label\}/.test(
    pestana
  ),
  "un solo sitio"
);

// -- 4. EL EDITOR DE BURBUJAS CABE EN LA VENTANA -----------------------------
const par = (() => {
  // `JourneyPreviewSection` no sirve de tope: esta declarada ANTES.
  const i = editor.indexOf("function StepEditorPreviewPair(");
  const f = editor.indexOf("function EditorEmojiInput(", i);
  return i < 0 || f < 0 ? "" : editor.slice(i, f);
})();
comprobar("se encuentra el par editor/visor", par.length > 0, "StepEditorPreviewPair");
comprobar(
  "quien llama puede traer su propio reparto",
  /\/grid-cols\/\.test\(className \?\? ""\) \? "" : "lg:grid-cols-2"/.test(par),
  "y entonces el de la casa no se escribe"
);
// Las ventanas que llevan el editor dentro piden el reparto estrecho.
//
// ERAN SEIS Y AHORA SON CINCO, y no se perdio ninguna: el 15 de septiembre de
// 2026 «Mensajes principales» dejo de ser una pestana propia —su contenido bajo
// a la lista de cajones del seguimiento, que ya pedia el reparto estrecho por su
// cuenta—. Ver `prueba-el-seguimiento-es-una-sola-lista`. La intencion no
// cambia: toda ventana que lleve el editor dentro lo pide.
comprobar(
  "y las ventanas lo piden",
  (editor.match(
    /className="lg:grid-cols-1 xl:grid-cols-\[minmax\(0,1fr\)_minmax\(220px,280px\)\]"/g
  ) ?? []).length >= 5,
  "editor ancho, visor estrecho"
);

console.log(fallos === 0 ? "\nTODO OK" : `\n${fallos} FALLO(S)`);
process.exit(fallos === 0 ? 0 : 1);
