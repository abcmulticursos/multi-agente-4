// EL RECORRIDO DEL TABLERO — vive la venta del tablero como un cliente, en el simulador.
//
// Lo pidió Alberto el 23/10/2026: «para eso está tu prueba, ¿cierto?». Es el gemelo de
// recorrido-completo.mjs para el segundo motor: arma tableros de prueba, habla como cliente y
// comprueba lo que llega. Al terminar DEVUELVE el contenido como estaba (copia y huella).
//
// SOLO CONTRA UNA COPIA O UN SERVIDOR DE PRUEBA: escribe en config/intro-data.yaml mientras corre.
//
//   node scripts/recorrido-del-tablero.mjs --url=http://localhost:3000 --tienda=<id>
//        [--comprobante=C:/ruta/yape.jpg --monto=15]   (las pruebas de pago necesitan una foto real)
//        [--solo=contribucion,eleccion,seguimientos,cobro,workflow,messenger]
//
// Los tiempos son de verdad (1 y 2 minutos): tarda unos 15 minutos entero.
import { createHash } from "node:crypto";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const BASE = (args.url ?? "http://localhost:3000").replace(/\/$/, "");
const RAIZ = args.raiz ?? process.cwd();
const ARCHIVO = join(RAIZ, "config", "intro-data.yaml");
const require = createRequire(join(RAIZ, "package.json"));
const YAML = require("yaml");
const solo = args.solo ? new Set(args.solo.split(",")) : null;
const toca = (n) => !solo || solo.has(n);

