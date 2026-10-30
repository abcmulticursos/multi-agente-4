// EL CONTENIDO EN PIEZAS, Y EL RESPALDO EN GITHUB POR DETRÁS (30/10/2026).
//
// Él: «guardar se demora como 15 segundos, incluso a veces 20… lo que necesito es que guardo y listo,
// al estilo de cualquier programa… cuando yo tenga 200 productos no tener este problema gigantesco».
//
// LO QUE SE MIDIÓ con su contenido (6,8 MB en un solo archivo): leerlo entero 3,9 s, escribirlo 0,8 s,
// releerlo para comprobarlo 3,4 s, y subirlo entero a GitHub ANTES de decir «guardado». Mientras tanto
// el servidor no atiende nada (ni al bot ni al simulador: el «Unexpected token '<'»).
//
// LO QUE HACE ESTE ARCHIVO:
// 1. EL CONTENIDO EN PIEZAS. `config/intro-data.yaml` sigue siendo el archivo de siempre, pero lo pesado
//    vive aparte: cada canal (`channels.<canal>` → contenido/canales/<canal>.yaml), cada tablero
//    (`tableros.<tienda>` → contenido/tableros/<tienda>.yaml) y las plantillas por modalidad
//    (contenido/plantillas.yaml). En el archivo general queda en su sitio una MARCA («@pieza:…») con el
//    nombre de su archivo. Al leer se arma EXACTAMENTE el mismo objeto de antes (mismo orden de claves).
//    Un archivo SIN marcas (el de siempre, una copia de pruebas, un perfil de producto) se lee igual que
//    hoy: las marcas solo se usan donde están.
// 2. AL GUARDAR, SOLO SE ESCRIBE LO QUE CAMBIÓ: una pieza cuyo contenido es el mismo no se reescribe, no
//    se relee y no se sube. El archivo general se reescribe siempre en el disco (así el bot sabe que hay
//    algo nuevo), y se sube solo si cambió.
// 3. GITHUB POR DETRÁS. Lo guardado se escribe en el disco del servidor y en una lista de PENDIENTES en
//    `data/` (el disco permanente, el de las conversaciones: un deploy no lo borra). La subida a GitHub
//    sale después, con reintentos. Al arrancar, lo pendiente se vuelve a poner en su sitio antes de que
//    nadie lea el contenido (un deploy trae lo de GitHub, que puede ir unos segundos por detrás).
//
// Lo que NO cambia: el contenido que lee el bot (el mismo objeto), el seguro contra el vaciado, el aviso
// de «otra pestaña» y el commit «editor: actualiza flujo» en el mismo repositorio.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { Document, isNode, parseDocument, type Node as NodoYaml } from "yaml";
import { isGithubPublishConfigured, publishFilesToGithub } from "@/lib/github";

export const DIR_CONFIG = path.join(process.cwd(), "config");
export const ARCHIVO_GENERAL = path.join(DIR_CONFIG, "intro-data.yaml");
const DIR_PIEZAS = path.join(DIR_CONFIG, "contenido");
const DIR_PENDIENTE = path.join(process.cwd(), "data", "contenido-pendiente");
const MARCA = "@pieza:";

/** Lo que se separa. `porEntrada`: una pieza por cada clave de dentro (cada canal, cada tienda). */
const SEPARADOS: Array<{ clave: string; porEntrada: true; carpeta: string } | { clave: string; porEntrada: false; archivo: string }> = [
  { clave: "channels", porEntrada: true, carpeta: "canales" },
  { clave: "tableros", porEntrada: true, carpeta: "tableros" },
  { clave: "modality_templates", porEntrada: false, archivo: "plantillas.yaml" },
];

type Ruta = string[];
type Pieza = { ruta: Ruta; archivo: string };

const esObjeto = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const esMarca = (v: unknown): v is string => typeof v === "string" && v.startsWith(MARCA);
/** El nombre de archivo de una clave, sin caracteres raros y sin choques («~» + su código). */
const nombreSeguro = (k: string) => k.replace(/[^a-zA-Z0-9_-]/g, (c) => `~${c.charCodeAt(0).toString(16)}`);

function archivoDeLaMarca(marca: string): string {
  const rel = marca.slice(MARCA.length).trim();
  const abs = path.resolve(DIR_PIEZAS, rel);
  if (!abs.startsWith(DIR_PIEZAS + path.sep)) throw new Error(`Pieza fuera de su carpeta: ${rel}`);
  return rel.replace(/\\/g, "/");
}

