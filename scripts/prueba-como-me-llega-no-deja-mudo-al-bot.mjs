// Preguntar «como me llega» no puede dejar al bot mudo.
//
// LO QUE PASO — 14 de septiembre de 2026
//
//   Tres conversaciones en paralelo, las tres con los datos de pago ya
//   enviados. El dueno pregunto de cuatro formas distintas como le llega el
//   producto:
//
//       «como me va a llegar»      -> «¡Excelente pregunta! 😊»  y silencio
//       «como me van a enviar»     -> «¡Claro»                   y silencio
//       «como me hacen llegar»     -> «¡Claro»                   y silencio
//       «me lo puede mandar por shalom» -> «¡Claro»              y silencio
//
//   Escribio «?» y ahi si le contesto entero: que el producto llega por un
//   enlace de Google Drive a ese mismo chat. La respuesta estaba; no salia.
//
//   En el registro no habia ni una linea que lo explicara. Solo dos llamadas
//   al modelo donde deberia haber una, con el segundo prompt exactamente 49
//   tokens mas gordo que el primero: 7266->7315, 6777->6826, 7093->7142,
//   7281->7330, 6570->6619, 6576->6625. Esos 49 tokens son el mensaje que la
//   guarda anti-presion empuja al reintentar.
//
// POR QUE
//
//   La guarda existe para que, con el pago ya pedido, el bot no le repita al
//   cliente que mande el comprobante cuando el cliente pregunto otra cosa. Eso
//   esta bien y se queda. Pero decidia si el bot estaba atosigando con UNA
//   sola prueba: que su respuesta llevara una de cinco palabras. Y `recibo` es
//   TAMBIEN un verbo. «apenas recibo tu pago te llega el enlace» no atosiga a
//   nadie: es la respuesta. Con eso la guarda reintentaba y, al segundo
//   intento, recortaba el texto por el punto anterior a esa palabra. Lo que
//   quedaba era el saludo.
//
// LAS TRES PIEZAS QUE SE PRUEBAN AQUI
//
//   1. El verbo «recibo» ya no cuenta como presion; el sustantivo si.
//   2. Si el cliente pregunto COMO LE LLEGA, la guarda se aparta entera.
//   3. Y nunca se entrega un recorte que no contesta nada.
//
//   node scripts/prueba-como-me-llega-no-deja-mudo-al-bot.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const fuente = readFileSync(join(RAIZ, "src", "lib", "openrouter.ts"), "utf8");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 56)} ${valor}`);
};

// ── Las funciones reales, sacadas del archivo ────────────────────────────────
const trozo = (desde, hasta) => {
  const i = fuente.indexOf(desde);
  if (i < 0) throw new Error(`no encuentro: ${desde}`);
  const f = fuente.indexOf(hasta, i);
  return fuente.slice(i, f < 0 ? undefined : f + hasta.length);
};

const declaraciones = [
  trozo("const PALABRAS_DEL_COMPROBANTE =", "\n"),
  trozo("const EL_RECIBO_COMO_COSA =", ";"),
  trozo("function laRespuestaPresionaConElComprobante(", "\n}"),
  trozo("const VERBOS_DE_ENTREGA =", ";"),
  trozo("function elClientePreguntoPorLaEntrega(", "\n}"),
  trozo("function elRecorteTodaviaContesta(", "\n}"),
  trozo("function cabezaHastaElParrafoDe(", "\n}"),
  trozo("const DONDE_SE_NOMBRA_EL_COMPROBANTE =", ";"),
]
  .join("\n\n")
  .replace(/: string/g, "")
  .replace(/: boolean/g, "")
  .replace(/: number/g, "")
  .replace(/: RegExpExecArray \| null/g, "");

const hacer = (llamada) =>
  new Function(`${declaraciones}\nreturn ${llamada};`)();
const presiona = (t) =>
  hacer(`laRespuestaPresionaConElComprobante(${JSON.stringify(t)})`);
