// El bot propone UNA opción, el cliente dice «sí» — y eso ES la elección.
//
// LO QUE PASO — 16 de septiembre de 2026, -DOU-, convo 127 del dueño:
//
//     él:   «cual me recomienda»
//     bot:  «¡Te recomiendo el <opción mayor>! … ¿Te animas con el combo completo?»
//     él:   «si»
//     bot:  «¡Excelente decisión! … Realiza el pago de S/. 14 Soles»
//
// El bot lo entendió perfecto y hasta puso el precio CORRECTO. Pero la elección
// no se registró en ninguna parte. Dos mensajes después él escribió su método de
// pago y, sin opción anotada, el turno cayó por el camino de «pago sin elegir»:
// le llegaron unos datos con un importe que no era de ninguna de las dos
// opciones, y debajo el recordatorio con las dos. Sus palabras: «una mierda de
// respuesta, esto no estaba así».
//
// LAS DOS PUERTAS CERRADAS A LA VEZ, y por eso no se veía:
//
//   · El MODELO no registra porque se lo prohibimos. Su instrucción, literal:
//     «call seleccionar_opcion only after a clear product decision; never for a
//     question, a PRICE question, uncertainty…». Un «sí» pelado no nombra ningún
//     producto, así que para esa orden es «uncertainty».
//   · El MOTOR no registra porque solo mira las palabras del CLIENTE, y ahí no
//     hay ninguna opción nombrada.
//
// Y sin embargo la decisión está entera: repartida entre las dos mitades de la
// conversación. La propuso el bot, la afirmó el cliente.
//
// NO ES UNA REGLA NUEVA, ES UNA QUE FALTABA. El dueño la tiene escrita como
// requisito en CLAUDE.md: «si el bot pregunta "¿deseas adquirirlo?" y el cliente
// afirma —"ok", "sí", "está bien", lo que sea— se reenvían los datos EN EL ACTO».
// Existía para una sola opción, y no para dos.
//
// LOS NOMBRES DE AQUÍ SON INVENTADOS, y con la MISMA FORMA que los suyos: el de
// la opción menor está ENTERO dentro del de la mayor. Esa es la trampa — así la
// menor no tiene ninguna palabra propia y proponerla sería invisible.
//
//   node scripts/prueba-el-si-a-lo-que-el-bot-propuso.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const config = readFileSync(
  join(RAIZ, "src", "lib", "workflow", "config.ts"),
  "utf8"
).replace(/\r\n/g, "\n");
const motor = readFileSync(
  join(RAIZ, "src", "lib", "workflow", "engine.ts"),
  "utf8"
).replace(/\r\n/g, "\n");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 56)} ${valor}`);
};

// ── Los detectores reales, sacados del archivo ───────────────────────────────
const trozo = (fuente, desde, hasta) => {
  const i = fuente.indexOf(desde);
  if (i < 0) return "";
  const f = fuente.indexOf(hasta, i);
  return f < 0 ? "" : fuente.slice(i, f);
};
const funcion = (firma, cierre = "\n}") => {
  const cuerpo = trozo(config, firma, cierre);
  if (!cuerpo) throw new Error(`no encuentro en config.ts:\n  ${firma}`);
  return (
    cuerpo
      .replace(/\((\w+): string\): boolean \{/, "($1) {")
      // La firma entera, con el argumento opcional que llegó el 25/09 —
      // `elClienteYaTieneUnaElegida`, ver `prueba-el-si-al-cambio-que-propone-el-bot`.
      // Aquí NUNCA se pasa: esta prueba fija la PRIMERA elección, que no cambió.
      .replace(
        /\(\s*\n\s*ultimaDelBot: string,[\s\S]*?\n\): "combo" \| "basico" \| null \{/,
        "(ultimaDelBot, config, opciones) {"
      )
      // Los tipos de las funcioncitas de dentro, para poder ejecutarlo tal cual.
      .replace(/\(t: string \| undefined \| null\): string =>/g, "(t) =>")
      .replace(/\(o: OrderBumpOption \| undefined\): number\[\] =>/g, "(o) =>")
      .replace(/\(aguja: string\): number =>/g, "(aguja) =>")
      .replace(/\(n\): n is number =>/g, "(n) =>")
      .replace(/^(?:export )?function /, "function ") + cierre
  );
};

// LOS PRODUCTOS SON INVENTADOS. La forma sí es la suya: el nombre de la menor
// está entero dentro del de la mayor.
const OFERTA = {
  combo: { name: "PACK ESTELAR + LAMINAS", price_soles: 14 },
  basico: { name: "PACK ESTELAR", price_soles: 10 },
};
const stubs = `
  const getActiveTwoTierOffer = () => (${JSON.stringify(OFERTA)});
  const tokensPropiosDeCadaOpcion = () => ({
    comboSolo: new Set(["laminas"]),
    basicoSolo: new Set(),
    compartidos: new Set(["pack", "estelar"]),
  });
