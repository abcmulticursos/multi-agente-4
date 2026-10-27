// REENGANCHE (27/10/2026, su pedido): cambiar de tubería con clientes dentro. Él vende con una tubería
// lineal; arma otra (doble oferta) suelta y, cuando está lista, conecta la nueva y desconecta la lineal.
// Lo que exige: SOLO LOS NUEVOS entran por la nueva; los que ya estaban terminan su compra como empezaron,
// con su precio. En la copia el cambio se hace con el Reparto de TIENDA PLANTILLAS (Perú): primero todo a
// la lineal, después todo a la doble oferta — para el cliente es lo mismo que mover el cable del Inicio.
// NO GUARDA NADA: corre contra una COPIA.
//   node scripts/recorrido-reenganche.mjs --url=http://localhost:3312 --raiz=<copia> --comprobantes=<carpeta>
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const BASE = (args.url ?? "http://localhost:3000").replace(/\/$/, "");
const RAIZ = args.raiz ?? process.cwd();
if (!RAIZ.includes("scratchpad")) throw new Error("solo contra la copia del scratchpad");
const require = createRequire(join(RAIZ, "package.json"));
const YAML = require("yaml");
const Database = require("better-sqlite3");
const ARCHIVO = join(RAIZ, "config", "intro-data.yaml");
const TIENDA = "tienda_tplantillas";
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
let fallos = 0;
const comprobar = (texto, ok, valor = "") => {
  if (!ok) fallos++;
  console.log(`  ${ok ? "ok   " : "FALLA"} ${(texto + " ".repeat(70)).slice(0, 70)} ${String(valor).replace(/\s+/g, " ").slice(0, 90)}`);
};

function cambiarLaCopia(fn) {
  const doc = YAML.parseDocument(readFileSync(ARCHIVO, "utf8"));
  const js = doc.toJS({ maxAliasCount: -1 });
  fn(js);
  doc.set("awaiting_email_timeout_seconds", js.awaiting_email_timeout_seconds);
  doc.setIn(["tableros", TIENDA, "whatsapp"], doc.createNode(js.tableros[TIENDA].whatsapp));
  writeFileSync(ARCHIVO, doc.toString({ lineWidth: 0 }));
}
const aLaTuberia = (ruta) =>
  cambiarLaCopia((js) => {
    const r = js.tableros[TIENDA].whatsapp.fichas.find((f) => f.id === "pla_pe_reparto");
    for (const o of r.reparto) o.peso = ruta === "todas" || o.id === ruta ? 1 : 0;
  });
cambiarLaCopia((js) => {
  js.awaiting_email_timeout_seconds = 60;
  for (const f of js.tableros[TIENDA].whatsapp.fichas) {
    if (f.tipo === "seguimientos") {
      f.seguimientos[0].minutos = 1;
      if (f.seguimientos[1]) f.seguimientos[1].minutos = 3;
    }
    if (f.espera_min) f.espera_min = 1;
    if (f.sin_respuesta_min) f.sin_respuesta_min = 1;
  }
});

let cookie = "";
async function api(ruta, opciones = {}) {
  for (let intento = 1; ; intento++) {
    try {
      const r = await fetch(BASE + ruta, { ...opciones, headers: { ...(opciones.headers ?? {}), cookie } });
      const set = r.headers.get("set-cookie");
      if (set) cookie = set.split(";")[0];
      return r;
    } catch (e) {
      if (intento >= 3) throw e;
      await esperar(2000);
    }
  }
}
const env = readFileSync(join(RAIZ, ".env"), "utf8");
await api("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: (env.match(/^DASHBOARD_PASSWORD=(.*)$/m)?.[1] ?? "").trim().replace(/^["']|["']$/g, "") }) });
const carpeta = args.comprobantes ?? "";
const archivos = carpeta && existsSync(carpeta) ? readdirSync(carpeta) : [];
const foto = (patron) => join(carpeta, archivos.find((a) => patron.test(a)) ?? "");

