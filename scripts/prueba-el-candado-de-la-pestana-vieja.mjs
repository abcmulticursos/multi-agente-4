// EL CANDADO DE LA PESTAÑA VIEJA (18/10/2026).
//
// LO QUE PASABA: un editor abierto ANTES de otro guardado (otra pestaña, o un arreglo subido
// mientras tanto) tenía la versión vieja, y al guardar la escribía encima. Así se habría vuelto
// a perder la ruta COMO OB que se devolvió el 18/10.
//
// QUÉ PROTEGE (sin guardar nada: guardar publica en GitHub y cambia el bot en vivo):
//   1. La huella no depende de los saltos de línea (Windows / Linux) y cambia con el contenido.
//   2. La ruta compara la huella ANTES de tocar nada, y responde 409 sin publicar.
//   3. Un editor sin huella (viejo) guarda como siempre; «guardar encima» la salta a sabiendas.
//   4. El editor manda la huella con la que abrió, avisa con el 409 y se pone al día al guardar.
//
//   node scripts/prueba-el-candado-de-la-pestana-vieja.mjs
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const RAIZ = process.cwd();
const ruta = readFileSync(join(RAIZ, "src", "app", "api", "workflow", "route.ts"), "utf8");
const editor = readFileSync(join(RAIZ, "src", "app", "editor", "page.tsx"), "utf8");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 66)} ${valor}`);
};

console.log("\n— 1. la huella —\n");
const i = ruta.indexOf("function huellaDelArchivo(");
const resto = ruta.slice(i);
const fn = resto.slice(0, resto.search(/\r?\n\}\r?\n/)) + "\n}";
const dir = mkdtempSync(join(tmpdir(), "candado-"));
writeFileSync(join(dir, "h.ts"), `import { createHash } from "node:crypto";\nexport ${fn}\n`, "utf8");
const { huellaDelArchivo } = await import(pathToFileURL(join(dir, "h.ts")).href);
comprobar("igual con saltos de Windows o de Linux", huellaDelArchivo("a: 1\r\nb: 2\r\n") === huellaDelArchivo("a: 1\nb: 2\n"));
comprobar("distinta si cambia el contenido", huellaDelArchivo("a: 1\n") !== huellaDelArchivo("a: 2\n"));

console.log("\n— 2. la ruta —\n");
const post = ruta.slice(ruta.indexOf("export async function POST("));
const candado = post.indexOf("suHuella !== huellaDelArchivo(raw)");
comprobar("compara la huella al guardar", candado > 0);
comprobar("antes de leer el documento", candado > 0 && candado < post.indexOf("const doc = parseDocument(raw);"));
comprobar("antes de publicar en GitHub", candado > 0 && candado < post.indexOf("publishFileToGithub("));
comprobar("y responde 409 «otraVersion»", /otraVersion: true,\s*\},\s*\{ status: 409 \}/.test(post));
comprobar("el GET da la huella del archivo abierto", /version_del_archivo: huellaDelArchivo\(raw\)/.test(ruta));
comprobar("y el guardado, la del que escribió", /version_del_archivo: huellaDelArchivo\(output\)/.test(ruta));

console.log("\n— 3. sin huella o a sabiendas —\n");
comprobar("sin huella (editor viejo) no se bloquea", /if \(suHuella && body\.guardar_encima !== true && /.test(post));

console.log("\n— 4. el editor —\n");
comprobar("la anota al abrir, fuera del contenido", /huellaAlAbrir\.current = typeof data\?\.version_del_archivo === "string"/.test(editor) && /delete \(data as \{ version_del_archivo\?: unknown \}\)\.version_del_archivo;/.test(editor));
comprobar("la manda al guardar", /version_del_archivo: huellaAlAbrir\.current/.test(editor));
comprobar("avisa con el 409 y deja cancelar", /res\.status === 409 && data\?\.otraVersion/.test(editor) && /No se guardó nada\. Recarga el editor/.test(editor));
comprobar("se pone al día tras guardar", /if \(typeof data\?\.version_del_archivo === "string"\) huellaAlAbrir\.current = data\.version_del_archivo;/.test(editor));
comprobar("el reintento del vaciado lleva la huella", /res = await enviar\(\{ confirmar_vaciado: true \}\);/.test(editor));

console.log(`\n${fallos === 0 ? "TODO OK — una pestaña vieja ya no guarda encima sin preguntar" : `${fallos} FALLO(S)`}\n`);
process.exit(fallos === 0 ? 0 : 1);