const preguntaEntrega = (t) =>
  hacer(`elClientePreguntoPorLaEntrega(${JSON.stringify(t)})`);
const recorteSirve = (t) =>
  hacer(`elRecorteTodaviaContesta(${JSON.stringify(t)})`);

// ── 1. El verbo «recibo» no es una peticion ──────────────────────────────────
console.log("\n— «recibo» es un verbo, no siempre una cosa —\n");
comprobar(
  "«apenas recibo tu pago te llega el enlace» -> NO presiona",
  presiona("apenas recibo tu pago te llega el enlace de drive") === false,
  "es la respuesta, no un recordatorio"
);
comprobar(
  "«en cuanto recibo la confirmacion» -> NO presiona",
  presiona("en cuanto recibo la confirmacion te mando el acceso") === false,
  "igual"
);
comprobar(
  "«mandame tu recibo» -> SI presiona",
  presiona("mandame tu recibo por favor") === true,
  "el sustantivo se queda"
);
comprobar(
  "«enviame el recibo» -> SI presiona",
  presiona("enviame el recibo cuando puedas") === true,
  "articulo delante"
);

console.log("\n— y las otras cuatro palabras no se han tocado —\n");
for (const frase of [
  "mandame la foto del comprobante",
  "necesito tu voucher",
  "enviame una imagen del pago",
  "manda tus recibos",
]) {
  comprobar(`«${frase}» -> SI presiona`, presiona(frase) === true, "como antes");
}

// ── 2. Si pregunto como le llega, la guarda se aparta ────────────────────────
console.log("\n— y si el cliente pregunto COMO LE LLEGA, se aparta —\n");
for (const frase of [
  "como me va a llegar",
  "como me van a enviar",
  "como me envian",
  "como me llega",
  "como me hacen llegar",
  "que me van a enviar",
  "que me van a mandar",
  "me lo puede mandar por shalom",
  "y eso como me lo entregan despues de pagar",
]) {
  comprobar(
    `«${frase}» -> es pregunta de entrega`,
    preguntaEntrega(frase) === true,
    "la guarda no se mete"
  );
}

// LAS ERRATAS TAMBIEN, que asi es como se escribe en WhatsApp. Estas dos salieron
// de sus propias pruebas: una letra de menos y una palabra pegada a la siguiente.
console.log("\n— y con erratas tambien, que asi escribe la gente —\n");
for (const frase of [
  "me lo puede envir por shalom",
  "si me mandapor shalom",
  "me lo enviaran a mi casa",
]) {
  comprobar(
    `«${frase}» -> es pregunta de entrega`,
    preguntaEntrega(frase) === true,
    "por la raiz, no por la forma"
  );
}

console.log("\n— pero no cualquier cosa se cuela por esa puerta —\n");
for (const frase of [
  "ya te mande el comprobante",
  "cuanto cuesta el combo",
  "no tengo yape tengo plin",
  "ya pague",
]) {
  comprobar(
    `«${frase}» -> NO es pregunta de entrega`,
    preguntaEntrega(frase) === false,
    "la guarda sigue en pie"
  );
}

// ── 3. Nunca un recorte que no contesta nada ─────────────────────────────────
console.log("\n— y un recorte que no contesta nada no se entrega —\n");
comprobar(
  "«¡Claro» -> NO sirve como respuesta",
  recorteSirve("¡Claro") === false,
  "sale la del modelo entera"
);
comprobar(
  "«¡Excelente pregunta! 😊» -> NO sirve",
  recorteSirve("¡Excelente pregunta! 😊") === false,
  "los emojis no cuentan"
);
comprobar(
  "«» (vacio) -> NO sirve",
  recorteSirve("") === false,
  "nunca se manda vacio"
);
comprobar(
  "una respuesta de verdad -> SI sirve",
  recorteSirve(
    "Te llega por este mismo chat un enlace de Google Drive con todo el material listo para descargar 📲"
  ) === true,
  "el recorte se queda, como antes"
);

