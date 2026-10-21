// El segundo producto se lleva a la compra, no se cuenta y se abandona.
//
// DE DONDE SALE
//
//   El bot explicó bien el extra y terminó preguntando: «¿Pudiste acceder a tu
//   enlace del kit sin problema?» — una pregunta sobre el producto que YA le
//   había vendido. La segunda venta se quedó ahí. Sus palabras: «la explicación
//   me gustó, pero no la llevó a la compra como lo hace al inicio».
//
// LAS DOS CAUSAS
//
//   1. EL PROMPT SE CONTRADECIA. El bloque de postventa dice, en mayúsculas,
//      «FORBIDDEN ... At this stage NO sales CTA goes at the end», y se aplicaba
//      TAMBIEN mientras se está ofreciendo el extra. Ochenta líneas más abajo se
//      le pide vender ese extra. El modelo obedeció a la prohibición —está
//      escrita como FORBIDDEN— y no cerró.
//
//      La prohibición era de la venta YA HECHA. Ahora lo dice: cubre el producto
//      ya pagado, y el extra queda expresamente fuera.
//
//   2. LE DABAMOS LA PALABRA PARA MINIMIZARLO. El prompt decía «a SEPARATE,
//      optional second purchase» y el modelo se la repitió al cliente: «es
//      totalmente opcional. No tiene que ver con lo que ya compraste». Un texto
//      interno de política nunca debe poder copiarse tal cual a un mensaje.
//
//   node scripts/prueba-el-extra-cierra-la-venta.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const cerebro = readFileSync(join(RAIZ, "src", "lib", "openrouter.ts"), "utf8");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 62)} ${valor}`);
};

// ── 1. Ya no se contradice ───────────────────────────────────────────────────
//
// La prohibicion de cerrar sigue viva para la venta ya hecha, y SOLO para ella.
comprobar(
  "la prohibición de vender es del producto ya comprado",
  /FORBIDDEN to offer a payment method or sales CTAs like[\s\S]{0,60}?for the product they ALREADY BOUGHT\./.test(
    cerebro
  ),
  "no de todo"
);
// EL CHEQUEO DE CONTRADICCION: «NO sales CTA goes at the end» solo puede
// aparecer cuando el extra NO se esta ofreciendo. Si vuelve a estar suelto, el
// prompt se pisa a si mismo otra vez y el modelo deja de cerrar.
comprobar(
  "y «NO sales CTA» solo sale si NO hay extra en oferta",
  /elExtraSeEstaOfreciendo\s*\r?\n\s*\? ` EXCEPTION — a SECOND product is on the table right now[\s\S]{0,400}?: ` At this stage NO sales CTA goes at the end\.`/.test(
    cerebro
  ),
  "no pueden coexistir"
);
comprobar(
  "con el extra abierto se le dice que ESA venta sigue viva",
  /that sale is OPEN, so you MUST close every reply by moving IT forward/.test(
    cerebro
  ),
  "y hay que cerrarla"
);

// ── 2. La regla de cierre ────────────────────────────────────────────────────
comprobar(
  "toda respuesta cierra llevando la venta adelante",
  /CLOSE EVERY REPLY BY MOVING THE SALE FORWARD/.test(cerebro),
  "como al inicio"
);
// Y MANDA SOBRE LAS EXCEPCIONES DE POSTVENTA. Hay tres bloques que dicen «omite
// el cierre» —correo, regalo, postventa—; con una venta abierta, esa venta manda.
comprobar(
  "y manda sobre los «omite el cierre» de la postventa",
  /This OVERRIDES any "omit the CTA" or "no sales CTA" instruction elsewhere in this prompt/.test(
    cerebro
  ),
  "hay una venta abierta"
);
// EL FALLO EXACTO QUE VIO: terminar preguntando por lo ya entregado.
comprobar(
  "nunca cierra preguntando por el producto ya entregado",
  /NEVER end by asking about the product they already bought — that abandons an open sale in silence/.test(
    cerebro
  ),
  "eso fue lo que pasó"
);
// SOLO MIENTRAS LA OFERTA SIGUE ABIERTA. Ya aceptada, lo que toca es que
// complete el pago; invitarle otra vez sonaria a que no nos enteramos.
comprobar(
  "solo mientras la oferta sigue abierta, no si ya aceptó",
  /const laOfertaSigueAbierta = convo\.upsell_state === "ofrecido";/.test(
    cerebro
  ) && /\$\{\s*\r?\n\s*laOfertaSigueAbierta\s*\r?\n\s*\? `\\n- CLOSE EVERY REPLY/.test(cerebro),
  "ofrecido, no aceptado"
);

// ── 3. Ya no le damos la palabra para minimizarlo ────────────────────────────
comprobar(
  "no queda ni un «optional» en el bloque del extra",
  !/a SEPARATE, optional second purchase/.test(cerebro),
  "se la repetía al cliente"
);
comprobar(
  "y se le prohíbe expresamente rebajarlo",
  /NEVER talk it down\. Do NOT call it "optional", "extra", "a complement", "not important", "nothing to do with what you bought"/.test(
    cerebro
  ),
  "es un producto que vendes"
);
// Lo que esa linea protegia SIGUE dicho: es una compra aparte que NO ha pagado.
comprobar(
  "sin perder que es una compra aparte que no ha pagado",
  /is a SEPARATE second purchase they have NOT paid for/.test(cerebro),
  "nada se pierde"
);

// ── 4. Lo que NO cambia ──────────────────────────────────────────────────────
comprobar(
  "si dice que no, se acepta y no se insiste",
  /If they decline, accept it kindly and do not insist\./.test(cerebro),
  "cerrar no es presionar"
);
comprobar(
  "y nunca se reofrece el producto ya comprado",
  /NEVER offer, describe or invite them to buy the FIRST product again/.test(
    cerebro
  ),
  "como estaba"
);
comprobar(
  "el marcador sigue siendo la única puerta para aceptar",
  /Output "<<QUIERE_EXTRA>>" ONLY when they clearly want to buy it/.test(cerebro),
  "<<QUIERE_EXTRA>>"
);

console.log(
  fallos === 0
    ? "\nTODO OK — el extra se lleva a la compra"
    : `\n${fallos} comprobacion(es) mal.`
);
process.exit(fallos === 0 ? 0 : 1);
