// En 👤 Usuario se puede escribir un nombre CON ESPACIOS.
//
// EL FALLO
//
//   El campo «Mi nombre» leia el valor guardado y lo recortaba con `.trim()`,
//   y ese valor recortado volvia al `value` del input. Como es un campo
//   controlado, React repinta con lo que le devuelves: el espacio recien
//   tecleado desaparecia antes de poder escribir la siguiente letra.
//
//   Escribir «Alberto Salinas» daba «AlbertoSalinas». No era que se guardara
//   mal — era imposible de teclear. Y no da error ni aviso: se ve como si el
//   teclado no respondiera a la barra espaciadora.
//
// LA REGLA
//
//   Lo que vuelve a un input es SIEMPRE el texto crudo. El recorte se hace
//   donde sirve: al guardar (la API) y al leerlo el motor. Un campo controlado
//   no puede pelearse con lo que la persona esta escribiendo.
//
// POR QUE UNA PRUEBA Y NO SOLO EL ARREGLO
//
//   Es un fallo que se reintroduce solo: quien vea `const nombre` sin recortar
//   pensara que falta el `.trim()` y lo pondra. Esta prueba dice por que no.
//
//   node scripts/prueba-el-nombre-admite-espacios.mjs
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");
const editor = leer("src", "app", "editor", "page.tsx");
const ruta = leer("src", "app", "api", "workflow", "route.ts");
const config = leer("src", "lib", "workflow", "config.ts");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// -- 1. EL CAMPO DE 👤 USUARIO -----------------------------------------------
comprobar(
  "el valor que va al input sale sin recortar",
  /const nombreEscrito =\s*\r?\n?\s*perfil\.payment_validation\?\.yape_recipient_name_starts_with \?\? "";/.test(
    editor
  ),
  "nombreEscrito"
);
comprobar(
  "y es ese el que se le devuelve al input",
  /<input\s*\r?\n\s*value=\{nombreEscrito\}/.test(editor),
  "value={nombreEscrito}"
);
// El recorte sigue existiendo, pero solo para MIRAR: si esta vacio y como se
// resume en la chapa del cuadro. Quitarlo llenaria la chapa de espacios y
// daria por lleno un campo con solo espacios.
comprobar(
  "el recorte se conserva para saber si esta vacio",
  /const nombre = nombreEscrito\.trim\(\);/.test(editor),
  "se mira recortado, se escribe crudo"
);

// -- 2. LOS DOS SITIOS QUE SI TIENEN QUE RECORTAR ----------------------------
//
// Sin ellos el arreglo dejaria colarse un espacio de sobra hasta la validacion
// del comprobante, que compara el nombre del recibo con este.
comprobar(
  "la API lo recorta al guardar",
  /\["payment_validation", "yape_recipient_name_starts_with"\],\s*\r?\n?\s*pv\.yape_recipient_name_starts_with\.trim\(\)/.test(
    ruta
  ),
  "no llega un espacio al yaml"
);
// LA INTENCION NO CAMBIA: el motor recorta el nombre al leerlo, para que la
// validacion no dependa de un espacio de sobra. Lo que cambio es DONDE: desde el
// 30/09/2026 los tres datos del cobro salen de una sola puerta —`elCobroDelPais`—
// y es ella la que recorta, con `limpio()`. Se comprueba ahi.
comprobar(
  "y el motor lo recorta al leerlo",
  /const limpio = \(v: unknown\): string => String\(v \?\? ""\)\.trim\(\);/.test(
    config
  ) &&
    /const titularDelCobrador = limpio\(delCobrador\?\.titular\);/.test(config) &&
    /const titular =\s*\r?\n?\s*titularDelCobrador \|\|\s*\r?\n?\s*limpio\(perfil\?\.payment_validation\?\.yape_recipient_name_starts_with\)/.test(
      config
    ),
  "la validacion no depende del espacio"
);

// -- 3. LA REGLA, EN TODA LA PANTALLA ----------------------------------------
//
// Ningun input ni textarea puede recibir un `value` recortado en el sitio. Es
// el mismo fallo, escrito de la forma mas corta.
const enElSitio = [
  ...editor.matchAll(/value=\{[^}\n]*\.trim\(\)[^}\n]*\}/g),
].map((m) => m[0]);
comprobar(
  "ningun campo recibe su valor recortado en el sitio",
  enElSitio.length === 0,
  enElSitio.length === 0 ? "ninguno" : enElSitio.join(" | ")
);

// Y tampoco en el resto de pantallas del panel.
const otros = [];
const recorrer = (dir) => {
  for (const item of readdirSync(join(RAIZ, ...dir), { withFileTypes: true })) {
    if (item.isDirectory()) recorrer([...dir, item.name]);
    else if (item.name.endsWith(".tsx")) {
      const txt = readFileSync(join(RAIZ, ...dir, item.name), "utf8");
      for (const m of txt.matchAll(/value=\{[^}\n]*\.trim\(\)[^}\n]*\}/g)) {
        otros.push(`${dir.join("/")}/${item.name}: ${m[0]}`);
      }
    }
  }
};
recorrer(["src"]);
comprobar(
  "ni en ninguna otra pantalla del panel",
  otros.length === 0,
  otros.length === 0 ? "ninguno" : otros.join(" | ")
);

console.log(fallos === 0 ? "\nTODO OK" : `\n${fallos} FALLO(S)`);
process.exit(fallos === 0 ? 0 : 1);
