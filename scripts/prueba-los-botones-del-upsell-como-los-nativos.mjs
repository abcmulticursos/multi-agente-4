// LOS BOTONES DE BURBUJA DEL UPSELL FUNCIONAN COMO LOS NATIVOS.
//
// LO PIDIÓ EL DUEÑO el 17/10/2026: «yo quiero que quede igual en cuanto a funcionamiento como los
// botones nativos, si es que yo lo armo así los botones de burbuja». Para manejar el upsell desde
// cada ficha (por tienda y por país) en vez de los Sí / No nativos, que son uno para todos.
//
// QUÉ PROTEGE:
//   1. «Rechaza el UPSELL» existe y es la MISMA puerta que el «No» nativo (`rechazarUpsell`),
//      solo con la oferta en pie.
//   2. Pulsados tarde —ya dijo que no, ya aceptó o ya pagó— no hacen nada, como los nativos.
//      Antes de la oferta, un «Sí» puesto en otro mensaje sigue como siempre.
//   3. Solo en BOTONES: en un cuadrito del upsell el «no» ya lo decide el bot, y la acción
//      además rechazaría dos veces (y podría tumbar el downsell recién ofrecido).
//   4. Una copia de ficha lleva botones con su propio código: el bot busca el botón por código y
//      se queda con el primero (el fallo del 27/09 en los seguimientos).
//   5. La fila de upsells desde la pizarra: cambia la de esta tienda; si era la general, hace
//      una copia propia y la general queda intacta para las demás.
//   6. El interruptor de respaldo entre tiendas no salta los upsells EN FILA.
//
//   node scripts/prueba-los-botones-del-upsell-como-los-nativos.mjs
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");
const engine = leer("src", "lib", "workflow", "engine.ts");
const config = leer("src", "lib", "workflow", "config.ts");
const pantalla = leer("src", "app", "editor", "page.tsx");
const lienzo = leer("src", "components", "pizarra", "LienzoDePizarra.tsx");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 66)} ${valor}`);
};

// Saca una función del archivo real (sin reescribirla) y la deja importable.
const dir = mkdtempSync(join(tmpdir(), "botones-upsell-"));
const extraer = (fuente, nombre) => {
  const i = fuente.indexOf(`function ${nombre}`);
  if (i < 0) return null;
  const resto = fuente.slice(i);
  const fin = resto.search(/\r?\n\}\r?\n/);
  return fin < 0 ? null : resto.slice(0, fin) + "\n}";
};
async function cargar(nombre, extra = "") {
  const cuerpo = extraer(pantalla, nombre);
  if (!cuerpo) return null;
  const archivo = join(dir, `${nombre}.ts`);
  writeFileSync(archivo, `${extra}\nexport ${cuerpo}\n`, "utf8");
  return (await import(pathToFileURL(archivo).href))[nombre];
}

console.log("\n— 1. «Rechaza el UPSELL»: la misma puerta que el «No» nativo —\n");
const caso = engine.match(/case "decline_upsell": \{[\s\S]*?\n {4}\}/)?.[0] ?? "";
comprobar("la acción existe en el motor", caso.length > 0);
comprobar("solo con la oferta en pie", /convo\.upsell_state !== "ofrecido"/.test(caso));
comprobar("usa rechazarUpsell, la del botón nativo", /await rechazarUpsell\(convo, loadWorkflowConfig\(\)/.test(caso));
comprobar("su texto propio manda (no se repite el de rechazo)", /enviarTexto: !yaPresento/.test(caso));
comprobar("está en los tipos del motor (botón y acción)", (config.match(/\| "decline_upsell"/g) ?? []).length === 2);
comprobar("el nativo sigue por su camino de siempre", /tocoUnBoton === "no"[\s\S]{0,200}rechazarConSuCuadrito\(\)/.test(engine));

console.log("\n— 2. pulsados tarde no hacen nada, como los nativos —\n");
const guarda = engine.match(/LOS BOTONES DEL UPSELL, COMO LOS NATIVOS[\s\S]*?return false;\s*\r?\n\s*\}/)?.[0] ?? "";
comprobar("la guarda existe, antes de mandar nada", guarda.length > 0 && engine.indexOf(guarda) < engine.indexOf("const suyas = button.steps ?? [];"));
comprobar("cubre el Sí y el No del upsell", /button\.action === "choose_upsell" \|\| button\.action === "decline_upsell"/.test(guarda));
comprobar("cerrada = rechazado, aceptado o pagado", /\["rechazado", "aceptado", "pagado"\]/.test(guarda));
comprobar("antes de la oferta no se toca (no mira «esperando»)", !/esperando/.test(guarda.replace(/\/\/.*$/gm, "")));

console.log("\n— 3. solo en botones, nunca en cuadritos —\n");
comprobar("el selector del botón la ofrece", /<option value="decline_upsell">/.test(pantalla));
const links = pantalla.match(/const LINKS_DE_DECISION[\s\S]*?\];/)?.[0] ?? "";
comprobar("la lista de los cuadritos NO la ofrece", links.length > 0 && !/decline_upsell/.test(links));
comprobar("la pizarra no la deja poner en un cuadrito", /if \(destino === "decline_upsell"\) return \{ error:/.test(pantalla));
comprobar("su menú la enseña solo a los botones", /d\.valor !== "decline_upsell" \|\| r\?\.tipo === "boton"/.test(lienzo));

console.log("\n— 4. la copia lleva botones con su propio código —\n");
const conBotonesNuevos = await cargar("conBotonesNuevos");
comprobar("la función existe", typeof conBotonesNuevos === "function");
if (conBotonesNuevos) {
  const original = { name: "A", steps: [{ body: "x", buttons: [{ id: "b1", label: "Sí", action: "choose_upsell" }, { id: "b2", label: "No", action: "decline_upsell" }] }] };
  const copia = conBotonesNuevos(JSON.parse(JSON.stringify(original)));
  const [c1, c2] = copia.steps[0].buttons;
  comprobar("códigos nuevos y distintos entre sí", c1.id !== "b1" && c2.id !== "b2" && c1.id !== c2.id, `${c1.id} ${c2.id}`);
  comprobar("la etiqueta y la acción no cambian", c1.label === "Sí" && c1.action === "choose_upsell" && c2.action === "decline_upsell");
  comprobar("el original queda intacto", original.steps[0].buttons[0].id === "b1");
  const otra = conBotonesNuevos(JSON.parse(JSON.stringify(copia)));
  comprobar("copiar una copia no alarga el código sin fin", otra.steps[0].buttons[0].id.split("~c").length === 2, otra.steps[0].buttons[0].id);
}
comprobar("se usa al duplicar", /const copia = conBotonesNuevos\(JSON\.parse/.test(pantalla));
comprobar("y al hacer propia una ficha de la tienda", /agregarAlFinal\(\{ \.\.\.conBotonesNuevos\(obj\), tiendas: \[tiendaId\] \}\)/.test(pantalla));

console.log("\n— 5. la fila desde la pizarra: solo la de esta tienda —\n");
const conLaFila = await cargar("conLaFilaDeLaTienda", "type FullConfig = any; type FilaDeUpsellEditor = any;");
comprobar("la función existe", typeof conLaFila === "function");
if (conLaFila) {
  const general = { id: "g", enabled: true, tiendas: [], puestos: [{ producto_id: "p2" }], downsell: { enabled: true } };
  const cfg = { filas_de_upsell: [general] };
  const r = conLaFila(cfg, "tA", (ps) => [...ps, { producto_id: "p3" }]);
  const g2 = r.filas_de_upsell.find((f) => f.id === "g");
  const suya = r.filas_de_upsell.find((f) => (f.tiendas ?? []).includes("tA"));
  comprobar("la general queda intacta para las demás tiendas", g2.puestos.length === 1 && g2.puestos[0].producto_id === "p2");
  comprobar("esta tienda recibe su copia, con el cambio", suya && suya.puestos.map((p) => p.producto_id).join() === "p2,p3");
  comprobar("la copia conserva el downsell", suya?.downsell?.enabled === true);
  const r2 = conLaFila(r, "tA", (ps) => ps.slice(1));
  comprobar("la segunda vez cambia la suya, sin crear otra", r2.filas_de_upsell.length === 2 && r2.filas_de_upsell.find((f) => f.tiendas?.includes("tA")).puestos.map((p) => p.producto_id).join() === "p3");
  const r3 = conLaFila({}, "tB", (ps) => [...ps, { producto_id: "p9" }]);
  comprobar("sin ninguna fila, se crea la de esta tienda", r3.filas_de_upsell.length === 1 && r3.filas_de_upsell[0].tiendas[0] === "tB");
}

console.log("\n— 6. el respaldo entre tiendas no salta los upsells en fila —\n");
comprobar("la guarda de tienda se puede omitir", /conRespaldoDeTienda &&\s*\r?\n\s*!usaRespaldoEntreTiendas/.test(config));
comprobar("el upsell en fila no se corta por tienda", /!usaRespaldoEntreTiendas\(config\) && !up\.de_la_fila/.test(engine));
comprobar("ni al sortear su presentación", /undefined,\s*\r?\n\s*!up\.de_la_fila\s*\r?\n\s*\) \?\?/.test(engine));
comprobar("ni al mirar el país", /apunte,\s*\r?\n\s*\/\/[^\n]*\r?\n\s*!up\.de_la_fila/.test(engine));

console.log(`\n${fallos === 0 ? "TODO OK — los botones de burbuja del upsell funcionan como los nativos" : `${fallos} FALLO(S)`}\n`);
process.exit(fallos === 0 ? 0 : 1);
