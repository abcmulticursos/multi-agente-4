// El conjunto de datos de la propia cuenta de WhatsApp.
//
// Elegir un pixel cualquiera del desplegable tiene una trampa: si ese pixel no
// esta vinculado a la WABA, Meta acepta la eleccion pero luego RECHAZA los
// eventos de las conversaciones (subcodigo 2804132). Las compras no se
// registran y el fallo no se parece a su causa.
//
// Meta tiene una llamada que lo evita: /{waba-id}/dataset devuelve el conjunto
// de datos de esa cuenta y, si no hay, lo crea ya vinculado.
//
// Lo que se fija aqui:
//
//  1. Que el sentido sea WABA -> dataset, nunca al reves. Un pixel que ya
//     existe NO se puede vincular despues, asi que si esto se invirtiera el
//     boton prometeria algo imposible.
//  2. Que mirar y crear esten separados: el GET no puede crear nada. Un
//     conjunto de datos creado en el negocio no se deshace con un boton.
//  3. Que al crearlo quede ELEGIDO y ademas visible en el desplegable. Sin lo
//     segundo pareceria que la eleccion no se guardo.
//
//   node scripts/prueba-dataset-waba.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const ruta = readFileSync(
  join(RAIZ, "src", "app", "api", "meta", "connect", "dataset-waba", "route.ts"),
  "utf8"
);
const pagina = readFileSync(
  join(RAIZ, "src", "app", "meta-connect", "page.tsx"),
  "utf8"
);

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (nombre, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(nombre, 58)} ${valor}`);
};

// ── 1. El sentido: de la WABA sale el dataset ───────────────────────────────
comprobar(
  "la WABA es la entrada, no el pixel",
  /getActiveMetaWhatsAppConnection\(\)/.test(ruta) &&
    /conexion\.waba_id/.test(ruta),
  "waba -> dataset"
);
comprobar(
  "se llama al endpoint de la WABA",
  /\$\{wabaId\}\/dataset/.test(ruta),
  "/{waba-id}/dataset"
);
comprobar(
  "sin numero elegido no hace nada, y lo dice",
  /Primero elige el número de WhatsApp/.test(ruta),
  "sí"
);

// ── 2. Mirar y crear, separados ─────────────────────────────────────────────
const get = ruta.slice(
  ruta.indexOf("export async function GET"),
  ruta.indexOf("export async function POST")
);
comprobar(
  "consultar NO puede crear nada",
  /pedirDataset\([^)]*false\)/.test(get) && !/true\)/.test(get),
  "solo mira"
);
comprobar(
  "crear pide confirmación en la pantalla",
  /setConfirmarDataset\(true\)/.test(pagina) && /Sí, continuar/.test(pagina),
  "sí"
);
comprobar(
  "y se puede cancelar",
  /setConfirmarDataset\(false\)/.test(pagina) && /Cancelar/.test(pagina),
  "sí"
);
comprobar(
  "avisa de que los eventos viejos no se mudan",
  /no se mudan/.test(pagina),
  "sí"
);

// ── 3. No duplicar ──────────────────────────────────────────────────────────
comprobar(
  "distingue si ya existía de si se creó",
  /yaExistia: previo\.id === id/.test(ruta) && /yaExistia/.test(pagina),
  "sí"
);

// ── 4. Que la elección se vea de verdad ─────────────────────────────────────
comprobar(
  "queda elegido como el dataset activo",
  /capi_pixel_id: datasetId/.test(ruta),
  "sí"
);
comprobar(
  "y se suma al desplegable, para que se vea",
  /pixels_detectados: JSON\.stringify\(lista\)/.test(ruta),
  "sí"
);
comprobar(
  "no se duplica si ya estaba en la lista",
  /!lista\.some\(\(pixel\) => pixel\.pixelId === datasetId\)/.test(ruta),
  "sí"
);

console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} comprobación(es) mal.`);
process.exit(fallos === 0 ? 0 : 1);
