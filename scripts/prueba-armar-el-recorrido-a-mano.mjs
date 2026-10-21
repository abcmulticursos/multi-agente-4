// El recorrido se puede armar con cuadritos, sin depender de lo automatico.
//
// QUE FALTABA
//
//   Los cuadritos solo se consultaban en DOS momentos: la intro en pausa y la
//   oferta del segundo producto. En el regalo el editor los dejaba escribir
//   igual, y no los leia nadie — se escribia la respuesta al «si quiero el
//   regalo» y esa respuesta no le llegaba a ningun cliente.
//
//   Y el menu de acciones era corto: elegir producto, mandar un metodo, mostrar
//   el menu de pago, pasar a humano. Las del regalo y la de presentar la oferta
//   de 2 opciones YA EXISTIAN —escritas y probadas— pero solo como acciones de
//   una regla del Cerebro. No estaban a mano del operador.
//
// COMO QUEDA
//
//   Las mismas funciones de siempre, abiertas tambien a los cuadritos. Un
//   cuadrito es UNA PUERTA MAS a lo mismo, no un camino paralelo: asi el «si»
//   escrito, el boton y el marcador del modelo no pueden divergir del cuadrito.
//
//   node scripts/prueba-armar-el-recorrido-a-mano.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");
const motor = leer("src", "lib", "workflow", "engine.ts");
const config = leer("src", "lib", "workflow", "config.ts");
const editor = leer("src", "app", "editor", "page.tsx");
const ruta = leer("src", "app", "api", "workflow", "route.ts");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// ── 1. Las acciones nuevas existen en los TRES sitios ────────────────────────
//
// El tipo del motor, el filtro de la API y el menu del editor. Si falta uno, el
// operador puede elegir un link que al guardar se descarta en silencio — y el
// cuadrito aparece sin nada la proxima vez que abra el editor.
for (const accion of [
  "show_order_bump",
  "accept_gift",
  "decline_gift",
  "claim_gift",
]) {
  const enMotor = new RegExp(`\\| "${accion}"`).test(config);
  const enRuta =
    new RegExp(`\\| "${accion}"`).test(ruta) &&
    new RegExp(`"${accion}",`).test(ruta);
  const enEditor = new RegExp(`valor: "${accion}"`).test(editor);
  comprobar(
    `«${accion}» esta en motor, API y editor`,
    enMotor && enRuta && enEditor,
    [enMotor ? "motor" : "SIN MOTOR", enRuta ? "API" : "SIN API", enEditor ? "editor" : "SIN EDITOR"].join(" · ")
  );
}

