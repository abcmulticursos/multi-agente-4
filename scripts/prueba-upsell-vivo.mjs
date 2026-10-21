// Tres fallos de una misma venta, encontrados en una prueba real.
//
// 1. EL BOTON "SI, LO QUIERO" NO HACIA NADA
//
// Al ofrecer el upsell la conversacion pasa a "awaiting_email" —el estado que
// hace de sala de espera de toda la postventa—, y la rama de ese estado termina
// SIEMPRE en un return: o captura el correo, o se lo pasa al modelo. El bloque
// que atiende el upsell estaba escrito MAS ABAJO, asi que no se ejecutaba nunca
// mientras la oferta estaba en pie, que es justo cuando hace falta.
//
// Su propio comentario decia "va ANTES que los estados" y estaba despues.
//
// 2. Y EL MODELO NEGABA EL PRODUCTO
//
// El cerebro no sabia NADA del upsell. Con la oferta en pantalla y la clienta
// preguntando por ella contestaba que solo se vende un producto y que no hay
// materiales adicionales — negando por escrito lo que el bot acababa de
// ofrecer. Es la peor forma de perder una venta: parece una respuesta correcta.
//
// 3. HABLABA DE UN CORREO QUE NADIE PIDIO
//
// "awaiting_email" no significa "pedi el correo". Con la pregunta del correo
// apagada el bot nunca la manda, pero al modelo se le decia que si, y que
// estaba "visible arriba en la pantalla".
//
// Y UNA BURBUJA EN BLANCO
//
// Un comodin sin nada detras —{{METODO_DE_PAGO_1}} en un pais cuya tienda no
// tiene escritos sus datos— deja el texto vacio, y la burbuja se mandaba igual.
// En medio de los datos de pago llegaba un globo blanco: no da error, no avisa
// a nadie, y lo que falta es el numero al que hay que pagar.
//
//   node scripts/prueba-upsell-vivo.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");

const engine = leer("src", "lib", "workflow", "engine.ts");
const sender = leer("src", "lib", "workflow", "sender.ts");
const cerebro = leer("src", "lib", "openrouter.ts");
const revisar = leer("src", "lib", "editor", "revisar-pais.ts");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// ── 1. El upsell se atiende ANTES que la sala de espera ─────────────────────
const elUpsell = engine.indexOf('if (convo.upsell_state === "ofrecido") {');
const emailSinTexto = engine.indexOf(
  'if (state === "awaiting_email" && !hasEmailLikeText) {'
);
const emailConTexto = engine.indexOf('if (state === "awaiting_email") {');

comprobar(
  "los tres bloques siguen existiendo",
  elUpsell > 0 && emailSinTexto > 0 && emailConTexto > 0,
  "sí"
);
comprobar(
  // ESTE es el fallo. Si el upsell vuelve a quedar debajo, el botón "sí" deja
  // de hacer nada otra vez y no lo nota nadie: el modelo contesta educadamente.
  "el upsell se atiende antes que la espera del correo",
  elUpsell < emailSinTexto && elUpsell < emailConTexto,
  "primero"
);
comprobar(
  "la rama del correo sigue devolviendo siempre",
  /return trySalesbotOrLlm\(convo, msgContent, config\);\s*\r?\n\s*\}/.test(
    engine.slice(emailConTexto, emailConTexto + 2600)
  ),
  "sí — por eso importa el orden"
);
comprobar(
  "queda escrito por qué el orden importa",
  /ESTABA ESCRITO MÁS ABAJO, Y ESO LO DEJABA MUERTO/.test(engine),
  "en el código"
);
comprobar(
  "y sigue reconociendo el sí, el no y el nombre",
  /detectaAceptacionDeUpsell\(msgContent, config\)/.test(engine) &&
    /detectaSiSimpleAlUpsell\(msgContent\)/.test(engine) &&
    /detectaRechazoDeUpsell\(msgContent\)/.test(engine),
  "los tres"
);

