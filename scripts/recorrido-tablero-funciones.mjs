// RECORRIDO DE LAS FUNCIONES DEL TABLERO QUE NO SE HABÍAN PROBADO (24/10/2026). Lo pidió Alberto: «no
// has hecho una prueba completa… fíjate cuántas funciones has ignorado». Cada escenario siembra su
// propio tablero en la tienda de prueba, vende en el simulador con sus comprobantes y devuelve el
// contenido tal cual al terminar.
//
// NO GUARDA NADA DE ÉL: escribe en el config de una COPIA y lo devuelve idéntico. Correr contra una copia.
//   node scripts/recorrido-tablero-funciones.mjs --url=http://localhost:3312 --raiz=<copia> --comprobantes=<carpeta>
//        [--solo=oferta,congelado,incompleto,titular,compro,anuncio,versiones_anuncio,inicio,apagada,variantes,tuberia,traducida,regalo_anuncio,de_palabra]
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const BASE = (args.url ?? "http://localhost:3000").replace(/\/$/, "");
const RAIZ = args.raiz ?? process.cwd();
const ARCHIVO = join(RAIZ, "config", "intro-data.yaml");
const require = createRequire(join(RAIZ, "package.json"));
const YAML = require("yaml");
const Database = require("better-sqlite3");
const solo = args.solo ? new Set(args.solo.split(",")) : null;
const toca = (n) => !solo || solo.has(n);

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, ok, valor = "") => {
  if (!ok) fallos++;
  console.log(`  ${ok ? "ok   " : "FALLA"} ${pad(texto, 66)} ${String(valor).replace(/\s+/g, " ").slice(0, 80)}`);
};
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// ── SU CONTENIDO (se devuelve idéntico) ───────────────────────────────────────
const original = readFileSync(ARCHIVO, "utf8");
const huella = createHash("sha256").update(original).digest("hex");
const datos = YAML.parse(original);
const tienda = (datos.tiendas ?? []).find((t) => /GRAFISMO/i.test(t.nombre ?? "")) ?? datos.tiendas[0];

const carpeta = args.comprobantes ?? "";
const archivos = carpeta && existsSync(carpeta) ? readdirSync(carpeta) : [];
const comprobante = (patron) => {
  const f = archivos.find((a) => patron.test(a));
  return f ? join(carpeta, f) : null;
};
const R = {
  pe15: comprobante(/ALBERTO yapeo 15/i),
  pe5: comprobante(/yapeo ALBERTO 5/i),
  pe9: comprobante(/yapeo ALBERTO 9/i),
  melissa10: comprobante(/MELISSA 10/i),
};

// LOS PRODUCTOS DE PRUEBA: solo en esta copia y mientras dura la prueba.
const producto = (id, nombre, pe, oferta, slug) => ({
  id, name: nombre, aliases: [], price_soles: 0,
  delivery: [{ type: "text", body_variants: [`✅ Entrega de *{{PRODUCTO_ENTREGADO}}*\nhttps://example.com/entrega/${slug}`], delay_after_sec: 1 }],
  image_gallery: [], course_content: `${nombre}: material digital de prueba.`, etiqueta: "",
  discount_price_soles: 0, market_price: 0,
  precios_por_pais: { PE: { price_soles: pe, discount_price_soles: oferta, market_price: pe * 2 } },
});
const PA = (pe, oferta = pe) => producto("pfprueba_a", "PRODUCTO PRUEBA A", pe, oferta, "funciones-a");
const PB = producto("pfprueba_b", "PRODUCTO PRUEBA B", 9, 9, "funciones-b");

const texto = (t, extra = {}) => ({ type: "text", body_variants: [t], delay_after_sec: 1, ...extra });
const boton = (id, label) => ({ id, label, action: "send_steps" });
const cables = (lista) => lista.map(([de, salida, a], i) => ({ id: `c${i}`, de, salida, a }));
const cobro = (id, prod, extra = {}, cobroExtra = {}) => ({
  id, tipo: "cobro", x: 0, y: 0,
  cobro: { modo: "producto", producto_id: prod, acepta: [], precio: "etapa", metodos: true, ...cobroExtra },
  steps: [texto("COBRO: {{PRODUCTO}} cuesta {{PRECIO_COMPLETO}}. ¿Con qué método pagas?")],
  ...extra,
});

