// CADA TIENDA MIDE LA COMPRA CON SU PÁGINA Y SU PIXEL.
//
// LO PIDIÓ EL DUEÑO el 1 de octubre de 2026: «el tema del pixel, recuerda que para
// marcar la compra se necesita waba, numero, pagina y pixel (asi le digo pixel al
// dataset)».
//
// ── LO QUE SE MIDIÓ ANTES DE TOCAR NADA ────────────────────────────────────
//
// De los cuatro datos que Meta exige que encajen, dos ya salían bien y dos no:
//
//     número   el de la conversación            OK
//     WABA     la conexión de ESE número        OK
//     página   la ACTIVA, no la de la tienda    MAL
//     pixel    uno solo para todo el bot        MAL
//
// Con un número da igual. Con varios, una venta del número 2 se reportaba con la
// página del número 1: Meta la rechaza con el subcódigo 2804069 y la venta NO SE MIDE.
// Y lo peor: sin ningún error en la venta. El cliente recibe su producto, el bot
// sigue, y el fallo solo se ve en el Administrador de eventos de Meta.
//
// Estaba previsto desde el 24/09 en `PLAN-MEDICION-META-CAPI.md`, mejora 2, medido y
// aparcado por él porque entonces vendía con un número solo.
//
// ── LO QUE NO SE TOCA, Y ESTÁ DECIDIDO POR ÉL ──────────────────────────────
//
// `whatsapp_business_account_id` se sigue mandando. Quitarlo es la mejora 1 de ese
// mismo plan, que él dejó aparcada —«déjalo por ahora como está»—. Son dos decisiones
// distintas y esta prueba vigila que no se junten por descuido.
//
//   node scripts/prueba-cada-tienda-mide-con-lo-suyo.mjs
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const DOBLE = "stub:db";
registerHooks({
  resolve(esp, ctx, next) {
    if (esp === "@/lib/db") return { url: DOBLE, format: "module", shortCircuit: true };
    if (esp.startsWith("@/")) {
      const rel = esp.slice(2);
      const conExt = /\.[a-z]+$/.test(rel) ? rel : `${rel}.ts`;
      return { url: pathToFileURL(join(RAIZ, "src", conExt)).href, shortCircuit: true };
    }
    return next(esp, ctx);
  },
  load(url, ctx, next) {
    if (url === DOBLE)
      return {
        format: "module", shortCircuit: true,
        source: `
          export const getConversationByPhone = () => null;
          export const getConversationById = () => null;
          export const getFrozenPrices = () => null;
          export const getUpsellFrozenPrices = () => null; export const getPuestoEnLaFila = () => null; export const leerCompradosDeLaFila = () => []; export const moverLaFila = () => {};
          export const setFrozenPrices = () => {};
        `,
      };
    return next(url, ctx);
  },
});
const m = await import(pathToFileURL(join(RAIZ, "src", "lib", "workflow", "config.ts")).href);
const medicion = readFileSync(join(RAIZ, "src", "lib", "meta", "conversions.ts"), "utf8");
const guardado = readFileSync(join(RAIZ, "src", "app", "api", "workflow", "route.ts"), "utf8");
const pantalla = readFileSync(join(RAIZ, "src", "app", "editor", "page.tsx"), "utf8");

