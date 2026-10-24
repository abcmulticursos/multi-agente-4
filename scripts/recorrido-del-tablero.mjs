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
//        [--solo=contribucion,eleccion,seguimientos,cobro,metodo,ia,upgrade,correo,dou,ob,workflow,activar,messenger]
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

// LOS MÉTODOS DE PERÚ, los suyos (sus botones y sus cuentas): la prueba no inventa ninguno.
const perfilPE = datos.payment_profiles_by_country?.PE ?? {};
const metodosPE = (perfilPE.payment_buttons ?? []).filter((b) => b?.method && b?.label && b.enabled !== false);
const cifras = (v) => String(v ?? "").replace(/\D/g, "");
const cuentaDe = (m) => cifras(perfilPE.cuentas_por_metodo?.[m] ?? perfilPE.numero_de_cuenta);
const conDatos = metodosPE.filter((m) => (perfilPE.payment_responses?.[m.method] ?? []).length > 0);
// Dos métodos con cuentas DISTINTAS, para ver que al cambiar llegan los datos del nuevo.
const metodoA = conDatos[0];
const metodoB = conDatos.find((m) => cuentaDe(m.method) && cuentaDe(m.method) !== cuentaDe(metodoA?.method));

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
  // EL COBRO QUE PREGUNTA EL MÉTODO (y la IA que solo sabe lo presentado).
  metodo: {
    encendido: true,
    fichas: [
      { id: "inicio", tipo: "inicio", pais: "PE", x: 0, y: 0 },
      { id: "intro", tipo: "mensaje", x: 300, y: 0, presenta: [basico?.id].filter(Boolean), steps: [texto("INTRO-METODO: te presento el básico.", { buttons: [boton("pagar", "Quiero pagar")] })] },
      { id: "ob", tipo: "intro_ob", x: 650, y: 0, presenta: [basico?.id, full?.id].filter(Boolean), variantes: [{ id: "v", peso: 1, steps: [texto("INTRO-OB-METODO: ¿cuál prefieres?", { buttons: [boton("b_basico", "El básico"), boton("b_full", "El completo")] })] }] },
      {
        id: "cobro_basico", tipo: "cobro", x: 1000, y: 0,
        cobro: { modo: "producto", producto_id: basico?.id, acepta: [full?.id].filter(Boolean), precio: "normal", metodos: true },
        steps: [texto("PREGUNTA-METODO: ¿con qué método pagas?")],
      },
      { id: "entrega_basico", tipo: "entregar", x: 1350, y: -200, producto_id: basico?.id },
      { id: "entrega_full", tipo: "entregar", x: 1350, y: 200, producto_id: full?.id },
    ],
    cables: [
      ["inicio", "siguiente", "intro"], ["intro", "btn:pagar", "ob"], ["ob", "btn:b_basico", "cobro_basico"], ["ob", "btn:b_full", "cobro_basico"],
      ["cobro_basico", "pagado", "entrega_basico"], ["cobro_basico", `prod:${full?.id}`, "entrega_full"],
    ].map(([de, salida, a], i) => ({ id: `c${i}`, de, salida, a })),
  },
  // UNA VENTA COMO DOU ENTERA: los dos productos desde la intro, cobro con método, upgrade y regalo.
  dou: {
    encendido: true,
    fichas: [
      { id: "inicio", tipo: "inicio", pais: "PE", x: 0, y: 0 },
      {
        id: "intro", tipo: "mensaje", x: 300, y: 0, presenta: [basico?.id, full?.id].filter(Boolean),
        steps: [texto(`INTRO-DOU: tenemos ${basico?.name} y ${full?.name}. ¿Cuál prefieres?`, { buttons: [boton("b_basico", "El básico"), boton("b_full", "El completo")] })],
      },
      { id: "cobro_basico", tipo: "cobro", x: 650, y: -200, cobro: { modo: "producto", producto_id: basico?.id, acepta: [full?.id].filter(Boolean), precio: "normal", metodos: true }, steps: [texto("PREGUNTA-METODO: ¿con qué método pagas?")] },
      { id: "cobro_full", tipo: "cobro", x: 650, y: 200, cobro: { modo: "producto", producto_id: full?.id, acepta: [basico?.id].filter(Boolean), precio: "normal", metodos: true }, steps: [texto("PREGUNTA-METODO: ¿con qué método pagas?")] },
      { id: "entrega_basico", tipo: "entregar", x: 1000, y: -200, producto_id: basico?.id },
      { id: "entrega_full", tipo: "entregar", x: 1000, y: 200, producto_id: full?.id },
      { id: "ofrece", tipo: "mensaje", x: 1350, y: -200, steps: [texto("OFRECE-UPGRADE: ¿completas para el otro?", { buttons: [boton("si_full", "Sí, completo")] })] },
      { id: "cobro_upgrade", tipo: "cobro", x: 1700, y: -200, cobro: { modo: "producto", producto_id: full?.id, acepta: [basico?.id].filter(Boolean), precio: "normal", metodos: true, diferencia: true }, steps: [texto("PREGUNTA-METODO: ¿con qué método pagas?")] },
      { id: "regalo", tipo: "regalo", x: 1350, y: 200 },
    ],
    cables: [
      ["inicio", "siguiente", "intro"], ["intro", "btn:b_basico", "cobro_basico"], ["intro", "btn:b_full", "cobro_full"],
      ["cobro_basico", "pagado", "entrega_basico"], ["cobro_basico", `prod:${full?.id}`, "entrega_full"],
      ["cobro_full", "pagado", "entrega_full"], ["cobro_full", `prod:${basico?.id}`, "entrega_basico"],
      ["entrega_basico", "siguiente", "ofrece"], ["ofrece", "btn:si_full", "cobro_upgrade"], ["cobro_upgrade", "pagado", "entrega_full"], ["entrega_full", "siguiente", "regalo"],
    ].map(([de, salida, a], i) => ({ id: `c${i}`, de, salida, a })),
  },
  // UNA VENTA COMO OB ENTERA: el básico primero, el completo oculto hasta «quiero pagar», muestras,
  // cobro con método, entrega y regalo.
  ob: {
    encendido: true,
    fichas: [
      { id: "inicio", tipo: "inicio", pais: "PE", x: 0, y: 0 },
      { id: "intro", tipo: "mensaje", x: 300, y: 0, presenta: [basico?.id].filter(Boolean), steps: [texto(`INTRO-OB: te presento ${basico?.name}.`, { buttons: [boton("pagar", "Quiero pagar")] })] },
      {
        id: "ob", tipo: "intro_ob", x: 650, y: 0, presenta: [basico?.id, full?.id].filter(Boolean),
        variantes: [{ id: "v", peso: 1, steps: [texto(`INTRO-DE-OB: también está ${full?.name}. ¿Cuál prefieres?`, { buttons: [boton("b1", "El básico"), boton("b2", "El completo")] })] }],
      },
      { id: "cobro_basico", tipo: "cobro", x: 1000, y: -200, cobro: { modo: "producto", producto_id: basico?.id, acepta: [full?.id].filter(Boolean), precio: "normal", metodos: true }, steps: [texto("PREGUNTA-METODO: ¿con qué método pagas?")] },
      { id: "cobro_full", tipo: "cobro", x: 1000, y: 200, cobro: { modo: "producto", producto_id: full?.id, acepta: [basico?.id].filter(Boolean), precio: "normal", metodos: true }, steps: [texto("PREGUNTA-METODO: ¿con qué método pagas?")] },
      { id: "entrega_basico", tipo: "entregar", x: 1350, y: -200, producto_id: basico?.id },
      { id: "entrega_full", tipo: "entregar", x: 1350, y: 200, producto_id: full?.id },
      { id: "regalo", tipo: "regalo", x: 1700, y: 0 },
    ],
    cables: [
      ["inicio", "siguiente", "intro"], ["intro", "btn:pagar", "ob"], ["ob", "btn:b1", "cobro_basico"], ["ob", "btn:b2", "cobro_full"],
      ["cobro_basico", "pagado", "entrega_basico"], ["cobro_basico", `prod:${full?.id}`, "entrega_full"],
      ["cobro_full", "pagado", "entrega_full"], ["cobro_full", `prod:${basico?.id}`, "entrega_basico"],
      ["entrega_basico", "siguiente", "regalo"], ["entrega_full", "siguiente", "regalo"],
    ].map(([de, salida, a], i) => ({ id: `c${i}`, de, salida, a })),
  },
  // EL UPGRADE: compra el básico y después el completo por la diferencia.
  upgrade: {
    encendido: true,
    fichas: [
      { id: "inicio", tipo: "inicio", pais: "PE", x: 0, y: 0 },
      { id: "cobro_basico", tipo: "cobro", x: 300, y: 0, cobro: { modo: "producto", producto_id: basico?.id, precio: "normal" }, steps: [texto("DATOS-BASICO: paga {price}")] },
      { id: "entrega_basico", tipo: "entregar", x: 650, y: 0, producto_id: basico?.id },
      { id: "ofrece", tipo: "mensaje", x: 1000, y: 0, steps: [texto("OFRECE-UPGRADE: ¿quieres el completo?", { buttons: [boton("si_full", "Sí, el completo")] })] },
      { id: "cobro_full", tipo: "cobro", x: 1350, y: 0, cobro: { modo: "producto", producto_id: full?.id, acepta: [basico?.id].filter(Boolean), precio: "normal", diferencia: true }, steps: [texto("DATOS-UPGRADE: paga {price}")] },
    ],
    cables: [["inicio", "siguiente", "cobro_basico"], ["cobro_basico", "pagado", "entrega_basico"], ["entrega_basico", "siguiente", "ofrece"], ["ofrece", "btn:si_full", "cobro_full"]].map(
      ([de, salida, a], i) => ({ id: `c${i}`, de, salida, a })
    ),
  },
  // LA FICHA «PEDIR CORREO».
  correo: {
    encendido: true,
    fichas: [
      { id: "inicio", tipo: "inicio", pais: "PE", x: 0, y: 0 },
      { id: "entrega", tipo: "entregar", x: 300, y: 0, producto_id: gratis?.id },
      { id: "correo", tipo: "correo", x: 650, y: 0, correo_texto: "Hola\n\n{{MATERIAL}}", steps: [texto("PIDE-CORREO: ¿a qué correo te lo mando?")] },
      { id: "ok", tipo: "mensaje", x: 1000, y: 0, steps: [texto("CORREO-OK")] },
    ],
    cables: [["inicio", "siguiente", "entrega"], ["entrega", "siguiente", "correo"], ["correo", "enviado", "ok"]].map(([de, salida, a], i) => ({ id: `c${i}`, de, salida, a })),
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
  // nombre null = SIN tablero: la tienda vende con la venta de siempre.
  actual.set("tableros", nombre ? { [tienda.id]: { [canal]: TABLEROS[nombre] } } : {});
  actual.set("workflows", WORKFLOWS);
  // Un botón «▶ Activar un workflow» como los del editor (el motor de siempre busca el botón por su
  // código en toda la configuración).
  actual.set("prueba_boton_workflow", [
    texto("BOTON-DE-PRUEBA", { buttons: [{ ...boton("act_wf", "Ver el workflow"), action: "start_workflow", workflow_id: "wf_prueba" }] }),
  ]);
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
      // Una foto o un video del bot quedan marcados, para ver que las muestras salen de verdad.
      for (const m of d.messages.slice(vistos)) if (m.role !== "user") bot.push(`${m.media_type ? `[MEDIA:${m.media_type}] ` : ""}${m.content ?? ""}`);
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

  if (toca("metodo") && basico && full && metodoA && metodoB) {
    console.log(`\n· El cobro pregunta el método: ${metodoA.label} → ${metodoB.label} → «mejor el completo» (básico ${precioPE(basico)}, completo ${precioPE(full)})`);
    sembrar("metodo");
    await esperar(3000);
    const c = await cliente();
    const nuevos = (desde) => c.bot.slice(desde).join("\n");
    await c.decir("hola", 15);
    await c.tocar("pagar", "Quiero pagar", 20);
    await c.tocar("b_basico", "El básico", 20);
    comprobar("sin método elegido: le pregunta el método", c.dijo("PREGUNTA-METODO"));
    let antes = c.bot.length;
    await c.decir(metodoA.label.toLowerCase(), 25);
    comprobar(`dice «${metodoA.label}»: le llegan SUS datos`, cifras(nuevos(antes)).includes(cuentaDe(metodoA.method)), cuentaDe(metodoA.method).slice(0, 3) + "…");
    comprobar("con el precio del básico", cifras(nuevos(antes)).includes(String(precioPE(basico))));
    antes = c.bot.length;
    await c.decir(`mejor por ${metodoB.label.toLowerCase()}`, 25);
    comprobar(`cambia a «${metodoB.label}»: le llegan los del nuevo`, cifras(nuevos(antes)).includes(cuentaDe(metodoB.method)));
    comprobar("sin repreguntar el producto", !nuevos(antes).includes("PREGUNTA-METODO"));
    antes = c.bot.length;
    await c.decir(`mejor quiero el ${full.name}`, 35);
    comprobar("«mejor el completo»: datos con el precio del completo", cifras(nuevos(antes)).includes(String(precioPE(full))), String(precioPE(full)));
    comprobar("y con el método que ya eligió, sin preguntarlo", cifras(nuevos(antes)).includes(cuentaDe(metodoB.method)) && !nuevos(antes).includes("PREGUNTA-METODO"));
    await c.borrar();
  }

  if (toca("dou") && args.comprobante && basico && full && metodoA) {
    const dif = Math.round((precioPE(full) - precioPE(basico)) * 100) / 100;
    console.log(`\n· UNA VENTA COMO DOU ENTERA (básico ${precioPE(basico)}, completo ${precioPE(full)}, paga ${monto})`);
    sembrar("dou");
    await esperar(3000);
    const c = await cliente();
    const nuevos = (desde) => c.bot.slice(desde).join("\n");
    await c.decir("hola", 15);
    comprobar("la intro presenta los dos", c.dijo("INTRO-DOU"));
    let antes = c.bot.length;
    await c.decir("que diferencia hay entre los dos?", 40);
    const r = nuevos(antes).toLowerCase();
    comprobar("una duda: la IA contesta sobre los dos (sin elegir)", r.length > 40 && !r.includes("pregunta-metodo"));
    await c.decir("ya, quiero el basico", 30);
    comprobar("eligió escribiendo: le pregunta el método", c.dijo("PREGUNTA-METODO"));
    antes = c.bot.length;
    await c.decir(metodoA.label.toLowerCase(), 25);
    comprobar(`«${metodoA.label}»: sus datos con el precio del básico`, cifras(nuevos(antes)).includes(cuentaDe(metodoA.method)) && cifras(nuevos(antes)).includes(String(precioPE(basico))));
    antes = c.bot.length;
    await c.decir("mmm mejor el otro", 35);
    comprobar("«mejor el otro»: datos del completo, mismo método, sin repreguntar", cifras(nuevos(antes)).includes(String(precioPE(full))) && !nuevos(antes).includes("PREGUNTA-METODO"));
    antes = c.bot.length;
    await c.decir("no, mejor me quedo con el basico nomas", 35);
    comprobar("y vuelve al básico: datos con su precio", cifras(nuevos(antes)).includes(String(precioPE(basico))));
    await c.foto(60);
    comprobar("paga el básico: le entrega y le ofrece completar", c.dijo("OFRECE-UPGRADE"));
    antes = c.bot.length;
    await c.tocar("si_full", "Sí, completo", 25);
    comprobar(`upgrade: datos por la diferencia (${dif}) sin repreguntar el método`, cifras(nuevos(antes)).includes(cifras(dif)) && !nuevos(antes).includes("PREGUNTA-METODO"), nuevos(antes).slice(0, 50).replace(/\n/g, " "));
    await c.borrar();
  }

  if (toca("ob") && args.comprobante && basico && full && metodoA) {
    console.log(`\n· UNA VENTA COMO OB ENTERA: el completo («${full.name}») oculto hasta «quiero pagar»`);
    sembrar("ob");
    await esperar(3000);
    const c = await cliente();
    const nuevos = (desde) => c.bot.slice(desde).join("\n");
    const oculto = String(full.name).toLowerCase();
    await c.decir("hola", 15);
    comprobar("la intro presenta solo el básico", c.dijo("INTRO-OB") && !c.bot.join(" ").toLowerCase().includes(oculto));
    let antes = c.bot.length;
    await c.decir("cuanto cuesta? hay otras opciones?", 40);
    comprobar("el precio del básico, y el completo NI se nombra ni se cotiza", cifras(nuevos(antes)).includes(String(precioPE(basico))) && !nuevos(antes).toLowerCase().includes(oculto) && !cifras(nuevos(antes)).includes(String(precioPE(full))));
    await c.tocar("pagar", "Quiero pagar", 20);
    comprobar("«quiero pagar» destapa la intro de order bump", c.dijo("INTRO-DE-OB"));
    antes = c.bot.length;
    await c.decir(`me muestras una foto del ${full.name}?`, 60);
    comprobar("pide ver el completo: le manda su muestra (foto)", nuevos(antes).includes("[MEDIA:"), nuevos(antes).slice(0, 40).replace(/\n/g, " "));
    antes = c.bot.length;
    await c.decir(`y otra foto del ${full.name} porfa`, 50);
    comprobar("la misma muestra no se repite", (nuevos(antes).match(/\[MEDIA:/g) ?? []).length <= 1);
    await c.tocar("b1", "El básico", 20);
    comprobar("elige el básico: le pregunta el método", c.dijo("PREGUNTA-METODO"));
    antes = c.bot.length;
    await c.decir(metodoA.label.toLowerCase(), 25);
    comprobar("sus datos con el precio del básico", cifras(nuevos(antes)).includes(cuentaDe(metodoA.method)) && cifras(nuevos(antes)).includes(String(precioPE(basico))));
    antes = c.bot.length;
    await c.foto(70);
    comprobar("paga: le entrega y empieza el regalo", c.bot.length - antes >= 2 && nuevos(antes).match(/regal/i) !== null);
    await c.borrar();
  }

  if (toca("ia") && basico && full) {
    console.log(`\n· La IA solo sabe lo presentado: el completo («${full.name}») sigue oculto hasta su intro`);
    sembrar("metodo");
    await esperar(3000);
    const c = await cliente();
    await c.decir("hola", 15);
    let antes = c.bot.length;
    await c.decir("y que contiene? que incluye exactamente?", 40);
    const r1 = c.bot.slice(antes).join("\n");
    comprobar("contesta qué contiene", r1.length > 40, r1.slice(0, 60).replace(/\n/g, " "));
    comprobar("y no nombra el producto oculto", !r1.toLowerCase().includes(String(full.name).toLowerCase()));
    await c.tocar("pagar", "Quiero pagar", 20);
    antes = c.bot.length;
    await c.decir(`y el ${full.name} cuanto cuesta?`, 40);
    const r2 = c.bot.slice(antes).join("\n");
    comprobar("ya presentado el completo: sabe su precio", cifras(r2).includes(String(precioPE(full))), r2.slice(0, 60).replace(/\n/g, " "));
    await c.borrar();
  }

  if (toca("upgrade") && args.comprobante && basico && full) {
    const dif = Math.round((precioPE(full) - precioPE(basico)) * 100) / 100;
    console.log(`\n· El upgrade: paga el básico (${precioPE(basico)}) y luego el completo por la diferencia (${dif})`);
    sembrar("upgrade");
    await esperar(3000);
    const c = await cliente();
    await c.decir("hola", 15);
    comprobar("le cobra el básico", c.dijo("DATOS-BASICO"));
    await c.foto(60);
    comprobar("pagó: le entrega y le ofrece el completo", c.dijo("OFRECE-UPGRADE"));
    await c.tocar("si_full", "Sí, el completo", 20);
    const datos = c.bot.find((x) => x.includes("DATOS-UPGRADE")) ?? "";
    comprobar("el completo cuesta solo la diferencia", cifras(datos).includes(cifras(dif)) && !cifras(datos).includes(String(precioPE(full))), datos.slice(0, 50));
    await c.borrar();
  }

  if (toca("correo") && gratis) {
    console.log("\n· La ficha «Pedir correo»: escribe su correo y se le manda lo que recibió");
    sembrar("correo");
    await esperar(3000);
    const c = await cliente();
    await c.decir("hola", 20);
    comprobar("después de la entrega le pide el correo", c.dijo("PIDE-CORREO"));
    await c.decir("no tengo ahorita", 30);
    comprobar("sin correo: la IA contesta y no sigue", !c.dijo("CORREO-OK"));
    await c.decir("ya, es prueba.tablero@example.com", 20);
    comprobar("con su correo: se envía y sigue por «Correo enviado»", c.dijo("CORREO-OK"));
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

  if (toca("activar")) {
    console.log("\n· «▶ Activar un workflow» desde un botón de la venta de siempre");
    sembrar(null);
    await esperar(3000);
    const c = await cliente();
    await c.decir("hola", 25);
    comprobar("sin tablero, contesta la venta de siempre", c.bot.length > 0 && !c.dijo("DENTRO-DEL-WORKFLOW"));
    await c.tocar("act_wf", "Ver el workflow", 25);
    comprobar("el botón lo pasa al workflow", c.dijo("DENTRO-DEL-WORKFLOW"));
    await c.decir("si claro", 25);
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
