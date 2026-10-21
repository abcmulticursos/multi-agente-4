// «nada menos» es un regateo, no una eleccion de producto.
//
// LO QUE PASO — 14 de septiembre de 2026, -OB-
//
//   El cliente habia pagado el basico, le habian entregado su enlace, y estaba
//   haciendo el UPGRADE al combo: el motor ya le habia anotado «saldo pendiente
//   S/.4». Entonces escribio:
//
//       «NADA MENOS»
//
//   que en su boca significa «¿no hay descuento?». El motor leyo la palabra
//   `menos` y lo tomo por «quiero el barato»:
//
//       [wf] convo 57 order bump eligió/cambió a "basico"
//       [wf:pago] convo 57 APROBADO tras confirmar "basico" (total: S/. 10)
//
//   `resolveAccumulatedOrderBumpChoice` hizo tres cosas seguidas:
//     · setOrderBumpChoice("basico")        -> CANCELO el upgrade en vuelo
//     · lockExpectedPriceForConvo(10, ...)  -> congelo lo esperado en lo ya pagado
//     · deliverOrderBumpTier("basico")      -> le reenvio el enlace que ya tenia
//
//   Cuando el cliente mando el comprobante del saldo, no habia nada que
//   resolver. Pago y no recibio nada.
//
// LA CAUSA
//
//   `wantsCheaper` llevaba la palabra suelta `menos`. Con eso, «nada menos»,
//   «algo menos», «menos mal», «por lo menos» y «mas o menos» son todas «quiero
//   la opcion barata». Ninguna lo es.
//
//   Y no salta siempre: depende de la ETAPA. En `payment_approved` la puerta del
//   cambio de opcion no corre, y por eso «algo menos» en otra conversacion si se
//   entendio como regateo. Misma palabra, resultado opuesto.
//
// EL ARREGLO
//
//   `menos` sola no nombra ningun producto. Solo vale en comparacion —«el de
//   menos», «menos caro»—. La regla no se quita: se acota a esas formas.
//
// ESTA PRUEBA ES DE EXTREMO A EXTREMO, contra el motor real:
//
//   1. En una terminal:  npm run dev
//   2. En otra:          node scripts/prueba-regatear-no-es-elegir.mjs
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const BASE = "http://localhost:3000";
let cookieDeSesion = null;
let fallos = 0;

const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 46)} ${valor}`);
};

const pedir = (ruta, opciones = {}) =>
  fetch(`${BASE}${ruta}`, {
    ...opciones,
    headers: {
      ...(opciones.headers ?? {}),
      ...(cookieDeSesion ? { cookie: cookieDeSesion } : {}),
    },
  });

function claveDelPanel() {
  if (process.env.DASHBOARD_PASSWORD) return process.env.DASHBOARD_PASSWORD;
  const env = join(RAIZ, ".env");
  if (!existsSync(env)) return null;
  const linea = readFileSync(env, "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith("DASHBOARD_PASSWORD="));
  return linea
    ? linea.slice("DASHBOARD_PASSWORD=".length).trim().replace(/^"|"$/g, "")
    : null;
}

async function entrar() {
  const clave = claveDelPanel();
  if (!clave) throw new Error("no encuentro DASHBOARD_PASSWORD");
  const r = await fetch(`${BASE}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: clave }),
  });
  if (!r.ok) throw new Error(`el panel rechazo la clave (${r.status})`);
  const sesion = (r.headers.getSetCookie?.() ?? []).find((c) =>
    c.startsWith("wa_session=")
  );
  cookieDeSesion = sesion.split(";")[0];
}

