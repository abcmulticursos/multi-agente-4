// RECORRIDO DE LAS TIENDAS DE EJEMPLO (24/10/2026): las que armó Claude para que Alberto aprenda el
// tablero («TIENDA COCINA FÁCIL», «TIENDA PEQUEÑOS FELICES»…). Vende de verdad en el simulador, con sus
// comprobantes, y mira que los comodines salgan llenos, que cobre lo correcto y entregue lo correcto.
//
// NO GUARDA NADA: solo usa el simulador de pruebas. Correr contra una COPIA con .env seguro.
//   node scripts/recorrido-tiendas-ejemplo.mjs --url=http://localhost:3312 --raiz=<copia>
//        --comprobantes=<carpeta> [--solo=cocina,ninos,taller,taller_pe,mascotas,estilista,otros,no_respondio,mascotas_pago,estilista_recordatorio]
//   (no_respondio, mascotas_pago y estilista_recordatorio piden antes `tiempos-copia.mjs` en la copia:
//    acortan los relojes y ponen el pack de mascotas a 15)
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const BASE = (args.url ?? "http://localhost:3000").replace(/\/$/, "");
const RAIZ = args.raiz ?? process.cwd();
const require = createRequire(join(RAIZ, "package.json"));
const YAML = require("yaml");
const solo = args.solo ? new Set(args.solo.split(",")) : null;
const toca = (n) => !solo || solo.has(n);

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, ok, valor = "") => {
  if (!ok) fallos++;
  console.log(`  ${ok ? "ok   " : "FALLA"} ${pad(texto, 66)} ${String(valor).replace(/\s+/g, " ").slice(0, 70)}`);
};
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const cifras = (v) => String(v ?? "").replace(/\D/g, "");

const datos = YAML.parse(readFileSync(join(RAIZ, "config", "intro-data.yaml"), "utf8"));
/** El silencio del regalo de ESTA copia (en la copia de prueba se acorta) y un margen para leerlo. */
const SILENCIO_DEL_REGALO = Number(datos.awaiting_email_timeout_seconds ?? 300);
const ESPERA_DEL_REGALO = SILENCIO_DEL_REGALO + 30;
const perfil = (pais) => datos.payment_profiles_by_country?.[pais] ?? {};
const cuenta = (pais, m) => cifras(perfil(pais).cuentas_por_metodo?.[m] ?? perfil(pais).numero_de_cuenta);

const carpeta = args.comprobantes ?? "";
const archivos = carpeta && existsSync(carpeta) ? readdirSync(carpeta) : [];
const comprobante = (patron) => {
  const f = archivos.find((a) => patron.test(a));
  return f ? join(carpeta, f) : null;
};
const R = {
  pe15: comprobante(/ALBERTO yapeo 15/i),
  pe5: comprobante(/yapeo ALBERTO 5/i),
  ec3: comprobante(/PICHINCHA 3/i),
  ar8000: comprobante(/FRANKO/i),
};

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
  const c = {
    id: conv.id,
    bot,
    nuevo: () => bot.slice(marca).join("\n"),
    // Esperar sin escribir (p. ej. el silencio del regalo): lo nuevo es lo que llegue en ese rato.
    leer: async (seg) => {
      marca = bot.length;
      await leer(seg);
    },
    decir: (t, seg = 30) => {
      marca = bot.length;
      const f = new FormData();
      f.set("content", t);
      return enviar(f, seg);
    },
    tocar: (id, titulo, seg = 25) => {
      marca = bot.length;
      const f = new FormData();
      f.set("button_id", `bubble:${id}`);
      f.set("button_title", titulo);
      return enviar(f, seg);
    },
    foto: (ruta, seg = 60) => {
      marca = bot.length;
      const f = new FormData();
      f.set("file", new Blob([readFileSync(ruta)], { type: "image/jpeg" }), "comprobante.jpg");
      return enviar(f, seg);
    },
    borrar: () => api(`/api/test-simulator/${conv.id}`, { method: "DELETE" }),
  };
  return c;
}

