// LOS CUATRO ASIENTOS ESTAN SIEMPRE, Y CAMBIAR DE MODALIDAD NO MUEVE NADA.
//
// LO QUE PASO — 22 de septiembre de 2026.
//
//   El dueño encendio la presentacion de dos opciones en lineal y su producto
//   DESAPARECIO de la pantalla: el asiento decia «— ninguno —». Mando las dos
//   capturas, una al lado de la otra.
//
//   No se habia perdido. Lineal guarda su asiento con la clave `unico`, y al
//   presentar dos la pantalla pregunta por `basico`. Dos nombres para el mismo
//   papel — el editor ya llamaba «Producto basico» a los dos.
//
//   Sus palabras: «eso no tiene coherencia de trabajar como un solo equipo,
//   sino que mas se parece a que al cambiar entraria una configuracion nueva».
//
// LO QUE PIDIO, y es mas que arreglar el hueco:
//
//   1. Los CUATRO asientos a la vista en lineal, -DOU- y -OB-.
//   2. En lineal solo VENDEN el basico y el upsell. El complementario y el full
//      se pueden llenar, pero son cosmeticos: «no se dispararian».
//   3. Al cambiar de modalidad la pantalla NO se mueve y no se pierde nada:
//      solo despiertan los que dormian.
//   4. No es ver otra modalidad: es CONVERTIR esta en la otra.
//
// COMO SE HIZO, y por que no puede dispararse lo dormido
//
//   Hay DOS listas, a proposito:
//
//     puestosDeLaModalidad()   lo que JUEGA   → no se toco
//     asientosDeLaPantalla()   lo que SE VE   → nuevo, solo el editor
//
//   La primera es la que usa `repartirPorEtiqueta`, o sea la que decide lo que
//   el bot vende. Un asiento que no esta en ella no tiene hueco, y sin hueco el
//   reparto no lo escribe en ninguna parte. Que lo cosmetico no dispare no
//   depende de acordarse de comprobarlo: no tiene por donde.
//
// LO QUE NO PUEDE VOLVER A PASAR
//
//   1. Que al cambiar de modalidad un asiento salga vacio.
//   2. Que un producto DORMIDO llegue a venderse.
//   3. Que al despertar NO venda.
//   4. Que se toque lo que juega de verdad.
//
//   node scripts/prueba-los-asientos-no-se-vacian-al-cambiar.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";

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

