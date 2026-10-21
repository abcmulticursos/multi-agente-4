// La foto de perfil de WhatsApp en la cabecera.
//
// Salia rota. Meta entrega esa foto como un enlace FIRMADO que caduca, y se
// pintaba ese enlace tal cual en la etiqueta de imagen: en cuanto vencia —o si
// el navegador no podia abrirlo— quedaba el icono de imagen rota.
//
// Se veia distinto en cada bot solo porque cada uno tenia su enlace con su
// antiguedad. El codigo era identico en los cuatro; no era que uno estuviera
// peor programado.
//
// Lo que se fija aqui:
//
//  1. Que la foto se pida SIEMPRE por /api/meta/avatar, que la resuelve en el
//     servidor con el token y devuelve la imagen. Esa direccion no vence.
//  2. Que no se vuelva a pintar un enlace de Meta directamente.
//  3. Que si la imagen no carga se vea la inicial, nunca el icono de rota: no
//     dice nada y parece que el bot este averiado.
//
//   node scripts/prueba-foto-de-whatsapp.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const avatar = readFileSync(
  join(RAIZ, "src", "components", "WhatsAppIdentityAvatar.tsx"),
  "utf8"
);
const proxy = readFileSync(
  join(RAIZ, "src", "app", "api", "meta", "avatar", "route.ts"),
  "utf8"
);

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

comprobar(
  "la foto se pide por el propio bot, no a Meta",
  /"\/api\/meta\/avatar\?wa=active"/.test(avatar),
  "por el bot"
);
comprobar(
  "ya no se pinta un enlace firmado de Meta",
  !/src=\{profilePictureUrl\}/.test(avatar),
  "no"
);
comprobar(
  "si la imagen no carga, se ve la inicial",
  /onError=\{\(\) => setSinFoto\(true\)\}/.test(avatar) &&
    /sinFoto \? \(\s*"W"/.test(avatar),
  "inicial"
);
comprobar(
  "las dos fotos —la chica y la grande— van igual",
  (avatar.match(/onError=\{\(\) => setSinFoto\(true\)\}/g) ?? []).length === 2,
  "las dos"
);

// El proxy es quien sostiene todo esto: si dejara de resolver el número
// activo, la cabecera se quedaría sin foto en todas partes a la vez.
comprobar(
  "el proxy entiende «el número activo»",
  /waId === "active"/.test(proxy),
  "sí"
);
comprobar(
  "y pide el enlace fresco con el token cada vez",
  /whatsapp_business_profile\?fields=profile_picture_url/.test(proxy) &&
    /cache: "no-store"/.test(proxy),
  "fresco"
);

console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} comprobación(es) mal.`);
process.exit(fallos === 0 ? 0 : 1);
