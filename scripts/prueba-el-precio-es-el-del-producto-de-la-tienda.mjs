// EL PRECIO ES EL DEL PRODUCTO QUE JUEGA LA TIENDA, NO EL DE LA ALINEACION GENERAL.
//
// LO QUE PASO — 2 de octubre de 2026. El dueño probo su tienda en el simulador, en tres
// paises a la vez, y el bot le dijo el NOMBRE de su producto con el PRECIO de otro. Con
// sus palabras: «lo que estoy vendiendo en la tienda de grafismo fonetico es grafismo
// fonetico pero veo que me entrego los precios del producto lectoescritura».
//
// ── LA CAUSA, MEDIDA ───────────────────────────────────────────────────────
//
// La regla «que juegue la tienda, y si no la general» estaba escrita en DOS sitios y leida
// A PELO en TRES mas:
//
//     repartirPorEtiqueta          preguntaba por la tienda   -> el NOMBRE salia bien
//     preciosDeLaFichaEnElPais     leia la general            -> el PRECIO salia mal
//     laEntregaLaLlenaUnProducto   leia la general            -> la ENTREGA tambien
//     haySegundaOpcionSentada      leia la general
//
// Es el fallo numero uno de esta casa, otra vez: «la caja que una modalidad llena y otra
// no abre». Ya costo `course_price_soles`, `image_gallery_2` y `pack_gallery`.
//
// ── LA CURA ────────────────────────────────────────────────────────────────
//
// La pregunta se hace en UN SOLO SITIO —`laAlineacionQueJuega`— y los cinco la usan.
// Nadie vuelve a leer `alineacion_por_modalidad` a pelo. Esta prueba lo vigila: si mañana
// alguien escribe la regla otra vez por su cuenta, se pone roja.
//
// ── POR QUE ESTO ERA DINERO ────────────────────────────────────────────────
//
// No era un numero feo en una pantalla. El cliente recibia el precio de otro producto, y
// el validador de comprobantes reconoce la opcion POR EL MONTO: habria aprobado —o
// rechazado— contra el importe equivocado, y entregado el enlace que no era.
//
//   node scripts/prueba-el-precio-es-el-del-producto-de-la-tienda.mjs
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
const motor = readFileSync(join(RAIZ, "src", "lib", "workflow", "config.ts"), "utf8");

let fallos = 0;
const pad = (s, n) => (String(s ?? "") + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// ── 1. EL NOMBRE Y EL PRECIO, DEL MISMO PRODUCTO ──────────────────────────
//
// Nombres y precios INVENTADOS: una prueba con los suyos taparia el fallo de un codigo
// que conoce los datos de hoy.
console.log("\n— 1. el nombre y el precio salen del mismo producto —\n");
{
  const cfg = {
    biblioteca_de_productos: [
      {
        id: "p_tienda",
        name: "EL DE LA TIENDA",
        price_soles: 10,
        precios_por_pais: { PE: { price_soles: 10, discount_price_soles: 8 } },
      },
      {
        id: "p_general",
        name: "EL GENERAL",
        price_soles: 99,
        precios_por_pais: { PE: { price_soles: 99, discount_price_soles: 77 } },
      },
    ],
    alineacion_por_modalidad: { lineal: { unico: "p_general" } },
  };
  const conTienda = m.conLaTiendaDelTurno(
    { id: "t", alineacion: { unico: "p_tienda" } },
    () => ({
      nombre: m.nombresDeLosProductos(cfg).base,
      ficha: m.preciosDeLaFichaEnElPais("unico", "PE", cfg),
    })
  );
  comprobar(
    "el precio es el del producto de la tienda",
    conTienda.ficha.precio === 10 && conTienda.ficha.descuento === 8,
    JSON.stringify(conTienda.ficha)
  );
  const sinTienda = m.preciosDeLaFichaEnElPais("unico", "PE", cfg);
  comprobar(
    "y sin tienda sigue siendo el de la general",
    sinTienda.precio === 99,
    JSON.stringify(sinTienda)
  );
}

// ── 2. CONTRA SU CONFIGURACION DE VERDAD ──────────────────────────────────
//
// Sus nombres no se escriben aqui: se buscan. Lo que se comprueba es que el nombre y el
// precio vengan del MISMO producto, sea cual sea.
console.log("\n— 2. con su configuración, nombre y precio del mismo —\n");
{
  const real = m.loadWorkflowConfig();
  const porId = new Map((real.biblioteca_de_productos ?? []).map((p) => [p.id, p]));
  for (const t of real.tiendas ?? []) {
    const idSentado = t.alineacion?.unico;
    if (!idSentado) continue;
    const suyo = porId.get(idSentado);
    if (!suyo) continue;
    for (const pais of ["PE", "EC", "AR"]) {
      const esperado = suyo.precios_por_pais?.[pais]?.price_soles;
      if (esperado === undefined) continue;
      const r = m.conLaTiendaDelTurno(t, () => {
        const cfg = m.loadWorkflowConfig();
        return {
          nombre: m.nombresDeLosProductos(cfg).base,
          ficha: m.preciosDeLaFichaEnElPais("unico", pais, cfg),
        };
      });
      comprobar(
        `${pad(t.nombre ?? t.id, 20)} ${pais}: el precio es el suyo`,
        r.ficha.precio === esperado && r.nombre === suyo.name,
        `${r.nombre} · ${r.ficha.precio}`
      );
    }
  }
}

// ── 3. LA REGLA VIVE EN UN SOLO SITIO ─────────────────────────────────────
//
// Esta es la comprobacion que impide que vuelva a pasar. Si alguien escribe la regla por
// su cuenta en un sitio nuevo, ese sitio se quedara atras el dia que la regla cambie —y
// no dara ningun error, dara un precio equivocado.
console.log("\n— 3. la regla vive en un solo sitio —\n");
comprobar(
  "existe `laAlineacionQueJuega`, una vez",
  (motor.match(/export function laAlineacionQueJuega\(/g) ?? []).length === 1
);
comprobar(
  "y nadie lee la alineación a pelo",
  (motor.match(/alineacion_por_modalidad\?\.\[/g) ?? []).length === 1,
  "solo dentro del ayudante"
);
comprobar(
  "el precio la usa",
  /const id = laAlineacionQueJuega\(cfg\)\?\.\[puesto\];/.test(motor)
);
comprobar(
  "la entrega la usa",
  /const id = laAlineacionQueJuega\(cfg\)\?\.\[puestoDeLaFuente\(fuente\)\];/.test(motor)
);
comprobar(
  "el reparto la usa",
  /const alineacion = laAlineacionQueJuega\(config, modo\);/.test(motor)
);
comprobar(
  "y la segunda opción sentada también",
  /const alineacion = laAlineacionQueJuega\(config\) \?\? \{\};/.test(motor)
);

console.log(
  fallos === 0
    ? "\nTODO OK — el nombre y el precio salen del mismo producto\n"
    : `\n${fallos} FALLO(S)\n`
);
process.exit(fallos === 0 ? 0 : 1);
