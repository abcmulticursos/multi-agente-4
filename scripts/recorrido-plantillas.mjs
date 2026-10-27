// «TIENDA PLANTILLAS» (27/10/2026): las 12 tuberías vendiendo en el simulador (PE con botones, EC con
// palabras, AR con números; lineal, order bump, doble oferta y contribución), el Reparto por sorteo y
// una tubería que sirve a dos países. NO GUARDA NADA: corre contra una COPIA. En la copia acorta los
// tiempos de esta tienda y, para probar cada tubería, pone su Reparto al 100 % hacia ella.
//   node scripts/recorrido-plantillas.mjs --url=http://localhost:3312 --raiz=<copia> --comprobantes=<carpeta> [--solo=pe_lineal,ec_ob,…,reparto,dos_paises]
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const BASE = (args.url ?? "http://localhost:3000").replace(/\/$/, "");
const RAIZ = args.raiz ?? process.cwd();
if (!RAIZ.includes("scratchpad")) throw new Error("solo contra la copia del scratchpad");
const require = createRequire(join(RAIZ, "package.json"));
const YAML = require("yaml");
const solo = args.solo ? new Set(args.solo.split(",")) : null;
const toca = (n) => !solo || solo.has(n);
const ARCHIVO = join(RAIZ, "config", "intro-data.yaml");
const TIENDA = "tienda_tplantillas";

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, ok, valor = "") => {
  if (!ok) fallos++;
  console.log(`  ${ok ? "ok   " : "FALLA"} ${pad(texto, 70)} ${String(valor).replace(/\s+/g, " ").slice(0, 90)}`);
};
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const cifras = (v) => String(v ?? "").replace(/\D/g, "");

// ── LA COPIA: tiempos cortos y el Reparto hacia la tubería que se prueba ──
function cambiarLaCopia(fn) {
  const doc = YAML.parseDocument(readFileSync(ARCHIVO, "utf8"));
  const js = doc.toJS();
  fn(js);
  doc.set("awaiting_email_timeout_seconds", js.awaiting_email_timeout_seconds);
  doc.setIn(["tableros", TIENDA, "whatsapp"], doc.createNode(js.tableros[TIENDA].whatsapp));
  writeFileSync(ARCHIVO, doc.toString({ lineWidth: 0 }));
}
cambiarLaCopia((js) => {
  js.awaiting_email_timeout_seconds = 40;
  for (const f of js.tableros[TIENDA].whatsapp.fichas) {
    if (f.tipo === "seguimientos") {
      f.seguimientos[0].minutos = 1;
      if (f.seguimientos[1]) f.seguimientos[1].minutos = 3;
    }
    if (f.espera_min) f.espera_min = 1;
    if (f.sin_respuesta_min) f.sin_respuesta_min = 1;
  }
});
const forzar = (pais, ruta) =>
  cambiarLaCopia((js) => {
    const r = js.tableros[TIENDA].whatsapp.fichas.find((f) => f.id === `pla_${pais.toLowerCase()}_reparto`);
    for (const o of r.reparto) o.peso = ruta === "todas" ? 1 : o.id === ruta ? 1 : 0;
  });

