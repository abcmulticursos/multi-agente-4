// EL RECORRIDO COMPLETO: la venta entera, sola, en medio minuto.
//
// POR QUE EXISTE
//
//   Las 125 pruebas `prueba-*.mjs` LEEN el codigo y comprueban que esta bien
//   cableado. Nunca han mandado un mensaje. Asi que el unico que vivia la venta
//   de verdad era el dueño: escribiendo a mano, esperando, leyendo el log,
//   pegandomelo, y volviendo a empezar. Una hora por fallo.
//
//   Esto conduce la conversacion solo, por la misma puerta que su simulador
//   —motor real, estados reales, worker real— y comprueba cada salto. El fallo
//   aparece aqui antes de que el lo viva.
//
// COMO SE USA
//
//   1. En una terminal:  npm run dev
//   2. En otra:          node scripts/recorrido-completo.mjs
//
//   node scripts/recorrido-completo.mjs                      solo el motor (gratis)
//   node scripts/recorrido-completo.mjs --con-modelo         + turnos de conversacion
//   node scripts/recorrido-completo.mjs --comprobante=x.jpg  + pago, entrega y extra
//   node scripts/recorrido-completo.mjs --quedarse=combo     acaba en la opcion cara
//   node scripts/recorrido-completo.mjs --modalidad=order_bump
//   node scripts/recorrido-completo.mjs --todas
//   node scripts/recorrido-completo.mjs --pais=MX
//   node scripts/recorrido-completo.mjs --conservar          no borra la conversacion
//
// LOS TRES ALCANCES, Y QUE CUESTA CADA UNO
//
//   MOTOR (por defecto) — CERO llamadas al modelo. Primer mensaje, intro
//   completa, eleccion de metodo por cuadrito, datos de pago, venta cerrada.
//   Es donde han estado TODOS los fallos de esta semana: el «si» del upsell, la
//   duplicacion, el bucle del BCP, la burbuja apagada, el payment_done perdido.
//
//   CON MODELO — añade los turnos que contesta el cerebro (precio, desconfianza).
//   Unos centimos por vuelta.
//
//   CON COMPROBANTE — añade lo unico que no se puede simular sin vision: la foto
//   del pago. Desde ahi salen entrega, oferta del extra y su cierre. Hace falta
//   una captura de un comprobante en el disco; no se puede fabricar una.
import { readFileSync, existsSync } from "node:fs";
import { basename } from "node:path";

// ── Argumentos ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const valorDe = (nombre, porDefecto = null) => {
  const encontrado = args.find((a) => a.startsWith(`--${nombre}=`));
  return encontrado ? encontrado.slice(nombre.length + 3) : porDefecto;
};
const tiene = (nombre) => args.includes(`--${nombre}`);

const BASE = valorDe("url", "http://localhost:3000").replace(/\/$/, "");
const PAIS = (valorDe("pais", "PE") || "PE").toUpperCase();
const CONSERVAR = tiene("conservar");
const COMPROBANTE = valorDe("comprobante");
/**
 * LA TIENDA QUE ATIENDE ESTA PRUEBA — `--tienda=<id>`.
 *
 * SIN ESTO NO SE PODIA PROBAR UNA TIENDA. El simulador ya lo aceptaba al crear la
 * conversacion, pero este recorrido no se lo pasaba: entraba sin tienda, asi que jugaban los
 * productos y los precios GENERALES y no los de la tienda que se queria probar.
 *
 * Y el dueño vende con dos tiendas distintas, cada una con sus productos, sus precios, su
 * cobrador y su submodalidad. Probar solo la general es probar lo que no vende.
 *
 * VACIO = COMO SIEMPRE: sin tienda, exactamente igual que antes de este cambio.
 */
const TIENDA = valorDe("tienda");
/**
 * EL METODO DE PAGO QUE ESCRIBE EL CLIENTE DE PRUEBA — `--metodo=<lo que teclea>`.
 *
 * LO QUE PASO — 3 de octubre de 2026, corriendo la matriz del dueño por paises. Este
 * recorrido tecleaba SIEMPRE «yape», y Yape solo existe en PERU. Asi que en Ecuador y en
 * Argentina el cliente de prueba pedia un metodo que no esta configurado ahi, y las
 * comprobaciones de «le manda los datos con un numero de cuenta dentro» salian rojas por
 * culpa de la prueba, no del bot. Una de esas rojas se llego a reportar como fallo del bot
 * antes de verlo.
 *
 * POR DEFECTO SIGUE SIENDO «yape», asi que todas las corridas de siempre se comportan
 * exactamente igual. Para los otros paises se pasa el suyo:
 *
 *   --pais=EC --metodo=transferencia        --pais=AR --metodo=transferencia
 */
