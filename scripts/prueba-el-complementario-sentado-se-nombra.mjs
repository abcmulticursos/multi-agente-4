// EL COMPLEMENTO QUE ESTÁ SENTADO SE NOMBRA, LO VENDA ESA MODALIDAD O NO.
//
// LO PIDIÓ EL DUEÑO el 1 de octubre de 2026: «tengo un problema con el comodín del
// complementario, yo sé que no se vende, pero tiene que representarse en el visor y en
// la entrega del cliente… eso no es motivo para que no se muestre».
//
// ── POR QUÉ ESTABA VACÍO, Y POR QUÉ ERA CORRECTO ENTONCES ──────────────────
//
// La regla de antes decía: «COMPLEMENTARIO solo existe en Order Bump. En las demás
// devuelve vacío a propósito: mejor un hueco que nombrar un producto que no se vende».
//
// Y tenía razón CUANDO SE ESCRIBIÓ. El complemento vivía en una CAJA de contenido
// —`product_name_2`— y fuera de Order Bump esa caja guardaba el producto de otra
// venta. Nombrarlo habría puesto en el mensaje un producto que ya no se vende: el
// fallo de la caja que una modalidad llena y otra no abre, que este proyecto pagó
// tres veces.
//
// ── POR QUÉ CAMBIA AHORA ───────────────────────────────────────────────────
//
// Con el almacén hay un ASIENTO de complementario en la alineación de cualquier
// modalidad. Lo que está sentado ahí NO es un resto de otra configuración: lo puso él
// a mano, hoy, para esta venta.
//
// Así que la regla no se quita, SE ACOTA: no se nombra lo que quedó en una caja vieja,
// pero sí lo que está sentado. Es «añadir lo pequeño en vez de mover lo grande».
//
// ── LO QUE SE MIDIÓ ANTES DE TOCARLO ───────────────────────────────────────
//
// En su configuración, solo lineal tiene un complemento sentado. Order Bump y Doble
// Oferta + Upsell no tienen ninguno, así que no se mueven — y ahí es donde él pidió
// no tocar nada. Y usa el comodín 13 veces en su contenido.
//
//   node scripts/prueba-el-complementario-sentado-se-nombra.mjs
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
const pantalla = readFileSync(join(RAIZ, "src", "app", "editor", "page.tsx"), "utf8");

let fallos = 0;
const pad = (s, n) => (String(s ?? "") + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// Nombres INVENTADOS: una prueba con los suyos taparía que el código no debe
// conocer ninguno.
const BIBLIO = [
  { id: "p_uno", name: "EL PRINCIPAL" },
  { id: "p_comp", name: "EL COMPLEMENTO" },
  { id: "p_otro", name: "OTRO" },
];
const base = (modo, alineacion, extra = {}) => ({
  biblioteca_de_productos: BIBLIO,
  alineacion_por_modalidad: { [modo]: alineacion },
  editor_mode: modo,
  product_name: "EL PRINCIPAL",
  ...extra,
});

// ── 1. EN LINEAL, SENTADO, SE NOMBRA ────────────────────────────────────────
console.log("\n— 1. en lineal se nombra el que está sentado —\n");
{
  const cfg = base("lineal", { unico: "p_uno", complementario: "p_comp" });
  const n = m.nombresDeLosProductos(cfg);
  comprobar(
    "el complemento sentado sale con su nombre",
    n.complementario === "EL COMPLEMENTO",
    n.complementario
  );
  comprobar(
    "y los otros dos no se mueven",
    n.base === "EL PRINCIPAL" && n.full === "EL PRINCIPAL",
    "lineal vende uno"
  );
}

// ── 2. SIN NADA SENTADO, SIGUE VACÍO ────────────────────────────────────────
//
// Es la mitad que conserva la regla vieja: un hueco antes que un producto que nadie
// eligió.
console.log("\n— 2. sin nada sentado, vacío —\n");
{
  const n = m.nombresDeLosProductos(base("lineal", { unico: "p_uno" }));
  comprobar("no se inventa ninguno", n.complementario === "", "mejor el hueco");
}
{
  // Y un asiento que apunta a un producto BORRADO tampoco nombra nada.
  const n = m.nombresDeLosProductos(
    base("lineal", { unico: "p_uno", complementario: "p_que_no_existe" })
  );
  comprobar(
    "un asiento que apunta a un producto borrado",
    n.complementario === "",
    "no inventa un nombre"
  );
}

// ── 3. ORDER BUMP NO SE TOCA ────────────────────────────────────────────────
//
// Ahí el complemento vive en su CAJA de contenido y es el camino probado. Si esto
// empezara a leerlo del asiento, cambiaría la modalidad que el dueño pidió no tocar.
console.log("\n— 3. Order Bump sigue leyendo su caja —\n");
{
  // La modalidad que vende se decide por su INTERRUPTOR, no por `editor_mode` —ver
  // `activeModalityKey`—. Escribirlo mal haria que esta prueba midiera lineal
  // creyendo que mide Order Bump, y pasaria por el motivo equivocado.
  const cfg = base(
    "order_bump",
    { basico: "p_uno", complementario: "p_comp" },
    {
      product_name_2: "LO QUE DICE LA CAJA",
      order_bump: { enabled: true, combo: { name: "EL FULL" } },
    }
  );
  const n = m.nombresDeLosProductos(cfg);
  comprobar(
    "manda la caja, no el asiento",
    n.complementario === "LO QUE DICE LA CAJA",
    n.complementario
  );
}

// ── 4. LA TIENDA MANDA SOBRE LA ALINEACIÓN GENERAL ──────────────────────────
//
// Se lee del mismo sitio que el reparto, así que una tienda con su propia alineación
// nombra SU complemento y no el de la general.
console.log("\n— 4. la tienda nombra el suyo —\n");
{
  const cfg = base("lineal", { unico: "p_uno", complementario: "p_comp" });
  const deLaTienda = m.conLaTiendaDelTurno(
    { id: "t", alineacion: { unico: "p_uno", complementario: "p_otro" } },
    () => m.nombresDeLosProductos(cfg)
  );
  comprobar(
    "la tienda nombra SU complemento",
    deLaTienda.complementario === "OTRO",
    deLaTienda.complementario
  );
  comprobar(
    "y sin tienda sigue el de la general",
    m.nombresDeLosProductos(cfg).complementario === "EL COMPLEMENTO"
  );
}

// ── 5. EL VISOR DICE LO MISMO QUE EL BOT ────────────────────────────────────
//
// Si el visor siguiera devolviendo vacío, él escribiría el comodín, vería un hueco, y
// creería que no funciona — cuando el cliente SÍ recibiría el nombre. Esta semana una
// divergencia así ya costó once diferencias con el formato de la moneda.
console.log("\n— 5. el visor no miente —\n");
comprobar(
  "el visor lee el asiento del complemento",
  /complementario: nombreDe\("complementario"\),/.test(pantalla)
);
comprobar(
  "y solo cae a la caja en Order Bump",
  /nombreComplementario: esOrderBump\s*\r?\n?\s*\? alineados\.product2Name\s*\r?\n?\s*: \(alineados\.complementario \?\? ""\),/.test(
    pantalla
  ),
  "igual que el motor"
);

console.log(
  fallos === 0
    ? "\nTODO OK — se nombra el complemento que está sentado, y nada más\n"
    : `\n${fallos} FALLO(S)\n`
);
process.exit(fallos === 0 ? 0 : 1);
