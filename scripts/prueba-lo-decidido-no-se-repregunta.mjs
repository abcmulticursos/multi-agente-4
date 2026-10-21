// LO QUE YA ESTA DECIDIDO NO SE VUELVE A PREGUNTAR.
//
// LO QUE PASO, EN LA PRUEBA DEL 13 DE SEPTIEMBRE DE 2026 (convo 20)
//
//   La clienta dijo «yape», se le abrio la oferta, pregunto un par de cosas y
//   eligio: «el combo esta bien». Recibio sus datos de pago. Y despues:
//
//     <- «mejor las alfa no tengo mucho dinero»
//        estado=payment_done — contesto el modelo, bien, hablando del basico
//     <- «yape»
//        [wf] convo 20 -> order bump "combo" confirmado, continuo con pago "yape"
//
//   Leyo un precio en el texto y le cobraron otro. Y no habia forma de que
//   nadie lo notara: el modelo hablaba del basico y el bot del combo, y los dos
//   «tenian razon».
//
// POR QUE NO LO CAZO NADIE — NO ERA QUE EL BOT DEJARA DE ESCUCHAR
//
//   La puerta que atiende el cambio de opcion en `payment_done` existe desde el
//   primer commit (engine.ts, dentro de `intro_done || payment_done`). Lo que
//   fallo fue el DETECTOR.
//
//   Los dos productos se llamaban «ALFA» y «COMBO ALFA +
//   PAPEL». Un nombre ENTERO dentro del otro: el barato se queda sin ninguna
//   palabra suya —«alfa» y «pepito» las tienen los dos— y la regla que decide
//   el cambio pide una palabra exclusiva. Nombrar el barato era invisible.
//
//   Es la forma normal de nombrar un order bump, asi que le pasa a cualquier
//   cliente que instale esta plantilla y llame «COMBO <X> + <Y>» a su opcion
//   cara.
//
// COMO SE ARREGLO
//
//   La cara es la barata MAS algo. Si el cliente nombra lo compartido y NO
//   nombra ese algo, esta nombrando la barata. Vive en
//   `inferTwoTierChoiceFromContext` (config.ts), que es donde estaba la causa.
//
//   Y LAS REGLAS DEL MODELO VAN FUERA DE LAS CAJAS DEL PANEL, porque las cajas
//   se guardan la primera vez que el dueño toca el cerebro: desde entonces, una
//   regla escrita en el codigo por defecto ya no le llega nunca.
//
// LO QUE NO PUEDE VOLVER A PASAR
//
//   1. Que nombrar un producto no cuente porque su nombre esta dentro del otro.
//   2. Que una pregunta cambie el producto elegido.
//   3. Que el bot y el modelo hablen de productos distintos.
//   4. Que la guarda temprana del motor use un detector mas suelto que la
//      puerta de siempre: en `payment_done` un «esta caro» o un «gracias por
//      todo» NO son un cambio de producto.
//
//   node scripts/prueba-lo-decidido-no-se-repregunta.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");

// PARA PROBAR LA FUNCION DE VERDAD, NO SU TEXTO.
//
// `config.ts` se importa tal cual —Node quita los tipos solo— resolviendo el
// atajo «@/» del proyecto. `@/lib/db` se sustituye por un doble vacio: abrir la
// base de datos real para preguntarle a un detector de palabras no hace falta,
// y una prueba no debe tocar `data/`.
const DOBLE_DE_LA_BASE = "stub:db";
registerHooks({
  resolve(especificador, contexto, siguiente) {
    if (especificador === "@/lib/db")
      return { url: DOBLE_DE_LA_BASE, format: "module", shortCircuit: true };
    if (especificador.startsWith("@/")) {
      const relativo = especificador.slice(2);
      const conExtension = /\.[a-z]+$/.test(relativo) ? relativo : `${relativo}.ts`;
      // Sin `format`: asi Node reconoce el .ts y le quita los tipos solo.
      return {
        url: pathToFileURL(join(RAIZ, "src", conExtension)).href,
        shortCircuit: true,
      };
    }
    return siguiente(especificador, contexto);
  },
  load(url, contexto, siguiente) {
    if (url === DOBLE_DE_LA_BASE)
      return {
        format: "module",
        shortCircuit: true,
        source:
          "export const getConversationByPhone = () => null;\n" +
          "export const getFrozenPrices = () => null;\n" +
          "export const getUpsellFrozenPrices = () => null; export const getPuestoEnLaFila = () => null; export const leerCompradosDeLaFila = () => []; export const moverLaFila = () => {};\n" +
          "export const setFrozenPrices = () => {};\n",
      };
    return siguiente(url, contexto);
  },
});

const { inferTwoTierChoiceFromContext, detectTwoTierPick } = await import(
  pathToFileURL(join(RAIZ, "src", "lib", "workflow", "config.ts")).href
);

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

const oferta = (nombreCombo, precioCombo, nombreBasico, precioBasico) => ({
  order_bump: {
    enabled: true,
    combo: { name: nombreCombo, price_soles: precioCombo, aliases: [] },
    basico: { name: nombreBasico, price_soles: precioBasico, aliases: [] },
  },
});

// Los nombres de la conversacion real: uno dentro del otro.
const SOLAPADOS = oferta("COMBO ALFA + BETA", 14, "ALFA", 10);
// Los nombres que tiene hoy el bot: cada uno con palabras suyas.
const DISTINTOS = oferta("COMBO DOS EN UNO", 12, "HOJAS SUELTAS", 10);

const eligiendo = (msg, teniaElegido, cfg) =>
  inferTwoTierChoiceFromContext(msg, teniaElegido, cfg);

// -- 1. EL MENSAJE EXACTO QUE SE PERDIO ---------------------------------------
comprobar(
  "«mejor las alfa no tengo mucho dinero» = el basico",
  eligiendo("mejor las alfa no tengo mucho dinero", "combo", SOLAPADOS) ===
    "basico",
  "el mensaje de la convo 20"
);
comprobar(
  "nombrar el barato cuenta aunque su nombre este dentro",
  eligiendo("las alfa mejor", "combo", SOLAPADOS) === "basico",
  "sin palabras propias"
);
// LA CARA SIGUE GANANDO CUANDO NOMBRA LO SUYO. «beta» y «combo» son de ella.
comprobar(
  "y nombrar lo propio de la cara sigue siendo la cara",
  eligiendo("mejor el combo con beta", "basico", SOLAPADOS) === "combo",
  "combo / beta"
);

// -- 2. PREGUNTAR NO ES ELEGIR ------------------------------------------------
comprobar(
  "«las alfa cuestan 14?» no cambia nada",
  eligiendo("las alfa cuestan 14?", "combo", SOLAPADOS) === null,
  "pregunta de precio"
);
comprobar(
  "«que trae las alfa» tampoco",
  eligiendo("que trae las alfa", "combo", SOLAPADOS) === null,
  "pregunta de contenido"
);
// Y SIN DEPENDER DE LOS SIGNOS: casi nadie escribe «¿».
comprobar(
  "y se reconoce la pregunta sin signos",
  eligiendo("cuanto cuestan las alfa", "combo", SOLAPADOS) === null,
  "por las palabras"
);

// -- 3. REPETIR LO QUE YA TENIA NO MANDA NADA ---------------------------------
comprobar(
  "nombrar la que YA tenia elegida no dice nada nuevo",
  eligiendo("las alfa", "basico", SOLAPADOS) === null,
  "no se reenvia el pago"
);

