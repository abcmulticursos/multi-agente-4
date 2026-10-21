// «COMO -OB-» NO DESTAPA EL FULL EN LA PRIMERA PREGUNTA.
//
// LO QUE PASO — 24 de septiembre de 2026. El dueño puso el selector en «como
// -OB-». La intro presento el producto base, como debe. Pero al preguntar
// «precio» o «que contiene», el bot describio el FULL con el precio del BASICO.
// Con sus palabras: «al producto base lo esta considerando con el nombre del
// producto full... hay una combinacion rara de producto full y precio base».
//
// LA CAUSA, medida con su contenido:
//
//     hueco 1 (del que el bot habla) : el FULL     <- el que debe estar OCULTO
//     hueco 2                        : el BASICO
//     precio que cotizaba            : el del BASICO
//
// El hueco 1 no es un cajon neutro: es LO QUE EL BOT CREE QUE VENDE mientras
// conversa —nombre, contenido y galeria— y viaja al modelo desde el primer
// mensaje. En -DOU- el hueco 1 es el CARO y esta bien, porque las dos opciones
// se presentan desde el principio y no hay nada que esconder. En «como -OB-» no:
// ahi el full es el producto OCULTO, y ponerlo en el hueco 1 lo destapa solo.
//
// LA REGLA DURA QUE SE ROMPIA, y es del dueño: «del producto full no se dice NI
// EL PRECIO NI EL CONTENIDO hasta que el cliente decide pagar».
//
// LO QUE SE HIZO: el reparto de huecos deja de ser uno solo para las dos formas
// prestadas. Los PRODUCTOS son los mismos —el full y el basico—; lo que cambia
// es quien va delante:
//
//     como dou  ->  hueco 1 = full,   hueco 2 = basico   (igual que hoy)
//     como ob   ->  hueco 1 = basico, hueco 2 = full
//
// Y CON ELLO HABIA QUE MOVER UNA SEGUNDA PIEZA, que el banco destapo antes de
// llegar a ninguna conversacion: el respaldo del NOMBRE de cada opcion daba por
// hecho que el hueco 1 es el combo, asi que los nombres salieron cruzados —el
// nombre de la opcion cara con el precio de la barata—. Ahora pregunta a la
// misma tabla. Quien LLENA los huecos y quien los LEE no pueden discrepar: es el
// fallo que este proyecto ya pago tres veces.
//
// LO QUE NO PUEDE CAMBIAR, y es la mitad de esta prueba:
//
//   · «como dou» reparte EXACTAMENTE como antes.
//   · El -OB- y el -DOU- de verdad (elegidos en BOT ACTIVO) no se enteran.
//   · Las cajas de la VENTA se llenan por PUESTO, no por hueco: precios y
//     entrega no se mueven.
//   · Las muestras siguen saliendo el basico primero y el full despues.
//
//   node scripts/prueba-como-ob-no-destapa-el-full.mjs
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { stringify as aYaml } from "yaml";

const RAIZ = process.cwd();
const DOBLE = "stub:db";
registerHooks({
  resolve(esp, ctx, next) {
    if (esp === "@/lib/db")
      return { url: DOBLE, format: "module", shortCircuit: true };
    if (esp.startsWith("@/")) {
      const rel = esp.slice(2);
      const conExt = /\.[a-z]+$/.test(rel) ? rel : `${rel}.ts`;
      return {
        url: pathToFileURL(join(RAIZ, "src", conExt)).href,
        shortCircuit: true,
      };
    }
    return next(esp, ctx);
  },
  load(url, ctx, next) {
    if (url === DOBLE)
      return {
        format: "module",
        shortCircuit: true,
        source:
          "export const getConversationByPhone=()=>null;export const getFrozenPrices=()=>null;export const getUpsellFrozenPrices=()=>null;export const getPuestoEnLaFila=()=>null;export const leerCompradosDeLaFila=()=>[];export const moverLaFila=()=>{};export const setFrozenPrices=()=>{};",
      };
    return next(url, ctx);
  },
});

