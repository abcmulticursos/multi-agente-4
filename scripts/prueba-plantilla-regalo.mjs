// ¿Qué variación genera los cajones por anuncio del regalo?
//
// El caso que motivó esto: apagar la original, sacar una copia modificada y
// encendida, y ver que los cajones nuevos seguían saliendo de la apagada. En
// pantalla una cosa, por dentro otra.
//
//   node scripts/prueba-plantilla-regalo.mjs
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const RAIZ = process.cwd();
const TMP = join(RAIZ, "scripts", "_tmp-plantilla");
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

// Se extrae la función del editor tal cual está escrita, sin copiarla: si
// alguien la cambia, esta prueba prueba la nueva.
const fuente = readFileSync(join(RAIZ, "src/app/editor/page.tsx"), "utf8");
const desde = fuente.indexOf("function elegirPlantillaBase");
if (desde < 0) throw new Error("no encontré elegirPlantillaBase en el editor");
const hasta = fuente.indexOf("\n}", desde);
if (hasta < 0) throw new Error("no encontré su final");
const cuerpo = fuente
  .slice(desde, hasta + 2)
  // Fuera los tipos: aquí se ejecuta como JavaScript.
  .replace(/: GiftVariant\[\]/g, "")
  .replace(/: GiftVariant \| undefined/g, "")
  .replace(/\(v: GiftVariant\)/g, "(v)");
writeFileSync(join(TMP, "m.mjs"), `export ${cuerpo}\n`, "utf8");
const { elegirPlantillaBase } = await import(
  pathToFileURL(join(TMP, "m.mjs")).href
);

const marcada = (extra = {}) => ({
  text: "ORIGINAL",
  registry_template: true,
  ...extra,
});
const copia = (extra = {}) => ({ text: "COPIA", ...extra });
const deAnuncio = (extra = {}) => ({
  text: "CAJON DE ANUNCIO",
  registry_ad_id: "123",
  ...extra,
});
const separador = () => ({ text: "", separator: "Campaña" });

let fallos = 0;
const comprobar = (nombre, real, esperado) => {
  const ok = real === esperado;
  if (!ok) fallos++;
  console.log(
    `${ok ? "ok   " : "FALLA"} ${(nombre + " ".repeat(52)).slice(0, 52)} genera: ${real}` +
      (ok ? "" : `  (esperaba ${esperado})`)
  );
};

const cual = (variants) => elegirPlantillaBase(variants)?.text ?? "(ninguna)";

comprobar(
  "solo la original: manda ella",
  cual([marcada(), deAnuncio()]),
  "ORIGINAL"
);

comprobar(
  "original encendida + copia: manda la original",
  cual([marcada(), copia(), deAnuncio()]),
  "ORIGINAL"
);

// EL CASO DEL RECLAMO.
comprobar(
  "original APAGADA + copia encendida: manda la copia",
  cual([marcada({ enabled: false }), copia({ enabled: true }), deAnuncio()]),
  "COPIA"
);

comprobar(
  "original apagada y la copia también: manda la original igual",
  cual([marcada({ enabled: false }), copia({ enabled: false })]),
  "ORIGINAL"
);

comprobar(
  "sin marca: manda la primera encendida",
  cual([copia({ text: "PRIMERA", enabled: false }), copia({ text: "SEGUNDA" })]),
  "SEGUNDA"
);

comprobar(
  "un separador nunca puede ser la base",
  cual([separador(), copia()]),
  "COPIA"
);

comprobar(
  "un cajón de anuncio nunca puede ser la base",
  cual([deAnuncio(), copia()]),
  "COPIA"
);

comprobar(
  "sin ninguna candidata: no hay base",
  cual([deAnuncio(), separador()]),
  "(ninguna)"
);

// Nunca se queda sin generar por tener todo apagado.
comprobar(
  "todo apagado: sigue habiendo base",
  cual([copia({ text: "UNICA", enabled: false })]),
  "UNICA"
);

rmSync(TMP, { recursive: true, force: true });
console.log(fallos === 0 ? "\nLos 9 casos correctos." : `\n${fallos} mal.`);
process.exit(fallos === 0 ? 0 : 1);