/** Las marcas que tiene el archivo general (en su orden). */
function marcasDe(general: Record<string, unknown>): Pieza[] {
  const out: Pieza[] = [];
  for (const s of SEPARADOS) {
    const v = general[s.clave];
    if (s.porEntrada) {
      if (!esObjeto(v)) continue;
      for (const [k, x] of Object.entries(v)) if (esMarca(x)) out.push({ ruta: [s.clave, k], archivo: archivoDeLaMarca(x) });
    } else if (esMarca(v)) out.push({ ruta: [s.clave], archivo: archivoDeLaMarca(v) });
  }
  return out;
}

/** Las piezas que saldrían de un contenido entero (lo que se separa y está escrito de verdad). */
function piezasPara(todo: Record<string, unknown>): Pieza[] {
  const out: Pieza[] = [];
  for (const s of SEPARADOS) {
    const v = todo[s.clave];
    if (s.porEntrada) {
      if (!esObjeto(v)) continue;
      for (const [k, x] of Object.entries(v)) if (esObjeto(x)) out.push({ ruta: [s.clave, k], archivo: `${s.carpeta}/${nombreSeguro(k)}.yaml` });
    } else if (esObjeto(v)) out.push({ ruta: [s.clave], archivo: s.archivo });
  }
  return out;
}

function ponerEn(obj: Record<string, unknown>, ruta: Ruta, valor: unknown): void {
  let o = obj;
  for (const k of ruta.slice(0, -1)) o = o[k] as Record<string, unknown>;
  o[ruta[ruta.length - 1]] = valor;
}
function tomarDe(obj: Record<string, unknown>, ruta: Ruta): unknown {
  let o: unknown = obj;
  for (const k of ruta) o = esObjeto(o) ? o[k] : undefined;
  return o;
}

export function escribirSeguro(abs: string, texto: string): void {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, texto, "utf8");
  fs.renameSync(tmp, abs);
}

// ── LO YA LEÍDO, MIENTRAS EL ARCHIVO SEA EL MISMO (fecha y tamaño) ──
type Leido = { mtimeMs: number; size: number; texto: string; js?: Record<string, unknown>; doc?: Document };
const leidos = new Map<string, Leido>();
function leer(abs: string): Leido {
  const st = fs.statSync(abs);
  const ya = leidos.get(abs);
  if (ya && ya.mtimeMs === st.mtimeMs && ya.size === st.size) return ya;
  const nuevo: Leido = { mtimeMs: st.mtimeMs, size: st.size, texto: fs.readFileSync(abs, "utf8") };
  leidos.set(abs, nuevo);
  return nuevo;
}
/** Como `parse` de yaml: un YAML con errores NO se lee a medias (el bot se quedaría con basura). */
function leerYaml(texto: string): Document {
  const d = parseDocument(texto);
  if (d.errors.length) throw d.errors[0];
  return d;
}
function jsDe(l: Leido): Record<string, unknown> {
  // (Siempre a través del documento, que queda leído: leer el YAML es lo caro y convertirlo casi gratis.
  // Así lo leído al abrir el editor sirve también para el primer guardado.)
  if (!l.js) l.js = (docDe(l).toJS() ?? {}) as Record<string, unknown>;
  return l.js;
}
function docDe(l: Leido): Document {
  if (!l.doc) l.doc = leerYaml(l.texto);
  return l.doc;
}
const absDePieza = (archivo: string) => path.join(DIR_PIEZAS, archivo);

/** El texto del archivo general (lo de siempre: quien solo necesite el texto crudo). */
export function textoGeneral(): string {
  aplicarPendientesUnaVez();
  return leer(ARCHIVO_GENERAL).texto;
}

/** ¿El contenido está en piezas? (para quien todavía lee el archivo general a mano). */
export function estaEnPiezas(): boolean {
  return marcasDe(jsDe(leer(ARCHIVO_GENERAL))).length > 0;
}

/**
 * TODO EL CONTENIDO, ARMADO (un objeto nuevo en cada llamada: quien lo cambie no toca lo guardado).
 * Igual que `parseDocument(archivoEntero).toJS()` de antes.
 */
