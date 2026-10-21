// Lo que se escribe en Canales -> Upsell y Canales -> Order Bump SALE del
// navegador. Antes no salia, y nadie se enteraba.
//
// LO QUE PASO — con las palabras del dueno:
//
//   «veo, duplico, me permitia cambiar contenido, salvar, tal como se hace en un
//    cajon duplicado de la seccion intro y la seccion seguimientos, incluso
//    guardar. Pero al refrescar pantalla, todo era una ilusion.»
//
//   Y lo mismo en los cajones de la oferta de la modalidad Order Bump.
//
// LA CAUSA, Y ES DE LAS QUE NO DAN ERROR NUNCA
//
//   `cleanChannelContent` arma un objeto NUEVO enumerando campo por campo lo que
//   se manda a guardar. Enumeraba SEIS: intro, seguimientos, pago, entrega, los
//   cajones de entrega y la postventa. Los cajones de la oferta y los del
//   upsell no estaban en la lista, asi que se caian ANTES de salir del
//   navegador. El guardado respondia que si; el archivo nunca los veia.
//
//   Por eso duplicar funcionaba en Intro y en Seguimientos y no en los otros
//   dos: no era otra mecanica, es que esos campos no viajaban. En el archivo del
//   dueno se ve exacto:
//
//       channels.whatsapp…intro_groups             = 6
//       channels.whatsapp…upsell_intro_groups      = 0
//       channels.whatsapp…order_bump_intro_groups  = 0
//
// ESTA PRUEBA EJECUTA EL VIAJE ENTERO, con el codigo real del editor y de la
// API: duplicar -> limpiar -> escribir -> leer -> volver a pintar.
//
//   node scripts/prueba-el-canal-guarda-su-oferta-y-su-upsell.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
const editor = readFileSync(join(RAIZ, "src", "app", "editor", "page.tsx"), "utf8");
const api = readFileSync(
  join(RAIZ, "src", "app", "api", "workflow", "route.ts"),
  "utf8"
);

