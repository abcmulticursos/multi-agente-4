// El bot pedia 999 y despues decia que faltaban 6.500.
//
// LO QUE PASO, con los precios reales de Argentina
//
//   basico 6.000 · FULL 6.999 · segundo producto 7.500
//
//   1. Paga el basico: 6.000. El bot guarda una foto: "lo pagado hasta aqui".
//   2. Se le ofrece el segundo producto. La oferta queda ABIERTA.
//   3. Pide subir al FULL. El motor calcula bien y le dice: faltan 999.
//   4. Paga los 999 → total 7.000.
//
// Y ahi se rompia. Al llegar el comprobante, el codigo preguntaba primero si la
// oferta del segundo producto estaba abierta. Como lo estaba, contaba ese pago
// contra el precio del EXTRA en vez de contra el FULL:
//
//   contra el extra = 7.000 - 6.000 = 1.000, y el extra vale 7.500 → faltan 6.500
//
// El camino del upgrade quedaba apagado por una condicion —"!esPagoDeUpsell"—
// puesta para que el comprobante del extra no se confundiera con un eco del
// primero. Correcta para ese caso, ciega para el contrario.
//
// SEGUNDA VUELTA. El primer arreglo miraba si la eleccion seguia en "basico", y
// eso falla justo en el caso real: al decirle "faltan 1.000" el motor YA cambia
// la eleccion a "combo". Cuando llegaba el comprobante la guarda no entraba, y
// el pago volvia a contarse contra el extra. Paso otra vez, con estos numeros:
// registro 1.000 y pidio 6.500 mas, despues de haberle pedido 1.000.
//
// La señal buena es el PRECIO COTIZADO, que queda anotado y dice de que era:
// al cotizar el upgrade se guarda "two_tier:combo". Eso no se confunde con el
// segundo producto, y como se sobrescribe en cada cotizacion siempre gana la
// intencion mas reciente del cliente.
//
// El bot le da un monto y despues no lo reconoce. Con dinero de por medio, no
// hay error peor.
//
// Y HABIA UN SEGUNDO FALLO DEBAJO
//
// La lista que reconoce "quiero subir" tenia "completo", "combo" y "pack"
// escritas a mano — pero no el nombre de SUS productos. Con una oferta llamada
// "KIT EMPRENDEDOR FULL", la frase natural ("me llevo el full") no la reconocia
// nadie y se la llevaba el modelo.
//
// Ahora la lista se completa sola con lo que DISTINGUE la opcion cara de la
// barata: de "KIT EMPRENDEDOR FULL" contra "KIT EMPRENDEDOR BASICO" sale "full".
// Y vive en un solo sitio, compartida por el motor y por la validacion del
// comprobante: teniendo cada uno la suya, el bot podia reconocer la intencion al
// hablar y NO reconocerla al llegar el pago, que es justo como se rompio.
//
//   node scripts/prueba-upgrade-con-upsell-abierto.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");

