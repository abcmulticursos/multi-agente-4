#!/usr/bin/env node
/**
 * AUDITORIA DEL PROYECTO — SOLO LECTURA. No modifica ningun archivo.
 *
 * Uso:  node scripts/auditoria.cjs      (desde la raiz del proyecto)
 *
 * Para que sirve: antes de cambiar cualquier cosa, este script vuelve a leer
 * el codigo y el contenido REALES y reporta el estado del momento. Un
 * documento se desactualiza; esto no, porque se re-deriva en cada ejecucion.
 *
 * Que revisa:
 *   1. Identidad del proyecto (carpeta, repo, producto activo)
 *   2. Datos de producto codificados en el MOTOR (nunca deberia haber ninguno)
 *   3. Modalidades y su producto
 *   4. Canales
 *   5. Contradicciones de cifras entre contenido, galeria e intros
 *   6. Matriz modalidad x pais (precios y titular de comprobantes)
 *   7. Aislamiento de cajones: campos que una modalidad heredaria de otra
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = process.cwd();
const YAML = require(path.join(ROOT, "node_modules", "yaml"));

const CONFIG = path.join(ROOT, "config", "intro-data.yaml");
const MODOS = ["lineal", "order_bump", "bioferta", "doble_oferta_dos"];
const CANALES = ["whatsapp", "messenger", "instagram", "tiktok"];

const hr = (t) => {
  console.log("\n" + "=".repeat(72));
  console.log(t);
  console.log("=".repeat(72));
};
const ok = (t) => console.log("   OK    " + t);
const warn = (t) => console.log("  AVISO  " + t);
const bad = (t) => console.log("  *****  " + t);

if (!fs.existsSync(CONFIG)) {
  console.error("No encuentro config/intro-data.yaml. Ejecuta desde la raiz del proyecto.");
  process.exit(1);
}
const cfg = YAML.parse(fs.readFileSync(CONFIG, "utf8"));

// ───────────────────────────────────────────────────────────── 1
hr("1. IDENTIDAD DEL PROYECTO");
console.log("  carpeta        : " + path.basename(ROOT));
let repo = "(sin git)";
let rama = "";
let estado = "";
try {
  repo = execSync("git remote get-url origin", { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  rama = execSync("git branch --show-current", { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  const sucios = execSync("git status --porcelain", { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  estado = sucios ? sucios.split("\n").length + " archivo(s) sin commitear" : "limpio";
} catch { /* sin git */ }
console.log("  repo           : " + repo);
console.log("  rama           : " + rama + "   (" + estado + ")");
console.log("  producto activo: " + cfg.product_name);

// ───────────────────────────────────────────────────────────── 2
hr("2. DATOS DE PRODUCTO CODIFICADOS EN EL MOTOR (no deberia haber ninguno)");
console.log("  El motor debe ser generico: el unico origen de datos comerciales");
console.log("  es el contenido del editor. Un numero o nombre de producto escrito");
console.log("  en el codigo viaja al modelo y produce respuestas inventadas.\n");
const ARCHIVOS_MOTOR = [
  "src/lib/openrouter.ts",
  "src/lib/system-prompt.ts",
  "src/lib/workflow/config.ts",
  "src/lib/workflow/engine.ts",
  "src/lib/meta/handler.ts",
];
// Vocabulario de producto: nunca deberia aparecer en el codigo del motor.
const RX_VOCABULARIO = /papercraft|mascaras?|máscaras?|\bmasks\b|origami|kpop|guerreras|minecraft|flores de papel|grafismo|lectoescritura/i;
// Cifra pegada a un sustantivo de cantidad de producto (ej. "1000 into 100"
// dentro de una frase sobre "product quantities"). Se excluyen los numeros de
// datos de pago, que son otra cosa (ej. "999 999 999" en PAYMENT DATA SAFETY).
const RX_CANTIDAD = /\b\d{2,5}\b/;
const RX_CONTEXTO_PRODUCTO = /quantit|item count|page count|template count|bonus|model|flower|flor|video|plantilla|molde|personaje/i;
const RX_CONTEXTO_PAGO = /payment|account|phone number|yape|plin|cci|interbank|holder/i;
let sospechas = 0;
for (const rel of ARCHIVOS_MOTOR) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) continue;
  const lineas = fs.readFileSync(abs, "utf8").split("\n");
  lineas.forEach((linea, i) => {
    const t = linea.trim();
    if (t.startsWith("//") || t.startsWith("*")) return;      // comentarios no llegan al modelo
    if (!t.includes("prompt +=") && !t.includes("SYSTEM_PROMPT")) return;
    const porVocabulario = RX_VOCABULARIO.test(t);
    const porCifra = RX_CANTIDAD.test(t) && RX_CONTEXTO_PRODUCTO.test(t) && !RX_CONTEXTO_PAGO.test(t);
    if (!porVocabulario && !porCifra) return;
    sospechas++;
    bad(`${rel}:${i + 1}  (${porVocabulario ? "vocabulario de producto" : "cifra de cantidad"})`);
    console.log("         " + t.slice(0, 150));
  });
}
if (sospechas === 0) ok("Sin datos de producto codificados en las lineas de prompt.");

