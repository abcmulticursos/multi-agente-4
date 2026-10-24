// LAS TRES VENTAS POR PAÍS EN EL TABLERO — vive la venta como un cliente de Perú, Ecuador y Argentina.
//
// Lo pidió Alberto el 24/10/2026: «haz todas las pruebas correspondientes, para yo no tener que hacer
// una prueba y decirte: no me está entregando la información correcta, me entregó el producto
// incorrecto, me está ofreciendo un producto incorrecto, no se acuerda de algo…».
//
// Un tablero con un ▶ Inicio por país, como él arma sus tiendas:
//   🇵🇪 Perú     → COMO DOU (los dos desde la intro), upsell, regalo, «completar al otro», correo pedido de palabra
//   🇪🇨 Ecuador  → COMO OB (el completo oculto hasta «quiero pagar»), muestras con foto
//   🇦🇷 Argentina → COMO HOY (un producto), correo con los botones de la entrega
// y, aparte, lo que pasa al DESCONECTAR a mitad de venta. Con SU contenido (sus productos, precios,
// cuentas y métodos por país) y SUS comprobantes reales.
//
// SOLO CONTRA UNA COPIA: escribe en config/intro-data.yaml mientras corre y lo devuelve al terminar.
//
//   node scripts/recorrido-tablero-paises.mjs --url=http://localhost:3312 --raiz=<copia>
//        --comprobantes="C:/Users/alberto/Desktop/comprobantes para prueba" [--correos=a@x.com,b@y.com]
//        [--muestra=C:/ruta/una-foto.jpg] [--solo=pe,ec,ar,desconectar]
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
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
const [correo1, correo2] = (args.correos ?? "prueba1@example.com,prueba2@example.com").split(",");

let malas = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, ok, valor = "") => {
  if (!ok) malas++;
  console.log(`  ${ok ? "ok   " : "FALLA"} ${pad(texto, 66)} ${String(valor).replace(/\n/g, " ").slice(0, 70)}`);
};
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const cifras = (v) => String(v ?? "").replace(/\D/g, "");
const bajo = (v) => String(v ?? "").toLowerCase();

// ── SU CONTENIDO ──────────────────────────────────────────────────────────────
const original = readFileSync(ARCHIVO, "utf8");
const huella = createHash("sha256").update(original).digest("hex");
copyFileSync(ARCHIVO, `${ARCHIVO}.antes-del-recorrido-por-paises`);
const datos = YAML.parseDocument(original).toJS();
const tienda = (datos.tiendas ?? []).find((t) => t.id === args.tienda) ?? (datos.tiendas ?? [])[0];
const productos = (datos.biblioteca_de_productos ?? []).filter((p) => (p.delivery ?? []).length > 0);
const precio = (p, pais) => p?.precios_por_pais?.[pais]?.price_soles;
const conGaleria = (p) => (p.image_gallery ?? []).length > 0;
const busca = (pais, monto, preferir = () => true) =>
  productos.filter((p) => precio(p, pais) === monto).sort((a, b) => Number(preferir(b)) - Number(preferir(a)))[0];

// Los comprobantes, por su nombre de archivo.
const carpeta = args.comprobantes ?? "";
const archivos = carpeta && existsSync(carpeta) ? readdirSync(carpeta) : [];
const comprobante = (patron) => {
  const f = archivos.find((x) => patron.test(x));
  return f ? join(carpeta, f) : null;
};
const R = {
  pe15: comprobante(/^ALBERTO yapeo 15 soles/i),
  pe5: comprobante(/^yapeo ALBERTO 5 soles/i),
  ec3: comprobante(/^PICHINCHA 3 DOLARES\.jpg$/i),
  ar8000: comprobante(/^FRANKO recibo de pago 8000/i),
};

// Los productos de cada país: los que cuestan lo que dicen sus comprobantes.
const PE_B = busca("PE", 15);
const PE_F = productos.find((p) => precio(p, "PE") === 20);
const PE_UP = productos.find((p) => p !== PE_B && p !== PE_F && precio(p, "PE") > 0 && conGaleria(p));
const EC_B = busca("EC", 3, conGaleria);
const EC_F = busca("EC", 4, conGaleria);
const AR_P = busca("AR", 8000);

