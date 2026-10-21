// Dos fichas pueden llamar igual a su muestra, y las dos tienen que salir.
//
// LO QUE PASO — 15 de septiembre de 2026, con palabras del dueno: «he puesto
// check en los 3 productos, me envio solo 2, el basico y el complementario, y no
// envio el full». Y no era la primera vez: «eso esta pasando desde hace rato».
//
// SU REPARTO DE ORDER BUMP, medido sobre su biblioteca:
//
//     BASICO   <producto A>          muestra: "<mismo nombre>"
//     FULL     <producto A + B>      muestra: "<mismo nombre>"   <- igual
//
// Y no es un descuido: el combo se llama como el basico porque LO CONTIENE, asi
// que ese choque de nombres se va a repetir siempre que alguien arme un pack.
//
// POR QUE FALLABA, EN DOS SITIOS A LA VEZ:
//
//   1. Al armar la lista de «info de contenido» (`repartirPorEtiqueta`), los
//      nombres repetidos se descartaban. La muestra del full NO ENTRABA. El
//      marcaba tres y salian dos, sin aviso en ninguna parte.
//
//   2. Y aunque hubiera entrado, quien la busca usaba `find`, que devuelve
//      SIEMPRE la primera que coincide: las dos entradas habrian caido en la
//      misma foto — la del basico dos veces y la del full nunca.
//
// Arreglar uno solo no servia de nada. Por eso esta prueba mira los dos.
//
//   node scripts/prueba-dos-muestras-con-el-mismo-nombre.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8").replace(/\r\n/g, "\n");
const config = leer("src", "lib", "workflow", "config.ts");
const llm = leer("src", "lib", "openrouter.ts");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 56)} ${valor}`);
};

// ── 1. LA LISTA YA NO PIERDE LA SEGUNDA ─────────────────────────────────────
console.log("\n— al marcar las muestras —\n");
comprobar(
  "la marca es la FICHA mas el nombre, no el nombre solo",
  /const clave = `\$\{deQuien\}\|\$\{tema\.toLowerCase\(\)\}`;/.test(config),
  "dos fichas, dos muestras"
);
comprobar(
  "y un producto que repita SU tema se sigue descartando",
  /if \(yaMarcado\.has\(clave\)\) continue;/.test(config),
  "esa guarda protegia eso"
);
comprobar(
  "queda escrito el caso que lo puso aqui",
  /DOS FICHAS PUEDEN LLAMAR IGUAL A SU MUESTRA/.test(config),
  "con su reparto"
);

// ── 2. Y QUIEN LAS BUSCA GASTA CADA IMAGEN UNA VEZ ──────────────────────────
//
// Aqui se EJECUTA el codigo real, sacado del fuente. Una copia escrita de
// memoria probaria lo que uno cree que hace, que es justo lo que se pone en duda.
console.log("\n— y al buscarlas para enviarlas —\n");
const desde = llm.indexOf("const gastadas = new Set<number>();");
const marcaFin = ".filter((item): item is NonNullable<typeof item> => !!item);";
const hasta = llm.indexOf(marcaFin, desde);
comprobar("se encuentra el buscador en el fuente", desde > 0 && hasta > desde);
const bloque = llm
  .slice(desde, hasta + marcaFin.length)
  .replace("const gastadas = new Set<number>();", "const gastadas = new Set();")
  .replace(/\.filter\(\(item\): item is NonNullable<typeof item> => !!item\);/, ".filter((item) => !!item);");
const buscar = new Function("topics", "gallery", `${bloque}\nreturn items;`);

// FIXTURE NEUTRO, a proposito: una prueba escrita con sus productos reales tapa
// justo el fallo que la regla de la casa evita.
const galeria = [
  { topic: "KIT ALFA", drive_url: "u1" },   // base
  { topic: "KIT BETA", drive_url: "u2" },   // complemento
  { topic: "KIT ALFA", drive_url: "u3" },   // el pack, que se llama como el base
];
const marcados = ["KIT ALFA", "KIT BETA", "KIT ALFA"];
const salen = buscar(marcados, galeria);

comprobar("salen las TRES muestras marcadas", salen.length === 3, `${salen.length} de 3`);
comprobar(
  "y son tres imagenes DISTINTAS",
  new Set(salen.map((x) => x.drive_url)).size === 3,
  salen.map((x) => x.drive_url).join(", ")
);
comprobar(
  "la del pack es la que antes no salia nunca",
  salen.some((x) => x.drive_url === "u3"),
  "la segunda con el mismo nombre"
);
comprobar(
  "y en el orden de los puestos",
  salen.map((x) => x.drive_url).join(",") === "u1,u2,u3",
  salen.map((x) => x.drive_url).join(",")
);

// CON NOMBRES DISTINTOS NO CAMBIA NADA. Es la mitad que protege lo que ya
// funcionaba: «la primera sin gastar» y «la primera» son la misma imagen.
console.log("\n— y lo de siempre sigue igual —\n");
const galeriaNormal = [
  { topic: "UNO", drive_url: "a" },
  { topic: "DOS", drive_url: "b" },
  { topic: "TRES", drive_url: "c" },
];
const normal = buscar(["UNO", "DOS", "TRES"], galeriaNormal);
comprobar(
  "con nombres distintos salen las mismas de antes",
  normal.map((x) => x.drive_url).join(",") === "a,b,c",
  normal.map((x) => x.drive_url).join(",")
);
const parcial = buscar(["UNO", "TRES"], galeriaNormal);
comprobar(
  "y marcando solo algunas, salen solo esas",
  parcial.map((x) => x.drive_url).join(",") === "a,c",
  parcial.map((x) => x.drive_url).join(",")
);
const inexistente = buscar(["UNO", "NO EXISTE"], galeriaNormal);
comprobar(
  "un tema que no existe sigue sin resolverse",
  inexistente.length === 1,
  "lo detecta el aviso de configuracion de arriba"
);

console.log(
  fallos === 0
    ? "\nTODO OK — dos muestras con el mismo nombre salen las dos\n"
    : `\n${fallos} comprobacion(es) mal.\n`
);
process.exit(fallos === 0 ? 0 : 1);
