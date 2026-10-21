// Una palabra corriente y suelta no decide dentro de una frase larga.
//
// LO QUE PASO — 14 de septiembre de 2026
//
//   El dueno puso «tengo» en un cuadrito «SI» de su intro, pensando en «tengo
//   yape». Con eso, cualquier frase que llevara ese verbo contestaba a esa
//   burbuja. Su mensaje era:
//
//       «mejor el otro por favor no tengo mucho dinero»
//
//   y el registro:
//
//       [wf:decision] "SI" ya estaba contestado → le reenvio sus datos
//
//   El turno murio ahi. Y no es cosa de una palabra: el dueno va a escribir
//   cientos de respuestas personalizadas. Vigilarlas una a una no es un plan.
//
// LA REGLA YA ESTABA EN LA CASA
//
//   Escrita para los cuadritos del segundo producto: «quien contesta un
//   cuadrito contesta CORTO; una palabra clave de UNA sola palabra solo decide
//   en respuestas cortas; las de varias siguen valiendo en cualquier sitio, que
//   nadie escribe eso por casualidad». Y decia expresamente: «los cuadritos de
//   la intro se quedan como estaban». Se igualan.
//
// CON UNA EXCEPCION QUE ANADE, NO QUITA
//
//   Una sola palabra que NOMBRA algo del negocio -«yape», «combo», el nombre de
//   un producto- sigue decidiendo en cualquier frase. Sale de la configuracion,
//   asi que la lista se rehace sola al cambiar de producto: el codigo no conoce
//   ningun nombre.
//
//   node scripts/prueba-una-palabra-corriente-no-decide-en-una-frase.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const motor = readFileSync(
  join(RAIZ, "src", "lib", "workflow", "engine.ts"),
  "utf8"
);

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 56)} ${valor}`);
};

// ── El filtro real, sacado del motor ─────────────────────────────────────────
const i = motor.indexOf("const soloLasQueSeñalan = (decision");
const fin = motor.indexOf("\n  };", i);
const filtro = motor.slice(i, fin) + "\n  };";
const iLimpia = motor.indexOf("const limpiarTexto = (t: string");
const limpiarSrc = motor
  .slice(iLimpia, motor.indexOf("const esRespuestaCorta", iLimpia))
  .replace("const limpiarTexto = (t: string | undefined | null): string =>", "const limpiarTexto = (t) =>");
const PALABRAS = motor.slice(
  motor.indexOf("const PALABRAS_QUE_NO_SEÑALAN ="),
  motor.indexOf(";", motor.indexOf("const PALABRAS_QUE_NO_SEÑALAN =")) + 1
);

const decide = (clave, mensaje, nombres = []) =>
  new Function(
    "clave",
    "mensaje",
    "nombresArr",
    [
      PALABRAS,
      limpiarSrc,
      "const esRespuestaCorta = limpiarTexto(mensaje).split(' ').filter(Boolean).length <= 4;",
      "const nombranAlgo = new Set(nombresArr);",
      filtro
        .replace("const soloLasQueSeñalan = (decision: BubbleDecision): BubbleDecision | null =>", "const soloLasQueSeñalan = (decision) =>"),
      "return soloLasQueSeñalan({ keywords: [clave] }) !== null;",
    ].join("\n\n")
  )(clave, mensaje, nombres);

const LARGA = "mejor el otro por favor no tengo mucho dinero";
const CORTA = "tengo";

// ── 1. El caso que mato el turno ─────────────────────────────────────────────
console.log("— una palabra corriente, dentro de una frase larga —\n");
comprobar(
  "«tengo» en una frase de 8 palabras -> NO decide",
  decide("tengo", LARGA) === false,
  "el turno sigue su camino"
);
for (const p of ["quiero", "puedo", "necesito", "entiendo"]) {
  comprobar(
    `«${p}» en una frase larga -> NO decide`,
    decide(p, `no ${p} eso que me estas diciendo ahora mismo`) === false,
    "igual"
  );
}

// ── 2. PERO CONTESTANDO CORTO, SIGUE VALIENDO ────────────────────────────────
console.log("\n— contestando corto, decide igual que siempre —\n");
comprobar(
  "«tengo» contestando «tengo» -> decide",
  decide("tengo", CORTA) === true,
  "respuesta corta"
);
comprobar(
  "«tengo» en «si tengo eso» (3 palabras) -> decide",
  decide("tengo", "si tengo eso") === true,
  "sigue siendo corta"
);

// ── 3. Y LAS DE VARIAS PALABRAS, EN CUALQUIER SITIO ──────────────────────────
console.log("\n— las de varias palabras no cambian —\n");
comprobar(
  "«tengo yape» dentro de una frase larga -> decide",
  decide("tengo yape", "hola tengo yape pero no se como se hace el pago") === true,
  "nadie la escribe por casualidad"
);
comprobar(
  "«no tengo» dentro de una frase larga -> decide",
  decide("no tengo", LARGA) === true,
  "especifica"
);

// ── 4. LA EXCEPCION: SI NOMBRA ALGO SUYO, VALE SIEMPRE ───────────────────────
console.log("\n— y si la palabra NOMBRA algo del negocio, vale siempre —\n");
comprobar(
  "«yape» en frase larga, estando entre sus metodos -> decide",
  decide("yape", "hola queria saber si puedo pagarte con yape o no", ["yape", "plin"]) === true,
  "nombra un metodo"
);
comprobar(
  "«combo» en frase larga, estando en sus productos -> decide",
  decide("combo", "oye y el combo ese que me dijiste cuanto sale", ["combo", "papel"]) === true,
  "nombra un producto"
);
comprobar(
  "la misma palabra SIN estar configurada -> no decide",
  decide("combo", "oye y el combo ese que me dijiste cuanto sale", []) === false,
  "la lista sale de su contenido"
);

// ── 5. Lo de siempre sigue igual ─────────────────────────────────────────────
console.log("\n— y los frenos de antes, intactos —\n");
comprobar(
  "«si» y «ok» siguen descartados fuera de su momento",
  decide("si", CORTA) === false && decide("ok", CORTA) === false,
  "PALABRAS_QUE_NO_SEÑALAN"
);
comprobar(
  "una decision apagada no decide",
  /if \(decision\.enabled === false\) return null;/.test(filtro),
  "se respeta el interruptor"
);
comprobar(
  "los nombres salen de la configuracion, no del codigo",
  /function palabrasQueNombranAlgo\(/.test(motor) &&
    /oferta\?\.combo\?\.name/.test(motor) &&
    /boton\?\.aliases/.test(motor),
  "sin nombres escritos a mano"
);

console.log(
  fallos === 0
    ? "\nTODO OK — puede escribir las palabras que quiera"
    : `\n${fallos} comprobacion(es) mal.`
);
process.exit(fallos === 0 ? 0 : 1);
