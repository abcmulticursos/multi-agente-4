// «Disculpa, se me cortó el mensaje» — en bucle, y justo al querer comprar.
//
// LO QUE PASO (convo 49, del log)
//
//   "si lo quiero"                        → Disculpa, se me cortó el mensaje
//   "me interesa el de mockup"            → Disculpa, se me cortó el mensaje
//   "el producto de 7500 lo quiero comprar" → Disculpa, se me cortó el mensaje
//
// En el log, las tres veces:
//   [llm] respuesta incompleta (stop); reintento 1
//   [llm] respuesta incompleta (stop); reintento 2
//   [llm] respuesta sigue incompleta tras reintentos; uso fallback seguro
//
// POR QUE — Y ES UN FALLO QUE INTRODUJE YO
//
// Hay un guardia que evita mandar frases a medias: si despues del punto final
// quedan una o dos palabras sueltas, da la respuesta por cortada, reintenta, y
// si sigue igual manda esa disculpa.
//
// Al pedirle al modelo que avise con "<<QUIERE_EXTRA>>" al final, y ademas que
// conteste con UNA frase corta, la respuesta quedaba asi:
//
//   «¡Genial! 😊 <<QUIERE_EXTRA>>»
//
// El guardia veia dos trozos sueltos despues del "!" —el emoji y el marcador—
// y la daba por cortada. Como el marcador vuelve a salir en cada reintento, el
// cliente entraba en BUCLE: dijera lo que dijera, la misma disculpa.
//
// DOS ARREGLOS
//
//  1. Los marcadores no son texto del cliente: se quitan antes de juzgar. Vale
//     para todos —REGALO_SI, UPGRADE_COMBO, METODOS_PAGO...—, que tenian el
//     mismo problema latente desde antes.
//  2. Un emoji suelto detras del punto final no es una frase a medias: es como
//     se despide medio mundo. Solo cuentan los trozos con letras o numeros.
//
//   node scripts/prueba-bucle-de-la-disculpa.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");

const cerebro = leer("src", "lib", "openrouter.ts");
const editor = leer("src", "app", "editor", "page.tsx");
const api = leer("src", "app", "api", "workflow", "route.ts");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 60)} ${valor}`);
};

// ── 1. El guardia ya no se traga los marcadores ─────────────────────────────
const guardia =
  cerebro.match(/function looksLikeIncompleteReply\([\s\S]*?\r?\n\}\r?\n/)?.[0] ??
  "";

comprobar("el guardia está donde se le busca", guardia.length > 0, "sí");
comprobar(
  // ESTE es el fallo. Sin quitarlos, el marcador cuenta como palabra suelta.
  "los marcadores se quitan antes de juzgar",
  /\.replace\(\/<<\[\^<>\]\{0,60\}>>\/g, " "\)/.test(guardia),
  "sí"
);
comprobar(
  "y un emoji suelto ya no cuenta como frase a medias",
  /\.filter\(\(palabra\) => \/\[\\p\{L\}\\p\{N\}\]\/u\.test\(palabra\)\)/.test(
    guardia
  ),
  "solo letras"
);
comprobar(
  // Lo que el guardia SÍ tiene que seguir cazando: una frase de verdad cortada.
  "sigue cazando una frase cortada de verdad",
  /\\b\(el\|la\|los\|las\|lo\|un\|una\|de\|del\|que\|para\|por\|con\|y\|o\)\$/.test(
    guardia
  ),
  "intacto"
);
comprobar(
  "y el corte por longitud del proveedor",
  /finishReason === "length" \|\| looksLikeIncompleteReply\(text\)/.test(cerebro),
  "intacto"
);

// ── Comprobación en vivo, con la misma lógica del archivo ───────────────────
{
  const cuerpo = guardia
    .replace(/^function looksLikeIncompleteReply\(text: string\): boolean \{/, "")
    .replace(/\}\s*$/, "");
  const mira = new Function("text", cuerpo.replace(/: string/g, ""));
  const casos = [
    ["¡Genial! 😊 <<QUIERE_EXTRA>>", false, "la del bucle"],
    ["¡Perfecto! <<REGALO_SI>>", false, "otro marcador"],
    ["Listo 👍", false, "emoji al final"],
    ["Te paso los datos.", false, "frase normal"],
    ["¡Hola! Te", true, "cortada de verdad"],
    ["Puedes pagar con el", true, "termina en artículo"],
  ];
  for (const [texto, esperado, etiqueta] of casos) {
    const dio = Boolean(mira(texto));
    comprobar(
      `  ${etiqueta}`,
      dio === esperado,
      (dio ? "la da por cortada" : "la deja pasar") +
        (dio === esperado ? "" : "  <-- MAL")
    );
  }
}

// ── 2. El campo de alias deja escribir comas ────────────────────────────────
comprobar(
  // Cortar y tirar huecos en cada tecla borraba la coma recién escrita: no se
  // podía separar nada.
  "el campo de alias ya no limpia mientras se escribe",
  /aliases: e\.target\.value\.split\(","\),/.test(editor),
  "sin filtrar"
);
comprobar(
  // Si se pinta con ", " y se parte por ",", el cursor salta al teclear.
  "y lo que se ve coincide con lo que se parte",
  /value=\{\(cfg\.upsell\?\.aliases \?\? \[\]\)\.join\(","\)\}/.test(editor),
  "simétrico"
);
comprobar(
  "la limpieza la hace el guardado",
  /function strListLimpia\(v: unknown\): string\[\]/.test(api) &&
    (api.match(/aliases: strListLimpia\(/g) ?? []).length === 2,
  "las dos secciones"
);
comprobar(
  "y el campo dice que se limpia al guardar",
  /Los espacios sobrantes y los huecos se\s*\r?\n\s*limpian al guardar/.test(
    editor
  ),
  "lo dice"
);

console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} comprobación(es) mal.`);
process.exit(fallos === 0 ? 0 : 1);
