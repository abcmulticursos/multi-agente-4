// La lista de comodines era tan larga que elegir en ella era adivinar.
//
// Al escribir {{ salian 39 de 44 en casi cualquier modalidad, con parejas que
// hacian exactamente lo mismo y con otros que en esa modalidad no significaban
// nada. Ofrecer un comodin donde no tiene con que llenarse es invitar a
// escribirlo: el dia que sale al cliente sale VACIO, y la frase se queda a
// medias sin que nadie lo note.
//
// LA REGLA QUE VIGILA ESTA PRUEBA
//
// Purgar es quitar de la LISTA, nunca del MOTOR. Un comodin oculto sigue
// resolviendose igual de bien si ya esta escrito en una burbuja: hay cientos de
// textos vendiendo ahora mismo con estos nombres. Lo unico que cambia es que
// deja de proponerse para textos nuevos.
//
// Por eso la segunda mitad de esta prueba comprueba, uno por uno, que cada
// comodin oculto SIGUE en el motor. Si alguien lo borrara de ahi "para
// terminar la limpieza", esta prueba falla.
//
//   node scripts/prueba-comodines-por-modalidad.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");

const editor = leer("src", "app", "editor", "page.tsx");
const config = leer("src", "lib", "workflow", "config.ts");
const engine = leer("src", "lib", "workflow", "engine.ts");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// ── 1. El catalogo sabe ocultar ────────────────────────────────────────────
comprobar(
  "el catalogo admite comodines ocultos",
  /oculto\?: boolean;/.test(editor),
  "campo oculto"
);
comprobar(
  // Al filtro de ocultos se le sumo despues el de los nombres de producto que
  // no son de esta modalidad; por eso se comprueba la condicion, no la linea.
  "el selector no ofrece los ocultos",
  /const visibles = BASE_PLACEHOLDER_OPTIONS\.filter\([\s\S]{0,60}!option\.oculto/.test(
    editor
  ),
  "filtrados"
);
comprobar(
  "la lista de Ajustes tampoco los muestra",
  /BASE_PLACEHOLDER_OPTIONS\.filter\(\(option\) => !option\.oculto\)\.map/.test(
    editor
  ),
  "misma regla en los dos sitios"
);

// ── 2. Los ocho que se ocultaron ───────────────────────────────────────────
const OCULTOS = [
  "{{MONEDA}}",
  "{{CURRENCY}}",
  "{{METODOS_DE_PAGO_POR_PAIS}}",
  "{{PRECIO_SEGUN_ELECCION}}",
  "{{PRECIO_PRE_ELECCION}}",
  "{{PRECIO_1_MINUSCULAS}}",
  "{{PRECIO_2_MINUSCULAS}}",
  "{{PRECIO_EXTRA_MINUSCULAS}}",
];
for (const token of OCULTOS) {
  const patron = new RegExp(
    `token: "${token.replace(/[{}]/g, "\\$&")}",\\s*\\r?\\n\\s*oculto: true,`
  );
  comprobar(`${token} ya no se ofrece`, patron.test(editor), "oculto");
}

// ── 3. Y SIGUEN FUNCIONANDO EN EL MOTOR (lo que protege las ventas) ────────
const RESOLUTORES = [
  ["{{MONEDA}}", /moneda\|simbolo|\bmoneda\b/i, engine],
  ["{{CURRENCY}}", /currency\|moneda_iso|\bcurrency\b/i, engine],
  ["{{METODOS_DE_PAGO_POR_PAIS}}", /metodos_de_pago_por_pais/i, engine],
  ["{{PRECIO_SEGUN_ELECCION}}", /precio_segun_eleccion/i, config],
  ["{{PRECIO_PRE_ELECCION}}", /precio_pre_eleccion/i, config],
  ["{{PRECIO_1_MINUSCULAS}}", /precio_1_minusculas/i, config],
  ["{{PRECIO_2_MINUSCULAS}}", /precio_2_minusculas/i, config],
  ["{{PRECIO_EXTRA_MINUSCULAS}}", /precio_extra_minusculas/i, config],
];
for (const [token, patron, archivo] of RESOLUTORES) {
  comprobar(
    `${token} sigue resolviendose`,
    patron.test(archivo),
    "el motor lo entiende"
  );
}

// ── 4. Cada modalidad ve lo suyo ───────────────────────────────────────────
comprobar(
  "Lineal no ve los de dos opciones ni el tercer producto",
  /mode === "lineal"[\s\S]{0,220}!SOLO_DOS_OPCIONES\.test[\s\S]{0,120}!SOLO_CON_UPSELL\.test/.test(
    editor
  ),
  "filtro doble"
);
comprobar(
  // Antes se escondian en la modalidad que se llama Upsell, y habia que
  // escribir el precio del tercer producto a mano.
  "Upsell SI ve los del tercer producto",
  /mode === "upsell"\s*\?\s*visibles\.filter\(\(option\) => !SOLO_DOS_OPCIONES\.test\(option\.token\)\)/.test(
    editor
  ),
  "destapados"
);
comprobar(
  "los de eleccion y montos son de dos opciones",
  /SOLO_DOS_OPCIONES[\s\S]{0,400}OPCION_ELEGIDA[\s\S]{0,120}MONTO_ABONADO/.test(
    editor
  ),
  "clasificados"
);
comprobar(
  "Doble Oferta + Upsell sigue sin los alias de Order Bump",
  /mode === "doble_oferta_upsell"[\s\S]{0,160}!SOLO_ORDER_BUMP\.test/.test(editor),
  "intacto"
);

console.log(
  fallos === 0
    ? "\nTODO OK — la lista se acorto y el motor sigue entendiendolo todo"
    : `\n${fallos} FALLA(S)`
);
process.exit(fallos === 0 ? 0 : 1);