const motor = await import(
  pathToFileURL(join(RAIZ, "src", "lib", "workflow", "config.ts")).href
);
const {
  idEnElAsiento,
  puestosDeLaModalidad,
  repartirPorEtiqueta,
  vendeConPresentacionPrestada,
} = motor;

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 54)} ${valor}`);
};

// PRODUCTOS INVENTADOS. Una prueba con los reales tapa justo el fallo que la
// regla de la plantilla evita.
const biblioteca = [
  { id: "p1", name: "PRODUCTO ALFA" },
  { id: "p2", name: "PRODUCTO BETA" },
  { id: "p3", name: "PRODUCTO GAMA" },
];

/** Lineal, tal como lo tenia guardado: su asiento bajo la clave vieja. */
const comoLoTenia = {
  biblioteca_de_productos: biblioteca,
  alineacion_por_modalidad: { lineal: { unico: "p1", upsell: "p2" } },
};

// -- 1. EL PRODUCTO NO DESAPARECE -------------------------------------------
console.log("\n-- 1. el producto no desaparece --------------------------------");
const suya = comoLoTenia.alineacion_por_modalidad.lineal;
comprobar(
  "preguntando por «basico» sale el que tenia",
  idEnElAsiento(suya, "basico") === "p1",
  "guardado como «unico»"
);
comprobar(
  "y preguntando por «unico» tambien",
  idEnElAsiento(suya, "unico") === "p1",
  "el mismo asiento"
);
comprobar(
  "el upsell no se toca",
  idEnElAsiento(suya, "upsell") === "p2",
  "cada uno lo suyo"
);
comprobar(
  "un asiento de verdad vacio sigue vacio",
  idEnElAsiento(suya, "full") === undefined,
  "no se inventa nada"
);
// EL DIRECTO MANDA. Si algun dia quedaran las dos claves con valores distintos,
// no puede decidir la rancia.
comprobar(
  "si estan las dos, manda la que se pregunta",
  idEnElAsiento({ unico: "p1", basico: "p3" }, "basico") === "p3",
  "el gemelo es solo respaldo"
);

// -- 2. LO QUE JUEGA NO SE TOCO ---------------------------------------------
console.log("\n-- 2. lo que JUEGA no se toco ---------------------------------");
comprobar(
  "lineal sigue jugando dos puestos",
  JSON.stringify(puestosDeLaModalidad("lineal")) ===
    JSON.stringify(["unico", "upsell"]),
  "igual que antes"
);
comprobar(
  "-DOU- sigue jugando los suyos",
  JSON.stringify(puestosDeLaModalidad("doble_oferta_upsell")) ===
    JSON.stringify(["basico", "full", "upsell"]),
  "igual que antes"
);
comprobar(
  "-OB- sigue jugando los suyos",
  JSON.stringify(puestosDeLaModalidad("order_bump")) ===
    JSON.stringify(["basico", "complementario", "full", "upsell"]),
  "igual que antes"
);

// -- 3. LO COSMETICO NO DISPARA ---------------------------------------------
//
// EL CORAZON DE LO QUE PIDIO. Se sienta un producto en un asiento que en lineal
// NO vende, se ejecuta el reparto DE VERDAD, y se comprueba que no aparece por
// ninguna parte de lo que el bot manda.
console.log("\n-- 3. lo cosmetico NO dispara ---------------------------------");
const conDormidos = {
  ...comoLoTenia,
  alineacion_por_modalidad: {
    lineal: { unico: "p1", upsell: "p2", full: "p3", complementario: "p3" },
  },
};
const repartido = repartirPorEtiqueta(conDormidos);
// SOLO LAS CAJAS QUE EL BOT MANDA. La biblioteca NO cuenta: ahi viven todos sus
// productos a proposito, estén jugando o no —es su catalogo—. Mirar la
// configuracion entera daria por vendido un producto que solo esta guardado.
const CAJAS_QUE_SE_ENVIAN = [
  "product_name",
  "product_name_2",
  "course_content",
  "course_content_2",
  "image_gallery",
  "image_gallery_2",
  "pack_gallery",
];
const loQueSaleDeVerdad = (cfg) =>
  JSON.stringify(CAJAS_QUE_SE_ENVIAN.map((k) => cfg[k] ?? null));
const todoLoQueSale = loQueSaleDeVerdad(repartido);
comprobar(
  "el basico SI llega a la caja que se vende",
  repartido.product_name === "PRODUCTO ALFA",
  `product_name=${repartido.product_name}`
);
comprobar(
  "el producto DORMIDO no llega a ninguna caja",
  !todoLoQueSale.includes("PRODUCTO GAMA"),
  "sentado en full y complementario, y no sale"
);
comprobar(
  "y la caja de la segunda opcion queda vacia",
  !repartido.product_name_2,
  `product_name_2=${repartido.product_name_2 ?? "(vacio)"}`
);

// -- 4. AL DESPERTAR, VENDE --------------------------------------------------
//
// La otra mitad: encender el selector tiene que ACTIVAR lo que dormia, con el
// mismo producto y sin tocar nada mas.
console.log("\n-- 4. al despertar, vende -------------------------------------");
const despierto = repartirPorEtiqueta({
  ...conDormidos,
  segunda_opcion_prestada: "dos_juntas",
});
comprobar(
  "el que dormia ahora SI llega a una caja que se envia",
  loQueSaleDeVerdad(despierto).includes("PRODUCTO GAMA"),
  "se activo sin volver a elegirlo"
);
comprobar(
  "y el basico sigue siendo el mismo",
  despierto.product_name_2 === "PRODUCTO ALFA" ||
    despierto.product_name === "PRODUCTO ALFA",
  "no se perdio al cambiar"
);

// -- 4.b. Y EL MOTOR SE ENTERA DE QUE HAY DOS OPCIONES -----------------------
//
// LO QUE PIDIO EL DUEÑO, con sus palabras: «quiero tener todas las ranuras en
// lineal, y con el selector solo cambiar y que cambie el comportamiento como si
// hubieses cambiado a dou o ob».
//
// El selector NO cambia la modalidad por dentro —lineal sigue siendo lineal, y
// por eso su contenido no se mueve—. Pero el motor decide casi todo preguntando
// «¿soy -OB-?» / «¿soy -DOU-?», y esas 62 puertas contestaban «no».
//
// Las 62 pasan por DOS funciones, asi que se contesta ahi una sola vez. Tocar
// las 62 llamadas seria tocar 62 trozos de codigo que hoy funcionan.
//
// LAS DOS FORMAS PIDEN EL MISMO SEGUNDO PRODUCTO: el FULL.
//
// «Como -OB-» pedia el COMPLEMENTARIO y los nombres salian cruzados —presentaba
// el basico como la opcion cara—. El complementario no se vende suelto: es lo
// que se le suma al basico para formar el full. Lo que separa a las dos formas
// es CUANDO se revela la segunda, no que productos son.
console.log("\n-- 4.b. el motor se entera de que hay dos opciones ------------");
// Los NOMBRES de las dos opciones los escribe el REPARTO en las cajas de
// contenido, y asi es como le llega la configuracion al motor. Con el archivo
// en crudo el nombre esta vacio y la oferta no se arma: la prueba mira lo mismo
// que mira el bot.
const conElSelector = (forma, alineacion) =>
  repartirPorEtiqueta({
    ...comoLoTenia,
    segunda_opcion_prestada: forma,
    alineacion_por_modalidad: { lineal: alineacion },
  });
const losDos = { unico: "p1", upsell: "p2", full: "p3" };
const soloUno = { unico: "p1", upsell: "p2" };

comprobar(
  "apagado, el motor NO ve dos opciones",
  !vendeConPresentacionPrestada(comoLoTenia, "dos_juntas") &&
    !vendeConPresentacionPrestada(comoLoTenia, "segunda_oculta"),
  "como hoy"
);
comprobar(
  "«como -DOU-» abre la puerta de doble oferta",
  vendeConPresentacionPrestada(conElSelector("dos_juntas", losDos), "dos_juntas"),
  "las 26 puertas contestan si"
);
comprobar(
  "«como -OB-» abre la de order bump",
  vendeConPresentacionPrestada(
    conElSelector("segunda_oculta", losDos),
    "segunda_oculta"
  ),
  "las 22 puertas contestan si"
);
comprobar(
  "y cada forma abre SOLO la suya",
  !vendeConPresentacionPrestada(
    conElSelector("dos_juntas", losDos),
    "segunda_oculta"
  ),
  "-DOU- no enciende -OB-"
);
// Y NINGUNA CRUZA LOS PRODUCTOS: LOS DOS ESTÁN, CADA UNO EN UN HUECO.
//
// AQUÍ ANTES SE EXIGÍA EL CARO EN EL HUECO 1 EN LAS DOS FORMAS, y desde el
// 24/09 ya no es así: «como -OB-» pone delante el producto VISIBLE, porque el
// hueco 1 es lo único que el bot conoce mientras conversa y el full tiene que
// seguir oculto. Ver `prueba-como-ob-no-destapa-el-full`, que fija cada forma.
//
// Lo que esta comprobación protege NO ha cambiado: que estén los dos y que no se
// repita uno. El orden lo vigila la otra prueba.
const HUECOS_ESPERADOS = {
  dos_juntas: { 1: "PRODUCTO GAMA", 2: "PRODUCTO ALFA" },
  segunda_oculta: { 1: "PRODUCTO ALFA", 2: "PRODUCTO GAMA" },
};
for (const forma of ["dos_juntas", "segunda_oculta"]) {
  const repartida = conElSelector(forma, losDos);
  const esperado = HUECOS_ESPERADOS[forma];
  comprobar(
    `«${forma}» no cruza: los dos productos, uno por hueco`,
    repartida.product_name === esperado[1] &&
      repartida.product_name_2 === esperado[2],
    `1=${repartida.product_name} 2=${repartida.product_name_2}`
  );
}
// EL CANDADO QUE MAS IMPORTA: sin el segundo producto sentado NO se abre nada.
// Presentar dos opciones cuando una no tiene ni nombre ni precio es peor que
// seguir vendiendo una.
comprobar(
  "sin el segundo producto sentado NO se abre",
  !vendeConPresentacionPrestada(
    conElSelector("dos_juntas", soloUno),
    "dos_juntas"
  ),
  "sigue vendiendo uno, como debe"
);

// -- 5. LA PANTALLA: LOS CUATRO SIEMPRE --------------------------------------
console.log("\n-- 5. la pantalla: los cuatro siempre -------------------------");
const editor = readFileSync(join(RAIZ, "src", "app", "editor", "page.tsx"), "utf8");
comprobar(
  "hay una lista de lo que SE VE, aparte de lo que juega",
  /function asientosDeLaPantalla\(/.test(editor),
  "dos listas, a proposito"
);
comprobar(
  "y enseña los cuatro en las tres modalidades",
  /const conLosCuatro = \[\s*"lineal",\s*"order_bump",\s*"bioferta",\s*"doble_oferta_dos",\s*"doble_oferta_upsell",\s*\]/.test(
    editor
  ),
  "lineal, -DOU- y -OB-"
);
comprobar(
  "los asientos de la pantalla salen de esa lista",
  /const puestos = asientosDeLaPantalla\(modalidad, cfg\)/.test(editor),
  "no de la de jugar"
);
comprobar(
  "y se marca cual VENDE de verdad",
  /const queJuegan = new Set<string>\(/.test(editor) &&
    /no vende aquí/.test(editor),
  "lo dormido se ve dormido"
);
// EL CARTELITO MINTIÓ UNA VEZ. El dueño puso su producto en el básico de lineal
// y le salió «no vende aquí» en gris, cuando el reparto SÍ lo estaba vendiendo:
// la lista de lineal dice «unico» y la pantalla pregunta por «basico». El
// puente estaba puesto para sacar el producto, y faltaba para esta pregunta.
comprobar(
  "y el basico de lineal NO dice «no vende aqui»",
  /puestosDeLaModalidad\(modalidad, cfg\)\.map\(\(p\) => \(p === "unico" \? "basico" : p\)\)/.test(
    editor
  ),
  "unico y basico son el mismo asiento"
);
// Y LA MITAD QUE IMPORTA, medida contra el motor: en lineal el basico VENDE.
const juegaEnLineal = new Set(
  puestosDeLaModalidad("lineal").map((p) => (p === "unico" ? "basico" : p))
);
comprobar(
  "en lineal venden el basico y el upsell",
  juegaEnLineal.has("basico") &&
    juegaEnLineal.has("upsell") &&
    !juegaEnLineal.has("full") &&
    !juegaEnLineal.has("complementario"),
  [...juegaEnLineal].join(", ")
);
comprobar(
  "el desplegable pregunta por el asiento, no por la clave",
  /const elegido = idEnElAsiento\(alineacion, valor\)/.test(editor),
  "por eso ya no sale «ninguno»"
);
comprobar(
  "y al guardar escribe las dos claves juntas",
  /siguiente\.basico = id;\s*siguiente\.unico = id;/.test(editor),
  "ninguna se queda rancia"
);

// -- 6. EL REPARTO SIGUE PREGUNTANDO POR LO QUE JUEGA ------------------------
//
// Si alguien cambiara esto por `asientosDeLaPantalla`, lo dormido empezaria a
// venderse. Es la linea que sostiene el punto 3.
console.log("\n-- 6. el candado que sostiene todo ----------------------------");
const fuente = readFileSync(
  join(RAIZ, "src", "lib", "workflow", "config.ts"),
  "utf8"
);
comprobar(
  "el reparto usa la lista de lo que JUEGA",
  /const puestos = puestosDeLaModalidad\(modo, config\);/.test(fuente),
  "nunca la de la pantalla"
);
comprobar(
  "y el motor cruza el puente al leer, no al guardar",
  /const id = idEnElAsiento\(alineacion, puesto\);/.test(fuente) &&
    !/alineacion\.unico = /.test(fuente),
  "las claves guardadas no se renombran"
);

console.log(
  fallos === 0
    ? "\nTODO OK — los cuatro asientos se ven, solo venden los suyos, y cambiar no mueve nada\n"
    : `\n${fallos} comprobacion(es) mal.\n`
);
process.exit(fallos === 0 ? 0 : 1);
