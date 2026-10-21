// Que el video del chat se pueda adelantar y retroceder.
//
// Un reproductor de HTML no "adelanta" pidiendo el archivo entero: pide el
// TROZO que necesita, con una cabecera Range. Si el servidor no la entiende y
// devuelve siempre el archivo completo, la barra del video no se puede mover.
//
// Este arreglo ya existía en dos proyectos y en el tercero no: se había perdido
// al copiar el bot. Esta prueba está para que eso no vuelva a pasar sin avisar.
//
//   node scripts/prueba-video-adelantar.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const ruta = readFileSync(
  join(RAIZ, "src", "app", "api", "media", "[messageId]", "route.ts"),
  "utf8"
);

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (nombre, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(nombre, 58)} ${valor}`);
};

comprobar(
  "el servidor avisa que acepta pedidos por trozos",
  ruta.includes('"Accept-Ranges": "bytes"'),
  "Accept-Ranges: bytes"
);
comprobar(
  "lee la cabecera Range que manda el reproductor",
  /req\.headers\.get\("range"\)/.test(ruta),
  "sí"
);
comprobar(
  "responde 206 con el trozo pedido",
  /status: 206/.test(ruta) && /Content-Range/.test(ruta),
  "206 + Content-Range"
);
comprobar(
  "manda el archivo por partes, no entero en memoria",
  /createReadStream/.test(ruta) && !/readFileSync\(absPath\)/.test(ruta),
  "por partes"
);
comprobar(
  "un Range imposible se rechaza con 416, no con un video roto",
  /status: 416/.test(ruta),
  "sí"
);
comprobar(
  "sin Range sigue devolviendo el archivo completo",
  /if \(!range\) \{/.test(ruta),
  "sí"
);

console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} comprobación(es) mal.`);
process.exit(fallos === 0 ? 0 : 1);
