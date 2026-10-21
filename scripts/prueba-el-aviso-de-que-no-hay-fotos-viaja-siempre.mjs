// SIN NINGUNA FOTO, EL AVISO VIAJA EN TODOS LOS TURNOS.
//
// LO QUE PASO — 25 de septiembre de 2026, su prueba de tres conversaciones en
// paralelo. Dos veces salio esto:
//
//     [llm:guardarail] convo 142: ofrecio material visual sin galeria; reintento
//
// El modelo ofrecio fotos que no existen, el guardarrail tiro la respuesta y le
// hizo escribirla otra vez. EL CLIENTE NUNCA VIO EL FALLO —el sistema hizo su
// trabajo— pero se pago el borrador tirado: unos 8.000 tokens cada vez, el 12%
// de todo lo que costo esa prueba.
//
// POR QUE NACIA. El aviso que lo prohibe solo viajaba en los turnos que YA
// hablaban de imagenes, y el ofrecimiento nace justo en los OTROS. Sus dos
// casos: «QUE ME VAN a enviar» y «ESTE ES OTRO» — ninguno pide fotos. Llegaba el
// instinto vendedor del modelo y no llegaba la prohibicion.
//
// Y NO PELEA CON NADIE, que es lo que hizo fracasar cuatro intentos de esto en
// septiembre —«en el prompt no se gana una pelea entre ordenes»—: se reviso el
// prompt base y NO hay ninguna orden que le pida ofrecer imagenes. El
// ofrecimiento sale del modelo solo. Esto no le quita el turno a ninguna
// instruccion: le quita una creencia falsa.
//
// LAS CUENTAS, con su propio registro: el aviso cuesta ~45 tokens por llamada y
// evita borradores de ~8.000. En esa prueba habria ahorrado ~16.500 tokens.
//
// LO QUE NO PUEDE ROMPERSE:
//
//   · CON GALERIAS LLENAS NO CAMBIA NADA. El aviso solo aparece cuando no hay ni
//     una muestra en toda la conversacion.
//   · CON EL PRODUCTO OCULTO DEL ORDER BUMP la galeria VISIBLE esta vacia pero
//     las muestras existen para mas tarde. Ahi el aviso sigue viajando solo en
//     los turnos de imagen, como hasta hoy: decirle «no hay nada» seria mentirle.
//     Por eso se pregunta con el `false`, la misma lectura que hace el
//     guardarrail con el que se coordina.
//   · Y EL BOT NO DICE QUE NO TIENE FOTOS. Sin esa frase, el riesgo es cambiar
//     «te muestro imagenes» por «disculpa, no tengo imagenes», que suena peor.
//
//   node scripts/prueba-el-aviso-de-que-no-hay-fotos-viaja-siempre.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const cerebro = readFileSync(join(RAIZ, "src", "lib", "openrouter.ts"), "utf8");

let fallos = 0;
const comprobar = (titulo, ok, nota = "") => {
  if (!ok) fallos++;
  console.log(
    `${ok ? "ok   " : "FALLA"} ${titulo.padEnd(54).slice(0, 54)} ${nota}`
  );
};

const bloque = (() => {
  const i = cerebro.indexOf("const gallery = getImageGallery(orderBumpHidden, convo);");
  const f = cerebro.indexOf("if (gallery.length > 0 && currentTurnNeedsMedia)", i);
  return i < 0 || f < 0 ? "" : cerebro.slice(i, f);
})();

// -- 1. EL AVISO VIAJA SIEMPRE SI NO HAY NI UNA ------------------------------
console.log("-- 1. sin ninguna muestra, el aviso va siempre -----------");
comprobar(
  "se pregunta si hay alguna muestra en la conversacion",
  /const noHayNingunaMuestraEnLaConversacion =\s*\r?\n?\s*getImageGallery\(false, convo\)\.length === 0;/.test(
    bloque
  ),
  "con el false, como el guardarrail"
);
comprobar(
  "y con eso el aviso ya no depende del turno",
  /\(currentTurnNeedsMedia \|\| noHayNingunaMuestraEnLaConversacion\)/.test(
    bloque
  ),
  "antes solo en turnos de imagen"
);
comprobar(
  "el turno de imagen sigue recibiendolo, como siempre",
  /currentTurnNeedsMedia \|\|/.test(bloque),
  "se suma, no sustituye"
);

