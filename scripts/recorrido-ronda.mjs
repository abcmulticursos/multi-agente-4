// LA RONDA DEL 25/10/2026: sus observaciones del tablero, una por una, como examen. Vende de verdad
// en el simulador con sus comprobantes. NO GUARDA NADA: correr contra una COPIA con .env seguro y con
// `ronda-copia.cjs` del scratchpad (relojes cortos, cables de prueba solo en la copia).
//   node scripts/recorrido-ronda.mjs --url=http://localhost:3312 --raiz=<copia> --comprobantes=<carpeta> [--solo=a,b]
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const BASE = (args.url ?? "http://localhost:3000").replace(/\/$/, "");
const RAIZ = args.raiz ?? process.cwd();
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
const SILENCIO = Number(datos().awaiting_email_timeout_seconds ?? 300);

const carpeta = args.comprobantes ?? "";
const archivos = carpeta && existsSync(carpeta) ? readdirSync(carpeta) : [];
const comprobante = (patron) => {
  const f = archivos.find((a) => patron.test(a));
  return f ? join(carpeta, f) : null;
};
const R = { pe15: comprobante(/ALBERTO yapeo 15/i), pe5: comprobante(/yapeo ALBERTO 5/i), ec3: comprobante(/PICHINCHA 3/i) };

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
    mensajes: async () => (await (await api(`/api/test-simulator/${conv.id}`)).json()).messages ?? [],
    borrar: () => api(`/api/test-simulator/${conv.id}`, { method: "DELETE" }),
  };
}
const imagenes = (t) => (t.match(/\[MEDIA:image\]/g) ?? []).length;
const SEG = /Pudiste revisar|Alcanzaste a ver|Lograste ver|Te guard[ée] el precio|Paso rapidito|Sigue a \*/i;
const entregaDe = (slug) => `example.com/entrega/${slug}`;

