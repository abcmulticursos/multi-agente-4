// El comprobante llegaba y nadie lo leia.
//
// El cliente eligio COMBO, cambio a BASICO, pago, y mando la foto del voucher
// escribiendo en la MISMA burbuja: «listo ya pague / a que hora me envia».
// El bot le contesto reenviandole el numero de cuenta. La venta no se registro.
//
// DOS CAUSAS, UNA ENCIMA DE LA OTRA.
//
// 1) EL VERBO SUELTO. `messageAsksForPaymentDetails` aceptaba «dame», «enviame»,
//    «pasame» A SECAS, sin decir QUE se pedia. La pregunta mas normal despues de
//    pagar —«¿a que hora me envia?»— contiene «envia», asi que se leia como
//    «reenviame los datos de pago». Se dejo laxo a proposito, con el argumento
//    de que re-enviar SUS datos era inofensivo.
//
// 2) NO LO ERA, porque ese bloque SE QUEDA EL TURNO. El comentario del propio
//    bloque prometia no actuar «si manda un comprobante», pero la condicion no
//    lo comprobaba: el dato (`latestIsImage`) se calculaba 30 lineas MAS ABAJO,
//    o sea despues de que el bloque ya habia decidido y devuelto.
//
// Y no era un retraso, era una perdida. Como el bot ya contesto DESPUES de la
// foto, la regla del cerebro (getRecentVisionImage) la da por atendida y no
// vuelve a mirarla nunca. Repetir «ya pague» tampoco la rescataba.
//
// LO QUE VIGILA ESTA PRUEBA
//
//   1. Las frases reales de esa conversacion, contra los detectores de verdad.
//   2. Que el dato del comprobante se calcule ANTES del bloque que lo necesita.
//   3. Que un turno con foto no se intercepte jamas.
//   4. Que lo que SI debe reenviar los datos siga haciendolo.
//
//   node scripts/prueba-el-comprobante-no-se-lo-come-el-reenvio.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const motor = readFileSync(join(RAIZ, "src", "lib", "workflow", "engine.ts"), "utf8");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 56)} ${valor}`);
};

// ── 1. Los detectores, tal como estan escritos en el motor ─────────────────
//
// Se extraen del codigo, no se copian: una copia se queda vieja el dia que
// alguien toque el original, y entonces la prueba pasaria mintiendo.
const sacarRegex = (nombre) => {
  const i = motor.indexOf(`function ${nombre}(msg: string): boolean {`);
  if (i < 0) throw new Error(`no encuentro ${nombre}`);
  const trozo = motor.slice(i, i + 2600);
  const m = trozo.match(/return \/(.+?)\/\.test\(/s);
  if (!m) throw new Error(`no encuentro la expresion de ${nombre}`);
  return new RegExp(m[1]);
};
const norm = (s) =>
  (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
const pideDatos = sacarRegex("messageAsksForPaymentDetails");
const anunciaPago = sacarRegex("messageAnnouncesPayment");
const intercepta = (f) => pideDatos.test(norm(f)) || anunciaPago.test(norm(f));

// Lo que NO debe quedarse el turno: preguntas de postventa.
const NO_INTERCEPTA = [
  "listo ya pague\na que hora me envia",
  "a que hora me envia",
  "a que hora me mand",
  "ya pague",
  "cuando me lo envian",
  "listo, aqui esta mi voucher",
  "dame un momento",
  "pasame el material",
];
for (const f of NO_INTERCEPTA) {
  comprobar(
    `no se queda el turno: ${JSON.stringify(f).slice(0, 32)}`,
    !intercepta(f),
    "pasa al modelo"
  );
}

// Lo que SI debe reenviar los datos: pedirlos de verdad.
const SI_INTERCEPTA = [
  "pasame los datos",
  "reenviame los datos por favor",
  "dame el numero",
  "cual es la cuenta",
  "a que numero deposito",
  "como pago",
  "voy a pagar",
];
for (const f of SI_INTERCEPTA) {
  comprobar(
    `sigue reenviando: ${JSON.stringify(f).slice(0, 34)}`,
    intercepta(f),
    "datos de pago"
  );
}

// ── 2. El dato del comprobante se calcula ANTES de quien lo necesita ───────
const dondeSeCalcula = motor.indexOf("const latestIsImage =");
const dondeSeUsa = motor.indexOf("!latestIsImage &&");
const dondeElBloque = motor.indexOf(
  "RE-ENVÍO DETERMINÍSTICO DE DATOS DE PAGO"
);
comprobar(
  "el comprobante se detecta antes del re-envio",
  dondeSeCalcula > 0 && dondeElBloque > dondeSeCalcula,
  "orden correcto"
);
comprobar(
  "y el bloque lo comprueba de verdad",
  dondeSeUsa > 0 && dondeSeUsa > dondeSeCalcula,
  "!latestIsImage"
);
comprobar(
  // Estaba calculado dos veces; al mover el original arriba, la copia de abajo
  // sobraba. Dos calculos del mismo dato acaban discrepando.
  "y se calcula una sola vez",
  (motor.match(/const latestIsImage =/g) ?? []).length === 1,
  "sin copias"
);

// ── 3. Lo que no cambia ────────────────────────────────────────────────────
comprobar(
  // LA MISMA PUERTA, AHORA CON SU FRASE DELANTE.
  //
  // El 24/09 se le añadió `conFrase: true`: por aquí el motor se queda el turno y
  // el modelo no habla, así que la cuenta llegaba a secas. Lo que esta
  // comprobación protege no ha cambiado — la puerta sigue en pie para quien pide
  // sus datos.
  "el re-envio sigue existiendo para quien pide sus datos",
  /const ok = await resendPaymentDetails\(convo, \{ conFrase: true \}\);/.test(
    motor
  ),
  "intacto"
);
comprobar(
  "y sigue sin actuar en postventa",
  /!isPostSaleState &&/.test(motor),
  "intacto"
);
comprobar(
  // Es la regla que hace que la foto valga aunque el cliente siga escribiendo.
  "la foto sigue valiendo mientras el bot no haya contestado",
  /i > ultimaRespuestaDelBot &&/.test(motor),
  "sin reloj de 5 segundos"
);

console.log(
  fallos === 0
    ? "\nTODO OK — un turno con comprobante llega al lector, no al re-envio"
    : `\n${fallos} FALLA(S)`
);
process.exit(fallos === 0 ? 0 : 1);
