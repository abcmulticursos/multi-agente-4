// El comprobante no se pierde: la venta queda cerrada y nadie se queda el turno.
//
// EL CASO REAL
//
//   Lineal. Eligió «yape esta bien» con un cuadrito, recibió la cuenta, pagó, y
//   mandó el voucher escribiendo «listo ya pague / a que hora me mnda». El bot
//   contestó: «¡Hola! 😊 ¿Qué te gustaría saber sobre ...?» y el pago no se
//   registró.
//
//   Fallaron DOS cosas a la vez:
//
//   1. El cuadrito mandó los datos y dejó la conversación en `intro_done`, como
//      si no hubiera pasado nada. Los otros quince caminos de pago la dejan en
//      `payment_done`. La venta SÍ se cerraba, pero solo si el operador había
//      escrito el número de cuenta a mano en su cuadrito — o sea, solo si lo
//      tenía duplicado. El día que lo dejó en un solo sitio, dejó de cerrarse.
//
//   2. En `intro_done` sigue activa la respuesta rápida del saludo. Su
//      tolerancia a dedazos daba «HORA» por «HOLA» —una letra— y esa regla corta
//      el turno. El comprobante se quedó ahí.
//
//   Y la regla que existe para esto —«el comprobante va derecho al lector»— no
//   llegó a activarse, porque se apoyaba solo en la etapa.
//
// ESTA PRUEBA CORRE EL CÓDIGO DE VERDAD
//
//   La primera mitad no mira patrones: extrae del motor las funciones que
//   deciden si una respuesta rápida coincide, las ejecuta, y las pasa por las
//   61 palabras clave REALES de config/intro-data.yaml, en TODAS las
//   modalidades. Si alguna vuelve a tragarse una frase de pago, salta aquí.
//
//   node scripts/prueba-el-comprobante-no-se-pierde.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

