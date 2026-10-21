// LA ETIQUETA DE SEMIMODALIDAD: SOLO SALE LO QUE CORRESPONDE A LA FORMA DE VENDER.
//
// LO PIDIÓ EL DUEÑO el 30 de septiembre de 2026, con su boceto delante:
//
//   «necesito que haya una etiqueta de comolineal, como dou y como ob... al
//    etiquetarla a su semimodalidad solo debe salir el de la etiqueta de acuerdo
//    a su modalidad; así las otras estén encendidas pero la modalidad no
//    corresponde, no debería salir».
//
// SEMIMODALIDAD es su palabra, y la separa de MODALIDAD a propósito: modalidad es
// Lineal, Doble Oferta + Upsell, Order Bump…; semimodalidad son las tres formas de
// vender DENTRO de lineal — «como hoy», COMO DOU y COMO OB.
//
// Y ELIGIÓ LA RED DE SEGURIDAD (su «opción B») sabiendo lo que evita: si ninguna
// etiquetada corresponde, salen las que no llevan etiqueta. Es la lección que ya
// costó una vez con la bandera del país —«un cliente sin intro es una venta
// perdida segura»— y por eso la etiqueta DIRIGE pero nunca deja a nadie fuera.
//
//   node scripts/prueba-la-etiqueta-de-semimodalidad.mjs
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