// Las cuentas de cada país, tal como las tiene (para ver que no se crucen).
const perfil = (pais) => datos.payment_profiles_by_country?.[pais] ?? {};
const metodosDe = (pais) => (perfil(pais).payment_buttons ?? []).filter((b) => b?.method && b.enabled !== false);
const cuentaDe = (pais, m) => cifras(perfil(pais).cuentas_por_metodo?.[m] ?? perfil(pais).numero_de_cuenta);
const PE_M = metodosDe("PE")[0];
const EC_M = metodosDe("EC").find((m) => /pichincha/i.test(m.label)) ?? metodosDe("EC")[0];
const AR_M = metodosDe("AR")[0];
const cuentasDe = (pais) => [...new Set([cifras(perfil(pais).numero_de_cuenta), ...Object.values(perfil(pais).cuentas_por_metodo ?? {}).map(cifras)])].filter((x) => x.length >= 7);

// Un pedazo de la entrega de un producto que NINGÚN otro producto tiene (para saber QUÉ producto se
// entregó): un enlace suyo entero, o una línea suya. Sus enlaces suelen empezar igual
// («drive.google.com/drive/folders/1…»), así que se compara entero.
const textoDeEntrega = (p) =>
  (p?.delivery ?? []).map((s) => [s.body, ...(s.body_variants ?? []), ...(s.texts ?? [])].filter(Boolean).join("\n")).join("\n").replace(/[*_]/g, "");
/** ¿Lo que dijo el bot trae esa huella? Sin asteriscos ni guiones bajos, como se calculó la huella. */
const trae = (texto, h) => !!h && String(texto).replace(/[*_]/g, "").includes(h);
const huellaDeEntrega = (p) => {
  const otros = productos.filter((x) => x !== p).map(textoDeEntrega).join("\n");
  const t = textoDeEntrega(p);
  for (const url of t.match(/https?:\/\/[^\s*)]+/g) ?? []) if (!otros.includes(url)) return url;
  for (const l of t.split("\n").map((l) => l.replace(/[*_]/g, "").trim()))
    if (l.length > 18 && !/[{}|]/.test(l) && !otros.includes(l)) return l.slice(0, 40);
  return null;
};

// LA MUESTRA DE PRUEBA (en la copia): una foto cualquiera «como si fuese un creativo», con su texto al
// pie como los suyos. Se guarda en la memoria de fotos del bot con un enlace de Drive inventado: Drive
// no lo reconoce y el bot usa la copia guardada (ver `getReadyMediaFromDrive`).
const ID_MUESTRA = "TABLEROPRUEBAMUESTRA1";
const PIE_MUESTRA = "Este es el contenido del curso 📚\n\n✅ Contiene esto\n✅ Lo otro\n✅ Lo otro\n🎁 Y este bonus\n\n¿Te animas a llevarlo?";
if (args.muestra && existsSync(args.muestra)) {
  const destino = join(RAIZ, "data", "cache", "drive");
  mkdirSync(destino, { recursive: true });
  copyFileSync(args.muestra, join(destino, `${ID_MUESTRA}.jpg`));
}

const texto = (t, extra = {}) => ({ type: "text", body: t, body_variants: [t], delay_after_sec: 1, ...extra });
const boton = (id, label) => ({ id, label, action: "send_steps" });
const cable = (lista) => lista.map(([de, salida, a], i) => ({ id: `c${i}`, de, salida, a }));
const cobro = (id, prod, acepta, extra = {}) => ({
  id, tipo: "cobro", x: 0, y: 0,
  cobro: { modo: "producto", producto_id: prod?.id, acepta: acepta.filter(Boolean).map((p) => p.id), precio: "normal", metodos: true, ...extra },
  steps: [texto("PREGUNTA-METODO: ¿con qué método pagas?")],
});