// ── EL SIMULADOR ──
let cookie = "";
async function api(ruta, opciones = {}) {
  const repetible = !opciones.method || /^(GET|DELETE)$/i.test(opciones.method);
  for (let intento = 1; ; intento++) {
    try {
      const r = await fetch(BASE + ruta, { ...opciones, headers: { ...(opciones.headers ?? {}), cookie } });
      const set = r.headers.get("set-cookie");
      if (set) cookie = set.split(";")[0];
      return r;
    } catch (e) {
      if (!repetible || intento >= 3) throw e;
      await esperar(2000);
    }
  }
}
async function entrar() {
  const env = readFileSync(join(RAIZ, ".env"), "utf8");
  const pass = (env.match(/^DASHBOARD_PASSWORD=(.*)$/m)?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
  await api("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: pass }) });
}
const Database = require("better-sqlite3");
const base = () => new Database(join(RAIZ, "data", "messages.db"));
async function cliente(pais) {
  const conv = await (await api("/api/test-simulator", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channel: "whatsapp", tienda: TIENDA, country: pais }) })).json();
  let vistos = 0;
  const bot = [];
  const leer = async (seg) => {
    const fin = Date.now() + seg * 1000;
    while (Date.now() < fin) {
      const d = await (await api(`/api/test-simulator/${conv.id}`)).json();
      for (const m of d.messages.slice(vistos)) if (m.role !== "user") bot.push(`${m.media_type ? `[MEDIA:${m.media_type}] ` : ""}${m.content ?? ""}`);
      vistos = d.messages.length;
      await esperar(1000);
    }
  };
  const enviar = async (f, seg) => {
    await api(`/api/test-simulator/${conv.id}/message`, { method: "POST", body: f });
    await leer(seg);
  };
  let marca = 0;
  return {
    id: conv.id,
    bot,
    nuevo: () => bot.slice(marca).join("\n"),
    leer: async (seg) => {
      marca = bot.length;
      await leer(seg);
    },
    /** Lee hasta que llega algo que cumple `patron` (o se acaba el tiempo). En la copia el silencio del
     *  regalo es de 40 s: el que espera una oferta tiene que contestar en cuanto llega, como un cliente. */
    hasta: async (patron, seg = 150) => {
      marca = bot.length;
      const fin = Date.now() + seg * 1000;
      while (Date.now() < fin) {
        await leer(2);
        if (patron.test(bot.slice(marca).join("\n"))) return true;
      }
      return false;
    },
    decir: (t, seg = 35) => {
      marca = bot.length;
      const f = new FormData();
      f.set("content", t);
      return enviar(f, seg);
    },
    tocar: (id, titulo, seg = 35) => {
      marca = bot.length;
      const f = new FormData();
      f.set("button_id", `bubble:${id}`);
      f.set("button_title", titulo);
      return enviar(f, seg);
    },
    foto: (ruta, seg = 80) => {
      marca = bot.length;
      const f = new FormData();
      f.set("file", new Blob([readFileSync(ruta)], { type: "image/jpeg" }), "comprobante.jpg");
      return enviar(f, seg);
    },
    fichas: () => {
      const db = base();
      try {
        return db.prepare("SELECT ficha_id FROM tablero_visitas WHERE conversation_id = ?").all(conv.id).map((r) => r.ficha_id);
      } finally {
        db.close();
      }
    },
    borrar: () => api(`/api/test-simulator/${conv.id}`, { method: "DELETE" }),
  };
}

const carpeta = args.comprobantes ?? "";
const archivos = carpeta && existsSync(carpeta) ? readdirSync(carpeta) : [];
const comprobante = (patron) => {
  const f = archivos.find((a) => patron.test(a));
  if (!f) throw new Error(`falta el comprobante ${patron}`);
  return join(carpeta, f);
};
const R = {
  pe15: comprobante(/ALBERTO yapeo 15/i),
  pe5: comprobante(/yapeo ALBERTO 5/i),
  ec3: comprobante(/^PICHINCHA 3 DOLARES\.jpg$/i),
  ec3b: comprobante(/^PICHINCHA 3 DOLARES B\.jpg$/i),
  ec4: comprobante(/^PICHINCHA 4 DOLARES\.jpg$/i),
  ar8000: comprobante(/FRANKO recibo de pago 8000/i),
};
const REGALO = /regalit/i;
const tiene = (c, id) => c.fichas().includes(id);

