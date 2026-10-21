// El aviso de «esto quedaría vacío» solo salta cuando algo se PIERDE de verdad.
//
// QUE PASABA
//
//   Al pasar a vender una modalidad que no tiene cierto campo —Lineal no tiene
//   «Producto 2»— ese campo se vacia ARRIBA a proposito: arriba esta la
//   PROYECCION de lo que vende el bot, y el contenido de verdad vive en la capa
//   de cada modalidad. El aviso comparaba solo arriba, asi que gritaba
//   «CUIDADO: esto quedaria VACIO: Nombre del producto 2...» cada vez que se
//   cambiaba de modalidad, aunque el contenido estuviera entero en su capa.
//
//   Un aviso que siempre es mentira acaba ignorandose. Y el dia que sea verdad,
//   tambien.
//
// COMO QUEDA
//
//   Antes de avisar se mira si eso sigue guardado en alguna capa, pesando igual
//   o mas. Si esta, es una proyeccion, no una perdida, y no se avisa. Si no
//   esta en ninguna, el aviso salta igual que siempre.
//
//   node scripts/prueba-el-aviso-de-vaciado-no-miente.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const RAIZ = process.cwd();
const YAML = createRequire(join(RAIZ, "package.json"))("yaml");
const ruta = readFileSync(join(RAIZ, "src", "app", "api", "workflow", "route.ts"), "utf8");
const cfg = YAML.parse(
  readFileSync(join(RAIZ, "config", "intro-data.yaml"), "utf8")
);

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};