const TABLERO = {
  encendido: true,
  fichas: [
    // 🇵🇪 PERÚ — COMO DOU
    { id: "pe_inicio", tipo: "inicio", pais: "PE", x: 0, y: 0 },
    { id: "pe_intro", tipo: "mensaje", x: 0, y: 0, presenta: [PE_B?.id, PE_F?.id].filter(Boolean), steps: [texto(`INTRO-PE: tenemos ${PE_B?.name} y ${PE_F?.name}. ¿Cuál prefieres?`, { buttons: [boton("pe_b", "El primero"), boton("pe_f", "El segundo")] })] },
    cobro("pe_cobro_b", PE_B, [PE_F]),
    cobro("pe_cobro_f", PE_F, [PE_B]),
    { id: "pe_ent_b", tipo: "entregar", x: 0, y: 0, producto_id: PE_B?.id },
    { id: "pe_ent_f", tipo: "entregar", x: 0, y: 0, producto_id: PE_F?.id },
    { id: "pe_upsell", tipo: "mensaje", x: 0, y: 0, presenta: [PE_UP?.id].filter(Boolean), steps: [texto(`UPSELL-PE: también tenemos ${PE_UP?.name}. ¿Lo agregas?`, { buttons: [boton("up_si", "Sí, lo quiero"), boton("up_no", "No, gracias")] })] },
    cobro("pe_cobro_up", PE_UP, []),
    { id: "pe_ent_up", tipo: "entregar", x: 0, y: 0, producto_id: PE_UP?.id },
    cobro("pe_cobro_upgrade", PE_F, [PE_B], { diferencia: true }),
    { id: "regalo", tipo: "regalo", x: 0, y: 0 },
    // 🇪🇨 ECUADOR — COMO OB
    { id: "ec_inicio", tipo: "inicio", pais: "EC", x: 0, y: 0 },
    { id: "ec_intro", tipo: "mensaje", x: 0, y: 0, presenta: [EC_B?.id].filter(Boolean), steps: [texto(`INTRO-EC: te presento ${EC_B?.name}.`, { buttons: [boton("ec_pagar", "Quiero pagar")] })] },
    { id: "ec_ob", tipo: "intro_ob", x: 0, y: 0, presenta: [EC_B?.id, EC_F?.id].filter(Boolean), variantes: [{ id: "v", peso: 1, steps: [texto(`INTRO-OB-EC: también está ${EC_F?.name}. ¿Cuál prefieres?`, { buttons: [boton("ec_b", "El básico"), boton("ec_f", "El completo")] })] }] },
    cobro("ec_cobro_b", EC_B, [EC_F]),
    cobro("ec_cobro_f", EC_F, [EC_B]),
    { id: "ec_ent_b", tipo: "entregar", x: 0, y: 0, producto_id: EC_B?.id },
    { id: "ec_ent_f", tipo: "entregar", x: 0, y: 0, producto_id: EC_F?.id },
    // 🇦🇷 ARGENTINA — COMO HOY
    { id: "ar_inicio", tipo: "inicio", pais: "AR", x: 0, y: 0 },
    { id: "ar_intro", tipo: "mensaje", x: 0, y: 0, presenta: [AR_P?.id].filter(Boolean), steps: [texto(`INTRO-AR: te presento ${AR_P?.name}.`, { buttons: [boton("ar_comprar", "Quiero comprarlo")] })] },
    cobro("ar_cobro", AR_P, []),
    { id: "ar_ent", tipo: "entregar", x: 0, y: 0, producto_id: AR_P?.id, por_correo: true },
  ],
  cables: cable([
    ["pe_inicio", "siguiente", "pe_intro"], ["pe_intro", "btn:pe_b", "pe_cobro_b"], ["pe_intro", "btn:pe_f", "pe_cobro_f"],
    ["pe_cobro_b", "pagado", "pe_ent_b"], ["pe_cobro_b", `prod:${PE_F?.id}`, "pe_ent_f"], ["pe_cobro_f", "pagado", "pe_ent_f"], ["pe_cobro_f", `prod:${PE_B?.id}`, "pe_ent_b"],
    ["pe_ent_b", "siguiente", "pe_upsell"], ["pe_upsell", "btn:up_si", "pe_cobro_up"], ["pe_upsell", "btn:up_no", "regalo"], ["pe_cobro_up", "pagado", "pe_ent_up"], ["pe_ent_up", "siguiente", "regalo"],
    ["pe_cobro_upgrade", "pagado", "pe_ent_f"], ["pe_ent_f", "siguiente", "regalo"],
    ["ec_inicio", "siguiente", "ec_intro"], ["ec_intro", "btn:ec_pagar", "ec_ob"], ["ec_ob", "btn:ec_b", "ec_cobro_b"], ["ec_ob", "btn:ec_f", "ec_cobro_f"],
    ["ec_cobro_b", "pagado", "ec_ent_b"], ["ec_cobro_b", `prod:${EC_F?.id}`, "ec_ent_f"], ["ec_cobro_f", "pagado", "ec_ent_f"], ["ec_cobro_f", `prod:${EC_B?.id}`, "ec_ent_b"],
    ["ec_ent_b", "siguiente", "regalo"], ["ec_ent_f", "siguiente", "regalo"],
    ["ar_inicio", "siguiente", "ar_intro"], ["ar_intro", "btn:ar_comprar", "ar_cobro"], ["ar_cobro", "pagado", "ar_ent"], ["ar_ent", "siguiente", "regalo"],
  ]),
};

