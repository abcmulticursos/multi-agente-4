// EN «COMO -DOU-», UN ACUERDO SUELTO TAMBIEN ANOTA LA ELECCION
//
// LO QUE PASO — 3 de octubre de 2026. Midiendo las TRES semimodalidades del dueño con las
// mismas frases aparecio una asimetria que nadie habia escrito:
//
//                          un producto   COMO -OB-   COMO -DOU-
//     «si», «ok», «dale»        si           si           si
//     «esta bien», «vale»       si           si           NO
//     «de acuerdo», «listo»     si           si           NO
//
// En COMO -DOU- el bot proponia una opcion, el cliente contestaba «esta bien» y la eleccion
// NO se anotaba: el turno se iba al modelo. Es la forma exacta del fallo que este proyecto
// ya pago una vez —convo 127 del 16/09, cuando hubo que decir «si» dos veces para lo mismo.
//
// EL ARREGLO ES UN INTERRUPTOR, no un ensanche. `laPropuestaDelBotQueElClienteAfirmo` la
// llaman TRES sitios y los otros dos no son la eleccion de dos opciones: tocar el detector
// de dentro los moveria a los tres. Con el interruptor apagado por defecto, los otros dos se
// comportan letra por letra como antes — medido: identico en 32 frases.
//
// Y NO SE ENSANCHO `detectaSiSimpleAlUpsell`, que seria lo natural: ese mismo detector
// atiende la oferta del producto extra, y tocarlo cambiaria la segunda venta.
//
//   node scripts/prueba-el-si-en-como-dou-vale-igual.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const fuente = readFileSync(
  join(RAIZ, "src", "lib", "workflow", "engine.ts"),
  "utf8"
);

let fallos = 0;
const comprobar = (titulo, condicion, detalle) => {
  const marca = condicion ? "  ok  " : "> FALLA";
  if (!condicion) fallos++;
  console.log(`${marca} ${titulo.padEnd(58)} ${detalle ?? ""}`);
};

// -- 1. LA PUERTA ACEPTA LAS DOS FORMAS, Y SOLO CON EL INTERRUPTOR ------------
const ini = fuente.indexOf("function laPropuestaDelBotQueElClienteAfirmo(");
comprobar("la puerta del «si» a lo que el bot propuso existe", ini > 0);
// La ventana es generosa a proposito: esta funcion lleva encima el relato del fallo, y una
// ventana justa deja fuera lo que se quiere vigilar sin que nadie se entere.
const cuerpo = fuente.slice(ini, ini + 4200);
comprobar(
  "acepta el detector anclado O un acuerdo suelto",
  /detectaSiSimpleAlUpsell\(msgContent\) \|\|\s*\r?\n?\s*\(opciones\?\.tambienElAcuerdoSuelto === true &&\s*\r?\n?\s*soloEstaDeAcuerdo\(msgContent\)\)/.test(
    cuerpo
  ),
  "las dos, con un O"
);
comprobar(
  "el acuerdo suelto SOLO cuenta si el interruptor esta encendido",
  /tambienElAcuerdoSuelto === true &&/.test(cuerpo),
  "apagado por defecto: los otros sitios no se enteran"
);

// -- 2. Y EL INTERRUPTOR LO ENCIENDE UNA SOLA PUERTA: LA DE COMO -DOU- --------
//
// Si mañana alguien lo enciende en los otros dos sitios, esto se pone rojo. Esos dos no son
// la eleccion de dos opciones y el dueño no pidio moverlos.
const encendidos = (fuente.match(/tambienElAcuerdoSuelto:\s*true/g) ?? []).length;
comprobar(
  "lo enciende EXACTAMENTE una puerta",
  encendidos === 1,
  `encontradas: ${encendidos}`
);
// Esta puerta lleva DOS relatos escritos encima —el del comprobante que se perdia y el de
// la eleccion— asi que la ventana tiene que llegar hasta su final de verdad, no a un numero
// redondo: con una ventana corta, la comprobacion pasaba a verde sin mirar nada.
const puertaDou = fuente.indexOf('if (state === "awaiting_doble_oferta_dos_choice") {');
const hastaElFinalDeLaPuerta = fuente.slice(
  puertaDou,
  fuente.indexOf("return trySalesbotOrLlm(convo, msgContent, config);\n  }", puertaDou)
);
comprobar(
  "y la que lo enciende es la de COMO -DOU-",
  /tambienElAcuerdoSuelto:\s*true/.test(hastaElFinalDeLaPuerta),
  "awaiting_doble_oferta_dos_choice"
);

// -- 3. EL LIMITE QUE SE DEJA A PROPOSITO, Y POR QUE ------------------------
//
// NO se añade `isPurchaseAffirmative` aqui, aunque seria lo que daria paridad total con
// lineal y COMO -OB-. MEDIDO: esa funcion dice «si» a «quiero saber que contiene», «quiero
// ver fotos» y «quiero preguntar algo». En lineal y en COMO -OB- hay guardas ANTES que lo
// paran; en esta puerta no las hay, asi que meterla aqui registraria una eleccion cuando el
// cliente solo esta preguntando — y eso es cobrarle por una duda.
//
// Quedan cinco frases sin cubrir a proposito: «asi es», «por supuesto», «de una», «ya pues»
// y «ya quiero adquirirlo». Si algun dia hacen falta, se hace con sus propias guardas.
// SE MIRA SI SE LLAMA, NO SI SE NOMBRA. El comentario de arriba la nombra a proposito para
// explicar por que NO se usa; buscar el nombre a secas ponia esta comprobacion roja por el
// propio texto que la justifica.
const sinComentarios = cuerpo
  .split(/\r?\n/)
  .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
  .join("\n");
comprobar(
  "no se cuela el detector ancho en esta puerta",
  !/isPurchaseAffirmative\s*\(/.test(sinComentarios),
  "«quiero saber que contiene» no puede anotar una eleccion"
);
comprobar(
  "y el limite queda escrito donde se lee",
  /quiero saber/i.test(cuerpo) || /SABER/.test(cuerpo),
  "para que nadie lo descubra por sorpresa"
);

// -- 4. LO QUE PROTEGE EL ACUERDO SUELTO -------------------------------------
//
// `soloEstaDeAcuerdo` exige que el mensaje NO DIGA NADA MAS, asi que «si pero no es estafa»
// sigue sin anotar nada. Es la misma funcion que ya usan lineal y COMO -OB- desde el 2 de
// octubre. Si alguien la cambiara por otra que mire «en cualquier parte», volveria el fallo
// de los datos de pago soltados a quien solo preguntaba.
comprobar(
  "el acuerdo suelto se lee con la funcion probada",
  /soloEstaDeAcuerdo\(msgContent\)/.test(cuerpo),
  "exige que el mensaje no diga nada mas"
);

console.log("");
if (fallos > 0) {
  console.log(`> ${fallos} FALLA(S)`);
  process.exit(1);
}
console.log("TODO OK — en COMO -DOU- un acuerdo suelto anota la eleccion, como en las otras dos");