// ── 1. La regla esta escrita ─────────────────────────────────────────────────
comprobar(
  "antes de avisar se mira si sigue guardado en su capa",
  /const capa = sigueGuardadoEnSuCapa\(clave, peso, antes, despues\);\s*\r?\n\s*if \(capa\) \{[\s\S]{0,300}?continue;/.test(
    ruta
  ),
  "proyeccion no es perdida"
);
// SU capa, no «alguna». Cualquier modalidad con un nombre puesto en ese campo
// callaria la perdida del de otra, que no tiene nada que ver.
comprobar(
  "se mira la capa de quien lo tenia, no una cualquiera",
  /const duenna = modalidadQueVende\(antes\);/.test(ruta) &&
    /const capa = capas\[duenna\];/.test(ruta),
  "la modalidad que vendia antes"
);
comprobar(
  "y esa capa tiene que pesar IGUAL O MAS",
  /pesoDeContenido\(guardado\) >= peso \? duenna : null/.test(ruta),
  "un resto no calla una perdida"
);
// La escalera tiene que ser la MISMA del motor. Si se desincroniza, se miraria
// la capa equivocada y el aviso volveria a mentir — en la otra direccion.
comprobar(
  "la escalera es la misma del motor",
  /if \(encendida\("doble_oferta_upsell"\)\) return "doble_oferta_upsell";/.test(
    ruta
  ) &&
    /typeof modalidadUpsell === "boolean" \? modalidadUpsell : encendida\("upsell"\)/.test(
      ruta
    ) &&
    /if \(encendida\("bioferta_doble"\)\) return "bioferta";/.test(ruta),
  "mismo orden, mismas claves"
);
comprobar(
  "las claves que se llaman distinto estan mapeadas",
  /followup_sequences: "followups"/.test(ruta) &&
    /payment_approved_sequence: "payment_approved"/.test(ruta) &&
    /gift_mechanic: "gift"/.test(ruta) &&
    /bioferta_doble: "bioferta"/.test(ruta),
  "4 alias"
);

// ── 2. Y se comporta bien CON EL CONTENIDO REAL ──────────────────────────────
//
// Se reproduce la regla con el archivo de verdad: es la unica forma de saber si
// el aviso que salio en pantalla era una falsa alarma o no.
const ALIAS = {
  followup_sequences: "followups",
  payment_approved_sequence: "payment_approved",
  gift_mechanic: "gift",
  bioferta_doble: "bioferta",
};
const peso = (v, nivel = 0) => {
  if (v == null || nivel > 6) return 0;
  if (typeof v === "string") return v.trim() ? 1 : 0;
  if (typeof v === "number") return v !== 0 ? 1 : 0;
  if (typeof v === "boolean") return 0;
  if (Array.isArray(v)) return v.reduce((s, x) => s + peso(x, nivel + 1), 0);
  if (typeof v === "object")
    return Object.values(v).reduce((s, x) => s + peso(x, nivel + 1), 0);
  return 0;
};
const vende = (doc) => {
  const on = (k) => !!(doc[k] && typeof doc[k] === "object" && doc[k].enabled === true);
  if (on("doble_oferta_upsell")) return "doble_oferta_upsell";
  const m = doc.upsell_modalidad_enabled;
  if (typeof m === "boolean" ? m : on("upsell")) return "upsell";
  if (on("doble_oferta_dos")) return "doble_oferta_dos";
  if (on("order_bump")) return "order_bump";
  if (on("bioferta_doble")) return "bioferta";
  return "lineal";
};
const enSuCapa = (clave, cuanto, antes, despues) => {
  const duenna = vende(antes);
  // Solo cuando el guardado CAMBIA la modalidad que vende. Sin cambio no hay
  // proyeccion que explique el vaciado, y eso hay que avisarlo.
  if (duenna === vende(despues)) return null;
  const capa = (despues.modality_templates ?? {})[duenna];
  if (!capa || typeof capa !== "object") return null;
  return peso(capa[ALIAS[clave] ?? clave]) >= cuanto ? duenna : null;
};

// EL CASO REAL: vendiendo Doble Oferta + Upsell se pasa a vender Lineal.
// Lineal no tiene «Producto 2», asi que los tres campos se vacian arriba.
//
// El escenario se ARMA, no se toma del archivo tal cual: el archivo cambia de
// modalidad segun lo que este vendiendo el dueño ese dia, y la prueba tiene que
// medir siempre lo mismo. Se parte de sus capas de verdad —eso si es contenido
// real— y se fijan a mano las dos puntas del cambio.
// CON CONTENIDO DE VERDAD, O LA PRUEBA NO MIDE NADA.
//
// AQUI ESTABA EL ROJO QUE NO ERA DE NADIE.
//
// Los valores se tomaban de la capa real. El dia que esa modalidad esta vacia
// —que es lo normal si hoy se vende otra cosa— los tres campos valen cero, y
// entonces «no se perdio nada» y «se perdio todo» pesan lo mismo: la
// comprobacion de que el aviso SIGUE VIVO se ponia roja sin que nadie hubiera
// roto nada.
//
// Una prueba que se pone roja porque el dueÃ±o cambio de producto se deja de
// mirar, y ese dia tampoco avisa de lo que si importa.
//
// Ahora: si su capa tiene contenido, se usa el suyo, que es lo valioso. Si esta
// vacia, se usa una muestra inventada. Lo que se mide es LA REGLA, y la regla
// tiene que poder medirse siempre.
const capasReales = cfg.modality_templates ?? {};
const capaDOU = capasReales.doble_oferta_upsell ?? {};
const MUESTRAS = {
  product_name_2: "Producto de prueba",
  course_content_2: "Contenido de prueba",
  image_gallery_2: [{ topic: "prueba", drive_url: "https://ejemplo", caption: "x" }],
  // DOS PASOS, NO UNO, A PROPOSITO. Mas abajo se comprueba que un RESTO no
  // calla una perdida grande: se recorta el contenido a su primer paso y tiene
  // que seguir avisando. Con un solo paso, el recorte es el original entero y
  // esa comprobacion no mide nada.
  intro_sequence: [
    { type: "text", texts: ["Hola, esto es una prueba."] },
    { type: "text", texts: ["Y este es el segundo paso."] },
  ],
};
const conAlgo = (clave) =>
  peso(capaDOU[clave]) > 0 ? capaDOU[clave] : MUESTRAS[clave];
const inventado = Object.keys(MUESTRAS).filter((k) => peso(capaDOU[k]) === 0);
if (inventado.length > 0) {
  console.log(
    `     (su capa no tiene ${inventado.join(", ")}: se usa una muestra para medir la regla)`
  );
}
// La capa de la que se mide es la MISMA de la que salen los valores: si no, el
// contenido estaria en un sitio y se buscaria en otro.
const capaMedida = {
  ...capaDOU,
  product_name_2: conAlgo("product_name_2"),
  course_content_2: conAlgo("course_content_2"),
  image_gallery_2: conAlgo("image_gallery_2"),
  intro_sequence: conAlgo("intro_sequence"),
};
const capasMedidas = { ...capasReales, doble_oferta_upsell: capaMedida };
const antesDOU = {
  doble_oferta_upsell: { enabled: true },
  product_name_2: capaMedida.product_name_2,
  course_content_2: capaMedida.course_content_2,
  image_gallery_2: capaMedida.image_gallery_2,
  intro_sequence: capaMedida.intro_sequence,
  modality_templates: capasMedidas,
};
// Pasa a vender Lineal: los tres se vacian arriba, las capas no se tocan.
const despuesLineal = {
  doble_oferta_upsell: { enabled: false },
  product_name_2: "",
  course_content_2: "",
  image_gallery_2: [],
  modality_templates: capasMedidas,
};
console.log(
  `     (antes vendia: ${vende(antesDOU)} → pasa a: ${vende(despuesLineal)})`
);
for (const clave of ["product_name_2", "course_content_2", "image_gallery_2"]) {
  const cuanto = peso(antesDOU[clave]);
  const donde = enSuCapa(clave, cuanto, antesDOU, despuesLineal);
  comprobar(
    `«${clave}» sigue guardado en su capa`,
    !!donde,
    donde ? `capa «${donde}» (peso ${cuanto})` : "EN NINGUNA — SE PERDERIA"
  );
}

// ── 3. Pero una perdida de verdad sigue avisando ─────────────────────────────
//
// Sin esto la regla podria estar callandolo TODO, que es peor que el aviso
// molesto: seria un seguro desconectado que parece puesto.
//
// Se simula lo que de verdad hay que atrapar: la capa de quien lo tenia
// aparece VACIA. Ahi ya no hay donde volver a buscarlo, y tiene que avisar.
const capasVaciadas = {
  ...despuesLineal,
  modality_templates: { ...capasReales, doble_oferta_upsell: {} },
};
for (const clave of ["product_name_2", "course_content_2", "image_gallery_2"]) {
  comprobar(
    `«${clave}» SI se avisa si su capa se vacio`,
    enSuCapa(clave, peso(antesDOU[clave]), antesDOU, capasVaciadas) === null,
    "el aviso sigue vivo"
  );
}
// Y un resto no puede callar una perdida grande: se deja en la capa una version
// recortada del contenido y tiene que seguir avisando.
const claveGrande = "intro_sequence";
const pesoGrande = peso(antesDOU[claveGrande] ?? []);
const capaRecortada = {
  ...despuesLineal,
  [claveGrande]: [],
  modality_templates: {
    ...capasReales,
    doble_oferta_upsell: {
      [claveGrande]: (antesDOU[claveGrande] ?? []).slice(0, 1),
    },
  },
};
comprobar(
  "un contenido grande no se calla con un resto",
  pesoGrande === 0 ||
    enSuCapa(claveGrande, pesoGrande, antesDOU, capaRecortada) === null,
  `pide peso >= ${pesoGrande}`
);
// Y si NO cambia la modalidad que vende, tampoco se calla: «arriba vacio y capa
// llena» sin cambio de modalidad no lo explica ninguna proyeccion — es la forma
// del desastre que este seguro existe para atrapar.
comprobar(
  "sin cambio de modalidad no se calla nada",
  enSuCapa(
    "product_name_2",
    peso(antesDOU.product_name_2),
    antesDOU,
    { ...despuesLineal, doble_oferta_upsell: { enabled: true } }
  ) === null,
  "sigue vendiendo la misma"
);

console.log(
  fallos === 0
    ? "\nTODO OK — el aviso solo salta cuando algo se pierde de verdad"
    : `\n${fallos} comprobacion(es) mal.`
);
process.exit(fallos === 0 ? 0 : 1);
