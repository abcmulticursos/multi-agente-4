// EL «SÍ» A LO QUE EL BOT PROPUSO ELIGE — Y TAMBIÉN CAMBIA DE ELECCIÓN.
//
// LO QUE COSTÓ — 16 de septiembre de 2026, -DOU-, conversación HELLO1 del dueño.
// El modelo cerró así:
//
//     «¿Te gustaría llevarte el <opción mayor>? Solo son S/. <su precio>
//      — dime y te indico cómo adquirirlo 🙌»
//
// Él dijo «si». La elección NO se registró. Sin elección registrada el motor
// suelta el turno, contestó el modelo, y al escribir su método de pago le
// volvieron a pedir que eligiera entre las dos opciones.
//
// POR QUÉ FALLÓ. La guarda de «esto propone comprar» era UNA LISTA DE FRASES, y
// se escribió creyendo que valía «porque las escribe el bot, y el bot escribe
// siempre igual». Falso: las burbujas de conversación LAS REDACTA EL MODELO, que
// improvisa el cierre cada vez. Ninguna de sus diecisiete frases cazaba esa.
//
// EL CAMINO NUEVO no mira cómo se redacta: mira EL PRECIO, que sale de la
// configuración del dueño. Si la burbuja lleva el importe de UNA de las dos
// opciones y no el de la otra, está proponiendo esa.
//
// Y NO QUEDA FIJA. Lo pidió el dueño con estas palabras: «que eso que vas a
// implementar también pueda cambiar de elección si el bot lo propone; que
// "quieres llevar el combo a 14" no quede fijo». Por eso la misma lectura la
// usan LAS DOS puertas —elegir y cambiar— y siempre sobre la ÚLTIMA burbuja del
// bot: la propuesta nueva manda sobre la vieja.
//
//   node scripts/prueba-la-propuesta-del-bot-no-queda-fija.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8").replace(/\r\n/g, "\n");
const fuente = leer("src", "lib", "workflow", "config.ts");
const motor = leer("src", "lib", "workflow", "engine.ts");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 56)} ${valor}`);
};

// ── LA FUNCIÓN REAL, sacada del archivo y corrida de verdad ─────────────────
const trozo = (() => {
  const i = fuente.indexOf("export function laOpcionQueElBotPropuso(");
  if (i < 0) return "";
  const f = fuente.indexOf("\n}", i);
  return f < 0 ? "" : fuente.slice(i, f + 2);
})();
if (!trozo) {
  console.log("\nFALLA  no se encuentra laOpcionQueElBotPropuso en config.ts\n");
  process.exit(1);
}
const js = trozo
  .replace("export function laOpcionQueElBotPropuso(", "function laOpcionQueElBotPropuso(")
  .replace(/ultimaDelBot: string/, "ultimaDelBot")
  .replace(/config: WorkflowConfig \| null/, "config")
  // El argumento opcional que llego el 25/09 —`elClienteYaTieneUnaElegida`, ver
  // `prueba-el-si-al-cambio-que-propone-el-bot`—. Aqui no se pasa nunca.
  .replace(/,\s*\r?\n\s*opciones\?: \{[\s\S]*?\r?\n\s*\}\s*\r?\n/, ",\n  opciones\n")
  .replace(/\): "combo" \| "basico" \| null \{/, ") {")
  .replace(/\(t: string \| undefined \| null\): string =>/, "(t) =>")
  .replace(/\(o: OrderBumpOption \| undefined\): number\[\] =>/, "(o) =>")
  .replace(/\(aguja: string\): number =>/, "(aguja) =>")
  .replace(/\.filter\(\(n\): n is number =>/, ".filter((n) =>");

// NOMBRES INVENTADOS, Y A PROPÓSITO CON EL DE LA MENOR DENTRO DEL DE LA MAYOR:
// es la forma normal de nombrar estas ofertas y la que deja a la menor sin
// ninguna palabra propia. Una prueba con nombres que no se solapan taparía
// justo el caso difícil.
const MENOR = { name: "CUADERNO AZUL", price_soles: 20 };
const MAYOR = { name: "COMBO CUADERNO AZUL + LAPICES", price_soles: 35 };

const palabras = (t) =>
  new Set(
    (t ?? "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Mn}/gu, "")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()
      .split(" ")
      .filter(Boolean)
  );
const tokMenor = palabras(MENOR.name);
const tokMayor = palabras(MAYOR.name);

const sandbox = {
  getActiveTwoTierOffer: () => ({ combo: MAYOR, basico: MENOR }),
  tokensPropiosDeCadaOpcion: () => ({
    compartidos: new Set([...tokMayor].filter((t) => tokMenor.has(t))),
    comboSolo: new Set([...tokMayor].filter((t) => !tokMenor.has(t))),
    basicoSolo: new Set([...tokMenor].filter((t) => !tokMayor.has(t))),
  }),
};
const laOpcionQueElBotPropuso = new Function(
  "getActiveTwoTierOffer",
  "tokensPropiosDeCadaOpcion",
  `${js}\nreturn laOpcionQueElBotPropuso;`
)(sandbox.getActiveTwoTierOffer, sandbox.tokensPropiosDeCadaOpcion);

const lee = (t) => laOpcionQueElBotPropuso(t, {});

// ── 1. SU CASO, el que costó ────────────────────────────────────────────────
console.log("\n— el cierre que el modelo improvisa, con el precio —\n");
comprobar(
  "«¿te gustaría llevarte el COMBO? solo son 35»",
  lee("¿Te gustaría llevarte el COMBO CUADERNO AZUL + LAPICES? Solo son S/. 35 — dime y te indico cómo adquirirlo 🙌") === "combo",
  "su HELLO1"
);
comprobar(
  "y nombrándolo corto, como lo escribe el modelo",
  lee("¿Te gustaría llevarte el COMBO? Solo son S/. 35 🙌") === "combo",
  "«el COMBO» a secas"
);
comprobar(
  "lo mismo proponiendo la menor",
  lee("¿Te animaría el CUADERNO AZUL? Son solo S/. 20 😊") === "basico",
  "por su precio"
);
// EL TURNO PARTIDO EN BURBUJAS, que es como habla el bot de verdad. El nombre
// va en la primera y la pregunta en la última; juntas se entiende, sueltas no.
// Aquí se comprueba lo que la función recibe ya unido; que el motor lo una es
// lo que se comprueba más abajo.
comprobar(
  "el nombre en una burbuja y la pregunta en otra",
  lee(
    "¡Claro! El COMBO CUADERNO AZUL + LAPICES incluye los dos productos juntos:\n" +
      "• los lapices de 50 colores\n" +
      "• el cuaderno de tapa dura\n" +
      "Es la combinación perfecta, y te queda en S/. 35\n" +
      "¿Te gustaría ir por esa opción?"
  ) === "combo",
  "su HHEELLOO3"
);

// ── 2. LO QUE YA FUNCIONABA, intacto ────────────────────────────────────────
console.log("\n— y la lista de siempre sigue cazando lo suyo —\n");
comprobar(
  "un cierre SIN precio sigue entrando por la lista",
  lee("¿Te animas con el COMBO CUADERNO AZUL + LAPICES?") === "combo",
  "no se quitó nada"
);
comprobar(
  "«¿lo quieres?» nombrando la menor, sin precio",
  lee("El CUADERNO AZUL es justo lo que necesitas, ¿lo quieres?") === "basico",
  "igual que antes"
);

// ── 3. LOS FRENOS, que son lo que no se puede haber roto ────────────────────
console.log("\n— y lo que NO puede elegir sigue sin elegir —\n");
comprobar(
  "con las DOS y sus dos precios, no elige nada",
  lee("Tenemos el COMBO CUADERNO AZUL + LAPICES a S/. 35 y el CUADERNO AZUL a S/. 20, ¿cuál prefieres?") === null,
  "es el menú, no una propuesta"
);
comprobar(
  "con las dos nombradas aunque falte un precio",
  lee("¿Quieres el COMBO CUADERNO AZUL + LAPICES o el CUADERNO AZUL?") === null,
  "sigue sin poder decidirse"
);
comprobar(
  "una pregunta que no propone comprar ni pone precio",
  lee("¿Ya trabajaste antes con el CUADERNO AZUL?") === null,
  "el freno que destapó el recorrido"
);
comprobar(
  "un número que no es ninguno de los dos precios",
  lee("¿Ya probaste las 50 unidades del COMBO?") === null,
  "50 no es un precio suyo"
);
// EL MENÚ, SALGA COMO SALGA. Medido contra las conversaciones reales del dueño:
// su recordatorio de las dos opciones salía con el MISMO nombre repetido, una
// vez con cada precio; y en otras con el mismo precio dos veces. Preguntar «¿usa
// los dos precios?» no lo caza. Contar importes, sí.
comprobar(
  "el recordatorio con un nombre repetido y dos precios",
  lee("Recuerda que tenemos 2 productos, ¿cuál eliges? COMBO CUADERNO AZUL + LAPICES Precio S/. 35 — COMBO CUADERNO AZUL + LAPICES Precio S/. 20") === null,
  "es el menú, aunque el nombre esté mal"
);
comprobar(
  "y con el MISMO precio repetido dos veces",
  lee("Recuerda que tenemos 2 productos, ¿cuál eliges? CUADERNO AZUL Precio S/. 20 — CUADERNO AZUL Precio S/. 20") === null,
  "dos importes, dos opciones"
);
comprobar(
  "sin texto no hay propuesta",
  lee("") === null,
  ""
);

// ── 4. QUE LAS DOS PUERTAS LEAN IGUAL ───────────────────────────────────────
console.log("\n— y la misma lectura en las dos puertas —\n");
comprobar(
  "hay UNA sola función que lee la propuesta del bot",
  (motor.match(/function laPropuestaDelBotQueElClienteAfirmo\(/g) ?? []).length === 1,
  "una regla, no dos"
);
// TRES USOS: elegir, cambiar, y el espejo que decide si el turno se aparta.
// Se cuentan las apariciones MENOS la declaración, sin exigir que la llamada
// quepa en una línea: el formateador la parte cuando le conviene y eso no es un
// fallo del bot.
const usos = motor
  .split("\n")
  .filter((linea) => {
    const l = linea.trim();
    if (!l.includes("laPropuestaDelBotQueElClienteAfirmo")) return false;
    if (l.startsWith("//") || l.startsWith("*")) return false; // el comentario que la cita
    return !l.startsWith("function ");
  }).length;
comprobar(
  "y la usan las dos puertas y el espejo",
  usos === 3,
  `elegir, cambiar y apartar (${usos})`
);
comprobar(
  "en el cambio va DESPUÉS de lo que dijo el cliente",
  /inferTwoTierChoiceFromContext\([\s\S]{0,400}?\) \?\?\s*\n(?:\s*\/\/[^\n]*\n)*\s*laPropuestaDelBotQueElClienteAfirmo\(/.test(
    motor
  ),
  "si el cliente nombra, manda el cliente"
);
comprobar(
  "y solo cambia si es DISTINTA de la que ya tenía",
  /otra !== convo\.order_bump_choice/.test(motor),
  "proponer la misma no reenvía nada"
);
comprobar(
  "exige que el bot dejara una pregunta abierta",
  /if \(!\/\[\?¿\]\/\.test\(loUltimoQueDijoElBot\)\) return null;/.test(motor),
  "lo escribe el bot, que sí puntúa"
);
// ESTA COMPROBACIÓN CONSERVA SU INTENCIÓN Y CAMBIA DE FORMA — 3 de octubre de 2026.
//
// Pedía el nombre EXACTO del detector: `if (!detectaSiSimpleAlUpsell(msgContent)) return
// null;`, con el motivo «el mismo detector que el extra». Lo que protege es que haga falta
// un «sí» PELADO para dar por afirmada la propuesta del bot, y eso sigue igual.
//
// POR QUÉ CAMBIÓ LA FORMA. Midiendo las tres semimodalidades del dueño aparecio que en
// COMO -DOU- «esta bien», «vale», «de acuerdo» y «listo» NO anotaban la eleccion, y en las
// otras dos sí. Ahora la puerta acepta ese detector O `soloEstaDeAcuerdo`, que es TAMBIÉN
// un «sí» pelado: compara el mensaje ENTERO y exige que no diga nada más, así que
// «si pero no es estafa» sigue sin anotar nada.
//
// LO QUE SE VIGILA AHORA, que es lo mismo de antes dicho con dos nombres: que la puerta
// siga exigiendo un sí pelado, y que los DOS detectores sean de los que comparan la frase
// entera. Si mañana alguien mete aquí uno que mire «en cualquier parte», esto se pone rojo
// — y con razón: `isPurchaseAffirmative` dice sí a «quiero SABER qué contiene».
comprobar(
  "y que el cliente dijera un «sí» pelado",
  /if \(!dijoQueSi\) return null;/.test(motor) &&
    /detectaSiSimpleAlUpsell\(msgContent\)/.test(motor) &&
    /soloEstaDeAcuerdo\(msgContent\)/.test(motor),
  "los dos detectores comparan la frase entera"
);
// SU TURNO ENTERO, NO LA ÚLTIMA BURBUJA.
//
// LO QUE COSTÓ — 16/09/2026, conversación HHEELLOO3, convo 136. El bot contestó
// en CUATRO burbujas: el nombre de la opción iba en la primera y en la última
// solo quedaba «¿te gustaría ir por esa opción?». Leyendo solo la última no hay
// ni nombre ni precio. El cliente dijo «si» dos veces y no se registró ninguna.
// Y no son cuatro siempre: el dueño lo corrigió — «manda hasta 5, a veces 6».
comprobar(
  "junta TODAS las burbujas de su último turno",
  /for \(let i = historia\.length - 1; i >= 0; i--\)[\s\S]{0,260}?suTurno\.unshift\([\s\S]{0,160}?else if \(suTurno\.length > 0\) break;/.test(
    motor
  ),
  "cuatro, cinco o seis: las que haya"
);
comprobar(
  "y con ventana holgada, para no cortar un turno largo",
  /getRecentHistory\(convo\.id, 30\)/.test(motor),
  "cortarlo haría que medio menú pareciera oferta"
);
comprobar(
  "y para al llegar al cliente: ese turno y no el anterior",
  /else if \(suTurno\.length > 0\) break;/.test(motor),
  "la propuesta nueva manda sobre la vieja"
);

// ── 5. NADA DE PRODUCTOS NI PRECIOS EN EL CÓDIGO ────────────────────────────
console.log("\n— y sigue siendo una plantilla —\n");
const bloque = (() => {
  const i = fuente.indexOf("const conElPrecioDeUnaSola");
  return i < 0 ? "" : fuente.slice(i, i + 200);
})();
comprobar(
  "el importe sale de la configuración, no del código",
  /conElPrecioMayor !== conElPrecioMenor/.test(bloque),
  "ni un número escrito a mano"
);

console.log(
  fallos === 0
    ? "\nTODO OK — el «sí» a la propuesta del bot elige, y también cambia\n"
    : `\n${fallos} comprobacion(es) mal.\n`
);
process.exit(fallos === 0 ? 0 : 1);