// ── EL PROYECTO DE JUGUETE ───────────────────────────────────────────────────
//
// Nombres inventados a proposito: una prueba escrita con sus productos reales
// taparia justamente el fallo que esta regla evita.
const CASA = mkdtempSync(join(tmpdir(), "comoob-"));
mkdirSync(join(CASA, "config"), { recursive: true });
const ARCHIVO = join(CASA, "config", "intro-data.yaml");
let reloj = 1_700_000_000;

const VISIBLE = {
  id: "p_visible",
  name: "CAJA AZUL",
  course_content: "CONTENIDO: la caja azul trae tres cuadernos.",
  image_gallery: [{ topic: "azul", drive_url: "https://ej/1" }],
};
const OCULTO = {
  id: "p_oculto",
  name: "CAJA AZUL + ESTUCHE",
  course_content: "CONTENIDO: todo lo de la caja azul y ademas el estuche.",
  image_gallery: [{ topic: "estuche", drive_url: "https://ej/2" }],
};

const montar = (prestada, extra = {}) => {
  writeFileSync(
    ARCHIVO,
    aYaml({
      country: "PE",
      greeting: { body_variants: ["hola"] },
      intro_sequence: [{ type: "text", body_variants: ["la intro"] }],
      payment_responses: {
        yape: [{ type: "text", body_variants: ["datos"] }],
      },
      lineal: { enabled: true },
      segunda_opcion_prestada: prestada,
      biblioteca_de_productos: [VISIBLE, OCULTO],
      alineacion_por_modalidad: {
        lineal: { basico: VISIBLE.id, unico: VISIBLE.id, full: OCULTO.id },
      },
      ...extra,
    }),
    "utf8"
  );
  reloj += 60;
  const fecha = new Date(reloj * 1000);
  utimesSync(ARCHIVO, fecha, fecha);
};

montar("segunda_oculta");
process.chdir(CASA);
const m = await import(
  pathToFileURL(join(RAIZ, "src", "lib", "workflow", "config.ts")).href
);

let fallos = 0;
const comprobar = (titulo, ok, nota = "") => {
  if (!ok) fallos++;
  console.log(
    `${ok ? "ok   " : "FALLA"} ${titulo.padEnd(52).slice(0, 52)} ${nota}`
  );
};
const foto = () => {
  const cfg = m.loadWorkflowConfig();
  return {
    hueco1: cfg?.product_name ?? "",
    contenido1: cfg?.course_content ?? "",
    hueco2: cfg?.product_name_2 ?? "",
    contenido2: cfg?.course_content_2 ?? "",
    galeria1: (cfg?.image_gallery ?? []).map((x) => x?.topic).join(","),
    galeria2: (cfg?.image_gallery_2 ?? []).map((x) => x?.topic).join(","),
    combo: m.getOrderBumpOptionForCountry("combo", "51999999999", cfg)?.name ?? "",
    basico: m.getOrderBumpOptionForCountry("basico", "51999999999", cfg)?.name ?? "",
    muestras: m
      .getImageGallery(false, { order_bump_choice: "combo" })
      .map((x) => x?.topic)
      .join(","),
    // Lo que ve el cliente MIENTRAS el segundo sigue tapado.
    muestrasTapado: m
      .getImageGallery(true, { order_bump_choice: null })
      .map((x) => x?.topic)
      .join(","),
  };
};

// ── 1. COMO -OB-: EL VISIBLE DELANTE, EL OCULTO DETRAS ──────────────────────
console.log("-- 1. como ob: el full no ocupa el hueco del que se habla --");
let f = foto();
console.log(`     hueco 1: «${f.hueco1}»`);
console.log(`     hueco 2: «${f.hueco2}»`);
comprobar(
  "el bot habla del producto VISIBLE",
  f.hueco1 === VISIBLE.name,
  "el que presento la intro"
);
comprobar(
  "y su contenido es el del visible",
  f.contenido1 === VISIBLE.course_content,
  "no el del oculto"
);
comprobar(
  "el OCULTO queda en el hueco 2",
  f.hueco2 === OCULTO.name && f.contenido2 === OCULTO.course_content,
  "listo para cuando se revele"
);
comprobar(
  "y su galeria tampoco se mezcla",
  f.galeria1 === "azul" && f.galeria2 === "estuche",
  "cada una en su caja"
);

