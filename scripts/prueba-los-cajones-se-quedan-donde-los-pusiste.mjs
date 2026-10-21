// Apagar un cajon no lo mueve, y el menu de la vista previa dice lo que hizo.
//
// TRES COSAS QUE PARECIAN TRES FALLOS Y ERAN DOS CAUSAS
//
// 1. AL APAGAR UN CAJON SE IBA AL FONDO
//
//    La lista se dibujaba con `activeFirst`, que ordenaba los apagados al
//    final. La idea era leerse mejor. El efecto: estabas trabajando en el
//    tercer cajon, lo apagabas, y desaparecia de donde estaba — desconcierta, y
//    encima parece que se hubiera borrado algo.
//
// 2. Y LAS FLECHAS DEJABAN DE FUNCIONAR
//
//    Mismo culpable, y este es el que costaba ver: la flecha movia BIEN el
//    cajon en la lista guardada, pero el orden de pantalla lo devolvia al
//    fondo. Pulsabas y «no pasaba nada». No estaban rotas: peleaban contra ese
//    orden.
//
//    El orden lo decide el operador con las flechas y el arrastre. Encender o
//    apagar no es reordenar.
//
// 3. «DUPLICAR» Y «COPIAR» PARECIAN NO HACER NADA
//
//    Funcionaban. Lo que pasaba es que no se veia:
//      · La copia nace APAGADA —para que no se envie sola— y la vista previa
//        solo muestra las encendidas. Se duplicaba de verdad, aparecia en el
//        cajon de la izquierda, y en la vista previa nada.
//      · «Copiar» deja la burbuja en el portapapeles y no manda ningun mensaje.
//        El unico rastro era que aparecia «Pegar»… la proxima vez que abrieras
//        el menu.
//
//    Sin aviso, uno da tres veces a duplicar creyendo que no funciona — y se
//    encuentra tres copias.
//
//   node scripts/prueba-los-cajones-se-quedan-donde-los-pusiste.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const editor = readFileSync(
  join(RAIZ, "src", "app", "editor", "page.tsx"),
  "utf8"
);

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// ── 1. La lista ya no se reordena sola ───────────────────────────────────────
comprobar(
  "apagar un cajon no lo manda al fondo",
  /function conSuIndice<T extends \{ enabled\?: boolean \}>\(items: T\[\]\) \{\s*\r?\n\s*return items\.map\(\(item, index\) => \(\{ item, index \}\)\);\s*\r?\n\}/.test(
    editor
  ),
  "se queda donde esta"
);
comprobar(
  "y no queda ningun orden por «enabled» suelto",
  !/activeFirst/.test(editor) &&
    !/Number\(left\.item\.enabled === false\) - Number\(right\.item\.enabled === false\)/.test(
      editor
    ),
  "ni la funcion ni su comparador"
);
// EN EL RECORRIDO PASABA LO MISMO POR OTRO CAMINO: un `order: 2` que empujaba
// las apagadas al final, y encima una barra que las escondia detras. Apagar una
// intro la hacia DESAPARECER de donde estaba, y encontrarla pedia acordarse de
// que existia esa barra. Apagar no es archivar.
comprobar(
  "en el recorrido tampoco bajan al final",
  !/order: 2/.test(editor),
  "se quedan en su sitio"
);
// Se mira el ROTULO que se dibujaba —con su contador entre llaves—, no la
// mencion: el comentario que explica por que se fue tambien la nombra.
comprobar(
  "y ya no hay barra que las esconda",
  !/Intros inactivas \(\{apagadas\}\)/.test(editor) &&
    !/Seguimientos inactivos \(\{apagados\}\)/.test(editor) &&
    !/setMostrarIntrosApagadas/.test(editor) &&
    !/setMostrarSeguimientosApagados/.test(editor),
  "se ven siempre"
);
// El indice real es lo que hace que mover, duplicar y borrar apunten al cajon
// correcto. Si se perdiera, las flechas moverian OTRO cajon — peor que antes.
comprobar(
  "cada cajon conserva su indice real",
  (editor.match(/conSuIndice\(/g) ?? []).length === 6,
  "los seis sitios que dibujan listas"
);

// ── 2. Un solo juego de flechas ──────────────────────────────────────────────
//
// Habia dos botones «↑ Subir cajón» / «↓ Bajar cajón» con letras, en su propio
// renglon, haciendo lo MISMO que las flechas ↑ ↓ de la cabecera. Dos botones
// para lo mismo, y el de bajar colgando solo debajo.
// Se miran las ETIQUETAS de boton —lo que se ve—, no cualquier mencion: el
// comentario que explica por que se fueron tambien las nombra.
comprobar(
  "se fueron los botones de texto duplicados",
  !/>\s*↑ Subir cajón\s*</.test(editor) && !/>\s*↓ Bajar cajón\s*</.test(editor),
  "quedan las flechas de la cabecera"
);
// Las flechas de CADA BURBUJA se quedan —mueven la burbuja, no el cajon— pero
// su globo decia "Subir cajón", que es otra cosa. Un rotulo que miente sobre lo
// que mueve un boton es como llenar el cajon equivocado por su titulo.
comprobar(
  "las flechas de la burbuja dicen lo que mueven",
  /title="Subir esta burbuja"/.test(editor) &&
    /title="Bajar esta burbuja"/.test(editor),
  "burbuja, no cajon"
);
// Pero las de la cabecera tienen que seguir ahi, o no habria forma de ordenar
// mas que arrastrando.
comprobar(
  "las flechas de la cabecera siguen",
  (editor.match(/moveGroup\(index, -1\);/g) ?? []).length >= 2 &&
    (editor.match(/moveFollowup\(index, -1\);/g) ?? []).length >= 1,
  "cajones, seguimientos y entregas"
);

// ── 3. El menu de la vista previa dice lo que hizo ───────────────────────────
// LA COPIA NACE COMO EL ORIGINAL, NO APAGADA.
//
// Nacia apagada «para que no se envie por accidente». Pero la vista previa solo
// muestra las encendidas, asi que la copia caia donde no se ve: duplicabas y no
// pasaba nada. Y pegar, igual — es el mismo codigo. Duplicar no es un
// accidente: es un clic derecho y una opcion elegida.
comprobar(
  "la copia conserva el estado del original",
  !/next\.splice\(index \+ 1, 0, \{ \.\.\.step, texts: \[\.\.\.step\.texts\], enabled: false \}\)/.test(
    editor
  ) &&
    !/const copy = \{ \.\.\.step, texts: \[\.\.\.step\.texts\], enabled: false \};/.test(
      editor
    ),
  "se ve donde cayo"
);
comprobar(
  "duplicar avisa de donde quedo",
  />Duplicar burbuja</.test(editor) &&
    /duplicada\. La copia está justo debajo\./.test(editor),
  "no parece roto"
);
comprobar(
  "copiar avisa y dice que sirve para cualquier secuencia",
  /Burbuja copiada\. Abre el menú donde la quieras —otra intro, un seguimiento, el upsell—/.test(
    editor
  ),
  "el portapapeles no se ve"
);
comprobar(
  "pegar tambien avisa",
  /Burbuja pegada debajo de la/.test(editor),
  "antes no decia nada"
);
// CORTAR: copiar y quitar, en ese orden. Si el borrado fallara, la burbuja
// sigue en el portapapeles. Y no pregunta «¿eliminar?»: no esta borrando, esta
// moviendo, y ya quedo a salvo.
comprobar(
  "se puede cortar una burbuja",
  />Cortar burbuja</.test(editor) &&
    /copyStep\(step\); onRemoveStep\(index, \{ sinPreguntar: true \}\)/.test(editor),
  "copia primero, quita despues"
);
comprobar(
  "cortar no pregunta si eliminar",
  /!opciones\?\.sinPreguntar &&\s*\r?\n\s*!window\.confirm\("¿Eliminar esta burbuja/.test(
    editor
  ),
  "no esta borrando, esta moviendo"
);
comprobar(
  "el aviso se va solo",
  /window\.setTimeout\(\(\) => setAvisoDelMenu\(null\), 3500\)/.test(editor),
  "no estorba"
);
// Y el menu sigue apuntando al indice REAL, no al de la vista previa: esta solo
// muestra las encendidas, asi que con una apagada en medio se borraria otra.
comprobar(
  "el menu apunta a la burbuja de verdad",
  /setContextMenu\(\{ index: originalIndex, x: event\.clientX, y: event\.clientY \}\)/.test(
    editor
  ),
  "originalIndex"
);

console.log(
  fallos === 0
    ? "\nTODO OK — los cajones se quedan donde los pusiste"
    : `\n${fallos} comprobacion(es) mal.`
);
process.exit(fallos === 0 ? 0 : 1);