async function cliente() {
  const conv = await (await api("/api/test-simulator", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channel: "whatsapp", tienda: TIENDA, country: "PE" }) })).json();
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
  const mandar = async (f, seg) => {
    await api(`/api/test-simulator/${conv.id}/message`, { method: "POST", body: f });
    await leer(seg);
  };
  const db = () => new Database(join(RAIZ, "data", "messages.db"), { readonly: true });
  return {
    id: conv.id,
    bot,
    leer,
    decir: (t, seg = 30) => {
      const f = new FormData();
      f.set("content", t);
      return mandar(f, seg);
    },
    tocar: (id, titulo, seg = 30) => {
      const f = new FormData();
      f.set("button_id", `bubble:${id}`);
      f.set("button_title", titulo);
      return mandar(f, seg);
    },
    foto: (ruta, seg = 80) => {
      const f = new FormData();
      f.set("file", new Blob([readFileSync(ruta)], { type: "image/jpeg" }), "comprobante.jpg");
      return mandar(f, seg);
    },
    fichas: () => {
      const d = db();
      try {
        return d.prepare("SELECT ficha_id FROM tablero_visitas WHERE conversation_id = ?").all(conv.id).map((r) => r.ficha_id);
      } finally {
        d.close();
      }
    },
    compras: () => {
      const d = db();
      try {
        return d.prepare("SELECT producto_id, monto FROM tablero_compras WHERE conversation_id = ?").all(conv.id);
      } finally {
        d.close();
      }
    },
  };
}

console.log("· ANTES DEL CAMBIO: todo entra por la tubería LINEAL");
aLaTuberia("lineal");
await esperar(3000);
const [w1, w2, w3] = await Promise.all([cliente(), cliente(), cliente()]);
await Promise.all([w1.decir("hola", 30), w2.decir("hola", 30), w3.decir("hola", 30)]);
// w1: pide comprar y recibe los datos (cobro abierto). w3: compra y le llega el upsell. w2: se calla.
await Promise.all([
  (async () => {
    await w1.tocar("pla_pe_lin_intro_quiere", "Quiero comprar", 25);
    await w1.decir("yape", 30);
  })(),
  (async () => {
    await w3.tocar("pla_pe_lin_intro_quiere", "Quiero comprar", 25);
    await w3.decir("yape", 30);
    await w3.foto(foto(/ALBERTO yapeo 15/i), 90);
    await w3.leer(80); // el upsell espera 1 min
  })(),
]);
comprobar("w1 tiene los datos de la lineal antes del cambio", /15/.test(w1.bot.join("\n")), w1.bot.slice(-2).join(" / "));
comprobar("w3 compró la lineal y se le ofreció el upsell", w3.fichas().includes("pla_pe_lin_upsell1"), w3.fichas().slice(-2).join(","));

console.log("· EL CAMBIO: la tubería nueva (DOBLE OFERTA) toma a los nuevos");
aLaTuberia("dou");
await esperar(4000);
const w4 = await cliente();
await Promise.all([
  (async () => {
    await w1.foto(foto(/ALBERTO yapeo 15/i), 90);
  })(),
  (async () => {
    await w2.leer(70); // su seguimiento 1 (1 min)
    await w2.decir("quiero comprar", 30);
    await w2.decir("yape", 30);
    await w2.foto(foto(/ALBERTO yapeo 15/i), 90);
  })(),
  (async () => {
    await w3.tocar("pla_pe_lin_u1_si", "Sí", 30);
    await w3.foto(foto(/yapeo ALBERTO 5/i), 90);
  })(),
  (async () => {
    await w4.decir("hola", 40);
  })(),
]);
const compraDe = (w, p) => w.compras().find((c) => c.producto_id === p);
comprobar("w1 (tenía los datos): paga y recibe la lineal a 15", compraDe(w1, "ptpla_basico")?.monto === 15, JSON.stringify(w1.compras()));
// (Los seguimientos COLGADOS de la intro no se anotan como ficha visitada: se mira que siga en la lineal.)
comprobar("w2 (esperaba su seguimiento): sigue en SU tubería", w2.fichas().includes("pla_pe_lin_intro") && !w2.fichas().some((f) => f.startsWith("pla_pe_dou")), w2.fichas().join(","));
comprobar("w2 compra la lineal a 15", compraDe(w2, "ptpla_basico")?.monto === 15, JSON.stringify(w2.compras()));
comprobar("w3 (upsell ofrecido): compra el upsell a 5", compraDe(w3, "ptpla_upsell")?.monto === 5, JSON.stringify(w3.compras()));
comprobar("w4 (nuevo): entra por la DOBLE OFERTA", w4.fichas().includes("pla_pe_dou_intro"), w4.fichas().join(","));
comprobar("w4 ve los dos productos", /PACK PLANTILLA COMPLETO/i.test(w4.bot.join("\n")) || /pack/i.test(w4.bot.join("\n")), w4.bot.slice(-1).join(" "));
aLaTuberia("todas");
console.log(fallos ? `\n${fallos} comprobación(es) mal.` : "\nTODO BIEN.");
process.exit(fallos ? 1 : 0);
