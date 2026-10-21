// Al duplicar un cajon se pide el nombre, y la copia queda abierta.
//
// LO QUE PASABA — con las palabras del dueno, el 15 de septiembre de 2026:
//
//   «cuando yo duplico un cajon automaticamente se duplica […] pero al duplicar
//    no sé donde queda este cajon ni sé si estoy dentro».
//
//   La copia aparecia sola, con el nombre del original y «copia» detras. Con
//   seis cajones en la lista y dos llamados casi igual, es facil ponerse a
//   escribir en el que no era — y eso no se nota hasta que sale.
//
// LA REGLA
//
//   Se pide el nombre con el de siempre YA ESCRITO: aceptar sin tocar nada deja
//   exactamente lo que hacia antes, y quien quiera ponerle nombre propio lo pone
//   en el mismo gesto. Cancelar no duplica. Un nombre en blanco tampoco: un
//   cajon sin titulo ya sale en rojo pidiendolo, y nacer asi seria crear el
//   problema a proposito. Y al aceptar, la copia se abre.
//
//   Esta prueba EJECUTA la funcion real con el `prompt` simulado.
//
//   node scripts/prueba-al-duplicar-se-pide-el-nombre.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const editor = readFileSync(join(RAIZ, "src", "app", "editor", "page.tsx"), "utf8");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 56)} ${valor}`);
};
const trozo = (desde, hasta) => {
  const i = editor.indexOf(desde);
  if (i < 0) return "";
  const f = editor.indexOf(hasta, i);
  return f < 0 ? editor.slice(i) : editor.slice(i, f);
};

// ── La funcion real, ejecutada con un `prompt` de mentira ────────────────────
const fuente = trozo("function nombreParaLaCopia(", "\n}")
  .replace("function nombreParaLaCopia(nombreActual: string | undefined): string | null {", "function nombreParaLaCopia(nombreActual) {");

/** Corre la funcion real. `respuesta` es lo que "escribe" el dueno en el prompt;
 *  null = pulso Cancelar. Devuelve { nombre, propuesto }. */
const duplicar = (nombreActual, respuesta) =>
  new Function(
    "nombreActual",
    "respuesta",
    `
    let propuesto = null;
    const prompt = (_texto, porDefecto) => {
      propuesto = porDefecto;
      return respuesta;
    };
    ${fuente}
    }
    const nombre = nombreParaLaCopia(nombreActual);
    return { nombre, propuesto };
    `
  )(nombreActual, respuesta);

comprobar("se encuentra la funcion", fuente.length > 0, "nombreParaLaCopia");

// ── 1. LO QUE PROPONE ────────────────────────────────────────────────────────
console.log("\n— lo que sale escrito por defecto —\n");
comprobar(
  "propone «<nombre> copia»",
  duplicar("INTRO TESTO ORER BUMP", "x").propuesto === "INTRO TESTO ORER BUMP copia",
  "lo de siempre, ya escrito"
);
comprobar(
  "y aceptando sin tocar nada, se queda ese",
  duplicar("SEG2 OB", "SEG2 OB copia").nombre === "SEG2 OB copia",
  "igual que antes del cambio"
);
comprobar(
  "sin nombre original, propone en blanco",
  duplicar("", "x").propuesto === "" && duplicar(undefined, "x").propuesto === "",
  "no inventa un «copia» suelto"
);
comprobar(
  "y no arrastra los espacios del original",
  duplicar("   Intro 1   ", "x").propuesto === "Intro 1 copia",
  "limpio"
);

// ── 2. LO QUE DEVUELVE ───────────────────────────────────────────────────────
console.log("\n— y lo que decide el dueño —\n");
comprobar(
  "si escribe otro nombre, ese manda",
  duplicar("Intro 1", "PROMO NAVIDAD").nombre === "PROMO NAVIDAD",
  "el nombre es suyo"
);
comprobar(
  "CANCELAR no duplica",
  duplicar("Intro 1", null).nombre === null,
  "ni toca el historial"
);
comprobar(
  "un nombre en blanco tampoco",
  duplicar("Intro 1", "").nombre === null,
  "no nace un cajón sin título"
);
comprobar(
  "ni uno de solo espacios",
  duplicar("Intro 1", "    ").nombre === null,
  "igual"
);
comprobar(
  "y el que escribe se guarda sin espacios sobrantes",
  duplicar("Intro 1", "  PROMO  ").nombre === "PROMO",
  "limpio"
);

