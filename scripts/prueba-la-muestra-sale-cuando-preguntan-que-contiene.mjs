// «¿Que contiene el curso?» tambien puede traer su muestra, y la del producto
// correcto.
//
// LO QUE PASABA
//
//   El bot YA sabe mandar una muestra por su cuenta: recibe la lista de temas
//   con el «cuando enviarla» que escribe el dueño, decide por contexto y emite
//   <<MEDIA: tema>>. Nada de eso depende de palabras clave.
//
//   Pero delante hay un candado de AHORRO que decide si esa lista se le enseña.
//   Solo se abria con palabras de VER —imagen, foto, muestra, video, ejemplo—,
//   asi que «¿que contiene el curso?» lo dejaba cerrado: el modelo NO SABIA que
//   existian muestras. No decidia mal; no tenia con que decidir.
//
//   Y son dos candados hermanos. El del TEXTO del contenido ya aceptaba esas
//   preguntas —por eso el bot contestaba con palabras y sin imagen—. Uno se
//   quedo corto respecto al otro.
//
// EL SEGUNDO HUECO: CON DOS PRODUCTOS, ELEGIA A CIEGAS
//
//   La lista iba con el tema a secas:
//
//     - "IMAGEN SUPER KIT"      ← ¿de cual?
//     - "FLORCITAS AMARILLAS"   ← ¿de cual?
//
//   Con un solo producto daba igual. Con dos, un «¿que contiene?» generico le
//   dejaba elegir a ciegas y mandaba la muestra del producto equivocado — un
//   fallo que solo se ve en el chat, nunca en un log.
//
//   node scripts/prueba-la-muestra-sale-cuando-preguntan-que-contiene.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");
const cerebro = leer("src", "lib", "openrouter.ts");
const config = leer("src", "lib", "workflow", "config.ts");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 60)} ${valor}`);
};

// ── 1. Los dos candados abren con lo mismo ───────────────────────────────────
comprobar(
  "una pregunta de contenido abre la galeria",
  /const currentTurnNeedsMedia =\s*\r?\n\s*\(!isPostSale \|\| elExtraSeEstaOfreciendo\) &&\s*\r?\n\s*\(looksLikeMediaTurn\(latestIntentText\) \|\|\s*\r?\n\s*looksLikeProductContentTurn\(latestIntentText\) \|\|/.test(
    cerebro
  ),
  "el mismo que el del texto"
);
// Y NO se toca lo que ya abria: quien pide ver una imagen sigue igual.
comprobar(
  "y pedir ver una imagen sigue abriendola",
  /looksLikeMediaTurn\(latestIntentText\) \|\|/.test(cerebro) &&
    /previousBotOfferedMedia\);/.test(cerebro),
  "nada se pierde"
);
// La postventa sigue cerrada: a quien ya compro no se le vende otra vez.
//
// CON UNA EXCEPCION, y solo una: mientras se ofrece el SEGUNDO producto. Ahi hay
// una venta abierta, y cerrarlo dejaba al bot sin saber que el extra tiene
// muestras. Es seguro porque en ese momento la galeria disponible es SOLO la del
// extra —nunca la del producto ya comprado—, asi que no se puede revender lo
// entregado ni por accidente.
comprobar(
  "en postventa sigue cerrada",
  /\(!isPostSale \|\| elExtraSeEstaOfreciendo\) &&/.test(cerebro) &&
    /const elExtraSeEstaOfreciendo =\s*\r?\n\s*convo\?\.upsell_state === "ofrecido" \|\| convo\?\.upsell_state === "aceptado";/.test(
      cerebro
    ),
  "salvo el extra en oferta"
);
// Y EL TEXTO del producto ya comprado NO se abre: describirlo en postventa seria
// reabrir la presentacion de lo que el cliente ya tiene.
comprobar(
  "y el contenido del producto ya comprado sigue cerrado del todo",
  /const currentTurnNeedsProductContent =\s*\r?\n\s*!isPostSale &&/.test(cerebro),
  "sin excepciones"
);

// ── 2. La lista dice de que producto es cada muestra ─────────────────────────
comprobar(
  "cada muestra lleva el nombre de su producto",
  /product: producto\.trim\(\),/.test(config) &&
    /\/\*\* DE QUÉ PRODUCTO ES ESTA MUESTRA\./.test(config),
  "GalleryItemOut.product"
);
// Los nombres salen del CONTENIDO, nunca escritos en el codigo: esto es una
// plantilla y el codigo no conoce ningun producto.
comprobar(
  "y el nombre sale del contenido, no del codigo",
  /normalizeGallery\(\s*\r?\n?\s*cfg\?\.image_gallery,\s*\r?\n?\s*cfg\?\.product_name\?\.trim\(\) \?\? ""\s*\r?\n?\s*\)/.test(
    config
  ) &&
    /normalizeGallery\(cfg\?\.image_gallery_2, cfg\?\.product_name_2\?\.trim\(\) \?\? ""\)/.test(
      config
    ),
  "ningun nombre en el codigo"
);
comprobar(
  "el pack y el segundo producto tambien",
  /const nombreDelPack =\s*\r?\n\s*cfg\?\.order_bump\?\.combo\?\.name\?\.trim\(\) \|\|/.test(
    config
  ) && /normalizeGallery\(cfg\?\.pack_gallery, nombreDelPack\)/.test(config),
  "los cuatro"
);
// Mientras el extra esta en oferta la galeria es la SUYA, y sale con su nombre.
comprobar(
  "y la del extra sale con el nombre del extra",
  /seccionUpsell\(cfg\)\?\.image_gallery,\s*\r?\n\s*seccionUpsell\(cfg\)\?\.name\?\.trim\(\) \?\? ""/.test(
    config
  ),
  "regla 5-bis intacta"
);
// Vacio = sin dueño, exactamente como antes. Una galeria sin nombre de producto
// no puede quedar peor de lo que estaba.
comprobar(
  "sin nombre configurado, la lista queda como estaba",
  /producto = ""/.test(config),
  "vacio por defecto"
);

// ── 3. Y el modelo lo ve, con la regla de a cual mandar ──────────────────────
comprobar(
  "el modelo recibe el producto de cada muestra",
  /\$\{g\.product \? ` \[producto: \$\{g\.product\}\]` : ""\}/.test(cerebro),
  "en la lista"
);
comprobar(
  "y la regla de no adivinar entre varios",
  /Each item says which PRODUCT it belongs to\. Send ONLY an item of the product you are actually talking about\./.test(
    cerebro
  ) && /do NOT guess/.test(cerebro),
  "pregunta en vez de acertar por suerte"
);

// ── 4. LO QUE NO CAMBIA ──────────────────────────────────────────────────────
//
// Enseñar la lista no manda nada. Quien y cuando lo sigue decidiendo el modelo
// con el «cuando enviarla» del dueño, y con los topes de siempre.
comprobar(
  "el «cuándo enviarla» del dueño sigue mandando",
  /â†’ cuÃ¡ndo: \$\{g\.when\}/.test(cerebro),
  "lo que escribe en cada muestra"
);
comprobar(
  "nunca sin que venga a cuento, y nunca mas de una",
  /NEVER send media unprompted or just to send it, and NEVER more than ONE media per reply\./.test(
    cerebro
  ),
  "los topes de siempre"
);
// Y si no hay galeria, se le dice que no prometa imagenes.
comprobar(
  "sin galeria, que no prometa imagenes",
  /there are NO configured images\/videos available for this turn/.test(cerebro),
  "no promete lo que no hay"
);
// El pie de foto: si la muestra no trae uno fijo, el texto del bot ES el pie —
// misma burbuja. Es lo que evita la burbuja de texto suelta y repetida.
comprobar(
  "y su texto se convierte en el pie de la imagen",
  /the sentence YOU write becomes the image's caption \(same bubble\)/.test(
    cerebro
  ),
  "sin burbuja de mas"
);

console.log(
  fallos === 0
    ? "\nTODO OK — la muestra sale cuando preguntan que contiene"
    : `\n${fallos} comprobacion(es) mal.`
);
process.exit(fallos === 0 ? 0 : 1);
