// EL ALMACÉN POR TIENDA: un solo lugar para las intros y los seguimientos, y
// cada número elige los suyos.
//
// LO PIDIÓ EL DUEÑO el 30 de septiembre de 2026, con estas palabras: «en un solo
// lugar, las intros, seguimientos entregas etc, pero desde cualquier agente
// individual o número individual yo poder seleccionarlos tal como lo hago en el
// actual». Y: «puede estar en un bot encendido y en los otros apagados».
//
// Y CON UNA CONDICIÓN QUE REPITIÓ VARIAS VECES: «sin que se filtren cosas de un
// lado a otro».
//
// ── POR QUÉ ESTA ETIQUETA NO ES COMO LAS OTRAS TRES ────────────────────────
//
// La bandera, el anuncio y la semimodalidad DIRIGEN: prefieren lo etiquetado y,
// si no hay nada para este cliente, dejan jugar a todos. Esa red es correcta
// ahí —un cliente sin intro es una venta perdida— y un texto general le sirve.
//
// LA TIENDA NO DIRIGE: AÍSLA. Un texto de la tienda B nombra otros productos,
// otros precios y otras cuentas de cobro. Mandárselo al cliente de la A es la
// fuga que él pidió evitar. Así que aquí lo de otra tienda NO sale NUNCA, y esta
// prueba existe sobre todo para eso.
//
// LO QUE PROTEGE, y es lo más importante de todo el cambio:
//
//     SIN NINGUNA ETIQUETA PUESTA, EL BOT REPARTE EXACTAMENTE COMO HOY.
//
//   node scripts/prueba-el-almacen-por-tienda.mjs
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const DOBLE = "stub:db";
registerHooks({
  resolve(esp, ctx, next) {
    if (esp === "@/lib/db") return { url: DOBLE, format: "module", shortCircuit: true };
    if (esp.startsWith("@/")) {
      const rel = esp.slice(2);
      const conExt = /\.[a-z]+$/.test(rel) ? rel : `${rel}.ts`;
      return { url: pathToFileURL(join(RAIZ, "src", conExt)).href, shortCircuit: true };
    }
    return next(esp, ctx);
  },
  load(url, ctx, next) {
    if (url === DOBLE)
      return {
        format: "module", shortCircuit: true,
        source: `
          export const getConversationByPhone = () => null;
          export const getConversationById = () => null;
          export const getFrozenPrices = () => null;
          export const getUpsellFrozenPrices = () => null; export const getPuestoEnLaFila = () => null; export const leerCompradosDeLaFila = () => []; export const moverLaFila = () => {};
          export const setFrozenPrices = () => {};
        `,
      };
    return next(url, ctx);
  },
});
const m = await import(pathToFileURL(join(RAIZ, "src", "lib", "workflow", "config.ts")).href);

const conf = readFileSync(join(RAIZ, "src", "lib", "workflow", "config.ts"), "utf8");
const motor = readFileSync(join(RAIZ, "src", "lib", "workflow", "engine.ts"), "utf8");
const api = readFileSync(join(RAIZ, "src", "app", "api", "workflow", "route.ts"), "utf8");

