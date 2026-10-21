// El cliente pagaba, mandaba el comprobante, y el bot le contestaba "gracias
// por avisarme".
//
// EL COMPROBANTE DEJABA DE EXISTIR EN CUANTO EL CLIENTE ESCRIBIA OTRA COSA.
//
// La foto del comprobante solo llegaba a los ojos del bot si era el ULTIMO
// mensaje del cliente. Pero nadie manda una foto y se queda callado: manda la
// foto y sigue escribiendo "listo", "ya esta pagado", "a que hora llega". Para
// cuando el bot iba a contestar, el ultimo mensaje era texto, la foto no
// viajaba al modelo, no se leia el monto, no se llamaba al validador y la venta
// se perdia. El cliente pago y se quedo esperando su enlace.
//
// Habia una rendija de 5 segundos para la foto con su pie de texto. Alcanzaba
// para el pie de foto y para nada mas: dos lineas seguidas ya se salian.
//
// MIRAR EL RELOJ NUNCA IBA A FUNCIONAR, y se intento dos veces el mismo dia
// (4 de septiembre):
//
//   1 sep  ventana de 180 segundos    valia cualquier foto de los 3 minutos
//   4 sep  19:15  c8bbd43             se quita la ventana entera
//   4 sep  20:08  366c388             vuelve una rendija de 5 segundos
//
// El de las 19:15 arreglaba un problema real: con 3 minutos, un "gracias"
// posterior hacia re-analizar un comprobante YA aprobado y el bot se quedaba
// mudo por la guarda de duplicados. Pero el reloj no distingue una foto recien
// llegada de una que el bot ya atendio. Al cerrarle la puerta a la vieja, se la
// cerro tambien a la nueva.
//
// La pregunta correcta no es CUANDO llego la foto sino si YA FUE ATENDIDA:
// mientras el bot no haya contestado nada despues de ella, sigue pendiente.
//
// Y ESTO NO ERA SOLO EL PAGO. La misma regla decide en el motor si el turno
// "trae comprobante", y de ahi cuelgan el UPGRADE al combo y el pago del
// SEGUNDO PRODUCTO. Con el comprobante invisible, esos dos pagos se trataban
// como el eco del primero: se cobra y no se entrega.
//
//   node scripts/prueba-comprobante-con-mensajes-despues.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");

