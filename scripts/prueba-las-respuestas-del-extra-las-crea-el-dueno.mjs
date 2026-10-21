// Las respuestas del segundo producto: las crea el dueño, y salen siempre.
//
// TRES COSAS QUE ERAN LA MISMA
//
// 1. TRES CHAPAS FIJAS QUE NADIE PIDIO
//
//    El panel del precio del extra traia tres respuestas escritas en el editor:
//    «Yape / Plin», «Transferencia» y «Efectivo». Dos cosas mal a la vez:
//
//      · Este bot es una PLANTILLA. Esos tres son los metodos de un negocio
//        concreto de un pais concreto. Otro negocio abre el panel y ve tres
//        nombres que no son suyos y que no puede tocar.
//      · Y no se podia elegir nada: ni crear una, ni borrarla, ni decidir a que
//        metodo contesta.
//
//    Ahora la lista sale de SUS metodos de pago —los mismos que se editan
//    arriba y los mismos que rutea el motor— y las respuestas se agregan una a
//    una, se duplican, se borran y se cambian de metodo.
//
// 2. LA VISTA PREVIA SE QUEDABA ARRIBA
//
//    Es `position: sticky`, y sticky NO FUNCIONA si algun padre lleva
//    `overflow: hidden`. No da error: simplemente deja de pegarse. Las dos
//    ventanas lo llevaban solo para redondear esquinas, y a cambio la previa se
//    iba de pantalla en cuanto el editor de burbujas crecia a lo alto — justo
//    cuando mas falta hace verla.
//
// 3. ACEPTAR HABLANDO CON EL MODELO SE SALTABA LO ESCRITO
//
//    Hay cuatro puertas para aceptar el extra: el boton, su nombre escrito, el
//    «si» a secas y el marcador <<QUIERE_EXTRA>> del modelo. Las tres primeras
//    pasan por el cuadrito de la oferta y mandan lo que el operador escribio.
//    La cuarta llamaba directo a los datos de fabrica.
//
//    Lo que se veia: el dueño escribe sus burbujas —con SU cuenta y el nombre
//    del extra— y a quien acepta hablando con el modelo le llegan las de
//    siempre, que hablan del producto que YA compro («puedes adquirir el
//    curso…»). El mismo trabajo escrito y tirado segun por donde entrara el si.
//
//   node scripts/prueba-las-respuestas-del-extra-las-crea-el-dueno.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");
const editor = leer("src", "app", "editor", "page.tsx");
const motor = leer("src", "lib", "workflow", "engine.ts");
const manejador = leer("src", "lib", "meta", "handler.ts");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 60)} ${valor}`);
};

// ── 1. Ni un nombre de metodo escrito en el editor ───────────────────────────
const panel = (() => {
  const i = editor.indexOf("function RespuestasDelUpsell(");
  return i < 0 ? "" : editor.slice(i, i + 11000);
})();
comprobar(
  "el panel existe",
  panel.length > 0,
  "RespuestasDelUpsell"
);
// Esto es lo que se rompio: una lista de marcas escrita a mano dentro de una
// plantilla que se instala para otros negocios.
comprobar(
  "no hay ningun metodo de pago escrito en el editor",
  !/\{ method: "yape", label: "Yape \/ Plin" \}/.test(editor) &&
    !/\{ method: "bcp_transferencia", label: "Transferencia" \}/.test(editor),
  "ni Yape, ni BCP, ni Efectivo"
);
// Salen de los suyos, por pais, que son los que el motor rutea.
comprobar(
  "la lista sale de sus metodos de pago de este pais",
  /const metodosDeEstePais: Array<\{/.test(editor) &&
    /\(profile\.payment_buttons \?\? \[\]\)/.test(editor),
  "los mismos que rutea el motor"
);
// Un metodo apagado conserva lo escrito. Esconderlo haria creer que se perdio.
comprobar(
  "los metodos apagados se ven, marcados",
  /apagado: boton\.enabled === false,/.test(editor) &&
    /método apagado → no sale/.test(panel),
  "apagar no es borrar"
);

// ── 2. Crear, borrar, duplicar y cambiar de metodo ───────────────────────────
// UN SOLO BOTON. Habia uno por metodo —«➕ Yape/Plin», «➕ Transferencia», «➕
// BCP»— y se veia exactamente igual que el trio fijo que venia a sustituir:
// tres marcas en pantalla sin que nadie las hubiera pedido. Que salgan nombres
// de metodos ANTES de crear nada es el mismo error con otra ropa.
comprobar(
  "se pueden crear, con un solo botón",
  /const agregar = \(method: string\) => \{/.test(panel) &&
    /➕ Agregar respuesta personalizada/.test(panel),
  "el método se elige dentro"
);
comprobar(
  "y no hay ningún nombre de método antes de crearla",
  !/➕ \{m\.label\}/.test(panel) && !/Agregar respuesta para/.test(panel),
  "ni una marca en pantalla"
);
comprobar(
  "se pueden borrar, con aviso de lo que se pierde",
  /const borrar = \(method: string\) => \{/.test(panel) &&
    /Se pierden sus burbujas\. Ese método volverá a recibir/.test(panel),
  "y se dice a donde vuelve"
);
comprobar(
  "se pueden duplicar",
  /const duplicar = \(method: string\) => \{/.test(panel),
  "⧉"
);
// Duplicar necesita un metodo libre: dos respuestas para el mismo metodo no
// existen, porque el motor pide una sola. Y se dice, en vez de no hacer nada.
comprobar(
  "y duplicar sin sitio lo dice en vez de callarse",
  /const destino = libres\[0\];\s*\r?\n\s*if \(!destino\) \{[\s\S]{0,260}?window\.alert\(/.test(
    panel
  ),
  "no hay clic que no haga nada"
);
comprobar(
  "y se puede cambiar a que metodo contesta",
  /const cambiarDeMetodo = \(deMetodo: string, aMetodo: string\) => \{/.test(
    panel
  ),
  "enlazarla a otro"
);
// Cambiar de metodo mueve lo escrito, no lo copia ni lo pierde.
comprobar(
  "cambiar de metodo se lleva lo escrito",
  /siguiente\[aMetodo\] = respuestas\[deMetodo\] \?\? \[\];/.test(panel),
  "no se reescribe"
);
// Y no se puede pisar una que ya existe.
comprobar(
  "y no puede pisar la de otro metodo",
  /if \(!aMetodo \|\| aMetodo === deMetodo \|\| creadas\.includes\(aMetodo\)\) return;/.test(
    panel
  ),
  "una por metodo"
);
// Sin metodos configurados no se ofrece crear nada en el vacio: se dice donde
// se crean.
comprobar(
  "sin metodos de pago, manda a crearlos",
  /Este país todavía no tiene métodos de pago/.test(panel),
  "en vez de una lista vacia"
);
// Ninguna respuesta = el de siempre. Que quede dicho, para que nadie crea que
// el cliente se queda sin datos.
comprobar(
  "y se explica que no hace falta crearlas todas",
  /reciben los datos de pago de siempre, con el/.test(panel),
  "las que falten caen al de siempre"
);

// ── 3. La vista previa se pega ───────────────────────────────────────────────
const ventanaRespuesta = (() => {
  const i = editor.indexOf("function VentanaDeRespuesta(");
  return i < 0 ? "" : editor.slice(i, i + 4000);
})();
const ventanaProducto = (() => {
  const i = editor.indexOf("function VentanaDeProducto(");
  // La ventana crecio en comentarios; se ensancha la ventana de lectura, nunca
  // se recorta el codigo para que quepa.
  return i < 0 ? "" : editor.slice(i, i + 6000);
})();
comprobar(
  "la ventana de una respuesta ya no corta el sticky",
  /className="my-8 w-full max-w-5xl rounded-2xl border/.test(ventanaRespuesta),
  "sin overflow-hidden"
);
comprobar(
  // El ancho bajo de 1024 a 820 px, un 20% menos: a ancho completo el texto se
  // estiraba en renglones larguisimos. Lo que esta prueba vigila NO es el
  // ancho, es que no vuelva el `overflow-hidden` que rompia el sticky.
  "la ventana de un producto tampoco",
  /className="my-8 w-full max-w-\[820px\] rounded-xl border/.test(ventanaProducto),
  "sin overflow-hidden"
);
// Y las esquinas se siguen viendo redondas: era lo unico que hacia falta.
comprobar(
  "y las esquinas se redondean donde tocaba",
  /rounded-t-2xl border-b border-neutral-200 bg-neutral-50\/80/.test(
    ventanaRespuesta
  ) && /h-1\.5 w-full rounded-t-xl/.test(ventanaProducto),
  "cabecera y cinta"
);
// La previa sigue siendo sticky: si alguien la quitara, quitar el overflow no
// serviria de nada.
comprobar(
  "la previa sigue pegandose al desplazar",
  /<div className="lg:sticky lg:top-4 lg:self-start">/.test(editor),
  "lg:sticky"
);

// ── 4. Aceptar por donde sea manda lo que escribio el dueño ──────────────────
comprobar(
  "hay quien busque el cuadrito con el que se acepta",
  /function cuadritoQueAceptaElExtra\(/.test(motor) &&
    /decision\.action === "choose_upsell" &&/.test(motor),
  "el que tiene la accion enlazada"
);
// Solo si TIENE burbujas escritas Y ENCENDIDAS. Un cuadrito con la accion y sin
// texto no tiene nada que sustituir, y callarse dejaria al cliente sin saber
// como pagar. Escritas pero apagadas es lo mismo que sin texto: no salen.
comprobar(
  "y solo si tiene burbujas escritas",
  /tieneBurbujasEncendidas\(decision\.steps\)/.test(motor),
  "sin texto no hay nada que sustituir"
);
comprobar(
  "el marcador del modelo pasa por ahi",
  /await aceptarElExtraComoLoEscribioElDueno\(freshUpsell\);/.test(manejador),
  "<<QUIERE_EXTRA>>"
);
// Y si no hay cuadrito armado, todo sigue exactamente como estaba.
comprobar(
  "sin cuadrito armado, los datos de fabrica como siempre",
  /if \(!config \|\| !cuadrito\) \{\s*\r?\n\s*await entregarDatosDePagoDelUpsell\(convo\);/.test(
    motor
  ),
  "nadie se queda sin datos"
);
// Lo invisible se hace igual —queda anotado que acepto, con su precio y su
// metodo— o el comprobante se validaria contra el producto equivocado.
comprobar(
  "y aceptar queda anotado aunque no salgan las de fabrica",
  /await entregarDatosDePagoDelUpsell\(convo, \{ enviarDatos: false \}\);/.test(
    motor
  ),
  "el precio del extra y su metodo"
);
comprobar(
  "y queda dicho en el log con que cuadrito",
  /aceptado con «\$\{cuadrito\.title \|\| "su cuadrito"\}»/.test(motor),
  "no hay que adivinar"
);

console.log(
  fallos === 0
    ? "\nTODO OK — las respuestas del extra las crea el dueño"
    : `\n${fallos} comprobacion(es) mal.`
);
process.exit(fallos === 0 ? 0 : 1);
