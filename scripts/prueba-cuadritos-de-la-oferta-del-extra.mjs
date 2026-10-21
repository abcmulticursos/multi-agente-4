// Los cuadritos de decision de la oferta del segundo producto no se leian.
//
// Funcionaban SOLO en las burbujas de la intro. En la oferta del extra el
// editor los dejaba escribir igual â€”titulo, palabras, burbujas, linkâ€” y el
// motor no los miraba nunca: el Â«siÂ» siempre se iba por el camino de siempre.
// Lo escrito ahi no le llegaba a ningun cliente. Una casilla que acepta trabajo
// y lo tira es peor que una casilla que no esta.
//
// LO QUE VIGILA ESTA PRUEBA
//
//   1. CANDADO DE MODALIDAD. Las burbujas salen de `seccionUpsell`, que da la
//      seccion de la modalidad ACTIVA y null en las que no tienen segundo
//      producto. Si alguien lo cambiara por `config.upsell` a pelo, la modalidad
//      Doble Oferta + Upsell leeria los cuadritos de la modalidad Upsell â€” dos
//      modalidades con distinta cantidad de productos compartiendo respuestas.
//
//   2. EL CUADRITO NO DECIDE LA VENTA. Quien acepta y quien rechaza lo siguen
//      diciendo los detectores de siempre. Las palabras de un cuadrito se
//      comparan sueltas, y Â«noÂ» aparece dentro de Â«no entiendoÂ» o Â«no se cuanto
//      esÂ»: si el cuadrito decidiera, esas preguntas cerrarian la venta.
//
//   3. SUS BURBUJAS COBRAN EL PRECIO DEL EXTRA. Por defecto se usa el precio del
//      producto ya comprado. En una oferta posterior eso es un numero
//      equivocado que ademas parece bueno.
//
//   4. NO SE MANDA DOS VECES. Si el cuadrito ya contesto, la respuesta de
//      siempre se calla â€” pero lo que no se ve (que acepto, con que metodo) se
//      anota igual: de ese apunte dependen el precio del comprobante y la
//      entrega.
//
//   node scripts/prueba-cuadritos-de-la-oferta-del-extra.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");
const YAML = createRequire(join(RAIZ, "package.json"))("yaml");
const motor = leer("src", "lib", "workflow", "engine.ts");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};
const trozo = (desde, largo) => {
  const i = motor.indexOf(desde);
  return i < 0 ? "" : motor.slice(i, i + largo);
};

// â”€â”€ 1. El candado de modalidad â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const busca = trozo("function decisionDeLaOfertaDelExtra(", 2600);
comprobar("existe la busqueda del cuadrito del extra", busca.length > 0, "la funcion");
comprobar(
  "lee las burbujas de la modalidad ACTIVA, no de una fija",
  /const up = seccionUpsell\(config\);/.test(busca) && !/config\.upsell/.test(busca),
  "seccionUpsell"
);
comprobar(
  "sin segundo producto no hay cuadritos que leer",
  /if \(!up\) return null;/.test(busca),
  "null fuera de las dos modalidades"
);
comprobar(
  // La pregunta es lo ultimo que el cliente vio: su cuadrito manda.
  "mira la pregunta antes que la invitacion",
  busca.indexOf("up.pregunta_steps") < busca.indexOf("up.intro"),
  "pregunta primero"
);

