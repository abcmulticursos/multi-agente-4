// El regalo sale cuando el CLIENTE lleva callado lo que puso el dueño.
//
// LO QUE PASO — 14 de septiembre de 2026, -OB-
//
//   El cliente estaba decidiendo el segundo producto. Se cruzo la pregunta del
//   regalo, quedaron DOS preguntas abiertas, y el bot ya no supo a cual
//   contestaba su «ok». Hasta se rio para salir del paso:
//
//       «Jaja, la decision es tuya 😊 ¿Te gustaria recibir ese regalito…?»
//
// LA CAUSA
//
//   El campo del editor se llama «Silencio antes de ofrecer el regalo (seg)»…
//   y no medía silencio. El plazo se programaba desde el instante en que le
//   tocaba el turno al regalo —al cerrarse la ventana del segundo producto—, no
//   desde el ultimo mensaje del cliente. Dos consecuencias:
//
//     · SE SUMABAN las dos esperas. Ventana de 3 min + campo de 60 s = el regalo
//       a los 4 minutos, y el dueño solo habia escrito uno de los dos numeros.
//     · Y bastaba con que el BOT tardara en contestar -hubo respuestas de 32
//       segundos- para que la ventana se comiera sola y el regalo cayera encima
//       de la conversacion.
//
// EL ARREGLO
//
//   El plazo se ancla al ULTIMO MENSAJE DEL CLIENTE. Pone 300 y el regalo sale
//   cuando el cliente lleva 300 segundos callado. Nunca en el pasado: si ese
//   momento ya paso, sale al segundo siguiente.
//
//   La ventana del segundo producto NO se toca.
//
//   node scripts/prueba-el-silencio-del-regalo-se-mide-desde-el-cliente.mjs
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
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 54)} ${valor}`);
};

// ── La cuenta real, sacada del motor ─────────────────────────────────────────
const i = motor.indexOf("function loQueFaltaDeSilencio(");
if (i < 0) throw new Error("no encuentro loQueFaltaDeSilencio en engine.ts");
const fin = motor.indexOf("\n}", motor.indexOf("): number {", i));
const cuerpo = motor
  .slice(i, fin)
  .replace(
    /function loQueFaltaDeSilencio\([\s\S]*?\): number \{/,
    "function loQueFaltaDeSilencio(conversationId, segundos) {"
  );

const AHORA = 1_800_000_000;
const armar = (hace) =>
  new Function(
    "conversationId",
    "segundos",
    [
      `const Date = { now: () => ${AHORA} * 1000 };`,
      hace === null
        ? "const getLatestUserMessage = () => null;"
        : `const getLatestUserMessage = () => ({ created_at: ${AHORA - hace} });`,
      cuerpo + "\n}",
      "return loQueFaltaDeSilencio(conversationId, segundos);",
    ].join("\n\n")
  );

// ── 1. El silencio se mide desde el cliente ──────────────────────────────────
console.log("— el plazo se cuenta desde el ultimo mensaje del cliente —\n");
comprobar(
  "acaba de escribir, pide 300 -> faltan 300",
  armar(0)(1, 300) === 300,
  "300 s"
);
comprobar(
  "escribio hace 100, pide 300 -> faltan 200",
  armar(100)(1, 300) === 200,
  "200 s"
);
comprobar(
  "escribio hace 240, pide 300 -> faltan 60",
  armar(240)(1, 300) === 60,
  "60 s"
);

// ── 2. LO QUE YA SE SUMABA, Y YA NO ──────────────────────────────────────────
//    El caso del dueño: ventana del segundo producto de 3 min, campo en 60 s.
//    Antes el regalo salia a los 4 minutos del silencio; ahora, a los 60 s.
console.log("\n— ya no se suman las dos esperas —\n");
comprobar(
  "tras 3 min de ventana, con el campo en 60 s -> sale YA",
  armar(180)(1, 60) === 1,
  "no espera otros 60"
);
comprobar(
  "y con el campo en 300 s, sale a los 300 del cliente",
  armar(180)(1, 300) === 120,
  "180 + 120 = 300"
);

// ── 3. Nunca en el pasado ────────────────────────────────────────────────────
console.log("\n— nunca se programa hacia atras —\n");
comprobar(
  "el silencio ya vencio -> al segundo siguiente",
  armar(9999)(1, 60) === 1,
  "1 s, no negativo"
);
comprobar(
  "sin ningun mensaje del cliente -> el plazo entero",
  armar(null)(1, 300) === 300,
  "no revienta"
);

// ── 4. La forma ──────────────────────────────────────────────────────────────
console.log("\n— la forma del arreglo —\n");
comprobar(
  "la pregunta del regalo usa la cuenta nueva",
  /scheduleGiftConsentWithDelay\(\s*conversationId,\s*loQueFaltaDeSilencio\(conversationId, timeoutSec\)/.test(
    motor
  ),
  "seguirConRegalo"
);
comprobar(
  "y al renovarla tambien",
  /const faltan = loQueFaltaDeSilencio\(convo\.id, segundos\);/.test(motor),
  "renovarEsperaDelRegalo"
);
// LA VENTANA DEL SEGUNDO PRODUCTO PASO A SER EL MISMO RELOJ.
//
// Cuando se escribio esta prueba eran dos plazos distintos y aqui se comprobaba
// que el del upsell no se habia movido. Horas despues el dueno pidio lo
// contrario y con razon: «necesito que solo haya un tiempo de espera para
// mostrar el ofrecimiento de regalo, deja solo el de la seccion regalo». Eran
// dos campos con el mismo nombre y el tiempo real era su suma.
//
// La intencion de esta linea no cambia —que el plazo salga de la configuracion
// y se cuente desde el cliente—; lo que cambia es que ahora hay UNO.
comprobar(
  "la ventana del segundo producto usa el mismo reloj",
  /Math\.floor\(Date\.now\(\) \/ 1000\) \+ loQueFaltaDeSilencio\(convo\.id, segundos\)/.test(
    motor
  ) && !/espera_minutos/.test(motor),
  "un solo plazo"
);

console.log(
  fallos === 0
    ? "\nTODO OK — pone un numero y ese numero es el silencio"
    : `\n${fallos} comprobacion(es) mal.`
);
process.exit(fallos === 0 ? 0 : 1);
