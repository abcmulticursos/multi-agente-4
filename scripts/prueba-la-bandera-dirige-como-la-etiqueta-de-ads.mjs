// LA BANDERA DIRIGE IGUAL QUE LA ETIQUETA DE ANUNCIOS.
//
// LO QUE PIDIO EL DUEÑO — 24 de septiembre de 2026:
//
//   «Quiero que los seguimientos e intros y todo lo que yo elija se redirija a
//    un pais. A un seguimiento o intro lo duplico, le pongo la banderita de
//    Peru, o de Argentina o Ecuador, y que eso se vaya hacia el numero de su
//    respectiva lada.»
//
// Y LO AFINO EL MISMO, que es lo que hace bueno el diseño:
//
//   «¿La bandera no es solo una etiqueta como la de los ads? Mira como
//    agregarlo igual.»
//
// Tenia razon: el rail ya estaba construido. En `FollowupSequence` y
// `FollowupVariant` ya existia `ad_keys` con su `ad_routing_enabled`, y el motor
// ya sabia elegir con ese molde. La bandera es su gemela.
//
// LA REGLA, LA MISMA EN LOS CUATRO SITIOS:
//
//     los que llevan la bandera del cliente  -> si hay alguno, juegan SOLO esos
//     los que no llevan ninguna              -> si no hay ninguno, juegan estos
//
// Y despues, dentro de lo que quedo, decide la etiqueta del anuncio. Asi las dos
// se cumplen a la vez.
//
// LO QUE NO PUEDE ROMPERSE — y es casi todo:
//
//   1. SIN NINGUNA BANDERA PUESTA, NADA CAMBIA. Todos quedan generales y el
//      sorteo por peso decide igual que hasta hoy.
//   2. SIN PAIS CONOCIDO, tampoco: se sortea entre todos.
//   3. SI TODOS LLEVAN BANDERA Y AL CLIENTE NO LE TOCA NINGUNA, no se queda sin
//      intro: juega el sorteo de siempre.
//   4. EL PESO SIGUE MANDANDO dentro del grupo que quede.
//
//   node scripts/prueba-la-bandera-dirige-como-la-etiqueta-de-ads.mjs
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { readFileSync } from "node:fs";

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
const { sorteaCajonDeIntro } = motor;

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 56)} ${valor}`);
};

// Cajones inventados, con un texto que dice de quien es cada uno.
const cajon = (nombre, paises, extra = {}) => ({
  name: nombre,
  steps: [{ type: "text", body: nombre }],
  ...(paises ? { paises } : {}),
  ...extra,
});
/** Qué cajón salió: se lee del texto, que es lo que llegaría al cliente. */
const cual = (pasos) => pasos?.[0]?.body ?? "(ninguno)";

// -- 1. CON BANDERA, SOLO LOS DE SU PAIS -------------------------------------
console.log("\n-- 1. con bandera, solo los de su pais ---------------------");
const mezcla = [
  cajon("PERU", ["PE"]),
  cajon("ARGENTINA", ["AR"]),
  cajon("GENERAL", null),
];
for (const [pais, esperado] of [
  ["PE", "PERU"],
  ["AR", "ARGENTINA"],
]) {
  // Se prueba con varias semillas: el sorteo no debe poder sacar otro.
  const salidas = new Set(
    [0, 1, 2, 3, 4, 5, 6, 7].map((s) => cual(sorteaCajonDeIntro(mezcla, s, pais)))
  );
  comprobar(
    `un cliente de ${pais} recibe el suyo`,
    salidas.size === 1 && salidas.has(esperado),
    [...salidas].join(", ")
  );
}
// ESTA COMPROBACION CAMBIO DE INTENCION EL 02/10/2026, A PETICION DEL DUEÑO.
//
// Decia: «uno de un pais sin cajon recibe el general». Ahora NO: el dueño pidio cuatro
// veces que «sin bandera no se dispara», asi que una pieza sin bandera ya no entra en el
// sorteo de nadie.
//
// LO QUE PROTEGIA SIGUE EN PIE, y es lo importante: QUE NADIE SE QUEDE SIN INTRO. Esa
// regla la puso una prueba suya y no se toca. Lo que cambia es de donde sale el respaldo:
// antes era una pieza SIN bandera, ahora una CON bandera aunque sea de otro pais.
comprobar(
  "y uno de un pais sin cajon recibe UNO CON bandera, no el general",
  (() => {
    const salidas = new Set(
      [0, 1, 2, 3].map((s) => cual(sorteaCajonDeIntro(mezcla, s, "MX")))
    );
    return salidas.size > 0 && !salidas.has("GENERAL");
  })(),
  "algo antes que nada, pero nunca lo que no tiene bandera"
);

// -- 2. SIN BANDERAS PUESTAS, NADA CAMBIA ------------------------------------
//
// EL CANDADO QUE MAS IMPORTA: esto tiene que poder encenderse cajon por cajon
// sin que nada de lo de hoy se mueva.
console.log("\n-- 2. sin banderas puestas, nada cambia --------------------");
const sinBanderas = [cajon("UNO", null), cajon("DOS", null)];
const conPais = [0, 1, 2, 3].map((s) => cual(sorteaCajonDeIntro(sinBanderas, s, "PE")));
const sinPais = [0, 1, 2, 3].map((s) => cual(sorteaCajonDeIntro(sinBanderas, s)));
comprobar(
  "el sorteo sale igual con pais y sin pais",
  JSON.stringify(conPais) === JSON.stringify(sinPais),
  conPais.join(",")
);
comprobar(
  "y siguen jugando los dos",
  new Set(conPais).size === 2,
  "no se perdio ninguno"
);

// -- 3. SIN PAIS CONOCIDO, SE SORTEA ENTRE TODOS -----------------------------
console.log("\n-- 3. sin pais conocido ------------------------------------");
// TAMBIEN CAMBIO DE INTENCION EL 02/10/2026, por el mismo pedido. Sin pais conocido ya no
// se cae en los que no llevan bandera —esos no salen nunca— pero SIGUE SIN QUEDARSE SIN
// INTRO, que es lo que esta comprobacion existe para proteger.
comprobar(
  "sin pais conocido sigue saliendo algo, y con bandera",
  (() => {
    const salidas = new Set(
      [0, 1, 2, 3].map((s) => cual(sorteaCajonDeIntro(mezcla, s, null)))
    );
    return salidas.size > 0 && !salidas.has("GENERAL");
  })(),
  "no se queda sin intro"
);

// -- 4. SI TODOS LLEVAN BANDERA Y NO LE TOCA NINGUNA, NO SE QUEDA SIN NADA ----
//
// El caso que dejaria a un pais entero sin intro. Se prefiere el sorteo de
// siempre a no mandar nada: un cliente sin intro es una venta perdida segura.
console.log("\n-- 4. todos con bandera y ninguna le toca ------------------");
const todosConBandera = [cajon("PERU", ["PE"]), cajon("ARGENTINA", ["AR"])];
comprobar(
  "recibe algo igualmente",
  cual(sorteaCajonDeIntro(todosConBandera, 0, "MX")) !== "(ninguno)",
  cual(sorteaCajonDeIntro(todosConBandera, 0, "MX"))
);

// -- 5. EL INTERRUPTOR CONSERVA LAS BANDERAS Y APAGA EL DIRIGIR ---------------
//
// El gemelo de `ad_routing_enabled`: sirve para probar sin borrar el etiquetado.
console.log("\n-- 5. el interruptor de dirigir ----------------------------");
const apagado = [
  cajon("PERU", ["PE"], { pais_routing_enabled: false }),
  cajon("GENERAL", null),
];
comprobar(
  "con el dirigir apagado, el de Peru vuelve al sorteo",
  new Set([0, 1, 2, 3].map((s) => cual(sorteaCajonDeIntro(apagado, s, "PE")))).size === 2,
  "juegan los dos"
);

// -- 6. EL PESO SIGUE MANDANDO DENTRO DEL GRUPO QUE QUEDA --------------------
console.log("\n-- 6. el peso sigue mandando ------------------------------");
const conPeso = [
  cajon("POCO", ["PE"], { weight: 1 }),
  cajon("MUCHO", ["PE"], { weight: 9 }),
];
const tiradas = Array.from({ length: 100 }, (_, s) =>
  cual(sorteaCajonDeIntro(conPeso, s, "PE"))
);
const muchas = tiradas.filter((t) => t === "MUCHO").length;
comprobar(
  "el de peso 9 sale mucho mas que el de peso 1",
  muchas > 70,
  `${muchas} de 100`
);

// -- 7. Y LOS OTROS TRES SITIOS PREGUNTAN LO MISMO ---------------------------
//
// El motor elige en cuatro sitios y los cuatro tienen que usar el mismo molde.
// Que uno se quede atras es el fallo de esta casa: «la caja que una modalidad
// llena y otra no abre».
console.log("\n-- 7. los cuatro sitios, el mismo molde --------------------");
const engine = readFileSync(join(RAIZ, "src", "lib", "workflow", "engine.ts"), "utf8");
comprobar(
  // EL ORDEN NO CAMBIA: primero el pais y luego el anuncio, que es lo que esta
  // comprobacion protege. Lo que cambio el 02/10/2026 es que el filtro de pais ya no usa
  // `porEtiqueta`: ese ayudante tiene DOS escalones y aqui hacen falta TRES, porque al
  // pedir el dueño que «sin bandera no se dispara» aparecio un tercero —«sin NINGUNA
  // bandera en el proyecto, nada cambia»— que las otras etiquetas no tienen. Tocar el
  // ayudante habria movido tambien la tienda y la semimodalidad.
  // Y el 16/10/2026 se metio entre los dos el corte del respaldo entre paises apagado
  // (ver `etiqueta-de-bandera.ts`): la distancia crece, el orden es el mismo.
  "los seguimientos filtran por bandera antes que por anuncio",
  /const deSuPais =[\s\S]{0,1400}?const pool = porEtiqueta\(/.test(engine),
  "primero el pais, luego el ad"
);
comprobar(
  "la intro principal tambien",
  /const deSuPais = pool\.filter\([\s\S]{0,300}?banderasDeLaIntro/.test(engine),
  "por cajon de intro"
);
comprobar(
  "la intro de la oferta recibe el pais",
  /sorteaCajonDeIntro\(\s*ob\.intro_groups,\s*convo\.id,\s*getEffectiveCountryCode/.test(
    engine
  ),
  "order bump y -DOU-"
);
comprobar(
  "y la del upsell tambien",
  /sorteaCajonDeIntro\(\s*up\.intro_groups,\s*convo\.id,\s*getEffectiveCountryCode/.test(
    engine
  ),
  "la segunda venta"
);

// -- 7-BIS. LA BANDERA DEL SEGUIMIENTO LLEGA A SUS CAJONES -------------------
//
// LO QUE PASO — 24/09/2026, en la prueba del dueño: «en seguimiento 1 no
// reconocio al elegir la bandera, en seguimiento 2 si lo reconocio».
//
// La diferencia era DONDE la puso. Al abrir el editor, los «mensajes
// principales» de un seguimiento BAJAN a la lista como un cajon mas —ver
// `bajarPrincipalALaLista`—, asi que la bandera puesta en el seguimiento entero
// se quedaba arriba sin nadie que la mirara: el motor solo sortea entre cajones.
console.log("\n-- 7-bis. la bandera del seguimiento llega a sus cajones ----");
comprobar(
  "el cajon sin bandera hereda la del seguimiento",
  /banderas:\s*banderasDe\(variant\)\.length > 0\s*\?\s*banderasDe\(variant\)/.test(
    engine
  ) && /:\s*base\.banderas,/.test(engine),
  "la del cajon manda sobre ella"
);
comprobar(
  "y apagar el dirigir del cajon lo deja general",
  /variant\.pais_routing_enabled === false\s*\?\s*\[\]/.test(engine),
  "apagarlo lo apaga de verdad"
);
comprobar(
  "la bandera baja con el mensaje principal al abrir el editor",
  /\.\.\.\(seg\.paises \? \{ paises: JSON\.parse\(JSON\.stringify\(seg\.paises\)\) \} : \{\}\)/.test(
    readFileSync(join(RAIZ, "src", "app", "editor", "page.tsx"), "utf8")
  ),
  "no se pierde al cargar"
);

// -- 8. Y EL EDITOR LA DEJA PONER Y LA ENSEÑA --------------------------------
console.log("\n-- 8. el editor la deja poner y la enseña ------------------");
const editor = readFileSync(join(RAIZ, "src", "app", "editor", "page.tsx"), "utf8");
comprobar(
  "hay un selector de banderas",
  /function BanderaTagPicker\(/.test(editor),
  "hermano de AdTagPicker"
);
comprobar(
  "sale en los cajones de intro del canal",
  /<BanderaTagPicker[\s\S]{0,120}?group\.paises/.test(editor),
  "junto al de anuncios"
);
comprobar(
  "y en los cajones de la oferta y del upsell",
  /<BanderaTagPicker[\s\S]{0,120}?grupo\.paises/.test(editor),
  "lo pidio al probar COMO -OB-"
);
comprobar(
  "y en los seguimientos y sus variantes",
  /<BanderaTagPicker[\s\S]{0,120}?f\.paises/.test(editor) &&
    /<BanderaTagPicker[\s\S]{0,120}?variant\.paises/.test(editor),
  "los dos niveles"
);
comprobar(
  "la bandera viaja al guardar",
  /paises: group\.paises \?\? \[\]/.test(editor),
  "no se la come el guardado"
);
comprobar(
  // LO QUE PROTEGE NO CAMBIA —que la bandera SE VEA sin abrir el cajon— pero el 02/10/2026
  // dejo de estar PEGADA AL NOMBRE y paso a su propia pastilla, a peticion del dueño: «asi
  // el logo de la bandera no queda al inicio del nombre». En su captura se ve por que:
  // «PRUEBA LINEAL PERU» caia en dos lineas.
  //
  // El SEGUIMIENTO del canal sigue enseñando el resumen de sus variantes, porque ahi la
  // bandera es de la variante y ese resumen es informacion, no una eleccion.
  "y se ve en la fila, sin abrir el cajon",
  /seleccionados=\{group\.paises \?\? \[\]\}/.test(editor) &&
    /banderasDeLasVariantes\(followup\)/.test(editor),
  "intro y seguimiento"
);
comprobar(
  "las banderas salen de la lista de siempre",
  /function banderasDeLaPieza[\s\S]{0,200}?COUNTRY_OPTIONS/.test(editor),
  "no hay una lista propia"
);

// -- 9. LA BANDERA SOBREVIVE AL GUARDADO ------------------------------------
//
// EL FALLO REAL, 24/09: el dueño eligió las banderas, guardó, refrescó y la
// pantalla salió como si nunca las hubiera tocado. La causa no estaba en la
// pantalla: la ruta de guardado NO copia el contenido, lo vuelve a construir
// campo por campo, y un campo que nadie nombra ahí se pierde en silencio.
// Por eso aquí se mira la ruta, no el editor.
console.log("\n-- 9. la bandera sobrevive al guardado ---------------------");
const ruta = readFileSync(
  join(RAIZ, "src", "app", "api", "workflow", "route.ts"),
  "utf8"
);
comprobar(
  "los cajones de la oferta y del upsell la escriben",
  /function writeGruposDeIntro[\s\S]{0,900}?paises: strList\(g\.paises\)/.test(ruta),
  "order bump y upsell"
);
comprobar(
  "los cajones de intro del canal la escriben",
  /function writeChannelContent[\s\S]{0,1400}?paises: strList\(group\?\.paises\)/.test(ruta),
  "el canal se reconstruye entero"
);
comprobar(
  "los seguimientos del canal y sus cajones la escriben",
  /function writeChannelContent[\s\S]{0,3600}?paises: strList\(f\?\.paises\)/.test(ruta) &&
    /function writeChannelContent[\s\S]{0,4000}?paises: strList\(variant\?\.paises\)/.test(
      ruta
    ),
  "los dos niveles"
);
comprobar(
  "los seguimientos de la modalidad la escriben",
  /\{ paises: strList\(f\.paises\) \}/.test(ruta) &&
    /\{ paises: strList\(v\.paises\) \}/.test(ruta),
  "seguimiento y variante"
);
comprobar(
  "las intros de la modalidad la escriben y la leen",
  /doc\.set\(\s*"intro_paises"/.test(ruta) &&
    /const intro_paises = Array\.isArray\(config\?\.intro_paises\)/.test(ruta),
  "ida y vuelta"
);
comprobar(
  "y el editor la deja poner en la intro de la modalidad",
  /<BanderaTagPicker[\s\S]{0,120}?_tpl\?\.intro_paises/.test(editor),
  "donde el dueño duplica una intro"
);

// -- 9-bis. EL BANCO: LA BANDERA, ESCALÓN A ESCALÓN -------------------------
//
// Las de arriba miran el archivo fuente. Esta EJECUTA las cuatro funciones de
// la ruta —sacadas del archivo, no reescritas— y sigue la bandera de la
// pantalla al archivo y de vuelta. Y enseña el rojo: con las líneas quitadas,
// que es como estaba el 24/09, el valor se vacía en el escalón 2.
console.log("\n-- 9-bis. el banco: la bandera, escalon a escalon ----------");
const sinTipos = (s) =>
  s
    .replace(/as Record<string, unknown>\[\]/g, "")
    .replace(/as Record<string, unknown>/g, "")
    .replace(/: Record<string, unknown>\[\]/g, "")
    .replace(/: Record<string, unknown>/g, "")
    .replace(/as EditorStep\[\]/g, "")
    .replace(/: EditorStep\[\]/g, "")
    .replace(/as unknown\[\]/g, "")
    .replace(/: unknown/g, "")
    .replace(/: string\[\]/g, "")
    .replace(/: string/g, "")
    .replace(/: number/g, "")
    .replace(/: boolean/g, "");
const cuerpoDesde = (fuente, nombre, arg, marcador) => {
  const i = fuente.indexOf(`function ${nombre}(`);
  const j = fuente.indexOf(marcador, i);
  const f = fuente.indexOf("\n}", j);
  return `function ${nombre}(${arg}) {\n${sinTipos(fuente.slice(j, f))}\n}`;
};
const preludioRuta = `
  const str = (x) => (typeof x === "string" ? x : "");
  const num = (x, d) => (typeof x === "number" && Number.isFinite(x) ? x : d);
  const strList = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
  const readStep = (s) => s;
  const writeStep = (s) => s;
  const readPaymentMenu = (m) => ({ enabled: m?.enabled === true });
  // La TERCERA etiqueta (30/09/2026). Las funciones de la ruta la nombran, así
  // que sin este doble el trozo extraído no puede ejecutarse.
  const leeSemimodalidad = (v) => {
    const s = String(v ?? "").trim().toLowerCase();
    return s === "lineal" || s === "dou" || s === "ob" ? s : "";
  };
`;
/** El viaje entero. Con `conLaBandera` en false se borran las líneas del
 *  arreglo, para ver el fallo como lo vio él. */
const viajeDeLaBandera = (conLaBandera) => {
  const fuente = conLaBandera
    ? ruta
    : ruta
        // Los dos moldes con que se escribe: la línea suelta y el «solo si
        // tiene algo» de los sitios donde el YAML se deja limpio.
        .replace(/^\s*(paises|pais_routing_enabled|paisRoutingEnabled):.*$/gm, "")
        .replace(/\s*\.\.\.\([^)]*\.paises[\s\S]*?:\s*\{\}\),/g, "")
        .replace(/\s*\.\.\.\([^)]*pais_routing_enabled[\s\S]*?:\s*\{\}\),/g, "");
  const piezas = [
    cuerpoDesde(fuente, "readGruposDeIntro", "value", "  if (!Array.isArray(value)) return [];"),
    cuerpoDesde(fuente, "writeGruposDeIntro", "value", "  if (!Array.isArray(value)) return [];"),
    cuerpoDesde(fuente, "readChannelContent", "v", "  const c = (v ?? {})"),
    cuerpoDesde(fuente, "writeChannelContent", "content", "  const writeSteps ="),
  ].join("\n\n");
  return new Function(`${preludioRuta}\n${piezas}\n${CUERPO_DEL_BANCO}`)();
};
const CUERPO_DEL_BANCO = `
  const banderas = (c) => [
    c.intro_groups?.[0]?.paises,
    c.followups?.[0]?.paises,
    c.followups?.[0]?.variants?.[0]?.paises,
    c.order_bump_intro_groups?.[0]?.paises,
  ].map((x) => (x ?? []).join("") || "-").join(" ");
  const delEditor = {
    intro_groups: [{ name: "PERU", weight: 1, steps: [], paises: ["PE"] }],
    followups: [{
      name: "SEG1", delay_minutes_from_first_message: 60, steps: [], paises: ["AR"],
      variants: [{ name: "v2", steps: [], paises: ["EC"] }],
    }],
    payment: [], delivery: [], delivery_groups: [],
    order_bump_intro_groups: [{ name: "OB", weight: 1, steps: [], paises: ["MX"] }],
    upsell_intro_groups: [], post_sale: {},
  };
  const enElArchivo = writeChannelContent(delEditor);
  const alRefrescar = readChannelContent(enElArchivo);
  return [banderas(delEditor), banderas(enElArchivo), banderas(alRefrescar)];
`;
const [enPantalla, enArchivo, trasRefrescar] = viajeDeLaBandera(true);
console.log(`     1. lo que manda la pantalla    ${enPantalla}`);
console.log(`     2. escrito en el archivo       ${enArchivo}`);
console.log(`     3. leido al refrescar          ${trasRefrescar}`);
comprobar(
  "la bandera llega al archivo",
  enArchivo === enPantalla,
  "intro, seguimiento, cajon y oferta"
);
comprobar(
  "y sigue ahi al refrescar",
  trasRefrescar === enPantalla,
  "de punta a punta"
);
const [, sinArreglo] = viajeDeLaBandera(false);
console.log(`     y sin el arreglo, el escalon 2 ${sinArreglo}`);
comprobar(
  "sin el arreglo se perdia de verdad",
  sinArreglo === "- - - -",
  "el rojo que el vio"
);

// -- 10. SE ESCRIBE EL PAÍS, COMO EN LOS ADS --------------------------------
console.log("\n-- 10. se escribe el pais, como en los ads -----------------");
comprobar(
  "hay una caja donde escribir",
  /function BanderaTagPicker[\s\S]{0,6000}?placeholder="Escribe un país para agregar"/.test(
    editor
  ),
  "no una fila de cuadritos fijos"
);
comprobar(
  "buscar «Perú» encuentra «Peru»",
  /function BanderaTagPicker[\s\S]{0,1200}?normalize\("NFD"\)/.test(editor),
  "sin tildes, o no aparece el que mas usa"
);
comprobar(
  "el pais elegido se queda con su bandera y se puede quitar",
  /function BanderaTagPicker[\s\S]{0,6000}?Quitar \$\{p\.label\}/.test(editor),
  "igual que una etiqueta de AD"
);
// -- 10-bis. LAS DOS CAJAS, LADO A LADO Y DISTINGUIBLES --------------------
//
// Estaban una encima de otra, del mismo gris y del mismo tamaño: «genera
// confusion», dijo el 24/09. PAIS a la izquierda, ADS a la derecha.
console.log("\n-- 10-bis. las dos cajas, lado a lado ---------------------");
comprobar(
  "van en una fila, no una encima de otra",
  /function FilaDeEtiquetas[\s\S]{0,400}?lg:flex-row/.test(editor),
  "mitad y mitad"
);
comprobar(
  "el pais va a la izquierda y el ad a la derecha",
  (editor.match(/<FilaDeEtiquetas>[\s\S]{0,4000}?<\/FilaDeEtiquetas>/g) ?? [])
    .filter((fila) => fila.includes("<AdTagPicker"))
    .every(
      (fila) => fila.indexOf("<BanderaTagPicker") < fila.indexOf("<AdTagPicker")
    ),
  "en todas las filas"
);
comprobar(
  "cada emoji en su caja",
  /🌎 Dirigir por PAIS/.test(editor) &&
    /🌎 Países asociados/.test(editor) &&
    /🏷️ Etiquetas de AD/.test(editor) &&
    /🏷️ Anuncios asociados/.test(editor),
  "pais y ad"
);
comprobar(
  "y un canto de color distinto en cada una",
  /border-l-sky-500/.test(editor) && /border-l-amber-500/.test(editor),
  "se ve antes que cualquier letra"
);
comprobar(
  "las etiquetas bajan de renglon y no se esconden",
  /function BanderaTagPicker[\s\S]{0,6000}?max-w-full items-center gap-1 break-words/.test(
    editor
  ) && !/min-w-44 flex-1 border-0/.test(editor),
  "a media anchura no pueden salirse"
);

// ESTA COMPROBACION CAMBIO DE INTENCION EL 02/10/2026, A PETICION DEL DUEÑO.
//
// Decia que la bandera saliera PEGADA AL NOMBRE en el titulo. El pidio lo contrario:
// «al lado de lineal a su izquierda este el selector de banderas… y con esto la bandera
// ya no saldria al lado izquierdo del nombre». Tenerla en los dos sitios la repetia y
// partia el titulo en dos lineas — se ve en su propia captura.
//
// LO QUE PROTEGIA SIGUE EN PIE: que la bandera SE VEA sin abrir la pieza. Ahora la enseña
// la pastilla de la fachada, que ademas deja cambiarla desde ahi.
comprobar(
  "la bandera se ve y se elige en la fachada",
  /seleccionados=\{_tpl\?\.intro_paises\?\.\[idx\] \?\? \[\]\}/.test(editor) &&
    /seleccionados=\{f\.paises \?\? \[\]\}/.test(editor) &&
    /seleccionados=\{variant\.paises \?\? \[\]\}/.test(editor),
  "intro, seguimiento y variante"
);

console.log(
  fallos === 0
    ? "\nTODO OK — la bandera dirige como la etiqueta de ads, y sin ella nada cambia\n"
    : `\n${fallos} comprobacion(es) mal.\n`
);
process.exit(fallos === 0 ? 0 : 1);
