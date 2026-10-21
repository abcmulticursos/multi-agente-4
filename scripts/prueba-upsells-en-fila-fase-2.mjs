// UPSELLS EN FILA — FASE 2: SOLO PANTALLA. EL BOT NO LO LEE TODAVIA.
//
// ──── DE DONDE SALE ────────────────────────────────────────────────────────
//
// Lo pidio el 10/10/2026. Ver PLAN-UPSELLS-EN-FILA.md. Su condicion, que manda:
//
//   «Lo que mas me importa es NO TOCAR EL COMPORTAMIENTO, no arruinar el motor de
//    informacion, compra, venta, entrega, cobros… todo eso esta como un reloj».
//
// La fase 2 es la pantalla: la presentacion dentro de la ficha de cada producto y las filas
// de upsells, por tienda. Se guarda, pero el motor no lo lee. ESTA PRUEBA VIGILA SOBRE TODO
// ESO: que ningun archivo del motor nombre los campos nuevos. El dia que la fase 3 los use,
// esta comprobacion se cambia a proposito, no por accidente.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

let fallos = 0;
const pad = (t, n) => (t.length >= n ? t : t + " ".repeat(n - t.length));
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 60)} ${valor}`);
};
const leer = (...ruta) => readFileSync(join(...ruta), "utf8");

console.log("— la fila se lee en un solo sitio —\n");

{
  // FASE 3 (10/10/2026): el motor YA usa la fila. Esta comprobacion se cambio a proposito,
  // como decia su cabecera. La regla nueva: el CONTENIDO de la fila —sus puestos, su
  // downsell, la presentacion de cada producto— se lee SOLO en config.ts, por sus
  // ayudantes (`seccionUpsell`, `siguienteDeLaFila`, `elDownsellQueToca`...). El resto del
  // motor como mucho pregunta si hay alguna fila puesta. Asi la regla de la fila vive en un
  // solo archivo y no se separa en dos.
  const delMotor = [
    ...readdirSync("src/lib/workflow").map((f) => join("src/lib/workflow", f)),
    ...readdirSync("src/lib/meta").map((f) => join("src/lib/meta", f)),
    "src/lib/openrouter.ts",
    "src/lib/system-prompt.ts",
  ].filter((f) => f.endsWith(".ts") && !f.endsWith("config.ts"));
  const quienLaLee = delMotor.filter((f) =>
    /presentacion_upsell|\.puestos\b|\.downsell\??\.|filas_de_upsell\s*\?\?\s*\[|filas_de_upsell\.(find|filter|map)/.test(
      readFileSync(f, "utf8")
    )
  );
  comprobar(
    "el contenido de la fila solo se lee en config.ts",
    quienLaLee.length === 0,
    quienLaLee.join(", ") || "por sus ayudantes"
  );
}

console.log("\n— el guardado no pierde nada —\n");

const ruta = leer("src/app/api/workflow/route.ts");
comprobar(
  "una sola lista de campos para leer y para escribir",
  /function limpiaPresentacionUpsell\(\s*v: unknown,\s*traducir:/.test(ruta) &&
    /function limpiaFilasDeUpsell\(\s*v: unknown,\s*traducir:/.test(ruta),
  "la traduccion se pasa como parametro"
);
// Desde el 10/10/2026 la presentacion lleva tambien cajones de intro, que van por SU
// traductor (el de los cajones del upsell de siempre): readGruposDeIntro / writeGruposDeIntro.
comprobar(
  "al leer, las burbujas y los cajones se traducen para la pantalla",
  /limpiaPresentacionUpsell\(\s*item\?\.presentacion_upsell,\s*pasosParaLaPantalla,\s*readGruposDeIntro\s*\)/.test(ruta) &&
    /limpiaFilasDeUpsell\(config\?\.filas_de_upsell, pasosParaLaPantalla\)/.test(ruta)
);
comprobar(
  "al escribir, se traducen para el motor",
  /limpiaPresentacionUpsell\(\s*producto\?\.presentacion_upsell,\s*pasosParaElArchivo,\s*writeGruposDeIntro\s*\)/.test(ruta) &&
    /limpiaFilasDeUpsell\(body\.filas_de_upsell, pasosParaElArchivo\)/.test(ruta),
  "si no, la burbuja llegaria sin texto"
);
comprobar(
  "la casilla de botones y lo de cada canal sobreviven al guardado",
  /if \(typeof p\.use_buttons === "boolean"\) fuera\.use_buttons = p\.use_buttons;/.test(ruta) &&
    /for \(const canal of \["messenger", "instagram"\]\)/.test(ruta)
);
comprobar(
  "y la pantalla recibe las filas",
  /intro_tiendas,\s*tiendas,\s*filas_de_upsell,/.test(ruta)
);

console.log("\n— la pantalla —\n");

const editor = leer("src/app/editor/page.tsx");
comprobar(
  "la presentacion vive en la ficha del producto",
  /<PresentacionComoUpsellDelProducto/.test(editor) &&
    /parchar\(producto\.id, \{ presentacion_upsell: siguiente \}\)/.test(editor)
);
comprobar(
  "la presentacion tiene la forma de Canales → UPSELL",
  /<CajonesDeIntro[\s\S]{0,400}onGrupos=\{\(intro_groups\) => cambiar\(\{ intro_groups \}\)\}/.test(editor) &&
    /Preguntar con botones/.test(editor) &&
    /<ButtonsPreview\s*prompt=\{textoDeLaPregunta\}/.test(editor),
  "cajones, casilla de botones y su vista previa"
);
comprobar(
  "con pestanas WhatsApp / Messenger / Instagram",
  /pestana\("whatsapp", "WhatsApp"\)[\s\S]{0,120}pestana\("messenger", "Messenger"\)[\s\S]{0,120}pestana\("instagram", "Instagram"\)/.test(editor)
);
comprobar(
  "y su visor dice el nombre y el precio de ESTE producto",
  /preciosDelLlamanteMandan: true,\s*productoUpsellName: producto\.name/.test(editor),
  "no los del upsell de siempre"
);
comprobar(
  "el cajon de intro se copia con el clic derecho y se pega encima o debajo",
  /📥 Pegar debajo/.test(editor) &&
    /onPegarCajonDebajo=\{\s*conPortapapeles\?\.copiado \? \(\) => pegarCajon\(i, "debajo"\) : undefined\s*\}/.test(editor),
  "en otro producto o desde Canales"
);
comprobar(
  "al pegar pide el nombre, como al duplicar, y la copia nace apagada",
  /const pegarCajon = [\s\S]{0,200}nombreParaLaCopia\(copiado\.nombre\)[\s\S]{0,400}name: nombre, enabled: false/.test(editor)
);
comprobar(
  "la oferta de dos opciones no ofrece pegar intros de upsell",
  /const conPortapapeles = portapapeles && lugar !== "order_bump"/.test(editor)
);
comprobar(
  "Messenger e Instagram pueden traer lo de WhatsApp",
  /📥 Traer lo de WhatsApp/.test(editor) && /const traerLoDeWhatsApp = \(\) =>/.test(editor)
);
comprobar(
  "la ficha del producto ensena en que fila juega, solo para mirar",
  /dondeJuegaEnLasFilas\(cfg, producto\.id\)\.map/.test(editor) &&
    /`🛒 En fila · \$\{dondeVende\} · puesto \$\{k \+ 2\}/.test(editor),
  "su tienda y su puesto"
);
comprobar(
  "Quien juega cada puesto ensena la fila, por tienda y posicion, solo para mirar",
  /<FilasEnLaAlineacion cfg=\{cfg\} tienda=\{tiendaDeLaFila\} onIrALaFila=\{onIrALaFila\} \/>/.test(editor) &&
    /tiendaDeLaFila=\{tienda\.id\}/.test(editor) &&
    /goToJourneyEditor\(\{ tab: "upsell", id: "upsell-filas" \}\)/.test(editor),
  "en Contenido todas; en cada tienda, la suya"
);
comprobar(
  "los avisos de la fila salen de una sola regla",
  (editor.match(/loQueLeFaltaEnLaFila\(cfg, producto\)/g) ?? []).length === 2
);
comprobar(
  "las filas estan en el menu Upsell, detras del de hoy",
  /<FilasDeUpsell\s*cfg=\{cfg\}/.test(editor)
);
comprobar(
  "cada fila elige su tienda en la fachada",
  /headerActions=\{\s*<PastillaDeTiendas\s*valor=\{fila\.tiendas\}/.test(editor),
  "la misma pastilla que las intros"
);
comprobar(
  "el upsell de hoy se ensena como el 1, fijo",
  /1\. Upsell de hoy/.test(editor)
);
comprobar(
  "el % del downsell se calcula, no se guarda",
  /const porcentaje =/.test(editor) && !/porcentaje:/.test(ruta)
);
comprobar(
  "las filas viajan al exportar el Upsell",
  /fields: \["upsell", "filas_de_upsell"\]/.test(editor)
);

console.log("");
if (fallos > 0) {
  console.log(`${fallos} FALLA(S)`);
  process.exit(1);
}
console.log("TODO OK — se guarda todo y el bot sigue vendiendo exactamente como hoy");
