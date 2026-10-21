// EL AVISO DE MEZCLA NO GRITA SIN MOTIVO.
//
// EL RIESGO: si el aviso ⚠️ aparece cuando no hay mezcla de verdad —por ejemplo porque uno
// de los dos negocios está sin identificar— él va a desconfiar de la pantalla entera.
//
//   Página del negocio A + píxel del negocio B        → AVISA
//   Página y píxel del mismo negocio                  → no avisa
//   Alguno sin negocio identificado                   → NO avisa: no saber no es mezclar
//   Un píxel compartido entre dos negocios            → no avisa: es real y legítimo
//
// La cuenta de la tienda la fija su número (ver `src/lib/meta/cuentas.ts`), así que en
// todos los casos el número es del negocio A salvo donde se dice.
//
// Ejecuta `cuentaDeLaTienda` DE VERDAD: es la misma función que pinta el aviso en las
// tarjetas de Meta Connect y dentro de la tienda, en el editor.
//
//   node scripts/prueba-el-aviso-de-mezcla-no-miente.mjs
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { readFileSync } from "node:fs";

const RAIZ = process.cwd();
const { cuentaDeLaTienda } = await import(
  pathToFileURL(join(RAIZ, "src", "lib", "meta", "cuentas.ts")).href
);

let fallos = 0;
const pad = (s, n) => (String(s ?? "") + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 60)} ${valor}`);
};

const A = { cuenta: "BA", cuentaNombre: "Negocio A" };
const B = { cuenta: "BB", cuentaNombre: "Negocio B" };
const SIN = { cuenta: null, cuentaNombre: null };
const conectado = {
  numeros: [
    { id: "NA", ...A },
    { id: "NSIN", ...SIN },
  ],
  paginas: [
    { id: "PA", etiqueta: "Página A", ...A },
    { id: "PB", etiqueta: "Página B", ...B },
    { id: "PSIN", etiqueta: "Página sin dueño", ...SIN },
  ],
  pixels: [
    { id: "XA", etiqueta: "Píxel A", ...A },
    { id: "XB", etiqueta: "Píxel B", ...B },
    { id: "XSIN", etiqueta: "Píxel sin dueño", ...SIN },
    { id: "XCOMP", etiqueta: "Píxel compartido", ...B, accesoDe: [{ id: "BB", nombre: "Negocio B" }, { id: "BA", nombre: "Negocio A" }] },
  ],
};
const aviso = (tienda, general = null) => cuentaDeLaTienda(tienda, conectado, general).mezcla;
const corto = (s) => (s ? s.slice(0, 50) + "…" : "(sin aviso)");

console.log("\n— 1. mezcla de verdad: avisa —\n");
{
  const m = aviso({ numero: "NA", pagina: "PA", pixel: "XB" });
  comprobar("página de A + píxel de B", !!m, corto(m));
  const p = aviso({ numero: "NA", pagina: "PB", pixel: "XA" });
  comprobar("página de B + píxel de A", !!p, corto(p));
  const g = aviso({ numero: "NA", pagina: "PA", pixel: "" }, "XB");
  comprobar("píxel vacío que mide con el general de B", !!g, corto(g));
}

console.log("\n— 2. sin mezcla: no avisa —\n");
comprobar("página y píxel del mismo negocio", aviso({ numero: "NA", pagina: "PA", pixel: "XA" }) === null);
comprobar("sin página ni píxel puestos", aviso({ numero: "NA" }) === null);
comprobar(
  "píxel vacío que mide con el general del mismo negocio",
  aviso({ numero: "NA", pagina: "PA", pixel: "" }, "XA") === null
);

console.log("\n— 3. alguno sin identificar: NO avisa —\n");
comprobar("la página sin dueño", aviso({ numero: "NA", pagina: "PSIN", pixel: "XA" }) === null);
comprobar("el píxel sin dueño", aviso({ numero: "NA", pagina: "PA", pixel: "XSIN" }) === null);
comprobar("el número sin dueño", aviso({ numero: "NSIN", pagina: "PA", pixel: "XB" }) === null);
comprobar("un id que ya no está conectado", aviso({ numero: "NA", pagina: "BORRADA", pixel: "XA" }) === null);

console.log("\n— 4. el píxel compartido: no avisa —\n");
comprobar("píxel de B compartido con A", aviso({ numero: "NA", pagina: "PA", pixel: "XCOMP" }) === null);

console.log("\n— 5. el aviso dice lo que pasa —\n");
{
  const m = aviso({ numero: "NA", pagina: "PA", pixel: "XB" }) ?? "";
  comprobar("nombra la pieza y los dos negocios", /Píxel B/.test(m) && /Negocio B/.test(m) && /Negocio A/.test(m), corto(m));
  comprobar("no nombra la página, que está bien", !/Página A/.test(m));
}

console.log("\n— 6. las dos pantallas preguntan a la misma función —\n");
{
  const editor = readFileSync(join(RAIZ, "src", "app", "editor", "page.tsx"), "utf8");
  const ruta = readFileSync(join(RAIZ, "src", "app", "api", "meta", "connect", "cuentas", "route.ts"), "utf8");
  comprobar("el editor", /const \{ mezcla \} = cuentaDeLaTienda\(/.test(editor));
  comprobar("las tarjetas de Meta Connect", /const \{ cuenta, mezcla \} = cuentaDeLaTienda\(/.test(ruta));
}

console.log("");
if (fallos > 0) {
  console.log(`${fallos} FALLA(S)`);
  process.exit(1);
}
console.log("TODO OK — avisa con mezcla de verdad, y calla cuando no se sabe o está compartido");
