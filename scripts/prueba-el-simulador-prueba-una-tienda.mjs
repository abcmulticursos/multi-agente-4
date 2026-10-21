// EL SIMULADOR PRUEBA UNA TIENDA, SIN GASTAR UNA CONVERSACIÓN.
//
// LO PIDIÓ EL DUEÑO el 1 de octubre de 2026: «yo no puedo probar en celular, me van a
// cobrar por conversación. Necesito testear en el simulador, busca la manera».
//
// Y tenía razón en las dos cosas: desde el 1 de octubre Meta cobra POR MENSAJE, así
// que probar una tienda escribiendo de verdad cuesta dinero cada vez.
//
// EL PROBLEMA: la tienda se encuentra por el número de WhatsApp —o por la página, en
// Messenger— y el simulador no entraba por ninguno de los dos. Así que no encontraba
// tienda y vendía el contenido general con la cuenta del dueño. Él habría probado, lo
// habría visto cobrar a su propia cuenta, y habría pensado que el trabajo estaba roto.
//
// CÓMO SE RESUELVE, Y POR QUÉ ASÍ: se le escribe a la conversación de prueba el MISMO
// dato con el que entra un cliente real. De ahí en adelante el motor lee exactamente
// lo que leería en vivo, así que no hay un «camino de prueba» aparte — que es como se
// acaba probando algo que no es lo que pasa.
//
//   node scripts/prueba-el-simulador-prueba-una-tienda.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const ruta = readFileSync(
  join(RAIZ, "src", "app", "api", "test-simulator", "route.ts"),
  "utf8"
);
const pantalla = readFileSync(
  join(RAIZ, "src", "app", "simulador", "page.tsx"),
  "utf8"
);

let fallos = 0;
const pad = (s, n) => (String(s ?? "") + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// ── 1. LA PRUEBA ENTRA CON EL DATO DE VERDAD ────────────────────────────────
//
// No con una copia ni con una marca de «esto es una prueba»: con el mismo campo que
// trae un cliente real. Es lo que hace que lo que se vea sea lo que va a pasar.
console.log("\n— 1. entra con el mismo dato que un cliente —\n");
comprobar(
  "en WhatsApp se escribe el número de la tienda",
  /setConversationWaPhoneNumberId\(convo\.id, String\(suya\.numero \?\? ""\)\.trim\(\)\)/.test(
    ruta
  ),
  "el mismo campo que en vivo"
);
comprobar(
  "y en Messenger, su página",
  /setConversationMessengerPage\(convo\.id, String\(suya\.pagina \?\? ""\)\.trim\(\)\)/.test(
    ruta
  )
);
// SOLO EL DEL CANAL QUE SE SIMULA. Escribir los dos haría que la tienda se encontrara
// por un camino que en vivo no existe para ese canal, y la prueba mentiría.
comprobar(
  "solo el del canal que se está simulando",
  /if \(channel === "whatsapp"\) \{[\s\S]{0,200}?\} else \{/.test(ruta),
  "o la prueba mentiría"
);
comprobar(
  "una tienda que no existe no rompe nada",
  /const suya = \(loadWorkflowConfig\(\)\?\.tiendas \?\? \[\]\)\.find\(/.test(ruta) &&
    /if \(suya\) \{/.test(ruta),
  "sigue sin tienda, como antes"
);
comprobar(
  "y sin pedir tienda, el simulador es el de siempre",
  /const idDeLaTienda =\s*\r?\n?\s*typeof body\.tienda === "string" \? body\.tienda\.trim\(\) : "";/.test(
    ruta
  ),
  "vacío = sin tienda"
);

// ── 2. LA LISTA, LIGERA ─────────────────────────────────────────────────────
//
// De toda la configuración el simulador solo necesita el id y el nombre. Traerse el
// archivo entero para pintar un desplegable es cargar megas por dos campos.
console.log("\n— 2. la lista de tiendas —\n");
comprobar(
  "hay un sitio que solo devuelve las tiendas",
  /searchParams\.get\("tiendas"\) === "1"/.test(ruta)
);
comprobar(
  "y dice si atiende cada canal",
  /tieneNumero: Boolean\(String\(t\?\.numero \?\? ""\)\.trim\(\)\)/.test(ruta) &&
    /tienePagina: Boolean\(String\(t\?\.pagina \?\? ""\)\.trim\(\)\)/.test(ruta),
  "para avisar antes de probar"
);

// ── 3. CADA TIENDA, SU PROPIA CONVERSACIÓN ──────────────────────────────────
//
// LA PARTE QUE MÁS IMPORTA DE LA PANTALLA. La tienda se escribe en la conversación al
// CREARLA. Si al cambiar de tienda se reusara la conversación anterior, se estaría
// probando la tienda de antes y nada lo diría: el peor tipo de prueba, la que da un
// resultado creíble y falso.
console.log("\n— 3. cambiar de tienda abre un chat nuevo —\n");
comprobar(
  "la tienda entra en la llave de la sesión",
  /function keyFor\(\s*\r?\n?\s*channel: TestChannel,\s*\r?\n?\s*country: CountryCode \| "ASK",\s*\r?\n?\s*tienda: string\s*\r?\n?\s*\)/.test(
    pantalla
  ),
  "o se reusaría la de antes"
);
comprobar(
  "y hay una función propia para cambiarla",
  /async function cambiarTienda\(siguiente: string\)/.test(pantalla)
);
comprobar(
  "que crea una sesión nueva si no la había",
  /await createSession\(channel, country, siguiente\);/.test(pantalla)
);

// ── 4. SE AVISA SI ESA TIENDA NO ATIENDE ESE CANAL ──────────────────────────
//
// Sin el aviso la prueba sale sin tienda y parece que el bot la ignora. Es el mismo
// tipo de silencio que esta casa persigue: algo que no pasa y nadie dice por qué.
console.log("\n— 4. avisa antes de probar en balde —\n");
comprobar(
  "dice que saldrá sin tienda",
  /así que en este canal la prueba saldrá sin tienda/.test(pantalla)
);
comprobar(
  "y nombra lo que le falta",
  /channel === "whatsapp" \? "número de WhatsApp" : "página de Facebook"/.test(
    pantalla
  )
);

// ── 5. SIN TIENDAS CREADAS, NADA ESTORBA ────────────────────────────────────
console.log("\n— 5. sin tiendas, el simulador de siempre —\n");
comprobar(
  "el selector no se pinta",
  (pantalla.match(/tiendas\.length > 0 && \(/g) ?? []).length === 2,
  "arriba y dentro del chat"
);
comprobar(
  "y si la lista falla, el simulador sigue sirviendo",
  /\.catch\(\(\) => \{[\s\S]{0,260}?\}\);/.test(pantalla),
  "no se corta la prueba por esto"
);

console.log(
  fallos === 0
    ? "\nTODO OK — se puede probar una tienda sin gastar una conversación\n"
    : `\n${fallos} FALLO(S)\n`
);
process.exit(fallos === 0 ? 0 : 1);
