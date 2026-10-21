// UN «HOLA» NO LE VUELVE A SOLTAR LOS DATOS DE PAGO.
//
// LO QUE PASO — 2 de octubre de 2026, su conversacion HOLAp1. El cliente ya tenia los
// datos y escribio «HOLA». El bot le contesto el precio y le solto la cuenta encima otra
// vez. Con sus palabras: «¿que carajos esta pasando?».
//
// ── EL FRENO EXISTIA Y NO FUNCIONABA NUNCA ─────────────────────────────────
//
// `losDatosSiguenEnPantalla` se puso el 28/09/2026, cuando el dijo «me lanzo los datos de
// pago». Su trabajo: si el bot acaba de darlos, no repetirlos.
//
// No fallaba a veces. Fallaba SIEMPRE. Medido ejecutando la funcion real:
//
//     con el mensaje del cliente guardado : false
//     sin el mensaje del cliente          : true
//
// El mensaje entrante se guarda en cuanto llega —`handler.ts` linea ~1393— y esta puerta
// pregunta mucho despues. Al mirar hacia atras, lo PRIMERO que encontraba era el mensaje
// del cliente, cortaba ahi y devolvia «no estan en pantalla» sin haber mirado una sola
// burbuja del bot.
//
// Un freno que siempre dice que no es un freno que no existe. Y no daba ningun error:
// daba una conversacion que se repite.
//
// ── LA CURA ────────────────────────────────────────────────────────────────
//
// Saltar los mensajes del cliente del final —pueden ser varios, una rafaga— y leer a
// partir de ahi el turno del bot, que es lo que la funcion queria leer desde el principio.
// La intencion no cambia; solo ahora llega a cumplirse.
//
//   node scripts/prueba-un-hola-no-reenvia-los-datos.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const src = readFileSync(join(RAIZ, "src", "lib", "meta", "handler.ts"), "utf8");

