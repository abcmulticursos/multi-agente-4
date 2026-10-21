// CADA PÁGINA DE FACEBOOK CONTESTA POR LA SUYA.
//
// LO PIDIÓ EL DUEÑO el 1 de octubre de 2026, montando su segundo número: «¿cómo se va
// a manejar el tema de los webhooks de messenger ya que yo voy a usar 2 páginas y solo
// hay un webhook?». Y después: «recuerda que vamos a usar muchos números».
//
// EL FALLO QUE HABÍA, y era de los callados:
//
//     if (activeMessenger && entry.id !== activeMessenger.page_id) {
//       console.log("[messenger] evento de pagina no activa, ignoro");
//       continue;
//     }
//
// Messenger atendía SOLO la página activa. Un mensaje de la segunda página se TIRABA.
// El cliente escribía y nadie le contestaba: sin error, sin aviso, solo esa línea en
// el registro. Y aunque se hubiera aceptado, el envío tomaba el token de la página
// ACTIVA, así que habría contestado por la página equivocada.
//
// WhatsApp ya lo tenía resuelto desde el 21/09 —acepta cualquier número conectado y
// responde con el token de ése—. Esto es el mismo mecanismo, para páginas.
//
// LO QUE PROTEGE:
//
//     CON UNA SOLA PÁGINA CONECTADA, NADA CAMBIA. Sin contexto fijado se cae a la
//     página activa, que es exactamente lo que hacía antes.
//
//   node scripts/prueba-cada-pagina-contesta-por-la-suya.mjs
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const DOBLE = "stub:db";
registerHooks({
  resolve(esp, ctx, next) {
    if (esp === "@/lib/db") return { url: DOBLE, format: "module", shortCircuit: true };
    if (esp.startsWith("@/")) {
      const rel = esp.slice(2);
      const conExt = /\.[a-z]+$/.test(rel) ? rel : `${rel}.ts`;
      return { url: pathToFileURL(join(RAIZ, "src", conExt)).href, shortCircuit: true };
    }
    return next(esp, ctx);
  },
  load(url, ctx, next) {
    if (url === DOBLE)
      return {
        format: "module", shortCircuit: true,
        source: `
          export const getMetaRuntimeSetting = () => null;
          export const getActiveMetaWhatsAppConnection = () => null;
          export const getMetaWhatsAppConnection = () => null;
          export const listMetaWhatsAppConnections = () => [];
          export const listMetaConnections = () => [];
          export const getActiveMetaConnection = () => null;
          export const getMetaConnectionByPageId = () => null;
          export const getConversationByPhone = () => null;
          export const getConversationById = () => null;
          export const getFrozenPrices = () => null;
          export const getUpsellFrozenPrices = () => null; export const getPuestoEnLaFila = () => null; export const leerCompradosDeLaFila = () => []; export const moverLaFila = () => {};
          export const setFrozenPrices = () => {};
        `,
      };
    return next(url, ctx);
  },
});
const rc = await import(
  pathToFileURL(join(RAIZ, "src", "lib", "meta", "runtime-config.ts")).href
);

const webhook = readFileSync(
  join(RAIZ, "src", "app", "api", "webhooks", "messenger", "route.ts"),
  "utf8"
);
const cliente = readFileSync(join(RAIZ, "src", "lib", "messenger", "client.ts"), "utf8");
const media = readFileSync(join(RAIZ, "src", "lib", "messenger", "media.ts"), "utf8");
const motor = readFileSync(join(RAIZ, "src", "lib", "workflow", "engine.ts"), "utf8");
const base = readFileSync(join(RAIZ, "src", "lib", "db.ts"), "utf8");

