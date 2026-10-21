// El bot no promete fotos que no existen.
//
// LO QUE PASO — 15 de septiembre de 2026, con palabras del dueno: «el bot ya
// entrega contenido, eso es genial, pero tambien ofrece imagenes cuando no las
// hay, eso hay que corregir». Lo habia visto varias veces: el bot ofrecia
// muestras, el cliente decia que si, y entonces no llegaba nada y el bot se
// disculpaba.
//
// POR QUE PASABA. Existe un aviso en el prompt —«NO hay imagenes configuradas,
// no ofrezcas»— pero solo entra en los turnos que YA huelen a imagen: cuando el
// cliente pregunta por fotos, muestras o que trae. El ofrecimiento nacia en los
// otros turnos, donde ese aviso no estaba, asi que el modelo no sabia que no
// habia nada. Y al turno siguiente, cuando el cliente decia «si», la guarda se
// encendia por fin... justo a tiempo para disculparse.
//
// POR QUE NO SE ARREGLA CON MAS PROMPT. Lo pregunto el dueno con esta imagen:
// «¿no estamos volviendo a contener un muro, no con una represa sino con una
// pared?». Tiene razon, y es la regla de la casa: en codigo antes que en prompt.
// Pedirle al modelo que no ofrezca depende de que obedezca. Mirar lo que YA
// escribio, no.
//
// ASI QUE SE HACE COMO LOS DEMAS GUARDARAILS de este archivo —el de los bancos
// no configurados, el del precio generico—: el codigo detecta, obliga a
// reescribir una vez, y deja constancia si insiste.
//
// Y LA LINEA QUE NO SE PUEDE CRUZAR, dictada por el: «que el bot no pierda la
// capacidad de enviar imagenes cuando la galeria de fotos tenga una foto».
//
//   node scripts/prueba-no-ofrece-fotos-que-no-tiene.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const src = readFileSync(join(RAIZ, "src", "lib", "openrouter.ts"), "utf8").replace(
  /\r\n/g,
  "\n"
);

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};
/** Saca una funcion del fuente tal cual, para EJECUTARLA de verdad. */
const funcionDe = (nombre) => {
  const i = src.indexOf(`function ${nombre}(`);
  if (i < 0) throw new Error(`no encontre ${nombre}`);
  let j = src.indexOf("{", i);
  let prof = 0;
  for (; j < src.length; j++) {
    if (src[j] === "{") prof++;
    else if (src[j] === "}") {
      prof--;
      if (prof === 0) break;
    }
  }
  return src.slice(i, j + 1);
};

// Se ejecuta el codigo REAL, no una copia escrita de memoria: una reimplementacion
// probaria lo que uno cree que hace, que es justo lo que se esta poniendo en duda.
const cuerpo = [
  funcionDe("normalizeIntentText").replace(/: string \| null \| undefined/g, "").replace(/\): string/g, ")"),
  funcionDe("laRespuestaOfreceMaterialVisual").replace(/: string/g, "").replace(/\): boolean/g, ")"),
  "return laRespuestaOfreceMaterialVisual;",
].join("\n");
const ofrece = new Function(cuerpo)();

// ── 1. LO QUE TIENE QUE CAZAR ───────────────────────────────────────────────
console.log("\n— ofrecimientos, que es lo que no puede salir —\n");
const OFRECE = [
  "¿Te muestro unas fotos del material? 😊",
  "Si quieres te mando unas imágenes de ejemplo",
  "¿Quieres ver unas muestras de cómo queda?",
  "Te puedo enviar fotos para que lo veas mejor",
  "¿Te gustaría que te comparta algunas capturas?",
  "Te dejo unas muestras para que las revises",
  "Ahora te envio unos videos del contenido",
  "puedo mostrarte imagenes si deseas",
  "¿Deseas que te mande el catálogo en fotos?",
];
for (const frase of OFRECE) {
  comprobar(`caza: ${frase.slice(0, 44)}`, ofrece(frase) === true);
}