try {
  await entrar();

  if (toca("galeria")) {
    console.log("\n· 🇵🇪 COCINA — «¿qué trae?»: texto + oferta; «dale» → galería; otro «sí» no repite; el cierre");
    const c = await cliente("tienda_tcocina", "PE");
    await c.decir("hola", 45);
    await c.decir("que trae el recetario dietas fit", 45);
    comprobar("contesta por escrito, SIN mandar fotos", imagenes(c.nuevo()) === 0 && c.nuevo().length > 60, c.nuevo().slice(0, 90));
    comprobar("y al final ofrece ver las imágenes (con tu burbuja)", /im[aá]gen|foto/i.test(c.ultima()) && /\?/.test(c.ultima()), c.ultima());
    await c.decir("dale", 50);
    comprobar("«dale»: le llega la galería", imagenes(c.nuevo()) >= 1, `${imagenes(c.nuevo())} imágenes`);
    await c.decir("si", 30);
    comprobar("otro «sí» después: NO repite las fotos", imagenes(c.nuevo()) === 0, c.nuevo().slice(0, 80));
    await c.decir("cuanto cuesta", 45);
    const r = c.nuevo();
    comprobar("el precio: nombra los dos (15 y 20)", /15/.test(r) && /20/.test(r), r.slice(0, 100));
    comprobar("y cierra con una pregunta, sin «ELIGE UNA OPCIÓN»", /\?/.test(c.ultima()) && !/ELIGE UNA OPCI/i.test(r), c.ultima());
    // LAS PAUSAS ENTRE BURBUJAS DE LA IA (punto 17): si contestó en 2 o más, entre ellas «Delay entre mensajes».
    const d = datos().globals?.between_messages_delay_seconds ?? datos().between_messages_delay_seconds ?? 3;
    const ia = (await c.mensajes()).filter((m) => m.role !== "user" && !m.media_type);
    const ult = ia.slice(-3);
    const gaps = [];
    for (let i = 1; i < ult.length; i++) gaps.push(new Date(ult[i].created_at * 1000 || ult[i].created_at).getTime() - new Date(ult[i - 1].created_at * 1000 || ult[i - 1].created_at).getTime());
    if (gaps.length) comprobar(`entre sus burbujas hay pausa (≥ ${d - 1} s)`, gaps.some((g) => g >= (d - 1) * 1000), gaps.map((g) => Math.round(g / 1000) + "s").join(", "));
    await c.borrar();
  }

  if (toca("colgados") && R.pe15) {
    console.log("\n· 🇵🇪 COCINA — calla → seguimiento (colgado); sus botones siguen; método; «ok» seco; upsell con espera; postventa");
    const c = await cliente("tienda_tcocina", "PE");
    await c.decir("hola", 45);
    await c.leer(110);
    comprobar("se calla: le llega el seguimiento 1 (colgado de la intro)", SEG.test(c.nuevo()), c.nuevo().slice(0, 80));
    await c.tocar("coc_pe_b_basico", "Opción 1", 35);
    comprobar("después del seguimiento, el botón de la intro sigue valiendo", /RECETARIO DIETAS FIT/.test(c.nuevo()) && /15/.test(c.nuevo()), c.nuevo().slice(0, 100));
    await c.decir("yape", 35);
    comprobar("«yape»: su cuenta y 15", cifras(c.nuevo()).includes(cuenta("PE", "yape")) && /15/.test(c.nuevo()), c.nuevo().slice(0, 80));
    await c.decir("ok", 25);
    comprobar("«ok» con los datos ya enviados: el bot se calla", c.nuevo().trim() === "", c.nuevo().slice(0, 80));
    const antes = c.bot.length;
    await c.foto(R.pe15, 60);
    const trasPago = c.bot.slice(antes).join("\n");
    comprobar("paga 15: le entrega DIETAS FIT", trasPago.includes(entregaDe("dietas-fit")), trasPago.slice(0, 80));
    // (En COCINA Perú tras la entrega va el «Upgrade al pack»; la espera del upsell la prueban NIÑOS y TALLER.)
    await c.decir("gracias, hasta cuando tengo acceso al material?", 40);
    comprobar("postventa: le contesta con tus textos (de por vida / Drive)", /vida|siempre|drive/i.test(c.nuevo()), c.nuevo().slice(0, 100));
    comprobar("y ya comprado, NO le ofrece ver imágenes", !/fotos del material|enseñe unas fotos|ver las im[aá]genes/i.test(c.nuevo()), c.nuevo().slice(-100));
    await c.tocar("coc_pe_u1_no", "No, gracias", 20);
    await c.leer(SILENCIO + 30);
    comprobar("dice que no: le llega el regalo", /regalit|RECETAS EXPR/i.test(c.bot.join("\n").slice(-1500)), "");
    await c.borrar();
  }

  if (toca("metodo")) {
    console.log("\n· 🇵🇪 COCINA (doble oferta) — dice el método antes de elegir: al elegir, sus datos de frente");
    const c = await cliente("tienda_tcocina", "PE");
    await c.decir("hola", 45);
    await c.decir("yape", 40);
    comprobar("«yape» sin haber elegido: no le manda una cuenta todavía", !cifras(c.nuevo()).includes(cuenta("PE", "yape")), c.nuevo().slice(0, 80));
    await c.tocar("coc_pe_b_basico", "Opción 1", 35);
    comprobar("elige el básico: le llegan los datos de YAPE con 15", cifras(c.nuevo()).includes(cuenta("PE", "yape")) && /15/.test(c.nuevo()), c.nuevo().slice(0, 80));
    comprobar("sin volver a preguntarle el método", !/qu[eé] m[eé]todo|elige (un|tu) m[eé]todo/i.test(c.nuevo()), "");
    await c.borrar();
  }

  if (toca("ob_palabra") && R.ec3) {
    console.log("\n· 🇪🇨 PEQUEÑOS FELICES (order bump) — «quiero pagar con pichincha» por palabra destapa la oferta");
    const c = await cliente("tienda_tninos", "EC");
    await c.decir("hola", 45);
    await c.decir("quiero pagar con pichincha", 40);
    comprobar("por palabra: le muestra la oferta del pack (order bump)", /PACK RABIETAS/.test(c.nuevo()), c.nuevo().slice(0, 80));
    await c.decir("1", 35);
    comprobar("elige el básico: datos de PICHINCHA con $3, sin preguntar el método", cifras(c.nuevo()).includes(cuenta("EC", "transferencia")) && /\$\s?3\b/.test(c.nuevo()), c.nuevo().slice(0, 80));
    await c.borrar();
  }

  if (toca("caja") && R.pe15) {
    console.log("\n· 🇵🇪 COCINA — manda el comprobante sin haber elegido (lo que hacía la caja abierta)");
    const c = await cliente("tienda_tcocina", "PE");
    await c.decir("hola", 45);
    await c.foto(R.pe15, 70);
    comprobar("paga 15 sin elegir: le entrega DIETAS FIT (el que cuesta 15)", c.nuevo().includes(entregaDe("dietas-fit")), c.nuevo().slice(0, 80));
    await c.borrar();
  }

  if (toca("guayaquil")) {
    console.log("\n· 🇪🇨 MASCOTAS (tu carril) — en el cobro, «quiero pagar con guayaquil»: manda TU cuadrito al Order bump");
    const t = datos().tableros.tienda_tmascotas.whatsapp;
    const intro = t.fichas.find((f) => f.id === "f-mvnpmsvw-ph32e");
    const botonPagar = (intro?.steps ?? []).flatMap((p) => p.buttons ?? []).find((b) => /pagar/i.test(b.label ?? ""));
    const ob = t.fichas.find((f) => f.id === "f-mvnpmsvw-fa2fp");
    const botonBasico = (ob?.variantes ?? []).flatMap((v) => (v.steps ?? []).flatMap((p) => p.buttons ?? [])).find((b) => /b[aá]sico/i.test(b.label ?? ""));
    const c = await cliente("tienda_tmascotas", "EC");
    await c.decir("hola", 45);
    // Su Intro de Ecuador ya no tiene botón de pagar: entra por sus cuadritos (VECINO, PICHINCHA…).
    if (botonPagar) await c.tocar(botonPagar.id, botonPagar.label, 40);
    else await c.decir("quiero pagar con pichincha", 40);
    const textoOb = c.nuevo();
    comprobar("«Quiero pagar»: tu Order bump", /PACK|ropa/i.test(textoOb), textoOb.slice(0, 80));
    await c.tocar(botonBasico.id, botonBasico.label, 40);
    await c.decir("quiero pagar con guayaquil", 45);
    comprobar("«quiero pagar con guayaquil»: tu cuadrito lo lleva otra vez al Order bump", /PACK|ropa/i.test(c.nuevo()), c.nuevo().slice(0, 80));
    await c.borrar();
  }

  if (toca("pago_otro") && R.pe15) {
    console.log("\n· 🇵🇪 MASCOTAS — eligió el pack, pagó 15 (el básico), se queda con el básico: entrega SIN cable");
    const c = await cliente("tienda_tmascotas", "PE");
    await c.decir("hola", 45);
    await c.tocar("mas_pe_b_pack", "Opción 2 (el pack)", 35);
    await c.decir("yape", 35);
    await c.foto(R.pe15, 70);
    comprobar("paga 15 por el pack: le pregunta si fue error o si prefiere el básico", /error|prefier|quedar/i.test(c.nuevo()), c.nuevo().slice(0, 100));
    await c.decir("me quedo con el basico", 60);
    comprobar("se queda con el básico: se le entrega COMIDA CASERA (sin cable, por su ruta)", /example\.com\/entrega/.test(c.nuevo()) && /COMIDA CASERA/i.test(c.nuevo()), c.nuevo().slice(0, 100));
    await c.borrar();
  }

  if (toca("galeria_apagada") && RAIZ.includes("scratchpad")) {
    console.log("\n· 🇵🇪 COCINA — «📷 Ofrecer imágenes» APAGADO: contesta por escrito y no ofrece fotos");
    const doc = YAML.parseDocument(readFileSync(ARCHIVO, "utf8"));
    const bib = doc.toJS().biblioteca_de_productos;
    // Los DOS de la doble oferta: con uno solo apagado, las fotos del otro se ofrecen (y está bien).
    const original = readFileSync(ARCHIVO, "utf8");
    for (const id of ["ptcocina_dietas", "ptcocina_pack"])
      doc.setIn(["biblioteca_de_productos", bib.findIndex((p) => p.id === id), "ofrecer_imagenes"], false);
    writeFileSync(ARCHIVO, doc.toString({ lineWidth: 0 }));
    await esperar(3000);
    try {
      const c = await cliente("tienda_tcocina", "PE");
      await c.decir("hola", 45);
      await c.decir("que trae el recetario dietas fit", 45);
      comprobar("contesta por escrito, sin fotos", imagenes(c.nuevo()) === 0 && c.nuevo().length > 60, c.nuevo().slice(0, 80));
      comprobar("y NO ofrece imágenes", !/im[aá]gen|foto/i.test(c.ultima()), c.ultima());
      await c.borrar();
    } finally {
      writeFileSync(ARCHIVO, original);
    }
  }
} catch (e) {
  fallos++;
  console.error("ERROR:", e);
}
console.log(fallos ? `\n${fallos} comprobación(es) mal.` : "\nTODO BIEN");
process.exit(fallos ? 1 : 0);
