// "Te paso los datos" — y no llegaron nunca.
//
// LO QUE PASO, paso a paso
//
//   1. Compra el basico, se le ofrece el segundo producto.
//   2. Sube al FULL pagando el saldo. Se le entrega.
//   3. Sale el regalo (va detras de la entrega).
//   4. Pregunta por el segundo producto. El bot se lo describe bien.
//   5. Escribe "quiero comprar las paginas secretas".
//   6. El bot: "¡Genial! Te paso los datos para que puedas adquirirlo".
//   7. No llego nada.
//
// POR QUE
//
// Al modelo se le dice: "si acepta, NO escribas los datos de pago — los manda el
// SISTEMA". Y el sistema los mandaba solo si el MOTOR reconocia la aceptacion.
// El motor la reconoce de tres formas:
//
//   · el boton de "si"                    → no lo toco, escribio
//   · el NOMBRE configurado del producto  → se llama "PRODUCTO UPSELL"; nadie
//                                            escribe eso nunca
//   · un "si" pelado                      → solo ANTES de que salga el regalo,
//                                            y el regalo ya habia salido
//
// Ninguna acerto. El modelo prometio y el sistema no se entero. Venta perdida,
// y peor: promesa incumplida.
//
// EL ARREGLO
//
// El modelo avisa con un marcador —como ya hace con el regalo y con el upgrade—
// y el sistema cumple. Vale escriba lo que escriba el cliente.
//
// Y el editor avisa cuando el producto conserva el nombre de fabrica, que es la
// raiz de que la deteccion por nombre no acertara nunca.
//
//   node scripts/prueba-acepto-el-extra-y-no-llego-nada.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");

const cerebro = leer("src", "lib", "openrouter.ts");
const handler = leer("src", "lib", "meta", "handler.ts");
const editor = leer("src", "app", "editor", "page.tsx");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 60)} ${valor}`);
};

// ── 1. El modelo avisa ──────────────────────────────────────────────────────
comprobar(
  "el modelo tiene cómo avisar que aceptó",
  /output "<<QUIERE_EXTRA>>" at the END so the system actually sends them/.test(
    cerebro
  ),
  "<<QUIERE_EXTRA>>"
);
comprobar(
  // Sin decirle la consecuencia, el modelo se salta el marcador y vuelve a
  // prometer algo que nadie cumple.
  "y se le dice qué pasa si no lo pone",
  /Without that marker nothing is sent and your promise is not kept/.test(
    cerebro
  ),
  "no se manda"
);
comprobar(
  // Un marcador puesto por una duda mandaría datos de pago a quien solo
  // preguntaba.
  "solo cuando quiere comprarlo de verdad",
  /ONLY when they clearly want to buy it — not when they are asking questions/.test(
    cerebro
  ),
  "sí"
);
comprobar(
  "y se mantiene que el sistema es quien manda los datos",
  /do NOT write payment data yourself — the SYSTEM sends it/.test(cerebro),
  "intacto"
);

// ── 2. El sistema cumple ────────────────────────────────────────────────────
comprobar(
  // Pasa por `aceptarElExtraComoLoEscribioElDueno`, que manda las burbujas del
  // cuadrito de aceptación si el dueño armó uno, y los datos de fábrica si no.
  // Llamando directo a los de fábrica, quien aceptaba hablando con el modelo
  // recibía un texto que habla del producto que YA compró.
  "el marcador dispara los datos de pago del extra",
  /await aceptarElExtraComoLoEscribioElDueno\(freshUpsell\);/.test(handler),
  "sí"
);
comprobar(
  // Fuera de la oferta abierta, reenviaría datos a quien ya pagó o ya dijo que
  // no.
  "solo con la oferta abierta",
  /freshUpsell\?\.upsell_state === "ofrecido"/.test(handler),
  "ofrecido"
);
comprobar(
  "fuera de ahí se ignora y queda escrito",
  /<<QUIERE_EXTRA>> fuera de la oferta/.test(handler),
  "avisa"
);
comprobar(
  // El cliente nunca debe ver un marcador.
  "el marcador no se le enseña al cliente",
  /REGALO_SI\|REGALO_NO\|REGALO_HECHO\|UPGRADE_COMBO\|QUIERE_EXTRA/.test(handler),
  "se quita"
);
comprobar(
  // De una sola vez, no en trozos programados: troceado se intercalaba con los
  // datos de pago. Lo comprueba entero prueba-regalo-no-se-mete-en-medio.mjs.
  "y el texto que escribió el modelo sale antes",
  /if \(leftover\) await sendBotText\(freshUpsell, leftover\);/.test(handler),
  "sí"
);

// ── 3. Los caminos de siempre, intactos ─────────────────────────────────────
comprobar(
  "el botón de sí sigue funcionando",
  /const tocoUnBoton = botonDelUpsell\(msgContent, config\);/.test(
    leer("src", "lib", "workflow", "engine.ts")
  ),
  "intacto"
);
comprobar(
  "y pedirlo por su nombre también",
  /if \(detectaAceptacionDeUpsell\(msgContent, config\)\)/.test(
    leer("src", "lib", "workflow", "engine.ts")
  ),
  "intacto"
);

// ── 4. La raíz: el nombre de fábrica ────────────────────────────────────────
comprobar(
  // Con "PRODUCTO UPSELL" la detección por nombre no puede acertar nunca.
  "el editor avisa si conserva el nombre de fábrica",
  /const deFabrica = \/\^producto\\s\*upsell\$\/i\.test\(puesto\);/.test(editor),
  "en amarillo"
);
comprobar(
  "y explica por qué importa",
  /El bot reconoce que lo están\s*\r?\n\s*pidiendo <strong>por este nombre<\/strong>/.test(
    editor
  ),
  "lo dice"
);

console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} comprobación(es) mal.`);
process.exit(fallos === 0 ? 0 : 1);