// -- 3.b LO COMPARTIDO TIENE QUE DISTINGUIR DE VERDAD -------------------------
//
// Con nombres como «EL CURSO» y «EL CURSO + BONO» lo compartido es «el» y
// «curso»: palabras de cualquier frase. Si contaran, un «quiero el combo»
// nombraria «el», no nombraria «bono», y la regla entregaria el BARATO — justo
// al reves de lo que el cliente pidio. Cuando lo compartido no distingue, la
// regla se aparta.
const COMPARTIDO_GENERICO = oferta("EL CURSO + BONO", 14, "EL CURSO", 10);
comprobar(
  "«quiero el combo» NO entrega el barato por la palabra «el»",
  eligiendo("quiero el combo", "combo", COMPARTIDO_GENERICO) !== "basico",
  "lo compartido no distingue"
);
comprobar(
  "y nombrar lo propio de la cara sigue mandando",
  eligiendo("quiero el bono", "basico", COMPARTIDO_GENERICO) === "combo",
  "«bono» es suya"
);

// -- 4. CON NOMBRES NORMALES, TODO IGUAL QUE SIEMPRE --------------------------
//
// La regla nueva solo mira cuando un nombre esta DENTRO del otro. Con los
// nombres de hoy no llega a ejecutarse, y eso es lo que se comprueba aqui.
comprobar(
  "con nombres distintos, el barato se elige por el suyo",
  eligiendo("mejor las hojas", "combo", DISTINTOS) === "basico",
  "hojas / trazos"
);
comprobar(
  "«esta caro» NO es cambiar de producto",
  eligiendo("esta caro", "combo", DISTINTOS) === null,
  "ya eligio y habla de lo suyo"
);
comprobar(
  "«gracias por todo» tampoco",
  eligiendo("gracias por todo", "combo", DISTINTOS) === null,
  "ni «todo» ni «caro»"
);
comprobar(
  "y «el mas barato» sigue decidiendo",
  eligiendo("dame el mas barato", "combo", DISTINTOS) === "basico",
  "el adjetivo de siempre"
);

