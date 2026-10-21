// El nombre del producto se escribe UNA vez, en Contenido.
//
// LO QUE PASO
//
//   El bot le pregunto al cliente:
//
//       ¿A cual te refieres? 😊
//       • <<NOMBRE_OPCION_COMBO>> — si, puedes completar lo que ya pagaste.
//       • <nombre del extra> — ese va aparte y se paga completo.
//
//   Un marcador de plantilla, tal cual, en una conversacion de venta.
//
// LA CAUSA
//
//   Habia DOS sitios para el mismo dato: el nombre en «Contenido» y el nombre de
//   cada opcion de la oferta. Y el bot leia el segundo — justo el que se queda
//   sin llenar, porque nace con un `<<hueco>>`.
//
//   El operador tenia los dos productos con su nombre puesto en Contenido. El
//   bot no los miraba.
//
// LA REGLA
//
//   El hueco se rellena solo desde Contenido. Lo que el operador haya escrito A
//   MANO en la opcion manda: hay quien le pone el precio dentro del nombre para
//   los botones, y eso no se le puede pisar.
//
//   node scripts/prueba-el-nombre-se-escribe-una-vez.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

const RAIZ = process.cwd();
const config = readFileSync(
  join(RAIZ, "src", "lib", "workflow", "config.ts"),
  "utf8"
);

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// ── El resolutor real, sacado del archivo ────────────────────────────────────
const cuerpo = (() => {
  const i = config.indexOf("function conLosNombresDelContenido<");
  const f = config.indexOf("\n}", i);
  return i < 0 ? "" : config.slice(i, f + 2);
})();
// EL RESPALDO DEL NOMBRE YA NO MIRA UNA POSICIÓN FIJA: PREGUNTA A LA TABLA.
//
// Desde el 24/09 esta función consulta `tablaDeHuecos` para saber en qué hueco
// está cada puesto —«como -OB-» pone delante el producto visible—. Las dos
// ayudantes se le pasan al banco: así se puede montar cada reparto a mano y ver
// qué nombre sale, que es lo que esta prueba vigila.
let tablaDelBanco = {};
const { conLosNombresDelContenido } = new Function(
  "activeModalityKey",
  "tablaDeHuecos",
  cuerpo
    .replace(
      /function conLosNombresDelContenido<T extends OrderBump \| DobleOfertaDos>\(\s*\r?\n\s*oferta: T,\s*\r?\n\s*cfg: WorkflowConfig\s*\r?\n\): T \{/,
      "function conLosNombresDelContenido(oferta, cfg) {"
    )
    .replace(/const suyo = \(valor\?: string\): string =>/, "const suyo = (valor) =>")
    .replace(
      /const cajaDelHueco = \(hueco: 1 \| 2 \| undefined\): string \| undefined =>/,
      "const cajaDelHueco = (hueco) =>"
    ) + "\nreturn { conLosNombresDelContenido };"
)(
  () => "lineal",
  () => tablaDelBanco
);

// ── 1. El hueco se rellena desde Contenido ───────────────────────────────────
const conHueco = conLosNombresDelContenido(
  {
    combo: { name: "<<NOMBRE_OPCION_COMBO>>" },
    basico: { name: "<<NOMBRE_OPCION_BASICO>>" },
  },
  { product_name: "PRODUCTO UNO", product_name_2: "PRODUCTO DOS" }
);
comprobar(
  "un `<<hueco>>` toma el nombre de Contenido",
  conHueco.combo.name === "PRODUCTO UNO" &&
    conHueco.basico.name === "PRODUCTO DOS",
  "sin escribirlo dos veces"
);

// ── 1-bis. Y CADA NOMBRE SALE DEL HUECO DE SU PUESTO ────────────────────────
//
// LO QUE PASÓ — 24/09/2026, arreglando «como -OB-». Allí el hueco 1 pasó a ser
// el BÁSICO (el visible) y el 2 el FULL (el oculto). El respaldo daba por hecho
// lo contrario y los nombres salieron cruzados: la opción CARA con el nombre del
// barato y el precio del caro. Lo cazó el banco antes de ninguna conversación.
tablaDelBanco = { basico: 1, full: 2 };
const comoOb = conLosNombresDelContenido(
  {
    combo: { name: "<<NOMBRE_OPCION_COMBO>>" },
    basico: { name: "<<NOMBRE_OPCION_BASICO>>" },
  },
  { product_name: "EL VISIBLE", product_name_2: "EL OCULTO" }
);
comprobar(
  "con el visible delante, el caro sigue siendo el caro",
  comoOb.combo.name === "EL OCULTO" && comoOb.basico.name === "EL VISIBLE",
  `${comoOb.combo.name} / ${comoOb.basico.name}`
);
tablaDelBanco = { full: 1, basico: 2 };
const comoDou = conLosNombresDelContenido(
  {
    combo: { name: "<<NOMBRE_OPCION_COMBO>>" },
    basico: { name: "<<NOMBRE_OPCION_BASICO>>" },
  },
  { product_name: "EL CARO", product_name_2: "EL BARATO" }
);
comprobar(
  "y con el caro delante, tampoco se mueve",
  comoDou.combo.name === "EL CARO" && comoDou.basico.name === "EL BARATO",
  `${comoDou.combo.name} / ${comoDou.basico.name}`
);
// Sin tabla que sepa de los dos, el respaldo de siempre, letra por letra.
tablaDelBanco = {};
const vacio = conLosNombresDelContenido(
  { combo: { name: "" }, basico: { name: "   " } },
  { product_name: "PRODUCTO UNO", product_name_2: "PRODUCTO DOS" }
);
comprobar(
  "y un nombre vacío, también",
  vacio.combo.name === "PRODUCTO UNO" && vacio.basico.name === "PRODUCTO DOS",
  "el hueco es hueco"
);

// ── 2. LO QUE ESCRIBIÓ A MANO NO SE PISA ─────────────────────────────────────
//
// Es lo que hay que proteger: hay quien le mete el precio dentro del nombre
// para que salga en los botones. Eso es suyo y manda.
const suyos = conLosNombresDelContenido(
  { combo: { name: "El Completo -s/9.90" }, basico: { name: "El Kit basico" } },
  { product_name: "OTRA COSA", product_name_2: "OTRA COSA MAS" }
);
comprobar(
  "\nlo que escribió a mano en la oferta MANDA",
  suyos.combo.name === "El Completo -s/9.90" &&
    suyos.basico.name === "El Kit basico",
  "no se le pisa"
);
comprobar(
  "y si no hay nada que cambiar, devuelve lo mismo",
  conLosNombresDelContenido(suyos, {}) === suyos,
  "sin copias inútiles"
);
// Sin nombre en ningun sitio no se inventa nada: queda vacio, y quien lo use ya
// tiene sus propias guardas para no imprimir un nombre a medias.
comprobar(
  "y sin nombre en ningún sitio, no inventa",
  (() => {
    const nada = conLosNombresDelContenido(
      { combo: { name: "<<X>>" }, basico: { name: "" } },
      {}
    );
    return nada.combo.name === "" && nada.basico.name === "";
  })(),
  "vacío, no un `<<hueco>>`"
);

// ── 3. Contra su configuración real, modalidad por modalidad ─────────────────
console.log("");
const cfg = parse(readFileSync(join(RAIZ, "config", "intro-data.yaml"), "utf8"));
for (const modo of ["doble_oferta_upsell", "order_bump", "doble_oferta_dos"]) {
  const t = cfg.modality_templates?.[modo];
  if (!t) continue;
  const oferta =
    modo === "order_bump" ? t.order_bump : t.doble_oferta_dos;
  if (!oferta) continue;
  const r = conLosNombresDelContenido(oferta, t);
  const hueco = (s) =>
    !s || !String(s).trim() || (String(s).includes("<<") && String(s).includes(">>"));
  // AQUI SE EXIGIA QUE LAS DOS OPCIONES TUVIERAN NOMBRE, Y ESTABA MAL PLANTEADO.
  //
  // Eso mide el CONTENIDO del dueÃ±o, no el codigo. Una modalidad a medio llenar
  // —que es su derecho y no rompe nada— ponia la prueba roja. Y una prueba que
  // se pone roja porque alguien todavia no termino de escribir se deja de
  // mirar; el dia que avise de algo de verdad, tampoco se vera.
  //
  // LO QUE SE MIDE AHORA: SI HAY DE DONDE SACAR EL NOMBRE, TIENE QUE SALIR.
  //
  // La regla es que el nombre de la opcion, cuando esta vacio, se toma del
  // producto de esa modalidad. Asi que se comprueba SOLO donde hay de donde
  // tomarlo. Sin nombre ni producto no hay regla que aplicar: es una modalidad
  // sin llenar, y se dice como nota.
  for (const papel of ["combo", "basico"]) {
    const deDonde =
      papel === (modo === "doble_oferta_upsell" ? "combo" : "basico")
        ? t.product_name
        : t.product_name_2;
    if (hueco(oferta?.[papel]?.name) && hueco(deDonde)) {
      console.log(
        `     nota  ${modo} · ${papel}: sin nombre y sin producto del que tomarlo.`
      );
      continue;
    }
    comprobar(
      `${modo} · ${papel}: el nombre sale de verdad`,
      !hueco(r[papel]?.name),
      JSON.stringify(r[papel]?.name)
    );
  }
  comprobar(
    `${modo}: lo escrito a mano no se pisa`,
    ["combo", "basico"].every(
      (papel) =>
        hueco(oferta?.[papel]?.name) ||
        r[papel]?.name === oferta[papel].name
    ),
    `${JSON.stringify(r.combo?.name)} / ${JSON.stringify(r.basico?.name)}`
  );
}

// ── 4. Y se aplica donde todos lo leen ───────────────────────────────────────
console.log("");
comprobar(
  "se resuelve en la fuente única de la oferta",
  (config.match(/return conLosNombresDelContenido\(/g) ?? []).length === 3,
  "las tres modalidades"
);

console.log(
  fallos === 0
    ? "\nTODO OK — el nombre se escribe una vez y ningún `<<hueco>>` llega al cliente"
    : `\n${fallos} comprobacion(es) mal.`
);
process.exit(fallos === 0 ? 0 : 1);
