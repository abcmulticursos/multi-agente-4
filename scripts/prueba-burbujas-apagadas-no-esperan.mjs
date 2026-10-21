// Puso 4 segundos y pasaban mas de treinta.
//
// LO QUE PASABA
//
// La intro se programaba entera de golpe, sumando la espera de CADA burbuja —
// encendidas y apagadas. La apagada llegaba a su hora, no enviaba nada… pero las
// de despues ya habian esperado su pausa igual.
//
// En su intro «INTRO SUBLIMACION - 1 copia», entre la foto y el mensaje
// siguiente hay CUATRO burbujas apagadas de 7 segundos cada una:
//
//   [7]  image  ENCENDIDA   espera 4      ← la foto
//   [8]  image  apagada     espera 7
//   [9]  image  apagada     espera 7
//   [10] image  apagada     espera 7
//   [11] video  apagada     espera 7
//   [12] text   ENCENDIDA                 ← el mensaje siguiente
//
//   4 + 7 + 7 + 7 + 7 = 32 segundos de espera para una pausa de 4.
//
// Y encima cada apagada gastaba su turno: el obrero atiende UNA burbuja por
// conversacion cada 2 segundos, asi que tambien hacian cola.
//
// AHORA
//
// Las apagadas ni se programan. No esperan y no hacen cola. Los indices siguen
// siendo los de siempre —el envio lee la burbuja por su numero— asi que apagar y
// encender no descoloca nada.
//
// EL CUIDADO
//
// El "is_last" es el que cierra la intro: marca intro_done y suelta lo que va
// detras. Estaba puesto en la ULTIMA de la lista, que puede estar apagada y ya
// no se programa. Se pasa a la ultima ENCENDIDA. Y si estan todas apagadas se
// programa igual un cierre, o la conversacion se quedaria en "intro corriendo"
// para siempre.
//
//   node scripts/prueba-burbujas-apagadas-no-esperan.mjs
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
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 60)} ${valor}`);
};

const fn =
  engine.match(
    /function programarPasosDeIntro\([\s\S]*?\r?\n\}\r?\n/
  )?.[0] ?? "";

comprobar("el programador de la intro está donde se le busca", fn.length > 0, "sí");
comprobar(
  // ESTE es el fallo. Sin el filtro, la apagada vuelve a reservar su pausa.
  "solo se programan las burbujas encendidas",
  /if \(pasos\[i\]\?\.enabled !== false\) aEnviar\.push\(i\);/.test(fn),
  "las apagadas no"
);
comprobar(
  "y solo ellas suman espera",
  /for \(const i of aEnviar\) \{[\s\S]*?acumulado \+= pasos\[i\]\.delay_after_sec \?\? 0;/.test(
    fn
  ),
  "sí"
);
comprobar(
  // El envío lee la burbuja por su número dentro de la lista completa. Si aquí
  // se renumeraran, cada burbuja mandaría el texto de otra.
  "los índices siguen siendo los de la lista completa",
  /step_index: i,/.test(fn) && !/step_index: aEnviar\.indexOf/.test(fn),
  "sin renumerar"
);

// ── El cierre de la intro ───────────────────────────────────────────────────
comprobar(
  // Si se quedara en la última de la lista y esa estuviera apagada, la intro no
  // cerraría: ni intro_done, ni menú de pago, ni nada de lo que va detrás.
  "el cierre va en la última ENCENDIDA",
  /const ultima = aEnviar\[aEnviar\.length - 1\];/.test(fn) &&
    /is_last: commercialRoute === "A" && i === ultima,/.test(fn),
  "sí"
);
comprobar(
  "con todas apagadas, la intro cierra igual",
  /if \(aEnviar\.length === 0 && commercialRoute === "A"\) \{/.test(fn) &&
    /skip_intro_step: true,/.test(fn),
  "no se cuelga"
);
comprobar(
  // La ruta B tiene su propio cierre y usa la suma de esperas. Contando las
  // apagadas salía muchísimo después de la última burbuja que se vio.
  "la ruta B tampoco cuenta las apagadas",
  /paso\.enabled === false \? suma : suma \+ \(paso\.delay_after_sec \?\? 0\)/.test(
    engine
  ),
  "sí"
);

// ── Lo que no cambia ────────────────────────────────────────────────────────
comprobar(
  // Una burbuja apagada que llegue igual (por una programación vieja, en curso)
  // sigue sin enviarse. La protección se queda donde estaba.
  "una burbuja apagada sigue sin enviarse",
  /if \(!payload\.skip_intro_step && step && step\.enabled !== false\) \{/.test(
    engine
  ),
  "intacto"
);
comprobar(
  "y la pausa por decisiones sigue igual",
  /setIntroPausedIndex\(convo\.id, payload\.step_index \+ 1\);/.test(engine),
  "intacto"
);

// ── Y LOS SEGUIMIENTOS, que tienen su PROPIO programador ────────────────────
//
// LO QUE PASÓ — 28 de septiembre de 2026. El dueño preguntó por qué tardaban sus
// seguimientos y al medirlo con su contenido salió el mismo fallo de arriba,
// intacto:
//
//     segundo  0   paso 0  imagen   apagado
//     segundo  6   paso 1  imagen   apagado
//     segundo  9   paso 2  texto    SALE
//     segundo 12   paso 3  imagen   apagado
//     segundo 15   paso 4  video    apagado
//     segundo 18   paso 5  texto    apagado
//     segundo 24   paso 6  texto    SALE
//
//     salen 2 de 7 · la tanda ocupa 29s · 21s los gastan burbujas APAGADAS
//
// NO FUE UNA REGRESIÓN. El arreglo de arriba nunca llegó aquí: la intro y los
// seguimientos tienen dos programadores distintos y solo se tocó el de la intro.
// Es la trampa de siempre — la misma regla en dos sitios— y por eso esta prueba
// vigila LOS DOS a partir de ahora.
console.log("\n— y los seguimientos, que programan aparte —\n");
const fnSeg =
  engine.match(
    /const aEnviar: number\[\] = \[\];\r?\n\s*for \(let i = 0; i < chosenFollowup\.steps\.length[\s\S]*?\r?\n\s{4}\}/
  )?.[0] ?? "";
comprobar(
  "el programador del seguimiento está donde se le busca",
  fnSeg.length > 0,
  fnSeg.length > 0 ? "sí" : "NO"
);
comprobar(
  "solo se programan las burbujas encendidas",
  /if \(chosenFollowup\.steps\[i\]\?\.enabled !== false\) aEnviar\.push\(i\);/.test(
    engine
  ),
  "las apagadas no"
);
comprobar(
  "y solo ellas suman espera",
  /for \(const i of aEnviar\) \{[\s\S]*?cumulativeDelay \+= chosenFollowup\.steps\[i\]\.delay_after_sec \?\? 0;/.test(
    engine
  ),
  "sí"
);
comprobar(
  // El envío lee la burbuja por su número dentro de la lista completa, igual que
  // en la intro. Renumerar aquí mandaría el texto de otra burbuja.
  "los índices siguen siendo los de la lista completa",
  /step_index: i,\r?\n\s*is_last: i === ultima,/.test(engine),
  "sin renumerar"
);
comprobar(
  // No es solo la última burbuja: marca el seguimiento como enviado y suelta el
  // menú de pago y la elección de doble oferta. Si se quedara en una apagada que
  // ya no se programa, nada de eso ocurriría.
  "el cierre va en la última ENCENDIDA",
  /const ultima = aEnviar\[aEnviar\.length - 1\];/.test(engine) &&
    /is_last: i === ultima,/.test(engine),
  "sí"
);
comprobar(
  "con todas apagadas, el seguimiento cierra igual",
  /if \(aEnviar\.length === 0 && chosenFollowup\.steps\.length > 0\) \{/.test(
    engine
  ) && /const cierrePayload: SendFollowupStepPayload = \{/.test(engine),
  "no se queda a medias"
);
comprobar(
  // La protección del envío se queda donde estaba: una burbuja apagada que
  // llegue por una programación vieja sigue sin enviarse, y el is_last sigue su
  // curso aunque lo lleve una apagada.
  "una burbuja apagada del seguimiento sigue sin enviarse",
  /if \(step\.enabled !== false\) \{/.test(engine),
  "intacto"
);

console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} comprobación(es) mal.`);
// Y AHORA SÍ DEVUELVE CÓDIGO DE ERROR.
//
// Esta prueba terminaba sin `process.exit`, así que salía con 0 aunque algo
// fallara: la batería la contaba como verde SIEMPRE. Se encontró al añadir la
// sección de los seguimientos, y se arregla aquí porque si no, lo de arriba
// tampoco estaba vigilado de verdad.
process.exit(fallos === 0 ? 0 : 1);
process.exit(fallos === 0 ? 0 : 1);
