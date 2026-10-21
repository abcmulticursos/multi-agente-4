// Las secciones de un canal se abren en VENTANA, una a la vez.
//
// COMO ESTABA
//
//   Cajones desplegables uno debajo de otro: Saludo inicial, Intro,
//   Seguimientos, Entregas por modalidad, Postventa extra.
//
//   Cada uno trae dentro un editor entero — la intro con sus cajones, los
//   seguimientos con sus variantes, las entregas por modalidad. Abrir dos
//   dejaba la pagina kilometrica, y con dos editores parecidos a la vista es
//   facil escribir en el que no era.
//
// COMO QUEDA
//
//   Una fila de tarjetas. Cada una abre su seccion en una ventana, con lo mismo
//   que tenia dentro. Se cierra y se abre otra.
//
// EL SALUDO INICIAL DESAPARECE
//
//   Era el PRIMER cajon de esa misma intro, dibujado en su propia seccion. Dos
//   sitios para una sola lista: habia que acordarse de que el primero vivia en
//   otro sitio, y al mover cajones el reparto dejaba de tener sentido. Ahora la
//   intro se ve entera, desde el primer cajon.
//
//   node scripts/prueba-canales-en-ventana.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const editor = readFileSync(join(RAIZ, "src", "app", "editor", "page.tsx"), "utf8");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

const canal = (() => {
  const i = editor.indexOf("function ChannelWorkspace({");
  const f = editor.indexOf("const SECCIONES_DEL_CANAL", i);
  return i < 0 || f < 0 ? "" : editor.slice(i, f);
})();
comprobar("se encuentra el canal", canal.length > 0, "ChannelWorkspace");

// -- 1. UNA SECCION A LA VEZ, EN VENTANA -------------------------------------
comprobar(
  "hay una sola seccion abierta a la vez",
  /const \[seccionAbierta, setSeccionAbierta\] = useState</.test(canal),
  "una, no varias"
);
for (const [clave, titulo] of [
  ["intro", "Intro"],
  ["seguimientos", "Seguimientos"],
  ["entregas", "Entregas por modalidad"],
  ["postventa", "Postventa extra"],
  ["comentarios", "Comentarios de Facebook"],
]) {
  comprobar(
    `«${titulo}» se abre en ventana`,
    new RegExp(
      `seccionAbierta === "${clave}"[\\s\\S]{0,220}?<VentanaDeProducto[\\s\\S]{0,220}?titulo=\\{\`${titulo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`
    ).test(canal),
    "no desplegable"
  );
}
// Los cajones desplegables de estas cinco secciones tienen que haberse ido: si
// queda alguno, hay dos formas de llegar a lo mismo y una de las dos se olvida.
for (const llave of [
  "_saludo",
  "_intro`",
  "_followups",
  "_delivery`",
  "_post_sale",
  "_comment_automation",
]) {
  comprobar(
    `ya no queda el cajon ${llave}`,
    !new RegExp(`titleKey=\\{\`channel_\\$\\{channel\\}${llave.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(canal),
    "solo la ventana"
  );
}

// -- 2. EL SALUDO INICIAL SE FUE, Y LA INTRO SE VE ENTERA --------------------
// Se mira DENTRO del canal. El «Saludo inicial» de la pestaña Intro es otro
// sitio y se queda donde esta: aqui solo se retira el del canal, que era una
// copia del primer cajon de su propia intro.
comprobar(
  "no queda la seccion del saludo EN EL CANAL",
  !/title="Saludo inicial"/.test(canal),
  "se fue"
);
// Lo importante: la intro ya NO empieza en el segundo cajon. Si se quedara el
// salto, el primer cajon dejaria de verse y no habria donde editarlo.
comprobar(
  "la intro empieza en el primer cajon",
  !/desdeIndice=\{1\}/.test(canal) && !/soloIndice=\{0\}/.test(canal),
  "sin saltarse ninguno"
);
comprobar(
  "y el visor los enseña todos",
  /\(introGroups \?\? \[\]\)\.map\(/.test(canal) &&
    !/\(introGroups \?\? \[\]\)\.slice\(/.test(canal),
  "sin recortar la lista"
);

// -- 3. LAS BARRAS QUE ABREN --------------------------------------------------
comprobar(
  "hay una barra por seccion",
  /SECCIONES_DEL_CANAL\.filter\(/.test(canal) &&
    /onAbrir=\{\(\) => setSeccionAbierta\(clave\)\}/.test(canal),
  "se abren tocando"
);
// BARRAS APILADAS, UNA POR SECCION. Lo que importa es la FORMA: una fila por
// seccion, con su nombre, su frase y su chapa de abrir. Eso no ha cambiado.
//
// Lo que si cambio es la ropa, en la prueba del tema claro: blanco con esquina
// generosa, el cuadradito de color del canal en vez de la flecha, y al pasar
// por encima se levanta en vez de oscurecerse. La flecha se fue porque ya no
// despliega nada hacia abajo: abre una ventana.
comprobar(
  "y son barras, una sobre otra",
  /<div className="space-y-3">\s*\r?\n\s*\{SECCIONES_DEL_CANAL/.test(canal) &&
    /<FilaDeSeccion/.test(canal),
  "no tarjetas sueltas"
);
// La fila es de la casa: cuadrado de color, nombre, frase y chapa. Escrita una
// vez, no copiada aqui: dos filas escritas por separado acaban pareciendose
// cada vez menos.
comprobar(
  "cada una con su icono y su chapa de abrir",
  /tono=\{meta\.tono\}/.test(canal) &&
    /icono=\{icono\}/.test(canal) &&
    /chapa = "Abrir"/.test(editor),
  "se reconoce"
);
// La de comentarios es de Facebook: los comentarios son de la pagina, no de
// WhatsApp ni de Instagram. Sin este filtro saldria una tarjeta que no lleva
// a ningun sitio.
comprobar(
  "la de comentarios solo sale en Facebook",
  /if \(clave === "comentarios"\) \{\s*\r?\n?\s*return channel === "messenger" && Boolean\(onCfgChange\);/.test(
    canal
  ),
  "y en ningun otro"
);
// Y LA DE LA OFERTA, SOLO DONDE HAY DOS OPCIONES. En Lineal a secas no las hay:
// esa fila mandaria a escribir algo que no sale por ningun lado.
//
// Desde el 22/09/2026 lineal puede vender dos opciones con la presentacion
// prestada sin dejar de llamarse lineal, asi que se pregunta por el DATO y no
// por el nombre. Lo que se comprueba es lo mismo de siempre.
comprobar(
  "la de la oferta solo sale donde hay dos opciones",
  /if \(clave === "orderbump"\) \{[\s\S]{0,120}?activeModality\(cfg\) === "order_bump" \|\|[\s\S]{0,120}?segundaOpcionPrestada\(cfg\) === "segunda_oculta"/.test(
    canal
  ),
  "en Lineal a secas no sale"
);

console.log(fallos === 0 ? "\nTODO OK" : `\n${fallos} FALLO(S)`);
process.exit(fallos === 0 ? 0 : 1);
