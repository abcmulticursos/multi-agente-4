// Los dos campos de los que cuelga todo, en ROJO mientras esten vacios.
//
// POR QUE
//
// El «Nombre del producto» y el «Tema de la muestra» son los que hacen que un
// producto se pueda nombrar y que su muestra se pueda marcar en «Info de
// contenido». Vacios, el producto existe pero no sirve:
//
//   - sin nombre, el comodin ({{PRODUCTO}}, {{PRODUCTO_UPSELL}}...) sale en
//     blanco en todos los mensajes donde se use;
//   - sin tema, la muestra no aparece en «Info de contenido» y no se envia
//     nunca.
//
// Y en blanco se parecen a un campo opcional. No lo son.
//
// EL DETALLE DE LOS COLORES
//
// Los colores NO se apilan sobre los de siempre: se elige uno u otro. Juntar
// "border-neutral-300" y "border-red-400" en la misma cadena no decide nada —
// gana el que la hoja de estilos tenga mas abajo, no el que se escriba ultimo.
// Por eso claseDeCampo recibe la base SIN color y pone ella el que toca.
//
//   node scripts/prueba-campos-que-faltan-en-rojo.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const editor = readFileSync(
  join(RAIZ, "src", "app", "editor", "page.tsx"),
  "utf8"
);

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 62)} ${valor}`);
};

// ── Las dos funciones, ejecutadas de verdad ─────────────────────────────────
const trozo = (nombre) => {
  const desde = editor.indexOf(`function ${nombre}`);
  const crlf = editor.indexOf("\r\n}\r\n", desde);
  const hasta = crlf >= 0 ? crlf : editor.indexOf("\n}\n", desde);
  return editor.slice(desde, hasta + 5);
};
const cuerpo = (nombre) =>
  trozo(nombre)
    .replace(/valor: string \| undefined, base: string/, "valor, base")
    .replace(/\): string \{/, ") {")
    .replace(new RegExp(`^function ${nombre}\\(valor, base\\) \\{`), "")
    .replace(/\}\s*$/, "");

const claseDeCampo = new Function("valor", "base", cuerpo("claseDeCampo"));
const claseDeEtiqueta = new Function("valor", "base", cuerpo("claseDeEtiqueta"));

comprobar(
  "vacío pinta el borde en rojo",
  claseDeCampo("", "rounded border").includes("border-red-400"),
  "rojo"
);
comprobar(
  "y solo con espacios también",
  claseDeCampo("   ", "rounded border").includes("border-red-400"),
  "rojo"
);
comprobar(
  "sin valor (undefined) también",
  claseDeCampo(undefined, "rounded border").includes("border-red-400"),
  "rojo"
);
comprobar(
  "lleno vuelve al color normal",
  claseDeCampo("Kit", "rounded border").includes("border-neutral-300") &&
    !claseDeCampo("Kit", "rounded border").includes("border-red-400"),
  "normal"
);
comprobar(
  // ESTE es el detalle que rompe silenciosamente: si los dos colores conviven
  // en la cadena, cuál gana lo decide la hoja de estilos, no el orden escrito.
  "nunca salen los dos colores de borde a la vez",
  ["", "Kit"].every((v) => {
    const c = claseDeCampo(v, "rounded border px-2");
    return !(c.includes("border-red-400") && c.includes("border-neutral-300"));
  }),
  "uno u otro"
);
comprobar(
  "lo mismo con el fondo",
  ["", "Kit"].every((v) => {
    const c = claseDeCampo(v, "rounded border");
    return !(c.includes("bg-red-50") && c.includes("bg-white"));
  }),
  "uno u otro"
);
comprobar(
  "la etiqueta se pone roja y vuelve",
  claseDeEtiqueta("", "text-xs").includes("text-red-700") &&
    claseDeEtiqueta("Kit", "text-xs").includes("text-neutral-800"),
  "cambia"
);
comprobar(
  "y la base se conserva siempre",
  claseDeCampo("", "rounded border px-2 py-2 text-sm").includes(
    "rounded border px-2 py-2 text-sm"
  ),
  "intacta"
);

// ── Los tres campos, conectados ─────────────────────────────────────────────
comprobar(
  "el Tema de la muestra lo usa",
  /claseDeCampo\(\s*\r?\n?\s*it\.topic,/.test(editor) &&
    /claseDeEtiqueta\(it\.topic,/.test(editor),
  "campo y etiqueta"
);
comprobar(
  "el Nombre del producto (Producto 1 y 2) lo usa",
  /claseDeCampo\(\s*\r?\n\s*productName,/.test(editor) &&
    /claseDeEtiqueta\(productName,/.test(editor),
  "campo y etiqueta"
);
comprobar(
  "el Nombre del producto upsell lo usa",
  (editor.match(/claseDeCampo\(\s*\r?\n\s*cfg\.upsell\?\.name,/g) ?? []).length ===
    1 &&
    (editor.match(/claseDeEtiqueta\(\s*\r?\n\s*cfg\.upsell\?\.name,/g) ?? [])
      .length === 2,
  "campo y 2 etiquetas"
);
comprobar(
  "y cada uno dice qué se rompe si se deja vacío",
  /Falta llenarlo\. Sin tema, esta muestra no aparece/.test(editor) &&
    /Falta llenarlo\. Sin nombre,/.test(editor) &&
    /Falta llenarlo\. Es por este nombre que el bot reconoce/.test(editor),
  "los tres"
);

console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} comprobación(es) mal.`);
process.exit(fallos === 0 ? 0 : 1);
