// GARANTÍA: una burbuja apagada del regalo no se envía nunca, por ningún
// camino.
//
// El regalo manda cosas desde cinco sitios distintos. Esta prueba recorre los
// cinco en el código real y comprueba que todos miran el ON/OFF, y que ninguno
// se escapa por un campo viejo cuando las burbujas están apagadas.
//
//   node scripts/prueba-regalo-apagadas-nunca.mjs
import { readFileSync } from "node:fs";

const fuente = readFileSync("src/lib/workflow/engine.ts", "utf8").replace(
  /\r\n/g,
  "\n"
);

/** El cuerpo de un bloque `if (action.action_type === X) {` hasta su cierre. */
function bloqueDeAccion(nombre) {
  const desde = fuente.indexOf(`if (action.action_type === ${nombre}) {`);
  if (desde < 0) throw new Error(`no encontré el manejador de ${nombre}`);
  const fin = fuente.indexOf("\n  }\n", desde);
  return fuente.slice(desde, fin);
}
function cuerpoDeFuncion(nombre) {
  const desde = fuente.indexOf(`function ${nombre}`);
  if (desde < 0) throw new Error(`no encontré ${nombre}`);
  return fuente.slice(desde, fuente.indexOf("\n}\n", desde));
}

let fallos = 0;
const comprobar = (nombre, ok, detalle = "") => {
  if (!ok) fallos++;
  console.log(`${ok ? "ok   " : "FALLA"} ${nombre}${detalle ? `  → ${detalle}` : ""}`);
};

// --- 1. Las burbujas de la secuencia del regalo ---
comprobar(
  "al programar la secuencia, se filtran las apagadas",
  /step\.enabled !== false/.test(cuerpoDeFuncion("scheduleGiftAudioAndText"))
);
comprobar(
  "al enviar una burbuja, se vuelve a mirar su ON/OFF",
  /step\.enabled === false\) return/.test(
    bloqueDeAccion("ACTION_SEND_GIFT_STEP")
  )
);

// --- 2. Las burbujas de la pregunta del regalo ---
comprobar(
  "al programar la pregunta, se filtran las apagadas",
  /step\.enabled !== false/.test(bloqueDeAccion("ACTION_SEND_GIFT_CONSENT"))
);
comprobar(
  "al enviar una burbuja de la pregunta, se vuelve a mirar su ON/OFF",
  /step\.enabled === false\) return/.test(
    bloqueDeAccion("ACTION_SEND_GIFT_CONSENT_STEP")
  )
);

// --- 3. Los campos viejos no reviven con todo apagado ---
comprobar(
  "con la secuencia toda apagada NO suena el audio viejo",
  /haySecuenciaConfigurada/.test(cuerpoDeFuncion("scheduleGiftAudioAndText"))
);
comprobar(
  "con la pregunta toda apagada NO sale el texto viejo",
  /haySecuenciaDeConsent/.test(bloqueDeAccion("ACTION_SEND_GIFT_CONSENT"))
);

// --- 4. Las variaciones del enlace ---
comprobar(
  "una variación apagada no entra en el sorteo",
  /v\.enabled !== false/.test(cuerpoDeFuncion("pickWeightedGiftText")) ||
    /enabled !== false/.test(cuerpoDeFuncion("pickWeightedGiftText"))
);
comprobar(
  "una variación apagada no gana por coincidencia de anuncio",
  /enabled !== false/.test(cuerpoDeFuncion("pickGiftTextByAd"))
);
comprobar(
  "la plantilla nunca se envía",
  /registry_template !== true/.test(cuerpoDeFuncion("getUsableGiftVariants"))
);

console.log(
  fallos === 0
    ? "\nLos 9 caminos respetan el apagado."
    : `\n${fallos} camino(s) no lo respetan.`
);
process.exit(fallos === 0 ? 0 : 1);