const config = leer("src", "lib", "workflow", "config.ts");
const engine = leer("src", "lib", "workflow", "engine.ts");
const payment = leer("src", "lib", "workflow", "payment.ts");
const editor = leer("src", "app", "editor", "page.tsx");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 60)} ${valor}`);
};

// ── 1. El comprobante del upgrade ya no se lo queda el extra ────────────────
comprobar(
  // ESTE es el fallo. Sin esto, el pago del upgrade se cuenta contra el precio
  // del segundo producto y el cliente queda cobrado y sin entregar.
  "pedir el upgrade gana sobre la oferta del extra",
  /const esPagoDeUpsell =\s*\r?\n\s*!pidioSubirAlCombo &&/.test(payment),
  "sí"
);
comprobar(
  // LA SEGUNDA VUELTA DE ESTE FALLO. El primer intento miraba si la elección
  // seguía en "basico" — y al cotizar el upgrade el motor YA la cambia a
  // "combo". La guarda no entraba y el pago volvía a contarse contra el extra.
  "se reconoce por el precio que se le cotizó",
  /const cotizadoElUpgrade = \(convo\.locked_price_source \?\? ""\)\.startsWith\(\s*\r?\n\s*"two_tier:combo"\s*\r?\n\s*\);/.test(
    payment
  ),
  "two_tier:combo"
);
// LA TERCERA PUERTA SIGUE, PERO CON LA VENTANA ACOTADA — 15/09/2026.
//
// Antes esto exigia `getRecentUserMessages` pegado a la eleccion. Ahora hay un
// filtro en medio, por un fallo real: la ventana seguia alcanzando lo dicho
// MIENTRAS ELEGIA —el nombre de la opcion cara, y «el otro»— asi que el pago del
// producto extra se contaba como upgrade. Su convo 108.
//
// La intencion de esta comprobacion no cambia: esa puerta tiene que existir.
comprobar(
  "y también si lo pidió y aún no se había cambiado",
  /obChoice === "basico" &&[\s\S]{0,1600}getRecentUserMessages\(conversationId, 6\)/.test(
    payment
  ),
  "los dos casos"
);
comprobar(
  "acotada a lo dicho DESPUES de la compra",
  /convo\.paid_at != null && message\.created_at > convo\.paid_at/.test(payment),
  "un upgrade sube de algo ya comprado"
);
comprobar(
  // Si ya pagó el combo entero no hay nada que subir, y el comprobante es de
  // otra cosa — del segundo producto, típicamente.
  "solo si el combo no está cubierto todavía",
  /const comboSinCubrir =\s*\r?\n\s*precioComboUpgrade !== null &&\s*\r?\n\s*convo\.paid_total_cents < Math\.round\(precioComboUpgrade \* 100\);/.test(
    payment
  ),
  "sí"
);
comprobar(
  "queda escrito cuando se cruza con la oferta del extra",
  /este comprobante es del UPGRADE, no del extra/.test(payment),
  "en el registro"
);
comprobar(
  // La oferta del segundo producto NO se cierra: sigue viva para después.
  "y la oferta del extra no se cancela",
  !/setUpsellState\(conversationId, "rechazado"\)/.test(payment),
  "sigue abierta"
);
comprobar(
  // Si esto se rompiera, volveríamos al fallo de antes: el comprobante del extra
  // tratado como eco del primer pago.
  "el comprobante del extra sigue reconociéndose",
  /convo\.upsell_state === "aceptado" \|\| convo\.upsell_state === "ofrecido"/.test(
    payment
  ),
  "intacto"
);

// ── 2. La lista de "quiero subir", en un solo sitio ─────────────────────────
comprobar(
  "la lista vive en un solo sitio",
  /export function detectaIntencionDeSubirAlCombo\(/.test(config),
  "config.ts"
);
comprobar(
  // Teniendo cada uno la suya, el bot reconocía al hablar y no al cobrar.
  "y la usan el motor y el cobro",
  /detectaIntencionDeSubirAlCombo\(normalizedPostSaleText, config\)/.test(
    engine
  ) && /detectaIntencionDeSubirAlCombo\(message\.content, config\)/.test(payment),
  "los dos"
);
comprobar(
  "ya no queda una copia suelta en el motor",
  !/const upgradeIntentRe =/.test(engine),
  "quitada"
);
comprobar(
  // "full" no estaba en la lista, y es como se llama SU producto.
  "aprende el nombre de los productos configurados",
  /function palabrasPropiasDeLaOpcionCara\(/.test(config),
  "solo"
);
comprobar(
  // Las palabras que comparten las dos opciones no distinguen nada: meterlas
  // haría que pedir el básico se leyera como pedir el combo.
  "y solo las palabras que la distinguen de la barata",
  /\.filter\(\(p\) => !deLaBarata\.has\(p\) && !relleno\.has\(p\)\)/.test(config),
  "sí"
);
comprobar(
  // ESTO CASI SE ESCAPA. Aprendiendo también de los alias, un bot real —el que
  // vende— tenía un alias que era literalmente "quiero": un cliente que ya
  // compró el básico y escribiera "quiero mi enlace" se leía como que quiere
  // subir al combo, y eso le cambia el precio que se espera de su próximo pago.
  "aprende del NOMBRE, nunca de los alias",
  /const deLaCara = new Set\(limpiar\(oferta\.combo\?\.name\)\);/.test(config),
  "solo el nombre"
);
comprobar(
  // Los alias de la BARATA sí valen: aquí solo sirven para descartar, y cuantas
  // más palabras descarten, menos posibilidades de confundir una con otra.
  "pero los alias de la barata sí descartan",
  /\.\.\.\(oferta\.basico\?\.aliases \?\? \[\]\)\.flatMap\(limpiar\),/.test(config),
  "sí"
);
comprobar(
  "por palabras completas",
  /new RegExp\(`\\\\b\$\{palabra\}\\\\b`\)\.test\(texto\)/.test(config),
  "sí"
);

// ── 3. Las muestras del segundo producto, en la lista de checks ─────────────
comprobar(
  // Estaban fuera por olvido: la lista miraba tres galerías y nunca la del extra.
  "los temas del extra entran en «Info de contenido»",
  /const temasDelExtra =/.test(editor) &&
    /uniqNonEmpty\(\(c\.upsell\?\.image_gallery \?\? \[\]\)\.map\(\(g\) => g\.topic\)\)/.test(
      editor
    ),
  "sí"
);
comprobar(
  // Regla 5-bis: donde no se vende ese producto, su galería no existe y
  // ofrecerla sería enseñar temas de algo que este bot no vende.
  //
  // La condición ya no es una lista de nombres de modalidad. La etapa Upsell
  // vive en la CAPA de cada una y se puede encender en Lineal y en Order Bump,
  // así que quien decide es la capa — y por eso en Lineal las muestras del
  // extra no se podían marcar y no salían nunca.
  "solo donde ese producto existe",
  /const temasDelExtra = modalidadVendeElExtra\(c\)/.test(editor) &&
    /function modalidadVendeElExtra\(c: FullConfig\): boolean \{/.test(editor) &&
    /return c\.upsell\?\.enabled === true;/.test(editor),
  "lo dice la capa"
);

// ── 4. Las palabras de un cuadrito, en grande ───────────────────────────────
comprobar(
  "el campo de palabras se abre en una ventana",
  /onClick=\{\(\) => setPalabrasAbiertas\(true\)\}/.test(editor),
  "al hacer clic"
);
comprobar(
  // Un campo alto ahí deformaría el cajón; por eso la ventana va encima.
  "con renglones de verdad",
  /rows=\{10\}\s*\r?\n\s*value=\{palabras\}/.test(editor),
  "10 renglones"
);
comprobar(
  "y acepta comas o un salto de línea",
  /\.split\(\/\[,\\n\\r\]\+\/\)/.test(editor),
  "las dos"
);
comprobar(
  // Cerrando las dos ventanas se perdería lo escrito en la decisión.
  "Escape cierra solo la de las palabras",
  /if \(palabrasAbiertas\) \{\s*\r?\n\s*setPalabrasAbiertas\(false\);\s*\r?\n\s*return;/.test(
    editor
  ),
  "sí"
);

// ── 5. Los alias, encontrables ──────────────────────────────────────────────
comprobar(
  // Existían, pero el rótulo no decía "alias" y no se encontraban.
  "el campo de alias dice que es de alias",
  /Alias de esta opción — otras formas de pedirla \(separadas por coma\)/.test(
    editor
  ),
  "sí"
);

console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} comprobación(es) mal.`);
process.exit(fallos === 0 ? 0 : 1);
