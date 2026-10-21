// Una burbuja apagada no cuenta como dicha.
//
// DE DONDE SALE
//
//   Eligió «yape». El método tiene 3 burbujas y solo llegaron 2: faltaba la
//   primera, la que presenta («✅ ¡Perfecto! puedes adquirir el curso de la
//   siguiente manera a través de Yape 😊👇»). En el log:
//
//     [wf] convo 86: "YAPE/PLIN" → datos de yape (sin repetir su presentación)
//     [wf] enviando payment step 1 (yape) a convo 86     ← empieza en 1, no en 0
//
//   Su cuadrito YAPE/PLIN tiene 2 burbujas propias y las dos están APAGADAS
//   —las apagó para matar el duplicado, y con razón: decían lo mismo que el
//   método—. No salió ninguna, correcto. Pero el motor las contó igual como
//   «el operador ya presentó», y la regla del duplicado recortó la
//   presentación de fábrica para no repetir algo que nadie había dicho.
//
//   Apagar una burbuja le estaba costando otra, en silencio.
//
// LA CAUSA
//
//   Dos funciones hermanas y solo una miraba el interruptor:
//     · «¿sus burbujas llevan la cuenta?» → filtraba las apagadas. Bien.
//     · «¿ya presentó?»                   → contaba .length. Mal.
//
//   Ahora las dos salen de la MISMA lista, que es exactamente la que manda
//   `sendConfiguredSteps`. Separadas ya se separaron una vez.
//
// Y NO ERA SOLO AHI
//
//   El mismo descuido en 4 sitios más, todos con el mismo síntoma invisible.
//   El peor: en el segundo producto, un cuadrito con las burbujas en OFF hacía
//   creer al bot que él ya había mandado los datos — y entonces no mandaba
//   nada, ni las suyas ni las de fábrica.
//
//   node scripts/prueba-una-burbuja-apagada-no-cuenta.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const engine = readFileSync(
  join(RAIZ, "src", "lib", "workflow", "engine.ts"),
  "utf8"
);

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 62)} ${valor}`);
};

// ── 1. Una sola lista, la misma que se manda ─────────────────────────────────
comprobar(
  "hay UNA sola idea de «las burbujas que van a salir»",
  /function burbujasQueVanASalir\(\s*\r?\n\s*pasos: ResponseStep\[\] \| undefined\s*\r?\n\): ResponseStep\[\] \{/.test(
    engine
  ),
  "en un solo sitio"
);
comprobar(
  "y es el mismo filtro que aplica el envío",
  /return \(pasos \?\? \[\]\)\.filter\(\s*\r?\n\s*\(paso\) => \(paso as \{ enabled\?: boolean \}\)\.enabled !== false\s*\r?\n\s*\);/.test(
    engine
  ) && /steps\.filter\(\(step\) => step\.enabled !== false\)/.test(engine),
  "no pueden separarse"
);
comprobar(
  "«¿lleva la cuenta?» sale de esa lista",
  /function susBurbujasLlevanLosDatos\([\s\S]{0,160}?return burbujasQueVanASalir\(pasos\)\.some\(llevaLosDatosParaPagar\);/.test(
    engine
  ),
  "la misma"
);
comprobar(
  "«¿tiene algo que decir?» también",
  /function tieneBurbujasEncendidas\(pasos: ResponseStep\[\] \| undefined\): boolean \{\s*\r?\n\s*return burbujasQueVanASalir\(pasos\)\.length > 0;/.test(
    engine
  ),
  "la misma"
);

// ── 2. El fallo que le pasó: no se recorta lo que nadie dijo ─────────────────
comprobar(
  "«ya presentó» mira el interruptor, no cuenta apagadas",
  /const yaPresento = tieneBurbujasEncendidas\(loQueYaDijo\);/.test(engine),
  "el fallo de yape"
);
comprobar(
  "y no queda ni un resto de la cuenta a ciegas",
  !/const yaPresento = \(loQueYaDijo \?\? \[\]\)\.length > 0;/.test(engine),
  "sin .length"
);

// ── 3. Los otros cuatro sitios, la misma maquinaria ──────────────────────────
//
// No es el tornillo: el mismo descuido estaba repartido.
comprobar(
  "el cuadrito del regalo no se come el turno estando apagado",
  /salio \|\|\s*\r?\n\s*tieneBurbujasEncendidas\(cuadritoRegalo\.steps\) \|\|/.test(
    engine
  ),
  "o nadie le contesta"
);
comprobar(
  "el cuadrito del extra tampoco",
  /const tieneBurbujas = tieneBurbujasEncendidas\(cuadrito\.steps\);/.test(
    engine
  ),
  "mismo caso"
);
// EL PEOR DE TODOS: apagado, el bot creia que el ya habia mandado los datos
// del extra -- y entonces no mandaba NADA.
comprobar(
  "y apagado NO se da por hecho que él ya mandó los datos del extra",
  /const suyas = tieneBurbujasEncendidas\(cuadrito\.steps\);/.test(engine),
  "si no, no sale nada"
);
comprobar(
  "un cuadrito apagado no pasa por «el que trae su texto»",
  /decision\.action === "choose_upsell" &&[\s\S]{0,220}?tieneBurbujasEncendidas\(decision\.steps\)/.test(
    engine
  ),
  "no hay texto que respetar"
);
comprobar(
  "y no queda ninguna cuenta a ciegas de burbujas de cuadrito",
  !/\(cuadrito\.steps \?\? \[\]\)\.length > 0/.test(engine) &&
    !/\(cuadritoRegalo\.steps \?\? \[\]\)\.length > 0/.test(engine) &&
    !/\(decision\.steps \?\? \[\]\)\.length > 0/.test(engine),
  "ninguna"
);

// ── 4. Lo que NO cambia ──────────────────────────────────────────────────────
//
// La regla del duplicado sigue entera: si SI dijo lo suyo, lo de fabrica no se
// repite. Lo unico que cambia es que apagado ya no cuenta como dicho.
comprobar(
  "si sus burbujas SÍ llevan la cuenta, las de fábrica siguen sin salir",
  /if \(yaDioLosDatos\) \{/.test(engine) &&
    /ya llevaba los datos de \$\{metodo\} → no mando las de fábrica/.test(engine),
  "la regla sigue igual"
);
comprobar(
  "y si solo presentó, sigue saliendo la parte con los datos",
  /const pasos = yaPresento\s*\r?\n\s*\? sinLaPresentacionDeSiempre\(deFabrica\)\s*\r?\n\s*: deFabrica;/.test(
    engine
  ),
  "sin repetir"
);

console.log(
  fallos === 0
    ? "\nTODO OK — lo que está apagado, para el bot no existe"
    : `\n${fallos} comprobacion(es) mal.`
);
process.exit(fallos === 0 ? 0 : 1);
