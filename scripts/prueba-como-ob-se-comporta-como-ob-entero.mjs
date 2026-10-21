// «COMO -OB-» SE COMPORTA COMO -OB- TAMBIEN EN LAS DOS CONDUCTAS QUE FALTABAN.
//
// LO QUE PASÓ — 25 de septiembre de 2026. El dueño preguntó qué le faltaba al
// selector «PRESENTA: COMO -OB-» para parecerse al -OB- que necesita. Medido,
// quedaban DOS conductas, y las dos por el mismo motivo: preguntaban por el
// NOMBRE de la modalidad —`order_bump.enabled`— y con el selector la modalidad
// sigue llamándose lineal, así que ese interruptor está apagado.
//
// 1) LA HERRAMIENTA QUE COMPARA LAS DOS OPCIONES contestaba «Order Bump
//    inactivo» y no devolvía nada. Es la que usa el modelo cuando el cliente
//    dice «no entiendo», «¿qué diferencia hay?» o «¿cuál me recomiendas?» —
//    justo el turno en que está decidiendo. El modelo improvisaba sin la
//    comparación oficial.
//
// 2) LA TANDA DE MUESTRAS no excluía al producto oculto. Con las galerías vacías
//    no se veía, pero al llenarlas la foto del full podía salir ANTES de su
//    revelación, que es la regla más dura de esta modalidad.
//
// Y la de las muestras tenía una GEMELA LITERAL en `openrouter.ts`
// —`elOrderBumpSigueOculto`— que ya se había arreglado el 24/09 con esta misma
// línea. Dos lecturas del mismo estado, y una sabía de la presentación prestada y
// la otra no: el fallo que el comentario de esa gemela advierte.
//
// Y AL HABILITAR LA HERRAMIENTA APARECIÓ UN TERCER DETALLE, que se ve solo al
// mirar lo que devuelve: describe un COMPLEMENTARIO que «no se vende aparte». En
// el -OB- de verdad eso es cierto —el complemento se suma al básico para formar
// el combo—, pero con la presentación prestada ese hueco lo ocupa el FULL, que SÍ
// se vende: es la opción cara. Habilitarla tal cual le habría dicho al modelo que
// la opción cara no se vende. Una falsedad sobre lo que está vendiendo, peor que
// no contestar.
//
// LO QUE NO PUEDE ROMPERSE:
//
//   · El -OB- de verdad recibe EXACTAMENTE lo de siempre, con su complementario
//     y su «no se vende aparte».
//   · En -DOU- la herramienta sigue inactiva, como estaba.
//
//   node scripts/prueba-como-ob-se-comporta-como-ob-entero.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const cerebro = readFileSync(join(RAIZ, "src", "lib", "openrouter.ts"), "utf8");
const motor = readFileSync(
  join(RAIZ, "src", "lib", "workflow", "engine.ts"),
  "utf8"
);

let fallos = 0;
const comprobar = (titulo, ok, nota = "") => {
  if (!ok) fallos++;
  console.log(
    `${ok ? "ok   " : "FALLA"} ${titulo.padEnd(54).slice(0, 54)} ${nota}`
  );
};

// ── 1. LA HERRAMIENTA DE COMPARAR SE ENCIENDE CON EL DATO ───────────────────
console.log("-- 1. la herramienta que compara las dos opciones ----------");
const bloque = (() => {
  const i = cerebro.indexOf('if (name === "consultar_contenido_order_bump")');
  const f = cerebro.indexOf('if (name === "notify_admin_emergency")', i);
  return i < 0 || f < 0 ? "" : cerebro.slice(i, f);
})();
comprobar(
  "pregunta por el dato, no por el interruptor",
  /if \(!isOrderBumpActive\(\) \|\| !config\?\.order_bump\)/.test(bloque),
  "vale para la prestada y para la de verdad"
);
comprobar(
  "y ya no pregunta por el nombre de la modalidad",
  !/if \(!config\?\.order_bump\?\.enabled\)/.test(bloque),
  "ese interruptor esta apagado con el selector"
);