const cerebro = leer("src", "lib", "openrouter.ts");
const engine = leer("src", "lib", "workflow", "engine.ts");
const pago = leer("src", "lib", "workflow", "payment.ts");
const handler = leer("src", "lib", "meta", "handler.ts");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 62)} ${valor}`);
};

// ── 1. El comprobante llega a leerse aunque no sea el ultimo mensaje ─────────
const vision = cerebro.slice(
  cerebro.indexOf("function getRecentVisionImage"),
  cerebro.indexOf("function bloqueDeMedia")
);
comprobar(
  "el cerebro ya no descarta la foto por el reloj",
  !/created_at\s*-\s*m\.created_at\s*<=\s*\d/.test(vision),
  "sin ventana de segundos"
);
comprobar(
  "el cerebro busca la ultima respuesta del bot",
  /const ultimaRespuestaDelBot = history\.findLastIndex\(\s*\(m\) => m\.role === "assistant"\s*\)/.test(
    vision
  ),
  "ultimaRespuestaDelBot"
);
comprobar(
  // ESTE es el arreglo: la foto vale mientras el bot no haya contestado.
  "solo cuentan las fotos posteriores a esa respuesta",
  /i > ultimaRespuestaDelBot/.test(vision),
  "i > ultimaRespuestaDelBot"
);
comprobar(
  "sigue exigiendo que sea media legible con archivo real",
  /esMediaLegible\(m\)/.test(vision) &&
    /!!m\.media_url/.test(vision) &&
    /!!m\.media_mime/.test(vision),
  "imagen o PDF del banco"
);

// ── 2. El motor reconoce el mismo comprobante (upgrade y segundo producto) ───
const zonaMotor = engine.slice(
  engine.indexOf("const ultimoDelCliente = getLatestUserMessage"),
  engine.indexOf("const wantsPurchasedMaterial")
);
comprobar(
  "el motor ya no descarta la foto por el reloj",
  !/created_at\s*-\s*m\.created_at\s*<=\s*\d/.test(zonaMotor),
  "sin ventana de segundos"
);
comprobar(
  "el motor usa la misma regla que el cerebro",
  /const ultimaRespuestaDelBot = historialReciente\.findLastIndex/.test(
    zonaMotor
  ) && /i > ultimaRespuestaDelBot/.test(zonaMotor),
  "misma regla en los dos sitios"
);
comprobar(
  "sigue contando solo mensajes del cliente",
  /m\.role === "user"/.test(zonaMotor),
  'role === "user"'
);
comprobar(
  "el turno con comprobante sigue alimentando latestIsImage",
  /const latestIsImage =[\s\S]{0,200}pairedUserMedia;/.test(engine),
  "latestIsImage"
);

// ── 3. Lo que NO se puede romper: el upgrade y el segundo producto ───────────
comprobar(
  "el upgrade al combo sigue reconociendose por el comprobante",
  /const mayBeDobleOfertaUpgradeReceipt =\s*\r?\n\s*latestIsImage &&/.test(
    engine
  ),
  "mayBeDobleOfertaUpgradeReceipt"
);
comprobar(
  "sigue en pie la senal de que se espera el pago del segundo producto",
  /const esperaPagoDelUpsell =\s*\r?\n\s*convo\.upsell_state === "ofrecido" \|\| convo\.upsell_state === "aceptado";/.test(
    engine
  ),
  "esperaPagoDelUpsell"
);
comprobar(
  // Los cuatro estados post-venta dejan pasar el comprobante nuevo. Si uno solo
  // se queda sin la salida, ahi se pierde la segunda venta.
  "los estados post-venta siguen dejando pasar ese comprobante",
  (engine.match(
    /if \(mayBeDobleOfertaUpgradeReceipt \|\| esperaPagoDelUpsell\) return false;/g
  ) ?? []).length >= 4,
  `${(engine.match(/if \(mayBeDobleOfertaUpgradeReceipt \|\| esperaPagoDelUpsell\) return false;/g) ?? []).length} salidas`
);

// ── 4. Lo que NO se puede romper: nada se cobra ni se entrega dos veces ──────
comprobar(
  "sigue la huella por operacion, fecha+monto e id de imagen",
  /fingerprints\.push\(`op:/.test(pago) &&
    /fingerprints\.push\(`dt:/.test(pago) &&
    /fingerprints\.push\(`img:/.test(pago),
  "tres capas de huella"
);
comprobar(
  // Sin esto, releer una foto ya aprobada volveria a entregar el material.
  "un duplicado sobre venta aprobada no re-entrega nada",
  /if \(isDuplicateReceipt && convo\.paid_at != null\)/.test(pago),
  "idempotencia post-venta"
);
comprobar(
  "un duplicado tampoco vuelve a sumar al total pagado",
  /if \(isDuplicateReceipt\) \{[\s\S]{0,300}newTotalCents = convo\.paid_total_cents;/.test(
    pago
  ),
  "no se suma dos veces"
);

// ── 5. Lo que NO se toca: la espera de la rafaga y la guarda post-entrega ────
comprobar(
  "el agrupador de mensajes sigue igual (8 segundos)",
  /BOT_DEBOUNCE_SECONDS \?\? 8/.test(handler),
  "debounce intacto"
);
comprobar(
  "tras entregar, el modelo sigue sin agregar su propia confirmacion",
  /latestUserIsImage &&\s*\r?\n\s*!comprobanteDelSegundoProducto &&/.test(
    handler
  ),
  "supresion post-compra intacta"
);

console.log(
  fallos === 0
    ? "\nTODO OK — el comprobante se lee aunque el cliente siga escribiendo"
    : `\n${fallos} FALLA(S)`
);
process.exit(fallos === 0 ? 0 : 1);
