// Habia UN solo precio anterior para tres productos.
//
// El precio anterior es el numero tachado que hace ver la rebaja: "antes
// $18.000, hoy $7.000". Sin el, la oferta es solo un precio; con el, es un
// descuento.
//
// Pero era uno por pais. En Doble Oferta + Upsell hay TRES productos que valen
// distinto, y los tres mostraban el mismo "antes". Si en la intro se presentan
// el basico y el full uno debajo del otro, al full le salia el "antes" del
// basico y su descuento parecia mas chico de lo que era.
//
// Ahora cada producto lee el suyo, guardado junto a su precio:
//
//   {{PRECIO_MERCADO_BASICO}}   el de siempre (vive junto a course_price_soles)
//   {{PRECIO_MERCADO_FULL}}     order_bump.combo_market_price   (campo nuevo)
//   {{PRECIO_MERCADO_UPSELL}}   upsell.market_price             (campo nuevo)
//
// {{PRECIO_MERCADO}} NO cambia: sigue valiendo lo mismo que antes, asi que los
// 43 textos que ya lo usan siguen imprimiendo el mismo numero.
//
// DOS TRAMPAS QUE ESTA PRUEBA VIGILA
//
// 1. El orden. Los tres nombres largos tienen que sustituirse ANTES que
//    {{PRECIO_MERCADO}} a secas; si no, el generico se come su principio y en
//    el mensaje queda "_FULL" suelto.
// 2. El guardado. La API mapea los campos del perfil de pais UNO POR UNO. Un
//    campo que no este en esa lista se descarta al guardar: la casilla del
//    editor se ve llena, el comodin sale vacio, y nadie entiende por que.
//
//   node scripts/prueba-precio-anterior-por-producto.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");

const engine = leer("src", "lib", "workflow", "engine.ts");
const config = leer("src", "lib", "workflow", "config.ts");
const editor = leer("src", "app", "editor", "page.tsx");
const api = leer("src", "app", "api", "workflow", "route.ts");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// ── 1. Los tres campos existen donde vive cada precio ──────────────────────
comprobar(
  "el full tiene su precio anterior",
  /combo_market_price\?: number;/.test(config),
  "order_bump.combo_market_price"
);
comprobar(
  "el extra tiene el suyo",
  /upsell\?: \{[\s\S]{0,320}market_price\?: number;/.test(config),
  "upsell.market_price"
);

// ── 2. El motor los resuelve, y cada uno con lo suyo ───────────────────────
comprobar(
  "el del basico es el de siempre",
  /const precioMercadoBasico = precioMercadoCompleto;/.test(engine),
  "mismo valor que {{PRECIO_MERCADO}}"
);
comprobar(
  "el del full sale de su propio campo",
  /const precioMercadoFull = conMoneda\(perfilDelPais\?\.order_bump\?\.combo_market_price\);/.test(
    engine
  ),
  "combo_market_price"
);
comprobar(
  "el del extra sale del suyo",
  /const precioMercadoUpsell = conMoneda\([\s\S]{0,140}upsell\?\.market_price/.test(
    engine
  ),
  "upsell.market_price"
);
comprobar(
  // Vacio no imprime nada: un precio anterior equivocado no se ve, solo hace
  // que la oferta mienta.
  "vacio no imprime nada, nunca el de otro producto",
  /valor > 0\s*\r?\n?\s*\? formatCurrencyAmount\(valor, countryCode\)\s*\r?\n?\s*: "";/.test(
    engine
  ),
  "sin herencia"
);

// ── 3. EL ORDEN: los largos antes que el generico ──────────────────────────
const iBasico = engine.indexOf("precio_mercado_basico");
const iFull = engine.indexOf("precio_mercado_full");
const iUpsell = engine.indexOf("precio_mercado_upsell");
const iGenerico = engine.indexOf("precio_mercado|precio_anterior|precio_referencial");
comprobar(
  "los tres se sustituyen ANTES que {{PRECIO_MERCADO}}",
  iBasico > 0 &&
    iFull > 0 &&
    iUpsell > 0 &&
    iGenerico > 0 &&
    iBasico < iGenerico &&
    iFull < iGenerico &&
    iUpsell < iGenerico,
  "primero los largos"
);

// ── 4. EL GUARDADO: la API no puede tirarlos ───────────────────────────────
comprobar(
  "la API guarda el precio anterior del full",
  (api.match(/combo_market_price: num\(/g) ?? []).length >= 2,
  `${(api.match(/combo_market_price: num\(/g) ?? []).length} sitios`
);
comprobar(
  "y el del extra",
  (api.match(/market_price: num\(\(p\?\.upsell/g) ?? []).length >= 2,
  `${(api.match(/market_price: num\(\(p\?\.upsell/g) ?? []).length} sitios`
);

// ── 5. El editor: casilla, comodin y vista previa ──────────────────────────
comprobar(
  "hay casilla para el precio anterior del full",
  /Precio anterior del full \(\$\{country\.currency\}\)/.test(editor),
  "en Precios y pagos"
);
comprobar(
  "y para el del upsell",
  /Precio anterior del upsell \(\$\{country\.currency\}\)/.test(editor),
  "en Precios y pagos"
);
for (const token of [
  "{{PRECIO_MERCADO_BASICO}}",
  "{{PRECIO_MERCADO_FULL}}",
  "{{PRECIO_MERCADO_UPSELL}}",
]) {
  comprobar(
    `${token} se ofrece en la lista`,
    editor.includes(`token: "${token}"`),
    "en el selector"
  );
}
comprobar(
  "la vista previa los resuelve",
  /previewMercado\(marketPrice, "del básico"\)/.test(editor) &&
    /previewMercado\(marketPriceFull, "del full"\)/.test(editor) &&
    /previewMercado\(marketPriceUpsell, "del extra"\)/.test(editor),
  "los tres"
);
comprobar(
  // Sin valor, en el EDITOR se avisa. En el mensaje real no sale nada.
  "y avisa en el editor cuando falta el dato",
  /\[Precio anterior \$\{cual\} sin configurar\]/.test(editor),
  "aviso claro"
);

// ── 6. Lo que NO cambia ────────────────────────────────────────────────────
comprobar(
  "{{PRECIO_MERCADO}} sigue valiendo lo mismo",
  /precio_mercado\|precio_anterior\|precio_referencial\|market_price\|previous_price/.test(
    engine
  ) && /literal\(precioMercadoCompleto\)/.test(engine),
  "43 textos intactos"
);
comprobar(
  "cada modalidad ve solo los suyos",
  /PRECIO_MERCADO_BASICO\|PRECIO_MERCADO_FULL/.test(editor) &&
    /PRECIO_MERCADO_UPSELL/.test(editor),
  "filtrados"
);

console.log(
  fallos === 0
    ? "\nTODO OK — cada producto tiene su propio precio anterior"
    : `\n${fallos} FALLA(S)`
);
process.exit(fallos === 0 ? 0 : 1);
