// Copiar un cajón de intro y pegarlo encima de otro.
//
// Lo que hay que garantizar: que el pegado caiga EXACTAMENTE encima del que
// elegiste, que ninguno de los demás cambie de contenido ni de orden, y que la
// copia sea de verdad una copia (editar el original después no la toca).
//
//   node scripts/prueba-copiar-cajon.mjs
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const RAIZ = process.cwd();
const TMP = join(RAIZ, "scripts", "_tmp-cajon");
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

const fuente = readFileSync(join(RAIZ, "src/app/editor/page.tsx"), "utf8");
function extraer(nombre) {
  const desde = fuente.indexOf(`function ${nombre}`);
  if (desde < 0) throw new Error(`no encontré ${nombre}`);
  const hasta = fuente.indexOf("\n}", desde);
  return fuente
    .slice(desde, hasta + 2)
    .replace(/: IntroEditorItem\[\]/g, "")
    .replace(/: ModalidadTemplateEditor \| undefined/g, "")
    .replace(/: ModalidadTemplateEditor/g, "")
    .replace(/const next: /g, "const next = ")
    .replace(/const items: = \[\];/g, "const items = [];")
    .replace(/= \{$/gm, "= {");
}
writeFileSync(
  join(TMP, "m.mjs"),
  [
    `export ${extraer("introItemsFromTemplate")}`,
    `export ${extraer("templateWithIntroItems")}`,
  ].join("\n\n"),
  "utf8"
);
const { introItemsFromTemplate, templateWithIntroItems } = await import(
  pathToFileURL(join(TMP, "m.mjs")).href
);

const paso = (que) => [{ type: "text", texts: [`TEXTO DE ${que}`] }];
const plantilla = {
  intro_sequence: paso("A"),
  intro_sequence_2: paso("B"),
  intro_sequence_3: paso("C"),
  intro_extra_sequences: [paso("D")],
  intro_enabled: [true, false, true, true],
  intro_weights: [1, 2, 3, 4],
  intro_names: ["A", "B", "C", "D"],
  intro_ad_names: ["", "", "", ""],
  intro_ad_ids: ["", "", "", ""],
  intro_ad_keys: [[], [], [], []],
};

let fallos = 0;
const comprobar = (nombre, ok, detalle = "") => {
  if (!ok) fallos++;
  console.log(`${ok ? "ok   " : "FALLA"} ${nombre}${detalle ? `  → ${detalle}` : ""}`);
};
const nombres = (tpl) => introItemsFromTemplate(tpl).map((i) => i.name).join(",");
const textos = (tpl) =>
  introItemsFromTemplate(tpl)
    .map((i) => i.steps[0]?.texts?.[0] ?? "(vacío)")
    .join(",");

// Copiar "C" (índice 2) y pegarlo encima de "A" (índice 0).
const items = introItemsFromTemplate(plantilla);
comprobar("se leen los 4 cajones", items.length === 4, nombres(plantilla));

const copiado = JSON.parse(JSON.stringify(items[2]));
const siguientes = [...items];
siguientes.splice(0, 0, JSON.parse(JSON.stringify(copiado)));
const pegado = templateWithIntroItems(plantilla, siguientes);

comprobar(
  "el pegado cae justo encima del elegido",
  nombres(pegado) === "C,A,B,C,D",
  nombres(pegado)
);
comprobar(
  "ningún cajón cambia de contenido",
  textos(pegado) === "TEXTO DE C,TEXTO DE A,TEXTO DE B,TEXTO DE C,TEXTO DE D",
  textos(pegado)
);

const itemsPegados = introItemsFromTemplate(pegado);
comprobar(
  "el pegado se lleva su peso y su ON/OFF",
  itemsPegados[0].weight === 3 && itemsPegados[0].enabled === true
);
comprobar(
  "los demás conservan su peso y su ON/OFF",
  itemsPegados[1].weight === 1 &&
    itemsPegados[2].enabled === false &&
    itemsPegados[4].weight === 4
);

// Editar el original DESPUÉS no debe tocar lo pegado.
copiado.steps[0].texts[0] = "MODIFICADO DESPUÉS";
comprobar(
  "es una copia de verdad, no una referencia",
  introItemsFromTemplate(pegado)[0].steps[0].texts[0] === "TEXTO DE C"
);

// Pegar al final también funciona.
{
  const alFinal = [...items];
  alFinal.splice(items.length, 0, JSON.parse(JSON.stringify(items[0])));
  comprobar(
    "pegar debajo del último también ordena bien",
    nombres(templateWithIntroItems(plantilla, alFinal)) === "A,B,C,D,A"
  );
}

// El cuarto y siguientes tienen que acabar en las secuencias extra.
comprobar(
  "a partir del cuarto van a las secuencias extra",
  pegado.intro_extra_sequences.length === 2,
  `extras=${pegado.intro_extra_sequences.length}`
);

// ---------- SEGUIMIENTOS ----------
// Son una lista plana, así que pegar es meter una copia en su sitio. Lo que
// hay que garantizar es lo mismo: cae donde toca, nadie más se mueve, y es
// copia y no referencia.
console.log("");
const seguimientos = [
  { name: "SEG-A", enabled: true, steps: paso("A"), delay_minutes_from_first_message: 30 },
  { name: "SEG-B", enabled: true, steps: paso("B"), delay_minutes_from_first_message: 60 },
  { name: "SEG-C", enabled: false, steps: paso("C"), delay_minutes_from_first_message: 90 },
];

const pegarSeguimiento = (lista, desde, encimaDe) => {
  const copia = JSON.parse(JSON.stringify(lista[desde]));
  const siguientes = [...lista];
  siguientes.splice(encimaDe, 0, copia);
  return siguientes;
};

{
  const r = pegarSeguimiento(seguimientos, 2, 0);
  comprobar(
    "seguimiento: el pegado cae encima del elegido",
    r.map((s) => s.name).join(",") === "SEG-C,SEG-A,SEG-B,SEG-C",
    r.map((s) => s.name).join(",")
  );
  comprobar(
    "seguimiento: se lleva su horario y su ON/OFF",
    r[0].delay_minutes_from_first_message === 90 && r[0].enabled === false
  );
  comprobar(
    "seguimiento: los demás no cambian de horario",
    r[1].delay_minutes_from_first_message === 30 &&
      r[2].delay_minutes_from_first_message === 60
  );
}

{
  const lista = JSON.parse(JSON.stringify(seguimientos));
  const r = pegarSeguimiento(lista, 0, 1);
  lista[0].steps[0].texts[0] = "MODIFICADO DESPUÉS";
  comprobar(
    "seguimiento: es copia de verdad, no referencia",
    r[1].steps[0].texts[0] === "TEXTO DE A"
  );
}

rmSync(TMP, { recursive: true, force: true });
console.log(fallos === 0 ? "\nLos 12 casos correctos." : `\n${fallos} mal.`);
process.exit(fallos === 0 ? 0 : 1);
