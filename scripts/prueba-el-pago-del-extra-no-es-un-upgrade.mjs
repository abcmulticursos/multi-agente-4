// Lo dicho ANTES de comprar no puede ser un upgrade.
//
// LO QUE PASO — 15 de septiembre de 2026, conversacion 108 del dueno. Eligio la
// opcion cara, se arrepintio, compro la barata, acepto el producto extra y pago
// su precio. Ese comprobante NO se conto como la segunda venta: se conto como un
// UPGRADE a la opcion cara. Le entregaron la opcion cara y la venta del extra no
// llego a existir.
//
//     «<nombre de la opcion cara>»    <- eligiendo, ANTES de comprar
//     «no tengo plata mejor el otro»  <- BAJANDO de precio
//     ...compra la barata, acepta el extra, paga el extra
//     [wf:pago] pidio subir al combo → este comprobante es del UPGRADE
//     [wf:pago] entrega la opcion cara — APROBADO por la suma de los dos pagos
//
// POR QUE. Para reconocer a quien pide subir despues de comprar, se miraban los
// ultimos 6 mensajes del cliente buscando intencion de subir. Pero esa ventana
// seguia alcanzando lo que dijo MIENTRAS ELEGIA, y ahi los dos mensajes de
// arriba disparan el detector:
//
//   · el nombre de la opcion cara es una de las palabras que busca
//   · «el otro» esta en su lista fija
//
// Uno era una eleccion y el otro era justo LO CONTRARIO de un upgrade.
//
// EL ARREGLO NO TOCA EL DETECTOR —esa lista vale para lo suyo—: acota la ventana
// a la parte de la conversacion donde un upgrade PUEDE existir, que es despues
// de la entrega. Antes de comprar no hay nada de lo que subir.
//
//   node scripts/prueba-el-pago-del-extra-no-es-un-upgrade.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8").replace(/\r\n/g, "\n");
const pago = leer("src", "lib", "workflow", "payment.ts");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// ── 1. LA VENTANA SE ACOTA, Y EN LA RAMA QUE TOCA ───────────────────────────
console.log("\n— la ventana ya no alcanza lo de antes de comprar —\n");
comprobar(
  "se filtran los mensajes por la fecha de la compra",
  /message\.created_at > convo\.paid_at/.test(pago),
  "solo lo dicho despues"
);
comprobar(
  "y exige que la compra exista",
  /convo\.paid_at != null && message\.created_at > convo\.paid_at/.test(pago),
  "sin compra no hay upgrade"
);
// El filtro tiene que estar en la rama de los mensajes, no en otro sitio.
const rama = (() => {
  const i = pago.indexOf('(obChoice === "basico" &&');
  if (i < 0) return "";
  const f = pago.indexOf("const esPagoDeUpsell", i);
  return f < 0 ? pago.slice(i) : pago.slice(i, f);
})();
comprobar(
  "vive dentro de la rama que mira los mensajes",
  /getRecentUserMessages\(conversationId, 6\)/.test(rama) &&
    /message\.created_at > convo\.paid_at/.test(rama),
  "no en otra"
);
comprobar(
  "y sigue llamando al detector de siempre",
  /detectaIntencionDeSubirAlCombo\(message\.content, config\)/.test(rama),
  "no se toco esa lista"
);

// ── 2. LAS OTRAS DOS PUERTAS SIGUEN INTACTAS ────────────────────────────────
//
// Esta rama es una ALTERNATIVA: solo puede reconocer MAS casos de upgrade, nunca
// menos. Si se rompieran las otras dos, el que SI pide subir dejaria de ser
// atendido — que es peor que el fallo que se arregla.
console.log("\n— y las otras dos formas de reconocer un upgrade —\n");
comprobar(
  "la cotizacion del upgrade sigue valiendo",
  /cotizadoElUpgrade \|\|/.test(pago),
  "el caso normal"
);
comprobar(
  "y la eleccion puesta en la cara con la entrega hecha",
  /const yaComproYQuiereElCombo = convo\.paid_at != null && obChoice === "combo";/.test(
    pago
  ),
  "no hay otra lectura posible"
);
comprobar(
  "el pago del extra sigue reconociendose",
  /const esPagoDeUpsell =\s*\n?\s*!pidioSubirAlCombo &&/.test(pago),
  "cuando no es un upgrade"
);

// ── 3. EL FILTRO, EJECUTADO ─────────────────────────────────────────────────
//
// Se saca la condicion TAL CUAL del fuente y se ejecuta. Una copia escrita de
// memoria probaria lo que uno cree que hace.
console.log("\n— y funcionando, con la conversacion de ese fallo —\n");
const m = pago.match(
  /convo\.paid_at != null && message\.created_at > convo\.paid_at/
);
comprobar("se encuentra la condicion en el fuente", !!m);
const pasa = new Function("convo", "message", `return ${m[0]};`);

// Fixture neutro: la compra ocurrio en el segundo 1000.
const convo = { paid_at: 1000 };
const mensajes = [
  { t: "eligiendo la opcion cara", created_at: 900, esperado: false },
  { t: "bajando de precio", created_at: 950, esperado: false },
  { t: "el momento de la compra", created_at: 1000, esperado: false },
  { t: "acepta el extra", created_at: 1100, esperado: true },
  { t: "pide subir de verdad", created_at: 1200, esperado: true },
];
for (const x of mensajes) {
  const r = pasa(convo, { created_at: x.created_at });
  comprobar(
    `${x.esperado ? "entra" : "se aparta"}: ${x.t}`,
    r === x.esperado,
    `t=${x.created_at}`
  );
}
comprobar(
  "sin compra, no entra nada",
  pasa({ paid_at: null }, { created_at: 9999 }) === false,
  "no hay de que subir"
);

console.log(
  fallos === 0
    ? "\nTODO OK — el pago del extra ya no se cuenta como upgrade\n"
    : `\n${fallos} comprobacion(es) mal.\n`
);
process.exit(fallos === 0 ? 0 : 1);
