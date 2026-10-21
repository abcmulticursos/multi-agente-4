// El orden del menú es el del trabajo: primero se llenan los productos.
//
// Las pestañas de modalidad —Order Bump, Doble Oferta, Upsell— estaban al final
// del menú, DETRÁS de Precios y pagos, Entrega y Regalo. Para escribir lo que se
// vende había que saltar al final, y para ponerle precio volver al principio.
//
// Ahora van justo después de Contenido, así que el menú se lee de izquierda a
// derecha en el orden en que se trabaja:
//
//   Contenido · <lo que vendes> · Precios y pagos · Canales · Entrega · Regalo ·
//   Cerebro · Ajustes
//
// Y CANALES BAJÓ DETRÁS DE PRECIOS.
//
// Estaba entre Usuario y Contenido, o sea en mitad de lo que se llena primero.
// Canales es POR DÓNDE entra la gente, y eso se decide cuando lo de vender ya
// está escrito.
//
// LO QUE VIGILA ESTA PRUEBA
//
//   1. Las pestañas de modalidad van ANTES de Precios y pagos.
//   2. El resultado por modalidad es exactamente el pedido.
//   3. La «Interfaz nueva» ya no tiene entrada, y nadie se queda encerrado en
//      ella por haberla dejado puesta.
//   4. Su código sigue entero, para poder devolverla sin reescribir nada.
//
//   node scripts/prueba-orden-del-menu.mjs
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

// ── El orden real, leído del código ──────────────────────────────────────────
//
// EL ORDEN VIVE EN UN SOLO SITIO. Estaba escrito DENTRO del menú de arriba, así
// que la barra de la izquierda no podía llevar lo mismo: tenía su propia
// agrupación en cinco sitios, con otro orden y con «usuario» fuera de todos
// ellos, o sea inalcanzable desde la barra. Ahora las dos leen esta lista.
const bloque = (() => {
  const i = editor.indexOf("const ORDEN_DE_TABS: Tab[] = [");
  const f = editor.indexOf("];", i);
  return i < 0 || f < 0 ? "" : editor.slice(i, f);
})();
comprobar("se encuentra la lista de pestañas", bloque.length > 0, `${bloque.length} car.`);
// Se busca cada pestaña por su nombre y se ordenan por dónde aparecen. Contar
// corchetes fallaba con las entradas de varias líneas (la que cambia de etiqueta
// según la modalidad), y una pestaña que no se encuentra no se puede vigilar.
const TABS = [
  "intro", "seguimientos", "salesbot", "canales", "contenido", "bioferta",
  "orderbump", "dobleoferta2", "upsell", "pago", "entrega", "regalo",
  "cerebro", "ajustes",
];
const orden = TABS.map((t) => [t, bloque.indexOf(`"${t}"`)])
  .filter(([, i]) => i >= 0)
  .sort((a, b) => a[1] - b[1])
  .map(([t]) => t);
comprobar(
  "se encuentran las 14 pestañas",
  orden.length === TABS.length,
  `${orden.length} de ${TABS.length}`
);
console.log(`\n     orden: ${orden.join(" · ")}\n`);

const antes = (a, b) => orden.indexOf(a) >= 0 && orden.indexOf(a) < orden.indexOf(b);
for (const modalidad of ["bioferta", "orderbump", "dobleoferta2", "upsell"]) {
  comprobar(
    `«${modalidad}» va antes de Precios y pagos`,
    antes(modalidad, "pago"),
    `${orden.indexOf(modalidad)} < ${orden.indexOf("pago")}`
  );
  comprobar(
    `y después de Contenido`,
    antes("contenido", modalidad),
    `${orden.indexOf("contenido")} < ${orden.indexOf(modalidad)}`
  );
}
for (const [a, b] of [
  ["contenido", "pago"],
  ["pago", "canales"],
  ["canales", "entrega"],
  ["entrega", "regalo"],
  ["regalo", "cerebro"],
  ["cerebro", "ajustes"],
]) {
  comprobar(`«${a}» va antes de «${b}»`, antes(a, b), "el orden del trabajo");
}

