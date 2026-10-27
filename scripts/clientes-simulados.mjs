// CLIENTES SIMULADOS (27/10/2026): pruebas como las hace Alberto (COMO-TESTEA-ALBERTO.md) — varias
// conversaciones A LA VEZ, cada una con un cliente distinto que escribe como una persona (sin tildes,
// mensajes cortos, cambia de opinión, consulta, se hace el desentendido, compra en distintos momentos y
// reclama al final). Un modelo hace de cliente; el bot es el de la copia. NO GUARDA NADA: corre contra una
// COPIA (en el scratchpad) y acorta allí los tiempos de la tienda que se prueba.
//
//   node scripts/clientes-simulados.mjs --url=http://localhost:3312 --raiz=<copia> --comprobantes=<carpeta>
//        [--tienda=tienda_tmascotas] [--solo=perfil1,perfil2] [--max=9] [--salida=<archivo.txt>]
//
// Lo que revisa solo, en cada conversación (lo que hace perder dinero o clientes):
//   · NUNCA MUDO: cada mensaje del cliente tiene respuesta (salvo un «ok» seco con los datos ya enviados).
//   · LA PALABRA DEL BOT ES LEY: los datos de pago llevan el precio del producto que eligió el cliente.
//   · ENTREGA: recibe lo que pagó, ni más ni menos.
//   · NINGÚN NÚMERO DE CUENTA ESCRITO POR LA IA fuera de los datos de pago.
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
const TIENDA = args.tienda ?? "tienda_tmascotas";
const MAX = Number(args.max ?? 9);
const solo = args.solo ? new Set(args.solo.split(",")) : null;
const SALIDA = args.salida ?? join(RAIZ, "..", "clientes-simulados.txt");
const ARCHIVO = join(RAIZ, "config", "intro-data.yaml");
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const env = readFileSync(join(RAIZ, ".env"), "utf8");
const deEnv = (k) => (env.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1] ?? "").trim().replace(/^["']|["']$/g, "");

// ── LA COPIA: tiempos cortos en la tienda que se prueba ──
{
  const doc = YAML.parseDocument(readFileSync(ARCHIVO, "utf8"));
  const js = doc.toJS({ maxAliasCount: -1 });
  js.awaiting_email_timeout_seconds = 60;
  for (const f of js.tableros[TIENDA].whatsapp.fichas) {
    if (f.tipo === "seguimientos") {
      if (f.seguimientos?.[0]) f.seguimientos[0].minutos = 2;
      if (f.seguimientos?.[1]) f.seguimientos[1].minutos = 4;
      for (const s of f.seguimientos?.slice(2) ?? []) s.minutos = 6;
    }
    if (f.espera_min) f.espera_min = 1;
    if (f.sin_respuesta_min) f.sin_respuesta_min = 2;
  }
  doc.set("awaiting_email_timeout_seconds", js.awaiting_email_timeout_seconds);
  doc.setIn(["tableros", TIENDA, "whatsapp"], doc.createNode(js.tableros[TIENDA].whatsapp));
  writeFileSync(ARCHIVO, doc.toString({ lineWidth: 0 }));
}

// ── EL SIMULADOR ──
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
await api("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: deEnv("DASHBOARD_PASSWORD") }) });

const carpeta = args.comprobantes ?? "";
const archivos = carpeta && existsSync(carpeta) ? readdirSync(carpeta) : [];
/** Un comprobante del país con ese monto (si hay varios, uno distinto cada vez). */
const usados = new Map();
function comprobanteDe(pais, monto) {
  const m = String(monto).replace(",", ".");
  const re =
    pais === "EC" ? new RegExp(`^PICHINCHA ${m.replace(".", "\\.")} DOLAR`, "i")
    : pais === "PE" ? new RegExp(`(yape|yapeo).* ${m} (soles|b|\\.jpg)|yapeo ALBERTO ${m}\\b`, "i")
    : new RegExp(`recibo de pago ${m} pesos`, "i");
  const todos = archivos.filter((a) => re.test(a));
  if (!todos.length) return null;
  const n = usados.get(`${pais}${m}`) ?? 0;
  usados.set(`${pais}${m}`, n + 1);
  return join(carpeta, todos[n % todos.length]);
}

// ── EL CLIENTE: un modelo que escribe como una persona ──
const CLAVE = deEnv("OPENROUTER_API_KEY");
const MODELO = args.modelo ?? "openai/gpt-4o-mini";
async function siguienteMensaje(perfil, historial) {
  const sistema = [
    "Eres un CLIENTE REAL escribiendo por WhatsApp a una tienda. Escribe como la gente de verdad: corto, sin tildes, sin signos de interrogación casi nunca, a veces con faltas, una idea por mensaje.",
    `TU PERFIL Y LO QUE QUIERES HACER: ${perfil.guion}`,
    "Reacciona a lo que te dice el bot. No seas un robot: si te explican algo, a veces preguntas otra cosa, dudas, o cambias de idea, según tu perfil.",
    "COMANDOS (escríbelos SOLOS en tu mensaje, sin nada más):",
    "  [COMPROBANTE <monto>] = mandas la foto de tu comprobante de pago por ese monto (solo cuando ya tienes los datos de pago y decidiste pagar).",
    "  [ESPERAR <segundos>] = te quedas callado ese tiempo (para dejar que el bot te mande sus recordatorios).",
    "  [FIN] = terminas la conversación (cuando cumpliste tu perfil o el bot ya no tiene nada que darte).",
    "Nunca escribas como bot ni expliques lo que haces. Solo el mensaje del cliente.",
  ].join("\n");
  const msgs = [{ role: "system", content: sistema }, ...historial.map((h) => ({ role: h.de === "cliente" ? "assistant" : "user", content: h.texto }))];
  if (historial.length === 0) msgs.push({ role: "user", content: "(empieza tú la conversación, con un saludo corto)" });
  for (let intento = 1; intento <= 3; intento++) {
    try {
      const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${CLAVE}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: MODELO, messages: msgs, temperature: 0.9, max_tokens: 120 }),
      });
      const j = await r.json();
      const t = j.choices?.[0]?.message?.content?.trim();
      if (t) return t;
    } catch {}
    await esperar(3000);
  }
  return "[FIN]";
}

