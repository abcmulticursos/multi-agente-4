// El resumen de si el bot puede registrar una venta, arriba del todo.
//
// EL PROBLEMA
//
//   Meta Connect tiene ocho secciones y cada una dice si LO SUYO esta bien: la
//   pagina por su lado, el numero por el suyo, el pixel por el suyo. Ninguna
//   decia si el CONJUNTO sirve.
//
// DOS COLORES, Y YA NO MIRAN LA WABA
//
//   ROJO     falta alguno de los tres. Ni se puede empezar.
//   VERDE    estan los tres. Las compras se registran.
//
// ESTA PRUEBA SE INVIRTIO EL 3 DE OCTUBRE DE 2026, y es el motivo de que se deje
// escrito aqui. Antes exigia lo contrario: que hubiera un color NARANJA cuando el
// pixel no fuera el que la cuenta de WhatsApp tiene asociado, con el aviso «las
// compras no se registraran».
//
// ERA VERDAD mientras el bot mandaba el identificador de la WABA en el evento:
// Meta validaba ese vinculo y rechazaba la venta si no existia (2804132). El bot
// dejo de mandar ese dato ese mismo dia —ver `prueba-el-evento-no-manda-la-waba`
// y el porque escrito en `src/lib/meta/conversions.ts`— y el aviso se quedo
// mintiendo.
//
// NO FUE UNA REGRESION: CAMBIO LA PREMISA. La intencion de la prueba se da la
// vuelta y se conserva:
//
//   antes   no le digas que esta listo cuando no lo esta
//   ahora   no le digas que NO esta listo cuando si lo esta
//
// LO QUE EL AVISO VIEJO LE HACIA HACER, y por eso corria prisa: le decia «elige
// un pixel vinculado a la WABA o crea uno». Siguiendolo habria abandonado un
// pixel que funciona, por un requisito que ya no existe. Un aviso obsoleto que
// manda actuar es peor que no tener aviso.
//
//   node scripts/prueba-el-set-de-venta.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const pantalla = readFileSync(
  join(RAIZ, "src", "app", "meta-connect", "page.tsx"),
  "utf8"
);

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

const tarjeta = (() => {
  const i = pantalla.indexOf("function SetDeVenta(");
  const f = pantalla.indexOf("function CredencialesGuardadas(", i);
  return i < 0 || f < 0 ? "" : pantalla.slice(i, f);
})();
comprobar("se encuentra la tarjeta", tarjeta.length > 0, "SetDeVenta");

// -- 1. VA ARRIBA DEL TODO ---------------------------------------------------
//
// Es el resumen: debajo hay ocho secciones de detalle. Un resumen al final es
// un resumen que se lee cuando ya buscaste a mano.
comprobar(
  "se dibuja antes que las demás secciones",
  pantalla.indexOf("<SetDeVenta") > 0 &&
    pantalla.indexOf("<SetDeVenta") <
      pantalla.indexOf('<section className="rounded-lg border border-neutral-200 bg-tarjeta p-4 shadow-sm">'),
  "lo primero que se ve"
);

// -- 2. LOS TRES ELEMENTOS ---------------------------------------------------
for (const [que, texto] of [
  ["la página", "Página de Facebook"],
  ["el número", "Número de WhatsApp"],
  ["el píxel", '"Píxel",'],
]) {
  comprobar(`${que} está en la tarjeta`, tarjeta.includes(texto), "de los tres");
}

// -- 3. EL SEMAFORO ----------------------------------------------------------
comprobar(
  "rojo cuando falta alguno de los tres",
  /faltan\.length > 0\s*\r?\n?\s*\? "rojo"/.test(tarjeta),
  "no se puede empezar"
);
comprobar(
  "verde con los tres, sin pedir nada mas",
  /const estado: "rojo" \| "verde" = faltan\.length > 0 \? "rojo" : "verde";/.test(
    tarjeta
  ),
  "el vinculo ya no decide"
);

// -- 4. EL AVISO VIEJO NO PUEDE VOLVER ---------------------------------------
//
// Esto es el centinela. Si alguien vuelve a pintar ese aviso —o el color que lo
// traia— el dueño volveria a leer que tiene que cambiar de pixel, y le haria
// abandonar uno que funciona.
comprobar(
  "no vuelve el aviso de «las compras no se registraran»",
  !/las compras no se registrarán/.test(tarjeta),
  "era falso desde el 3/10/2026"
);
comprobar(
  "ni le manda cambiar de pixel o crear otro",
  !/píxel vinculado a la WABA o crea uno/.test(tarjeta),
  "seguirlo le costaria un pixel bueno"
);
comprobar(
  "ni queda el color que lo traia",
  !/"naranja"/.test(tarjeta),
  "dos colores, no tres"
);

// -- 5. EL DATO SE QUEDA, PERO COMO NOTA -------------------------------------
//
// El va a ver en Meta que su cuenta de WhatsApp tiene asociado otro conjunto de
// datos, y va a preguntar si eso le rompe algo. Se le contesta en la pantalla,
// antes de que lo busque — pero sin alarma, porque no lo es.
comprobar(
  "se sigue sabiendo si la cuenta tiene otro",
  /const vinculado = Boolean\(\s*\r?\n\s*datasetDeLaWaba\?\.id && pixelId && datasetDeLaWaba\.id === pixelId\s*\r?\n\s*\);/.test(
    tarjeta
  ) && /const laWabaTieneOtro = Boolean\(/.test(tarjeta),
  "el dato no se tira"
);
comprobar(
  "y se dice que da igual que no coincidan",
  /ya no hace\s*\r?\n?\s*falta que coincidan/.test(tarjeta),
  "contestado antes de preguntarlo"
);
// `null` NO es «no hay»: es «todavia no se ha podido preguntar». Se siguen
// leyendo distinto, que es lo que evita afirmar sobre lo que no se sabe.
comprobar(
  "«no comprobado» sigue sin confundirse con «no hay»",
  /const sinComprobar = datasetDeLaWaba === null;/.test(tarjeta),
  "no se afirma lo que no se pudo ver"
);

// -- 5. EL VINCULO SE PREGUNTA, NO SE DEDUCE ---------------------------------
//
// Si el pixel elegido es el de esta WABA lo sabe Meta, no el panel. Se pregunta
// con el mismo GET que usa el boton de abajo, que SOLO MIRA: crear un conjunto
// de datos sin que nadie lo pida seria crear algo en su negocio por abrir una
// pantalla.
comprobar(
  "se le pregunta a Meta al abrir, sin crear nada",
  /fetch\("\/api\/meta\/connect\/dataset-waba", \{\s*\r?\n\s*cache: "no-store",\s*\r?\n\s*\}\)/.test(
    pantalla
  ),
  "solo mira"
);
// Y SE ACTUALIZA AL CREARLO: si no, uno crea el conjunto de datos, funciona, y
// la tarjeta sigue en naranja hasta recargar.
comprobar(
  "y la tarjeta se entera al crear el conjunto de datos",
  (pantalla.match(/setDatasetDeLaWaba\(\{ id: data\.datasetId \?\? null \}\);/g) ?? [])
    .length >= 3,
  "se pone verde sola"
);

console.log(
  fallos === 0
    ? "\nTODO OK — de un vistazo se sabe si la venta se va a registrar"
    : `\n${fallos} FALLO(S)`
);
process.exit(fallos === 0 ? 0 : 1);
