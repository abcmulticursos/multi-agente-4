// HABLAR NO ES ELEGIR.
//
// LO QUE PASO — 22 de septiembre de 2026, dos veces en el mismo registro
//
//   El bot esperaba que la clienta eligiera entre los dos productos. Ella
//   escribio:
//
//       «E gusta todas esas cosas TODO emprendimiento es bueno»
//
//   El bot encontro «todo» en su lista de palabras que significan «el caro»,
//   dio por hecho que habia elegido, y le solto los datos de pago. Ella no
//   habia elegido nada.
//
//   Y el mismo dia, otro cliente:
//
//       «No Queria saber si tienen COMBO … o algo haci»
//
//   Preguntaba SI TIENEN. Empezaba diciendo «no». Misma venta.
//
//   Palabras del dueño: «eso esta mal, no esta identificando lo que quiere
//   decir el cliente, solo esta buscando la palabra, eso es malisimo».
//
// POR QUE EXISTIA ESA LISTA, que NO se quita
//
//   El bot acaba de preguntar «¿cual?» y el cliente puede contestar «el caro» o
//   «el grande» sin decir el nombre. Eso hay que reconocerlo. El error no era
//   tener la lista: era buscar esas palabras en CUALQUIER sitio sin preguntarse
//   si el mensaje contestaba algo.
//
// COMO SE ARREGLO
//
//   Una palabra corriente solo decide si el cliente CONTESTO CORTO. El nombre de
//   su producto y el precio siguen decidiendo en la frase que sea.
//
//   MEDIDO CON SUS DATOS: sus elecciones reales tenian 2 y 3 palabras; los dos
//   fallos, 9 y 10. El limite se puso en 6 —el dueño lo eligio— y deja sitio
//   para «creo que me llevo el completo» sin acercarse a una conversacion.
//
// LO QUE NO PUEDE VOLVER A PASAR
//
//   1. Que una frase larga con una palabra corriente venda sola.
//   2. Que se «arregle» quitando palabras de la lista: taparia un caso y
//      dejaria vivos los demas.
//   3. Que el nombre de su producto deje de decidir por ser una frase larga.
//   4. Que aparezca un nombre de producto escrito en el codigo: lo que
//      distingue una opcion de la otra sale de la configuracion.
//
//   node scripts/prueba-hablar-no-es-elegir.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";

const RAIZ = process.cwd();
const DOBLE = "stub:db";
registerHooks({
  resolve(esp, ctx, next) {
    if (esp === "@/lib/db")
      return { url: DOBLE, format: "module", shortCircuit: true };
    if (esp.startsWith("@/")) {
      const rel = esp.slice(2);
      const conExt = /\.[a-z]+$/.test(rel) ? rel : `${rel}.ts`;
      return {
        url: pathToFileURL(join(RAIZ, "src", conExt)).href,
        shortCircuit: true,
      };
    }
    return next(esp, ctx);
  },
  load(url, ctx, next) {
    if (url === DOBLE)
      return {
        format: "module",
        shortCircuit: true,
        source:
          "export const getConversationByPhone=()=>null;export const getFrozenPrices=()=>null;export const getUpsellFrozenPrices=()=>null;export const getPuestoEnLaFila=()=>null;export const leerCompradosDeLaFila=()=>[];export const moverLaFila=()=>{};export const setFrozenPrices=()=>{};",
      };
    return next(url, ctx);
  },
});

const { detectTwoTierPick } = await import(
  pathToFileURL(join(RAIZ, "src", "lib", "workflow", "config.ts")).href
);

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// PRODUCTOS INVENTADOS. Una prueba escrita con los reales tapa justo el fallo
// que la regla de la plantilla evita. «ALFA» distingue a la cara; «BETA», a la
// barata; «KIT» lo comparten las dos y por eso no distingue nada.
const cfg = {
  order_bump: {
    enabled: true,
    combo: { name: "KIT ALFA FULL", aliases: [] },
    basico: { name: "KIT BETA BASICO", aliases: [] },
  },
};