// ── UNA CONVERSACIÓN ──
const base = () => new Database(join(RAIZ, "data", "messages.db"), { readonly: true });
async function conversar(perfil) {
  const conv = await (await api("/api/test-simulator", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channel: "whatsapp", tienda: TIENDA, country: perfil.pais }) })).json();
  const historial = [];
  const registro = [];
  let vistos = 0;
  const leerHastaSilencio = async (maxSeg = 90, calma = 12) => {
    const fin = Date.now() + maxSeg * 1000;
    let ultimoCambio = Date.now();
    let nuevos = [];
    while (Date.now() < fin) {
      const d = await (await api(`/api/test-simulator/${conv.id}`)).json();
      const llegados = d.messages.slice(vistos).filter((m) => m.role !== "user");
      vistos = d.messages.length;
      if (llegados.length) {
        nuevos.push(...llegados.map((m) => `${m.media_type ? `[${m.media_type}] ` : ""}${m.content ?? ""}`));
        ultimoCambio = Date.now();
      }
      if (nuevos.length && Date.now() - ultimoCambio > calma * 1000) break;
      await esperar(1500);
    }
    return nuevos;
  };
  const anotar = (de, texto) => {
    historial.push({ de, texto });
    registro.push(`${de === "cliente" ? "CLIENTE" : "BOT    "}: ${texto.replace(/\n+/g, " / ").slice(0, 400)}`);
  };
  let sinRespuesta = 0;
  const silencios = [];
  for (let turno = 0; turno < (perfil.turnos ?? 16); turno++) {
    const msg = await siguienteMensaje(perfil, historial);
    if (/^\[FIN\]/i.test(msg)) break;
    const espera = msg.match(/^\[ESPERAR\s+(\d+)\]/i);
    if (espera) {
      anotar("cliente", `(se queda callado ${espera[1]} s)`);
      const llegados = await leerHastaSilencio(Number(espera[1]) + 20, Number(espera[1]) + 10);
      for (const b of llegados) anotar("bot", b);
      continue;
    }
    const comp = msg.match(/^\[COMPROBANTE\s+([\d.,]+)\]/i);
    if (comp) {
      const ruta = comprobanteDe(perfil.pais, comp[1]);
      if (!ruta) {
        anotar("cliente", `(quería mandar un comprobante de ${comp[1]} pero no hay foto de ese monto)`);
        continue;
      }
      anotar("cliente", `[foto del comprobante de ${comp[1]}]`);
      const f = new FormData();
      f.set("file", new Blob([readFileSync(ruta)], { type: "image/jpeg" }), "comprobante.jpg");
      await api(`/api/test-simulator/${conv.id}/message`, { method: "POST", body: f });
    } else {
      anotar("cliente", msg);
      const f = new FormData();
      f.set("content", msg);
      await api(`/api/test-simulator/${conv.id}/message`, { method: "POST", body: f });
    }
    const llegados = await leerHastaSilencio(comp ? 120 : 90);
    if (!llegados.length) {
      const acuse = /^(ok|okey|gracias|listo|ya|vale|bueno|dale)\b/i.test(msg.trim());
      if (!acuse) {
        sinRespuesta++;
        silencios.push(msg.slice(0, 60));
      }
      anotar("bot", "(no contestó)");
    }
    for (const b of llegados) anotar("bot", b);
  }
  // Lo que dice la base: qué pagó y qué recibió.
  const db = base();
  let compras = [];
  let entregas = [];
  try {
    compras = db.prepare("SELECT producto_id, monto FROM tablero_compras WHERE conversation_id = ?").all(conv.id);
    entregas = db.prepare("SELECT producto_id FROM tablero_entregas WHERE conversation_id = ?").all(conv.id).map((r) => r.producto_id);
  } finally {
    db.close();
  }
  return { perfil, conv: conv.id, registro, sinRespuesta, silencios, compras, entregas };
}

