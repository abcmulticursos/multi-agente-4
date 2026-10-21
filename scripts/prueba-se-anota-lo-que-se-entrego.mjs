// SE ANOTA LO QUE SE LE ENTREGO, PARA PODER REENVIARLO DESPUES.
//
// LO QUE PASO — 29 de septiembre de 2026, sus pruebas ARG1 (convo 311) y PEROU1
// (convo 314). Las dos pagaron, recibieron su material, y al reclamar despues que
// no les habia llegado el bot contesto «claro, te lo reenvio ahora mismo» y no
// salio nada:
//
//     [wf:pago] convo 311: REENVÍO de material (ya pagó)
//     [wf:pago] convo 311: PAGÓ y no hay entrega que mandar (la entrega "approved")
//
// LAS OTRAS CUATRO SI LO RECIBIERON. La diferencia es exacta: las cuatro tenian
// una opcion ANOTADA —la eligieron, o el importe la registro— y las dos que
// fallaron no tenian ninguna.
//
// LA CAUSA. Cuando el cliente nunca elige, el motor decide que entregar y lo
// entrega bien, pero solo ANOTABA la eleccion en la rama del combo. En la del
// basico se entregaba sin dejar constancia, asi que mas tarde el reenvio
// preguntaba por la opcion, no habia ninguna, y caia al cajon «Pago Aprobado».
//
// Y ahi se acababa por su contenido: ese cajon tiene dos burbujas y las dos estan
// apagadas. Habia material que mandar —el de la opcion— y el bot no sabia que era
// el suyo.
//
//   node scripts/prueba-se-anota-lo-que-se-entrego.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const pago = readFileSync(join(RAIZ, "src", "lib", "workflow", "payment.ts"), "utf8");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// ── 1. SE ANOTA LO ENTREGADO, EN LAS DOS RAMAS ──────────────────────────────
console.log("\n— 1. se anota lo que se entrega, sin importar cual sea —\n");
const zona = pago.slice(
  pago.indexOf("const aEntregar ="),
  pago.indexOf("deliverOrderBumpTier(conversationId, aEntregar);") + 60
);
comprobar("la zona existe", zona.length > 100, `${zona.length} letras`);
comprobar(
  "se anota la opcion entregada, la que sea",
  /setOrderBumpChoice\(conversationId, aEntregar\);/.test(zona),
  "aEntregar"
);
comprobar(
  "y ya NO se anota solo el combo",
  !/setOrderBumpChoice\(conversationId, "combo"\);/.test(zona),
  "sin el caso suelto"
);
comprobar(
  "se entrega exactamente lo mismo que antes",
  /deliverOrderBumpTier\(conversationId, aEntregar\);/.test(zona),
  "el mismo valor"
);
comprobar(
  "la anotacion va ANTES de entregar",
  zona.indexOf("setOrderBumpChoice(conversationId, aEntregar)") <
    zona.indexOf("deliverOrderBumpTier(conversationId, aEntregar)"),
  "orden correcto"
);
comprobar(
  "el aviso del combo regalado se conserva",
  /pagó sin haber visto nunca la oferta y su abono cubre el combo/.test(zona)
);

// ── 2. LA REGLA QUE DECIDE QUE ENTREGAR NO SE TOCA ──────────────────────────
//
// Es la que protege de regalar el full a quien pago el basico. Vale mas que el
// arreglo de arriba y no se puede mover.
console.log("\n— 2. quien pago el basico sigue recibiendo el basico —\n");
comprobar(
  "lo decide el importe, no solo «no vio la oferta»",
  /const aEntregar =\s*\r?\n?\s*ofertaNuncaRevelada && suPagoCubreElCombo \? "combo" : "basico";/.test(
    pago
  )
);
comprobar(
  "y se sigue comparando contra el precio del combo de SU pais",
  /getOrderBumpPriceSoles\(\s*"combo",\s*discountActive,\s*convo\.phone\s*\)/.test(
    pago
  )
);
{
  // La condicion real, ejecutada.
  const decidir = new Function(
    "ofertaNuncaRevelada",
    "suPagoCubreElCombo",
    `return ofertaNuncaRevelada && suPagoCubreElCombo ? "combo" : "basico";`
  );
  comprobar("nunca vio la oferta y su pago cubre el combo -> combo", decidir(true, true) === "combo");
  comprobar("nunca vio la oferta y pago el basico -> basico", decidir(true, false) === "basico");
  comprobar("vio la oferta y no eligio -> basico", decidir(false, true) === "basico");
  comprobar("vio la oferta y pago el basico -> basico", decidir(false, false) === "basico");
}

// ── 3. EL REENVIO YA PUEDE SABER QUE MANDAR ─────────────────────────────────
console.log("\n— 3. el reenvio pregunta por la opcion, y ahora la hay —\n");
comprobar(
  "el reenvio mira la opcion anotada",
  /convo\.order_bump_choice === "combo" \|\|\s*\r?\n?\s*convo\.order_bump_choice === "basico"/.test(
    pago
  )
);
comprobar(
  "y si no hay ninguna, sigue cayendo al cajon general (sin tocar)",
  /const pasos = config\?\.payment_approved_sequence;/.test(pago),
  "el respaldo queda igual"
);
comprobar(
  "el aviso de «no hay entrega que mandar» se conserva",
  /PAGÓ y no hay entrega que mandar/.test(pago),
  "sigue avisando"
);
comprobar(
  "y el extra se sigue reenviando solo si lo pago",
  /convo\.upsell_state === "pagado" \? seccionUpsell\(config\)\?\.delivery : null/.test(
    pago
  )
);

console.log(
  fallos === 0
    ? "\nTODO OK — queda constancia de lo entregado, y quien pago el basico sigue recibiendo el basico\n"
    : `\n${fallos} FALLO(S)\n`
);
process.exit(fallos === 0 ? 0 : 1);
