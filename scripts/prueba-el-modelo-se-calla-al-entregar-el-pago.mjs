// Dos voces anunciando lo mismo, y una de ellas improvisando.
//
// Cuando el modelo reconoce que el cliente eligio un producto, lo dice con el
// marcador <<ELIGE_PRODUCTO_1/2>> y el SISTEMA entrega los datos de pago. Pero
// el texto del modelo se mandaba tambien. Salia esto:
//
//   1  ¡Genial! Has elegido el KIT EMPRENDEDOR BASICO           (modelo)
//   2  ✅ ¡Perfecto! puedes adquirir el curso de esta manera     (pago, paso 0)
//   3  Te paso los datos para que puedas adquirirlo              (modelo)
//   4  🔴 Transferencia: ... Monto: $6.000 ARS                   (pago, paso 1)
//   5  😊 Una vez realizado nos envias tu comprobante            (pago, paso 2)
//
// DOS PROBLEMAS A LA VEZ.
//
// El cruce: las dos tandas se programaban desde el mismo instante y con el
// mismo hueco entre burbujas, asi que se intercalaban SIEMPRE — no era mala
// suerte, era aritmetica. Los datos de la cuenta quedaban partiendo un texto
// por la mitad.
//
// La redundancia: aun ordenadas, las lineas 3 y 2 dicen lo mismo. El modelo
// narraba lo que el sistema iba a hacer un segundo despues. Y encima improvisa
// el nombre del producto: en una prueba se invento uno que no era el mostrado.
//
// LA REGLA QUE VIGILA ESTA PRUEBA
//
// El marcador significa que el sistema toma el control. Entonces lo toma
// ENTERO: el texto del modelo se descarta y hablan las burbujas de Precios y
// pagos, que son fijas, llevan el precio de lo elegido y las escribe el
// operador. Sin dos tandas no hay cruce posible, y sin dos voces no hay
// redundancia.
//
// Vale para los TRES canales. Si se arregla solo en WhatsApp, el mismo popurri
// sigue vivo en Messenger e Instagram y nadie lo mira hasta que un cliente lo
// reporta.
//
//   node scripts/prueba-el-modelo-se-calla-al-entregar-el-pago.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");
const CANALES = {
  WhatsApp: leer("src", "lib", "meta", "handler.ts"),
  Messenger: leer("src", "app", "api", "webhooks", "messenger", "route.ts"),
  Instagram: leer("src", "app", "api", "webhooks", "instagram", "route.ts"),
};

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

/**
 * Solo la rama del marcador de eleccion, no lo que viene detras.
 *
 * Detras hay otros marcadores —el regalo, el menu de pagos, el reenvio— que SI
 * mandan el texto del modelo antes de actuar. Eso es a proposito y no se toca
 * aqui. Cortando por el primero de ellos, esta prueba mide lo suyo y no se
 * pone roja por una rama vecina.
 */
const ramaDeLaEleccion = (texto) => {
  const desde = texto.indexOf("ELIGE_PRODUCTO_([12])");
  if (desde < 0) return "";
  const siguiente = texto.indexOf("REGALO", desde);
  return texto.slice(desde, siguiente > desde ? siguiente : desde + 2200);
};

// ── 1. Ningun canal manda el texto del modelo en esa rama ──────────────────
for (const [canal, texto] of Object.entries(CANALES)) {
  const rama = ramaDeLaEleccion(texto);
  comprobar(
    `${canal} atiende el marcador de eleccion`,
    rama.length > 0 && /deliverDobleOfertaPaymentDetails\(/.test(rama),
    "la rama existe"
  );
  comprobar(
    `${canal} NO manda el texto del modelo ahi`,
    !/sendChunkedBotText\(\s*(fresh|current)\s*,\s*leftover\s*\)/.test(rama),
    "el sistema habla solo"
  );
  comprobar(
    // Descartar en silencio es peor que el fallo: el dia que alguien se pregunte
    // por que el bot "no contesto lo que dijo el modelo", no habra ni una linea.
    `${canal} deja escrito que lo descarto`,
    /descarto el texto del modelo/.test(rama),
    "queda rastro"
  );
}

// ── 2. Y las burbujas de pago siguen saliendo ──────────────────────────────
//
// Callar al modelo no puede callar tambien al sistema: entonces el cliente
// elige y no recibe nada, que es mucho peor que recibir de mas.
for (const [canal, texto] of Object.entries(CANALES)) {
  const i = texto.indexOf("ELIGE_PRODUCTO_([12])");
  const rama = texto.slice(i, i + 2200);
  comprobar(
    `${canal} sigue entregando los datos de pago`,
    /await deliverDobleOfertaPaymentDetails\(\s*(fresh|current)\s*,\s*choice\s*\)/.test(
      rama
    ),
    "el sistema entrega"
  );
}

// ── 3. El marcador nunca llega al cliente ──────────────────────────────────
for (const [canal, texto] of Object.entries(CANALES)) {
  comprobar(
    `${canal} borra el marcador del texto`,
    /replace\(\/<<\\s\*ELIGE_PRODUCTO_\[12\]\\s\*>>\\s\*\/gi, ""\)/.test(texto),
    "fuera del mensaje"
  );
}

console.log(
  fallos === 0
    ? "\nTODO OK — cuando el sistema entrega el pago, el modelo no habla encima"
    : `\n${fallos} FALLA(S)`
);
process.exit(fallos === 0 ? 0 : 1);
