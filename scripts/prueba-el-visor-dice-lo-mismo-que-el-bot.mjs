// EL VISOR DICE LO MISMO QUE EL BOT: una sola función escribe la moneda.
//
// LO VIO EL DUEÑO el 30 de septiembre de 2026. Con el comodín
// {{precio_complementario}} y un importe de 1, el editor le enseñaba
// «$ 1 DOLARES». Su pregunta fue si el bot mandaba eso.
//
// NO lo mandaba: el bot decía «$ 1 dólar». El visor mentía.
//
// LA CAUSA, medida ejecutando las dos: la pantalla tenía su PROPIA copia del
// formateador y su PROPIA copia de la tabla de países. Once diferencias, en
// cuatro familias:
//
//     el bot manda          el visor enseñaba
//     S/. 1 Sol             S/. 1 Soles        <- no sabía el singular
//     90 Céntimos           S/. 0.90 Soles     <- ni la parte pequeña
//     ₡ 1 Colón             CRC 1 Colones      <- ni el símbolo de Costa Rica
//     $1 COP                $0,50 COP          <- ni el mínimo pagable
//
// LA SEGUNDA ES LA QUE COSTÓ DINERO. «S/. 0.90 Soles» es el texto exacto que un
// cliente leyó como soles: mandó 9 y hubo que devolverle la diferencia. Por eso
// existe SUBUNIDAD_POR_MONEDA en countries.ts. El bot se arregló entonces —y el
// visor se quedó enseñando el texto que causó la pérdida, durante meses, sin que
// nada avisara.
//
// EL ARREGLO NO ES SINCRONIZAR LAS DOS COPIAS: es que haya una. El visor llama a
// `formatCurrencyAmount`, la misma función que redacta el mensaje real.
//
// Esta prueba tiene DOS mitades y las dos hacen falta:
//   1. Se EJECUTA la función del bot: que escriba bien las cuatro familias.
//   2. Se lee la pantalla: que la llame a ella y no le quede copia propia.
//
//   node scripts/prueba-el-visor-dice-lo-mismo-que-el-bot.mjs
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const { formatCurrencyAmount, COUNTRIES } = await import(
  pathToFileURL(join(RAIZ, "src", "lib", "countries.ts")).href
);
const editor = readFileSync(join(RAIZ, "src", "app", "editor", "page.tsx"), "utf8");

let fallos = 0;
const pad = (s, n) => (String(s ?? "") + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};
// El importe se escribe UNA vez y se compara con lo que sale de verdad.
const dice = (texto, monto, pais, esperado) => {
  const salida = formatCurrencyAmount(monto, pais, COUNTRIES[pais].currency);
  comprobar(texto, salida === esperado, salida === esperado ? salida : `dio «${salida}», se esperaba «${esperado}»`);
};

// ── 1. UNA UNIDAD SE DICE EN SINGULAR ───────────────────────────────────────
//
// Es lo que él vio. Un «1 DOLARES» en una oferta se lee como descuido, y donde
// se está pidiendo dinero el descuido cuesta confianza.
console.log("\n— 1. una unidad va en singular —\n");
dice("un sol", 1, "PE", "S/. 1 Sol");
dice("y dos son soles", 2, "PE", "S/. 2 Soles");
dice("un dólar", 1, "EC", "$ 1 Dólar");
dice("un colón", 1, "CR", "₡ 1 Colón");
dice("un quetzal", 1, "GT", "Q 1 Quetzal");
dice("un boliviano", 1, "BO", "Bs 1 Boliviano");
dice("un bolívar", 1, "VE", "Bs 1 Bolívar");

// ── 2. MENOS DE UNA UNIDAD VA EN LA PARTE PEQUEÑA ───────────────────────────
//
// LA FAMILIA QUE COSTÓ DINERO. No se dice «0.90 soles»: se dice «90 céntimos»,
// que es lo que el cliente puede pagar sin equivocarse.
console.log("\n— 2. menos de una unidad, en la parte pequeña —\n");
dice("noventa céntimos", 0.9, "PE", "90 Céntimos");
dice("cincuenta centavos", 0.5, "EC", "50 Centavos");
comprobar(
  "y NO aparece el texto que costó la devolución",
  formatCurrencyAmount(0.9, "PE", "PEN") !== "S/. 0.90 Soles",
  "nunca «S/. 0.90 Soles»"
);