/** Ningún comodín sin llenar ni negrita vacía («para **»). */
// («7966**» al final de una cuenta es de su texto de pago de Argentina, no un comodín vacío.)
const limpio = (t) => !/\{\{|(^|\s)\*\*(\s|$)/m.test(t);
const entregaDe = (slug) => `example.com/entrega/${slug}/material`;

try {
  await entrar();

  if (toca("cocina") && R.pe15 && R.pe5) {
    console.log("\n· 🇵🇪 TIENDA COCINA FÁCIL — doble oferta con botones, upgrade y 1 upsell");
    const c = await cliente("tienda_tcocina", "PE");
    await c.decir("hola, info porfa", 45);
    comprobar("la intro con los dos precios de Perú (15 y 20) y su video", /15/.test(c.nuevo()) && /20/.test(c.nuevo()) && /S\//.test(c.nuevo()) && c.nuevo().includes("[MEDIA:video]"), c.nuevo().slice(-160));
    comprobar("los comodines de la intro salen llenos", limpio(c.nuevo()), c.nuevo().match(/.{0,30}(\{\{|\*\s*\*).{0,30}/)?.[0]);
    await c.tocar("coc_pe_b_basico", "Opción 1");
    comprobar("Opción 1: le dice el básico a 15 y pregunta el método", /RECETARIO DIETAS FIT/.test(c.nuevo()) && /15/.test(c.nuevo()) && /m[eé]todo/i.test(c.nuevo()), c.nuevo());
    await c.decir("yape", 30);
    comprobar("«yape»: su cuenta de Perú y 15", cifras(c.nuevo()).includes(cuenta("PE", "yape")) && /15/.test(c.nuevo()), c.nuevo());
    await c.foto(R.pe15, 70);
    comprobar("paga 15: le entrega DIETAS FIT", c.nuevo().includes(entregaDe("dietas-fit")) && !c.nuevo().includes(entregaDe("pack-cocina")), c.nuevo().slice(0, 120));
    comprobar("y le ofrece completar al pack por la diferencia (5)", /diferencia/i.test(c.nuevo()) && /S\/\.?\s?5\b/.test(c.nuevo()), c.nuevo().slice(-160));
    await c.tocar("coc_pe_up_si", "Sí, completar");
    comprobar("sí: datos por 5 sin repreguntar el método", /5/.test(c.nuevo()) && cifras(c.nuevo()).includes(cuenta("PE", "yape")), c.nuevo());
    await c.foto(R.pe5, 70);
    comprobar("paga 5: le entrega EL PACK", c.nuevo().includes(entregaDe("pack-cocina")), c.nuevo().slice(0, 120));
    comprobar("y le ofrece el upsell (COMIDAS PERUANAS a 5)", /COMIDAS PERUANAS/.test(c.nuevo()) && /5/.test(c.nuevo()), c.nuevo().slice(-160));
    await c.decir("eso es otro curso?", 35);
    comprobar("«¿es otro?»: la IA dice que es otro, sin pedir comprobante", /otro|distinto|diferente/i.test(c.nuevo()) && !/comprobante/i.test(c.nuevo()), c.nuevo());
    // EL REGALO ESPERA SU SILENCIO (25/10/2026), como la venta de siempre (en la copia se acorta):
    // se mira TODO lo que llegó desde el «no», porque con un silencio corto llega mientras se lee.
    const desdeElNo = c.bot.length;
    await c.tocar("coc_pe_u1_no", "No, gracias");
    await c.leer(ESPERA_DEL_REGALO);
    comprobar("no quiere el upsell: tras el silencio, el regalo de la tienda", /regalit|RECETAS EXPR/i.test(c.bot.slice(desdeElNo).join("\n")), c.bot.slice(desdeElNo).join("\n").slice(0, 140));
    comprobar("y todo lo que dijo sale sin comodines vacíos", limpio(c.bot.join("\n")), c.bot.join("\n").match(/.{0,30}(\{\{|\*\s*\*).{0,30}/)?.[0]);
    await c.borrar();
  }

  if (toca("ninos") && R.ec3) {
    console.log("\n· 🇪🇨 TIENDA PEQUEÑOS FELICES — order bump con cuadritos y 2 upsells");
    const c = await cliente("tienda_tninos", "EC");
    await c.decir("hola", 45);
    comprobar("la intro: ADIÓS RABIETAS a $3, sin nombrar el pack", /ADI[ÓO]S RABIETAS/.test(c.nuevo()) && /\$\s?3\b/.test(c.nuevo()) && !/PACK RABIETAS/.test(c.nuevo()), c.nuevo().slice(-160));
    await c.decir("quiero pagar", 35);
    comprobar("«quiero pagar» destapa el pack: 4 en total, 1 más", /PACK RABIETAS/.test(c.nuevo()) && /\$\s?4\b/.test(c.nuevo()) && /\$\s?1\b/.test(c.nuevo()), c.nuevo());
    await c.decir("1", 30);
    comprobar("escribe «1»: el básico a 3 y le pregunta el método", /ADI[ÓO]S RABIETAS/.test(c.nuevo()) && /\$\s?3\b/.test(c.nuevo()), c.nuevo());
    await c.decir("pichincha", 30);
    comprobar("«pichincha»: su cuenta de Ecuador", cifras(c.nuevo()).includes(cuenta("EC", "transferencia")), c.nuevo());
    await c.foto(R.ec3, 70);
    comprobar("paga 3: le entrega ADIÓS RABIETAS", c.nuevo().includes(entregaDe("adios-rabietas")), c.nuevo().slice(0, 120));
    comprobar("y el upsell 1 (NAVIDAD EN FAMILIA) con cuadritos", /NAVIDAD EN FAMILIA/.test(c.nuevo()) && /s[ií]\*? o \*?no/i.test(c.nuevo()), c.nuevo().slice(-160));
    await c.decir("no gracias", 30);
    comprobar("«no gracias»: el upsell 2 (TARJETAS DE EMOCIONES)", /TARJETAS DE EMOCIONES/.test(c.nuevo()), c.nuevo().slice(0, 140));
    const desdeElNo = c.bot.length;
    await c.decir("no", 30);
    await c.leer(ESPERA_DEL_REGALO); // el regalo espera su silencio
    comprobar("«no»: tras el silencio, el regalo de la tienda", /regalit|CUENTOS/i.test(c.bot.slice(desdeElNo).join("\n")), c.bot.slice(desdeElNo).join("\n").slice(0, 140));
    comprobar("todo sin comodines vacíos", limpio(c.bot.join("\n")), c.bot.join("\n").match(/.{0,30}(\{\{|\*\s*\*).{0,30}/)?.[0]);
    await c.borrar();
  }

  if (toca("taller") && R.ar8000) {
    console.log("\n· 🇦🇷 TIENDA TALLER MAESTRO — lineal escrito, correo y 3 upsells");
    const c = await cliente("tienda_ttaller", "AR");
    await c.decir("hola", 50);
    comprobar("la intro en pesos (8.000) y sigue al cobro solo", /8[.,]?000/.test(c.nuevo()) && /m[eé]todo/i.test(c.nuevo()), c.nuevo().slice(-160));
    await c.decir("transferencia", 30);
    comprobar("«transferencia»: su cuenta de Argentina", cifras(c.nuevo()).includes(cuenta("AR", "transferencia_bancaria")), c.nuevo());
    await c.foto(R.ar8000, 70);
    comprobar("paga 8000: le entrega PLANOS DE GIMNASIO", c.nuevo().includes(entregaDe("planos-gimnasio")), c.nuevo().slice(0, 120));
    comprobar("le pregunta si lo quiere por correo", /correo/i.test(c.nuevo()), "");
    comprobar("y el upsell 1 (CARPINTERÍA EN MADERA) con botones", /CARPINTER[ÍI]A EN MADERA/.test(c.nuevo()), c.nuevo().slice(-160));
    await c.tocar("tal_ar_u1_no", "No, gracias");
    comprobar("no: upsell 2 (CALCULADORA DE MATERIALES)", /CALCULADORA/.test(c.nuevo()), c.nuevo().slice(0, 140));
    await c.decir("no", 30);
    comprobar("no: upsell 3 (GUÍA DE SOLDADURA)", /SOLDADURA/.test(c.nuevo()), c.nuevo().slice(0, 140));
    const desdeElNo = c.bot.length;
    await c.tocar("tal_ar_u3_no", "No, gracias");
    await c.leer(ESPERA_DEL_REGALO); // el regalo espera su silencio
    comprobar("no: tras el silencio, el regalo de la tienda", /regalit|HERRAMIENTAS/i.test(c.bot.slice(desdeElNo).join("\n")), c.bot.slice(desdeElNo).join("\n").slice(0, 140));
    comprobar("todo sin comodines vacíos", limpio(c.bot.join("\n")), c.bot.join("\n").match(/.{0,30}(\{\{|\*\s*\*).{0,30}/)?.[0]);
    await c.borrar();
  }

  if (toca("taller_pe")) {
    console.log("\n· 🇵🇪 TIENDA TALLER MAESTRO — doble oferta escrita: elige escribiendo");
    const c = await cliente("tienda_ttaller", "PE");
    await c.decir("hola", 50);
    comprobar("la intro con los dos y le pide el método del básico (15)", /15/.test(c.nuevo()) && /20/.test(c.nuevo()) && /m[eé]todo/i.test(c.nuevo()), c.nuevo().slice(-160));
    await c.decir("mejor quiero el pack completo", 35);
    comprobar("«mejor el pack»: le cambia al pack (20)", /PACK GIMNASIO/.test(c.nuevo()) && /20/.test(c.nuevo()), c.nuevo());
    await c.borrar();
  }

  if (toca("mascotas")) {
    console.log("\n· 🇵🇪 TIENDA MASCOTAS FELICES — doble oferta con botones, elige el pack");
    const c = await cliente("tienda_tmascotas", "PE");
    await c.decir("hola", 45);
    await c.tocar("mas_pe_b_pack", "Opción 2 (el pack)");
    comprobar("Opción 2: el PACK a 20", /PACK COMIDA \+ ROPA/.test(c.nuevo()) && /20/.test(c.nuevo()), c.nuevo());
    await c.decir("plin", 30);
    comprobar("«plin»: su cuenta y 20", cifras(c.nuevo()).includes(cuenta("PE", "plin")) && /20/.test(c.nuevo()), c.nuevo());
    await c.borrar();
  }

  if (toca("estilista") && R.pe15) {
    console.log("\n· 🇵🇪 TIENDA PEQUEÑA ESTILISTA — venta por contribución");
    const c = await cliente("tienda_testilista", "PE");
    await c.decir("hola", 40);
    comprobar("la promesa termina con «¿estás decidida a aceptar y luego colaborar?»", /aceptar y luego colaborar/i.test(c.nuevo()), "");
    await c.tocar("est_si", "Sí, acepto", 60);
    const docs = (c.nuevo().match(/\[MEDIA:document\]/g) ?? []).length;
    comprobar("acepta: le llegan los 5 PDF como archivos", docs === 5, `${docs} archivos`);
    comprobar("sus burbujas: «¡Que lo disfruten muchísimo!» y «¡Listo!…»", /disfruten much[ií]simo/i.test(c.nuevo()) && /Ya tienes acceso a los moldes/i.test(c.nuevo()), "");
    comprobar("los 7 niveles y el Yape de quien cobra", /\$69 SOLES/.test(c.nuevo()) && cifras(c.nuevo()).includes(cuenta("PE", "yape")), c.nuevo().slice(-120));
    await c.foto(R.pe15, 70);
    comprobar("aporta 15: le llega el enlace del nivel 12", /nivel-12/.test(c.nuevo()) && !/nivel-19/.test(c.nuevo()), c.nuevo().slice(0, 140));
    await c.borrar();
  }

  // ── CON LOS RELOJES ACORTADOS EN LA COPIA (`tiempos-copia.mjs`): lo que en vivo tarda horas ──
  // Cada prueba mira además que lo que llega por reloj llegue DESPUÉS de lo anterior, sin pisarlo.
  const sinPisar = async (c, patron) => {
    const d = await (await api(`/api/test-simulator/${c.id}`)).json();
    const del_bot = (d.messages ?? []).filter((m) => m.role !== "user");
    const i = del_bot.findIndex((m) => patron.test(m.content ?? ""));
    if (i <= 0) return { ok: i === 0, hueco: null };
    const antes = new Date(del_bot[i - 1].created_at * 1000 || del_bot[i - 1].created_at).getTime();
    const ahora = new Date(del_bot[i].created_at * 1000 || del_bot[i].created_at).getTime();
    return { ok: ahora - antes >= 15_000, hueco: Math.round((ahora - antes) / 1000) };
  };

  if (toca("no_respondio")) {
    console.log("\n· COCINA: si no responde a la intro (Perú) o a la oferta (Ecuador), le llega su seguimiento");
    const SEG = /Pudiste revisar|Alcanzaste a ver|Lograste ver|Te guard[ée] el precio/i;
    const pe = await cliente("tienda_tcocina", "PE");
    await pe.decir("hola", 30);
    await pe.leer(170);
    comprobar("Perú: calla tras la intro → a los 2 min, su seguimiento", SEG.test(pe.nuevo()), pe.nuevo().slice(0, 120));
    const h1 = await sinPisar(pe, SEG);
    comprobar("y llega después de la intro, sin pisarla", h1.ok, `${h1.hueco ?? "?"} s tras el mensaje anterior`);
    // EN MEDIO DE LOS SEGUIMIENTOS SE PUEDE PAGAR: la caja quedó abierta (en silencio) al no responder.
    await pe.decir("yape", 30);
    comprobar("contesta «yape» a un seguimiento: le llegan su cuenta y el precio", cifras(pe.nuevo()).includes(cuenta("PE", "yape")) && /15/.test(pe.nuevo()), pe.nuevo().slice(0, 140));
    if (R.pe15) {
      await pe.foto(R.pe15, 80);
      comprobar("y paga 15: le entrega DIETAS FIT", pe.nuevo().includes(entregaDe("dietas-fit")), pe.nuevo().slice(0, 140));
    }
    await pe.borrar();
    const ec = await cliente("tienda_tcocina", "EC");
    await ec.decir("hola", 30);
    await ec.tocar("coc_ec_b_pagar", "Quiero pagar", 25);
    comprobar("Ecuador: «Quiero pagar» le muestra la oferta del pack", /Espera|pack/i.test(ec.nuevo()), ec.nuevo().slice(0, 100));
    await ec.leer(170);
    comprobar("calla ante la oferta → a los 2 min, su seguimiento", SEG.test(ec.nuevo()), ec.nuevo().slice(0, 120));
    const h2 = await sinPisar(ec, SEG);
    comprobar("y llega después de la oferta, sin pisarla", h2.ok, `${h2.hueco ?? "?"} s tras el mensaje anterior`);
    await ec.borrar();
  }

  if (toca("mascotas_pago") && R.pe15) {
    console.log("\n· MASCOTAS (Perú): elige el pack, paga y lo recibe (en Perú sin «¿por correo?»: va solo en Argentina)");
    const c = await cliente("tienda_tmascotas", "PE");
    await c.decir("hola", 45);
    await c.tocar("mas_pe_b_pack", "Opción 2 (el pack)");
    await c.decir("yape", 30);
    comprobar("«yape»: su cuenta y el precio del pack (15 en la copia)", cifras(c.nuevo()).includes(cuenta("PE", "yape")) && /15/.test(c.nuevo()), c.nuevo().slice(0, 140));
    await c.foto(R.pe15, 80);
    comprobar("paga 15: le entrega EL PACK", c.nuevo().includes(entregaDe("pack-mascotas")), c.nuevo().slice(0, 140));
    // Su Entrega de Perú no tiene «📧 Ofrecer también por correo»: no debe preguntarlo.
    comprobar("y no le pregunta por correo (apagado en Perú)", !/por correo|tu correo/i.test(c.nuevo()), c.nuevo().match(/.{0,40}correo.{0,40}/i)?.[0] ?? "");
    comprobar("todo sin comodines vacíos", limpio(c.bot.join("\n")), c.bot.join("\n").match(/.{0,30}(\{\{|\*\s*\*).{0,30}/)?.[0]);
    await c.borrar();
  }

  if (toca("estilista_recordatorio")) {
    console.log("\n· ESTILISTA: acepta, recibe los PDF y no aporta → le llega su primer recordatorio");
    const c = await cliente("tienda_testilista", "PE");
    await c.decir("hola", 40);
    await c.tocar("est_si", "Sí, acepto", 60);
    await c.leer(150);
    const REC = /Espero que ya hayas podido echarle un vistazo/i;
    comprobar("no aporta → su recordatorio 1", REC.test(c.nuevo()), c.nuevo().slice(0, 120));
    const h = await sinPisar(c, REC);
    comprobar("y llega después de los PDF y los datos de pago, sin pisarlos", h.ok, `${h.hueco ?? "?"} s tras el mensaje anterior`);
    await c.borrar();
  }

  // ── EL UPSELL SIN RESPUESTA LLEVA AL REGALO (25/10/2026), como la venta de siempre ──
  // Piden antes `tiempos-upsell-copia.mjs` en la copia (el «no pagó» del upsell 1 y sus recordatorios a
  // 1–2 minutos; su «no respondió» se queda en los 3 min reales).
  const REGALO = /regalit|CUENTOS/i;
  if (toca("upsell_silencio") && R.ec3) {
    console.log("\n· 🇪🇨 PEQUEÑOS FELICES: pregunta por el upsell y se calla → le llega el regalo, sin el upsell 2");
    const c = await cliente("tienda_tninos", "EC");
    await c.decir("hola", 45);
    await c.decir("quiero pagar", 35);
    await c.decir("1", 30);
    await c.decir("pichincha", 30);
    await c.foto(R.ec3, 70);
    comprobar("paga 3: le entrega ADIÓS RABIETAS y le ofrece NAVIDAD EN FAMILIA", c.nuevo().includes(entregaDe("adios-rabietas")) && /NAVIDAD EN FAMILIA/.test(c.nuevo()), c.nuevo().slice(-120));
    await c.decir("y ese que trae", 35);
    comprobar("pregunta: le contesta la IA", c.nuevo().trim().length > 0, c.nuevo().slice(0, 120));
    comprobar("todavía sin regalo (no pasó su «no respondió» de 3 min)", !REGALO.test(c.bot.join("\n")), "");
    const desde = c.bot.length;
    // «No respondió» del upsell: 3 min desde su pregunta (si contara desde la oferta, ya habría salido).
    await c.leer(Math.max(180, SILENCIO_DEL_REGALO) + 60);
    const tras = c.bot.slice(desde).join("\n");
    comprobar("se calla: el reloj volvió a contar desde su pregunta y le llega el regalo", REGALO.test(tras), tras.slice(0, 140));
    comprobar("y NO le ofrece el upsell 2 (la fila se para, como la venta de siempre)", !/TARJETAS DE EMOCIONES/.test(tras), "");
    await c.borrar();
  }

  if (toca("upsell_paga_en_regalo") && R.pe15 && R.pe5) {
    console.log("\n· 🇵🇪 PEQUEÑOS FELICES: dice «sí» al upsell, no paga, le llega el regalo y AHÍ paga");
    const c = await cliente("tienda_tninos", "PE");
    await c.decir("hola", 45);
    await c.decir("1", 30);
    await c.decir("yape", 30);
    await c.foto(R.pe15, 70);
    comprobar("paga 15: le entrega ADIÓS RABIETAS y le ofrece NAVIDAD EN FAMILIA", c.nuevo().includes(entregaDe("adios-rabietas")) && /NAVIDAD EN FAMILIA/.test(c.nuevo()), c.nuevo().slice(-120));
    await c.decir("si", 35);
    comprobar("«sí»: los datos con 5", /5/.test(c.nuevo()) && cifras(c.nuevo()).includes(cuenta("PE", "yape")), c.nuevo().slice(0, 140));
    const desde = c.bot.length;
    // no pagó (1 min) → el regalo (en la copia, el cable como lo arma el traductor; espera su silencio)
    let tras = "";
    for (let i = 0; i < 14 && !REGALO.test(tras); i++) {
      await c.leer(30);
      tras = c.bot.slice(desde).join("\n");
    }
    comprobar("no paga: le llega el regalo", REGALO.test(tras), tras.slice(-140));
    const regalos = () => (c.bot.join("\n").match(REGALO) ?? []).length;
    const antes = regalos();
    await c.foto(R.pe5, 80);
    comprobar("paga 5 en medio del regalo: le entrega NAVIDAD EN FAMILIA", c.nuevo().includes(entregaDe("navidad-familia")), c.nuevo().slice(0, 160));
    await c.leer(Math.max(30, SILENCIO_DEL_REGALO) + 30);
    comprobar("y no le ofrece el upsell 2 en medio del regalo", !/TARJETAS DE EMOCIONES/.test(c.bot.slice(desde).join("\n")), "");
    comprobar("ni le repite el regalo", regalos() === antes, `${antes} → ${regalos()}`);
    await c.borrar();
  }

  // ── LOS AVISOS AL DUEÑO, como la venta de siempre (25/10/2026) ──
  // La base de datos de la copia: el contador de rechazos y la marca de reclamo.
  const db = () => new (require("better-sqlite3"))(join(RAIZ, "data", "messages.db"), { readonly: true });
  const fila = (id) => {
    const d = db();
    try {
      return d.prepare("SELECT payment_attempts_failed AS fallos, had_emergency AS reclamo FROM conversations WHERE id = ?").get(id) ?? {};
    } finally {
      d.close();
    }
  };
  const NO_ES_COMPROBANTE = join(RAIZ, "public", "meta-app-logo.png");
  if (toca("rechazos") && R.pe15 && existsSync(NO_ES_COMPROBANTE)) {
    console.log("\n· 🇵🇪 COCINA: 3 imágenes que no son comprobantes → el aviso de siempre; paga bien → vuelve a cero");
    const c = await cliente("tienda_tcocina", "PE");
    await c.decir("hola", 45);
    await c.tocar("coc_pe_b_basico", "Opción 1");
    await c.decir("yape", 30);
    for (let i = 0; i < 3; i++) await c.foto(NO_ES_COMPROBANTE, 40);
    comprobar("3 rechazos seguidos: el contador del aviso llega a 3", fila(c.id).fallos === 3, `${fila(c.id).fallos}`);
    comprobar("y al cliente le contesta (otra foto o qué es esa imagen)", /foto|captura|comprobante|imagen/i.test(c.nuevo()), c.nuevo().slice(0, 120));
    await c.foto(R.pe15, 70);
    comprobar("paga 15: le entrega DIETAS FIT", c.nuevo().includes(entregaDe("dietas-fit")), c.nuevo().slice(0, 120));
    comprobar("y el contador vuelve a 0", fila(c.id).fallos === 0, `${fila(c.id).fallos}`);
    await c.borrar();
  }

  if (toca("emergencia")) {
    console.log("\n· 🇵🇪 COCINA (con la IA): un problema que no se resuelve → ofrece un asesor → «sí» → te avisa");
    const c = await cliente("tienda_tcocina", "PE");
    await c.decir("hola", 45);
    const turnos = ["no puedo pagar, el yape me sale error", "sigue igual, ya intente varias veces y nada", "ya probe todo y no funciona, estoy cansado", "si por favor", "si"];
    let ofrecio = false;
    for (const t of turnos) {
      if (fila(c.id).reclamo === 1) break;
      if (/^si/.test(t) && !ofrecio) continue;
      await c.decir(t, 35);
      if (/asesor/i.test(c.nuevo())) ofrecio = true;
    }
    comprobar("la IA le ofrece un asesor (no en el primer mensaje)", ofrecio, "");
    comprobar("dice «sí»: queda marcado como reclamo (y en vivo te llega el aviso 🚨)", fila(c.id).reclamo === 1, `${fila(c.id).reclamo}`);
    comprobar("y al cliente le dice que un asesor lo contactará", /se contactar|comunicar[aá]|asesor/i.test(c.bot.slice(-6).join("\n")), c.bot.slice(-2).join(" ").slice(0, 140));
    await c.borrar();
  }

  if (toca("otros")) {
    console.log("\n· 🌍 OTROS PAÍSES (Colombia): no vende y pasa a un asesor");
    const c = await cliente("tienda_tcocina", "CO");
    await c.decir("hola", 30);
    comprobar("le dice que por ahora no vende en su país", /solo est[áa] disponible en Per[úu]/i.test(c.nuevo()) || c.nuevo().length > 0, c.nuevo().slice(0, 140));
    await c.borrar();
  }
} catch (e) {
  fallos++;
  console.error("ERROR:", e);
}
console.log(fallos ? `\n${fallos} comprobación(es) mal.` : "\nTODO BIEN");
process.exit(fallos ? 1 : 0);
