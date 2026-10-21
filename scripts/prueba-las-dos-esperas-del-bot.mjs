// Las dos esperas antes de responder, en el panel y diciendo cual hace que.
//
// SON DOS, Y SE CONFUNDEN TODO EL RATO
//
//   1. La ESPERA POR SI SIGUE ESCRIBIENDO. La gente escribe en rafagas de
//      mensajitos. El bot aguarda; si llega otro mensaje descarta el anterior y
//      responde UNA vez viendo el bloque entero. ESTA es la que junta.
//
//   2. El DELAY ANTES DE RESPONDER. Ocurre DESPUES, cuando la rafaga ya se
//      cerro. Marca leido, muestra «escribiendo...» y espera. No junta nada:
//      es apariencia, y se puede bajar sin perder ninguna proteccion.
//
//   Las dos retrasan la respuesta, asi que desde fuera parecen la misma cosa y
//   se toca la que no era.
//
// EL FALLO
//
//   La que junta vivia SOLO en la variable de entorno BOT_DEBOUNCE_SECONDS: en
//   EasyPanel, fuera de la aplicacion y con reinicio. La otra estaba en el
//   panel. Cuadrarlas entre si era imposible sin salir del editor, y en el
//   panel no habia forma de saber siquiera cuanto valia.
//
// LA VARIABLE DE ENTORNO SIGUE VALIENDO
//
//   Como respaldo. Un despliegue que aun no ha guardado desde el panel se sigue
//   comportando igual que ayer.
//
//   node scripts/prueba-las-dos-esperas-del-bot.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");
const handler = leer("src", "lib", "meta", "handler.ts");
const config = leer("src", "lib", "workflow", "config.ts");
const ruta = leer("src", "app", "api", "workflow", "route.ts");
const editor = leer("src", "app", "editor", "page.tsx");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// -- 1. EL MOTOR LEE EL PANEL, CON EL ENTORNO DE RESPALDO --------------------
comprobar(
  "el campo existe en la configuracion",
  /bot_debounce_seconds\?: number;/.test(config),
  "config.ts"
);
comprobar(
  "el motor lo lee del panel",
  /const debounceConfigurado = loadWorkflowConfig\(\)\?\.bot_debounce_seconds;/.test(
    handler
  ),
  "handler.ts"
);
// 0 TIENE QUE VALER. Es «no esperes nada», no «sin configurar». Con un `||` o
// con un `> 0` se caeria al respaldo justo cuando se quiere desactivar.
comprobar(
  "un 0 del panel se respeta, no cae al respaldo",
  /typeof debounceConfigurado === "number" && debounceConfigurado >= 0/.test(
    handler
  ),
  "0 desactiva de verdad"
);
comprobar(
  "y sin nada guardado sigue el entorno",
  /Number\(process\.env\.BOT_DEBOUNCE_SECONDS \?\? 8\)/.test(handler),
  "nadie cambia de comportamiento al deployar"
);

// -- 1 bis. MARCAR COMO LEIDO NO ES UN DELAY ---------------------------------
//
// Vivia DENTRO del `if (responseDelaySec > 0)`, asi que poner el delay humano
// en 0 —lo que uno hace para que responda rapido— apagaba de paso el doble
// check azul y el «escribiendo...». Al cliente le quedaba el mensaje sin leer
// durante toda la espera anti-rafaga: parece que lo ignoran, que es lo
// contrario de lo que se buscaba al bajarlo.
comprobar(
  "se marca leido pase lo que pase con el delay",
  (() => {
    const i = handler.indexOf("MARCAR COMO LEÍDO NO ES UN DELAY");
    if (i < 0) return false;
    const zona = handler.slice(i, i + 1600);
    const leido = zona.indexOf("await markMessageRead(waMsgId, true)");
    // Se busca la guarda DESPUES del aviso: el propio comentario la cita, y
    // buscarla desde el principio encontraba la mencion, no el codigo.
    const guarda = zona.indexOf("if (responseDelaySec > 0)", leido);
    return leido > 0 && guarda > leido;
  })(),
  "el aviso va antes que la espera"
);
comprobar(
  "y con 0 solo se salta la espera",
  /if \(responseDelaySec > 0\) \{\s*\r?\n\s*await sleep\(responseDelaySec \* 1000\);\s*\r?\n\s*\}/.test(
    handler
  ),
  "nada mas dentro de la guarda"
);

// -- 2. LA API, DE IDA Y DE VUELTA -------------------------------------------
comprobar(
  "la API lo devuelve, con el entorno de respaldo",
  /bot_debounce_seconds: num\(\s*\r?\n?\s*config\?\.bot_debounce_seconds,\s*\r?\n?\s*Number\(process\.env\.BOT_DEBOUNCE_SECONDS \?\? 8\)/.test(
    ruta
  ),
  "la casilla enseña lo que se usa"
);
comprobar(
  "y lo guarda",
  /"bot_debounce_seconds",/.test(ruta),
  "de ida"
);

// -- 3. LA PANTALLA, Y QUE SE DISTINGAN ---------------------------------------
comprobar(
  "hay casilla en Ajustes",
  /label="Espera por si sigue escribiendo \(seg\)"/.test(editor) &&
    /bot_debounce_seconds: Math\.max\(0, v\)/.test(editor),
  "junto a las otras dos"
);
// Lo que evita tocar la que no era: cada una dice si junta o no.
comprobar(
  "la que junta dice que junta",
  /ESTA es la que junta/.test(editor),
  "sin adivinar"
);
comprobar(
  "y la de apariencia dice que no",
  /NO junta mensajes, así que bajarlo no rompe nada/.test(editor),
  "se puede bajar tranquilo"
);
comprobar(
  "las dos viven en la misma tarjeta",
  (() => {
    const i = editor.indexOf("Tiempos generales (delays y limpieza)");
    if (i < 0) return false;
    const zona = editor.slice(i, i + 6000);
    return (
      /label="Delay antes de responder \(seg\)"/.test(zona) &&
      /label="Espera por si sigue escribiendo \(seg\)"/.test(zona)
    );
  })(),
  "Tiempos generales"
);

console.log(fallos === 0 ? "\nTODO OK" : `\n${fallos} FALLO(S)`);
process.exit(fallos === 0 ? 0 : 1);
