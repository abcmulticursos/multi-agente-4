// El cajon del upsell se duplica, y el duplicado sobrevive al refresco.
//
// LO QUE PASO — con las palabras del dueno:
//
//   «veo, duplico, me permitia cambiar contenido, salvar, tal como se hace en un
//    cajon duplicado de la seccion intro y la seccion seguimientos, incluso
//    guardar. Pero al refrescar pantalla, todo era una ilusion.»
//
//   Por eso se monto una libreta de versiones como rodeo. El commit que la creo
//   lo dice con todas las letras: «en vez de duplicar el cajon —que hoy no
//   sobrevive al guardado»—. Se vio el sintoma, se rodeo, y nunca se busco la
//   causa.
//
// LA CAUSA
//
//   El editor guarda una COPIA POR MODALIDAD (`modality_templates.<modo>`) y la
//   vuelve a aplicar encima al cargar. Y `applyTemplate` hace:
//
//       upsell: t.upsell ?? { ...UPSELL_VACIO }
//
//   Sustituye el OBJETO ENTERO. Las capas escritas antes de que la intro del
//   upsell pasara a cajones no tienen `intro_groups`, asi que cada carga borraba
//   los cajones recien guardados. Se veia real porque lo era: se guardaba en la
//   raiz y se restauraba desde una capa que no traia el campo.
//
//   En el archivo del dueno, dos de tres capas seguian sin el:
//
//       modality_templates.lineal.upsell               intro_groups AUSENTE
//       modality_templates.doble_oferta_upsell.upsell  intro_groups AUSENTE
//       modality_templates.order_bump.upsell           1 cajon
//
//   node scripts/prueba-el-cajon-del-upsell-se-duplica-de-verdad.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const editor = readFileSync(join(RAIZ, "src", "app", "editor", "page.tsx"), "utf8");
const config = readFileSync(
  join(RAIZ, "src", "lib", "workflow", "config.ts"),
  "utf8"
);
const motor = readFileSync(
  join(RAIZ, "src", "lib", "workflow", "engine.ts"),
  "utf8"
);

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 58)} ${valor}`);
};
const trozo = (fuente, desde, hasta) => {
  const i = fuente.indexOf(desde);
  if (i < 0) return "";
  const f = fuente.indexOf(hasta, i);
  return f < 0 ? fuente.slice(i) : fuente.slice(i, f);
};

// ── 1. LA CAUSA: LA CAPA VIEJA RECIBE SUS CAJONES ────────────────────────────
console.log("\n— la capa vieja se siembra con sus cajones —\n");
comprobar(
  "al cargar se rellena intro_groups si falta",
  /if \(capa\.upsell && capa\.upsell\.intro_groups === undefined\) \{/.test(
    editor
  ),
  "una sola vez, al abrir"
);
comprobar(
  "y desde la fuente de ESA modalidad, no de la de al lado",
  /const susCajones = suyo\?\.intro_groups;/.test(editor),
  "regla 5-bis: nada se presta"
);
comprobar(
  "la siembra de la capa entera sigue en pie",
  /if \(capa\.upsell === undefined\) \{/.test(editor),
  "lo de antes, intacto"
);
comprobar(
  "y `applyTemplate` sigue sustituyendo, como siempre",
  /upsell: t\.upsell \?\? \{ \.\.\.UPSELL_VACIO \}/.test(editor),
  "no se toca: por eso hay que sembrar"
);

// ── 2. EL CANDADO QUE ESCONDIA DUPLICAR ──────────────────────────────────────
console.log("\n— duplicar, peso y quitar ya no se esconden —\n");
const cajones = trozo(
  editor,
  "  // EL CAJÓN MANDA SIEMPRE, COMO EN INTRO Y EN SEGUIMIENTOS.",
  "/** El cuadrado de color con el icono dentro. */"
);
comprobar("se encuentra el componente", cajones.length > 0, "CajonesDeIntro");
comprobar(
  "el cajon manda siempre",
  /const grupos = gruposDelCajon;/.test(cajones) &&
    /const onGrupos = onGruposDelCajon;/.test(cajones),
  "sin sustitucion por la libreta"
);
comprobar(
  "no queda ni un candado escondiendo botones",
  !/laQueManda/.test(cajones),
  "ni Peso, ni Duplicar, ni Quitar"
);
// El nombre ya no sale de una plantilla fija: se PIDE al duplicar, con el de
// siempre ya escrito. Ver `prueba-al-duplicar-se-pide-el-nombre`. Lo que esta
// comprobacion protege no cambia: que la copia nazca APAGADA.
// El 30/09/2026 la accion se saco del boton a `duplicarCajon`, para que el boton
// nuevo de la FILA CERRADA y el de dentro hagan lo mismo. Lo que protege esta
// comprobacion no cambia: que la copia nazca APAGADA.
comprobar(
  "y Duplicar sigue naciendo apagado",
  /const nombre = nombreParaLaCopia\(grupos\[i\]\?\.name\);/.test(cajones) &&
    /name: nombre,\s*\r?\n[\s\S]{0,260}?enabled: false,/.test(cajones),
  "no entra al reparto sin estar listo"
);

// ── 3. LA LIBRETA PASA A SER UN ARCHIVADOR ───────────────────────────────────
console.log("\n— la libreta se queda, pero ya no manda —\n");
const selector = trozo(
  editor,
  "function SelectorDeVersiones({",
  "/** Un texto archivado del contenido de un cajón."
);
const selector2 = trozo(
  editor,
  "  const mias = biblioteca.filter",
  "/** El cuadrado de color con el icono dentro. */"
);
comprobar(
  "guardar ya no marca nada como activa",
  !/activa: true/.test(selector2.slice(0, 2000)),
  "archivar es inofensivo"
);
comprobar(
  "cargar trae un cajon MAS",
  /onCargarComoCajon\(suya\)/.test(selector2) &&
    /onCargarComoCajon: \(version: VersionDeIntro\) => void;/.test(editor),
  "no pisa los que ya hay"
);
comprobar(
  "y entra apagado, como la copia de Duplicar",
  /onCargarComoCajon=\{\(version\) =>[\s\S]{0,400}enabled: false,/.test(editor),
  "no se envia sin que el lo encienda"
);
comprobar(
  "Renombrar y Borrar siguen ahi",
  /Renombrar/.test(selector2) && /Borrar/.test(selector2),
  "el archivador sirve"
);
comprobar(
  "y dice lo que es",
  /Solo guarda y recupera textos\. Lo que se envía son los cajones de abajo\./.test(
    selector2
  ),
  "sin ambiguedad en pantalla"
);

// ── 4. LA MIGRACION NO CAMBIA LO QUE VE EL CLIENTE ───────────────────────────
console.log("\n— la version activa baja al cajon 1 —\n");
const migracion = trozo(
  editor,
  "      // LA LIBRETA VUELVE A SER UNA LIBRETA",
  "      const runtime = runtimeModality(loaded);"
);
comprobar("se encuentra la migracion", migracion.length > 0, "al cargar");
comprobar(
  "copia la activa al cajon 1, con la forma del motor",
  /name: v\.name \?\? "",\s*enabled: true,\s*weight: 1,/.test(migracion),
  "igual que aplicarVersionActiva"
);
comprobar(
  "en la oferta y en el upsell",
  /loaded\.order_bump = \{/.test(migracion) &&
    /loaded\.upsell = \{ \.\.\.loaded\.upsell, intro_groups: delUpsell \};/.test(
      migracion
    ),
  "las dos que tenian candado"
);
comprobar(
  "y la desmarca",
  /v\.activa === true \? \{ \.\.\.v, activa: false \} : v/.test(migracion),
  "para que manden los cajones"
);
comprobar(
  "una version vacia no baja nada",
  /v && \(v\.steps \?\? \[\]\)\.length > 0/.test(migracion),
  "no deja la oferta muda"
);
// Y LLEGA HASTA LA CAPA, QUE ES LO ULTIMO QUE HABLA.
//
// AQUI FALLO EL PRIMER INTENTO. Se escribia el cajon arriba y, un momento
// despues, `applyTemplate` ponia encima la capa de la modalidad —con
// `intro_groups` vacio— y lo mataba en el mismo viaje. El dueno lo vio: seguia
// saliendo un cajon sin nombre, sembrado del texto viejo. Es el MISMO fallo que
// esta migracion viene a arreglar, repetido un piso mas arriba.
comprobar(
  "y llega hasta la capa de la modalidad activa",
  /const capaActiva = loaded\.modality_templates\?\.\[laActiva\];/.test(
    migracion
  ) && /capaActiva\.upsell = \{/.test(migracion),
  "si no, applyTemplate la borraba"
);
comprobar(
  "solo la ACTIVA, no las de al lado",
  /const laActiva = activeModality\(loaded\);/.test(migracion),
  "nada que no fuera suyo"
);
comprobar(
  "y tambien en la caja propia de -DOU-",
  /loaded\.doble_oferta_upsell\.upsell,\s*intro_groups: delUpsell,/.test(
    migracion
  ),
  "esa modalidad lee la suya"
);
comprobar(
  "la libreta NO se borra",
  !/biblioteca_de_intros = \[\]/.test(migracion) &&
    /biblioteca_de_intros\.map/.test(migracion),
  "se queda como archivador"
);
comprobar(
  "y el motor sigue respetando una activa mientras no guarde",
  /export function aplicarVersionActiva\(/.test(config) &&
    /v\.activa === true/.test(config),
  "entre abrir y guardar, nada cambia"
);

// ── 5. EL MOTOR YA SABIA REPARTIR ENTRE CAJONES ──────────────────────────────
console.log("\n— y el motor ya sorteaba, desde antes —\n");
// ACTUALIZADA el 24/09/2026 conservando su intencion. Fijaba la forma EXACTA de
// la llamada; se le añadio un tercer argumento —el pais, para que la bandera
// pueda dirigir— y la forma cambio. Lo que protege sigue igual: que la intro del
// upsell salga de SUS cajones y caiga a la de siempre.
comprobar(
  "la intro del upsell sale de sus cajones, por peso",
  /sorteaCajonDeIntro\(\s*up\.intro_groups,\s*convo\.id[\s\S]{0,120}?\)\s*\?\?\s*up\.intro\s*\?\?\s*\[\]/.test(
    motor
  ),
  "no hacia falta tocar el motor"
);
comprobar(
  "y los cuadritos valen en todos los cajones",
  /\.\.\.\(up\.intro_groups \?\? \[\]\)\.flatMap\(\(g\) => g\.steps \?\? \[\]\)/.test(
    motor
  ),
  "un boton de otro cajon se reconoce"
);

console.log(
  fallos === 0
    ? "\nTODO OK — el cajon del upsell se duplica y sobrevive"
    : `\n${fallos} comprobacion(es) mal.`
);
process.exit(fallos === 0 ? 0 : 1);