// -- 1. HABLAR NO ES ELEGIR --------------------------------------------------
comprobar(
  "«todo emprendimiento es bueno» ya no vende",
  detectTwoTierPick(
    "E gusta todas esas cosas todo emprendimiento es bueno",
    cfg
  ) === null,
  "9 palabras"
);
comprobar(
  "y preguntar si tienen combo tampoco",
  detectTwoTierPick(
    "No Queria saber si tienen combo o algo haci porfa",
    cfg
  ) === null,
  "es una pregunta"
);
comprobar(
  "ni una frase larga que solo lleva «grande»",
  detectTwoTierPick(
    "me gusta mucho lo que es grande siempre me ha gustado",
    cfg
  ) === null,
  "no es una respuesta"
);

// -- 2. ELEGIR CORTO SIGUE VALIENDO ------------------------------------------
comprobar(
  "«el combo» elige",
  detectTwoTierPick("el combo", cfg) === "combo",
  "2 palabras"
);
comprobar(
  "«el mas caro» elige",
  detectTwoTierPick("el mas caro", cfg) === "combo",
  "3 palabras"
);
comprobar(
  "«el mas barato» elige",
  detectTwoTierPick("el mas barato", cfg) === "basico",
  "3 palabras"
);
// EL LIMITE QUE ELIGIO EL DUEÑO: seis palabras. Con esto cabe una eleccion
// hablada sin que quepa una frase de conversacion.
comprobar(
  "«creo que me llevo el completo» tambien",
  detectTwoTierPick("creo que me llevo el completo", cfg) === "combo",
  "6 palabras, el limite"
);

// -- 3. EL NOMBRE DE SU PRODUCTO DECIDE EN CUALQUIER FRASE -------------------
// ASI SON SUS NOMBRES DE VERDAD: llevan dentro la palabra que los distingue
// —«full», «basico»—, que ademas es de las que el detector entiende. Por eso el
// cliente que escribe el nombre en una frase larga SIGUE eligiendo.
comprobar(
  "el nombre propio decide aunque la frase sea larga",
  detectTwoTierPick(
    "me llevo el kit alfa full que me dijiste recien por favor",
    cfg
  ) === "combo",
  "11 palabras, y elige igual"
);
comprobar(
  "y el de la otra opcion igual",
  detectTwoTierPick(
    "mira al final prefiero el kit beta basico si no te importa",
    cfg
  ) === "basico",
  "11 palabras, y elige igual"
);
// UN LIMITE QUE YA EXISTIA Y NO SE TOCA, escrito para que nadie lo descubra por
// sorpresa: una palabra del nombre que NO sea de las que el detector entiende
// —un «alfa» suelto— no decide dentro de una frase larga. No es de este cambio:
// el detector nunca lo hizo. Si algun dia hace falta, se arregla aparte.
comprobar(
  "una palabra inventada del nombre no decide en frase larga",
  detectTwoTierPick(
    "me llevo el kit alfa que me dijiste recien por favor",
    cfg
  ) === null,
  "limite anterior, sin cambios"
);
// LO QUE COMPARTEN LAS DOS NO DISTINGUE NADA.
comprobar(
  "una palabra que tienen los dos no salta la regla",
  detectTwoTierPick(
    "estuve mirando el kit y la verdad me gusta todo bastante",
    cfg
  ) === null,
  "«kit» lo tienen las dos"
);

// -- 4. LA LISTA SIGUE ENTERA ------------------------------------------------
//
// El arreglo NO fue quitar palabras: eso habria tapado un caso y dejado vivos
// los demas. La lista tiene que seguir completa.
const fuente = readFileSync(
  join(RAIZ, "src", "lib", "workflow", "config.ts"),
  "utf8"
);
comprobar(
  "no se quito ninguna palabra de la lista",
  /"combo", "completo", "pack", "premium", "vip", "mayor", "todo", "caro", "costoso", "alto", "grande", "full"/.test(
    fuente
  ),
  "se añadio la pregunta, no se quito nada"
);
comprobar(
  "y lo que distingue sale de la configuracion",
  /tokensPropiosDeCadaOpcion\(config\)/.test(fuente) &&
    /words\.length > CONTESTA_CORTO/.test(fuente),
  "ningun nombre escrito a mano"
);

console.log(
  fallos === 0
    ? "\nTODO OK — hablar no es elegir, y elegir sigue siendo elegir"
    : `\n${fallos} FALLO(S)`
);
process.exit(fallos === 0 ? 0 : 1);
