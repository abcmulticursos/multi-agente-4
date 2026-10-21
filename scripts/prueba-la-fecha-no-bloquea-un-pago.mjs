// LA FECHA NO PUEDE BLOQUEAR UN PAGO
//
// LO ENCONTRO EL DUEÑO el 05/10/2026, testeando Ecuador: habia variado el «N de comprobante»
// en TODOS sus comprobantes y el bot los rechazaba igual por duplicados.
//
// EL FALLO. La huella del comprobante se armaba con tres piezas y se añadian TODAS, y como
// basta que UNA coincida para marcar duplicado, esta condenaba:
//
//     op:<numero de operacion>      el la habia cambiado    -> distinta
//     dt:<fecha>|amt:<monto>        mismo dia, mismo precio -> IGUAL  <- condenaba
//     img:<id del mensaje>          siempre distinta
//
// NO ERA UN PROBLEMA DE PRUEBAS. Esa fue mi primera lectura y era falsa; el la corrigio con
// el caso real: «el cliente me va a mandar el comprobante el mismo día, POR ESO LA FECHA NO
// TIENE QUE SER UN FACTOR que impida la compra».
//
// Y tenia razon: dos pagos del MISMO importe el MISMO dia son DOS PAGOS —un pago partido en
// dos, o un extra que cuesta igual que el basico— y el segundo no se sumaba. Dinero cobrado
// que el bot no contaba.
//
// EL ARREGLO. La fecha solo decide cuando NO hay numero de operacion. El numero identifica
// un comprobante; la fecha y el monto solo lo describen.
//
// LO QUE CUESTA, Y QUEDA DICHO: si el lector leyera el MISMO numero de dos formas distintas
// en dos envios de la misma foto, podria contarse dos veces. Es mas raro —son cifras
// limpias—, la red de `img:` sigue tapando el reenvio de la misma imagen, y entre bloquear un
// pago de verdad y contar dos veces una lectura torcida, el eligio lo primero.
//
//   node scripts/prueba-la-fecha-no-bloquea-un-pago.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const pago = readFileSync(join(RAIZ, "src", "lib", "workflow", "payment.ts"), "utf8");

let fallos = 0;
const comprobar = (titulo, condicion, detalle) => {
  const marca = condicion ? "  ok  " : "> FALLA";
  if (!condicion) fallos++;
  console.log(`${marca} ${String(titulo).padEnd(58)} ${detalle ?? ""}`);
};

// -- 1. EL ARREGLO ----------------------------------------------------------
comprobar(
  "la fecha solo cuenta SIN numero de operacion",
  /if \(opFp\.length < 4 && dateFp\.length >= 4\) \{\s*\r?\n\s*fingerprints\.push\(`dt:\$\{dateFp\}\|amt:\$\{cents\}`\);/.test(
    pago
  ),
  "el numero manda cuando existe"
);
comprobar(
  "y NO se añade a la vez que el numero",
  !/if \(dateFp\.length >= 4\) fingerprints\.push\(`dt:/.test(pago),
  "asi condenaba comprobantes nuevos"
);

// -- 2. LO QUE NO SE TOCA ---------------------------------------------------
//
// El duplicado DE VERDAD tiene que seguir cazandose. Si esto dejara pasar el mismo
// comprobante dos veces, se entregaria material por un pago que no existe — el fallo
// contrario, y mas caro.
comprobar(
  "el numero de operacion sigue cazando el repetido",
  /if \(opFp\.length >= 4\) fingerprints\.push\(`op:\$\{opFp\}`\)/.test(pago),
  "la misma operacion no se suma dos veces"
);
comprobar(
  "y la red de la misma imagen sigue puesta",
  /if \(latestImage\) fingerprints\.push\(`img:\$\{latestImage\.id\}`\)/.test(pago),
  "aunque el voucher sea ilegible"
);
comprobar(
  "basta UNA huella para marcar duplicado",
  /const isDuplicateReceipt = fingerprints\.some\(\(f\) => countedSet\.has\(f\)\)/.test(
    pago
  ),
  "eso no cambia: cambia QUE huellas hay"
);

// -- 3. SE PUEDE VER EN EL REGISTRO -----------------------------------------
//
// Esto se diagnostico leyendo el codigo porque el log solo decia «DUPLICADO» sin enseñar
// por que. La proxima vez se lee en un segundo.
comprobar(
  "el registro enseña las huellas",
  /huellas \[\$\{fingerprints\.join\(" "\)\}\]/.test(pago),
  "antes solo decia DUPLICADO"
);

// -- 4. Y NADA MAS DEL COBRO SE MOVIO --------------------------------------
//
// El pidio el arreglo «SIN QUE TOQUE EL COMPORTAMIENTO DEL BOT». Estas cuatro son las
// piezas vecinas que comparten funcion con la huella: si alguna se moviera de paso, este
// arreglo habria dejado de ser quirurgico.
for (const [que, patron] of [
  ["el titular se sigue validando", /el comprobante es a nombre de/],
  ["el total se sigue sumando igual", /newTotalCents = addToPaidTotal\(conversationId, cents\)/],
  ["el duplicado sobre venta aprobada no re-entrega", /no re-entrego material ni re-ofrezco regalo/],
  ["y se sigue limpiando con /restart", /counted_receipts/],
]) {
  comprobar(que, patron.test(pago), "intacto");
}

console.log("");
if (fallos > 0) {
  console.log(`> ${fallos} FALLA(S)`);
  process.exit(1);
}
console.log("TODO OK — la fecha ya no bloquea un pago, y el repetido sigue cazandose");