const RAIZ = process.cwd();
const motor = readFileSync(
  join(RAIZ, "src", "lib", "workflow", "engine.ts"),
  "utf8"
);

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 64)} ${valor}`);
};

// ─────────────────────────────────────────────────────────────────────────────
// PARTE A — el código real del motor, ejecutándose
// ─────────────────────────────────────────────────────────────────────────────
//
// Se saca del propio engine.ts, no es una copia: si mañana alguien cambia esas
// funciones, esta prueba prueba lo nuevo.
function sacarDelMotor(nombre) {
  const inicio = motor.indexOf(`function ${nombre}(`);
  if (inicio < 0) throw new Error(`no encuentro function ${nombre} en el motor`);
  const fin = motor.indexOf("\n}", inicio);
  if (fin < 0) throw new Error(`no encuentro el final de ${nombre}`);
  return motor.slice(inicio, fin + 2);
}

const sinTipos = (codigo) =>
  codigo
    // tipos de retorno: "): boolean {" → ") {"
    .replace(/\)\s*:\s*[A-Za-z[\]|\s]+\{/g, ") {")
    // tipos de parámetro: "a: string," → "a,"
    .replace(/(\w+)\s*:\s*(?:string\[\]|string|SalesbotRule)\s*(?=[,)])/g, "$1");

const fuente = [
  `const LARGO_MINIMO_PARA_TOLERAR_DEDAZOS = ${
    motor.match(/const LARGO_MINIMO_PARA_TOLERAR_DEDAZOS = (\d+);/)?.[1] ?? "?"
  };`,
  sinTipos(sacarDelMotor("normalizeSalesbotText")),
  sinTipos(sacarDelMotor("areSalesbotWordsClose")),
  sinTipos(sacarDelMotor("fuzzySalesbotPhraseMatches")),
  sinTipos(sacarDelMotor("salesbotRuleMatches")),
  "return { salesbotRuleMatches, areSalesbotWordsClose };",
].join("\n\n");

const { salesbotRuleMatches, areSalesbotWordsClose } = new Function(fuente)();

// ── A.1 · La confusión exacta que le costó la venta ──────────────────────────
comprobar(
  '"hora" ya NO cuenta como "hola"',
  areSalesbotWordsClose("hora", "hola") === false,
  "una letra ≠ dedazo a 4 letras"
);
// Y NO SE ROMPE EL SALUDO. Escrito bien sigue funcionando igual que siempre.
comprobar(
  'y "hola" bien escrito sigue funcionando',
  areSalesbotWordsClose("hola", "hola") === true,
  "la regla no se toca"
);
// La tolerancia sigue viva donde se puso: palabras largas.
//
// De 5 a 6 letras admite UNA letra cambiada; de 7 en adelante, dos — por eso
// «reenvair» sigue cogiendo «reenviar», que es un cambio de orden (dos).
comprobar(
  "la tolerancia sigue viva en palabras largas",
  areSalesbotWordsClose("presio", "precio") === true &&
    areSalesbotWordsClose("metdo", "metodo") === true &&
    areSalesbotWordsClose("reenvair", "reenviar") === true,
  "«presio» → «precio»"
);

// ── A.2 · Sus reglas REALES contra frases REALES de pago ─────────────────────
//
// Aquí es donde se ve si el arreglo vale para TODAS las modalidades: se cargan
// las reglas tal como están en su archivo y se les pasan las frases con las que
// un cliente manda un comprobante.
const cfg = parse(readFileSync(join(RAIZ, "config", "intro-data.yaml"), "utf8"));
const reglasPorModalidad = cfg?.salesbot?.rules ?? {};
const modalidades = Object.keys(reglasPorModalidad);

const FRASES_DE_COMPROBANTE = [
  "listo ya pague",
  "a que hora me mnda",
  "listo ya pague a que hora me mnda",
  "ya pague a que hora me manda el material",
  "ahi esta el voucher",
  "ya te pase el pago, a que hora llega",
  "listo, a que hora me lo envias",
  "ya hice el pago a que hora me responden",
];

const atrapadas = [];
for (const modalidad of modalidades) {
  for (const regla of reglasPorModalidad[modalidad] ?? []) {
    if (regla?.enabled === false) continue;
    for (const frase of FRASES_DE_COMPROBANTE) {
      if (salesbotRuleMatches(regla, frase)) {
        atrapadas.push(`${modalidad}/${regla.id} ← "${frase}"`);
      }
    }
  }
}
comprobar(
  `ninguna respuesta rápida se queda una frase de comprobante`,
  atrapadas.length === 0,
  `${modalidades.length} modalidades, ${FRASES_DE_COMPROBANTE.length} frases`
);
if (atrapadas.length > 0) {
  for (const a of atrapadas) console.log(`        ⛔ ${a}`);
}

// Y LO QUE SÍ TIENE QUE SEGUIR FUNCIONANDO. Sin esto, "arreglar" seria apagarle
// el ahorro sin decirselo.
const debenSeguirCoincidiendo = [
  ["lineal", "ahorro_lineal_saludo", "hola"],
  ["lineal", "ahorro_lineal_saludo", "buenas tardes"],
  ["lineal", "ahorro_lineal_precio", "cuanto cuesta"],
  ["lineal", "ahorro_lineal_precio", "precio"],
  ["lineal", "ahorro_lineal_metodos_pago", "metodos de pago"],
];
const rotas = debenSeguirCoincidiendo.filter(([modalidad, id, frase]) => {
  const regla = (reglasPorModalidad[modalidad] ?? []).find((r) => r.id === id);
  return !regla || !salesbotRuleMatches(regla, frase);
});
comprobar(
  "y las respuestas rápidas que ya tenía siguen coincidiendo",
  rotas.length === 0,
  `${debenSeguirCoincidiendo.length} comprobadas`
);
if (rotas.length > 0) {
  for (const [m, id, f] of rotas) console.log(`        ⛔ ${m}/${id} ya no coge "${f}"`);
}

// ─────────────────────────────────────────────────────────────────────────────
// PARTE B — el cableado del motor
// ─────────────────────────────────────────────────────────────────────────────

// ── B.1 · Los datos de pago cierran la venta, salgan por donde salgan ────────
comprobar(
  "cerrar la venta está en UN solo sitio",
  /function dejarLaVentaEsperandoElComprobante\(/.test(motor),
  "una puerta"
);
comprobar(
  "el cuadrito/botón que manda un método la cierra",
  /if \(yaDioLosDatos\) \{\s*\r?\n\s*dejarLaVentaEsperandoElComprobante\(convo, metodo, cfgPago\);/.test(
    motor
  ) &&
    /dejarLaVentaEsperandoElComprobante\(convo, metodo, cfgPago\);\s*\r?\n\s*await schedulePaymentResponses\(/.test(
      motor
    ),
  "las dos ramas"
);
// Vale para TODAS las modalidades porque la accion vive en un solo sitio: la
// misma funcion que usan los cuadritos y los botones de cualquier modalidad.
comprobar(
  "y esa acción existe una sola vez en el motor",
  (motor.match(/case "send_payment_method":/g) ?? []).length === 1,
  "sirve a las 6 modalidades"
);
// Los otros dos cierres que ya existian pasan por la misma puerta, o volvemos a
// tener dos maneras de cerrar la misma venta.
comprobar(
  "los cierres del cuadrito también pasan por ahí",
  (motor.match(/dejarLaVentaEsperandoElComprobante\(convo, /g) ?? []).length >= 4,
  "sin caminos paralelos"
);
comprobar(
  "y ya no hay cierres sueltos en las ramas de cuadrito",
  !/setSelectedPaymentMethod\(convo\.id, metodo\);\s*\r?\n\s*setConversationState\(convo\.id, "payment_done"\);/.test(
    motor
  ) &&
    !/setSelectedPaymentMethod\(convo\.id, eligiendoMetodo\);\s*\r?\n\s*setConversationState\(convo\.id, "payment_done"\);/.test(
      motor
    ),
  "ninguno a mano"
);

// ── B.2 · Y no salpica al resto: ni adelanta ni retrocede ────────────────────
//
// Es la parte que protege lo que YA funciona. Adelantar la etapa con una
// eleccion pendiente seria abandonar el Order Bump a medias; retroceder desde la
// postventa romperia la entrega y el regalo.
comprobar(
  "solo avanza desde las etapas de ANTES del pago",
  /function laVentaTodaviaNoLlegoAlPago\(/.test(motor) &&
    /if \(!laVentaTodaviaNoLlegoAlPago\(convo\.state\)\) return;/.test(motor),
  "nunca desde otra"
);
const puerta = (() => {
  const i = motor.indexOf("function laVentaTodaviaNoLlegoAlPago(");
  return i < 0 ? "" : motor.slice(i, i + 900);
})();
comprobar(
  "no abandona una elección pendiente (bump / bioferta / doble)",
  !/awaiting_order_bump_choice|awaiting_bioferta|awaiting_order_bump_payment_choice/.test(
    puerta
  ),
  "esa etapa manda ella"
);
comprobar(
  "y NUNCA retrocede desde la postventa",
  !/payment_approved|awaiting_email|awaiting_gift_consent|awaiting_facebook_comment/.test(
    puerta
  ),
  "entrega y regalo a salvo"
);
// El metodo se anota igual venga de donde venga: de el dependen el reenvio de
// datos y contra que metodo se lee el comprobante.
comprobar(
  "el método se anota siempre, aunque la etapa no cambie",
  /setSelectedPaymentMethod\(convo\.id, metodo\);\s*\r?\n\s*if \(!laVentaTodaviaNoLlegoAlPago/.test(
    motor
  ),
  "antes de la puerta"
);
// Un turno puede pasar dos veces por aqui (el cuadrito cierra y su accion manda
// los datos). Sin refrescar la copia, avisaria a Meta por duplicado.
comprobar(
  "no avisa a Meta dos veces en el mismo turno",
  /setConversationState\(convo\.id, "payment_done"\);[\s\S]{0,400}?convo\.state = "payment_done";/.test(
    motor
  ),
  "la copia del turno se entera"
);

// ── B.3 · El comprobante va al lector aunque la etapa se quedara atrás ───────
comprobar(
  "el comprobante entra al lector si ya tiene la cuenta delante",
  /const yaLeDimosLaCuenta =\s*\r?\n\s*!!convo\.selected_payment_method\?\.trim\(\) &&\s*\r?\n\s*laVentaTodaviaNoLlegoAlPago\(state\);/.test(
    motor
  ) && /const esperandoUnPago =[\s\S]{0,200}?yaLeDimosLaCuenta \|\|/.test(motor),
  "el hecho manda sobre la etapa"
);
// Y solo en las etapas de antes del pago: en el regalo o el correo una imagen NO
// es un comprobante, y esa distincion ya estaba hecha.
comprobar(
  "y sigue sin tocar regalo, correo ni elección de opción",
  /const laImagenAquiNoEsUnPago =\s*\r?\n\s*state === "awaiting_order_bump_choice" \|\|/.test(
    motor
  ),
  "como estaba"
);

// ── B.4 · La tolerancia a dedazos ────────────────────────────────────────────
comprobar(
  "la tolerancia a dedazos empieza en 5 letras",
  /const LARGO_MINIMO_PARA_TOLERAR_DEDAZOS = 5;/.test(motor) &&
    !/a\.length < 4 \|\| b\.length < 4/.test(motor),
  "a 4 no es un dedazo"
);
comprobar(
  "y el mínimo está escrito una sola vez",
  (motor.match(/LARGO_MINIMO_PARA_TOLERAR_DEDAZOS/g) ?? []).length === 4,
  "sin números sueltos"
);

console.log(
  fallos === 0
    ? "\nTODO OK — la venta queda cerrada y el comprobante llega al lector"
    : `\n${fallos} comprobacion(es) mal.`
);
process.exit(fallos === 0 ? 0 : 1);
