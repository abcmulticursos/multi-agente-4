// MODO ESENCIAL Y MODO PROFESIONAL, Y EL CANDADO DEL CEREBRO.
//
// ──── DE DONDE SALE ────────────────────────────────────────────────────────
//
// Lo pidio el 10/10/2026: «el editor es un poco complicado para usar para las nuevas
// personas». Eligio el nombre «modo esencial» («simple suena a que no tiene relevancia»).
// Y la condicion que manda sobre todo lo demas:
//
//   «CUANDO YO REGRESE DEL MODO USUARIO AL MODO PROFESIONAL DEBE QUEDAR IDENTICO, NO TOCAR
//    EL MOTOR NI TAMPOCO CORROMPER LOS MENUS NI NADA».
//
// Esta prueba vigila sobre todo eso: que el modo solo cambie LO QUE SE VE.
import { readFileSync } from "node:fs";

const editor = readFileSync("src/app/editor/page.tsx", "utf8");
const ruta = readFileSync("src/app/api/editor/clave-del-cerebro/route.ts", "utf8");

let fallos = 0;
const pad = (t, n) => (t.length >= n ? t : t + " ".repeat(n - t.length));
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

console.log("— el modo solo cambia lo que se ve —\n");

{
  // El interruptor: del primer «Modo esencial» al cierre de su grupo.
  const ini = editor.indexOf('[true, "Modo esencial"]');
  const fin = editor.indexOf("</span>", ini);
  const interruptor = ini >= 0 && fin > ini ? editor.slice(ini, fin) : "";
  comprobar("existe el interruptor de modo", interruptor.length > 0);
  comprobar(
    "y no toca la configuracion",
    !/setCfg\(|save\(|setShowBaseTabs\(/.test(interruptor),
    "nada de lo guardado, ni el estado de las bases"
  );
  comprobar(
    "se recuerda solo en este navegador",
    /localStorage\.setItem\(\s*EDITOR_MODO_STORAGE_KEY/.test(interruptor)
  );
}
comprobar(
  "las bases se esconden al pintar, sin apagarlas",
  /const basesALaVista = showBaseTabs && !modoEsencial;/.test(editor) &&
    /!basesALaVista &&\s*\(key === "intro"/.test(editor),
  "al volver al profesional siguen como estaban"
);

console.log("\n— lo que esconde el esencial —\n");

comprobar(
  "«Mostrar bases» no esta en el esencial",
  /\{!modoEsencial && \(\s*<button[\s\S]{0,900}\{showBaseTabs \? "Ocultar bases" : "Mostrar bases"\}/.test(
    editor
  ) && /sinBotonDeBases=\{modoEsencial\}/.test(editor),
  "ni arriba ni en el menu lateral"
);
comprobar(
  "«Contenido» se llama «Productos» solo en el esencial",
  /if \(t === "contenido" && modoEsencial\) return "Productos";/.test(editor) &&
    /contenido: "Contenido",/.test(editor)
);
comprobar(
  "Upsell: «Si pregunta que trae» oculto en el esencial",
  /\{!modoEsencial && \(\s*<Collapsible\s*title="❓ Si pregunta «¿qué trae\?»"/.test(editor)
);
comprobar(
  "Upsell: «Entrega del segundo producto» oculta en el esencial",
  /\{!modoEsencial && \(\s*<Collapsible\s*title="📦 Entrega del segundo producto"/.test(editor)
);
comprobar(
  "Precios y pagos: las ayudas largas se acortan",
  /esencial=\{modoEsencial\}/.test(editor) &&
    (editor.match(/\{!esencial && \(/g) ?? []).length >= 3,
  "en el editor de cada pais"
);

console.log("\n— el candado del Cerebro —\n");

{
  const ini = editor.indexOf('{cfg && tab === "cerebro" && (');
  const fin = editor.indexOf("</fieldset>", ini);
  const cerebro = ini >= 0 && fin > ini ? editor.slice(ini, fin) : "";
  comprobar(
    "las dos cajas de texto son de solo lectura sin desbloquear",
    (cerebro.match(/readOnly=\{!cerebroDesbloqueado\}/g) ?? []).length === 2
  );
  comprobar(
    "y no cambian nada aunque llegue un cambio",
    (cerebro.match(/if \(!cerebroDesbloqueado\) return;/g) ?? []).length === 2
  );
  comprobar(
    "los dos «Restaurar» piden la contraseña",
    (cerebro.match(/if \(!puedeCambiarElCerebro\(\)\) return;/g) ?? []).length === 2
  );
}
comprobar(
  "la contraseña la comprueba el servidor",
  /checkPassword\(clave\)/.test(ruta) && !/clave.*NextResponse\.json\(\{[^}]*clave/.test(ruta),
  "y nunca la devuelve"
);
comprobar(
  "con freno contra probar a lo loco",
  /MAX_FALLOS = 10/.test(ruta) && /status: 429/.test(ruta)
);

console.log("\n— Meta Connect en modo esencial —\n");

const meta = readFileSync("src/app/meta-connect/page.tsx", "utf8");
comprobar(
  "comparte el modo con el editor",
  /const MODO_STORAGE_KEY = "wf:editor-modo";/.test(meta) &&
    /const EDITOR_MODO_STORAGE_KEY = "wf:editor-modo";/.test(editor),
  "elegido en uno, vale en el otro"
);
comprobar(
  "oculta Ads, Instagram y las dos de variables",
  /3: null, 4: 2, 5: null/.test(meta) && /9: null, 10: null/.test(meta)
);
comprobar(
  "«Configuracion automatica» va despues de la pagina",
  /1: 1, 2: 3, 3: null, 4: 2/.test(meta),
  "antes no se podia pulsar nada sin pagina"
);
comprobar(
  "en el profesional cada seccion lleva su numero de siempre",
  /if \(!modoEsencial\) return \{ paso: pasoDeSiempre \};/.test(meta) &&
    (meta.match(/\{\.\.\.lugar\(\d+\)\}/g) ?? []).length === 10,
  "las diez"
);
comprobar(
  "ocultar es igual que estar cerrada",
  /if \(oculta\) return null;/.test(meta),
  "lo de dentro solo se dibuja con la ventana abierta"
);

console.log("");
if (fallos > 0) {
  console.log(`${fallos} FALLA(S)`);
  process.exit(1);
}
console.log("TODO OK — el esencial esconde, el profesional queda identico, y el Cerebro pide clave");
