// Escribias {{PRECIO_FULL}} y salia el precio del BASE.
//
// El nombre ya estaba ocupado. En este proyecto "full" queria decir *precio
// completo* -- el precio con su moneda -- y asi estaba escrito en cuatro
// listas de alias. Cuando {{PRECIO_FULL}} paso a ser el precio del producto
// FULL, quedaron dos significados para el mismo nombre, y ganaba el que corria
// primero: en la vista previa, el viejo. El mensaje real salia bien y el visor
// mentia, que es la peor de las dos.
//
// POR QUE NO LO CAZO LA PRUEBA ANTERIOR
//
// La de "visor y motor dicen lo mismo" comprueba que un comodin este resuelto
// en los dos lados. Estaba: en los dos lados. Con significados distintos. Una
// prueba que mira presencia no ve una colision de sentido.
//
// LO QUE VIGILA ESTA
//
// Que los nombres de producto y precio esten en UNA sola lista de alias por
// archivo. Si alguien vuelve a meter "precio_full" dentro del grupo de
// "precio_completo", esto se pone en rojo.
//
// Y hay CUATRO renderizadores, no dos: el motor, el del order bump, el emisor y
// la vista previa del editor. Un comodin nuevo tiene que existir en todos, o
// saldra crudo por la ruta que no lo tenga.
//
//   node scripts/prueba-un-comodin-un-solo-significado.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");

const ARCHIVOS = {
  "el motor": leer("src", "lib", "workflow", "engine.ts"),
  "el order bump": leer("src", "lib", "workflow", "config.ts"),
  "el emisor": leer("src", "lib", "workflow", "sender.ts"),
  "la vista previa": leer("src", "app", "editor", "page.tsx"),
};

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 56)} ${valor}`);
};

// ── 1. Ningun archivo mete "precio_full" en el grupo del precio completo ────
for (const [nombre, texto] of Object.entries(ARCHIVOS)) {
  comprobar(
    `${nombre} no confunde precio_full con precio_completo`,
    !/precio_completo\|precio_full|precio_full\|precio_completo/i.test(texto),
    "un solo significado"
  );
}

// ── 2. Los tres precios se resuelven en los cuatro renderizadores ───────────
//
// Si uno falta, por esa ruta el comodin sale crudo al cliente.
const PRECIOS = [
  ["el precio del full", /\(precio_full\|precio_combo\)/],
  ["el precio del base", /\(precio_base\|precio_basico\)/],
  ["el precio del extra", /\(precio_upsell\|precio_upsell_solo/],
];
for (const [que, patron] of PRECIOS) {
  const donde = Object.entries(ARCHIVOS).filter(([, t]) => patron.test(t));
  // El emisor los resuelve llamando al del order bump, no con su propia linea.
  const suficientes =
    donde.length >= 3 ||
    (donde.length >= 2 && ARCHIVOS["el emisor"].includes("renderOrderBumpTemplate("));
  comprobar(
    `${que} se resuelve en todos los renderizadores`,
    suficientes,
    donde.map(([n]) => n).join(", ") || "EN NINGUNO"
  );
}

// ── 2-bis. Cada precio sale de SU dato, no del de al lado ──────────────────
//
// Comprobar que un comodin "esta resuelto" no basta: {{PRECIO_FULL}} estaba
// resuelto, y devolvia el precio del base. Aqui se ata cada uno a su origen.
const visor = ARCHIVOS["la vista previa"];
const ORIGENES = [
  ["el full en el visor", /precio_full\|precio_combo\)[\s\S]{0,120}resolvedComboPrice/],
  ["el base en el visor", /precio_base\|precio_basico\)[\s\S]{0,120}resolvedBasicoPrice/],
  ["el extra en el visor", /precio_upsell\|precio_upsell_solo[\s\S]{0,140}upsellPrice/],
];
for (const [que, patron] of ORIGENES) {
  comprobar(`${que} sale de su propio precio`, patron.test(visor), "sin cruzarse");
}
const motor = ARCHIVOS["el order bump"];
comprobar(
  "el full en el bot sale del precio del combo",
  /precio_full\|precio_combo\)[\s\S]{0,140}conEstilo\(comboPrice/.test(motor),
  "comboPrice"
);
comprobar(
  "el base en el bot sale del precio del basico",
  /precio_base\|precio_basico\)[\s\S]{0,140}conEstilo\(basicoPrice/.test(motor),
  "basicoPrice"
);

// ── 2-ter. Las textareas de datos de pago usan el contexto completo ────────
//
// Si esa pantalla armara su propio contexto a mano, los valores nuevos
// faltarian y sus vistas previas dirian "sin configurar" con el dato puesto.
comprobar(
  "las textareas de datos de pago usan el contexto completo",
  /const methodPreviewContext = previewContextFromConfig\(cfg, selectedCountry\);/.test(
    visor
  ) && /previewContext=\{methodPreviewContext\}/.test(visor),
  "el mismo que el resto del visor"
);

// ── 3. El emisor sigue llamando al renderizador de las dos opciones ─────────
//
// Es lo que hace que {{OPCION_1}}, {{PRECIO_FULL}} y compañia lleguen bien al
// cliente por la ruta del emisor. Si alguien quita esa llamada, esos comodines
// salen crudos y nadie se entera hasta que un cliente lo lee.
comprobar(
  "el emisor pasa el texto por el renderizador de las opciones",
  /return renderOrderBumpTemplate\(withInserts, discountActive, convo\.phone\)/.test(
    ARCHIVOS["el emisor"]
  ),
  "lo llama primero"
);

// ── 4. Y lo hace ANTES de sus propios reemplazos ────────────────────────────
const emisor = ARCHIVOS["el emisor"];
comprobar(
  "y lo hace antes que sus alias de precio",
  emisor.indexOf("return renderOrderBumpTemplate(") <
    emisor.indexOf("precio_completo|precio_label"),
  "orden correcto"
);

console.log(
  fallos === 0
    ? "\nTODO OK — cada comodin significa una sola cosa en los cuatro sitios"
    : `\n${fallos} FALLA(S)`
);
process.exit(fallos === 0 ? 0 : 1);