async function crear() {
  const r = await pedir("/api/test-simulator", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ country: "PE", name: "Regateo", channel: "whatsapp" }),
  });
  const { id } = await r.json();
  await pedir(`/api/test-simulator/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ modality: "order_bump" }),
  });
  return id;
}

const leer = async (id) => {
  const r = await pedir(`/api/test-simulator/${id}`, {
    headers: { "Cache-Control": "no-store" },
  });
  return r.json();
};

async function enviar(id, texto) {
  const form = new FormData();
  form.set("content", texto);
  await pedir(`/api/test-simulator/${id}/message`, { method: "POST", body: form });
}

async function esperar(id, { maximoMs = 75000, quietoMs = 4000, hasta = null } = {}) {
  const inicio = Date.now();
  let ultimas = -1;
  let ultimoCambio = Date.now();
  let estado = null;
  while (Date.now() - inicio < maximoMs) {
    const datos = await leer(id);
    estado = datos.conversation ?? datos.estado ?? datos;
    const cuantas = (datos.messages ?? []).length;
    if (cuantas !== ultimas) {
      ultimas = cuantas;
      ultimoCambio = Date.now();
    }
    if (hasta && hasta(estado)) return estado;
    if (Date.now() - ultimoCambio > quietoMs) return estado;
    await new Promise((r) => setTimeout(r, 900));
  }
  return estado;
}

const borrar = (id) =>
  pedir(`/api/test-simulator/${id}`, { method: "DELETE" }).catch(() => {});

/** Deja la conversacion con el COMBO elegido y los datos de pago enviados. */
async function conElComboElegido() {
  const id = await crear();
  await enviar(id, "hola");
  await esperar(id, { hasta: (e) => e?.state === "intro_done" });
  await enviar(id, "yape");
  await esperar(id, { hasta: (e) => e?.state === "awaiting_order_bump_choice" });
  await enviar(id, "el combo");
  await esperar(id, { hasta: (e) => e?.order_bump_choice === "combo" });
  return id;
}

async function pruebaDe(frase, { cambia }) {
  const id = await conElComboElegido();
  try {
    await enviar(id, frase);
    const estado = await esperar(id, {
      maximoMs: 50000,
      hasta: (e) => (cambia ? e?.order_bump_choice === "basico" : false),
    });
    const ahora = estado?.order_bump_choice ?? null;
    comprobar(
      `«${frase}»`,
      cambia ? ahora === "basico" : ahora === "combo",
      cambia ? `${ahora} (debe cambiar)` : `sigue en ${ahora}`
    );
  } finally {
    await borrar(id);
  }
}

// ── Corre ────────────────────────────────────────────────────────────────────
await entrar();

// SI -OB- ESTA APAGADO EN EL CONTENIDO, ESTA PRUEBA NO APLICA HOY.
//
// Necesita la segunda intro —la que revela el producto oculto— y esa solo
// existe con Order Bump encendido. Con la modalidad apagada el bot manda los
// datos de pago de frente, nunca abre la eleccion y todas las comprobaciones
// salen «sin elegir». Eso NO es un fallo del bot: es que la prueba no tiene
// dónde correr. Se dice con sus letras y se sale en verde, igual que hace
// `recorrido-completo.mjs` cuando le falta una pieza.
{
  const id = await crear();
  await enviar(id, "hola");
  await esperar(id, { hasta: (e) => e?.state === "intro_done" });
  await enviar(id, "yape");
  const estado = await esperar(id, {
    hasta: (e) => e?.state === "awaiting_order_bump_choice",
  });
  await borrar(id);
  if (estado?.state !== "awaiting_order_bump_choice") {
    console.log(
      "\n····  saltado — Order Bump esta apagado en el contenido, asi que el bot" +
        "\n      no abre la eleccion de dos opciones. Enciendelo en el editor" +
        "\n      para correr esta prueba.\n"
    );
    process.exit(0);
  }
}

console.log("\n— regatear NO es elegir el producto barato —\n");
await pruebaDe("nada menos", { cambia: false });
await pruebaDe("algo menos", { cambia: false });
await pruebaDe("no hay algo menos", { cambia: false });
await pruebaDe("mas o menos", { cambia: false });

console.log("\n— pero pedir el barato SIGUE cambiando la opcion —\n");
await pruebaDe("mejor el barato", { cambia: true });
await pruebaDe("quiero el de menos", { cambia: true });
await pruebaDe("dame el mas economico", { cambia: true });

console.log(
  fallos === 0
    ? "\nTODO OK — pedir rebaja ya no cancela la compra"
    : `\n${fallos} comprobacion(es) mal.`
);
process.exit(fallos === 0 ? 0 : 1);
