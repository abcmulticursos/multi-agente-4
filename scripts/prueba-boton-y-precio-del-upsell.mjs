// El boton que mentia, el precio que cobraba de menos, y el silencio invisible.
//
// 1. EL PRECIO DEL SEGUNDO PRODUCTO ERA EL DE LA PRIMERA COMPRA
//
// {{METODO_DE_PAGO_1}} no es un dato: es un TEXTO que el operador escribe por
// pais, y ese texto lleva dentro sus propios comodines de precio. Se abria
// tarde, dentro del envio, donde el precio de ESTE paso ya no existe — asi que
// el {{PRECIO_COMPLETO}} de dentro del cajon se resolvia con el precio del
// curso.
//
// Se veia asi: se aceptaba el segundo producto de 7.500 y los datos de pago
// pedian 6.000, que era lo que el cliente ya habia pagado. No da error, no
// avisa: cobra de menos y queda un comprobante correcto por el monto que no era.
//
// 2. EL BOTON MANDABA EL NOMBRE DEL PRODUCTO
//
// WhatsApp no manda el boton: manda su TEXTO. El bot lo cambiaba por el nombre
// del producto para poder reconocerlo, y en la conversacion quedaba escrito
// algo que el cliente nunca escribio: tocaba «Si, lo quiero» y en el chat se
// leia «PRODUCTO UPSELL». Al revisar un chat para entender que paso, eso
// engana.
//
// Los del Order Bump SI se siguen traduciendo, y por un motivo distinto: ahi el
// titulo ES el nombre del producto, solo que WhatsApp lo corta a 20 caracteres.
// No se cambia por otra cosa, se completa — y sin completarlo la eleccion no se
// reconoce y el pago se valida contra el precio equivocado.
//
// 3. EL SILENCIO NO SE VEIA EN NINGUN LADO
//
// Si el motor no atendia el turno y el modelo devolvia vacio, no se enviaba
// nada y tampoco se escribia nada en el registro. Desde fuera el bot no
// contesta; desde dentro no hay ni una linea que lo explique.
//
// Corre sobre el CODIGO REAL para la parte del boton.
//
//   node scripts/prueba-boton-y-precio-del-upsell.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");

