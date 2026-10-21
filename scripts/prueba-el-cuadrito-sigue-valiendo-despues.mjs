// El cuadrito de la intro vale tambien cuando el cliente elige mas tarde.
//
// LO QUE PASABA
//
//   Los cuadritos de la intro se leian SOLO mientras la intro estaba detenida
//   en esa burbuja (`intro_paused_index`). Contestar ahi mismo funcionaba; pero
//   si el cliente desviaba —una duda, una consulta al modelo— y al volver
//   escribia lo que el cuadrito esperaba, su texto no salia nunca.
//
//   El mismo trabajo escrito, atendido o tirado segun el momento en que el
//   cliente contestara. Y sin ninguna señal: el bot respondia bien lo demas.
//
// POR QUE NO SE PODIA A SECAS
//
//   Un cuadrito con la palabra «si» leido en cualquier momento se come los
//   turnos del modelo: cada «ok» de la conversacion dispararia un texto de
//   venta. Es el mismo fallo del «si» del segundo producto, multiplicado por
//   todos los cuadritos.
//
// LA REGLA
//
//   Fuera de su momento solo deciden las palabras que SEÑALAN algo —«yape»,
//   «el completo», «transferencia»—. Las que contestan a cualquier pregunta
//   —«si», «ok», «no»— siguen valiendo unicamente dentro de la pausa, que es
//   donde se sabe a que contestan. El comodin (un cuadrito sin palabras)
//   tampoco: ahi dentro atrapa «lo que no encajo en las demas», que fuera de la
//   pregunta es TODO.
//
//   node scripts/prueba-el-cuadrito-sigue-valiendo-despues.mjs
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
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 60)} ${valor}`);
};

// ── 1. Existe, y filtra las palabras que no señalan nada ─────────────────────
// LA VENTANA ES LA FUNCION ENTERA, NO UN TROZO DE LARGO FIJO. Era `i + 2600`, y
// al crecer el comentario de la funcion las comprobaciones de abajo se quedaron
// fuera de la ventana y «fallaban» sin que nada se hubiera roto. Se busca de su
// cabecera hasta la llave que la cierra: asi la prueba mide la funcion, no su
// longitud.
const buscador = (() => {
  const i = motor.indexOf("function cuadritoDeLaIntroQueSeñala(");
  if (i < 0) return "";
  const fin = motor.indexOf("\n}", i);
  return fin < 0 ? motor.slice(i) : motor.slice(i, fin + 2);
})();
comprobar(
  "hay quien busque el cuadrito fuera de la pausa",
  buscador.length > 0,
  "cuadritoDeLaIntroQueSeñala"
);
comprobar(
  "un «si» o un «ok» no deciden fuera de su momento",
  // Antes el descarte iba dentro de la condicion del filtro
  // (`!PALABRAS_QUE_NO_SEÑALAN.test(limpia)`). Ahora el filtro tiene varias
  // reglas y sale por la puerta de atras en cuanto la palabra no señala nada.
  // La intencion no cambia: esas palabras se descartan. Se comprueba eso.
  /const PALABRAS_QUE_NO_SEÑALAN =/.test(motor) &&
    /PALABRAS_QUE_NO_SEÑALAN\.test\(limpia\)\) return false;/.test(buscador),
  "no señalan nada"
);
// Sin ninguna palabra que señale, el cuadrito no entra: eso incluye al comodin,
// que fuera de su pregunta atraparia todos los mensajes.
comprobar(
  "y el comodín sin palabras tampoco",
  /if \(claves\.length === 0\) return null;/.test(buscador),
  "atraparía todo"
);
// EL MISMO COMPARADOR DE SIEMPRE. Se filtran las palabras y se llama a
// `decisionQueCoincide`: un cuadrito no puede entenderse de dos formas segun
// por donde se lea.
comprobar(
  "usa el comparador de siempre, con las palabras filtradas",
  /const elegida = decisionQueCoincide\(msgContent, candidatas\);/.test(buscador),
  "una sola forma de entenderlo"
);
// Y solo la intro que ESTE cliente recibio: hay varias y el bot sortea una.
comprobar(
  "y solo mira la intro que ese cliente recibió",
  /if \(convo\.intro_variant_sent == null\) return null;/.test(buscador),
  "no contesta por una burbuja que no vio"
);
comprobar(
  "las apagadas no cuentan",
  /if \(decision\.enabled === false\) return null;/.test(buscador) &&
    /if \(\(paso as \{ enabled\?: boolean \}\)\.enabled === false\) continue;/.test(
      buscador
    ),
  "burbuja y cuadrito"
);

// ── 2. Dónde se usa, y con qué candados ──────────────────────────────────────
const iBloque = motor.indexOf(
  "  // Y EL CUADRITO DE LA INTRO SIGUE VALIENDO DESPUÉS."
);
// LA VENTANA SE MIDE POR LO QUE HAY QUE COMPROBAR, no por lo que medía el
// bloque el día que se escribió esto. El 22/09/2026 se le añadió un comentario
// al reenvío y las dos ultimas afirmaciones —que estaban en el 8.538 y el
// 8.899— se quedaron fuera de los 8.200: dos rojas sin que el codigo hubiera
// cambiado una linea. Se amplia con holgura; lo que se comprueba es lo mismo.
const bloque = iBloque < 0 ? "" : motor.slice(iBloque, iBloque + 12000);
comprobar(
  "el bloque va después del de la pausa",
  bloque.length > 0 &&
    motor.indexOf("const elegida = decisionDeLaBurbujaEnPausa(") < iBloque,
  "la pausa manda primero"
);
// Y DETRAS DE LA REGLA DEL COMPROBANTE. Una foto con un pie que nombre el
// metodo —«aqui esta el yape»— tiene que llegar al lector. Delante de esa
// regla, esto seria una puerta mas de las que se tragaban el comprobante.
comprobar(
  "y detrás de la regla del comprobante",
  motor.indexOf(
    "if (latestIsImage && esperandoUnPago && !laImagenAquiNoEsUnPago)"
  ) < iBloque,
  "el comprobante va derecho al lector"
);
// Antes de la compra. Despues contesta la postventa, y un texto de venta ahi es
// lo contrario de lo que toca.
comprobar(
  "solo antes de la compra",
  /convo\.paid_at == null &&/.test(bloque),
  "la postventa es de otro"
);
// Y solo con la conversacion libre: en los estados que tienen UNA pregunta
// abierta contesta su rama, que sabe a que se le esta diciendo que si.
comprobar(
  "y solo con la conversación libre",
  /ETAPAS_SIN_PREGUNTA_ABIERTA\.has\(convo\.state \?\? ""\)/.test(bloque) &&
    /const ETAPAS_SIN_PREGUNTA_ABIERTA = new Set<string>\(\[/.test(motor),
  "elegir opción, correo y regalo se quedan fuera"
);
// LAS MISMAS GUARDAS QUE EL PAGO. Sin ellas, el cuadrito con la palabra «yape»
// le contestaria con los datos a quien dice «no tengo yape».
comprobar(
  "no dispara con una queja ni con un método negado",
  /!messageHasPaymentConcern\(msgContent\) &&\s*\r?\n\s*!methodMentionIsNegated\(msgContent, convo\.phone\) &&/.test(
    bloque
  ),
  "las mismas del pago"
);
comprobar(
  "ni con un comprobante que nadie ha leído",
  /const comprobanteSinLeer = getRecentUserMessages\(convo\.id, 5\)\.find\(/.test(
    bloque
  ) && /!comprobanteSinLeer/.test(bloque),
  "el turno es de la IA con visión"
);

// ── 3. Su texto primero, su acción después ───────────────────────────────────
// Entre el envio y la accion se anota la decision tomada y se cierra la venta si
// sus burbujas llevan la cuenta. Lo segundo NO depende de que haya accion.
comprobar(
  "sale su texto y después lo que tenga enlazado",
  /const salio = await sendConfiguredSteps\(convo, suyo\.steps\);\s*\r?\n\s*if \(salio \|\| suyo\.action\) setUltimaDecision\(convo\.id, claveDeLaDecision\);/.test(
    bloque
  ) && /if \(suyo\.action\) \{\s*\r?\n\s*await ejecutarAccion\(/.test(bloque),
  "igual que en la pausa"
);
// SU TEXTO ES LA RESPUESTA, IGUAL QUE EN LA PAUSA.
//
// Aqui estuvo el segundo fallo. Se dejaba seguir el mensaje SIEMPRE, dando por
// hecho que su texto era un añadido. No lo es: los cuadritos de pago llevan las
// tres burbujas enteras —presentacion, la cuenta y el cierre— asi que detras
// salia la de fabrica diciendo lo mismo.
//
// Solo hay UN caso en que el mensaje sigue: que el cliente este eligiendo
// metodo de pago Y su texto no diga a donde pagar.
comprobar(
  "su texto es la respuesta, como en la pausa",
  /const eligiendoMetodo = detectPaymentRoute\(msgContent, convo\.phone\);/.test(
    bloque
  ) && /if \(!eligiendoMetodo \|\| susBurbujasCierranLaVenta\) \{/.test(bloque),
  "sin duplicar el de fábrica"
);
comprobar(
  "y si solo presentó, el de fábrica sale sin repetirla",
  /suTextoYaPresentoElPago = true;/.test(bloque),
  "nadie se queda sin datos"
);
comprobar(
  "con acción sí, y queda dicho en el log",
  /eligió "\$\{suyo\.title \|\| "\(sin título\)"\}" fuera de la pausa/.test(bloque),
  "no hay que adivinar"
);

// ── 4. LO QUE NO CAMBIA ──────────────────────────────────────────────────────
comprobar(
  "la pausa sigue leyendo su burbuja, como siempre",
  /function decisionDeLaBurbujaEnPausa\(/.test(motor) &&
    /const laQuePregunto = pasos\[desde - 1\];/.test(motor),
  "intacta"
);
comprobar(
  "y ahí un «sí» sigue valiendo",
  /return decisionQueCoincide\(msgContent, laQuePregunto\?\.decisions\);/.test(
    motor
  ),
  "sin filtrar palabras"
);

console.log(
  fallos === 0
    ? "\nTODO OK — el cuadrito sigue valiendo después"
    : `\n${fallos} comprobacion(es) mal.`
);
process.exit(fallos === 0 ? 0 : 1);
