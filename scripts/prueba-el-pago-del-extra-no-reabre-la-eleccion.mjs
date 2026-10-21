// Con la venta cobrada y el extra en pantalla, hablar del extra no cambia la
// opción que ya se compró.
//
// LO QUE PASO — 16 de septiembre de 2026, convo 122 del dueño, en -DOU-. Compró
// el básico, se le entregó, se le ofreció el producto extra, lo aceptó, y pagó
// exactamente el precio del extra. Hablando de ESE producto escribió
//
//     «es completo»
//
// y su registro cuenta el resto en tres líneas:
//
//     [wf:pago] sincronizo order bump "basico" → "combo" según intención reciente
//     [wf:pago] pidió subir al combo con el extra ofrecido → este comprobante
//               es del UPGRADE, no del extra
//     [wf:pago] convo 122 APROBADO (total: S/. 18 Soles)
//
// Le entregaron la opción cara y su segunda venta no llegó a existir.
//
// LO QUE LO PRUEBA, y es la medida que más dice: `detectaIntencionDeSubirAlCombo`
// —la función cuyo único trabajo es reconocer un upgrade— devuelve FALSO en los
// siete mensajes posteriores a la compra, «es completo» incluido:
//
//     "listo"               resincroniza=null    pideSubir=false
//     "no entiendo"         resincroniza=null    pideSubir=false
//     "que trae"            resincroniza=null    pideSubir=false
//     "que es la pantonera" resincroniza=null    pideSubir=false
//     "si"                  resincroniza=null    pideSubir=false
//     "listo ahi va"        resincroniza=null    pideSubir=false
//     "es completo"         resincroniza=combo   pideSubir=false   <- aquí
//
// Nadie pidió subir. El upgrade salió entero de una RELECTURA que contesta otra
// pregunta: «¿cuál de las dos está eligiendo?».
//
// POR QUÉ NO SE TOCA EL DETECTOR. «completo» es palabra legítima de la opción
// mayor y tiene que seguir eligiéndola mientras el cliente ELIGE. Lo que no
// puede es seguir eligiendo cuando ya no hay nada que elegir: la primera venta
// está cobrada y entregada, y lo que está en pantalla es el extra.
//
// Y ERA UNA GARANTÍA YA ESCRITA. El comentario del upgrade lo dice con todas las
// letras: «quien compró el básico y NUNCA pidió subir tiene su elección en
// "basico" → su pago del extra sigue yendo al extra». Esta relectura se la
// llevaba por delante.
//
//   node scripts/prueba-el-pago-del-extra-no-reabre-la-eleccion.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const pago = readFileSync(
  join(RAIZ, "src", "lib", "workflow", "payment.ts"),
  "utf8"
).replace(/\r\n/g, "\n");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// ── La guarda real, sacada del archivo y ejecutada ───────────────────────────
//
// Se trae ENTERA y solo se le da la vuelta al `if` de forma mecánica, para que
// la condición que se prueba sea letra por letra la que corre en el bot.
const FIN = "!(laPrimeraVentaYaSeCobro && elExtraEntroEnLaConversacion)\n  ) {";
const desde = pago.indexOf("const elExtraEntroEnLaConversacion =");
const hasta = pago.indexOf(FIN, desde);
if (desde < 0 || hasta < 0) {
  throw new Error("no encuentro la guarda de la relectura en payment.ts");
}
const crudo = pago.slice(desde, hasta + FIN.length);
const cuerpo = crudo.replace("if (", "return (").replace(/\)\s*\) \{$/, "));");
const releeLaEleccion = new Function("convo", "isTwoTierActive", cuerpo);
const siempreDosOpciones = () => true;

// ── LOS ESTADOS DEL EXTRA SALEN DE `db.ts`, NO DE AQUÍ ───────────────────────
//
// LA PREGUNTA QUE LO PUSO ASÍ. La primera versión de esta prueba escribió los
// estados a mano y se dejó dos fuera; uno de ellos ni existía («comprado», que
// en realidad se llama «pagado»). El dueño preguntó «¿consideraste la etapa de
// upsell?» y no estaba entera.
//
// Ahora la lista se lee de la columna. Si alguien añade un SEXTO estado, esta
// prueba lo ve y obliga a decidir de qué lado cae — que es justo lo que no pasó
// la primera vez.
const declaracion = (() => {
  const db = readFileSync(join(RAIZ, "src", "lib", "db.ts"), "utf8");
  const i = db.indexOf("  upsell_state:");
  const f = db.indexOf(";", i);
  return i < 0 || f < 0 ? "" : db.slice(i, f);
})();
const ESTADOS = [...declaracion.matchAll(/\| "(\w+)"/g)].map((m) => m[1]);

