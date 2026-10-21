// El segundo producto se cobra como un ticket INDEPENDIENTE, con su precio.
//
// QUE PASABA
//
//   El bot no llevaba una cuenta del extra: llevaba UNA sola cuenta de todo lo
//   que entraba, y para el extra hacia una resta:
//
//       abonado = total acumulado − foto de lo pagado al ofrecerlo
//
//   La foto intentaba hacer de linea divisoria. Y funcionaba solo mientras nada
//   se moviera por debajo. Pero se sacaba UNA vez y no se volvia a sacar: si
//   despues el cliente subia de basico a full, ese dinero entraba por encima de
//   una linea vieja y se contaba para el segundo producto.
//
//   Con los precios reales de Order Bump Peru:
//
//       Paga basico     9.90  → foto = 9.90
//       Acepta el extra
//       Sube al full   +3.00  → total 12.90   (la foto sigue en 9.90)
//       Paga del extra +5.00  → total 17.90
//
//       17.90 − 9.90 = 8.00 → "alcanza los 8.00" → APRUEBA
//       Debia 12.90 + 8.00 = 20.90. Pago 17.90. Regalados 3.00 —
//       exactamente lo que costo el upgrade.
//
// COMO QUEDA
//
//   El extra lleva SU cuenta. Da igual lo que pase con la primera venta: esta
//   ni la mira. Y un comprobante que cubre las dos cosas se reparte en el orden
//   natural: primero se termina de pagar lo que el cliente ya se llevo, y lo
//   que sobra es del extra.
//
//   node scripts/prueba-el-upsell-es-un-ticket-aparte.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");
const db = leer("src", "lib", "db.ts");
const pago = leer("src", "lib", "workflow", "payment.ts");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// ── 1. El extra tiene su propia cuenta ───────────────────────────────────────
comprobar(
  "la conversacion lleva la cuenta del extra",
  /\["upsell_paid_cents", "INTEGER NOT NULL DEFAULT 0"\],/.test(db) &&
    /upsell_paid_cents: number;/.test(db),
  "upsell_paid_cents"
);
comprobar(
  "se suma, no se recalcula",
  /upsell_paid_cents = upsell_paid_cents \+ \?/.test(db),
  "acumula sus propios pagos"
);
// Sumar cero o negativo seria ruido; un importe roto no puede tocar una cuenta
// de dinero.
comprobar(
  "un importe invalido no toca la cuenta",
  /if \(!Number\.isFinite\(cents\) \|\| cents <= 0\) return;/.test(db),
  "no entra basura"
);

// ── 2. Ya no se decide por la resta ──────────────────────────────────────────
comprobar(
  "el abono del extra ya no sale de la foto",
  !/const abonadoAlUpsell = newTotalCents - convo\.upsell_base_cents;/.test(pago),
  "se acabo la resta"
);
comprobar(
  "sale de su cuenta mas lo de este comprobante",
  /const abonadoAlUpsell = abonadoAntes \+ alExtra;/.test(pago),
  "ticket propio"
);

// ── 3. El reparto: primero la primera venta ──────────────────────────────────
//
// Cobrar el segundo dejando el primero a medias seria entregar dos cosas
// habiendo cobrado una y media.
comprobar(
  "primero se completa lo que el cliente ya se llevo",
  /const debidoDeLaPrimera = Math\.max\(\s*\r?\n?\s*0,\s*\r?\n?\s*Math\.round\(precioPrimeraVenta \* 100\) - convo\.paid_total_cents\s*\r?\n?\s*\);/.test(
    pago
  ),
  "y lo que sobra es del extra"
);
// El precio de la primera venta hay que guardarlo ANTES de que lo tape el del
// extra, dos lineas mas abajo.
comprobar(
  "y su precio se guarda antes de que lo tape el del extra",
  /const precioPrimeraVenta = priceSoles;\s*\r?\n\s*if \(esPagoDeUpsell && precioUpsell !== null\)/.test(
    pago
  ),
  "en su orden"
);
comprobar(
  "un comprobante duplicado no suma al extra",
  /const alExtra = isDuplicateReceipt\s*\r?\n?\s*\? 0/.test(pago),
  "como no suma al total"
);
// Y que quede escrito, que es dinero repartido entre dos ventas.
comprobar(
  "el reparto queda escrito en el log",
  /completan la primera venta y \$\{alExtra \/ 100\} van al extra/.test(pago),
  "auditable"
);

// ── 4. Nadie paga dos veces por el cambio ────────────────────────────────────
//
// Las conversaciones que estaban a medias cuando esto se deployo tienen la
// cuenta en cero y su abono metido en la resta vieja. Sin recuperarlo se les
// pediria otra vez un dinero que ya pagaron.
comprobar(
  "lo ya abonado con el metodo viejo se respeta",
  /convo\.upsell_paid_cents > 0\s*\r?\n?\s*\? convo\.upsell_paid_cents\s*\r?\n?\s*: Math\.max\(0, convo\.paid_total_cents - convo\.upsell_base_cents\)/.test(
    pago
  ),
  "no se le cobra dos veces"
);

// ── 5. Preparado para un segundo extra ───────────────────────────────────────
//
// Hoy no cambia nada —esta conversacion ya no vuelve a pasar por aqui— pero el
// dia que haya dos upsells encadenados, el segundo empieza limpio en vez de
// heredar lo del primero y darse por pagado solo.
comprobar(
  "al cerrarse el ticket, la cuenta vuelve a cero",
  /setUpsellPaidAt\(conversationId, Math\.floor\(Date\.now\(\) \/ 1000\)\);[\s\S]{0,400}?resetUpsellPaid\(conversationId\);/.test(
    pago
  ),
  "el siguiente empieza limpio"
);

console.log(
  fallos === 0
    ? "\nTODO OK — el segundo producto se cobra por su cuenta"
    : `\n${fallos} comprobacion(es) mal.`
);
process.exit(fallos === 0 ? 0 : 1);
