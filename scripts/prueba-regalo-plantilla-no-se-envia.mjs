// La PLANTILLA del regalo nunca se envía a un cliente.
//
// Es el molde del que salen los cajones por anuncio, pero estaba entrando en
// el sorteo como una variación más: conserva peso, y si alguien le pulsó
// "Añadir enlace" también conserva enlace, así que su texto se resolvía y
// salía tal cual. Y arrastra los ad_ids del cajón del que se hizo, con lo que
// podía ganarle al cajón de verdad por coincidencia de anuncio.
//
//   node scripts/prueba-regalo-plantilla-no-se-envia.mjs
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const RAIZ = process.cwd();
const TMP = join(RAIZ, "scripts", "_tmp-plantilla-envio");
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

// Se toman las funciones del motor TAL COMO ESTÁN escritas, con sus tipos, y
// se compilan. Así la prueba mira el código de verdad, no una copia.
// A LF: los dos proyectos no usan el mismo fin de línea y aquí se busca por
// saltos exactos.
const fuente = readFileSync(join(RAIZ, "src/lib/workflow/engine.ts"), "utf8").replace(
  /\r\n/g,
  "\n"
);
function extraer(nombre) {
  const desde = fuente.indexOf(`function ${nombre}`);
  if (desde < 0) throw new Error(`no encontré ${nombre} en engine.ts`);
  // El final es una línea que es SOLO "}". Buscar "\n}" a secas se paraba en
  // la llave que cierra un parámetro escrito en varias líneas.
  const hasta = fuente.indexOf("\n}\n", desde);
  if (hasta < 0) throw new Error(`no encontré el final de ${nombre}`);
  return fuente.slice(desde, hasta + 3);
}
const tipo = fuente.slice(
  fuente.indexOf("type GiftTextVariant = {"),
  fuente.indexOf("};", fuente.indexOf("type GiftTextVariant = {")) + 2
);

writeFileSync(
  join(TMP, "m.ts"),
  [
    "const GIFT_AD_LINK_PLACEHOLDER = '{{ENLACE_ANUNCIO}}';",
    tipo,
    `export ${extraer("getUsableGiftVariants")}`,
    `export ${extraer("renderGiftVariantText")}`,
    `export ${extraer("pickGiftTextByAd")}`,
    `export ${extraer("pickWeightedGiftText")}`,
  ].join("\n\n"),
  "utf8"
);
try {
  execFileSync(
    process.execPath,
    [
      join(RAIZ, "node_modules", "typescript", "bin", "tsc"),
      join(TMP, "m.ts"),
      "--outDir",
      TMP,
      "--module",
      "esnext",
      "--target",
      "es2022",
      "--skipLibCheck",
    ],
    { stdio: "pipe" }
  );
} catch {
  // Los tipos ambientales del proyecto se quejan aquí y no pintan nada.
}
const { getUsableGiftVariants, pickGiftTextByAd, pickWeightedGiftText } =
  await import(pathToFileURL(join(TMP, "m.js")).href);

const AD = "120249236901590336";
const ENLACE = "https://facebook.com/posts/999";

// La plantilla tal como está hoy en la configuración publicada: encendida,
// con peso, con enlace y arrastrando el ad_ids del cajón del que se hizo.
const plantilla = {
  weight: 20,
  text: "MOLDE: entra a {{ENLACE_ANUNCIO}} y comenta",
  ad_ids: [AD],
  ad_link: ENLACE,
  registry_template: true,
};
const cajonDelAnuncio = {
  weight: 20,
  text: "CAJON REAL: entra a {{ENLACE_ANUNCIO}} y comenta",
  ad_ids: [AD],
  ad_link: ENLACE,
  registry_ad_id: AD,
};
const otro = {
  weight: 20,
  text: "OTRO CAJON",
  ad_ids: [],
  registry_ad_id: "999",
};

const gift = {
  ask_text_variants: [plantilla, cajonDelAnuncio, otro],
};

let fallos = 0;
const comprobar = (nombre, ok, detalle = "") => {
  if (!ok) fallos++;
  console.log(`${ok ? "ok   " : "FALLA"} ${nombre}${detalle ? `  → ${detalle}` : ""}`);
};

const usables = getUsableGiftVariants(gift);
comprobar(
  "la plantilla queda fuera de las enviables",
  !usables.some((v) => v.registry_template === true),
  `quedan ${usables.length} de ${gift.ask_text_variants.length}`
);

comprobar(
  "los cajones de verdad siguen ahí",
  usables.length === 2
);

// Por coincidencia de anuncio: tiene que ganar el cajón real, no el molde.
comprobar(
  "por anuncio: sale el cajón real, no el molde",
  (pickGiftTextByAd(usables, AD) ?? "").startsWith("CAJON REAL"),
  pickGiftTextByAd(usables, AD)
);

// En el sorteo por peso, el molde no puede salir nunca. Se tira muchas veces.
{
  let salioElMolde = false;
  for (let i = 0; i < 500; i++) {
    const texto = pickWeightedGiftText(usables) ?? "";
    if (texto.startsWith("MOLDE")) salioElMolde = true;
  }
  comprobar("en 500 sorteos, el molde no sale ni una vez", !salioElMolde);
}

// Con la sincronización apagada, tampoco.
{
  const usablesSinSync = getUsableGiftVariants({
    ...gift,
    registry_sync_enabled: false,
  });
  comprobar(
    "con la sincronización apagada, el molde sigue fuera",
    !usablesSinSync.some((v) => v.registry_template === true),
    `quedan ${usablesSinSync.length}`
  );
}

// Y lo que ya funcionaba sigue funcionando: un cajón apagado no se envía.
{
  const conApagado = getUsableGiftVariants({
    ask_text_variants: [
      { ...cajonDelAnuncio, enabled: false },
      { ...otro, text: "EL UNICO ENCENDIDO" },
    ],
  });
  let salioElApagado = false;
  for (let i = 0; i < 200; i++) {
    if ((pickWeightedGiftText(conApagado) ?? "").startsWith("CAJON REAL")) {
      salioElApagado = true;
    }
  }
  comprobar("un cajón apagado sigue sin enviarse", !salioElApagado);
}

rmSync(TMP, { recursive: true, force: true });
console.log(fallos === 0 ? "\nLos 6 casos correctos." : `\n${fallos} mal.`);
process.exit(fallos === 0 ? 0 : 1);