// ── 3. LOS CUATRO SITIOS LA USAN, Y ABREN LA COPIA ───────────────────────────
//
// Intro, Seguimientos, sus variantes, y los cajones de la oferta y del upsell.
console.log("\n— los cuatro sitios donde se duplica —\n");
const sitios = [
  ["Intro (Canales)", "const duplicateGroup = (index: number) => {", "\n  };"],
  ["Seguimientos", "const duplicateFollowup = (index: number) => {", "\n  };"],
  ["variantes del seguimiento", "const duplicateVariant = (", "\n  };"],
  // EL DE LA OFERTA Y EL UPSELL SE SACO DEL BOTON a una funcion el 30/09/2026,
  // cuando Duplicar bajo tambien a la fila cerrada: dos botones, UNA accion.
  // El codigo es el mismo, solo cambio de sitio.
  [
    "oferta y upsell",
    "  const duplicarCajon = (i: number) => {",
    "\n  };",
  ],
];
for (const [donde, desde, hasta] of sitios) {
  const codigo = trozo(desde, hasta);
  comprobar(
    `${donde}: pide el nombre`,
    /nombreParaLaCopia\(/.test(codigo),
    "antes de duplicar"
  );
  comprobar(
    `${donde}: y si cancela, no hace nada`,
    /if \(nombre === null\) return;/.test(codigo),
    "ni snapshot"
  );
  comprobar(
    `${donde}: abre la copia`,
    /abrirCajonDuplicado\(/.test(codigo),
    "el dueño cae dentro"
  );
  comprobar(
    `${donde}: y le pone el nombre elegido`,
    /name: nombre/.test(codigo),
    "no el de antes"
  );
}

// ── 3 bis. NO BASTA CON ABRIRLA: HAY QUE BAJAR HASTA ELLA ────────────────────
//
// «hice la copia y quedó abierta pero no estoy dentro de ella, sino fuera»
// —15 de septiembre de 2026—. Con seis cajones en la lista, «abierto» y «a la
// vista» no son lo mismo: la copia quedaba abierta mas abajo, fuera de pantalla.
console.log("\n— y se baja hasta la copia, no solo se abre —\n");
const llevar = trozo("function llevarAlCajon(", "\n}");
comprobar("existe quien baje hasta el cajón", llevar.length > 0, "llevarAlCajon");
comprobar(
  "lo busca por la marca que ya tenían los cajones",
  /\[data-collapsible-key="\$\{titleKey\}"\]/.test(llevar),
  "sin inventar anclas nuevas"
);
comprobar(
  "baja hasta él y lo deja centrado",
  /scrollIntoView\(\{ behavior: "smooth", block: "center" \}\)/.test(llevar),
  "a la vista"
);
comprobar(
  "y lo marca como el cajón activo",
  /anunciarCajonActivo\(`wf:collapsible:\$\{titleKey\}`\)/.test(llevar),
  "el borde de «estoy aquí»"
);
comprobar(
  "espera a que esté dibujada antes de buscarla",
  /requestAnimationFrame\(/.test(llevar),
  "React la pinta en el repintado siguiente"
);
comprobar(
  "y si no aparece, no se queda colgado",
  /if \(intentos > 0\)/.test(llevar),
  "unos pocos intentos y se deja"
);
comprobar(
  "el duplicado la llama siempre",
  /llevarAlCajon\(`\$\{keyPrefix\}_\$\{nuevoIndice\}`\);/.test(
    trozo("function abrirCajonDuplicado(", "\n}")
  ),
  "los cuatro sitios pasan por ahí"
);

// ── 4. EL ORDEN IMPORTA: PREGUNTAR ANTES DE TOCAR EL HISTORIAL ───────────────
console.log("\n— y se pregunta ANTES de tocar nada —\n");
for (const [donde, desde, hasta] of sitios) {
  const codigo = trozo(desde, hasta);
  const iNombre = codigo.indexOf("nombreParaLaCopia(");
  const iSnap = codigo.search(/(onSnapshot|snapshot)\(\)/);
  comprobar(
    `${donde}: el prompt va antes del snapshot`,
    iNombre >= 0 && iSnap >= 0 && iNombre < iSnap,
    "cancelar no deja rastro"
  );
}

console.log(
  fallos === 0
    ? "\nTODO OK — se pide el nombre y la copia queda abierta"
    : `\n${fallos} comprobacion(es) mal.`
);
process.exit(fallos === 0 ? 0 : 1);