`;

const { laOpcionQueElBotPropuso, detectaSiSimpleAlUpsell } = new Function(
  [
    stubs,
    funcion("export function detectaSiSimpleAlUpsell(msg: string): boolean {"),
    funcion("export function laOpcionQueElBotPropuso("),
    "return { laOpcionQueElBotPropuso, detectaSiSimpleAlUpsell };",
  ].join("\n\n")
)();

const cual = (t) => laOpcionQueElBotPropuso(t, null);

// ── 1. EL BOT PROPONE UNA SOLA ──────────────────────────────────────────────
console.log("\n— el bot propone UNA, y se sabe cuál —\n");
comprobar(
  "propone la mayor por su nombre",
  cual("¡Te recomiendo el PACK ESTELAR + LAMINAS! ¿Te animas?") === "combo",
  "la mayor"
);
comprobar(
  "propone la menor por su nombre entero",
  cual("Te recomiendo PACK ESTELAR, que es la opción más cómoda. ¿Te animas?") ===
    "basico",
  "aunque no tenga palabras propias"
);
comprobar(
  "la nombra dentro de una frase larga",
  cual(
    "Por lo que me contás, el PACK ESTELAR + LAMINAS te va a rendir muchísimo más a la larga. ¿Lo confirmamos? 🙌"
  ) === "combo",
  "la mayor"
);

// ── 2. SI PROPUSO LAS DOS, AQUÍ NO SE DECIDE NADA ───────────────────────────
//    ESTA ES LA GUARDA QUE MÁS IMPORTA. Un «sí» después de «¿cuál prefieres?»
//    no puede elegir: es justo lo que no se puede adivinar.
console.log("\n— pero si nombró las DOS, no decide nada —\n");
for (const texto of [
  "Tenemos PACK ESTELAR + LAMINAS y PACK ESTELAR. ¿Cuál prefieres?",
  "El PACK ESTELAR + LAMINAS cuesta más; el PACK ESTELAR es el básico. ¿Cuál te llevas?",
  // Y EL MENSAJE MÁS FRECUENTE DE ESTA ETAPA, con los dos precios.
  "Recuerda que tenemos 2 productos:\nPACK ESTELAR + LAMINAS S/. 14\nPACK ESTELAR S/. 10\n¿Cuál eliges?",
]) {
  comprobar(`«${texto.slice(0, 44)}»`, cual(texto) === null, "no decide");
}
// LOS DOS PRECIOS JUNTOS BASTAN, aunque los nombres vinieran raros: si enseña
// los dos importes está presentando, no proponiendo.
comprobar(
  "con los dos precios en pantalla, tampoco",
  cual("Uno cuesta S/. 14 y el otro S/. 10. ¿Con cuál te quedas?") === null,
  "está presentando"
);
// ── 2.b NI SI LA PREGUNTA NO ERA DE COMPRA ──────────────────────────────────
//    LO DESTAPÓ EL RECORRIDO DE VENTA, antes de que llegara a nadie: una burbuja
//    de la intro que pregunte por la experiencia nombra UNA opción y acaba en
//    «?». Un «sí» a eso es «sí, ya trabajé con eso» — no «me lo llevo».
console.log("\n— ni si la pregunta no era de compra —\n");
for (const texto of [
  "¿Ya trabajaste antes con PACK ESTELAR + LAMINAS?",
  "¿Conoces el PACK ESTELAR + LAMINAS?",
  "El PACK ESTELAR + LAMINAS es de los que más se venden. ¿Tienes alguna duda?",
  "¿Te llegó bien la foto del PACK ESTELAR + LAMINAS?",
]) {
  comprobar(`«${texto.slice(0, 44)}»`, cual(texto) === null, "no es proponer");
}

console.log("\n— ni si no nombró ninguna —\n");
for (const texto of [
  "¿Te animas? 🙌",
  "Es un pago único, sin mensualidades. ¿Alguna otra duda?",
  "",
]) {
  comprobar(`«${texto.slice(0, 44)}»`, cual(texto) === null, "no decide");
}

// ── 3. EL «SÍ» ES EL MISMO DETECTOR QUE YA USA EL PRODUCTO EXTRA ────────────
console.log("\n— y el «sí» lo lee el detector de siempre —\n");
for (const frase of ["si", "sii", "claro", "dale", "ok", "si quiero", "lo quiero"]) {
  comprobar(`«${frase}» afirma`, detectaSiSimpleAlUpsell(frase) === true);
}
// LO QUE NO ES UN «SÍ»: una pregunta, una duda, o nombrar la otra opción.
for (const frase of ["si pero cuanto cuesta", "no", "y el otro", "que trae"]) {
  comprobar(`«${frase}» no afirma`, detectaSiSimpleAlUpsell(frase) === false);
}

// ── 4. EL CABLEADO EN EL MOTOR ──────────────────────────────────────────────
console.log("\n— y dónde se usa —\n");
// LA MISMA EXIGENCIA, QUE AHORA VIVE EN UN SOLO SITIO. Estaba escrita suelta en
// la puerta de elegir; el 16/09 se llevó a `laPropuestaDelBotQueElClienteAfirmo`
// para que la puerta de CAMBIAR de opción leyera exactamente igual. La garantía
// no cambia: sin pregunta abierta del bot, no hay propuesta que afirmar.
comprobar(
  "el bot tiene que haber dejado una pregunta abierta",
  /if \(!\/\[\?¿\]\/\.test\(loUltimoQueDijoElBot\)\) return null;/.test(motor),
  "un «ok» sin pregunta es «entendido»"
);
comprobar(
  "se lee su ÚLTIMO mensaje, no cualquiera",
  /\[\.\.\.getRecentHistory\(convo\.id, 6\)\]\s*\n\s*\.reverse\(\)\s*\n\s*\.find\(\(mensaje\) => mensaje\.role === "assistant"\)/.test(
    motor
  ),
  "el más reciente"
);
comprobar(
  "y entrega por el camino de siempre",
  /await deliverDobleOfertaPaymentDetails\(convo, laQuePropusoElBot\);/.test(motor),
  "su precio y sus burbujas"
);
// VA ANTES DEL «PAGO SIN ELEGIR»: si corriera después, ese camino se comería el
// turno y volvería a soltar el importe que no es. Ese era el desastre.
comprobar(
  "corre ANTES del camino de «pago sin elegir»",
  motor.indexOf("dijo que sí a") <
    motor.indexOf("maybeSendDirectPaymentWithoutChoice(\n        convo,"),
  "si no, vuelve el precio que no era"
);

console.log(
  fallos === 0
    ? "\nTODO OK — el «sí» a lo que el bot propuso ya es una elección\n"
    : `\n${fallos} comprobacion(es) mal.\n`
);
process.exit(fallos === 0 ? 0 : 1);