export function contenidoCompleto(): Record<string, unknown> {
  aplicarPendientesUnaVez();
  const general = jsDe(leer(ARCHIVO_GENERAL));
  const marcas = marcasDe(general);
  const out = structuredClone(general);
  for (const m of marcas) ponerEn(out, m.ruta, structuredClone(jsDe(leer(absDePieza(m.archivo)))));
  return out;
}

/**
 * El documento YAML entero (con sus comentarios), para guardar sobre él. El general, siempre un CLON.
 * Las piezas también, salvo `sinClonarPiezas`: el guardado del editor (`/api/workflow`) solo REEMPLAZA
 * canales, tableros y plantillas enteros (`doc.set("channels", …)`), nunca cambia sus nodos por dentro,
 * así que puede usar los ya leídos sin copiarlos (copiar los 7 MB costaba ~1,3 s por guardado).
 */
export function documentoCompleto(sinClonarPiezas = false): Document {
  aplicarPendientesUnaVez();
  const lg = leer(ARCHIVO_GENERAL);
  const doc = docDe(lg).clone();
  for (const m of marcasDe(jsDe(lg))) {
    const pieza = docDe(leer(absDePieza(m.archivo)));
    doc.setIn(m.ruta, sinClonarPiezas ? pieza.contents : pieza.clone().contents);
  }
  return doc;
}

/** El contenido entero como UN solo YAML (perfiles de producto, exportar, la copia de pruebas). */
export function textoCompleto(): string {
  if (!estaEnPiezas()) return textoGeneral();
  return documentoCompleto().toString({ lineWidth: 0 });
}

/**
 * LA HUELLA DEL CONTENIDO, para el aviso de «otra pestaña». Sin piezas es la de siempre (la del
 * archivo), así una pestaña abierta antes de este cambio sigue funcionando.
 */
export function huellaDelContenido(): string {
  const lg = leer(ARCHIVO_GENERAL);
  const h = createHash("sha256").update(lg.texto.replace(/\r\n/g, "\n"));
  for (const m of marcasDe(jsDe(lg))) h.update(`\n#pieza ${m.archivo}\n`).update(leer(absDePieza(m.archivo)).texto.replace(/\r\n/g, "\n"));
  return h.digest("hex").slice(0, 16);
}

/** Fecha y tamaño de todo lo que forma el contenido: cambia si cambia cualquier pieza. */
export function selloDelContenido(): string {
  const lg = leer(ARCHIVO_GENERAL);
  const partes = [`${lg.mtimeMs}:${lg.size}`];
  for (const m of marcasDe(jsDe(lg))) {
    const l = leer(absDePieza(m.archivo));
    partes.push(`${m.archivo}:${l.mtimeMs}:${l.size}`);
  }
  return partes.join("|");
}

/**
 * GUARDAR UN DOCUMENTO ENTERO, EN PIEZAS. Recibe el documento ya cambiado por el guardado. Devuelve los
 * textos a escribir (solo lo que cambió), el contenido tal como queda (releído de lo escrito, para el
 * seguro) y la huella nueva. NO escribe nada: eso lo hace `escribirYRespaldar`, después del seguro.
 */