// ── LAS REVISIONES ──
function revisar(r) {
  const fallos = [];
  if (r.sinRespuesta > 0) fallos.push(`se quedó mudo ${r.sinRespuesta} vez/veces (${r.silencios.join(" | ")})`);
  // Datos de pago: el monto que se le pidió vs. lo que el cliente decía querer (su perfil lo declara).
  const datos = r.registro.filter((l) => l.startsWith("BOT") && /(monto|precio)\s*:/i.test(l));
  if (r.perfil.debePagar && datos.length) {
    const ultimo = datos[datos.length - 1];
    const montos = (ultimo.match(/[\d][\d.,]*/g) ?? []).map((x) => Number(x.replace(/[.,](?=\d{3}\b)/g, "").replace(",", ".")));
    if (!montos.some((m) => Math.abs(m - r.perfil.debePagar) < 0.01)) fallos.push(`los últimos datos de pago no son de ${r.perfil.debePagar}: «${ultimo.slice(9, 160)}»`);
  }
  for (const p of r.perfil.debeRecibir ?? []) if (!r.entregas.some((e) => e.split("#")[0] === p)) fallos.push(`no recibió ${p}`);
  for (const e of r.entregas) if (r.perfil.debeRecibir && !r.perfil.debeRecibir.includes(e.split("#")[0])) fallos.push(`recibió algo que no pagó: ${e}`);
  // Una cuenta escrita fuera de los datos de pago (la IA no debe escribirla).
  for (const l of r.registro)
    if (l.startsWith("BOT") && /\d{7,}/.test(l.replace(/https?:\/\/\S+/g, "").replace(/(?<=\d)[ -](?=\d)/g, "")) && !/(monto|precio|a nombre|titular|cta|cuenta|cbu|alias|cedula|cédula|yape|plin|bcp)\s*[:.]/i.test(l))
      fallos.push(`un número largo fuera de los datos de pago: «${l.slice(9, 120)}»`);
  return fallos;
}

// ── LOS PERFILES (mezclados, como él) ──
const PERFILES = JSON.parse(readFileSync(args.perfiles ?? join(RAIZ, "..", "perfiles-clientes.json"), "utf8")).filter((p) => !solo || solo.has(p.id));
const resultados = [];
const enCurso = new Set();
const cola = [...PERFILES];
const inicio = Date.now();
await Promise.all(
  Array.from({ length: Math.min(MAX, cola.length) }, async () => {
    while (cola.length) {
      const p = cola.shift();
      enCurso.add(p.id);
      try {
        const r = await conversar(p);
        resultados.push({ ...r, fallos: revisar(r) });
        console.log(`· ${p.id} (convo ${r.conv}): ${resultados[resultados.length - 1].fallos.length ? "FALLA" : "ok"}`);
      } catch (e) {
        resultados.push({ perfil: p, registro: [], fallos: [`error del banco: ${e.message}`] });
        console.log(`· ${p.id}: error ${e.message}`);
      }
      enCurso.delete(p.id);
    }
  })
);
const texto = resultados
  .map((r) => [`================ ${r.perfil.id} — ${r.perfil.pais} — convo ${r.conv ?? "?"}`, `PERFIL: ${r.perfil.guion}`, ...(r.registro ?? []), `COMPRAS: ${JSON.stringify(r.compras ?? [])}  ENTREGAS: ${JSON.stringify(r.entregas ?? [])}`, r.fallos.length ? `FALLOS:\n  - ${r.fallos.join("\n  - ")}` : "SIN FALLOS"].join("\n"))
  .join("\n\n");
writeFileSync(SALIDA, texto);
const conFallos = resultados.filter((r) => r.fallos.length);
console.log(`\n${resultados.length} conversaciones en ${Math.round((Date.now() - inicio) / 60000)} min · ${conFallos.length} con fallos · detalle en ${SALIDA}`);
for (const r of conFallos) console.log(`  ${r.perfil.id}: ${r.fallos.join(" | ")}`);
