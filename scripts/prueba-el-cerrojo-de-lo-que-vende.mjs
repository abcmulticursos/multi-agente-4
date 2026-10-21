// «Vendo papa y se guarda camote».
//
// EL FALLO
//
//   Cada modalidad guarda SU trozo, pero los campos de arriba —la intro, el
//   nombre del producto, la galeria, el regalo…— son compartidos. Cuando la
//   modalidad que VENDE no tiene su propio trozo de un campo, el guardado lo
//   rellenaba con lo que hubiera en pantalla: o sea, con lo de la modalidad que
//   estabas EDITANDO.
//
//   Caso real que lo destapo: «doble_oferta_upsell» —la que vende— no tiene
//   intro propia guardada. Abrir Order Bump, cambiar dos textos y dar a Guardar
//   le cambiaba la intro a los clientes. Sin aviso.
//
// EL CERROJO
//
//   No arregla cada camino: los PARA todos. Antes de mandar, compara lo que se
//   va a escribir contra lo que hay EN EL ARCHIVO. Si algo de lo que el bot dice
//   iba a cambiar mientras editas otra modalidad, se detiene y lo explica.
//
//   Se hace asi a proposito: si mañana aparece un camino que nadie vio, el
//   cerrojo lo para igual. Es la diferencia entre «arregle lo que se» y «no
//   puede pasar».
//
// LO QUE VIGILA ESTA PRUEBA
//
//   1. La referencia es EL ARCHIVO, no la pantalla: se guarda antes de mezclar.
//   2. Solo actua cuando editas una modalidad distinta de la que vende.
//   3. Cubre lo que el bot DICE, y no se mete con lo que es global a proposito.
//   4. No deja al operador atascado: se ofrece a guardar lo suyo dejando intacta
//      la que vende.
//   5. La referencia se pone al dia tras guardar, o saltaria en el guardado
//      siguiente por un cambio que el mismo acaba de hacer.
//   6. Aviso del estado real: que capas tienen huecos hoy.
//
//   node scripts/prueba-el-cerrojo-de-lo-que-vende.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");
const editor = leer("src", "app", "editor", "page.tsx");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 60)} ${valor}`);
};

// ── 1. La referencia es el archivo, no la pantalla ───────────────────────────
comprobar(
  "existe la copia intacta del archivo",
  /const archivoEnDisco = useRef<FullConfig \| null>\(null\);/.test(editor),
  "archivoEnDisco"
);
// Si se guardara DESPUES de applyTemplate, la referencia ya seria «lo que estoy
// mirando» —la capa que se edita mezclada con los campos de arriba— y el
// cerrojo compararia contra si mismo: no saltaria nunca.
const carga = editor.slice(
  editor.indexOf("const runtime = runtimeModality(loaded);"),
  editor.indexOf("hydrated.editor_mode = active;")
);
comprobar(
  "se copia ANTES de mezclar la capa",
  carga.indexOf("archivoEnDisco.current") <
    carga.indexOf("applyTemplate(loaded, activeTpl, active)"),
  "si no, se compararia contra si mismo"
);

// ── 2. Solo cuando editas otra modalidad ─────────────────────────────────────
const cerrojo = (() => {
  const i = editor.indexOf("// EL CERROJO: EDITAR UNA MODALIDAD NO PUEDE CAMBIAR");
  const f = editor.indexOf("// EL SEGURO CONTRA EL VACIADO EN SILENCIO.", i);
  return i < 0 || f < 0 ? "" : editor.slice(i, f);
})();
comprobar("se encuentra el cerrojo", cerrojo.length > 0, `${cerrojo.length} car.`);
comprobar(
  "solo actua si editas otra modalidad",
  /if \(_editingMode !== _runtimeMode && archivoEnDisco\.current\)/.test(cerrojo),
  "editando == vendiendo -> no molesta"
);
comprobar(
  "compara contra el archivo, campo a campo",
  /JSON\.stringify\(antes\[campo\] \?\? null\) !==\s*JSON\.stringify\(ahora\[campo\] \?\? null\)/.test(
    cerrojo
  ),
  "antes vs ahora"
);
// EL CERROJO MIRA EXACTAMENTE LO MISMO QUE ARREGLA.
//
// Si mirase mas, saltaria sin motivo: los campos que la modalidad que vende SI
// tiene suyos salen de su capa —que es lo correcto— y si el archivo tuviera otra
// cosa los veria distintos. Y peor: al aceptar los devolvia al valor del
// archivo, conservando lo viejo en vez de dejar que la modalidad escriba lo
// suyo. Le paso al operador el 7 de septiembre de 2026.
const vecesQueMiraHuecos = (cerrojo.match(/esUnHueco\(campo\)/g) ?? []).length;
comprobar(
  "el cerrojo vigila lo mismo que arregla: los huecos",
  vecesQueMiraHuecos >= 3,
  `${vecesQueMiraHuecos} sitios (arreglo, arreglo al aceptar, comparacion)`
);

// ── 3. La lista NO se puede quedar corta ─────────────────────────────────────
//
// AQUI ESTA LA GARANTIA DE VERDAD, y no en enumerar campos a mano.
//
// Se sacan del PROPIO GUARDADO todos los campos que heredan —los que se
// escriben como `_activeTpl.X ?? cfg.X`, que es el patron que causaba la fuga—
// y se comprueba que TODOS estan protegidos. Si mañana alguien añade un campo
// nuevo con ese patron y no lo mete en la lista, esta prueba se pone roja.
//
// Es la diferencia entre «protegi los que se me ocurrieron» y «no puede quedar
// ninguno fuera».
const lista = (() => {
  const i = editor.indexOf("const LO_QUE_DICE_EL_BOT: [string, string][] = [");
  const f = editor.indexOf("];", i);
  return i < 0 || f < 0 ? "" : editor.slice(i, f);
})();
comprobar("existe la lista de campos protegidos", lista.length > 0, "LO_QUE_DICE_EL_BOT");
const protegidos = new Set(
  [...lista.matchAll(/\["(\w+)",/g)].map((m) => m[1])
);

// SOLO LO QUE DE VERDAD SE MANDA.
//
// Antes esto miraba la funcion de guardar ENTERA, y ahi hay calculos que no
// llegan al archivo. Por eso «image_gallery_2» aparecia como fuga sin serlo: se
// usa para calcular los temas de informacion, pero al archivo va como
// `_supportsSecondProduct ? (_activeTpl.image_gallery_2 ?? []) : []`, sin caer
// nunca a la pantalla. Protegerlo hacia daño — impedia que una modalidad sin
// segundo producto lo dejara vacio.
const guardado = (() => {
  const i = editor.indexOf("const clean: FullConfig = {");
  const f = editor.indexOf("\n      };", i);
  return i < 0 || f < 0 ? "" : editor.slice(i, f);
})();
comprobar("se encuentra lo que se manda", guardado.length > 0, `${guardado.length} car.`);
// El patron de la fuga: el campo cae al valor de la pantalla. Se miran tambien
// las variables que se calculan justo antes y se usan dentro (`_bioferta`,
// `_orderBump`, `_dobleOfertaDos`, `_productInfoTopics`).
const antesDelPayload = (() => {
  const i = editor.indexOf("const _bioferta = _activeTpl.bioferta");
  const f = editor.indexOf("const clean: FullConfig = {", i);
  return i < 0 || f < 0 ? "" : editor.slice(i, f);
})();
const heredan = [
  ...new Set(
    [...(guardado + antesDelPayload).matchAll(/_activeTpl\.(\w+)\s*\?\?\s*cfg\.\1\b/g)].map(
      (m) => m[1]
    )
  ),
];
comprobar(
  "se detectan los campos que heredan",
  heredan.length > 0,
  `${heredan.length} campos`
);
// La unica excepcion, y con motivo: «image_gallery_2» aparece con ese patron
// SOLO dentro del calculo de los temas de informacion. Al archivo va como
// `_supportsSecondProduct ? (_activeTpl.image_gallery_2 ?? []) : []`, sin caer
// nunca a la pantalla. Protegerlo impedia que una modalidad sin segundo
// producto lo dejara vacio.
const NO_LLEGA_AL_ARCHIVO = new Set(["image_gallery_2"]);
comprobar(
  "la excepcion sigue sin llegar al archivo",
  /image_gallery_2: _supportsSecondProduct\s*\r?\n\s*\? \(_activeTpl\.image_gallery_2 \?\? \[\]\)/.test(
    guardado
  ),
  "se escribe sin caer a la pantalla"
);
const sinProteger = heredan.filter(
  (campo) => !protegidos.has(campo) && !NO_LLEGA_AL_ARCHIVO.has(campo)
);
comprobar(
  "TODOS los que heredan estan protegidos",
  sinProteger.length === 0,
  sinProteger.length ? `SIN PROTEGER: ${sinProteger.join(", ")}` : "ninguno fuera"
);
// El caso anidado: la postventa vive dentro del cerebro, asi que no se puede
// comparar como campo de arriba y se trata aparte. Sin esto se heredaba igual.
// La postventa hereda por OTRO camino: no se escribe en el guardado, la mete
// `applyTemplate` dentro de `prompt_sections`. Como va anidada no se puede
// comparar como campo de arriba, asi que se trata aparte.
comprobar(
  "la postventa, que va anidada, tambien se protege",
  /postventa: t\.postventa \?\? c\.prompt_sections\.postventa/.test(editor) &&
    /const POSTVENTA_HEREDA = \["prompt_sections", "postventa"\]/.test(editor) &&
    /cajaAhora\[dentro\] = JSON\.parse/.test(cerrojo),
  "prompt_sections.postventa"
);

// Y NO se mete con lo que es global a proposito: si vigilara esto, cambiar un
// pais o el color de un boton saltaria el cerrojo sin motivo.
for (const campo of [
  "payment_profiles_by_country",
  "country_sales_enabled",
  "editor_colores_de_botones",
  "modality_templates",
]) {
  comprobar(
    `NO se mete con «${campo}»`,
    !protegidos.has(campo),
    "es global a proposito"
  );
}

// ── 3-bis. Primero arregla, y solo si falla, para ────────────────────────────
comprobar(
  "editando otra modalidad, esos campos se dejan como en el archivo",
  /PRIMERO SE ARREGLA, Y SOLO SI FALLA SE PARA/.test(cerrojo) &&
    /if \(esUnHueco\(campo\)\) devolverAlArchivo\(campo\)/.test(cerrojo),
  "el hueco deja de rellenarse con el vecino"
);
// SOLO SUS HUECOS. Si se devolvieran TODOS los campos al estado del archivo,
// activar una modalidad a proposito no podria cambiar nada: se guardaria el
// interruptor y el contenido se quedaria en el de la anterior.
comprobar(
  "solo se devuelven los HUECOS, no lo que si es suyo",
  /const esUnHueco = \(campo: string\): boolean =>/.test(cerrojo) &&
    /esUnHueco\(campo\) &&/.test(cerrojo),
  "activar a proposito sigue funcionando"
);
// EL INTERRUPTOR NO SE DEVUELVE.
//
// Al proteger un hueco se le devuelve el contenido del archivo. En las secciones
// de oferta, contenido e interruptor viven juntos — y el interruptor es lo unico
// que el operador acaba de cambiar al activar una modalidad. Devolverlo entero
// deshacia la activacion en silencio: decias «vende Order Bump», guardabas, y
// seguia vendiendo lo de antes.
comprobar(
  "las secciones con interruptor conservan el suyo",
  /const SECCIONES_CON_INTERRUPTOR = \[/.test(editor) &&
    /enabled: actual\?\.enabled,/.test(cerrojo),
  "activar no se deshace solo"
);
for (const seccion of ["order_bump", "bioferta", "doble_oferta_dos"]) {
  comprobar(
    `«${seccion}» esta entre las que conservan interruptor`,
    new RegExp(`"${seccion}",`).test(
      editor.slice(
        editor.indexOf("const SECCIONES_CON_INTERRUPTOR = ["),
        editor.indexOf("] as const;", editor.indexOf("const SECCIONES_CON_INTERRUPTOR = ["))
      )
    ),
    "lleva enabled dentro"
  );
}
// Y el que NO debe estar protegido, porque no cae nunca a la pantalla.
comprobar(
  "«image_gallery_2» NO se protege",
  !protegidos.has("image_gallery_2"),
  "protegerlo impedia dejarlo vacio"
);

// Doble Oferta + Upsell no saca sus dos opciones de su seccion: las copia de
// `doble_oferta_dos` al guardar. Si esa es un hueco, la copia salia de la
// pantalla — y restaurar `doble_oferta_dos` despues no arregla nada, porque la
// copia ya se hizo.
comprobar(
  "Doble Oferta + Upsell se mira aparte, por como se arma",
  /if \(esUnHueco\("doble_oferta_dos"\)\)/.test(cerrojo) &&
    /enabled: douAhora\.enabled/.test(cerrojo),
  "sin tocarle el interruptor"
);

// ── 3-ter. Activar una modalidad tampoco mezcla ──────────────────────────────
//
// Era la fuga en el sentido contrario: al activar, el editor volvia a pintar la
// modalidad que estabas editando y le rellenaba los huecos con los de la que
// acababas de activar. No llegaba a clientes, pero era mezcla igual.
// El final del bloque es la ultima linea de la funcion. Antes se buscaba el
// texto de un aviso que ya no existe: activar ahora deja el cambio pendiente
// para guardarlo y recargar, en vez de avisar de que habra que guardarlo a mano.
const activar = (() => {
  const i = editor.indexOf("const activateRuntimeModalidad = (newMode: Modo): void => {");
  const f = editor.indexOf("setPendienteDeActivar(newMode);", i);
  return i < 0 || f < 0 ? "" : editor.slice(i, f);
})();
comprobar("se encuentra el activar", activar.length > 0, `${activar.length} car.`);
comprobar(
  "activar ya no rehace la pantalla",
  !/applyTemplate\(/.test(activar),
  "solo mueve el interruptor"
);
comprobar(
  "y las dos opciones salen de SU capa, no de la pantalla",
  /templates\[newMode\]\?\.doble_oferta_dos \?\? cfg\.doble_oferta_dos/.test(activar),
  "no se pegan los productos de otra"
);

const IMPRESCINDIBLES = [
  "intro_sequence", "intro_sequence_2", "intro_sequence_3",
  "intro_extra_sequences", "intro_enabled", "greeting", "followups",
  "product_name", "course_content", "image_gallery", "payment_approved",
  "gift", "email", "detail_gallery", "offer",
];

// ── 4. No deja atascado: se ofrece a arreglarlo ──────────────────────────────
comprobar(
  "ofrece guardar lo tuyo sin tocar la que vende",
  /window\.confirm\(/.test(cerrojo) &&
    (cerrojo.match(/if \(esUnHueco\(campo\)\) devolverAlArchivo\(campo\)/g) ?? [])
      .length === 2,
  "devuelve esos campos a como estan"
);
// Y ahora ademas lo DICE: el guardado devuelve si llego a completarse, para que
// nadie encadene una recarga detras de una cancelacion y le borre de la pantalla
// justo lo que acaba de decidir no guardar.
comprobar(
  "y cancelar no guarda nada",
  /if \(!seguir\) \{[\s\S]{0,220}return false;/.test(cerrojo),
  "sin efectos"
);

// ── 5. La referencia se pone al dia ──────────────────────────────────────────
comprobar(
  "tras guardar, la referencia pasa a ser lo guardado",
  /archivoEnDisco\.current = JSON\.parse\(\s*JSON\.stringify\(clean\)\s*\)/.test(
    editor
  ),
  "si no, saltaria en el siguiente guardado"
);

// ── 6. El estado real de hoy, como aviso ─────────────────────────────────────
const cfg = YAML.parse(leer("config", "intro-data.yaml"));
const capas = cfg.modality_templates ?? {};
const runtime = cfg.doble_oferta_upsell?.enabled
  ? "doble_oferta_upsell"
  : cfg.upsell?.enabled
    ? "upsell"
    : cfg.doble_oferta_dos?.enabled
      ? "doble_oferta_dos"
      : cfg.order_bump?.enabled
        ? "order_bump"
        : cfg.bioferta_doble?.enabled
          ? "bioferta"
          : "lineal";
console.log(`\n--- huecos de hoy (vende: ${runtime}) ---`);
for (const [nombre, capa] of Object.entries(capas)) {
  const faltan = IMPRESCINDIBLES.filter(
    (campo) => !Object.prototype.hasOwnProperty.call(capa ?? {}, campo)
  );
  const marca = nombre === runtime ? "  <-- LA QUE VENDE" : "";
  console.log(
    `     ${pad(nombre, 22)} ${faltan.length ? `sin lo suyo: ${faltan.join(", ")}` : "completa"}${marca}`
  );
}
const faltanEnLaQueVende = IMPRESCINDIBLES.filter(
  (campo) => !Object.prototype.hasOwnProperty.call(capas[runtime] ?? {}, campo)
);
console.log(
  faltanEnLaQueVende.length
    ? `\nAVISO la modalidad que vende tiene ${faltanEnLaQueVende.length} hueco(s).\n` +
        "      No es un fallo del codigo: el cerrojo los cubre. Se quitan solos\n" +
        "      cuando edites esos campos DENTRO de esa modalidad y guardes."
    : "\nok    la modalidad que vende tiene todo lo suyo"
);

console.log(
  `\n${fallos === 0 ? "TODO OK — editar una modalidad no puede cambiar la que vende" : `${fallos} FALLOS`}`
);
process.exit(fallos === 0 ? 0 : 1);
