// «mejor el otro, no tengo mucho dinero» es un SI al otro, no un no.
//
// LO QUE PASO
//
//   El cliente tenia el combo elegido y escribio:
//
//       «mejor el otro por favor no tengo mucho dinero»
//       «no me alcanza mejor el que viene solo»
//
//   El bot NO cambiaba la opcion. Seguia con el combo, o le repreguntaba
//   «¿quieres que te indique como adquirirlo?».
//
// LA CAUSA
//
//   `cambioDeOpcionPorElOtro` parte el mensaje POR LA PUNTUACION para separar
//   ideas, y luego descarta la frase si lleva un «no». La idea es correcta:
//   «no quiero el otro» no puede cambiar nada.
//
//   Pero el dueño lo dijo con todas las letras el 2026-09-14: «las personas
//   nunca ponen signos, ni comas». Sin la coma, «mejor el otro por favor no
//   tengo mucho dinero» es UNA sola frase. El «no» de «no tengo dinero» cae
//   dentro, y se lleva por delante la decision.
//
//   O sea: el freno que protege la venta era el que la estaba parando.
//
// EL ARREGLO
//
//   El «no» que niega va PEGADO al verbo de decidir. El que explica un motivo va
//   suelto. La separacion deja de depender de un signo que nadie escribe y pasa
//   a depender de la posicion, que siempre esta.
//
//   Acotado a -OB-. Fuera de ahi, el freno de siempre.
//
//   node scripts/prueba-el-no-que-explica-no-es-el-no-que-niega.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const config = readFileSync(
  join(RAIZ, "src", "lib", "workflow", "config.ts"),
  "utf8"
);

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 56)} ${valor}`);
};

// ── El detector real, sacado del archivo ─────────────────────────────────────
const trozo = (desde, hasta) => {
  const i = config.indexOf(desde);
  if (i < 0) return "";
  const f = config.indexOf(hasta, i);
  return f < 0 ? "" : config.slice(i, f);
};
const verbos =
  trozo("const VERBOS_DE_DECIDIR = new Set([", "]);") + "]);";
const cuerpo =
  trozo("function laNegacionEsDelCambio(frase: string): boolean {", "\n}") +
  "\n}";
if (!verbos || !cuerpo) throw new Error("no encuentro el detector en config.ts");

const { laNegacionEsDelCambio } = new Function(
  [
    verbos,
    cuerpo.replace(
      "function laNegacionEsDelCambio(frase: string): boolean {",
      "function laNegacionEsDelCambio(frase) {"
    ),
    "return { laNegacionEsDelCambio };",
  ].join("\n\n")
)();

// ── 1. El «no» que EXPLICA un motivo: la decision se respeta ─────────────────
console.log("— el «no» que explica: sigue siendo una decision —\n");
const EXPLICAN = [
  "mejor el otro por favor no tengo mucho dinero",
  "no me alcanza mejor el que viene solo",
  "el otro no tengo tanto",
  "mejor el otro no me alcanza ahorita",
  "no, mejor el otro",
  "no mejor el otro",
  "mejor el basico por que no tengo plata",
  "no puedo pagar tanto mejor el otro",
];
for (const frase of EXPLICAN) {
  comprobar(
    `«${frase.slice(0, 44)}»`,
    laNegacionEsDelCambio(frase) === false,
    "decide"
  );
}

// ── 2. El «no» que NIEGA de verdad: sigue frenando ───────────────────────────
//    Este freno no se toca: cambiar la opcion cuando el cliente la esta
//    rechazando le cobraria un producto que dijo que no quiere.
console.log("\n— el «no» que niega: sigue frenando —\n");
const NIEGAN = [
  "no quiero el otro",
  "ya no quiero el otro",
  "el otro no lo quiero",
  "no me quedo con el otro",
  "no prefiero el otro",
  "nunca quiero el otro",
  "tampoco quiero el otro",
  "no elijo el otro",
];
for (const frase of NIEGAN) {
  comprobar(
    `«${frase.slice(0, 44)}»`,
    laNegacionEsDelCambio(frase) === true,
    "frena"
  );
}

// ── 3. La forma ──────────────────────────────────────────────────────────────
console.log("\n— la forma del arreglo —\n");
comprobar(
  "«mejor» NO cuenta como verbo de decidir",
  !/"mejor"/.test(verbos),
  "«no, mejor el otro» decide"
);
comprobar(
  "el freno viejo sigue existiendo para las demas modalidades",
  /const NIEGA = \/\\b\(no\|ni\|tampoco\|nunca\|jamas\)\\b\//.test(config),
  "no se borro"
);
// YA NO HAY PUERTA DE MODALIDAD, Y ES LO QUE SE PEDIA.
//
// Se probo primero acotado a -OB-, como manda el dueno. Funciono, y el
// 2026-09-14 pidio llevarlo al resto: lo destapo `recorrido-completo --todas`,
// donde -DOU- seguia con el fallo original -«mejor el otro» no cambiaba nada-,
// que es exactamente la venta que se perdia en -OB-. La intencion de esta linea
// no cambia: comprobar que el «no» se mira por posicion y en un solo sitio.
comprobar(
  "el «no» se mira por posicion en TODAS las modalidades",
  /if \(laNegacionEsDelCambio\(laDelOtro\)\) return null;/.test(config) &&
    !/laModalidadActivaEsOrderBump\(\)\s*\r?\n?\s*\? laNegacionEsDelCambio/.test(
      config
    ),
  "sin candado de modalidad"
);

console.log(
  fallos === 0
    ? "\nTODO OK — explicar por que no es lo mismo que decir que no"
    : `\n${fallos} comprobacion(es) mal.`
);
process.exit(fallos === 0 ? 0 : 1);
