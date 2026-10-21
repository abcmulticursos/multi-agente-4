// UNA CONEXIÓN SIN NEGOCIO SIGUE SIENDO ELEGIBLE.
//
// EL RIESGO, y es el más probable de todos: sus conexiones de antes quedan como «Cuenta sin
// identificar» hasta que pulse «Actualizar lista de Meta». Si el selector acotado solo
// ofrece lo del MISMO negocio y el negocio está vacío, puede que no pueda elegir ni su
// página ni su píxel — y se quede sin poder configurar nada.
//
// Lo que se exige: con el negocio vacío o nulo, los selectores de página y de píxel
// SIGUEN OFRECIENDO OPCIONES. Lo vacío se agrupa bajo «Cuenta sin identificar»; no se
// excluye.
//
// Ejecuta `src/lib/meta/cuentas.ts` DE VERDAD (lo usan el pop up Tiendas del editor y
// Meta Connect), con conexiones inventadas.
//
//   node scripts/prueba-cuenta-sin-identificar-no-bloquea.mjs
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { readFileSync } from "node:fs";

const RAIZ = process.cwd();
const { soloDeLaCuenta, cuentaDeLaTienda } = await import(
  pathToFileURL(join(RAIZ, "src", "lib", "meta", "cuentas.ts")).href
);

let fallos = 0;
const pad = (s, n) => (String(s ?? "") + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 66)} ${valor}`);
};

// Lo que ve el pop up Tiendas: la cuenta de la tienda sale de su número.
const selectores = (conectado, tienda) => {
  const { cuenta } = cuentaDeLaTienda(tienda, conectado, null);
  return {
    paginas: soloDeLaCuenta(conectado.paginas, cuenta?.id, tienda.pagina).visibles.map((o) => o.id),
    pixels: soloDeLaCuenta(conectado.pixels, cuenta?.id, tienda.pixel).visibles.map((o) => o.id),
  };
};

console.log("\n— 1. todo sin identificar, como quedan sus conexiones de antes —\n");
for (const vacio of [null, undefined, ""]) {
  const nombre = vacio === "" ? "vacío" : String(vacio);
  const conectado = {
    numeros: [{ id: "N1", cuenta: vacio, cuentaNombre: vacio }],
    paginas: [{ id: "P1", cuenta: vacio, cuentaNombre: vacio }, { id: "P2", cuenta: vacio }],
    pixels: [{ id: "X1", cuenta: vacio, cuentaNombre: vacio }],
  };
  const s = selectores(conectado, { numero: "N1" });
  comprobar(`negocio ${nombre}: se ofrecen sus páginas`, s.paginas.length === 2, s.paginas.join(","));
  comprobar(`negocio ${nombre}: se ofrece su píxel`, s.pixels.length === 1, s.pixels.join(","));
}

console.log("\n— 2. la tienda todavía sin número —\n");
{
  const conectado = {
    numeros: [],
    paginas: [{ id: "P1", cuenta: "B1", cuentaNombre: "Negocio uno" }, { id: "P2", cuenta: null }],
    pixels: [{ id: "X1", cuenta: null }],
  };
  const s = selectores(conectado, { numero: "" });
  comprobar("sin número no se esconde nada", s.paginas.length === 2 && s.pixels.length === 1);
}

console.log("\n— 3. el número ya identificado y la página o el píxel todavía no —\n");
// Pasa cuando «Actualizar lista de Meta» identifica el número pero la consulta del dueño
// de una página falla (`cuentaDeLaPagina` es tolerante: si falla, la página se guarda sin
// negocio). Según lo pedido, lo vacío no excluye.
{
  const conectado = {
    numeros: [{ id: "N1", cuenta: "B1", cuentaNombre: "Negocio uno" }],
    paginas: [{ id: "P1", cuenta: null, cuentaNombre: null }],
    pixels: [{ id: "X1", cuenta: null, cuentaNombre: null }],
  };
  const s = selectores(conectado, { numero: "N1" });
  comprobar("la página sin negocio se sigue ofreciendo", s.paginas.length === 1, s.paginas.join(",") || "(ninguna)");
  comprobar("el píxel sin negocio se sigue ofreciendo", s.pixels.length === 1, s.pixels.join(",") || "(ninguno)");
  const puesta = selectores(conectado, { numero: "N1", pagina: "P1", pixel: "X1" });
  comprobar(
    "la que ya tenía puesta no desaparece",
    puesta.paginas.includes("P1") && puesta.pixels.includes("X1")
  );
}

console.log("\n— 4. y lo que sí es de su cuenta, o compartido con ella, se ofrece —\n");
{
  const conectado = {
    numeros: [{ id: "N1", cuenta: "B1", cuentaNombre: "Negocio uno" }],
    paginas: [
      { id: "P1", cuenta: "B1" },
      { id: "P2", cuenta: "B2", accesoDe: [{ id: "B1", nombre: "Negocio uno" }] },
    ],
    pixels: [{ id: "X1", cuenta: "B1" }],
  };
  const s = selectores(conectado, { numero: "N1" });
  comprobar("la suya y la compartida", s.paginas.join(",") === "P1,P2", s.paginas.join(","));
  comprobar("y su píxel", s.pixels.join(",") === "X1");
}

console.log("\n— 5. Meta Connect agrupa lo vacío, no lo quita —\n");
{
  const pagina = readFileSync(join(RAIZ, "src", "app", "meta-connect", "page.tsx"), "utf8");
  comprobar(
    "las páginas sin negocio van a «Cuenta sin identificar»",
    /grupo: conn\.businessName \?\? "Cuenta sin identificar"/.test(pagina)
  );
  comprobar(
    "los números sin negocio, igual",
    /grupo: connection\.businessName \?\? "Cuenta sin identificar"/.test(pagina)
  );
  comprobar(
    "los píxeles sin negocio van a «Sin negocio identificado»",
    /grupo: pixel\.businessName \?\? "Sin negocio identificado"/.test(pagina)
  );
}

console.log("");
if (fallos > 0) {
  console.log(`${fallos} FALLA(S)`);
  process.exit(1);
}
console.log("TODO OK — sin negocio identificado, se sigue pudiendo elegir");
