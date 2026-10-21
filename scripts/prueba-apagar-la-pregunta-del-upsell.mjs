// Apagar la pregunta del final no la apagaba.
//
// La pregunta del upsell se escribe en burbujas, y si no hay ninguna se cae al
// campo de texto de siempre — el respaldo, pensado para configuraciones que
// nadie ha tocado todavia.
//
// Pero ese respaldo tambien se usaba cuando SI habia burbujas y estaban TODAS
// apagadas. O sea: apagabas la burbuja y la pregunta salia igual, con el texto
// viejo. El interruptor no servia para nada.
//
// Ahora se distinguen los dos casos:
//
//   sin burbujas            → se usa el texto de respaldo  (como siempre)
//   burbujas, TODAS apagadas → no se manda nada            (alguien la apago)
//   la ultima no es texto    → texto de respaldo           (ya documentado)
//
// La oferta NO se cierra por eso: el segundo producto se sigue presentando y se
// puede aceptar por su nombre o por el marcador del modelo. Lo unico que
// desaparece es la pregunta del final.
//
//   node scripts/prueba-apagar-la-pregunta-del-upsell.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const leer = (...p) => readFileSync(join(RAIZ, ...p), "utf8");

const engine = leer("src", "lib", "workflow", "engine.ts");
const editor = leer("src", "app", "editor", "page.tsx");

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 60)} ${valor}`);
};

comprobar(
  // Sin esta distinción, apagar la burbuja no apaga nada.
  "se distingue «apagada» de «todavía sin llenar»",
  /const apagadaAProposito =\s*\r?\n\s*todasLasDePregunta\.length > 0 && burbujasDePregunta\.length === 0;/.test(
    engine
  ),
  "sí"
);
comprobar(
  "apagada, no se manda la pregunta",
  /const preguntaCruda = apagadaAProposito\s*\r?\n\s*\? ""/.test(engine),
  "vacía"
);
comprobar(
  // Es lo único que hacía falta para que el interruptor sirviera: sin texto no
  // salen ni los botones ni la burbuja.
  "y sin texto no sale ni burbuja ni botones",
  /if \(!mandada && pregunta\.trim\(\)\) \{/.test(engine),
  "nada"
);
comprobar(
  "queda escrito en el registro",
  /la pregunta del final está apagada, no la mando/.test(engine),
  "sí"
);
comprobar(
  // Quien nunca tocó las burbujas tiene que seguir viendo su pregunta de
  // siempre. Si esto se rompe, se quedan todos sin pregunta de golpe.
  "sin burbujas, el texto de respaldo sigue saliendo",
  /: textoDeLaUltima\.trim\(\) \|\|\s*\r?\n\s*pickVariant\(up\.pregunta_variants, up\.pregunta\) \|\|/.test(
    engine
  ),
  "intacto"
);
comprobar(
  // La oferta sigue en pie: solo desaparece la pregunta.
  "la oferta se sigue marcando como ofrecida",
  /setUpsellState\(convo\.id, "ofrecido"\);/.test(engine),
  "abierta"
);
comprobar(
  // La intro del extra pasó a ser CAJONES, con su nombre, su interruptor y su
  // peso. Se sortea uno por conversación y, sin cajones, sale la de siempre.
  // ACTUALIZADA el 24/09/2026: la llamada gano un tercer argumento —el pais del
  // cliente, para que la bandera pueda dirigir—. Lo que protege no cambia: que
  // la intro del extra se sortee entre sus cajones, caiga a la de siempre y sus
  // burbujas se recorran enteras.
  "y las burbujas de la intro del extra siguen saliendo",
  /const introDelUpsell =\s*[\s\S]{0,140}?sorteaCajonDeIntro\(\s*up\.intro_groups,\s*convo\.id[\s\S]{0,120}?\)\s*\?\?\s*up\.intro\s*\?\?\s*\[\];/.test(
    engine
  ) && /for \(const step of introDelUpsell\) \{/.test(engine),
  "intacto"
);

// ── El editor lo dice ───────────────────────────────────────────────────────
comprobar(
  // Sin aviso, apagarla y no ver nada parece que el interruptor sigue roto.
  "el editor avisa cuando está apagada",
  /La pregunta del final está <strong>apagada<\/strong>/.test(editor),
  "sí"
);
comprobar(
  "y aclara que la oferta sigue abierta",
  /La oferta queda abierta igual/.test(editor),
  "lo dice"
);

console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} comprobación(es) mal.`);
process.exit(fallos === 0 ? 0 : 1);