// ───────────────────────────────────────────────────────────── 3
hr("3. MODALIDADES");
const flags = {
  doble_oferta_dos: cfg.doble_oferta_dos?.enabled === true,
  order_bump: cfg.order_bump?.enabled === true,
  bioferta: cfg.bioferta_doble?.enabled === true,
};
const activa = flags.doble_oferta_dos ? "doble_oferta_dos"
  : flags.order_bump ? "order_bump"
  : flags.bioferta ? "bioferta" : "lineal";
const mt = cfg.modality_templates ?? {};
for (const m of MODOS) {
  const marca = m === activa ? " <== ACTIVA" : "";
  console.log(`  ${m.padEnd(18)} ${String(mt[m]?.product_name ?? "(sin cajon)").padEnd(34)}${marca}`);
}

// ───────────────────────────────────────────────────────────── 4
hr("4. CANALES");
for (const ch of CANALES) {
  const c = cfg.channels?.[ch];
  console.log(`  ${ch.padEnd(10)} enabled=${String(c?.enabled ?? false).padEnd(6)} use_content=${String(c?.use_content ?? false)}`);
}

// ───────────────────────────────────────────────────────────── 5
hr("5. CIFRAS: CONTRADICCIONES ENTRE CONTENIDO, GALERIA E INTROS");
console.log("  Si dos sitios dan cifras distintas, el modelo duda y responde");
console.log("  'no tengo una cantidad exacta'. Deben coincidir.\n");
const fuentes = [];
const push = (origen, texto) => {
  for (const l of String(texto).split("\n")) {
    if (/\b\d+\b/.test(l) && /model|flor|video|pdf|pagina|página|molde|plantilla|personaje|item/i.test(l)) {
      fuentes.push({ origen, linea: l.trim().slice(0, 100) });
    }
  }
};
push("course_content", cfg.course_content ?? "");
for (const g of cfg.image_gallery ?? []) push("galeria", g.caption ?? "");
const introsCanal = cfg.channels?.whatsapp?.modality_templates?.[activa]?.intro_groups ?? [];
for (const grupo of introsCanal) {
  if (grupo?.enabled === false) continue;
  for (const step of grupo.steps ?? []) {
    if (step?.enabled === false) continue;
    for (const b of [step.body, ...(step.body_variants ?? []), step.caption, ...(step.caption_variants ?? [])]) {
      if (b) push("intro:" + (grupo.name ?? "?"), b);
    }
  }
}
if (fuentes.length === 0) ok("Sin cifras de contenido detectadas.");
else for (const f of fuentes) console.log(`  [${f.origen}] ${f.linea}`);

// ───────────────────────────────────────────────────────────── 6
hr("6. MATRIZ MODALIDAD x PAIS (precio y titular que valida comprobantes)");
const mpp = cfg.modality_payment_profiles ?? {};
const base = cfg.payment_profiles_by_country ?? {};
console.log("  ventas habilitadas: " + JSON.stringify(cfg.country_sales_enabled ?? {}));
const paises = [...new Set([...Object.keys(base), ...Object.values(mpp).flatMap((v) => Object.keys(v ?? {}))])];
for (const m of MODOS) {
  for (const p of paises) {
    if (cfg.country_sales_enabled && cfg.country_sales_enabled[p] === false) continue;
    const capa = mpp[m]?.[p];
    const usado = capa ?? base[p];
    const origen = capa ? "propio" : base[p] ? "HEREDADO de BASE" : "NINGUNO";
    console.log(`  ${m.padEnd(18)} ${p}  precio=${String(usado?.course_price_soles ?? "-").padEnd(6)} titular="${usado?.payment_validation?.yape_recipient_name_starts_with ?? "-"}"  [${origen}]`);
  }
}

// ───────────────────────────────────────────────────────────── 7
hr("7. AISLAMIENTO: CAMPOS QUE UNA MODALIDAD HEREDARIA DE OTRA");
console.log("  Un campo ausente en un cajon NO queda vacio: toma el valor que");
console.log("  dejo la ultima modalidad activa. Eso mezcla productos.\n");
const SUPERFICIE = ["followups", "greeting", "globals", "post_gift_comment_auto_human_enabled",
  "offer", "course_content", "product_name", "image_gallery", "samples_after_sequence",
  "product_info_topics", "extra_info_topics", "detail_gallery", "payment_approved",
  "email", "email_vip", "postventa", "gift", "dynamic_fields"];
let fugas = 0;
for (const m of MODOS) {
  const t = mt[m];
  if (!t) { warn(`${m}: sin cajon -> heredaria TODO`); fugas++; continue; }
  const faltan = SUPERFICIE.filter((f) => t[f] === undefined);
  if (faltan.length === 0) ok(`${m}: completo`);
  else { warn(`${m}: heredaria ${faltan.length} campo(s) -> ${faltan.join(", ")}`); fugas += faltan.length; }
}

hr("RESUMEN");
console.log("  datos de producto en el motor : " + (sospechas === 0 ? "0  (correcto)" : sospechas + "  <== REVISAR"));
console.log("  campos que heredarian         : " + fugas);
console.log("  modalidad activa              : " + activa);
console.log("  producto activo               : " + cfg.product_name);
console.log("\n  Este script NO modifica nada. Ejecutalo antes y despues de cualquier cambio.\n");
