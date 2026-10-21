import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (...parts) => readFileSync(join(root, ...parts), "utf8");
const payment = read("src", "lib", "workflow", "payment.ts");
const engine = read("src", "lib", "workflow", "engine.ts");
let failures = 0;
const check = (name, ok) => {
  if (!ok) failures++;
  console.log(`${ok ? "ok   " : "FALLA"} ${name}`);
};

check(
  "un comprobante del upsell pasa aunque el primer pago ya esté aprobado",
  /convo\.state === "payment_approved"[\s\S]{0,180}!isApprovedUpgradeToCombo[\s\S]{0,120}!esPagoDeUpsell/.test(
    payment
  )
);
check(
  "el comprobante del upsell llega a su aprobación y entrega",
  // Las ventanas se ampliaron al pasar el extra a llevar SU PROPIA CUENTA en vez
  // de una resta: el bloque creció, no cambió de sitio.
  /if \(esPagoDeUpsell\)[\s\S]{0,4000}setUpsellState\(conversationId, "pagado"\)[\s\S]{0,1200}entregarUpsell\(conversationId\)/.test(
    payment
  )
);
check(
  "la preferencia WhatsApp/correo resuelve la entrega del upsell",
  /source === "upsell"\s*\? seccionUpsell\(config\)\?\.delivery/.test(payment)
);
// EL REENVÍO YA NO MANDA UNA SOLA COSA, Y POR ESO ESTO SE MIRA EN DOS PASOS.
//
// Antes el extra era la PRIMERA rama de una escalera de `return`: se comprobaba
// que `upsell_state === "pagado"` y, a menos de 450 caracteres, su
// `scheduleDeliverySequence(..., "upsell")`. Desde el 14 de septiembre de 2026
// el reenvío manda TODO lo que el cliente compró —su producto y el extra— así
// que el extra ya no va el primero ni pegado a su guarda: se resuelve arriba y
// se encadena detrás de lo principal. La intención de esta comprobación no
// cambia —que un reenvío posterior conserve el enlace del tercer producto— solo
// deja de medirse por cercanía en el archivo.
check(
  "un reenvío posterior conserva el enlace del tercer producto",
  /convo\.upsell_state === "pagado" \? seccionUpsell\(config\)\?\.delivery : null/.test(
    payment
  ) &&
    /scheduleDeliverySequence\(\s*convo\.id,\s*elExtra,\s*"upsell"/.test(payment)
);
check(
  "el worker lee la entrega específica del upsell",
  /payload\.source === "upsell"\s*\?\s*seccionUpsell\(config\)\?\.delivery/.test(
    engine
  )
);
check(
  "los comodines de la entrega usan el precio del tercer producto",
  /payload\.source === "upsell"[\s\S]{0,260}getUpsellPriceSoles/.test(engine)
);

console.log(failures === 0 ? "\nTodo correcto." : `\n${failures} fallo(s).`);
process.exit(failures === 0 ? 0 : 1);
