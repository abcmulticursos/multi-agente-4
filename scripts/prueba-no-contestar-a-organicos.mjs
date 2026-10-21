// El bot puede dejar de contestarle a quien no vino de un anuncio.
//
// POR QUE EXISTE
//
//   Desde el 1 de octubre de 2026, Meta cobra POR MENSAJE todo lo que el bot
//   envia dentro de la ventana de 24 horas. Recibir sigue siendo gratis: se
//   paga lo que SALE. Una conversacion de venta son decenas de burbujas, y el
//   que no compra cuesta casi lo mismo que el que compra.
//
//   La excepcion es quien llego por un anuncio de clic a WhatsApp o por el
//   boton de una pagina de Facebook: ahi Meta abre una ventana de 72 horas y
//   todo lo de dentro es gratis.
//
// LAS CUATRO COSAS QUE NO PUEDEN PASAR
//
//   1. Que nazca encendido. Es una decision comercial —dejar de atender a una
//      parte de la gente que escribe— y nadie deberia encontrarsela puesta.
//
//   2. Que calle a alguien QUE YA PAGO. El que compro ayer por un anuncio y hoy
//      escribe pidiendo su material llega SIN el origen del anuncio, porque la
//      conversacion es otra. Callarle no es ahorrar: es dejar tirado al unico
//      cliente que ya solto el dinero, y romper el modo de entregar.
//
//   3. Que calle a alguien A MITAD DEL COBRO. Si mando el comprobante y el bot
//      se calla, el cobro se cae con el dinero ya transferido.
//
//   4. Que se decida DESPUES de gastar. Si el corte estuviera detras de la
//      moderacion o del motor, ya se habrian gastado tokens o mensajes. Va lo
//      primero.
//
// Y EL ORIGEN SE MIRA CON LA REGLA DE LA CASA
//
//   `vinoDeAnuncio` mira `ctwa_clid` Y `ad_source_id`. Una conversacion puede
//   traer el click del anuncio sin que se haya resuelto todavia QUE anuncio
//   fue: mirando solo el segundo la dariamos por organica, y no lo es. Una
//   segunda regla escrita aqui acabaria callando a gente que si vino de pago.
//
//   node scripts/prueba-no-contestar-a-organicos.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");
const config = leer("src", "lib", "workflow", "config.ts");
const manejador = leer("src", "lib", "meta", "handler.ts");
const ruta = leer("src", "app", "api", "workflow", "route.ts");
const editor = leer("src", "app", "editor", "page.tsx");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// -- 1. EL CAMPO EXISTE EN LOS SIETE SITIOS ----------------------------------
comprobar(
  "la configuracion lo conoce",
  /no_responder_organicos\?: boolean;/.test(config),
  "config.ts"
);
comprobar(
  "y el editor lo llama igual",
  /no_responder_organicos: boolean;/.test(editor),
  "mismo nombre"
);
comprobar(
  "la API lo lee",
  /no_responder_organicos: config\?\.no_responder_organicos === true,/.test(ruta),
  "de ida"
);
// Un booleano que solo se guarda cuando es `true` no se puede apagar nunca
// desde el panel: se desmarca, se guarda, y al recargar vuelve marcado.
comprobar(
  "y lo escribe encendido Y apagado",
  /doc\.set\("no_responder_organicos", g\.no_responder_organicos === true\);/.test(
    ruta
  ),
  "se puede volver atras"
);
comprobar(
  "hay un interruptor en la pantalla",
  /No contestar a quien no vino de un anuncio/.test(editor) &&
    /no_responder_organicos: !\(/.test(editor),
  "en Ajustes"
);

// -- 2. NACE APAGADO ---------------------------------------------------------
comprobar(
  "apagado salvo que se encienda a mano",
  /loadWorkflowConfig\(\)\?\.no_responder_organicos !== true\) return true;/.test(
    manejador
  ),
  "nadie se lo encuentra puesto"
);

// -- 3. NUNCA CALLA A UN CLIENTE ---------------------------------------------
const guardia = (() => {
  const i = manejador.indexOf("function leContestamos(");
  const f = manejador.indexOf("MODERACIÓN —", i);
  return i < 0 || f < 0 ? "" : manejador.slice(i, f);
})();
comprobar("se encuentra el guardia", guardia.length > 0, "leContestamos");
comprobar(
  "quien ya pago se atiende siempre",
  /if \(convo\.paid_at\) return true;/.test(guardia),
  "venga de donde venga"
);
// UNA REGLA, NO UNA LISTA DE ESTADOS.
//
// La primera version enumeraba los estados de cobro y entrega, y se dejaba
// fuera `intro_done`: el cliente al que el bot YA le paso los datos de pago y
// que todavia no ha mandado el comprobante. Callarle ahi es lo peor que puede
// hacer este interruptor: transfiere el dinero, manda la foto, y no le contesta
// nadie.
//
// Pasaba al encender el interruptor con conversaciones en marcha, y con el
// cliente organico que vuelve al dia siguiente.
//
// Enumerar es fragil: un estado nuevo vuelve a quedarse fuera sin que nadie lo
// note. `new` es el unico estado en que el bot no ha abierto la boca, asi que
// basta con mirar ese.
comprobar(
  "si el bot ya le hablo, sigue hablandole",
  /if \(convo\.state !== "new"\) return true;/.test(guardia),
  "una regla, no una lista"
);
comprobar(
  "y ya no hay lista de estados que se quede corta",
  !/convo\.state === "payment_done"/.test(guardia),
  "no hace falta acordarse"
);

// -- 4. EL ORIGEN SE MIRA CON LA REGLA DE LA CASA ----------------------------
comprobar(
  "usa la regla de origen de la casa",
  /import \{ vinoDeAnuncio \} from "@\/lib\/origen-de-lead";/.test(manejador) &&
    /if \(vinoDeAnuncio\(convo\)\) return true;/.test(guardia),
  "no una copia"
);

// -- 5. SE DECIDE ANTES DE GASTAR --------------------------------------------
//
// Si el corte estuviera detras de la moderacion, del motor o del modelo, ya se
// habrian gastado tokens o mensajes: callar despues de hablar no ahorra nada.
const corte = manejador.indexOf("!leContestamos(fresh)");
const moderacion = manejador.indexOf("await moderarSiCorresponde(fresh, content)");
const motor = manejador.indexOf("await tryWorkflowOnIncoming(fresh, content)");
const modelo = manejador.indexOf("await generateReply(history");
comprobar(
  "el corte va antes de moderar",
  corte > 0 && moderacion > 0 && corte < moderacion,
  "no cuesta un token"
);
comprobar(
  "antes del motor",
  corte > 0 && motor > 0 && corte < motor,
  "no suelta la intro"
);
comprobar(
  "y antes del modelo",
  corte > 0 && modelo > 0 && corte < modelo,
  "no llama a la IA"
);

console.log(fallos === 0 ? "\nTODO OK" : `\n${fallos} FALLO(S)`);
process.exit(fallos === 0 ? 0 : 1);
