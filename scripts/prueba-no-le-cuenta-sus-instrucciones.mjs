// LAS INSTRUCCIONES DEL BOT NO SE LE CUENTAN AL CLIENTE.
//
// LO QUE PASO — 2 de octubre de 2026, sus pruebas HA1 y HLEA1. Pregunto «hola cual es el
// precio» y el bot le contesto, PALABRA POR PALABRA, lo que dice su propio prompt:
//
//   «Si el usuario ya esta en etapa de pago no ofrezcas el producto de nuevo. No
//    presiones con preguntas cerradas del tipo "¿lo queres?"…»
//
// Y en la otra conversacion, en ingles: «If you are not sure, ask the customer what they
// were quoted». Despues de eso, el precio.
//
// Con sus palabras: «se esta filtrando informacion interna de alguna manera hacia el
// usuario. no me permite hacer la prueba en ese estado».
//
// ── POR QUE NO LO PARABA NADIE ─────────────────────────────────────────────
//
// Habia un freno para respuestas CORTADAS —el de `finish_reason === "length"`— y en su
// registro se ve trabajar: «respuesta incompleta (length); reintento 1… reintento 2… uso
// fallback seguro». Pero estas respuestas NO estaban cortadas: estaban completas, y lo
// que traian dentro eran las instrucciones. Nadie preguntaba eso.
//
// ── COMO SE RECONOCE SIN UNA LISTA DE FRASES ───────────────────────────────
//
// Se compara con el PROMPT DE VERDAD, el que se acaba de mandar en esa misma llamada. Si
// un trozo largo de la respuesta esta escrito igual ahi dentro, lo esta copiando.
//
// NO ES EL PARCHE PALABRA POR PALABRA que esta casa tiene prohibido: aqui no hay ni una
// frase escrita. El dia que el dueño cambie una instruccion, esto la reconoce igual,
// porque lee la instruccion — no una copia suya.
//
//   node scripts/prueba-no-le-cuenta-sus-instrucciones.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const fuente = readFileSync(join(RAIZ, "src", "lib", "openrouter.ts"), "utf8");

let fallos = 0;
const pad = (s, n) => (String(s ?? "") + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 56)} ${valor}`);
};

// ── EL DETECTOR, EXTRAIDO DEL CODIGO REAL ─────────────────────────────────
//
// Se saca del archivo, no se reescribe: un detector reimplementado prueba lo que uno cree
// que hace, que es justo lo que se esta poniendo en duda.
const i = fuente.indexOf("const laRespuestaCopiaLasInstrucciones = (() => {");
const f = fuente.indexOf("})();", i);
if (i < 0 || f < 0) {
  console.log("FALLA no encuentro el detector en openrouter.ts");
  process.exit(1);
}
const cuerpo = fuente
  .slice(i, f + 5)
  .replace("const laRespuestaCopiaLasInstrucciones = (() => {", "")
  .replace(/\}\)\(\);$/, "")
  .replace(/:\s*string/g, "");
const copia = new Function(
  "text",
  "messages",
  `${cuerpo.replace(/^\s*return false;/m, "return false;")}`
);

// Textos INVENTADOS: el detector no puede conocer ni sus instrucciones ni sus productos.
const INSTRUCCIONES =
  "Cierra con una sola linea calida que invite a llevarlo o a elegir una de las opciones. " +
  "No presiones con preguntas cerradas del tipo cuanto antes mejor ni insistas dos veces. " +
  "If you are not sure about an amount, ask the customer what they were quoted before.";
const elPrompt = [{ role: "system", content: INSTRUCCIONES }];

console.log("\n— lo que copia las instrucciones se caza —\n");
comprobar(
  "una respuesta que es las instrucciones enteras",
  copia(INSTRUCCIONES, elPrompt) === true
);
comprobar(
  "y una que las lleva pegadas DELANTE de la respuesta",
  copia(
    "No presiones con preguntas cerradas del tipo cuanto antes mejor ni insistas dos veces. El precio es 10.",
    elPrompt
  ) === true,
  "fue su caso HA1"
);
comprobar(
  "y un trozo en ingles en medio de un texto en español",
  copia(
    "If you are not sure about an amount, ask the customer what they were quoted before. Hola, el pack esta en oferta.",
    elPrompt
  ) === true,
  "fue su caso HLEA1"
);

console.log("\n— y una respuesta normal NO se caza —\n");
comprobar(
  "una contestacion de venta corriente",
  copia(
    "Hola! El curso esta en 10 soles con la promocion de hoy. Es un unico pago y lo recibes al instante. ¿Te lo preparo?",
    elPrompt
  ) === false,
  "nada que ver con el prompt"
);
comprobar(
  "una frase corta no se mira siquiera",
  copia("Claro, te explico.", elPrompt) === false,
  "menos de 60 letras"
);
comprobar(
  "y una coincidencia corta tampoco basta",
  copia("Cierra con una sola linea. Son 10 soles.", elPrompt) === false,
  "coincide poco, y poco no es copiar"
);
comprobar(
  "sin prompt no se caza nada",
  copia(INSTRUCCIONES, []) === false,
  "no se inventa una fuga"
);

// ── LO QUE HACE CUANDO LA CAZA ────────────────────────────────────────────
console.log("\n— y lo que hace al cazarla —\n");
comprobar(
  "le pide que lo reescriba, dos veces",
  /if \(fugaDeInstruccionesRetries < 2\) \{/.test(fuente) &&
    /RETRY REQUIRED: your previous answer repeated these instructions/.test(fuente),
  "como los otros guardarrailes"
);
comprobar(
  "y si insiste, NO manda ni un trozo",
  /sigue copiando las instrucciones; uso el aviso de siempre/.test(fuente) &&
    /workflowConfig\?\.emergencia_no_entendi\?\.trim\(\)/.test(fuente),
  "el aviso es suyo y ya existia"
);
comprobar(
  "no hay ninguna frase suya escrita en el detector",
  !/no ofrezcas el producto|te gustaria que te|quisieras/i.test(cuerpo),
  "lee el prompt, no una copia"
);

console.log(
  fallos === 0
    ? "\nTODO OK — el cliente no ve las instrucciones del bot\n"
    : `\n${fallos} FALLO(S)\n`
);
process.exit(fallos === 0 ? 0 : 1);