/** Siembra un tablero en la tienda de prueba y los productos de prueba (con el precio de A que toque). */
function sembrar(tablero, precioA = 20, ofertaA = precioA) {
  const doc = YAML.parseDocument(readFileSync(ARCHIVO, "utf8"));
  const js = doc.toJS();
  const biblio = (js.biblioteca_de_productos ?? []).filter((p) => !String(p.id).startsWith("pfprueba_"));
  doc.set("biblioteca_de_productos", [...biblio, PA(precioA, ofertaA), PB]);
  doc.set("tableros", { ...(js.tableros ?? {}), [tienda.id]: { whatsapp: { encendido: true, ...tablero } } });
  writeFileSync(ARCHIVO, doc.toString({ lineWidth: 0 }));
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
async function cliente(pais = "PE", { anuncio } = {}) {
  const conv = await (
    await api("/api/test-simulator", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channel: "whatsapp", tienda: tienda.id, country: pais }) })
  ).json();
  if (anuncio) {
    // EL CLIENTE QUE VINO DE UN ANUNCIO: el simulador no lo trae, así que se anota en la copia.
    const db = new Database(join(RAIZ, "data", "messages.db"));
    db.prepare("UPDATE conversations SET ad_source_id = ? WHERE id = ?").run(anuncio, conv.id);
    db.close();
  }
  let vistos = 0;
  const bot = [];
  const leer = async (seg) => {
    const fin = Date.now() + seg * 1000;
    while (Date.now() < fin) {
      const d = await (await api(`/api/test-simulator/${conv.id}`)).json();
      for (const m of (d.messages ?? []).slice(vistos)) if (m.role !== "user") bot.push(`${m.media_type ? `[MEDIA:${m.media_type}] ` : ""}${m.content ?? ""}`);
      vistos = (d.messages ?? []).length || vistos;
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
    todo: () => bot.join("\n"),
    leer: async (seg) => { marca = bot.length; await leer(seg); },
    decir: (t, seg = 30) => { marca = bot.length; const f = new FormData(); f.set("content", t); return enviar(f, seg); },
    tocar: (id, titulo, seg = 25) => { marca = bot.length; const f = new FormData(); f.set("button_id", `bubble:${id}`); f.set("button_title", titulo); return enviar(f, seg); },
    foto: (ruta, seg = 60) => { marca = bot.length; const f = new FormData(); f.set("file", new Blob([readFileSync(ruta)], { type: "image/jpeg" }), "comprobante.jpg"); return enviar(f, seg); },
    borrar: () => api(`/api/test-simulator/${conv.id}`, { method: "DELETE" }),
  };
  return c;
}
const entregaA = "example.com/entrega/funciones-a";
const entregaB = "example.com/entrega/funciones-b";