// -- 5. LA GUARDA TEMPRANA DEL MOTOR NO PUEDE SER MAS SUELTA ------------------
//
// Hay una guarda en `payment_done` que decide esto mismo ANTES que la puerta de
// siempre. Tiene que usar EL MISMO detector y las MISMAS condiciones: con el
// detector amplio, «esta caro» cambiaria de producto y le mandaria otro precio.
const motor = leer("src", "lib", "workflow", "engine.ts");
const guarda = (() => {
  const i = motor.indexOf("// CAMBIAR DE OPCIÓN DESPUÉS DE HABER ELEGIDO");
  if (i < 0) return "";
  // LA VENTANA SE CIERRA DONDE ACABA LA GUARDA, NO A LOS 3.600 CARACTERES.
  //
  // Estaba cortada a una longitud fija y los comentarios de esta zona crecen
  // cada vez que se documenta un fallo: el trozo dejaba fuera el final y estas
  // comprobaciones fallaban solas sin que nada se hubiera roto. Una prueba que
  // falla sola deja de avisar cuando pasa algo de verdad.
  const fin = motor.indexOf("deliverOrderBumpResponse(convo, otra);", i);
  return motor.slice(i, fin > i ? fin + 60 : i + 3600);
})();
comprobar(
  "la guarda temprana existe",
  guarda.length > 0 && /state === "payment_done" &&/.test(guarda),
  "antes de pagar"
);
// SIGUE SIENDO EL CONSERVADOR. El 16/09 se le añadió detrás, como respaldo, la
// lectura de lo que el bot acababa de proponer —para que un «sí» a la propuesta
// del bot también cambie de opción—, y eso partió la línea en dos. Lo que la
// afirmación protege no cambia: aquí NO entra el detector amplio.
comprobar(
  "y usa el detector conservador, no el amplio",
  /const otra =\s*\n?\s*inferTwoTierChoiceFromContext\(/.test(guarda) &&
    !/detectTwoTierPick\(/.test(guarda),
  "el mismo que la puerta de siempre"
);
comprobar(
  "solo si de verdad cambia",
  /otra && otra !== convo\.order_bump_choice/.test(guarda),
  "repetir la misma no manda nada"
);
comprobar(
  "un comprobante encima no cambia el producto",
  /!latestIsImage &&/.test(guarda),
  "el pago se lee primero"
);
comprobar(
  "un metodo de pago no es un producto",
  /detectPaymentRoute\(msgContent, convo\.phone\) === null/.test(guarda),
  "los botones no eligen opcion"
);
// CON ALGO YA ABONADO, LA PUERTA DE ABAJO. Sabe restar lo pagado y pedir la
// diferencia; aqui se soltaria el importe entero.
comprobar(
  "con un pago parcial encima se deja pasar",
  /convo\.paid_total_cents === 0 &&/.test(guarda),
  "lo resuelve la puerta de abajo"
);
comprobar(
  "y va por el mismo camino que la primera eleccion",
  /await deliverOrderBumpResponse\(convo, otra\);/.test(guarda),
  "sin volver a preguntar nada"
);

// -- 6. EL CEREBRO SE QUEDA COMO ESTABA ---------------------------------------
//
// AQUI HUBO TRES REGLAS GLOBALES PARA EL MODELO, Y SE QUITARON.
//
// Decian que lo ya decidido no se repregunta. La intencion era buena y el
// problema es real, pero le llegaban en TODOS los turnos de venta, tambien en
// los de pregunta pura: ante «que contiene X» el modelo quedaba entre dos
// ordenes —contesta / no expliques y ve al precio— y hacia las dos, explicando
// largo y cerrando con una peticion de compra. Ante un «ok» vacio soltaba el
// bloque otra vez: 590 tokens de salida donde lo normal eran 130.
//
// Se subieron sin haberlas corrido nunca. Que el texto este en el archivo no
// prueba NADA sobre lo que el modelo hace con el — es justo lo que comprobaban
// las verificaciones que habia aqui, y por eso pasaban en verde mientras el bot
// se comportaba raro.
//
// Si vuelve a intentarse: por modalidad, no global, y probado en el simulador
// antes de publicar. Lo que resolvio el caso real fue el MOTOR.
const modelo = leer("src", "lib", "openrouter.ts");
comprobar(
  "el cerebro no lleva reglas globales de repregunta",
  !/LO QUE YA ESTÁ DECIDIDO NO SE VUELVE A PREGUNTAR:/.test(modelo) &&
    !/LO QUE YA ESTÁ DECIDIDO NO SE VUELVE A PREGUNTAR:/.test(
      leer("src", "lib", "system-prompt.ts")
    ),
  "la disciplina va por modalidad"
);
// NADA DE NOMBRES DE PRODUCTO EN EL CODIGO. Lo que se vende se escribe en el
// contenido; el motor tiene que servir igual para cualquier producto.
const config = leer("src", "lib", "workflow", "config.ts");
const motorLimpio = !/(TINTAS PEPITO|LAMINAS DE TRAZOS|COMBO 2 EN 1)/.test(
  motor + modelo + config + leer("src", "lib", "system-prompt.ts")
);
comprobar(
  "el codigo no lleva ningun nombre de producto",
  motorLimpio,
  "se escriben en el contenido"
);

// -- 7. Y EL MOTOR TAMPOCO REPREGUNTA «¿LO QUIERES?» --------------------------
//
// LO QUE PASO: el cliente pregunta el precio, lee la respuesta y escribe «me
// llevo el basico». El bot le contesta «cuesta S/N, lo quieres?». Ya lo habia
// dicho — y encima con el metodo de pago elegido de antes.
//
// POR QUE: la puerta de `awaiting_order_bump_choice` miraba SOLO el mensaje
// ANTERIOR (`previousCustomerMessageWasPriceQuestion`). Si ese era una pregunta
// de precio, confirmaba, sin mirar si el de AHORA ya era una compra.
//
// LO QUE NO SE PUEDE PERDER AL ARREGLARLO: la confirmacion sigue haciendo falta
// cuando el cliente solo desambigua un precio («el basico» a secas). Lo que se
// va es la repregunta cuando ya decidio.
const puerta = (() => {
  const i = motor.indexOf("// ¿La elección viene JUSTO tras una pregunta de precio?");
  return i < 0 ? "" : motor.slice(i, i + 2600);
})();
comprobar(
  "la confirmacion tras pregunta de precio sigue ahi",
  /await askOrderBumpPurchaseConfirm\(convo, obChoice, config\);/.test(puerta),
  "«el basico» a secas sigue confirmando"
);
comprobar(
  // El 02/10/2026 la pregunta paso a ser DOS: la frase de compra y el «si» a secas. Ver
  // `isPurchaseAffirmative`, donde se reparten. Lo que protege no cambia.
  "pero no se dispara si el mensaje YA es la decision",
  /previousCustomerMessageWasPriceQuestion\(convo\.id, msgContent\) &&\s*\r?\n?\s*!isPurchaseAffirmative\(msgContent\) &&\s*\r?\n?\s*!soloEstaDeAcuerdo\(msgContent\)/.test(
    puerta
  ),
  "«me llevo el basico» va directo al pago"
);
// LA MISMA PAREJA DE FUNCIONES QUE LEE EL «SI» DE LA CONFIRMACION. Si un dia «me lo
// llevo» deja de contar como un si, tiene que dejar de contar en los dos sitios.
//
// EL 02/10/2026 LA PREGUNTA PASO A SER DOS, y es el arreglo de raiz de ese dia: una
// palabra de acuerdo suelta —«si», «ok», «dale»— solo significa si cuando va SOLA, y eso
// lo lee `soloEstaDeAcuerdo`; una frase de compra —«lo quiero», «me lo llevo»— significa si
// vaya donde vaya, y eso lo lee `isPurchaseAffirmative`.
//
// Antes estaban juntas en una sola lista buscada con `\b…\b`, o sea en cualquier parte. Por
// eso «si pero que contiene», «si pero no me van a estafar» y «si me hacen llegar el
// material o se pasan» se leian como compras. Lo que protege esta comprobacion no cambia:
// que las dos puertas pregunten LO MISMO.
comprobar(
  "y usa las mismas funciones que leen el «si» de la confirmacion",
  /pendingChoice &&\s*\r?\n?\s*\(isPurchaseAffirmative\(msgContent\) \|\| soloEstaDeAcuerdo\(msgContent\)\)/.test(
    motor
  ),
  "una sola respuesta a la misma pregunta"
);
// Y LA RAIZ, ESCRITA: sin esto, volver a meter «si» y «ok» en la lista de frases de compra
// no pondria roja ninguna prueba y los tres casos de ese dia volverian de golpe.
comprobar(
  "las palabras de acuerdo ya no viven en la lista de compra",
  !/\\b\(si\|sip\|sipi\|claro\|dale/.test(motor),
  "«si» suelto no es una frase de compra"
);

// LO QUE ENTRA EN ESA PUERTA NUNCA ES UNA PREGUNTA.
//
// Por eso no hace falta volver a descartarlas: para llegar ahi,
// `detectTwoTierPick` ya devolvio una opcion, y devuelve null ante cualquier
// pregunta. Si esto dejara de ser cierto, «cuanto vale el combo» —que lleva
// «vale», palabra afirmativa— se colaria como decision y soltaria el pago.
comprobar(
  "una decision con verbo de compra SI elige",
  detectTwoTierPick("quiero las hojas", DISTINTOS) === "basico",
  "quiero"
);
comprobar(
  "y una pregunta de precio NO llega a la puerta",
  detectTwoTierPick("cuanto vale el combo 2 en 1", DISTINTOS) === null,
  "«vale» no se cuela como afirmacion"
);
comprobar(
  "ni una pregunta de contenido",
  detectTwoTierPick("que trae el combo 2 en 1", DISTINTOS) === null,
  "la contesta el modelo"
);

// -- 8. «MEJOR EL OTRO» CAMBIA DE OPCION, SIN ROMPER EL CANDADO --------------
//
// LO QUE PASO: con el combo elegido y los datos de pago delante, la clienta
// escribio «creo que mejor el otro, no tengo mucho dinero». El motor no lo
// registro y siguio con el combo guardado.
//
// EL HUECO ERA UNA PALABRA: «mejor» no esta en la lista de verbos de decision de
// `isOrderBumpConversationQuestion`, asi que la frase caia en el filtro de
// preguntas — donde «el otro» esta a proposito, porque es el CANDADO del Order
// Bump: asi el cliente pregunta por el producto que todavia no se le ha
// revelado. Esa linea no se toca.
//
// La excepcion vive donde SI se sabe que eligio el cliente, y exige siete
// condiciones. Sin eleccion previa ni se mira: el candado queda intacto.
const SIN_EXTRA = { elExtraNoEstaEnJuego: true };
const eligeConElOtro = (msg, tenia, cfg = SOLAPADOS) =>
  inferTwoTierChoiceFromContext(msg, tenia, cfg, SIN_EXTRA);

comprobar(
  "«creo que mejor el otro» cambia de opcion",
  eligeConElOtro("creo que mejor el otro, no tengo mucho dinero", "combo") ===
    "basico",
  "el mensaje de la convo 22"
);
comprobar(
  "y «ya mejor la otra» tambien",
  eligeConElOtro("ya mejor la otra", "combo") === "basico",
  "la otra"
);
// EL CANDADO DEL ORDER BUMP. Sin eleccion hecha, «el otro» no puede decidir
// NADA: es como el cliente pregunta por el producto que aun no se le revelo, y
// de ese no se dice ni precio ni contenido hasta que elija metodo.
comprobar(
  "SIN eleccion previa no decide nada (candado del order bump)",
  eligeConElOtro("mejor el otro", null) === null &&
    eligeConElOtro("dame el otro", null) === null,
  "el full sigue oculto"
);
// LAS TRAMPAS. Cada una es una forma real de escribir que NO es cambiar.
comprobar(
  "«el otro que trae» sigue siendo pregunta",
  eligeConElOtro("el otro que trae", "combo") === null,
  "sin signos de interrogacion"
);
comprobar(
  "«y el otro» tampoco decide",
  eligeConElOtro("y el otro", "combo") === null,
  "sin palabra de decision"
);
comprobar(
  "«el otro dia lo vi mas barato» no habla de productos",
  eligeConElOtro("el otro dia lo vi mas barato", "combo") === null,
  "EL OTRO DIA"
);
comprobar(
  "«que diferencia hay con el otro» es comparacion",
  eligeConElOtro("que diferencia hay con el otro", "combo") === null,
  "no decide"
);
// Y LA REGLA SE QUEDA APAGADA SI NADIE LA ENCIENDE. Quien no pasa el flag —la
// reconciliacion del comprobante, la deteccion de upgrade, el pago parcial—
// sigue EXACTAMENTE igual que antes. Ahi hay dinero contado y «el otro» puede
// referirse al producto extra, que lo resuelve `queProductoNombra`.
comprobar(
  "sin el flag, «mejor el otro» sigue sin decidir",
  inferTwoTierChoiceFromContext("mejor el otro", "combo", SOLAPADOS) === null,
  "el extra puede estar en juego"
);

// -- 9. UN «OK» SECO NO GASTA UNA LLAMADA AL MODELO --------------------------
//
// LO QUE PASO: tras los datos de pago, un «ok» se iba al modelo y volvia a
// soltar el bloque con otras palabras. 590 tokens de salida donde lo normal
// eran 130, y medio minuto de espera.
//
// No se arregla pidiendole al modelo que no repita: se arregla NO DANDOLE EL
// TURNO. Si no hay llamada, no hay nada que repetir.
const guardaOk = (() => {
  const i = motor.indexOf("// UN «OK» SECO, CON LOS DATOS DE PAGO YA ENVIADOS");
  return i < 0 ? "" : motor.slice(i, i + 3200);
})();
comprobar(
  "la guarda del acuse existe y es de payment_done",
  /state === "payment_done" &&/.test(guardaOk),
  "solo con la venta esperando el pago"
);
comprobar(
  "solo si los datos de pago ya salieron",
  /convo\.selected_payment_method\?\.trim\(\)/.test(guardaOk),
  "sin metodo anotado no se le dio ninguna cuenta"
);
// EL FRENO QUE SALVA LA FOTO. La galeria por confirmacion vive en el handler,
// DESPUES del motor: si el «ok» se queda aqui, el cliente que pidio ver una
// foto no recibe nada.
comprobar(
  "si el bot dejo una pregunta abierta, el «ok» sigue su camino",
  /elBotDejoUnaPreguntaAbierta/.test(guardaOk) &&
    /assistantOfferedVisualSample\(convo\.id\)/.test(guardaOk),
  "el «ok» puede ser un si a su pregunta"
);
comprobar(
  "un eco de pago nunca se queda aqui",
  /!looksLikePaymentEcho &&/.test(guardaOk),
  "«ok ya pague» avisa de un pago"
);
comprobar(
  "y con una imagen tampoco",
  /!latestIsImage &&/.test(guardaOk),
  "el comprobante manda siempre"
);
// TIENE QUE SER EL MENSAJE ENTERO: «ok pero tengo una duda» lleva una pregunta
// detras y va al modelo como siempre.
comprobar(
  "el acuse se compara contra el mensaje COMPLETO",
  /function esUnAcuseSeco[\s\S]{0,2500}?return \/\^\([\s\S]*?\)\$\//.test(motor),
  "anclado con ^ y $"
);

// -- 10. UN «SI» CON LOS DATOS YA ENVIADOS REENVIA, SIN LLAMAR AL MODELO -----
//
// LO QUE PASO: el cliente elige Yape, elige el combo, recibe la cuenta. Hace una
// pregunta, el bot se la contesta y remata con «te animas?». Dice «si» — y el
// modelo le pide EL METODO DE PAGO que eligio veinte mensajes antes. Otro «si»,
// otra pregunta. Al tercero por fin reenviaba.
//
// SE INTENTO AVISARLE AL MODELO EN EL PROMPT Y NO GANO: con el aviso puesto
// siguio pidiendo el metodo. Un aviso compite con las reglas de venta del
// cerebro y pierde. El prompt sirve para COMO suena, no para QUE pasa.
// Se ensancho el 02/10/2026: entro el comentario que explica por que la puerta pregunta
// con `soloEstaDeAcuerdo` y no con `isPurchaseAffirmative`. Lo que se comprueba no cambia.
const guardaSi = (() => {
  const i = motor.indexOf("// UN «SÍ» CON LOS DATOS YA ENVIADOS");
  return i < 0 ? "" : motor.slice(i, i + 6400);
})();
comprobar(
  "el «si» lo resuelve el MOTOR, no el prompt",
  /await resendPaymentDetails\(convo, \{ conFrase: true \}\)/.test(guardaSi),
  "cero tokens y siempre igual"
);
comprobar(
  "y el aviso del prompt se quito",
  !/CURRENT STAGE — THE PAYMENT DETAILS WERE ALREADY SENT/.test(modelo),
  "no gano esa pelea"
);
comprobar(
  "solo con los datos ya enviados y sin pagos encima",
  /convo\.selected_payment_method\?\.trim\(\) &&/.test(guardaSi) &&
    /convo\.paid_total_cents === 0 &&/.test(guardaSi),
  "con un abono manda la puerta que sabe restar"
);
// EL LIMITE QUE PROTEGE AL PRODUCTO EXTRA. Ahi un «si» es de SU oferta, y el
// reenvio cobraria otra cosa.
comprobar(
  "NUNCA con el producto extra en juego",
  /!esperaPagoDelUpsell &&/.test(guardaSi),
  "ese «si» es de la oferta del extra"
);
comprobar(
  "un eco de pago y una imagen no entran",
  /!looksLikePaymentEcho &&/.test(guardaSi) && /!latestIsImage &&/.test(guardaSi),
  "el comprobante manda siempre"
);
// SI EL BOT OFRECIO ENSENAR ALGO, EL «SI» ES DE ESO. La galeria por
// confirmacion vive en el handler, DESPUES del motor.
comprobar(
  "si el bot ofrecio ensenar algo, el «si» sigue su camino",
  /elBotOfrecioEnsenarAlgo\(ultimaDelBot, convo\.id\)/.test(guardaSi) &&
    /assistantOfferedVisualSample\(conversationId\)/.test(motor),
  "no le quito la foto que pidio"
);
// Y EL FRENO DEL BUCLE CONTRARIO: tras reenviar, el ultimo mensaje del bot son
// los datos —sin pregunta— asi que un segundo «si» ya no dispara nada.
// EL FRENO DEL BUCLE, Y NO ES EL SIGNO DE INTERROGACION.
//
// Primero se pidio que el bot hubiera terminado con «?». Fallo: el modelo cierra
// muchas veces con un emoji o una afirmacion, y sin signo la guarda se apartaba.
// En una prueba, dos «si» identicos: uno funciono y el otro no — y en el que
// fallo, el modelo se puso a escribir la cuenta a mano, sin el cierre de
// «mandanos tu comprobante».
//
// La senal buena es si su ultimo mensaje YA llevaba la cuenta.
// ACUSAR RECIBO NO ES CONFIRMAR UNA COMPRA.
//
// PASO DE VERDAD: el bot explico que era un pago unico, el cliente contesto «ah
// ok esta bien» — y se le volvio a soltar la cuenta que ya tenia delante. Estaba
// diciendo «entendido», no «lo quiero».
//
// El desempate es si el BOT pregunto algo. Si pregunto, el «si» confirma y se
// reenvia. Si no pregunto, es un acuse y el bot se calla.
comprobar(
  "solo reenvia si el bot habia preguntado algo",
  /\/\[\?¿\]\/\.test\(ultimaDelBot\) &&/.test(guardaSi),
  "acusar recibo no es confirmar"
);
comprobar(
  "y «ah ok esta bien» se calla, no reenvia",
  /ah ok esta bien\|/.test(motor) && /\^\(si\|sip\|ok\|/.test(motor),
  "es un acuse, y el acuse guarda silencio"
);
// EL FRENO DEL BUCLE: si su ultimo mensaje YA llevaba la cuenta, no hay nada que
// reenviar. Y tapa el caso del modelo escribiendola a mano.
comprobar(
  "no reenvia si su ultimo mensaje ya llevaba los datos",
  /!unTextoLlevaLosDatosParaPagar\(ultimaDelBot\) &&/.test(guardaSi),
  "ni encima de lo que el modelo escribio"
);
// ── UN «SI» CON COLA NO ES UN SI ──────────────────────────────────────────
//
// LO QUE PASO — 2 de octubre de 2026, su conversacion 446. El bot pregunto «¿necesitas
// algo mas o te animas con el material?» y el cliente contesto «si pero que contiene». Le
// reenvio los datos de pago en vez de contestarle que contiene.
//
// Y EL PARO EL PARCHE A TIEMPO, que es lo que hace esta comprobacion necesaria: «entonces
// va a corregir esto y si responde otra pregunta que diga "si pero dame el precio", ¿de
// nuevo va a joder la misma respuesta? no puedes estar parchando asi, hay que buscar la
// raiz».
//
// LA RAIZ era que esta puerta preguntaba con `isPurchaseAffirmative`, que busca un «si» EN
// CUALQUIER PARTE del mensaje sin mirar que mas dice.
//
// NO SE AÑADIO NADA: `soloEstaDeAcuerdo` ya existia, ya estaba probada y ya se usaba mas
// abajo. Su propio comentario nombra el caso: «aqui es donde se cae "esta bien pero que
// trae", "listo y cuanto cuesta"». Estaba escrita y no se usaba aqui.
comprobar(
  "un «si» con pregunta detras no reenvia la cuenta",
  /soloEstaDeAcuerdo\(msgContent\) &&/.test(guardaSi) &&
    !/isPurchaseAffirmative\(msgContent\) &&\s*\r?\n?\s*detectPaymentRoute/.test(guardaSi),
  "«si pero que contiene» es una pregunta"
);
// Y LAS OTRAS TRES PUERTAS NO SE TOCAN. Ahi un «si» dentro de un mensaje largo SI es lo
// correcto —son elecciones de opcion, no reenvios de cuenta— y cambiarlas seria arreglar
// algo que no esta roto. Si alguien las cambia de paso, esto se pone rojo.
comprobar(
  "y las otras puertas siguen con la suya",
  (motor.match(/isPurchaseAffirmative\(msgContent\)/g) ?? []).length === 3,
  "elegir opcion no es reenviar la cuenta"
);
comprobar(
  "y es la MISMA funcion que mira el texto del operador",
  /\]\.some\(unTextoLlevaLosDatosParaPagar\);/.test(motor),
  "una sola respuesta a «esto lleva la cuenta?»"
);

// -- 11. LA ULTIMA PUERTA: NO SE PIDE UN METODO YA ELEGIDO -------------------
//
// LO QUE PASABA: el cliente eligio Yape y su producto, recibio la cuenta, y tras
// una duda el bot remataba con «dime: con que metodo prefieres pagar? Yape, Plin
// o BCP». Le pedia lo que decidio veinte mensajes antes, y de ahi salia el
// semi-bucle.
//
// NO SE ARREGLA NI EN EL PROMPT NI ADIVINANDO AL CLIENTE — las dos se probaron y
// fallaron. Esta puerta mira lo que el BOT va a decir, justo antes de decirlo.
const elHandler = leer("src", "lib", "meta", "handler.ts");
// SE CORTA HASTA EL FINAL DE SU `try/catch`, no por un numero de caracteres.
// Iba por «i + 4200» y el 28/09/2026 la puerta crecio —se le añadio el freno de
// «si los datos siguen en pantalla no se repiten», ver
// `prueba-una-duda-no-se-contesta-con-la-cuenta`— asi que el reenvio se quedaba
// fuera de la ventana y esto se ponia rojo sin que nada estuviera mal.
const laUltimaPuerta = (() => {
  const i = elHandler.indexOf(
    "// ── LA ÚLTIMA PUERTA: NO SE PIDE UN MÉTODO QUE YA ESTÁ ELEGIDO"
  );
  const f = elHandler.indexOf(
    "reenvío en vez de repreguntar el método falló",
    i
  );
  return i < 0 || f < 0 ? "" : elHandler.slice(i, f);
})();
comprobar(
  "la puerta existe y reenvia en vez de contestar",
  /await resendPaymentDetails\(alEnviar, \{ conFrase: true \}\)/.test(
    laUltimaPuerta
  ),
  "la misma funcion que el marcador"
);
comprobar(
  "solo en payment_done y con metodo anotado",
  /alEnviar\?\.state === "payment_done" &&/.test(laUltimaPuerta) &&
    /alEnviar\.selected_payment_method\?\.trim\(\)/.test(laUltimaPuerta),
  "antes de eso preguntar es correcto"
);
// SI PIDIO CAMBIAR DE METODO, EL BOT SI DEBE PREGUNTAR. Y esa comprobacion es
// COMPARTIDA con la puerta del marcador: con una copia en cada una, un dia una
// diria que si y la otra que no.
comprobar(
  "si pidio cambiar de metodo, se deja preguntar",
  /!elClientePidioCambiarDeMetodo\(content\) &&/.test(laUltimaPuerta),
  "cambiar de metodo es legitimo"
);
comprobar(
  "y esa comprobacion la comparten las dos puertas",
  (elHandler.match(/elClientePidioCambiarDeMetodo\(content\)/g) ?? []).length >= 2,
  "una sola respuesta a la misma pregunta"
);
comprobar(
  "el comprobante y el producto extra quedan fuera",
  /!latestUserIsImage &&/.test(laUltimaPuerta) &&
    /alEnviar\.upsell_state !== "ofrecido" &&/.test(laUltimaPuerta),
  "el comprobante manda; el extra cobra otra cosa"
);
// LA SENAL NO ES UNA LISTA DE FRASES: sale de la configuracion. Para preguntar
// «cual prefieres» hay que NOMBRAR los metodos, asi que se miran los del pais de
// este cliente. El dia que cambien en el panel, esto cambia con ellos solo.
comprobar(
  "la senal sale de TUS metodos, no de frases escritas a mano",
  /getPaymentMethods\(phone\)\.filter/.test(elHandler) &&
    /return nombrados\.length >= 2;/.test(elHandler),
  "dos o mas metodos nombrados"
);
comprobar(
  "y hace falta que ademas pregunte",
  /if \(!\/\[\?¿\]\/\.test\(reply\)\) return false;/.test(elHandler),
  "sin interrogacion esta informando, no pidiendo"
);
// NUNCA SE QUEDA MUDO: si no hay datos que reenviar, pasa su respuesta.
comprobar(
  "si no hay datos que reenviar, deja pasar la respuesta",
  /iba a pedir el método otra vez, pero no hay datos que reenviar/.test(
    elHandler
  ),
  "nadie se queda sin respuesta por esta puerta"
);

// -- 12. LA ETAPA DEL SEGUNDO PRODUCTO, CON LAS MISMAS REGLAS ---------------
//
// Al aceptar el extra salia un «¡Genial! 😊» del modelo por delante de las
// burbujas del operador: dos presentaciones para una sola cosa, y la de arriba
// no la escribio nadie. La MISMA decision ya estaba tomada en el bloque hermano
// de la venta normal (<<ELIGE_PRODUCTO_1/2>>): si el marcador significa que el
// sistema toma el control, lo toma ENTERO. Faltaba aqui.
comprobar(
  "al aceptar el extra habla el sistema, no el modelo",
  /descarto el texto del modelo \(\$\{leftover\.length\} car\.\) — los datos del extra/.test(
    elHandler
  ) && !/if \(leftover\) await sendBotText\(freshUpsell, leftover\);/.test(elHandler),
  "el «¡Genial!» ya no sale"
);
// Y LA MISMA DECISION SIGUE EN EL BLOQUE HERMANO: si un dia se quita de uno, la
// prueba avisa de que se separaron.
comprobar(
  "y el bloque hermano la conserva",
  /descarto el texto del modelo \(\$\{leftover\.length\} car\.\) — los datos de pago/.test(
    elHandler
  ),
  "las dos etapas deciden igual"
);

// -- 13. SUSTITUIR CON NADA NO ES SUSTITUIR ---------------------------------
//
// LO QUE PASO: el cliente eligio el combo y recibio solo la cuenta y el cierre,
// sin la burbuja que presenta el pago. El basico si la recibio. La diferencia:
// el combo tiene «mensaje propio antes del pago» ENCENDIDO, y con el interruptor
// puesto se quitaba la presentacion general — aunque ese mensaje propio no
// hubiera enviado ni una burbuja.
comprobar(
  "la presentacion se quita solo si su mensaje SALIO",
  /suMensajePropioSalio \|\| suCuadritoYaPresento/.test(motor) &&
    !/mandaElSuyo \|\| suCuadritoYaPresento/.test(motor),
  "no basta con que el interruptor este puesto"
);
comprobar(
  "y se mira lo que devuelve el envio, que ya lo decia",
  /if \(await sendResponseStep\(convo, step, lockedOptPrice, true\)\) \{/.test(motor),
  "ese dato se estaba tirando"
);
comprobar(
  "si no envio nada, queda escrito en el log",
  /su mensaje propio está encendido pero no envió ninguna burbuja/.test(motor),
  "un hueco en silencio no se puede diagnosticar"
);

// -- 14. NOMBRAR UN METODO SIN NEGARLO ES ELEGIRLO ---------------------------
//
// LO QUE TIRO UNA VENTA ENTERA: el cliente escribio «yape» y enseguida «no mejor
// plin». El antirrafaga los junta en un bloque — «yape \n no mejor plin» — y
// «plin» lleva un «no» dos palabras antes. Se daba TODO por negado, el motor se
// apartaba, y el turno se iba al modelo: ni oferta ni datos de pago. Y «yape»
// estaba limpio.
//
// La regla correcta es la contraria: si nombra un metodo SIN negarlo, esta
// eligiendo ese. Solo es negacion cuando TODOS los que nombro van negados.
const negacion = (() => {
  const i = motor.indexOf("// UNO SOLO SIN NEGAR BASTA PARA QUE ESTÉ ELIGIENDO");
  return i < 0 ? "" : motor.slice(i, i + 2400);
})();
comprobar(
  "uno sin negar corta la negacion del mensaje",
  /if \(!negado\) return false;/.test(negacion),
  "«yape / no mejor plin» elige"
);
comprobar(
  "y sigue siendo negacion si TODOS van negados",
  /return algunoNombrado;/.test(negacion),
  "«no tengo yape» se sigue apartando"
);
// NO SE TOCA LO QUE PROTEGIA: la ventana de palabras y la barrera de puntuacion
// se quedan como estaban, cada una por su motivo.
comprobar(
  "la ventana y la barrera de puntuacion siguen intactas",
  /j >= Math\.max\(0, i - VENTANA\)/.test(negacion) &&
    /if \(words\[j\] === CORTE\) break;/.test(negacion),
  "no se toca lo que ya funcionaba"
);

// -- 15. QUIEN DECIDE SI FUE PREGUNTA O DECISION ES EL MODELO ----------------
//
// LO QUE PASO: «mejor las tintas por que no tengo mucha plata». El modelo leyo
// la conversacion entera, entendio que cambiaba al basico, llamo a la
// herramienta — y el motor le contesto que «esta preguntando». Por el «que» de
// «por que», que al quitarle la tilde es identico al «que» interrogativo.
//
// Y no es una frase suelta: «ya que», «asi que», «creo que» hacian lo mismo.
// Perseguirlas una a una no termina nunca.
const pagos = leer("src", "lib", "workflow", "payment.ts");
const elVeto = (() => {
  const i = pagos.indexOf("// ESTE VETO SE ACOTA: AHORA SOLO CON UN SIGNO DE PREGUNTA DE VERDAD");
  return i < 0 ? "" : pagos.slice(i, i + 3600);
})();
comprobar(
  "el veto NO se quita: se acota",
  /isOrderBumpConversationQuestion\(latestText\)/.test(elVeto) &&
    /\/\[\?¿\]\/\.test\(latestText\)/.test(elVeto),
  "las dos formas siguen ahi"
);
// SIN ELEGIR TODAVIA, EL VETO COMPLETO. Ahi vive el candado del Order Bump: una
// pregunta no puede fijar la primera eleccion ni destapar el producto oculto.
comprobar(
  "sin elegir todavia, el veto sigue completo",
  /const yaEligioYNoHaPagado =/.test(elVeto) &&
    /convo\.order_bump_choice === "combo" \|\|/.test(elVeto),
  "el candado del -OB- no se toca"
);
// CON DINERO YA PAGADO, TAMBIEN COMPLETO. Mas abajo esto resuelve contra lo
// abonado y puede entregar o pedir una diferencia.
comprobar(
  "con dinero ya pagado, tambien completo",
  /convo\.paid_total_cents === 0;/.test(elVeto),
  "con dinero de por medio no se afloja"
);
comprobar(
  "y solo se afloja para CAMBIAR de opcion antes de pagar",
  /yaEligioYNoHaPagado\s*\n?\s*\?\s*\/\[\?¿\]\//.test(elVeto),
  "el caso que estaba roto"
);

// -- 16. EN PLENA ELECCION, EL REENVIO NO SE METE ---------------------------
//
// LO QUE PASO: con Plin ya elegido y las dos opciones en pantalla, el cliente
// escribio «el combo esta bien como pago». Dentro hay un «como pago», y el
// detector de «¿como pago?» lo cazo: el reenvio se quedo el turno.
//
// Dos consecuencias, y la segunda es la grave: el reenvio quita la burbuja que
// presenta el pago —a proposito— y ADEMAS su eleccion del combo no se registro,
// asi que salio con el precio BASE. Eligio uno y le llego el precio del otro.
//
// Se acota POR ETAPA, no por palabras: perseguir «como pago» dentro de una
// frase no termina nunca (manana sera «asi pago» o «para el pago»). Lo cerrado
// es el momento.
const enPlenaEleccion = (() => {
  const i = motor.indexOf("// MIENTRAS SE ESPERA QUE ELIJA PRODUCTO, ESTE REENVÍO NO SE METE");
  return i < 0 ? "" : motor.slice(i, i + 3000);
})();
comprobar(
  "el reenvio se aparta en los estados de eleccion",
  /!esperandoQueElijaProducto &&/.test(motor) &&
    /state === "awaiting_order_bump_choice" \|\|/.test(enPlenaEleccion),
  "esa etapa ya tiene quien la atienda"
);
// LAS DOS MODALIDADES, NO UNA. -OB- y -DOU- tienen sus propios estados de
// eleccion y los dos entran; lineal no tiene ninguno y no cambia.
comprobar(
  "y cubre -OB- y -DOU-, no solo una",
  /state === "awaiting_doble_oferta_dos_choice" \|\|/.test(enPlenaEleccion) &&
    /state === "awaiting_bioferta_intro_choice" \|\|/.test(enPlenaEleccion),
  "ninguna modalidad queda coja"
);
comprobar(
  "fuera de la eleccion, el reenvio sigue igual",
  /!isPostSaleState &&\s*\n\s*!esperandoQueElijaProducto &&/.test(motor),
  "intro_done y payment_done sin tocar"
);

// -- 17. CAMBIAR DE METODO EN PLENA ELECCION TAMBIEN CUENTA -----------------
//
// EL HUECO QUE DEJO LA SECCION 16. Apartado el reenvio de las pantallas de
// eleccion, el metodo que el cliente nombraba AHI no lo anotaba nadie: su rama
// le recordaba las dos opciones y tiraba el dato. Al elegir producto despues,
// los datos salian por el metodo VIEJO.
//
// El recorrido del dueno lo dice: el cliente CAMBIA DE OPINION, y de metodo, en
// cualquier momento. En el resto de la tuberia nombrar un metodo lo deja
// anotado; esta era la unica pantalla donde no.
const anotarMetodo = (() => {
  const i = motor.indexOf("function anotarMetodoElegidoDuranteLaEleccion");
  return i < 0 ? "" : motor.slice(i, i + 1400);
})();
comprobar(
  "el metodo nombrado durante la eleccion se anota",
  /setSelectedPaymentMethod\(convo\.id, metodo\);/.test(anotarMetodo),
  "antes se perdia y salian los datos del viejo"
);
// SOLO ANOTA: no manda nada ni se queda el turno. Sin producto elegido no hay
// precio que mandar, que es justo lo que arreglo la seccion 16.
comprobar(
  "solo anota: no manda nada ni corta el turno",
  /\): void \{/.test(anotarMetodo) &&
    !/sendBotText|resendPaymentDetails|schedulePaymentResponses|return true/.test(
      anotarMetodo
    ),
  "la eleccion sigue su camino igual que hoy"
);
// LAS MISMAS GUARDAS QUE USA EL PAGO. Si un dia cambian, cambian en los dos
// sitios a la vez.
comprobar(
  "desconfianza y negacion se apartan igual que en el pago",
  /messageHasPaymentConcern\(msgContent\)\) return;/.test(anotarMetodo) &&
    /methodMentionIsNegated\(msgContent, convo\.phone\)\) return;/.test(anotarMetodo),
  "«me robaron con el yape» y «no tengo yape» no eligen"
);
comprobar(
  "repetir el que ya tenia no escribe nada",
  /convo\.selected_payment_method === metodo\) return;/.test(anotarMetodo),
  "un cambio que no cambia nada no se registra"
);
// EL MISMO MENSAJE CON PRODUCTO Y METODO. «el combo por BCP» tiene que salir ya
// con BCP: por eso se actualiza tambien la copia de este turno, que es la que
// leen las ramas de abajo.
comprobar(
  "producto y metodo en el mismo mensaje salen con el nuevo",
  /convo\.selected_payment_method = metodo;/.test(anotarMetodo),
  "la copia del turno la leen las ramas de abajo"
);
// LAS TRES PANTALLAS DE ANTES DE PAGAR, JUNTAS: -OB-, -DOU- y bioferta. Lineal
// no tiene estados de eleccion. Las de DESPUES de pagar quedan fuera: ahi hay
// dinero abonado y quien resta saldos es otra puerta.
const dondeSeAnota = (() => {
  const i = motor.indexOf("// SI NOMBRA UN MÉTODO MIENTRAS ELIGE PRODUCTO, SE ANOTA");
  // Hasta la rama de al lado, ni un caracter mas: si el corte se pasara de
  // largo, los estados de DESPUES de pagar entrarian en el texto revisado y la
  // comprobacion de abajo daria por buena una lista que no lo es.
  const fin = motor.indexOf("// CASO ORDER BUMP:", i);
  return i < 0 || fin < 0 ? "" : motor.slice(i, fin);
})();
comprobar(
  "entran las tres pantallas de antes de pagar",
  /state === "awaiting_order_bump_choice" \|\|/.test(dondeSeAnota) &&
    /state === "awaiting_doble_oferta_dos_choice" \|\|/.test(dondeSeAnota) &&
    /state === "awaiting_bioferta_intro_choice"/.test(dondeSeAnota),
  "ninguna modalidad queda coja"
);
comprobar(
  "y las de despues de pagar NO entran",
  !/awaiting_order_bump_payment_choice|awaiting_post_payment_order_bump_choice|awaiting_bioferta_choice/.test(
    dondeSeAnota
  ),
  "con dinero abonado manda la puerta que sabe restar"
);
// SE ANOTA ANTES DE LEER LA ELECCION, no despues: si no, «el combo por BCP»
// entregaria el combo con el metodo viejo y el dato llegaria tarde.
comprobar(
  "se anota antes de que las ramas lean la eleccion",
  motor.indexOf("anotarMetodoElegidoDuranteLaEleccion(convo, msgContent);") <
    motor.indexOf('if (state === "awaiting_order_bump_choice") {'),
  "el dato tiene que estar puesto antes de entregar"
);

// -- 18. CON EL EXTRA EN LA MESA, LA POSTVENTA NO ES POSTVENTA --------------
//
// LO QUE PASO, EN LINEAL: compra hecha y entregada, se presenta el segundo
// producto, el cliente pregunta si ese es otro — y el bot le contesta
// preguntandole si recibio bien SU producto, dejando la segunda venta tirada.
//
// No desobedecio: el bloque del segundo producto le llega entero y le dice que
// hay una venta ABIERTA. Lo que pasa es que la seccion «postventa» del cerebro
// le llega tambien, son ~1.580 tokens, y dice lo contrario — «tu papel de venta
// TERMINO», redirige a las carpetas ya recibidas y despidete. Gana la mas larga.
const cerebro = leer("src", "lib", "openrouter.ts");
const filtro = (() => {
  const i = cerebro.indexOf("function promptSectionExclusionsForTurn");
  const fin = cerebro.indexOf("function isAffirmativeShortAnswer", i);
  return i < 0 || fin < 0 ? "" : cerebro.slice(i, fin);
})();
comprobar(
  "con el extra ofrecido, la seccion postventa no se inyecta",
  /if \(ofertaDelExtraAbierta\) exclude\.add\("postventa"\);/.test(filtro),
  "era la voz que contradecia la venta abierta"
);
// DENTRO DE LA RAMA DE POSTVENTA, no suelta. Fuera de ella «postventa» ya se
// excluye siempre, asi que aqui no pinta nada y colgaria de otro estado.
comprobar(
  "y vive DENTRO de la rama de postventa",
  /if \(isPostSale\) \{[\s\S]*if \(ofertaDelExtraAbierta\) exclude\.add\("postventa"\);[\s\S]*?return \[\.\.\.exclude\];\s*\}/.test(
    filtro
  ),
  "fuera de postventa esa seccion ya se quita siempre"
);
// EL CANDADO POR MODALIDAD SE QUITO, Y AQUI SE DEJA CONSTANCIA.
//
// Esto exigia que la exclusion valiera SOLO en lineal. Se acoto asi porque el
// fallo se vio en lineal y de la etapa upsell de las demas no habia ninguna
// evidencia; el propio comentario decia «ESTE CANDADO ES PARA QUITARLO» en
// cuanto apareciera el mismo fallo en otra modalidad.
//
// APARECIO — 15 de septiembre de 2026, tres pantallas en paralelo en Doble
// Oferta + Upsell, las tres con la oferta del extra en pantalla. Dos
// contestaron vendiendo. La tercera se fue a la postventa: pidio otra vez la
// foto de un comprobante YA aprobado y entregado, y siguio pidiendola cuando el
// cliente le dijo dos veces que la habia mandado.
//
//     convo 100  «este es otro»   salida=211 tk    5,4 s
//     convo  98  «este es otro»   salida=904 tk   22,4 s   <- se fue por las ramas
//
// Mismo mensaje, mismo prompt, resultado distinto: una moneda cargada. Y el
// prompt del 98 confirma que la seccion entraba (7.157 tk vendiendo -> 10.563 en
// la etapa upsell).
//
// Lo que se comprueba ahora es que la condicion de modalidad NO vuelva: escribia
// una diferencia entre modalidades que no existe, y la etapa upsell no pregunta
// por la modalidad en ninguna de sus tres piezas.
const candado = (() => {
  const i = cerebro.indexOf("const ofertaDelExtraAbierta");
  const fin = cerebro.indexOf("const promptSectionExclusions =", i);
  return i < 0 || fin < 0 ? "" : cerebro.slice(i, fin);
})();
comprobar(
  "solo con la oferta ABIERTA, no despues de que acepta",
  /convo\?\.upsell_state === "ofrecido"/.test(candado) && !/aceptado/.test(candado),
  "ya aceptado hacen falta los reintentos de comprobante de esa seccion"
);
comprobar(
  "y vale para LAS SEIS: no queda condicion de modalidad",
  !/getActiveModalityKey/.test(candado) && !/=== "lineal"/.test(candado),
  "el fallo no era de lineal"
);
comprobar(
  "queda escrito por que se quito",
  /Y ESTA ES LA EVIDENCIA QUE FALTABA/.test(cerebro),
  "con los numeros de sus tres pantallas"
);

// -- 19. LA RECOMENDACION VIVE EN EL TURNO, NO EN EL BLOQUE DE SIEMPRE ------
//
// EL INTENTO QUE ROMPIO EL CIERRE: la recomendacion se escribio dentro del
// bloque ORDER BUMP ACTIVE, que le llega al modelo en TODOS los turnos y es el
// mismo que le ordena registrar la eleccion y cerrar. Gano explicar: el cliente
// dijo «si ese quiero» y el bot volvio a preguntar. En el prompt no hay ramas.
//
// AHORA VIVE EN UN BLOQUE DE TURNO. En el turno en que el cliente decide no
// esta — no compite menos: no esta.
const bloqueDelTurno = (() => {
  const i = cerebro.indexOf("// LA RECOMENDACIÓN, EN EL TURNO EN QUE PREGUNTA CUÁNTOS SON.");
  const fin = cerebro.indexOf("// MODO LINEAL:", i);
  return i < 0 || fin < 0 ? "" : cerebro.slice(i, fin);
})();
comprobar(
  "la recomendacion se pide en un bloque CURRENT TURN",
  /CURRENT TURN — THEY ARE ASKING HOW MANY OPTIONS THERE ARE/.test(bloqueDelTurno),
  "solo existe en el turno en que preguntan cuantos son"
);
comprobar(
  "y NO volvio al bloque que se manda siempre",
  !/ONE EXCEPTION, and only this one/.test(cerebro),
  "ese fue el que rompio el cierre"
);
comprobar(
  "nunca con una opcion ya elegida",
  /convo\?\.order_bump_choice !== "combo" &&/.test(bloqueDelTurno) &&
    /convo\?\.order_bump_choice !== "basico"/.test(bloqueDelTurno),
  "recomendar con la eleccion hecha es revender lo vendido"
);
comprobar(
  "y ese turno NO puede registrar una eleccion",
  /do not register any option from this message/.test(bloqueDelTurno),
  "preguntar cuantos hay no es elegir"
);
// EL DETECTOR SOLO DECIDE SI SE MUESTRA, no que hace el bot: si falla, el turno
// sale igual que hoy. Se comprueba contra el texto ya normalizado (sin tildes ni
// signos), que es como escribe la gente.
const detector = (() => {
  // Desde su comentario, no desde la firma: ahi es donde esta escrito para que
  // sirve, y es lo que esta comprobacion vigila.
  const i = cerebro.indexOf(" * ¿ESTÁ PREGUNTANDO CUÁNTAS OPCIONES HAY?");
  const fin = cerebro.indexOf("function looksLikeReactionToShownContent", i);
  return i < 0 || fin < 0 ? "" : cerebro.slice(i, fin);
})();
const comoLlegaElTexto = (t) =>
  t.toLowerCase().normalize("NFD").replace(/\p{Mn}/gu, "").replace(/[^a-z0-9]+/g, " ").trim();
const reglas = [
  /\b(son|hay|serian|seran|eran|habia)\s+(2|dos)\b/,
  /\bcuantos?\s+(son|hay|productos|opciones|cosas)\b/,
  /\b(2|dos)\s+(productos?|opciones?|cosas?|articulos?|items?)\b/,
];
const loCaza = (t) => reglas.some((r) => r.test(comoLlegaElTexto(t)));
comprobar(
  "«¿son 2?» sin signos ni tildes se reconoce",
  loCaza("¿son 2?") && loCaza("son dos") && loCaza("entonces son 2"),
  "la gente no escribe signos"
);
comprobar(
  "y «cuantos son» / «hay 2 productos» tambien",
  loCaza("cuantos son") && loCaza("hay 2 productos") && loCaza("son dos opciones"),
  "las formas normales de preguntarlo"
);
comprobar(
  "elegir NO se confunde con preguntar cuantos hay",
  !loCaza("quiero el combo") && !loCaza("si ese quiero") && !loCaza("me llevo el basico"),
  "el turno de decidir no puede caer aqui"
);
comprobar(
  "el detector no decide nada del bot, solo si se muestra",
  /SOLO DECIDE SI SE MUESTRA UNA SUGERENCIA AL MODELO/.test(detector),
  "fallar aqui es barato"
);
// -- 20. EL MENSAJE DE EMERGENCIA -------------------------------------------
comprobar(
  "la respuesta de emergencia dice que no entendio, no que no pudo",
  // La INTENCION no cambia: el bot pide que se lo repitan, nunca confiesa una
  // averia. El 22/09/2026 el dueño eligio el texto nuevo —el mismo del otro
  // bot— asi que se comprueba lo que la regla protege, no las palabras viejas.
  /no entendí bien tu pregunta/.test(cerebro) &&
    !/no pude completar mi respuesta\. ¿Puedes/.test(cerebro),
  "lo pidio el dueño; es la unica cadena y solo sale con respuesta vacia"
);

console.log(
  fallos === 0
    ? "\nTODO OK — lo decidido se respeta y no se vuelve a preguntar"
    : `\n${fallos} FALLO(S)`
);
process.exit(fallos === 0 ? 0 : 1);
