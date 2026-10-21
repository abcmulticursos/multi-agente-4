// EL MISMO COMPROBANTE OTRA VEZ NO SE QUEDA SIN RESPUESTA.
//
// LO QUE PASÓ — 24 de septiembre de 2026. El dueño reenvió el mismo comprobante y
// el bot no dijo NADA. Con sus palabras: «el cliente puede creer que lo están
// ignorando». Y avisó de lo que no se puede confundir: «el cliente puede mandar
// el comprobante 2 veces solo para que uno se dé cuenta de que sí pagó».
//
// En su registro, los tres escalones:
//
//     comprobante DUPLICADO (huella ya contada) — no se vuelve a sumar
//     duplicado sobre venta ya aprobada — no re-entrego material ni re-ofrezco regalo
//     SIN RESPUESTA. El motor no atendió el turno y el modelo devolvió vacío
//
// LA CAUSA, medida: los dos primeros escalones son correctos y no se tocan. El
// silencio venía del tercero. Una aprobación normal se contesta con un espacio A
// PROPÓSITO —detrás va la secuencia de entrega que manda el motor, y si el modelo
// escribiera algo saldrían dos mensajes pisándose—. Pero con un duplicado sobre
// una venta ya aprobada NO se entrega nada, así que ese mismo espacio dejaba el
// turno entero vacío.
//
// LO QUE SE HIZO: el resultado del comprobante dice si es un duplicado, y en ese
// caso el turno vuelve al modelo, que ya recibe la orden de confirmarlo en una
// línea. El texto NO se escribe en el código.
//
// LO QUE NO PUEDE CAMBIAR, y es la mitad de esta prueba:
//
//   · La ruta es la misma: se aprueba, no se vuelve a sumar, no se re-entrega el
//     material y no se re-ofrece el regalo.
//   · Una aprobación NORMAL sigue callando. Ese espacio es lo que evita que el
//     bot hable encima de su propia entrega.
//
//   node scripts/prueba-el-comprobante-repetido-no-se-queda-mudo.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const cerebro = readFileSync(join(RAIZ, "src", "lib", "openrouter.ts"), "utf8");
const pago = readFileSync(
  join(RAIZ, "src", "lib", "workflow", "payment.ts"),
  "utf8"
);

let fallos = 0;
const comprobar = (titulo, ok, nota = "") => {
  if (!ok) fallos++;
  console.log(
    `${ok ? "ok   " : "FALLA"} ${titulo.padEnd(54).slice(0, 54)} ${nota}`
  );
};

