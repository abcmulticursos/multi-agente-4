// El primer cajon del canal se manda ENTERO, y el canal no pide prestado nada.
//
// LO QUE PASO DE VERDAD
//
//   Una intro de DIEZ burbujas en el canal de WhatsApp. El bot mando UNA. Y
//   detras solto la intro de OTRO producto, uno que ya no se vende.
//
// POR QUE
//
//   El saludo, por dentro, es una caja de UN texto. El reparto del canal metia
//   el primer cajon en esa caja: entraba su primera burbuja y las otras nueve no
//   tenian donde ir. Se descartaban en silencio, sin error.
//
//   Y como los demas cajones estaban apagados, no quedaba ninguna intro del
//   canal. En vez de callar, el motor se iba a buscarla a la modalidad, donde
//   seguia guardada la del producto anterior.
//
//   Fue inofensivo mientras el editor dibujaba ese cajon aparte, como «Saludo
//   inicial»: uno veia una caja de una burbuja y ponia una burbuja. Al unir la
//   intro en una sola lista, el editor paso a invitar a llenarlo entero y los
//   dos dejaron de hablar de lo mismo. La pantalla cambio y el motor no.
//
// LO QUE NO PUEDE VOLVER A PASAR
//
//   1. Que se descarte contenido del primer cajon.
//   2. Que el canal envie la intro de otro sitio cuando no tiene ninguna suya.
//   3. Que la pantalla calle cuando no hay nada que enviar. Antes «no hay nada»
//      y «esta bien» se veian igual, porque siempre salia ALGO.
//
//   node scripts/prueba-el-canal-manda-su-intro-entera.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const config = readFileSync(join(RAIZ, "src", "lib", "workflow", "config.ts"), "utf8");
const editor = readFileSync(join(RAIZ, "src", "app", "editor", "page.tsx"), "utf8");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

const reparto = (() => {
  const i = config.indexOf("function applyChannelContent(");
  const f = config.indexOf("if (Array.isArray(content.followups))", i);
  return i < 0 || f < 0 ? "" : config.slice(i, f);
})();
comprobar("se encuentra el reparto del canal", reparto.length > 0, "applyChannelContent");

// -- 1. TODOS LOS CAJONES SON INTRO, DESDE EL PRIMERO ------------------------
//
// El primer cajon se gastaba en la casilla del mensaje suelto del arranque, que
// admite UNA burbuja: entraba la primera y las demas se descartaban. Esa casilla
// ya no existe. Ver `prueba-sin-mensaje-suelto-antes-de-la-intro`.
comprobar(
  "la lista de intros empieza en el primer cajón",
  /const introOnlyGroups = introGroups\.filter\(/.test(reparto) &&
    !/introGroups\.slice\(1\)/.test(reparto),
  "no se descarta ninguno"
);
comprobar(
  "y un cajón apagado no se envía",
  /group\.enabled !== false && hasSendableSteps\(group\.steps\)/.test(reparto),
  "apagar apaga"
);

// -- 2. EL CANAL NO PIDE PRESTADA LA INTRO DE NADIE --------------------------
//
// Aqui es donde salia el producto equivocado: sin cajones que enviar, no se
// tocaba nada y el motor leia la intro de la modalidad.
comprobar(
  "sin cajones que enviar, el canal calla",
  /if \(introOnlyGroups\.length === 0 && introGroups\.length > 0\) \{/.test(reparto) &&
    /next\.intro_sequence = \[\];/.test(reparto),
  "no toma la de la modalidad"
);
comprobar(
  "y lo deja escrito en el registro",
  /no hay ninguna intro encendida con contenido/.test(reparto),
  "se puede ver qué pasó"
);
// Lo mismo con los seguimientos: una lista vacia del canal dejaba pasar los de
// la modalidad, persiguiendo al cliente con otro producto.
comprobar(
  "los seguimientos siguen la misma regla",
  /if \(Array\.isArray\(content\.followups\)\) \{\s*\r?\n\s*next\.followup_sequences = content\.followups;/.test(
    config
  ) && /ningún seguimiento encendido/.test(config),
  "el canal manda"
);

// -- 3. LA PANTALLA AVISA CUANDO NO HAY NADA QUE ENVIAR ----------------------
comprobar(
  "hay un aviso de que no se envía nada",
  /function AvisoDeNadaQueEnviar\(/.test(editor),
  "en rojo"
);
// Dos avisos distintos: no tener ninguno y tenerlos todos apagados se arreglan
// de formas distintas. Decir «agrega» a quien ya tiene cinco lo manda a crear un
// sexto en vez de encender uno.
comprobar(
  "distingue «no hay ninguno» de «están apagados»",
  /No hay ninguno\. Agrega \{queEs\}/.test(editor) &&
    /Están todos apagados\. Activa al menos \{queEs\}/.test(editor),
  "dos arreglos distintos"
);
comprobar(
  "sale en la intro del canal",
  /<AvisoDeNadaQueEnviar[\s\S]{0,200}?queEs="una intro"/.test(editor),
  "una intro"
);
comprobar(
  "y en los seguimientos del canal",
  /<AvisoDeNadaQueEnviar[\s\S]{0,200}?queEs="un seguimiento"/.test(editor),
  "un seguimiento"
);

console.log(fallos === 0 ? "\nTODO OK" : `\n${fallos} FALLO(S)`);
process.exit(fallos === 0 ? 0 : 1);
