// De dónde llegó cada lead: anuncio, comentario u orgánico.
//
// El error fácil aquí es mirar solo `ad_source_id`. Una conversación puede
// traer el click del anuncio (`ctwa_clid`) sin que se haya resuelto todavía
// QUÉ anuncio fue — mirando solo el id la daríamos por orgánica, y no lo es.
// Esta prueba fija esa distinción, y que el chat y el Kanban usen la misma.
//
//   node scripts/prueba-origen-lead.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const RAIZ = process.cwd();
const TMP = join(RAIZ, "scripts", "_tmp-origen");
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

writeFileSync(
  join(TMP, "tsconfig.json"),
  JSON.stringify(
    {
      compilerOptions: {
        outDir: ".",
        module: "commonjs",
        target: "es2022",
        moduleResolution: "node",
        skipLibCheck: true,
        esModuleInterop: true,
        noEmit: false,
        baseUrl: "../..",
        paths: { "@/*": ["src/*"] },
      },
      include: ["../../src/lib/origen-de-lead.ts"],
    },
    null,
    2
  ),
  "utf8"
);

try {
  execFileSync(
    process.execPath,
    [join(RAIZ, "node_modules", "typescript", "bin", "tsc"), "-p", join(TMP, "tsconfig.json")],
    { stdio: "pipe" }
  );
} catch {
  // Si de verdad no se escribió nada, el require de abajo falla y nos enteramos.
}

const require = createRequire(import.meta.url);
const { origenDeLead, vinoDeAnuncio, ETIQUETA_DE_ORIGEN } = require(
  join(TMP, "origen-de-lead.js")
);

const casos = [
  {
    nombre: "click de anuncio y anuncio resuelto",
    lead: { ctwa_clid: "abc123", ad_source_id: "120555", lead_origin: null },
    origen: "anuncio",
  },
  {
    nombre: "EL CASO FINO: click de anuncio pero sin anuncio resuelto",
    lead: { ctwa_clid: "abc123", ad_source_id: null, lead_origin: null },
    origen: "anuncio",
  },
  {
    nombre: "anuncio resuelto pero sin click guardado",
    lead: { ctwa_clid: null, ad_source_id: "120555", lead_origin: null },
    origen: "anuncio",
  },
  {
    nombre: "ORGÁNICO: ni click ni anuncio",
    lead: { ctwa_clid: null, ad_source_id: null, lead_origin: null },
    origen: "organico",
  },
  {
    nombre: "orgánico con campos en blanco (no en null)",
    lead: { ctwa_clid: "   ", ad_source_id: "", lead_origin: null },
    origen: "organico",
  },
  {
    nombre: "comentario de Facebook",
    lead: { ctwa_clid: null, ad_source_id: null, lead_origin: "comment" },
    origen: "comentario",
  },
  {
    nombre: "comentario manda sobre el anuncio",
    lead: { ctwa_clid: "abc123", ad_source_id: "120555", lead_origin: "comment" },
    origen: "comentario",
  },
  {
    nombre: "lead pelado, sin ninguno de los campos",
    lead: {},
    origen: "organico",
  },
];

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);

for (const caso of casos) {
  const origen = origenDeLead(caso.lead);
  const ok = origen === caso.origen;
  if (!ok) fallos++;
  console.log(
    `${ok ? "ok   " : "FALLA"} ${pad(caso.nombre, 52)} ${pad(origen, 12)} ${ETIQUETA_DE_ORIGEN[origen]}`
  );
  if (!ok) console.log(`        esperaba ${caso.origen}`);
}

// Lo que hacía el código de antes: mirar solo el id del anuncio. Se deja como
// comprobación para que quede claro qué caso arregla este módulo.
const soloPorId = (lead) => Boolean(lead.ad_source_id);
const conClickSinId = { ctwa_clid: "abc123", ad_source_id: null };
const comprobar = (nombre, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(nombre, 52)} ${valor}`);
};
comprobar(
  "mirar solo el id habría dicho 'orgánico' y se equivocaba",
  soloPorId(conClickSinId) === false && vinoDeAnuncio(conClickSinId) === true,
  "el módulo lo detecta como anuncio"
);

// Y que el Kanban use esta misma regla, no una copia suya.
const kanban = readFileSync(join(RAIZ, "src", "components", "KanbanBoard.tsx"), "utf8");
comprobar(
  "el Kanban usa la regla compartida, no su propia copia",
  kanban.includes("vinoDeAnuncio(c)") &&
    !kanban.includes("Boolean(c.ctwa_clid?.trim() || c.ad_source_id?.trim())"),
  "sí"
);
comprobar(
  "el reparto de dinero tampoco tiene su propia copia de la regla",
  kanban.includes("vinoDeAnuncio(convo) ? \"ad\" : \"organic\"") &&
    !kanban.includes("convo.ctwa_clid?.trim() || convo.ad_source_id?.trim()"),
  "sí"
);
comprobar(
  "la tarjeta del Kanban muestra el origen aunque no sea una venta",
  // La insignia tiene que quedar FUERA del bloque de showMoney: antes solo
  // aparecía en la vista de ventas y en el tablero normal no se veía nada.
  // Desde el 09/10/2026 la etiqueta de la TIENDA va delante del origen, dentro del mismo
  // bloque (KanbanBoard, «LA TIENDA, CON SU COLOR»). Lo que se vigila sigue igual: que el
  // origen esté en ese bloque, el de siempre, y no dentro de showMoney.
  /<div className="mb-1 flex flex-wrap items-center gap-1 text-\[10px\] font-semibold">\s*(?:\{\/\*[\s\S]*?\*\/\}\s*\{convo\.tienda_nombre && \([\s\S]*?\)\}\s*)?<span className=\{INSIGNIA_DE_ORIGEN/.test(
    kanban
  ),
  "sí"
);
comprobar(
  "la tarjeta distingue las tres vías, no solo dos",
  kanban.includes("comentario: \"Comentario\""),
  "sí"
);

const panel = readFileSync(
  join(RAIZ, "src", "components", "ConversationPanel.tsx"),
  "utf8"
);
comprobar(
  "el chat muestra el origen también cuando NO hay anuncio",
  panel.includes('origenDeLead(convo) !== "anuncio"'),
  "sí"
);

rmSync(TMP, { recursive: true, force: true });
console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} comprobación(es) mal.`);
process.exit(fallos === 0 ? 0 : 1);
