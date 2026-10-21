// «No entiendo» no es «no gracias».
//
// LO QUE PASO
//
//   Compro, el bot le ofrecio el segundo producto, y el escribio:
//
//       «este es otro»
//       «no entiendo»
//
//   El bot lo dio por rechazado y le pidio perdon por habérselo ofrecido. En el
//   log, una sola linea:  [wf:upsell] convo 98: dijo que no
//
// LA CAUSA
//
//   El detector del «no» era `^(no|…)\b`: bastaba con EMPEZAR por «no» y detras
//   podia ir cualquier cosa. Asi que eran rechazos «no entiendo», «no se», «no
//   me llego», «no puedo pagar ahora», «no tengo yape»…
//
//   El detector del «si» SIEMPRE comparo la frase entera. Esa asimetria es la
//   que costaba la venta: equivocarse hacia el «si» se nota y se corrige;
//   equivocarse hacia el «no» cierra la conversacion y nadie se entera.
//
//   Ahora la lista es cerrada y se compara entera, igual que la del «si».
//
// ESTA PRUEBA EJECUTA EL DETECTOR DE VERDAD, sacado de config.ts.
//
//   node scripts/prueba-una-duda-no-es-un-no.mjs
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
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 46)} ${valor}`);
};

// ── El detector real, sacado del archivo ─────────────────────────────────────
const trozo = (desde, hasta) => {
  const i = config.indexOf(desde);
  const f = config.indexOf(hasta, i);
  return i < 0 || f < 0 ? "" : config.slice(i, f);
};
const lista = trozo("const RECHAZOS_DEL_EXTRA = new Set([", "]);") + "]);";
const cuerpo = trozo(
  "export function detectaRechazoDeUpsell(msg: string): boolean {",
  "\n}"
);
const { detectaRechazoDeUpsell, RECHAZOS_DEL_EXTRA } = new Function(
  [
    lista,
    cuerpo.replace(/export function detectaRechazoDeUpsell\(msg: string\): boolean \{/, "function detectaRechazoDeUpsell(msg) {") + "\n}",
    "return { detectaRechazoDeUpsell, RECHAZOS_DEL_EXTRA };",
  ].join("\n\n")
)();

// ── 1. Las dudas YA NO son un no ─────────────────────────────────────────────
const DUDAS = [
  "no entiendo",
  "este es otro no entiendo",
  "no se",
  "no me quedo claro",
  "no me llego",
  "no puedo pagar ahora",
  "no tengo yape",
  "no es muy caro",
  "no sabia que habia otro",
];
for (const frase of DUDAS) {
  comprobar(`«${frase}»`, detectaRechazoDeUpsell(frase) === false, "no es un rechazo");
}

// ── 2. Un no de verdad SIGUE siendo un no ────────────────────────────────────
const RECHAZOS = [
  "no",
  "No.",
  "no gracias",
  "No, gracias",
  "no me interesa",
  "paso",
  "asi esta bien",
  "por ahora no",
  "otro dia",
];
console.log("");
for (const frase of RECHAZOS) {
  comprobar(`«${frase}»`, detectaRechazoDeUpsell(frase) === true, "sí es un rechazo");
}

// ── 3. La forma, para que no vuelva a abrirse ────────────────────────────────
console.log("");
comprobar(
  "la lista es cerrada y se compara entera",
  /return RECHAZOS_DEL_EXTRA\.has\(t\);/.test(config) &&
    !/\^\(no\|no gracias[\s\S]{0,200}?\\b/.test(config),
  "sin «empieza por no»"
);
comprobar(
  "y limpia la puntuación, como el «sí»",
  /\.replace\(\/\[!¡\.,¿\?\]\/g, " "\)[\s\S]{0,120}?RECHAZOS_DEL_EXTRA\.has/.test(
    config
  ),
  "«no, gracias.» cuenta"
);
comprobar(
  "hay rechazos configurados",
  RECHAZOS_DEL_EXTRA.size >= 20,
  `${RECHAZOS_DEL_EXTRA.size} frases`
);

console.log(
  fallos === 0
    ? "\nTODO OK — una duda ya no cierra la segunda venta"
    : `\n${fallos} comprobacion(es) mal.`
);
process.exit(fallos === 0 ? 0 : 1);
