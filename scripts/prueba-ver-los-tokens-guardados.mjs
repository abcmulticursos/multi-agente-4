// Los tokens guardados se pueden VER y copiar.
//
// LO QUE PASABA
//
//   La pantalla de Meta Connect solo recibia un si o un no: «hay un token
//   guardado». El valor no salia del servidor por ningun sitio.
//
//   Asi que el token que hace falta en otras herramientas —una automatizacion,
//   una prueba a mano— no habia forma de sacarlo del panel. Tocaba ir a Meta a
//   generar otro, y cada token nuevo es uno mas que caduca por su cuenta y que
//   hay que acordarse de renovar.
//
//   Los de la pagina y los de lectura de Ads SI se podian ver. Solo estos no, y
//   eso no lo decidio nadie: simplemente nunca se hizo.
//
// COMO QUEDA
//
//   Un boton «Ver tokens» que se los pide al servidor en ese momento. Cada uno
//   en su campo, con su boton de copiar.
//
// LO QUE NO PUEDE VOLVER A PASAR
//
//   1. Que los secretos viajen dentro del estado de la pantalla al cargar. Se
//      piden al tocar el boton y se olvidan al ocultar.
//   2. Que se enseÃ±en sin decir lo que son. Con el de WhatsApp cualquiera
//      escribe a tus clientes en tu nombre.
//
//   node scripts/prueba-ver-los-tokens-guardados.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");
const pantalla = leer("src", "app", "meta-connect", "page.tsx");
const ruta = leer(
  "src",
  "app",
  "api",
  "meta",
  "connect",
  "credenciales",
  "route.ts"
);
const estado = leer("src", "app", "api", "meta", "connect", "status", "route.ts");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// -- 1. HAY DONDE PEDIRLOS --------------------------------------------------
comprobar(
  "hay una ruta que devuelve lo guardado",
  /export async function GET\(\)/.test(ruta),
  "/api/meta/connect/credenciales"
);
// LOS QUE DE VERDAD HACEN FALTA. El de WhatsApp es el que se pide en todas
// partes; los identificadores van con el para no ir a buscarlos aparte.
for (const campo of [
  "whatsAppAccessToken",
  "whatsAppTokenPermanente",
  "appSecret",
  "capiAccessToken",
  "phoneNumberId",
  "wabaId",
]) {
  comprobar(`devuelve ${campo}`, new RegExp(`${campo}:`).test(ruta), "en claro");
}
// EL PERMANENTE VA APARTE DEL DE ARRIBA, y no es repetirse: el de arriba puede
// venir del numero activo o del entorno. Verlos juntos es la unica forma de
// saber cual esta mandando de verdad.
comprobar(
  "el permanente se lee de su propio sitio",
  /getMetaRuntimeSetting\(\s*\r?\n?\s*"whatsapp_access_token_override"\s*\r?\n?\s*\)/.test(
    ruta
  ),
  "no es copia del otro"
);

// -- 2. NO VIAJAN AL CARGAR LA PANTALLA --------------------------------------
//
// El estado que se pide al abrir sigue diciendo solo SI o NO. Si algun dia
// devolviera el valor, el token estaria en el HTML de la pagina para siempre,
// lo mire alguien o no.
comprobar(
  "el estado de la pantalla sigue diciendo solo sí o no",
  /whatsAppAccessTokenConfigured: Boolean\(/.test(estado),
  "sin el valor dentro"
);
comprobar(
  "y se piden solo al tocar el botón",
  /fetch\("\/api\/meta\/connect\/credenciales", \{\s*\r?\n\s*cache: "no-store",/.test(
    pantalla
  ),
  "no al cargar"
);
// Y SE OLVIDAN AL OCULTAR: dejarlos en memoria los mantiene vivos en la pagina
// despues de haberlos escondido, que es justo lo que el boton promete deshacer.
comprobar(
  "y se olvidan al ocultar",
  /setAbierto\(false\), setDatos\(null\)/.test(pantalla),
  "esconder es esconder"
);

// -- 3. SE DICE LO QUE SON ---------------------------------------------------
//
// No es un cartel de miedo: con el de WhatsApp cualquiera puede escribir a tus
// clientes en tu nombre, y eso hay que saberlo ANTES de pegarlo en una captura.
comprobar(
  "se avisa de lo que se puede hacer con ellos",
  /se pueden enviar mensajes a tu nombre y leer/.test(pantalla),
  "antes de copiarlo"
);
// EN UN CAMPO, NO EN UN PARRAFO: un token largo hay que poder seleccionarlo
// entero, y en un parrafo se parte en renglones y al copiar se cuelan espacios.
comprobar(
  "cada uno en su campo, y se selecciona entero",
  /onFocus=\{\(e\) => e\.currentTarget\.select\(\)\}/.test(pantalla),
  "sin espacios de más"
);
comprobar(
  "y cada uno con su botón de copiar",
  /\{copiado === clave \? "Copiado" : "Copiar"\}/.test(pantalla),
  "nadie teclea un token"
);
// EL TEXTO DE ARRIBA DECIA LO CONTRARIO: «los secretos nunca se muestran». Si se
// queda, la pantalla se contradice a si misma dos parrafos mas abajo.
comprobar(
  "ya no dice que los secretos nunca se muestran",
  !/los secretos nunca se muestran/.test(pantalla),
  "no se contradice"
);

console.log(
  fallos === 0
    ? "\nTODO OK — el token guardado se puede ver y copiar"
    : `\n${fallos} FALLO(S)`
);
process.exit(fallos === 0 ? 0 : 1);
