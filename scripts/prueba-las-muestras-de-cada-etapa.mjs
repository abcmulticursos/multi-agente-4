// Una muestra de OTRA etapa ya no tumba las de esta.
//
// DE DONDE SALE
//
//   El cliente pregunta que trae, el bot le ofrece enseñarle las imagenes, el
//   cliente dice que si… y le contesta con palabras. Ninguna imagen.
//
//   La secuencia de muestras es «todo o nada» A PROPOSITO: enseñar 2 de las 3
//   opciones que se estan vendiendo es peor que no enseñar ninguna. Eso se
//   queda.
//
//   Lo que estaba mal es que «no le toca ahora» contaba como «falta». La muestra
//   del producto del UPSELL estaba marcada en la lista de la etapa de compra —y
//   el panel invita a marcarla—, pero en esa etapa el bot solo tiene delante las
//   galerias de lo que esta vendiendo: la del upsell se guarda para su momento.
//   No la encontraba, y no mandaba NINGUNA.
//
//   En su configuracion pasaba en TRES modalidades a la vez: lineal, order_bump
//   y doble_oferta_upsell.
//
// EL ARREGLO, QUE LO PROPUSO EL DUEÑO
//
//   «¿no era mejor activar los checks de todos y restringir en cada etapa?».
//   Si — y el bot YA lo hace con el segundo producto del Order Bump mientras
//   sigue oculto. Al upsell no se le habia hecho.
//
//   Ahora la que no toca ahora se aparta y salen las de esta etapa. Un tema que
//   no existe en NINGUNA galeria sigue parando la secuencia entera: ahi si falta
//   algo de verdad.
//
//   node scripts/prueba-las-muestras-de-cada-etapa.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

const RAIZ = process.cwd();
const cerebro = readFileSync(join(RAIZ, "src", "lib", "openrouter.ts"), "utf8");
const config = readFileSync(
  join(RAIZ, "src", "lib", "workflow", "config.ts"),
  "utf8"
);

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 62)} ${valor}`);
};

// ── 1. La regla, en el codigo ────────────────────────────────────────────────
comprobar(
  "se sabe que temas existen en CUALQUIER etapa",
  /export function temasDeMuestraDeCualquierEtapa\(\): Set<string> \{/.test(
    config
  ) && /seccionUpsell\(cfg\)\?\.image_gallery \?\? \[\]/.test(config),
  "para distinguir «no toca» de «no existe»"
);
comprobar(
  "una muestra de otra etapa NO para la secuencia",
  /const enBlanco = topics\.filter\(\s*\r?\n\s*\(topic\) => !existeEnAlgunaEtapa\.has\(topic\.trim\(\)\.toLowerCase\(\)\)\s*\r?\n\s*\);/.test(
    cerebro
  ),
  "solo cuenta lo que no existe"
);
// LO QUE NO SE TOCA: si falta de verdad, sigue sin mandar nada.
comprobar(
  "pero un tema inexistente sigue parándola entera",
  /if \(enBlanco\.length > 0 \|\| items\.length === 0\) \{/.test(cerebro),
  "eso sí es un error"
);
comprobar(
  "y queda escrito en el registro cuál falta",
  /no existe\(n\) en ninguna galería → no mando ninguna/.test(cerebro),
  "diagnosticable"
);
comprobar(
  "y también cuando se aparta una por no tocarle",
  /el resto es de otra etapa y todavía no le toca/.test(cerebro),
  "sin silencios"
);

// ── 2. Contra su configuracion REAL, modalidad por modalidad ─────────────────
//
// Es donde se ve si el arreglo sirve: sus tres modalidades rotas tienen que
// pasar a enviar, y las dos que ya funcionaban tienen que seguir igual.
const cfg = parse(readFileSync(join(RAIZ, "config", "intro-data.yaml"), "utf8"));
const MODOS = [
  "lineal",
  "order_bump",
  "bioferta",
  "doble_oferta_dos",
  "doble_oferta_upsell",
  "upsell",
];
const norm = (s) => String(s ?? "").trim().toLowerCase();
const temas = (g) => (g ?? []).map((i) => norm(i.topic)).filter(Boolean);

console.log("");
for (const modo of MODOS) {
  const t = cfg.modality_templates?.[modo];
  if (!t) continue;
  const pedidos = t.product_info_topics ?? cfg.product_info_topics ?? [];
  if (pedidos.length === 0) {
    console.log(`ok    ${pad(modo + ": no pide muestras", 62)} no aplica`);
    continue;
  }
  // Lo que el bot tiene delante en la ETAPA DE COMPRA.
  const deLaEtapa = new Set([
    ...temas(t.image_gallery),
    ...temas(t.image_gallery_2),
    ...temas(t.pack_gallery),
  ]);
  // Todo lo que existe, incluida la etapa del upsell.
  const deCualquierEtapa = new Set([
    ...deLaEtapa,
    ...temas(t.upsell?.image_gallery),
  ]);
  const enBlanco = pedidos.filter((p) => !deCualquierEtapa.has(norm(p)));
  const seEnvian = pedidos.filter((p) => deLaEtapa.has(norm(p)));
  const apartadas = pedidos.length - seEnvian.length - enBlanco.length;
  comprobar(
    `${modo}: envía las muestras de su etapa`,
    enBlanco.length === 0 && seEnvian.length > 0,
    enBlanco.length > 0
      ? `⛔ no existe: ${enBlanco.map((t2) => `"${t2}"`).join(", ")}`
      : `${seEnvian.length} de ${pedidos.length}${
          apartadas > 0 ? ` (${apartadas} del upsell, para su momento)` : ""
        }`
  );
}

// ── 3. Y la del upsell sigue saliendo en SU etapa ────────────────────────────
//
// Apartarla de la etapa de compra no puede apagarla: en cuanto se ofrece el
// upsell, la galeria disponible es la suya y de ahi sale.
comprobar(
  "\ny en la etapa del upsell la galería es la suya",
  /if \(enOferta\) \{\s*\r?\n\s*return normalizeGallery\(\s*\r?\n\s*seccionUpsell\(cfg\)\?\.image_gallery,/.test(
    config
  ),
  "no se apaga, se pospone"
);

console.log(
  fallos === 0
    ? "\nTODO OK — cada muestra sale en su etapa, y una de otra no tumba las de esta"
    : `\n${fallos} comprobacion(es) mal.`
);
process.exit(fallos === 0 ? 0 : 1);