// ── 2. EL SEGUNDO PRODUCTO SE NOMBRA POR LO QUE ES ──────────────────────────
console.log("\n-- 2. el segundo no es un complemento si se vende ---------");
comprobar(
  "se decide con el dato de la presentacion prestada",
  /const elSegundoSeVendeSolo = segundaOpcionPrestada\(config\) !== null;/.test(
    bloque
  ),
  "null en -OB- y -DOU- de verdad"
);
comprobar(
  "vendiendose solo: los dos son vendibles",
  /elSegundoSeVendeSolo[\s\S]{0,400}?both_sold_separately: true/.test(bloque),
  "y no hay «no se vende aparte»"
);
comprobar(
  "con complementario: EXACTAMENTE lo de siempre",
  /not_sold_separately: complementName,/.test(bloque) &&
    /consists_of: \[mainName, complementName\],/.test(bloque),
  "el -OB- de verdad no se entera"
);
comprobar(
  "el alcance «complemento» no aplica sin complemento",
  /if \(elSegundoSeVendeSolo\) scope = "options";/.test(bloque),
  "cae al alcance seguro"
);
comprobar(
  "y el segundo viaja con su propia clave",
  /second_sellable_product: \{/.test(bloque) &&
    /complementary_product: \{/.test(bloque),
  "una para cada caso"
);

// ── 2-bis. Y NO PIDE CERRAR CON IMÁGENES SI NO HAY IMÁGENES ────────────────
//
// LO QUE PASÓ — 25/09/2026, en su prueba, con esta herramienta ya encendida. El
// cliente escribió «que son 2 noentiendo» y recibió «✅ Recibido. Revisa los
// siguientes mensajes»: el mensaje de emergencia de cuando se agotan los
// intentos. En el registro, dos guardarraíles peleando en el mismo turno —un
// importe que era su propio ahorro, y «ofrecio material visual sin galeria»— y
// detrás «max tool iterations alcanzado».
//
// El cierre de esta instrucción pedía ofrecer las imágenes SIN CONDICIÓN, y el
// aviso que lo prohíbe solo viaja en los turnos que ya hablan de imágenes — ese
// no hablaba. Llegó la orden y no llegó la prohibición.
//
// El dueño lo dijo así: «no debería activarse envíos ni ofrecer la galería si
// está desactivado, eso no puede pasar». Y la cura es la de esta casa: quitar el
// dato, no pedirle que lo ignore.
console.log("\n-- 2-bis. no pide imagenes si no hay imagenes -------------");
comprobar(
  "el cierre depende de que existan muestras",
  /const hayMuestras = getImageGallery\(false, convo\)\.length > 0;/.test(bloque),
  "la misma pregunta que hace el guardarrail"
);
comprobar(
  "con muestras: pide cerrar ofreciendolas",
  /hayMuestras\s*\r?\n?\s*\? " Cierra ofreciendo mostrar las imágenes configuradas/.test(
    bloque
  ),
  "como siempre"
);
comprobar(
  "sin muestras: se lo prohibe y cierra preguntando",
  /: " Cierra con una pregunta breve[\s\S]{0,200}?NO ofrezcas imágenes/.test(
    bloque
  ),
  "no puede prometer lo que no existe"
);
comprobar(
  "y ya no hay un cierre incondicional",
  !/pago\. Cierra ofreciendo mostrar las im/.test(bloque),
  "la orden vieja no se quedo suelta"
);

// ── 3. LA TANDA DE MUESTRAS TAPA AL OCULTO ──────────────────────────────────
console.log("\n-- 3. la tanda de muestras y su gemela --------------------");
const ocultar = (() => {
  const i = motor.indexOf("function shouldHideGuidedSecondProduct(");
  const f = motor.indexOf("\n}", motor.indexOf("return ", i));
  return i < 0 ? "" : motor.slice(i, f + 2);
})();
comprobar(
  "pregunta por el dato",
  /return isOrderBumpActive\(\) && !orderBumpPostSale && deferredUntilPayment;/.test(
    ocultar
  ),
  "antes miraba el interruptor apagado"
);
comprobar(
  "y conserva sus dos condiciones de siempre",
  /!orderBumpPostSale/.test(ocultar) && /deferredUntilPayment/.test(ocultar),
  "postventa y diferido, intactas"
);
comprobar(
  "su gemela sigue preguntando lo mismo",
  /if \(!isOrderBumpActive\(\)\) return false;/.test(cerebro),
  "las dos lecturas no pueden separarse"
);

console.log(
  fallos === 0
    ? "\nTODO OK — «como ob» compara las dos opciones y no destapa el oculto\n"
    : `\n${fallos} comprobacion(es) mal.\n`
);
process.exit(fallos === 0 ? 0 : 1);
