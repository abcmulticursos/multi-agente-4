// El bot pedia el correo desde un sitio que no se podia ni ver ni apagar.
//
// LO QUE HABIA
//
// Dos caminos distintos piden el correo despues de la compra:
//
//  1. «Preguntar si desea solo WhatsApp o WhatsApp + correo antes de entregar».
//     Ya estaba en la pestana Entrega y ya se podia apagar. No era este.
//
//  2. El recordatorio de DESPUES del regalo. Este era el problema:
//       - su interruptor estaba en Ajustes, no en Entrega
//       - iba PEGADO al re-ofrecimiento del regalo en una sola casilla, asi que
//         no se podia apagar uno sin apagar el otro
//       - su texto vivia SOLO en el codigo: el bot mandaba un mensaje que no
//         aparecia en ninguna pantalla del editor
//
// LO QUE AHORA
//
// El recordatorio tiene su propio interruptor, en Entrega, junto a la otra
// pregunta de correo. Y su texto sale a la pantalla en un cajon de burbujas con
// visor, con el de fabrica ya cargado.
//
// SIN CAMBIAR NADA MIENTRAS NO SE TOQUE
//
// Sin valor guardado, el interruptor nuevo HEREDA el del re-ofrecimiento, que es
// con quien iba pegado. El bot se comporta exactamente igual que antes hasta que
// alguien decida separarlos.
//
//   node scripts/prueba-peticion-de-correo.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");

const config = leer("src", "lib", "workflow", "config.ts");
const engine = leer("src", "lib", "workflow", "engine.ts");
const api = leer("src", "app", "api", "workflow", "route.ts");
const editor = leer("src", "app", "editor", "page.tsx");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 60)} ${valor}`);
};

// ── 1. El interruptor propio ────────────────────────────────────────────────
comprobar(
  "el recordatorio tiene su propio interruptor",
  /post_sale_email_reminder_enabled\?: boolean;/.test(config),
  "sí"
);
comprobar(
  // ESTO es lo que evita que el arreglo cambie el bot de alguien. Sin la
  // herencia, una configuración que nunca tocó el campo se quedaria sin
  // recordatorio de un dia para otro.
  "sin valor guardado hereda el del regalo",
  /function pedirCorreoTrasElRegalo\(config: WorkflowConfig \| null\): boolean \{[\s\S]*?return config\?\.post_sale_reoffer !== false;/.test(
    engine
  ),
  "igual que antes"
);
comprobar(
  "y el regalo ya no lo arrastra",
  /if \(pedirCorreoTrasElRegalo\(cfg\)\) scheduleEmailReminderAfterGift\(convo\);/.test(
    engine
  ) && !/post_sale_reoffer !== false\) scheduleEmailReminderAfterGift/.test(engine),
  "separados"
);
comprobar(
  // Pedirlo dos veces molesta. Estaba bien pensado desde antes; que siga.
  "los dos caminos se siguen excluyendo",
  /post_sale_delivery_preference\?\.enabled === true\) return;/.test(engine),
  "intacto"
);

// ── 2. El texto, a la vista ─────────────────────────────────────────────────
comprobar(
  "el recordatorio se puede escribir en burbujas",
  /email_reminder_steps\?: ResponseStep\[\];/.test(config),
  "sí"
);
comprobar(
  // Si no mandaran sobre el texto suelto, se editarían las burbujas y saldría
  // el texto viejo.
  "las burbujas mandan sobre el texto suelto",
  /const burbujas = loadWorkflowConfig\(\)\?\.email_reminder_steps;\s*\r?\n\s*if \(await sendConfiguredSteps\(convo, burbujas\)\) \{/.test(
    engine
  ),
  "las burbujas"
);
comprobar(
  "y sin burbujas sigue el texto de siempre",
  /const reminder = getConfiguredEmailReminder\(convo\);/.test(engine),
  "intacto"
);
comprobar(
  // El texto de fábrica vivía solo en el motor. Enseñarlo en el editor es el
  // punto entero de este arreglo.
  "el texto de fábrica está en el editor",
  /const TEXTO_DE_FABRICA_DEL_RECORDATORIO =/.test(editor),
  "a la vista"
);
comprobar(
  // Si divergen, la pantalla enseña un texto y el bot manda otro.
  "y dice lo mismo que el del motor",
  editor.includes(
    "*Recuerda que los mensajes de whatsapp suelen desaparecer con el tiempo.*"
  ) &&
    engine.includes(
      "*Recuerda que los mensajes de whatsapp suelen desaparecer con el tiempo.*"
    ),
  "el mismo"
);

// ── 3. El guardado ──────────────────────────────────────────────────────────
comprobar(
  "el guardado lee los tres campos nuevos",
  /post_sale_email_reminder_enabled =/.test(api) &&
    /const email_reminder_text = str\(config\?\.email_reminder_text\);/.test(api) &&
    /const email_reminder_steps = Array\.isArray\(config\?\.email_reminder_steps\)/.test(
      api
    ),
  "sí"
);
comprobar(
  // Sin esto se escribe en la pantalla y no llega nunca al archivo.
  "y los escribe",
  /doc\.set\(\s*\r?\n?\s*"post_sale_email_reminder_enabled",/.test(api) &&
    /doc\.set\(\s*\r?\n?\s*"email_reminder_text",/.test(api) &&
    /doc\.set\(\s*\r?\n?\s*"email_reminder_steps",/.test(api),
  "los tres"
);
comprobar(
  "el guardado también hereda cuando no hay valor",
  /\? config\.post_sale_email_reminder_enabled\s*\r?\n\s*: post_sale_reoffer;/.test(
    api
  ),
  "lo de hoy"
);

// ── 4. La pantalla ──────────────────────────────────────────────────────────
comprobar(
  "el interruptor está en Entrega",
  /Volver a pedir el correo DESPUÉS del regalo \(una sola vez\)/.test(editor),
  "sí"
);
const seccionEntrega = editor.indexOf(
  'title="📧 Entrega postventa WhatsApp/correo"'
);
// Con el "(una sola vez)": sin eso el primer acierto es el comentario del tipo,
// que está mil líneas antes y no dice nada de dónde salió la casilla.
const interruptor = editor.indexOf(
  "Volver a pedir el correo DESPUÉS del regalo (una sola vez)"
);
comprobar(
  "dentro del mismo cajón que la otra pregunta de correo",
  seccionEntrega > 0 && interruptor > seccionEntrega,
  "juntos"
);
comprobar(
  "con su cajón de burbujas y su visor",
  /steps=\{cfg\.email_reminder_steps\}/.test(editor) &&
    /idPrefix="email_reminder"/.test(editor),
  "sí"
);
comprobar(
  // Callar aquí deja buscando un mensaje que el bot no manda por diseño.
  "avisa cuando los dos caminos chocan",
  /Con la pregunta de arriba <strong>encendida<\/strong>, este/.test(editor),
  "en amarillo"
);
comprobar(
  // La etiqueta prometía dos cosas y ahora solo hace una.
  "la casilla de Ajustes ya no promete el correo",
  !/Re-ofrecer regalo y volver a pedir correo tras la compra/.test(editor) &&
    /Re-ofrecer el regalo tras la compra/.test(editor),
  "corregida"
);

console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} comprobación(es) mal.`);
process.exit(fallos === 0 ? 0 : 1);