const motor = readFileSync(join(RAIZ, "src", "lib", "workflow", "engine.ts"), "utf8");
const conf = readFileSync(join(RAIZ, "src", "lib", "workflow", "config.ts"), "utf8");
const api = readFileSync(join(RAIZ, "src", "app", "api", "workflow", "route.ts"), "utf8");
const pantalla = readFileSync(join(RAIZ, "src", "app", "editor", "page.tsx"), "utf8");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 56)} ${valor}`);
};

// ── 1. EL FILTRO, EJECUTADO ─────────────────────────────────────────────────
console.log("\n— 1. el filtro de verdad, con la red de seguridad —\n");
const pieza = (n, etiqueta) => ({ n, semimodalidad: etiqueta });
const cuales = (lista) => lista.map((p) => p.n).join(",");
const filtrar = (lista, activa) =>
  m.porSemimodalidad(lista, (p) => m.semimodalidadDe(p), activa);

{
  // Las tres etiquetadas, una por forma de vender: sale SOLO la que toca.
  const tres = [pieza(1, "lineal"), pieza(2, "dou"), pieza(3, "ob")];
  comprobar("en lineal sale solo la de lineal", cuales(filtrar(tres, "lineal")) === "1", cuales(filtrar(tres, "lineal")));
  comprobar("en dou sale solo la de dou", cuales(filtrar(tres, "dou")) === "2", cuales(filtrar(tres, "dou")));
  comprobar("en ob sale solo la de ob", cuales(filtrar(tres, "ob")) === "3", cuales(filtrar(tres, "ob")));
}
{
  // Etiquetadas Y sin etiqueta: la etiquetada gana, la general se calla.
  const mezcla = [pieza(1, "lineal"), pieza(2, ""), pieza(3, "dou")];
  comprobar("la etiquetada gana a la que no lo está", cuales(filtrar(mezcla, "lineal")) === "1", cuales(filtrar(mezcla, "lineal")));
  comprobar("y en ob, sin ninguna de ob, sale la general", cuales(filtrar(mezcla, "ob")) === "2", cuales(filtrar(mezcla, "ob")));
}
{
  // LA RED: todas etiquetadas y ninguna corresponde -> salen TODAS, no ninguna.
  const ninguna = [pieza(1, "lineal"), pieza(2, "dou")];
  comprobar(
    "todas etiquetadas y ninguna corresponde -> NO se queda vacío",
    filtrar(ninguna, "ob").length === 2,
    "un cliente sin intro es una venta perdida"
  );
}
{
  // SIN ETIQUETAS PUESTAS NO CAMBIA NADA: la lista sale entera.
  const limpias = [pieza(1, ""), pieza(2, undefined), pieza(3, "")];
  comprobar("sin etiquetas, la lista sale entera", cuales(filtrar(limpias, "dou")) === "1,2,3");
}
{
  // Una etiqueta mal escrita se lee como SIN etiqueta, nunca desaparece.
  comprobar("una etiqueta rara se lee como general", m.semimodalidadDe({ semimodalidad: "COMO DOU" }) === null);
  comprobar("y las tres buenas se leen en cualquier caja",
    m.semimodalidadDe({ semimodalidad: " LINEAL " }) === "lineal" &&
    m.semimodalidadDe({ semimodalidad: "Dou" }) === "dou" &&
    m.semimodalidadDe({ semimodalidad: "ob" }) === "ob");
}

// ── 2. DE DÓNDE SALE LA SEMIMODALIDAD ACTIVA ────────────────────────────────
console.log("\n— 2. el selector manda —\n");
const conSelector = (v) => ({ segunda_opcion_prestada: v, modo_reenganche: true });
comprobar("«» -> lineal", m.semimodalidadActiva(conSelector("")) === "lineal");
comprobar("«dos_juntas» -> dou", m.semimodalidadActiva(conSelector("dos_juntas")) === "dou");
comprobar("«segunda_oculta» -> ob", m.semimodalidadActiva(conSelector("segunda_oculta")) === "ob");
comprobar("sin configuración -> lineal", m.semimodalidadActiva(null) === "lineal");

// ── 3. ESTÁ ENCHUFADO EN LOS TRES SITIOS QUE ELIGEN ─────────────────────────
console.log("\n— 3. los tres elegidores lo usan —\n");
// LA INTENCIÓN NO CAMBIA: `sorteaCajonDeIntro` filtra por semimodalidad. Lo que
// cambió es SOBRE QUÉ LISTA. El 30/09/2026 se añadió la etiqueta de tienda, que
// manda sobre las otras tres y se filtra antes, así que la lista que llega aquí ya
// es `deSuTienda` y no `todosLosEncendidos`. Se comprueba que el filtro siga
// puesto y que reciba lo que salió del de tienda — que es lo que mantiene el orden
// tienda -> semimodalidad -> bandera -> anuncio.
comprobar(
  "los cajones de order bump y upsell",
  /porSemimodalidad\(\s*deSuTienda,/.test(conf),
  "sorteaCajonDeIntro"
);
comprobar(
  "los seguimientos",
  /const deEstaSemimodalidad = porSemimodalidad\(/.test(motor),
  "chooseFollowupVariant"
);
comprobar(
  "las intros",
  /config\.intro_semimodalidades\?\.\[item\.variant - 1\]/.test(motor),
  "chooseIntro"
);
comprobar(
  // EL ORDEN NO CAMBIA, que es lo que esta comprobacion protege. El 02/10/2026 el filtro
  // de pais dejo de usar `porEtiqueta` —hacian falta tres escalones y ese ayudante tiene
  // dos— asi que se busca por su nombre y no por la llamada.
  "y va ANTES que la bandera en los seguimientos",
  motor.indexOf("const deEstaSemimodalidad") < motor.indexOf("const deSuPais ="),
  "primero la forma de vender, dentro de eso el país"
);
comprobar(
  "la variante hereda la del seguimiento si no tiene la suya",
  /semi: semimodalidadDe\(variant\) \?\? base\.semi,/.test(motor)
);

// ── 4. SOBREVIVE AL GUARDADO ────────────────────────────────────────────────
//
// Este archivo reconstruye el contenido campo por campo: lo que no se nombre se
// pierde en silencio. Pasó con las banderas el 24/09.
console.log("\n— 4. la etiqueta sobrevive al guardado —\n");
comprobar("hay un lector acotado a las tres", /function leeSemimodalidad\(/.test(api));
comprobar(
  "y solo acepta lineal, dou y ob",
  /s === "lineal" \|\| s === "dou" \|\| s === "ob" \? s : ""/.test(api),
  "lo demás se lee como general"
);
comprobar(
  "se escribe en los cajones de intro",
  /\{ semimodalidad: leeSemimodalidad\(g\?\.semimodalidad\) \}/.test(api)
);
comprobar(
  "en los seguimientos",
  /\{ semimodalidad: leeSemimodalidad\(f\?\.semimodalidad\) \}/.test(api)
);
comprobar(
  "en sus variantes",
  /\{ semimodalidad: leeSemimodalidad\(v\?\.semimodalidad\) \}/.test(api)
);
comprobar(
  "y la lista por intro se guarda entera",
  /doc\.set\(\s*"intro_semimodalidades",/.test(api)
);
comprobar(
  "el canal la aplana donde el motor la lee",
  /next\.intro_semimodalidades = introOnlyGroups\.map/.test(conf),
  "la caja que uno llena y otro no abre"
);
// Y ANTES DE LA RUTA, LA PANTALLA. El dueño lo vio el 30/09/2026 probando: en
// seguimientos y en la intro de order bump la etiqueta se guardaba, y en las
// intros del canal se perdía. La ruta ya la guardaba bien — se caía antes, al
// salir del editor, porque ahí los cajones del canal se RECONSTRUYEN campo por
// campo y el nuevo no estaba nombrado.
comprobar(
  "y el editor no se la come al salir",
  /paisRoutingEnabled: group\.paisRoutingEnabled !== false,[\s\S]{0,900}?semimodalidad: group\.semimodalidad \?\? "",/.test(
    pantalla
  ),
  "el guardado reconstruye campo por campo"
);

// ── 5. LA PANTALLA ──────────────────────────────────────────────────────────
console.log("\n— 5. se ve y se cambia en la fachada —\n");
comprobar("existe la pastilla", /function PastillaDeSemimodalidad\(/.test(pantalla));
comprobar(
  "con las tres, y sin etiqueta se ve tenue",
  /\+ etiqueta/.test(pantalla) && /Sin etiqueta/.test(pantalla)
);
comprobar(
  "sale en los cajones de intro del canal",
  /valor=\{group\.semimodalidad\}/.test(pantalla)
);
comprobar(
  "en los cajones de la oferta y del upsell",
  /valor=\{grupo\.semimodalidad\}/.test(pantalla)
);
comprobar(
  "y en los seguimientos",
  /valor=\{followup\.semimodalidad\}/.test(pantalla)
);
// SOLO LOS DE LOS CAJONES. El de subir una BURBUJA se queda con su palabra: es
// otra fila, no la comparte con la etiqueta, y él no pidió tocarlo.
comprobar(
  "los botones de los CAJONES se encogieron para dejarle sitio",
  !/title="Subir este cajón"[\s\S]{0,300}?↑ Subir/.test(pantalla) &&
    !/title="Bajar este cajón"[\s\S]{0,300}?↓ Bajar/.test(pantalla) &&
    !/title="Arrastrar para moverlo de sitio"[\s\S]{0,300}?⋮⋮ Mover/.test(pantalla) &&
    !/channel-followup[\s\S]{0,400}?⋮⋮ Mover/.test(pantalla),
  "lo pidió él, por espacio"
);
comprobar(
  "y el de una burbuja sigue con su palabra, intacto",
  /title="Subir esta burbuja"[\s\S]{0,300}?↑ Subir/.test(pantalla),
  "no se pidió tocarlo"
);
comprobar(
  "pero siguen diciendo qué hacen a quien no ve la pantalla",
  /aria-label="Subir este cajón"/.test(pantalla) &&
    /aria-label="Bajar este cajón"/.test(pantalla)
);

console.log(
  fallos === 0
    ? "\nTODO OK — la etiqueta dirige, y nunca deja a un cliente sin intro\n"
    : `\n${fallos} FALLO(S)\n`
);
process.exit(fallos === 0 ? 0 : 1);
