// Cada burbuja con cuadritos decide CUANTO espera.
//
// COMO ESTABA
//
//   Una burbuja con cuadritos de decision detiene la intro hasta que el cliente
//   contesta. Si no contesta, el resto se soltaba a los 3 minutos. Tres minutos
//   para todas, en las seis modalidades, sin forma de cambiarlo.
//
//   Una pregunta de «si o no» se contesta en segundos y otra que obliga a
//   pensar merece mas. El numero unico salia corto para una y eterno para la
//   otra, y no habia donde tocarlo.
//
// COMO QUEDA
//
//   Debajo de los cuadritos, en la burbuja, un campo de minutos. Vacio = los 3
//   de siempre, asi que nada cambia hasta que se escriba un numero.
//
// LAS DOS COSAS QUE NO PUEDEN PASAR
//
//   1. Que el campo salga sin cuadritos ENCENDIDOS. Sin cuadritos no hay pausa
//      que medir: seria un numero que no hace nada.
//
//   2. Que al leer o al guardar se congele un 3 en cada burbuja del bot. El
//      campo tiene que poder estar VACIO y significar «el de siempre». Si el
//      lector le pusiera un 3 por defecto, el primer guardado lo escribiria en
//      todas y ya nunca se podria volver atras.
//
//   node scripts/prueba-cada-cuadrito-con-su-tiempo.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");
const config = leer("src", "lib", "workflow", "config.ts");
const motor = leer("src", "lib", "workflow", "engine.ts");
const ruta = leer("src", "app", "api", "workflow", "route.ts");
const editor = leer("src", "app", "editor", "page.tsx");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// -- 1. LA BURBUJA LO CONOCE -------------------------------------------------
comprobar(
  "la burbuja tiene su propio plazo",
  /espera_eleccion_minutos\?: number;/.test(config),
  "config.ts"
);
comprobar(
  "y el editor lo llama igual",
  /espera_eleccion_minutos\?: number;/.test(editor),
  "mismo nombre"
);

// -- 2. EL MOTOR LO USA, Y CAE AL DE SIEMPRE ---------------------------------
const pausa = (() => {
  const i = motor.indexOf("CADA BURBUJA CON SU PLAZO");
  return i < 0 ? "" : motor.slice(i, i + 1200);
})();
comprobar("se encuentra la pausa", pausa.length > 0, "engine.ts");
comprobar(
  "el plazo sale de la burbuja",
  /const suPlazo = step\.espera_eleccion_minutos;/.test(pausa),
  "suyo, no global"
);
comprobar(
  "se cuenta en minutos",
  /Math\.round\(suPlazo \* 60\)/.test(pausa),
  "x60"
);
// Vacio, cero o basura => los 3 minutos de siempre. Es lo que hace que esto no
// cambie nada hasta que alguien escriba un numero.
comprobar(
  "vacio o mal puesto usa el de siempre",
  /typeof suPlazo === "number" && Number\.isFinite\(suPlazo\) && suPlazo > 0/.test(
    pausa
  ) && /: ESPERA_DE_ELECCION_EN_INTRO_SEGUNDOS;/.test(pausa),
  "3 minutos"
);
comprobar(
  "el de siempre sigue siendo 180 segundos",
  /const ESPERA_DE_ELECCION_EN_INTRO_SEGUNDOS = 180;/.test(motor),
  "nada cambia sin tocarlo"
);
// La pausa sigue exigiendo un cuadrito ENCENDIDO. Si esto se rompiera, el plazo
// se aplicaria a burbujas que no esperan nada.
comprobar(
  "solo hay pausa con un cuadrito encendido",
  /decisionesEncendidas\(step\.decisions\)\.length > 0/.test(motor),
  "sin cuadritos no hay espera"
);

// -- 3. LA API, DE IDA Y DE VUELTA -------------------------------------------
comprobar(
  "al leer, vacio se queda VACIO",
  /espera_eleccion_minutos:\s*\r?\n?\s*typeof s\?\.espera_eleccion_minutos === "number" &&[\s\S]{0,200}?: undefined,/.test(
    ruta
  ),
  "no se congela un 3"
);
comprobar(
  // «Hay cuadritos» paso a ser «la burbuja espera algo»: pedir el nombre
  // tambien detiene, asi que ahi el plazo tambien sirve. Lo que se vigila sigue
  // siendo que sin pausa NO se escriba el numero.
  "al guardar, solo si la burbuja espera y hay numero",
  /const esperaField =\s*\r?\n\s*\(decisions\.length \|\| pideNombre\) &&[\s\S]{0,220}?\{ espera_eleccion_minutos: plazo \}/.test(
    ruta
  ),
  "nada de datos muertos"
);
comprobar(
  "y va en los dos tipos de burbuja",
  (ruta.match(/\.\.\.esperaField,?/g) ?? []).length === 2,
  "texto y media"
);

// -- 4. LA PANTALLA ----------------------------------------------------------
comprobar(
  "el campo va debajo de los cuadritos",
  /EL PLAZO DE ESTA BURBUJA/.test(editor) &&
    /Cuánto espera esta burbuja/.test(editor),
  "en su burbuja"
);
comprobar(
  // Con todos los cuadritos apagados y sin pedir el nombre, la burbuja no
  // espera nada y el campo desaparece. Que ahora tambien salga cuando pide el
  // nombre no afloja la regla: sigue habiendo pausa que medir.
  "solo aparece si la burbuja espera algo",
  /\{\(pideNombre \|\| decisions\.some\(\(d\) => d\.enabled !== false\)\) && \(/.test(
    editor
  ),
  "apagados y sin nombre, no sale"
);
comprobar(
  "lleva el reloj",
  /<span aria-hidden>🕐<\/span>/.test(editor),
  "🕐"
);
// SE ESCRIBE EN CRUDO Y SE INTERPRETA AL SALIR.
//
// Antes se interpretaba en CADA tecla y el resultado volvia al campo: escribir
// «0» —el primer caracter de «0.5» y de «05»— daba un numero no valido, el
// campo se vaciaba solo y la tecla se perdia. El punto decimal, igual. No daba
// error: simplemente no se podia escribir.
comprobar(
  "vacio se guarda como vacio",
  /const bueno = limpio !== "" && Number\.isFinite\(n\) && n > 0 \? n : undefined;/.test(
    editor
  ),
  "se puede volver al de siempre"
);
comprobar(
  "y lo tecleado no se pierde mientras se escribe",
  /onChange=\{\(e\) => setEscrito\(e\.target\.value\)\}/.test(editor) &&
    /onBlur=\{interpretar\}/.test(editor),
  "se interpreta al salir"
);
comprobar(
  "y dice cuanto vale estar vacio",
  /Vacío = 3 minutos/.test(editor),
  "sin adivinar"
);
comprobar(
  "la burbuja se lo pasa al editor de cuadritos",
  /espera=\{step\.espera_eleccion_minutos\}/.test(editor) &&
    /onEspera=\{\(espera_eleccion_minutos\) =>/.test(editor),
  "conectado"
);

console.log(fallos === 0 ? "\nTODO OK" : `\n${fallos} FALLO(S)`);
process.exit(fallos === 0 ? 0 : 1);
