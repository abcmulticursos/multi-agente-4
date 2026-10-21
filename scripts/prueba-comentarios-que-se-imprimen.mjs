// Ningun comentario se escapa a la pantalla.
//
// QUE PASO
//
//   Un comentario `//` puesto ENTRE ETIQUETAS salio impreso en la parte de
//   arriba del editor, en todas las pestañas:
//
//     // EL SUELO DE LA PAGINA, DEL TEMA. // // Era gris medio fijo...
//
//   En JavaScript `//` es un comentario. Dentro del JSX, entre etiquetas, es
//   TEXTO. Ahi hay que usar `{/* ... */}`.
//
// POR QUE NO LO CAZO NADIE
//
//   Compila limpio. El tipado pasa. Las 156 pruebas pasan. No hay aviso de
//   ninguna clase: solo se ve abriendo la pagina. Por eso llego hasta el
//   operador, que fue quien lo vio.
//
// COMO SE CAZA
//
//   Se mira la linea anterior a cada comentario. Si termina en `>` —o sea, una
//   etiqueta que acaba de cerrarse— estamos en posicion de HIJO, y ahi un `//`
//   es texto. Si termina en `(`, `{`, `&&`, `?`, `,`, `;` o es otro comentario,
//   estamos en codigo y el `//` es correcto.
//
//   No es perfecto, pero caza exactamente la forma en que se cuela: alguien
//   escribiendo una explicacion justo encima de la etiqueta que explica.
//
//   node scripts/prueba-comentarios-que-se-imprimen.mjs
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();

/** Todos los .tsx del proyecto: el fallo puede aparecer en cualquiera. */
function pantallas(carpeta) {
  const encontrados = [];
  for (const nombre of readdirSync(carpeta)) {
    if (nombre === "node_modules" || nombre === ".next" || nombre === ".git") {
      continue;
    }
    const ruta = join(carpeta, nombre);
    if (statSync(ruta).isDirectory()) {
      encontrados.push(...pantallas(ruta));
    } else if (nombre.endsWith(".tsx")) {
      encontrados.push(ruta);
    }
  }
  return encontrados;
}

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

const archivos = pantallas(join(RAIZ, "src"));
comprobar("se encuentran las pantallas", archivos.length > 0, `${archivos.length} .tsx`);

const sospechosos = [];
for (const ruta of archivos) {
  const lineas = readFileSync(ruta, "utf8").split(/\r?\n/);
  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    if (!/^\s*\/\/(?!\s*eslint|\s*@)/.test(linea)) continue;
    // La anterior que diga algo. Un comentario encima de otro no decide nada.
    let anterior = "";
    for (let j = i - 1; j >= 0; j--) {
      const previa = lineas[j].trim();
      if (!previa) continue;
      if (/^\/\//.test(previa)) continue;
      anterior = previa;
      break;
    }
    // Termina en `>`: una etiqueta que acaba de cerrarse. Estamos entre
    // etiquetas, o sea en posicion de hijo, y aqui `//` es texto.
    //
    // Se descartan `=>` y `->`: son flechas, no cierres de etiqueta.
    if (!/>$/.test(anterior)) continue;
    if (/[=-]>$/.test(anterior)) continue;
    sospechosos.push(
      `${ruta.slice(RAIZ.length + 1)}:${i + 1}  ${linea.trim().slice(0, 60)}`
    );
  }
}

comprobar(
  "ningun comentario cuelga entre etiquetas",
  sospechosos.length === 0,
  sospechosos.length === 0 ? "no se imprime nada" : `${sospechosos.length} suelto(s)`
);
for (const cual of sospechosos) console.log(`      ${cual}`);
if (sospechosos.length > 0) {
  console.log("\n      Se arregla poniendolo entre llaves: {/* ... */}");
}

console.log(fallos === 0 ? "\nTODO OK" : `\n${fallos} FALLO(S)`);
process.exit(fallos === 0 ? 0 : 1);
