// La hora de los horarios es la del país configurado, y el cartel lo dice.
//
// LO QUE PASO — 15 de septiembre de 2026. El dueño pensaba compartir el bot con
// alguien de otro país y preguntó: «entré a los ajustes y me dice Hora Perú;
// entonces si lo comparto a alguien de Argentina para que lo programe, ¿cómo
// será? ¿verá hora Perú?».
//
// EL MOTOR SI LO RESPETABA. `quiet-hours.ts` lee el país de la configuración,
// calcula el desfase con `Intl` y hasta maneja el horario de verano —su propio
// comentario nombra a Chile por eso—. Si algo falla, cae a Perú.
//
// EL CARTEL NO. Decia «hora Perú» escrito a mano, pasara lo que pasara con el
// selector de país. Quien clonara el bot para otro país lo configuraria bien y
// seguiria leyendo «Perú»: pensaria que esta mal puesto cuando estaba bien.
//
// Lo pidio asi: «que mejor salga al lado del reloj la banderita del país».
//
//   node scripts/prueba-la-hora-es-la-del-pais.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8").replace(/\r\n/g, "\n");
const editor = leer("src", "app", "editor", "page.tsx");
const horas = leer("src", "lib", "workflow", "quiet-hours.ts");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// ── 1. EL MOTOR, QUE YA ESTABA BIEN Y NO SE TOCA ────────────────────────────
console.log("\n— la hora sale del país configurado —\n");
comprobar(
  "la zona horaria sale de la configuración",
  /const tz = getCountryInfo\(loadWorkflowConfig\(\)\?\.country\)\.timezone;/.test(
    horas
  ),
  "no está fija"
);
comprobar(
  "y se calcula con Intl, que entiende de horario de verano",
  /new Intl\.DateTimeFormat\(/.test(horas) && /timeZone: tz/.test(horas),
  "Chile cambia dos veces al año"
);
comprobar(
  "si algo falla, cae a un país conocido y no se rompe",
  /cae a Per/.test(horas),
  "red de seguridad"
);

// ── 2. Y EL CARTEL LO DICE ──────────────────────────────────────────────────
console.log("\n— y el cartel ya no miente —\n");
// EL CARTEL SE ARMA CON EL PAIS PUESTO, no con un nombre escrito a mano.
comprobar(
  "el cartel lee el país de la configuración",
  /COUNTRY_OPTIONS\.find\(\(p\) => p\.code === \(cfg\.country \?\? "PE"\)\)/.test(
    editor
  ),
  "el que esté elegido"
);
comprobar(
  "y las banderas viven en un solo sitio",
  /\{ code: "AR", label: "🇦🇷 Argentina"/.test(editor) &&
    /\{ code: "PE", label: "🇵🇪 Peru"/.test(editor),
  "COUNTRY_OPTIONS"
);
// LO QUE NO PUEDE VOLVER: un pais escrito a mano en ese cartel.
comprobar(
  "ya no dice «hora Perú» escrito a mano",
  !/Horarios permitidos \(hora Perú/.test(editor),
  "se fue"
);
comprobar(
  "y avisa de que los horarios se mueven con el país",
  /estos horarios se mueven con él/.test(editor),
  "para quien lo clone"
);
// Y LO DE «SEPARADOS POR COMA» TAMPOCO ERA VERDAD EN ESTE CARTEL: hace tiempo
// que son relojes, uno por horario.
//
// Se mira SOLO este cartel, no el archivo entero: el campo de las ráfagas sigue
// siendo un texto con comas de verdad, y ahí esa frase es correcta. Una
// comprobación demasiado amplia habría obligado a cambiar un texto que no está
// mal — que es justo lo que no se hace aquí.
const cartelDeHorarios = (() => {
  const i = editor.indexOf("Horarios permitidos");
  const f = editor.indexOf("</p>", i);
  return i < 0 || f < 0 ? "" : editor.slice(i, f);
})();
comprobar("se encuentra el cartel de los horarios", cartelDeHorarios.length > 50);
comprobar(
  "ni promete comas que ya no existen",
  !/separados por coma/.test(cartelDeHorarios),
  "ahora es un reloj por horario"
);

console.log(
  fallos === 0
    ? "\nTODO OK — la hora es la del país, y el cartel lo dice\n"
    : `\n${fallos} comprobacion(es) mal.\n`
);
process.exit(fallos === 0 ? 0 : 1);
