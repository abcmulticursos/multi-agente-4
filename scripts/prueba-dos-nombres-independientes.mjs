// Tu nombre y el nombre que valida el comprobante son DOS cosas.
//
// LO QUE PASABA
//
//   Habia UN solo nombre y hacia dos trabajos a la vez: se enseñaba en los
//   mensajes del bot Y validaba el comprobante del cliente.
//
//   Quien queria firmar con su nombre completo lo escribia ahi —es lo que pide
//   la casilla, «mi nombre»— y a partir de ese momento el comprobante, que trae
//   el nombre corto de la cuenta, dejaba de coincidir.
//
//   El bot rechazaba pagos BUENOS. Y el operador no tenia como saberlo: habia
//   escrito su nombre en la casilla de su nombre.
//
// COMO QUEDA
//
//   Dos campos. El del receptor no se toca y sigue validando igual que siempre.
//   El nuevo es libre: se escribe como uno quiera y no entra en ninguna
//   comprobacion.
//
//   VACIO CAE EN EL DEL RECEPTOR, en el motor y en el visor. Quien no lo llene
//   ve exactamente lo de siempre, y ningun texto se queda en blanco de golpe.
//
// LO QUE NO PUEDE VOLVER A PASAR
//
//   1. Que el nombre de leer entre en la validacion del comprobante.
//   2. Que el campo nuevo se caiga al guardar. La API guarda por LISTA: lo que
//      no esta nombrado ahi se pierde en silencio, sin error.
//   3. Que el visor enseñe un hueco donde el cliente va a leer un nombre.
//
//   node scripts/prueba-dos-nombres-independientes.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");
const config = leer("src", "lib", "workflow", "config.ts");
const sender = leer("src", "lib", "workflow", "sender.ts");
const api = leer("src", "app", "api", "workflow", "route.ts");
const editor = leer("src", "app", "editor", "page.tsx");
const pago = leer("src", "lib", "workflow", "payment.ts");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// -- 1. SON DOS CAMPOS DISTINTOS --------------------------------------------
comprobar(
  "el nombre de leer tiene su propio campo",
  /nombre_completo\?: string;/.test(config),
  "nombre_completo"
);
comprobar(
  "y el del comprobante sigue donde estaba",
  /yape_recipient_name_starts_with/.test(config) &&
    /export function getPaymentRecipientName\(/.test(config),
  "intacto"
);

// -- 2. EL DE LEER NO VALIDA NADA -------------------------------------------
//
// Esta es LA linea. Si el nombre nuevo se colara en la validacion, se habria
// reconstruido exactamente el problema que se esta arreglando.
comprobar(
  "el nombre de leer no entra en la validación del pago",
  !/nombre_completo/.test(pago),
  "payment.ts ni lo conoce"
);
comprobar(
  "y la validación sigue mirando solo el del receptor",
  /yape_recipient_name_starts_with/.test(config),
  "el comprobante no cambia"
);

// -- 3. VACIO CAE EN EL DEL RECEPTOR ----------------------------------------
//
// Sin esto, el dia que se añada este comodin a un texto y alguien no haya
// llenado el campo, el cliente lee un hueco. El respaldo hace que se pueda
// usar desde el primer momento.
// LA INTENCION NO CAMBIA: vacio cae en el del receptor. Lo que cambio es DONDE se
// resuelve. El 30/09/2026 se añadio el almacen de usuarios que cobran, y los tres
// datos del cobro —titular, nombre completo y numero de cuenta— pasaron a salir de
// UNA sola puerta, `elCobroDelPais`, para que no puedan desalinearse: el bot no
// puede mandar a pagar a un nombre y validar contra otro.
//
// Asi que el respaldo ya no vive en `getNombreCompleto` sino dentro de la puerta.
// Se comprueba ahi, y que la lectura siga pasando por ella.
// Y EL RESPALDO NO CRUZA DE PERSONA. Se añadió el 01/10/2026, cuando el dueño creó
// dos usuarios que cobran y dejó este campo vacío en los dos: el respaldo caía al
// nombre completo DEL PAÍS —el suyo— mientras el titular que validaba era el del
// usuario. Ahora, si el titular salió del usuario, el nombre para leer es el suyo.
// Lo comprueba ejecutando `prueba-el-almacen-de-usuarios-que-cobran`, seccion 3b.
comprobar(
  "vacío usa el del receptor",
  /export function getNombreCompleto\(/.test(config) &&
    /return elCobroDelPais\(country, config\)\.nombre_completo;/.test(config) &&
    /nombre_completo: titularDelCobrador\s*\r?\n?\s*\? limpio\(delCobrador\?\.nombre_completo\) \|\| titularDelCobrador\s*\r?\n?\s*: limpio\(delCobrador\?\.nombre_completo\) \|\|\s*\r?\n?\s*limpio\(perfil\?\.nombre_completo\) \|\|\s*\r?\n?\s*titular,/.test(
      config
    ),
  "nada cambia hasta llenarlo"
);

// -- 4. EL COMODIN, EN VIVO Y EN EL VISOR -----------------------------------
const comodin = /nombre_completo\|mi_nombre\|nombre_vendedor\|full_name/;
comprobar(
  "el comodín se resuelve al enviar",
  comodin.test(sender) && /getNombreCompleto\(convo\.phone\)/.test(sender),
  "{{NOMBRE_COMPLETO}}"
);
// EL VISOR TIENE QUE HACER LO MISMO, incluido el respaldo. Si enseñara un hueco
// donde el motor pone un nombre, se corrige un problema que no existe — y se
// rompe el texto para arreglarlo.
comprobar(
  "y el visor resuelve igual, con el mismo respaldo",
  comodin.test(editor) &&
    /nombreCompleto:\s*\r?\n\s*selectedProfile\?\.nombre_completo\?\.trim\(\) \|\|/.test(
      editor
    ),
  "lo mismo que se envía"
);
comprobar(
  "y está en la lista de comodines",
  /token: "\{\{NOMBRE_COMPLETO\}\}"/.test(editor),
  "se puede insertar"
);

// -- 5. LA API LO GUARDA ----------------------------------------------------
//
// Guarda por LISTA: lo que no esta nombrado se cae al guardar, en silencio y
// sin error. Son DOS sitios —el de leer y el de escribir en el archivo— y
// faltar en cualquiera de los dos deja el campo sin poder guardarse.
comprobar(
  "la API lo lee y lo escribe",
  (api.match(/nombre_completo: str\(p\?\.nombre_completo\)/g) ?? []).length >= 2,
  "no se cae al guardar"
);

// -- 6. LAS DOS TARJETAS -----------------------------------------------------
comprobar(
  "hay una tarjeta «Usuario» aparte",
  /onClick=\{\(\) => abrir\("usuario"\)\}/.test(editor) &&
    /\{abierta === "usuario" && \(/.test(editor),
  "arriba del todo"
);
// Y LA DE ABAJO CAMBIA DE NOMBRE. Llamarla «Usuario» es lo que invitaba a
// escribir ahi el nombre completo: uno busca donde poner su nombre y entra en
// la unica casilla que lo pide.
comprobar(
  "y la de abajo ya no se llama «Usuario»",
  /Datos para pago\s*\r?\n\s*<\/span>/.test(editor) &&
    /titulo=\{`Datos para pago · \$\{paisLabel\}`\}/.test(editor),
  "dice lo que hay dentro"
);
// EL AVISO. Dos casillas que piden «tu nombre» en la misma pestaña se leen como
// una repeticion si nada explica por que son dos.
comprobar(
  "y se avisa de que el otro no se toca",
  /tiene que coincidir con el que aparece en el comprobante/.test(editor),
  "por qué son dos"
);

console.log(
  fallos === 0
    ? "\nTODO OK — tu nombre es tuyo; el del comprobante, del banco"
    : `\n${fallos} FALLO(S)`
);
process.exit(fallos === 0 ? 0 : 1);
