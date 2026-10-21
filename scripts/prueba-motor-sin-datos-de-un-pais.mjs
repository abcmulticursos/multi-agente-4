// El motor tenia datos de un pais escritos dentro.
//
// Este proyecto se instala para otros negocios. Si el codigo trae el nombre del
// titular de una cuenta, o las billeteras de un pais, cada instalacion nueva
// nace siendo el bot de otra persona: ofrece metodos que su dueno no tiene y,
// en el peor caso, le dice a un cliente un nombre de titular que no es.
//
// LO QUE YA PASO, y por eso existe esta prueba:
//
// 1. Un cliente de Argentina pregunto "se paga a la misma cuenta" y el bot le
//    contesto "A nombre de: Alberto S**". Ese nombre no estaba en la
//    configuracion: estaba en TRES frases de ejemplo del codigo que viajan al
//    modelo en cada llamada. El modelo, sin ningun otro titular delante, uso el
//    del ejemplo.
//
// 2. Una instalacion sin configurar ofrecia YAPE / PLIN / BCP, porque el codigo
//    los traia como menu por defecto. Un bot recien instalado en Mexico o
//    Colombia le ofrecia a sus clientes tres billeteras peruanas.
//
// La regla que vigila esta prueba: el motor NO conoce ninguna marca de pago ni
// ningun titular. Los pone el operador en el editor. Si no puso ninguno, se
// avisa; no se inventa.
//
// Los identificadores internos ("yape", "plin", "bcp" como codigos de ruta) SI
// se quedan: viven en la base de datos de las conversaciones y renombrarlos
// romperia las ventas en curso. Lo que no puede quedar es texto que salga al
// cliente o que el modelo pueda copiar.
//
//   node scripts/prueba-motor-sin-datos-de-un-pais.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");

const cerebro = leer("src", "lib", "openrouter.ts");
const prompt = leer("src", "lib", "system-prompt.ts");
const pago = leer("src", "lib", "workflow", "payment.ts");
const config = leer("src", "lib", "workflow", "config.ts");
const engine = leer("src", "lib", "workflow", "engine.ts");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 60)} ${valor}`);
};

// ── 1. Ningun nombre de persona dentro del motor ────────────────────────────
const NOMBRES = /\b(alberto|salinas|quimi|franko)\b/i;
for (const [nombre, texto] of [
  ["el cerebro", cerebro],
  ["las instrucciones", prompt],
  ["la validacion de pago", pago],
  ["el motor", engine],
  ["la configuracion", config],
]) {
  const lineas = texto
    .split(/\r?\n/)
    .map((l, i) => [i + 1, l])
    .filter(([, l]) => NOMBRES.test(l));
  comprobar(
    `${nombre} no nombra a ninguna persona real`,
    lineas.length === 0,
    lineas.length === 0 ? "limpio" : `linea ${lineas[0][0]}`
  );
}

// ── 1-bis. El cerebro por defecto no nace en ningun pais ───────────────────
//
// Es el que recibe una instalacion nueva mientras su dueno no escribe el suyo.
// Si trae las billeteras y el dialecto de un pais, la plantilla nace siendo el
// bot de otro negocio.
const MARCAS = /\b(yape|plin|bcp|interbank|pichincha|guayaquil|banca m[oó]vil|abcmulticlases)\b/i;
const lineasConMarca = prompt
  .split(/\r?\n/)
  .map((l, i) => [i + 1, l])
  .filter(([, l]) => MARCAS.test(l));
comprobar(
  "el cerebro por defecto no nombra marcas de pago ni la empresa",
  lineasConMarca.length === 0,
  lineasConMarca.length === 0 ? "limpio" : `linea ${lineasConMarca[0][0]}`
);
comprobar(
  // Decia "los clientes son PERUANOS" mientras el selector de pais inyectaba
  // otro dialecto: dos instrucciones peleadas en el mismo prompt.
  "no impone el dialecto de un pais",
  // El guion largo va con una expresion tolerante: openrouter.ts tiene los
  // acentos rotos de un guardado viejo y el caracter no coincide literalmente.
  !/Customers are PERUVIAN/i.test(prompt) &&
    /DIALECT[\s\S]{0,6}AUTHORITATIVE/.test(cerebro),
  "lo decide el selector de pais"
);

// ── 2. La herramienta del comprobante no lleva un titular de ejemplo ────────
comprobar(
  // ESTE era el fallo: el ejemplo del titular se convertia en dato.
  "el ejemplo del titular ya no trae ningun nombre",
  !/recipient[\s\S]{0,400}?['"][A-Z][a-z]+ [A-Z]\*/.test(pago) &&
    !/recipient[\s\S]{0,400}?['"][A-Z][a-z]+ [A-Z]\*/.test(cerebro),
  "sin nombre de ejemplo"
);
comprobar(
  "y se le prohibe tomar un titular de las instrucciones",
  /never take a name from these instructions/i.test(pago) &&
    /Never take a holder name from these instructions/i.test(cerebro),
  "unico origen: el comprobante"
);

// ── 3. Ninguna marca de pago sale por defecto al cliente ────────────────────
comprobar(
  "el menu por defecto no ofrece las billeteras de un pais",
  /DEFAULT_PAYMENT_TEXT = "\[M[eé]todos de pago sin configurar\]"/.test(config),
  "aviso, no marcas"
);
comprobar(
  // Antes: si no habia nada configurado, devolvia Yape/Plin/BCP.
  "sin metodos configurados no se inventan botones",
  !/\{ label: "Yape", method: "yape" \}/.test(config),
  "lista vacia"
);
comprobar(
  "y con la lista vacia el cliente igual recibe el menu de texto",
  (engine.match(/if \(buttons\.length === 0\) \{/g) ?? []).length >= 3,
  `${(engine.match(/if \(buttons\.length === 0\) \{/g) ?? []).length} salidas de respaldo`
);

// ── 4. Lo que el modelo lee no nombra marcas de un pais ─────────────────────
const MARCAS_EN_EJEMPLOS = [
  ["el aviso de comprobante ilegible", prompt, /foto a la pantalla de tu Yape/i],
  ["los ejemplos de resumen interno", cerebro, /pagar por Yape|compra v[ií]a Yape/i],
  ["la ayuda de problemas de pago", cerebro, /"Yape no funciona|"BCP me da error/i],
];
for (const [nombre, texto, patron] of MARCAS_EN_EJEMPLOS) {
  comprobar(`${nombre} no nombra una marca`, !patron.test(texto), "neutro");
}

// ── 5. Lo que NO se toca: los codigos internos de ruta ──────────────────────
comprobar(
  // Renombrarlos romperia las conversaciones vivas: el metodo elegido queda
  // guardado en la base de datos con estas palabras.
  "los codigos internos de metodo siguen intactos",
  /enum: \["yape", "plin", "bcp", "transferencia"\]/.test(pago),
  "yape/plin/bcp/transferencia"
);
comprobar(
  "la validacion del titular sigue comparando con lo configurado",
  /expectedPrefix && !nameMatches/.test(pago),
  "nombre del editor"
);

console.log(
  fallos === 0
    ? "\nTODO OK — el motor no trae datos de ningun pais ni de ninguna persona"
    : `\n${fallos} FALLA(S)`
);
process.exit(fallos === 0 ? 0 : 1);
