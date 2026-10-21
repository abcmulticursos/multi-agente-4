// LAS TIENDAS: SU COLOR, SU VENTANA, Y EL SELECTOR QUE SE CIERRA
//
// LO PIDIO EL DUEÑO el 05/10/2026, en un solo mensaje y con cuatro cosas dentro. Van juntas
// porque las cuatro viven en la misma pantalla —menu Ajustes, seccion Tiendas— y una prueba
// por cada una seria cuatro archivos leyendo el mismo sitio.
//
//  1. EL COLOR. «en las fachadas yo puedo elegir la tienda, pero todas tienen color
//     turquesa, pero si yo les pongo un color en la seccion tiendas, ese color deberia
//     aparecer en la fachada y ya no el verde o turquesa que se ve ahi».
//
//  2. LA VENTANA. «cada tienda deberia ser desplegable, en este momento la tienda queda
//     ordenada, una tienda arriba, otra debajo, otra debajo pero me confundo al tener una
//     sobre otra, si pudieras hacerla con un pop up con su guardar/cerrar/ etc asi con las
//     reglas de las otras pestañas seria genial».
//
//  3. EL SELECTOR QUE NO SE CERRABA. «al yo clickear fuera del menu desplegable de paginas
//     numeros y pixeles deberia cerrarse ese desplegable pero solo se cierra al presionar
//     escape o elegir una pagina, o un numero o un pixel».
//
//     Y LO HABIA PEDIDO YA el 02/10 junto con Escape —«con tan solo yo presionar click fuera
//     del selector se repliegue O TAMBIEN al presionar escape»— y entonces se hizo solo la
//     mitad. Esta prueba existe para que no se vuelva a quedar a medias.
//
//  4. LA FOTO DE LOS NUMEROS. No se programa nada: se midio y la tuberia esta completa —se
//     pide a Meta en `fetchWhatsAppOptions`, se guarda en `profile_picture_url` y se sirve
//     en el endpoint de conexiones—. Si no sale foto es porque Meta no la devolvio. Se
//     comprueba que esa tuberia siga entera, que es lo unico que depende del proyecto.
//
// EL COLOR VACIO ES EL CASO QUE MAS SE VIGILA: una tienda sin pintar tiene que verse
// EXACTAMENTE como hasta hoy. Si esto cambiara el aspecto de lo que el no ha tocado, seria
// justo lo que tiene prohibido este proyecto.
//
//   node scripts/prueba-las-tiendas-con-su-color-y-su-ventana.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");
const editor = leer("src", "app", "editor", "page.tsx");
const ruta = leer("src", "app", "api", "workflow", "route.ts");
const motor = leer("src", "lib", "workflow", "config.ts");
// La lista que sirve `/api/editor/conexiones` se arma desde el 09/10/2026 en
// `lo-conectado.ts`, porque las tarjetas de Meta Connect leen la misma.
const conexiones = leer("src", "lib", "meta", "lo-conectado.ts");
const meta = leer("src", "lib", "meta", "connect.ts");

let fallos = 0;
const comprobar = (titulo, condicion, detalle) => {
  const marca = condicion ? "  ok  " : "> FALLA";
  if (!condicion) fallos++;
  console.log(`${marca} ${String(titulo).padEnd(58)} ${detalle ?? ""}`);
};

