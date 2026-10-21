// Los botones del upsell se llenan a la izquierda y se ven a la derecha.
//
// COMO ESTABA
//
//   Los dos campos, «Boton sí» y «Boton no», uno al lado del otro y a lo ancho
//   de la caja. Ninguna vista previa. Se escribian las etiquetas a ciegas.
//
//   Y el visor de arriba no ayudaba: enseñaba la burbuja de la pregunta PELADA,
//   sin los botones que el bot le pega debajo. Con «Preguntar con botones»
//   marcado, lo que se veia en pantalla no era lo que recibia el cliente.
//
// COMO QUEDA
//
//   Dos columnas, como en Regalo: a la izquierda se llena, a la derecha se ve.
//   La burbuja con sus botones debajo, en el mismo visor de la casa.
//
//   Los campos son los MISMOS de siempre. No se toca ni el motor ni el
//   guardado: siguen siendo dos etiquetas, con su significado en el rotulo.
//
// EL TEXTO DEL VISOR TIENE QUE SER EL DEL BOT
//
//   El motor cuelga los botones de la ULTIMA burbuja encendida de la pregunta,
//   y solo si es de texto. Si no la hay, cae al texto de respaldo. Y si estan
//   TODAS apagadas, no manda nada.
//
//   Si este visor mirara otra cosa, seria un visor que miente, que es peor que
//   no tener visor.
//
//   node scripts/prueba-botones-del-upsell-como-en-regalo.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const editor = readFileSync(join(RAIZ, "src", "app", "editor", "page.tsx"), "utf8");
const motor = readFileSync(
  join(RAIZ, "src", "lib", "workflow", "engine.ts"),
  "utf8"
);

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

const caja = (() => {
  const i = editor.indexOf("SE LLENA A LA IZQUIERDA Y SE VE A LA DERECHA");
  const f = editor.indexOf("Si pregunta «¿qué trae?»", i);
  return i < 0 || f < 0 ? "" : editor.slice(i, f);
})();
comprobar("se encuentra la caja de botones", caja.length > 0, "Upsell");

// -- 1. DOS COLUMNAS, COMO EN REGALO -----------------------------------------
comprobar(
  "se llena a la izquierda y se ve a la derecha",
  /<div className="mt-3 grid gap-4 lg:grid-cols-2">/.test(caja),
  "como en Regalo"
);
comprobar(
  "el visor va clavado, como el del regalo",
  /<div className="lg:sticky lg:top-4 lg:self-start">/.test(caja) &&
    /Vista previa/.test(caja),
  "no se va al desplazar"
);
comprobar(
  "y es el visor de botones de la casa",
  /<ButtonsPreview/.test(caja),
  "el mismo que Regalo"
);
// Apagados no se dibuja una burbuja con botones que nadie va a recibir. Es lo
// que hace Regalo.
comprobar(
  "apagados lo dice, no dibuja botones",
  /Botones apagados/.test(caja),
  "igual que Regalo"
);

// -- 2. LOS CAMPOS SON LOS MISMOS --------------------------------------------
//
// Esto no es una funcion nueva: es la misma pantalla puesta de otra forma. Si
// aqui apareciera una lista con acciones, estariamos tocando como el bot
// reconoce el «si», que es justo lo que no se toca.
comprobar(
  "siguen siendo los dos campos de siempre",
  /boton_si: e\.target\.value/.test(caja) &&
    /boton_no: e\.target\.value/.test(caja),
  "sin lista ni acciones"
);
comprobar(
  "y el motor sigue mandando esos dos",
  /\[up\.boton_si, up\.boton_no\]/.test(motor),
  "nada que tocar abajo"
);

// -- 3. EL VISOR ENSEÑA EL TEXTO QUE VA A LLEVAR EL BOTON --------------------
comprobar(
  "mira la última burbuja encendida",
  /const encendidas = todas\.filter\(/.test(caja) &&
    /const ultima = encendidas\[encendidas\.length - 1\];/.test(caja),
  "de ahí cuelgan los botones"
);
// Solo si es de TEXTO: de una foto no cuelga nada, y el motor cae al respaldo.
// El aviso ambar de arriba ya explica ese caso.
comprobar(
  "y solo si esa burbuja es de texto",
  /ultima && \(ultima\.type \?\? "text"\) === "text"/.test(caja),
  "de una foto no cuelgan"
);
comprobar(
  "sin ninguna, el texto de respaldo",
  /deLaUltima\.trim\(\) \|\| \(cfg\.upsell\?\.pregunta \?\? ""\)/.test(caja),
  "como el motor"
);
// TODAS APAGADAS = no se manda nada. Enseñar el respaldo ahi haria creer que la
// pregunta sale igual, que es justo el fallo que se arreglo en el motor.
comprobar(
  "y todas apagadas es que no sale nada",
  /const apagadaAProposito =\s*\r?\n?\s*todas\.length > 0 && encendidas\.length === 0;/.test(
    caja
  ),
  "apagarla la apaga"
);
// El mismo molino que el visor de arriba: precios primero, spintax despues. Sin
// esto aqui se leeria «{a|b}» y dos dedos mas arriba la frase ya resuelta.
comprobar(
  "y pasa por el molino de siempre",
  /resolvePreviewSpintax\(\s*\r?\n\s*applyPreviewPrices\(/.test(caja),
  "precios y spintax"
);

// -- 4. EL EJEMPLO VACIO NO ES DE PAGOS --------------------------------------
//
// El visor nacio para el menu de pago, asi que su ejemplo de fabrica son
// metodos de pago. Colgando de «¿deseas llevarlo?» eso no pinta nada.
comprobar(
  "vacío enseña un ejemplo del upsell",
  /ejemplo=\{\[/.test(caja) && /label: "Sí, lo quiero"/.test(caja),
  "no Yape / Plin / BCP"
);
comprobar(
  "y el de fábrica sigue para quien no diga nada",
  /ejemplo \?\? \[\s*\r?\n\s*\{ label: "Yape", method: "yape" \}/.test(editor),
  "Regalo no se entera"
);

console.log(fallos === 0 ? "\nTODO OK" : `\n${fallos} FALLO(S)`);
process.exit(fallos === 0 ? 0 : 1);