try {
  await entrar();
  console.log(`RECORRIDO DE LAS FUNCIONES DEL TABLERO · tienda «${tienda.nombre}»`);

  // 1. EL SEGUIMIENTO QUE ACTIVA LA OFERTA
  if (toca("oferta") && R.pe15) {
    console.log("\n· 1. Seguimiento que activa el precio de oferta (A: 20 → oferta 15)");
    sembrar({
      fichas: [
        { id: "i", tipo: "inicio", pais: "PE", x: 0, y: 0 },
        cobro("cob", "pfprueba_a", { sin_pago_min: 1 }),
        { id: "segs", tipo: "seguimientos", x: 0, y: 0, presenta: ["pfprueba_a"], seguimientos: [{ id: "s1", minutos: 2, activa_oferta: true, variantes: [{ id: "v", peso: 1, steps: [texto("OFERTA: {{PRODUCTO}} ahora a {{PRECIO_COMPLETO}}")] }] }] },
        { id: "ent", tipo: "entregar", x: 0, y: 0, producto_id: "pfprueba_a" },
      ],
      cables: cables([["i", "siguiente", "cob"], ["cob", "sin_pago", "segs"], ["cob", "pagado", "ent"]]),
    }, 20, 15);
    await esperar(3000);
    const c = await cliente();
    await c.decir("hola", 25);
    comprobar("antes del seguimiento: le cobra 20", /COBRO:.*20/.test(c.nuevo()), c.nuevo());
    await c.decir("yape", 25);
    await c.leer(170);
    comprobar("a los 2 min sale el seguimiento con la oferta: 15", /OFERTA:.*15/.test(c.nuevo()), c.nuevo());
    await c.foto(R.pe15, 70);
    comprobar("paga 15 (el de oferta): le entrega A", c.nuevo().includes(entregaA), c.nuevo());
    await c.borrar();
  }

  // 2 y 3. PRECIO CONGELADO y «NO ME LLEGÓ»
  if (toca("congelado") && R.pe15) {
    console.log("\n· 2. Precio congelado: le dijeron 15 y él cambia el precio a 18  ·  3. «No me llegó lo que compré»");
    const T = {
      fichas: [
        { id: "i", tipo: "inicio", pais: "PE", x: 0, y: 0 },
        cobro("cob", "pfprueba_a", {}, { precio: "normal" }),
        { id: "ent", tipo: "entregar", x: 0, y: 0, producto_id: "pfprueba_a" },
      ],
      cables: cables([["i", "siguiente", "cob"], ["cob", "pagado", "ent"]]),
    };
    sembrar(T, 15);
    await esperar(3000);
    const c = await cliente();
    await c.decir("hola", 25);
    comprobar("le cobra 15", /COBRO:.*15/.test(c.nuevo()), c.nuevo());
    sembrar(T, 18); // ÉL CAMBIA EL PRECIO con el cliente dentro
    await esperar(4000);
    const otro = await cliente();
    await otro.decir("hola", 25);
    comprobar("un cliente nuevo ya ve el precio nuevo: 18", /COBRO:.*18/.test(otro.nuevo()), otro.nuevo());
    await otro.borrar();
    await c.decir("yape", 25);
    comprobar("al que ya estaba le siguen saliendo los datos por 15", /15/.test(c.nuevo()) && !/18/.test(c.nuevo()), c.nuevo());
    await c.foto(R.pe15, 70);
    comprobar("paga 15: se le entrega (no le pide la diferencia)", c.nuevo().includes(entregaA), c.nuevo());
    await c.decir("hola, no me ha llegado lo que compré", 40);
    comprobar("«no me llegó»: le reenvía la entrega de A", c.nuevo().includes(entregaA), c.nuevo());
    comprobar("y no le pide pagar de nuevo", !/comprobante|yape|pagar/i.test(c.nuevo().replace(entregaA, "")), c.nuevo());
    await c.borrar();
  }

  // 4 y 5. PAGO INCOMPLETO y COMPROBANTE REPETIDO
  if (toca("incompleto") && R.pe15 && R.pe5) {
    console.log("\n· 4. Pago incompleto (A: 20, paga 15 y luego 5)  ·  5. El mismo comprobante dos veces");
    sembrar({
      fichas: [
        { id: "i", tipo: "inicio", pais: "PE", x: 0, y: 0 },
        cobro("cob", "pfprueba_a", {}, { precio: "normal" }),
        { id: "ent", tipo: "entregar", x: 0, y: 0, producto_id: "pfprueba_a" },
      ],
      cables: cables([["i", "siguiente", "cob"], ["cob", "pagado", "ent"]]),
    }, 20);
    await esperar(3000);
    const c = await cliente();
    await c.decir("hola", 25);
    await c.decir("yape", 25);
    await c.foto(R.pe15, 70);
    comprobar("paga 15 de 20: no le entrega y le dice que falta", !c.nuevo().includes(entregaA) && /falta|no alcanza|completar|5/i.test(c.nuevo()), c.nuevo());
    await c.foto(R.pe15, 70);
    comprobar("manda EL MISMO de 15 otra vez: no lo cuenta ni le entrega", !c.nuevo().includes(entregaA), c.nuevo());
    await c.foto(R.pe5, 70);
    comprobar("manda 5: suma 20 y le entrega", c.nuevo().includes(entregaA), c.nuevo());
    await c.borrar();
  }

  // 6. COMPROBANTE A NOMBRE DE OTRA PERSONA
  if (toca("titular") && R.melissa10) {
    console.log("\n· 6. Comprobante a nombre de otra persona (Melissa, 10)");
    sembrar({
      fichas: [
        { id: "i", tipo: "inicio", pais: "PE", x: 0, y: 0 },
        cobro("cob", "pfprueba_a", {}, { precio: "normal" }),
        { id: "ent", tipo: "entregar", x: 0, y: 0, producto_id: "pfprueba_a" },
      ],
      cables: cables([["i", "siguiente", "cob"], ["cob", "pagado", "ent"]]),
    }, 10);
    await esperar(3000);
    const c = await cliente();
    await c.decir("hola", 25);
    await c.decir("yape", 25);
    await c.foto(R.melissa10, 70);
    comprobar("no le entrega", !c.nuevo().includes(entregaA), c.nuevo());
    comprobar("y le dice que el pago no es a la cuenta correcta", /nombre|titular|cuenta|destinatari|otra persona/i.test(c.nuevo()), c.nuevo());
    await c.borrar();
  }

  // 8a. CONDICIÓN «YA COMPRÓ»
  if (toca("compro") && R.pe9) {
    console.log("\n· 8. Condición «ya compró B» (B: 9)");
    sembrar({
      fichas: [
        { id: "i", tipo: "inicio", pais: "PE", x: 0, y: 0 },
        { id: "cond", tipo: "condicion", x: 0, y: 0, condicion: { tipo: "compro", producto_id: "pfprueba_b" } },
        { id: "no", tipo: "mensaje", x: 0, y: 0, steps: [texto("NO-COMPRO-AUN", { buttons: [boton("comprar", "Comprar B")] })] },
        cobro("cob", "pfprueba_b", {}, { precio: "normal" }),
        { id: "ent", tipo: "entregar", x: 0, y: 0, producto_id: "pfprueba_b" },
        { id: "si", tipo: "mensaje", x: 0, y: 0, steps: [texto("YA-COMPRO-B")] },
      ],
      cables: cables([["i", "siguiente", "cond"], ["cond", "no", "no"], ["no", "btn:comprar", "cob"], ["cob", "pagado", "ent"], ["ent", "siguiente", "cond"], ["cond", "si", "si"]]),
    });
    await esperar(3000);
    const c = await cliente();
    await c.decir("hola", 25);
    comprobar("cliente nuevo: sale por «no compró»", c.nuevo().includes("NO-COMPRO-AUN") && !c.nuevo().includes("YA-COMPRO-B"), c.nuevo());
    await c.tocar("comprar", "Comprar B");
    await c.decir("yape", 25);
    await c.foto(R.pe9, 70);
    comprobar("compra B: entrega y la condición ahora dice «ya compró»", c.nuevo().includes(entregaB) && c.nuevo().includes("YA-COMPRO-B"), c.nuevo());
    await c.borrar();
  }

  // 8b. CONDICIÓN «VINO DE UN ANUNCIO»
  if (toca("anuncio")) {
    console.log("\n· 8. Condición «vino de un anuncio»");
    sembrar({
      fichas: [
        { id: "i", tipo: "inicio", pais: "PE", x: 0, y: 0 },
        { id: "cond", tipo: "condicion", x: 0, y: 0, condicion: { tipo: "anuncio", anuncios: [] } },
        { id: "si", tipo: "mensaje", x: 0, y: 0, steps: [texto("VINO-DE-ANUNCIO")] },
        { id: "no", tipo: "mensaje", x: 0, y: 0, steps: [texto("VINO-ORGANICO")] },
      ],
      cables: cables([["i", "siguiente", "cond"], ["cond", "si", "si"], ["cond", "no", "no"]]),
    });
    await esperar(3000);
    const a = await cliente();
    await a.decir("hola", 20);
    comprobar("sin anuncio: sale por «no»", a.nuevo().includes("VINO-ORGANICO"), a.nuevo());
    await a.borrar();
    const b = await cliente("PE", { anuncio: "120200000000000001" });
    await b.decir("hola", 20);
    comprobar("con anuncio: sale por «sí»", b.nuevo().includes("VINO-DE-ANUNCIO"), b.nuevo());
    await b.borrar();
  }

  // 8c. LAS VERSIONES CON ETIQUETA DE ANUNCIO (24/10/2026): la misma regla que la venta de siempre.
  // Seguimiento: el del anuncio para quien vino de él; los demás, solo entre las SIN etiqueta.
  // Intro de order bump: la del anuncio para él; los demás, entre TODAS.
  if (toca("versiones_anuncio")) {
    console.log("\n· 8c. Versiones con etiqueta de anuncio (seguimiento e intro de order bump)");
    const ID_DEL_ANUNCIO = "120200000000000077";
    const conRegistro = () => {
      // El registro de anuncios de la copia lleva uno de prueba mientras dura el escenario.
      const doc = YAML.parseDocument(readFileSync(ARCHIVO, "utf8"));
      const reg = (doc.toJS().ad_registry ?? []).filter((a) => a.key !== "ad_prueba_tablero");
      doc.set("ad_registry", [...reg, { key: "ad_prueba_tablero", name: "AD PRUEBA TABLERO", ids: [ID_DEL_ANUNCIO], enabled: true }]);
      writeFileSync(ARCHIVO, doc.toString({ lineWidth: 0 }));
    };
    sembrar({
      fichas: [
        { id: "i", tipo: "inicio", pais: "PE", x: 0, y: 0 },
        {
          id: "segs", tipo: "seguimientos", x: 0, y: 0,
          seguimientos: [{
            id: "s1", minutos: 1,
            variantes: [
              { id: "va", peso: 1, anuncios: ["ad_prueba_tablero"], steps: [texto("SEG-DEL-ANUNCIO")] },
              { id: "vl", peso: 1, steps: [texto("SEG-LIBRE")] },
            ],
          }],
        },
      ],
      cables: cables([["i", "siguiente", "segs"]]),
    });
    conRegistro();
    await esperar(3000);
    for (let vuelta = 0; vuelta < 2; vuelta++) {
      const conAd = await cliente("PE", { anuncio: ID_DEL_ANUNCIO });
      const sinAd = await cliente("PE");
      await conAd.decir("hola", 2);
      await sinAd.decir("hola", 2);
      await Promise.all([conAd.leer(110), sinAd.leer(110)]);
      comprobar(`seguimiento (vuelta ${vuelta + 1}): el del anuncio recibe SU versión`, conAd.todo().includes("SEG-DEL-ANUNCIO") && !conAd.todo().includes("SEG-LIBRE"), conAd.todo());
      comprobar(`seguimiento (vuelta ${vuelta + 1}): el que no vino del anuncio, nunca la del anuncio`, sinAd.todo().includes("SEG-LIBRE") && !sinAd.todo().includes("SEG-DEL-ANUNCIO"), sinAd.todo());
      await conAd.borrar();
      await sinAd.borrar();
    }
    sembrar({
      fichas: [
        { id: "i", tipo: "inicio", pais: "PE", x: 0, y: 0 },
        {
          id: "ob", tipo: "intro_ob", x: 0, y: 0,
          variantes: [
            { id: "oa", peso: 1, anuncios: ["ad_prueba_tablero"], steps: [texto("OB-DEL-ANUNCIO")] },
            { id: "ol", peso: 1, steps: [texto("OB-LIBRE")] },
          ],
        },
      ],
      cables: cables([["i", "siguiente", "ob"]]),
    });
    conRegistro();
    await esperar(3000);
    for (let vuelta = 0; vuelta < 3; vuelta++) {
      const conAd = await cliente("PE", { anuncio: ID_DEL_ANUNCIO });
      await conAd.decir("hola", 20);
      comprobar(`intro de order bump (vuelta ${vuelta + 1}): el del anuncio recibe SU versión`, conAd.todo().includes("OB-DEL-ANUNCIO") && !conAd.todo().includes("OB-LIBRE"), conAd.todo());
      await conAd.borrar();
    }
    const vistas = new Set();
    for (let vuelta = 0; vuelta < 8 && vistas.size < 2; vuelta++) {
      const sinAd = await cliente("PE");
      await sinAd.decir("hola", 15);
      if (sinAd.todo().includes("OB-DEL-ANUNCIO")) vistas.add("anuncio");
      if (sinAd.todo().includes("OB-LIBRE")) vistas.add("libre");
      await sinAd.borrar();
    }
    comprobar("intro de order bump: a los demás se les sortea entre TODAS (salieron las dos)", vistas.size === 2, [...vistas].join(", "));
  }

  // 9. INICIO «VENDER EN ESTE PAÍS» APAGADO y «EN REVISIÓN»
  if (toca("inicio")) {
    console.log("\n· 9. Inicio con «vender en este país» apagado y «en revisión»");
    for (const [marca, extra] of [["sin_venta", { sin_venta: true }], ["en_revision", { en_revision: true }]]) {
      sembrar({
        fichas: [
          { id: "i", tipo: "inicio", pais: "PE", x: 0, y: 0, ...extra },
          { id: "m", tipo: "mensaje", x: 0, y: 0, steps: [texto("MARCA-DEL-TABLERO")] },
        ],
        cables: cables([["i", "siguiente", "m"]]),
      });
      await esperar(3000);
      const c = await cliente();
      await c.decir("hola", 30);
      comprobar(`«${marca}»: el cliente no entra al tablero (le atiende la venta automática)`, !c.nuevo().includes("MARCA-DEL-TABLERO") && c.nuevo().length > 0, c.nuevo().slice(0, 80));
      await c.borrar();
    }
  }

  // 10. FICHA APAGADA
  if (toca("apagada")) {
    console.log("\n· 10. Ficha apagada: no manda nada y el cliente sigue por su «→»");
    sembrar({
      fichas: [
        { id: "i", tipo: "inicio", pais: "PE", x: 0, y: 0 },
        { id: "m1", tipo: "mensaje", x: 0, y: 0, apagada: true, steps: [texto("NO-DEBE-SALIR")] },
        { id: "m2", tipo: "mensaje", x: 0, y: 0, steps: [texto("SI-SALE")] },
      ],
      cables: cables([["i", "siguiente", "m1"], ["m1", "siguiente", "m2"]]),
    });
    await esperar(3000);
    const c = await cliente();
    await c.decir("hola", 20);
    comprobar("la apagada no sale y la siguiente sí", !c.nuevo().includes("NO-DEBE-SALIR") && c.nuevo().includes("SI-SALE"), c.nuevo());
    await c.borrar();
  }

  // 11. VERSIONES CON PESO
  if (toca("variantes")) {
    console.log("\n· 11. Versiones de una intro con peso (A peso 1, B peso 0 = apagada)");
    sembrar({
      fichas: [
        { id: "i", tipo: "inicio", pais: "PE", x: 0, y: 0 },
        { id: "ob", tipo: "intro_ob", x: 0, y: 0, variantes: [{ id: "va", peso: 1, steps: [texto("VERSION-A")] }, { id: "vb", peso: 0, steps: [texto("VERSION-B")] }] },
      ],
      cables: cables([["i", "siguiente", "ob"]]),
    });
    await esperar(3000);
    let a = 0, b = 0;
    for (let k = 0; k < 3; k++) {
      const c = await cliente();
      await c.decir("hola", 15);
      if (c.nuevo().includes("VERSION-A")) a++;
      if (c.nuevo().includes("VERSION-B")) b++;
      await c.borrar();
    }
    comprobar("3 clientes: los 3 reciben la A y ninguno la B (peso 0)", a === 3 && b === 0, `A=${a} B=${b}`);
  }

  // 13. CAMBIAR DE TUBERÍA CON UN CLIENTE DENTRO
  if (toca("tuberia")) {
    console.log("\n· 13. Mover el cable del Inicio a otra tubería con un cliente a medio camino");
    const fichas = [
      { id: "i", tipo: "inicio", pais: "PE", x: 0, y: 0 },
      { id: "a1", tipo: "mensaje", x: 0, y: 0, steps: [texto("TUBERIA-A paso 1", { buttons: [boton("a_sig", "Seguir")] })] },
      { id: "a2", tipo: "mensaje", x: 0, y: 0, steps: [texto("TUBERIA-A paso 2")] },
      { id: "b1", tipo: "mensaje", x: 0, y: 0, steps: [texto("TUBERIA-B paso 1", { buttons: [boton("b_sig", "Seguir")] })] },
      { id: "b2", tipo: "mensaje", x: 0, y: 0, steps: [texto("TUBERIA-B paso 2")] },
    ];
    const resto = [["a1", "btn:a_sig", "a2"], ["b1", "btn:b_sig", "b2"]];
    sembrar({ fichas, cables: cables([["i", "siguiente", "a1"], ...resto]) });
    await esperar(3000);
    const viejo = await cliente();
    await viejo.decir("hola", 20);
    comprobar("el cliente entra por la tubería A", viejo.nuevo().includes("TUBERIA-A paso 1"), viejo.nuevo());
    sembrar({ fichas, cables: cables([["i", "siguiente", "b1"], ...resto]) }); // él mueve el cable
    await esperar(4000);
    await viejo.tocar("a_sig", "Seguir");
    comprobar("el que ya estaba sigue en la A", viejo.nuevo().includes("TUBERIA-A paso 2") && !viejo.nuevo().includes("TUBERIA-B"), viejo.nuevo());
    const nuevo = await cliente();
    await nuevo.decir("hola", 20);
    comprobar("un cliente nuevo entra por la B", nuevo.nuevo().includes("TUBERIA-B paso 1"), nuevo.nuevo());
    await viejo.borrar();
    await nuevo.borrar();
  }

  // 15. EL REGALO DEL TABLERO CON EL ENLACE DEL ANUNCIO (25/10/2026): el cliente que vino de un
  // anuncio recibe, al aceptar el regalo, el enlace para comentar de SU anuncio ({{ENLACE_ANUNCIO}}).
  if (toca("regalo_anuncio")) {
    console.log("\n· 15. Regalo del tablero: el enlace para comentar es el de su anuncio");
    const AD = "120200000000000088";
    sembrar({
      fichas: [
        { id: "i", tipo: "inicio", pais: "PE", x: 0, y: 0 },
        { id: "m", tipo: "mensaje", x: 0, y: 0, steps: [texto("HOLA-DEL-TABLERO")] },
        { id: "reg", tipo: "regalo", x: 0, y: 0 },
      ],
      cables: cables([["i", "siguiente", "m"], ["m", "siguiente", "reg"]]),
    });
    {
      // Solo en esta copia: un enlace para ese anuncio, el silencio del regalo corto y la tienda sin
      // regalo propio (que use el general con sus enlaces por anuncio).
      const doc = YAML.parseDocument(readFileSync(ARCHIVO, "utf8"));
      const js = doc.toJS();
      const g = js.gift_mechanic ?? {};
      doc.set("gift_mechanic", {
        ...g,
        registry_sync_enabled: true,
        ask_sequence: [],
        ask_text: "COMENTA-GENERAL",
        ask_text_variants: [{ text: "COMENTA-AQUI: {{ENLACE_ANUNCIO}}", ad_ids: [AD], ad_link: "https://example.com/post-del-anuncio-88", enabled: true }],
      });
      doc.set("awaiting_email_timeout_seconds", 5);
      doc.set("tiendas", js.tiendas.map((t) => (t.id === tienda.id ? (({ regalo, regalo_origen, ...r }) => r)(t) : t)));
      writeFileSync(ARCHIVO, doc.toString({ lineWidth: 0 }));
    }
    await esperar(3000);
    const c = await cliente("PE", { anuncio: AD });
    await c.decir("hola", 40);
    comprobar("saluda con su mensaje y, tras el silencio, ofrece el regalo", c.todo().includes("HOLA-DEL-TABLERO") && /regal/i.test(c.todo()), c.nuevo().slice(0, 140));
    await c.decir("si quiero", 40);
    comprobar("al aceptar, le llega el enlace de SU anuncio", c.todo().includes("https://example.com/post-del-anuncio-88"), c.nuevo().slice(0, 200));
    await c.borrar();
    const otro = await cliente("PE");
    await otro.decir("hola", 40);
    await otro.decir("si quiero", 40);
    // Como la venta de siempre (`pickWeightedGiftText`): sin anuncio, el enlace sale sorteado entre
    // TODOS los encendidos —también los de anuncios—. Aquí solo hay uno, así que le toca ese.
    comprobar("el que no vino de un anuncio recibe un enlace del sorteo (como siempre)", /COMENTA-(AQUI|GENERAL)/.test(otro.todo()), otro.nuevo().slice(0, 160));
    await otro.borrar();
  }

  // 16. «DE PALABRA» (25/10/2026): el cliente ESCRIBE su decisión en vez de tocar el botón, y dice
  // «ya pagué» sin mandar la foto. Lo primero lo lleva igual; lo segundo no entrega nada.
  if (toca("de_palabra")) {
    console.log("\n· 16. «De palabra»: escribe en vez de tocar, y «ya pagué» sin comprobante");
    sembrar({
      fichas: [
        { id: "i", tipo: "inicio", pais: "PE", x: 0, y: 0 },
        { id: "up", tipo: "mensaje", x: 0, y: 0, presenta: ["pfprueba_b"], steps: [texto("OFERTA-B: ¿lo agregas?", { buttons: [boton("up_si", "Sí, lo quiero"), boton("up_no", "No, gracias")] })] },
        cobro("cob", "pfprueba_b"),
        { id: "no", tipo: "mensaje", x: 0, y: 0, steps: [texto("DIJO-QUE-NO")] },
        { id: "ent", tipo: "entregar", x: 0, y: 0, producto_id: "pfprueba_b" },
      ],
      cables: cables([["i", "siguiente", "up"], ["up", "btn:up_si", "cob"], ["up", "btn:up_no", "no"], ["cob", "pagado", "ent"]]),
    });
    await esperar(3000);
    const c = await cliente();
    await c.decir("hola", 25);
    comprobar("le ofrece B con sus dos botones", c.nuevo().includes("OFERTA-B"), c.nuevo().slice(0, 80));
    await c.decir("si dale, lo quiero", 35);
    comprobar("escribe «si dale, lo quiero»: va al cobro de B (como si tocara «Sí»)", /COBRO:.*PRODUCTO PRUEBA B/.test(c.nuevo()), c.nuevo().slice(0, 140));
    await c.decir("ya te pague", 35);
    comprobar("«ya te pagué» sin foto: no le entrega nada", !c.todo().includes(entregaB), c.nuevo().slice(0, 140));
    comprobar("y le pide el comprobante", /comprobante|captura|foto|imagen/i.test(c.nuevo()), c.nuevo().slice(0, 160));
    await c.borrar();
    const d = await cliente();
    await d.decir("hola", 25);
    await d.decir("no gracias", 35);
    comprobar("escribe «no gracias»: va por el «No» (como si tocara «No, gracias»)", d.nuevo().includes("DIJO-QUE-NO"), d.nuevo().slice(0, 120));
    await d.borrar();
  }

  // 14. LA TIENDA ARMADA DESDE SU PIZARRA (25/10/2026): «si yo armase un workflow en modo Pizarra…
  // que aparezca en modo tablero». Se traduce SU contenido de la pizarra (el de esta copia) y se vende.
  if (toca("traducida") && R.pe15) {
    console.log("\n· 14. La tienda armada desde su pizarra vende en el tablero");
    const ts = require("typescript");
    const fuente = readFileSync(join(RAIZ, "src", "lib", "tablero", "desde-la-pizarra.ts"), "utf8");
    const js = ts.transpileModule(fuente, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
    const { tableroDesdeLaPizarra } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
    // Lo que exporta la pizarra de esta tienda (como `exportarTienda`), leído de la copia.
    const plantilla = datos.channels?.whatsapp?.modality_templates?.lineal ?? {};
    const suya = (x) => (x.tiendas ?? []).includes(tienda.id);
    const fichasDeLaPizarra = [];
    (plantilla.intro_groups ?? []).forEach((g, i) => suya(g) && fichasDeLaPizarra.push({ canal: "whatsapp", piezaId: `intro:${i}`, obj: g }));
    (plantilla.order_bump_intro_groups ?? []).forEach((g, i) => suya(g) && fichasDeLaPizarra.push({ canal: "whatsapp", piezaId: `ob:${i}`, obj: g }));
    (plantilla.upsell_intro_groups ?? []).forEach((g, i) => suya(g) && fichasDeLaPizarra.push({ canal: "whatsapp", piezaId: `up:${i}`, obj: g }));
    (plantilla.followups ?? []).forEach((f, fi) => (f.variants ?? []).forEach((v, vi) => suya(v) && fichasDeLaPizarra.push({ canal: "whatsapp", piezaId: `seg:${fi}:${vi}`, obj: v })));
    const existen = new Set((datos.biblioteca_de_productos ?? []).map((p) => p.id));
    const nombres = Object.fromEntries((datos.biblioteca_de_productos ?? []).map((p) => [p.id, p.name]));
    const r = tableroDesdeLaPizarra({ tienda, fichas: fichasDeLaPizarra, filaDeUpsell: (datos.filas_de_upsell ?? []).find((f) => (f.tiendas ?? []).includes(tienda.id)) }, "whatsapp", existen, plantilla.payment ?? [], nombres);
    comprobar("se arma: un Inicio por país, sin cables rotos", r.tablero.fichas.filter((f) => f.tipo === "inicio").length > 0 && r.tablero.cables.every((c) => r.tablero.fichas.some((f) => f.id === c.de) && r.tablero.fichas.some((f) => f.id === c.a)), `${r.tablero.fichas.length} fichas, ${r.tablero.cables.length} cables`);
    // Su básico de Perú a 15 SOLO en esta copia, para pagar con el comprobante de 15.
    const basico = tienda.alineacion?.basico;
    sembrar({ ...r.tablero, encendido: true });
    {
      const doc = YAML.parseDocument(readFileSync(ARCHIVO, "utf8"));
      const js2 = doc.toJS();
      doc.set("biblioteca_de_productos", js2.biblioteca_de_productos.map((p) => (p.id === basico ? { ...p, precios_por_pais: { ...(p.precios_por_pais ?? {}), PE: { price_soles: 15, discount_price_soles: 15, market_price: 45 } } } : p)));
      writeFileSync(ARCHIVO, doc.toString({ lineWidth: 0 }));
    }
    await esperar(3000);
    const intros = (plantilla.intro_groups ?? []).filter((g) => suya(g) && (g.paises ?? []).includes("PE") && g.enabled !== false);
    const huellasDeIntro = intros.map((g) => String(g.steps?.[0]?.body_variants?.[0] ?? "").replace(/\{[^}]*\}/g, "").replace(/[*_~]/g, "").trim().slice(0, 14)).filter(Boolean);
    const c = await cliente("PE");
    await c.decir("hola", 45);
    comprobar("saluda con una intro de Perú de su pizarra", huellasDeIntro.some((h) => c.nuevo().replace(/[*_~]/g, "").includes(h)), c.nuevo().slice(0, 120));
    await c.decir("yape", 40);
    comprobar("al decir «yape» le cobra el básico a 15", /15/.test(c.nuevo()), c.nuevo().slice(0, 160));
    if (args.ver) console.log(`        bot dijo: ${c.nuevo().replace(/\n+/g, " ⏎ ").slice(0, 900)}`);
    await c.foto(R.pe15, 90);
    if (args.ver) console.log(`        bot dijo: ${c.nuevo().replace(/\n+/g, " ⏎ ").slice(0, 900)}`);
    const entrega = String(datos.biblioteca_de_productos.find((p) => p.id === basico)?.delivery?.[0]?.body_variants?.[0] ?? "");
    const marcaDeEntrega = (entrega.match(/PRODUCTO BASICO|https?:\/\/\S{10}/) ?? [""])[0];
    comprobar("paga 15: le entrega su básico (la entrega de su producto)", !!marcaDeEntrega && c.nuevo().includes(marcaDeEntrega), c.nuevo().slice(0, 160));
    {
      // EL KANBAN Y LA AUTOPURGA leen lo pagado de la conversación: tiene que estar anotado.
      const db = new Database(join(RAIZ, "data", "messages.db"), { readonly: true });
      const fila = db.prepare("SELECT paid_total_cents, paid_at FROM conversations WHERE id = ?").get(c.id);
      db.close();
      comprobar("y queda como COMPRADOR para el kanban (15 pagados, con fecha)", fila?.paid_total_cents === 1500 && !!fila?.paid_at, JSON.stringify(fila));
    }
    await c.borrar();
    // EL CLIENTE QUE VIENE DE UN ANUNCIO: recibe la intro etiquetada con ese anuncio, como siempre.
    const etiquetada = intros.find((g) => g.adRoutingEnabled !== false && (g.adKeys ?? []).length > 0 && (!g.semimodalidad || g.semimodalidad === "dou"));
    const idDelAnuncio = etiquetada && (datos.ad_registry ?? []).find((a) => (etiquetada.adKeys ?? []).includes(a.key))?.ids?.[0];
    if (idDelAnuncio) {
      const huella = String(etiquetada.steps?.[0]?.body_variants?.[0] ?? "").replace(/\{[^}]*\}/g, "").replace(/[*_~]/g, "").trim().slice(0, 14);
      const deAnuncio = await cliente("PE", { anuncio: idDelAnuncio });
      await deAnuncio.decir("hola", 45);
      comprobar(`quien viene del anuncio recibe SU intro («${etiquetada.name}»)`, deAnuncio.nuevo().replace(/[*_~]/g, "").includes(huella), deAnuncio.nuevo().slice(0, 100));
      await deAnuncio.borrar();
    } else console.log("        (ninguna intro de Perú con anuncio que dirija: no se prueba)");
  }
} catch (e) {
  fallos++;
  console.error("ERROR:", e);
} finally {
  writeFileSync(ARCHIVO, original);
  const ahora = createHash("sha256").update(readFileSync(ARCHIVO, "utf8")).digest("hex");
  console.log(`\ncontenido devuelto: ${ahora === huella ? "idéntico ✔" : "DISTINTO ✘"}`);
}
console.log(fallos ? `\n${fallos} comprobación(es) mal.` : "\nTODO BIEN");
process.exit(fallos ? 1 : 0);
