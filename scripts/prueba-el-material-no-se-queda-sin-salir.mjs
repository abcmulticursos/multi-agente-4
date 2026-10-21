// SI LA ENTREGA DE «PAGO APROBADO» NO TIENE NINGUNA BURBUJA ENCENDIDA, SE MANDA LA DEL BASE
//
// LO QUE PASO — 3 de octubre de 2026, midiendo las dos submodalidades del dueño. Con la
// tienda vendiendo DOS opciones, la caja global de entrega no se rellena: se queda la del
// archivo, y el dueño la tiene con sus dos burbujas APAGADAS (un video y el aviso del correo).
//
// El camino que lo destapa es una transicion suya, y es real: un cliente compra con la tienda
// en «un producto», el la cambia a dos opciones, y ese cliente PIDE OTRA VEZ su material. El
// reenvio busca la caja global, no encuentra ninguna burbuja viva, y el cliente se queda sin
// su enlace.
//
// LA TRAMPA YA ESTABA ESCRITA EN ESTA CASA: «una caja que una modalidad llena y otra no abre
// se ve igual que una caja vacia». Y la guarda de mas arriba la dejaba pasar porque pregunta
// si la secuencia EXISTE, no si va a salir algo.
//
// QUE SE CONSERVA, y es lo que vigila esta prueba: la ALARMA. El bot ya avisaba al dueño
// —«PAGO Y SE QUEDO SIN ENTREGA... mandasela a mano YA»— y ese aviso NO se quita: si el
// respaldo tampoco tiene nada, suena igual que antes.
//
//   node scripts/prueba-el-material-no-se-queda-sin-salir.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const fuente = readFileSync(join(RAIZ, "src", "lib", "workflow", "payment.ts"), "utf8");

let fallos = 0;
const comprobar = (titulo, condicion, detalle) => {
  const marca = condicion ? "  ok  " : "> FALLA";
  if (!condicion) fallos++;
  console.log(`${marca} ${titulo.padEnd(58)} ${detalle ?? ""}`);
};

// La rama entera: desde «cero burbujas» hasta el cierre de ese if.
const ini = fuente.indexOf("if (activeSteps.length === 0) {");
comprobar("la rama de «no sale ninguna burbuja» existe", ini > 0);
const rama = fuente.slice(ini, ini + 3400);

// -- 1. SOLO ENTRA DONDE HOY NO SALE NADA ------------------------------------
comprobar(
  "el respaldo vive dentro de esa rama",
  /const laDelProductoBase =/.test(rama),
  "si sale algo, aqui no se entra"
);

// -- 2. SOLO PARA «approved» -------------------------------------------------
//
// El extra y las dos opciones NO caen aqui a proposito: si la entrega del extra estuviera
// vacia, mandar el producto base seria mandar el material EQUIVOCADO, no un respaldo.
comprobar(
  "solo responde a la entrega «approved»",
  /source === "approved"\s*\r?\n?\s*\?\s*getActiveTwoTierOffer/.test(rama),
  "el extra y las dos opciones no caen aqui"
);

// -- 3. LA ALARMA SE QUEDA ---------------------------------------------------
comprobar(
  "si el respaldo tampoco tiene nada, la alarma suena igual",
  /avisarQueNoHayEntrega\(conversationId, `la entrega "\$\{source\}"`\)/.test(rama),
  "«mandasela a mano YA» no se quita"
);

// -- 4. EL RESPALDO TAMBIEN SE COMPRUEBA ANTES DE USARLO ---------------------
//
// Mandar un respaldo vacio seria el mismo fallo con otro nombre: «sustituir con nada». Se
// exige una burbuja encendida Y que no sea una plantilla a medio llenar.
comprobar(
  "no se usa un respaldo que tampoco saldria",
  /\.filter\(\(step\) => step\.enabled !== false\)/.test(rama) &&
    /vivas\.length > 0 && !sectionHasPlaceholder\(laDelProductoBase\)/.test(rama),
  "burbuja encendida y sin plantilla"
);

// -- 5. NO SE QUEDA DANDO VUELTAS -------------------------------------------
//
// El respaldo se programa llamando a la MISMA funcion. Con burbujas vivas, la segunda vuelta
// no entra en esta rama, asi que no hay bucle. Y va «sinCancelar» porque lo pendiente ya lo
// cancelo la primera vuelta.
comprobar(
  "el respaldo se programa por el camino de siempre",
  /return scheduleDeliverySequence\(/.test(rama) && /sinCancelar: true/.test(rama),
  "sin inventar un segundo programador"
);

// -- 6. Y LA GUARDA VIEJA SIGUE EN PIE --------------------------------------
//
// La de «la secuencia no existe» avisa al dueño antes de llegar aqui. No se toca.
comprobar(
  "la guarda de «no hay secuencia» sigue avisando",
  /if \(!config\?\.payment_approved_sequence\) \{[\s\S]{0,160}?avisarQueNoHayEntrega/.test(
    fuente
  ),
  "las dos redes, no una"
);

console.log("");
if (fallos > 0) {
  console.log(`> ${fallos} FALLA(S)`);
  process.exit(1);
}
console.log("TODO OK — el material no se queda sin salir, y la alarma sigue puesta");