// ── 2. El modelo ya sabe que el segundo producto existe ─────────────────────
comprobar(
  // Y también mientras PAGA: entre que acepta y manda el comprobante puede
  // preguntar cualquier cosa, y en ese hueco el modelo volvía a no saber que
  // el producto existe.
  "se le cuenta del segundo producto mientras lo decide Y mientras paga",
  /convo\?\.upsell_state === "ofrecido" \|\|\s*\r?\n\s*convo\?\.upsell_state === "aceptado"/.test(
    cerebro
  ) && /SECOND PRODUCT ON OFFER RIGHT NOW/.test(cerebro),
  "los dos momentos"
);
comprobar(
  // Una prueba que se contenta con un comentario no prueba nada, y deja el
  // fallo tapado justo donde parecía cubierto.
  "y no hay comentarios puestos para que la prueba pase",
  !/Legacy marker kept for static flow checks/.test(cerebro),
  "sin trampa"
);
comprobar(
  "con su nombre y su precio",
  /const extra = seccionUpsell\(loadWorkflowConfig\(\)\);/.test(cerebro) &&
    /getUpsellPriceSoles\(\s*\r?\n?\s*discountActive,/.test(cerebro),
  "los suyos"
);
comprobar(
  // Lo que dijo de verdad: "solo trabajamos con nuestro KIT — no manejamos
  // otros productos ni materiales adicionales".
  "se le prohíbe negar que existe",
  /NEVER say the business only sells one product/.test(cerebro),
  "prohibido"
);
comprobar(
  "no escribe él los datos de pago",
  /do NOT write payment data yourself — the SYSTEM sends it/.test(cerebro),
  "los manda el sistema"
);
comprobar(
  // Son burbujas que la clienta lee tal cual, y el sistema ya las manda solo
  // antes de llegar al modelo. Prestárselas sería invitarlo a reescribirlas.
  "no se le pasan las burbujas de contenido del upsell",
  !/extra\?\.info_steps|\$\{[^}]*info_steps/.test(cerebro),
  "no"
);
comprobar(
  "sin nombre puesto no se le cuenta nada",
  /if \(nombreExtra\) \{/.test(cerebro),
  "calla"
);

// ── 3. El correo solo se menciona si se pidió ───────────────────────────────
comprobar(
  "solo considera correo cuando el check está encendido",
  /const seLePidioElCorreo =\s*\r?\n\s*loadWorkflowConfig\(\)\?\.post_sale_delivery_preference\?\.enabled === true;/.test(
    cerebro
  ),
  "true explícito"
);
comprobar(
  "apagada, se le dice que NO lo pida ni lo mencione",
  /STATE: POST-SALE WAIT/.test(cerebro) &&
    /you did NOT ask for their email and you must NOT ask for it/.test(cerebro),
  "no lo menciona"
);
comprobar(
  "encendida, sigue el texto de siempre",
  /\} else if \(convo\?\.state === "awaiting_email"\) \{/.test(cerebro) &&
    /STATE: AWAITING_EMAIL — You asked the customer for their email/.test(
      cerebro
    ),
  "intacto"
);

// ── 4. Ninguna burbuja en blanco ────────────────────────────────────────────
comprobar(
  "una burbuja vacía no se manda",
  /if \(!safeBody\.trim\(\)\) \{/.test(sender) &&
    /burbuja VACÍA descartada/.test(sender),
  "se descarta"
);
comprobar(
  // Sin esto el fallo vuelve a ser invisible: hay que poder ver QUÉ comodín se
  // quedó sin valor.
  "y queda escrito con el texto sin resolver",
  /JSON\.stringify\(\s*\r?\n?\s*\(body \?\? ""\)\.slice\(0, 120\)/.test(sender),
  "en el registro"
);
comprobar(
  "el descarte va ANTES de guardar el mensaje",
  sender.indexOf("burbuja VACÍA descartada") <
    sender.indexOf('insertMessage(convo.id, "assistant", safeBody, null)'),
  "no ensucia el historial"
);

// ── 5. El editor avisa antes de que pase ────────────────────────────────────
comprobar(
  "revisa los cajones de datos de pago vacíos",
  /cajonesDePagoVacios/.test(revisar) &&
    /\["metodo_pago_1", "\{\{METODO_DE_PAGO_1\}\}"\]/.test(revisar),
  "sí"
);
comprobar(
  "y dice qué le pasaría al cliente",
  /al cliente le llega una burbuja vacía en lugar de la cuenta/.test(revisar),
  "claro"
);
comprobar(
  // Vacíos suelen significar "este país no los usa": avisar de ellos sería
  // ruido en casi todos los países, y un aviso que sale siempre no se lee.
  "no avisa del 2 ni del 3, que son opcionales",
  !/METODO_DE_PAGO_2/.test(revisar.split("cajonesDePagoVacios = (")[1] ?? ""),
  "sin ruido"
);

console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} comprobación(es) mal.`);
process.exit(fallos === 0 ? 0 : 1);