// ── 3. LAS MONEDAS SIN PARTE PEQUEÑA SUBEN AL MÍNIMO PAGABLE ────────────────
//
// En la calle no existe «50 centavos de peso colombiano». Un cobro de 0,50 es un
// cobro invisible, así que se sube a la unidad más chica que alguien puede pagar.
console.log("\n— 3. sin parte pequeña, al mínimo que se puede pagar —\n");
dice("medio peso colombiano no existe", 0.5, "CO", "$1 COP");
dice("ni medio peso chileno", 0.5, "CL", "$1 CLP");

// ── 4. LOS CUATRO PESOS VAN CON SU CÓDIGO ───────────────────────────────────
//
// Comparten símbolo y palabra: sin el código no se sabe de qué pesos se habla.
console.log("\n— 4. los cuatro «peso» llevan su código —\n");
dice("Argentina", 18000, "AR", "$18.000 ARS");
dice("México", 350, "MX", "$350 MXN");
dice("Colombia", 35000, "CO", "$35.000 COP");

// ── 5. LA PANTALLA LLAMA AL BOT, NO SE FORMATEA SOLA ────────────────────────
//
// Esta es la mitad que impide que vuelva a pasar. Mientras exista una segunda
// implementación, alguien arreglará una y quedará la otra: ya pasó dos veces
// —los «pesos argentinos» y ahora el singular— y las dos veces nadie avisó.
console.log("\n— 5. la pantalla le pregunta al bot —\n");
comprobar(
  "el editor importa la función del bot",
  /import \{ COUNTRIES, formatCurrencyAmount \} from "@\/lib\/countries";/.test(
    editor
  ),
  "una sola fuente"
);
comprobar(
  "y el visor solo la llama",
  /return formatCurrencyAmount\(amount, countryCode, currencyCode, labelCase\);/.test(
    editor
  ),
  "sin formatear nada"
);
comprobar(
  "no le queda copia de los nombres de moneda",
  !/PEN: "soles"/.test(editor) && !/USD: "dólares"/.test(editor),
  "ni «soles» ni «dólares» escritos aquí"
);
comprobar(
  "ni copia de los cuatro pesos",
  !/\["ARS", "MXN", "COP", "CLP"\]\.includes\(currency\)/.test(editor),
  "eso vive en countries.ts"
);
comprobar(
  "ni su propio formateo de miles",
  !/amount\.toLocaleString\(`es-\$\{countryCode\}`/.test(editor),
  "lo hace el bot"
);

// ── 6. Y LA TABLA DE PAÍSES TAMPOCO SE COPIA ────────────────────────────────
//
// El símbolo de Costa Rica se había separado: «CRC» en el visor y «₡» en el
// mensaje. La pantalla decide el ORDEN y la BANDERA —eso es suyo—; la moneda y
// el símbolo los lee de la tabla del bot.
console.log("\n— 6. la moneda y el símbolo salen de la tabla del bot —\n");
comprobar(
  "el desplegable lee la moneda del bot",
  /currency: COUNTRIES\[pais\.code\]\.currency/.test(editor)
);
comprobar(
  "y el símbolo también",
  /symbol: COUNTRIES\[pais\.code\]\.symbol/.test(editor)
);
comprobar(
  "ya no hay símbolos escritos a mano",
  !/\{ code: "PE", label: "[^"]*", currency: "PEN"/.test(editor),
  "no se pueden separar otra vez"
);
comprobar(
  "y Costa Rica usa su símbolo, no su código",
  COUNTRIES.CR.symbol === "₡" && !/symbol: "CRC"/.test(editor),
  "₡"
);
// LAS BANDERAS SIGUEN SIENDO DE LA PANTALLA. Si alguien "unifica" también esto,
// el desplegable se queda sin banderas y sin el orden que el dueño eligió.
comprobar(
  "las banderas y el orden siguen en la pantalla",
  /\{ code: "PE", label: "🇵🇪 Peru" \}/.test(editor),
  "eso sí es suyo"
);

console.log(
  fallos === 0
    ? "\nTODO OK — lo que se ve en el editor es lo que recibe el cliente\n"
    : `\n${fallos} FALLO(S)\n`
);
process.exit(fallos === 0 ? 0 : 1);