// ── LA FUNCIÓN DE VERDAD, SACADA DEL ARCHIVO ────────────────────────────────
//
// No se reescribe de memoria: un código reimplementado prueba lo que uno CREE
// que hace, que es justo lo que se está poniendo en duda.
const cuerpo = (() => {
  const i = cerebro.indexOf("function paymentToolResultToDirectReply(");
  // Hasta la función siguiente: así no depende de si el archivo tiene los
  // saltos de línea de Windows o de Unix.
  const f = cerebro.indexOf("\nfunction isRetryableReceiptRejection", i);
  return i < 0 || f < 0 ? "" : cerebro.slice(i, f).trimEnd();
})();
const { paymentToolResultToDirectReply } = new Function(
  "getConversationById",
  "getEffectiveCountryCode",
  "loadWorkflowConfig",
  "getCountryInfo",
  "formatCurrencyAmount",
  cuerpo
    .replace(
      /function paymentToolResultToDirectReply\(\s*\r?\n\s*result: string,\s*\r?\n\s*conversationId: number\s*\r?\n\): string \| undefined \{/,
      "function paymentToolResultToDirectReply(result, conversationId) {"
    )
    .replace(/ as \{[\s\S]*?\};/, ";") +
    "\nreturn { paymentToolResultToDirectReply };"
)(
  () => null,
  () => "PE",
  () => null,
  () => ({ currency: "PEN" }),
  (n) => `S/. ${n}`
);

const resultado = (extra) =>
  JSON.stringify({
    status: "APPROVED",
    paid_total_soles: 20,
    course_price_soles: 20,
    missing_soles: 0,
    ...extra,
  });

// ── 1. EL DUPLICADO LO CONTESTA EL MOTOR ────────────────────────────────────
//
// ANTES se devolvia el turno al MODELO para que lo dijera con sus palabras, y
// esta prueba exigia justamente eso. SE CAMBIO EL 30/09/2026 porque fallo en
// vivo: al dueño le llego «NO_COMPROBANTE» en el chat.
//
// El motivo: en el turno de un comprobante quien contesta no es el modelo de la
// conversacion, es el LECTOR —«no converses», «responde exactamente
// NO_COMPROBANTE»—. Pedirle una frase amable es pedirle lo contrario de su
// trabajo, y solto la seña interna.
//
// LA INTENCION DE LA PRUEBA NO CAMBIA, y se cumple mejor: el duplicado NO se
// queda mudo. Lo que cambia es quien escribe la frase.
console.log("-- 1. el mismo comprobante otra vez -----------------------");
const delDuplicado = paymentToolResultToDirectReply(
  resultado({
    ya_estaba_registrado: true,
    reason: "Este comprobante ya estaba registrado y el material ya fue entregado.",
  }),
  1
);
comprobar(
  "no se queda mudo ni contesta con un espacio",
  typeof delDuplicado === "string" && delDuplicado.trim().length > 10,
  delDuplicado
);
comprobar(
  "le dice que ESE comprobante ya fue aprobado",
  /ya fue aprobado/i.test(delDuplicado ?? ""),
  "no se pone en duda el comprobante"
);
comprobar(
  "y le pide uno valido, de usted",
  /env[ií]eme un comprobante v[aá]lido/i.test(delDuplicado ?? ""),
  "«envíeme», no «envíame»"
);

// ── 2. UNA APROBACIÓN NORMAL SIGUE CALLANDO ─────────────────────────────────
//
// Es lo que evita que el bot hable encima de la entrega que manda el motor.
console.log("\n-- 2. y una aprobacion normal, igual que antes ------------");
comprobar(
  "sigue devolviendo el espacio",
  paymentToolResultToDirectReply(resultado({}), 1) === " ",
  "el motor manda la entrega detras"
);
comprobar(
  "y con la bandera apagada tambien",
  paymentToolResultToDirectReply(
    resultado({ ya_estaba_registrado: false }),
    1
  ) === " ",
  "solo el duplicado cambia"
);

// ── 3. EL RESULTADO DEL COMPROBANTE LO DICE ─────────────────────────────────
console.log("\n-- 3. quien lo marca --------------------------------------");
comprobar(
  "el duplicado sobre venta aprobada lleva la bandera",
  /duplicado sobre venta ya aprobada[\s\S]{0,1400}?ya_estaba_registrado: true,/.test(
    pago
  ),
  "y no hay que leer la frase para saberlo"
);
comprobar(
  "y le pide contestarlo en UNA linea",
  /ya_estaba_registrado: true,[\s\S]{0,1600}?UNA línea corta/.test(pago),
  "el texto no se escribe en el codigo"
);
// LO QUE PIDIO EL DUEÑO EL 30/09/2026, al ver que a su cliente le llegaba
// «envíame una foto clara donde se vea el monto, la fecha y la operación» con un
// comprobante perfecto que solo estaba repetido.
comprobar(
  "le dice que ESE comprobante ya se uso",
  /ya_estaba_registrado: true,[\s\S]{0,1600}?ya se usó/.test(pago),
  "en vez de dudar del comprobante"
);
comprobar(
  "y le pide el del pago NUEVO, si lo hubo",
  /ya_estaba_registrado: true,[\s\S]{0,1600}?pago nuevo/.test(pago),
  "sin dejarlo sin salida"
);
comprobar(
  "de USTED, nunca de tu",
  /ya_estaba_registrado: true,[\s\S]{0,1600}?de USTED, nunca de tú/.test(pago),
  "«envíeme», no «envíame»"
);

// ── 4. LA RUTA NO CAMBIA ────────────────────────────────────────────────────
//
// Lo que de verdad protege al cliente y al dueño: no se cobra dos veces, no se
// reenvía el material y no se vuelve a ofrecer el regalo.
console.log("\n-- 4. la ruta natural, intacta ----------------------------");
comprobar(
  "el duplicado NO se vuelve a sumar",
  /comprobante DUPLICADO \(huella ya contada\) — no se vuelve a sumar[\s\S]{0,200}?newTotalCents = convo\.paid_total_cents;/.test(
    pago
  ),
  "el total se queda como estaba"
);
comprobar(
  "ni re-entrega el material ni re-ofrece el regalo",
  /if \(isDuplicateReceipt && convo\.paid_at != null\) \{[\s\S]{0,1800}?return baseResult\(\{/.test(
    pago
  ),
  "corta antes de la acumulacion"
);
comprobar(
  "sigue siendo una aprobacion",
  /ya_estaba_registrado: true,[\s\S]{0,1800}?\}\);/.test(pago) &&
    /if \(isDuplicateReceipt && convo\.paid_at != null\) \{[\s\S]{0,1200}?status: "APPROVED",/.test(
      pago
    ),
  "el pago existe, no se pone en duda"
);
comprobar(
  "y los dos avisos del registro siguen en pie",
  (pago.match(/comprobante DUPLICADO \(huella ya contada\)/g) ?? []).length ===
    1 &&
    (pago.match(/duplicado sobre venta ya aprobada/g) ?? []).length === 1,
  "para poder diagnosticar"
);

// ── 5. Y EL OTRO SITIO QUE CALLABA, IGUAL ───────────────────────────────────
console.log("\n-- 5. el mismo criterio en las dos puertas ----------------");
comprobar(
  "la puerta del bucle de herramientas lo distingue",
  /parsed\.status === "APPROVED" &&\s*\r?\n\s*parsed\.ya_estaba_registrado === true\s*\r?\n\s*\) \{\s*\r?\n\s*directToolReply = undefined;/.test(
    cerebro
  ),
  "no se quedan discrepando"
);
comprobar(
  "y detras sigue el espacio de la aprobacion normal",
  /directToolReply = undefined;\s*\r?\n\s*\} else if \(parsed\.status === "APPROVED"\) \{\s*\r?\n\s*directToolReply = " ";/.test(
    cerebro
  ),
  "el orden importa"
);

console.log(
  fallos === 0
    ? "\nTODO OK — el comprobante repetido se confirma, y nada se entrega dos veces\n"
    : `\n${fallos} comprobacion(es) mal.\n`
);
process.exit(fallos === 0 ? 0 : 1);