const METODO = valorDe("metodo", "yape") || "yape";
// EL PRIMER MENSAJE DEL CLIENTE — `--primer-mensaje="Hola, me interesa el pack X"`.
// Sirve para probar las frases de entrada que eligen la tienda en un número compartido.
// Por defecto «info», que es lo que ha mandado siempre.
const PRIMER_MENSAJE = valorDe("primer-mensaje", "info") || "info";
// CON QUE OPCION SE QUEDA AL FINAL — «combo» (la cara) o «basico».
//
// PARA QUE HACE FALTA. El comprobante es una captura de verdad, con un importe
// fijo escrito dentro, y el validador compara ese importe contra el precio de la
// opcion elegida. El recorrido siempre acababa en la barata, asi que una captura
// del precio de la CARA daba «pago parcial» y la entrega no llegaba a correr
// nunca — justo el escalon que habia que comprobar el 23/09/2026.
//
// Sin la bandera no cambia nada: se queda donde acabe el cambio de opinion, que
// es como ha corrido siempre.
const QUEDARSE = (valorDe("quedarse") || "").toLowerCase();
const CON_MODELO = tiene("con-modelo") || !!COMPROBANTE;
const TODAS = tiene("todas");
// «actual» = la que vende de verdad hoy, sin forzar nada. Es la unica forma de
// reproducir lo que le pasa a el: forzar una modalidad distinta de la activa
// deja al motor resolviendo unas cosas por la forzada y otras por la real.
const MODALIDADES = TODAS
  ? ["lineal", "order_bump", "bioferta", "doble_oferta_dos", "doble_oferta_upsell", "upsell"]
  : [valorDe("modalidad", "actual")];

// ── Salida ───────────────────────────────────────────────────────────────────
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
let fallos = 0;
const comprobar = (texto, condicion, detalle = "") => {
  if (!condicion) fallos++;
  console.log(`  ${condicion ? "ok   " : "FALLA"} ${pad(texto, 52)} ${detalle}`);
};
const paso = (texto) => console.log(`\n· ${texto}`);

// ── El servidor, y la sesion ─────────────────────────────────────────────────
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * LA SESION DEL PANEL.
 *
 * Todo `/api/` va detras de la contraseña del panel, asi que el recorrido entra
 * por la misma puerta que un humano: una vez, y guarda la cookie.
 *
 * La contraseña NO se escribe aqui ni se pasa por la linea de comandos —donde
 * quedaria en el historial de la terminal—: se lee de `.env`, que es donde ya
 * vive, o de la variable de entorno DASHBOARD_PASSWORD.
 */
let cookieDeSesion = "";

