// Un comprobante nunca se queda sin respuesta.
//
// LO QUE PASO — 14 de septiembre de 2026
//
//   El cliente estaba completando el saldo de su upgrade. Mando la foto del
//   pago y escribio «ahi tiene». En el registro:
//
//       [wf:pago] convo 57: … este comprobante es del UPGRADE, no del extra
//       [wh] convo 57: SIN RESPUESTA. El motor no atendio el turno y el modelo
//                      devolvio vacio. estado=payment_approved cliente="ahi tiene"
//
//   No salio NADA. Volvio a insistir —«maestro ya complete para el otro»— y
//   nada otra vez. Pago, y del otro lado no hubo ni una palabra.
//
// LA CAUSA
//
//   El silencio ya se anotaba en el registro (lo puso una sesion anterior), con
//   este razonamiento escrito al lado: «no se inventa una respuesta, no hay
//   ninguna que sea correcta siempre». Cierto para un texto cualquiera. Pero
//   cuando lo que llego es un COMPROBANTE si hay una respuesta correcta
//   siempre: que llego.
//
//   Y la regla del dueño no deja lugar a dudas: «silencio es un fallo, no un
//   caso menor».
//
// EL ARREGLO
//
//   Si el bot no iba a enviar absolutamente nada y el ultimo mensaje del cliente
//   era un comprobante, se acusa recibo. Con dos frenos:
//     · solo si de verdad mando un comprobante (foto o PDF del banco);
//     · NUNCA si el pago se acaba de aprobar, porque ahi la entrega ya salio y
//       «dame un momento que lo reviso» la contradiria.
//
//   node scripts/prueba-un-comprobante-nunca-se-queda-sin-respuesta.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const handler = readFileSync(
  join(RAIZ, "src", "lib", "meta", "handler.ts"),
  "utf8"
);

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 52)} ${valor}`);
};

// ── La decision real, sacada del archivo ─────────────────────────────────────
const i = handler.indexOf("export function debeAcusarElComprobante(");
if (i < 0) throw new Error("no encuentro debeAcusarElComprobante en handler.ts");
const fin = handler.indexOf("\n}", handler.indexOf("): boolean {", i));
const cuerpo = handler
  .slice(i, fin)
  .replace(
    /export function debeAcusarElComprobante\([\s\S]*?\): boolean \{/,
    "function debeAcusarElComprobante(ultimoDelCliente, convo, ahoraSegundos, esPdfDeBanco = false) {"
  );

const { debeAcusarElComprobante } = new Function(
  cuerpo + "\n}\n\nreturn { debeAcusarElComprobante };"
)();

const AHORA = 1_800_000_000;
const FOTO = { media_type: "image" };
const TEXTO = { media_type: null };

// ── 1. El caso del fallo ─────────────────────────────────────────────────────
console.log("— mando un comprobante y nadie contesto —\n");
comprobar(
  "foto + el motor no supo resolverla -> acusa",
  debeAcusarElComprobante(FOTO, { state: "payment_approved", paid_at: AHORA - 900 }, AHORA) === true,
  "no se queda mudo"
);
comprobar(
  "foto en payment_done -> acusa",
  debeAcusarElComprobante(FOTO, { state: "payment_done", paid_at: null }, AHORA) === true,
  "no se queda mudo"
);
comprobar(
  "PDF del banco -> acusa igual",
  debeAcusarElComprobante(TEXTO, { state: "payment_done", paid_at: null }, AHORA, true) === true,
  "foto o PDF, da igual"
);

// ── 2. Los dos frenos ────────────────────────────────────────────────────────
console.log("\n— y los dos frenos, enteros —\n");
comprobar(
  "texto suelto -> NO inventa un comprobante",
  debeAcusarElComprobante(TEXTO, { state: "payment_done", paid_at: null }, AHORA) === false,
  "eso es otro problema"
);
comprobar(
  "sin ultimo mensaje -> no acusa",
  debeAcusarElComprobante(null, { state: "payment_done", paid_at: null }, AHORA) === false,
  "nada que acusar"
);
comprobar(
  "pago recien aprobado -> NO contradice la entrega",
  debeAcusarElComprobante(FOTO, { state: "payment_approved", paid_at: AHORA - 5 }, AHORA) === false,
  "la entrega ya salio"
);
comprobar(
  "aprobado hace rato -> vuelve a acusar",
  debeAcusarElComprobante(FOTO, { state: "payment_approved", paid_at: AHORA - 121 }, AHORA) === true,
  "ya no es la misma entrega"
);
// EL CASO DEL UPGRADE, que es el que se me escapo la primera vez.
//
// El motor aprueba el pago del saldo y programa la entrega, pero la
// conversacion todavia figura en `payment_done`. Atar el freno al ESTADO dejaba
// salir un «dame un momento que lo reviso» justo detras del enlace entregado.
// Lo vivio el dueño en su recorrido del 14 de septiembre de 2026.
comprobar(
  "UPGRADE aprobado con estado payment_done -> NO acusa",
  debeAcusarElComprobante(FOTO, { state: "payment_done", paid_at: AHORA - 3 }, AHORA) === false,
  "el freno mira el pago, no el estado"
);
comprobar(
  "y sin pago reciente en payment_done -> si acusa",
  debeAcusarElComprobante(FOTO, { state: "payment_done", paid_at: AHORA - 3600 }, AHORA) === true,
  "su comprobante quedo sin resolver"
);

// ── 3. La forma ──────────────────────────────────────────────────────────────
console.log("\n— la forma del arreglo —\n");
comprobar(
  "solo se ejecuta cuando el bot no iba a enviar NADA",
  /SIN RESPUESTA[\s\S]{0,400}?await acusarElComprobanteSiSeQuedoMudo\(fresh\);/.test(
    handler
  ),
  "no pisa nada que funcione"
);
comprobar(
  "el aviso del registro sigue en pie",
  /SIN RESPUESTA\. El motor no atendió el turno/.test(handler),
  "se sigue pudiendo diagnosticar"
);
comprobar(
  "el acuse no nombra producto, precio ni metodo",
  !/(S\/|precio|producto|yape|plin|combo)/i.test(
    /const ACUSE_DEL_COMPROBANTE =\s*"([^"]*)"/.exec(handler)?.[1] ?? "x"
  ),
  "no puede contradecir a nadie"
);

console.log(
  fallos === 0
    ? "\nTODO OK — quien paga siempre recibe una respuesta"
    : `\n${fallos} comprobacion(es) mal.`
);
process.exit(fallos === 0 ? 0 : 1);
