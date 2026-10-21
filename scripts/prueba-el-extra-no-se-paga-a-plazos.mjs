// El segundo producto se paga entero, no completando lo que ya pagó.
//
// LO QUE PASO
//
//   Compro el basico por 6.000. El bot le ofrecio el segundo producto, que
//   cuesta 7.500. Y el cliente escribio:
//
//       «ya pague 6000, si pago los 1500 pueden darme las plantillas mockup»
//
//   6.000 + 1.500 = 7.500. El modelo hizo la cuenta y dijo que si.
//
// POR QUE SE LE OCURRIO
//
//   Porque en el mismo cerebro SI existe una mecanica de «pagar la diferencia»:
//   la del upgrade de basico a full. Ahi es legitima. Nadie le habia dicho que
//   NO aplica al segundo producto, y la generalizo.
//
// Y AQUI ESTA LO GRAVE
//
//   El motor no lo habria cumplido. El extra lleva su propia cuenta: la foto de
//   lo pagado al ofrecerlo era 6.000, asi que de lo anterior le cuenta 0. Con
//   1.500 devolveria PARCIAL, «faltan 6.000».
//
//   O sea: el bot prometio algo que el sistema iba a rechazar. El cliente paga,
//   no recibe nada, y el que queda mal es el dueño. Es peor que dar un numero
//   equivocado.
//
//   node scripts/prueba-el-extra-no-se-paga-a-plazos.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const cerebro = readFileSync(join(RAIZ, "src", "lib", "openrouter.ts"), "utf8");
const pago = readFileSync(
  join(RAIZ, "src", "lib", "workflow", "payment.ts"),
  "utf8"
);

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 60)} ${valor}`);
};

// ── 1. Se le dice al modelo, donde lo va a leer ──────────────────────────────
comprobar(
  "su precio es el completo, y lo ya pagado no cuenta",
  /ITS PRICE IS \$\{precioExtraLabel\}, IN FULL, AND NOTHING ALREADY PAID COUNTS TOWARD IT/.test(
    cerebro
  ),
  "ticket propio"
);
comprobar(
  "no hay «diferencia» ni «completar» para este producto",
  /This is a NEW purchase with its own ticket, not an upgrade: there is no "difference", no "completing", no discount for having bought before/.test(
    cerebro
  ),
  "no es un upgrade"
);
// LA FRASE EXACTA QUE ESCRIBIO EL CLIENTE, para que no haya duda de a que caso
// se refiere la regla.
comprobar(
  "y si proponen pagar una parte, la respuesta es NO",
  /ya pagué X, si pago Y me lo dan\?[\s\S]{0,80}?the answer is NO/.test(cerebro),
  "dicho con amabilidad"
);
comprobar(
  "sin hacer cuentas con lo que ya pagó",
  /NEVER do arithmetic with what they already paid, and NEVER agree to a smaller amount/.test(
    cerebro
  ),
  "ni una resta"
);
// EL MOTIVO, ESCRITO: una promesa que el sistema no puede cumplir deja al
// cliente pagando y sin recibir.
comprobar(
  "y se le explica por qué importa",
  /a promise like that is one it cannot keep and the customer ends up paying and receiving nothing/.test(
    cerebro
  ),
  "no es un capricho"
);

// ── 2. La mecánica del upgrade queda acotada ─────────────────────────────────
//
// Existe y es legitima, pero SOLO entre las dos opciones de la primera oferta.
comprobar(
  "el «pagar la diferencia» solo vale entre las dos opciones",
  /The "pay the difference" \/ upgrade mechanic mentioned anywhere else in this prompt applies ONLY between the two options of the FIRST offer\. It NEVER applies to/.test(
    cerebro
  ),
  "nunca al extra"
);
// Y NO SE TOCA la del upgrade de verdad: sigue viva donde le corresponde.
comprobar(
  "y el upgrade de básico a full sigue intacto",
  /UPGRADE MARKER \(post-purchase\)/.test(cerebro) &&
    /<<UPGRADE_COMBO>>/.test(cerebro),
  "no se quitó nada"
);

// ── 3. Vale para TODAS las modalidades con upsell ────────────────────────────
//
// El bloque del extra no esta atado a ninguna modalidad: se inyecta siempre que
// hay un upsell ofrecido o aceptado. Asi que esto cubre lineal, order_bump,
// doble_oferta_upsell y upsell de una vez.
comprobar(
  "y aplica en cualquier modalidad que ofrezca un extra",
  /convo\?\.upsell_state === "ofrecido" \|\|\s*\r?\n\s*convo\?\.upsell_state === "aceptado"\s*\r?\n\s*\) \{\s*\r?\n\s*const extra = seccionUpsell\(loadWorkflowConfig\(\)\);/.test(
    cerebro
  ),
  "no está atado a una"
);

// ── 4. El motor ya lo hacía bien, y sigue igual ──────────────────────────────
//
// Esto no se toca: la cuenta del extra es independiente y por eso habria
// rechazado la promesa. El arreglo es que el modelo deje de prometerla.
comprobar(
  "\nel extra sigue llevando su propia cuenta",
  /const abonadoAlUpsell = abonadoAntes \+ alExtra;/.test(pago) &&
    /if \(abonadoAlUpsell < priceCents\) \{/.test(pago),
  "el motor no cambia"
);

console.log(
  fallos === 0
    ? "\nTODO OK — el extra se cobra entero, y el bot ya no promete lo contrario"
    : `\n${fallos} comprobacion(es) mal.`
);
process.exit(fallos === 0 ? 0 : 1);