// ── El resultado por modalidad, tal como lo verá ─────────────────────────────
//
// Se filtran las de modalidad que no tocan y las «bases» (que van escondidas
// tras el botón «Mostrar bases»).
const BASES = new Set(["intro", "seguimientos", "salesbot"]);
// «upsell» YA NO ES UNA PESTAÑA DE MODALIDAD.
//
// La etapa del segundo producto dejó de ser de dos modalidades y pasó a ser de
// la que la tenga llena, así que su pestaña se ve en TODAS: en las que no la
// usan sale vacía y apagada, que es donde se enciende. Tenerla aquí la escondía
// de Lineal y de Order Bump, y el menú de esas dos salía sin ella.
const DE_MODALIDAD = {
  bioferta: "bioferta",
  orderbump: "order_bump",
  dobleoferta2: "doble_oferta_dos",
};
const menuDe = (modo) =>
  orden.filter((t) => {
    if (BASES.has(t)) return false;
    const suya = DE_MODALIDAD[t];
    if (!suya) return true;
    if (modo === "doble_oferta_upsell") return t === "dobleoferta2" || t === "upsell";
    return suya === modo;
  });

const ESPERADO = {
  order_bump: ["contenido", "orderbump", "upsell", "pago", "canales", "entrega", "regalo", "cerebro", "ajustes"],
  doble_oferta_upsell: ["contenido", "dobleoferta2", "upsell", "pago", "canales", "entrega", "regalo", "cerebro", "ajustes"],
  lineal: ["contenido", "upsell", "pago", "canales", "entrega", "regalo", "cerebro", "ajustes"],
};
for (const [modo, esperado] of Object.entries(ESPERADO)) {
  const real = menuDe(modo);
  comprobar(
    `menú de ${modo}`,
    real.join("|") === esperado.join("|"),
    real.join(" · ")
  );
}

// ── El menú lateral: se entra y se sale ─────────────────────────────────────
//
// El boton de entrada se habia retirado, y el unico control que quedaba era el
// de SALIR, dentro de la propia barra: una puerta que solo abre desde dentro.
// La vista existia entera y no habia forma de llegar a ella.
// EL MISMO BOTON ENCIENDE Y APAGA. Solo encendia: con el menu lateral puesto,
// volver a tocarlo no hacia nada y parecia roto. Un boton que se queda en
// pantalla despues de pulsarlo tiene que deshacer lo que hizo.
comprobar(
  "hay entrada al menú lateral",
  /☰ Menú lateral/.test(editor) &&
    /onClick=\{\(\) => cambiarVista\(!vistaNueva\)\}/.test(editor),
  "con botón"
);
comprobar(
  // Mientras no hubo entrada, el recuerdo se BORRABA en cada carga, para que
  // quien la tuviera puesta no se quedara encerrado. Con el boton ya se puede
  // recordar: se entra donde se dejo.
  "y se recuerda la vista elegida",
  /setVistaNueva\(localStorage\.getItem\(EDITOR_VISTA_STORAGE_KEY\) === "nueva"\);/.test(
    editor
  ) && !/localStorage\.removeItem\(EDITOR_VISTA_STORAGE_KEY\)/.test(editor),
  "nadie se queda encerrado"
);
// LOS DOS MENUS ERAN UNO SOLO MAL CONTADO.
//
// La barra izquierda tenia cinco grupos inventados solo para ella, con su
// propio orden y sus propios nombres. Dos menus para lo mismo terminan
// discrepando, y este ya habia discrepado: «Usuario» no pertenecia a ninguno de
// los cinco, asi que con la barra encendida no aparecia en ninguna parte.
comprobar(
  "ya no hay un segundo menú aparte",
  !/^const LUGARES: \{/m.test(editor) && !/LUGARES\.map\(/.test(editor),
  "una sola lista"
);
comprobar(
  "y la barra lee la misma lista que el menú de arriba",
  /ORDEN_DE_TABS\.filter\(\(t\) => tabsVisibles\.has\(t\)\)/.test(editor) &&
    /ORDEN_DE_TABS\.filter\(\(key\) => tabsVisibles\.has\(key\)\)/.test(editor),
  "sin copias"
);

console.log(`\n${fallos === 0 ? "TODO OK — el menú va en el orden del trabajo" : `${fallos} FALLOS`}`);
process.exit(fallos === 0 ? 0 : 1);