// â”€â”€ 2. El cuadrito aporta burbujas, NO decide la venta â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// La ventana se agranda cuando la rama crece: los comentarios de esta zona se
// han ido sumando y con 6.600 caracteres el trozo ya no llegaba al final, asi
// que la ultima comprobacion fallaba sola sin que nada se hubiera roto.
const rama = trozo('if (convo.upsell_state === "ofrecido") {', 9000);
comprobar(
  "los detectores de siempre siguen decidiendo",
  /botonDelUpsell\(msgContent, config\)/.test(rama) &&
    /detectaAceptacionDeUpsell\(msgContent, config\)/.test(rama) &&
    /detectaSiSimpleAlUpsell\(msgContent\)/.test(rama) &&
    /detectaRechazoDeUpsell\(msgContent\)/.test(rama),
  "los cuatro intactos"
);
comprobar(
  // Si el cuadrito decidiera por su cuenta, esto estaria ANTES del boton.
  "el cuadrito no se adelanta a los detectores",
  rama.indexOf("const cuadrito = decisionDeLaOfertaDelExtra(") <
    rama.indexOf("const tocoUnBoton = botonDelUpsell(") &&
    /if \(tocoUnBoton === "si"\) \{[\s\S]{0,140}aceptarConSuCuadrito\(\)/.test(rama),
  "solo aporta las burbujas"
);
comprobar(
  // La red final: solo puede AÃ‘ADIR respuesta donde hoy no hay ninguna.
  "un cuadrito con palabras propias tambien contesta",
  /if \(cuadrito\) \{[\s\S]{0,1400}?responderConElCuadritoDelExtra\(\s*\r?\n?\s*convo,\s*\r?\n?\s*cuadrito,\s*\r?\n?\s*config\s*\r?\n?\s*\);/.test(
    rama
  ),
  "sin tocar el estado"
);
// PERO SOLO SI DE VERDAD CONTESTA ALGO.
//
// Quedarse el turno sin decir nada dejaba al cliente sin respuesta: el bot daba
// el mensaje por atendido y no contestaba nadie. Y no es raro — el cuadrito
// «NO» suele estar sin burbujas y sin accion, porque el rechazo lo contesta el
// flujo del regalo y no existe una accion de rechazar.
comprobar(
  "y si esta vacio y sin accion, deja pasar el mensaje",
  /if \(salioAlgo \|\| tieneBurbujas \|\| cuadrito\.action\) \{/.test(rama),
  "nadie se queda sin respuesta"
);

// ── 2 bis. SUS BURBUJAS SON LA RESPUESTA, NO UN PROLOGO ─────────────────────
//
// Con la accion enlazada salian las DOS: el texto propio del operador y, detras,
// los datos de pago de fabrica. No es una repeticion literal —una es suya y otra
// la de siempre— pero el cliente lee dos veces lo mismo con distintas palabras.
// Suena a maquina, que es justo lo que se corrige escribiendolo a mano.
//
// El motor ya sabia hacerlo: `enviarDatos: false` deja hecho todo lo invisible
// —anota que acepto, fija el precio del extra y el metodo— y se salta solo las
// burbujas. Se usaba cuando el cuadrito NO tenia accion; faltaba usarlo tambien
// cuando si la tiene.
comprobar(
  "con burbujas propias no se mandan ademas las de fabrica",
  /if \(cuadrito\.action === "choose_upsell" && suyas\) \{[\s\S]{0,800}?entregarDatosDePagoDelUpsell\(convo, \{ enviarDatos: false \}\);/.test(
    motor
  ),
  "una sola respuesta"
);
// Un cuadrito VACIO con accion si recibe los datos de fabrica: ahi no hay texto
// propio que respetar, y callarse dejaria al cliente sin saber como pagar.
//
// Y APAGADO ES VACIO. Contando las apagadas, un cuadrito con sus burbujas en OFF
// hacia creer al bot que el ya habia mandado los datos del extra -- y entonces
// no mandaba NADA: ni las suyas, que estan apagadas, ni las de fabrica.
comprobar(
  "un cuadrito vacio con accion si recibe los datos",
  /const suyas = tieneBurbujasEncendidas\(cuadrito\.steps\);/.test(motor),
  "depende de si escribio algo"
);
// Y no se da por aceptado un extra que no se puede entregar: la misma
// comprobacion que hace la accion normal, porque este camino se la salta.
comprobar(
  "no acepta un extra incompleto por este atajo",
  /if \(cuadrito\.action === "choose_upsell" && suyas\) \{\s*\r?\n\s*if \(!isUpsellUsable\(loadWorkflowConfig\(\)\)\)/.test(
    motor
  ),
  "misma guarda que la accion"
);

// â”€â”€ 3. Sus burbujas cobran el precio del extra â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// La ventana cubre la funcion entera: le entro una rama nueva —la del cuadrito
// que trae sus propias burbujas— y con el recorte viejo se quedaba fuera.
const responde = trozo("async function responderConElCuadritoDelExtra(", 3200);
comprobar(
  "las burbujas del cuadrito salen con el precio del extra",
  /getUpsellPriceSoles\(/.test(responde) &&
    /sendConfiguredSteps\(convo, cuadrito\.steps, precioDelExtra\)/.test(responde),
  "precioDelExtra"
);
comprobar(
  // El tercer parametro es opcional: sin el, todo lo demas se comporta igual.
  "y el resto de burbujas del bot no cambian",
  /precioDeEstasBurbujas\?: number/.test(motor) &&
    /await sendResponseStep\(convo, step, precioDeEstasBurbujas, true\);/.test(motor),
  "parametro opcional"
);

// â”€â”€ 4. Ni dos veces, ni sin anotar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
comprobar(
  "con el cuadrito contestado no se manda la respuesta de siempre",
  /if \(!yaMandoLosDatos\) \{\s*\r?\n\s*await entregarDatosDePagoDelUpsell\(convo, \{ enviarDatos: false \}\);/.test(
    rama
  ),
  "enviarDatos: false"
);
comprobar(
  "con accion linkeada, ella manda los datos y no se repite",
  /const laAccionMandoLosDatos = cuadrito\.action === "choose_upsell";/.test(
    responde
  ),
  "choose_upsell"
);
const entrega = trozo("export async function entregarDatosDePagoDelUpsell(", 1400);
const anota = entrega.indexOf('setUpsellState(convo.id, "aceptado")');
const metodo = entrega.indexOf("setSelectedPaymentMethod(convo.id, route)");
const salida = entrega.indexOf("if (opciones?.enviarDatos === false)");
comprobar(
  // Callar las burbujas no puede callar el apunte: de el dependen el precio
  // contra el que se valida el comprobante y el producto que se entrega.
  "aunque se callen las burbujas, queda anotado que acepto",
  anota > 0 && metodo > anota && salida > metodo,
  "estado y metodo antes de la salida"
);
comprobar(
  "el rechazo tambien se anota aunque conteste el cuadrito",
  /setUpsellState\(convo\.id, "rechazado"\);[\s\S]{0,400}opciones\?\.enviarTexto !== false/.test(
    motor
  ),
  "solo se calla el texto"
);

// â”€â”€ 5. Los cuadritos que se escriban ahi se leen â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// Esto MIRA EL MOTOR, no la configuracion. Antes contaba los cuadritos que
// habia escritos en el archivo, y se ponia roja el dia que el operador los
// vaciaba o cambiaba de modalidad â€” una prueba que falla por editar contenido
// no vigila nada, solo estorba.
const cfg = YAML.parse(leer("config", "intro-data.yaml"));
comprobar(
  "la seccion del extra tiene donde escribir cuadritos",
  !!cfg.doble_oferta_upsell?.upsell || !!cfg.upsell,
  "existe la seccion"
);
comprobar(
  // Y EN TODOS LOS CAJONES, no solo en el que le tocó a ese cliente: esto no
  // envía nada, busca a qué cuadrito corresponde lo que acaba de escribir. Un
  // botón de otro cajón se reconoce igual, que es lo que hace falta.
  "y el motor los busca en sus dos sitios",
  /up\.pregunta_steps[\s\S]{0,700}up\.intro_groups[\s\S]{0,120}up\.intro/.test(
    trozo("function decisionDeLaOfertaDelExtra(", 3400)
  ),
  "pregunta e invitacion"
);

console.log(
  fallos === 0
    ? "\nTODO OK â€” los cuadritos de la oferta del extra se leen, y cada modalidad los suyos"
    : `\n${fallos} FALLA(S)`
);
process.exit(fallos === 0 ? 0 : 1);

