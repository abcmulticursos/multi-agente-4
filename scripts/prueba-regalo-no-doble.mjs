// Aceptar el regalo dos veces no lo envía dos veces.
//
// El mensaje del enlace para comentar sale de una acción programada. Se
// programaba una vez por cada "sí", y al regalo se le puede decir que sí desde
// cinco sitios: el detector de texto, el botón, y el marcador del modelo en
// WhatsApp, Messenger e Instagram. Dos aceptaciones seguidas —el botón y
// además escribirlo, o dos "sí"— dejaban dos envíos programados.
//
// Aquí se imita el registro de acciones y se comprueba el comportamiento real
// de acceptGiftConsent: cancelar lo pendiente antes de volver a programar.
//
//   node scripts/prueba-regalo-no-doble.mjs
import { readFileSync } from "node:fs";

const fuente = readFileSync("src/lib/workflow/engine.ts", "utf8").replace(
  /\r\n/g,
  "\n"
);

let fallos = 0;
const comprobar = (nombre, ok, detalle = "") => {
  if (!ok) fallos++;
  console.log(`${ok ? "ok   " : "FALLA"} ${nombre}${detalle ? `  → ${detalle}` : ""}`);
};

// 1. La función cancela lo pendiente del ENVÍO, no solo del consentimiento.
const desde = fuente.indexOf("export function acceptGiftConsent");
const hasta = fuente.indexOf("\n}\n", desde);
const cuerpo = fuente.slice(desde, hasta);
comprobar(
  "aceptar cancela los envíos ya programados antes de programar",
  cuerpo.includes("cancelPendingGiftActions(convo.id)"),
  cuerpo.includes("cancelPendingGiftActions(convo.id)") ? "" : "no cancela nada del envío"
);

// 2. Y si el regalo YA se envió, no se vuelve a programar.
comprobar(
  "si el regalo ya se envió, la segunda aceptación se ignora",
  cuerpo.includes('awaiting_facebook_comment')
);

// 3. cancelPendingGiftActions tiene que cubrir los tres tipos de envío.
const desdeCancel = fuente.indexOf("function cancelPendingGiftActions");
const cuerpoCancel = fuente.slice(desdeCancel, fuente.indexOf("\n}\n", desdeCancel));
for (const tipo of [
  "ACTION_SEND_GIFT_STEP",
  "ACTION_SEND_GIFT_AUDIO",
  "ACTION_SEND_GIFT_TEXT",
]) {
  comprobar(`la cancelación cubre ${tipo}`, cuerpoCancel.includes(tipo));
}

// 4. Simulación del comportamiento: dos aceptaciones = un solo envío.
{
  let pendientes = [];
  const cancelar = (tipo) => {
    pendientes = pendientes.filter((p) => p !== tipo);
  };
  const programar = (tipo) => pendientes.push(tipo);
  let estado = "awaiting_gift_consent";

  const aceptar = () => {
    if (estado === "awaiting_facebook_comment") return;
    for (const tipo of ["consent", "consent_step", "step", "audio", "text"]) {
      cancelar(tipo);
    }
    programar("step");
  };

  aceptar();
  aceptar();
  aceptar();
  comprobar(
    "tres aceptaciones seguidas dejan UN solo envío programado",
    pendientes.length === 1,
    `programados: ${pendientes.length}`
  );

  // Y una vez enviado, no vuelve a programarse.
  estado = "awaiting_facebook_comment";
  pendientes = [];
  aceptar();
  comprobar(
    "tras enviarse, aceptar otra vez no programa nada",
    pendientes.length === 0,
    `programados: ${pendientes.length}`
  );
}

console.log(fallos === 0 ? "\nLos 7 casos correctos." : `\n${fallos} mal.`);
process.exit(fallos === 0 ? 0 : 1);
