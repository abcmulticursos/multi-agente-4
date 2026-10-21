// EL REENVÍO RECONOCE LA CUENTA ESCRITA CON SU COMODÍN.
//
// LO QUE PASABA — 13/10/2026, en la verificación con Argentina. El cliente ya tenía los
// datos y volvía a escribir «transferencia». El bot reenviaba así:
//
//   1. Claro, aquí te envío los datos nuevamente 😊👇          ← la frase de reenvío
//   2. Excelente!, Puedes realizar tu pago a través de…        ← la de primera vez, SOBRA
//   3. Transferencia… CBU {{NUMERO_DE_CUENTA}}… Monto…
//   4. Luego nos envías la imagen de tu comprobante…
//
// Dos saludos seguidos: suena a un bot que se olvidó de que ya se lo dijo. En Perú con Yape
// y en Ecuador no pasaba, porque sus datos van con {{METODO_DE_PAGO_…}}.
//
// LA CAUSA: `sinLaPresentacionDeSiempre` quita las frases que van DELANTE de la burbuja con
// los datos, y esa burbuja la buscaba solo por {{METODO_DE_PAGO_…}} o por seis cifras
// seguidas. {{NUMERO_DE_CUENTA}} y {{CUENTA_<método>}} —que también son la cuenta— no los
// veía, así que creía que no había datos y no quitaba nada. Afectaba igual a BCP y Efectivo
// de Perú.
//
// LO QUE NO SE TOCA, y aquí se comprueba: `unTextoLlevaLosDatosParaPagar` sigue igual.
// La usan otras tres partes —el detector de mensajes en handler.ts, la del cuadrito que
// ya lleva los datos y una guarda del motor— y ninguna tenía este fallo.
//
// Y LA REGLA QUE PROTEGE CONTRA LA «RESPUESTA HORRIBLE» (los datos sin ninguna frase
// delante): esta función solo se llama cuando ya hubo una frase que la sustituye —la de
// reenvío o su cuadrito—. En un primer envío normal no se llama.
//
// Ejecuta las funciones DE VERDAD, sacadas de engine.ts.
//
//   node scripts/prueba-el-reenvio-reconoce-la-cuenta-por-comodin.mjs
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const RAIZ = process.cwd();
const MOTOR = readFileSync(join(RAIZ, "src", "lib", "workflow", "engine.ts"), "utf8");

