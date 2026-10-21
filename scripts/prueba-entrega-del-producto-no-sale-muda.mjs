// La entrega de un producto de la biblioteca tiene que SALIR, y el interruptor
// del canal tiene que apagar de verdad.
//
// LOS DOS FALLOS, VISTOS VENDIENDO
//
//   Primera compra: con «Entrega pago aprobado» APAGADO en Canales, al cliente
//   le llego igual el enlace viejo.
//
//   Segunda compra: con el grupo del upsell apagado, el bot se quedo MUDO. Ni
//   entrego ni dijo nada. El comprobante se quedo ahi.
//
// POR QUE PASABA CADA UNO
//
//   1. `content.delivery` es el campo de antes de que existieran los grupos, y
//      se habia dejado como respaldo. Apagar el grupo caia a ese campo, que
//      sigue guardando la entrega del producto que se vendia entonces. El
//      interruptor no apagaba nada: cambiaba una entrega vieja por otra.
//
//   2. La biblioteca se guardaba TAL CUAL venia de la pantalla. La pantalla usa
//      `texts` y el motor lee `body_variants`, asi que el motor encontraba la
//      burbuja y no encontraba el texto: mandaba un mensaje vacio. En el
//      registro se ve «entrega programada (1 pasos activos)» y «enviando step
//      0», y al cliente no le llega nada. Sin error en ningun sitio.
//
// LO QUE NO PUEDE VOLVER A PASAR
//
//   1. Que una burbuja de producto se guarde en un formato que el motor no lee.
//   2. Que apagar un grupo del canal reviva la entrega de antes.
//   3. Que al abrir el editor se pierdan las entregas ya escritas con el
//      formato malo: se leen igual, o se borrarian en el primer guardado.
//
//   node scripts/prueba-entrega-del-producto-no-sale-muda.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");
const api = leer("src", "app", "api", "workflow", "route.ts");
const motor = leer("src", "lib", "workflow", "config.ts");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// -- 1. SE GUARDA COMO LO LEE EL MOTOR ---------------------------------------
//
// Es el MISMO `writeStep` que usan la intro, los seguimientos y las demas
// entregas. Una sola traduccion para todo el archivo: con dos, una se queda
// vieja y nadie se entera hasta que un cliente paga.
comprobar(
  "la entrega del producto se traduce al guardar",
  /\(producto\.delivery as EditorStep\[\]\)\.map\(writeStep\)/.test(api),
  "writeStep, como todas"
);
comprobar(
  "y se traduce al leer",
  /\(item\.delivery as Record<string, unknown>\[\]\)\.map\(readStep\)/.test(api),
  "readStep, como todas"
);

// -- 2. LAS QUE YA ESTAN ESCRITAS MAL SE RESCATAN -----------------------------
//
// Si `readStep` no las reconociera, el editor las enseñaria vacias y el primer
// guardado se las llevaria. Perder la entrega de un producto es perder el
// enlace que recibe quien paga.
comprobar(
  "una burbuja guardada con el formato viejo se lee igual",
  /: strList\(s\?\.texts\),/.test(api),
  "no se pierde"
);
// Y EN ESE ORDEN: primero lo del motor, y `texts` como ultimo recurso. Al reves,
// una burbuja con los dos campos se leeria por el equivocado.
comprobar(
  "y el formato del motor manda sobre el viejo",
  api.indexOf("Array.isArray(s?.body_variants)") <
    api.indexOf(": strList(s?.texts),"),
  "primero body_variants"
);

// -- 2-BIS. Y EL MOTOR TAMBIEN LAS TRADUCE ------------------------------------
//
// Arreglarlo solo al guardar no basta: el motor lee el archivo TAL COMO ESTA, y
// los archivos ya escritos con `texts` seguirian mudos hasta que a alguien se le
// ocurra abrir cada producto y guardarlo. Eso no se puede pedir: la entrega
// muda no avisa, se descubre cuando un cliente que ya pago reclama.
comprobar(
  "el motor traduce la entrega de la ficha al leerla",
  /const burbujasDelProducto = \(/.test(motor),
  "sin volver a guardar"
);
for (const sitio of [
  ["las cajas de opción", /delivery: burbujasDelProducto\(producto\?\.delivery\)/],
  [
    "la entrega general",
    /next\.payment_approved_sequence = burbujasDelProducto\(unico\?\.delivery\)/,
  ],
  ["la etapa del upsell", /delivery: burbujasDelProducto\(upsell\?\.delivery\)/],
]) {
  comprobar(`${sitio[0]} pasa por la traducción`, sitio[1].test(motor), "todas");
}
// Y NO PISA LO QUE YA ESTA BIEN: una burbuja ya traducida se queda como esta.
comprobar(
  "una burbuja ya traducida no se toca",
  /if \(yaTiene\.length > 0\) return paso;/.test(motor),
  "solo rellena lo que falta"
);

// -- 3. APAGAR EL GRUPO APAGA DE VERDAD ---------------------------------------
comprobar(
  "si el canal usa grupos, el campo viejo no manda",
  /const usaGrupos =\s*\r?\n?\s*Array\.isArray\(content\.delivery_groups\) && content\.delivery_groups\.length > 0;/.test(
    motor
  ) && /\(usaGrupos \? undefined : content\.delivery\)/.test(motor),
  "el interruptor sirve"
);
// PERO EL RESPALDO NO SE BORRA: los canales que nunca tuvieron grupos siguen
// entregando por su campo de siempre. Quitarlo los dejaria sin entrega.
comprobar(
  "y el canal sin grupos conserva su entrega de siempre",
  /content\.delivery/.test(motor),
  "nadie se queda sin"
);

console.log(
  fallos === 0
    ? "\nTODO OK — la entrega del producto sale, y el interruptor apaga"
    : `\n${fallos} FALLO(S)`
);
process.exit(fallos === 0 ? 0 : 1);
