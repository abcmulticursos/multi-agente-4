// EL ORDEN DE «TUS PRODUCTOS», EJECUTADO DE VERDAD.
//
// LO QUE PIDIÓ EL DUEÑO — 20 de septiembre de 2026, con sus palabras:
//
//   «Cuando yo creo un producto nuevo debe aparecer arriba, pero JAMÁS estar
//    sobre los productos que ya fueron seleccionados. Los productos
//    seleccionados tienen prioridad: arriba el básico, luego el complementario
//    (si existiese), luego el full, al final el upsell, y si hubiesen más
//    productos todo en orden jerárquico.
//
//    Subir y bajar con su flecha sin nombre, pero JAMÁS deben subir sobre los
//    que ya fueron elegidos: su tope es debajo del último elegido.»
//
// POR QUÉ ESTA PRUEBA SACA EL CÓDIGO DEL ARCHIVO EN VEZ DE REESCRIBIRLO.
// Reimplementar la regla aquí probaría lo que yo creo que hace, que es
// justamente lo que hay que poner en duda. Así que se extrae el orden real y la
// función real de mover, y se EJECUTAN.
//
// LA TRAMPA QUE VIGILA EL CASO 3. La lista de pantalla y la lista guardada NO
// están en el mismo orden en cuanto hay alguno jugando. Intercambiar por la
// posición de pantalla movería un producto distinto del que se pulsó. Por eso
// cada fila arrastra el índice de la lista guardada, y esto lo comprueba.
//
//   node scripts/prueba-el-orden-de-tus-productos.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const editor = readFileSync(
  join(RAIZ, "src", "app", "editor", "page.tsx"),
  "utf8"
).replace(/\r\n/g, "\n");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 60)} ${valor}`);
};

// ── 1. LA JERARQUÍA SALE DE `PUESTOS`, NO ESTÁ ESCRITA APARTE ──────────────
//
// Es lo que hace que el día que se añada un puesto en medio, la lista lo
// coloque sola. Si alguien escribe el orden a mano en otro sitio, hay dos
// verdades y algún día discrepan.
console.log("\n— la jerarquía que pidió —\n");

const bloquePuestos = (editor.match(/const PUESTOS = \[([\s\S]*?)\n\];/) ?? [])[1] ?? "";
const orden = [...bloquePuestos.matchAll(/valor:\s*"([a-z_]+)" as const/g)].map(
  (m) => m[1]
);
comprobar("se encuentra la lista de puestos", orden.length > 0, orden.join(" → "));
comprobar(
  "  básico, complementario, full, upsell — en ese orden",
  JSON.stringify(orden) ===
    JSON.stringify(["unico", "basico", "complementario", "full", "upsell"]),
  orden.join(" → ")
);
comprobar(
  "el orden NO se reescribe a mano en la biblioteca",
  !/ORDEN_DE_PUESTOS|const jerarquia\s*=/.test(editor),
  "se lee de PUESTOS"
);
comprobar(
  "el rango se saca de PUESTOS con findIndex",
  /PUESTOS\.findIndex\(\(p\) => p\.valor === puesto\)/.test(editor)
);

// ── 2. LA LISTA SE ORDENA: LOS QUE JUEGAN ARRIBA ───────────────────────────
console.log("\n— los elegidos mandan, y en su orden —\n");

const lineaOrden = (editor.match(
  /\.sort\(\(a, b\) => (a\.rango - b\.rango \|\| a\.indice - b\.indice)\)/
) ?? [])[1];
comprobar("se encuentra la regla de orden", !!lineaOrden, lineaOrden ?? "—");

const SIN_PUESTO = Number.MAX_SAFE_INTEGER;
const ordenar = new Function(
  "filas",
  `return [...filas].sort((a, b) => ${lineaOrden ?? "0"});`
);

// El caso real: cuatro jugando, dos sin usar, y guardados en desorden.
const guardados = [
  { id: "quimicos", rango: SIN_PUESTO },
  { id: "pantonera", rango: 4 }, // upsell
  { id: "cliches", rango: SIN_PUESTO },
  { id: "combo", rango: 3 }, // full
  { id: "papel", rango: 2 }, // complementario
  { id: "tintas", rango: 1 }, // básico
];
const filas = guardados.map((x, indice) => ({ ...x, indice }));
const pintado = ordenar(filas).map((x) => x.id);
comprobar(
  "  se pintan en la jerarquía pedida",
  JSON.stringify(pintado) ===
    JSON.stringify([
      "tintas",
      "papel",
      "combo",
      "pantonera",
      "quimicos",
      "cliches",
    ]),
  pintado.join(" · ")
);
comprobar(
  "  y los de sin usar conservan su orden guardado",
  pintado.indexOf("quimicos") < pintado.indexOf("cliches"),
  "quimicos antes que cliches, como estaban"
);

// ── 3. LAS FLECHAS, CON SU TOPE ────────────────────────────────────────────
//
// Se extrae la función REAL y se corre. Lo que se comprueba no es que exista:
// es dónde deja la lista.
console.log("\n— subir y bajar, sin pisar a los elegidos —\n");

const cuerpoMover = (editor.match(
  /const mover = \(id: string, paso: -1 \| 1\) => \{([\s\S]*?)\n  \};/
) ?? [])[1];
comprobar("se encuentra la función de mover", !!cuerpoMover);

const sinTipos = (cuerpoMover ?? "")
  .replace(/: string/g, "")
  .replace(/: -1 \| 1/g, "");

function correrMover(productos, alineados, id, paso) {
  const rango = (pid) => (pid in alineados ? alineados[pid] : SIN_PUESTO);
  const enPantalla = productos
    .map((producto, indice) => ({ producto, indice, rango: rango(producto.id) }))
    .sort((a, b) => a.rango - b.rango || a.indice - b.indice);
  let salida = null;
  const fn = new Function(
    "id",
    "paso",
    "enPantalla",
    "productos",
    "SIN_PUESTO",
    "onSnapshot",
    "onEdit",
    "onProductos",
    sinTipos
  );
  fn(
    id,
    paso,
    enPantalla,
    productos,
    SIN_PUESTO,
    () => {},
    () => {},
    (lista) => {
      salida = lista.map((p) => p.id);
    }
  );
  return salida;
}

const lista = [
  { id: "tintas" },
  { id: "papel" },
  { id: "combo" },
  { id: "pantonera" },
  { id: "quimicos" },
  { id: "cliches" },
];
const alineados = { tintas: 1, papel: 2, combo: 3, pantonera: 4 };

comprobar(
  "  un producto CON puesto no se mueve",
  correrMover(lista, alineados, "tintas", 1) === null,
  "la alineación manda, no esta lista"
);
comprobar(
  "  el primero sin puesto NO puede subir ← SU TOPE",
  correrMover(lista, alineados, "quimicos", -1) === null,
  "encima solo hay elegidos"
);
comprobar(
  "  el último sin puesto no puede bajar",
  correrMover(lista, alineados, "cliches", 1) === null
);
comprobar(
  "  dos sin puesto SÍ se intercambian",
  JSON.stringify(correrMover(lista, alineados, "cliches", -1)) ===
    JSON.stringify([
      "tintas",
      "papel",
      "combo",
      "pantonera",
      "cliches",
      "quimicos",
    ]),
  (correrMover(lista, alineados, "cliches", -1) ?? []).join(" · ")
);

// LA TRAMPA: guardados en desorden, pantalla en orden. Mover por la posición
// de PANTALLA movería el producto equivocado.
const desordenada = [
  { id: "quimicos" },
  { id: "pantonera" },
  { id: "cliches" },
  { id: "combo" },
  { id: "papel" },
  { id: "tintas" },
];
comprobar(
  "  y acierta aunque lo guardado esté en otro orden",
  JSON.stringify(correrMover(desordenada, alineados, "cliches", -1)) ===
    JSON.stringify([
      "cliches",
      "pantonera",
      "quimicos",
      "combo",
      "papel",
      "tintas",
    ]),
  (correrMover(desordenada, alineados, "cliches", -1) ?? []).join(" · ")
);

// ── 4. EL NUEVO NACE ARRIBA, Y SE ABRE ─────────────────────────────────────
console.log("\n— al crear y al duplicar —\n");

const cuerpoAgregar = (editor.match(
  /const agregar = \(\) => \{([\s\S]*?)\n  \};/
) ?? [])[1] ?? "";
comprobar(
  "el nuevo se pone al PRINCIPIO de la lista",
  /onProductos\(\[nuevo, \.\.\.productos\]\)/.test(cuerpoAgregar),
  "antes se añadía al final y se perdía de vista"
);
comprobar(
  "  y se abre su ficha",
  /setAbierto\(nuevo\.id\)/.test(cuerpoAgregar)
);
comprobar(
  "  con el nombre enfocado",
  /setRecienCreado\(nuevo\.id\)/.test(cuerpoAgregar)
);
comprobar(
  "  y limpiando el buscador, o nacería escondido",
  /setBusqueda\(""\)/.test(cuerpoAgregar)
);

const cuerpoDuplicar = (editor.match(
  /const duplicar = \(id: string\) => \{([\s\S]*?)\n  \};/
) ?? [])[1] ?? "";
comprobar(
  "al duplicar también se abre con el nombre enfocado",
  /setRecienCreado\(copia\.id\)/.test(cuerpoDuplicar) &&
    /setAbierto\(copia\.id\)/.test(cuerpoDuplicar)
);
comprobar(
  "  y el «(copia)» sale seleccionado para escribir encima",
  /if \(recienCreado === producto\.id\) e\.currentTarget\.select\(\)/.test(editor)
);
comprobar(
  "  el foco SOLO en el recién creado",
  /autoFocus=\{recienCreado === producto\.id\}/.test(editor),
  "entrar a una ficha vieja no roba el foco"
);

// ── 5. EL BUSCADOR NO PUEDE PERDER NADA ────────────────────────────────────
console.log("\n— el buscador —\n");

comprobar(
  "filtra solo lo que se VE, no la lista guardada",
  /const visibles = filtro\s*\?\s*enPantalla\.filter/.test(editor),
  "productos nunca se reescribe al buscar"
);
comprobar(
  "busca también por los alias",
  /producto\.aliases \?\? \[\]\)\.join\(" "\)/.test(editor)
);
comprobar(
  "sin tildes a los dos lados",
  /normalize\("NFD"\)[\s\S]{0,80}\\p\{Mn\}/.test(editor)
);
comprobar(
  "con el buscador puesto, las flechas se apagan",
  /const puedeSubir =\s*\n?\s*!filtro/.test(editor),
  "reordenar media lista mueve lo que no se ve"
);

// ── 6. LO QUE NO SE PUEDE HABER ROTO ───────────────────────────────────────
console.log("\n— y lo que ya estaba sigue en pie —\n");

comprobar(
  "mover deja constancia para poder deshacer",
  /const mover = [\s\S]{0,400}onSnapshot\(\);[\s\S]{0,60}onEdit\("biblioteca"\)/.test(
    editor
  ),
  "sin esto, Cancelar no devolvería el orden"
);
comprobar(
  "el id sigue saliendo del reloj, no de la posición",
  /id: `p\$\{Date\.now\(\)\.toString\(36\)\}`/.test(editor),
  "mover productos no puede hacer que uno herede otra ficha"
);
comprobar(
  "duplicar sigue sin llevarse el puesto",
  /etiqueta: "",/.test(cuerpoDuplicar),
  "dos productos en el mismo asiento no caben"
);

console.log(`\n${fallos === 0 ? "TODO EN VERDE" : `${fallos} EN ROJO`}\n`);
process.exit(fallos === 0 ? 0 : 1);
