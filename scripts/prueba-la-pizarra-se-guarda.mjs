// LA PIZARRA SE GUARDA Y VUELVE IGUAL — y el bot no la lee nunca.
//
// Lo pidió el dueño el 16/10/2026: «si yo muevo algo… le doy guardar y que se guarde y quede
// tal cual está». Para eso dónde deja cada ficha y sus cajas viaja con el contenido, y eso
// pasa por la RUTA DE GUARDADO, que tiene su regla con cicatriz: «la ruta de guardado se come
// lo que nadie nombra». Esta prueba vigila las tres cosas que importan:
//
//   1. IDA Y VUELTA: lo que escribe la ruta, pasado por YAML como en el archivo de verdad, se
//      lee igual, número por número.
//   2. LIMPIEZA: lo raro (textos, infinitos, nulos) no entra; «sin cajas» y «cajas: []» no se
//      confunden.
//   3. NADIE MÁS LO LEE: el motor no nombra `pizarra` en ningún sitio. Es solo de la pantalla.
//
// No guarda nada de verdad: guardar sube a GitHub y cambiaría su bot.
//
//   node scripts/prueba-la-pizarra-se-guarda.mjs
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse, stringify } from "yaml";

const RAIZ = process.cwd();
registerHooks({
  resolve(esp, ctx, next) {
    if (esp.startsWith("@/")) {
      const rel = esp.slice(2);
      return { url: pathToFileURL(join(RAIZ, "src", /\.[a-z]+$/.test(rel) ? rel : `${rel}.ts`)).href, shortCircuit: true };
    }
    return next(esp, ctx);
  },
});
const { leePizarra } = await import(pathToFileURL(join(RAIZ, "src", "lib", "editor", "lee-pizarra.ts")).href);

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 66)} ${valor}`);
};
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log("\n— 1. ida y vuelta, como en el archivo —\n");
const original = {
  vistas: {
    "tienda_x|whatsapp": {
      posiciones: { "pz:PE:intro:intro:0": { x: 320, y: 44 }, inicio: { x: -10, y: 300 } },
      cajas: [{ id: "caja:carril:PE", x: 290, y: -10, ancho: 2300, alto: 420, titulo: "🇵🇪 Peru" }],
      visibles: ["intro:3", "seg:1:4"],
      paises: ["EC", "CL"],
      puentes: ["PE|seg:1:6|ob:0"],
      sinFondo: ["caja:carril:EC"],
      // Los cables de un grupo pegado (17/10/2026).
      enlaces: ["intro:3|seg:1:4"],
    },
    "tienda_y|messenger": { posiciones: {} },
  },
};
const escrito = leePizarra(original);
const leido = leePizarra(parse(stringify({ pizarra: escrito })).pizarra);
comprobar("lo escrito vuelve igual tras pasar por YAML", igual(leido, original));
comprobar("con emojis y tildes en el título de la caja", leido.vistas["tienda_x|whatsapp"].cajas[0].titulo === "🇵🇪 Peru");

console.log("\n— 2. lo raro no entra —\n");
const sucio = leePizarra({
  vistas: {
    a: {
      posiciones: { bien: { x: 1.6, y: 2 }, texto: { x: "9", y: 1 }, infinito: { x: Infinity, y: 0 }, nulo: null },
      cajas: [{ id: "c", x: 0, y: 0, ancho: 10, alto: 10, titulo: "t" }, { id: "rota", x: 0 }],
    },
    b: { posiciones: {}, cajas: [] },
  },
});
comprobar("solo entra la posición buena, redondeada", igual(sucio.vistas.a.posiciones, { bien: { x: 2, y: 2 } }));
comprobar("una caja a medias no entra", sucio.vistas.a.cajas.length === 1);
comprobar("«cajas: []» se queda como [] (las borró todas)", Array.isArray(sucio.vistas.b.cajas) && sucio.vistas.b.cajas.length === 0);
comprobar("sin «cajas» se queda sin cajas (aún no tocó ninguna)", !("cajas" in leePizarra({ vistas: { c: { posiciones: {} } } }).vistas.c));
comprobar("lo que no es nada da una pizarra vacía", igual(leePizarra(null), { vistas: {} }) && igual(leePizarra("x"), { vistas: {} }));

console.log("\n— 3. la ruta la nombra al leer y al escribir; el bot, nunca —\n");
const ruta = readFileSync(join(RAIZ, "src", "app", "api", "workflow", "route.ts"), "utf8");
comprobar("la ruta la lee con la función compartida", /pizarra: leePizarra\(config\?\.pizarra\)/.test(ruta));
comprobar("la ruta la escribe con la misma función", /doc\.set\("pizarra", leePizarra\(body\.pizarra\)\)/.test(ruta));
comprobar("y solo si el panel la manda (un editor viejo no la borra)", /if \(body\.pizarra && typeof body\.pizarra === "object"\)/.test(ruta));
const delMotor = readdirSync(join(RAIZ, "src", "lib", "workflow")).filter((f) => f.endsWith(".ts"));
// Se busca CÓDIGO que lea el campo (`.pizarra`, `["pizarra"]`), no la palabra: los
// comentarios del motor pueden nombrar la pizarra para explicar por qué algo vive suelto.
const loLee = delMotor.filter((f) =>
  /(?:\.|\[["'])pizarra\b/.test(readFileSync(join(RAIZ, "src", "lib", "workflow", f), "utf8"))
);
comprobar("el motor no lee `pizarra` en ningún archivo", loLee.length === 0, loLee.join(", "));

console.log(`\n${fallos === 0 ? "TODO OK — la pizarra se guarda, vuelve igual, y el bot no la lee" : `${fallos} FALLO(S)`}\n`);
process.exit(fallos === 0 ? 0 : 1);
