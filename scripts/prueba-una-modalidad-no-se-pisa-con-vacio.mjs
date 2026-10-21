// El contenido guardado de una modalidad no se puede pisar con NADA.
//
// EL ENGRANAJE QUE ESTABA SUELTO
//
// Cada modalidad guarda su propio contenido en `modality_templates`. Al cambiar
// de una a otra, lo que hay en pantalla se guarda en la plantilla de la que se
// deja. Bien… mientras lo que hay en pantalla sea de verdad lo de esa
// modalidad.
//
// Pero CUAL se esta editando se recuerda en el navegador, aparte de cual esta
// vendiendo el bot. Cuando las dos no coinciden —otro navegador, una pantalla a
// medio cargar, encender la modalidad desde otro sitio— la pantalla puede estar
// en blanco mientras el editor cree que edita una modalidad que si tenia
// contenido. Y guarda ese blanco encima.
//
// Eso borro el trabajo de Alberto: la plantilla de «doble_oferta_upsell» paso
// de tener producto, galeria y contenido a no tener nada, mientras las otras
// cuatro quedaron intactas. Un solo guardado.
//
// LA REGLA
//
// El contenido guardado de una modalidad puede cambiarse por OTRO contenido,
// pero nunca por NADA. Si lo que se va a guardar esta vacio y lo que habia
// tenia algo, se conserva lo que habia.
//
// No estorba en lo legitimo: vaciar una modalidad a mano se hace campo por
// campo, y esos cambios si se guardan. Lo que no se guarda es el blanco de
// golpe, que nunca es algo que alguien quiera.
//
//   node scripts/prueba-una-modalidad-no-se-pisa-con-vacio.mjs
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

// ── Las funciones reales ────────────────────────────────────────────────────
const trozo = (nombre) => {
  const desde = editor.indexOf(`function ${nombre}`);
  const crlf = editor.indexOf("\r\n}\r\n", desde);
  const hasta = crlf >= 0 ? crlf : editor.indexOf("\n}\n", desde);
  return editor.slice(desde, hasta + 5);
};
const limpiar = (t) =>
  t
    .replace(/: ModalidadTemplateEditor \| undefined/g, "")
    .replace(/: ModalidadTemplateEditor/g, "")
    .replace(/: unknown/g, "")
    .replace(/: number/g, "")
    .replace(/<number>/g, "")
    .replace(/ as Record<string, unknown>/g, "")
    .replace(/ as ModalidadTemplateEditor/g, "");

const pesoDeLaPlantilla = new Function(
  "return " + limpiar(trozo("pesoDeLaPlantilla"))
)();
const noPisarConVacio = new Function(
  "pesoDeLaPlantilla",
  "return " + limpiar(trozo("noPisarConVacio"))
)(pesoDeLaPlantilla);

// ── El peso ─────────────────────────────────────────────────────────────────
const conTodo = {
  title: "Doble Oferta + Upsell",
  product_name: "SUPER KIT FLORES DE PAPEL",
  course_content: "📚 Kit Completo…",
  image_gallery: [{ topic: "IMAGEN SUPER KIT" }],
  intro_sequence: [{ body: "hola" }],
};
const enBlanco = {
  title: "Doble Oferta + Upsell",
  product_name: "",
  course_content: "",
  image_gallery: [],
  intro_sequence: [],
};

comprobar("una plantilla con contenido pesa", pesoDeLaPlantilla(conTodo) > 0, `${pesoDeLaPlantilla(conTodo)}`);
comprobar(
  // Si el titulo contara, una plantilla en blanco pareceria llena y el seguro
  // no saltaria nunca. El titulo lo pone el editor solo.
  "una en blanco pesa CERO aunque tenga título",
  pesoDeLaPlantilla(enBlanco) === 0,
  "0"
);
comprobar("y una que no existe, cero", pesoDeLaPlantilla(undefined) === 0, "0");
comprobar(
  "pasos existentes pero vacíos también pesan cero",
  pesoDeLaPlantilla({ intro_sequence: [{ body: "" }, { body: "   " }] }) === 0,
  "0"
);

// ── La regla ────────────────────────────────────────────────────────────────
comprobar(
  // ESTE es el desastre que ocurrió, exacto.
  "lo lleno NO se pisa con lo vacío",
  noPisarConVacio(conTodo, enBlanco) === conTodo,
  "se conserva"
);
comprobar(
  // Y esto es trabajo normal: no puede estorbar.
  "lo lleno SÍ se cambia por otro contenido",
  noPisarConVacio(conTodo, { ...conTodo, product_name: "OTRO KIT" }).product_name ===
    "OTRO KIT",
  "se guarda"
);
comprobar(
  "una modalidad que estaba vacía se puede llenar",
  noPisarConVacio(enBlanco, conTodo) === conTodo,
  "se guarda"
);
comprobar(
  "y una que nunca existió también",
  noPisarConVacio(undefined, conTodo) === conTodo,
  "se guarda"
);
comprobar(
  "vacía sobre vacía no rompe nada",
  noPisarConVacio(enBlanco, enBlanco) === enBlanco,
  "sin ruido"
);

// ── Los sitios donde se guarda una plantilla ────────────────────────────────
//
// Eran tres. El de CAMBIAR de modalidad ya no existe: cambiar de modalidad se
// hace recargando la pagina, asi que no se escribe ninguna plantilla al hacerlo
// (ver prueba-la-puerta-de-modalidad). Lo que se vigila ahora es que no haya
// vuelto: si alguien repone aquel camino, esto se pone rojo.
comprobar(
  "cambiar de modalidad ya no escribe plantillas",
  !/function switchModalidad\(/.test(editor) &&
    /window\.location\.reload\(\)/.test(editor),
  "se recarga, no se mezcla"
);
comprobar(
  // El tercer sitio. Estaba sin el seguro: activar otra modalidad podia dejar en
  // blanco la plantilla de la que estabas editando.
  "al ACTIVAR una modalidad se aplica la regla",
  /\[editingMode\]: noPisarConVacio\(\s*\r?\n\s*cfg\.modality_templates\?\.\[editingMode\],/.test(
    editor
  ),
  "protegido"
);
comprobar(
  // Aqui es donde de verdad se perdio el trabajo.
  "y al GUARDAR también",
  /\[_editingMode\]: noPisarConVacio\(\s*\r?\n\s*cfg\.modality_templates\?\.\[_editingMode\],/.test(
    editor
  ),
  "protegido"
);
// TODA escritura de plantilla pasa por la regla. Se cuenta: cada sitio que
// sincroniza una plantilla desde los campos de arriba tiene que ir envuelto en
// `noPisarConVacio`. Si aparece uno suelto, aquí se ve.
const sincronizaciones = (
  editor.match(/\.\.\.templateFromCfg\(cfg, \w+\)/g) ?? []
).length;
const protegidas = (editor.match(/noPisarConVacio\(/g) ?? []).length - 1; // -1: su definición
comprobar(
  "no queda ningún sitio escribiendo la plantilla sin la regla",
  sincronizaciones > 0 && protegidas >= sincronizaciones,
  `${sincronizaciones} sitio(s), ${protegidas} protegido(s)`
);

console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} comprobación(es) mal.`);
process.exit(fallos === 0 ? 0 : 1);
