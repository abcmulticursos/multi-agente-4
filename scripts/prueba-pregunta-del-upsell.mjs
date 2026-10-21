// La pregunta del upsell, en burbujas con su visor.
//
// ANTES
//
// «La pregunta del final: ¿deseas llevarlo?» era un textarea pelado de dos
// renglones. Sin visor, sin poder partirla en varias burbujas, sin foto ni
// audio antes, sin variantes. El único cajón de la pestaña que no se parecía a
// los demás.
//
// AHORA
//
// Es un cajón de burbujas como el de la intro de arriba, con su visor de
// WhatsApp al lado.
//
// LA REGLA
//
// La ÚLTIMA burbuja encendida es la pregunta: la que lleva los botones sí/no.
// Las de antes salen tal cual, en orden.
//
// Los botones de WhatsApp cuelgan de UN texto. Si la última burbuja fuera una
// foto no habría dónde ponerlos: entonces se mandan todas igual —no se pierde
// nada— y la pregunta sale del campo de texto de respaldo. El editor avisa en
// amarillo antes de que eso pase.
//
// LO QUE NO SE PIERDE
//
// Al abrir el editor, si todavía no hay burbujas se siembra una con la pregunta
// que ya estaba escrita. Sin eso el cajón se abriría vacío, parecería que se
// perdió, y al guardar se habría perdido de verdad.
//
//   node scripts/prueba-pregunta-del-upsell.mjs
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

// ── 1. El campo existe ──────────────────────────────────────────────────────
comprobar(
  "el motor conoce la pregunta en burbujas",
  /pregunta_steps\?: SequenceStep\[\];/.test(config),
  "sí"
);
comprobar(
  "y el editor",
  /pregunta_steps\?: EditorStep\[\];/.test(editor),
  "sí"
);

// ── 2. El motor: la última burbuja es la pregunta ───────────────────────────
const bloque =
  engine.match(
    /const burbujasDePregunta = [\s\S]*?const preguntaCruda =[\s\S]*?;\r?\n/
  )?.[0] ?? "";
