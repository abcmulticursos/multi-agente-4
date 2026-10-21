// Faltaba «Doble Oferta + Upsell» en la lista de importacion.
//
// LO QUE PASABA
//
// La ventana de importar ofrecia estas secciones:
//
//   Intro · Seguimientos · Salesbot · Canales · Regalo · Precios y pagos ·
//   Entrega · Doble Oferta completa · Order Bump completo · Doble Oferta 2 Prod ·
//   Lineal completo · Contenido · Cerebro · Upsell · Ajustes
//
// Estaban las otras cinco modalidades. La que faltaba era justo la que se
// estaba usando: se exportaba el archivo, se abria en el otro proyecto, y esa
// modalidad NO aparecia en la lista. No habia forma de traerla.
//
// Y NO BASTA CON COPIAR SU CLAVE
//
// El contenido de esa modalidad vive REPARTIDO en registros aparte: sus
// cuentas de pago en modality_payment_profiles, sus precios en
// modality_pricing, su contenido en modality_templates, y sus textos por canal
// dentro de channels. Copiando solo `doble_oferta_upsell` viajaria la oferta
// pero no las cuentas donde cobrarla.
//
// Y NO SE ENCIENDE SOLA
//
// Importarla trae su contenido, pero encenderla es una decision de venta.
// Se conserva el interruptor que tuviera el proyecto de destino.
//
//   node scripts/prueba-importar-doble-oferta-upsell.mjs
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
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 62)} ${valor}`);
};

// ── La lista de secciones ───────────────────────────────────────────────────
const listaFuente = editor.slice(
  editor.indexOf("const IMPORT_SECTIONS"),
  editor.indexOf("] as const;", editor.indexOf("const IMPORT_SECTIONS")) + 11
);
const IMPORT_SECTIONS = new Function(
  "return " +
    listaFuente
      .replace(/^const IMPORT_SECTIONS[^=]*=\s*/, "")
      .replace(/\] as const;$/, "]")
)();
const claves = IMPORT_SECTIONS.map((s) => s.key);

comprobar(
  // ESTE era el fallo.
  "«Doble Oferta + Upsell» está en la lista",
  claves.includes("dobleofertaupsell"),
  "aparece"
);
comprobar(
  "y trae su clave de primer nivel",
  IMPORT_SECTIONS.find((s) => s.key === "dobleofertaupsell")?.fields?.includes(
    "doble_oferta_upsell"
  ),
  "sí"
);
comprobar(
  "están las SEIS modalidades, ninguna suelta",
  ["lineal", "orderbump", "bioferta", "dobleoferta2", "dobleofertaupsell", "upsell"].every(
    (k) => claves.includes(k)
  ),
  "las seis"
);
comprobar(
  "el nombre en pantalla dice que trae el tercer producto",
  /Doble Oferta \+ Upsell \(con su tercer producto\)/.test(editor),
  "claro"
);

// ── La casilla no puede salir en gris si el archivo sí la trae ──────────────
comprobar(
  // Un archivo puede traer la capa de pagos o la plantilla sin la clave de
  // primer nivel. Sin esto la casilla diria «no viene en el archivo».
  "la casilla se enciende también con su capa o su plantilla",
  /section\.key === "dobleofertaupsell" &&[\s\S]{0,300}modality_payment_profiles\.doble_oferta_upsell[\s\S]{0,200}modality_templates\.doble_oferta_upsell/.test(
    editor
  ),
  "detectada"
);

// ── Su cajón completo, no a medias ──────────────────────────────────────────
const bloque =
  editor.match(
    /if \(selected\.dobleofertaupsell\) \{[\s\S]*?\n  \}\r?\n\r?\n  for \(const field of selectedFields\)/
  )?.[0] ?? "";
comprobar("el bloque de su cajón existe", bloque.length > 0, "sí");
for (const registro of [
  "modality_payment_profiles",
  "modality_pricing",
  "modality_templates",
]) {
  comprobar(
    `  trae ${registro}`,
    new RegExp(`"${registro}"`).test(bloque),
    "incluido"
  );
}
comprobar(
  "  y sus textos por canal",
  /canalImportado\.modality_templates\.doble_oferta_upsell/.test(bloque),
  "incluido"
);
comprobar(
  // Si tocara las otras, importar una modalidad pisaria las demas — que es
  // justo lo que las otras secciones evitan a propósito.
  "no toca las capas de las otras modalidades",
  !/order_bump|lineal:|bioferta:/.test(bloque),
  "hermético"
);

// ── No se enciende sola ─────────────────────────────────────────────────────
comprobar(
  "importarla NO enciende la modalidad en el destino",
  /selected\.dobleofertaupsell && isRecord\(next\.doble_oferta_upsell\)/.test(
    editor
  ) && /enabled: isRecord\(current\.doble_oferta_upsell\)/.test(editor),
  "conserva el destino"
);

console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} comprobación(es) mal.`);
process.exit(fallos === 0 ? 0 : 1);