let malas = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, ok, valor = "") => {
  if (!ok) malas++;
  console.log(`  ${ok ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// ── EL CONTENIDO: copia, huella y tableros de prueba ──────────────────────────
const original = readFileSync(ARCHIVO, "utf8");
const huella = createHash("sha256").update(original).digest("hex");
const copia = `${ARCHIVO}.antes-del-recorrido-del-tablero`;
copyFileSync(ARCHIVO, copia);
const doc = YAML.parseDocument(original);
const datos = doc.toJS();
const tienda = (datos.tiendas ?? []).find((t) => t.id === args.tienda) ?? (datos.tiendas ?? [])[0];
if (!tienda) throw new Error("No hay tiendas: el tablero necesita una.");
const productos = datos.biblioteca_de_productos ?? [];
const precioPE = (p) => p?.precios_por_pais?.PE?.price_soles ?? p?.price_soles;
const conEntrega = productos.filter((p) => (p.delivery ?? []).length > 0);
const monto = Number(args.monto ?? 0);
const basico = conEntrega.find((p) => precioPE(p) === monto) ?? null;
const full = conEntrega.filter((p) => precioPE(p) > monto).sort((a, b) => precioPE(a) - precioPE(b))[0] ?? null;
const gratis = conEntrega[0];
const plus = conEntrega[1] ?? conEntrega[0];

const texto = (t, extra = {}) => ({ type: "text", body: t, body_variants: [t], delay_after_sec: 1, ...extra });
const boton = (id, label) => ({ id, label, action: "send_steps" });
const cuadrito = (id, title, keywords) => ({ id, title, keywords });

const TABLEROS = {
  contribucion: {
    encendido: true,
    fichas: [
      { id: "inicio", tipo: "inicio", pais: "PE", x: 0, y: 0 },
      {
        id: "oferta", tipo: "mensaje", titulo: "Oferta", x: 300, y: 0, sin_respuesta_min: 1,
        steps: [texto("Hola 😊 Tengo un material para ti."), texto("Si te gusta, me ayudas con una contribución. ¿Deseas recibir el material?", { buttons: [boton("si_quiero", "Sí, quiero"), boton("no_gracias", "No, gracias")] })],
      },
      { id: "insiste", tipo: "mensaje", titulo: "Insiste", x: 650, y: 300, steps: [texto("¿Sigues por ahí? 😊")] },
      { id: "entrega", tipo: "entregar", x: 650, y: 0, producto_id: gratis?.id },
      {
        id: "cobro", tipo: "cobro", titulo: "Contribución", x: 950, y: 0, sin_pago_min: 1,
        cobro: { modo: "abierto", minimo_por_pais: { PE: Math.max(1, Math.floor(monto / 3)) }, tramos_por_pais: { PE: [{ id: "t1", desde: Math.max(1, Math.floor(monto / 3)), hasta: monto - 1 }, { id: "t2", desde: monto }] } },
        steps: [texto("Si te gustó, tu contribución me ayuda muchísimo 🙏")],
      },
      { id: "rec1", tipo: "mensaje", titulo: "Recordatorio 1", x: 1300, y: 300, steps: [texto("RECORDATORIO-1: estoy a la espera de tu contribución.")] },
      { id: "espera", tipo: "esperar", x: 1600, y: 300, minutos: 1 },
      { id: "rec2", tipo: "mensaje", titulo: "Recordatorio 2", x: 1900, y: 300, steps: [texto("RECORDATORIO-2: ¿te gustó el material?")] },
      { id: "plus", tipo: "entregar", x: 1300, y: -300, producto_id: plus?.id },
      { id: "regalo", tipo: "regalo", x: 1600, y: -300 },
      { id: "tras", tipo: "mensaje", titulo: "Tras el regalo", x: 1900, y: -300, steps: [texto("TRAS-EL-REGALO: ¿te interesa otro material?")] },
      { id: "humano", tipo: "humano", x: 650, y: 600 },
    ],
    cables: [
      ["inicio", "siguiente", "oferta"], ["oferta", "btn:si_quiero", "entrega"], ["oferta", "btn:no_gracias", "humano"],
      ["oferta", "sin_respuesta", "insiste"], ["entrega", "siguiente", "cobro"], ["cobro", "sin_pago", "rec1"],
      ["rec1", "siguiente", "espera"], ["espera", "siguiente", "rec2"], ["cobro", "tramo:t2", "plus"],
      ["plus", "siguiente", "regalo"], ["regalo", "fin", "tras"],
    ].map(([de, salida, a], i) => ({ id: `c${i}`, de, salida, a })),
  },
  seguimientos: {
    encendido: true,
    fichas: [
      { id: "inicio", tipo: "inicio", pais: "PE", x: 0, y: 0 },
      { id: "intro", tipo: "mensaje", x: 300, y: 0, steps: [texto("INTRO: este es el material.")] },
      {
        id: "segs", tipo: "seguimientos", x: 650, y: 0,
        seguimientos: [
          { id: "s1", minutos: 1, variantes: [{ id: "a", peso: 1, steps: [texto("SEGUIMIENTO-1")] }] },
          { id: "s2", minutos: 2, activa_oferta: true, variantes: [{ id: "a", peso: 1, steps: [texto("SEGUIMIENTO-2", { decisions: [cuadrito("dec_precio", "Precio", ["precio"])] })] }] },
        ],
      },
      { id: "precio", tipo: "mensaje", x: 1000, y: -200, steps: [texto("RESPUESTA-PRECIO")] },
      { id: "humano", tipo: "humano", x: 1000, y: 200 },
    ],
    cables: [["inicio", "siguiente", "intro"], ["intro", "siguiente", "segs"], ["segs", "dec:dec_precio", "precio"], ["segs", "fin", "humano"]].map(([de, salida, a], i) => ({ id: `c${i}`, de, salida, a })),
  },
  cobro: {
    encendido: true,
    fichas: [
      { id: "inicio", tipo: "inicio", pais: "PE", x: 0, y: 0 },
      { id: "intro", tipo: "mensaje", x: 300, y: 0, steps: [texto("INTRO-OB: te presento el básico.", { buttons: [boton("pagar", "Quiero pagar")] })] },
      { id: "ob", tipo: "intro_ob", x: 650, y: 0, variantes: [{ id: "v", peso: 1, steps: [texto("INTRO-DE-ORDER-BUMP: ¿cuál prefieres?", { buttons: [boton("b_basico", "El básico"), boton("b_full", "El completo")] })] }] },
      { id: "cobro_basico", tipo: "cobro", x: 1000, y: -200, cobro: { modo: "producto", producto_id: basico?.id, acepta: [full?.id].filter(Boolean), precio: "normal" }, steps: [texto("DATOS-BASICO: paga {price}")] },
      { id: "cobro_full", tipo: "cobro", x: 1000, y: 200, cobro: { modo: "producto", producto_id: full?.id, acepta: [basico?.id].filter(Boolean), precio: "normal" }, steps: [texto("DATOS-FULL: paga {price}")] },
      { id: "entrega_basico", tipo: "entregar", x: 1350, y: -200, producto_id: basico?.id },
      { id: "entrega_full", tipo: "entregar", x: 1350, y: 200, producto_id: full?.id },
      { id: "fin_basico", tipo: "mensaje", x: 1700, y: -200, steps: [texto("ENTREGADO-BASICO")] },
      { id: "fin_full", tipo: "mensaje", x: 1700, y: 200, steps: [texto("ENTREGADO-FULL")] },
    ],
    cables: [
      ["inicio", "siguiente", "intro"], ["intro", "btn:pagar", "ob"], ["ob", "btn:b_basico", "cobro_basico"], ["ob", "btn:b_full", "cobro_full"],
      ["cobro_basico", "pagado", "entrega_basico"], ["cobro_basico", `prod:${full?.id}`, "entrega_full"],
      ["cobro_full", "pagado", "entrega_full"], ["cobro_full", `prod:${basico?.id}`, "entrega_basico"],
      ["entrega_basico", "siguiente", "fin_basico"], ["entrega_full", "siguiente", "fin_full"],
    ].map(([de, salida, a], i) => ({ id: `c${i}`, de, salida, a })),
  },
  workflow: {
    encendido: true,
    fichas: [
      { id: "inicio", tipo: "inicio", pais: "PE", x: 0, y: 0 },
      { id: "reparto", tipo: "reparto", x: 300, y: 0, reparto: [{ id: "r1", peso: 1 }, { id: "r2", peso: 0 }] },
      { id: "cond", tipo: "condicion", x: 650, y: 0, condicion: { tipo: "pais", paises: ["PE"] } },
      { id: "ir", tipo: "workflow", x: 1000, y: 0, workflow_id: "wf_prueba" },
      { id: "nunca", tipo: "mensaje", x: 1000, y: 300, steps: [texto("NUNCA-DEBE-SALIR")] },
    ],
    cables: [["inicio", "siguiente", "reparto"], ["reparto", "rep:r1", "cond"], ["reparto", "rep:r2", "nunca"], ["cond", "si", "ir"], ["cond", "no", "nunca"]].map(
      ([de, salida, a], i) => ({ id: `c${i}`, de, salida, a })
    ),
  },
};
const WORKFLOWS = {
  wf_prueba: {
    encendido: true,
    nombre: "Workflow de prueba",
    fichas: [
      { id: "inicio", tipo: "inicio", x: 0, y: 0 },
      { id: "hola", tipo: "mensaje", x: 300, y: 0, steps: [texto("DENTRO-DEL-WORKFLOW", { decisions: [cuadrito("dec_si", "Sí", ["si", "claro"])] })] },
      { id: "fin", tipo: "mensaje", x: 650, y: 0, steps: [texto("WORKFLOW-SI")] },
    ],
    cables: [{ id: "w1", de: "inicio", salida: "siguiente", a: "hola" }, { id: "w2", de: "hola", salida: "dec:dec_si", a: "fin" }],
  },
};

function sembrar(nombre, canal = "whatsapp") {
  const actual = YAML.parseDocument(readFileSync(ARCHIVO, "utf8"));
  actual.set("tableros", { [tienda.id]: { [canal]: TABLEROS[nombre] } });
  actual.set("workflows", WORKFLOWS);
  writeFileSync(ARCHIVO, actual.toString({ lineWidth: 0 }));
}

// ── EL CLIENTE ────────────────────────────────────────────────────────────────
let cookie = "";
async function api(ruta, opciones = {}) {
  const r = await fetch(BASE + ruta, { ...opciones, headers: { ...(opciones.headers ?? {}), cookie } });
  const set = r.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  return r;
}
async function entrar() {
  const env = readFileSync(join(RAIZ, ".env"), "utf8");
  const pass = (env.match(/^DASHBOARD_PASSWORD=(.*)$/m)?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
  await api("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: pass }) });
}
async function cliente(canal = "whatsapp") {
  const conv = await (
    await api("/api/test-simulator", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel: canal, tienda: tienda.id, ...(canal === "messenger" ? {} : { country: "PE" }) }),
    })
  ).json();
  let vistos = 0;
  const bot = [];
  const leer = async (seg) => {
    const fin = Date.now() + seg * 1000;
    while (Date.now() < fin) {
      const d = await (await api(`/api/test-simulator/${conv.id}`)).json();
      for (const m of d.messages.slice(vistos)) if (m.role !== "user") bot.push(m.content ?? "");
      vistos = d.messages.length;
      await esperar(1000);
    }
  };
  const enviar = async (f, seg) => {
    await api(`/api/test-simulator/${conv.id}/message`, { method: "POST", body: f });
    await leer(seg);
  };
  return {
    bot,
    dijo: (t) => bot.some((x) => x.includes(t)),
    leer,
    decir: (t, seg = 20) => {
      const f = new FormData();
      f.set("content", t);
      return enviar(f, seg);
    },
    tocar: (id, titulo, seg = 25) => {
      const f = new FormData();
      f.set("button_id", `bubble:${id}`);
      f.set("button_title", titulo);
      return enviar(f, seg);
    },
    foto: (seg = 45) => {
      const f = new FormData();
      f.set("file", new Blob([readFileSync(args.comprobante)], { type: "image/jpeg" }), "comprobante.jpg");
      return enviar(f, seg);
    },
    borrar: () => api(`/api/test-simulator/${conv.id}`, { method: "DELETE" }),
  };
}

// ── LOS RECORRIDOS ────────────────────────────────────────────────────────────
try {
  await entrar();
  console.log(`RECORRIDO DEL TABLERO · tienda «${tienda.nombre ?? tienda.id}»`);

  if (toca("contribucion") && args.comprobante && gratis) {
    console.log("\n· La venta por contribución, con recordatorios, tramo, regalo y lo de después");
    sembrar("contribucion");
    await esperar(3000);
    const c = await cliente();
    await c.decir("hola", 20);
    comprobar("entra al tablero y sale la oferta con botones", c.dijo("Tengo un material para ti"));
    await c.tocar("si_quiero", "Sí, quiero", 30);
    comprobar("el material sale antes de pagar", c.bot.length >= 4);
    comprobar("y pide la contribución", c.dijo("tu contribución me ayuda"));
    await c.leer(75);
    comprobar("sin pago en 1 min: recordatorio 1", c.dijo("RECORDATORIO-1"));
    await c.leer(70);
    comprobar("y tras esperar 1 min: recordatorio 2", c.dijo("RECORDATORIO-2"));
    const antesDelPago = c.bot.length;
    await c.foto(60);
    // El plus (su entrega) y la pregunta del regalo: varias burbujas nuevas, y la del regalo
    // («regalo», «regalito»…) entre ellas.
    comprobar(
      "el comprobante del tramo 2 manda el plus y el regalo",
      c.bot.length - antesDelPago >= 2 && c.bot.slice(antesDelPago).some((x) => /regal/i.test(x))
    );
    await c.decir("no gracias", 30);
    comprobar("al terminar el regalo, la ruta sigue", c.dijo("TRAS-EL-REGALO"));
    await c.borrar();
  }

  if (toca("eleccion")) {
    console.log("\n· La elección escrita: la IA entiende «dale», y «no quiero» no es elegir");
    sembrar("contribucion");
    await esperar(3000);
    const a = await cliente();
    await a.decir("hola", 20);
    await a.decir("dale mándamelo porfa", 35);
    comprobar("«dale mándamelo» = Sí, quiero → material", a.dijo("tu contribución me ayuda"));
    await a.borrar();
    const b = await cliente();
    await b.decir("hola", 20);
    await b.decir("si quiero", 30);
    comprobar("el texto del botón escrito vale como tocarlo", b.dijo("tu contribución me ayuda"));
    await b.borrar();
    const n = await cliente();
    await n.decir("hola", 20);
    const antes = n.bot.length;
    await n.decir("y de que trata? cuanto es?", 35);
    comprobar("una pregunta no elige: contesta la IA", n.bot.length > antes && !n.dijo("tu contribución me ayuda"));
    await n.borrar();
  }

  if (toca("seguimientos")) {
    console.log("\n· La caja de seguimientos: a su tiempo, el cuadrito, y «terminaron sin respuesta»");
    sembrar("seguimientos");
    await esperar(3000);
    const c = await cliente();
    await c.decir("hola", 15);
    comprobar("sale la intro", c.dijo("INTRO: este es el material"));
    await c.leer(75);
    comprobar("seguimiento 1 al minuto de su último mensaje", c.dijo("SEGUIMIENTO-1"));
    await c.leer(65);
    comprobar("seguimiento 2 a los 2 minutos", c.dijo("SEGUIMIENTO-2"));
    await c.decir("cual es el precio", 25);
    comprobar("el cuadrito del seguimiento lleva a su ficha", c.dijo("RESPUESTA-PRECIO"));
    await c.borrar();
  }

  if (toca("cobro") && args.comprobante && basico && full) {
    console.log(`\n· Eligió uno y pagó otro (básico ${precioPE(basico)}, completo ${precioPE(full)}, paga ${monto})`);
    sembrar("cobro");
    await esperar(3000);
    const c = await cliente();
    await c.decir("hola", 15);
    await c.tocar("pagar", "Quiero pagar", 20);
    comprobar("«quiero pagar» destapa la intro de order bump", c.dijo("INTRO-DE-ORDER-BUMP"));
    await c.tocar("b_full", "El completo", 20);
    comprobar("eligió el completo: sus datos con su precio", c.dijo(`DATOS-FULL: paga`));
    await c.foto(50);
    comprobar("pagó el precio del básico: le pregunta si fue un error", !c.dijo("ENTREGADO-FULL") && !c.dijo("ENTREGADO-BASICO"));
    await c.decir("no, me quedo con ese entonces", 40);
    comprobar("se queda con el básico: le entrega el básico", c.dijo("ENTREGADO-BASICO"));
    await c.borrar();
  }

  if (toca("workflow")) {
    console.log("\n· Reparto por peso, condición por país y salto a un workflow");
    sembrar("workflow");
    await esperar(3000);
    const c = await cliente();
    await c.decir("hola", 20);
    comprobar("reparto (peso 1 contra 0) y país PE llevan al workflow", c.dijo("DENTRO-DEL-WORKFLOW") && !c.dijo("NUNCA-DEBE-SALIR"));
    await c.decir("si claro", 20);
    comprobar("y dentro del workflow sus cuadritos funcionan", c.dijo("WORKFLOW-SI"));
    await c.borrar();
  }

  if (toca("messenger")) {
    console.log("\n· Messenger: primero el país, luego SU tablero (no el de WhatsApp)");
    sembrar("workflow", "messenger");
    await esperar(3000);
    const c = await cliente("messenger");
    await c.decir("hola", 15);
    comprobar("pregunta el país primero", c.bot.length > 0 && !c.dijo("DENTRO-DEL-WORKFLOW"));
    await c.decir("Peru", 20);
    comprobar("y entra a su tablero de Messenger", c.dijo("DENTRO-DEL-WORKFLOW"));
    await c.borrar();
  }
} finally {
  // DEVOLVER EL CONTENIDO TAL CUAL, y comprobarlo con su huella.
  writeFileSync(ARCHIVO, original);
  const despues = createHash("sha256").update(readFileSync(ARCHIVO, "utf8")).digest("hex");
  console.log(`\ncontenido devuelto: ${despues === huella ? "idéntico ✔" : "¡DISTINTO! la copia está en " + copia}`);
}
console.log(malas === 0 ? "\nTODO BIEN" : `\n${malas} comprobación(es) mal.`);
process.exit(malas === 0 ? 0 : 1);