let fallos = 0;
const pad = (s, n) => (String(s ?? "") + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// Tiendas de juguete, con nombres inventados: una prueba escrita con los suyos
// taparía justo el fallo que la regla de la casa evita.
const TIENDA_A = { id: "t_a", nombre: "PRIMERA", numero: "111" };
const TIENDA_B = { id: "t_b", nombre: "SEGUNDA", numero: "222" };

// ── 1. LA REGLA, EJECUTADA ──────────────────────────────────────────────────
console.log("\n— 1. la regla del filtro —\n");
const piezas = [
  { que: "general", tiendas: [] },
  { que: "de A", tiendas: ["t_a"] },
  { que: "de B", tiendas: ["t_b"] },
  { que: "de A y B", tiendas: ["t_a", "t_b"] },
];
const filtra = (id) =>
  m
    .soloDeSuTienda(piezas, (p) => p.tiendas, id)
    .map((p) => p.que)
    .join(", ");

comprobar("atendiendo A, juegan las de A", filtra("t_a") === "de A, de A y B", filtra("t_a"));
comprobar("atendiendo B, juegan las de B", filtra("t_b") === "de B, de A y B", filtra("t_b"));
comprobar(
  "sin tienda atendiendo, SOLO la general",
  filtra(null) === "general",
  "lo escrito para una tienda es de esa tienda"
);
comprobar(
  "una tienda sin nada propio juega la general",
  m
    .soloDeSuTienda(
      [{ que: "general", tiendas: [] }, { que: "de B", tiendas: ["t_b"] }],
      (p) => p.tiendas,
      "t_a"
    )
    .map((p) => p.que)
    .join(", ") === "general",
  "nunca la de B"
);
// LA COMPROBACIÓN QUE DA SENTIDO A TODO EL CAMBIO.
comprobar(
  "y si TODO es de B, a A no le llega NADA",
  m.soloDeSuTienda([{ tiendas: ["t_b"] }], (p) => p.tiendas, "t_a").length === 0,
  "vacío, no la de otra tienda"
);

// ── 2. LA GARANTÍA: SIN ETIQUETAS, TODO IGUAL ───────────────────────────────
console.log("\n— 2. sin etiquetas, el reparto de siempre —\n");
{
  const sinEtiquetar = [{ a: 1 }, { a: 2 }, { a: 3 }];
  const conTienda = m.soloDeSuTienda(sinEtiquetar, () => [], "t_a");
  const sinTienda = m.soloDeSuTienda(sinEtiquetar, () => [], null);
  comprobar(
    "con tienda atendiendo, la lista entera",
    conTienda.length === 3,
    "no se descarta nada"
  );
  comprobar("y sin tienda, también entera", sinTienda.length === 3);
}

// ── 3. EL SORTEO DE INTROS, DE VERDAD ───────────────────────────────────────
//
// Se ejecuta `sorteaCajonDeIntro`, el mismo que usa el bot. Los cajones no llevan
// semimodalidad ni bandera, así que lo único que decide aquí es la tienda.
console.log("\n— 3. el sorteo de cajones de intro —\n");
const cajon = (nombre, tiendas) => ({
  name: nombre,
  tiendas,
  steps: [{ type: "text", texts: [nombre], delay_after_sec: 0 }],
});
const cual = (cajones, tienda) =>
  m.conLaTiendaDelTurno(tienda, () => {
    const pasos = m.sorteaCajonDeIntro(cajones, 7, null);
    return pasos ? pasos[0].texts[0] : "(ninguno)";
  });

{
  const cajones = [cajon("LA DE B", ["t_b"]), cajon("LA GENERAL", [])];
  comprobar("por el número de B sale la de B", cual(cajones, TIENDA_B) === "LA DE B");
  comprobar("por el de A sale la general", cual(cajones, TIENDA_A) === "LA GENERAL");
  comprobar("y sin tienda, la general", cual(cajones, null) === "LA GENERAL");
}
{
  // TODOS los cajones son de B. Por el número de A no hay cajón: se devuelve null
  // y quien llama se queda con la secuencia de intro clásica. NO se le manda la
  // de B. Éste es el caso que más importa de toda la prueba.
  const soloDeB = [cajon("LA DE B", ["t_b"]), cajon("OTRA DE B", ["t_b"])];
  comprobar(
    "con todo etiquetado para B, A no recibe la de B",
    cual(soloDeB, TIENDA_A) === "(ninguno)",
    "cae en la intro de siempre"
  );
  comprobar("y B sí recibe una suya", cual(soloDeB, TIENDA_B).includes("DE B"));
}
{
  // Sin etiquetas, el sorteo por peso decide como toda la vida.
  const sinEtiquetas = [cajon("UNA", []), cajon("OTRA", [])];
  const conA = cual(sinEtiquetas, TIENDA_A);
  const sin = cual(sinEtiquetas, null);
  comprobar(
    "sin etiquetas el sorteo no cambia por la tienda",
    conA === sin && conA !== "(ninguno)",
    `${conA} en los dos`
  );
}

// ── 4. EL ORDEN DE LOS CUATRO FILTROS ───────────────────────────────────────
//
// La tienda manda sobre las otras tres: decide por qué NÚMERO se vende, y dentro
// de eso deciden la forma, el país y el anuncio. Si se filtrara después, un cajón
// de otra tienda podría ganar por bandera.
console.log("\n— 4. la tienda se filtra antes que las otras tres —\n");
// Se mira que la lista filtrada por tienda sea la que ENTRA al filtro de
// semimodalidad. El hueco es ancho a propósito: en medio hay comentarios que
// explican el porqué, y una prueba que se rompe al escribir un comentario obliga
// a no escribirlos.
comprobar(
  "en el sorteo de intros va primera",
  /const deSuTienda = soloDeSuTienda\([\s\S]{0,1600}?const encendidos = porSemimodalidad\(\s*deSuTienda,/.test(
    conf
  ),
  "config.ts"
);
comprobar(
  "en los seguimientos, también",
  /const deSuTienda = soloDeSuTienda\([\s\S]{0,1600}?const deEstaSemimodalidad = porSemimodalidad\(\s*deSuTienda,/.test(
    motor
  ),
  "engine.ts"
);
comprobar(
  "y en las intros del canal",
  /const suyas = soloDeSuTienda\(\s*pool,[\s\S]{0,260}?intro_tiendas/.test(motor),
  "engine.ts"
);

// ── 5. LA HERENCIA DEL SEGUIMIENTO A SUS CAJONES ────────────────────────────
//
// Al abrir el editor los «mensajes principales» BAJAN a la lista como un cajón
// más. La etiqueta puesta en el seguimiento entero se quedaría arriba sin nadie
// que la mirara — es la trampa que ya costó dos arreglos, con la bandera el 24/09
// y con la semimodalidad el 30/09.
console.log("\n— 5. el cajón hereda la tienda del seguimiento —\n");
comprobar(
  "el cajón sin tienda usa la del seguimiento",
  /tiendas:\s*\n?\s*tiendasDe\(variant\)\.length > 0 \? tiendasDe\(variant\) : base\.tiendas,/.test(
    motor
  ),
  "y la del cajón manda"
);
comprobar(
  "y el seguimiento entero tiene la suya",
  /tiendas: tiendasDe\(seq\),/.test(motor)
);

// ── 6. UN SEGUIMIENTO ENCENDIDO EN UN NÚMERO Y APAGADO EN OTRO ──────────────
//
// Es la frase con la que él lo pidió. Se consigue devolviendo null: el
// seguimiento no se agenda para esa tienda.
console.log("\n— 6. encendido en un número, apagado en otro —\n");
comprobar(
  "sin cajón de su tienda, el seguimiento no sale",
  /const deSuTienda = soloDeSuTienda\([\s\S]{0,200}?\);\s*\n\s*if \(deSuTienda\.length === 0\) return null;/.test(
    motor
  ),
  "no se agenda"
);

// ── 7. SOBREVIVE AL GUARDADO ────────────────────────────────────────────────
//
// La ruta de guardado NO copia el contenido: lo reconstruye campo por campo, y
// un campo que nadie nombra ahí se pierde en silencio. Ya pasó con las banderas
// el 24/09 y con la semimodalidad el 30/09. Son DIECISÉIS sitios.
console.log("\n— 7. la etiqueta sobrevive al guardado —\n");
const cuenta = (re) => (api.match(re) ?? []).length;
comprobar(
  "se lee en todos los carriles",
  cuenta(/tiendas: strList\(/g) >= 8,
  `${cuenta(/tiendas: strList\(/g)} sitios`
);
comprobar(
  "los cajones de intro la escriben",
  /function writeGruposDeIntro[\s\S]{0,1400}?strList\(g\?\.tiendas\)\.length > 0/.test(api)
);
comprobar(
  "los seguimientos la escriben",
  /strList\(f\?\.tiendas\)\.length > 0 \? \{ tiendas: strList\(f\?\.tiendas\) \}/.test(api)
);
comprobar(
  "y sus variantes también",
  /strList\(v\?\.tiendas\)\.length > 0\s*\n?\s*\? \{ tiendas: strList\(v\?\.tiendas\) \}/.test(api)
);
comprobar(
  "las intros del canal viajan aplanadas",
  /next\.intro_tiendas = introOnlyGroups\.map\(\(group\) => tiendasDe\(group\)\);/.test(conf),
  "o la pantalla la vería y el motor no"
);
comprobar(
  "se devuelven al abrir el editor",
  /const intro_tiendas = Array\.isArray\(config\?\.intro_tiendas\)/.test(api) &&
    /\n      intro_tiendas,/.test(api)
);
comprobar(
  "y se guardan al guardar",
  /doc\.set\(\s*"intro_tiendas",/.test(api)
);

// ── 8. LA REGLA VIVE EN UN SOLO SITIO ──────────────────────────────────────
//
// La pantalla necesita la MISMA regla para avisar «esta tienda se quedaría sin
// seguimientos», y `config.ts` arrastra la base de datos: no se puede importar
// desde el navegador. La otra opción era escribirla dos veces, y eso en esta casa
// ya costó once diferencias entre el visor de precios y el bot.
console.log("\n— 8. una sola regla, leída por los dos —\n");
const pantalla = readFileSync(join(RAIZ, "src", "app", "editor", "page.tsx"), "utf8");
const suelta = readFileSync(
  join(RAIZ, "src", "lib", "workflow", "etiqueta-de-tienda.ts"),
  "utf8"
);
comprobar(
  "la regla vive en su propio archivo",
  /export function soloDeSuTienda</.test(suelta),
  "etiqueta-de-tienda.ts"
);
comprobar(
  "el archivo no arrastra nada",
  !/^import /m.test(suelta),
  "por eso lo puede leer el navegador"
);
comprobar(
  "el motor la lee de ahí",
  /from "@\/lib\/workflow\/etiqueta-de-tienda";/.test(conf) &&
    /export \{ tiendasDe, soloDeSuTienda, leQuedaAlgo \};/.test(conf),
  "y la reexporta"
);
// EL 6/10/2026 ESE IMPORT CRECIO y paso a varias lineas: el visor de recorrido necesitaba
// tambien `soloDeSuTienda` para enseñar solo lo de la tienda y el pais que se esta mirando.
// La afirmacion se actualiza conservando su intencion —que la PANTALLA lea la regla del mismo
// archivo que el motor, no una copia suya— y deja de atarse a como esten escritas las llaves.
comprobar(
  "y la pantalla también",
  /from "@\/lib\/workflow\/etiqueta-de-tienda";/.test(pantalla) &&
    /\bleQuedaAlgo\b/.test(pantalla) &&
    /\btiendasDe\b/.test(pantalla),
  "no una copia"
);
comprobar(
  "a config.ts no le queda copia",
  (conf.match(/export function soloDeSuTienda</g) ?? []).length === 0
);

// ── 9. LA PANTALLA: LA PASTILLA Y EL AVISO ─────────────────────────────────
console.log("\n— 9. se etiqueta desde la fila del cajón —\n");
comprobar("existe la pastilla", /function PastillaDeTiendas\(/.test(pantalla));
comprobar(
  "la lista de tiendas va por contexto",
  /const TiendasContext = createContext</.test(pantalla) &&
    /<TiendasContext\.Provider value=\{laListaDeTiendas\}>/.test(pantalla),
  "no prop a prop por media docena de componentes"
);
comprobar(
  "sin tiendas creadas la pastilla no estorba",
  /if \(tiendas\.length === 0\) return null;/.test(pantalla)
);
// Los CINCO sitios: el cajón de intro, la intro del canal, el seguimiento del
// canal, su variante y, desde el 10/10/2026, la fila de upsells (PLAN-UPSELLS-EN-FILA.md).
// Si falta uno, esa etiqueta no se puede poner.
comprobar(
  "está en las cinco filas",
  (pantalla.match(/<PastillaDeTiendas/g) ?? []).length === 5,
  `${(pantalla.match(/<PastillaDeTiendas/g) ?? []).length} de 5`
);
comprobar(
  "y sobrevive al normalizador del guardado",
  /tiendas: group\.tiendas \?\? \[\],/.test(pantalla),
  "el fallo que él vio el 30/09"
);
comprobar(
  "el aviso usa la función del motor",
  /leQuedaAlgo\(encendidos, \(f\) => tiendasDe\(f\), id\)/.test(pantalla),
  "no su propia cuenta"
);
comprobar(
  "y avisa si se quedaría sin seguimientos",
  /Esta tienda no recibiría ningún seguimiento/.test(pantalla),
  "el silencio también es un fallo"
);

console.log(
  fallos === 0
    ? "\nTODO OK — cada tienda elige del mismo almacén, y nada se filtra entre ellas\n"
    : `\n${fallos} FALLO(S)\n`
);
process.exit(fallos === 0 ? 0 : 1);
