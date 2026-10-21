// La palabra "[image]" que salia debajo de las imagenes.
//
// Cada mensaje guarda un texto. Cuando lo que se manda es una imagen, un audio
// o un video SIN texto que lo acompane, ese campo no puede quedar vacio, asi
// que se le escribe una marca interna: "[imagen]", "[video]"...
//
// Nunca se le manda a nadie —a WhatsApp se le pasa el pie de foto de verdad, o
// ninguno— y en pantalla no deberia verse.
//
// PERO SE VEIA, por un motivo tonto: habia DOS marcas para lo mismo. Lo que
// manda el cliente se guardaba en espanol ("[imagen]") y lo que manda el bot en
// ingles, porque se armaba pegando el tipo interno —`[${kind}]`— que esta en
// ingles. La pantalla solo conocia la espanola, asi que una imagen del bot sin
// pie de foto llegaba con "[image]" y la pantalla concluia que ESO era un pie
// de foto de verdad y lo pintaba debajo.
//
// El video se salvaba por casualidad: se escribe igual en los dos idiomas. Por
// eso nunca se noto con videos.
//
// Lo que NO puede pasar al arreglarlo: que desaparezca un pie de foto escrito a
// mano. Si alguien escribe "[OFERTA] mira esto", eso es texto de una persona y
// tiene que verse.
//
// Corre sobre el CODIGO REAL: compila marca-de-adjunto.ts y lo interroga.
//
//   node scripts/prueba-marca-de-adjunto.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");
const TMP = join(RAIZ, "scripts", "_tmp-marca");
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

writeFileSync(
  join(TMP, "tsconfig.json"),
  JSON.stringify(
    {
      compilerOptions: {
        outDir: ".",
        module: "commonjs",
        target: "es2022",
        moduleResolution: "node",
        skipLibCheck: true,
        esModuleInterop: true,
        noEmit: false,
        baseUrl: "../..",
        paths: { "@/*": ["src/*"] },
      },
      include: ["../../src/lib/marca-de-adjunto.ts"],
    },
    null,
    2
  ),
  "utf8"
);

try {
  execFileSync(
    process.execPath,
    [
      join(RAIZ, "node_modules", "typescript", "bin", "tsc"),
      "-p",
      join(TMP, "tsconfig.json"),
    ],
    { stdio: "pipe" }
  );
} catch {
  // Si de verdad no se hubiera escrito nada, el require de abajo falla.
}

const require = createRequire(import.meta.url);
const { esMarcaDeAdjunto, pieDeFotoReal, marcaDeAdjunto } = require(
  join(TMP, "marca-de-adjunto.js")
);

const burbuja = leer("src", "components", "MessageBubble.tsx");
const sender = leer("src", "lib", "workflow", "sender.ts");
const panel = leer("src", "components", "ConversationPanel.tsx");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// ── 1. Las dos formas de la marca se reconocen ──────────────────────────────
for (const marca of [
  "[image]",
  "[imagen]",
  "[video]",
  "[audio]",
  "[document]",
  "[documento]",
  "[archivo]",
]) {
  comprobar(`«${marca}» es marca interna, no pie de foto`, esMarcaDeAdjunto(marca), "sí");
}
comprobar(
  // Es LA que se colaba. Si se pierde, vuelve a salir debajo de cada imagen.
  "la forma inglesa —la que se veía— se reconoce",
  pieDeFotoReal("[image]") === "",
  "se descarta"
);
comprobar(
  "con espacios alrededor también",
  esMarcaDeAdjunto("  [imagen]  ") && esMarcaDeAdjunto("[IMAGEN]"),
  "sí"
);

// ── 2. Un pie de foto de verdad NO se toca ──────────────────────────────────
//
// Es la mitad que importa: el arreglo no puede comerse texto escrito a mano.
for (const [texto, porque] of [
  ["Mira estas plantillas 😊", "texto normal"],
  ["[OFERTA] solo hoy", "empieza entre corchetes"],
  ["[imagen] de la portada", "empieza con la marca pero sigue"],
  ["esta es la [imagen]", "termina con la marca"],
]) {
  comprobar(`se conserva: ${porque}`, pieDeFotoReal(texto) === texto, "intacto");
}
comprobar(
  "un texto vacío no es pie de foto",
  pieDeFotoReal("") === "" && pieDeFotoReal(null) === "" && pieDeFotoReal(undefined) === "",
  "vacío"
);

// ── 3. Lo que se escribe de ahora en adelante, en una sola forma ────────────
comprobar(
  "la marca nueva se escribe en español",
  marcaDeAdjunto("image") === "[imagen]" &&
    marcaDeAdjunto("document") === "[documento]",
  "[imagen], [documento]"
);
comprobar(
  "y los que ya coincidían no cambian",
  marcaDeAdjunto("video") === "[video]" && marcaDeAdjunto("audio") === "[audio]",
  "igual"
);
comprobar(
  // Se reconocen las DOS aunque solo se escriba una: las filas ya guardadas con
  // "[image]" siguen existiendo, y arreglar solo el que escribe no las limpia.
  "lo que ya está guardado con la marca vieja también se limpia",
  esMarcaDeAdjunto("[image]") && esMarcaDeAdjunto("[document]"),
  "sí"
);

// ── 4. Nadie vuelve a comparar a mano ───────────────────────────────────────
comprobar(
  "la burbuja pregunta por el ayudante",
  /const pieDeFoto = pieDeFotoReal\(message\.content\);/.test(burbuja),
  "un solo sitio"
);
comprobar(
  // Cada sitio que comparaba conocía UNA sola de las dos formas. Ese fue el
  // fallo: la comparación a mano es la que se olvida de la otra.
  "y ya no compara contra una marca escrita a mano",
  !/message\.content !== "\[imagen\]"/.test(burbuja) &&
    !/message\.content !== "\[video\]"/.test(burbuja) &&
    !/message\.content !== "\[documento\]"/.test(burbuja),
  "fuera"
);
comprobar(
  "imagen, video y documento pintan el pie limpio",
  (burbuja.match(/renderWhatsAppFormat\(pieDeFoto\)/g) ?? []).length === 2 &&
    /docCaption =\s*\r?\n\s*isDocument && pieDeFoto && pieDeFoto !== docFilename/.test(
      burbuja
    ),
  "los tres"
);
comprobar(
  "el texto suelto sin adjunto sigue pintándose entero",
  /renderWhatsAppFormat\(message\.content\)/.test(burbuja),
  "intacto"
);
comprobar(
  "el que escribe la marca usa el ayudante",
  !/`\[\$\{kind\}\]`/.test(sender) &&
    (sender.match(/marcaDeAdjunto\(kind\)/g) ?? []).length === 4,
  "los 4 canales"
);
comprobar(
  // Antes descartaba CUALQUIER cosa entre corchetes: un pie de foto "[OFERTA]"
  // desaparecía del panel sin motivo.
  "el panel ya no descarta todo lo que va entre corchetes",
  !/if \(\/\^\\\[\.\*\\\]\$\/\.test\(texto\)\) return "";/.test(panel) &&
    /return pieDeFotoReal\(m\.content\);/.test(panel),
  "solo las marcas"
);

rmSync(TMP, { recursive: true, force: true });
console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} comprobación(es) mal.`);
process.exit(fallos === 0 ? 0 : 1);
