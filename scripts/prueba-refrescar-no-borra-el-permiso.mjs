// EL PERMISO NO SE PIERDE AL REFRESCAR.
//
// EL RIESGO: al añadir `business_id`, `business_name` y `compartido_con`, se tocó el
// `INSERT … ON CONFLICT` de `meta_whatsapp_connections` y de `meta_connections`. Si alguna
// de esas dos escrituras dejara el token vacío o lo sustituyera por nada, EL BOT SE QUEDA
// MUDO — y no da error: la conversación entra, y no sale nada.
//
// Cómo se prueba: se sacan de `db.ts` las tablas, sus columnas añadidas y las dos
// escrituras TAL CUAL ESTÁN, y se ejecutan contra una base en memoria. No se reescribe
// ninguna de memoria. Después se mira, en el código, que a esas escrituras nunca les llegue
// un token vacío.
//
//   node scripts/prueba-refrescar-no-borra-el-permiso.mjs
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");
const DB = leer("src", "lib", "db.ts");
const CONNECT = leer("src", "lib", "meta", "connect.ts");
const CALLBACK = leer("src", "app", "api", "meta", "connect", "callback", "route.ts");

let fallos = 0;
const pad = (s, n) => (String(s ?? "") + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 64)} ${valor}`);
};

const sacar = (re, que) => {
  const m = DB.match(re);
  if (!m) {
    console.log(`FALLA no encuentro en db.ts: ${que}`);
    process.exit(1);
  }
  return m[1] ?? m[0];
};

const base = new Database(":memory:");
for (const tabla of ["meta_connections", "meta_whatsapp_connections"]) {
  base.exec(sacar(new RegExp(`CREATE TABLE IF NOT EXISTS ${tabla} \\([\\s\\S]*?\\);`), `la tabla ${tabla}`));
}
const alters = [...DB.matchAll(/"(ALTER TABLE meta_(?:whatsapp_)?connections ADD COLUMN [^"]+)"/g)].map((m) => m[1]);
for (const a of alters) {
  try {
    base.exec(a);
  } catch {
    // Ya existía: igual que en db.ts.
  }
}
const upsertWa = base.prepare(sacar(/`(INSERT INTO meta_whatsapp_connections[\s\S]*?)`/, "la escritura del número"));
const upsertPag = base.prepare(sacar(/`(INSERT INTO meta_connections\s[\s\S]*?)`/, "la escritura de la página"));

// Mismo orden de parámetros que saveMetaWhatsAppConnection / saveMetaConnection.
const numero = ({ token, negocio = null, nombre = null, activo = 0 }) =>
  upsertWa.run("PN1", "WABA1", "+51 999", "Tienda", null, token, activo, negocio, nombre, null);
const pagina = ({ token, negocio = null, nombre = null }) =>
  upsertPag.run("PG1", "Mi página", token, null, null, null, 1, 0, negocio, nombre, null);
const tokenNumero = () => base.prepare("SELECT access_token t, business_id b, business_name n, active a FROM meta_whatsapp_connections WHERE phone_number_id='PN1'").get();
const tokenPagina = () => base.prepare("SELECT page_access_token t, business_id b, business_name n FROM meta_connections WHERE page_id='PG1'").get();

console.log("\n— 1. el número de WhatsApp —\n");
numero({ token: "TOKEN-1", negocio: "B1", nombre: "Negocio uno", activo: 1 });
comprobar("al conectar se guarda su permiso", tokenNumero().t === "TOKEN-1");
numero({ token: "TOKEN-2" });
comprobar("al refrescar, el permiso nuevo sustituye al viejo", tokenNumero().t === "TOKEN-2");
comprobar("y el negocio que Meta no contestó se conserva", tokenNumero().b === "B1" && tokenNumero().n === "Negocio uno");
comprobar("y el número sigue activo", tokenNumero().a === 1);
let rechazo = false;
try {
  numero({ token: null });
} catch {
  rechazo = true;
}
comprobar("un refresco SIN permiso no se guarda", rechazo, "la base lo rechaza");
comprobar("y el permiso de antes sigue ahí", tokenNumero().t === "TOKEN-2");

console.log("\n— 2. la página de Facebook —\n");
pagina({ token: "PAGINA-1", negocio: "B1", nombre: "Negocio uno" });
comprobar("al conectar se guarda su permiso", tokenPagina().t === "PAGINA-1");
pagina({ token: "PAGINA-2" });
comprobar("al refrescar, el permiso nuevo sustituye al viejo", tokenPagina().t === "PAGINA-2");
comprobar("y el negocio que Meta no contestó se conserva", tokenPagina().b === "B1" && tokenPagina().n === "Negocio uno");
rechazo = false;
try {
  pagina({ token: null });
} catch {
  rechazo = true;
}
comprobar("un refresco SIN permiso no se guarda", rechazo, "la base lo rechaza");
comprobar("y el permiso de antes sigue ahí", tokenPagina().t === "PAGINA-2");

console.log("\n— 3. a esas escrituras nunca les llega un permiso vacío —\n");
// La base acepta un texto vacío (la columna es NOT NULL, pero "" no es NULL). Por eso
// lo que protege es que el vacío no llegue: se mira cada puerta.
comprobar(
  "el permiso del login: sin token, Meta Connect se corta",
  /if \(!longRes\.ok \|\| !longBody\.access_token\) \{\s*throw/.test(CONNECT) &&
    /if \(!shortRes\.ok \|\| !shortBody\.access_token\) \{\s*throw/.test(CONNECT),
  "exchangeCodeForUserToken"
);
comprobar(
  "las páginas sin permiso ni se guardan",
  /\.filter\(\(page\) => page\.id && page\.name && page\.access_token\)/.test(CONNECT),
  "fetchConnectedPages"
);
comprobar(
  "el número se guarda con el permiso del login",
  /accessToken: userToken,/.test(CALLBACK)
);
const quienLlama = archivosDe(join(RAIZ, "src"))
  .filter((f) => !f.endsWith(join("lib", "db.ts")))
  .filter((f) => /saveMeta(?:WhatsApp)?Connection\(/.test(readFileSync(f, "utf8")))
  .map((f) => f.slice(RAIZ.length + 1));
comprobar(
  "y nadie más escribe en esas tablas",
  quienLlama.length === 1 && quienLlama[0].includes("callback"),
  quienLlama.join(", ")
);
const otrasEscrituras = /UPDATE meta_(?:whatsapp_)?connections SET [^"`]*(?:access_token|page_access_token)/.test(DB);
comprobar("ningún UPDATE suelto toca el permiso", !otrasEscrituras);

function archivosDe(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? archivosDe(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []
  );
}

console.log("");
if (fallos > 0) {
  console.log(`${fallos} FALLA(S)`);
  process.exit(1);
}
console.log("TODO OK — refrescar sustituye el permiso por otro real, nunca por nada");
