// Decisiones a mitad de la intro, y el boton que manda datos de pago.
//
// 1. LA INTRO NO ESPERABA
//
// Al arrancar, la intro programa TODAS sus burbujas de golpe con sus tiempos.
// Entonces una burbuja con botones no servia para preguntar: salia la pregunta,
// el cliente tocaba, y su respuesta llegaba metida EN MEDIO de las burbujas
// siguientes, que ya venian en camino.
//
// Ahora una burbuja con botones DETIENE la intro. Se retoma por tres caminos, y
// hacen falta los tres: el boton, un mensaje escrito, y el plazo. Si faltara
// cualquiera, un cliente podria quedarse con la intro a medias para siempre —
// y sin que nada lo avise, porque no es un error: es una espera.
//
// 2. EL BOTON QUE MANDA DATOS DE PAGO
//
// Se podia escribir los datos a mano dentro del boton, pero entonces el numero
// de cuenta viviria en DOS sitios: aqui y en Precios y pagos. El dia que cambie
// la cuenta se actualiza uno y el otro se queda viejo — y el cliente paga a la
// cuenta que no era. No da error y no avisa a nadie.
//
// Por eso el boton guarda QUE metodo manda, no su texto. Los datos salen de
// Precios y pagos, los del pais de cada cliente.
//
//   node scripts/prueba-decisiones-en-la-intro.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");

