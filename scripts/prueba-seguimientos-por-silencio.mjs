// Un seguimiento es para el que se callo, no para el que esta escribiendo.
//
// EL FALLO
//
//   El plazo se contaba desde el PRIMER mensaje y no se movia. Si el cliente
//   seguia conversando, el seguimiento caia en mitad de la charla: «¿sigues
//   ahi?» a alguien que acaba de escribir hace dos minutos.
//
//   Queda mal, y encima interrumpe: deja dos preguntas abiertas a la vez y el
//   cliente no sabe a cual esta contestando.
//
// COMO QUEDA
//
//   Cada mensaje del cliente vuelve a poner el reloj a cero, exactamente igual
//   que ya hacia el regalo. El seguimiento sale cuando de verdad hay silencio.
//
// LOS TRES CANDADOS, Y LOS TRES HACEN FALTA
//
//   1. Si ya pago, no se toca: ahi los seguimientos no van.
//   2. Si no hay ninguno pendiente, no se crea ninguno. Sin esto, escribir
//      despues de recibirlos todos resucitaria la cadena entera — o peor,
//      devolveria los que alguien canceló a proposito.
//   3. Se reagenda SOLO desde el siguiente al ultimo que recibio. Sin esto, el
//      cliente que escribe tras leer el primero recibe el primero otra vez.
//
//   node scripts/prueba-seguimientos-por-silencio.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const motor = readFileSync(
  join(RAIZ, "src", "lib", "workflow", "engine.ts"),
  "utf8"
);

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

const fn =
  motor.match(
    /function renovarEsperaDeLosSeguimientos\([\s\S]*?\r?\n\}\r?\n/
  )?.[0] ?? "";
comprobar("existe el renovador del plazo", fn.length > 0, "sí");

// -- 1. SE LLAMA CON CADA MENSAJE, Y ARRIBA DEL TODO -------------------------
//
// Si se llamara despues de alguna de las salidas del motor, los mensajes que
// salen por ahi no moverian el reloj — y son casi todos.
comprobar(
  "se llama con cada mensaje que entra",
  /renovarEsperaDeLosSeguimientos\(convo\);/.test(motor),
  "sí"
);
comprobar(
  "y antes de que el motor decida nada",
  /renovarEsperaDeLosSeguimientos\(convo\);\s*\r?\n\s*\r?\n\s*\/\/ SALIDA 2 DE 3/.test(
    motor
  ),
  "arriba del todo"
);

// -- 2. LOS TRES CANDADOS ----------------------------------------------------
comprobar(
  "si ya pagó, no se toca",
  /if \(convo\.state === "payment_approved"\) return;/.test(fn),
  "ahí no van seguimientos"
);
// ESTE ES EL QUE EVITA RESUCITAR LA CADENA. Sin el, escribir despues de
// recibirlos todos los volveria a agendar, y los cancelados volverian solos.
comprobar(
  "sin ninguno pendiente, no crea ninguno",
  /if \(!hasFuturePendingActionType\(convo\.id, ACTION_START_FOLLOWUP, ahora\)\) \{\s*\r?\n\s*return;/.test(
    fn
  ),
  "no resucita la cadena"
);
comprobar(
  "y se reagenda desde el siguiente al último recibido",
  /scheduleFollowupSequences\(convo\.id, \(convo\.last_followup_index \?\? -1\) \+ 1\);/.test(
    fn
  ),
  "no repite los leídos"
);
// Y EL QUE AGENDA TIENE QUE SABER SALTARSELOS. El parametro sin el salto seria
// decorativo: se pasaria el indice y se agendarian todos igual.
comprobar(
  "el que agenda sabe saltarse los ya enviados",
  /desdeIndice = 0\s*\r?\n\s*\): void \{/.test(motor) &&
    /if \(i < desdeIndice\) continue;/.test(motor),
  "no es un parámetro decorativo"
);
// Y POR OMISION EMPIEZA EN CERO: el arranque de siempre no puede cambiar.
comprobar(
  "y por omisión no se salta ninguno",
  /scheduleFollowupSequences\(convo\.id\);/.test(motor),
  "el arranque no cambia"
);

// -- 3. NO SE DUPLICAN -------------------------------------------------------
//
// Reagendar sin cancelar antes dejaria los viejos vivos: el cliente recibiria
// el seguimiento dos veces, a la hora vieja y a la nueva.
comprobar(
  "se cancelan los pendientes antes de reagendar",
  /cancelPendingActionsByTypeForConvo\(convo\.id, ACTION_START_FOLLOWUP\);/.test(
    fn
  ),
  "no se duplican"
);

// -- 4. QUEDA ESCRITO --------------------------------------------------------
//
// Un plazo que se mueve solo y en silencio es imposible de entender desde
// fuera: el seguimiento «no salio» y no hay forma de saber por que.
comprobar(
  "queda escrito cada vez que se corre",
  /sigue escribiendo, los seguimientos vuelven a contar desde ahora/.test(fn),
  "en el registro"
);

// -- 5. LA DURACION NO SE INVENTA AQUI ---------------------------------------
//
// El plazo lo sigue poniendo el campo de la pantalla. Esta funcion solo decide
// DESDE CUANDO se cuenta, no cuanto.
comprobar(
  "la duración la sigue poniendo la configuración",
  !/\d+ \* 60/.test(fn) && !/delay_minutes/.test(fn),
  "sin números nuevos"
);

console.log(
  fallos === 0
    ? "\nTODO OK — el seguimiento sale cuando hay silencio, no a una hora fija"
    : `\n${fallos} FALLO(S)`
);
process.exit(fallos === 0 ? 0 : 1);