export function partirParaGuardar(doc: Document): {
  archivos: Array<{ rel: string; abs: string; texto: string; doc?: Document }>;
  loQueQueda: Record<string, unknown>;
  general: string;
  huella: string;
} {
  const todo = (doc.toJS() ?? {}) as Record<string, unknown>;
  const piezas = piezasPara(todo);
  // EL GUARDADO PONE ALGUNAS SECCIONES COMO DATOS SUELTOS («tableros», p. ej.: `doc.set("tableros", objeto)`),
  // no como nodos YAML; al escribir el archivo entero eso se convertía solo. Para poder separarlas, se
  // convierten aquí (lo mismo que hacía el escribir, sin alias entre piezas: el archivo no tiene ninguno).
  for (const p of piezas)
    for (let i = 1; i <= p.ruta.length; i++) {
      const ruta = p.ruta.slice(0, i);
      if (!isNode(doc.getIn(ruta, true))) doc.setIn(ruta, doc.createNode(tomarDe(todo, ruta), { aliasDuplicateObjects: false }));
    }
  const archivos: Array<{ rel: string; abs: string; texto: string; doc?: Document }> = [];
  const jsDeLasPiezas: Array<{ ruta: Ruta; js: unknown; texto: string; archivo: string }> = [];
  for (const p of piezas) {
    const nodo = doc.getIn(p.ruta, true) as NodoYaml;
    const js = tomarDe(todo, p.ruta);
    const abs = absDePieza(p.archivo);
    let anterior: Leido | null = null;
    try {
      anterior = fs.existsSync(abs) ? leer(abs) : null;
    } catch {
      anterior = null;
    }
    // ¿Es lo mismo que ya hay escrito? Entonces no se reescribe, no se relee y no se sube.
    if (anterior && JSON.stringify(jsDe(anterior)) === JSON.stringify(js)) {
      jsDeLasPiezas.push({ ruta: p.ruta, js: jsDe(anterior), texto: anterior.texto, archivo: p.archivo });
    } else {
      const d = new Document();
      d.contents = nodo;
      const texto = d.toString({ lineWidth: 0 });
      // Se relee lo que se va a escribir: si no fuera YAML válido, no se guarda nada (lo de siempre).
      const docReleido = leerYaml(texto);
      const releido = docReleido.toJS();
      archivos.push({ rel: `config/contenido/${p.archivo}`, abs, texto, doc: docReleido });
      jsDeLasPiezas.push({ ruta: p.ruta, js: releido, texto, archivo: p.archivo });
    }
    doc.setIn(p.ruta, `${MARCA}${p.archivo}`);
  }
  const general = doc.toString({ lineWidth: 0 });
  const docGeneral = leerYaml(general);
  const loQueQueda = (docGeneral.toJS() ?? {}) as Record<string, unknown>;
  for (const p of jsDeLasPiezas) ponerEn(loQueQueda, p.ruta, p.js);
  // El general va siempre (y el último): su fecha nueva es la que avisa al bot de que hay algo nuevo.
  archivos.push({ rel: "config/intro-data.yaml", abs: ARCHIVO_GENERAL, texto: general, doc: docGeneral });
  const h = createHash("sha256").update(general.replace(/\r\n/g, "\n"));
  for (const p of jsDeLasPiezas) h.update(`\n#pieza ${p.archivo}\n`).update(p.texto.replace(/\r\n/g, "\n"));
  return { archivos, loQueQueda, general, huella: h.digest("hex").slice(0, 16) };
}

// ── EL RESPALDO EN GITHUB, POR DETRÁS ──

type EstadoDelRespaldo = { publicando: boolean; ultimoOk: number | null; ultimoError: string | null; ultimoIntento: number | null; proximo: number; fallos: number };
// En `globalThis`: Next puede cargar este archivo en más de un paquete (la ruta del editor, el obrero),
// y todos tienen que ver la MISMA cola y el mismo «publicando».
const G = globalThis as unknown as { __respaldoDelContenido?: EstadoDelRespaldo; __pendientesAplicados?: boolean };
const estado: EstadoDelRespaldo = (G.__respaldoDelContenido ??= { publicando: false, ultimoOk: null, ultimoError: null, ultimoIntento: null, proximo: 0, fallos: 0 });

function pendientes(): Array<{ rel: string; abs: string; texto: string }> {
  const out: Array<{ rel: string; abs: string; texto: string }> = [];
  const recorrer = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) recorrer(abs);
      else if (!e.name.endsWith(".tmp")) {
        const rel = path.relative(DIR_PENDIENTE, abs).replace(/\\/g, "/");
        out.push({ rel, abs, texto: fs.readFileSync(abs, "utf8") });
      }
    }
  };
  recorrer(DIR_PENDIENTE);
  // El general, el último (como al escribir): sus marcas apuntan a piezas que ya están.
  return out.sort((a, b) => Number(a.rel === "config/intro-data.yaml") - Number(b.rel === "config/intro-data.yaml"));
}

/**
 * AL ARRANCAR, LO PENDIENTE VUELVE A SU SITIO (una vez por proceso, antes de leer nada). Un deploy trae el
 * contenido de GitHub; si el último guardado aún no había subido, lo de `data/` es lo más nuevo.
 */