console.log("\n— los estados del extra, leídos de la columna —\n");
comprobar(
  "se encuentra la declaración de upsell_state",
  declaracion.length > 20 && ESTADOS.length > 0,
  ESTADOS.join(", ")
);
// Los cinco de hoy. Si cambian, que no pase desapercibido.
for (const esperado of ["esperando", "ofrecido", "aceptado", "pagado", "rechazado"]) {
  comprobar(`está «${esperado}»`, ESTADOS.includes(esperado));
}
comprobar(
  "y no hay ninguno nuevo sin decidir",
  ESTADOS.length === 5,
  `${ESTADOS.length} estados`
);

// ── 1. CUÁNDO SE RELEE Y CUÁNDO NO ──────────────────────────────────────────
console.log("\n— antes de cobrar, la relectura sigue intacta —\n");
// PARA ESTO EXISTE: el cliente escribe su elección y pega la foto; el debounce
// se come la reacción al primer mensaje y sin esto se cobraría la anterior.
comprobar(
  "nadie ha pagado todavía",
  releeLaEleccion({ paid_at: null, upsell_state: null }, siempreDosOpciones) === true,
  "relee"
);
for (const estado of ESTADOS) {
  comprobar(
    `ni en «${estado}», si aún no ha pagado`,
    releeLaEleccion({ paid_at: null, upsell_state: estado }, siempreDosOpciones) === true,
    "relee"
  );
}

console.log("\n— y con la venta cobrada, calla en TODA la etapa del extra —\n");
// AQUÍ ESTABA EL HUECO. «esperando» es el más peligroso de los cinco: el primer
// producto ya está entregado y el cliente habla de lo que acaba de recibir, así
// que caben igual «es completo» o «el otro». Un cambio hecho en esos minutos se
// queda puesto y envenena el comprobante que llegue después.
for (const estado of ESTADOS) {
  comprobar(
    `compró y el extra está en «${estado}»`,
    releeLaEleccion({ paid_at: 1000, upsell_state: estado }, siempreDosOpciones) === false,
    "calla"
  );
}

console.log("\n— pero donde no hay extra, no se toca nada —\n");
// Y NO ES UNA ASIMETRÍA CAPRICHOSA: sin extra, `esPagoDeUpsell` es falso siempre
// y el fallo que esto evita no puede existir. La guarda vive donde vive el
// peligro, y quitarle la relectura a los demás sería cambiar lo que nadie pidió.
comprobar(
  "compró y no hay extra ninguno",
  releeLaEleccion({ paid_at: 1000, upsell_state: null }, siempreDosOpciones) === true,
  "relee"
);

console.log("\n— y donde no hay dos opciones, ni se mira —\n");
comprobar(
  "en lineal y upsell esto no corre",
  releeLaEleccion({ paid_at: null, upsell_state: null }, () => false) === false,
  "isTwoTierActive manda"
);

// ── 2. EL UPGRADE DE VERDAD NO DEPENDE DE ESTO ──────────────────────────────
console.log("\n— y el upgrade de verdad sigue en pie, por sus dos caminos —\n");
// Ninguno de los dos pasa por la relectura, y son los que reconocen a quien SÍ
// quiere subir. Si alguno se cae, el upgrade deja de existir.
comprobar(
  "si el bot se lo cotizó, manda el precio anotado",
  /const cotizadoElUpgrade = \(convo\.locked_price_source \?\? ""\)\.startsWith\(\s*\n?\s*"two_tier:combo"\s*\n?\s*\);/.test(
    pago
  ),
  "cotizadoElUpgrade"
);
comprobar(
  "y si lo pidió por escrito tras comprar, el detector dedicado",
  /detectaIntencionDeSubirAlCombo\(message\.content, config\)/.test(pago),
  "el que dice «false» en sus siete mensajes"
);
comprobar(
  "ese detector solo mira lo dicho DESPUÉS de la compra",
  /message\.created_at > convo\.paid_at/.test(pago),
  "un upgrade es subir de lo que ya se compró"
);

// ── 3. LA FORMA ─────────────────────────────────────────────────────────────
console.log("\n— la forma del arreglo —\n");
comprobar(
  "la guarda mira la etapa, no las palabras",
  /convo\.upsell_state != null/.test(crudo),
  "la etapa entera, no dos estados sueltos"
);
comprobar(
  "y exige que la primera venta esté cobrada",
  /convo\.paid_at != null/.test(crudo),
  "antes de eso no hay nada entregado"
);
// LO QUE NO PUEDE VOLVER: la relectura suelta, sin condición de etapa.
comprobar(
  "ya no relee en cualquier momento",
  !/^\s*if \(isTwoTierActive\(\)\) \{$/m.test(pago),
  "esa era la línea"
);

console.log(
  fallos === 0
    ? "\nTODO OK — el dinero del extra se queda en el extra\n"
    : `\n${fallos} comprobacion(es) mal.\n`
);
process.exit(fallos === 0 ? 0 : 1);
