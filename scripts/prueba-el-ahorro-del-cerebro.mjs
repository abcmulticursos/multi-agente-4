// El ahorro del cerebro: poner delante lo que nunca cambia.
//
// POR QUE HAY QUE AHORRAR AQUI
//
//   El proveedor cobra la DECIMA PARTE por lo que reconoce desde el principio
//   de la peticion —el prefijo— y a precio lleno todo lo que venga tras la
//   primera diferencia.
//
//   Hoy lo primero que se manda es el cerebro, y el cerebro cambia segun el
//   estado y segun las palabras del cliente. Basta una palabra distinta para
//   pagar entero el resto de la peticion.
//
// QUE HACE EL ARREGLO
//
//   Cada trozo del prompt se marca como fijo o variable. Encendido, los fijos
//   van DELANTE y entran en la parte cacheable. No se quita ni se anade una
//   sola palabra: solo cambia el ORDEN en que el modelo las lee.
//
// LO QUE ESTA PRUEBA PROTEGE, Y ES LO IMPORTANTE
//
//   Que APAGADO no cambie nada. Apagado los trozos se pegan en su orden de
//   siempre y sale la misma cadena de antes, letra por letra. Si alguien rompe
//   eso, el interruptor deja de ser un interruptor y pasa a ser un cambio
//   permanente disfrazado.
//
//   node scripts/prueba-el-ahorro-del-cerebro.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");
const llm = leer("src", "lib", "openrouter.ts");
const config = leer("src", "lib", "workflow", "config.ts");
const ruta = leer("src", "app", "api", "workflow", "route.ts");
const editor = leer("src", "app", "editor", "page.tsx");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

const zona = (() => {
  const i = llm.indexOf("function buildSystemPrompt(");
  const f = llm.indexOf("function toChatMessages(", i);
  return i < 0 || f < 0 ? "" : llm.slice(i, f);
})();
comprobar("se encuentra el armado del prompt", zona.length > 0, "buildSystemPrompt");

