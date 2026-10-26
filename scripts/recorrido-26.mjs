// LA RONDA DEL 26/10/2026: lo nuevo del tablero, probado vendiendo en el simulador, y los países que
// trabajan y faltaban. NO GUARDA NADA: correr contra una COPIA (ronda-copia.cjs + ronda-copia-26.cjs).
//   node scripts/recorrido-26.mjs --url=http://localhost:3312 --raiz=<copia> --comprobantes=<carpeta> [--solo=a,b]
import { readFileSync, readdirSync, existsSync } from "node:fs";
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

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, ok, valor = "") => {
  if (!ok) fallos++;
  console.log(`  ${ok ? "ok   " : "FALLA"} ${pad(texto, 70)} ${String(valor).replace(/\s+/g, " ").slice(0, 90)}`);
};
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const cifras = (v) => String(v ?? "").replace(/\D/g, "");
const datos = () => YAML.parse(readFileSync(ARCHIVO, "utf8"));
const perfil = (pais) => datos().payment_profiles_by_country?.[pais] ?? {};
const cuenta = (pais, m) => cifras(perfil(pais).cuentas_por_metodo?.[m] ?? perfil(pais).numero_de_cuenta);
const precio = (pid, pais) => datos().biblioteca_de_productos.find((p) => p.id === pid)?.precios_por_pais?.[pais]?.price_soles;
const SILENCIO = Number(datos().awaiting_email_timeout_seconds ?? 300);
const ficha = (tienda, id) => datos().tableros[tienda].whatsapp.fichas.find((f) => f.id === id);
const botonesDe = (f) => {
  const out = [];
  (function w(o) {
    if (o && typeof o === "object") {
      for (const b of o.buttons ?? []) out.push(b);
      for (const v of Object.values(o)) w(v);
    }
  })(f);
  return out;
};

const carpeta = args.comprobantes ?? "";
const archivos = carpeta && existsSync(carpeta) ? readdirSync(carpeta) : [];
const comprobante = (patron) => {
  const f = archivos.find((a) => patron.test(a));
  return f ? join(carpeta, f) : null;
};
const R = { pe15: comprobante(/ALBERTO yapeo 15/i), ec3: comprobante(/PICHINCHA 3/i) };