try {
  await entrar();

  // ── 🇵🇪 PERÚ · BOTONES ──
  if (toca("pe_lineal")) {
    forzar("PE", "lineal");
    console.log("\n· 🇵🇪 LINEAL con botones: Quiero comprar → yape 15 → GUÍA → upsell «No» → regalo");
    const c = await cliente("PE");
    await c.decir("hola", 45);
    comprobar("el Reparto lo manda a la Intro lineal", tiene(c, "pla_pe_lin_intro"), c.fichas().join(", "));
    await c.tocar("pla_pe_lin_intro_quiere", "Quiero comprar", 35);
    comprobar("«Quiero comprar»: el Cobro pregunta el método", tiene(c, "pla_pe_lin_cobro") && /m[eé]todo/i.test(c.nuevo()), c.nuevo().slice(0, 90));
    await c.decir("yape", 35);
    comprobar("«yape»: sus datos con 15", /15/.test(c.nuevo()), c.nuevo().slice(0, 90));
    await c.foto(R.pe15, 40);
    comprobar("paga 15: le entrega GUÍA PLANTILLA", tiene(c, "pla_pe_lin_ent_b") && /GU[IÍ]A PLANTILLA/.test(c.nuevo()), c.nuevo().slice(0, 90));
    comprobar("tras su espera, le llega el upsell (y contesta en cuanto llega)", await c.hasta(/PLANTILLAS PREMIUM/), "");
    comprobar("tras su espera, el upsell (PLANTILLAS PREMIUM)", /PLANTILLAS PREMIUM/.test(c.bot.join("\n")), "");
    await c.tocar("pla_pe_lin_u1_no", "No, gracias", 30);
    await c.leer(70);
    comprobar("«No, gracias»: le llega el regalo", REGALO.test(c.bot.join("\n").split("PLANTILLAS PREMIUM").pop()), "");
    await c.borrar();
  }

  if (toca("pe_ob")) {
    forzar("PE", "ob");
    console.log("\n· 🇵🇪 ORDER BUMP con botones: se calla tras el order bump → botón del seguimiento «Quiero el pack» → yape 20… y el básico");
    const c = await cliente("PE");
    await c.decir("hola", 45);
    await c.tocar("pla_pe_ob_intro_quiere", "Quiero comprar", 35);
    comprobar("«Quiero comprar»: la intro de order bump", tiene(c, "pla_pe_ob_ob") && /Espera/i.test(c.nuevo()), c.nuevo().slice(0, 90));
    await c.leer(90);
    comprobar("se calla: le llega SU seguimiento (el de después del order bump: «¿Ya elegiste?»)", /Ya elegiste/i.test(c.nuevo()), c.nuevo().slice(0, 90));
    await c.tocar("pla_pe_ob_segB_pack", "Quiero el pack", 35);
    comprobar("botón del seguimiento «Quiero el pack»: Cobro del pack (20)", tiene(c, "pla_pe_ob_cobro_p") && /20/.test(c.nuevo()), c.nuevo().slice(0, 90));
    comprobar("y la intro de order bump no se repite", (c.bot.join("\n").match(/Antes de pagar te cuento/g) ?? []).length === 1, "");
    await c.decir("mejor el basico", 35);
    comprobar("«mejor el básico»: cambia al Cobro del básico (15)", /15/.test(c.nuevo()), c.nuevo().slice(0, 90));
    await c.decir("yape", 35);
    await c.foto(R.pe15, 40);
    comprobar("paga 15: le entrega GUÍA PLANTILLA", /GU[IÍ]A PLANTILLA/.test(c.nuevo()) && (tiene(c, "pla_pe_ob_ent_b")), c.nuevo().slice(0, 90));
    comprobar("tras su espera, le llega el upsell (y contesta en cuanto llega)", await c.hasta(/PLANTILLAS PREMIUM/), "");
    await c.tocar("pla_pe_ob_u1_si", "Sí, lo quiero", 35);
    comprobar("upsell «Sí»: datos de PLANTILLAS PREMIUM con 5", tiene(c, "pla_pe_ob_cobro_u1") && /5/.test(c.nuevo()), c.nuevo().slice(0, 90));
    await c.foto(R.pe5, 80);
    comprobar("paga 5: le entrega PLANTILLAS PREMIUM", tiene(c, "pla_pe_ob_ent_u1"), c.nuevo().slice(0, 90));
    await c.leer(70);
    comprobar("y después, el regalo", REGALO.test(c.bot.join("\n")), "");
    await c.borrar();
  }

  if (toca("pe_dou")) {
    forzar("PE", "dou");
    console.log("\n· 🇵🇪 DOBLE OFERTA con botones: básico 15 → upgrade «Sí, completar» por 5 → PACK → upsell «No» → regalo");
    const c = await cliente("PE");
    await c.decir("hola", 45);
    comprobar("la intro con los dos precios (15 y 20)", /15/.test(c.nuevo()) && /20/.test(c.nuevo()), c.nuevo().slice(-120));
    await c.tocar("pla_pe_dou_intro_basico", "Solo el básico", 35);
    await c.decir("yape", 35);
    comprobar("«yape»: datos con 15", /15/.test(c.nuevo()), c.nuevo().slice(0, 90));
    await c.foto(R.pe15, 80);
    comprobar("paga 15: GUÍA PLANTILLA y le ofrece completar al pack", tiene(c, "pla_pe_dou_ent_b") && tiene(c, "pla_pe_dou_upgrade"), c.nuevo().slice(0, 90));
    await c.tocar("pla_pe_dou_up_si", "Sí, completar", 35);
    comprobar("«Sí, completar»: datos por la diferencia (5)", tiene(c, "pla_pe_dou_cobro_up") && /\b5\b/.test(c.nuevo()), c.nuevo().slice(0, 90));
    await c.foto(R.pe5, 40);
    comprobar("paga 5: le entrega el PACK", tiene(c, "pla_pe_dou_ent_p") && /PACK PLANTILLA/.test(c.nuevo()), c.nuevo().slice(0, 90));
    comprobar("tras su espera, le llega el upsell (y contesta en cuanto llega)", await c.hasta(/PLANTILLAS PREMIUM/), "");
    await c.tocar("pla_pe_dou_u1_no", "No, gracias", 30);
    await c.leer(70);
    comprobar("upsell «No»: el regalo", REGALO.test(c.bot.join("\n")), "");
    await c.borrar();
  }

  if (toca("pe_contrib")) {
    forzar("PE", "contrib");
    console.log("\n· 🇵🇪 CONTRIBUCIÓN con botones: «Sí, acepto» → material → yape → aporta 15 → nivel S/ 15");
    const c = await cliente("PE");
    await c.decir("hola", 45);
    await c.tocar("pla_pe_con_promesa_acepto", "Sí, acepto", 60);
    comprobar("acepta: le llega el material y los niveles", tiene(c, "pla_pe_con_entrega") && tiene(c, "pla_pe_con_cobro") && /S\/ 15/.test(c.nuevo()), c.nuevo().slice(-100));
    await c.decir("yape", 35);
    await c.foto(R.pe15, 80);
    comprobar("aporta 15: el nivel S/ 15", tiene(c, "pla_pe_con_nivel15") && !tiene(c, "pla_pe_con_nivel10"), c.fichas().join(", "));
    await c.borrar();
  }

  // ── 🇪🇨 ECUADOR · PALABRAS ──
  if (toca("ec_lineal")) {
    forzar("EC", "lineal");
    console.log("\n· 🇪🇨 LINEAL con palabras: «quiero comprar» → pichincha 3 → GUÍA → upsell «no gracias» → regalo");
    const c = await cliente("EC");
    await c.decir("hola", 45);
    await c.decir("quiero comprar", 35);
    comprobar("«quiero comprar»: el Cobro", tiene(c, "pla_ec_lin_cobro"), c.nuevo().slice(0, 90));
    if (!/3/.test(c.nuevo())) await c.decir("pichincha", 35);
    comprobar("sus datos con 3", /\b3\b/.test(c.bot.join("\n")), c.nuevo().slice(0, 90));
    await c.foto(R.ec3, 40);
    comprobar("paga 3: GUÍA PLANTILLA", tiene(c, "pla_ec_lin_ent_b"), c.nuevo().slice(0, 90));
    comprobar("tras su espera, le llega el upsell (y contesta en cuanto llega)", await c.hasta(/PLANTILLAS PREMIUM/), "");
    await c.decir("no gracias", 30);
    await c.leer(70);
    comprobar("«no gracias»: el regalo", tiene(c, "pla_ec_lin_no_u1") && REGALO.test(c.bot.join("\n")), c.fichas().slice(-3).join(", "));
    await c.borrar();
  }

  if (toca("ec_ob")) {
    forzar("EC", "ob");
    console.log("\n· 🇪🇨 ORDER BUMP con palabras: «quiero comprar» → order bump → se calla → seguimiento → «el pack» → pichincha 4 → PACK");
    const c = await cliente("EC");
    await c.decir("hola", 45);
    await c.decir("quiero comprar", 35);
    comprobar("la intro de order bump", tiene(c, "pla_ec_ob_ob") && /Espera/i.test(c.nuevo()), c.nuevo().slice(0, 90));
    await c.leer(90);
    await c.decir("el pack", 35);
    comprobar("«el pack» (con el seguimiento ya enviado): Cobro del pack", tiene(c, "pla_ec_ob_cobro_p"), c.fichas().slice(-3).join(", "));
    if (!/\b4\b/.test(c.nuevo())) await c.decir("pichincha", 35);
    comprobar("sus datos con 4", /\b4\b/.test(c.bot.join("\n").split("Espera").pop()), c.nuevo().slice(0, 90));
    await c.foto(R.ec4, 40);
    comprobar("paga 4: el PACK", tiene(c, "pla_ec_ob_ent_p"), c.nuevo().slice(0, 90));
    comprobar("tras su espera, le llega el upsell (y contesta en cuanto llega)", await c.hasta(/PLANTILLAS PREMIUM/), "");
    await c.decir("si", 35);
    comprobar("upsell «sí»: su Cobro", tiene(c, "pla_ec_ob_cobro_u1"), c.nuevo().slice(0, 90));
    if (!/\b3\b/.test(c.nuevo())) await c.decir("pichincha", 35);
    await c.foto(R.ec3b, 80);
    comprobar("paga 3: PLANTILLAS PREMIUM", tiene(c, "pla_ec_ob_ent_u1"), c.nuevo().slice(0, 90));
    await c.borrar();
  }

  if (toca("ec_dou")) {
    forzar("EC", "dou");
    console.log("\n· 🇪🇨 DOBLE OFERTA con palabras: «el pack» → pichincha 4 → PACK → upsell «no» → regalo");
    const c = await cliente("EC");
    await c.decir("hola", 45);
    await c.decir("el pack", 35);
    comprobar("«el pack»: Cobro del pack", tiene(c, "pla_ec_dou_cobro_p"), c.nuevo().slice(0, 90));
    if (!/\b4\b/.test(c.nuevo())) await c.decir("pichincha", 35);
    await c.foto(R.ec4, 40);
    comprobar("paga 4: el PACK (sin upgrade: ya tiene el completo)", tiene(c, "pla_ec_dou_ent_p") && !tiene(c, "pla_ec_dou_upgrade"), c.fichas().slice(-3).join(", "));
    comprobar("tras su espera, le llega el upsell (y contesta en cuanto llega)", await c.hasta(/PLANTILLAS PREMIUM/), "");
    await c.decir("no", 30);
    await c.leer(70);
    comprobar("upsell «no»: el regalo", REGALO.test(c.bot.join("\n")), "");
    await c.borrar();
  }

  if (toca("ec_contrib")) {
    forzar("EC", "contrib");
    console.log("\n· 🇪🇨 CONTRIBUCIÓN con palabras: se calla → su seguimiento → «acepto» → material → pichincha → aporta 3 → nivel $ 3");
    const c = await cliente("EC");
    await c.decir("hola", 45);
    // Puede llegar mientras aún se lee el «hola» (en la copia sale al minuto): se mira toda la charla.
    const llego = (await c.hasta(/Sigues por ah/i, 120)) || /Sigues por ah/i.test(c.bot.join("\n"));
    comprobar("se calla: le llega su seguimiento («¿Sigues por ahí?»)", llego, c.bot.slice(-2).join(" / "));
    await c.decir("acepto", 60);
    comprobar("acepta: material y niveles en dólares", tiene(c, "pla_ec_con_entrega") && /\$ 3/.test(c.nuevo()), c.nuevo().slice(-100));
    await c.decir("pichincha", 35);
    await c.foto(R.ec3, 80);
    comprobar("aporta 3: el nivel $ 3", tiene(c, "pla_ec_con_nivel3"), c.fichas().join(", "));
    await c.borrar();
  }

  // ── 🇦🇷 ARGENTINA · NÚMEROS ──
  if (toca("ar_lineal")) {
    forzar("AR", "lineal");
    console.log("\n· 🇦🇷 LINEAL con números: «1» → transferencia 8000 → GUÍA (y el correo) → upsell «2» → regalo");
    const c = await cliente("AR");
    await c.decir("hola", 45);
    await c.decir("1", 35);
    comprobar("«1»: el Cobro", tiene(c, "pla_ar_lin_cobro"), c.nuevo().slice(0, 90));
    await c.decir("transferencia", 35);
    comprobar("sus datos con 8.000", /8\.?000/.test(c.nuevo()), c.nuevo().slice(0, 90));
    await c.foto(R.ar8000, 40);
    comprobar("paga 8000: GUÍA PLANTILLA", tiene(c, "pla_ar_lin_ent_b"), c.nuevo().slice(0, 90));
    comprobar("y le pregunta si lo quiere por correo", /correo/i.test(c.nuevo()), "");
    await c.decir("no gracias", 30);
    comprobar("tras su espera, le llega el upsell (y contesta en cuanto llega)", await c.hasta(/PLANTILLAS PREMIUM/), "");
    comprobar("tras su espera, el upsell", /PLANTILLAS PREMIUM/.test(c.bot.join("\n")), "");
    await c.decir("2", 30);
    await c.leer(70);
    comprobar("«2» (no): el regalo", tiene(c, "pla_ar_lin_no_u1") && REGALO.test(c.bot.join("\n")), c.fichas().slice(-3).join(", "));
    await c.borrar();
  }

  if (toca("ar_ob")) {
    forzar("AR", "ob");
    console.log("\n· 🇦🇷 ORDER BUMP con números: «1» → order bump → «1» (básico) → transferencia 8000 → GUÍA → upsell «2»");
    const c = await cliente("AR");
    await c.decir("hola", 45);
    await c.decir("1", 35);
    comprobar("«1»: la intro de order bump", tiene(c, "pla_ar_ob_ob"), c.nuevo().slice(0, 90));
    await c.decir("1", 35);
    comprobar("«1»: Cobro del básico", tiene(c, "pla_ar_ob_cobro_b"), c.fichas().slice(-2).join(", "));
    if (!/8\.?000/.test(c.nuevo())) await c.decir("transferencia", 35);
    await c.foto(R.ar8000, 40);
    comprobar("paga 8000: GUÍA PLANTILLA", tiene(c, "pla_ar_ob_ent_b"), c.nuevo().slice(0, 90));
    comprobar("tras su espera, le llega el upsell (y contesta en cuanto llega)", await c.hasta(/PLANTILLAS PREMIUM/), "");
    await c.decir("2", 30);
    await c.leer(70);
    comprobar("upsell «2»: el regalo", REGALO.test(c.bot.join("\n")), "");
    await c.borrar();
  }

  if (toca("ar_dou")) {
    forzar("AR", "dou");
    console.log("\n· 🇦🇷 DOBLE OFERTA con números: «1» → transferencia 8000 → GUÍA → upgrade «2» (no) → upsell «2» → regalo");
    const c = await cliente("AR");
    await c.decir("hola", 45);
    await c.decir("1", 35);
    comprobar("«1»: Cobro del básico", tiene(c, "pla_ar_dou_cobro_b"), c.fichas().slice(-2).join(", "));
    if (!/8\.?000/.test(c.nuevo())) await c.decir("transferencia", 35);
    await c.foto(R.ar8000, 40);
    comprobar("paga 8000: GUÍA y le ofrece completar", tiene(c, "pla_ar_dou_ent_b") && tiene(c, "pla_ar_dou_upgrade"), c.fichas().slice(-3).join(", "));
    await c.decir("2", 35);
    comprobar("upgrade «2» (no): pasa al upsell", tiene(c, "pla_ar_dou_upsell1"), c.fichas().slice(-2).join(", "));
    comprobar("tras su espera, le llega el upsell (y contesta en cuanto llega)", await c.hasta(/PLANTILLAS PREMIUM/), "");
    await c.decir("2", 30);
    await c.leer(70);
    comprobar("upsell «2»: el regalo", REGALO.test(c.bot.join("\n")), "");
    await c.borrar();
  }

  if (toca("ar_contrib")) {
    forzar("AR", "contrib");
    console.log("\n· 🇦🇷 CONTRIBUCIÓN con números: «1» → material → transferencia → aporta 8000 → nivel 8.000");
    const c = await cliente("AR");
    await c.decir("hola", 45);
    await c.decir("1", 60);
    comprobar("acepta: material y niveles en pesos", tiene(c, "pla_ar_con_entrega") && /8\.000 ARS/.test(c.nuevo()), c.nuevo().slice(-100));
    await c.decir("transferencia", 35);
    await c.foto(R.ar8000, 80);
    comprobar("aporta 8000: el nivel 8.000", tiene(c, "pla_ar_con_nivel8000"), c.fichas().join(", "));
    await c.borrar();
  }

  // ── EL REPARTO POR SORTEO (las 4 al 25 %) ──
  if (toca("reparto")) {
    forzar("PE", "todas");
    console.log("\n· 🎲 REPARTO: 12 clientes de Perú se reparten entre las 4 tuberías");
    const cayeron = {};
    for (let i = 0; i < 12; i++) {
      const c = await cliente("PE");
      await c.decir("hola", 30);
      const ruta = ["lin", "ob", "dou", "con"].find((r) => c.fichas().some((f) => f.startsWith(`pla_pe_${r}_`)));
      cayeron[ruta ?? "ninguna"] = (cayeron[ruta ?? "ninguna"] ?? 0) + 1;
      await c.borrar();
    }
    comprobar("todos entran a alguna tubería", !cayeron.ninguna, JSON.stringify(cayeron));
    comprobar("y caen en más de una (sorteo)", Object.keys(cayeron).length >= 2, JSON.stringify(cayeron));
  }

  // ── «¿CUÁL ELIGES?», UN SOLO MÉTODO, PAGO DE MENOS Y EL CIERRE (27/10/2026, sus observaciones) ──
  const CUAL = /Cu[aá]l eliges/i;
  if (toca("cual_pe")) {
    forzar("PE", "ob");
    console.log("\n· 🇵🇪 ORDER BUMP destapado: «quiero pagar» → «¿Cuál eliges?»; «yape» → «con Yape… ¿Cuál eliges?»; elige → datos de frente");
    const c = await cliente("PE");
    await c.decir("hola", 45);
    await c.tocar("pla_pe_ob_intro_quiere", "Quiero comprar", 35);
    await c.decir("quiero pagar", 30);
    comprobar("«quiero pagar» sin elegir: «¿Cuál eliges?» con los dos y sus precios", CUAL.test(c.nuevo()) && /15/.test(c.nuevo()) && /20/.test(c.nuevo()), c.nuevo().slice(0, 120));
    comprobar("y no abre ningún Cobro", !tiene(c, "pla_pe_ob_cobro_b") && !tiene(c, "pla_pe_ob_cobro_p"), "");
    await c.decir("yape", 30);
    comprobar("«yape» sin elegir: «¡Perfecto, con Yape!» y otra vez cuál", /con \*?yape/i.test(c.nuevo()) && CUAL.test(c.nuevo()), c.nuevo().slice(0, 120));
    await c.tocar("pla_pe_ob_ob_pack", "Quiero el pack", 35);
    comprobar("elige el pack: datos de Yape con 20, sin preguntar el método", /20/.test(c.nuevo()) && !/m[eé]todo prefieres/i.test(c.nuevo()), c.nuevo().slice(0, 120));
    await c.borrar();
  }
  if (toca("cual_ec")) {
    forzar("EC", "dou");
    console.log("\n· 🇪🇨 DOBLE OFERTA: «pichincha» sin elegir → «con PICHINCHA… ¿Cuál eliges?» → «el pack» → datos de PICHINCHA con 4");
    const c = await cliente("EC");
    await c.decir("hola", 45);
    await c.decir("pichincha", 30);
    comprobar("«pichincha»: «¡Perfecto, con PICHINCHA!» y «¿Cuál eliges?»", /pichincha/i.test(c.nuevo()) && CUAL.test(c.nuevo()), c.nuevo().slice(0, 120));
    await c.decir("el pack", 35);
    comprobar("«el pack»: sus datos con 4, sin repreguntar el método", tiene(c, "pla_ec_dou_cobro_p") && /\b4\b/.test(c.nuevo()) && !/m[eé]todo prefieres/i.test(c.nuevo()), c.nuevo().slice(0, 120));
    await c.borrar();
  }
  if (toca("cual_ar")) {
    forzar("AR", "ob");
    console.log("\n· 🇦🇷 ORDER BUMP: se calla → seguimiento → «quiero pagar» → «¿Cuál eliges?» → «2» → datos con 12.000 (un solo método: sin preguntarlo)");
    const c = await cliente("AR");
    await c.decir("hola", 45);
    await c.decir("1", 35);
    comprobar("le llega su seguimiento de después del order bump", (await c.hasta(/Ya elegiste/i, 150)) || /Ya elegiste/i.test(c.bot.join("\n")), "");
    await c.decir("quiero pagar", 30);
    comprobar("«quiero pagar» tras el seguimiento: «¿Cuál eliges?»", CUAL.test(c.nuevo()), c.nuevo().slice(0, 120));
    await c.decir("2", 35);
    comprobar("«2»: los datos de transferencia con 12.000, sin preguntar el método", /12\.?000/.test(c.nuevo()) && !/m[eé]todo prefieres/i.test(c.nuevo()), c.nuevo().slice(0, 120));
    await c.borrar();
  }
  if (toca("un_metodo_ar")) {
    forzar("AR", "lineal");
    console.log("\n· 🇦🇷 UN SOLO MÉTODO: «1» → los datos de frente, sin «¿con qué método?»; y la contribución con su lista de montos");
    const c = await cliente("AR");
    await c.decir("hola", 45);
    await c.decir("1", 35);
    comprobar("datos con 8.000 de frente", /8\.?000/.test(c.nuevo()) && !/m[eé]todo prefieres/i.test(c.nuevo()), c.nuevo().slice(0, 120));
    await c.borrar();
    forzar("AR", "contrib");
    const d = await cliente("AR");
    await d.decir("hola", 45);
    await d.decir("1", 60);
    comprobar("contribución: la lista de montos y los datos de una vez", /8\.000 ARS/.test(d.nuevo()) && /2\.000/.test(d.nuevo()) && !/m[eé]todo prefieres/i.test(d.nuevo()), d.nuevo().slice(-140));
    await d.borrar();
  }
  if (toca("pago_menos")) {
    forzar("EC", "lineal");
    console.log("\n· 🇪🇨 PAGA DE MENOS: 1.50 de 3 → le dice cuánto falta; a su «ya te mandé», también");
    const c = await cliente("EC");
    await c.decir("hola", 45);
    await c.decir("quiero comprar", 35);
    if (!/\b3\b/.test(c.nuevo())) await c.decir("pichincha", 35);
    await c.foto(comprobante(/PICHINCHA 1\.50/i), 80);
    comprobar("le dice cuánto falta (1,50)", /1[.,]50/.test(c.nuevo()) && /falt/i.test(c.nuevo()), c.nuevo().slice(0, 140));
    await c.decir("ya te mande", 35);
    comprobar("a «ya te mandé»: le recuerda lo que falta, sin «¿ya pagaste?»", /1[.,]50/.test(c.nuevo()) && !/si ya realizaste/i.test(c.nuevo()), c.nuevo().slice(0, 140));
    await c.borrar();
  }
  if (toca("cierre")) {
    forzar("PE", "dou");
    // Sus seguimientos, lejos: aquí se mira solo cómo cierra la IA (en la copia salen al minuto y se cruzan).
    cambiarLaCopia((js) => {
      const s = js.tableros[TIENDA].whatsapp.fichas.find((f) => f.id === "pla_pe_dou_seg");
      s.seguimientos[0].minutos = 600;
      s.seguimientos[1].minutos = 900;
    });
    console.log("\n· 🇵🇪 EL CIERRE DE LA IA: pregunta suave al final, sin «solo dime»");
    const c = await cliente("PE");
    await c.decir("hola", 45);
    for (const q of ["que contiene", "es fisico o digital", "tiene garantia"]) {
      await c.decir(q, 35);
      const ultima = c.nuevo().trim().split(/\n\s*\n/).pop() ?? "";
      comprobar(`«${q}»: termina con una pregunta suave`, /\?\s*\S*$/.test(ultima) && !/solo dime|lo quieres ya|adquirirlo ya/i.test(c.nuevo()), ultima.slice(0, 90));
    }
    await c.borrar();
    cambiarLaCopia((js) => {
      const s = js.tableros[TIENDA].whatsapp.fichas.find((f) => f.id === "pla_pe_dou_seg");
      s.seguimientos[0].minutos = 1;
      s.seguimientos[1].minutos = 3;
    });
  }

  // ── UN REPARTO CON RUTAS SIN CABLE: nadie se pierde (27/10/2026, lo cazó él en MASCOTAS) ──
  if (toca("reparto_sin_cable")) {
    forzar("PE", "todas");
    let quitados = [];
    cambiarLaCopia((js) => {
      const t = js.tableros[TIENDA].whatsapp;
      quitados = t.cables.filter((x) => x.de === "pla_pe_reparto" && (x.salida === "rep:dou" || x.salida === "rep:contrib"));
      t.cables = t.cables.filter((x) => !quitados.includes(x));
    });
    quitados = quitados.map((x) => ({ ...x }));
    console.log("\n· 🎲 REPARTO con 2 de sus 4 rutas sin cable: 6 clientes, ninguno se queda sin respuesta");
    const cayeron = {};
    for (let i = 0; i < 6; i++) {
      const c = await cliente("PE");
      await c.decir("hola", 30);
      const ruta = ["lin", "ob", "dou", "con"].find((r) => c.fichas().some((f) => f.startsWith(`pla_pe_${r}_`)));
      cayeron[ruta ?? "ninguna"] = (cayeron[ruta ?? "ninguna"] ?? 0) + 1;
      await c.borrar();
    }
    comprobar("todos caen en una ruta CONECTADA (lineal u order bump)", Object.keys(cayeron).every((k) => k === "lin" || k === "ob"), JSON.stringify(cayeron));
    cambiarLaCopia((js) => js.tableros[TIENDA].whatsapp.cables.push(...quitados));
  }

  // ── UNA TUBERÍA PARA DOS PAÍSES: el Inicio de Argentina a la tubería lineal de Perú ──
  if (toca("dos_paises")) {
    forzar("PE", "lineal");
    cambiarLaCopia((js) => {
      const t = js.tableros[TIENDA].whatsapp;
      const c = t.cables.find((x) => x.de === "pla_ar_inicio" && x.salida === "siguiente");
      c.a = "pla_pe_reparto";
    });
    console.log("\n· 🇦🇷→🇵🇪 UNA TUBERÍA EN DOS PAÍSES: un cliente de Argentina por la tubería lineal de Perú");
    const c = await cliente("AR");
    await c.decir("hola", 45);
    comprobar("entra por la Intro lineal de Perú", tiene(c, "pla_pe_lin_intro"), c.fichas().join(", "));
    comprobar("con el precio de Argentina (8.000)", /8\.?000/.test(c.bot.join("\n")), c.bot.join("\n").slice(-120));
    await c.tocar("pla_pe_lin_intro_quiere", "Quiero comprar", 35);
    await c.decir("transferencia", 35);
    comprobar("sus datos: los de Argentina, con 8.000", /8\.?000/.test(c.nuevo()) && !/yape/i.test(c.nuevo()), c.nuevo().slice(0, 100));
    await c.borrar();
    cambiarLaCopia((js) => {
      const t = js.tableros[TIENDA].whatsapp;
      t.cables.find((x) => x.de === "pla_ar_inicio" && x.salida === "siguiente").a = "pla_ar_reparto";
    });
  }
} catch (err) {
  fallos++;
  console.log("ERROR:", err);
}
// La copia queda con su Reparto parejo.
for (const p of ["PE", "EC", "AR"]) forzar(p, "todas");
console.log(fallos ? `\n${fallos} comprobación(es) mal.` : "\nTODO BIEN.");
process.exit(fallos ? 1 : 0);
