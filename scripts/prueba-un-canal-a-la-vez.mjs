// En Canales se edita UN canal a la vez.
//
// COMO ESTABA
//
//   Los cuatro canales pintados uno debajo de otro, y las tarjetas de arriba
//   solo desplazaban la pantalla hasta el suyo.
//
//   Cada canal trae su intro, sus seguimientos, su entrega y sus anuncios, asi
//   que la pagina eran CUATRO editores completos encadenados. Para llegar a
//   TikTok habia que pasar por delante de todo lo demas, y con cuatro fichas
//   iguales a la vista es facil escribir en el canal de al lado sin darse
//   cuenta — que es el error caro, porque no da ningun aviso.
//
// COMO QUEDA
//
//   La tarjeta ELIGE. Solo se dibuja el canal abierto y la tarjeta dice cual
//   es. WhatsApp por defecto, que es el que vende.
//
// LO QUE HABIA QUE NO ROMPER
//
//   El visor del recorrido salta al editor de un canal concreto. Si el estado
//   viviera dentro de la pestaña, ese salto aterrizaria en una ficha que no
//   esta dibujada: no da error, simplemente no se mueve nada y parece que el
//   boton esta roto. Por eso el canal abierto vive FUERA, donde el salto puede
//   abrirlo antes de buscar el sitio.
//
//   node scripts/prueba-un-canal-a-la-vez.mjs
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

// -- 1. SOLO SE DIBUJA EL ABIERTO --------------------------------------------
for (const canal of ["whatsapp", "messenger", "instagram", "tiktok"]) {
  comprobar(
    `«${canal}» solo se dibuja si esta abierto`,
    new RegExp(
      `\\{canalAbierto === "${canal}" && \\(\\s*\\r?\\n\\s*<ChannelWorkspace\\s*\\r?\\n\\s*channel="${canal}"`
    ).test(editor),
    "oculto si no"
  );
}
// El pais de Messenger e Instagram es UNA sola configuracion que gobierna a los
// dos, asi que sale con cualquiera de ellos y con ninguno mas. Suelta entre las
// dos fichas no se sabia a cual pertenecia.
comprobar(
  "el pais sale con Messenger y con Instagram",
  /\{\(canalAbierto === "messenger" \|\| canalAbierto === "instagram"\) && \(/.test(
    editor
  ),
  "y con ninguno mas"
);

// -- 2. LA TARJETA ELIGE, Y SE VE CUAL --------------------------------------
const tarjeta = (() => {
  const i = editor.indexOf("function ChannelSummaryCard(");
  const f = editor.indexOf("function ChannelWorkspace(", i);
  return i < 0 || f < 0 ? "" : editor.slice(i, f);
})();
comprobar("se encuentra la tarjeta", tarjeta.length > 0, "ChannelSummaryCard");
comprobar(
  "ya no desplaza, abre",
  /onClick=\{onAbrir\}/.test(tarjeta) && !/scrollIntoView/.test(tarjeta),
  "elige el canal"
);
// Sin esto, tocar una tarjeta y ver cambiar la pantalla entera deja la duda de
// en cual se esta escribiendo, que es justo el error que esto venia a evitar.
comprobar(
  "y dice cual esta abierta",
  /aria-pressed=\{abierto\}/.test(tarjeta) &&
    /shadow-md ring-2 \$\{tono\.anillo\}/.test(tarjeta),
  "resaltada"
);
// EL QUE NO ESTA ABIERTO NO SE APAGA, SE QUEDA EN REPOSO.
//
// Antes los otros tres iban al 60% de opacidad, y el nombre y la frase de abajo
// se volvian ilegibles justo cuando hacen falta: para decidir a cual ir. El
// abierto se marca poniendolo EN PIE —anillo de su color y sombra mas alta—, no
// hundiendo a los demas.
comprobar(
  "y las demas se leen igual de bien",
  !/opacity-60/.test(tarjeta) && /border-borde shadow-sm/.test(tarjeta),
  "se distinguen sin apagarse"
);

// -- 3. EL SALTO DESDE EL RECORRIDO SIGUE FUNCIONANDO ------------------------
comprobar(
  "el canal abierto vive fuera de la pestaña",
  /const \[canalAbierto, setCanalAbierto\] = useState<ChannelKey>\("whatsapp"\);/.test(
    editor
  ) && /canalAbierto=\{canalAbierto\}/.test(editor),
  "se le pasa por props"
);
comprobar(
  "saltar a un canal lo abre antes de buscarlo",
  /const canalDestino = \/\^canal-\(\.\+\)\$\/\.exec\(target\.id\)\?\.\[1\];/.test(
    editor
  ) && /setCanalAbierto\(canalDestino as ChannelKey\)/.test(editor),
  "no aterriza en el vacio"
);
// Se comprueba contra la lista real de canales: un id raro no puede dejar la
// pestaña con un canal que no existe y las cuatro fichas ocultas.
comprobar(
  "y solo si es un canal de verdad",
  /\(CHANNEL_KEYS as readonly string\[\]\)\.includes\(canalDestino\)/.test(editor),
  "nunca se queda en blanco"
);

console.log(fallos === 0 ? "\nTODO OK" : `\n${fallos} FALLO(S)`);
process.exit(fallos === 0 ? 0 : 1);
