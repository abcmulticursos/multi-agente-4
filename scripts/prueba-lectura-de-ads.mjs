// Leer anuncios: con que token y de que negocio.
//
// Habia dos molestias, y las dos venian de lo mismo: el bot solo sabia leer
// anuncios con un token pegado a mano.
//
//  1. Para los anuncios del PROPIO negocio no hace falta ninguno: el token
//     permanente ya trae ads_read. Aun asi se exigia, y sin ningun lector
//     cargado la consulta ni se intentaba.
//  2. El nombre del lector se escribia a mano. Meta ya sabe de quien es el
//     token, y un nombre mal puesto engaña justo el dia que algo falla.
//
// Lo que se fija aqui:
//
//  1. Que el permanente se pruebe, y que se pruebe el ULTIMO: solo alcanza al
//     negocio dueño de la app, asi que los lectores —que son los que llegan a
//     negocios ajenos— van primero.
//  2. Que si no se sabe el nombre NO se invente ni se guarde vacio: con varios
//     tokens cargados, sin nombre no se sabria cual es cual.
//  3. Que se diga con que token se encontro, y cuales se probaron al fallar.
//
//   node scripts/prueba-lectura-de-ads.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...partes) => readFileSync(join(RAIZ, ...partes), "utf8");

const origen = leer("src", "app", "api", "meta", "ads-readers", "origin", "route.ts");
const cuenta = leer("src", "app", "api", "meta", "ads-readers", "account", "route.ts");
const alta = leer("src", "app", "api", "meta", "ads-readers", "route.ts");
const nombre = leer("src", "lib", "meta", "nombre-del-lector.ts");
const editor = leer("src", "app", "editor", "page.tsx");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// ── 1. El permanente entra en la rueda ──────────────────────────────────────
comprobar(
  "buscar un anuncio prueba también el permanente",
  /getTokenDeLaConexion\(\)/.test(origen) && /candidatos/.test(origen),
  "sí"
);
comprobar(
  "y va el ÚLTIMO, después de los lectores",
  /\.\.\.listMetaAdsReaders\(\)[\s\S]{0,220}?permanente \? \[\{ name: "token permanente"/.test(
    origen
  ),
  "lectores primero"
);
comprobar(
  "listar campañas ya no exige un lector cargado",
  /getMetaAdsReaderActivo[\s\S]{0,300}?lector \?\? \(permanente/.test(cuenta),
  "sí"
);

comprobar(
  "la pantalla del editor tampoco exige lector",
  !/if \(!readerId \|\| accountId/.test(editor) &&
    /if \(!accountId\.trim\(\)\)/.test(editor),
  "opcional"
);
comprobar(
  "el desplegable dice que sin elegir usa el permanente",
  /Mi negocio \(token permanente\)/.test(editor),
  "sí"
);

// ── 2. El nombre, sin inventar ──────────────────────────────────────────────
comprobar(
  "sin nombre, se le pregunta a Meta de quién es",
  /nombreDelNegocioDelToken\(token\)/.test(alta),
  "sí"
);
comprobar(
  "si Meta no contesta, se pide a mano — no se guarda vacío",
  /if \(!nombreFinal\) \{[\s\S]{0,260}?status: 400/.test(alta),
  "se pide"
);
comprobar(
  "el token sí sigue siendo obligatorio",
  /if \(!token\) \{[\s\S]{0,140}?status: 400/.test(alta),
  "sí"
);
comprobar(
  "si el token llega a varios negocios, se nombran todos",
  /\.join\(", "\)/.test(nombre),
  "todos"
);
comprobar(
  "preguntar el nombre nunca puede tumbar el guardado",
  /catch \{\s*return null;\s*\}/.test(nombre),
  "no lanza"
);

// ── 3. Que se sepa con cuál se leyó ─────────────────────────────────────────
comprobar(
  "el origen dice con qué token se encontró",
  /reader_name: reader\.name/.test(origen),
  "sí"
);
comprobar(
  "las campañas también",
  /leidoCon: reader\.name/.test(cuenta),
  "sí"
);
comprobar(
  "y si falla, dice cuáles se probaron",
  /Se probaron: \$\{candidatos/.test(origen),
  "sí"
);

console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} comprobación(es) mal.`);
process.exit(fallos === 0 ? 0 : 1);