/** Siembra un tablero (con cambios para las desconexiones) y la muestra de prueba en el completo de Ecuador. */
function sembrar(cambio = (t) => t) {
  const doc = YAML.parseDocument(readFileSync(ARCHIVO, "utf8"));
  doc.set("tableros", { [tienda.id]: { whatsapp: cambio(JSON.parse(JSON.stringify(TABLERO))) } });
  if (args.muestra && EC_F) {
    const biblio = doc.toJS().biblioteca_de_productos.map((p) =>
      p.id === EC_F.id
        ? { ...p, image_gallery: [{ topic: "contenido del curso", when: "cuando pida ver o pregunte qué incluye", media_type: "image", drive_url: `https://drive.google.com/file/d/${ID_MUESTRA}/view`, caption: PIE_MUESTRA, enabled: true }] }
        : p
    );
    doc.set("biblioteca_de_productos", biblio);
  }
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
async function cliente(pais) {
  const conv = await (
    await api("/api/test-simulator", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channel: "whatsapp", tienda: tienda.id, country: pais }) })
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
    bot,
    /** Lo que el bot dijo desde el último `desde()`. */
    nuevo: () => bot.slice(marca).join("\n"),
    desde: () => (marca = bot.length),
    dijo: (t) => bot.some((x) => x.includes(t)),
    leer,
    decir: (t, seg = 30) => {
      c.desde();
      const f = new FormData();
      f.set("content", t);
      return enviar(f, seg);
    },
    tocar: (id, titulo, seg = 25) => {
      c.desde();
      const f = new FormData();
      f.set("button_id", `bubble:${id}`);
      f.set("button_title", titulo);
      return enviar(f, seg);
    },
    foto: (ruta, seg = 60) => {
      c.desde();
      const f = new FormData();
      f.set("file", new Blob([readFileSync(ruta)], { type: "image/jpeg" }), "comprobante.jpg");
      return enviar(f, seg);
    },
    borrar: () => api(`/api/test-simulator/${conv.id}`, { method: "DELETE" }),
  };
  return c;
}

/** Ninguna cuenta de OTRO país en lo que dijo el bot. */
const sinCuentasDe = (texto, paises) => paises.every((p) => cuentasDe(p).every((k) => !cifras(texto).includes(k)));

