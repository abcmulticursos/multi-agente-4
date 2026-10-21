// EL KANBAN NO ESCONDE CONVERSACIONES.
//
// EL RIESGO: `/api/conversations` ahora resuelve la tienda de cada fila. Si una conversación
// entró por un número que ya no pertenece a ninguna tienda, su `tienda_nombre` queda vacío.
// Con el filtro en «Todas las tiendas» esa tarjeta TIENE QUE SEGUIR SALIENDO.
//
//   - Sin filtro de tienda, salen TODAS, incluidas las de tienda vacía
//   - La suma de las tarjetas de cada tienda, más las sin tienda, da el total
//   - `/api/conversations` sigue devolviendo todos los campos que ya devolvía
//
// Ejecuta DE VERDAD la ruta (`src/app/api/conversations/route.ts`) con el `config.ts` real y
// una configuración inventada, y los dos trozos del tablero que deciden qué tarjeta sale
// —el filtro por tienda y la lista del desplegable—, sacados de `KanbanBoard.tsx`.
//
//   node scripts/prueba-el-kanban-no-pierde-tarjetas.mjs
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { stringify as aYaml } from "yaml";

const RAIZ = process.cwd();
const DOBLE_DB = "stub:db";
const DOBLE_NEXT = "stub:next";

// Las filas tal como las devuelve la base: con campos de todo tipo, para ver que llegan
// enteras. La 4 entró por un número que ya no es de ninguna tienda; la 5, por Messenger
// de una página que tampoco; la 6 está anotada en una tienda que se borró.
const FILAS = [
  { id: 1, phone: "51900000001", wa_phone_number_id: "111", state: "new", mode: "AI", created_at: 1, ctwa_clid: "c1", amount_paid_cents: 0 },
  { id: 2, phone: "51900000002", wa_phone_number_id: "111", state: "payment_approved", mode: "AI", created_at: 2, ctwa_clid: null, amount_paid_cents: 1500 },
  { id: 3, phone: "51900000003", wa_phone_number_id: "222", state: "intro_done", mode: "HUMAN", created_at: 3, ctwa_clid: null, amount_paid_cents: 0 },
  { id: 4, phone: "51900000004", wa_phone_number_id: "999", state: "new", mode: "AI", created_at: 4, ctwa_clid: null, amount_paid_cents: 0 },
  { id: 5, phone: "psid-5", wa_phone_number_id: null, messenger_page_id: "PAG-X", state: "new", mode: "AI", created_at: 5, ctwa_clid: null, amount_paid_cents: 0 },
  { id: 6, phone: "51900000006", wa_phone_number_id: "999", tienda_id: "borrada", state: "new", mode: "AI", created_at: 6, ctwa_clid: null, amount_paid_cents: 0 },
];

registerHooks({
  resolve(esp, ctx, next) {
    if (esp === "@/lib/db") return { url: DOBLE_DB, format: "module", shortCircuit: true };
    if (esp === "next/server") return { url: DOBLE_NEXT, format: "module", shortCircuit: true };
    if (esp.startsWith("@/")) {
      const rel = esp.slice(2);
      const conExt = /\.[a-z]+$/.test(rel) ? rel : `${rel}.ts`;
      return { url: pathToFileURL(join(RAIZ, "src", conExt)).href, shortCircuit: true };
    }
    return next(esp, ctx);
  },
  load(url, ctx, next) {
    if (url === DOBLE_DB)
      return {
        format: "module", shortCircuit: true,
        source: `
          const FILAS = ${JSON.stringify(FILAS)};
          export const listConversations = (limite) => (limite ? FILAS.slice(0, limite) : FILAS).map((f) => ({ ...f }));
          export const getConversationByPhone = () => null;
          export const getConversationById = () => null;
          export const getFrozenPrices = () => null;
          export const getUpsellFrozenPrices = () => null; export const getPuestoEnLaFila = () => null; export const leerCompradosDeLaFila = () => []; export const moverLaFila = () => {};
          export const setFrozenPrices = () => {};
        `,
      };
    if (url === DOBLE_NEXT)
      return {
        format: "module", shortCircuit: true,
        source: `export const NextResponse = { json: (cuerpo) => ({ cuerpo }) };`,
      };
    return next(url, ctx);
  },
});

