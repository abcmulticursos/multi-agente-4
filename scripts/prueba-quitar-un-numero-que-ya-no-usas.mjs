// QUITAR UN NÚMERO QUE YA NO USAS, esté activo o no.
//
// LO PIDIÓ EL DUEÑO el 1 de octubre de 2026. Había borrado números en Meta, seguían
// apareciendo en la lista de su bot, y buscó cómo quitarlos: «en el pop up no aparece
// la lista ni quitar, esta oculto creo yo».
//
// NO ESTABA OCULTO: NO EXISTÍA. El botón de desconectar solo se dibujaba para el
// número ACTIVO. Los viejos —que por definición no lo son— solo ofrecían «Usar este
// numero», así que la única forma de quitar uno era ACTIVARLO primero... y activar un
// número muerto es justo lo que no hay que hacer.
//
// POR QUÉ IMPORTA, y no es cosmético: el bot usa el número ACTIVO cuando manda algo
// sin conversación detrás. Si el activo fuera un número que ya no existe en Meta, esos
// envíos fallan. Dejar basura en la lista es dejar candidatos a activo.
//
// Y HAY UN SEGUNDO HALLAZGO, anotado aquí para que no se pierda: existe una función
// escrita para limpiar la lista sola —`reconcileMetaConnectSnapshot`, cuyo comentario
// dice «mantiene la lista alineada con lo que devolvió la última autorización»— y
// NADIE LA LLAMA. Es la caja que nadie abre, otra vez. Mientras siga así, la limpieza
// es a mano y este botón es la única forma de hacerla.
//
//   node scripts/prueba-quitar-un-numero-que-ya-no-usas.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const pantalla = readFileSync(
  join(RAIZ, "src", "app", "meta-connect", "page.tsx"),
  "utf8"
);
const api = readFileSync(
  join(RAIZ, "src", "app", "api", "meta", "connect", "remove", "route.ts"),
  "utf8"
);
const db = readFileSync(join(RAIZ, "src", "lib", "db.ts"), "utf8");

let fallos = 0;
const pad = (s, n) => (String(s ?? "") + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// ── 1. SE PUEDE QUITAR SIN ACTIVARLO ────────────────────────────────────────
console.log("\n— 1. un número no activo también se puede quitar —\n");
// La rama del `else` es la de los NO activos. Ahí tiene que haber una llamada a
// `removeConnection`, o volvemos a obligar a activarlo para poder quitarlo.
// El hueco es ancho a propósito: en medio va el comentario que explica el fallo, y
// una prueba que se rompe al escribir un comentario obliga a no escribirlos.
const ramaDeNoActivos =
  pantalla.match(
    // El 22/10/2026 el botón pasó de «Usar este numero» a «Hacerlo principal».
    /"(?:Usar este numero|Hacerlo principal)"\}[\s\S]{0,4000}?<\/>/
  )?.[0] ?? "";
comprobar(
  "la rama del número NO activo existe",
  ramaDeNoActivos.length > 0,
  "es la que ofrece «Usar este numero»"
);
comprobar(
  "y ahí se puede quitar",
  /removeConnection\("whatsapp", connection\.phoneNumberId/.test(ramaDeNoActivos),
  "sin activarlo primero"
);
comprobar(
  "con una papelera que se ve",
  /🗑️/.test(ramaDeNoActivos),
  "no un clic derecho escondido"
);
comprobar(
  "y dice qué hace al pasar por encima",
  /no se toca nada en Meta/.test(ramaDeNoActivos),
  "quita del bot, no de Meta"
);

// ── 2. EL ACTIVO SIGUE COMO ESTABA ──────────────────────────────────────────
//
// No se le cambia nada: su botón «Desconectar» de siempre, con su texto.
console.log("\n— 2. el número activo no se toca —\n");
comprobar(
  "sigue teniendo su «Desconectar»",
  /\? "Desconectando\.\.\."\s*\r?\n?\s*: "Desconectar"/.test(pantalla)
);

// ── 3. LA CONFIRMACIÓN DICE LA VERDAD ───────────────────────────────────────
//
// Es lo que evita el susto: quitar aquí NO borra el número en Meta. Si el aviso
// no lo dijera, nadie se atrevería a pulsarlo — o peor, lo pulsaría creyendo que
// está borrando el número de verdad.
console.log("\n— 3. se avisa de que Meta no se toca —\n");
comprobar(
  "la confirmación lo dice",
  /No se eliminara ni desconectara en Meta/.test(pantalla)
);

// ── 4. LA PUERTA DE ATRÁS EXISTE Y BORRA DE VERDAD ──────────────────────────
console.log("\n— 4. del lado del servidor —\n");
comprobar(
  "la ruta acepta quitar un whatsapp",
  /removeMetaWhatsAppConnection\(id\)/.test(api)
);
comprobar(
  "y exige decir de qué tipo es",
  /body\?\.type !== "page" && body\?\.type !== "whatsapp"/.test(api),
  "no borra por un id suelto"
);
comprobar(
  "la base lo borra por su phone_number_id",
  /export function removeMetaWhatsAppConnection\(phoneNumberId: string\): boolean/.test(
    db
  )
);

// ── 5. LO QUE SIGUE PENDIENTE, ESCRITO PARA QUE NO SE PIERDA ────────────────
//
// Si algún día alguien conecta esta función, esta comprobación se pondrá roja y
// quien la lea sabrá que la limpieza a mano ya no es la única vía.
console.log("\n— 5. la limpieza automática sigue sin enchufar —\n");
{
  const llamadas = (
    readFileSync(join(RAIZ, "src", "lib", "db.ts"), "utf8").match(
      /reconcileMetaConnectSnapshot/g
    ) ?? []
  ).length;
  comprobar(
    "«reconcile» está escrita",
    /export function reconcileMetaConnectSnapshot\(/.test(db),
    "limpiaría la lista sola"
  );
  comprobar(
    "y HOY nadie la llama — por eso hace falta la papelera",
    llamadas === 1,
    `${llamadas} aparición(es): solo su definición`
  );
}

console.log(
  fallos === 0
    ? "\nTODO OK — un número viejo se quita sin tener que activarlo\n"
    : `\n${fallos} FALLO(S)\n`
);
process.exit(fallos === 0 ? 0 : 1);
