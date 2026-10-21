// El «si» al segundo producto no muere para siempre cuando sale el regalo.
//
// LO QUE ESTABA MAL
//
//   La puerta del «si» pelado exigia dos cosas:
//
//       const nadieMasPregunto =
//         hasPendingActionType(convo.id, ACTION_UPSELL_TIMEOUT) && esLaUltimaPregunta;
//
//   Ese `hasPendingActionType` significa «el plazo del segundo producto sigue
//   vivo». Y ese plazo, una vez vencido, NO VUELVE NUNCA. Asi que desde el
//   momento en que salia el regalo, un «si» pelado dejaba de aceptar el segundo
//   producto PARA EL RESTO DE LA CONVERSACION — aunque una hora despues el
//   regalo ya estuviera resuelto y volviera a haber una sola pregunta.
//
//   A partir de ahi solo se podia aceptar tocando el boton o escribiendo el
//   nombre del producto entero.
//
// LA REGLA QUE SE QUERIA ESCRIBIR
//
//   Esta en el comentario de al lado: «despues hay DOS preguntas abiertas y la
//   respuesta es de la mas reciente». Eso dura lo que dura la pregunta del
//   regalo, no para siempre. En cuanto el cliente la contesta -la acepte o la
//   rechace- vuelve a haber una sola.
//
// DONDE SE NOTA
//
//   El cliente vuelve mas tarde, pregunta que trae el segundo producto, el motor
//   le contesta con sus burbujas -y al hacerlo vuelve a sellar la oferta- y
//   entonces dice «si». Antes eso no se aceptaba. Ahora si.
//
//   node scripts/prueba-el-si-del-extra-no-muere-con-el-regalo.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const motor = readFileSync(
  join(RAIZ, "src", "lib", "workflow", "engine.ts"),
  "utf8"
);

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 56)} ${valor}`);
};

// ── La condicion real, sacada del motor ──────────────────────────────────────
const i = motor.indexOf("const elRegaloEstaEsperandoRespuesta =");
if (i < 0) throw new Error("no encuentro la condicion en engine.ts");
const bloque = motor.slice(i, motor.indexOf(";", motor.indexOf("nadieMasPregunto", i)) + 1);

const decidir = (state, esLaUltimaPregunta) =>
  new Function(
    "state",
    "esLaUltimaPregunta",
    bloque + "\nreturn nadieMasPregunto;"
  )(state, esLaUltimaPregunta);

// ── 1. Lo que estaba bloqueado para siempre ──────────────────────────────────
console.log("— el regalo ya salio y esta resuelto: el «si» vuelve a valer —\n");
comprobar(
  "regalo resuelto + oferta sellada -> ACEPTA",
  decidir("payment_approved", true) === true,
  "ya no hay dos preguntas"
);
comprobar(
  "tras comentar en Facebook + oferta sellada -> ACEPTA",
  decidir("awaiting_facebook_comment", true) === true,
  "tampoco estorba"
);
comprobar(
  "pidiendo el correo + oferta sellada -> ACEPTA",
  decidir("awaiting_email", true) === true,
  "tampoco estorba"
);

// ── 2. EL FRENO QUE SI TIENE QUE SEGUIR ──────────────────────────────────────
//    Con la pregunta del regalo en pantalla hay DOS preguntas abiertas y un «si»
//    a secas no dice a cual contesta. Ese fallo ya costo una venta cobrada de
//    mas y no vuelve.
console.log("\n— con la pregunta del regalo en pantalla, NO —\n");
comprobar(
  "esperando respuesta del regalo -> no acepta",
  decidir("awaiting_gift_consent", true) === false,
  "dos preguntas abiertas"
);
comprobar(
  "y sin sello tampoco, en ningun estado",
  decidir("payment_approved", false) === false &&
    decidir("awaiting_gift_consent", false) === false,
  "manda `esLaUltimaPregunta`"
);

// ── 3. La forma ──────────────────────────────────────────────────────────────
console.log("\n— la forma del arreglo —\n");
comprobar(
  "ya no se pregunta por el plazo vencido",
  !/hasPendingActionType\(convo\.id, ACTION_UPSELL_TIMEOUT\) &&\s*\r?\n?\s*esLaUltimaPregunta/.test(
    motor
  ),
  "sin bloqueo permanente"
);
comprobar(
  "el sello sigue mandando",
  /const nadieMasPregunto =\s*\r?\n?\s*!elRegaloEstaEsperandoRespuesta && esLaUltimaPregunta;/.test(
    motor
  ),
  "esLaUltimaPregunta intacto"
);
comprobar(
  "y el plazo del upsell sigue usandose donde le toca",
  (motor.match(/hasPendingActionType\(convo\.id, ACTION_UPSELL_TIMEOUT\)/g) || [])
    .length === 2,
  "renovar y la espera del regalo"
);

console.log(
  fallos === 0
    ? "\nTODO OK — el «si» deja de morir, pero no pisa al regalo"
    : `\n${fallos} comprobacion(es) mal.`
);
process.exit(fallos === 0 ? 0 : 1);
