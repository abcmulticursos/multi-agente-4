// CON «PRESENTA: COMO -OB-», EL BOT SE COMPORTA COMO -OB-.
//
// LO QUE PASO — 24 de septiembre de 2026. El dueño puso el selector en
// «COMO -OB-» y el bot no se parecia en nada a -OB-. Medido con su
// configuracion:
//
//     vende como -OB-        : true     <- el interruptor SI se activaba
//     contenido de la 2a intro : 3 burbujas
//     nombres de las opciones  : los dos
//     order_bump.enabled     : FALSE    <- y esto es lo que miraba medio motor
//
//   Todo lo necesario estaba. Lo que fallaba es que el prompt preguntaba por el
//   INTERRUPTOR de la modalidad -OB-, y con la presentacion prestada la
//   modalidad sigue llamandose lineal, asi que ese interruptor esta apagado.
//
// LAS CUATRO CONSECUENCIAS, todas en `openrouter.ts`:
//
//   1. El bloque «ORDER BUMP ACTIVE — TWO sellable options» NUNCA se inyectaba:
//      el modelo no se enteraba de que habia dos productos.
//   2. `elOrderBumpSigueOculto` cortaba en su primera linea, asi que la foto del
//      segundo producto podia salir ANTES de su revelacion — la regla mas dura
//      de esta modalidad.
//   3. `linearMode` se quedaba en verdad para siempre: el bot seguia diciendo
//      «hay exactamente UN producto» con las dos opciones ya en pantalla.
//   4. El muro de contenido caia en el del producto unico, y el modelo tenia
//      prohibido usar el contenido de la segunda opcion.
//
// POR QUE VAN LOS CUATRO JUNTOS. En el prompt no hay ramas: todo lo que se
// inyecta compite a la vez. Arreglar solo el 1 le mandaria al modelo «hay DOS
// opciones vendibles» y «hay exactamente UN producto» en el mismo turno.
//
// LO QUE NO PUEDE ROMPERSE
//
//   1. ANTES DEL DESTAPE SE SIGUE VENDIENDO UNO. `linearMode` tiene que seguir
//      siendo verdad mientras el segundo producto esta tapado.
//   2. LOS TRES SITIOS QUE DECIDEN CUAL ES LA MODALIDAD no se tocan: ahi el
//      interruptor SI es la pregunta correcta.
//
//   node scripts/prueba-como-ob-se-comporta-como-ob.mjs
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
const { repartirPorEtiqueta, vendeConPresentacionPrestada, getActiveTwoTierOffer } =
  motor;

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 56)} ${valor}`);
};

// PRODUCTOS INVENTADOS, por la regla de la plantilla.
const biblioteca = [
  { id: "pB", name: "PRODUCTO ALFA", price_soles: 10 },
  { id: "pF", name: "PRODUCTO BETA", price_soles: 15 },
];
const montar = (forma) =>
  repartirPorEtiqueta({
    biblioteca_de_productos: biblioteca,
    alineacion_por_modalidad: { lineal: { unico: "pB", basico: "pB", full: "pF" } },
    ...(forma ? { segunda_opcion_prestada: forma } : {}),
  });

// -- 1. LA PREGUNTA QUE AHORA MANDA CONTESTA BIEN ----------------------------
//
// Se ejecuta el codigo real: es la misma funcion en la que se apoyan ahora los
// cuatro sitios del prompt.
console.log("\n-- 1. la pregunta que manda contesta bien -------------------");
const comoOb = montar("segunda_oculta");
const comoDou = montar("dos_juntas");
comprobar(
  "«COMO -OB-» vende como -OB-",
  vendeConPresentacionPrestada(comoOb, "segunda_oculta") === true,
  "el prompt de -OB- entra"
);
comprobar(
  "y NO como -DOU-",
  vendeConPresentacionPrestada(comoOb, "dos_juntas") === false,
  "no se mezclan"
);
comprobar(
  "«COMO -DOU-» sigue vendiendo como -DOU-",
  vendeConPresentacionPrestada(comoDou, "dos_juntas") === true,
  "no se movio"
);
comprobar(
  "y NO como -OB-",
  vendeConPresentacionPrestada(comoDou, "segunda_oculta") === false,
  "cada una la suya"
);
comprobar(
  "lineal a secas no vende dos",
  getActiveTwoTierOffer(montar(null)) === null,
  "el selector es el que manda"
);

// -- 2. LOS CUATRO SITIOS DEL PROMPT PREGUNTAN POR EL DATO -------------------
console.log("\n-- 2. los cuatro sitios preguntan por el dato ---------------");
const cerebro = readFileSync(join(RAIZ, "src", "lib", "openrouter.ts"), "utf8");
comprobar(
  "1. el bloque de las dos opciones",
  /if \(\s*isOrderBumpActive\(\) &&\s*!orderBumpPostSale &&\s*!orderBumpDeferredUntilPayment\s*\)/.test(
    cerebro
  ),
  "ORDER BUMP ACTIVE se inyecta"
);
comprobar(
  "2. el ocultamiento del segundo producto",
  /if \(!isOrderBumpActive\(\)\) return false;/.test(cerebro),
  "la foto no se adelanta"
);
comprobar(
  "3. el modo de un solo producto",
  /const linearMode =\s*\(!isOrderBumpActive\(\) && !bioferta\?\.enabled\) \|\| orderBumpHidden;/.test(
    cerebro
  ),
  "deja de serlo al destapar"
);
comprobar(
  "4. el muro de contenido",
  /\} else if \(isOrderBumpActive\(\)\) \{/.test(cerebro),
  "puede usar el contenido de la 2a"
);

// -- 2-BIS. Y LAS HERRAMIENTAS TAMBIEN SE LE OFRECEN -------------------------
//
// LO QUE FALTABA, destapado por una pregunta del dueño: «no puede ser que sigas
// usando prompt como pared para detener un rio». Tenia razon en mirar el motor.
//
// La herramienta que consulta el contenido de las dos opciones cuelga de
// `orderBumpFlow`, que preguntaba por el interruptor. Asi que en la presentacion
// prestada NO se le ofrecia NUNCA —ni antes ni despues del destape— y el -OB-
// quedaba a medias: presentaba dos productos y solo sabia explicar uno.
//
// Esto NO es texto del guion: es que herramientas tiene el modelo en el turno.
console.log("\n-- 2-bis. las herramientas tambien se le ofrecen ------------");
comprobar(
  "la que abre las herramientas cuenta la prestada",
  /const orderBumpFlow =\s*!!convo &&\s*isOrderBumpActive\(\) &&/.test(cerebro),
  "elegir opcion y consultar contenido"
);
comprobar(
  "el freno de «no minimices la barata» tambien",
  /const orderBumpReplyGuard = !!convo && isOrderBumpActive\(\);/.test(cerebro),
  "es de vender dos, no de -OB-"
);
comprobar(
  "y el turno de la pregunta de precio",
  /const genericOrderBumpPriceTurn =\s*!!convo &&\s*isOrderBumpActive\(\) &&/.test(
    cerebro
  ),
  "no fuerza las dos opciones antes de tiempo"
);
comprobar(
  "la herramienta de contenido sigue colgando de ahi",
  /orderBumpFlow\s*\?\s*\[[\s\S]{0,140}?ORDER_BUMP_CONTENT_TOOL/.test(cerebro),
  "un solo sitio decide"
);

// -- 3. Y ANTES DEL DESTAPE SE SIGUE VENDIENDO UNO ---------------------------
//
// El freno que no puede desaparecer: mientras el segundo esta tapado, el bot
// dice que hay un solo producto. Se comprueba que `orderBumpHidden` siga en esa
// condicion — si alguien lo quita, el producto oculto deja de estarlo.
console.log("\n-- 3. antes del destape se vende uno ------------------------");
comprobar(
  "el modo de un producto sigue mirando el ocultamiento",
  /\|\| orderBumpHidden;/.test(cerebro),
  "tapado = un solo producto"
);
comprobar(
  "y el ocultamiento sigue siendo el de la etapa diferida",
  /const diferido =[\s\S]{0,200}?convo\?\.state === "intro_done"[\s\S]{0,200}?offer_on_intro_first_message === false\)/.test(
    cerebro
  ),
  "no se invento otra regla"
);

// -- 4. LOS TRES QUE DECIDEN LA MODALIDAD NO SE TOCARON ----------------------
//
// EL CANDADO CONTRA PASARSE DE FRENADA. En estos tres el interruptor SI es la
// pregunta correcta: son los que definen QUE modalidad es. Cambiarlos por el
// dato seria circular.
console.log("\n-- 4. los que deciden la modalidad, intactos ----------------");
const cfgSrc = readFileSync(
  join(RAIZ, "src", "lib", "workflow", "config.ts"),
  "utf8"
);
comprobar(
  "activeModalityKey sigue mirando el interruptor",
  /if \(config\.order_bump\?\.enabled\) return "order_bump";/.test(cfgSrc),
  "es quien decide la modalidad"
);
comprobar(
  "isOrderBumpActive conserva su primera rama",
  /if \(!!cfg\.order_bump\?\.enabled && activeModalityKey\(cfg\) === "order_bump"\)/.test(
    cfgSrc
  ),
  "-OB- de verdad entra por aqui"
);
const editor = readFileSync(
  join(RAIZ, "src", "app", "editor", "page.tsx"),
  "utf8"
);
comprobar(
  "y el selector del editor tampoco se toco",
  /if \(c\.order_bump\.enabled\) return "order_bump";/.test(editor),
  "es el interruptor que el pulsa"
);

console.log(
  fallos === 0
    ? "\nTODO OK — «COMO -OB-» se comporta como -OB-, y antes del destape vende uno\n"
    : `\n${fallos} comprobacion(es) mal.\n`
);
process.exit(fallos === 0 ? 0 : 1);
