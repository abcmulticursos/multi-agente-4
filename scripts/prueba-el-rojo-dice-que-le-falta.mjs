// EL ROJO DICE QUE LE FALTA, Y AVISA ANTES DE VENDER — SIN IMPEDIR GUARDAR.
//
// LO QUE PASO — 25 de septiembre de 2026. El dueno vendio, el cliente pago y no
// recibio nada: la ficha del producto que estaba vendiendo tenia la entrega
// vacia. El bot hizo lo correcto —pararse en vez de mandar el material de otro
// producto— pero de eso uno se entera con alguien esperando al otro lado:
//
//     [wf:pago] convo 137 APROBADO (total: S/. 10 Soles)
//     [wf:pago] convo 137: PAGO y no hay entrega que mandar (la opcion Basico)
//
// Y EL AVISO QUE HABIA NO SERVIA PARA ESO: enumeraba los paises sin precio, dos
// renglones enteros, y callaba lo unico que deja a un cliente sin su compra.
// Con sus palabras: «retiralas y deja esto: SIN PRECIOS, SIN ENLACE, en color
// rojo mayusculas; si yo veo que esta en rojo, reviso».
//
// LO QUE SE HIZO, en sus tres sitios:
//
//   1. EN LA LISTA DE PRODUCTOS — tres etiquetas cortas, rojas y en mayusculas:
//      SIN CONTENIDO, SIN PRECIO, SIN ENLACE DE ENTREGA.
//   2. EN EL SELECTOR — al sentar un producto al que le falta algo, se pregunta
//      «¿deseas venderlo asi?». NO en el complementario: no se vende suelto, y
//      el propio dueno lo dijo: «complementario no se vende, es el complemento».
//   3. AL GUARDAR — se nombran los que estan vendiendo con algo sin completar.
//      AVISA, NO IMPIDE: un editor que no deja guardar obliga a inventarse un
//      precio para poder salir, y ese precio falso acaba cobrandose.
//
// LO QUE NO PUEDE ROMPERSE:
//
//   · UNA SOLA LECTURA para los tres sitios. Tres copias de «que le falta»
//     acaban discrepando, y el dia que discrepen la pantalla dira una cosa y el
//     bot hara otra.
//   · EL PRECIO SOLO SE LE PIDE A QUIEN COBRA. La regla ya estaba y se conserva:
//     se pregunta por el DATO —¿este puesto cobra?— con la misma tabla que
//     decide de donde sale el precio, no por una lista de nombres.
//   · Y GUARDAR SIGUE SIENDO POSIBLE SIEMPRE.
//
//   node scripts/prueba-el-rojo-dice-que-le-falta.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const editor = readFileSync(join(RAIZ, "src", "app", "editor", "page.tsx"), "utf8");

let fallos = 0;
const comprobar = (titulo, ok, nota = "") => {
  if (!ok) fallos++;
  console.log(
    `${ok ? "ok   " : "FALLA"} ${titulo.padEnd(54).slice(0, 54)} ${nota}`
  );
};

const trozo = (desde, hasta) => {
  const i = editor.indexOf(desde);
  if (i < 0) return "";
  const f = editor.indexOf(hasta, i);
  return f < 0 ? editor.slice(i) : editor.slice(i, f);
};

// -- 1. LAS TRES ETIQUETAS, CON SUS PALABRAS --------------------------------
console.log("-- 1. las tres etiquetas ---------------------------------");
comprobar(
  "SIN CONTENIDO",
  /const FALTA_CONTENIDO = "SIN CONTENIDO";/.test(editor),
  "en mayusculas"
);
comprobar(
  "SIN PRECIO",
  /const FALTA_PRECIO = "SIN PRECIO";/.test(editor),
  "en mayusculas"
);
comprobar(
  "SIN ENLACE DE ENTREGA",
  /const FALTA_ENTREGA = "SIN ENLACE DE ENTREGA";/.test(editor),
  "la que costo la venta"
);
comprobar(
  "y se pintan en rojo",
  /text-red-700/.test(
    trozo("const faltas = lasFaltasDelProducto(", "})()}")
  ),
  "se ve sin abrir nada"
);

