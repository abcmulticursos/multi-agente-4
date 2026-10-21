// Dos herramientas que faltaban en el editor.
//
// 1. NO SE PODIA QUITAR UN PRODUCTO DE LA LISTA.
//
// El selector de Producto tenia «+ Copiar», «Nombre» y «Exportar». Para guardar
// una copia ya estaba «Exportar JSON» en la barra de al lado, asi que ese boton
// duplicaba algo que ya existia; y en cambio no habia NINGUNA forma de quitar
// un producto de prueba. Se acumulaban en el desplegable.
//
// «Eliminar» ARCHIVA: desaparece de la lista —que es lo que se busca— pero su
// configuracion entera se queda guardada. Un clic no puede borrar meses de
// trabajo sin retorno.
//
// 2. EL SEGUIMIENTO ORIGINAL NO SE PODIA APAGAR.
//
// Cada variante tenia su ON/OFF. El original —«Mensajes principales»— no. El
// unico interruptor que habia, el de la cabecera del cajon, apaga el
// seguimiento ENTERO, variantes incluidas. Asi que para probar una variante
// sola habia que vaciar el original a mano y volver a escribirlo despues.
//
//   node scripts/prueba-eliminar-producto-y-apagar-el-original.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");
const editor = leer("src", "app", "editor", "page.tsx");
const motor = leer("src", "lib", "workflow", "engine.ts");
const tipos = leer("src", "lib", "workflow", "config.ts");
const ruta = leer("src", "app", "api", "workflow", "route.ts");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// ── 1. Eliminar producto ───────────────────────────────────────────────────
comprobar(
  "el boton de la barra dice Eliminar",
  /onClick=\{\(\) => void deleteActiveProductProfile\(\)\}/.test(editor) &&
    />\s*Eliminar\s*</.test(editor),
  "en vez de Exportar"
);
comprobar(
  // Sin confirmacion, un clic de mas en una barra apretada se lleva el producto.
  "pide confirmacion antes de tocar nada",
  /const confirmado = window\.confirm\(/.test(editor) &&
    /if \(!confirmado\) return;/.test(editor),
  "con seguro"
);
comprobar(
  // Archivar y no borrar: la configuracion sigue en disco.
  "archiva en vez de borrar del disco",
  /action: "archive", id: activo\.id/.test(editor),
  "reversible"
);
comprobar(
  // El servidor RECHAZA archivar el producto activo. Sin activar otro antes, el
  // boton fallaria siempre con un error que no explica nada.
  "activa otro producto antes de archivar el activo",
  editor.indexOf('action: "activate", id: relevo.id') <
    editor.indexOf('action: "archive", id: activo.id'),
  "en ese orden"
);
comprobar(
  // Quedarse sin ninguno dejaria al bot sin nada que vender.
  "no deja eliminar el ultimo producto",
  /if \(vivos\.length <= 1\)/.test(editor),
  "avisa y no lo hace"
);
comprobar(
  "y no queda la funcion de exportar sin quien la llame",
  !/async function exportActiveProductProfile\(/.test(editor),
  "sin codigo muerto"
);

// ── 2. Apagar los «Mensajes principales» ───────────────────────────────────
comprobar(
  "el campo existe en el tipo del motor",
  /steps_enabled\?: boolean;/.test(tipos),
  "steps_enabled"
);
comprobar(
  // ESTE es el arreglo: sin la guarda, el original entra al sorteo siempre.
  "el motor deja fuera el original cuando esta apagado",
  /seq\.steps_enabled !== false &&\s*\r?\n\s*base\.steps\.length > 0/.test(motor),
  "no entra al sorteo"
);
comprobar(
  "las variantes conservan su propio interruptor",
  /variant\.enabled !== false &&/.test(motor),
  "intacto"
);
// EL «ORIGINAL» YA NO ES UNA PESTANA APARTE, Y ESTAS DOS SE MIDEN DONDE VIVE
// AHORA.
//
// El 15 de septiembre de 2026 el dueno pidio que «Mensajes principales» dejara
// de ser especial: su contenido bajo a la lista como CAJON 1 —ver
// `prueba-el-seguimiento-es-una-sola-lista`— y el hueco viejo quedo vacio y
// apagado. Asi que ya no hay un interruptor `steps_enabled` en pantalla.
//
// Lo que estas dos protegian sigue siendo lo mismo, y sigue en pie: que cada
// cajon tenga SU interruptor, y que apagarlo no cierre el cajon de paso. Solo
// que ahora el cajon 1 es un cajon como los demas.
comprobar(
  "cada cajón del seguimiento tiene su ON/OFF en la cabecera",
  /queEs=\{`este cajón del \$\{followup\.name \|\| "seguimiento"\}`\}/.test(
    editor
  ),
  "CirculoDeEncendido en headerActions"
);
comprobar(
  "y apagarlo no cierra el cajon de paso",
  // `CirculoDeEncendido` corta el clic por dentro, que es como lo hacen todos
  // los cajones de la pantalla desde que existe.
  /function CirculoDeEncendido\(/.test(editor) &&
    /stopPropagation\(\)/.test(editor),
  "el clic no llega a la cabecera"
);
comprobar(
  "y el hueco viejo del original queda muerto",
  /steps: \[\],\s*\r?\n\s*steps_enabled: false,/.test(editor),
  "no puede volver al sorteo"
);

// ── 3. Que el guardado no se lo coma ───────────────────────────────────────
//
// La ruta filtra campo por campo: uno que no este en la lista se descarta al
// guardar. El interruptor se veria puesto y al recargar volveria a encendido.
const lecturas = (ruta.match(/steps_enabled: f\?\.steps_enabled !== false/g) ?? [])
  .length;
const escrituras = (
  ruta.match(/f\?\.steps_enabled === false \? \{ steps_enabled: false \}/g) ?? []
).length;
comprobar(
  "la ruta lo lee en sus dos sitios",
  lecturas >= 2,
  `${lecturas} lecturas`
);
comprobar(
  "y lo escribe en los dos suyos",
  escrituras >= 2,
  `${escrituras} escrituras`
);
comprobar(
  // Solo se anota cuando esta APAGADO: asi el YAML no se llena de lineas que
  // dicen lo que ya es por defecto.
  "solo lo anota cuando esta apagado",
  !/steps_enabled: true/.test(ruta),
  "YAML limpio"
);

console.log(
  fallos === 0
    ? "\nTODO OK — se puede eliminar un producto y apagar el seguimiento original"
    : `\n${fallos} FALLA(S)`
);
process.exit(fallos === 0 ? 0 : 1);
