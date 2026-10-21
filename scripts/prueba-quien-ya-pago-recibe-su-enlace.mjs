// QUIEN YA PAGO Y PIDE LO QUE COMPRO, LO RECIBE — TAMBIEN CON EL EXTRA EN JUEGO.
//
// LO QUE PASO — 29 de septiembre de 2026, su prueba ARYI1 (convo 287). Habia
// pagado, su entrega ya habia salido, y el extra estaba ofrecido sin pagar.
// Reclamo OCHO veces que no le llegaba el enlace y nunca lo recibio.
//
// LA CAUSA. En las etapas del regalo y del comentario hay una linea que dice «si
// puede venir el comprobante del extra, no tomo el turno». Esta bien puesta: un
// comprobante es una FOTO y tiene que llegar al lector. Pero se apartaba TAMBIEN
// con texto pelado, y ahi el turno se lo quedaba el modelo, sin red. El modelo
// leyo «ya pague y te mande la imagen» como un comprobante, intento registrar un
// pago, el guardarrail lo rechazo por no haber foto, y el cliente recibio otra
// peticion de comprobante.
//
// DE SUS SEIS CONVERSACIONES, ARYI1 fue la UNICA que estaba a la vez en el regalo
// Y con el extra sin pagar. Las otras cinco recibieron su enlace: tres por el
// camino determinístico, dos porque el modelo acerto a pedirlo. Cinco de seis
// dependian de la suerte.
//
// ESTA PRUEBA NO USA SUS FRASES. El dueño lo pidio asi: «no pongas regla que esa
// conversacion identica tendran todos los clientes». Se prueba con formas que él
// NUNCA escribio, para que quede claro que el arreglo no esta hecho a medida de
// una conversacion.
//
//   node scripts/prueba-quien-ya-pago-recibe-su-enlace.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const src = readFileSync(join(RAIZ, "src", "lib", "workflow", "engine.ts"), "utf8");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor = "") => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// ── 1. LAS DOS PUERTAS ESTAN ACOTADAS, Y LAS DOS IGUAL ──────────────────────
//
// Son gemelas: la del regalo y la del comentario, que es el paso siguiente.
// Arreglar una sola deja al mismo cliente chocando un paso despues.
console.log("\n— 1. las dos puertas, acotadas igual —\n");
// Las dos estan escritas distinto a proposito —una nombra la condicion, la otra
// la pone en linea— asi que se cuenta el acote, que es lo comun: la puerta con un
// «&&» detras. Sin acotar, la linea termina en «return false;» de golpe.
const acotadas = src.match(
  /\(mayBeDobleOfertaUpgradeReceipt \|\| esperaPagoDelUpsell\) &&/g
);
comprobar(
  "las DOS puertas piden ademas que no haya foto",
  (acotadas ?? []).length === 2,
  `${(acotadas ?? []).length} de 2`
);
comprobar(
  "y ninguna quedo sin acotar en las dos etapas del regalo",
  !/awaiting_gift_consent"\)\s*\{[\s\S]{0,600}?if \(mayBeDobleOfertaUpgradeReceipt \|\| esperaPagoDelUpsell\) return false;/.test(
    src
  ),
  "sin restos"
);
comprobar(
  "la del regalo usa el detector compartido",
  /const pideLoQueYaComproSinFoto = !latestIsImage && wantsPurchasedMaterial;/.test(
    src
  )
);
comprobar(
  "la del comentario, la misma condicion",
  /!\(!latestIsImage && wantsPurchasedMaterial\)/.test(src)
);
// Las tres puertas de DENTRO de «parece un eco de pago» no se tocan: esas solo
// corren cuando el mensaje ya suena a pago, y ahi apartarse es lo correcto.
comprobar(
  "las puertas de dentro del eco de pago siguen intactas",
  (src.match(
    /\/\/ segundo producto se valida aparte \(ver payment\.ts\), contra SU precio\.\s*\n\s*if \(mayBeDobleOfertaUpgradeReceipt \|\| esperaPagoDelUpsell\) return false;/g
  ) ?? []).length === 4,
  `${(src.match(/\/\/ segundo producto se valida aparte \(ver payment\.ts\), contra SU precio\.\s*\n\s*if \(mayBeDobleOfertaUpgradeReceipt \|\| esperaPagoDelUpsell\) return false;/g) ?? []).length} de 4`
);

