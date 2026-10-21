// El comodín del enlace del anuncio: el visor tiene que decir la verdad.
//
// El motor, justo antes de enviar, sustituye {{ENLACE_ANUNCIO}} por el enlace
// del cajón; y si el cajón no tiene enlace, DESCARTA la variación entera.
//
// Esta prueba compara las dos mitades para que no puedan divergir:
//   - lo que hace el motor  (renderGiftVariantText, en engine.ts)
//   - lo que hace el editor (replaceGiftAdLinkPlaceholder, en page.tsx)
//
//   node scripts/prueba-enlace-anuncio.mjs
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const RAIZ = process.cwd();
const TMP = join(RAIZ, "scripts", "_tmp-enlace");
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

/** Extrae una función del archivo, tal como está escrita hoy. */
function extraer(archivo, nombre) {
  const fuente = readFileSync(join(RAIZ, archivo), "utf8");
  const desde = fuente.indexOf(`function ${nombre}`);
  if (desde < 0) throw new Error(`no encontré ${nombre} en ${archivo}`);
  const hasta = fuente.indexOf("\n}", desde);
  if (hasta < 0) throw new Error(`no encontré el final de ${nombre}`);
  return fuente
    .slice(desde, hasta + 2)
    .replace(/: GiftTextVariant/g, "")
    .replace(/: string \| null/g, "")
    .replace(/\(text: string, link\?: string\)/g, "(text, link)")
    .replace(/: string/g, "");
}

writeFileSync(
  join(TMP, "m.mjs"),
  [
    "const GIFT_AD_LINK_PLACEHOLDER = '{{ENLACE_ANUNCIO}}';",
    `export ${extraer("src/lib/workflow/engine.ts", "renderGiftVariantText")}`,
    `export ${extraer("src/app/editor/page.tsx", "replaceGiftAdLinkPlaceholder")}`,
  ].join("\n\n"),
  "utf8"
);
const { renderGiftVariantText, replaceGiftAdLinkPlaceholder } = await import(
  pathToFileURL(join(TMP, "m.mjs")).href
);

const ENLACE = "https://facebook.com/post/123";
let fallos = 0;
const comprobar = (nombre, ok, detalle = "") => {
  if (!ok) fallos++;
  console.log(`${ok ? "ok   " : "FALLA"} ${nombre}${detalle ? `  ${detalle}` : ""}`);
};

// 1. Con comodín y con enlace: el motor lo sustituye, y el visor igual.
{
  const texto = "Comenta aquí: {{ENLACE_ANUNCIO}} y te mando el PDF";
  const delMotor = renderGiftVariantText({ text: texto, ad_link: ENLACE });
  const delVisor = replaceGiftAdLinkPlaceholder(texto, ENLACE);
  comprobar(
    "con enlace: el visor muestra lo mismo que envía el motor",
    delMotor === delVisor && delMotor.includes(ENLACE) && !delMotor.includes("{{"),
    delMotor
  );
}

// 2. Con comodín y SIN enlace: el motor descarta la variación entera.
{
  const texto = "Comenta aquí: {{ENLACE_ANUNCIO}}";
  const delMotor = renderGiftVariantText({ text: texto, ad_link: "" });
  comprobar(
    "sin enlace: el motor descarta la variación (no la envía)",
    delMotor === null,
    String(delMotor)
  );
}

// 3. Sin comodín: se envía tal cual, con o sin enlace.
{
  const texto = "Comenta en el post y te mando el PDF";
  comprobar(
    "sin comodín: sale tal cual",
    renderGiftVariantText({ text: texto }) === texto
  );
}

// 4. Varias apariciones del comodín: se sustituyen todas.
{
  const texto = "{{ENLACE_ANUNCIO}} — o entra por aquí: {{ENLACE_ANUNCIO}}";
  const delMotor = renderGiftVariantText({ text: texto, ad_link: ENLACE });
  const delVisor = replaceGiftAdLinkPlaceholder(texto, ENLACE);
  comprobar(
    "varias veces: se sustituyen todas, y en los dos igual",
    delMotor === delVisor && !delMotor.includes("{{ENLACE_ANUNCIO}}"),
    delMotor
  );
}

// 5. Un texto con plantilla a medias (<<...>>) no se envía.
{
  comprobar(
    "texto de plantilla sin rellenar: no se envía",
    renderGiftVariantText({ text: "<<PONER TEXTO>>" }) === null
  );
}

rmSync(TMP, { recursive: true, force: true });
console.log(fallos === 0 ? "\nLos 5 casos correctos." : `\n${fallos} mal.`);
process.exit(fallos === 0 ? 0 : 1);
