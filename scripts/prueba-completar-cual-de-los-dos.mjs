// Con dos productos en la mesa, el bot pregunta cuál — no lo adivina.
//
// LO QUE PASO
//
//   Compro el basico, se le ofrecio el extra, y escribio:
//
//       «puedo completar lo que ya pague PARA LAS PLANTILLAS MOCKUP»
//
//   El bot le pidio los 1.000 que faltaban del FULL. Nombro un producto y le
//   cotizaron el otro.
//
// POR QUE
//
//   El detector del upgrade solo mira palabras: «completar», «resto»,
//   «diferencia». Y esas sirven para los DOS productos que hay en juego en ese
//   momento. Asi que daba por hecho que era la opcion cara.
//
//   Añadir «plantillas» a la lista no arregla nada: el siguiente dira «el nuevo»
//   o «el de las flores». Lo que se arregla es QUIEN decide QUE.
//
// LA REGLA
//
//   El detector sigue diciendo CUANDO hay intencion de completar. Ya no dice DE
//   QUE. Eso sale de si nombro un producto:
//
//     nombra la opcion cara  → se le da su saldo, como siempre
//     nombra el extra        → «ese va aparte, se paga completo»
//     no nombra ninguno      → se le PREGUNTA, con los dos nombres delante
//
// Y ANTES DE QUE SE OFREZCA EL EXTRA NO CAMBIA NADA: sin extra en juego no hay
// ambiguedad, se resuelve como la opcion cara y sigue el camino de siempre.
//
//   node scripts/prueba-completar-cual-de-los-dos.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const motor = readFileSync(
  join(RAIZ, "src", "lib", "workflow", "engine.ts"),
  "utf8"
);
const config = readFileSync(
  join(RAIZ, "src", "lib", "workflow", "config.ts"),
  "utf8"
);

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 60)} ${valor}`);
};

// ── LO QUE HAY QUE PROTEGER: los upgrades de ANTES del upsell ────────────────
//
// Es lo primero a proposito. En Order Bump y en Doble Oferta, «ya pague el
// basico, puedo pagar el full» funciona hoy y tiene que seguir funcionando
// exactamente igual. Ese camino ocurre ANTES de que exista el extra.
comprobar(
  "sin extra ofrecido, el upgrade sigue como siempre",
  /const aQueProducto = esperaPagoDelUpsell\s*\r?\n\s*\? queProductoNombra\(msgContent, config\)\s*\r?\n\s*: "combo";/.test(
    motor
  ),
  "se resuelve como «combo»"
);
comprobar(
  "y llega al mismo sitio de siempre",
  /const resolution = resolveAccumulatedOrderBumpChoice\(convo\.id, "combo"\);/.test(
    motor
  ) && /await sendOrderBumpComboUpgradeMessage\(convo, missingLabel, config\);/.test(motor),
  "sin tocar su camino"
);
comprobar(
  "y las guardas de entrada del upgrade no se tocaron",
  /const wantsUpgradeToCombo =\s*\r?\n\s*convo\.order_bump_choice === "basico" &&\s*\r?\n\s*detectaIntencionDeSubirAlCombo\(normalizedPostSaleText, config\);/.test(
    motor
  ) &&
    /isPostSaleState &&\s*\r?\n\s*wantsUpgradeToCombo &&\s*\r?\n\s*\(isOrderBumpActive\(\) \|\| isDobleOfertaActive\(\)\)/.test(
      motor
    ),
  "mismas condiciones"
);

// ── Los tres casos, cuando SÍ hay extra en juego ─────────────────────────────
console.log("");
comprobar(
  "nombra el extra → se le dice que va aparte",
  /if \(aQueProducto === "upsell"\) \{\s*\r?\n\s*await responderQueElExtraSePagaEntero\(convo, config\);/.test(
    motor
  ),
  "y su precio completo"
);
comprobar(
  "no nombra ninguno → se le pregunta",
  /if \(aQueProducto === null\) \{\s*\r?\n\s*await preguntarPorCualDeLosDos\(convo, config\);/.test(
    motor
  ),
  "no se adivina"
);
comprobar(
  "y la pregunta lleva los DOS nombres, no «full» ni «upsell»",
  /const laCara = getActiveTwoTierOffer\(config\)\?\.combo\?\.name\?\.trim\(\);/.test(
    motor
  ) &&
    /const elExtra = seccionUpsell\(config\)\?\.name\?\.trim\(\);/.test(motor) &&
    /¿A cuál te refieres\?/.test(motor),
  "el cliente no sabe esas palabras"
);
comprobar(
  "y deja explicada la regla en la misma pregunta",
  /sí, puedes completar lo que ya pagaste/.test(motor) &&
    /ese va aparte y se paga completo/.test(motor),
  "la respuesta viene informada"
);
// Sin los dos nombres configurados no se puede preguntar sin sonar a
// formulario: ahi se deja pasar y contesta el modelo, como antes.
comprobar(
  "y sin nombres configurados, no pregunta a medias",
  /if \(!laCara \|\| !elExtra\) return;/.test(motor),
  "deja pasar el turno"
);

// ── El detector de a QUÉ producto: por nombre, no por intención ──────────────
console.log("");
comprobar(
  "quién decide de qué producto sale de los NOMBRES",
  /export function queProductoNombra\(/.test(config) &&
    /return "upsell";/.test(config) &&
    /return "combo";/.test(config),
  "no de una lista de frases"
);
comprobar(
  "los nombres salen de la configuración, no del código",
  /getActiveTwoTierOffer\(cfg\)/.test(config) &&
    /seccionUpsell\(cfg\)\?\.name/.test(config),
  "es una plantilla"
);
// Del extra solo cuentan las palabras que NO comparte con las dos opciones: las
// compartidas no distinguen nada y confundirian una con otra.
comprobar(
  "y del extra solo cuentan sus palabras propias",
  /const delExtra = palabrasSueltas\(seccionUpsell\(cfg\)\?\.name \?\? ""\)\.filter\(\s*\r?\n\s*\(p\) => p\.length >= 4 && !deLasOpciones\.has\(p\)\s*\r?\n\s*\);/.test(
    config
  ),
  "sin las compartidas"
);

console.log(
  fallos === 0
    ? "\nTODO OK — pregunta cuál, y el upgrade de antes del extra sigue intacto"
    : `\n${fallos} comprobacion(es) mal.`
);
process.exit(fallos === 0 ? 0 : 1);
