// En «Lo reconoce si dicen» se puede escribir.
//
// LO QUE PASO
//
//   El dueño quiso añadir mas alias a sus metodos de pago —«yape, yapee, yae,
//   yappe…»— y la caja no le dejaba. En los tres metodos a la vez.
//
// LA CAUSA
//
//   La caja guardaba una LISTA, no un texto, y se pintaba con
//   `aliases.join(", ")`. En cada tecla se partia por comas, se recortaban los
//   espacios y se tiraban los huecos vacios… y lo que se volvia a pintar era el
//   resultado de eso:
//
//     · escribes la coma  -> `filter(Boolean)` se lleva el hueco recien abierto
//       y la coma DESAPARECE;
//     · escribes el espacio de despues -> `trim()` se lo come;
//     · y en cada pulsacion el cursor salta al final.
//
// EL ARREGLO
//
//   Mientras se escribe manda el TEXTO tal cual (el borrador); la lista se
//   limpia al salir de la caja. Es la misma disciplina que `NameAliases` ya
//   usaba para los alias de producto: alli se dejaba escribir y aqui no, porque
//   aqui faltaba el borrador.
//
//   node scripts/prueba-la-caja-de-alias-se-deja-escribir.mjs
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
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 54)} ${valor}`);
};

// ── El componente real ───────────────────────────────────────────────────────
const i = editor.indexOf("function CajaDeAlias({");
if (i < 0) throw new Error("no encuentro CajaDeAlias en page.tsx");
const cuerpo = editor.slice(i, editor.indexOf("\nfunction NameAliases(", i));

console.log("— lo que pintaba mal ya no puede volver —\n");
comprobar(
  "quien PINTA es el borrador, no la lista",
  /value=\{borrador\}/.test(cuerpo),
  "el cursor se queda donde esta"
);
comprobar(
  "al teclear NO se limpia lo escrito",
  /onInput=\{\(e\) => setBorrador\(e\.currentTarget\.value\)\}/.test(cuerpo),
  "la coma no desaparece"
);
comprobar(
  "se limpia al SALIR de la caja",
  /onBlur=\{\(e\) => \{[\s\S]{0,240}?const limpios = limpiar\(e\.currentTarget\.value\);/.test(
    cuerpo
  ),
  "al final, no en cada tecla"
);
comprobar(
  "y no se reescribe mientras el cursor esta dentro",
  /if \(!escribiendo\.current\) setBorrador\(comoTexto\);/.test(cuerpo),
  "el freno del borrador"
);
comprobar(
  "sigue avisando en cada tecla, para no perder lo tecleado",
  /onChange=\{\(e\) => onChange\(limpiar\(e\.target\.value\)\)\}/.test(cuerpo),
  "el editor guarda mientras escribes"
);

console.log("\n— y la caja de los metodos de pago la usa —\n");
comprobar(
  "«Lo reconoce si dicen» usa la caja nueva",
  /Lo reconoce si dicen[\s\S]{0,400}?<CajaDeAlias/.test(editor),
  "los tres metodos salen de ahi"
);
comprobar(
  "ya no queda el patron que rompia",
  !/value=\{\(boton\.aliases \?\? \[\]\)\.join\(", "\)\}/.test(editor),
  "sin lista pintada en crudo"
);

// ── Y el comportamiento, simulado tecla a tecla ──────────────────────────────
//    Se reproduce el patron VIEJO y el NUEVO sobre el mismo tecleo, para dejar
//    escrito por que uno se podia escribir y el otro no.
console.log("\n— tecleando «yape, yapee» letra a letra —\n");
const limpiar = (t) => t.split(/[,\n]/).map((a) => a.trim()).filter(Boolean);
const tecleado = "yape, yapee";

// Viejo: lo que se pinta es SIEMPRE la lista limpia.
let viejo = "";
for (const letra of tecleado) viejo = limpiar(viejo + letra).join(", ");
// Nuevo: lo que se pinta es el texto tal cual.
let nuevo = "";
for (const letra of tecleado) nuevo = nuevo + letra;

comprobar(
  "el patron viejo pierde lo tecleado",
  viejo !== tecleado,
  `quedaba «${viejo}»`
);
comprobar(
  "el nuevo escribe lo que escribes",
  nuevo === tecleado,
  `queda «${nuevo}»`
);
comprobar(
  "y al salir se guarda limpio",
  JSON.stringify(limpiar(nuevo)) === JSON.stringify(["yape", "yapee"]),
  limpiar(nuevo).join(" · ")
);

console.log(
  fallos === 0
    ? "\nTODO OK — se pueden añadir alias sin pelearse con la caja"
    : `\n${fallos} comprobacion(es) mal.`
);
process.exit(fallos === 0 ? 0 : 1);
