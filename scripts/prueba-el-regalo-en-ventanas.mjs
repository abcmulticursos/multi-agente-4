// La pestaña Regalo: tres barras con su ventana.
//
// COMO ESTABA
//
//   Cuatro secciones abiertas de par en par, una debajo de otra: el tiempo, los
//   mensajes, los regalos por anuncio y las variaciones del enlace.
//
//   La ultima es larguisima —una tarjeta por variacion, con su peso, su
//   etiqueta, sus IDs y su textarea—, asi que para llegar a ella habia que pasar
//   por encima de todo lo demas cada vez. Y para volver al mensaje de
//   recompensa, lo mismo al reves.
//
// COMO QUEDA
//
//     · Tiempo y mensajes del regalo. Van juntos porque son el mismo asunto:
//       que se le dice al cliente y cuando. Desde el silencio antes de ofrecer
//       hasta el mensaje de recompensa.
//     · Regalos por anuncio.
//     · Plantilla y variaciones manuales del enlace.
//
//   Las dos ultimas son de los enlaces, que es otra cosa.
//
// LO QUE NO PUEDE PASAR
//
//   Que al mover bloques se caiga uno. No da error: simplemente deja de estar
//   en pantalla, y lo que se editaba ahi ya no se puede editar en ninguna parte.
//
//   node scripts/prueba-el-regalo-en-ventanas.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const editor = readFileSync(join(RAIZ, "src", "app", "editor", "page.tsx"), "utf8");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

const pestana = (() => {
  const i = editor.indexOf("function GiftTab(");
  const f = editor.indexOf("function SyncedGiftAdCard(", i);
  return i < 0 || f < 0 ? "" : editor.slice(i, f);
})();
comprobar("se encuentra la pestaña", pestana.length > 0, "GiftTab");

// -- 1. LAS TRES BARRAS ------------------------------------------------------
const barras = [
  [
    "mensajes de regalo",
    /title="🎁 Mensajes de regalo"\s*\r?\n\s*titleKey="regalo_tiempo_y_mensajes"\s*\r?\n\s*enVentana/,
  ],
  [
    "regalos por anuncio",
    /title="📣 Regalos por anuncio"\s*\r?\n\s*titleKey="regalo_por_anuncio"\s*\r?\n\s*enVentana/,
  ],
  [
    "plantilla y variaciones",
    /title="🔗 Plantilla y variaciones manuales del enlace"\s*\r?\n\s*titleKey="regalo_variaciones_enlace"\s*\r?\n\s*enVentana/,
  ],
];
for (const [nombre, patron] of barras) {
  comprobar(`barra: ${nombre}`, patron.test(pestana), "con su ventana");
}
// Las tres de arriba, y ninguna mas en ventana. Los cajones anidados de dentro
// —BM, Cuenta, Campaña— siguen siendo desplegables normales: son una jerarquia
// para mirar, no secciones que abrir.
comprobar(
  "y solo esas tres abren ventana",
  (pestana.match(/\benVentana\b/g) ?? []).length === 3,
  "los anidados se despliegan"
);

// -- 2. NO SE CAYO NINGUN BLOQUE ---------------------------------------------
const dentro = [
  ["el silencio antes de ofrecer", "Silencio antes de ofrecer el regalo (seg)"],
  ["la pregunta de consentimiento", 'idPrefix="gift_consent"'],
  ["los botones del consentimiento", "<GiftConsentButtonsEditor"],
  ["el mensaje si rechaza", "Mensaje si RECHAZA el regalo"],
  ["la secuencia al aceptar", 'idPrefix="gift_sequence"'],
  ["el mensaje de recompensa", "Mensaje de recompensa (con el enlace del PDF"],
  ["los regalos por anuncio", "<SyncedGiftAdCard"],
  ["el interruptor de sincronizados", "Regalos sincronizados: "],
  ["restaurar variaciones anteriores", "Restaurar variaciones anteriores"],
  ["agregar variación de enlace", "➕ Agregar variación de enlace"],
  ["agregar separador", "➕ Agregar separador"],
  ["el visor de una variación", "<VisorDeVariacion"],
];
for (const [nombre, aguja] of dentro) {
  comprobar(`sigue estando: ${nombre}`, pestana.includes(aguja), "no se cayó");
}

// -- 3. LOS TITULOS VIEJOS NO SE QUEDAN DUPLICADOS ---------------------------
//
// El titulo de la barra ya nombra la seccion. Dejar ademas el h2 de dentro
// haria leer el mismo nombre dos veces, una en la barra y otra al abrirla.
comprobar(
  "«Regalos por anuncio» no se dice dos veces",
  !/<h2 className="mb-1 text-base font-bold text-neutral-900">Regalos por anuncio<\/h2>/.test(
    pestana
  ),
  "lo dice la barra"
);
comprobar(
  "«Plantilla y variaciones» tampoco",
  !/<h2 className="mb-1 text-base font-bold text-neutral-900">\s*\r?\n\s*Plantilla y variaciones manuales del enlace/.test(
    pestana
  ),
  "lo dice la barra"
);
// «Tiempo» y «Mensajes» SI se quedan: son dos asuntos dentro de la misma
// ventana, y sin sus rotulos la ventana seria una lista sin costuras.
comprobar(
  "pero «Tiempo» y «Mensajes» sí, que son dos dentro de una",
  /<h2 className="mb-3 text-base font-bold text-neutral-900">Tiempo<\/h2>/.test(
    pestana
  ) &&
    /<h2 className="text-base font-bold text-neutral-900">Mensajes<\/h2>/.test(
      pestana
    ),
  "separan dentro"
);

console.log(fallos === 0 ? "\nTODO OK" : `\n${fallos} FALLO(S)`);
process.exit(fallos === 0 ? 0 : 1);
