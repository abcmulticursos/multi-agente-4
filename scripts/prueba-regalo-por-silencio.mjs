// El regalo ahora espera a que haya SILENCIO.
//
// ANTES el plazo se contaba desde que se programaba y no se movia. Si el
// cliente seguia conversando, el regalo caia en mitad de la charla — y con el
// segundo producto ofrecido eso deja DOS preguntas abiertas a la vez. Paso de
// verdad: el cliente escribio "si quiero comprarlo" pensando en el producto y
// el bot le contesto por el regalo.
//
// AHORA cada mensaje del cliente vuelve a poner el reloj a cero. El plazo no
// cambia de duracion: cambia desde cuando se cuenta, que pasa a ser el ULTIMO
// mensaje. Si el cliente se calla, el regalo sale igual que siempre.
//
// Son DOS relojes, porque el regalo llega por dos caminos:
//
//   · el plazo del segundo producto (si no contesta, sale el regalo)
//   · la pregunta del regalo en si
//
// Los dos se empujan. Y no se toca nada que ya este en marcha: si la pregunta
// del regalo ya salio, no hay nada pendiente que empujar.
//
// El tiempo se sigue poniendo donde siempre —Upsell y Regalo/Ajustes— y ahora
// esos campos dicen que se cuentan desde el ultimo mensaje.
//
//   node scripts/prueba-regalo-por-silencio.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");

const engine = leer("src", "lib", "workflow", "engine.ts");
const editor = leer("src", "app", "editor", "page.tsx");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 60)} ${valor}`);
};

const fn =
  engine.match(
    /function renovarEsperaDelRegalo\([\s\S]*?\r?\n\}\r?\n/
  )?.[0] ?? "";

comprobar("existe el renovador del plazo", fn.length > 0, "sí");
comprobar(
  // Si no se llama en CADA mensaje, el reloj no se mueve y volvemos al fallo.
  "se llama con cada mensaje que entra",
  /renovarEsperaDelRegalo\(convo, config\);/.test(engine),
  "sí"
);
// ARRIBA DEL TODO, antes de que el motor decida nada. Si se llamara despues de
// una de las salidas, los mensajes que salen por ahi no moverian el reloj.
//
// Y JUSTO AL LADO VA EL DE LOS SEGUIMIENTOS, que tenia el mismo fallo: contaban
// desde el primer mensaje y no se movian, asi que a quien seguia conversando le
// caia un «¿sigues ahi?» dos minutos despues de escribir.
comprobar(
  "y antes de que el motor decida nada",
  /renovarEsperaDelRegalo\(convo, config\);[\s\S]{0,400}?renovarEsperaDeLosSeguimientos\(convo\);\s*\r?\n\s*\r?\n\s*\/\/ SALIDA 2 DE 3/.test(
    engine
  ),
  "arriba del todo"
);

// ── Los dos relojes ─────────────────────────────────────────────────────────
comprobar(
  "empuja el plazo del segundo producto",
  /if \(hasPendingActionType\(convo\.id, ACTION_UPSELL_TIMEOUT\)\) \{[\s\S]*?cancelPendingActionsByTypeForConvo\(convo\.id, ACTION_UPSELL_TIMEOUT\);[\s\S]*?scheduleAction\(/.test(
    fn
  ),
  "sí"
);
comprobar(
  "y la pregunta del regalo",
  /if \(hasPendingActionType\(convo\.id, ACTION_SEND_GIFT_CONSENT\)\) \{[\s\S]*?cancelPendingActionsByTypeForConvo\(convo\.id, ACTION_SEND_GIFT_CONSENT\);[\s\S]*?scheduleAction\(/.test(
    fn
  ),
  "sí"
);
comprobar(
  // Con los dos pendientes manda el del producto: es el que decide si el regalo
  // llega a salir. Empujar los dos dejaría el orden al azar.
  "con los dos, manda el del segundo producto",
  /ACTION_UPSELL_TIMEOUT[\s\S]*?return;\s*\r?\n\s*\}/.test(fn),
  "sale primero"
);

// ── Lo que NO se toca ───────────────────────────────────────────────────────
comprobar(
  // Solo se empuja lo que está PENDIENTE. Si la pregunta ya salió, no hay nada
  // que mover y esto no hace nada.
  "solo empuja lo que sigue pendiente",
  (fn.match(/hasPendingActionType/g) ?? []).length === 2,
  "los dos relojes"
);
comprobar(
  // A quien ya recibió el regalo no hay que moverle nada.
  "a quien ya tiene el regalo no le toca nada",
  /if \(convo\.gift_rewarded\) return;/.test(fn),
  "sí"
);
comprobar(
  // AHORA ES UN SOLO NUMERO, Y ES EL DE LA SECCION REGALO.
  //
  // Antes esta comprobacion exigia los DOS: los minutos de la pestana Upsell y
  // los segundos de la de Regalo. Eran dos campos con el mismo nombre para el
  // mismo momento, y el tiempo real era su suma — el dueno escribia 60 segundos
  // y el regalo llegaba a los cuatro minutos. Orden suya del 2026-09-14: un solo
  // tiempo, el de la seccion Regalo. La intencion de esta linea no cambia
  // -la duracion la sigue poniendo la configuracion, no el codigo-; lo que
  // cambia es que ahora hay un unico sitio donde ponerla.
  "y la duración la sigue poniendo la configuración",
  /function segundosDeSilencioAntesDelRegalo\(/.test(engine) &&
    /awaiting_email_timeout_seconds \?\? DEFAULT_AWAITING_EMAIL_TIMEOUT/.test(
      engine
    ) &&
    !/espera_minutos/.test(engine),
  "un solo número, sin números nuevos"
);
comprobar(
  // Misma intencion, texto nuevo: la linea del upsell ahora dice los SEGUNDOS
  // de silencio que vuelve a contar, porque el plazo dejo de medirse en minutos
  // de otra pestana.
  "queda escrito cada vez que se corre",
  /sigue hablando, el regalo vuelve a contar/.test(fn) &&
    /sigue hablando, la pregunta del regalo se corre/.test(fn),
  "en el registro"
);

// ── El panel lo dice ────────────────────────────────────────────────────────
comprobar(
  // Un campo que dice "espera 30 min" cuando en realidad son 30 min de silencio
  // enseña algo que no pasa.
  // EL CAMPO DEL UPSELL YA NO EXISTE, Y ESO ES EL ARREGLO.
  //
  // Habia dos campos con el mismo nombre para el mismo momento —uno en Upsell y
  // otro en Regalo— y el tiempo real era su suma. Ahora hay uno, y en el sitio
  // del que sobraba se explica donde se pone. La intencion de esta linea sigue
  // siendo la misma: que el editor no ensene algo que no pasa.
  "el editor dice la verdad sobre el silencio",
  !/Minutos de SILENCIO antes de soltar el regalo/.test(editor) &&
    /El tiempo del regalo se pone en un solo sitio/.test(editor) &&
    /último mensaje del cliente<\/strong>/.test(editor),
  "sí"
);
comprobar(
  "y el del regalo también",
  /Silencio antes de ofrecer el regalo \(seg\)/.test(editor),
  "sí"
);

console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} comprobación(es) mal.`);
process.exit(fallos === 0 ? 0 : 1);
