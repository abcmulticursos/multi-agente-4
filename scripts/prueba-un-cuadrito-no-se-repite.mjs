// Una eleccion ya contestada no se vuelve a contestar.
//
// EL BUCLE, TAL CUAL PASO
//
//   cliente: "con yape realmente es el unico que tnego"  → salen sus 3 burbujas
//   cliente: "la verdad solo tengo bcp en este momento"  → salen las de BCP
//   cliente: "esa es la cuenta bcp"                      → OTRA VEZ las de BCP
//   cliente: "me rerefira a si esa es la cuenta bcp"     → OTRA VEZ las de BCP
//
//   El cuadrito no tenia memoria: cada mensaje que llevara la palabra volvia a
//   soltar el bloque entero. Y como la pregunta seguia sin responderse, el
//   cliente la repetia — un bucle del que no puede salir mientras siga
//   nombrando lo que acaba de elegir. Se va, y con razon.
//
// LO QUE NO SE PODIA HACER
//
//   Bloquear "por palabra repetida" a secas. PEDIR los datos otra vez
//   —"mandame los datos"— es legitimo y tiene que seguir funcionando. Callarse
//   ahi seria el fallo contrario, y peor: el cliente quiere pagar.
//
//   Y `messageAsksWhereToPay` no servia de arbitro: acepta el sustantivo a
//   secas —"la cuenta"—, asi que "¿esa es LA CUENTA bcp?" contaba como
//   peticion. Con esa vara, el bucle seguia vivo.
//
// EL SEGUNDO FALLO, ENCADENADO
//
//   Cuando las burbujas del cuadrito llevan la cuenta, ese cuadrito hace el
//   trabajo del motor — pero no dejaba rastro: sin metodo anotado y con la
//   conversacion en la etapa anterior. Despues el comprobante pierde su atajo
//   al lector ("llego un comprobante en estado payment_done") y el reenvio no
//   sabe que metodo reenviar. El cliente paga y el bot no espera ese pago.
//
//   node scripts/prueba-un-cuadrito-no-se-repite.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");
const motor = leer("src", "lib", "workflow", "engine.ts");
const base = leer("src", "lib", "db.ts");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 60)} ${valor}`);
};

// ── 1. La conversacion recuerda que ya contesto ──────────────────────────────
comprobar(
  "la conversación recuerda la última decisión",
  /ultima_decision: string \| null;/.test(base) &&
    /\["ultima_decision", "TEXT"\]/.test(base) &&
    /export function setUltimaDecision\(/.test(base),
  "tipo, migración y setter"
);
// Se anota en LAS DOS puertas. Anotando solo en una, el bucle vuelve por la
// otra: elegir en la pausa y repetir la palabra despues caia en el bloque de
// «fuera de la pausa», que no sabia que eso ya estaba contestado.
comprobar(
  "se anota en la pausa y fuera de ella",
  /setUltimaDecision\(convo\.id, claveDeCuadrito\(elegida\)\)/.test(motor) &&
    /setUltimaDecision\(convo\.id, claveDeLaDecision\)/.test(motor),
  "las dos puertas"
);
// NO SE REPITE LA PRESENTACION; LOS DATOS SI SE REENVIAN.
//
// Antes esto soltaba el turno al modelo, y el modelo decidia: en unas
// modalidades resumia «ya te compartí los datos» y en otras reenviaba el bloque
// entero, presentacion incluida. Misma frase del cliente, dos comportamientos,
// segun la moneda que saliera. Ahora lo hace el motor, igual en las seis.
comprobar(
  "y no se repite la misma",
  /convo\.ultima_decision === claveDeLaDecision &&/.test(motor) &&
    /ya estaba contestado → \$\{\s*\r?\n?\s*reenviado \? "le reenvío sus datos sin volver a presentar" : "no lo repito, contesta el modelo"/.test(
      motor
    ),
  "lo decide el motor"
);
// CAMBIAR DE OPINION SI VALE. Solo se bloquea la MISMA; otra decision sale y
// pasa a ser la ultima.
comprobar(
  "pero cambiar de opinión sí vale",
  /const claveDeLaDecision = suyo \? claveDeCuadrito\(suyo\) : "";/.test(motor),
  "otro cuadrito, otra clave"
);

// ── 1 bis. Y EL MISMO FRENO PARA CUALQUIER MÉTODO, DE CUALQUIER PAÍS ─────────
//
// El bucle no es de un metodo concreto: es de CUALQUIER eleccion que se vuelve
// a nombrar. Frenar solo el cuadrito lo dejaba vivo para quien no usa
// cuadritos, que es la mayoria — y para los metodos que cada pais configure.
comprobar(
  "los datos de pago tampoco se repiten, sea el método que sea",
  /convo\.ultima_decision === claveDeMetodo\(route\) &&\s*\r?\n\s*!pideQueLeRepitanLosDatos\(msgContent\)/.test(
    motor
  ),
  "no hay ningún método escrito aquí"
);
comprobar(
  "y se anota en los dos sitios que los mandan",
  (motor.match(/setUltimaDecision\(convo\.id, claveDeMetodo\(route\)\)/g) ?? [])
    .length === 2,
  "pago directo y camino clásico"
);
// El cuadrito y el metodo se guardan con prefijo: un cuadrito titulado «yape» y
// el metodo «yape» son elecciones distintas, y bloquear una por la otra seria
// callar donde toca hablar.
comprobar(
  "un cuadrito y un método no se confunden entre sí",
  /`cuadrito:\$\{decision\.id \|\| decision\.title \|\| ""\}`/.test(motor) &&
    /`metodo:\$\{route\}`/.test(motor),
  "llaves con prefijo"
);
// LA OFERTA DE 2 OPCIONES NO SE TOCA. Ahi nombrar el metodo no manda datos:
// abre la oferta, y esa tiene que abrirse siempre.
comprobar(
  "la oferta de 2 opciones se sigue abriendo",
  motor.indexOf("ya se le mandaron los datos de") <
    motor.indexOf("order bump (interceptando pago)"),
  "el freno va después"
);

// ── 2. Pedir los datos otra vez NO es repetirse ──────────────────────────────
const pedir = (() => {
  const i = motor.indexOf("function pideQueLeRepitanLosDatos(");
  return i < 0 ? "" : motor.slice(i, i + 900);
})();
comprobar(
  "hay una vara estricta para «pídemelos otra vez»",
  pedir.length > 0,
  "pideQueLeRepitanLosDatos"
);
// LA VARA FLOJA NO SIRVE AQUI: acepta el sustantivo a secas.
comprobar(
  "y no se usa la floja, que acepta «la cuenta» a secas",
  /!pideQueLeRepitanLosDatos\(msgContent\)/.test(motor) &&
    !/convo\.ultima_decision === claveDeLaDecision &&\s*\r?\n\s*!messageAsksWhereToPay/.test(
      motor
    ),
  "«¿esa es la cuenta?» es una pregunta"
);
// La regla, EJECUTADA con las frases reales de la prueba.
const normaliza = (t) =>
  (t ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const cuerpo = pedir.match(/return (\/\\b\(.*?\/)\.test\(/s);
const regex = cuerpo
  ? new RegExp(cuerpo[1].slice(1, cuerpo[1].lastIndexOf("/")))
  : null;
comprobar("la regla se pudo leer del código", regex !== null, "sí");
console.log("\n--- ¿pide que se los repitan? ---");
for (const [frase, esperado] of [
  ["esa es la cuenta bcp", false],
  ["me rerefira a si esa es la cuenta bcp", false],
  ["la verdad solo tengo bcp en este momento", false],
  ["con yape realmente es el unico que tnego", false],
  ["mandame los datos otra vez", true],
  ["dame la cuenta", true],
  ["a que numero pago", true],
  ["cual es la cuenta", true],
  ["donde pago", true],
]) {
  const dio = regex ? regex.test(normaliza(frase)) : false;
  comprobar(
    `«${frase}»`,
    dio === esperado,
    dio ? "se los repite" : "no se repite"
  );
}

// ── 3. El cuadrito que entrega los datos CIERRA la elección ──────────────────
//
// Sin esto, el comprobante pierde su atajo al lector y el reenvio no sabe que
// metodo reenviar: el cliente paga y el bot no esta esperando ese pago.
// Y las dos puertas cierran por el MISMO sitio que los quince caminos de pago
// del motor: `dejarLaVentaEsperandoElComprobante`. Con un cierre escrito a mano
// en cada rama volveriamos a tener dos maneras de cerrar la misma venta, y una
// de ellas se olvidaria de no retroceder desde la postventa.
comprobar(
  "\nfuera de la pausa, deja anotado el método y esperando el pago",
  /if \(eligiendoMetodo && susBurbujasCierranLaVenta\) \{[\s\S]{0,240}?dejarLaVentaEsperandoElComprobante\(convo, eligiendoMetodo, config\);/.test(
    motor
  ),
  "como si los hubiera mandado el motor"
);
comprobar(
  "y en la pausa, igual",
  /if \(susBurbujasLlevanLosDatos\(elegida\.steps\)\) \{[\s\S]{0,420}?dejarLaVentaEsperandoElComprobante\(convo, metodo, config\);/.test(
    motor
  ),
  "las dos puertas otra vez"
);
// EL CIERRE NO DEPENDE DE QUE HAYA ACCION ENLAZADA.
//
// Estaba metido en la rama de «sin accion», y eso lo ataba a algo que no pinta
// nada aqui: un cuadrito que da la cuenta cierra la venta lleve accion o no.
// Con una accion enlazada —aunque esa accion no aplique a la modalidad y no
// haga nada— la conversacion se quedaba sin metodo y en la etapa anterior, y el
// comprobante perdia su atajo al lector.
comprobar(
  "y no depende de que el cuadrito tenga acción",
  !/!elegida\.action && susBurbujasLlevanLosDatos/.test(motor) &&
    !/if \(eligiendoMetodo\) \{\s*\r?\n\s*setSelectedPaymentMethod/.test(motor),
  "lo decide su texto, no su enlace"
);
// Solo cuando SUS burbujas llevan la cuenta. Si no la llevan, el motor sigue
// mandando los datos y es el quien cierra la etapa.
comprobar(
  "solo cuando sus burbujas llevan la cuenta",
  /susBurbujasLlevanLosDatos\(elegida\.steps\)/.test(motor),
  "si no, cierra el motor"
);
// Y UNA ACCION QUE NO APLICA A ESTA MODALIDAD LO DICE.
//
// Se iba en silencio: en Lineal no hay oferta de dos opciones, asi que «elegir
// basico» enlazado a un cuadrito no hace nada — pero el cuadrito parece
// configurado y el log no decia ni una palabra.
comprobar(
  "una acción que no aplica avisa en el log",
  /pero esta modalidad no vende dos opciones → esa acción no hace nada/.test(
    motor
  ),
  "no se va en silencio"
);
// Y el comprobante conserva su atajo: esa regla mira `payment_done`.
comprobar(
  "y el comprobante conserva su atajo al lector",
  /const esperandoUnPago =\s*\r?\n\s*state === "payment_done" \|\|/.test(motor),
  "payment_done"
);

// ── 4. El log se puede leer ──────────────────────────────────────────────────
//
// Una prueba salia con una linea util por cada cincuenta de diagnostico.
comprobar(
  "el ruido de diagnóstico está apagado salvo que se pida",
  /process\.env\.DIAG_PAIS === "1" &&/.test(motor) &&
    /process\.env\.DIAG_PAIS === "1" &&/.test(
      leer("src", "lib", "workflow", "config.ts")
    ),
  "DIAG_PAIS=1"
);
comprobar(
  "cada mensaje abre con una cabecera legible",
  /\[wf:turno\] convo=\$\{convo\.id\} estado=\$\{convo\.state\}/.test(
    leer("src", "lib", "workflow", "messenger-country.ts")
  ),
  "[wf:turno]"
);
comprobar(
  "y las decisiones cuelgan de ella",
  (motor.match(/\[wf:decision\]/g) ?? []).length >= 4,
  "[wf:decision]"
);

console.log(
  fallos === 0
    ? "\nTODO OK — un cuadrito no se repite"
    : `\n${fallos} comprobacion(es) mal.`
);
process.exit(fallos === 0 ? 0 : 1);
