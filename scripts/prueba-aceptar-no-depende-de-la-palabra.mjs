// ACEPTAR NO DEPENDE DE LA PALABRA QUE USE EL CLIENTE.
//
// LO QUE PASO — 24 de septiembre de 2026, vendiendo en Argentina. Cuatro
// conversaciones en paralelo. En tres de ellas el cliente acepto comprar:
//
//     «OKA»        -> el motor lo entendio: datos de pago al instante, 0 tokens
//     «si»         -> igual
//     «esta bien»  -> NADA. Se fue al modelo (7.701 tokens) y le pregunto el
//                     metodo. Lo repitio y gasto otros 7.765. No vendio.
//
// LA CAUSA, medida: la aceptacion se decidia con una lista de frases y «esta
// bien» no estaba en ella. Con sus palabras: «el bot estaba corregido para leer
// el contexto y ya no regirse por palabritas».
//
// POR QUE NO SE AÑADIO LA FRASE A LA LISTA. Es el parche que esta casa ya pago
// tres veces: el cliente no escribe la palabra del ejemplo, escribe la suya.
// Manana llega «me parece» y volvemos aqui.
//
// LO QUE SE HIZO, Y ES AL REVES DE UNA LISTA DE CAPTURA: se comprueba que el
// mensaje no lleve NADA MAS que acuerdo. Cualquier palabra con contenido propio
// —un tema, una duda, una marca, un producto— lo descarta. La lista es de
// gramatica, esta CERRADA POR DEFECTO, y lo que no reconoce lo rechaza.
//
// LA ASIMETRIA QUE PROTEGE: si algun dia falla, falla dejando pasar una venta.
// NUNCA mandando datos de pago a quien preguntaba otra cosa.
//
// LOS FIXTURES SON SUS MENSAJES DE VERDAD, los de ese registro, mezclados como
// llegaron: aceptaciones y preguntas en la misma tanda.
//
//   node scripts/prueba-aceptar-no-depende-de-la-palabra.mjs
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { readFileSync } from "node:fs";

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

const { soloEstaDeAcuerdo, isPriceQuestion } = await import(
  pathToFileURL(join(RAIZ, "src", "lib", "workflow", "config.ts")).href
);

let fallos = 0;
const comprobar = (titulo, ok, nota = "") => {
  if (!ok) fallos++;
  console.log(
    `${ok ? "ok   " : "FALLA"} ${titulo.padEnd(48).slice(0, 48)} ${nota}`
  );
};

// ── LO QUE SÍ ES ACEPTAR ─────────────────────────────────────────────────────
console.log("-- acepta, y el motor no tiene que llamar al modelo --------");
const ACEPTAN = [
  "esta bien", // el que falló y costó 15.000 tokens
  "está bien",
  "OKA",
  "si",
  "sí",
  "listo",
  "dale",
  "dale pues",
  "bueno ya",
  "ya esta bien",
  "me parece bien",
  "perfecto",
  "ok gracias",
  "esta bien amigo",
  "ta bien",
  "de acuerdo",
  "hagamoslo",
  "excelente",
  "vale",
  "claro",
  "ya pe listo",
  "esta bien 😊",
  "OK!!",
  "lo quiero",
];
for (const frase of ACEPTAN) {
  comprobar(`«${frase}»`, soloEstaDeAcuerdo(frase) === true, "es un si");
}

// ── LO QUE NO ES ACEPTAR, Y ES LA MITAD QUE IMPORTA ──────────────────────────
//
// Todos estos llegaron en su misma prueba. Si alguno se leyera como aceptación,
// el cliente recibiría datos de pago en vez de la respuesta que pidió.
console.log("\n-- NO acepta: la mitad que protege la venta ----------------");
const NO_ACEPTAN = [
  "HOLA",
  "no entiendo",
  "precio",
  "contenido",
  "COMO ME ENVIA",
  "como es eso",
  "no es estafa",
  ".",
  "",
  "UALA",
  "transferencia",
  "no",
  "no gracias",
  "todavia no",
  "esta bien pero cuanto cuesta",
  "listo y cuanto es",
  "bueno, contenido",
  "esta bien el precio",
  "quiero saber que trae",
  "mejor el otro",
  "ok pero que incluye",
  "si es estafa",
  "esta bien hecho el curso",
  // AMBIGUOS A PROPÓSITO, y se quedan del lado seguro: «me parece» puede acabar
  // en «bien» o en «caro». Solo relleno no es un sí.
  "me parece",
  "ya pues",
  "entonces",
];
for (const frase of NO_ACEPTAN) {
  comprobar(
    `«${frase}»`,
    soloEstaDeAcuerdo(frase) === false,
    "no manda datos de pago"
  );
}

// ── Y LA REGLA NO DECIDE SOLA ────────────────────────────────────────────────
console.log("\n-- es el desempate, no la regla entera ---------------------");
const motor = readFileSync(
  join(RAIZ, "src", "lib", "workflow", "engine.ts"),
  "utf8"
);
comprobar(
  "la puerta de lineal la consulta",
  /soloEstaDeAcuerdo\(msgContent\)/.test(motor),
  "junto a la de siempre, en OR"
);
comprobar(
  "y sigue exigiendo la estructura de la venta",
  /getActiveModalityKey\(config\) !== "lineal"[\s\S]{0,900}?soloEstaDeAcuerdo/.test(
    motor
  ) &&
    /soloEstaDeAcuerdo\(msgContent\)\s*\)\s*\n\s*return false;\s*\n\s*if \(isPriceQuestion/.test(
      motor
    ),
  "modalidad, metodo, intro y precio"
);
comprobar(
  "lo que ya funcionaba no se quitó",
  /isPurchaseAffirmative\(msgContent\) && !soloEstaDeAcuerdo/.test(motor),
  "las dos señales, no una en vez de otra"
);
comprobar(
  "una pregunta de precio nunca es aceptación",
  isPriceQuestion("esta bien cuanto cuesta") === true,
  "la puerta la descarta aparte"
);

console.log(
  fallos === 0
    ? "\nTODO OK — aceptar no depende de la palabra, y preguntar no es aceptar\n"
    : `\n${fallos} comprobacion(es) mal.\n`
);
process.exit(fallos === 0 ? 0 : 1);
