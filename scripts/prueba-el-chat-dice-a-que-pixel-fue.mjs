// EL CHAT DICE A QUÉ PIXEL FUE CADA EVENTO
//
// LO PIDIO EL DUEÑO — 5 de octubre de 2026, y con sus palabras, que son mejores que las
// mias:
//
//   «En este momento no puedes ver que pixel has elegido, pero yo puedo hacer que en el
//    editor aparezca el codigo del pixel o ID del pixel para que tu puedas elegir el
//    correcto desde la primera conversacion»
//
// EL FALLO QUE ESTO DESTAPA, Y ERA INVISIBLE. Un pixel equivocado NO da error. El pixel no
// es una cerradura: es una direccion. El bot manda la compra a la que tenga escrita la
// tienda, Meta comprueba solo que el token tenga permiso sobre ese pixel, y la ACEPTA.
// Resultado: la compra se guarda en el conjunto de datos de al lado, la campaña —que mira
// el suyo— nunca se entera ni aprende de esa venta, y en sus informes sale cero.
//
// Y EL PANEL DECIA QUE TODO HABIA IDO BIEN, porque para el bot fue bien. Solo hablaba
// cuando algo fallaba. Los dos casos se veian IGUAL:
//
//     pixel correcto     el chat dice que se envio   ✅
//     pixel equivocado   el chat dice que se envio   ✅   <- indistinguible
//
// LA PAGINA SI LLEVA VEREDICTO, Y SALE GRATIS. Meta la valida contra el anuncio del clic y
// rechaza con 2804072 si no coinciden —el dueño vio ese aviso en otro de sus proyectos—. Asi
// que si el evento entro, la pagina era la buena: el propio envio es la prueba.
//
// EL PIXEL NO LLEVA VEREDICTO, Y NO ES PEREZA. «El correcto» es el que el eligio en la
// campaña, y Meta NO publica ese dato para campañas de clic a WhatsApp: se midio el
// 4/10/2026 contra su documentacion y el conjunto de anuncios solo expone `page_id`
// (obligatorio) y `whatsapp_phone_number` (opcional). El ejemplo que publican es literalmente
// {"page_id": "452645324"}. Poner un check aqui seria inventarselo. Se enseña el numero y lo
// juzga el, que si sabe cual eligio.
//
//   node scripts/prueba-el-chat-dice-a-que-pixel-fue.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");
const base = leer("src", "lib", "db.ts");
const envio = leer("src", "lib", "meta", "conversions.ts");
const panel = leer("src", "components", "ConversationPanel.tsx");
const ruta = leer("src", "app", "api", "messages", "[conversationId]", "route.ts");

let fallos = 0;
const comprobar = (titulo, condicion, detalle) => {
  const marca = condicion ? "  ok  " : "> FALLA";
  if (!condicion) fallos++;
  console.log(`${marca} ${String(titulo).padEnd(56)} ${detalle ?? ""}`);
};

// -- 1. LA BASE GUARDA EL DESTINO -------------------------------------------
for (const [que, columna] of [
  ["el pixel", "capi_last_pixel"],
  ["la pagina", "capi_last_pagina"],
  ["la tienda", "capi_last_tienda"],
]) {
  comprobar(
    `la base guarda ${que}`,
    new RegExp(`\\["${columna}", "TEXT"\\]`).test(base),
    columna
  );
}
comprobar(
  "y el UPDATE escribe los tres",
  /SET capi_last_event = \?, capi_last_ok = \?, capi_last_error = \?,\s*\r?\n\s*capi_last_pixel = \?, capi_last_pagina = \?, capi_last_tienda = \?,/.test(
    base
  ),
  "en la misma sentencia"
);

// -- 2. SE ANOTA TAMBIEN CUANDO SALE BIEN -----------------------------------
//
// ES EL PUNTO ENTERO DE ESTE CAMBIO. Si solo se anotara al fallar, el pixel equivocado
// seguiria invisible: justamente no falla.
comprobar(
  "el envio que SALE BIEN anota su destino",
  /registrarEventoCapi\(conversationId, payload\.event_name, true, null, aDondeVa\(\)\)/.test(
    envio
  ),
  "si no, el pixel malo sigue invisible"
);
comprobar(
  "y los que fallan tambien",
  (envio.match(/false, (?:text|motivo), aDondeVa\(\)\)/g) ?? []).length === 2,
  "los dos caminos de error"
);

// -- 3. EL DESTINO SALE DE DONDE DE VERDAD SE SABE --------------------------
//
// El pixel, ya resuelto con el de la tienda por delante. La pagina, tal como VIAJA en el
// evento —no recalculada, que es como se desincronizan las cosas—.
comprobar(
  "el pixel anotado es el que recibio el evento",
  /pixel: pixelId \?\? null/.test(envio),
  "el mismo que resolvio la tienda"
);
comprobar(
  "la pagina anotada es la que viajo en el evento",
  /pagina: typeof ud\?\.page_id === "string" \? ud\.page_id : null/.test(envio),
  "no se recalcula"
);
comprobar(
  "y anotar el destino no puede tumbar un envio",
  /try \{\s*\r?\n\s*tienda = conversationId/.test(envio),
  "la tienda se pregunta dentro de un try"
);

// -- 4. LA API LO MANDA -----------------------------------------------------
//
// El riesgo silencioso: la pantalla lee un campo que la API nunca manda. No da error, no
// sale nada, y parece que el cambio no funciono.
comprobar(
  "la API manda la conversacion entera",
  /conversation: convo/.test(ruta) && /SELECT \* FROM conversations WHERE id/.test(base),
  "los campos nuevos viajan solos"
);

// -- 5. EL CHAT LO ENSEÑA ---------------------------------------------------
comprobar(
  "el chat enseña el chip cuando SI se envio",
  /convo\.capi_last_ok === 1 && convo\.capi_last_pixel/.test(panel),
  "antes aqui no salia nada"
);
comprobar(
  "y enseña el pixel sin recortarlo",
  /break-all[\s\S]{0,120}capi_last_pixel/.test(panel),
  "es largo y hay que compararlo entero"
);
comprobar(
  "la pagina sale como veredicto",
  /Página: coincide con el anuncio/.test(panel),
  "Meta la valido: 2804072 si no"
);
comprobar(
  "la tienda sale, para ver si atendio la correcta",
  /Tienda: \{convo\.capi_last_tienda\}/.test(panel),
  "la otra mitad del mismo fallo"
);
comprobar(
  "y el aviso rojo de siempre sigue en pie",
  /convo\.capi_last_ok === 0 \?/.test(panel) &&
    /No se envió \{convo\.capi_last_event/.test(panel),
  "no se toco lo que ya funcionaba"
);

// -- 6. NINGUN VEREDICTO INVENTADO SOBRE EL PIXEL ---------------------------
//
// EL CENTINELA. Si alguien decide mañana poner un check o una X al pixel, tendra que
// inventarse cual es el correcto, porque Meta no lo dice. Y un veredicto inventado es peor
// que no tener veredicto: el dueño dejaria de mirar el numero.
comprobar(
  "no se juzga el pixel como correcto o incorrecto",
  !/Pixel[^\n]{0,40}(correcto|incorrecto|✖|❌)/.test(panel),
  "Meta no publica cual deberia ser"
);

console.log("");
if (fallos > 0) {
  console.log(`> ${fallos} FALLA(S)`);
  process.exit(1);
}
console.log("TODO OK — el chat dice a que pixel fue, y el dueño puede compararlo");
