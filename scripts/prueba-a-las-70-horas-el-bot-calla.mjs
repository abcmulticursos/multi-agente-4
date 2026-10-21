// A LAS 70 HORAS EL BOT YA NO CONTESTA — PARA NO PAGARLE A META
//
// LO PIDIO EL DUEÑO — 3 de octubre de 2026:
//
//   «dale la capacidad que cualquier persona que ingresó jamás reciba respuesta luego de
//    las 72 horas. Esto para evitar gastos de pago de Meta por las nuevas reglas, si es
//    posible a las 70 horas»
//
// POR QUE 70 Y NO 72. La ventana gratis de quien llega por un anuncio de clic a WhatsApp o
// por el boton de una pagina dura 72 horas. A las 70 queda margen: una respuesta que se
// empieza a preparar en la hora 71 y sale en la 72 ya se cobra.
//
// SIN NINGUNA EXCEPCION, Y LO DECIDIO EL. Se le advirtio que esto deja fuera tambien al que
// YA PAGO —el que compro y a las 80 horas escribe «no me llego mi material» se queda sin
// respuesta— y lo confirmo: «para todos sin excepcion que ya no responda a partir de las 70
// horas». Esta prueba vigila que esa decision siga escrita y que nadie le añada excepciones
// por buena voluntad.
//
// EL AVISO ES SOLO PARA EL. Sus palabras: «al cliente nunca le tiene que llegar eso, es para
// el usuario del editor». Por eso vive en el pie del chat del panel, al lado del de 24
// horas, y NO se le manda ningun mensaje al cliente.
//
//   node scripts/prueba-a-las-70-horas-el-bot-calla.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const motor = readFileSync(join(RAIZ, "src", "lib", "meta", "handler.ts"), "utf8");
const panel = readFileSync(
  join(RAIZ, "src", "components", "ConversationPanel.tsx"),
  "utf8"
);

let fallos = 0;
const comprobar = (titulo, condicion, detalle) => {
  const marca = condicion ? "  ok  " : "> FALLA";
  if (!condicion) fallos++;
  console.log(`${marca} ${String(titulo).padEnd(56)} ${detalle ?? ""}`);
};

// -- 1. EL NUMERO, Y QUE SEA EL MISMO EN LOS DOS SITIOS ----------------------
//
// Si el motor callara a las 70 y la pantalla avisara a las 72 —o al reves— el dueño veria
// una conversacion muda sin ningun aviso, o un aviso sobre un bot que todavia contesta.
comprobar(
  "el motor calla a las 70 horas",
  /HORAS_PARA_DEJAR_DE_RESPONDER = 70/.test(motor),
  "ni 72: la respuesta tarda en salir"
);
comprobar(
  "y el panel avisa a las mismas 70",
  /70 \* 3600/.test(panel),
  "la pantalla y el bot dicen lo mismo"
);

// -- 2. SE CUENTA DESDE QUE NACIO LA CONVERSACION ---------------------------
//
// Es cuando Meta abre la ventana. Contarlo desde el ultimo mensaje la reabriria cada vez que
// el cliente escribe, y entonces no cortaria nunca.
comprobar(
  "el motor cuenta desde que nacio",
  /const nacio = convo\?\.created_at;/.test(motor),
  "no desde el ultimo mensaje"
);
comprobar(
  "y el panel tambien",
  /const nacio = state\.conversation\?\.created_at;/.test(panel),
  "el mismo punto de partida"
);

// -- 3. SIN EXCEPCIONES, Y VA LA PRIMERA ------------------------------------
//
// La guarda tiene que correr ANTES que las de «vino de anuncio» y «ya pago». Si corriera
// despues, esas devolverian true y el bot seguiria contestando pasadas las 70 horas — que es
// justo lo que el pidio evitar.
const puerta = motor.slice(
  motor.indexOf("function leContestamos("),
  motor.indexOf("function leContestamos(") + 1400
);
comprobar(
  "la guarda de las 70 horas va LA PRIMERA",
  /function leContestamos\([\s\S]{0,200}?pasoLaVentanaDeRespuesta\(convo\)/.test(puerta),
  "antes que «vino de anuncio» y «ya pago»"
);
comprobar(
  "y las otras siguen despues, intactas",
  /vinoDeAnuncio\(convo\)/.test(puerta) && /convo\.paid_at/.test(puerta),
  "el interruptor de organicos no se toco"
);

// -- 4. AL CLIENTE NO LE LLEGA NADA ----------------------------------------
//
// La guarda solo DEVUELVE false. Si algun dia alguien le añade un envio aqui, el cliente
// recibiria un mensaje —y eso es exactamente el gasto que esto evita, ademas de lo que el
// prohibio: «al cliente nunca le tiene que llegar eso».
const cuerpo = motor.slice(
  motor.indexOf("export function pasoLaVentanaDeRespuesta("),
  motor.indexOf("function leContestamos(") + 900
);
comprobar(
  "no se le manda ningun mensaje al cliente",
  !/sendBotText|sendBotButtons|enviarMensaje/.test(cuerpo),
  "solo calla y lo deja anotado"
);

// -- 5. EL AVISO DEL PANEL, Y QUE NO TAPE AL DE 24 HORAS --------------------
comprobar(
  "el panel avisa de las 70 horas",
  /Pasaron las 70 horas/.test(panel),
  "en el pie del chat"
);
comprobar(
  "el de 24 horas sigue existiendo",
  /Fuera de la ventana de 24h/.test(panel),
  "no se quito, solo cede el sitio"
);
comprobar(
  "y el de 70 manda sobre el de 24",
  /pasoLasSetentaHoras \?[\s\S]{0,600}?is24hWindow &&/.test(panel),
  "pasadas 70 tambien pasaron 24: enseñar los dos confunde"
);

console.log("");
if (fallos > 0) {
  console.log(`> ${fallos} FALLA(S)`);
  process.exit(1);
}
console.log("TODO OK — a las 70 horas el bot calla, y el aviso es solo para el dueño");