const engine = leer("src", "lib", "workflow", "engine.ts");
const sender = leer("src", "lib", "workflow", "sender.ts");
const handler = leer("src", "lib", "meta", "handler.ts");
const cerebro = leer("src", "lib", "openrouter.ts");
const config = leer("src", "lib", "workflow", "config.ts");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// ── 1. El cajón de pago del país se abre a tiempo ───────────────────────────
comprobar(
  "abrir el cajón del país es una función aparte",
  /export function expandirCajonesDePagoDelPais\(/.test(sender),
  "un solo sitio"
);
comprobar(
  // ESTE es el fallo. Si vuelve a abrirse solo dentro del envío, el precio del
  // segundo producto vuelve a ser el de la primera compra.
  "el motor lo abre ANTES de resolver el precio del paso",
  /const conCajones = expandirCajonesDePagoDelPais\(t, convo\);/.test(engine) &&
    engine.indexOf("const conCajones = expandirCajonesDePagoDelPais") <
      engine.indexOf("return applyPriceTemplate(withTwoTier, price, convo);"),
  "primero el cajón"
);
comprobar(
  "y el precio del paso es el que se le pasa, no el del curso",
  /const price =\s*\r?\n?\s*priceOverride \?\?/.test(engine),
  "el del paso"
);
comprobar(
  "el envío sigue abriéndolo también, para lo que no pasa por el motor",
  /const withInserts = expandirCajonesDePagoDelPais\(text, convo\);/.test(sender),
  "sí"
);
comprobar(
  "el upsell manda SU precio",
  /const precio = getUpsellPriceSoles\(descuento, convo\.phone\) \?\? undefined;/.test(
    engine
  ) && /priceSoles: precio,/.test(engine),
  "el suyo"
);

// ── 2. El botón manda lo que dice el botón ──────────────────────────────────
comprobar(
  "el botón del upsell manda su propio texto",
  /\} else if \(id === "upsell_si" \|\| id === "upsell_no"\) \{[\s\S]{0,900}?text = title\.trim\(\);/.test(
    handler
  ),
  "el título"
);
comprobar(
  "y ya no lo cambia por el nombre del producto",
  !/text = id === "upsell_si" \? up\?\.name\?\.trim\(\) \|\| title : "no";/.test(
    handler
  ),
  "fuera"
);
comprobar(
  // Los del Order Bump son otro caso: el título YA es el nombre, solo que
  // cortado. Cambiarlos rompería la validación del pago.
  "los del Order Bump siguen completándose",
  /const opt = id === "ob_combo" \? ob\?\.combo : ob\?\.basico;\s*\r?\n\s*text = opt\?\.name\?\.trim\(\) \|\| title\.trim\(\);/.test(
    handler
  ),
  "intactos"
);
comprobar(
  "el motor reconoce el botón por su etiqueta configurada",
  /export function botonDelUpsell\(/.test(config) &&
    /const tocoUnBoton = botonDelUpsell\(msgContent, config\);/.test(engine),
  "exacto"
);
comprobar(
  "el sí y el no del botón van antes que todo lo demás",
  engine.indexOf("const tocoUnBoton = botonDelUpsell") <
    engine.indexOf("if (detectaAceptacionDeUpsell(msgContent, config))"),
  "primero"
);
comprobar(
  // Un "no" por botón es inequívoco: no puede depender de si el regalo ya salió.
  // Desde que los cuadritos de la oferta funcionan, las dos ramas del "no" pasan
  // por el mismo ayudante — el que manda las burbujas del cuadrito si lo hay y
  // cierra siempre. Lo que se vigila es lo mismo: que el botón cierre sin
  // condiciones.
  "el no por botón no depende de si ya salió el regalo",
  /if \(tocoUnBoton === "no"\) \{[\s\S]{0,240}?await rechazarConSuCuadrito\(\);/.test(
    engine
  ),
  "siempre vale"
);
comprobar(
  // Antes eran dos llamadas iguales, una por rama. Ahora es UNA sola, dentro del
  // ayudante: cerrar la venta por un "no" ocurre en un unico sitio del codigo.
  "cerrar por un no está en un solo sitio",
  /async function rechazarUpsell\(/.test(engine) &&
    (engine.match(/await rechazarUpsell\(convo, config/g) ?? []).length === 1,
  "sin duplicar"
);
comprobar(
  "un botón antiguo no inicia el regalo por segunda vez",
  /const regaloPendiente = hasPendingActionType\([\s\S]{0,100}ACTION_UPSELL_TIMEOUT[\s\S]{0,500}if \(regaloPendiente\) seguirConRegalo\(convo\.id\);/.test(
    engine
  ),
  "solo si estaba pendiente"
);

// ── 3. Y que la etiqueta se reconozca de verdad ─────────────────────────────
const TMP = join(RAIZ, "scripts", "_tmp-boton");
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
writeFileSync(
  join(TMP, "limpiar.js"),
  // Se copia SOLO la normalización, que es la parte con riesgo: el resto de
  // botonDelUpsell arrastra media configuración y no se puede cargar suelto.
  `const limpiar = (t) => (t ?? "").toLowerCase().normalize("NFD").replace(/\\p{Mn}/gu, "").replace(/[^\\p{L}\\p{N}]+/gu, " ").trim();
module.exports = { limpiar };`,
  "utf8"
);
const require = createRequire(import.meta.url);
const { limpiar } = require(join(TMP, "limpiar.js"));

comprobar(
  "la misma normalización que usa el código",
  /\.replace\(\/\[\^\\p\{L\}\\p\{N\}\]\+\/gu, " "\)/.test(config),
  "copiada"
);
for (const [etiqueta, recibido, porque] of [
  ["✅ Sí, lo quiero", "✅ Sí, lo quiero", "igual"],
  ["✅ Sí, lo quiero", "Si lo quiero", "sin emoji ni tilde"],
  ["❌ No, gracias", "❌ No, gracias", "el no"],
  ["Dale", "Dale", "etiqueta libre"],
]) {
  comprobar(
    `reconoce «${etiqueta}» (${porque})`,
    limpiar(etiqueta) === limpiar(recibido),
    "sí"
  );
}
comprobar(
  // WhatsApp corta el título a 20 caracteres: con una etiqueta más larga vuelve
  // recortada y una comparación literal fallaría justo en el "sí".
  "acepta la etiqueta cortada a 20 caracteres",
  /const formas = \[limpiar\(cruda\), limpiar\(cruda\.slice\(0, 20\)\)\];/.test(
    config
  ),
  "las dos formas"
);
comprobar(
  "dos etiquetas distintas NO se confunden",
  limpiar("✅ Sí, lo quiero") !== limpiar("❌ No, gracias"),
  "distintas"
);
rmSync(TMP, { recursive: true, force: true });

// ── 4. El silencio deja rastro ──────────────────────────────────────────────
comprobar(
  "si nadie contesta, queda escrito",
  /SIN RESPUESTA\. El motor no atendió el turno y el modelo devolvió vacío/.test(
    handler
  ),
  "en el registro"
);
comprobar(
  "con el estado y lo que dijo el cliente",
  /estado=\$\{fresh\.state\} cliente="\$\{content\.slice\(0, 80\)\}"/.test(
    handler
  ),
  "diagnosticable"
);
comprobar(
  // No se inventa una respuesta: no hay ninguna correcta siempre. Pero al
  // modelo se le pide explícitamente que no devuelva vacío.
  "al modelo se le prohíbe contestar vacío en postventa",
  (cerebro.match(/never reply with an empty message/g) ?? []).length === 2,
  "los dos estados"
);

console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} comprobación(es) mal.`);
process.exit(fallos === 0 ? 0 : 1);
