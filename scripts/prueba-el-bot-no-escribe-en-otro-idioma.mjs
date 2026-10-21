// AL CLIENTE NO LE LLEGA UNA PALABRA EN OTRO ALFABETO.
//
// LO QUE PASÓ — 24 de septiembre de 2026, vendiendo en Perú. En medio de una
// frase en español, al cliente le llegó esto tal cual:
//
//     «Antes de darte los datos, solo确认: ¿cuál de los dos productos deseas?»
//
// «确认» es «confirmar» en chino. No salió del contenido del dueño ni del código:
// el modelo que atiende la conversación es chino y se le escapó una palabra en su
// idioma. Pasa de vez en cuando, y pedírselo por prompt no da ninguna garantía —
// en el prompt todo compite a la vez.
//
// LO QUE SE HIZO: se revisa lo que el modelo YA escribió, igual que las guardas
// de al lado que vigilan que no nombre un banco inexistente o un precio que no
// existe. Se le pide que lo rehaga; si insiste, se le quita la palabra y sale el
// resto, y queda escrito en el registro.
//
// POR QUÉ NO ES EL «PARCHE PALABRA POR PALABRA» que este proyecto tiene
// prohibido: no hay ninguna palabra escrita en el código. Se pregunta por el
// ALFABETO en que está escrito cada carácter, así que caza también las que nunca
// hemos visto.
//
// LO QUE NO PUEDE TOCARSE, y es la mitad de esta prueba:
//
//   · Los EMOJIS. El bot vende con ellos.
//   · Las TILDES y la Ñ. Son español.
//   · El GRIEGO. Un producto de química nombra π, α o Δ con toda la razón, y
//     marcarlo obligaría a rehacer una respuesta correcta.
//
//   node scripts/prueba-el-bot-no-escribe-en-otro-idioma.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const cerebro = readFileSync(join(RAIZ, "src", "lib", "openrouter.ts"), "utf8");

let fallos = 0;
const comprobar = (titulo, ok, nota = "") => {
  if (!ok) fallos++;
  console.log(
    `${ok ? "ok   " : "FALLA"} ${titulo.padEnd(54).slice(0, 54)} ${nota}`
  );
};

// ── LAS DOS FUNCIONES DE VERDAD, SACADAS DEL ARCHIVO ────────────────────────
//
// No se reescriben de memoria: un código reimplementado prueba lo que uno CREE
// que hace, que es justo lo que se está poniendo en duda.
const trozo = (desde, hasta) => {
  const i = cerebro.indexOf(desde);
  const f = cerebro.indexOf(hasta, i);
  return i < 0 ? "" : cerebro.slice(i, f + hasta.length);
};
const fuente = [
  (cerebro.match(/const OTRO_ALFABETO =[\s\S]*?;/) ?? [""])[0],
  trozo("function laRespuestaTraeOtroAlfabeto(", "\n}"),
  trozo("function sinElOtroAlfabeto(", "\n}"),
]
  .join("\n\n")
  .replace(/\(text: string\): string/g, "(text)")
  .replace(/: string/g, "");

const { laRespuestaTraeOtroAlfabeto, sinElOtroAlfabeto } = new Function(
  `${fuente}\nreturn { laRespuestaTraeOtroAlfabeto, sinElOtroAlfabeto };`
)();

// ── 1. LA FRASE QUE LE LLEGÓ AL CLIENTE ─────────────────────────────────────
console.log("-- 1. la frase real de su prueba ---------------------------");
const SUYA = "Antes de darte los datos, solo确认: ¿cuál de los dos productos deseas llevar?";
const cazado = laRespuestaTraeOtroAlfabeto(SUYA);
console.log(`     caza: «${cazado}»`);
comprobar("la caza", cazado === "确认", "sin escribir la palabra en el codigo");
const limpia = sinElOtroAlfabeto(SUYA);
console.log(`     queda: «${limpia}»`);
comprobar(
  "y al insistir, la quita y la frase se entiende",
  limpia === "Antes de darte los datos, solo: ¿cuál de los dos productos deseas llevar?",
  "sin dejar un hueco raro"
);

// ── 2. OTROS ALFABETOS DE LA MISMA FAMILIA ──────────────────────────────────
console.log("\n-- 2. y los de su familia ---------------------------------");
for (const [que, frase] of [
  ["chino", "el precio es 20 确定"],
  ["japones", "listo です"],
  ["coreano", "gracias 확인"],
  ["cirilico", "hola привет"],
]) {
  comprobar(`caza el ${que}`, laRespuestaTraeOtroAlfabeto(frase) !== "", frase);
}

// ── 3. LO QUE NO PUEDE TOCAR ────────────────────────────────────────────────
console.log("\n-- 3. lo que se queda como está ---------------------------");
const INTACTAS = [
  "¡Perfecto! 😊 Te paso los datos 👇🏼",
  "Química en Acción incluye 6 kits 🧪",
  "Sí, señor, está incluido. Mañana te llega ✅",
  "El ángulo es de 90° y la fórmula usa π y Δ",
  "Son S/. 20 — ¿te lo envío? 🤳🏼",
];
for (const frase of INTACTAS) {
  comprobar(
    `no toca «${frase.slice(0, 32)}…»`,
    laRespuestaTraeOtroAlfabeto(frase) === "" && sinElOtroAlfabeto(frase) === frase,
    "emojis, tildes, ñ y griego"
  );
}

// ── 4. Y ESTÁ ENGANCHADO DONDE SIRVE ────────────────────────────────────────
//
// La función suelta no protege a nadie: tiene que correr sobre la respuesta antes
// de enviarla, pedir que la rehaga UNA vez y limpiarla si insiste.
console.log("\n-- 4. enganchado en el turno ------------------------------");
comprobar(
  "se revisa la respuesta antes de enviarla",
  /const enOtroAlfabeto = laRespuestaTraeOtroAlfabeto\(text\);/.test(cerebro),
  "junto a las otras guardas"
);
comprobar(
  "pide que la rehaga UNA vez, no dos",
  /otroAlfabetoRetries < 1/.test(cerebro) &&
    /otroAlfabetoRetries \+= 1/.test(cerebro),
  "una segunda oportunidad, nunca una tercera"
);
comprobar(
  "y si insiste la limpia en vez de mandarla",
  /const limpio = sinElOtroAlfabeto\(text\);[\s\S]{0,400}?if \(limpio\) text = limpio;/.test(
    cerebro
  ),
  "y si no queda nada, sigue el camino de la vacia"
);
comprobar(
  "queda dicho en el registro las dos veces",
  (cerebro.match(/escribio en otro alfabeto/g) ?? []).length === 1 &&
    (cerebro.match(/INSISTE en otro alfabeto/g) ?? []).length === 1,
  "para poder verlo"
);

console.log(
  fallos === 0
    ? "\nTODO OK — al cliente le llega español, con sus emojis\n"
    : `\n${fallos} comprobacion(es) mal.\n`
);
process.exit(fallos === 0 ? 0 : 1);