// ── LAS VENTAS ────────────────────────────────────────────────────────────────
try {
  await entrar();
  console.log(`RECORRIDO POR PAÍSES · tienda «${tienda.nombre ?? tienda.id}»`);
  console.log(`  🇵🇪 ${PE_B?.name} (15) / ${PE_F?.name} (20) · upsell ${PE_UP?.name} · método ${PE_M?.label}`);
  console.log(`  🇪🇨 ${EC_B?.name} (3) / ${EC_F?.name} (4) · método ${EC_M?.label}`);
  console.log(`  🇦🇷 ${AR_P?.name} (8000) · método ${AR_M?.label}`);
  console.log(`  comprobantes: ${Object.entries(R).map(([k, v]) => `${k}:${v ? "sí" : "NO"}`).join(" ")} · muestra: ${args.muestra ? "sí" : "no"}`);

  if (toca("pe") && PE_B && PE_F && PE_UP && R.pe15 && R.pe5) {
    console.log("\n· 🇵🇪 PERÚ — COMO DOU: dudas, cambio de idea, pago, upsell «¿este es otro?», regalo, completar al otro y correo de palabra");
    sembrar();
    await esperar(3000);
    const c = await cliente("PE");
    await c.decir("hola", 20);
    comprobar("la intro presenta los dos", c.dijo("INTRO-PE"));
    await c.decir("cual es la diferencia entre los dos?", 45);
    comprobar("una duda: contesta (no elige ni pide método)", c.nuevo().length > 40 && !c.nuevo().includes("PREGUNTA-METODO"), c.nuevo());
    await c.decir("y es seguro? no me vayan a estafar", 45);
    comprobar("desconfianza: contesta sin soltar cuentas", c.nuevo().length > 30 && sinCuentasDe(c.nuevo(), ["PE", "EC", "AR"]), c.nuevo());
    await c.decir(`ya, quiero el ${PE_B.name}`, 35);
    comprobar("eligió escribiendo: le pregunta el método", c.nuevo().includes("PREGUNTA-METODO"));
    await c.decir(bajo(PE_M.label).replace(/[^\p{L} ]/gu, "").trim(), 30);
    comprobar(`«${PE_M.label}»: su cuenta de Perú, S/ y 15`, cifras(c.nuevo()).includes(cuentaDe("PE", PE_M.method)) && cifras(c.nuevo()).includes("15") && /S\//.test(c.nuevo()), c.nuevo());
    await c.decir("mmm mejor el otro", 40);
    comprobar("«mejor el otro»: 20, mismo método, sin repreguntar", cifras(c.nuevo()).includes("20") && !c.nuevo().includes("PREGUNTA-METODO"), c.nuevo());
    await c.decir(`no, mejor me quedo con el ${PE_B.name}`, 40);
    comprobar("vuelve al primero: 15", cifras(c.nuevo()).includes("15"), c.nuevo());
    await c.foto(R.pe15, 70);
    const entregaB = huellaDeEntrega(PE_B);
    comprobar("paga 15: le entrega EL PRIMERO (no el segundo)", (!entregaB || trae(c.nuevo(), entregaB)) && !trae(c.nuevo(), huellaDeEntrega(PE_F)), entregaB);
    comprobar("y le ofrece el upsell", c.nuevo().includes("UPSELL-PE"));
    await c.decir("¿este es otro?", 45);
    comprobar("«¿este es otro?»: habla del upsell, no pide comprobante", c.nuevo().length > 30 && !/comprobante/i.test(c.nuevo()) && !c.nuevo().includes("PREGUNTA-METODO"), c.nuevo());
    await c.tocar("up_no", "No, gracias", 40);
    comprobar("no quiere el upsell: empieza el regalo", /regal/i.test(c.nuevo()), c.nuevo());
    await c.decir(`y si pago la diferencia para tener el ${PE_F.name}?`, 50);
    comprobar("en el regalo, «pago la diferencia»: datos por 5, sin repreguntar", cifras(c.nuevo()).includes("5") && cifras(c.nuevo()).includes(cuentaDe("PE", PE_M.method)) && !c.nuevo().includes("PREGUNTA-METODO"), c.nuevo());
    await c.foto(R.pe5, 70);
    const entregaF = huellaDeEntrega(PE_F);
    comprobar("paga 5: le entrega EL SEGUNDO", !entregaF || trae(c.nuevo(), entregaF), entregaF);
    await c.decir(`me lo puedes mandar a mi correo ${correo2} porfa`, 50);
    comprobar(`lo pide por correo: se envía a ${correo2}`, new RegExp(correo2.replace(/[.@]/g, "."), "i").test(c.nuevo()) || /correo/i.test(c.nuevo()), c.nuevo());
    await c.borrar();
  }

  if (toca("ec") && EC_B && EC_F && R.ec3) {
    console.log(`\n· 🇪🇨 ECUADOR — COMO OB: «${EC_F.name}» oculto hasta «quiero pagar», muestras, método Pichincha, dólares`);
    sembrar();
    await esperar(3000);
    const c = await cliente("EC");
    const oculto = bajo(EC_F.name);
    await c.decir("hola", 20);
    comprobar("la intro presenta solo el básico", c.dijo("INTRO-EC") && !bajo(c.bot.join(" ")).includes(oculto));
    await c.decir("cuanto cuesta? tienen algo mas completo?", 45);
    comprobar("dice 3 y NO nombra ni cotiza el completo", cifras(c.nuevo()).includes("3") && !bajo(c.nuevo()).includes(oculto) && !c.nuevo().includes("4 D"), c.nuevo());
    await c.decir("tienes fotos de como es?", 60);
    comprobar("si manda foto, no es la del oculto", !c.nuevo().includes("Este es el contenido del curso"), c.nuevo());
    await c.tocar("ec_pagar", "Quiero pagar", 25);
    comprobar("«quiero pagar» destapa el completo", c.nuevo().includes("INTRO-OB-EC"));
    if (args.muestra) {
      await c.decir(`me muestras como es el ${EC_F.name}?`, 60);
      comprobar("pide verlo: llega SU muestra, con tu texto al pie", c.nuevo().includes("[MEDIA:") && c.nuevo().includes("Este es el contenido del curso"), c.nuevo());
      await c.decir(`otra foto del ${EC_F.name} porfa`, 50);
      comprobar("la misma muestra no se repite", !c.nuevo().includes("Este es el contenido del curso"), c.nuevo());
    }
    await c.tocar("ec_f", "El completo", 25);
    comprobar("elige el completo: le pregunta el método", c.nuevo().includes("PREGUNTA-METODO"));
    await c.decir(bajo(EC_M.label).replace(/[^\p{L} ]/gu, "").trim(), 30);
    comprobar(`«${EC_M.label}»: su cuenta de Ecuador, en dólares, 4`, cifras(c.nuevo()).includes(cuentaDe("EC", EC_M.method)) && /\$|d[oó]lar/i.test(c.nuevo()) && cifras(c.nuevo()).includes("4"), c.nuevo());
    comprobar("y ninguna cuenta de Perú ni de Argentina", sinCuentasDe(c.bot.join("\n"), ["PE", "AR"]));
    await c.decir("mejor el basico nomas", 40);
    comprobar("cambia al básico: 3 dólares", cifras(c.nuevo()).includes("3"), c.nuevo());
    await c.foto(R.ec3, 70);
    const entrega = huellaDeEntrega(EC_B);
    comprobar("paga 3 dólares: le entrega EL BÁSICO", (!entrega || trae(c.nuevo(), entrega)) && !trae(c.nuevo(), huellaDeEntrega(EC_F)), entrega);
    comprobar("y la entrega no trae comodines vacíos («para **»)", !/\*\s*\*/.test(c.nuevo()) && !/\{\{/.test(c.nuevo()), c.nuevo());
    comprobar("y empieza el regalo", /regal/i.test(c.nuevo()), c.nuevo());
    await c.borrar();
  }

  if (toca("ar") && AR_P && R.ar8000) {
    console.log(`\n· 🇦🇷 ARGENTINA — COMO HOY: un producto, transferencia en pesos, correo con los botones de la entrega`);
    sembrar();
    await esperar(3000);
    const c = await cliente("AR");
    await c.decir("hola", 20);
    comprobar("la intro", c.dijo("INTRO-AR"));
    await c.decir("cuanto sale?", 40);
    comprobar("el precio en pesos (8000), sin soles", cifras(c.nuevo()).includes("8000") && !/S\//.test(c.nuevo()), c.nuevo());
    await c.tocar("ar_comprar", "Quiero comprarlo", 25);
    comprobar("pregunta el método", c.nuevo().includes("PREGUNTA-METODO"));
    await c.decir(bajo(AR_M.label).replace(/[^\p{L} ]/gu, "").trim(), 30);
    comprobar(`«${AR_M.label}»: su cuenta de Argentina y 8000`, cifras(c.nuevo()).includes(cuentaDe("AR", AR_M.method)) && cifras(c.nuevo()).includes("8000"), c.nuevo());
    comprobar("y ninguna cuenta de Perú ni de Ecuador", sinCuentasDe(c.bot.join("\n"), ["PE", "EC"]));
    await c.foto(R.ar8000, 70);
    const entrega = huellaDeEntrega(AR_P);
    comprobar("paga 8000: le entrega SU producto", !entrega || trae(c.nuevo(), entrega), entrega);
    comprobar("y le pregunta si lo quiere por correo", /correo/i.test(c.nuevo()), c.nuevo());
    await c.tocar("tablero_correo_si", "📧 Sí, por correo", 25);
    comprobar("dice que sí: le pide su dirección", /correo/i.test(c.nuevo()), c.nuevo());
    await c.decir(correo1, 30);
    comprobar(`escribe ${correo1}: se le envía y se lo dice`, /correo|envi/i.test(c.nuevo()), c.nuevo());
    await c.borrar();
  }

  if (toca("desconectar") && PE_B && R.pe15) {
    console.log("\n· DESCONECTAR A MITAD DE VENTA (Perú)");
    // a) Se corta el cable del botón que va a tocar.
    sembrar();
    await esperar(3000);
    let c = await cliente("PE");
    await c.decir("hola", 20);
    sembrar((t) => ({ ...t, cables: t.cables.filter((x) => !(x.de === "pe_intro" && x.salida === "btn:pe_b")) }));
    await esperar(2000);
    await c.tocar("pe_b", "El primero", 35);
    comprobar("cable cortado: no se rompe, la IA le contesta", c.nuevo().length > 10 && !c.nuevo().includes("PREGUNTA-METODO"), c.nuevo());
    // b) Se borra la ficha donde está.
    sembrar((t) => ({ ...t, fichas: t.fichas.filter((f) => f.id !== "pe_intro") }));
    await esperar(2000);
    await c.decir("hola? sigues ahi?", 35);
    comprobar("ficha borrada: la IA le contesta", c.nuevo().length > 10, c.nuevo());
    await c.borrar();
    // c) Se apaga el tablero: el que está dentro sigue; el nuevo va a la venta automática.
    sembrar();
    await esperar(3000);
    c = await cliente("PE");
    await c.decir("hola", 20);
    sembrar((t) => ({ ...t, encendido: false }));
    await esperar(2000);
    await c.tocar("pe_b", "El primero", 30);
    comprobar("tablero apagado: el que estaba dentro termina su venta", c.nuevo().includes("PREGUNTA-METODO"), c.nuevo());
    const n = await cliente("PE");
    await n.decir("hola", 30);
    comprobar("y un cliente NUEVO va a la venta automática", n.bot.length > 0 && !n.dijo("INTRO-PE"), n.bot.join(" ").slice(0, 60));
    await n.borrar();
    await c.borrar();
    // d) Se corta el cable del cobro a la entrega y paga.
    sembrar();
    await esperar(3000);
    c = await cliente("PE");
    await c.decir("hola", 20);
    await c.tocar("pe_b", "El primero", 25);
    await c.decir(bajo(PE_M.label).replace(/[^\p{L} ]/gu, "").trim(), 30);
    sembrar((t) => ({ ...t, cables: t.cables.filter((x) => !(x.de === "pe_cobro_b" && x.salida === "pagado")) }));
    await esperar(2000);
    await c.foto(R.pe15, 70);
    const entregaB = huellaDeEntrega(PE_B);
    comprobar("pagó y la ruta no sigue: no entrega nada y le dice que un asesor le escribe", /asesor/i.test(c.nuevo()) && !trae(c.nuevo(), entregaB), c.nuevo());
    await c.borrar();
  }
} finally {
  writeFileSync(ARCHIVO, original);
  const despues = createHash("sha256").update(readFileSync(ARCHIVO, "utf8")).digest("hex");
  console.log(`\ncontenido devuelto: ${despues === huella ? "idéntico ✔" : "¡DISTINTO! la copia está al lado"}`);
}
console.log(malas === 0 ? "\nTODO BIEN" : `\n${malas} comprobación(es) mal.`);
process.exit(malas === 0 ? 0 : 1);