let fallos = 0;
const pad = (s, n) => (String(s ?? "") + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// ── 1. LA PÁGINA DEL TURNO, EJECUTADA ───────────────────────────────────────
console.log("\n— 1. la página del turno —\n");
comprobar(
  "fuera de un turno no hay página fijada",
  rc.getOutboundMessengerPage() === null,
  "se cae a la activa, como antes"
);
comprobar(
  "dentro de un turno, la suya",
  rc.withOutboundMessengerPage("pag_A", () => rc.getOutboundMessengerPage()) ===
    "pag_A"
);
comprobar(
  "dos turnos seguidos no se arrastran",
  [
    rc.withOutboundMessengerPage("pag_A", () => rc.getOutboundMessengerPage()),
    rc.withOutboundMessengerPage("pag_B", () => rc.getOutboundMessengerPage()),
    rc.getOutboundMessengerPage(),
  ].join(",") === "pag_A,pag_B,",
  "cada uno el suyo"
);
comprobar(
  "sin página no envuelve nada",
  rc.withOutboundMessengerPage(null, () => rc.getOutboundMessengerPage()) === null,
  "el camino de siempre, intacto"
);

// ── 2. EL WEBHOOK ACEPTA CUALQUIERA DE LAS SUYAS ────────────────────────────
//
// Y NO SE QUITA EL FILTRO: sigue descartando lo ajeno, que es lo que impide
// contestar a eventos de otra gente. Lo que cambia es contra qué se compara.
console.log("\n— 2. el webhook acepta cualquiera de sus páginas —\n");
comprobar(
  "se compara contra la LISTA de conectadas",
  /const conectadas = listMetaConnections\(\)\.map\(\(c\) => c\.page_id\)/.test(
    webhook
  ),
  "no contra una sola"
);
comprobar(
  "y ya no contra la activa",
  !/entry\.id !== activeMessenger\.page_id/.test(webhook),
  "ése era el que tiraba la segunda"
);
comprobar(
  "el filtro de lo ajeno SIGUE puesto",
  /!propias\.includes\(entry\.id\)/.test(webhook),
  "no se abre la puerta a cualquiera"
);
comprobar(
  "sin páginas guardadas, la activa como antes",
  /\[activeMessenger\?\.page_id\]\.filter/.test(webhook),
  "instalación por variables de entorno"
);
comprobar(
  "y el turno corre dentro de su página",
  /await withOutboundMessengerPage\(entry\.id, \(\) =>/.test(webhook)
);

// ── 3. SE CONTESTA CON EL TOKEN DE ESA PÁGINA ───────────────────────────────
//
// Es la otra mitad, y sin ella aceptar el mensaje no sirve: Meta rechaza el envío
// con el token de otra página, o peor, contesta desde la que no es.
console.log("\n— 3. con el token de esa página —\n");
comprobar(
  "el que manda texto lo usa",
  /const deLaPagina = getOutboundMessengerPage\(\);[\s\S]{0,260}?getMetaConnectionByPageId\(deLaPagina\)\?\.page_access_token/.test(
    cliente
  ),
  "messenger/client.ts"
);
comprobar(
  "y el que descarga adjuntos también",
  /getMetaConnectionByPageId\(deLaPagina\)\?\.page_access_token/.test(media),
  "messenger/media.ts"
);
comprobar(
  "con el respaldo de siempre detrás",
  /getActiveMetaConnection\(\)\?\.page_access_token \?\?\s*\r?\n?\s*process\.env\.MESSENGER_PAGE_ACCESS_TOKEN/.test(
    cliente
  ),
  "la activa, y luego el entorno"
);

// ── 4. EL SEGUIMIENTO DE HORAS DESPUÉS, POR SU PÁGINA ───────────────────────
//
// Sale del obrero, y ahí ya no está el webhook para saber de qué página era. Sin
// esto, con dos páginas la mitad de los seguimientos saldrían por la que no es.
console.log("\n— 4. el seguimiento sale por su página —\n");
comprobar(
  "la conversación recuerda su página",
  /\["messenger_page_id", "TEXT"\]/.test(base) &&
    /export function setConversationMessengerPage\(/.test(base)
);
comprobar(
  "se anota al llegar el mensaje",
  /setConversationMessengerPage\(convo\.id, getOutboundMessengerPage\(\)\);/.test(
    webhook
  )
);
comprobar(
  "y el obrero la usa al salir",
  /withOutboundMessengerPage\(convo\?\.messenger_page_id \?\? null, \(\) =>/.test(
    motor
  ),
  "engine.ts"
);
comprobar(
  "junto al número de WhatsApp, no en su lugar",
  /withOutboundWhatsAppNumber\(convo\?\.wa_phone_number_id \?\? null, \(\) =>[\s\S]{0,400}?withOutboundMessengerPage\(/.test(
    motor
  ),
  "los dos canales a la vez"
);

// ── 5. Y CADA PÁGINA VENDE LO SUYO ──────────────────────────────────────────
//
// LO PIDIÓ EL DUEÑO con su ejemplo: «Pagina 1 vende lecto escritura, responden
// whatsapp y messenger… Pagina 2 vende grafismo fonetico».
//
// ANTES NO PODÍA: la tienda se buscaba SOLO por el número de WhatsApp, y en Messenger
// no hay número. Así que un cliente de Messenger no encontraba ninguna tienda y las
// tres páginas contestaban —cada una por la suya— pero vendiendo TODAS lo general.
console.log("\n— 5. cada página vende lo suyo —\n");
{
  const cfg = await import(
    pathToFileURL(join(RAIZ, "src", "lib", "workflow", "config.ts")).href
  ).catch(() => null);
  if (!cfg) {
    comprobar("se pudo cargar el motor", false, "no se midió");
  } else {
    // Tiendas de juguete: una con número, una con página, una con las dos.
    const CFG = {
      tiendas: [
        { id: "t_wa", nombre: "SOLO WHATSAPP", numero: "111" },
        { id: "t_fb", nombre: "SOLO PAGINA", pagina: "pag_1" },
        { id: "t_dos", nombre: "LAS DOS", numero: "222", pagina: "pag_2" },
        { id: "t_off", nombre: "APAGADA", pagina: "pag_9", enabled: false },
      ],
    };
    const porPagina = (p) => cfg.tiendaDeLaPagina(p, CFG)?.nombre ?? "(ninguna)";
    comprobar("la página 1 encuentra su tienda", porPagina("pag_1") === "SOLO PAGINA");
    comprobar("y la 2 la suya", porPagina("pag_2") === "LAS DOS");
    comprobar(
      "una página que no es de nadie",
      porPagina("pag_desconocida") === "(ninguna)",
      "sigue como hoy"
    );
    comprobar(
      "una tienda APAGADA no atiende su página",
      porPagina("pag_9") === "(ninguna)",
      "el interruptor manda"
    );
    comprobar("sin página, ninguna", porPagina(null) === "(ninguna)");
    // LAS LLAVES NO SE MEZCLAN: un phone_number_id y un page_id son dos números
    // largos de Meta y nada impide que coincidan. Si se comparara contra las dos a
    // la vez, una página podría abrir la tienda de un número.
    comprobar(
      "el número NO abre una tienda por su página",
      cfg.tiendaDelNumero("pag_1", CFG) === null,
      "las llaves no se mezclan"
    );
    comprobar(
      "y la página NO abre una tienda por su número",
      cfg.tiendaDeLaPagina("111", CFG) === null
    );
  }
}
comprobar(
  "la puerta del turno mira las dos llaves",
  /tiendaDelNumero\(convo\?\.wa_phone_number_id\) \?\?\s*\r?\n?\s*tiendaDeLaPagina\(convo\?\.messenger_page_id\)/.test(
    readFileSync(join(RAIZ, "src", "lib", "workflow", "config.ts"), "utf8")
  ),
  "conElTurnoDe"
);
comprobar(
  "y Messenger abre el turno con su página",
  /conElTurnoDe\(\{ messenger_page_id: entry\.id \?\? null \}, \(\) =>/.test(webhook),
  "antes no abria ninguno"
);
comprobar(
  "la página sobrevive al guardado",
  /pagina: str\(t\?\.pagina\)\.trim\(\)/.test(
    readFileSync(join(RAIZ, "src", "app", "api", "workflow", "route.ts"), "utf8")
  )
);
comprobar(
  // LA INTENCION NO CAMBIA: que el campo de la pagina exista en el pop up Tiendas.
  // El 01/10/2026 dejo de ser una casilla de texto y paso a ser un SELECTOR de las
  // paginas conectadas —lo pidio el dueño: «no es mejor elegir un número de la lista»—
  // asi que se comprueba el selector, no el rotulo viejo.
  "y se puede elegir en la pantalla",
  // Desde el 09/10/2026 la lista va acotada a la cuenta del número
  // (PLAN-VARIAS-CUENTAS-DE-FACEBOOK.md). Sigue siendo un selector de lo conectado.
  /Página de Facebook\s*\r?\n?\s*<ElegirConexion[\s\S]{0,400}?opciones=\{paginasDeSuCuenta\.visibles\}/.test(
    readFileSync(join(RAIZ, "src", "app", "editor", "page.tsx"), "utf8")
  )
);

console.log(
  fallos === 0
    ? "\nTODO OK — cada página contesta por la suya y vende lo suyo; con una sola nada cambia\n"
    : `\n${fallos} FALLO(S)\n`
);
process.exit(fallos === 0 ? 0 : 1);
