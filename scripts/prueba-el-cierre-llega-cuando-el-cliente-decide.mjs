// El bot contestaba muy bien y no invitaba a nada.
//
// El cliente preguntaba «¿son diferentes?» o «¿el otro cuesta mas?», el bot
// respondia de maravilla... y remataba con «¿Te quedo claro? 😊». Sin proponer
// nada, justo en los dos momentos en que se decide la venta.
//
// POR QUE. Para ahorrar tokens el cerebro se arma por piezas, y en esos dos
// estados —esperando la eleccion y esperando el comprobante— se omite la
// seccion «Precio, formato y cierre», que es la que dice como rematar.
//
// EL PRIMER INTENTO FUE DEMASIADO GRANDE, y esta prueba existe sobre todo para
// que no se repita. Se devolvio la seccion ENTERA: 6.000 caracteres que ademas
// gobiernan el FORMATO y la LONGITUD de todas las respuestas de esos estados.
// Para conseguir una linea de cierre se cambiaba el comportamiento de cada
// turno. Mover una pieza compartida por un detalle es como se rompen las cosas
// de al lado sin enterarse.
//
// LO QUE HAY AHORA: una instruccion corta y propia, con el cierre y el limite
// de largo. Mismo efecto, ~50 tokens, y el filtro de secciones intacto.
//
//   node scripts/prueba-el-cierre-llega-cuando-el-cliente-decide.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const cerebro = readFileSync(join(RAIZ, "src", "lib", "openrouter.ts"), "utf8");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 56)} ${valor}`);
};

// ── 1. La instruccion existe y pide lo que faltaba ─────────────────────────
const i = cerebro.indexOf("INVITACIÓN A LLEVARLO");
comprobar("existe la instruccion de cierre", i > 0, "una linea, no una seccion");
// LA VENTANA SE CIERRA POR DONDE ACABA EL BLOQUE, NO A LOS 2.600 CARACTERES.
//
// Estaba cortada a una longitud fija y los comentarios de esta zona crecieron:
// el trozo dejaba fuera la propia instruccion y las ocho comprobaciones de abajo
// fallaban sin que nada se hubiera roto. Una prueba que falla sola deja de
// avisar cuando pasa algo de verdad.
const finDelBloque = cerebro.indexOf("const payingNowText", i);
const bloque =
  i < 0 ? "" : cerebro.slice(i, finDelBloque > i ? finDelBloque : i + 2600);
comprobar(
  "pide rematar invitando a llevarlo",
  /invite a llevarlo o a elegir una de las opciones/.test(bloque),
  "propone el siguiente paso"
);
comprobar(
  // Era literalmente lo que salia: «¿Te quedo claro? 😊».
  "y prohibe el cierre vacio",
  /Nunca cierres con «¿te quedó claro\?»/.test(bloque),
  "sin preguntas huecas"
);
comprobar(
  // Sin la seccion de formato, «que son 2» se llevo los 1.024 tokens de techo y
  // llego cortada: el cliente vio «no pude completar mi respuesta».
  "y pone un limite de largo",
  /BREVE \(como máximo 3 párrafos cortos/.test(bloque),
  "no se corta a media frase"
);

// ── 2. Solo en los momentos de decidir ─────────────────────────────────────
const ESTADOS = [
  "payment_done",
  "awaiting_order_bump_choice",
  "awaiting_doble_oferta_dos_choice",
  "awaiting_bioferta_choice",
];
for (const estado of ESTADOS) {
  comprobar(`cubre ${estado}`, bloque.includes(estado), "incluido");
}
comprobar(
  // En postventa ya compro: invitarle a llevarlo otra vez seria insistir.
  "y NO en postventa",
  !/awaiting_email|awaiting_facebook_comment|payment_approved/.test(bloque),
  "ahi no se vende"
);

// ── 3. Y el filtro de secciones queda como estaba ──────────────────────────
//
// ESTO es lo que hay que vigilar: que nadie vuelva a mover la pieza grande para
// conseguir algo pequeño.
const filtro = (() => {
  const j = cerebro.indexOf("function promptSectionExclusionsForTurn(");
  if (j < 0) return "";
  // Misma correccion que arriba: se cierra donde acaba la funcion, no a una
  // longitud fija que los comentarios de la zona ya desbordaban.
  //
  // Se arranca DESPUES de la firma: los parametros van en un objeto que tambien
  // cierra con «\n}», y cortar ahi dejaba fuera la funcion entera.
  const cuerpo = cerebro.indexOf("{", cerebro.indexOf("): string[]", j));
  const fin = cerebro.indexOf("\n}", cuerpo);
  return cerebro.slice(j, fin > j ? fin : j + 2600);
})();
comprobar(
  "el filtro sigue omitiendo la seccion entera",
  /if \(state === "payment_done"\) \{\s*\r?\n\s*exclude\.add\("precio_cierre"\);/.test(
    filtro
  ) &&
    /if \(activeChoiceState\) \{\s*\r?\n\s*exclude\.add\("precio_cierre"\);/.test(
      filtro
    ),
  "sin condiciones nuevas"
);
comprobar(
  "no quedan restos del intento anterior",
  !/sigueDecidiendo|comparaIntent/.test(cerebro),
  "sin codigo muerto"
);
comprobar(
  "en postventa se sigue quitando pago y cierre",
  /if \(isPostSale\) \{\s*\r?\n\s*exclude\.add\("pago"\);\s*\r?\n\s*exclude\.add\("precio_cierre"\);/.test(
    filtro
  ),
  "intacto"
);
comprobar(
  "la guarda anti-presion sigue en pie",
  /RETRY REQUIRED: the payment details and receipt request are already visible/.test(
    cerebro
  ),
  "intacta"
);

console.log(
  fallos === 0
    ? "\nTODO OK — el bot invita a llevarlo, con una linea y sin mover el resto"
    : `\n${fallos} FALLA(S)`
);
process.exit(fallos === 0 ? 0 : 1);
