// La eleccion al final de la intro, y los precios de las dos opciones.
//
// EL FALLO GORDO: EL MOTOR LEIA LA MODALIDAD EQUIVOCADA
//
// sendDobleOfertaChoice leia "doble_oferta_dos" a pelo. En "Doble Oferta +
// Upsell" la eleccion salia con el texto y los nombres de LA OTRA modalidad
// —normalmente los de fabrica—, asi que tras la intro se colaba un "¿Cual
// prefieres? Responde {{OPCION_1}} o {{OPCION_2}}" que no estaba escrito en
// ningun campo editable. Se editaba una seccion y el bot leia otra: por eso
// tampoco habia manera de apagarlo desde el editor.
//
// Y NO SE PODIA APAGAR
//
// Vaciar el texto no servia: al releer la configuracion se le volvia a sembrar
// el de fabrica y salia igual. Hacia falta un interruptor de verdad, que
// ningun valor por defecto pueda revivir.
//
// LOS PRECIOS DE LAS DOS OPCIONES ESTABAN PARTIDOS EN DOS
//
// La pestana de las dos ofertas escribia el precio GLOBAL; Precios y pagos
// escribia el del PAIS — y el del pais manda. Se corregia uno y el bot seguia
// cobrando el otro. Un precio equivocado no da error: cobra de menos.
//
//   node scripts/prueba-eleccion-y-precios-de-las-dos-ofertas.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");

