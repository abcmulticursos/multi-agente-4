// EL PESO DE LOS SEGUIMIENTOS, Y SIN PESOS NADA CAMBIA.
//
// LO PIDIÓ EL DUEÑO el 17/10/2026: «en Perú voy a testear con varias intros… y varios seguimientos…
// cada uno con su peso». Las intros ya tenían peso; las variantes de un seguimiento se sorteaban
// parejo. Y con una condición: «que no se rompa el comportamiento… me molesta RETESTEAR TODO».
//
// QUÉ PROTEGE:
//   1. SIN PESOS (todos 1) se usa LA LÍNEA DE SIEMPRE, tal cual: el mismo sorteo parejo.
//   2. Con pesos distintos, cada variante sale en proporción a su peso (se ejecuta el código real).
//   3. El peso se lee y se guarda (variantes `weight`, mensajes principales `steps_weight`) y no
//      se pierde al abrir el editor (`bajarPrincipalALaLista`).
//   4. El filtro por tienda, forma, país y anuncio va ANTES y no se tocó.
//
//   node scripts/prueba-el-peso-de-los-seguimientos.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");
const engine = leer("src", "lib", "workflow", "engine.ts");
const ruta = leer("src", "app", "api", "workflow", "route.ts");
const pantalla = leer("src", "app", "editor", "page.tsx");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 66)} ${valor}`);
};

const fn = engine.match(/function chooseFollowupVariant\([\s\S]*?\r?\n\}\r?\n/)?.[0] ?? "";
comprobar("la función existe", fn.length > 0);

console.log("\n— 1. sin pesos, la línea de siempre —\n");
comprobar("con todos iguales, el sorteo parejo de siempre", /if \(pool\.every\(\(c\) => c\.peso === pool\[0\]\.peso\)\) \{\s*\r?\n\s*return pool\[Math\.floor\(Math\.random\(\) \* pool\.length\)\];/.test(fn));
comprobar("ausente = 1", /const pesoDe = \(n: unknown\): number =>\s*\r?\n\s*typeof n === "number" && Number\.isFinite\(n\) && n >= 1 \? Math\.floor\(n\) : 1;/.test(fn));
// (18/10/2026: el resultado del anuncio se llama ahora `deTodosLosCaminos`, y el camino se filtra
// justo después —`porCamino`, que sin caminos devuelve la misma lista—.)
comprobar("el filtro por anuncio sigue igual y va antes", /const (pool|deTodosLosCaminos) = porEtiqueta\(\s*\r?\n\s*deSuPais,/.test(fn) && fn.indexOf("porEtiqueta(") < fn.indexOf("pool.every"));
comprobar("los mensajes principales usan steps_weight", /peso: pesoDe\(seq\.steps_weight\)/.test(fn));
comprobar("cada variante usa su weight", /peso: pesoDe\(variant\.weight\)/.test(fn));

console.log("\n— 2. con pesos, se reparte por peso (código real, 30.000 tiradas) —\n");
const bloque = fn.match(/if \(pool\.every[\s\S]*?return pool\[pool\.length - 1\];/)?.[0] ?? "";
// eslint-disable-next-line no-new-func
const elegir = new Function("pool", bloque);
const contar = (pool, n = 30000) => {
  const veces = new Map(pool.map((c) => [c.n, 0]));
  for (let i = 0; i < n; i++) {
    const c = elegir(pool);
    veces.set(c.n, veces.get(c.n) + 1);
  }
  return [...veces.values()].map((v) => v / n);
};
const iguales = contar([{ n: "A", peso: 1 }, { n: "B", peso: 1 }]);
comprobar("1 y 1 → mitad y mitad", Math.abs(iguales[0] - 0.5) < 0.02, iguales.map((x) => x.toFixed(2)).join(" / "));
const tres = contar([{ n: "A", peso: 3 }, { n: "B", peso: 1 }]);
comprobar("3 y 1 → 75 % y 25 %", Math.abs(tres[0] - 0.75) < 0.02, tres.map((x) => x.toFixed(2)).join(" / "));
const uno = contar([{ n: "A", peso: 5 }]);
comprobar("una sola → siempre esa", uno[0] === 1);

console.log("\n— 3. se guarda, se lee y no se pierde al abrir —\n");
comprobar("canal: se lee el de cada variante", /weight: Math\.max\(1, Math\.floor\(num\(variant\?\.weight, 1\)\)\)/.test(ruta));
comprobar("canal y general: se escribe solo si no es 1", (ruta.match(/Math\.floor\(num\(v(?:ariant)?\?\.weight, 1\)\) > 1 \? \{ weight:/g) ?? []).length === 2);
comprobar("los mensajes principales: se leen y se escriben", (ruta.match(/steps_weight/g) ?? []).length >= 6);
comprobar("al abrir el editor, el peso baja con los principales", /\.\.\.\(\(seg\.steps_weight \?\? 1\) > 1 \? \{ weight: seg\.steps_weight \} : \{\}\)/.test(pantalla));

console.log(`\n${fallos === 0 ? "TODO OK — sin pesos nada cambia, con pesos reparte por peso" : `${fallos} FALLO(S)`}\n`);
process.exit(fallos === 0 ? 0 : 1);
