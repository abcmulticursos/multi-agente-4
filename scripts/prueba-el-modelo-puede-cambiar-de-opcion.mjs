// «mejor el otro» lo decide el modelo, no una lista de palabras.
//
// LO QUE PASO
//
//   14 de septiembre de 2026, prueba de -OB-. El cliente habia elegido el combo
//   y ya tenia sus datos de pago. Escribio:
//
//       «no me alcanza mejor el otro el de las tintas nada ma»
//
//   El bot le volvio a describir el producto y pregunto «¿te animas con ese?».
//   Le repregunto lo que el cliente acababa de decidir.
//
// LA CAUSA, Y ES DOBLE
//
//   El modelo SI lo entendio y SI llamo a la herramienta `seleccionar_opcion`
//   -en el log se ven las dos llamadas del turno-. El motor le contesto:
//
//       «NO registres ninguna opcion todavia; responde la duda»
//
//   porque «el otro» esta en la lista de `isProductInformationQuestion`.
//
//   Y lo peor: ese veto YA estaba matizado en payment.ts (si ya eligio y no ha
//   pagado, solo veta un signo de interrogacion de verdad). Pero el envoltorio
//   de openrouter.ts corria ANTES con la regla dura, asi que aquel arreglo
//   nunca llegaba a ejecutarse. Estaba escrito y muerto.
//
// EL ARREGLO
//
//   El envoltorio aplica el MISMO matiz que payment.ts. Acotado a -OB-.
//
// ESTA PRUEBA EJECUTA EL CODIGO DE VERDAD: el detector sale de config.ts y la
// decision del envoltorio sale de openrouter.ts.
//
//   node scripts/prueba-el-modelo-puede-cambiar-de-opcion.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");
const config = leer("src", "lib", "workflow", "config.ts");
const router = leer("src", "lib", "openrouter.ts");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 54)} ${valor}`);
};

// ── El detector real de config.ts ────────────────────────────────────────────
const trozo = (fuente, desde, hasta) => {
  const i = fuente.indexOf(desde);
  if (i < 0) return "";
  const f = fuente.indexOf(hasta, i);
  return f < 0 ? "" : fuente.slice(i, f);
};
const funcion = (firma) => {
  const cuerpo = trozo(config, firma, "\n}");
  if (!cuerpo) throw new Error(`no encuentro en config.ts:\n  ${firma}`);
  return (
    cuerpo
      .replace(
        /(?:export )?function (\w+)\((\w+): string\): boolean \{/,
        "function $1($2) {"
      )
      // Y la forma SIN argumentos, para traerse la puerta de modalidad tal cual
      // esta escrita en el motor en vez de copiarla aqui.
      .replace(/(?:export )?function (\w+)\(\): boolean \{/, "function $1() {") +
    "\n}"
  );
};
const antesala =
  trozo(config, "const ANTESALA_QUE_NO_QUITA_LA_PREGUNTA = new Set([", "]);") +
  "]);";

// ── La decision real del envoltorio, sacada de openrouter.ts ─────────────────
const bloque = trozo(
  router,
  "const convoDeLaEleccion = getConversationById(conversationId);",
  "\n    if (paymentOnly || pareceUnaPregunta) {"
);
if (!bloque) throw new Error("no encuentro el bloque del veto en openrouter.ts");

const armar = (modalidad) =>
  new Function(
    "convo",
    "latestText",
    [
      "const loadWorkflowConfig = () => ({});",
      `const getActiveModalityKey = () => ${JSON.stringify(modalidad)};`,
      "const laModalidadActivaEsOrderBump = () => getActiveModalityKey() === 'order_bump';",
      // La puerta del «que» se trae del archivo: ver `funcion` arriba.
      funcion("export function laLecturaFinaDeLaEleccionEstaActiva(): boolean {"),
      "const getConversationById = () => convo;",
      "const conversationId = 1;",
      antesala,
      // El subjuntivo de encargo vive en un solo sitio; se trae de ahí.
      trozo(config, "const SUBJUNTIVO_DE_ENCARGO = new Set([", "]);") + "]);",
      funcion("function elQueEsElDePreguntar(normalized: string): boolean {"),
      funcion(
        "export function isProductInformationQuestion(msg: string): boolean {"
      ),
      funcion("export function isPriceQuestion(msg: string): boolean {"),
      funcion(
        "export function isOrderBumpConversationQuestion(msg: string): boolean {"
      ),
      bloque,
      "return { pareceUnaPregunta, yaEligioYNoHaPagado };",
    ].join("\n\n")
  );

const enOB = armar("order_bump");
const enDOU = armar("doble_oferta_dos");

const YA_ELIGIO = { order_bump_choice: "combo", paid_total_cents: 0 };
const SIN_ELEGIR = { order_bump_choice: null, paid_total_cents: 0 };
const YA_PAGO = { order_bump_choice: "combo", paid_total_cents: 1400 };

// ── 1. El caso que rompio la prueba ──────────────────────────────────────────
console.log("— ya eligio y no ha pagado: decide el modelo —\n");
const DECISIONES = [
  "no me alcanza mejor el otro el de las tintas nada ma",
  "mejor el otro",
  "ya no me alcanza dame el otro",
  "el otro nada mas",
  "mejor el otro no tengo tanto",
];
for (const frase of DECISIONES) {
  comprobar(
    `«${frase}»`,
    enOB(YA_ELIGIO, frase).pareceUnaPregunta === false,
    "el modelo puede registrar"
  );
}

// ── 2. Un signo de verdad SIGUE vetando ──────────────────────────────────────
console.log("\n— un «?» escrito de verdad sigue vetando —\n");
for (const frase of ["que trae el otro?", "¿cual es mejor?", "el otro que trae?"]) {
  comprobar(
    `«${frase}»`,
    enOB(YA_ELIGIO, frase).pareceUnaPregunta === true,
    "vetado"
  );
}

// ── 3. LOS DOS CANDADOS QUE NO SE TOCAN ──────────────────────────────────────
//    Sin elegir todavia: una pregunta no puede fijar la primera eleccion ni
//    destapar antes de tiempo el producto oculto. Con dinero pagado: no se
//    afloja nada por una frase ambigua.
console.log("\n— los dos candados siguen enteros —\n");
comprobar(
  "SIN ELEGIR todavia -> veto completo",
  enOB(SIN_ELEGIR, "mejor el otro").pareceUnaPregunta === true,
  "candado del order bump"
);
comprobar(
  "SIN ELEGIR: «que trae el combo» vetado",
  enOB(SIN_ELEGIR, "que trae el combo").pareceUnaPregunta === true,
  "candado del order bump"
);
comprobar(
  "CON DINERO PAGADO -> veto completo",
  enOB(YA_PAGO, "mejor el otro").pareceUnaPregunta === true,
  "no se afloja con pago"
);

// ── 4. Fuera de -OB- no se movio nada ────────────────────────────────────────
console.log("\n— fuera de -OB-, el veto de siempre —\n");
comprobar(
  "«mejor el otro» sigue vetado en -DOU-",
  enDOU(YA_ELIGIO, "mejor el otro").pareceUnaPregunta === true,
  "sin tocar"
);
comprobar(
  "y el matiz no se aplica alli",
  enDOU(YA_ELIGIO, "no me alcanza mejor el otro").pareceUnaPregunta === true,
  "sin tocar"
);

// ── 5. La forma, para que no se deshaga sin querer ───────────────────────────
console.log("\n— la forma del arreglo —\n");
comprobar(
  "el envoltorio usa el matiz, no la regla dura",
  /if \(paymentOnly \|\| pareceUnaPregunta\) \{/.test(router),
  "openrouter.ts"
);
comprobar(
  "el matiz es el MISMO que el de payment.ts",
  /yaEligioYNoHaPagado[\s\S]{0,200}?\/\[\?¿\]\/\.test\(latestText\)/.test(
    leer("src", "lib", "workflow", "payment.ts")
  ) &&
    /yaEligioYNoHaPagado && laModalidadActivaEsOrderBump\(\)[\s\S]{0,80}?\/\[\?¿\]\/\.test\(latestText\)/.test(
      router
    ),
  "una sola regla, dos puertas"
);
comprobar(
  "el veto de «solo el metodo de pago» sigue en pie",
  /const paymentOnly = mentionsPayment && nonPaymentWords\.length === 0;/.test(
    router
  ),
  "paymentOnly intacto"
);
comprobar(
  "la puerta de modalidad sigue puesta",
  /laModalidadActivaEsOrderBump\(\)/.test(router),
  "solo -OB-"
);

console.log(
  fallos === 0
    ? "\nTODO OK — «mejor el otro» ya no se repregunta"
    : `\n${fallos} comprobacion(es) mal.`
);
process.exit(fallos === 0 ? 0 : 1);