let fallos = 0;
const pad = (s, n) => (String(s ?? "") + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 56)} ${valor}`);
};

// LA FUNCION REAL, extraida del archivo. Reescribirla probaria lo que uno cree que hace.
const i = src.indexOf("function losDatosSiguenEnPantalla(");
const f = src.indexOf("\n}", i);
if (i < 0 || f < 0) {
  console.log("FALLA no encuentro `losDatosSiguenEnPantalla` en handler.ts");
  process.exit(1);
}
const cuerpo = src
  .slice(i, f + 2)
  .replace(/:\s*number/g, "")
  .replace(/\)\s*:\s*boolean\s*\{/, ") {");

// Numeros INVENTADOS: una prueba con sus cuentas taparia el fallo de un codigo que
// conoce los datos de hoy.
const DATOS = "Billetera: 111222333  Banco: 4455667788990011";
const correr = (historia) =>
  new Function(
    "getRecentHistory",
    "unTextoLlevaLosDatosParaPagar",
    `${cuerpo}; return losDatosSiguenEnPantalla;`
  )(
    // Se respeta el tamaño de ventana que pida la funcion, que es parte de lo que decide.
    (_id, n) => historia.slice(-n),
    (t) =>
      /\{\{\s*(metodo_de_pago|metodo_pago)_(1|2|3|principal|prioritario)\s*\}\}/i.test(t) ||
      /(?:\d[\s.-]?){6,}/.test(t)
  )(1);

// ── 1. EL CASO EXACTO DEL DUEÑO ────────────────────────────────────────────
console.log("\n— 1. su caso: datos, seguimiento, y un «HOLA» —\n");
comprobar(
  "con el mensaje del cliente ya guardado, los VE",
  correr([
    { role: "assistant", content: DATOS },
    { role: "assistant", content: "Una vez realizado nos envias tu comprobante" },
    { role: "assistant", content: "Te recuerdo que sigue disponible" },
    { role: "user", content: "HOLA" },
  ]) === true,
  "antes decia false SIEMPRE"
);
comprobar(
  "y con una RAFAGA de tres mensajes suyos, también",
  correr([
    { role: "assistant", content: DATOS },
    { role: "user", content: "hola" },
    { role: "user", content: "ahi estas?" },
    { role: "user", content: "oye" },
  ]) === true,
  "escribe tres veces seguidas, pasa a diario"
);

// ── 1-bis. SU SEGUNDO CASO: «si pero no me van a estafar» ─────────────────
//
// LO QUE PASO — el mismo 2 de octubre, una hora despues. El cliente ya tenia la cuenta,
// escribio «si pero no me van a estafar», y el bot le solto la cuenta otra vez. Con sus
// palabras: «pero yo no he pedido datos ¿por que tiene que soltar datos?».
//
// Y TENIA RAZON. La puerta de arriba mira lo que el BOT va a decir, no lo que pregunto el
// cliente: vio que el modelo iba a pedir un metodo ya elegido y razono «quiere pagar →
// dale los datos». Falso: estaba desconfiando.
//
// POR QUE EL PRIMER ARREGLO NO BASTO. Entre la cuenta y su pregunta se habian metido un
// seguimiento y una respuesta, asi que los datos quedaron DOS turnos atras — y la funcion
// solo leia uno. En una conversacion de verdad siempre se mete algo en medio.
console.log("\n— 1-bis. «si pero no me van a estafar», con cosas en medio —\n");
comprobar(
  "con un seguimiento y una respuesta en medio, los sigue viendo",
  correr([
    { role: "user", content: "ok" },
    { role: "assistant", content: DATOS },
    { role: "assistant", content: "Una vez realizado nos envias tu comprobante" },
    { role: "assistant", content: "SEGUIMIENTO: sigue disponible" },
    { role: "assistant", content: "SEGUIMIENTO: avisame" },
    { role: "user", content: "hola" },
    { role: "assistant", content: "Hola! en que te ayudo" },
    { role: "user", content: "si pero no me van a estafar" },
  ]) === true,
  "antes decía false y repetía la cuenta"
);

// ── 2. Y SIGUE DICIENDO QUE NO CUANDO DE VERDAD NO ESTAN ──────────────────
//
// Es la otra mitad, y sin ella esto seria peor que el fallo: un freno que siempre dijera
// que SI dejaria sin datos a quien los pide de verdad.
//
// LA VENTANA SON VEINTE MENSAJES, que es «hace un rato» en un chat: lo que cabe en una
// pantalla de telefono sin desplazarse mucho. Pasados esos, la conversacion ya se fue a
// otra parte y volver a darle la cuenta si ayuda.
console.log("\n— 2. y dice que no cuando de verdad no están —\n");
comprobar(
  "si la cuenta ya quedó lejos, vuelve a darla",
  correr([
    { role: "assistant", content: DATOS },
    ...Array.from({ length: 22 }, (_, n) => ({
      role: n % 2 ? "assistant" : "user",
      content: `charla ${n}`,
    })),
  ]) === false,
  "veintitantos mensajes después"
);
comprobar(
  "sin ninguna burbuja del bot",
  correr([{ role: "user", content: "hola" }]) === false
);
comprobar(
  "y sin historia tampoco inventa nada",
  correr([]) === false
);

// ── 3. QUE EL ARREGLO SIGA ESCRITO ────────────────────────────────────────
//
// Sin esto, volver a poner un corte no pondria roja ninguna prueba y el freno moriria otra
// vez en silencio — que es como estuvo cuatro dias.
console.log("\n— 3. el arreglo sigue escrito —\n");
comprobar(
  "recorre la ventana entera, sin cortar en el cliente",
  /return historia\.some\(\s*\r?\n?\s*\(mensaje\) =>\s*\r?\n?\s*mensaje\.role === "assistant" &&/.test(
    src
  ),
  "ni en el suyo ni en el anterior"
);
comprobar(
  "y la ventana es de veinte mensajes",
  /getRecentHistory\(conversationId, 20\)/.test(src),
  "«hace un rato» en un chat"
);
comprobar(
  "y queda contado por qué",
  /no fallaba a veces, fallaba\s*\r?\n?\s*\/\/ SIEMPRE/i.test(src) ||
    /Nunca llegó a funcionar/.test(src),
  "para que nadie lo quite sin saberlo"
);

console.log(
  fallos === 0
    ? "\nTODO OK — si el bot acaba de dar los datos, no los repite\n"
    : `\n${fallos} FALLO(S)\n`
);
process.exit(fallos === 0 ? 0 : 1);