// ── 3 bis. EL CORTE CAE EN UN PARRAFO, NUNCA A MEDIA FRASE ───────────────────
//
// SEGUNDA TANDA DE PRUEBAS DEL DUENO, el mismo dia. Pregunto «no es estafa» con
// los datos de pago ya enviados y le llego cortado en seco:
//
//     «Somos una tienda real con muchos clientes satisfechos. El pago es unico
//      de *S/»
//
// El corte buscaba el punto anterior a la palabra y lo encontro DENTRO del
// importe: «S/. 10 soles». Un precio lleva punto, y ese punto no termina
// ninguna frase. Le paso en DOS de tres ventanas; en la tercera la conversacion
// estaba en otra etapa y la guarda ni se miro. En el registro quedo escrito:
//
//     [llm:guardarail] convo 77: quito el recordatorio del comprobante del
//     final de la respuesta
console.log("\n— el corte cae en un parrafo, nunca a media frase —\n");
const cabezaDe = (t) =>
  hacer(
    `cabezaHastaElParrafoDe(${JSON.stringify(t)}, ${JSON.stringify(t)}.search(DONDE_SE_NOMBRA_EL_COMPROBANTE))`
  );

const EL_CASO_DEL_DUENO =
  "¡Claro que no es estafa! 😊 Entiendo tu preocupación, es importante asegurarse. Te explico:\n\n" +
  "Somos una tienda real con muchos clientes satisfechos. El pago es único de *S/. 10 soles* y el material lo recibes al instante apenas verifiquemos tu comprobante.";
comprobar(
  "el punto de «S/. 10 soles» ya no parte la frase",
  !cabezaDe(EL_CASO_DEL_DUENO).endsWith("*S/"),
  "nada de media idea"
);
// Y AUNQUE HAYA CORTE DE PARRAFO, LO QUE QUEDA NO PUEDE COLGAR. Aqui la cabeza
// es «…es importante asegurarse. Te explico:»: tiene palabras de sobra y no
// contesta nada, porque la explicacion venia en el parrafo que se iba a quitar.
comprobar(
  "el recorte de su caso deja «Te explico:» colgando",
  cabezaDe(EL_CASO_DEL_DUENO).endsWith("Te explico:"),
  "ese seria el recorte"
);
comprobar(
  "y por eso NO se entrega: sale la respuesta entera",
  recorteSirve(cabezaDe(EL_CASO_DEL_DUENO)) === false,
  "una promesa sin cumplir no es una respuesta"
);
for (const colgando of [
  "Te explico con calma lo que incluye:",
  "Mira todo lo que te llevas,",
  "Son varias cosas y te las detallo;",
]) {
  comprobar(
    `«…${colgando.slice(-14)}» -> NO sirve`,
    recorteSirve(colgando) === false,
    "la frase sigue en otro sitio"
  );
}

const NAG_EN_SU_BURBUJA =
  "Te llega por este mismo chat un enlace de Google Drive con todo el material 📲\n\n" +
  "Recuerda mandarme la foto de tu comprobante para darte el acceso.";
comprobar(
  "pero el recordatorio en SU burbuja si se quita",
  cabezaDe(NAG_EN_SU_BURBUJA) ===
    "Te llega por este mismo chat un enlace de Google Drive con todo el material 📲",
  "el anadido del final"
);
comprobar(
  "y lo que queda es una frase completa",
  !/[,;:]$/.test(cabezaDe(NAG_EN_SU_BURBUJA)),
  "no queda colgando"
);
comprobar(
  "sin ningun corte de parrafo delante, no se recorta",
  cabezaDe("Mandame tu comprobante y listo") === "",
  "la mencion era la respuesta"
);

