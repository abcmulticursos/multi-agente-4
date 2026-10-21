// Una burbuja de la intro puede pedir el nombre, como hacia el saludo.
//
// POR QUE
//
//   El saludo hacia dos cosas: esperar una respuesta y guardar lo que llegara
//   como nombre del cliente. Lo primero ya lo hace cualquier burbuja con un
//   cuadrito, y encima con plazo propio. Lo segundo era lo unico que quedaba
//   sin poder hacerse desde una burbuja, y obligaba a mantener un paso extra al
//   principio de toda conversacion.
//
// POR QUE NO ES UN CUADRITO
//
//   Un cuadrito reconoce por palabras clave. Un nombre es texto libre: no hay
//   palabra que lo reconozca. Por eso es un interruptor de la burbuja y por eso
//   detiene la intro EL SOLO, sin necesitar cuadritos.
//
// EL ERROR QUE ESTA PRUEBA IMPIDE
//
//   Que se guarde como nombre algo que no lo es. La pausa tiene cuatro salidas
//   —tocar un boton, acertar un cuadrito, escribir otra cosa, o que venza el
//   plazo— y solo UNA de ellas trae un nombre. Si el mensaje se pasara en las
//   otras, el cliente acabaria llamandose «combo» o «yape», y ese nombre viaja
//   al CRM y a Meta.
//
//   node scripts/prueba-una-burbuja-puede-pedir-el-nombre.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");
const config = leer("src", "lib", "workflow", "config.ts");
const motor = leer("src", "lib", "workflow", "engine.ts");
const ruta = leer("src", "app", "api", "workflow", "route.ts");
const editor = leer("src", "app", "editor", "page.tsx");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// -- 1. LA BURBUJA LO CONOCE -------------------------------------------------
comprobar(
  "la burbuja tiene el interruptor",
  /capturar_nombre\?: boolean;/.test(config),
  "config.ts"
);
comprobar(
  "y el editor lo llama igual",
  /capturar_nombre\?: boolean;/.test(editor),
  "mismo nombre"
);

// -- 2. DETIENE LA INTRO EL SOLO ---------------------------------------------
//
// Sin esto, la burbuja preguntaria el nombre y seguiria de largo sin esperarlo:
// las siguientes caerian encima y la respuesta llegaria tarde y suelta.
comprobar(
  "pedir el nombre detiene la intro",
  /decisionesEncendidas\(step\.decisions\)\.length > 0 \|\|\s*\r?\n?\s*step\.capturar_nombre === true/.test(
    motor
  ),
  "sin necesitar cuadritos"
);

// -- 3. SE GUARDA, Y CON EL LECTOR DE SIEMPRE --------------------------------
const retomar = (() => {
  const i = motor.indexOf("export async function reanudarIntroSiEstabaEnPausa(");
  const f = motor.indexOf("async function scheduleIntroSequence(", i);
  return i < 0 || f < 0 ? "" : motor.slice(i, f);
})();
comprobar("se encuentra el retomar", retomar.length > 0, "engine.ts");
comprobar(
  "la burbuja que pregunto es la ANTERIOR a la marca",
  /const laQuePregunto = desde > 0 \? pasos\[desde - 1\] : undefined;/.test(
    retomar
  ),
  "la marca guarda por donde seguir"
);
// El MISMO lector que el saludo. Una segunda forma de sacar el nombre daria dos
// resultados distintos para la misma frase segun por donde entrara, y ese
// nombre acaba en el CRM y en Meta.
comprobar(
  "usa el mismo lector que el saludo",
  /extractNameFromMessage\(mensajeDelCliente\)/.test(retomar) &&
    /setClientName\(convoId, nombre\)/.test(retomar),
  "una sola verdad"
);
comprobar(
  "y solo si la burbuja lo pedia",
  /laQuePregunto\?\.capturar_nombre === true && mensajeDelCliente\?\.trim\(\)/.test(
    retomar
  ),
  "no guarda de mas"
);

// -- 4. SOLO UNA SALIDA TRAE UN NOMBRE ---------------------------------------
//
// Es la parte cara de equivocarse. Solo la llamada de «escribio otra cosa»
// puede pasar el mensaje; las demas guardarian una eleccion como nombre.
const conMensaje = [...motor.matchAll(/reanudarIntroSiEstabaEnPausa\(([^)]*)\)/g)]
  .map((m) => m[1].trim())
  // Fuera la DECLARACION de la funcion, que tambien lleva coma entre sus dos
  // parametros. Se reconoce por el nombre del primero.
  .filter((args) => args.includes(",") && !args.includes("convoId"));
comprobar(
  "solo UNA salida pasa el mensaje",
  conMensaje.length === 1 && /convo\.id, msgContent/.test(conMensaje[0]),
  conMensaje.length === 1 ? conMensaje[0] : `${conMensaje.length} salidas`
);
comprobar(
  "el parametro es opcional",
  /mensajeDelCliente\?: string/.test(retomar),
  "las otras salidas no lo pasan"
);

// -- 5. LA API, DE IDA Y DE VUELTA -------------------------------------------
comprobar(
  "la API lo lee",
  /capturar_nombre: s\?\.capturar_nombre === true,/.test(ruta),
  "de vuelta"
);
comprobar(
  "y lo escribe solo cuando esta encendido",
  /const nombreField = pideNombre \? \{ capturar_nombre: true \} : \{\};/.test(
    ruta
  ) && (ruta.match(/\.\.\.nombreField,?/g) ?? []).length === 2,
  "yaml limpio, y en los dos tipos"
);
// El plazo tiene sentido aunque no haya cuadritos: pedir el nombre tambien
// detiene. Sin esto, el numero se escribia en la pantalla y se tiraba al
// guardar.
comprobar(
  "el plazo se guarda tambien si solo pide el nombre",
  /\(decisions\.length \|\| pideNombre\) &&/.test(ruta),
  "no se descarta"
);

// -- 6. LA PANTALLA ----------------------------------------------------------
comprobar(
  "hay interruptor en la burbuja",
  /Aquí le pregunto su nombre/.test(editor) &&
    /onPideNombre=\{\(capturar_nombre\) => onUpdate\(\{ capturar_nombre \}\)\}/.test(
      editor
    ),
  "junto a los cuadritos"
);
comprobar(
  "y el plazo aparece tambien con solo el nombre",
  /\{\(pideNombre \|\| decisions\.some\(\(d\) => d\.enabled !== false\)\) && \(/.test(
    editor
  ),
  "hay pausa que medir"
);

console.log(fallos === 0 ? "\nTODO OK" : `\n${fallos} FALLO(S)`);
process.exit(fallos === 0 ? 0 : 1);