function aplicarPendientesUnaVez(): void {
  if (G.__pendientesAplicados) return;
  G.__pendientesAplicados = true;
  try {
    const lista = pendientes();
    for (const p of lista) {
      if (!p.rel.startsWith("config/")) continue;
      const destino = path.join(process.cwd(), p.rel);
      const actual = fs.existsSync(destino) ? fs.readFileSync(destino, "utf8") : null;
      if (actual !== p.texto) escribirSeguro(destino, p.texto);
    }
    if (lista.length) console.log(`[contenido] al arrancar: ${lista.length} archivo(s) pendientes de subir a GitHub, puestos en su sitio`);
  } catch (err) {
    console.error("[contenido] no se pudo aplicar lo pendiente:", err);
  }
}

/**
 * ESCRIBIR LO GUARDADO Y DEJARLO EN COLA PARA GITHUB. Primero la cola (en el disco permanente), después el
 * contenido (piezas antes que el general). Si la cola no se puede escribir, no se escribe nada.
 */
export function escribirYRespaldar(archivos: Array<{ rel: string; abs: string; texto: string; doc?: Document }>): void {
  const subir = archivos.filter((a) => {
    if (a.abs !== ARCHIVO_GENERAL) return true;
    try {
      return fs.readFileSync(ARCHIVO_GENERAL, "utf8") !== a.texto;
    } catch {
      return true;
    }
  });
  for (const a of subir) escribirSeguro(path.join(DIR_PENDIENTE, a.rel), a.texto);
  for (const a of archivos) {
    escribirSeguro(a.abs, a.texto);
    // Lo recién escrito ya está leído (se releyó para comprobarlo): no se vuelve a leer del disco.
    if (a.doc) {
      const st = fs.statSync(a.abs);
      leidos.set(a.abs, { mtimeMs: st.mtimeMs, size: st.size, texto: a.texto, doc: a.doc });
    }
  }
  if (subir.length) {
    estado.proximo = 0;
    estado.fallos = 0;
    void publicarPendientes();
  }
}

/** Sube a GitHub lo que esté pendiente, en UN commit. Sin solaparse; con reintentos crecientes. */
export async function publicarPendientes(): Promise<boolean> {
  if (estado.publicando || !isGithubPublishConfigured()) return false;
  const lista = pendientes();
  if (lista.length === 0) return true;
  estado.publicando = true;
  estado.ultimoIntento = Date.now();
  try {
    const r = await publishFilesToGithub(lista.map((p) => ({ path: p.rel, content: p.texto })), "editor: actualiza flujo");
    if (!r.ok) throw new Error(r.error ?? "GitHub no respondió");
    // Solo se quita lo que se subió TAL CUAL: si mientras tanto se guardó otra vez, eso sigue en cola.
    for (const p of lista) {
      try {
        if (fs.readFileSync(p.abs, "utf8") === p.texto) fs.unlinkSync(p.abs);
      } catch {
        /* ya no estaba */
      }
    }
    estado.ultimoOk = Date.now();
    estado.ultimoError = null;
    estado.proximo = 0;
    estado.fallos = 0;
    console.log(`[contenido] subido a GitHub: ${lista.length} archivo(s)`);
    return true;
  } catch (err) {
    estado.ultimoError = err instanceof Error ? err.message : String(err);
    // 10 s, 20 s, 40 s, 80 s… hasta 5 min entre intentos.
    estado.fallos += 1;
    const espera = Math.min(300_000, 10_000 * 2 ** (estado.fallos - 1));
    estado.proximo = Date.now() + espera;
    console.error(`[contenido] no se pudo subir a GitHub (reintento en ${Math.round(espera / 1000)} s):`, estado.ultimoError);
    return false;
  } finally {
    estado.publicando = false;
  }
}

/** Para el obrero (cada 2 s): si hay algo pendiente y ya toca, lo intenta. */
export function publicarSiToca(): void {
  if (estado.publicando || Date.now() < estado.proximo) return;
  try {
    if (!fs.existsSync(DIR_PENDIENTE) || pendientes().length === 0) return;
  } catch {
    return;
  }
  void publicarPendientes();
}

/** Lo que ve el editor arriba: «☁ respaldando…», «☁ ✓» o «sin respaldar». */
export function estadoDelRespaldo(): { pendientes: number; publicando: boolean; ultimoOk: number | null; ultimoError: string | null; proximo: number } {
  let n = 0;
  try {
    n = pendientes().length;
  } catch {
    n = 0;
  }
  return { pendientes: n, publicando: estado.publicando, ultimoOk: estado.ultimoOk, ultimoError: n ? estado.ultimoError : null, proximo: estado.proximo };
}