// SE MIDE EL CÓDIGO, NO LOS COMENTARIOS. El endpoint EXPLICA por qué no usa
// `fetchMetaAppName`, así que buscar ese nombre a pelo cazaba su propia explicación y la
// prueba se ponía roja por el motivo contrario al que vigila.
const sinComentarios = (ruta) =>
  readFileSync(join(RAIZ, ...ruta), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
// Lo que sirve `/api/editor/conexiones` se arma desde el 09/10/2026 en
// `lo-conectado.ts`: las tarjetas por cuenta de Meta Connect leen la misma lista.
const elEndpoint = sinComentarios(["src", "lib", "meta", "lo-conectado.ts"]);

let fallos = 0;
const pad = (s, n) => (String(s ?? "") + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// ── 1. LA TIENDA SE ENCUENTRA POR EL NÚMERO O POR LA PÁGINA ────────────────
//
// Es la función que usa la medición. Si ésta se equivoca, se mide con los datos de
// OTRA tienda — que es justo el fallo que se viene a arreglar.
//
// `tiendaDelNumero` y `tiendaDeLaPagina` leen la configuración cargada, así que esto
// se ejecuta contra las tiendas que haya escritas de verdad. Sus nombres y sus ids no
// se escriben aquí: se buscan. Una prueba con sus datos dentro taparía el fallo de un
// código que conoce los datos de hoy.
console.log("\n— 1. de qué tienda es esta conversación —\n");
const config = m.loadWorkflowConfig();
const laDelNumero = (config.tiendas ?? []).find((t) =>
  String(t?.numero ?? "").trim()
);
const laDeLaPagina = (config.tiendas ?? []).find((t) =>
  String(t?.pagina ?? "").trim()
);
comprobar(
  "sin conversación no hay tienda",
  m.laTiendaDeLaConversacion(null) === null,
  "se mide como siempre"
);
comprobar(
  "una conversación sin número ni página tampoco",
  m.laTiendaDeLaConversacion({}) === null,
  "se mide como siempre"
);
comprobar(
  "un número que no es de nadie tampoco",
  m.laTiendaDeLaConversacion({ wa_phone_number_id: "no_es_de_nadie_0000" }) === null,
  "no se cae a la primera tienda"
);
if (laDelNumero) {
  comprobar(
    "por su número de WhatsApp se encuentra la suya",
    m.laTiendaDeLaConversacion({ wa_phone_number_id: laDelNumero.numero })?.id ===
      laDelNumero.id,
    "la que atiende ese número"
  );
} else {
  console.log("—     sin ninguna tienda con número escrito, no hay nada que medir");
}
if (laDeLaPagina) {
  comprobar(
    "y por su página de Facebook también",
    m.laTiendaDeLaConversacion({ messenger_page_id: laDeLaPagina.pagina })?.id ===
      laDeLaPagina.id,
    "para las ventas de Messenger"
  );
} else {
  console.log("—     sin ninguna tienda con página escrita, no hay nada que medir");
}

// ── 2. LA MEDICIÓN PREGUNTA POR LA TIENDA, NO POR LA ACTIVA ────────────────
console.log("\n— 2. la página y el pixel salen de la tienda —\n");
comprobar(
  "la página de la tienda manda sobre la activa",
  /laMedicionDeLaTienda\(conversationId\)\.pagina \?\?\s*\r?\n?\s*process\.env\.META_PAGE_ID \?\?\s*\r?\n?\s*activeMeta\?\.page_id/.test(
    medicion
  ),
  "y la activa sigue de respaldo"
);
comprobar(
  "el pixel de la tienda manda sobre el de Meta Connect",
  /const pixelId = laMedicionDeLaTienda\(conversationId\)\.pixel \?\? getCapiPixelId\(\);/.test(
    medicion
  ),
  "y el de la pantalla sigue de respaldo"
);
comprobar(
  "y los tres eventos le pasan su conversación",
  (medicion.match(/buildUserData\(args\.userData, args\.conversationId\)/g) ?? []).length === 3,
  "compra, contacto y checkout"
);

// ── 3. VACÍO SIGUE SIENDO LO DE SIEMPRE ────────────────────────────────────
//
// Es la mitad que protege la instalación de un número: sin tienda, o con la casilla
// en blanco, se mide exactamente como antes de este cambio.
console.log("\n— 3. vacío manda lo de siempre —\n");
comprobar(
  "una casilla en blanco no tapa el respaldo",
  /pagina: String\(suya\?\.pagina \?\? ""\)\.trim\(\) \|\| null/.test(medicion) &&
    /pixel: String\(suya\?\.pixel \?\? ""\)\.trim\(\) \|\| null/.test(medicion),
  "blanco = null, no cadena vacía"
);
comprobar(
  "y si la fila no se puede leer, se mide como antes",
  /try \{[\s\S]{0,300}?laTiendaDeLaConversacion\(getConversationById\(conversationId\)\)[\s\S]{0,120}?\} catch \{/.test(
    medicion
  ),
  "medir no rompe una venta"
);

// ── 4. LA WABA SIGUE VIAJANDO ──────────────────────────────────────────────
//
// Quitarla es la mejora 1 del plan, que él dejó APARCADA. Esta comprobación existe
// para que no se cuele dentro de otro cambio: son dos decisiones distintas.
console.log("\n— 4. la WABA no se toca —\n");
comprobar(
  "se sigue mandando el id de la WABA",
  /if \(wabaId\) ud\.whatsapp_business_account_id = wabaId;/.test(medicion),
  "mejora 1 del plan, sin aprobar"
);

// ── 5. EL CAMPO SOBREVIVE AL GUARDADO ─────────────────────────────────────
//
// `leeTiendas` es una lista blanca y su propio comentario lo advierte: «lo que no se
// nombre aquí se pierde en silencio al guardar». Un campo que la pantalla escribe y el
// guardado tira es el fallo más caro de este proyecto, porque no da ningún error.
console.log("\n— 5. el pixel sobrevive al guardado —\n");
comprobar(
  "el guardado lo nombra",
  /pixel: str\(t\.pixel\)\.trim\(\)/.test(guardado),
  "si no, se perdería en silencio"
);
comprobar(
  "y solo se escribe si tiene algo",
  /\.\.\.\(str\(t\?\.pixel\)\.trim\(\) \? \{ pixel: str\(t\.pixel\)\.trim\(\) \} : \{\}\)/.test(
    guardado
  ),
  "como el resto del archivo"
);

// ── 6. SE ELIGE DE UNA LISTA, NO SE COPIA A MANO ──────────────────────────
//
// LO PIDIÓ EL DUEÑO el mismo día: «¿por qué en las tiendas configuraste la textarea
// para yo agregar el id del numero de whatsapp? no es mejor elegir un número de la
// lista de numeros de whatsapp?». Un id de dieciséis cifras copiado a mano no se
// comprueba a ojo, y un dígito cambiado deja la tienda muda sin dar ningún error.
//
// Desde el 09/10/2026 la página y el pixel se eligen de la lista ACOTADA a la cuenta del
// número (`soloDeLaCuenta`, PLAN-VARIAS-CUENTAS-DE-FACEBOOK.md). Sigue siendo una lista
// de lo conectado; solo que ya no ofrece lo de otras cuentas.
console.log("\n— 6. los tres se eligen de una lista —\n");
for (const [que, cual] of [
  ["el número", "conexiones.numeros"],
  ["la página", "paginasDeSuCuenta.visibles"],
  ["el pixel", "pixelsDeSuCuenta.visibles"],
]) {
  comprobar(
    `${que} se elige de la lista`,
    new RegExp(`opciones=\\{${cual.replace(".", "\\.")}\\}`).test(pantalla),
    cual
  );
}
comprobar(
  "y queda la salida de escribir a mano",
  /Escribir a mano…/.test(pantalla) && /setAMano\(true\)/.test(pantalla),
  "para la tienda que se prepara antes de conectar"
);
// ── SE PUEDE QUITAR, Y SE PUEDE CERRAR ────────────────────────────────────
//
// LO PIDIO EL DUEÑO el 02/10/2026: «no hay opcion para quitarlas, deberia tambien en el
// selector decir "ninguno" asi ya no se usa», y «al desplegar el selector, con tan solo
// yo presionar click fuera del selector se repliegue o tambien al presionar escape se
// repliegue SIN SALIRSE DEL POP UP, sino del selector solamente».
comprobar(
  "se puede dejar en Ninguno",
  /— Ninguno —/.test(pantalla),
  "la fila existia, pero su rotulo no se leia como opcion"
);
comprobar(
  "un clic fuera lo cierra",
  /<span\s*\r?\n?\s*className="fixed inset-0 z-40"\s*\r?\n?\s*onClick=\{\(e\) => \{\s*\r?\n?\s*e\.stopPropagation\(\);\s*\r?\n?\s*setAbierto\(false\);/.test(
    pantalla
  ),
  "y no reabre por el reenvio del label"
);
comprobar(
  "Escape lo cierra, y SOLO a el",
  /window\.addEventListener\("keydown", alPulsar, true\);/.test(pantalla) &&
    /if \(e\.key !== "Escape"\) return;[\s\S]{0,120}?e\.stopPropagation\(\);/.test(pantalla),
  "en captura, antes que el Escape del pop up"
);
comprobar(
  "y solo escucha mientras esta abierto",
  /useEffect\(\(\) => \{\s*\r?\n?\s*if \(!abierto\) return;/.test(pantalla),
  "cerrado, Escape vuelve a ser de la ventana"
);
// ── CON REFERENCIA VISUAL, COMO LOS DE META CONNECT ───────────────────────
//
// LO PIDIO EL DUEÑO el 02/10/2026: «necesito tener referencia visual… esta bonito tu
// selector pero necesito que sea similar o igual en apariencia a los de meta connect,
// asi yo veo que pagina, que pixel y que dataset elegi».
//
// UN ID DE DIECISEIS CIFRAS NO SE RECONOCE; UNA CARA, SI. Y elegir el numero equivocado
// no da ningun error: la tienda deja de atender y se descubre cuando un cliente se queda
// sin respuesta.
comprobar(
  "cada opción lleva foto, nombre y su dato pequeño",
  /<RetratoDeConexion foto=\{o\.foto\}/.test(pantalla) &&
    /\{o\.etiqueta\}/.test(pantalla) &&
    /\{o\.detalle\}/.test(pantalla),
  "como los de Meta Connect"
);
comprobar(
  "y la chapa de «Activa» cuando lo está",
  /\{o\.activa && \(/.test(pantalla) && /Activa/.test(pantalla)
);
comprobar(
  "lo elegido se ve en la fachada del selector",
  /\{elegido \? \(\s*\r?\n?\s*filaDe\(elegido\)/.test(pantalla),
  "no solo al desplegarlo"
);
comprobar(
  "el endpoint manda las fotos",
  // Desde el 10/10/2026, pedidas frescas y no las guardadas: Meta hace caducar los enlaces.
  /foto: `\/api\/meta\/avatar\?wa=/.test(elEndpoint) &&
    /foto: `\/api\/meta\/avatar\?page=/.test(elEndpoint),
  "pedidas frescas a Meta"
);
// EL SIMBOLO DEL CONJUNTO DE DATOS, y por que es DIBUJADO.
//
// El lo pidio: «si tuvieses el logo de dataset que usa facebook seria genial… el simbolo
// es una referencia, puede ir quizas en color blanco dentro del fondo que pusiste».
// NO SE BAJA EL ICONO DE META —es su marca— : se dibuja el mismo concepto, un nodo que
// se reparte en tres, que es lo que el reconoce del Administrador de anuncios.
comprobar(
  "el pixel lleva su propio símbolo dibujado",
  /function SimboloDeConjuntoDeDatos\(/.test(pantalla) &&
    /esConjuntoDeDatos\s*\r?\n?\s*\? "bg-violet-600"/.test(pantalla),
  "blanco sobre el círculo, como pidió"
);
comprobar(
  "y no se baja ningún archivo de marca de Meta",
  !/facebook\.com\/.*\.(svg|png)|fbcdn.*logo/i.test(pantalla),
  "se dibuja el concepto, no se copia el logo"
);
comprobar(
  "un valor que no está en la lista no se pierde",
  /const escribiendo = aMano \|\| \(puesto !== "" && !estaEnLaLista\);/.test(pantalla),
  "la casilla se abre con él dentro"
);
comprobar(
  "y la lista se lee sin llamar a Meta",
  /listMetaWhatsAppConnections\(\)/.test(elEndpoint) &&
    !/fetchMetaAppName|await fetch\(/.test(elEndpoint),
  "solo la base, sin red"
);
comprobar(
  "y sin devolver ningún token",
  !/access_token/.test(elEndpoint),
  "campo a campo, no la fila entera"
);

console.log(
  fallos === 0
    ? "\nTODO OK — cada tienda mide con su página y su pixel\n"
    : `\n${fallos} FALLO(S)\n`
);
process.exit(fallos === 0 ? 0 : 1);