const engine = leer("src", "lib", "workflow", "engine.ts");
const config = leer("src", "lib", "workflow", "config.ts");
const db = leer("src", "lib", "db.ts");
const api = leer("src", "app", "api", "workflow", "route.ts");
const editor = leer("src", "app", "editor", "page.tsx");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// ── 1. La intro se detiene ──────────────────────────────────────────────────
comprobar(
  // Con botones O con decisiones. Las dos preguntan algo y las dos tienen que
  // esperar la respuesta antes de seguir soltando burbujas.
  // La lista de motivos para detenerse crecio: ahora tambien pedir el nombre.
  // Lo que esta prueba fija es que los botones y los cuadritos SIGUEN estando y
  // que lo que hay detras es cancelar las burbujas en camino.
  "una burbuja con botones o decisiones detiene la intro",
  /\(\(step\.buttons\?\.length \?\? 0\) > 0 \|\|\s*\r?\n\s*decisionesEncendidas\(step\.decisions\)\.length > 0[\s\S]{0,120}?\)\s*\r?\n\s*\) \{\s*\r?\n\s*cancelPendingActionsByTypeForConvo\(convo\.id, ACTION_SEND_INTRO_STEP\);/.test(
    engine
  ),
  "sí"
);
comprobar(
  // En la última no hay nada que detener, y ahí los botones son el cierre de la
  // intro, que ya tiene su propio camino (doble oferta, menú de pago…).
  "pero NO en la última burbuja",
  /if \(\s*\r?\n\s*!payload\.is_last &&\s*\r?\n\s*!payload\.skip_intro_step &&/.test(
    engine
  ),
  "solo en medio"
);
comprobar(
  "se recuerda por dónde retomar",
  /setIntroPausedIndex\(convo\.id, payload\.step_index \+ 1\);/.test(engine) &&
    /\["intro_paused_index", "INTEGER"\]/.test(db),
  "el paso siguiente"
);
comprobar(
  // Sin columna nueva no habría dónde apuntarlo; con NULL por defecto, las
  // conversaciones de antes siguen comportándose igual.
  "las conversaciones viejas no quedan en pausa",
  /intro_paused_index: number \| null;/.test(db) &&
    /intro_paused_index = NULL,/.test(db),
  "NULL"
);

// ── 2. Las tres salidas ─────────────────────────────────────────────────────
comprobar(
  "salida 1: el botón retoma la intro",
  /SALIDA 1 DE 3[\s\S]{0,200}?await reanudarIntroSiEstabaEnPausa\(convo\.id\);/.test(
    engine
  ),
  "sí"
);
comprobar(
  // Acierte o no con una decisión, la intro se retoma. Es la diferencia entre
  // "no viste tu respuesta personalizada" y "te quedaste sin el resto de la
  // intro para siempre".
  "salida 2: escribir cualquier cosa también la retoma",
  /SALIDA 2 DE 3[\s\S]{0,900}?if \(typeof convo\.intro_paused_index === "number"\) \{/.test(
    engine
  ) &&
    (engine.match(/await reanudarIntroSiEstabaEnPausa\(convo\.id\);/g) ?? [])
      .length >= 4,
  "acierte o no"
);
comprobar(
  "salida 3: si nadie contesta, el plazo la retoma",
  /SALIDA 3 DE 3[\s\S]{0,300}?action\.action_type === ACTION_INTRO_REANUDAR/.test(
    engine
  ) && /const ESPERA_DE_ELECCION_EN_INTRO_SEGUNDOS = 180;/.test(engine),
  "3 min"
);
comprobar(
  // Si fallara al programar después de limpiar, la conversación quedaría
  // esperando algo que ya nadie va a mandar. Se limpia ANTES, a propósito.
  "la marca se limpia antes de reprogramar",
  /setIntroPausedIndex\(convoId, null\);\s*\r?\n\s*cancelPendingActionsByTypeForConvo\(convoId, ACTION_INTRO_REANUDAR\);/.test(
    engine
  ),
  "sí"
);
comprobar(
  "programar los pasos de la intro está en UN solo sitio",
  /function programarPasosDeIntro\(/.test(engine) &&
    (engine.match(/programarPasosDeIntro\(/g) ?? []).length === 3,
  "sin copias"
);
comprobar(
  "y retomar al final no rompe nada",
  /if \(desde >= pasos\.length\) \{/.test(engine),
  "no hace nada"
);

// ── 3. El botón de datos de pago ────────────────────────────────────────────
comprobar(
  "existe la acción",
  /\| "send_payment_method"/.test(config) && /case "send_payment_method": \{/.test(engine),
  "sí"
);
comprobar(
  // ESTO es lo que importa: se guarda el NOMBRE del método, no sus datos.
  "se guarda el método, no una copia de los datos",
  /payment_method\?: string;/.test(config) &&
    /const metodo = \(metodoDePago \?\? ""\)\.trim\(\);/.test(engine),
  "solo el nombre"
);
comprobar(
  "los datos salen de Precios y pagos, por país",
  /const deFabrica = getPaymentResponses\(cfgPago, metodo, eleccion, convo\.phone\);/.test(
    engine
  ),
  "de un solo sitio"
);
comprobar(
  // Botones y cuadritos ejecutan la MISMA función. Con una copia cada uno,
  // "Elegir Básico" haría una cosa desde el botón y otra desde el cuadrito.
  //
  // LA LLAMADA CAMBIO DE FORMA EL 15/09/2026, no de sitio: el boton manda
  // primero sus burbujas y luego ejecuta, igual que el cuadrito. Sigue siendo
  // una sola funcion.
  "y botones y cuadritos usan la misma función",
  /async function ejecutarAccion\(/.test(engine) &&
    /return ejecutarAccion\(\s*\r?\n?\s*convo,\s*\r?\n?\s*button\.action,/.test(engine),
  "un solo sitio"
);
comprobar(
  "sin método elegido no manda nada y lo deja escrito",
  /no tiene método de pago elegido → no mando nada/.test(engine),
  "avisa"
);
comprobar(
  "sin datos para ese país tampoco inventa",
  /no tiene datos configurados para este país → no mando nada/.test(engine),
  "avisa"
);
comprobar(
  "y también retoma la intro",
  /case "send_payment_method": \{[\s\S]{0,1800}?await reanudarIntroSiEstabaEnPausa\(convo\.id\);/.test(
    engine
  ),
  "sí"
);

// ── 4. Se guarda de verdad ──────────────────────────────────────────────────
comprobar(
  "la API acepta la acción nueva",
  /\["send_payment_method", "show_payment", "choose_combo", "choose_basico", "human"\]/.test(
    api
  ),
  "sí"
);
comprobar(
  "lee y escribe el método elegido",
  /payment_method: str\(item\.payment_method\),/.test(api) &&
    /\? \{ payment_method: button\.payment_method\.trim\(\) \}/.test(api),
  "ida y vuelta"
);
comprobar(
  // Si escribiera el texto, volvería a haber dos copias del número de cuenta.
  "y NUNCA escribe los datos del método",
  !/payment_responses: button/.test(api),
  "solo el nombre"
);

// ── 5. En la pantalla ───────────────────────────────────────────────────────
comprobar(
  "la acción aparece en el selector del botón",
  /<option value="send_payment_method">Mandar los datos de un método de pago<\/option>/.test(
    editor
  ),
  "sí"
);
comprobar(
  "y se elige el método de una lista, no se escribe",
  /value=\{button\.payment_method \?\? ""\}/.test(editor) &&
    /metodosDePagoDisponibles\.map\(\(metodo\) => \(/.test(editor),
  "una lista"
);
comprobar(
  // Escrita a mano se quedaría atrás en cuanto se agregue un método nuevo.
  "la lista sale de los métodos configurados",
  /const metodosDePagoConfigurados = \(\(\) => \{/.test(editor) &&
    /for \(const boton of lista\)/.test(editor),
  "no es una copia"
);
comprobar(
  // Leía SOLO la raíz global. Los métodos de una modalidad viven en su capa,
  // así que en cualquier modalidad con capa propia el desplegable salía vacío:
  // los métodos existían, se veían dos secciones más arriba, y aquí ninguno.
  "y del perfil del país que se está editando, no de la raíz",
  /const lista = paymentButtonsForSelectedCountry\.length\s*\r?\n?\s*\? paymentButtonsForSelectedCountry\s*\r?\n?\s*: cfg\?\.payment_buttons \?\? \[\];/.test(
    editor
  ),
  "capa de la modalidad ?? base del país"
);
comprobar(
  "avisa si el botón se queda sin método",
  /Sin método elegido, este botón no manda nada\./.test(editor),
  "sí"
);

console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} comprobación(es) mal.`);
process.exit(fallos === 0 ? 0 : 1);