let cookie = "";
async function api(ruta, opciones = {}) {
  // Una conexión que el servidor ya cerró (ECONNRESET) se reintenta, solo en lo que no repite nada.
  const repetible = !opciones.method || /^(GET|DELETE)$/i.test(opciones.method);
  let r;
  for (let intento = 1; ; intento++) {
    try {
      r = await fetch(BASE + ruta, { ...opciones, headers: { ...(opciones.headers ?? {}), cookie } });
      break;
    } catch (e) {
      if (!repetible || intento >= 3) throw e;
      await new Promise((ok) => setTimeout(ok, 2000));
    }
  }
  const set = r.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  return r;
}
async function entrar() {
  const env = readFileSync(join(RAIZ, ".env"), "utf8");
  const pass = (env.match(/^DASHBOARD_PASSWORD=(.*)$/m)?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
  await api("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: pass }) });
}
// La base de la COPIA, solo para marcar el anuncio del cliente de prueba y leer por qué fichas pasó.
const Database = require("better-sqlite3");
const base = () => new Database(join(RAIZ, "data", "messages.db"));
async function cliente(tienda, pais) {
  const conv = await (
    await api("/api/test-simulator", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channel: "whatsapp", tienda, country: pais }) })
  ).json();
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
    ultima: () => bot.slice(marca).filter((x) => x.trim()).pop() ?? "",
    leer: async (seg) => {
      marca = bot.length;
      await leer(seg);
    },
    decir: (t, seg = 35) => {
      marca = bot.length;
      const f = new FormData();
      f.set("content", t);
      return enviar(f, seg);
    },
    tocar: (id, titulo, seg = 30) => {
      marca = bot.length;
      const f = new FormData();
      f.set("button_id", `bubble:${id}`);
      f.set("button_title", titulo);
      return enviar(f, seg);
    },
    foto: (ruta, seg = 70) => {
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
const SEG = /Pudiste revisar|Alcanzaste a ver|Lograste ver|Te guard[ée] el precio|Paso rapidito/i;
const cuantosSeg = (c) => c.bot.filter((m) => SEG.test(m)).length;
const REGALO = /regalit|regalo/i;

try {
  await entrar();

  if (toca("seg_no_repite")) {
    console.log("\n· 🇪🇨 COCINA (order bump) — un seguimiento que ya salió no se repite, caiga donde caiga");
    const c = await cliente("tienda_tcocina", "EC");
    await c.decir("hola", 45);
    await c.leer(80);
    comprobar("se calla en la Intro: le llega el seguimiento 1", cuantosSeg(c) === 1, c.nuevo().slice(0, 80));
    const pagar = botonesDe(ficha("tienda_tcocina", "coc_ec_intro")).find((b) => /pagar/i.test(b.label));
    await c.tocar(pagar.id, pagar.label, 30);
    comprobar("«Quiero pagar»: el Order bump", /PACK/i.test(c.nuevo()), c.nuevo().slice(0, 80));
    await c.leer(215);
    comprobar("se calla en el Order bump: le llega el 2, NO otra vez el 1", cuantosSeg(c) === 2 && /Paso rapidito/i.test(c.nuevo()), c.nuevo().slice(0, 90));
    const basico = botonesDe(ficha("tienda_tcocina", "coc_ec_ob")).find((b) => /b[aá]sico/i.test(b.label));
    await c.tocar(basico.id, basico.label, 30);
    await c.leer(215);
    comprobar("se calla en el Cobro: ya recibió los 2, no le sale ninguno más", cuantosSeg(c) === 2, `${cuantosSeg(c)} seguimientos en total`);
    await c.borrar();
  }

  if (toca("vuelve")) {
    console.log("\n· 🇪🇨 MASCOTAS (versión recomendada) — volver al Order bump no lo repite");
    const c = await cliente("tienda_tmascotas", "EC");
    await c.decir("hola", 45);
    await c.decir("quiero pagar con pichincha", 40);
    const ob = (t) => (t.match(/¡Espera!/g) ?? []).length;
    comprobar("dice el método: le sale el Order bump (una vez)", ob(c.bot.join("\n")) === 1, c.nuevo().slice(0, 80));
    const obRec = datos().tableros.tienda_tmascotas.whatsapp.fichas.find((f) => f.id.startsWith("f-rec26-") && f.tipo === "intro_ob");
    const basico = botonesDe(obRec).find((b) => /b[aá]sico/i.test(b.label));
    await c.tocar(basico.id, basico.label, 35);
    comprobar("elige el básico: datos de PICHINCHA sin preguntar el método", cifras(c.nuevo()).includes(cuenta("EC", "transferencia")), c.nuevo().slice(0, 80));
    await c.decir("quiero cambiar de opcion", 40);
    comprobar("vuelve al Order bump: NO se lo manda otra vez", ob(c.bot.join("\n")) === 1, `${ob(c.bot.join("\n"))} veces`);
    comprobar("y le pregunta cuál prefiere", /\?/.test(c.nuevo()), c.nuevo().slice(0, 100));
    await c.borrar();
  }

  if (toca("upsell_sin_min") && R.ec3) {
    console.log("\n· 🇪🇨 PEQUEÑOS FELICES — upsell con «Si no responde» SIN minutos: el regalo tras el silencio");
    const c = await cliente("tienda_tninos", "EC");
    await c.decir("hola", 45);
    await c.decir("quiero pagar", 35);
    await c.decir("1", 30);
    await c.decir("pichincha", 30);
    await c.foto(R.ec3, 70);
    await c.leer(80);
    comprobar("paga 3 y tras su espera le ofrece el upsell", /NAVIDAD EN FAMILIA/.test(c.bot.join("\n")), "");
    await c.leer(SILENCIO + 40);
    // El regalo puede llegar ya dentro de la lectura anterior (el silencio es corto en la copia):
    // se mira todo lo que le llegó DESPUÉS de la oferta del upsell.
    const todo = c.bot.join("\n");
    const trasElUpsell = todo.slice(todo.indexOf("NAVIDAD EN FAMILIA"));
    comprobar("se calla: le llega el regalo (al silencio del regalo)", REGALO.test(trasElUpsell), trasElUpsell.slice(-100));
    comprobar("y no le salta al upsell 2 (el cable va al regalo)", !/TARJETAS DE EMOCIONES/.test(trasElUpsell), "");
    await c.borrar();
  }

  if (toca("precio_especial")) {
    console.log("\n· 🇦🇷 TALLER (lineal) — Cobro con precio especial (downsell): cobra 4321");
    const c = await cliente("tienda_ttaller", "AR");
    await c.decir("hola", 50);
    const pagar = botonesDe(ficha("tienda_ttaller", "tal_ar_intro")).find((b) => /pagar|quiero/i.test(b.label));
    if (pagar) await c.tocar(pagar.id, pagar.label, 35);
    else await c.decir("quiero pagar", 35);
    if (!/4\.?321/.test(c.nuevo())) await c.decir("transferencia", 35);
    comprobar("sus datos de pago con el precio especial (4321)", /4\.?321/.test(c.bot.join("\n")), c.nuevo().slice(0, 120));
    await c.borrar();
  }

  if (toca("anuncio")) {
    console.log("\n· 🇪🇨 COCINA — dos tuberías en un país: el anuncio «Advantage 5» va por la suya");
    const a = await cliente("tienda_tcocina", "EC");
    const db = base();
    db.prepare("UPDATE conversations SET ad_source_id = ? WHERE id = ?").run("120255300748550226", a.id);
    db.close();
    await a.decir("hola", 45);
    comprobar("vino del anuncio: entra por SU tubería (la Intro de Argentina en la copia)", a.fichas().includes("coc_ar_intro") && !a.fichas().includes("coc_ec_intro"), a.fichas().join(", "));
    await a.borrar();
    const b = await cliente("tienda_tcocina", "EC");
    await b.decir("hola", 45);
    comprobar("sin anuncio: va por «→ Los demás» (su Intro de Ecuador)", b.fichas().includes("coc_ec_intro"), b.fichas().join(", "));
    await b.borrar();
  }

  // LOS PAÍSES QUE TRABAJAN Y FALTABAN: entra, elige y le llegan sus datos con su precio.
  const rutas = [
    ["paises", "tienda_tcocina", "AR", "ptcocina_dietas", "lineal"],
    ["paises", "tienda_tninos", "AR", null, "lineal"],
    ["paises", "tienda_ttaller", "EC", null, "ob"],
  ];
  if (toca("paises"))
    for (const [, tienda, pais, , forma] of rutas) {
      const t = datos().tableros[tienda].whatsapp;
      const ini = t.fichas.find((f) => f.tipo === "inicio" && f.pais === pais);
      const intro = t.fichas.find((f) => f.id === t.cables.find((k) => k.de === ini.id && k.salida === "siguiente")?.a);
      console.log(`\n· ${tienda} ${pais} (${forma}) — entra, elige y le llegan sus datos`);
      const c = await cliente(tienda, pais);
      await c.decir("hola", 50);
      comprobar("le llega su intro", c.nuevo().trim().length > 40, c.nuevo().slice(0, 80));
      const metodo = pais === "EC" ? "pichincha" : "transferencia";
      await c.decir(`quiero pagar con ${metodo}`, 40);
      if (forma === "ob") {
        comprobar("decide comprar: el Order bump", /PACK|m[aá]s puedes|por solo/i.test(c.nuevo()), c.nuevo().slice(0, 80));
        await c.decir("solo el basico", 40);
      }
      const todo = c.bot.join("\n");
      const cobro = t.fichas.find((f) => f.tipo === "cobro" && c.fichas().includes(f.id));
      const pid = cobro?.cobro?.producto_id;
      const p = pid ? precio(pid, pais) : undefined;
      comprobar(`sus datos: cuenta de ${metodo} y precio ${p ?? "?"}`, !!cobro && cifras(todo).includes(cuenta(pais, pais === "EC" ? "transferencia" : metodo)) && p !== undefined && cifras(todo).includes(cifras(p)), todo.slice(-120));
      await c.borrar();
    }

  if (toca("otros"))
    for (const tienda of ["tienda_tcocina", "tienda_tninos", "tienda_ttaller", "tienda_testilista", "tienda_tfigurarte", "tienda_tfigurarte3"]) {
      const t = datos().tableros[tienda].whatsapp;
      const ini = t.fichas.find((f) => f.tipo === "inicio" && !f.pais);
      const primera = t.fichas.find((f) => f.id === t.cables.find((k) => k.de === ini?.id && k.salida === "siguiente")?.a);
      console.log(`\n· ${tienda} — «Otros países» (México)`);
      const c = await cliente(tienda, "MX");
      await c.decir("hola", 45);
      comprobar(`entra por «Otros países» → «${primera?.titulo ?? primera?.tipo}»`, !!primera && c.fichas().includes(primera.id), c.fichas().join(", "));
      comprobar("y le contesta algo", c.bot.join("").trim().length > 0, c.bot.join(" ").slice(0, 90));
      await c.borrar();
    }
} catch (err) {
  fallos++;
  console.log("ERROR:", err);
}
console.log(fallos ? `\n${fallos} comprobación(es) mal.` : "\nTODO BIEN.");
process.exit(fallos ? 1 : 0);