// ── 4. Y la guarda usa las tres, y ahora deja rastro ─────────────────────────
console.log("\n— la guarda las usa, y escribe lo que hace —\n");
const guarda = trozo(
  "        answerOnlyWhileAwaitingPayment &&",
  "      }\n"
);
comprobar(
  "la guarda pregunta por la entrega antes de meterse",
  /!elClientePreguntoPorLaEntrega\(payingNowText\)/.test(guarda),
  "pieza 2"
);
comprobar(
  "y usa el detector que separa el verbo del sustantivo",
  /laRespuestaPresionaConElComprobante\(text\)/.test(guarda),
  "pieza 1"
);
comprobar(
  "y solo recorta si lo que queda contesta",
  /const cabezaSirve = elRecorteTodaviaContesta\(cabeza\);/.test(guarda) &&
    /if \(cabezaSirve\) \{/.test(guarda),
  "pieza 3"
);
comprobar(
  "y el recorte sale del corte de parrafo, no del punto",
  /const cabeza = cabezaHastaElParrafoDe\(text, dondeSeNombra\);/.test(guarda) &&
    !/\[\.!\?\]/.test(guarda),
  "pieza 4"
);
comprobar(
  "si el recorte no sirve, NO devuelve nada: sigue y sale la del modelo",
  !/if \(cabezaSirve\) \{[\s\S]*?return[\s\S]*?\n        \}\n        if \(paymentAnswerFallback\) \{[\s\S]*?\n        \}\n        return/.test(
    guarda
  ),
  "el silencio es peor que la mencion"
);
comprobar(
  "y deja constancia en el registro",
  (guarda.match(/\[llm:guardarail\]/g) ?? []).length >= 3,
  "antes no escribia ni una linea"
);
comprobar(
  "el freno de «va a pagar ahora» sigue en pie",
  /!customerSignalsPaying &&/.test(guarda),
  "ahi el recordatorio SI corresponde"
);
comprobar(
  "y solo con los datos de pago ya enviados",
  /answerOnlyWhileAwaitingPayment &&/.test(guarda),
  "payment_done, como siempre"
);

// ── 6. LA INSTRUCCION DEL TURNO: «me lo mandan por <mensajeria>» ─────────────
//
// Probando la misma pregunta de cuatro formas, el bot acerto con «me lo mandan
// por <mensajeria>» —«es digital, no se envia por ningun servicio de
// mensajeria»— y fallo con «me envian por <mensajeria>»: «¡Claro que si! 😊 te
// envio el enlace al instante». No dijo que lo mandaba por ahi, pero el cliente
// quedo con esa idea, y eso es tan malo como decirlo.
//
// La frase lleva DOS preguntas dentro —«¿me lo mandan?» y «¿por ese medio?»— y
// el modelo contesta la primera.
console.log("\n— la instruccion que solo existe en ese turno —\n");
const turno = (() => {
  const i = fuente.indexOf("if (elClientePreguntoPorLaEntrega(payingNowText)) {");
  const f = fuente.indexOf("\n  }", i);
  return i < 0 ? "" : fuente.slice(i, f);
})();
comprobar(
  "existe, y solo en el turno de la pregunta",
  turno.length > 0,
  "no viaja en todos los mensajes"
);
comprobar(
  "el canal sale de SU contenido, no del codigo",
  /configured in your content/.test(turno) &&
    /never invent another one/.test(turno),
  "aqui no se escribe ningun canal"
);
comprobar(
  "desmiente el envio fisico ANTES de explicar",
  /NOT sent that way/.test(turno) && /and only then say how it does arrive/.test(turno),
  "primero el no, luego el como"
);
comprobar(
  "y prohibe el «claro que si» a secas",
  /Never answer that kind of question with a bare yes/.test(turno),
  "el si suelto era el fallo"
);
comprobar(
  "no nombra ninguna mensajeria ni ningun pais",
  /courier, parcel company, home address or any physical shipping service/.test(
    turno
  ) && !/shalom/i.test(fuente),
  "el nombre lo pone el cliente"
);

console.log(
  fallos === 0
    ? "\nTODO OK — preguntar como le llega ya no deja al bot mudo"
    : `\n${fallos} comprobacion(es) mal.`
);
process.exit(fallos === 0 ? 0 : 1);
