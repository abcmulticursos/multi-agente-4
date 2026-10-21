// Las DECISIONES: respuestas escritas en la misma burbuja que pregunta.
//
// QUE SON Y QUE NO SON
//
// No son botones. El cliente NO ve nada: recibe la pregunta como texto y
// contesta escribiendo. El bot compara lo que escribio con las palabras clave
// de cada cuadrito y manda las burbujas del que acierte.
//
// Por eso no hay tope de tres —ese limite es de los botones de WhatsApp— y por
// eso el titulo no interviene en el reconocimiento: es la etiqueta para saber
// cual es cual al editar. Lo que activa son las palabras.
//
// POR QUE EXISTEN
//
// Hoy la respuesta a una eleccion vive repartida en cuatro capas (la opcion, su
// pais, la capa de la modalidad, el global) y hay 80 sitios donde puede estar.
// Para escribir una respuesta hay que acertar cual gana. Con una decision, el
// texto esta donde se hizo la pregunta y se acabo.
//
// LO QUE NO PUEDE ROMPERSE
//
// Sin decisiones, el bot funciona EXACTAMENTE como hoy. Es la condicion que
// puso Alberto para poder migrar de a poco, probando burbuja por burbuja.
//
//   node scripts/prueba-decisiones.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");

const config = leer("src", "lib", "workflow", "config.ts");
const engine = leer("src", "lib", "workflow", "engine.ts");
const api = leer("src", "app", "api", "workflow", "route.ts");
const editor = leer("src", "app", "editor", "page.tsx");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// ── 1. Sin decisiones, todo igual que hoy ───────────────────────────────────
comprobar(
  // La condición de Alberto para migrar de a poco. Si esto se pierde, una
  // burbuja cualquiera empezaría a detener la intro sin que nadie lo pidiera.
  //
  // Y cuentan solo las ENCENDIDAS: con todas apagadas es como no tener.
  // Lo que se vigila es que se cuenten las ENCENDIDAS y no todas: con todas
  // apagadas la burbuja no puede quedarse esperando una respuesta que ningun
  // cuadrito va a reconocer. Que la lista de motivos crezca —hoy tambien pedir
  // el nombre— no cambia eso.
  "una burbuja sin decisiones encendidas no detiene nada",
  /\(\(step\.buttons\?\.length \?\? 0\) > 0 \|\|\s*\r?\n\s*decisionesEncendidas\(step\.decisions\)\.length > 0/.test(
    engine
  ),
  "solo si las tiene"
);
comprobar(
  "y las decisiones son opcionales en la configuración",
  /decisions\?: BubbleDecision\[\];/.test(config),
  "opcional"
);

// ── 2. Reconocer la respuesta ───────────────────────────────────────────────
comprobar(
  "existe el reconocedor",
  /export function decisionQueCoincide\(/.test(config),
  "sí"
);
comprobar(
  // Buscar el trozo suelto haría que "no" acertara dentro de "nota" o de "no sé
  // cuánto cuesta" — y ahí el cliente pregunta, no elige.
  "compara por palabras completas, no por trozos",
  /const dicho = ` \$\{limpiar\(msg\)\} `;/.test(config) &&
    /dicho\.includes\(` \$\{clave\} `\)/.test(config),
  "sin falsos aciertos"
);
comprobar(
  "sin tildes ni mayúsculas",
  /\.normalize\("NFD"\)\s*\r?\n\s*\.replace\(\/\\p\{Mn\}\/gu, ""\)/.test(config),
  "sí"
);
comprobar(
  "si dos comparten palabra, gana la primera",
  /for \(const decision of decisiones\) \{[\s\S]{0,300}?return decision;/.test(
    config
  ),
  "por orden"
);
comprobar(
  "el título NO se usa para reconocer",
  !/decision\.title[\s\S]{0,120}?includes/.test(config),
  "solo las palabras"
);

// ── 2-bis. El cuadrito comodín ──────────────────────────────────────────────
//
// Un cuadrito SIN palabras es el de "cualquier otra respuesta". Dejarlo vacío
// es la forma natural de pedirlo —no hay nada que escribir— y así no hace falta
// inventar un interruptor aparte.
comprobar(
  "un cuadrito sin palabras atiende todo lo demás",
  /return decisiones\.find\(\(decision\) => palabrasDe\(decision\)\.length === 0\) \?\? null;/.test(
    config
  ),
  "comodín"
);
comprobar(
  // Si se mirara antes, se comería los "sí" y los "no" que sí estaban
  // previstos: nunca saltaría ninguna otra rama.
  "y se mira DESPUÉS de todas las demás",
  config.indexOf("if (dicho.includes(` ${clave} `)) return decision;") <
    config.indexOf(
      "return decisiones.find((decision) => palabrasDe(decision).length === 0)"
    ),
  "al final"
);
comprobar(
  "una palabra en blanco no cuenta como palabra",
  /\.map\(limpiar\)\.filter\(Boolean\)/.test(config),
  "se descarta"
);
comprobar(
  "el editor avisa de que ese cuadrito es el comodín",
  /cualquier otra respuesta<\/strong>: salta cuando ninguno/.test(editor),
  "lo dice"
);

// ── 2-ter. Apagar cuadritos ─────────────────────────────────────────────────
comprobar(
  // Los DOS sitios que preguntan por las decisiones —el que decide si la
  // burbuja espera y el que reconoce la respuesta— usan el mismo filtro. Con un
  // filtro cada uno, la burbuja podría esperar una respuesta que ningún
  // cuadrito encendido va a reconocer: detenida para siempre.
  "«qué decisiones cuentan» se decide en un solo sitio",
  /export function decisionesEncendidas\(/.test(config),
  "sin copias"
);
comprobar(
  "una decisión apagada no reconoce nada",
  /const decisiones = decisionesEncendidas\(todas\);/.test(config),
  "no cuenta"
);
comprobar(
  "y con todas apagadas la burbuja no espera",
  /decisionesEncendidas\(step\.decisions\)\.length > 0/.test(engine),
  "sigue de corrido"
);
comprobar(
  // Ausente = encendida, que es como se comportaban las decisiones guardadas
  // antes de que existiera el apagado.
  "solo un false explícito apaga",
  /decision\.enabled !== false/.test(config) &&
    /enabled: item\.enabled !== false,/.test(api),
  "compatible"
);
comprobar(
  "se guarda solo cuando está apagada",
  /\.\.\.\(decision\.enabled === false \? \{ enabled: false \} : \{\}\),/.test(api),
  "archivo limpio"
);
comprobar(
  "se apaga una con clic derecho",
  /Apagar esta decisión/.test(editor) && /Encender esta decisión/.test(editor),
  "sí"
);
comprobar(
  // ACCIÓN sobre los cuadritos, no un interruptor guardado: un dato aparte
  // podría contradecir a la lista y habría dos verdades para lo mismo.
  "y todas de golpe, sin guardar un interruptor aparte",
  /const apagar = decisions\.some\(\(d\) => d\.enabled !== false\);/.test(
    editor
  ) && !/decisions_enabled|decisionesActivas\?:/.test(editor),
  "es una acción"
);
comprobar(
  "el cuadrito apagado se ve apagado",
  /line-through/.test(editor),
  "gris y tachado"
);
comprobar(
  "y el editor dice qué pasa con todas apagadas",
  /Todas apagadas:<\/strong> esta burbuja no espera respuesta/.test(editor),
  "lo dice"
);

// ── 2-quinquies. El cuadrito linkeado a una accion ──────────────────────────
//
// Un comodin dentro del texto PEGA UN DATO; una accion, ademas, DEJA ALGO
// ANOTADO. Poner {{PRECIO_2}} en el cuadrito del basico ensena el precio
// correcto, pero el bot sigue sin saber que eligio el cliente — y de ese apunte
// dependen el precio contra el que se valida el comprobante y el producto que
// se entrega. Es el fallo del basico que entregaba el full.
comprobar(
  "un cuadrito puede linkearse a una acción",
  /action\?: DecisionAction;/.test(config) &&
    /export type DecisionAction =/.test(config),
  "sí"
);
comprobar(
  // Las burbujas del cuadrito YA son su contenido: ofrecerlo seria mandarlas
  // dos veces.
  "«enviar burbujas» NO está entre los links",
  !/"send_steps"[\s\S]{0,80}?DecisionAction/.test(config) &&
    !/valor: "send_steps"/.test(editor),
  "no aplica"
);
// LA LLAMADA CAMBIO DE FORMA, NO DE SITIO — 15/09/2026.
//
// Antes esto exigia la llamada en una linea. Ahora el boton manda primero sus
// burbujas y luego ejecuta, igual que hace el cuadrito: el dueno queria un boton
// que dijera lo suyo Y eligiera producto, y antes era una cosa o la otra.
//
// Lo que esta comprobacion protege no cambia: la accion la ejecuta UNA sola
// funcion, compartida por los dos.
comprobar(
  "lo que hace cada acción está en UN solo sitio",
  /async function ejecutarAccion\(/.test(engine) &&
    /default: \{[\s\S]{0,1800}return ejecutarAccion\(\s*\r?\n?\s*convo,\s*\r?\n?\s*button\.action,/.test(
      engine
    ),
  "botones y cuadritos"
);
comprobar(
  "y el botón también puede decir lo suyo antes",
  /if \(suyas\.length > 0\) await sendConfiguredSteps\(convo, suyas\);/.test(engine),
  "como el cuadrito"
);
comprobar(
  // Con una copia cada uno, "Elegir Básico" haria una cosa desde el boton y
  // otra desde el cuadrito — y eso es cobrar o entregar lo que no era.
  "el cuadrito ejecuta la MISMA función que el botón",
  /await ejecutarAccion\(\s*\r?\n\s*convo,\s*\r?\n\s*elegida\.action,/.test(
    engine
  ),
  "sin copias"
);
comprobar(
  "la acción va DESPUÉS de sus burbujas",
  engine.indexOf("await sendConfiguredSteps(convo, elegida.steps);") <
    engine.indexOf("await ejecutarAccion("),
  "primero tu texto"
);
comprobar(
  // Se le pasa además lo que su cuadrito YA dijo, para que la respuesta de la
  // opción no repita la presentación ni la cuenta.
  "elegir producto deja anotada la elección",
  /await deliverOrderBumpResponse\(convo, cual, \{/.test(engine),
  "sí"
);
comprobar(
  "y los datos de pago salen de Precios y pagos, no del cuadrito",
  /payment_method\?: string;/.test(config) &&
    /const deFabrica = getPaymentResponses\(cfgPago, metodo, eleccion, convo\.phone\);/.test(
      engine
    ),
  "un solo sitio"
);
comprobar(
  "una acción desconocida no hace nada y queda escrita",
  /tiene una acción desconocida/.test(engine),
  "avisa"
);
comprobar(
  "la API guarda el link y su método",
  /\.\.\.\(decision\.action \? \{ action: decision\.action \} : \{\}\),/.test(api) &&
    /decision\.action === "send_payment_method" &&/.test(api),
  "ida y vuelta"
);
comprobar(
  // Un cuadrito que parece linkeado y no ejecuta nada es peor que uno sin link.
  "y descarta una acción que no existe",
  /LINKS_DE_DECISION\.includes\(str\(item\.action\) as DecisionAction\)/.test(
    api
  ),
  "se descarta"
);
comprobar(
  "el editor deja elegir el link",
  // Los productos ya no son un link suelto cada uno: son "Elegir producto" con
  // un selector al lado. Lo comprueba entero prueba-elegir-producto.mjs.
  /🔗 Linkear con \(opcional\)/.test(editor) &&
    /texto: "Elegir producto"/.test(editor),
  "sí"
);
comprobar(
  "y se ve cuáles están linkeados sin abrirlos",
  /\{decision\.action && <span className="ml-1 opacity-80">🔗<\/span>\}/.test(
    editor
  ),
  "una cadenita"
);

// ── 2-quater. Borrar no puede ser un accidente ──────────────────────────────
comprobar(
  // Un clic derecho mal apuntado se llevaba el cuadrito con todo su contenido,
  // y lo que se pierde ahí es texto escrito a mano.
  "borrar una decisión pide confirmación",
  /¿Borrar «\$\{cual\}» y todo lo que escribiste dentro\?/.test(editor),
  "pregunta"
);
// Aqui se vigilaba tambien el borrado de una variacion del mensaje suelto del
// arranque. Ese cajon ya no existe, asi que no hay nada que confirmar. Ver
// `prueba-sin-mensaje-suelto-antes-de-la-intro`.
comprobar(
  "y quitar un método de pago también",
  /El cliente dejará de verlo\./.test(editor),
  "pregunta"
);

// ── 3. Se busca en la burbuja que preguntó, y solo en esa ───────────────────
comprobar(
  "se buscan las decisiones de la burbuja que preguntó",
  /function decisionDeLaBurbujaEnPausa\(/.test(engine) &&
    /const laQuePregunto = pasos\[desde - 1\];/.test(engine),
  "la anterior"
);
comprobar(
  // Mirar las de otra burbuja sería contestar a una pregunta que no se hizo.
  "no se miran las de otras burbujas",
  /decisionQueCoincide\(msgContent, laQuePregunto\?\.decisions\)/.test(engine),
  "solo esa"
);
comprobar(
  // Sus burbujas, luego su link si lo tiene, y después la intro sigue. En ese
  // orden: al revés, los datos llegarían antes del texto que los presenta.
  "acierta → salen sus burbujas, su link, y la intro sigue",
  /await sendConfiguredSteps\(convo, elegida\.steps\);[\s\S]{0,1600}?await reanudarIntroSiEstabaEnPausa\(convo\.id\);/.test(
    engine
  ),
  "en ese orden"
);
comprobar(
  // Sin esto, quien pregunte "cuánto cuesta" se quedaría con la intro a medias.
  "no acierta → la intro sigue igual",
  /Ninguna coincide: la intro sigue igual/.test(engine),
  "nadie detenido"
);

// ── 4. Se guarda de verdad ──────────────────────────────────────────────────
//
// La API reconstruye el YAML campo por campo: lo que no se escriba desaparece
// sin un solo aviso. Ya le pasó a la pregunta inicial que quedó a medias.
comprobar(
  "la API lee las decisiones",
  /function readBubbleDecisions\(/.test(api) &&
    /decisions: readBubbleDecisions\(s\?\.decisions\),/.test(api),
  "sí"
);
comprobar(
  "y las escribe",
  /function writeBubbleDecisions\(/.test(api),
  "sí"
);
comprobar(
  "en burbujas de texto Y de media",
  (api.match(/\.\.\.decisionField/g) ?? []).length === 2,
  "las dos"
);
comprobar(
  "con sus burbujas de dentro",
  /steps: \(decision\.steps \?\? \[\]\)\.map\(writeStep\),/.test(api),
  "anidadas"
);
comprobar(
  "y sus palabras clave limpias",
  /keywords: \(decision\.keywords \?\? \[\]\)\s*\r?\n\s*\.map\(\(palabra\) => palabra\.trim\(\)\)\s*\r?\n\s*\.filter\(Boolean\),/.test(
    api
  ),
  "sin espacios"
);

// ── 5. La pantalla ──────────────────────────────────────────────────────────
comprobar(
  "hay botón de agregar decisiones",
  /\+ Agregar decisiones/.test(editor),
  "sí"
);
comprobar(
  "los cuadritos van en fila, no apilados",
  /<div className="flex flex-wrap gap-2">\s*\r?\n\s*\{decisions\.map\(/.test(
    editor
  ),
  "en fila"
);
comprobar(
  "nacen sin título",
  /\{ id, title: "", keywords: \[\], steps: \[\], color: "gris" \}/.test(editor),
  "vacío"
);
comprobar(
  "clic derecho para borrar",
  /onContextMenu=\{\(evento\) => \{\s*\r?\n\s*evento\.preventDefault\(\);\s*\r?\n\s*setMenu\(\{ index, x: evento\.clientX, y: evento\.clientY \}\);/.test(
    editor
  ) && /🗑️ Borrar esta decisión/.test(editor),
  "sí"
);
comprobar(
  "se elige color de una paleta",
  /const COLORES_DE_DECISION = \[/.test(editor) &&
    /COLORES_DE_DECISION\.map\(\(c\) => \(/.test(editor),
  "sí"
);
comprobar(
  "el pop-up tiene título, palabras y burbujas",
  /Título del cuadrito/.test(editor) &&
    /Palabras que activan esta respuesta \(separadas por comas\)/.test(editor),
  "los tres"
);
comprobar(
  // Es lo que faltó la primera vez: sin visor hay que imaginarse cómo llega.
  "y su visor de WhatsApp al lado",
  /function BubbleDecisionModal\(/.test(editor) &&
    /<ChatPreview steps=\{pasos\} \/>/.test(editor),
  "sí"
);
comprobar(
  "«Listo» guarda, Escape y el clic fuera descartan",
  /const guardar = \(\) =>\s*\r?\n\s*onGuardar\(\{/.test(editor) &&
    /if \(evento\.key !== "Escape"\) return;/.test(editor),
  "borrador"
);
comprobar(
  // Limpiarlas al escribir haría desaparecer la coma recién tecleada.
  // Ahora parte por coma O por salto de línea: en la ventana grande se escriben
  // una por renglón.
  "las palabras se limpian al guardar, no al escribir",
  /palabras\s*\r?\n\s*\.split\(\/\[,\\n\\r\]\+\/\)\s*\r?\n\s*\.map\(\(p\) => p\.trim\(\)\)/.test(
    editor
  ),
  "al guardar"
);

console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} comprobación(es) mal.`);
process.exit(fallos === 0 ? 0 : 1);