// ── 2. LO QUE NO PUEDE CAZAR ────────────────────────────────────────────────
//
// Un falso positivo solo cuesta un reintento que reescribe lo mismo, asi que no
// es grave — pero estas son las frases legitimas de todos los dias y molestar en
// ellas seria gastar por nada.
console.log("\n— y lo que debe dejar pasar —\n");
const NO_OFRECE = [
  "Te envío el enlace de descarga ahora mismo 😊",
  "Te mando los datos de pago en un momento",
  "Ya te entregué el acceso a tu material",
  "¿Te gustaría llevarlo? Son S/. 10",
  "Te explico qué contiene: son páginas listas para imprimir",
  "No tengo fotos disponibles de eso, pero te lo explico en texto",
  "No puedo mostrarte imágenes ahora, te lo cuento con palabras",
  "¿Quieres que te indique cómo adquirirlo?",
  "El material se envía por Google Drive",
  "Te comparto el correo para que lo recibas",
  "Perfecto, ya quedó registrado tu pago",
  // ── PEDIR EL COMPROBANTE NO ES OFRECER MUESTRAS ──────────────────────────
  //
  // LO QUE PASÓ — 28 de septiembre de 2026. En su registro, TRES reintentos en
  // una sola conversación, todos en turnos de PAGO y ninguno sobre muestras:
  //
  //     [llm:guardarail] convo 278: ofrecio material visual sin galeria; reintento
  //     [llm:guardarail] convo 278: INSISTE ...; le quito ese parrafo
  //
  // Él preguntó lo que había que preguntar: «hemos quedado que la galería no se
  // iba a activar mientras no tenga fotos, ¿por qué tiene que llamarla?». Y no la
  // llamaba: el freno confundía «mándame la captura del comprobante» —que el bot
  // TIENE que decir— con ofrecer imágenes. Medido, CUATRO de seis frases normales
  // de la etapa de pago daban positivo.
  //
  // Y NO ERA SOLO GASTO: al insistir, el freno QUITA ese párrafo, que es donde se
  // le pide la captura. El cliente se queda sin saber que tiene que mandarla.
  //
  // LA REGLA ES DE DIRECCIÓN, no de palabras: «te envío unas fotos» es ofrecer,
  // «me envías la foto» es pedir. Son la frase opuesta.
  "Perfecto, cuando pagues me envías la captura del comprobante y te doy acceso",
  "Listo, mándame la captura y te llega el enlace en segundos",
  "Cuando tengas el comprobante, me lo compartes por aquí",
  "Genial, quedo atento a tu captura de pago",
  "Envíame la foto de tu comprobante y listo",
  "Me pasas la imagen del voucher y te activo el acceso",
  "Adjúntame la captura cuando puedas",
  "Compárteme la foto del pago y en segundos tienes tu material",
];
for (const frase of NO_OFRECE) {
  comprobar(`deja pasar: ${frase.slice(0, 40)}`, ofrece(frase) === false);
}

// Y LA OTRA MITAD, que es la que no se puede perder: un ofrecimiento de verdad
// sigue saltando aunque la frase lleve un «me» por otro motivo.
console.log("\n— y un ofrecimiento sigue siendo un ofrecimiento —\n");
for (const frase of [
  "Te puedo mostrar unas imágenes del material si quieres",
  "¿Deseas ver unas fotos de lo que incluye?",
  "Te mando unas muestras para que veas la calidad",
  "Me encantaría mostrarte unas fotos del contenido",
  "Si te parece te paso unas capturas de las páginas",
]) {
  comprobar(`sigue cazando: ${frase.slice(0, 40)}`, ofrece(frase) === true);
}
comprobar(
  "la regla mira QUIEN manda, y vive en un solo sitio",
  /LO_MANDA_EL_CLIENTE/.test(src) &&
    /if \(LO_MANDA_EL_CLIENTE\.test\(ventana\)\) continue;/.test(src)
);

// ── 3. EL GUARDARAIL, Y SU LINEA ROJA ───────────────────────────────────────
console.log("\n— y como se usa —\n");
comprobar(
  "solo se vigila si NO hay ninguna muestra",
  /const noHayNingunaMuestra = getImageGallery\(false, convo\)\.length === 0;/.test(
    src
  ),
  "con una foto, no se entra"
);
// EL `false` ES LA LINEA ROJA. Es la consulta MAS AMPLIA: si devuelve algo, hay
// foto alcanzable y el guardarail no se mete. Cambiarlo por `true` empezaria a
// vigilar conversaciones que si tienen muestras.
comprobar(
  "y se pregunta por la galeria MAS amplia",
  /getImageGallery\(false, convo\)/.test(src) &&
    !/getImageGallery\(true, convo\)\.length === 0/.test(src),
  "no se recorta la busqueda"
);
comprobar(
  "el guardarail exige las dos cosas a la vez",
  /noHayNingunaMuestra &&\s*laRespuestaOfreceMaterialVisual\(text\) &&/.test(src),
  "galeria vacia Y promesa escrita"
);
comprobar(
  "obliga a reescribir, no inventa una respuesta",
  /RETRY REQUIRED: you offered or promised images/.test(src),
  "mismo patron que los demas"
);
comprobar(
  "y solo UNA vez",
  /ofreceFotosSinTenerRetries < 1/.test(src) &&
    /ofreceFotosSinTenerRetries \+= 1;/.test(src),
  "no se gasta una llamada tras otra"
);
comprobar(
  "si insiste no se le recorta el texto, se registra",
  /INSISTE en ofrecer material visual sin galeria/.test(src),
  "cortar a ciegas deja respuestas mutiladas"
);
// LO QUE YA HABIA, Y SIGUE. El aviso del prompt no se quita: es la primera
// barrera y ahorra el reintento cuando el turno ya huele a imagen.
comprobar(
  "el aviso del prompt sigue en su sitio",
  /MEDIA AVAILABILITY: there are NO configured images/.test(src),
  "las dos barreras, no una"
);

console.log(
  fallos === 0
    ? "\nTODO OK — no promete fotos que no tiene, y sigue mandando las que tiene\n"
    : `\n${fallos} comprobacion(es) mal.\n`
);
process.exit(fallos === 0 ? 0 : 1);