let fallos = 0;
const pad = (s, n) => (String(s ?? "") + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 62)} ${valor}`);
};

const CASA = mkdtempSync(join(tmpdir(), "kanban-tiendas-"));
mkdirSync(join(CASA, "config"), { recursive: true });
writeFileSync(
  join(CASA, "config", "intro-data.yaml"),
  aYaml({
    country: "PE",
    greeting: { body_variants: ["hola"] },
    intro_sequence: [{ type: "text", body_variants: ["la intro"] }],
    payment_responses: { yape: [{ type: "text", body_variants: ["datos"] }] },
    course_price_soles: 10,
    tiendas: [
      { id: "ta", nombre: "TIENDA A", numero: "111", color: "#ff0000" },
      { id: "tb", nombre: " TIENDA B ", numero: "222" },
    ],
  }),
  "utf8"
);
process.chdir(CASA);
const ruta = await import(pathToFileURL(join(RAIZ, "src", "app", "api", "conversations", "route.ts")).href);
const pedir = async (consulta = "") =>
  (await ruta.GET({ nextUrl: new URL(`http://x/api/conversations${consulta}`) })).cuerpo;

// ── Los dos trozos del tablero, sacados del archivo y ejecutados ──
const TABLERO = readFileSync(join(RAIZ, "src", "components", "KanbanBoard.tsx"), "utf8");
const sacar = (re, que) => {
  const m = TABLERO.match(re);
  if (!m) {
    console.log(`FALLA no encuentro en KanbanBoard.tsx: ${que}`);
    process.exit(1);
  }
  return m[1];
};
const filtroCodigo = sacar(
  /return (tiendaFiltro\s*\?\s*porOrigen\.filter\([^;]*?\)\s*:\s*porOrigen);/,
  "el filtro por tienda"
);
const filtrar = new Function("porOrigen", "tiendaFiltro", `return ${filtroCodigo};`);
const desplegableCodigo = sacar(
  /(const porNombre = new Map[\s\S]*?\.sort\(\(a, b\) => b\.cuantos - a\.cuantos\);)/,
  "la lista de tiendas del desplegable"
)
  .replace(/new Map<[^>]*\}>\(\)/, "new Map()")
  .replace(/^\s*return /m, "return ");
const desplegable = new Function(
  "base", "paisFiltro", "origenFiltro", "paisDe", "origenDe",
  desplegableCodigo
);

console.log("\n— 1. la ruta —\n");
const { conversations } = await pedir();
comprobar("devuelve todas las filas", conversations.length === FILAS.length, `${conversations.length} de ${FILAS.length}`);
const tienda = (id) => conversations.find((c) => c.id === id)?.tienda_nombre ?? null;
comprobar("la del 111 es de TIENDA A", tienda(1) === "TIENDA A");
comprobar("la del 222 es de TIENDA B, sin espacios", tienda(3) === "TIENDA B");
comprobar("la del número huérfano queda sin tienda, pero está", conversations.some((c) => c.id === 4) && tienda(4) === null);
comprobar("la de una página sin tienda, igual", conversations.some((c) => c.id === 5) && tienda(5) === null);
comprobar("la anotada en una tienda borrada, igual", conversations.some((c) => c.id === 6) && tienda(6) === null);
comprobar("trae el color de la tienda", conversations.find((c) => c.id === 1)?.tienda_color === "#ff0000");
{
  const perdidos = [];
  for (const f of FILAS) {
    const llega = conversations.find((c) => c.id === f.id) ?? {};
    for (const [k, v] of Object.entries(f)) if (JSON.stringify(llega[k]) !== JSON.stringify(v)) perdidos.push(`${f.id}.${k}`);
  }
  comprobar("cada campo que ya traía llega igual", perdidos.length === 0, perdidos.join(", "));
}
const parcial = await pedir("?limite=2");
comprobar("con ?limite sigue cortando y avisando", parcial.conversations.length === 2 && parcial.parcial === true);

console.log("\n— 2. el tablero —\n");
const todas = filtrar(conversations, null);
comprobar("en «Todas las tiendas» salen todas", todas.length === conversations.length, `${todas.length}`);
comprobar("incluidas las sin tienda", [4, 5, 6].every((id) => todas.some((c) => c.id === id)));
const lista = desplegable(conversations, null, null, () => "", () => "");
const porTienda = lista.reduce((s, t) => s + filtrar(conversations, t.nombre).length, 0);
const sinTienda = conversations.filter((c) => !(c.tienda_nombre ?? "").trim()).length;
comprobar(
  "cada tienda + las sin tienda = el total",
  porTienda + sinTienda === conversations.length,
  `${porTienda} + ${sinTienda} = ${conversations.length}`
);
comprobar(
  "y el número del desplegable cuadra con lo que se ve",
  lista.every((t) => filtrar(conversations, t.nombre).length === t.cuantos),
  lista.map((t) => `${t.nombre} (${t.cuantos})`).join(", ")
);
comprobar("el desplegable no inventa una tienda vacía", lista.every((t) => t.nombre));

console.log("");
if (fallos > 0) {
  console.log(`${fallos} FALLA(S)`);
  process.exit(1);
}
console.log("TODO OK — ninguna tarjeta se pierde, y las cuentas por tienda cuadran");
