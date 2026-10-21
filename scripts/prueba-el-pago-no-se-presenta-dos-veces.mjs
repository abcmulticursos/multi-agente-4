// El producto presenta el pago con SU mensaje; el general no lo repite.
//
// LO QUE PASABA (Order Bump, al elegir el producto)
//
//   Cada opcion tiene su propio «mensaje directo antes de metodos de pago», con
//   su interruptor. Encendido, salia el suyo... y detras salia igual el texto
//   general, que empieza presentando lo mismo:
//
//     suyo     "🔥 Buena eleccion! Elegiste esta opcion por X.
//               Ahora puedes pagar con cualquiera de estos metodos 👇"
//     general  "✅ ¡Perfecto! puedes adquirir el curso de la siguiente manera 👇"
//     general  "{{METODO_DE_PAGO_1}}"          <- los datos
//     general  cierre ("mandanos tu comprobante...")
//
//   No es una repeticion literal, pero el cliente lee dos veces lo mismo con
//   distintas palabras. Suena a maquina, que es justo lo que se estaba
//   corrigiendo escribiendolo a mano.
//
// POR QUE NO SE ARREGLO ANTES
//
//   Porque sustituir el texto general ENTERO deja al cliente pagando sin saber
//   a donde: ahi dentro va el cajon del pais con los numeros de cuenta. Y
//   adivinar cual burbuja era «la presentacion» era exactamente eso, adivinar.
//
// LA REGLA
//
//   Ya no hace falta adivinar: el comodin {{METODO_DE_PAGO_x}} dice cual burbuja
//   lleva los datos. Se quitan SOLO las frases que van DELANTE de ella. Si el
//   comodin no aparece en ninguna, no se quita nada.
//
// EL DETALLE QUE ROMPE ESTO SI SE OLVIDA
//
//   El worker no reenvia la burbuja que se guardo: vuelve a pedir la lista y la
//   busca POR SU NUMERO. Recortando solo al programar, los numeros dejan de
//   coincidir y manda otra burbuja — los datos dos veces y el cierre nunca. Por
//   eso el recorte viaja en el sobre y se aplica en LOS DOS sitios.
//
//   node scripts/prueba-el-pago-no-se-presenta-dos-veces.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");
const motor = leer("src", "lib", "workflow", "engine.ts");
const editor = leer("src", "app", "editor", "page.tsx");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 60)} ${valor}`);
};

// ── 1. Se sabe cual burbuja lleva los datos, sin adivinar ────────────────────
comprobar(
  "el comodin del pais es lo que marca la burbuja de datos",
  /function llevaLosDatosParaPagar\(step: ResponseStep\): boolean \{/.test(motor) &&
    /metodo_de_pago\|metodo_pago\)_\(1\|2\|3\|principal\|prioritario\)/.test(motor),
  "{{METODO_DE_PAGO_x}}"
);
// Tambien en los pies de foto: un cajon de pago puede ir de pie de una imagen.
comprobar(
  "se mira el cuerpo y el pie de foto, y todas sus variantes",
  /s\.body \?\? "",\s*\r?\n\s*\.\.\.\(s\.body_variants \?\? \[\]\),\s*\r?\n\s*s\.caption \?\? "",\s*\r?\n\s*\.\.\.\(s\.caption_variants \?\? \[\]\),/.test(
    motor
  ),
  "ninguna variante se escapa"
);

// ── 2. Solo se quita lo de DELANTE, y solo si son frases ─────────────────────
const recorte = (() => {
  const i = motor.indexOf("function sinLaPresentacionDeSiempre(");
  return i < 0 ? "" : motor.slice(i, i + 700);
})();
comprobar(
  "se corta por la primera burbuja con datos",
  // Desde el 13/10/2026 la burbuja de datos también se reconoce por el comodín de la
  // cuenta (`llevaUnaCuentaPorComodin`); sigue cortando en la PRIMERA con datos.
  /const iDatos = pasos\.findIndex\(\s*\(paso\) => llevaLosDatosParaPagar\(paso\) \|\| llevaUnaCuentaPorComodin\(paso\)\s*\);/.test(recorte) &&
    /return pasos\.slice\(iDatos\);/.test(recorte),
  "los datos y lo de detras salen igual"
);
// -1 (ningun comodin: los numeros pueden estar escritos a mano) y 0 (no hay
// presentacion delante) se tratan igual: no se toca nada.
comprobar(
  "sin comodin en ninguna burbuja, no se quita nada",
  /if \(iDatos <= 0\) return pasos;/.test(recorte),
  "mejor una frase de mas que un cliente sin datos"
);
// Una imagen nunca es una frase de presentacion: puede ser el QR.
comprobar(
  "una imagen o un audio delante frena el recorte",
  /if \(!delante\.every\(\(paso\) => \(paso\.type \?\? "text"\) === "text"\)\) return pasos;/.test(
    recorte
  ),
  "podria ser el QR"
);

// ── 3. Se aplica al elegir el producto, y solo si sale el suyo ───────────────
// LA VENTANA SE MIDE, NO SE ADIVINA. Estaba escrita a mano —7000 caracteres— y
// la función creció con sus comentarios hasta 24.456. Dos comprobaciones de aquí
// abajo pasaron a FALLAR sin que nadie tocara el motor: lo que buscaban vive en
// los caracteres 7.445 y 7.769, justo detrás del corte. Un rojo que no es un
// fallo del bot cuesta más que no tener la prueba: se cree que algo se rompió.
const entrega = (() => {
  const i = motor.indexOf("async function deliverOrderBumpResponse(");
  if (i < 0) return "";
  const f = motor.indexOf("\nasync function ", i + 10);
  return f < 0 ? motor.slice(i) : motor.slice(i, f);
})();
comprobar(
  // Cuenta igual el mensaje propio de la opcion y el cuadrito que trajo al
  // cliente hasta aqui: los dos son texto del operador.
  //
  // DECIA `mandaElSuyo`, que es «el interruptor esta puesto». Ahora dice
  // `suMensajePropioSalio`, que es «salio de verdad al menos una burbuja», y es
  // MAS estricto: con el interruptor puesto y las burbujas vacias se quitaba una
  // presentacion que no habia sustituido nadie, y el cliente se quedaba con la
  // cuenta a secas. La intencion de la prueba no cambia —sin su texto, el
  // general sale entero—; se afina a la condicion que de verdad lo garantiza.
  "el recorte depende de que su mensaje propio haya salido",
  /const directSteps =\s*\r?\n\s*suMensajePropioSalio \|\| suCuadritoYaPresento\s*\r?\n\s*\? sinLaPresentacionDeSiempre\(textoGeneral\)\s*\r?\n\s*: textoGeneral;/.test(
    entrega
  ),
  "quien no lo use, igual que hoy"
);
// Y si su texto YA daba la cuenta, no sale nada de fabrica encima.
comprobar(
  "y si su cuadrito ya dio la cuenta, no sale nada encima",
  /if \(suCuadritoYaDioLosDatos\) \{/.test(entrega),
  "su texto manda"
);
// Opt-in doble: el interruptor del producto Y el pago directo encendido.
comprobar(
  "y de que ese mensaje este encendido a proposito",
  /const mandaElSuyo =\s*\r?\n\s*config !== null &&\s*\r?\n\s*option\?\.direct_payment_prompt_enabled === true &&\s*\r?\n\s*shouldUseDirectPayment\(config, "with_choice", convo\.phone\);/.test(
    entrega
  ),
  "no toca a quien no lo enciende"
);
comprobar(
  "y queda dicho en el log cuantas burbujas se salto",
  /me salto \$\{textoGeneral\.length - directSteps\.length\} burbuja\(s\) del texto general/.test(
    entrega
  ),
  "no hay que adivinar"
);

// ── 4. EL SOBRE Y EL WORKER RECORTAN IGUAL ───────────────────────────────────
//
// Esto es lo que impide el desastre: si solo recortara uno, el worker mandaria
// los datos dos veces y el cierre nunca.
comprobar(
  "el recorte viaja en el sobre",
  /sin_presentacion\?: boolean;/.test(motor) &&
    /sin_presentacion: context\?\.sinPresentacion === true,/.test(motor),
  "programar y enviar, la misma lista"
);
// El nombre viejo se sigue leyendo: las acciones que ya estaban en la cola al
// desplegar tienen que enviarse bien y no descuadrarse.
comprobar(
  "y las acciones ya encoladas no se descuadran",
  /direct_payment_sin_presentacion\?: boolean;/.test(motor) &&
    /payload\.direct_payment_sin_presentacion === true/.test(motor),
  "se lee el nombre anterior"
);
comprobar(
  "y el worker lo aplica antes de buscar por numero",
  /const steps =\s*\r?\n\s*payload\.sin_presentacion === true \|\|\s*\r?\n\s*payload\.direct_payment_sin_presentacion === true\s*\r?\n\s*\? sinLaPresentacionDeSiempre\(todos\)\s*\r?\n\s*: todos;\s*\r?\n\s*const step = steps\[payload\.step_index\];/.test(
    motor
  ),
  "las posiciones coinciden"
);
// Solo se marca cuando de verdad se recorto algo.
comprobar(
  "el sobre solo lo marca si se quito algo",
  /sinPresentacion: directSteps\.length < textoGeneral\.length,/.test(entrega),
  "sin recorte, sobre limpio"
);

// ── 5. LA MISMA REGLA EN TODOS LOS SITIOS ────────────────────────────────────
//
// Este fallo salio TRES veces en tres sitios distintos porque cada uno tenia su
// propia idea de que hacer con el texto del operador. Ahora es una sola regla y
// se aplica en todos los caminos que mandan texto de fabrica detras del suyo.
comprobar(
  "hay una sola función que decide si su texto ya dio los datos",
  /function susBurbujasLlevanLosDatos\(/.test(motor),
  "una regla, no tres"
);
comprobar(
  "y la acción del cuadrito sabe lo que su texto ya dijo",
  /loQueYaDijo\?: ResponseStep\[\]/.test(motor) &&
    /const yaDioLosDatos = susBurbujasLlevanLosDatos\(loQueYaDijo\);/.test(motor),
  "no manda encima"
);
// Los cuatro sitios que mandan burbujas antes de una accion se lo pasan. Si uno
// se olvidara, por ahi vuelve el duplicado.
comprobar(
  "los cuatro caminos se lo pasan",
  (motor.match(/\.steps\s*\r?\n\s*\);/g) ?? []).length +
    (motor.match(/\.steps,\s*\r?\n\s*\);/g) ?? []).length >=
    2,
  "pausa, fuera de pausa, regalo y extra"
);

// ── 6. Y el editor lo cuenta ─────────────────────────────────────────────────
comprobar(
  "el editor avisa de que este texto presenta el pago",
  /Este texto presenta el pago\.<\/b> Cuando está encendido, el bot no/.test(
    editor
  ),
  "se sabe lo que hace antes de encenderlo"
);

console.log(
  fallos === 0
    ? "\nTODO OK — el pago no se presenta dos veces"
    : `\n${fallos} comprobacion(es) mal.`
);
process.exit(fallos === 0 ? 0 : 1);