// -- 2. UNA SOLA LECTURA PARA LOS TRES SITIOS -------------------------------
console.log("\n-- 2. una sola lectura, tres sitios ----------------------");
const laFuncion = trozo(
  "function lasFaltasDelProducto(",
  "\n/** Las mismas faltas"
);
comprobar(
  "existe y decide las tres",
  /faltas\.push\(FALTA_CONTENIDO\)/.test(laFuncion) &&
    /faltas\.push\(FALTA_PRECIO\)/.test(laFuncion) &&
    /faltas\.push\(FALTA_ENTREGA\)/.test(laFuncion),
  "un solo sitio"
);
comprobar(
  "la usan los tres: lista, selector y guardado",
  (editor.match(/lasFaltasDelProducto\(/g) ?? []).length >= 4,
  "definicion + tres usos"
);
comprobar(
  "la entrega apagada cuenta como vacia",
  /\(producto\.delivery \?\? \[\]\)\.filter\(\(p\) => p\.enabled !== false\)\.length === 0/.test(
    laFuncion
  ),
  "igual que la lectura de al lado"
);

// -- 3. EL PRECIO SOLO A QUIEN COBRA ----------------------------------------
//
// La regla ya estaba por un aviso que mentia: el complementario no tiene precio
// propio, asi que pedirselo ensena a ignorar todos los demas avisos.
console.log("\n-- 3. el precio solo se le pide a quien cobra ------------");
comprobar(
  "se pregunta por el dato, no por el nombre del puesto",
  /if \(!puesto \|\| campoDePrecioDelPapel\(puesto\) !== null\) \{/.test(
    laFuncion
  ),
  "la misma tabla que el precio"
);
// EL LISTON NO ES EL MISMO PARA EL QUE VENDE Y PARA EL QUE ESPERA. Al sentado se
// le exige el precio en TODOS los paises encendidos; al guardado, solo que tenga
// alguno. Medido con la configuracion del dueno: con el liston alto, 8 de sus 12
// productos salian en rojo — y un rojo que sale siempre es el aviso que se
// aprende a no mirar, que es la queja que empezo todo esto.
comprobar(
  "al sentado se le exige en todos los paises",
  /puesto\s*\r?\n?\s*\? precios\.some\(\(f\) => f\.precio <= 0\)/.test(laFuncion),
  "el que cobra hoy"
);
comprobar(
  "y al guardado solo que tenga alguno",
  /: precios\.every\(\(f\) => f\.precio <= 0\);/.test(laFuncion),
  "sin llenar la pantalla de rojo"
);

// -- 4. EL SELECTOR PREGUNTA, Y NO EN EL COMPLEMENTARIO ---------------------
console.log("\n-- 4. el selector pregunta antes de sentarlo -------------");
const elPoner = trozo(
  "  const poner = (puesto: PuestoDeProducto, id: string) => {",
  "    const siguiente = { ...alineacion };"
);
comprobar(
  "pregunta solo si el puesto cobra",
  /campoDePrecioDelPapel\(puesto\) !== null/.test(elPoner),
  "el complementario no pregunta"
);
comprobar(
  "y solo si de verdad le falta algo",
  /faltas\.length > 0 &&/.test(elPoner),
  "sin faltas no molesta"
);
comprobar(
  "la pregunta es «¿deseas venderlo asi?»",
  /¿Deseas venderlo así\?/.test(elPoner),
  "sus palabras"
);
comprobar(
  "cancelar NO lo sienta",
  /\) \{\s*\r?\n\s*return;\s*\r?\n\s*\}/.test(elPoner),
  "y aceptar lo sienta igual"
);

// -- 5. AL GUARDAR AVISA, PERO NO IMPIDE ------------------------------------
console.log("\n-- 5. al guardar avisa, no impide ------------------------");
const elGuardado = trozo(
  "  async function save(): Promise<boolean> {",
  "    if (document.activeElement instanceof HTMLElement) {"
);
comprobar(
  "mira lo que esta vendiendo ahora mismo",
  /const faltan = loQueFaltaAntesDeGuardar\(cfg\);/.test(elGuardado),
  "solo los puestos que venden"
);
comprobar(
  "nombra el enlace de entrega",
  /Sin enlace de entrega, quien pague no recibe nada\./.test(elGuardado),
  "lo que costo la venta"
);
comprobar(
  "pregunta «¿deseas guardarlo asi?»",
  /¿Deseas guardarlo así\?/.test(elGuardado),
  "sus palabras"
);
comprobar(
  "y aceptando se guarda: solo cancela si dice que no",
  /!window\.confirm\(/.test(elGuardado) && /return false;/.test(elGuardado),
  "nunca es una limitante"
);

const elResumen = trozo(
  "function loQueFaltaAntesDeGuardar(",
  "\n\n/**"
);
comprobar(
  "el complementario se queda fuera tambien aqui",
  /if \(campoDePrecioDelPapel\(puesto\) === null\) continue;/.test(elResumen),
  "no se vende suelto"
);
comprobar(
  "y no repite un producto sentado en dos puestos",
  /vistos\.has\(id\)/.test(elResumen),
  "una linea por producto"
);

// -- 6. Y EL AVISO VIEJO YA NO ESTA -----------------------------------------
console.log("\n-- 6. el aviso viejo se retiro --------------------------");
comprobar(
  "ya no enumera los paises sin precio",
  !/Sin precio en\{" "\}/.test(editor),
  "ocupaba dos renglones"
);

// -- 7. Y NO PIDE PRECIO PARA UN PAIS AL QUE NO SE VENDE --------------------
//
// LO QUE PASO — 26/09/2026. El dueno abrio la lista y los TRES productos que
// estaban vendiendo salian «SIN PRECIO» teniendo sus precios puestos. Medido con
// su configuracion: a los tres «les faltaban» CR, CL, SV y VE.
//
// El editor conoce once paises; el tenia tres encendidos, cuatro apagados a mano
// y cuatro que NUNCA toco. La pregunta era `!== false`, asi que esos cuatro
// contaban como encendidos y el rojo salia siempre. Y no vende ahi: con la lista
// blanca puesta, el motor le niega la venta a un pais sin perfil.
//
// SE EJECUTA la funcion del editor, no se lee: es la unica forma de saber que
// contesta lo mismo que el motor.
console.log("\n-- 7. solo los paises donde de verdad se vende -----------");
const laPuerta = trozo(
  "function laVentaEstaAbiertaEnElPais(",
  "function preciosDelPapel("
)
  .replace("cfg: FullConfig,", "cfg,")
  .replace("country: CountryCode", "country")
  .replace("): boolean {", ") {");
const laVentaEstaAbiertaEnElPais = new Function(
  "const activeModality = (c) => c.modo_de_prueba ?? 'lineal';\n" +
    laPuerta +
    "\nreturn laVentaEstaAbiertaEnElPais;"
)();

// La forma de su configuracion, con nombres neutros: tres encendidos, cuatro
// apagados a mano, y cuatro que nunca existieron.
const conListaBlanca = {
  country_sales_whitelist: true,
  country_sales_enabled: { PE: true, EC: true, AR: true, MX: false, CO: false },
  payment_profiles_by_country: {
    PE: { enabled: true },
    EC: { enabled: true },
    AR: { enabled: true },
    MX: { enabled: false },
    CO: { enabled: false },
  },
};
comprobar(
  "el pais encendido cuenta",
  ["PE", "EC", "AR"].every((c) => laVentaEstaAbiertaEnElPais(conListaBlanca, c)),
  "ahi si se le pide precio"
);
comprobar(
  "el apagado a mano no cuenta",
  ["MX", "CO"].every((c) => !laVentaEstaAbiertaEnElPais(conListaBlanca, c)),
  "como antes"
);
comprobar(
  "EL QUE NUNCA SE TOCO TAMPOCO — el fallo del 26/09",
  ["CR", "CL", "SV", "VE"].every(
    (c) => !laVentaEstaAbiertaEnElPais(conListaBlanca, c)
  ),
  "antes salian los tres productos en rojo"
);

// Sin lista blanca el motor SI vende a un pais sin perfil, y entonces el aviso
// dice la verdad: ahi falta un precio de verdad. Se conserva esa mitad.
const sinListaBlanca = {
  country_sales_enabled: { PE: true, MX: false },
  payment_profiles_by_country: { PE: { enabled: true }, MX: { enabled: false } },
};
comprobar(
  "sin lista blanca, el pais sin perfil SIGUE contando",
  laVentaEstaAbiertaEnElPais(sinListaBlanca, "CR") === true,
  "ahi el motor vende, y el aviso acierta"
);
comprobar(
  "y el apagado sigue fuera",
  laVentaEstaAbiertaEnElPais(sinListaBlanca, "MX") === false,
  "la bandera manda siempre"
);

// LA PARIDAD CON EL MOTOR, que es lo unico que sostiene esto: si la pantalla y
// el motor no contestan igual, uno de los dos miente.
const motor = readFileSync(
  join(RAIZ, "src", "lib", "workflow", "config.ts"),
  "utf8"
);
const laDelMotor = (() => {
  const i = motor.indexOf("export function isCountrySalesEnabled(");
  return i < 0 ? "" : motor.slice(i, motor.indexOf("\n}", i));
})();
comprobar(
  "el motor decide en el mismo orden",
  /country_sales_enabled\?\.\[country\]/.test(laDelMotor) &&
    /if \(typeof flag === "boolean"\) return flag;/.test(laDelMotor) &&
    /if \(profileEnabled === false\) return false;/.test(laDelMotor) &&
    /country_sales_whitelist === true\) return profileEnabled === true;/.test(
      laDelMotor
    ),
  "bandera, perfil, lista blanca"
);
comprobar(
  "y la pantalla pregunta con la copia, no con !== false",
  /laVentaEstaAbiertaEnElPais\(cfg, c\.code\)/.test(editor) &&
    !/\(c\) => cfg\.country_sales_enabled\?\.\[c\.code\] !== false/.test(editor),
  "el filtro viejo ya no esta"
);

console.log(
  fallos === 0
    ? "\nTODO OK — el rojo dice que le falta y avisa antes de vender\n"
    : `\n${fallos} comprobacion(es) mal.\n`
);
process.exit(fallos === 0 ? 0 : 1);