let fallos = 0;
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
const comprobar = (texto, condicion, valor) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? "ok   " : "FALLA"} ${pad(texto, 56)} ${valor}`);
};

const trozo = (fuente, desde, hasta) => {
  const i = fuente.indexOf(desde);
  if (i < 0) throw new Error(`no encuentro: ${desde}`);
  const f = fuente.indexOf(hasta, i);
  return fuente.slice(i, f < 0 ? undefined : f + hasta.length);
};
const sinTipos = (s) =>
  s
    .replace(/ as Record<[^>]*>\[\]/g, "")
    .replace(/ as Record<[^>]*>/g, "")
    .replace(/ as EditorStep\[\]/g, "")
    .replace(/: ChannelContentEditor \| undefined/g, "")
    .replace(/: ChannelContentEditor/g, "")
    .replace(/: GrupoDeIntroEditor\[\] \| undefined/g, "")
    .replace(/: EditorStep\[\] \| undefined/g, "")
    .replace(/: GrupoDeIntroEditor\[\]/g, "")
    .replace(/: EditorStep\[\]/g, "")
    .replace(/: unknown/g, "")
    .replace(/: string\[\]/g, "")
    .replace(/: string/g, "")
    .replace(/: number/g, "")
    .replace(/: boolean/g, "");

const cuerpoDesde = (fuente, nombre, marcador) => {
  const i = fuente.indexOf(`function ${nombre}(`);
  const j = fuente.indexOf(marcador, i);
  const f = fuente.indexOf("\n}", j);
  return `function ${nombre}(value) {\n${sinTipos(fuente.slice(j, f))}\n}`;
};

const piezas = [
  sinTipos(trozo(editor, "function emptyChannelContent()", "\n}")),
  sinTipos(trozo(editor, "function normalizeChannelContent(", "\n}")),
  sinTipos(trozo(editor, "function cajonesSembrados(", "\n}")),
  // Esta vive dentro del componente, asi que cierra con dos espacios.
  sinTipos(trozo(editor, "function cleanChannelContent(", "\n  }")),
  cuerpoDesde(api, "readGruposDeIntro", "  if (!Array.isArray(value)) return [];"),
  cuerpoDesde(api, "writeGruposDeIntro", "  if (!Array.isArray(value)) return [];"),
].join("\n\n");

const preludio = `
  const emptyStep = () => ({ type: "text", texts: [""], delay_after_sec: 6 });
  const cloneJson = (x) => JSON.parse(JSON.stringify(x));
  const str = (x) => (typeof x === "string" ? x : "");
  // Igual que en la ruta: los cajones llevan banderas desde el 24/09 y sin
  // esta ayudante el banco se cae antes de medir nada.
  const strList = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
  const num = (x, d) => (typeof x === "number" && Number.isFinite(x) ? x : d);
  const readStep = (s) => s;
  const writeStep = (s) => s;
  const cleanStep = (s) => s;
  // La TERCERA etiqueta (30/09/2026): los cajones la llevan y la ruta la nombra.
  const leeSemimodalidad = (v) => {
    const s = String(v ?? "").trim().toLowerCase();
    return s === "lineal" || s === "dou" || s === "ob" ? s : "";
  };
`;
const correr = (cuerpo) => new Function(`${preludio}\n${piezas}\n${cuerpo}`)();

// ── EL VIAJE ENTERO, PARA LOS DOS CAMPOS ─────────────────────────────────────
//
// Se parte de un canal SIN nada escrito —que es como estaba el suyo— y de una
// modalidad con su intro de siempre, que es lo que se siembra en pantalla.
const viaje = (campo) =>
  correr(`
    const campo = ${JSON.stringify(campo)};
    const delCanal = { intro_groups: [], followups: [], payment: [], delivery: [] };
    const deLaModalidad = {
      intro_groups: [],
      intro: [{ type: "text", texts: ["lo de siempre"], delay_after_sec: 6 }],
    };
    const traza = [];

    // 1. Al abrir, la pantalla siembra un cajon con lo de la modalidad.
    const enPantalla = cajonesSembrados(
      delCanal[campo], deLaModalidad.intro_groups, deLaModalidad.intro
    );
    traza.push(["1. al abrir, en pantalla", enPantalla.length]);

    // 2. Pulsa Duplicar.
    const trasDuplicar = [
      enPantalla[0],
      { ...cloneJson(enPantalla[0]), name: "copia", enabled: false },
    ];
    traza.push(["2. tras pulsar Duplicar", trasDuplicar.length]);

    // 3. El editor lo mete en su estado.
    const enElEstado = normalizeChannelContent({ ...delCanal, [campo]: trasDuplicar });
    traza.push(["3. en el estado del editor", (enElEstado[campo] ?? []).length]);

    // 4. AQUI SE PERDIA: lo que se manda a guardar.
    const loQueSeManda = cleanChannelContent(enElEstado);
    traza.push(["4. en el cuerpo que se envia", (loQueSeManda[campo] ?? []).length]);

    // 5. La API lo escribe en el archivo.
    const enElArchivo = writeGruposDeIntro(loQueSeManda[campo]);
    traza.push(["5. escrito en el archivo", enElArchivo.length]);

    // 6. Y lo vuelve a leer.
    const leido = readGruposDeIntro(enElArchivo);
    traza.push(["6. leido del archivo", leido.length]);

    // 7. Y se pinta otra vez.
    const otraVez = cajonesSembrados(leido, deLaModalidad.intro_groups, deLaModalidad.intro);
    traza.push(["7. al refrescar, en pantalla", otraVez.length]);
    return traza;
  `);

for (const campo of ["upsell_intro_groups", "order_bump_intro_groups"]) {
  console.log(`\n— el viaje del duplicado: ${campo} —\n`);
  const traza = viaje(campo);
  for (const [paso, cuantos] of traza) {
    console.log(`     ${pad(paso, 34)} ${cuantos} cajon(es)`);
  }
  console.log("");
  comprobar(
    `${campo}: el duplicado llega al cuerpo que se envia`,
    traza[3][1] === 2,
    "aqui se perdia"
  );
  comprobar(
    `${campo}: y sobrevive al refresco`,
    traza[6][1] === 2,
    "de punta a punta"
  );
}

// ── Y QUE INTRO Y SEGUIMIENTOS SIGAN IGUAL ───────────────────────────────────
console.log("\n— y lo que ya funcionaba, intacto —\n");
const limpia = trozo(editor, "function cleanChannelContent(", "\n  }");
for (const campo of [
  "intro_groups",
  "followups",
  "payment",
  "delivery",
  "delivery_groups",
  "post_sale",
]) {
  comprobar(
    `sigue enviando «${campo}»`,
    new RegExp(`\\b${campo}:`).test(limpia),
    "como antes"
  );
}

// ── LOS OPCIONALES SOLO SI EXISTEN ───────────────────────────────────────────
//
// En un canal, la clave AUSENTE significa «manda la modalidad». Escribir un
// `false` o un `""` de relleno apagaria botones que ese canal nunca toco.
console.log("\n— y los interruptores del canal no se inventan —\n");
for (const campo of [
  "order_bump_use_buttons",
  "upsell_use_buttons",
  "order_bump_choice_prompt",
  "upsell_boton_si",
  "upsell_boton_no",
  "upsell_respuesta_rechazo",
]) {
  comprobar(
    `«${campo}» va solo si el canal opinó`,
    new RegExp(`\\? \\{ ${campo}:`).test(limpia),
    "ausente = manda la modalidad"
  );
}
comprobar(
  "y la pregunta del final del upsell también viaja",
  /upsell_pregunta_steps: \(content\.upsell_pregunta_steps \?\? \[\]\)\.map\(cleanStep\)/.test(
    limpia
  ),
  "con sus burbujas limpias"
);

// ── LA API YA SABIA GUARDARLOS ───────────────────────────────────────────────
console.log("\n— del otro lado ya estaba todo —\n");
comprobar(
  "la API escribe los dos campos",
  /order_bump_intro_groups: writeGruposDeIntro\(/.test(api) &&
    /upsell_intro_groups: writeGruposDeIntro\(content\?\.upsell_intro_groups\)/.test(
      api
    ),
  "no hubo que tocarla"
);
comprobar(
  "y los vuelve a leer",
  /order_bump_intro_groups: readGruposDeIntro\(/.test(api) &&
    /upsell_intro_groups: readGruposDeIntro\(/.test(api),
  "el archivo nunca fue el problema"
);

console.log(
  fallos === 0
    ? "\nTODO OK — lo que escribe en Canales llega al archivo"
    : `\n${fallos} comprobacion(es) mal.`
);
process.exit(fallos === 0 ? 0 : 1);
