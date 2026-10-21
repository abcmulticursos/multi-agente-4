// 👤 Usuario: el unico sitio donde vive el numero de cuenta.
//
// EL PROBLEMA
//
//   El mismo numero estaba escrito A MANO en 234 cajas del editor: una por
//   metodo, por modalidad y por canal, mas los cuadritos de decision. Cambiarlo
//   obligaba a recorrerlas todas, y saltarse una significa un cliente pagando a
//   la cuenta vieja. De hecho ya habia DOS numeros de BCP distintos circulando
//   en la misma configuracion.
//
//   Y el sitio bueno ya existia —los datos de pago por pais, con sus comodines—
//   pero estaba escondido dentro de Precios y pagos, mezclado con precios,
//   metodos, validacion y respuestas. Nadie encontraba «el original».
//
// LA PESTAÑA
//
//   Una pestaña propia, la PRIMERA, con un cuadro «👤 Usuario» que se abre en su
//   ventana. Dentro: el nombre al que le pagan y cuatro cajas de datos de pago,
//   cada una con su comodin a la vista.
//
// LO QUE LA HACE FUNCIONAR DE VERDAD
//
//   No inventa campos: escribe en los MISMOS que el motor ya lee. Y escribe en
//   la BASE **y** en todas las capas de modalidad que ya existan — porque el
//   motor lee primero la capa y solo despues la base. Escribiendo solo en la
//   base, una modalidad con copia propia seguiria mandando el numero viejo, y la
//   pestaña prometeria ser «el unico sitio» siendo mentira.
//
//   node scripts/prueba-la-pestana-de-usuario.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const editor = readFileSync(
  join(RAIZ, "src", "app", "editor", "page.tsx"),
  "utf8"
);

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 60)} ${valor}`);
};

// ── 1. La pestaña existe y sale la primera ───────────────────────────────────
comprobar(
  // El rotulo vive en `ETIQUETAS_DE_TAB` y el orden en `ORDEN_DE_TABS`: antes
  // estaban escritos dentro del menu de arriba, y por eso la barra de la
  // izquierda no podia llevar lo mismo.
  "hay una pestaña propia para el usuario",
  /type Tab =\s*\r?\n\s*\| "usuario"/.test(editor) &&
    /usuario: "👤 Usuario",/.test(editor) &&
    /const ORDEN_DE_TABS: Tab\[\] = \[\s*\r?\n\s*"usuario",/.test(editor),
  "👤 Usuario"
);
// Va PRIMERA a proposito: es donde se empieza, y es el unico sitio donde vive el
// numero. Enterrada entre las demas seria otra caja mas que nadie encuentra.
comprobar(
  "y va la primera de todas",
  /const todas: Tab\[\] = \[[\s\S]{0,220}?"usuario",\s*\r?\n\s*"intro",/.test(
    editor
  ),
  "por donde se empieza"
);
// Las dos vistas del editor leen las etiquetas del mismo sitio. Si faltara en
// una, la pestaña existiria y no se veria.
comprobar(
  "las dos vistas la conocen",
  /usuario: "👤 Usuario",/.test(editor),
  "mismo juego de etiquetas"
);

// ── 2. Escribe donde el motor lee ────────────────────────────────────────────
const panel = (() => {
  const i = editor.indexOf("function PestanaDeUsuario(");
  // La ventana se ensancha cuando el panel crece (ahora lleva tambien el
  // numero de cuenta). Se ensancha, nunca se recorta el panel para que quepa.
  return i < 0 ? "" : editor.slice(i, i + 46000);
})();
comprobar(
  "el panel existe",
  panel.length > 0,
  "PestanaDeUsuario"
);
// LOS CUATRO COMODINES QUE YA EXISTEN. No se inventa ninguno: si el panel
// escribiera en campos nuevos, el motor no los leeria y seria otra casilla que
// acepta trabajo y lo tira.
comprobar(
  "las cuatro cajas son los comodines de siempre",
  /clave: "metodo_pago_1"/.test(panel) &&
    /clave: "metodo_pago_2"/.test(panel) &&
    /clave: "metodo_pago_3"/.test(panel) &&
    /clave: "metodo_pago_principal"/.test(panel),
  "1, 2, 3 y principal"
);
comprobar(
  "y el nombre es el del receptor del pago",
  /yape_recipient_name_starts_with: e\.target\.value,/.test(panel) &&
    /comodin="\{\{NOMBRE_RECEPTOR\}\}"/.test(panel),
  "{{NOMBRE_RECEPTOR}}"
);
// Cada caja enseña SU comodin: sin eso hay que adivinar cual trae cual, y ese
// es justo el error que deja a un cuadrito de BCP mandando los datos de Yape.
comprobar(
  "cada caja enseña su comodín",
  (panel.match(/comodin: "\{\{METODO_DE_PAGO_/g) ?? []).length === 4,
  "no hay que adivinar"
);

// ── 3. LO QUE LA HACE SER «EL ÚNICO SITIO» ───────────────────────────────────
//
// El motor lee: primero la CAPA de la modalidad activa, y solo si no existe, la
// BASE. Escribiendo solo en la base, una modalidad con copia propia seguiria
// mandando el numero viejo.
const guardado = (() => {
  const i = editor.indexOf("function guardarDatosDelUsuario(");
  return i < 0 ? "" : editor.slice(i, i + 1400);
})();
comprobar(
  "guarda en la BASE del país",
  /payment_profiles_by_country: \{/.test(guardado),
  "el respaldo de todas"
);
comprobar(
  "y también en cada capa de modalidad que ya exista",
  /for \(const \[modo, porPais\] of Object\.entries\(capas\)\) \{/.test(
    guardado
  ) && /modality_payment_profiles: capasNuevas,/.test(guardado),
  "ninguna copia se queda vieja"
);
// Solo toca los campos del usuario: precios, metodos y respuestas de cada capa
// se quedan como estaban. Un panel que reescribe la capa entera borraria
// trabajo ajeno sin avisar.
comprobar(
  "y no toca nada más de esas capas",
  /\.\.\.porPais\[pais\], \.\.\.parche/.test(guardado),
  "solo los campos del usuario"
);
comprobar(
  "y lo dice en pantalla",
  /se guarda para\{" "\}\s*\r?\n\s*<strong>todas las modalidades<\/strong>/.test(
    panel
  ),
  "sin sorpresas"
);

// ── 4. Por país, porque las cuentas lo son ───────────────────────────────────
comprobar(
  "se elige el país que se está llenando",
  /onChange=\{\(e\) => onPais\(e\.target\.value as CountryCode\)\}/.test(panel),
  "cada país sus cuentas"
);
comprobar(
  "y se ve cuántas cajas van llenas sin abrir la ventana",
  /\{llenas\} de 4 datos de pago llenos/.test(panel),
  "de un vistazo"
);

// ── 5. El cuadro, con su nombre y su color ───────────────────────────────────
comprobar(
  "el cuadro lleva nombre y color, como los demás",
  /editor_colores_de_botones\?\.usuario/.test(panel) &&
    /COLORES_DE_DECISION\.map\(\(opcion\) => \(/.test(panel),
  "👤"
);
// El color se guarda donde ya se guardan los otros: no hace falta un campo
// nuevo, y por tanto no hay nada que pueda quedarse sin guardar.
comprobar(
  "y el color se guarda donde ya se guardan los demás",
  /usuario: color,/.test(editor),
  "editor_colores_de_botones"
);

// ── 6. Y el otro lado: los mensajes, en SU ventana ───────────────────────────
//
// Se dibujaron dos cajas y solo se construyo una. La segunda tiene que ser otra
// ventana, no mas cosas en la misma pantalla: primero se llenan los datos y
// despues se escriben los mensajes que los usan. En ese orden, cuando llegas al
// mensaje ya sabes que comodin poner.
// Ahora son TRES: se sumo «Respuestas de emergencia» —lo que el bot dice al
// elegir producto, antes de dar la cuenta—, que vivia dentro del cajon del
// producto en Order Bump, en un desplegable dentro de otro desplegable.
comprobar(
  "\nlos mensajes por método tienen su propia ventana",
  /const \[abierta, setAbierta\] = useState<\s*\r?\n?\s*null \| "usuario" \| "datos" \| "mensajes" \| "emergencia"\s*\r?\n?\s*>\(null\);/.test(
    panel
  ) && /abierta === "mensajes" && \(/.test(panel),
  "una ventana por cosa"
);
comprobar(
  "y el mensaje al elegir producto tiene la suya",
  /abierta === "emergencia" && \(/.test(panel) &&
    /Respuestas de emergencia/.test(panel),
  "ya no vive en Order Bump"
);
// SE MOVIO, NO SE COPIO. Con una copia, el dia que se arregle una el otro sitio
// se queda viejo — y se acabaria editando el mismo texto de dos formas.
comprobar(
  "y se movió: no quedó una copia en Order Bump",
  !/showDirectPaymentPrompt/.test(editor) &&
    /function MensajeDirectoAntesDelPago\(/.test(editor),
  "una sola implementación"
);
// Guarda EXACTAMENTE donde guardaba: el campo de la opcion, o su override del
// pais. El motor lee lo mismo que leia.
comprobar(
  "guardando donde guardaba, sin tocar el motor",
  /direct_payment_prompt: siguientes/.test(editor) &&
    /onOpcionDeLaOferta\(cual, siguiente\)/.test(editor),
  "mismo campo"
);
// LOS METODOS SON LOS SUYOS. Nunca una lista escrita en el editor: este bot es
// una plantilla y cada negocio tiene los que tiene, con sus nombres.
comprobar(
  "y salen de sus métodos de pago, no de una lista escrita",
  /const metodosDelPais = \(perfil\.payment_buttons \?\? \[\]\)\.filter\(/.test(
    panel
  ),
  "ningún método escrito aquí"
);
// Escribe en el MISMO campo que el motor lee. Si escribiera en otro, seria otra
// copia mas — justo lo que esta pestaña viene a terminar.
comprobar(
  "escribe en el mismo campo que el motor lee",
  /payment_responses: \{ \.\.\.respuestas, \[metodo\]: steps \},/.test(panel),
  "no es otra copia"
);
comprobar(
  "y avisa del que está vacío",
  /VACÍO/.test(panel) && /const tieneMensaje = \(metodo: string\): boolean =>/.test(panel),
  "sin abrir cada uno"
);
comprobar(
  "sin métodos, invita a crear el primero aquí mismo",
  /Todavía no hay ningún método\. Créalo abajo/.test(panel),
  "sin mandar a otra pantalla"
);

// ── 6 ter. UN MÉTODO ES UNA SOLA COSA ────────────────────────────────────────
//
// Estaba partido en dos pantallas: el boton —su nombre y sus palabras— en un
// sitio, y su respuesta en otro. Asi no hay forma de tenerlo en la cabeza, y
// encima, enseñando aqui solo la respuesta, los nombres parecian escritos por
// el editor.
comprobar(
  "el nombre, las palabras y la respuesta van juntos",
  /Nombre del método/.test(panel) &&
    /Lo reconoce si dicen/.test(panel) &&
    /Y le responde/.test(panel),
  "un bloque por método"
);
comprobar(
  "se pueden crear y borrar aquí mismo",
  /const agregarBoton = \(\) => \{/.test(panel) &&
    /const borrarBoton = \(i: number\) => \{/.test(panel) &&
    /➕ Agregar método de pago/.test(panel),
  "sin ir a otra pantalla"
);
// Borrar el metodo NO borra su mensaje: si se vuelve a crear con la misma
// clave, lo escrito sigue ahi. Borrar dos cosas con un clic es como se pierde
// trabajo sin querer.
comprobar(
  "y borrar un método no borra lo que tenía escrito",
  /onDatos\(\{ payment_buttons: botones\.filter\(\(_, idx\) => idx !== i\) \}\);/.test(
    panel
  ),
  "solo el método"
);
// LA CLAVE INTERNA NO SE ENSEÑA. Es lo que ata el metodo con su mensaje;
// dejarla a la vista solo invita a cambiarla y romper el enlace.
comprobar(
  "la clave interna se genera sola y no se enseña",
  /while \(botones\.some\(\(b\) => b\.method === `metodo_\$\{n\}`\)\) n \+= 1;/.test(
    panel
  ),
  "sin claves repetidas"
);
// Apagar conserva lo escrito: no es lo mismo que borrar.
comprobar(
  "y se puede apagar sin perderlo",
  /Apagado: ni sale ni se reconoce, pero conserva lo escrito/.test(panel),
  "ON / OFF"
);

// ── 6 quater. LAS DOS CARAS, Y QUE NO ENGAÑEN ────────────────────────────────
//
// El interruptor decide SOLO como se presenta el menu: botones o texto. Las
// respuestas se mandan igual en los dos casos —tocar el boton y escribir la
// palabra llevan al mismo sitio— y eso es justo lo que el nombre viejo
// («métodos CON BOTONES») hacia creer que no.
comprobar(
  "el interruptor de botones vive aquí",
  /checked=\{botonesEncendidos\}/.test(panel) &&
    /Presentar los métodos con botones/.test(panel),
  "las dos caras"
);
comprobar(
  "y dice que las respuestas salen igual en los dos casos",
  /salen igual en los dos casos/.test(panel) &&
    /tocar el botón y[\s\S]{0,60}?escribir la palabra llevan al mismo sitio/.test(
      panel
    ),
  "no engaña"
);
// LA PALABRA SIN LA QUE NO HAY BOTONES. Se cuelgan de un mensaje, y WhatsApp
// rechaza una burbuja de botones sin texto: con esto vacio el bot ni lo intenta.
// Vivia en otra pantalla, asi que se encendian los botones, no salian, y no
// habia forma de saber por que. El mismo fallo que la pregunta del upsell.
comprobar(
  "el texto que lleva los botones está aquí",
  /Texto que acompaña a los botones/.test(panel) &&
    /onTextoDeBotones\(siguiente\)/.test(panel),
  "sin él no salen"
);
comprobar(
  "y avisa en rojo si está vacío",
  /Vacío: los botones NO van a salir\.<\/strong>/.test(panel),
  "antes de probar"
);
// EL MENU ENTERO, ABAJO Y JUNTO. Los botones no salen de uno en uno: salen los
// tres en la misma burbuja, debajo del texto. Enseñarlos sueltos al lado de
// cada metodo no se parecia a lo que ve el cliente.
comprobar(
  "los botones se ven juntos, abajo del todo",
  /Así lo ve el cliente/.test(panel) &&
    /\.filter\(\(b\) => b\.enabled !== false\)\s*\r?\n\s*\.slice\(0, 3\)/.test(
      panel
    ),
  "como los ve el cliente"
);
comprobar(
  "y al ancho del visor, no cruzando la pantalla",
  /max-w-\[340px\] rounded-2xl border border-neutral-200 bg-\[#e5ddd5\]/.test(
    panel
  ),
  "340px"
);
// WhatsApp admite TRES. Del cuarto en adelante no se mandan, y callarlo dejaria
// metodos invisibles sin motivo aparente.
comprobar(
  "avisa si hay más de tres métodos encendidos",
  /WhatsApp solo admite <strong>3 botones<\/strong>/.test(panel),
  "los demás no se muestran"
);
comprobar(
  "y todo esto solo con los botones encendidos",
  /\{botonesEncendidos && \(/.test(panel),
  "apagado, desaparece"
);
// SIN PALABRAS EL BOTON SE ENCIENDE IGUAL. Decir «no se activa» seria mentir:
// lo que de verdad pasa es que se pierde a todo el que lo escriba a su manera.
comprobar(
  "avisa si a un método le faltan las palabras",
  /⚠️ <strong>Sin palabras\.<\/strong> El bot solo lo/.test(panel),
  "sin mentir sobre lo que pasa"
);
comprobar(
  "y avisa si le falta el nombre, que sí lo rompe",
  /Sin nombre no se puede mandar como botón: WhatsApp/.test(panel),
  "WhatsApp lo rechaza"
);
// Con los botones apagados, el titulo dice a que metodo pertenece ese cajon:
// sin eso son cajones de texto sueltos sin dueño.
comprobar(
  "apagados, cada cajón dice de qué método es",
  /: `Y le responde al elegir «\$\{boton\.label\?\.trim\(\) \|\| "este método"\}»`/.test(
    panel
  ),
  "cada cajón con su dueño"
);

// ── 6 bis. Las cajas de datos tienen visor ───────────────────────────────────
//
// Llevan comodines dentro -- el nombre, el precio -- y sin ver el resultado no
// se sabe que va a leer el cliente: se escribe a ciegas y el error se descubre
// vendiendo. Es el mismo visor de WhatsApp del resto del editor.
comprobar(
  "cada caja de datos enseña cómo se ve",
  /<ChatPreview\s*\r?\n\s*steps=\{\[\s*\r?\n\s*\{\s*\r?\n\s*type: "text",[\s\S]{0,220}?texts: \[perfil\[caja\.clave\] \?\? ""\],/.test(
    panel
  ),
  "visor de WhatsApp"
);
// Y con el pais que se esta llenando, no con otro: el precio y la moneda del
// visor tienen que ser los de ese pais o enseñaria un numero que nadie va a
// recibir.
comprobar(
  "y con el país que se está llenando",
  /previewContextFromConfig\(cfg, pais\)/.test(panel),
  "su moneda y su precio"
);

// ── 7. El blanco, que es el original ─────────────────────────────────────────
//
// Era el aspecto de todo lo que nadie ha pintado, pero solo como estado por
// defecto: no estaba entre las opciones, asi que pintar algo era un viaje de
// ida y no habia forma de dejarlo como estaba.
//
// «BLANCO» YA NO SE ESCRIBE `bg-white`, SINO `bg-tarjeta`.
//
// Es el mismo blanco: en el tema claro `--tema-tarjeta` vale #ffffff, asi que
// no cambia ni un tono. Lo que gana es que en el tema oscuro la chapa sin
// pintar se ve como la tarjeta que la rodea, en vez de quedarse un rectangulo
// blanco deslumbrante en medio de una pantalla oscura.
comprobar(
  "se puede volver al blanco",
  /\{ valor: "blanco", clase: "border-neutral-300 bg-tarjeta text-neutral-700" \}/.test(
    editor
  ),
  "deshacer un color"
);
comprobar(
  "y también en los botones de producto",
  /blanco: \{\s*\r?\n\s*cara: "border-neutral-300 bg-tarjeta hover:bg-neutral-50",/.test(
    editor
  ),
  "la misma paleta en los dos sitios"
);

console.log(
  fallos === 0
    ? "\nTODO OK — el número de cuenta vive en un solo sitio"
    : `\n${fallos} comprobacion(es) mal.`
);
process.exit(fallos === 0 ? 0 : 1);