comprobar(
  "el motor lee las burbujas de la pregunta",
  bloque.length > 0,
  "sí"
);
comprobar(
  "y salta las apagadas",
  /\.filter\(\s*\r?\n?\s*\(step\) => \(step as \{ enabled\?: boolean \}\)\.enabled !== false\s*\r?\n?\s*\)/.test(
    bloque
  ),
  "sí"
);
comprobar(
  // ESTA es la regla. Si se tomara la primera, la pregunta saldría antes que
  // el contenido que la prepara.
  "la pregunta es la ÚLTIMA burbuja",
  /burbujasDePregunta\[burbujasDePregunta\.length - 1\]/.test(bloque),
  "la última"
);
comprobar(
  "las de antes se mandan en orden, con su pausa",
  /const previas = ultimaEsTexto\s*\r?\n?\s*\? burbujasDePregunta\.slice\(0, -1\)\s*\r?\n?\s*: burbujasDePregunta;/.test(
    bloque
  ) && /await sendResponseStep\(convo, step as ResponseStep, precioDelExtra, true\);/.test(bloque),
  "sí"
);
comprobar(
  // Los botones cuelgan de un texto. Sin esta rama, una foto al final dejaría
  // la oferta sin pregunta y sin botones.
  "si la última no es texto, no se pierde ninguna burbuja",
  /const previas = ultimaEsTexto[\s\S]*?: burbujasDePregunta;/.test(bloque),
  "se mandan todas"
);
comprobar(
  "y queda escrito en el registro",
  /los botones no tienen dónde ir/.test(bloque),
  "avisa"
);
comprobar(
  // Sin este respaldo, quien no haya tocado el cajón se queda sin pregunta.
  // Ojo: solo cuando NO hay burbujas. Si las hay y están todas apagadas, no se
  // manda nada — lo comprueba prueba-apagar-la-pregunta-del-upsell.mjs.
  "sin burbujas se usa el texto de siempre",
  /: textoDeLaUltima\.trim\(\) \|\|\s*\r?\n\s*pickVariant\(up\.pregunta_variants, up\.pregunta\) \|\|/.test(
    bloque
  ),
  "intacto"
);
comprobar(
  "y de ahí en adelante todo sigue igual",
  /if \(up\.use_buttons\) \{/.test(engine) &&
    /if \(!mandada && pregunta\.trim\(\)\) \{/.test(engine),
  "botones y texto"
);

// ── 3. El guardado: leer sin perder, escribir sin desincronizar ─────────────
comprobar(
  "el guardado deja pasar las burbujas de la pregunta",
  (api.match(/pregunta_steps: readPreguntaSteps\((upCfg|duUp)\)/g) ?? []).length ===
    2,
  "las dos secciones"
);
comprobar(
  // Sin la siembra, el cajón se abre vacío y al guardar se pierde de verdad.
  "si aún no hay burbujas se siembra con la pregunta escrita",
  /if \(guardados\.length > 0\) return guardados;/.test(api) &&
    /texts: variantes\.length > 0 \? variantes : \[texto\]/.test(api),
  "no se pierde"
);
comprobar(
  "y las variantes viejas entran como variantes de la burbuja",
  /const variantes = strList\(u\?\.pregunta_variants\)/.test(api),
  "sí"
);
comprobar(
  "al guardar se escriben las dos secciones",
  (api.match(/\.\.\.writePregunta\((u|duU)\)/g) ?? []).length === 2,
  "las dos"
);
comprobar(
  // El campo suelto es el respaldo del motor. Si se quedara viejo, el bot
  // mandaría una pregunta que ya no está en ningún sitio del editor.
  "el texto de respaldo se deja al día con la última burbuja",
  /pregunta: \(ultimaEsTexto\s*\r?\n?\s*\? str\(textos\.find/.test(api),
  "sincronizado"
);
comprobar(
  // Una petición sin el campo no debe borrar la pregunta de siempre.
  "sin burbujas no se toca el texto de respaldo",
  /: str\(u\?\.pregunta\)/.test(api),
  "intacto"
);

// ── 4. El editor: cajón con visor, como los demás ───────────────────────────
comprobar(
  "ya no es un textarea pelado",
  !/value=\{cfg\.upsell\?\.pregunta \?\? ""\}/.test(editor),
  "quitado"
);
comprobar(
  "es un cajón de burbujas con su visor",
  /steps=\{cfg\.upsell\?\.pregunta_steps \?\? \[\]\}/.test(editor) &&
    /idPrefix="upsell_pregunta"/.test(editor),
  "sí"
);
comprobar(
  // Y ese precio pasa por el mismo camino que el motor: el del pais, la ficha
  // del puesto upsell y, solo al final, el guardado en la etapa. A pelo, el
  // visor enseñaba el numero que el motor reemplaza al arrancar.
  "con los precios del segundo producto en el visor",
  /idPrefix="upsell_pregunta"[\s\S]{0,300}priceSoles=\{precioDelUpsellEnElVisor\(cfg\)\}/.test(
    editor
  ),
  "los suyos"
);
comprobar(
  "y explica cuál de las burbujas es la pregunta",
  /es la pregunta: la\s*\r?\n?\s*que lleva los botones/.test(editor),
  "la última"
);
comprobar(
  "avisa si la última burbuja no es texto",
  /La última burbuja no es texto, y los botones necesitan un/.test(editor),
  "en amarillo"
);
comprobar(
  // Avisar "usará la de respaldo" sin decir que no hay ninguna sería peor que
  // no avisar: se quedaría tranquilo con una oferta muda.
  "y dice si tampoco hay pregunta de respaldo",
  /no hay ninguna, y no preguntará nada/.test(editor),
  "lo dice"
);

console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} comprobación(es) mal.`);
process.exit(fallos === 0 ? 0 : 1);
