// El precio que se le DIJO es el que se le cobra, también en el segundo producto.
//
// QUE PASABA
//
//   El primer producto congela su precio al entrar (`frozen_prices`): lo que se
//   le cotizó al cliente manda, aunque el precio se toque en el panel mientras
//   él decide. El segundo producto NO lo hacía: su precio se resolvía en vivo
//   las dos veces —al ofrecerlo y al validar el comprobante—.
//
//   Entre esas dos veces pasan minutos u horas. Si el precio se cambia en el
//   panel en ese hueco, al cliente se le pidió un monto y su comprobante se
//   cuenta contra otro. No da error: le dice que le falta dinero a quien pagó
//   exactamente lo que se le pidió. Con dinero de por medio, es de lo peor que
//   puede hacer el bot.
//
// COMO QUEDA
//
//   Se congela en `presentarUpsell`, que es donde el cliente ve el número, y a
//   partir de ahí manda él. Misma regla y misma dirección que el primero:
//   nunca se le cobra MAS de lo cotizado, y si hoy el precio es menor, gana el
//   menor —bajar un precio beneficia al cliente; subirlo no le alcanza—.
//
//   node scripts/prueba-el-precio-del-upsell-se-congela.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");
const db = leer("src", "lib", "db.ts");
const config = leer("src", "lib", "workflow", "config.ts");
const motor = leer("src", "lib", "workflow", "engine.ts");
const pago = leer("src", "lib", "workflow", "payment.ts");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// ── 1. Hay donde guardarlo ───────────────────────────────────────────────────
comprobar(
  "la conversacion tiene su columna",
  /\["upsell_frozen_prices", "TEXT"\],/.test(db) &&
    /upsell_frozen_prices: string \| null;/.test(db),
  "upsell_frozen_prices"
);
// Los DOS importes, no solo el que tocaba. Cual de los dos vale lo decide el
// estado de descuento AL VALIDAR, que puede no ser el de al ofrecer.
comprobar(
  "guarda el normal Y el de oferta",
  /export interface UpsellFrozenPrices \{\s*\r?\n\s*modalidad: string;\s*\r?\n\s*regular: number \| null;\s*\r?\n\s*discount: number \| null;/.test(
    db
  ),
  "los dos"
);
// Un JSON roto no puede tumbar una venta.
comprobar(
  "un dato corrupto no rompe nada",
  /export function getUpsellFrozenPrices\([\s\S]{0,400}?catch \{[\s\S]{0,200}?return null;/.test(
    db
  ),
  "cae al precio de hoy"
);

// ── 2. Se congela donde se le dice el precio ─────────────────────────────────
comprobar(
  "se congela al ofrecerlo",
  /if \(config && !getUpsellFrozenPrices\(convo\)\) \{\s*\r?\n\s*setUpsellFrozenPrices\(convo\.id, \{/.test(
    motor
  ),
  "presentarUpsell"
);
// Se conserva el PRIMERO: si por lo que sea se vuelve a pasar por ahi, vale lo
// que ya se le dijo. Es la misma regla que `freezePricesForConvo`.
comprobar(
  "y no se re-cotiza si se vuelve a pasar",
  /!getUpsellFrozenPrices\(convo\)/.test(motor),
  "manda la primera"
);
comprobar(
  "se anota con que modalidad se cotizo",
  /modalidad: getActiveModalityKey\(config\),/.test(motor),
  "guarda hermetica"
);

// ── 3. Y manda al cobrar ─────────────────────────────────────────────────────
//
// El punto donde de verdad importa: `getUpsellPriceSoles` es el unico sitio que
// da el precio del segundo producto —lo usan la invitacion, los seguimientos y
// la validacion del comprobante—, asi que congelarlo ahi lo congela para todos.
comprobar(
  "el precio del upsell consulta lo cotizado",
  /const congelado = getUpsellFrozenPrices\(getConversationByPhone\(phone\)\);/.test(
    config
  ),
  "un solo sitio"
);
comprobar(
  "nunca se le cobra mas de lo cotizado",
  /return vivo !== null \? Math\.min\(cotizado, vivo\) : cotizado;/.test(config),
  "Math.min, igual que el primero"
);
comprobar(
  "si cambio de modalidad, ese precio no se arrastra",
  /congelado\.modalidad !== activeModalityKey\(cfg\)/.test(config),
  "cada tienda la suya"
);
// Sin telefono no hay conversacion: el editor, el simulador y `isUpsellUsable`
// preguntan sin cliente y tienen que seguir viendo el precio de hoy.
comprobar(
  "sin cliente delante se contesta con el precio de hoy",
  /if \(!phone\) return vivo;/.test(config),
  "el editor no ve precios viejos"
);
// Y la etapa apagada sigue siendo apagada: el corte por `enabled` va ANTES, asi
// que un precio congelado no puede resucitar un upsell que ya no se ofrece.
comprobar(
  "un precio viejo no resucita una etapa apagada",
  config.indexOf("if (!up?.enabled) return null;") <
    config.indexOf("const congelado = getUpsellFrozenPrices("),
  "el interruptor manda"
);
comprobar(
  "el comprobante se valida con ese mismo precio",
  /const precioUpsell = esPagoDeUpsell\s*\r?\n\s*\? getUpsellPriceSoles\(discountActive, convo\.phone\)/.test(
    pago
  ),
  "por la misma puerta"
);

// ── 4. Lo de siempre sigue igual ─────────────────────────────────────────────
//
// El congelado del PRIMER producto no se toca: es otro campo, otro momento y
// otra regla, y aqui solo se anadio al lado.
comprobar(
  "el congelado del primer producto sigue intacto",
  /export function freezePricesForConvo\(/.test(config) &&
    /setFrozenPrices\(convo\.id, map\);/.test(config),
  "frozen_prices"
);

console.log(
  fallos === 0
    ? "\nTODO OK — lo que se le dijo es lo que se le cobra"
    : `\n${fallos} comprobacion(es) mal.`
);
process.exit(fallos === 0 ? 0 : 1);
