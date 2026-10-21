// UNA LIBRETA DE VERSIONES PARA LA INTRO DE LA OFERTA Y LA DEL UPSELL.
//
// LO QUE PASABA
//
//   Cambiar el contenido de esos cajones obligaba a borrar el que habia, y el
//   anterior se perdia. Lo natural seria duplicar el cajon, pero hoy el duplicado
//   no sobrevive al guardado — ese fallo sigue abierto.
//
//   Esto lo RODEA en vez de arreglarlo, y a proposito: se guarda una copia del
//   contenido en una libreta aparte —que si guarda— y se vuelve a ella
//   eligiendola en un desplegable.
//
// POR QUE VIVE EN LA RAIZ, Y NO ES UN DETALLE
//
//   Dentro del bloque de la oferta se perderia igual que se pierde el duplicado.
//   En su propia lista usa el mismo camino que la biblioteca de productos, que si
//   guarda. Si alguien la mueve ahi dentro, vuelve el fallo entero.
//
// EL MOTOR NO LA LEE NUNCA
//
//   Es una libreta, no una pieza del embudo. Si el motor la leyera, guardar una
//   version cambiaria lo que se envia — y guardar tiene que ser inofensivo.
//
// LO QUE NO PUEDE VOLVER A PASAR
//
//   1. Que cargar otra version pise lo escrito sin preguntar.
//   2. Que la pregunta salga siempre. Saliendo siempre se acepta sin leerla a la
//      tercera vez, y deja de proteger.
//   3. Que «no guardar» sea irreversible de un solo clic.
//   4. Que las burbujas se guarden en el formato de la pantalla: al cargar una
//      version saldrian vacias, que es el mismo fallo que dejo mudas las entregas.
//
//   node scripts/prueba-versiones-guardadas-del-cajon.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");
const config = leer("src", "lib", "workflow", "config.ts");
const motor = leer("src", "lib", "workflow", "engine.ts");
const api = leer("src", "app", "api", "workflow", "route.ts");
const editor = leer("src", "app", "editor", "page.tsx");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// -- 1. LA LIBRETA VIVE EN LA RAIZ -------------------------------------------
comprobar(
  "la libreta existe y está en la raíz",
  /^  biblioteca_de_intros\?: \{/m.test(config),
  "no dentro de la oferta"
);
comprobar(
  "la API la lee y la escribe",
  /const biblioteca_de_intros = Array\.isArray\(config\?\.biblioteca_de_intros\)/.test(
    api
  ) && /doc\.set\("biblioteca_de_intros", blockNode\(doc, versiones\)\)/.test(api),
  "de ida y de vuelta"
);
// LAS BURBUJAS, POR EL TRADUCTOR DE SIEMPRE. La pantalla usa `texts` y el archivo
// `body_variants`: guardadas en crudo, al cargar una version saldrian vacias.
comprobar(
  "las burbujas se traducen como las demás",
  /steps: Array\.isArray\(v\?\.steps\)\s*\r?\n?\s*\? \(v\.steps as EditorStep\[\]\)\.map\(writeStep\)/.test(
    api
  ),
  "writeStep, como todas"
);
// Y SEPARADAS POR SITIO: las de la oferta no pueden salir en el desplegable del
// upsell. Son contenidos de dos ventas distintas.
comprobar(
  "cada versión sabe de cuál de las dos es",
  /lugar: str\(v\?\.lugar\) === "upsell" \? "upsell" : "order_bump"/.test(api) &&
    /biblioteca\.filter\(\(v\) => \(v\.lugar \?\? "order_bump"\) === lugar\)/.test(
      editor
    ),
  "no se mezclan"
);

// -- 2. EL MOTOR NI LA MIRA --------------------------------------------------
//
// Guardar una version tiene que ser inofensivo. Si el motor la leyera, guardar
// cambiaria lo que se envia.
comprobar(
  "el motor no la lee",
  !/biblioteca_de_intros/.test(motor),
  "guardar no cambia la venta"
);

// -- 3. CARGAR OTRA NO PISA NADA SIN PREGUNTAR -------------------------------
comprobar(
  "existe el selector",
  /function SelectorDeVersiones\(/.test(editor),
  "en el cajón"
);
// -- 3-BIS. LA VERSION ELEGIDA ES LA QUE MANDA -------------------------------
//
// AQUI ESTA EL NUDO. El cajon de estas dos intros NO GUARDA: se escribe, se pulsa
// Guardar y al volver esta el texto anterior. Se comprobo contra el archivo real,
// el texto nuevo no aparecia en ninguna parte.
//
// La libreta si guarda. Asi que la version elegida ES la que manda, el cajon pasa
// a ser su reflejo, y lo que se escribe va a ella — que es lo que sobrevive.
comprobar(
  "una versión puede quedar elegida, y se guarda",
  /activa\?: boolean;/.test(config) &&
    /activa: item\?\.activa === true/.test(api) &&
    /\.\.\.\(v\?\.activa === true \? \{ activa: true \} : \{\}\)/.test(api),
  "no se pierde al recargar"
);
comprobar(
  "el motor la recibe por una capa",
  /export function aplicarVersionActiva\(/.test(config) &&
    /aplicarVersionActiva\(repartirPorEtiqueta\(config\)\)/.test(config),
  "sin tocar el motor"
);
// SIN NINGUNA ELEGIDA NO HACE NADA. Quien no use el selector se comporta igual
// que antes, con el reparto por peso entre varios cajones incluido.
comprobar(
  "sin ninguna elegida, todo sigue como antes",
  /if \(!Array\.isArray\(libreta\) \|\| libreta\.length === 0\) return config;/.test(
    config
  ),
  "el bot no cambia"
);
// UNA VERSION VACIA NO PUEDE MANDAR: dejaria la oferta muda y callaria al cajon
// que si tiene texto.
comprobar(
  "una versión sin burbujas no manda",
  /v && \(v\.steps \?\? \[\]\)\.length > 0/.test(config),
  "no deja la oferta muda"
);
// LA LIBRETA PASO A SER UN ARCHIVADOR, Y ESTAS CINCO COMPROBACIONES CAMBIAN CON
// ELLA — LA INTENCION NO.
//
// Lo que este bloque protegia era: «que el trabajo del dueno no se pierda por
// usar el selector». Eso sigue siendo lo que se mide. Lo que cambia es COMO se
// consigue.
//
// Nacio como rodeo porque duplicar un cajon no sobrevivia al guardado, y por eso
// la version elegida MANDABA sobre el cajon y escondia Peso, Duplicar y Quitar.
// Arreglada la causa —ver `prueba-el-cajon-del-upsell-se-duplica-de-verdad`— el
// dueno pidio el 15 de septiembre de 2026 que la pantalla se comporte «idéntico
// al de la sección intro / seguimiento», y que el selector deje de mandar.
//
// Así que ya no se comprueba que la version tape al cajon: se comprueba que
// archivar y recuperar sigan sin perder nada, que es lo mismo de siempre.
comprobar(
  "lo que escribes vive en el cajón, que ahora sí guarda",
  /const grupos = gruposDelCajon;/.test(editor) &&
    /const onGrupos = onGruposDelCajon;/.test(editor),
  "la version ya no lo tapa"
);
comprobar(
  "y el reparto se ofrece siempre",
  !/\{!laQueManda && \(/.test(editor),
  "agregar cajón, peso, duplicar y quitar"
);
comprobar(
  "se puede renombrar y borrar un texto guardado",
  /Nuevo nombre para este texto guardado:/.test(editor) &&
    /del archivador\? Se pierden sus burbujas/.test(editor),
  "las dos"
);
comprobar(
  "cargar uno NO pisa lo que ya hay: entra como cajón nuevo",
  /onCargarComoCajon\(suya\)/.test(editor) &&
    /onCargarComoCajon=\{\(version\) =>[\s\S]{0,400}enabled: false,/.test(editor),
  "nada que avisar, porque nada se pierde"
);
comprobar(
  "y archivar no cambia lo que se envía",
  /\{ id, name: nombre, lugar, steps: cloneJson\(steps\) \}/.test(editor),
  "guardar es inofensivo"
);

// -- 4. LA ELECCION CON BOTONES, DENTRO DE LA VENTANA DEL CAJON --------------
//
// Estaba debajo de la LISTA, asi que al abrir un cajon se perdia de vista justo
// la frase que remata lo que estas escribiendo.
comprobar(
  "el cajón tiene pie, y ahí va la elección",
  /pie\?: ReactNode;/.test(editor) &&
    /previewContext=\{previewContext\}\s*\r?\n?\s*\/>\s*\r?\n?\s*\{pie\}/.test(
      editor
    ),
  "dentro de su ventana"
);
// LOS CUATRO SITIOS: la oferta y el upsell, en la modalidad y en cada canal.
comprobar(
  "los cuatro cajones lo usan",
  (editor.match(/\s+pie=\{\s*\r?\n?\s*<>/g) ?? []).length === 4,
  "modalidad y canal"
);
comprobar(
  "y los cuatro ofrecen guardar versión",
  (editor.match(/lugar="(order_bump|upsell)"/g) ?? []).length === 4,
  "los mismos cuatro"
);

console.log(
  fallos === 0
    ? "\nTODO OK — se guarda una versión y se vuelve a ella sin perder nada"
    : `\n${fallos} FALLO(S)`
);
process.exit(fallos === 0 ? 0 : 1);