// -- 1. EL COLOR LLEGA Y VUELVE ---------------------------------------------
//
// El carril de guardado de este proyecto reconstruye campo por campo, y su propio comentario
// lo avisa: «lo que no se nombre no llega al bot». Un color que se pinta y no se guarda es
// peor que no tenerlo: parece que funciona hasta recargar.
comprobar(
  "el color se guarda en el YAML",
  /\.\.\.\(\/\^#\[0-9a-fA-F\]\{6\}\$\/\.test\(str\(t\?\.color\)\.trim\(\)\)/.test(ruta),
  "leeTiendas, el unico carril"
);
comprobar(
  "y solo si es un color de verdad",
  /\{ color: str\(t\.color\)\.trim\(\)\.toLowerCase\(\) \}/.test(ruta),
  "cualquier otra cosa se descarta"
);
comprobar(
  "el motor lo transporta",
  /color\?: string;/.test(motor) && /NUNCA VIAJA AL CLIENTE/.test(motor),
  "sin leerlo: es de la pantalla"
);
comprobar(
  "y el editor lo pasa a las fachadas",
  /color: String\(t\?\.color \?\? ""\)\.trim\(\)/.test(editor),
  "por el contexto de tiendas"
);

// -- 2. LA FACHADA SE PINTA, Y SIN COLOR NO CAMBIA NADA ---------------------
comprobar(
  "la pastilla usa el color de su tienda",
  /backgroundColor: suColor,\s*\r?\n\s*borderColor: suColor,/.test(editor),
  "en vez del turquesa fijo"
);
comprobar(
  "la tinta se calcula para que se lea",
  /color: adTagTextColor\(suColor\)/.test(editor),
  "blanco sobre oscuro, negro sobre claro"
);
// EL CASO QUE PROTEGE LO QUE YA FUNCIONABA.
comprobar(
  "sin color puesto, el turquesa de siempre",
  /pintada\s*\r?\n\s*\?\s*""\s*\r?\n\s*: puestas\.length > 0\s*\r?\n\s*\? "border-teal-500 bg-teal-200 text-teal-950"/.test(
    editor
  ),
  "una tienda sin pintar no cambia"
);
comprobar(
  "solo se pinta con UNA tienda marcada",
  /const suColor =\s*\r?\n\s*vivas\.length === 1 && huerfanas === 0/.test(editor),
  "con varias no hay un color que valga"
);
comprobar(
  "y se puede quitar el color",
  /Quitarle el color y volver al turquesa/.test(editor),
  "el selector siempre deja uno puesto"
);
comprobar(
  "el selector de color es el de la casa",
  /<AdColorSelect\s*\r?\n\s*value=\{tienda\.color \|\| ""\}/.test(editor),
  "misma paleta que las etiquetas"
);

// -- 3. CADA TIENDA EN SU VENTANA ------------------------------------------
comprobar(
  "la tienda se abre en la ventana de la casa",
  /<VentanaDeProducto\s*\r?\n\s*titulo=\{`🏪 \$\{comoSeLlama\}`\}/.test(editor),
  "con su Cancelar y su Guardar"
);
comprobar(
  "se recuerda por id, no por posicion",
  /const \[tiendaAbierta, setTiendaAbierta\] = useState<string \| null>\(null\)/.test(
    editor
  ),
  "borrar una no abre la de al lado"
);
comprobar(
  "cerrada no se monta su cuerpo",
  /if \(tiendaAbierta !== tienda\.id\) \{\s*\r?\n\s*return <div key=\{tienda\.id\}>\{filaCerrada\}<\/div>;/.test(
    editor
  ),
  "con ocho tiendas eso era la pantalla entera"
);
// LO QUE SE VE SIN ABRIR. Si un aviso solo saliera dentro, habria que abrir las ocho para
// saber cual esta mal — y entonces la ventana habria empeorado la pantalla.
for (const [que, texto] of [
  ["el numero repetido", "número repetido"],
  ["la falta de seguimientos", "sin seguimientos"],
  ["y que no tiene numero", "Sin número — preparada"],
]) {
  comprobar(`${que} se ve sin abrir`, editor.includes(texto), "en la fila");
}
comprobar(
  "el interruptor se queda fuera",
  /queEs=\{`la tienda \$\{comoSeLlama\}`\}/.test(editor),
  "apagar no obliga a abrir"
);

// -- 4. EL SELECTOR SE CIERRA AL PULSAR FUERA ------------------------------
comprobar(
  "el selector de conexiones se cierra al pulsar fuera",
  /const cajaDelSelector = useRef<HTMLSpanElement>\(null\)/.test(editor) &&
    /if \(caja && !caja\.contains\(e\.target as Node\)\) setAbierto\(false\)/.test(
      editor
    ),
  "lo pidio dos veces"
);
comprobar(
  "y el clic NO se para",
  /document\.addEventListener\("mousedown", alPulsarFuera\)/.test(editor) &&
    !/alPulsarFuera[\s\S]{0,200}stopPropagation/.test(editor),
  "si no, habria que pulsar dos veces en todo"
);
comprobar(
  "Escape sigue cerrando solo el selector",
  /window\.addEventListener\("keydown", alPulsar, true\)/.test(editor),
  "en captura, para no cerrar la ventana"
);
// LA TERCERA VEZ, el 10/10/2026: «solo se repliega cuando aprieto escape». El cierre por
// clic de arriba estaba bien escrito y no actuaba: una capa invisible a pantalla completa
// se comia todos los clics, y el <label> que envolvia el selector reenviaba el clic al
// boton y lo volvia a abrir. Se quito la capa y los tres selectores van en un <div>.
{
  const ini = editor.indexOf("function ElegirConexion(");
  const fin = editor.indexOf("function revisarTienda(", ini);
  const selector = ini >= 0 && fin > ini ? editor.slice(ini, fin) : "";
  comprobar(
    "el selector NO tiene la capa invisible",
    selector.length > 0 && !/className="fixed inset-0 z-40"/.test(selector),
    "se comia el clic y lo volvia a abrir"
  );
}
comprobar(
  "y los tres selectores no van dentro de un <label>",
  ["Número de WhatsApp", "Página de Facebook", "Pixel \\(conjunto de datos\\)"].every((t) =>
    new RegExp(`<div className="block text-xs font-medium text-tinta-suave">\\s*${t}`).test(editor)
  ),
  "un <label> reenvia el clic al boton"
);

// -- 5. LA FOTO DE LOS NUMEROS: LA TUBERIA ENTERA --------------------------
//
// No se programo nada aqui. Se vigila que los tres escalones sigan en pie, porque si algun
// dia se cae uno, la pantalla se queda sin fotos y parece cosa de Meta.
comprobar(
  "se le pide la foto a Meta",
  /fields: "profile_picture_url"/.test(meta),
  "whatsapp_business_profile"
);
comprobar(
  "y se guarda al conectar",
  /profilePictureUrl:\s*\r?\n\s*profile\?\.profile_picture_url/.test(meta),
  "en la conexion del numero"
);
// Desde el 10/10/2026 el editor no sirve el enlace GUARDADO —Meta lo hace caducar y las
// fotos dejaban de salir— sino la ruta que la pide fresca. Sigue sin devolver ningun
// secreto: la ruta devuelve la imagen, nunca el permiso.
comprobar(
  "el editor la sirve",
  /foto: `\/api\/meta\/avatar\?wa=\$\{encodeURIComponent\(c\.phone_number_id\)\}`/.test(conexiones),
  "sin devolver ningun secreto"
);

console.log("");
if (fallos > 0) {
  console.log(`> ${fallos} FALLA(S)`);
  process.exit(1);
}
console.log("TODO OK — las tiendas con su color, su ventana, y el selector que se cierra");
