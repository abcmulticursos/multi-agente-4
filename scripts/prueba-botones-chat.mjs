// Los botones que vio el cliente, visibles en el chat del panel.
//
// Dos cosas se comprueban aquí, y las dos son promesas que hice:
//
//  1. Que en el chat NO se puedan pulsar. Van como <span>, no como <button>:
//     el único que puede pulsarlos es el cliente, en su teléfono.
//  2. Que guardarlos no pueda romper una entrega. El guardado va DESPUÉS del
//     envío y envuelto, así que un fallo suyo se anota y se sigue.
//
//   node scripts/prueba-botones-chat.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...partes) => readFileSync(join(RAIZ, ...partes), "utf8");

const sender = leer("src", "lib", "workflow", "sender.ts");
const panel = leer("src", "components", "ConversationPanel.tsx");
const ruta = leer("src", "app", "api", "messages", "[conversationId]", "route.ts");
const simulador = leer("src", "app", "simulador", "page.tsx");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (nombre, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(nombre, 60)} ${valor}`);
};

// ── 1. La entrega no se puede romper ────────────────────────────────────────
comprobar(
  "el guardado de botones está envuelto y no puede propagar un fallo",
  /function recordarBotones\([\s\S]{0,400}?try \{[\s\S]{0,200}?setTestMessageButtons[\s\S]{0,200}?\} catch/.test(
    sender
  ),
  "sí"
);

const guardadosSueltos = [
  ...sender.matchAll(/(?<!function recordarBotones[\s\S]{0,400})setTestMessageButtons\(/g),
];
comprobar(
  "nadie guarda botones fuera de esa envoltura",
  sender.split("setTestMessageButtons(").length - 1 === 1,
  `${sender.split("setTestMessageButtons(").length - 1} llamada(s) directa(s)`
);

// El guardado va DESPUÉS del envío: nunca antes, para que no retrase el mensaje
// ni pueda impedirlo.
for (const [nombre, bloque] of [
  ["botones", sender.slice(sender.indexOf("export async function sendBotButtons("))],
  [
    "botones con media",
    sender.slice(sender.indexOf("export async function sendBotButtonsWithMedia(")),
  ],
]) {
  // Ojo: en sendBotButtons el camino del simulador aparece ANTES y también
  // guarda, pero ese no envía nada a Meta. Lo que se mira es que en el camino
  // real, a partir de la llamada a Meta, el guardado venga después.
  const trozo = bloque.slice(0, 2600);
  const posEnvio = trozo.indexOf("sendInteractiveButtons");
  const despuesDelEnvio = posEnvio > -1 ? trozo.slice(posEnvio) : "";
  comprobar(
    `en "${nombre}" se guarda después de enviar, nunca antes`,
    posEnvio > -1 && despuesDelEnvio.includes("recordarBotones"),
    despuesDelEnvio.includes("recordarBotones") ? "sí" : "NO — se guardaría antes del envío"
  );
}

// ── 2. En el chat solo se miran ─────────────────────────────────────────────
// Solo el trozo que pinta los botones: desde el comentario hasta el título del
// botón. Con una ventana más ancha se colaban los <button> de alrededor y la
// comprobación no decía nada.
const inicioDelChat = panel.indexOf("Los botones que vio el cliente");
// Se arranca DESPUÉS del comentario: ese comentario menciona "<button>" para
// explicar por qué no se usa, y la comprobación lo tomaba por un botón real.
const bloqueDelChat = panel.slice(
  panel.indexOf("*/}", inicioDelChat),
  panel.indexOf("{boton.title}", inicioDelChat)
);
comprobar(
  "en el chat los botones NO son pulsables (van como span)",
  bloqueDelChat.includes("<span") && !/<button/.test(bloqueDelChat),
  bloqueDelChat.includes("<span") ? "span, sin acción" : "OJO: hay un <button>"
);
comprobar(
  "en el chat no se les cuelga ningún clic",
  !/onClick/.test(bloqueDelChat),
  "sin onClick"
);
comprobar(
  "en el chat van apilados, no en fila",
  /flex-col/.test(bloqueDelChat),
  "sí"
);

// ── 3. Los datos llegan al chat ─────────────────────────────────────────────
comprobar(
  "la API del chat devuelve los botones de cada mensaje",
  ruta.includes("getTestMessageButtons") && ruta.includes("messages, buttons"),
  "sí"
);

// ── 4. El simulador se ve igual que WhatsApp ────────────────────────────────
const bloqueSimulador = simulador.slice(
  simulador.indexOf("Apilados, como los pinta WhatsApp"),
  simulador.indexOf("Apilados, como los pinta WhatsApp") + 900
);
comprobar(
  "en el simulador van apilados",
  /flex-col/.test(bloqueSimulador) && !/mr-2/.test(bloqueSimulador),
  "sí"
);
comprobar(
  "en el simulador SÍ se pueden pulsar (ahí se prueba el flujo)",
  /<button/.test(bloqueSimulador) && /onClick/.test(bloqueSimulador),
  "sí"
);

console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} comprobación(es) mal.`);
process.exit(fallos === 0 ? 0 : 1);
