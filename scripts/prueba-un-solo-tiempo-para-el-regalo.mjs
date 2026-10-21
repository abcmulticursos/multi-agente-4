// Un solo tiempo de espera para el regalo, y es el de la seccion Regalo.
//
// LO QUE ESTABA MAL
//
//   En el editor habia DOS campos, y los dos se llamaban lo mismo:
//
//       pestana Upsell  -> «Minutos de SILENCIO antes de soltar el regalo»
//       pestana Regalo  -> «Silencio antes de ofrecer el regalo (seg)»
//
//   El primero decidia cuando se soltaba el regalo y el segundo cuando salia su
//   pregunta. El tiempo real era la SUMA de los dos, y el dueno solo escribia
//   uno: puso 60 segundos y el regalo llegaba a los cuatro minutos.
//
// LA ORDEN
//
//   Del 14 de septiembre de 2026: «necesito que solo haya un tiempo de espera
//   para mostrar el ofrecimiento de regalo, deja solo el de la seccion regalo, y
//   recuerda que el tiempo se renueva cada vez que hay actividad».
//
//   node scripts/prueba-un-solo-tiempo-para-el-regalo.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");
const motor = leer("src", "lib", "workflow", "engine.ts");
const editor = leer("src", "app", "editor", "page.tsx");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 56)} ${valor}`);
};

// ── 1. El motor ya no lee el campo de la pestana Upsell ──────────────────────
console.log("— un solo numero manda —\n");
comprobar(
  "el motor NO lee `espera_minutos` en ningun sitio",
  !/espera_minutos/.test(motor),
  "el campo viejo quedo fuera"
);
comprobar(
  "y hay una sola funcion que da el plazo",
  /function segundosDeSilencioAntesDelRegalo\(/.test(motor) &&
    (motor.match(/segundosDeSilencioAntesDelRegalo\(/g) || []).length >= 4,
  "todos los sitios la usan"
);
comprobar(
  "que lee el campo de la seccion Regalo",
  /awaiting_email_timeout_seconds \?\? DEFAULT_AWAITING_EMAIL_TIMEOUT/.test(
    motor.slice(
      motor.indexOf("function segundosDeSilencioAntesDelRegalo("),
      motor.indexOf("function loQueFaltaDeSilencio(")
    )
  ),
  "«Silencio antes de ofrecer el regalo»"
);

// ── 2. Los tres sitios que programan el regalo usan el mismo plazo ───────────
console.log("\n— los tres relojes son ahora el mismo —\n");
comprobar(
  "al ofrecer el segundo producto",
  /ofrecido \(regalo en \$\{segundos\}s de silencio/.test(motor) &&
    (
      motor.match(
        /Math\.floor\(Date\.now\(\) \/ 1000\) \+ loQueFaltaDeSilencio\(convo\.id, segundos\)/g
      ) || []
    ).length >= 2,
  "desde el cliente"
);
comprobar(
  "al reponerlo tras la entrega",
  /loQueFaltaDeSilencio\(\s*\r?\n?\s*convo\.id,\s*\r?\n?\s*segundosDeSilencioAntesDelRegalo\(config\)\s*\r?\n?\s*\)/.test(
    motor
  ),
  "desde el cliente"
);
comprobar(
  "y al renovarlo porque el cliente escribio",
  /sigue hablando, el regalo vuelve a contar \$\{segundos\}s de silencio/.test(
    motor
  ),
  "entero otra vez"
);

// ── 3. SE RENUEVA CON CADA MENSAJE. Esto es lo que el dueno recalco. ─────────
console.log("\n— y se renueva con cada actividad —\n");
comprobar(
  "la renovacion corre en CADA mensaje, antes de cualquier rama",
  /renovarEsperaDelRegalo\(convo, config\);[\s\S]{0,400}?renovarEsperaDeLosSeguimientos\(convo\);/.test(
    motor
  ),
  "tryWorkflowOnIncoming"
);
comprobar(
  "y cancela el plazo anterior antes de poner el nuevo",
  (motor.match(/cancelPendingActionsByTypeForConvo\(convo\.id, ACTION_UPSELL_TIMEOUT\);/g) || [])
    .length >= 1 &&
    /cancelPendingActionsByTypeForConvo\(convo\.id, ACTION_SEND_GIFT_CONSENT\);/.test(
      motor
    ),
  "no se acumulan"
);

// ── 4. El editor ya no ofrece el numero que no manda ────────────────────────
console.log("\n— el editor no deja un numero muerto —\n");
comprobar(
  "el campo de la pestana Upsell ya no esta",
  !/Minutos de SILENCIO antes de soltar el regalo/.test(editor),
  "sin campo duplicado"
);
comprobar(
  "y en su sitio se dice donde se pone",
  /El tiempo del regalo se pone en un solo sitio/.test(editor),
  "apunta a la seccion Regalo"
);
comprobar(
  "el campo que SI manda sigue en su sitio",
  /Silencio antes de ofrecer el regalo \(seg\)/.test(editor),
  "seccion Regalo"
);

console.log(
  fallos === 0
    ? "\nTODO OK — un numero, contado desde el cliente, y se renueva al escribir"
    : `\n${fallos} comprobacion(es) mal.`
);
process.exit(fallos === 0 ? 0 : 1);
