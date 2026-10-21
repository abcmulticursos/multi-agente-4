// UNA DUDA NO SE CONTESTA REPITIENDO LA CUENTA.
//
// LO QUE PASO — 28 de septiembre de 2026, su prueba HOLAP1. El cliente acababa
// de recibir los datos de pago y pregunto «es seguro». Lo que le llego:
//
//     «¡Entiendo tu pregunta!»
//     «Entendido, aqui estan nuevamente los datos 😊👇»
//     «🔴 Yape : 935… 🏦 BCP: 191… 💰️ Precio: S/. 10 SOLES»
//     «Una vez realizado nos envias la imagen de tu comprobante…»
//
// Con sus palabras: «me lanzo los datos de pago». Y la mitad peor: su pregunta se
// quedo sin contestar.
//
// EL BOT NO LEYO «es seguro» COMO UN SI. Se midio: ni `soloEstaDeAcuerdo` ni
// `isPurchaseAffirmative` la reconocen. La cadena fue otra, y esta en su registro:
//
//     convo 248: el bot iba a pedir un metodo ya elegido (yape)
//                → mando lo que ya habia contestado y luego sus datos
//
//   1. el modelo contesto y remato pidiendole OTRA VEZ el metodo de pago;
//   2. existe un freno para eso —su regla: el metodo elegido no se repregunta—;
//   3. ese freno recorta la respuesta y reenvia los datos;
//   4. el recorte cortaba en el PRIMER signo de interrogacion, y la
//      tranquilizacion venia justo detras. Sobrevivieron cuatro palabras.
//
// LAS DOS MITADES DEL ARREGLO:
//
//   A. SI LOS DATOS SIGUEN EN PANTALLA, NO SE REENVIAN. Es el mismo freno que ya
//      tenia la pieza hermana del motor; aqui faltaba.
//   B. EL RECORTE CORTA EN EL PRIMER METODO NOMBRADO, no en cualquier pregunta.
//      Es seguro porque a esa puerta solo se entra cuando la respuesta NOMBRA DOS
//      O MAS metodos: sin nombres no hay menu, y cortando en el primero ninguno
//      sobrevive.
//
//   node scripts/prueba-una-duda-no-se-contesta-con-la-cuenta.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const handler = readFileSync(
  join(RAIZ, "src", "lib", "meta", "handler.ts"),
  "utf8"
).replace(/\r\n/g, "\n");
const motor = readFileSync(
  join(RAIZ, "src", "lib", "workflow", "engine.ts"),
  "utf8"
).replace(/\r\n/g, "\n");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 56)} ${valor}`);
};

// ── SE TRAEN LAS FUNCIONES DE VERDAD, NO COPIAS ────────────────────────────
const cortar = (texto, desde, hasta) => {
  const i = texto.indexOf(desde);
  const f = texto.indexOf(hasta, i);
  return i < 0 || f < 0 ? "" : texto.slice(i, f);
};
const fuenteMetodo = cortar(
  handler,
  "function laRespuestaVuelveAPedirElMetodo(",
  "\n/**"
);
const fuenteRecorte = cortar(
  handler,
  "function loQueElBotYaRespondio(",
  "\nfunction isCommerceOrPriceQuestion("
);
const fuentePantalla = cortar(
  handler,
  "function losDatosSiguenEnPantalla(",
  "\nfunction loQueElBotYaRespondio("
);
const fuenteDatos = cortar(
  motor,
  "export function unTextoLlevaLosDatosParaPagar(",
  "\nfunction llevaLosDatosParaPagar("
);
comprobar(
  "se encuentran las cuatro piezas",
  !!fuenteMetodo && !!fuenteRecorte && !!fuentePantalla && !!fuenteDatos
);
if (!fuenteMetodo || !fuenteRecorte || !fuentePantalla || !fuenteDatos) {
  console.log("\nsin el codigo no se puede ejecutar nada. PARO.\n");
  process.exit(1);
}

/** Quita las anotaciones de tipo para poder EJECUTAR el codigo tal cual. */
const sinTipos = (s) =>
  s
    .replace(/export function/g, "function")
    .replace(/\|\s*null\s*\|\s*undefined/g, "")
    .replace(/:\s*(?:string|boolean|number)\b(?:\s*\[\])?/g, "");

/** SUS metodos, inventados: nunca los reales. */
const METODOS = [
  { label: "PAGOFACIL", aliases: [] },
  { label: "BANCOAZUL", aliases: ["azul"] },
];
const montar = (historia) =>
  new Function(
    "getPaymentMethods",
    "normalizeGalleryKey",
    "getRecentHistory",
    `${sinTipos(fuenteDatos)}
     ${sinTipos(fuenteMetodo)}
     ${sinTipos(fuentePantalla)}
     ${sinTipos(fuenteRecorte)}
     return { laRespuestaVuelveAPedirElMetodo, loQueElBotYaRespondio, losDatosSiguenEnPantalla, unTextoLlevaLosDatosParaPagar };`
  )(
    () => METODOS,
    (v) =>
      (v ?? "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{Mn}/gu, "")
        .replace(/[^a-z0-9]+/g, " ")
        .trim()
        .replace(/\s+/g, " "),
    () => historia
  );

const f = montar([]);

// ── 1. SU CASO: LA DUDA SE CONTESTA ────────────────────────────────────────
console.log("\n— 1. la duda del cliente sobrevive al recorte —\n");
const SU_RESPUESTA =
  "¡Entiendo tu pregunta! Es totalmente seguro, llevamos años vendiendo y recibes tu material al instante. ¿Deseas pagar con PAGOFACIL o con BANCOAZUL?";
comprobar(
  "esa respuesta SI pide el metodo otra vez",
  f.laRespuestaVuelveAPedirElMetodo(SU_RESPUESTA, "x") === true,
  "por eso entra la puerta"
);
const conservado = f.loQueElBotYaRespondio(SU_RESPUESTA, "x");
comprobar(
  "se conserva la tranquilizacion ← SU FALLO",
  /totalmente seguro/.test(conservado),
  conservado.replace(/\s+/g, " ").slice(0, 44)
);
comprobar(
  "y NO sale la pregunta del metodo",
  !/PAGOFACIL/i.test(conservado) && !/BANCOAZUL/i.test(conservado),
  "ningun nombre de metodo"
);
comprobar(
  "lo conservado ya no pide metodo",
  f.laRespuestaVuelveAPedirElMetodo(conservado, "x") === false,
  "el cerrojo del final"
);

// ── 2. EL CASO QUE PUSO LA REGLA, INTACTO ──────────────────────────────────
//
// «Tenemos X y Z. ¿Cual prefieres?» tiene que seguir sin conservar nada: el
// primer trozo ya nombra metodos, asi que se corta ahi.
console.log("\n— 2. el caso que puso la regla, igual que antes —\n");
comprobar(
  "el menu de metodos no conserva nada",
  f.loQueElBotYaRespondio(
    "Tenemos PAGOFACIL y BANCOAZUL. ¿Cual prefieres?",
    "x"
  ) === "",
  "como hasta hoy"
);
// ESTE CASO PUSO LA PRUEBA EN ROJO y por eso existe la segunda mitad del
// arreglo. Al quitar el signo de pregunta del corte, «¿Con cual pagas?» quedaba
// conservado —no nombra ningun metodo— y ESA es la pregunta del metodo escrita
// sin nombrarlos. Justo lo que la puerta existe para frenar.
comprobar(
  "la pregunta del metodo SIN nombres tampoco sale ← EL ROJO",
  f.loQueElBotYaRespondio(
    "¿Con cual pagas? Tenemos PAGOFACIL y BANCOAZUL.",
    "x"
  ) === "",
  "la pregunta del final se tira"
);
comprobar(
  "  y una pregunta suelta pegada al menu, igual",
  f.loQueElBotYaRespondio(
    "Es un buen momento. ¿Te lo preparo? Puedes pagar con PAGOFACIL o BANCOAZUL.",
    "x"
  ) === "Es un buen momento.",
  "queda la frase, no la pregunta"
);
comprobar(
  "y el anuncio de la lista sin terminar, tampoco",
  f.loQueElBotYaRespondio(
    "¡Claro! 😊 Los metodos de pago disponibles son:",
    "x"
  ) === "",
  "una frase cortada no contesta nada"
);

// ── 2-bis. UN IMPORTE NO SE PARTE EN DOS ───────────────────────────────────
//
// SE MIDIO el 28/09/2026 buscando otra cosa: este recorte parte las frases en
// CADA punto, y los importes llevan puntos dentro —«S/. 10 SOLES», «$ 9.500»—.
// El importe quedaba partido, asi que cualquier regla que descarte un trozo
// podia quedarse con el simbolo y tirar el numero.
//
// Un punto pegado a una cifra no cierra frase. No hizo falta que le rompiera una
// venta para arreglarlo.
console.log("\n— 2-bis. el importe no se parte —\n");
const conMoneda = f.loQueElBotYaRespondio(
  "El pack tiene un precio de *S/. 10 SOLES*. Es un solo pago y accedes de por vida. ¿Pagas con PAGOFACIL o BANCOAZUL?",
  "x"
);
comprobar(
  "el numero sigue pegado a su moneda",
  /S\/\. 10 SOLES/.test(conMoneda),
  conMoneda.replace(/\s+/g, " ").slice(0, 42)
);
comprobar(
  "  y la frase de detras tambien sale",
  /por vida/.test(conMoneda),
  "no se pierde nada por el camino"
);
const conMiles = f.loQueElBotYaRespondio(
  "Cuesta $ 9.500 ARS. Es pago unico. ¿Pagas con PAGOFACIL o BANCOAZUL?",
  "x"
);
comprobar(
  "y un importe con miles no se corta por el punto",
  /9\.500/.test(conMiles),
  conMiles.replace(/\s+/g, " ").slice(0, 42)
);

// ── 3. PREGUNTAS INOCENTES QUE ANTES SE PERDIAN ────────────────────────────
console.log("\n— 3. una pregunta que no es del metodo, ya no corta —\n");
const conPreguntaInocente = f.loQueElBotYaRespondio(
  "¿Te preocupa la seguridad? Es un pago unico y recibes todo al instante. Puedes pagar con PAGOFACIL o BANCOAZUL, dime cual.",
  "x"
);
comprobar(
  "se conserva la respuesta entera",
  /pago unico/.test(conPreguntaInocente),
  conPreguntaInocente.replace(/\s+/g, " ").slice(0, 44)
);
comprobar(
  "  y sigue sin nombrar metodos",
  !/PAGOFACIL|BANCOAZUL/i.test(conPreguntaInocente),
  "el corte esta en el nombre"
);

// ── 4. ¿LOS DATOS SIGUEN EN PANTALLA? ──────────────────────────────────────
console.log("\n— 4. si la cuenta ya esta en pantalla —\n");
const suTurnoDePago = [
  { role: "user", content: "ok" },
  { role: "assistant", content: "PAGOFACIL: 935286681 — a nombre de quien sea" },
  { role: "assistant", content: "Una vez realizado nos envias la imagen 🤳" },
];
comprobar(
  "el TURNO entero cuenta, no la ultima burbuja ← LO QUE IMPORTA",
  montar(suTurnoDePago).losDatosSiguenEnPantalla(1) === true,
  "la cuenta iba dos burbujas antes"
);
comprobar(
  "si el turno del bot no llevaba cuenta, no",
  montar([
    { role: "user", content: "que contiene" },
    { role: "assistant", content: "Trae 55 modelos y 32 videos 😊" },
  ]).losDatosSiguenEnPantalla(1) === false,
  "ahi si hay que reenviar"
);
// ESTA COMPROBACION CAMBIO DE INTENCION EL 02/10/2026, Y ES EL UNICO CAMBIO DE ESTE
// ARCHIVO.
//
// DECIA: «se para en el mensaje del cliente, no sigue hacia atras — era de otro turno».
// La idea era que la cuenta solo contaba si el bot la acababa de dar EN ESE MISMO turno.
//
// LO QUE PASO — el dueño, ese dia: tenia la cuenta, escribio «si pero no me van a
// estafar», y el bot se la solto otra vez. Con sus palabras: «pero yo no he pedido datos
// ¿por que tiene que soltar datos?».
//
// Y TENIA RAZON. Entre la cuenta y su pregunta se habian metido un seguimiento y una
// respuesta, asi que quedo «de otro turno» y este freno la dio por perdida. En una
// conversacion de verdad SIEMPRE se mete algo en medio: con la regla vieja, el freno solo
// servia en el caso que casi nunca ocurre.
//
// AHORA LA PREGUNTA ES OTRA: no «¿fue lo ultimo que dije?», sino «¿se la di hace poco?».
// Veinte mensajes, que es lo que cabe en una pantalla de telefono sin desplazarse mucho.
//
// LO QUE PROTEGIA SIGUE PROTEGIDO, y se comprueba justo arriba y justo abajo: si el bot
// NUNCA dio la cuenta, esto dice false y se reenvia; y si quedo de verdad lejos, tambien.
comprobar(
  "y la ve aunque sea de un turno anterior, si fue hace poco",
  montar([
    { role: "assistant", content: "PAGOFACIL: 935286681" },
    { role: "user", content: "gracias" },
    { role: "assistant", content: "¡Con gusto! 😊" },
  ]).losDatosSiguenEnPantalla(1) === true,
  "se la dio hace dos mensajes"
);

// ── 5. COMO QUEDA CONECTADO ────────────────────────────────────────────────
console.log("\n— 5. conectado en la puerta de siempre —\n");
comprobar(
  "el reenvio se salta si ya estan en pantalla",
  /const yaEstabanEnPantalla = losDatosSiguenEnPantalla\(convo\.id\);/.test(
    handler
  ) &&
    /const reenviado = yaEstabanEnPantalla\s*\n?\s*\? false\s*\n?\s*: await resendPaymentDetails\(alEnviar, \{ conFrase: true \}\);/.test(
      handler
    ),
  "no una puerta nueva"
);
comprobar(
  "la puerta sigue frenando la pregunta del metodo",
  /laRespuestaVuelveAPedirElMetodo\(reply, alEnviar\.phone\)/.test(handler),
  "su regla sigue en pie"
);
comprobar(
  "y NUNCA se queda callado",
  /dejo pasar su respuesta/.test(handler),
  "sustituir con nada es peor"
);
comprobar(
  "el motor comparte su detector, no hay copia",
  /export function unTextoLlevaLosDatosParaPagar\(/.test(motor) &&
    /unTextoLlevaLosDatosParaPagar,/.test(handler),
  "una sola idea de «lleva los datos»"
);

console.log(`\n${fallos === 0 ? "TODO EN VERDE" : `${fallos} EN ROJO`}\n`);
process.exit(fallos === 0 ? 0 : 1);
