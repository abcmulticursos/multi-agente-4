// EL EVENTO DE COMPRA NO MANDA EL IDENTIFICADOR DE LA WABA
//
// LO PIDIO EL DUEÑO — 3 de octubre de 2026. Con sus palabras del 24/09, cuando esto se midio
// por primera vez: «lo que yo necesito es no asociar WABA con pixel, ese camino no lo
// necesito».
//
// DE DONDE SALIO ESE DATO. Se rastreo su historia entera: entro el 17 de julio de 2026 en
// otro proyecto (`AGENTE-KPOP`, commit `d03d03a`), COLADO dentro de un cambio que iba de otra
// cosa — añadir el evento de «inicio el pago». El commit no dice por que. De ahi se copio de
// proyecto en proyecto —MULTI AGENTE, BOT ALBERTO 1, BOT ALBERTO 2— sin que nadie lo volviera
// a mirar. Nadie lo decidio: viajo.
//
// LO QUE COSTO. En cuanto ese dato viaja, Meta valida que el conjunto de datos este asociado
// a esa WABA, y si no lo esta devuelve 2804132 y RECHAZA la venta. El 14 de agosto, en
// `MULTI AGENTE 1`, hay un commit persiguiendo ese mismo 2804132 sin dar con la causa.
//
// POR QUE SE PUEDE QUITAR, verificado en la documentacion de Meta el mismo dia: la lista
// oficial de datos de `user_data` NO INCLUYE la WABA. Meta no la usa para emparejar ni para
// optimizar. Y el proyecto anterior del dueño (`agente-whatsapp-grafismo`) nunca la mando:
// funciono meses con solo `ctwa_clid` y `page_id`.
//
//   developers.facebook.com/docs/marketing-api/conversions-api/parameters/
//   customer-information-parameters
//
// QUE VIGILA ESTA PRUEBA: que nadie la reintroduzca. Es exactamente lo que paso la primera
// vez —colada en un cambio de otra cosa, sin una linea que lo explicara— y entonces no habia
// nada que se pusiera rojo.
//
//   node scripts/prueba-el-evento-no-manda-la-waba.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const fuente = readFileSync(
  join(RAIZ, "src", "lib", "meta", "conversions.ts"),
  "utf8"
);

let fallos = 0;
const comprobar = (titulo, condicion, detalle) => {
  const marca = condicion ? "  ok  " : "> FALLA";
  if (!condicion) fallos++;
  console.log(`${marca} ${String(titulo).padEnd(56)} ${detalle ?? ""}`);
};

// Se mira el CODIGO, no los comentarios: el porque esta escrito arriba a proposito y nombra
// el dato varias veces. Buscar el nombre a secas pondria esto rojo por su propia explicacion.
const codigo = fuente
  .split(/\r?\n/)
  .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
  .join("\n");

// -- 1. NO SE ASIGNA EN NINGUN SITIO ---------------------------------------
comprobar(
  "no se le asigna la WABA al evento",
  !/ud\.whatsapp_business_account_id\s*=/.test(codigo),
  "ni aqui ni en ninguna rama"
);
comprobar(
  "y no se pide la WABA a la configuracion",
  !/getWhatsAppRuntimeConfig\(\)/.test(codigo),
  "era lo unico que se le pedia aqui"
);

// -- 2. LO QUE SI TIENE QUE SEGUIR YENDO -----------------------------------
//
// Quitar la WABA no puede llevarse por delante lo que Meta SI necesita. `page_id` es
// obligatorio de verdad —2804069 si falta— y `ctwa_clid` es la marca del anuncio: sin ella no
// hay atribucion ninguna.
comprobar(
  "la pagina sigue yendo",
  /ud\.page_id = pageId/.test(codigo),
  "obligatoria de verdad: 2804069 si falta"
);
comprobar(
  "y la marca del anuncio tambien",
  /ud\.ctwa_clid = data\.ctwa_clid/.test(codigo),
  "sin ella no hay atribucion"
);
comprobar(
  "la pagina sigue saliendo de la tienda primero",
  /laMedicionDeLaTienda\(conversationId\)\.pagina/.test(codigo),
  "cada tienda mide con la suya"
);
comprobar(
  "y el conjunto de datos tambien",
  /laMedicionDeLaTienda\(conversationId\)\.pixel/.test(codigo),
  "un pixel por tienda"
);

// -- 3. EL DIAGNOSTICO SE QUEDA, Y AHORA ES UN CENTINELA --------------------
//
// Imprime la WABA del evento. Desde este cambio sale siempre «(NINGUNA)». Si algun dia
// apareciera un valor ahi, es que alguien la reintrodujo — y con ella el 2804132.
comprobar(
  "el diagnostico sigue imprimiendo la WABA del evento",
  /waba=\$\{ud\.whatsapp_business_account_id/.test(fuente),
  "si vuelve a salir un valor, alguien la reintrodujo"
);

console.log("");
if (fallos > 0) {
  console.log(`> ${fallos} FALLA(S)`);
  process.exit(1);
}
console.log("TODO OK — el evento va con pagina y marca del anuncio, sin la WABA");
