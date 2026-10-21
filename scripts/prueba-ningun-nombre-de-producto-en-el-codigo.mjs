// El codigo no puede saber como se llama tu producto.
//
// Esto es una PLANTILLA que se vende y que cambia de producto. Cada nombre real
// escrito en el codigo es una fuga de dos direcciones:
//
//   · hacia afuera — quien abra la plantilla lee el catalogo de otro negocio,
//     en los ejemplos de las casillas y en los comentarios;
//   · hacia adentro — y esta es la grave: habia una instruccion en el CEREBRO
//     que decia «nunca menciones "Pack 2 en 1"». Con otro producto esa frase no
//     significa nada, y encima le ensena al modelo el nombre de un negocio
//     ajeno. No falla con ruido: falla hablando raro.
//
// Se limpiaron 18 sitios: 4 ejemplos de casillas del editor, 1 instruccion del
// cerebro y 13 comentarios.
//
// LO QUE VIGILA ESTA PRUEBA
//
// Los nombres salen de TU configuracion, no de una lista escrita aqui: si
// manana cambias de producto, la prueba pasa a vigilar los nombres nuevos sola.
// Si alguno aparece en src/, se pone en rojo.
//
//   node scripts/prueba-ningun-nombre-de-producto-en-el-codigo.mjs
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const RAIZ = process.cwd();
const YAML = createRequire(join(RAIZ, "package.json"))("yaml");
const cfg = YAML.parse(readFileSync(join(RAIZ, "config", "intro-data.yaml"), "utf8"));

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 56)} ${valor}`);
};

// ── Las palabras de TUS productos ──────────────────────────────────────────
//
// De los nombres configurados se sacan las palabras propias. Se descartan las
// cortas y las genericas del comercio: «kit», «pack» o «curso» aparecen en
// cualquier texto y darian falsos positivos eternos.
// Palabras que el propio panel usa por su cuenta: «plantillas» son las de cada
// modalidad, «material» es lo que el bot entrega. Si un producto se llamara
// exactamente asi, esta prueba no podria distinguirlo — es el limite de la
// regla, y es preferible a ponerse roja cada dia por una palabra corriente.
const GENERICAS = new Set([
  "kit","pack","combo","curso","cursos","producto","productos","full","basico",
  "premium","completo","plan","planes","oferta","ofertas","super","mega","test",
  "opcion","opciones","nombre","digital","digitales","pdf","video","videos",
  "plantilla","plantillas","material","materiales","archivo","archivos",
  "imagen","imagenes","audio","documento","documentos","enlace","enlaces",
]);
// Los campos que SON el nombre de un producto, y solo esos. Mirando cualquier
// campo llamado «name» entraban los nombres de reglas, campos dinamicos y
// seguimientos —«respuesta», «saludo», «precio»— y la prueba se ponia roja por
// palabras que estan en el codigo por motivos legitimos.
const CAMPOS = [
  "product_name",
  "product_name_2",
  "order_bump.combo.name",
  "order_bump.basico.name",
  "doble_oferta_dos.combo.name",
  "doble_oferta_dos.basico.name",
  "doble_oferta_upsell.combo.name",
  "doble_oferta_upsell.basico.name",
  "doble_oferta_upsell.upsell.name",
  "upsell.name",
  "bioferta_doble.producto_a.name",
  "bioferta_doble.producto_b.name",
];
const enRuta = (raiz, ruta) =>
  ruta.split(".").reduce((n, k) => (n == null ? n : n[k]), raiz);
const nombres = [];
for (const campo of CAMPOS) {
  const valor = enRuta(cfg, campo);
  if (typeof valor === "string" && valor.trim()) nombres.push(valor);
  // Cada modalidad guarda ademas su propia copia; tambien cuentan.
  for (const plantilla of Object.values(cfg.modality_templates ?? {})) {
    const suyo = enRuta(plantilla, campo);
    if (typeof suyo === "string" && suyo.trim()) nombres.push(suyo);
  }
}

// LOS NOMBRES DE FABRICA NO SON TUS NOMBRES.
//
// Cuando una modalidad se crea vacia se le pone el nombre que trae la
// plantilla —«Producto principal», «Producto 2»—, y ese nombre esta en el
// codigo A PROPOSITO: es el valor al que cae todo mientras nadie configure
// nada. Al aparecer en el yaml, la prueba lo leia como un producto tuyo y
// senalaba `principal: b?.principal === true` en la ruta, que es un campo del
// codigo y no tiene nada que ver.
//
// Se comparan enteros, no por palabra: si mananas llamas a un producto
// «Producto principal de sublimacion», ese si es tuyo y si se vigila.
const DE_FABRICA = new Set([
  "producto principal",
  "producto 1",
  "producto 2",
  "producto upsell",
]);
const palabras = new Set();
for (const nombre of nombres) {
  if (nombre.includes("<<")) continue; // texto de muestra, no es un nombre
  if (DE_FABRICA.has(nombre.trim().toLowerCase())) continue;
  for (const palabra of nombre
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")) {
    if (palabra.length >= 6 && !GENERICAS.has(palabra)) palabras.add(palabra);
  }
}

comprobar(
  "hay nombres de producto configurados que vigilar",
  palabras.size > 0,
  `${palabras.size} palabra(s): ${[...palabras].slice(0, 6).join(", ")}`
);

// ── Y ninguna puede estar en el codigo ─────────────────────────────────────
const archivos = [];
(function recorrer(dir) {
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, entrada.name);
    if (entrada.isDirectory()) {
      if (!/node_modules|\.next|\.git/.test(ruta)) recorrer(ruta);
      continue;
    }
    if (/\.(ts|tsx)$/.test(entrada.name)) archivos.push(ruta);
  }
})(join(RAIZ, "src"));

const senalados = [];
for (const archivo of archivos) {
  const lineas = readFileSync(archivo, "utf8").split(/\r?\n/);
  lineas.forEach((linea, i) => {
    const limpia = linea
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Mn}/gu, "");
    for (const palabra of palabras) {
      if (new RegExp(`\\b${palabra}\\b`).test(limpia)) {
        senalados.push(
          `${archivo.replace(RAIZ + "\\", "").replace(RAIZ + "/", "")}:${i + 1} → ${palabra}`
        );
        break;
      }
    }
  });
}

comprobar(
  "ningun nombre de tus productos esta en el codigo",
  senalados.length === 0,
  senalados.length ? senalados.slice(0, 4).join(" · ") : "src/ limpio"
);

// ── Y el cerebro no nombra productos concretos ─────────────────────────────
const cerebro = readFileSync(join(RAIZ, "src", "lib", "openrouter.ts"), "utf8");
comprobar(
  // Aqui vivia «Never mention "Pack 2 en 1"». Ahora la regla dice lo que quiere
  // decir —que en esa modalidad solo existen las dos opciones— sin nombrar nada.
  "la regla de las dos opciones no nombra ninguna",
  /Never mention a pack, a bundle, a complementary product or any third option/.test(
    cerebro
  ),
  "generica"
);

console.log(
  fallos === 0
    ? "\nTODO OK — el codigo no sabe como se llaman tus productos, y asi debe ser"
    : `\n${fallos} FALLA(S)`
);
process.exit(fallos === 0 ? 0 : 1);
