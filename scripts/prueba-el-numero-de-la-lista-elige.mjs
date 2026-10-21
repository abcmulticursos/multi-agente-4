// «creo que el 1» elige la opción 1. El número de la lista, con la duda delante.
//
// LO QUE PASO — 16 de septiembre de 2026, -DOU-, convo 125 del dueño. El bot
// enumera sus dos opciones en pantalla. Él escribió, para elegir el full:
//
//     «creo que el 1»
//
// No se registró nada. Dos mensajes después escribió «con yape» y, como seguía
// sin elección anotada, el turno cayó por el camino de «pago sin elegir»: recibió
// unos datos de pago con un importe que no era ninguna de sus dos opciones, y
// debajo el recordatorio con las dos. Sus palabras: «me está entregando datos
// errados».
//
// ERAN TRES BLOQUEOS, NO UNO. Medido con su contenido, ejecutando los detectores
// reales, antes de tocar nada:
//
//     order_bump             4 frases mal de 23
//     doble_oferta_upsell   12 frases mal de 23
//
//   1. El «que» de «creo que» hacía que la frase contara como PREGUNTA en -DOU-.
//   2. La regla del NÚMERO estaba acotada a -OB-; en -DOU- ni se miraba.
//   3. Y el ancla del número exige el mensaje ENTERO —«el 1»—, así que «creo que
//      el 1» tampoco entraba EN -OB-, donde el número lleva funcionando desde el
//      día 13. Ese tercero no lo veía nadie.
//
// LOS TRES JUNTOS O NINGUNO: con el «que» arreglado pero sin el número, «creo
// que el 1» sigue sin elegir. Con el número pero sin el ancla, tampoco. Por eso
// el «que» y el número comparten puerta.
//
// EL ANCLA NO SE AFLOJA, Y ESO ES LO QUE ESTA PRUEBA MÁS CUIDA. Pide el mensaje
// entero porque hay productos que se llaman «2 EN 1»: un número suelto dentro de
// una frase no puede elegir nada. Lo que se hace es quitarle a la frase lo que va
// hasta el «que» y aplicar el MISMO ancla al resto — y solo si ese «que» es de
// relleno, lo cual NO lo decide una lista de palabras sino la regla de posición
// que ya estaba medida.
//
//   node scripts/prueba-el-numero-de-la-lista-elige.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const config = readFileSync(
  join(RAIZ, "src", "lib", "workflow", "config.ts"),
  "utf8"
).replace(/\r\n/g, "\n");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 54)} ${valor}`);
};

// ── Los detectores reales, sacados del archivo ───────────────────────────────
const trozo = (desde, hasta) => {
  const i = config.indexOf(desde);
  if (i < 0) return "";
  const f = config.indexOf(hasta, i);
  return f < 0 ? "" : config.slice(i, f);
};
const funcion = (firma) => {
  const cuerpo = trozo(firma, "\n}");
  if (!cuerpo) throw new Error(`no encuentro en config.ts:\n  ${firma}`);
  return (
    cuerpo
      .replace(/\((\w+): string\): (?:boolean|1 \| 2 \| null) \{/, "($1) {")
      .replace(/^(?:export )?function /, "function ") + "\n}"
  );
};
const antesala =
  trozo("const ANTESALA_QUE_NO_QUITA_LA_PREGUNTA = new Set([", "]);") + "]);";
// El grupo del subjuntivo de encargo vive en un solo sitio y lo usan las dos
// reglas. Se trae de ahí, no se copia.
const encargo =
  trozo("const SUBJUNTIVO_DE_ENCARGO = new Set([", "]);") + "]);";

const { elOrdinalQueEligio, elOrdinalTrasLaDuda } = new Function(
  [
    antesala,
    encargo,
    funcion("function elQueEsElDePreguntar(normalized: string): boolean {"),
    funcion("function elOrdinalQueEligio(normalized: string): 1 | 2 | null {"),
    funcion("function elOrdinalTrasLaDuda(normalized: string): 1 | 2 | null {"),
    "return { elOrdinalQueEligio, elOrdinalTrasLaDuda };",
  ].join("\n\n")
)();

// Así lo compone `detectTwoTierPick`: primero el número pelado, y si no, con la
// duda delante.
const cual = (t) => elOrdinalQueEligio(t) ?? elOrdinalTrasLaDuda(t);

// ── 1. EL NÚMERO PELADO, QUE YA FUNCIONABA ──────────────────────────────────
console.log("\n— el número solo, como estaba —\n");
for (const [frase, esperado] of [
  ["el 1", 1],
  ["el 2", 2],
  ["la 1", 1],
  ["1", 1],
  ["dos", 2],
  ["primero", 1],
  ["el segundo", 2],
  ["quiero el 1", 1],
  ["me quedo con el 2", 2],
  ["dame la 2", 2],
]) {
  comprobar(`«${frase}»`, cual(frase) === esperado, `opción ${esperado}`);
}

// ── 2. Y AHORA, CON LA DUDA DELANTE ─────────────────────────────────────────
//    Es como contesta la gente: nadie escribe el número pelado.
console.log("\n— y con la duda delante, que es como se contesta —\n");
for (const [frase, esperado] of [
  ["creo que el 1", 1],
  ["creo que el 2", 2],
  ["me parece que el 1", 1],
  ["pienso que la 2", 2],
  ["supongo que el 1", 1],
  ["diria que el 2", 2],
  ["yo creo que el 1", 1],
  ["digamos que la 2", 2],
  ["ok entonces que sea el 1", 1],
  ["listo que sea el 2", 2],
]) {
  comprobar(`«${frase}»`, cual(frase) === esperado, `opción ${esperado}`);
}

// ── 3. EL ANCLA NO SE AFLOJÓ ────────────────────────────────────────────────
//    ESTO ES LO QUE MÁS PROTEGE ESTA PRUEBA. Un número suelto dentro de una
//    frase no puede elegir: hay productos que se llaman «2 EN 1».
console.log("\n— y un número suelto dentro de una frase no elige —\n");
for (const frase of [
  "el 2 en 1",
  "quiero el 2 en 1",
  "tengo 2 hijos",
  "son 2 productos",
  "el combo trae 2 cosas",
  "a las 2 de la tarde",
  "me quedan 2 dias",
  "1 pregunta",
  "creo que son 2",
  "creo que el 2 en 1 es mejor",
]) {
  comprobar(`«${frase}»`, cual(frase) === null, "no elige");
}

// ── 4. NI UNA PREGUNTA, AUNQUE LLEVE EL NÚMERO ──────────────────────────────
//    El «que» de preguntar lo decide la POSICIÓN, no una lista de palabras: si
//    abre la frase (o solo lleva conectores delante), es pregunta.
console.log("\n— ni una pregunta, aunque lleve el número —\n");
for (const frase of [
  "que trae el 1",
  "que incluye el 2",
  "que contiene el 1",
  "y que trae el 2",
  "ok entonces que trae el 1",
  "hola que trae el 2",
]) {
  comprobar(`«${frase}»`, cual(frase) === null, "es pregunta");
}

// ── 5. LA FORMA: LOS TRES BLOQUEOS, CADA UNO EN SU SITIO ────────────────────
console.log("\n— la forma del arreglo —\n");
comprobar(
  "el «que» y el número comparten puerta",
  /export function laLecturaFinaDeLaEleccionEstaActiva\(\): boolean \{/.test(
    config
  ) &&
    /const elQueCuentaComoPregunta = laLecturaFinaDeLaEleccionEstaActiva\(\)/.test(
      config
    ) &&
    /if \(laLecturaFinaDeLaEleccionEstaActiva\(\)\) \{\s*\n\s*const posicion =/.test(
      config
    ),
  "uno sin el otro no sirve"
);
comprobar(
  // Y EL 25/09/2026 SE LE SUMÓ LA PRESENTACIÓN PRESTADA DE -OB-, que es la misma
  // puerta y el mismo arreglo: ahí la modalidad se llama lineal, así que
  // preguntar por el NOMBRE la dejaba fuera y el ordinal no elegía nada —
  // mientras en -OB- de verdad sí. Se pregunta por el DATO con
  // `isOrderBumpActive`. La intención no cambia: que la puerta siga puesta y que
  // siga siendo una lista corta y explícita.
  // Y LAS DOS PRESENTACIONES PRESTADAS, porque él mueve el selector cuando
  // quiere: «debe estar preparado para el cambio sin romperse». Doble Oferta 2
  // Productos de verdad sigue fuera, que es la escalera de siempre.
  "y la puerta deja pasar a -OB-, a -DOU- y a las dos prestadas",
  /isOrderBumpActive\(\) \|\|\s*\r?\n?\s*vendeConPresentacionPrestada\(cfg, "dos_juntas"\) \|\|\s*\r?\n?\s*modo === "order_bump" \|\|\s*\r?\n?\s*modo === "doble_oferta_upsell"/.test(
    config
  ),
  "las otras, como antes"
);
comprobar(
  "el número ya no está acotado a -OB-",
  !/Solo en -OB- por orden del dueño; se prueba aquí y luego se lleva\.\s*\n\s*if \(laModalidadActivaEsOrderBump\(\)\)/.test(
    config
  ),
  "se llevó, que era el trato"
);
// LINEAL NO ENTRA, Y NO POR PRUDENCIA: no tiene dos opciones. Aunque la puerta
// se abriera, `opcionEnLaPosicion` exige una oferta de dos y sin ella devuelve
// vacío. Donde hay un solo producto no hay posición que elegir.
comprobar(
  "en lineal no puede elegir nada, por construcción",
  /function opcionEnLaPosicion\([\s\S]{0,400}?if \(!getActiveTwoTierOffer\(config\)\) return null;/.test(
    config
  ),
  "sin dos opciones, vacío"
);
// Y LA DUDA SE APOYA EN LA REGLA MEDIDA, no en una lista nueva de palabras.
comprobar(
  "la duda la resuelve la regla de posición, no una lista",
  /function elOrdinalTrasLaDuda\([\s\S]{0,200}?if \(elQueEsElDePreguntar\(normalized\)\) return null;/.test(
    config
  ),
  "nada de sinónimos escritos a mano"
);
// EL ANCLA NO SE AFLOJA: se recorta la frase y se le aplica `elOrdinalQueEligio`
// TAL CUAL. Si esto pasara a llevar su propio regex, el ancla estaría duplicada
// y «el 2 en 1» podría colarse por la copia nueva.
comprobar(
  "y le aplica el MISMO ancla al resto de la frase",
  /const resto = normalized\.slice\(i \+ " que "\.length\)\.trim\(\);/.test(config) &&
    /return elOrdinalQueEligio\(sinEncargo\);/.test(config),
  "el ancla no se afloja"
);
// Y EL SUBJUNTIVO DE ENCARGO SALE DEL MISMO SITIO QUE LA OTRA REGLA. Con una
// copia en cada una, «que sea el 1» y «que sea el combo» acabarían divergiendo.
comprobar(
  "el subjuntivo de encargo está en un solo sitio",
  /const SUBJUNTIVO_DE_ENCARGO = new Set\(\["sea", "sean", "quede", "queden"\]\);/.test(
    config
  ) &&
    /if \(SUBJUNTIVO_DE_ENCARGO\.has\(palabras\[i \+ 1\] \?\? ""\)\) return false;/.test(
      config
    ) &&
    /SUBJUNTIVO_DE_ENCARGO\.has\(palabras\[0\] \?\? ""\)/.test(config),
  "lo comparten las dos reglas"
);

console.log(
  fallos === 0
    ? "\nTODO OK — el bot sabe leer su propio número, con duda o sin ella\n"
    : `\n${fallos} comprobacion(es) mal.\n`
);
process.exit(fallos === 0 ? 0 : 1);