// -- 1. APAGADO NO CAMBIA NADA -----------------------------------------------
//
// Es la mitad que de verdad importa. Todo lo demas se puede apagar; esto no.
comprobar(
  "apagado, los trozos van en su orden de siempre",
  /const enSuOrden = trozos\.map\(\(t\) => t\.texto\)\.join\(""\);/.test(zona) &&
    /if \(!cfgPrompt\?\.prompt_cache_enabled\) \{\s*\r?\n\s*return \{ cacheable: cacheable \+ multiCountryOverride, dynamic: enSuOrden \};/.test(
      zona
    ),
  "la misma cadena de antes"
);
comprobar(
  "el interruptor nace apagado",
  /prompt_cache_enabled\?: boolean;/.test(config) &&
    /prompt_cache_enabled: config\?\.prompt_cache_enabled === true/.test(ruta),
  "hay que encenderlo a mano"
);

// -- 2. TODO EL PROMPT PASA POR LOS TROZOS -----------------------------------
//
// Un `prompt +=` suelto que se quedara sin convertir seria texto que desaparece
// del prompt: no daria error de tipos ni de compilacion, y el bot se quedaria
// sin esa instruccion sin que nada lo dijera.
comprobar(
  "no queda ningun trozo pegado a mano",
  !/prompt \+=/.test(zona) && !/let prompt = ""/.test(zona),
  "ni uno"
);
const cuantosAdd = (zona.match(/\n\s*add\(`/g) ?? []).length;
const cuantosFijos = (zona.match(/\n\s*addFijo\(`/g) ?? []).length;
// EL NUMERO SUBE CUANDO SE AÑADE UN TROZO DE VERDAD, y eso es correcto: lo que
// esta afirmacion vigila es que NINGUN texto entre al prompt sin pasar por `add`
// o `addFijo`. El 17/09/2026 paso de 46 a 47 al entrar la regla de que la imagen
// responde la primera vez — un `add` condicionado, que es justo la forma buena.
// Y de 47 a 48 el mismo dia, al entrar la CAPA 2: la que solo existe en el turno
// siguiente a la oferta de imagenes y decide si el cliente acepto. Es un `add`
// condicionado y NO viaja en los demas turnos, asi que no engorda el prompt de
// la conversacion normal.
// Subio a 49 el 26/09/2026 con el aviso de «hemos actualizado», y VOLVIO A 48 el
// 27: ese aviso lo suelta ahora el MOTOR, porque pedirselo al modelo fallo dos
// veces —se lo saltaba, o lo dabamos por dicho cuando solo habia nombrado los
// productos—. Bajar tambien es correcto: lo que vigila esta afirmacion es que
// ningun texto entre al prompt sin pasar por `add` o `addFijo`.
comprobar(
  "estan los 48 trozos del prompt",
  cuantosAdd + cuantosFijos === 48,
  `${cuantosAdd} variables + ${cuantosFijos} fijos`
);

// -- 3. LO FIJO ES DE VERDAD FIJO --------------------------------------------
//
// Marcar como fijo algo que cambia seria PEOR que no hacer nada: rompe el
// prefijo antes, y se pierde tambien todo lo que venga detras. Por eso solo
// entran trozos sin condicion de turno y sin nada interpolado que cambie.
const fijos = [...zona.matchAll(/addFijo\((`[\s\S]*?`)\);/g)].map((m) => m[1]);
comprobar(
  "se encuentran los trozos fijos",
  fijos.length === cuantosFijos && fijos.length > 0,
  `${fijos.length}`
);
// AQUI SE TOLERABAN DOS INTERPOLACIONES. LAS DOS ERAN FALSAS, Y SE MIDIO.
//
// Decia esto, y las dos razones resultaron equivocadas:
//
//   getDistrustMessage()      «sale del contenido del panel, es la misma en toda
//                             la vida del despliegue». NO: cuando el dueno no la
//                             tiene configurada devuelve vacio, y entonces el
//                             ternario que la rodea cae a un texto QUE DEPENDE
//                             DEL ESTADO —uno si ya se mandaron los datos de
//                             pago y otro si no—. Eso cambia el prefijo a mitad
//                             de la venta.
//
//   upsellReceiptInstruction  «solo se llena al final, se acepta a cambio de no
//                             tocar el bloque de pago». No hacia falta el
//                             cambio: el bloque se partio sin mover una palabra
//                             de su texto.
//
// LO QUE COSTO, medido el 15 de septiembre de 2026 con un banco sobre las
// conversaciones reales del dueno (huella del prefijo en cada estado):
//
//     eligiendo -> payment_done    prefijo distinto   -2.737 tokens de cache
//     tras partir el bloque        prefijo IDENTICO   sin perdida
//
// En sus registros, 15 de 17 llamadas llegaban con `cacheado=0/0%`.
//
// POR ESO AHORA NO SE TOLERA NINGUNA. Un trozo fijo con algo interpolado rompe
// el prefijo ANTES y se lleva por delante todo lo que venga detras: es peor que
// no marcarlo. Si algo varia, va con `add` y se lee mas tarde.
const PERMITIDAS = new Set([]);
const intrusas = [];
for (const trozo of fijos) {
  for (const m of trozo.matchAll(/\$\{\s*([A-Za-z_$][\w$]*)/g)) {
    if (!PERMITIDAS.has(m[1])) intrusas.push(m[1]);
  }
}
comprobar(
  "ninguno interpola algo que cambie por turno",
  intrusas.length === 0,
  intrusas.length === 0 ? "limpios" : [...new Set(intrusas)].join(", ")
);
// El mas grande es el de validacion de pago. Es texto fijo y es la pieza que
// hace que el ahorro valga la pena: sin el, lo movible es una decima parte.
comprobar(
  "el bloque de validacion de pago va en el prefijo",
  fijos.some((t) => /PAYMENT VALIDATION:/.test(t)),
  "la pieza grande"
);

// -- 4. ENCENDIDO, LO FIJO VA DELANTE ----------------------------------------
comprobar(
  "encendido, lo fijo entra en la parte cacheable",
  /cacheable: loFijo \+ cacheable \+ multiCountryOverride,/.test(zona),
  "delante del cerebro"
);
comprobar(
  "y lo variable se queda detras",
  /dynamic: loVariable,/.test(zona),
  "sin mezclarse"
);
comprobar(
  "cada mitad conserva su orden interno",
  /trozos\s*\r?\n?\s*\.filter\(\(t\) => t\.fijo\)/.test(zona) &&
    /trozos\s*\r?\n?\s*\.filter\(\(t\) => !t\.fijo\)/.test(zona),
  "filtrar no reordena"
);

// -- 5. SE ENCIENDE Y SE APAGA SIN DEPLOYAR ----------------------------------
comprobar(
  "la API lo lee del yaml",
  /prompt_cache_enabled: config\?\.prompt_cache_enabled === true,/.test(ruta),
  "de vuelta"
);
// Se escribe SIEMPRE, encendido o apagado: un booleano que solo se guarda
// cuando es `true` no se puede apagar nunca desde el panel.
comprobar(
  "y lo escribe al guardar, encendido o apagado",
  /doc\.set\("prompt_cache_enabled", g\.prompt_cache_enabled === true\);/.test(
    ruta
  ),
  "se puede apagar"
);
comprobar(
  "hay un boton en Ajustes",
  /prompt_cache_enabled: !\(g\.prompt_cache_enabled === true\)/.test(editor) &&
    /"Desactivar ahorro"/.test(editor) &&
    /"Activar ahorro"/.test(editor),
  "verde encendido, rojo apagado"
);
comprobar(
  "y dice como comprobarlo",
  /\[llm:usage\]/.test(editor),
  "el porcentaje cacheado del registro"
);
// El registro ya existia y es lo que convierte esto en algo medible.
comprobar(
  "el registro sigue diciendo cuanto se cacheo",
  /\[llm:usage\][\s\S]{0,120}?cacheado=/.test(llm),
  "sin creerle a nadie"
);

console.log(fallos === 0 ? "\nTODO OK" : `\n${fallos} FALLO(S)`);
process.exit(fallos === 0 ? 0 : 1);