const editor = leer("src", "app", "editor", "page.tsx");
const engine = leer("src", "lib", "workflow", "engine.ts");
const config = leer("src", "lib", "workflow", "config.ts");
const api = leer("src", "app", "api", "workflow", "route.ts");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// ── 1. El motor lee la sección de la modalidad activa ───────────────────────
comprobar(
  "existe una fuente estrecha para la doble oferta",
  /export function seccionDobleOferta\(/.test(config) &&
    /if \(key === "doble_oferta_upsell"\) return cfg\.doble_oferta_upsell \?\? null;/.test(
      config
    ),
  "seccionDobleOferta"
);
comprobar(
  "y no devuelve el Order Bump, que no tiene estos campos",
  /if \(key === "doble_oferta_dos"\) return cfg\.doble_oferta_dos \?\? null;\s*\r?\n\s*return null;/.test(
    config
  ),
  "solo las 2"
);
comprobar(
  "la elección de la intro la usa",
  /const dd = seccionDobleOferta\(config\);/.test(engine),
  "sí"
);
comprobar(
  // Este era el fallo. Si vuelve, la modalidad nueva vuelve a servir contenido
  // de la vieja y el texto de fábrica reaparece sin que nadie lo escriba.
  "y ya no lee doble_oferta_dos a pelo",
  !/const dd = config\?\.doble_oferta_dos;/.test(engine),
  "fuera"
);

// ── 2. El interruptor del texto de elección ─────────────────────────────────
comprobar(
  "el motor respeta el apagado",
  /if \(dd\.choice_prompt_enabled === false\) return;/.test(engine),
  "no manda nada"
);
comprobar(
  "apagado NO manda tampoco los botones",
  // El return está ANTES de armar el prompt y de mirar use_buttons: si
  // estuviera después, con botones encendidos saldría igual.
  engine.indexOf("if (dd.choice_prompt_enabled === false) return;") <
    engine.indexOf("if (dd.use_buttons) {"),
  "sale antes"
);
comprobar(
  "el campo está declarado en la configuración",
  /choice_prompt_enabled\?: boolean;/.test(config),
  "sí"
);
comprobar(
  // Solo un false explícito apaga. Con la config de siempre —que no tiene el
  // campo— el bot se comporta igual que antes.
  "ausente = encendido, en los cuatro sitios de la API",
  (api.match(/choice_prompt_enabled: \w+\?\.choice_prompt_enabled !== false/g) ??
    []).length === 4,
  "leer y escribir, x2"
);
comprobar(
  "el editor tiene la casilla",
  /checked=\{cfg\.doble_oferta_dos\.choice_prompt_enabled !== false\}/.test(
    editor
  ) && /Mandar este texto al terminar la intro/.test(editor),
  "sí"
);
comprobar(
  "avisa de que la pregunta debe ir en la intro",
  /no se manda nada<\/strong>/.test(editor) &&
    /se queda esperando\s*\r?\n?\s*la elección/.test(editor),
  "avisa"
);
comprobar(
  "el guardado lo lleva a la modalidad con upsell",
  /choice_prompt_enabled:\s*\r?\n\s*c\.doble_oferta_dos\.choice_prompt_enabled !== false,/.test(
    editor
  ),
  "viaja"
);
comprobar(
  "y la vista previa de la intro no pinta lo que no se manda",
  /\{value\.choice_prompt_enabled === false \? \(/.test(editor),
  "no miente"
);

// ── 3. Un solo precio por opción ────────────────────────────────────────────
comprobar(
  "hay un solo sitio que lee el precio por país de cada opción",
  /function preciosPorPaisDeOpcion\(/.test(editor) &&
    /perfil\?\.order_bump\?\.combo_price_soles \?\? global\.price_soles/.test(
      editor
    ) &&
    /perfil\?\.course_price_soles \?\? global\.price_soles/.test(editor),
  "el de Precios y pagos"
);
comprobar(
  "y un solo sitio que lo escribe",
  /function guardarOpcionDeDosNiveles\(/.test(editor),
  "sí"
);
comprobar(
  "el nombre y los textos siguen siendo comunes a todos los países",
  /\.\.\.v,\s*\r?\n\s*price_soles: global\.price_soles,\s*\r?\n\s*discount_price_soles: global\.discount_price_soles,/.test(
    editor
  ),
  "globales"
);
comprobar(
  // Si cualquier edición creara capa, tocar un texto dejaría a ese país con
  // precios propios congelados sin que nadie lo pidiera.
  "solo se crea capa del país si cambió el precio",
  /if \(!cambioElPrecio\) return base;/.test(editor),
  "sí"
);
comprobar(
  "la capa es la de la modalidad que corre, no una fija",
  /const modalidadDeLaCapa =\s*\r?\n\s*activeModality\(cfg\) === "doble_oferta_upsell"/.test(
    editor
  ) && /\[modalidad\]: \{ \.\.\.capa, \[cc\]: conPrecio \}/.test(editor),
  "la activa"
);
comprobar(
  "las dos opciones ya no escriben el precio global",
  !/doble_oferta_dos: \{ \.\.\.cfg\.doble_oferta_dos, combo: v \}/.test(editor) &&
    !/doble_oferta_dos: \{ \.\.\.cfg\.doble_oferta_dos, basico: v \}/.test(
      editor
    ),
  "fuera"
);
comprobar(
  "y muestran el precio del país elegido arriba",
  /value=\{\{ \.\.\.cfg\.doble_oferta_dos\.combo, \.\.\.precioCombo \}\}/.test(
    editor
  ) &&
    /value=\{\{ \.\.\.cfg\.doble_oferta_dos\.basico, \.\.\.precioBasico \}\}/.test(
      editor
    ),
  "el suyo"
);
comprobar(
  // Es el campo que el motor lee de verdad (getOrderBumpPriceSoles → perfil).
  "escribe donde el motor lee el precio del Full",
  /combo_price_soles: v\.price_soles,\s*\r?\n\s*combo_discount_price_soles: v\.discount_price_soles,/.test(
    editor
  ) && /const kReg = profile\?\.order_bump\?\.combo_price_soles;/.test(config),
  "mismo sitio"
);

// ── 4. Los rótulos ──────────────────────────────────────────────────────────
// Los rotulos pasaron de «Opción 1 / Opción 2» a decir el PAPEL del producto,
// igual que en la pestana Contenido y que los comodines. La numeracion obligaba
// a recordar cual era cual, y encima va al reves de como uno la piensa: la 1 es
// la cara. Lo que se vigila sigue siendo lo mismo: que esta modalidad NO los
// llame combo/basico, que son los nombres de la otra.
comprobar(
  "en esta modalidad el caro se llama FULL, no Combo",
  // EL NOMBRE DEL PRODUCTO VA PEGADO AL PAPEL desde que existen las etiquetas:
  // el cajon dice cual de tus productos esta haciendo de full sin abrirlo. El
  // papel va PRIMERO y en mayusculas, que es lo que se vigila aqui — aunque el
  // nombre estuviera mal, FULL se lee antes que nada.
  /`📦 PRODUCTO FULL\$\{/.test(editor) &&
    /" \(el de mayor precio\)"/.test(editor),
  "Full"
);
comprobar(
  // El rotulo del cajon de Contenido ya no se escribe a mano: sale del puesto
  // que lo llena, con `rotuloDelPuesto`. Asi se llama igual en las seis
  // modalidades y no hay que traducir «Producto 1» de cabeza.
  "y el otro, BÁSICO",
  /nombre: "Producto básico"/.test(editor) &&
    /function rotuloDelPuesto\(/.test(editor),
  "Básico"
);
comprobar(
  "Doble Oferta 2 Productos conserva sus nombres de siempre",
  /"📦 Opción 1 — Combo"/.test(editor) && /"📚 Opción 2 — Básico"/.test(editor),
  "intactos"
);
comprobar(
  // Describía un caso concreto; con otro producto en venta el rótulo mentía.
  "el cajón del Full ya no dice «base + complemento»",
  !/base \+ complemento/.test(editor) && /nombre: "Producto full"/.test(editor),
  "limpio"
);

// ── 5. El comodín del tercer producto, a la vista ───────────────────────────
comprobar(
  "el cajón del upsell dice cuál es su comodín",
  /🏷️ Nombre del producto \(comodín\{" "\}[\s\S]{0,220}?PRODUCTO_UPSELL/.test(
    editor
  ),
  "{{PRODUCTO_UPSELL}}"
);
comprobar(
  "y también el de su precio",
  /Su precio es\{" "\}[\s\S]{0,160}?PRECIO_UPSELL/.test(editor),
  "{{PRECIO_UPSELL}}"
);
comprobar(
  // Antes solo lo ENSEÑABA, de lectura, y mandaba a la pestaña Upsell a
  // cambiarlo. Ahora se escribe aquí, como el de los otros dos productos.
  // Lo comprueba entero prueba-orden-y-pago-de-canales.mjs.
  "y deja escribir el nombre que tiene puesto",
  /value=\{cfg\.upsell\?\.name \?\? ""\}/.test(editor),
  "editable"
);

console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} comprobación(es) mal.`);
process.exit(fallos === 0 ? 0 : 1);