// ── 2. LOS NOMBRES DE LA VENTA NO SE CRUZAN ─────────────────────────────────
//
// Aqui salto el banco la primera vez: el respaldo del nombre daba por hecho que
// el hueco 1 es el combo, y la opcion cara salio con el nombre del barato.
console.log("\n-- 2. la venta: el caro es el caro ------------------------");
console.log(`     combo : «${f.combo}»`);
console.log(`     basico: «${f.basico}»`);
comprobar(
  "la opcion cara lleva el nombre del full",
  f.combo === OCULTO.name,
  "y no el del visible"
);
comprobar(
  "la barata lleva el nombre del visible",
  f.basico === VISIBLE.name,
  "sin cruces"
);

// ── 3. EL CONTENIDO DEL OCULTO NO VIAJA MIENTRAS ESTA OCULTO ────────────────
console.log("\n-- 3. el oculto sigue oculto ------------------------------");
comprobar(
  "«como ob» se comporta como order bump",
  m.isOrderBumpActive() === true && m.isDobleOfertaActive() === false,
  "y por eso no se inyecta el 2do contenido"
);
console.log(`     con el 2do tapado, se enseña: «${f.muestrasTapado}»`);
comprobar(
  "y su FOTO tampoco se le enseña",
  f.muestrasTapado === "azul",
  "antes vivia en la caja que nunca se tapa"
);
console.log(`     ya destapado, en orden: «${f.muestras}»`);
comprobar(
  "las muestras salen el visible primero",
  f.muestras.indexOf("azul") < f.muestras.indexOf("estuche") &&
    f.muestras.includes("estuche"),
  "empezar por lo caro es empezar por el final"
);

// ── 4. COMO -DOU-: EXACTAMENTE COMO ANTES ───────────────────────────────────
console.log("\n-- 4. como dou: nada cambia ------------------------------");
montar("dos_juntas");
f = foto();
console.log(`     hueco 1: «${f.hueco1}»`);
console.log(`     hueco 2: «${f.hueco2}»`);
comprobar(
  "el hueco 1 sigue siendo el CARO",
  f.hueco1 === OCULTO.name,
  "las dos se presentan juntas"
);
comprobar(
  "el hueco 2 sigue siendo el barato",
  f.hueco2 === VISIBLE.name,
  "igual que -DOU-"
);
comprobar(
  "y los nombres de la venta tampoco se mueven",
  f.combo === OCULTO.name && f.basico === VISIBLE.name,
  "el caro es el caro"
);

// ── 5. SIN SELECTOR, NI SE ENTERA ───────────────────────────────────────────
console.log("\n-- 5. con el selector apagado -----------------------------");
montar(undefined);
f = foto();
comprobar(
  "vende uno y habla de el",
  f.hueco1 === VISIBLE.name && f.hueco2 === "",
  "lineal de siempre"
);

// ── 6. Y EL -OB- DE VERDAD NO SE TOCA ───────────────────────────────────────
//
// Elegido en BOT ACTIVO, no con el selector. Su tabla es «basico +
// complementario» y no tiene puesto de full, asi que el respaldo del nombre se
// queda como estaba, letra por letra.
console.log("\n-- 6. el -OB- de verdad, intacto --------------------------");
montar(undefined, {
  order_bump: { enabled: true },
  alineacion_por_modalidad: {
    order_bump: { basico: VISIBLE.id, complementario: OCULTO.id },
  },
});
f = foto();
comprobar(
  "su hueco 1 sigue siendo el basico",
  f.hueco1 === VISIBLE.name,
  "como siempre"
);
comprobar(
  "y su hueco 2 el complementario",
  f.hueco2 === OCULTO.name,
  "sin cambios"
);

process.chdir(RAIZ);
console.log(
  fallos === 0
    ? "\nTODO OK — el full permanece oculto y nada mas se movio\n"
    : `\n${fallos} comprobacion(es) mal.\n`
);
process.exit(fallos === 0 ? 0 : 1);
