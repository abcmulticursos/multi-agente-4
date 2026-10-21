// La cascara de la interfaz nueva: menu lateral en vez de 14 pestanas.
//
// EL PROBLEMA
//
// Hoy hay 14 pestanas, todas al mismo nivel y todas detalle. Nada tiene
// jerarquia, asi que para encontrar una cosa hay que leerlas todas. Alberto lo
// dijo asi: "con solo verlo me emborracho".
//
// LA IDEA
//
// Agrupar por LO QUE ESTAS HACIENDO, no por lo que es el dato. Cinco lugares
// mas Conversaciones, Meta Connect y Modo prueba. Y las pestanas de modalidad
// —Order Bump, Doble Oferta…— dejan de ser lugares: nunca lo fueron, son "lo
// que vendes".
//
// LO QUE NO PUEDE ROMPERSE
//
// La vista CLASICA queda intacta. Es una segunda piel sobre las MISMAS
// pestanas: cambiar de vista no cambia ni un dato. Si algo de la nueva no
// convence, se vuelve con un boton y todo sigue como siempre.
//
//   node scripts/prueba-interfaz-nueva.mjs
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");
const editor = leer("src", "app", "editor", "page.tsx");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// ── 1. UN SOLO MENÚ, LEÍDO DESDE LOS DOS SITIOS ─────────────────────────────
//
// La barra izquierda tenia cinco grupos —«El recorrido», «Lo que vendes»…—
// inventados SOLO para ella, con su propio orden y sus propios nombres. Dos
// menus para lo mismo terminan discrepando, y este ya habia discrepado:
// «Usuario» no pertenecia a ninguno de los cinco, asi que con la barra
// encendida esa pestaña no aparecia en ninguna parte.
comprobar(
  "el menú está definido en un solo sitio",
  /const ORDEN_DE_TABS: Tab\[\] = \[/.test(editor) &&
    !/const LUGARES: \{/.test(editor),
  "ORDEN_DE_TABS"
);
comprobar(
  "y las dos vistas leen esa lista",
  /ORDEN_DE_TABS\.filter\(\(key\) => tabsVisibles\.has\(key\)\)/.test(editor) &&
    /ORDEN_DE_TABS\.filter\(\(t\) => tabsVisibles\.has\(t\)\)/.test(editor),
  "arriba y a la izquierda"
);
// Los dos que van DELANTE de las pestañas en el menu de arriba. Si faltaran, la
// barra dejaria de llevar «lo mismo que arriba», que es todo el punto.
comprobar(
  "«Chat» y «Mostrar bases» también están en la barra",
  /nombre="Chat"/.test(editor) &&
    /nombre=\{basesVisibles \? "Ocultar bases" : "Mostrar bases"\}/.test(editor),
  "los dos primeros"
);
comprobar(
  "las páginas a las que apunta existen",
  existsSync(join(RAIZ, "src", "app", "meta-connect")) &&
    existsSync(join(RAIZ, "src", "app", "simulador")),
  "sí"
);

// ── 2. La clásica queda intacta ─────────────────────────────────────────────
comprobar(
  "se puede volver a la vista clásica",
  /onClick=\{vistaClasica\}/.test(editor) &&
    /← Vista clásica/.test(editor) &&
    /vistaClasica=\{\(\) => cambiarVista\(false\)\}/.test(editor),
  "un botón"
);
// LA ENTRADA ESTÁ RETIRADA, A PETICIÓN DEL OPERADOR.
//
// Antes esto exigía que hubiera un botón «✨ Interfaz nueva» en la barra. Se
// quitó a propósito, así que exigirlo haría fallar la prueba por una decisión,
// no por un fallo. Lo que sigue vigilándose es lo que de verdad importa: que la
// vista siga ENTERA para poder devolverla, y que nadie se quede encerrado en
// ella por haberla dejado puesta antes de retirar el botón.
comprobar(
  "la entrada está retirada (decisión, no olvido)",
  !/✨ Interfaz nueva/.test(editor),
  "sin botón"
);
comprobar(
  "la vista elegida se recuerda en este navegador",
  /const EDITOR_VISTA_STORAGE_KEY = "wf:editor-vista";/.test(editor),
  "sí"
);
comprobar(
  // ANTES SE BORRABA EL RECUERDO EN CADA CARGA, y con razon: sin boton de
  // entrada, quien la tuviera puesta se quedaba sin pestañas arriba Y sin boton
  // para volver, encerrado en una vista a la que ya no se podia llegar.
  //
  // Con el boton devuelto no hay encierro posible: se entra donde se dejo y se
  // sale por «Vista clasica», abajo del todo de la barra.
  "nadie se queda encerrado en la nueva",
  !/localStorage\.removeItem\(EDITOR_VISTA_STORAGE_KEY\)/.test(editor) &&
    /☰ Menú lateral/.test(editor) &&
    /← Vista clásica/.test(editor),
  "se entra y se sale"
);
comprobar(
  "no se ven las dos navegaciones a la vez",
  /vistaNueva \? "hidden" : "flex"/.test(editor),
  "una u otra"
);

// ── 3. Un solo criterio para las dos vistas ─────────────────────────────────
comprobar(
  "qué pestañas se ven se decide en un solo sitio",
  /const tabsVisibles = useMemo\(\(\) => \{/.test(editor),
  "tabsVisibles"
);
comprobar(
  // Con una copia por vista, una acabaría mostrando una pestaña que la otra
  // esconde y no habría forma de saber cuál tiene razón.
  "la vista clásica usa ese mismo criterio",
  /ORDEN_DE_TABS\.filter\(\(key\) => tabsVisibles\.has\(key\)\)/.test(editor),
  "sin copias"
);
comprobar(
  "y la nueva también",
  /tabsVisibles=\{tabsVisibles\}/.test(editor),
  "el mismo"
);
comprobar(
  "los nombres de las pestañas también son únicos",
  /const ETIQUETAS_DE_TAB: Record<Tab, string>/.test(editor),
  "un solo sitio"
);
comprobar(
  "sigue respetando «Ocultar bases»",
  // Desde el 10/10/2026 el filtro mira `basesALaVista` = bases encendidas Y no estar en el
  // modo esencial. «Ocultar bases» sigue mandando igual que antes en el profesional.
  /const basesALaVista = showBaseTabs && !modoEsencial;/.test(editor) &&
  /!basesALaVista &&\s*\r?\n\s*\(key === "intro" \|\| key === "seguimientos" \|\| key === "salesbot"\)/.test(
    editor
  ),
  "igual que antes"
);
comprobar(
  "y que solo se vea la modalidad que se edita",
  /if \(key === "orderbump"\) return activeModality\(cfg\) === "order_bump";/.test(
    editor
  ),
  "igual que antes"
);

// ── 4. Que el menú sirva de verdad ──────────────────────────────────────────
comprobar(
  // Un menú que se va con el scroll no sirve: en una intro de catorce burbujas
  // se pierde arriba y hay que volver para arriba cada vez.
  "el menú queda fijo, no se va con el scroll",
  /className="fixed inset-y-0 left-0 z-30 w-\[116px\]/.test(editor),
  "fijo"
);
// NINGUNA PESTAÑA SE QUEDA FUERA DEL MENU.
//
// Cuando la barra tenia su propia agrupacion, «Usuario» no pertenecia a ninguno
// de sus cinco grupos: la pestaña existia, salia en la vista clasica, y con la
// barra encendida no aparecia en ninguna parte. No daba error; simplemente no
// estaba.
//
// Ahora las dos leen la misma lista, asi que lo que se vigila es que esa lista
// tenga TODAS las pestañas: lo que no este en ella es inalcanzable desde las dos.
{
  const listaDeTabs = (() => {
    const i = editor.indexOf("const todas: Tab[] = [");
    const f = editor.indexOf("];", i);
    return i < 0 || f < 0 ? "" : editor.slice(i, f);
  })();
  const todas = [...listaDeTabs.matchAll(/"([a-z0-9]+)"/g)].map((m) => m[1]);
  const enElMenu = (() => {
    const i = editor.indexOf("const ORDEN_DE_TABS: Tab[] = [");
    const f = editor.indexOf("];", i);
    const trozo = i < 0 || f < 0 ? "" : editor.slice(i, f);
    return [...trozo.matchAll(/"([a-z0-9]+)"/g)].map((m) => m[1]);
  })();
  const huerfanas = todas.filter((t) => !enElMenu.includes(t));
  comprobar("se encuentran las pestañas", todas.length > 5, `${todas.length}`);
  comprobar(
    "todas las pestañas están en el menú",
    huerfanas.length === 0,
    huerfanas.length === 0 ? "ninguna suelta" : `fuera: ${huerfanas.join(", ")}`
  );
  // Y cada una con su dibujo para la barra: sin el, la ficha sale con un hueco.
  const conIcono = (() => {
    const i = editor.indexOf("const ICONO_DE_TAB: Record<Tab, string> = {");
    const f = editor.indexOf("};", i);
    const trozo = i < 0 || f < 0 ? "" : editor.slice(i, f);
    return [...trozo.matchAll(/^\s*([a-z0-9]+):/gm)].map((m) => m[1]);
  })();
  const sinIcono = enElMenu.filter((t) => !conIcono.includes(t));
  comprobar(
    "y cada una con su dibujo en la barra",
    sinIcono.length === 0,
    sinIcono.length === 0 ? "todas" : `sin dibujo: ${sinIcono.join(", ")}`
  );
}

// SE PUEDE ENTRAR Y SALIR CON EL MISMO BOTON.
//
// Primero no habia entrada: el unico control era el de SALIR, dentro de la
// propia barra, una puerta que solo abre desde dentro. Devuelto el boton, solo
// encendia: con la barra puesta, volver a tocarlo no hacia nada y parecia roto.
comprobar(
  "el botón del menú lateral enciende y apaga",
  /onClick=\{\(\) => cambiarVista\(!vistaNueva\)\}/.test(editor) &&
    /☰ Menú lateral/.test(editor),
  "no solo para salir"
);
comprobar(
  "y otro para volver a las pestañas",
  /onClick=\{vistaClasica\}/.test(editor) && /← Vista clásica/.test(editor),
  "se entra y se sale"
);
// Y LA VISTA SE RECUERDA. Se borraba el recuerdo en cada carga, a proposito:
// sin boton de entrada, quien la hubiera dejado puesta se quedaba encerrado.
// Con el boton puesto ya no hay encierro posible.
comprobar(
  "la vista elegida se recuerda",
  /setVistaNueva\(localStorage\.getItem\(EDITOR_VISTA_STORAGE_KEY\) === "nueva"\);/.test(
    editor
  ),
  "se entra donde se dejó"
);
// EL HUECO DE LA BARRA LO HACE LA PAGINA, NO UN MARGEN EN EL CONTENIDO.
//
// Con `ml-[112px]` en el contenido, ese margen izquierdo ANULA el centrado
// automatico: la pagina se clavaba pegada a la barra y dejaba un vacio enorme a
// la derecha. Con el relleno en la pagina, `mx-auto` vuelve a tener las dos
// mitades y centra dentro de lo que queda libre.
comprobar(
  "y el contenido se centra en lo que queda",
  /vistaNueva \? "pl-\[116px\]" : ""/.test(editor) &&
    /<main className="mx-auto max-w-\[922px\] px-4 pb-56 pt-6">/.test(editor),
  "sí"
);
// AQUI SE VIGILABAN LOS CINCO GRUPOS: que cada uno dijera lo que guarda, que
// una fila de una sola pestaña no se dibujara, y que al abrir un grupo se
// entrara a su primera pestaña.
//
// Ya no hay grupos. Cada ficha de la barra ES una pestaña, asi que tocarla lleva
// a esa pestaña y no hay «primera» que elegir ni fila de dentro que esconder.
comprobar(
  "tocar una ficha lleva a su pestaña, sin intermedios",
  /onAbrir=\{\(\) => onTab\(t\)\}/.test(editor) &&
    /activo=\{tab === t\}/.test(editor),
  "sin grupos"
);
// La cabecera dice en cual estas. Con grupos decia el nombre del grupo, que era
// una cosa mas que traducir mentalmente.
// LA CABECERA DICE DE QUE VA, NO SOLO COMO SE LLAMA.
//
// Ponia «Estas en» y el nombre, que es exactamente lo que ya dice la ficha
// encendida de la barra de la izquierda. Ahora el rotulo dice a que parte de la
// venta pertenece la pestaña y debajo va la frase que explica que se hace ahi.
// La tabla con las quince esta en `CABECERA_DE_TAB`.
comprobar(
  "y la cabecera dice en cuál estás",
  /rotulo=\{CABECERA_DE_TAB\[tab\]\.rotulo\}\s*\r?\n\s*titulo=\{etiquetaDeTab\(tab\)\}/.test(
    editor
  ) && /subtitulo=\{CABECERA_DE_TAB\[tab\]\.subtitulo\}/.test(editor),
  "la pestaña, no el grupo"
);
// Y LAS QUINCE ESTAN, no solo las que alguien recordo. Si falta una, esa
// pestaña entra sin cabecera y no hay forma de notarlo hasta abrirla.
comprobar(
  "las quince pestañas tienen la suya",
  (() => {
    const i = editor.indexOf("const CABECERA_DE_TAB");
    const f = editor.indexOf("function Collapsible(", i);
    const tabla = i < 0 ? "" : editor.slice(i, f > 0 ? f : i + 6000);
    const orden = editor.slice(
      editor.indexOf("const ORDEN_DE_TABS"),
      editor.indexOf("const ICONO_DE_TAB")
    );
    const tabs = [...orden.matchAll(/"([a-z0-9]+)"/g)].map((m) => m[1]);
    return (
      tabs.length === 15 &&
      tabs.every((t) => new RegExp(`\\n  ${t}: \\{`).test(tabla))
    );
  })(),
  "ninguna entra sin rótulo"
);

console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} comprobación(es) mal.`);
process.exit(fallos === 0 ? 0 : 1);