function claveDelPanel() {
  if (process.env.DASHBOARD_PASSWORD?.trim()) {
    return process.env.DASHBOARD_PASSWORD.trim();
  }
  for (const archivo of [".env.local", ".env"]) {
    if (!existsSync(archivo)) continue;
    const linea = readFileSync(archivo, "utf8")
      .split(/\r?\n/)
      .find((l) => /^\s*DASHBOARD_PASSWORD\s*=/.test(l));
    const valor = linea
      ?.split("=")
      .slice(1)
      .join("=")
      .trim()
      .replace(/^["']|["']$/g, "");
    if (valor) return valor;
  }
  return "";
}

/**
 * UNA CONEXIÓN CAÍDA NO ES UNA VENTA ROTA.
 *
 * El recorrido sondea ~150 veces seguidas, y cualquier máquina con la memoria
 * justa deja caer alguna: se midió el 22/09/2026 y salieron 6 caídas de 120
 * sondeos (ECONNRESET). Sin reintento, el recorrido se cortaba SIEMPRE y decía
 * «fetch failed», que parece un fallo del bot y no lo es.
 *
 * Se reintenta DOS veces, con una pausa corta. Si el servidor de verdad no
 * está, falla igual —las tres tiran el mismo error— así que esto no tapa un
 * servidor caído: solo aguanta el hipo de una conexión.
 */
async function pedir(ruta, opciones = {}) {
  let ultimo;
  for (let intento = 0; intento < 3; intento++) {
    try {
      return await fetch(`${BASE}${ruta}`, {
        ...opciones,
        headers: {
          ...(opciones.headers ?? {}),
          ...(cookieDeSesion ? { cookie: cookieDeSesion } : {}),
        },
      });
    } catch (err) {
      ultimo = err;
      // Un cuerpo de FormData solo se puede leer una vez: si ya se consumió,
      // reintentar mandaría un cuerpo vacío. Mejor fallar y que se vea.
      if (opciones.body instanceof FormData && intento === 0) throw err;
      await esperar(400 * (intento + 1));
    }
  }
  throw ultimo;
}

async function entrar() {
  const clave = claveDelPanel();
  if (!clave) return "no encuentro DASHBOARD_PASSWORD ni en el entorno ni en .env";
  let r;
  try {
    r = await fetch(`${BASE}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: clave }),
    });
  } catch {
    return `no hay nadie escuchando en ${BASE}`;
  }
  if (!r.ok) return `el panel rechazo la contraseña (${r.status})`;
  const galletas = r.headers.getSetCookie?.() ?? [];
  const sesion = galletas.find((c) => c.startsWith("wa_session="));
  if (!sesion) return "el panel no devolvio sesion";
  cookieDeSesion = sesion.split(";")[0];
  return null;
}

async function servidorVivo() {
  try {
    const r = await pedir("/api/test-simulator?id=0");
    return r.status === 404 || r.ok; // 404 = ruta viva, conversacion inexistente
  } catch {
    return false;
  }
}

async function crearConversacion(modalidad) {
  const r = await pedir("/api/test-simulator", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      country: PAIS,
      name: "Recorrido",
      channel: "whatsapp",
      // Solo viaja si se pidio: sin `--tienda` el cuerpo sale igual que siempre.
      ...(TIENDA ? { tienda: TIENDA } : {}),
    }),
  });
  if (!r.ok) throw new Error(`no pude crear la prueba: ${r.status} ${await r.text()}`);
  const { id } = await r.json();
  // La modalidad viaja pegada a ESTA conversacion y muere con ella: la que
  // venden sus clientas no se toca.
  const p = await pedir(`/api/test-simulator/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    // "" = usar la modalidad real, sin forzar.
    body: JSON.stringify({ modality: modalidad === "actual" ? "" : modalidad }),
  });
  if (!p.ok) throw new Error(`no pude fijar la modalidad: ${await p.text()}`);
  return id;
}

async function leer(id) {
  const r = await pedir(`/api/test-simulator/${id}`, {
    headers: { "Cache-Control": "no-store" },
  });
  if (!r.ok) throw new Error(`no pude leer la prueba ${id}: ${r.status}`);
  return r.json();
}

/** Qué es el archivo, por su extensión. Lo que no se reconozca va como antes. */
const TIPOS_DE_ARCHIVO = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  pdf: "application/pdf",
};
const tipoDelArchivo = (ruta) =>
  TIPOS_DE_ARCHIVO[(ruta.split(".").pop() ?? "").toLowerCase()] ??
  "application/octet-stream";

async function enviar(id, { texto, boton, archivo }) {
  const form = new FormData();
  if (texto) form.set("content", texto);
  if (boton) {
    form.set("button_id", boton.id);
    form.set("button_title", boton.title);
  }
  if (archivo) {
    // Y SE DICE QUE ES UNA FOTO, NO UN ARCHIVO CUALQUIERA.
    //
    // LO QUE PASO — 23/09/2026. El Blob iba sin tipo, el simulador guardaba
    // «application/octet-stream» —su respaldo cuando el archivo no dice que es—
    // y el lector del comprobante moria con:
    //
    //     400  "Unsupported MIME type: application/octet-stream"
    //
    // Asi que `--comprobante` nunca llegaba a leer nada, y el pago, la entrega y
    // la oferta del extra salian rojos por un motivo que no era suyo. El bot de
    // verdad no lo notaba: por WhatsApp el tipo viene en el mensaje.
    form.set(
      "file",
      new Blob([readFileSync(archivo)], { type: tipoDelArchivo(archivo) }),
      basename(archivo)
    );
  }
  const r = await pedir(`/api/test-simulator/${id}/message`, { method: "POST", body: form });
  if (!r.ok) throw new Error(`no pude enviar «${texto ?? "archivo"}»: ${await r.text()}`);
}

/**
 * ESPERA A QUE EL BOT TERMINE DE HABLAR.
 *
 * Leer tambien hace avanzar al worker —esa ruta llama a `tick()`—, asi que
 * sondear es a la vez mirar y empujar. Se espera a que deje de salir nada nuevo
 * durante `quietoMs`: la intro son varias burbujas con sus pausas, y quedarse
 * con la primera daria por rota una venta que iba bien.
 */
async function esperarAlBot(
  id,
  { maximoMs = 90000, quietoMs = 5000, hasta = null } = {}
) {
  const inicio = Date.now();
  let ultimas = -1;
  let ultimoCambio = Date.now();
  let estado = null;
  let mensajes = [];
  while (Date.now() - inicio < maximoMs) {
    const datos = await leer(id);
    mensajes = datos.messages ?? [];
    estado = datos.conversation;
    // ESPERAR A UNA CONDICION GANA A ESPERAR UN SILENCIO.
    //
    // La intro son nueve burbujas con sus pausas: entre dos puede haber mas
    // silencio del que nadie querria esperar, y darla por terminada ahi seria
    // acusar de rota una venta que iba bien. Cuando se sabe QUE se espera, se
    // espera a eso.
    if (hasta && hasta(estado, mensajes)) return { estado, mensajes };
    if (mensajes.length !== ultimas) {
      ultimas = mensajes.length;
      ultimoCambio = Date.now();
    } else if (Date.now() - ultimoCambio >= quietoMs) {
      // Se devuelve lo que haya aunque la condicion no se cumpla: quien llama
      // decide si eso es un fallo o si toca hacer algo —contestar a la intro
      // que se paro a preguntar, por ejemplo—. Esperar el maximo entero para
      // acabar en lo mismo solo gasta minutos.
      break;
    }
    await esperar(900);
  }
  return { estado, mensajes };
}

const delBot = (mensajes) => mensajes.filter((m) => m.role === "assistant");
const juntar = (lista) => lista.map((m) => m.content ?? "").join("\n");
const LLEVA_UNA_CUENTA = /(?:\d[\s.-]?){6,}/;

/**
 * ELIGE UNA OPCION Y LUEGO CAMBIA DE OPINION — «mejor el otro».
 *
 * Es el paso que costó una venta de verdad. El cliente elige el full, se lo
 * piensa y dice «mejor el otro por favor, no tengo mucho dinero». El motor lo
 * entiende y anota el básico… y al validar el comprobante releía ese mismo
 * mensaje: «el otro», resuelto ya con el básico puesto, volvía a significar el
 * full. Le reclamaba el saldo del producto que acababa de descartar.
 *
 * Aquí no hace falta comprobante para verlo: la elección anotada se lee de la
 * conversación. Si dice «basico» después del cambio, la intención del cliente
 * es la que manda.
 */
async function eligeYCambiaDeOpcion(id) {
  paso("Se abre la oferta de dos opciones: elige una y luego cambia");
  const datos = await leer(id);
  const botones = Object.values(datos.buttons ?? {}).flat();
  // Se elige LA MAYOR primero, para que «el otro» tenga a donde ir.
  const elMayor = botones[0];
  await enviar(
    id,
    elMayor ? { boton: elMayor, texto: elMayor.title } : { texto: "el full" }
  );
  let { estado } = await esperarAlBot(id, {
    maximoMs: 60000,
    hasta: (e) => !!e?.order_bump_choice,
  });
  const primera = estado?.order_bump_choice;
  comprobar("anota la opción que eligió", !!primera, `elección=${primera ?? "(ninguna)"}`);

  await enviar(id, { texto: "mejor el otro por favor no tengo mucho dinero" });
  ({ estado } = await esperarAlBot(id, {
    maximoMs: 90000,
    hasta: (e) => !!e?.order_bump_choice && e.order_bump_choice !== primera,
  }));
  const segunda = estado?.order_bump_choice;
  comprobar(
    "y al decir «mejor el otro» cambia de verdad",
    !!segunda && segunda !== primera,
    `${primera ?? "?"} → ${segunda ?? "sin cambio"}`
  );
  // LA MARCA QUE IMPIDE QUE SE DE LA VUELTA SOLA. Sin ella, el repaso previo a
  // validar relee el mismo «el otro» y lo interpreta al reves.
  comprobar(
    "y queda sellada la hora del cambio",
    typeof estado?.order_bump_choice_at === "number" &&
      estado.order_bump_choice_at > 0,
    `sello=${estado?.order_bump_choice_at ?? "(ninguno)"}`
  );

  // Y SI SE PIDIO QUEDARSE CON UNA, SE VUELVE A ELLA. Ver `QUEDARSE`.
  //
  // Va DESPUES del cambio de opinion a proposito: ese paso costo una venta de
  // verdad y se sigue comprobando igual. Esto solo coloca la eleccion donde el
  // importe del comprobante pueda cuadrar.
  if ((QUEDARSE === "combo" || QUEDARSE === "basico") && segunda !== QUEDARSE) {
    await enviar(id, { texto: "no, mejor el otro, ese me quedo" });
    ({ estado } = await esperarAlBot(id, {
      maximoMs: 90000,
      hasta: (e) => e?.order_bump_choice === QUEDARSE,
    }));
    comprobar(
      `y se queda con «${QUEDARSE}», que es la del comprobante`,
      estado?.order_bump_choice === QUEDARSE,
      `elección=${estado?.order_bump_choice ?? "(ninguna)"}`
    );
  }
}

// ── El recorrido ─────────────────────────────────────────────────────────────
async function recorrer(modalidad) {
  console.log(
    `\n${"=".repeat(70)}\nMODALIDAD: ${modalidad}   ·   pais: ${PAIS}\n${"=".repeat(70)}`
  );
  const id = await crearConversacion(modalidad);
  try {
    // 1 · PRIMER MENSAJE -> INTRO. Sin modelo: lo atiende el motor entero.
    paso("El cliente escribe por primera vez");
    // `--primer-mensaje="…"`: para probar las frases de entrada de las tiendas (12/10/2026).
    // Sin la opción, «info», como siempre.
    await enviar(id, { texto: PRIMER_MENSAJE });
    // La intro puede durar minutos entre burbuja y burbuja: se espera a que
    // TERMINE, con un silencio largo antes de dar por hecho que se paró.
    let { estado, mensajes } = await esperarAlBot(id, {
      maximoMs: 180000,
      quietoMs: 15000,
      hasta: (e) => e?.state === "intro_done",
    });
    comprobar("el bot contesta", delBot(mensajes).length > 0, `${delBot(mensajes).length} burbujas`);
    // LA INTRO PUEDE PARARSE A PREGUNTAR ALGO —un cuadrito de elección a mitad—
    // y ahí se queda esperando. Un cliente real contesta y la intro sigue: el
    // recorrido hace lo mismo, o daría por rota una intro que iba bien.
    if (estado?.state !== "intro_done") {
      paso("La intro se paró a preguntar: le contesto y sigue");
      await enviar(id, { texto: "si" });
      ({ estado, mensajes } = await esperarAlBot(id, {
        maximoMs: 180000,
        quietoMs: 15000,
        hasta: (e) => e?.state === "intro_done",
      }));
    }
    // LA INTRO TERMINA DE DOS FORMAS, Y LAS DOS SON BUENAS. En una venta de un
    // solo producto queda en `intro_done`; en las de dos opciones termina
    // soltando la elección, y ahí espera. Exigir `intro_done` daría por rota una
    // intro que hizo justo lo que tenía que hacer.
    const LA_INTRO_ACABO = [
      "intro_done",
      "awaiting_order_bump_choice",
      "awaiting_doble_oferta_dos_choice",
      "awaiting_bioferta_intro_choice",
    ];
    comprobar(
      "y la intro termina",
      LA_INTRO_ACABO.includes(estado?.state),
      `estado=${estado?.state}`
    );

    // 2 · TURNOS DE CONVERSACION (solo con --con-modelo).
    if (CON_MODELO) {
      paso("Pregunta el precio y desconfia");
      await enviar(id, { texto: "precio" });
      ({ estado, mensajes } = await esperarAlBot(id));
      comprobar("contesta al precio", delBot(mensajes).length > 0);
      const antesDuda = delBot(mensajes).length;
      await enviar(id, { texto: "no es estafa?" });
      ({ estado, mensajes } = await esperarAlBot(id));
      comprobar("y a la desconfianza", delBot(mensajes).length > antesDuda);
    }

    // 3 · ELIGE METODO DE PAGO. Lo atiende el motor: cuadrito o palabra clave.
    //
    // ES EL PASO QUE MAS SE HA ROTO. Aqui vivian el duplicado, el bucle, la
    // burbuja apagada y la venta que no se cerraba.
    paso("Elige metodo de pago");
    let antes = delBot(mensajes).length;
    await enviar(id, { texto: METODO });
    // ¿SE ABRIO LA OFERTA DE DOS OPCIONES? En las modalidades que la tienen,
    // nombrar el metodo no manda datos: intercepta y pregunta cual.
    ({ estado, mensajes } = await esperarAlBot(id, {
      maximoMs: 60000,
      hasta: (e) =>
        e?.state === "awaiting_order_bump_choice" ||
        e?.state === "awaiting_doble_oferta_dos_choice" ||
        e?.state === "payment_done",
    }));
    if (
      estado?.state === "awaiting_order_bump_choice" ||
      estado?.state === "awaiting_doble_oferta_dos_choice"
    ) {
      await eligeYCambiaDeOpcion(id);
      ({ estado, mensajes } = await esperarAlBot(id, { quietoMs: 6000 }));
      antes = delBot(mensajes).length;
      await enviar(id, { texto: METODO });
    }
    ({ estado, mensajes } = await esperarAlBot(id, {
      maximoMs: 120000,
      hasta: (e, m) =>
        e?.state === "payment_done" &&
        LLEVA_UNA_CUENTA.test(juntar(delBot(m).slice(antes))),
    }));
    // Y SE DEJA QUE TERMINE DE HABLAR. Las respuestas de un metodo son varias
    // burbujas programadas; cortar en la primera dejaria las demas cayendo
    // dentro de la comprobacion siguiente, que las leeria como una repeticion.
    ({ estado, mensajes } = await esperarAlBot(id, { quietoMs: 8000 }));
    const nuevas = delBot(mensajes).slice(antes);
    comprobar("le manda los datos de pago", nuevas.length > 0, `${nuevas.length} burbujas`);
    // «PIDIÓ PAGAR SIN ELEGIR» ES UN CAMINO LEGÍTIMO, NO UN FALLO.
    //
    // Si la modalidad vende dos opciones y el cliente aún no eligió, el bot le
    // manda los datos SIN importe y le pregunta cuál quiere. Eso está bien
    // hecho: nadie paga un precio que no eligió. La venta no se cierra todavía
    // —falta la elección—, así que exigir aquí `payment_done` sería suspender a
    // un bot que acaba de hacer lo correcto.
    //
    // Se llega aquí sobre todo con `--todas`, que fuerza una modalidad distinta
    // de la que vende de verdad: el contenido y el recorrido no se corresponden.
    // Para probar lo que le pasa a él, sin `--modalidad`.
    if (estado?.state !== "payment_done" && !estado?.order_bump_choice) {
      console.log(
        "  ····  el bot pidió elegir producto antes de dar un precio — camino correcto,\n" +
          "        pero la venta no se cierra hasta que elija. Sin --modalidad se prueba entero."
      );
      return;
    }
    comprobar("con un numero de cuenta dentro", LLEVA_UNA_CUENTA.test(juntar(nuevas)), "donde pagar");
    // EL FALLO DE HOY: mandaba los datos y dejaba la venta abierta. De ese
    // apunte cuelgan el comprobante, el reenvio y el precio del monto.
    comprobar(
      "y DEJA LA VENTA ESPERANDO EL COMPROBANTE",
      estado?.state === "payment_done",
      `estado=${estado?.state}`
    );
    comprobar(
      "con el metodo anotado",
      !!estado?.selected_payment_method,
      `metodo=${estado?.selected_payment_method ?? "(ninguno)"}`
    );

    // REENVIAR NO ES VOLVER A VENDER.
    //
    // Cuando el cliente vuelve a nombrar su metodo, los datos SI se le reenvian
    // —los esta pidiendo—. Lo que no puede volver a salir es la presentacion de
    // primera vez, «puedes adquirir el curso de la siguiente manera», que es lo
    // que hacia parecer que el bot se habia olvidado. Eso era el bucle.
    //
    // Se compara contra LA CUENTA QUE SE MANDO, no contra "cualquier numero
    // largo": un precio o una fecha daban por repetido un bloque que no lo era.
    const soloDigitos = (t) => t.replace(/\D/g, "");
    const textos = nuevas.map((m) => String(m.content ?? ""));
    const laCuenta = soloDigitos(juntar(nuevas).match(LLEVA_UNA_CUENTA)?.[0] ?? "");
    // La presentacion es la burbuja de delante de los datos. Si la primera YA
    // lleva la cuenta, no hay presentacion que quitar y no hay nada que exigir.
    const laPresentacion =
      textos.length > 1 && !LLEVA_UNA_CUENTA.test(textos[0]) ? textos[0] : null;

    paso("Vuelve a nombrar el mismo metodo");
    const antesRepe = delBot(mensajes).length;
    await enviar(id, { texto: METODO });
    ({ estado, mensajes } = await esperarAlBot(id, { quietoMs: 7000 }));
    const repetidas = delBot(mensajes).slice(antesRepe);
    const loQueSalio = juntar(repetidas);
    comprobar(
      "le reenvia sus datos",
      !!laCuenta && soloDigitos(loQueSalio).includes(laCuenta),
      `${repetidas.length} burbujas`
    );
    const volvioAPresentar =
      !!laPresentacion && loQueSalio.includes(laPresentacion.trim().slice(0, 40));
    comprobar(
      "pero SIN volver a presentar la venta",
      !volvioAPresentar,
      laPresentacion ? "no se repite la de primera vez" : "no habia presentacion"
    );
    // Cuando algo falla aqui se ve QUE salio: sin esto habria que repetir el
    // recorrido a ciegas solo para enterarse.
    if (volvioAPresentar || !soloDigitos(loQueSalio).includes(laCuenta)) {
      for (const m of repetidas) {
        console.log(`        ⛔ ${String(m.content ?? "").replace(/\n/g, " | ").slice(0, 120)}`);
      }
    }

    // 4 · EL COMPROBANTE. Lo unico que no se puede simular sin vision.
    if (!COMPROBANTE) {
      paso("Comprobante, entrega y segundo producto");
      console.log(
        "  ····  saltado — hace falta una captura real:\n" +
          "        node scripts/recorrido-completo.mjs --comprobante=C:\\ruta\\yape.jpg"
      );
      return;
    }
    paso("Manda el comprobante");
    await enviar(id, { texto: "listo ya pague", archivo: COMPROBANTE });
    ({ estado, mensajes } = await esperarAlBot(id, { maximoMs: 150000, quietoMs: 9000 }));
    comprobar(
      "el pago queda aprobado",
      ["payment_approved", "awaiting_email", "awaiting_gift_consent"].includes(estado?.state),
      `estado=${estado?.state}`
    );

    // 5 · EL SEGUNDO PRODUCTO. Se ofrece solo, unos minutos despues.
    paso("Espera la oferta del segundo producto");
    let ofrecido = false;
    for (let i = 0; i < 60 && !ofrecido; i++) {
      const datos = await leer(id);
      estado = datos.conversation;
      mensajes = datos.messages ?? [];
      ofrecido = estado?.upsell_state === "ofrecido";
      if (!ofrecido) await esperar(3000);
    }
    comprobar("se le ofrece el extra", ofrecido, `upsell=${estado?.upsell_state ?? "(ninguno)"}`);
    if (!ofrecido) return;

    // AQUI SE COMPRUEBAN LOS DOS ARREGLOS DEL EXTRA.
    paso("Pregunta que es el extra");
    const antesExtra = delBot(mensajes).length;
    await enviar(id, { texto: "este es otro? no entiendo" });
    ({ estado, mensajes } = await esperarAlBot(id));
    const respuesta = juntar(delBot(mensajes).slice(antesExtra));
    comprobar("contesta algo", respuesta.trim().length > 0);
    // Podia decir QUE ES. Antes solo tenia nombre y precio, asi que explicaba lo
    // que NO es.
    comprobar(
      "no se excusa diciendo lo que NO es",
      !/no tiene (nada )?que ver con/i.test(respuesta),
      "sabe describirlo"
    );
    // No lo rebaja. Le dabamos la palabra «optional» y se la repetia.
    comprobar(
      "no lo llama opcional ni sin importancia",
      !/\b(opcional|no es (necesario|importante)|sin importancia)\b/i.test(respuesta),
      "es un producto que vende"
    );
    // Y CIERRA. Terminaba preguntando por el producto ya entregado.
    comprobar(
      "y cierra con una pregunta",
      /\?/.test(respuesta.trim().slice(-400)),
      "lleva la venta adelante"
    );
    // NO VUELVE A PEDIR UN COMPROBANTE QUE YA RECIBIO Y APROBO.
    //
    // 15 de septiembre de 2026, tres pantallas en paralelo. A la misma frase
    // —«este es otro»— dos contestaron vendiendo el extra y la tercera se fue por
    // otro lado: pidio otra vez la foto del comprobante de una compra YA
    // aprobada y entregada, y siguio pidiendola aunque el cliente le dijo dos
    // veces que ya la habia mandado.
    //
    //   «¿ya me enviaste la foto de tu comprobante de pago por los S/. X?
    //    No la veo aun en el chat»
    //
    // No se busca la palabra «comprobante» a secas: hablar del comprobante DEL
    // EXTRA es legitimo, el cliente todavia no lo ha pagado. Lo que no puede
    // aparecer es el bot diciendo que NO VE un pago que el sistema ya aprobo.
    const NIEGA_UN_PAGO_HECHO =
      /\b(no (la |lo |me )?(veo|aparece|ha llegado|he recibido|recib[ií])|no me (aparece|figura|llego)|vuelve a (enviar|mandar)|reenv[ií](a|amela)|env[ií]amela de nuevo|no encuentro (la |el )?(foto|imagen|comprobante))\b/i;
    comprobar(
      "no vuelve a pedir el comprobante ya aprobado",
      !NIEGA_UN_PAGO_HECHO.test(respuesta),
      "el pago ya estaba entregado"
    );
    // Y NO SE VA POR LAS RAMAS. En la que fallo, el modelo escupio 904 tokens de
    // salida contra los 211 de la que salio bien, con el MISMO mensaje. Esa
    // parrafada es donde se colo la pregunta del comprobante: cuando el modelo
    // no sabe cual de dos ordenes seguir, las escribe las dos.
    comprobar(
      "y contesta corto, sin parrafada",
      respuesta.trim().length < 2000,
      `${respuesta.trim().length} caracteres`
    );

    paso("Lo acepta");
    const antesSi = delBot(mensajes).length;
    const datosBotones = await leer(id);
    const botones = Object.values(datosBotones.buttons ?? {}).flat();
    const botonSi = botones.find((b) => /s[ií]|quiero/i.test(b.title ?? ""));
    await enviar(id, botonSi ? { boton: botonSi, texto: botonSi.title } : { texto: "si lo quiero" });
    ({ estado, mensajes } = await esperarAlBot(id, { quietoMs: 7000 }));
    const trasSi = juntar(delBot(mensajes).slice(antesSi));
    comprobar("queda aceptado", estado?.upsell_state === "aceptado", `upsell=${estado?.upsell_state}`);
    comprobar("y le manda donde pagarlo", LLEVA_UNA_CUENTA.test(trasSi), "datos del extra");
  } finally {
    if (CONSERVAR) {
      console.log(`\n  (conversacion ${id} conservada)`);
    } else {
      await pedir(`/api/test-simulator/${id}`, { method: "DELETE" }).catch(() => {});
    }
  }
}

// ── Arranque ─────────────────────────────────────────────────────────────────
if (COMPROBANTE && !existsSync(COMPROBANTE)) {
  console.error(`No encuentro el comprobante: ${COMPROBANTE}`);
  process.exit(2);
}
const problema = await entrar();
if (problema || !(await servidorVivo())) {
  console.error(
    `\nNo pude entrar: ${problema ?? "el simulador no responde"}\n\n` +
      `  1. En otra terminal:  npm run dev\n` +
      `  2. Cuando diga «Ready», vuelve a lanzar esto.\n\n` +
      `  (o apunta a otro sitio con --url=https://...)\n`
  );
  process.exit(2);
}

console.log(
  `\nRECORRIDO COMPLETO — ${MODALIDADES.length} modalidad(es)` +
    `\nalcance: motor${CON_MODELO ? " + modelo" : ""}${COMPROBANTE ? " + comprobante" : ""}`
);

for (const modalidad of MODALIDADES) {
  try {
    await recorrer(modalidad);
  } catch (err) {
    fallos++;
    console.log(`  FALLA ${pad("el recorrido se corto", 52)} ${err.message}`);
  }
}

console.log(
  fallos === 0
    ? "\n\nTODO OK — la venta llega hasta el final"
    : `\n\n${fallos} comprobacion(es) mal.`
);
process.exit(fallos === 0 ? 0 : 1);