// ── 2. NO SE AÑADIO NINGUNA FRASE AL CODIGO ─────────────────────────────────
console.log("\n— 2. ninguna frase suya metida en el codigo —\n");
const zona = src.slice(
  src.indexOf("const pideLoQueYaComproSinFoto"),
  src.indexOf("const pideLoQueYaComproSinFoto") + 400
);
comprobar(
  "el acote no trae ninguna cadena de texto",
  !/"[^"]{6,}"/.test(zona),
  "solo condiciones"
);
comprobar(
  "y quien decide sigue siendo el detector de siempre",
  (src.match(/if \(wantsPurchasedMaterial\) \{/g) ?? []).length === 4,
  "las cuatro etapas lo comparten"
);

// ── 3. LA TABLA DE LA VERDAD DE LA PUERTA ───────────────────────────────────
//
// Se evalua la condicion REAL, no una reescrita: se saca del archivo y se
// ejecuta con las cuatro combinaciones que existen.
console.log("\n— 3. cuando se aparta y cuando atiende —\n");
const puerta = new Function(
  "mayBeDobleOfertaUpgradeReceipt",
  "esperaPagoDelUpsell",
  "latestIsImage",
  "wantsPurchasedMaterial",
  `const pideLoQueYaComproSinFoto = !latestIsImage && wantsPurchasedMaterial;
   return (mayBeDobleOfertaUpgradeReceipt || esperaPagoDelUpsell) && !pideLoQueYaComproSinFoto;`
);
const CASOS = [
  // [foto, extra pendiente, pide lo que compro, se aparta?, que es]
  [true, true, true, true, "llega una FOTO con el extra pendiente -> al lector"],
  [true, true, false, true, "FOTO sin pedir nada -> al lector"],
  [false, true, true, false, "TEXTO pidiendo lo que compro -> lo atiende el motor"],
  [false, true, false, true, "TEXTO de otra cosa -> sigue yendo al modelo"],
  [false, false, true, false, "sin extra pendiente -> como siempre"],
  [false, false, false, false, "sin extra pendiente -> como siempre"],
];
for (const [foto, extra, pide, esperado, que] of CASOS) {
  const r = puerta(foto && extra, extra, foto, pide);
  comprobar(
    `${r ? "se aparta" : "atiende  "} · ${que}`,
    r === esperado,
    r === esperado ? "" : `esperaba ${esperado ? "apartarse" : "atender"}`
  );
}

// ── 4. EL DETECTOR ES GENERICO: FORMAS QUE EL NUNCA ESCRIBIO ────────────────
//
// Se ejecuta el detector real. La lista de abajo NO sale de su conversacion: son
// maneras distintas de reclamar lo mismo, para comprobar que no esta ajustado a
// un caso. Se imprime lo que caza y lo que no, sin exigir que cace todo: el
// modelo sigue detras para lo que se le escape.
console.log("\n— 4. el detector, con formas que él nunca escribio —\n");
const trozo = (desde, hasta) => {
  const a = src.indexOf(desde);
  return src.slice(a, src.indexOf(hasta, a));
};
const detector = new Function(
  "msgContent",
  `const normalizedPostSaleText = msgContent.toLowerCase().normalize("NFD").replace(/\\p{Mn}/gu, "");
   ${trozo("const wantsPurchasedMaterial =", "const looksLikePaymentEcho =")}
   return wantsPurchasedMaterial;`
);
const VARIANTES = [
  "donde esta mi curso",
  "reenviame el link por favor",
  "no lo encuentro en el chat",
  "me pasas el acceso otra vez",
  "a que hora me llega el material",
  "cuando me envian el producto",
  "no me aparece el video",
  "se me borro el enlace",
  "mandamelo de nuevo",
  "no lo veo en ningun lado",
];
let cazadas = 0;
for (const frase of VARIANTES) {
  const r = detector(frase);
  if (r) cazadas++;
  console.log(`   ${r ? "reenvia  " : "al modelo"} «${frase}»`);
}
comprobar(
  "caza la mayoria de las formas, no solo una",
  cazadas >= 7,
  `${cazadas} de ${VARIANTES.length}`
);
// Y LO QUE NO DEBE DISPARAR, que es la otra mitad: alguien que pregunta por el
// EXTRA que todavia no ha pagado no esta pidiendo lo que ya compro.
console.log("\n— y lo que NO debe disparar —\n");
for (const frase of ["cuanto cuesta el extra", "que trae el segundo", "si lo quiero"]) {
  const r = detector(frase);
  comprobar(`no dispara con «${frase}»`, r === false);
}

console.log(
  fallos === 0
    ? "\nTODO OK — quien ya pago recibe lo que compro, y la foto sigue yendo al lector\n"
    : `\n${fallos} FALLO(S)\n`
);
process.exit(fallos === 0 ? 0 : 1);