// -- 2. CON MUESTRAS, NADA CAMBIA -------------------------------------------
//
// El aviso vive dentro de `gallery.length === 0`: con la galeria de este turno
// llena no se llega ni a mirar. Y con el producto oculto del order bump —galeria
// visible vacia pero muestras existentes— manda `currentTurnNeedsMedia`, o sea
// el comportamiento de antes.
console.log("\n-- 2. con muestras, el camino de siempre -----------------");
comprobar(
  "el aviso sigue dentro de «la galeria de este turno esta vacia»",
  /if \(\s*\r?\n?\s*gallery\.length === 0 &&/.test(bloque),
  "con galeria llena no entra"
);
comprobar(
  "y la lista de muestras se inyecta igual que antes",
  /if \(gallery\.length > 0 && currentTurnNeedsMedia\) \{/.test(cerebro),
  "no se toco"
);

// -- 3. Y NO DICE QUE NO TIENE FOTOS ----------------------------------------
console.log("\n-- 3. tampoco anuncia que no tiene -----------------------");
comprobar(
  "la frase esta en el aviso permanente",
  /Do not mention that you have no images either/.test(bloque),
  "estaba solo en el reintento"
);
comprobar(
  "y el guardarrail sigue en pie por si acaso",
  /ofrecio material visual sin galeria; reintento/.test(cerebro),
  "el aviso no lo sustituye"
);

// -- 4. Y SI INSISTE, SE LE QUITA EL PARRAFO — NUNCA A MEDIA FRASE ----------
//
// LO QUE PASO — 25/09/2026, con el aviso permanente YA puesto y la herramienta de
// imagenes YA retirada:
//
//     [llm:guardarail] convo 154: ofrecio material visual sin galeria; reintento
//     [llm:guardarail] convo 154: INSISTE en ofrecer material visual sin galeria
//
// Ofrecio fotos, se le pidio reescribir, y volvio a ofrecerlas. Antes el
// ofrecimiento salia tal cual: el cliente dice «si» y no recibe nada.
//
// POR QUE AHORA SI SE PUEDE CORTAR. Lo que se descarto —con razon— fue cortar A
// CIEGAS: buscar la palabra y partir por el punto anterior dejaba frases
// mutiladas, y eso costo un mensaje cortado en «El pago es unico de *S/». Aqui no
// se parte ninguna frase: se quita el PARRAFO entero, y el corte de parrafo lo
// puso el propio modelo. Es el criterio que ya usa la guarda anti-presion.
//
// SE EJECUTA, no se lee: las dos funciones se traen del archivo.
console.log("\n-- 4. si insiste, se le quita el parrafo ------------------");
const { readFileSync: leer } = await import("node:fs");
const fuente = leer(join(RAIZ, "src", "lib", "openrouter.ts"), "utf8");
const pedazo = (desde, hastaTras) => {
  const i = fuente.indexOf(desde);
  const j = fuente.indexOf(hastaTras, i);
  const k = fuente.indexOf("\n}", j);
  return fuente.slice(i, k + 2);
};
const { laRespuestaOfreceMaterialVisual, elRecorteTodaviaContesta } = new Function(
  (
    pedazo("function normalizeIntentText(", "return") +
    "\n" +
    pedazo("function laRespuestaOfreceMaterialVisual(", "return false;") +
    "\n" +
    pedazo("function elRecorteTodaviaContesta(", ">= 6") +
    "\nreturn { laRespuestaOfreceMaterialVisual, elRecorteTodaviaContesta };"
  )
    .replace(/\(\s*(\w+):[^)]*\)/g, "($1)")
    .replace(/\): (boolean|string)/g, ")")
)();
// El mismo recorte que hace el cerebro, con sus dos candados.
const recortar = (text) => {
  if (!laRespuestaOfreceMaterialVisual(text)) return "nada que quitar";
  const parrafos = text.split(/\n\s*\n/);
  const sin = parrafos
    .filter((p) => !laRespuestaOfreceMaterialVisual(p))
    .join("\n\n")
    .trim();
  return parrafos.length > 1 &&
    sin.length > 0 &&
    elRecorteTodaviaContesta(sin) &&
    !laRespuestaOfreceMaterialVisual(sin)
    ? sin
    : "manda entero";
};
comprobar(
  "el ofrecimiento en su propio parrafo: se quita",
  recortar(
    "El pack incluye los 5 libros y el kit, ideal para trabajar en casa.\n\n¿Te muestro unas fotos del material? 😊"
  ) === "El pack incluye los 5 libros y el kit, ideal para trabajar en casa.",
  "y la respuesta se queda"
);
comprobar(
  "en medio de tres parrafos: tambien",
  recortar(
    "Claro, te explico 😊\n\n¿Quieres que te mande imágenes del contenido?\n\nEl precio es S/. 14 y el pago es único."
  ) === "Claro, te explico 😊\n\nEl precio es S/. 14 y el pago es único.",
  "se quita solo el suyo"
);
comprobar(
  "DENTRO del parrafo que contesta: NO se toca",
  recortar(
    "El pago es único y te muestro fotos del material cuando lo pidas, así ves todo antes de decidir."
  ) === "manda entero",
  "cortar ahi seria mutilar"
);
comprobar(
  "si el ofrecimiento ERA la respuesta: NO se toca",
  recortar("¿Te envío unas fotos? 😊") === "manda entero",
  "un silencio es peor"
);
comprobar(
  "sin ofrecimiento no se mira nada",
  recortar("El pago es único de S/. 14 y el acceso llega al instante.") ===
    "nada que quitar",
  "el camino normal, intacto"
);
comprobar(
  "y «no tengo fotos» no cuenta como ofrecer",
  recortar(
    "No tengo fotos disponibles ahora, pero te cuento todo por escrito 😊\n\n¿Cuál de las dos prefieres?"
  ) === "nada que quitar",
  "la negacion desarma la frase"
);
comprobar(
  "el cerebro hace ese mismo recorte",
  /const sinElOfrecimiento = parrafos\s*\r?\n?\s*\.filter\(\(parrafo\) => !laRespuestaOfreceMaterialVisual\(parrafo\)\)/.test(
    cerebro
  ) && /text = sinElOfrecimiento;/.test(cerebro),
  "y solo cuando ya insistio"
);

console.log(
  fallos === 0
    ? "\nTODO OK — el aviso viaja siempre y no se paga el borrador tirado\n"
    : `\n${fallos} comprobacion(es) mal.\n`
);
process.exit(fallos === 0 ? 0 : 1);
