// «creo que el combo» es una decision, no una pregunta.
//
// LO QUE PASO
//
//   13 de septiembre de 2026, dos pruebas de -OB- corridas en paralelo:
//
//     convo 45  «el combo esta bien»   -> [wf] convo 45 eligio order bump "combo"
//                                        -> pago con el precio del COMBO   (bien)
//     convo 44  «creo que el combo»    -> sin registro, cae al modelo
//                                        -> «¡Perfecta eleccion! El COMBO esta
//                                           a S/. 14» y detras los datos de pago
//                                           con S/. 10, el precio del BASICO
//
//   Dos precios en la misma rafaga, los dos reales. La unica diferencia entre
//   las dos pruebas era la palabra «que».
//
// LA CAUSA
//
//   `isOrderBumpConversationQuestion` tomaba `que` como palabra interrogativa. Y
//   el mensaje se normaliza QUITANDO LAS TILDES, asi que «que» (relleno) y «que»
//   (pregunta) llegaban al regex como la misma palabra.
//
//   Eso cerraba las DOS puertas que podian registrar la eleccion:
//     · el detector del motor   (detectTwoTierPick -> null)
//     · la herramienta del LLM  (seleccionar_opcion -> «no registres nada»)
//
//   Y la misma asimetria vivia en «por que»:
//     «mejor el basico por que no tengo plata»  -> vetado
//     «mejor el basico porque no tengo plata»   -> pasaba
//   La venta dependia de la barra espaciadora.
//
// EL ARREGLO
//
//   El «que» se decide POR POSICION, no por tilde, signo ni espacio: el de
//   preguntar ABRE la frase, el de relleno va detras de contenido. Acotado a
//   -OB- por orden del dueño; -DOU- conserva el comportamiento anterior hasta
//   que se pruebe alli.
//
// ESTA PRUEBA EJECUTA LOS DETECTORES DE VERDAD, sacados de config.ts.
//
//   node scripts/prueba-el-que-de-relleno-no-es-una-pregunta.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const config = readFileSync(
  join(RAIZ, "src", "lib", "workflow", "config.ts"),
  "utf8"
);

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 52)} ${valor}`);
};

// ── Los detectores reales, sacados del archivo ───────────────────────────────
const trozo = (desde, hasta) => {
  const i = config.indexOf(desde);
  if (i < 0) return "";
  const f = config.indexOf(hasta, i);
  return f < 0 ? "" : config.slice(i, f);
};
const funcion = (firma) => {
  const cuerpo = trozo(firma, "\n}");
  if (!cuerpo) throw new Error(`no encuentro en config.ts:\n  ${firma}`);
  return (
    cuerpo
      .replace(
        /(?:export )?function (\w+)\((\w+): string\): boolean \{/,
        "function $1($2) {"
      )
      // Y LA FORMA SIN ARGUMENTOS, para poder traerse la puerta de modalidad tal
      // cual esta escrita en vez de copiarla aqui. Copiada, esta prueba diria que
      // si aunque el motor hiciera otra cosa — que es justo lo que no puede pasar.
      .replace(/(?:export )?function (\w+)\(\): boolean \{/, "function $1() {") +
    "\n}"
  );
};

const antesala =
  trozo("const ANTESALA_QUE_NO_QUITA_LA_PREGUNTA = new Set([", "]);") + "]);";

// `prestada` = con que PRESENTACION PRESTADA vende (el selector «PRESENTA:»).
// «segunda_oculta» es «como -OB-» y «dos_juntas» es «como -DOU-». La modalidad
// sigue llamandose lineal en las dos, y el cliente tiene delante las mismas dos
// opciones. Se modela con las funciones que usa el motor —`isOrderBumpActive` y
// `vendeConPresentacionPrestada`— porque la puerta se trae DEL ARCHIVO y pregunta
// por ahi.
const armar = (modalidad, prestada = null) =>
  new Function(
    [
      "const loadWorkflowConfig = () => ({});",
      `const getActiveModalityKey = () => ${JSON.stringify(modalidad)};`,
      `const isOrderBumpActive = () => getActiveModalityKey() === 'order_bump' || ${JSON.stringify(
        prestada === "segunda_oculta"
      )};`,
      `const vendeConPresentacionPrestada = (cfg, forma) => forma === ${JSON.stringify(
        prestada
      )};`,
      "const laModalidadActivaEsOrderBump = () => isOrderBumpActive();",
      // La puerta de modalidad se trae DEL ARCHIVO, no se copia: asi esta prueba
      // no puede decir que si mientras el motor hace otra cosa.
      funcion("export function laLecturaFinaDeLaEleccionEstaActiva(): boolean {"),
      antesala,
      // El subjuntivo de encargo vive en un solo sitio y lo comparten la regla
      // del «que» y la del número. Se trae de ahí, no se copia.
      trozo("const SUBJUNTIVO_DE_ENCARGO = new Set([", "]);") + "]);",
      funcion("function elQueEsElDePreguntar(normalized: string): boolean {"),
      funcion(
        "export function isProductInformationQuestion(msg: string): boolean {"
      ),
      funcion("export function isPriceQuestion(msg: string): boolean {"),
      funcion(
        "export function isOrderBumpConversationQuestion(msg: string): boolean {"
      ),
      "return { isOrderBumpConversationQuestion };",
    ].join("\n\n")
  )();

const enOB = armar("order_bump");
// OJO CON LOS NOMBRES, QUE SE PARECEN Y NO SON LO MISMO:
//   · `enDOS`  = Doble Oferta 2 Productos  (doble_oferta_dos)   -> sin el arreglo
//   · `enDOU`  = Doble Oferta + Upsell     (doble_oferta_upsell) -> con el arreglo
// La primera hace de testigo: sigue comportandose como antes del 13 de
// septiembre, y por eso se ve aqui si la puerta de modalidad se cae.
const enDOS = armar("doble_oferta_dos");
const enDOU = armar("doble_oferta_upsell");
// LAS DOS PRESENTACIONES PRESTADAS, que es lo que el dueno vende de verdad: la
// modalidad se llama lineal y el cliente tiene delante las dos opciones. Mueve
// ese selector cuando quiere, asi que las dos tienen que leer igual.
const comoOB = armar("lineal", "segunda_oculta");
const comoDOU = armar("lineal", "dos_juntas");

// ── 1. Lo que ROMPIO la venta: el «que» de relleno ───────────────────────────
console.log("— en -OB-, esto YA NO es una pregunta —\n");
const DECISIONES = [
  "creo que el combo",
  "creo que el basico",
  "me parece que el combo",
  "pienso que el combo",
  "supongo que el basico",
  "asi que el combo",
  "digamos que el combo",
  "ya que el combo esta mejor",
  "mejor el basico por que no tengo plata",
  "mejor el basico porque no tengo plata",
  "el combo esta bien",
  "el combo",
];
for (const frase of DECISIONES) {
  comprobar(
    `«${frase}»`,
    enOB.isOrderBumpConversationQuestion(frase) === false,
    "decision"
  );
}

// ── 2. Las preguntas de verdad SIGUEN siendo preguntas ───────────────────────
console.log("\n— y esto SIGUE siendo una pregunta —\n");
const PREGUNTAS = [
  "que trae el combo",
  "que incluye el basico",
  "que contiene",
  "y que trae",
  "ok entonces que incluye",
  "hola que contiene el combo",
  "dime que trae el combo",
  "una pregunta que trae el combo",
  "por que tan caro",
  "cual me recomiendas",
  "cuanto cuesta el combo",
  "que diferencia hay entre los dos",
  // «ya» se dejo FUERA de la antesala porque «ya que» es causal casi siempre;
  // preguntar con el sigue funcionando, pero por el verbo, no por el «que».
  "ya que trae el combo",
  "el combo?",
  "no entiendo el combo",
  "me explicas el combo",
];
for (const frase of PREGUNTAS) {
  comprobar(
    `«${frase}»`,
    enOB.isOrderBumpConversationQuestion(frase) === true,
    "pregunta"
  );
}

// ── 2.b El corpus ancho: como escribe la gente de verdad ─────────────────────
//    Sin tildes, sin signos, sin comas, con abreviaturas y con el «que» metido
//    en todas las posiciones. El dueño atiende ~1000 personas al dia: lo que
//    importa no son cinco frases, es la variedad.
console.log("\n— decisiones, en la variedad de todos los dias —\n");
const DECISIONES_ANCHO = [
  "ok que sea el combo",
  "entonces que sea el combo",
  "bueno que sea el basico",
  "pues que sea el combo",
  "y que sea el combo",
  "ah ok que quede en el combo",
  "dale que sea el combo",
  "mejor que sea el basico",
  "creo q el combo",
  "creo que mejor el basico",
  "pienso que el basico esta bien",
  "me parece que voy por el combo",
  "diria que el combo",
  "digo que el combo",
  "veo que el combo es mejor",
  "yo creo que el combo esta mejor",
  "mira que el combo me conviene",
  "siento que el combo es mejor",
  "mejor las tintas por que no tengo mucha plata",
  "me llevo el combo por que esta mas completo",
  "el basico por que ando corta de plata",
  "asi que dame el combo",
  "listo que sea el combo",
];
for (const frase of DECISIONES_ANCHO) {
  comprobar(
    `«${frase}»`,
    enOB.isOrderBumpConversationQuestion(frase) === false,
    "decision"
  );
}

console.log("\n— preguntas, en la variedad de todos los dias —\n");
const PREGUNTAS_ANCHO = [
  "que tal el combo",
  "que opciones hay",
  "que hay en el combo",
  "y el combo que trae",
  "el combo que incluye",
  "oye que diferencia hay",
  "disculpa que precio tiene el combo",
  "hola buenas que contiene el basico",
  "a cuanto el combo",
  "como es el combo",
  "cual es mejor",
  "que me recomiendas",
  "me explicas que trae el combo",
  "no entiendo que trae el combo",
  "una consulta que incluye el combo",
  "de que trata el combo",
  "señor que trae el combo",
  "buenas tardes que incluye",
  "mmm que trae el combo",
  "este que contiene el basico",
];
for (const frase of PREGUNTAS_ANCHO) {
  comprobar(
    `«${frase}»`,
    enOB.isOrderBumpConversationQuestion(frase) === true,
    "pregunta"
  );
}

// ── 2.c LA PROPIEDAD DE SEGURIDAD ────────────────────────────────────────────
//    El arreglo solo puede AFLOJAR el veto, nunca apretarlo: todo lo que hoy
//    pasa como decision tiene que seguir pasando. Si alguna frase empieza a ser
//    «pregunta» en -OB- sin serlo antes, es una regresion — y se ve aqui.
console.log("\n— el arreglo solo afloja, nunca aprieta —\n");
const TODAS = [
  ...DECISIONES,
  ...PREGUNTAS,
  ...DECISIONES_ANCHO,
  ...PREGUNTAS_ANCHO,
];
const apretadas = TODAS.filter(
  (f) =>
    enOB.isOrderBumpConversationQuestion(f) === true &&
    enDOS.isOrderBumpConversationQuestion(f) === false
);
comprobar(
  "ninguna frase se volvio pregunta por el arreglo",
  apretadas.length === 0,
  apretadas.length === 0 ? `${TODAS.length} frases` : apretadas.join(" | ")
);

// -- 2.d LAS DOS PRESENTACIONES PRESTADAS LEEN IGUAL ------------------------
//
// LO QUE PASO — 25 de septiembre de 2026. La lectura fina preguntaba por el
// NOMBRE de la modalidad, y con el selector la modalidad se llama lineal: sus dos
// presentaciones leian con la regla tosca. «el que viene completo» no elegia, y
// el turno acabo en el mensaje de emergencia.
//
// SE ENCIENDEN LAS DOS, por orden del dueno: «yo uso como lineal, y cambio a como
// dou y cambio a como ob cuando yo desee, debe estar preparado para el cambio sin
// romperse». Un selector que deja una de las tres cojas no es un selector.
//
// Y SE MIDE CON EL CORPUS ENTERO, no con la frase que fallo: las decisiones
// tienen que decidir y las preguntas tienen que seguir preguntando, en las dos.
console.log("\n— las dos presentaciones prestadas leen igual —\n");
for (const [etiqueta, lector] of [
  ["como -OB-", comoOB],
  ["como -DOU-", comoDOU],
]) {
  const decisionesMal = [...DECISIONES, ...DECISIONES_ANCHO].filter(
    (f) => lector.isOrderBumpConversationQuestion(f) === true
  );
  comprobar(
    `${etiqueta}: las decisiones deciden`,
    decisionesMal.length === 0,
    decisionesMal.length === 0
      ? `${DECISIONES.length + DECISIONES_ANCHO.length} frases`
      : decisionesMal.join(" | ")
  );
  const preguntasMal = [...PREGUNTAS, ...PREGUNTAS_ANCHO].filter(
    (f) => lector.isOrderBumpConversationQuestion(f) === false
  );
  comprobar(
    `${etiqueta}: las preguntas siguen preguntando`,
    preguntasMal.length === 0,
    preguntasMal.length === 0
      ? `${PREGUNTAS.length + PREGUNTAS_ANCHO.length} frases`
      : preguntasMal.join(" | ")
  );
  // LA PROPIEDAD DE SEGURIDAD, tambien aqui: esto solo puede AFLOJAR. Ninguna
  // frase que decidia con la regla tosca puede pasar a ser pregunta.
  const apretadasAqui = TODAS.filter(
    (f) =>
      lector.isOrderBumpConversationQuestion(f) === true &&
      enDOS.isOrderBumpConversationQuestion(f) === false
  );
  comprobar(
    `${etiqueta}: solo afloja, nunca aprieta`,
    apretadasAqui.length === 0,
    apretadasAqui.length === 0 ? `${TODAS.length} frases` : apretadasAqui.join(" | ")
  );
}
// Y LA MISMA PROPIEDAD DONDE SE ACABA DE LLEVAR. Si llevarlo a -DOU- apretara
// alguna frase, se veria aqui con su nombre y sin tener que buscarla.
const apretadasEnDOU = TODAS.filter(
  (f) =>
    enDOU.isOrderBumpConversationQuestion(f) === true &&
    enDOS.isOrderBumpConversationQuestion(f) === false
);
comprobar(
  "ni tampoco al llevarlo a -DOU-",
  apretadasEnDOU.length === 0,
  apretadasEnDOU.length === 0
    ? `${TODAS.length} frases`
    : apretadasEnDOU.join(" | ")
);

// ── 3. EL ARREGLO YA CORRE EN -DOU- ──────────────────────────────────────────
//    Se llevo el 15 de septiembre de 2026, con permiso del dueño y con la
//    medida delante: en -DOU- «creo que el combo» seguia contando como pregunta,
//    asi que la eleccion no se anotaba, el turno se lo quedaba el modelo y el
//    cliente tenia que decidir dos veces. Lo mismo que costo la venta en -OB-
//    dos dias antes.
console.log("\n— y en -DOU- pasa ya lo mismo que en -OB- —\n");
for (const frase of DECISIONES) {
  comprobar(
    `«${frase}»`,
    enDOU.isOrderBumpConversationQuestion(frase) === false,
    "decision"
  );
}
for (const frase of PREGUNTAS) {
  comprobar(
    `«${frase}»`,
    enDOU.isOrderBumpConversationQuestion(frase) === true,
    "pregunta"
  );
}

// ── 3.b FUERA DE ESAS DOS NO SE MOVIO NADA ───────────────────────────────────
//    Doble Oferta 2 Productos hace de testigo: tiene que comportarse igual que
//    antes del 13 de septiembre, fallo incluido, hasta que el dueño diga. Si
//    esto empieza a fallar es que la puerta de modalidad se cayo y el arreglo se
//    ha ido solo a modalidades que nadie pidio.
console.log("\n— y en Doble Oferta 2 Productos, el comportamiento de antes —\n");
comprobar(
  "«creo que el combo» sigue siendo pregunta alli",
  enDOS.isOrderBumpConversationQuestion("creo que el combo") === true,
  "sin tocar"
);
comprobar(
  "«mejor el basico por que...» sigue vetado alli",
  enDOS.isOrderBumpConversationQuestion(
    "mejor el basico por que no tengo plata"
  ) === true,
  "sin tocar"
);
comprobar(
  "«que trae el combo» sigue siendo pregunta alli",
  enDOS.isOrderBumpConversationQuestion("que trae el combo") === true,
  "sin tocar"
);
// Y LINEAL, QUE ES LA OTRA QUE EL USA, TAMPOCO SE MOVIO.
comprobar(
  "y en lineal tampoco se movio",
  armar("lineal").isOrderBumpConversationQuestion("creo que el combo") === true,
  "sin tocar"
);

// ── 4. La forma, para que no se deshaga sin querer ───────────────────────────
console.log("\n— la forma del arreglo —\n");
comprobar(
  "la decision del «que» es por POSICION",
  /function elQueEsElDePreguntar/.test(config) &&
    /\.slice\(0, i\)\s*\.every\(\(p\) => ANTESALA_QUE_NO_QUITA_LA_PREGUNTA\.has\(p\)\)/.test(
      config
    ),
  "nada de listas de sinonimos"
);
// LA PUERTA DE MODALIDAD SIGUE PUESTA — lo que cambio es a cuantas deja pasar.
//
// Antes esta linea exigia `laModalidadActivaEsOrderBump()`. El 15 de septiembre
// de 2026 el arreglo se llevo a -DOU-, asi que la puerta es ahora suya propia y
// nombra las dos. Lo que se fija sigue siendo lo mismo: que HAYA puerta, y que
// sea una lista corta y explicita — no «todas» ni un descuido.
comprobar(
  "la puerta de modalidad sigue puesta",
  /export function laLecturaFinaDeLaEleccionEstaActiva\(\): boolean \{/.test(config) &&
    /const elQueCuentaComoPregunta = laLecturaFinaDeLaEleccionEstaActiva\(\)/.test(config),
  "y es suya propia"
);
comprobar(
  // Y EL 25 DE SEPTIEMBRE DE 2026 SE LE SUMO LA PRESENTACION PRESTADA DE -OB-.
  //
  // Le costo una venta entera: vendiendo en lineal con el selector «COMO -OB-»,
  // con las dos opciones en pantalla, escribio «el que viene completo» y recibio
  // «Recibido. Revisa los siguientes mensajes». La puerta preguntaba por el
  // NOMBRE de la modalidad y ahi la modalidad se llama lineal, asi que el «que»
  // volvia a la regla tosca. Se pregunta por el DATO con `isOrderBumpActive`,
  // que es el unico punto de verdad y ya exige que la oferta de dos este
  // sentada de verdad.
  //
  // La INTENCION de esta comprobacion no cambia: que HAYA puerta y que sea una
  // lista corta y explicita, no «todas» ni un descuido.
  "y deja pasar a -OB-, a -DOU- y a las dos presentaciones prestadas",
  /isOrderBumpActive\(\) \|\|\s*\r?\n?\s*vendeConPresentacionPrestada\(cfg, "dos_juntas"\) \|\|\s*\r?\n?\s*modo === "order_bump" \|\|\s*\r?\n?\s*modo === "doble_oferta_upsell"/.test(
    config
  ),
  "Doble Oferta 2 Productos sigue como antes"
);
// Y LA MISMA FRASE, EJECUTADA: es lo unico que demuestra que el arreglo llega.
comprobar(
  "con la presentacion prestada, «creo que el combo» decide",
  comoOB.isOrderBumpConversationQuestion("creo que el combo") === false,
  "lo que fallo el 25/09"
);
comprobar(
  "y «el que viene completo» tampoco es una pregunta",
  comoOB.isOrderBumpConversationQuestion("el que viene completo") === false,
  "su frase, literal"
);
comprobar(
  "y en «como dou» lo mismo",
  comoDOU.isOrderBumpConversationQuestion("el que viene completo") === false,
  "mueve el selector cuando quiere"
);
comprobar(
  "fuera de -OB- se usa el regex de antes",
  /: \/\\b\(que\|qu3\|ke\)\\b\/\.test\(normalized\)/.test(config),
  "rama heredada"
);
comprobar(
  "no se decide por el signo ni por la tilde",
  !/elQueEsElDePreguntar[\s\S]{0,400}?[?¿]/.test(config),
  "solo posicion"
);
comprobar(
  "la antesala es una clase cerrada, no una lista que crece",
  (antesala.match(/"/g) || []).length / 2 <= 60,
  `${(antesala.match(/"/g) || []).length / 2} palabras`
);

console.log(
  fallos === 0
    ? "\nTODO OK — «creo que el combo» compra el combo, y su precio"
    : `\n${fallos} comprobacion(es) mal.`
);
process.exit(fallos === 0 ? 0 : 1);
