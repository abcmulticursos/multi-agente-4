// «el 2» y «el segundo» son una eleccion, no un numero suelto.
//
// LO QUE PASO — 14 de septiembre de 2026, dos conversaciones de -OB-
//
//   El bot enumera las opciones el mismo:
//
//       «1. COMBO TINTAS PEPITO + PAPEL — … S/. 14 Soles»
//       «2. TINTAS PEPITO — … S/. 10 Soles»
//       «¿Cuál de las dos opciones prefieres?»
//
//   El cliente contesta «el 2». Y el motor no registra nada: el numero solo se
//   entendia como PRECIO («el de 10»), nunca como POSICION. El turno caia al
//   modelo, que mando la galeria de imagenes en vez de cerrar la venta.
//
//   En la otra conversacion, «el segundo» hizo lo mismo: sin eleccion anotada,
//   el bot pidio el metodo de pago que el cliente YA habia elegido, y al
//   repetirlo le recordo las dos opciones otra vez. Dos vueltas enteras.
//
//   O sea: el bot numera las opciones y luego no sabe leer su propio numero.
//
// ESTA PRUEBA ES DE EXTREMO A EXTREMO. Levanta la venta de verdad contra el
// motor, igual que `recorrido-completo.mjs`:
//
//   1. En una terminal:  npm run dev
//   2. En otra:          node scripts/prueba-elegir-por-el-numero.mjs
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const BASE = "http://localhost:3000";
let cookieDeSesion = null;
let fallos = 0;

const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 48)} ${valor}`);
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
  return linea ? linea.slice("DASHBOARD_PASSWORD=".length).trim().replace(/^"|"$/g, "") : null;
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
  if (!sesion) throw new Error("el panel no devolvio sesion");
  cookieDeSesion = sesion.split(";")[0];
}

async function crear() {
  const r = await pedir("/api/test-simulator", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ country: "PE", name: "Numero", channel: "whatsapp" }),
  });
  if (!r.ok) throw new Error(`no pude crear: ${r.status}`);
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
  if (!r.ok) throw new Error(`no pude leer ${id}`);
  return r.json();
};

async function enviar(id, texto) {
  const form = new FormData();
  form.set("content", texto);
  const r = await pedir(`/api/test-simulator/${id}/message`, {
    method: "POST",
    body: form,
  });
  if (!r.ok) throw new Error(`no pude enviar «${texto}»`);
}

async function esperar(id, { maximoMs = 90000, quietoMs = 4000, hasta = null } = {}) {
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

async function borrar(id) {
  await pedir(`/api/test-simulator/${id}`, { method: "DELETE" }).catch(() => {});
}

/** Lleva la conversacion hasta «el bot ya enseño las dos opciones». */
let laEleccionSeAbrio = false;
async function hastaLaEleccion() {
  const id = await crear();
  await enviar(id, "hola");
  await esperar(id, { hasta: (e) => e?.state === "intro_done" });
  await enviar(id, "yape");
  const estado = await esperar(id, {
    hasta: (e) => e?.state === "awaiting_order_bump_choice",
  });
  laEleccionSeAbrio = estado?.state === "awaiting_order_bump_choice";
  return id;
}

/**
 * SI -OB- ESTA APAGADO EN EL CONTENIDO, ESTA PRUEBA NO APLICA HOY.
 *
 * Necesita la segunda intro —la que revela el producto oculto— y esa solo
 * existe con Order Bump encendido. Con la modalidad apagada el bot manda los
 * datos de pago de frente, nunca abre la eleccion y todas las comprobaciones
 * salen «sin elegir». Eso NO es un fallo del bot: es que la prueba no tiene
 * dónde correr. Se dice con sus letras y se sale en verde, igual que hace
 * `recorrido-completo.mjs` cuando le falta una pieza.
 */
function saltarSiNoHayEleccion(id) {
  if (laEleccionSeAbrio) return false;
  void borrar(id);
  console.log(
    "\n····  saltado — Order Bump esta apagado en el contenido, asi que el bot" +
      "\n      no abre la eleccion de dos opciones. Enciendelo en el editor" +
      "\n      para correr esta prueba.\n"
  );
  return true;
}

async function pruebaDe(frase, esperada) {
  const id = await hastaLaEleccion();
  if (saltarSiNoHayEleccion(id)) process.exit(0);
  try {
    await enviar(id, frase);
    const estado = await esperar(id, {
      maximoMs: 60000,
      hasta: (e) => !!e?.order_bump_choice,
    });
    const elegida = estado?.order_bump_choice ?? null;
    comprobar(
      `«${frase}» elige la opcion ${esperada === "basico" ? "2" : "1"}`,
      elegida === esperada,
      `${elegida ?? "sin elegir"}`
    );
  } finally {
    await borrar(id);
  }
}

// ── Corre ────────────────────────────────────────────────────────────────────
await entrar();
console.log("\n— el cliente contesta con el numero de la lista —\n");

// La oferta presenta el full arriba y el basico abajo: 1 = full, 2 = basico.
await pruebaDe("el 2", "basico");
await pruebaDe("el segundo", "basico");
await pruebaDe("el 1", "combo");
await pruebaDe("2", "basico");

console.log("\n— y lo que NO es un numero de la lista sigue igual —\n");
// «2 en 1» es parte del nombre de un producto en otras instalaciones: un
// numero dentro de una frase NO puede elegir.
const id = await hastaLaEleccion();
try {
  await enviar(id, "que trae el 2 en 1");
  const estado = await esperar(id, { maximoMs: 45000 });
  comprobar(
    "«que trae el 2 en 1» no elige nada",
    !estado?.order_bump_choice,
    `${estado?.order_bump_choice ?? "sin elegir"}`
  );
} finally {
  await borrar(id);
}

console.log(
  fallos === 0
    ? "\nTODO OK — el bot sabe leer el numero que el mismo escribio"
    : `\n${fallos} comprobacion(es) mal.`
);
process.exit(fallos === 0 ? 0 : 1);
