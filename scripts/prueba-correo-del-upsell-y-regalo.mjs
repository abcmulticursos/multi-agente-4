// El correo del segundo producto, y el orden del menú Regalo.
//
// ── EL CORREO ───────────────────────────────────────────────────────────────
//
// Habia dos correos de postventa —el del producto y el del combo/VIP— y el
// segundo producto no tenia el suyo. Quien compraba el extra y daba su correo
// recibia la plantilla del PRIMERO: el enlace equivocado, y encima uno que ya
// tenia.
//
// Ahora tiene el suyo, con el mismo diseno que los otros dos, y manda sobre
// ellos cuando la venta cerrada es la del extra. Sin plantilla propia no se
// manda nada y queda escrito: mandar el acceso del producto que no era es peor
// que no mandar correo.
//
// El precio de los comodines sigue al producto del correo. Con el del primero,
// el correo del extra anunciaria un importe que no es el que se pago.
//
// ── EL MENU REGALO ──────────────────────────────────────────────────────────
//
// «Mostrar eleccion con botones» estaba ARRIBA de las burbujas del
// ofrecimiento, o sea antes de la pregunta a la que responden: se leia al reves
// de como le llega al cliente. Ahora va debajo de la burbuja que pregunta y
// encima del mensaje de rechazo.
//
// Y los cuatro bloques de «Mensajes» iban pegados, sin separador.
//
//   node scripts/prueba-correo-del-upsell-y-regalo.mjs
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
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 60)} ${valor}`);
};

// ── 1. La plantilla existe en los tres sitios ───────────────────────────────
comprobar(
  "el motor conoce el correo del segundo producto",
  /email_template_upsell\?: \{/.test(config),
  "sí"
);
comprobar(
  "el guardado lo lee",
  /config\?\.email_template_upsell/.test(api),
  "sí"
);
comprobar(
  // Sin esto, se escribe en la pantalla y no llega nunca al archivo.
  "y lo escribe",
  /doc\.setIn\(\["email_template_upsell", key\]/.test(api),
  "sí"
);
comprobar(
  "y lo devuelve al editor",
  /email_upsell,/.test(api),
  "sí"
);

// ── 2. El motor elige la plantilla correcta ─────────────────────────────────
const envio = engine.match(
  /const isVipPurchase = convo\.order_bump_choice === "combo";[\s\S]*?const renderEmailText/
)?.[0] ?? "";
comprobar(
  "el envío distingue la compra del extra",
  /const esCompraDelExtra = convo\.upsell_state === "pagado";/.test(envio),
  "sí"
);
comprobar(
  // ESTE es el fallo. Sin esto sale el enlace del producto que ya compró.
  "y con ella usa la plantilla del extra",
  /const tpl = esCompraDelExtra\s*\r?\n\s*\? config\?\.email_template_upsell/.test(
    envio
  ),
  "la suya"
);
comprobar(
  // Callar es correcto: mejor nada que el acceso equivocado.
  "sin plantilla propia no cae a la de los otros",
  !/email_template_upsell\s*\?\?/.test(engine),
  "no manda nada"
);
comprobar(
  "y el registro dice cuál faltaba",
  /console\.warn\(`\[email\] \$\{cual\} no configurado/.test(engine) &&
    /console\.warn\(\s*\r?\n?\s*`\[email\] \$\{cual\} está vacío/.test(engine),
  "por su nombre"
);
comprobar(
  // Con el precio del primero, el correo del extra anuncia un importe que no
  // es el que se pagó.
  "el precio de los comodines sigue al producto del correo",
  /const price = esCompraDelExtra\s*\r?\n\s*\? getUpsellPriceSoles\(discountActive, convo\.phone, config\)/.test(
    engine
  ),
  "el del extra"
);
comprobar(
  "y las dos plantillas de siempre siguen igual",
  /: isVipPurchase\s*\r?\n\s*\? config\?\.email_template_vip\s*\r?\n\s*: config\?\.email_template;/.test(
    engine
  ),
  "intactas"
);

// ── 3. El cajón del editor ──────────────────────────────────────────────────
comprobar(
  "hay un cajón 📧 EMAIL POSTVENTA UPSELL",
  /<Collapsible title="📧 EMAIL POSTVENTA UPSELL">/.test(editor),
  "sí"
);
comprobar(
  // Regla 5-bis: cada modalidad se sirve de lo suyo. En Lineal u Order Bump no
  // hay segundo producto, y el cajón solo confundiría.
  "solo en las modalidades que tienen segundo producto",
  /activeEditorMode === "upsell" \|\|\s*\r?\n\s*activeEditorMode === "doble_oferta_upsell"/.test(
    editor
  ),
  "las dos"
);
comprobar(
  "con el mismo diseño que los otros dos",
  /value=\{cfg\.email_upsell\.from_name\}/.test(editor) &&
    /value=\{cfg\.email_upsell\.subject\}/.test(editor) &&
    /value=\{cfg\.email_upsell\.body\}/.test(editor) &&
    /fromName=\{cfg\.email_upsell\.from_name\}/.test(editor),
  "remitente, asunto, cuerpo y visor"
);
comprobar(
  // Extraerlo de "central" traería la entrega del PRIMER producto: el enlace
  // que el cliente ya tiene.
  "se extrae de la entrega del segundo producto",
  /if \(target === "upsell"\) return "upsell";/.test(editor),
  "la suya"
);
comprobar(
  "y avisa si está a medias",
  /Sin asunto o sin cuerpo <strong>no se envía nada<\/strong>/.test(editor),
  "en amarillo"
);
comprobar(
  // Sin esto, la plantilla de una modalidad se colaría en otra y le mandaría a
  // la clienta el acceso de otro producto (regla 5-bis).
  "no se hereda entre modalidades",
  /email_upsell: t\.email_upsell \?\? \{ \.\.\.CORREO_VACIO \}/.test(editor),
  "vacío"
);

// ── 4. El menú Regalo, en orden ─────────────────────────────────────────────
const botones = editor.indexOf("<GiftConsentButtonsEditor gift={g} onChange={setGift} />");
const burbujas = editor.indexOf("steps={g.consent_sequence}");
const rechazo = editor.indexOf('label="Mensaje si RECHAZA el regalo"');
comprobar(
  "los tres bloques del regalo están",
  [botones, burbujas, rechazo].every((p) => p > 0),
  "sí"
);
comprobar(
  // Estaban antes que la pregunta a la que responden.
  "los botones van DEBAJO de la burbuja que pregunta",
  botones > burbujas,
  "debajo"
);
comprobar(
  "y encima del mensaje de rechazo",
  botones < rechazo,
  "encima"
);
comprobar(
  "los bloques de Mensajes van separados por una raya",
  (editor.match(/<div className="border-t border-neutral-200 pt-4">/g) ?? [])
    .length >= 3,
  "tres rayas"
);

console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} comprobación(es) mal.`);
process.exit(fallos === 0 ? 0 : 1);
