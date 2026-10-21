// El tema claro, probado SOLO en Canales.
//
// POR QUE CANALES Y NO OTRA
//
//   Es la unica pestaña cuyas piezas son suyas: sus barras son botones propios,
//   no el cajon compartido de la casa. Se puede cambiar entera sin que se mueva
//   una sola pantalla de las demas.
//
// EN QUE CONSISTE
//
//   Esquinas generosas, tarjeta blanca sobre suelo gris muy claro, un cuadradito
//   de color con un icono al lado de cada titulo, y arriba un rotulo pequeño en
//   mayusculas que dice de que es la pantalla.
//
//   Tres piezas, construidas UNA vez: `FichaDeIcono`, `CabeceraDeSeccion` y
//   `TarjetaSuave`. Copiar estos aspectos a mano en cada sitio es lo que hace
//   que a los dos meses cada pantalla se parezca un poco menos a la de al lado,
//   y nadie sepa cual es la buena.
//
// LO QUE NO PUEDE PASAR
//
//   1. Que la prueba se escape de Canales. El fondo de la pagina, el cajon
//      compartido y las ventanas son de TODAS las pestañas: tocarlos aqui seria
//      soltar el tema entero sin que nadie lo haya aprobado.
//
//   2. Que `panelClass` y `badgeClass` desaparezcan. Los usan el visor del
//      recorrido y otras pantallas que NO entran en la prueba.
//
//   node scripts/prueba-tema-claro-en-canales.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const editor = readFileSync(join(RAIZ, "src", "app", "editor", "page.tsx"), "utf8");
const estilos = readFileSync(join(RAIZ, "src", "app", "globals.css"), "utf8");
const raiz = readFileSync(join(RAIZ, "src", "app", "layout.tsx"), "utf8");
// El interruptor se mudo a su propio archivo para que lo pueda usar el chat.
const interruptor = readFileSync(
  join(RAIZ, "src", "components", "InterruptorDeTema.tsx"),
  "utf8"
);
const barraDelChat = readFileSync(
  join(RAIZ, "src", "components", "DashboardHeader.tsx"),
  "utf8"
);

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// -- 1. LAS TRES PIEZAS, ESCRITAS UNA VEZ ------------------------------------
for (const pieza of ["FichaDeIcono", "CabeceraDeSeccion", "TarjetaSuave"]) {
  comprobar(
    `existe la pieza: ${pieza}`,
    new RegExp(`function ${pieza}\\(`).test(editor),
    "de la casa"
  );
}
comprobar(
  "y los colores viven en un solo sitio",
  /const TONOS_DEL_TEMA = \{/.test(editor) &&
    /type TonoDelTema = keyof typeof TONOS_DEL_TEMA;/.test(editor),
  "no repartidos por ahí"
);
// Cada canal dice su tono, y el tono decide la ficha, el rotulo y el anillo.
//
// SE MIRA SOLO LA TABLA DE LOS CANALES. Antes se contaban los `tono:` de todo
// el archivo y daba cuatro porque no habia mas. Al darle su tono a cada una de
// las quince pestañas, contar el archivo entero pasa a dar diecinueve y este
// aviso se pondria rojo sin que nadie hubiera roto un canal.
comprobar(
  "cada canal trae su tono",
  (() => {
    const i = editor.indexOf("const CHANNEL_PROTOTYPE_META");
    const zona = i < 0 ? editor.slice(0, 0) : editor.slice(i, i + 4000);
    return (
      (zona.match(/tono: "(esmeralda|cielo|fucsia|pizarra|violeta)",/g) ?? [])
        .length === 4
    );
  })(),
  "los cuatro"
);
// Y CADA PESTAÑA TAMBIEN TRAE EL SUYO. El color agrupa: lo que se dice va en un
// color, lo que se vende en otro, el dinero en otro. Sin esto, los cajones de
// todas las pestañas saldrian del mismo color y el color dejaria de decir nada.
comprobar(
  "y cada pestaña también",
  /const CABECERA_DE_TAB: Record<\s*\r?\n?\s*Tab,/.test(editor) &&
    /tono: TonoDelTema/.test(editor),
  "el color agrupa"
);

// -- 2. LA PESTAÑA USA EL TEMA -----------------------------------------------
const pestana = (() => {
  const i = editor.indexOf("function ChannelsPrototypeTab(");
  const f = editor.indexOf("function ChannelSummaryCard(", i);
  return i < 0 || f < 0 ? "" : editor.slice(i, f);
})();
comprobar("se encuentra la pestaña", pestana.length > 0, "Canales");
// EL SUELO PROPIO DE ESTA PESTAÑA SE FUE, Y ESO ES LO QUE SE VIGILA.
//
// Se puso cuando el aspecto se probaba SOLO aqui y la pagina seguia siendo
// blanca: hacia falta un gris debajo para que las tarjetas se despegaran.
//
// Ahora el panel gris lo pone la pagina para las quince. Dejarlo metia un
// TERCER gris —el oscuro del suelo— entre el panel claro y las tarjetas, y esa
// franja oscura alrededor no la habia pedido nadie. La zona que rodea las
// tarjetas es el panel.
comprobar(
  "no se pinta un suelo propio encima del panel",
  pestana.length > 0 && !/bg-fondo/.test(pestana),
  "un solo gris alrededor"
);
// LA CABECERA ES DE LAS QUINCE, Y SE PINTA UNA SOLA VEZ.
//
// Esta fue la primera, de cuando el aspecto se probaba solo en Canales, y
// entonces esta linea exigia que estuviera AQUI DENTRO. Ahora la pinta la
// pagina para todas las pestañas, con el mismo rotulo y la misma frase, asi que
// dejarla tambien aqui era decir «Canales» dos veces seguidas.
//
// Lo que se vigila ahora es lo de enfrente: que no haya DOS.
comprobar(
  "la cabecera se pinta una sola vez, fuera de la pestaña",
  pestana.length > 0 &&
    !/<CabeceraDeSeccion/.test(pestana) &&
    /rotulo=\{CABECERA_DE_TAB\[tab\]\.rotulo\}/.test(editor),
  "sin decir «Canales» dos veces"
);
// Y VA DENTRO DEL PANEL, no en una banda por encima.
//
// Estaba fuera de la seccion que titula, y por eso Canales —que la tenia
// dentro— se veia mejor. El titulo y lo que titula van en la misma caja.
comprobar(
  "y va dentro del panel",
  /bg-panel p-5 shadow-sm transition[\s\S]{0,700}?<CabeceraDeSeccion/.test(editor),
  "el título y lo que titula, juntos"
);

// -- 3. EL SUELO CLARO NO SALE DE CANALES ------------------------------------
//
// Si el fondo de la pagina cambiara, el tema estaria soltado en todas las
// pestañas de golpe, que es justo lo que no se aprobo todavia.
// EL SUELO DE LA PAGINA LO DECIDE EL TEMA.
//
// Era gris medio fijo. En oscuro dejaba toda la pagina clara alrededor de las
// tarjetas oscuras, que es lo contrario de un tema oscuro.
comprobar(
  "el suelo de la página lo decide el tema",
  /className=\{`min-h-screen bg-fondo \$\{vistaNueva \? "pl-\[116px\]" : ""\}`\}/.test(
    editor
  ),
  "no un gris fijo"
);
// La cabecera era blanca fija. Con el menu lateral en oscuro quedaba una franja
// blanca cruzando la pantalla por arriba, encima de todo lo demas ya oscuro.
comprobar(
  "y la cabecera también",
  /<header className="sticky top-0 z-10 border-b border-borde bg-tarjeta">/.test(
    editor
  ),
  "sin franja blanca"
);
// LA BARRA IZQUIERDA, CON FICHAS SUELTAS. Eran tres bloques escritos a mano
// casi iguales pero no del todo: uno azul, otro gris, cada uno con su borde.
comprobar(
  "la barra izquierda usa una sola ficha",
  /function FichaDeLugar\(/.test(editor) &&
    (editor.match(/<FichaDeLugar/g) ?? []).length >= 3,
  "escrita una vez"
);
comprobar(
  "y va con los colores del tema",
  /border-r border-borde bg-tarjeta py-3/.test(editor),
  "clara u oscura"
);
// Los mandos de la cabecera del canal iban en ambar, blanco y azul claro
// puestos a mano: en oscuro se quedaban clarisimos sobre fondo oscuro, manchas
// brillantes con el texto casi ilegible encima.
comprobar(
  "los mandos del canal no llevan color pegado",
  !/border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800/.test(
    editor
  ) && !/border border-sky-200 bg-sky-50 px-2 py-2/.test(editor),
  "el estado da el aviso"
);
// El cajon compartido y la ventana de la casa salen en todas partes.
const cajon = (() => {
  const i = editor.indexOf("function Collapsible(");
  const f = editor.indexOf("function PlaceholderHelp(", i);
  return i < 0 || f < 0 ? "" : editor.slice(i, f);
})();
// AQUI SE EXIGIA LO CONTRARIO, Y SE DA LA VUELTA A PROPOSITO.
//
// Mientras el aspecto se probaba en Canales y en ningun sitio mas, esta linea
// era el seguro de que no se escapara al resto del editor sin querer.
//
// Ya se aprobo, asi que ahora el seguro es el de enfrente: el cajon compartido
// TIENE que llevarlo, porque es la barra que se dibuja en cientos de sitios y
// es lo unico que hace que las quince pestañas se vean iguales. Si alguien lo
// devuelve a la barra gris plana, el editor vuelve a tener dos diseños.
comprobar(
  "el cajón compartido lleva el aspecto de la casa",
  cajon.length > 0 &&
    /<FichaDeIcono\s*\r?\n\s*tono=\{seccion\.tono\}/.test(cajon) &&
    /rounded-2xl bg-tarjeta/.test(cajon),
  "igual en todas"
);
// CADA FILA SU COLOR, Y SIEMPRE EL MISMO.
//
// Con un solo color por pestaña, ocho filas seguidas salian identicas y el
// cuadrado dejaba de servir para distinguirlas: habia que leer los ocho titulos
// para encontrar uno.
//
// Sale del NOMBRE, no de la posicion ni de un sorteo: asi el sitio al que se
// vuelve tiene el mismo color hoy y mañana, y se aprende donde esta cada cosa
// sin leer. Por posicion, mover un cajon cambiaria todo de sitio en la cabeza.
comprobar(
  "cada fila lleva su propio color",
  /clase=\{tonoDeFila\(typeof title === "string" \? title : \(titleKey \?\? ""\)\)\}/.test(
    cajon
  ) && /function tonoDeFila\(titulo: string\): string \{/.test(editor),
  "el mismo siempre"
);
// EL MISMO NOMBRE, EL MISMO COLOR, ESTE DONDE ESTE.
//
// «PRODUCTO FULL» sale en Contenido, en Las 2 opciones, en Order Bump y en
// Entrega. Es el mismo producto en las cuatro, asi que tiene que ser el mismo
// color: si en una es verde y en otra rosa, el color deja de decir «esto es lo
// mismo» y pasa a estorbar.
//
// Por eso se mira el NOMBRE QUE SE LEE y no la llave interna, que es distinta
// en cada pestaña. Y se limpia antes, porque el mismo producto no esta escrito
// igual en todas partes: «PRODUCTO FULL» en una, «PRODUCTO FULL (el de mayor
// precio)» en otra.
// LOS TRES QUE NO SE DEJAN AL AZAR.
//
// El reparto automatico sirve para las decenas de cajones que no significan
// nada en particular. Pero el basico es CELESTE, el full VERDE y el del upsell
// MELON, y ahi el azar acierta o no. Se escriben a mano y desde ahi mandan en
// todas las pestañas donde salga ese nombre.
comprobar(
  "el básico, el full y el upsell llevan su color escrito",
  /\["PRODUCTO BASICO", "bg-sky-200 text-sky-900"\]/.test(editor) &&
    /\["PRODUCTO FULL", "bg-emerald-200 text-emerald-900"\]/.test(editor) &&
    /\["PRODUCTO UPSELL", "bg-amber-200 text-amber-900"\]/.test(editor),
  "celeste, verde y melón"
);
// Y MANDAN SOBRE EL REPARTO, no al reves: si el sorteo pudiera ganarles, el
// color escrito seria una sugerencia y no una regla.
comprobar(
  "y mandan sobre el reparto automático",
  /for \(const \[nombre, color\] of COLOR_POR_NOMBRE\) \{\s*\r?\n\s*if \(clave\.startsWith\(nombre\)\) return color;/.test(
    editor
  ),
  "lo escrito gana"
);
comprobar(
  "y el mismo nombre da el mismo color en toda pestaña",
  /function nombreParaElColor\(titulo: string\): string \{/.test(editor) &&
    /\.replace\(\/\\\(\[\^\)\]\*\\\)\/g, ""\)/.test(editor) &&
    /\.normalize\("NFD"\)/.test(editor),
  "PRODUCTO FULL es igual en las cuatro"
);
// EL DIBUJO SALE DEL TITULO. Los cientos de titulos ya llevan su emoji pegado
// —«🛒 PRODUCTO UPSELL»—, asi que se separa aqui en vez de reescribirlos.
comprobar(
  "el emoji del título se pasa al cuadrado",
  /function partirTituloConEmoji\(/.test(editor) &&
    /const \{ icono, texto \} = partirTituloConEmoji\(title\);/.test(cajon),
  "sin tocar los cientos de títulos"
);
// Y SI EL TITULO NO LLEVA NINGUNO, se hereda el de la pestaña: una fila sin
// cuadrado rompe la columna y se lee como si fuera otra cosa.
comprobar(
  // El orden es: el que el cajón declare, el pegado al título, y de último el de
  // la pestaña. Los cajones de intro, seguimiento, oferta y upsell declaran el
  // suyo para que dentro de Canales no lleven los cuatro el mismo teléfono.
  "y si no lo lleva, hereda el de la pestaña",
  /\{iconoPropio \?\? icono \?\? seccion\.icono\}/.test(cajon) &&
    /const TonoDeLaSeccion = createContext</.test(editor),
  "ninguna fila se queda sin dibujo"
);
// LA CHAPA DICE LA ACCION, NO EL ESTADO. Antes habia una flecha que decia si
// estaba abierto; esto dice que pasa al tocar, que es lo que hace falta antes.
comprobar(
  "y la chapa dice Abrir o Cerrar",
  /\{desplegado \|\| \(enVentana && open\) \? "Cerrar" : "Abrir"\}/.test(cajon),
  "como en Canales"
);

// -- 4. NO SE BORRO LO QUE USAN OTRAS PANTALLAS ------------------------------
comprobar(
  "«panelClass» y «badgeClass» siguen existiendo",
  /panelClass: "border-2 border-emerald-400/.test(editor) &&
    /badgeClass: "bg-emerald-500 text-white"/.test(editor),
  "los usa el recorrido"
);
comprobar(
  "y la chapa redonda del canal sigue en pie",
  /function ChannelBadge\(/.test(editor),
  "no se quitó de en medio"
);

// -- 5. LOS DOS TEMAS, CON UN SOLO JUEGO DE PANTALLAS ------------------------
//
// Los colores se nombran por su FUNCION y no por su color, asi que una pantalla
// escrita con ellos sirve para los dos temas sin tocarla. Lo que cambia son los
// valores, no las pantallas. Sin esto, el oscuro seria repasar cada pestaña.
for (const ficha of [
  "--tema-fondo",
  "--tema-tarjeta",
  "--tema-relleno",
  "--tema-borde",
  "--tema-tinta",
  "--tema-tinta-suave",
  "--tema-acento",
]) {
  comprobar(
    `el color existe en los dos temas: ${ficha}`,
    (estilos.match(new RegExp(`${ficha}:`, "g")) ?? []).length === 2,
    "claro y oscuro"
  );
}
comprobar(
  "el oscuro se pide con una marca en la raíz",
  /:root\[data-tema="oscuro"\] \{/.test(estilos),
  "data-tema"
);
// EL OSCURO ESTA APAGADO A PROPOSITO, Y ESTO LO VIGILA.
//
// Estaba a medias: los paneles de color —el ambar de los avisos, el rojo de los
// bloqueos— seguian claros mientras la letra de encima ya se habia vuelto
// blanca. Blanco sobre crema no se lee. Un tema a medias suelto es peor que no
// tenerlo, asi que se apaga entero hasta terminarlo.
//
// SE APAGA LA ELECCION, NO EL TEMA. Aqui siempre se pone «claro», sin mirar lo
// guardado, y el boton no se dibuja en ninguna pantalla.
comprobar(
  "el tema oscuro está apagado",
  /ELEGIR_TEMA_ANTES_DE_PINTAR = `document\.documentElement\.dataset\.tema="claro";`/.test(
    raiz
  ),
  "siempre claro"
);
comprobar(
  "y el botón no se dibuja en ninguna pantalla",
  !/<InterruptorDeTema/.test(editor) && !/<InterruptorDeTema/.test(barraDelChat),
  "nadie puede encenderlo"
);
// PERO NO SE BORRO NADA. Volver a encenderlo tiene que ser devolver el boton y
// volver a leer lo guardado, no reescribir el tema entero.
comprobar(
  "pero el oscuro sigue guardado entero",
  /:root\[data-tema="oscuro"\] \{/.test(estilos) &&
    /--tema-gris-900: #f1f3f7;/.test(estilos) &&
    /export default function InterruptorDeTema\(/.test(interruptor),
  "se puede devolver"
);
// EL INTERRUPTOR ES UNO SOLO Y VIVE FUERA DEL EDITOR.
//
// Estaba escrito dentro de `editor/page.tsx`, asi que el tema solo se podia
// cambiar desde ahi. Ahora es un componente aparte. Esta guardado sin dibujarse
// mientras el oscuro esta apagado; lo que se vigila es que siga siendo UNO,
// para que el dia que se encienda no aparezcan dos con llaves distintas y una
// pantalla quede en claro y la otra en oscuro.
comprobar(
  "no queda una copia dentro del editor",
  !/function InterruptorDeTema\(/.test(editor) &&
    !/const TEMA_STORAGE_KEY = "wf:tema";/.test(editor),
  "un solo botón"
);
// LA VISTA NO ES EL TEMA. La clasica y el menu lateral son OTRO eje: cada vista
// se ve en los dos temas. Metidos en una sola lista de tres, no se podria tener
// la clasica en oscuro.
comprobar(
  "y la vista sigue siendo cosa aparte",
  /const EDITOR_VISTA_STORAGE_KEY = "wf:editor-vista";/.test(editor) &&
    /export const TEMA_STORAGE_KEY = "wf:tema";/.test(interruptor),
  "dos ejes, cuatro combinaciones"
);

// -- 6. LA LETRA DE LOS TITULOS ----------------------------------------------
//
// Los titulos iban con la del sistema, que en Windows es Segoe UI: de leer
// parrafos, no de titular. En grande y en negrita sale ancha y blanda.
comprobar(
  "los títulos tienen su propia letra",
  /Manrope\(/.test(raiz) && /variable: "--fuente-titulo"/.test(raiz),
  "geométrica y apretada"
);
// El texto corrido se queda con la del sistema: es la que mejor se lee en cada
// maquina y no cuesta ninguna descarga.
comprobar(
  "y solo la usan los títulos",
  /--font-titulo: var\(--fuente-titulo\)/.test(estilos) &&
    (editor.match(/font-titulo/g) ?? []).length > 0,
  "el texto corrido no"
);

// -- 7. EL TEMA ALCANZA A TODO EL BOT, NO SOLO A CANALES ---------------------
//
// EL PROBLEMA. El bot esta escrito con la escala gris de fabrica a mano, unas
// mil seiscientas veces en treinta y dos mil lineas. Con eso, el tema oscuro
// solo existia en la pestaña Canales —la unica convertida a los nombres de
// funcion— y el resto seguia blanco aunque el tema dijera oscuro.
//
// LA SALIDA. No tocar las mil seiscientas: redefinir la ESCALA. En claro vale
// exactamente lo de fabrica, asi que el tema claro no se mueve; en oscuro se da
// la vuelta. Funciona porque la escala se usa con sentido en todo el proyecto:
// los numeros bajos son fondos y los altos son texto.
comprobar(
  "la escala gris sale del tema",
  /--color-neutral-50: var\(--tema-gris-50\);/.test(estilos) &&
    /--color-neutral-900: var\(--tema-gris-900\);/.test(estilos),
  "no hay que tocar cada pantalla"
);
// EN CLARO, IDENTICO A AYER. Si estos valores se apartaran de los de fabrica,
// el tema claro —que ya esta aprobado— cambiaria de tono sin que nadie lo pida.
comprobar(
  "y en claro vale lo de fábrica",
  /--tema-gris-50: oklch\(98\.5% 0 0\);/.test(estilos) &&
    /--tema-gris-900: oklch\(20\.5% 0 0\);/.test(estilos),
  "el tema claro no se mueve"
);
comprobar(
  "en oscuro se da la vuelta",
  /--tema-gris-50: #2a2d36;/.test(estilos) &&
    /--tema-gris-900: #f1f3f7;/.test(estilos),
  "fondo arriba, tinta abajo"
);
// DONDE EL GRIS OSCURO ES UN FONDO Y NO UNA TINTA.
//
// La cortina que tapa la pantalla, los botones rellenos con letra blanca. Ahi
// dar la vuelta a la escala los dejaria casi blancos con letra blanca encima:
// invisibles. Esos llevan un color que no pertenece a ningun tema.
comprobar(
  "los bloques oscuros tienen su propio color",
  /--color-carbon: oklch\(20\.5% 0 0\);/.test(estilos),
  "carbón en los dos temas"
);
comprobar(
  "y no queda ningún relleno gris oscuro suelto",
  !/[^-]bg-neutral-(700|800|900|950)\b/.test(editor),
  "ninguno se vuelve blanco"
);
// EL SUELO DE TODO EL BOT SALE DEL TEMA. Iba con un gris fijo en el `<body>`,
// asi que el chat y el tablero se quedaban claros con el tema en oscuro.
comprobar(
  "el suelo de la aplicación es del tema",
  /<body className="min-h-screen bg-fondo text-tinta antialiased">/.test(raiz),
  "el chat y el tablero también"
);
// `bg-white` ES UN BLANCO FIJO: no entiende de temas. Se cambio por
// `bg-tarjeta`, que en claro vale #ffffff —o sea, lo mismo— y en oscuro se
// oscurece con el resto.
comprobar(
  "no quedan tarjetas blancas fijas",
  !/bg-white(?![/\w-])/.test(editor),
  "bg-tarjeta en su lugar"
);

// -- 8. EL CUADRADO DEL ICONO, EN CLARO, NO TAPA EL EMOJI --------------------
//
// Iba relleno de violeta en los dos temas, y dentro lleva un EMOJI. Un emoji no
// obedece a `text-white`: es un dibujo a todo color, y los hay oscuros. Emoji
// oscuro sobre bloque oscuro es un cuadrado morado con una mancha dentro.
//
// Sobre fondo oscuro el bloque se apoya en la oscuridad y el emoji se lee, asi
// que ahi se queda relleno. Solo cambia el claro.
comprobar(
  "en claro el cuadrado se tiñe, no se rellena",
  /violeta: \{\s*\r?\n\s*ficha:\s*\r?\n?\s*"bg-acento-suave text-acento ring-1 ring-inset ring-acento\/25 oscuro:bg-acento oscuro:text-white oscuro:ring-0"/.test(
    editor
  ),
  "el emoji se ve"
);

console.log(fallos === 0 ? "\nTODO OK" : `\n${fallos} FALLO(S)`);
process.exit(fallos === 0 ? 0 : 1);