let fallos = 0;
const pad = (s, n) => (String(s ?? "") + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 66)} ${valor}`);
};

// Saca una función entera por su nombre, contando llaves.
const sacar = (nombre) => {
  const i = MOTOR.search(new RegExp(`(export )?function ${nombre}\\(`));
  if (i < 0) {
    console.log(`FALLA no encuentro ${nombre} en engine.ts`);
    process.exit(1);
  }
  const abre = MOTOR.indexOf("{", MOTOR.indexOf(")", MOTOR.indexOf("(", i)));
  let nivel = 0;
  for (let j = abre; j < MOTOR.length; j++) {
    if (MOTOR[j] === "{") nivel++;
    else if (MOTOR[j] === "}" && --nivel === 0) return MOTOR.slice(i, j + 1).replace(/^export /, "");
  }
  return "";
};
const nombres = [
  "unTextoLlevaLosDatosParaPagar",
  "llevaLosDatosParaPagar",
  "llevaUnaCuentaPorComodin",
  "sinLaPresentacionDeSiempre",
];
const CASA = mkdtempSync(join(tmpdir(), "reenvio-"));
const archivo = join(CASA, "funciones.ts");
writeFileSync(
  archivo,
  `type ResponseStep = { type?: string; body?: string; body_variants?: string[]; caption?: string; caption_variants?: string[] };\n` +
    nombres.map(sacar).join("\n\n") +
    `\nexport { ${nombres.join(", ")} };\n`,
  "utf8"
);
const m = await import(pathToFileURL(archivo).href);

const t = (texto) => ({ type: "text", body_variants: [texto] });
const PRESENTA = t("Excelente!, Puedes realizar tu pago a través de los siguientes datos: 👇");
const CIERRE = t("Luego nos envías la imagen de tu comprobante y listo!");
const largo = (pasos) => m.sinLaPresentacionDeSiempre(pasos).length;

console.log("\n— 1. los casos que fallaban: ahora se quita la frase de primera vez —\n");
comprobar("Argentina: CBU {{NUMERO_DE_CUENTA}}", largo([PRESENTA, t("CBU: *{{NUMERO_DE_CUENTA}}*\nMonto: {precio}"), CIERRE]) === 2);
comprobar("Perú BCP y Efectivo: BCP: {{NUMERO_DE_CUENTA}}", largo([PRESENTA, t("🏦 BCP: {{NUMERO_DE_CUENTA}}"), CIERRE]) === 2);
comprobar("con espacios y minúsculas: {{ numero_de_cuenta }}", largo([PRESENTA, t("Cuenta {{ numero_de_cuenta }}"), CIERRE]) === 2);
comprobar("una cuenta nombrada: {{CUENTA_YAPE}}", largo([PRESENTA, t("📲 Yape: {{CUENTA_YAPE}}"), CIERRE]) === 2);
comprobar("los otros nombres del mismo comodín: {{CUENTA}}", largo([PRESENTA, t("Cuenta: {{CUENTA}}"), CIERRE]) === 2);
comprobar("y queda lo que lleva los datos, en su orden", m.sinLaPresentacionDeSiempre([PRESENTA, t("CBU {{NUMERO_DE_CUENTA}}"), CIERRE])[0].body_variants[0].startsWith("CBU"));

console.log("\n— 2. lo que ya funcionaba sigue igual —\n");
comprobar("{{METODO_DE_PAGO_1}} se sigue reconociendo", largo([PRESENTA, t("{{METODO_DE_PAGO_1}}"), CIERRE]) === 2);
comprobar("la cuenta escrita a mano también", largo([PRESENTA, t("Yape 935 286 681"), CIERRE]) === 2);

console.log("\n— 3. cuando no se sabe, no se quita nada (la respuesta horrible no vuelve) —\n");
comprobar("ninguna burbuja con datos: salen todas", largo([PRESENTA, t("A nombre de: {{NOMBRE_RECEPTOR}}"), CIERRE]) === 3);
comprobar("la primera ya lleva la cuenta: salen todas", largo([t("CBU {{NUMERO_DE_CUENTA}}"), CIERRE]) === 2);
comprobar(
  "una imagen delante (puede ser el QR): salen todas",
  largo([{ type: "image", caption: "" }, t("CBU {{NUMERO_DE_CUENTA}}"), CIERRE]) === 3
);
comprobar("el precio solo no es una cuenta: {precio}", largo([PRESENTA, t("Monto: {precio}"), CIERRE]) === 3);
comprobar("el receptor solo no es una cuenta", largo([PRESENTA, t("{{NOMBRE_RECEPTOR}}"), CIERRE]) === 3);

console.log("\n— 4. las otras partes del bot no cambian —\n");
comprobar(
  "unTextoLlevaLosDatosParaPagar sigue sin contar el comodín de cuenta",
  m.unTextoLlevaLosDatosParaPagar("CBU {{NUMERO_DE_CUENTA}}") === false,
  "la usan handler.ts y los cuadritos"
);
comprobar(
  "y sigue reconociendo lo de siempre",
  m.unTextoLlevaLosDatosParaPagar("{{METODO_DE_PAGO_2}}") && m.unTextoLlevaLosDatosParaPagar("CBU 1430001713024677890018")
);
const llamadas = [...MOTOR.matchAll(/sinLaPresentacionDeSiempre\(/g)].length - 1;
comprobar("los sitios que quitan la presentación son los mismos", llamadas === 8, `${llamadas} llamadas`);

console.log("");
if (fallos > 0) {
  console.log(`${fallos} FALLA(S)`);
  process.exit(1);
}
console.log("TODO OK — el reenvío ya no repite la frase de primera vez, y donde no se sabe no quita nada");
