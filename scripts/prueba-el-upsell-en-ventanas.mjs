// La pestaña Upsell: tres barras, y dentro cada asunto con su titulo.
//
// COMO ESTABA
//
//   UNA sola caja verde larguisima con todo dentro, uno detras de otro: el
//   interruptor, el chequeo, los datos, la intro, la pregunta del final, los
//   botones, el «¿que trae?» y la entrega.
//
//   Y los rotulos de cada bloque eran del mismo tamaño que la etiqueta de
//   cualquier campo, sin nada encima que los separara. La pregunta del final se
//   leia como si fuera mas de lo mismo de la intro.
//
// COMO QUEDA
//
//   Tres barras, cada una con su ventana:
//
//     · La etapa, DESDE el titulo HASTA los botones.
//     · Si pregunta «¿que trae?», que no es parte de la oferta: es lo que el
//       bot contesta mientras se la esta ofreciendo.
//     · La entrega del segundo producto.
//
//   La tercera no se pidio con esas palabras, pero un bloque suelto al final,
//   debajo de dos barras, es justo el enredo que se esta deshaciendo.
//
//   Y dentro de la primera, los dos asuntos llevan titulo GRANDE —el mismo
//   tamaño que «CONTENIDO» dentro de un producto— con una linea encima. Un solo
//   idioma para «aqui empieza otra cosa».
//
// LOS NOMBRES
//
//   «La segunda intro (se suelta entera, sin preguntar)» pasa a «INTRO DEL
//   UPSELL», y «La pregunta del final: ¿deseas llevarlo?» a «ELECCION CON
//   BOTONES». Lo que decian antes se queda al lado, en pequeño.
//
//   node scripts/prueba-el-upsell-en-ventanas.mjs
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

const pestana = (() => {
  const i = editor.indexOf('tab === "upsell"');
  const f = editor.indexOf('tab === "contenido"', i);
  return i < 0 || f < 0 ? "" : editor.slice(i, f);
})();
comprobar("se encuentra la pestaña", pestana.length > 0, "Upsell");

// -- 1. TRES BARRAS, Y NINGUNA CAJA SUELTA -----------------------------------
const barras = [
  [
    "la etapa",
    /title="🛒 Upsell — vender un segundo producto DESPUÉS de entregar"\s*\r?\n\s*titleKey="upsell_etapa"/,
  ],
  [
    "si pregunta qué trae",
    /title="❓ Si pregunta «¿qué trae\?»"\s*\r?\n\s*titleKey="upsell_que_trae"/,
  ],
  [
    "la entrega",
    /title="📦 Entrega del segundo producto"\s*\r?\n\s*titleKey="upsell_entrega_cajon"/,
  ],
];
for (const [nombre, patron] of barras) {
  comprobar(`barra: ${nombre}`, patron.test(pestana), "con su ventana");
}
// Se cuentan las aperturas y los `enVentana`, no se recorta cada etiqueta: la
// primera lleva dentro otra etiqueta —el «?»— y cualquier recorte hasta el
// primer «>» se queda a medias en ella.
const aperturas = (pestana.match(/<Collapsible\b/g) ?? []).length;
const enVentana = (pestana.match(/\benVentana\b/g) ?? []).length;
comprobar(
  "y las tres abren ventana, no se despliegan",
  aperturas === 3 && enVentana === 3,
  `${enVentana} de ${aperturas}`
);
// La caja verde que lo envolvia TODO. Si volviera, volveria el enredo entero.
comprobar(
  "la caja verde que lo envolvía todo ya no está",
  !/rounded-lg border-2 border-teal-300 bg-teal-50 p-4/.test(pestana),
  "no hay donde apilarlo"
);

// -- 2. EL «?» SE ABRE DESDE LA BARRA ----------------------------------------
comprobar(
  "la ayuda se abre desde la barra",
  /headerActions=\{<AyudaDelUpsell \/>\}/.test(pestana),
  "sin abrir la sección"
);

// -- 3. LOS DOS ASUNTOS DE DENTRO, SEPARADOS ---------------------------------
comprobar(
  "«INTRO DEL UPSELL» con su título grande",
  /<h3 className="text-lg font-black uppercase tracking-tight text-neutral-900">\s*\r?\n\s*Intro del upsell/.test(
    pestana
  ),
  "el tamaño de Contenido"
);
comprobar(
  "«ELECCIÓN CON BOTONES» con su título grande",
  /<h3 className="text-lg font-black uppercase tracking-tight text-neutral-900">\s*\r?\n\s*Elección con botones/.test(
    pestana
  ),
  "el tamaño de Contenido"
);
// LA LINEA ES LO QUE DICE «AQUI EMPIEZA OTRA COSA». Sin ella los dos bloques se
// leen seguidos, que es el enredo de partida.
comprobar(
  "y cada uno con su línea encima",
  (pestana.match(/mt-8 border-t-2 border-teal-300 pt-6/g) ?? []).length === 2,
  "no son continuación"
);
// Lo que decian los rotulos viejos no se pierde: se queda al lado, en pequeño,
// como en Contenido.
comprobar(
  "lo que decían antes se queda al lado",
  /se suelta entera, sin preguntar/.test(pestana) &&
    /la pregunta del final: «¿deseas llevarlo\?»/.test(pestana),
  "en pequeño"
);
comprobar(
  "y ya no son rotulillos de tamaño de etiqueta",
  !/<h3 className="mb-2 mt-5 text-sm font-semibold text-neutral-800">/.test(
    pestana
  ),
  "ninguno de los cuatro"
);

// -- 4. NO SE PERDIO NINGUN EDITOR -------------------------------------------
//
// Mover bloques de sitio es donde se cae uno sin que nada avise: no da error,
// simplemente ya no esta en pantalla.
const editores = [
  ["la intro", 'idPrefix="upsell_intro"'],
  ["la pregunta", 'idPrefix="upsell_pregunta"'],
  ["qué trae", 'idPrefix="upsell_info"'],
  ["la entrega", 'idPrefix="upsell_entrega"'],
];
for (const [nombre, aguja] of editores) {
  comprobar(`sigue estando: ${nombre}`, pestana.includes(aguja), "en su barra");
}
const campos = [
  ["el chequeo", "<ChequeoDelUpsell cfg={cfg} />"],
  ["el interruptor", "Desactivar upsell"],
  ["traer de otra modalidad", "<TraerEtapaUpsell"],
  ["los botones", "boton_si: e.target.value"],
  ["el rechazo", "respuesta_rechazo"],
  ["la respuesta genérica", "respuesta_generica"],
];
for (const [nombre, aguja] of campos) {
  comprobar(`sigue estando: ${nombre}`, pestana.includes(aguja), "no se cayó");
}

console.log(fallos === 0 ? "\nTODO OK" : `\n${fallos} FALLO(S)`);
process.exit(fallos === 0 ? 0 : 1);
