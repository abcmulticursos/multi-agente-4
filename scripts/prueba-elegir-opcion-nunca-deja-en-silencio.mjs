// ELEGIR UNA OPCION NUNCA PUEDE DEJAR AL CLIENTE EN SILENCIO.
//
// LO QUE PASO — 27 de septiembre de 2026, su conversacion de prueba 237. Abrio
// una conversacion nueva, espero el seguimiento 2 y toco el boton. El registro
// dice que el motor hizo lo correcto:
//
//     [wf] convo 237: "QUIERO EL DESCUENTO" -> eligio combo
//
// Y el cliente no recibio NI UN MENSAJE. Ademas la venta quedo marcada como si
// ya tuviera los datos de pago.
//
// DONDE ESTABA EL VOLANTE ROTO. Comparando dos paises con la misma
// configuracion global:
//
//     su pais:  3 burbujas de pago directo escritas, las 3 APAGADAS,
//               cierre vacio            ->  0 pasos  ->  pago directo APAGADO
//     el otro:  0 burbujas escritas     ->  usa las globales  ->  3 pasos  ->  OK
//
// Las dos cajas dicen lo mismo —aqui no hay nada que enviar— y el motor las
// trataba distinto: la VACIA caia al texto global, la APAGADA dejaba al bot
// mudo. Esa asimetria no la eligio nadie. Apagar tres burbujas no es «quiero
// mandar vacio»: es que quedaron apagadas.
//
// SE REPARA AHI, no se tapa mas abajo: si de la caja del pais no queda NADA
// —ninguna burbuja viva y ningun cierre— vale lo mismo que no haber escrito
// ninguna, y se usa el texto global. Con eso el cliente recibe sus datos de
// pago, que es lo que tenia que pasar.
//
// LO QUE NO PUEDE ROMPERSE, y es justo lo que la regla anterior protegia:
//
//   · EL PAIS QUE ESCRIBE MANDA EL SUYO, aunque deje el CIERRE vacio a
//     proposito. Basta con que quede UNA burbuja viva, o un cierre escrito.
//   · EL QUE NO ESCRIBE NADA sigue usando el global, letra por letra.
//   · Y SE AVISA EN EL REGISTRO cuando se cae al global por estar todo apagado:
//     era la caja que parece llena y esta vacia, el fallo que mas veces ha
//     costado dinero en este proyecto.
//
// Medido antes de tocarlo: en toda su configuracion hay UN solo caso asi, y
// ningun pais depende de quedarse mudo.
//
//   node scripts/prueba-elegir-opcion-nunca-deja-en-silencio.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const motor = readFileSync(join(RAIZ, "src", "lib", "workflow", "engine.ts"), "utf8");

let fallos = 0;
const comprobar = (titulo, ok, nota = "") => {
  if (!ok) fallos++;
  console.log(
    `${ok ? "ok   " : "FALLA"} ${titulo.padEnd(54).slice(0, 54)} ${nota}`
  );
};

// -- 1. LA CUENTA DEL PAIS, EJECUTADA ---------------------------------------
//
// Se trae la decision real de `getDirectPaymentSteps` —las tres lineas que
// eligen entre la caja del pais y la global— y se corre con las cuatro formas
// que importan. No se reescribe de memoria: se extrae del archivo.
console.log("-- 1. de que caja sale el texto -------------------------");
const trozo = (desde, hasta) => {
  const i = motor.indexOf(desde);
  const f = motor.indexOf(hasta, i);
  return i < 0 || f < 0 ? "" : motor.slice(i, f);
};
const laDecision = trozo(
  "  const hayPropios = Array.isArray(propios) && propios.length > 0;",
  "  const rawSteps = quedaAlgoPropio"
);
comprobar(
  "se encuentra la decision en el motor",
  laDecision.length > 0,
  "getDirectPaymentSteps"
);
const decide = new Function(
  "propios",
  "delPais",
  "console",
  laDecision.replace(/: unknown|: string/g, "") + "\nreturn quedaAlgoPropio;"
);
const silencio = { warn: () => {} };
const viva = { type: "text", body: "hola" };
const apagada = { type: "text", body: "hola", enabled: false };

comprobar(
  "sin caja propia → el global",
  decide(undefined, {}, silencio) === false,
  "el pais que no escribio nada"
);
comprobar(
  "con una burbuja viva → la suya",
  decide([viva, apagada], {}, silencio) === true,
  "la regla de siempre, intacta"
);
comprobar(
  "todas apagadas pero CON cierre → la suya",
  decide([apagada, apagada], { direct_payment_cta: "nos envías tu comprobante" }, silencio) ===
    true,
  "el cierre vacio a proposito se respeta"
);
comprobar(
  "SU CASO: todas apagadas y sin cierre → el global",
  decide([apagada, apagada, apagada], { direct_payment_cta: "" }, silencio) === false,
  "aqui estaba el silencio"
);
comprobar(
  "y un cierre de solo espacios no cuenta",
  decide([apagada], { direct_payment_cta: "   " }, silencio) === false,
  "no es un cierre escrito"
);

// -- 2. EL AVISO EN EL REGISTRO ---------------------------------------------
//
// Su regla: «una linea de log no prueba que algo salio». Aqui faltaba la linea
// que dice que la caja del pais se quedo sin nada.
console.log("\n-- 2. la caja vacia ya no se esconde --------------------");
comprobar(
  "avisa cuando cae al global por estar todo apagado",
  /if \(hayPropios && !quedaAlgoPropio\) \{/.test(motor) &&
    /TODAS apagadas y sin cierre → uso el texto global/.test(motor),
  "el caso que engaña"
);
comprobar(
  "y NO avisa cuando el pais no escribio nada",
  /const hayPropios = Array\.isArray\(propios\) && propios\.length > 0;/.test(
    motor
  ),
  "ahi usar el global es lo normal"
);

// -- 3. Y NO SE TAPO CON UN BYPASS MAS ABAJO --------------------------------
//
// El dueño lo dijo con un ejemplo que no admite discusion: al volante roto no
// se le pone un aviso, se repara. La rama que elige producto termina como
// siempre: manda la «respuesta al elegir» y deja el estado. Sin ifs nuevos.
console.log("\n-- 3. se reparo arriba, no se tapo abajo ----------------");
const elFinal = (() => {
  const i = motor.indexOf("  await enviarRespuestaAlElegir(");
  return i < 0 ? "" : motor.slice(i, motor.indexOf("\n}", i));
})();
comprobar(
  "la rama de elegir quedo como estaba",
  /await enviarRespuestaAlElegir\(\s*\r?\n?\s*convo,/.test(elFinal) &&
    /setConversationState\(convo\.id, "payment_done"\);/.test(elFinal),
  "sin remiendos"
);
comprobar(
  "y no hay ningun respaldo pegado ahi",
  !/salioSuRespuesta/.test(motor) &&
    !/en vez de callarme/.test(motor),
  "el arreglo esta en la causa"
);

console.log(
  fallos === 0
    ? "\nTODO OK — la caja apagada vale como vacia, y el cliente recibe sus datos\n"
    : `\n${fallos} comprobacion(es) mal.\n`
);
process.exit(fallos === 0 ? 0 : 1);
