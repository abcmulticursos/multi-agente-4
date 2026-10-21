// El contenido del producto se comprueba en una HOJA, no en un chat.
//
// EL FALLO DE APARIENCIA
//
//   Al lado del campo «Contenido del curso» habia el visor de WhatsApp, con su
//   burbuja y su hora. Pero ese texto NO es un mensaje: el bot no lo manda
//   nunca tal cual. Es material que LEE para contestar cuando le preguntan que
//   incluye el producto.
//
//   Ensenarlo como una burbuja hacia creer tres cosas falsas a la vez: que al
//   cliente le llega eso, que le llega con ese formato, y que le llega de una
//   sola vez. Ninguna es verdad.
//
// COMO QUEDA
//
//   Dos tarjetas. A la izquierda donde se escribe, con el titulo CONTENIDO en
//   grande. A la derecha una hoja limpia con el texto ya resuelto y cada valor
//   de comodin resaltado, que es lo unico que de verdad hace falta comprobar.
//
//   No se parece al chat ni al visor del correo: ese lleva remitente,
//   destinatario y asunto porque un correo los tiene. Aqui no hay ninguno de
//   los tres.
//
// UNA SOLA VERDAD
//
//   El visor nuevo resuelve con `renderPreviewTextWithHighlights`, el mismo que
//   usa el visor de burbujas. Una segunda forma de resolver comodines seria
//   tener dos verdades: la hoja diria una cosa y el bot haria otra, que es peor
//   que no tener visor.
//
//   node scripts/prueba-el-contenido-no-es-un-chat.mjs
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

// -- 1. EL VISOR NUEVO EXISTE ------------------------------------------------
// EL CORTE TERMINA EN LA SIGUIENTE FUNCION DE PRIMER NIVEL, no en
// `ContenidoProducto`. Entre las dos hay ahora mil lineas de otras cosas —la
// biblioteca de productos, la alineacion— y cualquiera de ellas podia hacer
// saltar esta prueba por nombrar «WhatsApp» en un comentario. Una prueba que
// falla por algo que no vigila es una prueba que se acaba desactivando.
const visor = (() => {
  const i = editor.indexOf("function VisorDeComodines(");
  if (i < 0) return "";
  const f = editor.indexOf("\nfunction ", i + 1);
  return f < 0 ? editor.slice(i) : editor.slice(i, f);
})();
comprobar("se encuentra el visor", visor.length > 0, "VisorDeComodines");
comprobar(
  "resuelve con el molino de la casa",
  /renderPreviewTextWithHighlights\(/.test(visor),
  "una sola verdad"
);
comprobar(
  "y lee el contexto del editor",
  /useContext\(EditorPreviewContext\)/.test(visor),
  "mismos precios y nombres"
);
comprobar(
  "dice cuantos comodines hay",
  /texto\.match\(PATRON_DE_COMODIN\)/.test(visor),
  "se ve sin contarlos a mano"
);
comprobar(
  "y avisa de que esto no se envia",
  /El bot no lo envía tal cual/.test(visor),
  "sin que haya que deducirlo"
);

// -- 2. NO SE PARECE A UN CHAT -----------------------------------------------
//
// Lo que hace de chat al visor de WhatsApp: la burbuja verde, la hora y la
// cabecera del telefono. Nada de eso puede estar aqui.
comprobar(
  "el contenido ya NO usa el visor de WhatsApp",
  !/<ChatPreview[\s\S]{0,400}?texts: \[content\]/.test(editor),
  "se fue la burbuja"
);
// NI EL DEL TERCER PRODUCTO.
//
// El cajon del upsell tiene su PROPIA copia del bloque, no usa el componente
// de los otros dos, asi que se quedo con el visor de WhatsApp cuando ellos
// cambiaron. Tres sitios que hacen lo mismo y uno con otra cara: quien mira el
// de arriba y luego este cree que hacen cosas distintas.
comprobar(
  "el contenido del upsell tampoco",
  !/<ChatPreview[\s\S]{0,400}?cfg\.upsell\?\.course_content/.test(editor) &&
    /<VisorDeComodines texto=\{cfg\.upsell\?\.course_content \?\? ""\} \/>/.test(
      editor
    ),
  "misma hoja que los otros dos"
);
comprobar(
  "los tres productos se ven igual",
  (editor.match(/<VisorDeComodines texto=/g) ?? []).length === 2,
  "uno compartido por los dos primeros, y el del upsell"
);
comprobar(
  "y el visor nuevo no imita uno",
  !/ChatPreview/.test(visor) &&
    !/emerald-100|bg-\[#e7ffdb\]|whatsapp/i.test(visor),
  "ni burbuja ni verde de chat"
);

// -- 3. NI AL VISOR DEL CORREO -----------------------------------------------
comprobar(
  "no finge remitente ni destinatario",
  !/De:|Para:|sin asunto/.test(visor),
  "aqui no hay correo"
);

// -- 4. LA CAJA DICE DE QUE ES ----------------------------------------------
const caja = (() => {
  const i = editor.indexOf("DOS TARJETAS: DONDE SE ESCRIBE Y DONDE SE COMPRUEBA");
  return i < 0 ? "" : editor.slice(i, i + 2600);
})();
comprobar("se encuentra la caja", caja.length > 0, "la del contenido");
comprobar(
  "CONTENIDO va en grande",
  /<h4 className="text-lg font-black uppercase tracking-tight text-neutral-900">\s*\r?\n\s*Contenido\s*\r?\n\s*<\/h4>/.test(
    caja
  ),
  "se reconoce de un vistazo"
);
comprobar(
  "y el resto del titulo, en pequeno al lado",
  /del curso y cómo se estudia/.test(caja),
  "sin perder lo que decia"
);
comprobar(
  "el visor va a la DERECHA de donde se escribe",
  caja.indexOf("EditorEmojiTextarea") < caja.indexOf("<VisorDeComodines"),
  "izquierda escribe, derecha comprueba"
);
comprobar(
  "y se queda a la vista al bajar",
  /lg:sticky lg:top-32 lg:self-start[\s\S]{0,120}?<VisorDeComodines/.test(caja),
  "no hay que subir a mirarlo"
);

console.log(fallos === 0 ? "\nTODO OK" : `\n${fallos} FALLO(S)`);
process.exit(fallos === 0 ? 0 : 1);
