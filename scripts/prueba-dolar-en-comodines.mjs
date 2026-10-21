// El precio argentino que se convertia en el nombre del comodin.
//
// LO QUE VIO EL CLIENTE
//
//   "Si, claro. Puedes completar MONTO_FALTANTE.000 ARS para llevarte el
//    completo. Cuando envies el comprobante del saldo restante, te lo dejo
//    listo."
//
// El nombre del comodin, en mitad de un mensaje de cobro.
//
// POR QUE
//
// En texto.replace(regex, reemplazo), el signo "$" tiene significado propio
// DENTRO DEL REEMPLAZO: "$1" no es un dolar seguido de un uno, es "el primer
// trozo capturado por la expresion".
//
//   texto.replace(/\{\{(monto_faltante|saldo_faltante)\}\}/gi, "$1.000 ARS")
//
// En Peru el precio empieza por "S/" y no pasa nada. En Argentina, Mexico,
// Colombia y Chile empieza por "$", y si el importe empieza por 1, ese "$1" se
// interpreta como el grupo capturado.
//
// LO TRAICIONERO
//
// Solo rompe con importes que empiezan por 1 —1.000, 15.000, 18.000— y solo en
// paises con "$". Con 6.000 o 7.000 funciona perfecto. Se puede probar cien
// veces sin verlo nunca, y aparece justo el dia que el saldo pendiente empieza
// por 1.
//
//   node scripts/prueba-dolar-en-comodines.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// ── 1. El fallo, reproducido ────────────────────────────────────────────────
//
// Sin protección, esto es literalmente lo que le pasó al cliente.
const RE = /\{\{\s*(monto_faltante|saldo_faltante|diferencia_pendiente)\s*\}\}/gi;
const PLANTILLA = "Puedes completar {{MONTO_FALTANTE}} para llevarte el completo.";

const sinProteger = PLANTILLA.replace(RE, "$1.000 ARS");
comprobar(
  "sin proteger, el precio se convierte en el comodín",
  sinProteger.includes("MONTO_FALTANTE.000 ARS"),
  "así lo vio el cliente"
);

const literal = (t) => () => t;
const protegido = PLANTILLA.replace(RE, literal("$1.000 ARS"));
comprobar(
  "protegido, sale el precio de verdad",
  protegido === "Puedes completar $1.000 ARS para llevarte el completo.",
  "$1.000 ARS"
);

// ── 2. Los importes que rompían, y los que no ───────────────────────────────
for (const [importe, rompia] of [
  ["$1.000 ARS", true],
  ["$15.000 ARS", true],
  ["$18.000 ARS", true],
  ["$6.000 ARS", false],
  ["$7.500 ARS", false],
  ["S/ 10 SOLES", false],
]) {
  const salida = PLANTILLA.replace(RE, importe);
  const roto = salida.includes("MONTO_FALTANTE");
  comprobar(
    `«${importe}» ${rompia ? "rompía" : "nunca rompió"}`,
    roto === rompia,
    roto ? "se rompía" : "iba bien"
  );
  comprobar(
    `  y protegido sale entero`,
    PLANTILLA.replace(RE, literal(importe)).includes(importe),
    "sí"
  );
}

// ── 3. El ayudante existe y se usa donde toca ───────────────────────────────
const ayudante = leer("src", "lib", "texto-literal.ts");
comprobar(
  "el ayudante vive en un solo sitio",
  /export function literal\(texto: string\): \(\) => string \{/.test(ayudante),
  "texto-literal.ts"
);
comprobar(
  // Escapar el "$" a mano funciona, pero hay que acordarse en cada sitio. Una
  // función no se puede olvidar de escapar nada.
  "y lo hace con una función, no escapando a mano",
  /return \(\) => texto;/.test(ayudante),
  "sin escapes"
);

for (const [nombre, ruta] of [
  ["sender", ["src", "lib", "workflow", "sender.ts"]],
  ["engine", ["src", "lib", "workflow", "engine.ts"]],
  ["config", ["src", "lib", "workflow", "config.ts"]],
  ["payment", ["src", "lib", "workflow", "payment.ts"]],
]) {
  const texto = leer(...ruta);
  comprobar(
    `${nombre}: usa el ayudante`,
    /import \{ literal \} from "@\/lib\/texto-literal";/.test(texto) &&
      texto.includes("literal("),
    (texto.match(/\.replace\([^)]*literal\(/g) ?? []).length + " sitios"
  );
}

comprobar(
  // El sitio exacto que reporto Alberto.
  "el mensaje de completar al combo está protegido",
  /literal\(missingLabel\)/.test(leer("src", "lib", "workflow", "engine.ts")),
  "arreglado"
);
comprobar(
  "y los comodines de precio de las dos opciones también",
  /literal\(comboPrice == null \? "" : formatCurrencyAmount/.test(
    leer("src", "lib", "workflow", "config.ts")
  ),
  "arreglado"
);
comprobar(
  // Un dato de pago escrito a mano tambien puede llevar un "$".
  "y los datos de pago del país",
  /literal\(profile\?\.metodo_pago_1 \?\? ""\)/.test(
    leer("src", "lib", "workflow", "sender.ts")
  ),
  "arreglado"
);

// ── 4. Los reemplazos que SÍ usan el $ a propósito siguen intactos ──────────
comprobar(
  // Hay reemplazos que usan "$1" queriendo: son los que reordenan el propio
  // texto, no los que meten un dato de fuera. Envolverlos los habria roto.
  "los reemplazos que usan $1 a propósito no se tocaron",
  /\.replace\([^,]*, "\$1"\)/.test(leer("src", "lib", "workflow", "sender.ts")),
  "intactos"
);

console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} comprobación(es) mal.`);
process.exit(fallos === 0 ? 0 : 1);