// ── 2. Y el motor sabe ejecutarlas ───────────────────────────────────────────
comprobar(
  "las tres del regalo usan las funciones de siempre",
  /case "accept_gift":\s*\r?\n\s*acceptGiftConsent\(convo\);/.test(motor) &&
    /case "decline_gift":\s*\r?\n\s*await declineGiftConsent\(convo\);/.test(motor) &&
    /case "claim_gift":\s*\r?\n\s*await claimGiftReward\(convo\);/.test(motor),
  "una puerta mas, no otro camino"
);
// Presentar una oferta que esta modalidad no tiene seria presentar una oferta
// vacia. Mejor el menu de pago, que es lo que tocaria.
comprobar(
  "la oferta de 2 opciones no se inventa donde no existe",
  /if \(!getActiveTwoTierOffer\(\)\) \{[\s\S]{0,400}?await sendPaymentOffer\(convo\);/.test(
    motor
  ),
  "cae al menu de pago"
);

// ── 3. Los cuadritos del regalo se leen ──────────────────────────────────────
comprobar(
  "hay quien lea los cuadritos de la pregunta del regalo",
  /function decisionDelRegalo\(/.test(motor) &&
    /config\.gift_mechanic\?\.consent_sequence/.test(motor),
  "consent_sequence"
);
// Solo las burbujas de esa pregunta: las de otra no pintan nada en ese momento,
// y mirarlas seria contestar a una pregunta que no se hizo.
comprobar(
  "y solo con la pregunta del regalo abierta",
  /if \(convo\.state === "awaiting_gift_consent"\) \{[\s\S]{0,2200}?decisionDelRegalo\(config, msgContent\)/.test(
    motor
  ),
  "en su momento"
);
// La misma regla del bot mudo, tambien aqui. Y "vacio" cuenta las APAGADAS como
// vacio: contando las apagadas, un cuadrito en OFF se quedaba el turno y el
// cliente escribia sin que le contestara nadie.
comprobar(
  "un cuadrito del regalo vacio y sin accion no se queda el turno",
  /if \(\s*\r?\n\s*salio \|\|\s*\r?\n\s*tieneBurbujasEncendidas\(cuadritoRegalo\.steps\) \|\|\s*\r?\n\s*cuadritoRegalo\.action\s*\r?\n\s*\) \{/.test(
    motor
  ),
  "nadie se queda sin respuesta"
);

// ── 4. El mensaje propio del producto gana sobre el global ───────────────────
//
// El pago directo manda un texto UNICO para todos los productos: cambia el
// precio del comodin y nada mas. Cada opcion tiene el suyo, con su interruptor,
// y no salia — esta rama global se ejecutaba antes y volvia sin mirarlo.
comprobar(
  "el mensaje propio del producto se manda antes del global",
  /option\?\.direct_payment_prompt_enabled === true &&\s*\r?\n?\s*shouldUseDirectPayment\(config, "with_choice", convo\.phone\)/.test(
    motor
  ),
  "delante"
);
// Opt-in: quien no lo encienda sigue exactamente como hoy.
comprobar(
  "y solo si esta encendido a proposito",
  /=== true &&/.test(motor),
  "no toca a quien no lo usa"
);
// Y NO sustituye a las burbujas de pago. Ahi va el comodin con los datos, y
// quitarlo por adivinar cual burbuja es «presentacion» dejaria a un cliente
// pagando sin saber a donde. Es el fallo que este mismo cambio ya provoco una
// vez, con la «respuesta al elegir».
const iPropio = motor.indexOf("su mensaje propio antes del pago");
// Desde el mensaje propio en adelante: `getDirectPaymentSteps(config)` aparece
// en varias ramas del archivo, y la primera no es la de aqui.
const iGlobal = motor.indexOf(
  'const directSteps = getDirectPaymentSteps(config, "with_choice", convo.phone);',
  iPropio
);
comprobar(
  "los datos de pago siguen saliendo detras",
  iPropio > 0 && iGlobal > iPropio,
  iPropio > 0 && iGlobal > 0 ? "el global no se salta" : "no se encontro"
);

// ── 5. En Lineal, el cajon del producto esta completo ────────────────────────
//
// El pop-up del producto tenia el precio y, donde las otras modalidades tienen
// «que dice al elegirlo», un cartel que mandaba a otra pestaña. Tenia razon —en
// una modalidad de un solo producto no hay eleccion que responder— pero dejaba
// el cajon a medias: el precio aqui y lo que se dice alla.
comprobar(
  "en Lineal se escribe ahi mismo lo que dice al ir a pagar",
  /Cuando el cliente va a pagar \{etiqueta\}/.test(editor) &&
    /idPrefix=\{`\$\{idPrefix\}_pago_directo`\}/.test(editor),
  "sin salir del pop-up"
);
// Y CON EL MISMO DISEÑO QUE LOS DEMAS PRODUCTOS.
//
// Llego a ser un bloque desplegado con las burbujas, la vista previa y el
// cierre, todo abierto dentro del pop-up del precio: ocupaba media pantalla y
// no se parecia a nada. Los otros productos tienen una chapa que se abre en su
// ventana. Dos diseños para lo mismo se leen como dos cosas distintas.
comprobar(
  "y con la misma chapa que BASICO y FULL",
  /<ChapaDeRespuesta\s*\r?\n\s*nombre="Respuesta personalizada"/.test(editor),
  "un solo diseño"
);
// «Principal» no decia nada: lo que hay dentro es el texto que escribe el
// dueño, no una categoria.
comprobar(
  "la chapa se llama por lo que es",
  !/nombre="Principal"/.test(editor) && !/\? "Principal"/.test(editor),
  "respuesta personalizada"
);
// EL SEGUNDO PRODUCTO TAMBIEN TIENE SU CAJON.
//
// Su pop-up tenia el precio y nada mas: para escribir lo que el bot dice al
// aceptarlo habia que irse a otra pestaña. El precio y lo que se dice son del
// mismo producto.
comprobar(
  "el segundo producto tiene su respuesta en su pop-up",
  /Cuando el cliente acepta el segundo producto/.test(editor) &&
    /upsell: \{ \.\.\.\(cfg\.upsell \?\? \{\}\), payment_responses: siguiente \}/.test(
      editor
    ),
  "junto a su precio"
);
// Una por metodo, porque es asi como la manda el motor: busca la de SU metodo
// y, si esta vacia, cae a la de siempre.
comprobar(
  "y es una por metodo de pago, como la manda el motor",
  /const own = seccionUpsell\(config\)\?\.payment_responses;/.test(motor),
  "yape, transferencia, efectivo"
);
// Y ES SUYO, NO EL GLOBAL.
//
// `direct_payment_steps` de arriba es UN texto para todo el bot: no vive en
// ninguna capa. En las modalidades de dos opciones no se nota, porque cada
// opcion tiene el suyo. En Lineal si — era el unico texto que el cliente
// recibia al ir a pagar—, asi que personalizarlo se lo cambiaba a Order Bump y
// a todas. Ahora va en la capa del pais, como el precio y los datos de pago.
comprobar(
  "y se escribe en la capa de esta modalidad y pais",
  /onPerfil\(\{ \.\.\.perfilDelPais, direct_payment_steps: steps \}\)/.test(editor),
  "no toca a las demas"
);
// Vacio = el global de siempre. Quien no escriba el suyo no nota ningun cambio,
// y quien lo abra ve de donde parte en vez de una caja en blanco.
comprobar(
  "vacio, se ve y se usa el texto general",
  /steps=\{usaLosSuyos \? pasosPropios : cfg\.direct_payment_steps \?\? \[\]\}/.test(
    editor
  ),
  "de respaldo"
);
// Y el motor tiene que leerlo igual, o el editor escribiria en un sitio que
// nadie consulta: otra casilla que acepta trabajo y lo tira.
comprobar(
  "el motor prefiere el del pais sobre el global",
  /const propios = delPais\?\.direct_payment_steps;/.test(motor) &&
    /Array\.isArray\(propios\) && propios\.length > 0/.test(motor),
  "y cae al global si no hay"
);
// El cierre acompaña al texto: mezclar el propio con el cierre global pegaria
// un final que habla de otra cosa.
//
// LA EXPRESION CAMBIO EL 27/09/2026 y la intencion es la misma. El cierre del
// pais se calcula ahora en `ctaPropio`, porque hacia falta mirarlo ANTES: si la
// caja del pais se queda sin ninguna burbuja viva Y sin cierre, vale lo mismo
// que no haber escrito nada y se usa el texto global. Antes, tres burbujas
// apagadas dejaban al bot mudo mientras otro pais con la caja vacia funcionaba.
// Lo prueba entero `prueba-elegir-opcion-nunca-deja-en-silencio`.
comprobar(
  "el cierre acompaña al texto que se use",
  /const ctaPropio = hayPropios \? \(delPais\?\.direct_payment_cta \?\? ""\)\.trim\(\) : "";/.test(
    motor
  ) && /const rawCta = quedaAlgoPropio\s*\r?\n?\s*\? ctaPropio/.test(motor),
  "no se mezclan"
);
// El viaje de ida y vuelta por la API. Sin las dos lineas se escribe en el
// editor y se descarta al guardar.
comprobar(
  "la API lo lleva y lo trae",
  (ruta.match(/direct_payment_steps: \(Array\.isArray\(p\?\.direct_payment_steps\)/g) ?? [])
    .length === 2,
  "leer y escribir"
);
// Y si el pago directo esta apagado, ese texto no sale. Dejarlo escribir sin
// avisar seria otro campo que acepta trabajo y lo tira.
comprobar(
  "avisa si el pago directo esta apagado",
  /cfg\.direct_payment_enabled !== true && \(/.test(editor) &&
    /pago directo está apagado/.test(editor),
  "no se escribe en balde"
);

console.log(
  fallos === 0
    ? "\nTODO OK — el recorrido se puede armar a mano"
    : `\n${fallos} comprobacion(es) mal.`
);
process.exit(fallos === 0 ? 0 : 1);
